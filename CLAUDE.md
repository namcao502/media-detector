# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## This is NOT the Next.js you know

Next.js 16 (App Router) has breaking changes -- APIs, conventions, and file structure may differ from training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing Next.js code, and heed deprecation notices.

## Project

Next.js 16 App Router web app that detects and downloads video/audio from YouTube and YouTube Music using `yt-dlp`. Paste a URL, pick a format, download. The app checks its runtime dependencies, detects formats, and streams progress. TypeScript 5 (strict), React 19, Tailwind CSS v4 + CSS custom properties.

## Commands

```bash
npm run dev                          # dev server (Turbopack), http://localhost:3000
npm run build                        # production build
npm start                            # serve production build
npm test                             # all Jest tests (jsdom + node projects)
npm run test:watch                   # watch mode
npx jest path/to/file --no-coverage  # single test file
npx tsc --noEmit                     # typecheck (no emit)
```

## Runtime dependencies (external, checked at runtime, not npm)

| Tool | Check | Install | Required |
|------|-------|---------|----------|
| Python 3.8+ | `python`/`python3 --version` | Manual (python.org) | Yes |
| yt-dlp | `python -m yt_dlp --version` | Auto: `python -m pip install yt-dlp mutagen` | Yes |
| mutagen | (pip, bundled with yt-dlp install) | Auto: installed alongside yt-dlp | Cover art |
| ffmpeg (+ffprobe) | `ffmpeg -version` (PATH; on Windows also probes `bin/`, winget/choco shim dirs) | In-app button: winget/choco (Win), Homebrew (macOS); or PATH / vendored `bin/` | Optional |

`/api/status` checks all three, auto-updates yt-dlp, and caches the result; the UI is disabled until Python + yt-dlp are present. Both pip and yt-dlp are invoked as `python -m ...` (via `pipArgs`/`ytdlpArgs` in `lib/ytdlp.ts`) because a fresh python.org install does not put Python's `Scripts` dir on PATH. yt-dlp is updated with `python -m pip install --upgrade yt-dlp mutagen`, not the `yt-dlp -U` self-updater (which refuses for pip installs). `mutagen` is installed alongside yt-dlp (install + update routes and the `/api/status` auto-update) because yt-dlp needs mutagen or AtomicParsley to embed cover art into mp4/m4a; its ffmpeg-only fallback fails there ("Unable to embed using ffprobe & ffmpeg"), producing files with no image data. ffmpeg is optional: downloads work without it, but embedding metadata + cover art needs it.

## Architecture

### Process spawning (`lib/ytdlp.ts`)

- `execArgs(args)` -- user-controlled args (URLs). `spawn`, no shell, injection-safe.
- `execCommand(cmd)` -- fixed internal commands only (e.g. `yt-dlp --version`). **Never** pass user input here.
- `streamCommand(args)` -- async generator; merges stdout+stderr to avoid the 64KB pipe deadlock.

### Streaming responses

Download and install routes return a `ReadableStream` of NDJSON lines; the client reads `res.body.getReader()` and decodes with `new TextDecoder()` (`{ stream: true }` for multi-byte chars across chunks). Download line types (`DownloadStreamLine`): `progress`, `phase`, `done` (`savedPath`), `error` (`message`). Playlist line types add `item`, `track-done`, `track-retry`, `track-skipped`, `track-error`, `done`.

### Download progress detail

Both download routes pass `progressTemplateArgs()` (`--newline --progress-template "download:@PROG ..."`), which replaces yt-dlp's human-readable `[download] 42.3% of 3.29MiB at 1.23MiB/s` line with raw numbers, so nothing has to parse units or locale text. `parseProgressLine()` turns a `@PROG` line into a `progress` carrying `percent`, `downloadedBytes`, `totalBytes`, `speedBytesPerSec`, `etaSeconds` and `fragmentIndex/Count` (any field yt-dlp reports as `NA` is omitted); it still falls back to the old `[download] nn%` regex. `parsePhase()` maps yt-dlp's stage prefixes (`[youtube]`/`[info]`, `[download] Destination:`, `[Merger]`, `[ExtractAudio]`/`[Fixup*]`, `[Metadata]`/`[EmbedThumbnail]`/`[ThumbnailsConvertor]`, `[MoveFiles]`) onto a `DownloadPhase`. **ffmpeg's own encode progress is not obtainable** -- yt-dlp captures its subprocess output -- so the phase label is what explains a bar that has stopped moving during merge/embed.

`translateDownloadLines(gen)` is the pure translator (source generator injected, unit-tested without spawning): it emits progress lines, emits a phase line only when the stage *changes*, collects `ERROR:` text, and returns `{ code, savedPath, errorMessage }`. `runDownload(args)` wires it to `runTrack`. Both routes check `code !== 0` and send an `error` line instead of `done` -- previously a failed download still reported "Saved to ...".

### Download file naming (`lib/filename.ts`)

Files are saved as `<title> - <artist>.<ext>`. Everything in this module is pure and unit-tested.

**The name is computed in Node and handed to yt-dlp as a literal `-o` path**, not as a template: `outputTemplateFor(path.join(dir, downloadStem(source)))` leaves only `%(ext)s` templated (the extension is unknown until the format is picked/converted) and doubles any `%` in the name so yt-dlp does not read it as a field. Two reasons this beats a template:

1. yt-dlp decides a file is "already downloaded" by comparing against the name its `-o` produces. A literal name is stable across runs, so re-running a playlist still skips what it has -- which is how a playlist is resumed. (Verified: a repeat download leaves mtime untouched.) A rename *after* the download would break this.
2. `FileNameRow`'s preview and the real filename come from the same function, so they cannot drift.

An earlier version expressed these rules as `--replace-in-metadata`/`--parse-metadata` args with a JS mirror for the preview; keeping two regex engines in step was most of the complexity, and it could not express "cast becomes the artist" at all. Don't go back to it.

`downloadStem` picks the credit via `effectiveAuthor`: the show cast when the title names one, else `artist` (set by YouTube for Topic/YouTube Music), else uploader/channel with `stripTopicSuffix` applied so `<Artist> - Topic` reads as `<Artist>`. `stripAuthorPrefix` drops a leading `<author> - ` so `Daft Punk - Instant Crush` by `Daft Punk` becomes `Instant Crush - Daft Punk` rather than repeating the name.

`parseShowTitle` handles Vietnamese variety-show titles, which pack series/genre/cast around the real name. It recognises three shapes in order (quoted name with cast either side; genre + leading cast + name; genre + name + trailing cast) and returns `{ track, cast }`, so `PBN 66 | Hài kịch "Trần Trừng Trị" - Kiều Linh, Chí Tài` becomes `Trần Trừng Trị - Kiều Linh, Chí Tài`. It returns `null` for everything else, which is most content. Two things to preserve when editing it:

- The genre anchors (`hài`, `hài kịch`, `kịch`, `tấu hài`) are deliberately the **diacritic** forms, which keeps the blast radius tiny -- an ASCII lookalike like `Hai Phong, Ha Noi - Trip` must not match, and a test pins that.
- `BRAND_SEGMENTS` are only ever matched as a **whole pipe segment**. "Thúy Nga" is both the channel and a performer; inside a comma list she must survive.

`cleanTitle` is the separate, ordinary-title path: bracketed promo tags, trailing `ft.`/`feat.`, promo tails, and quality markers. Gotchas with tests pinning them: the `ft|feat` rule needs its leading `\s+` or the `ft` inside "Daft Punk" eats the title down to "Da"; the quality rule (`4K`, `60fps`, `1080p`, `HD`) needs a digit, unit or acronym on every alternative so bare years survive ("Blade Runner 2049").

`sanitizeFilename` reproduces yt-dlp's own substitutions -- it swaps full-width lookalikes (`/` -> U+29F8, `:` -> U+FF1A, ...) rather than stripping -- verified against `yt_dlp.utils.sanitize_filename`.

`hooks/useCleanNames.ts` persists the on/off choice (`clean-names`, default on, read after mount so SSR and first client render agree); both download routes take `cleanNames` in the request body, default true, and fall back to `rawStem` (the untouched title) when it is false.

**Hand-typed names.** No rule set survives every channel's title conventions, so the name is editable: `FileNameRow` for a single video (request body `filename`), and per track in `PlaylistPanel` -- click a track name to rename it (request body `names`, keyed by 1-based track index). An override wins over everything, and disables the Cleaned/Original switch since the rules no longer apply.

A typed name is **untrusted input pasted into an absolute path**, so both routes run it through `sanitizeUserStem` before use. That leans on `sanitizeFilename` mapping *both* separators to full-width lookalikes (`/` -> U+29F8, `\` -> U+29F9), which makes the result a single path component by construction -- `../../etc/passwd` becomes the literal file `..⧸..⧸etc⧸passwd` inside the download folder. It also rejects blanks and bare `.`/`..`, returning null so the caller falls back to the generated name. Tests cover the traversal attempts; keep them if you touch the sanitiser.

`PlaylistTrack.author` exists purely so the client previews the same name the server builds -- without it every playlist row previewed as "... - Unknown" while the server credited the real channel.

### Cancelling a download

The client holds an `AbortController` per run and passes its `signal` to `fetch`; Cancel aborts it. Server side both download routes build their own `AbortController` fed by **two** sources -- `req.signal` (client disconnect) and the `ReadableStream`'s `cancel()` callback -- and pass `abort.signal` into `runDownload(args, signal)`. Dropping the response is not enough on its own: without this the yt-dlp process keeps downloading to `.part` after the user stopped it.

`killProcessTree(proc)` in `lib/ytdlp.ts` does the killing. On Windows it shells out to `taskkill /T /F` because `proc.kill()` reaps only the direct child and would orphan the ffmpeg yt-dlp spawned; on macOS a `SIGTERM` to yt-dlp is enough (it tears down its own children). `runTrack` also calls it from a `finally`, so an abandoned generator cannot leak a process.

**Hang watchdog.** yt-dlp can wedge with no output at all, and since ffmpeg postprocessing is silent by design there is no way to distinguish "working" from "stuck" other than a deadline. `runTrack` re-arms a timer on every line and, after `IDLE_TIMEOUT_MS` (5 min) of silence, pushes an error carrying `HUNG_MARKER` and kills the process tree. The playlist route turns that marker into `TrackOutcome.hung`, which `orchestratePlaylist` treats as non-transient: it stops retrying that track immediately rather than spending the deadline 5 more times. Without that check a single wedged track would cost 10 attempts x 5 min.

**Stray cover art.** `--embed-thumbnail` makes yt-dlp download the image to a sibling file and delete it once the embed postprocessor runs; a failed or cancelled download never reaches that step and orphans a `.webp` next to the media. Neither `--paths thumbnail:` nor `-o "thumbnail:..."` redirects it (both verified as ignored), so `parseThumbnailPath()` scrapes the path out of yt-dlp's `[info] Writing video thumbnail N to: ...` line, `translateDownloadLines` returns it as `thumbnailPath`, and both routes call `removeStrayThumbnail()` on a non-zero exit -- the playlist one per attempt, since each retry would otherwise add another. Only the path yt-dlp reported is deleted, never a glob. The resumable `.part` file is deliberately left alone.

`orchestratePlaylist` takes the same `signal`: a killed track exits non-zero exactly like a genuine failure, so without an abort check the retry engine would attempt cancelled work up to 10 more times. It stops before the next track, skips the phase-2 sweep, and sets `cancelled: true` on the `done` line. Client side an `AbortError` from `fetch` is translated into a cancelled state, never an error -- `FormatRow` shows "Cancelled -- a partial file may remain" (yt-dlp leaves a resumable `.part`) and re-offers the button as Retry.

Client side, `hooks/useIdleSeconds.ts` ticks once a second while a download is active and the UI warns "no update for Ns" past 5s, since yt-dlp goes silent whenever a transfer stalls. `lib/format.ts` holds the shared `formatBytes`/`formatSpeed`/`formatDuration` helpers (decimal units, `--` for unknown).

### URL validation

Always call `isYouTubeUrl(url)` (from `lib/validate.ts`) before passing a URL to yt-dlp. Allowed hosts: `youtube.com`, `www.youtube.com`, `music.youtube.com`, `youtu.be`. `getYouTubeUrlKind(url)` classifies a URL as video and/or playlist (`list=`, excluding `RD*` radio/mix), so a watch+list URL drives both flows in parallel.

### Status cache

`/api/status/route.ts` holds a module-level `cachedStatus`. Bust with `?refresh=1`. `resetStatusCache()` is exported for tests.

### Output + metadata embedding

Downloads go to `~/Documents/MediaDetector` by default via `ensureOutputDir(customDir?)`. The folder is user-configurable: the client reads the default from `GET /api/output-dir` and persists an override in `localStorage` via `hooks/useOutputDir.ts` (rendered by `components/OutputDirRow.tsx`, a global "Save to" row); both download routes forward the chosen `outputDir` in the request body to `ensureOutputDir()`, which uses it only when it is a non-empty absolute path (the validation boundary), else falls back to the default. Both download routes spread `metadataArgs((await checkFfmpeg()).found, ext?)` into the yt-dlp args: with ffmpeg it adds `--embed-metadata --embed-chapters` (all containers) plus `--embed-thumbnail` only for `THUMBNAIL_EXTS` (webm excluded, else yt-dlp errors in postprocessing); without ffmpeg it returns `[]` so downloads still succeed untagged. `checkFfmpeg()` is not cached. `resolveFfmpegDir()` returns the first dir with an ffmpeg binary from repo `bin/` plus (Windows only, guarded by `process.platform`) winget `Links`, choco `bin`, and winget package dirs; when found, routes prepend `ffmpegLocationArgs()` (`--ffmpeg-location`). On macOS it returns null and yt-dlp uses ffmpeg from PATH. The StatusBar ffmpeg row is `warn` (not `error`) when missing.

### Supported platforms (Windows / macOS only)

Linux is **not** supported. The core (Node, yt-dlp, ffmpeg, pip) is portable, but the two spots that branch on `process.platform` handle Windows and macOS only. `openFolderArgs()` in `app/api/open-folder/route.ts` picks `explorer.exe` (Win) / `open` (macOS) and returns `null` on anything else, which the route answers with a 501. `app/api/ffmpeg/install/route.ts` installs via winget/choco (Win) or Homebrew (macOS); on any other platform it prints an "unsupported, install ffmpeg yourself" message without spawning a process.

### Playlist download (per-track, with retry)

`/api/playlist/download/route.ts` first flat-dumps the playlist (`--flat-playlist --dump-single-json` -> `parsePlaylistEntries`) to get each track's video id, then downloads **one yt-dlp process per track** so failures can be retried and skipped individually. `orchestratePlaylist(tracks, download, opts)` in `lib/ytdlp.ts` is the pure, unit-tested (no spawning) two-phase retry engine: phase 1 tries each track up to `attemptsPerPhase` (5), emitting `track-retry` between attempts and `track-skipped` on give-up while the batch continues; phase 2 re-sweeps the skipped tracks up to 5 more times, emitting `track-done` on recovery or `track-error` on final failure; then a `done` summary (`downloaded`/`total`/`failed`). The route injects the real `download` (spawns `runTrack`, whose async-generator RETURN value is the exit code used to tell success from failure) and a `setTimeout`-based `sleep`; a permanently-failing track is attempted up to 10x (bounded by `backoffMs`). `PlaylistPanel` shows per-track `OK`/`ERR`/`a/5` status.

The format is user-selectable via a picker in `PlaylistPanel` (audio: M4A/MP3/Best, or video: 1080p/720p/Best); the request body carries `mode` + `audioFormat`/`videoQuality`, and the pure `playlistFormatArgs(sel, hasFfmpeg)` maps the selection to the yt-dlp `-f`/`-x`/`--merge-output-format` args plus an `expectedExt` that gates `--embed-thumbnail` (so webm/opus output requests no thumbnail -> no stray `.webp` left beside the audio). Audio M4A extracts to a consistent `.m4a` when ffmpeg is present. **The `-f` selector is load-bearing:** YouTube's plain `bestaudio` is opus-in-webm, so `-x --audio-format m4a` without one transcodes every track -- measured at 27s vs 0.4s for 37 minutes of audio, and silent while it runs (yt-dlp swallows ffmpeg's output), which presented as a hung download. `M4A_SOURCE` therefore asks for an AAC source so the extraction is a lossless remux. Its `[audio_channels<=2]` clause matters too: bare `bestaudio[ext=m4a]` selects the 5.1 surround track where one exists (format 258 at 388kbps vs 140's 129kbps), tripling the bytes for something headed to a phone. MP3 uses the same source -- it re-encodes whatever it starts from, and starting from AAC avoids a needless extra generation loss.

Video forces `--merge-output-format mp4` with mp4-preferring selectors. MP3 and all video presets need ffmpeg and are disabled in the UI when it is absent. Files save as `<sanitized playlist title>/<track title>.<ext>` (the folder is built literally via `sanitizeFolderName` since per-track downloads don't populate `%(playlist_title)s`).

### Theme system

macOS/iOS-styled design system. CSS custom properties in `app/globals.css`: `:root` = light tokens (default), `:root[data-theme="dark"]` = dark tokens. Apple system palette -- grouped-background light, true-black dark, fixed systemBlue accent (`#007aff`), SF font stack (`-apple-system, ...`; `app/layout.tsx` loads no webfont so the system font wins). Extra tokens: `--bg-fill` (secondary/segmented-track fill), `--bg-elevated` (selected segment pill), `--radius-*`, `--shadow-pill`/`--shadow-pop`. Components use inline `style` with `var(--token)` -- **never** hardcoded Tailwind color classes; corner radii use Tailwind `rounded-*` classes (cards `rounded-2xl`, rows/inputs `rounded-xl`, action buttons `rounded-full` capsules). The Video/Audio tabs are an iOS segmented control (`FormatTabs`). Light/dark is user-controlled: `hooks/useTheme.ts` stores the mode in `localStorage` (`theme-mode`, try/catch-wrapped) and sets `data-theme` on `<html>`; an inline pre-paint script in `app/layout.tsx` applies the stored (or OS-derived) mode before first paint to avoid a flash. `ThemeButton` is the sun/moon toggle (no accent picker). Keyboard focus is a global `:focus-visible` rule in `globals.css`, declared after the Tailwind layers. It carries **no** `!important`, so a component that sets its own `outline` (a Tailwind `outline-none` class or an inline `outline: 'none'`) silently kills the ring -- don't. Composite fields, where an input shares one bordered box with buttons, take the `.field-shell` class: the ring then goes on the box via `:focus-within` and is suppressed on the inner input. Without that the outline draws around the bare input and shows up as a blue rectangle floating inside the field (this is what `UrlInput` looked like before).

### UI state vocabulary

`components/StatusIcon.tsx` is the one source of status glyphs (`check`/`error`/`warn`/`active`/`idle` filled discs); pass `label` to expose it to assistive tech, omit it for decoration. It backs the dependency rows, the finished-download row, and the playlist track list.

`StatusBar` collapses to a one-line "Ready" summary plus a Recheck button when all three deps are OK, and expands on click; when any row is `error`/`warn` it is force-expanded and the collapse toggle is hidden, since there is an action to take. `buildRows()` derives the summary line and the expanded rows from the same data so they cannot disagree.

Item cards (`FormatRow` -> `DownloadProgress`) keep idle height, expand to phase label + bar + byte counters while active, then replace the bar with a verified check row naming the **real** folder (`parentDir(savedPath)` from `lib/format.ts`, which preserves the input's separator style so Windows and macOS paths both round-trip to `/api/open-folder`). That state persists until the format is downloaded again. `lib/recommend.ts` (`recommendedVideoId`/`recommendedAudioId`, pure) picks the row that gets the "Best" badge and accent border -- highest resolution tie-broken toward mp4 then fps, highest bitrate among iPhone-playable containers.

`PlaylistPanel` caps the track list at `18rem` with `overflow-y-auto` and scrolls the active track into view (`block: 'nearest'`), so a long playlist no longer pushes the progress bar and summary off-screen.

## Testing

Two Jest projects (`jest.config.ts`): `node` for `app/api/**`, `lib/**`, `types/**` (uses `child_process`/`fs`/`os`); `jsdom` for `components/**`, `hooks/**`. Note `lib/format.ts` is UI-facing but lives in the `node` project, which is fine -- it is pure. Put a test in the matching dir or it runs in the wrong environment. Conventions: mock `lib/ytdlp` + `lib/validate` at module level in API tests; use `fireEvent` in component tests; never assert on CSS class names (components use inline `style`).
