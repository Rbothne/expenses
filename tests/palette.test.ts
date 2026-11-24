import { describe, expect, it } from "vitest";
import { foldSeries, OTHER_LABEL } from "../src/ui/palette";

const mk = (names: string[]) => ({ buckets: ["a", "b"], series: names.map((n, i) => ({ name: n, values: [i, 1], total: i + 1 })) });
const order = ["A", "B", "C", "D", "E", "F", "G", "H", "I", "J"];

describe("foldSeries", () => {
  it("keeps all-time slots when filtered subset fits", () => {
    const r = foldSeries(mk(["C", "A"]), order);
    expect(r.map((x) => [x.name, x.slot])).toEqual([["A", 0], ["C", 2]]);
  });
  it("folds beyond 8 into Everything else, summing values", () => {
    const r = foldSeries(mk(order), order);
    expect(r).toHaveLength(8);
    expect(r[7].name).toBe(OTHER_LABEL);
    expect(r[7].slot).toBe(-1);
    expect(r[7].values).toEqual([7 + 8 + 9, 3]);
  });
  it("assigns by visible order when selected entities are outside top slots", () => {
    const r = foldSeries(mk(["J", "I"]), order);
    expect(r.map((x) => [x.name, x.slot])).toEqual([["I", 0], ["J", 1]]);
  });
});
