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

// Replaces app/api/download/route.ts. Everything the route did survives except
// the streaming protocol: no ReadableStream, no TextEncoder, no NDJSON, no
// dual-source AbortController -- one CancellationToken covers what req.signal
// plus the stream cancel() callback covered together.
[SupportedOSPlatform("windows")]
public sealed class DownloadService
{
    // The override/clean/raw precedence lives here ONLY. Computing it in two
    // places (arg building and the final DoneLine) is how the preview and the
    // real filename drift apart.
    public static string StemFor(DownloadRequest req) =>
        // A typed name wins over the rules, once sanitised -- it is untrusted
        // input being pasted into an absolute path.
        FileNaming.SanitizeUserStem(req.CustomName)
        ?? (req.CleanNames
            ? FileNaming.DownloadStem(req.Source)
            : FileNaming.RawStem(req.Source));

    // The name is decided HERE and handed to yt-dlp as a literal -o path, not as
    // a template. yt-dlp decides a file is "already downloaded" by comparing
    // against the name its -o produces, so a literal name is stable across runs
    // and a repeat download still skips what it has. The UI preview and the real
    // filename also come from one function, so they cannot drift.
    //
    // Every environment-dependent value is a parameter, so this is pure and its
    // tests do not read the real machine's winget dirs or ~/Documents.
    // `outputDir` must already be resolved by the caller.
    public static string[] BuildArgs(
        DownloadRequest req,
        string python,
        string? nodeExe,
        bool hasFfmpeg,
        string outputDir,
        string[] ffmpegLocationArgs)
    {
        var output = FileNaming.OutputTemplateFor(Path.Combine(outputDir, StemFor(req)));

        return YtdlpArgs.Ytdlp(python, nodeExe,
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
            await DependencyChecker.ResolvePythonAsync(ct),
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
        yield return new DoneLine(
            result.SavedPath ?? Path.Combine(dir, $"{StemFor(req)}.{req.Ext}"));
    }
}
