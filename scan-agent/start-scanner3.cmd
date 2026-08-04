@echo off
chcp 65001 >nul
cd /d "%~dp0"

if not exist "node_modules\" (
  echo Installing dependencies...
  call npm install
)

if not exist "config.scanner3.json" (
  copy /Y "config.scanner3.example.json" "config.scanner3.json" >nul
  echo.
  echo Created config.scanner3.json
  echo Edit EMAIL and PASSWORD for account سكان 3 then run this file again.
  notepad "config.scanner3.json"
  pause
  exit /b 1
)

echo Starting Scan Agent — سكان 3 (فينيش)...
node agent.js config.scanner3.json
pause
