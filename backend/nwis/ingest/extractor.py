"""Event extraction: page text -> structured, source-linked drilling events.

Pipeline per page: sentence split -> event-type detection (lexicon + negation handling) ->
mention grouping (a narrative spans several sentences) -> attribute extraction (depth, units,
formation, subtype, rates, NPT, mitigations, outcome) -> provenance (verbatim quote + offsets).

Validation against structured well data and cross-document de-duplication happen in pipeline.py.
The extractor is deterministic and explainable. An optional LLM extractor can be plugged in
behind the same output schema (see IMPLEMENTATION_PLAN.md, section 7).
"""
from __future__ import annotations

import datetime as dt
import re
from dataclasses import dataclass, field

from ..core.taxonomy import (ABSORB, EVENT_PATTERNS, MITIGATION_LABELS, MITIGATION_PATTERNS, NEGATION_RE, OUTCOME_PATTERNS,
                             PRACTICE_PATTERN, SUPPRESS, find_formations)
from ..core.units import FT_TO_M, normalise_mud_weight, normalise_rate_m3ph

DETECT_ORDER = ["CEMENTING_PROBLEM", "STUCK_PIPE", "OVERPRESSURE_KICK", "LOST_CIRCULATION", "TIGHT_HOLE",
                "WELLBORE_INSTABILITY", "TORQUE_SPIKE"]

ROW_PREFIX_RE = re.compile(r"\d{2}\s*:\s*\d{2}\s*-\s*\d{2}\s*:\s*\d{2}\s*[|lI!]\s*[\d.]+\s*h\s*[|lI!]\s*[A-Z]{2,5}\s*[|lI!]\s*")
SENT_SPLIT_RE = re.compile(r"(?<=[A-Za-z0-9)\"'%])[.]\s+(?=[A-Z(\d])|\n")

_NUM = r"(\d{1,2}[,.]\d{3}(?:\.\d+)?|\d{3,5}(?:\.\d+)?)"
_UNIT = r"(m\s?MD|mMD|mtrs?|metres?|meters?|mts|m|ft|feet|')"
DEPTH_RANGE_RE = re.compile(_NUM + r"\s*" + _UNIT + r"?\s*(?:-|to|up to)\s*" + _NUM + r"\s*" + _UNIT + r"(?![A-Za-z0-9/])")
DEPTH_RE = re.compile(_NUM + r"\s*" + _UNIT + r"(?![A-Za-z0-9/])")
RATE_RE = re.compile(r"(\d+(?:\.\d+)?)\s*(bbls?\s*/?\s*hr?\b|bph|m3\s*/?\s*hr?\b)", re.I)
NPT_RE = re.compile(r"(?:NPT[:\s]*(?:of\s*)?(\d+(?:\.\d+)?)\s*(?:hrs?|hours?|h)\b)|(?:(\d+(?:\.\d+)?)\s*(?:hrs?|hours?)\s+lost)|"
                    r"(?:non-productive time[:\s]*(\d+(?:\.\d+)?))", re.I)
MW_RE = re.compile(r"\b(?:MW|mud weight)\b[^0-9]{0,25}?(\d+(?:\.\d+)?)\s*(ppg|SG|s\.g\.)?", re.I)
DATE_RE = re.compile(r"\b(\d{1,2})-(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)-(\d{4})\b")
HOLE_RE = re.compile(r"(\d{1,2})\s+(1/2|1/4|3/4|3/8|5/8)\"?\s*hole|(\d{1,2}(?:\.\d+)?)\"\s*hole", re.I)


@dataclass
class Sentence:
    start: int
    end: int
    text: str


@dataclass
class Mention:
    type: str
    sents: list[int] = field(default_factory=list)
    depth: float | None = None


def prepare_page_text(text: str) -> str:
    """Canonical page text: table row prefixes become sentence breaks, whitespace collapsed."""
    text = ROW_PREFIX_RE.sub("\n\n", text)
    text = re.sub(r"[ \t]*\n[ \t]*", "\n", text)
    # All-caps heading lines ("6. CONCLUSIONS AND LESSONS LEARNT") are their own paragraph.
    text = re.sub(r"^([^a-z\n]{6,})$", "\n\\1\n", text, flags=re.M)
    # Paragraph breaks: blank lines, table rows and numbered paragraphs ("5.2 ..."); join wrapped lines.
    text = re.sub(r"\n{2,}", " ", text)
    text = re.sub(r"\n(?=\d\.\d{1,2}\s+[A-Z])", " ", text)
    text = text.replace("\n", " ").replace(" ", "\n")
    text = re.sub(r"[ ]{2,}", " ", text)
    return re.sub(r"\n\s*", "\n", text).strip()


def split_sentences(text: str) -> list[Sentence]:
    out, pos = [], 0
    for m in SENT_SPLIT_RE.finditer(text):
        end = m.start() + (1 if text[m.start()] == "." else 0)
        if end > pos:
            out.append(Sentence(pos, end, text[pos:end]))
        pos = m.end()
    if pos < len(text):
        out.append(Sentence(pos, len(text), text[pos:]))
    return [s for s in out if s.text.strip()]


def _parse_num(s: str) -> float:
    if re.fullmatch(r"\d{1,2}[.,]\d{3}", s):  # thousands separator (OCR may read ',' as '.')
        return float(s.replace(",", "").replace(".", ""))
    return float(s.replace(",", ""))


def _to_m(value: float, unit: str | None) -> tuple[float, bool]:
    u = (unit or "").lower().replace(" ", "")
    if u in ("ft", "feet", "'"):
        return value * FT_TO_M, False
    if u:
        return value, False
    return value, True


def find_depths(text: str) -> list[dict]:
    """All depth mentions in text: [{start, md, md_base, unit, inferred}] in metres."""
    found, taken = [], []
    for m in DEPTH_RANGE_RE.finditer(text):
        u = m.group(4) or m.group(2)
        a, inf_a = _to_m(_parse_num(m.group(1)), m.group(2) or u)
        b, _ = _to_m(_parse_num(m.group(3)), u)
        if 100 <= a <= 7000 and 100 <= b <= 7000 and b >= a:
            found.append({"start": m.start(), "md": a, "md_base": b, "unit": u, "inferred": inf_a})
            taken.append((m.start(), m.end()))
    for m in DEPTH_RE.finditer(text):
        if any(s <= m.start() < e for s, e in taken):
            continue
        v, inf = _to_m(_parse_num(m.group(1)), m.group(2))
        if 100 <= v <= 7000:
            found.append({"start": m.start(), "md": v, "md_base": None, "unit": m.group(2), "inferred": inf})
    return sorted(found, key=lambda d: d["start"])


def _negated(prefix: str) -> bool:
    return bool(NEGATION_RE.search(prefix[-60:]))


def detect_types(sentence: str) -> list[str]:
    if PRACTICE_PATTERN.search(sentence):
        return ["NOTABLE_PRACTICE"]
    found = []
    for t in DETECT_ORDER:
        for m in EVENT_PATTERNS[t].finditer(sentence):
            if _negated(sentence[: m.start()]):
                continue
            found.append((m.start(), t))
            break
    types = [t for _, t in sorted(found)]
    for a, subs in SUPPRESS.items():
        if a in types:
            types = [t for t in types if t not in subs]
    # Primary = earliest mention in the sentence.
    return types


def _is_followup(sentence: str) -> bool:
    if any(p.search(sentence) for p in MITIGATION_PATTERNS.values()):
        return True
    if any(p.search(sentence) for _, p in OUTCOME_PATTERNS):
        return True
    return bool(NPT_RE.search(sentence))


def _subtype(etype: str, text: str) -> str | None:
    t = text.lower()
    if etype == "LOST_CIRCULATION":
        if re.search(r"\btotal\b|no returns|complete loss", t):
            return "total"
        for k in ("severe", "partial", "seepage"):
            if k in t:
                return k
        return None
    if etype == "STUCK_PIPE":
        if "differential" in t:
            return "differential"
        if re.search(r"pack[- ]?off|immobili|coal", t):
            return "pack-off"
        return None
    if etype == "OVERPRESSURE_KICK":
        return "kick" if re.search(r"\bkick\b|influx|flowed|pit gain|flow check", t) else "high gas"
    if etype == "CEMENTING_PROBLEM":
        if re.search(r"during (the )?cement", t):
            return "losses during cementing"
        if re.search(r"bond|cbl|channel", t):
            return "poor bond"
        if re.search(r"top of cement|\btoc\b", t):
            return "toc deeper"
    if etype == "NOTABLE_PRACTICE":
        if re.search(r"tipam", t):
            return "lower Tipam drilled without losses"
        if re.search(r"barail", t):
            return "Barail drilled without stuck pipe"
        return "practice"
    return None


def _outcome(text: str, etype: str) -> str:
    if etype == "NOTABLE_PRACTICE":
        return "resolved"
    for name, pat in OUTCOME_PATTERNS:
        if pat.search(text):
            return name
    return "unknown"


def extract_from_page(text: str, page_no: int, doc: dict) -> list[dict]:
    """Extract candidate events from one canonical page text."""
    sents = split_sentences(text)
    mentions: list[Mention] = []
    cur: Mention | None = None
    for i, s in enumerate(sents):
        types = detect_types(s.text)
        depths = find_depths(s.text)
        d_here = depths[0]["md"] if depths else None
        if types:
            primary = types[0]
            allowed = ABSORB.get(cur.type, set()) | {cur.type} if cur else set()
            same = cur is not None and all(t in allowed for t in types)
            far = cur is not None and d_here is not None and cur.depth is not None and abs(d_here - cur.depth) > 15
            if same and not far:
                cur.sents.append(i)
                continue
            cur = Mention(primary, [i], d_here)
            mentions.append(cur)
            for extra in types[1:]:
                if extra not in ABSORB.get(primary, set()):
                    mentions.append(Mention(extra, [i], d_here))
        elif cur is not None and len(cur.sents) < 9 and _is_followup(s.text) and not depths:
            cur.sents.append(i)
        elif cur is not None and len(cur.sents) < 9 and _is_followup(s.text) and depths and cur.depth is not None \
                and all(abs(d["md"] - cur.depth) <= 200 for d in depths):
            cur.sents.append(i)
        else:
            cur = None

    events = []
    for mt in mentions:
        first, last = sents[mt.sents[0]], sents[mt.sents[-1]]
        body = text[first.start:last.end]
        head = first.text
        depths = find_depths(head) or find_depths(body)
        flags = []
        depth_source = "reported"
        if depths:
            d = depths[0]
            md, md_base, inferred = d["md"], d["md_base"], d["inferred"]
            if mt.type == "NOTABLE_PRACTICE" and md_base is None and len(depths) > 1:
                md_base = depths[1]["md"]
        elif doc.get("header_depth"):
            md, md_base, inferred = doc["header_depth"], None, False
            depth_source = "report_header"
            flags.append("depth_from_report_header")
        else:
            md, md_base, inferred = None, None, False
            flags.append("no_depth")
        if inferred:
            flags.append("depth_unit_inferred")

        fms = find_formations(head) or find_formations(body)
        formation_reported = fms[0][1] if fms else None

        rate = None
        m = RATE_RE.search(body)
        if m and mt.type == "LOST_CIRCULATION":
            rate = round(normalise_rate_m3ph(float(m.group(1)), m.group(2)), 2)
        npt = None
        m = NPT_RE.search(body)
        if m:
            npt = float(next(g for g in m.groups() if g))
        mw = None
        m = MW_RE.search(body)
        if m:
            mw, _ = normalise_mud_weight(float(m.group(1)), m.group(2))
        date = doc.get("report_date")
        m = DATE_RE.search(body)
        if m:
            try:
                date = dt.datetime.strptime("-".join(m.groups()), "%d-%b-%Y").date().isoformat()
            except ValueError:
                pass

        mitigations = []
        for si in mt.sents:
            st = sents[si]
            for action, pat in MITIGATION_PATTERNS.items():
                if pat.search(st.text) and not any(x["action"] == action for x in mitigations):
                    mitigations.append({"action": action, "label": MITIGATION_LABELS[action], "quote": st.text.strip(),
                                        "doc_id": doc["doc_id"], "page": page_no})

        events.append({
            "well_id": doc["well_id"],
            "type": mt.type,
            "subtype": _subtype(mt.type, body),
            "md_top": None if md is None else round(md, 1),
            "md_base": None if md_base is None else round(md_base, 1),
            "depth_source": depth_source,
            "formation_reported": formation_reported,
            "loss_rate_m3ph": rate,
            "npt_h": npt,
            "mw_sg": None if mw is None else round(mw, 3),
            "event_date": date,
            "outcome": _outcome(body, mt.type),
            "mitigations": mitigations,
            "flags": flags,
            "provenance": [{"doc_id": doc["doc_id"], "doc_type": doc["doc_type"], "page": page_no, "quote": body.strip(),
                            "start": first.start, "end": last.end, "method": doc.get("page_method", "text")}],
        })
    return events
