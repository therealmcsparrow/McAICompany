# Types stdin text into the console of one process: console-type.ps1 --pid <claudePid>
# Text is read from stdin first (UTF-8, CR = Enter); only printable ASCII and CR are typed.
# Exit 0 typed, 1 attach failed, 2 bad arguments or open or write failed.
$src = @'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
public static class CT {
  [StructLayout(LayoutKind.Explicit, CharSet=CharSet.Unicode)] public struct KEY_EVENT_RECORD {
    [FieldOffset(0)] public int bKeyDown; [FieldOffset(4)] public ushort wRepeatCount; [FieldOffset(6)] public ushort wVirtualKeyCode;
    [FieldOffset(8)] public ushort wVirtualScanCode; [FieldOffset(10)] public char UnicodeChar; [FieldOffset(12)] public uint dwControlKeyState; }
  [StructLayout(LayoutKind.Explicit)] public struct INPUT_RECORD { [FieldOffset(0)] public ushort EventType; [FieldOffset(4)] public KEY_EVENT_RECORD Key; }
  [DllImport("kernel32.dll", SetLastError=true, CharSet=CharSet.Unicode)] public static extern IntPtr CreateFileW(string n, uint a, uint s, IntPtr sec, uint d, uint f, IntPtr t);
  [DllImport("kernel32.dll", SetLastError=true)] public static extern bool WriteConsoleInputW(IntPtr h, INPUT_RECORD[] b, uint n, out uint w);
  [DllImport("kernel32.dll", SetLastError=true)] public static extern bool CloseHandle(IntPtr h);
  [DllImport("kernel32.dll", SetLastError=true)] public static extern bool FreeConsole();
  [DllImport("kernel32.dll", SetLastError=true)] public static extern bool AttachConsole(uint pid);
  public static bool Type(string text) {
    IntPtr h = CreateFileW("CONIN$", 0xC0000000, 3, IntPtr.Zero, 3, 0, IntPtr.Zero);
    if (h == (IntPtr)(-1)) return false;
    try {
      var recs = new List<INPUT_RECORD>();
      foreach (char c in text) {
        ushort vk = c == '\r' ? (ushort)13 : (ushort)0;
        foreach (int down in new[] { 1, 0 }) {
          var r = new INPUT_RECORD();
          r.EventType = 1; r.Key.bKeyDown = down; r.Key.wRepeatCount = 1; r.Key.wVirtualKeyCode = vk; r.Key.UnicodeChar = c;
          recs.Add(r);
        }
      }
      uint w;
      return WriteConsoleInputW(h, recs.ToArray(), (uint)recs.Count, out w) && w == (uint)recs.Count;
    } finally { CloseHandle(h); }
  }
}
'@

$idx = [array]::IndexOf($args, '--pid')
if ($args.Count -ne 2 -or $idx -ne 0) { exit 2 }
[uint32]$target = 0
if ($args[1] -notmatch '^[1-9][0-9]{0,9}$' -or -not [uint32]::TryParse($args[1], [ref]$target)) { exit 2 }

$raw = [Console]::In.ReadToEnd()
$text = -join ($raw.ToCharArray() | Where-Object { $_ -eq "`r" -or ([int]$_ -ge 32 -and [int]$_ -le 126) })
if ($text.Length -eq 0) { exit 2 }

Add-Type -TypeDefinition $src
[void][CT]::FreeConsole()
if (-not [CT]::AttachConsole($target)) { exit 1 }
if ([CT]::Type($text)) { exit 0 }
exit 2
