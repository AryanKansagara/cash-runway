// node scripts/qa-sync.mjs : signs up a throwaway account, round-trips a project and a weekly snapshot, then deletes the account
import { readFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'
const env = Object.fromEntries(readFileSync(new URL('../.env', import.meta.url), 'utf8').split('\n').filter(l => l.includes('=') && !l.startsWith('#')).map(l => l.split('=')))
const sb = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_PUBLISHABLE_KEY, { auth: { persistSession: false } })
const email = `qa-cash-runway-${Date.now()}@example.com`, password = 'Qa-' + Math.random().toString(36).slice(2) + '!9'
const up = await sb.auth.signUp({ email, password })
if (up.error) { console.log('sign-up failed:', up.error.message); process.exit(1) }
if (!up.data.session) { const r = await sb.auth.signInWithPassword({ email, password }); if (r.error) { console.log('sign-in failed', r.error.message); process.exit(1) } }
console.log('signed up', email)
const id = crypto.randomUUID(), vid = crypto.randomUUID()
const project = { id, name: 'QA business', settings: { minCash: 2500000 }, scenarios: [{ id: 's', kind: 'loan', amount: 5000000, week: 2, aprPct: 9, months: 24, on: true }] }
let r = await sb.from('projects').upsert({ id, app: 'cash-runway', name: 'QA business', data: { project, dataset: { txns: [{ id: 't', date: '2026-11-01', amount: -100, desc: 'x' }] } }, updated_at: new Date().toISOString() })
console.log('upsert project', r.error?.message ?? 'ok')
r = await sb.from('project_versions').upsert({ id: vid, project_id: id, label: 'Week of 2026-11-07', data: { asOf: '2026-11-07', weeks: [] } })
console.log('upsert version', r.error?.message ?? 'ok')
const { data: p } = await sb.from('projects').select('id,name,data').eq('app', 'cash-runway')
const { data: v } = await sb.from('project_versions').select('id,label').in('project_id', [id])
console.log('read back', p?.length, 'projects,', v?.length, 'versions, scenarios', p?.[0]?.data.project.scenarios.length)
const anon = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_PUBLISHABLE_KEY, { auth: { persistSession: false } })
const { data: leak } = await anon.from('projects').select('id').eq('id', id)
console.log('anon can see', leak?.length ?? 0)
const d = await sb.rpc('delete_my_account')
console.log(d.error ? 'delete failed: ' + d.error.message : 'deleted ' + email)
const again = await sb.auth.signInWithPassword({ email, password })
console.log('sign-in after delete', again.error ? 'refused (good)' : 'still works (bad)')
