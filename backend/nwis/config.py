"""Central configuration. Everything overridable through environment variables."""
from __future__ import annotations

import os
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parent.parent
DATA_DIR = Path(os.environ.get("NWIS_DATA_DIR", BACKEND_DIR / "data"))

# Synthetic "source systems" (what OIL would provide): well master data, reports, time series.
SOURCE_DIR = DATA_DIR / "source"
DOCS_DIR = SOURCE_DIR / "documents"
WELLS_PATH = SOURCE_DIR / "well_master.json"
TRUTH_PATH = SOURCE_DIR / "ground_truth_events.json"
TIMESERIES_DIR = SOURCE_DIR / "timeseries"

# NWIS-owned stores (built by the ingestion pipeline).
KB_PATH = DATA_DIR / "nwis_kb.sqlite"
OCR_CACHE_DIR = DATA_DIR / "ocr_cache"
MODELS_DIR = DATA_DIR / "models"
EVAL_PATH = DATA_DIR / "evaluation.json"

SEED = int(os.environ.get("NWIS_SEED", "26121"))

# Optional local LLM (Ollama). Empty -> answers are extractive (verbatim, cited sentences only).
LLM_MODEL = os.environ.get("NWIS_LLM_MODEL", "")
OLLAMA_URL = os.environ.get("NWIS_OLLAMA_URL", "http://localhost:11434")

# Synthetic field origin used only to draw the demo field on a map. The data is SYNTHETIC.
FIELD_ORIGIN_LATLON = (27.35, 95.30)
DATA_MODE = "SYNTHETIC"

# Engine defaults (see IMPLEMENTATION_PLAN.md section 8).
DEFAULT_RADIUS_KM = 10.0
RELEVANCE_INCLUDE_THRESHOLD = 0.50
LOOKAHEAD_MIN_M = 100.0
LOOKAHEAD_HOURS = 3.0
ZONE_THRESHOLD = 0.40
