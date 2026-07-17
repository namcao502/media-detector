# bin/ -- optional vendored ffmpeg

Drop `ffmpeg` and `ffprobe` here to enable metadata embedding without a
system-wide install. The app auto-detects them (via `bundledFfmpegDir()` in
`lib/ytdlp.ts`) and passes `--ffmpeg-location ./bin` to yt-dlp.

- Windows: `ffmpeg.exe` and `ffprobe.exe`
- macOS/Linux: `ffmpeg` and `ffprobe`

You need **both** binaries -- `ffprobe` is required to embed cover art.

Get a build from https://ffmpeg.org/download.html (on Windows, the Gyan
"essentials" or "full" build includes both exes).

If `bin/` has no `ffmpeg`, the app falls back to `ffmpeg` on your system PATH.

The binaries are gitignored by default (they are large, ~100 MB). To make the
repo fully self-contained, remove the `bin/` rules from `.gitignore` and commit
them -- but note that bloats the git history.
