@echo off
setlocal
title Back Up Magnetic Load and Haul Shiftboard
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0deploy\windows\Backup-Shiftboard.ps1"
set "SHIFTBOARD_EXIT_CODE=%ERRORLEVEL%"
echo.
pause
exit /b %SHIFTBOARD_EXIT_CODE%
