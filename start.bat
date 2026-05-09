@echo off
cd /d "%~dp0"
echo 起動中...
start /b cmd /c "timeout /t 3 /nobreak > nul & start \"\" http://127.0.0.1:8000"
uv run uvicorn main:app --host 127.0.0.1 --port 8000
pause
