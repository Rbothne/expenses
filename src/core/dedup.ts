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

type KeyFields = Pick<ParsedRow, "account" | "cardKey" | "date" | "amount" | "rawDescription">;

const desc = (s: string) => s.trim().replace(/\s+/g, " ").toUpperCase();
/** Key without the card: the same charge seen through files that label the card differently. */
const looseKey = (r: KeyFields) => [r.account, r.date, Math.round(r.amount * 100), desc(r.rawDescription)].join("|");
export const txnKey = (r: KeyFields) => [r.account, r.cardKey, r.date, Math.round(r.amount * 100), desc(r.rawDescription)].join("|");

/**
 * Merge parsed rows into the ledger without double counting.
 * Each incoming row consumes one matching existing row if there is one: same card, or the same charge where
 * either side's card was only assumed (typed, remembered, filename, "primary"). Unmatched rows are added.
 * Per key this keeps max(existing, incoming), so overlapping exports add nothing and genuine same-day repeats stay.
 */
export function mergeRows(existing: Txn[], incoming: ParsedRow[], importId: string): { txns: Txn[]; added: number; skipped: number } {
  const pool = new Map<string, { t: Txn; used: boolean }[]>();
  const ids = new Set<string>();
  for (const t of existing) {
    ids.add(t.id);
    const k = looseKey(t);
    const list = pool.get(k);
    if (list) list.push({ t, used: false });
    else pool.set(k, [{ t, used: false }]);
  }
  const txns = existing.slice();
  let added = 0;
  for (const r of incoming) {
    const cands = pool.get(looseKey(r)) ?? [];
    const match =
      cands.find((c) => !c.used && c.t.cardKey === r.cardKey) ??
      cands.find((c) => !c.used && (c.t.cardAssumed !== false || r.cardAssumed !== false));
    if (match) {
      match.used = true;
      continue;
    }
    const h = hash(txnKey(r));
    let n = 0;
    while (ids.has(`${h}#${n}`)) n++;
    const t: Txn = { ...r, id: `${h}#${n}`, importId };
    ids.add(t.id);
    txns.push(t);
    added++;
  }
  return { txns, added, skipped: incoming.length - added };
}
