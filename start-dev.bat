@echo off
setlocal
cd /d "%~dp0" || exit /b 1

where npm.cmd >nul 2>nul || goto :missing_npm

if exist "node_modules\" goto :run
echo First-time setup: installing dependencies...
call npm.cmd install --prefer-offline --no-audit --no-fund
if errorlevel 1 goto :install_failed

:run
echo Starting ComfyUI Prompt Workbench Tag Editor...
echo Open http://localhost:5173 in your browser.
call npm.cmd run dev -- --open
exit /b %errorlevel%

:missing_npm
echo [ERROR] npm.cmd was not found. Install Node.js 20 or later.
pause
exit /b 1

:install_failed
echo [ERROR] Dependency installation failed.
pause
exit /b 1
