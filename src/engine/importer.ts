import { addDays, parseDate, parseMoney } from './dates.ts'
import type { Bill, Dataset, Invoice, PaidInvoice, Template, Txn } from './types.ts'

export type Kind = 'bank' | 'ar' | 'ap' | 'txlist' | 'templates'

export const KIND_LABEL: Record<Kind, string> = {
  bank: 'Bank transactions',
  ar: 'A/R aging detail (open invoices)',
  ap: 'A/P aging detail (open bills)',
  txlist: 'Transaction list (invoices and payments)',
  templates: 'Recurring template list',
}

export const FIELDS: Record<Kind, { key: string; label: string; required?: boolean }[]> = {
  bank: [{ key: 'date', label: 'Date', required: true }, { key: 'desc', label: 'Description', required: true }, { key: 'amount', label: 'Amount (signed)' }, { key: 'debit', label: 'Debit / withdrawal' }, { key: 'credit', label: 'Credit / deposit' }, { key: 'balance', label: 'Running balance' }],
  ar: [{ key: 'date', label: 'Invoice date', required: true }, { key: 'name', label: 'Customer', required: true }, { key: 'num', label: 'Invoice #' }, { key: 'due', label: 'Due date' }, { key: 'open', label: 'Open balance', required: true }, { key: 'type', label: 'Transaction type' }],
  ap: [{ key: 'date', label: 'Bill date', required: true }, { key: 'name', label: 'Vendor', required: true }, { key: 'num', label: 'Bill #' }, { key: 'due', label: 'Due date' }, { key: 'open', label: 'Open balance', required: true }, { key: 'type', label: 'Transaction type' }],
  txlist: [{ key: 'date', label: 'Date', required: true }, { key: 'type', label: 'Transaction type', required: true }, { key: 'num', label: 'Num' }, { key: 'name', label: 'Name', required: true }, { key: 'desc', label: 'Memo / description' }, { key: 'due', label: 'Due date' }, { key: 'amount', label: 'Amount', required: true }],
  templates: [{ key: 'name', label: 'Template name', required: true }, { key: 'type', label: 'Transaction type', required: true }, { key: 'interval', label: 'Interval', required: true }, { key: 'next', label: 'Next date', required: true }, { key: 'party', label: 'Customer / vendor' }, { key: 'amount', label: 'Amount', required: true }],
}

export type Mapping = Record<string, number>

export interface Issue { line: number; level: 'error' | 'warning'; msg: string }

export interface Parsed {
  kind: Kind
  format: string
  headerRow: number
  header: string[]
  rows: string[][]
  mapping: Mapping
  dayFirst: boolean
  balance?: { amount: number; date: string }
  /** OFX is already structured, so it skips mapping. */
  ofx?: Txn[]
}

export interface Applied { data: Partial<Dataset>; issues: Issue[]; imported: number; skipped: number }

// ---------- CSV ----------

/** RFC 4180 CSV (quotes, doubled quotes, CRLF, newlines inside quotes). Also handles tab-separated text. */
export function parseCsv(text: string): string[][] {
  text = text.replace(/^﻿/, '')
  const firstLine = text.slice(0, text.indexOf('\n') >>> 0)
  const sep = (firstLine.match(/\t/g)?.length ?? 0) > (firstLine.match(/,/g)?.length ?? 0) ? '\t' : ','
  const rows: string[][] = []
  let row: string[] = [], cell = '', q = false
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (q) {
      if (ch === '"') { if (text[i + 1] === '"') { cell += '"'; i++ } else q = false }
      else cell += ch
    } else if (ch === '"') q = true
    else if (ch === sep) { row.push(cell); cell = '' }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++
      row.push(cell); rows.push(row); row = []; cell = ''
    } else cell += ch
  }
  if (cell || row.length) { row.push(cell); rows.push(row) }
  return rows.map(r => r.map(c => c.trim()))
}

export function toCsv(rows: (string | number)[][]): string {
  return rows.map(r => r.map(c => { const s = String(c); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s }).join(',')).join('\n') + '\n'
}

// ---------- Detection ----------

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9#/ ]+/g, ' ').replace(/\s+/g, ' ').trim()

const SYN: Record<string, string[]> = {
  date: ['date', 'posting date', 'posted date', 'transaction date', 'trans date', 'txn date', 'invoice date', 'bill date'],
  desc: ['description', 'payee', 'memo', 'memo description', 'memo/description', 'details', 'transaction description', 'narrative', 'name'],
  amount: ['amount', 'amt', 'transaction amount', 'net amount'],
  debit: ['debit', 'debits', 'withdrawal', 'withdrawals', 'withdrawal amount', 'money out', 'paid out', 'payment'],
  credit: ['credit', 'credits', 'deposit', 'deposits', 'deposit amount', 'money in', 'paid in'],
  balance: ['balance', 'running bal', 'running balance', 'ledger balance'],
  name: ['name', 'customer', 'customer full name', 'vendor', 'vendor full name', 'payee', 'supplier', 'customer name', 'vendor name'],
  num: ['num', 'no', 'number', 'invoice #', 'invoice no', 'bill #', 'bill no', 'ref', 'ref no', 'doc number', '#'],
  due: ['due date', 'due'],
  open: ['open balance', 'balance due', 'amount due', 'open amount', 'outstanding'],
  type: ['transaction type', 'txn type', 'type'],
  interval: ['interval', 'frequency', 'schedule'],
  next: ['next date', 'next'],
  party: ['customer vendor', 'customer/vendor', 'name', 'customer', 'vendor'],
}

/** Earlier synonyms win: "Txn Type" beats a plain "Type" column. */
function findCol(header: string[], key: string, taken: Set<number>): number {
  const hn = header.map(norm)
  for (const name of SYN[key]) {
    const i = hn.findIndex((h, j) => !taken.has(j) && h === name)
    if (i >= 0) { taken.add(i); return i }
  }
  return -1
}

export function autoMap(kind: Kind, header: string[]): Mapping {
  const taken = new Set<number>()
  const m: Mapping = {}
  // Specific fields first so generic ones ("name", "amount") don't steal their columns.
  const order = ['next', 'interval', 'open', 'due', 'type', 'balance', 'debit', 'credit', 'date', 'num', 'amount', 'name', 'party', 'desc']
  if (kind === 'templates') {
    m.name = header.findIndex(h => /template name/i.test(h))
    if (m.name >= 0) taken.add(m.name)
  }
  for (const key of order) if (FIELDS[kind].some(f => f.key === key) && m[key] === undefined) m[key] = findCol(header, key, taken)
  return m
}

function looksLikeHeader(r: string[]) {
  const n = r.map(norm)
  return n.some(c => SYN.date.includes(c) || c === 'template name' || c === 'next date') && n.filter(Boolean).length >= 3
}

/** Guess what a file is from its header row, title lines and columns. */
export function detect(text: string, fileName = ''): Parsed | null {
  if (/<OFX>|<STMTTRN>/i.test(text)) return parseOfx(text)
  // Empty rows are kept so validation messages point at the real line in the file.
  const rows = parseCsv(text)
  if (!rows.some(r => r.some(c => c))) return null
  const title = rows.slice(0, 6).map(r => r.join(' ')).join(' ').toLowerCase() + ' ' + fileName.toLowerCase()
  let h = rows.findIndex(looksLikeHeader)
  if (h < 0) {
    // Headerless bank export (Wells Fargo style): date, amount, *, check #, description.
    const r = rows.find(x => x.some(c => c))!
    if (r.length >= 2 && parseDate(r[0]) && parseMoney(r[1]) !== null) {
      return { kind: 'bank', format: 'Bank CSV without header (Wells Fargo layout)', headerRow: -1, header: r.map((_, i) => `Column ${i + 1}`), rows, mapping: { date: 0, amount: 1, desc: r.length >= 5 ? 4 : r.length - 1, debit: -1, credit: -1, balance: -1 }, dayFirst: false }
    }
    return null
  }
  const header = rows[h]
  const hn = header.map(norm)
  const has = (re: RegExp) => hn.some(c => re.test(c))
  let kind: Kind = 'bank', format = 'Bank CSV'
  if (/recurring template/.test(title) || (has(/^interval$/) && has(/^next date$/))) { kind = 'templates'; format = 'QuickBooks Online: Recurring Template List' }
  else if (/a\/?p aging|payables aging/.test(title) || (has(/^open balance$/) && has(/^vendor/))) { kind = 'ap'; format = /a\/?p aging/.test(title) ? 'QuickBooks Online: A/P Aging Detail' : 'Open bills CSV' }
  else if (/a\/?r aging|receivables aging/.test(title) || (has(/^open balance$/) && has(/^customer/))) { kind = 'ar'; format = /a\/?r aging/.test(title) ? 'QuickBooks Online: A/R Aging Detail' : 'Open invoices CSV' }
  else if (/transaction list|transaction detail|journal/.test(title) || (has(/^transaction type$/) && has(/^(name|split)$/))) { kind = 'txlist'; format = 'QuickBooks Online: Transaction List by Date' }
  else if (has(/^details$/) && has(/^posting date$/)) format = 'Bank CSV (Chase layout)'
  else if (has(/^running bal$/)) format = 'Bank CSV (Bank of America layout)'
  else if (has(/^card no$/)) format = 'Bank CSV (Capital One layout)'
  else if (has(/^(debit|withdrawal)/) && has(/^(credit|deposit)/)) format = 'Bank CSV (debit and credit columns)'
  else if (/xero/.test(title)) format = 'Xero bank statement export'
  const body = rows.slice(h + 1)
  return { kind, format, headerRow: h, header, rows: body, mapping: autoMap(kind, header), dayFirst: guessDayFirst(body, autoMap(kind, header).date) }
}

function guessDayFirst(rows: string[][], col: number | undefined) {
  if (col === undefined || col < 0) return false
  // If any first number is above 12 it must be a day.
  return rows.slice(0, 200).some(r => { const m = (r[col] ?? '').match(/^(\d{1,2})[/.-](\d{1,2})[/.-]/); return !!m && +m[1] > 12 })
}

// ---------- OFX / QFX ----------

function tag(block: string, name: string) {
  const m = block.match(new RegExp(`<${name}>([^<\\r\\n]*)`, 'i'))
  return m ? m[1].trim() : ''
}

export function parseOfx(text: string): Parsed {
  const txns: Txn[] = []
  const blocks = text.split(/<STMTTRN>/i).slice(1)
  blocks.forEach((b, i) => {
    const date = parseDate(tag(b, 'DTPOSTED'))
    const amount = parseMoney(tag(b, 'TRNAMT'))
    if (!date || amount === null) return
    const name = decode(tag(b, 'NAME')), memo = decode(tag(b, 'MEMO'))
    txns.push({ id: tag(b, 'FITID') || `ofx-${i}`, date, amount, desc: [name, memo].filter(Boolean).join(' · ') || tag(b, 'TRNTYPE') })
  })
  const lb = text.split(/<LEDGERBAL>/i)[1]
  const bal = lb ? { amount: parseMoney(tag(lb, 'BALAMT')), date: parseDate(tag(lb, 'DTASOF')) } : null
  return {
    kind: 'bank', format: /<\/?INTU\.BID>/i.test(text) ? 'QuickBooks Web Connect (QFX)' : 'OFX bank statement', headerRow: -1, header: [], rows: [], mapping: {}, dayFirst: false, ofx: txns,
    ...(bal && bal.amount !== null && bal.date ? { balance: { amount: bal.amount, date: bal.date } } : {}),
  }
}

const decode = (s: string) => s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')

// ---------- Applying a mapping ----------

const SKIP_ROW = /^(total|totals|grand total|current|\d+ ?- ?\d+ days|91 or more|> ?90|over 90|.*days past due|beginning balance|opening balance|ending balance)\b/i

/** Turns mapped rows into dataset pieces, with a validation report keyed to the file's line numbers. */
export function apply(p: Parsed, mapping = p.mapping, dayFirst = p.dayFirst): Applied {
  const issues: Issue[] = []
  if (p.ofx) {
    if (!p.ofx.length) issues.push({ line: 0, level: 'error', msg: 'No <STMTTRN> transactions found in the OFX file.' })
    return { data: { txns: p.ofx, ...(p.balance ? { balance: p.balance } : {}) }, issues, imported: p.ofx.length, skipped: 0 }
  }
  for (const f of FIELDS[p.kind]) if (f.required && !(mapping[f.key] >= 0)) issues.push({ line: 0, level: 'error', msg: `Map a column to “${f.label}”.` })
  if (p.kind === 'bank' && !(mapping.amount >= 0) && !(mapping.debit >= 0 || mapping.credit >= 0)) issues.push({ line: 0, level: 'error', msg: 'Map either a signed Amount column, or Debit and Credit columns.' })
  if (issues.length) return { data: {}, issues, imported: 0, skipped: p.rows.length }

  const get = (r: string[], k: string) => (mapping[k] >= 0 ? r[mapping[k]] ?? '' : '')
  const lineOf = (i: number) => p.headerRow + 2 + i
  let skipped = 0
  const txns: Txn[] = [], ar: Invoice[] = [], ap: Bill[] = [], templates: Template[] = []
  const ledger: { type: string; name: string; date: string; due: string; amount: number; num: string; desc: string }[] = []
  let balance: { amount: number; date: string } | undefined
  const seen = new Map<string, number>()

  p.rows.forEach((r, i) => {
    const line = lineOf(i)
    const first = r.find(c => c) ?? ''
    if (!first) return
    if (SKIP_ROW.test(first) || (r.filter(Boolean).length <= 1 && !parseDate(first))) { skipped++; return }
    const rawDate = get(r, p.kind === 'templates' ? 'next' : 'date')
    const date = parseDate(rawDate, dayFirst)
    if (!date) {
      issues.push({ line, level: 'warning', msg: rawDate ? `Unreadable date “${rawDate}”; row skipped.` : 'No date; row skipped.' })
      skipped++; return
    }
    if (p.kind === 'bank') {
      let amount = parseMoney(get(r, 'amount'))
      if (amount === null && (mapping.debit >= 0 || mapping.credit >= 0)) {
        const d = parseMoney(get(r, 'debit')), c = parseMoney(get(r, 'credit'))
        if (d === null && c === null) amount = null
        else amount = (c ?? 0) - Math.abs(d ?? 0)
      }
      if (amount === null) { issues.push({ line, level: 'warning', msg: 'No amount; row skipped.' }); skipped++; return }
      const desc = get(r, 'desc') || '(no description)'
      const key = `${date}|${amount}|${desc}`
      const n = (seen.get(key) ?? 0) + 1
      seen.set(key, n)
      if (n > 1) issues.push({ line, level: 'warning', msg: `Same date, amount and description as an earlier row. Kept both; delete one if your bank exported it twice.` })
      txns.push({ id: `b${line}`, date, amount, desc })
      const bal = parseMoney(get(r, 'balance'))
      if (bal !== null && (!balance || date >= balance.date)) balance = { amount: bal, date }
      return
    }
    if (p.kind === 'ar' || p.kind === 'ap') {
      const type = get(r, 'type').toLowerCase()
      if (type && /payment|deposit|journal/.test(type)) { issues.push({ line, level: 'warning', msg: `Unapplied ${type} left out; apply it in QuickBooks so the aging is right.` }); skipped++; return }
      const open = parseMoney(get(r, 'open'))
      const name = get(r, 'name')
      if (open === null || !name) { issues.push({ line, level: 'warning', msg: !name ? 'No customer or vendor name; row skipped.' : 'No open balance; row skipped.' }); skipped++; return }
      if (open === 0) { skipped++; return }
      const due = parseDate(get(r, 'due'), dayFirst) ?? addDays(date, 30)
      if (!get(r, 'due')) issues.push({ line, level: 'warning', msg: 'No due date; assumed net 30.' })
      const num = get(r, 'num')
      if (p.kind === 'ar') ar.push({ id: `ar-${num || line}-${name}`, customer: name, num, date, due, amount: open })
      else ap.push({ id: `ap-${num || line}-${name}`, vendor: name, num, date, due, amount: Math.abs(open) * Math.sign(open) })
      return
    }
    if (p.kind === 'txlist') {
      const amount = parseMoney(get(r, 'amount'))
      if (amount === null) { issues.push({ line, level: 'warning', msg: 'No amount; row skipped.' }); skipped++; return }
      ledger.push({ type: get(r, 'type').toLowerCase(), name: get(r, 'name'), date, due: parseDate(get(r, 'due'), dayFirst) ?? '', amount, num: get(r, 'num'), desc: get(r, 'desc') })
      return
    }
    // templates
    const amount = parseMoney(get(r, 'amount'))
    const interval = parseInterval(get(r, 'interval'))
    if (amount === null || !interval) { issues.push({ line, level: 'warning', msg: !interval ? `Interval “${get(r, 'interval')}” not understood; row skipped.` : 'No amount; row skipped.' }); skipped++; return }
    const inflow = /invoice|sales receipt|deposit|estimate/i.test(get(r, 'type'))
    templates.push({ id: `t${line}`, name: get(r, 'party') ? `${get(r, 'name')} · ${get(r, 'party')}` : get(r, 'name'), interval, next: date, amount: inflow ? Math.abs(amount) : -Math.abs(amount) })
  })

  if (p.kind === 'txlist') {
    const { paid, cash, unmatched } = fromTransactionList(ledger)
    if (unmatched) issues.push({ line: 0, level: 'warning', msg: `${unmatched} payment${unmatched > 1 ? 's' : ''} could not be matched to an earlier invoice for the same customer; they still count as cash received.` })
    const data: Partial<Dataset> = { paid, txns: cash }
    return { data, issues, imported: ledger.length, skipped }
  }
  const imported = txns.length + ar.length + ap.length + templates.length
  if (!imported) issues.push({ line: 0, level: 'error', msg: 'No usable rows. Check the column mapping and date format.' })
  const data: Partial<Dataset> = p.kind === 'bank' ? { txns, ...(balance ? { balance } : {}) } : p.kind === 'ar' ? { ar } : p.kind === 'ap' ? { ap } : { templates }
  return { data, issues, imported, skipped }
}

export function parseInterval(s: string): Template['interval'] | null {
  const t = s.toLowerCase()
  const n = Number(t.match(/every (\d+)/)?.[1] ?? 1)
  if (/year|annual/.test(t)) return 'annual'
  if (/week/.test(t)) return n === 2 ? 'biweekly' : n === 1 ? 'weekly' : null
  if (/month/.test(t)) return n === 1 ? 'monthly' : n === 3 ? 'quarterly' : n === 12 ? 'annual' : null
  if (/quarter/.test(t)) return 'quarterly'
  if (/daily|day/.test(t)) return null
  return null
}

/**
 * A QuickBooks Transaction List mixes accrual rows (Invoice, Bill) with cash rows (Payment, Expense...).
 * Invoices and payments are matched oldest-first per customer to learn real days-to-pay;
 * cash rows become transactions.
 */
export function fromTransactionList(rows: { type: string; name: string; date: string; due: string; amount: number; num: string; desc: string }[]) {
  const sorted = [...rows].sort((a, b) => a.date.localeCompare(b.date))
  const open = new Map<string, { issued: string; due: string; left: number; amount: number }[]>()
  const paid: PaidInvoice[] = []
  const cash: Txn[] = []
  let unmatched = 0
  sorted.forEach((r, i) => {
    if (r.type === 'invoice') {
      const l = open.get(r.name) ?? []
      l.push({ issued: r.date, due: r.due || addDays(r.date, 30), left: Math.abs(r.amount), amount: Math.abs(r.amount) })
      open.set(r.name, l)
      return
    }
    const inflow = /^(payment|receive payment|deposit|sales receipt)$/.test(r.type)
    const outflow = /^(expense|check|cheque|bill payment.*|credit card payment|payroll.*|paycheck|tax payment|sales tax payment)$/.test(r.type)
    if (!inflow && !outflow) return
    cash.push({ id: `tl${i}`, date: r.date, amount: inflow ? Math.abs(r.amount) : -Math.abs(r.amount), desc: r.desc || r.type, name: r.name })
    if (r.type !== 'payment' && r.type !== 'receive payment') return
    let amt = Math.abs(r.amount)
    const l = open.get(r.name) ?? []
    if (!l.length) { unmatched++; return }
    while (amt > 0 && l.length) {
      const inv = l[0]
      const take = Math.min(amt, inv.left)
      inv.left -= take; amt -= take
      if (inv.left <= 0) { paid.push({ customer: r.name, issued: inv.issued, due: inv.due, paid: r.date, amount: inv.amount }); l.shift() }
    }
  })
  return { paid, cash, unmatched }
}

/** Merges an import into the dataset. Bank rows replace any overlapping date range; aging reports replace the old aging. */
export function merge(ds: Dataset, kind: Kind, add: Partial<Dataset>): Dataset {
  const next = { ...ds }
  if (add.txns?.length) {
    const lo = add.txns.reduce((m, t) => t.date < m ? t.date : m, '9999'), hi = add.txns.reduce((m, t) => t.date > m ? t.date : m, '0000')
    next.txns = [...ds.txns.filter(t => t.date < lo || t.date > hi), ...add.txns].sort((a, b) => a.date.localeCompare(b.date))
  }
  if (add.balance) next.balance = add.balance
  if (kind === 'ar' && add.ar) next.ar = add.ar
  if (kind === 'ap' && add.ap) next.ap = add.ap
  if (add.paid?.length) next.paid = [...ds.paid.filter(p => !add.paid!.some(q => q.customer === p.customer && q.issued === p.issued && q.amount === p.amount)), ...add.paid]
  if (kind === 'templates' && add.templates) next.templates = add.templates
  return next
}

