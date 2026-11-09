import { useSyncExternalStore } from 'react'
import type { Snapshot } from './engine/forecast.ts'
import type { Kind } from './engine/importer.ts'
import { DEFAULT_SETTINGS, EMPTY_OVERRIDES, type Dataset, type Overrides, type Scenario, type Settings } from './engine/types.ts'

export type { Snapshot }

export interface ImportMeta { id: string; kind: Kind; fileName: string; format: string; rows: number; skipped: number; at: number }

export interface Project {
  id: string
  name: string
  createdAt: number
  updatedAt: number
  settings: Settings
  overrides: Overrides
  scenarios: Scenario[]
  snapshots: Snapshot[]
  imports: ImportMeta[]
  /** Who reminder emails come from. */
  sender: { name: string; company: string }
  sampleId?: string
  /** Samples are generated from this date so they stay stable after creation. */
  sampleAsOf?: string
  /** True when this device has no copy of the imported transactions (synced from another device). */
  dataMissing?: boolean
}

// ---------- Tiny IndexedDB wrapper (falls back to memory in private modes) ----------

const DB = 'cash-runway'
let dbp: Promise<IDBDatabase | null> | null = null
function db(): Promise<IDBDatabase | null> {
  return dbp ??= new Promise(res => {
    try {
      const req = indexedDB.open(DB, 1)
      req.onupgradeneeded = () => {
        req.result.createObjectStore('projects', { keyPath: 'id' })
        req.result.createObjectStore('data')
      }
      req.onsuccess = () => res(req.result)
      req.onerror = () => res(null)
    } catch { res(null) }
  })
}
const mem = { projects: new Map<string, unknown>(), data: new Map<string, unknown>() }

async function tx<T>(store: 'projects' | 'data', mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const d = await db()
  if (!d) throw new Error('no-idb')
  return new Promise((res, rej) => {
    const r = fn(d.transaction(store, mode).objectStore(store))
    r.onsuccess = () => res(r.result)
    r.onerror = () => rej(r.error)
  })
}
async function idbGetAll<T>(store: 'projects'): Promise<T[]> {
  try { return await tx(store, 'readonly', s => s.getAll()) as T[] } catch { return [...mem[store].values()] as T[] }
}
async function idbGet<T>(store: 'projects' | 'data', key: string): Promise<T | undefined> {
  try { return await tx(store, 'readonly', s => s.get(key)) as T | undefined } catch { return mem[store].get(key) as T | undefined }
}
async function idbPut(store: 'projects' | 'data', value: unknown, key?: string) {
  try { await tx(store, 'readwrite', s => key === undefined ? s.put(value) : s.put(value, key)) } catch { mem[store].set(key ?? (value as { id: string }).id, value) }
}
async function idbDel(store: 'projects' | 'data', key: string) {
  try { await tx(store, 'readwrite', s => s.delete(key)) } catch { mem[store].delete(key) }
}

// ---------- In-memory project list with subscribers ----------

let projects: Project[] = []
let loaded = false
const subs = new Set<() => void>()
const emit = () => { projects = [...projects]; subs.forEach(f => f()) }
const changeHooks = new Set<(p: Project) => void>()

export const onProjectChange = (f: (p: Project) => void) => { changeHooks.add(f); return () => changeHooks.delete(f) }

export async function loadProjects() {
  projects = (await idbGetAll<Project>('projects')).sort((a, b) => b.updatedAt - a.updatedAt)
  loaded = true
  emit()
}

export function useProjects() {
  return useSyncExternalStore(f => { subs.add(f); return () => subs.delete(f) }, () => loaded ? projects : null)
}

export const getProjects = () => projects
export const getProject = (id: string) => projects.find(p => p.id === id)

export async function saveProject(p: Project, opts: { touch?: boolean; silent?: boolean } = {}) {
  const next = opts.touch === false ? p : { ...p, updatedAt: Date.now() }
  await idbPut('projects', next)
  const i = projects.findIndex(x => x.id === p.id)
  if (i >= 0) projects[i] = next
  else projects.unshift(next)
  projects.sort((a, b) => b.updatedAt - a.updatedAt)
  emit()
  if (!opts.silent) changeHooks.forEach(f => f(next))
  return next
}

/** Deletes locally; returns an undo function that restores the project and its data. */
export async function deleteProject(id: string): Promise<() => Promise<void>> {
  const p = getProject(id)
  const data = await idbGet<Dataset>('data', id)
  projects = projects.filter(x => x.id !== id)
  emit()
  await idbDel('projects', id)
  await idbDel('data', id)
  addTombstone(id)
  return async () => {
    if (!p) return
    removeTombstone(id)
    if (data) await idbPut('data', data, id)
    await saveProject(p)
  }
}

export const getData = (id: string) => idbGet<Dataset>('data', id)
export const putData = (id: string, ds: Dataset) => idbPut('data', ds, id)

export const uuid = () => crypto.randomUUID()

// Tombstones keep a project deleted offline from coming back on the next sync.
const TOMB = 'cash-runway.tombstones'
export const tombstones = (): string[] => { try { return JSON.parse(localStorage.getItem(TOMB) ?? '[]') } catch { return [] } }
const addTombstone = (id: string) => localStorage.setItem(TOMB, JSON.stringify([...new Set([...tombstones(), id])]))
const removeTombstone = (id: string) => localStorage.setItem(TOMB, JSON.stringify(tombstones().filter(x => x !== id)))
export const clearTombstones = (ids: string[]) => localStorage.setItem(TOMB, JSON.stringify(tombstones().filter(x => !ids.includes(x))))

// ---------- App preferences (settings page) ----------

export interface Prefs {
  /** Sync imported bank lines and aging rows (under the size cap). Off = only settings, scenarios and weekly totals sync. */
  syncRaw: boolean
  settings: Settings
  sender: Project['sender']
}
const PREF_KEY = 'cash-runway.prefs'
const DEFAULT_PREFS: Prefs = { syncRaw: true, settings: { ...DEFAULT_SETTINGS }, sender: { name: '', company: '' } }
let prefs: Prefs | null = null
const prefSubs = new Set<() => void>()
export function getPrefs(): Prefs {
  if (prefs) return prefs
  try {
    const raw = JSON.parse(localStorage.getItem(PREF_KEY) ?? '{}')
    prefs = { ...DEFAULT_PREFS, ...raw, settings: { ...DEFAULT_SETTINGS, ...raw.settings }, sender: { ...DEFAULT_PREFS.sender, ...raw.sender } }
  } catch { prefs = DEFAULT_PREFS }
  return prefs!
}
export function setPrefs(p: Partial<Prefs>) {
  prefs = { ...getPrefs(), ...p }
  localStorage.setItem(PREF_KEY, JSON.stringify(prefs))
  prefSubs.forEach(f => f())
}
export const usePrefs = () => useSyncExternalStore(f => { prefSubs.add(f); return () => prefSubs.delete(f) }, getPrefs)

export function blankProject(name: string): Project {
  const p = getPrefs(), now = Date.now()
  return { id: uuid(), name, createdAt: now, updatedAt: now, settings: { ...p.settings }, overrides: structuredClone(EMPTY_OVERRIDES), scenarios: [], snapshots: [], imports: [], sender: { ...p.sender } }
}
