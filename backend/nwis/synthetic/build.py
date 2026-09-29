"""Build the complete SYNTHETIC source dataset.

Reproduces the PS section 4 scenario around the active Well A:
  * Well B (~1.4 km)  - severe/partial mud losses in lower Tipam        (A-frame ~2,805-2,820 m)
  * Well C (~2.3 km)  - stuck pipe at the top of Barail coal-shale       (A-frame ~2,855-2,870 m)
  * Well D (~3.1 km)  - losses in lower Tipam + overpressure in Barail   (A-frame ~2,885-2,900 m)
  * Well E (~8 km)    - no trouble; documented mud/ECD practice that worked
  * Well G (~2 km)    - close in map view but across a fault (compartment W, thinner Tipam,
                        no Namsang) -> low geological relevance
plus ~38 randomly placed wells whose events follow the hidden hazard model.
"""
from __future__ import annotations

import datetime as dt
import json
import math
import shutil

import numpy as np

from .. import config
from ..core.trajectory import Trajectory
from .events import assign_dates, fpos_from_md, make_event, md_from_fpos, sample_events
from .geology import FIELD_HALF_X, FIELD_HALF_Y, FIELD_NAME, compartment
from .reports import build_ddr, build_wcr, render_digital, render_scanned
from .timeseries import BASE_ROP, DrillContext, Episode, simulate
from .wells import build_well, formation_at, section_at

SCENARIO_WINDOW = {"TPM", "BRL", "KPL"}


def _polar(dist_m: float, azimuth_deg: float) -> tuple[float, float]:
    a = math.radians(azimuth_deg)
    return dist_m * math.sin(a), dist_m * math.cos(a)


def _letters():
    import string
    for c in string.ascii_uppercase:
        yield c
    for c1 in string.ascii_uppercase:
        for c2 in string.ascii_uppercase:
            yield c1 + c2


def build_active_well(rng) -> dict:
    well = build_well(rng, "A", "Well A", 0.0, 0.0, 2026, "J", "BRL",
                      {"kop": 1400.0, "build": 2.0, "max_inc": 16.0, "azimuth": 75.0, "mw_8": 1.30, "mud_8": "KCl-polymer WBM",
                       "rig_floor": 8.0, "td_md": 3250.0})
    well["status"] = "drilling"
    return well


def scenario_depths(active: dict) -> dict[str, float]:
    brl = next(t for t in active["tops"] if t["code"] == "BRL")["md_top"]
    return {"loss": round(brl - 27, 1), "tight": round(brl + 24, 1), "op": round(brl + 53, 1), "brl_top": brl}


def place_event_like(rng, active, a_traj, offset, o_traj, a_md, etype, forced):
    code, f = fpos_from_md(active, a_traj, a_md)
    md = md_from_fpos(offset, o_traj, code, float(np.clip(f + rng.normal(0, 0.004), 0.01, 0.99)))
    return make_event(rng, offset, o_traj, etype, md, forced)


def main(n_random: int = 38, scanned_share: float = 0.07) -> None:
    rng = np.random.default_rng(config.SEED)
    if config.SOURCE_DIR.exists():
        shutil.rmtree(config.SOURCE_DIR)
    config.DOCS_DIR.mkdir(parents=True, exist_ok=True)
    config.TIMESERIES_DIR.mkdir(parents=True, exist_ok=True)

    # ---------------------------------------------------------------- wells
    active = build_active_well(rng)
    a_traj = Trajectory.from_dict(active["trajectory"])
    sd = scenario_depths(active)

    specs = [  # id, dist, azimuth, spud, trajectory, target, overrides
        ("B", 1400, 60, 2019, "vertical", "BRL", {"mw_8": 1.37, "mud_8": "KCl-polymer WBM"}),
        ("C", 2300, 200, 2016, "J", "BRL", {"max_inc": 24.0, "kop": 1200.0, "mud_8": "KCl-polymer WBM", "mw_8": 1.31}),
        ("D", 3100, 110, 2021, "S", "SLT", {"mw_8": 1.34, "mud_8": "KCl-polymer WBM"}),
        ("E", 8000, 45, 2022, "vertical", "BRL", {"mw_8": 1.27, "mud_8": "KCl-glycol WBM"}),
        ("G", 2000, 315, 2018, "vertical", "BRL", {"mw_8": 1.30}),
    ]
    wells = {"A": active}
    for wid, dist, az, spud, tt, tgt, ov in specs:
        x, y = _polar(dist, az)
        wells[wid] = build_well(rng, wid, f"Well {wid}", x, y, spud, tt, tgt, ov)

    names = (n for n in _letters() if n not in wells)
    placed = [(w["x"], w["y"]) for w in wells.values()]
    tries = 0
    while len(wells) < 6 + n_random and tries < 20000:
        tries += 1
        x, y = rng.uniform(-FIELD_HALF_X + 800, FIELD_HALF_X - 800), rng.uniform(-FIELD_HALF_Y + 800, FIELD_HALF_Y - 800)
        if math.hypot(x, y) < 3800 or min(math.hypot(x - px, y - py) for px, py in placed) < 900:
            continue
        wid = next(names)
        spud = int(rng.choice(np.arange(1992, 2026), p=None))
        tt = str(rng.choice(["vertical", "J", "S"], p=[0.4, 0.45, 0.15]))
        tgt = str(rng.choice(["TPM", "BRL", "SLT"], p=[0.15, 0.6, 0.25]))
        wells[wid] = build_well(rng, wid, f"Well {wid}", x, y, spud, tt, tgt)
        placed.append((x, y))

    # ---------------------------------------------------------------- events (hidden truth)
    truth: list[dict] = []
    trajs = {wid: Trajectory.from_dict(w["trajectory"]) for wid, w in wells.items()}
    for wid, w in wells.items():
        if wid == "A":
            continue
        evs = sample_events(rng, w, trajs[wid])
        if wid in ("B", "C", "D", "E", "G"):
            evs = [e for e in evs if e["formation"] not in SCENARIO_WINDOW and e["type"] != "CEMENTING_PROBLEM"]
        o = trajs[wid]
        if wid == "B":
            evs.append(place_event_like(rng, active, a_traj, w, o, sd["loss"] - 2, "LOST_CIRCULATION", {
                "subtype": "partial", "rate_bph": 40, "mitigations": ["REDUCE_FLOW_ECD", "LCM_PILL"], "outcome": "resolved", "npt_h": 18.5}))
        if wid == "C":
            evs.append(place_event_like(rng, active, a_traj, w, o, sd["tight"], "STUCK_PIPE", {
                "subtype": "differential", "mitigations": ["JARRING", "SPOTTING_PILL"], "outcome": "resolved", "npt_h": 22.0}))
        if wid == "D":
            evs.append(place_event_like(rng, active, a_traj, w, o, sd["loss"] - 8, "LOST_CIRCULATION", {
                "subtype": "severe", "rate_bph": 140, "mitigations": ["REDUCE_FLOW_ECD", "LCM_PILL"], "outcome": "partial", "npt_h": 31.0}))
            evs.append(place_event_like(rng, active, a_traj, w, o, sd["op"], "OVERPRESSURE_KICK", {
                "subtype": "kick", "mitigations": ["WELL_CONTROL", "RAISE_MW"], "outcome": "resolved", "npt_h": 16.0, "mw2": 1.42}))
            shoe7 = w["casing"][2]["shoe_md"] - 1.0
            evs.append(make_event(rng, w, o, "CEMENTING_PROBLEM", shoe7, {
                "subtype": "losses during cementing", "casing": "7\"", "mitigations": ["CEMENT_PLUG"], "outcome": "resolved", "npt_h": 20.0}))
        if wid == "E":
            from .events import practice_barail, practice_tipam
            evs.append(practice_tipam(rng, w, o))
            evs.append(practice_barail(rng, w, o))
        if wid == "G":
            brl = next(t for t in w["tops"] if t["code"] == "BRL")
            evs.append(make_event(rng, w, o, "TORQUE_SPIKE", brl["md_top"] + 180, {"outcome": "resolved"}))
        assign_dates(rng, w, evs)
        truth.extend(evs)
    for i, ev in enumerate(sorted(truth, key=lambda e: (e["well_id"], e["md"]))):
        ev["id"] = f"GT-{i + 1:04d}"
        ev["mentions"] = []

    # ---------------------------------------------------------------- documents
    doc_index: list[dict] = []
    by_well: dict[str, list[dict]] = {}
    for ev in truth:
        by_well.setdefault(ev["well_id"], []).append(ev)
    for wid, w in wells.items():
        if wid == "A":
            continue
        evs = by_well.get(wid, [])
        units = "ft" if w["spud_year"] < 2005 else "m"
        if w["spud_year"] >= 2000:
            by_date: dict[str, list[dict]] = {}
            for ev in evs:
                if ev["type"] != "NOTABLE_PRACTICE":
                    by_date.setdefault(ev["date"], []).append(ev)
            normal_days = int(rng.integers(1, 3))
            spud = dt.date.fromisoformat(w["spud_date"])
            for _ in range(normal_days):
                d = (spud + dt.timedelta(days=int(rng.integers(3, 25)))).isoformat()
                by_date.setdefault(d, [])
            for rn, (date, day_evs) in enumerate(sorted(by_date.items()), start=1):
                doc_id = f"{wid}-DDR-{date}"
                layout = build_ddr(rng, w, date, day_evs, rn * 3 + int(rng.integers(0, 3)), units)
                scanned = (wid == "C" and any(e["type"] == "STUCK_PIPE" for e in day_evs)) or \
                          (wid not in ("B", "D") and rng.uniform() < scanned_share)
                path = config.DOCS_DIR / f"{doc_id}.pdf"
                title = f"DDR {w['name']} {date}"
                render_scanned(layout, path, rng, title) if scanned else render_digital(layout, path, title)
                doc_index.append({"doc_id": doc_id, "well_id": wid, "doc_type": "DDR", "date": date, "file": path.name,
                                  "scanned": bool(scanned), "pages": len(layout.pages)})
                for ev in day_evs:
                    ev["mentions"].append({"doc_id": doc_id, "pages": sorted(layout.marks.get(ev["id"], []))})
        include = {e["id"] for e in evs if w["spud_year"] < 2000 or wid in ("B", "C", "D", "E") or rng.uniform() < 0.8
                   or e["type"] == "NOTABLE_PRACTICE"}
        doc_id = f"{wid}-WCR"
        layout = build_wcr(rng, w, evs, units, include)
        scanned = w["spud_year"] < 2000
        path = config.DOCS_DIR / f"{doc_id}.pdf"
        title = f"WCR {w['name']}"
        render_scanned(layout, path, rng, title) if scanned else render_digital(layout, path, title)
        doc_index.append({"doc_id": doc_id, "well_id": wid, "doc_type": "WCR", "date": w["completion_date"], "file": path.name,
                          "scanned": bool(scanned), "pages": len(layout.pages)})
        for ev in evs:
            if ev["id"] in layout.marks:
                ev["mentions"].append({"doc_id": doc_id, "pages": sorted(layout.marks[ev["id"]])})

    # ---------------------------------------------------------------- active well: prognosis vs actual
    prog_err = {"TPM": 6.0, "BRL": 12.0, "KPL": 18.0, "SLT": 20.0}
    tops_actual = active["tops"]
    tops_prog = []
    for t in tops_actual:
        err = prog_err.get(t["code"], float(rng.normal(0, 5)))
        md_top = t["md_top"] + (0.0 if t["code"] == "ALV" else err)
        tops_prog.append({"code": t["code"], "md_top": round(md_top, 1)})
    replay_start = 2700.0
    active["tops_prognosed"] = tops_prog
    active["tops_actual"] = [dict(code=t["code"], md_top=t["md_top"]) for t in tops_actual if t["md_top"] < replay_start]
    active["current_md"] = replay_start
    del active["tops"]
    active_truth = {"tops_actual": [dict(code=t["code"], md_top=t["md_top"]) for t in tops_actual], "scenario": sd}

    # ---------------------------------------------------------------- time series
    def fm_fn(tops):
        return lambda md: (formation_at(tops, md) or {"code": "BRL"})["code"]

    sec8 = section_at(active, 2800.0)
    ctx = DrillContext(hole_in=8.5, mw=sec8["mw_sg"], flow=2300.0, inc_deg=a_traj.inc_at(2800.0), formation_at=fm_fn(tops_actual),
                       gas_bg=0.9)
    episodes = [Episode("PIT", sd["loss"] - 45), Episode("LC", sd["loss"]), Episode("SP", sd["tight"], stuck=False, precursor_m=6.0),
                Episode("OP", sd["op"])]
    replay = simulate(ctx, replay_start, 3000.0, np.random.default_rng(config.SEED + 1), episodes)
    np.savez_compressed(config.TIMESERIES_DIR / "A_replay.npz", **replay)
    active_truth["replay_episodes"] = [{"kind": e.kind, "md_onset": e.md_onset, "t_onset": e.t_onset} for e in episodes]

    # Historical training segments around offset events + normal drilling (with confounders).
    seg_arrays: dict[str, list] = {}
    seg_meta: list[dict] = []
    kind_of = {"LOST_CIRCULATION": "LC", "STUCK_PIPE": "SP", "TIGHT_HOLE": "SP", "OVERPRESSURE_KICK": "OP", "TORQUE_SPIKE": "TQ"}
    trng = np.random.default_rng(config.SEED + 2)

    def add_segment(seg: dict, meta: dict):
        sid = len(seg_meta)
        meta["segment"] = sid
        seg_meta.append(meta)
        for k, v in seg.items():
            seg_arrays.setdefault(k, []).append(v)
        seg_arrays.setdefault("segment", []).append(np.full(len(seg["t"]), sid))

    for ev in truth:
        kind = kind_of.get(ev["type"])
        if not kind or ev["md"] < 600:
            continue
        w = wells[ev["well_id"]]
        tops = w["tops"]
        sec = section_at(w, ev["md"])
        rop = BASE_ROP.get(ev["formation"] or "BRL", 12)
        c = DrillContext(hole_in=sec["hole_in"], mw=sec["mw_sg"], flow=3300.0 if sec["hole_in"] > 10 else 2300.0,
                         inc_deg=ev["inc_deg"], formation_at=fm_fn(tops), gas_bg=float(trng.uniform(0.5, 1.4)))
        ep = Episode(kind, ev["md"], stuck=ev["type"] == "STUCK_PIPE", precursor_m=float(trng.uniform(4, 7)))
        seg = simulate(c, ev["md"] - rop * 55 / 60, ev["md"] + rop * 50 / 60, trng, [ep], max_steps=900)
        add_segment(seg, {"well_id": w["id"], "kind": kind, "event_id": ev["id"], "t_onset": ep.t_onset, "md_onset": ev["md"],
                          "precursor_m": ep.precursor_m})
    for wid, w in wells.items():
        if wid == "A":
            continue
        sec = w["sections"][-1]
        brl = next((t["md_top"] for t in w["tops"] if t["code"] == "BRL"), None)
        for j in range(3):
            md0 = float(trng.uniform(sec["md_from"] + 20, max(sec["md_from"] + 30, w["td_md"] - 40)))
            if j == 2:  # straddle a formation boundary (ROP/torque change that must NOT alarm)
                if brl is None or brl < sec["md_from"] + 20 or brl > w["td_md"] - 15:
                    continue
                md0 = brl - 12
            c = DrillContext(hole_in=8.5, mw=sec["mw_sg"], flow=2300.0, inc_deg=trajs[wid].inc_at(md0), formation_at=fm_fn(w["tops"]),
                             gas_bg=float(trng.uniform(0.5, 1.4)))
            eps = [Episode("PIT", md0 + 6)] if j == 0 else []
            seg = simulate(c, md0, md0 + 22, trng, eps, max_steps=900)
            add_segment(seg, {"well_id": wid, "kind": "NONE", "event_id": None, "t_onset": None, "md_onset": None})
    np.savez_compressed(config.TIMESERIES_DIR / "training_segments.npz", **{k: np.concatenate(v) for k, v in seg_arrays.items()})
    (config.TIMESERIES_DIR / "training_segments.json").write_text(json.dumps(seg_meta, indent=1))

    # ---------------------------------------------------------------- write source systems
    master = {"field": FIELD_NAME, "data_mode": config.DATA_MODE, "active_well_id": "A",
              "wells": [w for w in wells.values()]}
    config.WELLS_PATH.write_text(json.dumps(master, indent=1))
    config.TRUTH_PATH.write_text(json.dumps({"events": truth, "documents": doc_index, "active": active_truth}, indent=1))
    n_scanned = sum(d["scanned"] for d in doc_index)
    print(f"[synthetic] wells={len(wells)} events={len(truth)} documents={len(doc_index)} (scanned={n_scanned}) "
          f"training_segments={len(seg_meta)} replay_records={len(replay['t'])}")
    print(f"[synthetic] Well A scenario depths: {sd}")
    for wid in ("B", "C", "D", "E", "G"):
        w = wells[wid]
        print(f"  {w['name']}: compartment={w['compartment']} dist={math.hypot(w['x'], w['y']) / 1000:.1f} km "
              f"events={[(e['type'], e['md']) for e in by_well.get(wid, [])]}")
    _ = compartment  # (re-exported for debugging)


if __name__ == "__main__":
    main()
