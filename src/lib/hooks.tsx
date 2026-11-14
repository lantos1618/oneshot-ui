/** State and DOM hooks: controllable state, outside clicks, presence and in-view (for the CSS animations), an active index, flashes, a live region, sizes, media queries, touch, pointer drag, long press, hotkeys, focus trap, roving focus, scroll edges, clocks, debouncing, object URLs, canvas sizing. Part of @lyndon/ui/core. */
import { type Context, type CSSProperties, type FocusEvent as ReactFocusEvent, type ReactNode, type PointerEvent as ReactPointerEvent, type RefObject, type KeyboardEvent as RKeyboardEvent, useCallback, useEffect, useContext, useId, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { clamp, focusables, seededRandom } from './helpers'
import { uiShared } from './shared'

/** Controlled-or-uncontrolled state, the pattern every input here uses: `[value, set, reset]` (reset returns to the latest `defaultValue`, e.g. on a form reset). */
export function useControllable<T>(value: T | undefined, defaultValue: T, onChange?: (v: T) => void) {
  const [inner, setInner] = useState(defaultValue)
  const controlled = value !== undefined
  const def = useRef(defaultValue)
  useLayoutEffect(() => { def.current = defaultValue })
  const set = useCallback((v: T) => { if (!controlled) setInner(v); onChange?.(v) }, [controlled, onChange])
  const reset = useCallback(() => setInner(def.current), [])
  return [controlled ? value : inner, set, reset] as const
}

/**
 * While `enabled`, call `handler` on a pointerdown outside every ref'd element, and on Escape with `escape: true`.
 * `keep(target)` returning true ignores that press (e.g. a trigger that lives elsewhere). Tap-away for popovers and highlights.
 */
export function useOutside(refs: RefObject<Element | null>[], handler: (e: PointerEvent | KeyboardEvent) => void, enabled = true,
  { escape = false, keep }: { escape?: boolean; keep?: (target: Element) => boolean } = {}) {
  const h = useRef({ handler, keep, refs })
  useLayoutEffect(() => { h.current = { handler, keep, refs } })
  useEffect(() => {
    if (!enabled) return
    const down = (e: PointerEvent) => {
      const t = e.target as Node
      if (h.current.refs.some(r => r.current?.contains(t))) return
      if (t instanceof Element && h.current.keep?.(t)) return
      h.current.handler(e)
    }
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') h.current.handler(e) }
    document.addEventListener('pointerdown', down, true)
    if (escape) document.addEventListener('keydown', key)
    return () => { document.removeEventListener('pointerdown', down, true); document.removeEventListener('keydown', key) }
  }, [enabled, escape])
}

/** Open state for a floating panel that closes on outside click: { open, setOpen, ref } (put ref on the wrapper). */
export function useDisclosure(initial = false) {
  const [open, setOpen] = useState(initial)
  const ref = useRef<HTMLDivElement>(null)
  useOutside([ref], () => setOpen(false), open)
  return { open, setOpen, ref }
}

/** An element's content box (inside padding, border and scrollbar; CSS transforms ignored), the size ResizeObserver reports. */
export function contentSize(el: Element): { width: number; height: number } {
  const cs = getComputedStyle(el), px = (k: string) => parseFloat(cs.getPropertyValue(k)) || 0
  return { width: Math.max(0, el.clientWidth - px('padding-left') - px('padding-right')), height: Math.max(0, el.clientHeight - px('padding-top') - px('padding-bottom')) }
}

/**
 * Watch the element in `ref` with a ResizeObserver: `onResize(el)` runs now and on every size change. A target that
 * remounts (a new element in the same ref) is picked up on the next render; `deps` force a re-subscribe.
 */
export function useResizeObserver<T extends Element>(ref: RefObject<T | null>, onResize: (el: T) => void, deps: readonly unknown[] = []) {
  const cb = useRef(onResize)
  useLayoutEffect(() => { cb.current = onResize })
  const watched = useRef<{ el: T; ro: ResizeObserver | null; deps: readonly unknown[] } | null>(null)
  useLayoutEffect(() => {
    const el = ref.current, w = watched.current
    if (w && w.el === el && w.deps.length === deps.length && w.deps.every((d, i) => Object.is(d, deps[i]))) return
    w?.ro?.disconnect(); watched.current = null
    if (!el) return
    const run = () => cb.current(el)
    const ro = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(run)
    ro?.observe(el); watched.current = { el, ro, deps }
    run()
  })
  useEffect(() => () => { watched.current?.ro?.disconnect(); watched.current = null }, [])
}

/**
 * Content-box size of an element, kept up to date: `const [ref, { width, height }] = useElementSize<HTMLDivElement>()`.
 * The first value is read before paint and later ones come from ResizeObserver, both as the content box (padding
 * excluded), so nothing jumps between them. A remounted element is picked up.
 */
export function useElementSize<T extends Element>() {
  const ref = useRef<T>(null)
  const [size, setSize] = useState({ width: 0, height: 0 })
  useResizeObserver(ref, el => {
    const n = contentSize(el)
    setSize(s => s.width === n.width && s.height === n.height ? s : n)
  })
  return [ref, size] as const
}

/** Content-box size of an element (see useElementSize): const [ref, { width, height }] = useSize<HTMLDivElement>(). */
export const useSize = <T extends HTMLElement>() => useElementSize<T>()

/** Content-box width of an element (see useElementSize). Charts use it to stay responsive. */
export function useWidth<T extends HTMLElement>() {
  const [ref, size] = useElementSize<T>()
  return [ref, size.width] as const
}

const mqSubscribe = (q: string) => (cb: () => void) => { const m = matchMedia(q); m.addEventListener('change', cb); return () => m.removeEventListener('change', cb) }

const mqNow = (q: string) => typeof matchMedia !== 'undefined' && matchMedia(q).matches

/** The reduced-motion media query. */
export const REDUCED_MOTION_Q = '(prefers-reduced-motion: reduce)'

/** Live result of a media query, e.g. useMediaQuery('(max-width: 639px)') or useMediaQuery('(pointer: coarse)'). False on the server. */
export function useMediaQuery(query: string) {
  const sub = useMemo(() => mqSubscribe(query), [query])
  return useSyncExternalStore(sub, () => mqNow(query), () => false)
}

/** True on touch-first devices (coarse pointer): grow hit areas, skip hover-only affordances. */
export const useCoarsePointer = () => useMediaQuery('(pointer: coarse)')

/** Has the user asked for reduced motion? A plain call for event handlers and effects (false on the server). */
export const prefersReducedMotion = () => mqNow(REDUCED_MOTION_Q)

/** Live "reduce motion" preference (false on the server). Pair with the CSS, which already tones the `ui-*` animations down. */
export const useReducedMotion = () => useMediaQuery(REDUCED_MOTION_Q)

type InViewEntry = (visible: boolean) => void
const inViewObservers = uiShared('in-view', () => new Map<string, { io: IntersectionObserver; cbs: WeakMap<Element, InViewEntry>; of: typeof IntersectionObserver }>())
/**
 * True while at least `amount` (0…1) of `ref` is inside the viewport grown by `margin` (CSS margin syntax, '64px').
 * `once` keeps it true after the first time. Elements with the same options share one IntersectionObserver. True when
 * the browser has no IntersectionObserver; false on the server.
 */
export function useInView(ref: RefObject<Element | null>, { margin = '0px', amount = 0, once = false }: { margin?: string; amount?: number; once?: boolean } = {}) {
  const [inView, setInView] = useState(false)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    if (typeof IntersectionObserver === 'undefined') { setInView(true); return }
    const key = `${margin}|${amount}`
    let o = inViewObservers.get(key)
    if (o?.of !== IntersectionObserver) {
      const cbs = new WeakMap<Element, InViewEntry>()
      const io = new IntersectionObserver(es => es.forEach(e => cbs.get(e.target)?.(e.isIntersecting && e.intersectionRatio >= amount)), { rootMargin: margin, threshold: amount })
      inViewObservers.set(key, o = { io, cbs, of: IntersectionObserver })
    }
    const obs = o
    const stop = () => { obs.cbs.delete(el); obs.io.unobserve(el) }
    obs.cbs.set(el, v => { setInView(v); if (v && once) stop() })
    obs.io.observe(el)
    return stop
  }, [ref, margin, amount, once])
  return inView
}

/**
 * `animation-play-state` for infinite CSS animations (spinners, shimmer, bobbing): paused while the element is off
 * screen. Spread `style` and attach `ref`; `--ui-play` reaches `::after` animations and children that read it.
 */
export function usePlayState<T extends Element>() {
  const ref = useRef<T>(null)
  const play = useInView(ref, { margin: '64px' }) ? 'running' : 'paused'
  return { ref, style: { animationPlayState: play, '--ui-play': play } as CSSProperties }
}

/**
 * Calls `done` once the finite animations on `el` and its subtree have finished (at most `maxMs` later), or right away
 * when there are none: no element, no Web Animations API, reduced motion off in CSS. Returns a cancel function.
 */
export function whenAnimationsDone(el: Element | null | undefined, done: () => void, maxMs = 700): () => void {
  const anims = el?.getAnimations?.({ subtree: true }).filter(a => Number.isFinite(a.effect?.getComputedTiming().endTime)) ?? []
  if (!anims.length) { done(); return () => {} }
  let live = true
  const finish = () => { if (live) { live = false; clearTimeout(t); done() } }
  const t = setTimeout(finish, maxMs)
  Promise.allSettled(anims.map(a => a.finished)).then(finish)
  return () => { live = false; clearTimeout(t) }
}

/**
 * Mount and unmount with an exit animation: `mounted` stays true after `show` turns false until the animations on `ref`
 * finish, with `exiting` true meanwhile (spread `presenceProps(p)` on the element so the `ui-out` keyframes play).
 * `enter` is false for an element that was already shown on the first render (unless `appear`), so it can skip its
 * entrance. Showing it again during the exit cancels the exit.
 */
export function usePresence<T extends Element = HTMLElement>(show: boolean, { appear = false }: { appear?: boolean } = {}) {
  const ref = useRef<T>(null)
  const [state, setState] = useState({ mounted: show, enter: appear })
  if (show && !state.mounted) setState({ mounted: true, enter: true })
  const exiting = state.mounted && !show
  useLayoutEffect(() => exiting ? whenAnimationsDone(ref.current, () => setState(s => ({ ...s, mounted: false }))) : undefined, [exiting])
  return { ref, mounted: show || state.mounted, exiting, enter: state.enter }
}

/** Data attributes for a node under usePresence: `data-ui-exit` (plus inert, aria-hidden) while leaving, `data-ui-still` when it skips its entrance. */
export const presenceProps = ({ exiting, enter }: { exiting: boolean; enter: boolean }) =>
  exiting ? { 'data-ui-exit': '', inert: true, 'aria-hidden': true } as const : enter ? undefined : { 'data-ui-still': '' } as const

/** Is the primary pointer coarse (touch)? A plain call for event handlers and effects; in render use useCoarsePointer. */
export const isCoarsePointer = () => mqNow('(pointer: coarse)')

/** True when a pointer event came from a finger. */
export const isTouch = (e: { pointerType?: string }) => e.pointerType === 'touch'

/** A pointerleave handler that ignores touch, so the leave a lifted finger fires doesn't undo what the tap showed. */
export const onMouseLeave = (fn: (e: ReactPointerEvent) => void) => (e: ReactPointerEvent) => { if (!isTouch(e)) fn(e) }

/**
 * The active item of a widget with `count` items (a chart point, a hovered row): `[index | null, set, leave]`. The index
 * is null when out of range (the data shrank); Escape, a tap outside `ref` and the mouse leaving (spread `leave` on the
 * box) clear it. Pass a predicate instead of a count for other shapes (`([r, c]) => r < rows && c < cols`).
 */
export function useActiveIndex<T = number>(count: number | ((v: T) => boolean), ref: RefObject<Element | null>) {
  const [raw, set] = useState<T | null>(null)
  const ok = typeof count === 'number' ? (v: T) => (v as number) >= 0 && (v as number) < count : count
  const active = raw !== null && ok(raw) ? raw : null
  useOutside([ref], () => set(null), active !== null, { escape: true })
  const leave = { onPointerLeave: onMouseLeave(() => set(null)) }
  return [active, set, leave] as const
}

/** How long transient feedback (Copied, Saved, a highlighted row) stays before it clears, in ms. */
export const FLASH_MS = 1500

/**
 * A value that falls back to `idle` after `ms`: `const [copied, flash] = useFlash<string | null>(FLASH_MS, null)`, then
 * `flash(row.id)`. A new flash restarts the timer; the timer is cleared on unmount.
 */
export function useFlash<T>(ms: number = FLASH_MS, idle: T) {
  const [value, setValue] = useState<T>(idle)
  const t = useRef<ReturnType<typeof setTimeout>>(undefined)
  const idleRef = useRef(idle)
  useLayoutEffect(() => { idleRef.current = idle })
  useEffect(() => () => clearTimeout(t.current), [])
  const flash = useCallback((v: T) => { clearTimeout(t.current); setValue(v); t.current = setTimeout(() => setValue(idleRef.current), ms) }, [ms])
  return [value, flash] as const
}

/** A short-lived result for feedback on a button (Copied / Couldn’t copy): `flash(ok)` shows 'ok' or 'fail' for `ms`, then ''. */
export function useStatusFlash(ms = FLASH_MS) {
  const [status, set] = useFlash<'' | 'ok' | 'fail'>(ms, '')
  const flash = useCallback((ok: boolean) => set(ok ? 'ok' : 'fail'), [set])
  return [status, flash] as const
}

/**
 * A live region: `const [say, live] = useLive()`; render `live` once and call `say(text)` to announce. Saying the same
 * text again announces it again. `politeness` 'assertive' interrupts; `debounce` (ms) announces only the last of a burst.
 */
export function useLive({ politeness = 'polite', debounce = 0 }: { politeness?: 'polite' | 'assertive'; debounce?: number } = {}) {
  const [msg, setMsg] = useState<[seq: number, text: string]>([0, ''])
  const t = useRef<ReturnType<typeof setTimeout>>(undefined)
  useEffect(() => () => clearTimeout(t.current), [])
  const say = useCallback((text: string) => {
    clearTimeout(t.current)
    const put = () => setMsg(([n]) => [n + 1, text])
    if (debounce > 0) t.current = setTimeout(put, debounce); else put()
  }, [debounce])
  const live: ReactNode = <span className="sr-only" aria-live={politeness} aria-atomic="true">{msg[1] && <span key={msg[0]}>{msg[1]}</span>}</span>
  return [say, live] as const
}

/** Capture `id` on `el` for a drag; false (instead of throwing) when the pointer is already gone or there is no element. */
export function capturePointer(el: Element | null | undefined, id: number): boolean {
  try { el?.setPointerCapture(id); return !!el } catch { return false }
}

/** Where a point falls along a track, 0…1: `axis` 'x' (default, left to right) or 'y' (bottom to top); `inset` px of padding at each end. 0 for a collapsed track. */
export function trackFraction(rect: { left: number; top: number; width: number; height: number }, x: number, y = 0, { axis = 'x', inset = 0 }: { axis?: 'x' | 'y'; inset?: number } = {}): number {
  const len = (axis === 'x' ? rect.width : rect.height) - inset * 2
  if (!(len > 0)) return 0
  return clamp(axis === 'x' ? (x - rect.left - inset) / len : (rect.top + rect.height - inset - y) / len, 0, 1)
}

/** Move slop: a press that travels more than this (px) is a drag or a scroll, not a tap or a hold. */
export const MOVE_SLOP = 8

/** How long a press must be held to count as a long-press (ms). */
export const HOLD_MS = 500

/**
 * A short vibration on touch devices (`ms`, default 8): skipped without a coarse pointer, without the Vibration API, or
 * before the user has interacted with the page (where browsers log an intervention instead).
 */
export function haptic(ms = 8) {
  if (typeof navigator === 'undefined' || !('vibrate' in navigator) || !isCoarsePointer()) return
  const ua = (navigator as Navigator & { userActivation?: { hasBeenActive: boolean } }).userActivation
  if (ua && !ua.hasBeenActive) return
  try { navigator.vibrate(ms) } catch { /* blocked */ }
}

/**
 * While `when()` is true, stop the page from scrolling under a touch drag on `ref` (a non-passive touchmove listener;
 * pointer events can't cancel scrolling). Pair with `touch-none` for gestures that start on the element itself.
 */
export function useTouchScrollLock(ref: RefObject<Element | null>, when: () => boolean) {
  const w = useRef(when)
  useLayoutEffect(() => { w.current = when })
  useEffect(() => {
    const el = ref.current; if (!el) return
    const on = (e: Event) => { if (w.current() && e.cancelable) e.preventDefault() }
    el.addEventListener('touchmove', on, { passive: false })
    return () => el.removeEventListener('touchmove', on)
  }, [ref])
}

/** On touch, drop the implicit pointer capture so a finger sliding across items enters each one, like a mouse. */
export const releaseTouchCapture = (e: ReactPointerEvent) => {
  const t = e.target as Element
  if (isTouch(e) && t.hasPointerCapture?.(e.pointerId)) t.releasePointerCapture(e.pointerId)
}

/** Where a drag is: pointer position, distance from where it started, and the native event. */
export type PointerDragState = { x: number; y: number; dx: number; dy: number; event: PointerEvent }

/**
 * One pointer drag with the failure cases handled: the pointer is captured, pointercancel or a lost capture ends it as
 * cancelled, a move with no button pressed ends it (released outside the window), and unmounting mid-drag tears it down.
 * Call `start(e)` from onPointerDown (optionally with the element to capture); `cursor` sets the page cursor and stops
 * text selection while dragging. Give the handle `touch-none` (or `touch-pan-y` for horizontal drags) so touch drags work.
 *   const drag = usePointerDrag({ onMove: p => setX(x0 + p.dx) }); <div onPointerDown={drag.start} className="touch-none" />
 */
export function usePointerDrag({ onStart, onMove, onEnd, cursor }: {
  onStart?: (p: PointerDragState) => void; onMove?: (p: PointerDragState) => void
  /** `cancelled` is true after pointercancel, lost capture, `cancel()` or unmount */ onEnd?: (p: PointerDragState, cancelled: boolean) => void
  cursor?: string }) {
  const fns = useRef({ onStart, onMove, onEnd, cursor })
  useLayoutEffect(() => { fns.current = { onStart, onMove, onEnd, cursor } })
  const stop = useRef<((cancelled: boolean) => void) | null>(null)
  const [dragging, setDragging] = useState(false)
  useEffect(() => () => stop.current?.(true), [])
  const start = useCallback((e: { pointerId: number; clientX: number; clientY: number; currentTarget?: EventTarget | null; nativeEvent?: Event }, capture?: Element | null) => {
    stop.current?.(true)
    const el = (capture ?? (e.currentTarget instanceof Element ? e.currentTarget : null))
    const id = e.pointerId, x0 = e.clientX, y0 = e.clientY
    let last: PointerDragState = { x: x0, y: y0, dx: 0, dy: 0, event: (e.nativeEvent ?? e) as PointerEvent }
    const at = (ev: PointerEvent): PointerDragState => ({ x: ev.clientX, y: ev.clientY, dx: ev.clientX - x0, dy: ev.clientY - y0, event: ev })
    capturePointer(el, id)
    const body = document.body, prev = [body.style.cursor, body.style.userSelect], cur = fns.current.cursor
    if (cur) { body.style.cursor = cur; body.style.userSelect = 'none' }
    const move = (ev: PointerEvent) => {
      if (ev.pointerId !== id) return
      if (ev.buttons === 0) { last = at(ev); return finish(false) } // the release happened where we couldn't see it
      last = at(ev); fns.current.onMove?.(last)
    }
    const up = (ev: PointerEvent) => { if (ev.pointerId === id) { last = at(ev); finish(false) } }
    const cancel = (ev: PointerEvent) => { if (ev.pointerId === id) finish(true) }
    const finish = (cancelled: boolean) => {
      if (stop.current !== finish) return
      stop.current = null
      removeEventListener('pointermove', move, true); removeEventListener('pointerup', up, true); removeEventListener('pointercancel', cancel, true)
      el?.removeEventListener('lostpointercapture', cancel as EventListener)
      try { if (el?.hasPointerCapture(id)) el.releasePointerCapture(id) } catch { /* already released */ }
      if (cur) { body.style.cursor = prev[0]; body.style.userSelect = prev[1] }
      setDragging(false); fns.current.onEnd?.(last, cancelled)
    }
    stop.current = finish
    addEventListener('pointermove', move, true); addEventListener('pointerup', up, true); addEventListener('pointercancel', cancel, true)
    el?.addEventListener('lostpointercapture', cancel as EventListener)
    setDragging(true); fns.current.onStart?.(last)
  }, [])
  const cancel = useCallback(() => stop.current?.(true), [])
  return { start, cancel, dragging }
}

/** After a long-press fires, the click that ends it arrives within this window (ms) and is swallowed. */
const LONG_PRESS_CLICK_GUARD_MS = 700

/**
 * Press and hold: `onPress` fires once the pointer has stayed down `ms` (default HOLD_MS) without moving more than `slop`
 * px (default MOVE_SLOP). Touch and pen only unless `mouse`. Spread `bind` on the element; the click that ends a long-press is swallowed.
 */
export function useLongPress({ ms = HOLD_MS, slop = MOVE_SLOP, mouse = false, onPress }:
  { ms?: number; slop?: number; mouse?: boolean; onPress: (p: { x: number; y: number; pointerId: number; pointerType: string; target: Element }) => void }) {
  const fn = useRef(onPress)
  useLayoutEffect(() => { fn.current = onPress })
  const press = useRef<{ t: ReturnType<typeof setTimeout>; x: number; y: number; id: number } | null>(null)
  const firedAt = useRef(0)
  const fired = () => Date.now() - firedAt.current < LONG_PRESS_CLICK_GUARD_MS
  const cancel = useCallback(() => { if (press.current) clearTimeout(press.current.t); press.current = null }, [])
  useEffect(() => cancel, [cancel])
  const bind = {
    onPointerDown: (e: ReactPointerEvent) => {
      if (e.pointerType === 'mouse' && (!mouse || e.button !== 0)) return
      cancel()
      const { clientX: x, clientY: y, pointerId, pointerType } = e, target = e.target as Element
      press.current = { x, y, id: pointerId, t: setTimeout(() => { press.current = null; firedAt.current = Date.now(); fn.current({ x, y, pointerId, pointerType, target }) }, ms) }
    },
    onPointerMove: (e: ReactPointerEvent) => { const p = press.current; if (p && p.id === e.pointerId && Math.hypot(e.clientX - p.x, e.clientY - p.y) > slop) cancel() },
    onPointerUp: cancel, onPointerCancel: cancel,
    onClickCapture: (e: React.MouseEvent) => { if (fired()) { firedAt.current = 0; e.preventDefault(); e.stopPropagation() } },
  }
  return { bind, cancel, /** true right after a long-press fired (use it to skip your own click logic) */ fired }
}

/** True when a key press on `t` is typing (a text field, select, contenteditable or textbox), so global shortcuts should leave it alone. */
export const isEditableTarget = (t: EventTarget | null) => t instanceof Element &&
  !!t.closest('input:not([type=checkbox],[type=radio],[type=range],[type=button],[type=submit],[type=reset],[type=color],[type=file]),textarea,select,[contenteditable="true"],[contenteditable=""],[role=textbox]')

const IS_MAC = () => typeof navigator !== 'undefined' && /Mac|iPhone|iPad|iPod/.test((navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData?.platform ?? navigator.platform ?? navigator.userAgent)
const HOTKEY_MAC: Record<string, string> = { mod: '⌘', meta: '⌘', ctrl: '⌃', alt: '⌥', shift: '⇧' }
const HOTKEY_PC: Record<string, string> = { mod: 'Ctrl', meta: 'Win', ctrl: 'Ctrl', alt: 'Alt', shift: 'Shift' }
const HOTKEY_KEYS: Record<string, string> = { escape: 'Esc', arrowup: '↑', arrowdown: '↓', arrowleft: '←', arrowright: '→', enter: '↵', backspace: '⌫', delete: 'Del', ' ': 'Space', space: 'Space' }

/**
 * A useHotkey combo as the user's platform writes it: formatHotkey('mod+shift+z') → "⌘⇧Z" on Apple devices, "Ctrl+Shift+Z"
 * elsewhere. Pass `mac` to choose (the server can't tell; it defaults to the non-Apple form there).
 */
export function formatHotkey(combo: string, mac = IS_MAC()): string {
  const parts = combo.split('+').map(p => p.trim()).filter(Boolean), key = parts.pop() ?? ''
  const k = HOTKEY_KEYS[key.toLowerCase()] ?? (key.length === 1 ? key.toUpperCase() : key[0].toUpperCase() + key.slice(1))
  const mods = parts.map(m => (mac ? HOTKEY_MAC : HOTKEY_PC)[m.toLowerCase()] ?? m)
  return mac ? mods.join('') + k : [...mods, k].join('+')
}

/**
 * Keyboard shortcut, e.g. useHotkey('mod+k', open), useHotkey('alt+shift+n', add) or useHotkey('?', help). `mod` is ⌘ on
 * Mac, Ctrl elsewhere; modifiers must match exactly. Presses typed into a text field are skipped when `ignoreEditable`
 * is on (the default for keys without mod/ctrl/meta/alt), and so are presses another handler already consumed.
 * The third argument is `enabled`, or { enabled, ignoreEditable }.
 */
export function useHotkey(combo: string, handler: (e: KeyboardEvent) => void, options: boolean | { enabled?: boolean; ignoreEditable?: boolean } = true) {
  const h = useRef(handler)
  useLayoutEffect(() => { h.current = handler })
  const { enabled = true, ignoreEditable } = typeof options === 'boolean' ? { enabled: options } : options
  useEffect(() => {
    if (!enabled) return
    const parts = combo.toLowerCase().split('+'), key = parts.pop()!
    const has = (m: string) => parts.includes(m)
    const skipFields = ignoreEditable ?? !(has('mod') || has('ctrl') || has('meta') || has('alt'))
    const symbol = key.length === 1 && !/[a-z0-9]/.test(key) // '?', '[': typing them may need Shift
    const on = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.isComposing || e.key?.toLowerCase() !== key) return
      const mod = has('mod') ? e.metaKey || e.ctrlKey : (has('ctrl') === e.ctrlKey && has('meta') === e.metaKey)
      const shift = has('shift') === e.shiftKey || (symbol && !has('shift'))
      if (!mod || !shift || has('alt') !== e.altKey) return
      if (skipFields && isEditableTarget(e.target)) return
      e.preventDefault(); h.current(e)
    }
    addEventListener('keydown', on)
    return () => removeEventListener('keydown', on)
  }, [combo, enabled, ignoreEditable])
}

/** Put on the element a focus trap or panel should focus when it opens. */
export const AUTOFOCUS_ATTR = 'data-autofocus'

/** Open focus traps, innermost last: only the top one handles Tab, so nested modals don't fight. Shared page-wide (uiShared). */
const coreTraps = uiShared('focus-traps', () => [] as RefObject<HTMLElement | null>[])

/**
 * Keep Tab focus inside `ref` while `active`: focuses `[data-autofocus]` (AUTOFOCUS_ATTR) or the first focusable on open, wraps Tab and
 * Shift+Tab at document level (so focus that slipped outside comes back), and restores the previous focus on close.
 * With nothing focusable inside it holds focus on the `[role=dialog]` (or first) element instead of letting Tab leave.
 * Nested traps stack: only the innermost one acts.
 */
export function useFocusTrap(ref: RefObject<HTMLElement | null>, active: boolean) {
  useEffect(() => {
    if (!active) return
    const prev = document.activeElement as HTMLElement | null
    coreTraps.push(ref)
    const holder = () => { // something to park focus on when there are no tab stops
      const el = ref.current?.querySelector<HTMLElement>('[role=dialog],[role=alertdialog]') ?? (ref.current?.firstElementChild as HTMLElement | null)
      if (el && !el.hasAttribute('tabindex')) el.tabIndex = -1
      return el
    }
    const raf = requestAnimationFrame(() => (ref.current?.querySelector<HTMLElement>(`[${AUTOFOCUS_ATTR}]`) ?? focusables(ref.current)[0] ?? holder())?.focus())
    const on = (e: KeyboardEvent) => {
      if (e.key !== 'Tab' || coreTraps[coreTraps.length - 1] !== ref || !ref.current) return
      const f = focusables(ref.current), a = document.activeElement
      if (!f.length) { e.preventDefault(); if (!ref.current.contains(a)) holder()?.focus(); return }
      const first = f[0], last = f[f.length - 1]
      if (e.shiftKey && (a === first || !ref.current.contains(a))) { e.preventDefault(); last.focus() }
      else if (!e.shiftKey && (a === last || !ref.current.contains(a))) { e.preventDefault(); first.focus() }
    }
    document.addEventListener('keydown', on)
    return () => {
      cancelAnimationFrame(raf); document.removeEventListener('keydown', on)
      const i = coreTraps.lastIndexOf(ref); if (i >= 0) coreTraps.splice(i, 1)
      queueMicrotask(() => prev?.focus?.()) // after the rest of the commit (e.g. a modal lifting `inert` off the page)
    }
  }, [active, ref])
}

/** Options for useRoving. */
export type RovingOptions = {
  /** wrap around at the ends (default true) */ loop?: boolean
  /** which arrows move: ↑↓ (default), ←→, or both */ orientation?: 'vertical' | 'horizontal' | 'both'
  /** items to skip */ isDisabled?: (i: number) => boolean
  /** Home/End jump to the first/last item (default true; turn off in text inputs) */ homeEnd?: boolean
  /** control the index yourself (e.g. the selected tab); otherwise it is internal state */ index?: number
  /** called with the new index after a key moved it: focus or select there */ onMove?: (i: number) => void
}

/**
 * Arrow-key roving index for lists, menus, tablists and toolbars: arrows move (skipping disabled items, along
 * the arrow keys of its orientation), Home/End jump, Enter calls `onEnter`. Third argument: `loop` (boolean) or RovingOptions. Safe with zero items.
 */
export function useRoving(count: number, onEnter: (i: number) => void, options: boolean | RovingOptions = true) {
  const { loop = true, orientation = 'vertical', isDisabled, homeEnd = true, index, onMove } = typeof options === 'boolean' ? { loop: options } as RovingOptions : options
  const [inner, setActive] = useState(0)
  const active = index ?? inner
  useEffect(() => { if (index === undefined && count > 0 && inner >= count) setActive(count - 1) }, [count, inner, index])
  const step = (from: number, d: number) => {
    for (let k = 1; k <= count; k++) {
      let n = from + d * k
      if (loop) n = ((n % count) + count) % count
      else if (n < 0 || n >= count) return -1
      if (!isDisabled?.(n)) return n
    }
    return -1
  }
  const go = (n: number) => { if (n < 0) return; if (index === undefined) setActive(n); onMove?.(n) }
  const onKeyDown = (e: RKeyboardEvent) => {
    if (!count) return
    const v = orientation !== 'horizontal', hz = orientation !== 'vertical', key = e.key
    const d = (v && key === 'ArrowDown') || (hz && key === 'ArrowRight') ? 1 : (v && key === 'ArrowUp') || (hz && key === 'ArrowLeft') ? -1 : 0
    if (d) { e.preventDefault(); go(step(Math.min(active, count - 1), d)) }
    else if (homeEnd && (e.key === 'Home' || e.key === 'End')) { e.preventDefault(); go(e.key === 'Home' ? step(-1, 1) : step(count, -1)) }
    else if (e.key === 'Enter' && !e.nativeEvent.isComposing) { e.preventDefault(); if (active < count && !isDisabled?.(active)) onEnter(active) }
  }
  return { active, setActive, onKeyDown }
}

/**
 * A field that opens a listbox (Select, Combobox, MultiSelect, the time and zone pickers), given its open state
 * (useDisclosure): the active option (useRoving, skipping disabled ones), the combobox's ARIA and its keys. Escape closes
 * the list without reaching a dialog around it and Tab closes it. `input`: a typing combobox, where any key opens the
 * list and arrows stop at the ends (Home/End stay with the caret). Otherwise a button that opens on ↓ ↑ Enter Space and
 * picks with Space. `show(true)` puts the active option on `selected` (else the first enabled one) before opening.
 */
export function useListbox(items: readonly { disabled?: boolean }[], onPick: (i: number) => void,
  { open, setOpen, input = false, selected, locked = false }: { open: boolean; setOpen: (open: boolean) => void; input?: boolean; selected?: number; locked?: boolean }) {
  const id = useId()
  const isDisabled = (i: number) => !!items[i]?.disabled
  const { active, setActive, onKeyDown: rove } = useRoving(items.length, onPick, { loop: !input, homeEnd: !input, isDisabled })
  const firstOn = () => Math.max(0, items.findIndex(x => !x.disabled))
  const show = (o: boolean) => {
    if (o && locked) return
    if (o && selected !== undefined) setActive(selected >= 0 ? selected : firstOn())
    else if (o && isDisabled(active)) setActive(firstOn())
    setOpen(o)
  }
  const onKeyDown = (e: RKeyboardEvent) => {
    if (e.key === 'Escape') { if (open) { e.stopPropagation(); setOpen(false) } return }
    if (e.key === 'Tab') return setOpen(false)
    if (input) { if (!open) setOpen(true); return rove(e) }
    if (!open) { if (['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(e.key)) { e.preventDefault(); show(true) } return }
    if (e.key === ' ') { e.preventDefault(); return onPick(active) }
    rove(e)
  }
  const comboProps = {
    role: 'combobox', 'aria-expanded': open, 'aria-controls': id, 'aria-activedescendant': open && items.length ? `${id}-${active}` : undefined,
    ...(input ? { 'aria-autocomplete': 'list' as const } : { 'aria-haspopup': 'listbox' as const }),
  }
  return { id, active, setActive, show, onKeyDown, comboProps }
}

/**
 * Watches a horizontal scroller: `left` / `right` say whether more content is hidden on that side;
 * `touched` turns true once it has been scrolled away from its start. Pair with `ScrollEdges` for fades and a "scroll for more" hint.
 */
export function useScrollEdges<T extends HTMLElement>() {
  const [el, ref] = useState<T | null>(null) // callback ref, so a remounted scroller is picked up
  const [edges, setEdges] = useState({ left: false, right: false, touched: false })
  useEffect(() => {
    if (!el) return
    const upd = () => setEdges(e => {
      const max = el.scrollWidth - el.clientWidth, x = el.scrollLeft
      const left = x > 2, right = x < max - 2, touched = e.touched || left
      return e.left === left && e.right === right && e.touched === touched ? e : { left, right, touched }
    })
    upd()
    el.addEventListener('scroll', upd, { passive: true })
    const ro = new ResizeObserver(upd); ro.observe(el); [...el.children].forEach(c => ro.observe(c))
    return () => { el.removeEventListener('scroll', upd); ro.disconnect() }
  }, [el])
  return [ref, edges] as const
}

/** Refocus an element by selector (inside `root`) after React re-renders (moved nodes lose focus). */
export function useRefocus(root: RefObject<HTMLElement | null>) {
  const pending = useRef<string | null>(null)
  useEffect(() => { if (pending.current) { root.current?.querySelector<HTMLElement>(pending.current)?.focus(); pending.current = null } })
  return (selector: string) => { pending.current = selector }
}

/** A context that needs its provider: the value, or an error saying `${part} must be inside ${where}`. */
export function useRequiredContext<T>(ctx: Context<T | null>, part: string, where: string): T {
  const c = useContext(ctx)
  if (!c) throw new Error(`${part} must be inside ${where}`)
  return c
}

/** False until `value` first differs from what it was on mount: gates one-shot animations that play on a change, never on mount. */
export function useChanged(value: unknown) {
  const [first] = useState(value), [changed, setChanged] = useState(false)
  if (!changed && !Object.is(value, first)) setChanged(true)
  return changed
}

/** `value`, kept in a ref that is updated after each render (in a layout effect, never during render): for handlers and effects that need the latest value without re-subscribing. */
export function useLatest<T>(value: T): { readonly current: T } {
  const ref = useRef(value)
  useLayoutEffect(() => { ref.current = value })
  return ref
}

/** Math.random, or the repeatable seededRandom(seed) stream when `seed` is given (a new stream when it changes). */
export function useRandom(seed?: number): () => number {
  return useMemo(() => (seed == null ? Math.random : seededRandom(seed)), [seed])
}

/**
 * Generation tokens for host callbacks that can't be aborted (save, vote and approval promises): `const current =
 * gen.next()` before the call, `if (!current()) return` after it. A later `next()`, `invalidate()` or unmount makes the
 * earlier call stale, so its late result is dropped.
 */
export function useGeneration() {
  const n = useRef(0)
  useEffect(() => () => { n.current++ }, [])
  return useMemo(() => ({
    next: () => { const g = ++n.current; return () => g === n.current },
    invalidate: () => { n.current++ },
  }), [])
}

/**
 * State plus a synchronous reader: `[value, set, get]`, where `get()` returns what was last set even before React
 * re-renders (for pointer and keyboard handlers that fire several times per frame).
 */
export function useLatestState<T>(initial: T | (() => T)) {
  const [value, setValue] = useState(initial)
  const ref = useRef(value)
  const set = useCallback((v: T | ((prev: T) => T)) => {
    const next = typeof v === 'function' ? (v as (prev: T) => T)(ref.current) : v
    ref.current = next; setValue(next)
  }, [])
  const get = useCallback(() => ref.current, [])
  return [value, set, get] as const
}

/** `value`, updated only after it has stopped changing for `ms`: `[debounced, flush]`, where flush() applies the latest at once. */
export function useDebounced<T>(value: T, ms: number) {
  const [v, setV] = useState(value)
  const latest = useLatest(value)
  useEffect(() => {
    if (Object.is(v, value)) return
    const t = setTimeout(() => setV(value), ms)
    return () => clearTimeout(t)
  }, [value, ms]) // eslint-disable-line react-hooks/exhaustive-deps
  const flush = useCallback(() => setV(latest.current), [latest])
  return [v, flush] as const
}

/**
 * The current time in ms, refreshed every `intervalMs` while `active` (0: read once). Null on the server and before
 * mount, so server and client markup match.
 */
export function useNow(intervalMs = 0, active = true): number | null {
  const [now, setNow] = useState<number | null>(null)
  useEffect(() => {
    setNow(Date.now())
    if (!active || intervalMs <= 0) return
    const t = setInterval(() => setNow(Date.now()), intervalMs)
    return () => clearInterval(t)
  }, [intervalMs, active])
  return now
}

/**
 * The value set of a single- or multiple-choice group (Accordion, ToggleGroup): `[values, toggle, set]`. Single mode
 * reports `''` for none and replaces on toggle; `clearable` (default true) lets a single item be toggled off.
 */
export function useValueSet({ multiple = false, value, defaultValue, onValueChange, clearable = true }:
  { multiple?: boolean; value?: string | string[]; defaultValue?: string | string[]; onValueChange?: (v: string | string[]) => void; clearable?: boolean }) {
  const toList = (v: string | string[] | undefined) => (v === undefined ? undefined : Array.isArray(v) ? v : v ? [v] : [])
  const emit = useCallback((v: string[]) => onValueChange?.(multiple ? v : v[0] ?? ''), [onValueChange, multiple])
  const [values, set] = useControllable<string[]>(toList(value), toList(defaultValue) ?? [], emit)
  const toggle = useCallback((v: string) => {
    const on = values.includes(v)
    if (multiple) set(on ? values.filter(x => x !== v) : [...values, v])
    else if (!on) set([v])
    else if (clearable) set([])
  }, [values, multiple, clearable, set])
  return [values, toggle, set] as const
}

/**
 * A typeahead buffer for lists and menus: `const type = useTypeahead()`; in onKeyDown, `type(e.key)` returns the text
 * typed so far (printable keys within `ms` of each other) or null for other keys. Feed it to typeaheadIndex.
 */
export function useTypeahead(ms = 700) {
  const buf = useRef({ text: '', at: 0 })
  return useCallback((key: string): string | null => {
    if (key.length !== 1 || (key === ' ' && !buf.current.text)) return null
    const now = Date.now(), b = buf.current
    b.text = now - b.at > ms ? key : b.text + key; b.at = now
    return b.text
  }, [ms])
}


/**
 * True when focus left for somewhere outside every container (a blur that should close a popup); false while it moves
 * into one of them (an option in the open list). Prevent mousedown on the options so a click doesn't blur first.
 */
export function blurLeaves(e: ReactFocusEvent | FocusEvent, ...containers: (Element | RefObject<Element | null> | null | undefined)[]): boolean {
  const to = e.relatedTarget as Node | null
  if (!to) return true
  return !containers.some(c => { const el = c && 'current' in c ? c.current : c; return !!el && el.contains(to) })
}

/**
 * Object URLs for files and blobs with one lifetime rule: `make(blob)` creates one, `revoke(url)` frees it,
 * `keepOnly(urls)` frees every other one, and all are freed on unmount.
 */
export function useObjectUrls() {
  const urls = useRef(new Set<string>())
  useEffect(() => { const u = urls.current; return () => { u.forEach(x => URL.revokeObjectURL(x)); u.clear() } }, [])
  return useMemo(() => ({
    make: (b: Blob): string | null => { try { const u = URL.createObjectURL(b); urls.current.add(u); return u } catch { return null } },
    revoke: (u: string) => { if (urls.current.delete(u)) URL.revokeObjectURL(u) },
    keepOnly: (keep: Iterable<string>) => { const k = new Set(keep); for (const u of [...urls.current]) if (!k.has(u)) { urls.current.delete(u); URL.revokeObjectURL(u) } },
  }), [])
}

/**
 * Size a canvas's backing store to its CSS size × device pixel ratio (capped at `maxDpr`, default 2) whenever it
 * resizes, then call `onSize({ w, h, dpr })` (CSS px) to redraw. Scale the context by `dpr` before drawing.
 */
export function useCanvasSize(ref: RefObject<HTMLCanvasElement | null>, onSize: (s: { w: number; h: number; dpr: number }) => void, { maxDpr = 2 }: { maxDpr?: number } = {}) {
  useResizeObserver(ref, c => {
    const { width: w, height: h } = contentSize(c), dpr = Math.min(maxDpr, (typeof devicePixelRatio === 'number' && devicePixelRatio) || 1)
    const bw = Math.round(w * dpr), bh = Math.round(h * dpr)
    if (c.width !== bw) c.width = bw
    if (c.height !== bh) c.height = bh
    onSize({ w, h, dpr })
  }, [maxDpr])
}

/**
 * Coalesce many updates into one commit per animation frame: `schedule()` asks for `commit` on the next frame (once),
 * `flush()` runs it now. Falls back to a 16 ms timer while the tab is hidden (no frames then); nothing runs after unmount.
 */
export function useFrameCommit(commit: () => void) {
  const fn = useLatest(commit)
  const pending = useRef<{ raf: number; timer: ReturnType<typeof setTimeout> | undefined } | null>(null)
  const alive = useRef(true)
  const cancel = () => { const p = pending.current; if (p) { cancelAnimationFrame(p.raf); clearTimeout(p.timer) } pending.current = null }
  useEffect(() => { alive.current = true; return () => { alive.current = false; cancel() } }, [])
  return useMemo(() => {
    const flush = () => { cancel(); if (alive.current) fn.current() }
    const schedule = () => {
      if (pending.current || !alive.current) return
      const hidden = typeof document !== 'undefined' && document.visibilityState === 'hidden'
      pending.current = { raf: hidden || typeof requestAnimationFrame === 'undefined' ? 0 : requestAnimationFrame(flush), timer: hidden || typeof requestAnimationFrame === 'undefined' ? setTimeout(flush, 16) : undefined }
    }
    return { schedule, flush }
  }, [fn])
}

/** The same array instance while its items are equal (Object.is), so it can be a stable effect or memo dependency. */
export function useStableArray<T>(arr: readonly T[]): readonly T[] {
  const ref = useRef(arr)
  const same = ref.current.length === arr.length && ref.current.every((x, i) => Object.is(x, arr[i]))
  useLayoutEffect(() => { if (!same) ref.current = arr })
  return same ? ref.current : arr
}
