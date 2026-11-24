import { describe, expect, it } from "vitest";
import { enrich } from "../src/core/aggregate";
import { cardFromFilename } from "../src/core/card";
import { classifyKind } from "../src/core/classify";
import { mergeRows } from "../src/core/dedup";
import { parseFile } from "../src/core/parsers";
import { applyRename, defaultRules } from "../src/core/rules";
import { normalizeMerchant } from "../src/core/merchant";
import { serial } from "../src/storage/serial";
import { seedFolder } from "../src/storage/store";
import type { ParsedRow, Rules, Txn } from "../src/core/types";

const rules = defaultRules();
const row = (o: Partial<ParsedRow>): ParsedRow => ({ account: "discover", cardKey: "primary", cardAssumed: true, date: "2026-11-01", amount: 20, rawDescription: "SHOP", kind: "purchase", ...o });

describe("C1: dedup tolerates assumed card keys", () => {
  it("Discover imported as primary, later with a typed card: nothing re-added", () => {
    const a = mergeRows([], [row({}), row({ amount: 5 })], "i1");
    const b = mergeRows(a.txns, [row({ cardKey: "9876" }), row({ cardKey: "9876", amount: 5 }), row({ cardKey: "9876", amount: 7 })], "i2");
    expect(b.added).toBe(1);
  });
  it("Amex without details (assumed) then with details (from file): nothing re-added", () => {
    const a = mergeRows([], [row({ account: "amex" })], "i1");
    const b = mergeRows(a.txns, [row({ account: "amex", cardKey: "41007:JANE", cardAssumed: false })], "i2");
    expect(b.added).toBe(0);
  });
  it("two cards both read from the file are still distinct", () => {
    const a = mergeRows([], [row({ account: "capitalone", cardKey: "1111", cardAssumed: false })], "i1");
    const b = mergeRows(a.txns, [row({ account: "capitalone", cardKey: "2222", cardAssumed: false })], "i2");
    expect(b.added).toBe(1);
  });
  it("ids stay unique when an earlier copy was removed", () => {
    const a = mergeRows([], [row({}), row({})], "i1");
    const kept = a.txns.slice(1); // simulate undo of one
    const b = mergeRows(kept, [row({}), row({})], "i2");
    expect(new Set(b.txns.map((t) => t.id)).size).toBe(b.txns.length);
  });
  it("parser marks fallback cards as assumed and file cards as not", () => {
    const d = parseFile("d.csv", "Trans. Date,Post Date,Description,Amount,Category\n11/01/2026,11/01/2026,X,5,Merchandise\n", rules);
    expect(d.rows[0].cardAssumed).toBe(true);
    const c = parseFile("c.csv", "Transaction Date,Posted Date,Card No.,Description,Category,Debit,Credit\n2026-11-01,2026-11-02,4821,X,Merchandise,5,\n", rules);
    expect(c.rows[0].cardAssumed).toBe(false);
  });
  it("filename x-digits need a word boundary", () => {
    expect(cardFromFilename("Amex 2024.csv")).toBeNull();
    expect(cardFromFilename("card x1234.csv")).toBe("1234");
  });
});

let n = 0;
const txn = (o: Partial<Txn>): Txn => ({ id: `t${n++}#0`, importId: "i", account: "discover", cardKey: "primary", date: "2026-11-01", amount: 50, rawDescription: "TARGET 00012345", kind: "purchase", ...o });

describe("I2: refunds net against the merchant's purchase category", () => {
  it("Discover refund labelled Payments and Credits goes to the purchase category", () => {
    const e = enrich([txn({ issuerCategory: "Merchandise" }), txn({ amount: -60, kind: "refund", issuerCategory: "Payments and Credits", rawDescription: "TARGET 00012345 RETURN" })], rules);
    expect(e[1].kind).toBe("refund");
    expect(e[1].category).toBe("Shopping");
  });
});

describe("I3 + payment patterns", () => {
  const credit = (d: string) => classifyKind({ date: "2026-11-01", amount: -10, rawDescription: d }, "card", rules);
  it("Discover DIRECTPAY is a payment", () => expect(credit("DIRECTPAY FULL BALANCE SEE DETAILS OF YOUR NEXT DIRECTPAY BELOW")).toBe("payment"));
  it("merchant names containing PAYMENT are refunds", () => {
    expect(credit("AMAZON PAYMENTS REFUND")).toBe("refund");
    expect(credit("PAYMENTUS UTILITY")).toBe("refund");
    expect(credit("SQ *PAYMENT CAFE")).toBe("refund");
  });
  it("real payment phrasing still a payment", () => {
    for (const d of ["AUTOPAY PAYMENT - THANK YOU", "INTERNET PAYMENT - THANK YOU", "CAPITAL ONE AUTOPAY PYMT", "MOBILE PAYMENT - THANK YOU", "ONLINE PAYMENT", "PAYMENT RECEIVED - THANK YOU", "AMEX EPAYMENT"]) expect(credit(d)).toBe("payment");
  });
  it("payment reversal on a card is not spending", () => {
    expect(classifyKind({ date: "2026-11-01", amount: 500, rawDescription: "PAYMENT REVERSAL", typeHint: "payment" }, "card", rules)).toBe("payment");
    expect(classifyKind({ date: "2026-11-01", amount: 500, rawDescription: "RETURNED PAYMENT" }, "card", rules)).toBe("payment");
    expect(classifyKind({ date: "2026-11-01", amount: 29, rawDescription: "RETURNED PAYMENT FEE" }, "card", rules)).toBe("fee");
  });
});

describe("I4: mapped bank accounts classify as bank", () => {
  it("a mapped checking account treats payoffs as transfers and paychecks as deposits", () => {
    const sig = "date|desc|amt";
    const r: Rules = { ...rules, columnMappings: [{ signature: sig, label: "Schwab Checking", account: "schwab-checking", accountType: "bank", date: "Date", description: "Desc", amount: "Amt", sign: "out-negative" }] };
    const p = parseFile("x.csv", "Date,Desc,Amt\n11/01/2026,CHASE CREDIT CRD AUTOPAY,-500\n11/02/2026,PAYROLL,3000\n", r);
    const e = enrich(p.rows.map((x, i) => ({ ...x, id: `m${i}#0`, importId: "i" })), r);
    expect(e.map((x) => x.kind)).toEqual(["transfer", "deposit"]);
  });
});

describe("I5: seeding a newly picked folder", () => {
  const fakeStore = (has: { ledger?: boolean; rules?: boolean }) => {
    const writes: string[] = [];
    return {
      writes,
      store: {
        hasFiles: async () => !!(has.ledger || has.rules),
        update: async (fn: (s: unknown) => unknown) => {
          writes.push("update");
          return fn({});
        },
      },
    };
  };
  const current = { ledger: { version: 1 as const, txns: [txn({})], imports: [] }, rules };
  it("copies the current snapshot into an empty folder", async () => {
    const f = fakeStore({});
    await seedFolder(f.store as never, current);
    expect(f.writes).toEqual(["update"]);
  });
  it("never overwrites a folder that already has rules or a ledger", async () => {
    const f = fakeStore({ rules: true });
    await seedFolder(f.store as never, current);
    expect(f.writes).toEqual([]);
  });
});

describe("I7: renaming a merged merchant keeps the group together", () => {
  it("rename after merge", () => {
    let r = applyRename(rules, "Safeway Seattle", "Safeway");
    r = applyRename(r, "Safeway", "Safeway Inc");
    expect(normalizeMerchant("SAFEWAY #1234 SEATTLE WA", r)).toBe("Safeway Inc");
    expect(normalizeMerchant("SAFEWAY SEATTLE WA", r)).toBe("Safeway Inc");
  });
  it("moves the merchant category with the rename", () => {
    const r = applyRename({ ...rules, merchantCategories: { Safeway: "Groceries" } }, "Safeway", "Safeway Inc");
    expect(r.merchantCategories).toEqual({ "Safeway Inc": "Groceries" });
  });
});

describe("serial: overlapping updates both apply", () => {
  it("queues writes", async () => {
    let state = 0;
    const run = serial();
    const bump = () =>
      run(async () => {
        const read = state;
        await new Promise((r) => setTimeout(r, 5));
        state = read + 1;
      });
    await Promise.all([bump(), bump(), bump()]);
    expect(state).toBe(3);
  });
});
