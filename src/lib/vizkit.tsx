/** Chart and diagram math: series colours, linear scales, polar points and pie wedges, axis ticks. Used by the viz modules, never by core. */

/** A linear scale from the domain [d0, d1] onto [r0, r1]: `linScale(0, 100, 0, 320)(50)` → 160. A flat domain maps to the middle. */
export function linScale(d0: number, d1: number, r0: number, r1: number) {
  if (d1 === d0) return () => (r0 + r1) / 2
  const k = (r1 - r0) / (d1 - d0)
  return (v: number) => r0 + (v - d0) * k
}

/** The point at angle `a` (radians, 0 = 3 o'clock, clockwise in SVG) on a circle of radius `r` around (cx, cy). */
export const polarPt = (cx: number, cy: number, r: number, a: number): [number, number] => [cx + Math.cos(a) * r, cy + Math.sin(a) * r]

/** SVG path of a pie wedge from angle a0 to a1 (radians, clockwise), coordinates rounded to 0.1. */
export function svgWedge(cx: number, cy: number, r: number, a0: number, a1: number) {
  const f = (n: number) => n.toFixed(1), [x0, y0] = polarPt(cx, cy, r, a0), [x1, y1] = polarPt(cx, cy, r, a1)
  return `M${f(cx)},${f(cy)}L${f(x0)},${f(y0)}A${f(r)},${f(r)} 0 ${a1 - a0 > Math.PI ? 1 : 0} 1 ${f(x1)},${f(y1)}Z`
}

/**
 * Mid-grey series colour for "everything else" / baseline series (last year's bars, totals, other). It reads on cards in
 * light and dark, where `--fg`/`--c1` would glare white. Falls back to the muted text colour on themes without the token.
 */
export const CHART_NEUTRAL = 'var(--c-neutral, var(--muted-fg, var(--fg3)))'
/** Series colours, in order. Point these at your brand tokens. */
export const PALETTE = ['var(--c2)', 'var(--c3)', 'var(--c4)', CHART_NEUTRAL, 'var(--bad)', 'var(--warn)']
/** The colour of series `i`: its own `custom` colour, else the palette's, wrapping around. */
export const seriesColor = (i: number, custom?: string) => custom ?? PALETTE[i % PALETTE.length]

/** Round axis ticks: niceTicks(0, 87) → [0, 20, 40, 60, 80, 100] */
export function niceTicks(min: number, max: number, count = 4) {
  const raw = (max - min || 1) / count, mag = 10 ** Math.floor(Math.log10(raw)), f = raw / mag
  const step = (f >= 7.5 ? 10 : f >= 3.5 ? 5 : f >= 1.5 ? 2 : 1) * mag
  const lo = Math.floor(min / step) * step, hi = Math.ceil(max / step) * step
  return Array.from({ length: Math.round((hi - lo) / step) + 1 }, (_, i) => +(lo + i * step).toFixed(10))
}

/** niceTicks clipped to [lo, hi]. */
export const ticksIn = (lo: number, hi: number, count = 4) => niceTicks(lo, hi, count).filter(t => t >= lo - 1e-9 && t <= hi + 1e-9)
