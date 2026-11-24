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
  };
}

/** Fill any fields missing from an older or hand-edited rules file. */
export function withDefaults(r: Partial<Rules> | undefined): Rules {
  const d = defaultRules();
  return { ...d, ...(r ?? {}), version: 1 };
}
