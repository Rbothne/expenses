import { normalizeMerchant } from "./merchant";
import type { Rules, Txn } from "./types";

export const CATEGORIES = [
  "Housing",
  "Groceries",
  "Dining",
  "Gas & Auto",
  "Travel",
  "Shopping",
  "Subscriptions & Digital",
  "Utilities & Bills",
  "Health",
  "Home",
  "Entertainment",
  "Personal Care",
  "Insurance",
  "Education",
  "Gifts & Donations",
  "Fees & Interest",
  "Other",
] as const;

/** [account or "*", pattern on issuer category, canonical]. First match wins; specific before general. */
const ISSUER_MAP: [string, RegExp, string][] = [
  // Amex "Group-Subgroup"
  ["amex", /^restaurant/i, "Dining"],
  ["amex", /groceries|wholesale stores/i, "Groceries"],
  ["amex", /pharmac|health care/i, "Health"],
  ["amex", /hardware|furniture|home/i, "Home"],
  ["amex", /^transportation-(fuel|auto|parking|tolls)/i, "Gas & Auto"],
  ["amex", /^transportation|^travel/i, "Travel"],
  ["amex", /^entertainment/i, "Entertainment"],
  ["amex", /insurance/i, "Insurance"],
  ["amex", /^communications|internet services|utilities/i, "Utilities & Bills"],
  ["amex", /charit/i, "Gifts & Donations"],
  ["amex", /education/i, "Education"],
  ["amex", /^fees/i, "Fees & Interest"],
  ["amex", /^merchandise/i, "Shopping"],
  // Chase
  ["chase", /^groceries$/i, "Groceries"],
  ["chase", /^food & drink$/i, "Dining"],
  ["chase", /^(gas|automotive)$/i, "Gas & Auto"],
  ["chase", /^travel$/i, "Travel"],
  ["chase", /^shopping$/i, "Shopping"],
  ["chase", /^bills & utilities$/i, "Utilities & Bills"],
  ["chase", /^health & wellness$/i, "Health"],
  ["chase", /^home$/i, "Home"],
  ["chase", /^entertainment$/i, "Entertainment"],
  ["chase", /^personal$/i, "Personal Care"],
  ["chase", /^education$/i, "Education"],
  ["chase", /^gifts & donations$/i, "Gifts & Donations"],
  ["chase", /^fees & adjustments$/i, "Fees & Interest"],
  // Capital One
  ["capitalone", /^dining$/i, "Dining"],
  ["capitalone", /^grocer/i, "Groceries"],
  ["capitalone", /^gas\/automotive$/i, "Gas & Auto"],
  ["capitalone", /^(airfare|lodging|car rental|other travel)$/i, "Travel"],
  ["capitalone", /^merchandise$/i, "Shopping"],
  ["capitalone", /^entertainment$/i, "Entertainment"],
  ["capitalone", /^health ?care$/i, "Health"],
  ["capitalone", /^(phone\/cable|utilities|internet)$/i, "Utilities & Bills"],
  ["capitalone", /^insurance$/i, "Insurance"],
  ["capitalone", /^fee\/interest/i, "Fees & Interest"],
  // Discover
  ["discover", /^(supermarkets|warehouse clubs)$/i, "Groceries"],
  ["discover", /^restaurants$/i, "Dining"],
  ["discover", /^(gasoline|automotive)$/i, "Gas & Auto"],
  ["discover", /^travel/i, "Travel"],
  ["discover", /^(merchandise|department stores)$/i, "Shopping"],
  ["discover", /^home improvement$/i, "Home"],
  ["discover", /^medical services$/i, "Health"],
  ["discover", /^education$/i, "Education"],
  ["discover", /^(fees|interest)$/i, "Fees & Interest"],
  // Any bank, loose fallbacks
  ["*", /grocer|supermarket/i, "Groceries"],
  ["*", /restaurant|dining|food/i, "Dining"],
  ["*", /gas|fuel|auto/i, "Gas & Auto"],
  ["*", /travel|airline|hotel|lodging/i, "Travel"],
  ["*", /health|medical|pharma/i, "Health"],
  ["*", /utilit|phone|cable|internet/i, "Utilities & Bills"],
  ["*", /entertain/i, "Entertainment"],
  ["*", /insurance/i, "Insurance"],
  ["*", /merchandise|shopping|retail/i, "Shopping"],
];

/** Merchants whose category is obvious regardless of how the bank labeled them. */
const MERCHANT_CATEGORY: Record<string, string> = {
  Netflix: "Subscriptions & Digital",
  Spotify: "Subscriptions & Digital",
  Hulu: "Subscriptions & Digital",
  "Disney+": "Subscriptions & Digital",
  YouTube: "Subscriptions & Digital",
  "Amazon Prime": "Subscriptions & Digital",
  "Uber Eats": "Dining",
  DoorDash: "Dining",
  Grubhub: "Dining",
  Instacart: "Groceries",
  "Whole Foods": "Groceries",
  "Trader Joe's": "Groceries",
  Uber: "Travel",
  Lyft: "Travel",
};

/** Rent and mortgage, usually paid from checking with nothing but a payee name. Not "RENT-A-CAR". */
const HOUSING = /\bRENT\b(?!-A-)|\bAPARTMENTS?\b|\bAPTS\b|PROPERTY (MGMT|MANAGEMENT)|\bMORTGAGE\b|\bMTG PMT\b|\bHOA\b|\bLANDLORD\b/i;

const safeTest = (pattern: string, s: string) => {
  try {
    return new RegExp(pattern, "i").test(s);
  } catch {
    return false;
  }
};

export function mapIssuerCategory(account: string, issuerCategory: string | undefined, rules: Rules): string | null {
  if (!issuerCategory) return null;
  const user = rules.issuerCategoryMap[`${account}:${issuerCategory}`.toLowerCase()];
  if (user) return user;
  for (const [acct, re, cat] of ISSUER_MAP) {
    if ((acct === account || acct === "*") && re.test(issuerCategory)) return cat;
  }
  return null;
}

/**
 * Resolution order: override → merchant rule → description rule → fee/interest → built-in merchant → rent/mortgage →
 * (refunds) the merchant's usual purchase category → issuer map → Other.
 */
export function resolveCategory(t: Txn, rules: Rules, merchant = normalizeMerchant(t.rawDescription, rules), refundHint?: string): string {
  const o = rules.overrides[t.id];
  if (o) return o;
  const m = rules.merchantCategories[merchant];
  if (m) return m;
  const d = rules.descriptionRules.find((r) => safeTest(r.pattern, t.rawDescription));
  if (d) return d.category;
  if (t.kind === "fee" || t.kind === "interest") return "Fees & Interest";
  const b = MERCHANT_CATEGORY[merchant];
  if (b) return b;
  if (HOUSING.test(t.rawDescription)) return "Housing";
  if (t.kind === "refund" && refundHint) return refundHint;
  return mapIssuerCategory(t.account, t.issuerCategory, rules) ?? "Other";
}
