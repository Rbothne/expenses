import type { Rules } from "../core/types";

const usd0 = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
const usd2 = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 });
const compact = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", notation: "compact", maximumFractionDigits: 1 });

export const money = (n: number) => usd2.format(n);
export const money0 = (n: number) => usd0.format(n);
export const moneyCompact = (n: number) => (Math.abs(n) >= 10000 ? compact.format(n) : usd0.format(n));
export const pct = (x: number) => `${(x * 100).toFixed(x < 0.1 ? 1 : 0)}%`;

export const BANK_NAMES: Record<string, string> = {
  chase: "Chase",
  amex: "Amex",
  capitalone: "Capital One",
  discover: "Discover",
  schwab: "Schwab",
};

export function bankLabel(account: string, rules: Rules): string {
  return BANK_NAMES[account] ?? rules.columnMappings.find((m) => m.account === account)?.label ?? account;
}

const title = (s: string) => s.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());

/** "chase:1234" -> "Chase ••1234"; "amex:61005:JANE DOE" -> "Amex ••1005 · Jane Doe"; friendly name wins. */
export function cardLabel(id: string, rules: Rules): string {
  if (rules.cardNames[id]) return rules.cardNames[id];
  const [account, ...rest] = id.split(":");
  const bank = bankLabel(account, rules);
  if (!rest.length) return bank;
  const [digits, member] = rest;
  if (digits === "primary") return bank;
  const parts = [bank];
  if (/^\d+$/.test(digits)) parts[0] += ` ••${digits.slice(-4)}`;
  else parts.push(title(digits));
  if (member) parts.push(title(member));
  return parts.join(" · ");
}

/** Label for a dimension value: bank id or card id depending on mode. */
export const accountLabel = (key: string, rules: Rules) => (key.includes(":") ? cardLabel(key, rules) : bankLabel(key, rules));

export const monthLabel = (bucket: string) => {
  if (/^\d{4}-\d{2}$/.test(bucket)) {
    const [y, m] = bucket.split("-");
    return new Date(Date.UTC(+y, +m - 1, 1)).toLocaleString("en-US", { month: "short", year: "2-digit", timeZone: "UTC" });
  }
  return bucket;
};

export const fmtDate = (iso: string) => {
  const [y, m, d] = iso.split("-");
  return `${m}/${d}/${y.slice(2)}`;
};
