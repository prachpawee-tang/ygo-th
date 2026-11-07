@echo off
rem Translation review page (local only). Double-click; your browser opens. Close this window when done,
rem then run tools\update-data.bat to commit and push.
rem (ASCII only on purpose: cmd misreads UTF-8 batch files. Messages come from review-ui.mjs)
setlocal
chcp 65001 >nul
cd /d "%~dp0.."
where node >nul 2>&1 || (echo [ERROR] Node.js not found. Install: winget install OpenJS.NodeJS.LTS & pause & exit /b 1)
node tools\review-ui.mjs %*
echo.
pause