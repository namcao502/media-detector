using MediaDetector.Core.Models;
using MediaDetector.Core.Ytdlp;

namespace MediaDetector.Core.Tests.Ytdlp;

public class FormatArgsTests
{
    private static string Selector(string[] args) => args[Array.IndexOf(args, "-f") + 1];

    // YouTube's plain bestaudio is opus-in-webm, so -x --audio-format m4a without
    // a selector transcodes every track. Asking for an AAC source makes it a
    // lossless remux instead.
    [Fact]
    public void Audio_M4a_AsksForAacSourceSoExtractionIsARemux()
    {
        var (args, ext) = FormatArgs.ForPlaylist(
            new PlaylistFormatSelection(PlaylistMode.Audio, PlaylistAudioFormat.M4a), true);
        Assert.StartsWith("bestaudio[ext=m4a]", Selector(args));
        Assert.Contains("-x", args);
        Assert.Equal("m4a", ext);
    }

    // Bare bestaudio[ext=m4a] selects the 5.1 surround track where one exists
    // (format 258 at 388kbps vs 140's 129kbps), tripling the bytes.
    [Fact]
    public void Audio_M4a_ConstrainsToStereo()
    {
        var (args, _) = FormatArgs.ForPlaylist(
            new PlaylistFormatSelection(PlaylistMode.Audio, PlaylistAudioFormat.M4a), true);
        Assert.Contains("[audio_channels<=2]", Selector(args));
    }

    [Fact]
    public void Audio_M4a_WithoutFfmpeg_DoesNotRequestExtraction()
    {
        var (args, ext) = FormatArgs.ForPlaylist(
            new PlaylistFormatSelection(PlaylistMode.Audio, PlaylistAudioFormat.M4a), false);
        Assert.DoesNotContain("-x", args);
        Assert.Equal("m4a", ext);
    }

    [Fact]
    public void Audio_Mp3_StartsFromTheAacSource()
    {
        var (args, ext) = FormatArgs.ForPlaylist(
            new PlaylistFormatSelection(PlaylistMode.Audio, PlaylistAudioFormat.Mp3), true);
        Assert.StartsWith("bestaudio[ext=m4a]", Selector(args));
        Assert.Equal("mp3", ext);
    }

    // Native audio, no conversion -> report webm so no thumbnail is requested
    // (webm cannot embed one -> no stray .webp left beside the audio).
    [Fact]
    public void Audio_Best_ReportsWebmSoNoThumbnailIsRequested()
    {
        var (args, ext) = FormatArgs.ForPlaylist(
            new PlaylistFormatSelection(PlaylistMode.Audio, PlaylistAudioFormat.Best), true);
        Assert.Equal("bestaudio/best", Selector(args));
        Assert.Equal("webm", ext);
        Assert.DoesNotContain("--embed-thumbnail", FormatArgs.Metadata(true, ext));
    }

    [Theory]
    [InlineData(PlaylistVideoQuality.Q1080, "[height<=1080]")]
    [InlineData(PlaylistVideoQuality.Q720, "[height<=720]")]
    public void Video_CapsHeight(PlaylistVideoQuality quality, string cap)
    {
        var (args, ext) = FormatArgs.ForPlaylist(
            new PlaylistFormatSelection(PlaylistMode.Video, VideoQuality: quality), true);
        Assert.Contains(cap, Selector(args));
        Assert.Contains("--merge-output-format", args);
        Assert.Equal("mp4", ext);
    }

    [Fact]
    public void Video_Best_HasNoHeightCap()
    {
        var (args, _) = FormatArgs.ForPlaylist(
            new PlaylistFormatSelection(PlaylistMode.Video,
                VideoQuality: PlaylistVideoQuality.Best), true);
        Assert.DoesNotContain("height<=", Selector(args));
    }

    [Fact]
    public void Metadata_EmptyWithoutFfmpeg()
        => Assert.Empty(FormatArgs.Metadata(false, "m4a"));

    [Fact]
    public void Metadata_EmbedsTextAndChaptersForAnyContainer()
    {
        var args = FormatArgs.Metadata(true, "webm");
        Assert.Contains("--embed-metadata", args);
        Assert.Contains("--embed-chapters", args);
        // webm cannot hold a thumbnail -- passing it makes yt-dlp error.
        Assert.DoesNotContain("--embed-thumbnail", args);
    }

    [Theory]
    [InlineData("m4a")]
    [InlineData("mp4")]
    [InlineData("mp3")]
    public void Metadata_EmbedsThumbnailForCapableContainers(string ext)
        => Assert.Contains("--embed-thumbnail", FormatArgs.Metadata(true, ext));

    // Omitting ext means "unknown container" -> request the thumbnail.
    [Fact]
    public void Metadata_EmbedsThumbnailWhenExtUnknown()
        => Assert.Contains("--embed-thumbnail", FormatArgs.Metadata(true, null));

    [Theory]
    [InlineData("Normal Name", "Normal Name")]
    [InlineData("a/b:c*d?e", "a_b_c_d_e")]
    [InlineData("trailing dots...", "trailing dots")]
    [InlineData("   ", "Playlist")]
    public void SanitizeFolderName_StripsIllegalCharacters(string input, string expected)
        => Assert.Equal(expected, FormatArgs.SanitizeFolderName(input));
}
