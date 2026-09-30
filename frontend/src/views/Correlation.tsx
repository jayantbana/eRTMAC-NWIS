import { useEffect, useMemo, useState } from "react";
import { AlignVerticalJustifyStart, ArrowDownUp, Columns3 } from "lucide-react";
import { api, type Offset } from "../api";
import { useApp } from "../state";
import { EVENT_SHORT, FAMILY_COLOR, FORMATION_COLOR, FORMATION_LINE, Loading, PageHeader, Seg } from "../ui";

export default function Correlation({ offsets }: { offsets: Offset[] }) {
  const { meta, openEvidence, openWell } = useApp();
  const thr = meta.thresholds.relevance_include;
  const [sel, setSel] = useState<string[]>([]);
  const [data, setData] = useState<any[] | null>(null);
  const [mode, setMode] = useState<"tvdss" | "flatten">("flatten");
  const [datum, setDatum] = useState("BRL");

  useEffect(() => {
    if (!offsets.length) return;
    const rel = offsets.filter((x) => x.overall >= thr).slice(0, 5).map((x) => x.well_id);
    const cross = offsets.find((x) => !x.same_compartment);
    setSel([meta.active_well_id, ...rel, ...(cross ? [cross.well_id] : [])]);
  }, [offsets]);

  useEffect(() => {
    if (sel.length) api.correlation(sel).then(setData);
  }, [sel.join(",")]);

  const relMap = useMemo(() => new Map(offsets.map((o) => [o.well_id, o])), [offsets]);
  const datumName = meta.formations.find((f) => f.code === datum)?.name;

  return (
    <div className="page">
      <PageHeader
        eyebrow="Cross-well correlation" icon={Columns3} title="Compare wells side by side"
        sub="Line up the rock layers of several wells. Problems that happened at the same geological position then appear at the same height, even when their depths differ."
        actions={
          <Seg value={mode} onChange={setMode} label="Vertical alignment"
            options={[{ id: "flatten", label: "Align on a layer top", icon: AlignVerticalJustifyStart }, { id: "tvdss", label: "True vertical depth", icon: ArrowDownUp }]} />
        }
      />
      <div className="cmp-layout">
        <section className="card" aria-labelledby="wells-h">
          <div className="card-h"><div><h3 id="wells-h">Wells shown</h3><p>Relevant wells are pre-selected, plus one across a fault for contrast.</p></div></div>
          <div className="card-b col" style={{ gap: 14 }}>
            {mode === "flatten" && (
              <label className="col" style={{ gap: 6 }}>
                <span className="small strong muted">Align every well on the top of</span>
                <select value={datum} onChange={(e) => setDatum(e.target.value)}>
                  {meta.formations.filter((f) => !["ALV", "BSM"].includes(f.code)).map((f) => <option key={f.code} value={f.code}>{f.name}</option>)}
                </select>
              </label>
            )}
            <div className="col" style={{ gap: 2, margin: "0 -12px" }}>
              <label className="wcheck">
                <input type="checkbox" checked disabled />
                <span><b style={{ color: "var(--saffron-ink)" }}>{meta.active_well_name}</b> <span className="xs muted">drilling</span></span>
                <span />
              </label>
              {offsets.slice(0, 16).map((o) => (
                <label key={o.well_id} className={`wcheck${o.overall >= thr ? "" : " low"}`}>
                  <input type="checkbox" checked={sel.includes(o.well_id)}
                    onChange={(e) => setSel(e.target.checked ? [...sel, o.well_id] : sel.filter((x) => x !== o.well_id))} />
                  <span className="ellipsis"><b>{o.name}</b> <span className="xs muted">{o.same_compartment ? "same block" : "across a fault"}</span></span>
                  <span className={`badge ${o.overall >= thr ? "b-green" : "b-gray"}`}>{o.overall.toFixed(2)}</span>
                </label>
              ))}
            </div>
          </div>
        </section>

        <section className="card" aria-labelledby="corr-h">
          <div className="card-h">
            <div>
              <h3 id="corr-h">{mode === "flatten" ? `Rock layers aligned on the top of ${datumName}` : "Rock layers at true vertical depth"}</h3>
              <p>Click a well name for its details, or a dot to open the report it came from.</p>
            </div>
          </div>
          <div className="legend-row" style={{ padding: "0 24px 16px" }}>
            {Object.entries(meta.risk_families).map(([k, v]) => <span key={k}><span className="fdot" style={{ width: 11, height: 11, background: FAMILY_COLOR[k] }} />{v}</span>)}
            <span><span className="fdot" style={{ width: 11, height: 11, background: FAMILY_COLOR.PR }} />Good practice</span>
          </div>
          <div className="card-sep" />
          {!data ? <Loading what="Lining up rock layers" /> : <Chart data={data} mode={mode} datum={datum} datumName={datumName} relMap={relMap}
            onWell={openWell} onEvent={(id) => openEvidence({ kind: "event", eventId: id })} />}
        </section>
      </div>
    </div>
  );
}

function Chart({ data, mode, datum, datumName, relMap, onWell, onEvent }: {
  data: any[]; mode: "tvdss" | "flatten"; datum: string; datumName?: string; relMap: Map<string, Offset>; onWell: (id: string) => void; onEvent: (id: string) => void;
}) {
  const shift = (w: any) => {
    if (mode === "tvdss") return 0;
    const t = w.tops.find((x: any) => x.code === datum);
    return t ? t.tvdss_top : 0;
  };
  const yMin = mode === "tvdss" ? 2000 : -700;
  const yMax = mode === "tvdss" ? 3300 : 500;
  const H = 780, top = 84, colW = 158, gap = 72, left = 78, barW = 78;
  const y = (v: number) => top + ((v - yMin) / (yMax - yMin)) * (H - top - 24);
  const W = left + data.length * (colW + gap);
  const ticks: number[] = [];
  for (let v = Math.ceil(yMin / 100) * 100; v <= yMax; v += 100) ticks.push(v);

  return (
    <div className="chart-scroll">
      <svg width={W} height={H} role="img" aria-label="Correlation chart of rock layers and recorded problems across the selected wells">
        {ticks.map((v) => (
          <g key={v}>
            <line x1={left - 6} x2={W} y1={y(v)} y2={y(v)} stroke="#EDF1F7" />
            <text x={left - 12} y={y(v) + 4} fontSize={12} fill="#7A889E" textAnchor="end" fontWeight={600}>{mode === "flatten" ? (v > 0 ? `+${v}` : v) : v}</text>
          </g>
        ))}
        <text transform={`translate(18, ${(H + top) / 2}) rotate(-90)`} fontSize={12} fill="#56667F" textAnchor="middle" fontWeight={700}>
          {mode === "flatten" ? `metres relative to the top of ${datumName}` : "true vertical depth below sea level (m)"}
        </text>
        {/* correlation lines between adjacent wells */}
        {data.slice(0, -1).map((w, i) => {
          const n = data[i + 1];
          const x1 = left + i * (colW + gap) + barW, x2 = left + (i + 1) * (colW + gap);
          return w.tops.map((t: any) => {
            const t2 = n.tops.find((x: any) => x.code === t.code);
            if (!t2) return null;
            return <line key={`${w.id}-${t.code}`} x1={x1} x2={x2} y1={y(t.tvdss_top - shift(w))} y2={y(t2.tvdss_top - shift(n))}
              stroke={FORMATION_LINE[t.code] ?? "#94A3B8"} strokeWidth={1.8} strokeDasharray="6 4" opacity={0.9} />;
          });
        })}
        {data.map((w, i) => {
          const x = left + i * (colW + gap);
          const s = shift(w);
          const o = relMap.get(w.id);
          return (
            <g key={w.id}>
              <text x={x + barW / 2} y={top - 50} fontSize={15} fill={w.is_active ? "#C2410C" : "#0B1B34"} textAnchor="middle" fontWeight={800}
                style={{ cursor: "pointer" }} onClick={() => onWell(w.id)}>{w.name}</text>
              <text x={x + barW / 2} y={top - 32} fontSize={12} fill="#56667F" textAnchor="middle" fontWeight={600}>
                {w.is_active ? "drilling · plan below bit" : `score ${o?.overall.toFixed(2) ?? "–"} · block ${w.compartment}`}
              </text>
              <text x={x + barW / 2} y={top - 16} fontSize={11.5} fill="#8C9AB0" textAnchor="middle">rig floor {w.rkb_elev.toFixed(0)} m</text>
              {w.tops.map((t: any) => {
                const a = y(t.tvdss_top - s), b = y(t.tvdss_base - s);
                const ya = Math.max(a, top), yb = Math.min(b, H - 24);
                if (yb <= ya) return null;
                return (
                  <g key={t.code}>
                    <rect x={x} y={ya} width={barW} height={yb - ya} fill={FORMATION_COLOR[t.code] ?? "#CBD5E1"}
                      stroke={t.kind === "prognosed" ? "#D97706" : "rgba(11,27,52,.12)"} strokeDasharray={t.kind === "prognosed" ? "4 3" : undefined} />
                    {yb - ya > 16 && <text x={x + 6} y={ya + 14} fontSize={11.5} fill="#1E293B" fontWeight={700}>{t.name.split(" ")[0]}</text>}
                  </g>
                );
              })}
              {w.casing.map((c: any) => {
                const yy = y(c.shoe_tvdss - s);
                return yy > top && yy < H - 24
                  ? <polygon key={c.size} points={`${x + barW},${yy - 5} ${x + barW + 10},${yy} ${x + barW},${yy + 5}`} fill="#475569"><title>{c.size} casing shoe</title></polygon>
                  : null;
              })}
              {w.events.map((e: any) => {
                const yy = y(e.tvdss - s);
                if (yy < top || yy > H - 24) return null;
                const cx = x + barW + 24;
                return (
                  <g key={e.event_id} style={{ cursor: "pointer" }} onClick={() => onEvent(e.event_id)}>
                    <circle cx={cx} cy={yy} r={5 + e.severity} fill={FAMILY_COLOR[e.family ?? "PR"]} stroke="#fff" strokeWidth={2} />
                    <text x={cx + 11} y={yy} fontSize={12} fill="#2B3A55" fontWeight={700}>{EVENT_SHORT[e.type] ?? e.type_label}</text>
                    <text x={cx + 11} y={yy + 13} fontSize={11} fill="#8C9AB0" fontWeight={600}>{e.md_top.toLocaleString("en-IN", { maximumFractionDigits: 0 })} m</text>
                    <title>{`${e.well}: ${e.type_label} at ${e.md_top} m MD (${e.formation_name}). Click for the source report.`}</title>
                  </g>
                );
              })}
            </g>
          );
        })}
      </svg>
    </div>
  );
}
