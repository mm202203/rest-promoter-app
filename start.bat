@echo off
cd /d "%~dp0"
echo Starting REST Promoter...

if exist ".venv" (
  echo Removing .venv to avoid devcontainer conflict...
  rmdir /s /q ".venv"
)

echo Installing dependencies...
uv sync
if %errorlevel% neq 0 (
  echo ERROR: uv sync failed. Is uv installed?
  echo   https://docs.astral.sh/uv/
  pause
  exit /b 1
)

for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":8000 " ^| findstr "LISTENING" 2^>nul') do (
  echo Killing port 8000 process PID %%a...
  taskkill /f /pid %%a
)

start "REST Promoter" cmd /k "uv run uvicorn main:app --host 127.0.0.1 --port 8000"
echo Waiting for server to start...
timeout /t 8 /nobreak > nul
start http://127.0.0.1:8000
