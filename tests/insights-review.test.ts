import { describe, expect, it } from "vitest";
import { enrich, type EnrichedTxn } from "../src/core/aggregate";
import { cpiFactor } from "../src/core/benchmarks";
import { classifyKind } from "../src/core/classify";
import { clampToData, coverageGaps, insights, priceChanges, type Insight } from "../src/core/compare";
import { healthMetrics } from "../src/core/health";
import { incomeRows, monthlyIncome } from "../src/core/income";
import { fullMonths } from "../src/core/range";
import { defaultRules, withDefaults } from "../src/core/rules";
import type { Rules, Txn } from "../src/core/types";

const rules = defaultRules();
let n = 0;
const t = (date: string, amount: number, desc: string, o: Partial<Txn> = {}): Txn => ({
  id: `r${n++}#0`,
  importId: "i",
  account: "chase",
  cardKey: "1",
  date,
  amount,
  rawDescription: desc,
  kind: amount < 0 ? "refund" : "purchase",
  issuerCategory: "Groceries",
  ...o,
});
const bank = (date: string, amount: number, desc: string): Txn => t(date, amount, desc, { account: "schwab", cardKey: "primary", issuerCategory: undefined, kind: amount < 0 ? "deposit" : "purchase" });
const spend = (x: Txn[]) => enrich(x, rules).filter((r) => r.isSpend);
const days = (from: string, to: string) => {
  const out: string[] = [];
  for (let d = new Date(from + "T00:00:00Z"); d.toISOString().slice(0, 10) <= to; d.setUTCDate(d.getUTCDate() + 1)) out.push(d.toISOString().slice(0, 10));
  return out;
};

describe("partial latest month (finding 1)", () => {
  it("comparison windows end at the latest data date, so same-dates-last-year compares equal stretches", () => {
    expect(clampToData({ from: "2025-12-01", to: "2026-11-30" }, "2026-11-10")).toEqual({ from: "2025-12-01", to: "2026-11-10" });
    const e = spend(days("2024-12-01", "2026-11-10").map((d) => t(d, 100, "SAFEWAY #1")));
    const cur = clampToData({ from: "2025-12-01", to: "2026-11-30" }, "2026-11-10");
    const ins = insights(
      e.filter((x) => x.date >= cur.from && x.date <= cur.to),
      e.filter((x) => x.date >= "2024-12-01" && x.date <= "2025-11-10"),
    );
    expect(Math.abs((ins[0] as Extract<Insight, { type: "total" }>).delta)).toBeLessThanOrEqual(100); // one leap-ish day at most
  });
  it("monthly averages use the last complete month", () => {
    expect(fullMonths("2026-11-10", "2024-12-01", 12)).toEqual({ from: "2025-11-01", to: "2026-10-31" });
    expect(fullMonths("2026-11-29", "2024-12-01", 12)).toEqual({ from: "2025-12-01", to: "2026-11-30" }); // last couple of days = complete
    expect(fullMonths("2026-11-10", "2026-03-14", 12)).toEqual({ from: "2026-04-01", to: "2026-10-31" }); // data starts mid-month
  });
});

describe("coverage (finding 2)", () => {
  it("an account that stops a month before the others is flagged", () => {
    const all = enrich([...days("2025-01-01", "2026-11-29").filter((d) => d.endsWith("5")).map((d) => t(d, 10, "SAFEWAY #1")), ...days("2025-01-01", "2026-10-31").filter((d) => d.endsWith("5")).map((d) => t(d, 10, "X", { account: "amex" }))], rules);
    expect(coverageGaps(all, { from: "2025-01-01", to: "2026-11-29" }).map((g) => g.account)).toEqual(["amex"]);
  });
  it("a hole of two or more months inside an otherwise active account is flagged", () => {
    const amex = days("2025-01-01", "2026-06-30")
      .filter((d) => d.endsWith("5") && !(d >= "2025-03-01" && d <= "2025-08-31"))
      .map((d) => t(d, 10, "X", { account: "amex" }));
    const g = coverageGaps(enrich(amex, rules), { from: "2025-01-01", to: "2026-06-30" });
    expect(g[0].holes).toEqual(["2025-03", "2025-04", "2025-05", "2025-06", "2025-07", "2025-08"]);
  });
  it("a replaced card on the same account is not a gap", () => {
    const rows = [...days("2025-01-01", "2025-06-30").filter((d) => d.endsWith("5")).map((d) => t(d, 10, "X", { cardKey: "1111" })), ...days("2025-07-01", "2025-12-31").filter((d) => d.endsWith("5")).map((d) => t(d, 10, "X", { cardKey: "2222" }))];
    expect(coverageGaps(enrich(rows, rules), { from: "2025-01-01", to: "2025-12-31" })).toEqual([]);
  });
  it("a rarely used card with quiet months is not a gap", () => {
    const rows = ["2025-01-10", "2025-04-10", "2025-09-10", "2025-12-20"].map((d) => t(d, 10, "X", { account: "discover" }));
    expect(coverageGaps(enrich(rows, rules), { from: "2025-01-01", to: "2025-12-31" })).toEqual([]);
  });
});

describe("card interest vs fees (finding 3)", () => {
  it("annual fees and ATM fees don't fail the pay-in-full check", () => {
    const m = healthMetrics(enrich([t("2026-01-05", 95, "ANNUAL MEMBERSHIP FEE", { issuerCategory: undefined }), bank("2026-01-06", 3, "ATM FEE")], rules), rules, { from: "2026-01-01", to: "2026-01-31" });
    expect(m.cardInterest).toBe(0);
    expect(m.fees).toBe(98);
  });
});

describe("income coverage (finding 4)", () => {
  it("averages paychecks over the months the bank account was imported", () => {
    const rows = [
      ...["01", "02", "03", "04", "05", "06", "07", "08", "09", "10", "11", "12"].map((m) => t(`2025-${m}-10`, 2000, "SAFEWAY #1")),
      ...["07", "08", "09", "10", "11", "12"].map((m) => bank(`2025-${m}-15`, -5000, "ACME PAYROLL")),
    ];
    const inc = monthlyIncome(enrich(rows, rules), rules, { from: "2025-01-01", to: "2025-12-31" });
    expect(inc.monthly).toBe(5000);
    expect(inc.months).toBe(6);
    expect(inc.partial).toBe(true);
  });
  it("refunds and reimbursements aren't pay (finding 13)", () => {
    const e = enrich([bank("2025-01-15", -40, "GUSTO PAYROLL REFUND"), bank("2025-01-16", -60, "VENMO PAYROLL REIMB"), bank("2025-01-17", -3000, "ACME PAYROLL")], rules);
    expect(incomeRows(e, rules).map((x) => x.amount)).toEqual([-3000]);
  });
});

describe("Housing and loans (findings 6, 7)", () => {
  const cat = (desc: string, o: Partial<Txn> = {}) => enrich([t("2026-01-01", 100, desc, o)], rules)[0].category;
  it("car and clothing rentals aren't housing", () => {
    for (const d of ["BUDGET RENT A CAR LAX", "HERTZ RENT A CAR", "RENT THE RUNWAY", "APARTMENTS.COM"]) expect(cat(d, { issuerCategory: "Travel" })).not.toBe("Housing");
  });
  it("common mortgage descriptions from checking are housing", () => {
    for (const d of ["WELLS FARGO HOME MTG AUTO PAY", "CHASE HOME LN PMT"]) expect(cat(d, { account: "schwab", cardKey: "primary", issuerCategory: undefined })).toBe("Housing");
  });
  it("other loan payments are their own category, not Other", () => {
    expect(cat("NAVIENT STUDENT LOAN PMT", { account: "schwab", cardKey: "primary", issuerCategory: undefined })).toBe("Loans");
    expect(cat("TOYOTA FINANCIAL AUTO LN", { account: "schwab", cardKey: "primary", issuerCategory: undefined })).toBe("Loans");
  });
  it("a transfer to your own loan account stays a transfer", () => {
    expect(classifyKind({ date: "2026-01-01", amount: 500, rawDescription: "FUNDS TRANSFER TO LOAN ACCT 1234" }, "bank", rules)).toBe("transfer");
    expect(classifyKind({ date: "2026-01-01", amount: 30, rawDescription: "MTG ARENA" }, "bank", rules)).toBe("purchase");
  });
  it("loan payments count toward savings & debt in 50/30/20, not wants", () => {
    const rows = [bank("2026-01-01", 1000, "OAK APARTMENTS RENT"), bank("2026-01-02", 500, "NAVIENT STUDENT LOAN PMT"), bank("2026-01-15", -5000, "ACME PAYROLL"), t("2026-01-09", 300, "FANCY BISTRO", { issuerCategory: "Food & Drink" })];
    const m = healthMetrics(enrich(rows, rules), rules, { from: "2026-01-01", to: "2026-01-31" });
    expect(m.shares.wants).toBeCloseTo(300 / 5000, 5);
    expect(m.shares.savings).toBeCloseTo((5000 - 1800 + 500) / 5000, 5); // left over + debt paydown
  });
});

describe("priceChanges ordering (finding 8)", () => {
  it("uses the latest charges regardless of file order", () => {
    const prev = ["2025-01-10", "2025-02-10", "2025-03-10"].map((d) => t(d, 15.49, "NETFLIX.COM"));
    const cur = [...["2026-01-10", "2026-02-10", "2026-03-10"].map((d) => t(d, 15.49, "NETFLIX.COM")), ...["2026-04-10", "2026-05-10", "2026-06-10"].map((d) => t(d, 17.99, "NETFLIX.COM"))];
    const newestFirst = spend([...cur].reverse());
    expect(priceChanges(newestFirst, spend(prev))[0]).toMatchObject({ before: 15.49, after: 17.99 });
  });
});

describe("insight edge cases (findings 9, 10)", () => {
  it("scattered one-off visits aren't a stopped subscription", () => {
    const prev = spend(["2025-01-10", "2025-03-10", "2025-07-10"].map((d) => t(d, 4.5, "JOES COFFEE", { issuerCategory: "Food & Drink" })));
    expect(insights([] as EnrichedTxn[], prev).find((i) => i.type === "gone")).toBeUndefined();
  });
  it("a subscription that ended mid-period is still 'stopped'", () => {
    const prev = spend(["2025-01-03", "2025-02-03", "2025-03-03", "2025-04-03"].map((d) => t(d, 11.99, "HULU 877", { issuerCategory: undefined })));
    expect(insights([], prev).find((i) => i.type === "gone" && i.key === "Hulu")).toBeTruthy();
  });
  it("net refunds don't produce percentages past −100%", () => {
    const prev = spend([t("2025-03-01", 200, "STORE A", { issuerCategory: "Shopping" })]);
    const cur = spend([t("2026-03-01", 100, "STORE A", { issuerCategory: "Shopping" }), t("2026-03-05", -150, "STORE A", { issuerCategory: "Shopping" })]);
    const s = insights(cur, prev).find((i) => i.type === "category" && i.key === "Shopping") as Extract<Insight, { type: "category" }>;
    expect(s.pct).toBeNull();
  });
});

describe("cpi and migration (findings 11, 12)", () => {
  it("years before the CPI table can't be adjusted", () => {
    expect(cpiFactor({ from: "2018-01-01", to: "2018-12-31" }, "2025")).toBeNull();
  });
  it("null fields in a hand-edited rules file fall back to defaults", () => {
    const r = withDefaults({ needsCategories: null, incomePatterns: null, profile: null } as unknown as Partial<Rules>);
    expect(r.needsCategories.length).toBeGreaterThan(0);
    expect(r.incomePatterns.length).toBeGreaterThan(0);
    expect(r.profile).toEqual({});
  });
  it("older files gain Loans along with Housing", () => {
    const old = { categories: ["Groceries", "Other"] } as Partial<Rules>;
    expect(withDefaults(old).categories).toEqual(["Housing", "Groceries", "Loans", "Other"]);
  });
});
