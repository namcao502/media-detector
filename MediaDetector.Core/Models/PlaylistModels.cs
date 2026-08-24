namespace MediaDetector.Core.Models;

public enum PlaylistMode { Audio, Video }
public enum PlaylistAudioFormat { M4a, Mp3, Best }   // Best = native, no conversion
public enum PlaylistVideoQuality { Q1080, Q720, Best }

public sealed record PlaylistFormatSelection(
    PlaylistMode Mode,
    PlaylistAudioFormat AudioFormat = PlaylistAudioFormat.M4a,
    PlaylistVideoQuality VideoQuality = PlaylistVideoQuality.Q1080);

public sealed record PlaylistTrack(
    int Index,          // 1-based position in the playlist
    string Title,
    // Uploading channel, so the client previews the same name the service builds.
    string? Author);

public sealed record PlaylistInfo(string Title, int Count, IReadOnlyList<PlaylistTrack> Tracks);

public sealed record PlaylistEntry(string Id, string Title, string? Author);

public sealed record TrackJob(string Id, string Title, int Index, string? Author = null);

public sealed record TrackOutcome(
    bool Ok,
    string? SavedPath = null,
    // The attempt was killed by the idle deadline rather than failing outright.
    // Retrying would just burn the deadline again, so the engine gives up early.
    bool Hung = false);

// Playlist-only lines; the shared ones (ProgressLine, PhaseLine, ErrorLine) sit
// on the common DownloadLine base and are valid in both protocols.
public sealed record ItemLine(int Index, int Total) : DownloadLine;
public sealed record TrackDoneLine(int Index, string SavedPath) : DownloadLine;
public sealed record TrackRetryLine(int Index, int Attempt, int Phase) : DownloadLine;
public sealed record TrackSkippedLine(int Index) : DownloadLine;   // failed phase 1
public sealed record TrackErrorLine(int Index, string Title) : DownloadLine;  // failed both

public sealed record BatchDoneLine(
    string Folder,
    int Downloaded,
    int Total,
    int Failed,
    // True when the batch stopped early because the user cancelled, so Failed
    // counts tracks never attempted rather than tracks that went wrong.
    bool Cancelled) : DownloadLine;
