import { Fragment, memo, useEffect, useLayoutEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react'
import { motion, useInView, useReducedMotion } from 'motion/react'
import { AnimatedNumber, Badge, Button, Icon, RUN_STATUS, Spinner, TOUCH, cn, isTouch, onMouseLeave, surface, useWidth, type IconName, type RunStatus, type Tone, plural, fmt } from './core'
import { Collapse } from './feedback'
import { PointerTooltip, usePointerTooltip } from './overlay'
import { useFrameLoop } from './motion'
import { DG_COLLAPSE_STICKY, DG_NOW, DG_PIN, DG_ROW, DgChevron, DgTrack, DgTrackHead } from './diagramkit'
import { TAG_SR_ONLY, TagGlyph, layoutTimeTags, timeTagLook, timeTagMs, timeTagTint, useTagFocus, type TimeTag, type TimeTagKind } from './annotate'
import { TrackGrid, niceStep } from './vizkit'

/* DIAGRAMS · Trace waterfall: nested spans on one streaming timeline. */

export type TraceSpan = { id: string; parent?: string | null; name: string; meta?: string; kind: 'llm' | 'tool' | 'agent'; /** default by kind: asterisk, code, bot */ icon?: IconName; start: number; duration: number; cost?: number; tokens?: number
  /** the span failed with this message: drawn red, with the message, once it ends */ error?: string
  /** the span was stopped before it finished (its run failed or was cancelled): drawn muted, counted apart */ cancelled?: boolean }
/**
 * A recorded or live run for TraceWaterfall's `run` prop: an AgentRun from `@lyndon/ui/agentrun` (useAgentRun,
 * fromOtel, fromAiSdkResult, fromLangGraphEvents), or anything shaped like it. Times are epoch ms; a span without
 * `endMs` is still running.
 */
export type TraceRun = {
  id?: string; name?: string; startedAt: number; endedAt?: number; status: RunStatus
  spans: readonly { id: string; parentId?: string; kind: string; name: string; model?: string; startMs: number; endMs?: number; status: RunStatus; tokens?: { input: number; output: number }; costUsd?: number; error?: string }[]
  events?: readonly { id: string; kind: string; atMs: number; label: string; detail?: string }[]
}
/** A waterfall row: a span, plus whether it is still running (its bar reaches the end of the plot and is revealed up to now). */
type TraceRow = TraceSpan & { open?: boolean }
const TRACE_RUN_KIND: Record<string, TraceSpan['kind']> = { llm: 'llm', tool: 'tool', retrieval: 'tool', human: 'tool', agent: 'agent', chain: 'agent' }
const TRACE_RUN_ICON: Record<string, IconName> = { retrieval: 'search', human: 'user', chain: 'layers' }
const TRACE_RUN_ROOT = '\u0000run'
/** The latest moment a run reports (its end, or the last start, end or event seen so far). Same rule as agentrun's runLatestMs, kept here so this module never imports agents. */
function traceRunLatest(run: TraceRun): number {
  let t = run.endedAt ?? run.startedAt
  for (const s of run.spans) t = Math.max(t, s.endMs ?? s.startMs)
  for (const e of run.events ?? []) t = Math.max(t, e.atMs)
  return t
}
const TRACE_RUN_KINDS: TimeTagKind[] = [
  { kind: 'approval', label: 'Approval', icon: '✓', color: 'var(--ok)' }, { kind: 'handoff', label: 'Handoff', icon: '⇢', color: 'var(--accent)' },
  { kind: 'error', label: 'Error', icon: '!', color: 'var(--bad)' }, { kind: 'retry', label: 'Retry', icon: '↻', color: 'var(--warn)' },
  { kind: 'note', label: 'Note', icon: '•', color: 'var(--c-neutral)' },
]

/** A run's spans as waterfall rows in seconds from its start (one root: a run with several gets one of its own, named `name`). */
function traceRunRows(run: TraceRun, total: number, end: number, name: string): TraceRow[] {
  const t0 = run.startedAt, ids = new Set(run.spans.map(s => s.id)), live = run.status === 'running', latest = traceRunLatest(run)
  const roots = run.spans.filter(s => !s.parentId || !ids.has(s.parentId))
  const own = roots.length === 1 ? null : TRACE_RUN_ROOT
  const rows: TraceRow[] = run.spans.map(s => {
    const start = Math.max(0, (s.startMs - t0) / 1000), open = s.endMs == null && live
    const end = open ? total : Math.max(start, ((s.endMs ?? latest) - t0) / 1000)
    const meta = s.model && !s.name.includes(s.model.replace(/-\d{4}-?\d{2}-?\d{2}$/, '')) ? s.model : undefined
    const tokens = s.tokens ? s.tokens.input + s.tokens.output : undefined
    return { id: s.id, parent: s.parentId && ids.has(s.parentId) ? s.parentId : own, name: s.name, ...(meta ? { meta } : {}), kind: TRACE_RUN_KIND[s.kind] ?? 'agent',
      ...(TRACE_RUN_ICON[s.kind] ? { icon: TRACE_RUN_ICON[s.kind] } : {}), start, duration: Math.max(0.001, end - start),
      ...(s.costUsd != null ? { cost: s.costUsd } : {}), ...(tokens ? { tokens } : {}), ...(s.status === 'error' ? { error: s.error ?? '' } : {}), ...(s.status === 'cancelled' ? { cancelled: true } : {}), ...(open ? { open } : {}) }
  })
  if (own) rows.unshift({ id: own, parent: null, name, kind: 'agent', start: 0, duration: Math.max(0.001, live ? total : end), ...(live ? { open: true } : {}) })
  return rows
}
const TRACE_STEPS = [0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 1800, 3600]
/** A cancelled span's bar: its kind's colour, faded and hatched. */
const TRACE_CANCELLED = 'opacity-45 [background-image:repeating-linear-gradient(135deg,transparent_0_3px,color-mix(in_srgb,var(--card)_70%,transparent)_3px_5px)]'
const TRACE_BAR = {
  llm: 'bg-[color-mix(in_srgb,var(--accent)_72%,var(--card))]',
  tool: 'bg-[color-mix(in_srgb,var(--c4)_58%,var(--card))]',
  agent: 'bg-[color-mix(in_srgb,var(--fg3)_16%,var(--card))] shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--fg3)_40%,transparent)]',
} as const
const TRACE_ICON = { llm: 'text-[var(--accent)]', tool: 'text-[color-mix(in_srgb,var(--c4)_80%,var(--fg))]', agent: 'text-[var(--fg2)]' } as const
/** Spawn connector colours: thin and quiet, brighter along the hovered span's chain. */
const TRACE_WIRE = 'border-[color-mix(in_srgb,var(--fg3)_50%,transparent)]', TRACE_WIRE_ON = 'border-[color-mix(in_srgb,var(--accent)_75%,var(--fg2))]'
type TraceWire = { c: TraceSpan; part: 'stub' | 'through' | 'elbow' }
/** One waterfall line, re-rendered only when its signature (what it shows apart from the moving geometry) changes. */
const TraceLine = memo(function TraceLine({ render }: { sig: string; render: () => ReactNode }) { return <>{render()}</> }, (a, b) => a.sig === b.sig)
/**
 * A bar's reveal: the bar has the span's full width and is cut back to `w` of its `du` seconds (at least 2px, the old
 * min-width), with the bar's own rounded end. A clip-path repaints but never lays out, unlike a growing width. A
 * running agent bar (`capped`) stops 16px short with a square end: its last 16px, outline included, are the cap.
 */
const traceClip = (w: number, du: number, capped = false) => {
  const r = du > 0 ? ((1 - Math.min(1, w / du)) * 100).toFixed(3) : '0'
  return capped ? `inset(0 calc(${r}% + 16px) 0 0 round var(--r-md) 0 0 var(--r-md))` : `inset(0 min(${r}%, calc(100% - 2px)) 0 0 round var(--r-md))`
}
/** The running bar's end highlight (40px, narrower while the bar is), moved to its visible end (`px` wide) by transform. */
const traceEnd = (px: number) => { const h = Math.max(0, Math.min(40, px)); return `translateX(${(px - h).toFixed(2)}px) scaleX(${(h / 40).toFixed(3)})` }
/**
 * A running agent bar's last 16px (its fill and outline, open on the left), beside the bar (the bar's clip would cut
 * it) and moved to the visible end; while the bar is shorter than that, its own clip trims it to the bar's length.
 */
const traceCap = (px: number, size = 16) => `translateX(${(Math.max(2, px) - size).toFixed(2)}px)`
const traceCapClip = (px: number, size = 16) => { const l = Math.max(0, size - Math.max(2, px)); return l > 0 ? `inset(0 0 0 ${l.toFixed(2)}px round var(--r-md))` : 'inset(0 0 0 0 round 0 var(--r-md) var(--r-md) 0)' }
/** A running agent bar's end highlight: beside the bar like its cap, rounded at the end, trimmed to the bar's length. */
const TRACE_CAP_END = 'pointer-events-none absolute top-[13px] h-3.5 w-10 rounded-e-[var(--r-md)] bg-[linear-gradient(90deg,transparent,rgba(255,255,255,.55))]'
const TRACE_CAP = 'pointer-events-none absolute top-[13px] h-3.5 w-4 rounded-e-[var(--r-md)] border border-s-0 border-[color-mix(in_srgb,var(--fg3)_40%,transparent)] bg-[color-mix(in_srgb,var(--fg3)_16%,var(--card))]'

/**
 * Nested spans on one streaming timeline (agent runs, API requests, jobs). Plays when scrolled into view:
 * bars grow with a cursor, the stat strip rolls (duration, cost, tokens, calls, errors) and a Live badge
 * settles to the outcome (Complete, Completed with errors, or a run's Failed / Cancelled). Groups collapse.
 * Spawn connectors run from each parent bar, at the moment a child starts, down to that child's bar; hovering or
 * tapping a span highlights its chain back to the root. Hover or tap a span for its numbers. On phones the timeline
 * scrolls sideways with the span names pinned.
 * `annotations` (deploys, approvals, retries; `at` in ms from the trace start) draw as dashed rules over the time grid
 * with flags in a row of their own (reserved up front, so rows never move); flags that would overlap drop out to a dot
 * on their rule, and `annotationStyle="rug"` shows icons instead, folding crowded ones into "+N". Hover, tap or focus a
 * flag for its tooltip; the flag row is one Tab stop (←/→, Home/End, Escape).
 * `run` draws an agent run instead of `spans` + `total` (a TraceRun: an AgentRun from useAgentRun or an adapter): spans
 * become rows (agents and chains as groups, retrievals and human waits as tools), failed spans show their error, and
 * the run's events (approvals, handoffs, errors, retries) become flags. A finished run plays like a trace; a running one
 * grows live, its clock following the latest moment the run reported, with room ahead on the axis that extends as it
 * fills.
 */
export function TraceWaterfall({ spans: spansProp, total: totalProp, run, title, subtitle, speed = 1.2, annotations: annProp, annotationKinds: kindsProp, annotationStyle = 'flags', className }:
  { spans?: TraceSpan[]; total?: number
    /** an agent run to draw instead of `spans` and `total`, finished or live */
    run?: TraceRun | null
    title?: ReactNode; subtitle?: ReactNode
    speed?: number
    /** events over the run, `at` in ms from the trace start: deploys, approvals, retries */
    annotations?: TimeTag[]
    /** labels, icons and colours per annotation kind */
    annotationKinds?: TimeTagKind[]
    /** 'flags' (default): rules with labelled flags; 'rug': icons only */
    annotationStyle?: 'flags' | 'rug'
    className?: string }) {
  const reduce = useReducedMotion()
  const secs = (v: number, d = 1) => fmt.number(v, { style: 'unit', unit: 'second', unitDisplay: 'narrow', minimumFractionDigits: d, maximumFractionDigits: d })
  // The playhead advances every frame, but React renders the waterfall at most 10 times a second: the exact time lives
  // in a ref, and each frame writes only the moving geometry (bar reveals, their labels' positions, the playhead line)
  // straight into the DOM. Rendering the whole tree every frame cost a phone (4× CPU) ~40% of its main thread. None of
  // it lays out: a bar has its full width from the start and is revealed by a clip-path, its end highlight, labels and
  // the playhead move by transform.
  const clockRef = useRef(0), [, setClockTick] = useState(0), sinceRender = useRef(0)
  const setClock = (c: number) => { clockRef.current = c; setClockTick(x => x + 1) }
  const clock = clockRef.current // eslint-disable-line react-hooks/refs
  const geo = useRef(new Map<string, HTMLElement>()), written = useRef(new WeakMap<HTMLElement, Record<string, string>>()), headEl = useRef<HTMLDivElement>(null), drawFrame = useRef((c: number) => { void c })
  const geoRef = (key: string) => (el: HTMLElement | null) => { if (el) geo.current.set(key, el); else geo.current.delete(key) }
  const [playing, setPlaying] = useState(false)
  // run mode: the rows come from the run. While it runs, the clock follows the latest moment it reported (plus the time
  // since it arrived), never going back, and the axis keeps ~25% of room ahead, growing in nice steps.
  const seen = useRef<{ run: TraceRun | null; at: number; latest: number }>({ run: null, at: 0, latest: 0 })
  if (run && seen.current.run !== run) seen.current = { run, at: Date.now(), latest: traceRunLatest(run) } // eslint-disable-line react-hooks/refs
  const liveRun = !!run && run.status === 'running'
  const liveNow = () => seen.current.latest + (Date.now() - seen.current.at)
  const liveAxis = useRef({ on: false, v: 0 })
  /* eslint-disable react-hooks/refs */
  if (liveRun && !liveAxis.current.on) { liveAxis.current = { on: true, v: 0 }; clockRef.current = 0 }
  if (!liveRun) liveAxis.current.on = false
  let total = totalProp ?? 0, endAt = Infinity
  if (run) {
    const t0 = run.startedAt
    if (liveRun) {
      const el = Math.max(clockRef.current, (liveNow() - t0) / 1000), want = Math.max(4, el * 1.25, ((seen.current.latest - t0) / 1000) * 1.05), step = niceStep(want, 6, TRACE_STEPS)
      liveAxis.current.v = Math.max(liveAxis.current.v, Math.ceil(want / step) * step)
      total = liveAxis.current.v
    } else {
      // a finished run: the clock stops at its end, and the plot runs ~15% past it so the last spans' labels fit
      endAt = Math.max(0.5, ((run.endedAt ?? seen.current.latest) - t0) / 1000)
      total = endAt * 1.15
    }
  }
  /* eslint-enable react-hooks/refs */
  if (!(total > 0)) total = 1
  if (!run) endAt = total
  const spans: TraceRow[] = run ? traceRunRows(run, total, endAt, typeof title === 'string' ? title : run.name || 'Trace') : spansProp ?? []
  const runTags = useMemo<TimeTag[] | null>(() => run && !annProp ? (run.events ?? []).map(e => ({ id: e.id, at: Math.max(0, e.atMs - run.startedAt), kind: e.kind, label: e.label, ...(e.detail ? { detail: e.detail } : {}) })) : null, [run, annProp])
  const annotations = annProp ?? runTags ?? undefined
  const annotationKinds = kindsProp ?? (run ? TRACE_RUN_KINDS : undefined)
  const [closed, setClosed] = useState<Set<string>>(new Set())
  const box = useRef<HTMLDivElement>(null)
  const inView = useInView(box, { once: true, amount: 0.3 })
  const onScreen = useInView(box) // playback pauses while scrolled away and resumes on return
  const [laneRef, laneW] = useWidth<HTMLDivElement>()
  const { tip, show, hide } = usePointerTooltip()
  const [hot, setHot] = useState<string | null>(null)
  // annotations: one flag row (reserved whenever the prop is set, or a run is live or has events) and rules through every row
  const ann = annotations ?? []
  const annReserved = annProp != null || (!!run && (liveRun || ann.length > 0))
  const [annOn, setAnnOn] = useState<string | null>(null)
  const annRow = useRef<HTMLDivElement>(null)
  const annSec = (t: TimeTag) => timeTagMs(t.at) / 1000
  const annFocus = useTagFocus({ tags: ann, activeId: annOn, onActive: setAnnOn, label: 'Events', describe: t => `${t.label} at ${secs(annSec(t))}` })
  const annW = (t: TimeTag) => t.label.length * 6.2 + 26
  const annLayout = laneW > 0 && ann.length ? layoutTimeTags(ann, { x: ms => (ms / 1000 / total) * laneW, width: laneW, style: annotationStyle, maxStack: 1, size: 16, labelWidth: annW }) : null
  // a flag that only dropped out because it would run past the end flips to the left of its rule when there is room
  const annFlip = new Set<string>()
  if (annLayout?.style === 'flags') {
    let end = -Infinity
    for (const p of annLayout.points) {
      if (p.flag) { end = p.x + annW(p.tag); continue }
      if (p.x + annW(p.tag) > laneW && p.x - annW(p.tag) >= end + 2) { p.flag = true; annFlip.add(p.tag.id); end = p.x }
    }
  }
  const annTip = (t: TimeTag) => {
    const { icon, color } = timeTagLook(t, annotationKinds)
    return (
      <span className="flex items-start gap-1.5">
        <TagGlyph aria-hidden icon={icon} color={color} size={16} className="mt-px" />
        <span><b className="font-semibold">{t.label}</b> <span className="ui-num text-[var(--fg2)]">{secs(annSec(t))}</span>{t.detail && <><br /><span className="text-[var(--fg2)]">{t.detail}</span></>}</span>
      </span>
    )
  }
  // the tooltip of the lit flag sits under it (hover, tap or keyboard alike)
  useEffect(() => {
    if (!annOn) return
    const t = ann.find(a => a.id === annOn), el = annRow.current?.querySelector<HTMLElement>(`[data-ann="${CSS.escape(annOn)}"]`)
    if (!t || !el) return
    const r = el.getBoundingClientRect()
    show({ clientX: r.left + Math.min(r.width, 24) / 2, clientY: r.bottom + 50 }, annTip(t))
  }, [annOn]) // eslint-disable-line react-hooks/exhaustive-deps
  const byId = new Map(spans.map(s => [s.id, s])), children = new Map<string | null, TraceRow[]>()
  for (const s of spans) { const p = s.parent ?? null; children.set(p, [...(children.get(p) ?? []), s]) }
  const kids = (id: string | null) => children.get(id) ?? []
  const root = kids(null)[0]
  const depth = (s: TraceSpan, n = 0): number => { const p = s.parent ? byId.get(s.parent) : undefined; return p && n < 64 ? 1 + depth(p, n + 1) : 0 }
  const slowest = spans.filter(s => s.kind === 'tool' && !s.open).sort((a, b) => b.duration - a.duration)[0]
  const play = () => { if (reduce) { setClock(endAt); setPlaying(false) } else { setClock(0); setPlaying(true) } }
  useEffect(() => { if (inView && clock === 0 && !playing && !liveRun) play() }, [inView]) // eslint-disable-line react-hooks/exhaustive-deps
  // a live run that finishes stays at its end; a different finished run plays from the start
  const wasLive = useRef(liveRun), runKey = run ? run.id ?? '' : null
  useEffect(() => {
    if (liveRun) { wasLive.current = true; setPlaying(false); return }
    if (wasLive.current) { wasLive.current = false; setClock(endAt) }
  }, [liveRun]) // eslint-disable-line react-hooks/exhaustive-deps
  const firstKey = useRef(runKey)
  useEffect(() => { if (runKey === firstKey.current) return; firstKey.current = runKey; if (run && !liveRun && inView) play() }, [runKey]) // eslint-disable-line react-hooks/exhaustive-deps
  useFrameLoop(liveRun && onScreen, dt => {
    const n = Math.max(clockRef.current, (liveNow() - (run?.startedAt ?? 0)) / 1000)
    clockRef.current = n
    drawFrame.current(Math.min(n, total))
    if ((sinceRender.current += dt) >= 0.1) { sinceRender.current = 0; setClock(n) }
  }, { maxDt: 0.25, coarseFps: 30 })
  useFrameLoop(playing && onScreen && !liveRun, dt => {
    const n = Math.min(endAt, clockRef.current + dt * speed)
    clockRef.current = n
    drawFrame.current(n)
    if (n >= endAt) { setClock(endAt); setPlaying(false) } else if ((sinceRender.current += dt) >= 0.1) { sinceRender.current = 0; setClock(n) }
  }, { maxDt: 0.25, coarseFps: 30 })
  // the per-frame geometry, for the spans as rendered last (closes over the lane width)
  useLayoutEffect(() => {
    drawFrame.current = c => {
      // only what changed is written (a style write costs a parse and a restyle even when the value is the same)
      const put = (el: HTMLElement, prop: 'clipPath' | 'opacity' | 'transform' | 'left', v: string) => {
        let m = written.current.get(el); if (!m) written.current.set(el, m = {})
        if (m[prop] !== v) { m[prop] = v; el.style[prop] = v }
      }
      for (const s of spans) {
        const bar = geo.current.get(s.id + ':bar'), label = geo.current.get(s.id + ':label'), end = geo.current.get(s.id + ':end'), cap = geo.current.get(s.id + ':cap')
        if (!bar && !label) continue
        const started = c >= s.start, w = started ? Math.min(c, s.start + s.duration) - s.start : 0, op = started ? '1' : '0', px = traceX(w)
        if (bar) { put(bar, 'clipPath', traceClip(w, s.duration, !!cap)); put(bar, 'opacity', op) }
        if (end && cap) { put(end, 'transform', traceCap(px, 40)); put(end, 'clipPath', traceCapClip(px, 40)) } else if (end) put(end, 'transform', traceEnd(px))
        if (cap) { put(cap, 'transform', traceCap(px)); put(cap, 'clipPath', traceCapClip(px)) }
        if (label) { if (laneW > 0) put(label, 'transform', `translateX(${px.toFixed(2)}px)`); else put(label, 'left', `calc(${pct(s.start + w)} + 10px)`); put(label, 'opacity', op) }
      }
      if (headEl.current && laneW > 0) put(headEl.current, 'transform', `translateX(${traceX(Math.min(c, total)).toFixed(2)}px)`)
    }
  })

  // what each span shows at the current clock, computed once for the stats, its row and the row's memo signature
  const view = new Map(spans.map(s => {
    const started = clock >= s.start, end = s.start + s.duration, fin = clock >= end, w = started ? Math.min(clock, end) - s.start : 0
    const frac = started ? Math.min(1, w / s.duration) : 0
    const failed = s.error != null && !s.open && fin, cancelled = !!s.cancelled && fin
    const label = failed || !started ? '' : `${secs(fin ? s.duration : w, s.duration >= 10 && fin ? 0 : 1)}${s.cost ? ` · ${fmt.usd(s.cost * (fin ? 1 : frac))}` : ''}`
    return [s.id, { started, fin, failed, cancelled, w, frac, label }]
  }))
  const vm = (s: TraceSpan) => view.get(s.id)!
  let cost = 0, tok = 0, llm = 0, tool = 0, errs = 0, stopped = 0
  for (const s of spans) {
    const v = vm(s)
    if (v.failed) errs++
    if (v.cancelled) stopped++
    if (s.kind === 'agent') continue
    cost += (s.cost ?? 0) * v.frac; tok += (s.tokens ?? 0) * v.frac; if (v.started) { if (s.kind === 'llm') llm++; else tool++ }
  }
  const done = !liveRun && clock >= endAt
  if (done && root?.cost) cost = root.cost
  // the stat strip rolls once per second (and settles at the end)
  const sec = Math.floor(Math.min(clock, endAt)), statSec = useRef(-1), stats = useRef({ dur: 0, cost: 0, tok: 0, llm: 0, tool: 0, errs: 0, stopped: 0 })
  if (sec !== statSec.current || done) { statSec.current = sec; stats.current = { dur: Math.round(Math.min(endAt, clock)), cost, tok, llm, tool, errs, stopped } }
  const S = stats.current
  const pct = (t: number) => `${(t / total) * 100}%`
  /** Seconds → px along the lane (bar reveals, labels and the playhead, in the first render and every frame alike). */
  const traceX = (t: number) => laneW * t / total
  const tickStep = niceStep(total, 6, TRACE_STEPS)
  const ticks = Array.from({ length: Math.floor(total / tickStep + 1e-9) + 1 }, (_, i) => Math.round(i * tickStep * 10) / 10)

  // spawn connectors, drawn row by row so they follow Collapse, scrolling and streaming for free: the parent row
  // holds a stub down from its bar, rows in between a pass-through, the child row an elbow into its bar. Rows are
  // ordered over the whole tree (collapsed ones too: Collapse clips their pieces while it animates).
  const wires = new Map<string, TraceWire[]>()
  {
    const flat: TraceSpan[] = [], walk = (s: TraceSpan) => { flat.push(s); kids(s.id).forEach(walk) }
    if (root) walk(root)
    const at = new Map(flat.map((s, i) => [s.id, i])), add = (i: number, w: TraceWire) => { const id = flat[i].id; wires.set(id, [...(wires.get(id) ?? []), w]) }
    flat.forEach((c, ic) => {
      const ip = c.parent ? at.get(c.parent) : undefined
      if (ip === undefined || clock < c.start) return
      add(ip, { c, part: 'stub' }); for (let i = ip + 1; i < ic; i++) add(i, { c, part: 'through' }); add(ic, { c, part: 'elbow' })
    })
  }
  const lit = tip ? hot : null, chain = new Set<string>()
  for (let id = lit; id && !chain.has(id); id = byId.get(id)?.parent ?? null) chain.add(id)

  const row = (s: TraceRow): ReactNode => {
    const d = depth(s), ch = kids(s.id), isOpen = !closed.has(s.id)
    const { started, fin, failed, cancelled, w, frac, label } = vm(s), du = s.duration, end = s.start + du
    const failMsg = s.error ?? ''
    const live = started && !fin, capped = live && s.kind === 'agent'
    // the line re-renders only when what it shows changes (the 10 Hz refresh mostly touches the running spans' labels),
    // so its tooltip reads the clock when it opens
    const myWires = wires.get(s.id) ?? []
    const sig = [started, fin, failed, cancelled, isOpen, label, laneW, d, ch.length, total, du, s.name, s.meta, failMsg, myWires.map(x => `${x.c.id}${x.part}${chain.has(x.c.id)}`).join(), s === slowest, reduce].join('|')
    const traceTip = (ev: ReactPointerEvent) => { const clock = clockRef.current, started = clock >= s.start, fin = clock >= end; setHot(s.id); if (!started) return hide(); const elapsed = secs(Math.min(clock, end) - s.start); show(ev, <><b className="font-semibold">{s.name}</b> <span className="text-[var(--fg3)]">{s.meta}</span><br /><span className="text-[var(--fg2)]">{`Start ${secs(s.start)} · ${fin ? elapsed : `${elapsed} so far`}`}{s.cost ? ` · ${fmt.usd(s.cost)}` : ''}{s.tokens ? ` · ${fmt.compact(s.tokens)} tokens` : ''}</span></>) }
    return (
      <Fragment key={s.id}>
        <TraceLine sig={sig} render={() => <motion.div key={failed ? 'f' : 'n'} animate={failed && !reduce ? { x: [0, -4, 4, -2, 2, 0] } : undefined} transition={{ duration: 0.35 }}
          className={cn(DG_ROW, 'h-10', d === 0 ? 'bg-[color-mix(in_srgb,var(--muted)_55%,transparent)]' : '', failed ? 'bg-[color-mix(in_srgb,var(--bad)_7%,transparent)]' : 'hover:bg-[color-mix(in_srgb,var(--muted)_70%,transparent)]')}
          onPointerDown={e => { if (isTouch(e)) traceTip(e) }} onPointerMove={e => traceTip(e)}
          onPointerLeave={onMouseLeave(hide)}>
          <div className={cn('flex min-w-0 items-center gap-2 pe-2.5 text-[13px]', DG_PIN,
            failed ? 'bg-[color-mix(in_srgb,var(--bad)_7%,var(--card))]' : d === 0 ? 'bg-[color-mix(in_srgb,var(--muted)_55%,var(--card))]' : 'bg-[var(--card)]')} style={{ paddingInlineStart: `calc(12px + ${d} * var(--ind))` }}>
            {Array.from({ length: d }, (_, i) => <span key={i} className="absolute inset-y-0 w-px bg-[var(--line)]" style={{ insetInlineStart: `calc(21px + ${i} * var(--ind))` }} />)}
            {ch.length ? <DgChevron open={isOpen} label={s.name} onClick={() => setClosed(c => { const n = new Set(c); if (n.has(s.id)) n.delete(s.id); else n.add(s.id); return n })} /> : <span className="w-[18px] flex-none" />}
            <span className={cn('grid h-6 w-6 flex-none place-items-center rounded-[var(--r-md)] border border-[var(--line)] bg-[var(--card)] max-sm:hidden', TRACE_ICON[s.kind])}><Icon name={s.icon ?? (s.kind === 'llm' ? 'asterisk' : s.kind === 'tool' ? 'code' : 'bot')} size={13} /></span>
            <span className="min-w-0 truncate"><span className={failed ? 'text-[var(--bad)]' : cancelled ? 'text-[var(--fg3)]' : 'text-[var(--fg)]'}>{s.name}</span>{s.meta && <em className="ms-1 text-[var(--fg3)] not-italic">{s.meta}</em>}</span>
            <span className="ms-auto flex flex-none">{live && s.kind !== 'agent' && <Spinner size={12} tone="accent" label={`${s.name} running`} className="motion-reduce:animate-none" />}</span>
          </div>
          <div className="relative h-full border-s border-[var(--line)]">
            {wires.get(s.id)?.map(({ c, part }) => (
              <span key={`${c.id}-${part}`} aria-hidden style={{ left: `calc(${pct(c.start)} - 6px)` }}
                className={cn('pointer-events-none absolute transition-[opacity,border-color] duration-200', chain.has(c.id) ? TRACE_WIRE_ON : TRACE_WIRE,
                  part === 'elbow' ? 'top-0 h-5 w-[7px] rounded-es-[5px] border-b border-s' : 'w-0 border-s', part === 'stub' && 'top-[27px] bottom-0', part === 'through' && 'inset-y-0', part === 'stub' && !isOpen && 'opacity-0')} />
            ))}
            <div ref={geoRef(s.id + ':bar')} className={cn('absolute top-[13px] h-3.5 min-w-0.5 overflow-hidden rounded-[var(--r-md)]', failed ? 'bg-[color-mix(in_srgb,var(--bad)_72%,var(--card))]' : TRACE_BAR[s.kind], cancelled && TRACE_CANCELLED)}
              style={{ left: pct(s.start), width: pct(du), clipPath: traceClip(w, du, capped), opacity: started ? 1 : 0 }}>
              {live && !capped && <span ref={geoRef(s.id + ':end')} className="absolute inset-y-0 left-0 w-10 origin-left bg-[linear-gradient(90deg,transparent,rgba(255,255,255,.55))]" style={{ transform: traceEnd(traceX(w)) }} />}
            </div>
            {/* a running agent bar's outlined end follows the reveal (the bar's clip cuts its own) */}
            {capped && <span ref={geoRef(s.id + ':cap')} aria-hidden className={TRACE_CAP} style={{ left: pct(s.start), transform: traceCap(traceX(w)), clipPath: traceCapClip(traceX(w)) }} />}
            {capped && <span ref={geoRef(s.id + ':end')} aria-hidden className={TRACE_CAP_END} style={{ left: pct(s.start), transform: traceCap(traceX(w), 40), clipPath: traceCapClip(traceX(w), 40) }} />}
            <div ref={geoRef(s.id + ':label')} className="absolute top-[11px] flex items-center gap-2 text-xs whitespace-nowrap text-[var(--fg2)]"
              style={laneW > 0 ? { left: `calc(${pct(s.start)} + 10px)`, transform: `translateX(${(traceX(w)).toFixed(2)}px)`, opacity: started ? 1 : 0 } : { left: `calc(${pct(s.start + w)} + 10px)`, opacity: started ? 1 : 0 }}>
              {failed ? (
                <span className="inline-flex items-center gap-1 font-medium text-[var(--bad)]"><Icon name="alertCircle" size={12} /><span>{failMsg ? `Failed after ${secs(du)} · ${failMsg}` : `Failed after ${secs(du)}`}</span></span>
              ) : started && (
                <>
                  <span>{secs(fin ? s.duration : w, s.duration >= 10 && fin ? 0 : 1)}{s.cost ? <> · <span className={fin ? 'text-[var(--fg2)]' : 'text-[var(--fg3)]'}>{fmt.usd(s.cost * (fin ? 1 : frac))}</span></> : null}</span>
                  {cancelled && <span className="text-[var(--fg3)]">{'Cancelled'}</span>}
                  {fin && s === slowest && <span className="rounded-[var(--r-sm)] bg-[var(--warn-soft)] px-1.5 py-0.5 text-[11px] font-semibold tracking-[.04em] text-[var(--warn)] uppercase">{'Slowest'}</span>}
                </>
              )}
            </div>
          </div>
        </motion.div>} />
        {ch.length > 0 && <Collapse open={isOpen} className={DG_COLLAPSE_STICKY}>{ch.map(row)}</Collapse>}
      </Fragment>
    )
  }
  // a finished run reads its own status (a failed or cancelled run is never "Complete"); spans mode has only its errors
  const outcome: RunStatus = !done ? 'running' : run?.status ?? 'ok'
  const badge: { tone: Tone; label: string } = outcome === 'running' ? (errs ? { tone: 'warn', label: `Live · ${plural(errs, 'error')}` } : { tone: 'accent', label: 'Live' })
    : outcome === 'ok' && errs ? { tone: 'bad', label: `Completed with ${plural(errs, 'error')}` } : RUN_STATUS[outcome]
  const stat = (label: string, v: ReactNode, cls?: string) => <div className="border-[var(--line)] px-4 py-3 not-first:border-s max-md:[&:nth-child(4)]:border-s-0 max-md:[&:nth-child(n+4)]:border-t"><span className="mb-1 block text-xs text-[var(--fg3)]">{label}</span><b className={cn('flex items-baseline text-[22px] font-semibold tracking-tight', cls)}>{v}</b></div>
  return (
    <div ref={box} className={cn('flex flex-col gap-3', className)}>
      <div className="flex justify-end gap-2">
        <Button size="sm" className={TOUCH.tap36} onClick={play} disabled={liveRun}>{'Replay'}</Button>
      </div>
      <div className={cn('overflow-hidden', surface.card)}>
        <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5 border-b border-[var(--line)] px-4 py-3 text-sm">
          <span className="text-[var(--accent)]">✦</span><b className="font-semibold">{title ?? (run?.name || 'Trace')}</b>{subtitle && <span className="text-[var(--fg3)]">{subtitle}</span>}
          <span className="flex-1" />
          <span className="me-1.5 flex flex-wrap items-center gap-3 text-xs text-[var(--fg2)]">
            {(['llm', 'tool', 'agent'] as const).map(k => <span key={k} className="inline-flex items-center gap-1"><i className={cn('inline-block h-2.5 w-2.5 rounded-[var(--r-sm)]', TRACE_BAR[k])} />{k}</span>)}
          </span>
          <Badge tone={badge.tone}><span className={cn('h-1.5 w-1.5 rounded-full bg-current', !done && 'animate-pulse motion-reduce:animate-none')} />{badge.label}</Badge>
        </div>
        <div className="grid grid-cols-3 border-b border-[var(--line)] md:grid-cols-6">
          {stat('Duration', <AnimatedNumber value={S.dur} format={{ style: 'unit', unit: 'second', unitDisplay: 'narrow' }} />)}
          {stat('Cost', <AnimatedNumber value={S.cost} format={{ style: 'currency', currency: 'USD', currencyDisplay: 'narrowSymbol', minimumFractionDigits: 2, maximumFractionDigits: 2 }} />)}
          {stat('Tokens', <AnimatedNumber value={Math.round(S.tok)} format={{ notation: 'compact', maximumFractionDigits: 1 }} />)}
          {stat('LLM calls', <AnimatedNumber value={S.llm} />)}
          {stat('Tool calls', <AnimatedNumber value={S.tool} />)}
          {stat(S.stopped ? `Errors · ${S.stopped} cancelled` : 'Errors', <AnimatedNumber value={S.errs} />, S.errs ? 'text-[var(--bad)]' : undefined)}
        </div>
        <DgTrack contentClassName="min-w-[560px]" className="[--dg-gutter:38%] [--ind:28px] max-sm:[--dg-gutter:168px] max-sm:[--ind:12px]">
            <DgTrackHead title={'Span'} className="h-9" laneRef={laneRef} ticks={ticks.map(t => ({ at: t / total, label: secs(t, tickStep < 1 ? 1 : 0) }))} />
            <div className="relative">
              <div aria-hidden className="pointer-events-none absolute inset-y-0 start-[var(--dg-gutter)] end-0"><TrackGrid at={ticks.slice(1).map(t => t / total)} className="opacity-70" /></div>
              {annReserved && (
                <div className={cn(DG_ROW, 'h-9 border-b border-[var(--line)]')}>
                  <div className={cn('flex items-center bg-[var(--card)] ps-3 text-xs text-[var(--fg3)]', DG_PIN)}>{'Events'}</div>
                  <div ref={annRow} {...annFocus.props} className="relative z-[2] h-full rounded-[var(--r-sm)] border-s border-[var(--line)] outline-none focus-visible:shadow-[inset_0_0_0_2px_var(--accent)]"
                    onPointerLeave={onMouseLeave(() => { setAnnOn(null); hide() })}>
                    {ann.map(t => {
                      const p = annLayout?.points.find(q => q.tag.id === t.id), { icon, color } = timeTagLook(t, annotationKinds)
                      const on = annOn === t.id, reached = clock >= annSec(t), opt = annFocus.option(t)
                      const bind = { 'data-ann': t.id, onPointerEnter: () => setAnnOn(t.id), onPointerDown: (e: ReactPointerEvent) => { if (isTouch(e)) setAnnOn(t.id) } }
                      const left = `${(annSec(t) / total) * 100}%`
                      if (!p || p.hidden) return <span key={t.id} {...opt} {...bind} style={TAG_SR_ONLY} />
                      if (annotationStyle === 'rug') return (
                        <span key={t.id} {...opt} {...bind} className="ui-target absolute top-1/2 -translate-x-1/2 -translate-y-1/2 cursor-default transition-opacity duration-200" style={{ left, opacity: reached || on ? 1 : 0.55 }}>
                          <TagGlyph aria-hidden icon={icon} color={color} size={16} active={on} more={p.more?.length} />
                        </span>
                      )
                      return p.flag ? (
                        <span key={t.id} {...opt} {...bind} className={cn('absolute top-1 flex h-5 cursor-default items-center gap-1 px-1.5 text-[11px] leading-none font-medium whitespace-nowrap text-[var(--fg)] transition-[opacity,box-shadow] duration-200',
 annFlip.has(t.id) ? 'flex-row-reverse -translate-x-full rounded-s-[var(--r-sm)] border-e-2' : 'rounded-e-[var(--r-sm)] border-s-2')}
                          style={{ left, borderColor: color, background: timeTagTint(color, on ? 30 : reached ? 16 : 7), color: reached || on ? undefined : 'var(--fg2)' }}>
                          {icon && <span aria-hidden className="text-[10px]">{icon}</span>}{t.label}
                        </span>
                      ) : (
                        <span key={t.id} {...opt} {...bind} className={cn('ui-target absolute bottom-1 h-1.5 w-1.5 -translate-x-1/2 cursor-default rounded-full transition-transform duration-150', on && 'scale-150')} style={{ left, background: color, opacity: reached || on ? 1 : 0.55 }} />
                      )
                    })}
                  </div>
                </div>
              )}
              {root && row(root)}
              {laneW > 0 && (
                <div ref={headEl} className={cn(DG_NOW, 'opacity-80')} style={{ left: 'var(--dg-gutter)', transform: `translateX(${traceX(Math.min(clock, total)).toFixed(2)}px)` }}>
                  <i className="absolute -top-1 -start-[3.5px] h-2 w-2 rounded-full bg-[var(--accent)]" />
                </div>
              )}
              {ann.length > 0 && (
                <div aria-hidden className="pointer-events-none absolute inset-0 z-[1]">
                  {ann.map(t => {
                    const on = annOn === t.id, f = annSec(t) / total
                    if (annotationStyle === 'rug' && !on) return null
                    return <span key={t.id} className={cn('absolute inset-y-0 border-s transition-opacity duration-200', on ? 'border-solid' : 'border-dashed')}
                      style={{ left: `calc(var(--dg-gutter) + (100% - var(--dg-gutter)) * ${f})`, borderColor: timeTagLook(t, annotationKinds).color, opacity: on ? 1 : clock >= annSec(t) ? 0.7 : 0.3 }} />
                  })}
                </div>
              )}
            </div>
        </DgTrack>
      </div>
      <PointerTooltip tip={tip} />
    </div>
  )
}
