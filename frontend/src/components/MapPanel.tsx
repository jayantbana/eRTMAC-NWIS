import { useEffect, useRef, useState } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import type { Offset, WellSummary } from "../api";
import { useApp } from "../state";

function relColor(s: number | undefined, threshold: number): string {
  if (s == null) return "#334155";
  if (s < threshold) return "#64748b";
  // 0.5 -> teal, 1.0 -> bright cyan/green
  const t = Math.min(1, (s - threshold) / (1 - threshold));
  const r = Math.round(45 + (52 - 45) * t);
  const g = Math.round(160 + (230 - 160) * t);
  const b = Math.round(180 + (160 - 180) * t);
  return `rgb(${r},${g},${b})`;
}

export default function MapPanel({ wells, offsets, selected, onSelect, faults }: {
  wells: WellSummary[]; offsets: Offset[]; selected: string | null; onSelect: (id: string) => void; faults?: [number, number][][];
}) {
  const { meta, radius } = useApp();
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const layer = useRef<L.LayerGroup | null>(null);
  const tiles = useRef<L.TileLayer | null>(null);
  const [basemap, setBasemap] = useState(true);

  useEffect(() => {
    if (!el.current || map.current) return;
    const active = wells.find((w) => w.is_active);
    const m = L.map(el.current, { zoomControl: true, attributionControl: true, preferCanvas: false })
      .setView(active ? [active.lat, active.lon] : [27.35, 95.3], 12);
    map.current = m;
    layer.current = L.layerGroup().addTo(m);
    tiles.current = L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: "&copy; OpenStreetMap contributors | wells: SYNTHETIC", maxZoom: 18, className: "dark-tiles",
    }).addTo(m);
    const ro = new ResizeObserver(() => m.invalidateSize());
    ro.observe(el.current);
    return () => { ro.disconnect(); m.remove(); map.current = null; };
  }, [wells.length]);

  useEffect(() => {
    const m = map.current;
    if (!m || !tiles.current) return;
    if (basemap && !m.hasLayer(tiles.current)) tiles.current.addTo(m);
    if (!basemap && m.hasLayer(tiles.current)) m.removeLayer(tiles.current);
  }, [basemap]);

  useEffect(() => {
    const g = layer.current;
    if (!g) return;
    g.clearLayers();
    const active = wells.find((w) => w.is_active);
    const rel = new Map(offsets.map((o) => [o.well_id, o]));
    const thr = meta.thresholds.relevance_include;
    (faults ?? []).forEach((f) =>
      L.polyline(f, { color: "#f97316", weight: 1.5, dashArray: "6 5", opacity: 0.7, interactive: false }).addTo(g));
    if (active) {
      L.circle([active.lat, active.lon], { radius: radius * 1000, color: "#38bdf8", weight: 1, fill: true, fillOpacity: 0.03, dashArray: "4 4", interactive: false }).addTo(g);
    }
    wells.forEach((w) => {
      const o = rel.get(w.id);
      const isSel = selected === w.id;
      if (w.path.length > 2) {
        L.polyline(w.path, { color: w.is_active ? "#fbbf24" : "#475569", weight: w.is_active ? 2.5 : 1.2, opacity: 0.9, interactive: false }).addTo(g);
      }
      if (w.is_active) {
        const icon = L.divIcon({
          className: "", iconSize: [26, 26], iconAnchor: [13, 13],
          html: `<svg width="26" height="26" viewBox="0 0 26 26"><polygon points="13,1 16.5,9.5 25,10 18.5,16 20.5,25 13,20 5.5,25 7.5,16 1,10 9.5,9.5" fill="#fbbf24" stroke="#0b1220" stroke-width="1.5"/></svg>`,
        });
        L.marker([w.lat, w.lon], { icon, zIndexOffset: 1000 }).bindTooltip(`<b>${w.name}</b> (active, drilling)`, { direction: "top", offset: [0, -10] })
          .on("click", () => onSelect(w.id)).addTo(g);
        return;
      }
      const s = o?.overall;
      const color = relColor(s, thr);
      const included = s != null && s >= thr;
      const c = L.circleMarker([w.lat, w.lon], {
        radius: included ? 6 + 6 * (s ?? 0) : 4.5, color: isSel ? "#fff" : "#0b1220", weight: isSel ? 2.5 : 1, fillColor: color,
        fillOpacity: o ? 0.95 : 0.45,
      });
      const relTxt = o ? `relevance <b>${o.overall.toFixed(2)}</b>${included ? "" : " (below threshold)"}<br/>${o.explanation}` : "outside radius";
      c.bindTooltip(`<b>${w.name}</b> · compartment ${w.compartment} · ${w.spud_year}<br/>${relTxt}<br/>${w.n_events} recorded events`, { direction: "top" });
      c.on("click", () => onSelect(w.id));
      c.addTo(g);
      if (included) {
        L.marker([w.lat, w.lon], {
          icon: L.divIcon({ className: "", html: `<div style="color:#e5e7eb;font-size:11px;font-weight:600;text-shadow:0 0 3px #000;transform:translate(10px,-6px);white-space:nowrap">${w.name.replace("Well ", "")}</div>`, iconSize: [0, 0] }),
          interactive: false,
        }).addTo(g);
      }
    });
  }, [wells, offsets, selected, radius, faults, meta]);

  return (
    <div style={{ position: "relative", height: "100%" }}>
      <div ref={el} className="map" />
      <div style={{ position: "absolute", left: 10, bottom: 10, zIndex: 500 }} className="col">
        <div className="stat small" style={{ padding: "6px 8px" }}>
          <div className="row"><span className="legend-dot" style={{ background: "rgb(52,230,160)" }} /> relevant offset (size = relevance)</div>
          <div className="row"><span className="legend-dot" style={{ background: "#64748b" }} /> in radius, low relevance</div>
          <div className="row"><span style={{ width: 14, borderTop: "2px dashed #f97316", display: "inline-block" }} /> fault (compartment boundary)</div>
          <label className="row" style={{ cursor: "pointer" }}><input type="checkbox" checked={basemap} onChange={(e) => setBasemap(e.target.checked)} /> basemap (online)</label>
        </div>
      </div>
    </div>
  );
}
