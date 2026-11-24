export type AccountId = string; // "discover" | "capitalone" | "chase" | "amex" | "schwab" | user-defined

export type Kind =
  | "purchase"
  | "refund"
  | "payment"
  | "transfer"
  | "fee"
  | "interest"
  | "deposit"
  | "other";

export const SPEND_KINDS: ReadonlySet<Kind> = new Set<Kind>(["purchase", "fee", "interest", "refund"]);

export type FormatId = "chase" | "amex" | "capitalone" | "discover" | "schwab" | `generic:${string}`;

/** One row as read from a bank file, before dedup assigns an id. */
export interface ParsedRow {
  account: AccountId;
  cardKey: string;
  date: string; // ISO yyyy-mm-dd
  postDate?: string;
  amount: number; // positive = money out
  rawDescription: string;
  kind: Kind;
  issuerCategory?: string;
  /** Bank's own type column, lower-cased; kept so kinds can be re-derived when rules change. */
  typeHint?: string;
  cardMember?: string;
}

/** Stored transaction. Merchant and category are derived at read time from rules. */
export interface Txn extends ParsedRow {
  id: string;
  importId: string;
}

export interface ImportRecord {
  id: string;
  at: string; // ISO timestamp
  fileName: string;
  format: FormatId;
  account: AccountId;
  dateFrom?: string;
  dateTo?: string;
  rowsRead: number;
  rowsAdded: number;
  rowsSkipped: number;
}

export interface Ledger {
  version: 1;
  txns: Txn[];
  imports: ImportRecord[];
}

/** Saved mapping for an unrecognized CSV header. */
export interface ColumnMapping {
  signature: string; // normalized header joined by "|"
  label: string;
  account: AccountId;
  date: string;
  description: string;
  amount?: string;
  debit?: string;
  credit?: string;
  category?: string;
  /** "out-positive": positive numbers are money out; "out-negative": negative numbers are money out. */
  sign: "out-positive" | "out-negative";
}

export interface AliasRule {
  pattern: string; // regex source, case-insensitive, matched on raw description
  merchant: string;
}

export interface CategoryRule {
  pattern: string; // regex source, case-insensitive, matched on raw description
  category: string;
}

export interface Rules {
  version: 1;
  categories: string[];
  aliases: AliasRule[];
  /** normalized merchant -> display merchant; renaming two merchants to one name merges them */
  renames: Record<string, string>;
  /** merchant (normalized) -> category */
  merchantCategories: Record<string, string>;
  descriptionRules: CategoryRule[];
  /** txn id -> category */
  overrides: Record<string, string>;
  /** Regex sources; a Schwab (or any bank-account) outflow matching one is a card-payoff transfer. */
  transferPatterns: string[];
  /** Regex sources; a card credit matching one is a payment rather than a refund. */
  paymentPatterns: string[];
  /** "<account>:<issuer category>" lower-cased -> category. Overrides built-in mapping. */
  issuerCategoryMap: Record<string, string>;
  columnMappings: ColumnMapping[];
  /** "<account>:<cardKey>" -> friendly name */
  cardNames: Record<string, string>;
  /** account -> remembered default cardKey for files without card info */
  defaultCards: Record<string, string>;
  breakdownBy: "bank" | "card";
}
