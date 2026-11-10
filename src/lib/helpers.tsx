/** Pure helpers: class names (cn, variants), motion constants (spring, springEasing, MOTION, EASE_OUT), numbers and ids, list moves, key-to-move maps, typeahead, scroll reveal, focusable elements, downloads and the clipboard. Part of @lyndon/ui/core. */

/** Join class names. (Add tailwind-merge here if you want later classes to override earlier ones.) */
export function cn(...c: (string | false | null | undefined | 0)[]) {
  return c.filter(Boolean).join(' ')
}

type VariantMap = Record<string, Record<string, string>>

type VariantProps<V extends VariantMap> = { [K in keyof V]?: keyof V[K] }

/** Tiny cva(): variants('base', { size: { sm: '…', md: '…' } }, { size: 'md' })({ size: 'sm' }) */
export function variants<V extends VariantMap>(base: string, map: V, defaults: VariantProps<V>) {
  return (p: VariantProps<V> & { className?: string } = {}) =>
    cn(base, ...Object.keys(map).map(k => map[k][String(p[k] ?? defaults[k])]), p.className)
}

/** One spring for the whole library: spring(bounce, duration). */
export const spring = (bounce = 0.25, duration = 0.45) => ({ type: 'spring' as const, bounce, duration })

/** The library's entrance easing (quick out, long settle), as motion's cubic-bezier array. */
export const EASE_OUT: [number, number, number, number] = [0.22, 1, 0.36, 1]

/** EASE_OUT as a CSS timing function, for `transition` / `animation` strings and `ease-[…]` classes. */
export const EASE_OUT_CSS = 'cubic-bezier(.22,1,.36,1)'

const springEasings = new Map<string, string>()
/**
 * spring(bounce, duration) as a CSS / WAAPI easing: a `linear()` curve sampled from a damped spring that settles in
 * `duration` seconds, and that duration in ms. The shape depends only on `bounce`. Where `linear()` is unsupported, use
 * the `fallback` (a cubic-bezier with the same overshoot direction).
 */
export function springEasing(bounce = 0.25, duration = 0.45): { easing: string; fallback: string; ms: number } {
  const ms = Math.round(duration * 1000), b = clamp(bounce, 0, 0.9), key = b.toFixed(3)
  const fallback = b >= 0.4 ? 'cubic-bezier(.34,1.56,.64,1)' : b >= 0.2 ? 'cubic-bezier(.3,1.25,.5,1)' : EASE_OUT_CSS
  let easing = springEasings.get(key)
  if (!easing) {
    // damping ratio and natural frequency for a settle time of 1: the envelope is down to 0.1% at t = 1
    const z = 1 - b, wd = (w: number) => w * Math.sqrt(1 - z * z)
    const env = (w: number) => (z < 1 ? Math.exp(-z * w) / Math.sqrt(1 - z * z) : (1 + w) * Math.exp(-w))
    let lo = 0.5, hi = 200
    for (let i = 0; i < 40; i++) { const mid = (lo + hi) / 2; if (env(mid) > 0.001) lo = mid; else hi = mid }
    const w = hi
    const x = (t: number) => (z < 1 ? 1 - Math.exp(-z * w * t) * (Math.cos(wd(w) * t) + (z * w / wd(w)) * Math.sin(wd(w) * t)) : 1 - (1 + w * t) * Math.exp(-w * t))
    const n = 32, pts = Array.from({ length: n + 1 }, (_, i) => (i === n ? 1 : +x(i / n).toFixed(3)))
    easing = `linear(${pts.join(',')})`
    springEasings.set(key, easing)
  }
  return { easing, fallback, ms }
}

/** The CSS variable holding the spring easing closest to `bounce` (TOKENS has three: soft 0.1, default 0.25, pop 0.5), for transitions written inline. */
export const springVar = (bounce: number) => `var(--ui-spring${bounce >= 0.4 ? '-pop' : bounce >= 0.18 ? '' : '-soft'})`

/**
 * Named springs, so similar elements move alike: `press` (a tap pops back), `pop` (a mark or badge appearing), `panel`
 * (popovers, menus), `layout` (items sliding to a new place), `settle` (calm repositioning, reorder).
 */
export const MOTION = {
  press: spring(0.5, 0.3), pop: spring(0.5, 0.35), panel: spring(0.25, 0.3), layout: spring(0.3, 0.35), settle: spring(0.2, 0.3),
} as const

/**
 * Variants for content that slides sideways when it changes (pagers, steps, mega menus): pass the direction as `custom`
 * (+1 enters from the right, -1 from the left). `exit` is the leave duration in seconds.
 */
export const slideVariants = (distance = 20, exit = 0.14) => ({
  enter: (d: number) => ({ opacity: 0, x: distance * d }),
  center: { opacity: 1, x: 0 },
  exit: (d: number) => ({ opacity: 0, x: -distance * d, transition: { duration: exit } }),
})

/** Resolves after `ms` milliseconds: await sleep(300). */
export const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms))

/** Keep `n` inside [lo, hi]: clamp(140, 0, 100) → 100. */
export const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n))

/** An index kept inside a list of `count` items; 0 when the list is empty (where clamp(i, 0, count - 1) gives -1). */
export const clampIndex = (i: number, count: number) => (count > 0 ? clamp(Math.trunc(i) || 0, 0, count - 1) : 0)

const decimalsOf = (n: number) => { const m = /(?:\.(\d+))?(?:e-(\d+))?$/.exec(String(n)); return m ? Math.max(0, (m[1]?.length ?? 0) + Number(m[2] ?? 0)) : 0 }

/**
 * `n` snapped to the nearest `min + k × step` and kept inside [min, max], without float drift: snapToStep(0.30000004,
 * { min: 0, max: 1, step: 0.1 }) → 0.3. No step (or 0) only clamps.
 */
export function snapToStep(n: number, { min = -Infinity, max = Infinity, step }: { min?: number; max?: number; step?: number }): number {
  if (!Number.isFinite(n)) return Number.isFinite(min) ? min : 0
  if (!step || step <= 0) return clamp(n, min, max)
  const base = Number.isFinite(min) ? min : 0, digits = Math.max(decimalsOf(step), decimalsOf(base))
  const v = +(base + Math.round((n - base) / step) * step).toFixed(digits)
  return clamp(v > max ? v - step : v, min, max)
}

/**
 * Largest value, like Math.max(...values) (NaN propagates, empty → `init`) but with a loop, so huge arrays don't
 * overflow the call stack (spreading ~125k+ arguments throws RangeError).
 */
export function maxOf(values: Iterable<number>, init = -Infinity) { let m = init; for (const v of values) m = Math.max(m, v); return m }

/** Smallest value, like Math.min(...values) with a loop (see maxOf). */
export function minOf(values: Iterable<number>, init = Infinity) { let m = init; for (const v of values) m = Math.min(m, v); return m }

/** [min, max] in one pass, with a loop (see maxOf). Empty → [Infinity, -Infinity]. */
export function extent(values: Iterable<number>): [number, number] { let lo = Infinity, hi = -Infinity; for (const v of values) { lo = Math.min(lo, v); hi = Math.max(hi, v) } return [lo, hi] }

/** JSON.parse that never throws: `{ ok: true, v }`, or `{ ok: false }` for anything that isn't JSON. */
export function tryJson(s: string): { ok: true; v: unknown } | { ok: false } {
  try { return { ok: true, v: JSON.parse(s) } } catch { return { ok: false } }
}

/** Space-separated id list for aria-describedby / aria-labelledby; undefined when there is none. */
export const joinIds = (...ids: (string | false | null | undefined)[]) => ids.filter(Boolean).join(' ') || undefined

const idHash = (s: string) => { let h = 0x811c9dc5; for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193); return (h >>> 0).toString(36).slice(0, 5) }

/**
 * A value as part of a DOM id (`${id}-${idPart(value)}`): characters other than letters, digits, `_` and `-` become `_`,
 * plus a short hash of the original when any did, so "a b" and "a_b" stay distinct.
 */
export function idPart(v: string | number): string {
  const s = String(v), safe = s.replace(/[^\w-]/g, '_')
  return safe === s ? s : `${safe}-${idHash(s)}`
}

let uidCount = 0
/** A unique id for new items (cards, rows, messages): `uid('card')` → "card-…". Uses crypto.randomUUID when available. */
export function uid(prefix = 'id'): string {
  const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto
  return `${prefix}-${c?.randomUUID ? c.randomUUID() : `${Date.now().toString(36)}${(++uidCount).toString(36)}${Math.random().toString(36).slice(2, 8)}`}`
}

/** `list` with the item whose `id` matches moved to `index` (counted without it); the same list when the id is missing. */
export function moveById<T extends { id: string | number }>(list: readonly T[], id: T['id'], index: number): T[] {
  const from = list.findIndex(x => x.id === id)
  if (from < 0) return list as T[]
  const rest = list.filter((_, i) => i !== from), at = clamp(Math.trunc(index) || 0, 0, rest.length)
  return [...rest.slice(0, at), list[from], ...rest.slice(at)]
}

/** Selector for elements that can take keyboard focus. Use `focusables(root)` to also drop hidden, inert and aria-hidden ones. */
export const FOCUSABLE = 'a[href],area[href],button:not([disabled]),input:not([disabled]):not([type=hidden]),select:not([disabled]),textarea:not([disabled]),iframe,audio[controls],video[controls],[contenteditable=""],[contenteditable="true"],[tabindex]:not([tabindex="-1"])'

/** The Tab stops inside `root`, in DOM order: visible, enabled, tabIndex ≥ 0, not inside [inert] or aria-hidden. */
export function focusables(root: ParentNode | null | undefined): HTMLElement[] {
  if (!root) return []
  return [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(el =>
    el.tabIndex >= 0 && !el.closest('[inert],[aria-hidden="true"]') && el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden')
}

const scrolls = (v: string) => v === 'auto' || v === 'scroll' || v === 'overlay'

/** The nearest ancestor of `el` that scrolls along `axis` (its content overflows and overflow allows scrolling), or null. */
export function scrollParent(el: Element | null | undefined, axis: 'x' | 'y' = 'y'): HTMLElement | null {
  for (let p = el?.parentElement; p; p = p.parentElement) {
    const cs = getComputedStyle(p)
    if (axis === 'y' ? scrolls(cs.overflowY) && p.scrollHeight > p.clientHeight : scrolls(cs.overflowX) && p.scrollWidth > p.clientWidth) return p
  }
  return null
}

/**
 * Scroll only `el`'s scroller (never the page, unlike scrollIntoView) so `el` is visible with `margin` px to spare.
 * `inset` reserves room at the start edge (a pinned column or header); `center` centres it instead; `scroller` skips
 * the ancestor search. Nothing moves when it is already in view.
 */
export function revealInScroller(el: HTMLElement | null | undefined, { axis = 'y', margin = 4, inset = 0, center = false, scroller }:
  { axis?: 'x' | 'y'; margin?: number; inset?: number; center?: boolean; scroller?: HTMLElement | null } = {}) {
  const box = scroller ?? scrollParent(el, axis)
  if (!el || !box) return
  const r = el.getBoundingClientRect(), b = box.getBoundingClientRect()
  const [start, size, bStart, bSize, key] = axis === 'y' ? [r.top, r.height, b.top + box.clientTop, box.clientHeight, 'scrollTop'] as const : [r.left, r.width, b.left + box.clientLeft, box.clientWidth, 'scrollLeft'] as const
  const rel = start - bStart, lo = inset + margin, hi = bSize - margin
  const delta = center ? rel + size / 2 - (inset + (bSize - inset) / 2) : rel < lo ? rel - lo : rel + size > hi ? Math.min(rel - lo, rel + size - hi) : 0
  if (delta) box[key] += delta
}

/** Save a Blob as a file through a temporary link (works offline and under a CSP without outside hosts). */
export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob), a = document.createElement('a')
  a.href = url; a.download = filename; a.rel = 'noopener'; a.style.display = 'none'
  document.body.appendChild(a); a.click(); a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 2000)
}

/** Write text (or a ClipboardItem, e.g. an image) to the clipboard; resolves false when it is unavailable or refused. */
export async function writeClipboard(data: string | ClipboardItem): Promise<boolean> {
  try {
    if (!navigator.clipboard) return false
    if (typeof data === 'string') await navigator.clipboard.writeText(data); else await navigator.clipboard.write([data])
    return true
  } catch { return false }
}

/**
 * Where an arrow, Home or End key moves the active item of a list (`cols` 0) or a grid of `cols` per row; null for any
 * other key. ↑/↓ move by a row; ←/→ stop at a row's ends unless `wrap`; Home/End go to the ends of the row (grid) or
 * list. A move past either end stays put.
 */
export function gridKeyMove(key: string, cur: number, count: number, cols = 0, wrap = false): number | null {
  const c = cols > 0 ? cols : 0, row = c ? cur - (cur % c) : 0, edge = c && !wrap
  const moves: Record<string, number> = {
    ArrowRight: edge && cur % c === c - 1 ? cur : cur + 1, ArrowLeft: edge && cur % c === 0 ? cur : cur - 1,
    ArrowDown: cur + (c || 1), ArrowUp: cur - (c || 1),
    Home: c && !wrap ? row : 0, End: c && !wrap ? Math.min(count - 1, row + c - 1) : count - 1,
  }
  const next = moves[key]
  return next === undefined ? null : next < 0 || next >= count ? cur : next
}

/**
 * Where an arrow, Home or End key moves the active item of a one-dimensional list: ↑/↓ for `vertical`, ←/→ for
 * `horizontal`, all four for `both`. `loop` wraps around (default), otherwise it stops at the ends. From no item (`cur`
 * -1), "next" goes to the first and "previous" to the last. Null for any other key or an empty list.
 */
export function listKeyMove(key: string, cur: number, count: number, { orientation = 'vertical', loop = true }: { orientation?: 'horizontal' | 'vertical' | 'both'; loop?: boolean } = {}): number | null {
  if (count <= 0) return null
  const v = orientation !== 'horizontal', h = orientation !== 'vertical'
  const d = (v && key === 'ArrowDown') || (h && key === 'ArrowRight') ? 1 : (v && key === 'ArrowUp') || (h && key === 'ArrowLeft') ? -1 : 0
  if (key === 'Home') return 0
  if (key === 'End') return count - 1
  if (!d) return null
  if (cur < 0 || cur >= count) return d > 0 ? 0 : count - 1
  const n = cur + d
  return loop ? (n + count) % count : clamp(n, 0, count - 1)
}

/**
 * The value an APG slider key gives: →/↑ +step, ←/↓ −step (`axis` 'x' or 'y' limits it to one pair), PageUp/PageDown
 * ±`page` (10 steps), Home/End `min`/`max`. Kept inside [min, max]; null for any other key.
 */
export function sliderKeyValue(key: string, value: number, { step = 1, page = step * 10, min, max, axis = 'both' }:
  { step?: number; page?: number; min: number; max: number; axis?: 'both' | 'x' | 'y' }): number | null {
  const x = axis !== 'y', y = axis !== 'x'
  const d = (x && key === 'ArrowRight') || (y && key === 'ArrowUp') ? step : (x && key === 'ArrowLeft') || (y && key === 'ArrowDown') ? -step
    : key === 'PageUp' ? page : key === 'PageDown' ? -page : null
  if (key === 'Home') return min
  if (key === 'End') return max
  return d === null ? null : clamp(value + d, min, max)
}

/**
 * The item a typeahead buffer lands on: the next label (after `from`, wrapping) that starts with `typed`, ignoring case.
 * A buffer of one repeated letter ("aaa") cycles through the items starting with it; a longer word may stay on the
 * current item. Skips `isDisabled` items; -1 when nothing matches.
 */
export function typeaheadIndex(labels: readonly string[], typed: string, from: number, isDisabled?: (i: number) => boolean): number {
  const n = labels.length, t = typed.toLowerCase()
  if (!n || !t) return -1
  const same = [...t].every(c => c === t[0]), q = same ? t[0] : t, start = same || from < 0 ? from + 1 : from
  for (let k = 0; k < n; k++) {
    const i = (((start + k) % n) + n) % n
    if (!isDisabled?.(i) && labels[i].toLowerCase().startsWith(q)) return i
  }
  return -1
}

/** Whether a composite item can take focus by arrow key: not `disabled` and not aria-disabled (an `asChild` link). */
const navEnabled = (el: HTMLElement) => !(el as HTMLButtonElement).disabled && el.getAttribute('aria-disabled') !== 'true'

/**
 * The element `key` moves the focus to among the enabled `items`, from the focused one: ↑/↓ in a `vertical` list, ←/→
 * in a `horizontal` one, Home/End to the ends. `loop` wraps around, otherwise it stops at the ends. Pass the keyboard
 * event to leave Alt/Ctrl/⌘ + arrow (history, word moves) to the browser. Null for any other key.
 */
export function focusStep(items: HTMLElement[], key: string | { key: string; altKey?: boolean; ctrlKey?: boolean; metaKey?: boolean },
  { orientation = 'vertical', loop = true }: { orientation?: 'horizontal' | 'vertical'; loop?: boolean } = {}): HTMLElement | null {
  if (typeof key !== 'string') { if (key.altKey || key.ctrlKey || key.metaKey) return null; key = key.key }
  const ok = items.filter(navEnabled)
  if (!ok.length) return null
  if (key === 'Home') return ok[0]
  if (key === 'End') return ok[ok.length - 1]
  const [prev, next] = orientation === 'vertical' ? ['ArrowUp', 'ArrowDown'] : ['ArrowLeft', 'ArrowRight']
  const d = key === next ? 1 : key === prev ? -1 : 0
  if (!d) return null
  // step through every item (not only the enabled ones), so a focused disabled item still has neighbours
  const n = items.length, i = items.indexOf(document.activeElement as HTMLElement)
  const from = i < 0 ? (d > 0 ? -1 : n) : i
  for (let s = 1; s <= n; s++) {
    let j = from + d * s
    if (loop) j = ((j % n) + n) % n
    else if (j < 0 || j >= n) return i >= 0 && navEnabled(items[i]) ? items[i] : null
    if (navEnabled(items[j])) return items[j]
  }
  return null
}
