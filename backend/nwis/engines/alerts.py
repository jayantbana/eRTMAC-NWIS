"""Alert engine (PS requirement 6): tiered, evidence-backed, low-fatigue alerts.

Tiers
  ADVISORY  historical risk zone inside the look-ahead window (bit not yet there)
  CAUTION   bit inside (or within 20 m of) a historical zone, or live anomaly without precedent
  WARNING   inside/near a zone AND live precursors (Tier-1 rule or Tier-2 probability) agree

Anti-fatigue: one alert per (family, zone) that escalates instead of repeating; de-escalation only
after 5 minutes below the condition (hysteresis); zones clear once passed; acknowledgements stick.
"""
from __future__ import annotations

import math

from .. import config
from ..core.taxonomy import RISK_FAMILIES
from .risk import value_at

TIER_RANK = {None: 0, "ADVISORY": 1, "CAUTION": 2, "WARNING": 3}
HOLD_S = 300.0
NEAR_M = 20.0
GAMMA = 0.8


def _logit(p: float) -> float:
    p = min(max(p, 1e-4), 1 - 1e-4)
    return math.log(p / (1 - p))


def fuse(p_prior: float, p_live: float | None) -> float:
    """Log-odds fusion of offset history (prior) and live precursor evidence (balanced model, base 0.5)."""
    if p_live is None:
        return p_prior
    p_live = min(max(p_live, 0.02), 0.98)
    z = _logit(max(p_prior, 0.01)) + GAMMA * (_logit(p_live) - 0.0)
    return 1 / (1 + math.exp(-z))


class AlertEngine:
    def __init__(self):
        self.alerts: dict[str, dict] = {}
        self.seq = 0
        self.key_map: dict[str, str] = {}  # re-aligned zone id -> existing alert key
        self.persist: dict[str, int] = {}  # consecutive samples with live evidence, per family

    def active(self) -> list[dict]:
        return sorted([a for a in self.alerts.values() if a["state"] != "cleared"],
                      key=lambda a: (-TIER_RANK[a["tier"]], a["md_from"] if a["md_from"] is not None else 1e9))

    def acknowledge(self, alert_id: str, user: str, reason: str) -> dict | None:
        for a in self.alerts.values():
            if a["id"] == alert_id:
                a["acknowledged"] = {"by": user, "reason": reason}
                return a
        return None

    def step(self, t: float, bit_md: float, rop_1h: float, track: dict, live: dict, fired: dict) -> list[dict]:
        look = max(config.LOOKAHEAD_MIN_M, rop_1h * config.LOOKAHEAD_HOURS)
        changed = []
        seen = set()
        # Live evidence must persist: rule for >= 3 samples (30 s) or model above threshold for >= 6 samples (1 min).
        for fam in RISK_FAMILIES:
            lv = live.get(fam)
            hit_rule = fam in fired
            hit_model = lv is not None and lv["p"] >= lv.get("threshold", 0.7) and lv.get("corroborated", True)
            self.persist[fam] = self.persist.get(fam, 0) + 1 if (hit_rule or hit_model) else 0
            self.persist[fam + ":rule"] = self.persist.get(fam + ":rule", 0) + 1 if hit_rule else 0
        for z in track["zones"]:
            fam = z["family"]
            key = self._stable_key(z)
            seen.add(key)
            ahead = z["md_from"] - bit_md
            in_zone = z["md_from"] - NEAR_M <= bit_md <= z["md_to"] + 5
            passed = bit_md > z["md_to"] + 10
            lv = live.get(fam)
            p_live = lv["p"] if lv else None
            p_prior = value_at(track, fam, bit_md) if in_zone else z["peak"]
            p_final = fuse(p_prior, p_live) if in_zone else p_prior
            live_hit = self.persist.get(fam + ":rule", 0) >= 3 or self.persist.get(fam, 0) >= 6
            if passed:
                cond = None
            elif in_zone:
                cond = "WARNING" if live_hit else "CAUTION"
            elif 0 < ahead <= look:
                cond = "ADVISORY"
            else:
                cond = None
            c = self._apply(key, cond, t, z=z, fam=fam, bit_md=bit_md, ahead=ahead, rop=rop_1h, p_prior=p_prior, p_live=p_live,
                            p_final=p_final, reasons=fired.get(fam, []), lv=lv, look=look)
            if c:
                changed.append(c)
        # Live anomalies with no historical zone nearby: never suppress real-time signals.
        for fam, reasons in fired.items():
            if fam not in RISK_FAMILIES or self.persist.get(fam + ":rule", 0) < 3:
                continue
            near_zone = any(z["family"] == fam and z["md_from"] - NEAR_M <= bit_md <= z["md_to"] + NEAR_M for z in track["zones"])
            key = f"{fam}-live"
            if near_zone:
                continue
            seen.add(key)
            lv = live.get(fam)
            c = self._apply(key, "CAUTION", t, z=None, fam=fam, bit_md=bit_md, ahead=0.0, rop=rop_1h, p_prior=0.0,
                            p_live=lv["p"] if lv else None, p_final=lv["p"] if lv else 0.5, reasons=reasons, lv=lv, look=look)
            if c:
                changed.append(c)
        for key, a in self.alerts.items():
            if key not in seen and a["state"] != "cleared":
                c = self._apply(key, None, t, z=None, fam=a["family"], bit_md=bit_md, ahead=0, rop=rop_1h, p_prior=0, p_live=None,
                                p_final=0, reasons=[], lv=None, look=look)
                if c:
                    changed.append(c)
        return changed

    def _stable_key(self, z: dict) -> str:
        """Keep the same alert when a zone shifts after formation tops are re-picked."""
        if z["id"] in self.alerts or z["id"] in self.key_map:
            return self.key_map.get(z["id"], z["id"])
        for key, a in self.alerts.items():
            if a["state"] != "cleared" and a["family"] == z["family"] and a["md_from"] is not None                     and z["md_from"] <= a["md_to"] + 30 and z["md_to"] >= a["md_from"] - 30:
                self.key_map[z["id"]] = key
                a["realigned"] = {"from": [a["md_from"], a["md_to"]], "to": [z["md_from"], z["md_to"]]}
                return key
        return z["id"]

    def _apply(self, key, cond, t, *, z, fam, bit_md, ahead, rop, p_prior, p_live, p_final, reasons, lv, look) -> dict | None:
        a = self.alerts.get(key)
        if a is None:
            if cond is None:
                return None
            self.seq += 1
            a = self.alerts[key] = {"id": f"AL-{self.seq:03d}", "key": key, "family": fam, "label": RISK_FAMILIES[fam], "tier": None,
                                    "state": "active", "created_t": t, "history": [], "acknowledged": None, "last_high_t": t,
                                    "md_from": z["md_from"] if z else None, "md_to": z["md_to"] if z else None,
                                    "zone": z, "live_only": z is None}
        if z is not None:
            a["zone"], a["md_from"], a["md_to"] = z, z["md_from"], z["md_to"]
        prev = a["tier"]
        if cond is not None and TIER_RANK[cond] >= TIER_RANK[prev]:
            a["tier"] = cond
            a["last_high_t"] = t
        elif cond is not None and TIER_RANK[cond] < TIER_RANK[prev]:
            if t - a["last_high_t"] >= HOLD_S:
                a["tier"] = cond
        elif cond is None:
            if prev is not None and (t - a["last_high_t"] >= HOLD_S or (z is not None and bit_md > z["md_to"] + 10)):
                a["tier"] = None
                a["state"] = "cleared"
        a.update(bit_md=round(bit_md, 1), ahead_m=round(ahead, 1), eta_h=round(ahead / rop, 2) if rop > 0.5 and ahead > 0 else None,
                 p_prior=round(p_prior, 3), p_live=None if p_live is None else round(p_live, 3), p_final=round(p_final, 3),
                 rule_reasons=reasons, model_reasons=(lv or {}).get("top", []), lookahead_m=round(look))
        a["message"] = self._message(a)
        if a["tier"] != prev:
            a["history"].append({"t": t, "bit_md": round(bit_md, 1), "tier": a["tier"]})
            return a
        return None

    @staticmethod
    def _message(a: dict) -> str:
        z = a["zone"]
        if a["tier"] is None:
            return f"{a['label']}: cleared."
        if a["live_only"]:
            return f"Live {a['label'].lower()} indicators without historical precedent at this depth: " + "; ".join(a["rule_reasons"][:2])
        wells = ", ".join(z["wells"][:4]) if z else ""
        rng = f"{z['md_from']:,.0f}-{z['md_to']:,.0f} m MD" if z else ""
        fm = f" ({z['formation_name']})" if z and z.get("formation_name") else ""
        if a["tier"] == "ADVISORY":
            eta = f", ~{a['eta_h']:.1f} h at current ROP" if a.get("eta_h") else ""
            return f"Approaching historical {a['label'].lower()} interval {rng}{fm}: {a['ahead_m']:.0f} m ahead{eta}. Seen in {wells}."
        if a["tier"] == "CAUTION":
            return f"In historical {a['label'].lower()} interval {rng}{fm}. Offset evidence: {wells}. Live data currently normal."
        live = "; ".join((a["rule_reasons"] or [])[:2]) or ", ".join(r["label"] for r in a["model_reasons"][:2])
        return f"{a['label']} precursors in historical interval {rng}{fm}: {live}. Consistent with offset experience in {wells}."
