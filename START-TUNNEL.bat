@echo off
setlocal enabledelayedexpansion
title TRENCHCOAT - Game Server (HTTPS tunnel)
cd /d "%~dp0"

echo.
echo   ==========================================
echo     T R E N C H C O A T   (public HTTPS)
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

REM ---- check cloudflared ---------------------------------------------
where cloudflared >nul 2>&1
if errorlevel 1 (
  echo   cloudflared not found. Installing via winget...
  winget install --id Cloudflare.cloudflared --accept-source-agreements --accept-package-agreements
  echo.
  echo   If that failed, install it manually, then run this again:
  echo     https://github.com/cloudflare/cloudflared/releases
  echo.
)

".venv\Scripts\python.exe" launch.py --tunnel
if errorlevel 1 pause
