import { Link } from './ui.tsx'

const NAV = [['exports', 'Getting your data out'], ['qbo', 'QuickBooks Online'], ['xero', 'Xero'], ['banks', 'Banks'], ['formats', 'Formats Runway reads'], ['method', 'How the forecast works'], ['weekly', 'The weekly routine'], ['privacy', 'Privacy']] as const

export default function Docs() {
  return (
    <section className="page docs">
      <aside className="docs-nav" aria-label="Docs sections">
        <nav>{NAV.map(([id, l]) => <a key={id} href={`#${id}`}>{l}</a>)}</nav>
      </aside>
      <article className="docs-body">
        <div className="eyebrow">Docs</div>
        <h1>Export steps, formats and method</h1>
        <p className="lede">Runway needs four things: bank transactions (for recurring payments and your balance), open invoices, open bills, and invoice payment history (for how fast each customer really pays). Menu names below were checked in November 2026; vendors move buttons around, so the report names are the part to search for.</p>

        <h2 id="exports">Getting your data out</h2>
        <table className="rules-table">
          <thead><tr><th>What</th><th>Why Runway needs it</th><th>Best source</th></tr></thead>
          <tbody>
            <tr><td>Bank transactions, 12 to 24 months</td><td>Finds payroll, rent, subscriptions and annual bills; sets the opening balance</td><td>Your bank’s CSV, OFX or QFX download</td></tr>
            <tr><td>Open invoices</td><td>Money in, dated by when each customer actually pays</td><td>QuickBooks A/R Aging Detail, Xero Aged Receivables Detail</td></tr>
            <tr><td>Open bills</td><td>Money out, on terms</td><td>QuickBooks A/P Aging Detail, Xero Aged Payables Detail</td></tr>
            <tr><td>Invoices and payments, 12+ months</td><td>Days-to-pay per customer</td><td>QuickBooks Transaction List by Date</td></tr>
            <tr><td>Recurring templates (optional)</td><td>Schedules you already set up</td><td>QuickBooks Recurring Template List</td></tr>
          </tbody>
        </table>

        <h2 id="qbo">QuickBooks Online</h2>
        <p>In each report: set the date, then use the <b>Export</b> button (top right of the report) and choose <b>Export to Excel</b> or <b>Export to CSV</b>. Runway reads either; for Excel it uses the first sheet.</p>
        <ol className="steps-list">
          <li><b>A/R Aging Detail.</b> Reports → search “A/R Aging Detail”. Report period: <i>Today</i>. Aging method: <i>Current</i>. Keep the default columns (Date, Transaction type, Num, Customer, Due date, Past due, Amount, Open balance). Runway skips the bucket headings (“Current”, “1 - 30 days past due”) and totals, and flags unapplied payments by line number.</li>
          <li><b>A/P Aging Detail.</b> Same steps; the name column is Vendor.</li>
          <li><b>Transaction List by Date.</b> Reports → search “Transaction List by Date”. Period: last 12 to 24 months. Customize → Filter → Transaction type: Invoice, Payment, plus Expense, Check, Bill Payment, Deposit and Sales Receipt if you have no bank file. Columns: Date, Transaction type, Num, Name, Memo/Description, Due date, Amount. Runway matches each customer’s payments to their invoices oldest first to learn real days-to-pay.</li>
          <li><b>Recurring Template List</b> (optional). Reports → search “Recurring Template List”. Templates with Txn Type Invoice or Sales Receipt count as money in; everything else as money out. Intervals such as “Every 2 Weeks” or “Every 3 Months” are understood.</li>
          <li><b>Bank transactions.</b> Download from your bank (below) rather than QuickBooks, so the balance matches the bank. QuickBooks’ own bank register export also works.</li>
        </ol>

        <h2 id="xero">Xero</h2>
        <ol className="steps-list">
          <li><b>Aged Receivables Detail</b> and <b>Aged Payables Detail</b>: Accounting → Reports → search the name, set the date to today, Export → Excel (or Google Sheets, then download as CSV). On import, choose “A/R aging detail” or “A/P aging detail” if it is not detected, and map Contact, Invoice Date, Due Date and the balance due column.</li>
          <li><b>Bank lines</b>: download them straight from the bank (below) so the balance matches. The <b>Account Transactions</b> report (Reports, filtered to your bank account) also exports bank lines, and filtered to Accounts Receivable it gives invoice and payment history.</li>
        </ol>

        <h2 id="banks">Banks</h2>
        <table className="rules-table">
          <thead><tr><th>Bank</th><th>Where</th><th>Detected as</th></tr></thead>
          <tbody>
            <tr><td>Chase</td><td>Account → Download account activity → CSV</td><td>Details, Posting Date, Description, Amount, Type, Balance</td></tr>
            <tr><td>Bank of America</td><td>Account → Download transactions → Microsoft Excel format (CSV)</td><td>Date, Description, Amount, Running Bal. (summary lines above the header are skipped)</td></tr>
            <tr><td>Wells Fargo</td><td>Account activity → Download → Comma delimited</td><td>Headerless: date, amount, *, check number, description</td></tr>
            <tr><td>Capital One 360</td><td>Account → Download transactions → CSV</td><td>Unsigned Transaction Amount, signed by the Transaction Type column (Debit / Credit)</td></tr>
            <tr><td>Capital One cards and most others</td><td>Download transactions → CSV</td><td>Separate Debit and Credit columns are combined</td></tr>
            <tr><td>Any bank</td><td>Download → QuickBooks Web Connect (.qfx) or Money (.ofx)</td><td>OFX: transactions plus the ledger balance</td></tr>
          </tbody>
        </table>

        <h2 id="formats">Formats Runway reads</h2>
        <ul>
          <li>CSV (comma or tab) and Excel (.xlsx, .xls), quoted fields with commas and line breaks. Text encodings: UTF-8 with or without BOM, UTF-16 with BOM, and Windows-1252 (common in older bank and QFX files).</li>
          <li>Dates: 2026-03-14, 2026/03/14, 2026.03.14, 03/14/2026, 3/14/26, Mar 14 2026, 14-Mar-2026, and day-first 14/03/2026 (detected when a day is above 12, or tick “day first”).</li>
          <li>Amounts: $1,234.56, (1,234.56) and 1234.56- for negatives, US and Canadian dollars.</li>
          <li>OFX / QFX 1.x (SGML, no closing tags) and 2.x (XML, CDATA): STMTTRN blocks and LEDGERBAL, comma decimal amounts, HTML entities. Credit card statements (CCSTMTRS) import their charges and payments, but the card balance is never used as your cash balance.</li>
          <li>Bank of America’s “Beginning balance as of” row sets the balance instead of being reported as a bad row.</li>
          <li>Anything else with a date and an amount: map the columns yourself. The validation report lists every skipped row by line number and why.</li>
        </ul>

        <h2 id="method">How the forecast works</h2>
        <h3>Recurring payments</h3>
        <p>Bank descriptions are reduced to a payee key (“ACH DEBIT GUSTO PAYROLL 8812 PPD” → “gusto payroll”). For each payee the gaps between payments are matched to weekly (7 ± 1 days), every two weeks, twice monthly, monthly (30 ± 5), quarterly and annual. A series needs regular gaps in at least 70% of cases and each amount within 35% of the one before, which tolerates a growing payroll and seasons but rejects one-off purchases. Series that missed two cycles are treated as cancelled. The next amount follows the recent trend; with more than a year of history it is scaled by the same weeks last year, so a landscaper’s winter is not forecast like July.</p>
        <h3>Customer payments</h3>
        <p>Every paid invoice gives a days-late figure (payment date minus due date). An open invoice is expected on its due date plus that customer’s median lateness. Customers whose median is {`>=`} 15 days late (adjustable) are slow payers: Runway uses their slower 75th percentile and holds back a haircut (20% by default) as not arriving within 13 weeks. Invoices more than 120 days past due are treated as doubtful and left out. A promised date you enter overrides all of this. Open invoices replace the next recurring receipts from the same customer, so nothing is counted twice.</p>
        <h3>Bills</h3>
        <p>Open bills are paid on their due date (plus an optional stretch); overdue bills land tomorrow.</p>
        <h3>Banking days</h3>
        <p>Every forecast line that falls on a weekend or a US bank holiday moves to the next banking day, because ACH and wires only settle then. A rent run due Friday January 1 clears Monday January 4, in the following week. Holidays follow the Federal Reserve’s published rule (<a href="https://www.federalreserve.gov/aboutthefed/k8.htm">K.8 Holidays Observed</a>, checked November 2026 against the 2026 to 2028 table): a holiday on Sunday is observed Monday, one on Saturday is not observed. Canadian dollar businesses skip weekends only.</p>
        <h3>Safe to spend</h3>
        <p><b>Safe to spend = lowest balance in the next 13 weeks − minimum cash − reserve.</b> The reserve is the share of each annual or quarterly bill due after week 13 that has already built up since it was last paid (a $24,000 policy renewing in 4 months has accrued about $16,000). Bills due within 13 weeks are already in the forecast.</p>
        <h3>Collections ranking</h3>
        <p>For each customer, Runway pulls all of their open invoices into this week and re-runs the forecast. The rise in the low point is the ranking: chasing $10,000 that would otherwise land in week 3, before your low point in week 6, matters less than chasing $8,000 that would otherwise land in week 9.</p>
        <h3>Scenarios</h3>
        <p>Lose a client removes their receipts from the chosen week. A late payer shifts their receipts. A hire adds pay every two weeks from the Friday of the start week (salary × (1 + taxes and benefits) ÷ 26). A loan adds the draw and an amortized monthly payment on the same day of each following month (standard formula: P × r ÷ (1 − (1 + r)<sup>−n</sup>), r = APR ÷ 12). A price increase raises recurring receipts, not invoices already sent.</p>

        <h3>What the importers are tested against</h3>
        <p>Real OFX and QFX files from the public test suites of <a href="https://github.com/jseutter/ofxparse/tree/master/tests/fixtures">ofxparse</a> and <a href="https://github.com/actualbudget/actual/tree/master/packages/loot-core/src/mocks/files">Actual Budget</a> (both MIT), covering SGML and XML OFX, Windows-1252 and ISO-8859-1 text, comma decimals, CDATA, HTML entities and a credit card statement. Bank and QuickBooks CSV tests use the exact column layouts, title, bucket and footer rows of each export, with invented amounts.</p>

        <h2 id="weekly">The weekly routine</h2>
        <ol className="steps-list">
          <li>Monday: download last week’s bank lines and today’s A/R and A/P aging. Drop them on the Data tab; overlapping bank dates are replaced, not doubled.</li>
          <li>Check History: last week’s forecast is scored against what actually hit the bank.</li>
          <li>Work the Collections list, enter any promised dates.</li>
          <li>Press <kbd>S</kbd> to save this week’s forecast. Print the brief if someone else needs it.</li>
        </ol>

        <h2 id="privacy">Privacy</h2>
        <p>Files are parsed in your browser and stored in this browser’s IndexedDB. Nothing is uploaded unless you sign in. Signing in is optional and syncs your businesses through Supabase with row-level security, so only your account can read them. Settings, scenarios and saved weekly totals always sync when signed in; parsed transactions sync only if allowed in <Link href="/settings">Settings</Link> and under 1.5 MB per business. You can export everything as JSON, delete your cloud data, or delete your account from the account menu.</p>
        <p className="muted small">Runway is an independent project and not affiliated with Intuit, QuickBooks or Xero. Sample businesses are synthetic. A forecast is an estimate, not financial advice.</p>
      </article>
    </section>
  )
}
