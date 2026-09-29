"""Recommendation engine: case-based reasoning over curated historical events (PS requirement 7).

Output is decision support ("historical records show ..."), never an instruction. Each action is
backed by the events it came from (with document + page), including what did NOT work and
positive practices from trouble-free offset wells.
"""
from __future__ import annotations

import statistics

from ..core.taxonomy import FORMATION_BY_CODE, MITIGATION_LABELS, RISK_FAMILIES, family_of, family_weight
from .relevance import relevance_lookup
from .store import Store

PRIMARY_TYPE = {"LC": "LOST_CIRCULATION", "SP": "STUCK_PIPE", "OP": "OVERPRESSURE_KICK", "TQ": "TORQUE_SPIKE",
                "CM": "CEMENTING_PROBLEM"}
OUTCOME_W = {"resolved": 1.0, "partial": 0.5, "failed": -0.5, "unknown": 0.2}
DISCLAIMER = ("Decision support only: these are measures recorded in historical OIL reports for similar situations. "
              "The drilling engineer retains full authority over operational decisions.")


def _section(well: dict, md: float) -> dict:
    for s in well["sections"]:
        if s["md_from"] <= md <= s["md_to"] + 1e-6:
            return s
    return well["sections"][-1]


def recommend(store: Store, family: str, formation: str | None, offsets: list[dict], active_md: float | None = None,
              max_actions: int = 4) -> dict:
    lookup = relevance_lookup(offsets)
    a = store.wells[store.active_id]
    a_sec = _section(a, active_md or a.get("current_md", 2800))
    cases = []
    for e in store.events:
        if family_of(e["type"]) != family:
            continue
        o = store.wells[e["well_id"]]
        sec = _section(o, e["md_top"])
        same_f = formation is not None and e.get("formation") == formation
        s_rel = lookup.get(e["well_id"], {}).get(e.get("formation") or "", 0.15)
        ops = 0.5 * (sec["hole_in"] == a_sec["hole_in"]) + 0.5 * (1.0 if sec["mud_system"] == a_sec["mud_system"] else 0.6)
        mw = e.get("mw_sg") or sec["mw_sg"]
        param = max(0.0, 1.0 - abs(mw - a_sec["mw_sg"]) / 0.15)
        # Exact hazard type counts most (a stuck-pipe case beats a tight-hole case for a stuck-pipe risk).
        fw = family_weight(e["type"])
        sim = 0.35 * (1.0 if same_f else 0.5) * fw + 0.25 * s_rel + 0.15 * ops + 0.15 * param + 0.10 * same_f
        cases.append((sim, e))
    cases.sort(key=lambda c: -c[0])
    # Prefer cases of the exact hazard (e.g. STUCK_PIPE, not tight hole) when enough exist.
    exact = [c for c in cases if c[1]["type"] == PRIMARY_TYPE.get(family)]
    top_cases = (exact if len(exact) >= 3 else cases)[:25]

    actions: dict[str, dict] = {}
    for sim, e in top_cases:
        for m in e["mitigations"]:
            a_ = actions.setdefault(m["action"], {"action": m["action"], "label": MITIGATION_LABELS.get(m["action"], m["action"]),
                                                  "score": 0.0, "cases": [], "outcomes": {"resolved": 0, "partial": 0, "failed": 0, "unknown": 0}})
            a_["score"] += sim * OUTCOME_W.get(e["outcome"], 0.2)
            a_["outcomes"][e["outcome"]] = a_["outcomes"].get(e["outcome"], 0) + 1
            a_["cases"].append({"event_id": e["event_id"], "well": store.wells[e["well_id"]]["name"], "md": e["md_top"],
                                "formation": e.get("formation"), "outcome": e["outcome"], "npt_h": e.get("npt_h"),
                                "similarity": round(sim, 2), "quote": m.get("quote"), "doc_id": m.get("doc_id"), "page": m.get("page")})
    ranked = sorted(actions.values(), key=lambda x: -x["score"])
    for r in ranked:
        n = len(r["cases"])
        oc = r["outcomes"]
        npts = [c["npt_h"] for c in r["cases"] if c["npt_h"]]
        r["n_cases"] = n
        r["success_rate"] = round((oc["resolved"] + 0.5 * oc["partial"]) / max(n, 1), 2)
        r["median_npt_h"] = round(statistics.median(npts), 1) if npts else None
        r["score"] = round(r["score"], 2)
        r["statement"] = (f"Historical records show '{r['label']}' was used in {n} similar case(s) "
                          f"({oc['resolved']} resolved, {oc['partial']} partial, {oc['failed']} failed)"
                          + (f"; median NPT {r['median_npt_h']} h." if r["median_npt_h"] else "."))
        r["cases"] = sorted(r["cases"], key=lambda c: -c["similarity"])[:4]
    effective = [r for r in ranked if r["score"] > 0 and r["success_rate"] >= 0.5][:max_actions]
    not_effective = [r for r in ranked if r["n_cases"] >= 1 and r["success_rate"] < 0.5][:3]

    practices = []
    for e in store.events:
        if e["type"] != "NOTABLE_PRACTICE" or (formation and e.get("formation") != formation):
            continue
        prov = e["provenance"][0]
        practices.append({"event_id": e["event_id"], "well": store.wells[e["well_id"]]["name"], "well_id": e["well_id"],
                          "md_top": e["md_top"], "md_base": e.get("md_base"), "relevance": lookup.get(e["well_id"], {}).get(e.get("formation") or "", 0.0),
                          "summary": prov["quote"], "doc_id": prov["doc_id"], "page": prov["page"],
                          "actions": [MITIGATION_LABELS.get(m["action"], m["action"]) for m in e["mitigations"]]})
    practices.sort(key=lambda p: -p["relevance"])
    return {"family": family, "family_label": RISK_FAMILIES.get(family, family), "formation": formation,
            "formation_name": FORMATION_BY_CODE[formation].name if formation else None, "cases_considered": len(top_cases),
            "actions": effective, "not_effective": not_effective, "practices": practices[:3], "disclaimer": DISCLAIMER}
