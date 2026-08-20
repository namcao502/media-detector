using System.Windows.Controls;
using MediaDetector.App.ViewModels;

namespace MediaDetector.App.Views;

public partial class PlaylistPanelView : UserControl
{
    public PlaylistPanelView()
    {
        InitializeComponent();
        // Scrolling is a view concern, so the view model exposes a hook rather
        // than reaching into the tree itself.
        DataContextChanged += (_, e) =>
        {
            if (e.NewValue is PlaylistPanelViewModel vm)
            {
                vm.ScrollIntoView = track =>
                {
                    if (track != null) TrackList.ScrollIntoView(track);
                };
            }
        };
    }
}
