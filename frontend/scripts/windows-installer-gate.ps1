[CmdletBinding()]
param(
    [switch]$Build,
    [switch]$SkipBackendTests,
    [switch]$KeepInstall,
    [string]$InstallerPath = "",
    [string]$InstallDir = "",
    [int]$Port = 8012,
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

function Find-LatestInstaller {
    param([string]$DistDir)

    $installer = Get-ChildItem -LiteralPath $DistDir -Filter "HisaabFlow Setup *.exe" |
        Sort-Object LastWriteTime -Descending |
        Select-Object -First 1

    if (-not $installer) {
        throw "No Windows installer found in $DistDir"
    }

    return $installer.FullName
}

function Assert-InstallLayout {
    param([string]$InstallPath)

    $mainExe = Join-Path $InstallPath "HisaabFlow.exe"
    $resourcesDir = Join-Path $InstallPath "resources"
    $backendDir = Join-Path $resourcesDir "backend"
    $pythonExe = Join-Path $resourcesDir "python-bundle\python\python.exe"

    foreach ($pathCheck in @($mainExe, $resourcesDir, $backendDir, $pythonExe)) {
        if (-not (Test-Path -LiteralPath $pathCheck)) {
            throw "Installed app layout is incomplete. Missing: $pathCheck"
        }
    }
}

function Invoke-SilentUninstall {
    param([string]$InstallPath)

    $uninstallerPath = Join-Path $InstallPath "Uninstall HisaabFlow.exe"
    if (-not (Test-Path -LiteralPath $uninstallerPath)) {
        throw "Installed app is missing uninstaller: $uninstallerPath"
    }

    $uninstallProcess = Start-Process `
        -FilePath $uninstallerPath `
        -ArgumentList @("/S") `
        -PassThru `
        -Wait

    if ($uninstallProcess.ExitCode -ne 0) {
        throw "Uninstaller exited with code $($uninstallProcess.ExitCode)"
    }

    Start-Sleep -Seconds 2

    if (Test-Path -LiteralPath $InstallPath) {
        Remove-Item -LiteralPath $InstallPath -Force -Recurse -ErrorAction Stop
    }
}

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$frontendRoot = Resolve-ExistingPath (Join-Path $scriptDir "..") "Frontend root"
$repoRoot = Resolve-ExistingPath (Join-Path $frontendRoot "..") "Repository root"
$distDir = Resolve-ExistingPath (Join-Path $frontendRoot "dist") "Distribution directory"
$releaseGateScript = Resolve-ExistingPath (Join-Path $scriptDir "windows-release-gate.ps1") "Windows release gate script"

if (-not $ReportPath) {
    $ReportPath = Join-Path $repoRoot ".release-gate\windows-installer-gate-report.json"
}

$releaseReportPath = Join-Path $repoRoot ".release-gate\windows-release-installed-report.json"
$reportStartedAt = Get-Date
$report = [ordered]@{
    gate = "windows-installer"
    status = "running"
    started_at = $reportStartedAt.ToString("o")
    finished_at = $null
    duration_seconds = $null
    build_requested = [bool]$Build
    skip_backend_tests = [bool]$SkipBackendTests
    keep_install = [bool]$KeepInstall
    installer_path = $null
    install_dir = $null
    port = $Port
    installed_app_retained = $false
    release_gate_report = $releaseReportPath
    errors = @()
}

try {
    if ($Build) {
        Push-Location $frontendRoot
        try {
            Write-Step "Build fresh Windows package"
            npm.cmd run dist:win
            if ($LASTEXITCODE -ne 0) {
                throw "dist:win failed with exit code $LASTEXITCODE"
            }
        } finally {
            Pop-Location
        }
    }

    if (-not $InstallerPath) {
        $InstallerPath = Find-LatestInstaller -DistDir $distDir
    }
    $InstallerPath = Resolve-ExistingPath $InstallerPath "Windows installer"

    if (-not $InstallDir) {
        $InstallDir = Join-Path $repoRoot ".release-gate\installer-smoke\install"
    }

    $report.installer_path = $InstallerPath
    $report.install_dir = $InstallDir

    $installParentDir = Split-Path -Parent $InstallDir
    New-Item -ItemType Directory -Force -Path $installParentDir | Out-Null

    if (Test-Path -LiteralPath $InstallDir) {
        Write-Step "Remove previous installer smoke directory"
        Remove-Item -LiteralPath $InstallDir -Force -Recurse
    }

    Write-Step "Run silent installer"
    $installerProcess = Start-Process `
        -FilePath $InstallerPath `
        -ArgumentList @("/S", "/D=$InstallDir") `
        -PassThru `
        -Wait

    if ($installerProcess.ExitCode -ne 0) {
        throw "Installer exited with code $($installerProcess.ExitCode)"
    }

    Write-Step "Validate installed application layout"
    Assert-InstallLayout -InstallPath $InstallDir

    Write-Step "Run release gate against installed application"
    $gateArgs = @(
        "-ExecutionPolicy", "Bypass",
        "-File", $releaseGateScript,
        "-UnpackedDir", $InstallDir,
        "-Port", $Port.ToString(),
        "-ReportPath", $releaseReportPath
    )

    if ($SkipBackendTests) {
        $gateArgs += "-SkipBackendTests"
    }

    powershell @gateArgs
    if ($LASTEXITCODE -ne 0) {
        throw "Installed application gate failed with exit code $LASTEXITCODE"
    }

    if (-not $KeepInstall) {
        Write-Step "Uninstall smoke-test application"
        Invoke-SilentUninstall -InstallPath $InstallDir
    }

    $report.installed_app_retained = [bool]$KeepInstall
    $report.status = "passed"

    Write-Host ""
    Write-Host "Windows installer gate passed." -ForegroundColor Green
    if ($KeepInstall) {
        Write-Host "Installed app path: $InstallDir"
    } else {
        Write-Host "Installed app path cleaned up: $InstallDir"
    }
    Write-Host "Installer used: $InstallerPath"
} catch {
    $report.status = "failed"
    $report.errors = @($_.Exception.Message)
    throw
} finally {
    $reportFinishedAt = Get-Date
    $report.finished_at = $reportFinishedAt.ToString("o")
    $report.duration_seconds = [Math]::Round(($reportFinishedAt - $reportStartedAt).TotalSeconds, 2)
    Write-JsonReport -Report $report -PathValue $ReportPath
    Write-Host "Installer gate report: $ReportPath"
}
