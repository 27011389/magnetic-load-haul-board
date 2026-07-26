@echo off
setlocal
title Load and Haul Shiftboard
cd /d "%~dp0"

where node >nul 2>&1
if errorlevel 1 (
  echo Node.js was not found. Install Node.js 22 LTS first.
  pause
  exit /b 1
)

if not exist "node_modules" (
  echo The project has not been installed yet.
  echo Run INSTALL-FIRST.cmd before starting the board.
  pause
  exit /b 1
)

echo Starting the Load and Haul Shiftboard...
echo Host computer: http://localhost:5173
echo Other site computers: http://HOST-PC-IP:5173
echo.
echo Keep this window open. Press Ctrl+C to stop the board.
echo.
call npm run start

echo.
echo The shiftboard has stopped.
pause
