#Requires -RunAsAdministrator
# One PC = one scanner. Stops EVERY old scan agent, then installs only this station.
param(
  [Parameter(Mandatory = $true)]
  [ValidateSet('1', '2', '3')]
  [string]$Scanner
)

$ErrorActionPreference = 'Stop'
$dir = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $dir

$labels = @{
  '1' = 'سكان 1 — منتهية (جهاز الريسبشن)'
  '2' = 'سكان 2 — ديزاين'
  '3' = 'سكان 3 — فينيش'
}

Write-Host ''
Write-Host ('This PC will be: ' + $labels[$Scanner])
Write-Host '[1/3] Stopping ALL old scan agents and barcode hooks...'

Get-CimInstance Win32_Process | ForEach-Object {
  $c = [string]$_.CommandLine
  if (-not $c) { return }
  $isScan =
    ($c -match 'scan-agent[/\\]+agent\.js') -or
    ($c -match 'win-us-barcode-hook') -or
    ($c -match 'config\.scanner[123]\.json')
  if ($isScan) {
    Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
    Write-Host ('  stopped PID ' + $_.ProcessId)
  }
}

Write-Host '[2/3] Removing old auto-start tasks (EleganceScanAgent 1/2/3)...'
foreach ($n in 1, 2, 3) {
  $name = "EleganceScanAgent$n"
  Disable-ScheduledTask -TaskName $name -ErrorAction SilentlyContinue | Out-Null
  Unregister-ScheduledTask -TaskName $name -Confirm:$false -ErrorAction SilentlyContinue
  Write-Host ('  removed ' + $name)
}

$daemon = Join-Path $dir 'daemon'
New-Item -ItemType Directory -Force -Path $daemon | Out-Null
Get-ChildItem $daemon -Filter 'scanner*.pid' -ErrorAction SilentlyContinue | Remove-Item -Force
Get-ChildItem $daemon -Filter 'scanner*.state.json' -ErrorAction SilentlyContinue | Remove-Item -Force

$printDaemon = Join-Path (Split-Path -Parent $dir) 'print-agent\daemon'
if (Test-Path $printDaemon) {
  Get-ChildItem $printDaemon -Filter 'scanner*.pid' -ErrorAction SilentlyContinue | Remove-Item -Force
}

Write-Host ('[3/3] Installing scanner ' + $Scanner + ' only...')
& powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $dir 'install-background.ps1') -Scanner $Scanner
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

Write-Host ''
Write-Host 'Done. This PC must run ONLY that one scanner.'
Write-Host 'If the completed-cases counter still jumps on Design, an old scanner 1 is still alive — reboot this PC and run this file again.'
