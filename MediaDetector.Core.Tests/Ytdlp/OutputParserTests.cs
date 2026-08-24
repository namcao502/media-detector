using MediaDetector.Core.Models;
using MediaDetector.Core.Ytdlp;

namespace MediaDetector.Core.Tests.Ytdlp;

public class OutputParserTests
{
    // Field order: downloaded total estimate speed eta fragIndex fragCount
    [Fact]
    public void ParseProgress_ReadsTemplateLine()
    {
        var line = OutputParser.ParseProgress("@PROG 500 1000 NA 250.5 2 NA NA");
        Assert.NotNull(line);
        Assert.Equal(50, line!.Percent);
        Assert.Equal(500, line.DownloadedBytes);
        Assert.Equal(1000, line.TotalBytes);
        Assert.Equal(250.5, line.SpeedBytesPerSec);
        Assert.Equal(2, line.EtaSeconds);
    }

    // yt-dlp renders an unset field as the literal "NA"; those become null.
    [Fact]
    public void ParseProgress_OmitsNaFields()
    {
        var line = OutputParser.ParseProgress("@PROG 500 NA NA NA NA NA NA");
        Assert.NotNull(line);
        Assert.Null(line!.TotalBytes);
        Assert.Null(line.SpeedBytesPerSec);
        Assert.Equal(0, line.Percent);
    }

    // Fragmented (DASH/HLS) downloads only know an estimate.
    [Fact]
    public void ParseProgress_FallsBackToEstimateForTotal()
    {
        var line = OutputParser.ParseProgress("@PROG 250 NA 1000 NA NA 3 10");
        Assert.Equal(1000, line!.TotalBytes);
        Assert.Equal(25, line.Percent);
        Assert.Equal(3, line.FragmentIndex);
        Assert.Equal(10, line.FragmentCount);
    }

    [Fact]
    public void ParseProgress_ClampsAtOneHundred()
        => Assert.Equal(100, OutputParser.ParseProgress("@PROG 2000 1000 NA NA NA NA NA")!.Percent);

    // Fallback for yt-dlp's default human-readable line.
    [Fact]
    public void ParseProgress_FallsBackToHumanReadableLine()
        => Assert.Equal(42.3,
            OutputParser.ParseProgress("[download]  42.3% of 3.29MiB at 1.23MiB/s")!.Percent);

    [Fact]
    public void ParseProgress_ReturnsNullForUnrelatedLine()
        => Assert.Null(OutputParser.ParseProgress("some unrelated text"));

    [Theory]
    [InlineData(@"[download] Destination: C:\out\a.m4a", DownloadPhase.Downloading, "Downloading")]
    [InlineData(@"[Merger] Merging formats into ""C:\out\a.mp4""", DownloadPhase.Merging,
        "Merging video and audio")]
    [InlineData("[ExtractAudio] Destination: a.m4a", DownloadPhase.Converting,
        "Converting with ffmpeg")]
    [InlineData("[FixupM4a] Correcting container", DownloadPhase.Converting, "Repairing container")]
    [InlineData("[EmbedThumbnail] mp4", DownloadPhase.Embedding,
        "Embedding metadata and cover art")]
    [InlineData("[MoveFiles] Moving file", DownloadPhase.Finishing, "Finishing up")]
    [InlineData("[youtube] abc: Downloading webpage", DownloadPhase.Extracting,
        "Reading video page")]
    public void ParsePhase_MapsStagePrefixes(string line, DownloadPhase phase, string label)
    {
        var parsed = OutputParser.ParsePhase(line);
        Assert.NotNull(parsed);
        Assert.Equal(phase, parsed!.Phase);
        Assert.Equal(label, parsed.Label);
    }

    [Fact]
    public void ParsePhase_ReturnsNullForUnknownLine()
        => Assert.Null(OutputParser.ParsePhase("something else"));

    [Fact]
    public void ParseDestination_ReadsDownloadLine()
        => Assert.Equal(@"C:\out\a.m4a",
            OutputParser.ParseDestination(@"[download] Destination: C:\out\a.m4a"));

    [Fact]
    public void ParseDestination_ReadsMergerLine()
        => Assert.Equal(@"C:\out\a.mp4",
            OutputParser.ParseDestination(@"[Merger] Merging formats into ""C:\out\a.mp4"""));

    [Fact]
    public void ParseThumbnailPath_ReadsWritingThumbnailLine()
        => Assert.Equal(@"C:\out\a.webp",
            OutputParser.ParseThumbnailPath(@"[info] Writing video thumbnail 1 to: C:\out\a.webp"));

    [Fact]
    public void ParseThumbnailPath_HandlesMissingIndex()
        => Assert.Equal(@"C:\out\a.webp",
            OutputParser.ParseThumbnailPath(@"[info] Writing video thumbnail to: C:\out\a.webp"));

    [Fact]
    public void ParseThumbnailPath_ReturnsNullForUnrelatedLine()
        => Assert.Null(OutputParser.ParseThumbnailPath("[info] Downloading 1 format(s)"));
}
