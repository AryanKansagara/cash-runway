import { useMemo, useState } from 'react'
import type { Tab } from './App.tsx'
import { Spark } from './Chart.tsx'
import { addDays, daysBetween } from './engine/dates.ts'
import {
  accuracy, accuracyScore, collectionsWorklist, compareScenarios, GROUP_LABEL, scenarioLabel, transferPlan, weekStart,
  type Chase, type Forecast, type Group, type Inputs, type Snapshot,
} from './engine/forecast.ts'
import type { Dataset, Overrides, Scenario } from './engine/types.ts'
import { saveProject, uuid, type Project } from './store.ts'
import { ask, CopyButton, Empty, fmtDate, fmtDay, kmoney, money, plural, toast } from './ui.tsx'

interface Props { tab: Tab; project: Project; ds: Dataset; fc: { inputs: Inputs; f: Forecast; base: Forecast } }

export default function Panels(p: Props) {
  if (p.tab === 'collections') return <Collections {...p} />
  if (p.tab === 'scenarios') return <Scenarios {...p} />
  if (p.tab === 'funds') return <Funds {...p} />
  if (p.tab === 'history') return <History {...p} />
  return <InputsTab {...p} />
}

const setOv = (project: Project, key: keyof Overrides, id: string, patch: Record<string, unknown> | null) => {
  const cur = { ...project.overrides[key] } as Record<string, Record<string, unknown>>
  if (patch === null) delete cur[id]
  else cur[id] = { ...cur[id], ...patch }
  return saveProject({ ...project, overrides: { ...project.overrides, [key]: cur } })
}

// ---------- Collections ----------

function draft(c: Chase, p: Project, asOf: string) {
  const overdue = c.invoices.filter(i => i.invoice.due <= asOf)
  const list = (overdue.length ? overdue : c.invoices).map(i => `  • Invoice ${i.invoice.num || '(no number)'} dated ${fmtDate(i.invoice.date)}, due ${fmtDate(i.invoice.due)}: ${money(i.invoice.amount)}`).join('\n')
  const total = (overdue.length ? overdue : c.invoices).reduce((a, i) => a + i.invoice.amount, 0)
  const firm = c.oldestDays > 30
  return {
    subject: overdue.length ? `${p.sender.company || 'Our'} invoice${overdue.length > 1 ? 's' : ''} past due: ${money(total)}` : `Upcoming payment: ${money(total)}`,
    body: `Hi ${c.customer} team,\n\n${overdue.length
      ? `${firm ? 'Following up again on' : 'A quick note about'} ${overdue.length > 1 ? 'these invoices, which are' : 'this invoice, which is'} now past due:`
      : 'Ahead of the due date, here is a summary of what is open with us:'}\n\n${list}\n\nTotal: ${money(total)}\n\n${firm
      ? `Could you confirm the date this will be paid by replying to this email? If something is holding it up (a missing PO, a different approver), tell me and I will sort it out today.`
      : `Could you let me know when we should expect payment? Happy to resend anything you need.`}\n\nThank you,\n${p.sender.name || '[Your name]'}\n${p.sender.company || ''}`.trim(),
  }
}

function Collections({ project, fc }: Props) {
  const list = useMemo(() => collectionsWorklist(fc.inputs, project.settings, project.scenarios), [fc])
  const [open, setOpen] = useState<string | null>(list[0]?.customer ?? null)
  if (!list.length) return <Empty title="Nothing to chase"><p className="muted">Import an A/R aging report on the Data tab to see open invoices here.</p></Empty>
  const top = list.filter(c => c.impact > 0)
  return (
    <div className="stack">
      <div className="callout">
        <b>{top.length ? `Chase ${top.slice(0, 3).map(c => c.customer).join(', ')} first.` : 'No single customer moves your low point this week.'}</b>{' '}
        <span className="muted">Ranked by how much your lowest balance rises if that customer’s open invoices arrived this week. Overdue amount breaks ties.</span>
      </div>
      <ol className="chase-list">
        {list.map((c, i) => {
          const d = draft(c, project, fc.f.asOf)
          const isOpen = open === c.customer
          return (
            <li key={c.customer} className={`chase${isOpen ? ' open' : ''}`}>
              <button type="button" className="chase-head" aria-expanded={isOpen} onClick={() => setOpen(isOpen ? null : c.customer)}>
                <span className="rank">{i + 1}</span>
                <span className="grow"><b>{c.customer}</b><small className="muted">{plural(c.invoices.length, 'open invoice')}{c.stats ? ` · usually pays ${c.stats.medianLate > 0 ? `${c.stats.medianLate} days late` : 'on time'}` : ' · no payment history'}{c.stats?.slow ? ' · slow payer' : ''}</small></span>
                <span className="chase-num"><small>Overdue</small><b className={c.overdue ? 'neg' : ''}>{money(c.overdue, { cents: false })}</b></span>
                <span className="chase-num"><small>Open</small><b>{money(c.open, { cents: false })}</b></span>
                <span className="chase-num"><small>Lifts low point</small><b className={c.impact > 0 ? 'pos' : 'muted'}>{c.impact > 0 ? money(c.impact, { cents: false, sign: true }) : '—'}</b></span>
              </button>
              {isOpen && (
                <div className="chase-body">
                  <table className="mini-table">
                    <thead><tr><th>Invoice</th><th>Issued</th><th>Due</th><th className="num">Amount</th><th>Expected</th><th>Promised date</th></tr></thead>
                    <tbody>
                      {c.invoices.map(x => (
                        <tr key={x.invoice.id}>
                          <td>{x.invoice.num || '—'}</td><td>{fmtDay(x.invoice.date)}</td>
                          <td className={x.invoice.due <= fc.f.asOf ? 'neg' : ''}>{fmtDay(x.invoice.due)}{x.invoice.due <= fc.f.asOf ? ` (${daysBetween(x.invoice.due, fc.f.asOf)}d)` : ''}</td>
                          <td className="num">{money(x.invoice.amount, { cents: false })}</td>
                          <td>{x.excluded ? <span className="chip critical">{x.doubtful ? 'Doubtful' : 'Excluded'}</span> : <>{fmtDay(x.expected)}{x.haircut ? <small className="muted"> ({kmoney(x.haircut)} held back)</small> : null}</>}</td>
                          <td><input type="date" aria-label={`Promised date for invoice ${x.invoice.num}`} value={project.overrides.invoices[x.invoice.id]?.expected ?? ''} min={addDays(fc.f.asOf, 1)} onChange={e => void setOv(project, 'invoices', x.invoice.id, e.target.value ? { expected: e.target.value } : null)} /></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <p className="muted small">Got a promise? Enter the date. The forecast uses it instead of the customer’s history.</p>
                  <EmailDraft key={c.customer} subject={d.subject} body={d.body} />
                </div>
              )}
            </li>
          )
        })}
      </ol>
    </div>
  )
}

function EmailDraft({ subject: s0, body: b0 }: { subject: string; body: string }) {
  const [subject, setSubject] = useState(s0)
  const [body, setBody] = useState(b0)
  return (
    <div className="email">
      <label className="field"><span>Subject</span><input value={subject} onChange={e => setSubject(e.target.value)} /></label>
      <label className="field"><span>Reminder email</span><textarea rows={12} value={body} onChange={e => setBody(e.target.value)} /></label>
      <div className="row gap-sm wrap">
        <CopyButton text={`Subject: ${subject}\n\n${body}`} label="Copy email" />
        <a className="btn ghost sm" href={`mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`}>Open in mail app</a>
        {(subject !== s0 || body !== b0) && <button type="button" className="linkish small" onClick={() => { setSubject(s0); setBody(b0) }}>Reset draft</button>}
      </div>
    </div>
  )
}

// ---------- Scenarios ----------

const KINDS: { kind: Scenario['kind']; label: string }[] = [
  { kind: 'lose-client', label: 'Lose a client' }, { kind: 'hire', label: 'Hire someone' }, { kind: 'late-payer', label: 'Customer pays late' },
  { kind: 'loan', label: 'Loan draw' }, { kind: 'price-increase', label: 'Price increase' },
]

function blank(kind: Scenario['kind'], customer: string): Scenario {
  const id = uuid()
  switch (kind) {
    case 'lose-client': return { id, kind, customer, fromWeek: 4, on: true }
    case 'hire': return { id, kind, label: 'New hire', salary: 7_000_000, burdenPct: 20, fromWeek: 3, on: true }
    case 'late-payer': return { id, kind, customer, days: 30, on: true }
    case 'loan': return { id, kind, amount: 5_000_000, week: 2, aprPct: 10, months: 24, on: true }
    case 'price-increase': return { id, kind, pct: 5, fromWeek: 4, on: true }
  }
}

function Scenarios({ project, fc }: Props) {
  const customers = [...new Set([...fc.inputs.collections.map(c => c.invoice.customer), ...fc.inputs.series.filter(s => s.direction === 'in').map(s => s.label)])]
  const rows = useMemo(() => compareScenarios(fc.inputs, project.settings, project.scenarios), [fc, project.scenarios])
  const set = (list: Scenario[]) => saveProject({ ...project, scenarios: list })
  const patch = (id: string, p: Partial<Scenario>) => set(project.scenarios.map(s => s.id === id ? { ...s, ...p } as Scenario : s))
  return (
    <div className="stack">
      <div className="panel">
        <div className="panel-head"><h2>Compare side by side</h2><span className="muted small">Each scenario on its own against the base case</span></div>
        <div className="table-wrap">
          <table className="cmp-table">
            <thead><tr><th>Scenario</th><th>Shape</th><th className="num">Low point</th><th className="num">vs base</th><th>Below minimum</th><th className="num">Safe to spend</th><th className="num">Week 13</th></tr></thead>
            <tbody>
              {rows.map(r => (
                <tr key={r.id} className={r.id === 'base' ? 'base' : ''}>
                  <th scope="row">{r.label}</th>
                  <td><Spark values={[r.f.start, ...r.f.weeks.map(w => w.close)]} min={r.f.minCash} /></td>
                  <td className="num">{money(r.f.low.amount, { cents: false })}<small className="muted"> {r.f.low.week ? `wk ${r.f.low.week}` : 'now'}</small></td>
                  <td className={`num ${r.deltaLow > 0 ? 'pos' : r.deltaLow < 0 ? 'neg' : 'muted'}`}>{r.id === 'base' ? '—' : money(r.deltaLow, { cents: false, sign: true })}</td>
                  <td>{r.f.breach ? <span className="chip critical">Week {r.f.breach}</span> : <span className="chip good">Never</span>}</td>
                  <td className={`num ${r.f.safeToSpend < 0 ? 'neg' : ''}`}>{money(r.f.safeToSpend, { cents: false })}</td>
                  <td className="num">{money(r.f.end, { cents: false })}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="panel">
        <div className="panel-head"><h2>Scenarios</h2><span className="muted small">Switched-on scenarios flow into the forecast, chart and brief</span></div>
        {project.scenarios.length === 0 && <p className="muted">No scenarios yet. Add one below.</p>}
        <div className="scenario-list">
          {project.scenarios.map(s => (
            <div key={s.id} className={`scenario${s.on ? ' on' : ''}`}>
              <label className="switch"><input type="checkbox" checked={s.on} onChange={e => void patch(s.id, { on: e.target.checked })} /><span aria-hidden="true" /><span className="sr">Include in forecast</span></label>
              <div className="grow">
                <b>{scenarioLabel(s)}</b>
                <div className="scenario-fields">
                  {(s.kind === 'lose-client' || s.kind === 'late-payer') && (
                    <label className="field inline"><span>Customer</span><select value={s.customer} onChange={e => void patch(s.id, { customer: e.target.value })}>{[...new Set([s.customer, ...customers])].map(c => <option key={c}>{c}</option>)}</select></label>
                  )}
                  {s.kind === 'late-payer' && <Num label="Days later" value={s.days} min={1} max={90} onChange={v => patch(s.id, { days: v })} />}
                  {s.kind === 'hire' && <>
                    <label className="field inline"><span>Role</span><input defaultValue={s.label} onBlur={e => void patch(s.id, { label: e.target.value })} /></label>
                    <Num label="Salary $/yr" value={s.salary / 100} min={1000} max={1000000} step={1000} onChange={v => patch(s.id, { salary: v * 100 })} />
                    <Num label="Taxes + benefits %" value={s.burdenPct} min={0} max={60} onChange={v => patch(s.id, { burdenPct: v })} />
                  </>}
                  {s.kind === 'loan' && <>
                    <Num label="Amount $" value={s.amount / 100} min={1000} max={5000000} step={1000} onChange={v => patch(s.id, { amount: v * 100 })} />
                    <Num label="APR %" value={s.aprPct} min={0} max={40} step={0.25} onChange={v => patch(s.id, { aprPct: v })} />
                    <Num label="Months" value={s.months} min={1} max={120} onChange={v => patch(s.id, { months: v })} />
                  </>}
                  {s.kind === 'price-increase' && <Num label="Increase %" value={s.pct} min={-50} max={100} onChange={v => patch(s.id, { pct: v })} />}
                  {'fromWeek' in s && <Num label="From week" value={s.fromWeek} min={1} max={13} onChange={v => patch(s.id, { fromWeek: v })} />}
                  {s.kind === 'loan' && <Num label="Draw in week" value={s.week} min={1} max={13} onChange={v => patch(s.id, { week: v })} />}
                </div>
              </div>
              <button type="button" className="btn danger-ghost sm" onClick={() => { const before = project.scenarios; void set(before.filter(x => x.id !== s.id)); toast('Scenario removed', { undo: () => void set(before) }) }}>Remove</button>
            </div>
          ))}
        </div>
        <div className="row gap-sm wrap add-row">
          <span className="muted small">Add:</span>
          {KINDS.map(k => <button key={k.kind} type="button" className="btn ghost sm" onClick={() => void set([...project.scenarios, blank(k.kind, customers[0] ?? '')])}>+ {k.label}</button>)}
        </div>
        <p className="muted small">Hires are paid every two weeks from the Friday of the start week, salary plus the taxes and benefits share. Loans are drawn at the start of the week and repaid monthly from 30 days later. Price increases apply to recurring receipts, not invoices already sent.</p>
      </div>
    </div>
  )
}

function Num({ label, value, onChange, min, max, step = 1 }: { label: string; value: number; onChange(v: number): void; min: number; max: number; step?: number }) {
  return (
    <label className="field inline"><span>{label}</span>
      <input type="number" defaultValue={value} min={min} max={max} step={step} key={value} onBlur={e => { const v = Math.min(max, Math.max(min, Number(e.target.value))); if (Number.isFinite(v) && v !== value) onChange(v) }} onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }} />
    </label>
  )
}

// ---------- Sinking funds ----------

function Funds({ project, fc }: Props) {
  const funds = fc.inputs.funds
  const plan = transferPlan(funds, fc.f.asOf)
  if (!funds.length) return <Empty title="No big periodic bills found"><p className="muted">Runway looks for quarterly and annual payments (insurance, estimated taxes, annual software) in your bank history. They need at least two occurrences, so import 13 to 24 months of bank data.</p></Empty>
  const weekly = plan.map(p => p.weeks)
  const totals = fc.f.weeks.map((_, i) => weekly.reduce((a, w) => a + w[i], 0))
  const text = `Sinking fund transfers, ${project.name}\n\n` + fc.f.weeks.map((w, i) => totals[i] ? `Week of ${fmtDay(w.start)}: move ${money(totals[i], { cents: false })} to savings (${plan.filter(p => p.weeks[i]).map(p => `${p.fund.label} ${money(p.weeks[i], { cents: false })}`).join(', ')})` : '').filter(Boolean).join('\n')
  return (
    <div className="stack">
      <div className="callout">
        <b>{money(plan.reduce((a, p) => a + (p.weeks[0] ?? 0), 0), { cents: false })} a week</b> into a separate savings account covers every big bill below on time. The safe-to-spend number already holds back <b>{money(fc.f.reserve, { cents: false })}</b>, the share these bills have accrued since they were last paid.
      </div>
      <div className="panel">
        <div className="panel-head"><h2>Big bills to fund</h2></div>
        <div className="table-wrap">
          <table className="data-table">
            <thead><tr><th>Bill</th><th>Every</th><th>Next due</th><th className="num">Amount</th><th className="num">Accrued now</th><th className="num">Already set aside</th><th className="num">Per week</th><th>Track</th></tr></thead>
            <tbody>
              {funds.map(f => (
                <tr key={f.key} className={f.include ? '' : 'off'}>
                  <th scope="row">{f.label}{f.inHorizon && <span className="chip warning tiny">in forecast</span>}</th>
                  <td>{f.cadence === 'annual' ? 'Year' : 'Quarter'}</td>
                  <td>{fmtDate(f.due)} <small className="muted">({f.weeksLeft} wk)</small></td>
                  <td className="num">{money(f.amount, { cents: false })}</td>
                  <td className="num">{money(f.accrued, { cents: false })}</td>
                  <td className="num"><input className="num-input" type="number" min={0} step={100} defaultValue={f.funded / 100} aria-label={`Already set aside for ${f.label}`} onBlur={e => void setOv(project, 'funds', f.key, { funded: Math.max(0, Math.round(Number(e.target.value) * 100) || 0) })} /></td>
                  <td className="num"><b>{money(f.perWeek, { cents: false })}</b></td>
                  <td><label className="switch"><input type="checkbox" checked={f.include} onChange={e => void setOv(project, 'funds', f.key, { include: e.target.checked })} /><span aria-hidden="true" /><span className="sr">Track {f.label}</span></label></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      <div className="panel">
        <div className="panel-head"><h2>Transfer plan</h2><CopyButton text={text} label="Copy plan" /></div>
        <div className="table-wrap sticky-first">
          <table className="sheet-table">
            <thead><tr><th>Fund</th>{fc.f.weeks.map(w => <th key={w.i} className="num"><small>Wk {w.i}</small>{fmtDay(w.start)}</th>)}<th className="num">13 wk</th></tr></thead>
            <tbody>
              {plan.map(p => <tr key={p.fund.key} className="r-line"><th scope="row">{p.fund.label}</th>{p.weeks.map((v, i) => <td key={i} className="num">{v ? kmoney(v) : <span className="zero">·</span>}</td>)}<td className="num">{kmoney(p.total)}</td></tr>)}
              <tr className="r-close"><th scope="row">Move to savings</th>{totals.map((v, i) => <td key={i} className="num">{kmoney(v)}</td>)}<td className="num">{kmoney(totals.reduce((a, b) => a + b, 0))}</td></tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

// ---------- History and accuracy ----------

function History({ project, ds, fc }: Props) {
  const snaps = [...project.snapshots].sort((a, b) => b.asOf.localeCompare(a.asOf))
  const [selId, setSel] = useState<string | null>(snaps.find(s => accuracy(s, ds).length)?.id ?? snaps[0]?.id ?? null)
  const [cmpId, setCmp] = useState<string>('')
  const sel = snaps.find(s => s.id === selId)
  if (!snaps.length) return <Empty title="No saved weeks yet"><p className="muted">Press “Save this week” (or S) each week after you import new bank lines. Next week, this tab compares that forecast with what actually happened.</p></Empty>
  return (
    <div className="stack">
      <div className="panel">
        <div className="panel-head"><h2>Saved weekly forecasts</h2><span className="muted small">The rolling update loop: save, import next week’s bank lines, compare</span></div>
        <div className="snap-list">
          {snaps.map(s => {
            const v = accuracy(s, ds)
            const score = accuracyScore(v)
            return (
              <button key={s.id} type="button" className={`snap${s.id === selId ? ' on' : ''}`} onClick={() => setSel(s.id)}>
                <b>{snapLabel(s)}</b>
                <Spark values={[s.start, ...s.weeks.map(w => w.close)]} min={s.minCash} w={110} h={30} />
                <small className="muted">Low {kmoney(s.low.amount)} · safe {kmoney(s.safeToSpend)}</small>
                <small>{score === null ? <span className="muted">No actuals yet</span> : <>Accuracy <b>{score}%</b> over {plural(v.length, 'week')}</>}</small>
              </button>
            )
          })}
        </div>
      </div>
      {sel && <Accuracy snap={sel} ds={ds} project={project} />}
      {sel && (
        <div className="panel">
          <div className="panel-head">
            <h2>Compare with</h2>
            <select value={cmpId} onChange={e => setCmp(e.target.value)} aria-label="Compare with">
              <option value="">Today’s forecast</option>
              {snaps.filter(s => s.id !== sel.id).map(s => <option key={s.id} value={s.id}>{snapLabel(s)}</option>)}
            </select>
          </div>
          <SnapCompare a={sel} b={snaps.find(s => s.id === cmpId) ?? null} now={fc.f} />
        </div>
      )}
    </div>
  )
}

function Accuracy({ snap, ds, project }: { snap: Snapshot; ds: Dataset; project: Project }) {
  const v = accuracy(snap, ds)
  const score = accuracyScore(v)
  const worst = [...v].sort((a, b) => Math.abs(b.netVar) - Math.abs(a.netVar))[0]
  return (
    <div className="panel">
      <div className="panel-head">
        <h2>Forecast vs actual: {snapLabel(snap)}</h2>
        <button type="button" className="btn danger-ghost sm" onClick={async () => {
          if (!(await ask('Delete this saved week?', 'Removes the saved forecast. Bank data is not affected.', 'Delete'))) return
          const before = project.snapshots
          await saveProject({ ...project, snapshots: before.filter(s => s.id !== snap.id) })
          toast('Saved week deleted', { undo: () => void saveProject({ ...project, snapshots: before }) })
        }}>Delete</button>
      </div>
      {!v.length ? <p className="muted">None of this forecast’s weeks have finished in your bank data yet. Import bank lines after {fmtDay(snap.weeks[0].end)} to score it.</p> : <>
        <p>{score !== null && <>Forecast closing balances were off by <b>{100 - score}%</b> on average. </>}{worst && Math.abs(worst.netVar) > 0 && <>Biggest miss: week ending {fmtDay(worst.end)}, {money(worst.netVar, { cents: false, sign: true })} {worst.netVar > 0 ? 'better' : 'worse'} than forecast.</>}</p>
        <div className="table-wrap">
          <table className="data-table">
            <thead><tr><th>Week</th><th className="num">Forecast in</th><th className="num">Actual in</th><th className="num">Forecast out</th><th className="num">Actual out</th><th className="num">Net variance</th><th className="num">Forecast close</th><th className="num">Actual close</th></tr></thead>
            <tbody>
              {v.map(x => (
                <tr key={x.start}>
                  <th scope="row">{fmtDay(x.start)}–{fmtDay(x.end)}</th>
                  <td className="num">{kmoney(x.fIn)}</td><td className="num">{kmoney(x.aIn)}</td>
                  <td className="num">{kmoney(x.fOut)}</td><td className="num">{kmoney(x.aOut)}</td>
                  <td className={`num ${x.netVar > 0 ? 'pos' : x.netVar < 0 ? 'neg' : ''}`}><VarBar v={x.netVar} scale={Math.max(...v.map(y => Math.abs(y.netVar)), 1)} />{money(x.netVar, { cents: false, sign: true })}</td>
                  <td className="num">{kmoney(x.fClose)}</td><td className="num">{x.aClose === null ? '—' : kmoney(x.aClose)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </>}
    </div>
  )
}

const snapLabel = (s: Snapshot) => `Week of ${fmtDay(s.asOf)}`

const VarBar = ({ v, scale }: { v: number; scale: number }) => <span className="varbar" aria-hidden="true"><i className={v < 0 ? 'neg' : 'pos'} style={{ width: `${Math.round(Math.abs(v) / scale * 100)}%` }} /></span>

function SnapCompare({ a, b, now }: { a: Snapshot; b: Snapshot | null; now: Forecast }) {
  const other = b ?? { label: 'Today', low: now.low, breach: now.breach, safeToSpend: now.safeToSpend, start: now.start, minCash: now.minCash, reserve: now.reserve, byGroup: Object.fromEntries(Object.entries(now.weeks.reduce((m, w) => { for (const [g, v] of Object.entries(w.byGroup)) m[g] = (m[g] ?? 0) + (v ?? 0); return m }, {} as Record<string, number>))) as Snapshot['byGroup'], weeks: now.weeks }
  const rows: [string, number, number][] = [
    ['Opening balance', a.start, other.start], ['Low point', a.low.amount, other.low.amount], ['Safe to spend', a.safeToSpend, other.safeToSpend], ['Reserve for big bills', a.reserve, other.reserve],
    ...[...new Set([...Object.keys(a.byGroup), ...Object.keys(other.byGroup)])].map(g => [`13 weeks: ${GROUP_LABEL[g as Group]}`, a.byGroup[g as Group] ?? 0, other.byGroup[g as Group] ?? 0] as [string, number, number]),
  ]
  return (
    <div className="table-wrap">
      <table className="data-table">
        <thead><tr><th></th><th className="num">{snapLabel(a)}</th><th className="num">{b ? snapLabel(b) : 'Today'}</th><th className="num">Change</th></tr></thead>
        <tbody>
          {rows.map(([l, x, y]) => <tr key={l}><th scope="row">{l}</th><td className="num">{money(x, { cents: false })}</td><td className="num">{money(y, { cents: false })}</td><td className={`num ${y - x > 0 ? 'pos' : y - x < 0 ? 'neg' : 'muted'}`}>{y === x ? '—' : money(y - x, { cents: false, sign: true })}</td></tr>)}
          <tr><th scope="row">First week below minimum</th><td className="num">{a.breach ? `Week ${a.breach}` : 'Never'}</td><td className="num">{other.breach ? `Week ${other.breach}` : 'Never'}</td><td /></tr>
        </tbody>
      </table>
    </div>
  )
}

// ---------- Inputs: what the engine found, with overrides ----------

function InputsTab({ project, fc }: Props) {
  const { inputs } = fc
  const ov = project.overrides
  const [q, setQ] = useState('')
  const match = (s: string) => !q || s.toLowerCase().includes(q.toLowerCase())
  return (
    <div className="stack">
      <div className="row between wrap gap-sm">
        <p className="muted small grow">Everything the forecast is built from. Turn items off, fix amounts and dates; your edits survive the next import.</p>
        <input type="search" placeholder="Filter by name" value={q} onChange={e => setQ(e.target.value)} aria-label="Filter inputs" className="search" />
      </div>

      <div className="panel">
        <div className="panel-head"><h2>Recurring money in and out</h2><span className="muted small">{plural(inputs.series.length, 'series', 'series')} detected from {plural(fc.inputs.series.reduce((a, s) => a + s.count, 0), 'payment')}</span></div>
        <div className="table-wrap">
          <table className="data-table">
            <thead><tr><th>Include</th><th>Name</th><th>Every</th><th>Next</th><th className="num">Amount</th><th className="num">Trend</th><th>Seen</th><th>Confidence</th></tr></thead>
            <tbody>
              {inputs.series.filter(s => match(s.label)).map(s => (
                <tr key={s.key} className={ov.series[s.key]?.include === false ? 'off' : ''}>
                  <td><label className="switch"><input type="checkbox" checked={ov.series[s.key]?.include !== false} onChange={e => void setOv(project, 'series', s.key, { include: e.target.checked })} /><span aria-hidden="true" /><span className="sr">Include {s.label}</span></label></td>
                  <th scope="row">{s.label} <span className="chip neutral tiny">{s.category}</span>{s.source === 'template' && <span className="chip info tiny">QuickBooks template</span>}</th>
                  <td>{s.cadence}</td>
                  <td>{fmtDay(s.next)}</td>
                  <td className="num"><input className="num-input" type="number" step="0.01" defaultValue={s.amount / 100} key={s.amount} aria-label={`Amount for ${s.label}`} onBlur={e => { const v = Math.round(Number(e.target.value) * 100); if (Number.isFinite(v) && v !== s.amount) void setOv(project, 'series', s.key, { amount: v }) }} />{ov.series[s.key]?.amount !== undefined && <button type="button" className="linkish tiny" onClick={() => void setOv(project, 'series', s.key, { amount: undefined })}>reset</button>}</td>
                  <td className="num muted">{s.drift ? money(s.drift, { cents: false, sign: true }) : '—'}</td>
                  <td>{s.history.length ? <Spark values={s.history.slice(-12).map(h => Math.abs(h.amount))} w={70} h={20} /> : '—'}</td>
                  <td><span className={`conf c${Math.round(s.confidence * 4)}`} title={`${Math.round(s.confidence * 100)}%`}><i style={{ width: `${s.confidence * 100}%` }} /></span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="panel">
        <div className="panel-head"><h2>Open invoices (A/R)</h2><span className="muted small">Expected date = due date + that customer’s real lateness</span></div>
        {!inputs.collections.length ? <p className="muted">No open invoices. Import an A/R aging report on the Data tab.</p> : (
          <div className="table-wrap">
            <table className="data-table">
              <thead><tr><th>Include</th><th>Customer</th><th>Invoice</th><th>Due</th><th>Expected</th><th>Why</th><th className="num">Open</th><th className="num">Counted</th></tr></thead>
              <tbody>
                {inputs.collections.filter(c => match(c.invoice.customer)).map(c => (
                  <tr key={c.invoice.id} className={c.excluded ? 'off' : ''}>
                    <td><label className="switch"><input type="checkbox" checked={!ov.invoices[c.invoice.id]?.exclude && !c.doubtful} disabled={c.doubtful} onChange={e => void setOv(project, 'invoices', c.invoice.id, { exclude: !e.target.checked })} /><span aria-hidden="true" /><span className="sr">Include invoice {c.invoice.num}</span></label></td>
                    <th scope="row">{c.invoice.customer}</th><td>{c.invoice.num}</td>
                    <td className={c.invoice.due <= fc.f.asOf ? 'neg' : ''}>{fmtDay(c.invoice.due)}</td>
                    <td><input type="date" value={ov.invoices[c.invoice.id]?.expected ?? c.expected} min={addDays(fc.f.asOf, 1)} aria-label={`Expected payment date for ${c.invoice.num}`} onChange={e => void setOv(project, 'invoices', c.invoice.id, { expected: e.target.value || undefined })} /></td>
                    <td className="small muted">{c.doubtful ? 'Over 120 days past due: treated as doubtful' : c.basis}</td>
                    <td className="num">{money(c.invoice.amount, { cents: false })}</td>
                    <td className="num">{c.excluded ? '—' : money(c.amount, { cents: false })}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="panel">
        <div className="panel-head"><h2>Open bills (A/P)</h2><span className="muted small">Paid on terms{project.settings.payDelay ? ` + ${project.settings.payDelay} days` : ''}</span></div>
        {!inputs.payments.length ? <p className="muted">No open bills. Import an A/P aging report on the Data tab.</p> : (
          <div className="table-wrap">
            <table className="data-table">
              <thead><tr><th>Include</th><th>Vendor</th><th>Bill</th><th>Due</th><th>Pay on</th><th className="num">Amount</th></tr></thead>
              <tbody>
                {inputs.payments.filter(p => match(p.bill.vendor)).map(p => (
                  <tr key={p.bill.id} className={p.excluded ? 'off' : ''}>
                    <td><label className="switch"><input type="checkbox" checked={!p.excluded} onChange={e => void setOv(project, 'bills', p.bill.id, { exclude: !e.target.checked })} /><span aria-hidden="true" /><span className="sr">Include bill {p.bill.num}</span></label></td>
                    <th scope="row">{p.bill.vendor}</th><td>{p.bill.num}</td>
                    <td className={p.overdue ? 'neg' : ''}>{fmtDay(p.bill.due)}{p.overdue && ' (overdue)'}</td>
                    <td><input type="date" value={ov.bills[p.bill.id]?.pay ?? p.date} min={addDays(fc.f.asOf, 1)} aria-label={`Payment date for ${p.bill.num}`} onChange={e => void setOv(project, 'bills', p.bill.id, { pay: e.target.value || undefined })} /></td>
                    <td className="num">{money(p.bill.amount, { cents: false })}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="panel">
        <div className="panel-head"><h2>How each customer pays</h2><span className="muted small">From matched invoices and payments</span></div>
        {!inputs.stats.length ? <p className="muted">No payment history yet. Import a QuickBooks transaction list with invoices and payments.</p> : (
          <div className="table-wrap">
            <table className="data-table">
              <thead><tr><th>Customer</th><th className="num">Paid invoices</th><th className="num">Days to pay (median)</th><th className="num">Days late (median)</th><th className="num">Days late (slow 25%)</th><th></th></tr></thead>
              <tbody>
                {inputs.stats.filter(s => match(s.customer)).map(s => (
                  <tr key={s.customer}><th scope="row">{s.customer}</th><td className="num">{s.invoices}</td><td className="num">{s.medianDays}</td><td className={`num ${s.slow ? 'neg' : ''}`}>{s.medianLate}</td><td className="num">{s.p75Late}</td><td>{s.slow ? <span className="chip critical">Slow payer · {project.settings.haircutPct}% haircut</span> : <span className="chip good">Reliable</span>}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      <p className="muted small">Week 1 starts {fmtDate(weekStart(fc.f.asOf, 1))}.</p>
    </div>
  )
}
