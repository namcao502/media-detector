using System.Runtime.Versioning;

namespace MediaDetector.Core.Ytdlp;

[SupportedOSPlatform("windows")]
public static class ToolResolver
{
    // Pure and testable: which of these dirs holds the executable.
    public static string? FirstDirWith(IEnumerable<string> dirs, string exeName) =>
        dirs.FirstOrDefault(d => File.Exists(Path.Combine(d, exeName)));

    // winget installs the Gyan.FFmpeg archive package under
    // Packages/<pkg>/<ffmpeg-ver>/bin/ (nested, versioned) with no Links shim or
    // PATH entry, so that bin dir has to be discovered.
    private static IEnumerable<string> WingetFfmpegBinDirs()
    {
        var local = Environment.GetEnvironmentVariable("LOCALAPPDATA");
        if (string.IsNullOrEmpty(local)) yield break;
        var root = Path.Combine(local, "Microsoft", "WinGet", "Packages");
        if (!Directory.Exists(root)) yield break;

        foreach (var pkg in Directory.EnumerateDirectories(root))
        {
            if (!Path.GetFileName(pkg).Contains("ffmpeg", StringComparison.OrdinalIgnoreCase))
                continue;
            foreach (var sub in Directory.EnumerateDirectories(pkg))
                yield return Path.Combine(sub, "bin");
        }
    }

    // Priority order: app-local bin/, winget's shim dir, Chocolatey's shim dir,
    // then winget's extracted package dirs. Checking these lets a fresh install
    // be picked up without restarting the app, whose PATH snapshot is stale.
    //
    // NOTE: AppContext.BaseDirectory, not the working directory. The TypeScript
    // used process.cwd() (lib/ytdlp.ts:346), which breaks once published.
    public static IEnumerable<string> FfmpegDirCandidates()
    {
        yield return Path.Combine(AppContext.BaseDirectory, "bin");

        var local = Environment.GetEnvironmentVariable("LOCALAPPDATA");
        if (!string.IsNullOrEmpty(local))
            yield return Path.Combine(local, "Microsoft", "WinGet", "Links");

        yield return @"C:\ProgramData\chocolatey\bin";

        foreach (var dir in WingetFfmpegBinDirs()) yield return dir;
    }

    public static string? ResolveFfmpegDir() => FirstDirWith(FfmpegDirCandidates(), "ffmpeg.exe");

    // Point yt-dlp at the resolved dir when found; [] otherwise (falls back to PATH).
    public static string[] FfmpegLocationArgs()
    {
        var dir = ResolveFfmpegDir();
        return dir == null ? [] : ["--ffmpeg-location", dir];
    }

    // yt-dlp needs an ABSOLUTE path for --js-runtimes, so a PATH lookup alone is
    // not enough. winget installs Node to Program Files\nodejs.
    public static IEnumerable<string> NodeDirCandidates()
    {
        var pathVar = Environment.GetEnvironmentVariable("PATH") ?? "";
        foreach (var dir in pathVar.Split(Path.PathSeparator, StringSplitOptions.RemoveEmptyEntries))
            yield return dir;

        yield return @"C:\Program Files\nodejs";
        yield return @"C:\Program Files (x86)\nodejs";

        var local = Environment.GetEnvironmentVariable("LOCALAPPDATA");
        if (!string.IsNullOrEmpty(local))
            yield return Path.Combine(local, "Programs", "nodejs");
    }

    public static string? ResolveNodeExe()
    {
        var dir = FirstDirWith(NodeDirCandidates(), "node.exe");
        return dir == null ? null : Path.Combine(dir, "node.exe");
    }
}
