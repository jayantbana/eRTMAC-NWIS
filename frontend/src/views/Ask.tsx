import { useState } from "react";
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

export default function Ask() {
  const { meta, radius, openEvidence } = useApp();
  const [q, setQ] = useState(EXAMPLES[0]);
  const [res, setRes] = useState<AskResult | null>(null);
  const [busy, setBusy] = useState(false);
  const run = async (question: string) => {
    setQ(question);
    setBusy(true);
    try { setRes(await api.ask(question, radius)); } finally { setBusy(false); }
  };
  return (
    <div className="view" style={{ maxWidth: 1100, margin: "0 auto" }}>
      <div className="panel">
        <div className="panel-h">Ask NWIS · answers only from ingested OIL reports, with page citations</div>
        <div className="panel-b col">
          <div className="row">
            <input type="text" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === "Enter" && run(q)} style={{ flex: 1, padding: "9px 12px", fontSize: 14 }}
              placeholder="e.g. What happened in Barail in wells near Well A?" />
            <button className="btn primary" onClick={() => run(q)} disabled={busy}>Ask</button>
          </div>
          <div className="row" style={{ flexWrap: "wrap", gap: 6 }}>
            {EXAMPLES.map((e) => <span key={e} className="chip" onClick={() => run(e)}>{e}</span>)}
          </div>
          <div className="small dim">
            Mode: {meta.llm_enabled ? `local LLM (${meta.llm_model}) over retrieved evidence + citation verifier` : "extractive (verbatim sentences only). Set NWIS_LLM_MODEL to enable a local Ollama model."}
            {" "}Counting questions use typed database queries, not generated arithmetic.
          </div>
        </div>
      </div>
      {busy && <Loading what="Searching reports" />}
      {res && !busy && (
        <div className="panel" style={{ marginTop: 12 }}>
          <div className="panel-h">
            Answer <span className="spacer" />
            <span className={`badge ${res.evidence_status === "sufficient" ? "ok" : "warn"}`}>{res.evidence_status === "sufficient" ? "evidence found" : "insufficient evidence"}</span>
            <span className="badge">{res.mode.replace("_", " ")}</span>
          </div>
          <div className="panel-b col">
            <div style={{ fontSize: 14 }}>{res.answer}</div>
            {res.bullets.map((b, i) => (
              <div key={i} className="row" style={{ alignItems: "flex-start" }}>
                <span className="dim">•</span>
                <div style={{ flex: 1 }}>
                  “{b.text}”{" "}
                  {b.citations.map((c, k) => (
                    <span key={k} className="cite" onClick={() => openEvidence({ kind: "page", docId: c.doc_id, page: c.page, quote: c.quote })}>
                      {c.well} · {c.doc_type} {c.report_date ?? ""} · p.{c.page}
                    </span>
                  ))}
                </div>
              </div>
            ))}
            {res.table.length > 0 && (
              <table className="t small">
                <thead><tr><th>Well</th><th>MD</th><th>Formation</th><th>Event</th><th>Outcome</th><th>NPT</th><th>Source</th></tr></thead>
                <tbody>
                  {res.table.map((r: any) => (
                    <tr key={r.event_id} className="click" onClick={() => openEvidence({ kind: "event", eventId: r.event_id })}>
                      <td>{r.well}</td><td className="mono">{r.md.toFixed(0)}</td><td>{r.formation}</td><td>{r.type}{r.subtype ? ` (${r.subtype})` : ""}</td>
                      <td>{outcomeBadge(r.outcome)}</td><td className="mono">{r.npt_h ?? "–"}</td>
                      <td><span className="cite">{r.citation.doc_id} p.{r.citation.page}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {res.evidence_status === "insufficient" && res.closest && res.closest.length > 0 && (
              <div className="small muted">Closest passages (not answering the question):{" "}
                {res.closest.map((c: any, i: number) => (
                  <span key={i} className="cite" onClick={() => openEvidence({ kind: "page", docId: c.doc_id, page: c.page_no })}>{c.doc_id} p.{c.page_no}</span>
                ))}
              </div>
            )}
            <div className="small dim">
              Understood as: {res.parsed.intent} · families {res.parsed.families.join(", ") || "any"} · formations {res.parsed.formations.join(", ") || "any"}
              {" "}· scope {res.parsed.scope_wells ? `${res.parsed.scope_wells.length} well(s)` : "whole field"}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
