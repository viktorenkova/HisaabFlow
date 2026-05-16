[CmdletBinding()]
param(
    [int]$Port = 8000
)

$ErrorActionPreference = "Stop"

$HealthUrl = "http://127.0.0.1:$Port/health"
Write-Host "Checking $HealthUrl ..."

$health = Invoke-RestMethod -Uri $HealthUrl -TimeoutSec 5
$health | ConvertTo-Json -Depth 5

if ($health.status -ne "healthy" -or $health.routers_available -eq $false) {
    throw "Backend is not healthy."
}

Write-Host ""
Write-Host "Backend is healthy."

