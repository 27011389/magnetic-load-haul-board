[CmdletBinding()]
param(
  [ValidateRange(1, 65535)]
  [int]$Port = 3000
)

$ErrorActionPreference = "Stop"
$projectRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot "..\.."))
$nextCommand = Join-Path $projectRoot "node_modules\.bin\next.cmd"
$buildId = Join-Path $projectRoot ".next\BUILD_ID"
$databasePath = Join-Path $projectRoot "data\shiftboard.sqlite"

try {
  if (-not (Test-Path -LiteralPath $nextCommand) -or -not (Test-Path -LiteralPath $buildId)) {
    throw "The production application is not installed. Run Install-Shiftboard.cmd first."
  }

  $listener = Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue
  if ($listener) {
    throw "TCP port $Port is already in use. The shiftboard may already be running."
  }

  New-Item -ItemType Directory -Force -Path (Split-Path -Parent $databasePath) | Out-Null
  $env:NODE_ENV = "production"
  $env:SHIFTBOARD_DB_PATH = $databasePath

  $addresses = Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue |
    Where-Object {
      $_.IPAddress -notmatch "^(127\.|169\.254\.)" -and
      $_.AddressState -eq "Preferred"
    } |
    Sort-Object InterfaceMetric, IPAddress -Unique |
    Select-Object -ExpandProperty IPAddress

  Write-Host "Magnetic Load and Haul Shiftboard" -ForegroundColor Cyan
  Write-Host "Live database: $databasePath"
  Write-Host "Host computer: http://localhost`:$Port"
  foreach ($address in $addresses) {
    Write-Host "Onsite computers: http://$address`:$Port" -ForegroundColor Green
  }
  Write-Host ""
  Write-Host "Keep this window open. Press Ctrl+C to stop the board."
  Write-Host ""

  Set-Location -LiteralPath $projectRoot
  & $nextCommand start --hostname 0.0.0.0 --port $Port
  exit $LASTEXITCODE
} catch {
  Write-Error $_
  exit 1
}
