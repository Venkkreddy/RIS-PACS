@echo off
chcp 437 >nul 2>&1
title TDAI RIS/PACS System - Shutdown
cd /d "%~dp0"

echo.
echo ============================================================
echo       Stopping all services and cleaning up...
echo.

docker compose down

echo.
echo ============================================================
echo   System stopped successfully.
echo.
echo   To start again, double-click start.bat
echo ============================================================
echo.
pause
