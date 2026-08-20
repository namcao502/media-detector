using MediaDetector.Core.Formats;
using MediaDetector.Core.Models;

namespace MediaDetector.Core.Tests.Formats;

public class FormatSelectionTests
{
    private static VideoFormat V(string id, int h, string ext = "mp4", double? fps = null) =>
        new(id, ext, h * 16 / 9, h, fps, "avc1", null);

    private static AudioFormat A(string id, double? abr, string ext = "m4a") =>
        new(id, ext, abr, "mp4a", null);

    [Theory]
    [InlineData("m4a", true)]
    [InlineData("mp3", true)]
    [InlineData("aac", true)]
    [InlineData("mp4", true)]
    [InlineData("webm", false)]
    [InlineData("opus", false)]
    public void IsApplePlayable_MatchesIosNativeContainers(string ext, bool expected)
        => Assert.Equal(expected, AudioCompat.IsApplePlayable(ext));

    [Fact]
    public void SortAudioForApple_FloatsPlayableToTopPreservingOrder()
    {
        var input = new[] { A("1", 160, "webm"), A("2", 128), A("3", 70, "opus"), A("4", 48) };
        var sorted = AudioCompat.SortAudioForApple(input);
        Assert.Equal(["2", "4", "1", "3"], sorted.Select(f => f.FormatId));
    }

    [Fact]
    public void SortAudioForApple_DoesNotMutateInput()
    {
        var input = new[] { A("1", 160, "webm"), A("2", 128) };
        AudioCompat.SortAudioForApple(input);
        Assert.Equal("1", input[0].FormatId);
    }

    [Fact]
    public void RecommendedVideo_PicksHighestResolution()
        => Assert.Equal("hi", Recommend.VideoId([V("lo", 720), V("hi", 1080)]));

    [Fact]
    public void RecommendedVideo_BreaksResolutionTieTowardMp4()
        => Assert.Equal("mp4one", Recommend.VideoId([V("webmone", 1080, "webm"), V("mp4one", 1080)]));

    [Fact]
    public void RecommendedVideo_BreaksContainerTieTowardHigherFps()
        => Assert.Equal("sixty",
            Recommend.VideoId([V("thirty", 1080, "mp4", 30), V("sixty", 1080, "mp4", 60)]));

    [Fact]
    public void RecommendedVideo_NullWhenEmpty()
        => Assert.Null(Recommend.VideoId([]));

    [Fact]
    public void RecommendedAudio_PrefersHighestBitrateAmongApplePlayable()
        => Assert.Equal("m4ahigh",
            Recommend.AudioId([A("opushigh", 160, "opus"), A("m4ahigh", 128), A("m4alow", 48)]));

    // Only falls back to the overall best when nothing Apple-playable is offered.
    [Fact]
    public void RecommendedAudio_FallsBackWhenNothingPlayable()
        => Assert.Equal("opushigh",
            Recommend.AudioId([A("opuslow", 70, "opus"), A("opushigh", 160, "webm")]));

    [Fact]
    public void RecommendedAudio_NullWhenEmpty()
        => Assert.Null(Recommend.AudioId([]));
}
