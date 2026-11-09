import { lazy, Suspense, useEffect, useState } from 'react'
import { TABS, type Tab } from './App.tsx'
import { CashChart } from './Chart.tsx'
import { GROUP_LABEL, IN_GROUPS, makeSnapshot, OUT_GROUPS, scenarioLabel, type Forecast } from './engine/forecast.ts'
import { toCsv } from './engine/importer.ts'
import { hasData, useForecast, useProject } from './projectData.ts'
import { saveProject, uuid } from './store.ts'
import { download, Empty, fmtDate, fmtDay, go, isTyping, kmoney, Link, money, SyntheticBadge, toast } from './ui.tsx'

const Panels = lazy(() => import('./Panels.tsx'))
const DataTab = lazy(() => import('./Import.tsx'))

const TAB_LABEL: Record<Tab, string> = { forecast: 'Forecast', collections: 'Collections', scenarios: 'Scenarios', funds: 'Sinking funds', history: 'History', inputs: 'Inputs', data: 'Data' }

export function weekRows(f: Forecast) {
  const used = (gs: typeof IN_GROUPS) => gs.filter(g => f.weeks.some(w => w.byGroup[g]))
  const rows: { label: string; values: number[]; kind: 'head' | 'line' | 'total' | 'close' }[] = []
  rows.push({ label: 'Opening balance', values: f.weeks.map(w => w.open), kind: 'head' })
  for (const g of used(IN_GROUPS)) rows.push({ label: GROUP_LABEL[g], values: f.weeks.map(w => w.byGroup[g] ?? 0), kind: 'line' })
  rows.push({ label: 'Total in', values: f.weeks.map(w => w.inflow), kind: 'total' })
  for (const g of used(OUT_GROUPS)) rows.push({ label: GROUP_LABEL[g], values: f.weeks.map(w => w.byGroup[g] ?? 0), kind: 'line' })
  rows.push({ label: 'Total out', values: f.weeks.map(w => -w.outflow), kind: 'total' })
  rows.push({ label: 'Net change', values: f.weeks.map(w => w.inflow - w.outflow), kind: 'total' })
  rows.push({ label: 'Closing balance', values: f.weeks.map(w => w.close), kind: 'close' })
  return rows
}

export function tableAoa(f: Forecast): (string | number)[][] {
  return [['', ...f.weeks.map(w => `Week ${w.i} (${w.start} to ${w.end})`)], ...weekRows(f).map(r => [r.label, ...r.values.map(v => v / 100)]), [], ['Minimum cash', f.minCash / 100], ['Low point', f.low.amount / 100, f.low.week ? `week ${f.low.week}` : 'today'], ['Safe to spend', f.safeToSpend / 100]]
}

async function exportXlsx(name: string, f: Forecast) {
  const XLSX = await import('xlsx')
  const ws = XLSX.utils.aoa_to_sheet(tableAoa(f))
  ws['!cols'] = [{ wch: 30 }, ...f.weeks.map(() => ({ wch: 14 }))]
  for (const k of Object.keys(ws)) if (!k.startsWith('!') && typeof ws[k].v === 'number') ws[k].z = '#,##0.00;[Red]-#,##0.00'
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, '13-week forecast')
  XLSX.writeFile(wb, `${name} 13-week cash forecast.xlsx`)
}

export default function ProjectView({ id, tab }: { id: string; tab: Tab }) {
  const { loading, project, ds, update, reload } = useProject(id)
  const fc = useForecast(project, ds)
  const [renaming, setRenaming] = useState(false)

  useEffect(() => {
    if (project) document.title = `${project.name} · ${TAB_LABEL[tab]} · Runway`
  }, [project?.name, tab])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTyping(e) || e.metaKey || e.ctrlKey || e.altKey || document.querySelector('dialog[open]')) return
      const n = Number(e.key)
      if (n >= 1 && n <= TABS.length) go(`/app/p/${id}/${TABS[n - 1]}`, { keepScroll: true })
      if (e.key === 'p' && fc) go(`/app/p/${id}/brief`)
      if (e.key === 's' && fc) save()
    }
    addEventListener('keydown', onKey)
    return () => removeEventListener('keydown', onKey)
  })

  if (loading) return <div className="boot" role="status"><span className="spinner" /> Opening the forecast</div>
  if (!project) return <section className="page narrow center"><Empty title="Business not found"><p className="muted">It may have been deleted on another device.</p><Link href="/app" className="btn primary">All forecasts</Link></Empty></section>

  const save = () => {
    if (!fc) return
    const snap = makeSnapshot(fc.f, uuid(), `Week of ${fc.f.asOf}`)
    const prev = project.snapshots.find(s => s.asOf === fc.f.asOf)
    void saveProject({ ...project, snapshots: [...project.snapshots.filter(s => s.asOf !== fc.f.asOf), snap].sort((a, b) => a.asOf.localeCompare(b.asOf)) })
    toast(prev ? `Replaced the saved forecast for ${fmtDay(fc.f.asOf)}` : `Saved this week’s forecast. Next week, History compares it with what actually happened.`, { tone: 'ok', undo: () => void saveProject({ ...project }) })
  }

  const empty = !hasData(ds)
  const effectiveTab = empty && tab !== 'data' ? 'data' : tab

  return (
    <section className="page project">
      <div className="project-head">
        <div className="grow">
          <div className="crumbs"><Link href="/app">Forecasts</Link> <span aria-hidden="true">/</span></div>
          <div className="row gap-sm wrap">
            {renaming ? (
              <form onSubmit={e => { e.preventDefault(); const v = String(new FormData(e.currentTarget).get('n')).trim(); if (v) void update({ name: v }); setRenaming(false) }}>
                <input name="n" className="title-input" defaultValue={project.name} autoFocus aria-label="Business name" onBlur={e => e.currentTarget.form?.requestSubmit()} />
              </form>
            ) : <h1 className="project-title"><button type="button" className="title-btn" title="Rename" onClick={() => setRenaming(true)}>{project.name}</button></h1>}
            {project.sampleId && <SyntheticBadge />}
          </div>
          {fc && <p className="muted small">Balance as of {fmtDate(fc.f.asOf)}{fc.inputs.startKnown ? '' : ' (no balance yet: add it on the Data tab)'} · forecast to {fmtDate(fc.f.weeks[12].end)}</p>}
        </div>
        {fc && (
          <div className="row gap-sm wrap head-actions">
            <button type="button" className="btn ghost sm" onClick={() => download(`${project.name} 13-week cash forecast.csv`, toCsv(tableAoa(fc.f)))}>CSV</button>
            <button type="button" className="btn ghost sm" onClick={() => void exportXlsx(project.name, fc.f).catch(() => toast('Excel export failed to load. Try CSV.', { tone: 'error' }))}>Excel</button>
            <Link href={`/app/p/${id}/brief`} className="btn ghost sm">Cash brief</Link>
            <button type="button" className="btn primary sm" onClick={save} title="Shortcut: S">Save this week</button>
          </div>
        )}
      </div>

      {fc && <Kpis f={fc.f} startKnown={fc.inputs.startKnown} />}

      <nav className="tabs" aria-label="Forecast sections">
        {TABS.map((t, i) => <Link key={t} href={`/app/p/${id}/${t}`} aria-current={effectiveTab === t ? 'page' : undefined} title={`Shortcut: ${i + 1}`}>{TAB_LABEL[t]}{t === 'collections' && fc ? <span className="tab-count">{new Set(fc.inputs.collections.filter(c => !c.excluded && c.invoice.due <= fc.f.asOf).map(c => c.invoice.customer)).size || ''}</span> : null}</Link>)}
      </nav>

      <Suspense fallback={<div className="boot"><span className="spinner" /></div>}>
        {effectiveTab === 'forecast' && fc && <ForecastTab f={fc.f} base={project.scenarios.some(s => s.on) ? fc.base : undefined} project={project} />}
        {effectiveTab === 'data' && <DataTab project={project} ds={ds!} reload={reload} />}
        {effectiveTab !== 'forecast' && effectiveTab !== 'data' && fc && ds && <Panels tab={effectiveTab} project={project} ds={ds} fc={fc} />}
      </Suspense>
    </section>
  )
}

function Kpis({ f, startKnown }: { f: Forecast; startKnown: boolean }) {
  return (
    <div className="kpis">
      <div className={`kpi hero-kpi ${f.safeToSpend < 0 ? 'bad' : 'good'}`}>
        <span>Safe to spend</span>
        <strong>{money(f.safeToSpend, { cents: false })}</strong>
        <em>{f.safeToSpend < 0 ? 'Short of your minimum. Hold spending, chase invoices.' : `Low point ${kmoney(f.low.amount)} − minimum ${kmoney(f.minCash)}${f.reserve ? ` − reserve ${kmoney(f.reserve)}` : ''}`}</em>
      </div>
      <div className="kpi"><span>Cash today</span><strong>{startKnown ? money(f.start, { cents: false }) : '—'}</strong><em>{startKnown ? 'bank balance' : 'add a balance'}</em></div>
      <div className="kpi"><span>Low point</span><strong className={f.low.amount < f.minCash ? 'neg' : ''}>{money(f.low.amount, { cents: false })}</strong><em>{f.low.week ? `week ${f.low.week}, ${fmtDay(f.weeks[f.low.week - 1].end)}` : 'today'}</em></div>
      <div className="kpi"><span>Below minimum</span><strong className={f.breach ? 'neg' : 'pos'}>{f.breach ? `Week ${f.breach}` : 'Never'}</strong><em>{f.breach ? `from ${fmtDay(f.weeks[f.breach - 1].start)}` : `stays above ${kmoney(f.minCash)}`}</em></div>
      <div className="kpi"><span>In 13 weeks</span><strong>{money(f.end, { cents: false })}</strong><em>{money(f.end - f.start, { cents: false, sign: true })}</em></div>
    </div>
  )
}

function ForecastTab({ f, base, project }: { f: Forecast; base?: Forecast; project: import('./store.ts').Project }) {
  const [week, setWeek] = useState<number | null>(null)
  const rows = weekRows(f)
  const on = project.scenarios.filter(s => s.on)
  const w = week ? f.weeks[week - 1] : null
  return (
    <div className="stack">
      <div className="panel chart-panel">
        <div className="panel-head">
          <h2>Cash balance, next 13 weeks</h2>
          <div className="legend">
            <span><i className="lg-line" />Forecast</span>
            {base && <span><i className="lg-ghost" />Without scenarios</span>}
            <span><i className="lg-in" />In</span><span><i className="lg-out" />Out</span>
          </div>
        </div>
        {on.length > 0 && <div className="row gap-sm wrap scenario-on"><span className="muted small">Scenarios on:</span>{on.map(s => <span key={s.id} className="chip info">{scenarioLabel(s)}</span>)}<Link href={`/app/p/${project.id}/scenarios`} className="linkish small">Edit</Link></div>}
        <CashChart f={f} base={base} height={360} />
      </div>

      <div className="panel">
        <div className="panel-head"><h2>13-week table</h2><span className="muted small">Click a week for the line items</span></div>
        <div className="table-wrap sticky-first">
          <table className="sheet-table">
            <thead>
              <tr><th scope="col">Week ending</th>{f.weeks.map(x => <th key={x.i} scope="col" className={`num${x.close < f.minCash ? ' under' : ''}${week === x.i ? ' sel' : ''}`}><button type="button" className="th-btn" onClick={() => setWeek(week === x.i ? null : x.i)}><small>Wk {x.i}</small>{fmtDay(x.end)}</button></th>)}</tr>
            </thead>
            <tbody>
              {rows.map(r => (
                <tr key={r.label} className={`r-${r.kind}`}>
                  <th scope="row">{r.label}</th>
                  {r.values.map((v, i) => <td key={i} className={`num${r.kind === 'close' && v < f.minCash ? ' under' : ''}${week === i + 1 ? ' sel' : ''}${v < 0 && r.kind !== 'line' ? ' neg' : ''}`}>{v === 0 && r.kind === 'line' ? <span className="zero">·</span> : kmoney(v)}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {w && (
          <div className="week-detail">
            <h3>Week {w.i}: {fmtDay(w.start)} to {fmtDay(w.end)} <button type="button" className="icon-btn sm" aria-label="Close" onClick={() => setWeek(null)}>&times;</button></h3>
            {w.lines.length === 0 ? <p className="muted">Nothing expected this week.</p> : (
              <ul className="line-list">
                {[...w.lines].sort((a, b) => a.date.localeCompare(b.date) || b.amount - a.amount).map(l => (
                  <li key={l.id}><span className="muted tiny">{fmtDay(l.date)}</span><span className="grow">{l.label}</span><span className="chip neutral tiny">{GROUP_LABEL[l.group]}</span><span className={`num ${l.amount > 0 ? 'pos' : 'neg'}`}>{money(l.amount, { cents: false, sign: true })}</span></li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
