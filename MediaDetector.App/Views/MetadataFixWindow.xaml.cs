using System.Windows;
using MediaDetector.App.ViewModels;

namespace MediaDetector.App.Views;

public partial class MetadataFixWindow : Window
{
    public MetadataFixWindow()
    {
        InitializeComponent();
        DataContext = new MetadataFixViewModel();
    }
}
