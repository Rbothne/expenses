import { describe, expect, it } from "vitest";
import { rangeFor } from "../src/core/range";

describe("rangeFor", () => {
  const anchor = "2026-11-20";
  it("trailing months end on the anchor month and start on a month boundary", () => {
    expect(rangeFor("12m", anchor, "2020-01-01")).toEqual({ from: "2025-12-01", to: "2026-11-30" });
    expect(rangeFor("24m", anchor, "2020-01-01")).toEqual({ from: "2024-12-01", to: "2026-11-30" });
  });
  it("ytd and all", () => {
    expect(rangeFor("ytd", anchor, "2020-01-01")).toEqual({ from: "2026-01-01", to: "2026-11-30" });
    expect(rangeFor("all", anchor, "2023-03-14")).toEqual({ from: "2023-03-01", to: "2026-11-30" });
  });
  it("custom passes through", () => {
    expect(rangeFor("custom", anchor, "2020-01-01", { from: "2025-02-02", to: "2025-03-03" })).toEqual({ from: "2025-02-02", to: "2025-03-03" });
  });
  it("handles February end", () => {
    expect(rangeFor("12m", "2028-02-10", "2020-01-01").to).toBe("2028-02-29");
  });
});
