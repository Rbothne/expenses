export type RangePreset = "12m" | "24m" | "ytd" | "all" | "custom";

export const RANGE_PRESETS: { id: RangePreset; label: string }[] = [
  { id: "12m", label: "Last 12 months" },
  { id: "24m", label: "Last 24 months" },
  { id: "ytd", label: "Year to date" },
  { id: "all", label: "All time" },
  { id: "custom", label: "Custom" },
];

const monthEnd = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10); // m is 1-based
const monthStart = (y: number, m: number) => {
  while (m < 1) {
    m += 12;
    y--;
  }
  return `${y}-${String(m).padStart(2, "0")}-01`;
};

/** Whole-month windows ending on the anchor's month (anchor = latest transaction date, so stale data still fills the view). */
export function rangeFor(preset: RangePreset, anchor: string, earliest: string, custom?: { from?: string; to?: string }): { from: string; to: string } {
  const y = +anchor.slice(0, 4);
  const m = +anchor.slice(5, 7);
  const to = monthEnd(y, m);
  switch (preset) {
    case "12m":
      return { from: monthStart(y, m - 11), to };
    case "24m":
      return { from: monthStart(y, m - 23), to };
    case "ytd":
      return { from: `${y}-01-01`, to };
    case "all":
      return { from: earliest.slice(0, 8) + "01", to };
    case "custom":
      return { from: custom?.from || earliest, to: custom?.to || to };
  }
}

/**
 * The last n complete months of data, for monthly averages. The newest month counts only when the data reaches its
 * last few days; the oldest only when the data starts in its first few days. Otherwise a half-imported month would
 * be averaged as a whole one.
 */
export function fullMonths(latest: string, earliest: string, n: number): { from: string; to: string } {
  let y = +latest.slice(0, 4);
  let m = +latest.slice(5, 7);
  if (+latest.slice(8) < +monthEnd(y, m).slice(8) - 2) m--;
  if (m < 1) {
    m = 12;
    y--;
  }
  const to = monthEnd(y, m);
  let from = monthStart(y, m - (n - 1));
  if (earliest > from) {
    const ey = +earliest.slice(0, 4),
      em = +earliest.slice(5, 7);
    const startMonth = +earliest.slice(8) <= 3 ? monthStart(ey, em) : monthStart(em === 12 ? ey + 1 : ey, em === 12 ? 1 : em + 1);
    if (startMonth > from) from = startMonth;
  }
  return { from, to };
}
