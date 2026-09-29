"""Ingestion pipeline: documents -> validated knowledge base (SQLite).

Stages: page text (text layer / OCR) -> document metadata -> event extraction -> normalisation
against structured well data (TVD, TVDSS, formation, formation-relative position) -> validation
rules and confidence -> cross-document de-duplication -> chunk index for search.
"""
from __future__ import annotations

import datetime as dt
import json
import re
import sqlite3
import time

from .. import config
from ..core.taxonomy import EVENT_TYPES, family_of
from ..core.trajectory import Trajectory
from ..core.units import FT_TO_M
from .extractor import detect_types, extract_from_page, find_depths, prepare_page_text, split_sentences
from .pdf_text import build_segmenter, extract_pages, sha256_file, text_layer_usable

SCHEMA = """
CREATE TABLE documents (doc_id TEXT PRIMARY KEY, well_id TEXT, doc_type TEXT, report_date TEXT, file TEXT, sha256 TEXT,
    pages INTEGER, ocr_pages INTEGER, ingest_status TEXT, ingested_at TEXT);
CREATE TABLE pages (doc_id TEXT, page_no INTEGER, text TEXT, method TEXT, ocr_conf REAL, PRIMARY KEY (doc_id, page_no));
CREATE TABLE chunks (chunk_id INTEGER PRIMARY KEY, doc_id TEXT, page_no INTEGER, well_id TEXT, text TEXT, start_char INTEGER,
    end_char INTEGER, event_types TEXT, formations TEXT, depths TEXT);
CREATE TABLE events (event_id TEXT PRIMARY KEY, well_id TEXT, type TEXT, family TEXT, subtype TEXT, md_top REAL, md_base REAL,
    tvd REAL, tvdss REAL, formation TEXT, formation_reported TEXT, formation_source TEXT, f_pos REAL, severity INTEGER,
    npt_h REAL, loss_rate_m3ph REAL, mw_sg REAL, event_date TEXT, outcome TEXT, confidence REAL, status TEXT, flags TEXT,
    provenance TEXT, mitigations TEXT, curated_by TEXT, curated_at TEXT);
CREATE TABLE audit (id INTEGER PRIMARY KEY, ts TEXT, user TEXT, action TEXT, object_id TEXT, detail TEXT);
CREATE TABLE feedback (id INTEGER PRIMARY KEY, ts TEXT, user TEXT, target_type TEXT, target_id TEXT, rating TEXT, reason TEXT);
"""

WELL_RE = re.compile(r"Well\s*:\s*Well\s*([A-Z](?:\s?[A-Z])?)(?![a-z])")
DATE_RE = re.compile(r"Date\s*:\s*(\d{1,2})-(\w{3})-(\d{4})")
HEADER_DEPTH_RE = re.compile(r"Depth\s*@\s*06\s*:\s*00\s*:\s*([\d,.]+)\s*(m\s?MD|mtrs|m|ft|')")


def _formation_at(tops: list[dict], md: float) -> dict | None:
    for t in tops:
        if t["md_top"] <= md < t["md_base"] or (t.get("td_in_formation") and md >= t["md_top"]):
            return t
    return None


def _doc_meta(doc_id: str, pages: list[dict], wells_by_name: dict) -> dict:
    first = pages[0]["text"] if pages else ""
    doc_type = "DDR" if re.search(r"DAILY\s*DRILLING", first, re.I) else "WCR" if re.search(r"COMPLETION", first, re.I) else "OTHER"
    # Primary identity comes from document-management metadata (here: the file name); the
    # well named inside the document is a cross-check (OCR can garble it, e.g. "Well A A").
    meta_id = doc_id.split("-")[0]
    m = WELL_RE.search(first)
    text_id = m.group(1).replace(" ", "") if m else None
    well_id = meta_id if meta_id in wells_by_name else (text_id if text_id in wells_by_name else meta_id)
    identity_check = "match" if text_id == well_id else ("unreadable" if not text_id else "mismatch")
    report_date = None
    m = DATE_RE.search(first)
    if m:
        try:
            report_date = dt.datetime.strptime("-".join(m.groups()), "%d-%b-%Y").date().isoformat()
        except ValueError:
            pass
    header_depth = None
    m = HEADER_DEPTH_RE.search(first)
    if m:
        v = float(m.group(1).replace(",", ""))
        header_depth = v * FT_TO_M if m.group(2) in ("ft", "'") else v
    return {"doc_id": doc_id, "well_id": well_id, "doc_type": doc_type, "report_date": report_date, "header_depth": header_depth,
            "identity_check": identity_check}


def _severity(ev: dict) -> int:
    if ev["type"] == "NOTABLE_PRACTICE":
        return 0
    sub = {"total": 5, "severe": 4, "partial": 3, "seepage": 1}.get(ev.get("subtype") or "", 0)
    npt = ev.get("npt_h") or 0
    by_npt = 2 if npt < 4 else 3 if npt < 12 else 4 if npt < 30 else 5
    if ev.get("outcome") == "failed":
        by_npt = 5
    return max(sub, by_npt if npt else 2)


def normalise_and_validate(ev: dict, well: dict, traj: Trajectory) -> dict | None:
    flags = list(ev["flags"])
    md = ev["md_top"]
    if md is None:
        return None
    td = well["td_md"]
    if md > td + 10:
        if "depth_unit_inferred" in flags and md * FT_TO_M <= td + 10:
            md = md * FT_TO_M
            flags.append("converted_from_ft")
        else:
            return None  # impossible depth for this well -> reject (logged by caller)
    md = min(md, td)
    ev["md_top"] = round(md, 1)
    if ev.get("md_base") is not None:
        ev["md_base"] = round(min(max(ev["md_base"], md), td), 1)
    tops = well.get("tops") or []
    t = _formation_at(tops, md)
    derived = t["code"] if t else None
    rep = ev.get("formation_reported")
    consistent = None
    if rep and derived:
        near = {x["code"] for x in (_formation_at(tops, md - 20), _formation_at(tops, md + 20), t) if x}
        consistent = rep in near
        if not consistent:
            flags.append("formation_mismatch")
    ev["formation"] = derived or rep
    ev["formation_source"] = "tops" if derived else ("reported" if rep else None)
    ev["tvd"] = round(traj.tvd_at(md), 1)
    ev["tvdss"] = round(ev["tvd"] - traj.rkb_elev, 1)
    if t:
        thick = max(t["tvd_base"] - t["tvd_top"], 1e-6)
        ev["f_pos"] = round(min(max((ev["tvd"] - t["tvd_top"]) / thick, 0.0), 1.0), 4)
    else:
        ev["f_pos"] = None
    if ev.get("event_date") and well.get("spud_date") and well.get("completion_date"):
        if not (well["spud_date"] <= ev["event_date"] <= well["completion_date"]):
            flags.append("date_outside_well_dates")

    c = 0.55
    c += 0.20 if ev["depth_source"] == "reported" else 0.0
    c += 0.10 if consistent else (-0.15 if consistent is False else 0.0)
    c += 0.05 if ev.get("event_date") else 0.0
    c += 0.05 if ev["mitigations"] or ev["outcome"] != "unknown" else 0.0
    c -= 0.10 if "depth_unit_inferred" in flags else 0.0
    c -= 0.10 if any(p["method"] == "ocr" for p in ev["provenance"]) else 0.0
    c -= 0.10 if "date_outside_well_dates" in flags else 0.0
    ev["confidence"] = round(max(0.0, min(1.0, c)), 3)
    ev["status"] = "auto" if ev["confidence"] >= 0.8 else "needs_review"
    ev["flags"] = sorted(set(flags))
    ev["family"] = family_of(ev["type"])
    ev["severity"] = _severity(ev)
    return ev


def merge_events(events: list[dict]) -> list[dict]:
    """Cross-document de-duplication: same well + same type + |dMD| <= 15 m -> one event, many sources."""
    events = sorted(events, key=lambda e: (e["well_id"], e["type"], e["md_top"]))
    merged: list[dict] = []
    for ev in events:
        tgt = None
        for m in reversed(merged[-12:]):
            if m["well_id"] == ev["well_id"] and m["type"] == ev["type"] and abs(m["md_top"] - ev["md_top"]) <= 15:
                tgt = m
                break
        if tgt is None:
            merged.append(ev)
            continue
        primary, other = (tgt, ev) if tgt["confidence"] >= ev["confidence"] else (ev, tgt)
        out = dict(primary)
        out["provenance"] = tgt["provenance"] + ev["provenance"]
        actions = {m["action"] for m in primary["mitigations"]}
        out["mitigations"] = primary["mitigations"] + [m for m in other["mitigations"] if m["action"] not in actions]
        for k in ("subtype", "npt_h", "loss_rate_m3ph", "mw_sg", "event_date", "md_base", "formation_reported"):
            if out.get(k) is None and other.get(k) is not None:
                out[k] = other[k]
        if out["outcome"] == "unknown":
            out["outcome"] = other["outcome"]
        out["flags"] = sorted(set(primary["flags"]) | set(other["flags"]) | {"multi_source"})
        out["confidence"] = round(min(1.0, max(tgt["confidence"], ev["confidence"]) + 0.05), 3)
        out["status"] = "auto" if out["confidence"] >= 0.8 else "needs_review"
        merged[merged.index(tgt)] = out
    return merged


def make_chunks(doc: dict, page_no: int, text: str, max_words: int = 80) -> list[dict]:
    chunks, buf, start = [], [], None
    sents = split_sentences(text)
    for s in sents:
        if start is None:
            start = s.start
        buf.append(s)
        if sum(len(x.text.split()) for x in buf) >= max_words:
            chunks.append((start, buf[-1].end))
            buf, start = [], None
    if buf:
        chunks.append((start, buf[-1].end))
    out = []
    for a, b in chunks:
        ct = text[a:b]
        types = sorted({t for s in split_sentences(ct) for t in detect_types(s.text)})
        from ..core.taxonomy import find_formations
        out.append({"doc_id": doc["doc_id"], "page_no": page_no, "well_id": doc["well_id"], "text": ct, "start_char": a, "end_char": b,
                    "event_types": types, "formations": sorted({c for _, c in find_formations(ct)}),
                    "depths": [round(d["md"], 1) for d in find_depths(ct)]})
    return out


def run(verbose: bool = True) -> dict:
    t0 = time.time()
    master = json.loads(config.WELLS_PATH.read_text())
    wells = {w["id"]: w for w in master["wells"]}
    trajs = {wid: Trajectory.from_dict(w["trajectory"]) for wid, w in wells.items()}
    pdfs = sorted(config.DOCS_DIR.glob("*.pdf"))

    # Pass 1: native text layers (and learn the vocabulary used to repair OCR output).
    raw: dict[str, list[dict]] = {}
    digital_texts: list[str] = []
    scanned: list = []
    for p in pdfs:
        pages = extract_pages(p, seg=None)
        if all(pg["method"] == "text" for pg in pages):
            raw[p.stem] = pages
            digital_texts.extend(pg["text"] for pg in pages)
        else:
            scanned.append(p)
    seg = build_segmenter(digital_texts)
    # Pass 2: scanned documents through OCR + space recovery.
    for i, p in enumerate(scanned, start=1):
        if verbose:
            print(f"[ingest] OCR {i}/{len(scanned)}: {p.name}", flush=True)
        raw[p.stem] = extract_pages(p, seg=seg)

    if config.KB_PATH.exists():
        config.KB_PATH.unlink()
    db = sqlite3.connect(config.KB_PATH)
    db.executescript(SCHEMA)
    now = dt.datetime.now().isoformat(timespec="seconds")
    candidates, rejected = [], []
    stats = {"documents": 0, "pages": 0, "ocr_pages": 0, "candidates": 0, "rejected": 0}
    for p in pdfs:
        pages = raw[p.stem]
        canon = [{**pg, "text": prepare_page_text(pg["text"])} for pg in pages]
        meta = _doc_meta(p.stem, pages, {w: 1 for w in wells})
        ocr_pages = sum(pg["method"] == "ocr" for pg in pages)
        db.execute("INSERT INTO documents VALUES (?,?,?,?,?,?,?,?,?,?)",
                   (meta["doc_id"], meta["well_id"], meta["doc_type"], meta["report_date"], p.name, sha256_file(p), len(pages),
                    ocr_pages, "ingested", now))
        stats["documents"] += 1
        stats["pages"] += len(pages)
        stats["ocr_pages"] += ocr_pages
        for pg in canon:
            db.execute("INSERT INTO pages VALUES (?,?,?,?,?)", (meta["doc_id"], pg["page"], pg["text"], pg["method"], pg["ocr_conf"]))
            for ch in make_chunks(meta, pg["page"], pg["text"]):
                db.execute("INSERT INTO chunks (doc_id,page_no,well_id,text,start_char,end_char,event_types,formations,depths) "
                           "VALUES (?,?,?,?,?,?,?,?,?)",
                           (ch["doc_id"], ch["page_no"], ch["well_id"], ch["text"], ch["start_char"], ch["end_char"],
                            json.dumps(ch["event_types"]), json.dumps(ch["formations"]), json.dumps(ch["depths"])))
            doc_ctx = {**meta, "page_method": pg["method"]}
            if meta["doc_type"] == "WCR":
                doc_ctx["header_depth"] = None
            for ev in extract_from_page(pg["text"], pg["page"], doc_ctx):
                stats["candidates"] += 1
                w = wells.get(ev["well_id"])
                if w is None or w.get("status") == "drilling":
                    continue
                nv = normalise_and_validate(ev, w, trajs[w["id"]])
                if nv is None:
                    rejected.append({"doc_id": meta["doc_id"], "page": pg["page"], "reason": "invalid_or_missing_depth",
                                     "quote": ev["provenance"][0]["quote"][:200]})
                else:
                    candidates.append(nv)
    stats["rejected"] = len(rejected)
    events = merge_events(candidates)
    events.sort(key=lambda e: (e["well_id"], e["md_top"]))
    for i, ev in enumerate(events, start=1):
        ev["event_id"] = f"EV-{i:04d}"
        db.execute("INSERT INTO events VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)", (
            ev["event_id"], ev["well_id"], ev["type"], ev["family"], ev.get("subtype"), ev["md_top"], ev.get("md_base"), ev["tvd"],
            ev["tvdss"], ev.get("formation"), ev.get("formation_reported"), ev.get("formation_source"), ev.get("f_pos"),
            ev["severity"], ev.get("npt_h"), ev.get("loss_rate_m3ph"), ev.get("mw_sg"), ev.get("event_date"), ev["outcome"],
            ev["confidence"], ev["status"], json.dumps(ev["flags"]), json.dumps(ev["provenance"]), json.dumps(ev["mitigations"]),
            None, None))
    db.execute("INSERT INTO audit (ts,user,action,object_id,detail) VALUES (?,?,?,?,?)",
               (now, "system", "ingest", "all", json.dumps({**stats, "events": len(events)})))
    db.commit()
    db.close()
    stats.update(events=len(events), needs_review=sum(e["status"] == "needs_review" for e in events),
                 seconds=round(time.time() - t0, 1), by_type={t: sum(e["type"] == t for e in events) for t in EVENT_TYPES})
    (config.DATA_DIR / "ingest_report.json").write_text(json.dumps({"stats": stats, "rejected": rejected}, indent=1))
    if verbose:
        print(f"[ingest] {stats}")
    return stats


if __name__ == "__main__":
    run()
    _ = text_layer_usable
