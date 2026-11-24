import Papa from "papaparse";

/** Parse CSV text into rows of trimmed cells. Strips a BOM and drops fully blank rows. */
export function readCsv(text: string): string[][] {
  const clean = text.replace(/^﻿/, "");
  const res = Papa.parse<string[]>(clean, { skipEmptyLines: "greedy" });
  return res.data.map((r) => r.map((c) => (c ?? "").trim())).filter((r) => r.some((c) => c !== ""));
}

export const normHeader = (h: string) => h.replace(/^﻿/, "").trim().toLowerCase().replace(/\s+/g, " ");
