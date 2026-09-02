@echo off
setlocal
title Configure Shiftboard Firewall Access
echo Ask onsite ICT for the approved LAN subnet in CIDR format.
echo Example format only: 192.168.10.0/24
echo.
set /p "SHIFTBOARD_REMOTE_NETWORK=Approved LAN subnet: "
if "%SHIFTBOARD_REMOTE_NETWORK%"=="" (
  echo No subnet supplied. Nothing was changed.
  pause
  exit /b 1
)
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0deploy\windows\Configure-ShiftboardFirewall.ps1" -RemoteAddress "%SHIFTBOARD_REMOTE_NETWORK%"
set "SHIFTBOARD_EXIT_CODE=%ERRORLEVEL%"
echo.
pause
exit /b %SHIFTBOARD_EXIT_CODE%
