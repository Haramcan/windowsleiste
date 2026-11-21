// Symbole aus dem Infobereich (rechts unten in der alten Taskleiste: Discord, Steam, Virenscanner ...).
// Die Bibliothek ManagedShell fängt die Anmeldungen der Programme ab und reicht sie zusätzlich an Windows weiter.
using System.ComponentModel;
using System.IO;
using System.Runtime.InteropServices;
using System.Text.Json;
using System.Windows.Input;
using System.Windows.Media.Imaging;
using System.Windows.Threading;
using ManagedShell;
using ManagedShell.Common.Helpers;
using ManagedShell.WindowsTray;

namespace InselHelper;

internal static class Tray
{
    private static ShellManager? shell;
    private static Dispatcher? dispatcher;
    private static string last = "";
    private static readonly Dictionary<object, string> iconCache = new();

    [DllImport("user32.dll")] private static extern uint GetDoubleClickTime();

    public static void Start(Action<object> emit)
    {
        var t = new Thread(() =>
        {
            try
            {
                dispatcher = Dispatcher.CurrentDispatcher;
                shell = new ShellManager(ShellManager.DefaultShellConfig);
                if (shell.NotificationArea == null || shell.NotificationArea.IsFailed)
                {
                    emit(new { t = "tray", ok = false, icons = Array.Empty<object>() });
                }
                else
                {
                    var timer = new DispatcherTimer { Interval = TimeSpan.FromSeconds(1) };
                    timer.Tick += (_, _) => { try { Publish(emit); } catch (Exception e) { emit(new { t = "error", m = "tray: " + e.Message }); } };
                    timer.Start();
                    Publish(emit);
                }
                Dispatcher.Run();
            }
            catch (Exception e) { emit(new { t = "error", m = "tray: " + e.Message }); }
        });
        t.SetApartmentState(ApartmentState.STA);
        t.IsBackground = true;
        t.Start();
    }

    private static void Publish(Action<object> emit)
    {
        var icons = shell!.NotificationArea.TrayIcons
            .Where(i => !i.IsHidden)
            .Select(i => new { id = Key(i), title = i.Title ?? "", icon = Png(i.Icon) })
            .ToList();
        var state = JsonSerializer.Serialize(icons);
        if (state == last) return;
        last = state;
        emit(new { t = "tray", ok = true, icons });
    }

    private static string Png(System.Windows.Media.ImageSource? src)
    {
        if (src is not BitmapSource bmp) return "";
        if (iconCache.TryGetValue(src, out var cached)) return cached;
        string url = "";
        try
        {
            var enc = new PngBitmapEncoder();
            enc.Frames.Add(BitmapFrame.Create(bmp));
            using var ms = new MemoryStream();
            enc.Save(ms);
            url = "data:image/png;base64," + Convert.ToBase64String(ms.ToArray());
        }
        catch { }
        if (iconCache.Count > 300) iconCache.Clear();
        iconCache[src] = url;
        return url;
    }

    // Klick auf ein Symbol weitergeben; das Programm öffnet dann sein Fenster oder Menü an der Mausposition.
    // Kennung, die sich nicht ändert, solange das Programm läuft. (Die eingebaute hängt am Tooltip-Text,
    // der sich bei Discord, Steam usw. ständig ändert – dann lief ein Klick ins Leere.)
    private static string Key(NotifyIcon i) => i.GUID != Guid.Empty ? i.GUID.ToString() : i.HWnd.ToInt64() + ":" + i.UID;

    [DllImport("user32.dll")] private static extern bool AllowSetForegroundWindow(int pid);

    public static void Click(string id, string button)
    {
        // Ein unbelegter Tastendruck gibt diesem Programm das Recht, ein anderes nach vorn zu lassen;
        // ohne das darf das angeklickte Programm sein Fenster oder Menü nicht öffnen.
        Native.keybd_event(0xFF, 0, 0, UIntPtr.Zero); Native.keybd_event(0xFF, 0, 2, UIntPtr.Zero);
        dispatcher?.InvokeAsync(() =>
        {
            var icon = shell?.NotificationArea.TrayIcons.FirstOrDefault(i => Key(i) == id);
            if (icon == null) return;
            AllowSetForegroundWindow(-1);
            var b = button == "right" ? MouseButton.Right : MouseButton.Left;
            uint mouse = MouseHelper.GetCursorPositionParam();
            int dbl = (int)GetDoubleClickTime();
            icon.IconMouseEnter(mouse);
            icon.IconMouseDown(b, mouse, dbl);
            icon.IconMouseUp(b, mouse, dbl);
        });
    }

    public static void Stop()
    {
        try { dispatcher?.InvokeAsync(() => { shell?.Dispose(); shell = null; }).Wait(TimeSpan.FromSeconds(2)); } catch { }
    }
}

// Symbole für das Startmenü der Insel: Windows liefert das Bild zu jedem Eintrag aus dem Ordner "Apps".
internal static class AppIcons
{
    [ComImport, Guid("bcc18b79-ba16-442f-80c4-8a59c30c463b"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface IShellItemImageFactory
    {
        [PreserveSig] int GetImage(SIZE size, int flags, out IntPtr bitmap);
    }

    [StructLayout(LayoutKind.Sequential)] private struct SIZE { public int cx, cy; }

    [DllImport("shell32.dll", CharSet = CharSet.Unicode)]
    private static extern int SHCreateItemFromParsingName(string path, IntPtr bindContext, ref Guid iid, [MarshalAs(UnmanagedType.Interface)] out IShellItemImageFactory? item);

    [DllImport("gdi32.dll")] private static extern bool DeleteObject(IntPtr h);

    public static string Get(string id)
    {
        var iid = typeof(IShellItemImageFactory).GUID;
        if (SHCreateItemFromParsingName("shell:AppsFolder\\" + id, IntPtr.Zero, ref iid, out var factory) != 0 || factory == null) return "";
        try
        {
            if (factory.GetImage(new SIZE { cx = 48, cy = 48 }, 0, out var hbm) != 0 || hbm == IntPtr.Zero) return "";
            try
            {
                var raw = System.Windows.Interop.Imaging.CreateBitmapSourceFromHBitmap(hbm, IntPtr.Zero, System.Windows.Int32Rect.Empty, BitmapSizeOptions.FromEmptyOptions());
                // Die Punkte enthalten Transparenz, auch wenn das Format es nicht ausweist: als solche neu verpacken.
                int w = raw.PixelWidth, h = raw.PixelHeight, stride = w * 4;
                var px = new byte[stride * h];
                raw.CopyPixels(px, stride, 0);
                var img = BitmapSource.Create(w, h, 96, 96, System.Windows.Media.PixelFormats.Pbgra32, null, px, stride);
                var enc = new PngBitmapEncoder();
                enc.Frames.Add(BitmapFrame.Create(img));
                using var ms = new MemoryStream();
                enc.Save(ms);
                return "data:image/png;base64," + Convert.ToBase64String(ms.ToArray());
            }
            finally { DeleteObject(hbm); }
        }
        catch { return ""; }
        finally { Marshal.ReleaseComObject(factory); }
    }
}

// Vorschaubild eines Fensters (für das Überfahren eines Programms in der Insel).
internal static class Thumbs
{
    [DllImport("user32.dll")] private static extern IntPtr GetDC(IntPtr h);
    [DllImport("user32.dll")] private static extern int ReleaseDC(IntPtr h, IntPtr dc);
    [DllImport("user32.dll")] private static extern bool PrintWindow(IntPtr h, IntPtr dc, uint flags);
    [DllImport("gdi32.dll")] private static extern IntPtr CreateCompatibleDC(IntPtr dc);
    [DllImport("gdi32.dll")] private static extern IntPtr CreateCompatibleBitmap(IntPtr dc, int w, int h);
    [DllImport("gdi32.dll")] private static extern IntPtr SelectObject(IntPtr dc, IntPtr obj);
    [DllImport("gdi32.dll")] private static extern bool DeleteDC(IntPtr dc);
    [DllImport("gdi32.dll")] private static extern bool DeleteObject(IntPtr h);

    public static string Get(IntPtr h)
    {
        if (!Native.IsWindow(h) || Native.IsIconic(h)) return "";
        if (!Native.GetWindowRect(h, out var r)) return "";
        int w = r.Right - r.Left, ht = r.Bottom - r.Top;
        if (w < 40 || ht < 40 || w > 8000 || ht > 8000) return "";
        IntPtr screen = GetDC(IntPtr.Zero), mem = IntPtr.Zero, bmp = IntPtr.Zero;
        try
        {
            mem = CreateCompatibleDC(screen);
            bmp = CreateCompatibleBitmap(screen, w, ht);
            var old = SelectObject(mem, bmp);
            bool ok = PrintWindow(h, mem, 2 /* auch Inhalte, die die Grafikkarte zeichnet */);
            SelectObject(mem, old);
            if (!ok) return "";
            var src = System.Windows.Interop.Imaging.CreateBitmapSourceFromHBitmap(bmp, IntPtr.Zero, System.Windows.Int32Rect.Empty, BitmapSizeOptions.FromEmptyOptions());
            double scale = Math.Min(1.0, Math.Min(320.0 / w, 200.0 / ht));
            var small = new TransformedBitmap(src, new System.Windows.Media.ScaleTransform(scale, scale));
            var enc = new JpegBitmapEncoder { QualityLevel = 80 };
            enc.Frames.Add(BitmapFrame.Create(small));
            using var ms = new MemoryStream();
            enc.Save(ms);
            return "data:image/jpeg;base64," + Convert.ToBase64String(ms.ToArray());
        }
        catch { return ""; }
        finally
        {
            if (bmp != IntPtr.Zero) DeleteObject(bmp);
            if (mem != IntPtr.Zero) DeleteDC(mem);
            ReleaseDC(IntPtr.Zero, screen);
        }
    }
}
