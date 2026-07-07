@echo off
chcp 437 >nul 2>&1
title TDAI - Build Client Package
cd /d "%~dp0"

echo.
echo ============================================================
echo       TDAI RIS/PACS - Build Client Distribution
echo ============================================================
echo.

:: -- Check Docker --
docker info >nul 2>&1
if %errorlevel% neq 0 (
    echo   ERROR: Docker is not running. Start Docker Desktop first.
    pause
    exit /b 1
)

:: -- Step 1: Build all images --
echo [1/4] Building all Docker images...
echo       This may take 5-10 minutes on first build.
echo.
docker compose build
if %errorlevel% neq 0 (
    echo.
    echo   ERROR: Build failed. Check the output above.
    pause
    exit /b 1
)
echo.
echo       All images built successfully.

:: -- Step 2: Save images to tar --
echo.
echo [2/4] Saving all images to a single file (this will take a few minutes)...

docker save -o tdai-images.tar ^
    tdai-reporting-app-frontend ^
    tdai-reporting-app-backend ^
    tdai-dicoogle ^
    tdai-ohif ^
    tdai-monai-server ^
    tdai-medasr-server ^
    postgres:16-alpine ^
    orthancteam/orthanc:latest

if %errorlevel% neq 0 (
    echo.
    echo   ERROR: Failed to save images. Check the output above.
    pause
    exit /b 1
)
echo       Images saved to tdai-images.tar

:: -- Step 3: Assemble client folder --
echo.
echo [3/4] Assembling client package folder...

if exist "TDAI-RIS-PACS" rmdir /s /q "TDAI-RIS-PACS"
mkdir "TDAI-RIS-PACS"
mkdir "TDAI-RIS-PACS\migrations"

:: Copy the client-specific compose (no build: sections, only image: refs)
copy /y "docker-compose.client.yml"  "TDAI-RIS-PACS\docker-compose.yml" >nul

:: Copy startup and shutdown scripts
copy /y "start.bat"           "TDAI-RIS-PACS\" >nul
copy /y "start.sh"            "TDAI-RIS-PACS\" >nul
copy /y "stop.bat"            "TDAI-RIS-PACS\" >nul
copy /y "stop.sh"             "TDAI-RIS-PACS\" >nul

:: Copy seed-data scripts
if exist "seed-data.bat" copy /y "seed-data.bat" "TDAI-RIS-PACS\" >nul
if exist "seed-data.sh"  copy /y "seed-data.sh"  "TDAI-RIS-PACS\" >nul

:: Copy demo DICOM files
if exist "demo-dicoms" (
    mkdir "TDAI-RIS-PACS\demo-dicoms" 2>nul
    xcopy /y /e "demo-dicoms\*" "TDAI-RIS-PACS\demo-dicoms\" >nul
)

:: Copy pre-built images
copy /y "tdai-images.tar"     "TDAI-RIS-PACS\" >nul

:: Copy config files needed by bind-mounts
copy /y "pacs-stack\orthanc\orthanc.json"  "TDAI-RIS-PACS\" >nul
xcopy /y /e "packages\reporting-app\backend\migrations\*" "TDAI-RIS-PACS\migrations\" >nul

:: Copy service account (create empty placeholder if missing)
if exist "packages\reporting-app\backend\service-account.json" (
    copy /y "packages\reporting-app\backend\service-account.json" "TDAI-RIS-PACS\" >nul
) else (
    echo {} > "TDAI-RIS-PACS\service-account.json"
)

:: Copy docs
if exist "README.md" copy /y "README.md" "TDAI-RIS-PACS\" >nul

echo       Files copied to TDAI-RIS-PACS\

:: -- Step 4: Report --
echo.
echo [4/4] Package contents:
echo.
dir "TDAI-RIS-PACS" /-c
echo.

:: Get folder size
for /f "tokens=3" %%a in ('dir "TDAI-RIS-PACS" /s /-c ^| findstr /i "File(s)"') do set SIZE=%%a
set /a SIZE_MB=%SIZE% / 1048576

echo ============================================================
echo                     Package Ready!
echo ============================================================
echo.
echo   Folder: TDAI-RIS-PACS\
echo   Size:   ~%SIZE_MB% MB
echo.
echo   Contents:
echo     docker-compose.yml    (client version - no build sections)
echo     start.bat / start.sh  (one-click startup)
echo     stop.bat / stop.sh    (one-click shutdown)
echo     seed-data.bat/.sh     (demo data loader - runs on first start)
echo     demo-dicoms\          (sample DICOM files)
echo     tdai-images.tar       (all 8 pre-built Docker images)
echo     orthanc.json          (PACS config)
echo     migrations\           (database schema)
echo     service-account.json  (Firebase credentials)
echo     README.md             (setup instructions)
echo.
echo   Next steps:
echo     1. Zip the TDAI-RIS-PACS folder
echo     2. Send the zip to the client
echo     3. Client extracts and double-clicks start.bat (or ./start.sh)
echo.
echo   No .env file, no source code, no build tools needed.
echo.
pause
