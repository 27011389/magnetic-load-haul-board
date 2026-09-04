@echo off
setlocal
cd /d "%~dp0"

echo Starting the shiftboard...
echo Open http://localhost:3000 on this computer.
echo Keep this window open while the board is in use.
echo.

call npm start

echo.
echo The shiftboard has stopped.
pause
