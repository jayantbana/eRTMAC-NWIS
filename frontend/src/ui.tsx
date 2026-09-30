import React, { useEffect } from "react";
import type { LucideIcon } from "lucide-react";
import type { Family } from "./api";

// Fill colours for risk families: bright, and at least 3:1 against white for marks.
export const FAMILY_COLOR: Record<string, string> = {
  LC: "#0EA5E9", SP: "#8B5CF6", OP: "#EC4899", TQ: "#84CC16", CM: "#14B8A6", PR: "#10B981",
};
// Text-safe variants of the same hues.
export const FAMILY_INK: Record<string, string> = {
  LC: "#0369A1", SP: "#6D28D9", OP: "#BE185D", TQ: "#4D7C0F", CM: "#0F766E", PR: "#047857",
};
export const FAMILY_SOFT: Record<string, string> = {
  LC: "#E3F4FD", SP: "#F1ECFF", OP: "#FDEAF4", TQ: "#EFF9DD", CM: "#E0F6F3", PR: "#DFF7EC",
};
// Two-line column headers for the depth track.
export const FAMILY_SHORT: Record<string, string[]> = {
  LC: ["Mud", "loss"], SP: ["Stuck", "pipe"], OP: ["Over-", "pressure"], TQ: ["Torque"], CM: ["Cement"], PR: ["Practice"],
};
export const EVENT_SHORT: Record<string, string> = {
  LOST_CIRCULATION: "Mud loss", STUCK_PIPE: "Stuck pipe", TIGHT_HOLE: "Tight hole", WELLBORE_INSTABILITY: "Unstable hole",
  OVERPRESSURE_KICK: "Kick", TORQUE_SPIKE: "Torque spikes", CEMENTING_PROBLEM: "Cement problem", NOTABLE_PRACTICE: "Good practice",
};
export const TIER_COLOR: Record<string, string> = { ADVISORY: "#F59E0B", CAUTION: "#F97316", WARNING: "#EF4444" };
export const TIER_RANK: Record<string, number> = { ADVISORY: 1, CAUTION: 2, WARNING: 3 };
export const TIER_MEANING: Record<string, string> = {
  ADVISORY: "A risk zone from nearby wells is inside the look-ahead window",
  CAUTION: "The bit is drilling through a historical risk zone",
  WARNING: "Live drilling signals show signs of the problem",
};
// Pastel geology palette: sandstones warm, clays lavender, shales blue-grey.
export const FORMATION_COLOR: Record<string, string> = {
  ALV: "#EFE4CB", DHK: "#EAD6A2", NMS: "#D9C291", GRJ: "#D6C8EC", TPM: "#F5D46E", BRL: "#B3C3D8", KPL: "#A2AEC0", SLT: "#A7D8E4",
  LGP: "#BFC8D4", BSM: "#DDAAAA",
};
// Darker versions for lines drawn on white.
export const FORMATION_LINE: Record<string, string> = {
  ALV: "#B59F6E", DHK: "#B8964A", NMS: "#A38652", GRJ: "#8E74BD", TPM: "#C99A12", BRL: "#6A84A8", KPL: "#66748A", SLT: "#3F9DB4",
  LGP: "#7C8899", BSM: "#B26565",
};

export const fmt = {
  m: (v: number | null | undefined, d = 0) => (v == null ? "–" : `${v.toLocaleString("en-IN", { maximumFractionDigits: d, minimumFractionDigits: d })} m`),
  n: (v: number | null | undefined, d = 1) => (v == null ? "–" : v.toFixed(d)),
  pct: (v: number | null | undefined, d = 0) => (v == null ? "–" : `${(v * 100).toFixed(d)}%`),
  int: (v: number | null | undefined, d = 0) => (v == null ? "–" : v.toLocaleString("en-IN", { maximumFractionDigits: d, minimumFractionDigits: d })),
};

export const cap = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

/** Inline CSS custom properties: vars({ tc: "#f00" }) -> { "--tc": "#f00" }. */
export const vars = (o: Record<string, string>) =>
  Object.fromEntries(Object.entries(o).map(([k, v]) => [`--${k}`, v])) as React.CSSProperties;

/** Hex colour with alpha, for tinted fills. */
export function hexA(hex: string, a: number) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a.toFixed(3)})`;
}

export function FamilyDot({ family, size = 10 }: { family: string | null; size?: number }) {
  return <span className="fdot" style={{ background: FAMILY_COLOR[family ?? "PR"], width: size, height: size }} />;
}

export function TierBadge({ tier, large }: { tier: string | null; large?: boolean }) {
  const t = tier ?? "CLEARED";
  return <span className={`tier ${t}${large ? " lg" : ""}`}>{t === "CLEARED" ? "Cleared" : t}</span>;
}

export function Bar({ value, color = "var(--primary)", height }: { value: number; color?: string; height?: number }) {
  return (
    <div className="bar" style={height ? { height } : undefined}>
      <div style={{ width: `${Math.max(0, Math.min(1, value)) * 100}%`, background: color }} />
    </div>
  );
}

export function Sparkline({ data, color = "#1F4FE0", height = 40 }: { data: number[]; color?: string; height?: number }) {
  if (data.length < 2) return <svg className="spark" height={height} aria-hidden />;
  const W = 240;
  let lo = Infinity, hi = -Infinity;
  for (const v of data) { if (v < lo) lo = v; if (v > hi) hi = v; }
  const span = hi - lo || 1;
  const pts = data.map((v, i) => `${((i / (data.length - 1)) * W).toFixed(1)},${(height - 3 - ((v - lo) / span) * (height - 6)).toFixed(1)}`).join(" ");
  return (
    <svg className="spark" viewBox={`0 0 ${W} ${height}`} preserveAspectRatio="none" height={height} aria-hidden>
      <polygon points={`0,${height} ${pts} ${W},${height}`} fill={color} opacity={0.12} />
      <polyline points={pts} fill="none" stroke={color} strokeWidth={1.8} vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
    </svg>
  );
}

export function Ring({ value, size = 96, stroke = 10, color = "var(--primary)", children }: {
  value: number; size?: number; stroke?: number; color?: string; children?: React.ReactNode;
}) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const v = Math.max(0, Math.min(1, value));
  return (
    <div className="ring" style={{ width: size, height: size }}>
      <svg width={size} height={size} aria-hidden>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--surface-3)" strokeWidth={stroke} />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth={stroke} strokeLinecap="round"
          strokeDasharray={`${c * v} ${c}`} transform={`rotate(-90 ${size / 2} ${size / 2})`} />
      </svg>
      <div className="ring-c">{children}</div>
    </div>
  );
}

export function Loading({ what = "Loading" }: { what?: string }) {
  return <div className="loading" role="status"><span className="spinner" aria-hidden />{what}…</div>;
}

export function Empty({ icon: Icon, title, children }: { icon?: LucideIcon; title?: string; children?: React.ReactNode }) {
  return (
    <div className="empty">
      {Icon && <div className="empty-ic"><Icon /></div>}
      {title && <h4>{title}</h4>}
      {children && <p>{children}</p>}
    </div>
  );
}

const OUTCOME_CLASS: Record<string, string> = { resolved: "b-green", partial: "b-amber", failed: "b-red" };
export function outcomeBadge(o: string) {
  return <span className={`badge ${OUTCOME_CLASS[o] ?? "b-gray"}`}>{cap(o)}</span>;
}

const STATUS: Record<string, [string, string]> = {
  needs_review: ["b-amber", "Needs review"], curated: ["b-green", "Expert-checked"], auto: ["b-blue", "Auto-accepted"], rejected: ["b-red", "Rejected"],
};
export function statusBadge(s: string) {
  const [cls, label] = STATUS[s] ?? ["b-gray", s];
  return <span className={`badge ${cls}`}>{label}</span>;
}

export function familyLabel(f: Family | string | null, names: Record<string, string>) {
  if (!f) return "Good practice";
  return names[f] ?? f;
}

export function PageHeader({ eyebrow, icon: Icon, title, sub, actions }: {
  eyebrow?: string; icon?: LucideIcon; title: string; sub?: React.ReactNode; actions?: React.ReactNode;
}) {
  return (
    <div className="page-h">
      <div>
        {eyebrow && <div className="page-eyebrow">{Icon && <Icon />}{eyebrow}</div>}
        <h1 className="page-title">{title}</h1>
        {sub && <p className="page-sub">{sub}</p>}
      </div>
      {actions && <div className="page-actions">{actions}</div>}
    </div>
  );
}

export function Seg<T extends string>({ value, options, onChange, label }: {
  value: T; options: { id: T; label: React.ReactNode; icon?: LucideIcon; count?: number }[]; onChange: (v: T) => void; label?: string;
}) {
  return (
    <div className="seg" role="group" aria-label={label}>
      {options.map((o) => (
        <button key={o.id} type="button" className={value === o.id ? "on" : ""} aria-pressed={value === o.id} onClick={() => onChange(o.id)}>
          {o.icon && <o.icon />}{o.label}{o.count != null && <span className="seg-count">{o.count}</span>}
        </button>
      ))}
    </div>
  );
}

export function CompartmentTag({ same }: { same: boolean }) {
  return same ? <span className="tag same">Same fault block</span> : <span className="tag across">Across a fault</span>;
}

/** Close overlays with the Escape key. */
export function useEscape(onClose: () => void) {
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [onClose]);
}

/** Formation (rock layer) containing a measured depth. */
export function formationAt<T extends { md_top: number; md_base: number }>(tops: T[] | undefined, md: number): T | null {
  return tops?.find((t) => md >= t.md_top && md < t.md_base) ?? null;
}
