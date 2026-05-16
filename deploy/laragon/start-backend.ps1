[CmdletBinding()]
param(
    [string]$ProjectRoot = "",
    [int]$Port = 8000
)

$ErrorActionPreference = "Stop"

if (-not $ProjectRoot) {
    $candidateRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
    if (Test-Path -LiteralPath (Join-Path $candidateRoot "backend\main.py")) {
        $ProjectRoot = $candidateRoot
    } else {
        $ProjectRoot = Resolve-Path (Join-Path $PSScriptRoot "..\..")
    }
}

$ProjectRoot = (Resolve-Path $ProjectRoot).Path
$BackendDir = Join-Path $ProjectRoot "backend"
$ConfigDir = Join-Path $ProjectRoot "configs"
$PythonExe = Join-Path $ProjectRoot ".venv\Scripts\python.exe"

if (-not (Test-Path -LiteralPath $PythonExe)) {
    throw "Virtual environment is missing. Run scripts\install-backend-deps.ps1 first."
}

if (-not (Test-Path -LiteralPath $BackendDir)) {
    throw "Backend directory not found: $BackendDir"
}

if (-not (Test-Path -LiteralPath $ConfigDir)) {
    throw "Config directory not found: $ConfigDir"
}

$env:PYTHONUTF8 = "1"
$env:PYTHONIOENCODING = "utf-8"
$env:HISAABFLOW_CONFIG_DIR = $ConfigDir

Write-Host "Starting HisaabFlow backend..."
Write-Host "Backend: http://127.0.0.1:$Port"
Write-Host "Health:  http://127.0.0.1:$Port/health"
Write-Host "Configs: $ConfigDir"
Write-Host ""

Push-Location $BackendDir
try {
    & $PythonExe -m uvicorn main:app --host 127.0.0.1 --port $Port --log-level info
} finally {
    Pop-Location
}
