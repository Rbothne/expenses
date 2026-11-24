# Spending Tracker Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A client-side GitHub Pages app that imports bank CSV exports and shows spending by category and card over time, with top contributors per category.

**Architecture:** There's a pure TypeScript core in `src/core/` covering parsing, classification, normalization, dedup and aggregation, fully unit tested with no DOM access. A storage layer sits in `src/storage/`, using a folder through the File System Access API with an IndexedDB fallback. A React UI lives in `src/ui/` with a hash router. ECharts draws the charts.

**Tech Stack:** TypeScript, React 18, Vite, ECharts 5, PapaParse 5, idb-keyval 6, Vitest.

**Spec:** `docs/superpowers/specs/2026-11-24-spending-tracker-design.md`

## Global Constraints

- No runtime network calls; every dependency is bundled.
- No financial data in the repo; `.gitignore` per spec.
- Vite `base: "/expenses/"`; hash routing (Pages has no SPA fallback).
- `amount` positive = money out; cents-rounded (`Math.round(x*100)/100`).
- Spending = kinds `purchase|fee|interest` minus `refund`.
- Category is derived at read time; never persisted on a txn.
- Dedup key: `account|cardKey|date|cents|UPPER(trim(rawDescription))`, merge = max(existing, incoming) per key.

## Review Focus

1. Chase export filename `Chase1234_Activity20241124.CSV` → cardKey `1234`. Test in Task 2.
2. A CSV with a BOM, a trailing blank line or quoted commas in descriptions → still parses. Test in Task 2.
3. Schwab amounts like `"$1,234.56"` and pending rows → parsed and skipped. Test in Task 2.
4. Importing the same file twice → zero rows added; two identical same-day charges in one file → both kept. Test in Task 3.
5. A refund larger than that month's purchases for a category → the monthly value can go negative and the chart must not crash; top-merchant totals use net. Test in Task 5.

---

### Task 1: Scaffold + core types + money/date helpers

**Files:** `package.json`, `tsconfig.json`, `vite.config.ts`, `index.html`, `.gitignore`, `src/core/types.ts`, `src/core/money.ts`, `tests/money.test.ts`

**Produces:** `Txn`, `Kind`, `Rules`, `Ledger`, `ImportRecord`, `ParsedRow` types; `parseAmount(s: string): number | null`; `parseDate(s: string): string | null` (ISO).

- [ ] Test: `parseAmount("$1,234.56") === 1234.56`, `parseAmount("(12.00)") === -12`, `parseAmount("") === null`; `parseDate("01/05/2025") === "2025-01-05"`, `parseDate("1/5/25") === "2025-01-05"`, `parseDate("2025-01-05") === "2025-01-05"`.
- [ ] Implement, run `npx vitest run`, expect PASS, commit.

### Task 2: Parsers + bank detection + card identity

**Files:** `src/core/csv.ts`, `src/core/parsers/{index,chase,amex,capitalone,discover,schwab,generic}.ts`, `src/core/card.ts`, `tests/parsers.test.ts`, `tests/fixtures/*.csv`

**Produces:** `detectFormat(header: string[]): FormatId | null`; `parseFile(name: string, text: string, rules: Rules, opts?: {cardKey?: string}): ParseResult` where `ParseResult = {format, account, rows: ParsedRow[], warnings: string[], unknownHeader?: string[]}`; `cardFromFilename(name): string | null`.

- [ ] Tests per bank fixture (header from the spec table): count, first row date/amount/sign, kind of the payment row, issuerCategory. Plus Review Focus 1–3. Unknown header → `format: null, unknownHeader`. Saved generic mapping keyed by header signature → parses.
- [ ] Implement, PASS, commit.

### Task 3: Classification, merchant normalization, dedup

**Files:** `src/core/classify.ts`, `src/core/merchant.ts`, `src/core/dedup.ts`, tests for each.

**Produces:** `classifyKind(row, account, rules): Kind`; `normalizeMerchant(raw: string, rules: Rules): string`; `mergeRows(existing: Txn[], incoming: ParsedRow[], importId): {txns: Txn[], added: number, skipped: number}`.

- [ ] Tests: Schwab `CHASE CREDIT CRD AUTOPAY` withdrawal → `transfer`; Schwab `VENMO` withdrawal → `purchase`; card `AUTOPAY PAYMENT - THANK YOU` credit → `payment`; card non-payment credit → `refund`. Normalization: `SQ *BLUE BOTTLE COFFEE` → `Blue Bottle Coffee`; `COSTCO WHSE #0482 SEATTLE WA` → `Costco`; `AMZN Mktp US*2K4AB1C23` → `Amazon`; user alias overrides built-in. Dedup: Review Focus 4.
- [ ] Implement, PASS, commit.

### Task 4: Categories + rules defaults

**Files:** `src/core/categories.ts`, `src/core/rules.ts`, `tests/categories.test.ts`

**Produces:** `CATEGORIES: string[]`; `defaultRules(): Rules`; `resolveCategory(t: Txn, rules: Rules): string` in spec order (override → merchant rule → desc regex → issuer map → "Other").

- [ ] Tests for each precedence level, plus Discover `Supermarkets` → Groceries, Amex `Restaurant-Bar & Café` → Dining, Chase `Food & Drink` → Dining, Capital One `Dining` → Dining.
- [ ] Implement, PASS, commit.

### Task 5: Aggregation

**Files:** `src/core/aggregate.ts`, `tests/aggregate.test.ts`

**Produces:** `Filters = {from, to, accounts: string[], categories: string[], groupBy: "bank"|"card"}`; `enrich(txns, rules): EnrichedTxn[]` (adds category, spend amount); `applyFilters(e, f)`; `seriesBy(e, dim: "category"|"account", bucket: "week"|"month"|"quarter", rolling?: number): {buckets: string[], series: {name, values: number[]}[]}`; `topMerchants(e, n): MerchantStat[]` with `{merchant,total,count,avg,share,largest,recurring}`; `topPurchases(e, n)`; `kpis(e, prev)`; `totalsBy(e, dim)`.

- [ ] Tests: monthly buckets include zero months; recurring badge = ≥3 charges in ≥3 distinct months; top-N ordering by net total; Review Focus 5.
- [ ] Implement, PASS, commit.

### Task 6: Storage

**Files:** `src/storage/{store,fsStore,idbStore}.ts`

**Produces:** `interface Store { kind: "folder"|"browser"; load(): Promise<{ledger, rules}>; saveLedger(l); saveRules(r); saveRaw(name, text); refreshIfChanged(): Promise<boolean> }`; `openStore(): Promise<Store>`; `pickFolder()`; `exportBackup()`, `importBackup(json)`.

- [ ] Folder store tracks `lastModified` per file; on write, if the file changed since read → reload, re-apply, then write. Manual browser verification in Task 9.

### Task 7: App shell, state, filters, routing

**Files:** `src/main.tsx`, `src/App.tsx`, `src/state.tsx`, `src/ui/router.ts`, `src/ui/Filters.tsx`, `src/styles.css`

- [ ] Hash routes: `#/`, `#/category/:name`, `#/merchant/:name`, `#/transactions`, `#/import`, `#/rules`, `#/settings`; filters live in the hash query string. The header shows the "data as of" stamp and a storage-mode warning.

### Task 8: Pages

**Files:** `src/ui/pages/{Overview,CategoryDetail,MerchantDetail,Transactions,Import,Rules,Settings}.tsx`, `src/ui/Chart.tsx`

- [ ] Each page per the spec's Screens section. The Import page uses a preview → confirm flow, a column-mapping dialog for unknown headers, and a card field when the card can't be detected.

### Task 9: Deploy + verify

**Files:** `.github/workflows/deploy.yml`, `README.md`

- [ ] `npx tsc --noEmit`, `npx vitest run` and `npx vite build` all pass. Run the built app with `vite preview` and import the fixtures in a browser. Push to `main`.
