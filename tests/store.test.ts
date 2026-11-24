import { describe, expect, it } from "vitest";
import { defaultRules } from "../src/core/rules";
import { emptyLedger, makeBackup, readBackup } from "../src/storage/store";

describe("backup", () => {
  it("round-trips and fills missing rule fields", () => {
    const s = { ledger: emptyLedger(), rules: defaultRules() };
    const text = JSON.stringify(makeBackup(s));
    expect(readBackup(text).rules.categories).toEqual(s.rules.categories);
    const partial = JSON.stringify({ app: "expenses", version: 1, ledger: { txns: [], imports: [] }, rules: { aliases: [{ pattern: "X", merchant: "Y" }] } });
    const r = readBackup(partial);
    expect(r.rules.aliases).toHaveLength(1);
    expect(r.rules.transferPatterns.length).toBeGreaterThan(0);
  });
  it("rejects foreign JSON", () => {
    expect(() => readBackup(JSON.stringify({ hello: 1 }))).toThrow(/Not an Expenses backup/);
  });
});
