import { useEffect, useMemo } from 'react'
import { CashChart } from './Chart.tsx'
import { collectionsWorklist, scenarioLabel } from './engine/forecast.ts'
import { useForecast, useProject } from './projectData.ts'
import { weekRows } from './Project.tsx'
import { fmtDate, fmtDay, kmoney, Link, money } from './ui.tsx'

/** One printable page for the owner, a partner or the bank. */
export default function Brief({ id }: { id: string }) {
  const { loading, project, ds } = useProject(id)
  const fc = useForecast(project, ds)
  const chase = useMemo(() => fc && project ? collectionsWorklist(fc.inputs, project.settings, project.scenarios).slice(0, 4) : [], [fc])
  useEffect(() => { if (project) document.title = `Cash brief · ${project.name}` }, [project?.name])
  if (loading) return <div className="boot"><span className="spinner" /> Preparing the brief</div>
  if (!project || !fc) return <div className="page narrow center"><p>Nothing to brief yet.</p><Link href={`/app/p/${id}/data`} className="btn primary">Import data</Link></div>
  const { f, inputs } = fc
  const rows = weekRows(f).filter(r => r.kind !== 'line')
  const funds = inputs.funds.filter(x => x.include).slice(0, 4)
  const on = project.scenarios.filter(s => s.on)
  const bigOut = [...f.weeks.flatMap(w => w.lines)].filter(l => l.amount < 0).sort((a, b) => a.amount - b.amount).slice(0, 5)
  return (
    <div className="print-page">
      <div className="print-toolbar">
        <Link href={`/app/p/${id}`} className="btn ghost sm">Back</Link>
        <span className="muted small">One page, letter or A4. Use your browser’s print dialog to save as PDF.</span>
        <button type="button" className="btn primary sm" onClick={() => print()}>Print</button>
      </div>
      <article className="brief">
        <header className="brief-head">
          <div>
            <div className="eyebrow">Cash brief</div>
            <h1>{project.name}</h1>
            <p className="muted">13 weeks from {fmtDate(f.asOf)} to {fmtDate(f.weeks[12].end)}{project.sampleId ? ' · synthetic sample data' : ''}</p>
          </div>
          <div className={`brief-safe ${f.safeToSpend < 0 ? 'bad' : 'good'}`}><span>Safe to spend</span><strong>{money(f.safeToSpend, { cents: false })}</strong></div>
        </header>

        <section className="brief-kpis">
          <div><span>Cash today</span><b>{money(f.start, { cents: false })}</b></div>
          <div><span>Low point</span><b>{money(f.low.amount, { cents: false })}</b><em>{f.low.week ? `week ${f.low.week} (${fmtDay(f.weeks[f.low.week - 1].end)})` : 'today'}</em></div>
          <div><span>Minimum cash</span><b>{money(f.minCash, { cents: false })}</b><em>{f.breach ? `breached week ${f.breach}` : 'never breached'}</em></div>
          <div><span>Week 13</span><b>{money(f.end, { cents: false })}</b></div>
        </section>

        <CashChart f={f} height={210} compact />

        <table className="brief-table">
          <thead><tr><th></th>{f.weeks.map(w => <th key={w.i}>{fmtDay(w.end)}</th>)}</tr></thead>
          <tbody>{rows.map(r => <tr key={r.label} className={`r-${r.kind}`}><th>{r.label}</th>{r.values.map((v, i) => <td key={i} className={r.kind === 'close' && v < f.minCash ? 'under' : ''}>{kmoney(v)}</td>)}</tr>)}</tbody>
        </table>

        <div className="brief-cols">
          <section>
            <h2>Collect this week</h2>
            {chase.length ? <ul>{chase.map(c => <li key={c.customer}><b>{c.customer}</b> {money(c.overdue || c.open, { cents: false })} {c.overdue ? 'overdue' : 'open'}{c.impact > 0 ? `, lifts low point ${kmoney(c.impact)}` : ''}</li>)}</ul> : <p className="muted">No open invoices.</p>}
            <h2>Largest payments ahead</h2>
            <ul>{bigOut.map(l => <li key={l.id}>{fmtDay(l.date)} · {l.label} <b>{money(-l.amount, { cents: false })}</b></li>)}</ul>
          </section>
          <section>
            <h2>Set aside for big bills</h2>
            {funds.length ? <ul>{funds.map(x => <li key={x.key}>{x.label}: {money(x.amount, { cents: false })} due {fmtDay(x.due)}, <b>{money(x.perWeek, { cents: false })}/week</b></li>)}</ul> : <p className="muted">None detected.</p>}
            <h2>Assumptions</h2>
            <ul className="small">
              <li>Invoices arrive when each customer usually pays, not on the due date. Slow payers: {project.settings.haircutPct}% held back.</li>
              <li>Bills paid {project.settings.payDelay ? `${project.settings.payDelay} days after` : 'on'} their due date.</li>
              <li>Safe to spend = low point − minimum cash − {money(f.reserve, { cents: false })} accrued for bills after week 13.</li>
              {on.length > 0 && <li>Scenarios included: {on.map(scenarioLabel).join('; ')}.</li>}
            </ul>
          </section>
        </div>
        <footer className="brief-foot">Prepared {new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })} with Runway. A forecast is an estimate based on the data imported.</footer>
      </article>
    </div>
  )
}
