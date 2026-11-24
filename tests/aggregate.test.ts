import { describe, expect, it } from "vitest";
import { applyFilters, bucketKey, bucketRange, enrich, kpis, prevRange, seriesBy, topMerchants, topPurchases, totalsBy } from "../src/core/aggregate";
import { defaultRules } from "../src/core/rules";
import type { Txn } from "../src/core/types";

const rules = defaultRules();
let n = 0;
const t = (date: string, amount: number, desc: string, o: Partial<Txn> = {}): Txn => ({
  id: `id${n++}#0`,
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

const txns: Txn[] = [
  t("2026-01-05", 100, "SAFEWAY #1"),
  t("2026-02-05", 110, "SAFEWAY #1"),
  t("2026-04-05", 120, "SAFEWAY #1"),
  t("2026-04-10", 900, "BIG TV STORE", { issuerCategory: "Shopping" }),
  t("2026-04-12", -950, "BIG TV STORE", { issuerCategory: "Shopping" }),
  t("2026-02-10", 50, "WHOLEFDS MKT", { account: "amex", cardKey: "61005:JANE", issuerCategory: undefined }),
  t("2026-02-11", -500, "AUTOPAY PAYMENT", { kind: "payment" }),
  t("2026-03-01", 1200, "COSTCO WHSE #1", { account: "amex", cardKey: "62003:JOHN", issuerCategory: "Merchandise & Supplies-Wholesale Stores" }),
];
const e = enrich(txns, rules);

describe("buckets", () => {
  it("keys", () => {
    expect(bucketKey("2026-04-05", "month")).toBe("2026-04");
    expect(bucketKey("2026-04-05", "quarter")).toBe("2026-Q2");
    expect(bucketKey("2026-11-26", "week")).toBe("2026-11-23"); // Monday
    expect(bucketKey("2026-11-23", "week")).toBe("2026-11-23");
  });
  it("range includes empty months", () => {
    expect(bucketRange("2026-01-15", "2026-04-02", "month")).toEqual(["2026-01", "2026-02", "2026-03", "2026-04"]);
    expect(bucketRange("2026-01-01", "2026-12-31", "quarter")).toEqual(["2026-Q1", "2026-Q2", "2026-Q3", "2026-Q4"]);
  });
});

describe("enrich + filters", () => {
  it("excludes payments from spend and derives merchant/category", () => {
    const f = applyFilters(e, { accounts: [], categories: [] }, "bank");
    expect(f.find((x) => x.kind === "payment")).toBeUndefined();
    expect(f.find((x) => x.rawDescription === "WHOLEFDS MKT")).toMatchObject({ merchant: "Whole Foods", category: "Groceries" });
    expect(f.find((x) => x.merchant === "Costco")!.category).toBe("Groceries");
  });
  it("filters by date, account and card", () => {
    expect(applyFilters(e, { from: "2026-03-01", to: "2026-03-31", accounts: [], categories: [] }, "bank")).toHaveLength(1);
    expect(applyFilters(e, { accounts: ["amex"], categories: [] }, "bank")).toHaveLength(2);
    expect(applyFilters(e, { accounts: ["amex:62003:JOHN"], categories: [] }, "card")).toHaveLength(1);
    expect(applyFilters(e, { accounts: [], categories: ["Shopping"] }, "bank")).toHaveLength(2);
  });
});

describe("retroactive reclassification", () => {
  it("transfer pattern edits re-classify stored Schwab rows", () => {
    const venmo = t("2026-05-01", 40, "VENMO PAYMENT 1023", { account: "schwab", cardKey: "primary", kind: "purchase", issuerCategory: undefined });
    expect(enrich([venmo], rules)[0].kind).toBe("purchase");
    const r2 = { ...rules, transferPatterns: [...rules.transferPatterns, "VENMO"] };
    const e2 = enrich([venmo], r2)[0];
    expect(e2.kind).toBe("transfer");
    expect(e2.isSpend).toBe(false);
  });
  it("card type hints survive reclassification", () => {
    const ret = t("2026-05-01", -20, "AMAZON PAYMENTS RETURN", { typeHint: "return" });
    expect(enrich([ret], rules)[0].kind).toBe("refund");
  });
});

describe("seriesBy", () => {
  const f = applyFilters(e, { accounts: [], categories: [] }, "bank");
  it("monthly category series with zero months and net refunds (can go negative)", () => {
    const s = seriesBy(f, "category", "month", { from: "2026-01-01", to: "2026-04-30", groupBy: "bank" });
    expect(s.buckets).toEqual(["2026-01", "2026-02", "2026-03", "2026-04"]);
    const g = s.series.find((x) => x.name === "Groceries")!;
    expect(g.values).toEqual([100, 160, 1200, 120]);
    const sh = s.series.find((x) => x.name === "Shopping")!;
    expect(sh.values).toEqual([0, 0, 0, -50]);
    expect(s.series[0].name).toBe("Groceries"); // sorted by total desc
  });
  it("by account, card granularity", () => {
    const s = seriesBy(f, "account", "month", { from: "2026-01-01", to: "2026-04-30", groupBy: "card" });
    expect(s.series.map((x) => x.name).sort()).toEqual(["amex:61005:JANE", "amex:62003:JOHN", "chase:1234"]);
  });
  it("rolling average", () => {
    const s = seriesBy(f, "category", "month", { from: "2026-01-01", to: "2026-04-30", groupBy: "bank", rolling: 2 });
    expect(s.series.find((x) => x.name === "Groceries")!.values).toEqual([100, 130, 680, 660]);
  });
  it("empty input does not crash", () => {
    const s = seriesBy([], "category", "month", { groupBy: "bank" });
    expect(s.series).toEqual([]);
  });
});

describe("top contributors", () => {
  const groceries = applyFilters(e, { accounts: [], categories: ["Groceries"] }, "bank");
  it("ranks merchants by net total with stats and recurring badge", () => {
    const top = topMerchants(groceries, 5);
    expect(top.map((m) => m.merchant)).toEqual(["Costco", "Safeway", "Whole Foods"]);
    const sw = top[1];
    expect(sw).toMatchObject({ total: 330, count: 3, avg: 110, largest: 120, recurring: true });
    expect(top[0].recurring).toBe(false);
    expect(sw.share).toBeCloseTo(330 / 1580, 5);
  });
  it("nets refunds within a merchant", () => {
    const shopping = applyFilters(e, { accounts: [], categories: ["Shopping"] }, "bank");
    expect(topMerchants(shopping, 5)[0]).toMatchObject({ merchant: "Big Tv", total: -50, count: 1, largest: 900 });
  });
  it("top single purchases ignore refunds", () => {
    const all = applyFilters(e, { accounts: [], categories: [] }, "bank");
    expect(topPurchases(all, 2).map((x) => x.amount)).toEqual([1200, 900]);
  });
});

describe("totals + kpis", () => {
  const f = applyFilters(e, { accounts: [], categories: [] }, "bank");
  it("totalsBy category", () => {
    const tt = totalsBy(f, "category", "bank");
    expect(tt[0]).toMatchObject({ name: "Groceries", total: 1580, count: 5 });
  });
  it("kpis per month", () => {
    const k = kpis(f, "2026-01-01", "2026-04-30");
    expect(k.total).toBe(1530);
    expect(k.months).toBe(4);
    expect(k.perMonth).toBe(382.5);
  });
  it("prevRange is the equal-length preceding window", () => {
    expect(prevRange("2026-04-01", "2026-04-30")).toEqual({ from: "2026-03-02", to: "2026-03-31" });
  });
});
