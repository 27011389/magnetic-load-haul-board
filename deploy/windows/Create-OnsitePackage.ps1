[CmdletBinding()]
param(
  [switch]$SkipValidation
)

$ErrorActionPreference = "Stop"
$projectRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot "..\.."))
$outputDirectory = [IO.Path]::GetFullPath((Join-Path $projectRoot "output\onsite"))
$package = Get-Content -Raw -LiteralPath (Join-Path $projectRoot "package.json") | ConvertFrom-Json
$version = $package.version
$timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
$archivePath = Join-Path $outputDirectory "magnetic-shiftboard-$version-$timestamp.zip"
$stagingPath = Join-Path $outputDirectory "staging-$([guid]::NewGuid().ToString('N'))"

$packageEntries = @(
  ".npmrc",
  "app",
  "db",
  "deploy",
  "drizzle",
  "public",
  "scripts",
  "tests",
  "Backup-Shiftboard.cmd",
  "Configure-Shiftboard-Firewall.cmd",
  "Install-Shiftboard.cmd",
  "Start-Shiftboard.cmd",
  "ONSITE-SETUP.md",
  "README.md",
  "SECURITY.md",
  "drizzle.config.ts",
  "eslint.config.mjs",
  "next.config.ts",
  "package-lock.json",
  "package.json",
  "postcss.config.mjs",
  "tsconfig.json"
)

function Invoke-CheckedNpm {
  param([string[]]$Arguments)
  & npm.cmd @Arguments
  if ($LASTEXITCODE -ne 0) {
    throw "npm $($Arguments -join ' ') failed with exit code $LASTEXITCODE."
  }
}

try {
  Set-Location -LiteralPath $projectRoot
  if (-not $SkipValidation) {
    Write-Host "Validating the production build before packaging..."
    Invoke-CheckedNpm -Arguments @("run", "build")
  }

  New-Item -ItemType Directory -Force -Path $outputDirectory, $stagingPath | Out-Null
  foreach ($entry in $packageEntries) {
    $sourcePath = Join-Path $projectRoot $entry
    if (-not (Test-Path -LiteralPath $sourcePath)) {
      throw "Required package entry is missing: $entry"
    }
    Copy-Item -LiteralPath $sourcePath -Destination $stagingPath -Recurse
  }

  Compress-Archive -Path (Join-Path $stagingPath "*") -DestinationPath $archivePath -CompressionLevel Optimal
  Write-Host ""
  Write-Host "Created onsite deployment package:" -ForegroundColor Green
  Write-Host $archivePath
  Write-Host ""
  Write-Host "The live data directory is intentionally not included."
} finally {
  $resolvedStagingPath = [IO.Path]::GetFullPath($stagingPath)
  $outputPrefix = $outputDirectory.TrimEnd([IO.Path]::DirectorySeparatorChar) + [IO.Path]::DirectorySeparatorChar
  if (-not $resolvedStagingPath.StartsWith($outputPrefix, [StringComparison]::OrdinalIgnoreCase)) {
    throw "Refusing to remove an unexpected staging path: $resolvedStagingPath"
  }
  if (Test-Path -LiteralPath $resolvedStagingPath) {
    Remove-Item -LiteralPath $resolvedStagingPath -Recurse -Force
  }
}
