# Runway

A rolling 13-week cash flow forecast for small service businesses and their bookkeepers.

Owners keep getting surprised by annual bills and slow-paying clients, and the forecast built into their books only averages the past. Runway reads bank and QuickBooks Online exports, learns how fast each client really pays, finds the bills that come back every week, month, quarter and year, and rolls the balance forward 13 weeks to one number: what is safe to spend.

## Features

- Import bank CSV (Chase, Bank of America, Wells Fargo, Capital One 360 and cards, generic), OFX/QFX (bank and credit card), and QuickBooks Online A/R Aging Detail, A/P Aging Detail, Transaction List by Date and Recurring Template List as CSV or Excel. Handles UTF-8, UTF-16 and Windows-1252 files. Format detection, column mapping, validation report with line numbers.
- Recurring detection (weekly to annual, with amount drift and seasonality), sinking-fund suggestions for big annual and quarterly bills.
- Collections forecast per customer from real days-to-pay with a slow-payer haircut; bills scheduled on terms.
- Weekly roll-forward on banking days (weekends and Federal Reserve holidays) with minimum cash, low point, first breach week and safe-to-spend.
- Scenarios compared side by side: lose a client, hire, late payer, loan draw, price increase.
- Collections worklist ranked by impact on the low point, with editable reminder emails.
- Sinking-fund transfer plan, printable one-page cash brief, CSV and Excel export.
- Weekly snapshots scored against actuals (forecast vs actual), compare any two weeks.
- Local-first (IndexedDB); optional email sign-in syncs across devices.
- Two synthetic sample businesses: a 12-person agency and a seasonal landscaper.

## Test data

Importer tests use real OFX/QFX files from the MIT-licensed test suites of [ofxparse](https://github.com/jseutter/ofxparse) and [Actual Budget](https://github.com/actualbudget/actual), and CSV fixtures that follow each bank's and QuickBooks' exact export layout. Bank holidays are checked against the Federal Reserve's [K.8 table](https://www.federalreserve.gov/aboutthefed/k8.htm).

## Known gaps

- Xero aged receivables/payables detail groups rows under contact headings; map the columns by hand.
- Canadian bank holidays are not modelled (weekends only for CAD).
- Investment-account OFX (INVSTMTRS) is not read.

## Run locally

```
npm install
npm run dev
npm test
```

Live: https://cash-runway-zeta.vercel.app
