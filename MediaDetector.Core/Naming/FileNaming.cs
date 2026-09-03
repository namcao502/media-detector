using System.Text.RegularExpressions;

namespace MediaDetector.Core.Naming;

public sealed record NameSource(
    string Title,
    string? Track = null,
    string? Artist = null,
    string? Uploader = null,
    string? Channel = null);

public sealed record ShowParts(string Track, string? Cast);

public static class FileNaming
{
    private const RegexOptions Opts = RegexOptions.IgnoreCase | RegexOptions.CultureInvariant;

    private const string Quote = "\"“”";
    private const string Genre = @"(?:hài\s+kịch|tấu\s+hài|hài|kịch)";

    private static readonly string[] BrandSegments =
        ["thúy nga", "thuy nga", "paris by night", "pbn tiếu vương hội", "pbn"];

    private const int MaxWordsPerName = 4;
    private const int MaxCastLength = 120;

    private static readonly Regex QuotedSpan =
        new($"^([^{Quote}]*)[{Quote}]([^{Quote}]+)[{Quote}](.*)$", RegexOptions.CultureInvariant);

    private static readonly Regex TopicSuffix = new(@"\s*-\s*topic\s*$", Opts);

    public static string StripTopicSuffix(string name) => TopicSuffix.Replace(name, "");

    private static string Tidy(string value) =>
        Regex.Replace(
            Regex.Replace(value, @"\s{2,}", " "),
            @"^[\s\-–—|,:]+|[\s\-–—|,:]+$", "").Trim();

    private static string DropBrandSegments(string title)
    {
        if (!title.Contains('|')) return title;
        var kept = title.Split('|')
            .Where(seg => !BrandSegments.Contains(seg.Trim().ToLowerInvariant()));
        return string.Join("|", kept);
    }

    private static string StripShowFurniture(string segment)
    {
        var s = Regex.Replace(segment, @"\bPBN\s*\d*", "", Opts);
        s = Regex.Replace(s, $@"^\s*{Genre}\b", "", Opts);
        s = Regex.Replace(s, $@"[\-–—]\s*{Genre}\b", " ", Opts);
        s = Regex.Replace(s, @"[\-–—]", " ");
        return Tidy(s);
    }

    private static int WordCount(string value) =>
        value.Split((char[]?)null, StringSplitOptions.RemoveEmptyEntries).Length;

    public static bool LooksLikeCast(string value)
    {
        var trimmed = value.Trim();
        if (trimmed.Length == 0 || trimmed.Length > MaxCastLength) return false;

        var parts = trimmed.Split([',', '&'])
            .Select(p => p.Trim())
            .Where(p => p.Length != 0)
            .ToArray();
        if (parts.Length == 0) return false;
        if (parts.Any(p => WordCount(p) > MaxWordsPerName)) return false;

        return parts.Length > 1 || WordCount(parts[0]) > 1;
    }

    private static string CastFromRemainder(string remainder)
    {
        var candidates = remainder.Split('|')
            .Select(StripShowFurniture)
            .Where(s => s.Length != 0 && LooksLikeCast(s))
            .ToArray();
        if (candidates.Length == 0) return "";

        return candidates
            .OrderByDescending(v => v.Count(c => c == ','))
            .ThenByDescending(v => v.Length)
            .First();
    }

    public static ShowParts? ParseShowTitle(string rawTitle)
    {
        var title = DropBrandSegments(rawTitle);

        var quoted = QuotedSpan.Match(title);
        if (quoted.Success)
        {
            var cast = CastFromRemainder($"{quoted.Groups[1].Value} | {quoted.Groups[3].Value}");
            return new ShowParts(Tidy(quoted.Groups[2].Value), LooksLikeCast(cast) ? cast : null);
        }

        var lead = Regex.Match(
            title, $@"^\s*{Genre}\s+([^|\-–—]*,[^|\-–—]*?)\s*[|\-–—]\s*(.+)$", Opts);
        if (lead.Success)
        {
            var cast = CastFromRemainder(lead.Groups[1].Value);
            var track = Tidy(Regex.Replace(
                lead.Groups[2].Value, @"\s*[|\-–—]?\s*\bPBN\s*\d*", "", Opts));
            if (track.Length != 0 && LooksLikeCast(cast)) return new ShowParts(track, cast);
        }

        var trail = Regex.Match(
            title,
            $@"^\s*({Genre}\s+.+?)\s*[|\-–—]\s*([^|\-–—]+,[^|\-–—]+)$",
            Opts);
        if (trail.Success)
        {
            var cast = CastFromRemainder(trail.Groups[2].Value);
            var withoutEpisode = Regex.Replace(
                trail.Groups[1].Value, @"\s*[|\-–—]?\s*\bPBN\s*\d*", "", Opts);
            var track = Tidy(withoutEpisode.Contains('|')
                ? withoutEpisode
                : Regex.Replace(withoutEpisode, $@"^\s*{Genre}\s+(?=\S)", "", Opts));
            if (track.Length != 0 && LooksLikeCast(cast)) return new ShowParts(track, cast);
        }

        return null;
    }

    private sealed record CleanRule(Regex Pattern, string Replacement);

    private static readonly CleanRule[] NoiseRules =
    [
        new(new Regex(
            @"\s*[(\[][^)\]]*(?:official|lyric|audio|video|visuali[sz]er|remaster(?:ed)?|explicit|hd|hq|4k|8k|m/?v)[^)\]]*[)\]]",
            Opts), ""),
        new(new Regex(@"\s+[(\[]?\s*(?:ft|feat)\.?\s+[^)\]]*[)\]]?\s*$", Opts), ""),
        new(new Regex(@"\s*[|\-–—]\s*(?:official|lyrics?|audio|visuali[sz]er|m/?v)\b.*$", Opts), ""),
        new(new Regex(@"\s+(?:m/?v|official\s+(?:music\s+)?video|lyrics?\s+video|visuali[sz]er)\s*$", Opts), ""),
        new(new Regex(@"\s+(?:\d{3,4}p(?:\d{2,3})?|[248]k|uhd|fhd|hdr|\d{2,3}\s*fps|full\s+hd|hd|hq)\b", Opts), ""),
    ];

    public static string CleanTitle(string title)
    {
        var cleaned = NoiseRules.Aggregate(
            title, (current, rule) => rule.Pattern.Replace(current, rule.Replacement));
        return Tidy(cleaned);
    }

    private static readonly Dictionary<char, char> CharSubstitutions = new()
    {
        ['/'] = '⧸',
        ['\\'] = '⧹',
        [':'] = '：',
        ['?'] = '？',
        ['"'] = '＂',
        ['<'] = '＜',
        ['>'] = '＞',
        ['|'] = '｜',
        ['*'] = '＊',
    };

    public static string SanitizeFilename(string name)
    {
        var chars = name
            .Where(c => c > '' && c != '')
            .Select(c => CharSubstitutions.TryGetValue(c, out var sub) ? sub : c);
        var cleaned = new string(chars.ToArray()).Trim();
        return cleaned.Length != 0 ? cleaned : "Untitled";
    }

    private static string StripAuthorPrefix(string title, string author)
    {
        if (author.Length == 0) return title;
        var escaped = Regex.Escape(author);
        return Regex.Replace(title, $@"^\s*{escaped}\s*[-–—]\s*", "", Opts);
    }

    private static string? NonEmpty(string? value) =>
        string.IsNullOrEmpty(value) ? null : value;

    public static string EffectiveAuthor(NameSource source)
    {
        var show = ParseShowTitle(source.Title);
        if (show != null && !string.IsNullOrEmpty(show.Cast)) return show.Cast;

        var fallback = NonEmpty(source.Artist)
                       ?? NonEmpty(source.Uploader)
                       ?? NonEmpty(source.Channel)
                       ?? "";
        var stripped = StripTopicSuffix(fallback).Trim();
        return stripped.Length != 0 ? stripped : "Unknown";
    }

    public static (string Title, string Artist) SplitName(NameSource source)
    {
        var show = ParseShowTitle(source.Title);
        var author = EffectiveAuthor(source);
        var title = show != null
            ? show.Track
            : CleanTitle(StripAuthorPrefix(NonEmpty(source.Track) ?? source.Title, author));
        return (title, author);
    }

    public static string DownloadStem(NameSource source)
    {
        var (baseName, author) = SplitName(source);
        var stem = author.Length != 0 && author != baseName ? $"{baseName} - {author}" : baseName;
        return SanitizeFilename(stem);
    }

    public static string RawStem(NameSource source) => SanitizeFilename(source.Title);

    public static string? SanitizeUserStem(string? input)
    {
        if (input == null) return null;
        var trimmed = input.Trim();
        if (trimmed.Length == 0) return null;

        var safe = SanitizeFilename(trimmed);
        if (safe.All(c => c == '.')) return null;
        return safe;
    }

    public static string OutputTemplateFor(string literalPathWithoutExt) =>
        $"{literalPathWithoutExt.Replace("%", "%%")}.%(ext)s";

    // Null when --embed-metadata's default already matches: under CleanNames off
    // with no custom title, RawStem is the raw title verbatim.
    public static (string Title, string Artist)? MetadataOverrideFor(
        NameSource source, bool cleanNames, string? customTitle)
    {
        var typed = string.IsNullOrWhiteSpace(customTitle) ? null : customTitle.Trim();
        if (typed == null && !cleanNames) return null;

        var (title, artist) = SplitName(source);
        return (typed ?? title, artist);
    }
}
