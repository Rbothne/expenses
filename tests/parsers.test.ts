import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { cardFromFilename } from "../src/core/card";
import { detectFormat, headerSignature, parseFile } from "../src/core/parsers";
import { defaultRules } from "../src/core/rules";
import type { Rules } from "../src/core/types";

const fx = (n: string) => readFileSync(join(__dirname, "fixtures", n), "utf8");
const rules = defaultRules();

describe("cardFromFilename", () => {
  it("reads Chase last-4 from download name", () => {
    expect(cardFromFilename("Chase1234_Activity20241124.CSV")).toBe("1234");
  });
  it("ignores date-only digits", () => {
    expect(cardFromFilename("Discover-Last12Months-20261124.csv")).toBeNull();
    expect(cardFromFilename("activity.csv")).toBeNull();
  });
});

describe("detectFormat", () => {
  it("recognizes each bank header", () => {
    expect(detectFormat(["Transaction Date", "Post Date", "Description", "Category", "Type", "Amount", "Memo"])).toBe("chase");
    expect(detectFormat(["Transaction Date", "Posted Date", "Card No.", "Description", "Category", "Debit", "Credit"])).toBe("capitalone");
    expect(detectFormat(["Trans. Date", "Post Date", "Description", "Amount", "Category"])).toBe("discover");
    expect(detectFormat(["Date", "Description", "Amount"])).toBe("amex");
    expect(detectFormat(["Date", "Status", "Type", "CheckNumber", "Description", "Withdrawal", "Deposit", "RunningBalance"])).toBe("schwab");
    expect(detectFormat(["Date", "Type", "Check #", "Description", "Withdrawal (-)", "Deposit (+)", "RunningBalance"])).toBe("schwab");
  });
  it("returns null for unknown", () => {
    expect(detectFormat(["Booking", "Text", "Value"])).toBeNull();
  });
});

describe("Chase", () => {
  const r = parseFile("Chase1234_Activity20261124.CSV", fx("Chase1234_Activity20261124.CSV"), rules);
  it("parses with BOM and trailing blank line, card from filename", () => {
    expect(r.format).toBe("chase");
    expect(r.account).toBe("chase");
    expect(r.rows).toHaveLength(6);
    expect(r.rows.every((x) => x.cardKey === "1234")).toBe(true);
    expect(r.cardDetected).toBe(true);
  });
  it("flips sign so charges are positive and keeps quoted commas", () => {
    expect(r.rows[0]).toMatchObject({ date: "2026-11-20", postDate: "2026-11-21", amount: 84.12, kind: "purchase", issuerCategory: "Groceries" });
    expect(r.rows[1].rawDescription).toBe("STARBUCKS STORE 1234, SEATTLE");
  });
  it("classifies payment, return and interest", () => {
    expect(r.rows[3]).toMatchObject({ amount: -512.33, kind: "payment" });
    expect(r.rows[4]).toMatchObject({ amount: -23.99, kind: "refund" });
    expect(r.rows[5]).toMatchObject({ amount: 3.1, kind: "interest" });
  });
});

describe("Amex", () => {
  const r = parseFile("activity.csv", fx("activity.csv"), rules);
  it("parses extended export with card members", () => {
    expect(r.format).toBe("amex");
    expect(r.rows).toHaveLength(4);
    expect(r.rows[0]).toMatchObject({ amount: 5.75, kind: "purchase", cardKey: "61005:JANE DOE", cardMember: "JANE DOE", issuerCategory: "Restaurant-Bar & Café" });
    expect(r.rows[1]).toMatchObject({ amount: 1204.88, cardKey: "62003:JOHN DOE" });
    expect(r.rows[2].kind).toBe("payment");
    expect(r.rows[3]).toMatchObject({ amount: -120, kind: "refund" });
  });
});

describe("Capital One", () => {
  const r = parseFile("transaction_download.csv", fx("transaction_download.csv"), rules);
  it("uses debit/credit columns and card number", () => {
    expect(r.format).toBe("capitalone");
    expect(r.rows[0]).toMatchObject({ date: "2026-11-20", amount: 48.2, cardKey: "4821", kind: "purchase" });
    expect(r.rows[1].cardKey).toBe("7733");
    expect(r.rows[2]).toMatchObject({ amount: -250, kind: "payment" });
    expect(r.rows[3]).toMatchObject({ amount: -7.99, kind: "refund" });
  });
});

describe("Discover", () => {
  const r = parseFile("Discover-Last12Months-20261124.csv", fx("Discover-Last12Months-20261124.csv"), rules);
  it("parses and classifies", () => {
    expect(r.format).toBe("discover");
    expect(r.rows[0]).toMatchObject({ amount: 62.17, kind: "purchase", issuerCategory: "Supermarkets", cardKey: "primary" });
    expect(r.cardDetected).toBe(false);
    expect(r.rows[1].kind).toBe("payment");
    expect(r.rows[2].kind).toBe("other");
  });
  it("applies an explicit card and remembered default", () => {
    const r2 = parseFile("d.csv", fx("Discover-Last12Months-20261124.csv"), rules, { cardKey: "9999" });
    expect(r2.rows[0].cardKey).toBe("9999");
    const rr: Rules = { ...rules, defaultCards: { discover: "it" } };
    expect(parseFile("d.csv", fx("Discover-Last12Months-20261124.csv"), rr).rows[0].cardKey).toBe("it");
  });
});

describe("Schwab", () => {
  const r = parseFile("Schwab_Checking_Transactions_20261124.csv", fx("Schwab_Checking_Transactions_20261124.csv"), rules);
  it("skips preamble, pending and total rows; parses $ amounts", () => {
    expect(r.format).toBe("schwab");
    expect(r.rows).toHaveLength(5);
    expect(r.skipped).toBe(2);
  });
  it("marks card payoffs and internal transfers as transfer, keeps other outflows as spend", () => {
    expect(r.rows[0]).toMatchObject({ amount: 512.33, kind: "transfer" });
    expect(r.rows[1]).toMatchObject({ amount: 1900, kind: "transfer" });
    expect(r.rows[2]).toMatchObject({ amount: 40, kind: "purchase" });
    expect(r.rows[3]).toMatchObject({ amount: -4500, kind: "deposit" });
    expect(r.rows[4]).toMatchObject({ amount: 1000, kind: "transfer" });
  });
});

describe("unknown + generic mapping", () => {
  const text = "Booking,Text,Value\n2026-11-01,Corner Shop,-12.50\n2026-11-02,Refund Corner Shop,3.00\n";
  it("reports unknown header", () => {
    const r = parseFile("x.csv", text, rules);
    expect(r.format).toBeNull();
    expect(r.header).toEqual(["Booking", "Text", "Value"]);
    expect(r.rows).toHaveLength(0);
  });
  it("parses with a saved mapping keyed by header signature", () => {
    const rr: Rules = {
      ...rules,
      columnMappings: [{ signature: headerSignature(["Booking", "Text", "Value"]), label: "My CU", account: "mycu", date: "Booking", description: "Text", amount: "Value", sign: "out-negative" }],
    };
    const r = parseFile("x.csv", text, rr);
    expect(r.format).toBe(`generic:${headerSignature(["Booking", "Text", "Value"])}`);
    expect(r.account).toBe("mycu");
    expect(r.rows[0]).toMatchObject({ amount: 12.5, kind: "purchase" });
    expect(r.rows[1]).toMatchObject({ amount: -3, kind: "refund" });
  });
  it("forcing a format overrides detection", () => {
    const r = parseFile("x.csv", "Date,Description,Amount\n11/01/2026,THING,5.00\n", rules, { format: "discover" });
    expect(r.format).toBe("discover");
  });
});
