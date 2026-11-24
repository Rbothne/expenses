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

export const DEFAULT_PAYMENT_PATTERNS = [
  "PAYMENT",
  "AUTOPAY",
  "THANK YOU",
  "\\bE-?PAYMENT",
  "ONLINE PMT",
  "MOBILE PMT",
  "\\bPYMT\\b",
];

export function defaultRules(): Rules {
  return {
    version: 1,
    categories: [...CATEGORIES],
    aliases: [],
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
  };
}

/** Fill any fields missing from an older or hand-edited rules file. */
export function withDefaults(r: Partial<Rules> | undefined): Rules {
  const d = defaultRules();
  return { ...d, ...(r ?? {}), version: 1 };
}
