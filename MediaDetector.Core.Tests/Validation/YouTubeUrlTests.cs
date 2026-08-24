using MediaDetector.Core.Validation;

namespace MediaDetector.Core.Tests.Validation;

public class YouTubeUrlTests
{
    [Theory]
    [InlineData("https://www.youtube.com/watch?v=abc123")]
    [InlineData("https://youtube.com/watch?v=abc123")]
    [InlineData("https://music.youtube.com/watch?v=abc123")]
    [InlineData("https://youtu.be/abc123")]
    public void IsYouTubeUrl_AcceptsAllowedHosts(string url)
        => Assert.True(YouTubeUrl.IsYouTubeUrl(url));

    [Theory]
    [InlineData("")]
    [InlineData("not a url")]
    [InlineData("https://vimeo.com/12345")]
    [InlineData("https://evil.com/watch?v=abc")]
    // A lookalike host must not pass on a suffix match.
    [InlineData("https://notyoutube.com/watch?v=abc")]
    public void IsYouTubeUrl_RejectsEverythingElse(string url)
        => Assert.False(YouTubeUrl.IsYouTubeUrl(url));

    [Fact]
    public void GetKind_WatchUrlIsVideoOnly()
    {
        var kind = YouTubeUrl.GetKind("https://www.youtube.com/watch?v=abc123");
        Assert.True(kind.HasVideo);
        Assert.False(kind.HasPlaylist);
    }

    [Fact]
    public void GetKind_WatchPlusListIsBoth()
    {
        var kind = YouTubeUrl.GetKind("https://www.youtube.com/watch?v=abc&list=PL123");
        Assert.True(kind.HasVideo);
        Assert.True(kind.HasPlaylist);
    }

    // RD* is an auto-generated radio/mix -- endless, not a real playlist.
    [Fact]
    public void GetKind_ExcludesRadioMixPlaylists()
    {
        var kind = YouTubeUrl.GetKind("https://www.youtube.com/watch?v=abc&list=RDabc");
        Assert.True(kind.HasVideo);
        Assert.False(kind.HasPlaylist);
    }

    [Fact]
    public void GetKind_ShortLinkIsVideo()
        => Assert.True(YouTubeUrl.GetKind("https://youtu.be/abc123").HasVideo);

    [Fact]
    public void GetKind_BareShortLinkHostIsNotVideo()
        => Assert.False(YouTubeUrl.GetKind("https://youtu.be/").HasVideo);

    [Fact]
    public void GetKind_NonYouTubeIsNeither()
    {
        var kind = YouTubeUrl.GetKind("https://vimeo.com/1");
        Assert.False(kind.HasVideo);
        Assert.False(kind.HasPlaylist);
    }
}
