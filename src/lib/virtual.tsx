import { useCallback, useEffect, useImperativeHandle, useLayoutEffect, useReducer, useRef, type CSSProperties, type Key, type ReactNode, type Ref, type RefObject } from 'react'
import { flushSync } from 'react-dom'
import { cn } from './core'

/** Items rendered beyond each edge of the viewport by default (keeps fast scrolling and Tab/arrow keys from hitting blanks). */
export const VIRTUAL_OVERSCAN = 6
/** Viewport assumed before anything is measured: on the server, in the first client render (so hydration matches) and in jsdom. */
export const VIRTUAL_INITIAL_RECT = { width: 800, height: 600 }
/** Within this many px of the end, an `anchor: 'end'` list counts as pinned to the bottom. */
const VIRTUAL_PIN_SLOP = 8
/** Prepended items are searched for by key this far (cheap enough for chat logs; longer lists keep their offset). */
const VIRTUAL_KEY_SCAN = 20000

/** One rendered item: its index, React key, and where it sits along the scroll axis (px from the start of the content). */
export type VirtualItem = { index: number; key: Key; start: number; size: number; end: number }
/** Where scrollToIndex puts the item: its start at the top, centred, its end at the bottom, or `auto` (only scroll if it isn't fully visible, by the least amount). */
export type VirtualAlign = 'start' | 'center' | 'end' | 'auto'
/** Options for scrollToIndex. `behavior: 'smooth'` skips the re-aim pass that corrects for freshly measured sizes. */
export type VirtualScrollOptions = { align?: VirtualAlign; behavior?: ScrollBehavior }

/**
 * Options for useVirtual.
 * - `count` items, each `estimateSize` px (a number, or a function of the index). With `measureElement` attached the
 *   real sizes replace the estimates as items render (ResizeObserver, batched; sizes are kept per `getItemKey`, and a
 *   new `getItemKey` function re-lays out the list when any measured size differs from its estimate, so memoise it for
 *   long lists of variable-height items).
 *   A new `estimateSize` function re-lays out the list (O(count)), so memoise it (useCallback/useMemo) and change it
 *   when what it depends on changes (rows grouped differently, a denser mode).
 * - `scrollRef`: the scrolling element, or `'window'` to follow the page scroll (then pass `scrollMargin`, the list's
 *   distance from the top of the document, or a function that measures it, read on every scroll; VirtualList does this itself).
 * - `paddingStart` / `paddingEnd`: space before the first / after the last item inside the scroll content (a header).
 * - `scrollPaddingStart` / `scrollPaddingEnd`: parts of the viewport covered by sticky things; scrollToIndex keeps items clear of them.
 * - `initialOffset`: scroll position to start at. `initialRect`: viewport assumed until measured (server render, jsdom).
 * - `anchor: 'end'`: a chat log. Starts at the bottom and stays pinned there while items are appended or grow; when
 *   the reader has scrolled up, prepending items (pass `getItemKey`) or resizing ones above keeps what they read in place.
 * - `keep`: indexes always rendered even when off screen (the grid's Tab stop, an active descendant). The item holding
 *   focus is kept automatically (`retainFocus`, default on), so focus never falls to <body> when it scrolls away.
 * - `enabled: false` renders every item (small lists keep their layout animations) with the same API.
 * - `onEndReached`: called once per `count` when the last `endReachedThreshold` (default 5) items come into view (infinite loading).
 */
export type VirtualOptions = {
  count: number
  estimateSize: number | ((index: number) => number)
  scrollRef: RefObject<HTMLElement | null> | 'window'
  overscan?: number
  horizontal?: boolean
  getItemKey?: (index: number) => Key
  paddingStart?: number
  paddingEnd?: number
  scrollPaddingStart?: number
  scrollPaddingEnd?: number
  scrollMargin?: number | (() => number)
  initialOffset?: number
  initialRect?: { width: number; height: number }
  anchor?: 'start' | 'end'
  keep?: readonly number[]
  retainFocus?: boolean
  enabled?: boolean
  onEndReached?: () => void
  endReachedThreshold?: number
}

/** What useVirtual returns. */
export type Virtualizer = {
  /** the items to render, in index order: the window plus overscan, plus any kept items (which may leave gaps) */ items: VirtualItem[]
  /** px of scroll content: size the inner element to this */ totalSize: number
  /** the indexes actually in view (no overscan); -1/-1 when empty */ visible: { start: number; end: number }
  /** ref callback for each rendered item (needs `data-index`): measures it now and whenever it resizes */ measureElement: (el: Element | null) => void | (() => void)
  scrollToIndex: (index: number, options?: VirtualScrollOptions) => void
  scrollToOffset: (offset: number, options?: { behavior?: ScrollBehavior }) => void
  /** the scroll offset that would show `index` with `align`, or null when `auto` needs no scroll */ getOffsetForIndex: (index: number, align?: VirtualAlign) => number | null
  /** forget every measured size and estimate again */ measure: () => void
  getScrollOffset: () => number
  /** viewport size along the scroll axis (the initial rect until measured) */ viewportSize: number
  /** `aria-setsize` / `aria-posinset` for an option, listitem or treeitem at `index` */ setAria: (index: number) => { 'aria-setsize': number; 'aria-posinset': number }
}

/* ---- pure window math (exported for tests and custom engines) ---- */

/** Prefix sums: `starts[i]` is where item i begins, `starts[count]` where the last one ends. Pass `into` and `from` to redo only the tail. */
export function virtualStarts(count: number, size: (i: number) => number, paddingStart = 0, into?: Float64Array, from = 0): Float64Array {
  const reuse = !!into && into.length === count + 1
  const s = reuse ? into! : new Float64Array(count + 1)
  const f = reuse ? Math.max(0, Math.min(from, count)) : 0
  let pos = f === 0 ? paddingStart : s[f]
  for (let i = f; i < count; i++) { s[i] = pos; pos += size(i) }
  s[count] = pos
  return s
}
/** The item at `offset` (the last one starting at or before it), clamped to the list. */
export function virtualFind(starts: Float64Array, count: number, offset: number): number {
  let lo = 0, hi = count - 1
  while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (starts[mid] <= offset) lo = mid; else hi = mid - 1 }
  return Math.max(0, lo)
}
/** Visible indexes for a viewport at `offset`, and the rendered range with `overscan` items either side. Null when empty. */
export function virtualRange(starts: Float64Array, count: number, offset: number, viewport: number, overscan: number) {
  if (count <= 0) return null
  const vs = virtualFind(starts, count, Math.max(0, offset))
  let ve = vs
  const bottom = offset + Math.max(0, viewport)
  while (ve < count - 1 && starts[ve + 1] < bottom) ve++
  return { visibleStart: vs, visibleEnd: ve, start: Math.max(0, vs - overscan), end: Math.min(count - 1, ve + overscan) }
}
/** Scroll offset that shows an item (`start`, `size`) with `align`; null when `auto` finds it already fully in view. Clamped to the scrollable range. */
export function virtualAlignOffset(start: number, size: number, viewport: number, current: number, total: number, align: VirtualAlign = 'auto', padStart = 0, padEnd = 0): number | null {
  const room = viewport - padStart - padEnd, max = Math.max(0, total - viewport)
  let to: number
  if (align === 'auto') {
    if (start >= current + padStart && start + size <= current + viewport - padEnd) return null
    to = start < current + padStart || size > room ? start - padStart : start + size - viewport + padEnd
  } else if (align === 'start') to = start - padStart
  else if (align === 'end') to = start + size - viewport + padEnd
  else to = start + size / 2 - padStart - room / 2
  return Math.min(max, Math.max(0, to))
}
/** `aria-setsize` / `aria-posinset` for item `index` of `count` (options, list items, tree items: the set stays whole for screen readers). */
export const virtualSetAria = (index: number, count: number) => ({ 'aria-setsize': count, 'aria-posinset': index + 1 })
/** `aria-rowindex` for virtual grid/table row `index` (0-based among body rows), counting `headerRows` header rows before it. */
export const virtualRowAria = (index: number, headerRows = 1) => ({ 'aria-rowindex': index + 1 + headerRows })

const useVirtualLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect

type VirtualState = {
  starts: Float64Array; count: number; est: number | ((index: number) => number); pad: number; keyFn?: (index: number) => Key
  offset: number; viewport: number; measured: boolean
  rendered: { start: number; end: number } | null; pinned: boolean
  anchorItem: { key: Key; index: number; delta: number } | null
  focusIndex: number | null; lastTotal: number; lastCount: number; endFiredFor: number
}

/**
 * Windowing engine. Give it `count`, `estimateSize` and the scroll element; render `items` absolutely positioned (or
 * between spacer rows) inside an element `totalSize` tall. Scrolling re-renders only when the view nears the edge of
 * what is rendered (synchronously when it would otherwise show a gap), measurements are batched per ResizeObserver
 * callback, and nothing reads the DOM during render, so it is SSR-safe: the server and the first client render show
 * the first `initialRect`-sized window. See VirtualOptions for window scrolling, sticky headers, chat logs and focus.
 *
 *   const v = useVirtual({ count: rows.length, estimateSize: 36, scrollRef: ref })
 *   <div ref={ref} className="h-80 overflow-auto"><div style={{ height: v.totalSize, position: 'relative' }}>
 *     {v.items.map(it => <div key={it.key} data-index={it.index} ref={v.measureElement}
 *       style={{ position: 'absolute', top: 0, width: '100%', transform: `translateY(${it.start}px)` }}>{rows[it.index]}</div>)}
 *   </div></div>
 */
export function useVirtual(options: VirtualOptions): Virtualizer {
  const { count: rawCount, estimateSize, scrollRef, overscan = VIRTUAL_OVERSCAN, horizontal = false, paddingStart = 0, paddingEnd = 0,
    initialOffset, initialRect = VIRTUAL_INITIAL_RECT, anchor = 'start', keep, retainFocus = true, enabled = true, endReachedThreshold = 5 } = options
  const count = Math.max(0, Math.floor(rawCount) || 0)
  const opts = useRef(options); opts.current = options
  const [, bump] = useReducer((x: number) => x + 1, 0)
  const sizes = useRef(new Map<Key, number>())
  const dirty = useRef(Infinity)
  const st = useRef<VirtualState | null>(null)
  const est = estimateSize
  const keyOf = (i: number): Key => opts.current.getItemKey ? opts.current.getItemKey(i) : i
  const estimate = (i: number) => { const e = opts.current.estimateSize; return typeof e === 'number' ? e : e(i) }
  const sizeOf = (i: number) => { if (!sizes.current.size) return estimate(i); const m = sizes.current.get(keyOf(i)); return m ?? estimate(i) }

  /* ---- layout (prefix sums), rebuilt only from the earliest measured change ---- */
  if (!st.current) {
    st.current = { starts: new Float64Array(1), count: -1, est, pad: paddingStart, offset: initialOffset ?? 0,
      viewport: horizontal ? initialRect.width : initialRect.height, measured: false, rendered: null, pinned: anchor === 'end',
      anchorItem: null, focusIndex: null, lastTotal: -1, lastCount: count, endFiredFor: -1 }
  }
  const s = st.current
  // a new getItemKey may mean reordered items: their measured sizes move with them (only matters once some differ from the estimate)
  const keysMoved = s.keyFn !== options.getItemKey && sizes.current.size > 0
  s.keyFn = options.getItemKey
  if (s.count !== count || s.est !== est || s.pad !== paddingStart || s.starts.length !== count + 1 || keysMoved) {
    s.starts = virtualStarts(count, sizeOf, paddingStart); s.count = count; s.est = est; s.pad = paddingStart; dirty.current = Infinity
  } else if (dirty.current < count) {
    s.starts = virtualStarts(count, sizeOf, paddingStart, s.starts, dirty.current); dirty.current = Infinity
  }
  const starts = s.starts
  const totalSize = (starts[count] ?? paddingStart) + paddingEnd
  const maxOffset = () => Math.max(0, totalSize - s.viewport)
  if (anchor === 'end' && s.pinned && !s.measured) s.offset = maxOffset() // server / first paint of a chat log: show its end

  /* ---- what to render ---- */
  const items: VirtualItem[] = []
  let visible = { start: -1, end: -1 }
  const item = (i: number): VirtualItem => ({ index: i, key: keyOf(i), start: starts[i], size: starts[i + 1] - starts[i], end: starts[i + 1] })
  if (count > 0 && !enabled) {
    for (let i = 0; i < count; i++) items.push(item(i))
    visible = { start: 0, end: count - 1 }
    s.rendered = { start: 0, end: count - 1 }
  } else if (count > 0) {
    const r = virtualRange(starts, count, s.offset, s.viewport, overscan)!
    visible = { start: r.visibleStart, end: r.visibleEnd }
    s.rendered = { start: r.start, end: r.end }
    const extra = new Set<number>()
    for (const k of keep ?? []) if (k >= 0 && k < count && (k < r.start || k > r.end)) extra.add(k)
    if (retainFocus && s.focusIndex != null && s.focusIndex < count && (s.focusIndex < r.start || s.focusIndex > r.end)) extra.add(s.focusIndex)
    const sorted = [...extra].sort((a, b) => a - b)
    for (const k of sorted) if (k < r.start) items.push(item(k))
    for (let i = r.start; i <= r.end; i++) items.push(item(i))
    for (const k of sorted) if (k > r.end) items.push(item(k))
  } else s.rendered = null

  /* ---- DOM access (effects and handlers only) ---- */
  const getEl = (): HTMLElement | null => scrollRef === 'window' ? null : scrollRef.current
  const marginOf = () => { const m = opts.current.scrollMargin; return (typeof m === 'function' ? m() : m) ?? 0 }
  const readOffset = () => {
    if (scrollRef === 'window') return (horizontal ? scrollX : scrollY) - marginOf()
    const el = getEl(); return el ? (horizontal ? el.scrollLeft : el.scrollTop) : st.current!.offset
  }
  const writeOffset = (to: number, behavior?: ScrollBehavior) => {
    const hz = opts.current.horizontal
    if (opts.current.scrollRef === 'window') {
      const abs = to + marginOf()
      window.scrollTo(hz ? { left: abs, behavior } : { top: abs, behavior })
      return
    }
    const el = opts.current.scrollRef.current; if (!el) return
    if (behavior && behavior !== 'auto' && el.scrollTo) el.scrollTo(hz ? { left: to, behavior } : { top: to, behavior })
    else if (hz) el.scrollLeft = to; else el.scrollTop = to
  }
  const readViewport = () => {
    if (scrollRef === 'window') return horizontal ? innerWidth : innerHeight
    const el = getEl(); return el ? (horizontal ? el.clientWidth : el.clientHeight) : 0
  }
  const rememberAnchor = () => {
    const S = st.current!
    if (opts.current.anchor !== 'end' || S.count <= 0) { S.anchorItem = null; return }
    const i = virtualFind(S.starts, S.count, S.offset)
    S.anchorItem = { key: keyOf(i), index: i, delta: S.starts[i] - S.offset }
  }
  /** re-render when the view leaves (synchronously, no blank frame) or nears the edge of (in the next task) what is rendered */
  const onOffset = () => {
    const S = st.current!, os = opts.current.overscan ?? VIRTUAL_OVERSCAN
    const r = virtualRange(S.starts, S.count, S.offset, S.viewport, os), had = S.rendered
    if (!r || !had) { if (!!r !== !!had) bump(); return }
    if (r.visibleStart < had.start || r.visibleEnd > had.end) { flushSync(bump); return }
    const slack = Math.max(1, os >> 1)
    if ((had.start > 0 && r.visibleStart - had.start < slack) || (had.end < S.count - 1 && had.end - r.visibleEnd < slack)) bump()
  }
  const scrollToOffset = useCallback((to: number, o?: { behavior?: ScrollBehavior }) => {
    const S = st.current!, total = (S.starts[S.count] ?? 0) + (opts.current.paddingEnd ?? 0)
    const t = Math.min(Math.max(0, total - S.viewport), Math.max(0, to))
    writeOffset(t, o?.behavior)
    if (!o?.behavior || o.behavior === 'auto') { // render the destination now, before the scroll event arrives
      S.offset = t
      if (opts.current.anchor === 'end') S.pinned = t >= total - S.viewport - VIRTUAL_PIN_SLOP
      rememberAnchor(); bump()
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps
  const getOffsetForIndex = useCallback((index: number, align: VirtualAlign = 'auto') => {
    const S = st.current!; if (!S.count) return null
    const i = Math.min(S.count - 1, Math.max(0, index)), total = S.starts[S.count] + (opts.current.paddingEnd ?? 0)
    return virtualAlignOffset(S.starts[i], S.starts[i + 1] - S.starts[i], S.viewport, S.offset, total, align, opts.current.scrollPaddingStart ?? 0, opts.current.scrollPaddingEnd ?? 0)
  }, [])
  const settle = useRef(0)
  const scrollToIndex = useCallback((index: number, o?: VirtualScrollOptions) => {
    const align = o?.align ?? 'auto'
    const to = getOffsetForIndex(index, align)
    if (to != null) scrollToOffset(to, { behavior: o?.behavior })
    if (o?.behavior === 'smooth' || typeof requestAnimationFrame === 'undefined') return
    // freshly measured sizes can move the target once it renders: re-aim for a few frames
    cancelAnimationFrame(settle.current)
    let tries = 0
    const again = () => {
      const t = getOffsetForIndex(index, align)
      if (t != null && Math.abs(t - st.current!.offset) > 1 && tries++ < 4) { scrollToOffset(t); settle.current = requestAnimationFrame(again) }
    }
    settle.current = requestAnimationFrame(again)
  }, [getOffsetForIndex, scrollToOffset])
  useEffect(() => () => cancelAnimationFrame(settle.current), [])

  /* subscribe: scroll, viewport size, focus */
  useVirtualLayoutEffect(() => {
    if (!enabled) return
    const S = st.current!
    const win = scrollRef === 'window', el = getEl()
    if (!win && !el) return
    const vp = readViewport()
    if (vp > 0) S.viewport = vp
    S.measured = vp > 0
    // where to start: a chat log at its end, otherwise `initialOffset` (first mount), otherwise wherever the element is
    if (anchor === 'end' && S.pinned) scrollToOffset(Infinity)
    else if (initialOffset != null && S.lastTotal < 0) scrollToOffset(initialOffset)
    else { S.offset = readOffset(); bump() }
    const onScroll = () => {
      S.offset = readOffset()
      if (opts.current.anchor === 'end') S.pinned = S.offset >= (S.starts[S.count] ?? 0) + (opts.current.paddingEnd ?? 0) - S.viewport - VIRTUAL_PIN_SLOP
      rememberAnchor()
      onOffset()
    }
    const onSize = () => {
      const v = readViewport(); if (v <= 0 || Math.abs(v - S.viewport) < 0.5) return
      S.viewport = v; S.measured = true
      if (opts.current.anchor === 'end' && S.pinned) scrollToOffset(Infinity); else bump()
    }
    const target: HTMLElement | Window = win ? window : el!
    target.addEventListener('scroll', onScroll, { passive: true })
    let ro: ResizeObserver | null = null
    if (win) {
      addEventListener('resize', onSize)
      // content above the list can grow or shrink without a scroll event (an image loads, a banner opens): re-read the offset
      if (typeof ResizeObserver !== 'undefined') { ro = new ResizeObserver(onScroll); ro.observe(document.documentElement) }
    } else if (typeof ResizeObserver !== 'undefined') { ro = new ResizeObserver(onSize); ro.observe(el!) }
    const focusRoot: HTMLElement | Document = el ?? document
    const onFocusIn = (e: Event) => {
      const t = e.target instanceof Element ? e.target.closest('[data-index]') : null
      if (!t || (el && !el.contains(t))) return
      const i = Number(t.getAttribute('data-index')); if (Number.isFinite(i)) S.focusIndex = i
    }
    const onFocusOut = (e: Event) => {
      const next = (e as FocusEvent).relatedTarget
      if (!(next instanceof Node) || !el || !el.contains(next)) S.focusIndex = null
    }
    if (retainFocus) { focusRoot.addEventListener('focusin', onFocusIn); focusRoot.addEventListener('focusout', onFocusOut) }
    return () => {
      target.removeEventListener('scroll', onScroll)
      if (win) removeEventListener('resize', onSize)
      ro?.disconnect()
      if (retainFocus) { focusRoot.removeEventListener('focusin', onFocusIn); focusRoot.removeEventListener('focusout', onFocusOut) }
    }
  }, [enabled, scrollRef, horizontal, retainFocus]) // eslint-disable-line react-hooks/exhaustive-deps

  /* after each layout change: keep a chat log pinned, or keep the reader's place when items were prepended */
  useVirtualLayoutEffect(() => {
    const S = st.current!
    const prevTotal = S.lastTotal, prevCount = S.lastCount
    S.lastTotal = totalSize; S.lastCount = count
    if (!enabled || prevTotal < 0 || anchor !== 'end') return
    if (S.pinned) { if (Math.abs(readOffset() - maxOffset()) > 0.5 || Math.abs(S.offset - maxOffset()) > 0.5) scrollToOffset(Infinity); return }
    const a = S.anchorItem
    if (!a || !opts.current.getItemKey || (prevTotal === totalSize && prevCount === count)) return
    let ni = -1
    for (const c of [a.index + (count - prevCount), a.index]) if (c >= 0 && c < count && keyOf(c) === a.key) { ni = c; break }
    if (ni < 0 && count <= VIRTUAL_KEY_SCAN) for (let i = 0; i < count; i++) if (keyOf(i) === a.key) { ni = i; break }
    if (ni < 0) return
    const to = starts[ni] - a.delta
    if (Math.abs(to - S.offset) > 0.5) scrollToOffset(to)
  })

  /* infinite loading */
  useEffect(() => {
    const S = st.current!, fn = opts.current.onEndReached
    if (!fn || !count || visible.end < 0 || S.endFiredFor === count) return
    if (visible.end >= count - 1 - endReachedThreshold) { S.endFiredFor = count; fn() }
  })

  /* ---- measuring ---- */
  const ro = useRef<ResizeObserver | null>(null)
  const onMeasure = useCallback((entries: ResizeObserverEntry[]) => {
    const S = st.current!
    let changed = false, adjust = 0
    const hz = opts.current.horizontal
    for (const e of entries) {
      const el = e.target as HTMLElement
      if (!el.isConnected) continue
      const i = Number(el.getAttribute('data-index')); if (!Number.isFinite(i) || i < 0 || i >= S.count) continue
      const box = e.borderBoxSize?.[0]
      const size = box ? (hz ? box.inlineSize : box.blockSize) : (hz ? el.getBoundingClientRect().width : el.getBoundingClientRect().height)
      if (!size && !el.getClientRects().length) continue // display:none
      const k = keyOf(i), prev = S.starts[i + 1] - S.starts[i]
      // only sizes that differ from the estimate are kept, so uniform rows cost nothing to re-lay out
      if (Math.abs(size - estimate(i)) < 0.5) sizes.current.delete(k); else sizes.current.set(k, size)
      if (Math.abs(prev - size) < 0.5) continue
      changed = true; dirty.current = Math.min(dirty.current, i)
      // an item above the viewport changed size: shift the scroll by the same amount so what's on screen stays put
      if (S.starts[i] < S.offset && !(opts.current.anchor === 'end' && S.pinned)) adjust += size - prev
    }
    if (!changed) return
    if (adjust) { S.offset += adjust; writeOffset(S.offset) }
    bump()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps
  const measureElement = useCallback((el: Element | null) => {
    if (!el || typeof ResizeObserver === 'undefined') return
    ro.current ??= new ResizeObserver(onMeasure)
    const obs = ro.current
    obs.observe(el, { box: 'border-box' })
    return () => obs.unobserve(el)
  }, [onMeasure])
  useEffect(() => () => { ro.current?.disconnect(); ro.current = null }, [])
  const measure = useCallback(() => { sizes.current.clear(); st.current!.count = -1; bump() }, [])

  return {
    items, totalSize, visible, measureElement, scrollToIndex, scrollToOffset, getOffsetForIndex, measure,
    getScrollOffset: () => st.current!.offset, viewportSize: s.viewport,
    setAria: (i: number) => virtualSetAria(i, count),
  }
}

/** Imperative handle of a VirtualList (pass `ref`). */
export type VirtualListHandle = Pick<Virtualizer, 'scrollToIndex' | 'scrollToOffset' | 'measure' | 'getScrollOffset'> & { element: HTMLDivElement | null }

const VIRTUAL_ITEM_ROLE: Record<string, string | undefined> = { list: 'listitem', listbox: 'option', tree: 'treeitem', feed: 'article', menu: 'menuitem' }

/**
 * A scrolling list that renders only the items in view. Items measure themselves (variable heights are fine); pass a
 * fixed `estimateSize` and `measure={false}` for uniform rows. `role` sets the container role and each item's
 * (`list` → listitem, `listbox` → option, `feed` → article, `log` → none), with aria-setsize/aria-posinset so screen
 * readers count the whole set. `anchor="end"` makes a chat log: it starts at the bottom, stays pinned there as
 * messages arrive or stream in, and keeps the reader's place when older ones are prepended (give `getItemKey`).
 * `window` scrolls with the page instead of inside a box. `onEndReached` loads more. `ref` gives scrollToIndex etc.
 */
export function VirtualList({ count, estimateSize, renderItem, getItemKey, overscan, height = 320, measure = true, horizontal, anchor, window: useWindow,
  role = 'list', itemRole, itemClassName, className, style, onEndReached, endReachedThreshold, initialRect, keep, tabIndex = 0, ref, ...aria }:
  { count: number; estimateSize: number | ((index: number) => number); renderItem: (index: number, item: VirtualItem) => ReactNode
    getItemKey?: (index: number) => Key; overscan?: number; /** box height (number = px); ignored with `window` */ height?: number | string
    /** measure each item's real size (default true) */ measure?: boolean; horizontal?: boolean; anchor?: 'start' | 'end'; /** scroll with the page */ window?: boolean
    role?: string; /** role of each item wrapper; default from `role` */ itemRole?: string; itemClassName?: string; className?: string; style?: CSSProperties
    onEndReached?: () => void; endReachedThreshold?: number; initialRect?: { width: number; height: number }; keep?: readonly number[]; tabIndex?: number
    ref?: Ref<VirtualListHandle>; id?: string } & { [k: `aria-${string}`]: string | number | boolean | undefined }) {
  const box = useRef<HTMLDivElement>(null), inner = useRef<HTMLDivElement>(null)
  // window mode: where the list starts on the page, measured on every read so content growing above it never leaves it stale
  const pageOffset = useCallback(() => {
    const r = inner.current?.getBoundingClientRect()
    return r ? Math.round(horizontal ? r.left + scrollX : r.top + scrollY) : 0
  }, [horizontal])
  const v = useVirtual({ count, estimateSize, getItemKey, overscan, horizontal, anchor, scrollRef: useWindow ? 'window' : box, scrollMargin: useWindow ? pageOffset : undefined, onEndReached, endReachedThreshold, initialRect, keep })
  useImperativeHandle(ref, () => ({ scrollToIndex: v.scrollToIndex, scrollToOffset: v.scrollToOffset, measure: v.measure, getScrollOffset: v.getScrollOffset, element: box.current }), [v.scrollToIndex, v.scrollToOffset, v.measure, v.getScrollOffset])
  const ir = itemRole ?? VIRTUAL_ITEM_ROLE[role]
  const set = !!ir && Object.values(VIRTUAL_ITEM_ROLE).includes(ir)
  const end = anchor === 'end'
  return (
    <div ref={box} role={role} tabIndex={tabIndex} {...aria}
      className={cn('relative outline-none focus-visible:shadow-[inset_0_0_0_2px_var(--accent)]', !useWindow && (horizontal ? 'overflow-x-auto overflow-y-hidden' : 'overflow-y-auto overflow-x-hidden'), !useWindow && 'overscroll-contain', end && !horizontal && 'flex flex-col', className)}
      style={{ ...(useWindow ? null : horizontal ? { width: '100%' } : { height }), ...style }}>
      <div ref={inner} style={{ position: 'relative', flex: 'none', ...(horizontal ? { width: v.totalSize, height: '100%' } : { height: v.totalSize, width: '100%' }), marginTop: end && !horizontal ? 'auto' : undefined }}>
        {v.items.map(it => (
          <div key={it.key} data-index={it.index} ref={measure ? v.measureElement : undefined} role={ir} {...(set ? v.setAria(it.index) : null)} className={itemClassName}
            style={horizontal
              ? { position: 'absolute', top: 0, insetInlineStart: 0, height: '100%', transform: `translateX(${it.start}px)`, width: measure ? undefined : it.size }
              : { position: 'absolute', top: 0, left: 0, width: '100%', transform: `translateY(${it.start}px)`, height: measure ? undefined : it.size }}>
            {renderItem(it.index, it)}
          </div>
        ))}
      </div>
    </div>
  )
}
