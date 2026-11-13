import { useRef, useState } from 'react'
import { parseMoney } from './engine/dates.ts'
import { apply, autoMap, decodeText, detect, FIELDS, KIND_LABEL, merge, type Applied, type Kind, type Parsed } from './engine/importer.ts'
import { EMPTY_DATASET, type Dataset, type Settings } from './engine/types.ts'
import { putData, saveProject, uuid, type Project } from './store.ts'
import { useSync } from './sync.ts'
import { ask, Link, money, plural, toast } from './ui.tsx'

interface Pending { id: string; file: string; parsed: Parsed; kind: Kind; mapping: Record<string, number>; dayFirst: boolean }

export default function DataTab({ project, ds, reload }: { project: Project; ds: Dataset; reload(): void }) {
  const [pending, setPending] = useState<Pending[]>([])
  const [drag, setDrag] = useState(false)
  const [errors, setErrors] = useState<string[]>([])
  const input = useRef<HTMLInputElement>(null)
  const sync = useSync()
  const sample = !!project.sampleId

  const read = async (files: FileList | File[]) => {
    const next: Pending[] = [], errs: string[] = []
    for (const f of Array.from(files)) {
      if (f.size > 25_000_000) { errs.push(`${f.name}: larger than 25 MB. Export a shorter date range.`); continue }
      if (/\.pdf$/i.test(f.name)) { errs.push(`${f.name}: PDF statements can't be read reliably. Download CSV, OFX or QFX from your bank, or Excel/CSV from QuickBooks.`); continue }
      let text: string
      if (/\.xlsx?$/i.test(f.name)) {
        // QuickBooks Online's default report export is Excel: read the first sheet as CSV text.
        const XLSX = await import('xlsx')
        const wb = XLSX.read(await f.arrayBuffer(), { cellDates: false })
        text = XLSX.utils.sheet_to_csv(wb.Sheets[wb.SheetNames[0]], { blankrows: true })
      } else text = decodeText(await f.arrayBuffer())
      const p = detect(text, f.name)
      if (!p) { errs.push(`${f.name}: could not find a header row with a Date column. Check the file is a CSV or OFX export.`); continue }
      next.push({ id: uuid(), file: f.name, parsed: p, kind: p.kind, mapping: p.mapping, dayFirst: p.dayFirst })
    }
    setErrors(errs)
    setPending(cur => [...cur, ...next])
  }

  const commit = async (pd: Pending, res: Applied) => {
    const parsed = { ...pd.parsed, kind: pd.kind }
    const merged = merge(ds === EMPTY_DATASET ? { ...EMPTY_DATASET } : ds, parsed.kind, res.data)
    await putData(project.id, merged)
    await saveProject({ ...project, dataMissing: false, imports: [...project.imports, { id: uuid(), kind: pd.kind, fileName: pd.file, format: parsed.format, rows: res.imported, skipped: res.skipped, at: Date.now() }] })
    setPending(cur => cur.filter(x => x.id !== pd.id))
    reload()
    toast(`Imported ${plural(res.imported, 'row')} from ${pd.file}`, { tone: 'ok' })
  }

  const setS = (patch: Partial<Settings>) => saveProject({ ...project, settings: { ...project.settings, ...patch } })

  return (
    <div className="stack">
      {!ds.txns.length && !ds.ar.length && (
        <div className="callout">
          <b>Start with your bank transactions.</b> 12 to 24 months lets Runway find annual bills. Then add the QuickBooks A/R and A/P aging reports, and a transaction list for real days-to-pay. <Link href="/docs#exports">Exact export steps</Link>.
        </div>
      )}

      {sample ? (
        <div className="panel"><h2>Synthetic data</h2><p className="muted">This sample business is generated in your browser: 24 months of bank lines, invoice and payment history, and open invoices and bills as of {project.sampleAsOf}. Create your own business from the <Link href="/app">Forecasts</Link> page to import files.</p></div>
      ) : (
        <div className="panel">
          <div className="panel-head"><h2>Import files</h2><Link href="/docs#exports" className="linkish small">How to export from QuickBooks, Xero and banks</Link></div>
          <div className={`dropzone${drag ? ' over' : ''}`} onDragOver={e => { e.preventDefault(); setDrag(true) }} onDragLeave={() => setDrag(false)} onDrop={e => { e.preventDefault(); setDrag(false); void read(e.dataTransfer.files) }}>
            <div className="drop-icon" aria-hidden="true">
              <svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><path d="M12 16V4M7 9l5-5 5 5M4 20h16" /></svg>
            </div>
            <p><b>Drop CSV, OFX, QFX or Excel files here</b>, or <button type="button" className="linkish" onClick={() => input.current?.click()}>choose files</button></p>
            <p className="muted small">Bank transactions · QuickBooks A/R Aging Detail · A/P Aging Detail · Transaction List by Date · Recurring Template List · any CSV with dates and amounts</p>
            <input ref={input} type="file" multiple accept=".csv,.txt,.ofx,.qfx,.tsv,.xlsx,.xls" hidden onChange={e => { if (e.target.files) void read(e.target.files); e.target.value = '' }} />
          </div>
          {errors.map(e => <p key={e} className="error small" role="alert">{e}</p>)}
          {pending.map(pd => <Review key={pd.id} pd={pd} onChange={n => setPending(cur => cur.map(x => x.id === pd.id ? n : x))} onCancel={() => setPending(cur => cur.filter(x => x.id !== pd.id))} onCommit={res => void commit(pd, res)} />)}
        </div>
      )}

      <div className="grid-2">
        <div className="panel">
          <h2>What Runway has</h2>
          <dl className="have">
            <div><dt>Bank lines</dt><dd>{ds.txns.length ? <>{ds.txns.length.toLocaleString()} <small className="muted">{ds.txns[0].date} to {ds.txns[ds.txns.length - 1].date}</small></> : <span className="muted">none</span>}</dd></div>
            <div><dt>Open invoices</dt><dd>{ds.ar.length ? `${ds.ar.length} · ${money(ds.ar.reduce((a, i) => a + i.amount, 0), { cents: false })}` : <span className="muted">none</span>}</dd></div>
            <div><dt>Open bills</dt><dd>{ds.ap.length ? `${ds.ap.length} · ${money(ds.ap.reduce((a, i) => a + i.amount, 0), { cents: false })}` : <span className="muted">none</span>}</dd></div>
            <div><dt>Paid invoice history</dt><dd>{ds.paid.length || <span className="muted">none</span>}</dd></div>
            <div><dt>Recurring templates</dt><dd>{ds.templates.length || <span className="muted">none</span>}</dd></div>
          </dl>
          {project.imports.length > 0 && (
            <details className="imports">
              <summary>{plural(project.imports.length, 'import')}</summary>
              <ul>{[...project.imports].reverse().map(i => <li key={i.id}><b>{i.fileName}</b> <span className="muted small">{i.format}{i.rows ? ` · ${i.rows} rows` : ''}{i.skipped ? `, ${i.skipped} skipped` : ''} · {new Date(i.at).toLocaleDateString()}</span></li>)}</ul>
            </details>
          )}
          {!sample && (ds.txns.length > 0 || ds.ar.length > 0) && (
            <button type="button" className="btn danger-ghost sm" onClick={async () => {
              if (!(await ask('Clear imported data?', 'Removes every imported bank line, invoice and bill for this business. Settings, scenarios and saved weeks stay. You can undo for a few seconds.', 'Clear data'))) return
              const before = ds, imports = project.imports
              await putData(project.id, { ...EMPTY_DATASET })
              await saveProject({ ...project, imports: [] })
              reload()
              toast('Imported data cleared', { undo: async () => { await putData(project.id, before); await saveProject({ ...project, imports }); reload() } })
            }}>Clear imported data</button>
          )}
          {project.dataMissing && <p className="warn-text small">This business was synced from another device without its transactions. Import the files here to forecast.</p>}
          {sync.user && !sample && <p className="muted small">Signed in: settings, edits, scenarios and saved weeks sync. Transactions sync too when allowed in <Link href="/settings">Settings</Link> and under 1.5 MB.</p>}
        </div>

        <div className="panel">
          <h2>Bank balance</h2>
          <p className="muted small">The forecast starts from this balance, rolled forward through any later bank lines. Bank CSVs with a balance column and OFX files fill it in automatically.</p>
          {sample ? <p>{ds.balance ? `${money(ds.balance.amount)} on ${ds.balance.date}` : '—'}</p> : (
            <form className="row gap-sm wrap end" onSubmit={async e => {
              e.preventDefault()
              const f = new FormData(e.currentTarget)
              const amount = parseMoney(String(f.get('amt'))), date = String(f.get('date'))
              if (amount === null || !date) { toast('Enter an amount and a date', { tone: 'error' }); return }
              await putData(project.id, { ...ds, balance: { amount, date } })
              await saveProject({ ...project })
              reload()
              toast('Balance saved', { tone: 'ok' })
            }}>
              <label className="field"><span>Balance</span><input name="amt" inputMode="decimal" defaultValue={ds.balance ? (ds.balance.amount / 100).toFixed(2) : ''} placeholder="48,250.00" required /></label>
              <label className="field"><span>As of end of</span><input name="date" type="date" defaultValue={ds.balance?.date ?? ''} required /></label>
              <button className="btn primary sm">Save balance</button>
            </form>
          )}
        </div>
      </div>

      <div className="panel">
        <h2>Forecast assumptions</h2>
        <div className="form-grid">
          <Money label="Minimum cash" hint="Never plan to dip below this." value={project.settings.minCash} onChange={v => setS({ minCash: v })} />
          <NumField label="Slow-payer haircut (%)" hint="Share of a slow payer’s open invoices assumed to land after week 13." value={project.settings.haircutPct} min={0} max={100} onChange={v => setS({ haircutPct: v })} />
          <NumField label="Slow payer after (days late)" hint="Median days past due that marks a customer as slow." value={project.settings.slowDays} min={1} max={120} onChange={v => setS({ slowDays: v })} />
          <NumField label="Customers with no history pay (days late)" value={project.settings.defaultLag} min={0} max={90} onChange={v => setS({ defaultLag: v })} />
          <NumField label="Pay bills (days after due)" hint="0 = on the due date." value={project.settings.payDelay} min={0} max={60} onChange={v => setS({ payDelay: v })} />
          <label className="field"><span>Currency</span><select value={project.settings.currency} onChange={e => void setS({ currency: e.target.value as Settings['currency'] })}><option value="USD">US dollar</option><option value="CAD">Canadian dollar</option></select></label>
        </div>
        <h3 className="sub">Reminder emails come from</h3>
        <div className="form-grid">
          <label className="field"><span>Your name</span><input defaultValue={project.sender.name} onBlur={e => void saveProject({ ...project, sender: { ...project.sender, name: e.target.value } })} /></label>
          <label className="field"><span>Company</span><input defaultValue={project.sender.company} onBlur={e => void saveProject({ ...project, sender: { ...project.sender, company: e.target.value } })} /></label>
        </div>
      </div>
    </div>
  )
}

function Money({ label, hint, value, onChange }: { label: string; hint?: string; value: number; onChange(v: number): void }) {
  return <label className="field"><span>{label}</span><input inputMode="decimal" defaultValue={(value / 100).toLocaleString('en-US')} onBlur={e => { const v = parseMoney(e.target.value); if (v !== null && v >= 0 && v !== value) { onChange(v); toast('Saved', { tone: 'ok', ttl: 1200 }) } }} />{hint && <small>{hint}</small>}</label>
}

function NumField({ label, hint, value, min, max, onChange }: { label: string; hint?: string; value: number; min: number; max: number; onChange(v: number): void }) {
  return <label className="field"><span>{label}</span><input type="number" min={min} max={max} defaultValue={value} onBlur={e => { const v = Math.min(max, Math.max(min, Math.round(Number(e.target.value)))); if (Number.isFinite(v) && v !== value) { onChange(v); toast('Saved', { tone: 'ok', ttl: 1200 }) } }} />{hint && <small>{hint}</small>}</label>
}

function Review({ pd, onChange, onCancel, onCommit }: { pd: Pending; onChange(p: Pending): void; onCancel(): void; onCommit(r: Applied): void }) {
  const parsed = { ...pd.parsed, kind: pd.kind }
  const res = apply(parsed, pd.mapping, pd.dayFirst)
  const errors = res.issues.filter(i => i.level === 'error')
  const warnings = res.issues.filter(i => i.level === 'warning')
  const preview = parsed.rows.filter(r => r.some(Boolean)).slice(0, 4)
  return (
    <div className="review">
      <div className="row between wrap gap-sm">
        <div><b>{pd.file}</b><div className="muted small">Detected: {parsed.format}</div></div>
        {!parsed.ofx && (
          <label className="field inline"><span>This file is</span>
            <select value={pd.kind} onChange={e => { const k = e.target.value as Kind; onChange({ ...pd, kind: k, mapping: autoMap(k, parsed.header) }) }}>
              {(Object.keys(KIND_LABEL) as Kind[]).map(k => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}
            </select>
          </label>
        )}
      </div>
      {!parsed.ofx && (
        <>
          <div className="mapping">
            {FIELDS[pd.kind].map(f => (
              <label key={f.key} className="field"><span>{f.label}{f.required && <i className="req" aria-label="required">*</i>}</span>
                <select value={pd.mapping[f.key] ?? -1} onChange={e => onChange({ ...pd, mapping: { ...pd.mapping, [f.key]: Number(e.target.value) } })}>
                  <option value={-1}>(not in file)</option>
                  {parsed.header.map((h, i) => <option key={i} value={i}>{h || `Column ${i + 1}`}</option>)}
                </select>
              </label>
            ))}
            <label className="toggle small"><input type="checkbox" checked={pd.dayFirst} onChange={e => onChange({ ...pd, dayFirst: e.target.checked })} /><span>Dates are day first (14/03/2026)</span></label>
          </div>
          <div className="table-wrap preview">
            <table className="mini-table">
              <thead><tr>{parsed.header.map((h, i) => <th key={i}>{h}</th>)}</tr></thead>
              <tbody>{preview.map((r, i) => <tr key={i}>{parsed.header.map((_, j) => <td key={j}>{r[j]}</td>)}</tr>)}</tbody>
            </table>
          </div>
        </>
      )}
      <div className={`validation ${errors.length ? 'bad' : warnings.length ? 'warn' : 'ok'}`}>
        <b>{errors.length ? 'Cannot import yet' : `${plural(res.imported, 'row')} ready`}{res.skipped ? `, ${res.skipped} skipped` : ''}{warnings.length ? `, ${plural(warnings.length, 'warning')}` : ''}</b>
        {res.issues.length > 0 && (
          <ul>{res.issues.slice(0, 40).map((i, k) => <li key={k} className={i.level}>{i.line ? <span className="line">Line {i.line}</span> : null}{i.msg}</li>)}{res.issues.length > 40 && <li className="muted">and {res.issues.length - 40} more</li>}</ul>
        )}
      </div>
      <div className="row gap-sm end">
        <button type="button" className="btn ghost sm" onClick={onCancel}>Cancel</button>
        <button type="button" className="btn primary sm" disabled={!!errors.length || !res.imported} onClick={() => onCommit(res)}>Import {plural(res.imported, 'row')}</button>
      </div>
    </div>
  )
}
