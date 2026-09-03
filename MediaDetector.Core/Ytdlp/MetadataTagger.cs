using System.Runtime.Versioning;
using MediaDetector.Core.Diagnostics;

namespace MediaDetector.Core.Ytdlp;

// Music apps read the embedded tag, not the filename, so renaming a file alone
// never changes what they show. TagLib# rather than mutagen: doing this in
// process is what removed the last thing Python was needed for.
[SupportedOSPlatform("windows")]
public static class MetadataTagger
{
    // One open/save, not two -- writing a tag into an mp4 can shift the media
    // data. titleArtist null means raw mode: leave title/artist alone but still
    // write the cover art, which is the easiest part here to get wrong.
    private static bool WriteTags(
        string mediaPath, (string Title, string Artist)? titleArtist, string? coverImagePath)
    {
        using var file = TagLib.File.Create(mediaPath);
        var changed = false;

        if (titleArtist != null)
        {
            file.Tag.Title = titleArtist.Value.Title;
            file.Tag.Performers = [titleArtist.Value.Artist];
            changed = true;
        }

        if (!string.IsNullOrEmpty(coverImagePath) && File.Exists(coverImagePath))
        {
            file.Tag.Pictures =
                [new TagLib.Picture(coverImagePath) { Type = TagLib.PictureType.FrontCover }];
            changed = true;
        }

        if (!changed)
        {
            return false;
        }

        file.Save();
        return true;
    }

    // Deliberately catches everything: an unexpected exception escaping into the
    // download's async iterator would turn a finished download into a failure.
    public static Task<bool> TryWriteTagsAsync(
        string? mediaPath,
        (string Title, string Artist)? titleArtist,
        string? coverImagePath = null)
    {
        if (string.IsNullOrEmpty(mediaPath))
        {
            return Task.FromResult(false);
        }

        // Task.Run despite TagLib# being synchronous: tagging a large mp4 rewrites
        // the file, and MetadataBackfill loops over hundreds straight off the UI.
        return Task.Run(() =>
        {
            try
            {
                return WriteTags(mediaPath, titleArtist, coverImagePath);
            }
            catch (Exception ex)
            {
                AppLog.Warn("metadata",
                    $"tag write failed for {Path.GetFileName(mediaPath)}: {ex.Message}");
                return false;
            }
        });
    }

    // Null means "could not read", which callers treat as nothing to prefill
    // rather than as an error.
    public static Task<(string Title, string Artist)?> ReadTagsAsync(string mediaPath)
    {
        return Task.Run<(string Title, string Artist)?>(() =>
        {
            try
            {
                using var file = TagLib.File.Create(mediaPath);
                return (file.Tag.Title ?? "", file.Tag.FirstPerformer ?? "");
            }
            catch (Exception ex)
            {
                AppLog.Warn("metadata",
                    $"tag read failed for {Path.GetFileName(mediaPath)}: {ex.Message}");
                return null;
            }
        });
    }
}
