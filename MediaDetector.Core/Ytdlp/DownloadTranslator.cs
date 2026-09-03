using System.Runtime.CompilerServices;
using System.Text.RegularExpressions;
using MediaDetector.Core.Diagnostics;
using MediaDetector.Core.Models;

namespace MediaDetector.Core.Ytdlp;

public sealed record DownloadRunResult(
    int Code,
    string? SavedPath = null,
    string? ErrorMessage = null,
    // Cover art yt-dlp wrote alongside the media; only still on disk if the run
    // did not reach the embed step. See RemoveStrayThumbnail.
    string? ThumbnailPath = null);

// Raw yt-dlp output into UI lines; a phase line only when the stage CHANGES.
// The source sequence is injected, so this needs no process to test.
public sealed class DownloadTranslator
{
    private static readonly Regex ErrorPrefix =
        new(@"^ERROR:\s*", RegexOptions.IgnoreCase | RegexOptions.CultureInvariant);

    // Prefixed to this run's yt-dlp log lines, for the same reason as
    // TrackRunner.Label: concurrent tracks interleave their output.
    public string Label { get; init; } = "";

    public DownloadRunResult Result { get; private set; } = new(1);

    public async IAsyncEnumerable<DownloadLine> TranslateAsync(
        IAsyncEnumerable<string> source,
        Func<int> exitCode,
        [EnumeratorCancellation] CancellationToken ct = default)
    {
        string? savedPath = null;
        string? thumbnailPath = null;
        DownloadPhase? lastPhase = null;
        var errors = new List<string>();

        await foreach (var line in source.WithCancellation(ct))
        {
            var progress = OutputParser.ParseProgress(line);

            // Everything EXCEPT progress spam, which would bury the warnings and
            // the actual error text -- the whole reason this log exists.
            if (progress == null)
            {
                var level = ErrorPrefix.IsMatch(line) ? LogLevel.Error : LogLevel.Debug;
                AppLog.Write(level, "yt-dlp", Label + line);
            }

            if (progress != null) yield return progress;

            var phase = OutputParser.ParsePhase(line);
            if (phase != null && phase.Phase != lastPhase)
            {
                lastPhase = phase.Phase;
                yield return phase;
            }

            var dest = OutputParser.ParseDestination(line);
            if (dest != null) savedPath = dest;

            var thumb = OutputParser.ParseThumbnailPath(line);
            if (thumb != null) thumbnailPath = thumb;

            if (ErrorPrefix.IsMatch(line))
                errors.Add(ErrorPrefix.Replace(line, "").Trim());
        }

        Result = new DownloadRunResult(
            exitCode(),
            savedPath,
            errors.Count != 0 ? string.Join(" ", errors) : null,
            thumbnailPath);
    }

    // Same stem as the media because -o is a literal path. Derived, not scraped:
    // ParseThumbnailPath names the pre-conversion .webp, already gone by now.
    public static string? CoverPathFor(string? mediaPath) =>
        string.IsNullOrEmpty(mediaPath) ? null : Path.ChangeExtension(mediaPath, ".jpg");

    // Best-effort: a thumbnail we could not delete is untidy, never fatal.
    public static void DeleteThumbnail(string? path)
    {
        if (string.IsNullOrEmpty(path)) return;
        try
        {
            File.Delete(path);
        }
        catch
        {
            // Already gone, or locked by another process.
        }
    }

    // Failure path. Deletes the .jpg sibling too: if the convertor ran before the
    // download died, the logged .webp is gone and the .jpg is what is orphaned.
    public static void RemoveStrayThumbnail(string? thumbnailPath)
    {
        if (string.IsNullOrEmpty(thumbnailPath)) return;
        DeleteThumbnail(thumbnailPath);
        DeleteThumbnail(Path.ChangeExtension(thumbnailPath, ".jpg"));
    }
}
