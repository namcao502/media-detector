using System.IO;
using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using MediaDetector.Core.Dependencies;
using MediaDetector.Core.Ytdlp;
using Microsoft.Win32;

namespace MediaDetector.App.ViewModels;

// Fixes the embedded title/artist tag on a file that is already on disk --
// covers the gap MetadataOverrideFor leaves on purpose: a raw-mode download
// (CleanNames off, no custom name) never gets the automatic tag correction,
// because its filename already matches yt-dlp's default embed. This reads the
// file's CURRENT tag to prefill an edit box rather than requiring the original
// YouTube URL again.
public sealed partial class MetadataFixViewModel : ObservableObject
{
    [ObservableProperty] private string? _filePath;
    [ObservableProperty] private string _title = "";
    [ObservableProperty] private string _artist = "";
    [ObservableProperty] private bool _isBusy;
    [ObservableProperty] private string? _status;
    [ObservableProperty] private bool _statusIsError;

    public string? FileName => FilePath == null ? null : Path.GetFileName(FilePath);
    public bool HasFile => FilePath != null;
    public bool CanSave => HasFile && Title.Trim().Length != 0 && !IsBusy;

    partial void OnFilePathChanged(string? value)
    {
        OnPropertyChanged(nameof(FileName));
        OnPropertyChanged(nameof(HasFile));
        OnPropertyChanged(nameof(CanSave));
    }

    partial void OnTitleChanged(string value) => OnPropertyChanged(nameof(CanSave));
    partial void OnIsBusyChanged(bool value) => OnPropertyChanged(nameof(CanSave));

    [RelayCommand]
    private async Task Browse()
    {
        var dialog = new OpenFileDialog
        {
            Filter = "Audio/Video files|*.mp3;*.m4a;*.mp4;*.opus;*.ogg;*.flac;*.webm;*.wav|All files|*.*",
        };
        if (dialog.ShowDialog() != true)
        {
            return;
        }

        FilePath = dialog.FileName;
        Status = null;
        IsBusy = true;
        try
        {
            var python = await DependencyChecker.ResolvePythonAsync();
            var tags = await MetadataTagger.ReadTagsAsync(python, FilePath);
            Title = tags?.Title ?? "";
            Artist = tags?.Artist ?? "";
        }
        finally
        {
            IsBusy = false;
        }
    }

    [RelayCommand]
    private async Task Save()
    {
        if (FilePath == null || Title.Trim().Length == 0)
        {
            return;
        }

        IsBusy = true;
        try
        {
            var python = await DependencyChecker.ResolvePythonAsync();
            var ok = await MetadataTagger.TryWriteTagsAsync(
                python, FilePath, Title.Trim(), Artist.Trim(), CancellationToken.None);
            Status = ok ? "Saved." : "Could not write metadata for this file.";
            StatusIsError = !ok;
        }
        finally
        {
            IsBusy = false;
        }
    }
}
