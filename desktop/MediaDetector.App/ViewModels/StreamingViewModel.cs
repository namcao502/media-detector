using System.Windows;
using CommunityToolkit.Mvvm.ComponentModel;
using MediaDetector.Core.Models;

namespace MediaDetector.App.ViewModels;

public abstract class StreamingViewModel : ObservableObject
{
    // Core yields on a background thread; every mutation of an observable
    // property must be marshalled or WPF throws on cross-thread access. This is
    // the one place the Dispatcher detail appears, rather than in each view model.
    protected static async Task ConsumeAsync(
        IAsyncEnumerable<DownloadLine> source,
        Action<DownloadLine> apply,
        CancellationToken ct)
    {
        await foreach (var line in source.WithCancellation(ct))
        {
            var captured = line;
            await Application.Current.Dispatcher.InvokeAsync(() => apply(captured));
        }
    }
}
