@echo off
title old.tv - local test
cd /d "%~dp0"

echo ============================================
echo   old.tv - LOCAL TEST (this computer only)
echo ============================================
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo [!] Node.js is not installed. Get the LTS version from nodejs.org, then run this file again.
  pause
  exit /b
)

if not exist node_modules (
  echo Installing packages...
  call npm install
  if errorlevel 1 (
    echo [x] npm install failed. Check your internet connection.
    pause
    exit /b
  )
)

set PORT=3000
set DEMO_VIP=1
set VIP_SECRET=test-%RANDOM%%RANDOM%%RANDOM%%RANDOM%%RANDOM%%RANDOM%

echo.
echo Open http://localhost:3000 in two browser windows to test.
echo Close this window to stop.
echo.
start "" http://localhost:3000
node server.js
pause
