"""Offset Relevance Engine (PS 2.2: nearby does not always mean relevant).

Relevance is computed per (active wellbore, offset wellbore, formation interval):

    S(a, o, F) = sum_i w_i * s_i(a, o, F),   and S = 0 when the offset did not drill F.

Components: in-formation 3D trajectory distance, stratigraphic similarity, structural setting
(fault compartment), depth coverage, trajectory similarity, operational similarity (hole size,
mud system, mud weight), data quality and recency. Every component is returned for display.
"""
from __future__ import annotations

import math

import numpy as np

from .. import config
from ..core.trajectory import min_distance
from .store import Store

# Additive similarity components (weights sum to 1) ...
DEFAULT_WEIGHTS = {"dist": 0.30, "strat": 0.25, "traj": 0.10, "ops": 0.15, "qual": 0.10, "time": 0.10}
# ... gated multiplicatively by structural setting and interval coverage:
#   S = struct_factor * coverage * sum_i w_i s_i
CROSS_FAULT_FACTOR = 0.55
LAMBDA_M = 6000.0
COMPONENT_LABELS = {
    "dist": "In-formation distance", "strat": "Stratigraphic similarity", "struct": "Structural setting (x factor)",
    "cover": "Interval coverage (x factor)", "traj": "Trajectory similarity", "ops": "Operational similarity (hole/mud)",
    "qual": "Data quality", "time": "Recency",
}


def _mud_similarity(a: str, b: str) -> float:
    if a == b:
        return 1.0
    oil = {"OBM"}
    if (a in oil) != (b in oil):
        return 0.3
    return 0.7


def _thickness_map(tops: list[dict]) -> dict[str, float]:
    return {t["code"]: max(t["tvd_base"] - t["tvd_top"], 0.0) for t in tops if not t.get("td_in_formation")}


def _weighted_jaccard(a: dict[str, float], b: dict[str, float]) -> float:
    keys = set(a) | set(b)
    num = sum(min(a.get(k, 0), b.get(k, 0)) for k in keys)
    den = sum(max(a.get(k, 0), b.get(k, 0)) for k in keys)
    return num / den if den > 0 else 0.0


def _section(well: dict, md: float) -> dict:
    for s in well["sections"]:
        if s["md_from"] <= md <= s["md_to"] + 1e-6:
            return s
    return well["sections"][-1]


def compute_offsets(store: Store, radius_km: float = config.DEFAULT_RADIUS_KM, picked: dict | None = None,
                    weights: dict | None = None, focus_from_md: float | None = None, active_id: str | None = None,
                    exclude: set[str] | None = None, as_of_year: int | None = None) -> list[dict]:
    """Rank offset wells for the active well with per-formation relevance and full explanations."""
    w = {**DEFAULT_WEIGHTS, **(weights or {})}
    tot = sum(w.values())
    w = {k: v / tot for k, v in w.items()}
    aid = active_id or store.active_id
    a = store.wells[aid]
    ta = store.trajs[aid]
    a_tops = store.tops_for(aid, picked)
    a_thick = _thickness_map(a_tops)
    now_year = as_of_year or a["spud_year"]
    focus_md = focus_from_md if focus_from_md is not None else a.get("current_md", 0.0) - 200.0
    a_samples = {t["code"]: ta.sample_xyz(t["md_top"], t["md_base"], 25.0) for t in a_tops}
    results = []
    for oid, o in store.wells.items():
        if oid == aid or o.get("status") == "drilling" or (exclude and oid in exclude):
            continue
        surf_km = math.hypot(o["x"] - a["x"], o["y"] - a["y"]) / 1000.0
        if surf_km > radius_km:
            continue
        to = store.trajs[oid]
        o_tops = {t["code"]: t for t in o["tops"]}
        o_thick = _thickness_map(o["tops"])
        strat_global = _weighted_jaccard(a_thick, o_thick)
        n_docs = len(store.docs_by_well.get(oid, []))
        has_ddr = any(d["doc_type"] == "DDR" for d in store.docs_by_well.get(oid, []))
        n_ev = len(store.events_by_well.get(oid, []))
        qual = min(1.0, 0.4 + 0.25 * has_ddr + 0.1 * min(n_docs, 3) + 0.05 * min(n_ev, 1))
        recency = math.exp(-max(now_year - o["spud_year"], 0) / 15.0)
        per_f = {}
        for at in a_tops:
            code = at["code"]
            if code in ("ALV",):
                continue
            ot = o_tops.get(code)
            if ot is None:
                per_f[code] = {"score": 0.0, "components": None, "reason": "Formation not penetrated / absent in offset"}
                continue
            a_th = max(at["tvd_base"] - at["tvd_top"], 1.0)
            o_th = max(ot["tvd_base"] - ot["tvd_top"], 0.0)
            if ot.get("td_in_formation"):
                cover = float(np.clip(o_th / a_th, 0.0, 1.0))
            else:
                cover = 1.0
            if cover < 0.05:
                per_f[code] = {"score": 0.0, "components": None, "reason": "Offset drilled <5% of this interval"}
                continue
            d3 = min_distance(a_samples[code], to.sample_xyz(ot["md_top"], ot["md_base"], 25.0))
            s_dist = math.exp(-d3 / LAMBDA_M)
            thick_ratio = 1.0 if at.get("td_in_formation") or ot.get("td_in_formation") else min(a_th, o_th) / max(a_th, o_th)
            s_strat = 0.5 * strat_global + 0.5 * thick_ratio
            s_struct = 1.0 if o["compartment"] == a["compartment"] else CROSS_FAULT_FACTOR
            mid_a = (at["md_top"] + at["md_base"]) / 2
            mid_o = (ot["md_top"] + ot["md_base"]) / 2
            s_traj = 1.0 - min(abs(ta.inc_at(mid_a) - to.inc_at(mid_o)) / 60.0, 1.0)
            sa, so = _section(a, mid_a), _section(o, mid_o)
            s_ops = (0.3 * (1.0 if sa["hole_in"] == so["hole_in"] else 0.4) + 0.4 * _mud_similarity(sa["mud_system"], so["mud_system"])
                     + 0.3 * max(0.0, 1.0 - abs(sa["mw_sg"] - so["mw_sg"]) / 0.15))
            comps = {"dist": s_dist, "strat": s_strat, "traj": s_traj, "ops": s_ops, "qual": qual, "time": recency}
            score = s_struct * cover * sum(w[k] * v for k, v in comps.items())
            comps.update(struct=s_struct, cover=cover)
            per_f[code] = {"score": round(score, 3), "components": {k: round(v, 3) for k, v in comps.items()},
                           "distance_3d_m": round(d3), "reason": None}
        focus = [t["code"] for t in a_tops if t["md_base"] >= focus_md and t["code"] in per_f]
        scores = [per_f[c]["score"] for c in focus] or [0.0]
        overall = float(np.mean(scores))
        best = max(focus, key=lambda c: per_f[c]["score"]) if focus else None
        results.append({
            "well_id": oid, "name": o["name"], "surface_distance_km": round(surf_km, 2), "compartment": o["compartment"],
            "same_compartment": o["compartment"] == a["compartment"], "spud_year": o["spud_year"], "traj_type": o["traj_type"],
            "td_md": o["td_md"], "overall": round(overall, 3), "per_formation": per_f, "focus_formations": focus,
            "explanation": explain(per_f.get(best), o, a) if best else "No overlapping formations",
            "n_events": len(store.events_by_well.get(oid, [])),
        })
    results.sort(key=lambda r: -r["overall"])
    return results


def explain(pf: dict | None, o: dict, a: dict) -> str:
    if not pf or not pf.get("components"):
        return pf.get("reason", "Not relevant") if pf else "Not relevant"
    c = pf["components"]
    parts = []
    parts.append("same fault compartment" if c["struct"] >= 1.0 else "across a fault (different compartment)")
    parts.append(f"{pf['distance_3d_m'] / 1000:.1f} km apart in-formation")
    if c["strat"] >= 0.85:
        parts.append("very similar stratigraphy")
    elif c["strat"] < 0.7:
        parts.append("different stratigraphy/thickness")
    if c["ops"] >= 0.85:
        parts.append("similar hole & mud")
    if c["traj"] < 0.7:
        parts.append("different inclination")
    return "; ".join(parts)


def relevance_lookup(offsets: list[dict]) -> dict[str, dict[str, float]]:
    """{offset_id: {formation: S}} for fast access."""
    return {o["well_id"]: {f: v["score"] for f, v in o["per_formation"].items()} for o in offsets}
