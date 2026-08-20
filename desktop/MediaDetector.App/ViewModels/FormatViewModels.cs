using System.Collections.ObjectModel;
using System.Diagnostics;   // UnreachableException
using System.Windows;
using System.Windows.Threading;
using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using MediaDetector.Core.Formats;
using MediaDetector.Core.Formatting;
using MediaDetector.Core.Models;
using MediaDetector.Core.Services;
using MediaDetector.Core.Storage;

namespace MediaDetector.App.ViewModels;

public sealed partial class FormatTabsViewModel : ObservableObject
{
    public ObservableCollection<FormatRowViewModel> VideoRows { get; } = [];
    public ObservableCollection<FormatRowViewModel> AudioRows { get; } = [];

    [ObservableProperty] private bool _audioTabActive;

    public int VideoCount => VideoRows.Count;
    public int AudioCount => AudioRows.Count;

    // The callback takes IMediaFormat because VideoFormat and AudioFormat share
    // no base -- see Models/MediaModels.cs.
    public static FormatTabsViewModel From(
        MediaInfo info, Func<IMediaFormat, FormatRowViewModel> makeRow)
    {
        var tabs = new FormatTabsViewModel();
        var bestVideo = Recommend.VideoId(info.VideoFormats);
        var bestAudio = Recommend.AudioId(info.AudioFormats);

        foreach (var f in info.VideoFormats)
        {
            var row = makeRow(f);
            row.IsRecommended = f.FormatId == bestVideo;
            tabs.VideoRows.Add(row);
        }

        // Apple-playable containers float to the top, bitrate order preserved.
        foreach (var f in AudioCompat.SortAudioForApple(info.AudioFormats))
        {
            var row = makeRow(f);
            row.IsRecommended = f.FormatId == bestAudio;
            tabs.AudioRows.Add(row);
        }

        return tabs;
    }
}

public sealed partial class FormatRowViewModel : StreamingViewModel
{
    // yt-dlp emits a progress line roughly every 100ms while bytes are moving, so
    // a longer gap means the transfer (or a postprocessor) is not talking.
    private const int StallAfterSeconds = 5;

    private readonly DownloadService _service = new();
    private readonly DispatcherTimer _idleTimer;
    private CancellationTokenSource? _cts;
    private DateTime? _lastUpdateAt;

    public required Func<DownloadRequest> BuildRequest { get; init; }

    // Display surface the row's view binds to.
    public required string Badge { get; init; }        // "1080p" or "129kbps"
    public required string Ext { get; init; }
    public required string Codec { get; init; }
    public string? FpsText { get; init; }              // "60fps", or null
    public required string SizeText { get; init; }
    public bool IsApplePlayable { get; init; }
    public bool IsAudio { get; init; }

    [ObservableProperty] private bool _isRecommended;
    [ObservableProperty] private double _percent;
    [ObservableProperty] private string? _savedPath;
    [ObservableProperty] private string? _phaseLabel;
    [ObservableProperty] private string? _detailText;
    [ObservableProperty] private string? _error;
    [ObservableProperty] private bool _cancelled;
    [ObservableProperty] private bool _isDownloading;
    [ObservableProperty] private int _idleSeconds;
    [ObservableProperty] private string? _openError;

    public bool IsStalled => IsDownloading && IdleSeconds >= StallAfterSeconds;
    public bool ShowProgress => IsDownloading || SavedPath != null || Error != null || Cancelled;
    public bool ShowBar => IsDownloading && SavedPath == null && Error == null && !Cancelled;
    // Finished: the bar has nothing left to say, so it gives way to the verified row.
    public string? SavedFolder => SavedPath == null ? null : DisplayFormat.ParentDir(SavedPath);
    public string ButtonLabel => Error != null || Cancelled ? "Retry" : "Download";
    public bool CanStart => !IsDownloading && SavedPath == null;

    public FormatRowViewModel()
    {
        // Explicit dispatcher: the parameterless ctor binds to
        // Dispatcher.CurrentDispatcher, so a view model constructed off the UI
        // thread would get a timer that silently never ticks.
        _idleTimer = new DispatcherTimer(DispatcherPriority.Normal, Application.Current.Dispatcher)
        {
            Interval = TimeSpan.FromSeconds(1),
        };
        _idleTimer.Tick += (_, _) =>
        {
            IdleSeconds = _lastUpdateAt == null
                ? 0
                : (int)(DateTime.UtcNow - _lastUpdateAt.Value).TotalSeconds;
            OnPropertyChanged(nameof(IsStalled));
        };
    }

    [RelayCommand]
    private async Task DownloadAsync()
    {
        _cts = new CancellationTokenSource();
        IsDownloading = true;
        Percent = 0;
        SavedPath = null;
        Error = null;
        Cancelled = false;
        PhaseLabel = null;
        DetailText = null;
        OpenError = null;
        _lastUpdateAt = DateTime.UtcNow;
        _idleTimer.Start();
        RaiseDerived();

        try
        {
            await ConsumeAsync(_service.RunAsync(BuildRequest(), _cts.Token), Apply, _cts.Token);
        }
        catch (OperationCanceledException)
        {
            // Belt and braces. The service normally emits an explicit
            // CancelledLine, which Apply handles; this covers the case where the
            // token trips before the service produced anything at all.
        }
        finally
        {
            _idleTimer.Stop();
            IsDownloading = false;
            // Read the token, not the exception: the service completes the
            // sequence normally after a cancel, so no exception may reach here.
            if (_cts?.IsCancellationRequested == true && SavedPath == null) Cancelled = true;
            _cts?.Dispose();
            _cts = null;
            RaiseDerived();
        }
    }

    private void Apply(DownloadLine line)
    {
        _lastUpdateAt = DateTime.UtcNow;
        IdleSeconds = 0;
        switch (line)
        {
            case ProgressLine p:
                Percent = p.Percent;
                DetailText = string.Join(" . ",
                    $"{DisplayFormat.FormatBytes(p.DownloadedBytes)} / {DisplayFormat.FormatBytes(p.TotalBytes)}",
                    DisplayFormat.FormatSpeed(p.SpeedBytesPerSec),
                    $"ETA {DisplayFormat.FormatDuration(p.EtaSeconds)}")
                    + (p.FragmentCount > 1 ? $" . frag {p.FragmentIndex ?? 0}/{p.FragmentCount}" : "");
                break;

            case PhaseLine ph:
                PhaseLabel = ph.Label;
                // Outside the download phase there are no byte counters to show,
                // and leaving the last ones up would suggest a stopped transfer.
                if (ph.Phase != DownloadPhase.Downloading) DetailText = null;
                break;

            case DoneLine d:
                SavedPath = d.SavedPath;
                Percent = 100;
                PhaseLabel = null;
                break;

            case ErrorLine e:
                Error = e.Message;
                PhaseLabel = null;
                break;

            case CancelledLine:
                Cancelled = true;
                PhaseLabel = null;
                DetailText = null;
                break;

            // Playlist-only lines must never arrive here. Ignoring them silently
            // would hide a protocol bug.
            default:
                throw new UnreachableException($"unexpected line {line.GetType().Name}");
        }
        RaiseDerived();
    }

    private void RaiseDerived()
    {
        OnPropertyChanged(nameof(ShowProgress));
        OnPropertyChanged(nameof(ShowBar));
        OnPropertyChanged(nameof(SavedFolder));
        OnPropertyChanged(nameof(ButtonLabel));
        OnPropertyChanged(nameof(CanStart));
        OnPropertyChanged(nameof(IsStalled));
    }

    [RelayCommand] private void Cancel() => _cts?.Cancel();

    [RelayCommand]
    private void OpenFolder() =>
        OpenError = SavedFolder == null
            ? "No folder to open"
            : OutputPaths.OpenInExplorer(SavedFolder);
}
