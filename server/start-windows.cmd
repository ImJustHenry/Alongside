@echo off
setlocal
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Install Node.js 22 LTS or newer, then run this again.
  pause
  exit /b 1
)
if not exist node_modules (
  call npm ci --omit=dev
  if errorlevel 1 (
    pause
    exit /b 1
  )
)
echo Open http://localhost:4173 in your browser.
echo Keep this window open while using Alongside.
call npm start
pause
