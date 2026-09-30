import { useCallback, useEffect, useRef, useState } from "react";
import type { Alert, RiskTrack } from "./api";

export interface Rec {
  t: number; bit_md: number; hole_md: number; rop: number; wob: number; rpm: number; torque: number; hookload: number; spp: number;
  flow_in: number; flow_out: number; pit: number; mw: number; ecd: number; gas: number; on_bottom: number;
}
export interface LiveState {
  status: "idle" | "connecting" | "running" | "paused" | "done";
  track: RiskTrack | null;
  alerts: Alert[];
  notices: { t: number; kind: string; text: string; code: string; md: number; expected_md: number }[];
  records: Rec[];
  last: any | null;
  progress: number;
  speed: number;
}

const INITIAL: LiveState = { status: "idle", track: null, alerts: [], notices: [], records: [], last: null, progress: 0, speed: 300 };
const KEEP = 720; // ~2 h of 10 s records for sparklines

export function useReplay() {
  const [s, setS] = useState<LiveState>(INITIAL);
  const ws = useRef<WebSocket | null>(null);
  const pending = useRef<any[]>([]);

  const send = useCallback((obj: any) => {
    const sock = ws.current;
    if (sock && sock.readyState === WebSocket.OPEN) sock.send(JSON.stringify(obj));
    else pending.current.push(obj);
  }, []);

  const connect = useCallback(() => {
    if (ws.current && (ws.current.readyState === WebSocket.OPEN || ws.current.readyState === WebSocket.CONNECTING)) return;
    const proto = location.protocol === "https:" ? "wss" : "ws";
    const sock = new WebSocket(`${proto}://${location.host}/api/ws/replay`);
    ws.current = sock;
    sock.onopen = () => {
      pending.current.forEach((m) => sock.send(JSON.stringify(m)));
      pending.current = [];
    };
    sock.onclose = () => {
      ws.current = null;
      setS((p) => (p.status === "running" ? { ...p, status: "paused" } : p));
    };
    sock.onmessage = (ev) => {
      const m = JSON.parse(ev.data);
      setS((p) => {
        // After stop, ignore ticks that were already in flight so the reset state sticks.
        if (p.status === "idle") return p;
        if (m.type === "init") {
          return { ...p, status: "running", track: m.track, alerts: m.alerts, notices: m.notices, records: [], last: null, progress: m.progress };
        }
        if (m.type === "tick") {
          const recs = p.records.concat(m.records);
          return {
            ...p, records: recs.length > KEEP ? recs.slice(recs.length - KEEP) : recs, last: m.last, alerts: m.alerts, notices: m.notices,
            progress: m.progress, track: m.track ?? p.track,
          };
        }
        if (m.type === "alerts") return { ...p, alerts: m.alerts };
        if (m.type === "done") return { ...p, status: "done", alerts: m.alerts, notices: m.notices, progress: 1 };
        return p;
      });
    };
  }, []);

  useEffect(() => () => ws.current?.close(), []);

  return {
    live: s,
    start: (fromMd: number, speed: number, radius: number) => {
      connect();
      setS((p) => ({ ...INITIAL, status: "connecting", speed }));
      send({ cmd: "start", from_md: fromMd, speed, radius_km: radius });
    },
    pause: () => { send({ cmd: "pause" }); setS((p) => ({ ...p, status: "paused" })); },
    resume: () => { send({ cmd: "resume" }); setS((p) => ({ ...p, status: "running" })); },
    setSpeed: (v: number) => { send({ cmd: "speed", value: v }); setS((p) => ({ ...p, speed: v })); },
    stop: () => { send({ cmd: "stop" }); setS(INITIAL); },
    ack: (alertId: string, reason: string) => send({ cmd: "ack", alert_id: alertId, reason, user: "engineer" }),
  };
}
