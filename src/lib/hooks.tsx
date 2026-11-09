/** State and DOM hooks: controllable state, outside clicks, sizes, media queries, touch, pointer drag, long press, hotkeys, focus trap, roving focus, streamed text, scroll edges. Part of @lyndon/ui/core. */
import { type PointerEvent as ReactPointerEvent, type RefObject, type KeyboardEvent as RKeyboardEvent, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { focusables } from './helpers'
import { logicalArrow, useDir } from './locale'
import { uiShared } from './shared'

/* State and DOM hooks ─────────────────────────────────────────────────────── */

/** Controlled-or-uncontrolled state, the pattern every input here uses. */
export function useControllable<T>(value: T | undefined, defaultValue: T, onChange?: (v: T) => void) {
  const [inner, setInner] = useState(defaultValue)
  const controlled = value !== undefined
  const current = controlled ? value : inner
  const set = useCallback((v: T) => { if (!controlled) setInner(v); onChange?.(v) }, [controlled, onChange])
  return [current, set] as const
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

/** Width of an element, kept up to date with ResizeObserver. Charts use it to stay responsive. */
export function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null)
  const [w, setW] = useState(0)
  useLayoutEffect(() => {
    const el = ref.current; if (!el) return
    setW(el.clientWidth)
    const ro = new ResizeObserver(([e]) => setW(e.contentRect.width)); ro.observe(el)
    return () => ro.disconnect()
  }, [])
  return [ref, w] as const
}

/** Content-box size of an element, kept up to date: const [ref, { width, height }] = useSize<HTMLDivElement>(). */
export function useSize<T extends HTMLElement>() {
  const ref = useRef<T>(null)
  const [size, setSize] = useState({ width: 0, height: 0 })
  useLayoutEffect(() => {
    const el = ref.current; if (!el) return
    const set = (width: number, height: number) => setSize(s => s.width === width && s.height === height ? s : { width, height })
    const r = el.getBoundingClientRect(), cs = getComputedStyle(el), px = (k: string) => parseFloat(cs.getPropertyValue(k)) || 0
    set(r.width - px('padding-left') - px('padding-right') - px('border-left-width') - px('border-right-width'),
      r.height - px('padding-top') - px('padding-bottom') - px('border-top-width') - px('border-bottom-width'))
    const ro = new ResizeObserver(([e]) => set(e.contentRect.width, e.contentRect.height)); ro.observe(el)
    return () => ro.disconnect()
  }, [])
  return [ref, size] as const
}

const mqSubscribe = (q: string) => (cb: () => void) => { const m = matchMedia(q); m.addEventListener('change', cb); return () => m.removeEventListener('change', cb) }

const mqNow = (q: string) => typeof matchMedia !== 'undefined' && matchMedia(q).matches

/** Live result of a media query, e.g. useMediaQuery('(max-width: 639px)') or useMediaQuery('(pointer: coarse)'). False on the server. */
export function useMediaQuery(query: string) {
  const sub = useMemo(() => mqSubscribe(query), [query])
  return useSyncExternalStore(sub, () => matchMedia(query).matches, () => false)
}

/** True on touch-first devices (coarse pointer): grow hit areas, skip hover-only affordances. */
export const useCoarsePointer = () => useMediaQuery('(pointer: coarse)')

/** Has the user asked for reduced motion? A plain call for event handlers and effects (false on the server). */
export const prefersReducedMotion = () => mqNow('(prefers-reduced-motion: reduce)')

/** Is the primary pointer coarse (touch)? A plain call for event handlers and effects; in render use useCoarsePointer. */
export const isCoarsePointer = () => mqNow('(pointer: coarse)')

/* Touch helpers: a finger fires pointerenter → down → up → leave on every tap ──── */

/** True when a pointer event came from a finger. */
export const isTouch = (e: { pointerType?: string }) => e.pointerType === 'touch'

/** A pointerleave handler that ignores touch, so the leave a lifted finger fires doesn't undo what the tap showed. */
export const onMouseLeave = (fn: (e: ReactPointerEvent) => void) => (e: ReactPointerEvent) => { if (!isTouch(e)) fn(e) }

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
    try { el?.setPointerCapture(id) } catch { /* the pointer is already gone */ }
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

/**
 * Press and hold: `onPress` fires once the pointer has stayed down `ms` (default 500) without moving more than `slop` px
 * (default 8). Touch and pen only unless `mouse`. Spread `bind` on the element; the click that ends a long-press is swallowed.
 */
export function useLongPress({ ms = 500, slop = 8, mouse = false, onPress }:
  { ms?: number; slop?: number; mouse?: boolean; onPress: (p: { x: number; y: number; pointerId: number; pointerType: string; target: Element }) => void }) {
  const fn = useRef(onPress)
  useLayoutEffect(() => { fn.current = onPress })
  const press = useRef<{ t: ReturnType<typeof setTimeout>; x: number; y: number; id: number } | null>(null)
  const firedAt = useRef(0)
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
    onClickCapture: (e: React.MouseEvent) => { if (Date.now() - firedAt.current < 700) { firedAt.current = 0; e.preventDefault(); e.stopPropagation() } },
  }
  return { bind, cancel, /** true right after a long-press fired (use it to skip your own click logic) */ fired: () => Date.now() - firedAt.current < 700 }
}

const coreEditable = (t: EventTarget | null) => t instanceof Element &&
  !!t.closest('input:not([type=checkbox],[type=radio],[type=range],[type=button],[type=submit],[type=reset],[type=color],[type=file]),textarea,select,[contenteditable="true"],[contenteditable=""],[role=textbox]')

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
      if (skipFields && coreEditable(e.target)) return
      e.preventDefault(); h.current(e)
    }
    addEventListener('keydown', on)
    return () => removeEventListener('keydown', on)
  }, [combo, enabled, ignoreEditable])
}

/** Open focus traps, innermost last: only the top one handles Tab, so nested modals don't fight. Shared page-wide (uiShared). */
const coreTraps = uiShared('focus-traps', () => [] as RefObject<HTMLElement | null>[])

/**
 * Keep Tab focus inside `ref` while `active`: focuses `[data-autofocus]` or the first focusable on open, wraps Tab and
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
    const raf = requestAnimationFrame(() => (ref.current?.querySelector<HTMLElement>('[data-autofocus]') ?? focusables(ref.current)[0] ?? holder())?.focus())
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
 * Arrow-key roving index for lists, menus, tablists and toolbars: arrows move (skipping disabled items; ← and → swap in
 * * RTL, so the arrow pointing along the reading direction moves to the next item), Home/End jump, Enter calls `onEnter`. Third argument: `loop` (boolean) or RovingOptions. Safe with zero items.
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
  const dir = useDir()
  const go = (n: number) => { if (n < 0) return; if (index === undefined) setActive(n); onMove?.(n) }
  const onKeyDown = (e: RKeyboardEvent) => {
    if (!count) return
    const v = orientation !== 'horizontal', hz = orientation !== 'vertical', key = logicalArrow(e.key, dir) // ← is "next" in RTL
    // rtl-lint-ignore: `key` is logicalArrow-mapped above
    const d = (v && key === 'ArrowDown') || (hz && key === 'ArrowRight') ? 1 : (v && key === 'ArrowUp') || (hz && key === 'ArrowLeft') ? -1 : 0
    if (d) { e.preventDefault(); go(step(Math.min(active, count - 1), d)) }
    else if (homeEnd && (e.key === 'Home' || e.key === 'End')) { e.preventDefault(); go(e.key === 'Home' ? step(-1, 1) : step(count, -1)) }
    else if (e.key === 'Enter' && !e.nativeEvent.isComposing) { e.preventDefault(); if (active < count && !isDisabled?.(active)) onEnter(active) }
  }
  return { active, setActive, onKeyDown }
}

/**
 * Reveals text the way a model streams it: a few characters (`unit: 'char'`, about `cps` per second) or a word
 * (`unit: 'word'`, every `wordDelay` ms) at a time. Give it a finished string to replay it, or a string that keeps
 * growing (append-only, e.g. a live model stream) and it carries on from where it is instead of restarting; with
 * `live` it is not `done` until `live` turns false, and it speeds up to stay close when a large chunk lands. Any
 * other change to `text` replays from the start. `start: false` pauses it. Under reduced motion it shows everything.
 * Returns `{ text: shown so far, done, shown: chars shown, total }`. StreamingText is this hook as a component.
 */
export function useStreamedText(text: string, { cps = 60, start = true, unit = 'char', wordDelay = 45, live = false, onProgress }:
  { cps?: number; start?: boolean; unit?: 'char' | 'word'; wordDelay?: number; live?: boolean; onProgress?: () => void } = {}) {
  const reduce = useMediaQuery('(prefers-reduced-motion: reduce)')
  const [st, setSt] = useState(() => ({ src: text, pos: 0 }))
  const progress = useRef(onProgress); progress.current = onProgress
  const src = useRef(text); src.current = text
  let { pos } = st
  if (st.src !== text) {
    // append-only? (compares the tail of what we had, so a long stream stays cheap to check)
    const prev = st.src, k = Math.min(prev.length, 256)
    const appended = text.length >= prev.length && text.startsWith(prev.slice(prev.length - k), prev.length - k)
    pos = appended ? Math.min(st.pos, text.length) : 0
    setSt({ src: text, pos }) // adjust state while rendering (React re-renders before committing)
  }
  const total = text.length
  const shown = reduce ? total : Math.min(pos, total)
  const behind = !reduce && start && pos < total
  useEffect(() => {
    if (!behind) return
    const word = unit === 'word'
    // one interval while it is behind (reading the latest text from a ref, so a stream of updates doesn't reset it);
    // it stops once caught up and starts again when more text arrives
    const id = setInterval(() => {
      if (word && Math.random() < 0.2) return // the uneven rhythm of the per-word random delay this replaced
      setSt(s => {
        const text = src.current, total = text.length
        if (s.src !== text || s.pos >= total) return s
        const lag = total - s.pos
        let to: number
        if (word) {
          const from = live && lag > 400 ? s.pos + Math.floor(lag / 10) : s.pos + 1 // live and far behind: catch up
          const sp = text.indexOf(' ', from)
          to = sp < 0 ? total : sp
        } else to = s.pos + 2 + Math.floor(Math.random() * 3) + (live ? Math.floor(lag / 12) : 0)
        return { src: s.src, pos: Math.min(total, to) }
      })
      progress.current?.()
    }, word ? Math.max(8, wordDelay * 0.85) : 1000 / (Math.max(1, cps) / 3))
    return () => clearInterval(id)
  }, [behind, cps, unit, wordDelay, live])
  return { text: text.slice(0, shown), done: !live && shown >= total, shown, total }
}

/**
 * Watches a horizontal scroller: `left` / `right` say whether more content is hidden on that (physical) side, in LTR
 * and RTL alike, `touched` turns true once it has been scrolled away from its start. Pair with `ScrollEdges` for fades and a "scroll for more" hint.
 */
export function useScrollEdges<T extends HTMLElement>() {
  const [el, ref] = useState<T | null>(null) // callback ref, so a remounted scroller is picked up
  const [edges, setEdges] = useState({ left: false, right: false, touched: false })
  useEffect(() => {
    if (!el) return
    const upd = () => setEdges(e => {
      // physical sides; in RTL scrollLeft runs from 0 (start, at the right) down to -(scrollWidth - clientWidth)
      const rtl = getComputedStyle(el).direction === 'rtl', max = el.scrollWidth - el.clientWidth, x = rtl ? -el.scrollLeft : el.scrollLeft
      const scrolled = x > 2, rest = x < max - 2
      const left = rtl ? rest : scrolled, right = rtl ? scrolled : rest, touched = e.touched || scrolled
      return e.left === left && e.right === right && e.touched === touched ? e : { left, right, touched }
    })
    upd()
    el.addEventListener('scroll', upd, { passive: true })
    const ro = new ResizeObserver(upd); ro.observe(el); [...el.children].forEach(c => ro.observe(c))
    return () => { el.removeEventListener('scroll', upd); ro.disconnect() }
  }, [el])
  return [ref, edges] as const
}
