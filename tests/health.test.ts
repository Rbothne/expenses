import { describe, expect, it } from "vitest";
import { enrich } from "../src/core/aggregate";
import { healthMetrics } from "../src/core/health";
import { defaultRules } from "../src/core/rules";
import type { Rules, Txn } from "../src/core/types";

let n = 0;
const t = (date: string, amount: number, desc: string, o: Partial<Txn> = {}): Txn => ({
  id: `hm${n++}#0`,
  importId: "i",
  account: "chase",
  cardKey: "1234",
  date,
  amount,
  rawDescription: desc,
  kind: amount < 0 ? "refund" : "purchase",
  issuerCategory: "Groceries",
  ...o,
});
const months = ["2026-01", "2026-02"];
const rows: Txn[] = months.flatMap((m) => [
  t(`${m}-01`, 1500, "OAK APARTMENTS RENT", { account: "schwab", cardKey: "primary", issuerCategory: undefined }),
  t(`${m}-05`, 500, "SAFEWAY #1"),
  t(`${m}-09`, 300, "FANCY BISTRO", { issuerCategory: "Food & Drink" }),
  t(`${m}-15`, -2500, "ACME PAYROLL", { account: "schwab", cardKey: "primary", kind: "deposit" }),
  t(`${m}-28`, -2500, "ACME PAYROLL", { account: "schwab", cardKey: "primary", kind: "deposit" }),
  t(`${m}-20`, -2000, "SCHWAB TRANSFER FROM BROKERAGE", { account: "schwab", cardKey: "primary", kind: "deposit" }),
]);
rows.push(t("2026-02-25", 40, "INTEREST CHARGE ON PURCHASES", { issuerCategory: undefined }));
const range = { from: "2026-01-01", to: "2026-02-28" };

describe("healthMetrics", () => {
  const rules: Rules = defaultRules();
  const m = healthMetrics(enrich(rows, rules), rules, range);
  it("monthly averages over whole months", () => {
    expect(m.months).toBe(2);
    expect(m.spendMonthly).toBe(2320); // 1500 + 500 + 300 + 40/2
    expect(m.housingMonthly).toBe(1500);
    expect(m.needsMonthly).toBe(2000);
    expect(m.wantsMonthly).toBe(320);
  });
  it("income is paychecks only, and savings is what's left of it", () => {
    expect(m.income).toMatchObject({ monthly: 5000, source: "detected" });
    expect(m.savingsMonthly).toBe(2680);
    expect(m.shares).toMatchObject({ needs: 0.4, wants: 0.064, savings: 0.536, housingOfTakeHome: 0.3 });
  });
  it("interest and fees paid in the window", () => {
    expect(m.interestFees).toBe(40);
  });
  it("housing against gross income only when gross is known", () => {
    expect(m.shares.housingOfGross).toBeNull();
    const r2 = { ...rules, profile: { grossAnnual: 90000 } };
    expect(healthMetrics(enrich(rows, r2), r2, range).shares.housingOfGross).toBeCloseTo(0.2, 5);
  });
  it("emergency fund months covered, against monthly expenses", () => {
    const r3 = { ...rules, profile: { emergencySavings: 11600 } };
    expect(healthMetrics(enrich(rows, r3), r3, range).emergencyMonths).toBe(5);
    expect(m.emergencyMonths).toBeNull();
  });
  it("no income known means no income shares", () => {
    const noPay = rows.filter((x) => !/PAYROLL/.test(x.rawDescription));
    const h = healthMetrics(enrich(noPay, rules), rules, range);
    expect(h.income.monthly).toBeNull();
    expect(h.shares.needs).toBeNull();
    expect(h.savingsMonthly).toBeNull();
  });
});
