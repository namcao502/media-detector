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

    // BaseDirectory, not the working directory, which breaks once published.
    public static string VendorBin => Path.Combine(AppContext.BaseDirectory, "bin");

    // Not called `bin`: MSBuild rewrites VendorBin on every build and would
    // clobber a downloaded copy of the same name, so the two must stay separate.
    public static string DownloadedToolsDir =>
        Path.Combine(Storage.AppPaths.DataRoot, "tools");

    // App-local only -- PATH, winget and Chocolatey were removed on purpose: a
    // system install made a row go green for an app that could not carry it.
    private static IEnumerable<string> AppOwnedToolDirs()
    {
        yield return VendorBin;
        yield return DownloadedToolsDir;
    }

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

    // Where builds before the app went portable downloaded yt-dlp. Read-only
    // candidate, so an upgrade does not force a second download of the same exe.
    private static string LegacyToolsDir =>
        Path.Combine(Storage.AppPaths.LegacyRoot, "bin");

    // Vendored, then downloaded, then the pre-portable location. All three belong
    // to the app; PATH is deliberately absent.
    public static IEnumerable<string> YtdlpDirCandidates() =>
        [.. AppOwnedToolDirs(), LegacyToolsDir];

    public static string? ResolveYtdlpExe()
    {
        var dir = FirstDirWith(YtdlpDirCandidates(), "yt-dlp.exe");
        return dir == null ? null : Path.Combine(dir, "yt-dlp.exe");
    }

    // The path yt-dlp SHOULD occupy, not a bare "yt-dlp.exe" -- a bare name
    // resolves through PATH at spawn time and would quietly reintroduce the
    // system install this model exists to exclude.
    public static string YtdlpExeOrDefault() =>
        ResolveYtdlpExe() ?? Path.Combine(VendorBin, "yt-dlp.exe");

    // yt-dlp needs an ABSOLUTE path for --js-runtimes, so a bare "node" would not
    // do even if PATH were still consulted.
    public static IEnumerable<string> NodeDirCandidates() => AppOwnedToolDirs();

    public static string? ResolveNodeExe()
    {
        var dir = FirstDirWith(NodeDirCandidates(), "node.exe");
        return dir == null ? null : Path.Combine(dir, "node.exe");
    }
}
