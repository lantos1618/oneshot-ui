/** Pure helpers: class names (cn, variants), spring(), numbers, focusable elements, key-to-move maps, downloads and the clipboard. Part of @lyndon/ui/core. */

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

/** Resolves after `ms` milliseconds: await sleep(300). */
export const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms))

/** Keep `n` inside [lo, hi]: clamp(140, 0, 100) → 100. */
export const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n))

/**
 * Largest value, like Math.max(...values) (NaN propagates, empty → `init`) but with a loop, so huge arrays don't
 * overflow the call stack (spreading ~125k+ arguments throws RangeError).
 */
export function maxOf(values: Iterable<number>, init = -Infinity) { let m = init; for (const v of values) m = Math.max(m, v); return m }

/** Smallest value, like Math.min(...values) with a loop (see maxOf). */
export function minOf(values: Iterable<number>, init = Infinity) { let m = init; for (const v of values) m = Math.min(m, v); return m }

/** [min, max] in one pass, with a loop (see maxOf). Empty → [Infinity, -Infinity]. */
export function extent(values: Iterable<number>): [number, number] { let lo = Infinity, hi = -Infinity; for (const v of values) { lo = Math.min(lo, v); hi = Math.max(hi, v) } return [lo, hi] }

/** Selector for elements that can take keyboard focus. Use `focusables(root)` to also drop hidden, inert and aria-hidden ones. */
export const FOCUSABLE = 'a[href],area[href],button:not([disabled]),input:not([disabled]):not([type=hidden]),select:not([disabled]),textarea:not([disabled]),iframe,audio[controls],video[controls],[contenteditable=""],[contenteditable="true"],[tabindex]:not([tabindex="-1"])'

/** The Tab stops inside `root`, in DOM order: visible, enabled, tabIndex ≥ 0, not inside [inert] or aria-hidden. */
export function focusables(root: ParentNode | null | undefined): HTMLElement[] {
  if (!root) return []
  return [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(el =>
    el.tabIndex >= 0 && !el.closest('[inert],[aria-hidden="true"]') && el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden')
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
 * The element `key` moves the focus to among `items`, from the focused one: ↑/↓ in a `vertical` list, ←/→ in a
 * `horizontal` one, Home/End to the ends. `loop` wraps around, otherwise it stops at the ends. Null for any other key.
 */
export function focusStep(items: HTMLElement[], key: string, { orientation = 'vertical', loop = true }: { orientation?: 'horizontal' | 'vertical'; loop?: boolean } = {}): HTMLElement | null {
  if (!items.length) return null
  const [prev, next] = orientation === 'vertical' ? ['ArrowUp', 'ArrowDown'] : ['ArrowLeft', 'ArrowRight']
  const i = items.indexOf(document.activeElement as HTMLElement)
  const n = key === next ? i + 1 : key === prev ? (i < 0 ? items.length - 1 : i - 1) : key === 'Home' ? 0 : key === 'End' ? items.length - 1 : null
  if (n === null) return null
  return items[loop ? (n + items.length) % items.length : clamp(n, 0, items.length - 1)] ?? null
}
