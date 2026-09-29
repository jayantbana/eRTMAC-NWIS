"""Live session: replays Well A's eRTMAC-style feed through the full NWIS real-time chain.

record -> QC -> features -> Tier-1 rules + Tier-2 model -> formation-top picking (updates the
alignment of every offset event) -> look-ahead zones -> fusion -> alert engine -> WebSocket.
"""
from __future__ import annotations

from collections import deque

import numpy as np

from .. import config
from ..core.taxonomy import FORMATION_BY_CODE
from ..engines.alerts import AlertEngine
from ..engines.precursors import PrecursorModel, rules, FeatureState
from ..engines.relevance import compute_offsets
from ..engines.risk import formation_risk, risk_track
from ..engines.store import Store

RECORD_KEYS = ["t", "bit_md", "hole_md", "rop", "wob", "rpm", "torque", "hookload", "spp", "flow_in", "flow_out", "pit", "mw", "ecd",
               "gas", "on_bottom"]


class ReplaySession:
    def __init__(self, store: Store, radius_km: float = config.DEFAULT_RADIUS_KM, from_md: float = 2740.0):
        self.store = store
        self.radius_km = radius_km
        data = np.load(config.TIMESERIES_DIR / "A_replay.npz")
        self.data = {k: data[k] for k in RECORD_KEYS}
        self.n = len(self.data["t"])
        start = int(np.searchsorted(self.data["hole_md"], from_md))
        self.i = max(start, 0)
        self.fs = FeatureState()
        for j in range(max(0, self.i - 180), self.i):  # warm the rolling windows
            self.fs.update(self._rec(j))
        self.model = PrecursorModel.load()
        truth = store.truth.get("active", {})
        known = {t["code"] for t in store.wells[store.active_id].get("tops_actual", [])}
        self.pending_tops = sorted([t for t in truth.get("tops_actual", []) if t["code"] not in known], key=lambda t: t["md_top"])
        self.picked: dict[str, float] = {}
        for t in list(self.pending_tops):
            if t["md_top"] + 2.0 <= self.data["hole_md"][self.i]:
                self.picked[t["code"]] = t["md_top"]
                self.pending_tops.remove(t)
        self.alerts = AlertEngine()
        self.md_hist: deque = deque(maxlen=400)
        self.notices: list[dict] = []
        self._recompute()

    def _rec(self, j: int) -> dict:
        return {k: float(self.data[k][j]) for k in RECORD_KEYS}

    def _recompute(self):
        self.offsets = compute_offsets(self.store, self.radius_km, picked=self.picked)
        self.atlas = formation_risk(self.store, self.offsets, scope="offsets")
        self.track = risk_track(self.store, self.offsets, picked=self.picked, atlas=self.atlas)

    @property
    def done(self) -> bool:
        return self.i >= self.n

    def step(self) -> dict:
        r = self._rec(self.i)
        self.i += 1
        f = self.fs.update(r)
        pumping = r["flow_in"] > 500
        fired = rules(f, pumping)
        live = self.model.predict(f) if self.model else {}
        for fam, v in live.items():
            v["rules"] = fired.get(fam, [])
        track_changed = False
        for t in list(self.pending_tops):
            if r["hole_md"] >= t["md_top"] + 2.0:
                prog = next(p["md_top"] for p in self.store.wells[self.store.active_id]["tops_prognosed"] if p["code"] == t["code"])
                current = next((x["md_top"] for x in self.track["tops"] if x["code"] == t["code"]), prog)
                self.picked[t["code"]] = t["md_top"]
                self.pending_tops.remove(t)
                self._recompute()
                track_changed = True
                self.notices.append({"t": r["t"], "kind": "top_picked", "code": t["code"], "name": FORMATION_BY_CODE[t["code"]].name,
                                     "md": t["md_top"], "expected_md": current,
                                     "text": f"Top {FORMATION_BY_CODE[t['code']].name} picked at {t['md_top']:,.1f} m MD "
                                             f"({t['md_top'] - current:+.1f} m vs current prognosis). Offset events re-aligned."})
        self.md_hist.append((r["t"], r["hole_md"]))
        t_old, md_old = next(((tt, mm) for tt, mm in self.md_hist if r["t"] - tt <= 3600), (r["t"], r["hole_md"]))
        dt_h = max((r["t"] - t_old) / 3600.0, 1e-6)
        rop_1h = (r["hole_md"] - md_old) / dt_h if dt_h > 0.05 else r["rop"]
        changed = self.alerts.step(r["t"], r["hole_md"], rop_1h, self.track, live, fired)
        fm = self.store.formation_at(self.track["tops"], r["hole_md"])
        return {"record": {k: round(v, 3) for k, v in r.items()}, "features": {k: round(v, 3) for k, v in f.items()},
                "live": live, "rules": fired, "rop_1h": round(rop_1h, 1),
                "formation": {"code": fm["code"], "name": fm["name"], "kind": fm["kind"]} if fm else None,
                "changed_alerts": [a["id"] for a in changed], "track_changed": track_changed}

    def snapshot(self) -> dict:
        return {"alerts": self.alerts.active(), "notices": self.notices[-10:], "progress": round(self.i / self.n, 4),
                "picked": self.picked}
