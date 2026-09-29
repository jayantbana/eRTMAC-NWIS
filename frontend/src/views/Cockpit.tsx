import { useEffect, useState } from "react";
import { api, type Alert, type Offset, type RiskTrack, type WellSummary } from "../api";
import AlertDetail from "../components/AlertDetail";
import DepthTrack from "../components/DepthTrack";
import LivePanel from "../components/LivePanel";
import MapPanel from "../components/MapPanel";
import { useApp } from "../state";
import type { useReplay } from "../useReplay";
import { FAMILY_COLOR, Loading } from "../ui";

export default function Cockpit({ replay, wells, faults }: { replay: ReturnType<typeof useReplay>; wells: WellSummary[]; faults: [number, number][][] }) {
  const { meta, radius, setRadius, openEvidence, openWell, dataVersion } = useApp();
  const [offsets, setOffsets] = useState<Offset[]>([]);
  const [track, setTrack] = useState<RiskTrack | null>(null);
  const [alertOpen, setAlertOpen] = useState<string | null>(null);
  const { live } = replay;

  useEffect(() => {
    // Demo convenience: ?autostart=2790&speed=600 starts the replay immediately.
    const q = new URLSearchParams(location.search);
    if (q.get("autostart") && live.status === "idle") replay.start(+q.get("autostart")!, +(q.get("speed") ?? 300), radius);
  }, []);

  useEffect(() => {
    api.offsets(meta.active_well_id, radius).then(setOffsets);
    api.track(meta.active_well_id, radius).then(setTrack);
  }, [radius, dataVersion]);

  const shownTrack = live.track ?? track;
  const bit = live.last?.record?.hole_md ?? (live.status === "idle" ? null : null);
  const look = live.last ? Math.max(meta.thresholds.lookahead_min_m, (live.last.rop_1h ?? 0) * meta.thresholds.lookahead_hours) : meta.thresholds.lookahead_min_m;
  const relevant = offsets.filter((o) => o.overall >= meta.thresholds.relevance_include);
  const alert = live.alerts.find((a) => a.id === alertOpen) ?? null;
  const upcoming = (shownTrack?.zones ?? []).filter((z) => z.md_to > (bit ?? meta.active_current_md));

  return (
    <div className="cockpit">
      <div className="panel">
        <div className="panel-h">
          Offset wells
          <span className="spacer" />
          <span className="small" style={{ textTransform: "none", letterSpacing: 0 }}>radius</span>
          <input type="range" min={2} max={20} step={1} value={radius} onChange={(e) => setRadius(+e.target.value)} style={{ width: 90 }} />
          <span className="mono small" style={{ width: 42 }}>{radius} km</span>
        </div>
        <div style={{ flex: 1, minHeight: 0 }}>
          <MapPanel wells={wells} offsets={offsets} selected={null} onSelect={(id) => openWell(id)} faults={faults} />
        </div>
        <div style={{ borderTop: "1px solid var(--line)", maxHeight: "34%", overflow: "auto" }}>
          <table className="t small">
            <thead><tr><th>Offset</th><th>km</th><th>Relevance</th><th>Why</th></tr></thead>
            <tbody>
              {offsets.slice(0, 12).map((o) => (
                <tr key={o.well_id} className="click" onClick={() => openWell(o.well_id)} style={{ opacity: o.overall >= meta.thresholds.relevance_include ? 1 : 0.55 }}>
                  <td><b>{o.name}</b></td>
                  <td className="mono">{o.surface_distance_km.toFixed(1)}</td>
                  <td className="mono">{o.overall.toFixed(2)}</td>
                  <td className="dim">{o.explanation}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="panel">
        <div className="panel-h">
          {meta.active_well_name} · look-ahead risk track
          <span className="spacer" />
          <span className="small" style={{ textTransform: "none", letterSpacing: 0 }}>{relevant.length} relevant offsets · {shownTrack?.projected_events.length ?? 0} projected events</span>
        </div>
        <div className="panel-b flush" style={{ display: "flex", flexDirection: "column" }}>
          <div className="row" style={{ padding: "6px 10px", gap: 6, flexWrap: "wrap", borderBottom: "1px solid var(--line)" }}>
            <span className="small muted">Risk zones ahead:</span>
            {upcoming.length === 0 && <span className="small dim">none</span>}
            {upcoming.map((z) => (
              <span key={z.id} className="chip small" style={{ borderColor: FAMILY_COLOR[z.family] }} title={z.wells.join(", ")}>
                <span style={{ color: FAMILY_COLOR[z.family] }}>{z.label}</span> {z.md_from.toFixed(0)}–{z.md_to.toFixed(0)} m · {Math.round(z.peak * 100)}%
              </span>
            ))}
          </div>
          <div style={{ flex: 1, minHeight: 0 }}>
            {shownTrack ? (
              <DepthTrack track={shownTrack} bitMd={bit} lookahead={look} onEvent={(id) => openEvidence({ kind: "event", eventId: id })} />
            ) : <Loading />}
          </div>
        </div>
      </div>

      <LivePanel
        live={live}
        onStart={(md, sp) => replay.start(md, sp, radius)}
        onPause={replay.pause}
        onResume={replay.resume}
        onStop={replay.stop}
        onSpeed={replay.setSpeed}
        onAlert={(a: Alert) => setAlertOpen(a.id)}
      />
      {alert && <AlertDetail alert={alert} onClose={() => setAlertOpen(null)} onAck={(r) => replay.ack(alert.id, r)} />}
    </div>
  );
}
