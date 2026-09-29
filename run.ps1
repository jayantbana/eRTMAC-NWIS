# eRTMAC-NWIS prototype launcher (Windows PowerShell)
#   .\run.ps1            first run: create venv, install deps, build data + models, build UI, start server
#   .\run.ps1 -Rebuild   regenerate the synthetic dataset and knowledge base
#   .\run.ps1 -Dev       start API + Vite dev server (hot reload) instead of the single-server build
param([switch]$Rebuild, [switch]$Dev)
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$be = Join-Path $root "backend"
$fe = Join-Path $root "frontend"
$py = Join-Path $be ".venv\Scripts\python.exe"

if (-not (Test-Path $py)) {
    Write-Host "== creating Python venv"
    python -m venv (Join-Path $be ".venv")
    & $py -m pip install --upgrade pip -q
    & $py -m pip install -q -r (Join-Path $be "requirements.txt")
}
Push-Location $be
if ($Rebuild -or -not (Test-Path (Join-Path $be "data\nwis_kb.sqlite"))) {
    Write-Host "== building synthetic data, knowledge base, models and evaluation (first run OCRs scanned pages: a few minutes)"
    & $py -m nwis.build_all
}
Pop-Location

if (-not (Test-Path (Join-Path $fe "node_modules"))) {
    Push-Location $fe; npm install --no-audit --no-fund; Pop-Location
}

if ($Dev) {
    Start-Process -NoNewWindow -FilePath $py -ArgumentList "-m uvicorn nwis.api.main:app --port 8000 --reload" -WorkingDirectory $be
    Push-Location $fe; npx vite --port 5173; Pop-Location
} else {
    Push-Location $fe; npx vite build; Pop-Location
    Write-Host "== NWIS running at http://localhost:8000  (demo autostart: http://localhost:8000/?autostart=2740&speed=300)"
    Push-Location $be; & $py -m uvicorn nwis.api.main:app --port 8000; Pop-Location
}
