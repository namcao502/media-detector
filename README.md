# Media Detector

A Next.js web app for detecting and downloading video and audio from YouTube and YouTube Music.

Paste a URL, pick a format, and download -- the app handles dependency checking, format detection, and streaming progress.

---

## Requirements

- Node.js 18+
- Python 3.8+ (must be on PATH as `python` or `python3`)
- yt-dlp (installed automatically via the app if Python is present)

---

## Getting Started

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

On first load the status bar checks for Python and yt-dlp. If yt-dlp is missing, click **Install** in the status bar to install it via pip. If yt-dlp is outdated it will be updated automatically on startup.

---

## How It Works

1. The status bar checks Python and yt-dlp on page load and caches the result.
2. Paste a YouTube or YouTube Music URL and click **Detect**.
3. The app calls `yt-dlp --dump-json` to fetch metadata and available formats.
4. Select the **Video** or **Audio** tab, choose a format, and click **Download**.
5. Download progress streams in real time. Files are saved to `Documents\MediaDetector`.

---

## Project Structure

```
app/
  page.tsx                    -- main UI
  layout.tsx                  -- root layout, applies theme
  globals.css                 -- CSS color tokens for light + dark theme
  api/
    detect/route.ts           -- POST: fetch media info from a YouTube URL
    download/route.ts         -- POST: stream download progress (NDJSON)
    status/route.ts           -- GET: check Python + yt-dlp, auto-update yt-dlp
    ytdlp/install/route.ts    -- POST: install yt-dlp via pip (streamed output)
    ytdlp/update/route.ts     -- POST: update yt-dlp via yt-dlp -U (streamed output)
    open-folder/route.ts      -- POST: open the download folder in Explorer

components/
  StatusBar.tsx               -- one row per dependency; dot + label + message + action
  UrlInput.tsx                -- URL input form
  MediaInfo.tsx               -- title, channel, duration, thumbnail
  FormatTabs.tsx              -- Video / Audio tab switcher
  FormatRow.tsx               -- single format row with download button and progress
  DownloadProgress.tsx        -- progress bar and "Open Folder" button
  LogPanel.tsx                -- scrollable log output for install/update streams

lib/
  ytdlp.ts                    -- spawn helpers (execArgs, execCommand, streamCommand),
                                 output parsers (parseMediaInfo, parseProgress, parseDestination),
                                 and file utilities (ensureOutputDir)
  validate.ts                 -- isYouTubeUrl: accepts youtube.com and music.youtube.com only

types/
  media.ts                    -- shared TypeScript types (MediaInfo, VideoFormat, AudioFormat,
                                 StatusResult, DownloadStreamLine, etc.)
```

---

## API Reference

### GET /api/status

Returns the current dependency status. Checks Python and yt-dlp, attempts to auto-update yt-dlp, and caches the result.

Add `?refresh=1` to bust the cache.

Response:
```json
{
  "python": { "found": true, "version": "3.12.2" },
  "ytdlp":  { "found": true, "version": "2025.04.15", "updateStatus": "up-to-date" }
}
```

`updateStatus` values: `"updated"` | `"up-to-date"` | `"failed"` | `"skipped"`

---

### POST /api/detect

Body: `{ "url": "<youtube-url>" }`

Returns parsed media metadata including available video and audio formats.

---

### POST /api/download

Body: `{ "url": "...", "formatId": "...", "title": "...", "ext": "..." }`

Streams NDJSON lines:
```
{"type":"progress","percent":42}
{"type":"done","savedPath":"C:\\Users\\...\\Documents\\MediaDetector\\title.mp4"}
{"type":"error","message":"..."}
```

---

### POST /api/ytdlp/install

Streams plain-text pip output. Call after `GET /api/status?refresh=1` to verify the install.

---

### POST /api/ytdlp/update

Same as install but runs `yt-dlp -U`. Streams output.

---

### POST /api/open-folder

Body: `{ "path": "<directory>" }`

Opens the given directory in the system file explorer (Windows Explorer).

---

## Theme

Colors are defined as CSS custom properties in `app/globals.css` and adapt automatically to the OS dark/light preference via `@media (prefers-color-scheme: dark)`. There is no manual toggle.

All components use `var(--token-name)` via inline `style` props or Tailwind arbitrary values.

---

## Development Commands

| Command | Description |
|---------|-------------|
| `npm run dev` | Start dev server at localhost:3000 |
| `npm run build` | Production build |
| `npm start` | Start production server |
| `npm test` | Run all tests (Jest, jsdom + node environments) |
| `npm run test:watch` | Watch mode |
| `npx tsc --noEmit` | Type check without emitting |

---

## Tech Stack

| Layer | Choice |
|-------|--------|
| Framework | Next.js 16 (App Router) |
| UI | React 19 |
| Styling | Tailwind CSS v4 + CSS custom properties |
| Language | TypeScript 5 (strict) |
| Testing | Jest 30, @testing-library/react |
| Media tool | yt-dlp (external, Python-based) |
