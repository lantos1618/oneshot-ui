import { useEffect, useId, useLayoutEffect, useMemo, useReducer, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { AnimatePresence, motion, useInView, useReducedMotion } from 'motion/react'
import { Badge, Button, Icon, ScrollEdges, TOUCH, clamp, cn, maxOf, spring, surface, useScrollEdges, fmt } from './core'
import { SegmentedControl } from './forms'
import { play, useFrameLoop } from './motion'
import { DG_DOTS, DgDot, dgBez, dgSafeId } from './diagramkit'

/* DIAGRAMS · Statecharts: one SVG renderer (Statechart), the UML StateDiagram, and the WorkflowEngine with its live StateMachine. */

export type StatechartNode = {
  id: string
  /** state/composite: x, y is the top-left corner; initial/final/history/end: the centre */
  kind: 'state' | 'composite' | 'initial' | 'final' | 'history' | 'end'
  x: number; y: number; w?: number; h?: number
  label?: string
  /** a second line: renders the compact, left-aligned station style */
  sub?: string
  dashed?: boolean; on?: boolean; was?: boolean; count?: number
  /** bump to replay the "entered" pulse */
  pulse?: number
}
export type StatechartEdge = { id: string; d: string; label?: string; lx?: number; ly?: number; anchor?: 'start' | 'middle' | 'end'; dashed?: boolean; live?: boolean }
export type StatechartDot = { key: string; edge: string; ms: number; ease?: 'linear' | 'inOut'; onDone?: () => void }

function DgStateNode({ n, reduce, index }: { n: StatechartNode; reduce: boolean; index: number }) {
  const ref = useRef<SVGGElement>(null)
  useEffect(() => { if (n.pulse && !reduce) play(ref.current, { scale: [1, 1.06, 1] }, { duration: 0.35 }) }, [n.pulse, reduce])
  const w = n.w ?? 110, h = n.h ?? 44
  const box = 'transition-[fill,stroke] duration-250 [stroke-width:1.5]'
  let body: ReactNode = null
  if (n.kind === 'state') {
    body = (
      <>
        <rect x={n.x} y={n.y} width={w} height={h} rx={n.sub ? 10 : 12} strokeDasharray={n.dashed ? '4 3' : undefined}
          className={cn(box, n.on ? 'fill-[color-mix(in_srgb,var(--accent)_13%,var(--card))] stroke-[var(--accent)] [stroke-width:2.2]' : n.was ? 'fill-[var(--card)] stroke-[color-mix(in_srgb,var(--accent)_50%,var(--line2))]' : 'fill-[var(--card)] stroke-[var(--line2)]')} />
        {n.sub ? (
          <>
            <text x={n.x + 10} y={n.y + 19} className="fill-[var(--fg)] [font:600_12px_var(--font)]">{n.label}</text>
            <text x={n.x + 10} y={n.y + 34} className="fill-[var(--fg3)] [font:11px_var(--font)]">{n.sub}</text>
          </>
        ) : <text x={n.x + w / 2} y={n.y + h / 2} textAnchor="middle" dominantBaseline="central" className="pointer-events-none fill-[var(--fg)] [font:600_13px_var(--font)]">{n.label}</text>}
        {!!n.count && (
          <g transform={`translate(${n.x + w - 2},${n.y + 2})`}>
            <circle r={9} className="fill-[var(--accent)]" />
            <text y={3.5} textAnchor="middle" className="fill-white [font:700_10px_var(--font)]">{n.count}</text>
          </g>
        )}
      </>
    )
  } else if (n.kind === 'initial') body = <circle cx={n.x} cy={n.y} r={7} className={cn('transition-[fill] duration-250', n.on ? 'fill-[var(--accent)]' : 'fill-[var(--fg)]')} />
  else if (n.kind === 'final' || n.kind === 'end') body = (
    <>
      <circle cx={n.x} cy={n.y} r={10} className={n.kind === 'end' ? 'fill-[var(--fg)]' : 'fill-none stroke-[var(--fg)] [stroke-width:1.5]'} />
      <circle cx={n.x} cy={n.y} r={n.kind === 'end' ? 5 : 6} className={cn('transition-[fill] duration-250', n.kind === 'end' ? 'fill-[var(--bg)]' : n.on ? 'fill-[var(--accent)]' : 'fill-[var(--fg)]')} />
    </>
  )
  else if (n.kind === 'history') body = (
    <>
      <circle cx={n.x} cy={n.y} r={10} className="fill-[var(--card)] stroke-[var(--fg)] [stroke-width:1.5]" />
      <text x={n.x} y={n.y} textAnchor="middle" dominantBaseline="central" className="fill-[var(--fg)] [font:700_11px_var(--font)]">H</text>
    </>
  )
  return (
    <motion.g ref={ref} style={{ transformBox: 'fill-box', transformOrigin: 'center' }} initial={{ opacity: 0 }} whileInView={{ opacity: 1 }} viewport={{ once: true }} transition={{ duration: 0.35, delay: index * 0.03 }}>
      {body}
    </motion.g>
  )
}

/**
 * SVG statechart: composite states, states, pseudo states (initial, final, history), labelled transitions,
 * and dots that travel along a transition (each dot calls onDone when it arrives). Pure renderer: pass the
 * geometry and flags; StateDiagram and StateMachine drive it. It scales down to `minWidth` and scrolls sideways
 * below that; on phones and touch screens it stays at full size (labels stay ≥ 11px) and shows a swipe hint.
 */
export function Statechart({ width, height, nodes, edges, dots = [], label, minWidth = 760, className }:
  { width: number; height: number; nodes: StatechartNode[]; edges: StatechartEdge[]; dots?: StatechartDot[]; label: string; minWidth?: number; className?: string }) {
  const paths = useRef<Record<string, SVGPathElement | null>>({})
  const uid = dgSafeId(useId())
  const reduce = !!useReducedMotion()
  const [scrollRef, scroll] = useScrollEdges<HTMLDivElement>()
  // the diagram keeps its authored geometry in every locale (dir="ltr"), like charts; labels are the caller's text
  return (
    <div className="relative min-w-0 overflow-hidden rounded-[var(--r-lg)]">
    <div ref={scrollRef} tabIndex={scroll.left || scroll.right ? 0 : undefined} role={scroll.left || scroll.right ? 'region' : undefined} aria-label={scroll.left || scroll.right ? `${label}, scrolls sideways` : undefined}
      className={cn('overflow-x-auto overscroll-x-contain rounded-[var(--r-lg)] border border-[var(--line)] outline-none focus-visible:shadow-[0_0_0_2px_var(--accent)]', DG_DOTS, className)}>
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={label} className="block h-auto w-full max-sm:!min-w-[var(--sc-phone)] [@media(pointer:coarse)]:!min-w-[var(--sc-phone)]" style={{ minWidth, '--sc-phone': `${width}px` } as CSSProperties}>
        <defs>
          {[['n', 'var(--fg3)'], ['l', 'var(--accent)']].map(([k, c]) => (
            <marker key={k} id={`${uid}${k}`} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto">
              <path d="M1 1L9 5L1 9" fill="none" stroke={c} strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
            </marker>
          ))}
        </defs>
        {nodes.filter(n => n.kind === 'composite').map(n => (
          <g key={n.id}>
            <rect x={n.x} y={n.y} width={n.w} height={n.h} rx={16}
              className={cn('transition-[fill,stroke] duration-250 [stroke-width:1.5]', n.on ? 'fill-[color-mix(in_srgb,var(--accent)_5%,transparent)] stroke-[var(--accent)]' : 'fill-[color-mix(in_srgb,var(--muted)_45%,transparent)] stroke-[var(--line2)]')} />
            <text x={n.x + 14} y={n.y + 22} className="fill-[var(--fg2)] [font:600_12px_var(--font)]">{n.label}</text>
          </g>
        ))}
        <g>
          {edges.map(e => (
            <g key={e.id}>
              <path ref={el => { paths.current[e.id] = el }} d={e.d} fill="none" strokeDasharray={e.dashed ? '5 4' : undefined} markerEnd={`url(#${uid}${e.live ? 'l' : 'n'})`}
                className={cn('transition-[stroke,stroke-width] duration-200', e.live ? 'stroke-[var(--accent)] [stroke-width:2.2]' : 'stroke-[var(--fg3)] [stroke-width:1.4]')} />
              {e.label && <text x={e.lx} y={e.ly} textAnchor={e.anchor ?? 'middle'}
                className={cn('stroke-[var(--bg)] [font:500_11px_var(--mono)] [paint-order:stroke] [stroke-width:4px] transition-[fill]', e.live ? 'fill-[var(--accent)]' : 'fill-[var(--fg2)]')}>{e.label}</text>}
            </g>
          ))}
        </g>
        {nodes.filter(n => n.kind !== 'composite').map((n, i) => <DgStateNode key={n.id} n={n} reduce={reduce} index={i} />)}
        <g>{dots.map(d => <DgDot key={d.key} path={() => paths.current[d.edge]} ms={d.ms} ease={d.ease} onDone={d.onDone} />)}</g>
      </svg>
    </div>
    <ScrollEdges {...scroll} fade="bg" className="inset-y-px" />
    </div>
  )
}

/**
 * The state every statechart preset shares: a ref for the chart's box, whether it is on screen (`amount` of it
 * visible), reduced motion, the dots travelling its transitions, and `repaint` for engines that live outside React
 * state. `travel(edge, ms)` sends a dot along transition `edge` and resolves when it arrives (at once with reduced
 * motion); `spark(edge, ms)` sends one without waiting, keeping at most `max` in flight; `clear()` drops them all.
 * StateDiagram and StateMachine are built on it; pass `dots` to Statechart.
 */
export function useStatechart<T extends HTMLElement = HTMLDivElement>({ amount = 0.2, max = 24 }: { amount?: number; max?: number } = {}) {
  const ref = useRef<T>(null)
  const visible = useInView(ref, { amount })
  const reduce = !!useReducedMotion()
  const [dots, setDots] = useState<StatechartDot[]>([])
  const [, repaint] = useReducer((x: number) => x + 1, 0)
  const send = (edge: string, ms: number, ease: StatechartDot['ease'], done?: () => void) => {
    const key = `${edge}-${performance.now()}-${Math.random()}`
    setDots(ds => [...ds.slice(-max), { key, edge, ms, ease, onDone: () => { setDots(x => x.filter(d => d.key !== key)); done?.() } }])
  }
  const travel = (edge: string, ms: number, ease: StatechartDot['ease'] = 'inOut') => reduce ? Promise.resolve() : new Promise<void>(res => send(edge, ms, ease, res))
  const spark = (edge: string, ms: number, ease?: StatechartDot['ease']) => { if (!reduce) send(edge, ms, ease) }
  return { ref, visible, reduce, dots, travel, spark, clear: () => setDots([]), repaint }
}

function DgPlayButton({ playing, onClick, label }: { playing: boolean; onClick: () => void; label?: string }) {
  label ??= 'Auto-play'
  return (
    <Button size="icon-sm" aria-label={label} title={label} aria-pressed={playing} onClick={onClick} className={cn('!h-[30px] !w-[30px]', TOUCH.tap36)}>
      <Icon name={playing ? 'pause' : 'play'} size={13} filled />
    </Button>
  )
}
const dgSideLabel = 'text-xs text-[var(--fg3)]'

export type DiagramState = {
  label?: string
  kind?: 'initial' | 'final'
  /** [x, y, w, h] of a simple state */
  box?: [number, number, number, number]
  /** [x, y, w, h] of a composite state (its substates name it as `parent`) */
  composite?: [number, number, number, number]
  /** centre of an initial or final pseudo state */
  at?: [number, number]
  parent?: string
}
export type DiagramTransition = {
  event: string
  /** a state, or a composite to fire from any of its substates */
  from: string
  /** a state, or 'H' for the composite's history */
  to: string
  guard?: string; action?: string
  /** SVG path of the arrow */
  d: string
  /** [x, y, text, anchor] */
  label: [number, number, string, ('start' | 'middle' | 'end')?]
  /** relative likelihood during auto-play (default 1) */
  weight?: number
}

/**
 * Interactive UML state diagram. Fire the events available from the current state (buttons, or auto-play);
 * a dot walks the transition, composites light while any substate is current, and a shallow history state
 * returns to the substate you left. Shows the current state, its context and a history log. Reset restarts.
 */
export function StateDiagram({ states, transitions, initial, history, width = 940, height = 340, interval = 1600, className }:
  { states: Record<string, DiagramState>; transitions: DiagramTransition[]; initial: string
    history?: { of: string; at: [number, number]; default: string; d: string }; width?: number; height?: number; interval?: number; className?: string }) {
  const M = useRef({ cur: initial, hist: history?.default ?? '', log: [] as { k: number; ev: string; from: string; to: string; guard?: string; act?: string }[] })
  const { ref: box, visible, dots, travel, repaint: force } = useStatechart({ amount: 0.2 })
  const [live, setLive] = useState<number | null>(null)
  const [hLive, setHLive] = useState(false)
  const [pulse, setPulse] = useState(0)
  const [auto, setAuto] = useState(false)
  const busy = useRef(false)
  const { cur, hist, log } = M.current
  const within = (s: string, anc: string) => s === anc || states[s]?.parent === anc
  const nice = (s: string) => states[s]?.label ?? (states[s]?.kind === 'final' ? 'Final' : states[s]?.kind === 'initial' ? 'Start' : s)
  const available = transitions.map((t, i) => [t, i] as const).filter(([t]) => within(cur, t.from))
  const resumable = transitions.some(t => t.to === 'H' && within(cur, t.from))
  const fire = async (i: number) => {
    const t = transitions[i], m = M.current
    if (busy.current || !within(m.cur, t.from)) return
    busy.current = true
    const from = m.cur
    if (history && within(m.cur, history.of)) m.hist = m.cur // leaving or moving inside the composite: remember the substate
    setLive(i); await travel(`t${i}`, 650)
    let to = t.to
    if (to === 'H' && history) { to = m.hist; setHLive(true); if (m.hist === history.default) await travel('hdef', 350); setHLive(false) }
    setLive(null)
    m.cur = to; m.log = [{ k: performance.now(), ev: t.event, from, to, guard: t.guard, act: t.action }, ...m.log].slice(0, 12)
    busy.current = false; setPulse(p => p + 1); force()
  }
  const reset = () => { M.current = { cur: initial, hist: history?.default ?? '', log: [] }; setPulse(0); force() }
  // auto-play: one interval per (auto, visible, interval); each tick reads the latest props and fire() through a ref
  const step = useRef(() => {})
  useLayoutEffect(() => {
    step.current = () => {
      const m = M.current
      if (busy.current) return
      if (states[m.cur]?.kind === 'final') { M.current = { ...m, cur: initial, hist: history?.default ?? '' }; force(); return }
      const av = transitions.map((t, i) => [t, i] as const).filter(([t]) => within(m.cur, t.from))
      if (!av.length) return
      const w = av.map(([t]) => t.weight ?? 1)
      let r = Math.random() * w.reduce((a, b) => a + b, 0)
      fire((av.find((_, k) => (r -= w[k]) <= 0) ?? av[0])[1])
    }
  })
  useEffect(() => {
    if (!auto || !visible) return
    const id = setInterval(() => step.current(), interval)
    return () => clearInterval(id)
  }, [auto, visible, interval])

  const nodes: StatechartNode[] = []
  Object.entries(states).forEach(([id, s]) => {
    if (s.composite) nodes.push({ id, kind: 'composite', x: s.composite[0], y: s.composite[1], w: s.composite[2], h: s.composite[3], label: s.label, on: within(cur, id) })
  })
  if (history) nodes.push({ id: '__h', kind: 'history', x: history.at[0], y: history.at[1] })
  Object.entries(states).forEach(([id, s]) => {
    if (s.box) nodes.push({ id, kind: 'state', x: s.box[0], y: s.box[1], w: s.box[2], h: s.box[3], label: s.label, on: cur === id, was: resumable && hist === id, pulse: cur === id ? pulse : 0 })
    else if (s.kind && s.at) nodes.push({ id, kind: s.kind, x: s.at[0], y: s.at[1], on: cur === id })
  })
  const edges: StatechartEdge[] = [
    ...(history ? [{ id: 'hdef', d: history.d, dashed: true, live: hLive }] : []),
    ...transitions.map((t, i) => ({ id: `t${i}`, d: t.d, label: t.label[2], lx: t.label[0], ly: t.label[1], anchor: t.label[3], live: live === i })),
  ]
  const where = states[cur]?.parent ? `inside ${nice(states[cur].parent!)}` : resumable ? `history remembers ${nice(hist)}` : states[cur]?.kind === 'final' ? 'terminated · press Reset' : ''
  return (
    <div ref={box} className={cn('flex flex-col gap-3', className)}>
      <div className="flex justify-end gap-1.5">
        <DgPlayButton playing={auto} onClick={() => setAuto(a => !a)} />
        <Button size="sm" className={TOUCH.tap36} onClick={reset}>{'Reset'}</Button>
      </div>
      <div className="grid gap-4 min-[900px]:grid-cols-[minmax(0,1fr)_240px]">
        <Statechart width={width} height={height} nodes={nodes} edges={edges} dots={dots} label={'State diagram'} />
        <aside className="flex flex-col gap-4">
          <div className={cn('flex flex-col gap-0.5 p-3', surface.md)} aria-live="polite">
            <span className={dgSideLabel}>{'Current state'}</span>
            <AnimatePresence mode="popLayout" initial={false}>
              <motion.b key={cur} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} transition={spring(0.2, 0.3)} className="text-lg font-semibold tracking-tight">{nice(cur)}</motion.b>
            </AnimatePresence>
            <span className={cn(dgSideLabel, 'min-h-[17px]')}>{where}</span>
          </div>
          <div>
            <span className={dgSideLabel}>{'Events you can fire'}</span>
            <div className="mt-1.5 flex min-h-[66px] flex-wrap content-start gap-1.5 [@media(pointer:coarse)]:min-h-[78px]">
              {available.length ? available.map(([t, i]) => <Button key={i} size="sm" className={cn('font-[family-name:var(--mono)] !text-xs', TOUCH.tap36)} onClick={() => fire(i)}>{t.event}</Button>)
                : <span className={dgSideLabel}>{'No events from here'}</span>}
            </div>
          </div>
          <div>
            <span className={dgSideLabel}>{'History'}</span>
            {/* room for five entries from the start, so firing events never grows the card */}
            <div className="mt-1.5 flex h-[236px] flex-col gap-1 overflow-hidden text-xs">
              {log.length ? (
                <AnimatePresence initial={false}>
                  {log.slice(0, 5).map(x => (
                    <motion.div key={x.k} layout initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={spring(0.2, 0.3)}
                      className="flex flex-none flex-col rounded-[var(--r-md)] bg-[var(--muted)] px-2 py-1.5">
                      <b className="font-[family-name:var(--mono)] font-semibold">{x.ev}</b>
                      <span className="text-[var(--fg3)]">{`${nice(x.from)} → ${nice(x.to)}`}{x.guard ? ` · [${x.guard}]` : ''}{x.act ? ` · / ${x.act}` : ''}</span>
                    </motion.div>
                  ))}
                </AnimatePresence>
              ) : <span className={dgSideLabel}>{'Fire an event to start'}</span>}
            </div>
          </div>
        </aside>
      </div>
    </div>
  )
}

/** One run of a workflow machine. */
export type WorkflowJob = {
  id: number; type: string; name: string; data: Record<string, number | boolean>; done: boolean; rejected?: boolean; tokens: WorkflowToken[]
  /** the main token's current state ('done' once finished) */
  state: string
  /** start and end on the engine clock (seconds) */
  t0: number; t1?: number
  /** what the job has used so far: agent work is metered at WorkflowEngineOptions.meter per second */
  usage: { tokens: number; usd: number }
  /** every line it has travelled */
  lines: Set<string>
  /** what it did, in order (work, waits and moves) on the engine clock; the open one has t1 null */
  segs: WorkflowSegment[]
  /** the job whose finish emitted this job's trigger event (follow-up jobs), and when that event was queued */
  parent?: number; queuedAt?: number
}
/** A stretch of a job's timeline: an agent working, a wait (orchestrator, queue, human) or a move along a line. */
export type WorkflowSegment = { kind: 'work' | 'wait' | 'move'; label: string; line: string; t0: number; t1: number | null; /** from a forked branch */ sub: boolean }
/** Where a job is: one token per branch. While `move` is set it travels `line` from station `from` to `to`. */
export type WorkflowToken = {
  uid: number; job: WorkflowJob; state: string; parent: WorkflowToken | null; line: string
  phase: 'move' | 'work' | 'route' | 'queue' | 'hitl' | 'join'
  /** seconds left in this phase */
  t: number
  move: { from: string; to: string; dur: number } | null
  /** the latest move, kept after arrival (which way a token queued at a busy agent came in) */
  last: { from: string; to: string } | null
  next?: string; kids: number; cb?: (() => void) | null; seg: WorkflowSegment | null
}
export type WorkflowState = {
  /** [line, station]: the station name is the agent; agents work one job at a time */
  at: [string, string]
  label: string
  /** seconds of agent work */
  work?: number
  /** orchestrators route instantly */
  orch?: boolean
  /** waits for a human (approved by policy after `hitlWait` seconds, or resolve() it) */
  hitl?: boolean
  /** next state, a guard function, 'back' (a forked branch returning) or 'done' */
  next?: string | ((job: WorkflowJob) => string)
  /** fork into these branch states, then continue at `join` once all are back */
  fork?: string[]; join?: string
  /** decision name and its labelled outcomes (for the chart) */
  guard?: string; to?: [string, string][]
}
export type WorkflowMachine = {
  name: string; short?: string; event: string; start: string; states: Record<string, WorkflowState>
  /** follow-up event queued when a job finishes */
  emits?: (job: WorkflowJob) => string | null
  init?: (seq: number) => Record<string, number | boolean>
  title?: (job: WorkflowJob) => string
}
/** A queued trigger event; `from` is the line it came from (for colour), `t` when it was queued, `parent` the job that emitted it. */
export type WorkflowQueued = { id: number; ev: string; from: string; t: number; parent?: number }
export type WorkflowEvent =
  | { kind: 'spawn' | 'enter' | 'move' | 'guard' | 'join' | 'done' | 'trigger' | 'hitl' | 'hitl-done'; job: WorkflowJob; token: WorkflowToken; state: string; to?: string; guard?: string; result?: string; ev?: string }
  /** an event joined the queue: fired by hand, by the lap timer, by the intake timer, or emitted by a finished job */
  | { kind: 'queued'; job?: undefined; ev: string; from: string; cause: 'fire' | 'lap' | 'intake' | 'emit' }
export type WorkflowEngineOptions = {
  /** jobs that may run at once (default 3) */
  maxJobs?: number
  /** simulation speed: tick(dt) advances the clock by dt × speed (default 1) */
  speed?: number
  /** fire the next machine in `order` after lap[0] seconds, then every lap[1] (default [1.2, 7]; lap[1] = 0 turns it off) */
  lap?: [number, number]
  /** a trigger event that also arrives on its own every 9–15 s, first after 6 s (default 'request.received'; null turns it off) */
  intake?: string | null
  /** seconds a human-in-the-loop state waits before it is approved by policy (default 4) */
  hitlWait?: number
  /** seconds a token takes along `line` from station `from` to `to` (default 1) */
  travelTime?: (line: string, from: string, to: string) => number
  /** usage metered per second of agent work (default none) */
  meter?: { tokens: number; usd: number }
  /** the line a fired machine's event is drawn from (default its start state's line) */
  source?: (type: string) => string
  /** queue length; the oldest event is dropped beyond it (default 8) */
  queueMax?: number
}

/**
 * Token-based workflow engine. Events queue until a job slot frees up; each job walks its machine's states,
 * agents (stations with `work`) hold one token at a time and tokens that arrive while one is busy wait in that
 * station's `queues` list (first come, first served), guards pick the next state, forks split into
 * branch tokens that join back, and human-in-the-loop states wait in `waiting` until resolve() or a timeout.
 * Every job keeps a segment timeline and usage meters. Drive it with tick(seconds) (from useFrameLoop);
 * subscribe() to every transition. StateMachine and AgentTransitMap both run on it.
 */
export class WorkflowEngine {
  machines: Record<string, WorkflowMachine>; order: string[]
  jobs: WorkflowJob[] = []; queue: WorkflowQueued[] = []; busy: Record<string, WorkflowToken> = {}
  /** tokens waiting for a human, oldest first */
  waiting: WorkflowToken[] = []
  /** tokens that reached a busy agent and wait to enter it, by station, oldest first */
  queues: Record<string, WorkflowToken[]> = {}
  maxJobs: number; speed: number; paused = false; hitl = true; hitlWait: number; queueMax: number
  /** simulated seconds since the engine started (stops while paused) */
  clock = 0
  /** events dropped because the queue was full */
  dropped = 0
  lap: [number, number]; intake: string | null
  private seq = 0; private uid = 0; private evIdx = 0; private lapT: number; private intakeT = 6
  private travelTime: (line: string, from: string, to: string) => number
  private meter: { tokens: number; usd: number }; private source: (type: string) => string
  private subs = new Set<(e: WorkflowEvent) => void>()
  constructor(machines: Record<string, WorkflowMachine>, order: string[], o: WorkflowEngineOptions = {}) {
    this.machines = machines; this.order = order
    this.maxJobs = o.maxJobs ?? 3; this.speed = o.speed ?? 1; this.hitlWait = o.hitlWait ?? 4; this.queueMax = o.queueMax ?? 8
    this.lap = o.lap ?? [1.2, 7]; this.lapT = this.lap[0]; this.intake = o.intake === undefined ? 'request.received' : o.intake
    this.travelTime = o.travelTime ?? (() => 1); this.meter = o.meter ?? { tokens: 0, usd: 0 }
    this.source = o.source ?? (t => { const m = this.machines[t]; return m.states[m.start].at[0] })
  }
  subscribe(f: (e: WorkflowEvent) => void) { this.subs.add(f); return () => { this.subs.delete(f) } }
  private emit(e: WorkflowEvent) { this.subs.forEach(f => f(e)) }
  /** The machine whose trigger is `ev`. */
  typeOf(ev: string) { return Object.keys(this.machines).find(k => this.machines[k].event === ev) }
  /** How far a moving token is along its move, 0…1 (1 when it isn't moving). */
  progress(tk: WorkflowToken) { return tk.move && tk.move.dur > 0 ? clamp(1 - tk.t / tk.move.dur, 0, 1) : 1 }
  /** Tokens on each travelled edge right now, keyed `line|from|to`: moving along it, or queued at a busy agent at its end. */
  occupancy() {
    const o: Record<string, number> = {}
    for (const j of this.jobs) if (!j.done) for (const tk of j.tokens) {
      const m = tk.move ?? (tk.phase === 'queue' ? tk.last : null)
      if (m) { const k = `${tk.line}|${m.from}|${m.to}`; o[k] = (o[k] ?? 0) + 1 }
    }
    return o
  }
  private enqueue(ev: string, from: string, cause: 'fire' | 'lap' | 'intake' | 'emit', parent?: number) {
    if (this.queue.length >= this.queueMax) { this.queue.shift(); this.dropped++ }
    this.queue.push({ id: ++this.uid, ev, from, t: this.clock, parent }); this.emit({ kind: 'queued', ev, from, cause })
  }
  /** Queue the trigger event of a machine (defaults to the next one in `order`). */
  fire(type?: string, cause: 'fire' | 'lap' = 'fire') {
    const t = type ?? this.order[this.evIdx++ % this.order.length]
    if (this.machines[t]) this.enqueue(this.machines[t].event, this.source(t), cause)
  }
  private slots() { return this.maxJobs - this.jobs.filter(j => !j.done).length }
  private st(tk: WorkflowToken, s = tk.state) { return this.machines[tk.job.type].states[s] }
  private token(job: WorkflowJob, state: string, parent: WorkflowToken | null): WorkflowToken {
    return { uid: ++this.uid, job, state, parent, line: this.machines[job.type].states[state].at[0], phase: 'route', t: 0, move: null, last: null, kids: 0, seg: null }
  }
  private seg(tk: WorkflowToken, kind: WorkflowSegment['kind'], label: string) {
    const last = tk.seg
    if (last && last.kind === kind && last.label === label && last.line === tk.line) return
    if (last) last.t1 = this.clock
    tk.seg = { kind, label, line: tk.line, t0: this.clock, t1: null, sub: !!tk.parent }; tk.job.segs.push(tk.seg)
  }
  private closeSeg(tk: WorkflowToken) { if (tk.seg) { tk.seg.t1 = this.clock; tk.seg = null } }
  private spawn(type: string, q?: WorkflowQueued) {
    const m = this.machines[type], seq = ++this.seq, line = m.states[m.start].at[0]
    const job: WorkflowJob = { id: seq, type, name: m.name, data: { attempt: 0, ...m.init?.(seq) }, done: false, tokens: [], state: m.start, t0: this.clock, usage: { tokens: 0, usd: 0 }, lines: new Set([line]), segs: [], parent: q?.parent, queuedAt: q?.t }
    if (m.title) job.name = m.title(job)
    const tk = this.token(job, m.start, null)
    job.tokens.push(tk); this.jobs.unshift(job)
    this.emit({ kind: 'spawn', job, token: tk, state: m.start }); this.enter(tk, m.start)
  }
  private enter(tk: WorkflowToken, state: string) {
    const st = this.st(tk, state); tk.state = state; tk.move = null
    if (!tk.parent) tk.job.state = state
    this.emit({ kind: 'enter', job: tk.job, token: tk, state })
    if (st.hitl && this.hitl) { tk.phase = 'hitl'; tk.t = this.hitlWait; this.seg(tk, 'wait', 'Waiting for human approval'); this.waiting.push(tk); this.emit({ kind: 'hitl', job: tk.job, token: tk, state }); return }
    if (st.orch) { tk.phase = 'route'; tk.t = 0.45; this.seg(tk, 'wait', st.label); return }
    if (st.work) { tk.phase = 'work'; tk.t = st.work; this.seg(tk, 'work', st.label); return }
    tk.phase = 'route'; tk.t = 0.3; this.seg(tk, 'wait', st.label)
  }
  private free(tk: WorkflowToken) { const st = this.st(tk); if (st.work && this.busy[st.at[1]] === tk) delete this.busy[st.at[1]] }
  private travel(tk: WorkflowToken, line: string, from: string, to: string, toState: string, cb: () => void) {
    const dur = Math.max(0, this.travelTime(line, from, to))
    tk.phase = 'move'; tk.line = line; tk.t = dur; tk.move = { from, to, dur }; tk.last = { from, to }; tk.cb = cb
    this.seg(tk, 'move', `${line.charAt(0).toUpperCase()}${line.slice(1)} line`)
    this.emit({ kind: 'move', job: tk.job, token: tk, state: tk.state, to: toState })
  }
  private decide(tk: WorkflowToken) {
    const j = tk.job, st = this.st(tk)
    if (st.fork && !tk.parent) {
      tk.phase = 'join'; tk.kids = st.fork.length; this.seg(tk, 'wait', 'Waiting for reviews to join')
      st.fork.forEach(b => { const kid = this.token(j, tk.state, tk); kid.line = this.machines[j.type].states[b].at[0]; j.tokens.push(kid); this.go(kid, b) })
      return
    }
    const nx = typeof st.next === 'function' ? st.next(j) : st.next ?? 'done'
    if (nx === 'back' && tk.parent) {
      const p = tk.parent, pst = this.st(p); this.free(tk)
      this.travel(tk, tk.line, st.at[1], pst.at[1], pst.join!, () => {
        this.closeSeg(tk); j.tokens = j.tokens.filter(x => x !== tk)
        if (--p.kids === 0) { this.emit({ kind: 'join', job: j, token: p, state: p.state }); this.go(p, pst.join!) }
      })
      return
    }
    if (st.guard) this.emit({ kind: 'guard', job: j, token: tk, state: tk.state, guard: st.guard, result: nx })
    if (nx === 'done') { this.finish(tk); return }
    this.go(tk, nx)
  }
  private go(tk: WorkflowToken, state: string) {
    const st = this.st(tk, state), cur = this.st(tk); tk.next = state
    this.free(tk)
    tk.job.lines.add(st.at[0])
    this.travel(tk, st.at[0], cur.at[1], st.at[1], state, () => this.arrive(tk, state))
  }
  /** At an agent: take it if it is free and nobody is ahead, else join its queue. */
  private arrive(tk: WorkflowToken, state: string) {
    const st = this.st(tk, state), stn = st.at[1]
    if (st.work) {
      const q = (this.queues[stn] ??= [])
      if (q.length || (this.busy[stn] && this.busy[stn] !== tk)) { tk.phase = 'queue'; q.push(tk); this.seg(tk, 'wait', `Waiting for ${stn}`); return }
      this.busy[stn] = tk
    }
    this.enter(tk, state)
  }
  private finish(tk: WorkflowToken) {
    const j = tk.job; this.free(tk); this.closeSeg(tk)
    this.emit({ kind: 'move', job: j, token: tk, state: tk.state, to: 'done' })
    j.done = true; j.t1 = this.clock; j.state = 'done'
    this.emit({ kind: 'done', job: j, token: tk, state: 'done' })
    const ev = j.rejected ? null : this.machines[j.type].emits?.(j)
    if (ev) { this.emit({ kind: 'trigger', job: j, token: tk, state: 'done', ev }); this.enqueue(ev, tk.line, 'emit', j.id) }
  }
  /** Answer a token in `waiting`: approve, reject (the job ends and emits nothing) or 'timeout' (approved by policy). */
  resolve(tk: WorkflowToken, how: 'approve' | 'reject' | 'timeout') {
    const i = this.waiting.indexOf(tk); if (i < 0) return
    this.waiting.splice(i, 1)
    if (how === 'reject') { tk.job.rejected = true; this.seg(tk, 'wait', 'Rejected by a human'); this.emit({ kind: 'hitl-done', job: tk.job, token: tk, state: tk.state, result: 'rejected' }); this.finish(tk); return }
    this.seg(tk, 'work', how === 'timeout' ? 'Auto-approved by policy (timeout)' : 'Approved by a human')
    this.emit({ kind: 'hitl-done', job: tk.job, token: tk, state: tk.state, result: how === 'timeout' ? 'auto-approved' : 'approved' })
    tk.phase = 'work'; tk.t = 0.4
  }
  /** Human in the loop on or off; turning it off approves everything waiting. */
  setHitl(on: boolean) { this.hitl = on; if (!on) this.waiting.slice().forEach(tk => this.resolve(tk, 'timeout')) }
  /** Advance the simulation by `dt` seconds (× speed; nothing while paused). */
  tick(dt: number) {
    if (this.paused) return
    dt *= this.speed; this.clock += dt
    if (this.lap[1] > 0) { this.lapT -= dt; if (this.lapT <= 0) { this.lapT += this.lap[1]; this.fire(undefined, 'lap') } }
    if (this.intake) {
      this.intakeT -= dt
      const t = this.intakeT <= 0 ? this.typeOf(this.intake) : undefined
      if (this.intakeT <= 0) this.intakeT = 9 + Math.random() * 6
      if (t) this.enqueue(this.intake, this.source(t), 'intake')
    }
    while (this.queue.length && this.slots() > 0) { const q = this.queue.shift()!, t = this.typeOf(q.ev); if (t) this.spawn(t, q) }
    this.jobs.forEach(j => {
      if (j.done) return
      j.tokens.slice().forEach(tk => {
        if (tk.phase === 'move') { tk.t -= dt; if (tk.t <= 0) { const cb = tk.cb; tk.cb = null; tk.move = null; cb?.() } }
        else if (tk.phase === 'work' || tk.phase === 'route') {
          tk.t -= dt
          if (tk.phase === 'work') { j.usage.tokens += this.meter.tokens * dt; j.usage.usd += this.meter.usd * dt }
          if (tk.t <= 0) this.decide(tk)
        }
        else if (tk.phase === 'queue') {
          const stn = this.st(tk, tk.next).at[1], q = this.queues[stn]
          if (!this.busy[stn] && q?.[0] === tk) { q.shift(); this.busy[stn] = tk; this.enter(tk, tk.next!) }
        }
        else if (tk.phase === 'hitl') { tk.t -= dt; if (tk.t <= 0) this.resolve(tk, 'timeout') }
      })
    })
    while (this.jobs.length > 6 && this.jobs[this.jobs.length - 1].done) this.jobs.pop()
  }
}

const WF_H = 250
/** Columns by breadth-first depth from the start state; fork, join, guard and back edges included. */
function wfLayout(m: WorkflowMachine, minW = 900) {
  const E: { a: string; b: string; label: string; fork: boolean }[] = []
  Object.entries(m.states).forEach(([k, st]) => {
    if (st.fork) { st.fork.forEach(b => E.push({ a: k, b, label: 'fork', fork: true })); st.fork.forEach(b => E.push({ a: b, b: st.join!, label: 'join', fork: true })) }
    else if (st.to) st.to.forEach(([b, label]) => E.push({ a: k, b, label, fork: false }))
    else if (typeof st.next === 'string' && st.next !== 'back') E.push({ a: k, b: st.next, label: '', fork: false })
  })
  const depth: Record<string, number> = { [m.start]: 0 }, q = [m.start]
  while (q.length) { const k = q.shift()!; E.filter(e => e.a === k).forEach(e => { if (depth[e.b] === undefined) { depth[e.b] = depth[k] + 1; q.push(e.b) } }) }
  const cols: Record<number, string[]> = {}
  Object.entries(depth).forEach(([k, d]) => (cols[d] ??= []).push(k))
  const nCols = maxOf(Object.keys(cols).map(Number)) + 1
  const W = Math.max(minW, nCols * 150 + 40), H = WF_H, cw = (W - 40) / nCols, nw = Math.min(112, cw - 34), pos: Record<string, [number, number]> = {}
  Object.entries(cols).forEach(([d, ks]) => ks.forEach((k, i) => { pos[k] = [20 + (+d + 0.5) * cw, H / 2 + (i - (ks.length - 1) / 2) * 78] }))
  const edges: StatechartEdge[] = E.filter(e => pos[e.a] && pos[e.b]).map(e => {
    const [x1, y1] = pos[e.a], [x2, y2] = pos[e.b], back = x2 <= x1
    let P: number[]
    if (back) P = [x1, y1 + 22, x1, y1 + 92, x2, y2 + 92, x2, y2 + 22]
    else { const sx = x1 + nw / 2, ex = e.b === 'done' ? x2 - 12 : x2 - nw / 2 - 2, mx = (sx + ex) / 2; P = [sx, y1, mx, y1, mx, y2, ex, y2] }
    const [lx, ly] = dgBez(P, back ? 0.5 : P[6] - P[0] < 80 ? 0.35 : 0.62)
    return { id: `${e.a}>${e.b}`, d: `M${P[0]},${P[1]} C${P[2]},${P[3]} ${P[4]},${P[5]} ${P[6]},${P[7]}`, dashed: e.fork, label: e.label || undefined, lx, ly: ly + (back ? 14 : -6) }
  })
  return { pos, edges, W, H, nw }
}

const WF_NONE: Record<string, WorkflowMachine> = {}
/**
 * Live statechart of workflow machines, switchable with a segmented control. A shared WorkflowEngine runs
 * while the chart is on screen: lit states hold jobs (with a count), dots travel each transition as it
 * happens, guards and fork / join are labelled. Fire event queues the selected workflow's trigger; the log
 * shows the latest decisions. Pass your `machines` (the agent-team sample is `AGENT_WORKFLOWS` in
 * `@lyndon/ui/examples`); without any it shows an empty chart of the same size.
 */
export function StateMachine({ machines = WF_NONE, order, defaultValue, className }:
  { machines?: Record<string, WorkflowMachine>; order?: string[]; defaultValue?: string; className?: string }) {
  const engine = useMemo(() => new WorkflowEngine(machines, order ?? Object.keys(machines).slice(0, 3), { speed: 1.5 }), [machines, order])
  const [picked, setType] = useState(defaultValue ?? Object.keys(machines)[0] ?? '')
  const type = machines[picked] ? picked : Object.keys(machines)[0] ?? ''
  const { ref: box, visible, reduce, dots, spark, clear, repaint: force } = useStatechart({ amount: 0.15 })
  const [log, setLog] = useState<{ k: string; id: number; name: string; text: ReactNode }[]>([])
  const m = machines[type] as WorkflowMachine | undefined
  // every machine is laid out on the widest one's canvas, so switching workflows never changes the chart's height
  const minW = useMemo(() => maxOf(Object.values(machines).map(x => wfLayout(x).W), 900), [machines])
  const L = useMemo(() => m ? wfLayout(m, minW) : { pos: {}, edges: [], W: minW, H: WF_H, nw: 0 }, [m, minW])
  const repaint = useRef(0)
  useFrameLoop(visible, dt => { engine.tick(dt); if ((repaint.current += dt) > 0.4) { repaint.current = 0; force() } }, { coarseFps: 30 }) // the engine runs on time, not frames
  useEffect(() => engine.subscribe(ev => {
    if (ev.kind === 'queued') { force(); return }
    if (ev.job.type !== type) { if (ev.kind === 'enter' || ev.kind === 'done') force(); return }
    if (ev.kind === 'move' && ev.to) spark(`${ev.state}>${ev.to}`, 700)
    const [wait0, wait1] = 'waiting for <b>human approval</b>'.split(/<b>|<\/b>/)
    const text = ev.kind === 'hitl' ? <>{wait0}<b>{wait1}</b></> : ev.kind === 'hitl-done' ? <>{'human:'} <b>{ev.result}</b></>
      : ev.kind === 'trigger' ? <>{'emits'} <b>{ev.ev}</b> {'→ queued'}</> : ev.kind === 'guard' ? <bdi><b>{ev.guard}?</b> → {ev.result}</bdi>
      : ev.kind === 'join' ? <>{'reviews'} <b>{'joined'}</b></> : ev.kind === 'spawn' ? <><b>{machines[ev.job.type].event}</b> {'→ started'}</> : ev.kind === 'done' ? <b>{'done'}</b> : null
    if (text) setLog(l => [{ k: `${ev.job.id}-${ev.kind}-${performance.now()}`, id: ev.job.id, name: ev.job.name, text }, ...l].slice(0, 5))
    force()
  }), [engine, type, reduce, machines]) // eslint-disable-line react-hooks/exhaustive-deps -- spark and repaint only read reduce and setState
  const counts: Record<string, number> = {}
  engine.jobs.filter(j => j.type === type && !j.done).forEach(j => j.tokens.forEach(t => { const k = t.phase === 'queue' && t.next ? t.next : t.state; counts[k] = (counts[k] ?? 0) + 1 }))
  const nodes: StatechartNode[] = Object.entries(L.pos).map(([k, [x, y]]) => {
    if (k === 'done') return { id: k, kind: 'end', x, y }
    const st = m!.states[k]
    const secs = fmt.number(st.work ?? 0, { style: 'unit', unit: 'second', unitDisplay: 'narrow' })
    const sub = st.hitl ? 'human approval' : st.work ? (st.at[1] === 'Index' ? secs : `agent · ${secs}`) : st.orch ? (st.guard ? 'decision' : st.fork ? 'fork → join' : 'orchestrator') : 'trigger'
    return { id: k, kind: 'state', x: x - L.nw / 2, y: y - 22, w: L.nw, h: 44, label: st.at[1] === 'Index' ? m!.event : st.at[1], sub, dashed: !!st.orch, on: !!counts[k], count: counts[k] }
  })
  const pick = (v: string) => { setType(v); clear(); setLog([]) }
  return (
    <div ref={box} className={cn('flex flex-col gap-3', className)}>
      <div className="flex flex-wrap items-center justify-end gap-2">
        {m && <div className="max-w-full overflow-x-auto"><SegmentedControl size="sm" value={type} onChange={pick} options={Object.entries(machines).map(([k, x]) => ({ value: k, label: x.short ?? x.name }))} /></div>}
        <Button size="sm" variant="primary" className={TOUCH.tap36} disabled={!m} onClick={() => { engine.fire(type); force() }}>{'Fire event'}</Button>
      </div>
      <Statechart key={type} width={L.W} height={L.H} nodes={nodes} edges={L.edges} dots={dots} label={m ? `${m.name} statechart` : 'Workflow statechart (no workflows)'} minWidth={900} />
      {/* fixed heights: the queue scrolls in one row and the log always holds five lines, so neither a workflow switch nor
          new events ever change the card's height */}
      <div className="flex h-[22px] items-center gap-1.5 overflow-x-auto overflow-y-hidden text-xs whitespace-nowrap text-[var(--fg3)] [scrollbar-width:none]">
        <span className="flex-none">{'Queue'}</span>
        {engine.queue.length ? engine.queue.map(q => <motion.span key={q.id} className="flex-none" initial={{ opacity: 0, scale: 0.8 }} animate={{ opacity: 1, scale: 1 }} transition={spring(0.4, 0.3)}>
          <Badge size="sm" tone={q.ev === m?.event ? 'accent' : 'neutral'} className="font-[family-name:var(--mono)]">{q.ev}</Badge></motion.span>)
          : <span className="truncate">{`empty · jobs start as soon as one of ${engine.maxJobs} slots is free`}</span>}
      </div>
      <div className="flex h-[96px] flex-col gap-0.5 overflow-hidden font-[family-name:var(--mono)] text-xs text-[var(--fg2)]" aria-live="polite">
        {log.length ? (
          <AnimatePresence initial={false}>
            {log.map(x => (
              <motion.div key={x.k} layout initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={spring(0.2, 0.3)} className="flex h-[17px] flex-none gap-2.5 truncate whitespace-nowrap [&_b]:font-semibold [&_b]:text-[var(--fg)]">
                <span className="min-w-7 text-[var(--fg3)]">#{fmt.number(x.id, { useGrouping: false })}</span><span>{x.name}</span><span>{x.text}</span>
              </motion.div>
            ))}
          </AnimatePresence>
        ) : <div className="font-[family-name:var(--font)] text-[var(--fg3)]">{m ? `Live engine. Fire an event to start a ${m.name.toLowerCase()} job, or wait for the next trigger.` : 'No workflows yet: pass `machines` to run them here.'}</div>}
      </div>
    </div>
  )
}
