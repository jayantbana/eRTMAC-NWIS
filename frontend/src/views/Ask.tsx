import { useState } from "react";
import { ArrowRight, CheckCircle2, CircleHelp, FileText, MessageSquareText, Quote, Search, TriangleAlert } from "lucide-react";
import { api, type AskResult } from "../api";
import { useApp } from "../state";
import { Loading, outcomeBadge } from "../ui";

const EXAMPLES = [
  "What caused the stuck pipe in Well C and how was it freed?",
  "How many wells had mud losses in Tipam within 10 km of Well A?",
  "What worked in lower Tipam without losses?",
  "How was the kick in Well D handled?",
  "Any kick or overpressure problems in Well G?",
  "Which wells had cementing problems near Well A?",
];

// Plain names for how the answer was produced.
const MODE_LABEL: Record<string, string> = {
  extractive: "Quoted word for word", typed_tool: "Counted from the database", llm_verified: "Summarised, citations checked",
};

export default function Ask() {
  const { meta, radius, openEvidence } = useApp();
  const [q, setQ] = useState("");
  const [res, setRes] = useState<AskResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const run = async (question: string) => {
    if (!question.trim()) return;
    setQ(question);
    setBusy(true);
    setErr(null);
    try { setRes(await api.ask(question, radius)); } catch (e) { setErr(String(e)); } finally { setBusy(false); }
  };
  const ok = res?.evidence_status === "sufficient";

  return (
    <div className="page narrow">
      <div className="ask-hero">
        <div className="ic-tile t-pink"><MessageSquareText aria-hidden /></div>
        <h1 className="page-title" style={{ fontSize: "2.5rem" }}>Ask the drilling reports</h1>
        <p className="page-sub" style={{ margin: "12px auto 0" }}>
          Answers come only from the ingested reports. Every sentence is quoted word for word and links to its page. If the reports don't say, NWIS tells you so.
        </p>
        <form className="ask-box" onSubmit={(e) => { e.preventDefault(); run(q); }} role="search">
          <Search aria-hidden />
          <input type="text" value={q} onChange={(e) => setQ(e.target.value)} placeholder="e.g. What happened in Barail in wells near Well A?" aria-label="Your question" />
          <button className="btn btn-primary btn-lg" type="submit" disabled={busy || !q.trim()}>Ask <ArrowRight /></button>
        </form>
      </div>

      {!res && !busy && (
        <div style={{ marginTop: 8 }}>
          <div className="examples">
            {EXAMPLES.map((e) => <button key={e} className="ex" onClick={() => run(e)}><CircleHelp aria-hidden />{e}</button>)}
          </div>
        </div>
      )}

      {busy && <div className="card" style={{ marginTop: 28 }}><Loading what="Searching the reports" /></div>}
      {err && !busy && <div className="banner warn" style={{ marginTop: 28 }}><TriangleAlert aria-hidden />Could not get an answer: {err}</div>}

      {res && !busy && (
        <section className="card" style={{ marginTop: 28 }} aria-labelledby="answer-h">
          <div className="card-h">
            <div><div className="small strong muted">You asked</div><h3 id="answer-h" style={{ fontSize: "1.25rem" }}>{res.question}</h3></div>
            <div className="row wrap">
              {ok ? <span className="badge b-green"><CheckCircle2 /> Evidence found</span> : <span className="badge b-amber"><TriangleAlert /> Not enough evidence</span>}
              <span className="badge b-gray">{MODE_LABEL[res.mode] ?? res.mode.replace("_", " ")}</span>
            </div>
          </div>
          <div className="card-b col" style={{ gap: 16 }}>
            <p className="answer">{res.answer}</p>
            {res.bullets.map((b, i) => (
              <div key={i} className="quote">
                <Quote aria-hidden />
                <div style={{ minWidth: 0 }}>
                  <p>“{b.text}”</p>
                  <div className="cites">
                    {b.citations.map((c, k) => (
                      <button key={k} className="cite" onClick={() => openEvidence({ kind: "page", docId: c.doc_id, page: c.page, quote: c.quote })}>
                        <FileText aria-hidden />{c.well} · {c.doc_type} {c.report_date ?? ""} · page {c.page}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            ))}
            {res.table.length > 0 && (
              <div className="table-wrap" style={{ border: "1px solid var(--line)", borderRadius: 16 }}>
                <table className="t">
                  <thead><tr><th>Well</th><th>Depth</th><th>Rock layer</th><th>Problem</th><th>Outcome</th><th>Time lost</th><th>Source</th></tr></thead>
                  <tbody>
                    {res.table.map((r: any) => (
                      <tr key={r.event_id} className="click" onClick={() => openEvidence({ kind: "event", eventId: r.event_id })}>
                        <td className="nowrap"><b>{r.well}</b></td><td className="n">{r.md.toFixed(0)} m</td><td>{r.formation}</td>
                        <td>{r.type}{r.subtype ? <span className="muted"> ({r.subtype})</span> : ""}</td>
                        <td>{outcomeBadge(r.outcome)}</td><td className="n">{r.npt_h != null ? `${r.npt_h} h` : "–"}</td>
                        <td><span className="cite"><FileText aria-hidden />{r.citation.doc_id} p.{r.citation.page}</span></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {!ok && res.closest && res.closest.length > 0 && (
              <div className="banner note">
                <FileText aria-hidden />
                <div>
                  Closest passages found (they do not answer the question):
                  <div className="row wrap" style={{ gap: 6, marginTop: 8 }}>
                    {res.closest.map((c: any, i: number) => (
                      <button key={i} className="cite" onClick={() => openEvidence({ kind: "page", docId: c.doc_id, page: c.page_no })}>{c.doc_id} p.{c.page_no}</button>
                    ))}
                  </div>
                </div>
              </div>
            )}
            <div className="row wrap small muted" style={{ gap: 8 }}>
              <span className="strong">Understood as:</span>
              <span className="badge b-gray">{res.parsed.intent}</span>
              <span className="badge b-gray">problems: {res.parsed.families.join(", ") || "any"}</span>
              <span className="badge b-gray">layers: {res.parsed.formations.join(", ") || "any"}</span>
              <span className="badge b-gray">scope: {res.parsed.scope_wells ? `${res.parsed.scope_wells.length} well(s)` : "whole field"}</span>
            </div>
          </div>
          <div className="card-sep" />
          <div className="card-b" style={{ paddingTop: 16 }}>
            <div className="row wrap" style={{ justifyContent: "space-between" }}>
              <span className="small muted">
                {meta.llm_enabled ? `Local language model (${meta.llm_model}) over retrieved evidence, checked by a citation verifier.` : "Extractive mode: answers use verbatim sentences only."}
                {" "}Counting questions use database queries, not generated arithmetic.
              </span>
              <button className="btn btn-soft" onClick={() => { setRes(null); setQ(""); }}>Ask another question</button>
            </div>
          </div>
        </section>
      )}
    </div>
  );
}
