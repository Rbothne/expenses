import { describe, expect, it } from "vitest";
import { mapIssuerCategory, resolveCategory } from "../src/core/categories";
import { defaultRules } from "../src/core/rules";
import type { Rules, Txn } from "../src/core/types";

const rules = defaultRules();
const txn = (o: Partial<Txn>): Txn => ({
  id: "a#0",
  importId: "i",
  account: "chase",
  cardKey: "1234",
  date: "2026-11-01",
  amount: 10,
  rawDescription: "SOMEWHERE",
  kind: "purchase",
  ...o,
});

describe("mapIssuerCategory", () => {
  it("maps each bank's vocabulary", () => {
    expect(mapIssuerCategory("discover", "Supermarkets", rules)).toBe("Groceries");
    expect(mapIssuerCategory("amex", "Restaurant-Bar & Café", rules)).toBe("Dining");
    expect(mapIssuerCategory("amex", "Merchandise & Supplies-Groceries", rules)).toBe("Groceries");
    expect(mapIssuerCategory("amex", "Transportation-Fuel", rules)).toBe("Gas & Auto");
    expect(mapIssuerCategory("chase", "Food & Drink", rules)).toBe("Dining");
    expect(mapIssuerCategory("chase", "Bills & Utilities", rules)).toBe("Utilities & Bills");
    expect(mapIssuerCategory("capitalone", "Dining", rules)).toBe("Dining");
    expect(mapIssuerCategory("capitalone", "Gas/Automotive", rules)).toBe("Gas & Auto");
    expect(mapIssuerCategory("discover", "Restaurants", rules)).toBe("Dining");
    expect(mapIssuerCategory("discover", "Travel/ Entertainment", rules)).toBe("Travel");
  });
  it("returns null when unknown", () => {
    expect(mapIssuerCategory("chase", "Zzz", rules)).toBeNull();
    expect(mapIssuerCategory("chase", undefined, rules)).toBeNull();
  });
  it("user issuer map wins", () => {
    const r: Rules = { ...rules, issuerCategoryMap: { "chase:food & drink": "Groceries" } };
    expect(mapIssuerCategory("chase", "Food & Drink", r)).toBe("Groceries");
  });
});

describe("resolveCategory precedence", () => {
  const t = txn({ rawDescription: "NETFLIX.COM", issuerCategory: "Food & Drink" });
  it("issuer category when nothing else", () => {
    expect(resolveCategory(txn({ issuerCategory: "Food & Drink" }), rules)).toBe("Dining");
  });
  it("built-in merchant category beats issuer", () => {
    expect(resolveCategory(t, rules)).toBe("Subscriptions & Digital");
  });
  it("description rule beats built-in merchant category", () => {
    const r: Rules = { ...rules, descriptionRules: [{ pattern: "NETFLIX", category: "Entertainment" }] };
    expect(resolveCategory(t, r)).toBe("Entertainment");
  });
  it("merchant rule beats description rule", () => {
    const r: Rules = { ...rules, descriptionRules: [{ pattern: "NETFLIX", category: "Entertainment" }], merchantCategories: { Netflix: "Home" } };
    expect(resolveCategory(t, r)).toBe("Home");
  });
  it("override beats everything", () => {
    const r: Rules = { ...rules, merchantCategories: { Netflix: "Home" }, overrides: { "a#0": "Gifts & Donations" } };
    expect(resolveCategory(t, r)).toBe("Gifts & Donations");
  });
  it("fees and interest go to Fees & Interest", () => {
    expect(resolveCategory(txn({ kind: "interest", issuerCategory: "Food & Drink" }), rules)).toBe("Fees & Interest");
  });
  it("falls back to Other", () => {
    expect(resolveCategory(txn({}), rules)).toBe("Other");
  });
});
