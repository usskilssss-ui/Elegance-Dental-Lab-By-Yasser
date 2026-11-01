@echo off
:: جهاز الفينيش فقط — سكان 3
:: كليك يمين → Run as administrator
cd /d "%~dp0"
net session >nul 2>&1
if %errorLevel% neq 0 (
  echo ERROR: Right-click this file — Run as administrator
  pause
  exit /b 1
)
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0setup-this-pc.ps1" -Scanner "3"
echo.
pause
