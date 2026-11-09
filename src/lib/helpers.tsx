/** Pure helpers: class names (cn, variants), spring(), numbers, seeded random, focusable elements. Part of @lyndon/ui/core. */


/* ════════════════════════════════════════════════════════════════════════════
 * 2. UTILITIES AND HOOKS
 * ══════════════════════════════════════════════════════════════════════════ */

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

/** One spring for the whole library, same signature as the original page: spring(bounce, duration). */
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

/** Repeatable pseudo-random numbers (mulberry32): const r = seeded(42); r() → 0…1, the same sequence every time (safe for SSR and demos). */
export function seeded(seed: number) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Selector for elements that can take keyboard focus. Use `focusables(root)` to also drop hidden, inert and aria-hidden ones. */
export const FOCUSABLE = 'a[href],area[href],button:not([disabled]),input:not([disabled]):not([type=hidden]),select:not([disabled]),textarea:not([disabled]),iframe,audio[controls],video[controls],[contenteditable=""],[contenteditable="true"],[tabindex]:not([tabindex="-1"])'

/** The Tab stops inside `root`, in DOM order: visible, enabled, tabIndex ≥ 0, not inside [inert] or aria-hidden. */
export function focusables(root: ParentNode | null | undefined): HTMLElement[] {
  if (!root) return []
  return [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(el =>
    el.tabIndex >= 0 && !el.closest('[inert],[aria-hidden="true"]') && el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden')
}
