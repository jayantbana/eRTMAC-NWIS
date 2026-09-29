import { useState } from "react";
import type { Alert } from "../api";
import { FAMILIES } from "../api";
import type { LiveState } from "../useReplay";
import { FAMILY_COLOR, FAMILY_SHORT, Sparkline, Tier, fmt } from "../ui";

interface Props {
  live: LiveState;
  onStart: (fromMd: number, speed: number) => void;
  onPause: () => void;
  onResume: () => void;
  onStop: () => void;
  onSpeed: (v: number) => void;
  onAlert: (a: Alert) => void;
}

const SPEEDS = [60, 150, 300, 600, 1200];

export default function LivePanel({ live, onStart, onPause, onResume, onStop, onSpeed, onAlert }: Props) {
  const [fromMd, setFromMd] = useState(2740);
  const recs = live.records;
  const last = live.last;
  const r = last?.record;
  const series = (fn: (x: any) => number) => recs.map(fn);
  const pumped = recs.filter((x) => x.flow_in > 500);
  const dflow = pumped.map((x) => ((x.flow_out - x.flow_in) / x.flow_in) * 100);
  const onBottom = recs.filter((x) => x.on_bottom > 0);

  return (
    <div className="panel" style={{ minHeight: 0 }}>
      <div className="panel-h">
        Live feed · eRTMAC replay
        <span className="spacer" />
        {live.status === "running" && <span className="badge ok">● LIVE REPLAY</span>}
        {live.status === "paused" && <span className="badge">PAUSED</span>}
        {live.status === "done" && <span className="badge">END OF FEED</span>}
      </div>
      <div className="panel-b col" style={{ gap: 10 }}>
        <div className="row" style={{ flexWrap: "wrap" }}>
          {(live.status === "idle" || live.status === "done") && (
            <>
              <span className="small muted">from</span>
              <input type="number" value={fromMd} step={10} min={2700} max={2980} onChange={(e) => setFromMd(+e.target.value)} style={{ width: 80 }} />
              <span className="small muted">m</span>
              <button className="btn primary" onClick={() => onStart(fromMd, live.speed)}>▶ Start drilling replay</button>
            </>
          )}
          {live.status === "connecting" && <span className="muted small">Connecting to feed…</span>}
          {live.status === "running" && <button className="btn" onClick={onPause}>❚❚ Pause</button>}
          {live.status === "paused" && <button className="btn primary" onClick={onResume}>▶ Resume</button>}
          {(live.status === "running" || live.status === "paused") && <button className="btn ghost" onClick={onStop}>■ Stop</button>}
          <span className="spacer" />
          <select value={live.speed} onChange={(e) => onSpeed(+e.target.value)} title="replay speed">
            {SPEEDS.map((s) => <option key={s} value={s}>{s}× speed</option>)}
          </select>
        </div>

        {r ? (
          <>
            <div className="grid3">
              <div className="stat"><div className="label">Hole depth</div><div className="big">{r.hole_md.toFixed(1)}</div><div className="small dim">m MD</div></div>
              <div className="stat"><div className="label">Formation</div><div style={{ fontWeight: 700, fontSize: 14 }}>{last.formation?.name ?? "–"}</div>
                <div className="small dim">{last.formation?.kind === "prognosed" ? "per prognosis" : "top picked"}</div></div>
              <div className="stat"><div className="label">ROP (1 h)</div><div className="big">{fmt.n(last.rop_1h, 1)}</div><div className="small dim">m/h</div></div>
            </div>
            <div className="bar"><div style={{ width: `${live.progress * 100}%`, background: "#38bdf8" }} /></div>
            <div className="grid2">
              <Param label="Flow out − in" value={`${dflow.length ? dflow[dflow.length - 1].toFixed(1) : "–"} %`} data={dflow.slice(-240)} color="#38bdf8" />
              <Param label="Pit volume" value={`${r.pit.toFixed(1)} m³`} data={series((x) => x.pit).slice(-240)} color="#22d3ee" />
              <Param label="Torque" value={`${r.torque.toFixed(1)} kN·m`} data={onBottom.map((x) => x.torque).slice(-240)} color="#a78bfa" />
              <Param label="Hookload" value={`${r.hookload.toFixed(0)} t`} data={series((x) => x.hookload).slice(-240)} color="#cbd5e1" />
              <Param label="Total gas" value={`${r.gas.toFixed(1)} %`} data={series((x) => x.gas).slice(-240)} color="#f472b6" />
              <Param label="ROP" value={`${r.rop.toFixed(1)} m/h`} data={onBottom.map((x) => x.rop).slice(-240)} color="#a3e635" />
            </div>
            <div>
              <div className="small muted" style={{ marginBottom: 4 }}>Live precursor models (probability vs alarm threshold)</div>
              {FAMILIES.filter((f) => last.live?.[f]).map((f) => {
                const v = last.live[f];
                return (
                  <div key={f} className="row small" style={{ marginBottom: 3 }}>
                    <span style={{ width: 52, color: FAMILY_COLOR[f] }}>{FAMILY_SHORT[f]}</span>
                    <div className="bar" style={{ flex: 1, position: "relative" }}>
                      <div style={{ width: `${v.p * 100}%`, background: v.p >= v.threshold ? "#ef4444" : FAMILY_COLOR[f] }} />
                      <span style={{ position: "absolute", left: `${v.threshold * 100}%`, top: -2, bottom: -2, width: 2, background: "#e5e7eb" }} />
                    </div>
                    <span className="mono" style={{ width: 38, textAlign: "right" }}>{(v.p * 100).toFixed(0)}%</span>
                  </div>
                );
              })}
            </div>
          </>
        ) : (
          <div className="notice">
            Replays Well A's real-time drilling feed (synthetic, eRTMAC-style 10 s records) through the full NWIS chain:
            QC → features → rules + ML → formation-top picking → look-ahead zones → fusion → alerts.
          </div>
        )}

        {live.notices.slice(-2).map((n, i) => <div key={i} className="notice">⟳ {n.text}</div>)}

        <div className="hr" />
        <div className="row"><b className="small" style={{ letterSpacing: ".5px" }}>ALERTS</b><span className="spacer" />
          <span className="small dim">{live.alerts.length} active</span></div>
        {live.alerts.length === 0 && <div className="small muted">No active alerts. Advisories appear when a historical risk zone enters the look-ahead window.</div>}
        {live.alerts.map((a) => (
          <div key={a.id} className={`alert-card ${a.tier ?? ""}`} onClick={() => onAlert(a)}>
            <div className="row">
              <Tier tier={a.tier} />
              <span style={{ color: FAMILY_COLOR[a.family], fontWeight: 600 }}>{a.label}</span>
              <span className="spacer" />
              {a.acknowledged && <span className="badge">ack</span>}
              <span className="small dim mono">{a.id}</span>
            </div>
            <div style={{ marginTop: 4 }}>{a.message}</div>
            <div className="small dim" style={{ marginTop: 3 }}>
              history {fmt.pct(a.p_prior)} · live {a.p_live == null ? "–" : fmt.pct(a.p_live)} · click for evidence & what worked before
            </div>
          </div>
        ))}
        <div className="disclaimer">Decision support only. Alerts summarise historical offset evidence and live indicators; the drilling engineer retains authority.</div>
      </div>
    </div>
  );
}

function Param({ label, value, data, color }: { label: string; value: string; data: number[]; color: string }) {
  return (
    <div className="stat" style={{ padding: "6px 8px" }}>
      <div className="row"><span className="label">{label}</span><span className="spacer" /><span className="mono small">{value}</span></div>
      <Sparkline data={data} color={color} width={150} height={30} />
    </div>
  );
}
