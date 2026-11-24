import { CATEGORIES } from "./categories";
import type { Rules } from "./types";

export const DEFAULT_TRANSFER_PATTERNS = [
  "CHASE CREDIT CRD",
  "\\bCHASE\\b.*\\b(AUTOPAY|EPAY|PAYMENT)",
  "AMEX EPAYMENT",
  "AMERICAN EXPRESS",
  "CAPITAL ONE",
  "\\bDISCOVER\\b(?!Y)",
  "CRCARDPMT",
  "CREDIT ?CARD (PMT|PAYMENT)",
  "\\bCARD ?PMT\\b",
];

/** Phrasing banks use for your payment; deliberately not bare "PAYMENT", which hits merchants like "Amazon Payments". */
export const DEFAULT_PAYMENT_PATTERNS = [
  "THANK ?YOU",
  "AUTO ?PAY",
  "DIRECTPAY",
  "^(AUTOMATIC|ONLINE|MOBILE|INTERNET|ELECTRONIC|ACH|WEB|BILL) ?PA?YM(EN)?T",
  "^PAYMENT\\b",
  "\\bE-?PAYMENT",
  "ONLINE PMT",
  "MOBILE PMT",
  "\\bPYMT\\b",
];

/** Deposits mentioning these are never pay, even when they also say "PAYROLL" or "DIRECT DEPOSIT". */
export const NOT_INCOME = /REFUND|REIMB|REVERSAL|RETURN/i;

/** How paychecks show up in checking. Deliberately not bare "DEPOSIT" or "ACH", which also hit transfers and refunds. */
export const DEFAULT_INCOME_PATTERNS = ["PAYROLL", "\\bPAYRL\\b", "\\bDIR(ECT)? ?DEP", "DIRECT DEPOSIT", "\\bSALARY\\b", "\\bPAYCHECK\\b"];

/** 50/30/20 "needs": housing, food at home, utilities, insurance, health care, getting to work. */
export const DEFAULT_NEEDS = ["Housing", "Groceries", "Utilities & Bills", "Insurance", "Health", "Gas & Auto"];

/** Rename a merchant; works for merged groups (renames apply one hop, so every source is re-pointed). */
export function applyRename(r: Rules, name: string, to: string): Rules {
  to = to.trim();
  if (!to || to === name) return r;
  // Merging into a merchant that is itself renamed lands on its display name.
  if (r.renames[to] && r.renames[to] !== name) to = r.renames[to];
  const renames: Record<string, string> = {};
  for (const [k, v] of Object.entries(r.renames)) renames[k] = v === name ? to : v;
  renames[name] = to;
  for (const [k, v] of Object.entries(renames)) if (k === v) delete renames[k];
  const mc = { ...r.merchantCategories };
  if (mc[name] && !mc[to]) mc[to] = mc[name];
  delete mc[name];
  return { ...r, renames, merchantCategories: mc };
}

export function defaultRules(): Rules {
  return {
    version: 1,
    categories: [...CATEGORIES],
    aliases: [],
    renames: {},
    merchantCategories: {},
    descriptionRules: [],
    overrides: {},
    transferPatterns: [...DEFAULT_TRANSFER_PATTERNS],
    paymentPatterns: [...DEFAULT_PAYMENT_PATTERNS],
    issuerCategoryMap: {},
    columnMappings: [],
    cardNames: {},
    defaultCards: {},
    breakdownBy: "bank",
    incomePatterns: [...DEFAULT_INCOME_PATTERNS],
    needsCategories: [...DEFAULT_NEEDS],
    profile: {},
  };
}

/** Fill any fields missing from an older or hand-edited rules file. */
export function withDefaults(r: Partial<Rules> | undefined): Rules {
  const d = defaultRules();
  const out: Rules = { ...d, ...(r ?? {}), version: 1 };
  // Hand-edited files may hold null where a list belongs.
  for (const k of ["categories", "incomePatterns", "needsCategories", "transferPatterns", "paymentPatterns", "aliases", "descriptionRules", "columnMappings"] as const)
    if (!Array.isArray(out[k])) (out as unknown as Record<string, unknown>)[k] = d[k];
  // Files from before Housing and Loans existed (they also lack incomePatterns) gain them once; a later removal sticks.
  if (r && !Array.isArray(r.incomePatterns) && Array.isArray(r.categories)) {
    const cats = [...r.categories];
    if (!cats.includes("Housing")) cats.unshift("Housing");
    if (!cats.includes("Loans")) cats.splice(cats.includes("Other") ? cats.indexOf("Other") : cats.length, 0, "Loans");
    out.categories = cats;
  }
  out.profile = r?.profile && typeof r.profile === "object" ? { ...r.profile } : {};
  return out;
}
