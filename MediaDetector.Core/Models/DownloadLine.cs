namespace MediaDetector.Core.Models;

// Only Downloading reports a percentage; the ffmpeg-backed stages are silent, so
// the label is what explains why the bar stopped moving.
public enum DownloadPhase
{
    Extracting,
    Downloading,
    Merging,
    Converting,
    Embedding,
    Finishing,
}

// One base, not separate single/playlist unions: ProgressLine, PhaseLine and
// ErrorLine are valid in both, so a split would enforce nothing. Consumers use a
// `default: throw new UnreachableException(...)` arm instead.
public abstract record DownloadLine;

// Byte/speed/ETA fields are optional: yt-dlp reports them as "NA" until the
// transfer has enough samples, and a live stream has no known total size.
public sealed record ProgressLine(
    double Percent,
    long? DownloadedBytes = null,
    long? TotalBytes = null,
    double? SpeedBytesPerSec = null,
    double? EtaSeconds = null,
    int? FragmentIndex = null,
    int? FragmentCount = null) : DownloadLine;

public sealed record PhaseLine(DownloadPhase Phase, string Label) : DownloadLine;

public sealed record ErrorLine(string Message) : DownloadLine;

public sealed record DoneLine(string SavedPath) : DownloadLine;

// Explicit, because nothing else reports cancellation: the exception is
// swallowed downstream and the row would silently fall back to idle.
public sealed record CancelledLine(
    string Message = "Cancelled -- a partial file may remain") : DownloadLine;

// ProgressLine and PhaseLine carry no index, and concurrent tracks interleave, so
// the orchestrator wraps everything from a downloader's sink. Lines it emits
// itself already carry an index and stay unwrapped.
public sealed record TrackLine(int Index, DownloadLine Inner) : DownloadLine;
