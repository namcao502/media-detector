# This is NOT the Next.js you know

This version has breaking changes -- APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.

---

# Project: Media Detector

Next.js 16 App Router app that detects and downloads video/audio from YouTube and YouTube Music using yt-dlp.

---

## Commands

```bash
npm run dev      # dev server (Turbopack), http://localhost:3000
npm run build    # production build
npm start        # serve production build
npm test         # all tests (see Testing below for single-file + typecheck)
```

---

## External Dependencies

The app requires two external tools at runtime:

| Tool | Check | Install |
|------|-------|---------|
| Python 3.8+ | `python --version` or `python3 --version` | Manual -- user installs from python.org |
| yt-dlp | `yt-dlp --version` | Automatic -- app installs via `pip install yt-dlp` |

The `/api/status` route checks both on startup, auto-updates yt-dlp, and caches the result. The UI is disabled until both are present.

---

## Key Files

```
app/globals.css               -- all CSS color tokens (light + dark)
app/layout.tsx                -- root layout
app/page.tsx                  -- main page (client component)

app/api/detect/route.ts       -- POST: media info via yt-dlp --dump-json
app/api/download/route.ts     -- POST: streaming download, emits NDJSON
app/api/playlist/route.ts          -- POST: playlist metadata via --flat-playlist --dump-single-json
app/api/playlist/download/route.ts -- POST: streaming playlist audio download, emits NDJSON
app/api/status/route.ts       -- GET: Python + yt-dlp health check; cached
app/api/ytdlp/install/route.ts -- POST: pip install yt-dlp (streamed)
app/api/ytdlp/update/route.ts  -- POST: yt-dlp -U (streamed)
app/api/open-folder/route.ts  -- POST: open Documents\MediaDetector in Explorer

lib/ytdlp.ts                  -- all yt-dlp helpers (spawn, parse, output dir)
lib/validate.ts               -- isYouTubeUrl (allowlist: youtube.com, music.youtube.com, youtu.be)

types/media.ts                -- shared types: MediaInfo, VideoFormat, AudioFormat,
                                 StatusResult, DownloadStreamLine

hooks/useTheme.ts             -- accent-color + rainbow theme controls (see Theme System)

components/ThemeButton.tsx    -- accent preset picker + rainbow toggle (uses useTheme)
components/PlaylistPanel.tsx  -- playlist track list + "Download all audio" + overall/per-track progress
components/StatusBar.tsx      -- one row per dep: dot + label + message + optional action button
components/UrlInput.tsx       -- URL form
components/MediaInfo.tsx      -- thumbnail, title, channel, duration
components/FormatTabs.tsx     -- Video / Audio tabs
components/FormatRow.tsx      -- single format with Download button + progress
components/DownloadProgress.tsx -- progress bar + "Open Folder" button
components/LogPanel.tsx       -- scrollable install/update log output
```

---

## Architecture Patterns

### Spawning processes

- `execArgs(args: string[])` -- use for user-controlled args (e.g. URLs). Uses `spawn`, no shell, prevents injection.
- `execCommand(cmd: string)` -- use for fixed internal commands only (e.g. `yt-dlp --version`).
- `streamCommand(args: string[])` -- async generator; merges stdout + stderr to avoid 64KB pipe deadlock.

Never pass user input to `execCommand`. Always use `execArgs` or `streamCommand` when any argument comes from user input.

### Streaming responses

Download and install endpoints return a `ReadableStream` with NDJSON lines. The client reads via `res.body.getReader()` and decodes with `new TextDecoder()` (pass `{ stream: true }` to handle multi-byte chars across chunks).

Download stream line types (`DownloadStreamLine`):
- `{ type: 'progress', percent: number }`
- `{ type: 'done', savedPath: string }`
- `{ type: 'error', message: string }`

### URL validation

Always call `isYouTubeUrl(url)` before passing a URL to yt-dlp. Accepted hosts: `youtube.com`, `www.youtube.com`, `music.youtube.com`, `youtu.be`.

### Status cache

`/api/status/route.ts` holds a module-level `cachedStatus` variable. Add `?refresh=1` to bust it. The exported `resetStatusCache()` is used in tests.

### Output directory

Downloads go to `~/Documents/MediaDetector`. Use `ensureOutputDir()` from `lib/ytdlp.ts` -- it creates the dir if missing and returns the path.

### Playlist audio download

`getYouTubeUrlKind(url)` in `lib/validate.ts` classifies a URL as video and/or playlist (`list=` param, excluding `RD*` radio/mix). The page fires `/api/detect` and `/api/playlist` in parallel, so a watch+list URL shows both flows. Playlist download runs ONE yt-dlp process (`-f bestaudio/best --yes-playlist --ignore-errors`, no ffmpeg -- files keep their source container); `lib/ytdlp.ts` turns its stdout into stream lines via the pure `reducePlaylistLine`/`finalizePlaylist` pair (unit-tested without spawning yt-dlp). Playlist stream line types: `item`, `progress`, `track-done`, `done`, `error`.

---

## Theme System

CSS custom properties in `app/globals.css`: `:root` (light) + `@media (prefers-color-scheme: dark)`. Light/dark follows the OS.

Components use inline `style` props with `var(--token)`. Never use hardcoded Tailwind color classes (`bg-gray-800`, `text-red-300`, etc.).

Key tokens: `--bg-page`, `--bg-card`, `--bg-input`, `--border`, `--text-primary`, `--text-secondary`, `--text-muted`, `--accent`, `--status-ok`, `--status-error`, `--status-warn`, plus `--bg-status-{error,warn}`, `--border-status-{error,warn}`, `--text-status-{error,warn}(-title)`.

### Accent theming (`hooks/useTheme.ts`)

`useTheme()` lets the user override the accent color at runtime; `ThemeButton` is the UI. It does NOT edit `globals.css` -- it sets inline vars on `document.documentElement`, so those win over the stylesheet:

- Derives `--accent`, `--accent-hover`, and the `--bg-*`/`--border` tokens from one hex accent (HSL math), recomputed for the current light/dark mode.
- Rainbow mode (default on) animates the hue via `requestAnimationFrame`; a preset click turns it off.
- Persists to `localStorage` (`theme-accent`, `theme-rainbow`); storage writes are wrapped in try/catch (private browsing / quota).

---

## Testing

Two Jest projects (`jest.config.ts`): `jsdom` for `components/**` + `hooks/**`, `node` for `app/api/**`, `lib/**`, and `types/**`. Put a test in the right dir or it runs in the wrong environment.

```bash
npx jest path/to/test --no-coverage  # single file
npm test -- --no-coverage            # all
npx tsc --noEmit                     # typecheck
```

Conventions: mock `lib/ytdlp` + `lib/validate` at module level in API tests. Use `fireEvent` in component tests. Never assert on CSS class names -- components use inline `style`.
