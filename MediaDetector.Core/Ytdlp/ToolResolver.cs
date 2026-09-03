using System.Runtime.Versioning;

namespace MediaDetector.Core.Ytdlp;

[SupportedOSPlatform("windows")]
public static class ToolResolver
{
    // Smaller than any real PE this app looks for; the pip-installed yt-dlp shim,
    // the smallest of them, is still ~100 KB.
    private const int MinExecutableBytes = 1024;

    // File.Exists is not enough: a placeholder or a half-finished download passes
    // it and then wins the lookup, because the vendored folder is probed first.
    public static bool IsExecutable(string path)
    {
        try
        {
            using var stream = File.OpenRead(path);
            if (stream.Length < MinExecutableBytes)
            {
                return false;
            }

            return stream.ReadByte() == 'M' && stream.ReadByte() == 'Z';
        }
        catch
        {
            // Missing, locked, or unreadable -- unusable either way.
            return false;
        }
    }

    // Pure and testable: which of these dirs holds ALL of the executables, as
    // real executables rather than merely as filenames.
    public static string? FirstDirWith(IEnumerable<string> dirs, params string[] exeNames) =>
        dirs.FirstOrDefault(d => exeNames.All(exe => IsExecutable(Path.Combine(d, exe))));

    // One folder for every tool, vendored or downloaded. MSBuild copies
    // vendor/*.exe here and the Install buttons write here too: PreserveNewest
    // compares timestamps, so a fresh download is never clobbered by a build, and
    // a deliberately updated vendor/ copy does win. Verified both directions.
    //
    // BaseDirectory, not the working directory, which breaks once published.
    public static string VendorDir => Storage.AppPaths.AppLocalOrFallback("vendor");

    // The shipped copy stays readable even when the app folder is not writable
    // (an install under Program Files), where VendorDir points at LOCALAPPDATA.
    private static string ShippedVendorDir => Path.Combine(AppContext.BaseDirectory, "vendor");

    // App-local only -- PATH, winget and Chocolatey were removed on purpose: a
    // system install made a row go green for an app that could not carry it.
    private static IEnumerable<string> AppOwnedToolDirs() =>
        new[] { ShippedVendorDir, VendorDir }.Distinct(StringComparer.OrdinalIgnoreCase);

    public static IEnumerable<string> FfmpegDirCandidates() => AppOwnedToolDirs();

    // Both exes: --ffmpeg-location points at ONE directory, so a dir holding half
    // the pair is worse than no match and must fall through to the next candidate.
    public static string? ResolveFfmpegDir() =>
        FirstDirWith(FfmpegDirCandidates(), "ffmpeg.exe", "ffprobe.exe");

    // [] when nothing is vendored. yt-dlp would then fall back to PATH on its
    // own, which we cannot prevent -- but FormatArgs.Metadata is already gated on
    // the probe saying ffmpeg is absent, so nothing that needs it gets requested.
    public static string[] FfmpegLocationArgs()
    {
        var dir = ResolveFfmpegDir();
        return dir == null ? [] : ["--ffmpeg-location", dir];
    }

    public static IEnumerable<string> YtdlpDirCandidates() => AppOwnedToolDirs();

    public static string? ResolveYtdlpExe()
    {
        var dir = FirstDirWith(YtdlpDirCandidates(), "yt-dlp.exe");
        return dir == null ? null : Path.Combine(dir, "yt-dlp.exe");
    }

    // The path yt-dlp SHOULD occupy, not a bare "yt-dlp.exe" -- a bare name
    // resolves through PATH at spawn time and would quietly reintroduce the
    // system install this model exists to exclude.
    public static string YtdlpExeOrDefault() =>
        ResolveYtdlpExe() ?? Path.Combine(VendorDir, "yt-dlp.exe");

    // yt-dlp needs an ABSOLUTE path for --js-runtimes, so a bare "node" would not
    // do even if PATH were still consulted.
    public static IEnumerable<string> NodeDirCandidates() => AppOwnedToolDirs();

    public static string? ResolveNodeExe()
    {
        var dir = FirstDirWith(NodeDirCandidates(), "node.exe");
        return dir == null ? null : Path.Combine(dir, "node.exe");
    }
}
