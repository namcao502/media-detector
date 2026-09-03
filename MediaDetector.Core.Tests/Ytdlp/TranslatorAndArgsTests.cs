using MediaDetector.Core.Models;
using MediaDetector.Core.Ytdlp;

namespace MediaDetector.Core.Tests.Ytdlp;

public class DownloadTranslatorTests
{
    private static async IAsyncEnumerable<string> Lines(params string[] lines)
    {
        foreach (var line in lines) { await Task.Yield(); yield return line; }
    }

    private static async Task<(List<DownloadLine> Out, DownloadRunResult Result)> Run(
        int exitCode, params string[] lines)
    {
        var translator = new DownloadTranslator();
        var emitted = new List<DownloadLine>();
        await foreach (var line in translator.TranslateAsync(Lines(lines), () => exitCode))
            emitted.Add(line);
        return (emitted, translator.Result);
    }

    [Fact]
    public async Task Translate_EmitsProgressPerTemplateLine()
    {
        var (emitted, _) = await Run(0,
            "@PROG 500 1000 NA NA NA NA NA", "@PROG 750 1000 NA NA NA NA NA");
        Assert.Equal(2, emitted.OfType<ProgressLine>().Count());
    }

    // A phase line is emitted only when the stage CHANGES, never repeated.
    [Fact]
    public async Task Translate_EmitsPhaseOnlyOnChange()
    {
        var (emitted, _) = await Run(0,
            "[download] Destination: a.m4a",
            "@PROG 1 2 NA NA NA NA NA",
            "[download] Destination: a.m4a",
            "[EmbedThumbnail] mp4");
        Assert.Equal([DownloadPhase.Downloading, DownloadPhase.Embedding],
            emitted.OfType<PhaseLine>().Select(p => p.Phase));
    }

    [Fact]
    public async Task Translate_CapturesSavedPathFromDestination()
    {
        var (_, result) = await Run(0, @"[download] Destination: C:\out\a.m4a");
        Assert.Equal(@"C:\out\a.m4a", result.SavedPath);
    }

    // The Merger line wins, because merging is what produces the final file.
    [Fact]
    public async Task Translate_LaterDestinationOverridesEarlier()
    {
        var (_, result) = await Run(0,
            @"[download] Destination: C:\out\a.f137.mp4",
            @"[Merger] Merging formats into ""C:\out\a.mp4""");
        Assert.Equal(@"C:\out\a.mp4", result.SavedPath);
    }

    [Fact]
    public async Task Translate_CollectsErrorTextWithoutPrefix()
    {
        var (_, result) = await Run(1, "ERROR: unable to download video data: HTTP Error 403");
        Assert.Contains("403", result.ErrorMessage);
        Assert.DoesNotContain("ERROR:", result.ErrorMessage);
    }

    [Fact]
    public async Task Translate_JoinsMultipleErrors()
    {
        var (_, result) = await Run(1, "ERROR: first", "ERROR: second");
        Assert.Equal("first second", result.ErrorMessage);
    }

    [Fact]
    public async Task Translate_NoErrorMessageOnCleanRun()
    {
        var (_, result) = await Run(0, "[download] Destination: a.m4a");
        Assert.Null(result.ErrorMessage);
    }

    [Fact]
    public async Task Translate_CapturesThumbnailPath()
    {
        var (_, result) = await Run(1, @"[info] Writing video thumbnail 1 to: C:\out\a.webp");
        Assert.Equal(@"C:\out\a.webp", result.ThumbnailPath);
    }

    [Fact]
    public async Task Translate_ReportsExitCode()
    {
        var (_, result) = await Run(2, "anything");
        Assert.Equal(2, result.Code);
    }
}

public class YtdlpArgsTests
{
    private const string Node = @"C:\Program Files\nodejs\node.exe";

    // A JS runtime is mandatory: YouTube gates format URLs behind signature and
    // "n" challenges that yt-dlp can only answer with one.
    [Fact]
    public void YouTubeAccess_PassesTheResolvedNodePath()
    {
        var args = YtdlpArgs.YouTubeAccess(Node);
        Assert.Equal($"node:{Node}", args[Array.IndexOf(args, "--js-runtimes") + 1]);
    }

    // A runtime alone is not enough -- the EJS solver script is a separate
    // download. Without this yt-dlp warns "challenge solver script was skipped"
    // and the URLs 403 anyway.
    [Fact]
    public void YouTubeAccess_RequestsTheRemoteEjsSolver()
    {
        var args = YtdlpArgs.YouTubeAccess(Node);
        Assert.Equal("ejs:github", args[Array.IndexOf(args, "--remote-components") + 1]);
    }

    // yt-dlp's default client (android_vr) currently 403s on every video
    // (yt-dlp#17456); web_embedded needs no PO token and serves the same formats.
    [Fact]
    public void YouTubeAccess_PrefersWebEmbeddedClient()
    {
        var args = YtdlpArgs.YouTubeAccess(Node);
        Assert.Equal("youtube:player_client=web_embedded,default",
            args[Array.IndexOf(args, "--extractor-args") + 1]);
    }

    // No JS runtime found: omit the flag rather than pass a broken path, so the
    // failure surfaces as yt-dlp's own error instead of a confusing spawn error.
    [Fact]
    public void YouTubeAccess_OmitsRuntimeFlagWhenNodeIsMissing()
        => Assert.DoesNotContain("--js-runtimes", YtdlpArgs.YouTubeAccess(null));

    // The standalone exe IS the command -- no interpreter in front of it. This
    // used to be `python -m yt_dlp`; dropping the interpreter is what removed
    // Python as a dependency.
    [Fact]
    public void Ytdlp_InvokesTheExeDirectly()
    {
        var args = YtdlpArgs.Ytdlp(@"C:\app\bin\yt-dlp.exe", Node, ["--version"]);
        Assert.Equal(@"C:\app\bin\yt-dlp.exe", args[0]);
        Assert.DoesNotContain("-m", args);
        Assert.Equal("--version", args[^1]);
    }

    // Regression for the second coming of "h?i kch": the frozen exe ignores
    // PYTHONIOENCODING, so without this no tag is written and every .jpg remains.
    [Fact]
    public void Ytdlp_ForcesUtf8Output()
    {
        var args = YtdlpArgs.Ytdlp("yt-dlp.exe", Node, ["--version"]);
        Assert.Equal("utf-8", args[Array.IndexOf(args, "--encoding") + 1]);
    }

    [Fact]
    public void Ytdlp_PrependsAccessArgsBeforeCallerArgs()
    {
        var args = YtdlpArgs.Ytdlp("yt-dlp.exe", Node, ["--dump-json", "URL"]);
        Assert.True(Array.IndexOf(args, "--js-runtimes") < Array.IndexOf(args, "--dump-json"));
    }

    [Fact]
    public void ProgressTemplate_RequestsNewlineAndRawNumbers()
    {
        var args = YtdlpArgs.ProgressTemplate();
        Assert.Contains("--newline", args);
        var template = args[Array.IndexOf(args, "--progress-template") + 1];
        Assert.StartsWith("download:@PROG ", template);
        Assert.Contains("%(progress.downloaded_bytes)s", template);
        Assert.Contains("%(progress.fragment_count)s", template);
    }

    // The template must round-trip through OutputParser.
    [Fact]
    public void ProgressTemplate_FieldOrderMatchesTheParser()
    {
        var template = YtdlpArgs.ProgressTemplate()[^1];
        var expected = string.Join(" ",
            OutputParser.ProgressFields.Select(f => $"%(progress.{f})s"));
        Assert.Equal($"download:@PROG {expected}", template);
    }
}

public class JsonParserTests
{
    [Fact]
    public void ParseMediaInfo_SplitsVideoAndAudioFormats()
    {
        const string json = """
        {
          "title": "Song", "uploader": "Chan", "duration": 200, "thumbnail": "t.jpg",
          "view_count": 10, "artist": "A", "track": "T",
          "formats": [
            {"format_id":"137","ext":"mp4","width":1920,"height":1080,"fps":30,"vcodec":"avc1","acodec":"none","filesize":100},
            {"format_id":"140","ext":"m4a","width":null,"height":null,"fps":null,"vcodec":"none","acodec":"mp4a","abr":129,"filesize":50}
          ]
        }
        """;
        var info = JsonParser.ParseMediaInfo(json);
        Assert.Equal("Song", info.Title);
        Assert.Equal("Chan", info.Channel);
        Assert.Equal("137", Assert.Single(info.VideoFormats).FormatId);
        Assert.Equal("140", Assert.Single(info.AudioFormats).FormatId);
    }

    [Fact]
    public void ParseMediaInfo_SortsVideoByHeightAndAudioByBitrate()
    {
        const string json = """
        {"title":"x","formats":[
          {"format_id":"lo","ext":"mp4","width":1280,"height":720,"vcodec":"avc1","acodec":"none"},
          {"format_id":"hi","ext":"mp4","width":1920,"height":1080,"vcodec":"avc1","acodec":"none"},
          {"format_id":"a48","ext":"m4a","vcodec":"none","acodec":"mp4a","abr":48},
          {"format_id":"a129","ext":"m4a","vcodec":"none","acodec":"mp4a","abr":129}
        ]}
        """;
        var info = JsonParser.ParseMediaInfo(json);
        Assert.Equal(["hi", "lo"], info.VideoFormats.Select(f => f.FormatId));
        Assert.Equal(["a129", "a48"], info.AudioFormats.Select(f => f.FormatId));
    }

    [Fact]
    public void ParseMediaInfo_DefaultsMissingFields()
    {
        var info = JsonParser.ParseMediaInfo("""{"formats":[]}""");
        Assert.Equal("Unknown", info.Title);
        Assert.Equal("Unknown", info.Channel);
        Assert.Null(info.Artist);
    }

    [Fact]
    public void ParsePlaylistEntries_KeepsIdsAndDropsNullEntries()
    {
        const string json = """
        {"title":"My List","entries":[
          {"id":"a","title":"One","uploader":"Chan"},
          null,
          {"id":"b","title":"Two"}
        ]}
        """;
        var (title, entries) = JsonParser.ParsePlaylistEntries(json);
        Assert.Equal("My List", title);
        Assert.Equal(["a", "b"], entries.Select(e => e.Id));
        Assert.Equal("Chan", entries[0].Author);
        Assert.Null(entries[1].Author);
    }

    [Fact]
    public void ParsePlaylistInfo_NumbersTracksFromOne()
    {
        var info = JsonParser.ParsePlaylistInfo(
            """{"title":"L","entries":[{"title":"One"},{"title":"Two"}]}""");
        Assert.Equal(2, info.Count);
        Assert.Equal([1, 2], info.Tracks.Select(t => t.Index));
    }

    [Fact]
    public void ParsePlaylistInfo_FallsBackToPlaceholderTitles()
    {
        var info = JsonParser.ParsePlaylistInfo("""{"entries":[{}]}""");
        Assert.Equal("Playlist", info.Title);
        Assert.Equal("Track 1", info.Tracks[0].Title);
    }
}
