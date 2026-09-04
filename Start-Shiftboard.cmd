@echo off
setlocal
cd /d "%~dp0"

echo Starting the shiftboard...
echo Open http://localhost:5173 on this computer.
echo Site address: http://10.0.1.38:5173/
echo Keep this window open while the board is in use.
echo.

call npm start

echo.
echo The shiftboard has stopped.
pause
