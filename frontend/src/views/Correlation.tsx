import { useEffect, useMemo, useState } from "react";
import { api, type Offset } from "../api";
import { useApp } from "../state";
import { FAMILY_COLOR, FORMATION_COLOR, Loading } from "../ui";

export default function Correlation() {
  const { meta, radius, openEvidence, openWell } = useApp();
  const [offsets, setOffsets] = useState<Offset[]>([]);
  const [sel, setSel] = useState<string[]>([]);
  const [data, setData] = useState<any[] | null>(null);
  const [mode, setMode] = useState<"tvdss" | "flatten">("flatten");
  const [datum, setDatum] = useState("BRL");

  useEffect(() => {
    api.offsets(meta.active_well_id, radius).then((o) => {
      setOffsets(o);
      const rel = o.filter((x) => x.overall >= meta.thresholds.relevance_include).slice(0, 5).map((x) => x.well_id);
      const cross = o.find((x) => !x.same_compartment);
      setSel([meta.active_well_id, ...rel, ...(cross ? [cross.well_id] : [])]);
    });
  }, [radius]);

  useEffect(() => {
    if (sel.length) api.correlation(sel).then(setData);
  }, [sel.join(",")]);

  const relMap = useMemo(() => new Map(offsets.map((o) => [o.well_id, o])), [offsets]);

  if (!data) return <div className="view"><Loading /></div>;
  const shift = (w: any) => {
    if (mode === "tvdss") return 0;
    const t = w.tops.find((x: any) => x.code === datum);
    return t ? t.tvdss_top : 0;
  };
  const yMin = mode === "tvdss" ? 2000 : -700;
  const yMax = mode === "tvdss" ? 3300 : 500;
  const H = 720, top = 60, colW = 128, gap = 60, left = 64;
  const y = (v: number) => top + ((v - yMin) / (yMax - yMin)) * (H - top - 20);
  const W = left + data.length * (colW + gap);
  const ticks: number[] = [];
  for (let v = Math.ceil(yMin / 100) * 100; v <= yMax; v += 100) ticks.push(v);

  return (
    <div className="view" style={{ display: "grid", gridTemplateColumns: "260px 1fr", gap: 12 }}>
      <div className="panel">
        <div className="panel-h">Wells</div>
        <div className="panel-b col">
          <div className="row">
            <button className={`btn ${mode === "flatten" ? "primary" : ""}`} onClick={() => setMode("flatten")}>Flatten on top</button>
            <button className={`btn ${mode === "tvdss" ? "primary" : ""}`} onClick={() => setMode("tvdss")}>TVDSS</button>
          </div>
          {mode === "flatten" && (
            <select value={datum} onChange={(e) => setDatum(e.target.value)}>
              {meta.formations.filter((f) => !["ALV", "BSM"].includes(f.code)).map((f) => <option key={f.code} value={f.code}>Datum: top {f.name}</option>)}
            </select>
          )}
          <div className="small muted">Flattening hangs every well on the same formation top, so stratigraphically equivalent events line up even where structure dips or rig floors differ.</div>
          <div className="hr" />
          <label className="row small"><input type="checkbox" checked disabled /> {meta.active_well_name} (active)</label>
          {offsets.slice(0, 16).map((o) => (
            <label key={o.well_id} className="row small" style={{ opacity: o.overall >= meta.thresholds.relevance_include ? 1 : 0.6 }}>
              <input type="checkbox" checked={sel.includes(o.well_id)}
                onChange={(e) => setSel(e.target.checked ? [...sel, o.well_id] : sel.filter((x) => x !== o.well_id))} />
              {o.name} <span className="dim mono">{o.overall.toFixed(2)} · {o.compartment}</span>
            </label>
          ))}
        </div>
      </div>
      <div className="panel">
        <div className="panel-h">Cross-well correlation · events by formation position <span className="spacer" />
          {Object.entries(meta.risk_families).map(([k, v]) => <span key={k} className="row small" style={{ textTransform: "none" }}><span className="legend-dot" style={{ background: FAMILY_COLOR[k] }} />{v}</span>)}
        </div>
        <div className="panel-b scroll">
          <svg width={W} height={H}>
            {ticks.map((v) => (
              <g key={v}>
                <line x1={left - 6} x2={W} y1={y(v)} y2={y(v)} stroke="#1f2a3c" />
                <text x={left - 10} y={y(v) + 3} fontSize={10} fill="#64748b" textAnchor="end">{mode === "flatten" ? (v > 0 ? `+${v}` : v) : v}</text>
              </g>
            ))}
            <text transform={`translate(14, ${(H + top) / 2}) rotate(-90)`} fontSize={10} fill="#94a3b8" textAnchor="middle">{mode === "flatten" ? `m relative to top ${meta.formations.find((f) => f.code === datum)?.name}` : "TVDSS (m)"}</text>
            {/* correlation lines between adjacent wells */}
            {data.slice(0, -1).map((w, i) => {
              const n = data[i + 1];
              const x1 = left + i * (colW + gap) + colW, x2 = left + (i + 1) * (colW + gap);
              return w.tops.map((t: any) => {
                const t2 = n.tops.find((x: any) => x.code === t.code);
                if (!t2) return null;
                return <line key={`${w.id}-${t.code}`} x1={x1} x2={x2} y1={y(t.tvdss_top - shift(w))} y2={y(t2.tvdss_top - shift(n))} stroke={FORMATION_COLOR[t.code]} strokeWidth={1.5} strokeDasharray="5 4" opacity={0.9} />;
              });
            })}
            {data.map((w, i) => {
              const x = left + i * (colW + gap);
              const s = shift(w);
              const o = relMap.get(w.id);
              return (
                <g key={w.id}>
                  <text x={x + colW / 2} y={top - 36} fontSize={12} fill={w.is_active ? "#fbbf24" : "#e5e7eb"} textAnchor="middle" fontWeight={700}
                    style={{ cursor: "pointer" }} onClick={() => openWell(w.id)}>{w.name}</text>
                  <text x={x + colW / 2} y={top - 22} fontSize={10} fill="#94a3b8" textAnchor="middle">
                    {w.is_active ? "active (prognosis below bit)" : `S ${o?.overall.toFixed(2) ?? "–"} · comp. ${w.compartment}`}
                  </text>
                  <text x={x + colW / 2} y={top - 9} fontSize={10} fill="#64748b" textAnchor="middle">RKB {w.rkb_elev.toFixed(0)} m</text>
                  {w.tops.map((t: any) => {
                    const a = y(t.tvdss_top - s), b = y(t.tvdss_base - s);
                    const ya = Math.max(a, top), yb = Math.min(b, H - 20);
                    if (yb <= ya) return null;
                    return (
                      <g key={t.code}>
                        <rect x={x} y={ya} width={colW * 0.55} height={yb - ya} fill={FORMATION_COLOR[t.code]} opacity={0.9}
                          stroke={t.kind === "prognosed" ? "#fbbf24" : "none"} strokeDasharray="3 3" />
                        {yb - ya > 14 && <text x={x + 4} y={ya + 12} fontSize={10} fill="#f1f5f9">{t.name.split(" ")[0]}</text>}
                      </g>
                    );
                  })}
                  {w.casing.map((c: any) => {
                    const yy = y(c.shoe_tvdss - s);
                    return yy > top && yy < H - 20 ? <polygon key={c.size} points={`${x + colW * 0.55},${yy - 4} ${x + colW * 0.55 + 8},${yy} ${x + colW * 0.55},${yy + 4}`} fill="#cbd5e1" /> : null;
                  })}
                  {w.events.map((e: any) => {
                    const yy = y(e.tvdss - s);
                    if (yy < top || yy > H - 20) return null;
                    const cx = x + colW * 0.55 + 22;
                    return (
                      <g key={e.event_id} style={{ cursor: "pointer" }} onClick={() => openEvidence({ kind: "event", eventId: e.event_id })}>
                        <circle cx={cx} cy={yy} r={4 + e.severity} fill={FAMILY_COLOR[e.family ?? "PR"]} stroke="#0b1220" />
                        <text x={cx + 10} y={yy + 3} fontSize={9.5} fill="#cbd5e1">{e.type_label.split(" ")[0]} {e.md_top.toFixed(0)}</text>
                        <title>{`${e.well}: ${e.type_label} at ${e.md_top} m MD (${e.formation_name}) - click for source`}</title>
                      </g>
                    );
                  })}
                </g>
              );
            })}
          </svg>
        </div>
      </div>
    </div>
  );
}
