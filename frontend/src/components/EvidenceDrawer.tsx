import { useEffect, useState } from "react";
import { ExternalLink, FileText, ScanText, X } from "lucide-react";
import { api, apiUrl, type EventDetail } from "../api";
import { useApp, type EvidenceTarget } from "../state";
import { EVENT_SHORT, FAMILY_INK, Loading, fmt, outcomeBadge, statusBadge, useEscape } from "../ui";

export default function EvidenceDrawer({ target }: { target: EvidenceTarget }) {
  const { closeEvidence, meta } = useApp();
  const [ev, setEv] = useState<EventDetail | null>(null);
  const [src, setSrc] = useState<{ docId: string; page: number; quote?: string } | null>(null);
  const [page, setPage] = useState<any>(null);
  useEscape(closeEvidence);

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
      <div className="overlay" onClick={closeEvidence} />
      <aside className="drawer" role="dialog" aria-modal="true" aria-labelledby="ev-title">
        <div className="drawer-h">
          <div className="dh-ic"><FileText aria-hidden /></div>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div className="dh-k">Source evidence</div>
            <h2 id="ev-title" className="ellipsis">{ev ? `${ev.well} · ${EVENT_SHORT[ev.type] ?? ev.type_label}` : src?.docId ?? "Opening report"}</h2>
          </div>
          <span className="badge b-solid-amber">{meta.data_mode}</span>
          <button className="btn btn-ghost btn-icon" onClick={closeEvidence} aria-label="Close"><X /></button>
        </div>
        <div className="drawer-b">
          {ev && (
            <section className="card" style={{ padding: "18px 22px" }}>
              <div className="row wrap" style={{ gap: 8 }}>
                <b style={{ fontSize: "1.125rem", color: ev.family ? FAMILY_INK[ev.family] : undefined }}>{ev.type_label}</b>
                {ev.subtype && <span className="muted">({ev.subtype})</span>}
                <span className="spacer" />{outcomeBadge(ev.outcome)}{statusBadge(ev.status)}
              </div>
              <dl className="kv" style={{ marginTop: 14 }}>
                <dt>Depth</dt><dd>{fmt.m(ev.md_top, 1)} MD{ev.md_base ? ` – ${fmt.m(ev.md_base, 1)}` : ""} · TVD {fmt.m(ev.tvd, 1)} · TVDSS {fmt.m(ev.tvdss, 1)}</dd>
                <dt>Rock layer</dt>
                <dd>{ev.formation_name ?? "–"} {ev.f_pos != null && <span className="muted" style={{ fontWeight: 500 }}>({(ev.f_pos * 100).toFixed(0)}% into the layer; source: {ev.formation_source})</span>}</dd>
                <dt>Severity / time lost</dt><dd>{ev.severity} / {ev.npt_h ?? "–"} h</dd>
                {ev.loss_rate_m3ph != null && <><dt>Loss rate</dt><dd>{ev.loss_rate_m3ph} m³/h</dd></>}
                <dt>Extraction confidence</dt><dd>{(ev.confidence * 100).toFixed(0)}% {ev.flags.length > 0 && <span className="muted" style={{ fontWeight: 500 }}>· flags: {ev.flags.join(", ")}</span>}</dd>
                <dt>Actions taken</dt><dd>{ev.mitigations.map((m) => m.label).join("; ") || "–"}</dd>
                <dt>Sources</dt>
                <dd className="row wrap" style={{ gap: 6 }}>
                  {ev.provenance.map((p, i) => (
                    <button key={i} className="cite" onClick={() => setSrc({ docId: p.doc_id, page: p.page, quote: p.quote })}
                      style={src?.docId === p.doc_id && src.page === p.page ? { background: "var(--primary)", color: "#fff", borderColor: "var(--primary)" } : undefined}>
                      <FileText aria-hidden />{p.doc_id} p.{p.page}{p.method === "ocr" ? " · OCR" : ""}
                    </button>
                  ))}
                </dd>
              </dl>
            </section>
          )}
          {!page && <Loading what="Opening the source page" />}
          {page && (
            <>
              <div className="row wrap" style={{ gap: 10 }}>
                <b style={{ fontSize: "1.0625rem" }}>{page.doc_id}</b>
                <span className="muted">page {page.page_no} of {page.pages}</span>
                {page.method === "ocr"
                  ? <span className="badge b-violet"><ScanText /> Scanned · OCR {Math.round((page.ocr_conf ?? 0) * 100)}% confidence</span>
                  : <span className="badge b-blue">Digital text</span>}
                <span className="spacer" />
                <a className="btn btn-sm" href={apiUrl(`/api/documents/${page.doc_id}/pdf#page=${page.page_no}`)} target="_blank" rel="noreferrer">Open original PDF <ExternalLink /></a>
              </div>
              <div className="paper"><pre className="page-text">{renderText()}</pre></div>
              <p className="small muted">
                <mark style={{ padding: "0 4px" }}>Yellow</mark> is the exact passage NWIS extracted (checked word for word).{" "}
                <mark className="secondary" style={{ padding: "0 4px" }}>Blue</mark> marks other extracted passages on this page.
              </p>
            </>
          )}
        </div>
      </aside>
    </>
  );
}
