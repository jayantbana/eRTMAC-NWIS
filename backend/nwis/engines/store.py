"""In-memory view of the structured well data and the NWIS knowledge base."""
from __future__ import annotations

import json
import sqlite3
from functools import cached_property

from .. import config
from ..core.taxonomy import FORMATION_BY_CODE
from ..core.trajectory import Trajectory

JSON_FIELDS = ("flags", "provenance", "mitigations")


class Store:
    def __init__(self):
        self.reload()

    def reload(self) -> None:
        master = json.loads(config.WELLS_PATH.read_text())
        self.field = master["field"]
        self.data_mode = master.get("data_mode", config.DATA_MODE)
        self.active_id: str = master["active_well_id"]
        self.wells: dict[str, dict] = {w["id"]: w for w in master["wells"]}
        self.trajs: dict[str, Trajectory] = {wid: Trajectory.from_dict(w["trajectory"]) for wid, w in self.wells.items()}
        self.reload_kb()
        self.__dict__.pop("truth", None)

    def reload_kb(self) -> None:
        with self.connect() as db:
            rows = db.execute("SELECT * FROM events WHERE status != 'rejected'").fetchall()
            self.documents = {r["doc_id"]: dict(r) for r in db.execute("SELECT * FROM documents").fetchall()}
        self.events = []
        for r in rows:
            ev = dict(r)
            for k in JSON_FIELDS:
                ev[k] = json.loads(ev[k]) if ev[k] else []
            self.events.append(ev)
        self.events_by_id = {e["event_id"]: e for e in self.events}
        self.events_by_well: dict[str, list[dict]] = {}
        for e in self.events:
            self.events_by_well.setdefault(e["well_id"], []).append(e)
        self.docs_by_well: dict[str, list[dict]] = {}
        for d in self.documents.values():
            self.docs_by_well.setdefault(d["well_id"], []).append(d)

    def connect(self) -> sqlite3.Connection:
        db = sqlite3.connect(config.KB_PATH)
        db.row_factory = sqlite3.Row
        return db

    @cached_property
    def truth(self) -> dict:
        """Ground truth (synthetic only). Used for the replay feed and evaluation, never by the engines."""
        return json.loads(config.TRUTH_PATH.read_text()) if config.TRUTH_PATH.exists() else {}

    # -------------------------------------------------------------------------------- tops
    def offset_tops(self, well_id: str) -> list[dict]:
        return self.wells[well_id]["tops"]

    def active_tops(self, picked: dict[str, float] | None = None) -> list[dict]:
        """Active-well tops: actual picks where available, prognosis elsewhere.

        Deeper prognosed tops are shifted by the (actual - prognosed) delta of the deepest pick,
        which is how geologists update a prognosis while drilling.
        """
        w = self.wells[self.active_id]
        traj = self.trajs[self.active_id]
        actual = {t["code"]: t["md_top"] for t in w.get("tops_actual", [])}
        actual.update(picked or {})
        prog = {t["code"]: t["md_top"] for t in w["tops_prognosed"]}
        order = [t["code"] for t in w["tops_prognosed"]]
        delta = 0.0
        merged = []
        for code in order:
            if code in actual:
                md = actual[code]
                delta = md - prog[code]
                kind = "actual"
            else:
                md = prog[code] + delta
                kind = "prognosed"
            merged.append({"code": code, "md_top": round(md, 1), "kind": kind, "prognosed_md": prog[code]})
        td = traj.td
        merged = [m for m in merged if m["md_top"] < td]
        out = []
        for i, m in enumerate(merged):
            base = merged[i + 1]["md_top"] if i + 1 < len(merged) else td
            tvd_top, tvd_base = traj.tvd_at(m["md_top"]), traj.tvd_at(base)
            out.append({**m, "md_base": round(base, 1), "tvd_top": round(tvd_top, 1), "tvd_base": round(tvd_base, 1),
                        "tvdss_top": round(tvd_top - traj.rkb_elev, 1), "tvdss_base": round(tvd_base - traj.rkb_elev, 1),
                        "td_in_formation": i + 1 == len(merged), "name": FORMATION_BY_CODE[m["code"]].name})
        return out

    def tops_for(self, well_id: str, picked: dict[str, float] | None = None) -> list[dict]:
        if well_id == self.active_id:
            return self.active_tops(picked)
        return [{**t, "kind": "actual", "name": FORMATION_BY_CODE[t["code"]].name} for t in self.wells[well_id]["tops"]]

    @staticmethod
    def formation_at(tops: list[dict], md: float) -> dict | None:
        for t in tops:
            if t["md_top"] <= md < t["md_base"] or (t.get("td_in_formation") and md >= t["md_top"]):
                return t
        return None


_STORE: Store | None = None


def get_store() -> Store:
    global _STORE
    if _STORE is None:
        _STORE = Store()
    return _STORE
