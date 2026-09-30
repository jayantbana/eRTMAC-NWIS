import { useEffect, useState } from "react";
import { FileText, X } from "lucide-react";
import { api, type Offset } from "../api";
import { useApp } from "../state";
import { Bar, CompartmentTag, EVENT_SHORT, FamilyDot, Loading, cap, fmt, outcomeBadge, useEscape } from "../ui";

// Plain-language names for the relevance factors (technical names stay in the tooltip).
const FACTOR_PLAIN: Record<string, string> = {
  dist: "Distance within the rock layer", strat: "Rock-layer sequence match", struct: "Same fault block", cover: "Depth coverage",
  traj: "Well path similarity", ops: "Hole size and mud similarity", qual: "Data quality", time: "How recent",
};
const TRAJ_PLAIN: Record<string, string> = { S: "S-shaped", J: "J-shaped", vertical: "Vertical" };

export default function WellDrawer({ wellId, offsets }: { wellId: string; offsets: Offset[] }) {
  const { openWell, openEvidence, meta } = useApp();
  const [w, setW] = useState<any>(null);
  const close = () => openWell(null);
  useEscape(close);
  useEffect(() => { setW(null); api.well(wellId).then(setW); }, [wellId]);
  const o = offsets.find((x) => x.well_id === wellId);
  const comps = meta.relevance_components;
  const inc = o ? o.overall >= meta.thresholds.relevance_include : false;
  const focus = o ? Object.entries(o.per_formation).filter(([c]) => o.focus_formations.includes(c)) : [];

  return (
    <>
      <div className="overlay" onClick={close} />
      <aside className="drawer" role="dialog" aria-modal="true" aria-labelledby="well-title">
        <div className="drawer-h">
          <div className="dh-ic" style={w?.is_active ? { background: "var(--saffron-50)", color: "var(--saffron-ink)" } : undefined}>
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M8 10 12 2l4 8" /><path d="M9.3 7.5h5.4" /><path d="M12 10v8" /><circle cx="12" cy="20" r="2" />
            </svg>
          </div>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div className="dh-k">{w?.is_active ? "Active well" : "Offset well"}</div>
            <h2 id="well-title">{w?.name ?? wellId}</h2>
          </div>
          {w?.is_active && <span className="badge b-saffron">Drilling now</span>}
          {o && <CompartmentTag same={o.same_compartment} />}
          <button className="btn btn-ghost btn-icon" onClick={close} aria-label="Close"><X /></button>
        </div>
        {!w ? <Loading /> : (
          <div className="drawer-b">
            <div className="grid-4">
              <div className="stat"><div className="stat-l">Fault block</div><div className="stat-v">{w.compartment}</div></div>
              <div className="stat"><div className="stat-l">Drilled</div><div className="stat-v">{w.spud_year}</div><div className="stat-s">{w.spud_date ?? ""}{w.completion_date ? ` → ${w.completion_date}` : ""}</div></div>
              <div className="stat"><div className="stat-l">Total depth</div><div className="stat-v">{fmt.int(w.td_md)}<span className="small muted"> m</span></div><div className="stat-s">{w.td_tvd ? `${fmt.int(w.td_tvd)} m vertical` : ""}</div></div>
              <div className="stat"><div className="stat-l">Well path</div><div className="stat-v" style={{ fontSize: "1.25rem" }}>{TRAJ_PLAIN[w.traj_type] ?? cap(w.traj_type)}</div><div className="stat-s">rig floor {w.rkb_elev} m above sea level</div></div>
            </div>
            <div className="row wrap" style={{ gap: 8 }}>
              <span className="small strong muted">Hole sections:</span>
              {w.sections.map((s: any) => <span key={s.hole} className="badge b-gray">{s.hole} · {s.mud_system} · {s.mw_sg} SG</span>)}
            </div>

            {o && (
              <section className="card" aria-labelledby="rel-h">
                <div className="card-h">
                  <div>
                    <h3 id="rel-h">Relevance to {meta.active_well_name}</h3>
                    <p>{cap(o.explanation)}</p>
                  </div>
                  <div style={{ textAlign: "right" }}>
                    <div style={{ fontSize: "2rem", fontWeight: 800, lineHeight: 1, color: inc ? "var(--green-ink)" : "var(--muted)" }}>{o.overall.toFixed(2)}</div>
                    <span className={`badge ${inc ? "b-green" : "b-gray"}`} style={{ marginTop: 6 }}>{inc ? "Used as a guide" : "Below threshold"}</span>
                  </div>
                </div>
                <div className="table-wrap" style={{ borderTop: "1px solid var(--line)" }}>
                  <table className="t">
                    <thead>
                      <tr><th>Factor</th>{focus.map(([code]) => <th key={code}>{meta.formations.find((f) => f.code === code)?.name ?? code}</th>)}</tr>
                    </thead>
                    <tbody>
                      <tr>
                        <td><b>Overall score for this layer</b></td>
                        {focus.map(([code, pf]) => <td key={code} className="n" style={{ fontSize: "1.125rem" }}>{pf.score.toFixed(2)}</td>)}
                      </tr>
                      {Object.keys(comps).map((k) => (
                        <tr key={k}>
                          <td title={comps[k]}>
                            {FACTOR_PLAIN[k] ?? comps[k]}
                            <div className="xs muted">{meta.relevance_weights[k] != null ? `weight ${Math.round(meta.relevance_weights[k] * 100)}%` : "multiplies the score"}</div>
                          </td>
                          {focus.map(([code, pf]) => (
                            <td key={code} style={{ minWidth: 170 }}>
                              {pf.components ? (
                                <div className="row" style={{ gap: 10 }}>
                                  <div style={{ flex: 1 }}><Bar value={pf.components[k]} height={8} /></div>
                                  <span className="num small strong">{pf.components[k].toFixed(2)}</span>
                                </div>
                              ) : <span className="muted">–</span>}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <p className="small muted" style={{ padding: "12px 24px 18px" }}>Score = fault-block factor × depth coverage × weighted sum of the other factors. Hover a factor for its technical name.</p>
              </section>
            )}

            <section className="card" aria-labelledby="evs-h">
              <div className="card-h"><div><h3 id="evs-h">Recorded problems ({w.events.length})</h3><p>Select a row to open the report it came from.</p></div></div>
              {w.events.length === 0 ? <p className="small muted" style={{ padding: "0 24px 20px" }}>No problems recorded for this well.</p> : (
                <div className="table-wrap" style={{ borderTop: "1px solid var(--line)" }}>
                  <table className="t">
                    <thead><tr><th>Depth</th><th>Problem</th><th>Rock layer</th><th>Outcome</th><th>Source</th></tr></thead>
                    <tbody>
                      {w.events.map((e: any) => (
                        <tr key={e.event_id} className="click" onClick={() => openEvidence({ kind: "event", eventId: e.event_id })}>
                          <td className="n">{e.md_top.toFixed(0)} m</td>
                          <td><span className="row" style={{ gap: 8 }}><FamilyDot family={e.family} /><span>{EVENT_SHORT[e.type] ?? e.type_label}{e.subtype ? <span className="muted"> ({e.subtype})</span> : ""}</span></span></td>
                          <td>{e.formation_name}</td><td>{outcomeBadge(e.outcome)}</td>
                          <td className="small muted nowrap">{e.source.doc_id} p.{e.source.page}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>

            <section>
              <h3 style={{ fontSize: "1.1875rem", marginBottom: 12 }}>Reports ({w.documents.length})</h3>
              <div className="row wrap" style={{ gap: 8 }}>
                {w.documents.map((d: any) => (
                  <button key={d.doc_id} className="cite" onClick={() => openEvidence({ kind: "page", docId: d.doc_id, page: 1 })}>
                    <FileText aria-hidden />{d.doc_type} {d.report_date ?? ""}{d.ocr_pages > 0 ? " · OCR" : ""}
                  </button>
                ))}
              </div>
            </section>
          </div>
        )}
      </aside>
    </>
  );
}
