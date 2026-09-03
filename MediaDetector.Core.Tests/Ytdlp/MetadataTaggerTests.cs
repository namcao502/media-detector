using MediaDetector.Core.Ytdlp;

namespace MediaDetector.Core.Tests.Ytdlp;

// None of this was testable while tagging shelled out to `python -c "from
// mutagen import File"`: the suite would have needed a Python with mutagen on
// it. TagLib# runs in process, so these are ordinary unit tests over real files.
public class MetadataTaggerTests : IDisposable
{
    private readonly string _root =
        Path.Combine(Path.GetTempPath(), $"md-tagger-{Guid.NewGuid():N}");

    public MetadataTaggerTests() => Directory.CreateDirectory(_root);

    public void Dispose()
    {
        if (Directory.Exists(_root)) Directory.Delete(_root, recursive: true);
        GC.SuppressFinalize(this);
    }

    private string MakeMp3(string name = "song.mp3") => MediaFixtures.WriteMp3(_root, name);

    private string MakeJpeg(string name = "cover.jpg") => MediaFixtures.WriteJpeg(_root, name);

    [Fact]
    public async Task TryWriteTags_RoundTripsTitleAndArtist()
    {
        var path = MakeMp3();

        Assert.True(await MetadataTagger.TryWriteTagsAsync(path, ("Bài Học", "Việt Hương")));

        var tags = await MetadataTagger.ReadTagsAsync(path);
        Assert.NotNull(tags);
        Assert.Equal("Bài Học", tags.Value.Title);
        Assert.Equal("Việt Hương", tags.Value.Artist);
    }

    // The exact failure the PYTHONIOENCODING bug produced was a mangled path, but
    // the tag VALUES travelled through the same pipe. In process there is no pipe
    // at all, which is the point -- pin it so nothing reintroduces one.
    [Fact]
    public async Task TryWriteTags_KeepsVietnameseDiacriticsIntact()
    {
        var path = MakeMp3();
        const string title = "hài kịch";

        await MetadataTagger.TryWriteTagsAsync(path, (title, "Thúy Nga"));

        var tags = await MetadataTagger.ReadTagsAsync(path);
        Assert.Equal(title, tags!.Value.Title);
        Assert.DoesNotContain('?', tags.Value.Title);
    }

    // The raw-mode branch, and the easiest thing to get wrong: MetadataOverrideFor
    // returns null when Clean names is off, and the cover art still has to be
    // written while yt-dlp's own --embed-metadata title is left alone.
    [Fact]
    public async Task TryWriteTags_WritesCoverArtWithoutTouchingTitleWhenOverrideIsNull()
    {
        var path = MakeMp3();
        await MetadataTagger.TryWriteTagsAsync(path, ("Original Title", "Original Artist"));

        Assert.True(await MetadataTagger.TryWriteTagsAsync(path, null, MakeJpeg()));

        using var file = TagLib.File.Create(path);
        Assert.Single(file.Tag.Pictures);
        Assert.Equal("Original Title", file.Tag.Title);
        Assert.Equal("Original Artist", file.Tag.FirstPerformer);
    }

    [Fact]
    public async Task TryWriteTags_WritesTitleAndCoverArtTogether()
    {
        var path = MakeMp3();

        Assert.True(await MetadataTagger.TryWriteTagsAsync(path, ("T", "A"), MakeJpeg()));

        using var file = TagLib.File.Create(path);
        Assert.Equal("T", file.Tag.Title);
        Assert.Single(file.Tag.Pictures);
    }

    // Nothing asked for means nothing written -- this is what keeps a repeat
    // backfill from rewriting every file it looks at.
    [Fact]
    public async Task TryWriteTags_ReturnsFalseWhenThereIsNothingToWrite()
        => Assert.False(await MetadataTagger.TryWriteTagsAsync(MakeMp3(), null, null));

    [Fact]
    public async Task TryWriteTags_ReturnsFalseForAMissingPath()
    {
        Assert.False(await MetadataTagger.TryWriteTagsAsync(null, ("T", "A")));
        Assert.False(await MetadataTagger.TryWriteTagsAsync(
            Path.Combine(_root, "nope.mp3"), ("T", "A")));
    }

    // A container TagLib# cannot open must be logged and reported, never thrown:
    // a tag failure has to leave an otherwise successful download alone.
    [Fact]
    public async Task TryWriteTags_ReturnsFalseForAnUnsupportedContainerInsteadOfThrowing()
    {
        var path = Path.Combine(_root, "notaudio.webm");
        await File.WriteAllTextAsync(path, "definitely not media");

        Assert.False(await MetadataTagger.TryWriteTagsAsync(path, ("T", "A")));
    }

    [Fact]
    public async Task ReadTags_ReturnsNullForAFileItCannotOpen()
    {
        var path = Path.Combine(_root, "notaudio.webm");
        await File.WriteAllTextAsync(path, "definitely not media");

        Assert.Null(await MetadataTagger.ReadTagsAsync(path));
    }

    // An untagged file reads as empty strings rather than null -- the caller
    // treats null as "could not read", which is a different outcome.
    [Fact]
    public async Task ReadTags_ReturnsEmptyStringsForAnUntaggedFile()
    {
        var tags = await MetadataTagger.ReadTagsAsync(MakeMp3());
        Assert.NotNull(tags);
        Assert.Equal("", tags.Value.Title);
        Assert.Equal("", tags.Value.Artist);
    }
}
