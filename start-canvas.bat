@echo off
setlocal
set "WEB_DIR=%~dp0web"

if not exist "%WEB_DIR%\package.json" (
    echo [Lihuo] Cannot find "%WEB_DIR%\package.json".
    echo [Lihuo] Keep this file next to the "web" folder.
    pause
    exit /b 1
)

pushd "%WEB_DIR%"

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

echo.
echo   [Lihuo] Starting at http://127.0.0.1:3000/
echo   The browser will open automatically.
echo   Keep this window open while using the canvas; closing it stops the server.
echo.

"%NODE_CMD%" "node_modules\vite\bin\vite.js" dev --host 127.0.0.1 --port 3000 --open
set "EXIT_CODE=%ERRORLEVEL%"

popd
echo.
echo   [Lihuo] Server stopped with code %EXIT_CODE%.
pause
