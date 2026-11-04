@echo off
setlocal
cd /d "%~dp0.."
where node >nul 2>&1 || (echo Node.js not found. Install: winget install OpenJS.NodeJS.LTS & pause & exit /b 1)
if "%YGOTH_GITHUB_TOKEN%"=="" (
  echo A fine-grained GitHub token for ygo-th only is needed. See MAINTAINING.md
  set /p YGOTH_GITHUB_TOKEN=Paste token:
  setx YGOTH_GITHUB_TOKEN "%YGOTH_GITHUB_TOKEN%" >nul
)
set "GITHUB_TOKEN=%YGOTH_GITHUB_TOKEN%"
set "GITHUB_REPOSITORY=prachpawee-tang/ygo-th"
if "%OLLAMA_MODEL%"=="" set "OLLAMA_MODEL=gemma3:12b"
git pull --ff-only
node tools\review-issues.mjs %*
echo.
pause
