namespace MediaDetector.Core.Models;

// Coarse stage of a single yt-dlp run. Only Downloading reports a percentage;
// the ffmpeg-backed stages (merge/convert/embed) report no progress at all, so
// the UI needs the label to explain why the bar has stopped moving.
public enum DownloadPhase
{
    Extracting,
    Downloading,
    Merging,
    Converting,
    Embedding,
    Finishing,
}

// types/media.ts keeps DownloadStreamLine and PlaylistDownloadLine as separate
// unions. Mirroring that with abstract SingleDownloadLine / PlaylistLine bases
// would be type noise with no teeth: ProgressLine, PhaseLine and ErrorLine are
// valid in BOTH protocols, so they have to sit on the shared base, which makes
// IAsyncEnumerable<SingleDownloadLine> inexpressible and leaves the split
// enforcing nothing.
//
// So there is one base, and the enforcement is a runtime
// `default: throw new UnreachableException(...)` arm in each consumer's switch.
// That is honest about what is actually checked and when.
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

// Explicit rather than inferred. Without it a cancelled run ends the sequence
// with no line at all: TrackRunner swallows the OperationCanceledException,
// DownloadService sees a non-zero exit and yield-breaks silently, and the view
// model's catch never fires -- so the row falls back to idle instead of saying
// anything. yt-dlp leaves a resumable .part file, which is what the message says.
public sealed record CancelledLine(
    string Message = "Cancelled -- a partial file may remain") : DownloadLine;

// Attributes a line to the track that produced it.
//
// A sequential playlist did not need this: ItemLine(index) was emitted before the
// track started and implicitly scoped every ProgressLine and PhaseLine that
// followed. With several tracks in flight that association is gone -- their
// output interleaves in arrival order -- so the orchestrator wraps everything
// coming out of a downloader's sink. Lines the orchestrator emits itself
// (ItemLine, TrackDoneLine, ...) already carry an index and stay unwrapped.
public sealed record TrackLine(int Index, DownloadLine Inner) : DownloadLine;
