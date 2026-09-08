# Create a full backup ZIP (source + installer if present). No secrets committed.
# Usage: bun run desktop:backup-zip  OR  powershell -File desktop/backup-zip.ps1

$ErrorActionPreference = "Stop"
$root = Resolve-Path (Join-Path $PSScriptRoot "..")
$stamp = Get-Date -Format "yyyyMMdd-HHmm"
$outDir = Join-Path $PSScriptRoot "backup"
New-Item -ItemType Directory -Force -Path $outDir | Out-Null
$zipPath = Join-Path $outDir "ZAnto-completo-backup-$stamp.zip"
$stage = Join-Path $env:TEMP "zanto-backup-stage-$stamp"

if (Test-Path $stage) { Remove-Item $stage -Recurse -Force }
New-Item -ItemType Directory -Force -Path $stage | Out-Null

$excludeDirs = @(
  "node_modules", ".git", ".output", "desktop\.output", "desktop\dist",
  "desktop\backup", ".wrangler", "dist", "coverage", ".cursor"
)

Write-Host "[backup] Staging project files..."
robocopy $root $stage /E /XD $excludeDirs /XF "*.log" /NFL /NDL /NJH /NJS /nc /ns /np | Out-Null
if ($LASTEXITCODE -ge 8) { throw "robocopy failed: $LASTEXITCODE" }

# Include built installer if present
$dist = Join-Path $PSScriptRoot "dist"
if (Test-Path $dist) {
  $installerDir = Join-Path $stage "desktop-installer"
  New-Item -ItemType Directory -Force -Path $installerDir | Out-Null
  Copy-Item (Join-Path $dist "*") $installerDir -Recurse -Force -ErrorAction SilentlyContinue
}

# Always include install readme at root of zip
Copy-Item (Join-Path $PSScriptRoot "README-INSTALL-IT.md") (Join-Path $stage "LEGGIMI-INSTALLAZIONE.md") -Force

# Never pack real .env into shared backup by default — copy example only
if (Test-Path (Join-Path $stage ".env")) {
  Remove-Item (Join-Path $stage ".env") -Force
}
Copy-Item (Join-Path $root ".env.example") (Join-Path $stage ".env.example") -Force -ErrorAction SilentlyContinue

if (Test-Path $zipPath) { Remove-Item $zipPath -Force }
Compress-Archive -Path (Join-Path $stage "*") -DestinationPath $zipPath -Force
Remove-Item $stage -Recurse -Force

Write-Host "[backup] Created: $zipPath"
Write-Host "[backup] Size: $([math]::Round((Get-Item $zipPath).Length / 1MB, 1)) MB"
