import { useEffect, useState } from "react";
import { RotateCcw, ServerOff } from "lucide-react";
import { api, type Meta } from "./api";
import { Logo } from "./components/Chrome";
import Landing from "./landing/Landing";
import { useRoute } from "./router";
import { useReplay } from "./useReplay";
import Workspace, { NAV } from "./Workspace";

type MetaX = Meta & { faults?: [number, number][][] };

export default function App() {
  const route = useRoute();
  const [meta, setMeta] = useState<MetaX | null>(null);
  const [err, setErr] = useState<string | null>(null);
  // Lives above the routes so a running replay survives a visit to the landing page.
  const replay = useReplay();
  useEffect(() => { api.meta().then(setMeta).catch((e) => setErr(String(e))); }, []);

  const view = route.page === "landing" ? "landing" : route.module;
  useEffect(() => {
    window.scrollTo(0, 0);
    const mod = NAV.find((n) => n.id === view);
    document.title = mod ? `${mod.label} · NWIS` : "NWIS · Nearby Wells Intelligence System";
  }, [view]);

  if (route.page === "landing") return <Landing meta={meta} />;
  if (err) return <ApiError err={err} />;
  if (!meta) {
    return (
      <div className="full-center">
        <div className="col" style={{ alignItems: "center", gap: 18 }}>
          <Logo size={64} />
          <div className="loading" role="status" style={{ padding: 0, fontSize: "1.0625rem" }}><span className="spinner" aria-hidden />Connecting to NWIS…</div>
        </div>
      </div>
    );
  }
  return <Workspace meta={meta} module={route.module} query={route.query} replay={replay} />;
}

function ApiError({ err }: { err: string }) {
  return (
    <div className="full-center">
      <div className="err-card" role="alert">
        <div className="ic-tile t-saffron"><ServerOff aria-hidden /></div>
        <h1 style={{ fontSize: "1.75rem" }}>The NWIS service is not reachable</h1>
        <p className="ink2">The workspace needs the NWIS API. Start it from the <code>backend</code> folder, then try again:</p>
        <p><code>.venv/Scripts/python -m uvicorn nwis.api.main:app --port 8000</code></p>
        <p className="small muted">Details: {err}</p>
        <div className="row wrap">
          <button className="btn btn-primary btn-lg" onClick={() => location.reload()}><RotateCcw /> Try again</button>
          <a className="btn btn-lg" href="#/">Back to home</a>
        </div>
      </div>
    </div>
  );
}
