"""Real-time precursor detection on eRTMAC-style drilling data.

Tier 1 - transparent rules (always on, no training data needed) with human-readable reasons.
Tier 2 - logistic models per risk family on physics-informed features. Linear models give exact,
         additive per-feature contributions (the explanation shown to the engineer). Validation is
         grouped by well (no leakage between neighbouring samples of the same well).

The same FeatureState class is used for training and for the live feed, so features are identical.
"""
from __future__ import annotations

import json
import math
from collections import deque

import numpy as np

from .. import config

FEATURES = ["dflow", "pit_slope", "spp_dev", "tq_z", "tq_ssi", "rop_ratio", "gas_ratio", "gas_level", "overpull", "dxc_ratio"]
FEATURE_LABELS = {
    "dflow": "Flow-out vs flow-in", "pit_slope": "Pit volume trend", "spp_dev": "Standpipe pressure deviation",
    "tq_z": "Torque vs baseline", "tq_ssi": "Stick-slip index", "rop_ratio": "ROP vs baseline", "gas_ratio": "Gas vs background",
    "gas_level": "Total gas", "overpull": "Overpull on pick-up", "dxc_ratio": "Corrected d-exponent trend",
}
MODEL_FAMILIES = ["LC", "SP", "OP", "TQ"]
WINDOW = 180  # 30 min at 10 s


def _slope(y: np.ndarray, dt_min: float) -> float:
    if len(y) < 6:
        return 0.0
    x = np.arange(len(y)) * dt_min
    x = x - x.mean()
    return float((x * (y - y.mean())).sum() / max((x * x).sum(), 1e-9))


class FeatureState:
    def __init__(self, step_s: float = 10.0, bit_in: float = 8.5):
        self.step_min = step_s / 60.0
        self.bit_in = bit_in
        self.buf: deque = deque(maxlen=WINDOW)
        self.conn_max: list[float] = []
        self._cur_conn_max = None
        self._last_on_bottom = 1
        self.overpull = 0.0

    def update(self, r: dict) -> dict:
        on = int(r["on_bottom"])
        pumping = r["flow_in"] > 500
        # Connection tracking for overpull (pick-up hookload vs previous stands).
        if not on:
            hl = r["hookload"]
            self._cur_conn_max = hl if self._cur_conn_max is None else max(self._cur_conn_max, hl)
        elif self._last_on_bottom == 0 and self._cur_conn_max is not None:
            if len(self.conn_max) >= 2:
                self.overpull = max(0.0, self._cur_conn_max - float(np.median(self.conn_max[-4:])))
            self.conn_max.append(self._cur_conn_max)
            self._cur_conn_max = None
        self._last_on_bottom = on
        rop, wob, rpm = max(r["rop"], 0.1), max(r["wob"], 0.5), max(r["rpm"], 1.0)
        dxc = None
        if on and pumping:
            try:
                d = math.log10((rop / 0.3048) / (60 * rpm)) / math.log10(12 * wob * 2204.6 / (1e6 * self.bit_in))
                dxc = d * (1.03 / max(r["ecd"], 0.9))
            except ValueError:
                dxc = None
        self.buf.append({**r, "pumping": pumping, "dxc": dxc})
        return self.features()

    def features(self) -> dict:
        b = list(self.buf)
        pumped = [x for x in b if x["pumping"]]
        drilling = [x for x in b if x["pumping"] and x["on_bottom"]]
        f = {k: 0.0 for k in FEATURES}
        f["rop_ratio"] = f["gas_ratio"] = f["dxc_ratio"] = 1.0
        if len(pumped) >= 6:
            last = pumped[-12:]
            f["dflow"] = float(np.mean([(x["flow_out"] - x["flow_in"]) / x["flow_in"] for x in last]))
            f["pit_slope"] = _slope(np.array([x["pit"] for x in pumped[-30:]]), self.step_min)
            spp_med = float(np.median([x["spp"] for x in pumped]))
            f["spp_dev"] = (float(np.mean([x["spp"] for x in pumped[-6:]])) - spp_med) / max(spp_med, 1.0)
        if len(drilling) >= 12:
            tq = np.array([x["torque"] for x in drilling])
            recent = tq[-12:]
            f["tq_z"] = (float(recent.mean()) - float(tq.mean())) / max(float(tq.std()), 0.3)
            f["tq_ssi"] = float((recent.max() - recent.min()) / max(recent.mean(), 0.5))
            rops = np.array([x["rop"] for x in drilling])
            f["rop_ratio"] = float(rops[-12:].mean() / max(np.median(rops), 0.5))
            dx = [x["dxc"] for x in drilling if x["dxc"] is not None]
            if len(dx) >= 12:
                f["dxc_ratio"] = float(np.mean(dx[-12:]) / max(np.median(dx), 1e-3))
        if len(b) >= 6:
            gas = np.array([x["gas"] for x in b])
            f["gas_level"] = float(gas[-12:].mean())
            f["gas_ratio"] = float(gas[-12:].mean() / max(np.median(gas), 0.2))
        f["overpull"] = self.overpull
        return f


# ------------------------------------------------------------------------------------ Tier 1
def rules(f: dict, pumping: bool) -> dict[str, list[str]]:
    fired: dict[str, list[str]] = {}
    if pumping:
        if f["dflow"] < -0.07:
            fired.setdefault("LC", []).append(f"Flow-out {abs(f['dflow']) * 100:.0f}% below flow-in (2-min mean)")
        if f["pit_slope"] < -0.12 and f["dflow"] < -0.03:
            fired.setdefault("LC", []).append(f"Pit volume falling {abs(f['pit_slope']):.2f} m3/min with return deficit")
        if f["dflow"] > 0.05 and f["pit_slope"] > 0.08:
            fired.setdefault("OP", []).append(f"Flow-out {f['dflow'] * 100:.0f}% above flow-in and pit gain {f['pit_slope']:.2f} m3/min")
    if f["gas_ratio"] > 3.0 and f["gas_level"] > 4.0:
        fired.setdefault("OP", []).append(f"Total gas {f['gas_level']:.1f}% ({f['gas_ratio']:.1f}x background)")
    if f["rop_ratio"] > 2.0 and f["gas_ratio"] > 1.8:
        fired.setdefault("OP", []).append(f"Drilling break (ROP {f['rop_ratio']:.1f}x baseline) with rising gas")
    if f["overpull"] > 15:
        fired.setdefault("SP", []).append(f"Overpull {f['overpull']:.0f} t above previous stands on pick-up")
    if f["tq_z"] > 3.0:
        fired.setdefault("SP", []).append(f"Torque {f['tq_z']:.1f} sigma above 30-min baseline")
    if f["tq_ssi"] > 0.6 and f["rop_ratio"] < 0.7:
        fired.setdefault("SP", []).append(f"Erratic torque (stick-slip index {f['tq_ssi']:.2f}) with ROP loss")
    if f["tq_ssi"] > 0.8:
        fired.setdefault("TQ", []).append(f"Stick-slip index {f['tq_ssi']:.2f}")
    return fired


def corroborated(fam: str, f: dict) -> bool:
    """Physics gate: a model alarm must be backed by the signal family that defines the hazard
    (e.g. overpressure needs gas or flow evidence, not a drilling break alone)."""
    if fam == "LC":
        return bool(f["dflow"] < -0.03 or f["pit_slope"] < -0.05)
    if fam == "OP":
        return bool(f["gas_ratio"] > 1.5 or f["dflow"] > 0.02 or f["pit_slope"] > 0.05)
    if fam == "SP":
        return bool(f["tq_z"] > 1.5 or f["overpull"] > 8 or f["tq_ssi"] > 0.3)
    if fam == "TQ":
        return bool(f["tq_ssi"] > 0.4 or f["tq_z"] > 2.0)
    return True


# ------------------------------------------------------------------------------------ Tier 2
class PrecursorModel:
    def __init__(self, params: dict):
        self.params = params

    @classmethod
    def load(cls) -> "PrecursorModel | None":
        p = config.MODELS_DIR / "precursor_models.json"
        return cls(json.loads(p.read_text())) if p.exists() else None

    def predict(self, f: dict) -> dict[str, dict]:
        out = {}
        x = np.array([f[k] for k in FEATURES])
        for fam, m in self.params["families"].items():
            z = (x - np.array(m["mean"])) / np.array(m["std"])
            contrib = np.array(m["coef"]) * z
            logit = float(contrib.sum() + m["intercept"])
            p = 1.0 / (1.0 + math.exp(-max(min(logit, 30), -30)))
            top = sorted(zip(FEATURES, contrib), key=lambda t: -t[1])[:3]
            out[fam] = {"p": p, "threshold": m["threshold"], "corroborated": corroborated(fam, f),
                        "top": [{"feature": k, "label": FEATURE_LABELS[k], "contribution": round(float(c), 2), "value": round(float(f[k]), 3)}
                                for k, c in top if c > 0.2]}
        return out


def _segments_features(arrs: dict, meta: list[dict]) -> tuple[np.ndarray, np.ndarray, np.ndarray, np.ndarray]:
    """Replay every training segment through FeatureState. Returns X, segment id, time, md."""
    X, seg_ids, ts, mds = [], [], [], []
    seg = arrs["segment"].astype(int)
    keys = ["t", "bit_md", "hole_md", "rop", "wob", "rpm", "torque", "hookload", "spp", "flow_in", "flow_out", "pit", "mw", "ecd", "gas",
            "on_bottom"]
    for m in meta:
        idx = np.where(seg == m["segment"])[0]
        fs = FeatureState()
        for i in idx:
            r = {k: float(arrs[k][i]) for k in keys}
            f = fs.update(r)
            X.append([f[k] for k in FEATURES])
            seg_ids.append(m["segment"])
            ts.append(r["t"])
            mds.append(r["hole_md"])
    return np.array(X), np.array(seg_ids), np.array(ts), np.array(mds)


def _labels(meta: list[dict], seg_ids: np.ndarray, ts: np.ndarray, mds: np.ndarray, fam: str) -> np.ndarray:
    y = np.zeros(len(seg_ids), dtype=int)
    for m in meta:
        if m["kind"] != fam or m["t_onset"] is None:
            continue
        sel = seg_ids == m["segment"]
        if fam == "SP":
            start_md = m["md_onset"] - m.get("precursor_m", 5)
            y[sel & (mds >= start_md) & (ts <= m["t_onset"] + 600)] = 1
        else:
            y[sel & (ts >= m["t_onset"]) & (ts <= m["t_onset"] + 1800)] = 1
    return y


def train(verbose: bool = True) -> dict:
    """Train Tier-2 models, validate grouped by well, save parameters + validation report."""
    from sklearn.linear_model import LogisticRegression
    from sklearn.metrics import roc_auc_score
    from sklearn.model_selection import GroupKFold

    arrs = dict(np.load(config.TIMESERIES_DIR / "training_segments.npz"))
    meta = json.loads((config.TIMESERIES_DIR / "training_segments.json").read_text())
    X, seg_ids, ts, mds = _segments_features(arrs, meta)
    wells = np.array([meta[s]["well_id"] for s in seg_ids])
    params = {"features": FEATURES, "families": {}}
    report = {}
    gkf = GroupKFold(n_splits=5)
    for fam in MODEL_FAMILIES:
        y = _labels(meta, seg_ids, ts, mds, fam)
        if y.sum() < 20:
            continue
        oof = np.zeros(len(y))
        for tr, te in gkf.split(X, y, groups=wells):
            mu, sd = X[tr].mean(0), X[tr].std(0) + 1e-6
            clf = LogisticRegression(C=0.5, class_weight="balanced", max_iter=2000)
            clf.fit((X[tr] - mu) / sd, y[tr])
            oof[te] = clf.predict_proba((X[te] - mu) / sd)[:, 1]
        # Threshold: lowest value keeping false alarms <= 2 per 24 h of drilling without this event.
        cands = np.arange(0.5, 0.995, 0.01)
        fas = [_false_alarms_per_day(oof, y, seg_ids, meta, fam, c) for c in cands]
        ok = [c for c, fa in zip(cands, fas) if fa <= 2.0]
        thr = float(ok[0]) if ok else float(cands[int(np.argmin(fas))])
        ev_rec, leads = _event_recall(oof, seg_ids, ts, mds, meta, fam, thr)
        report[fam] = {"auc_grouped_cv": round(float(roc_auc_score(y, oof)), 3), "threshold": round(thr, 2),
                       "event_recall": round(ev_rec, 3), "median_lead_min": round(float(np.median(leads)), 1) if leads else None,
                       "false_alarms_per_24h": round(_false_alarms_per_day(oof, y, seg_ids, meta, fam, thr), 2),
                       "n_positive_samples": int(y.sum()), "n_samples": int(len(y)),
                       "n_events": sum(1 for m in meta if m["kind"] == fam)}
        mu, sd = X.mean(0), X.std(0) + 1e-6
        clf = LogisticRegression(C=0.5, class_weight="balanced", max_iter=2000).fit((X - mu) / sd, y)
        params["families"][fam] = {"coef": clf.coef_[0].tolist(), "intercept": float(clf.intercept_[0]), "mean": mu.tolist(),
                                   "std": sd.tolist(), "threshold": thr}
    # Tier-1 rules evaluated on the same data for comparison.
    rules_report = _rules_report(X, seg_ids, ts, mds, meta)
    config.MODELS_DIR.mkdir(parents=True, exist_ok=True)
    (config.MODELS_DIR / "precursor_models.json").write_text(json.dumps(params, indent=1))
    out = {"tier2_logistic": report, "tier1_rules": rules_report, "validation": "GroupKFold(5) by well - no well appears in both train and test",
           "alarm_definition": "episode = >=2 consecutive samples above threshold; false alarms counted on drilling without that event"}
    (config.MODELS_DIR / "precursor_report.json").write_text(json.dumps(out, indent=1))
    if verbose:
        print("[precursors]", json.dumps(out, indent=1))
    return out


def _alarm_episodes(flags: np.ndarray, ts: np.ndarray) -> list[float]:
    """Start times of alarm episodes (rising edges; min 2 consecutive samples)."""
    starts = []
    run = 0
    for i, f in enumerate(flags):
        run = run + 1 if f else 0
        if run == 2:
            starts.append(ts[i])
    return starts


CONFUSABLE = {"SP": {"TQ"}, "TQ": {"SP"}}  # torque-driven families legitimately overlap


def _false_alarms_per_day(p, y, seg_ids, meta, fam, thr) -> float:
    hours, n = 0.0, 0
    for m in meta:
        sel = seg_ids == m["segment"]
        if m["kind"] == fam or m["kind"] in CONFUSABLE.get(fam, set()):
            continue
        flags = (p[sel] >= thr)
        hours += sel.sum() * 10 / 3600
        n += len(_alarm_episodes(flags, np.arange(sel.sum())))
    return n / max(hours, 1e-6) * 24


def _event_recall(p, seg_ids, ts, mds, meta, fam, thr) -> tuple[float, list[float]]:
    hit, total, leads = 0, 0, []
    for m in meta:
        if m["kind"] != fam or m["t_onset"] is None:
            continue
        total += 1
        sel = seg_ids == m["segment"]
        starts = _alarm_episodes(p[sel] >= thr, ts[sel])
        declared = m["t_onset"] + (0 if fam == "SP" else 600)  # crew typically declares ~10 min after onset
        ok = [s for s in starts if s <= declared + 600 and s >= m["t_onset"] - 3600]
        if ok:
            hit += 1
            leads.append((declared - ok[0]) / 60.0)
    return hit / max(total, 1), leads


def _rules_report(X, seg_ids, ts, mds, meta) -> dict:
    out = {}
    for fam in MODEL_FAMILIES:
        flags = np.array([fam in rules(dict(zip(FEATURES, row)), True) for row in X]).astype(float)
        rec, leads = _event_recall(flags, seg_ids, ts, mds, meta, fam, 0.5)
        fa = _false_alarms_per_day(flags, None, seg_ids, meta, fam, 0.5)
        out[fam] = {"event_recall": round(rec, 3), "median_lead_min": round(float(np.median(leads)), 1) if leads else None,
                    "false_alarms_per_24h": round(fa, 2)}
    return out


if __name__ == "__main__":
    train()
