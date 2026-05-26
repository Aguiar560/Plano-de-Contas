@echo off
chcp 65001 >nul
cd /d "%~dp0server"
start "PlanoContas-Server" cmd /k "chcp 65001 >nul & node server.js"
timeout /t 5 /nobreak >nul
start "" http://localhost:3000
echo.
echo Login:  admin / admin
echo API:    http://localhost:3000
echo.
pause