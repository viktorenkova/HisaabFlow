[CmdletBinding()]
param(
    [string]$ProjectRoot = ""
)

$ErrorActionPreference = "Stop"

if (-not $ProjectRoot) {
    $candidateRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
    if (Test-Path -LiteralPath (Join-Path $candidateRoot "backend\requirements.txt")) {
        $ProjectRoot = $candidateRoot
    } else {
        $ProjectRoot = Resolve-Path (Join-Path $PSScriptRoot "..\..")
    }
}

$ProjectRoot = (Resolve-Path $ProjectRoot).Path
$BackendDir = Join-Path $ProjectRoot "backend"
$RequirementsPath = Join-Path $BackendDir "requirements.txt"
$VenvDir = Join-Path $ProjectRoot ".venv"
$PythonExe = Join-Path $VenvDir "Scripts\python.exe"

if (-not (Test-Path -LiteralPath $RequirementsPath)) {
    throw "requirements.txt not found: $RequirementsPath"
}

if (-not (Test-Path -LiteralPath $PythonExe)) {
    Write-Host "Creating virtual environment: $VenvDir"
    python -m venv $VenvDir
}

Write-Host "Upgrading pip..."
& $PythonExe -m pip install --upgrade pip

Write-Host "Installing backend dependencies..."
& $PythonExe -m pip install -r $RequirementsPath

Write-Host ""
Write-Host "Backend dependencies are ready."
Write-Host "Python: $PythonExe"
