"""Synthetic well construction: trajectories, formation tops, casing and hole sections."""
from __future__ import annotations

import numpy as np

from ..core.taxonomy import FORMATIONS
from ..core.trajectory import Trajectory
from .geology import compartment, formation_tops_tvdss, ground_elevation


def design_survey(rng: np.random.Generator, traj_type: str, azimuth: float, kop: float, build: float,
                  max_inc: float, drop_start: float | None = None, final_inc: float = 4.0,
                  md_max: float = 4800.0) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    md = np.arange(0.0, md_max + 1.0, 30.0)
    if traj_type == "vertical":
        inc = 0.4 + 0.5 * np.abs(np.sin(md / 700.0 + rng.uniform(0, 3)))
    else:
        inc = np.clip((md - kop) / 30.0 * build, 0.0, max_inc)
        if traj_type == "S" and drop_start is not None:
            drop = np.clip((md - drop_start) / 30.0 * build * 0.8, 0.0, max_inc - final_inc)
            inc = inc - drop
        inc = np.maximum(inc, 0.0) + rng.normal(0, 0.08, len(md)).clip(-0.2, 0.2)
        inc = np.maximum(inc, 0.0)
    azi = (azimuth + rng.normal(0, 0.6, len(md))) % 360.0
    return md, inc, azi


def cut_at_td(md: np.ndarray, inc: np.ndarray, azi: np.ndarray, td: float):
    keep = md < td
    md2, inc2, azi2 = md[keep], inc[keep], azi[keep]
    md2 = np.append(md2, td)
    inc2 = np.append(inc2, np.interp(td, md, inc))
    azi2 = np.append(azi2, np.interp(td, md, azi))
    return md2, inc2, azi2


def compute_tops(traj: Trajectory, step: float = 2.0) -> list[dict]:
    """Intersect the wellbore with every formation surface (actual tops)."""
    mds = np.arange(0.0, traj.td + 1e-6, step)
    tvdss = np.empty(len(mds))
    surf = {f.code: np.empty(len(mds)) for f in FORMATIONS}
    for i, m in enumerate(mds):
        tvd, n, e = traj.position_at(m)
        tvdss[i] = tvd - traj.rkb_elev
        tops = formation_tops_tvdss(traj.x0 + e, traj.y0 + n)
        for code, v in tops.items():
            surf[code][i] = v
    found: list[dict] = []
    for f in FORMATIONS:
        diff = tvdss - surf[f.code]
        idx = np.where(diff >= 0)[0]
        if f.code == "ALV":
            md_top = 0.0
        elif len(idx) == 0:
            continue
        else:
            i = int(idx[0])
            if i == 0:
                md_top = 0.0
            else:
                d0, d1 = diff[i - 1], diff[i]
                md_top = float(mds[i - 1] + (0 - d0) / (d1 - d0) * (mds[i] - mds[i - 1]))
        found.append({"code": f.code, "md_top": md_top})
    # Remove formations with (near) zero thickness, then add bases.
    tops: list[dict] = []
    for k, t in enumerate(found):
        nxt = found[k + 1]["md_top"] if k + 1 < len(found) else traj.td
        if nxt - t["md_top"] < 1.0 and k + 1 < len(found):
            continue
        tops.append(t)
    out = []
    for k, t in enumerate(tops):
        md_base = tops[k + 1]["md_top"] if k + 1 < len(tops) else traj.td
        tvd_top = traj.tvd_at(t["md_top"])
        tvd_base = traj.tvd_at(md_base)
        out.append({
            "code": t["code"],
            "md_top": round(t["md_top"], 1),
            "md_base": round(md_base, 1),
            "tvd_top": round(tvd_top, 1),
            "tvd_base": round(tvd_base, 1),
            "tvdss_top": round(tvd_top - traj.rkb_elev, 1),
            "tvdss_base": round(tvd_base - traj.rkb_elev, 1),
            "td_in_formation": k + 1 == len(tops),
        })
    return out


def top_md(tops: list[dict], code: str) -> float | None:
    for t in tops:
        if t["code"] == code:
            return t["md_top"]
    return None


def build_well(rng: np.random.Generator, wid: str, name: str, x: float, y: float, spud_year: int,
               traj_type: str, target: str, overrides: dict | None = None) -> dict:
    """Create a complete synthetic well master record (header, survey, tops, casing, sections)."""
    o = overrides or {}
    ground = ground_elevation(x, y)
    rkb = ground + o.get("rig_floor", float(rng.uniform(6.5, 9.5)))
    azimuth = o.get("azimuth", float(rng.uniform(0, 360)))
    kop = o.get("kop", float(rng.uniform(700, 1600)))
    build = o.get("build", float(rng.uniform(1.5, 2.5)))
    max_inc = o.get("max_inc", float(rng.uniform(12, 34)))
    drop_start = o.get("drop_start", float(rng.uniform(2100, 2500)))
    md, inc, azi = design_survey(rng, traj_type, azimuth, kop, build, max_inc, drop_start)
    full = Trajectory(md, inc, azi, x, y, rkb)

    # TD from the target formation.
    tops_at = formation_tops_tvdss(x, y)
    if "td_md" in o:
        td = float(o["td_md"])
    else:
        if target == "TPM":
            tgt = tops_at["TPM"] + rng.uniform(0.55, 0.9) * (tops_at["BRL"] - tops_at["TPM"])
        elif target == "BRL":
            tgt = tops_at["BRL"] + rng.uniform(0.45, 0.95) * (tops_at["KPL"] - tops_at["BRL"])
        else:
            tgt = tops_at["SLT"] + rng.uniform(0.2, 0.8) * (tops_at["LGP"] - tops_at["SLT"])
        td = round(full.md_at_tvdss(tgt), 1)
    md, inc, azi = cut_at_td(md, inc, azi, td)
    traj = Trajectory(md, inc, azi, x, y, rkb)
    tops = compute_tops(traj)

    # Casing design.
    shoe13 = round(traj.md_at_tvdss(480.0 + rng.uniform(-30, 30)), 1)
    tpm_top = top_md(tops, "TPM") or traj.td * 0.7
    shoe9 = round(min(tpm_top + rng.uniform(10, 25), traj.td - 50), 1)
    casing = [
        {"size": "13 3/8\"", "od_in": 13.375, "shoe_md": shoe13, "shoe_tvd": round(traj.tvd_at(shoe13), 1)},
        {"size": "9 5/8\"", "od_in": 9.625, "shoe_md": shoe9, "shoe_tvd": round(traj.tvd_at(shoe9), 1)},
        {"size": "7\"", "od_in": 7.0, "shoe_md": round(traj.td - 2.0, 1), "shoe_tvd": round(traj.tvd_at(traj.td - 2.0), 1)},
    ]

    # Hole sections and mud systems.
    modern = spud_year >= 2015
    mud_12 = "KCl-PHPA WBM" if spud_year >= 2005 else "Gel-polymer WBM"
    r = rng.uniform()
    if modern and r < 0.12:
        mud_8 = "OBM"
    elif modern and r < 0.6:
        mud_8 = "KCl-glycol WBM"
    else:
        mud_8 = "KCl-polymer WBM" if spud_year >= 2005 else "Gel-polymer WBM"
    mw8 = o.get("mw_8", round(float(rng.uniform(1.26, 1.40)), 2))
    sections = [
        {"hole_in": 17.5, "hole": "17 1/2\"", "md_from": 0.0, "md_to": shoe13, "mud_system": "Spud / gel WBM",
         "mw_sg": round(float(rng.uniform(1.06, 1.12)), 2)},
        {"hole_in": 12.25, "hole": "12 1/4\"", "md_from": shoe13, "md_to": shoe9, "mud_system": mud_12,
         "mw_sg": round(float(rng.uniform(1.18, 1.26)), 2)},
        {"hole_in": 8.5, "hole": "8 1/2\"", "md_from": shoe9, "md_to": traj.td, "mud_system": o.get("mud_8", mud_8),
         "mw_sg": mw8},
    ]
    for s in sections:
        s["ecd_sg"] = round(s["mw_sg"] + float(rng.uniform(0.03, 0.08)), 2)

    xb, yb = traj.xy_at(tpm_top)
    return {
        "id": wid,
        "name": name,
        "x": round(x, 1),
        "y": round(y, 1),
        "ground_elev": round(ground, 1),
        "rkb_elev": round(rkb, 1),
        "spud_year": spud_year,
        "traj_type": traj_type,
        "td_md": traj.td,
        "td_tvd": round(traj.tvd_at(traj.td), 1),
        "compartment": compartment(xb, yb),
        "status": "drilled",
        "target": target,
        "trajectory": traj.to_dict(),
        "tops": tops,
        "casing": casing,
        "sections": sections,
        "is_synthetic": True,
    }


def section_at(well: dict, md: float) -> dict:
    for s in well["sections"]:
        if s["md_from"] <= md <= s["md_to"] + 1e-6:
            return s
    return well["sections"][-1]


def formation_at(tops: list[dict], md: float) -> dict | None:
    for t in tops:
        if t["md_top"] <= md < t["md_base"] or (t["td_in_formation"] and md >= t["md_top"]):
            return t
    return None
