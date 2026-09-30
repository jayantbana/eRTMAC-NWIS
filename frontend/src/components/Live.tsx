import { Fragment, useState } from "react";
import { Check, ChevronRight, Pause, Play, ShieldCheck, Square } from "lucide-react";
import type { Alert } from "../api";
import { FAMILIES } from "../api";
import { useApp } from "../state";
import type { LiveState } from "../useReplay";
import { Empty, FAMILY_COLOR, FAMILY_INK, FamilyDot, Sparkline, TierBadge, fmt } from "../ui";

const SPEEDS = [60, 150, 300, 600, 1200];

function SpeedSelect({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  return (
    <label className="field">
      Speed
      <select value={value} onChange={(e) => onChange(+e.target.value)} aria-label="Replay speed">
        {SPEEDS.map((s) => <option key={s} value={s}>{s}×</option>)}
      </select>
    </label>
  );
}

export function ReplayBar({ live, onStart, onPause, onResume, onStop, onSpeed }: {
  live: LiveState; onStart: (fromMd: number, speed: number) => void; onPause: () => void; onResume: () => void; onStop: () => void;
  onSpeed: (v: number) => void;
}) {
  const [fromMd, setFromMd] = useState(2740);
  const idle = live.status === "idle" || live.status === "done";
  return (
    <div className="toolbar">
      {idle && (
        <>
          <label className="field">
            Start at
            <input type="number" value={fromMd} step={10} min={2700} max={2980} onChange={(e) => setFromMd(+e.target.value)} aria-label="Start depth in metres" />
            m
          </label>
          <SpeedSelect value={live.speed} onChange={onSpeed} />
          <button className="btn btn-primary btn-lg" onClick={() => onStart(fromMd, live.speed)}>
            <Play /> {live.status === "done" ? "Replay again" : "Start live replay"}
          </button>
        </>
      )}
      {live.status === "connecting" && <><span className="spinner" aria-hidden /><b>Connecting to the drilling feed…</b></>}
      {live.status === "running" && (
        <>
          <span className="live-pill"><span className="live-dot on" aria-hidden />LIVE REPLAY</span>
          <button className="btn" onClick={onPause}><Pause /> Pause</button>
          <button className="btn btn-ghost" onClick={onStop}><Square /> Stop</button>
          <SpeedSelect value={live.speed} onChange={onSpeed} />
        </>
      )}
      {live.status === "paused" && (
        <>
          <span className="live-pill paused">PAUSED</span>
          <button className="btn btn-primary" onClick={onResume}><Play /> Resume</button>
          <button className="btn btn-ghost" onClick={onStop}><Square /> Stop</button>
          <SpeedSelect value={live.speed} onChange={onSpeed} />
        </>
      )}
      {live.status !== "idle" && live.status !== "connecting" && (
        <div className="replay-progress" role="progressbar" aria-label="Replay progress" aria-valuenow={Math.round(live.progress * 100)} aria-valuemin={0} aria-valuemax={100}>
          <div style={{ width: `${live.progress * 100}%` }} />
        </div>
      )}
    </div>
  );
}

export function AlertsCard({ alerts, onOpen }: { alerts: Alert[]; onOpen: (a: Alert) => void }) {
  return (
    <section className="card" aria-labelledby="alerts-h">
      <div className="card-h">
        <div>
          <h3 id="alerts-h">Alerts</h3>
          <p>Raised when nearby-well history and live signals point to a risk</p>
        </div>
        <span className={`count-badge${alerts.length ? " hot" : ""}`} aria-label={`${alerts.length} active alerts`}>{alerts.length}</span>
      </div>
      <div className="card-b">
        {alerts.length === 0 ? (
          <Empty icon={ShieldCheck} title="All clear">Advisories appear when a risk zone from nearby wells enters the look-ahead window below the bit.</Empty>
        ) : (
          <div className="alert-list">
            {alerts.map((a) => (
              <button key={a.id} className={`alert-item ${a.tier ?? ""}`} onClick={() => onOpen(a)}>
                <div className="ai-top">
                  <TierBadge tier={a.tier} />
                  <span className="ai-fam" style={{ color: FAMILY_INK[a.family] }}><FamilyDot family={a.family} />{a.label}</span>
                  <span className="spacer" />
                  {a.acknowledged && <span className="badge b-green"><Check /> Acknowledged</span>}
                  <span className="xs faint">{a.id}</span>
                </div>
                <p className="ai-msg">{a.message}</p>
                <div className="ai-foot">
                  <span className="pp">History {fmt.pct(a.p_prior)}</span>
                  <span className="pp">Live {a.p_live == null ? "–" : fmt.pct(a.p_live)}</span>
                  <span className="ai-link">Evidence & what worked <ChevronRight /></span>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

function Reading({ label, value, unit, data, color }: { label: string; value: string; unit: string; data: number[]; color: string }) {
  return (
    <div className="reading">
      <div className="reading-top"><span className="reading-l">{label}</span><span className="reading-v">{value}<small>{unit}</small></span></div>
      <Sparkline data={data} color={color} height={38} />
    </div>
  );
}

const CHAIN = ["Quality check", "Features", "Rules + ML models", "Layer-top picking", "Look-ahead zones", "Fusion", "Alerts"];

export function ReadingsCard({ live, onStart }: { live: LiveState; onStart: (fromMd: number) => void }) {
  const { meta } = useApp();
  const recs = live.records;
  const last = live.last;
  const r = last?.record;
  const pumped = recs.filter((x) => x.flow_in > 500);
  const dflow = pumped.map((x) => ((x.flow_out - x.flow_in) / x.flow_in) * 100);
  const onBottom = recs.filter((x) => x.on_bottom > 0);
  const tail = (a: number[]) => a.slice(-240);

  return (
    <section className="card" aria-labelledby="readings-h">
      <div className="card-h">
        <div>
          <h3 id="readings-h">Live drilling readings</h3>
          <p>eRTMAC-style feed · one record every 10 seconds</p>
        </div>
        {live.status === "running" && <span className="live-pill"><span className="live-dot on" aria-hidden />LIVE</span>}
        {live.status === "paused" && <span className="live-pill paused">PAUSED</span>}
        {live.status === "done" && <span className="live-pill done">END OF FEED</span>}
      </div>
      <div className="card-b col" style={{ gap: 20 }}>
        {r ? (
          <>
            <div className="readings">
              <Reading label="Flow out − flow in" value={dflow.length ? dflow[dflow.length - 1].toFixed(1) : "–"} unit="%" data={tail(dflow)} color="#0EA5E9" />
              <Reading label="Pit volume" value={r.pit.toFixed(1)} unit="m³" data={tail(recs.map((x) => x.pit))} color="#06B6D4" />
              <Reading label="Torque" value={r.torque.toFixed(1)} unit="kN·m" data={tail(onBottom.map((x) => x.torque))} color="#8B5CF6" />
              <Reading label="Hookload" value={r.hookload.toFixed(0)} unit="t" data={tail(recs.map((x) => x.hookload))} color="#64748B" />
              <Reading label="Total gas" value={r.gas.toFixed(1)} unit="%" data={tail(recs.map((x) => x.gas))} color="#EC4899" />
              <Reading label="Drilling rate" value={r.rop.toFixed(1)} unit="m/h" data={tail(onBottom.map((x) => x.rop))} color="#65A30D" />
            </div>
            <div className="ew">
              <div>
                <h4 style={{ fontSize: "1.0625rem" }}>Early-warning signals</h4>
                <p className="small muted">Live model probability for each problem. The dark mark is the alarm threshold.</p>
              </div>
              {FAMILIES.filter((f) => last.live?.[f]).map((f) => {
                const v = last.live[f];
                const over = v.p >= v.threshold;
                return (
                  <div key={f} className="ew-row">
                    <span className="row" style={{ gap: 8, color: FAMILY_INK[f] }}><FamilyDot family={f} />{meta.risk_families[f]}</span>
                    <div className="bar" style={{ position: "relative" }}>
                      <div style={{ width: `${v.p * 100}%`, background: over ? "var(--red)" : FAMILY_COLOR[f] }} />
                      <span className="ew-thr" style={{ left: `${v.threshold * 100}%` }} />
                    </div>
                    <b className="num" style={{ textAlign: "right", color: over ? "var(--red-ink)" : undefined }}>{Math.round(v.p * 100)}%</b>
                  </div>
                );
              })}
            </div>
          </>
        ) : (
          <div className="col" style={{ gap: 16 }}>
            <p className="ink2">
              Replay {meta.active_well_name}'s drilling feed (synthetic, eRTMAC-style 10-second records) through the full NWIS chain:
            </p>
            <div className="pipeline">
              {CHAIN.map((s, i) => <Fragment key={s}>{i > 0 && <ChevronRight aria-hidden />}<span className="p">{s}</span></Fragment>)}
            </div>
            {live.status !== "connecting" && (
              <div>
                <button className="btn btn-primary btn-lg" onClick={() => onStart(2740)}><Play /> Start live replay from 2,740 m</button>
              </div>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
