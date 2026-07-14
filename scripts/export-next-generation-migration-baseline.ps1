[CmdletBinding()]
param(
  [string]$OutputRoot = (Join-Path $env:LOCALAPPDATA "Spectra\MigrationBackups")
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest
Add-Type -AssemblyName System.Security

function New-RandomBytes([int]$Count) {
  $bytes = New-Object byte[] $Count
  $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
  try {
    $rng.GetBytes($bytes)
  } finally {
    $rng.Dispose()
  }
  return $bytes
}

function Test-ByteArrayEqual([byte[]]$Left, [byte[]]$Right) {
  if ($Left.Length -ne $Right.Length) { return $false }
  $different = 0
  for ($index = 0; $index -lt $Left.Length; $index++) {
    $different = $different -bor ($Left[$index] -bxor $Right[$index])
  }
  return $different -eq 0
}

function Get-HmacForPrefix(
  [string]$Path,
  [byte[]]$Key,
  [long]$Length
) {
  $hmac = New-Object System.Security.Cryptography.HMACSHA256 (,$Key)
  $stream = [System.IO.File]::OpenRead($Path)
  try {
    $buffer = New-Object byte[] 1048576
    $remaining = $Length
    while ($remaining -gt 0) {
      $requested = [int][Math]::Min($buffer.Length, $remaining)
      $read = $stream.Read($buffer, 0, $requested)
      if ($read -le 0) { throw "Unexpected end of encrypted export while calculating integrity tag." }
      [void]$hmac.TransformBlock($buffer, 0, $read, $null, 0)
      $remaining -= $read
    }
    [void]$hmac.TransformFinalBlock((New-Object byte[] 0), 0, 0)
    return $hmac.Hash
  } finally {
    $stream.Dispose()
    $hmac.Dispose()
  }
}

$timestamp = [DateTime]::UtcNow.ToString("yyyyMMddTHHmmssZ")
$backupDirectory = Join-Path $OutputRoot $timestamp
[void](New-Item -ItemType Directory -Path $backupDirectory -Force)

$resolvedRoot = [System.IO.Path]::GetFullPath($OutputRoot)
$resolvedBackup = [System.IO.Path]::GetFullPath($backupDirectory)
if (-not $resolvedBackup.StartsWith($resolvedRoot, [StringComparison]::OrdinalIgnoreCase)) {
  throw "Resolved backup directory escaped the requested output root."
}

$plainPath = Join-Path $backupDirectory "convex-development-export.zip"
$encryptedPath = "$plainPath.aes"
$protectedKeyPath = Join-Path $backupDirectory "convex-development-export.key.dpapi"
$verificationPath = Join-Path $backupDirectory "convex-development-export.verify.zip"
$manifestPath = Join-Path $backupDirectory "manifest.json"

& npx convex export --include-file-storage --path $plainPath
if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $plainPath)) {
  throw "Convex export failed."
}

$plainHash = (Get-FileHash -Algorithm SHA256 -LiteralPath $plainPath).Hash.ToLowerInvariant()
$plainLength = (Get-Item -LiteralPath $plainPath).Length

$masterKey = New-RandomBytes 64
[byte[]]$encryptionKey = $masterKey[0..31]
[byte[]]$authenticationKey = $masterKey[32..63]
$protectedKey = [System.Security.Cryptography.ProtectedData]::Protect(
  $masterKey,
  $null,
  [System.Security.Cryptography.DataProtectionScope]::CurrentUser
)
[System.IO.File]::WriteAllBytes($protectedKeyPath, $protectedKey)

$magic = [System.Text.Encoding]::ASCII.GetBytes("SPCTRA01")
$aes = [System.Security.Cryptography.Aes]::Create()
$aes.KeySize = 256
$aes.BlockSize = 128
$aes.Mode = [System.Security.Cryptography.CipherMode]::CBC
$aes.Padding = [System.Security.Cryptography.PaddingMode]::PKCS7
$aes.Key = $encryptionKey
$aes.GenerateIV()
$iv = $aes.IV

$input = [System.IO.File]::OpenRead($plainPath)
$output = [System.IO.File]::Open($encryptedPath, [System.IO.FileMode]::CreateNew, [System.IO.FileAccess]::Write, [System.IO.FileShare]::None)
try {
  $output.Write($magic, 0, $magic.Length)
  $output.Write($iv, 0, $iv.Length)
  $encryptor = $aes.CreateEncryptor()
  $crypto = New-Object System.Security.Cryptography.CryptoStream ($output, $encryptor, [System.Security.Cryptography.CryptoStreamMode]::Write, $true)
  try {
    $input.CopyTo($crypto)
    $crypto.FlushFinalBlock()
  } finally {
    $crypto.Dispose()
    $encryptor.Dispose()
  }
} finally {
  $input.Dispose()
  $output.Dispose()
  $aes.Dispose()
}

$authenticatedLength = (Get-Item -LiteralPath $encryptedPath).Length
$tag = Get-HmacForPrefix -Path $encryptedPath -Key $authenticationKey -Length $authenticatedLength
$append = [System.IO.File]::Open($encryptedPath, [System.IO.FileMode]::Append, [System.IO.FileAccess]::Write, [System.IO.FileShare]::None)
try {
  $append.Write($tag, 0, $tag.Length)
} finally {
  $append.Dispose()
}

# Verify both authentication and decryption before deleting the plaintext export.
$encryptedLength = (Get-Item -LiteralPath $encryptedPath).Length
$payloadLength = $encryptedLength - $tag.Length
$calculatedTag = Get-HmacForPrefix -Path $encryptedPath -Key $authenticationKey -Length $payloadLength
$tagStream = [System.IO.File]::OpenRead($encryptedPath)
try {
  [void]$tagStream.Seek($payloadLength, [System.IO.SeekOrigin]::Begin)
  $storedTag = New-Object byte[] $tag.Length
  if ($tagStream.Read($storedTag, 0, $storedTag.Length) -ne $storedTag.Length) {
    throw "Could not read the stored integrity tag."
  }
} finally {
  $tagStream.Dispose()
}
if (-not (Test-ByteArrayEqual $calculatedTag $storedTag)) {
  throw "Encrypted export integrity verification failed."
}

$encryptedInput = [System.IO.File]::OpenRead($encryptedPath)
$verificationOutput = [System.IO.File]::Open($verificationPath, [System.IO.FileMode]::CreateNew, [System.IO.FileAccess]::Write, [System.IO.FileShare]::None)
try {
  $headerMagic = New-Object byte[] $magic.Length
  $headerIv = New-Object byte[] 16
  if ($encryptedInput.Read($headerMagic, 0, $headerMagic.Length) -ne $headerMagic.Length) { throw "Missing encrypted export header." }
  if (-not (Test-ByteArrayEqual $magic $headerMagic)) { throw "Unexpected encrypted export format." }
  if ($encryptedInput.Read($headerIv, 0, $headerIv.Length) -ne $headerIv.Length) { throw "Missing encrypted export IV." }

  $verifyAes = [System.Security.Cryptography.Aes]::Create()
  $verifyAes.KeySize = 256
  $verifyAes.BlockSize = 128
  $verifyAes.Mode = [System.Security.Cryptography.CipherMode]::CBC
  $verifyAes.Padding = [System.Security.Cryptography.PaddingMode]::PKCS7
  $verifyAes.Key = $encryptionKey
  $verifyAes.IV = $headerIv
  $decryptor = $verifyAes.CreateDecryptor()
  $limitedCiphertext = New-Object byte[] ($payloadLength - $magic.Length - $headerIv.Length)
  if ($encryptedInput.Read($limitedCiphertext, 0, $limitedCiphertext.Length) -ne $limitedCiphertext.Length) {
    throw "Encrypted export payload is truncated."
  }
  $ciphertextStream = New-Object System.IO.MemoryStream (,$limitedCiphertext)
  $decryptStream = New-Object System.Security.Cryptography.CryptoStream ($ciphertextStream, $decryptor, [System.Security.Cryptography.CryptoStreamMode]::Read)
  try {
    $decryptStream.CopyTo($verificationOutput)
  } finally {
    $decryptStream.Dispose()
    $ciphertextStream.Dispose()
    $decryptor.Dispose()
    $verifyAes.Dispose()
  }
} finally {
  $encryptedInput.Dispose()
  $verificationOutput.Dispose()
}

$verifiedHash = (Get-FileHash -Algorithm SHA256 -LiteralPath $verificationPath).Hash.ToLowerInvariant()
if ($verifiedHash -ne $plainHash) {
  throw "Decrypted export hash does not match the source export."
}

$manifest = [ordered]@{
  format = "spectra-convex-migration-export-v1"
  createdAtUtc = [DateTime]::UtcNow.ToString("o")
  source = "configured Convex development deployment"
  includesFileStorage = $true
  plaintextSha256 = $plainHash
  plaintextBytes = $plainLength
  encryptedFile = [System.IO.Path]::GetFileName($encryptedPath)
  keyFile = [System.IO.Path]::GetFileName($protectedKeyPath)
  keyProtection = "Windows DPAPI CurrentUser"
  encryption = "AES-256-CBC"
  authentication = "HMAC-SHA-256 over header and ciphertext"
  verifiedRoundTrip = $true
}
$manifest | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath $manifestPath -Encoding UTF8

$plainResolved = (Resolve-Path -LiteralPath $plainPath).Path
$verificationResolved = (Resolve-Path -LiteralPath $verificationPath).Path
if (-not $plainResolved.StartsWith($resolvedBackup, [StringComparison]::OrdinalIgnoreCase) -or
    -not $verificationResolved.StartsWith($resolvedBackup, [StringComparison]::OrdinalIgnoreCase)) {
  throw "Refusing to remove plaintext files outside the verified backup directory."
}
Remove-Item -LiteralPath $plainResolved -Force
Remove-Item -LiteralPath $verificationResolved -Force

[pscustomobject]@{
  BackupDirectory = $resolvedBackup
  ManifestPath = $manifestPath
  EncryptedBytes = (Get-Item -LiteralPath $encryptedPath).Length
  PlaintextSha256 = $plainHash
  VerifiedRoundTrip = $true
}
