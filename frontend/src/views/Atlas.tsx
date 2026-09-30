import { Fragment, useEffect, useState } from "react";
import { Globe, Layers, Radar, Wrench } from "lucide-react";
import { api, FAMILIES, type Atlas as AtlasT, type EventBrief, type Family } from "../api";
import Recommendations from "../components/Recommendations";
import { useApp } from "../state";
import { EVENT_SHORT, FAMILY_COLOR, FAMILY_INK, FamilyDot, Loading, PageHeader, Seg, hexA, outcomeBadge } from "../ui";

export default function Atlas() {
  const { meta, radius, openEvidence } = useApp();
  const [scope, setScope] = useState<"offsets" | "field">("offsets");
  const [atlas, setAtlas] = useState<AtlasT | null>(null);
  const [cell, setCell] = useState<{ fm: string; fam: Family }>({ fm: "TPM", fam: "LC" });
  const [events, setEvents] = useState<EventBrief[] | null>(null);

  useEffect(() => { setAtlas(null); api.atlas(radius, scope).then(setAtlas); }, [radius, scope]);
  useEffect(() => { setEvents(null); api.events({ formation: cell.fm, family: cell.fam }).then(setEvents); }, [cell.fm, cell.fam]);

  const rows = atlas?.rows.filter((r) => Object.values(r.cells).some((c) => c.n_wells > 0)) ?? [];
  const selRow = atlas?.rows.find((r) => r.formation === cell.fm);
  const sel = selRow?.cells[cell.fam];

  return (
    <div className="page">
      <PageHeader
        eyebrow="Formation risk atlas" icon={Layers} title="Risk by rock layer"
        sub="The chance that a well drilling each formation runs into each problem, learned from the wells that matter. Small samples are treated with caution instead of showing “1 of 1 = 100%”."
        actions={
          <Seg value={scope} onChange={setScope} label="Which wells to learn from"
            options={[{ id: "offsets", label: `Relevant nearby wells (${radius} km)`, icon: Radar }, { id: "field", label: "Whole field", icon: Globe }]} />
        }
      />
      <div className="atlas-layout">
        <section className="card" aria-labelledby="heat-h">
          <div className="card-h">
            <div>
              <h3 id="heat-h">Chance of each problem, by rock layer</h3>
              <p>Big number: best estimate. Small number: likely range (90% confidence). Select a cell to see the cases behind it.</p>
            </div>
          </div>
          <div className="card-b" style={{ overflowX: "auto" }}>
            {!atlas ? <Loading what="Calculating risk by rock layer" /> : (
              <table className="heat">
                <thead>
                  <tr>
                    <th>Rock layer</th>
                    {FAMILIES.map((f) => <th key={f} style={{ color: FAMILY_INK[f] }}>{atlas.families[f]}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.formation}>
                      <td className="heat-fm"><b>{r.name}</b><div>{meta.formations.find((f) => f.code === r.formation)?.lithology}</div></td>
                      {FAMILIES.map((f) => {
                        const c = r.cells[f];
                        const a = 0.1 + Math.min(1, c.posterior * 1.8) * 0.8;
                        const on = cell.fm === r.formation && cell.fam === f;
                        return (
                          <td key={f}>
                            <button className={`heat-cell${on ? " on" : ""}`} onClick={() => setCell({ fm: r.formation, fam: f })}
                              aria-pressed={on} aria-label={`${r.name}, ${atlas.families[f]}: ${Math.round(c.posterior * 100)} percent`}
                              title={`${c.k_eff.toFixed(1)} of ${c.n_eff.toFixed(1)} relevance-weighted wells had this problem`}
                              style={{ background: hexA(FAMILY_COLOR[f], a), color: a > 0.62 ? "#fff" : "#0B1B34" }}>
                              <b>{Math.round(c.posterior * 100)}%</b>
                              <span>{Math.round(c.ci90[0] * 100)}–{Math.round(c.ci90[1] * 100)}%</span>
                            </button>
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </section>

        <section className="card" aria-labelledby="cell-h">
          <div className="card-h">
            <div>
              <div className="row" style={{ gap: 8 }}><FamilyDot family={cell.fam} size={12} /><span className="small strong" style={{ color: FAMILY_INK[cell.fam] }}>{meta.risk_families[cell.fam]}</span></div>
              <h3 id="cell-h" style={{ fontSize: "1.5rem", marginTop: 4 }}>{selRow?.name ?? "Select a cell"}</h3>
            </div>
          </div>
          <div className="card-b col" style={{ gap: 22 }}>
            {!sel ? <Loading /> : (
              <>
                <div className="grid-4">
                  <div className="stat"><div className="stat-l">Best estimate</div><div className="stat-v" style={{ color: FAMILY_INK[cell.fam] }}>{Math.round(sel.posterior * 100)}%</div></div>
                  <div className="stat"><div className="stat-l">90% range</div><div className="stat-v">{Math.round(sel.ci90[0] * 100)}–{Math.round(sel.ci90[1] * 100)}%</div></div>
                  <div className="stat"><div className="stat-l">Wells affected</div><div className="stat-v">{sel.wells_with_event.length}/{sel.n_wells}</div></div>
                  <div className="stat"><div className="stat-l">Average time lost</div><div className="stat-v">{sel.mean_npt_h ?? "–"}<span className="small muted"> {sel.mean_npt_h != null ? "h" : ""}</span></div></div>
                </div>

                <div className="grid-2" style={{ gap: 24, alignItems: "start" }}>
                  <div>
                    <h4 style={{ fontSize: "1.0625rem" }}>Where in the layer</h4>
                    <p className="small muted" style={{ margin: "4px 0 12px" }}>Share of weighted problems by position</p>
                    <div className="thirds">
                      {["Upper third", "Middle third", "Lower third"].map((lab, i) => {
                        const tot = sel.thirds.reduce((a, b) => a + b, 0) || 1;
                        return (
                          <div key={lab}>
                            <span>{lab}</span>
                            <div className="bar"><div style={{ width: `${(sel.thirds[i] / tot) * 100}%`, background: FAMILY_COLOR[cell.fam] }} /></div>
                            <b className="num" style={{ textAlign: "right" }}>{Math.round((sel.thirds[i] / tot) * 100)}%</b>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                  <div>
                    <h4 style={{ fontSize: "1.0625rem" }}>Risk matrix</h4>
                    <p className="small muted" style={{ margin: "4px 0 12px" }}>Likelihood {sel.likelihood}/5 × consequence {sel.consequence}/5</p>
                    <Matrix l={sel.likelihood} c={sel.consequence} />
                  </div>
                </div>

                <div>
                  <h4 style={{ fontSize: "1.0625rem", marginBottom: 10 }}>Recorded cases in this layer (whole field)</h4>
                  <div className="table-wrap" style={{ maxHeight: 360, border: "1px solid var(--line)", borderRadius: 16 }}>
                    {!events ? <Loading /> : (
                      <table className="t">
                        <thead><tr><th>Well</th><th>Depth</th><th>Problem</th><th>Outcome</th><th>Source</th></tr></thead>
                        <tbody>
                          {events.map((e) => (
                            <tr key={e.event_id} className="click" onClick={() => openEvidence({ kind: "event", eventId: e.event_id })}>
                              <td className="nowrap"><b>{e.well}</b></td>
                              <td className="n">{e.md_top.toFixed(0)} m</td>
                              <td>{EVENT_SHORT[e.type] ?? e.type_label}{e.subtype ? <span className="muted"> ({e.subtype})</span> : ""}</td>
                              <td>{outcomeBadge(e.outcome)}</td>
                              <td><span className="cite">{e.source.doc_id} p.{e.source.page}</span></td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                  </div>
                </div>

                <div>
                  <h4 style={{ fontSize: "1.0625rem", marginBottom: 10 }} className="row"><Wrench size={19} color="var(--primary)" aria-hidden />What was done about it</h4>
                  <Recommendations family={cell.fam} formation={cell.fm} />
                </div>
              </>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}

function Matrix({ l, c }: { l: number; c: number }) {
  const color = (li: number, ci: number) => {
    const s = li * ci;
    return s >= 15 ? "#F87171" : s >= 9 ? "#FB923C" : s >= 5 ? "#FCD34D" : "#86EFAC";
  };
  return (
    <div>
      <div className="matrix" role="img" aria-label={`Risk matrix: likelihood ${l} of 5, consequence ${c} of 5`}>
        {[5, 4, 3, 2, 1].map((li) => (
          <Fragment key={li}>
            <div className="ax">{li}</div>
            {[1, 2, 3, 4, 5].map((ci) => <div key={ci} className={li === l && ci === c ? "hit" : ""} style={{ background: color(li, ci) }}>{li === l && ci === c ? "●" : ""}</div>)}
          </Fragment>
        ))}
        <div className="ax" />
        {[1, 2, 3, 4, 5].map((ci) => <div key={ci} className="ax">{ci}</div>)}
      </div>
      <div className="xs muted" style={{ marginTop: 6, maxWidth: 280, display: "flex", justifyContent: "space-between" }}>
        <span>↑ Likelihood</span><span>Consequence →</span>
      </div>
    </div>
  );
}
