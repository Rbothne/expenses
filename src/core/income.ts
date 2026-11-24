import type { EnrichedTxn } from "./aggregate";
import { bucketRange } from "./aggregate";
import { cents } from "./money";
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
  return e.filter((t) => t.kind === "deposit" && res.some((r) => r.test(t.rawDescription)));
}

export interface MonthlyIncome {
  /** take-home per month used by the checks; null when neither typed nor detected */
  monthly: number | null;
  /** detected paychecks in the window, as a positive total */
  detected: number;
  months: number;
  source: "typed" | "detected" | "none";
}

export function monthlyIncome(e: EnrichedTxn[], rules: Rules, r: { from: string; to: string }): MonthlyIncome {
  const months = Math.max(1, bucketRange(r.from, r.to, "month").length);
  const detected = cents(-incomeRows(e, rules).filter((t) => t.date >= r.from && t.date <= r.to).reduce((a, t) => a + t.amount, 0));
  const typed = rules.profile.takeHomeMonthly;
  if (typed && typed > 0) return { monthly: typed, detected, months, source: "typed" };
  if (detected > 0) return { monthly: cents(detected / months), detected, months, source: "detected" };
  return { monthly: null, detected, months, source: "none" };
}
