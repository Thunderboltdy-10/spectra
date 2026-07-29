[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [string]$BackupDirectory
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest
Add-Type -AssemblyName System.Security
Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem

function Test-ByteArrayEqual([byte[]]$Left, [byte[]]$Right) {
  if ($Left.Length -ne $Right.Length) { return $false }
  $different = 0
  for ($index = 0; $index -lt $Left.Length; $index++) {
    $different = $different -bor ($Left[$index] -bxor $Right[$index])
  }
  return $different -eq 0
}

$backup = (Resolve-Path -LiteralPath $BackupDirectory).Path
$manifestPath = Join-Path $backup "manifest.json"
$manifest = Get-Content -Raw -LiteralPath $manifestPath | ConvertFrom-Json
$encryptedPath = Join-Path $backup $manifest.encryptedFile
$protectedKeyPath = Join-Path $backup $manifest.keyFile

$masterKey = [System.Security.Cryptography.ProtectedData]::Unprotect(
  [System.IO.File]::ReadAllBytes($protectedKeyPath),
  $null,
  [System.Security.Cryptography.DataProtectionScope]::CurrentUser
)
[byte[]]$encryptionKey = $masterKey[0..31]
[byte[]]$authenticationKey = $masterKey[32..63]

$payload = [System.IO.File]::ReadAllBytes($encryptedPath)
$magic = [System.Text.Encoding]::ASCII.GetBytes("SPCTRA01")
if ($payload.Length -lt ($magic.Length + 16 + 32 + 16)) { throw "Encrypted export is too short." }
[byte[]]$actualMagic = $payload[0..($magic.Length - 1)]
if (-not (Test-ByteArrayEqual $magic $actualMagic)) { throw "Unexpected encrypted export format." }

$tagOffset = $payload.Length - 32
[byte[]]$authenticatedPayload = $payload[0..($tagOffset - 1)]
[byte[]]$storedTag = $payload[$tagOffset..($payload.Length - 1)]
$hmac = New-Object System.Security.Cryptography.HMACSHA256 (,$authenticationKey)
try {
  $calculatedTag = $hmac.ComputeHash($authenticatedPayload)
} finally {
  $hmac.Dispose()
}
if (-not (Test-ByteArrayEqual $calculatedTag $storedTag)) { throw "Encrypted export authentication failed." }

[byte[]]$iv = $payload[$magic.Length..($magic.Length + 15)]
$ciphertextStart = $magic.Length + $iv.Length
[byte[]]$ciphertext = $payload[$ciphertextStart..($tagOffset - 1)]
$aes = [System.Security.Cryptography.Aes]::Create()
$aes.KeySize = 256
$aes.BlockSize = 128
$aes.Mode = [System.Security.Cryptography.CipherMode]::CBC
$aes.Padding = [System.Security.Cryptography.PaddingMode]::PKCS7
$aes.Key = $encryptionKey
$aes.IV = $iv
$decryptor = $aes.CreateDecryptor()
try {
  $plain = $decryptor.TransformFinalBlock($ciphertext, 0, $ciphertext.Length)
} finally {
  $decryptor.Dispose()
  $aes.Dispose()
}

$sha = [System.Security.Cryptography.SHA256]::Create()
try {
  $plainHash = ([BitConverter]::ToString($sha.ComputeHash($plain))).Replace("-", "").ToLowerInvariant()
} finally {
  $sha.Dispose()
}
if ($plainHash -ne $manifest.plaintextSha256) { throw "Decrypted snapshot hash does not match its manifest." }

$verificationRoot = [System.IO.Path]::GetFullPath((Join-Path $env:TEMP "SpectraMigrationVerify"))
$verificationDirectory = Join-Path $verificationRoot ([Guid]::NewGuid().ToString("N"))
[void](New-Item -ItemType Directory -Path $verificationDirectory -Force)
$resolvedVerification = [System.IO.Path]::GetFullPath($verificationDirectory)
if (-not $resolvedVerification.StartsWith($verificationRoot, [StringComparison]::OrdinalIgnoreCase)) {
  throw "Verification path escaped its temporary root."
}
$snapshotPath = Join-Path $verificationDirectory "snapshot.zip"

try {
  [System.IO.File]::WriteAllBytes($snapshotPath, $plain)
  $archive = [System.IO.Compression.ZipFile]::OpenRead($snapshotPath)
  try {
    $tableCount = 0
    $documentCount = 0
    $storageFileCount = 0
    foreach ($entry in $archive.Entries) {
      $normalized = $entry.FullName.Replace("\", "/")
      if ($normalized.StartsWith("/") -or $normalized -match '(^|/)\.\.(/|$)') {
        throw "Unsafe archive path: $normalized"
      }
      if ($normalized -like "_storage/*" -and -not $normalized.EndsWith("/")) {
        $storageFileCount++
      }
      if ($normalized -match '^([^/]+)/documents\.jsonl$') {
        $tableCount++
        $reader = New-Object System.IO.StreamReader ($entry.Open())
        try {
          while (($line = $reader.ReadLine()) -ne $null) {
            if ([string]::IsNullOrWhiteSpace($line)) { continue }
            [void]($line | ConvertFrom-Json)
            $documentCount++
          }
        } finally {
          $reader.Dispose()
        }
      }
    }
  } finally {
    $archive.Dispose()
  }

  [pscustomobject]@{
    BackupDirectory = $backup
    ManifestHashMatched = $true
    ArchivePathsSafe = $true
    JsonDocumentsParsed = $documentCount
    ExportedTables = $tableCount
    StorageFiles = $storageFileCount
    OfflineRestoreRehearsal = $true
  }
} finally {
  if ((Test-Path -LiteralPath $resolvedVerification) -and
      $resolvedVerification.StartsWith($verificationRoot, [StringComparison]::OrdinalIgnoreCase)) {
    Remove-Item -LiteralPath $resolvedVerification -Recurse -Force
  }
}
