using MediaDetector.Core.Ytdlp;

namespace MediaDetector.Core.Tests.Ytdlp;

// The inputs here are the real embedded tags read off files downloaded before the
// PYTHONIOENCODING fix: yt-dlp's --embed-metadata wrote the raw YouTube title into
// ©nam and the channel into ©ART, and our correction never landed on top.
public class MetadataBackfillTests
{
    [Fact]
    public void CorrectionFor_RecoversTitleAndCastFromTheRawYouTubeTag()
    {
        var correction = MetadataBackfill.CorrectionFor(
            "Hài Kịch \"Bài Học Nhớ Đời\" | PBN 123 | Việt Hương, Chí Tài, Thúy Nga, Hoài Tâm",
            "Thuy Nga");

        Assert.NotNull(correction);
        Assert.Equal("Bài Học Nhớ Đời", correction.Value.Title);
        Assert.Equal("Việt Hương, Chí Tài, Thúy Nga, Hoài Tâm", correction.Value.Artist);
    }

    // The channel name is dropped in favour of the cast parsed out of the title --
    // this is the whole point of the repair, and what Apple Music was showing.
    [Fact]
    public void CorrectionFor_ReplacesTheChannelNameWithTheCast()
    {
        var correction = MetadataBackfill.CorrectionFor(
            "Hài Kịch \"Cha Già Dấu Yêu\" | PBN 106 | Chí Tài, Việt Hương, Hoài Tâm, Thúy Nga",
            "Thuy Nga");

        Assert.NotNull(correction);
        Assert.Equal("Cha Già Dấu Yêu", correction.Value.Title);
        Assert.NotEqual("Thuy Nga", correction.Value.Artist);
    }

    // Re-running the backfill must not rewrite every file again, so a tag that
    // already equals what SplitName produces reports nothing to do.
    [Fact]
    public void CorrectionFor_ReturnsNullWhenTheTagIsAlreadyCorrect()
        => Assert.Null(MetadataBackfill.CorrectionFor(
            "Bài Học Nhớ Đời", "Việt Hương, Chí Tài, Thúy Nga, Hoài Tâm"));

    // Applying the correction twice must be a fixed point, not an oscillation.
    [Fact]
    public void CorrectionFor_IsIdempotent()
    {
        var first = MetadataBackfill.CorrectionFor(
            "Hài Kịch \"Bài Học Nhớ Đời\" | PBN 123 | Việt Hương, Chí Tài, Thúy Nga, Hoài Tâm",
            "Thuy Nga");

        Assert.NotNull(first);
        Assert.Null(MetadataBackfill.CorrectionFor(first.Value.Title, first.Value.Artist));
    }

    // Some titles need no cleaning at all, so their raw tag already matched the
    // cleaned filename. Those must be left alone rather than counted as repairs.
    [Fact]
    public void CorrectionFor_LeavesATitleThatNeedsNoCleaning()
        => Assert.Null(MetadataBackfill.CorrectionFor("[Gala cười] Kẻ trộm đêm 30", "VTV Go"));

    [Fact]
    public void CorrectionFor_ReturnsNullForAnUntitledFile()
    {
        Assert.Null(MetadataBackfill.CorrectionFor("", "VTV Go"));
        Assert.Null(MetadataBackfill.CorrectionFor("   ", "VTV Go"));
    }

    [Theory]
    [InlineData("song.m4a", true)]
    [InlineData("song.MP3", true)]
    [InlineData("clip.mp4", true)]
    // webm/opus are the containers mutagen returns None for, which is exactly the
    // case MetadataTagger already cannot handle.
    [InlineData("song.webm", false)]
    [InlineData("song.opus", false)]
    [InlineData("cover.webp", false)]
    public void IsTaggable_AcceptsOnlyContainersMutagenCanWrite(string name, bool expected)
        => Assert.Equal(expected, MetadataBackfill.IsTaggable(name));
}
