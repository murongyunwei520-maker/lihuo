@echo off
setlocal
set "PORT=3000"
set "FOUND="

for /f "tokens=5" %%P in ('netstat -ano ^| findstr /r /c:":%PORT% .*LISTENING"') do (
    taskkill /f /pid %%P >nul 2>nul
    set "FOUND=1"
)

if defined FOUND (
    echo [Lihuo] Server on port %PORT% stopped.
) else (
    echo [Lihuo] Nothing is listening on port %PORT%.
)

ping -n 4 127.0.0.1 >nul
exit /b 0
