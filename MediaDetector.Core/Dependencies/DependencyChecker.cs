using System.Runtime.Versioning;
using System.Text.RegularExpressions;
using MediaDetector.Core.Diagnostics;
using MediaDetector.Core.Models;
using MediaDetector.Core.Processes;
using MediaDetector.Core.Ytdlp;

namespace MediaDetector.Core.Dependencies;

[SupportedOSPlatform("windows")]
public static class DependencyChecker
{
    // Lazy and awaited, mirroring lib/ytdlp.ts:55's resolvePython(), which probes
    // on every ytdlpArgs() call. A plain static field set only by the status
    // check would hand back "python" on a machine where only python3 works, and
    // also whenever a detect is issued before the status probe completes.
    private static readonly SemaphoreSlim PythonGate = new(1, 1);
    private static string? _cachedPython;

    public static async Task<string> ResolvePythonAsync(CancellationToken ct = default)
    {
        if (_cachedPython != null) return _cachedPython;
        await PythonGate.WaitAsync(ct);
        try
        {
            if (_cachedPython != null) return _cachedPython;
            var (found, _, cmd) = await ProbePythonAsync();
            // Cache ONLY on success. Pinning the "python" fallback would survive a
            // later install and make Recheck unable to recover.
            if (found) _cachedPython = cmd;
            return cmd;
        }
        finally
        {
            PythonGate.Release();
        }
    }

    // Cleared by the Recheck path so a freshly installed Python is picked up.
    public static void ResetPythonCache() => _cachedPython = null;

    // A fresh python.org install has `python` on PATH but often not `python3`.
    public static async Task<(bool Found, string? Version, string Cmd)> ProbePythonAsync()
    {
        foreach (var cmd in new[] { "python", "python3" })
        {
            var result = await ProcessRunner.RunShellAsync($"{cmd} --version");
            if (result.ExitCode == 0)
            {
                var match = Regex.Match(result.Stdout, @"Python ([\d.]+)");
                return (true, match.Success ? match.Groups[1].Value : result.Stdout, cmd);
            }
        }
        // Default so the pip/yt-dlp command surfaces the real error rather than a
        // confusing spawn failure. NOT cached -- a later probe may succeed.
        return (false, null, "python");
    }

    // The `yt-dlp` shim lands in Python's Scripts dir (often off PATH); run the module.
    public static async Task<(bool Found, string? Version)> ProbeYtdlpAsync(string python)
    {
        var result = await ProcessRunner.RunShellAsync($"{python} -m yt_dlp --version");
        return result.ExitCode == 0 ? (true, result.Stdout.Trim()) : (false, null);
    }

    // `yt-dlp -U` refuses for pip/PyPI installs, so update the way it was
    // installed. mutagen embeds cover art into mp4/m4a; without it yt-dlp's
    // ffmpeg-only fallback fails and the file ends up with no image data.
    public static async Task<UpdateStatus> UpdateYtdlpAsync(string python)
    {
        var result = await ProcessRunner.RunShellAsync(
            $"{python} -m pip install --upgrade yt-dlp mutagen");
        if (result.ExitCode != 0) return UpdateStatus.Failed;
        return result.Stdout.Contains("successfully installed", StringComparison.OrdinalIgnoreCase)
            ? UpdateStatus.Updated
            : UpdateStatus.UpToDate;
    }

    // NEW dependency in the desktop port. yt-dlp needs a JS runtime for YouTube's
    // signature/n challenges; the Node-hosted web app supplied one implicitly.
    public static async Task<DependencyState> ProbeNodeAsync()
    {
        var exe = ToolResolver.ResolveNodeExe();
        if (exe == null) return new DependencyState(false, null);
        var result = await ProcessRunner.RunAsync([exe, "--version"]);
        return result.ExitCode == 0
            ? new DependencyState(true, result.Stdout.TrimStart('v'))
            : new DependencyState(false, null);
    }

    // mutagen has no console entry point, so import it rather than probing for an
    // exe. Never installed on its own: it rides along with the pip install of
    // yt-dlp, which means a machine set up before that was added -- or with
    // yt-dlp installed by any other route -- has none.
    private const string MutagenVersionScript = "import mutagen; print(mutagen.version_string)";

    public static async Task<DependencyState> ProbeMutagenAsync(string python)
    {
        var result = await ProcessRunner.RunAsync([python, "-c", MutagenVersionScript]);
        return result.ExitCode == 0
            ? new DependencyState(true, result.Stdout.Trim())
            : new DependencyState(false, null);
    }

    // ResolveFfmpegDir only matches a dir holding BOTH exes, so a null dir here
    // still probes PATH -- where the pair may also be split. Probing ffprobe by
    // running it covers both cases with one code path.
    public static async Task<FfmpegState> ProbeFfmpegAsync()
    {
        var dir = ToolResolver.ResolveFfmpegDir();
        var exe = dir == null ? "ffmpeg" : Path.Combine(dir, "ffmpeg.exe");
        var result = await ProcessRunner.RunAsync([exe, "-version"]);
        if (result.ExitCode != 0) return new FfmpegState(false, null, false);

        var ffprobeExe = dir == null ? "ffprobe" : Path.Combine(dir, "ffprobe.exe");
        var ffprobeResult = await ProcessRunner.RunAsync([ffprobeExe, "-version"]);

        var match = Regex.Match(result.Stdout, @"ffmpeg version (\S+)");
        return new FfmpegState(
            true,
            match.Success ? match.Groups[1].Value : null,
            ffprobeResult.ExitCode == 0);
    }

    // Composed with injectable probes so the ordering rules are unit-testable.
    public static async Task<StatusResult> BuildAsync(
        Func<Task<(bool, string?, string)>> probePython,
        Func<string, Task<(bool, string?)>> probeYtdlp,
        Func<string, Task<UpdateStatus>> updateYtdlp,
        Func<Task<DependencyState>> probeNode,
        Func<Task<FfmpegState>> probeFfmpeg,
        Func<string, Task<DependencyState>> probeMutagen)
    {
        var (pyFound, pyVersion, pyCmd) = await probePython();
        var ytdlp = new YtdlpState(false, null, UpdateStatus.Skipped);
        var mutagen = new DependencyState(false, null);

        if (pyFound)
        {
            var (found, version) = await probeYtdlp(pyCmd);
            ytdlp = found
                ? new YtdlpState(true, version, await updateYtdlp(pyCmd))
                : new YtdlpState(false, null, UpdateStatus.Skipped);

            // Strictly after the update: that pip call installs mutagen alongside
            // yt-dlp, so probing first would report a miss it just repaired.
            mutagen = await probeMutagen(pyCmd);
        }

        // Node and ffmpeg are independent of Python -- probe regardless.
        var node = await probeNode();
        var ffmpeg = await probeFfmpeg();
        AppLog.Info("deps",
            $"python={pyFound}({pyVersion}) ytdlp={ytdlp.Found}({ytdlp.Version}) "
            + $"node={node.Found}({node.Version}) ffmpeg={ffmpeg.Found}({ffmpeg.Version}) "
            + $"ffprobe={ffmpeg.FfprobeFound} mutagen={mutagen.Found}({mutagen.Version})");
        if (!node.Found)
            AppLog.Warn("deps",
                "Node missing: yt-dlp cannot solve YouTube's JS challenges and "
                + "every format URL will answer HTTP 403.");
        // Both of these otherwise present as a clean download with no cover art
        // and, for mutagen, the raw YouTube title left in the tag.
        if (pyFound && !mutagen.Found)
            AppLog.Warn("deps",
                "mutagen missing: cover art cannot be embedded into mp4/m4a and "
                + "the title/artist tag correction will fail on every download.");
        if (ffmpeg.Found && !ffmpeg.FfprobeFound)
            AppLog.Warn("deps",
                "ffprobe missing alongside ffmpeg: cover art cannot be embedded.");
        return new StatusResult(
            new DependencyState(pyFound, pyVersion),
            ytdlp,
            node,
            ffmpeg,
            mutagen);
    }

    public static Task<StatusResult> BuildDefaultAsync() => BuildAsync(
        ProbePythonAsync, ProbeYtdlpAsync, UpdateYtdlpAsync, ProbeNodeAsync, ProbeFfmpegAsync,
        ProbeMutagenAsync);
}
