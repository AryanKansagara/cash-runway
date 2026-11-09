import { useEffect, useMemo, useState } from 'react'
import { addDays } from './engine/dates.ts'
import { buildInputs, forecast, makeSnapshot, type Forecast, type Inputs } from './engine/forecast.ts'
import { SAMPLES, datasetAt, generate } from './engine/sample.ts'
import { EMPTY_DATASET, EMPTY_OVERRIDES, type Dataset } from './engine/types.ts'
import { blankProject, getData, getProjects, saveProject, useProjects, uuid, type Project } from './store.ts'
import { setCurrency } from './ui.tsx'

const yesterday = () => addDays(new Date().toISOString().slice(0, 10), -1)

const rawCache = new Map<string, ReturnType<typeof generate>>()
function raw(id: string, asOf: string) {
  const k = `${id}@${asOf}`
  if (!rawCache.has(k)) rawCache.set(k, generate(SAMPLES.find(s => s.id === id)!, asOf))
  return rawCache.get(k)!
}

export function sampleDataset(id: string, asOf: string): Dataset | null {
  return SAMPLES.some(s => s.id === id) ? datasetAt(raw(id, asOf), asOf) : null
}

export async function createSampleProject(sampleId: string): Promise<Project> {
  const existing = getProjects().find(p => p.sampleId === sampleId)
  if (existing) return existing
  const def = SAMPLES.find(s => s.id === sampleId)!
  const asOf = yesterday()
  const base = blankProject(def.name)
  const settings = { ...base.settings, ...def.settings }
  // Four weekly forecasts saved in the past, so the accuracy loop has something real to score.
  const snapshots = [28, 21, 14, 7].map(n => {
    const d = addDays(asOf, -n)
    const f = forecast(buildInputs(datasetAt(raw(sampleId, asOf), d), settings, EMPTY_OVERRIDES, d), settings)
    return { ...makeSnapshot(f, uuid(), `Week of ${d}`), createdAt: Date.parse(d + 'T18:00:00Z') }
  })
  const top = sampleId === 'northbeam' ? 'Halverson Health' : 'Harbor Ridge HOA'
  return saveProject({
    ...base, settings, sampleId, sampleAsOf: asOf, snapshots,
    sender: { name: sampleId === 'northbeam' ? 'Dana Okafor' : 'Luis Ferreira', company: def.name },
    scenarios: [
      { id: uuid(), kind: 'late-payer', customer: top, days: 21, on: false },
      { id: uuid(), kind: 'lose-client', customer: top, fromWeek: 5, on: false },
      { id: uuid(), kind: 'hire', label: sampleId === 'northbeam' ? 'Senior designer' : 'Crew lead', salary: sampleId === 'northbeam' ? 9_500_000 : 5_800_000, burdenPct: 22, fromWeek: 3, on: false },
      { id: uuid(), kind: 'loan', amount: 5_000_000, week: 2, aprPct: 9.5, months: 24, on: false },
      { id: uuid(), kind: 'price-increase', pct: 8, fromWeek: 4, on: false },
    ],
    imports: [
      { id: uuid(), kind: 'bank', fileName: 'synthetic bank export, 24 months', format: 'Synthetic', rows: 0, skipped: 0, at: Date.now() },
      { id: uuid(), kind: 'txlist', fileName: 'synthetic invoice and payment history', format: 'Synthetic', rows: 0, skipped: 0, at: Date.now() },
      { id: uuid(), kind: 'ar', fileName: 'synthetic A/R aging detail', format: 'Synthetic', rows: 0, skipped: 0, at: Date.now() },
      { id: uuid(), kind: 'ap', fileName: 'synthetic A/P aging detail', format: 'Synthetic', rows: 0, skipped: 0, at: Date.now() },
    ],
  })
}

export async function createBlankProject(name: string): Promise<Project> {
  return saveProject(blankProject(name))
}

export function useProject(id: string) {
  const list = useProjects()
  const project = list?.find(p => p.id === id) ?? null
  const [ds, setDs] = useState<Dataset | null>(null)
  const [version, setVersion] = useState(0)
  const importsKey = project ? project.imports.map(i => i.id).join(',') : ''
  useEffect(() => {
    if (!project) return
    let live = true
    if (project.sampleId) { setDs(sampleDataset(project.sampleId, project.sampleAsOf ?? yesterday()) ?? EMPTY_DATASET); return }
    void getData(project.id).then(d => { if (live) setDs(d ?? EMPTY_DATASET) })
    return () => { live = false }
  }, [project?.id, project?.sampleId, importsKey, version])
  if (project) setCurrency(project.settings.currency)
  const update = (patch: Partial<Project>) => project && saveProject({ ...project, ...patch })
  return { loading: list === null || (project !== null && ds === null), project, ds, update, reload: () => setVersion(v => v + 1) }
}

export function useForecast(project: Project | null, ds: Dataset | null): { inputs: Inputs; f: Forecast; base: Forecast } | null {
  return useMemo(() => {
    if (!project || !ds || (!ds.txns.length && !ds.ar.length && !ds.ap.length && !ds.templates.length)) return null
    const inputs = buildInputs(ds, project.settings, project.overrides)
    return { inputs, f: forecast(inputs, project.settings, project.scenarios), base: forecast(inputs, project.settings) }
  }, [project?.settings, project?.overrides, project?.scenarios, ds])
}

export const hasData = (ds: Dataset | null) => !!ds && (ds.txns.length > 0 || ds.ar.length > 0 || ds.ap.length > 0 || ds.templates.length > 0)
