import { describe, expect, it } from "vitest";
import { mergeRows, txnKey } from "../src/core/dedup";
import { normalizeMerchant } from "../src/core/merchant";
import { defaultRules } from "../src/core/rules";
import type { ParsedRow, Rules } from "../src/core/types";

const rules = defaultRules();

describe("normalizeMerchant", () => {
  const cases: [string, string][] = [
    ["SQ *BLUE BOTTLE COFFEE", "Blue Bottle Coffee"],
    ["TST* BLUE BOTTLE COFFEE", "Blue Bottle Coffee"],
    ["COSTCO WHSE #0482 SEATTLE WA", "Costco"],
    ["COSTCO GAS #0482", "Costco"],
    ["COSTCO WHOLESALE #482", "Costco"],
    ["AMZN Mktp US*2K4AB1C23", "Amazon"],
    ["AMAZON.COM*RT4YZ0AB2 AMZN.COM/BILL WA", "Amazon"],
    ["Amazon Prime*1A2B3C", "Amazon Prime"],
    ["UBER *EATS PENDING", "Uber Eats"],
    ["UBER *TRIP HELP.UBER.COM", "Uber"],
    ["NETFLIX.COM", "Netflix"],
    ["HULU 877-8244858", "Hulu"],
    ["SHELL OIL 57444", "Shell"],
    ["WHOLEFDS MKT #10234", "Whole Foods"],
    ["STARBUCKS STORE 1234, SEATTLE", "Starbucks"],
    ["SAFEWAY #1234 SEATTLE WA", "Safeway"],
    ["PAYPAL *STEAMGAMES", "Steamgames"],
    ["JOES PIZZA BROOKLYN NY", "Joes Pizza"],
    ["APPLE.COM/BILL 866-712-7753 CA", "Apple"],
  ];
  it.each(cases)("%s -> %s", (raw, want) => {
    expect(normalizeMerchant(raw, rules)).toBe(want);
  });
  it("user alias overrides built-ins", () => {
    const r: Rules = { ...rules, aliases: [{ pattern: "COSTCO GAS", merchant: "Costco Gas" }] };
    expect(normalizeMerchant("COSTCO GAS #0482", r)).toBe("Costco Gas");
    expect(normalizeMerchant("COSTCO WHSE #0482", r)).toBe("Costco");
  });
  it("renames apply after normalization (rename + merge)", () => {
    const r: Rules = { ...rules, renames: { Safeway: "Grocery Store", "Whole Foods": "Grocery Store" } };
    expect(normalizeMerchant("SAFEWAY #1234 SEATTLE WA", r)).toBe("Grocery Store");
    expect(normalizeMerchant("WHOLEFDS MKT #10234", r)).toBe("Grocery Store");
  });
  it("survives a broken user regex", () => {
    const r: Rules = { ...rules, aliases: [{ pattern: "([", merchant: "X" }] };
    expect(normalizeMerchant("NETFLIX.COM", r)).toBe("Netflix");
  });
  it("never returns empty", () => {
    expect(normalizeMerchant("#1234 5678", rules)).not.toBe("");
  });
});

const row = (o: Partial<ParsedRow>): ParsedRow => ({
  account: "chase",
  cardKey: "1234",
  date: "2026-11-18",
  amount: 6.45,
  rawDescription: "STARBUCKS",
  kind: "purchase",
  ...o,
});

describe("mergeRows", () => {
  it("re-importing the same rows adds nothing", () => {
    const rows = [row({}), row({ amount: 10 })];
    const a = mergeRows([], rows, "imp1");
    expect(a.added).toBe(2);
    const b = mergeRows(a.txns, rows, "imp2");
    expect(b.added).toBe(0);
    expect(b.skipped).toBe(2);
    expect(b.txns).toHaveLength(2);
  });
  it("keeps identical same-day charges within one file", () => {
    const a = mergeRows([], [row({}), row({})], "imp1");
    expect(a.added).toBe(2);
    expect(new Set(a.txns.map((t) => t.id)).size).toBe(2);
  });
  it("overlapping file with one extra repeat adds exactly one", () => {
    const a = mergeRows([], [row({})], "imp1");
    const b = mergeRows(a.txns, [row({}), row({}), row({ date: "2026-11-19" })], "imp2");
    expect(b.added).toBe(2);
    expect(b.txns).toHaveLength(3);
  });
  it("same charge on two different cards is not merged", () => {
    const a = mergeRows([], [row({ cardKey: "1111" }), row({ cardKey: "2222" })], "imp1");
    expect(a.added).toBe(2);
  });
  it("key ignores description case and spacing", () => {
    expect(txnKey(row({ rawDescription: " starbucks " }))).toBe(txnKey(row({ rawDescription: "STARBUCKS" })));
  });
  it("ids are stable across imports", () => {
    const a = mergeRows([], [row({})], "imp1");
    const b = mergeRows([], [row({})], "imp9");
    expect(a.txns[0].id).toBe(b.txns[0].id);
    expect(a.txns[0].importId).toBe("imp1");
  });
});
