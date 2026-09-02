@echo off
setlocal
title Magnetic Load and Haul Shiftboard
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0deploy\windows\Start-Shiftboard.ps1"
set "SHIFTBOARD_EXIT_CODE=%ERRORLEVEL%"
if not "%SHIFTBOARD_EXIT_CODE%"=="0" (
  echo.
  echo The shiftboard stopped with an error. Review the message above.
  pause
)
exit /b %SHIFTBOARD_EXIT_CODE%
