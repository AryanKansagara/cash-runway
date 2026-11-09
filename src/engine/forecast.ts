import { addDays, daysBetween } from './dates.ts'
import { amountAt, detectRecurring, fromTemplates, occurrences, sameParty, type Series } from './recurring.ts'
import type { Bill, Dataset, Invoice, Overrides, PaidInvoice, Scenario, Settings } from './types.ts'

export const WEEKS = 13

export type Group = 'ar' | 'revenue' | 'loan-in' | 'payroll' | 'rent' | 'ap' | 'software' | 'insurance' | 'tax' | 'loan' | 'utilities' | 'other'

export const GROUP_LABEL: Record<Group, string> = {
  ar: 'Customer invoices (A/R)', revenue: 'Recurring receipts', 'loan-in': 'Loan draws',
  payroll: 'Payroll', rent: 'Rent', ap: 'Bills (A/P)', software: 'Software and subscriptions', insurance: 'Insurance',
  tax: 'Taxes', loan: 'Loan payments', utilities: 'Utilities', other: 'Other recurring',
}
export const IN_GROUPS: Group[] = ['ar', 'revenue', 'loan-in']
export const OUT_GROUPS: Group[] = ['payroll', 'rent', 'ap', 'software', 'insurance', 'tax', 'loan', 'utilities', 'other']

/** One expected cash movement. Positive = in. */
export interface Line { id: string; date: string; amount: number; label: string; group: Group; party: string; source: string }

// ---------- Customer payment behaviour ----------

export interface PayStats { customer: string; invoices: number; medianDays: number; medianLate: number; p75Late: number; slow: boolean }

const pct = (xs: number[], p: number) => { const s = [...xs].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(p * (s.length - 1) + 0.5))] }

/** How each customer really pays: days from invoice to cash, and days past the due date. */
export function payStats(paid: PaidInvoice[], slowDays: number): PayStats[] {
  const by = new Map<string, PaidInvoice[]>()
  for (const p of paid) by.set(p.customer, [...(by.get(p.customer) ?? []), p])
  return [...by].map(([customer, l]) => {
    const late = l.map(p => daysBetween(p.due, p.paid))
    const medianLate = pct(late, 0.5)
    return { customer, invoices: l.length, medianDays: pct(l.map(p => daysBetween(p.issued, p.paid)), 0.5), medianLate, p75Late: pct(late, 0.75), slow: medianLate >= slowDays }
  }).sort((a, b) => b.medianLate - a.medianLate)
}

export const statsFor = (stats: PayStats[], customer: string) => stats.find(s => s.customer === customer) ?? stats.find(s => sameParty(s.customer, customer))

export interface Collection { invoice: Invoice; expected: string; amount: number; haircut: number; basis: string; doubtful: boolean; stats?: PayStats; excluded: boolean }

/**
 * When each open invoice will actually be paid: the due date plus that customer's usual lateness
 * (not the due date itself). Slow payers use their slower 75th percentile and lose a haircut share
 * beyond the horizon. Invoices more than 120 days past due are treated as doubtful.
 */
export function forecastCollections(ar: Invoice[], stats: PayStats[], asOf: string, s: Settings, ov: Overrides['invoices'] = {}): Collection[] {
  const first = addDays(asOf, 1)
  return ar.filter(i => i.amount !== 0).map(inv => {
    const st = statsFor(stats, inv.customer)
    const pastDue = daysBetween(inv.due, asOf)
    const doubtful = pastDue > 120
    let lag = st ? (st.slow ? st.p75Late : st.medianLate) : s.defaultLag
    lag = Math.max(lag, 0)
    let expected = addDays(inv.due, lag)
    let basis = st ? `${st.slow ? 'slow payer: 75th percentile' : 'usually'} ${lag} days after due, from ${st.invoices} paid invoice${st.invoices > 1 ? 's' : ''}` : `no history: due date + ${s.defaultLag} days`
    if (expected < first) { expected = addDays(asOf, 7); basis = `past their usual date: assumed next week` }
    const o = ov[inv.id]
    if (o?.expected) { expected = o.expected < first ? first : o.expected; basis = 'date you set' }
    const haircut = st?.slow && !o?.expected && inv.amount > 0 ? Math.round(inv.amount * s.haircutPct / 100) : 0
    return { invoice: inv, expected, amount: inv.amount - haircut, haircut, basis, doubtful, stats: st, excluded: !!o?.exclude || doubtful }
  })
}

export interface Payment { bill: Bill; date: string; excluded: boolean; overdue: boolean }

/** Bills are paid on their terms: the due date plus any stretch, never before tomorrow. */
export function schedulePayables(ap: Bill[], asOf: string, s: Settings, ov: Overrides['bills'] = {}): Payment[] {
  const first = addDays(asOf, 1)
  return ap.filter(b => b.amount !== 0).map(bill => {
    let date = ov[bill.id]?.pay ?? addDays(bill.due, s.payDelay)
    if (date < first) date = first
    return { bill, date, excluded: !!ov[bill.id]?.exclude, overdue: bill.due <= asOf }
  })
}

// ---------- Sinking funds ----------

export interface Fund { key: string; label: string; amount: number; cadence: 'quarterly' | 'annual'; due: string; weeksLeft: number; inHorizon: boolean; accrued: number; funded: number; perWeek: number; include: boolean }

/** Big quarterly and annual bills, spread into weekly set-asides so they stop being surprises. */
export function sinkingFunds(series: Series[], asOf: string, ov: Overrides['funds'] = {}): Fund[] {
  const end = addDays(asOf, WEEKS * 7)
  return series.filter(x => x.direction === 'out' && (x.cadence === 'annual' || x.cadence === 'quarterly')).map(x => {
    const amount = -x.amount
    const cycle = x.cadence === 'annual' ? 365 : 91
    let due = x.next
    while (due <= asOf) due = addDays(due, cycle)
    const days = daysBetween(asOf, due)
    const accrued = Math.round(amount * Math.max(0, Math.min(1, 1 - days / cycle)))
    const funded = ov[x.key]?.funded ?? 0
    const weeksLeft = Math.max(1, Math.ceil(days / 7))
    return { key: x.key, label: x.label, amount, cadence: x.cadence as Fund['cadence'], due, weeksLeft, inHorizon: due <= end, accrued, funded, perWeek: Math.max(0, Math.ceil((amount - funded) / weeksLeft)), include: ov[x.key]?.include ?? true }
  }).sort((a, b) => a.due.localeCompare(b.due))
}

/** Weekly transfers into each fund over the 13 weeks, stopping once the bill is paid. */
export function transferPlan(funds: Fund[], asOf: string) {
  return funds.filter(f => f.include).map(f => {
    const weeks = Array.from({ length: WEEKS }, (_, i) => {
      const start = addDays(asOf, i * 7 + 1)
      return start <= f.due && f.perWeek > 0 ? f.perWeek : 0
    })
    return { fund: f, weeks, total: weeks.reduce((a, b) => a + b, 0) }
  })
}

// ---------- Building the cash lines ----------

export interface Inputs {
  asOf: string
  start: number
  /** True when the opening balance came from the bank file or was typed in. */
  startKnown: boolean
  series: Series[]
  stats: PayStats[]
  collections: Collection[]
  payments: Payment[]
  funds: Fund[]
  lines: Line[]
}

export function asOfDate(ds: Dataset): string {
  const last = ds.txns.reduce((m, t) => t.date > m ? t.date : m, '')
  const b = ds.balance?.date ?? ''
  return (b > last ? b : last) || new Date().toISOString().slice(0, 10)
}

/** Balance at the end of `asOf`: the known balance rolled forward (or back) by the transactions in between. */
export function balanceAt(ds: Dataset, asOf: string): number | null {
  if (!ds.balance) return null
  const { amount, date } = ds.balance
  if (date <= asOf) return amount + ds.txns.filter(t => t.date > date && t.date <= asOf).reduce((a, t) => a + t.amount, 0)
  return amount - ds.txns.filter(t => t.date > asOf && t.date <= date).reduce((a, t) => a + t.amount, 0)
}

const GROUP_OF: Record<Series['category'], Group> = { payroll: 'payroll', rent: 'rent', software: 'software', insurance: 'insurance', tax: 'tax', loan: 'loan', utilities: 'utilities', revenue: 'revenue', other: 'other' }

export function buildInputs(ds: Dataset, s: Settings, ov: Overrides, asOf = asOfDate(ds)): Inputs {
  const history = ds.txns.filter(t => t.date <= asOf)
  const tpl = fromTemplates(ds.templates)
  const detected = detectRecurring(history, asOf).filter(d => !tpl.some(t => t.direction === d.direction && sameParty(t.label, d.label)))
  const series = [...tpl, ...detected].map(x => ov.series[x.key]?.amount !== undefined ? { ...x, amount: ov.series[x.key].amount! } : x)
  const stats = payStats(ds.paid.filter(p => p.paid <= asOf), s.slowDays)
  const collections = forecastCollections(ds.ar, stats, asOf, s, ov.invoices)
  const payments = schedulePayables(ds.ap, asOf, s, ov.bills)
  const funds = sinkingFunds(series, asOf, ov.funds)
  const first = addDays(asOf, 1), end = addDays(asOf, WEEKS * 7)
  const lines: Line[] = []
  for (const c of collections) {
    if (c.excluded || c.expected > end) continue
    lines.push({ id: c.invoice.id, date: c.expected, amount: c.amount, label: `${c.invoice.customer}${c.invoice.num ? ' #' + c.invoice.num : ''}`, group: 'ar', party: c.invoice.customer, source: 'ar' })
  }
  for (const p of payments) {
    if (p.excluded || p.date > end) continue
    lines.push({ id: p.bill.id, date: p.date, amount: -p.bill.amount, label: `${p.bill.vendor}${p.bill.num ? ' #' + p.bill.num : ''}`, group: 'ap', party: p.bill.vendor, source: 'ap' })
  }
  for (const x of series) {
    if (ov.series[x.key]?.include === false) continue
    // Open invoices and bills already cover the next receipts/payments from the same party.
    const covered = x.direction === 'in'
      ? collections.filter(c => !c.excluded && sameParty(c.invoice.customer, x.label)).map(c => c.expected)
      : payments.filter(p => !p.excluded && sameParty(p.bill.vendor, x.label)).map(p => p.date)
    const until = covered.length ? addDays(covered.sort().at(-1)!, cycleDays(x) / 2) : ''
    for (const d of occurrences(x, first, end)) {
      if (until && d <= until) continue
      lines.push({ id: `${x.key}@${d}`, date: d, amount: ov.series[x.key]?.amount ?? amountAt(x, d), label: x.label, group: GROUP_OF[x.category] ?? (x.amount > 0 ? 'revenue' : 'other'), party: x.label, source: x.key })
    }
  }
  const known = balanceAt(ds, asOf)
  return { asOf, start: known ?? 0, startKnown: known !== null, series, stats, collections, payments, funds, lines }
}

const cycleDays = (x: Series) => ({ weekly: 7, biweekly: 14, semimonthly: 15, monthly: 30, quarterly: 91, annual: 365 })[x.cadence]

// ---------- Scenarios ----------

export const weekStart = (asOf: string, week: number) => addDays(asOf, (Math.max(1, week) - 1) * 7 + 1)

/** Monthly payment on an amortizing loan. */
export function loanPayment(principal: number, aprPct: number, months: number) {
  const r = aprPct / 1200
  return Math.round(r === 0 ? principal / months : principal * r / (1 - Math.pow(1 + r, -months)))
}

export function applyScenario(lines: Line[], sc: Scenario, asOf: string): Line[] {
  const end = addDays(asOf, WEEKS * 7)
  switch (sc.kind) {
    case 'lose-client': {
      const from = weekStart(asOf, sc.fromWeek)
      return lines.filter(l => !(l.amount > 0 && l.date >= from && sameParty(l.party, sc.customer)))
    }
    case 'late-payer':
      return lines.flatMap(l => {
        if (!(l.amount > 0 && sameParty(l.party, sc.customer))) return [l]
        const d = addDays(l.date, sc.days)
        return d > end ? [] : [{ ...l, date: d }]
      })
    case 'price-increase': {
      const from = weekStart(asOf, sc.fromWeek)
      // Invoices already sent keep their price; future recurring receipts go up.
      return lines.map(l => l.group === 'revenue' && l.date >= from ? { ...l, amount: Math.round(l.amount * (1 + sc.pct / 100)) } : l)
    }
    case 'hire': {
      const per = Math.round(sc.salary * (1 + sc.burdenPct / 100) / 26)
      const add: Line[] = []
      // First paycheck on the Friday of the start week, then every two weeks.
      let d = weekStart(asOf, sc.fromWeek)
      while (new Date(d + 'T00:00:00Z').getUTCDay() !== 5) d = addDays(d, 1)
      for (; d <= end; d = addDays(d, 14)) add.push({ id: `${sc.id}@${d}`, date: d, amount: -per, label: sc.label || 'New hire', group: 'payroll', party: sc.label || 'New hire', source: sc.id })
      return [...lines, ...add]
    }
    case 'loan': {
      const draw = weekStart(asOf, sc.week)
      const add: Line[] = [{ id: `${sc.id}-draw`, date: draw, amount: sc.amount, label: 'Loan draw', group: 'loan-in', party: 'Loan', source: sc.id }]
      const pay = loanPayment(sc.amount, sc.aprPct, sc.months)
      for (let i = 1, d = addDays(draw, 30); i <= sc.months && d <= end; i++, d = addDays(draw, 30 * (i + 1))) add.push({ id: `${sc.id}-p${i}`, date: d, amount: -pay, label: 'Loan payment', group: 'loan', party: 'Loan', source: sc.id })
      return [...lines, ...add]
    }
  }
}

export const applyScenarios = (lines: Line[], scs: Scenario[], asOf: string) => scs.filter(s => s.on).reduce((l, s) => applyScenario(l, s, asOf), lines)

// ---------- Roll-forward ----------

export interface Week { i: number; start: string; end: string; open: number; inflow: number; outflow: number; close: number; byGroup: Partial<Record<Group, number>>; lines: Line[] }

export interface Forecast {
  asOf: string
  start: number
  weeks: Week[]
  low: { week: number; amount: number }
  /** First week the closing balance falls below the minimum cash line (1-based), or null. */
  breach: number | null
  /** Accrued share of big bills that fall after the horizon: money already spoken for. */
  reserve: number
  safeToSpend: number
  end: number
  minCash: number
}

export function rollForward(lines: Line[], start: number, asOf: string, minCash: number, reserve = 0): Forecast {
  const weeks: Week[] = []
  let bal = start
  for (let i = 0; i < WEEKS; i++) {
    const s = addDays(asOf, i * 7 + 1), e = addDays(asOf, i * 7 + 7)
    const ls = lines.filter(l => l.date >= s && l.date <= e)
    const byGroup: Partial<Record<Group, number>> = {}
    let inflow = 0, outflow = 0
    for (const l of ls) {
      byGroup[l.group] = (byGroup[l.group] ?? 0) + l.amount
      if (l.amount > 0) inflow += l.amount
      else outflow -= l.amount
    }
    const open = bal
    bal += inflow - outflow
    weeks.push({ i: i + 1, start: s, end: e, open, inflow, outflow, close: bal, byGroup, lines: ls })
  }
  const lowW = weeks.reduce((m, w) => w.close < m.close ? w : m, weeks[0])
  const low = lowW.close < start ? { week: lowW.i, amount: lowW.close } : { week: 0, amount: start }
  const b = weeks.find(w => w.close < minCash)
  return { asOf, start, weeks, low, breach: b ? b.i : null, reserve, safeToSpend: low.amount - minCash - reserve, end: bal, minCash }
}

/** Reserve: what the big bills after the horizon have already accrued. */
export const reserveOf = (funds: Fund[]) => funds.filter(f => f.include && !f.inHorizon).reduce((a, f) => a + f.accrued, 0)

export function forecast(inputs: Inputs, s: Settings, scenarios: Scenario[] = []): Forecast {
  return rollForward(applyScenarios(inputs.lines, scenarios, inputs.asOf), inputs.start, inputs.asOf, s.minCash, reserveOf(inputs.funds))
}

// ---------- Compare scenarios ----------

export interface ScenarioResult { id: string; label: string; f: Forecast; deltaLow: number; deltaEnd: number }

export function compareScenarios(inputs: Inputs, s: Settings, scs: Scenario[]): ScenarioResult[] {
  const base = forecast(inputs, s)
  const row = (id: string, label: string, list: Scenario[]): ScenarioResult => {
    const f = forecast(inputs, s, list)
    return { id, label, f, deltaLow: f.low.amount - base.low.amount, deltaEnd: f.end - base.end }
  }
  const out = [{ id: 'base', label: 'Base case', f: base, deltaLow: 0, deltaEnd: 0 }, ...scs.map(sc => row(sc.id, scenarioLabel(sc), [{ ...sc, on: true }]))]
  const on = scs.filter(x => x.on)
  if (on.length > 1) out.push(row('combined', 'All switched-on scenarios together', on))
  return out
}

export function scenarioLabel(sc: Scenario): string {
  const k = (c: number) => `$${Math.round(c / 100).toLocaleString('en-US')}`
  switch (sc.kind) {
    case 'lose-client': return `Lose ${sc.customer || 'a client'} from week ${sc.fromWeek}`
    case 'late-payer': return `${sc.customer || 'Top customer'} pays ${sc.days} days later`
    case 'hire': return `Hire ${sc.label || 'someone'} at ${k(sc.salary)}/yr from week ${sc.fromWeek}`
    case 'loan': return `Draw ${k(sc.amount)} loan in week ${sc.week} (${sc.aprPct}% APR, ${sc.months} mo)`
    case 'price-increase': return `Raise prices ${sc.pct}% from week ${sc.fromWeek}`
  }
}

// ---------- Collections worklist ----------

export interface Chase { customer: string; open: number; overdue: number; invoices: Collection[]; impact: number; stats?: PayStats; oldestDays: number }

/**
 * Who to chase this week. For each customer, pull every open invoice into week 1 and measure how much
 * the low point rises. That ranks by what actually protects the low point, not by invoice size.
 */
export function collectionsWorklist(inputs: Inputs, s: Settings, scenarios: Scenario[] = []): Chase[] {
  const base = forecast(inputs, s, scenarios)
  const by = new Map<string, Collection[]>()
  for (const c of inputs.collections) if (!c.excluded || c.doubtful) by.set(c.invoice.customer, [...(by.get(c.invoice.customer) ?? []), c])
  const first = addDays(inputs.asOf, 2)
  return [...by].map(([customer, cs]) => {
    const ids = new Set(cs.map(c => c.invoice.id))
    const pulled = [...inputs.lines.filter(l => !ids.has(l.id)), ...cs.filter(c => c.invoice.amount > 0).map(c => ({ id: c.invoice.id, date: first, amount: c.invoice.amount, label: customer, group: 'ar' as const, party: customer, source: 'ar' }))]
    const f = rollForward(applyScenarios(pulled, scenarios, inputs.asOf), inputs.start, inputs.asOf, s.minCash, base.reserve)
    const overdue = cs.filter(c => c.invoice.due <= inputs.asOf).reduce((a, c) => a + c.invoice.amount, 0)
    return { customer, open: cs.reduce((a, c) => a + c.invoice.amount, 0), overdue, invoices: cs, impact: f.low.amount - base.low.amount, stats: cs[0].stats, oldestDays: Math.max(...cs.map(c => daysBetween(c.invoice.due, inputs.asOf))) }
  }).filter(c => c.open > 0).sort((a, b) => b.impact - a.impact || b.overdue - a.overdue)
}

// ---------- Weekly snapshots and accuracy ----------

export interface SnapWeek { start: string; end: string; inflow: number; outflow: number; close: number }
export interface Snapshot { id: string; asOf: string; createdAt: number; label: string; start: number; weeks: SnapWeek[]; low: Forecast['low']; breach: number | null; safeToSpend: number; minCash: number; reserve: number; byGroup: Partial<Record<Group, number>> }

export function makeSnapshot(f: Forecast, id: string, label = `Week of ${f.asOf}`): Snapshot {
  const byGroup: Partial<Record<Group, number>> = {}
  for (const w of f.weeks) for (const [g, v] of Object.entries(w.byGroup)) byGroup[g as Group] = (byGroup[g as Group] ?? 0) + (v ?? 0)
  return { id, asOf: f.asOf, createdAt: Date.now(), label, start: f.start, weeks: f.weeks.map(w => ({ start: w.start, end: w.end, inflow: w.inflow, outflow: w.outflow, close: w.close })), low: f.low, breach: f.breach, safeToSpend: f.safeToSpend, minCash: f.minCash, reserve: f.reserve, byGroup }
}

export interface Variance { start: string; end: string; fIn: number; fOut: number; aIn: number; aOut: number; fClose: number; aClose: number | null; netVar: number }

/** Forecast vs what actually happened, for every forecast week that the bank data now covers. */
export function accuracy(snap: Snapshot, ds: Dataset): Variance[] {
  const lastData = ds.txns.reduce((m, t) => t.date > m ? t.date : m, '')
  return snap.weeks.filter(w => w.end <= lastData).map(w => {
    const ts = ds.txns.filter(t => t.date >= w.start && t.date <= w.end)
    const aIn = ts.filter(t => t.amount > 0).reduce((a, t) => a + t.amount, 0)
    const aOut = -ts.filter(t => t.amount < 0).reduce((a, t) => a + t.amount, 0)
    return { start: w.start, end: w.end, fIn: w.inflow, fOut: w.outflow, aIn, aOut, fClose: w.close, aClose: balanceAt(ds, w.end), netVar: (aIn - aOut) - (w.inflow - w.outflow) }
  })
}

/** 100 minus the average closing-balance miss as a share of the actual balance: one honest accuracy number. */
export function accuracyScore(v: Variance[]): number | null {
  const xs = v.filter(x => x.aClose !== null && x.aClose !== 0)
  if (!xs.length) return null
  const err = xs.reduce((a, x) => a + Math.abs(x.fClose - x.aClose!) / Math.abs(x.aClose!), 0) / xs.length
  return Math.max(0, Math.round((1 - err) * 100))
}

