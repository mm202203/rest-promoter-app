@echo off
start "REST Promoter" uv run uvicorn main:app --host 127.0.0.1 --port 8000
timeout /t 2 /nobreak > nul
start "" http://127.0.0.1:8000
