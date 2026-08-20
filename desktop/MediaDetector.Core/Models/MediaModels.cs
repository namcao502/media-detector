namespace MediaDetector.Core.Models;

// VideoFormat and AudioFormat are otherwise unrelated records, so anything that
// must treat them uniformly -- the FormatTabs row factory in the UI -- needs this
// shared surface. Without it that callback is not expressible.
public interface IMediaFormat
{
    string FormatId { get; }
    string Ext { get; }
    long? Filesize { get; }
}

public sealed record VideoFormat(
    string FormatId,
    string Ext,
    int Width,
    int Height,
    double? Fps,
    string Vcodec,
    long? Filesize) : IMediaFormat;

public sealed record AudioFormat(
    string FormatId,
    string Ext,
    double? Abr,
    string Acodec,
    long? Filesize) : IMediaFormat;

public sealed record MediaInfo(
    string Title,
    string Channel,
    double Duration,
    string Thumbnail,
    long? ViewCount,
    // Music metadata, set by YouTube for Topic/YouTube Music entries and null
    // otherwise. Used to predict the download filename in the UI.
    string? Artist,
    string? Track,
    IReadOnlyList<VideoFormat> VideoFormats,
    IReadOnlyList<AudioFormat> AudioFormats);
