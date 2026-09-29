"""Field coordinates (metres east/north of a field origin) <-> WGS84 for map display.

A local tangent-plane approximation is accurate to a few metres across a 30 km field.
Production would use PROJ with an explicit source datum (e.g. Kalianpur 1975 -> WGS84 / UTM 46N).
"""
from __future__ import annotations

import math

from ..config import FIELD_ORIGIN_LATLON

EARTH_R = 6378137.0


def xy_to_latlon(x_east: float, y_north: float, origin=FIELD_ORIGIN_LATLON) -> tuple[float, float]:
    lat0, lon0 = origin
    lat = lat0 + math.degrees(y_north / EARTH_R)
    lon = lon0 + math.degrees(x_east / (EARTH_R * math.cos(math.radians(lat0))))
    return lat, lon


def distance_m(x1: float, y1: float, x2: float, y2: float) -> float:
    return math.hypot(x2 - x1, y2 - y1)
