import type { Kind, Rules } from "./types";

export type AccountType = "card" | "bank";

/** Bank-specific row facts before classification. amount: positive = money out. */
export interface RawRow {
  date: string;
  postDate?: string;
  amount: number;
  rawDescription: string;
  issuerCategory?: string;
  /** Bank's own transaction type column, lower-cased (e.g. chase "sale", schwab "transfer"). */
  typeHint?: string;
  cardKey?: string;
  cardMember?: string;
}

const INTEREST = /\bINTEREST (CHARGE|CHARGED)\b|PURCHASE INTEREST|INTEREST CHARGE ON/i;
const FEE_DESC = /\b(LATE|ANNUAL|MEMBERSHIP|FOREIGN TRANSACTION|RETURNED PAYMENT|OVER ?LIMIT|CASH ADVANCE) FEE\b/i;
const FEE_CAT = /^fees?\b|fee\/interest|^fees & adjustments/i;
const INTEREST_CAT = /^interest\b|interest charge/i;
const REWARD = /CASH ?BACK|\bREWARDS?\b|REDEMPTION|\bAWARD/i;
const REWARD_CAT = /award|rebate|reward/i;
const TRANSFER_DESC = /FUNDS TRANSFER|\bTRANSFER (TO|FROM)\b|\bXFER\b/i;

const anyMatch = (patterns: string[], s: string) =>
  patterns.some((p) => {
    try {
      return new RegExp(p, "i").test(s);
    } catch {
      return false;
    }
  });

export function classifyKind(r: RawRow, accountType: AccountType, rules: Pick<Rules, "transferPatterns" | "paymentPatterns">): Kind {
  const d = r.rawDescription;
  const cat = r.issuerCategory ?? "";
  const t = r.typeHint ?? "";
  if (r.amount === 0) return "other";

  if (accountType === "bank") {
    if (r.amount < 0) return "deposit";
    if (t === "intadjust" || INTEREST.test(d)) return "fee";
    if (t === "transfer" || TRANSFER_DESC.test(d) || anyMatch(rules.transferPatterns, d)) return "transfer";
    if (FEE_DESC.test(d) || /\bfee\b/i.test(t)) return "fee";
    return "purchase";
  }

  // card
  if (r.amount > 0) {
    if (INTEREST.test(d) || INTEREST_CAT.test(cat)) return "interest";
    if (t === "fee" || FEE_DESC.test(d) || FEE_CAT.test(cat)) return "fee";
    return "purchase";
  }
  if (t === "return") return "refund";
  if (t === "payment") return "payment";
  if (REWARD_CAT.test(cat) || REWARD.test(d)) return "other";
  if (anyMatch(rules.paymentPatterns, d)) return "payment";
  return "refund";
}
