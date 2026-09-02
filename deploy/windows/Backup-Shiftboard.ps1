[CmdletBinding()]
param()

$ErrorActionPreference = "Stop"
$projectRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot "..\.."))
$npmCommand = Get-Command npm.cmd -ErrorAction SilentlyContinue

try {
  if (-not $npmCommand -or -not (Test-Path -LiteralPath (Join-Path $projectRoot "node_modules"))) {
    throw "The application dependencies are not installed. Run Install-Shiftboard.cmd first."
  }

  $databasePath = Join-Path $projectRoot "data\shiftboard.sqlite"
  if (-not (Test-Path -LiteralPath $databasePath)) {
    throw "No live shiftboard database exists yet. Start the board once before creating a backup."
  }

  Set-Location -LiteralPath $projectRoot
  $env:NODE_ENV = "production"
  $env:SHIFTBOARD_DB_PATH = $databasePath
  & $npmCommand.Source run backup
  if ($LASTEXITCODE -ne 0) {
    throw "The backup command failed with exit code $LASTEXITCODE."
  }
} catch {
  Write-Error $_
  exit 1
}
