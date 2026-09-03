using System.Collections.ObjectModel;
using System.Diagnostics;
using System.Windows;
using System.Windows.Threading;
using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using MediaDetector.App.Controls;
using MediaDetector.Core.Formatting;
using MediaDetector.Core.Models;
using MediaDetector.Core.Naming;
using MediaDetector.Core.Services;
using MediaDetector.Core.Storage;

namespace MediaDetector.App.ViewModels;

public sealed partial class PlaylistTrackViewModel : ObservableObject
{
    public required int Index { get; init; }
    public required string OriginalTitle { get; init; }
    // Exists purely so the client previews the same name the service builds --
    // without it every row previewed as "... - Unknown".
    public required string? Author { get; init; }

    // Set by the owning panel so the row can read the shared CleanNames state
    // without holding a back-reference.
    public required Func<bool> GetClean { get; init; }

    [ObservableProperty] private StatusIconKind _icon = StatusIconKind.Idle;
    [ObservableProperty] private string _iconLabel = "Pending";
    [ObservableProperty] private string _note = "";
    // Renamed from IsCurrent: with concurrent downloads several rows are in
    // flight at once, so there is no single current track any more.
    [ObservableProperty] private bool _isActive;
    [ObservableProperty] private double _percent;
    // Kept per row so the panel can total the live speed across active tracks.
    [ObservableProperty] private double? _speedBytesPerSec;
    // Non-download stage (merge/convert/embed), which reports no percentage at
    // all -- the label is what explains a bar that has stopped moving.
    [ObservableProperty] private string? _phaseText;

    // Called before each run. Deliberately does NOT clear CustomName -- that is a
    // user edit and must survive a re-run.
    public void Reset()
    {
        Icon = StatusIconKind.Idle;
        IconLabel = "Pending";
        Note = "";
        Percent = 0;
        SpeedBytesPerSec = null;
        PhaseText = null;
        IsActive = false;
    }

    public string GeneratedName(bool clean)
    {
        var source = new NameSource(OriginalTitle, Uploader: Author);
        return clean ? FileNaming.DownloadStem(source) : FileNaming.RawStem(source);
    }

    // A PROPERTY, not a method: XAML cannot bind to a method.
    public string DisplayName => GeneratedName(GetClean());

    public bool HasNote => Note.Length != 0;
    public bool HasPhase => PhaseText != null;
    // The row's status cell shows exactly one of bar / phase / note, so they can
    // share the cell and it never changes width.
    public bool ShowInlineProgress => IsActive && Note.Length == 0 && PhaseText == null;

    public void RaiseDisplayNameChanged() => OnPropertyChanged(nameof(DisplayName));

    partial void OnNoteChanged(string value)
    {
        OnPropertyChanged(nameof(HasNote));
        OnPropertyChanged(nameof(ShowInlineProgress));
    }
    partial void OnPhaseTextChanged(string? value)
    {
        OnPropertyChanged(nameof(HasPhase));
        OnPropertyChanged(nameof(ShowInlineProgress));
    }
    partial void OnIsActiveChanged(bool value) => OnPropertyChanged(nameof(ShowInlineProgress));
}

public sealed partial class PlaylistPanelViewModel : StreamingViewModel
{
    private const int StallAfterSeconds = 5;

    private readonly PlaylistDownloadService _service = new(new DetectService());
    private readonly DispatcherTimer _idleTimer;
    private CancellationTokenSource? _cts;
    private DateTime? _lastUpdateAt;

    public ObservableCollection<PlaylistTrackViewModel> Tracks { get; } = [];

    // Owned by MainViewModel so the single and playlist flows cannot disagree.
    public required Func<bool> GetCleanNames { get; init; }
    public required Func<string> GetOutputDir { get; init; }
    public required Func<bool> GetFfmpegReady { get; init; }
    public required string Url { get; init; }
    public required string PlaylistTitle { get; init; }

    [ObservableProperty] private int _total;
    [ObservableProperty] private int _completed;
    [ObservableProperty] private double _overallPercent;
    [ObservableProperty] private string? _detailText;
    [ObservableProperty] private string? _fatalError;
    [ObservableProperty] private string? _openError;
    [ObservableProperty] private BatchDoneLine? _summary;
    [ObservableProperty] private bool _isDownloading;
    [ObservableProperty] private int _idleSeconds;

    // Format picker state; mirrors the mode/audioFormat/videoQuality trio.
    [ObservableProperty] private PlaylistMode _mode = PlaylistMode.Audio;
    [ObservableProperty] private PlaylistAudioFormat _audioFormat = PlaylistAudioFormat.M4a;
    [ObservableProperty] private PlaylistVideoQuality _videoQuality = PlaylistVideoQuality.Q1080;

    // Persisted: a property of the machine and connection, not of one playlist.
    // Clamped on read, or a hand-edited settings.json binds to no entry at all.
    [ObservableProperty] private int _concurrency = Math.Clamp(
        App.Settings.PlaylistConcurrency, AppSettings.MinConcurrency, AppSettings.MaxConcurrency);

    // The full clamped range, so every value Concurrency can hold has a matching
    // entry for SelectedItem to bind to.
    public IReadOnlyList<int> ConcurrencyOptions { get; } =
        [.. Enumerable.Range(AppSettings.MinConcurrency,
            AppSettings.MaxConcurrency - AppSettings.MinConcurrency + 1)];

    // MP3 and every video preset need ffmpeg, so the UI disables them without it.
    public bool CanUseVideo => GetFfmpegReady();
    public bool CanUseMp3 => GetFfmpegReady();

    // Routing selection through the enum keeps the picker and the request one
    // piece of state. Binding visibility to a ListBox's int SelectedIndex instead
    // silently pinned Mode to Audio, so picking Video still downloaded audio.
    public int ModeIndex
    {
        get
        {
            return Mode == PlaylistMode.Video ? 1 : 0;
        }
        set
        {
            Mode = value == 1 ? PlaylistMode.Video : PlaylistMode.Audio;
        }
    }

    public bool IsAudioMode
    {
        get
        {
            return Mode == PlaylistMode.Audio;
        }
    }

    public bool IsVideoMode
    {
        get
        {
            return Mode == PlaylistMode.Video;
        }
    }
    public bool IsStalled => IsDownloading && IdleSeconds >= StallAfterSeconds;
    // The setup block and the Download button only return once the summary clears.
    public bool SetupVisible => !IsDownloading && Summary == null;
    public bool ProgressVisible => IsDownloading || Summary != null;
    public string DownloadLabel =>
        Mode == PlaylistMode.Video ? "Download all video" : "Download all audio";
    public string SummaryLabel => Summary == null
        ? ""
        : $"Downloaded {Summary.Downloaded} of {Summary.Total}"
          + (Summary.Cancelled ? " -- stopped"
             : Summary.Failed > 0 ? $" ({Summary.Failed} failed)" : "");
    public StatusIconKind SummaryIcon => Summary == null
        ? StatusIconKind.Idle
        : Summary.Cancelled || Summary.Failed > 0 ? StatusIconKind.Warn : StatusIconKind.Check;
    public string RestartLabel => Summary?.Cancelled == true ? "Start again" : "Download again";
    public int ActiveCount => Tracks.Count(track => track.IsActive);
    // "Track 3 of 12" no longer means anything once three tracks are in flight,
    // so the headline counts finished work instead of naming a current track.
    public string ProgressHeadline => Summary != null
        ? (Summary.Cancelled ? "Cancelled" : "Complete")
        : $"{Completed} of {Total} done";

    public PlaylistPanelViewModel()
    {
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
    private async Task DownloadAllAsync()
    {
        _cts = new CancellationTokenSource();
        IsDownloading = true;
        Summary = null;
        FatalError = null;
        OpenError = null;
        Completed = 0;
        OverallPercent = 0;
        DetailText = null;
        foreach (var track in Tracks) track.Reset();
        _lastUpdateAt = DateTime.UtcNow;
        _idleTimer.Start();
        RaiseDerived();

        var request = new PlaylistDownloadRequest(
            Url,
            new PlaylistFormatSelection(Mode, AudioFormat, VideoQuality),
            GetOutputDir(),
            GetCleanNames(),
            Concurrency);

        try
        {
            await ConsumeAsync(_service.RunAsync(request, _cts.Token), Apply, _cts.Token);
        }
        catch (OperationCanceledException)
        {
            // The orchestrator sets Cancelled on BatchDoneLine; this only covers a
            // token that trips before anything was produced.
        }
        finally
        {
            _idleTimer.Stop();
            IsDownloading = false;
            Summary ??= new BatchDoneLine(
                "", Completed, Total, Total - Completed, _cts?.IsCancellationRequested == true);
            _cts?.Dispose();
            _cts = null;
            RaiseDerived();
        }
    }

    private PlaylistTrackViewModel? Find(int index)
        => Tracks.FirstOrDefault(track => track.Index == index);

    private void Apply(DownloadLine line)
    {
        switch (line)
        {
            case ItemLine item:
            {
                Total = item.Total;
                var track = Find(item.Index);
                if (track != null)
                {
                    track.IsActive = true;
                    track.Percent = 0;
                    track.PhaseText = null;
                    track.SpeedBytesPerSec = null;
                    track.Icon = StatusIconKind.Active;
                    track.IconLabel = "Downloading";
                }
                break;
            }

            // Per-track lines arrive wrapped, because with several downloads in
            // flight their output interleaves and ItemLine no longer scopes it.
            case TrackLine wrapped:
                ApplyTrackLine(wrapped);
                break;

            // Explicit null checks rather than `when Find(x) is { } t` property
            // patterns, per rules/common/coding-style.md.
            case TrackRetryLine retry:
            {
                var track = Find(retry.Index);
                if (track != null)
                {
                    track.Icon = StatusIconKind.Warn;
                    track.IconLabel = "Retrying";
                    track.Note = $"retry {retry.Attempt}/5";
                    track.PhaseText = null;
                    track.SpeedBytesPerSec = null;
                }
                break;
            }

            case TrackSkippedLine skipped:
            {
                var track = Find(skipped.Index);
                if (track != null)
                {
                    track.Note = "";
                    track.IsActive = false;
                    track.SpeedBytesPerSec = null;
                    track.PhaseText = null;
                }
                break;
            }

            case TrackDoneLine done:
            {
                var track = Find(done.Index);
                if (track != null)
                {
                    track.Icon = StatusIconKind.Check;
                    track.IconLabel = "Downloaded";
                    track.Note = "";
                    track.IsActive = false;
                    track.Percent = 100;
                    track.SpeedBytesPerSec = null;
                    track.PhaseText = null;
                }
                // Counted even if the row is missing, so the summary stays truthful.
                Completed++;
                break;
            }

            case TrackErrorLine failed:
            {
                var track = Find(failed.Index);
                if (track != null)
                {
                    track.Icon = StatusIconKind.Error;
                    track.IconLabel = "Failed";
                    track.Note = "failed";
                    track.IsActive = false;
                    track.SpeedBytesPerSec = null;
                    track.PhaseText = null;
                }
                break;
            }

            case BatchDoneLine batch:
                Summary = batch;
                foreach (var track in Tracks)
                {
                    track.IsActive = false;
                }
                break;

            case ErrorLine err:
                Summary ??= new BatchDoneLine("", Completed, Total, Total - Completed, false);
                FatalError = err.Message;
                break;

            // Single-download-only lines (DoneLine, CancelledLine) must never
            // arrive here.
            default:
                throw new UnreachableException($"unexpected line {line.GetType().Name}");
        }

        _lastUpdateAt = DateTime.UtcNow;
        IdleSeconds = 0;
        RecomputeAggregate();
        RaiseDerived();
    }

    private void ApplyTrackLine(TrackLine wrapped)
    {
        var track = Find(wrapped.Index);
        if (track == null)
        {
            return;
        }

        switch (wrapped.Inner)
        {
            case ProgressLine progress:
                track.Percent = progress.Percent;
                track.SpeedBytesPerSec = progress.SpeedBytesPerSec;
                break;

            case PhaseLine phase:
                // Only the non-download stages are worth naming on the row; during
                // the download the percentage already says everything.
                track.PhaseText =
                    phase.Phase == DownloadPhase.Downloading ? null : phase.Label;
                if (phase.Phase != DownloadPhase.Downloading)
                {
                    track.SpeedBytesPerSec = null;
                }
                break;

            // A per-track error is not fatal to the batch -- the retry engine
            // decides what happens next, and TrackRetryLine/TrackErrorLine report
            // it. Recording the text on the row would be overwritten immediately.
            case ErrorLine:
                break;

            default:
                throw new UnreachableException(
                    $"unexpected wrapped line {wrapped.Inner.GetType().Name}");
        }
    }

    // Finished tracks plus each in-flight fraction, so the bar advances smoothly.
    // IsActive keeps a completed track's 100% from being counted twice.
    private void RecomputeAggregate()
    {
        var inFlight = 0.0;
        var speed = 0.0;
        var anySpeed = false;
        var active = 0;

        foreach (var track in Tracks)
        {
            if (!track.IsActive)
            {
                continue;
            }

            active++;
            inFlight += track.Percent / 100.0;
            if (track.SpeedBytesPerSec != null)
            {
                speed += track.SpeedBytesPerSec.Value;
                anySpeed = true;
            }
        }

        OverallPercent = Total > 0
            ? Math.Min(100, (Completed + inFlight) / Total * 100)
            : 0;

        DetailText = active == 0
            ? null
            : $"{active} downloading . {DisplayFormat.FormatSpeed(anySpeed ? speed : null)}";
    }

    private void RaiseDerived()
    {
        OnPropertyChanged(nameof(SetupVisible));
        OnPropertyChanged(nameof(ProgressVisible));
        OnPropertyChanged(nameof(SummaryLabel));
        OnPropertyChanged(nameof(SummaryIcon));
        OnPropertyChanged(nameof(RestartLabel));
        OnPropertyChanged(nameof(ProgressHeadline));
        OnPropertyChanged(nameof(ActiveCount));
        OnPropertyChanged(nameof(IsStalled));
    }

    partial void OnConcurrencyChanged(int value)
    {
        App.Settings.PlaylistConcurrency =
            Math.Clamp(value, AppSettings.MinConcurrency, AppSettings.MaxConcurrency);
        App.Settings.Save();
    }

    [RelayCommand] private void Cancel() => _cts?.Cancel();

    // Clearing the summary is what brings the format picker and Download button
    // back; without it the finished state is a dead end.
    [RelayCommand] private void StartAgain() => Summary = null;

    [RelayCommand]
    private void OpenFolder()
        => OpenError = Summary == null ? null : OutputPaths.OpenInExplorer(Summary.Folder);

    // Called by MainViewModel when the shared CleanNames toggle flips.
    // DisplayName depends on state this view model owns, so the tracks cannot
    // notice the change on their own.
    public void RefreshNames()
    {
        foreach (var track in Tracks)
        {
            track.RaiseDisplayNameChanged();
        }

        RaiseDerived();
    }

    partial void OnModeChanged(PlaylistMode value)
    {
        OnPropertyChanged(nameof(DownloadLabel));
        OnPropertyChanged(nameof(ModeIndex));
        OnPropertyChanged(nameof(IsAudioMode));
        OnPropertyChanged(nameof(IsVideoMode));
    }
    partial void OnSummaryChanged(BatchDoneLine? value) => RaiseDerived();
}
