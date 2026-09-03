using System.Windows;
using System.Windows.Automation;
using System.Windows.Controls;
using System.Windows.Media;

namespace MediaDetector.App.Controls;

public enum StatusIconKind { Check, Error, Warn, Active, Idle }

// Pass Label to expose the icon to assistive tech; omit it for decoration.
public sealed class StatusIcon : Control
{
    public static readonly DependencyProperty KindProperty =
        DependencyProperty.Register(nameof(Kind), typeof(StatusIconKind), typeof(StatusIcon),
            new FrameworkPropertyMetadata(StatusIconKind.Idle,
                FrameworkPropertyMetadataOptions.AffectsRender));

    public static readonly DependencyProperty LabelProperty =
        DependencyProperty.Register(nameof(Label), typeof(string), typeof(StatusIcon),
            new PropertyMetadata(null, OnLabelChanged));

    public StatusIconKind Kind
    {
        get => (StatusIconKind)GetValue(KindProperty);
        set => SetValue(KindProperty, value);
    }

    public string? Label
    {
        get => (string?)GetValue(LabelProperty);
        set => SetValue(LabelProperty, value);
    }

    // Deliberately NO DefaultStyleKeyProperty.OverrideMetadata: it opts into
    // theme-dictionary lookup, and without Generic.xaml the control measures 0x0
    // and every glyph renders invisible. This one paints itself.
    static StatusIcon()
    {
        WidthProperty.OverrideMetadata(typeof(StatusIcon), new FrameworkPropertyMetadata(16.0));
        HeightProperty.OverrideMetadata(typeof(StatusIcon), new FrameworkPropertyMetadata(16.0));
    }

    private static void OnLabelChanged(DependencyObject d, DependencyPropertyChangedEventArgs e)
        // No SetAccessibilityView in WPF (that is WinUI). A decorative icon is
        // left unnamed; screen readers skip unnamed non-focusable elements.
        => AutomationProperties.SetName(d, (string?)e.NewValue ?? "");

    // Repaints every live icon after a theme swap; OnRender resolves brushes by
    // key, so without this they keep the old palette until something else
    // invalidates them.
    public static void InvalidateAll(DependencyObject root)
    {
        if (root is StatusIcon icon) icon.InvalidateVisual();
        var count = VisualTreeHelper.GetChildrenCount(root);
        for (var i = 0; i < count; i++)
            InvalidateAll(VisualTreeHelper.GetChild(root, i));
    }

    // Glyph paths in a 16x16 viewBox, scaled to the control. Not decoration:
    // without them check and error differ only by colour.
    private static readonly Geometry CheckMark = Geometry.Parse("M4.5,8.2 L6.8,10.5 L11.5,5.6");
    private static readonly Geometry CrossMark = Geometry.Parse("M5.4,5.4 L10.6,10.6 M10.6,5.4 L5.4,10.6");
    private static readonly Geometry BangMark  = Geometry.Parse("M8,4.2 L8,8.6 M8,11.15 L8,11.25");

    protected override void OnRender(DrawingContext dc)
    {
        var size = Math.Min(ActualWidth, ActualHeight);
        if (size <= 0) return;

        var key = Kind switch
        {
            StatusIconKind.Check => "StatusOk",
            StatusIconKind.Error => "StatusError",
            StatusIconKind.Warn => "StatusWarn",
            StatusIconKind.Active => "Accent",
            _ => "Border",
        };
        // TryFindResource, not FindResource: the latter throws if the theme
        // dictionary is not merged yet (design-time, or a render before startup
        // completes), and an exception in OnRender takes the window down.
        var brush = TryFindResource(key) as Brush ?? Brushes.Gray;
        var centre = new Point(ActualWidth / 2, ActualHeight / 2);
        var scale = size / 16.0;

        if (Kind == StatusIconKind.Idle)
        {
            // Hairline ring, so a pending row occupies the same width as a
            // finished one.
            dc.DrawEllipse(null, new Pen(brush, 1.5 * scale), centre, 6.5 * scale, 6.5 * scale);
            return;
        }

        dc.DrawEllipse(brush, null, centre, size / 2, size / 2);

        if (Kind == StatusIconKind.Active)
        {
            dc.DrawEllipse(Brushes.White, null, centre, 3 * scale, 3 * scale);
            return;
        }

        var glyph = Kind switch
        {
            StatusIconKind.Check => CheckMark,
            StatusIconKind.Error => CrossMark,
            _ => BangMark,
        };
        var pen = new Pen(Brushes.White, 1.8 * scale)
        {
            StartLineCap = PenLineCap.Round,
            EndLineCap = PenLineCap.Round,
            LineJoin = PenLineJoin.Round,
        };

        dc.PushTransform(new TranslateTransform(centre.X - size / 2, centre.Y - size / 2));
        dc.PushTransform(new ScaleTransform(scale, scale));
        dc.DrawGeometry(null, pen, glyph);
        dc.Pop();
        dc.Pop();
    }
}

// Built on ListBox so selection, keyboard nav and binding come free. No
// DefaultStyleKeyProperty override (same reason as StatusIcon): without it the
// control keeps ListBox's working default style and Controls.xaml swaps the chrome.
public sealed class SegmentedControl : ListBox
{
}
