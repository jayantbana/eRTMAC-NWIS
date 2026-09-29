"""Shared domain vocabulary: formations, event taxonomy, risk families and the drilling lexicon.

The lexicon is deliberately general drilling vocabulary (synonyms seen across DDR/WCR styles),
so that the same term lists serve event extraction AND query expansion in search.
"""
from __future__ import annotations

import re
from dataclasses import dataclass


# --------------------------------------------------------------------------------------------
# Stratigraphy (Upper Assam-style sequence used for the SYNTHETIC field; validate with an SME)
# --------------------------------------------------------------------------------------------
@dataclass(frozen=True)
class Formation:
    code: str
    name: str
    order: int
    lithology: str
    aliases: tuple[str, ...]


FORMATIONS: list[Formation] = [
    Formation("ALV", "Alluvium", 0, "Unconsolidated sand, gravel and clay", ("alluvium", "alluvial")),
    Formation("DHK", "Dhekiajuli", 1, "Sand, clay and pebble beds", ("dhekiajuli",)),
    Formation("NMS", "Namsang", 2, "Sandstone with clay and coal streaks", ("namsang",)),
    Formation("GRJ", "Girujan Clay", 3, "Mottled, reactive clay", ("girujan clay", "girujan")),
    Formation("TPM", "Tipam Sandstone", 4, "Massive medium-coarse sandstone",
              ("tipam sandstone", "tipam sst", "tipam sands", "tipam")),
    Formation("BRL", "Barail", 5, "Sandstone-shale-coal sequence", ("barail coal shale", "barails", "barail")),
    Formation("KPL", "Kopili", 6, "Shale with thin sandstone", ("kopili",)),
    Formation("SLT", "Sylhet", 7, "Limestone, sandstone and shale", ("sylhet limestone", "sylhet")),
    Formation("LGP", "Langpar", 8, "Sandstone and shale", ("langpar",)),
    Formation("BSM", "Basement", 9, "Granitic basement", ("basement",)),
]
FORMATION_BY_CODE = {f.code: f for f in FORMATIONS}
FORMATION_CODES = [f.code for f in FORMATIONS]

_alias_pairs = sorted(((a, f.code) for f in FORMATIONS for a in f.aliases), key=lambda p: -len(p[0]))
ALIAS_TO_CODE = dict(_alias_pairs)
FORMATION_RE = re.compile(r"\b(" + "|".join(re.escape(a) for a, _ in _alias_pairs) + r")\b", re.I)


def find_formations(text: str) -> list[tuple[int, str]]:
    """Return [(char_offset, formation_code)] for every formation alias in text."""
    return [(m.start(), ALIAS_TO_CODE[m.group(1).lower()]) for m in FORMATION_RE.finditer(text)]


# --------------------------------------------------------------------------------------------
# Event taxonomy and risk families (the five risks named in PS requirement 5)
# --------------------------------------------------------------------------------------------
EVENT_TYPES: dict[str, dict] = {
    "LOST_CIRCULATION": {"label": "Lost circulation", "family": "LC"},
    "STUCK_PIPE": {"label": "Stuck pipe", "family": "SP"},
    "TIGHT_HOLE": {"label": "Tight hole / overpull", "family": "SP"},
    "WELLBORE_INSTABILITY": {"label": "Wellbore instability", "family": "SP"},
    "OVERPRESSURE_KICK": {"label": "Overpressure / kick", "family": "OP"},
    "TORQUE_SPIKE": {"label": "Torque spikes / stick-slip", "family": "TQ"},
    "CEMENTING_PROBLEM": {"label": "Cementing problem", "family": "CM"},
    "NOTABLE_PRACTICE": {"label": "Notable good practice", "family": None},
}
# How strongly an event type counts towards its risk family.
FAMILY_WEIGHT = {"TIGHT_HOLE": 0.6, "WELLBORE_INSTABILITY": 0.5}

RISK_FAMILIES: dict[str, str] = {
    "LC": "Mud loss",
    "SP": "Stuck pipe",
    "OP": "Overpressure / kick",
    "TQ": "Torque spikes",
    "CM": "Cementing problems",
}


def family_of(event_type: str) -> str | None:
    return EVENT_TYPES.get(event_type, {}).get("family")


def family_weight(event_type: str) -> float:
    return FAMILY_WEIGHT.get(event_type, 1.0)


# --------------------------------------------------------------------------------------------
# Drilling lexicon: event mentions
# --------------------------------------------------------------------------------------------
EVENT_LEXICON: dict[str, list[str]] = {
    "CEMENTING_PROBLEM": [
        r"loss(es)? (of \w+ )?during (the )?cement(ing|ation|\s+job)",
        r"cement(ing)? (job )?(problem|failure|losses)",
        r"poor (cement )?bond",
        r"\bCBL\b[^.]{0,40}\b(poor|channel)",
        r"channel(l)?ing",
        r"(top of cement|\bTOC\b)[^.]{0,90}\b(deeper|lower|short)",
        r"remedial cement",
        r"squeeze (job|cementing)",
    ],
    "STUCK_PIPE": [
        r"stuck pipe",
        r"(pipe|string|drillstring|drill string|bha)\s+(got|became|was|is|found)\s+(differentially\s+)?stuck",
        r"differential(ly)?\s+(stuck|sticking)",
        r"(string|drillstring|drill string|pipe)\s+(became|got|was)\s+immobili[sz]ed",
        r"unable to (rotate|reciprocate|move)",
        r"pack[- ]?off",
    ],
    "OVERPRESSURE_KICK": [
        r"\bkick\b",
        r"\binflux\b",
        r"pit gain",
        r"well (flowed|flowing|was flowing)",
        r"flow check (was )?positive",
        r"high (background |connection |trip )?gas",
        r"gas[- ]cut mud",
        r"over[- ]?pressure[d]?",
        r"abnormal(ly)?\s+(high\s+)?pressure[d]?",
        r"pore pressure (increase|ramp|rise)",
    ],
    "LOST_CIRCULATION": [
        r"\b(?:(?:partial|severe|total|complete|seepage|heavy|dynamic|static)\s+)?(?:mud\s+)?(?<!fluid )(?<!filtrate )loss(es)?\b(?! of (time|rig))",
        r"lost circulation",
        r"loss of (circulation|returns)",
        r"lost (total |full |partial )?returns",
        r"no returns",
        r"losing mud",
        r"returns (dropped|reduced)",
    ],
    "TIGHT_HOLE": [
        r"tight (hole|spot)",
        r"hole (was |became )?tight",
        r"overpull",
        r"excessive drag",
    ],
    "WELLBORE_INSTABILITY": [
        r"\bcavings?\b",
        r"slough(ing|ed)",
        r"(clay|shale) swelling|swelling (clay|shale)",
        r"hole (enlargement|collapse)",
    ],
    "TORQUE_SPIKE": [
        r"erratic torque",
        r"torque spikes?",
        r"high (and erratic )?torque",
        r"stick[- ]slip",
        r"top ?drive stall(ed|ing)?|stalling",
    ],
}
EVENT_PATTERNS = {t: re.compile("|".join(f"(?:{p})" for p in ps), re.I) for t, ps in EVENT_LEXICON.items()}

# Positive-experience statements ("drilled ... without losses").
PRACTICE_PATTERN = re.compile(
    r"\b(was|were|been)\s+(drilled|completed|cased|cemented)\b(?:[^.]|\.(?=\d)){0,180}?\b(without|with no|no)\b[^.]{0,40}?"
    r"\b(loss|losses|problems?|incidents?|tight hole|stuck pipe|trouble|kick|gas)",
    re.I,
)

# When an event of type K is being narrated, follow-on sentences mentioning these types are
# part of the same narrative (e.g. "overpull" while describing a stuck-pipe incident).
ABSORB = {
    "STUCK_PIPE": {"TIGHT_HOLE", "TORQUE_SPIKE", "WELLBORE_INSTABILITY"},
    "CEMENTING_PROBLEM": {"LOST_CIRCULATION"},
    "TIGHT_HOLE": {"WELLBORE_INSTABILITY"},
    "WELLBORE_INSTABILITY": {"TIGHT_HOLE"},
    "OVERPRESSURE_KICK": set(),
    "LOST_CIRCULATION": set(),
    "TORQUE_SPIKE": set(),
}
# Within ONE sentence, the first type suppresses the second.
SUPPRESS = {
    "CEMENTING_PROBLEM": {"LOST_CIRCULATION"},
    "STUCK_PIPE": {"TIGHT_HOLE", "TORQUE_SPIKE"},
}

NEGATION_RE = re.compile(r"\b(no|nil|without|not|never|zero|free of)\b(\s+[\w/-]+){0,3}\s*$", re.I)

# --------------------------------------------------------------------------------------------
# Mitigation actions and outcomes
# --------------------------------------------------------------------------------------------
MITIGATION_LEXICON: dict[str, tuple[str, list[str]]] = {
    "REDUCE_FLOW_ECD": ("Reduce flow rate / ECD", [
        r"(reduced|reduce|cut|lowered|limited|restricted)\s+(the\s+)?(flow rate|pump rate|flow|spm|pump strokes|ecd)",
        r"flow rate (was )?(limited|restricted|reduced|kept)",
        r"ecd (management|was managed|kept below)",
    ]),
    "LCM_PILL": ("Pump LCM / sized CaCO3", [
        r"\blcm\b", r"lost circulation material", r"caco3", r"calcium carbonate", r"fib(rous|re|er) (pill|lcm)", r"\bmica\b",
    ]),
    "REDUCE_MW": ("Reduce mud weight", [r"(reduced|cut back|lowered)\s+(the\s+)?(mw|mud weight)"]),
    "RAISE_MW": ("Raise mud weight", [
        r"(raised|increased)\s+(the\s+)?(mw|mud weight)", r"weight(ed)? up", r"mw (was )?(raised|increased)",
    ]),
    "CEMENT_PLUG": ("Cement plug / squeeze", [r"cement plug", r"squeeze"]),
    "JARRING": ("Jarring", [r"\bjar(red|ring|s)?\b"]),
    "SPOTTING_PILL": ("Spot freeing / pipe-lax pill", [
        r"spot(ted)?\s+[^.]{0,30}(pipe[- ]?lax|freeing|spotting|acid|diesel|lubricant) (pill|fluid)",
        r"pipe[- ]?lax",
    ]),
    "BACKREAM_WIPER": ("Back-ream / wiper trip", [r"back[- ]?ream(ed|ing)?", r"wiper trip", r"short trip", r"\breamed\b"]),
    "CIRCULATE_SWEEP": ("Circulate / hi-vis sweep", [
        r"circulated (and conditioned|bottoms? up|hole clean|out)", r"hi[- ]?vis(cosity)? (pill|sweep)", r"high[- ]vis(cosity)? (pill|sweep)",
    ]),
    "WELL_CONTROL": ("Shut in and circulate out influx", [
        r"shut[- ]?in", r"shut the well", r"driller'?s method", r"wait and weight", r"circulated out (the )?(kick|influx|gas)", r"killed the well",
    ]),
    "DRILLING_PARAMS": ("Adjust WOB / RPM / ROP", [
        r"(reduced|optimi[sz]ed|adjusted|lowered)\s+(the\s+)?(wob|rpm|rotary speed|weight on bit)",
        r"controlled (drilling|rop)", r"rop (was )?(controlled|limited)",
    ]),
    "INHIBITIVE_MUD": ("Inhibitive mud (KCl / glycol / OBM)", [
        r"\bkcl\b", r"glycol", r"inhibit(ive|ed|ion)", r"\bphpa\b", r"polyamine", r"(switched|changed|converted) to (obm|sbm|oil[- ]based)",
    ]),
    "LUBRICANT": ("Add lubricant", [r"lubricant", r"lubricity"]),
    "CASING_POINT": ("Casing point selection", [r"casing (point|shoe) (was )?(set|selected)", r"(set|ran) (the )?[\d /]+\"? casing (at|above)"]),
    "SIDETRACK": ("Sidetrack", [r"side ?track(ed)?"]),
    "FISHING": ("Fishing / back-off", [r"\bfish(ing)?\b", r"back(ed)?[- ]off"]),
}
MITIGATION_PATTERNS = {k: re.compile("|".join(f"(?:{p})" for p in ps), re.I) for k, (_, ps) in MITIGATION_LEXICON.items()}
MITIGATION_LABELS = {k: label for k, (label, _) in MITIGATION_LEXICON.items()}

OUTCOME_PATTERNS: list[tuple[str, re.Pattern]] = [
    ("failed", re.compile(r"unable to free|could not be (freed|cured)|not cured|sidetrack|plugged back|abandon|unsuccessful|second squeeze", re.I)),
    ("partial", re.compile(r"partially (cured|successful)|reduced to seepage|continued (drilling )?with (seepage|losses)|persisted", re.I)),
    ("resolved", re.compile(
        r"(loss|losses) (were )?cured|regained (full )?returns|full returns (were )?(regained|established|restored)|"
        r"(pipe|string) (was )?(freed|came free)|came free|worked free|freed the (pipe|string)|well (was )?(killed|stabili[sz]ed|static)|"
        r"stabili[sz]ed|torque (stabili[sz]ed|normali[sz]ed|reduced)|subsequent trip(s)? (was |were )?(smooth|good)|"
        r"remedial (job|squeeze) (was )?successful|reduced to background|without (losses|problems|incident)|no (further|more)|problem resolved|"
        r"cavings (reduced|subsided|stopped)|hole (conditioned|in good condition)", re.I)),
]

# Query expansion terms per risk family (used by search).
FAMILY_QUERY_TERMS: dict[str, list[str]] = {
    "LC": ["loss", "losses", "lost circulation", "returns", "lcm", "seepage", "partial", "total"],
    "SP": ["stuck", "pipe", "differential", "sticking", "immobilised", "jarred", "overpull", "tight", "pack-off", "freed"],
    "OP": ["kick", "influx", "overpressure", "gas", "pit gain", "shut-in", "flow check", "weighted"],
    "TQ": ["torque", "erratic", "stick-slip", "stall", "stalling"],
    "CM": ["cement", "cementing", "bond", "cbl", "squeeze", "toc", "slurry"],
}
FAMILY_QUERY_TRIGGERS: dict[str, re.Pattern] = {
    "LC": re.compile(r"\b(loss|losses|lost circulation|mud loss|returns|lcm)\b", re.I),
    "SP": re.compile(r"\b(stuck|sticking|immobili[sz]ed|tight|overpull|pack[- ]?off|jar)", re.I),
    "OP": re.compile(r"\b(kick|influx|over[- ]?pressure|high gas|gas|pressure|pit gain)\b", re.I),
    "TQ": re.compile(r"\b(torque|stick[- ]slip|stall)", re.I),
    "CM": re.compile(r"\b(cement|cementing|bond|cbl|squeeze)", re.I),
}
