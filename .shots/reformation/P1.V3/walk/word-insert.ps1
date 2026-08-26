$ErrorActionPreference = "Stop"
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public static class NativeOm {
  [DllImport("oleacc.dll")]
  public static extern int AccessibleObjectFromWindow(
    IntPtr hwnd, uint id, ref Guid iid,
    [MarshalAs(UnmanagedType.IDispatch)] out object ppv);
  public static object Get(IntPtr hwnd) {
    Guid iid = new Guid("00020400-0000-0000-C000-000000000046");
    object obj;
    int hr = AccessibleObjectFromWindow(hwnd, 0xFFFFFFF0, ref iid, out obj);
    if (hr != 0 || obj == null) throw new Exception("AccessibleObjectFromWindow hr=" + hr);
    return obj;
  }
}
"@
$hwnd = [IntPtr]1707144
$docWin = [NativeOm]::Get($hwnd)
$app = $docWin.Application
$d = $app.ActiveDocument
$path = [string]$d.FullName
Write-Output "DOC=$path"
if ($path -notmatch "spectra-p1v3-rerun-fixture") {
  throw "refusing unexpected document: $path"
}
if ($path -match "PS 6\.docx|PS 8\.docx") {
  throw "refusing Pablo document: $path"
}
$marker = $env:P1V3_WORD_MARKER
if (-not $marker) { $marker = "P1.V3 WALK WORD-OPEN 2026-08-26" }
$d.Range(0, 0).InsertBefore($marker + [char]13)
$d.Save()
Write-Output "SAVED=$($d.Saved) WORDS=$($d.Words.Count) MARKER=$marker"
