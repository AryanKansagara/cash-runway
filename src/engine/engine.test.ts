import { test } from 'node:test'
import assert from 'node:assert/strict'
import { addDays, addMonths, parseDate, parseMoney } from './dates.ts'
import { apply, detect, fromTransactionList, merge, parseCsv, parseInterval } from './importer.ts'
import { amountAt, detectRecurring, partyKey, sameParty } from './recurring.ts'
import {
  accuracy, accuracyScore, applyScenario, balanceAt, buildInputs, collectionsWorklist, compareScenarios, forecast, forecastCollections,
  loanPayment, makeSnapshot, payStats, rollForward, schedulePayables, sinkingFunds, transferPlan, type Line,
} from './forecast.ts'
import { SAMPLES, datasetAt, generate } from './sample.ts'
import { DEFAULT_SETTINGS, EMPTY_DATASET, EMPTY_OVERRIDES, type Dataset, type Txn } from './types.ts'

const S = DEFAULT_SETTINGS
const ASOF = '2026-11-06'

function series(desc: string, start: string, n: number, stepFn: (d: string, i: number) => string, amount: (i: number) => number): Txn[] {
  const out: Txn[] = []
  let d = start
  for (let i = 0; i < n; i++) { out.push({ id: `${desc}${i}`, date: d, amount: amount(i), desc: `${desc} ${1000 + i}` }); d = stepFn(d, i) }
  return out
}

// ---------- parsing ----------

test('parses the date formats banks and QuickBooks export', () => {
  assert.equal(parseDate('2026-03-14'), '2026-03-14')
  assert.equal(parseDate('03/14/2026'), '2026-03-14')
  assert.equal(parseDate('3/4/26'), '2026-03-04')
  assert.equal(parseDate('14/03/2026', true), '2026-03-14')
  assert.equal(parseDate('20260314120000[-5:EST]'), '2026-03-14')
  assert.equal(parseDate('Mar 14, 2026'), '2026-03-14')
  assert.equal(parseDate('14-Mar-2026'), '2026-03-14')
  assert.equal(parseDate('02/30/2026'), null)
})

test('parses money with symbols, parentheses and trailing minus', () => {
  assert.equal(parseMoney('$1,234.56'), 123456)
  assert.equal(parseMoney('(1,234.56)'), -123456)
  assert.equal(parseMoney('-45'), -4500)
  assert.equal(parseMoney('12.30-'), -1230)
  assert.equal(parseMoney(''), null)
  assert.equal(parseMoney('abc'), null)
})

test('CSV parser handles quotes, embedded commas and newlines', () => {
  const rows = parseCsv('a,b\n"x, y","say ""hi""\nthere"\r\n1,2')
  assert.deepEqual(rows, [['a', 'b'], ['x, y', 'say "hi"\nthere'], ['1', '2']])
})

test('month arithmetic clamps to month end', () => {
  assert.equal(addMonths('2026-01-31', 1), '2026-02-28')
  assert.equal(addMonths('2026-02-28', 1, 31), '2026-03-31')
  assert.equal(addDays('2026-12-31', 1), '2027-01-01')
})

// ---------- import detection and validation ----------

test('detects a Chase CSV and maps signed amounts and the running balance', () => {
  const csv = 'Details,Posting Date,Description,Amount,Type,Balance,Check or Slip #\nDEBIT,11/02/2026,GUSTO PAYROLL,-24600.00,ACH_DEBIT,88000.00,\nCREDIT,11/03/2026,ACH DEP HALVERSON,47000.00,ACH_CREDIT,135000.00,\n'
  const p = detect(csv)!
  assert.equal(p.kind, 'bank')
  assert.match(p.format, /Chase/)
  const r = apply(p)
  assert.equal(r.imported, 2)
  assert.equal(r.data.txns![0].amount, -2460000)
  assert.deepEqual(r.data.balance, { amount: 13500000, date: '2026-11-03' })
})

test('debit and credit columns combine into one signed amount; bad rows are reported with line numbers', () => {
  const csv = 'Date,Description,Withdrawals,Deposits\n2026-11-01,Rent,9600.00,\n2026-11-02,Client,,5000\nnot a date,Oops,1,\n2026-11-03,Nothing,,\n'
  const r = apply(detect(csv)!)
  assert.deepEqual(r.data.txns!.map(t => t.amount), [-960000, 500000])
  assert.deepEqual(r.issues.map(i => i.line), [4, 5])
})

test('detects QuickBooks A/R Aging Detail with title rows and skips bucket and total rows', () => {
  const csv = [
    'Northbeam Studio', 'A/R Aging Detail', 'As of November 6, 2026', '',
    'Date,Transaction type,Num,Customer full name,Due date,Past due,Amount,Open balance',
    'Current,,,,,,,',
    '11/01/2026,Invoice,1201,Halverson Health,12/01/2026,0,"47,000.00","47,000.00"',
    'Total for Current,,,,,,,"47,000.00"',
    '1 - 30 days past due,,,,,,,',
    '10/01/2026,Invoice,1188,Tidewater Credit Union,10/31/2026,6,"14,500.00","14,500.00"',
    '10/20/2026,Payment,,Tidewater Credit Union,,,,-200.00',
    'TOTAL,,,,,,,"61,300.00"',
  ].join('\n')
  const p = detect(csv)!
  assert.equal(p.kind, 'ar')
  assert.match(p.format, /A\/R Aging Detail/)
  const r = apply(p)
  assert.equal(r.data.ar!.length, 2)
  assert.equal(r.data.ar![1].due, '2026-10-31')
  assert.ok(r.issues.some(i => /Unapplied payment/.test(i.msg) && i.line === 11))
})

test('detects A/P aging and the recurring template list', () => {
  const ap = apply(detect('A/P Aging Detail\nDate,Transaction type,Num,Vendor,Due date,Past due,Amount,Open balance\n10/20/2026,Bill,K-9,Studio Kiln,11/04/2026,2,8200,8200\n')!)
  assert.equal(ap.data.ap![0].vendor, 'Studio Kiln')
  const tp = detect('Recurring Template List\nTemplate Name,Type,Txn Type,Interval,Previous Date,Next Date,Customer/Vendor,Amount\nRetainer,Scheduled,Invoice,Every Month,11/01/2026,12/01/2026,Copperline Coffee,9800\nRent,Scheduled,Bill,Every 1 Month,11/01/2026,12/01/2026,Pearl District,9600\n')!
  assert.equal(tp.kind, 'templates')
  const t = apply(tp).data.templates!
  assert.equal(t[0].amount, 980000)
  assert.equal(t[1].amount, -960000)
  assert.equal(parseInterval('Every 2 Weeks'), 'biweekly')
  assert.equal(parseInterval('Every 3 Months'), 'quarterly')
})

test('OFX: statement transactions and the ledger balance', () => {
  const ofx = 'OFXHEADER:100\n<OFX><BANKMSGSRSV1><STMTTRNRS><STMTRS><BANKTRANLIST><STMTTRN><TRNTYPE>DEBIT<DTPOSTED>20261102<TRNAMT>-24600.00<FITID>A1<NAME>GUSTO PAYROLL</STMTTRN><STMTTRN><TRNTYPE>CREDIT<DTPOSTED>20261103<TRNAMT>47000<FITID>A2<NAME>HALVERSON &amp; CO</STMTTRN></BANKTRANLIST><LEDGERBAL><BALAMT>135000.00<DTASOF>20261103</LEDGERBAL></STMTRS></STMTTRNRS></BANKMSGSRSV1></OFX>'
  const r = apply(detect(ofx)!)
  assert.equal(r.imported, 2)
  assert.equal(r.data.txns![1].desc, 'HALVERSON & CO')
  assert.deepEqual(r.data.balance, { amount: 13500000, date: '2026-11-03' })
})

test('transaction list: payments match invoices oldest first to learn days-to-pay', () => {
  const { paid, cash } = fromTransactionList([
    { type: 'invoice', name: 'Acme', date: '2026-01-01', due: '2026-01-31', amount: 1000, num: '1', desc: '' },
    { type: 'invoice', name: 'Acme', date: '2026-02-01', due: '2026-03-03', amount: 1000, num: '2', desc: '' },
    { type: 'payment', name: 'Acme', date: '2026-03-10', amount: 1500, due: '', num: '', desc: '' },
    { type: 'expense', name: 'Landlord', date: '2026-03-01', amount: 900, due: '', num: '', desc: 'Rent' },
  ])
  assert.equal(paid.length, 1)
  assert.equal(paid[0].issued, '2026-01-01')
  assert.deepEqual(cash.map(c => c.amount).sort((a, b) => a - b), [-900, 1500])
})

test('merging a newer bank file replaces the overlapping range instead of doubling it', () => {
  const ds: Dataset = { ...EMPTY_DATASET, txns: [{ id: 'a', date: '2026-11-01', amount: 100, desc: 'x' }, { id: 'b', date: '2026-11-05', amount: 200, desc: 'y' }] }
  const next = merge(ds, 'bank', { txns: [{ id: 'c', date: '2026-11-05', amount: 200, desc: 'y' }, { id: 'd', date: '2026-11-06', amount: 50, desc: 'z' }] })
  assert.deepEqual(next.txns.map(t => t.id), ['a', 'c', 'd'])
})

// ---------- recurring detection ----------

test('party keys strip bank noise so the same payee groups together', () => {
  assert.equal(partyKey('ACH DEBIT GUSTO PAYROLL 8812 PPD ID:99'), 'gusto payroll')
  assert.ok(sameParty('Halverson Health', 'ACH DEP HALVERSON HEALTH SYS 1203'))
  assert.ok(!sameParty('Halverson Health', 'Tidewater Credit Union'))
})

test('detects biweekly payroll with amount drift and projects the trend', () => {
  const txns = series('GUSTO PAYROLL', '2026-01-02', 22, d => addDays(d, 14), i => -(2000000 + i * 10000))
  const [s] = detectRecurring(txns, '2026-11-06')
  assert.equal(s.cadence, 'biweekly')
  assert.equal(s.category, 'payroll')
  assert.equal(s.next, '2026-11-06')
  assert.equal(s.drift, -10000)
  assert.equal(s.amount, -(2000000 + 21 * 10000) - 10000)
})

test('detects weekly, monthly, quarterly and annual cadences and ignores one-off spend', () => {
  const txns = [
    ...series('MAVERIK FUEL', '2026-08-03', 14, d => addDays(d, 7), () => -12000),
    ...series('PEARL DISTRICT RENT', '2025-11-01', 13, d => addMonths(d, 1), () => -960000),
    ...series('IRS USATAXPYMT', '2025-01-15', 8, d => addMonths(d, 3), () => -1400000),
    ...series('HISCOX INSURANCE', '2025-03-14', 2, d => addMonths(d, 12), i => -(1980000 + i * 180000)),
    { id: 'x', date: '2026-06-01', amount: -500000, desc: 'APPLE STORE' },
  ]
  const by = Object.fromEntries(detectRecurring(txns, '2026-11-06').map(s => [s.category === 'other' ? s.label : s.category, s.cadence]))
  assert.equal(by['Maverik Fuel'], 'weekly')
  assert.equal(by.rent, 'monthly')
  assert.equal(by.tax, 'quarterly')
  assert.equal(by.insurance, 'annual')
  assert.ok(!('Apple Store' in by))
})

test('a series that stopped (cancelled subscription) is not projected', () => {
  const txns = series('ZOOM VIDEO', '2025-11-03', 6, d => addMonths(d, 1), () => -14999)
  assert.equal(detectRecurring(txns, '2026-11-06').length, 0)
})

test('seasonal series use last year’s shape for the same weeks', () => {
  // Weekly card deposits: 10k in summer, 4k in winter, for two years.
  const txns = series('SQUARE DEPOSIT', '2024-11-04', 105, d => addDays(d, 7), i => { const m = Number(addDays('2024-11-04', i * 7).slice(5, 7)); return (m >= 4 && m <= 10 ? 1000000 : 400000) })
  const s = detectRecurring(txns, '2026-11-06').find(x => x.direction === 'in')!
  assert.ok(amountAt(s, '2027-01-15') < amountAt(s, '2026-11-10') * 1.01)
  assert.ok(amountAt(s, '2027-01-15') < 600000)
})

// ---------- receivables and payables ----------

test('collections use each customer’s real lateness, not the due date, with a slow-payer haircut', () => {
  const paid = [0, 1, 2, 3].map(i => ({ customer: 'Halverson Health', issued: addMonths('2026-01-01', i), due: addMonths('2026-01-31', i), paid: addDays(addMonths('2026-01-31', i), 30 + i * 4), amount: 100 }))
  const stats = payStats(paid, 15)
  assert.equal(stats[0].slow, true)
  const [c] = forecastCollections([{ id: 'i1', customer: 'Halverson Health', num: '9', date: '2026-11-01', due: '2026-12-01', amount: 1000000 }], stats, ASOF, { ...S, haircutPct: 20 })
  assert.equal(c.expected, addDays('2026-12-01', stats[0].p75Late))
  assert.equal(c.amount, 800000)
  assert.equal(c.haircut, 200000)
})

test('no history: due date plus default lag; long overdue: doubtful; user date wins', () => {
  const inv = (id: string, due: string) => ({ id, customer: 'New Co', num: id, date: addDays(due, -30), due, amount: 50000 })
  const cs = forecastCollections([inv('a', '2026-11-20'), inv('b', '2026-05-01'), inv('c', '2026-11-20')], [], ASOF, S, { c: { expected: '2026-12-15' } })
  assert.equal(cs[0].expected, addDays('2026-11-20', S.defaultLag))
  assert.equal(cs[1].doubtful, true)
  assert.equal(cs[1].excluded, true)
  assert.equal(cs[2].expected, '2026-12-15')
})

test('bills are paid on terms; overdue bills land tomorrow', () => {
  const ps = schedulePayables([{ id: 'b1', vendor: 'V', num: '1', date: '2026-10-01', due: '2026-10-31', amount: 100 }, { id: 'b2', vendor: 'V', num: '2', date: '2026-11-01', due: '2026-12-01', amount: 100 }], ASOF, { ...S, payDelay: 5 })
  assert.equal(ps[0].date, '2026-11-07')
  assert.equal(ps[0].overdue, true)
  assert.equal(ps[1].date, '2026-12-06')
})

// ---------- roll-forward, safe to spend, scenarios ----------

const L = (date: string, amount: number, party = 'X', group: Line['group'] = amount > 0 ? 'revenue' : 'other'): Line => ({ id: `${party}${date}${amount}`, date, amount, label: party, group, party, source: 'test' })

test('13-week roll-forward finds the low point and the first week under minimum cash', () => {
  const f = rollForward([L('2026-11-09', -400000), L('2026-11-20', -500000), L('2026-12-01', 1200000)], 1000000, ASOF, 300000)
  assert.equal(f.weeks.length, 13)
  assert.equal(f.weeks[0].close, 600000)
  assert.equal(f.weeks[1].close, 100000)
  assert.deepEqual(f.low, { week: 2, amount: 100000 })
  assert.equal(f.breach, 2)
  assert.equal(f.end, 1300000)
  assert.equal(f.safeToSpend, 100000 - 300000)
})

test('sinking funds: annual bill after the horizon accrues into the reserve and a weekly set-aside', () => {
  const ins = detectRecurring(series('HISCOX INSURANCE', '2025-03-14', 2, d => addMonths(d, 12), () => -2600000), ASOF)
  const [f] = sinkingFunds(ins, ASOF)
  assert.equal(f.due, '2027-03-14')
  assert.equal(f.inHorizon, false)
  assert.ok(f.accrued > 1300000 && f.accrued < 1700000)
  assert.equal(f.perWeek, Math.ceil(2600000 / f.weeksLeft))
  const plan = transferPlan([f], ASOF)
  assert.equal(plan[0].weeks.length, 13)
  assert.equal(plan[0].total, f.perWeek * 13)
  const half = sinkingFunds(ins, ASOF, { [f.key]: { funded: 1300000 } })[0]
  assert.equal(half.perWeek, Math.ceil(1300000 / f.weeksLeft))
})

test('scenarios: lose a client, late payer, hire, loan and price increase each move the lines', () => {
  const lines = [L('2026-11-10', 500000, 'Halverson Health', 'ar'), L('2026-12-10', 500000, 'Halverson Health', 'revenue'), L('2026-11-12', 100000, 'Copperline', 'revenue')]
  assert.equal(applyScenario(lines, { id: 's', kind: 'lose-client', customer: 'Halverson Health', fromWeek: 3, on: true }, ASOF).length, 2)
  const late = applyScenario(lines, { id: 's', kind: 'late-payer', customer: 'Halverson', days: 30, on: true }, ASOF)
  assert.equal(late.find(l => l.group === 'ar')!.date, '2026-12-10')
  const hire = applyScenario([], { id: 'h', kind: 'hire', label: 'Designer', salary: 7800000, burdenPct: 20, fromWeek: 2, on: true }, ASOF)
  assert.equal(hire[0].date, '2026-11-20')
  assert.equal(hire[0].amount, -Math.round(7800000 * 1.2 / 26))
  assert.ok(hire.every((l, i) => i === 0 || l.date === addDays(hire[i - 1].date, 14)))
  const loan = applyScenario([], { id: 'l', kind: 'loan', amount: 5000000, week: 1, aprPct: 9, months: 24, on: true }, ASOF)
  assert.equal(loan[0].amount, 5000000)
  assert.equal(loan[1].amount, -loanPayment(5000000, 9, 24))
  assert.equal(loanPayment(1200000, 0, 12), 100000)
  const up = applyScenario(lines, { id: 'p', kind: 'price-increase', pct: 10, fromWeek: 1, on: true }, ASOF)
  assert.deepEqual(up.map(l => l.amount), [500000, 550000, 110000])
})

test('accuracy compares a saved forecast with the bank lines that arrived later', () => {
  const f = rollForward([L('2026-11-09', 300000), L('2026-11-10', -100000)], 1000000, ASOF, 0)
  const snap = makeSnapshot(f, 'x')
  const ds: Dataset = { ...EMPTY_DATASET, balance: { amount: 1000000, date: ASOF }, txns: [{ id: '1', date: '2026-11-09', amount: 250000, desc: 'in' }, { id: '2', date: '2026-11-11', amount: -100000, desc: 'out' }, { id: '3', date: '2026-11-13', amount: -5000, desc: 'fee' }] }
  const v = accuracy(snap, ds)
  assert.equal(v.length, 1)
  assert.equal(v[0].aIn, 250000)
  assert.equal(v[0].netVar, (250000 - 105000) - 200000)
  assert.equal(v[0].aClose, 1145000)
  assert.equal(balanceAt(ds, '2026-11-10'), 1250000)
  assert.ok(accuracyScore(v)! < 100)
})

// ---------- end to end on the synthetic businesses ----------

test('sample agency: slow top client is detected, ranked first to chase, and losing them breaches minimum cash', () => {
  const def = SAMPLES.find(s => s.id === 'northbeam')!
  const ds = datasetAt(generate(def, ASOF), ASOF)
  const s = { ...S, ...def.settings }
  const inp = buildInputs(ds, s, EMPTY_OVERRIDES, ASOF)
  assert.ok(inp.startKnown)
  assert.equal(inp.stats[0].customer, 'Halverson Health')
  assert.ok(inp.stats[0].slow)
  assert.ok(inp.funds.some(f => f.label.startsWith('Hiscox') && f.due.slice(5, 7) === '03'))
  assert.ok(inp.series.some(x => x.category === 'payroll' && x.cadence === 'biweekly'))
  const base = forecast(inp, s)
  const chase = collectionsWorklist(inp, s)
  assert.equal(chase[0].customer, 'Halverson Health')
  const cmp = compareScenarios(inp, s, [{ id: 'x', kind: 'lose-client', customer: 'Halverson Health', fromWeek: 1, on: true }])
  assert.equal(cmp.length, 2)
  assert.ok(cmp[1].f.low.amount < base.low.amount)
  assert.notEqual(cmp[1].f.breach, null)
})

test('sample landscaper: seasonal history is detected and AR is not double-counted with recurring receipts', () => {
  const def = SAMPLES.find(s => s.id === 'greenline')!
  const ds = datasetAt(generate(def, ASOF), ASOF)
  const s = { ...S, ...def.settings }
  const inp = buildInputs(ds, s, EMPTY_OVERRIDES, ASOF)
  const harbor = inp.lines.filter(l => sameParty(l.party, 'Harbor Ridge HOA'))
  const dates = harbor.map(l => l.date).sort()
  // No two Harbor Ridge receipts in the same fortnight: open invoices replace the recurring ones.
  assert.ok(dates.every((d, i) => i === 0 || addDays(dates[i - 1], 14) <= d))
  const f = forecast(inp, s)
  assert.equal(f.weeks.length, 13)
  assert.equal(f.weeks[12].close, f.end)
})

test('snapshot taken four weeks ago scores against what happened since', () => {
  const def = SAMPLES[0]
  const raw = generate(def, ASOF)
  const then = addDays(ASOF, -28)
  const s = { ...S, ...def.settings }
  const snap = makeSnapshot(forecast(buildInputs(datasetAt(raw, then), s, EMPTY_OVERRIDES, then), s), 'old')
  const v = accuracy(snap, datasetAt(raw, ASOF))
  assert.equal(v.length, 4)
  assert.equal(v[3].aClose, datasetAt(raw, ASOF).balance!.amount - datasetAt(raw, ASOF).txns.filter(t => t.date > v[3].end).reduce((a, t) => a + t.amount, 0))
})
