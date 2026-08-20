# Media Detector

A native Windows desktop app for detecting and downloading video and audio from
YouTube and YouTube Music.

Paste a URL, pick a format, download. It checks its own runtime dependencies,
detects the available formats, and streams progress per track.

- Single videos: pick any video or audio format, with the best one badged.
- Playlists: pick one format for the batch, download several tracks at once,
  with per-track retry and rename.
- Files are named `<title> - <artist>.<ext>`, with an editable preview.
- Metadata and cover art are embedded when ffmpeg is available.

Windows only. Built with WPF on .NET 10.

---

## Requirements

| Tool | Required | Notes |
|------|----------|-------|
| .NET 10 SDK | to build | not needed to run a published build |
| Python 3.8+ | yes | must be on PATH as `python` or `python3` |
| yt-dlp | yes | installed from the app |
| Node.js | yes | installed from the app; yt-dlp needs a JS runtime or YouTube returns HTTP 403 |
| ffmpeg | optional | needed to merge video+audio, convert to MP3, and embed metadata/cover art |

Only Python has to be installed by hand. The app's dependency panel has an
**Install** button for each of the others and rechecks itself afterwards.

---

## Running it

```bash
cd desktop
dotnet run --project MediaDetector.App
```

Or build a release you can launch from Explorer:

```bash
cd desktop
dotnet publish MediaDetector.App -c Release -r win-x64 --self-contained false
```

---

## Tests

```bash
cd desktop
dotnet test MediaDetector.Core.Tests/MediaDetector.Core.Tests.csproj
```

230 cases, about nine seconds. None of them spawn yt-dlp or touch the network:
the process layer, the retry engine and the dependency probes are all injected.

---

## Where things go

- Downloads: `~/Documents/MediaDetector`, changeable in the app.
- Settings: `%LOCALAPPDATA%\MediaDetector\settings.json`
- Logs: `%LOCALAPPDATA%\MediaDetector\logs` (last 10 runs)

The in-app log panel shows the same lines live, including yt-dlp's own output,
which is where the cause of a failed download usually is.

---

## History

This was a Next.js web app until it was rewritten as a desktop application and
the web version removed. `CLAUDE.md` documents the architecture and the
non-obvious constraints; `docs/desktop-rewrite/plan.md` is the rewrite plan.
