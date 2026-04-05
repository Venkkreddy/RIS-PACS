@echo off
setlocal

set PROJECT_ROOT=%~dp0..

echo ============================================
echo   TD-ai DICOM Setup
echo ============================================
echo.

:: Step 1: Install pydicom + numpy if needed
echo [1/3] Checking Python dependencies...
pip install pydicom numpy >nul 2>&1
if errorlevel 1 (
    echo [WARN] pip install failed — make sure Python and pip are on PATH.
)

:: Step 2: Generate sample DICOM files
echo [2/3] Generating sample DICOM files...
python "%~dp0generate_sample_dicoms.py"
if errorlevel 1 (
    echo [ERROR] DICOM generation failed.
    pause
    exit /b 1
)

:: Step 3: Trigger Dicoogle indexing (if running)
echo.
echo [3/3] Triggering Dicoogle re-index...
curl -s -X POST "http://localhost:8080/management/tasks/index?uri=file:///%PROJECT_ROOT:\=/%/storage" >nul 2>&1
if errorlevel 1 (
    echo [INFO] Dicoogle not running yet. Start it with: scripts\start-dicoogle-local.bat
    echo        Dicoogle will auto-index the storage folder on startup.
) else (
    echo [OK]   Indexing triggered. Give Dicoogle ~30 seconds to index.
)

echo.
echo ============================================
echo   Done! Generated DICOM files in:
echo   %PROJECT_ROOT%\storage
echo ============================================
echo.
echo Next steps:
echo   1. Start Dicoogle:  scripts\start-dicoogle-local.bat
echo   2. Start backend:   cd packages\reporting-app ^&^& npm run dev -w backend
echo   3. Start frontend:  cd packages\reporting-app ^&^& npm run dev -w frontend
echo   4. Open OHIF links in the worklist to view DICOM images.
echo.
pause
