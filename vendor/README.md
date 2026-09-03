# vendor/ -- ship the tools inside the build

This folder is a **build-time** drop point. `MediaDetector.App.csproj` copies
`vendor/*.exe` into a `vendor/` subfolder next to the built executable, and that
copy is what `ToolResolver` reads. The in-app Install buttons download into the
same folder, so there is exactly one place tools live at runtime.

## You usually do not need this

The app's **Install** buttons download the same binaries into `<app>/vendor` at
runtime. On a machine with internet that is all you need, and this folder can
stay empty.

Fill it when you want the published folder to already contain everything:

- the target PC has no internet, or a proxy blocks GitHub / nodejs.org / gyan.dev
- you are handing someone a zip that must work with no buttons pressed
- you want to pin exact versions rather than take whatever is current

## Where things end up

Everything lands in `<app>/vendor`, filled from two directions:

| Source | When |
|---|---|
| MSBuild, from this folder | every build |
| the in-app Install buttons | when you click them |

They coexist because `PreserveNewest` compares timestamps: a file downloaded
after a build survives the next one, and a copy you deliberately refresh here
wins instead. Whichever is newer is the live one.

PATH, winget and Chocolatey are deliberately not consulted: a tool installed on
the build machine does not travel with the app, so counting it would make a
green status row mean something weaker than "this copy is portable".

| File | Required | Where to get it |
|------|----------|-----------------|
| `yt-dlp.exe` | Yes | https://github.com/yt-dlp/yt-dlp/releases/latest |
| `node.exe` | Yes | https://nodejs.org/en/download -- take the **zip**, not the installer; `node.exe` inside it runs standalone |
| `ffmpeg.exe` | Optional | https://www.gyan.dev/ffmpeg/builds/ (Gyan "essentials" or "full") |
| `ffprobe.exe` | Optional | Same archive as ffmpeg |

## Notes per tool

**yt-dlp** is the standalone build, which bundles its own Python -- that is why
the app has no Python dependency. Two consequences: Defender may flag it (it is
a PyInstaller bundle), and it unpacks to temp on every launch, costing a second
or two per spawn. A playlist spawns one per track.

A vendored copy never self-updates: `yt-dlp.exe -U` usually cannot write into
the publish folder, and the in-app Install button downloads into the app's data
folder, which loses to this one in the resolver order. Replace it here by hand
when YouTube breaks something.

**Node** is required, not optional. yt-dlp needs a JavaScript runtime to solve
YouTube's signature and `n` challenges; without one every format URL answers
HTTP 403 and the only trace left on disk is a stray image file. Take `node.exe`
out of the official zip -- it runs standalone, nothing else in that archive is
needed.

**ffmpeg needs both binaries.** `--ffmpeg-location` points yt-dlp at one
directory, and `ResolveFfmpegDir` deliberately refuses a directory holding only
`ffmpeg.exe` -- a half-populated folder used to win the lookup and then silently
drop the cover art behind a green status row. Without ffmpeg the app still
downloads; it just cannot merge video+audio, convert to MP3, or embed metadata,
chapters and cover art.

## Do not commit these

The binaries are gitignored (`vendor/*.exe`) and total roughly 270 MB. Adding a
`!vendor/ffmpeg.exe` style exception would bloat the history permanently and is
not recoverable.
