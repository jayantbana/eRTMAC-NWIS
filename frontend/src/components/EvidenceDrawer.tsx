import { useEffect, useState } from "react";
import { api, type EventDetail } from "../api";
import { useApp, type EvidenceTarget } from "../state";
import { Loading, outcomeBadge } from "../ui";

export default function EvidenceDrawer({ target }: { target: EvidenceTarget }) {
  const { closeEvidence, meta } = useApp();
  const [ev, setEv] = useState<EventDetail | null>(null);
  const [src, setSrc] = useState<{ docId: string; page: number; quote?: string } | null>(null);
  const [page, setPage] = useState<any>(null);

  useEffect(() => {
    setEv(null);
    setPage(null);
    if (target.kind === "event") {
      api.event(target.eventId).then((e) => {
        setEv(e);
        const p = e.provenance[0];
        setSrc({ docId: p.doc_id, page: p.page, quote: p.quote });
      });
    } else {
      setSrc({ docId: target.docId, page: target.page, quote: target.quote });
    }
  }, [target]);

  useEffect(() => {
    if (!src) return;
    setPage(null);
    api.page(src.docId, src.page, src.quote).then(setPage);
  }, [src]);

  const renderText = () => {
    if (!page) return null;
    const spans = [...page.highlights].sort((a: any, b: any) => a.start - b.start);
    const out: any[] = [];
    let pos = 0;
    spans.forEach((s: any, i: number) => {
      if (s.start < pos) return;
      out.push(page.text.slice(pos, s.start));
      out.push(<mark key={i} className={s.primary ? "" : "secondary"} ref={s.primary ? (el) => el?.scrollIntoView({ block: "center" }) : undefined}>{page.text.slice(s.start, s.end)}</mark>);
      pos = s.end;
    });
    out.push(page.text.slice(pos));
    return out;
  };

  return (
    <>
      <div className="drawer-back" onClick={closeEvidence} />
      <div className="drawer">
        <div className="panel-h" style={{ fontSize: 13 }}>
          Evidence · source document <span className="spacer" />
          <span className="badge synthetic">{meta.data_mode}</span>
          <button className="btn ghost" onClick={closeEvidence}>✕</button>
        </div>
        <div className="panel-b col">
          {ev && (
            <div className="stat">
              <div className="row"><b style={{ fontSize: 14 }}>{ev.well} · {ev.type_label}</b>{ev.subtype && <span className="muted">({ev.subtype})</span>}
                <span className="spacer" />{outcomeBadge(ev.outcome)}<span className={`badge ${ev.status === "needs_review" ? "warn" : "ok"}`}>{ev.status}</span></div>
              <div className="kv small" style={{ marginTop: 6 }}>
                <span>Depth</span><span className="mono">{ev.md_top.toFixed(1)} m MD{ev.md_base ? ` – ${ev.md_base.toFixed(1)}` : ""} · TVD {ev.tvd.toFixed(1)} · TVDSS {ev.tvdss.toFixed(1)}</span>
                <span>Formation</span><span>{ev.formation_name ?? "–"} {ev.f_pos != null && <span className="dim">(position {(ev.f_pos * 100).toFixed(0)}% into formation; source: {ev.formation_source})</span>}</span>
                <span>Severity / NPT</span><span>{ev.severity} / {ev.npt_h ?? "–"} h</span>
                {ev.loss_rate_m3ph != null && <><span>Loss rate</span><span>{ev.loss_rate_m3ph} m³/h</span></>}
                <span>Extraction confidence</span><span>{(ev.confidence * 100).toFixed(0)}% {ev.flags.length > 0 && <span className="dim">flags: {ev.flags.join(", ")}</span>}</span>
                <span>Mitigations</span><span>{ev.mitigations.map((m) => m.label).join("; ") || "–"}</span>
                <span>Sources</span>
                <span className="row" style={{ flexWrap: "wrap", gap: 4 }}>
                  {ev.provenance.map((p, i) => (
                    <span key={i} className="cite" onClick={() => setSrc({ docId: p.doc_id, page: p.page, quote: p.quote })}>
                      {p.doc_id} p.{p.page}{p.method === "ocr" ? " · OCR" : ""}
                    </span>
                  ))}
                </span>
              </div>
            </div>
          )}
          {!page && <Loading what="Opening source page" />}
          {page && (
            <>
              <div className="row">
                <b>{page.doc_id}</b><span className="muted">page {page.page_no} of {page.pages}</span>
                {page.method === "ocr" ? <span className="badge ocr">scanned · OCR {Math.round((page.ocr_conf ?? 0) * 100)}%</span> : <span className="badge">text layer</span>}
                <span className="spacer" />
                <a className="btn" href={`/api/documents/${page.doc_id}/pdf#page=${page.page_no}`} target="_blank" rel="noreferrer">Open original PDF ↗</a>
              </div>
              <div className="page-text">{renderText()}</div>
              <div className="small dim">Highlighted text is the exact passage NWIS extracted (verbatim quote check). Other extracted passages on this page are shown in blue.</div>
            </>
          )}
        </div>
      </div>
    </>
  );
}
