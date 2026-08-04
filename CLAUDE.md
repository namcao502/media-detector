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
| ffmpeg (+ffprobe) | `ffmpeg -version` (also probes `bin/`, winget/choco shim dirs) | In-app button / PATH / vendored `bin/` | Optional |

`/api/status` checks all three, auto-updates yt-dlp, and caches the result; the UI is disabled until Python + yt-dlp are present. Both pip and yt-dlp are invoked as `python -m ...` (via `pipArgs`/`ytdlpArgs` in `lib/ytdlp.ts`) because a fresh python.org install does not put Python's `Scripts` dir on PATH. yt-dlp is updated with `python -m pip install --upgrade yt-dlp mutagen`, not the `yt-dlp -U` self-updater (which refuses for pip installs). `mutagen` is installed alongside yt-dlp (install + update routes and the `/api/status` auto-update) because yt-dlp needs mutagen or AtomicParsley to embed cover art into mp4/m4a; its ffmpeg-only fallback fails there ("Unable to embed using ffprobe & ffmpeg"), producing files with no image data. ffmpeg is optional: downloads work without it, but embedding metadata + cover art needs it.

## Architecture

### Process spawning (`lib/ytdlp.ts`)

- `execArgs(args)` -- user-controlled args (URLs). `spawn`, no shell, injection-safe.
- `execCommand(cmd)` -- fixed internal commands only (e.g. `yt-dlp --version`). **Never** pass user input here.
- `streamCommand(args)` -- async generator; merges stdout+stderr to avoid the 64KB pipe deadlock.

### Streaming responses

Download and install routes return a `ReadableStream` of NDJSON lines; the client reads `res.body.getReader()` and decodes with `new TextDecoder()` (`{ stream: true }` for multi-byte chars across chunks). Download line types (`DownloadStreamLine`): `progress` (`percent`), `done` (`savedPath`), `error` (`message`). Playlist line types: `item`, `progress`, `track-done`, `done`, `error`.

### URL validation

Always call `isYouTubeUrl(url)` (from `lib/validate.ts`) before passing a URL to yt-dlp. Allowed hosts: `youtube.com`, `www.youtube.com`, `music.youtube.com`, `youtu.be`. `getYouTubeUrlKind(url)` classifies a URL as video and/or playlist (`list=`, excluding `RD*` radio/mix), so a watch+list URL drives both flows in parallel.

### Status cache

`/api/status/route.ts` holds a module-level `cachedStatus`. Bust with `?refresh=1`. `resetStatusCache()` is exported for tests.

### Output + metadata embedding

Downloads go to `~/Documents/MediaDetector` via `ensureOutputDir()`. Both download routes spread `metadataArgs((await checkFfmpeg()).found, ext?)` into the yt-dlp args: with ffmpeg it adds `--embed-metadata --embed-chapters` (all containers) plus `--embed-thumbnail` only for `THUMBNAIL_EXTS` (webm excluded, else yt-dlp errors in postprocessing); without ffmpeg it returns `[]` so downloads still succeed untagged. `checkFfmpeg()` is not cached. `resolveFfmpegDir()` returns the first dir with an ffmpeg binary from repo `bin/`, winget `Links`, then choco `bin`; when found, routes prepend `ffmpegLocationArgs()` (`--ffmpeg-location`). The StatusBar ffmpeg row is `warn` (not `error`) when missing.

### Playlist audio download

`/api/playlist/download/route.ts` runs ONE yt-dlp process. `lib/ytdlp.ts` turns its stdout into stream lines via the pure `reducePlaylistLine`/`finalizePlaylist` pair (unit-tested without spawning yt-dlp). Playlist selects `bestaudio[ext=m4a]/bestaudio/best` (prefer m4a so cover art embeds; bare `bestaudio` returns opus-in-webm which cannot hold a thumbnail). Files save as `<playlist title>/<track title>.<ext>`.

### Theme system

macOS/iOS-styled design system. CSS custom properties in `app/globals.css`: `:root` = light tokens (default), `:root[data-theme="dark"]` = dark tokens. Apple system palette -- grouped-background light, true-black dark, fixed systemBlue accent (`#007aff`), SF font stack (`-apple-system, ...`; `app/layout.tsx` loads no webfont so the system font wins). Extra tokens: `--bg-fill` (secondary/segmented-track fill), `--bg-elevated` (selected segment pill), `--radius-*`, `--shadow-pill`/`--shadow-pop`. Components use inline `style` with `var(--token)` -- **never** hardcoded Tailwind color classes; corner radii use Tailwind `rounded-*` classes (cards `rounded-2xl`, rows/inputs `rounded-xl`, action buttons `rounded-full` capsules). The Video/Audio tabs are an iOS segmented control (`FormatTabs`). Light/dark is user-controlled: `hooks/useTheme.ts` stores the mode in `localStorage` (`theme-mode`, try/catch-wrapped) and sets `data-theme` on `<html>`; an inline pre-paint script in `app/layout.tsx` applies the stored (or OS-derived) mode before first paint to avoid a flash. `ThemeButton` is the sun/moon toggle (no accent picker).

## Testing

Two Jest projects (`jest.config.ts`): `node` for `app/api/**`, `lib/**`, `types/**` (uses `child_process`/`fs`/`os`); `jsdom` for `components/**`, `hooks/**`. Put a test in the matching dir or it runs in the wrong environment. Conventions: mock `lib/ytdlp` + `lib/validate` at module level in API tests; use `fireEvent` in component tests; never assert on CSS class names (components use inline `style`).
