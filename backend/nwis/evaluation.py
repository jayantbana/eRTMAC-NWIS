"""Evaluation harness (IMPLEMENTATION_PLAN.md section 14).

Because the prototype field is synthetic, hidden ground truth exists for every event, so each
component can be measured quantitatively:

* extraction   - precision / recall / F1 of extracted events vs ground truth (digital vs OCR),
                 depth error, formation accuracy, provenance validity
* relevance    - leave-one-well-out: does relevance ranking find offsets with similar event
                 profiles better than distance-only ranking? (NDCG@5)
* look-ahead   - leave-one-well-out backtest of the risk track using only wells drilled EARLIER:
                 event recall vs share of hole flagged, against a raw-depth/distance baseline
* precursors   - grouped-by-well CV report from engines.precursors.train()
* search       - retrieval recall@5 and citation validity on an auto-generated golden set
"""
from __future__ import annotations

import json
import math
import time

import numpy as np

from . import config
from .core.taxonomy import family_of
from .engines.store import Store

FAMS = ("LC", "SP", "OP", "TQ", "CM")


# ------------------------------------------------------------------------------------ extraction
def eval_extraction(store: Store) -> dict:
    truth = [e for e in store.truth["events"]]
    docs = {d["doc_id"]: d for d in store.truth["documents"]}
    ext = store.events
    used = set()
    matches = []
    for t in truth:
        best, best_d = None, 1e9
        for e in ext:
            if e["event_id"] in used or e["well_id"] != t["well_id"] or e["type"] != t["type"]:
                continue
            d = abs(e["md_top"] - t["md"])
            if d <= 10 and d < best_d:
                best, best_d = e, d
        if best:
            used.add(best["event_id"])
            matches.append((t, best, best_d))
    tp = len(matches)
    fp = len(ext) - tp
    fn = len(truth) - tp
    prec = tp / max(tp + fp, 1)
    rec = tp / max(tp + fn, 1)

    def split(pred):
        tt = [t for t in truth if pred(t)]
        mm = [m for m in matches if pred(m[0])]
        return {"truth": len(tt), "found": len(mm), "recall": round(len(mm) / max(len(tt), 1), 3)}

    def scanned_only(t):
        ms = t.get("mentions", [])
        return bool(ms) and all(docs[m["doc_id"]]["scanned"] for m in ms)

    by_type = {}
    for et in sorted({t["type"] for t in truth}):
        tt = sum(t["type"] == et for t in truth)
        mm = sum(m[0]["type"] == et for m in matches)
        pp = sum(e["type"] == et for e in ext)
        by_type[et] = {"truth": tt, "extracted": pp, "matched": mm, "precision": round(mm / max(pp, 1), 3), "recall": round(mm / max(tt, 1), 3)}
    fm_ok = [m[1].get("formation") == m[0].get("formation") for m in matches]
    d_err = [m[2] for m in matches]
    # Provenance validity: every quote must be found verbatim on the cited page.
    ok = total = 0
    with store.connect() as db:
        pages = {(r["doc_id"], r["page_no"]): r["text"] for r in db.execute("SELECT doc_id,page_no,text FROM pages")}
    for e in ext:
        for p in e["provenance"]:
            total += 1
            ok += p["quote"] in pages.get((p["doc_id"], p["page"]), "")
    fp_list = [{"event_id": e["event_id"], "well": e["well_id"], "type": e["type"], "md": e["md_top"],
                "quote": e["provenance"][0]["quote"][:160]} for e in ext if e["event_id"] not in used][:15]
    fn_list = [{"id": t["id"], "well": t["well_id"], "type": t["type"], "md": t["md"],
                "scanned_only": scanned_only(t)} for t in truth if t["id"] not in {m[0]["id"] for m in matches}][:15]
    return {
        "precision": round(prec, 3), "recall": round(rec, 3), "f1": round(2 * prec * rec / max(prec + rec, 1e-9), 3),
        "truth_events": len(truth), "extracted_events": len(ext), "matched": tp,
        "digital_sources": split(lambda t: not scanned_only(t)), "scanned_only_sources": split(scanned_only),
        "depth_abs_error_m": {"median": round(float(np.median(d_err)), 2) if d_err else None,
                              "p90": round(float(np.percentile(d_err, 90)), 2) if d_err else None,
                              "within_5m": round(float(np.mean(np.array(d_err) <= 5)), 3) if d_err else None},
        "formation_accuracy": round(float(np.mean(fm_ok)), 3) if fm_ok else None,
        "provenance_valid": f"{ok}/{total}", "by_type": by_type,
        "needs_review": sum(e["status"] == "needs_review" for e in ext),
        "sample_false_positives": fp_list, "sample_missed": fn_list,
    }


# ------------------------------------------------------------------------------------ relevance
def _profile(events: list[dict], fam_key: str = "type") -> set:
    out = set()
    for e in events:
        fam = family_of(e[fam_key])
        if fam:
            out.add((e["formation"], fam))
    return out


def _ndcg(rels: list[float], k: int = 5) -> float:
    dcg = sum(r / math.log2(i + 2) for i, r in enumerate(rels[:k]))
    ideal = sorted(rels, reverse=True)
    idcg = sum(r / math.log2(i + 2) for i, r in enumerate(ideal[:k]))
    return dcg / idcg if idcg > 0 else 0.0


def eval_relevance(store: Store, radius_km: float = 12.0) -> dict:
    from .engines.relevance import compute_offsets
    truth_by_well: dict[str, list[dict]] = {}
    for t in store.truth["events"]:
        truth_by_well.setdefault(t["well_id"], []).append(t)
    ours, dist = [], []
    for hid, h in store.wells.items():
        if h.get("status") == "drilling":
            continue
        hp = _profile(truth_by_well.get(hid, []))
        if not hp:
            continue
        offs = compute_offsets(store, radius_km, active_id=hid)
        if len(offs) < 5:
            continue
        rel = {}
        for o in offs:
            op = _profile(truth_by_well.get(o["well_id"], []))
            rel[o["well_id"]] = len(hp & op) / max(len(hp | op), 1)
        ours.append(_ndcg([rel[o["well_id"]] for o in offs]))
        by_d = sorted(offs, key=lambda o: o["surface_distance_km"])
        dist.append(_ndcg([rel[o["well_id"]] for o in by_d]))
    m_ours, m_dist = float(np.mean(ours)), float(np.mean(dist))
    return {"method": "leave-one-well-out, target = event-profile overlap (formation x risk family)", "wells_evaluated": len(ours),
            "ndcg5_relevance": round(m_ours, 3), "ndcg5_distance_only": round(m_dist, 3),
            "improvement_pct": round(100 * (m_ours - m_dist) / max(m_dist, 1e-9), 1)}


# ------------------------------------------------------------------------------------ look-ahead
def eval_lookahead(store: Store, radius_km: float = 12.0) -> dict:
    """Backtest: each historical well plays 'active', using only offsets spudded before it."""
    from .engines.relevance import compute_offsets
    from .engines.risk import risk_track
    truth_by_well: dict[str, list[dict]] = {}
    for t in store.truth["events"]:
        truth_by_well.setdefault(t["well_id"], []).append(t)
    res = {"ours": {"hit": 0, "n": 0, "flagged": 0.0, "len": 0.0}, "baseline": {"hit": 0, "n": 0, "flagged": 0.0, "len": 0.0}}
    per_family = {f: {"hit": 0, "n": 0} for f in FAMS}
    for hid, h in store.wells.items():
        if h.get("status") == "drilling":
            continue
        tev = [t for t in truth_by_well.get(hid, []) if family_of(t["type"]) in FAMS and t["md"] > 1000]
        if not tev:
            continue
        later = {oid for oid, o in store.wells.items() if o["spud_year"] >= h["spud_year"] and oid != hid}
        offs = compute_offsets(store, radius_km, active_id=hid, exclude=later, as_of_year=h["spud_year"])
        if not offs:
            continue
        tr = risk_track(store, offs, active_id=hid)
        md = np.asarray(tr["md"])
        sel = md > 1000
        # Baseline: raw MD alignment, weight = distance decay only, 5 nearest wells.
        near = sorted(offs, key=lambda o: o["surface_distance_km"])[:5]
        base = {f: np.zeros_like(md) for f in FAMS}
        for o in near:
            wgt = math.exp(-o["surface_distance_km"] / 6.0)
            for e in store.events_by_well.get(o["well_id"], []):
                f = family_of(e["type"])
                if f in FAMS:
                    base[f] = 1 - (1 - base[f]) * (1 - 0.85 * wgt * np.exp(-0.5 * ((md - e["md_top"]) / 10.0) ** 2))
        for name, curves in (("ours", {f: np.asarray(tr["curves"][f]) for f in FAMS}), ("baseline", base)):
            flag_any = np.zeros(len(md), dtype=bool)
            for f in FAMS:
                flag_any |= curves[f] >= config.ZONE_THRESHOLD
            res[name]["flagged"] += float(flag_any[sel].sum())
            res[name]["len"] += float(sel.sum())
            for t in tev:
                f = family_of(t["type"])
                win = (md >= t["md"] - 15) & (md <= t["md"] + 15)
                hit = bool((curves[f][win] >= config.ZONE_THRESHOLD).any())
                res[name]["hit"] += hit
                res[name]["n"] += 1
                if name == "ours":
                    per_family[f]["hit"] += hit
                    per_family[f]["n"] += 1
    out = {}
    for name, r in res.items():
        out[name] = {"event_recall": round(r["hit"] / max(r["n"], 1), 3), "share_of_hole_flagged": round(r["flagged"] / max(r["len"], 1), 3),
                     "events": r["n"]}
    out["ours"]["by_family_recall"] = {f: round(v["hit"] / v["n"], 3) for f, v in per_family.items() if v["n"]}
    out["method"] = ("leave-one-well-out, offsets restricted to wells spudded earlier; hit = risk >= zone threshold within +-15 m "
                     "of the held-out well's true event; baseline = raw-MD alignment, 5 nearest wells, distance weighting only")
    return out


# ------------------------------------------------------------------------------------ search
def eval_search(store: Store) -> dict:
    from .engines.search import SearchEngine
    se = SearchEngine(store)
    rng = np.random.default_rng(7)
    truth = [t for t in store.truth["events"] if t["type"] != "NOTABLE_PRACTICE" and t.get("mentions")]
    sample = [truth[i] for i in rng.choice(len(truth), size=min(60, len(truth)), replace=False)]
    phrase = {"LC": "mud losses", "SP": "stuck pipe or tight hole problems", "OP": "gas or kick problems", "TQ": "torque problems",
              "CM": "cementing problems"}
    hits = 0
    for t in sample:
        name = store.wells[t["well_id"]]["name"]
        q = f"What {phrase[family_of(t['type'])]} happened in {name}?"
        results = se.retrieve(q, k=5)
        docs_pages = {(m["doc_id"], p) for m in t["mentions"] for p in m["pages"]}
        if any((r["doc_id"], r["page_no"]) in docs_pages for r in results):
            hits += 1
    # Unanswerable questions: wells with no event of a family must yield 'no records'.
    neg_ok = neg_n = 0
    for wid, w in list(store.wells.items())[:40]:
        if w.get("status") == "drilling":
            continue
        fams = {family_of(t["type"]) for t in store.truth["events"] if t["well_id"] == wid}
        missing = [f for f in ("OP", "CM") if f not in fams]
        for f in missing[:1]:
            ans = se.ask(f"What {phrase[f]} happened in {w['name']}?")
            neg_n += 1
            neg_ok += ans["evidence_status"] == "insufficient"
    return {"golden_questions": len(sample), "recall_at_5": round(hits / max(len(sample), 1), 3),
            "unanswerable_questions": neg_n, "correct_insufficient_evidence": round(neg_ok / max(neg_n, 1), 3),
            "citation_policy": "answers are composed only of verbatim sentences from retrieved pages; each carries doc+page"}


def run_all(verbose: bool = True, precursor_report: dict | None = None) -> dict:
    t0 = time.time()
    store = Store()
    out = {"generated_at": time.strftime("%Y-%m-%d %H:%M:%S"), "data_mode": config.DATA_MODE,
           "note": "Targets and results are on the SYNTHETIC benchmark; re-baseline on real OIL data."}
    out["extraction"] = eval_extraction(store)
    out["relevance"] = eval_relevance(store)
    out["lookahead"] = eval_lookahead(store)
    if precursor_report is None and (config.MODELS_DIR / "precursor_report.json").exists():
        precursor_report = json.loads((config.MODELS_DIR / "precursor_report.json").read_text())
    out["precursors"] = precursor_report
    try:
        out["search"] = eval_search(store)
    except Exception as exc:  # search engine optional during early builds
        out["search"] = {"error": str(exc)}
    out["seconds"] = round(time.time() - t0, 1)
    config.EVAL_PATH.write_text(json.dumps(out, indent=1))
    if verbose:
        brief = {k: v for k, v in out.items() if k not in ("extraction",)}
        print(json.dumps({"extraction": {k: out["extraction"][k] for k in ("precision", "recall", "f1", "digital_sources",
                                                                           "scanned_only_sources", "depth_abs_error_m",
                                                                           "formation_accuracy", "provenance_valid")}}, indent=1))
        print(json.dumps(brief, indent=1)[:4000])
    return out


if __name__ == "__main__":
    run_all()
