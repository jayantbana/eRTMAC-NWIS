#!/usr/bin/env bash
# eRTMAC-NWIS prototype launcher (Linux / macOS / Git Bash)
#   ./run.sh            first run: venv, deps, data + models, UI build, start server on :8000
#   ./run.sh --rebuild  regenerate synthetic dataset and knowledge base
set -euo pipefail
ROOT="$(cd "$(dirname "$0")" && pwd)"
BE="$ROOT/backend"; FE="$ROOT/frontend"
if [ -x "$BE/.venv/Scripts/python.exe" ]; then PY="$BE/.venv/Scripts/python.exe"; else PY="$BE/.venv/bin/python"; fi
if [ ! -x "$PY" ]; then
  python3 -m venv "$BE/.venv" || python -m venv "$BE/.venv"
  if [ -x "$BE/.venv/Scripts/python.exe" ]; then PY="$BE/.venv/Scripts/python.exe"; else PY="$BE/.venv/bin/python"; fi
  "$PY" -m pip install -q --upgrade pip && "$PY" -m pip install -q -r "$BE/requirements.txt"
fi
cd "$BE"
if [ "${1:-}" = "--rebuild" ] || [ ! -f data/nwis_kb.sqlite ]; then "$PY" -m nwis.build_all; fi
cd "$FE"; [ -d node_modules ] || npm install --no-audit --no-fund; npx vite build
cd "$BE"; echo "== NWIS running at http://localhost:8000"; "$PY" -m uvicorn nwis.api.main:app --port 8000
