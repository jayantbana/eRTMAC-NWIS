"""One command to build everything:  python -m nwis.build_all [--skip-synthetic]

1. Generate the SYNTHETIC source systems (well master, PDF reports incl. scanned, time series)
2. Ingest reports into the NWIS knowledge base (text layer + OCR, extraction, validation, dedupe)
3. Train and validate the real-time precursor models (grouped by well)
4. Run the evaluation harness and write data/evaluation.json
"""
from __future__ import annotations

import argparse
import time


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--skip-synthetic", action="store_true", help="reuse existing data/source")
    args = ap.parse_args()
    t0 = time.time()
    if not args.skip_synthetic:
        from .synthetic.build import main as build_synthetic
        print("== 1/4 generating synthetic source data")
        build_synthetic()
    from .ingest.pipeline import run as ingest
    print("== 2/4 ingesting documents (first run OCRs scanned pages; cached afterwards)")
    ingest()
    from .engines.precursors import train
    print("== 3/4 training precursor models")
    report = train(verbose=False)
    from .evaluation import run_all
    print("== 4/4 evaluation")
    run_all(verbose=True, precursor_report=report)
    print(f"== done in {time.time() - t0:.0f}s. Start the API:  uvicorn nwis.api.main:app --port 8000")


if __name__ == "__main__":
    main()
