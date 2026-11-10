import { useEffect, useLayoutEffect, useRef, useState, type PointerEvent as RPointerEvent, type ReactNode, type RefObject } from 'react'
import { type DOMKeyframesDefinition, type HTMLMotionProps, animate, motion, useInView, useReducedMotion, type Transition } from 'motion/react'
import { EASE_OUT, clamp, isCoarsePointer, prefersReducedMotion, spring } from './core'

type ViewportMargin = NonNullable<Parameters<typeof useInView>[1]>['margin']
/**
 * Where an element is relative to the viewport: `visible` while at least `amount` of it is on screen, `seen` once it has
 * been (and stays true). Pass your own ref or use the returned one: const { ref, seen, visible } = useViewport<HTMLDivElement>().
 * Start intros on `seen`; pause loops while not `visible`.
 */
export function useViewport<T extends Element = HTMLDivElement>(target?: RefObject<T | null> | null, { amount = 0.15, margin }: { amount?: number; margin?: ViewportMargin } = {}) {
  const own = useRef<T>(null)
  const ref = target ?? own
  const visible = useInView(ref, { amount, margin })
  const [seen, setSeen] = useState(false)
  useEffect(() => { if (visible) setSeen(true) }, [visible])
  return { ref, seen: seen || visible, visible }
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

/** Fire-and-forget animation that replays on every call: play(el, { scale: [0.8, 1] }, spring(0.5, 0.3)). Does nothing for reduced motion. */
export function play(el: Element | null | undefined, keyframes: DOMKeyframesDefinition, options?: Transition) {
  if (el && !prefersReducedMotion()) animate(el, keyframes, options)
}
/** Sideways "no" wiggle (wrong code, empty submit, at a limit). `px` is the travel. Does nothing for reduced motion. */
export const shake = (el: Element | null | undefined, px = 6) => play(el, { x: [0, -px, px, -px / 2, px / 2, 0] }, { duration: 0.35 })

/**
 * Fades and slides its children up the first time they scroll into view. Reduced-motion users get
 * the content straight away. `delay` staggers siblings; `y` sets the travel (default 14px).
 */
export function Reveal({ children, delay = 0, y = 14, amount = 0.15, ...p }:
  Omit<HTMLMotionProps<'div'>, 'children'> & { children?: ReactNode; delay?: number; y?: number; amount?: number }) {
  const reduce = useReducedMotion()
  return (
    <motion.div {...p}
      initial={reduce ? false : { opacity: 0, y }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true, amount }}
      transition={{ duration: 0.45, ease: EASE_OUT, delay }}>
      {children}
    </motion.div>
  )
}

/** The motion transition for a spring or an ease: a spring(bounce, duration), or `duration` with the library's ease-out. */
export function motionTransition(type: 'spring' | 'ease', bounce: number, duration: number): Transition {
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
