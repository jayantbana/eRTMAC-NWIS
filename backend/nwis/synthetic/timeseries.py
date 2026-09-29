"""Synthetic real-time drilling data (eRTMAC-like 10 s records) with physics-plausible precursors.

Episodes
--------
* LC  lost circulation: flow-out deficit, pit volume falling, SPP dropping; flow cut after ~25 min.
* SP  stuck pipe / tight hole: rising torque level and variance, overpull on pick-ups, ROP loss,
      starting a few metres BEFORE the event depth (precursor); historical 'stuck' episodes then
      stop progress for an hour while the pipe is worked.
* OP  overpressure / kick: drilling break, gas rising, flow-out excess and pit gain; MW raised after 30 min.
* TQ  torque spikes / stick-slip: torque oscillation and variance.
* PIT pit transfer (confounder): pit volume moves while flows stay balanced -> must NOT alarm.
"""
from __future__ import annotations

import math
from dataclasses import dataclass, field
from typing import Callable

import numpy as np

STEP_S = 10.0
STAND_M = 28.5
FIELDS = ["t", "bit_md", "hole_md", "rop", "wob", "rpm", "torque", "hookload", "spp", "flow_in", "flow_out", "pit", "mw", "ecd",
          "gas", "on_bottom"]

BASE_ROP = {"ALV": 30, "DHK": 26, "NMS": 22, "GRJ": 11, "TPM": 21, "BRL": 12, "KPL": 9, "SLT": 8, "LGP": 9, "BSM": 4}


@dataclass
class Episode:
    kind: str  # LC | SP | OP | TQ | PIT
    md_onset: float
    stuck: bool = False
    precursor_m: float = 5.0
    t_onset: float | None = None
    meta: dict = field(default_factory=dict)

    def tau_min(self, t: float) -> float | None:
        return None if self.t_onset is None else (t - self.t_onset) / 60.0


@dataclass
class DrillContext:
    hole_in: float
    mw: float
    flow: float  # lpm
    inc_deg: float
    formation_at: Callable[[float], str]
    gas_bg: float = 0.9


def _intensity(ep: Episode, t: float, md: float) -> float:
    tau = ep.tau_min(t)
    if ep.kind == "SP":
        start = ep.md_onset - ep.precursor_m
        if tau is None:
            return 0.0 if md < start else float(np.clip((md - start) / ep.precursor_m, 0.0, 1.0))
        return float(np.clip(1.0 - tau / 25.0, 0.0, 1.0))
    if tau is None:
        return 0.0
    if ep.kind == "LC":
        if tau < 8:
            return tau / 8.0
        if tau < 25:
            return 1.0
        if tau < 40:
            return 1.0 - 0.85 * (tau - 25) / 15.0
        return max(0.0, 0.15 - 0.15 * (tau - 40) / 20.0)
    if ep.kind == "OP":
        if tau < 10:
            return tau / 10.0
        if tau < 30:
            return 1.0
        return max(0.0, 1.0 - (tau - 30) / 25.0)
    if ep.kind == "TQ":
        return 1.0 if tau < 20 else max(0.0, 1.0 - (tau - 20) / 10.0)
    if ep.kind == "PIT":
        return 1.0 if tau < 12 else 0.0
    return 0.0


def simulate(ctx: DrillContext, md_start: float, md_end: float, rng: np.random.Generator,
             episodes: list[Episode] | None = None, t0: float = 0.0, max_steps: int = 40000) -> dict[str, np.ndarray]:
    episodes = episodes or []
    rec: dict[str, list] = {k: [] for k in FIELDS}
    t, md = t0, md_start
    next_conn = math.ceil(md_start / STAND_M + 1e-9) * STAND_M
    pit = 180.0 + rng.uniform(-10, 10)
    mw = ctx.mw
    area = math.pi / 4 * (ctx.hole_in * 0.0254) ** 2
    gas = ctx.gas_bg
    conn_left = conn_total = 0
    tq_phase = 0.0

    for _ in range(max_steps):
        if md >= md_end:
            break
        for ep in episodes:
            if ep.t_onset is None and md >= ep.md_onset:
                ep.t_onset = t
        I = {k: 0.0 for k in ("LC", "SP", "OP", "TQ", "PIT")}
        for ep in episodes:
            I[ep.kind] = max(I[ep.kind], _intensity(ep, t, md))

        def active(kind: str, lo: float, hi: float) -> bool:
            return any(ep.kind == kind and ep.t_onset is not None and lo <= (t - ep.t_onset) / 60.0 < hi for ep in episodes)

        stuck = any(ep.kind == "SP" and ep.stuck and ep.t_onset is not None and (t - ep.t_onset) < 3600 for ep in episodes)
        flow_set = ctx.flow * (0.82 if active("LC", 25, 60) else 1.0)
        if active("OP", 30, 1e9):
            mw = min(ctx.mw + 0.08, mw + 0.0004)
        string_w = 0.028 * md * (1 - mw / 7.85) + 25.0
        drag = 4.0 + 0.1 * ctx.inc_deg

        if stuck:
            mode = "stuck"
        elif conn_left > 0 or md >= next_conn:
            if conn_left == 0:
                conn_left = conn_total = int(rng.uniform(36, 60))  # 6-10 minute connection
                next_conn += STAND_M
            conn_left -= 1
            mode = "conn"
        else:
            mode = "drill"

        if mode == "stuck":
            flow_in = flow_set * 0.7
            v = dict(rop=0.0, wob=0.0, rpm=0.0, torque=float(rng.uniform(2, 25)),
                     hookload=string_w + drag + float(rng.uniform(20, 60)), flow_in=flow_in,
                     flow_out=flow_in * (1 + rng.normal(0, 0.015)),
                     spp=17000 * (flow_in / 2400) ** 2 * (1.1 + rng.normal(0, 0.02)), on_bottom=0)
        elif mode == "conn":
            k = conn_total - conn_left
            flowback = 150.0 * math.exp(-k / 6.0)
            pit += flowback / 1000 * STEP_S / 60.0
            gas += (ctx.gas_bg + 0.6 - gas) * 0.05
            v = dict(rop=0.0, wob=0.0, rpm=0.0, torque=0.0,
                     hookload=string_w + drag + 28.0 * I["SP"] + rng.normal(0, 1.0),
                     flow_in=0.0, flow_out=flowback, spp=0.0, on_bottom=0)
        else:
            code = ctx.formation_at(md)
            rop = BASE_ROP.get(code, 12) * (1 + 0.12 * math.sin(md / 7.0) + rng.normal(0, 0.08))
            rop *= 1 - 0.45 * I["SP"]
            if active("OP", 0, 8):
                rop *= 2.3  # drilling break
            rop = max(rop, 1.0)
            flow_in = flow_set * (1 + rng.normal(0, 0.004))
            flow_out = flow_in * (1 + rng.normal(0, 0.012)) * (1 - 0.17 * I["LC"]) * (1 + 0.07 * I["OP"])
            tq_base = 9.0 + 0.0022 * md * (1 + ctx.inc_deg / 40)
            tq_phase += 0.9
            torque = tq_base * (1 + 0.35 * I["SP"]) * (1 + rng.normal(0, 0.035 + 0.15 * I["SP"] + 0.25 * I["TQ"]))
            torque += tq_base * 0.45 * I["TQ"] * math.sin(tq_phase)
            wob = 14.0 + rng.normal(0, 0.8)
            spp = 17000 * (flow_in / 2400) ** 2 * (1 + rng.normal(0, 0.012)) * (1 - 0.05 * I["LC"])
            pit -= area * rop / 3600 * STEP_S  # new hole volume
            pit += (flow_out - flow_in) / 1000 * STEP_S / 60.0  # returns imbalance
            pit += 0.22 * I["OP"] * STEP_S / 60.0  # influx
            if active("PIT", 0, 6):
                pit -= 0.35 * STEP_S / 60.0  # transfer out (flows balanced)
            elif active("PIT", 6, 12):
                pit += 0.35 * STEP_S / 60.0  # transfer back
            gas_target = ctx.gas_bg * (1 + 0.15 * math.sin(md / 11.0)) + 9.0 * I["OP"]
            gas += (gas_target - gas) * 0.08 + rng.normal(0, 0.04)
            md += rop / 3600 * STEP_S
            v = dict(rop=rop, wob=wob, rpm=110 + rng.normal(0, 2) - 40 * I["TQ"] * (0.5 + 0.5 * math.sin(tq_phase)),
                     torque=max(torque, 0.5), hookload=string_w - wob + rng.normal(0, 0.8), flow_in=flow_in,
                     flow_out=flow_out, spp=spp, on_bottom=1)

        rec["t"].append(t)
        rec["bit_md"].append(md if v["on_bottom"] else md - 0.5)
        rec["hole_md"].append(md)
        for key in ("rop", "wob", "rpm", "torque", "hookload", "spp", "flow_in", "flow_out", "on_bottom"):
            rec[key].append(float(v[key]))
        rec["pit"].append(pit)
        rec["mw"].append(mw)
        rec["ecd"].append(mw + 0.06 * (v["flow_in"] / 2400) ** 2)
        rec["gas"].append(max(gas, 0.05))
        t += STEP_S
    return {k: np.asarray(vals, dtype=float) for k, vals in rec.items()}
