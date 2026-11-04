@echo off
rem Import batch output into data\cards and validate. Double-click, or:
rem   tools\update-data.bat [path\to\cards-th.jsonl]
rem (ASCII only on purpose: cmd misreads UTF-8 batch files. Messages come from update-data.mjs)
setlocal
chcp 65001 >nul
cd /d "%~dp0.."
where node >nul 2>&1 || (echo [ERROR] Node.js not found. Install: winget install OpenJS.NodeJS.LTS & pause & exit /b 1)
node tools\update-data.mjs %*
set "RC=%ERRORLEVEL%"
echo.
pause
exit /b %RC%
