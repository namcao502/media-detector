using System.Windows;
using MediaDetector.App.ViewModels;

namespace MediaDetector.App.Views;

public partial class MainWindow : Window
{
    private readonly MainViewModel _vm = new();

    public MainWindow()
    {
        InitializeComponent();
        DataContext = _vm;
        // Probe dependencies once the window is up, so the first paint is not
        // blocked on spawning python/node/ffmpeg.
        Loaded += async (_, _) => await _vm.InitAsync();
    }
}
