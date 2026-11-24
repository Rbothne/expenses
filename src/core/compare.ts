import { accountKey, type EnrichedTxn, type GroupBy } from "./aggregate";
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
      return { key, cur: c, prev: p, delta: cents(c - p), pct: p >= MIN_PCT_BASE ? c / p - 1 : null };
    })
    .sort((a, z) => Math.abs(z.delta) - Math.abs(a.delta));
}

export interface Gap {
  account: string;
  first: string;
  last: string;
}

/** Grace for "history starts on the 3rd of the month": quiet weeks are normal, missing months are not. */
const GRACE_DAYS = 31;

/**
 * Accounts (or cards) whose imported history doesn't span the whole range. Comparing a period where Amex is
 * missing against one where it's present reads as a spending jump that never happened. Pass all rows, not
 * just spending, so payments count as evidence the account was imported for those dates.
 */
export function coverageGaps(all: EnrichedTxn[], r: Range, groupBy: GroupBy): Gap[] {
  const span = new Map<string, { first: string; last: string }>();
  for (const t of all) {
    const k = accountKey(t, groupBy);
    const s = span.get(k);
    if (!s) span.set(k, { first: t.date, last: t.date });
    else {
      if (t.date < s.first) s.first = t.date;
      if (t.date > s.last) s.last = t.date;
    }
  }
  const from = utc(r.from).getTime();
  const to = utc(r.to).getTime();
  const out: Gap[] = [];
  for (const [account, s] of span) {
    const lateStart = (utc(s.first).getTime() - from) / 86400000 > GRACE_DAYS;
    const earlyEnd = (to - utc(s.last).getTime()) / 86400000 > GRACE_DAYS;
    if (lateStart || earlyEnd) out.push({ account, ...s });
  }
  return out.sort((a, z) => a.account.localeCompare(z.account));
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
  const a = charges(prev),
    b = charges(cur);
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

  // Months each merchant was charged in the earlier period, to tell a stopped subscription from a one-off.
  const prevMonths = new Map<string, Set<string>>();
  for (const t of prev) if (t.amount > 0) prevMonths.set(t.merchant, (prevMonths.get(t.merchant) ?? new Set()).add(t.date.slice(0, 7)));

  const merchants = deltas(cur, prev, (t) => t.merchant);
  const newOnes: Insight[] = [];
  const gone: Insight[] = [];
  const movers: Insight[] = [];
  for (const m of merchants) {
    if (m.prev <= 0 && m.cur >= floor) newOnes.push({ type: "new", key: m.key, cur: m.cur });
    else if (m.cur <= 0 && m.prev > 0 && (prevMonths.get(m.key)?.size ?? 0) >= 3) gone.push({ type: "gone", key: m.key, prev: m.prev, months: prevMonths.get(m.key)!.size });
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
