using System.Runtime.Versioning;
using System.Text.Json;
using MediaDetector.Core.Diagnostics;
using MediaDetector.Core.Processes;

namespace MediaDetector.Core.Ytdlp;

// Corrects the embedded title/artist tag after a download, independent of the
// filename. --embed-metadata (FormatArgs.Metadata) already wrote a tag from the
// raw YouTube title/uploader; music apps (Apple Music, Windows Music) read that
// tag, not the filename, so renaming the file alone can never change what they
// show -- only rewriting the tag itself does.
//
// Values reach Python purely through argv (ProcessRunner never uses a shell and
// never string-interpolates into the script), so arbitrary title text -- any
// Unicode, quotes, percent signs -- can never be misparsed as code. This is
// deliberately not done via yt-dlp's own --parse-metadata: that mechanism
// regex-matches an expanded output-template string, which is fragile for
// literal title text containing regex/template metacharacters, and it only
// runs when ffmpeg is present.
[SupportedOSPlatform("windows")]
public static class MetadataTagger
{
    private const string WriteScript = """
        import sys
        from mutagen import File
        path, title, artist = sys.argv[1:4]
        f = File(path, easy=True)
        if f is None:
            print("unsupported container", file=sys.stderr)
            sys.exit(1)
        f["title"] = title
        f["artist"] = artist
        f.save()
        """;

    // Best-effort: a failure here must never fail the download, only log. Covers
    // a missing/incompatible mutagen and containers it cannot tag at all (webm
    // from "Best available, no conversion"). Returns whether the tag was
    // actually written, so a manual caller (the "Fix metadata" dialog) can show
    // a real result instead of only the log.
    public static async Task<bool> TryWriteTagsAsync(
        string python, string? filePath, string title, string artist, CancellationToken ct)
    {
        if (string.IsNullOrEmpty(filePath))
        {
            return false;
        }

        var result = await ProcessRunner.RunAsync(
            [python, "-c", WriteScript, filePath, title, artist], ct);
        if (result.ExitCode != 0)
        {
            AppLog.Warn("metadata", $"tag write failed for {Path.GetFileName(filePath)}: {result.Stderr}");
            return false;
        }

        return true;
    }

    private const string ReadScript = """
        import sys, json
        from mutagen import File
        f = File(sys.argv[1], easy=True)
        title = ""
        artist = ""
        if f is not None and f.tags:
            title = (f.get("title") or [""])[0]
            artist = (f.get("artist") or [""])[0]
        print(json.dumps({"title": title, "artist": artist}))
        """;

    // Reads the file's CURRENT title/artist tag, for prefilling an edit UI. JSON
    // rather than plain lines: ProcessRunner trims stdout as one block, so a
    // delimiter-based format would be ambiguous if a tag value contained a
    // newline. Returns null for anything mutagen cannot read -- caller treats
    // that as "nothing to prefill," not an error.
    public static async Task<(string Title, string Artist)?> ReadTagsAsync(
        string python, string filePath, CancellationToken ct = default)
    {
        var result = await ProcessRunner.RunAsync([python, "-c", ReadScript, filePath], ct);
        if (result.ExitCode != 0)
        {
            return null;
        }

        try
        {
            var doc = JsonDocument.Parse(result.Stdout);
            return (doc.RootElement.GetProperty("title").GetString() ?? "",
                    doc.RootElement.GetProperty("artist").GetString() ?? "");
        }
        catch (JsonException)
        {
            return null;
        }
    }
}
