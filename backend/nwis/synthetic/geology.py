"""Synthetic subsurface model (SYNTHETIC — for demonstration and ground-truth evaluation only).

* Formation tops are smooth surfaces with regional dip to the SE, an anticline along strike,
  thickness trends, and two NE-SW normal faults that split the field into compartments W / C / E.
* Namsang pinches out in compartment W and Tipam thins there, so a well that is close in map
  view but on the other side of the fault is geologically *less* relevant (PS 2.2).
"""
from __future__ import annotations

import math

from ..core.taxonomy import FORMATIONS

FIELD_NAME = "Synthetic Upper-Assam-style Field (demo data)"
FIELD_HALF_X = 15000.0  # m east-west half extent
FIELD_HALF_Y = 10000.0  # m north-south half extent

# Unit normal to strike, pointing SE (east, north).
_NORMAL = (math.sin(math.radians(135.0)), math.cos(math.radians(135.0)))
_STRIKE = (math.sin(math.radians(45.0)), math.cos(math.radians(45.0)))

# (signed distance along normal where the fault sits, throw in m, downthrown to SE)
FAULTS = [(-1500.0, 45.0), (4000.0, 80.0)]

# Thickness at the field origin (m). Alluvium thickness is implied by DHK top at ~300 m TVDSS.
THICKNESS0 = {"DHK": 650.0, "NMS": 380.0, "GRJ": 700.0, "TPM": 570.0, "BRL": 530.0, "KPL": 220.0, "SLT": 260.0, "LGP": 120.0}
DHK_TOP0 = 300.0


def along_normal(x: float, y: float) -> float:
    return _NORMAL[0] * x + _NORMAL[1] * y


def along_strike(x: float, y: float) -> float:
    return _STRIKE[0] * x + _STRIKE[1] * y


def compartment(x: float, y: float) -> str:
    s = along_normal(x, y)
    if s < FAULTS[0][0]:
        return "W"
    if s < FAULTS[1][0]:
        return "C"
    return "E"


def ground_elevation(x: float, y: float) -> float:
    return 110.0 + 12.0 * math.sin(x / 7000.0) + 8.0 * math.cos(y / 5000.0)


def _structure(x: float, y: float) -> float:
    """Structural relief (m, positive = deeper) at reference depth 2600 m."""
    s, t = along_normal(x, y), along_strike(x, y)
    return 0.012 * s - 80.0 * math.exp(-((s / 5000.0) ** 2)) + 25.0 * math.sin(t / 4000.0)


def _thickness(code: str, x: float, y: float) -> float:
    s, t = along_normal(x, y), along_strike(x, y)
    phase = {"DHK": 0.3, "NMS": 1.1, "GRJ": 2.0, "TPM": 2.9, "BRL": 3.7, "KPL": 4.4, "SLT": 5.1, "LGP": 5.9}[code]
    th = THICKNESS0[code] * (1.0 + 0.07 * math.sin(t / 5000.0 + phase) + 0.05 * s / 15000.0)
    comp = compartment(x, y)
    if code == "NMS" and comp == "W":
        th = 0.0  # Namsang is absent (pinched out) in compartment W
    if code == "TPM" and comp == "W":
        th *= 0.70
    return th


def formation_tops_tvdss(x: float, y: float) -> dict[str, float]:
    """Top of every formation (TVDSS m, positive down) at map location (x, y)."""
    ground = ground_elevation(x, y)
    struct = _structure(x, y)
    s = along_normal(x, y)
    throw = sum(t for (pos, t) in FAULTS if s > pos)
    tops: dict[str, float] = {"ALV": -ground}
    depth = DHK_TOP0
    for f in FORMATIONS[1:]:
        scale = min(1.0, depth / 2600.0)
        faulted = throw if f.order >= 2 else 0.0
        tops[f.code] = depth + struct * scale + faulted
        if f.code in THICKNESS0:
            depth += _thickness(f.code, x, y)
    # Enforce monotonic order (a pinched-out formation has zero thickness).
    prev = tops["ALV"]
    for f in FORMATIONS[1:]:
        tops[f.code] = max(tops[f.code], prev)
        prev = tops[f.code]
    return tops
