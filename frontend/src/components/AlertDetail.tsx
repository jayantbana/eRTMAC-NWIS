import { useEffect, useState } from "react";
import { api, type Alert, type EventDetail } from "../api";
import { useApp } from "../state";
import { FAMILY_COLOR, Tier, fmt, outcomeBadge } from "../ui";
import Recommendations from "./Recommendations";

export default function AlertDetail({ alert, onClose, onAck }: { alert: Alert; onClose: () => void; onAck: (reason: string) => void }) {
  const { openEvidence, meta } = useApp();
  const [events, setEvents] = useState<EventDetail[]>([]);
  const [reason, setReason] = useState("Noted - mitigation plan in place");
  useEffect(() => {
    const ids = alert.zone?.events ?? [];
    Promise.all(ids.slice(0, 6).map((id) => api.event(id))).then(setEvents).catch(() => setEvents([]));
  }, [alert.id, alert.zone?.id]);
  const z = alert.zone;
  return (
    <>
      <div className="drawer-back" onClick={onClose} />
      <div className="modal">
        <div className="panel-h" style={{ fontSize: 13 }}>
          <Tier tier={alert.tier} /> <span style={{ color: FAMILY_COLOR[alert.family] }}>{alert.label}</span>
          <span className="dim mono">{alert.id}</span><span className="spacer" />
          <button className="btn ghost" onClick={onClose}>✕</button>
        </div>
        <div className="panel-b" style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr)", gap: 14 }}>
          <div className="col">
            <div style={{ fontSize: 14 }}>{alert.message}</div>
            {alert.realigned && (
              <div className="notice small">Zone re-aligned after a formation top was picked: {alert.realigned.from.map((v) => v.toFixed(0)).join("–")} m →{" "}
                {alert.realigned.to.map((v) => v.toFixed(0)).join("–")} m</div>
            )}
            <div className="grid3">
              <div className="stat"><div className="label">History (offsets)</div><div className="big">{fmt.pct(alert.p_prior)}</div></div>
              <div className="stat"><div className="label">Live precursors</div><div className="big">{alert.p_live == null ? "–" : fmt.pct(alert.p_live)}</div></div>
              <div className="stat"><div className="label">Fused</div><div className="big">{fmt.pct(alert.p_final)}</div></div>
            </div>
            {z && (
              <div className="kv small">
                <span>Zone</span><span className="mono">{z.md_from.toFixed(0)}–{z.md_to.toFixed(0)} m MD ({z.formation_name})</span>
                <span>Bit / distance</span><span className="mono">{alert.bit_md.toFixed(1)} m · {alert.ahead_m > 0 ? `${alert.ahead_m.toFixed(0)} m ahead` : "in zone"}{alert.eta_h ? ` · ETA ${alert.eta_h.toFixed(1)} h` : ""}</span>
                <span>Look-ahead window</span><span className="mono">{alert.lookahead_m} m</span>
                <span>Offset wells</span><span>{z.wells.join(", ")}</span>
              </div>
            )}
            {(alert.rule_reasons.length > 0 || alert.model_reasons.length > 0) && (
              <div className="stat">
                <b className="small">Live indicators</b>
                {alert.rule_reasons.map((r, i) => <div key={i} className="small">• Rule: {r}</div>)}
                {alert.model_reasons.map((r) => (
                  <div key={r.feature} className="small">• Model: {r.label} (value {r.value}, contribution +{r.contribution})</div>
                ))}
              </div>
            )}
            <div>
              <b className="small">Historical evidence behind this zone</b>
              {events.length === 0 && <div className="small muted">{alert.live_only ? "Live-only anomaly: no historical precedent at this depth." : "Loading…"}</div>}
              {events.map((e) => (
                <div key={e.event_id} className="stat" style={{ marginTop: 6 }}>
                  <div className="row small">
                    <b>{e.well}</b><span className="dim">{e.type_label}{e.subtype ? ` (${e.subtype})` : ""}</span>
                    <span className="mono dim">{e.md_top.toFixed(0)} m · {e.formation_name}</span><span className="spacer" />{outcomeBadge(e.outcome)}
                  </div>
                  <div className="small muted" style={{ margin: "4px 0" }}>“{e.provenance[0]?.quote.slice(0, 220)}”</div>
                  <div className="row" style={{ flexWrap: "wrap", gap: 4 }}>
                    {e.provenance.map((p, i) => (
                      <span key={i} className="cite" onClick={() => openEvidence({ kind: "page", docId: p.doc_id, page: p.page, quote: p.quote })}>
                        {p.doc_id} p.{p.page}{p.method === "ocr" ? " · OCR" : ""}
                      </span>
                    ))}
                    {e.npt_h && <span className="small dim">NPT {e.npt_h} h</span>}
                  </div>
                </div>
              ))}
            </div>
            <div className="stat">
              <b className="small">Acknowledge</b>
              <div className="row" style={{ marginTop: 6 }}>
                <select value={reason} onChange={(e) => setReason(e.target.value)} style={{ flex: 1 }}>
                  <option>Noted - mitigation plan in place</option>
                  <option>Already mitigated (MW / flow adjusted)</option>
                  <option>Not applicable - different mud system</option>
                  <option>False alarm - sensor / pit transfer</option>
                </select>
                <button className="btn" onClick={() => onAck(reason)}>Acknowledge</button>
              </div>
              {alert.acknowledged && <div className="small ok" style={{ marginTop: 4 }}>Acknowledged by {alert.acknowledged.by}: {alert.acknowledged.reason}</div>}
              <div className="small dim" style={{ marginTop: 4 }}>Acknowledgement reasons are logged and used to tune thresholds.</div>
            </div>
          </div>
          <div className="col" style={{ minWidth: 0 }}>
            <b className="small">What was done before in similar situations</b>
            <Recommendations family={alert.family} formation={z?.formation ?? null} md={alert.bit_md} />
            <div className="small dim">Tier history: {alert.history.map((h) => `${h.tier ?? "cleared"} @ ${h.bit_md.toFixed(0)} m`).join(" → ")}</div>
            <div className="small dim">{meta.data_mode} data</div>
          </div>
        </div>
      </div>
    </>
  );
}
