using System.Runtime.Versioning;
using System.Text.RegularExpressions;
using MediaDetector.Core.Dependencies;
using MediaDetector.Core.Diagnostics;
using MediaDetector.Core.Models;
using MediaDetector.Core.Processes;
using MediaDetector.Core.Validation;
using MediaDetector.Core.Ytdlp;

namespace MediaDetector.Core.Services;

public sealed record Result<T>(bool Ok, T? Value, string? Error)
{
    public static Result<T> Success(T value) => new(true, value, null);
    public static Result<T> Failure(string error) => new(false, default, error);
}

// Replaces app/api/detect and app/api/playlist. Both were thin: validate the
// URL, spawn yt-dlp with execArgs, parse the JSON.
[SupportedOSPlatform("windows")]
public sealed class DetectService(
    Func<IReadOnlyList<string>, CancellationToken, Task<ExecResult>> run,
    Func<string> ytdlpExe,
    Func<string?> nodeExe)
{
    public DetectService() : this(
        (args, ct) => ProcessRunner.RunAsync(args, ct),
        ToolResolver.YtdlpExeOrDefault,
        ToolResolver.ResolveNodeExe)
    { }

    private static readonly Regex ErrorPrefix =
        new(@"^ERROR:\s*", RegexOptions.IgnoreCase | RegexOptions.CultureInvariant);

    private async Task<Result<string>> DumpAsync(
        string url, string[] ytdlpFlags, string fallbackError, CancellationToken ct)
    {
        // Every URL goes through this gate before it can reach yt-dlp.
        if (!YouTubeUrl.IsYouTubeUrl(url))
            return Result<string>.Failure("URL must be a YouTube or YouTube Music link");

        var args = YtdlpArgs.Ytdlp(ytdlpExe(), nodeExe(), ytdlpFlags);
        var result = await run(args, ct);

        if (result.ExitCode != 0 || string.IsNullOrEmpty(result.Stdout))
        {
            var message = string.IsNullOrEmpty(result.Stderr)
                ? fallbackError
                : ErrorPrefix.Replace(result.Stderr, "").Trim();
            // The UI shows one line; the log keeps yt-dlp's full stderr,
            // which is where the actual cause usually is.
            AppLog.Error("detect", $"exit {result.ExitCode}: {result.Stderr}");
            return Result<string>.Failure(message);
        }
        return Result<string>.Success(result.Stdout);
    }

    public async Task<Result<MediaInfo>> DetectVideoAsync(string url, CancellationToken ct = default)
    {
        var dump = await DumpAsync(
            url, ["--dump-json", url, "--no-playlist"], "Failed to fetch media info", ct);
        if (!dump.Ok) return Result<MediaInfo>.Failure(dump.Error!);

        try
        {
            return Result<MediaInfo>.Success(JsonParser.ParseMediaInfo(dump.Value!));
        }
        catch
        {
            return Result<MediaInfo>.Failure("Failed to parse media info");
        }
    }

    // --flat-playlist avoids probing every video's formats, which is what makes
    // detection fast on a 120-track list.
    public async Task<Result<PlaylistInfo>> DetectPlaylistAsync(
        string url, CancellationToken ct = default)
    {
        var dump = await DumpAsync(
            url, ["--flat-playlist", "--dump-single-json", "--yes-playlist", url],
            "Failed to fetch playlist", ct);
        if (!dump.Ok) return Result<PlaylistInfo>.Failure(dump.Error!);

        try
        {
            return Result<PlaylistInfo>.Success(JsonParser.ParsePlaylistInfo(dump.Value!));
        }
        catch
        {
            return Result<PlaylistInfo>.Failure("Failed to parse playlist");
        }
    }

    public async Task<Result<PlaylistDump>> DumpEntriesAsync(
        string url, CancellationToken ct = default)
    {
        var dump = await DumpAsync(
            url, ["--flat-playlist", "--dump-single-json", "--yes-playlist", url],
            "Failed to fetch playlist", ct);
        if (!dump.Ok) return Result<PlaylistDump>.Failure(dump.Error!);

        try
        {
            var (title, entries) = JsonParser.ParsePlaylistEntries(dump.Value!);
            return Result<PlaylistDump>.Success(new PlaylistDump(title, entries));
        }
        catch
        {
            return Result<PlaylistDump>.Failure("Failed to parse playlist");
        }
    }
}

public sealed record PlaylistDump(string Title, IReadOnlyList<PlaylistEntry> Entries);
