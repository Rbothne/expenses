import data from "../data/benchmarks.json";
import { bucketRange, type EnrichedTxn } from "./aggregate";
import { cents } from "./money";
import type { Profile } from "./types";

/**
 * Benchmarks from public sources (BLS Consumer Expenditure Survey, CPI-U, OECD, HUD/CFPB/FDIC/Fidelity guidelines).
 * Static data bundled with the app; nothing about the user is sent anywhere. Reasoning: docs/benchmarks-notes.md.
 */

export interface Group {
  id: string;
  label: string;
  kind: string;
  persons: number;
  incomeBeforeTax: number;
  period?: string;
  twoYearAverage?: boolean;
  source?: string;
  values: Record<string, number>;
}

const GROUPS = data.ce.groups as unknown as Group[];
const LINES = data.ce.lines as Record<string, string>;
const MAPPING = data.mapping as Record<string, { lines: string[]; comparable: boolean; note: string }>;
const CPI = data.cpi.annual as Record<string, number>;

export const CE_YEAR = data.ce.year;
export const CE_RELEASE = data.ce.release;
export const CPI_LATEST = data.cpi.latestMonth;
export const NEEDS_CATEGORIES = data.needsCategories;

export const getGroup = (id: string) => GROUPS.find((g) => g.id === id);
export const lineLabel = (id: string) => LINES[id] ?? id;

const KIND_LABEL: Record<string, string> = { all: "", size: "Household size", region: "Region", msa: "Metro area", state: "State" };

/** Choosable comparison groups (tenure groups are used internally for housing). */
export function groupOptions(): { id: string; label: string }[] {
  return GROUPS.filter((g) => g.kind !== "tenure").map((g) => {
    const k = KIND_LABEL[g.kind];
    const old = g.period ? ` (${g.period}, ${g.kind === "state" ? "research estimate" : "smaller sample"})` : "";
    return { id: g.id, label: (k ? `${k}: ` : "") + g.label + old };
  });
}

export function defaultGroupId(p: Profile): string {
  if (p.benchmarkGroup && getGroup(p.benchmarkGroup)) return p.benchmarkGroup;
  const n = p.householdSize;
  if (!n || n < 1) return "all";
  return n >= 5 ? "size-5plus" : `size-${Math.round(n)}`;
}

const baseCpi = (period: string) => {
  const ys = period.split("-").map((y) => CPI[y]);
  return ys.reduce((a, c) => a + c, 0) / ys.length;
};

/**
 * Multiplier taking a survey figure (base period "2025" or "2023-2024") into the dollars of the spending window:
 * the month-weighted CPI of the window over the base. Years without an annual average use the latest month.
 */
export function cpiFactor(r: { from: string; to: string }, basePeriod: string): number {
  const months = bucketRange(r.from, r.to, "month");
  const v = months.reduce((a, m) => a + (CPI[m.slice(0, 4)] ?? data.cpi.latestMonth.value), 0) / months.length;
  return v / baseCpi(basePeriod);
}

export interface Guideline {
  id: string;
  label: string;
  rule: string;
  source: string;
  url: string;
  quote: string;
  /** percent guidelines as fractions (0.3); emergency fund in months */
  lo: number;
  hi: number;
  basis: string;
}

export function guideline(id: string): Guideline | undefined {
  const g = data.guidelines.find((x) => x.id === id);
  if (!g) return undefined;
  const [lo, hi] = Array.isArray(g.threshold) ? g.threshold : [g.threshold, g.threshold];
  const scale = g.basis === "gross" || g.basis === "takehome" ? 0.01 : 1;
  return { id: g.id, label: g.label, rule: g.rule, source: g.source, url: g.url, quote: g.quote, lo: lo * scale, hi: hi * scale, basis: g.basis };
}

export type Tenure = "rent" | "own-mortgage" | "own-outright";

export interface BenchRow {
  category: string;
  /** his spending per year in the window's dollars */
  you: number;
  /** the group's figure in the same dollars; null when not comparable or not published */
  them: number | null;
  delta: number | null;
  pct: number | null;
  comparable: boolean;
  /** comparable in principle, but this group's table doesn't publish the line */
  missing: boolean;
  note: string;
  groupNote?: string;
  context: { label: string; value: number }[];
}

const HOUSING: Record<Tenure, { group: string; lines: string[]; note: string }> = {
  rent: { group: "tenure-renter", lines: ["rentedDwellings"], note: "Compared with US renters (BLS doesn't publish renters by area), since the all-households average counts owners as $0 rent." },
  "own-mortgage": { group: "tenure-owner-mortgage", lines: ["mortgageInterest", "propertyTaxes"], note: "US homeowners with a mortgage: interest and property taxes only. The survey doesn't count principal, so a full mortgage payment reads high." },
  "own-outright": { group: "tenure-owner-nomortgage", lines: ["propertyTaxes", "ownedMaintInsurance"], note: "US homeowners without a mortgage: property taxes, maintenance and insurance." },
};

const basePeriodOf = (g: Group) => g.period ?? String(CE_YEAR);

/** His yearly spending per category against a survey group, inflation-adjusted to his window. */
export function compareToGroup(spend: EnrichedTxn[], r: { from: string; to: string }, groupId: string, tenure: Tenure) {
  const group = getGroup(groupId) ?? getGroup("all")!;
  const months = bucketRange(r.from, r.to, "month").length;
  const perYear = 12 / months;
  const byCat = new Map<string, number>();
  for (const t of spend) if (t.date >= r.from && t.date <= r.to) byCat.set(t.category, (byCat.get(t.category) ?? 0) + t.amount);

  const rows: BenchRow[] = Object.entries(MAPPING).map(([category, m]) => {
    const you = cents((byCat.get(category) ?? 0) * perYear);
    let g = group,
      lines = m.lines,
      groupNote: string | undefined;
    if (category === "Housing") {
      const h = HOUSING[tenure];
      g = getGroup(h.group)!;
      lines = h.lines;
      groupNote = h.note;
    }
    const f = cpiFactor(r, basePeriodOf(g));
    const context = lines.filter((l) => g.values[l] != null).map((l) => ({ label: lineLabel(l), value: cents(g.values[l] * f) }));
    const missing = m.comparable && lines.some((l) => g.values[l] == null);
    const them = m.comparable && !missing ? cents(lines.reduce((a, l) => a + g.values[l], 0) * f) : null;
    return {
      category,
      you,
      them,
      delta: them == null ? null : cents(you - them),
      pct: them ? you / them - 1 : null,
      comparable: m.comparable,
      missing,
      note: m.note,
      groupNote,
      context,
    };
  });
  return { group, rows, annualized: months !== 12, months, factor: cpiFactor(r, basePeriodOf(group)) };
}

/** OECD COICOP groups mapped to app categories, for share-of-spending fun facts only. */
export const COUNTRY_GROUPS: { group: string; label: string; categories: string[] }[] = [
  { group: "CP01", label: "Food at home", categories: ["Groceries"] },
  { group: "CP11", label: "Restaurants & hotels", categories: ["Dining"] },
  { group: "CP04", label: "Housing & utilities", categories: ["Housing", "Utilities & Bills"] },
  { group: "CP07", label: "Transport", categories: ["Gas & Auto"] },
  { group: "CP09", label: "Recreation & culture", categories: ["Entertainment", "Subscriptions & Digital"] },
  { group: "CP06", label: "Health", categories: ["Health"] },
];

export const COUNTRIES = (data.countries?.rows ?? []) as { iso3: string; name: string; sharePct: Record<string, number> }[];
export const COUNTRY_META = { year: data.countries?.year, source: data.countries?.source, caveats: (data.countries?.caveats ?? []) as string[] };

export function countryShares(spend: EnrichedTxn[], iso3: string) {
  const c = COUNTRIES.find((x) => x.iso3 === iso3);
  const total = spend.reduce((a, t) => a + t.amount, 0);
  return COUNTRY_GROUPS.map((g) => {
    const mine = spend.filter((t) => g.categories.includes(t.category)).reduce((a, t) => a + t.amount, 0);
    return { group: g.group, label: g.label, you: total > 0 ? mine / total : 0, them: c ? (c.sharePct[g.group] ?? 0) / 100 : 0 };
  });
}
