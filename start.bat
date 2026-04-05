@echo off
:: Quick launcher — double-click this or run from cmd.
:: Pass arguments just like the PowerShell script:
::   start.bat              (full stack)
::   start.bat dev          (Docker backends + local frontend)
::   start.bat core         (minimal services)
::   start.bat stop         (shut down)
::   start.bat reset        (nuke volumes & rebuild)

set MODE=%1
if "%MODE%"=="" set MODE=full

powershell -ExecutionPolicy Bypass -File "%~dp0start.ps1" -Mode %MODE% %2 %3 %4
pause
