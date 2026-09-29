"""Unit handling. Internal system is SI: metres, g/cm3 (SG), kPa, m3, kN.

Raw values and raw units are always kept by callers next to normalised values.
"""
from __future__ import annotations

FT_TO_M = 0.3048
PPG_TO_SG = 0.119826
PSI_TO_KPA = 6.894757
BBL_TO_M3 = 0.158987
KLBF_TO_KN = 4.44822
TONNE_F_TO_KN = 9.80665

METRE_UNITS = {"m", "mt", "mts", "mtr", "mtrs", "metre", "metres", "meter", "meters", "mmd", "m md"}
FEET_UNITS = {"ft", "feet", "foot", "'", "fbrt"}


def ft_to_m(value: float) -> float:
    return value * FT_TO_M


def m_to_ft(value: float) -> float:
    return value / FT_TO_M


def ppg_to_sg(value: float) -> float:
    return value * PPG_TO_SG


def sg_to_ppg(value: float) -> float:
    return value / PPG_TO_SG


def bbl_to_m3(value: float) -> float:
    return value * BBL_TO_M3


def normalise_depth(value: float, unit: str | None, td_m: float | None = None) -> tuple[float, bool]:
    """Return (depth_m, unit_inferred)."""
    u = (unit or "").strip().lower()
    if u in FEET_UNITS:
        return value * FT_TO_M, False
    if u in METRE_UNITS:
        return value, False
    # Unlabelled: a number far beyond TD that fits TD once read as feet is feet.
    if td_m and value > td_m * 1.15 and value * FT_TO_M <= td_m * 1.05:
        return value * FT_TO_M, True
    return value, True


def normalise_mud_weight(value: float, unit: str | None) -> tuple[float | None, bool]:
    """Return (mud weight in SG, unit_inferred). Plausibility-based inference when unlabelled."""
    u = (unit or "").strip().lower().replace(" ", "")
    if u in {"ppg", "lb/gal", "lbs/gal"}:
        return value * PPG_TO_SG, False
    if u in {"sg", "s.g.", "s.g", "g/cc", "g/cm3", "gcc", "gm/cc"}:
        return value, False
    if 0.8 <= value <= 2.6:
        return value, True
    if 6.5 <= value <= 22.0:
        return value * PPG_TO_SG, True
    return None, True


def normalise_rate_m3ph(value: float, unit: str) -> float:
    """Loss / flow rates to m3/h."""
    u = unit.lower().replace(" ", "")
    if u.startswith("bbl") or u == "bph":
        return value * BBL_TO_M3
    return value
