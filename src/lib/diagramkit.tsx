import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode, type Ref } from 'react'
import { Icon, ScrollEdges, TOUCH, clamp, cn, setRef, svgTranslate, useScrollEdges } from './core'
import { useFrameLoop } from './motion'

/* Shared pieces of the diagram modules (gantt, statechart, trace, network): not part of the public API. */

/** Collapse sets overflow: hidden, which would stop sticky labels inside it; clip vertically only. */
export const DG_COLLAPSE_STICKY = '!overflow-x-visible !overflow-y-clip'

/**
 * Time tracks (Gantt, trace): rows are `grid-cols-[var(--dg-gutter)_1fr]`, a label cell pinned on the left and a lane
 * where time runs left to right. DG_PIN pins the label cell over the lane while the track scrolls sideways.
 */
export const DG_PIN = 'sticky left-0 z-[3] h-full shadow-[1px_0_0_var(--line)]'
export const DG_ROW = 'relative grid grid-cols-[var(--dg-gutter)_1fr] items-center'
/** The accent "now" line of a time track (today, the playhead): place it in lane coordinates. */
export const DG_NOW = 'pointer-events-none absolute top-0 bottom-0 w-[1.5px] bg-[var(--accent)]'

/**
 * The scroller of a time track: below `minWidth` the lanes scroll sideways inside it with the label gutter pinned, so
 * only the right edge fades. Set `--dg-gutter` (the label column) on it or above it.
 */
export function DgTrack({ minWidth, hint, scrollerRef, className, contentClassName, children }:
  { /** CSS length, or set it with contentClassName */ minWidth?: string; hint?: ReactNode; scrollerRef?: Ref<HTMLDivElement>; className?: string; contentClassName?: string; children: ReactNode }) {
  const [edgesRef, edges] = useScrollEdges<HTMLDivElement>()
  const ref = useCallback((el: HTMLDivElement | null) => { edgesRef(el); setRef(scrollerRef, el) }, [edgesRef, scrollerRef])
  return (
    <div className="relative">
      <div ref={ref} className={cn('relative overflow-x-auto overscroll-x-contain', className)}><div className={contentClassName} style={{ minWidth }}>{children}</div></div>
      <ScrollEdges left={false} right={edges.right} touched={edges.touched} hint={hint} />
    </div>
  )
}

/**
 * A time track's header row: the gutter's title, then tick labels at `ticks` (fractions of the lane, 0…1) just right of
 * each tick; a label at the very end hugs it from the left instead of running past the lane.
 */
export function DgTrackHead({ title, ticks, laneRef, className, tickClassName }:
  { title: ReactNode; ticks: readonly { at: number; label: ReactNode }[]; laneRef?: Ref<HTMLDivElement>; className?: string; tickClassName?: string }) {
  return (
    <div className={cn('grid grid-cols-[var(--dg-gutter)_1fr] border-b border-[var(--line)] text-xs text-[var(--fg3)]', className)}>
      <div className={cn('flex items-center bg-[var(--card)] ps-3', DG_PIN)}>{title}</div>
      <div ref={laneRef} className="relative h-full border-s border-[var(--line)]">
        {ticks.map(t => <span key={t.at} className={cn('absolute top-2.5 whitespace-nowrap', t.at > 0.995 ? '-translate-x-[calc(100%+6px)]' : 'translate-x-1.5', tickClassName)} style={{ left: `${t.at * 100}%` }}>{t.label}</span>)}
      </div>
    </div>
  )
}

export const dgSafeId = (s: string) => s.replace(/[^a-zA-Z0-9_-]/g, '')
/** Dotted canvas background used by the statecharts and the process flow. */
export const DG_DOTS = 'bg-[var(--bg)] [background-image:radial-gradient(circle,var(--line2)_1px,transparent_1.2px)] [background-size:18px_18px]'

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
    c.setAttribute('transform', svgTranslate(L[a * 2] + (L[a * 2 + 2] - L[a * 2]) * k, L[a * 2 + 1] + (L[a * 2 + 3] - L[a * 2 + 1]) * k))
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

/** A dot on its way along edge `edge` (a path the diagram keeps by that key). */
export type DgDotSpec = { key: string; edge: string; ms: number; ease?: 'linear' | 'inOut'; onDone?: () => void }
/**
 * The dots in flight on a diagram, at most `max`: `send(edge, ms, ease)` adds one and resolves when it arrives, or
 * when it is dropped (pushed out by a newer one, `clear()`ed, or the diagram unmounts), so nothing awaiting a dot hangs.
 */
export function useDgDots(max = 24) {
  const [dots, setDots] = useState<DgDotSpec[]>([])
  const list = useRef<DgDotSpec[]>([]), pending = useRef(new Map<string, () => void>())
  const settle = (key: string) => { const r = pending.current.get(key); pending.current.delete(key); r?.() }
  const send = (edge: string, ms: number, ease?: DgDotSpec['ease']) => new Promise<void>(res => {
    const key = `${edge}-${performance.now()}-${Math.random()}`
    pending.current.set(key, res)
    const onDone = () => { list.current = list.current.filter(d => d.key !== key); settle(key); setDots(list.current) }
    list.current = [...list.current, { key, edge, ms, ease, onDone }]
    while (list.current.length > Math.max(1, max)) { settle(list.current[0].key); list.current = list.current.slice(1) }
    setDots(list.current)
  })
  const clear = () => { list.current.forEach(d => settle(d.key)); list.current = []; setDots([]) }
  useEffect(() => () => { const p = pending.current; p.forEach(r => r()); p.clear() }, [])
  return { dots, send, clear }
}

/**
 * Open-chevron arrowheads for diagram edges, one `<marker>` per colour: render inside `<defs>`, then point an edge at
 * `url(#${uid}${key})`. `size` is the marker's width/height in stroke units; `refX` where the tip meets the line end.
 */
export function DgArrowMarkers({ uid, colors, size = 6, refX = 8 }: { uid: string; colors: Record<string, string>; size?: number; refX?: number }) {
  return <>{Object.entries(colors).map(([k, c]) => (
    <marker key={k} id={`${uid}${k}`} viewBox="0 0 10 10" refX={refX} refY="5" markerWidth={size} markerHeight={size} orient="auto">
      <path d="M1 1L9 5L1 9" fill="none" stroke={c} strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
    </marker>
  ))}</>
}

/** The SVG path of a cubic Bézier given as [x0,y0,x1,y1,x2,y2,x3,y3] (the shape dgBez samples). */
export const dgCubicPath = (P: readonly number[]) => `M${P[0]},${P[1]} C${P[2]},${P[3]} ${P[4]},${P[5]} ${P[6]},${P[7]}`

/** An edge or node label drawn over lines: a background-coloured stroke behind the glyphs (set the fill yourself). */
export const DG_HALO_LABEL = 'stroke-[var(--bg)] [font:500_11px_var(--font)] [paint-order:stroke] [stroke-linejoin:round] [stroke-width:4px]'

/** A point on a cubic Bézier [x0,y0,x1,y1,x2,y2,x3,y3] at t. */
export const dgBez = (p: number[], t: number) => { const u = 1 - t; return [0, 1].map(k => u * u * u * p[k] + 3 * u * u * t * p[2 + k] + 3 * u * t * t * p[4 + k] + t * t * t * p[6 + k]) }
