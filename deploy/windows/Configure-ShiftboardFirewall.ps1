[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [ValidateNotNullOrEmpty()]
  [string]$RemoteAddress,

  [ValidateRange(1, 65535)]
  [int]$Port = 3000
)

$ErrorActionPreference = "Stop"
$ruleName = "Magnetic Load and Haul Shiftboard (Onsite LAN)"

try {
  $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
  $principal = [Security.Principal.WindowsPrincipal]::new($identity)
  if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    throw "Administrator access is required. Right-click Configure-Shiftboard-Firewall.cmd and choose Run as administrator."
  }

  if (Get-NetFirewallRule -DisplayName $ruleName -ErrorAction SilentlyContinue) {
    Write-Host "The firewall rule already exists and was left unchanged." -ForegroundColor Yellow
    Write-Host "Rule: $ruleName"
    exit 0
  }

  New-NetFirewallRule `
    -DisplayName $ruleName `
    -Description "Allows approved onsite computers to access the Magnetic Load and Haul Shiftboard." `
    -Direction Inbound `
    -Action Allow `
    -Protocol TCP `
    -LocalPort $Port `
    -Profile Domain, Private `
    -RemoteAddress $RemoteAddress | Out-Null

  Write-Host "Firewall access configured." -ForegroundColor Green
  Write-Host "TCP port: $Port"
  Write-Host "Approved remote network: $RemoteAddress"
} catch {
  Write-Error $_
  exit 1
}
