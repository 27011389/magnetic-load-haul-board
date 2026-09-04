@echo off
setlocal
cd /d "%~dp0"

echo Installing packages...
call npm ci
if errorlevel 1 goto :failed

echo.
echo Building the shiftboard...
call npm run build
if errorlevel 1 goto :failed

echo.
echo Installation complete. Run Start-Shiftboard.cmd to start the board.
pause
exit /b 0

:failed
echo.
echo Installation failed. Check the message above.
pause
exit /b 1
