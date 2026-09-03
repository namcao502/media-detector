# Media Detector

A native Windows desktop app for detecting and downloading video and audio from
YouTube and YouTube Music.

Paste a URL, pick a format, download. It checks its own runtime dependencies,
detects the available formats, and streams progress per track.

- Single videos: pick any video or audio format, with the best one badged.
- Playlists: pick one format for the batch, download several tracks at once,
  with per-track retry.
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
| ffmpeg | optional | needed to merge video+audio, convert to MP3, and embed metadata/cover art. Needs `ffprobe` beside it or cover art is skipped |
| mutagen | optional | installed with yt-dlp; without it cover art is skipped and files keep the raw YouTube title in their tag |

Only Python has to be installed by hand. The app's dependency panel has an
**Install** button for each of the others and rechecks itself afterwards.

---

## Running it from source

```bash
dotnet build MediaDetector.sln          # build everything
dotnet run --project MediaDetector.App  # run it
```

The app locks its own DLLs while running, so a build started while it is open
fails with MSB3027. Close it first.

---

## Putting it on another PC

Publish a folder, copy the folder, double-click the exe. There is no installer.
Windows x64 only.

### Which build to publish

| | Framework-dependent | Self-contained |
|---|---|---|
| Command | `--self-contained false` | `--self-contained true` |
| Size | ~800 KB, 11 files | ~141 MB, 261 files |
| Target PC needs | .NET 10 Desktop Runtime | nothing |

```bash
# needs the .NET 10 Desktop Runtime on the target PC
dotnet publish MediaDetector.App -c Release -r win-x64 --self-contained false -o publish

# runs anywhere, ships its own runtime
dotnet publish MediaDetector.App -c Release -r win-x64 --self-contained true -o publish
```

`-r win-x64` is required for the self-contained build, and worth keeping on the
other one: it pins the architecture explicitly instead of inheriting whatever
the build machine is. Both commands produce a launchable
`publish\MediaDetector.App.exe`, and `publish/` is gitignored so `-o publish` is
safe to run inside the repo.

For the framework-dependent build, install the runtime on the target with
`winget install Microsoft.DotNet.DesktopRuntime.10`, or from
<https://dotnet.microsoft.com/download/dotnet/10.0>. It must be the **Desktop**
Runtime -- WPF is not in the plain .NET runtime, and with only that installed
the app never opens a window, just a host dialog asking you to install the
desktop runtime.

### Copying it over

Copy the **whole publish folder**, not just `MediaDetector.App.exe` -- the DLLs
next to it are the app. Put it anywhere writable, then run
`MediaDetector.App.exe`.

Two things Windows does to a folder that arrived from elsewhere:

- The exe is unsigned, so SmartScreen shows "Windows protected your PC" on
  first launch. **More info** -> **Run anyway**.
- If it arrived as a zip, unblock the zip *before* extracting (right-click ->
  Properties -> Unblock), or the mark-of-the-web propagates to every extracted
  file. `Unblock-File .\publish\*` fixes it after the fact.

Nothing else transfers. Settings, downloads and logs are all created per-user
on the target machine on first run.

### What the target PC still needs

The runtime decision above only covers .NET. The tools from the Requirements
table are separate, and none of them are bundled:

- **Python 3.8+** -- the only one that has to be installed by hand, and it has
  to be on PATH as `python` or `python3`.
- **yt-dlp, Node.js, ffmpeg** -- the app's dependency panel has an Install
  button for each. They install per-machine, so this is once per PC, not once
  per copy of the app.

To ship ffmpeg with the app instead, drop `ffmpeg.exe` and `ffprobe.exe` into
`vendor/` before publishing. They are copied into a `bin/` folder beside the
published exe, which `ToolResolver` probes ahead of winget's and Chocolatey's
directories. See `vendor/README.md`. Python, Node and yt-dlp cannot be vendored
this way, so a fully offline target still needs those installed first.

---

## Tests

```bash
dotnet test MediaDetector.Core.Tests/MediaDetector.Core.Tests.csproj
```

262 cases, about nine seconds. None of them spawn yt-dlp or touch the network:
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
non-obvious constraints.
