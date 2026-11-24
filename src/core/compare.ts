import type { EnrichedTxn } from "./aggregate";
import { cents } from "./money";

export type CompareMode = "yoy" | "prev";
export interface Range {
  from: string;
  to: string;
}

const utc = (iso: string) => new Date(iso + "T00:00:00Z");
const iso = (d: Date) => d.toISOString().slice(0, 10);
const lastDay = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate(); // m 1-based
const isMonthStart = (d: string) => d.endsWith("-01");
const isMonthEnd = (d: string) => +d.slice(8) === lastDay(+d.slice(0, 4), +d.slice(5, 7));

/** Shift a date by whole months, clamping the day (Mar 31 - 1 month = Feb 28/29). */
function addMonths(d: string, k: number, toEnd = false): string {
  let y = +d.slice(0, 4);
  let m = +d.slice(5, 7) + k;
  while (m < 1) {
    m += 12;
    y--;
  }
  while (m > 12) {
    m -= 12;
    y++;
  }
  const day = toEnd ? lastDay(y, m) : Math.min(+d.slice(8), lastDay(y, m));
  return `${y}-${String(m).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/**
 * The window to compare against. "yoy": the same dates a year earlier. "prev": the stretch just before,
 * in whole months when the window is whole months (so a 28-day February compares to all of January).
 */
export function comparisonRange(r: Range, mode: CompareMode): Range {
  const wholeMonths = isMonthStart(r.from) && isMonthEnd(r.to);
  if (mode === "yoy") return { from: addMonths(r.from, -12), to: addMonths(r.to, -12, wholeMonths) };
  if (wholeMonths) {
    const months = (+r.to.slice(0, 4) - +r.from.slice(0, 4)) * 12 + (+r.to.slice(5, 7) - +r.from.slice(5, 7)) + 1;
    return { from: addMonths(r.from, -months), to: addMonths(r.to, -months, true) };
  }
  const days = Math.round((utc(r.to).getTime() - utc(r.from).getTime()) / 86400000) + 1;
  const to = utc(r.from);
  to.setUTCDate(to.getUTCDate() - 1);
  const from = new Date(to);
  from.setUTCDate(from.getUTCDate() - (days - 1));
  return { from: iso(from), to: iso(to) };
}

export interface Delta {
  key: string;
  cur: number;
  prev: number;
  delta: number;
  /** null when the earlier amount is too small for a percentage to mean anything */
  pct: number | null;
}

/** Below this, "+900%" is noise; show the dollar change only. */
export const MIN_PCT_BASE = 25;

export function deltas(cur: EnrichedTxn[], prev: EnrichedTxn[], keyOf: (t: EnrichedTxn) => string): Delta[] {
  const m = new Map<string, { cur: number; prev: number }>();
  for (const t of cur) {
    const v = m.get(keyOf(t)) ?? { cur: 0, prev: 0 };
    v.cur += t.amount;
    m.set(keyOf(t), v);
  }
  for (const t of prev) {
    const v = m.get(keyOf(t)) ?? { cur: 0, prev: 0 };
    v.prev += t.amount;
    m.set(keyOf(t), v);
  }
  return [...m.entries()]
    .map(([key, v]) => {
      const c = cents(v.cur),
        p = cents(v.prev);
      return { key, cur: c, prev: p, delta: cents(c - p), pct: p >= MIN_PCT_BASE && c >= 0 ? c / p - 1 : null };
    })
    .sort((a, z) => Math.abs(z.delta) - Math.abs(a.delta));
}

export interface Gap {
  account: string;
  first: string;
  last: string;
  /** months (yyyy-mm) with nothing imported inside an otherwise regular history */
  holes: string[];
}

/** History may start or end this many days inside the range before it counts as missing (quiet weeks are normal). */
const EDGE_GRACE_DAYS = 14;

const monthsBetween = (from: string, to: string) => {
  const out: string[] = [];
  let y = +from.slice(0, 4),
    m = +from.slice(5, 7);
  const end = to.slice(0, 7);
  for (let k = `${y}-${String(m).padStart(2, "0")}`; k <= end; k = `${y}-${String(m).padStart(2, "0")}`) {
    out.push(k);
    if (++m > 12) {
      m = 1;
      y++;
    }
  }
  return out;
};

/** Clamp a window to the newest data, so a half-imported current month compares against the same dates a year ago. */
export const clampToData = (r: Range, latest: string): Range => ({ from: r.from, to: r.to > latest ? latest : r.to });

/**
 * Bank accounts whose imported history doesn't cover the range: starting or ending more than two weeks inside it,
 * or a run of 2+ empty months in an account that otherwise has activity in at least 80% of its months (a card used
 * now and then has quiet months; a card missing an export has a hole). Judged per bank account, not per card, so a
 * replacement card isn't a gap. Pass all rows, not just spending: payments are evidence the account was imported.
 */
export function coverageGaps(all: EnrichedTxn[], r: Range): Gap[] {
  const acc = new Map<string, { first: string; last: string; months: Set<string> }>();
  for (const t of all) {
    const a = acc.get(t.account) ?? { first: t.date, last: t.date, months: new Set<string>() };
    if (t.date < a.first) a.first = t.date;
    if (t.date > a.last) a.last = t.date;
    a.months.add(t.date.slice(0, 7));
    acc.set(t.account, a);
  }
  const day = (a: string, b: string) => (utc(b).getTime() - utc(a).getTime()) / 86400000;
  const out: Gap[] = [];
  for (const [account, a] of acc) {
    const edges = day(r.from, a.first) > EDGE_GRACE_DAYS || day(a.last, r.to) > EDGE_GRACE_DAYS;
    const span = monthsBetween(a.first > r.from ? a.first : r.from, a.last < r.to ? a.last : r.to);
    const holes: string[] = [];
    for (let i = 0; i < span.length; ) {
      if (a.months.has(span[i])) {
        i++;
        continue;
      }
      let j = i;
      while (j < span.length && !a.months.has(span[j])) j++;
      const run = span.slice(i, j);
      const outside = span.length - run.length;
      const active = span.filter((m) => a.months.has(m)).length;
      if (run.length >= 2 && outside > 0 && active / outside >= 0.8) holes.push(...run);
      i = j;
    }
    if (edges || holes.length) out.push({ account, first: a.first, last: a.last, holes });
  }
  return out.sort((x, z) => x.account.localeCompare(z.account));
}

const median = (xs: number[]) => {
  const s = [...xs].sort((a, z) => a - z);
  const k = s.length >> 1;
  return s.length % 2 ? s[k] : (s[k - 1] + s[k]) / 2;
};

export interface PriceChange {
  merchant: string;
  before: number;
  after: number;
  pct: number;
}

/**
 * Recurring charges whose usual amount moved (a subscription price hike). Only merchants that bill a near-constant
 * amount qualify — most charges within 5% of the median in both periods — so variable shopping doesn't show up.
 */
export function priceChanges(cur: EnrichedTxn[], prev: EnrichedTxn[]): PriceChange[] {
  const charges = (rows: EnrichedTxn[]) => {
    const m = new Map<string, number[]>();
    for (const t of rows) if (t.kind === "purchase" && t.amount > 0) m.set(t.merchant, [...(m.get(t.merchant) ?? []), t.amount]);
    return m;
  };
  const steady = (xs: number[]) => {
    if (xs.length < 2) return null;
    const md = median(xs);
    const near = xs.filter((x) => Math.abs(x - md) <= md * 0.05).length;
    return near / xs.length >= 0.75 ? md : null;
  };
  // Files list newest-first or oldest-first; "latest charges" must mean by date.
  const byDate = (rows: EnrichedTxn[]) => [...rows].sort((x, z) => (x.date < z.date ? -1 : x.date > z.date ? 1 : 0));
  const a = charges(byDate(prev)),
    b = charges(byDate(cur));
  const out: PriceChange[] = [];
  for (const [merchant, xs] of b) {
    const before = a.get(merchant) ? steady(a.get(merchant)!) : null;
    // Use the latest charges for "after": a mid-period hike should show the new price.
    const after = steady(xs.slice(-3));
    if (before == null || after == null) continue;
    const diff = after - before;
    if (Math.abs(diff) < 0.5 || Math.abs(diff) / before < 0.03) continue;
    out.push({ merchant, before: cents(before), after: cents(after), pct: after / before - 1 });
  }
  return out.sort((x, z) => Math.abs(z.after - z.before) - Math.abs(x.after - x.before));
}

export type Insight =
  | { type: "total"; key: "total"; cur: number; prev: number; delta: number; pct: number | null }
  | { type: "category"; key: string; cur: number; prev: number; delta: number; pct: number | null; driver?: { key: string; delta: number } }
  | { type: "merchant"; key: string; cur: number; prev: number; delta: number; pct: number | null }
  | { type: "new"; key: string; cur: number }
  | { type: "gone"; key: string; prev: number; months: number }
  | { type: "price"; key: string; before: number; after: number; pct: number };

/** A change matters when it's at least $50 and at least 2% of the earlier period's spending... */
export function materiality(prevTotal: number) {
  return Math.max(50, prevTotal * 0.02);
}

/** ...or when it's at least $100 and at least 25% — so rent inflating the total can't hide dining going up by half. */
export const SHARP = { dollars: 100, pct: 0.25 };
const matters = (d: Delta, floor: number) => Math.abs(d.delta) >= floor || (Math.abs(d.delta) >= SHARP.dollars && d.pct != null && Math.abs(d.pct) >= SHARP.pct);

/** Plain-language movers between two periods, most significant first within each type. */
export function insights(cur: EnrichedTxn[], prev: EnrichedTxn[], opts: { limit?: number } = {}): Insight[] {
  const limit = opts.limit ?? 6;
  const curTotal = cents(cur.reduce((a, t) => a + t.amount, 0));
  const prevTotal = cents(prev.reduce((a, t) => a + t.amount, 0));
  const floor = materiality(prevTotal);
  const out: Insight[] = [
    { type: "total", key: "total", cur: curTotal, prev: prevTotal, delta: cents(curTotal - prevTotal), pct: prevTotal >= MIN_PCT_BASE ? curTotal / prevTotal - 1 : null },
  ];

  const drivers = new Set<string>();
  for (const c of deltas(cur, prev, (t) => t.category)) {
    if (!matters(c, floor)) continue;
    const inCat = deltas(
      cur.filter((t) => t.category === c.key),
      prev.filter((t) => t.category === c.key),
      (t) => t.merchant,
    ).find((m) => Math.sign(m.delta) === Math.sign(c.delta));
    // Name a driver only when one merchant explains a real part of the move.
    const driver = inCat && Math.abs(inCat.delta) >= Math.abs(c.delta) * 0.3 ? { key: inCat.key, delta: inCat.delta } : undefined;
    if (driver) drivers.add(driver.key);
    out.push({ type: "category", ...c, driver });
    if (out.filter((i) => i.type === "category").length >= limit) break;
  }

  // A stopped *recurring* charge: 3+ months, charged in at least 60% of the months between its first and last
  // charge. Three scattered coffees aren't a cancelled subscription.
  const prevMonths = new Map<string, Set<string>>();
  for (const t of prev) if (t.amount > 0) prevMonths.set(t.merchant, (prevMonths.get(t.merchant) ?? new Set()).add(t.date.slice(0, 7)));
  const regular = (k: string) => {
    const ms = [...(prevMonths.get(k) ?? [])].sort();
    return ms.length >= 3 && ms.length / monthsBetween(ms[0] + "-01", ms[ms.length - 1] + "-01").length >= 0.6;
  };

  const merchants = deltas(cur, prev, (t) => t.merchant);
  const newOnes: Insight[] = [];
  const gone: Insight[] = [];
  const movers: Insight[] = [];
  for (const m of merchants) {
    if (m.prev === 0 && m.cur >= floor) newOnes.push({ type: "new", key: m.key, cur: m.cur });
    else if (m.cur <= 0 && m.prev > 0 && regular(m.key)) gone.push({ type: "gone", key: m.key, prev: m.prev, months: prevMonths.get(m.key)!.size });
    else if (m.prev > 0 && m.cur > 0 && matters(m, floor) && !drivers.has(m.key)) movers.push({ type: "merchant", ...m });
  }
  out.push(...movers.slice(0, limit), ...newOnes.slice(0, limit), ...gone.sort((a, z) => (z as { prev: number }).prev - (a as { prev: number }).prev).slice(0, limit));
  for (const p of priceChanges(cur, prev).slice(0, limit)) out.push({ type: "price", key: p.merchant, before: p.before, after: p.after, pct: p.pct });
  return out;
}

export interface YearCol {
  year: number;
  partial: boolean;
  from: string;
  to: string;
}
export interface YearRow {
  key: string;
  values: number[];
  /** latest year to date, and the same stretch of the prior year */
  ytdCur: number;
  ytdPrev: number;
  ytdPct: number | null;
}

/**
 * Calendar-year totals per category. A year is partial when the data starts after mid-January or ends before
 * mid-December; the honest comparison for the latest year is year-to-date against the same dates a year earlier.
 */
export function yearly(spend: EnrichedTxn[], earliest: string, latest: string, keyOf: (t: EnrichedTxn) => string = (t) => t.category) {
  const y0 = +earliest.slice(0, 4),
    y1 = +latest.slice(0, 4);
  const years: YearCol[] = [];
  for (let y = y0; y <= y1; y++) {
    const from = y === y0 ? earliest : `${y}-01-01`;
    const to = y === y1 ? latest : `${y}-12-31`;
    years.push({ year: y, from, to, partial: from > `${y}-01-15` || to < `${y}-12-15` });
  }
  const ytd = { through: latest, from: `${y1 - 1}-01-01`, to: addMonths(latest, -12) };
  const rows = new Map<string, { values: number[]; ytdCur: number; ytdPrev: number }>();
  for (const t of spend) {
    const k = keyOf(t);
    let r = rows.get(k);
    if (!r) rows.set(k, (r = { values: years.map(() => 0), ytdCur: 0, ytdPrev: 0 }));
    const i = +t.date.slice(0, 4) - y0;
    if (i >= 0 && i < years.length) r.values[i] += t.amount;
    if (t.date >= `${y1}-01-01` && t.date <= latest) r.ytdCur += t.amount;
    if (t.date >= ytd.from && t.date <= ytd.to) r.ytdPrev += t.amount;
  }
  const out: YearRow[] = [...rows.entries()].map(([key, r]) => {
    const c = cents(r.ytdCur),
      p = cents(r.ytdPrev);
    return { key, values: r.values.map(cents), ytdCur: c, ytdPrev: p, ytdPct: p >= MIN_PCT_BASE ? c / p - 1 : null };
  });
  out.sort((a, z) => z.values.reduce((s, v) => s + v, 0) - a.values.reduce((s, v) => s + v, 0));
  /** YTD comparison only exists when the prior year's same stretch is inside the data. */
  const ytdValid = years.length >= 2 && earliest <= `${y1 - 1}-01-15`;
  return { years, rows: out, ytd, ytdValid };
}
