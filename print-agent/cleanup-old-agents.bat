@echo off
:: One-time: remove leftover scanner/print scheduled tasks on this PC
net session >nul 2>&1
if %errorLevel% neq 0 (
  echo Right-click this file - Run as administrator
  pause
  exit /b 1
)
schtasks /Delete /TN "EleganceScanAgent1" /F >nul 2>&1
schtasks /Delete /TN "EleganceScanAgent2" /F >nul 2>&1
schtasks /Delete /TN "EleganceScanAgent3" /F >nul 2>&1
schtasks /Delete /TN "ElegancePrintAgent" /F >nul 2>&1
echo Done. Old extra agents removed.
echo Keep only: EleganceStationSupervisor
pause
