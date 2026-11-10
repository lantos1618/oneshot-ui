import { Fragment, memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { AnimatePresence, cubicBezier, motion, useReducedMotion } from 'motion/react'
import { flushSync } from 'react-dom'
import { Badge, Button, Chip, Icon, IconButton, cn, fmt, onColorLabel, parseRgba, spring, svgN, svgTranslate, useMediaQuery, useWidth } from '../lib/core'
import { Switch } from '../lib/fields'
import { Slider } from '../lib/inputs'
import { useFrameLoop, useViewport } from '../lib/motion'
import { WorkflowEngine, type WorkflowEngineOptions, type WorkflowJob, type WorkflowMachine, type WorkflowToken } from '../lib/statechart'
import { transitMapKit } from '../lib/aiagent'

/*
 * Showcase-only: the agent-team simulation on AgentTransitMap's map. A WorkflowEngine fires events, runs jobs along the
 * lines, meters made-up tokens and cost, and waits for approvals. Moved out of the library; the map's geometry and
 * drawing come from `transitMapKit`.
 */

const {
  AT_W, AT_H, AT_LC, AT_LR, AT_HUBS, AT_ST, AT_SP, AT_SEGS, AT_TOK, AT_ROWS, AT_ROW_H, AT_JOB_DOT, AT_TRACE_GRID, AT_SVG_LAYER, AT_HTML_LAYER, AT_VIEWBOX,
  AT_LEGEND_ORCH, AT_LEGEND_WAIT, AT_LINE_IDS,
  atName, atColor, atLen, atPoint, atPos, atPad, atSig, atSigs, atSigEq, atFollow, atDim, atBox, atAt, atCentred, atSegFill, atGlide,
  AtMapBase, AtHubs, AtLabelLayer, AtPulse, AtTokenGlyph, AtMapScroll, AtLegend, AtTraceFrame, AtNums, AtRowName, useAtTokenEls,
} = transitMapKit

const AT_HITL_TIMEOUT = 25, AT_QMAX = 8, AT_WIN = 30
/** map units a token covers per simulated second along a line; the Indexing-loop train is slower */
const AT_SPEED = 150, AT_LOOP_SPEED = 70
const AT_LOOP_L = atLen('index')
/** map units between tokens queued at a busy agent (the head keeps AT_HEAD from the station, clear of its ring); the first AT_QVIS line up, the rest stack on the last slot */
const AT_GAP = 24, AT_QVIS = 4, AT_HEAD = 34
/** approval cards: fixed size, stacked by transform inside an overlay on the map (nothing below them moves) */
const AT_CARD_W = 272, AT_CARD_H = 80, AT_CARD_GAP = 6, AT_CARDS = 2
/** event-queue panel in the empty corner under Intake (map units) */
const AT_EQ: [number, number] = [48, 396], AT_EQ_W = 214, AT_EQ_ROWS = 5, AT_EQ_ROW = 32
/** a token further than this from where it should be jumps there instead of gliding */
const AT_SNAP = 320

/** Heat by tokens on (or queued at the end of) a segment: 1 a faint wash, 2 warm, 3+ hot. */
const AT_HEAT: [string, number, number][] = [['var(--fg3)', 0, 8], ['var(--fg3)', 0.22, 16], ['var(--warn)', 0.45, 20], ['var(--bad)', 0.45, 25]]
/** Heat changes ease over 500 ms with the library's default transition curve. */
const AT_HEAT_MS = 500, atHeatEase = cubicBezier(0.4, 0, 0.2, 1)
type AtRgb = [number, number, number]
const atRgb = (c: string): AtRgb | null => { const v = parseRgba(c); return v ? [v[0], v[1], v[2]] : null }
type AtHeatSeg = { lv: number; on: boolean; from: number[]; cur: number[]; t0: number }
/**
 * The congestion heat's tween, driven by the map's frame loop (in step with the tokens, 30 fps on touch) instead of CSS
 * transitions. Values are [r, g, b, opacity, width]; a finished tween writes the token colour itself (var(--warn)), so
 * the heat follows a theme change while idle (blends re-read the colours at most once a second).
 */
function atHeatTween() {
  const segs: AtHeatSeg[] = AT_SEGS.map(() => ({ lv: 0, on: true, from: [], cur: [], t0: -1 }))
  const els: (SVGPathElement | null)[] = []
  let pal: (AtRgb | null)[] | null = null, palAt = -1e9
  const target = (g: AtHeatSeg, p: (AtRgb | null)[]) => { const [, o, w] = AT_HEAT[g.lv], c = p[Math.max(0, g.lv - 1)] ?? [0, 0, 0]; return [c[0], c[1], c[2], g.on ? o : o * 0.25, w] }
  const css: string[] = []
  const write = (i: number, v: number[], done: boolean) => {
    const el = els[i], g = segs[i]; if (!el) return
    const stroke = done || !pal?.[Math.max(0, g.lv - 1)] ? AT_HEAT[g.lv][0] : `rgb(${Math.round(v[0])},${Math.round(v[1])},${Math.round(v[2])})`
    const c = `stroke:${stroke};opacity:${Math.round(v[3] * 1000) / 1000};stroke-width:${svgN(v[4])}`
    if (css[i] !== c) { css[i] = c; el.style.cssText = c } // one write, and none when nothing changed
  }
  return {
    /** registers a heat path (data-i is its segment index) and paints it as it stands */
    reg: (el: SVGPathElement | null) => { if (!el) return; const i = Number(el.dataset.i); els[i] = el; const g = segs[i]; write(i, g.cur.length ? g.cur : [0, 0, 0, AT_HEAT[g.lv][1] * (g.on ? 1 : 0.25), AT_HEAT[g.lv][2]], true) },
    /** new levels (a digit per segment) and lit lines; starts tweens for what changed, or jumps there when `instant`. True if a tween started. */
    set(levels: string, lit: Set<string> | null, now: number, instant: boolean, host: Element | null) {
      if (host && (!pal || now - palAt > 1000)) { const cs = getComputedStyle(host); pal = ['--fg3', '--warn', '--bad'].map(v => atRgb(cs.getPropertyValue(v))); palAt = now }
      const p = pal ?? [null, null, null]
      let started = false
      segs.forEach((g, i) => {
        const lv = +(levels[i] ?? 0), on = !lit || lit.has(AT_SEGS[i].line)
        if (lv === g.lv && on === g.on) return
        const was = g.cur.length ? g.cur : target(g, p), blend = !!p[Math.max(0, g.lv - 1)] && !!p[Math.max(0, lv - 1)]
        g.lv = lv; g.on = on
        // a colour that can't be blended switches at once; opacity and width still ease
        g.from = [...was]; if (!blend) g.from.splice(0, 3, ...target(g, p).slice(0, 3))
        if (instant) { g.cur = target(g, p); g.t0 = -1; write(i, g.cur, true) } else { g.t0 = now; started = true }
      })
      return started
    },
    busy: () => segs.some(g => g.t0 >= 0),
    /** advances running tweens to `now`; true while any is still running */
    step(now: number) {
      if (!pal) return false
      let busy = false
      segs.forEach((g, i) => {
        if (g.t0 < 0) return
        const u = Math.min(1, (now - g.t0) / AT_HEAT_MS), e = atHeatEase(u), to = target(g, pal!)
        g.cur = u >= 1 ? to : g.from.map((a, k) => a + (to[k] - a) * e)
        if (u >= 1) g.t0 = -1; else busy = true
        write(i, g.cur, u >= 1)
      })
      return busy
    },
  }
}

/** What the simulation's engine runs with; any WorkflowEngine option can be overridden. The meter makes up token and USD figures. */
const AT_ENGINE: WorkflowEngineOptions = { speed: 1.5, maxJobs: 3, hitlWait: AT_HITL_TIMEOUT, queueMax: AT_QMAX, lap: [(AT_LOOP_L * 0.45) / AT_LOOP_SPEED, AT_LOOP_L / AT_LOOP_SPEED], meter: { tokens: 900, usd: 0.0011 } }
/** The engine behind the map: travel time follows the drawn distance; jobs that start in Memory are triggered by the Indexing loop. */
function atEngine(machines: Record<string, WorkflowMachine>, order: string[], options: WorkflowEngineOptions | undefined) {
  return new WorkflowEngine(machines, order, {
    ...AT_ENGINE,
    travelTime: (line, from, to) => { const a = atPos(line, from), b = atPos(line, to); return a === undefined || b === undefined ? 0 : Math.abs(b - a) / AT_SPEED },
    source: t => { const m = machines[t], line = m.states[m.start].at[0]; return line === 'memory' ? 'index' : line },
    ...options,
  })
}
/** Which way a token runs along its line on its latest move (+1 towards higher arc length). */
function atDirOf(tk: WorkflowToken) {
  const m = tk.move ?? tk.last; if (!m) return 1
  const a = atPos(tk.line, m.from), b = atPos(tk.line, m.to)
  return a === undefined || b === undefined ? 1 : Math.sign(b - a) || 1
}
/**
 * Where every token should be drawn, as [line, arc position]. Moving tokens follow the drawn line; tokens queued at a
 * busy agent line up on the line they came in on, oldest nearest the station; a token heading for an agent with a queue
 * stops at the back of it. With reduced motion a moving token is placed where it is going (no travel).
 */
function atLayout(eng: WorkflowEngine, agents: Set<string>, reduce: boolean) {
  // queue slots by station, then line, then direction
  const slot = new Map<number, number>(), side = new Map<string, Map<string, Map<number, number>>>()
  const sideOf = (stn: string, line: string) => { let a = side.get(stn); if (!a) side.set(stn, a = new Map()); let b = a.get(line); if (!b) a.set(line, b = new Map()); return b }
  for (const [stn, q] of Object.entries(eng.queues)) q.forEach(tk => {
    const s = sideOf(stn, tk.line), dir = atDirOf(tk), n = s.get(dir) ?? 0
    slot.set(tk.uid, n); s.set(dir, n + 1)
  })
  const out = new Map<number, [string, number]>()
  for (const j of eng.jobs) if (!j.done) for (const tk of j.tokens) {
    const m = tk.move ?? (tk.phase === 'queue' ? tk.last : null)
    if (!m) { out.set(tk.uid, [tk.line, atPos(tk.line, eng.machines[j.type].states[tk.state].at[1]) ?? 0]); continue }
    const a = atPos(tk.line, m.from) ?? 0, b = atPos(tk.line, m.to) ?? a, dir = Math.sign(b - a) || 1
    const back = (k: number) => { const s = b - dir * (AT_HEAD + AT_GAP * Math.min(k, AT_QVIS - 1)); return dir > 0 ? Math.max(s, Math.min(a + 6, b)) : Math.min(s, Math.max(a - 6, b)) }
    if (tk.phase === 'queue') { out.set(tk.uid, [tk.line, back(slot.get(tk.uid) ?? 0)]); continue }
    let s = reduce ? b : a + (b - a) * eng.progress(tk)
    const busy = agents.has(m.to) && ((eng.busy[m.to] && eng.busy[m.to] !== tk) || !!eng.queues[m.to]?.length)
    if (busy) { const lim = back(sideOf(m.to, tk.line).get(dir) ?? 0); s = dir > 0 ? Math.min(s, lim) : Math.max(s, lim) }
    out.set(tk.uid, [tk.line, s])
  }
  return out
}
/** Congestion: tokens moving along, or queued at the end of, each segment of track, as a heat level digit (0–3) per segment. */
function atHeatKey(eng: WorkflowEngine) {
  const heat = new Map<string, number>()
  for (const [k, n] of Object.entries(eng.occupancy())) {
    const [line, from, to] = k.split('|'), a = atPos(line, from), b = atPos(line, to)
    if (a === undefined || b === undefined) continue
    const lo = Math.min(a, b) - 0.5, hi = Math.max(a, b) + 0.5
    AT_SEGS.forEach(sg => { if (sg.line === line && sg.a >= lo && sg.b <= hi) heat.set(sg.key, (heat.get(sg.key) ?? 0) + n) })
  }
  return AT_SEGS.map(sg => Math.min(3, heat.get(sg.key) ?? 0)).join('')
}
const AT_NO_MACHINES: Record<string, WorkflowMachine> = {}, AT_NO_ORDER: string[] = []
type AtSpark = { id: number; x: number; y: number; text: string; t: number }
type AtFade = { id: number; x: number; y: number; line: string; jid: number; t: number; small: boolean }

// the track is a 6px band painted in the middle, so on touch the input itself can be a 32px target
const AT_RANGE = 'min-w-[90px] max-w-[200px] flex-1'
const AT_TRAIN = 28, AT_FLASH = 14
/**
 * The Indexing-loop train runs on the compositor: a box centred on the loop is turned by a looping rotate animation
 * (one lap per AT_LOOP_L / AT_LOOP_SPEED sim-seconds at speed 1, playbackRate = the engine's speed), with the train
 * at its edge facing along the track. The map's refresh keeps it in step with the engine clock.
 */
const AT_TRAIN_BOX = 2 * AT_LR + AT_TRAIN, AT_LAP_MS = (AT_LOOP_L / AT_LOOP_SPEED) * 1000
/** Where the train is at sim time `clock`, as the loop box's rotation (deg, 0 = the loop's right-hand point). */
const atTrainDeg = (clock: number) => ((((AT_LOOP_L * 0.55 + AT_LOOP_SPEED * clock) / AT_LR) * 180 / Math.PI + 180) % 360 + 360) % 360
const atRotate = (deg: number) => `rotate(${svgN(deg)}deg)`

/** The global event queue panel (waiting for a job slot), redrawn only when what it shows changes. */
const AtQueuePanel = memo(function AtQueuePanel({ queue, qlen, qmax, maxJobs, running, active, dropped, narrow }:
  { sig: string; queue: { id: number; ev: string; from: string }[]; qlen: number; qmax: number; maxJobs: number; running: number; active: number; dropped: number; narrow: boolean }) {
  return (
    <g transform={`translate(${AT_EQ[0]},${AT_EQ[1]})`} aria-label={`Event queue, ${qlen} waiting`}>
      <rect width={AT_EQ_W} height={44 + AT_EQ_ROWS * AT_EQ_ROW + 46} rx={12} fill="var(--card)" stroke="var(--line2)" />
      <text x={14} y={26} fill="var(--fg)" style={{ font: '600 15px var(--font)' }}>Event queue</text>
      <text x={AT_EQ_W - 14} y={26} textAnchor="end" fill="var(--fg3)" style={{ font: `${narrow ? 14 : 13}px var(--mono)` }}>{fmt.number(qlen)}/{fmt.number(qmax)}</text>
      <AnimatePresence initial={false}>
        {queue.map((q, i) => (
          <motion.g key={q.id} initial={{ opacity: 0, x: -10, y: 40 + i * AT_EQ_ROW }} animate={{ opacity: 1, x: 0, y: 40 + i * AT_EQ_ROW }} exit={{ opacity: 0, x: 10 }} transition={spring(0.25, 0.35)}>
            <rect x={10} width={AT_EQ_W - 20} height={26} rx={13} fill="var(--muted)" stroke={i === 0 ? 'var(--fg3)' : 'none'} />
            <circle cx={25} cy={13} r={4.5} fill={atColor(q.from)} />
            <text x={37} y={18} fill="var(--fg)" style={{ font: '14px var(--mono)' }}>{q.ev}</text>
          </motion.g>))}
      </AnimatePresence>
      {!qlen && <text x={14} y={62} fill="var(--fg3)" style={{ font: '14px var(--font)' }}>empty</text>}
      {qlen > AT_EQ_ROWS && <text x={AT_EQ_W - 14} y={40 + AT_EQ_ROWS * AT_EQ_ROW + 4} textAnchor="end" fill="var(--fg3)" style={{ font: `${narrow ? 14 : 13}px var(--font)` }}>{`+${qlen - AT_EQ_ROWS} more`}</text>}
      <g transform={`translate(14,${44 + AT_EQ_ROWS * AT_EQ_ROW + 22})`}>
        {Array.from({ length: maxJobs }, (_, i) => <circle key={i} cx={6 + i * 15} cy={0} r={5} fill={i < running ? 'var(--fg2)' : 'none'} stroke="var(--fg3)" strokeWidth={1.5} />)}
        <text x={14 + maxJobs * 15} y={5} fill="var(--fg2)" style={{ font: '14px var(--font)' }}>{`${active}/${maxJobs} jobs`}{dropped ? ` · ${dropped} dropped` : ''}</text>
      </g>
    </g>
  )
}, atSigEq)

/**
 * The map's short-lived marks (event sparks and the loop's event label), animated by the map's frame loop instead of a
 * script animation of their own at the display's full rate. Each starts when it mounts.
 */
const atEaseInOut = cubicBezier(0.42, 0, 0.58, 1)
/** Value at `u` (0–1) along evenly spaced keyframes, each step eased. */
const atKeys = (k: number[], u: number) => { const n = k.length - 1, i = Math.min(n - 1, Math.floor(u * n)), f = atEaseInOut(Math.min(1, u * n - i)); return k[i] + (k[i + 1] - k[i]) * f }
type AtMarkKind = 'ring' | 'text' | 'ev'
const AT_MARK_MS: Record<AtMarkKind, number> = { ring: 900, text: 1800, ev: 1600 }
const atOpacity = (v: number) => String(Math.round(v * 1000) / 1000)
function atMarkPaint(el: SVGElement, kind: AtMarkKind, u: number) {
  if (kind === 'ring') { const e = atEaseInOut(u); el.setAttribute('r', svgN(6 + 20 * e)); el.style.opacity = atOpacity(1 - e) }
  else if (kind === 'text') { el.style.opacity = atOpacity(atKeys([0, 1, 1, 0], u)); el.setAttribute('transform', svgTranslate(0, -10 * atEaseInOut(u))) }
  else el.style.opacity = atOpacity(atKeys([0, 1, 1, 0.35], u))
}
function atMarks() {
  const live = new Map<SVGElement, { kind: AtMarkKind; t0: number }>()
  return {
    /** registers a mark (data-mark is its kind); it starts now */
    reg: (el: SVGElement | null) => {
      if (!el) return
      const kind = el.dataset.mark as AtMarkKind
      live.set(el, { kind, t0: performance.now() }); atMarkPaint(el, kind, 0)
      return () => { live.delete(el) }
    },
    busy: () => live.size > 0,
    /** advances the marks to `now`; true while any is still running */
    step(now: number) {
      for (const [el, m] of live) { const u = Math.min(1, (now - m.t0) / AT_MARK_MS[m.kind]); atMarkPaint(el, m.kind, u); if (u >= 1) live.delete(el) }
      return live.size > 0
    },
  }
}
/** Event sparks (an expanding ring and the event's name), redrawn only when one starts or ends; the map's frame loop animates them (`reg`). */
const AtSparks = memo(function AtSparks({ sparks, reg }: { sig: string; sparks: AtSpark[]; reg: (el: SVGElement | null) => void }) {
  return <g>
    {sparks.map(s => <g key={s.id}>
      <circle ref={reg} data-mark="ring" cx={s.x} cy={s.y} r={6} fill="none" stroke="var(--accent)" strokeWidth={2} />
      <text ref={reg} data-mark="text" x={s.x} y={s.y - 16} textAnchor="middle" fill="var(--accent)" style={{ font: '600 11px var(--mono)', opacity: 0 }}>{s.text}</text>
    </g>)}
  </g>
}, atSigEq)

/** An orchestrator's routing flash (a red dot that pops and fades), once per mount; on the compositor. */
function AtFlash({ x, y }: { x: number; y: number }) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = ref.current; if (!el || typeof el.animate !== 'function') return
    const k = (s: number, o: number) => ({ transform: `scale(${s})`, opacity: o, easing: 'ease-in-out' })
    const a = el.animate([k(0.4, 1), k(1.2, 1), k(1, 0)], { duration: 1000, fill: 'forwards' })
    return () => a.cancel()
  }, [])
  return <div ref={ref} className="absolute rounded-full bg-[var(--bad)] opacity-0" style={atCentred(x, y, AT_FLASH)} />
}

/** The trace window's slide at sim time `clock`. */
const atStrip = (clock: number) => `translateX(${((AT_WIN - clock) / AT_WIN) * 100}%)`
const atTokSig = (k: WorkflowToken) => atSig(k.uid, k.phase, k.line, k.state, k.next)
/** Everything the map draws apart from the clock (tokens, queue, heat, approvals, marks, the trace's rows and states): the map re-renders when it changes. */
function atStructSig(eng: WorkflowEngine, F: { sparks: { id: number }[]; fading: { id: number }[]; hubFlash: number[]; evLabel: { n: number } }) {
  return atSigs([
    atSigs(eng.jobs.map(j => atSig(j.id, j.done ? (j.rejected ? 'r' : 'd') : '', j.state, atSigs(j.tokens.map(atTokSig))))),
    atSigs(eng.queue.map(q => String(q.id))), String(eng.dropped), atSigs(eng.waiting.map(atTokSig)),
    atSigs(Object.entries(eng.queues).filter(([, q]) => q.length).map(([s, q]) => atSig(s, q.length, q[0].uid))),
    atHeatKey(eng), atSigs(F.sparks.map(s => String(s.id))), atSigs(F.fading.map(f => String(f.id))), F.hubFlash.join(','), String(F.evLabel.n),
  ])
}
/** The engine clock as a tiny store: running trace rows subscribe, so they refresh without their row (a motion element) re-rendering. */
function atClockStore() {
  let v = 0
  const subs = new Set<() => void>()
  return { get: () => v, set: (x: number) => { v = x; subs.forEach(f => f()) }, sub: (f: () => void) => { subs.add(f); return () => { subs.delete(f) } } }
}
type AtClock = ReturnType<typeof atClockStore>
/** Approvals waiting at each station, as countdown-ring data. */
function atRings(eng: WorkflowEngine, machines: Record<string, WorkflowMachine>) {
  const byStop = new Map<string, Map<string, WorkflowToken[]>>()
  for (const tk of eng.waiting) {
    const stn = machines[tk.job.type].states[tk.state].at[1]
    let l = byStop.get(tk.line); if (!l) byStop.set(tk.line, l = new Map())
    l.set(stn, [...(l.get(stn) ?? []), tk])
  }
  return [...byStop].flatMap(([line, l]) => [...l].map(([stn, q]) => ({ k: atSig(line, stn), line, stn, ...atPoint(line, atPos(line, stn) ?? 0), n: q.length, q, frac: Math.max(0, q[0].t / eng.hitlWait) })))
}
/** The countdown rings on stations waiting for a human (and how many wait there); they follow the clock store. */
function AtRings({ eng, machines, clock }: { eng: WorkflowEngine; machines: Record<string, WorkflowMachine>; clock: AtClock }) {
  useSyncExternalStore(clock.sub, () => atSigs(atRings(eng, machines).map(r => atSig(r.k, r.n, svgN(r.frac * 107)))), () => '')
  const C = 2 * Math.PI * 17
  return <>{atRings(eng, machines).map(r => (
    <g key={r.k} transform={svgTranslate(r.x, r.y)}>
      <circle r={17} fill="var(--card)" stroke="color-mix(in srgb, var(--warn) 25%, transparent)" strokeWidth={4} />
      <circle r={17} fill="none" stroke="var(--warn)" strokeWidth={4} strokeLinecap="round" strokeDasharray={`${svgN(r.frac * C)} ${svgN(C)}`} transform="rotate(-90)" />
      {r.n > 1 && <g transform="translate(16,-16)"><circle r={9} fill="var(--warn)" /><text y={4} textAnchor="middle" fill="var(--card)" style={{ font: '700 11px var(--font)' }}>{r.n}</text></g>}
    </g>))}</>
}
/** An approval's seconds left (amber under 6); follows the clock store, re-rendering when the whole second changes. */
function AtCountdown({ tk, clock }: { tk: WorkflowToken; clock: AtClock }) {
  const n = useSyncExternalStore(clock.sub, () => Math.ceil(tk.t), () => 0)
  return <span className={cn('w-8 flex-none font-[family-name:var(--mono)] text-xs whitespace-pre', n < 6 ? 'text-[var(--warn)]' : 'text-[var(--fg3)]')} title={'Approved by policy when it runs out'}>{atPad(`${n}s`, 3)}</span>
}
/** A trace row's time strip and numbers; a running job's refresh with the clock store, a finished job's never. */
function AtTraceCells({ j, clock: store, strip }: { j: WorkflowJob; clock: AtClock; strip: (el: HTMLDivElement | null) => void }) {
  const clock = useSyncExternalStore(store.sub, () => j.done ? j.t1 ?? store.get() : store.get(), () => 0)
  const tx = (v: number) => `${(v / AT_WIN) * 100}%`
  return <>
    <div className="relative h-3.5 overflow-x-clip">
      {/* the window slides by transform: the map writes it into every strip (a finished row never re-renders for it) */}
      <div ref={strip} className="absolute inset-0">
        {j.segs.map((s, k) => { const b = s.t1 ?? clock; if (b < clock - AT_WIN) return null; return (
          <span key={k} title={s.label} className={cn('absolute rounded-[var(--r-sm)]', s.sub ? 'top-[3px] h-2' : 'top-0 h-3.5')}
            style={{ left: tx(s.t0), width: `max(1px, ${tx(b - s.t0)})`, background: atSegFill(s, atColor(s.line)) }} />) })}
      </div>
    </div>
    <AtNums seconds={(j.t1 ?? clock) - j.t0} tokens={Math.round(j.usage.tokens / 100) * 100} usd={j.usage.usd} />
  </>
}
type AtRowProps = {
  sig: string; j: WorkflowJob; i: number; cur: string; hover: boolean; pinned: boolean; clock: AtClock
  /** registers the row's time strip, which the map slides by writing its transform (rows don't re-render for it) */
  strip: (el: HTMLDivElement | null) => void
  setHover: (h: number | null) => void; setPin: (f: (p: number | null) => number | null) => void
}
/** One trace row; re-renders only when its place, state or highlight changes (its numbers and bars refresh on their own). */
const AtTraceRow = memo(function AtTraceRow({ j, i, cur, hover, pinned, clock, strip, setHover, setPin }: AtRowProps) {
  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: j.done ? 0.6 : 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.25 }}
      {...atFollow(j.id, setHover, setPin)} style={{ transform: `translateY(${i * AT_ROW_H}px)`, height: AT_ROW_H }}
      className={cn('absolute inset-x-0 top-0 grid cursor-pointer items-center border-b border-[var(--line)] text-[13px] [contain:strict] hover:bg-[color-mix(in_srgb,var(--muted)_60%,transparent)]', AT_TRACE_GRID, hover && 'bg-[color-mix(in_srgb,var(--muted)_60%,transparent)]')}>
      <AtRowName n={j.id} color={atColor(j.tokens[0]?.line ?? 'memory')} name={j.name} status={<span className={j.done ? 'text-[var(--ok)]' : undefined}>{cur}</span>}>
        <button type="button" aria-pressed={pinned} aria-label={`Follow job ${String(j.id)}, ${j.name}, on the map`} onClick={() => setPin(p => p === j.id ? null : j.id)}
          className={cn(AT_JOB_DOT, 'cursor-pointer border-0 transition-[background] duration-300')} style={onColorLabel(atColor(j.tokens[0]?.line ?? 'memory'))}>{j.id}</button>
      </AtRowName>
      <AtTraceCells j={j} clock={clock} strip={strip} />
    </motion.div>
  )
}, atSigEq)

/** The job tokens: composited boxes the frame loop moves (`reg`); re-rendered only when a token comes, goes or changes look. */
const AtTokens = memo(function AtTokens({ tokens, hj, reg, place }:
  { sig: string; tokens: WorkflowToken[]; hj: WorkflowJob | null; reg: (el: HTMLElement | null) => void; place: (tk: WorkflowToken) => string }) {
  return <>{tokens.map(tk => (
    <div key={tk.uid} data-id={tk.uid} ref={reg} className={cn('absolute top-0 left-0 will-change-transform', atDim(!hj || hj === tk.job))} style={{ ...atBox(AT_TOK), transform: place(tk) }}>
      <AtTokenGlyph n={tk.job.id} color={atColor(tk.line)} small={!!tk.parent} queued={tk.phase === 'queue'} />
    </div>))}</>
}, atSigEq)

/** One approval card (fixed size, stacked by transform); its countdown refreshes on its own, the card only when it moves or is followed. */
const AtCard = memo(function AtCard({ tk, i, hover, machines, eng, clock, currency, done, setHover, setPin }:
  { sig: string; tk: WorkflowToken; i: number; hover: boolean; machines: Record<string, WorkflowMachine>; eng: WorkflowEngine; clock: AtClock; currency: string; done: () => void
    setHover: (h: number | null) => void; setPin: (f: (p: number | null) => number | null) => void }) {
  const st = machines[tk.job.type].states[tk.state], amount = Number(tk.job.data.amount) || 0, y = i * (AT_CARD_H + AT_CARD_GAP)
  return (
    <motion.div role="group" aria-label={`${tk.job.name} needs your approval`} initial={{ opacity: 0, x: -8, y }} animate={{ opacity: 1, x: 0, y }} exit={{ opacity: 0, x: -8 }} transition={spring(0.25, 0.35)}
      {...atFollow(tk.job.id, setHover, setPin)}
      className={cn('pointer-events-auto absolute top-0 start-0 flex w-full flex-col justify-between overflow-hidden rounded-[var(--r-md)] border bg-[color-mix(in_srgb,var(--warn)_5%,var(--card))] px-2.5 py-2 text-[13px] shadow-[0_6px_20px_-8px_rgba(0,0,0,.28)]',
        hover ? 'border-[var(--warn)]' : 'border-[color-mix(in_srgb,var(--warn)_45%,var(--line))]')} style={{ height: AT_CARD_H }}>
      <div className="flex items-center gap-2">
        <span className={AT_JOB_DOT} style={onColorLabel(atColor(tk.line))}>{tk.job.id}</span>
        <b className="min-w-0 flex-1 truncate font-medium">{tk.job.name}</b>
        <AtCountdown tk={tk} clock={clock} />
      </div>
      <div className="flex items-center gap-1.5 [@media(pointer:coarse)]:[&>button]:min-h-9">
        <span className="min-w-0 flex-1 truncate text-xs text-[var(--fg3)]">{st.label}{amount ? ` · ${fmt.money(amount, currency)}` : ''}</span>
        <Button size="sm" onClick={() => { eng.resolve(tk, 'reject'); done() }}>Reject</Button>
        <Button size="sm" variant="primary" onClick={() => { eng.resolve(tk, 'approve'); done() }}>Approve</Button>
      </div>
    </motion.div>
  )
}, atSigEq)

const AT_SIM_LEGEND = [
  { label: 'Routing decision', swatch: 'h-2.5 w-2.5 rounded-full bg-[var(--bad)]' }, AT_LEGEND_ORCH,
  { label: 'Job (numbered, matches the trace)', swatch: 'h-3.5 w-3.5 rounded-full bg-[var(--fg2)]' },
  { label: 'Queued for a busy agent', swatch: 'h-3.5 w-3.5 rounded-full bg-[var(--fg2)] outline-[1.5px] outline-offset-[1.5px] outline-[var(--fg3)] outline-dashed' },
  { label: 'Congestion', swatch: 'h-2.5 w-7 rounded-full bg-[linear-gradient(90deg,color-mix(in_srgb,var(--fg3)_35%,transparent),color-mix(in_srgb,var(--warn)_60%,transparent),color-mix(in_srgb,var(--bad)_65%,transparent))]' },
  AT_LEGEND_WAIT,
]

/** Pause, speed, human in the loop, max jobs and the fire-event chips; re-renders only when one of them changes. */
const AtControls = memo(function AtControls({ eng, machines, chips, rerender }:
  { sig: string; eng: WorkflowEngine; machines: Record<string, WorkflowMachine>; chips: string[]; rerender: () => void }) {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 pb-3 text-xs text-[var(--fg2)]">
      <IconButton size="icon" variant="default" tone="default" label={eng.paused ? 'Play' : 'Pause'} icon={<Icon name={eng.paused ? 'play' : 'pause'} size={14} filled />} onClick={() => { eng.paused = !eng.paused; rerender() }} />
      <label className="contents"><span>Speed</span><Slider min={0.25} max={3} step={0.25} value={eng.speed} onChange={v => { eng.speed = v; rerender() }} className={AT_RANGE} /></label>
      <span className="ui-num w-9">{fmt.number(eng.speed)}×</span>
      <span className="contents [@media(pointer:coarse)]:[&>label]:min-h-8"><Switch checked={eng.hitl} onChange={v => { eng.setHitl(v); rerender() }} label={<span className="me-1">Human in the loop</span>} /></span>
      <label className="contents"><span className="ms-2 max-sm:ms-0">Max jobs</span><Slider min={1} max={6} step={1} value={eng.maxJobs} onChange={v => { eng.maxJobs = v; rerender() }} className={AT_RANGE} /></label>
      <span className="ui-num w-3.5">{fmt.number(eng.maxJobs)}</span>
      <span className="flex-1 max-sm:hidden" />
      <span className="max-sm:basis-full">Fire event</span>
      <span className="flex flex-wrap gap-1.5">{chips.map(ty => (
        <Chip key={ty} onClick={() => { eng.fire(ty); rerender() }} className="!h-7 font-[family-name:var(--mono)] !text-[11px] !font-normal [@media(pointer:coarse)]:!h-9">{machines[ty].event}</Chip>))}</span>
    </div>
  )
}, atSigEq)

/**
 * The agent-team simulation on the transit map: the Indexing loop and the Intake endpoint fire events into a queue
 * (drawn under Intake); jobs start as slots free up and travel their state graph along the drawn lines. Agents take one
 * job at a time: the others line up with a counter, and track segments warm up as tokens pile onto them. Human and
 * Risk stations wait for approval when human-in-the-loop is on (a countdown ring on the station, an approval card beside
 * it). Pause, speed and max-jobs controls, fire-event chips, and a trace table (time, made-up tokens and cost) whose
 * connectors link a follow-up job to the job that triggered it. `engineOptions` override the engine's (speed, maxJobs,
 * meter…); `autoStart` fires two events to start with. Keep `machines` and `order` stable: new ones start over.
 */
export function TransitSimMap({ machines = AT_NO_MACHINES, order = AT_NO_ORDER, engineOptions, autoStart = true, currency = 'CHF', className }:
  { machines?: Record<string, WorkflowMachine>; order?: string[]; engineOptions?: WorkflowEngineOptions; autoStart?: boolean; currency?: string; className?: string }) {
  const eng = useMemo(() => atEngine(machines, order, engineOptions), [machines, order]) // eslint-disable-line react-hooks/exhaustive-deps
  const agents = useMemo(() => new Set(Object.values(machines).flatMap(m => Object.values(m.states).filter(s => s.work).map(s => s.at[1]))), [machines])
  const [, setTick] = useState(0)
  const rerender = useCallback(() => setTick(x => (x + 1) % 1e6), [])
  const [hovered, setHover] = useState<number | null>(null), [pin, setPin] = useState<number | null>(null)
  const hover = hovered ?? pin // the job being followed on the map
  const { ref: host, visible } = useViewport<HTMLDivElement>(null, { amount: 0 })
  const narrow = useMediaQuery('(max-width: 639px)')
  const reduce = !!useReducedMotion()
  const [stageRef, stageW] = useWidth<HTMLDivElement>()
  const fx = useRef({ sparks: [] as AtSpark[], fading: [] as AtFade[], hubFlash: [0, 0, 0], evLabel: { text: '', n: 0 }, uid: 0 })
  const trainEl = useRef<HTMLDivElement>(null), trainAnim = useRef<Animation | null>(null), since = useRef(0)
  const toks = useAtTokenEls(), disp = useRef(new Map<number, { line: string; s: number }>())
  const trainBorn = useRef('')
  /** Puts the train where the engine clock says (jumping only if it drifted more than half a degree) and runs or stops it with the map. */
  const syncTrain = useCallback((running: boolean) => {
    const el = trainEl.current, a = trainAnim.current; if (!el) return
    const deg = atTrainDeg(eng.clock)
    if (!a) { el.style.transform = atRotate(deg); return } // reduced motion: it steps with the panels
    const want = (deg / 360) * AT_LAP_MS
    let d = want - (Number(a.currentTime ?? 0) % AT_LAP_MS); d -= Math.round(d / AT_LAP_MS) * AT_LAP_MS
    if (Math.abs(d) > AT_LAP_MS / 720) a.currentTime = want
    if (a.playbackRate !== eng.speed) a.playbackRate = eng.speed
    if (running && a.playState !== 'running') a.play(); else if (!running && a.playState === 'running') a.pause()
  }, [eng])
  useEffect(() => {
    const el = trainEl.current; if (!el || reduce || typeof el.animate !== 'function') return
    const a = el.animate([{ transform: 'rotate(0deg)' }, { transform: 'rotate(360deg)' }], { duration: AT_LAP_MS, iterations: Infinity, easing: 'linear' })
    a.pause(); trainAnim.current = a
    return () => { a.cancel(); trainAnim.current = null }
  }, [reduce])
  const reduceRef = useRef(reduce); reduceRef.current = reduce
  const heatTw = useMemo(() => atHeatTween(), []), clockStore = useMemo(() => atClockStore(), [])
  const loopOn = visible && !eng.paused
  const marks = useMemo(() => atMarks(), [])
  // heat tweens and marks started (or left running) while the frame loop is stopped (paused) run on a loop of their own
  const [heatSolo, setHeatSolo] = useState(false)
  const xyOf = (tk: WorkflowToken) => { const d = disp.current.get(tk.uid); return d ? atPoint(d.line, d.s) : atPoint(tk.line, atPos(tk.line, machines[tk.job.type].states[tk.state].at[1]) ?? 0) }
  // engine events → the short-lived marks on the map (sparks, fading tokens, hub flashes, the loop's event label)
  useEffect(() => eng.subscribe(ev => {
    const F = fx.current, now = performance.now(), calm = reduceRef.current
    if (ev.kind === 'queued') {
      if (ev.cause === 'intake' && !calm) { const q = atPoint('research', AT_SP.research.Intake); F.sparks = [...F.sparks, { id: ++F.uid, x: q.x, y: q.y, text: ev.ev, t: now }] }
      else if (ev.cause !== 'emit') F.evLabel = { text: ev.ev, n: F.evLabel.n + 1 }
    } else if (ev.kind === 'enter') {
      const st = eng.machines[ev.job.type].states[ev.state], hi = st.orch ? AT_HUBS.findIndex(h => h[0] === st.at[1]) : -1
      if (hi >= 0 && !calm) F.hubFlash[hi]++
    } else if (ev.kind === 'trigger' && ev.ev && !calm) {
      const p = xyOf(ev.token); F.sparks = [...F.sparks, { id: ++F.uid, x: p.x, y: p.y, text: ev.ev, t: now }]
    } else if (ev.kind === 'done') {
      const p = xyOf(ev.token); F.fading = [...F.fading, { id: ev.token.uid, x: p.x, y: p.y, line: ev.token.line, jid: ev.job.id, t: now, small: !!ev.token.parent }]
      disp.current.delete(ev.token.uid)
    }
  }), [eng]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { // two events to start with, so the map is busy as soon as it is seen
    if (!autoStart) return
    const t1 = setTimeout(() => eng.fire(), 400), t2 = setTimeout(() => eng.fire(), 2000)
    return () => { clearTimeout(t1); clearTimeout(t2) }
  }, [eng, autoStart])
  const strips = useRef(new Set<HTMLDivElement>()), stripNow = useRef(atStrip(eng.clock)), lastSig = useRef('')
  // every frame: step the engine, then glide each token towards its place on the line and write its transform straight
  // into its composited box (no React state, no layout); React re-renders about 8 times a second for counters, heat and panels
  useFrameLoop(loopOn, (dt, now) => {
    eng.tick(dt)
    heatTw.step(now); marks.step(now)
    const calm = reduceRef.current
    const want = atLayout(eng, agents, calm), D = disp.current, v = (AT_SPEED * eng.speed * 2 + 60) * dt
    for (const [uid, [line, s]] of want) {
      let d = D.get(uid)
      if (!d || calm) { d = { line, s }; D.set(uid, d) } else atGlide(d, line, s, v, AT_SNAP)
      toks.write(String(uid), atAt(atPoint(d.line, d.s), AT_TOK))
    }
    for (const uid of D.keys()) if (!want.has(uid)) D.delete(uid)
    if ((since.current += dt) >= 0.125) {
      since.current = 0
      syncTrain(true)
      const F = fx.current, now = performance.now()
      if (F.sparks.some(s => now - s.t >= 1900)) F.sparks = F.sparks.filter(s => now - s.t < 1900)
      if (F.fading.some(f => now - f.t >= 800)) F.fading = F.fading.filter(f => now - f.t < 800)
      stripNow.current = atStrip(eng.clock)
      for (const el of strips.current) el.style.transform = stripNow.current
      // the map re-renders only when what it shows changed; running trace rows, countdowns and rings follow the clock
      // store on their own. Committed in this frame, so the panels repaint with the tokens.
      const sig = atStructSig(eng, fx.current)
      flushSync(() => { if (sig !== lastSig.current) { lastSig.current = sig; rerender() } clockStore.set(eng.clock) })
    }
  }, { coarseFps: 30 })
  const regStrip = useCallback((el: HTMLDivElement | null) => {
    if (!el) return
    strips.current.add(el); el.style.transform = stripNow.current
    return () => { strips.current.delete(el) }
  }, [])
  // the trace window slides by transform, not layout: written straight into each row's strip
  useLayoutEffect(() => { stripNow.current = atStrip(eng.clock); for (const el of strips.current) if (el.style.transform !== stripNow.current) el.style.transform = stripNow.current })
  // paused mid-tween, or a mark mounted while paused (setHeatSolo(true) settles: same value, no further render)
  useLayoutEffect(() => { if (!loopOn && (heatTw.busy() || marks.busy())) setHeatSolo(true) }) // eslint-disable-line react-hooks/exhaustive-deps
  useFrameLoop(heatSolo && !loopOn, (_, now) => { const a = heatTw.step(now), b = marks.step(now); if (!a && !b) setHeatSolo(false) }, { coarseFps: 30 })
  const F = fx.current
  const hj = hover !== null ? eng.jobs.find(j => j.id === hover) ?? null : null
  const lit = (k: string) => !hj || hj.lines.has(k)
  const tokens = eng.jobs.filter(j => !j.done).flatMap(j => j.tokens)
  const intakeType = eng.intake ? eng.typeOf(eng.intake) : undefined
  const chips = [...order, ...(intakeType && !order.includes(intakeType) ? [intakeType] : [])].filter(t => machines[t])
  const placeOf = (tk: WorkflowToken) => toks.placeOf(String(tk.uid), () => atAt(xyOf(tk), AT_TOK))
  if (!trainBorn.current) trainBorn.current = atRotate(atTrainDeg(eng.clock))
  useEffect(() => syncTrain(loopOn), [syncTrain, loopOn, reduce])

  const heatKey = atHeatKey(eng)
  const litKey = hj ? [...hj.lines].join(',') : null
  useLayoutEffect(() => {
    if (heatTw.set(heatKey, hj ? hj.lines : null, performance.now(), reduce, host.current) && !loopOn) setHeatSolo(true)
  }, [heatTw, heatKey, litKey, reduce, loopOn]) // eslint-disable-line react-hooks/exhaustive-deps
  // queue counters: one per agent with a queue, beside the head of its line-up, away from the station's label
  const queueTags = Object.entries(eng.queues).filter(([, q]) => q.length).map(([stn, q]) => {
    const tk = q[0], dir = atDirOf(tk), b = atPos(tk.line, stn) ?? 0, p = atPoint(tk.line, b - dir * AT_HEAD), r = p.a * Math.PI / 180
    const lab = AT_ST.find(x => x[0] === stn), nx = -Math.sin(r), ny = Math.cos(r), sd = lab && nx * lab[3] + ny * lab[4] > 0 ? -1 : 1
    return { stn, n: q.length, x: p.x + nx * sd * 24, y: p.y + ny * sd * 24 }
  })
  // approvals: grouped by station (a countdown ring on the station, cards anchored beside it); on phones all in one strip
  const rings = atRings(eng, machines)
  const groups = narrow ? (eng.waiting.length ? [{ k: '*', q: eng.waiting, x: 0, y: 0, stn: '' }] : []) : rings
  const maxCards = narrow ? 1 : AT_CARDS // phones: one card in a strip above the map, the rest counted
  const stageH = stageW * (AT_H / AT_W), cardW = narrow ? stageW : AT_CARD_W
  const fs = narrow ? 1.2 : 1 // phones: the map is drawn at ~0.8 scale, so labels grow to stay ≥ 11px on screen
  const anchorOf = (g: { x: number; y: number; stn: string }) => {
    const lab = AT_ST.find(x => x[0] === g.stn)
    const past = lab && lab[3] > 0 ? lab[3] + g.stn.length * 8 + 14 : 30 // clear of the station's label when it sits to the right
    return { left: Math.max(4, Math.min(((g.x + past) / AT_W) * stageW, stageW - cardW - 4)), top: Math.max(4, (g.y / AT_H) * stageH - 26) }
  }
  // trace: follow-up jobs link to the job whose finish triggered them; the followed job's chain lights up
  const rowOf = new Map(eng.jobs.map((j, i) => [j.id, i]))
  const chain = new Set<number>()
  if (hover !== null) {
    for (let id: number | undefined = hover; id !== undefined && !chain.has(id); id = eng.jobs.find(j => j.id === id)?.parent) chain.add(id)
    const down = (id: number) => eng.jobs.forEach(j => { if (j.parent === id && !chain.has(j.id)) { chain.add(j.id); down(j.id) } }); down(hover)
  }
  const tx = (t: number) => `${(t / AT_WIN) * 100}%`
  const queueShown = eng.queue.slice(0, AT_EQ_ROWS), running = tokens.filter(t => !t.parent).length, active = eng.jobs.filter(j => !j.done).length

  const cardDone = useCallback(() => { setHover(null); setPin(null); rerender() }, [rerender])
  /** The approval cards waiting at one station (or, on phones, all of them): fixed-size, stacked by transform. */
  const atCards = (k: string, q: WorkflowToken[]) => (
    <div key={k} className={cn(k === '*' && 'pointer-events-none absolute inset-x-0 top-0')}>
      <AnimatePresence initial={false}>
        {q.slice(0, maxCards).map((tk, i) => <AtCard key={tk.uid} sig={atSig(i, hover === tk.job.id, tk.state)} tk={tk} i={i} hover={hover === tk.job.id}
          machines={machines} eng={eng} clock={clockStore} currency={currency} done={cardDone} setHover={setHover} setPin={setPin} />)}
        {q.length > maxCards && <motion.div key="more" initial={{ opacity: 0, y: maxCards * (AT_CARD_H + AT_CARD_GAP) }} animate={{ opacity: 1, y: maxCards * (AT_CARD_H + AT_CARD_GAP) }} exit={{ opacity: 0 }}
          className="absolute top-0 start-0"><Badge className="border border-[var(--line)] !bg-[var(--card)] font-normal">{`+${q.length - maxCards} more waiting`}</Badge></motion.div>}
      </AnimatePresence>
    </div>
  )

  return (
    <div ref={host} className={cn('flex flex-col', className)}>
      <div ref={stageRef} className="relative">
        {/* phones: approvals get their own fixed-height strip above the map, so they never cover stations or shift anything */}
        {narrow && <div className="relative mb-2" style={{ height: AT_CARD_H + 26 }}>
          {!eng.waiting.length && <div className="grid h-[80px] place-items-center rounded-[var(--r-md)] border border-dashed border-[var(--line2)] text-xs text-[var(--fg3)]">No approvals waiting</div>}
          {stageW > 0 && groups.map(g => atCards(g.k, g.q))}
        </div>}
        <AtMapScroll narrow={narrow} hintClass="!top-[114px]">
          <AtMapBase lit={litKey} fs={fs} regHeat={heatTw.reg} />
          {/* the train (under the Index station) and the waiting stations' pulses (under their rings) */}
          <div aria-hidden className={AT_HTML_LAYER}>
            <div ref={trainEl} className={cn('absolute', atDim(lit('index')))} style={{ ...atCentred(AT_LC[0], AT_LC[1], AT_TRAIN_BOX), transform: trainBorn.current }}>
              <div className="absolute rotate-90" style={{ left: `${(2 * AT_LR / AT_TRAIN_BOX) * 100}%`, top: `${(AT_LR / AT_TRAIN_BOX) * 100}%`, width: `${(AT_TRAIN / AT_TRAIN_BOX) * 100}%`, height: `${(AT_TRAIN / AT_TRAIN_BOX) * 100}%` }}>
                <svg viewBox={`${-AT_TRAIN / 2} ${-AT_TRAIN / 2} ${AT_TRAIN} ${AT_TRAIN}`} className="block h-full w-full overflow-visible"><rect x={-12} y={-4} width={24} height={8} rx={4} fill="var(--card)" stroke={atColor('index')} strokeWidth={2} /></svg>
              </div>
            </div>
            {!reduce && rings.map(r => <AtPulse key={r.k} x={r.x} y={r.y} active={visible} />)}
          </div>
          <svg viewBox={AT_VIEWBOX} aria-hidden className={AT_SVG_LAYER}>
            {/* the global event queue, waiting for a job slot */}
            <AtQueuePanel sig={atSig(atSigs(queueShown.map(q => String(q.id))), eng.queue.length, eng.queueMax, eng.maxJobs, running, active, eng.dropped, narrow)}
              queue={queueShown} qlen={eng.queue.length} qmax={eng.queueMax} maxJobs={eng.maxJobs} running={running} active={active} dropped={eng.dropped} narrow={narrow} />
            <AtSparks sig={atSigs(F.sparks.map(s => String(s.id)))} sparks={F.sparks} reg={marks.reg} />
            <AtHubs />
            {/* stations waiting for a human: a countdown ring (and how many are waiting) */}
            <AtRings eng={eng} machines={machines} clock={clockStore} />
          </svg>
          {/* routing flashes on the hubs, then the tokens: composited boxes the frame loop moves */}
          <div aria-hidden className={AT_HTML_LAYER}>
            {AT_HUBS.map(([n, [x, y]], i) => F.hubFlash[i] > 0 && <AtFlash key={n + F.hubFlash[i]} x={x} y={y} />)}
            <AtTokens sig={atSig(atSigs(tokens.map(tk => atSig(tk.uid, tk.phase === 'queue', !!tk.parent, tk.line))), hj?.id)} tokens={tokens} hj={hj} reg={toks.reg} place={placeOf} />
            {F.fading.map(f => <motion.div key={'f' + f.id} className="absolute top-0 left-0" style={{ ...atBox(AT_TOK), transform: atAt(f, AT_TOK) }} initial={{ opacity: 1 }} animate={{ opacity: 0 }} transition={{ duration: 0.8 }}>
              <AtTokenGlyph n={f.jid} color={atColor(f.line)} small={f.small} />
            </motion.div>)}
          </div>
          <AtLabelLayer fs={fs}>
            {F.evLabel.text && <text key={F.evLabel.n} ref={marks.reg} data-mark="ev" x={AT_LC[0]} y={AT_LC[1] + 5} textAnchor="middle" style={{ font: '600 11px var(--mono)', opacity: 0 }}>{F.evLabel.text}</text>}
            {/* queue counters beside each agent's line-up */}
            {queueTags.map(t => { const w = (26 + String(t.n).length * 8) * fs; return (
              <g key={t.stn} transform={svgTranslate(t.x, t.y)}>
                <rect x={-w / 2} y={-11 * fs} width={w} height={22 * fs} rx={11 * fs} fill="var(--card)" stroke="var(--warn)" strokeWidth={1.5} />
                <text y={5 * fs} textAnchor="middle" fill="var(--fg)" style={{ font: `600 ${13 * fs}px var(--font)` }}>+{t.n}</text>
              </g>) })}
          </AtLabelLayer>
        </AtMapScroll>
        {/* approvals float over the map beside the waiting station; fixed-size cards stacked by transform, so nothing shifts */}
        <span className="sr-only" aria-live="polite">{eng.waiting.length ? `${fmt.number(eng.waiting.length)} waiting for your approval` : ''}</span>
        {stageW > 0 && !narrow && groups.map(g => { const a = anchorOf(g); return (
          <div key={g.k} className="pointer-events-none absolute z-[2]" style={{ left: a.left, top: a.top, width: cardW }}>{atCards(g.k, g.q)}</div>) })}
      </div>

      <AtLegend lines={AT_LINE_IDS} extras={AT_SIM_LEGEND} />

      <AtControls sig={atSig(eng.paused, eng.speed, eng.hitl, eng.maxJobs, atSigs(chips))} eng={eng} machines={machines} chips={chips} rerender={rerender} />

      <AtTraceFrame narrow={narrow} axis={<><span className="absolute top-2.5 start-0">{`−${AT_WIN}s`}</span><span className="absolute top-2.5 left-1/2 -translate-x-1/2">{`−${AT_WIN / 2}s`}</span><span className="absolute top-2.5 end-0">now</span></>}>
        {/* a fixed-height list: rows sit at translateY(index), the window slides by transform, numbers keep a fixed width */}
        <div className="relative overflow-y-auto overscroll-y-contain" style={{ height: AT_ROWS * AT_ROW_H }}>
          <div className="relative" style={{ height: Math.max(AT_ROWS, eng.jobs.length) * AT_ROW_H }}>
            {!eng.jobs.length && <span className="absolute top-3 start-0 text-xs text-[var(--fg3)]">Jobs appear here as they start.</span>}
            {/* follow-up connectors: from the triggering job at the moment it emitted, to the follow-up job's start */}
            <div aria-hidden className={cn('pointer-events-none absolute inset-0 grid', AT_TRACE_GRID)}>
              <span />
              <div className="relative overflow-x-clip">
                <div ref={regStrip} className="absolute inset-0">
                  {eng.jobs.map(j => {
                    const pi = j.parent === undefined ? undefined : rowOf.get(j.parent), ci = rowOf.get(j.id)!
                    if (pi === undefined) return null
                    const te = j.queuedAt ?? j.t0, up = ci < pi, yp = pi * AT_ROW_H + AT_ROW_H / 2 + (up ? -7 : 7), yc = ci * AT_ROW_H + AT_ROW_H / 2
                    const on = chain.has(j.id) && chain.has(j.parent!), col = on ? 'border-[var(--fg2)]' : 'border-[color-mix(in_srgb,var(--fg3)_55%,transparent)]'
                    return <Fragment key={j.id}>
                      <span className={cn('absolute w-0 border-s transition-colors duration-200', col)} style={{ left: tx(te), top: 0, height: Math.abs(yc - yp), transform: `translateY(${Math.min(yp, yc)}px)` }} />
                      <span className={cn('absolute h-0 border-t transition-colors duration-200', col, j.t0 - te > 0.3 && 'border-dashed')} style={{ left: tx(te), top: 0, width: `calc(${tx(Math.max(0, j.t0 - te))} + 3px)`, transform: `translateY(${yc}px)` }} />
                    </Fragment>
                  })}
                </div>
              </div>
            </div>
            <AnimatePresence initial={false}>
              {eng.jobs.map((j, i) => {
                const cur = j.done ? (j.rejected ? 'rejected' : 'done') : j.tokens.length > 1 ? `${j.tokens.length - 1} in review` : j.tokens[0]?.phase === 'queue' ? `waiting for ${atName(machines[j.type].states[j.tokens[0].next!]?.at[1] ?? '')}` : (machines[j.type].states[j.state]?.label ?? j.state)
                return <AtTraceRow key={j.id} sig={atSig(i, cur, j.done, j.tokens[0]?.line, hover === j.id, pin === j.id)}
                  j={j} i={i} cur={cur} clock={clockStore} hover={hover === j.id} pinned={pin === j.id} strip={regStrip} setHover={setHover} setPin={setPin} />
              })}
            </AnimatePresence>
          </div>
        </div>
      </AtTraceFrame>
    </div>
  )
}
