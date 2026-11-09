import { parseMoney } from './engine/dates.ts'
import { deleteProject, getProjects, saveProject, setPrefs, usePrefs, type Prefs } from './store.ts'
import { exportAll, syncNow, useSync } from './sync.ts'
import { ask, download, Link, setTheme, toast, useDark } from './ui.tsx'

export default function Settings() {
  const p = usePrefs()
  const dark = useDark()
  const sync = useSync()
  const save = (patch: Partial<Prefs>, msg = 'Saved') => { setPrefs(patch); toast(msg, { tone: 'ok', ttl: 1500 }) }

  const setSyncRaw = async (on: boolean) => {
    save({ syncRaw: on }, on ? 'Transactions will sync' : 'Transactions stay on this device')
    // Re-push so the cloud copy matches: turning it off overwrites any transactions synced before.
    if (sync.user) { for (const x of getProjects()) await saveProject(x, { silent: true }); void syncNow() }
  }

  return (
    <section className="page narrow settings">
      <div className="eyebrow">Settings</div>
      <h1>Settings</h1>

      <div className="panel" id="privacy">
        <div className="panel-head"><h2>Privacy and sync</h2>{sync.user ? <span className="chip neutral">Signed in as {sync.user.email}</span> : <span className="chip good">Signed out: nothing syncs</span>}</div>
        <label className="toggle">
          <input type="checkbox" checked={p.syncRaw} onChange={e => void setSyncRaw(e.target.checked)} />
          <span><b>Sync imported transactions</b><br /><span className="muted small">When signed in, bank lines, open invoices and bills (up to 1.5 MB per business) sync so another device can forecast without re-importing. Turn off to keep them on this device; settings, scenarios and saved weekly forecasts still sync.</span></span>
        </label>
        <hr />
        <div className="local-list">
          <div>
            <h3>Always stays on this device</h3>
            <ul>
              <li>The original files you drop in</li>
              <li>Transactions over 1.5 MB per business{p.syncRaw ? '' : ', and all transactions while sync is off'}</li>
              <li>Reminder email drafts</li>
              <li>Everything, if you never sign in</li>
            </ul>
          </div>
          <div>
            <h3>Syncs when you sign in</h3>
            <ul>
              <li>Business names, assumptions and your edits</li>
              <li>Scenarios and promised payment dates</li>
              <li>Saved weekly forecasts (totals per week)</li>
              {p.syncRaw && <li>Parsed transactions, invoices and bills under the cap</li>}
            </ul>
          </div>
        </div>
        <p className="muted small" style={{ marginTop: 12 }}>Parsing and forecasting run in your browser; there is no server step. <Link href="/docs#privacy">More on data handling</Link>.</p>
      </div>

      <div className="panel">
        <h2>Defaults for new businesses</h2>
        <p className="muted small">Each business keeps its own assumptions on its Data tab.</p>
        <div className="form-grid">
          <label className="field"><span>Minimum cash ($)</span><input inputMode="decimal" defaultValue={(p.settings.minCash / 100).toLocaleString('en-US')} onBlur={e => { const v = parseMoney(e.target.value); if (v !== null && v >= 0) save({ settings: { ...p.settings, minCash: v } }) }} /><small>The balance you never want to plan below.</small></label>
          <label className="field"><span>Slow-payer haircut (%)</span><input type="number" min="0" max="100" defaultValue={p.settings.haircutPct} onBlur={e => save({ settings: { ...p.settings, haircutPct: Math.min(100, Math.max(0, Number(e.target.value) || 0)) } })} /></label>
          <label className="field"><span>Slow payer after (days late)</span><input type="number" min="1" max="120" defaultValue={p.settings.slowDays} onBlur={e => save({ settings: { ...p.settings, slowDays: Math.min(120, Math.max(1, Number(e.target.value) || 15)) } })} /></label>
          <label className="field"><span>Pay bills (days after due)</span><input type="number" min="0" max="60" defaultValue={p.settings.payDelay} onBlur={e => save({ settings: { ...p.settings, payDelay: Math.min(60, Math.max(0, Number(e.target.value) || 0)) } })} /></label>
          <label className="field"><span>Currency</span><select value={p.settings.currency} onChange={e => save({ settings: { ...p.settings, currency: e.target.value as 'USD' | 'CAD' } })}><option value="USD">US dollar</option><option value="CAD">Canadian dollar</option></select></label>
        </div>
        <h3 className="sub">Reminder emails come from</h3>
        <div className="form-grid">
          <label className="field"><span>Your name</span><input defaultValue={p.sender.name} onBlur={e => save({ sender: { ...p.sender, name: e.target.value } })} /></label>
          <label className="field"><span>Company</span><input defaultValue={p.sender.company} onBlur={e => save({ sender: { ...p.sender, company: e.target.value } })} /></label>
        </div>
      </div>

      <div className="panel">
        <h2>Appearance</h2>
        <div className="seg-control" role="radiogroup" aria-label="Theme">
          <button type="button" role="radio" aria-checked={!dark} className={!dark ? 'on' : ''} onClick={() => setTheme('light')}>Light</button>
          <button type="button" role="radio" aria-checked={dark} className={dark ? 'on' : ''} onClick={() => setTheme('dark')}>Dark</button>
        </div>
      </div>

      <div className="panel">
        <h2>Your data</h2>
        <p>Businesses live in this browser (IndexedDB). {sync.user ? <>Signed in as <b>{sync.user.email}</b>.</> : 'Sign in from the account menu to use them on another device. It is optional.'}</p>
        <div className="row gap wrap">
          <button type="button" className="btn ghost" onClick={async () => download(`runway-export-${new Date().toISOString().slice(0, 10)}.json`, await exportAll())}>Export all my data (JSON)</button>
          <button type="button" className="btn danger-ghost" onClick={async () => {
            const list = getProjects()
            if (!list.length) { toast('Nothing to delete'); return }
            if (!(await ask('Delete every business?', `Removes ${list.length} business${list.length > 1 ? 'es' : ''} from this browser${sync.user ? ' and from your cloud account' : ''}. You can undo for a few seconds.`, 'Delete everything'))) return
            const undos = await Promise.all(list.map(x => deleteProject(x.id)))
            toast(`Deleted ${list.length} businesses`, { undo: () => { for (const u of undos) void u() } })
          }}>Delete all businesses</button>
        </div>
      </div>

      <div className="panel">
        <h2>Keyboard shortcuts</h2>
        <dl className="shortcuts">
          <div><dt><kbd>1</kbd>&ndash;<kbd>7</kbd></dt><dd>Switch tabs in a business</dd></div>
          <div><dt><kbd>S</kbd></dt><dd>Save this week’s forecast</dd></div>
          <div><dt><kbd>P</kbd></dt><dd>Printable cash brief</dd></div>
          <div><dt><kbd>&#8592;</kbd> <kbd>&#8594;</kbd></dt><dd>Move a dragged payment on the chart</dd></div>
          <div><dt><kbd>&#8984;</kbd>/<kbd>Ctrl</kbd> <kbd>Z</kbd></dt><dd>Undo the last delete</dd></div>
        </dl>
      </div>
    </section>
  )
}
