@echo off
setlocal
set "ROOT=%~dp0"
set "WEB_DIR=%ROOT%web"
set "PORT=3000"
set "URL=http://127.0.0.1:%PORT%/"

if not exist "%WEB_DIR%\package.json" (
    echo [Lihuo] Cannot find "%WEB_DIR%\package.json".
    echo [Lihuo] Keep this file next to the "web" folder.
    pause
    exit /b 1
)

rem Use Node.js from PATH first, then the runtime bundled with DeepSeek Harness.
set "NODE_CMD=node"
where node >nul 2>nul
if errorlevel 1 set "NODE_CMD=C:\Users\qq308\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe"
set "BUNDLED_PNPM=C:\Users\qq308\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\pnpm\bin\pnpm.mjs"
set "STORE_DIR=%ROOT%..\.pnpm-store"

"%NODE_CMD%" -v >nul 2>nul
if errorlevel 1 (
    echo.
    echo [Lihuo] Node.js not found.
    echo Install Node.js LTS from https://nodejs.org/ and run this file again.
    echo.
    pause
    exit /b 1
)

pushd "%WEB_DIR%"

if not exist "node_modules\vite\bin\vite.js" (
    echo.
    echo [Lihuo] First run: installing dependencies, this can take a few minutes...
    echo.
    "%NODE_CMD%" "%BUNDLED_PNPM%" install --node-linker=hoisted --store-dir "%STORE_DIR%"
    if errorlevel 1 (
        popd
        echo.
        echo [Lihuo] Dependency install failed, check the log above.
        pause
        exit /b 1
    )
)

if not exist "dist\index.html" (
    echo.
    echo [Lihuo] Building the production bundle, this takes about a minute...
    echo.
    "%NODE_CMD%" "node_modules\vite\bin\vite.js" build
    if errorlevel 1 (
        popd
        echo.
        echo [Lihuo] Build failed, check the log above.
        pause
        exit /b 1
    )
)

rem The server below serves web\dist, so a bundle built before the last code change would silently
rem serve old UI. Rebuild whenever src\ (or index.html) is newer than dist\index.html.
if exist "dist\index.html" (
    "%NODE_CMD%" -e "const fs=require('fs'),p=require('path');const base=fs.statSync('dist/index.html').mtimeMs;let stale=false;const check=(f)=>{try{if(fs.statSync(f).mtimeMs>base)stale=true}catch(e){}};const walk=(d)=>{for(const e of fs.readdirSync(d,{withFileTypes:true})){if(stale)return;const f=p.join(d,e.name);if(e.isDirectory())walk(f);else if(/\.(ts|tsx|js|jsx|css|json|html)$/.test(e.name))check(f)}};walk('src');check('index.html');process.exit(stale?1:0)"
    if errorlevel 1 (
        echo.
        echo [Lihuo] Source changed since the last build, rebuilding...
        echo.
        "%NODE_CMD%" "node_modules\vite\bin\vite.js" build
        if errorlevel 1 (
            popd
            echo.
            echo [Lihuo] Build failed, check the log above.
            pause
            exit /b 1
        )
    )
)

popd

rem Start the local Doubao account-pool bridge (doubao-bridge) if it is not listening yet.
set "BRIDGE_RUNNING="
for /f "tokens=*" %%L in ('netstat -ano ^| findstr /r /c:":9091 .*LISTENING"') do set "BRIDGE_RUNNING=1"
if not defined BRIDGE_RUNNING if exist "%ROOT%doubao-bridge\server.mjs" (
    start "Lihuo bridge" /min "%NODE_CMD%" "%ROOT%doubao-bridge\server.mjs"
)

rem Already serving: just open the browser again.
set "RUNNING="
for /f "tokens=*" %%L in ('netstat -ano ^| findstr /r /c:":%PORT% .*LISTENING"') do set "RUNNING=1"

if defined RUNNING (
    start "" "%URL%"
    exit /b 0
)

start "Lihuo server" /min "%NODE_CMD%" "%ROOT%scripts\serve.mjs" "%WEB_DIR%\dist" %PORT%
ping -n 3 127.0.0.1 >nul
start "" "%URL%"

echo.
echo   [Lihuo] Opened %URL%
echo   The server runs in a minimized window.
echo   Double-click stop-canvas.bat to stop it.
echo.
ping -n 5 127.0.0.1 >nul
exit /b 0
