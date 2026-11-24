import { describe, expect, it } from "vitest";
import { enrich } from "../src/core/aggregate";
import { classifyKind } from "../src/core/classify";
import { incomeRows, monthlyIncome } from "../src/core/income";
import { defaultRules, withDefaults } from "../src/core/rules";
import type { Txn } from "../src/core/types";

const rules = defaultRules();
let n = 0;
const s = (date: string, amount: number, desc: string, o: Partial<Txn> = {}): Txn => ({
  id: `h${n++}#0`,
  importId: "i",
  account: "schwab",
  cardKey: "primary",
  date,
  amount,
  rawDescription: desc,
  kind: amount < 0 ? "deposit" : "purchase",
  ...o,
});

describe("housing", () => {
  it("is a built-in category", () => {
    expect(rules.categories).toContain("Housing");
  });
  it("older rules files gain Housing once, and a later removal sticks", () => {
    const old = { ...defaultRules(), categories: ["Groceries", "Other"] } as Partial<ReturnType<typeof defaultRules>>;
    delete (old as Record<string, unknown>).incomePatterns;
    const up = withDefaults(old);
    expect(up.categories).toEqual(["Housing", "Groceries", "Other"]);
    const removed = withDefaults({ ...up, categories: ["Groceries", "Other"] });
    expect(removed.categories).toEqual(["Groceries", "Other"]);
  });
  it("rent and mortgage payments from checking land in Housing", () => {
    const e = enrich([s("2026-01-01", 1800, "ZELLE TO OAK APARTMENTS"), s("2026-01-02", 2100, "ROCKET MORTGAGE PAYMENT"), s("2026-01-03", 45, "HERTZ RENT-A-CAR")], rules);
    expect(e.map((t) => t.category)).toEqual(["Housing", "Housing", "Other"]);
  });
  it("a mortgage or loan from a card issuer is spending, not a card payoff", () => {
    expect(classifyKind({ date: "2026-01-01", amount: 2100, rawDescription: "CHASE MORTGAGE PAYMENT" }, "bank", rules)).toBe("purchase");
    expect(classifyKind({ date: "2026-01-01", amount: 400, rawDescription: "CAPITAL ONE AUTO LOAN PMT" }, "bank", rules)).toBe("purchase");
    expect(classifyKind({ date: "2026-01-01", amount: 900, rawDescription: "CHASE CREDIT CRD EPAY" }, "bank", rules)).toBe("transfer");
  });
});

describe("income", () => {
  const e = enrich(
    [
      s("2026-01-15", -2500, "ACME CORP PAYROLL"),
      s("2026-01-31", -2500, "ACME CORP DIR DEP"),
      s("2026-02-15", -2500, "DIRECT DEPOSIT ACME"),
      s("2026-02-20", -300, "TRANSFER FROM SAVINGS"),
      s("2026-02-21", -40, "VENMO CASHOUT"),
      s("2026-02-28", -2500, "ACME CORP PAYROLL"),
    ],
    rules,
  );
  it("counts paychecks, not transfers or reimbursements", () => {
    expect(incomeRows(e, rules).map((t) => t.amount)).toEqual([-2500, -2500, -2500, -2500]);
  });
  it("monthly take-home averages whole months in the window", () => {
    expect(monthlyIncome(e, rules, { from: "2026-01-01", to: "2026-02-28" })).toMatchObject({ detected: 10000, monthly: 5000, months: 2, source: "detected" });
  });
  it("a typed take-home overrides detection", () => {
    const r = { ...rules, profile: { ...rules.profile, takeHomeMonthly: 6100 } };
    expect(monthlyIncome(e, r, { from: "2026-01-01", to: "2026-02-28" })).toMatchObject({ monthly: 6100, source: "typed" });
  });
});
