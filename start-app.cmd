@echo off
start "" powershell.exe -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File "%~dp0server.ps1" -Port 8780
timeout /t 2 /nobreak >nul
start "" "http://localhost:8780/?v=20260804-2"
