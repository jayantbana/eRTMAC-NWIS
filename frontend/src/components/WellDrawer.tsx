import { useEffect, useState } from "react";
import { api, type Offset } from "../api";
import { useApp } from "../state";
import { Bar, FamilyDot, Loading, outcomeBadge } from "../ui";

export default function WellDrawer({ wellId, offsets }: { wellId: string; offsets: Offset[] }) {
  const { openWell, openEvidence, meta } = useApp();
  const [w, setW] = useState<any>(null);
  useEffect(() => { setW(null); api.well(wellId).then(setW); }, [wellId]);
  const o = offsets.find((x) => x.well_id === wellId);
  const comps = meta.relevance_components;
  return (
    <>
      <div className="drawer-back" onClick={() => openWell(null)} />
      <div className="drawer">
        <div className="panel-h" style={{ fontSize: 13 }}>
          {w?.name ?? wellId} {w?.is_active && <span className="badge warn">ACTIVE · DRILLING</span>}<span className="spacer" />
          <button className="btn ghost" onClick={() => openWell(null)}>✕</button>
        </div>
        {!w ? <Loading /> : (
          <div className="panel-b col">
            <div className="kv">
              <span>Compartment</span><span>{w.compartment}</span>
              <span>Spud / completion</span><span>{w.spud_date ?? w.spud_year} {w.completion_date ? `→ ${w.completion_date}` : ""}</span>
              <span>Trajectory</span><span>{w.traj_type} · TD {w.td_md.toFixed(0)} m MD / {w.td_tvd?.toFixed(0)} m TVD · RKB {w.rkb_elev} m AMSL</span>
              <span>Sections</span><span>{w.sections.map((s: any) => `${s.hole} ${s.mud_system} ${s.mw_sg} SG`).join(" · ")}</span>
            </div>
            {o && (
              <div className="stat">
                <div className="row"><b>Relevance to {meta.active_well_name}: {o.overall.toFixed(2)}</b><span className="spacer" />
                  <span className={`badge ${o.overall >= meta.thresholds.relevance_include ? "ok" : ""}`}>{o.overall >= meta.thresholds.relevance_include ? "used as offset" : "below threshold"}</span></div>
                <div className="small muted" style={{ margin: "4px 0 8px" }}>{o.explanation}</div>
                <table className="t small">
                  <thead><tr><th>Formation</th><th>S</th>{Object.keys(comps).map((k) => <th key={k} title={comps[k]}>{k}</th>)}</tr></thead>
                  <tbody>
                    {Object.entries(o.per_formation).filter(([c]) => o.focus_formations.includes(c)).map(([code, pf]) => (
                      <tr key={code}>
                        <td>{meta.formations.find((f) => f.code === code)?.name}</td>
                        <td className="mono"><b>{pf.score.toFixed(2)}</b></td>
                        {Object.keys(comps).map((k) => (
                          <td key={k} style={{ minWidth: 38 }}>{pf.components ? <><Bar value={pf.components[k]} /><span className="dim">{pf.components[k].toFixed(2)}</span></> : <span className="dim">–</span>}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
                <div className="small dim" style={{ marginTop: 4 }}>S = structural factor × coverage × Σ wᵢ·sᵢ. Hover column names for definitions.</div>
              </div>
            )}
            <b className="small">Recorded events ({w.events.length})</b>
            <table className="t small">
              <thead><tr><th>MD</th><th>Event</th><th>Formation</th><th>Outcome</th><th>Source</th></tr></thead>
              <tbody>
                {w.events.map((e: any) => (
                  <tr key={e.event_id} className="click" onClick={() => openEvidence({ kind: "event", eventId: e.event_id })}>
                    <td className="mono">{e.md_top.toFixed(0)}</td>
                    <td><FamilyDot family={e.family} /> {e.type_label}{e.subtype ? ` (${e.subtype})` : ""}</td>
                    <td>{e.formation_name}</td><td>{outcomeBadge(e.outcome)}</td>
                    <td className="mono dim">{e.source.doc_id} p.{e.source.page}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <b className="small">Documents ({w.documents.length})</b>
            <div className="row" style={{ flexWrap: "wrap", gap: 4 }}>
              {w.documents.map((d: any) => (
                <span key={d.doc_id} className="cite" onClick={() => openEvidence({ kind: "page", docId: d.doc_id, page: 1 })}>
                  {d.doc_type} {d.report_date ?? ""}{d.ocr_pages > 0 ? " · OCR" : ""}
                </span>
              ))}
            </div>
          </div>
        )}
      </div>
    </>
  );
}
