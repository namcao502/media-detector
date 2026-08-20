namespace MediaDetector.Core.Models;

public enum UpdateStatus { Updated, UpToDate, Failed, Skipped }

public sealed record DependencyState(bool Found, string? Version);

public sealed record YtdlpState(bool Found, string? Version, UpdateStatus UpdateStatus);

public sealed record StatusResult(
    DependencyState Python,
    YtdlpState Ytdlp,
    // Fourth dependency, new in the desktop port. yt-dlp needs a JS runtime for
    // YouTube's signature and "n" challenges; the Node-hosted web app supplied
    // one implicitly via process.execPath. Without it every format URL 403s.
    DependencyState Node,
    // Optional -- downloads work without it; required only to embed metadata
    // and thumbnails.
    DependencyState Ffmpeg);
