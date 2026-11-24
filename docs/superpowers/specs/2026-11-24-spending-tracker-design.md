# Spending Tracker — Design

Date: 2026-11-24
Repo: https://github.com/Rbothne/expenses (empty at start)

## Intent

He spends from five accounts: Discover, Capital One, Chase and Amex credit cards, plus a Schwab bank account that mostly pays off those cards. He wants to see where the money goes so he can find places to cut back. Specifically:

- Pull together about two years of transactions, then keep refreshing whenever he feels like it (monthly, yearly or irregularly).
- Slice spending two ways: by **which card** it went on, and by **what kind of thing** was bought (category).
- For each category, show the **top ~5 contributors over the selected period**. A contributor is a merchant with its repeat charges added together, so a weekly grocery store shows as one total. That way a recurring charge and a single large purchase are both visible as the reason a category is big.
- A **line chart of spending by category over time**.

## Goals

- Import the CSV exports each bank offers on its website, with no API keys, developer accounts or paid aggregators.
- Keep every bit of financial data on his machine. The app is public code hosted on GitHub Pages, and it processes everything in the browser.
- Re-importing overlapping date ranges must never double count.
- Categorize automatically and let him correct it easily, with corrections applied to past and future transactions.
- Leave room to grow: budgets, subscription detection, month-over-month comparison and forecasts should fit without re-architecting.

## Non-goals (v1)

- Automatic syncing from banks (SimpleFIN, Plaid, scraping or a browser extension). He considered an extension and rejected it as too fragile for the effort it saves.
- Tracking income, net worth, investments or budgets. The data model must not block budgets later.
- Multiple users, or syncing between devices.
- Native mobile. Viewing on a phone browser should work, but importing is expected to happen on a desktop.

## Anti-goals

- Financial data ending up in the git repo or sent to any server. That would be a failure even if everything else works.
- Card payments counted as spending (double counting with the card-side purchases).
- Data that silently disappears because the browser cleared its storage.

## Constraints

- Hosting: GitHub Pages (public). It's a static site with no backend.
- Primary browser: Chrome on Windows. He uses Chrome.
- Fifteen-ish categories at most on the chart, or the line chart is unreadable. Legend toggles let him hide lines.

## Approaches considered

1. **Local Streamlit app (Python).** Easy data tooling and PDF parsing, but a venv install on every machine, a fixed UI vocabulary, and no phone viewing.
2. **Generated static HTML report (Python).** Simplest, but every recategorization means a regenerate cycle and the interactivity is weak.
3. **Excel workbook.** Familiar, but drill-downs and rule maintenance are awkward.
4. **Client-side app on GitHub Pages (chosen).** No install, fully custom UI, and expansion features (budgets, subscriptions, comparisons) all run client-side. The cost is that data locality is enforced by design and discipline, and any future auto-sync would need a small local helper because of CORS.

He picked 4 after an earlier lean toward 1, specifically with future expansion in mind.

## Decided

- **Stack** (Lunyx's call, stated to Him): TypeScript, React, Vite, and ECharts for the charts. Vitest for unit tests. A GitHub Actions workflow deploys `dist/` to Pages.
- **Ingest** works through an "inbox": he drags any downloaded files onto the Import page under any filename. Each file's bank and format is detected from its header row, not its name.
- **Schwab:** outflows whose description looks like a card payoff are classified as `transfer` and excluded from spending. Other Schwab outflows (rare) count as spending with Schwab as the account. Schwab deposits are ignored (income isn't tracked).
- **Card-side payment rows** (e.g. Chase "Payment", Amex "AUTOPAY PAYMENT - THANK YOU") are `payment` and excluded.
- **Export helper:** the Import page lists a direct link to each bank's activity or download page and short notes on how to export, so a refresh is five quick downloads.
- **No browser extension.**

## Data storage

- **Primary storage is a folder he picks on disk**, using the File System Access API (`showDirectoryPicker`). The directory handle is kept in IndexedDB, and permission is re-requested when needed (Chrome can offer "allow on every visit"). The folder holds:
  - `ledger.json` — all normalized transactions plus import history.
  - `rules.json` — merchant aliases, category rules and per-transaction overrides.
  - `raw/` — a copy of every imported source file, kept as an audit trail and to allow re-parsing if the parsers improve.
- **Fallback** for browsers without the API or if he declines the folder: IndexedDB, plus manual "Download backup" and "Restore backup" (a single JSON file). The UI shows a persistent warning in this mode.
- The repo's `.gitignore` excludes `*.csv`, `*.qfx`, `*.ofx`, `*.pdf`, `ledger*.json`, `rules*.json` (except the shipped defaults under `src/`), and `data/`.
- No analytics, no third-party network calls at runtime. Everything is bundled, so there are no CDN fetches.

## Cards within an account

He has more than one card or user on at least one bank. Spending itself matters most, and which card it went on comes second, but every transaction is still tracked at the **card** level:

- An **account** is the bank (`chase`, `amex`, ...). A **card** is a sub-identity within it: `cardKey` holds the last 4 digits where they're known, plus the card member where the export carries one.
- Card identity comes from:
  - **Capital One:** the `Card No.` column.
  - **Amex:** the `Account #` and `Card Member` columns.
  - **Chase:** the filename. Chase names downloads like `Chase1234_Activity...CSV`.
  - **Discover and Schwab:** the filename if it contains digits.
  - **Otherwise:** a card field in the import preview, defaulting to "primary" and remembered per account.
- Cards get editable friendly names in Settings (e.g. "Chase Sapphire").
- **Setting: "Break down by"**, either `bank` (default) or `card`. Every account filter, breakdown and the Account view follows it.
- The dedup key includes `cardKey`.

## Data model

```ts
type AccountId = "discover" | "capitalone" | "chase" | "amex" | "schwab" | string; // string = user-added
type Kind = "purchase" | "refund" | "payment" | "transfer" | "fee" | "interest" | "deposit" | "other";

interface Txn {
  id: string;            // stable hash, see Dedup
  account: AccountId;
  cardKey: string;       // "1234", "1234:JANE DOE", or "primary"
  date: string;          // ISO yyyy-mm-dd, transaction date (fall back to post date)
  postDate?: string;
  amount: number;        // positive = money out, negative = money back; cents-rounded
  rawDescription: string;
  merchant: string;      // normalized merchant (see Merchant normalization)
  kind: Kind;
  issuerCategory?: string;  // category as the bank labeled it
  category: string;      // resolved canonical category (derived, recomputed on rule change)
  cardMember?: string;   // Amex exports include it
  importId: string;
}
```

**Spending** means `kind ∈ {purchase, fee, interest}` minus `refund`. Refunds net against their own merchant and category. `payment`, `transfer`, `deposit` and `other` are excluded from all spending views but stay visible in the Transactions list with a filter.

## Parsers (bank detection by header)

The header is matched case- and whitespace-insensitively. The known formats, written from the banks' documented and commonly reported exports, are below. **They are unverified against his actual files.** The first real import is the verification step, and a detected-format preview is shown before committing.

| Bank | Expected header | Sign | Notes |
|---|---|---|---|
| Chase card | `Transaction Date, Post Date, Description, Category, Type, Amount, Memo` | negative = charge | `Type` ∈ Sale, Return, Payment, Fee, Adjustment |
| Amex | `Date, Description, Amount` (+ optional `Card Member, Account #, Extended Details, Appears On Your Statement As, Address, City/State, Zip Code, Country, Reference, Category`) | positive = charge | Category like `Merchandise & Supplies-Groceries` |
| Capital One | `Transaction Date, Posted Date, Card No., Description, Category, Debit, Credit` | Debit = charge | |
| Discover | `Trans. Date, Post Date, Description, Amount, Category` | positive = charge | Category `Payments and Credits` = payment or refund |
| Schwab bank | `Date, Status, Type, CheckNumber, Description, Withdrawal, Deposit, RunningBalance` or the older `Date, Type, Check #, Description, Withdrawal (-), Deposit (+), RunningBalance` | Withdrawal = out | Amounts may carry `$` and `,`; pending rows are skipped |

- **Unknown CSV:** a column-mapping dialog (date, description, amount or debit/credit, sign convention, category optional, account name). The mapping is saved to `rules.json` keyed by the header signature, so the next file with that header imports automatically. This also covers a bank changing its export format.
- **Dates:** accept `MM/DD/YYYY`, `M/D/YY` and ISO.
- **Payment and refund detection per bank:** use the bank's type or category column where it has one. Otherwise, a negative amount (money back) whose description matches payment patterns (`PAYMENT`, `AUTOPAY`, `THANK YOU`, `EPAYMENT`, `ONLINE PMT`) is a `payment`, and any other money back is a `refund`.
- **Schwab transfers:** an outflow matching the card payoff patterns (`CHASE CREDIT CRD`, `AMEX EPAYMENT`, `AMERICAN EXPRESS`, `CAPITAL ONE`, `DISCOVER`, plus `CRCARDPMT` and similar) is a `transfer`. The patterns are editable in Rules.
- **PDF statements:** *phase 2*, only for banks whose CSV export doesn't reach two years. The parser is per-issuer regex over pdf.js text, and building it needs a real statement sample from that issuer. Not in v1.

## Dedup

For each parsed row, build `key = account | cardKey | date | amount(cents) | rawDescription(trimmed, uppercased)`. Identical keys inside one file are legitimate repeats (two $5 coffees on the same day), so the id is `hash(key) + "#" + occurrenceIndexWithinFile`. When importing, for each key `k` the ledger ends up with `max(existingCount(k), incomingCount(k))` rows. So overlapping date ranges add nothing, while genuinely new repeats are added. Each import records the file name, detected format, date span, rows read, rows added and rows skipped.

## Merchant normalization

These steps run in order on `rawDescription` to produce `merchant`:

1. **User alias rules** (from `rules.json`, regex → merchant name) take priority. The first match wins.
2. **Built-in cleanup:**
   - Strip processor prefixes (`SQ *`, `TST*`, `SP `, `PAYPAL *`, `PP*`, `DD *`, `IC*`, `CKO*`, `GOOGLE *` and similar).
   - Strip store and reference numbers (`#1234`, long digit runs), phone numbers, URLs and `.COM` noise.
   - Strip a trailing city, state and ZIP when present.
   - Collapse whitespace and title-case the result.
3. **Built-in alias table** for common big merchants (Amazon in its `AMZN MKTP`, `AMAZON.COM*`, `AMZN DIGITAL` forms; Costco warehouse and gas; Walmart; Target; Apple; Uber vs Uber Eats; and so on). The list is a seed and is expected to be extended in Rules.

The merchant is the grouping unit for "top contributors".

## Categories

A canonical set, editable (he can add, rename or merge them):

Groceries, Dining, Gas & Auto, Travel, Shopping, Subscriptions & Digital, Utilities & Bills, Health, Home, Entertainment, Personal Care, Insurance, Education, Gifts & Donations, Fees & Interest, Other.

Each transaction's category is resolved in this order:

1. A per-transaction override.
2. A merchant → category rule.
3. A description regex → category rule.
4. The bank's own category mapped through the built-in mapping table (one table per bank, e.g. Discover `Supermarkets` → Groceries, Amex `Restaurant-*` → Dining, Chase `Food & Drink` → Dining).
5. Other.

Categories are **derived, never stored as truth**, so editing a rule recomputes every transaction immediately. Recategorizing a merchant from any drill-down creates a merchant → category rule and offers to apply it to just this transaction, or to every past and future transaction from that merchant.

## Screens

- **Overview (default)**
  - Global filters, kept in the URL: date range (presets: last 12 months, last 24 months, YTD, all, custom), accounts (multi-select), categories (multi-select).
  - KPI strip: total spend, average per month, number of transactions, and the change from the previous equal-length period.
  - **Line chart: spending by category over time.** Monthly buckets by default, with weekly or quarterly as options. Clicking a legend entry toggles that line. Hovering shows the month's value for every category. There's a zoom slider, and an option for a 3-month rolling average to smooth out lumpy categories.
  - **Category table:** each category with its total, % of spend, monthly average, and a per-account breakdown (mini stacked bar). Clicking a row opens Category detail.
  - **Account view toggle:** the same chart and table, pivoted by account instead of category.
- **Category detail**
  - The category's line over time, split by account.
  - **Top 5 merchants** by total over the period, each with: total, number of charges, average charge, % of the category, a "recurring" badge (3+ charges spread across 3+ distinct months), and its single largest charge. A "show more" control expands to 25.
  - **Top 5 single purchases** in the category (individual transactions), so one big purchase stands out even if its merchant is otherwise small.
  - Clicking a merchant opens Merchant detail.
- **Merchant detail:** a monthly bar chart, every transaction, the category with a recategorize action, and the alias (rename or merge with another merchant).
- **Transactions:** a searchable, sortable table with all filters plus `kind`. It supports inline category override and bulk select → set category. CSV export of the current view.
- **Import:** the drop zone, export instructions with links for each bank, and a parse preview (detected bank, row count, date span, sample rows, kinds summary). After confirming, it shows the import history.
- **Rules:** merchant aliases, category rules, Schwab transfer patterns, issuer category mappings and saved column mappings. Each section can be edited, with a live "matches N transactions" count.
- **Settings:** the data folder (pick or change), storage mode, backup and restore, and a "reset everything" control.

The UI is responsive, so the Overview and detail pages are usable at phone width. *(Lunyx's call)* Phones can't use the folder API, so phone use means opening the site and restoring a backup JSON into that browser's IndexedDB. Nothing beyond the existing Restore flow is built for it, and the app shows a "data as of <latest txn date>" stamp in its header everywhere.

**Multiple PCs** *(Lunyx's call)*: the data folder may sit in a synced folder such as OneDrive. That is his choice, and the app doesn't suggest it. To make it safe either way, the app re-reads `ledger.json`/`rules.json` when the tab regains focus. Before writing, it compares the file's `lastModified` against what it last read, and if the file changed it reloads, re-applies the pending change and then writes.

## Testing

- Vitest unit tests: every parser against fixture CSVs (synthetic, built from the documented formats, with fake data), dedup (overlapping files, same-day repeats), sign and kind classification, merchant normalization, category resolution order, and aggregation (monthly buckets, top-N, recurring badge).
- Manual verification: the first real import of each bank. This is a known gap until his own files are run through.

## Deploy

- Vite `base: "/expenses/"`.
- `.github/workflows/deploy.yml` builds and publishes to Pages through `actions/deploy-pages`. He has to set Settings → Pages → Source = GitHub Actions once.

## Left to the builder

- Component structure, state management and styling approach.
- The exact regexes and seed alias and mapping tables. They should be broad but conservative, and every one is overridable.
- Chart palette and theming (light and dark).
- How the file-handle permission prompt is presented.
