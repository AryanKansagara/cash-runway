// Fixtures follow the real export layouts (column names, title and footer rows, quoting) of each source.
// OFX excerpts are trimmed from the MIT-licensed test files of ofxparse (github.com/jseutter/ofxparse)
// and Actual Budget (github.com/actualbudget/actual, packages/loot-core/src/mocks/files).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseDate } from './dates.ts'
import { apply, decodeText, detect } from './importer.ts'
import { categorize } from './recurring.ts'
import { applyScenario, loanPayment, type Line } from './forecast.ts'

const run = (text: string, name = '') => { const p = detect(text, name)!; return { p, a: apply(p) } }

test('Bank of America checking CSV: summary block skipped, beginning balance row becomes the balance', () => {
  const csv = [
    'Description,,Summary Amt.',
    'Beginning balance as of 10/01/2026,,"41,250.00"',
    'Total credits,,"62,400.00"',
    'Total debits,,"-48,115.37"',
    'Ending balance as of 10/31/2026,,"55,534.63"',
    '',
    'Date,Description,Amount,Running Bal.',
    '10/01/2026,Beginning balance as of 10/01/2026,,"41,250.00"',
    '10/02/2026,"GUSTO DES:NET 260930 ID:7XXXXX INDN:NORTHBEAM STUDIO CO ID:XXXXX1234 CCD","-24,600.00","16,650.00"',
    '10/03/2026,"HALVERSON HEALTH DES:ACH PMT ID:XXXXX88 INDN:NORTHBEAM CO ID:XXXXX CCD","47,000.00","63,650.00"',
  ].join('\n')
  const { p, a } = run(csv, 'stmt.csv')
  assert.equal(p.format, 'Bank CSV (Bank of America layout)')
  assert.equal(a.imported, 2)
  assert.equal(a.issues.length, 0)
  assert.deepEqual(a.data.txns!.map(t => t.amount), [-2460000, 4700000])
  assert.deepEqual(a.data.balance, { amount: 6365000, date: '2026-10-03' })
})

test('Capital One 360 CSV: unsigned amounts are signed by the Debit/Credit column', () => {
  const csv = 'Account Number,Transaction Description,Transaction Date,Transaction Type,Transaction Amount,Balance\n' +
    '3601,Withdrawal to PEARL DISTRICT PROPERTIES,10/01/26,Debit,9600.00,30400.00\n' +
    '3601,Deposit from COPPERLINE COFFEE,10/02/26,Credit,9800.00,40200.00\n'
  const { a } = run(csv)
  assert.deepEqual(a.data.txns!.map(t => [t.date, t.amount]), [['2026-10-01', -960000], ['2026-10-02', 980000]])
  assert.deepEqual(a.data.balance, { amount: 4020000, date: '2026-10-02' })
})

test('Chase credit card CSV: Transaction Date wins over Post Date, purchases stay negative', () => {
  const csv = 'Transaction Date,Post Date,Description,Category,Type,Amount,Memo\n10/28/2026,10/29/2026,FIGMA MONTHLY,Shopping,Sale,-540.00,\n10/30/2026,10/30/2026,Payment Thank You-Mobile,,Payment,1200.00,\n'
  const { a } = run(csv)
  assert.deepEqual(a.data.txns!.map(t => [t.date, t.amount]), [['2026-10-28', -54000], ['2026-10-30', 120000]])
})

test('QuickBooks Online A/R Aging Detail (current layout): leading blank column, $ totals and the footer line', () => {
  const csv = [
    'A/R Aging Detail Report', 'Northbeam Studio', '"As of November 13, 2026"', '',
    ',Date,Transaction type,Num,Customer full name,Due date,Past due,Amount,Open balance',
    'Current,,,,,,,,',
    ',11/01/2026,Invoice,1041,Halverson Health,12/01/2026,-18,"47,000.00","47,000.00"',
    'Total for Current,,,,,,,"$47,000.00","$47,000.00"',
    '31 - 60 days past due,,,,,,,,',
    ',09/01/2026,Invoice,1032,Mesa Outdoor Co,10/01/2026,43,"26,412.50","12,000.00"',
    ',09/20/2026,Payment,,Mesa Outdoor Co,09/20/2026,54,-500.00,-500.00',
    'Total for 31 - 60 days past due,,,,,,,"$25,912.50","$11,500.00"',
    'TOTAL,,,,,,,"$72,912.50","$58,500.00"', '', '',
    '"Accrual Basis Friday, November 13, 2026 08:25 AM GMT-05:00"',
  ].join('\n')
  const { p, a } = run(csv, 'Northbeam Studio_A_R Aging Detail Report.csv')
  assert.equal(p.kind, 'ar')
  assert.equal(p.format, 'QuickBooks Online: A/R Aging Detail')
  assert.deepEqual(a.data.ar!.map(i => [i.customer, i.num, i.due, i.amount]), [['Halverson Health', '1041', '2026-12-01', 4700000], ['Mesa Outdoor Co', '1032', '2026-10-01', 1200000]])
  assert.equal(a.issues.length, 1)
  assert.equal(a.issues[0].line, 11)
  assert.match(a.issues[0].msg, /Unapplied payment/)
})

test('QuickBooks Online A/P Aging Detail: Vendor column, Past due days are not read as the due date', () => {
  const csv = 'A/P Aging Detail\nNorthbeam Studio\n"As of November 13, 2026"\n\nDate,Transaction Type,Num,Vendor,Due Date,Past Due,Amount,Open Balance\n1 - 30 days past due,,,,,,,\n10/20/2026,Bill,H-7731,Hiscox,11/04/2026,9,"19,800.00","19,800.00"\nTotal for 1 - 30 days past due,,,,,,"$19,800.00","$19,800.00"\n'
  const { p, a } = run(csv)
  assert.equal(p.kind, 'ap')
  assert.deepEqual(a.data.ap!.map(b => [b.vendor, b.due, b.amount]), [['Hiscox', '2026-11-04', 1980000]])
})

test('QuickBooks Online Recurring Template List: the interval wording QuickBooks shows', () => {
  const csv = 'Recurring Template List\nNorthbeam Studio\n\nTemplate Name,Type,Txn Type,Interval,Previous Date,Next Date,Customer/Vendor,Amount\n' +
    'Linden retainer,Scheduled,Invoice,Every 3 Months on day 5,10/05/2026,01/05/2027,Linden Foundation,"21,000.00"\n' +
    'Office rent,Scheduled,Bill,Every Month on day 1st,11/01/2026,12/01/2026,Pearl District Properties,"9,600.00"\n' +
    'Payroll float,Reminder,Transfer,Every 2 Weeks on Friday,11/06/2026,11/20/2026,,"24,600.00"\n' +
    'Insurance,Scheduled,Bill,Every Year on March 14th,03/14/2026,03/14/2027,Hiscox,"19,800.00"\n'
  const { p, a } = run(csv)
  assert.equal(p.kind, 'templates')
  assert.deepEqual(a.data.templates!.map(t => [t.interval, t.next, t.amount]), [['quarterly', '2027-01-05', 2100000], ['monthly', '2026-12-01', -960000], ['biweekly', '2026-11-20', -2460000], ['annual', '2027-03-14', -1980000]])
})

test('OFX with comma decimals (allowed by the spec) is not read 100 times too large', () => {
  const ofx = '<OFX><BANKMSGSRSV1><STMTTRNRS><STMTRS><BANKTRANLIST>\n<STMTTRN>\n<TRNTYPE>DEBIT\n<DTPOSTED>20190123120000.000[-5:EST]\n<TRNAMT>-19,78\n<FITID>a1\n<NAME>PATIENT FIRST TOKEN 01/22 PURCHA\n</STMTTRN>\n<STMTTRN>\n<TRNTYPE>CREDIT\n<DTPOSTED>20190123\n<TRNAMT>+150,00\n<FITID>a2\n<NAME>REFUND\n</STMTTRN>\n</BANKTRANLIST><LEDGERBAL><BALAMT>1234,56<DTASOF>20190124</LEDGERBAL></STMTRS></STMTTRNRS></BANKMSGSRSV1></OFX>'
  const { a } = run(ofx)
  assert.deepEqual(a.data.txns!.map(t => t.amount), [-1978, 15000])
  assert.deepEqual(a.data.balance, { amount: 123456, date: '2019-01-24' })
})

test('OFX 2.x CDATA names, payee repeated in the memo, entities and number-only NAME fields', () => {
  const ofx = '<?xml version="1.0"?><OFX><STMTTRN><TRNTYPE>DEBIT</TRNTYPE><DTPOSTED>20131215</DTPOSTED><TRNAMT>-16.85</TRNAMT><FITID>1</FITID>' +
    '<NAME><![CDATA[EFTPOS WDL HANDYWAY ALDI STORE  ]]></NAME><MEMO><![CDATA[EFTPOS WDL HANDYWAY ALDI STORE   GEELONG WEST VICAU]]></MEMO></STMTTRN>' +
    '<STMTTRN><TRNTYPE>DEBIT<DTPOSTED>20230509120000.000[-5:EST]<TRNAMT>-1.00<FITID>2<NAME>000000000000000<MEMO>PREAUTHORIZED DEBIT;B.C. HYDRO &amp; POWER AUTHORITY</STMTTRN>' +
    '<STMTTRN><TRNTYPE>DEBIT<DTPOSTED>20230301<TRNAMT>-1.00<FITID>3<NAME>TPAY &amp;lt;DEFTPYMT&amp;gt;<MEMO>LUXMORE REALTY</STMTTRN></OFX>'
  const { a } = run(ofx)
  assert.deepEqual(a.data.txns!.map(t => t.desc), ['EFTPOS WDL HANDYWAY ALDI STORE GEELONG WEST VICAU', 'PREAUTHORIZED DEBIT;B.C. HYDRO & POWER AUTHORITY', 'TPAY &lt;DEFTPYMT&gt; · LUXMORE REALTY'])
})

test('credit card OFX: charges import, the card balance is not taken as cash', () => {
  const ofx = '<OFX><CREDITCARDMSGSRSV1><CCSTMTTRNRS><CCSTMTRS><BANKTRANLIST><STMTTRN><TRNTYPE>DEBIT<DTPOSTED>20230330<TRNAMT>-6.00<FITID>x<NAME>LOUISIANA STATE MUSEUM</STMTTRN></BANKTRANLIST><LEDGERBAL><BALAMT>-9654.01<DTASOF>20230331</LEDGERBAL></CCSTMTRS></CCSTMTTRNRS></CREDITCARDMSGSRSV1></OFX>'
  const { p, a } = run(ofx)
  assert.equal(p.format, 'OFX credit card statement')
  assert.equal(a.data.txns!.length, 1)
  assert.equal(a.data.balance, undefined)
  assert.equal(a.issues[0].level, 'warning')
})

test('file bytes: Windows-1252 QFX and UTF-16 CSV decode instead of turning into replacement characters', () => {
  const cp1252 = new Uint8Array([0x43, 0x61, 0x66, 0xe9, 0x20, 0x80]) // "Café €" in Windows-1252
  assert.equal(decodeText(cp1252), 'Café €')
  const utf16 = new Uint8Array([0xff, 0xfe, ...[...'Date,Amount'].flatMap(c => [c.charCodeAt(0), 0])])
  assert.equal(decodeText(utf16), 'Date,Amount')
  assert.equal(decodeText(new TextEncoder().encode('Mémo')), 'Mémo')
})

test('year-first dates with dots or slashes (European and Asian bank exports)', () => {
  assert.equal(parseDate('2025.12.04'), '2025-12-04')
  assert.equal(parseDate('2025/12/04'), '2025-12-04')
})

test('categories: short payee names match whole words only', () => {
  assert.equal(categorize('First Citizens Loan', -100), 'loan')
  assert.equal(categorize('IRS', -100), 'tax')
  assert.equal(categorize('Matthews Design', -100), 'other')
  assert.equal(categorize('Parent Co Transfer', -100), 'other')
  assert.equal(categorize('Oregon Dept Rev', -100), 'tax')
  assert.equal(categorize('Xfinity Business', -100), 'utilities')
})

test('loan scenario: monthly payments on the draw day each month, amortized like a bank schedule', () => {
  // $50,000 at 12% APR over 12 months: $4,442.44 a month (standard amortization formula).
  assert.equal(loanPayment(5_000_000, 12, 12), 444244)
  const lines = applyScenario([] as Line[], { id: 'l', kind: 'loan', amount: 5_000_000, week: 1, aprPct: 12, months: 12, on: true }, '2026-11-06')
  assert.deepEqual(lines.map(l => [l.date, l.amount]), [['2026-11-07', 5_000_000], ['2026-12-07', -444244], ['2027-01-07', -444244]])
})
