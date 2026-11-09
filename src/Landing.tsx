import { useEffect, useMemo, useRef, useState } from 'react'
import { CashChart } from './Chart.tsx'
import { addDays } from './engine/dates.ts'
import { buildInputs, forecast, weekStart } from './engine/forecast.ts'
import { SAMPLES } from './engine/sample.ts'
import { EMPTY_OVERRIDES, type Scenario, type Settings } from './engine/types.ts'
import { sampleDataset } from './projectData.ts'
import { kmoney, Link, money } from './ui.tsx'

const DEF = SAMPLES[0]
const ASOF = addDays(new Date().toISOString().slice(0, 10), -1)

const TOGGLES: { id: string; label: string; sc: Scenario }[] = [
  { id: 'late', label: 'Halverson pays 3 weeks later', sc: { id: 'late', kind: 'late-payer', customer: 'Halverson Health', days: 21, on: true } },
  { id: 'lose', label: 'Lose Tidewater from week 4', sc: { id: 'lose', kind: 'lose-client', customer: 'Tidewater Credit Union', fromWeek: 4, on: true } },
  { id: 'hire', label: 'Hire a designer at $95k', sc: { id: 'hire', kind: 'hire', label: 'Designer', salary: 9_500_000, burdenPct: 22, fromWeek: 3, on: true } },
  { id: 'loan', label: 'Draw a $50k line of credit', sc: { id: 'loan', kind: 'loan', amount: 5_000_000, week: 2, aprPct: 9.5, months: 24, on: true } },
  { id: 'price', label: 'Raise prices 8%', sc: { id: 'price', kind: 'price-increase', pct: 8, fromWeek: 4, on: true } },
]

function useCount(target: number) {
  const [v, setV] = useState(target)
  const cur = useRef(target)
  useEffect(() => {
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) { cur.current = target; setV(target); return }
    const from = cur.current, t0 = performance.now()
    let raf = 0
    const tick = (t: number) => { const k = Math.min(1, (t - t0) / 500); cur.current = from + (target - from) * (1 - Math.pow(1 - k, 3)); setV(cur.current); if (k < 1) raf = requestAnimationFrame(tick) }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [target])
  return v
}

function HeroDemo() {
  const ds = useMemo(() => sampleDataset(DEF.id, ASOF)!, [])
  const settings = useMemo(() => ({ minCash: 0, haircutPct: 20, slowDays: 15, defaultLag: 7, payDelay: 0, currency: 'USD', ...DEF.settings }) as Settings, [])
  const [on, setOn] = useState<string[]>([])
  const [moved, setMoved] = useState<Record<string, string>>({})
  const inputs = useMemo(() => buildInputs(ds, settings, { ...EMPTY_OVERRIDES, invoices: Object.fromEntries(Object.entries(moved).map(([k, v]) => [k, { expected: v }])) }, ASOF), [ds, settings, moved])
  const base = useMemo(() => forecast(buildInputs(ds, settings, EMPTY_OVERRIDES, ASOF), settings), [ds, settings])
  const f = forecast(inputs, settings, TOGGLES.filter(t => on.includes(t.id)).map(t => t.sc))
  const changed = on.length > 0 || Object.keys(moved).length > 0
  const big = inputs.collections.filter(c => !c.excluded && c.invoice.customer === 'Halverson Health').sort((a, b) => a.expected.localeCompare(b.expected))[0]
  const bigWeek = big ? Math.min(13, Math.max(1, Math.ceil((Date.parse(big.expected) - Date.parse(ASOF)) / 604800000))) : 0
  const safe = useCount(f.safeToSpend)
  return (
    <div className="hero-demo" aria-label="Live forecast for a synthetic agency">
      <div className="demo-head">
        <div>
          <div className="demo-co">Northbeam Studio <span className="badge synthetic">Synthetic</span></div>
          <div className="muted small">12-person agency · 13 weeks from {new Date(ASOF + 'T00:00:00Z').toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })}</div>
        </div>
        <div className="demo-kpis">
          <div className={`kpi-big ${f.safeToSpend < 0 ? 'bad' : 'good'}`}><span>Safe to spend</span><strong>{money(Math.round(safe / 100) * 100, { cents: false })}</strong></div>
          <div className="kpi-sm"><span>Low point</span><strong>{kmoney(f.low.amount)}</strong><em>{f.low.week ? `week ${f.low.week}` : 'today'}</em></div>
          <div className="kpi-sm"><span>Below minimum</span><strong className={f.breach ? 'neg' : ''}>{f.breach ? `Week ${f.breach}` : 'Never'}</strong><em>min {kmoney(f.minCash)}</em></div>
        </div>
      </div>
      <CashChart f={f} base={changed ? base : undefined} height={330}
        chips={big ? [{ id: big.invoice.id, label: 'Halverson', amount: big.amount, week: bigWeek, onChange: wk => setMoved(m => ({ ...m, [big.invoice.id]: addDays(weekStart(ASOF, wk), 2) })) }] : []} />
      <div className="demo-controls">
        <span className="muted small">Drag the Halverson payment, or try:</span>
        {TOGGLES.map(t => (
          <button key={t.id} type="button" className={`toggle-chip${on.includes(t.id) ? ' on' : ''}`} aria-pressed={on.includes(t.id)} onClick={() => setOn(o => o.includes(t.id) ? o.filter(x => x !== t.id) : [...o, t.id])}>{t.label}</button>
        ))}
        {changed && <button type="button" className="linkish small" onClick={() => { setOn([]); setMoved({}) }}>Reset</button>}
      </div>
    </div>
  )
}

export function Landing() {
  return (
    <>
      <section className="hero">
        <div className="hero-inner">
          <div className="hero-copy">
            <div className="eyebrow">13-week cash flow forecast</div>
            <h1>See the week your cash runs low. <span className="grad">Weeks before it does.</span></h1>
            <p className="hero-lede">Runway reads your bank and QuickBooks exports, learns how fast each client really pays and which bills come back every month, quarter and year, then rolls your balance forward thirteen weeks. One number tells you what is safe to spend.</p>
            <div className="hero-cta">
              <Link href="/app?sample=northbeam" className="btn primary lg">Try the sample business</Link>
              <Link href="/app" className="btn ghost lg">Import your data</Link>
            </div>
            <p className="hero-note muted small">Free, no sign-up. Files stay in your browser.</p>
          </div>
          <HeroDemo />
        </div>
      </section>

      <section className="section">
        <div className="section-inner">
          <div className="eyebrow">Why owners get surprised</div>
          <h2 className="section-title">The forecast in your books looks backward. Your bills do not.</h2>
          <div className="cards three">
            <article className="card quote-card">
              <p>“The cash flow planner just disappeared after an update, and support could not bring it back.”</p>
              <span className="muted small">Paraphrased from a QuickBooks user forum</span>
            </article>
            <article className="card quote-card">
              <p>“Is the built-in cash forecast reliable? Too simple to make decisions with. It only averages the past.”</p>
              <span className="muted small">Paraphrased from a QuickBooks Online forum thread</span>
            </article>
            <article className="card quote-card">
              <p>“One sheet: money in on the dates clients actually promised, money out by week, a running balance. Spread insurance into a sinking fund. Assume clients pay slow. Update it every week.”</p>
              <span className="muted small">Paraphrased top advice from a small business forum</span>
            </article>
          </div>
          <p className="section-foot">Runway is that sheet, built for you from your own data, and it updates itself every week.</p>
        </div>
      </section>

      <section className="section alt">
        <div className="section-inner">
          <div className="eyebrow">How it works</div>
          <h2 className="section-title">Four files in. A decision out.</h2>
          <ol className="steps">
            <li><b>Import</b><span>Bank CSV or OFX, plus QuickBooks Online A/R and A/P aging, transaction list and recurring templates. Formats are detected; anything odd is listed by line number.</span></li>
            <li><b>Detect</b><span>Payroll, rent and subscriptions are found from history, weekly to annual, even when amounts drift. Big annual and quarterly bills become sinking funds.</span></li>
            <li><b>Forecast</b><span>Each client’s invoices land on the day that client really pays, not the due date. Slow payers get a haircut. Bills go out on their terms.</span></li>
            <li><b>Act</b><span>Chase the invoices that lift your low point most, move money into sinking funds, print a one-page brief for your partner or lender.</span></li>
          </ol>
        </div>
      </section>

      <section className="section">
        <div className="section-inner">
          <div className="eyebrow">What you get</div>
          <h2 className="section-title">Built for the owner who signs the paychecks.</h2>
          <div className="features">
            <article><h3>Safe to spend</h3><p>Your lowest balance in the next 13 weeks, minus the minimum you never want to dip below, minus what next year’s insurance and taxes have already accrued.</p></article>
            <article><h3>Collections worklist</h3><p>Who to call this week, ranked by how much collecting from them lifts your low point. Editable reminder emails, ready to send.</p></article>
            <article><h3>Scenarios side by side</h3><p>Lose a client, hire at $X from week N, a top customer paying late, a loan draw, a price rise. See the low point and breach week for each.</p></article>
            <article><h3>Sinking funds</h3><p>Annual and quarterly bills spread into weekly transfers, with a plan you can hand to whoever does the banking.</p></article>
            <article><h3>Forecast vs actual</h3><p>Save the forecast each week. Next week, Runway scores it against what hit the bank, so you learn where it is optimistic.</p></article>
            <article><h3>Lender-ready brief</h3><p>A printable one-page cash brief and CSV or Excel export of the 13-week table.</p></article>
          </div>
        </div>
      </section>

      <section className="section privacy-band">
        <div className="section-inner split">
          <div>
            <h2>Your numbers stay with you.</h2>
            <p>Parsing and forecasting run in your browser. Nothing is uploaded unless you choose to sign in and sync across devices, and even then you decide whether transactions leave this device.</p>
          </div>
          <Link href="/docs#privacy" className="btn ghost">How data is handled</Link>
        </div>
      </section>

      <section className="section cta-final">
        <div className="section-inner center">
          <h2>Next Monday, know your number.</h2>
          <p className="muted">Open the sample agency or the seasonal landscaper, or bring your own exports.</p>
          <div className="row gap center-x wrap">
            <Link href="/app?sample=northbeam" className="btn primary lg">Agency sample</Link>
            <Link href="/app?sample=greenline" className="btn ghost lg">Landscaping sample</Link>
            <Link href="/docs" className="btn ghost lg">Export steps</Link>
          </div>
        </div>
      </section>
    </>
  )
}
