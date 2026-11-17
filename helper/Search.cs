// Suche: Dateien über den Suchindex von Windows, und die Windows-Suche selbst mit Text öffnen.
using System.Data.OleDb;
using System.Runtime.InteropServices;

namespace InselHelper;

internal static class FileSearch
{
    public static void Run(long id, string q, Action<object> emit)
    {
        ThreadPool.QueueUserWorkItem(_ =>
        {
            var items = new List<object>();
            string err = "";
            try
            {
                // nur Buchstaben, Ziffern, Leerzeichen, - und _ durchlassen: der Text landet in einer Abfrage
                var clean = new string(q.Select(c => char.IsLetterOrDigit(c) || c == '-' || c == '_' ? c : ' ').ToArray());
                var words = clean.Split(' ', StringSplitOptions.RemoveEmptyEntries).Take(4).ToList();
                if (words.Count > 0 && clean.Trim().Length >= 2)
                {
                    var cond = string.Join(" AND ", words.Select(w => "CONTAINS(System.FileName, '\"" + w + "*\"')"));
                    var sql = "SELECT TOP 10 System.ItemNameDisplay, System.ItemPathDisplay, System.ItemType FROM SystemIndex " +
                              "WHERE SCOPE='file:' AND " + cond + " ORDER BY System.Search.Rank DESC";
                    using var con = new OleDbConnection("Provider=Search.CollatorDSO;Extended Properties='Application=Windows';");
                    con.Open();
                    using var cmd = new OleDbCommand(sql, con);
                    using var r = cmd.ExecuteReader();
                    while (r.Read())
                    {
                        string name = r.IsDBNull(0) ? "" : Convert.ToString(r.GetValue(0)) ?? "";
                        string path = r.IsDBNull(1) ? "" : Convert.ToString(r.GetValue(1)) ?? "";
                        string type = r.IsDBNull(2) ? "" : Convert.ToString(r.GetValue(2)) ?? "";
                        if (path.Length > 0) items.Add(new { name = name.Length > 0 ? name : System.IO.Path.GetFileName(path), path, folder = type == "Directory" });
                    }
                }
            }
            catch (Exception e) { err = e.Message; }
            emit(new { t = "search", id, items, err });
        });
    }
}

internal static class WinSearch
{
    [StructLayout(LayoutKind.Sequential)] private struct KEYBDINPUT { public ushort wVk, wScan; public uint dwFlags, time; public IntPtr dwExtraInfo; }
    [StructLayout(LayoutKind.Sequential)] private struct MOUSEINPUT { public int dx, dy; public uint mouseData, dwFlags, time; public IntPtr dwExtraInfo; }
    [StructLayout(LayoutKind.Explicit)] private struct InputUnion { [FieldOffset(0)] public MOUSEINPUT mi; [FieldOffset(0)] public KEYBDINPUT ki; }
    [StructLayout(LayoutKind.Sequential)] private struct INPUT { public uint type; public InputUnion u; }

    [DllImport("user32.dll", SetLastError = true)] private static extern uint SendInput(uint count, INPUT[] inputs, int size);

    // Win+S öffnet die Suche von Windows, danach wird der Text hineingetippt.
    public static void Open(string q)
    {
        ThreadPool.QueueUserWorkItem(_ =>
        {
            try
            {
                Native.keybd_event(0x5B, 0, 0, UIntPtr.Zero); Native.keybd_event(0x53, 0, 0, UIntPtr.Zero);
                Native.keybd_event(0x53, 0, 2, UIntPtr.Zero); Native.keybd_event(0x5B, 0, 2, UIntPtr.Zero);
                Thread.Sleep(750);
                var list = new List<INPUT>();
                foreach (char ch in q.Take(200))
                {
                    list.Add(new INPUT { type = 1, u = new InputUnion { ki = new KEYBDINPUT { wScan = ch, dwFlags = 0x0004 } } });
                    list.Add(new INPUT { type = 1, u = new InputUnion { ki = new KEYBDINPUT { wScan = ch, dwFlags = 0x0004 | 0x0002 } } });
                }
                if (list.Count > 0) SendInput((uint)list.Count, list.ToArray(), Marshal.SizeOf<INPUT>());
            }
            catch { }
        });
    }
}
