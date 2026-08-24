namespace MediaDetector.Core.Ytdlp;

public static class YtdlpArgs
{
    // Args every YouTube call needs to get a format URL that is not HTTP 403.
    //
    // 1. JS challenges. YouTube's player gates its format URLs behind signature
    //    and "n" challenges that yt-dlp can only answer with an external
    //    JavaScript runtime PLUS the EJS solver script. Miss either and the
    //    download dies with "unable to download video data: HTTP Error 403", and
    //    because --embed-thumbnail writes the cover art first, the only thing a
    //    failed run leaves on disk is a stray .webp.
    //    The Next.js app got the runtime free by handing yt-dlp its own Node
    //    binary (process.execPath, lib/ytdlp.ts:85). A .NET app has no Node, so
    //    the path comes from ToolResolver and Node is a declared dependency.
    // 2. Player client. yt-dlp's default (android_vr) needs no PO token but its
    //    URLs currently 403 on every video (yt-dlp#17456). web_embedded needs no
    //    token either and serves the same audio-only + DASH formats, so it goes
    //    first; `default` stays behind it for videos that disable embedding.
    public static string[] YouTubeAccess(string? nodeExePath)
    {
        var args = new List<string>();
        if (!string.IsNullOrEmpty(nodeExePath))
        {
            args.Add("--js-runtimes");
            args.Add($"node:{nodeExePath}");
        }
        args.Add("--remote-components");
        args.Add("ejs:github");
        args.Add("--extractor-args");
        args.Add("youtube:player_client=web_embedded,default");
        return [.. args];
    }

    // yt-dlp installs a `yt-dlp` shim into Python's Scripts dir, which a fresh
    // python.org install does not add to PATH. Run it as a module instead.
    public static string[] Ytdlp(string python, string? nodeExePath, IReadOnlyList<string> args) =>
        [python, "-m", "yt_dlp", .. YouTubeAccess(nodeExePath), .. args];

    // A fresh python.org install has `python` on PATH but often no bare `pip`.
    public static string[] Pip(string python, IReadOnlyList<string> args) =>
        [python, "-m", "pip", .. args];

    // --progress-template replaces yt-dlp's "[download] 42.3% of 3.29MiB at
    // 1.23MiB/s" with raw numbers, so nothing has to parse units or locale text.
    // --newline keeps each update on its own line instead of overwriting with \r,
    // which the line reader cannot split.
    public static string[] ProgressTemplate()
    {
        var template = string.Join(" ",
            OutputParser.ProgressFields.Select(f => $"%(progress.{f})s"));
        return ["--newline", "--progress-template",
                $"download:{OutputParser.ProgressPrefix} {template}"];
    }
}
