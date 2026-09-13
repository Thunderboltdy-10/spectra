[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [string]$InputPath,
  [Parameter(Mandatory = $true)]
  [string]$OutputPath,
  [Parameter(Mandatory = $true)]
  [ValidateSet("docx", "xlsx", "pptx")]
  [string]$Format,
  [Parameter(Mandatory = $true)]
  [string]$ReportPath
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Release-Com([object]$value) {
  if ($null -ne $value -and [Runtime.InteropServices.Marshal]::IsComObject($value)) {
    try { [Runtime.InteropServices.Marshal]::FinalReleaseComObject($value) | Out-Null } catch { }
  }
}

function Ensure-Parent([string]$path) {
  $parent = Split-Path -Parent $path
  if ($parent -and -not (Test-Path -LiteralPath $parent)) {
    New-Item -ItemType Directory -Path $parent -Force | Out-Null
  }
}

$inputCopy = Join-Path ([IO.Path]::GetTempPath()) ("s8-office-readback-" + [Guid]::NewGuid().ToString("N") + [IO.Path]::GetExtension($InputPath))
$app = $null
$document = $null
$workbook = $null
$presentation = $null
$semantic = [ordered]@{}
$status = "passed"
$errorMessage = $null

try {
  Copy-Item -LiteralPath $InputPath -Destination $inputCopy -Force
  Ensure-Parent $OutputPath

  switch ($Format) {
    "docx" {
      $app = New-Object -ComObject Word.Application
      $app.Visible = $false
      $app.DisplayAlerts = 0
      $document = $app.Documents.Open($inputCopy, $false, $false, $false)
      $paragraphTexts = @($document.Paragraphs | ForEach-Object { [string]$_.Range.Text })
      $headerTexts = @($document.Sections | ForEach-Object { [string]$_.Headers.Item(1).Range.Text })
      $footerTexts = @($document.Sections | ForEach-Object { [string]$_.Footers.Item(1).Range.Text })
      $semantic = [ordered]@{
        application = "Word"
        version = [string]$app.Version
        sections = [int]$document.Sections.Count
        paragraphs = [int]$document.Paragraphs.Count
        tables = [int]$document.Tables.Count
        inlineShapes = [int]$document.InlineShapes.Count
        headers = $headerTexts
        footers = $footerTexts
        containsMatrix = (($paragraphTexts -join "`n") -match "1.*2.*3.*4")
        containsEditedCell = (($paragraphTexts -join "`n") -match "Clouds edited")
      }
      $document.SaveAs2($OutputPath, 16)
    }
    "xlsx" {
      $app = New-Object -ComObject Excel.Application
      $app.Visible = $false
      $app.DisplayAlerts = $false
      $workbook = $app.Workbooks.Open($inputCopy, 0, $false)
      $sheets = @()
      $chartCount = 0
      for ($index = 1; $index -le $workbook.Worksheets.Count; $index++) {
        $sheet = $workbook.Worksheets.Item($index)
        $usedRange = $sheet.UsedRange
        $charts = $sheet.ChartObjects()
        $chartCount += [int]$charts.Count
        $sheets += [ordered]@{
          name = [string]$sheet.Name
          usedRange = [string]$usedRange.Address($false, $false)
          charts = [int]$charts.Count
        }
        Release-Com $charts
        Release-Com $usedRange
        Release-Com $sheet
      }
      $semantic = [ordered]@{
        application = "Excel"
        version = [string]$app.Version
        worksheets = [int]$workbook.Worksheets.Count
        charts = $chartCount
        sheets = $sheets
      }
      $workbook.SaveAs($OutputPath, 51)
    }
    "pptx" {
      $app = New-Object -ComObject PowerPoint.Application
      $app.DisplayAlerts = 0
      $presentation = $app.Presentations.Open($inputCopy, $false, $false, $false)
      $slides = @()
      for ($index = 1; $index -le $presentation.Slides.Count; $index++) {
        $slide = $presentation.Slides.Item($index)
        $notesShapes = $slide.NotesPage.Shapes
        $chartShapes = 0
        for ($shapeIndex = 1; $shapeIndex -le $slide.Shapes.Count; $shapeIndex++) {
          $shape = $slide.Shapes.Item($shapeIndex)
          $hasChart = $false
          try { $hasChart = [bool]$shape.HasChart } catch { }
          if ([int]$shape.Type -eq 3 -or $hasChart) { $chartShapes += 1 }
          Release-Com $shape
        }
        $slides += [ordered]@{
          index = $index
          shapes = [int]$slide.Shapes.Count
          chartShapes = $chartShapes
          notesShapes = [int]$notesShapes.Count
        }
        Release-Com $notesShapes
        Release-Com $slide
      }
      $semantic = [ordered]@{
        application = "PowerPoint"
        version = [string]$app.Version
        slides = [int]$presentation.Slides.Count
        slideState = $slides
      }
      $presentation.SaveAs($OutputPath, 24)
    }
  }
}
catch {
  $status = "error"
  $errorMessage = $_.Exception.Message
}
finally {
  if ($document) { try { $document.Close($false) } catch { }; Release-Com $document }
  if ($workbook) { try { $workbook.Close($false) } catch { }; Release-Com $workbook }
  if ($presentation) { try { $presentation.Close() } catch { }; Release-Com $presentation }
  if ($app) { try { $app.Quit() } catch { }; Release-Com $app }
  if (Test-Path -LiteralPath $inputCopy) { Remove-Item -LiteralPath $inputCopy -Force }
}

$result = [ordered]@{
  status = $status
  format = $Format
  input = (Resolve-Path -LiteralPath $InputPath).Path
  output = $OutputPath
  semantic = $semantic
  error = $errorMessage
}
Ensure-Parent $ReportPath
$json = $result | ConvertTo-Json -Depth 12
Set-Content -LiteralPath $ReportPath -Value $json -Encoding UTF8
$json
if ($status -ne "passed") { exit 1 }
