# Benchmarks: sources, honesty notes and presentation rules

This document explains `src/data/benchmarks.json`. Every number in that file came from a primary source that was fetched on 2026-11-24. The sources are BLS CE tables, the BLS CPI API, HUD, CFPB, FDIC, FINRA, Fidelity, a University of Washington page and the OECD SDMX API. Nothing was filled in from memory. Where a source could not be fetched or quoted, the item was dropped (see "Dropped / not verified").

## 1. What the CE numbers are

- **Survey:** BLS Consumer Expenditure Surveys, calendar year **2025**, released **2026-10-29**. The national tables used are Table 1800 (region), Table 1400 (size of consumer unit) and Table 1710 (housing tenure). Their footer reads "October, 2026".
- **Unit:** annual mean dollars per *consumer unit* (CU), which is roughly a household. BLS: "Consumer units consist of families, single persons living alone or sharing a household with others".
- **Means include non-spenders.** Every line is averaged over *all* CUs in the group, including the many that spent $0 on that line. Two examples from the "all" group:
  - `rentedDwellings` is $6,272 because owners count as roughly $0. The renter group's figure is $17,495.
  - `education` is $1,583, although most households spend nothing on it.

  The app must never label a CE mean "what a typical household spends on X". Say "average spending per household on X (all households, including those with none)".
- **2025 data gap.** BLS: "Due to the 2025 lapse in federal appropriations, the Census Bureau could not collect the Consumer Expenditure Surveys (CE) ... in October and November 2025. BLS used a weight adjustment approach to account for these missing 2025 data." The app should show this as a one-line footnote on any 2025 comparison.
- **No after-tax income.** The 2025 calendar-year tables publish only income before taxes, so `incomeAfterTax` is `null` everywhere. Do not derive it. State tables publish `personalTaxes`, which is stored but not subtracted.
- **Validation.** While building the file I checked that the components add up to their published totals, within rounding, for every group: food, shelter, housing, transportation, healthcare, owned dwellings, other vehicle expenses, personal insurance, and total expenditures. That was 285 checks, with 0 failures.

## 2. Category mapping: what is honest

His data is out-of-pocket spending from a set of card and bank accounts. CE is everything the household spent, including payroll-deducted items and large purchases at full price. One CE definition matters a lot here: "The full cost of each purchase is recorded, even though full payment may not have been made at the date of purchase". Installment payments are excluded.

| App category | CE lines | Comparable | Reasoning |
|---|---|---|---|
| Housing | rentedDwellings / mortgageInterest + propertyTaxes | **yes**, with care | **Renters:** compare rent to the `tenure-renter` group's `rentedDwellings`, not to the all-households mean, which is diluted by owners. **Owners:** CE excludes mortgage principal ("Mortgage principal repayments are payments of loans"). A mortgage payment from Schwab checking is therefore larger than its CE counterpart. Compare it against the `tenure-owner-mortgage` group's mortgageInterest + propertyTaxes, or label the CE figure "excludes principal". |
| Groceries | foodHome | yes | CE counts food only. A grocery-store charge also buys toiletries and cleaning supplies, so his figure runs high. Say so in the tooltip. |
| Dining | foodAway | yes | Close match. Alcohol is a separate CE line covering both home and away, so exclude it unless his bar tabs are in Dining. |
| Gas & Auto | gasoline + vehicleMaintenance + vehicleRental | yes | Do **not** use CE "Transportation". It includes vehicle purchases at full net price in the year of purchase, even when financed, while his ledger shows loan payments. Vehicle finance charges and insurance are also excluded here; insurance goes under Insurance. `vehicleRental` covers leases, rentals, registration, licence fees, parking and tolls, per the BLS glossary. |
| Travel | otherLodging, publicTransport | **no** | CE has no travel line. Trip costs are spread across other lodging ("all expenses for vacation homes, school, college, hotels, motels..."), public and other transportation (which includes airfare), food away from home and entertainment. Show these only as context. |
| Shopping | apparel, furnishings, housekeepingSupplies | **no** | No single CE line. Merchant categorisation mixes clothing, electronics, household goods and gifts. |
| Subscriptions & Digital | audioVisual | **no** | CE has no subscriptions line. Streaming sits in "Audio and visual equipment and services" along with TVs and hardware, and phone and internet sit in utilities. |
| Utilities & Bills | utilities | yes | CE utilities = natural gas, electricity, fuel oil, telephone (including cellular) and water/public services. It is a fair comparison if his phone and internet bills are in this category. It is lower if utilities are included in his rent. |
| Health | medicalServices + drugs + medicalSupplies | yes (subset only) | CE "Healthcare" ($6,470) is mostly health insurance ($4,310), which for most workers is payroll-deducted and invisible to the app. Compare only with the out-of-pocket lines ($2,160 for all households). |
| Home | householdOps, housekeepingSupplies, furnishings | **no** | Whether a purchase lands in Home or Shopping depends on the merchant. CE household operations also include services such as childcare and lawn care. Suggestion: show **Home + Shopping combined** against apparel + furnishings + housekeepingSupplies + householdOps as a rough "goods and household" comparison, labelled approximate. |
| Entertainment | feesAdmissions | yes (subset) | CE Entertainment ($4,084) includes pets ($997), toys, audio/visual equipment and streaming. Compare only to "Fees and admissions" ("fees for participant sports; admissions to sporting events, movies, concerts, and plays"). |
| Personal Care | personalCare | yes | Good match. Some drugstore toiletries may be in his Groceries or Shopping. |
| Insurance | vehicleInsurance, lifeInsurance | **no** | The total cannot be matched: health premiums are payroll-deducted, homeowners insurance is inside "Maintenance, repairs, insurance, and other expenses", and renters insurance has no line. A vehicle insurance comparison alone is acceptable if he pays it directly. |
| Education | education | yes | Annual totals only, because tuition is lumpy. The mean includes the many households with $0. |
| Gifts & Donations | cashContributions | **no** | CE cash contributions are "cash contributed to persons or organizations outside the consumer unit, including alimony and child support", plus religious, charitable and political contributions and the support of students away from home. Gifts bought as goods are recorded under the item's own category. His category mixes both. |
| Fees & Interest | none | **no** | Bank service charges are inside CE Miscellaneous, and vehicle and mortgage interest are elsewhere. Use the `cc-pay-in-full` guideline instead. |
| Other | none | **no** | |

**Presentation rule:** for `comparable: false`, never draw a "you vs average" bar. Show the CE lines as an expandable "for context, the average US household spends ... on ..." note, with the mapping note.

## 3. Household size

Compare against the matching `kind: "size"` group (one, two, three, four, five or more). Do not divide the all-households mean by persons (2.4), for three reasons:
1. **Economies of scale.** Rent, utilities and many fixed costs do not scale with headcount. The data shows this: one-person CUs spend $50,479 a year in total, while dividing the all-CU mean by persons gives $81,905 / 2.4 ≈ $34,100. Total spending by size is $50,479, $84,124, $98,214, $108,233 and $114,427, far from proportional to headcount.
2. **Composition differs by size.** One-person CUs are older and lower-income on average: income before taxes is $56,302, against $110,847 for all CUs.
3. **The "five or more" group averages 5.6 persons.** Per-person division is meaningless at the tails.

Default: use the size group matching his household. Offer the region group as a secondary comparison. Do not combine size and region adjustments multiplicatively, because CE does not publish size × region cross-tabs here.

## 4. Inflation adjustment

CPI-U (CUUR0000SA0, NSA) annual averages are stored in `cpi.annual`. To express a CE figure in the dollars of a given year *Y*:

```
CE_in_Y = CE_value × CPI_annual[Y] / CPI_annual[surveyYear]
```

- National groups: `surveyYear = 2025` (321.943).
- Two-year-average groups (states, MSAs): use the mean of the two years' annual CPI as the base. For states (2022-2023) that is (292.655 + 304.702) / 2 = 298.679. For MSAs (2023-2024) it is (304.702 + 313.689) / 2 = 309.196.
- **Current partial year (2026):** there is no annual average yet. Use `cpi.latestMonth.value` (2026-10 = 337.511) as the numerator and label it "in Oct 2026 dollars (approx.)". Example: 2025 all-households food at home $6,491 × 337.511 / 321.943 ≈ $6,805.
- **Earlier years** work the same way. Example: comparing his 2024 spending means multiplying the 2025 CE figure by 313.689 / 321.943 = 0.9744.
- **Caveats:**
  - October 2025 CPI is missing ("Data unavailable due to the 2025 lapse in appropriations"). BLS computed the 2025 annual average from 11 months.
  - All-items CPI is an approximation, because category prices move differently. Category CPI series exist if precision matters, but they were not fetched.
  - Inflation adjustment does not convert a 2-year-old survey into a forecast of current behaviour.

## 5. Region vs state vs MSA

Preference order, if his location matches:

1. **Region** (2025, 1-year). Newest data, largest samples, and published with standard errors. This is the default.
2. **MSA** (2023-2024 two-year average, 22 areas). More local, but the samples are smaller and older. The Southern MSA table footnotes "Data are likely to have large sampling errors." BLS also says that "a small number of CUs reporting an expenditure can cause the mean dollar estimate to be imprecise". The MSA tables publish only about 31 lines, with no healthcare or vehicle sub-lines. BLS will **not** publish 2024-2025 two-year tables because of a variance-method change, so 2023-2024 stays the newest MSA data for a while.
3. **State** (CA, FL, NY, TX; 2022-2023). BLS calls these a research product built with special state weights ("Consumer unit weights are representative of a national sample, and not the state in which they reside"). BLS also says "As of May 2026, BLS will no longer produce state research products". These are the oldest figures, so show them as "older, research estimate". New Jersey's newest table is 2019-2020 and was omitted.

General rule: BLS "considers mean estimates with RSEs of 25 percent or more to be unreliable". No published value in the files used here carried an RSE flag. Show a "2-year average, smaller sample" badge on MSA and state comparisons, and always inflate them from their own base years (section 4).

## 6. Guidelines

All the guidelines are rules of thumb, not standards. Show each one with its source link and quote.

- **50/30/20** (`503020-needs` / `-wants` / `-savings`, basis take-home).
  - Source: University of Washington, which says "roughly 50% of your after-tax income to needs, 30% to wants, and 20% to savings or debt reduction".
  - The attribution to Elizabeth Warren and Amelia Warren Tyagi's *All Your Worth* is widely repeated, but I could not fetch a page that verifies it. The app should not cite the book.
  - `needsCategories` = Housing, Groceries, Utilities & Bills, Health, Insurance, Gas & Auto. This is a judgment call that follows the UW split of fixed costs (housing, insurance, utilities, transportation) from flexible ones. Groceries are treated as a need even though UW lists them as flexible; dining out is not. Iowa State's page lists dining out, new clothes and memberships as wants. Education, Gifts and Fees are left out of needs. Minimum debt payments are a need under the original rule, but the app only sees interest and fees, so leave them out.
  - The savings share is take-home minus total spending, so it requires his take-home pay. If income is not entered, do not show 50/30/20.
- **HUD cost burden** (30%) and **severe** (50%), basis gross.
  - HUD's CHAS definition explicitly counts utilities ("Monthly housing costs (including utilities)").
  - The app's metric is therefore Housing + the housing-utility part of Utilities & Bills, divided by gross income. Arguably phone service should be excluded; mention it.
  - This is a statistical definition for housing policy, not personal advice. Present it as "HUD would classify a household at this ratio as cost-burdened".
- **CFPB DTI ratios** (`cfpb-mortgage-dti` 28-35%, `cfpb-dti-homeowner` 36%, `cfpb-dti-renter` 15-20%), basis gross.
  - Source: CFPB's *Your Money, Your Goals* DTI tool.
  - The mortgage ratio uses **principal and interest only**, and the CFPB notes taxes and insurance "may or may not be included".
  - The familiar "28/36" maps to the low end of CFPB's 28-35 range plus the 36% back-end figure.
  - Debt payments are mostly invisible to a spending app. A car loan payment from checking would need tagging, so only show DTI if the user marks debt-payment transactions.
- **Emergency fund** (3-6 months of expenses, basis spending).
  - FDIC: "A general recommendation is to try to keep three to six months' worth of expenses". FINRA says the same and adds that variable-income workers may need more.
  - The CFPB deliberately gives no number: "depends on your situation". Show the CFPB line next to the range.
  - Denominator: his average monthly total spending, or needs only as a stricter variant. The app does not know his balances, so this needs a user-entered savings figure.
- **Retirement 15%** (basis gross). Source: Fidelity, "at least 15% of your pre-tax income each year, which includes any employer match". Fidelity is a firm, not a regulator; label it "Fidelity guideline". Contributions are usually payroll-deducted and invisible to the app, so this needs user input.
- **Pay cards in full** (threshold 0 interest). Source: the CFPB grace-period answer. It is directly checkable: any card interest in Fees & Interest is a miss. Note the CFPB caveat that grace periods usually apply to purchases only, not cash advances.

### Dropped / not verified
- **Subscriptions and dining "rules"** (such as "keep dining under X%"): no reputable source found. Skipped, as instructed.
- **The CFPB home-loan-toolkit "28% of income before taxes" sentence:** the search snippet claimed it, but the PDF could not be text-extracted here, so it is not quoted. The DTI tool covers the same ground with a verified quote.
- **The Warren / *All Your Worth* attribution for 50/30/20:** the URI paper that discusses it returned 403.

## 7. Countries

**Decision:** a per-category, dollar-for-dollar country comparison against his ledger is **not honest**, so the file contains share-of-total "fun facts" only, not per-capita PPP dollars.

Reasons:
- OECD household final consumption expenditure is on a national-accounts basis. It includes imputed rent for owner-occupiers and spending paid on households' behalf.
- The US health share shows the effect: health is 20.3% of US household consumption, against 2.1-7.3% in the other 15 countries. This most likely reflects how US national accounts treat third-party-paid care, not what US families pay at the counter. This is my interpretation and is not stated in the fetched data.
- The series is on a domestic ("on the territory") concept.
- Per-capita PPP levels would need separate PPP and population series, which I did not fetch, and they would still not be comparable.

`countries` holds the 2022 shares (%) of the 12 COICOP divisions for the US and 15 other OECD countries. 2022 is the latest year with complete coverage for all of them; 2023+ is patchy. Present it as "how countries split household consumption", with the caveats visible. The app's US benchmark for his ledger should remain CE.
