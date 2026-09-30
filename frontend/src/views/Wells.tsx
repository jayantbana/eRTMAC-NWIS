import { CheckCircle2, MapPin, Radar, XCircle } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { Offset, WellSummary } from "../api";
import MapPanel from "../components/MapPanel";
import { useApp } from "../state";
import { Bar, CompartmentTag, Loading, PageHeader, cap } from "../ui";

export default function Wells({ wells, offsets, faults }: { wells: WellSummary[]; offsets: Offset[]; faults: [number, number][][] }) {
  const { meta, radius, setRadius, openWell } = useApp();
  const thr = meta.thresholds.relevance_include;
  const used = offsets.filter((o) => o.overall >= thr);
  const setAside = offsets.length - used.length;
  const across = offsets.filter((o) => o.overall < thr && !o.same_compartment).length;

  return (
    <div className="page">
      <PageHeader
        eyebrow="Offset well selection" icon={Radar} title="Nearby wells"
        sub={<>NWIS ranks every well around {meta.active_well_name} by how closely its geology matches: fault block, rock layers, depth coverage, well path, hole and mud. Distance alone does not decide.</>}
        actions={
          <div className="toolbar" style={{ paddingRight: 20 }}>
            <label className="field" htmlFor="radius-range">Search radius</label>
            <input id="radius-range" type="range" min={2} max={20} step={1} value={radius} onChange={(e) => setRadius(+e.target.value)} style={{ width: 200 }} />
            <b className="num" style={{ minWidth: 56, fontSize: "1.0625rem" }}>{radius} km</b>
          </div>
        }
      />

      <div className="summary">
        <Summary icon={MapPin} tone="t-blue" value={offsets.length} label={`wells within ${radius} km`} sub={`of ${wells.length - 1} wells in the field`} />
        <Summary icon={CheckCircle2} tone="t-green" value={used.length} label="used as guides" sub={`relevance score ${thr.toFixed(2)} or higher`} />
        <Summary icon={XCircle} tone="t-saffron" value={setAside} label="set aside" sub={setAside ? `${across} of them across a fault` : "every well in range is used"} />
      </div>

      <div className="wells-grid">
        <section className="card" aria-labelledby="map-h">
          <div className="card-h">
            <div><h3 id="map-h">Field map</h3><p>Click any well to see its details and why it scored the way it did.</p></div>
          </div>
          <MapPanel wells={wells} offsets={offsets} selected={null} onSelect={(id) => openWell(id)} faults={faults} />
        </section>

        <section className="card" aria-labelledby="rank-h">
          <div className="card-h">
            <div><h3 id="rank-h">Wells ranked by relevance</h3><p>Scores run from 0 to 1. Wells scoring {thr.toFixed(2)} or more guide the risk forecast.</p></div>
          </div>
          {offsets.length === 0 ? <Loading what="Ranking nearby wells" /> : (
            <ol className="well-list">
              {offsets.map((o, i) => {
                const inc = o.overall >= thr;
                const reasons = o.explanation.split("; ").filter((s) => !s.includes("compartment"));
                return (
                  <li key={o.well_id}>
                    <button className={`well-row${inc ? "" : " dim"}`} onClick={() => openWell(o.well_id)}>
                      <span className="rank">{i + 1}</span>
                      <div style={{ minWidth: 0 }}>
                        <div className="wr-name">{o.name}<CompartmentTag same={o.same_compartment} /></div>
                        <div className="small muted" style={{ marginTop: 3 }}>{o.surface_distance_km.toFixed(1)} km away · drilled {o.spud_year} · {o.n_events} recorded problems</div>
                        {reasons.length > 0 && <div className="wr-meta">{reasons.map((r) => <span key={r}>{cap(r)}</span>)}</div>}
                      </div>
                      <div className="wr-score">
                        <b style={{ color: inc ? "var(--green-ink)" : "var(--muted)" }}>{o.overall.toFixed(2)}</b>
                        <Bar value={o.overall} color={inc ? "var(--green)" : "var(--faint)"} />
                        <div className="xs" style={{ color: inc ? "var(--green-ink)" : "var(--muted)" }}>{inc ? "Used as a guide" : "Set aside"}</div>
                      </div>
                    </button>
                  </li>
                );
              })}
            </ol>
          )}
        </section>
      </div>
    </div>
  );
}

function Summary({ icon: Icon, tone, value, label, sub }: { icon: LucideIcon; tone: string; value: number; label: string; sub: string }) {
  return (
    <div className="kpi" style={{ flexDirection: "row", alignItems: "center", gap: 16 }}>
      <div className={`ic-tile ${tone}`}><Icon aria-hidden /></div>
      <div style={{ minWidth: 0 }}>
        <div className="kpi-v">{value} <small style={{ color: "var(--ink-2)", fontSize: "1.0625rem" }}>{label}</small></div>
        <div className="kpi-s">{sub}</div>
      </div>
    </div>
  );
}
