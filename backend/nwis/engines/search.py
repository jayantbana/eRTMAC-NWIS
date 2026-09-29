"""Ask NWIS: grounded search over OIL's own reports (PS requirement 2).

* Query understanding: wells, formations, depths, risk families, radius, intent.
* Analytical questions ("how many", "which wells", "list") -> typed tools over the event table
  (exact counts, no generated arithmetic).
* Descriptive questions -> BM25 retrieval with drilling-synonym expansion and metadata boosts,
  then an EXTRACTIVE answer: only verbatim sentences from retrieved pages, each with doc + page.
* Optional local LLM (Ollama) rewrites the evidence into prose; a verifier drops any sentence
  without a valid citation or with numbers that do not appear in the cited evidence.
* No evidence -> "insufficient evidence" instead of a guess.
"""
from __future__ import annotations

import json
import math
import re
from collections import Counter, defaultdict

import httpx

from .. import config
from ..core.taxonomy import (EVENT_TYPES, FAMILY_QUERY_TERMS, FAMILY_QUERY_TRIGGERS, FORMATION_BY_CODE, RISK_FAMILIES, family_of,
                             find_formations)
from ..core.taxonomy import MITIGATION_PATTERNS, OUTCOME_PATTERNS
from ..ingest.extractor import detect_types, find_depths, split_sentences
from .store import Store

STOP = set("a an the of in on at to for from and or is was were be been with by what which who how did do does any all there this that "
           "these those it its as into about near nearby well wells happen happened occur occurred problem problems issue issues "
           "encountered seen observed show tell me please give list".split())
COUNT_RE = re.compile(r"\b(how many|count|number of|which wells|list|table of)\b", re.I)
RADIUS_RE = re.compile(r"within\s+(\d+(?:\.\d+)?)\s*km", re.I)
WELL_Q_RE = re.compile(r"\b[Ww]ells?\s+([A-Z]{1,2})\b(?:\s*(?:,|and|&)\s*([A-Z]{1,2})\b)?(?:\s*(?:,|and|&)\s*([A-Z]{1,2})\b)?")
PRACTICE_Q_RE = re.compile(r"\b(practice|worked|work well|without (losses|problems|trouble)|trouble[- ]free|good|lesson)", re.I)
HOW_RE = re.compile(r"\b(how (was|were|did)|mitigat|cure|cured|freed|resolve|remed|what (was|were) done|action|worked)\b", re.I)


def _stem(w: str) -> str:
    for suf in ("ing", "ed", "es", "s"):
        if len(w) > 4 and w.endswith(suf):
            return w[: -len(suf)]
    return w


def tokenize(text: str) -> list[str]:
    return [_stem(w) for w in re.findall(r"[a-z0-9]+(?:-[a-z0-9]+)?", text.lower()) if w not in STOP]


class SearchEngine:
    k1, b = 1.4, 0.75

    def __init__(self, store: Store):
        self.store = store
        with store.connect() as db:
            rows = [dict(r) for r in db.execute("SELECT * FROM chunks").fetchall()]
            self.page_meta = {r["doc_id"]: r for r in (dict(x) for x in db.execute("SELECT doc_id, doc_type, report_date, well_id FROM documents"))}
        for r in rows:
            for k in ("event_types", "formations", "depths"):
                r[k] = json.loads(r[k])
            r["families"] = sorted({family_of(t) or "PR" for t in r["event_types"]})
        self.chunks = rows
        self.tf = [Counter(tokenize(r["text"])) for r in rows]
        self.len = [sum(c.values()) for c in self.tf]
        self.avglen = sum(self.len) / max(len(self.len), 1)
        df: Counter = Counter()
        for c in self.tf:
            df.update(c.keys())
        n = len(rows)
        self.idf = {t: math.log(1 + (n - d + 0.5) / (d + 0.5)) for t, d in df.items()}

    # ------------------------------------------------------------------ query understanding
    def parse(self, q: str, radius_km: float | None = None) -> dict:
        wells = []
        for m in WELL_Q_RE.finditer(q):
            for g in m.groups():
                if g and g in self.store.wells:
                    wells.append(g)
        fams = [f for f, pat in FAMILY_QUERY_TRIGGERS.items() if pat.search(q)]
        if PRACTICE_Q_RE.search(q):
            fams = ["PR"]  # positive-experience question: trouble-free practices, not incidents
        fms = sorted({c for _, c in find_formations(q)})
        depths = [d["md"] for d in find_depths(q)]
        m = RADIUS_RE.search(q)
        radius = float(m.group(1)) if m else radius_km
        active = self.store.active_id
        nearby = bool(re.search(r"\b(nearby|offset|near|around|within|surrounding)\b", q, re.I))
        scope_wells = None
        if wells and nearby and radius and (active in wells):
            scope_wells = self._wells_within(active, radius)
        elif wells:
            scope_wells = [w for w in wells if w != active] or wells
        elif nearby or radius:
            scope_wells = self._wells_within(active, radius or config.DEFAULT_RADIUS_KM)
        intent = "count" if COUNT_RE.search(q) else ("how" if HOW_RE.search(q) else "describe")
        return {"wells": wells, "scope_wells": scope_wells, "families": fams, "formations": fms, "depths": depths,
                "radius_km": radius, "intent": intent}

    def _wells_within(self, wid: str, radius_km: float) -> list[str]:
        a = self.store.wells[wid]
        return [o for o, w in self.store.wells.items() if o != wid and math.hypot(w["x"] - a["x"], w["y"] - a["y"]) <= radius_km * 1000]

    # ------------------------------------------------------------------ retrieval
    def retrieve(self, q: str, k: int = 8, parsed: dict | None = None) -> list[dict]:
        p = parsed or self.parse(q)
        terms = Counter(tokenize(q))
        for f in p["families"]:
            for t in FAMILY_QUERY_TERMS.get(f, []):
                for tok in tokenize(t):
                    terms[tok] += 0.5
        scope = set(p["scope_wells"]) if p["scope_wells"] is not None else None
        scored = []
        for i, ch in enumerate(self.chunks):
            if scope is not None and ch["well_id"] not in scope:
                continue
            tf, dl = self.tf[i], self.len[i]
            s = 0.0
            for t, qw in terms.items():
                if t in tf:
                    f = tf[t]
                    s += qw * self.idf.get(t, 0) * f * (self.k1 + 1) / (f + self.k1 * (1 - self.b + self.b * dl / self.avglen))
            if s <= 0:
                continue
            if not ch["event_types"]:
                s *= 0.5  # headers / tables without any event narrative
            if p["families"] and set(p["families"]) & set(ch["families"]):
                s += 3.0
            if p["formations"] and set(p["formations"]) & set(ch["formations"]):
                s += 2.0
            if p["depths"] and ch["depths"]:
                dmin = min(abs(a - b) for a in p["depths"] for b in ch["depths"])
                s += 1.5 * math.exp(-dmin / 50.0)
            scored.append((s, i))
        scored.sort(reverse=True)
        out = []
        for s, i in scored[:k]:
            ch = self.chunks[i]
            meta = self.page_meta.get(ch["doc_id"], {})
            out.append({**{k2: ch[k2] for k2 in ("chunk_id", "doc_id", "page_no", "well_id", "text", "start_char", "end_char",
                                                 "event_types", "formations", "families")},
                        "score": round(s, 3), "doc_type": meta.get("doc_type"), "report_date": meta.get("report_date"),
                        "well_name": self.store.wells.get(ch["well_id"], {}).get("name")})
        return out

    # ------------------------------------------------------------------ typed tools
    def events_query(self, p: dict) -> list[dict]:
        out = []
        for e in self.store.events:
            if p["scope_wells"] is not None and e["well_id"] not in p["scope_wells"]:
                continue
            fam = family_of(e["type"]) or "PR"
            if p["families"] and fam not in p["families"]:
                continue
            if p["formations"] and e.get("formation") not in p["formations"]:
                continue
            if p["depths"] and not any(abs(e["md_top"] - d) <= 75 for d in p["depths"]):
                continue
            out.append(e)
        return sorted(out, key=lambda e: (e["well_id"], e["md_top"]))

    def _event_row(self, e: dict) -> dict:
        prov = e["provenance"][0]
        return {"event_id": e["event_id"], "well": self.store.wells[e["well_id"]]["name"], "well_id": e["well_id"],
                "type": EVENT_TYPES[e["type"]]["label"], "subtype": e.get("subtype"), "md": e["md_top"],
                "formation": FORMATION_BY_CODE[e["formation"]].name if e.get("formation") else None,
                "outcome": e["outcome"], "npt_h": e.get("npt_h"), "status": e["status"],
                "citation": {"doc_id": prov["doc_id"], "page": prov["page"], "doc_type": prov.get("doc_type")}}

    # ------------------------------------------------------------------ answering
    def ask(self, q: str, radius_km: float | None = None) -> dict:
        p = self.parse(q, radius_km)
        base = {"question": q, "parsed": p, "data_mode": config.DATA_MODE}
        scope_txt = self._scope_text(p)
        if p["intent"] == "count":
            evs = self.events_query(p)
            rows = [self._event_row(e) for e in evs]
            wells = sorted({r["well"] for r in rows})
            if not rows:
                return {**base, "mode": "typed_tool", "evidence_status": "insufficient", "answer": f"No matching events were found in the "
                        f"ingested reports {scope_txt}.", "bullets": [], "table": [], "citations": []}
            fam_txt = ", ".join(RISK_FAMILIES.get(f, "good-practice records") for f in p["families"]) or "events"
            ans = f"{len(rows)} {fam_txt.lower()} record(s) in {len(wells)} well(s) {scope_txt}: {', '.join(wells)}."
            return {**base, "mode": "typed_tool", "evidence_status": "sufficient", "answer": ans, "bullets": [], "table": rows,
                    "citations": [r["citation"] for r in rows]}

        hits = self.retrieve(q, k=8, parsed=p)
        if p["families"]:
            fam_hits = [h for h in hits if set(p["families"]) & set(h["families"])]
        else:
            fam_hits = hits
        if not fam_hits:
            what = ", ".join(RISK_FAMILIES.get(f, "good-practice records") for f in p["families"]).lower() or "this question"
            return {**base, "mode": "extractive", "evidence_status": "insufficient",
                    "answer": f"Insufficient evidence: no records of {what} were found in the ingested reports {scope_txt}.",
                    "bullets": [], "table": [], "citations": [], "closest": hits[:3]}
        bullets = self._select_sentences(q, p, fam_hits)
        wells = sorted({b["citations"][0]["well"] for b in bullets})
        docs = sorted({b["citations"][0]["doc_id"] for b in bullets})
        if scope_txt.startswith("for "):
            answer = f"Evidence from {len(docs)} report(s) {scope_txt}:"
        else:
            answer = f"Evidence from {len(docs)} report(s) covering {', '.join(wells)} {scope_txt}:"
        result = {**base, "mode": "extractive", "evidence_status": "sufficient", "answer": answer, "bullets": bullets, "table": [],
                  "citations": [c for b in bullets for c in b["citations"]]}
        if config.LLM_MODEL:
            llm = self._llm_answer(q, bullets)
            if llm:
                result.update(mode="llm_verified", answer=llm["answer"], llm_dropped_sentences=llm["dropped"])
        return result

    def _scope_text(self, p: dict) -> str:
        if p["wells"] and p["scope_wells"] and set(p["scope_wells"]) <= set(p["wells"]):
            return "for " + ", ".join(self.store.wells[w]["name"] for w in p["scope_wells"])
        if p["scope_wells"] is not None:
            return f"within {p['radius_km'] or config.DEFAULT_RADIUS_KM:g} km of {self.store.wells[self.store.active_id]['name']}"
        return "across the field"

    def _select_sentences(self, q: str, p: dict, hits: list[dict], max_n: int = 6) -> list[dict]:
        qterms = set(tokenize(q))
        exp = {t for f in p["families"] for w in FAMILY_QUERY_TERMS.get(f, []) for t in tokenize(w)}
        how_terms = {"reduc", "pump", "spot", "jarr", "raise", "weight", "circulat", "cure", "freed", "regain", "squeeze", "back-ream",
                     "lcm", "pill", "shut", "kill", "stabilis", "maintain", "limit", "control"}
        cands = []
        for rank, h in enumerate(hits):
            for s in split_sentences(h["text"]):
                toks = set(tokenize(s.text))
                sc = 2.0 * len(toks & qterms) + 1.0 * len(toks & exp) - 0.15 * rank
                if p["intent"] == "how":
                    sc += 1.5 * len({t for t in toks if any(t.startswith(x) for x in how_terms)})
                if p["depths"] and find_depths(s.text):
                    sc += 1.0
                if not detect_types(s.text) and not any(pt.search(s.text) for pt in MITIGATION_PATTERNS.values()) \
                        and not any(pt.search(s.text) for _, pt in OUTCOME_PATTERNS):
                    sc -= 2.5  # incidental mention (e.g. "toolbox talk on pipe handling")
                if sc > 1.0 and len(s.text) > 25:
                    cands.append((sc, rank, h, s))
        cands.sort(key=lambda c: -c[0])
        out, per_chunk, seen = [], defaultdict(int), set()
        for sc, rank, h, s in cands:
            key = re.sub(r"\W+", "", s.text.lower())[:80]
            if key in seen or per_chunk[h["chunk_id"]] >= 3:
                continue
            seen.add(key)
            per_chunk[h["chunk_id"]] += 1
            out.append({"text": s.text.strip(), "score": round(sc, 2), "citations": [{
                "doc_id": h["doc_id"], "page": h["page_no"], "doc_type": h["doc_type"], "well": h["well_name"], "well_id": h["well_id"],
                "report_date": h["report_date"], "quote": s.text.strip()}]})
            if len(out) >= max_n:
                break
        # Keep narrative order within a document for readability.
        return sorted(out, key=lambda b: (b["citations"][0]["well_id"], b["citations"][0]["doc_id"], b["citations"][0]["page"]))

    def _llm_answer(self, q: str, bullets: list[dict]) -> dict | None:
        evidence = "\n".join(f"[{i + 1}] ({b['citations'][0]['well']}, {b['citations'][0]['doc_id']} p.{b['citations'][0]['page']}) "
                             f"{b['text']}" for i, b in enumerate(bullets))
        prompt = ("You are a drilling decision-support assistant. Answer the question using ONLY the numbered evidence. "
                  "Every sentence must end with one or more citations like [1]. Do not add facts, numbers or advice that are not "
                  "in the evidence. Use decision-support wording ('records show...').\n\n"
                  f"Question: {q}\n\nEvidence:\n{evidence}\n\nAnswer:")
        try:
            r = httpx.post(f"{config.OLLAMA_URL}/api/generate", json={"model": config.LLM_MODEL, "prompt": prompt, "stream": False,
                                                                     "options": {"temperature": 0.1}}, timeout=60)
            text = r.json().get("response", "").strip()
        except Exception:
            return None
        kept, dropped = [], 0
        for sent in re.split(r"(?<=[.!?])\s+", text):
            cites = [int(c) for c in re.findall(r"\[(\d+)\]", sent)]
            if not cites or any(c < 1 or c > len(bullets) for c in cites):
                dropped += 1
                continue
            ev_text = " ".join(bullets[c - 1]["text"] for c in cites)
            nums = re.findall(r"\d[\d,.]*", re.sub(r"\[\d+\]", "", sent))
            if any(n.strip(".,") not in ev_text for n in nums):
                dropped += 1
                continue
            kept.append(sent)
        return {"answer": " ".join(kept), "dropped": dropped} if kept else None
