// Synthetic businesses. Every name, amount and date is invented; any resemblance to a real company is coincidence.
import { addDays, addMonths, daysBetween } from './dates.ts'
import type { Bill, Dataset, Invoice, PaidInvoice, Settings, Txn } from './types.ts'

export interface SampleDef {
  id: string
  name: string
  blurb: string
  location: string
  settings: Partial<Settings>
  build(asOf: string, rnd: () => number): Raw
}

interface Raw { invoices: (Invoice & { paid: string })[]; bills: (Bill & { paid: string })[]; txns: Txn[]; opening: number; from: string }

function rng(seed: number) {
  let a = seed >>> 0
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296 }
}
const gauss = (r: () => number) => { let s = 0; for (let i = 0; i < 6; i++) s += r(); return s - 3 }
const dollars = (n: number) => Math.round(n) * 100
const month = (d: string) => Number(d.slice(5, 7))
const weekday = (d: string) => new Date(d + 'T00:00:00Z').getUTCDay()
const bizDay = (d: string) => { while (weekday(d) === 0 || weekday(d) === 6) d = addDays(d, 1); return d }

interface Customer { name: string; bank: string; amount: (d: string, r: () => number) => number; every: 1 | 3; day: number; terms: number; late: number; sd: number; skip?: (d: string) => boolean }
interface Recur { desc: string; kind: 'monthly' | 'biweekly' | 'weekly' | 'quarterly' | 'annual'; anchor: string; amount: (d: string, r: () => number, i: number) => number }

function simulate(asOf: string, r: () => number, target: number, customers: Customer[], recurs: Recur[], extras: (from: string, to: string, push: (t: Txn) => void, bills: (Bill & { paid: string })[]) => void): Raw {
  const from = addDays(asOf, -730)
  const horizon = addDays(asOf, 120)
  const invoices: Raw['invoices'] = []
  const txns: Txn[] = []
  let n = 1
  const push = (t: Txn) => { if (t.date >= from && t.date <= asOf) txns.push(t) }
  for (const c of customers) {
    for (let d = addMonths(from.slice(0, 8) + '01', 0, c.day); d <= asOf; d = addMonths(d, c.every, c.day)) {
      if (c.skip?.(d)) continue
      const amount = c.amount(d, r)
      if (amount <= 0) continue
      const due = addDays(d, c.terms)
      const paid = bizDay(addDays(due, Math.max(-5, Math.round(c.late + gauss(r) * c.sd))))
      const num = String(1000 + n++)
      invoices.push({ id: `inv-${num}`, customer: c.name, num, date: d, due, amount, paid })
      push({ id: `t-${num}`, date: paid, amount, desc: `${c.bank} ${num}` })
    }
  }
  for (const x of recurs) {
    const step = (d: string) => x.kind === 'monthly' ? addMonths(d, 1) : x.kind === 'quarterly' ? addMonths(d, 3) : x.kind === 'annual' ? addMonths(d, 12) : addDays(d, x.kind === 'weekly' ? 7 : 14)
    let i = 0
    for (let d = x.anchor; d <= horizon; d = step(d), i++) {
      if (d < from) continue
      const a = x.amount(d, r, i)
      if (a) push({ id: `r-${n++}`, date: x.kind === 'biweekly' || x.kind === 'weekly' ? d : bizDay(d), amount: a, desc: x.desc })
    }
  }
  const bills: Raw['bills'] = []
  extras(from, asOf, push, bills)
  for (const b of bills) push({ id: `bp-${b.id}`, date: b.paid, amount: -b.amount, desc: `BILL PAY ${b.vendor.toUpperCase()} ${b.num}` })
  txns.sort((a, b) => a.date.localeCompare(b.date) || b.amount - a.amount)
  // `target` is the balance on asOf; the opening balance two years back is whatever gets there.
  return { invoices, bills, txns, opening: target - txns.reduce((a, t) => a + t.amount, 0), from }
}

/** The data as it looked at the end of `asOf`: open invoices and bills, paid history, bank lines, balance. */
export function datasetAt(raw: Raw, asOf: string): Dataset {
  const txns = raw.txns.filter(t => t.date <= asOf)
  const balance = raw.opening + txns.reduce((a, t) => a + t.amount, 0)
  return {
    txns,
    ar: raw.invoices.filter(i => i.date <= asOf && i.paid > asOf).map(({ paid: _p, ...i }) => i),
    ap: raw.bills.filter(b => b.date <= asOf && b.paid > asOf).map(({ paid: _p, ...b }) => b),
    paid: raw.invoices.filter(i => i.paid <= asOf).map(i => ({ customer: i.customer, issued: i.date, due: i.due, paid: i.paid, amount: i.amount }) satisfies PaidInvoice),
    templates: [],
    balance: { amount: balance, date: asOf },
  }
}

const agency: SampleDef = {
  id: 'northbeam',
  name: 'Northbeam Studio',
  location: 'Portland, OR',
  blurb: '12-person design agency. Top client pays 5 weeks late; insurance renews every March.',
  settings: { minCash: dollars(60000), haircutPct: 15 },
  build(asOf, r) {
    const yrs = (d: string) => daysBetween('2024-01-01', d) / 365
    return simulate(asOf, r, dollars(165000), [
      { name: 'Halverson Health', bank: 'ACH DEP HALVERSON HEALTH SYS', amount: d => dollars(47000 + 2000 * Math.floor(yrs(d))), every: 1, day: 1, terms: 30, late: 36, sd: 6 },
      { name: 'Tidewater Credit Union', bank: 'ACH DEP TIDEWATER CU', amount: () => dollars(14500), every: 1, day: 1, terms: 30, late: 9, sd: 4 },
      { name: 'Copperline Coffee', bank: 'MOBILE DEPOSIT COPPERLINE COFFEE', amount: () => dollars(9800), every: 1, day: 1, terms: 15, late: 2, sd: 2 },
      { name: 'Mesa Outdoor Co', bank: 'WIRE IN MESA OUTDOOR CO', amount: (_d, r) => dollars(24000 + r() * 6000), every: 1, day: 15, terms: 30, late: 12, sd: 4 },
      { name: 'Linden Foundation', bank: 'ACH DEP LINDEN FOUNDATION', amount: () => dollars(21000), every: 3, day: 5, terms: 45, late: 4, sd: 3 },
    ], [
      { desc: 'GUSTO PAYROLL NET PAY', kind: 'biweekly', anchor: '2024-01-05', amount: d => -dollars(24600 * (1 + 0.04 * yrs(d))) },
      { desc: 'GUSTO TAX IMPOUND', kind: 'biweekly', anchor: '2024-01-04', amount: d => -dollars(7200 * (1 + 0.04 * yrs(d))) },
      { desc: 'PEARL DISTRICT PROPERTIES RENT', kind: 'monthly', anchor: '2024-01-01', amount: () => -dollars(9600) },
      { desc: 'ADOBE *CREATIVE CLOUD', kind: 'monthly', anchor: '2024-01-08', amount: () => -dollars(1139) },
      { desc: 'GOOGLE *WORKSPACE', kind: 'monthly', anchor: '2024-01-02', amount: () => -dollars(264) },
      { desc: 'FIGMA MONTHLY', kind: 'monthly', anchor: '2024-01-12', amount: () => -dollars(540) },
      { desc: 'AMEX EPAYMENT ACH PMT', kind: 'monthly', anchor: '2024-01-22', amount: (_d, r) => -dollars(5200 + r() * 3600) },
      { desc: 'PORTLAND GENERAL ELECTRIC', kind: 'monthly', anchor: '2024-01-18', amount: d => -dollars([11, 12, 1, 2].includes(month(d)) ? 690 : 470) },
      { desc: 'HISCOX INSURANCE POLICY RENEWAL', kind: 'annual', anchor: '2024-03-14', amount: d => -dollars(19800 + 1800 * Math.floor(yrs(d))) },
      { desc: 'IRS USATAXPYMT EST TAX', kind: 'quarterly', anchor: '2024-01-15', amount: () => -dollars(14000) },
      { desc: 'ATLASSIAN ANNUAL LICENSE', kind: 'annual', anchor: '2024-01-21', amount: () => -dollars(6400) },
      { desc: 'OREGON DEPT OF REV CAT TAX', kind: 'annual', anchor: '2024-04-28', amount: () => -dollars(3900) },
    ], (from, to, _push, bills) => {
      let k = 1
      for (let d = addMonths(from.slice(0, 8) + '01', 0, 5); d <= to; d = addMonths(d, 1)) {
        const num = `SK-${k++}`
        bills.push({ id: `b-${num}`, vendor: 'Studio Kiln Contractors', num, date: d, due: addDays(d, 15), amount: dollars(6800 + r() * 3000), paid: bizDay(addDays(d, 15)) })
        if (r() < 0.5) {
          const pn = `RP-${k++}`
          bills.push({ id: `b-${pn}`, vendor: 'Ridgeline Printing', num: pn, date: addDays(d, 8), due: addDays(d, 38), amount: dollars(900 + r() * 2600), paid: bizDay(addDays(d, 40)) })
        }
      }
      bills.push({ id: 'b-FR-77', vendor: 'Fieldwork Research', num: 'FR-77', date: addDays(to, -20), due: addDays(to, 25), amount: dollars(11500), paid: addDays(to, 25) })
    })
  },
}

const landscaping: SampleDef = {
  id: 'greenline',
  name: 'Greenline Landscaping',
  location: 'Boise, ID',
  blurb: 'Seasonal crew of 6 to 18. Busy April to October, thin winters, an equipment loan.',
  settings: { minCash: dollars(30000), haircutPct: 25 },
  build(asOf, r) {
    const season = (d: string) => [0, 0.25, 0.3, 0.55, 1, 1.15, 1.2, 1.15, 1.1, 1, 0.8, 0.45, 0.3][month(d)]
    const crew = (d: string) => [0, 0.42, 0.42, 0.55, 0.9, 1, 1, 1, 1, 1, 0.92, 0.6, 0.42][month(d)]
    return simulate(asOf, r, dollars(96000), [
      { name: 'Harbor Ridge HOA', bank: 'ACH DEP HARBOR RIDGE HOA', amount: d => dollars(14000 * season(d)), every: 1, day: 1, terms: 30, late: 22, sd: 8 },
      { name: 'Boise Valley Medical Plaza', bank: 'ACH DEP BV MEDICAL PLAZA', amount: d => dollars(8200 * Math.max(0.5, season(d))), every: 1, day: 1, terms: 30, late: 6, sd: 3 },
      { name: 'Cedar Point Apartments', bank: 'ACH DEP CEDAR POINT APTS', amount: d => dollars(6400 * season(d)), every: 1, day: 1, terms: 30, late: 14, sd: 6 },
      { name: 'Foothills School District', bank: 'TREASURY WARRANT FOOTHILLS SD', amount: d => month(d) >= 4 && month(d) <= 10 ? dollars(9800) : 0, every: 1, day: 10, terms: 45, late: 18, sd: 9 },
    ], [
      { desc: 'SQUARE INC DEPOSIT', kind: 'weekly', anchor: '2024-01-02', amount: (d, r) => dollars((8600 + r() * 1800) * season(d)) },
      { desc: 'ADP PAYROLL WEEKLY', kind: 'weekly', anchor: '2024-01-05', amount: d => -dollars(9400 * crew(d)) },
      { desc: 'MAVERIK FUEL FLEET', kind: 'weekly', anchor: '2024-01-03', amount: (d, r) => -dollars((1100 + r() * 300) * Math.max(0.35, crew(d))) },
      { desc: 'JOHN DEERE FINANCIAL LOAN PMT', kind: 'monthly', anchor: '2024-01-10', amount: () => -dollars(2850) },
      { desc: 'TREASURE VALLEY YARD LEASE RENT', kind: 'monthly', anchor: '2024-01-01', amount: () => -dollars(4200) },
      { desc: 'IDAHO POWER UTILITY', kind: 'monthly', anchor: '2024-01-16', amount: d => -dollars(240 + 260 * season(d)) },
      { desc: 'JOBBER SOFTWARE', kind: 'monthly', anchor: '2024-01-09', amount: () => -dollars(349) },
      { desc: 'PROGRESSIVE COMMERCIAL INSURANCE', kind: 'annual', anchor: '2024-04-02', amount: () => -dollars(14200) },
      { desc: 'IRS USATAXPYMT EST TAX', kind: 'quarterly', anchor: '2024-01-15', amount: d => -dollars(month(d) === 1 ? 6600 : 7600) },
      { desc: 'CITY OF BOISE BUSINESS LICENSE', kind: 'annual', anchor: '2024-01-29', amount: () => -dollars(1850) },
    ], (from, to, _push, bills) => {
      let k = 1
      for (let d = addMonths(from.slice(0, 8) + '01', 0, 3); d <= to; d = addMonths(d, 1)) {
        const s = season(d)
        const num = `NS-${k++}`
        bills.push({ id: `b-${num}`, vendor: 'Snake River Nursery Supply', num, date: d, due: addDays(d, 30), amount: dollars(800 + 6800 * s * (0.8 + r() * 0.4)), paid: bizDay(addDays(d, 30)) })
      }
      bills.push({ id: 'b-SA-412', vendor: 'Summit Salt and Ice Melt', num: 'SA-412', date: addDays(to, -6), due: addDays(to, 24), amount: dollars(6900), paid: addDays(to, 24) })
    })
  },
}

export const SAMPLES: SampleDef[] = [agency, landscaping]

export function generate(def: SampleDef, asOf: string): Raw {
  return def.build(asOf, rng([...def.id].reduce((a, c) => a * 31 + c.charCodeAt(0), 7)))
}
