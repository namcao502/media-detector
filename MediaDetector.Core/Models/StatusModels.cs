namespace MediaDetector.Core.Models;

public enum UpdateStatus { Updated, UpToDate, Failed, Skipped }

// Path is shown in the UI: without it two green rows are indistinguishable, and
// a pip yt-dlp shim reports the same --version as the standalone build.
public sealed record DependencyState(bool Found, string? Version, string? Path = null);

public sealed record YtdlpState(
    bool Found, string? Version, UpdateStatus UpdateStatus, string? Path = null);

// ffprobe tracked separately: a dir with ffmpeg.exe alone passes a naive probe
// and then drops the cover art silently. Dir, because --ffmpeg-location wants one.
public sealed record FfmpegState(
    bool Found, string? Version, bool FfprobeFound, string? Dir = null);

// Three rows, not five. Python went when yt-dlp moved to the standalone exe that
// bundles its own; mutagen went when MetadataTagger moved to TagLib#.
public sealed record StatusResult(
    YtdlpState Ytdlp,
    // Required: without a JS runtime every format URL answers 403.
    DependencyState Node,
    // Optional -- downloads still work, just with no metadata or cover art.
    FfmpegState Ffmpeg);
