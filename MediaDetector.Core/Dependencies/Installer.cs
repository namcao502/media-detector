using System.Runtime.CompilerServices;
using System.Runtime.Versioning;
using MediaDetector.Core.Processes;
using MediaDetector.Core.Ytdlp;

namespace MediaDetector.Core.Dependencies;

// Installs the runtime dependencies, streaming progress as plain text lines the
// UI shows in its log panel. Windows only -- the macOS Homebrew branch from
// app/api/ffmpeg/install/route.ts is deliberately gone.
[SupportedOSPlatform("windows")]
public static class Installer
{
    // mutagen is installed alongside yt-dlp: yt-dlp needs it (or AtomicParsley)
    // to embed cover art into mp4/m4a, and its ffmpeg-only fallback fails there,
    // producing files with no image data.
    public static string[] YtdlpInstallArgs(string python) =>
        YtdlpArgs.Pip(python, ["install", "yt-dlp", "mutagen"]);

    public static string[] YtdlpUpdateArgs(string python) =>
        YtdlpArgs.Pip(python, ["install", "--upgrade", "yt-dlp", "mutagen"]);

    public static string[] WingetArgs(string packageId) =>
    [
        "winget", "install", "--id", packageId, "-e",
        "--accept-package-agreements", "--accept-source-agreements",
        "--disable-interactivity",
    ];

    public static IAsyncEnumerable<string> InstallYtdlpAsync(
        string python, CancellationToken ct = default) =>
        LineStream.StreamAsync(YtdlpInstallArgs(python), ct);

    public static IAsyncEnumerable<string> UpdateYtdlpAsync(
        string python, CancellationToken ct = default) =>
        LineStream.StreamAsync(YtdlpUpdateArgs(python), ct);

    public static IAsyncEnumerable<string> InstallFfmpegAsync(CancellationToken ct = default) =>
        InstallViaPackageManagerAsync(
            "ffmpeg", "Gyan.FFmpeg", ["choco", "install", "ffmpeg", "-y"],
            "Install ffmpeg manually from https://www.gyan.dev/ffmpeg/builds/ "
            + "(or drop ffmpeg.exe + ffprobe.exe into the app's bin/ folder).", ct);

    public static IAsyncEnumerable<string> InstallNodeAsync(CancellationToken ct = default) =>
        InstallViaPackageManagerAsync(
            "Node.js", "OpenJS.NodeJS.LTS", ["choco", "install", "nodejs-lts", "-y"],
            "Install Node.js manually from https://nodejs.org/en/download", ct);

    private static async IAsyncEnumerable<string> InstallViaPackageManagerAsync(
        string label,
        string wingetId,
        string[] chocoArgs,
        string manualHint,
        [EnumeratorCancellation] CancellationToken ct)
    {
        string[]? args = null;

        if ((await ProcessRunner.RunShellAsync("winget --version", ct)).ExitCode == 0)
        {
            yield return $"Installing {label} via winget ({wingetId})...";
            args = WingetArgs(wingetId);
        }
        else if ((await ProcessRunner.RunShellAsync("choco --version", ct)).ExitCode == 0)
        {
            yield return $"Installing {label} via Chocolatey...";
            args = chocoArgs;
        }
        else
        {
            yield return "Neither winget nor Chocolatey was found.";
            yield return manualHint;
        }

        if (args != null)
        {
            await foreach (var line in LineStream.StreamAsync(args, ct)) yield return line;
            yield return $"Done. If the {label} row stays red, click Recheck to pick it up.";
        }
    }
}
