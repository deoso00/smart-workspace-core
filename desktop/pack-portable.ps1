# Pack a runnable ZAnto Windows portable folder (no electron-builder / no code-sign).
# Prereq: bun run desktop:build  (creates desktop\.output)
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

$outDir = Join-Path $PSScriptRoot "dist"
$portable = Join-Path $outDir "ZAntoAI-Portable"
$serverSrc = Join-Path $PSScriptRoot ".output"
$electronDist = Join-Path $root "node_modules\electron\dist"

if (-not (Test-Path (Join-Path $serverSrc "server\index.mjs"))) {
  throw "Manca desktop\.output - esegui prima: bun run desktop:build"
}
if (-not (Test-Path (Join-Path $electronDist "electron.exe"))) {
  throw "Manca node_modules\electron\dist\electron.exe - esegui: bun install"
}

Write-Host "[pack] Pulizia $portable"
if (Test-Path $outDir) { Remove-Item $outDir -Recurse -Force }
New-Item -ItemType Directory -Path $portable | Out-Null

Write-Host "[pack] Copia runtime Electron..."
robocopy $electronDist $portable /E /NFL /NDL /NJH /NJS /nc /ns /np | Out-Null
if ($LASTEXITCODE -ge 8) { throw "robocopy electron fallito: $LASTEXITCODE" }

$electronExe = Join-Path $portable "electron.exe"
$appExe = Join-Path $portable "ZAntoAI.exe"
if (-not (Test-Path $electronExe)) { throw "electron.exe non copiato" }
Move-Item $electronExe $appExe -Force

# Must remove Electron's default_app or our resources\app is ignored
$defaultAsar = Join-Path $portable "resources\default_app.asar"
if (Test-Path $defaultAsar) { Remove-Item $defaultAsar -Force }
$defaultApp = Join-Path $portable "resources\default_app"
if (Test-Path $defaultApp) { Remove-Item $defaultApp -Recurse -Force }

# Minimal Electron app (main process)
$appDir = Join-Path $portable "resources\app"
New-Item -ItemType Directory -Path $appDir -Force | Out-Null
Copy-Item (Join-Path $PSScriptRoot "main.cjs") (Join-Path $appDir "main.cjs") -Force
Copy-Item (Join-Path $PSScriptRoot "preload.cjs") (Join-Path $appDir "preload.cjs") -Force
Copy-Item (Join-Path $PSScriptRoot "README-INSTALL-IT.md") (Join-Path $appDir "README-INSTALL-IT.md") -Force

@'
{
  "name": "zanto-ai",
  "version": "1.0.0",
  "main": "main.cjs",
  "private": true
}
'@ | Set-Content -Path (Join-Path $appDir "package.json") -Encoding UTF8

Write-Host "[pack] Copia server Nitro -> resources\app-server ..."
$serverDest = Join-Path $portable "resources\app-server"
if (Test-Path $serverDest) { Remove-Item $serverDest -Recurse -Force }
New-Item -ItemType Directory -Path $serverDest -Force | Out-Null
robocopy $serverSrc $serverDest /E /NFL /NDL /NJH /NJS /nc /ns /np | Out-Null
if ($LASTEXITCODE -ge 8) { throw "robocopy server fallito: $LASTEXITCODE" }

$zipPath = Join-Path $outDir "ZAntoAI-Portable-1.0.0.zip"
Write-Host "[pack] ZIP $zipPath (puo richiedere qualche minuto)..."
if (Test-Path $zipPath) { Remove-Item $zipPath -Force }
Compress-Archive -Path $portable -DestinationPath $zipPath -CompressionLevel Fastest

Write-Host ""
Write-Host "PRONTO:"
Write-Host "  Cartella: $portable"
Write-Host "  Avvio:    $appExe"
Write-Host "  ZIP:      $zipPath"
Write-Host ""
Write-Host "Chiavi Supabase (se servono): %APPDATA%\zanto-ai\zanto.env"
