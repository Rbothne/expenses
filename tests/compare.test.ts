import { describe, expect, it } from "vitest";
import { enrich, type EnrichedTxn } from "../src/core/aggregate";
import { comparisonRange, coverageGaps, deltas, insights, priceChanges, yearly, type Insight } from "../src/core/compare";
import { defaultRules } from "../src/core/rules";
import type { Txn } from "../src/core/types";

const rules = defaultRules();
let n = 0;
const t = (date: string, amount: number, desc: string, o: Partial<Txn> = {}): Txn => ({
  id: `c${n++}#0`,
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
const spend = (txns: Txn[]): EnrichedTxn[] => enrich(txns, rules).filter((x) => x.isSpend);

describe("comparisonRange", () => {
  it("year over year shifts both ends 12 months, clamping to month end", () => {
    expect(comparisonRange({ from: "2026-01-01", to: "2026-11-30" }, "yoy")).toEqual({ from: "2025-01-01", to: "2025-11-30" });
    expect(comparisonRange({ from: "2024-02-01", to: "2024-02-29" }, "yoy")).toEqual({ from: "2023-02-01", to: "2023-02-28" });
  });
  it("previous period of whole months is the same number of whole months before", () => {
    expect(comparisonRange({ from: "2026-02-01", to: "2026-02-28" }, "prev")).toEqual({ from: "2026-01-01", to: "2026-01-31" });
    expect(comparisonRange({ from: "2025-12-01", to: "2026-11-30" }, "prev")).toEqual({ from: "2024-12-01", to: "2025-11-30" });
  });
  it("previous period of arbitrary days is the same number of days before", () => {
    expect(comparisonRange({ from: "2026-03-10", to: "2026-03-19" }, "prev")).toEqual({ from: "2026-02-28", to: "2026-03-09" });
  });
});

describe("deltas", () => {
  const cur = spend([t("2026-03-01", 300, "SAFEWAY #1"), t("2026-03-02", 80, "NEW PLACE", { issuerCategory: "Food & Drink" })]);
  const prev = spend([t("2025-03-01", 200, "SAFEWAY #1"), t("2025-03-02", 10, "TINY THING", { issuerCategory: "Food & Drink" })]);
  const d = deltas(cur, prev, (x) => x.category);
  it("dollar and percent change, biggest absolute change first", () => {
    expect(d[0]).toMatchObject({ key: "Groceries", cur: 300, prev: 200, delta: 100, pct: 0.5 });
    expect(d[1]).toMatchObject({ key: "Dining", cur: 80, prev: 10, delta: 70 });
  });
  it("no percent when the earlier amount is too small to be meaningful", () => {
    expect(d[1].pct).toBeNull();
  });
  it("keys present on only one side get a zero on the other", () => {
    const m = deltas(cur, prev, (x) => x.merchant);
    expect(m.find((x) => x.key === "Tiny Thing")).toMatchObject({ cur: 0, prev: 10, delta: -10 });
  });
});

describe("coverageGaps", () => {
  it("flags accounts whose history starts after the period begins (or ends before it ends)", () => {
    const all = enrich(
      [
        t("2024-01-03", 10, "SAFEWAY #1"),
        t("2026-11-20", 10, "SAFEWAY #1"),
        t("2026-02-15", 10, "X", { account: "amex", cardKey: "1" }),
        t("2026-11-02", 10, "X", { account: "amex", cardKey: "1" }),
      ],
      rules,
    );
    const g = coverageGaps(all, { from: "2025-01-01", to: "2025-11-30" });
    expect(g).toEqual([{ account: "amex", first: "2026-02-15", last: "2026-11-02", holes: [] }]);
    expect(coverageGaps(all, { from: "2026-03-01", to: "2026-10-31" })).toEqual([]);
  });
});

describe("priceChanges", () => {
  it("finds a recurring charge whose usual amount moved", () => {
    const rows = [
      ...["2025-01-10", "2025-02-10", "2025-03-10"].map((d) => t(d, 15.49, "NETFLIX.COM", { issuerCategory: undefined })),
      ...["2026-01-10", "2026-02-10", "2026-03-10"].map((d) => t(d, 17.99, "NETFLIX.COM", { issuerCategory: undefined })),
      ...["2025-01-05", "2025-02-07", "2025-03-01", "2026-01-05", "2026-02-07", "2026-03-02"].map((d, i) => t(d, 40 + i * 13, "SAFEWAY #1")),
    ];
    const e = spend(rows);
    const pc = priceChanges(
      e.filter((x) => x.date >= "2026-01-01"),
      e.filter((x) => x.date < "2026-01-01"),
    );
    expect(pc).toHaveLength(1);
    expect(pc[0]).toMatchObject({ merchant: "Netflix", before: 15.49, after: 17.99 });
    expect(pc[0].pct).toBeCloseTo(0.1614, 3);
  });
});

describe("insights", () => {
  const rows = [
    // groceries up, driven by Costco
    t("2025-05-01", 400, "SAFEWAY #1"),
    t("2026-05-01", 410, "SAFEWAY #1"),
    t("2026-05-03", 600, "COSTCO WHSE #1"),
    // a subscription that stopped (recurring in the earlier period)
    ...["2025-02-03", "2025-03-03", "2025-04-03", "2025-05-03"].map((d) => t(d, 11.99, "HULU 877", { issuerCategory: undefined })),
    // dining down
    t("2025-06-01", 500, "FANCY BISTRO", { issuerCategory: "Food & Drink" }),
    t("2026-06-01", 120, "FANCY BISTRO", { issuerCategory: "Food & Drink" }),
  ];
  const e = spend(rows);
  const cur = e.filter((x) => x.date >= "2026-01-01");
  const prev = e.filter((x) => x.date < "2026-01-01");
  const ins = insights(cur, prev);

  it("category movers name the merchant that drove the change", () => {
    const g = ins.find((i) => i.type === "category" && i.key === "Groceries")!;
    expect(g).toMatchObject({ delta: 610, driver: { key: "Costco", delta: 600 } });
    const d = ins.find((i) => i.type === "category" && i.key === "Dining") as Extract<Insight, { type: "category" }>;
    expect(d.delta).toBe(-380);
  });
  it("new merchants and stopped recurring charges", () => {
    expect(ins.find((i) => i.type === "new" && i.key === "Costco")).toBeTruthy();
    const gone = ins.find((i) => i.type === "gone" && i.key === "Hulu") as Extract<Insight, { type: "gone" }>;
    expect(gone.prev).toBeCloseTo(47.96, 2);
  });
  it("ignores changes too small to matter", () => {
    expect(ins.find((i) => i.type === "merchant" && i.key === "Safeway")).toBeUndefined();
  });
});

describe("yearly", () => {
  const e = spend([
    t("2024-07-01", 100, "SAFEWAY #1"),
    t("2025-03-01", 200, "SAFEWAY #1"),
    t("2025-10-01", 999, "SAFEWAY #1"),
    t("2026-03-01", 260, "SAFEWAY #1"),
  ]);
  const y = yearly(e, "2024-07-01", "2026-11-20");
  it("calendar years with partial years marked", () => {
    expect(y.years.map((r) => [r.year, r.partial])).toEqual([
      [2024, true],
      [2025, false],
      [2026, true],
    ]);
    expect(y.rows.find((r) => r.key === "Groceries")!.values).toEqual([100, 1199, 260]);
  });
  it("latest year compares to the same stretch of the year before (YTD)", () => {
    expect(y.ytd).toEqual({ through: "2026-11-20", from: "2025-01-01", to: "2025-11-20" });
    const g = y.rows.find((r) => r.key === "Groceries")!;
    expect(g.ytdPrev).toBe(1199);
    expect(g.ytdPct).toBeCloseTo(260 / 1199 - 1, 5);
  });
});

describe("insights materiality", () => {
  it("a big percentage move in a mid-size category shows even when rent makes the total large", () => {
    const rows = [
      t("2025-01-01", 30000, "OAK APARTMENTS RENT", { account: "schwab", cardKey: "primary", issuerCategory: undefined }),
      t("2026-01-01", 30000, "OAK APARTMENTS RENT", { account: "schwab", cardKey: "primary", issuerCategory: undefined }),
      t("2025-02-01", 1200, "LOCAL BISTRO", { issuerCategory: "Food & Drink" }),
      t("2026-02-01", 1800, "LOCAL BISTRO", { issuerCategory: "Food & Drink" }),
      t("2025-02-03", 300, "SAFEWAY #1"),
      t("2026-02-03", 330, "SAFEWAY #1"),
    ];
    const e = spend(rows);
    const ins = insights(e.filter((x) => x.date >= "2026-01-01"), e.filter((x) => x.date < "2026-01-01"));
    expect(ins.find((i) => i.type === "category" && i.key === "Dining")).toBeTruthy(); // +$600, +50%
    expect(ins.find((i) => i.type === "category" && i.key === "Groceries")).toBeUndefined(); // +$30, +10%
  });
});
