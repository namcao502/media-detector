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
dotnet test MediaDetector.Core.Tests/MediaDetector.Core.Tests.csproj   # 268 tests, ~9s
dotnet test MediaDetector.Core.Tests/MediaDetector.Core.Tests.csproj --filter "FullyQualifiedName~PlaylistOrchestratorTests"
```

**The app locks its own DLLs while running.** A build during that fails with MSB3027 naming the PID. Close it first.

## Layout

| Project | Holds |
|---|---|
| `MediaDetector.Core` | All logic. **No UI reference** -- everything here is testable headless |
| `MediaDetector.App` | WPF views, view models, theme |
| `MediaDetector.Core.Tests` | 268 xUnit cases. No network. Spawns only Python/Node, for the encoding and no-shell guarantees |
| `MediaDetector.App.Tests` | Exists but empty. The view models touch `Application.Current.Dispatcher` in their constructors, so testing them needs an `Application` instance |

## Runtime dependencies (external, checked at runtime, not NuGet)

**Vendor-only.** The resolvers look at exactly two folders, both owned by the app:

- `<app>/bin` -- what `MediaDetector.App.csproj` copies `vendor/*.exe` into at build time (`ToolResolver.VendorBin`)
- `<app>/data/tools` -- what the Install buttons download into (`ToolResolver.DownloadedToolsDir`)

PATH, winget and Chocolatey are **not** consulted. The two folders must stay distinct and the second is deliberately not called `bin`: MSBuild rewrites `VendorBin` on every build, so a downloaded copy of the same filename there would be clobbered on the next build and restored on the next Install, flip-flopping silently.

| Tool | Check | In-app Install downloads | Required |
|------|-------|--------------------------|----------|
| yt-dlp | `yt-dlp.exe --version` | The GitHub release exe | Yes |
| **Node.js** | `node --version` at an absolute path | Latest LTS zip, extracts `node.exe` | **Yes** |
| ffmpeg (+ffprobe) | `ffmpeg -version` **and** `ffprobe -version` | gyan's release zip, extracts both exes | Optional |

Each also takes a hand-placed copy in `vendor/`, which wins over the download.

`Installer` streams progress through a `Channel` because `yield return` cannot sit inside the `try/catch` a download needs -- the same reason `LineStream` uses one. Drained with `CancellationToken.None` so a cancelled install still reports why it stopped. Progress every 4 MB: a silent 106 MB download is indistinguishable from a hang.

Zip entries are matched on **file name**, never on a path inside the archive -- both zips nest their payload under a versioned root (`ffmpeg-7.1-essentials_build/bin/`). The destination is built from our own constant, never from the entry, so a crafted archive cannot escape the target folder.

nodejs.org publishes no stable "latest LTS" URL, so `LatestLtsVersion` reads `dist/index.json`, where entries are newest-first and non-LTS lines carry `lts: false`. That is the one fragile link here; gyan's ffmpeg URL is stable by contrast.

**There is no Python row, and no mutagen row.** Both were removed, in that order, and the order was forced:

- `MetadataTagger` used to shell out to `python -c "from mutagen import File"`. Moving it to **TagLib#** (`MediaDetector.Core.csproj`) made tagging in-process and killed the mutagen dependency.
- Only *then* could Python go, by switching `YtdlpArgs.Ytdlp` from `python -m yt_dlp` to the **standalone `yt-dlp.exe`**, which bundles its own Python. Doing this first would have achieved nothing -- `MetadataTagger` still needed an interpreter.

Consequences worth knowing:

- `yt-dlp.exe -U` is now the update path and it works. The old comment saying `-U` refuses was true only of a **pip** install, which is what this used to be.
- The Install button downloads into `ToolResolver.DownloadedToolsDir`, staged through a `.part` file so an interrupted download never leaves a truncated exe for the resolver to find. It cannot write to `vendor/`, so a stale vendored copy always wins -- update that by hand.
- **In dev, `data/` sits inside `bin/Debug/net10.0-windows/`**, so `dotnet clean` deletes ~300 MB of downloaded tools along with the build output. In a published folder `data/` is a sibling of the exe and survives.
- **Python is still a dev dependency of the test suite.** `RunAsync_RoundTripsNonAsciiChildOutput` and `StreamAsync_RoundTripsNonAsciiChildOutput` need a real Python to reproduce the mangling they guard against, and `yt-dlp.exe` cannot run an arbitrary `-c` script. `NonAscii.ResolvePythonAsync` fails loudly rather than skipping.
- **`PYTHONIOENCODING=utf-8` in `ProcessRunner.NewPsi` is still load-bearing.** `yt-dlp.exe` is that same Python frozen by PyInstaller and reads it identically. Removing it brings the `h?i kch` mangling straight back.
- PyInstaller unpacks to temp on every launch (~1-2s), and a playlist spawns one process per track. Defender also flags PyInstaller binaries more readily than a pip install.

### ffmpeg is the one remaining optional row

Optional only in that a download still succeeds. Without it `FormatArgs.Metadata` returns `[]`, so there is no text metadata, no chapters, and no cover art at all. That gate is also what made dropping mutagen free: cover art already required ffmpeg, so using ffmpeg to convert the thumbnail to jpg added nothing new.

**`ResolveFfmpegDir` matches on both exes, not just `ffmpeg.exe`.** `--ffmpeg-location` points yt-dlp at one directory and the thumbnail conversion runs out of it, so a half-populated dir (typically a `vendor/` given only `ffmpeg.exe`) used to beat a complete install further down the candidate list and lose the image behind a green row. Requiring both makes it fall through to the next candidate, or to PATH.

### Why a system install is deliberately invisible

A green row has to mean "this copy of the app carries what it needs", and a PATH lookup made it mean "this machine happens to have it" instead. Those came apart in practice: with `vendor/` empty every row still went green, and the `yt-dlp.exe` that answered was the **pip shim** in Python's `Scripts` dir -- a real executable reporting the same `--version` as the standalone build, silently keeping Python in the loop. `RowAction.InstallNode` and `InstallFfmpeg` went with it: winget and Chocolatey install system-wide, so the button would have reported success onto a row that stayed red.

Consequences to keep in mind:

- `YtdlpExeOrDefault` falls back to `<app>/bin/yt-dlp.exe`, **not** to a bare `"yt-dlp.exe"` -- a bare name resolves through PATH at spawn time and would put the system install straight back.
- `ProbeFfmpegAsync` returns not-found rather than running a bare `ffmpeg`.
- `DependencyRows` stays pure and never touches `ToolResolver`; the concrete folder to copy into comes from `StatusBarViewModel.VendorHint`.
- An empty `vendor/` means the app genuinely cannot download. That is the intended state, not a bug.

### A candidate must be a real executable, not just a filename

`FirstDirWith` calls `ToolResolver.IsExecutable`, not `File.Exists`. Same reasoning as the both-exes rule above, generalised: the vendored `bin/` is probed **first**, so anything invalid sitting there beats a working install further down the list. A half-finished download, a placeholder, or a file renamed by mistake all pass `File.Exists` — verified by dropping a 5-byte text file named `yt-dlp.exe` into `vendor/`, which the resolver accepted outright.

The check is the `MZ` signature plus a 1 KB floor: two bytes, no spawn, cheap enough for the resolver's hot path. It answers "is this a program at all". The status probes still run `--version`, which is what answers "is it the **right** program" — keep both, they catch different things.

Four tests pin it, and all four were confirmed to fail when `IsExecutable` is downgraded to `File.Exists`.

### Settings, logs and downloads

`AppPaths.DataRoot` is `<app>/data` when that is writable, else `%LOCALAPPDATA%\MediaDetector`. Writability is probed by actually writing a file, because UAC virtualization makes the permission bits unreliable. Settings and logs and the downloaded yt-dlp all sit under it, so a copied app folder keeps them; an install under Program Files still works via the fallback.

`AppSettings.Load` reads `AppPaths.LegacyRoot` when the app-local file does not exist, so the move does not read as a factory reset. Saves always target `DataRoot`, which completes the migration. Logs are not migrated -- they are disposable by design.

**User downloads stay in `~/Documents/MediaDetector`** (`OutputPaths`). Music is the user's data, and burying gigabytes in the program folder would make the app unmovable, which is the opposite of the goal.

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

Three non-obvious rules, all learned the hard way:

1. **EOF sentinel, not `Process.Exited`.** The exit event can beat the async stdout drain, and the dropped tail is exactly where `savedPath` lives. Both `LineStream` and `TrackRunner` complete their channel only after *both* streams report null.
2. **Merge stdout and stderr through one `Channel`** or you deadlock on the 64 KB pipe buffer.
3. **`--encoding utf-8` on every yt-dlp call** (`YtdlpArgs.Ytdlp`). The frozen `yt-dlp.exe` **ignores `PYTHONIOENCODING` and `PYTHONUTF8` alike** -- verified at the byte level: with either env var, `--print filename` returned `5b47 616c 6120 6369` ("[Gala ci"); with the flag it returned `63 c6b0 e1bb9d 69` ("cười"). Without it every non-ASCII `savedPath` names a file that does not exist, so `MetadataTagger` cannot open it, the tag is never written, and the fetched `.jpg` is never deleted -- 142 tracks arrived that way. `Ytdlp_ForcesUtf8Output` pins the flag. This is the same bug as item 4, resurfacing because the mitigation there does not reach a PyInstaller build.
4. **`PYTHONIOENCODING=utf-8` on every child**, set once in `ProcessRunner.NewPsi`. **Every spawn path must go through it** -- `TrackRunner` hand-rolled its own `ProcessStartInfo` for a while and so applied only half the contract, on the one path every download actually takes. `TrackRunnerAndProcessRunner_ShareOneProcessStartInfoBuilder` asserts it directly, because the three `*RoundTripsNonAsciiChildOutput` tests **go vacuous whenever the shell running the suite already exports `PYTHONIOENCODING`** -- the child inherits it and passes no matter what the code does. Keep both: one is end-to-end, only the other cannot silently stop guarding anything. We decode the pipe as UTF-8, but Python encodes a *redirected* stdout in the ANSI codepage -- `cp1252` on a normal Windows box -- and yt-dlp's `write_string` drops what will not fit with `errors='ignore'`. So a folder named `hài kịch` arrived as `h?i kch`: one character replaced, one deleted outright. Every `savedPath` for a non-ASCII path then named a file that did not exist, and `MetadataTagger` failed on all of them while the download itself looked fine. Silent, because the tag write is best-effort by design. Regression tests: `RunAsync_RoundTripsNonAsciiChildOutput` and `StreamAsync_RoundTripsNonAsciiChildOutput` -- both fail with the exact `h?i kch` mangling if the env var is removed.

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

The picker offers **1, 2, 5, 10, 15** (`PlaylistViewModel.ConcurrencyChoices`), default 5. Measured 29.6s -> 11.7s going from 1 to 3 on a six-track batch; past a handful the gain flattens while each track's ffmpeg postprocess is CPU-bound and more parallel requests raise the transient-failure rate the retry engine has to absorb. The high end exists to be chosen, not because it is a good idea.

**The list is sparse, so a persisted value is snapped, not clamped.** `Math.Clamp` keeps an in-range value like 3 or 8 that matches no entry, which leaves the ComboBox's `SelectedItem` bound to nothing and the picker blank. `NearestConcurrencyChoice` is what carries an older default across.

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

Renaming a file, ours or the user's own in File Explorer, only ever changes the filename. Apple Music and the Windows Music app read the file's **embedded** tag (ID3 `TIT2`/`TPE1`, MP4 `©nam`/`©ART`), which `--embed-metadata` (`FormatArgs.Metadata`) writes from the raw YouTube title/uploader regardless of what we name the file. `MetadataTagger.TryWriteTagsAsync` corrects that tag after a successful download, using `FileNaming.SplitName`'s same title/artist split as `DownloadStem` -- kept as two separate tag fields rather than one combined string. `FileNaming.MetadataOverrideFor` decides whether the title/artist is worth rewriting: it returns null when `CleanNames` is off and there is no typed name, since `RawStem`'s filename is the raw title verbatim and already matches what `--embed-metadata` wrote.

**This is TagLib#, not mutagen, and not yt-dlp's `--parse-metadata`.** That flag regex-matches an expanded output-template string, fragile for literal title text containing regex/template metacharacters (`%`, `(`, `)` -- common in real titles). TagLib# takes plain strings and needs no interpreter, which is what let Python go entirely. Best-effort only: every exception is caught, logged, and reported as `false` -- deliberately broad, because a tag-write failure escaping into a download's async iterator would turn a finished download into a reported failure.

**It also writes the cover art**, which is the part that changed shape. `FormatArgs.Metadata` asks yt-dlp for `--write-thumbnail --convert-thumbnails jpg` rather than `--embed-thumbnail`, because yt-dlp's own embed step needs mutagen for mp4/m4a (its ffmpeg fallback writes no usable image data). So three things follow, and all three are easy to break:

1. `TryWriteTagsAsync` runs after **every** successful download, not only when `MetadataOverrideFor` returns non-null. A null override means "leave title/artist alone, still write the picture" -- the raw-mode branch, pinned by `TryWriteTags_WritesCoverArtWithoutTouchingTitleWhenOverrideIsNull`.
2. **The caller must delete the .jpg.** Without the embed postprocessor nothing cleans it up, so every finished download would otherwise leave a stray image. Both download paths call `DownloadTranslator.DeleteThumbnail` right after, and do it even when the embed failed.
3. `DownloadTranslator.CoverPathFor` **derives** the path from `savedPath` rather than scraping the log. `OutputParser.ParseThumbnailPath` matches the pre-conversion `.webp`, which no longer exists by then; `RemoveStrayThumbnail` keeps using it for the failure path, and deletes the `.jpg` sibling too in case the convertor ran before the download died.

**Raw-mode title/artist is still never auto-corrected**, so a file downloaded with Clean names off keeps whatever `--embed-metadata` wrote. The "Fix metadata" button in the header (`MainWindow.xaml`, `MainViewModel.OpenMetadataFixCommand`) opens `MetadataFixWindow` for exactly that case: pick any file on disk, its *current* tag is read via `MetadataTagger.ReadTagsAsync` to prefill two editable fields, and Save calls `TryWriteTagsAsync` directly -- no re-download, no original YouTube URL needed.

### Bulk repair (`Core/Ytdlp/MetadataBackfill.cs`)

Repairs files downloaded before the `PYTHONIOENCODING` fix, whose tag write failed silently on every non-ASCII path. Reached from the same "Fix metadata" dialog ("Repair a whole folder").

The correction is recomputed from each file's **own current tag**, not by reverse-parsing its filename: `--embed-metadata` wrote exactly the raw title and uploader that `DownloadService` fed to `FileNaming.SplitName`, so replaying `SplitName` over them reproduces what should have been written. Going back through the filename would have to undo `SanitizeFilename`'s full-width substitutions, which are not reversible (`|` -> `｜` is lossy in that direction).

- **`CorrectionFor` is pure and returns null when nothing needs writing**, which is what makes a second run a no-op instead of rewriting the whole folder. `CorrectionFor_IsIdempotent` pins it.
- **Not recursive, on purpose.** Pointed at a music library root this would run `CleanTitle`/`ParseShowTitle` over unrelated files. Scoped to the one folder the user picks, with a count confirmed before any write.
- A tag that already equals its `SplitName` output is left alone -- titles with no cast pattern to extract (no quoted span, no genre + comma-list) legitimately keep their pipes, and tag and filename still agree.
- `TaggableExtensions` still excludes `.opus`/`.webm` even though TagLib# could open an `.opus`. The download path does not correct their tags either, so widening this alone would start rewriting files nothing else touches.

**It also absorbs a stray `.jpg`.** `CoverFor` matches a sibling with the *exact same stem*, which is how `--write-thumbnail` names it and what distinguishes it from an unrelated image in the folder. This exists because the `--encoding` bug left 142 tracks with an uncorrected tag *and* an unembedded cover; re-downloading would not fix them, since yt-dlp skips a file it already has.

Two rules here differ from the download path on purpose:

- **Cover art is not gated behind the tag correction.** A file whose tag is already right can still have a stray image, so `correction == null && cover == null` is the only "nothing to do" case. `RunAsync_RepairsCoverArtEvenWhenTheTagIsAlreadyCorrect` pins it.
- **The image is deleted only after a successful write.** `DownloadService` deletes regardless, because there the image was just fetched and is re-fetchable; here it is the only copy. Deleting is also what makes a second pass a no-op.

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

Both lists shrink with the window (star row + internal `ScrollViewer`). The playlist track list carries a `MaxHeight` of ~15 rows on top of that, because a 142-track playlist otherwise ran the full height of a tall window. `MaxHeight` only -- it caps growth and can always be honoured, unlike the `MinHeight` above.

### Converters

`BoolToVisibility` logs a warning when handed a non-bool. That is not defensive noise: the playlist format picker was bound to a `ListBox`'s **int** `SelectedIndex`, so the converter read `false` forever, the audio picker was hard-wired visible and the video one hidden -- and `Mode` never left `Audio`, so picking Video still downloaded audio. WPF swallows binding failures, so nothing said a word. Bind visibility to real bools.

Likewise `NotNullToVisibility` treats a zero `int` as absent -- bound to `LogLines.Count`, a boxed `0` is not null and rendered an empty grey bar permanently.

## Testing

xUnit in `MediaDetector.Core.Tests`, mirroring Core's folders. Everything is injectable: `PlaylistOrchestrator` takes its downloader and sleep, `DownloadTranslator` takes its source sequence, `DependencyChecker.BuildAsync` takes its probes. No test spawns yt-dlp or touches the network.

**Concurrency tests must be able to fail.** `Concurrency_RunsThatManyTracksAtOnce` blocks every attempt until the full width is actually in flight, so a sequential engine can never release them -- verified by forcing `workerCount = 1` and watching it fail. A concurrency test that also passes on a sequential engine is worthless.
