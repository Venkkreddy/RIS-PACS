@echo off
setlocal

:: Project root (one level above scripts/)
set PROJECT_ROOT=%~dp0..
set DICOOGLE_HOME=%PROJECT_ROOT%\dicoogle-local
set DIST_DIR=%PROJECT_ROOT%\packages\dicoogle-server\dist\tdai-local-dicoogle

echo ============================================
echo   TD-ai Local Dicoogle PACS Server
echo ============================================
echo.

:: Check Java
java -version >nul 2>&1
if errorlevel 1 (
    echo [ERROR] Java not found. Install Java 11+ and try again.
    pause
    exit /b 1
)

:: Create local Dicoogle runtime directory (first time only)
if not exist "%DICOOGLE_HOME%\dicoogle.jar" (
    echo [SETUP] Creating Dicoogle local runtime...
    mkdir "%DICOOGLE_HOME%" 2>nul
    mkdir "%DICOOGLE_HOME%\Plugins\settings" 2>nul
    mkdir "%DICOOGLE_HOME%\Plugins\lua" 2>nul

    copy "%DIST_DIR%\bin\dicoogle.jar" "%DICOOGLE_HOME%\dicoogle.jar" >nul
    copy "%DIST_DIR%\bin\Plugins\*.jar" "%DICOOGLE_HOME%\Plugins\" >nul
    echo [SETUP] Copied Dicoogle jar and plugins.
)

:: Create storage and index directories
if not exist "%PROJECT_ROOT%\storage" mkdir "%PROJECT_ROOT%\storage"
if not exist "%PROJECT_ROOT%\dicoogle-index" mkdir "%PROJECT_ROOT%\dicoogle-index"

echo.
echo [INFO] Storage dir:  %PROJECT_ROOT%\storage
echo [INFO] Index dir:    %PROJECT_ROOT%\dicoogle-index
echo [INFO] Dicoogle URL: http://localhost:8080
echo [INFO] Credentials:  dicoogle / dicoogle
echo.
echo [START] Launching Dicoogle...
echo         Press Ctrl+C to stop.
echo.

cd /d "%DICOOGLE_HOME%"
java -jar dicoogle.jar -s
