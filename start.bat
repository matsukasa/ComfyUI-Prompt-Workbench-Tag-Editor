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
set "TAG_EDITOR_URL=http://127.0.0.1:5173/"
powershell -NoProfile -Command "try { $r = Invoke-WebRequest -UseBasicParsing '%TAG_EDITOR_URL%' -TimeoutSec 1; if ($r.StatusCode -ge 200 -and $r.StatusCode -lt 500) { exit 0 } } catch { exit 1 }"
if not errorlevel 1 (
  echo Tag Editor is already running. Opening %TAG_EDITOR_URL%
  start "" "%TAG_EDITOR_URL%"
  echo.
  echo If the browser still shows a black screen, press Ctrl+F5 in the browser to reload without cache.
  pause
  exit /b 0
)
echo Open %TAG_EDITOR_URL% in your browser.
call npm.cmd run dev -- --host 127.0.0.1 --port 5173 --strictPort --open "%TAG_EDITOR_URL%"
if errorlevel 1 (
  echo.
  echo [ERROR] Tag Editor could not start. Port 5173 may already be in use.
  echo Close the old Tag Editor window or stop the old node process, then run start.bat again.
  pause
)
exit /b %errorlevel%

:missing_npm
echo [ERROR] npm.cmd was not found. Install Node.js 20 or later.
pause
exit /b 1

:install_failed
echo [ERROR] Dependency installation failed.
pause
exit /b 1
