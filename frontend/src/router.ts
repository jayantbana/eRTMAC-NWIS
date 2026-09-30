// Hash routing: the API serves the built UI as static files, so deep paths must live in the hash.
//   #/                          landing page
//   #/workspace/<module>?...    workspace module (query carries e.g. autostart=2740&speed=300)
import { useEffect, useState } from "react";

export const MODULES = ["live", "wells", "compare", "atlas", "ask", "knowledge"] as const;
export type ModuleId = (typeof MODULES)[number];

export type Route =
  | { page: "landing" }
  | { page: "workspace"; module: ModuleId; query: URLSearchParams };

export function parseHash(hash: string): Route {
  const [path, qs] = hash.replace(/^#/, "").split("?");
  const parts = path.split("/").filter(Boolean);
  if (parts[0] !== "workspace") return { page: "landing" };
  const module = (MODULES as readonly string[]).includes(parts[1]) ? (parts[1] as ModuleId) : "live";
  return { page: "workspace", module, query: new URLSearchParams(qs ?? "") };
}

export const moduleHref = (m: ModuleId, query?: string) => `#/workspace/${m}${query ? `?${query}` : ""}`;

export function navigate(hash: string) {
  if (location.hash !== hash) location.hash = hash;
}

function initialRoute(): Route {
  // Keep the documented demo link working: /?autostart=2740&speed=300 opens the live workspace.
  const q = new URLSearchParams(location.search);
  if (q.get("autostart") && !location.hash.startsWith("#/workspace")) {
    history.replaceState(null, "", `${location.pathname}${moduleHref("live", q.toString())}`);
  }
  return parseHash(location.hash);
}

export function useRoute(): Route {
  const [route, setRoute] = useState<Route>(initialRoute);
  useEffect(() => {
    const on = () => setRoute(parseHash(location.hash));
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
  }, []);
  return route;
}

/** Smooth-scroll to an in-page section without touching the hash (the hash holds the route). */
export function scrollToId(id: string) {
  document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
}
