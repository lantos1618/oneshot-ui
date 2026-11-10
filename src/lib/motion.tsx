import { type CSSProperties, type HTMLAttributes, type Key, type PointerEvent as RPointerEvent, type ReactElement, type Ref, type RefObject, cloneElement, isValidElement, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { EASE_OUT, EASE_OUT_CSS, MOTION, clamp, cn, composeRefs, isCoarsePointer, prefersReducedMotion, presenceProps, spring, springEasing, uiShared, useInView, usePresence, useReducedMotion, whenAnimationsDone } from './core'

/**
 * Where an element is relative to the viewport: `visible` while at least `amount` of it is on screen, `seen` once it has
 * been (and stays true). Pass your own ref or use the returned one: const { ref, seen, visible } = useViewport<HTMLDivElement>().
 * Start intros on `seen`; pause loops while not `visible`. `margin` grows the viewport (CSS margin syntax, '64px').
 */
export function useViewport<T extends Element = HTMLDivElement>(target?: RefObject<T | null> | null, { amount = 0.15, margin }: { amount?: number; margin?: string } = {}) {
  const own = useRef<T>(null)
  const ref = target ?? own
  const visible = useInView(ref, { amount, margin })
  const [seen, setSeen] = useState(false)
  useEffect(() => { if (visible) setSeen(true) }, [visible])
  return { ref, seen: seen || visible, visible }
}

type PresenceChild = ReactElement<{ ref?: Ref<Element>; style?: CSSProperties }>

function PresenceItem({ exiting = false, enter = true, pop = false, onGone, children }: { exiting?: boolean; enter?: boolean; pop?: boolean; onGone?: () => void; children: PresenceChild }) {
  const ref = useRef<HTMLElement>(null), box = useRef<number[]>(null)
  useLayoutEffect(() => { const e = ref.current; if (pop && !exiting && e) box.current = [e.offsetLeft, e.offsetTop, e.offsetWidth, e.offsetHeight] })
  useLayoutEffect(() => {
    if (!exiting) return
    const el = ref.current, b = box.current
    // popLayout: the leaving node keeps its box but leaves the flow, so the new one takes its place at once
    if (pop && el && b) Object.assign(el.style, { position: 'absolute', left: `${b[0]}px`, top: `${b[1]}px`, width: `${b[2]}px`, height: `${b[3]}px`, margin: '0' })
    return whenAnimationsDone(el, () => onGone?.())
  }, [exiting]) // eslint-disable-line react-hooks/exhaustive-deps
  return cloneElement(children, { ref: composeRefs(ref as RefObject<Element | null>, children.props.ref), ...presenceProps({ exiting, enter }) })
}

/**
 * An optional child that animates out before it unmounts: `<Presence>{open && <div className="ui-in">…</div>}</Presence>`.
 * The child plays its `ui-in` entrance when it appears (not on the first render unless `appear`) and the `ui-out` exit
 * (`data-ui-exit`) when it goes; the last shown child stays rendered until its animations finish.
 */
export function Presence({ appear = false, children }: { appear?: boolean; children?: PresenceChild | null | false }) {
  const shown = isValidElement(children) ? children : null
  const p = usePresence<Element>(!!shown, { appear })
  const last = useRef(shown)
  useLayoutEffect(() => { if (shown) last.current = shown })
  const node = shown ?? last.current
  if (!p.mounted || !node) return null
  return cloneElement(node, { ref: composeRefs(p.ref, node.props.ref), ...presenceProps(p) })
}

type PresenceRow<T> = { key: Key; item: T; exiting: boolean; enter: boolean }
function presenceMerge<T>(prev: PresenceRow<T>[], items: readonly T[], keyOf: (t: T) => Key): PresenceRow<T>[] {
  const old = new Map(prev.map(r => [r.key, r]))
  const next = items.map(item => { const key = keyOf(item), o = old.get(key); return { key, item, exiting: false, enter: !o || o.exiting || o.enter } })
  const keep = new Set(next.map(r => r.key)), out: PresenceRow<T>[] = [], placed = new Set<Key>()
  let j = 0
  for (const r of prev) {
    if (!keep.has(r.key)) { out.push({ ...r, exiting: true }); continue }
    if (placed.has(r.key)) continue
    while (j < next.length) { const n = next[j++]; out.push(n); placed.add(n.key); if (n.key === r.key) break }
  }
  return out.concat(next.slice(j).filter(n => !placed.has(n.key)))
}

/**
 * A keyed list whose removed items animate out in place (`data-ui-exit`) before they unmount, while added ones play
 * their entrance (`ui-in`; not on the first render unless `appear`). `children(item, { exiting, index })` returns one element per item.
 * `pop` takes a leaving item out of the flow at once, so the others close the gap straight away (with useFlip).
 */
export function PresenceList<T>({ items, keyOf, appear = false, pop = false, children }: { items: readonly T[]; keyOf: (t: T) => Key; appear?: boolean; pop?: boolean; children: (t: T, s: { exiting: boolean; index: number }) => PresenceChild }) {
  const [rows, setRows] = useState(() => items.map(item => ({ key: keyOf(item), item, exiting: false, enter: appear })))
  const [seen, setSeen] = useState(items)
  let shown = rows
  if (seen !== items) { shown = presenceMerge(rows, items, keyOf); setSeen(items); setRows(shown) }
  return shown.map((r, index) => (
    <PresenceItem key={r.key} exiting={r.exiting} enter={r.enter} pop={pop} onGone={() => setRows(rs => rs.filter(x => x.key !== r.key || !x.exiting))}>
      {children(r.item, { exiting: r.exiting, index })}
    </PresenceItem>
  ))
}

/**
 * Cross-fades a keyed child when `k` changes: the old one plays its exit (`data-ui-exit`) while the new one enters
 * (`ui-in`). `mode` 'pop' takes the old one out of the flow at once (icon and label swaps), 'wait' shows the new one
 * after the old one has left, 'sync' keeps both in the flow. The first child doesn't animate unless `appear`.
 */
export function Swap({ k, mode = 'pop', appear = false, children }: { k: Key; mode?: 'pop' | 'wait' | 'sync'; appear?: boolean; children: PresenceChild }) {
  const [state, setState] = useState({ k, first: true, gone: [] as { k: Key; node: PresenceChild }[] })
  const last = useRef(children)
  useLayoutEffect(() => { last.current = children })
  if (state.k !== k) setState(s => ({ k, first: false, gone: [...s.gone.filter(g => g.k !== k), { k: s.k, node: last.current }] }))
  const waiting = mode === 'wait' && state.gone.length > 0
  return (
    <>
      {state.gone.map(g => (
        <PresenceItem key={g.k} exiting pop={mode === 'pop'} onGone={() => setState(s => ({ ...s, gone: s.gone.filter(x => x !== g) }))}>{g.node}</PresenceItem>
      ))}
      {!waiting && <PresenceItem key={k} enter={appear || !state.first} pop={mode === 'pop'}>{children}</PresenceItem>}
    </>
  )
}

type SpringOptions = ReturnType<typeof spring>
/** Runs WAAPI keyframes with a spring (or a fixed duration and easing); falls back to a cubic-bezier where `linear()` is missing. */
function motionAnimate(el: Element, frames: Keyframe[], o: SpringOptions | { duration: number; easing: string }, delay = 0) {
  if (typeof el.animate !== 'function') return undefined
  const s = 'type' in o ? springEasing(o.bounce, o.duration) : { ms: o.duration * 1000, easing: o.easing, fallback: EASE_OUT_CSS }
  const timing = { duration: s.ms, delay: delay * 1000 }
  try { return el.animate(frames, { ...timing, easing: s.easing }) } catch { return el.animate(frames, { ...timing, easing: s.fallback }) }
}

const flipOffset = (el: HTMLElement): [number, number] => [el.offsetLeft, el.offsetTop]
/**
 * Slides the children of `ref` that match `selector` (default: direct children with `data-flip`, keyed by its value)
 * from their old place to their new one whenever the list changes (added, removed or reordered nodes), so items move
 * instead of jumping. Off for reduced motion and for lists longer than `max`.
 */
export function useFlip(ref: RefObject<HTMLElement | null>, { selector = ':scope > [data-flip]', max = 200, transition = MOTION.layout }: { selector?: string; max?: number; transition?: SpringOptions } = {}) {
  const t = useRef(transition)
  useLayoutEffect(() => { t.current = transition })
  useLayoutEffect(() => {
    const box = ref.current
    if (!box || typeof MutationObserver === 'undefined') return
    const els = () => [...box.querySelectorAll<HTMLElement>(selector)]
    const snap = () => new Map(els().map(el => [el.dataset.flip ?? '', flipOffset(el)]))
    let last = snap()
    const run = () => {
      const list = els(), prev = last
      last = new Map(list.map(el => [el.dataset.flip ?? '', flipOffset(el)]))
      if (list.length > max || prefersReducedMotion()) return
      for (const el of list) {
        const from = prev.get(el.dataset.flip ?? ''), to = last.get(el.dataset.flip ?? '')!
        if (!from) continue
        // a move that interrupts another one starts from where the node is drawn right now
        const cur = el.getAnimations?.().find(a => a.id === 'ui-flip')
        const m = cur ? new DOMMatrixReadOnly(getComputedStyle(el).transform) : null
        cur?.cancel()
        const dx = from[0] - to[0] + (m?.m41 ?? 0), dy = from[1] - to[1] + (m?.m42 ?? 0)
        if (Math.abs(dx) < 1 && Math.abs(dy) < 1) continue
        const a = motionAnimate(el, [{ transform: `translate(${dx}px,${dy}px)` }, { transform: 'none' }], t.current)
        if (a) a.id = 'ui-flip'
      }
    }
    const mo = new MutationObserver(run)
    mo.observe(box, { childList: true, subtree: true, attributeFilter: ['data-ui-exit'] })
    const ro = new ResizeObserver(() => { last = snap() })
    ro.observe(box)
    return () => { mo.disconnect(); ro.disconnect() }
  }, [ref, selector, max])
}

const indicatorRects = uiShared('active-indicator', () => new Map<string, { rect: DOMRect; at: number }>())
/**
 * The sliding highlight shared by SegmentedControl, Tabs, NavList, pricing toggles...
 * Render it inside the active item; when the active item changes it slides (and resizes) from the old item to the new
 * one in the same `group` (unique per widget). Positioned `absolute inset-0`; style it with `className`.
 */
export function ActiveIndicator({ group, className }: { group: string; className?: string }) {
  const ref = useRef<HTMLSpanElement>(null)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const prev = indicatorRects.get(group)
    indicatorRects.delete(group)
    // only a hand-over in the same commit counts: an indicator that went away earlier (a closed menu) doesn't fly in
    if (prev && performance.now() - prev.at < 100 && !prefersReducedMotion()) {
      const a = prev.rect, b = el.getBoundingClientRect()
      if (Math.abs(a.left - b.left) + Math.abs(a.top - b.top) + Math.abs(a.width - b.width) + Math.abs(a.height - b.height) > 1)
        motionAnimate(el, [
          { transform: `translate(${a.left - b.left}px,${a.top - b.top}px)`, width: `${a.width}px`, height: `${a.height}px` },
          { transform: 'none', width: `${b.width}px`, height: `${b.height}px` },
        ], spring(0.2, 0.45))
    }
    return () => { if (el.isConnected) indicatorRects.set(group, { rect: el.getBoundingClientRect(), at: performance.now() }) }
  }, [group])
  return <span ref={ref} aria-hidden className={cn('absolute inset-0', className)} />
}

/** useFrameLoop options: `maxDt` caps dt (s, default 0.05); `fps` caps the rate; `coarseFps` caps it on touch screens (pointer: coarse). */
export type FrameLoopOptions = { maxDt?: number; fps?: number; coarseFps?: number }
/** The rate a frame loop runs at: `fps`, lowered to `coarseFps` on coarse pointers (phones, tablets); 0 means every frame. */
export const frameLoopFps = ({ fps = 0, coarseFps = 0 }: FrameLoopOptions, coarse: boolean) => {
  const c = coarse && coarseFps > 0 ? coarseFps : 0
  return fps > 0 && c > 0 ? Math.min(fps, c) : fps || c
}
/**
 * Runs `cb(dt, now)` every animation frame while `active` (dt in seconds, capped at `maxDt`, 50 ms by default). Pass
 * `active = visible && running`, so the loop stops off screen and when there is nothing to animate. `{ fps }` caps the
 * rate (frames are skipped; dt covers the time since the last run); `{ coarseFps: 30 }` caps it on touch screens only,
 * where a busy canvas at 60 fps costs a phone twice the CPU for little visible gain. The third argument may also be
 * `maxDt` as a number.
 */
export function useFrameLoop(active: boolean, cb: (dt: number, now: number) => void, options: number | FrameLoopOptions = {}) {
  const fn = useRef(cb)
  useLayoutEffect(() => { fn.current = cb })
  const o = typeof options === 'number' ? { maxDt: options } : options
  const maxDt = o.maxDt ?? 0.05, fps = o.fps ?? 0, coarseFps = o.coarseFps ?? 0
  useEffect(() => {
    if (!active) return
    const rate = frameLoopFps({ fps, coarseFps }, isCoarsePointer())
    // a little under the period, so 30 fps on a 60 Hz screen is every other frame, not drifting to every third
    const gap = rate > 0 ? 1000 / rate - 4 : 0
    let raf = 0, timer = 0, last = performance.now()
    const step = (now: number) => {
      if (now - last < gap) { raf = requestAnimationFrame(step); return }
      const dt = Math.min(maxDt, (now - last) / 1000); last = now; fn.current(dt, now)
      // capped: ask for the next frame only shortly before it is due, so the frames in between don't run the page's
      // rendering steps for nothing (a pending requestAnimationFrame makes every frame a full one)
      const wait = gap > 0 ? now + gap - 8 - performance.now() : 0
      if (wait > 1) timer = window.setTimeout(() => { timer = 0; raf = requestAnimationFrame(step) }, wait)
      else raf = requestAnimationFrame(step)
    }
    raf = requestAnimationFrame(step)
    return () => { cancelAnimationFrame(raf); clearTimeout(timer) }
  }, [active, maxDt, fps, coarseFps])
}

/** A number, or arrays/objects of numbers, that useTween can interpolate. */
export type Tweenable = number | readonly Tweenable[] | { readonly [k: string]: Tweenable }
/** Same shape (every array the same length, same keys)? Only then can one tween into the other. */
const tweenSameShape = (a: unknown, b: unknown): boolean =>
  typeof b === 'number' ? typeof a === 'number'
    : Array.isArray(b) ? Array.isArray(a) && a.length === b.length && b.every((x, i) => tweenSameShape(a[i], x))
      : b && typeof b === 'object' ? !!a && typeof a === 'object' && !Array.isArray(a) && Object.keys(b).every(k => tweenSameShape((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]))
        : true
const tweenLerp = (a: unknown, b: unknown, u: number): unknown =>
  typeof b === 'number' ? (typeof a === 'number' && Number.isFinite(a) ? a + (b - a) * u : b)
    : Array.isArray(b) ? b.map((x, i) => tweenLerp(Array.isArray(a) ? a[i] : undefined, x, u))
      : b && typeof b === 'object' ? Object.fromEntries(Object.entries(b).map(([k, v]) => [k, tweenLerp(a && typeof a === 'object' ? (a as Record<string, unknown>)[k] : undefined, v, u)]))
        : b
/**
 * Tween every number inside a (nested) value towards `target` with an ease-out, re-rendering each frame, so shapes morph
 * instead of jumping. When the shape changes (rows added or removed) it snaps to the new value in the same render, so
 * indexes never point past the end. Reduced motion snaps too. Memoise `target`.
 */
export function useTween<T extends Tweenable>(target: T, ms = 650): T {
  const reduce = useReducedMotion()
  const [v, setV] = useState(target)
  const cur = useRef(target)
  const snap = reduce || !tweenSameShape(cur.current, target)
  useEffect(() => {
    if (snap) { cur.current = target; setV(target); return }
    const from = cur.current, t0 = performance.now()
    let raf = 0
    const step = (now: number) => {
      const u = Math.min(1, (now - t0) / ms), e = 1 - (1 - u) ** 3
      const x = (u === 1 ? target : tweenLerp(from, target, e)) as T
      cur.current = x; setV(x)
      if (u < 1) raf = requestAnimationFrame(step)
    }
    raf = requestAnimationFrame(step)
    return () => cancelAnimationFrame(raf)
  }, [target, ms, snap])
  return snap ? target : v
}

/** What play() can animate: px offsets, scale, rotation (deg) and opacity, each a list of keyframes. */
export type PlayKeyframes = { x?: readonly number[]; y?: readonly number[]; scale?: readonly number[]; rotate?: readonly number[]; opacity?: readonly number[] }
/** How play() runs: a spring(bounce, duration), or a `duration` (s) with an easing name or cubic-bezier array; `delay` in s. */
export type PlayOptions = (SpringOptions | { duration?: number; ease?: 'linear' | 'easeIn' | 'easeOut' | 'easeInOut' | readonly [number, number, number, number] }) & { delay?: number }
const PLAY_EASE = { linear: 'linear', easeIn: 'ease-in', easeOut: 'ease-out', easeInOut: 'ease-in-out' } as const

/** Fire-and-forget animation that replays on every call: play(el, { scale: [0.8, 1] }, spring(0.5, 0.3)). Does nothing for reduced motion. */
export function play(el: Element | null | undefined, keyframes: PlayKeyframes, options: PlayOptions = MOTION.panel) {
  if (!el || prefersReducedMotion()) return undefined
  const n = Math.max(...Object.values(keyframes).map(k => k?.length ?? 0))
  const at = (k: readonly number[] | undefined, i: number, d: number) => (k?.length ? k[Math.min(i, k.length - 1)] : d)
  const { x, y, scale, rotate, opacity } = keyframes
  const frames = Array.from({ length: n }, (_, i): Keyframe => ({
    transform: `translate(${at(x, i, 0)}px,${at(y, i, 0)}px) scale(${at(scale, i, 1)}) rotate(${at(rotate, i, 0)}deg)`,
    ...(opacity ? { opacity: at(opacity, i, 1) } : {}),
  }))
  if ('type' in options) return motionAnimate(el, frames, options, options.delay)
  const e = options.ease ?? 'easeOut'
  return motionAnimate(el, frames, { duration: options.duration ?? 0.3, easing: typeof e === 'string' ? PLAY_EASE[e] : `cubic-bezier(${e.join(',')})` }, options.delay)
}
/** Sideways "no" wiggle (wrong code, empty submit, at a limit). `px` is the travel. Does nothing for reduced motion. */
export const shake = (el: Element | null | undefined, px = 6) => play(el, { x: [0, -px, px, -px / 2, px / 2, 0] }, { duration: 0.35 })

/**
 * Fades and slides its children up the first time they scroll into view. Reduced-motion users get
 * the content straight away. `delay` staggers siblings; `y` sets the travel (default 14px).
 */
export function Reveal({ children, delay = 0, y = 14, amount = 0.15, className, style, ...p }:
  HTMLAttributes<HTMLDivElement> & { delay?: number; y?: number; amount?: number }) {
  const ref = useRef<HTMLDivElement>(null)
  const seen = useInView(ref, { amount, once: true })
  return (
    <div ref={ref} {...p} data-reveal="" className={cn(seen && 'ui-in', className)}
      style={{ '--ui-y': `${y}px`, '--ui-d': '.45s', '--ui-e': 'var(--ui-ease-out)', '--ui-delay': `${delay}s`, ...style } as CSSProperties}>
      {children}
    </div>
  )
}

/** A transition for motion (or play): a spring(bounce, duration), or `duration` with the library's ease-out. */
export type MotionTransition = SpringOptions | { duration: number; ease: typeof EASE_OUT }
/** The transition for a spring or an ease: a spring(bounce, duration), or `duration` with the library's ease-out. */
export function motionTransition(type: 'spring' | 'ease', bounce: number, duration: number): MotionTransition {
  return type === 'spring' ? spring(bounce, duration) : { duration, ease: EASE_OUT }
}

/**
 * Wheel zoom on `ref`: `onZoom(zoomIn, event)` per wheel step, with the page scroll prevented (a non-passive listener).
 * `modifier`: only while Ctrl or ⌘ is held (trackpad pinch), so a plain wheel still scrolls the page.
 */
export function useWheelZoom(ref: RefObject<HTMLElement | null> | undefined, onZoom: (zoomIn: boolean, e: WheelEvent) => void, { modifier = false, enabled = true }: { modifier?: boolean; enabled?: boolean } = {}) {
  const fn = useRef(onZoom)
  useLayoutEffect(() => { fn.current = onZoom })
  useEffect(() => {
    const el = ref?.current; if (!el || !enabled) return
    const on = (e: WheelEvent) => { if (modifier && !e.ctrlKey && !e.metaKey) return; e.preventDefault(); fn.current(e.deltaY < 0, e) }
    el.addEventListener('wheel', on, { passive: false })
    return () => el.removeEventListener('wheel', on)
  }, [ref, modifier, enabled])
}

/** What a pan reports: distance from where it started, whether it moved more than a few px, and the event. */
export type PinchPanMove = { dx: number; dy: number; moved: boolean; event: RPointerEvent }
/**
 * Two-finger pinch zoom plus one-pointer pan for a zoomable surface (lightbox, cropper). Spread `bind` on the element
 * (give it `touch-none`). A second finger starts a pinch from `getZoom()`; `onZoom(z)` gets the new zoom, clamped to
 * [min, max]. One pointer pans: `onPanStart(e)` may return false to ignore that press, then `onPan` / `onPanEnd` report
 * the distance. `wheel` (the element's ref) also zooms by `wheelStep` per notch. The pointer is captured.
 */
export function usePinchPan({ getZoom, onZoom, min = 1, max = 4, onPinchStart, onPinchEnd, onPanStart, onPan, onPanEnd, onCancel, wheel, wheelStep = 0.15 }: {
  getZoom: () => number; onZoom: (z: number) => void; min?: number; max?: number
  onPinchStart?: () => void; onPinchEnd?: () => void
  onPanStart?: (e: RPointerEvent) => boolean | void; onPan?: (m: PinchPanMove) => void; onPanEnd?: (m: PinchPanMove) => void; onCancel?: () => void
  wheel?: RefObject<HTMLElement | null>; wheelStep?: number }) {
  const fns = useRef({ getZoom, onZoom, onPinchStart, onPinchEnd, onPanStart, onPan, onPanEnd, onCancel, min, max, wheelStep })
  useLayoutEffect(() => { fns.current = { getZoom, onZoom, onPinchStart, onPinchEnd, onPanStart, onPan, onPanEnd, onCancel, min, max, wheelStep } })
  const pts = useRef(new Map<number, { x: number; y: number }>())
  const pinch = useRef<{ d: number; z: number } | null>(null), pan = useRef<{ x: number; y: number; moved: boolean } | null>(null)
  useWheelZoom(wheel, zoomIn => { const f = fns.current, s = 1 + f.wheelStep; f.onZoom(clamp(f.getZoom() * (zoomIn ? s : 1 / s), f.min, f.max)) }, { enabled: !!wheel })
  const dist = () => { const [a, b] = [...pts.current.values()]; return Math.hypot(a.x - b.x, a.y - b.y) }
  const move = (e: RPointerEvent): PinchPanMove => { const p = pan.current!, dx = e.clientX - p.x, dy = e.clientY - p.y; if (Math.abs(dx) + Math.abs(dy) > 4) p.moved = true; return { dx, dy, moved: p.moved, event: e } }
  const bind = {
    onPointerDown: (e: RPointerEvent) => {
      pts.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
      try { e.currentTarget.setPointerCapture(e.pointerId) } catch { /* pointer already gone */ }
      if (pts.current.size === 2) { pinch.current = { d: dist() || 1, z: fns.current.getZoom() }; pan.current = null; fns.current.onPinchStart?.(); return }
      if (pts.current.size > 2 || fns.current.onPanStart?.(e) === false) return
      pan.current = { x: e.clientX, y: e.clientY, moved: false }
    },
    onPointerMove: (e: RPointerEvent) => {
      if (!pts.current.has(e.pointerId)) return
      pts.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
      const pz = pinch.current, f = fns.current
      if (pz && pts.current.size >= 2) { f.onZoom(clamp(pz.z * dist() / pz.d, f.min, f.max)); return }
      if (pan.current) f.onPan?.(move(e))
    },
    onPointerUp: (e: RPointerEvent) => {
      pts.current.delete(e.pointerId)
      if (pinch.current) { if (pts.current.size < 2) { pinch.current = null; fns.current.onPinchEnd?.() } return }
      if (pan.current) { const m = move(e); pan.current = null; fns.current.onPanEnd?.(m) }
    },
    onPointerCancel: (e: RPointerEvent) => { pts.current.delete(e.pointerId); pinch.current = null; pan.current = null; fns.current.onCancel?.() },
    // capture taken away without a pointerup (the element moved, another capture): drop the pointer, or the next press reads as a pinch
    onLostPointerCapture: (e: RPointerEvent) => { if (pts.current.has(e.pointerId)) bind.onPointerCancel(e) },
  }
  return { bind, pinching: () => pinch.current !== null }
}
