using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using MediaDetector.Core.Dependencies;
using MediaDetector.Core.Formatting;
using MediaDetector.Core.Formats;
using MediaDetector.Core.Models;
using MediaDetector.Core.Naming;
using MediaDetector.Core.Services;
using MediaDetector.Core.Validation;

namespace MediaDetector.App.ViewModels;

public sealed partial class MainViewModel : ObservableObject
{
    private readonly DetectService _detect = new();

    [ObservableProperty] private string _url = "";
    [ObservableProperty] private bool _detecting;
    [ObservableProperty] private string? _error;
    [ObservableProperty] private MediaInfo? _media;
    [ObservableProperty] private PlaylistInfo? _playlist;
    [ObservableProperty] private FileNameViewModel? _fileName;
    [ObservableProperty] private FormatTabsViewModel? _formats;
    [ObservableProperty] private PlaylistPanelViewModel? _playlistPanel;

    // Hoisted here because app/page.tsx:30 reads useCleanNames() once and hands
    // the same value to BOTH the single-video and playlist flows. Owning a copy
    // per panel would let the two disagree.
    [ObservableProperty] private bool _cleanNames = App.Settings.CleanNames;

    public StatusBarViewModel Status { get; } =
        new(new StatusService(_ => DependencyChecker.BuildDefaultAsync()));

    public OutputDirViewModel OutputDir { get; } = new();
    public ThemeViewModel Theme { get; } = new();
    public LogViewModel Log { get; } = new();

    public bool HasError => Error != null;

    // Drives the "Download" section label, which should not sit above an empty
    // area before anything has been detected.
    public bool HasResults => Formats != null || PlaylistPanel != null;

    public Task InitAsync() => Status.LoadAsync();

    partial void OnErrorChanged(string? value) => OnPropertyChanged(nameof(HasError));
    partial void OnFormatsChanged(FormatTabsViewModel? value) => OnPropertyChanged(nameof(HasResults));
    partial void OnPlaylistPanelChanged(PlaylistPanelViewModel? value)
        => OnPropertyChanged(nameof(HasResults));

    partial void OnCleanNamesChanged(bool value)
    {
        App.Settings.CleanNames = value;
        App.Settings.Save();
        if (FileName != null) FileName.Clean = value;
        PlaylistPanel?.RefreshNames();
    }

    [RelayCommand]
    private async Task DetectAsync(CancellationToken ct)
    {
        Error = null;
        Media = null;
        Playlist = null;
        Detecting = true;
        try
        {
            var kind = YouTubeUrl.GetKind(Url);
            if (!kind.HasVideo && !kind.HasPlaylist)
            {
                Error = "Enter a YouTube video or playlist link";
                return;
            }

            // Both flows run for a watch+list URL, as in page.tsx.
            if (kind.HasVideo)
            {
                var result = await _detect.DetectVideoAsync(Url, ct);
                if (result.Ok) Media = result.Value;
                else Error = result.Error;
            }
            if (kind.HasPlaylist)
            {
                var result = await _detect.DetectPlaylistAsync(Url, ct);
                // Playlist failure is non-fatal -- the single-video flow may still work.
                if (result.Ok) Playlist = result.Value;
            }
        }
        finally
        {
            Detecting = false;
        }
    }

    [RelayCommand] private void DismissError() => Error = null;

    // This is the seam the whole "one source of truth" guarantee rests on: if
    // BuildRequest read a stale copy of CleanNames or CustomName, the previewed
    // name and the file on disk would diverge. It is a closure over the live view
    // models, never a snapshot.
    partial void OnMediaChanged(MediaInfo? value)
    {
        if (value == null)
        {
            FileName = null;
            Formats = null;
            return;
        }

        var source = new NameSource(value.Title, value.Track, value.Artist, Uploader: value.Channel);
        FileName = new FileNameViewModel { Source = source, Clean = CleanNames };

        Formats = FormatTabsViewModel.From(value, f =>
        {
            var isAudio = f is AudioFormat;
            var badge = f switch
            {
                VideoFormat v => $"{v.Height}p",
                AudioFormat a => $"{a.Abr ?? 0:0}kbps",
                _ => "",
            };
            var codec = f switch
            {
                VideoFormat v => v.Vcodec,
                AudioFormat a => a.Acodec,
                _ => "",
            };
            var fps = f is VideoFormat vf && vf.Fps != null ? $"{vf.Fps:0}fps" : null;

            return new FormatRowViewModel
            {
                BuildRequest = () => new DownloadRequest(
                    Url, f.FormatId, source, f.Ext, OutputDir.Dir, CleanNames, FileName?.CustomName),
                Badge = badge,
                Ext = f.Ext.ToUpperInvariant(),
                Codec = codec,
                FpsText = fps,
                SizeText = f.Filesize == null ? "unknown size" : DisplayFormat.FormatBytes(f.Filesize),
                IsApplePlayable = AudioCompat.IsApplePlayable(f.Ext),
                IsAudio = isAudio,
            };
        });
    }

    partial void OnPlaylistChanged(PlaylistInfo? value)
    {
        if (value == null)
        {
            PlaylistPanel = null;
            return;
        }

        var panel = new PlaylistPanelViewModel
        {
            Url = Url,
            PlaylistTitle = value.Title,
            GetCleanNames = () => CleanNames,
            GetOutputDir = () => OutputDir.Dir,
            GetFfmpegReady = () => Status.Current?.Ffmpeg.Found == true,
        };
        foreach (var t in value.Tracks)
        {
            panel.Tracks.Add(new PlaylistTrackViewModel
            {
                Index = t.Index,
                OriginalTitle = t.Title,
                Author = t.Author,
                GetClean = () => CleanNames,
                GetShowOriginal = () => panel.ShowOriginalTitles,
            });
        }
        panel.Total = value.Count;
        PlaylistPanel = panel;
    }
}
