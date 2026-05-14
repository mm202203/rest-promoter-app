@echo off
cd /d "%~dp0"
echo 起動中...

if exist ".venv" (
  echo .venvを再作成しています（devcontainerとの競合を防ぐため）...
  rmdir /s /q .venv
)

for /f "tokens=5" %%a in ('netstat -ano ^| findstr :8000 ^| findstr LISTENING') do (
  echo ポート8000を使用中のプロセスを終了します...
  taskkill /f /pid %%a
)

start "REST Promoter" cmd /k "uv run uvicorn main:app --host 127.0.0.1 --port 8000"
timeout /t 5 /nobreak > nul
start http://127.0.0.1:8000
