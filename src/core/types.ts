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
  /** True when the card was not read from the file's own columns (typed, remembered, filename, or "primary"). */
  cardAssumed?: boolean;
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
  /** Bank accounts treat outflows matching payoff patterns as transfers and inflows as deposits. */
  accountType?: "card" | "bank";
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
  /** Regex sources; a bank-account deposit matching one is income (a paycheck), not a transfer or refund. */
  incomePatterns: string[];
  /** Categories counted as needs in the 50/30/20 check; everything else spent is a want. */
  needsCategories: string[];
  profile: Profile;
}

/** What the health checks and benchmarks need to know that the CSVs can't say. All optional. */
export interface Profile {
  /** People the tracked spending covers. */
  householdSize?: number;
  /** benchmarks.json group id ("all", "region:west", "size:2", ...) */
  benchmarkGroup?: string;
  /** Before-tax yearly income, for the housing and retirement checks. */
  grossAnnual?: number;
  /** Typed take-home per month; overrides paychecks detected from deposits. */
  takeHomeMonthly?: number;
  /** Picks the right survey group for Housing. Unset = rent. */
  tenure?: "rent" | "own-mortgage" | "own-outright";
  /** Cash set aside for emergencies, for the months-covered check. */
  emergencySavings?: number;
}
