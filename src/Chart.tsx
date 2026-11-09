import { useEffect, useId, useRef, useState } from 'react'
import type { Forecast } from './engine/forecast.ts'
import { fmtDay, kmoney, money } from './ui.tsx'

export interface DragChip { id: string; label: string; week: number; amount: number; onChange(week: number): void }

/** Tweens an array of numbers so the line glides to its new shape. */
function useTween(target: number[], ms = 420) {
  const [v, setV] = useState(target)
  const from = useRef(target)
  const raf = useRef(0)
  const key = target.join(',')
  useEffect(() => {
    const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches
    const start = performance.now(), a = from.current.length === target.length ? from.current : target
    cancelAnimationFrame(raf.current)
    if (reduce) { from.current = target; setV(target); return }
    const tick = (t: number) => {
      const k = Math.min(1, (t - start) / ms), e = 1 - Math.pow(1 - k, 3)
      const cur = target.map((x, i) => a[i] + (x - a[i]) * e)
      from.current = cur
      setV(cur)
      if (k < 1) raf.current = requestAnimationFrame(tick)
    }
    raf.current = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf.current)
  }, [key])
  return v
}

function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null)
  const [w, setW] = useState(800)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const ro = new ResizeObserver(([e]) => setW(Math.max(280, e.contentRect.width)))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  return [ref, w] as const
}

const niceStep = (span: number) => {
  const raw = span / 4, p = Math.pow(10, Math.floor(Math.log10(raw))), n = raw / p
  return (n < 1.5 ? 1 : n < 3 ? 2 : n < 7 ? 5 : 10) * p
}

export function CashChart({ f, base, height = 340, chips = [], compact = false, label = '13-week cash forecast' }: { f: Forecast; base?: Forecast; height?: number; chips?: DragChip[]; compact?: boolean; label?: string }) {
  const [wrap, W] = useWidth<HTMLDivElement>()
  const gid = useId().replace(/:/g, '')
  const [hover, setHover] = useState<number | null>(null)
  const vals = useTween([f.start, ...f.weeks.map(w => w.close)])
  const baseVals = base ? [base.start, ...base.weeks.map(w => w.close)] : null
  const chipH = chips.length ? 46 : 0
  const pad = { l: compact ? 44 : 60, r: compact ? 12 : 20, t: 26, b: 34 + chipH }
  const H = height
  const all = [...vals, ...(baseVals ?? []), f.minCash]
  let lo = Math.min(...all), hi = Math.max(...all)
  const span = hi - lo || 1
  lo -= span * 0.08; hi += span * 0.1
  const step = niceStep(hi - lo)
  lo = Math.floor(lo / step) * step; hi = Math.ceil(hi / step) * step
  const iw = W - pad.l - pad.r, ih = H - pad.t - pad.b
  const x = (i: number) => pad.l + (i / 13) * iw
  const y = (v: number) => pad.t + (1 - (v - lo) / (hi - lo)) * ih
  const path = (vs: number[]) => vs.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join('')
  const line = path(vals)
  const area = `${line}L${x(13)},${y(lo)}L${x(0)},${y(lo)}Z`
  const ticks: number[] = []
  for (let v = lo; v <= hi + 1; v += step) ticks.push(v)
  const lowI = vals.reduce((m, v, i) => v < vals[m] ? i : m, 0)
  const maxFlow = Math.max(1, ...f.weeks.map(w => Math.max(w.inflow, w.outflow)))
  const barH = ih * 0.22
  const bw = Math.max(3, iw / 13 * 0.16)
  const yMin = y(f.minCash)

  const dragging = useRef<DragChip | null>(null)
  const svgRef = useRef<SVGSVGElement>(null)
  const weekAt = (clientX: number) => {
    const r = svgRef.current!.getBoundingClientRect()
    return Math.min(13, Math.max(1, Math.round(((clientX - r.left) - pad.l) / iw * 13 + 0.5)))
  }

  return (
    <div className="chart" ref={wrap}>
      <svg ref={svgRef} width={W} height={H} role="img" aria-label={`${label}. Starts at ${money(f.start, { cents: false })}, lowest ${money(f.low.amount, { cents: false })}${f.low.week ? ` in week ${f.low.week}` : ' today'}, ends at ${money(f.end, { cents: false })}.`}
        onPointerMove={e => {
          if (dragging.current) { const wk = weekAt(e.clientX); if (wk !== dragging.current.week) dragging.current.onChange(wk); return }
          const r = svgRef.current!.getBoundingClientRect()
          const i = Math.round(((e.clientX - r.left) - pad.l) / iw * 13)
          setHover(i >= 0 && i <= 13 ? i : null)
        }}
        onPointerLeave={() => setHover(null)}
        onPointerUp={() => { dragging.current = null }}>
        <defs>
          <linearGradient id={`a${gid}`} x1="0" x2="0" y1="0" y2="1">
            <stop offset="0" stopColor="var(--chart-line)" stopOpacity=".22" />
            <stop offset="1" stopColor="var(--chart-line)" stopOpacity="0" />
          </linearGradient>
          <clipPath id={`c${gid}`}><rect x={pad.l} y={yMin} width={iw} height={Math.max(0, H - pad.b - yMin)} /></clipPath>
        </defs>
        {ticks.map(t => (
          <g key={t}>
            <line x1={pad.l} x2={W - pad.r} y1={y(t)} y2={y(t)} className={t === 0 ? 'grid zero' : 'grid'} />
            <text x={pad.l - 8} y={y(t) + 4} className="tick" textAnchor="end">{kmoney(t)}</text>
          </g>
        ))}
        {!compact && f.weeks.map(w => (
          <g key={w.i} className="flows" aria-hidden="true">
            <rect x={x(w.i - 0.5) - bw - 1} y={H - pad.b - (w.inflow / maxFlow) * barH} width={bw} height={(w.inflow / maxFlow) * barH} className="bar-in" rx="1.5" />
            <rect x={x(w.i - 0.5) + 1} y={H - pad.b - (w.outflow / maxFlow) * barH} width={bw} height={(w.outflow / maxFlow) * barH} className="bar-out" rx="1.5" />
          </g>
        ))}
        <path d={area} fill={`url(#a${gid})`} />
        <path d={area} className="danger-fill" clipPath={`url(#c${gid})`} />
        <line x1={pad.l} x2={W - pad.r} y1={yMin} y2={yMin} className="min-line" />
        <text x={pad.l + 6} y={yMin - 6} className="min-label">Minimum cash {kmoney(f.minCash)}</text>
        {baseVals && <path d={path(baseVals)} className="ghost-line" />}
        <path d={line} className="cash-line" />
        {f.weeks.map(w => <circle key={w.i} cx={x(w.i)} cy={y(vals[w.i])} r={hover === w.i ? 5 : 2.6} className={`dot${vals[w.i] < f.minCash ? ' under' : ''}`} />)}
        <g className="low-mark" transform={`translate(${x(lowI)},${y(vals[lowI])})`}>
          <circle r="7" />
          <text y={vals[lowI] - lo < (hi - lo) * 0.2 ? -14 : 22} textAnchor={lowI > 10 ? 'end' : lowI < 2 ? 'start' : 'middle'}>Low {kmoney(vals[lowI])}{lowI ? ` · wk ${lowI}` : ''}</text>
        </g>
        {f.weeks.map(w => w.i % (compact || W < 640 ? 3 : 2) === 0 && <text key={w.i} x={x(w.i)} y={H - pad.b + 18} className="tick" textAnchor="middle">{fmtDay(w.end)}</text>)}
        <text x={x(0)} y={H - pad.b + 18} className="tick" textAnchor="start">Today</text>
        {hover !== null && (
          <g className="hover" pointerEvents="none">
            <line x1={x(hover)} x2={x(hover)} y1={pad.t} y2={H - pad.b} />
          </g>
        )}
        {chips.map((c, k) => {
          const cx = x(c.week), cy = H - chipH + 8 + (k % 2) * 0
          return (
            <g key={c.id} className="chip-drag" transform={`translate(${cx},${cy})`} tabIndex={0} role="slider" aria-label={`${c.label}: expected in week ${c.week}. Use arrow keys to move.`} aria-valuemin={1} aria-valuemax={13} aria-valuenow={c.week}
              onPointerDown={e => { (e.target as Element).setPointerCapture?.(e.pointerId); dragging.current = c }}
              onPointerMove={e => { if (dragging.current?.id === c.id) { const wk = weekAt(e.clientX); if (wk !== c.week) c.onChange(wk) } }}
              onPointerUp={() => { dragging.current = null }}
              onKeyDown={e => { if (e.key === 'ArrowRight' && c.week < 13) { e.preventDefault(); c.onChange(c.week + 1) } if (e.key === 'ArrowLeft' && c.week > 1) { e.preventDefault(); c.onChange(c.week - 1) } }}>
              <line y1={-(H - chipH + 8 - y(vals[c.week]))} y2={-4} className="chip-stem" />
              <rect x={-58} y={0} width={116} height={30} rx={15} />
              <text y={19.5} textAnchor="middle">⇠ {c.label} {kmoney(c.amount)} ⇢</text>
            </g>
          )
        })}
      </svg>
      {hover !== null && (() => {
        const w = hover === 0 ? null : f.weeks[hover - 1]
        const left = Math.min(W - 200, Math.max(0, x(hover) + 12))
        return (
          <div className="chart-tip" style={{ left, top: 8 }}>
            {w ? <>
              <b>Week {w.i} · {fmtDay(w.start)}–{fmtDay(w.end)}</b>
              <div><span>In</span><span className="pos">{money(w.inflow, { cents: false })}</span></div>
              <div><span>Out</span><span className="neg">{money(-w.outflow, { cents: false })}</span></div>
              <div className="tip-total"><span>Closing</span><span>{money(w.close, { cents: false })}</span></div>
            </> : <><b>Today</b><div className="tip-total"><span>Opening</span><span>{money(f.start, { cents: false })}</span></div></>}
          </div>
        )
      })()}
    </div>
  )
}

/** Tiny sparkline for cards and the history list. */
export function Spark({ values, min, w = 120, h = 34 }: { values: number[]; min?: number; w?: number; h?: number }) {
  if (values.length < 2) return null
  const all = min !== undefined ? [...values, min] : values
  const lo = Math.min(...all), hi = Math.max(...all), sp = hi - lo || 1
  const pts = values.map((v, i) => `${(i / (values.length - 1) * w).toFixed(1)},${(h - 3 - (v - lo) / sp * (h - 6)).toFixed(1)}`).join(' ')
  return (
    <svg width={w} height={h} className="spark" aria-hidden="true">
      {min !== undefined && <line x1="0" x2={w} y1={h - 3 - (min - lo) / sp * (h - 6)} y2={h - 3 - (min - lo) / sp * (h - 6)} className="min-line" />}
      <polyline points={pts} />
    </svg>
  )
}
