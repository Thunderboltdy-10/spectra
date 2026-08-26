$ErrorActionPreference = "Stop"
Add-Type -TypeDefinition @"
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;
public static class NativeOmW15 {
  public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc lpEnumFunc, IntPtr lParam);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint pid);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetClassName(IntPtr hWnd, StringBuilder lpClassName, int nMaxCount);
  [DllImport("user32.dll")] public static extern bool EnumChildWindows(IntPtr hWnd, EnumWindowsProc lpEnumFunc, IntPtr lParam);
  [DllImport("oleacc.dll")]
  public static extern int AccessibleObjectFromWindow(IntPtr hwnd, uint id, ref Guid iid, [MarshalAs(UnmanagedType.IDispatch)] out object ppv);
  public static IntPtr FindWwg(uint targetPid) {
    IntPtr found = IntPtr.Zero;
    EnumWindows((h, l) => {
      uint pid;
      GetWindowThreadProcessId(h, out pid);
      if (pid != targetPid) return true;
      var cls = new StringBuilder(256);
      GetClassName(h, cls, 256);
      if (cls.ToString() != "OpusApp") return true;
      EnumChildWindows(h, (ch, cl) => {
        var c2 = new StringBuilder(256);
        GetClassName(ch, c2, 256);
        if (c2.ToString() == "_WwG") { found = ch; return false; }
        return true;
      }, IntPtr.Zero);
      return true;
    }, IntPtr.Zero);
    return found;
  }
  public static object Get(IntPtr hwnd) {
    Guid iid = new Guid("00020400-0000-0000-C000-000000000046");
    object obj;
    int hr = AccessibleObjectFromWindow(hwnd, 0xFFFFFFF0, ref iid, out obj);
    if (hr != 0 || obj == null) throw new Exception("AccessibleObjectFromWindow hr=" + hr);
    return obj;
  }
}
"@
$wwg = [NativeOmW15]::FindWwg(19728)
if ($wwg -eq [IntPtr]::Zero) { throw "no _WwG for pid 19728" }
$docWin = [NativeOmW15]::Get($wwg)
$d = $docWin.Application.ActiveDocument
$path = [string]$d.FullName
Write-Output "DOC=$path HWND=$wwg"
if ($path -notmatch "spectra-p1v3-rerun-fixture") { throw "refusing unexpected document: $path" }
if ($path -match "PS 6\.docx|PS 8\.docx") { throw "refusing Pablo document: $path" }
$marker = "P1.V3 W1W5 WORD-LOCK 2026-08-26"
$d.Range(0, 0).InsertBefore($marker + [char]13)
$d.Save()
Write-Output "SAVED=$($d.Saved) SIZE=$((Get-Item $path).Length) MARKER=$marker"
