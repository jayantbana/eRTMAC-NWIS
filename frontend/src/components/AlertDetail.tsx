import { useEffect, useState } from "react";
import { Activity, CheckCircle2, FileText, History, Info, Lightbulb, X } from "lucide-react";
import { api, type Alert, type EventDetail } from "../api";
import { useApp } from "../state";
import { EVENT_SHORT, FAMILY_INK, TIER_COLOR, TIER_MEANING, TierBadge, fmt, outcomeBadge, useEscape, vars } from "../ui";
import Recommendations from "./Recommendations";

export default function AlertDetail({ alert, onClose, onAck }: { alert: Alert; onClose: () => void; onAck: (reason: string) => void }) {
  const { openEvidence, meta } = useApp();
  const [events, setEvents] = useState<EventDetail[] | null>(null);
  const [reason, setReason] = useState("Noted - mitigation plan in place");
  useEscape(onClose);
  useEffect(() => {
    const ids = alert.zone?.events ?? [];
    setEvents(null);
    Promise.all(ids.slice(0, 6).map((id) => api.event(id))).then(setEvents).catch(() => setEvents([]));
  }, [alert.id, alert.zone?.id]);
  const z = alert.zone;

  return (
    <>
      <div className="overlay" onClick={onClose} />
      <div className="modal-wrap">
        <div className="modal" role="dialog" aria-modal="true" aria-labelledby="alert-title" style={vars({ tc: TIER_COLOR[alert.tier ?? ""] ?? "var(--faint)" })}>
          <div className="modal-h">
            <div style={{ minWidth: 0, flex: 1 }}>
              <div className="row wrap" style={{ gap: 10 }}>
                <TierBadge tier={alert.tier} large />
                <span className="small muted">{alert.tier ? TIER_MEANING[alert.tier] : "This alert has cleared"}</span>
              </div>
              <h2 id="alert-title" style={{ color: FAMILY_INK[alert.family], marginTop: 6 }}>{alert.label} <span className="small faint" style={{ fontWeight: 600 }}>{alert.id}</span></h2>
            </div>
            <button className="btn btn-ghost btn-icon" onClick={onClose} aria-label="Close"><X /></button>
          </div>
          <div className="modal-b ad-grid">
            <div className="col" style={{ gap: 18 }}>
              <p style={{ fontSize: "1.125rem", fontWeight: 600, lineHeight: 1.55 }}>{alert.message}</p>
              {alert.realigned && (
                <div className="banner info"><Info aria-hidden />
                  <span>Zone re-aligned after a layer top was confirmed: {alert.realigned.from.map((v) => v.toFixed(0)).join("–")} m → {alert.realigned.to.map((v) => v.toFixed(0)).join("–")} m</span>
                </div>
              )}
              <div className="grid-3">
                <div className="prob"><div className="stat-l">From history</div><div className="stat-v">{fmt.pct(alert.p_prior)}</div><div className="stat-s">nearby wells</div></div>
                <div className="prob"><div className="stat-l">From live signals</div><div className="stat-v">{alert.p_live == null ? "–" : fmt.pct(alert.p_live)}</div><div className="stat-s">drilling feed</div></div>
                <div className="prob main"><div className="stat-l">Combined</div><div className="stat-v">{fmt.pct(alert.p_final)}</div><div className="stat-s">used for the alert level</div></div>
              </div>
              {z && (
                <div className="box">
                  <dl className="kv">
                    <dt>Risk zone</dt><dd>{fmt.int(z.md_from)}–{fmt.int(z.md_to)} m MD · {z.formation_name}</dd>
                    <dt>Bit position</dt><dd>{fmt.m(alert.bit_md, 1)} · {alert.ahead_m > 0 ? `${alert.ahead_m.toFixed(0)} m above the zone` : "inside the zone"}{alert.eta_h ? ` · about ${alert.eta_h.toFixed(1)} h away` : ""}</dd>
                    <dt>Look-ahead window</dt><dd>{alert.lookahead_m} m</dd>
                    <dt>Seen in</dt><dd>{z.wells.join(", ")}</dd>
                  </dl>
                </div>
              )}
              {(alert.rule_reasons.length > 0 || alert.model_reasons.length > 0) && (
                <div className="box">
                  <h4><Activity aria-hidden />Live indicators</h4>
                  <ul style={{ margin: 0, paddingLeft: 20, display: "flex", flexDirection: "column", gap: 4 }}>
                    {alert.rule_reasons.map((r, i) => <li key={i}>Rule: {r}</li>)}
                    {alert.model_reasons.map((r) => <li key={r.feature}>Model: {r.label} (value {r.value}, contribution +{r.contribution})</li>)}
                  </ul>
                </div>
              )}
              <div>
                <h4 style={{ fontSize: "1.0625rem", marginBottom: 10 }}>Evidence from nearby wells</h4>
                {events == null && <div className="small muted">Loading the evidence…</div>}
                {events?.length === 0 && <div className="small muted">{alert.live_only ? "Live-only anomaly: no historical precedent at this depth." : "No linked historical cases."}</div>}
                <div className="col" style={{ gap: 10 }}>
                  {events?.map((e) => (
                    <div key={e.event_id} className="ev-card">
                      <div className="row wrap" style={{ gap: 8 }}>
                        <b>{e.well}</b><span className="muted">{EVENT_SHORT[e.type] ?? e.type_label}{e.subtype ? ` (${e.subtype})` : ""}</span>
                        <span className="small muted">· {fmt.int(e.md_top)} m · {e.formation_name}</span>
                        <span className="spacer" />{outcomeBadge(e.outcome)}
                      </div>
                      <blockquote>“{e.provenance[0]?.quote.slice(0, 240)}{(e.provenance[0]?.quote.length ?? 0) > 240 ? "…" : ""}”</blockquote>
                      <div className="row wrap" style={{ gap: 6 }}>
                        {e.provenance.map((p, i) => (
                          <button key={i} className="cite" onClick={() => openEvidence({ kind: "page", docId: p.doc_id, page: p.page, quote: p.quote })}>
                            <FileText aria-hidden />{p.doc_id} p.{p.page}{p.method === "ocr" ? " · OCR" : ""}
                          </button>
                        ))}
                        {e.npt_h ? <span className="small muted">· {e.npt_h} h lost</span> : null}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
              <div className="box">
                <h4><CheckCircle2 aria-hidden />Acknowledge this alert</h4>
                <div className="row wrap">
                  <select value={reason} onChange={(e) => setReason(e.target.value)} style={{ flex: 1, minWidth: 240 }} aria-label="Reason">
                    <option>Noted - mitigation plan in place</option>
                    <option>Already mitigated (MW / flow adjusted)</option>
                    <option>Not applicable - different mud system</option>
                    <option>False alarm - sensor / pit transfer</option>
                  </select>
                  <button className="btn btn-primary" onClick={() => onAck(reason)}>Acknowledge</button>
                </div>
                {alert.acknowledged && <div className="banner ok" style={{ marginTop: 12 }}><CheckCircle2 aria-hidden />Acknowledged by {alert.acknowledged.by}: {alert.acknowledged.reason}</div>}
                <p className="small muted" style={{ marginTop: 10 }}>Reasons are logged and used to tune alert thresholds.</p>
              </div>
            </div>
            <div className="col" style={{ minWidth: 0, gap: 14 }}>
              <h3 className="row" style={{ fontSize: "1.25rem" }}><Lightbulb size={22} color="var(--saffron)" aria-hidden />What was done before in similar situations</h3>
              <Recommendations family={alert.family} formation={z?.formation ?? null} md={alert.bit_md} />
              <div className="box" style={{ padding: "14px 18px" }}>
                <div className="row small" style={{ gap: 8, alignItems: "flex-start" }}>
                  <History size={18} color="var(--muted)" aria-hidden style={{ marginTop: 2 }} />
                  <span className="muted">Alert history: {alert.history.map((h) => `${h.tier ?? "cleared"} at ${h.bit_md.toFixed(0)} m`).join(" → ")} · {meta.data_mode} data</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
