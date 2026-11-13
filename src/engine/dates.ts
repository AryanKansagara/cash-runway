const DAY = 86400000

export const toMs = (d: string) => Date.parse(d + 'T00:00:00Z')
export const fromMs = (ms: number) => new Date(ms).toISOString().slice(0, 10)
export const addDays = (d: string, n: number) => fromMs(toMs(d) + n * DAY)
export const daysBetween = (a: string, b: string) => Math.round((toMs(b) - toMs(a)) / DAY)
export const today = () => new Date().toISOString().slice(0, 10)

/** Same day of month n months later, clamped to the month's last day (Jan 31 + 1 = Feb 28). */
export function addMonths(d: string, n: number, dom = Number(d.slice(8, 10))): string {
  const y = Number(d.slice(0, 4)), m = Number(d.slice(5, 7)) - 1 + n
  const last = new Date(Date.UTC(y, m + 1, 0)).getUTCDate()
  return fromMs(Date.UTC(y, m, Math.min(dom, last)))
}

/** Monday on or before d. */
export function monday(d: string) {
  const wd = new Date(toMs(d)).getUTCDay()
  return addDays(d, -((wd + 6) % 7))
}

const MONTHS: Record<string, number> = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 }

/**
 * Parses the date formats bank and accounting exports use: 2026-03-14, 03/14/2026, 3/14/26,
 * 2026/03/14, 2026.03.14, 14/03/2026 (when dayFirst), 20260314 (OFX), Mar 14 2026, 14-Mar-2026.
 */
export function parseDate(raw: string, dayFirst = false): string | null {
  const s = raw.trim().replace(/^"|"$/g, '')
  let m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/)
  if (m) return mk(+m[1], +m[2], +m[3])
  m = s.match(/^(\d{4})(\d{2})(\d{2})/)
  if (m) return mk(+m[1], +m[2], +m[3])
  m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})$/)
  if (m) {
    const y = m[3].length === 2 ? 2000 + +m[3] : +m[3]
    return dayFirst ? mk(y, +m[2], +m[1]) : mk(y, +m[1], +m[2])
  }
  m = s.match(/^([A-Za-z]{3})[a-z]*\.? (\d{1,2}),? (\d{4})$/)
  if (m && MONTHS[m[1].toLowerCase()]) return mk(+m[3], MONTHS[m[1].toLowerCase()], +m[2])
  m = s.match(/^(\d{1,2})[ -]([A-Za-z]{3})[a-z]*[ -](\d{2,4})$/)
  if (m && MONTHS[m[2].toLowerCase()]) return mk(m[3].length === 2 ? 2000 + +m[3] : +m[3], MONTHS[m[2].toLowerCase()], +m[1])
  return null
}

function mk(y: number, m: number, d: number) {
  if (m < 1 || m > 12 || d < 1 || d > 31 || y < 1990 || y > 2100) return null
  const iso = fromMs(Date.UTC(y, m - 1, d))
  return Number(iso.slice(8, 10)) === d ? iso : null
}

/** "$1,234.56", "(1,234.56)", "-1234.5", "1 234,56" style is not supported on purpose: US/CA exports only. */
export function parseMoney(raw: string): number | null {
  let s = raw.trim().replace(/^"|"$/g, '')
  if (!s) return null
  let neg = false
  if (/^\(.*\)$/.test(s)) { neg = true; s = s.slice(1, -1) }
  if (s.endsWith('-')) { neg = true; s = s.slice(0, -1) }
  s = s.replace(/[$\s,]|CA\$|USD|CAD/g, '')
  if (s.startsWith('-')) { neg = !neg; s = s.slice(1) }
  if (s.startsWith('+')) s = s.slice(1)
  if (!/^\d*\.?\d+$/.test(s)) return null
  const c = Math.round(parseFloat(s) * 100)
  return neg ? -c : c
}
