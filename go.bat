@echo off
chcp 65001 >nul
cd /d "%~dp0"
set "APP_ENV=development"
set "BACKGROUND_JOBS_ENABLED=false"
if not exist "node_modules" (
  npm ci
  if errorlevel 1 (
    echo 依赖安装失败，请检查上方错误。
    pause
    exit /b 1
  )
)
start /min cmd /c "npm run dev"
set /a retries=0
:wait
timeout /t 1 /nobreak >nul
netstat -an | findstr ":5173" >nul 2>&1
if %errorlevel% equ 0 goto ready
set /a retries+=1
if %retries% lss 60 goto wait
echo 前端在 60 秒内未启动，请在终端查看 npm run dev 的错误。
pause
exit /b 1
:ready
start http://localhost:5173
exit
