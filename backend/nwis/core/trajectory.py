"""Wellbore trajectory maths: Minimum Curvature Method (industry standard).

Conventions
-----------
* MD   measured depth along hole from RKB (m)
* TVD  true vertical depth below RKB (m)
* TVDSS true vertical depth below mean sea level, positive downwards (m) = TVD - RKB elevation
* north/east are offsets from the wellhead (m); x/y are absolute field coordinates (m).
"""
from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np


def minimum_curvature(md, inc_deg, azi_deg):
    """Return (tvd, north, east, dls_deg_per_30m) arrays for survey stations."""
    md = np.asarray(md, dtype=float)
    inc = np.radians(np.asarray(inc_deg, dtype=float))
    azi = np.radians(np.asarray(azi_deg, dtype=float))
    n = len(md)
    tvd = np.zeros(n)
    north = np.zeros(n)
    east = np.zeros(n)
    dls = np.zeros(n)
    for k in range(1, n):
        dmd = md[k] - md[k - 1]
        i1, i2, a1, a2 = inc[k - 1], inc[k], azi[k - 1], azi[k]
        cos_beta = np.cos(i2 - i1) - np.sin(i1) * np.sin(i2) * (1.0 - np.cos(a2 - a1))
        beta = float(np.arccos(np.clip(cos_beta, -1.0, 1.0)))
        rf = 1.0 if beta < 1e-7 else (2.0 / beta) * np.tan(beta / 2.0)
        half = dmd / 2.0 * rf
        tvd[k] = tvd[k - 1] + half * (np.cos(i1) + np.cos(i2))
        north[k] = north[k - 1] + half * (np.sin(i1) * np.cos(a1) + np.sin(i2) * np.cos(a2))
        east[k] = east[k - 1] + half * (np.sin(i1) * np.sin(a1) + np.sin(i2) * np.sin(a2))
        dls[k] = np.degrees(beta) * 30.0 / dmd if dmd > 0 else 0.0
    return tvd, north, east, dls


def _tangent(inc: float, azi: float) -> np.ndarray:
    """Unit tangent as (north, east, down)."""
    return np.array([np.sin(inc) * np.cos(azi), np.sin(inc) * np.sin(azi), np.cos(inc)])


@dataclass
class Trajectory:
    md: np.ndarray
    inc: np.ndarray  # degrees
    azi: np.ndarray  # degrees
    x0: float  # wellhead east (m, field coords)
    y0: float  # wellhead north (m, field coords)
    rkb_elev: float  # RKB elevation above MSL (m)
    tvd: np.ndarray = field(init=False)
    north: np.ndarray = field(init=False)
    east: np.ndarray = field(init=False)
    dls: np.ndarray = field(init=False)

    def __post_init__(self):
        self.md = np.asarray(self.md, dtype=float)
        self.inc = np.asarray(self.inc, dtype=float)
        self.azi = np.asarray(self.azi, dtype=float)
        self.tvd, self.north, self.east, self.dls = minimum_curvature(self.md, self.inc, self.azi)

    @property
    def td(self) -> float:
        return float(self.md[-1])

    def position_at(self, md: float) -> tuple[float, float, float]:
        """Exact position (tvd, north, east) at any MD by interpolating along the circular arc."""
        md = float(np.clip(md, self.md[0], self.md[-1]))
        k = int(np.searchsorted(self.md, md, side="right")) - 1
        k = min(max(k, 0), len(self.md) - 2)
        dmd_full = self.md[k + 1] - self.md[k]
        s = 0.0 if dmd_full <= 0 else (md - self.md[k]) / dmd_full
        i1, i2 = np.radians(self.inc[k]), np.radians(self.inc[k + 1])
        a1, a2 = np.radians(self.azi[k]), np.radians(self.azi[k + 1])
        t1, t2 = _tangent(i1, a1), _tangent(i2, a2)
        beta = float(np.arccos(np.clip(np.dot(t1, t2), -1.0, 1.0)))
        if beta < 1e-7:
            ts = t1
            sub_beta = 0.0
        else:
            ts = (np.sin((1 - s) * beta) * t1 + np.sin(s * beta) * t2) / np.sin(beta)
            sub_beta = s * beta
        rf = 1.0 if sub_beta < 1e-7 else (2.0 / sub_beta) * np.tan(sub_beta / 2.0)
        d = (md - self.md[k]) / 2.0 * rf * (t1 + ts)
        return (float(self.tvd[k] + d[2]), float(self.north[k] + d[0]), float(self.east[k] + d[1]))

    def tvd_at(self, md: float) -> float:
        return self.position_at(md)[0]

    def tvdss_at(self, md: float) -> float:
        return self.tvd_at(md) - self.rkb_elev

    def xy_at(self, md: float) -> tuple[float, float]:
        _, n, e = self.position_at(md)
        return self.x0 + e, self.y0 + n

    def inc_at(self, md: float) -> float:
        return float(np.interp(md, self.md, self.inc))

    def md_at_tvd(self, tvd: float) -> float:
        """Inverse of tvd_at (TVD is monotonic for inclinations < 90 deg)."""
        if tvd <= self.tvd[0]:
            return float(self.md[0])
        if tvd >= self.tvd[-1]:
            # Extrapolate along final tangent (used for planned depths beyond survey).
            cos_i = max(np.cos(np.radians(self.inc[-1])), 1e-3)
            return float(self.md[-1] + (tvd - self.tvd[-1]) / cos_i)
        k = int(np.searchsorted(self.tvd, tvd, side="right")) - 1
        lo, hi = float(self.md[k]), float(self.md[k + 1])
        for _ in range(40):
            mid = (lo + hi) / 2
            if self.tvd_at(mid) < tvd:
                lo = mid
            else:
                hi = mid
        return (lo + hi) / 2

    def md_at_tvdss(self, tvdss: float) -> float:
        return self.md_at_tvd(tvdss + self.rkb_elev)

    def sample_xyz(self, md_from: float, md_to: float, step: float = 15.0) -> np.ndarray:
        """Absolute (x, y, tvdss) points between two MDs."""
        md_from, md_to = max(md_from, 0.0), min(md_to, self.td)
        if md_to <= md_from:
            return np.zeros((0, 3))
        mds = np.arange(md_from, md_to + 1e-6, step)
        if mds[-1] < md_to:
            mds = np.append(mds, md_to)
        pts = []
        for m in mds:
            tvd, n, e = self.position_at(m)
            pts.append((self.x0 + e, self.y0 + n, tvd - self.rkb_elev))
        return np.asarray(pts)

    def to_dict(self) -> dict:
        return {
            "md": self.md.round(2).tolist(),
            "inc": self.inc.round(3).tolist(),
            "azi": self.azi.round(3).tolist(),
            "x0": self.x0,
            "y0": self.y0,
            "rkb_elev": self.rkb_elev,
        }

    @classmethod
    def from_dict(cls, d: dict) -> "Trajectory":
        return cls(md=d["md"], inc=d["inc"], azi=d["azi"], x0=d["x0"], y0=d["y0"], rkb_elev=d["rkb_elev"])


def min_distance(a: np.ndarray, b: np.ndarray) -> float:
    """Minimum 3D distance between two point clouds (N,3) and (M,3)."""
    if len(a) == 0 or len(b) == 0:
        return float("inf")
    diff = a[:, None, :] - b[None, :, :]
    return float(np.sqrt((diff**2).sum(axis=2)).min())
