// Typed client for the NWIS API.
// Empty base = same origin (dev proxy, or the API serving the built frontend).
// Set VITE_API_URL (e.g. https://ertmac.onrender.com) when the frontend is hosted elsewhere.
export const API_BASE = (import.meta.env.VITE_API_URL ?? "").replace(/\/+$/, "");
export const apiUrl = (path: string) => `${API_BASE}${path}`;
export const wsUrl = (path: string) => {
  const u = new URL(apiUrl(path), location.href);
  u.protocol = u.protocol === "https:" ? "wss:" : "ws:";
  return u.toString();
};

export type Family = "LC" | "SP" | "OP" | "TQ" | "CM";
export const FAMILIES: Family[] = ["LC", "SP", "OP", "TQ", "CM"];

export interface Meta {
  field: string;
  data_mode: string;
  active_well_id: string;
  active_well_name: string;
  active_current_md: number;
  llm_enabled: boolean;
  llm_model: string | null;
  counts: { wells: number; documents: number; events: number; needs_review: number };
  risk_families: Record<string, string>;
  event_types: Record<string, string>;
  formations: { code: string; name: string; order: number; lithology: string }[];
  relevance_components: Record<string, string>;
  relevance_weights: Record<string, number>;
  thresholds: { relevance_include: number; zone: number; lookahead_min_m: number; lookahead_hours: number };
  default_radius_km: number;
}

export interface WellSummary {
  id: string; name: string; lat: number; lon: number; x: number; y: number; compartment: string; spud_year: number;
  traj_type: string; td_md: number; status: string; is_active: boolean; n_events: number; families: Record<string, number>;
  path: [number, number][]; n_documents: number;
}

export interface Top {
  code: string; name: string; md_top: number; md_base: number; tvd_top?: number; tvd_base?: number; tvdss_top: number;
  tvdss_base: number; kind?: string; prognosed_md?: number; td_in_formation?: boolean;
}

export interface EventBrief {
  event_id: string; well_id: string; well: string; type: string; type_label: string; family: Family | null; subtype: string | null;
  md_top: number; md_base: number | null; tvdss: number; formation: string | null; formation_name: string | null; f_pos: number | null;
  severity: number; npt_h: number | null; outcome: string; status: string; confidence: number; event_date: string | null;
  n_sources: number; source: { doc_id: string; page: number; method: string }; summary: string;
}

export interface Provenance { doc_id: string; doc_type: string; page: number; quote: string; start: number; end: number; method: string }
export interface Mitigation { action: string; label: string; quote: string; doc_id: string; page: number }
export interface EventDetail extends EventBrief {
  provenance: Provenance[]; mitigations: Mitigation[]; flags: string[]; formation_reported: string | null;
  formation_source: string | null; loss_rate_m3ph: number | null; mw_sg: number | null; tvd: number; curated_by: string | null;
}

export interface PerFormation {
  score: number; components: Record<string, number> | null; distance_3d_m?: number; reason: string | null;
}
export interface Offset {
  well_id: string; name: string; surface_distance_km: number; compartment: string; same_compartment: boolean; spud_year: number;
  traj_type: string; td_md: number; overall: number; per_formation: Record<string, PerFormation>; focus_formations: string[];
  explanation: string; n_events: number;
}

export interface ProjectedEvent {
  event_id: string; well_id: string; well_name: string; type: string; family: Family; subtype: string | null; formation: string | null;
  offset_md: number; md: number; md_base: number | null; sigma: number; method: string; relevance: number; amplitude: number;
  severity: number; outcome: string; npt_h: number | null; status: string; confidence: number;
}
export interface Zone {
  id: string; family: Family; label: string; md_from: number; md_to: number; peak: number; peak_md: number; formation: string | null;
  formation_name: string | null; events: string[]; wells: string[];
}
export interface RiskTrack {
  well_id: string; md: number[]; curves: Record<Family, number[]>; zones: Zone[]; projected_events: ProjectedEvent[]; tops: Top[];
  casing: { size: string; shoe_md: number; shoe_tvd: number }[]; families: Record<string, string>; zone_threshold: number;
}

export interface AtlasCell {
  posterior: number; ci90: [number, number]; n_eff: number; k_eff: number; n_wells: number; wells_with_event: string[];
  mean_npt_h: number | null; thirds: number[]; event_ids: string[]; likelihood: number; consequence: number;
}
export interface Atlas { scope: string; families: Record<string, string>; rows: { formation: string; name: string; cells: Record<Family, AtlasCell> }[] }

export interface Citation { doc_id: string; page: number; doc_type?: string; well?: string; well_id?: string; report_date?: string; quote?: string }
export interface AskResult {
  question: string; mode: string; evidence_status: "sufficient" | "insufficient"; answer: string;
  bullets: { text: string; citations: Citation[] }[]; table: any[]; citations: Citation[]; parsed: any; closest?: any[];
}

export interface Alert {
  id: string; key: string; family: Family; label: string; tier: "ADVISORY" | "CAUTION" | "WARNING" | null; state: string;
  md_from: number | null; md_to: number | null; zone: Zone | null; live_only: boolean; bit_md: number; ahead_m: number;
  eta_h: number | null; p_prior: number; p_live: number | null; p_final: number; rule_reasons: string[];
  model_reasons: { feature: string; label: string; contribution: number; value: number }[]; lookahead_m: number; message: string;
  history: { t: number; bit_md: number; tier: string | null }[]; acknowledged: { by: string; reason: string } | null;
  realigned?: { from: number[]; to: number[] };
}

export interface Recommendation {
  family: string; family_label: string; formation: string | null; formation_name: string | null; cases_considered: number;
  actions: RecAction[]; not_effective: RecAction[]; practices: any[]; disclaimer: string;
}
export interface RecAction {
  action: string; label: string; score: number; n_cases: number; success_rate: number; median_npt_h: number | null; statement: string;
  outcomes: Record<string, number>;
  cases: { event_id: string; well: string; md: number; formation: string; outcome: string; npt_h: number | null; similarity: number; quote: string; doc_id: string; page: number }[];
}

async function j<T>(url: string, init?: RequestInit): Promise<T> {
  const r = await fetch(apiUrl(url), init);
  if (!r.ok) throw new Error(`${r.status} ${await r.text()}`);
  return r.json() as Promise<T>;
}

export const api = {
  meta: () => j<Meta>("/api/meta"),
  wells: () => j<WellSummary[]>("/api/wells"),
  well: (id: string) => j<any>(`/api/wells/${id}`),
  offsets: (id: string, r: number) => j<Offset[]>(`/api/wells/${id}/offsets?radius_km=${r}`),
  track: (id: string, r: number) => j<RiskTrack>(`/api/wells/${id}/risk-track?radius_km=${r}`),
  atlas: (r: number, scope = "offsets") => j<Atlas>(`/api/formations/risk?radius_km=${r}&scope=${scope}`),
  correlation: (ids: string[]) => j<any[]>(`/api/correlation?wells=${ids.join(",")}`),
  events: (q: Record<string, string> = {}) => j<EventBrief[]>(`/api/events?${new URLSearchParams(q)}`),
  event: (id: string) => j<EventDetail>(`/api/events/${id}`),
  review: (id: string, body: any) => j<any>(`/api/events/${id}/review`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
  documents: (well?: string) => j<any[]>(`/api/documents${well ? `?well=${well}` : ""}`),
  page: (doc: string, n: number, hl?: string) => j<any>(`/api/documents/${doc}/pages/${n}${hl ? `?highlight=${encodeURIComponent(hl)}` : ""}`),
  ask: (question: string, radius_km?: number) => j<AskResult>("/api/ask", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ question, radius_km }) }),
  recommend: (family: string, formation: string | null, r: number, md?: number) =>
    j<Recommendation>(`/api/recommendations?family=${family}${formation ? `&formation=${formation}` : ""}&radius_km=${r}${md ? `&md=${md}` : ""}`),
  evaluation: () => j<any>("/api/evaluation"),
  audit: () => j<any[]>("/api/audit"),
  feedback: (body: any) => j<any>("/api/feedback", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
};
