// Text-size control (A− / A / A+), as on government portals. All UI type is in rem, so the root size scales it.
export const TEXT_SIZES = [
  { id: "sm", label: "A−", pct: 90, name: "Smaller text" },
  { id: "md", label: "A", pct: 100, name: "Default text size" },
  { id: "lg", label: "A+", pct: 112.5, name: "Larger text" },
] as const;
export type TextSize = (typeof TEXT_SIZES)[number]["id"];

const KEY = "nwis.textSize";

export function getTextSize(): TextSize {
  try {
    const v = localStorage.getItem(KEY);
    if (v === "sm" || v === "md" || v === "lg") return v;
  } catch { /* storage unavailable */ }
  return "md";
}

export function applyTextSize(id: TextSize) {
  const s = TEXT_SIZES.find((x) => x.id === id) ?? TEXT_SIZES[1];
  document.documentElement.style.fontSize = `${s.pct}%`;
  try { localStorage.setItem(KEY, id); } catch { /* storage unavailable */ }
}
