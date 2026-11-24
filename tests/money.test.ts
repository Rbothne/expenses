import { describe, expect, it } from "vitest";
import { cents, parseAmount, parseDate } from "../src/core/money";

describe("parseAmount", () => {
  it("handles currency symbols and thousands separators", () => {
    expect(parseAmount("$1,234.56")).toBe(1234.56);
    expect(parseAmount("-45.10")).toBe(-45.1);
    expect(parseAmount(" 12 ")).toBe(12);
  });
  it("treats parentheses as negative", () => {
    expect(parseAmount("(12.00)")).toBe(-12);
    expect(parseAmount("$(1,000.00)")).toBe(-1000);
  });
  it("returns null for empty or junk", () => {
    expect(parseAmount("")).toBeNull();
    expect(parseAmount(undefined)).toBeNull();
    expect(parseAmount("abc")).toBeNull();
  });
});

describe("parseDate", () => {
  it("parses US and ISO formats to ISO", () => {
    expect(parseDate("01/05/2025")).toBe("2025-01-05");
    expect(parseDate("1/5/25")).toBe("2025-01-05");
    expect(parseDate("2025-01-05")).toBe("2025-01-05");
    expect(parseDate("12/31/2024 as of 01/02/2025")).toBe("2024-12-31");
  });
  it("rejects invalid dates", () => {
    expect(parseDate("13/45/2025")).toBeNull();
    expect(parseDate("")).toBeNull();
    expect(parseDate("Pending")).toBeNull();
  });
});

describe("cents", () => {
  it("rounds to cents", () => {
    expect(cents(0.1 + 0.2)).toBe(0.3);
    expect(cents(-1.005)).toBe(-1.01);
  });
});
