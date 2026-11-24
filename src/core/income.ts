import type { EnrichedTxn } from "./aggregate";
import { bucketRange } from "./aggregate";
import { cents } from "./money";
import { NOT_INCOME } from "./rules";
import type { Rules } from "./types";

const compile = (patterns: string[]) =>
  patterns.flatMap((p) => {
    try {
      return [new RegExp(p, "i")];
    } catch {
      return [];
    }
  });

/** Paychecks: bank-account deposits whose description matches an income pattern. Amounts stay negative (money in). */
export function incomeRows(e: EnrichedTxn[], rules: Rules): EnrichedTxn[] {
  const res = compile(rules.incomePatterns);
  return e.filter((t) => t.kind === "deposit" && !NOT_INCOME.test(t.rawDescription) && res.some((r) => r.test(t.rawDescription)));
}

export interface MonthlyIncome {
  /** take-home per month used by the checks; null when neither typed nor detected */
  monthly: number | null;
  /** detected paychecks in the window, as a positive total */
  detected: number;
  /** months the paycheck account(s) were imported for inside the window: the divisor for detected pay */
  months: number;
  /** the paycheck account's history covers less of the window than the window itself */
  partial: boolean;
  source: "typed" | "detected" | "none";
}

/**
 * Take-home per month. Detected pay is averaged over the months the paycheck account was actually imported for
 * (its first to last row of any kind inside the window), so six months of Schwab history isn't spread over twelve.
 */
export function monthlyIncome(e: EnrichedTxn[], rules: Rules, r: { from: string; to: string }): MonthlyIncome {
  const windowMonths = Math.max(1, bucketRange(r.from, r.to, "month").length);
  const pay = incomeRows(e, rules).filter((t) => t.date >= r.from && t.date <= r.to);
  const detected = cents(-pay.reduce((a, t) => a + t.amount, 0));
  const accounts = new Set(pay.map((t) => t.account));
  let first = "",
    last = "";
  for (const t of e) {
    if (!accounts.has(t.account) || t.date < r.from || t.date > r.to) continue;
    if (!first || t.date < first) first = t.date;
    if (!last || t.date > last) last = t.date;
  }
  const months = first ? Math.max(1, bucketRange(first, last, "month").length) : windowMonths;
  const partial = months < windowMonths;
  const typed = rules.profile.takeHomeMonthly;
  if (typed && typed > 0) return { monthly: typed, detected, months, partial, source: "typed" };
  if (detected > 0) return { monthly: cents(detected / months), detected, months, partial, source: "detected" };
  return { monthly: null, detected, months, partial, source: "none" };
}
