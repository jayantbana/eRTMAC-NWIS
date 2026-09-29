import React, { createContext, useContext, useState } from "react";
import type { Meta } from "./api";

export type EvidenceTarget =
  | { kind: "event"; eventId: string }
  | { kind: "page"; docId: string; page: number; quote?: string };

interface Ctx {
  meta: Meta;
  radius: number;
  setRadius: (r: number) => void;
  evidence: EvidenceTarget | null;
  openEvidence: (t: EvidenceTarget) => void;
  closeEvidence: () => void;
  wellDrawer: string | null;
  openWell: (id: string | null) => void;
  dataVersion: number;
  bumpData: () => void;
}

const C = createContext<Ctx | null>(null);

export function AppState({ meta, children }: { meta: Meta; children: React.ReactNode }) {
  const [radius, setRadius] = useState(meta.default_radius_km);
  const [evidence, setEvidence] = useState<EvidenceTarget | null>(null);
  const [wellDrawer, openWell] = useState<string | null>(null);
  const [dataVersion, setDV] = useState(0);
  return (
    <C.Provider
      value={{
        meta, radius, setRadius, evidence, openEvidence: setEvidence, closeEvidence: () => setEvidence(null), wellDrawer, openWell,
        dataVersion, bumpData: () => setDV((v) => v + 1),
      }}
    >
      {children}
    </C.Provider>
  );
}

export function useApp(): Ctx {
  const v = useContext(C);
  if (!v) throw new Error("AppState missing");
  return v;
}
