@echo off
chcp 65001 >nul
cd /d "%~dp0"

if not exist "node_modules\" (
  echo Installing dependencies...
  call npm install
)

if not exist "config.scanner2.json" (
  copy /Y "config.scanner2.example.json" "config.scanner2.json" >nul
  echo.
  echo Created config.scanner2.json
  echo Edit EMAIL and PASSWORD for account سكان 2 then run this file again.
  notepad "config.scanner2.json"
  pause
  exit /b 1
)

echo Starting Scan Agent — سكان 2 (ديزاين)...
node agent.js config.scanner2.json
pause
