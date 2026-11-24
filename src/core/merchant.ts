import type { Rules } from "./types";

/** Built-in aliases, matched on the upper-cased raw description. Order matters: specific before general. */
const BUILTIN: [RegExp, string][] = [
  [/AMAZON PRIME|AMZN PRIME|PRIME VIDEO|PRIMEVIDEO/, "Amazon Prime"],
  [/AMZN|AMAZON/, "Amazon"],
  [/UBER\s*\*?\s*EATS|UBEREATS/, "Uber Eats"],
  [/\bUBER\b/, "Uber"],
  [/\bLYFT\b/, "Lyft"],
  [/DOORDASH/, "DoorDash"],
  [/GRUBHUB/, "Grubhub"],
  [/INSTACART/, "Instacart"],
  [/COSTCO/, "Costco"],
  [/WAL-?MART|WM SUPERCENTER|WALMART\.COM/, "Walmart"],
  [/\bTARGET\b/, "Target"],
  [/APPLE\.COM|APPLE STORE|\bITUNES\b/, "Apple"],
  [/NETFLIX/, "Netflix"],
  [/SPOTIFY/, "Spotify"],
  [/\bHULU\b/, "Hulu"],
  [/DISNEY ?PLUS|DISNEYPLUS/, "Disney+"],
  [/YOUTUBE ?PREMIUM|GOOGLE \*?YOUTUBE/, "YouTube"],
  [/WHOLEFDS|WHOLE FOODS/, "Whole Foods"],
  [/TRADER JOE/, "Trader Joe's"],
  [/STARBUCKS/, "Starbucks"],
  [/CHICK-?FIL-?A/, "Chick-fil-A"],
  [/MCDONALD/, "McDonald's"],
  [/SHELL OIL|^SHELL\b/, "Shell"],
  [/CHEVRON/, "Chevron"],
  [/EXXON|MOBIL\b/, "Exxon Mobil"],
  [/HOME DEPOT/, "Home Depot"],
  [/LOWE'?S\b/, "Lowe's"],
  [/\bCVS\b/, "CVS"],
  [/WALGREENS/, "Walgreens"],
  [/\bVENMO\b/, "Venmo"],
];

const PREFIX = /^(SQ ?\*|TST ?\*|SP ?\*|PAYPAL ?\*|PP ?\*|DD ?\*|IC ?\*|CKO ?\*|GOOGLE ?\*|BT ?\*|PY ?\*|SPO ?\*|EB ?\*|FSP ?\*|POS |DEBIT CARD PURCHASE |PURCHASE AUTHORIZED ON \S+ |CHECKCARD \S+ )\s*/;
const STATES = new Set(
  "AL AK AZ AR CA CO CT DE DC FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY".split(" "),
);

const titleCase = (s: string) =>
  s
    .toLowerCase()
    .split(" ")
    .filter(Boolean)
    .map((w) => w[0].toUpperCase() + w.slice(1))
    .join(" ");

function cleanup(raw: string): string {
  let s = raw.toUpperCase().replace(/\s+/g, " ").trim();
  for (let i = 0; i < 3; i++) {
    const next = s.replace(PREFIX, "");
    if (next === s) break;
    s = next;
  }
  s = s.split(",")[0]; // "NAME, CITY"
  s = s.replace(/\*\S*/g, " "); // "MERCHANT*REF123"
  s = s.replace(/\b(HTTPS?:\/\/)?(WWW\.)?([A-Z0-9-]+)\.(COM|NET|ORG|IO|CO)\b\S*/g, "$3");
  s = s.replace(/\b\d{3}[-.\s]?\d{3}[-.\s]?\d{4}\b/g, " ");
  let words = s.split(" ").filter(Boolean);
  // Cut at a store-number token (not the first word): "SAFEWAY #1234 SEATTLE WA" -> "SAFEWAY".
  const cut = words.findIndex((w, i) => i > 0 && /^#?\d{3,}$|^#\d+$/.test(w));
  if (cut > 0) words = words.slice(0, cut);
  words = words.filter((w) => !/\d/.test(w) && !/^[#*\-/.]+$/.test(w));
  if (words.length >= 2 && STATES.has(words[words.length - 1])) {
    words.pop();
    if (words.length >= 3) words.pop(); // city before the state
  }
  while (words.length > 1 && /^(INC|LLC|LTD|CORP|CO|STORE)\.?$/.test(words[words.length - 1])) words.pop();
  return titleCase(words.join(" "));
}

const cache = new WeakMap<Rules, Map<string, string>>();

function userAlias(raw: string, rules: Rules): string | null {
  for (const a of rules.aliases) {
    try {
      if (new RegExp(a.pattern, "i").test(raw)) return a.merchant;
    } catch {
      /* ignore invalid user regex */
    }
  }
  return null;
}

export function normalizeMerchant(raw: string, rules: Rules): string {
  let m = cache.get(rules);
  if (!m) cache.set(rules, (m = new Map()));
  const hit = m.get(raw);
  if (hit !== undefined) return hit;

  let out = userAlias(raw, rules);
  if (!out) {
    const up = raw.toUpperCase();
    out = BUILTIN.find(([re]) => re.test(up))?.[1] ?? cleanup(raw);
  }
  if (!out) out = titleCase(raw.replace(/\s+/g, " ").trim()) || "Unknown";
  m.set(raw, out);
  return out;
}
