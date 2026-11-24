import { useEffect, useState } from "react";

export interface Route {
  path: string; // "/", "/category/Groceries", ...
  segments: string[];
  params: URLSearchParams;
}

function parse(): Route {
  const h = window.location.hash.replace(/^#/, "") || "/";
  const [p, q = ""] = h.split("?");
  const path = p || "/";
  return { path, segments: path.split("/").filter(Boolean).map(decodeURIComponent), params: new URLSearchParams(q) };
}

export function useRoute(): Route {
  const [r, setR] = useState(parse);
  useEffect(() => {
    const on = () => setR(parse());
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
  }, []);
  return r;
}

/** Build a hash href; params carry over the current filters unless replaced. */
export function href(path: string, params?: URLSearchParams | Record<string, string | undefined>): string {
  const p = params instanceof URLSearchParams ? new URLSearchParams(params) : new URLSearchParams();
  if (params && !(params instanceof URLSearchParams)) for (const [k, v] of Object.entries(params)) if (v) p.set(k, v);
  const q = p.toString();
  return `#${path}${q ? "?" + q : ""}`;
}

export const go = (path: string, params?: URLSearchParams) => {
  window.location.hash = href(path, params).slice(1);
};

export function setParams(route: Route, patch: Record<string, string | null>) {
  const p = new URLSearchParams(route.params);
  for (const [k, v] of Object.entries(patch)) {
    if (v == null || v === "") p.delete(k);
    else p.set(k, v);
  }
  go(route.path, p);
}

export const seg = (s: string) => encodeURIComponent(s);
