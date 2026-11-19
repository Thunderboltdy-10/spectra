<#
.SYNOPSIS
  Open Word files in real Word, confirm Word accepts them without repair, and
  print each to PDF beside it (or into -OutDir) for the fidelity lab.

.DESCRIPTION
  Files are opened read-only and closed without saving, so the inputs are
  never changed. A file Word refuses or would have to repair is reported as a
  failure and the script exits 1. Needs Microsoft Word; it is skipped in CI.

.EXAMPLE
  powershell -File scripts/word-verify.ps1 -Path src/features/spectra/__tests__/fixtures
  powershell -File scripts/word-verify.ps1 -Path C:\copies\EE5.docx -OutDir C:\copies\pdf -Json
#>
param(
  [Parameter(Mandatory = $true)][string[]]$Path,
  [string]$OutDir,
  [switch]$Json,
  [switch]$NoPdf
)

$ErrorActionPreference = 'Stop'
$wdExportFormatPDF = 17
$wdStatisticPages = 2
$wdDoNotSaveChanges = 0

$files = foreach ($entry in $Path) {
  $item = Get-Item -LiteralPath $entry
  if ($item.PSIsContainer) {
    Get-ChildItem -LiteralPath $item.FullName -Filter *.docx -File | Where-Object { -not $_.Name.StartsWith('~$') }
  } else { $item }
}
if (-not $files) { Write-Error 'No .docx files found.'; exit 1 }
if ($OutDir) { New-Item -ItemType Directory -Force -Path $OutDir | Out-Null }

try { $word = New-Object -ComObject Word.Application }
catch { Write-Warning 'Microsoft Word is not installed; skipping.'; exit 0 }
$word.Visible = $false
$word.DisplayAlerts = 0
$word.Options.SaveNormalPrompt = $false

$results = @()
try {
  foreach ($file in $files) {
    $result = [ordered]@{ file = $file.FullName; opened = $false; pages = $null; pdf = $null; error = $null }
    $document = $null
    try {
      # FileName, ConfirmConversions, ReadOnly, AddToRecentFiles. With alerts off, a file
      # Word would have to repair fails to open instead of prompting.
      $document = $word.Documents.Open($file.FullName, $false, $true, $false)
      $result.opened = $true
      $result.pages = $document.ComputeStatistics($wdStatisticPages)
      if (-not $NoPdf) {
        $target = if ($OutDir) { Join-Path $OutDir ($file.BaseName + '.pdf') } else { [IO.Path]::ChangeExtension($file.FullName, '.pdf') }
        $document.ExportAsFixedFormat($target, $wdExportFormatPDF)
        $result.pdf = $target
      }
    } catch {
      $result.error = $_.Exception.Message
    } finally {
      if ($document) { $document.Close([ref]$wdDoNotSaveChanges) | Out-Null }
    }
    $results += [pscustomobject]$result
  }
} finally {
  $word.Quit([ref]$wdDoNotSaveChanges) | Out-Null
  [void][Runtime.InteropServices.Marshal]::ReleaseComObject($word)
}

if ($Json) { $results | ConvertTo-Json -Depth 3 }
else {
  foreach ($result in $results) {
    $name = Split-Path $result.file -Leaf
    if ($result.error) { Write-Host "FAIL  $name  $($result.error)" }
    else { Write-Host ("OK    {0}  {1} pages{2}" -f $name, $result.pages, $(if ($result.pdf) { "  -> $($result.pdf)" } else { '' })) }
  }
}
if ($results | Where-Object { $_.error }) { exit 1 }
