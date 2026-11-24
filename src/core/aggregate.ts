import { resolveCategory } from "./categories";
import { classifyKind } from "./classify";
import { accountTypeOf } from "./parsers";
import { normalizeMerchant } from "./merchant";
import { cents } from "./money";
import { SPEND_KINDS, type Rules, type Txn } from "./types";

export type Bucket = "week" | "month" | "quarter";
export type GroupBy = "bank" | "card";
export type Dim = "category" | "account";

export interface EnrichedTxn extends Txn {
  merchant: string;
  category: string;
  isSpend: boolean;
}

export interface Filters {
  from?: string;
  to?: string;
  /** account ids ("chase") in bank mode, card ids ("chase:1234") in card mode; empty = all */
  accounts: string[];
  categories: string[];
}

export function enrich(txns: Txn[], rules: Rules): EnrichedTxn[] {
  const out: EnrichedTxn[] = txns.map((stored) => {
    // Kinds are re-derived so edits to payoff/payment patterns apply to past imports too.
    const t = { ...stored, kind: classifyKind(stored, accountTypeOf(stored.account, rules), rules) };
    const merchant = normalizeMerchant(t.rawDescription, rules);
    return { ...t, merchant, category: resolveCategory(t, rules, merchant), isSpend: SPEND_KINDS.has(t.kind) };
  });
  // Refunds often carry a "credits" label from the bank; net them against what the merchant was bought as.
  const usual = new Map<string, Map<string, number>>();
  for (const t of out) {
    if (t.kind !== "purchase") continue;
    const m = usual.get(t.merchant) ?? new Map<string, number>();
    m.set(t.category, (m.get(t.category) ?? 0) + t.amount);
    usual.set(t.merchant, m);
  }
  for (const t of out) {
    if (t.kind !== "refund") continue;
    const m = usual.get(t.merchant);
    if (!m) continue;
    const hint = [...m.entries()].sort((a, z) => z[1] - a[1])[0][0];
    t.category = resolveCategory(t, rules, t.merchant, hint);
  }
  return out;
}

export const accountKey = (t: Pick<Txn, "account" | "cardKey">, groupBy: GroupBy) => (groupBy === "card" ? `${t.account}:${t.cardKey}` : t.account);

/** Spend rows only, narrowed by date range, account/card and category. */
export function applyFilters(e: EnrichedTxn[], f: Filters, groupBy: GroupBy): EnrichedTxn[] {
  const acc = new Set(f.accounts);
  const cat = new Set(f.categories);
  return e.filter(
    (t) =>
      t.isSpend &&
      (!f.from || t.date >= f.from) &&
      (!f.to || t.date <= f.to) &&
      (acc.size === 0 || acc.has(accountKey(t, groupBy)) || acc.has(t.account)) &&
      (cat.size === 0 || cat.has(t.category)),
  );
}

const utc = (iso: string) => new Date(iso + "T00:00:00Z");
const iso = (d: Date) => d.toISOString().slice(0, 10);

export function bucketKey(date: string, b: Bucket): string {
  if (b === "month") return date.slice(0, 7);
  if (b === "quarter") return `${date.slice(0, 4)}-Q${Math.floor((+date.slice(5, 7) - 1) / 3) + 1}`;
  const d = utc(date);
  const dow = (d.getUTCDay() + 6) % 7; // Monday = 0
  d.setUTCDate(d.getUTCDate() - dow);
  return iso(d);
}

export function bucketRange(from: string, to: string, b: Bucket): string[] {
  const out: string[] = [];
  if (from > to) return out;
  if (b === "week") {
    const d = utc(bucketKey(from, "week"));
    const end = bucketKey(to, "week");
    while (iso(d) <= end) {
      out.push(iso(d));
      d.setUTCDate(d.getUTCDate() + 7);
    }
    return out;
  }
  let y = +from.slice(0, 4);
  let m = +from.slice(5, 7);
  const endKey = bucketKey(to, b);
  for (let guard = 0; guard < 2400; guard++) {
    const k = bucketKey(`${y}-${String(m).padStart(2, "0")}-01`, b);
    if (out[out.length - 1] !== k) out.push(k);
    if (k === endKey) break;
    m += b === "quarter" ? 3 : 1;
    if (m > 12) {
      m -= 12;
      y++;
    }
  }
  return out;
}

export interface Series {
  buckets: string[];
  series: { name: string; values: number[]; total: number }[];
}

export function seriesBy(e: EnrichedTxn[], dim: Dim, b: Bucket, opts: { from?: string; to?: string; groupBy: GroupBy; rolling?: number }): Series {
  if (!e.length && !(opts.from && opts.to)) return { buckets: [], series: [] };
  const dates = e.map((t) => t.date).sort();
  const from = opts.from ?? dates[0];
  const to = opts.to ?? dates[dates.length - 1];
  const buckets = bucketRange(from, to, b);
  const pos = new Map(buckets.map((k, i) => [k, i]));
  const by = new Map<string, number[]>();
  for (const t of e) {
    const name = dim === "category" ? t.category : accountKey(t, opts.groupBy);
    const i = pos.get(bucketKey(t.date, b));
    if (i == null) continue;
    let arr = by.get(name);
    if (!arr) by.set(name, (arr = new Array(buckets.length).fill(0)));
    arr[i] += t.amount;
  }
  const series = [...by.entries()].map(([name, raw]) => {
    let values = raw.map(cents);
    const w = opts.rolling ?? 0;
    if (w > 1) values = raw.map((_, i) => cents(raw.slice(Math.max(0, i - w + 1), i + 1).reduce((a, c) => a + c, 0) / Math.min(w, i + 1)));
    return { name, values, total: cents(raw.reduce((a, c) => a + c, 0)) };
  });
  series.sort((a, z) => z.total - a.total);
  return { buckets, series };
}

export interface Total {
  name: string;
  total: number;
  count: number;
  share: number;
}

export function totalsBy(e: EnrichedTxn[], dim: Dim | "merchant", groupBy: GroupBy): Total[] {
  const m = new Map<string, { total: number; count: number }>();
  let all = 0;
  for (const t of e) {
    const k = dim === "category" ? t.category : dim === "merchant" ? t.merchant : accountKey(t, groupBy);
    const v = m.get(k) ?? { total: 0, count: 0 };
    v.total += t.amount;
    if (t.amount > 0) v.count++;
    m.set(k, v);
    all += t.amount;
  }
  return [...m.entries()]
    .map(([name, v]) => ({ name, total: cents(v.total), count: v.count, share: all ? v.total / all : 0 }))
    .sort((a, z) => z.total - a.total);
}

export interface MerchantStat {
  merchant: string;
  total: number;
  count: number;
  avg: number;
  share: number;
  largest: number;
  recurring: boolean;
  months: number;
}

export function topMerchants(e: EnrichedTxn[], n: number): MerchantStat[] {
  const all = e.reduce((a, t) => a + t.amount, 0);
  const m = new Map<string, { total: number; count: number; largest: number; months: Set<string> }>();
  for (const t of e) {
    const v = m.get(t.merchant) ?? { total: 0, count: 0, largest: 0, months: new Set<string>() };
    v.total += t.amount;
    if (t.amount > 0) {
      v.count++;
      v.largest = Math.max(v.largest, t.amount);
      v.months.add(t.date.slice(0, 7));
    }
    m.set(t.merchant, v);
  }
  return [...m.entries()]
    .map(([merchant, v]) => ({
      merchant,
      total: cents(v.total),
      count: v.count,
      avg: v.count ? cents(v.total / v.count) : 0,
      share: all ? v.total / all : 0,
      largest: v.largest,
      recurring: v.count >= 3 && v.months.size >= 3,
      months: v.months.size,
    }))
    .sort((a, z) => z.total - a.total)
    .slice(0, n);
}

export function topPurchases(e: EnrichedTxn[], n: number): EnrichedTxn[] {
  return e
    .filter((t) => t.amount > 0)
    .sort((a, z) => z.amount - a.amount)
    .slice(0, n);
}

export function kpis(e: EnrichedTxn[], from: string, to: string) {
  const total = cents(e.reduce((a, t) => a + t.amount, 0));
  const months = Math.max(1, bucketRange(from, to, "month").length);
  return { total, months, perMonth: cents(total / months), count: e.filter((t) => t.amount > 0).length };
}

export function prevRange(from: string, to: string): { from: string; to: string } {
  const days = Math.round((utc(to).getTime() - utc(from).getTime()) / 86400000) + 1;
  const pto = utc(from);
  pto.setUTCDate(pto.getUTCDate() - 1);
  const pfrom = new Date(pto);
  pfrom.setUTCDate(pfrom.getUTCDate() - (days - 1));
  return { from: iso(pfrom), to: iso(pto) };
}
