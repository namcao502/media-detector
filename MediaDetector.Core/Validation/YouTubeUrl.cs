using System.Web;

namespace MediaDetector.Core.Validation;

public readonly record struct YouTubeUrlKind(bool HasVideo, bool HasPlaylist);

public static class YouTubeUrl
{
    private static readonly string[] AllowedHosts =
        ["www.youtube.com", "youtube.com", "music.youtube.com", "youtu.be"];

    private static bool TryParse(string input, out Uri uri)
    {
        uri = null!;
        if (string.IsNullOrWhiteSpace(input)) return false;
        // UriKind.Absolute matters: without it a relative string parses fine and
        // the host check then throws.
        if (!Uri.TryCreate(input.Trim(), UriKind.Absolute, out var parsed)) return false;
        uri = parsed;
        // Exact host match, never a suffix -- "notyoutube.com" must not pass.
        return AllowedHosts.Contains(uri.Host, StringComparer.OrdinalIgnoreCase);
    }

    public static bool IsYouTubeUrl(string input) => TryParse(input, out _);

    public static YouTubeUrlKind GetKind(string input)
    {
        if (!TryParse(input, out var uri)) return new YouTubeUrlKind(false, false);

        var query = HttpUtility.ParseQueryString(uri.Query);
        var list = query["list"];
        // Exclude RD* (auto-generated radio/mix) -- effectively endless, not a
        // real playlist.
        var hasPlaylist = !string.IsNullOrEmpty(list)
            && !list.StartsWith("RD", StringComparison.Ordinal);

        var isShortLink = uri.Host.Equals("youtu.be", StringComparison.OrdinalIgnoreCase)
            && uri.AbsolutePath.Length > 1;
        var hasVideo = !string.IsNullOrEmpty(query["v"]) || isShortLink;

        return new YouTubeUrlKind(hasVideo, hasPlaylist);
    }
}
