import type { ReactNode } from "react";
import { Activity, ArrowDown, BellRing, Gauge, Info, Layers, ShieldCheck, Target } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { Alert, Offset, RiskTrack } from "../api";
import DepthTrack from "../components/DepthTrack";
import { AlertsCard, ReadingsCard, ReplayBar } from "../components/Live";
import { useApp } from "../state";
import type { useReplay } from "../useReplay";
import {
  FAMILY_COLOR, FAMILY_INK, FAMILY_SOFT, FORMATION_LINE, FamilyDot, Loading, PageHeader, TIER_COLOR, TIER_RANK, fmt, formationAt, vars,
} from "../ui";

export default function Cockpit({ replay, track, offsets, onOpenAlert }: {
  replay: ReturnType<typeof useReplay>; track: RiskTrack | null; offsets: Offset[]; onOpenAlert: (a: Alert) => void;
}) {
  const { meta, radius, openEvidence } = useApp();
  const { live } = replay;

  const shownTrack = live.track ?? track;
  const bit: number | null = live.last?.record?.hole_md ?? null;
  const look = live.last ? Math.max(meta.thresholds.lookahead_min_m, (live.last.rop_1h ?? 0) * meta.thresholds.lookahead_hours) : meta.thresholds.lookahead_min_m;
  const relevant = offsets.filter((o) => o.overall >= meta.thresholds.relevance_include);
  const ref = bit ?? meta.active_current_md;
  const upcoming = [...(shownTrack?.zones ?? [])].sort((a, b) => a.md_from - b.md_from).filter((z) => z.md_to > ref);
  const next = upcoming[0];
  const fmTop = formationAt(shownTrack?.tops, ref);
  const fm = live.last?.formation ?? (fmTop ? { code: fmTop.code, name: fmTop.name, kind: fmTop.kind } : null);
  const raised = live.alerts.filter((a) => a.tier);
  const topTier = raised.reduce<string | null>((m, a) => ((TIER_RANK[a.tier!] ?? 0) > (TIER_RANK[m ?? ""] ?? 0) ? a.tier : m), null);
  const start = (md: number, speed: number = live.speed) => replay.start(md, speed, radius);

  return (
    <div className="page">
      <PageHeader
        eyebrow="Real-time risk watch" icon={Activity} title={`Live monitoring · ${meta.active_well_name}`}
        sub={<>{meta.active_well_name} is compared with <b>{relevant.length} relevant nearby wells</b>. NWIS warns the team before the bit reaches an interval where those wells had problems.</>}
        actions={<ReplayBar live={live} onStart={start} onPause={replay.pause} onResume={replay.resume} onStop={replay.stop} onSpeed={replay.setSpeed} />}
      />

      <div className="kpis">
        <Kpi icon={ArrowDown} label="Bit depth" value={fmt.int(ref, bit != null ? 1 : 0)} unit="m" sub={bit != null ? "Measured depth, live" : "Last recorded depth"} />
        <Kpi icon={Layers} label="Rock layer now" value={fm?.name ?? "–"} text accent={fm ? FORMATION_LINE[fm.code] : undefined}
          sub={fm ? (fm.kind === "prognosed" ? "As per plan (prognosis)" : "Top confirmed while drilling") : "–"} />
        <Kpi icon={Gauge} label="Drilling rate" value={live.last ? fmt.n(live.last.rop_1h, 1) : "–"} unit={live.last ? "m/h" : undefined} sub="Average over the last hour" />
        <Kpi icon={Target} label="Next risk zone" value={next ? next.label : "None ahead"} text valueColor={next ? FAMILY_INK[next.family] : "var(--green-ink)"}
          accent={next ? FAMILY_COLOR[next.family] : "var(--green)"}
          sub={next ? `${ref >= next.md_from ? "Bit is inside" : `${fmt.int(next.md_from - ref)} m ahead`} · ${fmt.int(next.md_from)}–${fmt.int(next.md_to)} m` : "No zones below the bit"} />
        <Kpi icon={BellRing} label="Active alerts" value={String(raised.length)} accent={topTier ? TIER_COLOR[topTier] : "var(--green)"}
          valueColor={topTier ? TIER_COLOR[topTier] : undefined} sub={topTier ? `Highest level: ${topTier.toLowerCase()}` : "All clear"} />
      </div>

      {live.notices.slice(-2).map((n, i) => (
        <div key={i} className="banner info" style={{ marginBottom: 16 }}><Info aria-hidden /><span><b>Layer top confirmed.</b> {n.text}</span></div>
      ))}

      <div className="live-grid">
        <section className="card" aria-labelledby="track-h">
          <div className="card-h">
            <div>
              <h3 id="track-h">Risk ahead of the drill bit</h3>
              <p>Problems recorded in {relevant.length} relevant nearby wells, lined up by rock layer and projected onto {meta.active_well_name}.</p>
            </div>
            <span className="badge b-blue">{shownTrack?.projected_events.length ?? 0} projected events</span>
          </div>
          <div className="zone-row">
            <span className="lbl">Coming up:</span>
            {upcoming.length === 0 && <span className="small muted">No risk zones below the bit</span>}
            {upcoming.map((z) => (
              <span key={z.id} className="zchip" style={vars({ zc: FAMILY_COLOR[z.family], zs: FAMILY_SOFT[z.family], zi: FAMILY_INK[z.family] })}
                title={`Seen in ${z.wells.join(", ")}`}>
                <FamilyDot family={z.family} /><b>{z.label}</b>{fmt.int(z.md_from)}–{fmt.int(z.md_to)} m · {Math.round(z.peak * 100)}%
              </span>
            ))}
          </div>
          {shownTrack
            ? <DepthTrack track={shownTrack} bitMd={bit} lookahead={look} onEvent={(id) => openEvidence({ kind: "event", eventId: id })} />
            : <Loading what="Building the risk track" />}
        </section>

        <div className="stack">
          <AlertsCard alerts={live.alerts} onOpen={onOpenAlert} />
          <ReadingsCard live={live} onStart={(md) => start(md)} />
        </div>
      </div>

      <p className="footnote"><ShieldCheck aria-hidden />Decision support only. Alerts summarise historical evidence from nearby wells and live indicators; the drilling engineer keeps full authority.</p>
    </div>
  );
}

function Kpi({ icon: Icon, label, value, unit, sub, accent, valueColor, text }: {
  icon: LucideIcon; label: string; value: ReactNode; unit?: string; sub: string; accent?: string; valueColor?: string; text?: boolean;
}) {
  return (
    <div className={`kpi${accent ? " accent" : ""}`} style={accent ? vars({ kc: accent }) : undefined}>
      <div className="kpi-top"><div className="kpi-ic"><Icon aria-hidden /></div><span className="kpi-l">{label}</span></div>
      <div className={`kpi-v${text ? " txt" : ""}`} style={valueColor ? { color: valueColor } : undefined}>{value}{unit && <small>{unit}</small>}</div>
      <div className="kpi-s" title={sub}>{sub}</div>
    </div>
  );
}
