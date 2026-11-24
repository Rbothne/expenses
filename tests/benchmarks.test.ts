import { describe, expect, it } from "vitest";
import { enrich } from "../src/core/aggregate";
import { compareToGroup, countryShares, cpiFactor, defaultGroupId, getGroup, guideline } from "../src/core/benchmarks";
import data from "../src/data/benchmarks.json";
import { defaultRules } from "../src/core/rules";
import type { Txn } from "../src/core/types";

describe("dataset sanity", () => {
  it("every group's food = food at home + food away (within $2 rounding)", () => {
    for (const g of data.ce.groups) {
      const v = g.values as Record<string, number>;
      if (v.food != null && v.foodHome != null && v.foodAway != null) expect(Math.abs(v.food - v.foodHome - v.foodAway)).toBeLessThanOrEqual(2);
    }
  });
  it("every mapped line exists in the national table", () => {
    const lines = Object.keys(data.ce.lines);
    for (const m of Object.values(data.mapping)) for (const l of m.lines) expect(lines).toContain(l);
  });
  it("every guideline has a source URL and a quote", () => {
    for (const g of data.guidelines) {
      expect(g.url).toMatch(/^https:\/\//);
      expect(g.quote.length).toBeGreaterThan(20);
    }
  });
});

describe("cpiFactor", () => {
  it("scales a 2025 survey figure to 2024 dollars", () => {
    expect(cpiFactor({ from: "2024-01-01", to: "2024-12-31" }, "2025")).toBeCloseTo(313.689 / 321.943, 6);
  });
  it("two-year tables use the mean of both years as the base", () => {
    expect(cpiFactor({ from: "2025-01-01", to: "2025-12-31" }, "2023-2024")).toBeCloseTo(321.943 / ((304.702 + 313.689) / 2), 6);
  });
  it("months in a year without an annual average use the latest month", () => {
    // Dec 2025 – Nov 2026: 1 month at the 2025 average, 11 at the latest monthly value
    const f = cpiFactor({ from: "2025-12-01", to: "2026-11-30" }, "2025");
    expect(f).toBeCloseTo((321.943 * 1 + 337.511 * 11) / 12 / 321.943, 6);
  });
});

describe("groups", () => {
  it("defaults to the household-size group, else all households", () => {
    expect(defaultGroupId({ householdSize: 2 })).toBe("size-2");
    expect(defaultGroupId({ householdSize: 7 })).toBe("size-5plus");
    expect(defaultGroupId({})).toBe("all");
    expect(defaultGroupId({ householdSize: 2, benchmarkGroup: "msa-seattle" })).toBe("msa-seattle");
    expect(getGroup("nope")).toBeUndefined();
  });
});

describe("guideline", () => {
  it("percent thresholds become fractions; ranges keep both ends", () => {
    expect(guideline("hud-cost-burden")).toMatchObject({ lo: 0.3, hi: 0.3, source: expect.stringContaining("HUD") });
    expect(guideline("emergency-fund")).toMatchObject({ lo: 3, hi: 6 });
    expect(guideline("missing")).toBeUndefined();
  });
});

let n = 0;
const t = (date: string, amount: number, desc: string, o: Partial<Txn> = {}): Txn => ({
  id: `b${n++}#0`,
  importId: "i",
  account: "chase",
  cardKey: "1",
  date,
  amount,
  rawDescription: desc,
  kind: "purchase",
  issuerCategory: "Groceries",
  ...o,
});

describe("compareToGroup", () => {
  const rules = defaultRules();
  const rows = enrich(
    [
      ...Array.from({ length: 12 }, (_, i) => t(`2025-${String(i + 1).padStart(2, "0")}-05`, 500, "SAFEWAY #1")),
      t("2025-06-01", 1200, "BIG TV STORE", { issuerCategory: "Shopping" }),
      ...Array.from({ length: 12 }, (_, i) => t(`2025-${String(i + 1).padStart(2, "0")}-01`, 2000, "OAK APARTMENTS RENT", { account: "schwab", cardKey: "primary", issuerCategory: undefined })),
    ],
    rules,
  ).filter((x) => x.isSpend);
  const r = compareToGroup(rows, { from: "2025-01-01", to: "2025-12-31" }, "size-1", "rent");
  it("comparable categories get you-vs-them in the same year's dollars", () => {
    const g = r.rows.find((x) => x.category === "Groceries")!;
    const size1 = data.ce.groups.find((x) => x.id === "size-1")!.values.foodHome;
    expect(g).toMatchObject({ you: 6000, comparable: true });
    expect(g.them).toBeCloseTo(size1, 0); // survey year = spending year, factor 1
    expect(g.delta).toBeCloseTo(6000 - size1, 0);
  });
  it("rent compares against renters, not the owner-diluted average", () => {
    const h = r.rows.find((x) => x.category === "Housing")!;
    expect(h.them).toBe(data.ce.groups.find((x) => x.id === "tenure-renter")!.values.rentedDwellings);
    expect(h.groupNote).toMatch(/renter/i);
  });
  it("non-comparable categories carry context lines but no comparison", () => {
    const s = r.rows.find((x) => x.category === "Shopping")!;
    expect(s.comparable).toBe(false);
    expect(s.them).toBeNull();
    expect(s.context.length).toBeGreaterThan(0);
  });
  it("short windows are scaled to a year and flagged", () => {
    const half = compareToGroup(rows, { from: "2025-01-01", to: "2025-06-30" }, "size-1", "rent");
    expect(half.annualized).toBe(true);
    expect(half.rows.find((x) => x.category === "Groceries")!.you).toBe(6000);
  });
  it("MSA tables without a line skip that comparison instead of inventing one", () => {
    const m = compareToGroup(rows, { from: "2025-01-01", to: "2025-12-31" }, "msa-seattle", "rent");
    const h = m.rows.find((x) => x.category === "Health")!;
    expect(h.them).toBeNull();
    expect(h.missing).toBe(true);
  });
});

describe("countryShares", () => {
  it("his share of spending per broad group next to a country's", () => {
    const rules = defaultRules();
    const rows = enrich([t("2025-01-01", 300, "SAFEWAY #1"), t("2025-01-02", 700, "FANCY BISTRO", { issuerCategory: "Food & Drink" })], rules).filter((x) => x.isSpend);
    const s = countryShares(rows, "USA");
    const food = s.find((x) => x.group === "CP01")!;
    expect(food.you).toBeCloseTo(0.3, 5);
    expect(food.them).toBeCloseTo(0.069, 5);
  });
});
