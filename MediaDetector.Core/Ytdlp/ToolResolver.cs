using System.Runtime.Versioning;

namespace MediaDetector.Core.Ytdlp;

[SupportedOSPlatform("windows")]
public static class ToolResolver
{
    // Pure and testable: which of these dirs holds ALL of the executables.
    public static string? FirstDirWith(IEnumerable<string> dirs, params string[] exeNames) =>
        dirs.FirstOrDefault(d => exeNames.All(exe => File.Exists(Path.Combine(d, exe))));

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

    // Both exes, not just ffmpeg.exe: --ffmpeg-location points yt-dlp at ONE
    // directory and its cover-art embedding runs ffprobe out of it, so a dir
    // holding half the pair is worse than no match at all -- it used to win the
    // race against a complete install further down the candidate list and lose
    // the image with a green status row. Requiring both makes such a dir fall
    // through to the next candidate, or to PATH.
    public static string? ResolveFfmpegDir() =>
        FirstDirWith(FfmpegDirCandidates(), "ffmpeg.exe", "ffprobe.exe");

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
