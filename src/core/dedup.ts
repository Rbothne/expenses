import type { ParsedRow, Txn } from "./types";

/** cyrb53 string hash -> base36. Stable, fast, not cryptographic. */
function hash(str: string): string {
  let h1 = 0xdeadbeef,
    h2 = 0x41c6ce57;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}

export const txnKey = (r: Pick<ParsedRow, "account" | "cardKey" | "date" | "amount" | "rawDescription">) =>
  [r.account, r.cardKey, r.date, Math.round(r.amount * 100), r.rawDescription.trim().replace(/\s+/g, " ").toUpperCase()].join("|");

/**
 * Merge parsed rows into the ledger. Per key, the ledger ends with max(existing, incoming) rows,
 * so overlapping exports add nothing while genuinely new same-day repeats are kept.
 */
export function mergeRows(existing: Txn[], incoming: ParsedRow[], importId: string): { txns: Txn[]; added: number; skipped: number } {
  const have = new Map<string, number>();
  for (const t of existing) {
    const k = txnKey(t);
    have.set(k, (have.get(k) ?? 0) + 1);
  }
  const seen = new Map<string, number>();
  const txns = existing.slice();
  let added = 0;
  for (const r of incoming) {
    const k = txnKey(r);
    const n = seen.get(k) ?? 0;
    seen.set(k, n + 1);
    if (n < (have.get(k) ?? 0)) continue;
    txns.push({ ...r, id: `${hash(k)}#${n}`, importId });
    added++;
  }
  return { txns, added, skipped: incoming.length - added };
}
