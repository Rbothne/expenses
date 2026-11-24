import { cardFromFilename } from "./card";
import { classifyKind, type AccountType, type RawRow } from "./classify";
import { normHeader, readCsv } from "./csv";
import { parseAmount, parseDate } from "./money";
import type { AccountId, ColumnMapping, FormatId, ParsedRow, Rules } from "./types";

export const BUILTIN_FORMATS: { id: Exclude<FormatId, `generic:${string}`>; label: string; account: AccountId; type: AccountType }[] = [
  { id: "chase", label: "Chase card", account: "chase", type: "card" },
  { id: "amex", label: "American Express", account: "amex", type: "card" },
  { id: "capitalone", label: "Capital One", account: "capitalone", type: "card" },
  { id: "discover", label: "Discover", account: "discover", type: "card" },
  { id: "schwab", label: "Schwab bank", account: "schwab", type: "bank" },
];

export const accountTypeOf = (account: AccountId, rules?: Pick<Rules, "columnMappings">): AccountType =>
  BUILTIN_FORMATS.find((f) => f.account === account)?.type ?? rules?.columnMappings.find((m) => m.account === account)?.accountType ?? "card";

export const headerSignature = (header: string[]) => header.map(normHeader).join("|");

export function detectFormat(header: string[]): Exclude<FormatId, `generic:${string}`> | null {
  const h = new Set(header.map(normHeader));
  const has = (...k: string[]) => k.every((x) => h.has(x));
  if (h.has("withdrawal") || h.has("withdrawal (-)")) return has("date", "description") ? "schwab" : null;
  if (h.has("card no.") || has("posted date", "debit", "credit")) return "capitalone";
  if (has("trans. date", "description", "amount")) return "discover";
  if (has("transaction date", "post date", "description", "type", "amount")) return "chase";
  if (has("date", "description", "amount") && !h.has("transaction date") && !h.has("posting date")) return "amex";
  return null;
}

export interface ParseOptions {
  format?: FormatId;
  cardKey?: string;
  mapping?: ColumnMapping;
}

export interface ParseResult {
  format: FormatId | null;
  account: AccountId;
  header: string[];
  rows: ParsedRow[];
  skipped: number;
  warnings: string[];
  cardDetected: boolean;
  dateFrom?: string;
  dateTo?: string;
}

type Mapper = (get: (...names: string[]) => string) => RawRow | null;

const amountOut = (s: string, outPositive: boolean) => {
  const v = parseAmount(s);
  return v == null ? null : outPositive ? v : -v;
};

function baseRow(get: (...n: string[]) => string, dateCols: string[], postCols: string[]): Pick<RawRow, "date" | "postDate" | "rawDescription"> | null {
  const date = parseDate(get(...dateCols)) ?? parseDate(get(...postCols));
  if (!date) return null;
  const postDate = parseDate(get(...postCols)) ?? undefined;
  return { date, postDate, rawDescription: get("description").replace(/\s+/g, " ") };
}

const MAPPERS: Record<Exclude<FormatId, `generic:${string}`>, Mapper> = {
  chase: (get) => {
    const b = baseRow(get, ["transaction date", "date"], ["post date"]);
    const a = amountOut(get("amount"), false);
    if (!b || a == null) return null;
    return { ...b, amount: a, issuerCategory: get("category") || undefined, typeHint: get("type").toLowerCase() || undefined };
  },
  amex: (get) => {
    const b = baseRow(get, ["date"], []);
    const a = amountOut(get("amount"), true);
    if (!b || a == null) return null;
    const member = get("card member") || undefined;
    const acct = get("account #").replace(/\D/g, "");
    const cardKey = acct ? (member ? `${acct}:${member}` : acct) : member;
    return { ...b, amount: a, issuerCategory: get("category") || undefined, cardKey, cardMember: member };
  },
  capitalone: (get) => {
    const b = baseRow(get, ["transaction date"], ["posted date"]);
    const debit = parseAmount(get("debit"));
    const credit = parseAmount(get("credit"));
    if (!b || (debit == null && credit == null)) return null;
    const amount = (debit ?? 0) - (credit ?? 0);
    const card = get("card no.").replace(/\D/g, "");
    return { ...b, amount, issuerCategory: get("category") || undefined, cardKey: card || undefined };
  },
  discover: (get) => {
    const b = baseRow(get, ["trans. date", "date"], ["post date"]);
    const a = amountOut(get("amount"), true);
    if (!b || a == null) return null;
    return { ...b, amount: a, issuerCategory: get("category") || undefined };
  },
  schwab: (get) => {
    if (/pending/i.test(get("status"))) return null;
    const b = baseRow(get, ["date"], []);
    const w = parseAmount(get("withdrawal", "withdrawal (-)"));
    const dep = parseAmount(get("deposit", "deposit (+)"));
    if (!b || (w == null && dep == null)) return null;
    return { ...b, amount: Math.abs(w ?? 0) - Math.abs(dep ?? 0), typeHint: get("type").toLowerCase() || undefined };
  },
};

function genericMapper(m: ColumnMapping): Mapper {
  const n = normHeader;
  return (get) => {
    const date = parseDate(get(n(m.date)));
    if (!date) return null;
    let amount: number | null;
    if (m.amount) {
      amount = amountOut(get(n(m.amount)), m.sign === "out-positive");
    } else {
      const d = parseAmount(get(n(m.debit ?? "")));
      const c = parseAmount(get(n(m.credit ?? "")));
      amount = d == null && c == null ? null : Math.abs(d ?? 0) - Math.abs(c ?? 0);
    }
    if (amount == null) return null;
    return { date, amount, rawDescription: get(n(m.description)).replace(/\s+/g, " "), issuerCategory: m.category ? get(n(m.category)) || undefined : undefined };
  };
}

export function parseFile(fileName: string, text: string, rules: Rules, opts: ParseOptions = {}): ParseResult {
  const rows = readCsv(text);
  const warnings: string[] = [];

  // Locate the header row (banks sometimes prepend a title line).
  let hi = -1;
  let detected: FormatId | null = null;
  let mapping: ColumnMapping | undefined = opts.mapping;
  for (let i = 0; i < Math.min(rows.length, 15) && hi < 0; i++) {
    const sig = headerSignature(rows[i]);
    const saved = mapping && mapping.signature === sig ? mapping : rules.columnMappings.find((c) => c.signature === sig);
    const f = detectFormat(rows[i]);
    if (saved) {
      hi = i;
      mapping = saved;
      detected = `generic:${sig}`;
    } else if (f) {
      hi = i;
      detected = f;
    }
  }
  if (hi < 0) hi = Math.max(0, rows.findIndex((r) => r.filter(Boolean).length >= 2));
  const header = rows[hi] ?? [];
  const format: FormatId | null = opts.format ?? detected;

  let mapper: Mapper | null = null;
  let account: AccountId = "";
  let accountType: AccountType = "card";
  if (format && !format.startsWith("generic:")) {
    const f = BUILTIN_FORMATS.find((x) => x.id === format)!;
    mapper = MAPPERS[f.id];
    account = f.account;
    accountType = f.type;
  } else if (format && mapping) {
    mapper = genericMapper(mapping);
    account = mapping.account;
    accountType = mapping.accountType ?? "card";
  }
  if (!mapper || !format) {
    return { format: null, account: "", header, rows: [], skipped: 0, warnings: ["Unrecognized file format"], cardDetected: false };
  }

  const idx = new Map<string, number>();
  header.forEach((h, i) => {
    const k = normHeader(h);
    if (!idx.has(k)) idx.set(k, i);
  });

  const fileCard = opts.cardKey ?? cardFromFilename(fileName);
  const fallbackCard = rules.defaultCards[account] ?? "primary";
  let cardDetected = !!fileCard;
  const out: ParsedRow[] = [];
  let skipped = 0;

  for (const cells of rows.slice(hi + 1)) {
    const get = (...names: string[]) => {
      for (const nm of names) {
        const i = idx.get(nm);
        if (i != null && cells[i] != null) return cells[i];
      }
      return "";
    };
    const raw = mapper(get);
    if (!raw) {
      skipped++;
      continue;
    }
    if (raw.cardKey && !opts.cardKey) cardDetected = true;
    const cardKey = opts.cardKey ?? raw.cardKey ?? fileCard ?? fallbackCard;
    out.push({
      account,
      cardKey,
      cardAssumed: !(raw.cardKey && !opts.cardKey),
      date: raw.date,
      postDate: raw.postDate,
      amount: raw.amount,
      rawDescription: raw.rawDescription,
      kind: classifyKind(raw, accountType, rules),
      issuerCategory: raw.issuerCategory,
      typeHint: raw.typeHint,
      cardMember: raw.cardMember,
    });
  }
  if (skipped) warnings.push(`${skipped} row(s) skipped (pending, totals, or unreadable)`);
  const dates = out.map((r) => r.date).sort();
  return { format, account, header, rows: out, skipped, warnings, cardDetected, dateFrom: dates[0], dateTo: dates[dates.length - 1] };
}
