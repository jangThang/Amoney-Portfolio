@echo off
set "AMONEY_SERVER=%~dp0server.ps1"
powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "$serverPath=[IO.Path]::GetFullPath($env:AMONEY_SERVER); Get-CimInstance Win32_Process | Where-Object { $_.ProcessId -ne $PID -and $_.Name -in @('powershell.exe','pwsh.exe') -and $_.CommandLine -like ('*' + $serverPath + '*') } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }"
timeout /t 1 /nobreak >nul
start "" powershell.exe -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File "%~dp0server.ps1" -Port 8780
timeout /t 2 /nobreak >nul
start "" "http://localhost:8780/?v=20260818-54"
