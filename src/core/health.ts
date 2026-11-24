import { bucketRange, type EnrichedTxn } from "./aggregate";
import { monthlyIncome, type MonthlyIncome } from "./income";
import { cents } from "./money";
import type { Rules } from "./types";

export interface HealthMetrics {
  months: number;
  spendMonthly: number;
  needsMonthly: number;
  wantsMonthly: number;
  housingMonthly: number;
  /** Loan payments (category Loans): debt paydown, which 50/30/20 counts with savings, not wants. */
  loansMonthly: number;
  /** Card interest over the window (not per month): any means a balance was carried. */
  cardInterest: number;
  /** Fees over the window (annual, ATM, late...): shown, but not a pay-in-full failure. */
  fees: number;
  income: MonthlyIncome;
  /** take-home minus spending; null without income. Overstated if some spending accounts aren't imported. */
  savingsMonthly: number | null;
  shares: {
    needs: number | null;
    wants: number | null;
    savings: number | null;
    housingOfTakeHome: number | null;
    housingOfGross: number | null;
    /** housing plus Utilities & Bills (HUD counts utilities; that category also holds phone/internet, so it's an upper bound) */
    housingUtilOfGross: number | null;
  };
  /** emergency savings / monthly spending (FDIC: "months' worth of expenses"); null when savings weren't entered */
  emergencyMonths: number | null;
}

/** Monthly averages over whole months of the window, from spend rows and paychecks. */
export function healthMetrics(all: EnrichedTxn[], rules: Rules, r: { from: string; to: string }): HealthMetrics {
  const months = Math.max(1, bucketRange(r.from, r.to, "month").length);
  const needs = new Set(rules.needsCategories);
  let spend = 0,
    need = 0,
    housing = 0,
    util = 0,
    loans = 0,
    interest = 0,
    fees = 0;
  for (const t of all) {
    if (!t.isSpend || t.date < r.from || t.date > r.to) continue;
    spend += t.amount;
    if (needs.has(t.category)) need += t.amount;
    if (t.category === "Housing") housing += t.amount;
    if (t.category === "Utilities & Bills") util += t.amount;
    if (t.category === "Loans") loans += t.amount;
    if (t.kind === "interest") interest += t.amount;
    if (t.kind === "fee") fees += t.amount;
  }
  const income = monthlyIncome(all, rules, r);
  const pm = (x: number) => cents(x / months);
  const spendMonthly = pm(spend);
  const needsMonthly = pm(need);
  const housingMonthly = pm(housing);
  const loansMonthly = pm(loans);
  const inc = income.monthly;
  const share = (x: number) => (inc ? x / inc : null);
  const savingsMonthly = inc == null ? null : cents(inc - spendMonthly);
  const gross = rules.profile.grossAnnual;
  const es = rules.profile.emergencySavings;
  return {
    months,
    spendMonthly,
    needsMonthly,
    wantsMonthly: cents(spendMonthly - needsMonthly - loansMonthly),
    housingMonthly,
    loansMonthly,
    cardInterest: cents(interest),
    fees: cents(fees),
    income,
    savingsMonthly,
    shares: {
      needs: share(needsMonthly),
      wants: share(spendMonthly - needsMonthly - loansMonthly),
      // 50/30/20's third bucket is "savings and debt repayment": what's left plus loan payments.
      savings: savingsMonthly == null ? null : share(savingsMonthly + loansMonthly),
      housingOfTakeHome: share(housingMonthly),
      housingOfGross: gross && gross > 0 ? housingMonthly / (gross / 12) : null,
      housingUtilOfGross: gross && gross > 0 ? (housingMonthly + pm(util)) / (gross / 12) : null,
    },
    emergencyMonths: es != null && es >= 0 && spendMonthly > 0 ? Math.round((es / spendMonthly) * 10) / 10 : null,
  };
}
