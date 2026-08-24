# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

A native **Windows desktop app** (WPF, .NET 10) that detects and downloads video/audio from YouTube and YouTube Music using `yt-dlp`. Paste a URL, pick a format, download. It checks its runtime dependencies, detects formats, and streams progress.

This started as a Next.js web app; that version was removed once the desktop app reached parity. Anything below that says "the web app" is history, not a thing you can run. If you need it: `git log -- lib/ytdlp.ts`.

**Windows only.** macOS support was dropped deliberately -- `Installer`, `ToolResolver` and `OutputPaths` are all `[SupportedOSPlatform("windows")]`.

## Commands

Run from the repo root -- the projects are not nested under a `desktop/` subfolder.

```bash
dotnet build MediaDetector.sln                       # build everything
dotnet run --project MediaDetector.App               # run the app
dotnet test MediaDetector.Core.Tests/MediaDetector.Core.Tests.csproj   # 235 tests, ~9s
dotnet test MediaDetector.Core.Tests/MediaDetector.Core.Tests.csproj --filter "FullyQualifiedName~PlaylistOrchestratorTests"
```

**The app locks its own DLLs while running.** A build during that fails with MSB3027 naming the PID. Close it first.

## Layout

| Project | Holds |
|---|---|
| `MediaDetector.Core` | All logic. **No UI reference** -- everything here is testable headless |
| `MediaDetector.App` | WPF views, view models, theme |
| `MediaDetector.Core.Tests` | 235 xUnit cases. No network, no spawning |
| `MediaDetector.App.Tests` | Exists but empty. The view models touch `Application.Current.Dispatcher` in their constructors, so testing them needs an `Application` instance |

## Runtime dependencies (external, checked at runtime, not NuGet)

| Tool | Check | Install | Required |
|------|-------|---------|----------|
| Python 3.8+ | `python`/`python3 --version` | Manual (python.org) | Yes |
| yt-dlp | `python -m yt_dlp --version` | In-app: `python -m pip install yt-dlp mutagen` | Yes |
| **Node.js** | `node --version` at a resolved absolute path | In-app: winget `OpenJS.NodeJS.LTS` / choco `nodejs-lts` | **Yes** |
| ffmpeg (+ffprobe) | `ffmpeg -version` | In-app: winget `Gyan.FFmpeg` / choco; or vendored `vendor/` | Optional |

Both pip and yt-dlp are invoked as `python -m ...` (`YtdlpArgs.Pip` / `YtdlpArgs.Ytdlp`) because a fresh python.org install does not put Python's `Scripts` dir on PATH. yt-dlp is updated with `pip install --upgrade`, not `yt-dlp -U`, which refuses for pip installs. `mutagen` rides along because yt-dlp needs it (or AtomicParsley) to embed cover art into mp4/m4a; the ffmpeg-only fallback fails there and produces files with no image data.

### Node is the one genuinely new dependency

YouTube gates format URLs behind the player's **signature** and **`n` challenges**, which yt-dlp can only solve with an external JavaScript runtime. The web app got this for free -- it *was* a Node process and passed `node:${process.execPath}`. A .NET app has no Node, so it is a declared dependency.

`YtdlpArgs.YouTubeAccess(nodeExe)` prepends three args to **every** yt-dlp call, and all three are load-bearing:

- `--js-runtimes node:<absolute path>` -- yt-dlp enables only `deno` by default. The path must be **absolute**, which is why `ToolResolver.ResolveNodeExe()` walks PATH plus the known install dirs rather than relying on a bare `node`.
- `--remote-components ejs:github` -- a runtime alone is not enough; the EJS solver script is a separate download. Without this, yt-dlp warns "challenge solver script was skipped" and the URLs 403 anyway.
- `--extractor-args youtube:player_client=web_embedded,default` -- yt-dlp's default client (`android_vr`) needs no PO token but currently 403s on every video (yt-dlp#17456). `web_embedded` needs no token either and serves the same audio-only + DASH formats. Clients needing a GVS PO token (`mweb`, `ios`, `tv_simply`, `web`) are not an option -- yt-dlp skips their formats outright -- and `web_safari` only offers muxed HLS.

Miss any of them and the download dies with `HTTP Error 403: Forbidden`. Because `--embed-thumbnail` writes the cover art *before* the media, the only thing a failed run leaves on disk is a stray `.webp` -- which is exactly what that failure looks like from the UI. `DependencyChecker` logs an explicit warning naming HTTP 403 when Node is missing. Confirmation it is working, in the log: `[youtube] [jsc:node] Solving JS challenges using node`.

## Architecture

### Process control (`Core/Processes`)

- `ProcessRunner` -- one-shot commands, returns exit code + stdout.
- `LineStream` -- streams merged stdout+stderr as lines.
- `TrackRunner` -- one yt-dlp download. `ExitCode` is valid once enumeration completes and is what tells success from failure.
- `JobObject` -- Win32 job object with `JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE`. **This is why cancel works.** `proc.Kill()` reaps only the direct child and would orphan the ffmpeg yt-dlp spawned.

Two non-obvious rules, both learned the hard way:

1. **EOF sentinel, not `Process.Exited`.** The exit event can beat the async stdout drain, and the dropped tail is exactly where `savedPath` lives. Both `LineStream` and `TrackRunner` complete their channel only after *both* streams report null.
2. **Merge stdout and stderr through one `Channel`** or you deadlock on the 64 KB pipe buffer.

**Hang watchdog.** ffmpeg postprocessing is silent by design (yt-dlp swallows its output), so a deadline is the only way to tell "working" from "wedged". `TrackRunner` re-arms a timer on every line; after `DefaultIdleTimeout` (5 min) of silence it emits `HungMarker` and kills the tree. The orchestrator treats a hang as non-transient and stops retrying that track immediately -- otherwise one wedged track costs 10 x 5 min.

### Streaming to the UI

`IAsyncEnumerable<DownloadLine>` end to end. The web app's NDJSON wire protocol is gone -- roughly 200 lines of encode/decode deleted. `StreamingViewModel.ConsumeAsync` is the one place the `Dispatcher` appears; Core never touches it.

`DownloadTranslator` turns raw yt-dlp output into lines: a `ProgressLine` per `@PROG` template line, a `PhaseLine` only when the stage *changes*, and the final path / exit code / error text in `Result`. Both download paths check `Code != 0` and send an `ErrorLine` instead of `DoneLine`.

**`TrackLine(Index, Inner)` matters.** `ProgressLine` and `PhaseLine` carry no track index. Sequentially that was fine -- `ItemLine` implicitly scoped everything after it. With several tracks in flight their output interleaves, so the orchestrator wraps everything from a downloader's sink. Lines it emits itself already carry an index and stay unwrapped.

### Concurrent playlist download (`Core/Playlist/PlaylistOrchestrator.cs`)

Two-phase retry engine, N tracks at once (`AppSettings.PlaylistConcurrency`, default 3, range 1-8). Phase 1 tries each track up to 5 times, queueing failures so the batch continues; phase 2 re-sweeps the queue up to 5 more times. A permanently failing track is attempted 10x.

Workers pull from a **shared cursor**, not a fixed partition, so one slow track delays only itself. All of them write into one merged channel that `RunAsync` drains, which is what lets progress reach the UI live.

Guards worth preserving, each with a test:

- Drain the channel with `CancellationToken.None`. `ReadAllAsync(ct)` throws the instant the token trips, escaping `RunAsync` and skipping `BatchDoneLine` -- so a cancelled playlist would report nothing at all.
- Don't pass `ct` to `Task.Run`. If the token is already cancelled the delegate never runs, its `finally` never fires, the channel is never completed, and the drain deadlocks.
- Abandoning the enumerator cancels the workers. Without it they keep spawning yt-dlp for the rest of the playlist with nobody reading.
- A cancelled track exits non-zero exactly like a failed one, so the retry loop checks the token before trying again.

Concurrency is capped at 8 on purpose: past a handful the gain flattens while each track's ffmpeg postprocess is CPU-bound and more parallel requests raise the transient-failure rate the retry engine has to absorb. Measured 29.6s -> 11.7s going from 1 to 3 on a six-track batch.

### Format selection (`Core/Ytdlp/FormatArgs.cs`)

**The `-f` selector is load-bearing.** YouTube's plain `bestaudio` is opus-in-webm, so `-x --audio-format m4a` without one transcodes every track -- 27s vs 0.4s for 37 minutes of audio, and silent while it runs, which presents as a hang. `M4A_SOURCE` asks for an AAC source so extraction is a lossless remux. Its `[audio_channels<=2]` clause matters too: bare `bestaudio[ext=m4a]` picks the 5.1 track where one exists (format 258 at 388kbps vs 140's 129kbps).

`expectedExt` gates `--embed-thumbnail` (webm/opus request none, so no stray `.webp`). MP3 and every video preset need ffmpeg and are disabled in the UI without it.

### File naming (`Core/Naming/FileNaming.cs`)

Files save as `<title> - <artist>.<ext>`. Everything here is pure and has tests.

**The name is computed in C# and handed to yt-dlp as a literal `-o` path**, not a template. Only `%(ext)s` stays templated, and any `%` in the name is doubled so yt-dlp does not read it as a field. Two reasons this beats a template:

1. yt-dlp decides a file is "already downloaded" by comparing against the name its `-o` produces. A literal name is stable across runs, so re-running a playlist skips what it has -- which is how a playlist resumes. Renaming *after* the download would break this.
2. The preview and the real filename come from the same function, so they cannot drift.

`ParseShowTitle` handles Vietnamese variety-show titles. Two things to preserve: the genre anchors are deliberately the **diacritic** forms (an ASCII lookalike like `Hai Phong, Ha Noi - Trip` must not match, and a test pins that), and brand segments are only ever matched as a **whole pipe segment** ("Thúy Nga" is both the channel and a performer; inside a comma list she must survive).

`CleanTitle` gotchas with tests on them: the `ft|feat` rule needs its leading `\s+` or the `ft` inside "Daft Punk" eats the title down to "Da"; the quality rule needs a digit or unit on every alternative so bare years survive ("Blade Runner 2049").

`SanitizeFilename` reproduces yt-dlp's own substitutions -- it swaps full-width lookalikes (`/` -> U+29F8, `:` -> U+FF1A) rather than stripping.

**Typed names are untrusted input pasted into an absolute path**, so both download paths run them through `SanitizeUserStem`. That leans on both separators mapping to full-width lookalikes, which makes the result a single path component by construction: `../../etc/passwd` becomes a literal file inside the download folder. Tests cover the traversal attempts; keep them.

### Embedded metadata (`Core/Ytdlp/MetadataTagger.cs`)

Renaming a file, ours or the user's own in File Explorer, only ever changes the filename. Apple Music and the Windows Music app read the file's **embedded** tag (ID3 `TIT2`/`TPE1`, MP4 `©nam`/`©ART`), which `--embed-metadata` (`FormatArgs.Metadata`) writes from the raw YouTube title/uploader regardless of what we name the file. `MetadataTagger.TryWriteTagsAsync` corrects that tag after a successful download, using `FileNaming.SplitName`'s same title/artist split as `DownloadStem` -- kept as two separate tag fields rather than one combined string. `FileNaming.MetadataOverrideFor` decides whether it's worth doing at all: skipped when `CleanNames` is off and there is no typed name, since `RawStem`'s filename is the raw title verbatim and already matches what `--embed-metadata` wrote by default.

Values reach the tag writer purely through Python `argv`, not yt-dlp's own `--parse-metadata`. That flag regex-matches an expanded output-template string, which is fragile for literal title text containing regex/template metacharacters (`%`, `(`, `)` -- common in real titles) and only runs when ffmpeg is present. `argv` has neither problem and needs no ffmpeg -- it works off mutagen alone (already a required pip dependency, `Dependencies/Installer.cs`). Best-effort only: `File(path, easy=True)` returns `None` for a container mutagen cannot tag (opus-in-webm from "Best available, no conversion"), and any failure is logged, never raised -- a tag-write failure must not fail a download that otherwise succeeded.

**Raw-mode downloads are never auto-corrected** (that is the whole point of `MetadataOverrideFor`'s skip), so a file downloaded with Clean names off keeps whatever `--embed-metadata` wrote, permanently. The "Fix metadata" button in the header (`MainWindow.xaml`, `MainViewModel.OpenMetadataFixCommand`) opens `MetadataFixWindow`, a self-contained dialog for exactly that case: pick any file on disk, its *current* title/artist tag is read via `MetadataTagger.ReadTagsAsync` to prefill two editable fields, and Save calls `TryWriteTagsAsync` directly -- no re-download, no original YouTube URL needed. `ReadTagsAsync` prints JSON rather than plain lines because `ProcessRunner` trims stdout as one block, which a delimiter-based format could misparse if a tag value contained a newline.

### Diagnostics (`Core/Diagnostics/AppLog.cs`)

A windowed app has no console, so everything yt-dlp printed that the parser did not recognise -- including the real error text on a failure -- had nowhere to go. `AppLog` is a 2000-entry ring buffer the UI binds to, plus a rolling file under `%LOCALAPPDATA%\MediaDetector\logs` (last 10 runs).

- The file is **UTF-8 with a BOM**. Without one, Notepad and PowerShell 5.1 fall back to the ANSI codepage and render every Vietnamese title as mojibake -- which is exactly what these logs are for.
- Progress lines are excluded. A 20-minute download emits hundreds of `@PROG` lines and they bury everything else.
- `TrackRunner.Label` / `DownloadTranslator.Label` prefix `track N:` so concurrent tracks stay tellable apart.
- Every file error is swallowed and the sink switched off. Logging must never be the reason something fails.

### Settings and output

`AppSettings` is a JSON file under `%LOCALAPPDATA%\MediaDetector` (theme, clean-names, output dir, playlist concurrency). Not `ApplicationData.Current` -- that needs package identity an unpackaged app does not have. A corrupt file must never stop the app launching.

Downloads go to `~/Documents/MediaDetector` unless overridden; `OutputPaths.EnsureCreated` accepts an override only when it is a non-empty absolute path -- that is the validation boundary.

## UI

### Theme

Apple-ish design system. `Themes/Light.xaml` and `Dark.xaml` hold **32 keys each and must stay in lockstep**; `Controls.xaml` holds the control styles. Components use `{DynamicResource}` tokens, never hardcoded colours.

`InvariantGlobalization` **must stay `false`** in `Directory.Build.props`. Setting it true crashes *every* WPF binding at runtime (`BindingExpression.GetCulture()` -> "Cannot find non-neutral culture"). Locale independence is guaranteed instead by explicit `CultureInfo.InvariantCulture` at each parse/format in Core. `AllowUnsafeBlocks` must stay `true` -- `[LibraryImport]` requires it.

`TextBox` and `ComboBox` are **retemplated**, not merely recoloured; the stock ones draw a square Win32-era box. Both keep their required parts -- omit `PART_ContentHost` and the TextBox renders blank; omit `PART_Popup` and the ComboBox never opens. `PlaceholderText.Text` is an attached property the TextBox template renders when empty.

Buttons use a small fixed corner radius, **not** full-radius capsules: WPF clamps `CornerRadius` to half the shorter side, so a short label came out as an oval.

### Resizable frame, not a scrolling page

The window resizes freely (`MinWidth="600"`, `MinHeight="700"`, no maximums either way). The outer `Grid` stretches to the window's client area -- its default `HorizontalAlignment`, no fixed `Width` -- so growing the window grows the content instead of leaving margins. Chrome sits in `Auto` rows; the one star row (shared by the format list and the playlist card, via `StarIfVisible` on each, since only one is ever visible) absorbs whatever height is left, and both lists scroll *inside their own panel* once they run out of room. Anything of unbounded length works the same way. Previously the whole page scrolled, so a long playlist pushed the title and the URL box off the top -- that's what this avoids.

Traps that cost real time here:

- **`MaxWidth` + `HorizontalAlignment="Center"` sizes a panel to its content** and only clamps at the maximum. Every card was as wide as its longest string, so the layout jumped when the status text changed. Let the panel stretch to its parent instead (the default alignment) rather than reaching for `MaxWidth`.
- **`ListBox` defaults `HorizontalScrollBarVisibility` to `Auto`**, which measures items with infinite width, so `TextTrimming` never fires. Set it `Disabled`.
- **An `Auto` column is only as wide as its own row's content**, so per-row status cells gave every row a different right edge. Fixed widths.
- **A star row keeps its share even when its child is `Collapsed`** -- hence `VisibilityToStarHeight`.
- **A `MinHeight` that cannot be honoured overflows and the Grid clips whole rows away.** That silently removed whole rows (rename controls, the track list) at small window sizes. Neither the format list nor the playlist track list carries an explicit `MinHeight` for this reason -- both just shrink with the star row down to whatever the window allows.

The playlist track list and the format list both grow and shrink with the window (star row + internal `ScrollViewer`); neither is capped to a fixed row count anymore.

### Converters

`BoolToVisibility` logs a warning when handed a non-bool. That is not defensive noise: the playlist format picker was bound to a `ListBox`'s **int** `SelectedIndex`, so the converter read `false` forever, the audio picker was hard-wired visible and the video one hidden -- and `Mode` never left `Audio`, so picking Video still downloaded audio. WPF swallows binding failures, so nothing said a word. Bind visibility to real bools.

Likewise `NotNullToVisibility` treats a zero `int` as absent -- bound to `LogLines.Count`, a boxed `0` is not null and rendered an empty grey bar permanently.

## Testing

xUnit in `MediaDetector.Core.Tests`, mirroring Core's folders. Everything is injectable: `PlaylistOrchestrator` takes its downloader and sleep, `DownloadTranslator` takes its source sequence, `DependencyChecker.BuildAsync` takes its probes. No test spawns yt-dlp or touches the network.

**Concurrency tests must be able to fail.** `Concurrency_RunsThatManyTracksAtOnce` blocks every attempt until the full width is actually in flight, so a sequential engine can never release them -- verified by forcing `workerCount = 1` and watching it fail. A concurrency test that also passes on a sequential engine is worthless.
