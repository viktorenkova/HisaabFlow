[CmdletBinding()]
param(
    [string]$ReportPath = ""
)

$ErrorActionPreference = "Stop"

function Write-Step {
    param([string]$Message)
    Write-Host ""
    Write-Host "==> $Message" -ForegroundColor Cyan
}

function Resolve-ExistingPath {
    param(
        [string]$PathValue,
        [string]$Description
    )

    if (-not (Test-Path -LiteralPath $PathValue)) {
        throw "$Description not found: $PathValue"
    }

    return (Resolve-Path -LiteralPath $PathValue).Path
}

function Write-JsonReport {
    param(
        [hashtable]$Report,
        [string]$PathValue
    )

    $reportDir = Split-Path -Parent $PathValue
    if ($reportDir) {
        New-Item -ItemType Directory -Force -Path $reportDir | Out-Null
    }

    $Report | ConvertTo-Json -Depth 8 | Set-Content -Path $PathValue -Encoding UTF8
}

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$frontendRoot = Resolve-ExistingPath (Join-Path $scriptDir "..") "Frontend root"
$repoRoot = Resolve-ExistingPath (Join-Path $frontendRoot "..") "Repository root"
$installerGateScript = Resolve-ExistingPath (Join-Path $scriptDir "windows-installer-gate.ps1") "Windows installer gate script"

if (-not $ReportPath) {
    $ReportPath = Join-Path $repoRoot ".release-gate\windows-stage1-gate-report.json"
}

$installerReportPath = Join-Path $repoRoot ".release-gate\windows-installer-gate-report.json"
$reportStartedAt = Get-Date
$report = [ordered]@{
    gate = "windows-stage1"
    status = "running"
    started_at = $reportStartedAt.ToString("o")
    finished_at = $null
    duration_seconds = $null
    backend_tests_passed = $false
    installer_gate_report = $installerReportPath
    errors = @()
}

try {
    Push-Location $repoRoot
    try {
        Write-Step "Run backend test suite"
        python -m pytest backend/tests -q
        if ($LASTEXITCODE -ne 0) {
            throw "Backend test suite failed with exit code $LASTEXITCODE"
        }
    } finally {
        Pop-Location
    }

    $report.backend_tests_passed = $true

    Write-Step "Run installer gate with fresh build"
    powershell -ExecutionPolicy Bypass -File $installerGateScript -Build -SkipBackendTests -ReportPath $installerReportPath
    if ($LASTEXITCODE -ne 0) {
        throw "Installer gate failed with exit code $LASTEXITCODE"
    }

    $report.status = "passed"
    Write-Host ""
    Write-Host "Windows stage-1 gate passed." -ForegroundColor Green
    Write-Host "Stage-1 report: $ReportPath"
} catch {
    $report.status = "failed"
    $report.errors = @($_.Exception.Message)
    throw
} finally {
    $reportFinishedAt = Get-Date
    $report.finished_at = $reportFinishedAt.ToString("o")
    $report.duration_seconds = [Math]::Round(($reportFinishedAt - $reportStartedAt).TotalSeconds, 2)
    Write-JsonReport -Report $report -PathValue $ReportPath
}
