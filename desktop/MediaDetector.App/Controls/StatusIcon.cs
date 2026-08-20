using System.Windows;
using System.Windows.Automation;
using System.Windows.Controls;
using System.Windows.Media;

namespace MediaDetector.App.Controls;

public enum StatusIconKind { Check, Error, Warn, Active, Idle }

// One source of status glyphs, backing the dependency rows, the finished-download
// row and the playlist track list. Pass Label to expose it to assistive tech;
// omit it for decoration.
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

    // Deliberately NO DefaultStyleKeyProperty.OverrideMetadata. That opts the
    // control into theme-dictionary lookup, which needs Themes/Generic.xaml plus
    // an [assembly: ThemeInfo]; without them the control gets no template,
    // measures 0x0, and OnRender draws a zero-radius circle -- every glyph
    // invisible. This control renders itself, so it only needs a default size.
    static StatusIcon()
    {
        WidthProperty.OverrideMetadata(typeof(StatusIcon), new FrameworkPropertyMetadata(16.0));
        HeightProperty.OverrideMetadata(typeof(StatusIcon), new FrameworkPropertyMetadata(16.0));
    }

    private static void OnLabelChanged(DependencyObject d, DependencyPropertyChangedEventArgs e)
        // WPF has no AutomationProperties.SetAccessibilityView -- that is a WinUI
        // API. A decorative icon is simply left unnamed; screen readers skip an
        // unnamed, non-focusable element.
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

    // Glyph paths in the source's 16x16 viewBox (StatusIcon.tsx:42-70), scaled to
    // the control's actual size. These are NOT decoration: without them `check`
    // and `error` differ only by colour, which is a parity loss and fails for
    // colour-blind users.
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

// iOS-style segmented control. Built on ListBox so selection, keyboard
// navigation and binding all come for free; only the chrome is replaced.
//
// Deliberately NO DefaultStyleKeyProperty.OverrideMetadata -- same reason as
// StatusIcon. Without the override it inherits ListBox's working default style,
// and the implicit style in Controls.xaml replaces the chrome.
public sealed class SegmentedControl : ListBox
{
}
