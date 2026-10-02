import { useEffect, useState, type ReactNode } from "react";
import {
  BadgeCheck, Check, ClipboardCheck, ExternalLink, Eye, FileSearch, FileText, History, Info, Library, MessageSquareText, Radar, ScanText, Search, Timer, X,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { api, apiUrl, type EventBrief } from "../api";
import { useApp } from "../state";
import { EVENT_SHORT, FamilyDot, Loading, PageHeader, Ring, Seg, fmt, outcomeBadge, statusBadge } from "../ui";

type Tab = "eval" | "events" | "docs" | "audit";
const pct = (v: number | null | undefined) => (v == null ? "–" : `${Math.round(v * 100)}%`);

export default function Knowledge() {
  const { meta } = useApp();
  const [tab, setTab] = useState<Tab>("eval");
  return (
    <div className="page">
      <PageHeader
        eyebrow="Knowledge & trust" icon={Library} title="Knowledge base"
        sub="Everything NWIS knows comes from here: the ingested reports, the problems extracted from them, expert reviews, and a measured report of how accurate it all is."
      />
      <div style={{ marginBottom: 22 }}>
        <Seg value={tab} onChange={setTab} label="Knowledge base sections" options={[
          { id: "eval", label: "Accuracy report", icon: BadgeCheck },
          { id: "events", label: "Review queue", icon: ClipboardCheck, count: meta.counts.needs_review },
          { id: "docs", label: "Document library", icon: FileText, count: meta.counts.documents },
          { id: "audit", label: "Audit trail", icon: History },
        ]} />
      </div>
      {tab === "eval" && <Evaluation />}
      {tab === "events" && <Events />}
      {tab === "docs" && <Docs />}
      {tab === "audit" && <Audit />}
    </div>
  );
}

function Metric({ label, value, sub, ring, color = "var(--primary)" }: { label: string; value: ReactNode; sub?: string; ring?: number; color?: string }) {
  return (
    <div className="metric">
      {ring != null && <Ring value={ring} size={58} stroke={7} color={color} />}
      <div style={{ minWidth: 0 }}>
        <div className="metric-v">{value}</div>
        <div className="metric-l">{label}</div>
        {sub && <div className="metric-s">{sub}</div>}
      </div>
    </div>
  );
}

function Section({ icon: Icon, tone, title, text, children }: { icon: LucideIcon; tone: string; title: string; text: string; children: ReactNode }) {
  return (
    <div className="eval-sec">
      <div>
        <div className={`ic-tile ${tone}`}><Icon aria-hidden /></div>
        <h3>{title}</h3>
        <p>{text}</p>
      </div>
      <div className="col" style={{ gap: 14 }}>{children}</div>
    </div>
  );
}

function Evaluation() {
  const [e, setE] = useState<any>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { api.evaluation().then(setE).catch((x) => setErr(String(x))); }, []);
  if (err) return <div className="banner warn"><Info aria-hidden />{err}</div>;
  if (!e) return <div className="card"><Loading what="Loading the accuracy report" /></div>;
  const x = e.extraction, rl = e.relevance, la = e.lookahead, pr = e.precursors, s = e.search, ing = e.ingest;
  const [pv, pt] = String(x.provenance_valid).split("/").map(Number);
  return (
    <div className="col" style={{ gap: 20 }}>
      <div className="banner info"><Info aria-hidden /><span>{e.note} Generated {e.generated_at}. The demo field is synthetic, so the true answers are known and every part is measured rather than claimed.</span></div>
      <section className="card">
        <Section icon={FileSearch} tone="t-blue" title="Reading the reports" text="How well NWIS finds drilling problems in the reports, compared with the known answers.">
          {ing && (
            <div className="grid-4">
              <Metric label="Documents" value={ing.documents} sub={`${ing.pages} pages`} />
              <Metric label="Scanned pages (OCR)" value={ing.ocr_pages} sub="no text layer" />
              <Metric label="Problems in the knowledge base" value={ing.events} sub={`${ing.candidates} mentions merged`} />
              <Metric label="Waiting for expert review" value={ing.needs_review} sub="low-confidence problems" />
            </div>
          )}
          <div className="grid-4">
            <Metric label="Precision" value={pct(x.precision)} ring={x.precision} />
            <Metric label="Recall" value={pct(x.recall)} ring={x.recall} sub={`digital ${pct(x.digital_sources.recall)} · scanned ${pct(x.scanned_only_sources.recall)}`} />
            <Metric label="F1 score" value={pct(x.f1)} ring={x.f1} />
            <Metric label="Quotes verified on page" value={x.provenance_valid} ring={pt ? pv / pt : 0} color="var(--green)" />
          </div>
          <div className="grid-3">
            <Metric label="Depth error (median / P90)" value={`${x.depth_abs_error_m.median} / ${x.depth_abs_error_m.p90} m`} sub={`${pct(x.depth_abs_error_m.within_5m)} within 5 m`} />
            <Metric label="Rock layer correct" value={pct(x.formation_accuracy)} />
            <Metric label="True / extracted / matched" value={`${x.truth_events} / ${x.extracted_events} / ${x.matched}`} />
          </div>
        </Section>
        <Section icon={Radar} tone="t-green" title="Choosing guide wells" text={`Leave-one-well-out test on ${rl.wells_evaluated} wells: does the ranking put the most similar wells first?`}>
          <div className="grid-3">
            <Metric label="NWIS ranking (NDCG@5)" value={rl.ndcg5_relevance} />
            <Metric label="Distance only (NDCG@5)" value={rl.ndcg5_distance_only} />
            <Metric label="Improvement" value={`${rl.improvement_pct > 0 ? "+" : ""}${rl.improvement_pct}%`} color="var(--green)" />
          </div>
        </Section>
        <Section icon={Timer} tone="t-saffron" title="Warning ahead of time" text="Back-test that uses only wells drilled earlier: how many real problems were flagged before the bit got there?">
          <div className="grid-2">
            <Metric label="NWIS: problems flagged ahead" value={pct(la.ours.event_recall)} ring={la.ours.event_recall} color="var(--saffron)" sub={`${pct(la.ours.share_of_hole_flagged)} of the hole flagged`} />
            <Metric label="Baseline: raw depth + distance" value={pct(la.baseline.event_recall)} ring={la.baseline.event_recall} color="var(--faint)" sub={`${pct(la.baseline.share_of_hole_flagged)} of the hole flagged`} />
          </div>
          <p className="small muted">{la.method}</p>
        </Section>
        {pr && (
          <Section icon={ScanText} tone="t-violet" title="Real-time early warnings" text={`Live models, validated with ${pr.validation}.`}>
            <div className="table-wrap" style={{ border: "1px solid var(--line)", borderRadius: 16 }}>
              <table className="t">
                <thead><tr><th>Problem</th><th>Model AUC</th><th>Problems caught</th><th>Median warning</th><th>False alarms / day</th><th>Rules caught</th><th>Rules false alarms</th></tr></thead>
                <tbody>
                  {Object.entries(pr.tier2_logistic).map(([k, v]: any) => (
                    <tr key={k}>
                      <td><span className="row" style={{ gap: 8 }}><FamilyDot family={k} /><b>{k}</b></span></td>
                      <td className="n">{v.auc_grouped_cv}</td><td className="n">{pct(v.event_recall)}</td>
                      <td className="n">{v.median_lead_min} min</td><td className="n">{v.false_alarms_per_24h}</td>
                      <td className="n">{pct(pr.tier1_rules[k]?.event_recall)}</td><td className="n">{pr.tier1_rules[k]?.false_alarms_per_24h}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="small muted">{pr.alarm_definition}</p>
          </Section>
        )}
        {s && !s.error && (
          <Section icon={MessageSquareText} tone="t-pink" title="Answering questions" text="Grounded search over the reports, tested with questions whose answers are known.">
            <div className="grid-3">
              <Metric label="Right source in top 5" value={pct(s.recall_at_5)} ring={s.recall_at_5} color="#DB2777" sub={`${s.golden_questions} test questions`} />
              <Metric label="Correct “not enough evidence”" value={pct(s.correct_insufficient_evidence)} ring={s.correct_insufficient_evidence} color="#DB2777" sub={`${s.unanswerable_questions} unanswerable questions`} />
              <Metric label="Citation policy" value="Verbatim" sub={s.citation_policy} />
            </div>
          </Section>
        )}
      </section>
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
    <section className="card">
      <div className="card-h">
        <div><h3>Problems extracted from the reports</h3><p>Check low-confidence extractions against the source page, then accept or reject them.</p></div>
        <label className="field">Show
          <select value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="needs_review">Needs review</option>
            <option value="">All problems</option>
            <option value="auto">Auto-accepted</option>
            <option value="curated">Expert-checked</option>
          </select>
        </label>
      </div>
      <div className="card-sep" />
      {!rows ? <Loading /> : rows.length === 0 ? <div className="empty"><div className="empty-ic"><Check /></div><h4>Nothing to review</h4><p>Every extracted problem in this view has been checked.</p></div> : (
        <div className="table-wrap">
          <table className="t">
            <thead><tr><th>Well</th><th>Depth</th><th>Problem</th><th>Rock layer</th><th>Outcome</th><th>Confidence</th><th>Source</th><th>Status</th><th style={{ textAlign: "right" }}>Actions</th></tr></thead>
            <tbody>
              {rows.map((e) => (
                <tr key={e.event_id}>
                  <td className="nowrap"><b>{e.well}</b></td>
                  <td className="n">{e.md_top.toFixed(0)} m</td>
                  <td><span className="row" style={{ gap: 8 }}><FamilyDot family={e.family} /><span>{EVENT_SHORT[e.type] ?? e.type_label}{e.subtype ? <span className="muted"> ({e.subtype})</span> : ""}</span></span></td>
                  <td>{e.formation_name}</td>
                  <td>{outcomeBadge(e.outcome)}</td>
                  <td className="n">{Math.round(e.confidence * 100)}%</td>
                  <td className="small muted nowrap">{e.source.doc_id} p.{e.source.page}{e.source.method === "ocr" ? " · OCR" : ""}{e.n_sources > 1 ? ` +${e.n_sources - 1}` : ""}</td>
                  <td>{statusBadge(e.status)}</td>
                  <td>
                    <div className="actions">
                      <button className="btn btn-sm btn-soft" onClick={() => openEvidence({ kind: "event", eventId: e.event_id })}><Eye /> View</button>
                      {e.status !== "curated" && <button className="btn btn-sm btn-success" onClick={() => act(e.event_id, "curated")}><Check /> Accept</button>}
                      <button className="btn btn-sm btn-danger" onClick={() => act(e.event_id, "rejected")}><X /> Reject</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="card-sep" />
      <p className="small muted" style={{ padding: "14px 24px" }}>Every accept and reject is written to the audit trail. Rejected problems are removed from risk analysis immediately. {fmt.int(meta.counts.events)} problems in total.</p>
    </section>
  );
}

function Docs() {
  const { openEvidence } = useApp();
  const [docs, setDocs] = useState<any[] | null>(null);
  const [q, setQ] = useState("");
  useEffect(() => { api.documents().then(setDocs); }, []);
  const shown = (docs ?? []).filter((d) => !q || `${d.doc_id} ${d.well_id} ${d.doc_type} ${d.report_date ?? ""}`.toLowerCase().includes(q.toLowerCase()));
  return (
    <section className="card">
      <div className="card-h">
        <div><h3>Ingested documents</h3><p>Daily drilling reports (DDR) and well completion reports (WCR). Select a row to read it.</p></div>
        <label className="field" style={{ position: "relative" }}>
          <Search size={18} style={{ position: "absolute", left: 12, color: "var(--faint)" }} aria-hidden />
          <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filter by well, type or date" aria-label="Filter documents" style={{ paddingLeft: 38, width: 280 }} />
        </label>
      </div>
      <div className="card-sep" />
      {!docs ? <Loading /> : (
        <div className="table-wrap" style={{ maxHeight: "70vh" }}>
          <table className="t">
            <thead><tr><th>Document</th><th>Well</th><th>Type</th><th>Date</th><th>Pages</th><th>Source</th><th /></tr></thead>
            <tbody>
              {shown.map((d) => (
                <tr key={d.doc_id} className="click" onClick={() => openEvidence({ kind: "page", docId: d.doc_id, page: 1 })}>
                  <td><span className="row" style={{ gap: 10 }}><FileText size={18} color="var(--primary)" aria-hidden /><b>{d.doc_id}</b></span></td>
                  <td>Well {d.well_id}</td>
                  <td>{d.doc_type === "DDR" ? "Daily drilling report" : d.doc_type === "WCR" ? "Well completion report" : d.doc_type}</td>
                  <td className="nowrap">{d.report_date ?? "–"}</td>
                  <td className="n">{d.pages}</td>
                  <td>{d.ocr_pages > 0 ? <span className="badge b-violet">Scanned · OCR</span> : <span className="badge b-blue">Digital text</span>}</td>
                  <td><a className="btn btn-sm" href={apiUrl(`/api/documents/${d.doc_id}/pdf`)} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}>PDF <ExternalLink /></a></td>
                </tr>
              ))}
            </tbody>
          </table>
          {shown.length === 0 && <div className="empty"><p>No documents match “{q}”.</p></div>}
        </div>
      )}
    </section>
  );
}

function Audit() {
  const [rows, setRows] = useState<any[] | null>(null);
  useEffect(() => { api.audit().then(setRows); }, []);
  return (
    <section className="card">
      <div className="card-h"><div><h3>Audit trail</h3><p>Append-only record of every expert review and acknowledgement. The latest 50 entries are shown.</p></div></div>
      <div className="card-sep" />
      {!rows ? <Loading /> : rows.length === 0 ? <div className="empty"><div className="empty-ic"><History /></div><h4>No entries yet</h4><p>Reviews and acknowledgements will appear here.</p></div> : (
        <div className="table-wrap">
          <table className="t">
            <thead><tr><th>Time</th><th>User</th><th>Action</th><th>Object</th><th>Detail</th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td className="nowrap n">{r.ts}</td><td>{r.user}</td><td><span className="badge b-blue">{r.action.replace(/_/g, " ")}</span></td>
                  <td className="nowrap"><b>{r.object_id}</b></td><td className="mono xs muted" style={{ maxWidth: 520, overflowWrap: "anywhere" }}>{r.detail}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
