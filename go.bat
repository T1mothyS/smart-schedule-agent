@echo off
chcp 65001 >nul
cd /d "%~dp0"
if not exist "node_modules" npm install >nul 2>&1
start /min cmd /c "npm run dev"
:wait
timeout /t 1 /nobreak >nul
netstat -an | findstr ":5173" >nul 2>&1
if %errorlevel% neq 0 goto wait
start http://localhost:5173
exit