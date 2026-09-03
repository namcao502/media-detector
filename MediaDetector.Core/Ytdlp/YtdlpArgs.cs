namespace MediaDetector.Core.Ytdlp;

public static class YtdlpArgs
{
    // All three fight HTTP 403 and dropping any one brings it back: the JS
    // challenges need a runtime AND the EJS script, and yt-dlp's default client
    // (android_vr) 403s on every video (yt-dlp#17456).
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

    // --encoding utf-8 is load-bearing and NOT interchangeable with
    // PYTHONIOENCODING, which the frozen exe ignores: without it every non-ASCII
    // savedPath names a file that does not exist.
    public static string[] Ytdlp(string ytdlpExe, string? nodeExePath, IReadOnlyList<string> args) =>
        [ytdlpExe, "--encoding", "utf-8", .. YouTubeAccess(nodeExePath), .. args];

    // Raw numbers instead of "42.3% of 3.29MiB at 1.23MiB/s", so nothing parses
    // units or locale text; --newline because the reader cannot split on \r.
    public static string[] ProgressTemplate()
    {
        var template = string.Join(" ",
            OutputParser.ProgressFields.Select(f => $"%(progress.{f})s"));
        return ["--newline", "--progress-template",
                $"download:{OutputParser.ProgressPrefix} {template}"];
    }
}
