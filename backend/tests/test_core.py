"""Unit tests for the correctness layer (run: python -m unittest discover -s tests)."""
import math
import unittest

import numpy as np

from nwis.core.trajectory import Trajectory, minimum_curvature
from nwis.core.units import normalise_depth, normalise_mud_weight
from nwis.ingest.extractor import detect_types, extract_from_page, find_depths, prepare_page_text
from nwis.engines.alerts import AlertEngine, fuse


class TestMinimumCurvature(unittest.TestCase):
    def test_vertical_well(self):
        tvd, n, e, dls = minimum_curvature([0, 1000, 2000], [0, 0, 0], [0, 0, 0])
        self.assertAlmostEqual(tvd[-1], 2000.0, places=6)
        self.assertAlmostEqual(n[-1], 0.0, places=6)

    def test_constant_inclination_hold(self):
        inc = 30.0
        tvd, n, e, _ = minimum_curvature([0, 500, 1000], [inc] * 3, [90] * 3)
        self.assertAlmostEqual(tvd[-1], 1000 * math.cos(math.radians(inc)), places=6)
        self.assertAlmostEqual(e[-1], 1000 * math.sin(math.radians(inc)), places=6)

    def test_circular_arc_build(self):
        # Build 0 -> 90 deg over an arc of length L: radius R = L / (pi/2); TVD = R, horizontal = R.
        L = 900.0
        md = np.linspace(0, L, 31)
        inc = np.linspace(0, 90, 31)
        tvd, n, e, _ = minimum_curvature(md, inc, np.zeros(31))
        R = L / (math.pi / 2)
        self.assertAlmostEqual(tvd[-1], R, places=3)
        self.assertAlmostEqual(n[-1], R, places=3)

    def test_interpolation_and_inverse(self):
        t = Trajectory(md=np.arange(0, 3001, 30.0), inc=np.clip((np.arange(0, 3001, 30.0) - 1000) / 30 * 2, 0, 25),
                       azi=np.full(101, 45.0), x0=0, y0=0, rkb_elev=120)
        for md in (512.3, 1234.5, 2777.7):
            tvd = t.tvd_at(md)
            self.assertAlmostEqual(t.md_at_tvd(tvd), md, places=2)
        self.assertAlmostEqual(t.tvdss_at(500.0), 500.0 - 120.0, places=6)


class TestUnits(unittest.TestCase):
    def test_depth_units(self):
        self.assertAlmostEqual(normalise_depth(9226, "ft")[0], 2812.08, places=2)
        v, inferred = normalise_depth(9226, None, td_m=3100)
        self.assertTrue(inferred)
        self.assertAlmostEqual(v, 2812.08, places=2)

    def test_mud_weight(self):
        self.assertAlmostEqual(normalise_mud_weight(10.8, "ppg")[0], 1.294, places=3)
        self.assertAlmostEqual(normalise_mud_weight(1.30, None)[0], 1.30)  # inferred SG
        self.assertAlmostEqual(normalise_mud_weight(10.8, None)[0], 1.294, places=3)  # inferred ppg


class TestExtraction(unittest.TestCase):
    def test_depth_parsing(self):
        d = find_depths("losses @ 2,812 m while drilling; later 9,226' and 2.951 m (OCR comma)")
        self.assertEqual([round(x["md"], 1) for x in d], [2812.0, round(9226 * 0.3048, 1), 2951.0])
        self.assertEqual(find_depths("pumped 40 bbl at 12 min, 1950 lpm, 1.32 SG"), [])

    def test_negation_and_fluid_loss(self):
        self.assertEqual(detect_types("No losses observed."), [])
        self.assertEqual(detect_types("Drilled ahead with full returns; no mud losses."), [])
        self.assertEqual(detect_types("Mud: KCl WBM MW 1.30 SG API fluid loss 5.2 ml"), [])
        self.assertEqual(detect_types("Drillstring became immobilised at 2,870 m; unable to rotate."), ["STUCK_PIPE"])
        self.assertEqual(detect_types("Losses during cementing of 7\" casing at 3,100 m"), ["CEMENTING_PROBLEM"])

    def test_event_extraction_with_provenance(self):
        raw = ("00:00-02:30 | 2.5 h | DRL   | Drilled 8 1/2\" hole from 2,780 m to 2,812 m.\n"
               "02:30-12:30 | 10.0 h | LOSS  | Observed partial losses @ 2,812 m while drilling in lower Tipam, avg 40 bbl/hr.\n"
               "                              Pumped 40 bbl LCM pill. Losses cured; regained full returns. NPT: 18.5 hrs.\n"
               "12:30-18:00 | 5.5 h | DRL   | Drilled ahead from 2,813 m to 2,840 m.")
        text = prepare_page_text(raw)
        evs = extract_from_page(text, 1, {"doc_id": "T", "well_id": "B", "doc_type": "DDR", "report_date": "2019-01-01"})
        self.assertEqual(len(evs), 1)
        e = evs[0]
        self.assertEqual(e["type"], "LOST_CIRCULATION")
        self.assertEqual(e["md_top"], 2812.0)
        self.assertEqual(e["formation_reported"], "TPM")
        self.assertEqual(e["subtype"], "partial")
        self.assertEqual(e["outcome"], "resolved")
        self.assertEqual(e["npt_h"], 18.5)
        self.assertIn("LCM_PILL", [m["action"] for m in e["mitigations"]])
        q = e["provenance"][0]
        self.assertIn(q["quote"], text)  # verbatim provenance


class TestAlerts(unittest.TestCase):
    def test_fusion_monotonic(self):
        self.assertLess(fuse(0.6, 0.05), 0.6)
        self.assertGreater(fuse(0.6, 0.95), 0.6)
        self.assertEqual(fuse(0.6, None), 0.6)

    def test_tiers_and_hysteresis(self):
        track = {"md": list(np.arange(0, 3000, 2.0)), "curves": {f: [0.0] * 1500 for f in ("LC", "SP", "OP", "TQ", "CM")},
                 "zones": [{"id": "LC-2800", "family": "LC", "label": "Mud loss", "md_from": 2800, "md_to": 2830, "peak": 0.9,
                            "peak_md": 2815, "formation": "TPM", "formation_name": "Tipam", "events": [], "wells": ["Well B"]}]}
        for i in range(1400, 1416):
            track["curves"]["LC"][i] = 0.9
        eng = AlertEngine()
        eng.step(0, 2720, 20, track, {}, {})
        self.assertEqual(eng.active()[0]["tier"], "ADVISORY")
        eng.step(10, 2805, 20, track, {}, {})
        self.assertEqual(eng.active()[0]["tier"], "CAUTION")
        live = {"LC": {"p": 0.9, "threshold": 0.6, "corroborated": True, "top": []}}
        for k in range(7):
            eng.step(20 + 10 * k, 2810, 20, track, live, {"LC": ["flow-out deficit"]})
        self.assertEqual(eng.active()[0]["tier"], "WARNING")
        eng.step(120, 2811, 20, track, {}, {})  # signal gone: hysteresis keeps WARNING for 5 minutes
        self.assertEqual(eng.active()[0]["tier"], "WARNING")
        eng.step(500, 2812, 20, track, {}, {})
        self.assertEqual(eng.active()[0]["tier"], "CAUTION")
        eng.step(900, 2845, 20, track, {}, {})  # zone passed -> cleared
        self.assertEqual(eng.active(), [])


if __name__ == "__main__":
    unittest.main()
