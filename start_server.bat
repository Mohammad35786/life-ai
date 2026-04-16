@echo off
cd /d "D:\my projects\my research\life agent"
backend\venv\Scripts\python.exe -m uvicorn backend.main:app --reload --host 127.0.0.1 --port 8000
pause
