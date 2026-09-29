"""Depth/formation alignment, Bayesian formation risk profiles and the look-ahead risk track.

Alignment: an offset event at formation-relative position f in formation F is projected to the
active well at TVD_top_F(active) + f * thickness_F(active), then converted to MD on the active
trajectory. Missing formations fall back to TVDSS with a wider uncertainty.

Formation risk: relevance-weighted counts with an empirical-Bayes Beta prior -> posterior mean
and 90% credible interval, so thin evidence ("1 of 1 wells") does not over-alarm.

Look-ahead track: noisy-OR of Gaussian kernels around projected offset events, floored by the
formation posterior. Contiguous intervals above the zone threshold become risk zones.
"""
from __future__ import annotations

import math

import numpy as np
from scipy.stats import beta as beta_dist

from .. import config
from ..core.taxonomy import FORMATION_BY_CODE, RISK_FAMILIES, family_of, family_weight
from .relevance import relevance_lookup
from .store import Store

FAMILIES = list(RISK_FAMILIES)
SEV_WEIGHT = {0: 0.4, 1: 0.55, 2: 0.7, 3: 0.85, 4: 0.95, 5: 1.0}
PRIOR_STRENGTH = 4.0


# ------------------------------------------------------------------------------------ alignment
def project_event(ev: dict, active_tops_by_code: dict[str, dict], a_traj) -> dict:
    at = active_tops_by_code.get(ev.get("formation") or "")
    if at is not None and ev.get("f_pos") is not None:
        tvd = at["tvd_top"] + ev["f_pos"] * (at["tvd_base"] - at["tvd_top"])
        md = a_traj.md_at_tvd(tvd)
        sigma = 6.0 + (5.0 if at["kind"] == "prognosed" else 0.0) + (4.0 if ev["status"] == "needs_review" else 0.0)
        method = "formation_relative"
    else:
        md = a_traj.md_at_tvdss(ev["tvdss"])
        sigma = 25.0
        method = "tvdss_fallback"
    out = {"md": round(md, 1), "sigma": sigma, "method": method}
    if ev.get("md_base") and ev["type"] == "NOTABLE_PRACTICE" and at is not None:
        out["md_base"] = round(md + (ev["md_base"] - ev["md_top"]), 1)
    return out


# ------------------------------------------------------------------------------ formation risk
def _event_families_by_formation(events: list[dict]) -> dict[tuple[str, str], list[dict]]:
    out: dict[tuple[str, str], list[dict]] = {}
    for e in events:
        fam = family_of(e["type"])
        if fam and e.get("formation"):
            out.setdefault((e["formation"], fam), []).append(e)
    return out


def formation_risk(store: Store, offsets: list[dict] | None = None, scope: str = "offsets") -> dict:
    """Formation x risk-family matrix with posterior mean, 90% CI, n/k and expected NPT."""
    lookup = relevance_lookup(offsets) if offsets is not None else {}
    wells = [w for w in store.wells.values() if w.get("status") != "drilling"]
    # Empirical-Bayes prior per family: rate per (well, formation penetrated) across the field.
    pairs = sum(len([t for t in w["tops"] if t["code"] != "ALV"]) for w in wells)
    prior_rate = {}
    for fam in FAMILIES:
        k = len({(e["well_id"], e["formation"]) for e in store.events if family_of(e["type"]) == fam and e.get("formation")})
        prior_rate[fam] = max(k / max(pairs, 1), 0.01)
    rows = []
    codes = [f.code for f in FORMATION_BY_CODE.values() if f.code not in ("ALV", "BSM")]
    for code in codes:
        row = {"formation": code, "name": FORMATION_BY_CODE[code].name, "cells": {}}
        for fam in FAMILIES:
            n = k = 0.0
            thirds = [0.0, 0.0, 0.0]
            npts, ev_ids, wells_hit, wells_n = [], [], [], 0
            for w in wells:
                if code not in {t["code"] for t in w["tops"]}:
                    continue
                if scope == "offsets":
                    s = lookup.get(w["id"], {}).get(code, 0.0)
                    if s < config.RELEVANCE_INCLUDE_THRESHOLD:
                        continue
                else:
                    s = 1.0
                wells_n += 1
                n += s
                evs = [e for e in store.events_by_well.get(w["id"], []) if e.get("formation") == code and family_of(e["type"]) == fam]
                if evs:
                    wt = max(family_weight(e["type"]) for e in evs)
                    k += s * wt
                    wells_hit.append(w["id"])
                    for e in evs:
                        ev_ids.append(e["event_id"])
                        if e.get("npt_h"):
                            npts.append(e["npt_h"])
                        if e.get("f_pos") is not None:
                            thirds[min(int(e["f_pos"] * 3), 2)] += s
            a0 = PRIOR_STRENGTH * prior_rate[fam]
            b0 = PRIOR_STRENGTH * (1 - prior_rate[fam])
            a1, b1 = a0 + k, b0 + max(n - k, 0.0)
            row["cells"][fam] = {
                "posterior": round(a1 / (a1 + b1), 3),
                "ci90": [round(float(beta_dist.ppf(0.05, a1, b1)), 3), round(float(beta_dist.ppf(0.95, a1, b1)), 3)],
                "n_eff": round(n, 2), "k_eff": round(k, 2), "n_wells": wells_n, "wells_with_event": wells_hit,
                "mean_npt_h": round(float(np.mean(npts)), 1) if npts else None,
                "thirds": [round(x, 2) for x in thirds], "event_ids": ev_ids,
                "likelihood": _band(a1 / (a1 + b1), [0.05, 0.15, 0.3, 0.5]),
                "consequence": _band(float(np.mean(npts)) if npts else 0.0, [2, 8, 16, 30]),
            }
        rows.append(row)
    return {"scope": scope, "families": RISK_FAMILIES, "prior_rate": prior_rate, "rows": rows}


def _band(x: float, cuts: list[float]) -> int:
    return 1 + sum(x >= c for c in cuts)


# ---------------------------------------------------------------------------- look-ahead track
def risk_track(store: Store, offsets: list[dict], picked: dict | None = None, step_m: float = 2.0,
               atlas: dict | None = None, active_id: str | None = None) -> dict:
    aid = active_id or store.active_id
    a_traj = store.trajs[aid]
    a_tops = store.tops_for(aid, picked)
    by_code = {t["code"]: t for t in a_tops}
    lookup = relevance_lookup(offsets)
    atlas = atlas or formation_risk(store, offsets, scope="offsets")
    post = {(r["formation"], fam): c["posterior"] for r in atlas["rows"] for fam, c in r["cells"].items()}
    md = np.arange(0.0, a_traj.td + 1e-6, step_m)

    projected = []
    for oid, per_f in lookup.items():
        for ev in store.events_by_well.get(oid, []):
            s = per_f.get(ev.get("formation") or "", 0.0)
            if s < config.RELEVANCE_INCLUDE_THRESHOLD:
                continue
            p = project_event(ev, by_code, a_traj)
            if p["md"] > a_traj.td + 50:
                continue
            fam = family_of(ev["type"])
            amp = s * SEV_WEIGHT.get(ev["severity"] or 0, 0.7) * family_weight(ev["type"]) * (0.6 + 0.4 * (ev["confidence"] or 0.7))
            projected.append({
                "event_id": ev["event_id"], "well_id": oid, "well_name": store.wells[oid]["name"], "type": ev["type"], "family": fam,
                "subtype": ev.get("subtype"), "formation": ev.get("formation"), "offset_md": ev["md_top"], "md": p["md"],
                "md_base": p.get("md_base"), "sigma": p["sigma"], "method": p["method"], "relevance": s, "amplitude": round(amp, 3),
                "severity": ev["severity"], "outcome": ev["outcome"], "npt_h": ev.get("npt_h"), "status": ev["status"],
                "confidence": ev["confidence"],
            })

    curves = {}
    fm_codes = [(store.formation_at(a_tops, z) or {"code": None})["code"] for z in md]
    for fam in FAMILIES:
        floor = np.array([0.5 * post.get((c, fam), 0.0) if c else 0.0 for c in fm_codes])
        surv = 1.0 - floor
        for p in projected:
            if p["family"] != fam:
                continue
            bw = max(p["sigma"], 10.0)
            surv = surv * (1.0 - p["amplitude"] * np.exp(-0.5 * ((md - p["md"]) / bw) ** 2))
        curves[fam] = np.round(1.0 - surv, 3)

    zones = []
    for fam in FAMILIES:
        r = curves[fam]
        above = r >= config.ZONE_THRESHOLD
        i = 0
        while i < len(md):
            if not above[i]:
                i += 1
                continue
            j = i
            while j + 1 < len(md) and above[j + 1]:
                j += 1
            lo, hi = float(md[i]), float(md[j])
            k = i + int(np.argmax(r[i:j + 1]))
            contrib = sorted([p for p in projected if p["family"] == fam and lo - 2 * p["sigma"] <= p["md"] <= hi + 2 * p["sigma"]],
                             key=lambda p: -p["amplitude"])
            fm = store.formation_at(a_tops, float(md[k]))
            zones.append({"id": f"{fam}-{int(lo)}", "family": fam, "label": RISK_FAMILIES[fam], "md_from": lo, "md_to": hi,
                          "peak": float(r[k]), "peak_md": float(md[k]), "formation": fm["code"] if fm else None,
                          "formation_name": fm["name"] if fm else None,
                          "events": [p["event_id"] for p in contrib[:8]], "wells": sorted({p["well_name"] for p in contrib})})
            i = j + 1
    zones.sort(key=lambda z: z["md_from"])
    return {
        "well_id": aid, "md": md.tolist(), "curves": {k: v.tolist() for k, v in curves.items()}, "zones": zones,
        "projected_events": projected, "tops": a_tops,
        "casing": store.wells[aid]["casing"], "families": RISK_FAMILIES, "zone_threshold": config.ZONE_THRESHOLD,
    }


def value_at(track: dict, fam: str, md_value: float) -> float:
    md = track["md"]
    if not md:
        return 0.0
    step = md[1] - md[0] if len(md) > 1 else 1.0
    i = int(min(max(round(md_value / step), 0), len(md) - 1))
    return float(track["curves"][fam][i])


def max_ahead(track: dict, fam: str, md_from: float, md_to: float) -> tuple[float, float]:
    md = np.asarray(track["md"])
    c = np.asarray(track["curves"][fam])
    sel = (md > md_from) & (md <= md_to)
    if not sel.any():
        return 0.0, md_from
    k = int(np.argmax(np.where(sel, c, -1)))
    return float(c[k]), float(md[k])


_ = math
