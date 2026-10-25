@echo off
setlocal enabledelayedexpansion
title SCRAMBLE - Game Server (HTTPS tunnel)
cd /d "%~dp0"

echo.
echo   ==========================================
echo     S C R A M B L E   (public HTTPS)
echo   ==========================================
echo.
echo   Use this one for real phones, especially iPhones.
echo.

REM ---- locate Python -------------------------------------------------
set "PY="
where py >nul 2>&1 && set "PY=py"
if not defined PY where python >nul 2>&1 && set "PY=python"

if not defined PY (
  echo   [X] Python was not found on this PC.
  echo       Install from https://www.python.org/downloads/
  echo       and tick "Add Python to PATH".
  pause
  exit /b 1
)

REM ---- create virtual environment on first run -----------------------
if not exist ".venv\Scripts\python.exe" (
  echo   First run - creating virtual environment...
  %PY% -m venv .venv
  if errorlevel 1 (
    echo   [X] Could not create the virtual environment.
    pause
    exit /b 1
  )
)

REM ---- locate or install cloudflared -------------------------------
where cloudflared >nul 2>&1
if errorlevel 1 (
  if not exist "cloudflared.exe" (
    echo   cloudflared not found. Trying winget installation...
    where winget >nul 2>&1
    if not errorlevel 1 winget install --id Cloudflare.cloudflared --exact --accept-source-agreements --accept-package-agreements
    echo.
    echo   If not installed, download cloudflared.exe from:
    echo   https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/
    echo   and place cloudflared.exe beside this START-TUNNEL.bat file.
    echo.
  )
)

REM ---- launch with HTTPS tunnel --------------------------------------
".venv\Scripts\python.exe" launch.py --tunnel
if errorlevel 1 (
  echo   Tunnel startup failed. See the message above.
  pause
)
