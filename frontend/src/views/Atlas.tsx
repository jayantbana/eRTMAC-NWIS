import { useEffect, useState } from "react";
import { api, FAMILIES, type Atlas as AtlasT, type EventBrief, type Family } from "../api";
import { useApp } from "../state";
import { FAMILY_COLOR, Loading, outcomeBadge } from "../ui";
import Recommendations from "../components/Recommendations";

export default function Atlas() {
  const { meta, radius, openEvidence } = useApp();
  const [scope, setScope] = useState<"offsets" | "field">("offsets");
  const [atlas, setAtlas] = useState<AtlasT | null>(null);
  const [cell, setCell] = useState<{ fm: string; fam: Family } | null>({ fm: "TPM", fam: "LC" });
  const [events, setEvents] = useState<EventBrief[]>([]);

  useEffect(() => { setAtlas(null); api.atlas(radius, scope).then(setAtlas); }, [radius, scope]);
  useEffect(() => {
    if (cell) api.events({ formation: cell.fm, family: cell.fam }).then(setEvents);
  }, [cell?.fm, cell?.fam]);

  if (!atlas) return <div className="view"><Loading /></div>;
  const rows = atlas.rows.filter((r) => Object.values(r.cells).some((c) => c.n_wells > 0));
  const sel = cell ? atlas.rows.find((r) => r.formation === cell.fm)?.cells[cell.fam] : null;
  const selRow = cell ? atlas.rows.find((r) => r.formation === cell.fm) : null;

  return (
    <div className="view" style={{ display: "grid", gridTemplateColumns: "minmax(560px, 1.1fr) 1fr", gap: 12 }}>
      <div className="panel">
        <div className="panel-h">Formation risk atlas
          <span className="spacer" />
          <button className={`btn small ${scope === "offsets" ? "primary" : ""}`} onClick={() => setScope("offsets")}>Relevant offsets ({radius} km)</button>
          <button className={`btn small ${scope === "field" ? "primary" : ""}`} onClick={() => setScope("field")}>Whole field</button>
        </div>
        <div className="panel-b">
          <div className="small muted" style={{ marginBottom: 8 }}>
            Probability that a well drilling the formation experiences the risk: Bayesian posterior (empirical-Bayes prior, relevance-weighted counts)
            with 90% credible interval. Small samples are shrunk towards the field rate instead of showing “1 of 1 = 100%”.
          </div>
          <table className="t heat">
            <thead><tr><th>Formation</th>{FAMILIES.map((f) => <th key={f} style={{ color: FAMILY_COLOR[f], textAlign: "center" }}>{atlas.families[f]}</th>)}</tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.formation}>
                  <td><b>{r.name}</b><div className="small dim">{meta.formations.find((f) => f.code === r.formation)?.lithology}</div></td>
                  {FAMILIES.map((f) => {
                    const c = r.cells[f];
                    const active = cell?.fm === r.formation && cell?.fam === f;
                    return (
                      <td key={f} className="cell" onClick={() => setCell({ fm: r.formation, fam: f })}
                        style={{ background: `${FAMILY_COLOR[f]}${Math.round(Math.min(1, c.posterior * 1.6) * 200).toString(16).padStart(2, "0")}`, outline: active ? "2px solid #fff" : undefined }}>
                        <div style={{ fontWeight: 700 }}>{Math.round(c.posterior * 100)}%</div>
                        <div className="small" style={{ opacity: 0.85 }}>{Math.round(c.ci90[0] * 100)}–{Math.round(c.ci90[1] * 100)} · {c.k_eff.toFixed(1)}/{c.n_eff.toFixed(1)}</div>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
          <div className="small dim" style={{ marginTop: 6 }}>Cell: posterior · 90% CI · weighted wells with event / weighted wells penetrating.</div>
        </div>
      </div>
      <div className="panel">
        <div className="panel-h">{selRow ? `${selRow.name} · ${cell ? atlas.families[cell.fam] : ""}` : "Select a cell"}</div>
        <div className="panel-b col">
          {sel && cell && (
            <>
              <div className="grid4">
                <div className="stat"><div className="label">Posterior</div><div className="big">{Math.round(sel.posterior * 100)}%</div></div>
                <div className="stat"><div className="label">90% CI</div><div className="big" style={{ fontSize: 16 }}>{Math.round(sel.ci90[0] * 100)}–{Math.round(sel.ci90[1] * 100)}%</div></div>
                <div className="stat"><div className="label">Wells</div><div className="big">{sel.wells_with_event.length}/{sel.n_wells}</div></div>
                <div className="stat"><div className="label">Mean NPT</div><div className="big">{sel.mean_npt_h ?? "–"}</div><div className="small dim">hours</div></div>
              </div>
              <div>
                <div className="small muted">Where in the formation (relevance-weighted events by position)</div>
                {["Upper third", "Middle third", "Lower third"].map((lab, i) => {
                  const tot = sel.thirds.reduce((a, b) => a + b, 0) || 1;
                  return (
                    <div key={lab} className="row small" style={{ marginTop: 3 }}>
                      <span style={{ width: 90 }}>{lab}</span>
                      <div className="bar" style={{ flex: 1 }}><div style={{ width: `${(sel.thirds[i] / tot) * 100}%`, background: FAMILY_COLOR[cell.fam] }} /></div>
                    </div>
                  );
                })}
              </div>
              <div className="small muted">Risk matrix: likelihood {sel.likelihood}/5 × consequence {sel.consequence}/5</div>
              <b className="small">Historical events in this formation (whole field)</b>
              <table className="t small">
                <thead><tr><th>Well</th><th>MD</th><th>Event</th><th>Outcome</th><th>Source</th></tr></thead>
                <tbody>
                  {events.map((e) => (
                    <tr key={e.event_id} className="click" onClick={() => openEvidence({ kind: "event", eventId: e.event_id })}>
                      <td>{e.well}</td><td className="mono">{e.md_top.toFixed(0)}</td><td>{e.type_label}{e.subtype ? ` (${e.subtype})` : ""}</td>
                      <td>{outcomeBadge(e.outcome)}</td><td className="mono dim">{e.source.doc_id} p.{e.source.page}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <b className="small">Historical mitigations for this formation</b>
              <Recommendations family={cell.fam} formation={cell.fm} />
            </>
          )}
        </div>
      </div>
    </div>
  );
}
