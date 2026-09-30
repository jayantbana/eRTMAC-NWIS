import { useEffect, useRef, useState } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import type { Offset, WellSummary } from "../api";
import { useApp } from "../state";

/** Green scale for wells used as guides (darker = more relevant); grey below the threshold. */
function relColor(s: number | undefined, threshold: number): string {
  if (s == null) return "#CBD5E1";
  if (s < threshold) return "#A6B2C8";
  const t = Math.min(1, (s - threshold) / (1 - threshold));
  const mix = (a: number, b: number) => Math.round(a + (b - a) * t);
  return `rgb(${mix(52, 4)},${mix(211, 120)},${mix(153, 87)})`;
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

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
    const m = L.map(el.current, { zoomControl: true, attributionControl: true, scrollWheelZoom: false })
      .setView(active ? [active.lat, active.lon] : [27.35, 95.3], 12);
    map.current = m;
    layer.current = L.layerGroup().addTo(m);
    tiles.current = L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: "&copy; OpenStreetMap contributors | wells: SYNTHETIC", maxZoom: 18, className: "light-tiles",
    }).addTo(m);
    m.on("focus", () => m.scrollWheelZoom.enable());
    m.on("blur", () => m.scrollWheelZoom.disable());
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
      L.polyline(f, { color: "#E4572E", weight: 2.5, dashArray: "8 6", opacity: 0.85, interactive: false }).addTo(g));
    if (active) {
      L.circle([active.lat, active.lon], { radius: radius * 1000, color: "#1F4FE0", weight: 2, fill: true, fillColor: "#1F4FE0", fillOpacity: 0.05, dashArray: "6 6", interactive: false }).addTo(g);
    }
    wells.forEach((w) => {
      const o = rel.get(w.id);
      const isSel = selected === w.id;
      if (w.path.length > 2) {
        L.polyline(w.path, { color: w.is_active ? "#FF7A1A" : "#8C9AB0", weight: w.is_active ? 3 : 1.6, opacity: 0.9, interactive: false }).addTo(g);
      }
      if (w.is_active) {
        const icon = L.divIcon({
          className: "", iconSize: [34, 34], iconAnchor: [17, 17],
          html: `<svg width="34" height="34" viewBox="0 0 26 26"><polygon points="13,1 16.5,9.5 25,10 18.5,16 20.5,25 13,20 5.5,25 7.5,16 1,10 9.5,9.5" fill="#FF7A1A" stroke="#fff" stroke-width="1.8" stroke-linejoin="round"/></svg>`,
        });
        L.marker([w.lat, w.lon], { icon, zIndexOffset: 1000, keyboard: true, title: `${w.name} (active)` })
          .bindTooltip(`<b>${esc(w.name)}</b> · active well, drilling now`, { direction: "top", offset: [0, -14] })
          .on("click", () => onSelect(w.id)).addTo(g);
        L.marker([w.lat, w.lon], { icon: L.divIcon({ className: "", html: `<div class="well-label" style="color:#C2410C">${esc(w.name)}</div>`, iconSize: [0, 0] }), interactive: false }).addTo(g);
        return;
      }
      const s = o?.overall;
      const included = s != null && s >= thr;
      const c = L.circleMarker([w.lat, w.lon], {
        radius: included ? 7 + 7 * (s ?? 0) : o ? 6 : 4.5, color: isSel ? "#0B1B34" : "#fff", weight: isSel ? 3 : 2, fillColor: relColor(s, thr),
        fillOpacity: o ? 1 : 0.7,
      });
      const relTxt = o
        ? `Relevance <b>${o.overall.toFixed(2)}</b> ${included ? "· used as a guide" : "· set aside"}<br/>${esc(o.explanation)}`
        : "Outside the search radius";
      c.bindTooltip(`<b>${esc(w.name)}</b> · fault block ${esc(w.compartment)} · drilled ${w.spud_year}<br/>${relTxt}<br/>${w.n_events} recorded problems`, { direction: "top" });
      c.on("click", () => onSelect(w.id));
      c.addTo(g);
      if (included) {
        L.marker([w.lat, w.lon], {
          icon: L.divIcon({ className: "", html: `<div class="well-label">${esc(w.name.replace("Well ", ""))}</div>`, iconSize: [0, 0] }),
          interactive: false,
        }).addTo(g);
      }
    });
  }, [wells, offsets, selected, radius, faults, meta]);

  return (
    <div className="map-wrap">
      <div ref={el} className="map" />
      <div className="map-legend">
        <span><span className="fdot" style={{ width: 14, height: 14, background: "rgb(28,166,120)" }} />Used as a guide (bigger = more relevant)</span>
        <span><span className="fdot" style={{ width: 11, height: 11, background: "#A6B2C8" }} />In the search area, low relevance</span>
        <span><svg width="22" height="10" aria-hidden><line x1="0" x2="22" y1="5" y2="5" stroke="#E4572E" strokeWidth="2.5" strokeDasharray="5 4" /></svg>Fault (block boundary)</span>
        <span><svg width="16" height="16" viewBox="0 0 26 26" aria-hidden><polygon points="13,1 16.5,9.5 25,10 18.5,16 20.5,25 13,20 5.5,25 7.5,16 1,10 9.5,9.5" fill="#FF7A1A" /></svg>{meta.active_well_name} (drilling)</span>
        <label><input type="checkbox" checked={basemap} onChange={(e) => setBasemap(e.target.checked)} />Background map (online)</label>
      </div>
    </div>
  );
}
