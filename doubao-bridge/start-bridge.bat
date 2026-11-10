@echo off
rem 启动豆包桥接服务（生成视频时会有可见浏览器窗口，方便观察）
setlocal
cd /d "%~dp0"
set "DOUBAO_BRIDGE_PORT=9091"
set "DOUBAO_ASK_HEADLESS=0"
where node >nul 2>nul
if errorlevel 1 (
    echo [Doubao Bridge] Node.js not found.
    pause
    exit /b 1
)
node "%~dp0server.mjs"
pause
