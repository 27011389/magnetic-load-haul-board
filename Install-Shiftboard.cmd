@echo off
setlocal
title Install Magnetic Load and Haul Shiftboard
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0deploy\windows\Install-Shiftboard.ps1"
set "SHIFTBOARD_EXIT_CODE=%ERRORLEVEL%"
echo.
if not "%SHIFTBOARD_EXIT_CODE%"=="0" (
  echo Installation failed. Review the message above.
) else (
  echo Installation completed successfully.
)
pause
exit /b %SHIFTBOARD_EXIT_CODE%
