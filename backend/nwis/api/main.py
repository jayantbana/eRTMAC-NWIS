"""eRTMAC-NWIS API (FastAPI). Read-only towards eRTMAC; all outputs carry evidence links."""
from __future__ import annotations

import asyncio
import datetime as dt
import json
import math
import re
from functools import lru_cache
from pathlib import Path
from typing import Any

from fastapi import FastAPI, HTTPException, Query, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from .. import config
from ..core.geo import xy_to_latlon
from ..core.taxonomy import EVENT_TYPES, FORMATION_BY_CODE, FORMATIONS, MITIGATION_LABELS, RISK_FAMILIES, family_of
from ..engines.recommend import recommend
from ..engines.relevance import COMPONENT_LABELS, DEFAULT_WEIGHTS, compute_offsets
from ..engines.risk import formation_risk, risk_track
from ..engines.search import SearchEngine
from ..engines.store import get_store
from .replay import ReplaySession


def _np_default(o: Any):
    if hasattr(o, "item"):
        return o.item()
    if hasattr(o, "tolist"):
        return o.tolist()
    return str(o)


class NpJSONResponse(JSONResponse):
    def render(self, content: Any) -> bytes:
        return json.dumps(content, default=_np_default, allow_nan=False).encode("utf-8")


app = FastAPI(title="eRTMAC-NWIS: Nearby Wells Intelligence System", version="0.1.0", default_response_class=NpJSONResponse)
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])
store = get_store()


@lru_cache(maxsize=1)
def search_engine() -> SearchEngine:
    return SearchEngine(store)


@lru_cache(maxsize=16)
def _offsets(radius_km: float) -> list[dict]:
    return compute_offsets(store, radius_km)


def _invalidate():
    _offsets.cache_clear()
    search_engine.cache_clear()


def _well_or_404(wid: str) -> dict:
    if wid not in store.wells:
        raise HTTPException(404, f"Unknown well {wid}")
    return store.wells[wid]


# ------------------------------------------------------------------------------------ meta
@app.get("/api/meta")
def meta():
    a = store.wells[store.active_id]
    return {"field": store.field, "data_mode": store.data_mode, "active_well_id": store.active_id, "active_well_name": a["name"],
            "active_current_md": a.get("current_md"), "llm_enabled": bool(config.LLM_MODEL), "llm_model": config.LLM_MODEL or None,
            "counts": {"wells": len(store.wells), "documents": len(store.documents), "events": len(store.events),
                       "needs_review": sum(e["status"] == "needs_review" for e in store.events)},
            "risk_families": RISK_FAMILIES, "event_types": {k: v["label"] for k, v in EVENT_TYPES.items()},
            "formations": [{"code": f.code, "name": f.name, "order": f.order, "lithology": f.lithology} for f in FORMATIONS],
            "mitigations": MITIGATION_LABELS, "relevance_components": COMPONENT_LABELS, "relevance_weights": DEFAULT_WEIGHTS,
            "thresholds": {"relevance_include": config.RELEVANCE_INCLUDE_THRESHOLD, "zone": config.ZONE_THRESHOLD,
                           "lookahead_min_m": config.LOOKAHEAD_MIN_M, "lookahead_hours": config.LOOKAHEAD_HOURS},
            "default_radius_km": config.DEFAULT_RADIUS_KM, "faults": _fault_lines()}


@lru_cache(maxsize=1)
def _fault_lines() -> list[list[tuple[float, float]]]:
    """Structural map layer (fault traces). In production this comes from OIL's interpreted structure maps."""
    from ..synthetic.geology import _NORMAL, _STRIKE, FAULTS, FIELD_HALF_X, FIELD_HALF_Y
    lines = []
    for s, _ in FAULTS:
        pts = []
        for t in range(-30000, 30001, 1000):
            x, y = s * _NORMAL[0] + t * _STRIKE[0], s * _NORMAL[1] + t * _STRIKE[1]
            if abs(x) <= FIELD_HALF_X and abs(y) <= FIELD_HALF_Y:
                pts.append(xy_to_latlon(x, y))
        lines.append(pts)
    return lines


# ------------------------------------------------------------------------------------ wells
def _well_summary(w: dict) -> dict:
    lat, lon = xy_to_latlon(w["x"], w["y"])
    t = store.trajs[w["id"]]
    path = []
    for md in list(range(0, int(t.td), 150)) + [t.td]:
        x, y = t.xy_at(md)
        path.append(xy_to_latlon(x, y))
    evs = store.events_by_well.get(w["id"], [])
    fams: dict[str, int] = {}
    for e in evs:
        k = family_of(e["type"]) or "PR"
        fams[k] = fams.get(k, 0) + 1
    return {"id": w["id"], "name": w["name"], "lat": lat, "lon": lon, "x": w["x"], "y": w["y"], "compartment": w["compartment"],
            "spud_year": w["spud_year"], "traj_type": w["traj_type"], "td_md": w["td_md"], "status": w["status"],
            "is_active": w["id"] == store.active_id, "n_events": len(evs), "families": fams, "path": path,
            "n_documents": len(store.docs_by_well.get(w["id"], []))}


@app.get("/api/wells")
def wells():
    return [_well_summary(w) for w in store.wells.values()]


@app.get("/api/wells/{wid}")
def well_detail(wid: str):
    w = _well_or_404(wid)
    out = _well_summary(w)
    out.update({"rkb_elev": w["rkb_elev"], "ground_elev": w["ground_elev"], "td_tvd": w.get("td_tvd"), "casing": w["casing"],
                "sections": w["sections"], "tops": store.tops_for(wid), "spud_date": w.get("spud_date"),
                "completion_date": w.get("completion_date"),
                "events": [_event_brief(e) for e in sorted(store.events_by_well.get(wid, []), key=lambda e: e["md_top"])],
                "documents": sorted(store.docs_by_well.get(wid, []), key=lambda d: (d["doc_type"], d["report_date"] or ""))})
    return out


@app.get("/api/wells/{wid}/offsets")
def offsets(wid: str, radius_km: float = Query(config.DEFAULT_RADIUS_KM, ge=1, le=30)):
    if wid != store.active_id:
        return compute_offsets(store, radius_km, active_id=wid)
    return _offsets(round(radius_km, 1))


@app.get("/api/wells/{wid}/risk-track")
def track(wid: str, radius_km: float = Query(config.DEFAULT_RADIUS_KM, ge=1, le=30)):
    if wid != store.active_id:
        offs = compute_offsets(store, radius_km, active_id=wid)
        return risk_track(store, offs, active_id=wid)
    return risk_track(store, _offsets(round(radius_km, 1)))


@app.get("/api/formations/risk")
def formation_atlas(radius_km: float = Query(config.DEFAULT_RADIUS_KM, ge=1, le=30), scope: str = "offsets"):
    offs = _offsets(round(radius_km, 1)) if scope == "offsets" else None
    return formation_risk(store, offs, scope="offsets" if scope == "offsets" else "field")


@app.get("/api/correlation")
def correlation(wells: str = Query(..., description="comma separated well ids")):
    out = []
    for wid in [w.strip() for w in wells.split(",") if w.strip()]:
        w = _well_or_404(wid)
        t = store.trajs[wid]
        tops = store.tops_for(wid)
        out.append({"id": wid, "name": w["name"], "is_active": wid == store.active_id, "rkb_elev": w["rkb_elev"], "td_md": w["td_md"],
                    "td_tvdss": round(t.tvdss_at(t.td), 1), "compartment": w["compartment"],
                    "tops": [{"code": x["code"], "name": x["name"], "md_top": x["md_top"], "md_base": x["md_base"],
                              "tvdss_top": x["tvdss_top"], "tvdss_base": x["tvdss_base"], "kind": x.get("kind", "actual")} for x in tops],
                    "casing": [{**c, "shoe_tvdss": round(t.tvdss_at(c["shoe_md"]), 1)} for c in w["casing"]],
                    "sections": [{**s, "tvdss_from": round(t.tvdss_at(s["md_from"]), 1), "tvdss_to": round(t.tvdss_at(s["md_to"]), 1)}
                                 for s in w["sections"]],
                    "events": [_event_brief(e) for e in store.events_by_well.get(wid, [])]})
    return out


# ------------------------------------------------------------------------------------ events
def _event_brief(e: dict) -> dict:
    prov = e["provenance"][0] if e["provenance"] else {}
    return {"event_id": e["event_id"], "well_id": e["well_id"], "well": store.wells[e["well_id"]]["name"], "type": e["type"],
            "type_label": EVENT_TYPES[e["type"]]["label"], "family": family_of(e["type"]), "subtype": e.get("subtype"),
            "md_top": e["md_top"], "md_base": e.get("md_base"), "tvdss": e["tvdss"], "formation": e.get("formation"),
            "formation_name": FORMATION_BY_CODE[e["formation"]].name if e.get("formation") else None, "f_pos": e.get("f_pos"),
            "severity": e["severity"], "npt_h": e.get("npt_h"), "outcome": e["outcome"], "status": e["status"],
            "confidence": e["confidence"], "event_date": e.get("event_date"), "n_sources": len(e["provenance"]),
            "source": {"doc_id": prov.get("doc_id"), "page": prov.get("page"), "method": prov.get("method")},
            "summary": (prov.get("quote") or "")[:220]}


@app.get("/api/events")
def events(well: str | None = None, family: str | None = None, formation: str | None = None, status: str | None = None,
           type: str | None = None):
    out = []
    for e in store.events:
        if well and e["well_id"] != well:
            continue
        if family and (family_of(e["type"]) or "PR") != family:
            continue
        if formation and e.get("formation") != formation:
            continue
        if status and e["status"] != status:
            continue
        if type and e["type"] != type:
            continue
        out.append(_event_brief(e))
    return sorted(out, key=lambda e: (e["well_id"], e["md_top"]))


@app.get("/api/events/{eid}")
def event_detail(eid: str):
    e = store.events_by_id.get(eid)
    if not e:
        raise HTTPException(404, "Unknown event")
    return {**_event_brief(e), "provenance": e["provenance"], "mitigations": e["mitigations"], "flags": e["flags"],
            "formation_reported": e.get("formation_reported"), "formation_source": e.get("formation_source"),
            "loss_rate_m3ph": e.get("loss_rate_m3ph"), "mw_sg": e.get("mw_sg"), "tvd": e["tvd"], "curated_by": e.get("curated_by")}


class ReviewIn(BaseModel):
    status: str  # curated | rejected | needs_review
    user: str = "curator"
    note: str = ""
    md_top: float | None = None
    type: str | None = None


@app.patch("/api/events/{eid}/review")
def review_event(eid: str, body: ReviewIn):
    if body.status not in ("curated", "rejected", "needs_review", "auto"):
        raise HTTPException(400, "Invalid status")
    now = dt.datetime.now().isoformat(timespec="seconds")
    with store.connect() as db:
        row = db.execute("SELECT * FROM events WHERE event_id=?", (eid,)).fetchone()
        if not row:
            raise HTTPException(404, "Unknown event")
        before = {"status": row["status"], "md_top": row["md_top"], "type": row["type"]}
        sets, vals = ["status=?", "curated_by=?", "curated_at=?"], [body.status, body.user, now]
        if body.md_top is not None:
            sets.append("md_top=?")
            vals.append(body.md_top)
        if body.type and body.type in EVENT_TYPES:
            sets += ["type=?", "family=?"]
            vals += [body.type, family_of(body.type)]
        db.execute(f"UPDATE events SET {', '.join(sets)} WHERE event_id=?", (*vals, eid))
        db.execute("INSERT INTO audit (ts,user,action,object_id,detail) VALUES (?,?,?,?,?)",
                   (now, body.user, "review_event", eid, json.dumps({"before": before, "after": body.model_dump()})))
        db.commit()
    store.reload_kb()
    _invalidate()
    return event_detail(eid) if body.status != "rejected" else {"event_id": eid, "status": "rejected"}


@app.get("/api/audit")
def audit(limit: int = 50):
    with store.connect() as db:
        return [dict(r) for r in db.execute("SELECT * FROM audit ORDER BY id DESC LIMIT ?", (limit,)).fetchall()]


# ------------------------------------------------------------------------------------ documents
@app.get("/api/documents")
def documents(well: str | None = None):
    docs = [d for d in store.documents.values() if not well or d["well_id"] == well]
    return sorted(docs, key=lambda d: (d["well_id"], d["doc_type"], d["report_date"] or ""))


@app.get("/api/documents/{doc_id}")
def document(doc_id: str):
    d = store.documents.get(doc_id)
    if not d:
        raise HTTPException(404, "Unknown document")
    with store.connect() as db:
        pages = [dict(r) for r in db.execute("SELECT page_no, method, ocr_conf, length(text) AS chars FROM pages WHERE doc_id=? "
                                             "ORDER BY page_no", (doc_id,)).fetchall()]
    evs = [_event_brief(e) for e in store.events if any(p["doc_id"] == doc_id for p in e["provenance"])]
    return {**d, "page_info": pages, "events": evs}


@app.get("/api/documents/{doc_id}/pdf")
def document_pdf(doc_id: str):
    d = store.documents.get(doc_id)
    if not d:
        raise HTTPException(404, "Unknown document")
    path = config.DOCS_DIR / d["file"]
    return FileResponse(path, media_type="application/pdf", headers={"Content-Disposition": f'inline; filename="{d["file"]}"'})


@app.get("/api/documents/{doc_id}/pages/{page_no}")
def document_page(doc_id: str, page_no: int, highlight: str | None = None):
    with store.connect() as db:
        row = db.execute("SELECT * FROM pages WHERE doc_id=? AND page_no=?", (doc_id, page_no)).fetchone()
    if not row:
        raise HTTPException(404, "Unknown page")
    text = row["text"]
    spans = []
    quotes = [highlight] if highlight else []
    for e in store.events:
        for p in e["provenance"]:
            if p["doc_id"] == doc_id and p["page"] == page_no:
                quotes.append(p["quote"])
    for q in quotes:
        if not q:
            continue
        i = text.find(q)
        if i < 0:  # tolerate whitespace differences
            m = re.search(re.escape(q[:60]).replace(r"\ ", r"\s+"), text)
            i = m.start() if m else -1
        if i >= 0:
            spans.append({"start": i, "end": i + len(q), "primary": q == highlight})
    d = store.documents.get(doc_id, {})
    return {"doc_id": doc_id, "page_no": page_no, "pages": d.get("pages"), "method": row["method"], "ocr_conf": row["ocr_conf"],
            "text": text, "highlights": spans, "well_id": d.get("well_id"), "doc_type": d.get("doc_type"),
            "report_date": d.get("report_date")}


# ------------------------------------------------------------------------------------ search / recommendations
class AskIn(BaseModel):
    question: str
    radius_km: float | None = None


@app.post("/api/ask")
def ask(body: AskIn):
    if not body.question.strip():
        raise HTTPException(400, "Empty question")
    return search_engine().ask(body.question.strip(), body.radius_km)


@app.get("/api/recommendations")
def recommendations(family: str, formation: str | None = None, radius_km: float = config.DEFAULT_RADIUS_KM, md: float | None = None):
    if family not in RISK_FAMILIES:
        raise HTTPException(400, "Unknown risk family")
    return recommend(store, family, formation, _offsets(round(radius_km, 1)), active_md=md)


class FeedbackIn(BaseModel):
    target_type: str
    target_id: str
    rating: str
    reason: str = ""
    user: str = "engineer"


@app.post("/api/feedback")
def feedback(body: FeedbackIn):
    with store.connect() as db:
        db.execute("INSERT INTO feedback (ts,user,target_type,target_id,rating,reason) VALUES (?,?,?,?,?,?)",
                   (dt.datetime.now().isoformat(timespec="seconds"), body.user, body.target_type, body.target_id, body.rating, body.reason))
        db.commit()
    return {"ok": True}


@app.get("/api/evaluation")
def evaluation():
    if not config.EVAL_PATH.exists():
        raise HTTPException(404, "Run `python -m nwis.build_all` to generate the evaluation report")
    out = json.loads(config.EVAL_PATH.read_text())
    ingest = config.DATA_DIR / "ingest_report.json"
    if ingest.exists():
        out["ingest"] = json.loads(ingest.read_text())["stats"]
    return out


# ------------------------------------------------------------------------------------ live replay
def _offsets_brief(offs: list[dict]) -> list[dict]:
    return [{"well_id": o["well_id"], "name": o["name"], "overall": o["overall"]} for o in offs]


@app.websocket("/api/ws/replay")
async def ws_replay(ws: WebSocket):
    await ws.accept()
    queue: asyncio.Queue = asyncio.Queue()

    async def reader():
        try:
            while True:
                await queue.put(json.loads(await ws.receive_text()))
        except (WebSocketDisconnect, RuntimeError):
            await queue.put({"cmd": "__closed__"})

    async def send(obj):
        await ws.send_text(json.dumps(obj, default=_np_default))

    task = asyncio.create_task(reader())
    session: ReplaySession | None = None
    running = False
    speed = 300.0
    period = 0.125
    try:
        while True:
            try:
                msg = await asyncio.wait_for(queue.get(), timeout=period if running else None)
            except asyncio.TimeoutError:
                msg = None
            if msg:
                cmd = msg.get("cmd")
                if cmd == "__closed__":
                    break
                if cmd == "start":
                    session = await asyncio.to_thread(ReplaySession, store, float(msg.get("radius_km", config.DEFAULT_RADIUS_KM)),
                                                      float(msg.get("from_md", 2740.0)))
                    speed = float(msg.get("speed", speed))
                    running = True
                    await send({"type": "init", "track": session.track, "offsets": _offsets_brief(session.offsets),
                                **session.snapshot()})
                elif cmd == "pause":
                    running = False
                elif cmd == "resume" and session:
                    running = True
                elif cmd == "speed":
                    speed = float(msg.get("value", speed))
                elif cmd == "ack" and session:
                    session.alerts.acknowledge(msg.get("alert_id", ""), msg.get("user", "engineer"), msg.get("reason", ""))
                    await send({"type": "alerts", "alerts": session.alerts.active()})
                elif cmd == "stop":
                    running, session = False, None
            if running and session:
                k = max(1, int(round(speed * period / 10.0)))
                batch = []
                for _ in range(k):
                    if session.done:
                        break
                    batch.append(session.step())
                if batch:
                    out = {"type": "tick", "records": [b["record"] for b in batch], "last": batch[-1], **session.snapshot()}
                    if any(b["track_changed"] for b in batch):
                        out["track"] = session.track
                        out["offsets"] = _offsets_brief(session.offsets)
                    await send(out)
                if session.done:
                    running = False
                    await send({"type": "done", **session.snapshot()})
    finally:
        task.cancel()


# ------------------------------------------------------------------------------------ static frontend
_DIST = Path(__file__).resolve().parents[3] / "frontend" / "dist"
if _DIST.exists():
    app.mount("/", StaticFiles(directory=_DIST, html=True), name="web")

_ = math
