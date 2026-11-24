/**
 * Pull a card's last digits out of a download filename when the bank encodes them.
 * Chase: "Chase1234_Activity20241124.CSV". Generic: "...card-1234...", "...x1234...", "...ending 1234...".
 * Bare digit runs (dates) are ignored on purpose.
 */
export function cardFromFilename(name: string): string | null {
  const base = name.replace(/^.*[\\/]/, "");
  let m = /^chase(\d{4})_/i.exec(base);
  if (m) return m[1];
  m = /(?:\b(?:card|acct|account|ending)[-_ ]?|\bx)(\d{4})(?!\d)/i.exec(base);
  if (m) return m[1];
  return null;
}

export const cardId = (account: string, cardKey: string) => `${account}:${cardKey}`;
