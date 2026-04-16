# Media Detector -- Design Spec

**Date:** 2026-04-16
**Status:** Approved

## Overview

A personal web app UI that accepts a YouTube or YouTube Music URL, detects all available media streams (video and audio), and saves downloads directly to `Documents\MediaDetector` on the host machine.

## Scope

- Supported sources: YouTube (`youtube.com/watch`) and YouTube Music (`music.youtube.com`)
- Media detection: network-level streams via yt-dlp (not HTML scraping)
- Output: display available formats, allow download of any format

## Stack

- **Framework:** Next.js 15 (App Router), TypeScript
- **Styling:** Tailwind CSS, dark theme
- **Media extraction:** yt-dlp CLI (must be installed; Python required)
- **Runtime requirement:** Python 3.x + yt-dlp installed on the host machine

## UI Design

### Layout

Single-page app with three main zones:

1. **Status bar** (top) -- dependency check results with action buttons
2. **URL input** -- text field + Detect button
3. **Results panel** -- media info card + tabbed format list (Video / Audio tabs)

### Status Bar

Runs on page load by calling `GET /api/status`. Displays one of:

| State | Color | Button |
|-------|-------|--------|
| All dependencies OK | Green | None |
| Python not found | Red | "Install Python" (opens python.org/downloads in new tab) |
| yt-dlp not installed | Red | "Install" (calls POST /api/ytdlp/install) |
| yt-dlp updated | Green | None |
| yt-dlp update failed | Yellow | "Retry" |

The URL input and Detect button are **disabled** until all checks pass.

### Results Panel

Shown after a successful Detect call:

- **Info card:** thumbnail, title, channel, duration, view count
- **Video tab:** format rows sorted by resolution descending -- each row shows resolution badge, container, codec, framerate, file size, Download button
- **Audio tab:** format rows sorted by bitrate descending -- each row shows bitrate, container, codec, file size, Download button

### Download Flow

When Download is triggered on a format row:
- Button shows a progress bar with percentage (parsed from yt-dlp's `[download] XX.X%` stdout)
- yt-dlp saves directly to `%USERPROFILE%\Documents\MediaDetector\<title>.<ext>` (folder auto-created if missing)
- On completion: row shows "Saved to Documents\MediaDetector" with an "Open Folder" button
- "Open Folder" calls `POST /api/open-folder` which runs `explorer.exe <path>` on Windows

### Install/Update Flow

When Install or Update is triggered:
- Button shows spinner
- A collapsible log panel streams live output from the pip/yt-dlp process
- On completion, status bar re-queries `/api/status` and refreshes

## API Routes

### `GET /api/status`

Runs once per server start (cached). Checks in order:

1. `python --version` (falls back to `python3 --version`)
2. `yt-dlp --version`
3. `yt-dlp -U` (only if yt-dlp found)

Returns:
```json
{
  "python": { "found": true, "version": "3.12.2" },
  "ytdlp": { "found": true, "version": "2025.04.15", "updateStatus": "updated" }
}
```

`updateStatus` values: `"updated"` | `"up-to-date"` | `"failed"` | `"skipped"`

### `POST /api/ytdlp/install`

Runs `pip install yt-dlp`. Streams stdout/stderr as newline-delimited text (for live log display). Returns 200 on success, 500 on failure.

### `POST /api/ytdlp/update`

Runs `yt-dlp -U`. Streams output. Returns 200 on success, 500 on failure.

### `POST /api/detect`

Request: `{ "url": "https://www.youtube.com/watch?v=..." }`

Validation:
- URL must match `youtube.com/watch` or `music.youtube.com/watch`
- Rejects all other domains with a 400 error

Execution: `yt-dlp --dump-json <url> --no-playlist`

Response:
```json
{
  "title": "Never Gonna Give You Up",
  "channel": "Rick Astley",
  "duration": 212,
  "thumbnail": "https://...",
  "videoFormats": [
    { "formatId": "137", "ext": "mp4", "width": 1920, "height": 1080, "fps": 30, "vcodec": "avc1", "filesize": 2400000000 }
  ],
  "audioFormats": [
    { "formatId": "140", "ext": "m4a", "abr": 128, "acodec": "mp4a", "filesize": 48000000 }
  ]
}
```

### `POST /api/download`

Request: `{ "url": "...", "formatId": "137", "title": "Never Gonna Give You Up", "ext": "mp4" }`

Execution: `yt-dlp -f <formatId> <url> -o "<outputDir>/%(title)s.%(ext)s" --no-playlist`

- Output directory: `%USERPROFILE%\Documents\MediaDetector` (resolved at runtime; created if missing)
- Streams yt-dlp's progress output back as newline-delimited text so the UI can show a live progress bar
- Parses `[download] XX.X%` lines to extract percentage
- On completion, returns `{ "savedPath": "C:\\Users\\...\\Documents\\MediaDetector\\title.mp4" }`

### `POST /api/open-folder`

Request: `{ "path": "C:\\Users\\...\\Documents\\MediaDetector" }`

- Runs `explorer.exe <path>` on Windows to open the folder in File Explorer
- Returns 200 on success

## Error Handling

| Error | Response |
|-------|----------|
| URL not YouTube/YT Music | 400: "URL must be a YouTube or YouTube Music link" |
| Video unavailable/private | 422: message extracted from yt-dlp stderr |
| yt-dlp not found | 503: "yt-dlp is not installed" |
| Python not found | 503: "Python is not installed" |
| Download folder not writable | 500: "Cannot write to Documents\MediaDetector" |
| Download interrupted | Partial file left on disk; no automatic cleanup |

## File Structure

```
media-detector/
  app/
    page.tsx                  # Main page (status bar + URL input + results)
    layout.tsx                # Root layout, dark theme
    api/
      status/route.ts         # GET /api/status
      detect/route.ts         # POST /api/detect
      download/route.ts       # POST /api/download
      open-folder/route.ts    # POST /api/open-folder
      ytdlp/
        install/route.ts      # POST /api/ytdlp/install
        update/route.ts       # POST /api/ytdlp/update
  components/
    StatusBar.tsx             # Dependency status + action buttons
    UrlInput.tsx              # URL field + Detect button
    MediaInfo.tsx             # Thumbnail, title, metadata card
    FormatTabs.tsx            # Video/Audio tab switcher
    FormatRow.tsx             # Single format row with Download button + progress bar
    DownloadProgress.tsx      # Progress bar + "Open Folder" button shown during/after download
    LogPanel.tsx              # Streaming log output for install/update
  lib/
    ytdlp.ts                  # Shell wrapper: exec, stream, parse output
    validate.ts               # URL validation logic
  types/
    media.ts                  # TypeScript types for formats, status, etc.
```

## Constraints and Notes

- yt-dlp must be on the system PATH; no bundled binary
- Downloads are saved directly to disk by yt-dlp -- the Next.js server only streams progress text, not the media file itself
- Output folder: `%USERPROFILE%\Documents\MediaDetector` (Windows); auto-created on first download
- No database, no auth, no persistence -- stateless personal tool
- No playlist support -- `--no-playlist` flag enforced
- Windows-only for the "Open Folder" feature (`explorer.exe`); on other platforms the button is hidden
