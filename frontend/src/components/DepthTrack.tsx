import { useEffect, useMemo, useRef, useState } from "react";
import type { Family, ProjectedEvent, RiskTrack } from "../api";
import { FAMILIES } from "../api";
import { FAMILY_COLOR, FAMILY_SHORT, FORMATION_COLOR } from "../ui";

interface Props {
  track: RiskTrack;
  bitMd?: number | null;
  lookahead?: number;
  onEvent: (eventId: string) => void;
  initialRange?: [number, number];
}

export default function DepthTrack({ track, bitMd, lookahead = 100, onEvent, initialRange = [2600, 3150] }: Props) {
  const wrap = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 640, h: 600 });
  const [range, setRange] = useState<[number, number]>(initialRange);
  const [follow, setFollow] = useState(true);
  const [hover, setHover] = useState<ProjectedEvent | null>(null);

  useEffect(() => {
    if (!wrap.current) return;
    const ro = new ResizeObserver(([e]) => setSize({ w: Math.max(480, e.contentRect.width), h: Math.max(360, e.contentRect.height) }));
    ro.observe(wrap.current);
    return () => ro.disconnect();
  }, []);

  const [top, bottom] = useMemo<[number, number]>(() => {
    if (follow && bitMd != null) return [bitMd - 120, bitMd + 230];
    return range;
  }, [follow, bitMd, range]);

  const { w, h } = size;
  const H0 = 26;
  const y = (md: number) => H0 + ((md - top) / (bottom - top)) * (h - H0 - 6);
  const X = { axis: 0, fm: 46, fmW: 104, csg: 152, risk: 172, riskW: 36 };
  const evX = X.risk + FAMILIES.length * X.riskW + 10;
  const evW = w - evX - 6;
  const step = track.md.length > 1 ? track.md[1] - track.md[0] : 2;
  const i0 = Math.max(0, Math.floor(top / step));
  const i1 = Math.min(track.md.length - 1, Math.ceil(bottom / step));

  const ticks: number[] = [];
  const span = bottom - top;
  const tstep = span > 800 ? 100 : span > 300 ? 50 : 25;
  for (let d = Math.ceil(top / tstep) * tstep; d <= bottom; d += tstep) ticks.push(d);

  // Lay out projected events into non-overlapping lanes.
  const visible = track.projected_events.filter((p) => p.md >= top - 20 && p.md <= bottom + 20).sort((a, b) => a.md - b.md);
  const lanes: number[] = [];
  const placed = visible.map((p) => {
    const py = y(p.md);
    let lane = lanes.findIndex((last) => py - last > 15);
    if (lane < 0) { lane = lanes.length; lanes.push(py); } else lanes[lane] = py;
    return { p, py, lane };
  });
  const laneW = Math.min(evW / Math.max(1, Math.min(lanes.length, 3)), evW);

  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column" }}>
      <div className="row" style={{ padding: "6px 10px", borderBottom: "1px solid var(--line)", flexWrap: "wrap" }}>
        <span className="small muted">View</span>
        <button className="btn ghost small" onClick={() => { setFollow(false); setRange([2600, 3150]); }}>8½″ section</button>
        <button className="btn ghost small" onClick={() => { setFollow(false); setRange([0, track.md[track.md.length - 1]]); }}>Full well</button>
        <button className="btn ghost small" onClick={() => { setFollow(false); const c = (top + bottom) / 2, s = (bottom - top) / 3; setRange([c - s, c + s]); }}>Zoom +</button>
        <button className="btn ghost small" onClick={() => { setFollow(false); const c = (top + bottom) / 2, s = (bottom - top); setRange([Math.max(0, c - s), c + s]); }}>Zoom −</button>
        <label className="row small" style={{ marginLeft: 6 }}><input type="checkbox" checked={follow} onChange={(e) => setFollow(e.target.checked)} /> follow bit</label>
        <span className="spacer" />
        <span className="small dim">zone threshold {Math.round(track.zone_threshold * 100)}% · σ bars = alignment uncertainty</span>
      </div>
      <div ref={wrap} style={{ flex: 1, minHeight: 0, position: "relative" }}>
        <svg width={w} height={h} style={{ display: "block" }}>
          {/* headers */}
          <text x={4} y={16} fontSize={10} fill="#94a3b8">MD (m)</text>
          <text x={X.fm + 4} y={16} fontSize={10} fill="#94a3b8">Formation</text>
          {FAMILIES.map((f, k) => (
            <text key={f} x={X.risk + k * X.riskW + X.riskW / 2} y={16} fontSize={10} fill={FAMILY_COLOR[f]} textAnchor="middle" fontWeight={600}>{FAMILY_SHORT[f]}</text>
          ))}
          <text x={evX + 4} y={16} fontSize={10} fill="#94a3b8">Offset events projected to this well</text>

          {/* depth grid */}
          {ticks.map((d) => (
            <g key={d}>
              <line x1={X.fm} x2={w} y1={y(d)} y2={y(d)} stroke="#1f2a3c" />
              <text x={40} y={y(d) + 3} fontSize={10} fill="#64748b" textAnchor="end">{d.toLocaleString("en-IN")}</text>
            </g>
          ))}

          {/* formation column */}
          {track.tops.map((t) => {
            const a = Math.max(t.md_top, top), b = Math.min(t.md_base, bottom);
            if (b <= a) return null;
            const ya = y(a), yb = y(b);
            return (
              <g key={t.code}>
                <rect x={X.fm} y={ya} width={X.fmW} height={yb - ya} fill={FORMATION_COLOR[t.code] ?? "#334155"} opacity={0.85} />
                {t.md_top >= top && (
                  <line x1={X.fm} x2={X.fm + X.fmW} y1={y(t.md_top)} y2={y(t.md_top)} stroke={t.kind === "prognosed" ? "#fbbf24" : "#e5e7eb"}
                    strokeDasharray={t.kind === "prognosed" ? "4 3" : undefined} strokeWidth={1.2} />
                )}
                {yb - ya > 16 && (
                  <text x={X.fm + 5} y={Math.max(ya, H0) + 13} fontSize={11} fill="#f1f5f9" fontWeight={600}>{t.name}</text>
                )}
                {t.md_top >= top && yb - ya > 30 && (
                  <text x={X.fm + 5} y={Math.max(ya, H0) + 25} fontSize={9.5} fill={t.kind === "prognosed" ? "#fde68a" : "#cbd5e1"}>
                    {t.kind === "prognosed" ? `prog. ${t.md_top.toFixed(0)}` : `top ${t.md_top.toFixed(0)}`}
                  </text>
                )}
              </g>
            );
          })}

          {/* casing shoes */}
          {track.casing.filter((c) => c.shoe_md >= top && c.shoe_md <= bottom).map((c) => (
            <g key={c.size}>
              <polygon points={`${X.csg},${y(c.shoe_md) - 5} ${X.csg + 12},${y(c.shoe_md)} ${X.csg},${y(c.shoe_md) + 5}`} fill="#cbd5e1" />
              <title>{c.size} casing shoe (planned) {c.shoe_md.toFixed(0)} m</title>
            </g>
          ))}

          {/* risk columns */}
          {FAMILIES.map((f, k) => {
            const x0 = X.risk + k * X.riskW;
            const vals = track.curves[f as Family];
            const cells = [];
            const pts: string[] = [];
            for (let i = i0; i <= i1; i++) {
              const v = vals[i];
              const yy = y(track.md[i]);
              if (v > 0.03) cells.push(<rect key={i} x={x0 + 1} y={yy} width={X.riskW - 2} height={Math.max(1, (step / (bottom - top)) * (h - H0)) + 0.5} fill={FAMILY_COLOR[f]} opacity={Math.pow(v, 0.9) * 0.85} />);
              pts.push(`${x0 + 2 + v * (X.riskW - 4)},${yy}`);
            }
            const thrX = x0 + 2 + track.zone_threshold * (X.riskW - 4);
            return (
              <g key={f}>
                <rect x={x0 + 1} y={H0} width={X.riskW - 2} height={h - H0 - 6} fill="#0b1220" stroke="#1f2a3c" />
                {cells}
                <line x1={thrX} x2={thrX} y1={H0} y2={h - 6} stroke="#334155" strokeDasharray="2 3" />
                <polyline points={pts.join(" ")} fill="none" stroke="#f8fafc" strokeWidth={1} opacity={0.75} />
              </g>
            );
          })}
          {track.zones.filter((z) => z.md_to >= top && z.md_from <= bottom).map((z) => {
            const k = FAMILIES.indexOf(z.family);
            return (
              <rect key={z.id} x={X.risk + k * X.riskW + 1} y={y(z.md_from)} width={X.riskW - 2} height={Math.max(2, y(z.md_to) - y(z.md_from))}
                fill="none" stroke={FAMILY_COLOR[z.family]} strokeWidth={2}>
                <title>{`${z.label} zone ${z.md_from.toFixed(0)}-${z.md_to.toFixed(0)} m, peak ${(z.peak * 100).toFixed(0)}% (${z.wells.join(", ")})`}</title>
              </rect>
            );
          })}

          {/* projected offset events */}
          {placed.map(({ p, py, lane }) => {
            const k = p.family ? FAMILIES.indexOf(p.family) : -1;
            const cx = evX + 10 + lane * laneW;
            const sig = (p.sigma / (bottom - top)) * (h - H0);
            const c = FAMILY_COLOR[p.family ?? "PR"];
            return (
              <g key={p.event_id} style={{ cursor: "pointer" }} onClick={() => onEvent(p.event_id)} onMouseEnter={() => setHover(p)} onMouseLeave={() => setHover(null)}>
                {k >= 0 && <line x1={X.risk + (k + 1) * X.riskW} x2={cx} y1={py} y2={py} stroke={c} opacity={0.25} />}
                <line x1={cx} x2={cx} y1={py - sig} y2={py + sig} stroke={c} opacity={0.6} />
                <circle cx={cx} cy={py} r={k >= 0 ? 4 + 5 * p.amplitude : 5} fill={k >= 0 ? c : "#0b1220"} strokeDasharray={k >= 0 ? undefined : "2 2"} stroke={k < 0 ? "#86efac" : p.outcome === "failed" ? "#ef4444" : "#0b1220"} strokeWidth={1.5} opacity={p.status === "needs_review" ? 0.55 : 1} />
                {laneW > 90 && (
                  <text x={cx + 11} y={py + 4} fontSize={10.5} fill="#e5e7eb">
                    {p.well_name.replace("Well ", "")} · {p.type.replace(/_/g, " ").toLowerCase().replace("overpressure kick", "overpressure")}
                    <tspan fill="#94a3b8"> @{p.offset_md.toFixed(0)}</tspan>
                  </text>
                )}
              </g>
            );
          })}

          {/* look-ahead window and bit */}
          {bitMd != null && bitMd >= top && bitMd <= bottom && (
            <g>
              <rect x={X.fm} y={y(bitMd)} width={w - X.fm} height={Math.max(0, y(Math.min(bitMd + lookahead, bottom)) - y(bitMd))} fill="#38bdf8" opacity={0.06} />
              <line x1={X.fm} x2={w} y1={y(bitMd + lookahead)} y2={y(bitMd + lookahead)} stroke="#38bdf8" strokeDasharray="3 4" opacity={0.6} />
              <text x={w - 6} y={y(bitMd + lookahead) - 4} fontSize={10} fill="#7dd3fc" textAnchor="end">look-ahead {lookahead.toFixed(0)} m</text>
              <line x1={0} x2={w} y1={y(bitMd)} y2={y(bitMd)} stroke="#fbbf24" strokeWidth={2} />
              <rect x={0} y={y(bitMd) - 9} width={44} height={18} rx={4} fill="#fbbf24" />
              <text x={22} y={y(bitMd) + 4} fontSize={10.5} fill="#0b1220" textAnchor="middle" fontWeight={700}>{bitMd.toFixed(0)}</text>
            </g>
          )}
        </svg>
        {hover && (
          <div className="stat small" style={{ position: "absolute", right: 10, top: 34, maxWidth: 300, pointerEvents: "none", zIndex: 5 }}>
            <b>{hover.well_name}</b> · {hover.type.replace(/_/g, " ").toLowerCase()} {hover.subtype ? `(${hover.subtype})` : ""}<br />
            Offset depth {hover.offset_md.toFixed(1)} m → projected {hover.md.toFixed(1)} m ±{hover.sigma.toFixed(0)} m ({hover.method.replace("_", " ")})<br />
            Relevance {hover.relevance.toFixed(2)} · severity {hover.severity} · outcome {hover.outcome}{hover.npt_h ? ` · NPT ${hover.npt_h} h` : ""}<br />
            <span className="dim">click for source document</span>
          </div>
        )}
      </div>
    </div>
  );
}
