// InselHelper: liefert der Insel alles, was nur Windows selbst weiß.
// Ausgabe (stdout): eine JSON-Zeile pro Ereignis.  Eingabe (stdin): eine JSON-Zeile pro Befehl.
//   Ereignisse: media, thumb, volume, windows, fullscreen, error
//   Befehle:    {"c":"media","a":"toggle|next|prev"}  {"c":"volume","v":0.5}  {"c":"mute"}
//               {"c":"activate","h":123}  {"c":"taskbar","hide":true}  {"c":"start"}
//               {"c":"theme","light":true}  {"c":"deskicons"}  {"c":"wallpaper","path":"..."}
//               {"c":"frames","on":true}  {"c":"notify","on":true}
//               {"c":"tray","id":"...","b":"left|right"}  {"c":"bottom","h":123}
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.Json;
using Microsoft.Win32;
using Windows.Media.Control;
using Windows.Storage.Streams;
using Windows.UI.Notifications;
using Windows.UI.Notifications.Management;

namespace InselHelper;

internal static class Program
{
    private static readonly object OutLock = new();
    private static uint hostPid;

    // Eigene Datenströme statt Console.*: Das Programm hat kein Konsolenfenster.
    private static readonly StreamWriter Out = new(Console.OpenStandardOutput(), new UTF8Encoding(false)) { AutoFlush = true };

    private static void Emit(object o)
    {
        var line = JsonSerializer.Serialize(o);
        lock (OutLock) { try { Out.WriteLine(line); } catch { } }
    }

    private static void Main(string[] args)
    {
        if (args.Length > 0) uint.TryParse(args[0], out hostPid);
        AppDomain.CurrentDomain.ProcessExit += (_, _) => { Taskbar.Set(false); Frames.Set(false); };
        if (!args.Contains("--no-tray")) Tray.Start(Emit);
        WinKey.Start(Emit);
        var input = new StreamReader(Console.OpenStandardInput(), new UTF8Encoding(false));
        Emit(new { t = "hello" });

        AppDomain.CurrentDomain.UnhandledException += (_, e) => { try { Emit(new { t = "error", m = "fatal: " + e.ExceptionObject }); } catch { } };
        new Thread(PollLoop) { IsBackground = true }.Start();

        string? line;
        while ((line = input.ReadLine()) != null)
        {
            try { Handle(line); }
            catch (Exception e) { Emit(new { t = "error", m = e.Message }); }
        }
        Taskbar.Set(false);   // Insel wurde beendet: alte Taskleiste wieder zeigen
        Frames.Set(false);
        Tray.Stop();
    }

    private static volatile bool MixerOn;

    private static void Handle(string line)
    {
        using var doc = JsonDocument.Parse(line);
        var r = doc.RootElement;
        switch (r.GetProperty("c").GetString())
        {
            case "media": Media.Command(r.GetProperty("a").GetString() ?? "").GetAwaiter().GetResult(); break;
            case "volume": Volume.Set((float)Math.Clamp(r.GetProperty("v").GetDouble(), 0, 1)); break;
            case "mute": Volume.ToggleMute(); break;
            case "activate": WindowList.Activate(new IntPtr(r.GetProperty("h").GetInt64())); break;
            case "taskbar": Taskbar.Set(r.GetProperty("hide").GetBoolean()); break;
            case "start": Native.keybd_event(0x5B, 0, 0, UIntPtr.Zero); Native.keybd_event(0x5B, 0, 2, UIntPtr.Zero); break;
            case "theme": Look.SetLight(r.GetProperty("light").GetBoolean()); break;
            case "deskicons": Look.ToggleDesktopIcons(); break;
            case "wallpaper": Look.SetWallpaper(r.GetProperty("path").GetString() ?? ""); break;
            case "frames": Frames.Set(r.GetProperty("on").GetBoolean()); break;
            case "notify": Notifications.Enabled = r.GetProperty("on").GetBoolean(); break;
            case "winthumb":
                { long h = r.GetProperty("h").GetInt64(); Emit(new { t = "winthumb", h, data = Thumbs.Get(new IntPtr(h)) }); }
                break;
            case "appicon":
                { var id = r.GetProperty("id").GetString() ?? ""; Emit(new { t = "appicon", id, data = AppIcons.Get(id) }); }
                break;
            case "tray": Tray.Click(r.GetProperty("id").GetString() ?? "", r.GetProperty("b").GetString() ?? "left"); break;
            case "winkey": WinKey.Enabled = r.GetProperty("on").GetBoolean(); break;
            case "back": WindowList.Back(); break;
            case "usage": Emit(new { t = "usage", list = Usage.Read() }); break;
            case "search": FileSearch.Run(r.GetProperty("id").GetInt64(), r.GetProperty("q").GetString() ?? "", Emit); break;
            case "winsearch": WinSearch.Open(r.GetProperty("q").GetString() ?? ""); break;
            case "kill":   // Task beenden: Programm hart beenden, auch wenn es nicht mehr reagiert
                {
                    var done = new HashSet<uint>();
                    foreach (var e in r.GetProperty("h").EnumerateArray())
                    {
                        Native.GetWindowThreadProcessId(new IntPtr(e.GetInt64()), out uint pid);
                        if (pid <= 4 || pid == hostPid || pid == (uint)Environment.ProcessId || !done.Add(pid)) continue;
                        try { using var p = System.Diagnostics.Process.GetProcessById((int)pid); p.Kill(); }
                        catch { Emit(new { t = "toast", m = "Konnte nicht beendet werden – dafür braucht es Administratorrechte. Task-Manager als Administrator öffnen." }); }
                    }
                }
                break;
            case "combo":   // Windows-Tastenkürzel auslösen (Win+D, Win+A, Win+N, Win+R)
                {
                    var keys = r.GetProperty("k").EnumerateArray().Select(x => (byte)x.GetInt32()).ToList();
                    foreach (var k in keys) Native.keybd_event(k, 0, 0, UIntPtr.Zero);
                    for (int i = keys.Count - 1; i >= 0; i--) Native.keybd_event(keys[i], 0, 2, UIntPtr.Zero);
                }
                break;
            case "close":   // Fenster eines Programms schließen (wie das X im Fenster)
                foreach (var e in r.GetProperty("h").EnumerateArray()) Native.PostMessage(new IntPtr(e.GetInt64()), 0x10 /* WM_CLOSE */, IntPtr.Zero, IntPtr.Zero);
                break;
            case "fg":   // der Insel die Tastatur geben (für die Suche im Menü)
                {
                    var h = new IntPtr(r.GetProperty("h").GetInt64());
                    Native.keybd_event(0xFF, 0, 0, UIntPtr.Zero); Native.SetForegroundWindow(h); Native.keybd_event(0xFF, 0, 2, UIntPtr.Zero);
                }
                break;
            case "snip":   // Bildschirmausschnitt: Win+Umschalt+S
                Native.keybd_event(0x5B, 0, 0, UIntPtr.Zero); Native.keybd_event(0x10, 0, 0, UIntPtr.Zero); Native.keybd_event(0x53, 0, 0, UIntPtr.Zero);
                Native.keybd_event(0x53, 0, 2, UIntPtr.Zero); Native.keybd_event(0x10, 0, 2, UIntPtr.Zero); Native.keybd_event(0x5B, 0, 2, UIntPtr.Zero);
                break;
            case "micmute": Audio.MicToggle(); break;
            case "mixer": MixerOn = r.GetProperty("on").GetBoolean(); break;
            case "appvol": Audio.SetAppVolume(r.GetProperty("name").GetString() ?? "", (float)Math.Clamp(r.GetProperty("v").GetDouble(), 0, 1)); break;
            case "bottom":   // Widgets liegen auf dem Desktop, hinter allen Fenstern
                Native.SetWindowPos(new IntPtr(r.GetProperty("h").GetInt64()), new IntPtr(1) /* HWND_BOTTOM */, 0, 0, 0, 0, 0x13 /* NOSIZE|NOMOVE|NOACTIVATE */);
                break;
        }
    }

    private static void PollLoop()
    {
        string lastWindows = "", lastVolume = "", lastTheme = "", lastMic = "", lastMixer = "";
        bool lastFull = false;
        int fullCount = 0;
        int n = 0;
        while (true)
        {
            try
            {
                var list = WindowList.List(hostPid, out bool full);
                var w = JsonSerializer.Serialize(list);
                if (w != lastWindows) { lastWindows = w; Emit(new { t = "windows", list }); }
                fullCount = full ? fullCount + 1 : 0;
                bool fullNow = fullCount >= 2;
                if (fullNow != lastFull) { lastFull = fullNow; Emit(new { t = "fullscreen", on = fullNow, why = WindowList.FullscreenWhy }); }

                if ((!lastFull || n % 4 == 0) && Volume.Get(out float level, out bool muted))
                {
                    var v = $"{Math.Round(level, 2)}|{muted}";
                    if (v != lastVolume) { lastVolume = v; Emit(new { t = "volume", level = Math.Round(level, 2), muted }); }
                }

                Taskbar.KeepHidden();
                Frames.Apply(list.Select(x => new IntPtr(x.h)));
                if (n % (lastFull ? 4 : 2) == 0) Media.Poll(Emit).GetAwaiter().GetResult();
                if (n % (lastFull ? 8 : 3) == 0) Notifications.Poll(Emit).GetAwaiter().GetResult();
                if (!lastFull || n % 4 == 0)
                {
                    bool hasMic = Audio.MicState(out bool micMuted);
                    var mic = hasMic + "|" + micMuted;
                    if (mic != lastMic) { lastMic = mic; Emit(new { t = "mic", has = hasMic, muted = micMuted }); }
                }
                if (MixerOn)
                {
                    var apps = Audio.Mixer();
                    var mx = JsonSerializer.Serialize(apps);
                    if (mx != lastMixer) { lastMixer = mx; Emit(new { t = "mixer", list = apps }); }
                }
                else lastMixer = "";
                if (n % 4 == 0)
                {
                    var th = Look.IsLight() ? "light" : "dark";
                    if (th != lastTheme) { lastTheme = th; Emit(new { t = "theme", light = th == "light" }); }
                }
                n++;
            }
            catch (Exception e) { Emit(new { t = "error", m = e.Message }); }
            Thread.Sleep(500);
        }
    }
}

// ---------- Musik: was gerade in Spotify, im Browser usw. läuft ----------
internal static class Media
{
    private static GlobalSystemMediaTransportControlsSessionManager? mgr;
    private static string lastState = "", thumbKey = "", thumb = "";
    private static int thumbTick;

    public static async Task Poll(Action<object> emit)
    {
        mgr ??= await GlobalSystemMediaTransportControlsSessionManager.RequestAsync();
        var s = mgr.GetCurrentSession();
        if (s == null)
        {
            if (lastState != "none") { lastState = "none"; thumbKey = ""; thumb = ""; emit(new { t = "media", has = false }); emit(new { t = "thumb", data = "" }); }
            return;
        }
        var p = await s.TryGetMediaPropertiesAsync();
        var info = s.GetPlaybackInfo();
        var tl = s.GetTimelineProperties();
        bool playing = info != null && info.PlaybackStatus == GlobalSystemMediaTransportControlsSessionPlaybackStatus.Playing;
        double dur = Math.Max(0, (tl.EndTime - tl.StartTime).TotalSeconds);
        double pos = Math.Max(0, (tl.Position - tl.StartTime).TotalSeconds);
        if (playing && dur > 0 && tl.LastUpdatedTime.Year > 2000)
            pos = Math.Min(dur, pos + (DateTimeOffset.UtcNow - tl.LastUpdatedTime).TotalSeconds);

        string title = p?.Title ?? "", artist = p?.Artist ?? "";
        var ev = new { t = "media", has = true, title, artist, app = s.SourceAppUserModelId ?? "", playing, pos = Math.Round(pos), dur = Math.Round(dur) };
        var state = JsonSerializer.Serialize(ev);
        if (state != lastState) { lastState = state; emit(ev); }

        // Cover nur neu laden, wenn der Titel wechselt (oder es noch fehlt)
        string key = title + "|" + artist;
        // Das Cover kommt oft etwas später als der Titel: regelmäßig neu lesen, damit nicht das alte Bild hängen bleibt.
        if (key != thumbKey || thumb == "" || ++thumbTick % 2 == 0)
        {
            var data = await ReadThumb(p?.Thumbnail);
            if (key != thumbKey || data != thumb) { thumbKey = key; thumb = data; emit(new { t = "thumb", data }); }
        }
    }

    private static async Task<string> ReadThumb(IRandomAccessStreamReference? r)
    {
        if (r == null) return "";
        try
        {
            using var st = await r.OpenReadAsync();
            uint size = (uint)st.Size;
            if (size == 0 || size > 4_000_000) return "";
            using var reader = new DataReader(st);
            await reader.LoadAsync(size);
            var bytes = new byte[size];
            reader.ReadBytes(bytes);
            var type = string.IsNullOrEmpty(st.ContentType) ? "image/png" : st.ContentType;
            return "data:" + type + ";base64," + Convert.ToBase64String(bytes);
        }
        catch { return ""; }
    }

    public static async Task Command(string action)
    {
        mgr ??= await GlobalSystemMediaTransportControlsSessionManager.RequestAsync();
        var s = mgr.GetCurrentSession();
        if (s == null) return;
        switch (action)
        {
            case "toggle": await s.TryTogglePlayPauseAsync(); break;
            case "next": await s.TrySkipNextAsync(); break;
            case "prev": await s.TrySkipPreviousAsync(); break;
        }
    }
}

// ---------- Mitteilungen anderer Programme ----------
internal static class Notifications
{
    public static bool Enabled;
    private static UserNotificationListener? listener;
    private static bool allowed, primed;
    private static DateTime retryAt = DateTime.MinValue;
    private static HashSet<uint> seen = new();

    public static async Task Poll(Action<object> emit)
    {
        if (!Enabled) return;
        if (!allowed)
        {
            if (DateTime.UtcNow < retryAt) return;
            retryAt = DateTime.UtcNow.AddSeconds(30);
            try
            {
                listener = UserNotificationListener.Current;
                allowed = await listener.RequestAccessAsync() == UserNotificationListenerAccessStatus.Allowed;
                emit(new { t = "notifAccess", ok = allowed, m = "" });
            }
            catch (Exception e) { emit(new { t = "notifAccess", ok = false, m = e.Message }); }
            if (!allowed) return;
        }
        var list = await listener!.GetNotificationsAsync(NotificationKinds.Toast);
        var now = new HashSet<uint>();
        foreach (var n in list)
        {
            now.Add(n.Id);
            if (seen.Contains(n.Id) || !primed) continue;      // beim ersten Durchlauf nur merken, nichts melden
            string app = "", title = "", body = "";
            try { app = n.AppInfo?.DisplayInfo?.DisplayName ?? ""; } catch { }
            try
            {
                var texts = n.Notification?.Visual?.GetBinding(KnownNotificationBindings.ToastGeneric)?.GetTextElements();
                if (texts != null)
                {
                    var parts = texts.Select(x => x.Text ?? "").Where(x => x.Length > 0).ToList();
                    if (parts.Count > 0) title = parts[0];
                    if (parts.Count > 1) body = string.Join(" ", parts.Skip(1));
                }
            }
            catch { }
            if (app.Length + title.Length + body.Length > 0) emit(new { t = "notif", app, title, body });
        }
        seen = now; primed = true;
    }
}

// ---------- Aussehen von Windows ----------
internal static class Look
{
    private const string Key = @"Software\Microsoft\Windows\CurrentVersion\Themes\Personalize";

    public static bool IsLight()
    {
        using var k = Registry.CurrentUser.OpenSubKey(Key);
        return k?.GetValue("AppsUseLightTheme") is int v && v != 0;
    }

    public static void SetLight(bool light)
    {
        using (var k = Registry.CurrentUser.CreateSubKey(Key))
        {
            k.SetValue("AppsUseLightTheme", light ? 1 : 0, RegistryValueKind.DWord);
            k.SetValue("SystemUsesLightTheme", light ? 1 : 0, RegistryValueKind.DWord);
        }
        // allen Programmen Bescheid geben, damit sie sofort umschalten
        Native.SendMessageTimeout(new IntPtr(0xFFFF), 0x1A /* WM_SETTINGCHANGE */, IntPtr.Zero, "ImmersiveColorSet", 2, 300, out _);
    }

    public static void ToggleDesktopIcons()
    {
        var view = Native.FindWindowEx(Native.FindWindow("Progman", null), IntPtr.Zero, "SHELLDLL_DefView", null);
        var w = IntPtr.Zero;
        while (view == IntPtr.Zero && (w = Native.FindWindowEx(IntPtr.Zero, w, "WorkerW", null)) != IntPtr.Zero)
            view = Native.FindWindowEx(w, IntPtr.Zero, "SHELLDLL_DefView", null);
        if (view != IntPtr.Zero) Native.PostMessage(view, 0x111 /* WM_COMMAND */, new IntPtr(0x7402), IntPtr.Zero);
    }

    public static void SetWallpaper(string path)
    {
        if (File.Exists(path)) Native.SystemParametersInfo(20 /* SPI_SETDESKWALLPAPER */, 0, path, 3);
    }
}

// ---------- Fensterrahmen anderer Programme: Milchglas in der Titelleiste, Rand in Inselfarbe ----------
internal static class Frames
{
    private static bool on;
    private static readonly HashSet<IntPtr> styled = new();

    public static void Set(bool enable)
    {
        lock (styled) SetLocked(enable);
    }

    private static void SetLocked(bool enable)
    {
        if (enable == on) return;
        on = enable;
        if (!enable)
        {
            foreach (var h in styled) Style(h, 0, unchecked((int)0xFFFFFFFF));   // zurück auf Windows-Standard
            styled.Clear();
        }
    }

    public static void Apply(IEnumerable<IntPtr> windows)
    {
        lock (styled)
        {
            if (!on) return;
            var current = windows.ToHashSet();
            styled.IntersectWith(current);
            foreach (var h in current) if (styled.Add(h)) Style(h, 3 /* Acryl */, 0x0054B4FF /* #ffb454 als BGR */);
        }
    }

    private static void Style(IntPtr h, int backdrop, int border)
    {
        Native.DwmSetWindowAttribute(h, 38 /* DWMWA_SYSTEMBACKDROP_TYPE */, ref backdrop, 4);
        Native.DwmSetWindowAttribute(h, 34 /* DWMWA_BORDER_COLOR */, ref border, 4);
    }
}

// ---------- Lautstärke des Standard-Ausgabegeräts ----------
internal static class Volume
{
    [ComImport, Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")]
    private class MMDeviceEnumerator { }

    [ComImport, Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface IMMDeviceEnumerator
    {
        [PreserveSig] int EnumAudioEndpoints(int dataFlow, int stateMask, out IntPtr devices);
        [PreserveSig] int GetDefaultAudioEndpoint(int dataFlow, int role, out IMMDevice device);
    }

    [ComImport, Guid("D666063F-1587-4E43-81F1-B948E807363F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface IMMDevice
    {
        [PreserveSig] int Activate(ref Guid iid, int clsCtx, IntPtr activationParams, [MarshalAs(UnmanagedType.IUnknown)] out object iface);
    }

    [ComImport, Guid("5CDF2C82-841E-4546-9722-0CF74078229A"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface IAudioEndpointVolume
    {
        [PreserveSig] int RegisterControlChangeNotify(IntPtr notify);
        [PreserveSig] int UnregisterControlChangeNotify(IntPtr notify);
        [PreserveSig] int GetChannelCount(out uint count);
        [PreserveSig] int SetMasterVolumeLevel(float levelDb, ref Guid context);
        [PreserveSig] int SetMasterVolumeLevelScalar(float level, ref Guid context);
        [PreserveSig] int GetMasterVolumeLevel(out float levelDb);
        [PreserveSig] int GetMasterVolumeLevelScalar(out float level);
        [PreserveSig] int SetChannelVolumeLevel(uint channel, float levelDb, ref Guid context);
        [PreserveSig] int SetChannelVolumeLevelScalar(uint channel, float level, ref Guid context);
        [PreserveSig] int GetChannelVolumeLevel(uint channel, out float levelDb);
        [PreserveSig] int GetChannelVolumeLevelScalar(uint channel, out float level);
        [PreserveSig] int SetMute([MarshalAs(UnmanagedType.Bool)] bool mute, ref Guid context);
        [PreserveSig] int GetMute([MarshalAs(UnmanagedType.Bool)] out bool mute);
    }

    // Das Gerät wird jedes Mal frisch geholt, damit ein Wechsel (z. B. Kopfhörer) sofort wirkt.
    private static bool With(Action<IAudioEndpointVolume> use)
    {
        object? enumerator = null, endpoint = null;
        IMMDevice? device = null;
        try
        {
            enumerator = new MMDeviceEnumerator();
            if (((IMMDeviceEnumerator)enumerator).GetDefaultAudioEndpoint(0 /* eRender */, 1 /* eMultimedia */, out device) != 0 || device == null) return false;
            var iid = typeof(IAudioEndpointVolume).GUID;
            if (device.Activate(ref iid, 23 /* CLSCTX_ALL */, IntPtr.Zero, out endpoint) != 0 || endpoint == null) return false;
            use((IAudioEndpointVolume)endpoint);
            return true;
        }
        catch { return false; }
        finally
        {
            if (endpoint != null) Marshal.ReleaseComObject(endpoint);
            if (device != null) Marshal.ReleaseComObject(device);
            if (enumerator != null) Marshal.ReleaseComObject(enumerator);
        }
    }

    public static bool Get(out float level, out bool muted)
    {
        float l = 0; bool m = false;
        bool ok = With(v => { v.GetMasterVolumeLevelScalar(out l); v.GetMute(out m); });
        level = l; muted = m;
        return ok;
    }

    public static void Set(float level) => With(v =>
    {
        var ctx = Guid.Empty;
        v.SetMasterVolumeLevelScalar(level, ref ctx);
        if (level > 0) v.SetMute(false, ref ctx);
    });

    public static void ToggleMute() => With(v =>
    {
        var ctx = Guid.Empty;
        v.GetMute(out bool m);
        v.SetMute(!m, ref ctx);
    });
}

// ---------- Offene Fenster ----------
internal record WindowInfo(long h, string title, string exe, bool active);

internal static class WindowList
{
    private static IntPtr lastActive;

    public static List<WindowInfo> List(uint hostPid, out bool fullscreen)
    {
        var fg = Native.GetForegroundWindow();
        var found = new List<(IntPtr h, string title, string exe)>();
        Native.EnumWindows((h, _) =>
        {
            if (!Native.IsWindowVisible(h)) return true;
            if (Native.GetWindow(h, 4 /* GW_OWNER */) != IntPtr.Zero) return true;
            long ex = Native.GetWindowLongPtr(h, -20 /* GWL_EXSTYLE */).ToInt64();
            if ((ex & 0x80) != 0 && (ex & 0x40000) == 0) return true;            // Werkzeugfenster
            if (Native.DwmGetWindowAttribute(h, 14 /* DWMWA_CLOAKED */, out int cloaked, 4) == 0 && cloaked != 0) return true;
            int len = Native.GetWindowTextLength(h);
            if (len == 0) return true;
            Native.GetWindowThreadProcessId(h, out uint pid);
            if (pid == hostPid) return true;                                    // die Insel selbst
            var sb = new StringBuilder(len + 1);
            Native.GetWindowText(h, sb, sb.Capacity);
            found.Add((h, sb.ToString(), ExePath(pid)));
            return true;
        }, IntPtr.Zero);

        if (found.Any(f => f.h == fg)) lastActive = fg;
        else if (!found.Any(f => f.h == lastActive)) lastActive = IntPtr.Zero;

        fullscreen = false; FullscreenWhy = "";
        if (found.Any(f => f.h == fg))
        {
            bool covers = CoversMonitor(fg);
            int state = -1;
            if (Native.SHQueryUserNotificationState(out int q) == 0) state = q;
            // 2 = Vollbild-Anwendung, 3 = Spiel im exklusiven Vollbild, 4 = Präsentation
            if (state == 3) fullscreen = true;
            else if (state == 2 || state == 4) fullscreen = covers;
            else if (state < 0) fullscreen = covers && !Native.IsZoomed(fg);   // Abfrage fehlgeschlagen: alte Regel
            if (covers || fullscreen) FullscreenWhy = "Zustand " + state + ", deckt Bildschirm: " + covers + ", Fenster: " + found.First(f => f.h == fg).exe;
        }
        return found.Select(f => new WindowInfo(f.h.ToInt64(), f.title, f.exe, f.h == lastActive && !Native.IsIconic(f.h))).ToList();
    }

    private static string ExePath(uint pid)
    {
        var p = Native.OpenProcess(0x1000 /* QUERY_LIMITED_INFORMATION */, false, pid);
        if (p == IntPtr.Zero) return "";
        try
        {
            var sb = new StringBuilder(1024);
            int size = sb.Capacity;
            return Native.QueryFullProcessImageName(p, 0, sb, ref size) ? sb.ToString() : "";
        }
        finally { Native.CloseHandle(p); }
    }

    // Vollbild (Spiele, Videos): das Fenster deckt seinen ganzen Bildschirm ab.
    public static string FullscreenWhy = "";

    private static bool CoversMonitor(IntPtr h)
    {
        var cls = new StringBuilder(64);
        Native.GetClassName(h, cls, cls.Capacity);
        var c = cls.ToString();
        if (c is "Progman" or "WorkerW" or "Shell_TrayWnd") return false;
        if (!Native.GetWindowRect(h, out var r)) return false;
        var mi = new Native.MONITORINFO { cbSize = Marshal.SizeOf<Native.MONITORINFO>() };
        if (!Native.GetMonitorInfo(Native.MonitorFromWindow(h, 2), ref mi)) return false;
        // Vollbild (auch Videos im Browser) ist genau so groß wie der Bildschirm; maximierte Fenster ragen darüber hinaus.
        var m = mi.rcMonitor;
        return Math.Abs(r.Left - m.Left) <= 1 && Math.Abs(r.Top - m.Top) <= 1 && Math.Abs(r.Right - m.Right) <= 1 && Math.Abs(r.Bottom - m.Bottom) <= 1;
    }

    // Das Fenster, das vor der Insel aktiv war, wieder nach vorn holen (Menü per Windows-Taste oder Esc geschlossen).
    public static void Back()
    {
        var h = lastActive;
        if (h == IntPtr.Zero || !Native.IsWindow(h)) return;
        if (Native.IsIconic(h)) Native.ShowWindow(h, 9 /* SW_RESTORE */);
        Native.keybd_event(0xFF, 0, 0, UIntPtr.Zero);
        Native.SetForegroundWindow(h);
        Native.keybd_event(0xFF, 0, 2, UIntPtr.Zero);
    }

    // Wie in der Taskleiste: Klick holt das Fenster nach vorn, Klick auf das aktive Fenster minimiert es.
    public static void Activate(IntPtr h)
    {
        if (!Native.IsWindow(h)) return;
        if (Native.GetForegroundWindow() == h && !Native.IsIconic(h)) { Native.ShowWindow(h, 6 /* SW_MINIMIZE */); return; }
        if (Native.IsIconic(h)) Native.ShowWindow(h, 9 /* SW_RESTORE */);
        // Windows erlaubt den Wechsel nur nach einer Eingabe; ein kurzer Alt-Tastendruck genügt dafür.
        Native.keybd_event(0xFF, 0, 0, UIntPtr.Zero);
        Native.SetForegroundWindow(h);
        Native.keybd_event(0xFF, 0, 2, UIntPtr.Zero);
    }
}

// ---------- Alte Taskleiste aus- und einblenden ----------
internal static class Taskbar
{
    private static bool hidden;
    private static int savedState = -1;

    private static List<IntPtr> Bars()
    {
        // Nur die echten Leisten von Windows: Der Helfer legt für die Symbole selbst ein Fenster gleichen Namens an.
        var list = new List<IntPtr>();
        uint me = (uint)Environment.ProcessId;
        var h = IntPtr.Zero;
        while ((h = Native.FindWindowEx(IntPtr.Zero, h, "Shell_TrayWnd", null)) != IntPtr.Zero)
        {
            Native.GetWindowThreadProcessId(h, out uint pid);
            if (pid != me) list.Add(h);
        }
        h = IntPtr.Zero;
        while ((h = Native.FindWindowEx(IntPtr.Zero, h, "Shell_SecondaryTrayWnd", null)) != IntPtr.Zero) list.Add(h);
        return list;
    }

    public static void Set(bool hide)
    {
        if (hide == hidden) return;
        hidden = hide;
        var bars = Bars();
        if (bars.Count == 0) return;
        // "Automatisch ausblenden" gibt den Platz der Taskleiste für maximierte Fenster frei.
        var abd = new Native.APPBARDATA { cbSize = Marshal.SizeOf<Native.APPBARDATA>(), hWnd = bars[0] };
        if (hide)
        {
            savedState = (int)Native.SHAppBarMessage(4 /* ABM_GETSTATE */, ref abd).ToInt64();
            abd.lParam = new IntPtr(1 /* ABS_AUTOHIDE */);
            Native.SHAppBarMessage(10 /* ABM_SETSTATE */, ref abd);
        }
        else if (savedState >= 0)
        {
            abd.lParam = new IntPtr(savedState);
            Native.SHAppBarMessage(10, ref abd);
        }
        foreach (var b in bars) Native.ShowWindow(b, hide ? 0 /* SW_HIDE */ : 5 /* SW_SHOW */);
    }

    // Windows blendet die Taskleiste gelegentlich von selbst wieder ein.
    public static void KeepHidden()
    {
        if (!hidden) return;
        foreach (var b in Bars()) if (Native.IsWindowVisible(b)) Native.ShowWindow(b, 0);
    }
}

internal static class Native
{
    public delegate bool EnumProc(IntPtr hWnd, IntPtr lParam);

    [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }
    [StructLayout(LayoutKind.Sequential)] public struct MONITORINFO { public int cbSize; public RECT rcMonitor; public RECT rcWork; public uint dwFlags; }
    [StructLayout(LayoutKind.Sequential)] public struct APPBARDATA { public int cbSize; public IntPtr hWnd; public uint uCallbackMessage; public uint uEdge; public RECT rc; public IntPtr lParam; }

    [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc cb, IntPtr lParam);
    [DllImport("user32.dll")] public static extern bool IsWindow(IntPtr h);
    [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
    [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr h);
    [DllImport("user32.dll")] public static extern bool IsZoomed(IntPtr h);
    [DllImport("user32.dll")] public static extern IntPtr GetWindow(IntPtr h, uint cmd);
    [DllImport("user32.dll", EntryPoint = "GetWindowLongPtrW")] public static extern IntPtr GetWindowLongPtr(IntPtr h, int index);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetWindowTextLength(IntPtr h);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetWindowText(IntPtr h, StringBuilder text, int max);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetClassName(IntPtr h, StringBuilder text, int max);
    [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
    [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
    [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int cmd);
    [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
    [DllImport("user32.dll")] public static extern IntPtr MonitorFromWindow(IntPtr h, uint flags);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern bool GetMonitorInfo(IntPtr monitor, ref MONITORINFO info);
    [DllImport("user32.dll")] public static extern void keybd_event(byte vk, byte scan, uint flags, UIntPtr extra);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern IntPtr FindWindow(string? cls, string? title);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern IntPtr FindWindowEx(IntPtr parent, IntPtr after, string? cls, string? title);
    [DllImport("dwmapi.dll")] public static extern int DwmGetWindowAttribute(IntPtr h, int attr, out int value, int size);
    [DllImport("dwmapi.dll")] public static extern int DwmSetWindowAttribute(IntPtr h, int attr, ref int value, int size);
    [DllImport("user32.dll")] public static extern bool PostMessage(IntPtr h, uint msg, IntPtr w, IntPtr l);
    [DllImport("shell32.dll")] public static extern int SHQueryUserNotificationState(out int state);
    [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr h, IntPtr after, int x, int y, int cx, int cy, uint flags);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern IntPtr SendMessageTimeout(IntPtr h, uint msg, IntPtr w, string l, uint flags, uint timeout, out IntPtr result);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern bool SystemParametersInfo(uint action, uint param, string value, uint flags);
    [DllImport("kernel32.dll")] public static extern IntPtr OpenProcess(uint access, bool inherit, uint pid);
    [DllImport("kernel32.dll")] public static extern bool CloseHandle(IntPtr h);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode)] public static extern bool QueryFullProcessImageName(IntPtr process, uint flags, StringBuilder name, ref int size);
    [DllImport("shell32.dll")] public static extern IntPtr SHAppBarMessage(uint msg, ref APPBARDATA data);
}
