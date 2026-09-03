using System.Runtime.Versioning;
using MediaDetector.Core.Diagnostics;
using MediaDetector.Core.Naming;

namespace MediaDetector.Core.Ytdlp;

public sealed record BackfillReport(
    int Scanned, int Updated, int AlreadyCorrect, int Failed, int CoversEmbedded);

// Repairs downloads whose savedPath was mangled by an encoding bug, so the tag
// write never landed. Recomputed from each file's OWN tag, not from its filename:
// SanitizeFilename's full-width substitutions are not reversible.
[SupportedOSPlatform("windows")]
public static class MetadataBackfill
{
    // Containers we tag. webm/opus stay excluded: "Best available, no conversion"
    // downloads never got a corrected tag either, so including them here would
    // start rewriting files the download path still leaves alone.
    private static readonly string[] TaggableExtensions =
        [".m4a", ".mp4", ".m4v", ".mp3", ".flac", ".ogg", ".mka"];

    public static bool IsTaggable(string path) =>
        TaggableExtensions.Contains(Path.GetExtension(path), StringComparer.OrdinalIgnoreCase);

    // Exact stem match is what tells --write-thumbnail's leftover apart from an
    // unrelated image the user put in the folder.
    public static string? CoverFor(string mediaPath)
    {
        var jpg = Path.ChangeExtension(mediaPath, ".jpg");
        return File.Exists(jpg) ? jpg : null;
    }

    public static IReadOnlyList<string> FindCandidates(string directory, bool recursive) =>
        Directory.EnumerateFiles(
                directory, "*",
                recursive ? SearchOption.AllDirectories : SearchOption.TopDirectoryOnly)
            .Where(IsTaggable)
            .OrderBy(p => p, StringComparer.OrdinalIgnoreCase)
            .ToList();

    // Null when there is nothing to write, which is what makes a repeat run a
    // no-op rather than a rewrite of the whole folder.
    public static (string Title, string Artist)? CorrectionFor(string currentTitle, string currentArtist)
    {
        if (string.IsNullOrWhiteSpace(currentTitle))
        {
            return null;
        }

        var (title, artist) = FileNaming.SplitName(
            new NameSource(currentTitle, Uploader: currentArtist));

        if (title == currentTitle && artist == currentArtist)
        {
            return null;
        }

        return (title, artist);
    }

    // Best-effort per file: one unreadable file must not abandon the rest.
    public static async Task<BackfillReport> RunAsync(
        IReadOnlyList<string> paths,
        IProgress<string>? progress = null,
        CancellationToken ct = default)
    {
        var updated = 0;
        var alreadyCorrect = 0;
        var failed = 0;
        var covers = 0;

        foreach (var path in paths)
        {
            ct.ThrowIfCancellationRequested();
            var name = Path.GetFileName(path);

            var tags = await MetadataTagger.ReadTagsAsync(path);
            if (tags == null)
            {
                failed++;
                AppLog.Warn("backfill", $"could not read tags: {name}");
                progress?.Report($"Unreadable: {name}");
                continue;
            }

            // Two independent repairs -- a file can need either alone, so neither
            // may gate the other.
            var correction = CorrectionFor(tags.Value.Title, tags.Value.Artist);
            var cover = CoverFor(path);
            if (correction == null && cover == null)
            {
                alreadyCorrect++;
                progress?.Report($"Already correct: {name}");
                continue;
            }

            var ok = await MetadataTagger.TryWriteTagsAsync(path, correction, cover);
            if (!ok)
            {
                failed++;
                progress?.Report($"Failed: {name}");
                continue;
            }

            updated++;
            if (cover != null)
            {
                // Only on success: unlike a fresh download this image is the sole
                // copy. Deleting is also what makes a second run a no-op.
                covers++;
                DownloadTranslator.DeleteThumbnail(cover);
            }

            progress?.Report(correction != null
                ? $"Fixed: {correction.Value.Title} - {correction.Value.Artist}"
                : $"Cover art: {name}");
        }

        AppLog.Info("backfill",
            $"scanned={paths.Count} updated={updated} alreadyCorrect={alreadyCorrect} "
            + $"failed={failed} covers={covers}");
        return new BackfillReport(paths.Count, updated, alreadyCorrect, failed, covers);
    }
}
