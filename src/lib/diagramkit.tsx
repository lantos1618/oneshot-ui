import { useLayoutEffect, useRef, useState } from 'react'
import { Icon, TOUCH, clamp, cn } from './core'
import { useFrameLoop } from './motion'

/* Shared pieces of the diagram modules (gantt, statechart, trace, network): not part of the public API. */

/** Collapse sets overflow: hidden, which would stop sticky labels inside it; clip vertically only. */
export const DG_COLLAPSE_STICKY = '!overflow-x-visible !overflow-y-clip'

export const dgSafeId = (s: string) => s.replace(/[^a-zA-Z0-9_-]/g, '')
/** Dotted canvas background used by the statecharts and the process flow. */
export const DG_DOTS = 'bg-[var(--bg)] [background-image:radial-gradient(circle,var(--line2)_1px,transparent_1.2px)] [background-size:18px_18px]'

/** Strings shared by the diagram modules. */

/**
 * Expand / collapse toggle for a group row (Gantt phases, trace spans): a chevron that turns, with a 36px touch hit area.
 * Closed, it points right.
 */
export function DgChevron({ open, label, onClick, className }: { open: boolean; label: string; onClick: () => void; className?: string }) {
  return (
    <button type="button" aria-label={`Toggle ${label}`} aria-expanded={open} onClick={onClick}
      className={cn('grid h-[18px] w-[18px] flex-none cursor-pointer place-items-center rounded-[var(--r-sm)] border-0 bg-transparent text-[var(--fg3)] transition-transform duration-200 hover:bg-[var(--muted)] hover:text-[var(--fg)]', TOUCH.hit, !open && ('-rotate-90'), className)}>
      <Icon name="chevronDown" size={11} strokeWidth={2.5} />
    </button>
  )
}

/**
 * A dot that travels a path once (motion's frame loop, positioned by a transform, no re-renders), then calls onDone.
 * The path is sampled once into a lookup table when the dot starts, so frames only write (no getPointAtLength, which
 * forced a layout per dot per frame).
 */
export function DgDot({ path, ms, ease, onDone }: { path: () => SVGPathElement | null | undefined; ms: number; ease?: 'linear' | 'inOut'; onDone?: () => void }) {
  const ref = useRef<SVGCircleElement>(null)
  const run = useRef<{ lut: Float32Array; n: number; t0: number } | null>(null)
  const [active, setActive] = useState(true)
  const put = (u: number) => {
    const r = run.current, c = ref.current; if (!r || !c) return
    const e = ease === 'inOut' ? (u < 0.5 ? 2 * u * u : 1 - (-2 * u + 2) ** 2 / 2) : u
    const f = clamp(e, 0, 1) * (r.n - 1), a = Math.min(r.n - 2, Math.floor(f)), k = f - a, L = r.lut
    c.setAttribute('transform', `translate(${(L[a * 2] + (L[a * 2 + 2] - L[a * 2]) * k).toFixed(1)},${(L[a * 2 + 1] + (L[a * 2 + 3] - L[a * 2 + 1]) * k).toFixed(1)})`)
  }
  useLayoutEffect(() => {
    const p = path()
    if (!p || !ref.current) { setActive(false); onDone?.(); return }
    const len = p.getTotalLength(), n = Math.max(2, Math.min(96, Math.ceil(len / 6))), lut = new Float32Array(n * 2)
    for (let i = 0; i < n; i++) { const q = p.getPointAtLength((len * i) / (n - 1)); lut[i * 2] = q.x; lut[i * 2 + 1] = q.y } // reads only, once
    run.current = { lut, n, t0: performance.now() }
    put(0); ref.current.setAttribute('opacity', '1')
  }, []) // eslint-disable-line react-hooks/exhaustive-deps
  useFrameLoop(active, (_, now) => { // by time, so 30 fps on touch screens moves it the same way with half the repaints
    const r = run.current; if (!r) return
    const u = Math.min(1, (now - r.t0) / ms); put(u)
    if (u >= 1) { setActive(false); onDone?.() }
  }, { coarseFps: 30 })
  return <circle ref={ref} r={5.5} fill="var(--accent)" stroke="var(--card)" strokeWidth={1.5} opacity={0} />
}

/** A point on a cubic Bézier [x0,y0,x1,y1,x2,y2,x3,y3] at t. */
export const dgBez = (p: number[], t: number) => { const u = 1 - t; return [0, 1].map(k => u * u * u * p[k] + 3 * u * u * t * p[2 + k] + 3 * u * t * t * p[4 + k] + t * t * t * p[6 + k]) }
