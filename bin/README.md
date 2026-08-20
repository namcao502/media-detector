# bin/ -- optional vendored ffmpeg

Drop `ffmpeg.exe` and `ffprobe.exe` here to enable metadata and cover-art
embedding without a system-wide install.

`MediaDetector.App.csproj` copies `bin/*.exe` next to the built executable, and
`ToolResolver.ResolveFfmpegDir()` probes that copy first, then winget's and
Chocolatey's shim directories. When it finds one it passes
`--ffmpeg-location <dir>` to yt-dlp; otherwise yt-dlp uses whatever is on PATH.

You need **both** binaries -- `ffprobe` is required to embed cover art.

Get a build from https://ffmpeg.org/download.html (the Gyan "essentials" or
"full" build includes both exes). The in-app **Install** button on the ffmpeg
row does this for you via winget or Chocolatey, so vendoring here is only for
keeping the app self-contained or working offline.

Without ffmpeg the app still downloads; it just cannot merge video+audio,
convert to MP3, or embed metadata and cover art.

The binaries are gitignored (they are large, ~100 MB). To commit them anyway,
add a `!bin/ffmpeg.exe` style exception in `.gitignore` -- but note that bloats
the history permanently.
