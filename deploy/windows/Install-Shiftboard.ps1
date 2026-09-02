[CmdletBinding()]
param()

$ErrorActionPreference = "Stop"
$projectRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot "..\.."))

function Invoke-CheckedCommand {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Command,
    [Parameter(Mandatory = $true)]
    [string[]]$Arguments
  )

  & $Command @Arguments
  if ($LASTEXITCODE -ne 0) {
    throw "Command failed with exit code $LASTEXITCODE`: $Command $($Arguments -join ' ')"
  }
}

try {
  Set-Location -LiteralPath $projectRoot

  if (-not (Test-Path -LiteralPath (Join-Path $projectRoot "package-lock.json"))) {
    throw "package-lock.json was not found. Extract the complete deployment ZIP before running this installer."
  }

  $nodeCommand = Get-Command node.exe -ErrorAction SilentlyContinue
  $npmCommand = Get-Command npm.cmd -ErrorAction SilentlyContinue
  if (-not $nodeCommand -or -not $npmCommand) {
    throw "Node.js 24 or newer is required. Ask onsite ICT to install the approved 64-bit Node.js release, then run this installer again."
  }

  $nodeVersionText = (& $nodeCommand.Source --version).Trim().TrimStart("v")
  $nodeVersion = [version]$nodeVersionText
  if ($nodeVersion.Major -lt 24) {
    throw "Node.js 24 or newer is required. This computer has Node.js $nodeVersionText."
  }

  Write-Host "Magnetic Load and Haul Shiftboard installer" -ForegroundColor Cyan
  Write-Host "Application folder: $projectRoot"
  Write-Host "Node.js version: $nodeVersionText"
  Write-Host ""
  Write-Host "Installing the exact package versions from package-lock.json..."
  Invoke-CheckedCommand -Command $npmCommand.Source -Arguments @("ci")

  $dataDirectory = Join-Path $projectRoot "data"
  $backupDirectory = Join-Path $dataDirectory "backups"
  New-Item -ItemType Directory -Force -Path $dataDirectory, $backupDirectory | Out-Null

  $databasePath = Join-Path $dataDirectory "shiftboard.sqlite"
  if (Test-Path -LiteralPath $databasePath) {
    Write-Host ""
    Write-Host "Existing live database found. Creating a pre-install backup..."
    Invoke-CheckedCommand -Command $npmCommand.Source -Arguments @("run", "backup")
  } else {
    Write-Host ""
    Write-Host "No live database exists yet. It will be created on first start."
  }

  Write-Host ""
  Write-Host "Building the production application..."
  Invoke-CheckedCommand -Command $npmCommand.Source -Arguments @("run", "build")

  Write-Host ""
  Write-Host "Removing development-only packages from the onsite installation..."
  Invoke-CheckedCommand -Command $npmCommand.Source -Arguments @("prune", "--omit=dev")

  Write-Host ""
  Write-Host "Installation is complete." -ForegroundColor Green
  Write-Host "Run Start-Shiftboard.cmd to start the server."
  Write-Host "If this is the first installation, configure the approved firewall rule before other computers connect."
} catch {
  Write-Error $_
  exit 1
}
