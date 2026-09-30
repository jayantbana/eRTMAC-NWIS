import { useEffect, useMemo, useRef, useState } from "react";
import { Crosshair, Maximize2, Minus, Plus, Ruler } from "lucide-react";
import type { Family, ProjectedEvent, RiskTrack } from "../api";
import { FAMILIES } from "../api";
import { EVENT_SHORT, FAMILY_COLOR, FAMILY_INK, FAMILY_SHORT, FORMATION_COLOR, Seg, fmt } from "../ui";

interface Props {
  track: RiskTrack;
  bitMd?: number | null;
  lookahead?: number;
  onEvent: (eventId: string) => void;
  initialRange?: [number, number];
}

type View = "follow" | "section" | "full" | "custom";

export default function DepthTrack({ track, bitMd, lookahead = 100, onEvent, initialRange = [2600, 3150] }: Props) {
  const wrap = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 800, h: 640 });
  const [range, setRange] = useState<[number, number]>(initialRange);
  const [view, setView] = useState<View>("follow");
  const [hover, setHover] = useState<{ p: ProjectedEvent; x: number; y: number } | null>(null);

  useEffect(() => {
    if (!wrap.current) return;
    const ro = new ResizeObserver(([e]) => setSize({ w: Math.max(520, e.contentRect.width), h: Math.max(420, e.contentRect.height) }));
    ro.observe(wrap.current);
    return () => ro.disconnect();
  }, []);

  const [top, bottom] = useMemo<[number, number]>(() => {
    if (view === "follow" && bitMd != null) return [bitMd - 120, bitMd + 230];
    return range;
  }, [view, bitMd, range]);

  const setMode = (v: View) => {
    setView(v);
    if (v === "section" || v === "follow") setRange(initialRange);
    if (v === "full") setRange([0, track.md[track.md.length - 1]]);
  };
  const zoom = (f: number) => {
    const c = (top + bottom) / 2, s = ((bottom - top) * f) / 2;
    setRange([Math.max(0, c - s), c + s]);
    setView("custom");
  };

  const { w, h } = size;
  const H0 = 48;
  const y = (md: number) => H0 + ((md - top) / (bottom - top)) * (h - H0 - 8);
  // Narrow cards get slimmer columns so the projected-event labels keep room.
  const narrow = w < 960;
  const X = narrow ? { fm: 54, fmW: 100, csg: 160, risk: 178, riskW: 46 } : { fm: 58, fmW: 124, csg: 188, risk: 206, riskW: 54 };
  const header = (f: string) => (narrow && f === "OP" ? ["Kick"] : FAMILY_SHORT[f]);
  const evX = X.risk + FAMILIES.length * X.riskW + 16;
  const evW = w - evX - 8;
  const step = track.md.length > 1 ? track.md[1] - track.md[0] : 2;
  const i0 = Math.max(0, Math.floor(top / step));
  const i1 = Math.min(track.md.length - 1, Math.ceil(bottom / step));

  const ticks: number[] = [];
  const span = bottom - top;
  const tstep = span > 1600 ? 250 : span > 800 ? 100 : span > 300 ? 50 : 25;
  for (let d = Math.ceil(top / tstep) * tstep; d <= bottom; d += tstep) ticks.push(d);

  // Lay out projected events into non-overlapping lanes.
  const visible = track.projected_events.filter((p) => p.md >= top && p.md <= bottom).sort((a, b) => a.md - b.md);
  const lanes: number[] = [];
  const placed = visible.map((p) => {
    const py = y(p.md);
    let lane = lanes.findIndex((last) => py - last > 22);
    if (lane < 0) { lane = lanes.length; lanes.push(py); } else lanes[lane] = py;
    return { p, py, lane };
  });
  const laneW = evW / Math.max(1, Math.min(lanes.length, 3));

  return (
    <>
      <div className="track-tools">
        <Seg<View> value={view} onChange={setMode} label="Depth range"
          options={[{ id: "follow", label: "Follow the bit", icon: Crosshair }, { id: "section", label: "8½″ section", icon: Ruler }, { id: "full", label: "Whole well", icon: Maximize2 }]} />
        <div className="row" style={{ gap: 6 }}>
          <button className="btn btn-sm btn-icon" onClick={() => zoom(2)} aria-label="Zoom out" title="Zoom out"><Minus /></button>
          <button className="btn btn-sm btn-icon" onClick={() => zoom(2 / 3)} aria-label="Zoom in" title="Zoom in"><Plus /></button>
        </div>
        <span className="spacer" />
        <span className="small muted">Risk zone threshold {Math.round(track.zone_threshold * 100)}%</span>
      </div>
      <div ref={wrap} className="track-wrap">
        <svg width={w} height={h} style={{ display: "block" }} role="img" aria-label={`Depth track from ${Math.round(top)} to ${Math.round(bottom)} metres`}>
          <defs><clipPath id="dt-plot"><rect x={0} y={H0 - 1} width={w} height={h - H0 + 1} /></clipPath></defs>
          {/* column headers */}
          <g fontSize={12} fontWeight={700} fill="#56667F">
            <text x={6} y={20}>Depth</text>
            <text x={6} y={36} fontWeight={600} fill="#8C9AB0">m MD</text>
            <text x={X.fm + 6} y={20}>Rock layer</text>
            <text x={evX + 4} y={20}>Problems in nearby wells</text>
            <text x={evX + 4} y={36} fontWeight={600} fill="#8C9AB0">projected to this depth · click for the report</text>
          </g>
          {FAMILIES.map((f, k) => (
            <text key={f} x={X.risk + k * X.riskW + X.riskW / 2} y={header(f).length > 1 ? 20 : 28} fontSize={11.5} fill={FAMILY_INK[f]} textAnchor="middle" fontWeight={800}>
              {header(f).map((s, i) => <tspan key={s} x={X.risk + k * X.riskW + X.riskW / 2} dy={i ? 14 : 0}>{s}</tspan>)}
            </text>
          ))}

          {/* depth grid */}
          {ticks.map((d) => (
            <g key={d}>
              <line x1={X.fm} x2={w} y1={y(d)} y2={y(d)} stroke="#EDF1F7" />
              <text x={50} y={y(d) + 4} fontSize={12} fill="#7A889E" textAnchor="end" fontWeight={600}>{d.toLocaleString("en-IN")}</text>
            </g>
          ))}

          {/* formation column */}
          {track.tops.map((t) => {
            const a = Math.max(t.md_top, top), b = Math.min(t.md_base, bottom);
            if (b <= a) return null;
            const ya = y(a), yb = y(b);
            const prog = t.kind === "prognosed";
            return (
              <g key={t.code}>
                <rect x={X.fm} y={ya} width={X.fmW} height={yb - ya} fill={FORMATION_COLOR[t.code] ?? "#CBD5E1"} />
                {t.md_top >= top && (
                  <line x1={X.fm} x2={X.fm + X.fmW} y1={y(t.md_top)} y2={y(t.md_top)} stroke={prog ? "#D97706" : "#334155"}
                    strokeDasharray={prog ? "5 4" : undefined} strokeWidth={1.6} />
                )}
                {yb - ya > 20 && <text x={X.fm + 8} y={Math.max(ya, H0) + 17} fontSize={12.5} fill="#1E293B" fontWeight={800}>{narrow ? t.name.split(" ")[0] : t.name}</text>}
                {t.md_top >= top && yb - ya > 38 && (
                  <text x={X.fm + 8} y={Math.max(ya, H0) + 32} fontSize={11} fill={prog ? "#A35207" : "#475569"} fontWeight={600}>
                    {prog ? `planned ${t.md_top.toFixed(0)}` : `top ${t.md_top.toFixed(0)}`}
                  </text>
                )}
              </g>
            );
          })}

          {/* casing shoes */}
          {track.casing.filter((c) => c.shoe_md >= top && c.shoe_md <= bottom).map((c) => (
            <g key={c.size}>
              <polygon points={`${X.csg},${y(c.shoe_md) - 6} ${X.csg + 13},${y(c.shoe_md)} ${X.csg},${y(c.shoe_md) + 6}`} fill="#475569" />
              <title>{c.size} casing shoe (planned) {c.shoe_md.toFixed(0)} m</title>
            </g>
          ))}

          {/* risk columns */}
          <g clipPath="url(#dt-plot)">
          {FAMILIES.map((f, k) => {
            const x0 = X.risk + k * X.riskW;
            const vals = track.curves[f as Family];
            const cells = [];
            const pts: string[] = [];
            const cellH = Math.max(1, (step / (bottom - top)) * (h - H0)) + 0.5;
            for (let i = i0; i <= i1; i++) {
              const v = vals[i];
              const yy = y(track.md[i]);
              if (v > 0.03) cells.push(<rect key={i} x={x0 + 2} y={yy} width={X.riskW - 4} height={cellH} fill={FAMILY_COLOR[f]} opacity={Math.pow(v, 0.9) * 0.85} />);
              pts.push(`${x0 + 3 + v * (X.riskW - 6)},${yy}`);
            }
            const thrX = x0 + 3 + track.zone_threshold * (X.riskW - 6);
            return (
              <g key={f}>
                <rect x={x0 + 2} y={H0} width={X.riskW - 4} height={h - H0 - 8} rx={4} fill="#F4F7FB" stroke="#E2E8F1" />
                {cells}
                <line x1={thrX} x2={thrX} y1={H0} y2={h - 8} stroke="#B8C4D6" strokeDasharray="2 3" />
                <polyline points={pts.join(" ")} fill="none" stroke="#0B1B34" strokeWidth={1.2} opacity={0.5} />
              </g>
            );
          })}
          {track.zones.filter((z) => z.md_to >= top && z.md_from <= bottom).map((z) => {
            const k = FAMILIES.indexOf(z.family);
            return (
              <rect key={z.id} x={X.risk + k * X.riskW + 2} y={y(z.md_from)} width={X.riskW - 4} height={Math.max(3, y(z.md_to) - y(z.md_from))} rx={4}
                fill="none" stroke={FAMILY_INK[z.family]} strokeWidth={2.5}>
                <title>{`${z.label} zone ${z.md_from.toFixed(0)}-${z.md_to.toFixed(0)} m, peak ${(z.peak * 100).toFixed(0)}% (${z.wells.join(", ")})`}</title>
              </rect>
            );
          })}
          </g>

          {/* projected offset events */}
          <g clipPath="url(#dt-plot)">
          {placed.map(({ p, py, lane }) => {
            const k = p.family ? FAMILIES.indexOf(p.family) : -1;
            const cx = evX + 14 + lane * laneW;
            const sig = (p.sigma / (bottom - top)) * (h - H0);
            const c = FAMILY_COLOR[p.family ?? "PR"];
            const well = p.well_name.replace("Well ", "");
            const what = EVENT_SHORT[p.type] ?? p.type.replace(/_/g, " ").toLowerCase();
            return (
              <g key={p.event_id} style={{ cursor: "pointer" }} onClick={() => onEvent(p.event_id)}
                onMouseEnter={() => setHover({ p, x: cx, y: py })} onMouseLeave={() => setHover(null)}>
                {k >= 0 && <line x1={X.risk + (k + 1) * X.riskW} x2={cx} y1={py} y2={py} stroke={c} opacity={0.35} strokeWidth={1.2} />}
                <line x1={cx} x2={cx} y1={py - sig} y2={py + sig} stroke={c} opacity={0.55} strokeWidth={2} strokeLinecap="round" />
                <circle cx={cx} cy={py} r={k >= 0 ? 5 + 5 * p.amplitude : 6} fill={k >= 0 ? c : "#fff"} strokeDasharray={k >= 0 ? undefined : "3 2"}
                  stroke={k < 0 ? "#10B981" : p.outcome === "failed" ? "#DC2626" : "#fff"} strokeWidth={2} opacity={p.status === "needs_review" ? 0.55 : 1} />
                {laneW > 86 && (
                  <text x={cx + 13} y={py + 4.5} fontSize={12.5} fill="#1E293B" fontWeight={700}>
                    {laneW > 150 ? `Well ${well}` : well} · {what}
                    {laneW > 190 && <tspan fill="#8C9AB0" fontWeight={600}> {fmt.int(p.offset_md)} m</tspan>}
                  </text>
                )}
              </g>
            );
          })}
          </g>

          {/* look-ahead window and bit */}
          {bitMd != null && bitMd >= top && bitMd <= bottom && (
            <g>
              <rect x={X.fm} y={y(bitMd)} width={w - X.fm} height={Math.max(0, y(Math.min(bitMd + lookahead, bottom)) - y(bitMd))} fill="#1F4FE0" opacity={0.06} />
              <line x1={X.fm} x2={w} y1={y(bitMd + lookahead)} y2={y(bitMd + lookahead)} stroke="#1F4FE0" strokeDasharray="5 5" opacity={0.65} strokeWidth={1.5} />
              {bitMd + lookahead <= bottom && (
                <g>
                  <rect x={X.fm + 4} y={y(bitMd + lookahead) - 24} width={124} height={19} rx={6} fill="#fff" opacity={0.94} />
                  <text x={X.fm + 10} y={y(bitMd + lookahead) - 10} fontSize={11.5} fill="#1F4FE0" fontWeight={800}>Look-ahead {lookahead.toFixed(0)} m</text>
                </g>
              )}
              <line x1={0} x2={w} y1={y(bitMd)} y2={y(bitMd)} stroke="#FF7A1A" strokeWidth={2.5} />
              <rect x={0} y={y(bitMd) - 12} width={52} height={24} rx={7} fill="#FF7A1A" />
              <text x={26} y={y(bitMd) + 4.5} fontSize={12} fill="#fff" textAnchor="middle" fontWeight={800}>{bitMd.toFixed(0)}</text>
            </g>
          )}
        </svg>
        {hover && (
          <div className="tip" style={{ left: Math.min(hover.x + 18, w - 330), top: hover.y + 14 }}>
            <b>{hover.p.well_name} · {(EVENT_SHORT[hover.p.type] ?? hover.p.type).toLowerCase()}</b>{hover.p.subtype ? ` (${hover.p.subtype})` : ""}<br />
            Recorded at {fmt.m(hover.p.offset_md, 1)} → here at {fmt.m(hover.p.md, 1)} ± {hover.p.sigma.toFixed(0)} m<br />
            Match strength {hover.p.relevance.toFixed(2)} · severity {hover.p.severity} · {hover.p.outcome}{hover.p.npt_h ? ` · ${hover.p.npt_h} h lost` : ""}<br />
            <span className="faint">Click to open the source report</span>
          </div>
        )}
      </div>
      <div className="track-legend" aria-label="Legend">
        <span><svg width="16" height="16" aria-hidden><circle cx="8" cy="8" r="6" fill="#0EA5E9" stroke="#fff" strokeWidth="2" /></svg>Problem in a nearby well (bigger = stronger match)</span>
        <span><svg width="10" height="18" aria-hidden><line x1="5" x2="5" y1="2" y2="16" stroke="#8B5CF6" strokeWidth="2.5" strokeLinecap="round" /></svg>Depth uncertainty</span>
        <span><svg width="20" height="16" aria-hidden><rect x="2" y="2" width="16" height="12" rx="3" fill="none" stroke="#6D28D9" strokeWidth="2.2" /></svg>Risk zone</span>
        <span><svg width="22" height="10" aria-hidden><line x1="0" x2="22" y1="5" y2="5" stroke="#1F4FE0" strokeWidth="1.8" strokeDasharray="4 3" /></svg>Look-ahead window</span>
        <span><svg width="22" height="10" aria-hidden><line x1="0" x2="22" y1="5" y2="5" stroke="#FF7A1A" strokeWidth="3" /></svg>Drill bit</span>
        <span><svg width="22" height="10" aria-hidden><line x1="0" x2="22" y1="5" y2="5" stroke="#D97706" strokeWidth="1.8" strokeDasharray="4 3" /></svg>Planned layer top</span>
      </div>
    </>
  );
}
