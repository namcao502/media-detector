using MediaDetector.Core.Naming;

namespace MediaDetector.Core.Tests.Naming;

public class FileNamingTests
{
    [Fact]
    public void ArtistGoesAfterTitle()
        => Assert.Equal("Instant Crush - Daft Punk",
            FileNaming.DownloadStem(new NameSource("Instant Crush", Artist: "Daft Punk")));

    [Fact]
    public void DuplicatedAuthorPrefixIsDropped()
        => Assert.Equal("Instant Crush - Daft Punk",
            FileNaming.DownloadStem(new NameSource("Daft Punk - Instant Crush", Uploader: "Daft Punk")));

    [Fact]
    public void TopicSuffixStripped()
        => Assert.Equal("Son Tung M-TP", FileNaming.StripTopicSuffix("Son Tung M-TP - Topic"));

    [Fact]
    public void QuotedNameWithCastEitherSide()
    {
        var p = FileNaming.ParseShowTitle("PBN 66 | Hài kịch \"Trần Trừng Trị\" - Kiều Linh, Chí Tài");
        Assert.NotNull(p);
        Assert.Equal("Trần Trừng Trị", p!.Track);
        Assert.Equal("Kiều Linh, Chí Tài", p.Cast);
    }

    [Fact]
    public void GenreThenLeadingCastThenName()
    {
        var p = FileNaming.ParseShowTitle("Hài Hoài Linh, Chí Tài - Con Sáo Sang Sông");
        Assert.NotNull(p);
        Assert.Equal("Con Sáo Sang Sông", p!.Track);
        Assert.Equal("Hoài Linh, Chí Tài", p.Cast);
    }

    [Fact]
    public void TrailingCastList()
    {
        var p = FileNaming.ParseShowTitle("Hài Kịch Chuyện Ba Người - Hoài Linh, Long Đẹp Trai, Tú Tri");
        Assert.NotNull(p);
        Assert.Equal("Chuyện Ba Người", p!.Track);
        Assert.Equal("Hoài Linh, Long Đẹp Trai, Tú Tri", p.Cast);
    }

    // The diacritic anchors must keep the blast radius tiny.
    [Fact]
    public void AsciiLookalikeDoesNotMatch()
        => Assert.Null(FileNaming.ParseShowTitle("Hai Phong, Ha Noi - Trip"));

    // BRAND_SEGMENTS: whole pipe segment only.
    [Fact]
    public void BrandSegmentsDroppedButNameSurvivesInCastList()
    {
        var p = FileNaming.ParseShowTitle("Hài Chí Tài, Thúy Nga - Áo Em | Thúy Nga | Paris By Night");
        Assert.NotNull(p);
        Assert.Equal("Áo Em", p!.Track);
        Assert.Equal("Chí Tài, Thúy Nga", p.Cast);
    }

    [Fact]
    public void SeriesLabelKeptOutOfTheCast()
    {
        var p = FileNaming.ParseShowTitle("Hài Kịch \"Tệ Hơn Vợ Thằng Đậu\" | Phi Nhung, Bảo Chung | Về Quê Em 1");
        Assert.NotNull(p);
        Assert.Equal("Tệ Hơn Vợ Thằng Đậu", p!.Track);
        Assert.Equal("Phi Nhung, Bảo Chung", p.Cast);
    }

    [Fact]
    public void GenreWordInsideALongerPhraseSurvives()
    {
        var p = FileNaming.ParseShowTitle("Hài Kịch Mới || Cổ Tích Một Tình Yêu || Hoài Linh, Chí Tài");
        Assert.NotNull(p);
        Assert.Equal("Hài Kịch Mới || Cổ Tích Một Tình Yêu", p!.Track);
    }

    [Fact]
    public void PromoCopyIsNotACast()
    {
        Assert.False(FileNaming.LooksLikeCast("Vở hài kịch lấy nhiều nước mắt khán giả của Xuân Bắc, Tự Long"));
        Assert.False(FileNaming.LooksLikeCast("Chí Tài Xem Đi Xem lại 10000 Lần Không Chán"));
        Assert.False(FileNaming.LooksLikeCast("Hot"));
        Assert.True(FileNaming.LooksLikeCast("Kiều Linh, Trang Thanh Lan, Chí Tài"));
        Assert.True(FileNaming.LooksLikeCast("Hồng Đào & Quang Minh"));
    }

    [Fact]
    public void BlurbTailDoesNotInvertTheTitle()
    {
        Assert.Null(FileNaming.ParseShowTitle(
            "Hài Hoài Linh, Chí Tài Xem Đi Xem lại 10000 Lần Không Chán - Hài Kịch Không Xem Tiếc Cả Đời"));
        Assert.Null(FileNaming.ParseShowTitle(
            "HÀI TẾT MỚI NHẤT -BÍ MẬT CỦA MẸ - Vở hài kịch lấy nhiều nước mắt khán giả của Xuân Bắc, Tự Long"));
    }

    [Fact]
    public void DaftPunkSurvivesTheFtRule()
        => Assert.Equal("Daft Punk", FileNaming.CleanTitle("Daft Punk"));

    [Fact]
    public void BareYearSurvivesTheQualityRule()
        => Assert.Equal("Blade Runner 2049", FileNaming.CleanTitle("Blade Runner 2049"));

    [Fact]
    public void QualityMarkersStripped()
        => Assert.Equal("Song", FileNaming.CleanTitle("Song 1080p 60fps 4K"));

    [Fact]
    public void BracketedPromoStripped()
        => Assert.Equal("Song", FileNaming.CleanTitle("Song (Official Music Video)"));

    [Theory]
    [InlineData("a/b", "a\u29F8b")]
    [InlineData("a\\b", "a\u29F9b")]
    [InlineData("a:b", "a\uFF1Ab")]
    [InlineData("a?b", "a\uFF1Fb")]
    [InlineData("a|b", "a\uFF5Cb")]
    public void FullWidthSubstitutions(string input, string expected)
        => Assert.Equal(expected, FileNaming.SanitizeFilename(input));

    // U+0085 is a control char to char.IsControl but the TS class keeps it.
    [Fact]
    public void C1ControlCharactersAreKept()
        => Assert.Equal("a\u0085b", FileNaming.SanitizeFilename("a\u0085b"));

    [Fact]
    public void AsciiControlCharactersAreStripped()
        => Assert.Equal("ab", FileNaming.SanitizeFilename("a\u0001b"));

    [Theory]
    [InlineData("../../etc/passwd")]
    [InlineData("..\\..\\Windows\\System32")]
    public void UserStemCannotEscapeTheFolder(string evil)
    {
        var safe = FileNaming.SanitizeUserStem(evil);
        Assert.NotNull(safe);
        Assert.DoesNotContain('/', safe!);
        Assert.DoesNotContain('\\', safe);
    }

    [Theory]
    [InlineData("")]
    [InlineData("   ")]
    [InlineData(".")]
    [InlineData("..")]
    public void UnusableUserStemsRejected(string input)
        => Assert.Null(FileNaming.SanitizeUserStem(input));

    [Fact]
    public void PercentIsDoubled()
        => Assert.Equal(@"C:\out\100%% Song.%(ext)s",
            FileNaming.OutputTemplateFor(@"C:\out\100% Song"));

    // JS || falls through on empty string; C# ?? would not.
    [Fact]
    public void EmptyArtistFallsThroughToUploader()
        => Assert.Equal("Song - Some Channel",
            FileNaming.DownloadStem(new NameSource("Song", Artist: "", Uploader: "Some Channel")));

    [Fact]
    public void EmptyTrackFallsThroughToTitle()
        => Assert.Equal("Real Title - A",
            FileNaming.DownloadStem(new NameSource("Real Title", Track: "", Artist: "A")));

    [Fact]
    public void AllCreditsEmptyGivesUnknown()
        => Assert.Equal("Unknown",
            FileNaming.EffectiveAuthor(new NameSource("T", Artist: "", Uploader: "", Channel: "")));

    // JS splits on /\s+/, so a non-breaking space must count as a separator.
    [Fact]
    public void NonBreakingSpaceCountsAsAWordSeparator()
        => Assert.False(FileNaming.LooksLikeCast("A\u00A0B\u00A0C\u00A0D\u00A0E"));

    [Fact]
    public void SplitNameMatchesTheTwoPiecesDownloadStemJoins()
    {
        var source = new NameSource("Instant Crush", Artist: "Daft Punk");
        var (title, artist) = FileNaming.SplitName(source);
        Assert.Equal("Instant Crush", title);
        Assert.Equal("Daft Punk", artist);
        Assert.Equal($"{title} - {artist}", FileNaming.DownloadStem(source));
    }

    [Fact]
    public void SplitNameUsesTheShowTrackForAVietnameseShowTitle()
    {
        var source = new NameSource("H\u00E0i Ho\u00E0i Linh, Ch\u00ED T\u00E0i - Con S\u00E1o Sang S\u00F4ng");
        var (title, artist) = FileNaming.SplitName(source);
        Assert.Equal("Con S\u00E1o Sang S\u00F4ng", title);
        Assert.Equal("Ho\u00E0i Linh, Ch\u00ED T\u00E0i", artist);
    }

    [Fact]
    public void MetadataOverrideIsSkippedWhenRawNameAlreadyMatchesTheDefaultEmbed()
        => Assert.Null(FileNaming.MetadataOverrideFor(
            new NameSource("Song", Artist: "Daft Punk"), cleanNames: false, customTitle: null));

    [Fact]
    public void MetadataOverrideUsesTheSplitWhenCleanNamesIsOn()
    {
        var tags = FileNaming.MetadataOverrideFor(
            new NameSource("Instant Crush", Artist: "Daft Punk"), cleanNames: true, customTitle: null);
        Assert.NotNull(tags);
        Assert.Equal("Instant Crush", tags!.Value.Title);
        Assert.Equal("Daft Punk", tags.Value.Artist);
    }

    [Fact]
    public void MetadataOverrideUsesTheTypedTitleUntouchedByFilenameSanitization()
    {
        var tags = FileNaming.MetadataOverrideFor(
            new NameSource("Song", Artist: "Daft Punk"), cleanNames: false, customTitle: "  a: b  ");
        Assert.NotNull(tags);
        Assert.Equal("a: b", tags!.Value.Title);
        Assert.Equal("Daft Punk", tags.Value.Artist);
    }
}
