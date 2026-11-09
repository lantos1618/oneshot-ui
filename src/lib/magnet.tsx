/**
 * Magnets for sliders and other one-axis drags (0.5): as you drag, the thumb is pulled onto meaningful values and
 * sticks there a little, like snapping in Figma or Keynote and the detents of iOS sliders.
 *
 *   magnets={[0, 25, 50, 75, { value: 100, label: 'Max', strength: 1.5 }, { from: 40, to: 60, label: 'Recommended' }]}
 *
 * - A **point** (`number` or `{ value, label?, radius?, strength? }`) captures the thumb within `radius` px (8 with a
 *   mouse, 12 on touch) and lets go once the pointer is `release` px away (18 / 26). Capture is shorter than release
 *   (hysteresis), so the thumb never flickers on and off at the boundary. `strength` scales both (1.5: a firmer detent).
 * - A **zone** `{ from, to, label?, pull? }` is drawn as a tinted band. `pull: 'edges'` (the default) makes its two
 *   boundaries sticky and leaves the inside free; `'center'` pulls to the middle (the middle half of the zone snaps,
 *   the outer quarters stay reachable); `'inside'` is a viscous detent: the thumb moves at about two-thirds speed inside
 *   the zone (finer control where it matters) and is drawn in a little as it approaches, without ever sticking.
 * - Radii are in **px** of the track, not fractions of the value range, so a magnet feels the same on a 120px volume
 *   slider and a 600px timeline. Between crowded marks capture shrinks to 30% of the gap and release to 50%, so
 *   the values in between stay reachable from either side.
 * - **Flicks pass through**: above `flick` px/ms (1, i.e. 1000 px/s, smoothed) nothing captures and a held magnet lets go.
 * - **Bypass**: hold Alt (Option on a Mac; `bypassKey`) while dragging, or put a second finger down anywhere on a touch
 *   screen, to move freely. Arrow keys always step normally; PageUp / PageDown and Ctrl/Cmd + arrows jump to the next or
 *   previous mark (`nextMagnet`, `magnetKeyDirection`).
 * - **Feedback** (useMagnet): an 8 ms haptic tick on touch screens (only after a user gesture), a polite, debounced
 *   "Snapped to {label}" announcement, and `useMagnetSettle` for a short spring of the thumb onto the mark (none under
 *   reduced motion). `MagnetMarks` draws the ticks and bands; `MagnetBubble` shows the label above the thumb.
 *
 * `magnetize` is the pure core (no React); `useMagnet` wraps it with state, bypass, feedback and keyboard helpers.
 * Slider, RangeSlider, ColorPicker (hue), SplitPane, the media seek bars (chapters) and Gantt (task edges) take it.
 */
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { AnimatePresence, animate, motion, useMotionValue, useReducedMotion } from 'motion/react'
import { clamp, cn, defineMessages, isCoarsePointer, logicalArrow, useLocale, useMessages, type UIDir } from './core'

/** A point magnet: a bare value, or a value with a label (announced and shown in the thumb's bubble), its own capture radius in px and a strength (scales capture and release). */
export type MagnetPoint = { value: number; label?: string; /** capture radius, px */ radius?: number; /** 1 = normal, 1.5 = a firmer detent */ strength?: number }
/** How a zone pulls: sticky boundaries (default), a pull to its middle, or a viscous inside that slows the thumb. */
export type MagnetZonePull = 'edges' | 'center' | 'inside'
/** A zone magnet: a band from `from` to `to` (drawn tinted on the track). See `MagnetZonePull`. `strength` scales the pull (for 'inside': how much slower, 0.5 by default). */
export type MagnetZone = { from: number; to: number; label?: string; pull?: MagnetZonePull; strength?: number }
/** Anything a `magnets` prop takes. */
export type Magnet = number | MagnetPoint | MagnetZone
/** The mark the thumb is on: its value and label, what produced it (a point, a zone edge or a zone centre) and the magnet itself. */
export type MagnetHit = { value: number; label?: string; kind: 'point' | 'edge' | 'center'; index: number; magnet: Magnet }
/** What magnetize carries from one pointer move to the next (the held mark, the last raw value and time, the smoothed speed). */
export type MagnetState = { key: string | null; raw: number | null; t: number | null; v: number }
/** A fresh gesture. */
export const MAGNET_IDLE: MagnetState = { key: null, raw: null, t: null, v: 0 }
/** Defaults, in px of track and px per ms. */
export const MAGNET_DEFAULTS = { radius: 8, release: 18, coarseRadius: 12, coarseRelease: 26, flick: 1, px: 240, viscosity: 0.5 } as const

/** Options for magnetize. */
export type MagnetOptions = {
  min: number; max: number
  /** snap free values (and the marks themselves) to this step */ step?: number
  /** the track's length in px (default 240): radii are in px, so this converts them to values */ px?: number
  /** capture radius, px (8) */ radius?: number
  /** release radius, px (18): larger than `radius` */ release?: number
  /** px/ms above which marks don't capture and a held mark lets go (1) */ flick?: number
  /** the move's timestamp in ms (event.timeStamp), for the speed */ t?: number
  /** move freely (Alt held, two fingers) */ bypass?: boolean
}
/** What magnetize returns for one move. */
export type MagnetResult = {
  /** the value to use: the mark while snapped, else the (viscous-mapped) raw value on the step grid */ value: number
  snapped: MagnetHit | null
  /** the zone `value` is in, if any */ zone: MagnetZone | null
  /** pass back on the next move */ state: MagnetState
  /** this move landed on a mark (or switched marks) */ captured: boolean
  /** this move left the mark held before */ released: boolean
  /** moving faster than `flick` */ fast: boolean
}

type MagnetAnchor = MagnetHit & { cap: number; rel: number }
const magnetIsZone = (m: Magnet): m is MagnetZone => typeof m === 'object' && m !== null && 'from' in m
const magnetKeyOf = (a: MagnetHit) => `${a.index}:${a.kind}:${a.value}`
const magnetQuantize = (v: number, min: number, max: number, step?: number) =>
  step && step > 0 ? clamp(min + Math.round((v - min) / step) * step, min, max) : clamp(v, min, max)
const magnetZoneBounds = (z: MagnetZone) => [Math.min(z.from, z.to), Math.max(z.from, z.to)] as const
const magnetHitOf = (a: MagnetAnchor): MagnetHit => ({ value: a.value, label: a.label, kind: a.kind, index: a.index, magnet: a.magnet })

/** The marks a magnet list produces, with capture and release radii in px. */
function magnetAnchors(magnets: readonly Magnet[], { min, max, step, px = MAGNET_DEFAULTS.px, radius = MAGNET_DEFAULTS.radius, release = MAGNET_DEFAULTS.release }: MagnetOptions): MagnetAnchor[] {
  const s = px / (max - min || 1), extra = Math.max(0, release - radius), q = (v: number) => magnetQuantize(v, min, max, step)
  const out: MagnetAnchor[] = []
  magnets.forEach((m, index) => {
    if (typeof m === 'number') { out.push({ value: q(m), kind: 'point', index, magnet: m, cap: radius, rel: release }); return }
    if (magnetIsZone(m)) {
      const [a, b] = magnetZoneBounds(m), k = m.strength ?? 1, pull = m.pull ?? 'edges'
      if (pull === 'edges') for (const v of [a, b]) out.push({ value: q(v), label: m.label, kind: 'edge', index, magnet: m, cap: radius * k, rel: release * k })
      else if (pull === 'center') {
        const cap = Math.max(radius, ((b - a) * s) / 4) * k
        out.push({ value: q((a + b) / 2), label: m.label, kind: 'center', index, magnet: m, cap, rel: cap + extra })
      }
      return
    }
    const k = m.strength ?? 1, r = m.radius ?? radius
    out.push({ value: q(m.value), label: m.label, kind: 'point', index, magnet: m, cap: r * k, rel: (r + extra) * k })
  })
  // crowded marks: capture covers at most 30% of the gap to a neighbour and release half of it, so the values in
  // between stay reachable from either side
  const sorted = [...out].sort((x, y) => x.value - y.value)
  sorted.forEach((a, i) => {
    const gaps = [sorted[i - 1], sorted[i + 1]].filter(Boolean).map(n => Math.abs(n.value - a.value) * s).filter(g => g > 0)
    if (!gaps.length) return
    const g = Math.min(...gaps)
    a.cap = Math.min(a.cap, g * 0.3); a.rel = Math.max(a.cap, Math.min(a.rel, g * 0.5))
  })
  return out
}

/**
 * The viscous 'inside' zones as a continuous, monotonic remap of the raw value: inside a zone the thumb moves at
 * W / (W + E) of the pointer's speed, and the margins just outside move a little faster to make up for it, so the
 * thumb is drawn into the zone and lines up with the pointer again past the margin. Stateless: no drift, no sticking.
 */
function magnetViscous(raw: number, zones: readonly MagnetZone[], s: number, releasePx: number) {
  let r = raw
  for (const z of zones) {
    if ((z.pull ?? 'edges') !== 'inside') continue
    const [a, b] = magnetZoneBounds(z), W = b - a
    if (W <= 0) continue
    const m = Math.max(W / 2, releasePx / s) // margin on each side, value units
    const E = Math.min((z.strength ?? MAGNET_DEFAULTS.viscosity) * W, m) // extra pointer travel the zone takes
    const h = E / 2, lo = a - m, hi = b + m
    if (r <= lo || r >= hi) continue
    if (r < a - h) r = lo + (r - lo) * (m / (m - h))
    else if (r <= b + h) r = a + (r - (a - h)) * (W / (W + E))
    else r = b + (r - (b + h)) * (m / (m - h))
  }
  return r
}

const magnetZoneAt = (zones: readonly MagnetZone[], v: number) => zones.find(z => { const [a, b] = magnetZoneBounds(z); return v >= a && v <= b }) ?? null

/**
 * The pure core: where should the thumb be for this raw pointer value? Pass the previous result's `state` back on the
 * next move (start a gesture with MAGNET_IDLE). See the module comment for the behaviour and defaults.
 */
export function magnetize(raw: number, magnets: readonly Magnet[], state: MagnetState = MAGNET_IDLE, opts: MagnetOptions): MagnetResult {
  const { min, max, step, px = MAGNET_DEFAULTS.px, radius = MAGNET_DEFAULTS.radius, flick = MAGNET_DEFAULTS.flick, t, bypass } = opts
  const release = Math.max(radius, opts.release ?? radius + (MAGNET_DEFAULTS.release - MAGNET_DEFAULTS.radius))
  const s = px / (max - min || 1)
  let v = state.v
  // speed in px/ms, smoothed with a 12 ms time constant (unbiased whatever the event rate: 60 Hz touch or a 1000 Hz
  // mouse), so one jittery event doesn't count as a flick and a pause forgets one
  if (t != null && state.t != null && state.raw != null && t > state.t) { const dt = t - state.t, a = 1 - Math.exp(-dt / 12); v += a * ((Math.abs(raw - state.raw) * s) / dt - v) }
  const fast = v > flick, next = { raw, t: t ?? state.t, v }
  const zones = magnets.filter(magnetIsZone)
  if (bypass) {
    const value = magnetQuantize(raw, min, max, step)
    return { value, snapped: null, zone: magnetZoneAt(zones, value), state: { key: null, ...next }, captured: false, released: state.key !== null, fast }
  }
  const mapped = clamp(magnetViscous(raw, zones, s, release), min, max)
  const anchors = magnetAnchors(magnets, { min, max, step, px, radius, release })
  const dist = (a: MagnetAnchor) => Math.abs(mapped - a.value) * s
  let near: MagnetAnchor | undefined
  for (const a of anchors) if (dist(a) <= a.cap && (!near || dist(a) < dist(near))) near = a
  let held = state.key ? anchors.find(a => magnetKeyOf(a) === state.key) : undefined
  if (held && (fast || dist(held) > held.rel)) held = undefined
  const hit = !fast && near && (!held || dist(near) < dist(held)) ? near : held
  const key = hit ? magnetKeyOf(hit) : null
  const value = hit ? hit.value : magnetQuantize(mapped, min, max, step)
  return { value, snapped: hit ? magnetHitOf(hit) : null, zone: magnetZoneAt(zones, value), state: { key, ...next }, captured: key !== null && key !== state.key, released: state.key !== null && key !== state.key, fast }
}

/** Every mark a keyboard can jump to (points, zone edges, zone centres), sorted and on the step grid. */
export function magnetStops(magnets: readonly Magnet[], { min, max, step }: { min: number; max: number; step?: number }) {
  const vs = magnets.flatMap(m => typeof m === 'number' ? [m] : magnetIsZone(m) ? (m.pull === 'center' ? [m.from, m.to, (m.from + m.to) / 2] : [m.from, m.to]) : [m.value])
  return [...new Set(vs.map(v => magnetQuantize(v, min, max, step)))].sort((a, b) => a - b)
}

/** The next mark above (`dir` 1) or below (-1) `value`, or null past the last one. */
export function nextMagnet(value: number, magnets: readonly Magnet[], dir: 1 | -1, range: { min: number; max: number; step?: number }) {
  const stops = magnetStops(magnets, range), eps = 1e-9 * (range.max - range.min || 1)
  return (dir > 0 ? stops.find(v => v > value + eps) : [...stops].reverse().find(v => v < value - eps)) ?? null
}

/** Which way a key jumps between marks: 1, -1, or 0 (not a jump key). PageUp / PageDown, and Ctrl or ⌘ with an arrow (← → mirror in RTL). */
export function magnetKeyDirection(e: { key: string; ctrlKey?: boolean; metaKey?: boolean; altKey?: boolean }, dir: UIDir = 'ltr'): 1 | -1 | 0 {
  if (e.key === 'PageUp') return 1
  if (e.key === 'PageDown') return -1
  if (!(e.ctrlKey || e.metaKey) || e.altKey) return 0
  const k = logicalArrow(e.key, dir)
  // rtl-lint-ignore: `k` is logicalArrow-mapped above
  return k === 'ArrowRight' || k === 'ArrowUp' ? 1 : k === 'ArrowLeft' || k === 'ArrowDown' ? -1 : 0
}

/** The magnet strings (machine-drafted de/ar). Override with `<UIProvider messages={{ 'magnet.snapped': … }}>`. */
export const MAGNET_MESSAGES = defineMessages('magnet', {
  en: {
    snapped: 'Snapped to {label}', entered: 'In {label}', valueAt: '{value}, {label}', half: 'Half', third: 'One third', twoThirds: 'Two thirds',
    quarter: 'Quarter', threeQuarters: 'Three quarters', collapse: 'Collapse', gap: 'Closest allowed', meet: 'Same value',
  },
  de: {
    snapped: 'Eingerastet bei {label}', entered: 'Im Bereich {label}', valueAt: '{value}, {label}', half: 'Hälfte', third: 'Ein Drittel', twoThirds: 'Zwei Drittel',
    quarter: 'Viertel', threeQuarters: 'Drei Viertel', collapse: 'Einklappen', gap: 'Kleinster Abstand', meet: 'Gleicher Wert',
  },
  ar: {
    snapped: 'استقر عند {label}', entered: 'ضمن {label}', valueAt: '{value}، {label}', half: 'النصف', third: 'الثلث', twoThirds: 'الثلثان',
    quarter: 'الربع', threeQuarters: 'ثلاثة أرباع', collapse: 'طي', gap: 'أقرب قيمة مسموح بها', meet: 'القيمة نفسها',
  },
})

/** The modifier keys a bypass can use. */
export type MagnetBypassKey = 'Alt' | 'Shift' | 'Meta' | 'Control'
const MAGNET_MOD = { Alt: 'altKey', Shift: 'shiftKey', Meta: 'metaKey', Control: 'ctrlKey' } as const
/** What apply() reads from the move. */
export type MagnetApplyContext = {
  /** the track's length in px */ px?: number
  /** the pointer event (modifier keys, pointerType, timeStamp) */ event?: { altKey?: boolean; shiftKey?: boolean; metaKey?: boolean; ctrlKey?: boolean; pointerType?: string; timeStamp?: number } | null
  /** override the timestamp (ms) */ t?: number
  /** force free movement */ bypass?: boolean
}
/** Options for useMagnet. */
export type UseMagnetOptions = {
  /** the marks; null, undefined or [] turns everything off */ magnets?: readonly Magnet[] | null
  min: number; max: number; step?: number
  /** hold this key to move freely (default 'Alt', Option on a Mac); null: no key */ bypassKey?: MagnetBypassKey | null
  /** px; default 8 with a mouse, 12 on touch */ radius?: number
  /** px; default 18 with a mouse, 26 on touch */ release?: number
  /** px/ms; default 1 */ flick?: number
  /** the 8 ms tick on touch screens (default on) */ haptics?: boolean
  /** the polite "Snapped to …" announcement (default on) */ announce?: boolean
  /** a value as text, for marks without a label (default: the locale's number format) */ describe?: (value: number) => string
  /** after a move lands on a mark (hit) or leaves one (null) */ onSnap?: (hit: MagnetHit | null, value: number) => void
}

/** A short haptic tick: touch screens only, after a user gesture (Chrome blocks vibrate before one and logs it). */
export function magnetHaptic(ms = 8) {
  try {
    if (!isCoarsePointer()) return
    const ua = (navigator as Navigator & { userActivation?: { hasBeenActive: boolean } }).userActivation
    if (ua && !ua.hasBeenActive) return
    navigator.vibrate?.(ms)
  } catch { /* not supported */ }
}

/**
 * Magnets for a drag: `apply(raw, { px, event })` returns `{ value, snapped, zone }` for each pointer move (call
 * `reset()` when the drag ends). Handles hysteresis, flicks, the bypass (Alt, or a second finger), the haptic tick and the
 * live announcement (render `live`). `at(value)` says which mark and zone a value is on (for aria-valuetext and the
 * bubble), `next(value, dir)` finds the mark a key jumps to, `stops` lists them. With no magnets every call passes through.
 *   const mg = useMagnet({ magnets, min, max, step })
 *   onMove: p => set(mg.apply(valueAt(p.x), { px: trackWidth, event: p.event }).value), onEnd: mg.reset
 */
export function useMagnet(options: UseMagnetOptions) {
  const { magnets, min, max, step } = options
  const on = !!magnets?.length
  const o = useRef(options)
  useLayoutEffect(() => { o.current = options })
  const st = useRef(MAGNET_IDLE), zoneRef = useRef<MagnetZone | null>(null)
  const touches = useRef(new Set<number>()), unlisten = useRef<(() => void) | null>(null)
  const [said, setSaid] = useState(''), timer = useRef<ReturnType<typeof setTimeout>>(undefined)
  const m = useMessages(MAGNET_MESSAGES), { fmt } = useLocale()
  const tr = useRef({ m, fmt })
  useLayoutEffect(() => { tr.current = { m, fmt } })
  useEffect(() => () => { unlisten.current?.(); clearTimeout(timer.current) }, [])
  const anchors = useMemo(() => on ? magnetAnchors(magnets!, { min, max, step }) : [], [on, magnets, min, max, step])
  const zones = useMemo(() => on ? magnets!.filter(magnetIsZone) : [], [on, magnets])
  const stops = useMemo(() => on ? magnetStops(magnets!, { min, max, step }) : [], [on, magnets, min, max, step])
  const say = (text: string) => {
    if (o.current.announce === false) return
    clearTimeout(timer.current)
    // debounced: a drag across five marks says only where it settled; the nbsp toggles so the same text is read again
    timer.current = setTimeout(() => setSaid(prev => prev === text ? text + ' ' : text), 350)
  }
  const engage = () => {
    if (unlisten.current || typeof window === 'undefined') return
    // a second finger anywhere bypasses (the dragging finger went down before this, so it never enters the set)
    const down = (e: PointerEvent) => { if (e.pointerType === 'touch') touches.current.add(e.pointerId) }
    const up = (e: PointerEvent) => { touches.current.delete(e.pointerId) }
    addEventListener('pointerdown', down, true); addEventListener('pointerup', up, true); addEventListener('pointercancel', up, true)
    unlisten.current = () => { removeEventListener('pointerdown', down, true); removeEventListener('pointerup', up, true); removeEventListener('pointercancel', up, true); touches.current.clear() }
  }
  const labelOf = (hit: { label?: string; value: number }) => hit.label ?? o.current.describe?.(hit.value) ?? tr.current.fmt.number(hit.value)
  const at = (value: number): { hit: MagnetHit | null; zone: MagnetZone | null; label: string | undefined } => {
    if (!on) return { hit: null, zone: null, label: undefined }
    const eps = 1e-9 * (max - min || 1), a = anchors.find(x => Math.abs(x.value - value) <= eps), zone = magnetZoneAt(zones, value)
    return { hit: a ? magnetHitOf(a) : null, zone, label: a?.label ?? zone?.label }
  }
  return {
    enabled: on,
    /** the marks a keyboard jumps between */ stops,
    /** one pointer move: the value to show, the mark it is on and the zone it is in */
    apply(raw: number, ctx: MagnetApplyContext = {}): MagnetResult {
      const opt = o.current
      if (!opt.magnets?.length) {
        const value = magnetQuantize(raw, opt.min, opt.max, opt.step)
        return { value, snapped: null, zone: null, state: MAGNET_IDLE, captured: false, released: false, fast: false }
      }
      engage()
      const ev = ctx.event, key = opt.bypassKey === undefined ? 'Alt' : opt.bypassKey
      const bypass = ctx.bypass ?? (!!(key && ev?.[MAGNET_MOD[key]]) || touches.current.size > 0)
      const coarse = ev?.pointerType ? ev.pointerType !== 'mouse' : isCoarsePointer()
      const radius = opt.radius ?? (coarse ? MAGNET_DEFAULTS.coarseRadius : MAGNET_DEFAULTS.radius)
      const release = opt.release ?? radius + (coarse ? MAGNET_DEFAULTS.coarseRelease - MAGNET_DEFAULTS.coarseRadius : MAGNET_DEFAULTS.release - MAGNET_DEFAULTS.radius)
      const r = magnetize(raw, opt.magnets, st.current, { min: opt.min, max: opt.max, step: opt.step, px: ctx.px, radius, release, flick: opt.flick, t: ctx.t ?? ev?.timeStamp, bypass })
      st.current = r.state
      if (r.captured && r.snapped) {
        if (opt.haptics !== false && ev?.pointerType === 'touch') magnetHaptic()
        say(tr.current.m('snapped', { label: labelOf(r.snapped) }))
        opt.onSnap?.(r.snapped, r.value)
      } else if (r.released) opt.onSnap?.(null, r.value)
      if (r.zone !== zoneRef.current) {
        zoneRef.current = r.zone
        if (r.zone?.label && r.zone.pull === 'inside' && !r.snapped) say(tr.current.m('entered', { label: r.zone.label }))
      }
      return r
    },
    /** end of a drag: forget the held mark and the speed */
    reset() { st.current = MAGNET_IDLE; zoneRef.current = null; unlisten.current?.(); unlisten.current = null },
    /** the mark `value` sits on (exactly) and the zone it is in */ at,
    /** aria-valuetext for `value`: "{text}, {label}" on a labelled mark or inside a labelled zone, else `text` */
    valueText: (value: number, text: string) => { const l = at(value).label; return l ? m('valueAt', { value: text, label: l }) : text },
    /** the mark a jump key moves to from `value` (null past the last one) */
    next: (value: number, dir: 1 | -1) => on ? nextMagnet(value, magnets!, dir, { min, max, step }) : null,
    /** the polite live region; render it once inside the control */
    live: (on ? <span className="sr-only" aria-live="polite">{said}</span> : null) as ReactNode,
  }
}

/**
 * A value (usually 0..1 along the track) that follows `target` instantly, except right after `kick` changes (a snap or a
 * release), when it springs there for a moment, so the thumb settles onto a mark instead of teleporting. No spring
 * under reduced motion. Feed it to a style through useTransform.
 */
export function useMagnetSettle(target: number, kick: number) {
  const mv = useMotionValue(target), reduce = useReducedMotion()
  const seen = useRef(kick), until = useRef(0), ctl = useRef<{ stop: () => void } | null>(null)
  useLayoutEffect(() => {
    const kicked = seen.current !== kick; seen.current = kick
    const now = typeof performance !== 'undefined' ? performance.now() : 0
    if (kicked) until.current = now + 240
    ctl.current?.stop()
    // within the settle window every new target is reached by the same spring, so a release flows into the next moves
    if (!reduce && now < until.current) ctl.current = animate(mv, target, { type: 'spring', stiffness: 700, damping: 38, mass: 0.6, restDelta: 0.0005 })
    else { ctl.current = null; mv.jump(target) }
  }, [target, kick, reduce, mv])
  useEffect(() => () => ctl.current?.stop(), [])
  return mv
}

const MAGNET_TICK = {
  /** on a card: grey ticks that stick out above and below a thin track, the active one in the accent */
  default: ['h-3 w-0.5 bg-[var(--fg3)] opacity-70', 'h-3.5 w-[3px] bg-[var(--accent)]'],
  /** a gap cut into a bar (video chapters on the scrim) */
  onDark: ['h-full w-[3px] bg-black/60', 'h-full w-[3px] bg-black/60'],
  /** a gap cut into a solid bar on a card */
  gap: ['h-full w-[3px] bg-[var(--card)]', 'h-full w-[3px] bg-[var(--card)]'],
  /** short ticks in a thin strip under a waveform (audio chapters), the current one in the accent */
  under: ['h-full w-0.5 bg-[var(--fg3)] opacity-70', 'h-full w-0.5 bg-[var(--accent)]'],
} as const
const MAGNET_BAND = {
  default: 'h-3 bg-[color-mix(in_srgb,var(--accent)_22%,transparent)]',
  onDark: 'h-full bg-white/20',
  gap: 'h-full bg-[color-mix(in_srgb,var(--accent)_22%,transparent)]',
  under: 'h-full bg-[color-mix(in_srgb,var(--accent)_22%,transparent)]',
} as const

/**
 * The track decorations: a tick for each point (and each zone centre), a tinted band for each zone. Put it inside the
 * track (it fills it, absolutely positioned, aria-hidden). `inset` is the thumb's radius in px when the thumb's centre
 * stops short of the track's ends (native range inputs), so ticks line up with it. Positions are logical
 * (inset-inline-start), so they mirror with the track in RTL and stay put inside an LTR island.
 */
export function MagnetMarks({ magnets, min, max, value, inset = 0, tone = 'default', className }:
  { magnets?: readonly Magnet[] | null; min: number; max: number; /** highlights the tick the value sits on */ value?: number | readonly number[]; inset?: number
    tone?: keyof typeof MAGNET_TICK; className?: string }) {
  if (!magnets?.length) return null
  const span = max - min || 1, f = (v: number) => clamp((v - min) / span, 0, 1)
  const at = (fr: number) => `calc(${inset}px + ${fr} * (100% - ${2 * inset}px))`
  const vals = value === undefined ? [] : typeof value === 'number' ? [value] : value
  const [tick, tickOn] = MAGNET_TICK[tone]
  return (
    <span aria-hidden className={cn('pointer-events-none absolute inset-0', className)}>
      {magnets.map((m, i) => {
        if (!magnetIsZone(m)) return null
        const [a, b] = magnetZoneBounds(m)
        return <span key={`z${i}`} data-magnet-zone="" className={cn('absolute top-1/2 -translate-y-1/2 rounded-full', MAGNET_BAND[tone])} style={{ insetInlineStart: at(f(a)), width: `calc(${f(b) - f(a)} * (100% - ${2 * inset}px))` }} />
      })}
      {magnets.map((m, i) => {
        const v = typeof m === 'number' ? m : magnetIsZone(m) ? (m.pull === 'center' ? (m.from + m.to) / 2 : null) : m.value
        if (v === null) return null
        const on = vals.some(x => Math.abs(x - v) <= 1e-9 * span)
        return <span key={`p${i}`} data-magnet-tick="" className={cn('absolute top-1/2 -translate-y-1/2 rounded-full transition-[background-color,height,width] duration-150', on ? tickOn : tick)}
          style={{ insetInlineStart: at(f(v)), marginInlineStart: on && tone === 'default' ? -1.5 : -1 }} />
      })}
    </span>
  )
}

/** The label bubble above a thumb (the shared tooltip look). Put it inside the thumb; it pops in while `show`. */
export function MagnetBubble({ label, show, className }: { label?: ReactNode; show: boolean; className?: string }) {
  return (
    <AnimatePresence>
      {show && label != null && label !== '' && (
        <motion.span key="b" aria-hidden initial={{ opacity: 0, y: 4, scale: 0.9 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 2, scale: 0.95, transition: { duration: 0.1 } }}
          transition={{ type: 'spring', stiffness: 600, damping: 32 }}
          // rtl-lint-ignore: centred over the thumb (physical centring, the same in both directions)
          className={cn('pointer-events-none absolute bottom-full left-1/2 z-10 mb-2 w-max -translate-x-1/2 rounded-[var(--r-md)] bg-[var(--primary)] px-2 py-1 text-xs whitespace-nowrap text-[var(--on-primary)] shadow-[var(--shadow)]', className)}>
          {label}
        </motion.span>
      )}
    </AnimatePresence>
  )
}
