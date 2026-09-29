import React from "react";
import type { Family } from "./api";

export const FAMILY_COLOR: Record<string, string> = {
  LC: "#38bdf8", SP: "#a78bfa", OP: "#f472b6", TQ: "#a3e635", CM: "#2dd4bf", PR: "#e5e7eb",
};
export const FAMILY_SHORT: Record<string, string> = { LC: "Loss", SP: "Stuck", OP: "Press", TQ: "Torq", CM: "Cmt", PR: "Practice" };
export const TIER_COLOR: Record<string, string> = { ADVISORY: "#fbbf24", CAUTION: "#fb923c", WARNING: "#ef4444" };
export const FORMATION_COLOR: Record<string, string> = {
  ALV: "#6b5d3f", DHK: "#7c6236", NMS: "#6e5a3a", GRJ: "#5b4a6b", TPM: "#8a7432", BRL: "#3b4a5a", KPL: "#374151", SLT: "#35607a",
  LGP: "#4b5563", BSM: "#5a1e1e",
};

export const fmt = {
  m: (v: number | null | undefined, d = 0) => (v == null ? "–" : `${v.toLocaleString("en-IN", { maximumFractionDigits: d, minimumFractionDigits: d })} m`),
  n: (v: number | null | undefined, d = 1) => (v == null ? "–" : v.toFixed(d)),
  pct: (v: number | null | undefined, d = 0) => (v == null ? "–" : `${(v * 100).toFixed(d)}%`),
};

export function FamilyDot({ family, size = 9 }: { family: string | null; size?: number }) {
  return <span className="legend-dot" style={{ background: FAMILY_COLOR[family ?? "PR"], width: size, height: size }} />;
}

export function Tier({ tier }: { tier: string | null }) {
  if (!tier) return <span className="tier muted">CLEARED</span>;
  return <span className={`tier ${tier}`}>{tier}</span>;
}

export function Bar({ value, color = "#38bdf8" }: { value: number; color?: string }) {
  return (
    <div className="bar">
      <div style={{ width: `${Math.max(0, Math.min(1, value)) * 100}%`, background: color }} />
    </div>
  );
}

export function Sparkline({ data, color = "#38bdf8", height = 34, width = 150, min, max }: {
  data: number[]; color?: string; height?: number; width?: number; min?: number; max?: number;
}) {
  if (data.length < 2) return <svg width={width} height={height} />;
  const lo = min ?? Math.min(...data);
  const hi = max ?? Math.max(...data);
  const span = hi - lo || 1;
  const pts = data.map((v, i) => `${(i / (data.length - 1)) * width},${height - ((v - lo) / span) * (height - 4) - 2}`).join(" ");
  return (
    <svg width={width} height={height} style={{ display: "block" }}>
      <polyline points={pts} fill="none" stroke={color} strokeWidth={1.5} />
    </svg>
  );
}

export function Loading({ what = "Loading" }: { what?: string }) {
  return <div className="muted small" style={{ padding: 12 }}>{what}…</div>;
}

export function Empty({ children }: { children: React.ReactNode }) {
  return <div className="muted small" style={{ padding: 12 }}>{children}</div>;
}

export function outcomeBadge(o: string) {
  const cls = o === "resolved" ? "ok" : o === "failed" ? "warn" : "";
  return <span className={`badge ${cls}`}>{o}</span>;
}

export function familyLabel(f: Family | string | null, names: Record<string, string>) {
  if (!f) return "Good practice";
  return names[f] ?? f;
}
