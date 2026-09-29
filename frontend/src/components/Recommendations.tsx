import { useEffect, useState } from "react";
import { api, type Recommendation } from "../api";
import { useApp } from "../state";
import { Loading, outcomeBadge } from "../ui";

export default function Recommendations({ family, formation, md }: { family: string; formation: string | null; md?: number }) {
  const { radius, openEvidence } = useApp();
  const [rec, setRec] = useState<Recommendation | null>(null);
  useEffect(() => {
    setRec(null);
    api.recommend(family, formation, radius, md).then(setRec).catch(() => setRec(null));
  }, [family, formation, radius, md]);
  if (!rec) return <Loading what="Searching similar historical cases" />;
  return (
    <div className="col">
      <div className="small muted">
        {rec.cases_considered} similar historical {rec.family_label.toLowerCase()} cases considered
        {rec.formation_name ? ` (priority: ${rec.formation_name})` : ""}, ranked by similarity × outcome.
      </div>
      {rec.actions.length === 0 && <div className="small muted">No recorded mitigations for similar cases.</div>}
      {rec.actions.map((a) => (
        <div key={a.action} className="stat" style={{ minWidth: 0 }}>
          <div className="row"><b>{a.label}</b><span className="spacer" /><span className="badge ok">{Math.round(a.success_rate * 100)}% resolved/partial</span></div>
          <div className="small" style={{ margin: "4px 0" }}>{a.statement}</div>
          <div className="col" style={{ gap: 3 }}>
            {a.cases.slice(0, 3).map((c) => (
              <div key={c.event_id + a.action} className="row small" style={{ minWidth: 0, overflow: "hidden" }}>
                <span className="cite" onClick={() => openEvidence({ kind: "page", docId: c.doc_id, page: c.page, quote: c.quote })}>
                  {c.well} · {c.doc_id} p.{c.page}
                </span>
                <span className="dim">{c.md.toFixed(0)} m</span>
                {outcomeBadge(c.outcome)}
                <span className="dim" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>“{c.quote}”</span>
              </div>
            ))}
          </div>
        </div>
      ))}
      {rec.practices.length > 0 && (
        <div className="stat" style={{ borderColor: "#14532d" }}>
          <b>What worked in trouble-free offsets</b>
          {rec.practices.map((p) => (
            <div key={p.event_id} className="small" style={{ marginTop: 6 }}>
              <span className="cite" onClick={() => openEvidence({ kind: "page", docId: p.doc_id, page: p.page, quote: p.summary })}>
                {p.well} · {p.doc_id} p.{p.page}
              </span>{" "}
              <span className="muted">{p.summary}</span>
            </div>
          ))}
        </div>
      )}
      {rec.not_effective.length > 0 && (
        <div className="small muted">Recorded with poor outcomes: {rec.not_effective.map((a) => `${a.label} (${Math.round(a.success_rate * 100)}%)`).join(", ")}</div>
      )}
      <div className="disclaimer">{rec.disclaimer}</div>
    </div>
  );
}
