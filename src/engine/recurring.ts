import { addDays, addMonths, daysBetween } from './dates.ts'
import type { Cadence, Template, Txn } from './types.ts'

export interface Series {
  key: string
  label: string
  direction: 'in' | 'out'
  cadence: Cadence
  /** Projected amount per occurrence, signed (negative = outflow). */
  amount: number
  /** Average change per occurrence (drift), signed cents. */
  drift: number
  last: string
  next: string
  count: number
  /** 0..1, how regular the dates and amounts are. */
  confidence: number
  category: 'payroll' | 'rent' | 'software' | 'insurance' | 'tax' | 'loan' | 'utilities' | 'revenue' | 'other'
  history: { date: string; amount: number }[]
  source: 'detected' | 'template'
}

const CADENCES: { cadence: Cadence; days: number; tol: number; min: number }[] = [
  { cadence: 'weekly', days: 7, tol: 1, min: 4 },
  { cadence: 'biweekly', days: 14, tol: 2, min: 3 },
  { cadence: 'semimonthly', days: 15.2, tol: 3, min: 4 },
  { cadence: 'monthly', days: 30.4, tol: 5, min: 3 },
  { cadence: 'quarterly', days: 91.3, tol: 10, min: 2 },
  { cadence: 'annual', days: 365, tol: 20, min: 2 },
]

const STOP = new Set(['ach', 'pos', 'debit', 'credit', 'card', 'purchase', 'payment', 'pmt', 'online', 'transfer', 'xfer', 'web', 'id', 'ppd', 'ccd', 'co', 'des', 'indn', 'recurring', 'autopay', 'withdrawal', 'deposit', 'dep', 'from', 'to', 'the', 'inc', 'llc', 'ltd', 'corp', 'electronic', 'bill', 'pay', 'check', 'chk', 'orig', 'entry', 'descr', 'www', 'com', 'mobile', 'wire', 'warrant', 'treasury', 'sys', 'of', 'usataxpymt', 'est', 'epayment', 'monthly', 'weekly', 'net', 'ach', 'in'])

/** "ACH DEBIT GUSTO PAYROLL 8812 PPD ID:..." -> "gusto payroll". Strips noise words and numbers. */
export function partyKey(desc: string): string {
  const words = desc.toLowerCase().replace(/[^a-z& ]+/g, ' ').split(/\s+/).filter(w => w.length > 1 && !STOP.has(w))
  return words.slice(0, 3).join(' ')
}

/** True when two names refer to the same customer or vendor ("Halverson Health" vs "ACH DEP HALVERSON HEALTH SYS"). */
export function sameParty(a: string, b: string): boolean {
  const ka = partyKey(a).split(' ').filter(Boolean), kb = partyKey(b).split(' ').filter(Boolean)
  if (!ka.length || !kb.length) return false
  return ka[0] === kb[0] || kb.includes(ka[0]) || ka.includes(kb[0])
}

export function categorize(label: string, amount: number): Series['category'] {
  const s = label.toLowerCase()
  if (amount > 0) return 'revenue'
  // Short names are matched as whole words: "irs" must not fire on "First National", nor "att" on "Matthews".
  if (/payroll|gusto|\badp\b|paychex|wages|salar|rippling|justworks/.test(s)) return 'payroll'
  if (/\brent\b|\brental|lease|landlord|properties|realty|cowork/.test(s)) return 'rent'
  if (/insur|hiscox|hartford|liberty mutual|progressive|state farm|nationwide|chubb|travelers|next insurance|policy/.test(s)) return 'insurance'
  if (/\birs\b|\btax|eftps|franchise tax|dept of rev|dept rev|department of revenue|\bcra\b/.test(s)) return 'tax'
  if (/loan|kabbage|ondeck|\bsba\b|lending|financ|capital one auto|equipment/.test(s)) return 'loan'
  if (/electric|power|\bgas\b|water|comcast|xfinity|verizon|at&t|\batt\b|t-mobile|internet|utilit|phone/.test(s)) return 'utilities'
  if (/adobe|google|microsoft|slack|zoom|figma|\baws\b|amazon web|github|notion|intuit|quickbooks|atlassian|hubspot|dropbox|software|saas|license/.test(s)) return 'software'
  return 'other'
}

const median = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2 }

function nextDate(cadence: Cadence, last: string, history: string[]): string {
  if (cadence === 'monthly' || cadence === 'quarterly' || cadence === 'annual') {
    const step = cadence === 'monthly' ? 1 : cadence === 'quarterly' ? 3 : 12
    // Use the usual day of month so a payment that slipped once does not drift the schedule.
    const dom = Math.round(median(history.map(d => Number(d.slice(8, 10)))))
    return addMonths(last, step, dom)
  }
  if (cadence === 'semimonthly') return Number(last.slice(8, 10)) < 15 ? addMonths(last, 0, 15) : addMonths(last, 1, 1)
  return addDays(last, cadence === 'weekly' ? 7 : 14)
}

/** Steps a series forward by one occurrence. */
export function step(cadence: Cadence, d: string, dom?: number): string {
  if (cadence === 'monthly') return addMonths(d, 1, dom)
  if (cadence === 'quarterly') return addMonths(d, 3, dom)
  if (cadence === 'annual') return addMonths(d, 12, dom)
  if (cadence === 'semimonthly') return Number(d.slice(8, 10)) < 15 ? addMonths(d, 0, 15) : addMonths(d, 1, 1)
  return addDays(d, cadence === 'weekly' ? 7 : 14)
}

/**
 * Finds payments that repeat on a schedule: same counterparty, regular gaps, similar amounts.
 * Amounts may drift (a growing payroll, a price rise); the projection follows the recent trend.
 * `asOf` is the last day of data: series that have stopped (missed two cycles) are dropped.
 */
export function detectRecurring(txns: Txn[], asOf: string): Series[] {
  const groups = new Map<string, Txn[]>()
  for (const t of txns) {
    const k = partyKey(t.name || t.desc)
    if (!k) continue
    const key = `${t.amount > 0 ? 'in' : 'out'}:${k}`
    const l = groups.get(key) ?? []
    l.push(t)
    groups.set(key, l)
  }
  const out: Series[] = []
  for (const [key, list] of groups) {
    const s = list.sort((a, b) => a.date.localeCompare(b.date))
    // Several charges on one day from the same party (e.g. two subscriptions) collapse into one occurrence.
    const byDay = new Map<string, number>()
    for (const t of s) byDay.set(t.date, (byDay.get(t.date) ?? 0) + t.amount)
    const occ = [...byDay].map(([date, amount]) => ({ date, amount }))
    if (occ.length < 2) continue
    const gaps = occ.slice(1).map((o, i) => daysBetween(occ[i].date, o.date))
    const g = median(gaps)
    const c = CADENCES.find(c => Math.abs(g - c.days) <= c.tol)
    if (!c || occ.length < c.min) continue
    const regular = gaps.filter(x => Math.abs(x - c.days) <= c.tol * 1.5).length / gaps.length
    if (regular < 0.7) continue
    const amts = occ.map(o => o.amount)
    const med = median(amts.slice(-8))
    // Each amount within 35% of the one before: tolerates drift and seasons, rejects one-off lumps.
    const similar = amts.slice(1).filter((a, i) => Math.abs(a - amts[i]) <= Math.abs(amts[i]) * 0.35).length / (amts.length - 1)
    if (similar < 0.7 || Math.sign(med) !== Math.sign(amts[amts.length - 1])) continue
    const last = occ[occ.length - 1]
    if (daysBetween(last.date, asOf) > c.days * 2 + c.tol) continue
    const recent = amts.slice(-4)
    const drift = recent.length > 1 ? Math.round((recent[recent.length - 1] - recent[0]) / (recent.length - 1)) : 0
    const lo = Math.min(med * 0.65, med * 1.35), hi = Math.max(med * 0.65, med * 1.35)
    const projected = Math.round(Math.min(hi, Math.max(lo, last.amount + drift)))
    const label = prettyLabel(s[s.length - 1].name || s[s.length - 1].desc)
    out.push({
      key, label, direction: med > 0 ? 'in' : 'out', cadence: c.cadence, amount: projected, drift, last: last.date,
      next: nextDate(c.cadence, last.date, occ.map(o => o.date)), count: occ.length,
      confidence: Math.round(Math.min(1, (regular * 0.5 + similar * 0.5) * Math.min(1, occ.length / (c.min + 2))) * 100) / 100,
      category: categorize(label, med), history: occ, source: 'detected',
    })
  }
  return out.sort((a, b) => a.amount - b.amount)
}

const ACRONYMS = new Set(['irs', 'adp', 'aws', 'hoa', 'cu', 'sd', 'llc', 'usa', 'bv', 'apts'])

export function prettyLabel(desc: string): string {
  const k = partyKey(desc)
  return k ? k.split(' ').map(w => ACRONYMS.has(w) ? w.toUpperCase() : w[0].toUpperCase() + w.slice(1)).join(' ') : desc.slice(0, 40)
}

/**
 * Amount expected on date d. With more than a year of history, scale the latest amount by how the
 * same weeks went last year (a landscaper's November is not its July); otherwise use the projection.
 */
export function amountAt(s: Series, d: string): number {
  const h = s.history
  if (h.length < 6 || daysBetween(h[0].date, s.last) < 380) return s.amount
  const around = (center: string) => {
    const xs = h.filter(o => Math.abs(daysBetween(center, o.date)) <= 21).map(o => o.amount)
    return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0
  }
  const then = around(addDays(d, -365)), base = around(addDays(s.last, -365))
  if (!then || !base || Math.sign(then) !== Math.sign(base)) return s.amount
  const f = Math.min(3, Math.max(0.3, then / base))
  return Math.round(s.history[h.length - 1].amount * f)
}

export function fromTemplates(ts: Template[]): Series[] {
  return ts.map(t => ({
    key: `tpl:${t.id}`, label: t.name, direction: t.amount > 0 ? 'in' : 'out', cadence: t.interval, amount: t.amount, drift: 0,
    last: '', next: t.next, count: 0, confidence: 1, category: categorize(t.name, t.amount), history: [], source: 'template' as const,
  }))
}

/** Every occurrence of a series in [from, to]. */
export function occurrences(s: Series, from: string, to: string): string[] {
  const out: string[] = []
  const dom = Number(s.next.slice(8, 10))
  let d = s.next
  // A missed occurrence (expected before `from` but not seen) is assumed to land on the first forecast day.
  while (d < from) { const n = step(s.cadence, d, dom); if (n >= from) { if (daysBetween(d, from) <= 7 && s.direction === 'out') out.push(from); } d = n }
  for (; d <= to; d = step(s.cadence, d, dom)) out.push(d)
  return out
}
