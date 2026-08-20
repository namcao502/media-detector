using System.Text.Json;
using MediaDetector.Core.Models;

namespace MediaDetector.Core.Ytdlp;

// JsonElement rather than typed deserialisation: yt-dlp's format objects are
// heterogeneous and half the fields are absent or null per entry.
public static class JsonParser
{
    private static string? Str(JsonElement e, string name) =>
        e.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.String ? v.GetString() : null;

    private static double? Num(JsonElement e, string name) =>
        e.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.Number ? v.GetDouble() : null;

    // Explicit comparisons rather than relational patterns, per the repo's
    // coding-style rules.
    private static bool HasSize(JsonElement x, string name)
    {
        var value = Num(x, name);
        return value != null && value.Value > 0;
    }

    public static MediaInfo ParseMediaInfo(string json)
    {
        using var doc = JsonDocument.Parse(json);
        var root = doc.RootElement;

        var formats = root.TryGetProperty("formats", out var f) && f.ValueKind == JsonValueKind.Array
            ? f.EnumerateArray().ToArray()
            : [];

        var video = formats
            .Where(x => HasSize(x, "width") && HasSize(x, "height")
                        && !string.IsNullOrEmpty(Str(x, "vcodec"))
                        && Str(x, "vcodec") != "none")
            .Select(x => new VideoFormat(
                Str(x, "format_id") ?? "",
                Str(x, "ext") ?? "",
                (int)Num(x, "width")!.Value,
                (int)Num(x, "height")!.Value,
                Num(x, "fps"),
                Str(x, "vcodec")!,
                (long?)Num(x, "filesize")))
            .OrderByDescending(x => x.Height)
            .ToArray();

        var audio = formats
            // OR, not AND. lib/ytdlp.ts:273 is `(!f.width || !f.height) && ...`,
            // so a format reporting one dimension but not the other still counts
            // as audio. An AND here would classify it as neither.
            .Where(x => (!HasSize(x, "width") || !HasSize(x, "height"))
                        && !string.IsNullOrEmpty(Str(x, "acodec"))
                        && Str(x, "acodec") != "none"
                        && Str(x, "vcodec") == "none")
            .Select(x => new AudioFormat(
                Str(x, "format_id") ?? "",
                Str(x, "ext") ?? "",
                Num(x, "abr"),
                Str(x, "acodec")!,
                (long?)Num(x, "filesize")))
            .OrderByDescending(x => x.Abr ?? 0)
            .ToArray();

        return new MediaInfo(
            Str(root, "title") ?? "Unknown",
            Str(root, "uploader") ?? Str(root, "channel") ?? "Unknown",
            Num(root, "duration") ?? 0,
            Str(root, "thumbnail") ?? "",
            (long?)Num(root, "view_count"),
            Str(root, "artist"),
            Str(root, "track"),
            video,
            audio);
    }

    private static JsonElement[] Entries(JsonElement root) =>
        root.TryGetProperty("entries", out var e) && e.ValueKind == JsonValueKind.Array
            ? e.EnumerateArray().ToArray()
            : [];

    public static PlaylistInfo ParsePlaylistInfo(string json)
    {
        using var doc = JsonDocument.Parse(json);
        var root = doc.RootElement;
        var tracks = Entries(root)
            .Select((e, i) => new PlaylistTrack(
                i + 1,
                e.ValueKind == JsonValueKind.Object ? Str(e, "title") ?? $"Track {i + 1}" : $"Track {i + 1}",
                e.ValueKind == JsonValueKind.Object ? Str(e, "uploader") ?? Str(e, "channel") : null))
            .ToArray();
        return new PlaylistInfo(Str(root, "title") ?? "Playlist", tracks.Length, tracks);
    }

    // Sibling of ParsePlaylistInfo; also keeps the id so tracks can be downloaded
    // one at a time (which is what makes per-track retry possible).
    public static (string Title, IReadOnlyList<PlaylistEntry> Entries) ParsePlaylistEntries(string json)
    {
        using var doc = JsonDocument.Parse(json);
        var root = doc.RootElement;
        var entries = Entries(root)
            .Where(e => e.ValueKind == JsonValueKind.Object && Str(e, "id") != null)
            .Select((e, i) => new PlaylistEntry(
                Str(e, "id")!,
                Str(e, "title") ?? $"Track {i + 1}",
                Str(e, "uploader") ?? Str(e, "channel")))
            .ToArray();
        return (Str(root, "title") ?? "Playlist", entries);
    }
}
