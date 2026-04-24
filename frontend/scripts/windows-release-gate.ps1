[CmdletBinding()]
param(
    [switch]$Build,
    [switch]$SkipBackendTests,
    [string]$UnpackedDir = "",
    [int]$Port = 8011,
    [string]$KnownFile = "",
    [string]$UnknownFile = "",
    [string]$RefundFile = "",
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

function Invoke-CheckedCommand {
    param(
        [string]$Name,
        [scriptblock]$Command
    )

    Write-Step $Name
    & $Command
    if ($LASTEXITCODE -ne 0) {
        throw "$Name failed with exit code $LASTEXITCODE"
    }
}

function Wait-ForBackendHealth {
    param(
        [string]$BaseUrl,
        [System.Diagnostics.Process]$Process,
        [string]$StdoutLog,
        [string]$StderrLog
    )

    for ($attempt = 1; $attempt -le 40; $attempt++) {
        if ($Process.HasExited) {
            throw "Packaged backend exited before becoming healthy. Stdout log: $StdoutLog. Stderr log: $StderrLog"
        }

        try {
            $health = Invoke-RestMethod -Uri "$BaseUrl/health" -TimeoutSec 2
            if ($health.status -eq "healthy" -and $health.routers_available -ne $false) {
                Write-Host "Backend is healthy at $BaseUrl" -ForegroundColor Green
                return
            }
        } catch {
        }

        Start-Sleep -Milliseconds 500
    }

    throw "Timed out waiting for packaged backend health at $BaseUrl. Stdout log: $StdoutLog. Stderr log: $StderrLog"
}

function Wait-ForProcessExit {
    param(
        [System.Diagnostics.Process]$Process,
        [int]$TimeoutSeconds = 10
    )

    if (-not $Process) {
        return $true
    }

    $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
    while ((Get-Date) -lt $deadline) {
        if ($Process.HasExited) {
            return $true
        }
        Start-Sleep -Milliseconds 250
    }

    return $Process.HasExited
}

function Wait-ForEndpointShutdown {
    param(
        [string]$BaseUrl,
        [int]$TimeoutSeconds = 10
    )

    $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
    while ((Get-Date) -lt $deadline) {
        try {
            Invoke-RestMethod -Uri "$BaseUrl/health" -TimeoutSec 2 | Out-Null
        } catch {
            return $true
        }
        Start-Sleep -Milliseconds 250
    }

    return $false
}

function Set-ScopedEnvironmentVariables {
    param([hashtable]$Variables)

    $backup = @{}
    foreach ($key in $Variables.Keys) {
        $existing = [Environment]::GetEnvironmentVariable($key, "Process")
        if ($null -eq $existing) {
            $backup[$key] = $null
        } else {
            $backup[$key] = $existing
        }
        [Environment]::SetEnvironmentVariable($key, $Variables[$key], "Process")
    }

    return $backup
}

function Restore-ScopedEnvironmentVariables {
    param([hashtable]$Backup)

    foreach ($key in $Backup.Keys) {
        [Environment]::SetEnvironmentVariable($key, $Backup[$key], "Process")
    }
}

function Assert-PackagedPythonModules {
    param(
        [string]$PythonExe,
        [string[]]$ModuleNames
    )

    foreach ($moduleName in $ModuleNames) {
        & $PythonExe -c "import importlib; importlib.import_module('$moduleName')"
        if ($LASTEXITCODE -ne 0) {
            throw "Packaged Python is missing module '$moduleName'. Rebuild the Python bundle before release verification."
        }
    }
}

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$frontendRoot = Resolve-ExistingPath (Join-Path $scriptDir "..") "Frontend root"
$repoRoot = Resolve-ExistingPath (Join-Path $frontendRoot "..") "Repository root"

if (-not $ReportPath) {
    $ReportPath = Join-Path $repoRoot ".release-gate\windows-release-gate-report.json"
}

$reportStartedAt = Get-Date
$report = [ordered]@{
    gate = "windows-release"
    status = "running"
    started_at = $reportStartedAt.ToString("o")
    finished_at = $null
    duration_seconds = $null
    build_requested = [bool]$Build
    skip_backend_tests = [bool]$SkipBackendTests
    unpacked_dir = $null
    resources_dir = $null
    backend_dir = $null
    python_exe = $null
    config_dir = $null
    base_url = $null
    stdout_log = $null
    stderr_log = $null
    cleanup_verified = $false
    errors = @()
}

try {
    if (-not $UnpackedDir) {
        $UnpackedDir = Join-Path $frontendRoot "dist\\win-unpacked"
    }

    if ($Build) {
        Push-Location $frontendRoot
        try {
            Invoke-CheckedCommand "Build Windows package" { npm.cmd run dist:win }
        } finally {
            Pop-Location
        }
    }

    $unpackedPath = Resolve-ExistingPath $UnpackedDir "Windows unpacked build"
    $resourcesDir = Resolve-ExistingPath (Join-Path $unpackedPath "resources") "Packaged resources directory"
    $backendDir = Resolve-ExistingPath (Join-Path $resourcesDir "backend") "Packaged backend directory"
    $pythonExe = Resolve-ExistingPath (Join-Path $resourcesDir "python-bundle\\python\\python.exe") "Packaged Python runtime"
    $configDir = Resolve-ExistingPath (Join-Path $resourcesDir "configs") "Packaged config directory"

    $report.unpacked_dir = $unpackedPath
    $report.resources_dir = $resourcesDir
    $report.backend_dir = $backendDir
    $report.python_exe = $pythonExe
    $report.config_dir = $configDir

    Write-Step "Validate packaged Python test/runtime modules"
    Assert-PackagedPythonModules -PythonExe $pythonExe -ModuleNames @("pytest", "httpx")

    $gateLogDir = Join-Path $repoRoot ".release-gate"
    New-Item -ItemType Directory -Force -Path $gateLogDir | Out-Null
    $stdoutLog = Join-Path $gateLogDir "packaged-backend-stdout.log"
    $stderrLog = Join-Path $gateLogDir "packaged-backend-stderr.log"
    Remove-Item -LiteralPath $stdoutLog, $stderrLog -Force -ErrorAction SilentlyContinue

    $report.stdout_log = $stdoutLog
    $report.stderr_log = $stderrLog

    if (-not $SkipBackendTests) {
        Push-Location $repoRoot
        try {
            Invoke-CheckedCommand "Run backend test suite" { python -m pytest backend/tests -q }
        } finally {
            Pop-Location
        }
    }

    $baseUrl = "http://127.0.0.1:$Port"
    $report.base_url = $baseUrl

    $envValues = @{
        "PYTHONPATH" = $backendDir
        "PYTHONUTF8" = "1"
        "PYTHONIOENCODING" = "utf-8"
        "HISAABFLOW_CONFIG_DIR" = $configDir
        "HISAABFLOW_SMOKE_BASE_URL" = $baseUrl
    }

    if ($KnownFile) {
        $envValues["HISAABFLOW_SMOKE_KNOWN_FILE"] = Resolve-ExistingPath $KnownFile "Known-bank smoke sample"
    }

    if ($UnknownFile) {
        $envValues["HISAABFLOW_SMOKE_UNKNOWN_FILE"] = Resolve-ExistingPath $UnknownFile "Unknown-bank smoke sample"
    }

    if ($RefundFile) {
        $envValues["HISAABFLOW_SMOKE_REFUND_FILE"] = Resolve-ExistingPath $RefundFile "Refund smoke sample"
    }

    $envBackup = Set-ScopedEnvironmentVariables $envValues
    $backendProcess = $null
    $cleanupFailureMessage = $null

    try {
        Write-Step "Start packaged backend from application resources"
        $backendProcess = Start-Process `
            -FilePath $pythonExe `
            -ArgumentList @("-m", "uvicorn", "main:app", "--host", "127.0.0.1", "--port", $Port.ToString(), "--log-level", "warning") `
            -WorkingDirectory $backendDir `
            -RedirectStandardOutput $stdoutLog `
            -RedirectStandardError $stderrLog `
            -PassThru

        Wait-ForBackendHealth -BaseUrl $baseUrl -Process $backendProcess -StdoutLog $stdoutLog -StderrLog $stderrLog

        Push-Location $repoRoot
        try {
            Invoke-CheckedCommand "Run packaged smoke suite with bundled Python" {
                & $pythonExe -m pytest backend/tests/packaged -m packaged_smoke -q
            }
        } finally {
            Pop-Location
        }

        Write-Host ""
        Write-Host "Windows release gate passed." -ForegroundColor Green
        Write-Host "Packaged backend stdout log: $stdoutLog"
        Write-Host "Packaged backend stderr log: $stderrLog"
    } finally {
        if ($backendProcess -and -not $backendProcess.HasExited) {
            Stop-Process -Id $backendProcess.Id -Force
            if (-not (Wait-ForProcessExit -Process $backendProcess -TimeoutSeconds 10)) {
                $cleanupFailureMessage = "Packaged backend PID $($backendProcess.Id) did not exit cleanly after Stop-Process."
            } elseif (-not (Wait-ForEndpointShutdown -BaseUrl $baseUrl -TimeoutSeconds 5)) {
                $cleanupFailureMessage = "Packaged backend endpoint at $baseUrl still responded after process shutdown."
            }
        }
        Restore-ScopedEnvironmentVariables $envBackup
    }

    if ($cleanupFailureMessage) {
        throw $cleanupFailureMessage
    }

    $report.cleanup_verified = $true
    $report.status = "passed"
} catch {
    $report.status = "failed"
    $report.errors = @($_.Exception.Message)
    throw
} finally {
    $reportFinishedAt = Get-Date
    $report.finished_at = $reportFinishedAt.ToString("o")
    $report.duration_seconds = [Math]::Round(($reportFinishedAt - $reportStartedAt).TotalSeconds, 2)
    Write-JsonReport -Report $report -PathValue $ReportPath
    Write-Host "Release gate report: $ReportPath"
}
