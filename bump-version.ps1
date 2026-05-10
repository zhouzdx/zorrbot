param(
    [string]$NewVersion
)

$base = "D:\z计划"
$extSrc = "$base\zorr-bot-extension"
$verFile = "$extSrc\version.json"

# Read current version
$current = Get-Content -LiteralPath $verFile -Raw -Encoding UTF8 | ConvertFrom-Json
$oldVer = $current.version

if (-not $NewVersion) {
    # Auto-increment: v1.0 -> v1.1 -> v1.2, or v2.0 -> v2.1
    $parts = $oldVer.Substring(1) -split '\.'
    $major = [int]$parts[0]
    $minor = [int]$parts[1]
    $NewVersion = "v$major.$($minor + 1)"
}

Write-Host "Bumping: $oldVer -> $NewVersion"

# Update version.json
$current.version = $NewVersion
$current.buildDate = (Get-Date -Format "yyyy-MM-dd HH:mm:ss")
$current | ConvertTo-Json | Set-Content -LiteralPath $verFile -Encoding UTF8

# Copy to versions archive
$vDir = "$base\versions\$NewVersion\zorr-bot-extension"
New-Item -ItemType Directory -Path $vDir -Force | Out-Null
xcopy /E /I /Y "$extSrc\*" "$vDir\" 2>&1 | Out-Null
Write-Host "  -> versions/$NewVersion/zorr-bot-extension ($( (Get-ChildItem -Recurse -File $vDir).Count ) files)"

# Create release folder and zip
$rDir = "$base\release\$NewVersion\zorr-bot-extension"
New-Item -ItemType Directory -Path $rDir -Force | Out-Null
xcopy /E /I /Y "$extSrc\*" "$rDir\" 2>&1 | Out-Null

Add-Type -AssemblyName System.IO.Compression.FileSystem
$zipFile = "$base\release\$NewVersion\zorr-bot-extension.zip"
if (Test-Path $zipFile) { Remove-Item -Force $zipFile }
[System.IO.Compression.ZipFile]::CreateFromDirectory($rDir, $zipFile)
Write-Host "  -> release/$NewVersion/zorr-bot-extension.zip ($( (Get-Item $zipFile).Length ) bytes)"

Write-Host "Done!"
