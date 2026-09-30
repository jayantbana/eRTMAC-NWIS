import { useEffect, useRef, useState } from "react";
import { Activity, BellRing, ChevronRight, Columns3, Drill, Home, Layers, Library, MapPin, MessageSquareText, Minus, Plus, X } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { api, type Alert, type Meta, type Offset, type RiskTrack, type WellSummary } from "./api";
import AlertDetail from "./components/AlertDetail";
import { Brand, GovStrip } from "./components/Chrome";
import EvidenceDrawer from "./components/EvidenceDrawer";
import WellDrawer from "./components/WellDrawer";
import { moduleHref, type ModuleId } from "./router";
import { AppState, useApp } from "./state";
import { FAMILY_INK, Loading, TIER_COLOR, TIER_RANK, TierBadge, fmt, vars } from "./ui";
import type { LiveState, useReplay } from "./useReplay";
import Ask from "./views/Ask";
import Atlas from "./views/Atlas";
import Cockpit from "./views/Cockpit";
import Correlation from "./views/Correlation";
import Knowledge from "./views/Knowledge";
import Wells from "./views/Wells";

type Replay = ReturnType<typeof useReplay>;

export const NAV: { id: ModuleId; label: string; icon: LucideIcon }[] = [
  { id: "live", label: "Live monitoring", icon: Activity },
  { id: "wells", label: "Nearby wells", icon: MapPin },
  { id: "compare", label: "Compare wells", icon: Columns3 },
  { id: "atlas", label: "Risk by rock layer", icon: Layers },
  { id: "ask", label: "Ask the reports", icon: MessageSquareText },
  { id: "knowledge", label: "Knowledge base", icon: Library },
];

export default function Workspace({ meta, module, query, replay }: {
  meta: Meta & { faults?: [number, number][][] }; module: ModuleId; query: URLSearchParams; replay: Replay;
}) {
  return (
    <AppState meta={meta}>
      <Shell faults={meta.faults ?? []} module={module} query={query} replay={replay} />
    </AppState>
  );
}

function Shell({ faults, module, query, replay }: { faults: [number, number][][]; module: ModuleId; query: URLSearchParams; replay: Replay }) {
  const { meta, evidence, wellDrawer, radius, dataVersion, closeEvidence, openWell } = useApp();
  const [wells, setWells] = useState<WellSummary[]>([]);
  const [offsets, setOffsets] = useState<Offset[]>([]);
  const [track, setTrack] = useState<RiskTrack | null>(null);
  const [alertOpen, setAlertOpen] = useState<string | null>(null);
  const { live } = replay;
  // The live page already lists every alert, so toasts only pop up on the other modules.
  const toasts = useAlertToasts(live.alerts, module !== "live");

  useEffect(() => { api.wells().then(setWells); }, []);
  useEffect(() => {
    api.offsets(meta.active_well_id, radius).then(setOffsets);
    api.track(meta.active_well_id, radius).then(setTrack);
  }, [radius, dataVersion]);

  // Overlays belong to the module they were opened from (matters for browser back/forward).
  useEffect(() => { closeEvidence(); openWell(null); setAlertOpen(null); }, [module]);

  // Demo convenience: #/workspace/live?autostart=2740&speed=300 starts the replay immediately.
  useEffect(() => {
    const from = query.get("autostart");
    if (from) replay.start(+from, +(query.get("speed") ?? 300), radius);
  }, []);

  const alert = live.alerts.find((a) => a.id === alertOpen) ?? null;

  return (
    <div className="ws">
      <GovStrip />
      <WsHeader live={live} />
      <nav className="ws-nav" aria-label="Workspace modules">
        <div className="ws-nin">
          {NAV.map((n) => <NavItem key={n.id} item={n} active={module === n.id} alerts={n.id === "live" ? live.alerts : []} />)}
        </div>
      </nav>
      <main id="main" tabIndex={-1}>
        {wells.length === 0 ? <div className="page"><Loading what="Loading the field" /></div> : (
          <>
            {module === "live" && <Cockpit replay={replay} track={track} offsets={offsets} onOpenAlert={(a) => setAlertOpen(a.id)} />}
            {module === "wells" && <Wells wells={wells} offsets={offsets} faults={faults} />}
            {module === "compare" && <Correlation offsets={offsets} />}
            {module === "atlas" && <Atlas />}
            {module === "ask" && <Ask />}
            {module === "knowledge" && <Knowledge />}
          </>
        )}
      </main>
      <div className="toasts">
        {toasts.items.map((t) => (
          <Toast key={t.key} alert={t.alert} onClose={() => toasts.dismiss(t.key)} onOpen={() => { setAlertOpen(t.alert.id); toasts.dismiss(t.key); }} />
        ))}
      </div>
      {alert && <AlertDetail alert={alert} onClose={() => setAlertOpen(null)} onAck={(r) => replay.ack(alert.id, r)} />}
      {evidence && <EvidenceDrawer target={evidence} />}
      {wellDrawer && <WellDrawer wellId={wellDrawer} offsets={offsets} />}
    </div>
  );
}

function WsHeader({ live }: { live: LiveState }) {
  const { meta, radius, setRadius } = useApp();
  const md = live.last?.record?.hole_md as number | undefined;
  const status = {
    running: `Drilling · ${fmt.m(md)}`,
    paused: `Paused · ${fmt.m(md)}`,
    connecting: "Connecting to the feed…",
    done: "Replay finished",
    idle: `Last depth ${fmt.m(meta.active_current_md)}`,
  }[live.status];
  return (
    <header className="ws-header">
      <div className="ws-hin">
        <Brand compact />
        <div className="ws-ctx">
          <div className="ctx-card">
            <div className="ctx-ic"><Drill aria-hidden /></div>
            <div>
              <div className="ctx-k">Active well</div>
              <div className="ctx-v row" style={{ gap: 8 }}>
                <span className={`live-dot ${live.status === "running" ? "on" : live.status === "paused" ? "paused" : ""}`} aria-hidden />
                {meta.active_well_name}<span>· {status}</span>
              </div>
            </div>
          </div>
          <div className="ctx-card radius">
            <div>
              <div className="ctx-k" id="radius-l">Search radius</div>
              <div className="stepper" role="group" aria-labelledby="radius-l">
                <button type="button" aria-label="Decrease search radius" disabled={radius <= 2} onClick={() => setRadius(Math.max(2, radius - 1))}><Minus /></button>
                <output aria-live="polite">{radius} km</output>
                <button type="button" aria-label="Increase search radius" disabled={radius >= 20} onClick={() => setRadius(Math.min(20, radius + 1))}><Plus /></button>
              </div>
            </div>
          </div>
        </div>
        <span className="spacer" />
        <div className="ws-counts" aria-label="Knowledge base size">
          <div><b>{meta.counts.wells}</b>wells</div>
          <div><b>{meta.counts.documents}</b>reports</div>
          <div><b>{meta.counts.events}</b>events</div>
        </div>
        <span className="badge b-solid-amber" title="All wells, reports and drilling data are synthetic demo data, not real OIL records">{meta.data_mode} DATA</span>
        <a className="btn" href="#/" aria-label="Home"><Home /><span className="home-label">Home</span></a>
      </div>
    </header>
  );
}

function NavItem({ item, active, alerts }: { item: (typeof NAV)[number]; active: boolean; alerts: Alert[] }) {
  const raised = alerts.filter((a) => a.tier);
  const top = raised.reduce<string | null>((m, a) => ((TIER_RANK[a.tier!] ?? 0) > (TIER_RANK[m ?? ""] ?? 0) ? a.tier : m), null);
  return (
    <a href={moduleHref(item.id)} className={`nav-i${active ? " on" : ""}`} aria-current={active ? "page" : undefined}>
      <item.icon aria-hidden />{item.label}
      {raised.length > 0 && <span className={`nav-count ${top ?? ""}`} title={`${raised.length} active alerts`}>{raised.length}</span>}
    </a>
  );
}

/** Pops a toast when an alert is raised or escalates to a higher tier. */
function useAlertToasts(alerts: Alert[], enabled: boolean) {
  // Alerts already active when the workspace opens are not re-announced.
  const seen = useRef<Map<string, number> | null>(null);
  if (!seen.current) seen.current = new Map(alerts.map((a) => [a.id, TIER_RANK[a.tier ?? ""] ?? 0]));
  const [items, setItems] = useState<{ key: string; alert: Alert }[]>([]);
  useEffect(() => {
    const fresh: { key: string; alert: Alert }[] = [];
    const next = new Map<string, number>();
    for (const a of alerts) {
      const r = TIER_RANK[a.tier ?? ""] ?? 0;
      next.set(a.id, r);
      if (r > (seen.current!.get(a.id) ?? 0)) fresh.push({ key: `${a.id}:${a.tier}`, alert: a });
    }
    seen.current = next;
    if (fresh.length && enabled) setItems((t) => [...t.filter((x) => !fresh.some((f) => f.alert.id === x.alert.id)), ...fresh].slice(-2));
  }, [alerts]);
  useEffect(() => { if (!enabled) setItems([]); }, [enabled]);
  return { items, dismiss: (key: string) => setItems((t) => t.filter((x) => x.key !== key)) };
}

function Toast({ alert: a, onClose, onOpen }: { alert: Alert; onClose: () => void; onOpen: () => void }) {
  useEffect(() => {
    const h = setTimeout(onClose, 7000);
    return () => clearTimeout(h);
  }, []);
  return (
    <div className="toast" role="alert" style={vars({ tc: TIER_COLOR[a.tier ?? ""] ?? "var(--primary)" })}>
      <div className="toast-ic"><BellRing aria-hidden /></div>
      <div style={{ minWidth: 0 }}>
        <div className="row wrap"><TierBadge tier={a.tier} /><b style={{ color: FAMILY_INK[a.family] }}>{a.label}</b></div>
        <p>{a.message}</p>
        <button className="btn btn-sm btn-soft" style={{ marginTop: 10 }} onClick={onOpen}>See evidence <ChevronRight /></button>
      </div>
      <button className="btn btn-ghost btn-icon btn-sm" aria-label="Dismiss" onClick={onClose}><X /></button>
    </div>
  );
}
