"""Hidden ground-truth hazard model and event sampler (SYNTHETIC).

The engines never read this module's output directly: events reach NWIS only through the
generated PDF reports and the extraction pipeline. Ground truth is kept to *measure* NWIS.
"""
from __future__ import annotations

import datetime as dt

import numpy as np

from ..core.taxonomy import family_of
from ..core.trajectory import Trajectory
from .wells import formation_at, section_at

# (formation, event type, base probability per well penetrating, position mean, position sd)
HAZARDS = [
    ("DHK", "LOST_CIRCULATION", 0.07, 0.50, 0.30),
    ("NMS", "TIGHT_HOLE", 0.10, 0.50, 0.30),
    ("GRJ", "TIGHT_HOLE", 0.45, 0.50, 0.25),
    ("GRJ", "WELLBORE_INSTABILITY", 0.30, 0.60, 0.25),
    ("TPM", "LOST_CIRCULATION", 0.40, 0.86, 0.06),
    ("BRL", "STUCK_PIPE", 0.26, 0.07, 0.04),
    ("BRL", "TORQUE_SPIKE", 0.25, 0.30, 0.20),
    ("BRL", "OVERPRESSURE_KICK", 0.12, 0.12, 0.05),
    ("BRL", "WELLBORE_INSTABILITY", 0.15, 0.20, 0.15),
    ("KPL", "OVERPRESSURE_KICK", 0.25, 0.40, 0.20),
    ("SLT", "LOST_CIRCULATION", 0.35, 0.30, 0.20),
]
OP_COMPARTMENT = {"C": 2.4, "E": 1.0, "W": 0.15}


def _tops_by_code(well: dict) -> dict[str, dict]:
    return {t["code"]: t for t in well["tops"]}


def md_from_fpos(well: dict, traj: Trajectory, code: str, f: float) -> float | None:
    t = _tops_by_code(well).get(code)
    if t is None:
        return None
    tvd = t["tvd_top"] + f * (t["tvd_base"] - t["tvd_top"])
    return traj.md_at_tvd(tvd)


def fpos_from_md(well: dict, traj: Trajectory, md: float) -> tuple[str, float] | None:
    t = formation_at(well["tops"], md)
    if t is None:
        return None
    tvd = traj.tvd_at(md)
    thick = max(t["tvd_base"] - t["tvd_top"], 1e-6)
    return t["code"], (tvd - t["tvd_top"]) / thick


def _probability(well: dict, traj: Trajectory, code: str, etype: str, base: float, md: float) -> float:
    sec = section_at(well, md)
    mud = sec["mud_system"]
    inc = traj.inc_at(md)
    p = base
    if etype == "LOST_CIRCULATION" and code == "TPM":
        p *= float(np.clip(1.0 + 9.0 * (sec["ecd_sg"] - 1.36), 0.35, 2.0))
    if etype == "STUCK_PIPE":
        p *= (1.6 if inc > 20 else 1.0) * (0.45 if mud in ("KCl-glycol WBM", "OBM") else 1.0)
    if etype == "TORQUE_SPIKE":
        p *= (1.5 if inc > 20 else 1.0) * (0.7 if mud == "OBM" else 1.0)
    if etype == "OVERPRESSURE_KICK":
        p *= OP_COMPARTMENT[well["compartment"]] * (0.6 if sec["mw_sg"] >= 1.36 else 1.0)
    if code == "GRJ" and etype in ("TIGHT_HOLE", "WELLBORE_INSTABILITY"):
        p *= 1.5 if mud == "Gel-polymer WBM" else 0.8
    return float(min(p, 0.9))


def _severity_from_npt(npt: float) -> int:
    return 2 if npt < 4 else 3 if npt < 12 else 4 if npt < 30 else 5


def make_event(rng: np.random.Generator, well: dict, traj: Trajectory, etype: str, md: float,
               forced: dict | None = None) -> dict:
    """Create one fully specified event with mitigations and outcome."""
    f = forced or {}
    sec = section_at(well, md)
    fp = fpos_from_md(well, traj, md)
    code, fpos = fp if fp else (None, None)
    ev: dict = {
        "well_id": well["id"],
        "type": etype,
        "family": family_of(etype),
        "md": round(md, 1),
        "tvd": round(traj.tvd_at(md), 1),
        "tvdss": round(traj.tvdss_at(md), 1),
        "formation": code,
        "f_pos": None if fpos is None else round(fpos, 3),
        "hole": sec["hole"],
        "hole_in": sec["hole_in"],
        "mud_system": sec["mud_system"],
        "mw_sg": sec["mw_sg"],
        "ecd_sg": sec["ecd_sg"],
        "inc_deg": round(traj.inc_at(md), 1),
        "params": {},
        "mitigations": [],
    }
    P = ev["params"]
    M = ev["mitigations"]
    u = rng.uniform
    q1 = int(round(u(2250, 2700) / 50) * 50) if sec["hole_in"] < 10 else int(round(u(3000, 3600) / 50) * 50)

    if etype == "LOST_CIRCULATION":
        sub = f.get("subtype") or rng.choice(["seepage", "partial", "severe", "total"], p=[0.2, 0.5, 0.2, 0.1])
        rate_bph = {"seepage": u(5, 9), "partial": u(15, 90), "severe": u(110, 250), "total": 0.0}[sub]
        P.update(subtype=sub, rate_bph=round(f.get("rate_bph", rate_bph)), q1=q1, q2=q1 - int(round(u(300, 600) / 50) * 50),
                 lcm_bbl=int(u(30, 60)), lcm_ppb=int(round(u(30, 60) / 5) * 5), returns_pct=int(u(40, 85)))
        acts = f.get("mitigations") or [a for a, pr in (("REDUCE_FLOW_ECD", 0.8), ("LCM_PILL", 0.85), ("REDUCE_MW", 0.25)) if u() < pr]
        p_res = 0.35 + 0.25 * ("REDUCE_FLOW_ECD" in acts) + 0.3 * ("LCM_PILL" in acts) + 0.05 * ("REDUCE_MW" in acts) \
            - 0.25 * (sub in ("severe", "total"))
        sev0 = {"seepage": 1, "partial": 3, "severe": 4, "total": 5}[sub]
        npt = {"seepage": u(1, 4), "partial": u(6, 24), "severe": u(18, 48), "total": u(30, 90)}[sub]
        ev["subtype"] = sub
    elif etype == "STUCK_PIPE":
        sub = f.get("subtype") or rng.choice(["differential", "pack-off"], p=[0.6, 0.4])
        P.update(subtype=sub, stationary_min=int(u(8, 25)), blows=int(u(20, 80)), pill_bbl=int(u(20, 40)), soak_h=int(u(4, 8)),
                 overpull_t=int(u(30, 60)))
        if f.get("mitigations"):
            acts = list(f["mitigations"])
        else:
            acts = ["JARRING"] if u() < 0.9 else []
            if u() < (0.7 if sub == "differential" else 0.2):
                acts.append("SPOTTING_PILL")
            if u() < (0.7 if sub == "pack-off" else 0.3):
                acts.append("CIRCULATE_SWEEP")
        p_res = 0.45 + 0.3 * ("SPOTTING_PILL" in acts and sub == "differential") + 0.25 * ("CIRCULATE_SWEEP" in acts and sub == "pack-off") \
            + 0.1 * ("JARRING" in acts)
        sev0 = 3
        npt = u(8, 40)
        ev["subtype"] = sub
    elif etype == "TIGHT_HOLE":
        P.update(overpull_t=int(u(12, 35)))
        acts = f.get("mitigations") or [a for a, pr in (("BACKREAM_WIPER", 0.85), ("INHIBITIVE_MUD", 0.35), ("RAISE_MW", 0.35)) if u() < pr]
        p_res = 0.7 + 0.15 * ("BACKREAM_WIPER" in acts)
        sev0 = 2
        npt = u(2, 10)
        ev["subtype"] = "tight hole"
    elif etype == "WELLBORE_INSTABILITY":
        P.update(cavings="heavy" if u() < 0.5 else "moderate")
        acts = f.get("mitigations") or [a for a, pr in (("RAISE_MW", 0.7), ("INHIBITIVE_MUD", 0.5), ("CIRCULATE_SWEEP", 0.5)) if u() < pr]
        p_res = 0.5 + 0.2 * ("RAISE_MW" in acts) + 0.2 * ("INHIBITIVE_MUD" in acts)
        sev0 = 2
        npt = u(3, 16)
        ev["subtype"] = "cavings"
    elif etype == "OVERPRESSURE_KICK":
        sub = f.get("subtype") or rng.choice(["high gas", "kick"], p=[0.55, 0.45])
        mw2 = round(sec["mw_sg"] + u(0.04, 0.10), 2)
        P.update(subtype=sub, gas_pct=round(u(5, 25), 1), pit_gain_bbl=int(u(6, 30)), sidpp_psi=int(u(150, 600)),
                 sicp_psi=int(u(250, 800)), mw1=sec["mw_sg"], mw2=f.get("mw2", mw2))
        acts = f.get("mitigations") or (["WELL_CONTROL", "RAISE_MW"] if sub == "kick" else
                                        [a for a, pr in (("RAISE_MW", 0.9), ("CIRCULATE_SWEEP", 0.5)) if u() < pr])
        p_res = 0.9
        sev0 = 4 if sub == "kick" else 2
        npt = u(4, 30)
        ev["subtype"] = sub
    elif etype == "TORQUE_SPIKE":
        P.update(tq_lo=int(u(10, 14)), tq_hi=int(u(22, 32)), wob=int(u(8, 12)), rpm=int(u(80, 110)), lub_pct=int(u(1, 3)))
        acts = f.get("mitigations") or [a for a, pr in (("DRILLING_PARAMS", 0.9), ("LUBRICANT", 0.5)) if u() < pr]
        p_res = 0.6 + 0.2 * ("DRILLING_PARAMS" in acts) + 0.15 * ("LUBRICANT" in acts)
        sev0 = 2
        npt = u(1, 8)
        ev["subtype"] = "stick-slip"
    elif etype == "CEMENTING_PROBLEM":
        sub = f.get("subtype") or rng.choice(["losses during cementing", "poor bond", "toc deeper"], p=[0.5, 0.3, 0.2])
        P.update(subtype=sub, slurry_lost_bbl=int(u(20, 120)), bond_from=round(md - u(150, 400)), squeeze_bbl=int(u(15, 40)),
                 casing=f.get("casing", "7\""))
        acts = f.get("mitigations") or [a for a, pr in (("CEMENT_PLUG", 0.8), ("LCM_PILL", 0.4)) if u() < pr]
        p_res = 0.55 + 0.25 * ("CEMENT_PLUG" in acts)
        sev0 = 3
        npt = u(12, 48)
        ev["subtype"] = sub
    elif etype == "NOTABLE_PRACTICE":
        P.update(f.get("params", {}))
        acts = f.get("mitigations", [])
        p_res = 1.0
        sev0 = 0
        npt = 0.0
        ev["subtype"] = f.get("subtype", "practice")
        ev["md_base"] = f.get("md_base")
    else:
        raise ValueError(etype)

    outcome = f.get("outcome")
    if outcome is None:
        outcome = "resolved" if u() < p_res else ("partial" if u() < 0.6 else "failed")
    if etype == "STUCK_PIPE" and outcome == "failed":
        acts = list(acts) + ["FISHING", "SIDETRACK"]
    if etype == "LOST_CIRCULATION" and outcome == "failed":
        acts = list(acts) + ["CEMENT_PLUG"]
    npt = float(f.get("npt_h", npt * (2.5 if outcome == "failed" else 1.0)))
    ev["outcome"] = outcome
    ev["npt_h"] = round(npt, 1)
    ev["severity"] = 0 if etype == "NOTABLE_PRACTICE" else max(sev0, _severity_from_npt(npt))
    for a in acts:
        M.append({"action": a})
    return ev


def sample_events(rng: np.random.Generator, well: dict, traj: Trajectory) -> list[dict]:
    tops = _tops_by_code(well)
    events: list[dict] = []
    for code, etype, base, mu, sd in HAZARDS:
        if code not in tops:
            continue
        t = tops[code]
        fpos = float(np.clip(rng.normal(mu, sd), 0.02, 0.98))
        md = md_from_fpos(well, traj, code, fpos)
        if md is None or md > well["td_md"] - 5 or md < t["md_top"]:
            continue
        if rng.uniform() < _probability(well, traj, code, etype, base, md):
            events.append(make_event(rng, well, traj, etype, md))

    # Cementing problems at casing shoes; much more likely where losses occurred above the shoe.
    had_loss_deep = any(e["type"] == "LOST_CIRCULATION" and e["formation"] in ("TPM", "SLT", "BRL") for e in events)
    for csg in well["casing"][1:]:
        p = 0.08 if csg["size"].startswith("9") else (0.5 if had_loss_deep else 0.08)
        if rng.uniform() < p:
            events.append(make_event(rng, well, traj, "CEMENTING_PROBLEM", csg["shoe_md"] - 1.0, {"casing": csg["size"]}))

    # Positive experience worth remembering (drilled trouble-free with a documented practice).
    types_in = {(e["type"], e["formation"]) for e in events}
    sec8 = well["sections"][-1]
    if "TPM" in tops and ("LOST_CIRCULATION", "TPM") not in types_in and well["spud_year"] >= 2012 and sec8["mw_sg"] <= 1.31 \
            and rng.uniform() < 0.6:
        events.append(practice_tipam(rng, well, traj))
    if "BRL" in tops and ("STUCK_PIPE", "BRL") not in types_in and sec8["mud_system"] in ("KCl-glycol WBM", "OBM") \
            and rng.uniform() < 0.5:
        events.append(practice_barail(rng, well, traj))
    return events


def practice_tipam(rng, well, traj) -> dict:
    t = _tops_by_code(well)["TPM"]
    md1 = md_from_fpos(well, traj, "TPM", 0.75)
    md2 = min(t["md_base"], well["td_md"]) - 2
    sec = section_at(well, md1)
    q = int(round(rng.uniform(2150, 2350) / 50) * 50)
    return make_event(rng, well, traj, "NOTABLE_PRACTICE", md1, {
        "subtype": "lower Tipam drilled without losses", "md_base": round(md2, 1),
        "params": {"mw": sec["mw_sg"], "q": q, "ecd": round(sec["mw_sg"] + 0.04, 2), "caco3_ppb": int(rng.uniform(10, 20)),
                   "rop_max": int(rng.uniform(12, 18))},
        "mitigations": ["REDUCE_FLOW_ECD", "LCM_PILL", "DRILLING_PARAMS"], "outcome": "resolved"})


def practice_barail(rng, well, traj) -> dict:
    t = _tops_by_code(well)["BRL"]
    md1 = t["md_top"] + 5
    md2 = min(t["md_base"], well["td_md"]) - 2
    sec = section_at(well, md1)
    return make_event(rng, well, traj, "NOTABLE_PRACTICE", md1, {
        "subtype": "Barail drilled without stuck pipe", "md_base": round(md2, 1),
        "params": {"mw": sec["mw_sg"], "mud": sec["mud_system"], "kcl_pct": int(rng.uniform(5, 8))},
        "mitigations": ["INHIBITIVE_MUD", "CIRCULATE_SWEEP"], "outcome": "resolved"})


def assign_dates(rng: np.random.Generator, well: dict, events: list[dict]) -> None:
    """Spud date + drilling progress (~110 m/day) + accumulated NPT."""
    spud = dt.date(well["spud_year"], 1, 1) + dt.timedelta(days=int(rng.uniform(0, 300)))
    well["spud_date"] = spud.isoformat()
    delay = 0.0
    for ev in sorted(events, key=lambda e: e["md"]):
        day = ev["md"] / 110.0 + delay
        ev["date"] = (spud + dt.timedelta(days=int(day))).isoformat()
        ev["hour"] = int(rng.uniform(0, 21))
        delay += ev["npt_h"] / 24.0
    total_days = well["td_md"] / 110.0 + delay + 6
    well["completion_date"] = (spud + dt.timedelta(days=int(total_days))).isoformat()
