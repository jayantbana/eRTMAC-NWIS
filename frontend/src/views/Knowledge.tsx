import { useEffect, useState } from "react";
import { api, type EventBrief } from "../api";
import { useApp } from "../state";
import { FamilyDot, Loading, outcomeBadge } from "../ui";

export default function Knowledge() {
  const [tab, setTab] = useState<"eval" | "events" | "docs" | "audit">("eval");
  return (
    <div className="view">
      <div className="row" style={{ marginBottom: 10 }}>
        {([["eval", "Evaluation (trust report)"], ["events", "Events & curation"], ["docs", "Documents"], ["audit", "Audit log"]] as const).map(([k, l]) => (
          <button key={k} className={`tab ${tab === k ? "active" : ""}`} onClick={() => setTab(k)}>{l}</button>
        ))}
      </div>
      {tab === "eval" && <Evaluation />}
      {tab === "events" && <Events />}
      {tab === "docs" && <Docs />}
      {tab === "audit" && <Audit />}
    </div>
  );
}

function Metric({ label, value, sub }: { label: string; value: any; sub?: string }) {
  return <div className="stat"><div className="label">{label}</div><div className="big" style={{ fontSize: 20 }}>{value}</div>{sub && <div className="small dim">{sub}</div>}</div>;
}
const pct = (v: number | null | undefined) => (v == null ? "–" : `${Math.round(v * 100)}%`);

function Evaluation() {
  const [e, setE] = useState<any>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { api.evaluation().then(setE).catch((x) => setErr(String(x))); }, []);
  if (err) return <div className="notice">{err}</div>;
  if (!e) return <Loading />;
  const x = e.extraction, rl = e.relevance, la = e.lookahead, pr = e.precursors, s = e.search, ing = e.ingest;
  return (
    <div className="col" style={{ gap: 12 }}>
      <div className="notice">{e.note} Generated {e.generated_at}. Ground truth exists because the demo field is synthetic, so every component is measured, not asserted.</div>
      {ing && (
        <div className="panel"><div className="panel-h">Ingestion</div><div className="panel-b grid4">
          <Metric label="Documents" value={ing.documents} sub={`${ing.pages} pages`} />
          <Metric label="OCR pages" value={ing.ocr_pages} sub="scanned, no text layer" />
          <Metric label="Events in KB" value={ing.events} sub={`${ing.candidates} candidate mentions merged`} />
          <Metric label="Curator queue" value={ing.needs_review} sub="low-confidence events" />
        </div></div>
      )}
      <div className="panel"><div className="panel-h">Document intelligence · event extraction vs ground truth</div><div className="panel-b col">
        <div className="grid4">
          <Metric label="Precision" value={pct(x.precision)} />
          <Metric label="Recall" value={pct(x.recall)} sub={`digital ${pct(x.digital_sources.recall)} · scanned-only ${pct(x.scanned_only_sources.recall)}`} />
          <Metric label="F1" value={pct(x.f1)} />
          <Metric label="Provenance valid" value={x.provenance_valid} sub="quote found verbatim on cited page" />
        </div>
        <div className="grid3">
          <Metric label="Depth error (median / P90)" value={`${x.depth_abs_error_m.median} / ${x.depth_abs_error_m.p90} m`} sub={`${pct(x.depth_abs_error_m.within_5m)} within 5 m`} />
          <Metric label="Formation accuracy" value={pct(x.formation_accuracy)} />
          <Metric label="Truth / extracted / matched" value={`${x.truth_events} / ${x.extracted_events} / ${x.matched}`} />
        </div>
      </div></div>
      <div className="grid2">
        <div className="panel"><div className="panel-h">Offset relevance (leave-one-well-out)</div><div className="panel-b grid3">
          <Metric label="NDCG@5 relevance" value={rl.ndcg5_relevance} />
          <Metric label="NDCG@5 distance-only" value={rl.ndcg5_distance_only} />
          <Metric label="Improvement" value={`${rl.improvement_pct > 0 ? "+" : ""}${rl.improvement_pct}%`} sub={`${rl.wells_evaluated} wells`} />
        </div></div>
        <div className="panel"><div className="panel-h">Look-ahead backtest (only earlier wells used)</div><div className="panel-b grid2">
          <Metric label="NWIS event recall" value={pct(la.ours.event_recall)} sub={`${pct(la.ours.share_of_hole_flagged)} of hole flagged`} />
          <Metric label="Baseline recall" value={pct(la.baseline.event_recall)} sub={`raw MD + distance, ${pct(la.baseline.share_of_hole_flagged)} flagged`} />
        </div><div className="small dim" style={{ padding: "0 12px 10px" }}>{la.method}</div></div>
      </div>
      {pr && (
        <div className="panel"><div className="panel-h">Real-time precursors · {pr.validation}</div><div className="panel-b">
          <table className="t">
            <thead><tr><th>Risk</th><th>Tier-2 AUC</th><th>Tier-2 event recall</th><th>Median lead</th><th>False alarms / 24 h</th><th>Tier-1 rules recall</th><th>Rules FA / 24 h</th></tr></thead>
            <tbody>
              {Object.entries(pr.tier2_logistic).map(([k, v]: any) => (
                <tr key={k}><td><FamilyDot family={k} /> {k}</td><td className="mono">{v.auc_grouped_cv}</td><td className="mono">{pct(v.event_recall)}</td>
                  <td className="mono">{v.median_lead_min} min</td><td className="mono">{v.false_alarms_per_24h}</td>
                  <td className="mono">{pct(pr.tier1_rules[k]?.event_recall)}</td><td className="mono">{pr.tier1_rules[k]?.false_alarms_per_24h}</td></tr>
              ))}
            </tbody>
          </table>
          <div className="small dim" style={{ marginTop: 6 }}>{pr.alarm_definition}</div>
        </div></div>
      )}
      {s && !s.error && (
        <div className="panel"><div className="panel-h">Ask NWIS (grounded search)</div><div className="panel-b grid3">
          <Metric label="Retrieval recall@5" value={pct(s.recall_at_5)} sub={`${s.golden_questions} golden questions`} />
          <Metric label="Correct 'insufficient evidence'" value={pct(s.correct_insufficient_evidence)} sub={`${s.unanswerable_questions} unanswerable questions`} />
          <Metric label="Citation policy" value="verbatim" sub={s.citation_policy} />
        </div></div>
      )}
    </div>
  );
}

function Events() {
  const { openEvidence, bumpData, meta } = useApp();
  const [status, setStatus] = useState("needs_review");
  const [rows, setRows] = useState<EventBrief[] | null>(null);
  const load = () => api.events(status ? { status } : {}).then(setRows);
  useEffect(() => { setRows(null); load(); }, [status]);
  const act = async (id: string, s: string) => {
    await api.review(id, { status: s, user: "curator", note: "reviewed in NWIS console" });
    bumpData();
    load();
  };
  return (
    <div className="panel">
      <div className="panel-h">
        Knowledge base events <span className="spacer" />
        <select value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="needs_review">Curator queue (needs review)</option>
          <option value="">All events</option>
          <option value="auto">Auto-accepted</option>
          <option value="curated">Curated</option>
        </select>
      </div>
      <div className="panel-b flush">
        {!rows ? <Loading /> : rows.length === 0 ? <div className="small muted" style={{ padding: 12 }}>Nothing here.</div> : (
          <table className="t small">
            <thead><tr><th>Well</th><th>MD</th><th>Event</th><th>Formation</th><th>Outcome</th><th>Conf.</th><th>Sources</th><th>Status</th><th /></tr></thead>
            <tbody>
              {rows.map((e) => (
                <tr key={e.event_id}>
                  <td>{e.well}</td><td className="mono">{e.md_top.toFixed(0)}</td>
                  <td className="click" onClick={() => openEvidence({ kind: "event", eventId: e.event_id })} style={{ cursor: "pointer" }}><FamilyDot family={e.family} /> {e.type_label}{e.subtype ? ` (${e.subtype})` : ""}</td>
                  <td>{e.formation_name}</td><td>{outcomeBadge(e.outcome)}</td><td className="mono">{Math.round(e.confidence * 100)}%</td>
                  <td className="mono dim">{e.source.doc_id} p.{e.source.page}{e.source.method === "ocr" ? " · OCR" : ""}{e.n_sources > 1 ? ` +${e.n_sources - 1}` : ""}</td>
                  <td><span className={`badge ${e.status === "needs_review" ? "warn" : "ok"}`}>{e.status}</span></td>
                  <td className="row">
                    <button className="btn small" onClick={() => openEvidence({ kind: "event", eventId: e.event_id })}>View</button>
                    {e.status !== "curated" && <button className="btn small" onClick={() => act(e.event_id, "curated")}>Accept</button>}
                    <button className="btn small danger" onClick={() => act(e.event_id, "rejected")}>Reject</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      <div className="small dim" style={{ padding: 8 }}>Every accept/reject is written to the audit log; rejected events are removed from risk analytics immediately. {meta.counts.events} events total.</div>
    </div>
  );
}

function Docs() {
  const { openEvidence } = useApp();
  const [docs, setDocs] = useState<any[] | null>(null);
  useEffect(() => { api.documents().then(setDocs); }, []);
  if (!docs) return <Loading />;
  return (
    <div className="panel"><div className="panel-h">Ingested documents ({docs.length})</div>
      <div className="panel-b flush">
        <table className="t small">
          <thead><tr><th>Document</th><th>Well</th><th>Type</th><th>Date</th><th>Pages</th><th>Acquisition</th><th /></tr></thead>
          <tbody>
            {docs.map((d) => (
              <tr key={d.doc_id} className="click" onClick={() => openEvidence({ kind: "page", docId: d.doc_id, page: 1 })}>
                <td className="mono">{d.doc_id}</td><td>{d.well_id}</td><td>{d.doc_type}</td><td>{d.report_date}</td><td>{d.pages}</td>
                <td>{d.ocr_pages > 0 ? <span className="badge ocr">scanned → OCR</span> : <span className="badge">text layer</span>}</td>
                <td><a href={`/api/documents/${d.doc_id}/pdf`} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}>PDF ↗</a></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Audit() {
  const [rows, setRows] = useState<any[] | null>(null);
  useEffect(() => { api.audit().then(setRows); }, []);
  if (!rows) return <Loading />;
  return (
    <div className="panel"><div className="panel-h">Audit log (append-only)</div>
      <div className="panel-b flush">
        <table className="t small">
          <thead><tr><th>Time</th><th>User</th><th>Action</th><th>Object</th><th>Detail</th></tr></thead>
          <tbody>{rows.map((r) => <tr key={r.id}><td className="mono">{r.ts}</td><td>{r.user}</td><td>{r.action}</td><td className="mono">{r.object_id}</td><td className="mono dim small">{r.detail}</td></tr>)}</tbody>
        </table>
      </div>
    </div>
  );
}
