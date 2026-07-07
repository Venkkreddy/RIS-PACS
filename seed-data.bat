@echo off
chcp 437 >nul 2>&1
setlocal enabledelayedexpansion

echo.
echo ============================================================
echo          Loading Demo DICOM Files into Orthanc
echo ============================================================
echo.

:: Wait for Orthanc to be ready
echo   Waiting for Orthanc to be ready...
set /a attempts=0
set /a max_attempts=30

:orthanc_wait
if !attempts! geq %max_attempts% (
    echo   WARNING: Orthanc did not respond after 150 seconds.
    echo   Demo files were NOT loaded. You can run this script again later.
    goto :done
)
set /a attempts+=1
curl -sf http://localhost:8042/system >nul 2>&1
if !errorlevel! equ 0 goto :orthanc_ready
timeout /t 5 /nobreak >nul
goto :orthanc_wait

:orthanc_ready
echo   Orthanc is ready!
echo.

:: Upload each DCM file in demo-dicoms folder
set /a uploaded=0
set /a failed=0

for %%F in (demo-dicoms\*.dcm) do (
    echo   Uploading: %%~nxF
    curl -sf -X POST http://localhost:8042/instances --data-binary @"%%F" >nul 2>&1
    if !errorlevel! equ 0 (
        set /a uploaded+=1
    ) else (
        echo     WARNING: Failed to upload %%~nxF
        set /a failed+=1
    )
)

echo.
if !uploaded! gtr 0 goto :show_success
echo   No .dcm files found in demo-dicoms folder.
goto :show_failures

:show_success
echo   Demo files loaded successfully! %uploaded% file(s) uploaded.

:show_failures
if !failed! gtr 0 echo   WARNING: %failed% file(s) failed to upload.
echo.

:done
endlocal
