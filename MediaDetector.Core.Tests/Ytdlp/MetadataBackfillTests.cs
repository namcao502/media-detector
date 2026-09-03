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
    // webm/opus stay out even though TagLib# could open an .opus: the download
    // path does not correct their tags either, so including them here would start
    // rewriting files nothing else touches.
    [InlineData("song.webm", false)]
    [InlineData("song.opus", false)]
    [InlineData("cover.webp", false)]
    public void IsTaggable_AcceptsOnlyContainersWeAlsoTagOnDownload(string name, bool expected)
        => Assert.Equal(expected, MetadataBackfill.IsTaggable(name));
}

// The 142 files the encoding bug left behind: correct filename, uncorrected tag,
// and the fetched .jpg still sitting beside each one.
public class MetadataBackfillRunTests : IDisposable
{
    private readonly string _root =
        Path.Combine(Path.GetTempPath(), $"md-backfill-{Guid.NewGuid():N}");

    public MetadataBackfillRunTests() => Directory.CreateDirectory(_root);

    public void Dispose()
    {
        if (Directory.Exists(_root)) Directory.Delete(_root, recursive: true);
        GC.SuppressFinalize(this);
    }

    private async Task<string> MakeTrackAsync(string stem, string title, string artist, bool withCover)
    {
        var path = MediaFixtures.WriteMp3(_root, $"{stem}.mp3");
        await MetadataTagger.TryWriteTagsAsync(path, (title, artist));
        if (withCover) MediaFixtures.WriteJpeg(_root, $"{stem}.jpg");
        return path;
    }

    [Fact]
    public void CoverFor_MatchesOnlyTheSiblingWithTheSameStem()
    {
        var path = MediaFixtures.WriteMp3(_root, "song.mp3");
        Assert.Null(MetadataBackfill.CoverFor(path));

        MediaFixtures.WriteJpeg(_root, "unrelated.jpg");
        Assert.Null(MetadataBackfill.CoverFor(path));

        var cover = MediaFixtures.WriteJpeg(_root, "song.jpg");
        Assert.Equal(cover, MetadataBackfill.CoverFor(path));
    }

    [Fact]
    public async Task RunAsync_EmbedsTheStrayCoverThenDeletesIt()
    {
        var path = await MakeTrackAsync(
            "track", "Hài Kịch \"Bài Học Nhớ Đời\" | PBN 123 | Việt Hương, Chí Tài", "Thuy Nga",
            withCover: true);

        var report = await MetadataBackfill.RunAsync([path]);

        Assert.Equal(1, report.Updated);
        Assert.Equal(1, report.CoversEmbedded);
        Assert.False(File.Exists(Path.ChangeExtension(path, ".jpg")));

        using var file = TagLib.File.Create(path);
        Assert.Single(file.Tag.Pictures);
        Assert.Equal("Bài Học Nhớ Đời", file.Tag.Title);
    }

    // The case that breaks if cover art is gated behind the tag correction: this
    // file's tag is already right, and only the stray .jpg needs dealing with.
    [Fact]
    public async Task RunAsync_RepairsCoverArtEvenWhenTheTagIsAlreadyCorrect()
    {
        var path = await MakeTrackAsync(
            "ok", "Bài Học Nhớ Đời", "Việt Hương, Chí Tài, Thúy Nga, Hoài Tâm", withCover: true);

        var report = await MetadataBackfill.RunAsync([path]);

        Assert.Equal(1, report.CoversEmbedded);
        Assert.Equal(0, report.AlreadyCorrect);
        Assert.False(File.Exists(Path.ChangeExtension(path, ".jpg")));
    }

    // Deleting the image is what makes the second pass a no-op rather than a
    // rewrite of every file in the folder.
    [Fact]
    public async Task RunAsync_IsIdempotent()
    {
        var path = await MakeTrackAsync(
            "again", "Hài Kịch \"Cha Già Dấu Yêu\" | PBN 106 | Chí Tài, Việt Hương", "Thuy Nga",
            withCover: true);

        await MetadataBackfill.RunAsync([path]);
        var second = await MetadataBackfill.RunAsync([path]);

        Assert.Equal(0, second.Updated);
        Assert.Equal(0, second.CoversEmbedded);
        Assert.Equal(1, second.AlreadyCorrect);
    }

    // Unlike a fresh download this image is the only copy, so a file we cannot
    // write must keep its .jpg rather than lose it.
    [Fact]
    public async Task RunAsync_KeepsTheCoverWhenTheFileCannotBeTagged()
    {
        var path = Path.Combine(_root, "broken.mp3");
        await File.WriteAllTextAsync(path, "not audio at all");
        var cover = MediaFixtures.WriteJpeg(_root, "broken.jpg");

        var report = await MetadataBackfill.RunAsync([path]);

        Assert.Equal(1, report.Failed);
        Assert.Equal(0, report.CoversEmbedded);
        Assert.True(File.Exists(cover));
    }
}
