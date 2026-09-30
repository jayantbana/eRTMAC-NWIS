import { FileText } from "lucide-react";
import type { RiskTrack } from "../api";
import { Bar, FAMILY_COLOR, FAMILY_INK, FORMATION_COLOR, fmt } from "../ui";

// Illustrated cross-section: rock layers offset by a fault, offset wells with recorded problems,
// and the active well drilling, with those problems projected into its look-ahead window.
const W = 600, H = 520, GROUND = 118, THROW = 28;
const faultX = (y: number) => 446 + ((y - GROUND) / (H - GROUND)) * 66;
const off = (x: number) => 7 * Math.sin((x + 40) / 95) + 4 * Math.sin((x + 10) / 41);
const LAYERS = [
  { code: "DHK", base: 160 }, { code: "NMS", base: 198 }, { code: "GRJ", base: 234, pat: "clay" },
  { code: "TPM", base: 290, pat: "sand" }, { code: "BRL", base: 372, pat: "shale" }, { code: "KPL", base: 458 },
];
const TPM_BASE = 372;

function line(base: number) {
  let d = "";
  for (let x = -10; x <= W + 10; x += 10) d += `${d ? "L" : "M"}${x} ${(base + off(x)).toFixed(1)} `;
  return d;
}
const region = (base: number) => `${line(base)}L${W + 10} ${H + 10} L-10 ${H + 10} Z`;

type Pt = [number, number];
interface WellDef { p: [Pt, Pt, Pt, Pt]; across?: boolean }
const WELLS: WellDef[] = [
  { p: [[170, GROUND], [170, 250], [170, 380], [170, 488]] },
  { p: [[252, GROUND], [252, 250], [258, 340], [274, 488]] },
  { p: [[410, GROUND], [410, 250], [410, 380], [410, 474]] },
  { p: [[480, GROUND], [482, 240], [502, 360], [546, 488]], across: true },
  { p: [[568, GROUND], [568, 250], [568, 380], [568, 470]], across: true },
];
const wellD = (w: WellDef) => `M${w.p[0].join(" ")} C${w.p[1].join(" ")} ${w.p[2].join(" ")} ${w.p[3].join(" ")}`;
function xAt(w: WellDef, y: number) {
  const [a, b, c, d] = w.p;
  const at = (t: number, i: 0 | 1) => (1 - t) ** 3 * a[i] + 3 * (1 - t) ** 2 * t * b[i] + 3 * (1 - t) * t ** 2 * c[i] + t ** 3 * d[i];
  let lo = 0, hi = 1;
  for (let k = 0; k < 24; k++) { const m = (lo + hi) / 2; if (at(m, 1) < y) lo = m; else hi = m; }
  return at(lo, 0);
}
/** Depth of a boundary at well w, accounting for the fault throw. */
const depthAt = (w: WellDef, base: number, dy: number) => {
  const x = xAt(w, base + dy);
  return base + off(x) + (w.across ? THROW : 0) + dy;
};

const EVENTS: { w: number; fam: string; base: number; dy: number }[] = [
  { w: 0, fam: "LC", base: TPM_BASE, dy: -20 }, { w: 1, fam: "LC", base: TPM_BASE, dy: -16 }, { w: 2, fam: "LC", base: TPM_BASE, dy: -22 },
  { w: 1, fam: "SP", base: TPM_BASE, dy: 24 }, { w: 2, fam: "SP", base: TPM_BASE, dy: 20 }, { w: 0, fam: "OP", base: TPM_BASE, dy: 58 },
  { w: 3, fam: "LC", base: TPM_BASE, dy: -18 }, { w: 4, fam: "SP", base: TPM_BASE, dy: 26 },
];

const AX = 340, BIT = 318;
const aBase = TPM_BASE + off(AX);
const ZONES = [
  { fam: "LC", y0: aBase - 28, y1: aBase - 8 },
  { fam: "SP", y0: aBase + 12, y1: aBase + 32 },
  { fam: "OP", y0: aBase + 48, y1: aBase + 64 },
];

function Rig({ x, active }: { x: number; active?: boolean }) {
  const h = active ? 50 : 36, w = active ? 28 : 20, top = GROUND - h;
  const lx = (y: number) => x - w / 2 + ((GROUND - y) / h) * (w / 2 - 3);
  const rx = (y: number) => 2 * x - lx(y);
  const [y1, y2] = [GROUND - h * 0.32, GROUND - h * 0.64];
  const c = active ? "#FF7A1A" : "#8395BA";
  return (
    <g stroke={c} strokeWidth={active ? 2.4 : 1.8} strokeLinecap="round" fill="none">
      <path d={`M${x - w / 2} ${GROUND} L${x - 3} ${top} M${x + w / 2} ${GROUND} L${x + 3} ${top}`} />
      <path d={`M${lx(y1)} ${y1} L${rx(y1)} ${y1} M${lx(y2)} ${y2} L${rx(y2)} ${y2}`} />
      <path d={`M${lx(GROUND)} ${GROUND} L${rx(y1)} ${y1} M${rx(GROUND)} ${GROUND} L${lx(y1)} ${y1} M${lx(y1)} ${y1} L${rx(y2)} ${y2} M${rx(y1)} ${y1} L${lx(y2)} ${y2}`}
        strokeWidth={1.1} opacity={0.75} />
      <rect x={x - 5} y={top - 5} width={10} height={5} rx={1.5} fill={c} stroke="none" />
      <rect x={x - w / 2 - 5} y={GROUND - 3} width={w + 10} height={4} rx={2} fill={c} stroke="none" />
      {active && <path d={`M${x} ${top - 5} V${top - 19} L${x + 12} ${top - 15} L${x} ${top - 11}`} fill="#FF7A1A" strokeLinejoin="round" />}
    </g>
  );
}

function Tree({ x, s = 1 }: { x: number; s?: number }) {
  return (
    <g transform={`translate(${x} ${GROUND - 1}) scale(${s})`}>
      <rect x={-1} y={-9} width={2} height={9} fill="#7A8F6A" />
      <circle cx={0} cy={-13} r={7} fill="#8CCB97" />
      <circle cx={-4} cy={-9} r={4.5} fill="#7DC08A" />
    </g>
  );
}

export default function HeroScene({ track }: { track: RiskTrack | null }) {
  const sp = track?.zones.find((z) => z.family === "SP" && z.md_from > 2500);
  const zone = sp
    ? { from: sp.md_from, to: sp.md_to, fm: sp.formation_name ?? "Barail", wells: sp.wells, peak: sp.peak }
    : { from: 2854, to: 2880, fm: "Barail", wells: ["Well C", "Well R"], peak: 0.75 };

  const layers = (
    <>
      {LAYERS.map((l) => (
        <g key={l.code}>
          <path d={region(l.base)} fill={FORMATION_COLOR[l.code]} />
          {l.pat && <path d={region(l.base)} fill={`url(#hs-${l.pat})`} />}
          <path d={line(l.base)} fill="none" stroke="rgba(11,27,52,.14)" strokeWidth={1} />
        </g>
      ))}
    </>
  );

  return (
    <div className="scene">
      <div className="scene-card">
        <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Illustration: a new well drilling next to older wells. Problems recorded in older wells in the same fault block are projected onto the new well ahead of the drill bit.">
          <defs>
            <linearGradient id="hs-sky" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="#E3EDFF" /><stop offset="1" stopColor="#F8FBFF" />
            </linearGradient>
            <pattern id="hs-sand" width="9" height="9" patternUnits="userSpaceOnUse">
              <circle cx="2" cy="2" r="1" fill="rgba(128,94,10,.28)" /><circle cx="6.5" cy="6.5" r=".8" fill="rgba(128,94,10,.2)" />
            </pattern>
            <pattern id="hs-clay" width="14" height="8" patternUnits="userSpaceOnUse">
              <path d="M1 4h6" stroke="rgba(88,62,150,.2)" strokeWidth="1.2" strokeLinecap="round" />
            </pattern>
            <pattern id="hs-shale" width="18" height="7" patternUnits="userSpaceOnUse">
              <path d="M0 3.5h11" stroke="rgba(40,66,110,.18)" strokeWidth="1" />
            </pattern>
            <clipPath id="hs-left"><polygon points={`-10,${GROUND} ${faultX(GROUND)},${GROUND} ${faultX(H + 10)},${H + 10} -10,${H + 10}`} /></clipPath>
            <clipPath id="hs-right"><polygon points={`${faultX(GROUND)},${GROUND} ${W + 10},${GROUND} ${W + 10},${H + 10} ${faultX(H + 10)},${H + 10}`} /></clipPath>
          </defs>

          {/* sky, hills, surface */}
          <rect width={W} height={GROUND} fill="url(#hs-sky)" />
          <circle cx={236} cy={50} r={26} fill="#FFE6CC" opacity={0.7} />
          <circle cx={236} cy={50} r={15} fill="#FFC896" />
          <g fill="#fff" opacity={0.95}>
            <ellipse cx={132} cy={46} rx={26} ry={8} /><ellipse cx={150} cy={40} rx={16} ry={9} />
            <ellipse cx={404} cy={64} rx={30} ry={8} /><ellipse cx={386} cy={58} rx={15} ry={8} />
          </g>
          <path d="M0 118 V92 C60 82 118 90 170 98 S280 78 346 90 S468 74 540 88 S594 92 600 90 V118 Z" fill="#DAE5F6" />
          <path d="M0 118 V104 C80 96 150 104 220 108 S360 96 440 104 S560 100 600 106 V118 Z" fill="#CFDDF1" />
          <rect x={0} y={GROUND} width={W} height={H - GROUND} fill={FORMATION_COLOR.ALV} />
          <g clipPath="url(#hs-left)">{layers}</g>
          <g clipPath="url(#hs-right)"><g transform={`translate(0 ${THROW})`}>{layers}</g></g>
          <rect x={0} y={GROUND - 3} width={W} height={6} fill="#8ACB98" />
          {[34, 52, 116, 206, 300, 384, 446, 522].map((x, i) => <Tree key={x} x={x} s={i % 2 ? 0.8 : 1} />)}

          {/* layer names */}
          <g fontSize={10.5} fontWeight={800} letterSpacing=".08em" fill="rgba(11,27,52,.55)">
            <text x={16} y={146}>ALLUVIUM</text>
            <text x={16} y={234 + off(16) + 30}>GIRUJAN CLAY</text>
            <text x={16} y={290 + off(16) + 44}>TIPAM SANDSTONE</text>
            <text x={16} y={372 + off(16) + 46}>BARAIL</text>
          </g>

          {/* fault */}
          <path d={`M${faultX(GROUND)} ${GROUND} L${faultX(H)} ${H}`} stroke="#E4572E" strokeWidth={2.2} strokeDasharray="8 6" />
          <text transform={`translate(${faultX(172) + 9} 172) rotate(80.7)`} fontSize={10} fontWeight={800} letterSpacing=".1em" fill="#C2410C">FAULT</text>

          {/* offset wells */}
          {WELLS.map((w, i) => (
            <path key={i} d={wellD(w)} fill="none" stroke={w.across ? "#A6B2C8" : "#51638A"} strokeWidth={w.across ? 2.2 : 2.8} strokeLinecap="round"
              strokeDasharray={w.across ? "1 5" : undefined} />
          ))}
          {WELLS.map((w, i) => <Rig key={i} x={w.p[0][0]} />)}

          {/* problems projected onto the active well */}
          {EVENTS.filter((e) => !WELLS[e.w].across).map((e, i) => {
            const y = depthAt(WELLS[e.w], e.base, e.dy);
            const x = xAt(WELLS[e.w], y);
            const z = ZONES.find((q) => q.fam === e.fam)!;
            const tx = x < AX ? AX - 11 : AX + 11;
            return <path key={i} d={`M${x} ${y} L${tx} ${(z.y0 + z.y1) / 2}`} stroke={FAMILY_COLOR[e.fam]} strokeWidth={1.8} strokeDasharray="4 4"
              className="anim-dash" opacity={0.85} fill="none" />;
          })}
          {EVENTS.map((e, i) => {
            const w = WELLS[e.w];
            const y = depthAt(w, e.base, e.dy);
            return <circle key={i} cx={xAt(w, y)} cy={y} r={6.5} fill={FAMILY_COLOR[e.fam]} stroke="#fff" strokeWidth={2} opacity={w.across ? 0.4 : 1} />;
          })}

          {/* active well */}
          <rect x={AX - 20} y={BIT} width={40} height={96} rx={12} fill="#1F4FE0" opacity={0.09} />
          <rect x={AX - 20} y={BIT} width={40} height={96} rx={12} fill="none" stroke="#1F4FE0" strokeWidth={1.4} strokeDasharray="4 4" opacity={0.7} />
          <path d={`M${AX} ${BIT} V488`} stroke="#FFB27A" strokeWidth={3} strokeDasharray="1 7" strokeLinecap="round" />
          {ZONES.map((z) => (
            <rect key={z.fam} x={AX - 9} y={z.y0} width={18} height={z.y1 - z.y0} rx={6} fill={FAMILY_COLOR[z.fam]} className="anim-glow"
              stroke="#fff" strokeWidth={1.5} />
          ))}
          <path d={`M${AX} ${GROUND} V${BIT - 6}`} stroke="#FF7A1A" strokeWidth={5} strokeLinecap="round" />
          <Rig x={AX} active />
          <circle className="pulse-ring" cx={AX} cy={BIT} r={6} fill="none" stroke="#FF7A1A" strokeWidth={2} />
          <path d={`M${AX - 8} ${BIT - 7} H${AX + 8} L${AX + 5} ${BIT + 2} L${AX} ${BIT + 9} L${AX - 5} ${BIT + 2} Z`} fill="#FF7A1A" stroke="#fff" strokeWidth={1.8}
            strokeLinejoin="round" />
        </svg>
        <div className="f-live"><span className="live-dot on" /> Well A · drilling now</div>
      </div>

      <div className="float f-alert" aria-hidden>
        <div className="row" style={{ gap: 8 }}>
          <span className="tier ADVISORY">Advisory</span>
          <span className="f-k" style={{ marginLeft: "auto" }}>Look-ahead</span>
        </div>
        <div className="f-t" style={{ color: FAMILY_INK.SP }}>Stuck pipe zone ahead</div>
        <div className="f-s">{fmt.int(zone.from)}–{fmt.int(zone.to)} m · {zone.fm}</div>
        <div className="f-s">Seen before in {zone.wells.join(" & ")}</div>
        <div style={{ marginTop: 10 }}>
          <div className="row xs" style={{ justifyContent: "space-between", fontWeight: 700 }}>
            <span className="muted">Chance, from history</span><span>{fmt.pct(zone.peak)}</span>
          </div>
          <Bar value={zone.peak} color={FAMILY_COLOR.SP} />
        </div>
      </div>

      <div className="float f-evid" aria-hidden>
        <div className="row" style={{ gap: 12 }}>
          <div className="f-ic"><FileText /></div>
          <div>
            <div className="f-t" style={{ marginTop: 0 }}>Well C · Daily drilling report</div>
            <div className="f-s">Page 2 · scanned copy, read by OCR</div>
          </div>
        </div>
        <p className="f-quote">“Pipe got stuck at <mark>2,951 m MD in Barails</mark> while making connection…”</p>
      </div>
    </div>
  );
}
