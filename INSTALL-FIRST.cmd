@echo off
setlocal
title Load and Haul Shiftboard - First Installation
cd /d "%~dp0"

where node >nul 2>&1
if errorlevel 1 (
  echo Node.js was not found.
  echo Install Node.js 22 LTS from https://nodejs.org/en/download
  echo Then run this file again.
  pause
  exit /b 1
)

echo Installing the Load and Haul Shiftboard packages...
call npm ci
if errorlevel 1 (
  echo.
  echo Installation failed. Check the internet connection and try again.
  pause
  exit /b 1
)

echo.
echo Installation completed successfully.
echo Double-click START-SHIFTBOARD.cmd to run the board.
pause
