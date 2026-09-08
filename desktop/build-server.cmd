@echo off
REM Build Nitro node-server into desktop/.output for Electron packaging.
setlocal
cd /d "%~dp0.."

echo [desktop] Building with NITRO_PRESET=node-server ...
set NITRO_PRESET=node-server
set VITE_ZANTO_DESKTOP=1
call bun run build
if errorlevel 1 (
  echo Build failed.
  exit /b 1
)

echo [desktop] Copying .output -^> desktop\.output
if exist "desktop\.output" rmdir /s /q "desktop\.output"
robocopy ".output" "desktop\.output" /E /NFL /NDL /NJH /NJS /nc /ns /np >nul
set RC=%ERRORLEVEL%
if %RC% GEQ 8 (
  echo robocopy failed with %RC%
  exit /b 1
)

REM Copy env template / optional secrets into server bundle (no commit of secrets required)
if exist ".env" (
  copy /Y ".env" "desktop\.output\.env" >nul
  echo [desktop] Copied .env into desktop\.output
) else if exist ".env.example" (
  copy /Y ".env.example" "desktop\.output\.env" >nul
  echo [desktop] Copied .env.example into desktop\.output ^(compila le chiavi^)
)

echo [desktop] Server build ready.
endlocal
