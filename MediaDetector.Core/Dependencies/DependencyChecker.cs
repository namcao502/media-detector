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
    // The standalone build carries its own Python, so the exe is the whole
    // command -- there is no interpreter left to resolve.
    public static async Task<(bool Found, string? Version, string? Path)> ProbeYtdlpAsync()
    {
        var exe = ToolResolver.ResolveYtdlpExe();
        if (exe == null) return (false, null, null);
        var result = await ProcessRunner.RunAsync([exe, "--version"]);
        return result.ExitCode == 0 ? (true, result.Stdout.Trim(), exe) : (false, null, exe);
    }

    // `-U` works for the standalone build; it is only the pip install that
    // refuses, which is what this used to be.
    public static async Task<UpdateStatus> UpdateYtdlpAsync()
    {
        var exe = ToolResolver.ResolveYtdlpExe();
        if (exe == null) return UpdateStatus.Failed;

        var result = await ProcessRunner.RunAsync([exe, "-U"]);
        if (result.ExitCode != 0) return UpdateStatus.Failed;
        return result.Stdout.Contains("Updated yt-dlp", StringComparison.OrdinalIgnoreCase)
            ? UpdateStatus.Updated
            : UpdateStatus.UpToDate;
    }

    // yt-dlp needs a JS runtime for YouTube's signature/n challenges; the
    // Node-hosted web app supplied one implicitly.
    public static async Task<DependencyState> ProbeNodeAsync()
    {
        var exe = ToolResolver.ResolveNodeExe();
        if (exe == null) return new DependencyState(false, null);
        var result = await ProcessRunner.RunAsync([exe, "--version"]);
        return result.ExitCode == 0
            ? new DependencyState(true, result.Stdout.TrimStart('v'), exe)
            : new DependencyState(false, null, exe);
    }

    // No PATH fallback: a system ffmpeg would turn the row green for a copy of
    // the app that cannot carry it anywhere.
    public static async Task<FfmpegState> ProbeFfmpegAsync()
    {
        var dir = ToolResolver.ResolveFfmpegDir();
        if (dir == null) return new FfmpegState(false, null, false);

        var result = await ProcessRunner.RunAsync([Path.Combine(dir, "ffmpeg.exe"), "-version"]);
        if (result.ExitCode != 0) return new FfmpegState(false, null, false, dir);

        var ffprobeResult = await ProcessRunner.RunAsync(
            [Path.Combine(dir, "ffprobe.exe"), "-version"]);

        var match = Regex.Match(result.Stdout, @"ffmpeg version (\S+)");
        return new FfmpegState(
            true,
            match.Success ? match.Groups[1].Value : null,
            ffprobeResult.ExitCode == 0,
            dir);
    }

    // Composed with injectable probes so the ordering rules are unit-testable.
    public static async Task<StatusResult> BuildAsync(
        Func<Task<(bool, string?, string?)>> probeYtdlp,
        Func<Task<UpdateStatus>> updateYtdlp,
        Func<Task<DependencyState>> probeNode,
        Func<Task<FfmpegState>> probeFfmpeg)
    {
        var (found, version, path) = await probeYtdlp();
        var ytdlp = found
            ? new YtdlpState(true, version, await updateYtdlp(), path)
            : new YtdlpState(false, null, UpdateStatus.Skipped, path);

        var node = await probeNode();
        var ffmpeg = await probeFfmpeg();

        // Paths, not just versions: which copy answered is the whole question
        // when the app is meant to be portable.
        AppLog.Info("deps",
            $"ytdlp={ytdlp.Found}({ytdlp.Version}) @ {ytdlp.Path ?? "-"} | "
            + $"node={node.Found}({node.Version}) @ {node.Path ?? "-"} | "
            + $"ffmpeg={ffmpeg.Found}({ffmpeg.Version}) ffprobe={ffmpeg.FfprobeFound} "
            + $"@ {ffmpeg.Dir ?? "PATH"}");
        if (!node.Found)
            AppLog.Warn("deps",
                "Node missing: yt-dlp cannot solve YouTube's JS challenges and "
                + "every format URL will answer HTTP 403.");
        // Presents as a clean download with no cover art, so it needs saying.
        if (ffmpeg.Found && !ffmpeg.FfprobeFound)
            AppLog.Warn("deps",
                "ffprobe missing alongside ffmpeg: cover art cannot be embedded.");
        return new StatusResult(ytdlp, node, ffmpeg);
    }

    public static Task<StatusResult> BuildDefaultAsync() => BuildAsync(
        ProbeYtdlpAsync, UpdateYtdlpAsync, ProbeNodeAsync, ProbeFfmpegAsync);
}
