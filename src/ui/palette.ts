import type { Series } from "../core/aggregate";

export const OTHER_LABEL = "Everything else";
export const MAX_SERIES = 8;

/**
 * Fold a series set to at most 8 lines with colors pinned to entities.
 * `stableOrder` is the all-time ranking of entities, so filtering never repaints a surviving line.
 * Returns series with a palette slot index (or -1 for the folded remainder).
 */
export function foldSeries(s: Series, stableOrder: string[]): { name: string; values: number[]; total: number; slot: number }[] {
  const rank = (n: string) => {
    const i = stableOrder.indexOf(n);
    return i < 0 ? Number.MAX_SAFE_INTEGER : i;
  };
  const visible = [...s.series].sort((a, z) => rank(a.name) - rank(z.name));
  if (visible.length <= MAX_SERIES) {
    // When everything fits, keep all-time slots if they fit, else order among the visible set.
    const fits = visible.every((x) => rank(x.name) < MAX_SERIES);
    return visible.map((x, i) => ({ ...x, slot: fits ? rank(x.name) : i }));
  }
  const keep = visible.slice(0, MAX_SERIES - 1);
  const rest = visible.slice(MAX_SERIES - 1);
  const values = s.buckets.map((_, i) => Math.round(rest.reduce((a, x) => a + x.values[i], 0) * 100) / 100);
  const fits = keep.every((x) => rank(x.name) < MAX_SERIES - 1);
  return [
    ...keep.map((x, i) => ({ ...x, slot: fits ? rank(x.name) : i })),
    { name: OTHER_LABEL, values, total: rest.reduce((a, x) => a + x.total, 0), slot: -1 },
  ];
}
