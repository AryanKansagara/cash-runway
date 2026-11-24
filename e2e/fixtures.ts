import { expect, test as base } from '@playwright/test'

/**
 * Every test runs signed out with the network closed to anything but the preview server:
 * Supabase (and the Google Fonts stylesheet) are aborted, and any uncaught page error fails the test.
 */
export const test = base.extend<{ blocked: string[] }>({
  blocked: async ({ context, baseURL }, use) => {
    const blocked: string[] = []
    const local = new URL(baseURL!).host
    await context.route(url => new URL(url).host !== local, route => {
      blocked.push(new URL(route.request().url()).host)
      return route.abort()
    })
    await use(blocked)
  },
  page: async ({ page, blocked: _blocked }, use) => {
    const errors: string[] = []
    page.on('pageerror', e => errors.push(e.message))
    await use(page)
    expect(errors, 'uncaught page errors').toEqual([])
  },
})

export { expect }

/** A small synthetic bank export ending yesterday: payroll, rent and a client paying monthly, with a running balance. */
export function syntheticBankCsv(): string {
  const day = 86_400_000
  const iso = (t: number) => new Date(t).toISOString().slice(0, 10)
  const end = Date.now() - day
  const rows: { date: string; desc: string; amount: number }[] = []
  for (let w = 26; w >= 0; w--) {
    const t = end - w * 7 * day
    if (w % 2 === 0) rows.push({ date: iso(t), desc: 'ACME PAYROLL SAMPLE', amount: -4200 })
    if (w % 4 === 1) rows.push({ date: iso(t - day), desc: 'SAMPLE LANDLORD RENT', amount: -2500 })
    if (w % 4 === 2) rows.push({ date: iso(t - 2 * day), desc: 'SAMPLE CLIENT ONE ACH', amount: 9800 })
  }
  let bal = 30_000
  const lines = rows.map(r => { bal += r.amount; return `${r.date},"${r.desc}",${r.amount.toFixed(2)},${bal.toFixed(2)}` })
  return ['Date,Description,Amount,Balance', ...lines].join('\n') + '\n'
}
