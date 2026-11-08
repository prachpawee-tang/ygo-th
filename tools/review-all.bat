@echo off
rem Review all pending fixes: GitHub issues + Google Form suggestions (rule-check + local AI). Nothing is merged.
rem (ASCII only on purpose: cmd misreads UTF-8 batch files. Messages come from review-all.mjs)
setlocal
cd /d "%~dp0.."
set "BASE=E:\YGO-Translator"
where node >nul 2>&1 || (echo [ERROR] Node.js not found. Install: winget install OpenJS.NodeJS.LTS & pause & exit /b 1)
set "GITHUB_TOKEN=%YGOTH_GITHUB_TOKEN%"
set "GITHUB_REPOSITORY=prachpawee-tang/ygo-th"
if "%OLLAMA_MODEL%"=="" set "OLLAMA_MODEL=gemma3:12b"
rem Start Ollama only if it is not running (never kill one a batch may be using)
powershell -NoProfile -Command "try { Invoke-WebRequest -UseBasicParsing http://127.0.0.1:11434/api/version -TimeoutSec 3 | Out-Null; exit 0 } catch { exit 1 }"
if errorlevel 1 (
  echo Starting Ollama...
  set "OLLAMA_MODELS=%BASE%\models"
  set "OLLAMA_FLASH_ATTENTION=1"
  set "OLLAMA_KV_CACHE_TYPE=q8_0"
  start "Ollama" /min "%BASE%\Ollama\ollama.exe" serve
  timeout /t 8 >nul
)
chcp 65001 >nul
git pull --ff-only
node tools\review-all.mjs %*
echo.
pause