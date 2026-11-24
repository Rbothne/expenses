import { useMemo } from "react";
import { accountKey, applyFilters, type Bucket, type EnrichedTxn, type Filters as F } from "../core/aggregate";
import { RANGE_PRESETS, rangeFor, type RangePreset } from "../core/range";
import { useApp } from "../state";
import { accountLabel } from "./format";
import { setParams, type Route } from "./router";

export interface ViewFilters extends F {
  from: string;
  to: string;
  preset: RangePreset;
  bucket: Bucket;
  rolling: number;
}

const list = (s: string | null) => (s ? s.split(",").filter(Boolean) : []);

export function useFilters(route: Route, defaultPreset: RangePreset = "24m"): ViewFilters {
  const { earliest, latest } = useApp();
  const p = route.params;
  const preset = (p.get("range") as RangePreset) || defaultPreset;
  const { from, to } = rangeFor(preset, latest, earliest, { from: p.get("from") ?? undefined, to: p.get("to") ?? undefined });
  return {
    preset,
    from,
    to,
    accounts: list(p.get("acc")),
    categories: list(p.get("cat")),
    bucket: (p.get("bucket") as Bucket) || "month",
    rolling: Number(p.get("roll") || 0),
  };
}

/** Spend rows for the current filters (optionally ignoring the category filter, for category pages). */
export function useFiltered(f: ViewFilters, opts: { ignoreCategories?: boolean } = {}): EnrichedTxn[] {
  const { enriched, groupBy } = useApp();
  return useMemo(
    () => applyFilters(enriched, opts.ignoreCategories ? { ...f, categories: [] } : f, groupBy),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [enriched, groupBy, f.from, f.to, f.accounts.join(), f.categories.join(), opts.ignoreCategories],
  );
}

function MultiSelect({ label, options, value, onChange }: { label: string; options: { id: string; label: string }[]; value: string[]; onChange: (v: string[]) => void }) {
  const summary = value.length === 0 ? "All" : value.length === 1 ? (options.find((o) => o.id === value[0])?.label ?? value[0]) : `${value.length} selected`;
  return (
    <details className="ms">
      <summary>
        <span className="ms-label">{label}</span> <strong>{summary}</strong>
      </summary>
      <div className="ms-pop">
        <button type="button" className="link" onClick={() => onChange([])}>
          All
        </button>
        {options.map((o) => (
          <label key={o.id} className="ms-opt">
            <input type="checkbox" checked={value.includes(o.id)} onChange={(e) => onChange(e.target.checked ? [...value, o.id] : value.filter((x) => x !== o.id))} />
            {o.label}
          </label>
        ))}
      </div>
    </details>
  );
}

export function FilterBar({ route, f, showCategories = true, showBucket = false, children }: { route: Route; f: ViewFilters; showCategories?: boolean; showBucket?: boolean; children?: React.ReactNode }) {
  const { enriched, groupBy, snapshot } = useApp();
  const accounts = useMemo(() => {
    const s = new Set<string>();
    for (const t of enriched) if (t.isSpend) s.add(accountKey(t, groupBy));
    return [...s].sort().map((id) => ({ id, label: accountLabel(id, snapshot.rules) }));
  }, [enriched, groupBy, snapshot.rules]);
  const cats = snapshot.rules.categories.map((c) => ({ id: c, label: c }));

  return (
    <div className="filters" role="group" aria-label="Filters">
      <label className="field">
        <span>Period</span>
        <select value={f.preset} onChange={(e) => setParams(route, { range: e.target.value, ...(e.target.value === "custom" ? { from: f.from, to: f.to } : { from: null, to: null }) })}>
          {RANGE_PRESETS.map((r) => (
            <option key={r.id} value={r.id}>
              {r.label}
            </option>
          ))}
        </select>
      </label>
      {f.preset === "custom" && (
        <>
          <label className="field">
            <span>From</span>
            <input type="date" value={f.from} onChange={(e) => setParams(route, { from: e.target.value })} />
          </label>
          <label className="field">
            <span>To</span>
            <input type="date" value={f.to} onChange={(e) => setParams(route, { to: e.target.value })} />
          </label>
        </>
      )}
      <MultiSelect label={groupBy === "card" ? "Cards" : "Accounts"} options={accounts} value={f.accounts} onChange={(v) => setParams(route, { acc: v.join(",") })} />
      {showCategories && <MultiSelect label="Categories" options={cats} value={f.categories} onChange={(v) => setParams(route, { cat: v.join(",") })} />}
      {showBucket && (
        <>
          <label className="field">
            <span>Group by</span>
            <select value={f.bucket} onChange={(e) => setParams(route, { bucket: e.target.value === "month" ? null : e.target.value })}>
              <option value="week">Week</option>
              <option value="month">Month</option>
              <option value="quarter">Quarter</option>
            </select>
          </label>
          <label className="field check">
            <input type="checkbox" checked={f.rolling > 1} onChange={(e) => setParams(route, { roll: e.target.checked ? "3" : null })} />
            <span>3-period average</span>
          </label>
        </>
      )}
      {children}
    </div>
  );
}
