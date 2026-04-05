<#
.SYNOPSIS
    TDAI Medical Imaging Platform - fast startup script.

.DESCRIPTION
    Modes:
      dicoogle - Only the Dicoogle PACS server for DICOM images.
      full   - All services via Docker Compose (default).
      dev    - Docker backends + local Vite frontend (hot-reload).
      core   - Only Postgres, Orthanc, Dicoogle, reporting backend.
      stop   - Gracefully stop everything.
      reset  - Stop, remove volumes, rebuild from scratch.

    First run builds images; subsequent runs reuse cached images so
    startup is near-instant.

.PARAMETER Mode
    One of: dicoogle, full, dev, core, stop, reset.  Default: full

.PARAMETER Build
    Force Docker image rebuild (adds --build).

.PARAMETER NoGpu
    Skip the monai-server service (requires NVIDIA GPU).

.PARAMETER NoOrthanc
    Exclude Orthanc from startup.

.PARAMETER NoMonai
    Exclude MONAI from startup.

.PARAMETER NoMedasr
    Exclude MedASR from startup.

.EXAMPLE
    .\start.ps1 -Mode dicoogle  # only Dicoogle
    .\start.ps1                  # full stack, cached images
    .\start.ps1 -Mode dev       # backends in Docker, frontend local
    .\start.ps1 -Mode core      # minimal services only
    .\start.ps1 -Build           # rebuild all images
    .\start.ps1 -Mode stop       # shut everything down
#>

param(
    [ValidateSet("dicoogle", "full", "dev", "core", "stop", "reset")]
    [string]$Mode = "full",

    [switch]$Build,
    [switch]$NoGpu,
    [switch]$NoOrthanc,
    [switch]$NoMonai,
    [switch]$NoMedasr
)

$ErrorActionPreference = "Stop"
$ProjectRoot = $PSScriptRoot
Set-Location $ProjectRoot

# Colours
function Write-Step  ([string]$msg) { Write-Host "`n>> $msg" -ForegroundColor Cyan }
function Write-Ok    ([string]$msg) { Write-Host "   $msg"   -ForegroundColor Green }
function Write-Warn  ([string]$msg) { Write-Host "   $msg"   -ForegroundColor Yellow }
function Write-Err   ([string]$msg) { Write-Host "   $msg"   -ForegroundColor Red }

# Stop / Reset
if ($Mode -eq "stop") {
    Write-Step "Stopping all services..."
    docker compose down
    $frontendProc = Get-Process -Name "node" -ErrorAction SilentlyContinue |
        Where-Object { $_.CommandLine -match "vite" }
    if ($frontendProc) { $frontendProc | Stop-Process -Force; Write-Ok "Stopped local Vite dev server." }
    Write-Ok "All services stopped."
    exit 0
}

if ($Mode -eq "reset") {
    Write-Step "Full reset: stopping containers, removing volumes..."
    docker compose down -v --remove-orphans
    Write-Ok "Volumes removed. Will rebuild on next start."
    exit 0
}

# Prerequisite checks
Write-Step "Checking prerequisites..."

$missing = @()
$dockerCmd = Get-Command docker -ErrorAction SilentlyContinue
if (-not $dockerCmd) {
    $missing += "docker"
} else {
    & docker compose version *> $null
    if ($LASTEXITCODE -ne 0) {
        $missing += "docker compose"
    }
}
if ($Mode -eq "dev") {
    if (-not (Get-Command node -ErrorAction SilentlyContinue))         { $missing += "node" }
    if (-not (Get-Command npm  -ErrorAction SilentlyContinue))         { $missing += "npm" }
}

if ($missing.Count -gt 0) {
    Write-Err "Missing tools: $($missing -join ', '). Install them and retry."
    exit 1
}

# Docker Desktop must be running
docker info *> $null
if ($LASTEXITCODE -ne 0) {
    Write-Err "Docker daemon is not running. Start Docker Desktop and retry."
    exit 1
}
Write-Ok "Docker is running."

# Ensure .env files
Write-Step "Checking environment files..."

function Initialize-EnvFile ([string]$dir) {
    $env  = Join-Path $dir ".env"
    $ex   = Join-Path $dir ".env.example"
    if (-not (Test-Path $env) -and (Test-Path $ex)) {
        Copy-Item $ex $env
        Write-Warn "Created $env from .env.example - edit it with your secrets."
    }
}

Initialize-EnvFile $ProjectRoot
Initialize-EnvFile (Join-Path $ProjectRoot "packages\reporting-app\backend")
Initialize-EnvFile (Join-Path $ProjectRoot "packages\reporting-app\frontend")

# Create required host directories
Write-Step "Ensuring storage directories..."
@("storage", "dicoogle-index", "monai-models") | ForEach-Object {
    $d = Join-Path $ProjectRoot $_
    if (-not (Test-Path $d)) { New-Item -ItemType Directory -Path $d -Force | Out-Null; Write-Ok "Created $_/" }
}

# Build service lists
$dicoogleServices = @("dicoogle")
$coreServices   = @("postgres", "orthanc", "dicoogle", "reporting-app-backend")
$aiServices     = @("wav2vec2-server")
if ((-not $NoGpu) -and (-not $NoMonai)) { $aiServices += "monai-server" }
if (-not $NoMedasr) { $aiServices += "medasr-server" }
$viewerServices = @("ohif")

if ($NoOrthanc) {
    $coreServices = $coreServices | Where-Object { $_ -ne "orthanc" }
}

switch ($Mode) {
    "dicoogle" { $services = $dicoogleServices }
    "core" { $services = $coreServices }
    "dev"  { $services = $coreServices + $aiServices }
    "full" { $services = $coreServices + $aiServices + $viewerServices }
}

# Docker Compose up
Write-Step "Starting Docker services ($Mode mode)..."

$composeArgs = @("compose", "up", "-d")
if ($Build) { $composeArgs += "--build" }
$composeArgs += $services

$timer = [System.Diagnostics.Stopwatch]::StartNew()
if (($NoMonai -or $NoMedasr) -and ($services -contains "reporting-app-backend")) {
    $servicesWithoutBackend = $services | Where-Object { $_ -ne "reporting-app-backend" }
    if ($servicesWithoutBackend.Count -gt 0) {
        $composeArgsWithoutBackend = @("compose", "up", "-d")
        if ($Build) { $composeArgsWithoutBackend += "--build" }
        $composeArgsWithoutBackend += $servicesWithoutBackend
        & docker @composeArgsWithoutBackend
        if ($LASTEXITCODE -ne 0) {
            Write-Err "docker compose up failed while starting non-backend services."
            exit 1
        }
    }

    & docker compose up -d --no-deps reporting-app-backend
} else {
    & docker @composeArgs
}
if ($LASTEXITCODE -ne 0) {
    Write-Err "docker compose up failed. Run with -Build to rebuild images."
    exit 1
}
$timer.Stop()
Write-Ok "Docker services up in $([math]::Round($timer.Elapsed.TotalSeconds, 1))s"

# Local frontend (dev mode)
if ($Mode -eq "dev") {
    Write-Step "Starting local Vite frontend (hot-reload)..."

    # Smart npm install: skip if node_modules exists and package-lock hasn't changed
    $nmDir   = Join-Path $ProjectRoot "node_modules"
    $lockFile = Join-Path $ProjectRoot "package-lock.json"
    $stamp   = Join-Path $ProjectRoot "node_modules\.install-stamp"

    $needInstall = (-not (Test-Path $nmDir)) -or (-not (Test-Path $stamp))
    if (-not $needInstall -and (Test-Path $lockFile)) {
        $lockMod  = (Get-Item $lockFile).LastWriteTime
        $stampMod = (Get-Item $stamp).LastWriteTime
        if ($lockMod -gt $stampMod) { $needInstall = $true }
    }

    if ($needInstall) {
        Write-Warn "Installing npm dependencies (first time or lockfile changed)..."
        npm install --prefer-offline
        New-Item -Path $stamp -ItemType File -Force | Out-Null
    } else {
        Write-Ok "node_modules up to date - skipping npm install."
    }

    Write-Ok "Launching Vite on http://localhost:5173 ..."
    Start-Process -NoNewWindow -FilePath "npm" -ArgumentList "run dev -w medical-report-system-frontend" -WorkingDirectory $ProjectRoot
}

# Health check summary
Write-Step "Waiting for services to become healthy..."
Start-Sleep -Seconds 5

$endpoints = @(
    @{ Name = "Dicoogle PACS";       Port = 8080; Url = "http://localhost:8080" }
)
if ($Mode -ne "dicoogle") {
    $endpoints = @(
        @{ Name = "PostgreSQL";        Port = 5432; Url = $null }
        @{ Name = "Reporting Backend"; Port = 8081; Url = "http://localhost:8081" }
        @{ Name = "Dicoogle PACS";     Port = 8080; Url = "http://localhost:8080" }
    )
    if (-not $NoOrthanc) {
        $endpoints += @{ Name = "Orthanc PACS"; Port = 8042; Url = "http://localhost:8042" }
    }
}
if ($Mode -eq "full") {
    $endpoints += @{ Name = "OHIF Viewer"; Port = 3000; Url = "http://localhost:3000" }
}
if (($Mode -ne "core") -and ($Mode -ne "dicoogle")) {
    if (-not $NoMedasr) {
        $endpoints += @{ Name = "MedASR Server"; Port = 5001; Url = "http://localhost:5001" }
    }
    $endpoints += @{ Name = "Wav2Vec2 Server"; Port = 5002; Url = "http://localhost:5002" }
    if ((-not $NoGpu) -and (-not $NoMonai)) {
        $endpoints += @{ Name = "MONAI Server"; Port = 5000; Url = "http://localhost:5000" }
    }
}
if ($Mode -eq "dev") {
    $endpoints += @{ Name = "Frontend (Vite)"; Port = 5173; Url = "http://localhost:5173" }
}

foreach ($ep in $endpoints) {
    $conn = Test-NetConnection -ComputerName localhost -Port $ep.Port -WarningAction SilentlyContinue -InformationLevel Quiet 2>$null
    if ($conn) {
        Write-Ok "$($ep.Name) .... ready  (port $($ep.Port))"
    } else {
        Write-Warn "$($ep.Name) .... starting  (port $($ep.Port))"
    }
}

# Final summary
Write-Host ""
Write-Host "============================================" -ForegroundColor Cyan
Write-Host "  TDAI Platform is running  ($Mode mode)" -ForegroundColor Cyan
Write-Host "============================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "  Dicoogle ........... http://localhost:8080"
if ($Mode -ne "dicoogle") {
    $frontendPort = if ($Mode -eq "dev") { "5173" } else { "3000" }
    $ohifColor = if ($Mode -eq "full") { "White" } else { "DarkGray" }
    Write-Host "  Frontend ........... http://localhost:$frontendPort"
    Write-Host "  Reporting API ...... http://localhost:8081"
    if (-not $NoOrthanc) {
        Write-Host "  Orthanc ............ http://localhost:8042"
    }
    Write-Host "  OHIF Viewer ........ http://localhost:3000" -ForegroundColor $ohifColor
}
Write-Host ""
Write-Host "  Stop:    .\start.ps1 -Mode stop"
Write-Host "  Rebuild: .\start.ps1 -Build"
Write-Host "  Logs:    docker compose logs -f <service>"
Write-Host ""
