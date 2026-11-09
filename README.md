# Runway

A rolling 13-week cash flow forecast for small service businesses and their bookkeepers.

Owners keep getting surprised by annual bills and slow-paying clients, and the forecast built into their books only averages the past. Runway reads bank and QuickBooks Online exports, learns how fast each client really pays, finds the bills that come back every week, month, quarter and year, and rolls the balance forward 13 weeks to one number: what is safe to spend.

## Features

- Import bank CSV (Chase, Bank of America, Wells Fargo, Capital One, generic), OFX/QFX, and QuickBooks Online A/R Aging Detail, A/P Aging Detail, Transaction List by Date and Recurring Template List. Format detection, column mapping, validation report with line numbers.
- Recurring detection (weekly to annual, with amount drift and seasonality), sinking-fund suggestions for big annual and quarterly bills.
- Collections forecast per customer from real days-to-pay with a slow-payer haircut; bills scheduled on terms.
- Weekly roll-forward with minimum cash, low point, first breach week and safe-to-spend.
- Scenarios compared side by side: lose a client, hire, late payer, loan draw, price increase.
- Collections worklist ranked by impact on the low point, with editable reminder emails.
- Sinking-fund transfer plan, printable one-page cash brief, CSV and Excel export.
- Weekly snapshots scored against actuals (forecast vs actual), compare any two weeks.
- Local-first (IndexedDB); optional email sign-in syncs across devices.
- Two synthetic sample businesses: a 12-person agency and a seasonal landscaper.

## Run locally

```
npm install
npm run dev
npm test
```

Live: https://cash-runway.vercel.app
