namespace MediaDetector.Core.Models;

public enum UpdateStatus { Updated, UpToDate, Failed, Skipped }

public sealed record DependencyState(bool Found, string? Version);

public sealed record YtdlpState(bool Found, string? Version, UpdateStatus UpdateStatus);

// ffprobe is tracked separately because yt-dlp shells out to it to embed cover
// art. A dir holding ffmpeg.exe alone satisfies a naive probe and then drops the
// image silently, so "found" is not enough on its own.
public sealed record FfmpegState(bool Found, string? Version, bool FfprobeFound);

public sealed record StatusResult(
    DependencyState Python,
    YtdlpState Ytdlp,
    // Fourth dependency, new in the desktop port. yt-dlp needs a JS runtime for
    // YouTube's signature and "n" challenges; the Node-hosted web app supplied
    // one implicitly via process.execPath. Without it every format URL 403s.
    DependencyState Node,
    // Optional -- downloads work without it; required only to embed metadata
    // and thumbnails.
    FfmpegState Ffmpeg,
    // Required for cover art in mp4/m4a (yt-dlp's own thumbnail path prefers it
    // over the ffmpeg fallback, which writes no usable image data) AND for
    // MetadataTagger's title/artist correction, which is pure mutagen and needs
    // no ffmpeg at all. Both failures are silent, hence its own row.
    DependencyState Mutagen);
