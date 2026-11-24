# Expenses

A personal spending tracker that runs entirely in your browser. It imports the CSV exports from your card and bank websites. You can then see where the money goes, by category and by card, and which merchants make up each category.

**Your data never leaves your computer.** The site is static code on GitHub Pages. It reads files in the browser and saves to a folder you choose, or to the browser's own storage. Nothing is uploaded, and there's no server or analytics.

## Use it

1. Open the site in Chrome or Edge: `https://rbothne.github.io/expenses/`
2. Choose a data folder. It ends up holding `ledger.json`, `rules.json` and `raw/` (a copy of every file you import).
3. Download activity CSVs from each bank. The Import page has links and steps for each one.
4. Drop all the files onto **Import**. You can refresh whenever you like: overlapping date ranges are de-duplicated.

### Supported exports

| Bank | File | Notes |
|---|---|---|
| Chase (cards) | Activity CSV | The card's last 4 digits come from the filename (`Chase1234_Activity…`) |
| American Express | Activity CSV | Tick "include additional details" so you get the card member and category |
| Capital One | Transactions CSV | The `Card No.` column separates your cards |
| Discover | Activity CSV | |
| Schwab Bank | History CSV | Card payoffs are treated as transfers and left out of spending |
| Anything else | Any CSV | Map the columns once, and the mapping is saved for next time |

The bank formats were written from documented and commonly reported layouts. If a bank changes its export, use **Format → Map columns manually**.

### How spending is counted

- Purchases, fees and interest count. Refunds subtract from the merchant and category they came from.
- Card payments, Schwab card payoffs, deposits and rewards redemptions don't count.
- A category comes from, in order: your per-transaction choice, then your merchant rule, then your description rule, then a built-in merchant default, then the bank's own category.
- Editing a rule re-applies it to everything you've already imported.
- Rent and mortgage payments from checking are detected as Housing, and other loan payments as Loans. Loan and mortgage payments to a card issuer count as spending, not as a card payoff. Transfers into your own loan account don't count.

### Insights

- **What changed** compares a period with the same dates a year earlier, or with the period just before. It covers categories (naming the merchant behind each move), new merchants, stopped recurring charges and price changes on steady charges. It warns when an account's imported history doesn't cover both periods.
- **Year by year** shows calendar-year totals with partial years marked, plus this year so far against the same dates last year.
- **Health check** covers HUD's housing cost burden, the 50/30/20 budget, the FDIC 3–6 month emergency fund, Fidelity's 15% retirement rate and CFPB's guidance on paying cards in full. Take-home pay comes from paychecks in Schwab (patterns on the Rules page) or a typed figure.
- **Compared with the average household** uses the BLS Consumer Expenditure Survey, adjusted for inflation with CPI-U. Only categories that line up with a survey line are compared. OECD country shares are shown as fun facts only.
- The benchmark figures are bundled in `src/data/benchmarks.json`, and `docs/benchmarks-notes.md` explains every mapping and caveat. Nothing about you is sent anywhere.

## Develop

```bash
npm install
npm run dev        # http://localhost:5173/expenses/
npm test           # unit tests (parsers, dedup, categories, aggregation)
npm run build
```

Deployment: GitHub Actions publishes to Pages on every push to `main`. You have to set this once in the repo: **Settings → Pages → Source: GitHub Actions**.

Layout:

- `src/core/` holds the pure, tested logic.
- `src/storage/` handles the folder and IndexedDB storage.
- `src/ui/` holds the React pages.
