@echo off
chcp 437 >nul 2>&1
title TDAI RIS/PACS System
cd /d "%~dp0"

echo.
echo ============================================================
echo       TDAI RIS/PACS - Medical Imaging Platform
echo               Starting all services...
echo ============================================================
echo.

:: -- Step 1: Check Docker --
echo [1/6] Checking Docker...
docker info >nul 2>&1
if %errorlevel% neq 0 (
    echo.
    echo   ERROR: Docker is not running.
    echo   Please start Docker Desktop first, then double-click this file again.
    echo.
    pause
    exit /b 1
)
echo       Docker is running.

:: -- Step 2: Load pre-built images if available --
if exist "%~dp0tdai-images.tar" (
    echo.
    echo [2/6] Loading pre-built images from tdai-images.tar...
    echo       This may take a few minutes on first run.
    docker load -i "%~dp0tdai-images.tar"
    echo       Images loaded.
) else (
    echo [2/6] No pre-built images found - will build from source.
)

:: -- Step 3: Start all containers --
echo.
echo [3/6] Cleaning up any previous session...
docker compose down >nul 2>&1
docker rm -f tdai-postgres 2>nul
docker rm -f reporting-app-backend 2>nul
docker rm -f reporting-app-frontend 2>nul
docker rm -f ohif-viewer 2>nul
docker rm -f monai-server 2>nul
docker rm -f medasr-server 2>nul
docker rm -f dicoogle 2>nul
docker rm -f orthanc 2>nul

echo.
echo [4/6] Loading all components (this may take 2-3 minutes on first run)...
echo       Starting 8 services...
echo.
docker compose up -d
if %errorlevel% neq 0 (
    echo.
    echo   ERROR: docker compose failed. Check the output above.
    echo.
    pause
    exit /b 1
)

:: -- Step 4: Wait for frontend to become healthy --
echo.
echo [5/6] Waiting for system to become ready...

set /a attempts=0
set /a max_attempts=24

:healthloop
if %attempts% geq %max_attempts% goto :timeout

set /a attempts+=1
set /a elapsed=attempts*5

echo       Checking... (%elapsed%s / 120s)

:: Check if frontend is responding
curl -sk -o nul -w "" https://localhost:5173 >nul 2>&1
if %errorlevel% equ 0 goto :ready

timeout /t 5 /nobreak >nul
goto :healthloop

:ready
echo.
echo ============================================================
echo                    System is ready!
echo ============================================================
echo.

:: -- Seed demo data on first run only --
if exist "%~dp0.seeded" goto :skip_seed
if not exist "%~dp0seed-data.bat" goto :skip_seed
echo   Loading demo data (first run only)...
call "%~dp0seed-data.bat"
type nul > "%~dp0.seeded"
:skip_seed

:: -- Step 6: Open browser and show credentials --
echo.
echo [6/6] Opening browser...
start "" "https://localhost:5173"

echo.
echo ============================================================
echo   DEMO LOGIN CREDENTIALS
echo ============================================================
echo.
echo   Password for ALL accounts:  TDAI#Demo1234
echo.
echo   Email                         Role
echo   -------------------------------------------
echo   super_admin@example.com       Super Admin
echo   admin@example.com             Admin
echo   radiologist@example.com       Radiologist
echo   radiographer@example.com      Radiographer
echo   developer@example.com         Developer
echo   billing@example.com           Billing
echo   reception@example.com         Reception
echo   viewer@example.com            Viewer
echo.
echo ============================================================
echo.
echo   Service URLs:
echo     Frontend:     http://localhost:5173
echo     Backend API:  http://localhost:8081
echo     OHIF Viewer:  http://localhost:3000
echo     Orthanc:      http://localhost:8042
echo     Dicoogle:     http://localhost:8080
echo     MONAI:        http://localhost:5000
echo     MedASR:       http://localhost:5001
echo.
echo   To stop the system, double-click stop.bat
echo   or run: docker compose down
echo.
echo ============================================================
echo.
echo Press any key to close this window...
pause >nul
exit /b 0

:timeout
echo.
echo ============================================================
echo   Something went wrong. System did not start in time.
echo ============================================================
echo.
echo   Troubleshooting:
echo     1. Run "docker compose logs" to check for errors
echo     2. Make sure ports 5173, 8081, 3000, 8042, 8080 are free
echo     3. Try "docker compose down" then run this file again
echo.
echo   If the problem persists, please contact support.
echo.
echo Press any key to close this window...
pause >nul
exit /b 1
