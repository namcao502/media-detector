using System.Runtime.CompilerServices;
using System.Runtime.Versioning;
using MediaDetector.Core.Dependencies;
using MediaDetector.Core.Diagnostics;
using MediaDetector.Core.Models;
using MediaDetector.Core.Naming;
using MediaDetector.Core.Processes;
using MediaDetector.Core.Storage;
using MediaDetector.Core.Validation;
using MediaDetector.Core.Ytdlp;

namespace MediaDetector.Core.Services;

public sealed record DownloadRequest(
    string Url,
    string FormatId,
    NameSource Source,
    string Ext,
    string? OutputDir,
    bool CleanNames,
    string? CustomName);

[SupportedOSPlatform("windows")]
public sealed class DownloadService
{
    // The override/clean/raw precedence lives here ONLY -- computing it twice is
    // how the preview and the real filename drift apart.
    public static string StemFor(DownloadRequest req) =>
        // Sanitised: a typed name is untrusted input pasted into an absolute path.
        FileNaming.SanitizeUserStem(req.CustomName)
        ?? (req.CleanNames
            ? FileNaming.DownloadStem(req.Source)
            : FileNaming.RawStem(req.Source));

    // A literal -o path, not a template: yt-dlp decides "already downloaded" by
    // comparing against what -o produces, so a stable name is what lets a repeat
    // run skip what it has. Every environment value is a parameter, keeping this pure.
    public static string[] BuildArgs(
        DownloadRequest req,
        string ytdlpExe,
        string? nodeExe,
        bool hasFfmpeg,
        string outputDir,
        string[] ffmpegLocationArgs)
    {
        var output = FileNaming.OutputTemplateFor(Path.Combine(outputDir, StemFor(req)));

        return YtdlpArgs.Ytdlp(ytdlpExe, nodeExe,
        [
            "-f", req.FormatId, req.Url, "-o", output, "--no-playlist",
            .. YtdlpArgs.ProgressTemplate(),
            .. ffmpegLocationArgs,
            .. FormatArgs.Metadata(hasFfmpeg, req.Ext),
        ]);
    }

    public async IAsyncEnumerable<DownloadLine> RunAsync(
        DownloadRequest req,
        [EnumeratorCancellation] CancellationToken ct = default)
    {
        if (!YouTubeUrl.IsYouTubeUrl(req.Url))
        {
            yield return new ErrorLine("Invalid YouTube URL");
            yield break;
        }

        var dir = OutputPaths.EnsureCreated(req.OutputDir);
        var hasFfmpeg = (await DependencyChecker.ProbeFfmpegAsync()).Found;
        var args = BuildArgs(
            req,
            ToolResolver.YtdlpExeOrDefault(),
            ToolResolver.ResolveNodeExe(),
            hasFfmpeg,
            dir,
            ToolResolver.FfmpegLocationArgs());

        AppLog.Info("download", $"format={req.FormatId} ext={req.Ext} -> {dir}");

        var runner = new TrackRunner();
        var translator = new DownloadTranslator();

        await foreach (var line in translator.TranslateAsync(
            runner.RunAsync(args, ct: ct), () => runner.ExitCode, ct))
        {
            yield return line;
        }

        var result = translator.Result;

        // A non-zero exit means the file is missing or truncated -- reporting
        // `done` here would show "Saved to ..." for a download that failed.
        if (result.Code != 0)
        {
            // The embed step never ran, so the cover art it would have consumed is
            // still sitting next to the media file.
            DownloadTranslator.RemoveStrayThumbnail(result.ThumbnailPath);
            // Cancellation is a distinct outcome, not an error and not silence.
            // Emitting it explicitly is what lets the row say "Cancelled -- a
            // partial file may remain" instead of snapping back to idle.
            yield return ct.IsCancellationRequested
                ? new CancelledLine()
                : new ErrorLine(result.ErrorMessage ?? $"yt-dlp exited with code {result.Code}");
            yield break;
        }

        // Prefer the path yt-dlp reported; otherwise the name we gave it, which it
        // used verbatim. Same StemFor as BuildArgs -- one source of truth.
        var savedPath = result.SavedPath ?? Path.Combine(dir, $"{StemFor(req)}.{req.Ext}");

        // EVERY successful download, not only when there is a title to correct:
        // nothing else embeds the cover art, and the .jpg must be cleaned up
        // either way. A null `tags` is raw mode -- picture only.
        var coverPath = DownloadTranslator.CoverPathFor(savedPath);
        var tags = FileNaming.MetadataOverrideFor(req.Source, req.CleanNames, req.CustomName);
        await MetadataTagger.TryWriteTagsAsync(savedPath, tags, coverPath);
        DownloadTranslator.DeleteThumbnail(coverPath);

        yield return new DoneLine(savedPath);
    }
}
