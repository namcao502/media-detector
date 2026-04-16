# This is NOT the Next.js you know

This version has breaking changes -- APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.

---

# Project: Media Detector

Next.js 16 App Router app that detects and downloads video/audio from YouTube and YouTube Music using yt-dlp.

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
app/api/status/route.ts       -- GET: Python + yt-dlp health check; cached
app/api/ytdlp/install/route.ts -- POST: pip install yt-dlp (streamed)
app/api/ytdlp/update/route.ts  -- POST: yt-dlp -U (streamed)
app/api/open-folder/route.ts  -- POST: open Documents\MediaDetector in Explorer

lib/ytdlp.ts                  -- all yt-dlp helpers (spawn, parse, output dir)
lib/validate.ts               -- isYouTubeUrl (allowlist: youtube.com, music.youtube.com, youtu.be)

types/media.ts                -- shared types: MediaInfo, VideoFormat, AudioFormat,
                                 StatusResult, DownloadStreamLine

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

---

## Theme System

All colors are CSS custom properties defined in `app/globals.css`:

- `:root` -- light mode defaults
- `@media (prefers-color-scheme: dark)` -- dark overrides

No theme toggle exists. The app follows OS preference automatically.

Components apply tokens via inline `style` props:
```tsx
style={{ background: 'var(--bg-card)', borderColor: 'var(--border)' }}
```

Key tokens: `--bg-page`, `--bg-card`, `--bg-input`, `--border`, `--text-primary`, `--text-secondary`, `--text-muted`, `--accent`, `--status-ok`, `--status-error`, `--status-warn`, `--bg-status-error`, `--bg-status-warn`, and their associated border/text variants.

Do not add hardcoded color classes (`bg-gray-800`, `text-red-300`, etc.). Use tokens.

---

## Testing

Two Jest environments configured:

- `jsdom` -- component tests in `components/__tests__/`
- `node` -- API route tests in `app/api/**/` and `lib/__tests__/`

Run a single file: `npx jest path/to/test --no-coverage`

Run all: `npm test -- --no-coverage`

Type check: `npx tsc --noEmit`

### Test conventions

- API routes: mock `lib/ytdlp` and `lib/validate` at the module level
- Components: use `@testing-library/react`; fire real DOM events with `fireEvent`
- Never assert on exact CSS classes for themed elements -- the component uses inline `style`, not class names
