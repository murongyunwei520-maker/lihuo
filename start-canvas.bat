@echo off
setlocal
set "ROOT=%~dp0"
set "WEB_DIR=%ROOT%web"
set "PORT=3000"
set "URL=http://127.0.0.1:%PORT%/canvas"

if not exist "%WEB_DIR%\package.json" (
    echo [Lihuo] Cannot find "%WEB_DIR%\package.json".
    echo [Lihuo] Keep this file next to the "web" folder.
    pause
    exit /b 1
)

pushd "%WEB_DIR%"

rem 3000 已经在监听（多半是已经开着的画布）：直接开浏览器，不要再起一个。
rem 千万别让 vite 顺延端口——换端口就等于换 origin，浏览器里的画布数据存在 IndexedDB 里，
rem 按 origin 隔离，3001 上看到的会是一个空画布，看起来像「之前的任务全没了」。
set "PORT_TAKEN="
for /f "tokens=*" %%L in ('netstat -ano ^| findstr /r /c:":%PORT% .*LISTENING"') do set "PORT_TAKEN=1"
if defined PORT_TAKEN (
    echo.
    echo   [Lihuo] Port %PORT% is already in use - opening the running canvas at %URL%
    echo.
    set "BRIDGE_RUNNING="
    for /f "tokens=*" %%L in ('netstat -ano ^| findstr /r /c:":9091 .*LISTENING"') do set "BRIDGE_RUNNING=1"
    if not defined BRIDGE_RUNNING if exist "%ROOT%doubao-bridge\server.mjs" (
        start "Lihuo bridge" /min "%NODE_CMD%" "%ROOT%doubao-bridge\server.mjs"
        ping -n 3 127.0.0.1 >nul
    )
    start "" "%URL%"
    popd
    exit /b 0
)

rem Use the Node.js already on PATH first, then the runtime bundled with DeepSeek Harness.
set "NODE_CMD=node"
where node >nul 2>nul
if errorlevel 1 set "NODE_CMD=C:\Users\qq308\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe"
set "BUNDLED_PNPM=C:\Users\qq308\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\pnpm\bin\pnpm.mjs"
set "STORE_DIR=%~dp0..\.pnpm-store"

"%NODE_CMD%" -v >nul 2>nul
if errorlevel 1 (
    echo.
    echo [Lihuo] Node.js not found.
    echo Install Node.js LTS from https://nodejs.org/ and run this file again.
    echo.
    pause
    exit /b 1
)

if not exist "node_modules\vite\bin\vite.js" (
    echo.
    echo [Lihuo] First run: installing dependencies, this can take a few minutes...
    echo.
    "%NODE_CMD%" "%BUNDLED_PNPM%" install --node-linker=hoisted --store-dir "%STORE_DIR%"
    if errorlevel 1 (
        echo.
        echo [Lihuo] Dependency install failed, check the log above.
        echo.
        pause
        exit /b 1
    )
)

rem 开发服务器同样需要豆包桥接：没监听 :9091 就先拉起来
set "BRIDGE_RUNNING="
for /f "tokens=*" %%L in ('netstat -ano ^| findstr /r /c:":9091 .*LISTENING"') do set "BRIDGE_RUNNING=1"
if not defined BRIDGE_RUNNING if exist "%ROOT%doubao-bridge\server.mjs" (
    echo.
    echo   [Lihuo] Starting Doubao bridge on :9091 ...
    start "Lihuo bridge" /min "%NODE_CMD%" "%ROOT%doubao-bridge\server.mjs"
    ping -n 3 127.0.0.1 >nul
)

echo.
echo   [Lihuo] Starting at %URL%
echo   Bridge: http://127.0.0.1:9091/api/health
echo   The browser will open automatically.
echo   Keep this window open while using the canvas; closing it stops the server.
echo.

"%NODE_CMD%" "node_modules\vite\bin\vite.js" dev --host 127.0.0.1 --port 3000 --strictPort --open /canvas
set "EXIT_CODE=%ERRORLEVEL%"

popd
echo.
echo   [Lihuo] Server stopped with code %EXIT_CODE%.
pause
