import { expect, syntheticBankCsv, test } from './fixtures'

const MONEY = /^[-−]?\$[\d,]+$/

test('sample agency: reach the 13-week forecast and the safe-to-spend figure', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('link', { name: 'Try the sample business' }).first().click()
  await expect(page).toHaveURL(/\/app\/p\/[\w-]+$/)
  await expect(page.getByRole('heading', { level: 1, name: 'Northbeam Studio' })).toBeVisible()
  await expect(page.locator('.hero-kpi')).toContainText('Safe to spend')
  await expect(page.locator('.hero-kpi strong')).toHaveText(MONEY)
  await expect(page.getByRole('heading', { name: '13-week table' })).toBeVisible()
  await expect(page.locator('.sheet-table thead th .th-btn')).toHaveCount(13)
  await expect(page.locator('.sheet-table')).toContainText('Closing balance')
})

test('scenarios: changing one changes the compared result', async ({ page }) => {
  await page.goto('/app?sample=northbeam&tab=scenarios')
  await expect(page.getByRole('heading', { name: 'Compare side by side' })).toBeVisible()
  const row = page.locator('.cmp-table tbody tr', { hasText: 'Hire Senior designer' })
  await expect(row).toContainText('$95,000/yr')
  const before = { low: await row.locator('td').nth(1).innerText(), delta: await row.locator('td').nth(2).innerText() }

  const salary = page.getByLabel('Salary $/yr')
  await salary.fill('300000')
  await salary.press('Enter')
  await expect(row).toContainText('$300,000/yr')
  await expect(row.locator('td').nth(2)).not.toHaveText(before.delta)
  await expect(row.locator('td').nth(1)).not.toHaveText(before.low)

  // Switching it on flows into the forecast tab, next to the base case.
  await page.locator('.scenario', { hasText: 'Hire Senior designer' }).locator('label.switch').click()
  await page.getByRole('link', { name: 'Forecast', exact: true }).click()
  await expect(page.locator('.scenario-on')).toContainText('Hire Senior designer at $300,000/yr')
  await expect(page.locator('.legend')).toContainText('Without scenarios')
})

test('import a small synthetic bank CSV through to a forecast', async ({ page }) => {
  await page.goto('/app')
  await page.getByRole('button', { name: 'Import your data' }).first().click()
  await expect(page).toHaveURL(/\/data$/)
  await page.locator('input[type=file]').setInputFiles({ name: 'sample-bank.csv', mimeType: 'text/csv', buffer: Buffer.from(syntheticBankCsv()) })
  await expect(page.locator('.review')).toContainText('sample-bank.csv')
  await expect(page.locator('.review .validation.ok')).toContainText(/\d+ rows ready/)
  await page.getByRole('button', { name: /^Import \d+ rows$/ }).click()
  await expect(page.getByText(/Imported \d+ rows from sample-bank\.csv/)).toBeVisible()

  await page.getByRole('link', { name: 'Forecast', exact: true }).click()
  await expect(page.locator('.hero-kpi')).toContainText('Safe to spend')
  await expect(page.locator('.hero-kpi strong')).toHaveText(MONEY)
  await expect(page.locator('.sheet-table thead th .th-btn')).toHaveCount(13)
})

test('an unreadable or wrong-format file shows a useful message and the app stays usable', async ({ page }) => {
  await page.goto('/app')
  await page.getByRole('button', { name: 'Import your data' }).first().click()
  const input = page.locator('input[type=file]')

  await input.setInputFiles({ name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('just some words\nno table here\n') })
  await expect(page.getByRole('alert')).toContainText('notes.txt: could not find a header row with a Date column')

  await input.setInputFiles({ name: 'statement.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4 not really') })
  await expect(page.getByRole('alert')).toContainText("statement.pdf: PDF statements can't be read reliably")

  await input.setInputFiles({ name: 'garbage.csv', mimeType: 'text/csv', buffer: Buffer.from([0xff, 0xfe, 0x00, 0x01, 0x80, 0x81, 0x00, 0x00]) })
  await expect(page.getByRole('alert')).toContainText('garbage.csv')

  // Still usable: a good file imports afterwards.
  await input.setInputFiles({ name: 'sample-bank.csv', mimeType: 'text/csv', buffer: Buffer.from(syntheticBankCsv()) })
  await page.getByRole('button', { name: /^Import \d+ rows$/ }).click()
  await expect(page.getByText(/Imported \d+ rows from sample-bank\.csv/)).toBeVisible()
})

test('local persistence: sample and imported business survive a reload', async ({ page }) => {
  await page.goto('/app?sample=greenline')
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Greenline')
  const url = page.url()
  const safe = await page.locator('.hero-kpi strong').innerText()
  await page.reload()
  await expect(page).toHaveURL(url)
  await expect(page.locator('.hero-kpi strong')).toHaveText(safe)

  await page.goto('/app')
  await page.getByRole('button', { name: 'New business' }).click()
  await page.locator('input[type=file]').setInputFiles({ name: 'sample-bank.csv', mimeType: 'text/csv', buffer: Buffer.from(syntheticBankCsv()) })
  await page.getByRole('button', { name: /^Import \d+ rows$/ }).click()
  await expect(page.getByText(/Imported \d+ rows/)).toBeVisible()
  await page.reload()
  await expect(page.getByText(/^\d+ imports?$/)).toBeVisible()
  await page.getByRole('link', { name: 'Forecast', exact: true }).click()
  await expect(page.locator('.hero-kpi strong')).toHaveText(MONEY)

  await page.goto('/app')
  await expect(page.getByRole('heading', { name: 'Your businesses' })).toBeVisible()
  await expect(page.locator('.project-card')).toHaveCount(2)
})

test('signed out: nothing leaves for Supabase, and the app works with the network closed', async ({ page, blocked }) => {
  await page.goto('/')
  await page.goto('/app?sample=northbeam')
  await expect(page.locator('.hero-kpi strong')).toHaveText(MONEY)
  await page.goto('/settings')
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
  expect(blocked, 'the network block is active').toContain('fonts.googleapis.com')
  expect(blocked.filter(h => /supabase/i.test(h)), 'Supabase requests while signed out').toEqual([])
})
