import { useEffect, useState } from "react";
import { api, type Meta, type WellSummary } from "./api";
import EvidenceDrawer from "./components/EvidenceDrawer";
import WellDrawer from "./components/WellDrawer";
import { AppState, useApp } from "./state";
import { useReplay } from "./useReplay";
import { Loading } from "./ui";
import Ask from "./views/Ask";
import Atlas from "./views/Atlas";
import Cockpit from "./views/Cockpit";
import Correlation from "./views/Correlation";
import Knowledge from "./views/Knowledge";

type Tab = "cockpit" | "correlation" | "atlas" | "ask" | "kb";
const TABS: [Tab, string][] = [["cockpit", "Well cockpit"], ["correlation", "Offsets & correlation"], ["atlas", "Formation risk atlas"], ["ask", "Ask NWIS"], ["kb", "Knowledge & evaluation"]];

export default function App() {
  const [meta, setMeta] = useState<(Meta & { faults?: [number, number][][] }) | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { api.meta().then(setMeta).catch((e) => setErr(String(e))); }, []);
  if (err) return <div className="center" style={{ height: "100%" }}><div className="notice">Cannot reach NWIS API: {err}. Start the backend: <span className="mono">uvicorn nwis.api.main:app --port 8000</span></div></div>;
  if (!meta) return <Loading what="Connecting to NWIS" />;
  return <AppState meta={meta}><Shell faults={meta.faults ?? []} /></AppState>;
}

function Shell({ faults }: { faults: [number, number][][] }) {
  const { meta, evidence, wellDrawer, radius } = useApp();
  const [tab, setTab] = useState<Tab>("cockpit");
  const [wells, setWells] = useState<WellSummary[]>([]);
  const [offsets, setOffsets] = useState<any[]>([]);
  const replay = useReplay();
  useEffect(() => { api.wells().then(setWells); }, []);
  useEffect(() => { api.offsets(meta.active_well_id, radius).then(setOffsets); }, [radius]);

  return (
    <div className="app">
      <div className="topbar">
        <div className="brand"><b>eRTMAC · NWIS</b><span>Nearby Wells Intelligence System</span></div>
        <div className="tabs">
          {TABS.map(([k, l]) => <button key={k} className={`tab ${tab === k ? "active" : ""}`} onClick={() => setTab(k)}>{l}</button>)}
        </div>
        <span className="spacer" />
        <span className="badge">Active: <b style={{ color: "#fbbf24" }}>{meta.active_well_name}</b>{replay.live.last ? ` @ ${replay.live.last.record.hole_md.toFixed(0)} m` : ""}</span>
        <span className="badge">{meta.counts.wells} wells · {meta.counts.documents} reports · {meta.counts.events} events</span>
        <span className="badge synthetic" title="All wells, reports and drilling data are synthetic demo data, not real OIL records">{meta.data_mode} DATA</span>
      </div>
      <div className="main">
        {wells.length === 0 ? <Loading /> : (
          <>
            {tab === "cockpit" && <Cockpit replay={replay} wells={wells} faults={faults} />}
            {tab === "correlation" && <Correlation />}
            {tab === "atlas" && <Atlas />}
            {tab === "ask" && <Ask />}
            {tab === "kb" && <Knowledge />}
          </>
        )}
      </div>
      {evidence && <EvidenceDrawer target={evidence} />}
      {wellDrawer && <WellDrawer wellId={wellDrawer} offsets={offsets} />}
    </div>
  );
}
