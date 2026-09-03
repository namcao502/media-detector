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
| yt-dlp | yes | the standalone `yt-dlp.exe`, which bundles its own Python |
| Node.js | yes | yt-dlp needs a JS runtime or YouTube returns HTTP 403 |
| ffmpeg | optional | needed to merge video+audio, convert to MP3, and embed metadata/cover art. Needs `ffprobe` beside it or cover art is skipped |

**The app only looks in its own folder.** All three are plain exes: drop them
into `vendor/` (see `vendor/README.md`) and the app finds them. PATH, winget and
Chocolatey are deliberately ignored, so a tool installed system-wide does not
count -- a green row is meant to mean "this copy of the app can be moved
anywhere", and consulting the machine made it mean something weaker.

Each row that is missing a tool has an **Install** button that downloads it into
the app's own folder -- yt-dlp's release exe, Node's LTS zip, gyan's ffmpeg zip,
unpacked for you. Every row also shows the download link, the exact folder to
copy into, and an **Open folder** button, for when the download cannot get out
(proxy, offline) or you would rather vendor by hand.

Python is not a dependency -- `yt-dlp.exe` carries its own, and tagging is done
in process with TagLib#. The test suite still wants a Python on PATH, for two
encoding regression tests that need one.

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

Nothing, if you vendor the four exes. Drop them into `vendor/` before
publishing and they are copied into a `bin/` folder beside the published exe,
which every resolver probes first:

```
vendor/
  yt-dlp.exe      https://github.com/yt-dlp/yt-dlp/releases/latest
  node.exe        https://nodejs.org/en/download  (the .zip, not the installer)
  ffmpeg.exe      https://www.gyan.dev/ffmpeg/builds/
  ffprobe.exe     (same archive as ffmpeg)
```

That is roughly 270 MB and it is gitignored on purpose -- see
`vendor/README.md`.

**Python is not required.** `yt-dlp.exe` is the standalone build and carries
its own; nothing else in the app needs an interpreter.

Without vendoring, the dependency panel has an Install button per row:
yt-dlp downloads the release exe into `%LOCALAPPDATA%\MediaDetector\bin`, while
Node and ffmpeg go through winget or Chocolatey and install per-machine.

Two things to expect from a vendored `yt-dlp.exe`: Defender may scan or flag it
on first run (it is a PyInstaller bundle), and it unpacks to temp on each
launch, which costs a second or two per track on a playlist. A vendored copy
also never self-updates -- `yt-dlp.exe -U` cannot write into the publish
folder, so replace it by hand when YouTube breaks something.

---

## Tests

```bash
dotnet test MediaDetector.Core.Tests/MediaDetector.Core.Tests.csproj
```

268 cases, about nine seconds. None of them spawn yt-dlp or touch the network:
the process layer, the retry engine and the dependency probes are all injected.
Two encoding tests do spawn a real Python, and one spawns Node to prove the
no-shell guarantee -- those fail loudly rather than skipping, so the suite wants
both on PATH even though the app no longer needs Python at all.

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
