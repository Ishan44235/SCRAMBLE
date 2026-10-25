@echo off
setlocal enabledelayedexpansion
title TRENCHCOAT - Game Server
cd /d "%~dp0"

echo.
echo   ==========================================
echo     T R E N C H C O A T
echo   ==========================================
echo.

REM ---- locate Python -------------------------------------------------
set "PY="
where py >nul 2>&1 && set "PY=py"
if not defined PY where python >nul 2>&1 && set "PY=python"

if not defined PY (
  echo   [X] Python was not found on this PC.
  echo.
  echo       Install it from https://www.python.org/downloads/
  echo       IMPORTANT: tick "Add Python to PATH" during setup.
  echo.
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

REM ---- hand off to the launcher --------------------------------------
".venv\Scripts\python.exe" launch.py
if errorlevel 1 pause
