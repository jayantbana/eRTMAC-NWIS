import { useEffect, useState } from "react";
import { FileText, ShieldCheck, Sprout } from "lucide-react";
import { api, type Recommendation } from "../api";
import { useApp } from "../state";
import { Bar, Loading, fmt, outcomeBadge } from "../ui";

export default function Recommendations({ family, formation, md }: { family: string; formation: string | null; md?: number }) {
  const { radius, openEvidence } = useApp();
  const [rec, setRec] = useState<Recommendation | null>(null);
  useEffect(() => {
    setRec(null);
    api.recommend(family, formation, radius, md).then(setRec).catch(() => setRec(null));
  }, [family, formation, radius, md]);
  if (!rec) return <Loading what="Searching similar past cases" />;
  return (
    <div className="col" style={{ gap: 12 }}>
      <p className="small muted">
        {rec.cases_considered} similar past {rec.family_label.toLowerCase()} cases{rec.formation_name ? `, ${rec.formation_name} first` : ""}, ranked by similarity and outcome.
      </p>
      {rec.actions.length === 0 && <div className="small muted">No recorded fixes for similar cases.</div>}
      {rec.actions.map((a) => (
        <div key={a.action} className="rec">
          <div className="row" style={{ alignItems: "flex-start" }}>
            <h5 style={{ flex: 1 }}>{a.label}</h5>
            <span className="badge b-green nowrap">{Math.round(a.success_rate * 100)}% worked</span>
          </div>
          <div style={{ marginTop: 8 }}><Bar value={a.success_rate} color="var(--green)" height={6} /></div>
          <p className="rec-stmt">{a.statement}</p>
          {a.cases.slice(0, 3).map((c) => (
            <div key={c.event_id + a.action} className="rec-case">
              <button className="cite" onClick={() => openEvidence({ kind: "page", docId: c.doc_id, page: c.page, quote: c.quote })}>
                <FileText aria-hidden />{c.well} · p.{c.page}
              </button>
              <span className="muted nowrap">{fmt.int(c.md)} m</span>
              {outcomeBadge(c.outcome)}
              <span className="q" title={c.quote}>“{c.quote}”</span>
            </div>
          ))}
        </div>
      ))}
      {rec.practices.length > 0 && (
        <div className="rec-good">
          <h5><Sprout aria-hidden />What worked in trouble-free wells</h5>
          {rec.practices.map((p) => (
            <div key={p.event_id} style={{ marginTop: 8, fontSize: ".93rem" }}>
              <button className="cite" onClick={() => openEvidence({ kind: "page", docId: p.doc_id, page: p.page, quote: p.summary })}>
                <FileText aria-hidden />{p.well} · p.{p.page}
              </button>{" "}
              <span className="ink2">{p.summary}</span>
            </div>
          ))}
        </div>
      )}
      {rec.not_effective.length > 0 && (
        <p className="small muted">Recorded with poor outcomes: {rec.not_effective.map((a) => `${a.label} (${Math.round(a.success_rate * 100)}%)`).join(", ")}</p>
      )}
      <p className="disclaimer"><ShieldCheck aria-hidden />{rec.disclaimer}</p>
    </div>
  );
}
