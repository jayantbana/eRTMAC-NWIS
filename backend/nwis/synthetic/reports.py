"""Synthetic report generator: Daily Drilling Reports (DDR) and Well Completion Reports (WCR).

Reports deliberately vary terminology ("stuck pipe" / "drillstring became immobilised"),
units (m / ft, SG / ppg), include negated statements ("No losses observed") and page breaks,
and a share are rendered as noisy *scanned images* without a text layer, so the ingestion
pipeline has to OCR them. All documents are watermarked SYNTHETIC.
"""
from __future__ import annotations

import datetime as dt
import textwrap
from pathlib import Path

import numpy as np
from fpdf import FPDF
from PIL import Image, ImageDraw, ImageFilter, ImageFont

from ..core.taxonomy import FORMATION_BY_CODE
from ..core.units import m_to_ft, sg_to_ppg
from .geology import FIELD_NAME

WRAP = 100
LINES_PER_PAGE = 58
WATERMARK = "SYNTHETIC DEMO DATA - generated for SIH PS26121 prototype, not real OIL records"


# ------------------------------------------------------------------------------------------
# Formatting helpers
# ------------------------------------------------------------------------------------------
class Fmt:
    def __init__(self, rng: np.random.Generator, units: str):
        self.rng = rng
        self.units = units  # "m" or "ft"

    def pick(self, options):
        return options[int(self.rng.integers(0, len(options)))]

    def d(self, md_m: float) -> str:
        if self.units == "ft":
            v = m_to_ft(md_m)
            return self.pick([f"{v:,.0f} ft", f"{v:.0f} ft", f"{v:,.0f}'"])
        return self.pick([f"{md_m:,.0f} m", f"{md_m:.0f}m", f"{md_m:,.0f} mtrs", f"{md_m:,.0f} m MD"])

    def mw(self, sg: float) -> str:
        if self.units == "ft":
            return f"{sg_to_ppg(sg):.1f} ppg"
        return f"{sg:.2f} SG"

    def rate(self, bph: float) -> str:
        if self.units == "m" and self.rng.uniform() < 0.3:
            return f"{bph * 0.158987:.1f} m3/hr"
        return self.pick([f"{bph:.0f} bbl/hr", f"{bph:.0f} bbls/hr"])

    def fm(self, code: str | None, fpos: float | None, p: float) -> str:
        if code is None or self.rng.uniform() > p:
            return ""
        f = FORMATION_BY_CODE[code]
        alias = self.pick(list(f.aliases[:2]) + [f.name])
        alias = alias.title() if alias.islower() else alias
        prefix = ""
        if fpos is not None and code in ("TPM", "BRL") and self.rng.uniform() < 0.5:
            prefix = "lower " if fpos > 0.66 else ("upper " if fpos < 0.33 else "")
        return f" in {prefix}{alias}" if self.rng.uniform() < 0.8 else f" ({prefix}{alias})"


# ------------------------------------------------------------------------------------------
# Event narration
# ------------------------------------------------------------------------------------------
def narrate(ev: dict, rng: np.random.Generator, units: str, style: str) -> list[str]:
    F = Fmt(rng, units)
    P = ev["params"]
    D = F.d(ev["md"])
    FM = F.fm(ev.get("formation"), ev.get("f_pos"), 0.9 if style == "wcr" else 0.7)
    acts = [m["action"] for m in ev["mitigations"]]
    out: list[str] = []
    t = ev["type"]
    oc = ev["outcome"]
    npt = ev["npt_h"]
    mwu = F.mw(ev["mw_sg"]).split()[-1]

    def mwv(sg):
        return F.mw(sg).split()[0]

    if t == "LOST_CIRCULATION":
        sub = P["subtype"]
        R = F.rate(P["rate_bph"])
        if sub == "total":
            out.append(F.pick([f"Lost total returns at {D}{FM} while drilling.", f"No returns observed at {D}{FM}; total losses.",
                               f"Complete loss of circulation at {D}{FM}."]))
        elif style == "wcr" and rng.uniform() < 0.5:
            out.append(f"{sub.capitalize()} lost circulation was encountered at {D}{FM} while drilling the {ev['hole']} hole "
                       f"(loss rate about {R}).")
        else:
            out.append(F.pick([f"Observed {sub} losses @ {D} while drilling{FM}, avg {R}.",
                               f"While drilling at {D}{FM} encountered {sub} mud losses ({R}).",
                               f"Losses to formation noticed at {D}{FM}; returns dropped to {P['returns_pct']}% ({R}).",
                               f"{sub.capitalize()} loss of circulation at {D}{FM}, loss rate {R}."]))
        for a in acts:
            if a == "REDUCE_FLOW_ECD":
                out.append(F.pick([f"Reduced flow rate from {P['q1']} to {P['q2']} lpm to lower ECD.",
                                   f"Cut pump rate to {P['q2']} lpm to reduce ECD."]))
            elif a == "LCM_PILL":
                out.append(F.pick([f"Pumped {P['lcm_bbl']} bbl LCM pill (CaCO3 M/F {P['lcm_ppb']} ppb) and spotted across loss zone.",
                                   f"Spotted {P['lcm_bbl']} bbl fibrous and sized CaCO3 LCM pill ({P['lcm_ppb']} ppb)."]))
            elif a == "REDUCE_MW":
                out.append(f"Reduced MW from {mwv(ev['mw_sg'])} to {mwv(ev['mw_sg'] - 0.02)} {mwu}.")
        if oc == "resolved":
            out.append(F.pick(["Losses cured; regained full returns.", f"Full returns established after {max(2, int(npt * 0.6))} hrs."]))
        elif oc == "partial":
            out.append("Losses reduced to seepage; continued drilling with seepage losses.")
        else:
            out.append("Losses could not be cured with LCM.")
            out.append("Set cement plug across the loss zone and drilled out.")
    elif t == "STUCK_PIPE":
        if P["subtype"] == "differential":
            out.append(F.pick([f"String became differentially stuck at {D}{FM} after {P['stationary_min']} min stationary during connection.",
                               f"Pipe got stuck at {D}{FM} while making connection (suspected differential sticking)."]))
        else:
            out.append(F.pick([f"Drillstring became immobilised at {D}{FM}; unable to rotate or reciprocate.",
                               f"Stuck pipe incident at {D}{FM}; pack-off in coal-shale suspected."]))
        if rng.uniform() < 0.5:
            out.append(f"Worked string with {P['overpull_t']} t overpull without success.")
        for a in acts:
            if a == "JARRING":
                out.append(F.pick([f"Jarred down with {P['blows']} blows.", "Worked the string and jarred up and down."]))
            elif a == "SPOTTING_PILL":
                out.append(f"Spotted {P['pill_bbl']} bbl pipe-lax pill and soaked for {P['soak_h']} hrs.")
            elif a == "CIRCULATE_SWEEP":
                out.append(F.pick(["Established circulation and pumped hi-vis sweep to clean hole.",
                                   "Circulated bottoms up with hi-vis pill."]))
        if oc in ("resolved", "partial"):
            out.append(F.pick([f"Pipe freed after {max(3, int(npt * 0.7))} hrs.", "String came free; resumed operations."]))
        else:
            out.append("Unable to free the string.")
            out.append("Backed off the string; fishing attempts unsuccessful.")
            out.append(f"Decision taken to sidetrack the well from {F.d(ev['md'] - 150)}.")
    elif t == "TIGHT_HOLE":
        op = P["overpull_t"]
        out.append(F.pick([f"Tight hole observed at {D}{FM} with {op} t overpull.",
                           f"Encountered tight spot at {D}{FM} while POOH ({op} t overpull).",
                           f"Excessive drag ({op} t overpull) at {D}{FM}."]))
        for a in acts:
            if a == "BACKREAM_WIPER":
                out.append(F.pick(["Back-reamed through the tight section.", "Performed wiper trip and reamed the interval."]))
            elif a == "INHIBITIVE_MUD":
                out.append(f"Increased KCl concentration in the mud system to {int(rng.uniform(5, 8))}%.")
            elif a == "RAISE_MW":
                out.append(f"Raised MW from {mwv(ev['mw_sg'])} to {mwv(ev['mw_sg'] + 0.03)} {mwu}.")
        out.append({"resolved": "Hole conditioned; subsequent trip smooth.",
                    "partial": "Intermittent tight spots persisted.",
                    "failed": "Tight spots persisted and hole could not be cured; open hole plugged back."}[oc])
    elif t == "WELLBORE_INSTABILITY":
        out.append(F.pick([f"{P['cavings'].capitalize()} cavings observed on shakers at {D}{FM}.",
                           f"Sloughing shale and hole enlargement suspected at {D}{FM}.",
                           f"Clay swelling and cavings at {D}{FM}."]))
        for a in acts:
            if a == "RAISE_MW":
                out.append(f"Raised MW from {mwv(ev['mw_sg'])} to {mwv(ev['mw_sg'] + 0.04)} {mwu} to support the hole.")
            elif a == "INHIBITIVE_MUD":
                out.append("Added glycol and increased KCl for shale inhibition.")
            elif a == "CIRCULATE_SWEEP":
                out.append("Pumped hi-vis sweeps and circulated hole clean.")
        out.append({"resolved": "Cavings reduced after treatment.", "partial": "Cavings persisted at reduced level.",
                    "failed": "Hole problems could not be cured; plugged back."}[oc])
    elif t == "OVERPRESSURE_KICK":
        g = P["gas_pct"]
        if P["subtype"] == "kick":
            out.append(F.pick([f"Kick taken at {D}{FM}: pit gain {P['pit_gain_bbl']} bbl, SIDPP {P['sidpp_psi']} psi, SICP {P['sicp_psi']} psi.",
                               f"Well flowed at {D}{FM}; flow check positive with {P['pit_gain_bbl']} bbl pit gain."]))
        else:
            out.append(F.pick([f"Drilling break at {D}{FM} followed by high background gas ({g}%).",
                               f"Encountered abnormally pressured zone at {D}{FM}; gas peaked at {g}%.",
                               f"High connection gas ({g}%) recorded at {D}{FM}, indicating pore pressure increase."]))
        for a in acts:
            if a == "WELL_CONTROL":
                out.append("Shut in the well and circulated out influx by driller's method.")
            elif a == "RAISE_MW":
                out.append(F.pick([f"Weighted up mud from {mwv(P['mw1'])} to {mwv(P['mw2'])} {mwu}.", f"Raised MW to {mwv(P['mw2'])} {mwu}."]))
            elif a == "CIRCULATE_SWEEP":
                out.append("Circulated bottoms up to reduce gas.")
        out.append({"resolved": F.pick(["Well killed and stabilised; resumed drilling.", "Gas reduced to background after weighting up."]),
                    "partial": "Elevated gas persisted; drilling continued with close monitoring.",
                    "failed": "Well control operations were unsuccessful initially; interval plugged back."}[oc])
    elif t == "TORQUE_SPIKE":
        out.append(F.pick([f"Erratic torque ({P['tq_lo']}-{P['tq_hi']} kN.m) while drilling at {D}{FM}.",
                           f"Severe stick-slip and top drive stalling at {D}{FM}.",
                           f"Torque spikes up to {P['tq_hi']} kN.m observed at {D}{FM}."]))
        for a in acts:
            if a == "DRILLING_PARAMS":
                out.append(f"Reduced WOB to {P['wob']} t and optimised RPM to {P['rpm']}.")
            elif a == "LUBRICANT":
                out.append(f"Added {P['lub_pct']}% lubricant to the mud system.")
        out.append({"resolved": "Torque stabilised.", "partial": "Erratic torque persisted intermittently.",
                    "failed": "Torque problems could not be cured; POOH to change BHA."}[oc])
    elif t == "CEMENTING_PROBLEM":
        csg = P["casing"]
        sub = P["subtype"]
        if sub == "losses during cementing":
            out.append(F.pick([f"Losses during cementing of {csg} casing at {D} (shoe); approx {P['slurry_lost_bbl']} bbl slurry lost to formation.",
                               f"Observed losses during cement job on {csg} casing (shoe at {D}); lost {P['slurry_lost_bbl']} bbl."]))
        elif sub == "poor bond":
            out.append(F.pick([f"CBL across {csg} casing (shoe {D}) showed poor bond from {F.d(P['bond_from'])} up to the shoe.",
                               f"Cement bond log across {csg} casing (shoe {D}) indicated channelling."]))
        else:
            out.append(f"Top of cement behind {csg} casing (shoe at {D}) found deeper than planned at {F.d(P['bond_from'])}.")
        for a in acts:
            if a == "CEMENT_PLUG":
                out.append(f"Carried out squeeze cementing job with {P['squeeze_bbl']} bbl slurry.")
            elif a == "LCM_PILL":
                out.append("Pumped LCM spacer ahead of the slurry.")
        out.append({"resolved": "Remedial job successful; CBL confirmed good bond.", "partial": "Squeeze partially successful.",
                    "failed": "Required second squeeze to achieve isolation."}[oc])
    elif t == "NOTABLE_PRACTICE":
        D2 = F.d(ev["md_base"])
        if ev["subtype"].startswith("lower Tipam"):
            out.append(f"Lower Tipam ({D} to {D2}) was drilled without losses: MW maintained at {mwv(P['mw'])} {mwu}, flow rate "
                       f"limited to {P['q']} lpm (ECD {mwv(P['ecd'])} {mwu}), ROP controlled below {P['rop_max']} m/hr and the mud "
                       f"pre-treated with {P['caco3_ppb']} ppb sized CaCO3.")
        else:
            out.append(f"The Barail coal-shale section ({D} to {D2}) was drilled with {P['mud']} at {mwv(P['mw'])} {mwu} "
                       f"({P['kcl_pct']}% KCl) and regular hi-vis sweeps; no tight hole or stuck pipe was experienced.")
        return out

    if rng.uniform() < 0.85:
        tail = F.pick([f"NPT: {npt} hrs.", f"Total {npt} hrs lost.", f"(NPT {npt} h)"])
        out.append(tail)
    return out


# ------------------------------------------------------------------------------------------
# Page layout (shared by digital and scanned renderers => identical pagination)
# ------------------------------------------------------------------------------------------
class Layout:
    def __init__(self):
        self.pages: list[list[tuple[str, str]]] = [[]]
        self.marks: dict[str, set[int]] = {}

    @property
    def page_no(self) -> int:
        return len(self.pages)

    def _add_line(self, style: str, line: str):
        if len(self.pages[-1]) >= LINES_PER_PAGE:
            self.pages.append([])
        self.pages[-1].append((style, line))

    def new_page(self):
        if self.pages[-1]:
            self.pages.append([])

    def block(self, style: str, text: str, mark: str | None = None, indent: str = ""):
        lines = textwrap.wrap(text, WRAP - len(indent), subsequent_indent=indent) or [""]
        for ln in lines:
            self._add_line(style, ln)
            if mark:
                self.marks.setdefault(mark, set()).add(self.page_no)

    def blank(self):
        self._add_line("p", "")


def render_digital(layout: Layout, path: Path, title: str):
    pdf = FPDF(format="A4")
    pdf.set_auto_page_break(False)
    pdf.set_title(title)
    pdf.set_author("NWIS synthetic data generator")
    for page in layout.pages:
        pdf.add_page()
        y = 14.0
        for style, line in page:
            if style == "title":
                pdf.set_font("Helvetica", "B", 12)
            elif style == "h":
                pdf.set_font("Helvetica", "B", 9.5)
            elif style == "wm":
                pdf.set_font("Helvetica", "I", 7.5)
            else:
                pdf.set_font("Courier", "", 8.6)
            pdf.set_xy(12, y)
            pdf.cell(186, 4.6, line.encode("latin-1", "replace").decode("latin-1"))
            y += 4.75
    pdf.output(str(path))


_FONT_CACHE: dict[tuple[str, int], ImageFont.ImageFont] = {}


def _font(bold: bool, size: int):
    key = ("b" if bold else "r", size)
    if key not in _FONT_CACHE:
        name = "timesbd.ttf" if bold else "times.ttf"
        try:
            _FONT_CACHE[key] = ImageFont.truetype(name, size)
        except OSError:
            try:
                _FONT_CACHE[key] = ImageFont.truetype("DejaVuSansMono.ttf", size)
            except OSError:
                _FONT_CACHE[key] = ImageFont.load_default(size=size)
    return _FONT_CACHE[key]


def render_scanned(layout: Layout, path: Path, rng: np.random.Generator, title: str):
    """Rasterise pages like a photocopy (no text layer): off-white, slight skew, noise, blur."""
    pdf = FPDF(format="A4")
    pdf.set_auto_page_break(False)
    pdf.set_title(title)
    W, H = 1240, 1754
    for page in layout.pages:
        img = Image.new("L", (W, H), color=int(rng.uniform(236, 248)))
        draw = ImageDraw.Draw(img)
        y = 80
        for style, line in page:
            bold = style in ("title", "h")
            size = 27 if style == "title" else 23
            draw.text((70, y), line, fill=int(rng.uniform(15, 45)), font=_font(bold, size))
            y += 28
        img = img.rotate(float(rng.uniform(-0.6, 0.6)), resample=Image.BICUBIC, fillcolor=240)
        noise = rng.normal(0, 9, (H, W)).astype(np.int16)
        arr = np.clip(np.asarray(img, dtype=np.int16) + noise, 0, 255).astype(np.uint8)
        img = Image.fromarray(arr).filter(ImageFilter.GaussianBlur(0.5))
        pdf.add_page()
        pdf.image(img.convert("RGB"), x=0, y=0, w=210, h=297)
    pdf.output(str(path))


# ------------------------------------------------------------------------------------------
# Document builders
# ------------------------------------------------------------------------------------------
def _date(s: str) -> str:
    return dt.date.fromisoformat(s).strftime("%d-%b-%Y")


OPS_CODE = {"LOST_CIRCULATION": "LOSS", "STUCK_PIPE": "STUCK", "TIGHT_HOLE": "REAM", "WELLBORE_INSTABILITY": "COND",
            "OVERPRESSURE_KICK": "WCTL", "TORQUE_SPIKE": "DRL", "CEMENTING_PROBLEM": "CMT", "NOTABLE_PRACTICE": "DRL"}


def build_ddr(rng: np.random.Generator, well: dict, date: str, events: list[dict], report_no: int, units: str) -> Layout:
    F = Fmt(rng, units)
    L = Layout()
    ev0 = events[0] if events else None
    md_ref = ev0["md"] if ev0 else float(rng.uniform(800, well["td_md"] - 50))
    sec = next((s for s in well["sections"] if s["md_from"] <= md_ref <= s["md_to"] + 1), well["sections"][-1])
    prog = float(rng.uniform(25, 90))
    md_start = max(md_ref - float(rng.uniform(10, 40)), sec["md_from"] + 5)
    md_end = md_ref + max(prog - (md_ref - md_start), 5.0)
    L.block("title", "DAILY DRILLING REPORT")
    L.block("wm", WATERMARK)
    L.block("p", f"Well: {well['name']}    Report No: {report_no}    Date: {_date(date)}")
    L.block("p", f"Field: {FIELD_NAME}    Rig: RIG-{int(rng.integers(1, 12)):02d}")
    L.block("p", f"Depth @ 06:00: {F.d(md_end)}    24 hr progress: {F.d(md_end - md_start).replace(' MD', '')}    Hole size: {sec['hole']}")
    L.block("p", f"Mud: {sec['mud_system']}  MW {F.mw(sec['mw_sg'])}  PV {int(rng.uniform(14, 26))}  YP {int(rng.uniform(12, 22))}  "
                 f"API fluid loss {rng.uniform(4, 6.5):.1f} ml")
    L.blank()
    L.block("h", "TIME BREAKDOWN (00:00 - 24:00)")
    t = 0.0
    in_remarks = [e for e in events if rng.uniform() < 0.3]

    def row(hrs: float, code: str, text: str, mark: str | None = None):
        nonlocal t
        a, b = t, min(t + hrs, 24.0)
        t = b
        L.block("p", f"{int(a):02d}:{int((a % 1) * 60):02d}-{int(b):02d}:{int((b % 1) * 60):02d} | {b - a:4.1f} h | {code:<5} | {text}",
                mark=mark, indent=" " * 30)

    row(rng.uniform(2, 5), "DRL", f"Drilled {sec['hole']} hole from {F.d(md_start)} to {F.d(md_ref)}.")
    tr = well["trajectory"]
    s_md = md_ref - 10
    row(0.5, "SURV", f"Took survey at {F.d(s_md)}: inc {np.interp(s_md, tr['md'], tr['inc']):.1f} deg, "
                     f"azi {np.interp(s_md, tr['md'], tr['azi']):.0f} deg.")
    for ev in events:
        if ev in in_remarks:
            continue
        text = " ".join(narrate(ev, rng, units, "ddr"))
        row(min(max(ev["npt_h"], 1.0), 10.0), OPS_CODE[ev["type"]], text, mark=ev["id"])
    row(rng.uniform(3, 8), "DRL", f"Drilled ahead from {F.d(md_ref + 1)} to {F.d(md_end)}.")
    row(max(24 - t, 0.5), "CIRC", "Circulated and conditioned mud prior to connection.")

    L.new_page()
    L.block("h", "MUD AND SOLIDS")
    L.block("p", f"Mud system {sec['mud_system']}. MW in {F.mw(sec['mw_sg'])}, ECD {F.mw(sec['ecd_sg'])}. Solids control equipment "
                 f"working satisfactorily. Background gas {rng.uniform(0.3, 1.8):.1f}%.")
    L.blank()
    L.block("h", "REMARKS")
    types = {e["type"] for e in events}
    normal = []
    if "LOST_CIRCULATION" not in types and "CEMENTING_PROBLEM" not in types:
        normal.append(F.pick(["No losses observed.", "Drilled ahead with full returns; no mud losses.", "Nil losses during the day."]))
    if not types & {"TIGHT_HOLE", "STUCK_PIPE", "WELLBORE_INSTABILITY"}:
        normal.append(F.pick(["Hole in good condition, no tight spots.", "No overpull on connections."]))
    if "OVERPRESSURE_KICK" not in types:
        normal.append(F.pick(["No gas shows.", "Flow checks on connections negative."]))
    L.block("p", " ".join(normal) if normal else "Refer operations summary.")
    for ev in in_remarks:
        L.block("p", "Event summary: " + " ".join(narrate(ev, rng, units, "ddr")), mark=ev["id"])
    L.blank()
    L.block("p", F.pick(["HSE: No incidents. Toolbox talk held on pipe handling.", "HSE: No LTI. BOP drill carried out.",
                         "HSE: No incidents. Pre-tour safety meeting held."]))
    return L


def build_wcr(rng: np.random.Generator, well: dict, events: list[dict], units: str, include: set[str]) -> Layout:
    F = Fmt(rng, units)
    L = Layout()
    tops = well["tops"]
    td_f = FORMATION_BY_CODE[tops[-1]["code"]].name
    kind = {"vertical": "vertical", "J": "J-type deviated", "S": "S-type deviated"}[well["traj_type"]]
    L.block("title", "WELL COMPLETION REPORT")
    L.block("wm", WATERMARK)
    L.block("p", f"Well: {well['name']}    Field: {FIELD_NAME}")
    L.block("p", f"Spud date: {_date(well['spud_date'])}    Completion date: {_date(well['completion_date'])}")
    L.block("p", f"Total depth: {F.d(well['td_md'])} (TVD {F.d(well['td_tvd']).replace(' MD', '')})    RKB elevation: {well['rkb_elev']:.1f} m AMSL")
    L.block("p", f"Well type: {kind}    Status: completed")
    L.blank()
    L.block("h", "1. SUMMARY")
    n_ev = len([e for e in events if e["type"] != "NOTABLE_PRACTICE" and e["id"] in include])
    L.block("p", f"{well['name']} was drilled as a {kind} well to a total depth of {F.d(well['td_md'])} in the {td_f}. "
                 f"The well was drilled in three hole sections and cased with 13 3/8\", 9 5/8\" and 7\" strings. "
                 f"{n_ev} notable drilling events are described in Section 5.")
    L.blank()
    L.block("h", "2. FORMATION TOPS")
    L.block("p", f"{'Formation':<18} | {'Top MD':>12} | {'Top TVDSS':>12}")
    for t in tops:
        L.block("p", f"{FORMATION_BY_CODE[t['code']].name:<18} | {F.d(t['md_top']).replace(' MD', ''):>12} | "
                     f"{F.d(t['tvdss_top']).replace(' MD', ''):>12}")
    L.blank()
    L.block("h", "3. CASING")
    for c in well["casing"]:
        L.block("p", f"{c['size']:<8} casing set at {F.d(c['shoe_md'])}")
    L.blank()
    L.block("h", "4. MUD PROGRAM")
    for s in well["sections"]:
        L.block("p", f"{s['hole']:<8} hole: {F.d(s['md_from']).replace(' MD', '')} - {F.d(s['md_to']).replace(' MD', '')}, "
                     f"{s['mud_system']}, MW {F.mw(s['mw_sg'])}")
    L.new_page()
    L.block("h", "5. DRILLING PROBLEMS AND REMEDIAL MEASURES")
    k = 0
    for ev in sorted(events, key=lambda e: e["md"]):
        if ev["type"] == "NOTABLE_PRACTICE" or ev["id"] not in include:
            continue
        k += 1
        prefix = f"5.{k} " + (f"On {_date(ev['date'])}, " if rng.uniform() < 0.4 else "")
        sents = narrate(ev, rng, units, "wcr")
        if prefix.endswith(", "):
            sents[0] = sents[0][0].lower() + sents[0][1:]
        L.block("p", prefix + " ".join(sents), mark=ev["id"])
        L.blank()
    if k == 0:
        L.block("p", "No significant drilling problems were encountered.")
    L.blank()
    L.block("h", "6. CONCLUSIONS AND LESSONS LEARNT")
    for ev in events:
        if ev["type"] == "NOTABLE_PRACTICE" and ev["id"] in include:
            L.block("p", " ".join(narrate(ev, rng, units, "wcr")), mark=ev["id"])
            L.blank()
    L.block("p", "Offset well data should be reviewed prior to drilling the 8 1/2\" section in this area.")
    return L
