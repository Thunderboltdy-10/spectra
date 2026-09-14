[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [string]$Before,
  [Parameter(Mandatory = $true)]
  [string]$After,
  [Parameter(Mandatory = $true)]
  [ValidateSet("docx", "xlsx", "pptx")]
  [string]$Format,
  [ValidateSet("Office2007", "Office2010", "Office2013", "Office2016", "Office2019", "Office2021", "Microsoft365")]
  [string]$FileFormatVersion = "Microsoft365",
  [string]$SdkAssemblyPath,
  [string]$FrameworkAssemblyPath,
  [string]$OutputPath
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Find-Assembly([string]$explicitPath, [string[]]$candidates) {
  if ($explicitPath) {
    if (-not (Test-Path -LiteralPath $explicitPath)) { throw "Open XML SDK assembly not found: $explicitPath" }
    return (Resolve-Path -LiteralPath $explicitPath).Path
  }
  foreach ($candidate in $candidates) {
    if (Test-Path -LiteralPath $candidate) { return (Resolve-Path -LiteralPath $candidate).Path }
  }
  return $null
}

function Ensure-Sdk {
  $localSdk = Join-Path $env:TEMP "s8-openxml-sdk-3.0.1"
  $sdk = Find-Assembly $SdkAssemblyPath @(
    (Join-Path $localSdk "sdk\lib\net8.0\DocumentFormat.OpenXml.dll"),
    (Join-Path $localSdk "lib\net8.0\DocumentFormat.OpenXml.dll"),
    (Join-Path $localSdk "package\lib\net8.0\DocumentFormat.OpenXml.dll"),
    "C:\Program Files\Microsoft Office\root\Office16\ADDINS\Microsoft Power Query for Excel Integrated\bin\DocumentFormat.OpenXml.dll"
  )
  $framework = Find-Assembly $FrameworkAssemblyPath @(
    (Join-Path $localSdk "framework\lib\net8.0\DocumentFormat.OpenXml.Framework.dll")
  )
  if ($sdk -and $framework) { return @{ Sdk = $sdk; Framework = $framework; Source = "local" } }

  $package = Join-Path $env:TEMP "s8-openxml-sdk-3.0.1.nupkg"
  $root = Join-Path $env:TEMP "s8-openxml-sdk-3.0.1"
  if (-not (Test-Path -LiteralPath $package)) {
    Invoke-WebRequest -Uri "https://api.nuget.org/v3-flatcontainer/documentformat.openxml/3.0.1/documentformat.openxml.3.0.1.nupkg" -OutFile $package
  }
  $sdkRoot = Join-Path $root "sdk"
  $frameworkPackage = Join-Path $env:TEMP "s8-openxml-framework-3.0.1.nupkg"
  $frameworkRoot = Join-Path $root "framework"
  New-Item -ItemType Directory -Path $sdkRoot -Force | Out-Null
  if (-not (Test-Path -LiteralPath (Join-Path $sdkRoot "lib\net8.0\DocumentFormat.OpenXml.dll"))) {
    Expand-Archive -LiteralPath $package -DestinationPath $sdkRoot -Force
  }
  if (-not (Test-Path -LiteralPath $frameworkPackage)) {
    Invoke-WebRequest -Uri "https://api.nuget.org/v3-flatcontainer/documentformat.openxml.framework/3.0.1/documentformat.openxml.framework.3.0.1.nupkg" -OutFile $frameworkPackage
  }
  New-Item -ItemType Directory -Path $frameworkRoot -Force | Out-Null
  if (-not (Test-Path -LiteralPath (Join-Path $frameworkRoot "lib\net8.0\DocumentFormat.OpenXml.Framework.dll"))) {
    Expand-Archive -LiteralPath $frameworkPackage -DestinationPath $frameworkRoot -Force
  }
  $sdk = Find-Assembly $SdkAssemblyPath @(
    (Join-Path $sdkRoot "lib\net8.0\DocumentFormat.OpenXml.dll")
  )
  $framework = Find-Assembly $FrameworkAssemblyPath @(
    (Join-Path $frameworkRoot "lib\net8.0\DocumentFormat.OpenXml.Framework.dll")
  )
  if (-not $sdk -or -not $framework) { throw "Open XML SDK 3.0.1 could not be resolved." }
  return @{ Sdk = $sdk; Framework = $framework; Source = "downloaded" }
}

function Read-PartHash([string]$path) {
  Add-Type -AssemblyName System.IO.Compression.FileSystem
  $zip = [IO.Compression.ZipFile]::OpenRead($path)
  try {
    $hash = @{}
    foreach ($entry in $zip.Entries) {
      if ($entry.FullName.EndsWith("/")) { continue }
      $stream = $entry.Open()
      try {
        $sha = [Security.Cryptography.SHA256]::Create()
        try { $hash[$entry.FullName] = ([BitConverter]::ToString($sha.ComputeHash($stream))).Replace("-", "").ToLowerInvariant() }
        finally { $sha.Dispose() }
      }
      finally { $stream.Dispose() }
    }
    return $hash
  }
  finally { $zip.Dispose() }
}

function Open-OfficeDocument([string]$path, [string]$kind) {
  switch ($kind) {
    "docx" { return [DocumentFormat.OpenXml.Packaging.WordprocessingDocument]::Open($path, $false) }
    "xlsx" { return [DocumentFormat.OpenXml.Packaging.SpreadsheetDocument]::Open($path, $false) }
    "pptx" { return [DocumentFormat.OpenXml.Packaging.PresentationDocument]::Open($path, $false) }
  }
  throw "Unsupported Office format: $kind"
}

function Get-Diagnostics([string]$path, [string]$kind, [DocumentFormat.OpenXml.FileFormatVersions]$version) {
  $document = $null
  try {
    $document = Open-OfficeDocument $path $kind
    $validator = [DocumentFormat.OpenXml.Validation.OpenXmlValidator]::new($version)
    $items = @($validator.Validate($document))
    return @($items | ForEach-Object {
      $part = ""
      if ($_.Part -and $_.Part.Uri) { $part = $_.Part.Uri.OriginalString.TrimStart("/") }
      $xpath = ""
      if ($_.Path -and $_.Path.XPath) { $xpath = [string]$_.Path.XPath }
      [ordered]@{
        type = [string]$_.ErrorType
        description = [string]$_.Description
        part = $part
        path = $xpath
      }
    })
  }
  finally {
    if ($document) { $document.Dispose() }
  }
}

$sdkInfo = Ensure-Sdk
Add-Type -Path $sdkInfo.Framework
Add-Type -Path $sdkInfo.Sdk
$version = [DocumentFormat.OpenXml.FileFormatVersions]::$FileFormatVersion
$beforeDiagnostics = @(Get-Diagnostics $Before $Format $version)
$afterDiagnostics = @(Get-Diagnostics $After $Format $version)
$beforeHashes = Read-PartHash $Before
$afterHashes = Read-PartHash $After
$changedParts = @($afterHashes.Keys + $beforeHashes.Keys | Sort-Object -Unique | Where-Object { $beforeHashes[$_] -ne $afterHashes[$_] })

function DiagnosticKey($item) {
  return "$($item.type)|$($item.part)|$($item.path)|$($item.description)"
}

$beforeKeys = @($beforeDiagnostics | ForEach-Object { DiagnosticKey $_ })
$afterKeys = @($afterDiagnostics | ForEach-Object { DiagnosticKey $_ })
$newDiagnostics = @($afterDiagnostics | Where-Object { $beforeKeys -notcontains (DiagnosticKey $_) })
$resolvedDiagnostics = @($beforeDiagnostics | Where-Object { $afterKeys -notcontains (DiagnosticKey $_) })
$result = [ordered]@{
  validator = "DocumentFormat.OpenXml"
  sdkVersion = [Diagnostics.FileVersionInfo]::GetVersionInfo($sdkInfo.Sdk).FileVersion
  sdkPath = $sdkInfo.Sdk
  format = $Format
  fileFormatVersion = $FileFormatVersion
  before = [ordered]@{ path = (Resolve-Path -LiteralPath $Before).Path; diagnostics = $beforeDiagnostics }
  after = [ordered]@{ path = (Resolve-Path -LiteralPath $After).Path; diagnostics = $afterDiagnostics }
  changedParts = $changedParts
  newDiagnostics = $newDiagnostics
  resolvedDiagnostics = $resolvedDiagnostics
  validAfter = ($afterDiagnostics.Count -eq 0)
}
$json = $result | ConvertTo-Json -Depth 12
if ($OutputPath) { Set-Content -LiteralPath $OutputPath -Value $json -Encoding UTF8 }
$json
