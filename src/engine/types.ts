// All money is integer cents. All dates are ISO yyyy-mm-dd strings (UTC calendar days).

/** A bank or book transaction. Positive amount = money in, negative = money out. */
export interface Txn { id: string; date: string; amount: number; desc: string; name?: string }

/** An open receivable (A/R aging detail row). */
export interface Invoice { id: string; customer: string; num: string; date: string; due: string; amount: number }

/** An open payable (A/P aging detail row). */
export interface Bill { id: string; vendor: string; num: string; date: string; due: string; amount: number }

/** A paid invoice from history, used to learn how long each customer really takes to pay. */
export interface PaidInvoice { customer: string; issued: string; due: string; paid: string; amount: number }

/** A QuickBooks recurring template or any manually known schedule. Amount signed like Txn. */
export interface Template { id: string; name: string; interval: 'weekly' | 'biweekly' | 'monthly' | 'quarterly' | 'annual'; next: string; amount: number }

export interface Dataset {
  txns: Txn[]
  ar: Invoice[]
  ap: Bill[]
  paid: PaidInvoice[]
  templates: Template[]
  /** A known balance on a date (from the bank file or typed in). */
  balance?: { amount: number; date: string }
}

export const EMPTY_DATASET: Dataset = { txns: [], ar: [], ap: [], paid: [], templates: [] }

export interface Settings {
  /** Never let the bank balance go below this. */
  minCash: number
  /** Share of a slow payer's open invoices assumed not to arrive inside the 13 weeks. */
  haircutPct: number
  /** A customer is a slow payer when they pay this many days past due, on median. */
  slowDays: number
  /** Days past due assumed for customers with no payment history. */
  defaultLag: number
  /** Days after the due date bills are paid (0 = on the due date). */
  payDelay: number
  currency: 'USD' | 'CAD'
}

export const DEFAULT_SETTINGS: Settings = { minCash: 2_500_000, haircutPct: 20, slowDays: 15, defaultLag: 7, payDelay: 0, currency: 'USD' }

export type Cadence = 'weekly' | 'biweekly' | 'semimonthly' | 'monthly' | 'quarterly' | 'annual'

/** User edits on top of what the engine detects. */
export interface Overrides {
  series: Record<string, { include?: boolean; amount?: number }>
  invoices: Record<string, { expected?: string; exclude?: boolean }>
  bills: Record<string, { pay?: string; exclude?: boolean }>
  funds: Record<string, { funded?: number; include?: boolean }>
}

export const EMPTY_OVERRIDES: Overrides = { series: {}, invoices: {}, bills: {}, funds: {} }

export type Scenario =
  | { id: string; kind: 'lose-client'; customer: string; fromWeek: number; on: boolean }
  | { id: string; kind: 'hire'; label: string; salary: number; burdenPct: number; fromWeek: number; on: boolean }
  | { id: string; kind: 'late-payer'; customer: string; days: number; on: boolean }
  | { id: string; kind: 'loan'; amount: number; week: number; aprPct: number; months: number; on: boolean }
  | { id: string; kind: 'price-increase'; pct: number; fromWeek: number; on: boolean }
