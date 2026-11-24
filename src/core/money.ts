/** Round to cents, half away from zero, tolerant of binary float error. */
export function cents(x: number): number {
  const r = Math.round((Math.abs(x) + 1e-9) * 100) / 100;
  return x < 0 ? -r : r;
}

/** Parse a money string: "$1,234.56", "-45.10", "(12.00)". Returns null when not a number. */
export function parseAmount(s: string | undefined | null): number | null {
  if (s == null) return null;
  let t = String(s).trim();
  if (!t) return null;
  let neg = false;
  if (/^\$?\(.*\)$/.test(t)) {
    neg = true;
    t = t.replace(/[()]/g, "");
  }
  t = t.replace(/[$,\s]/g, "");
  if (t.startsWith("-")) {
    neg = !neg;
    t = t.slice(1);
  } else if (t.startsWith("+")) {
    t = t.slice(1);
  }
  if (!/^\d*\.?\d+$/.test(t)) return null;
  const v = cents(Number(t));
  return neg ? -v : v;
}

function valid(y: number, m: number, d: number): string | null {
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCMonth() !== m - 1) return null;
  return `${y.toString().padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/** Parse MM/DD/YYYY, M/D/YY, or YYYY-MM-DD (leading match; trailing text ignored) to ISO. */
export function parseDate(s: string | undefined | null): string | null {
  if (!s) return null;
  const t = String(s).trim();
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(t);
  if (m) return valid(+m[1], +m[2], +m[3]);
  m = /^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})\b/.exec(t);
  if (m) {
    let y = +m[3];
    if (m[3].length === 2) y += y < 70 ? 2000 : 1900;
    return valid(y, +m[1], +m[2]);
  }
  return null;
}
