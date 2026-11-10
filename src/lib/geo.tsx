import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react'
import { motion, useInView, useReducedMotion } from 'motion/react'
import { Button, Skeleton, TOUCH, clamp, cn, isTouch, maxOf, minOf, onMouseLeave, safeColor, useOutside, useTheme, fmt } from './core'
import { SegmentedControl } from './forms'
import { PointerTooltip, usePointerTooltip } from './overlay'
import { useFrameLoop } from './motion'

/** Country outlines for WorldMap: [iso numeric, name, svg path] in a `w`×`h` box. */
export type WorldMapData = { w: number; h: number; countries: [string, string, string][] }
/** The size of the bundled map; the placeholder uses it, so the map never changes size when its data arrives. */
const GEO_W = 600, GEO_H = 263

/** One lazily imported data module: load() once, read it synchronously after, and subscribe to its arrival. */
function geoLazy<T>(importer: () => Promise<T>) {
  let value: T | null = null, pending: Promise<T> | null = null
  const subs = new Set<() => void>()
  const load = () => pending ??= importer().then(v => { value = v; subs.forEach(f => f()); return v }, e => { pending = null; throw e })
  const subscribe = (f: () => void) => { subs.add(f); return () => { subs.delete(f) } }
  return { load, subscribe, get: () => value }
}
const geoWorld = geoLazy(() => import('./geoworld').then(m => m.WORLD_MAP as WorldMapData))
const geoLand = geoLazy(() => import('./geoland').then(m => m.GLOBE_LAND))
const geoNull = () => null
/** Starts loading a lazy data module on mount; returns it once loaded (null on the server and during hydration). */
function useGeoLazy<T>(lazy: ReturnType<typeof geoLazy<T>>, skip: boolean) {
  const value = useSyncExternalStore(lazy.subscribe, lazy.get, geoNull)
  useEffect(() => { if (!skip && !lazy.get()) lazy.load().catch(() => {}) }, [lazy, skip])
  return value
}
/** Loads the bundled world map (country outlines) once; later calls get the same promise. */
export const loadWorldMap = (): Promise<WorldMapData> => geoWorld.load()
/** Loads the bundled globe land points once; later calls get the same promise. */
export const loadGlobeLand = (): Promise<number[]> => geoLand.load()
/** The bundled world map, loaded on first use: null until it has arrived (always null during SSR and hydration). */
export const useWorldMap = (): WorldMapData | null => useGeoLazy(geoWorld, false)

export type MapMetric = { key: string; label: string; format: (v: number) => string; short?: (v: number) => string }
const GEO_STEPS = [12, 28, 46, 66, 88]
const geoRamp = (s: number) => `color-mix(in srgb, var(--accent) ${s}%, var(--line))`
/** Horizontal centre of every country path (for the left-to-right entrance). */
const geoCentreCache = new WeakMap<WorldMapData, number[]>()
const geoCentres = (map: WorldMapData) => { let c = geoCentreCache.get(map); if (!c) geoCentreCache.set(map, c = map.countries.map(([, , d]) => { const xs = [...d.matchAll(/[ML](-?[\d.]+),/g)].map(m => +m[1]); return xs.length ? (minOf(xs) + maxOf(xs)) / 2 : 0 })); return c }

/**
 * World choropleth by country with a metric switch. Five-step ramp from the accent, pulsing hub markers,
 * a hover or tap tooltip per country, a legend and a top-countries list whose bars animate; hover or tap a row to
 * spotlight that country (tap outside to clear). The list sits under the map on narrow screens. Countries fade
 * in from west to east when scrolled into view. The country outlines load on first render (`loadWorldMap`); until then a
 * placeholder of the map's exact size shimmers in its place (also what the server renders). Pass `map` to supply them yourself.
 */
export function WorldMap({ data, metrics, hubs = [], names = {}, top = 8, map, className }:
  { data: Record<string, Record<string, number> | null | undefined>; metrics: MapMetric[]; hubs?: [string, number, number][]; names?: Record<string, string>; top?: number
    /** country outlines (default: the bundled map, loaded lazily); hub coordinates are in its w×h box */
    map?: WorldMapData; className?: string }) {
  const loaded = useGeoLazy(geoWorld, !!map)
  const world = map ?? loaded, W = world?.w ?? GEO_W, H = world?.h ?? GEO_H
  const [metric, setMetric] = useState(metrics[0].key)
  const [hover, setHover] = useState<string | null>(null)
  const [spot, setSpot] = useState<string | null>(null)
  const ref = useRef<SVGSVGElement>(null)
  const inView = useInView(ref, { once: true, amount: 0.25 })
  const onScreen = useInView(ref) // hub pulses only run while the map is visible
  const reduce = useReducedMotion()
  const { tip, show, hide } = usePointerTooltip()
  const listRef = useRef<HTMLDivElement>(null)
  // touch: the leave that follows a tap is ignored; the next tap outside the map (or outside the list) clears instead
  useOutside([ref], () => setHover(null), !!hover)
  useOutside([listRef], () => setSpot(null), !!spot)
  const M = metrics.find(m => m.key === metric) ?? metrics[0]
  const countryTip = (n: string) => <><b className="font-semibold">{n}</b><br /><span className="text-[var(--fg2)]">{data[n] ? M.format(data[n]![metric]) : 'No data'}</span></>
  const max = maxOf(Object.values(data).filter(Boolean).map(v => v![metric] ?? 0), 1)
  const fill = (n: string) => { const v = data[n]?.[metric]; if (v == null) return 'var(--muted)'; const t = v / max; return geoRamp(GEO_STEPS[t < 0.1 ? 0 : t < 0.25 ? 1 : t < 0.45 ? 2 : t < 0.7 ? 3 : 4]) }
  const xs = world ? geoCentres(world) : []
  const ranked = Object.entries(data).filter((e): e is [string, Record<string, number>] => !!e[1]).sort((a, b) => b[1][metric] - a[1][metric]).slice(0, top)
  const hovered = world?.countries.find(c => c[1] === hover)
  return (
    <div className={cn('flex flex-col gap-3', className)}>
      <div className="flex justify-end"><SegmentedControl size="sm" value={metric} onChange={setMetric} options={metrics.map(m => ({ value: m.key, label: m.label }))} /></div>
      <div className="grid items-start gap-5 md:grid-cols-[minmax(0,1fr)_230px]">
        <div className="flex min-w-0 flex-col gap-2">
          <div className="relative" aria-busy={!world}>
          <svg ref={ref} viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`World map by ${M.label.toLowerCase()}`} className="block h-auto w-full" onPointerLeave={onMouseLeave(() => { setHover(null); hide() })}>
            <g>
              {world?.countries.map(([id, n, d], i) => (
                <motion.path key={id + n} d={d} initial={{ opacity: reduce ? 1 : 0 }} animate={inView ? { opacity: spot && spot !== n ? 0.35 : 1 } : undefined}
                  transition={{ duration: 0.4, delay: spot !== null || !inView ? 0 : (xs[i] / W) * 0.8 }}
                  className="cursor-pointer stroke-[var(--card)] [stroke-width:.5] transition-[fill] duration-350" style={{ fill: fill(n) }}
                  onPointerEnter={() => setHover(n)} onPointerDown={e => { setHover(n); show(e, countryTip(n)) }} onPointerMove={e => show(e, countryTip(n))} />
              ))}
            </g>
            {hovered && <path d={hovered[2]} className="pointer-events-none stroke-[var(--fg)] [stroke-width:.9]" style={{ fill: fill(hovered[1]) }} />}
            <g>
              {hubs.map(([n, x, y]) => (
                <g key={n}>
                  <circle cx={x} cy={y} r={2.6} fill="var(--c3)" stroke="var(--card)" strokeWidth={1} pointerEvents="none" />
                  <circle cx={x} cy={y} r={7} fill="transparent" className="cursor-pointer"
                    onPointerEnter={() => setHover(null)} onPointerDown={e => { setHover(null); show(e, <><b className="font-semibold">{n}</b><br /><span className="text-[var(--fg2)]">{'Regional hub'}</span></>) }}
                    onPointerMove={e => show(e, <><b className="font-semibold">{n}</b><br /><span className="text-[var(--fg2)]">{'Regional hub'}</span></>)} />
                </g>
              ))}
            </g>
          </svg>
          {/* until the outlines arrive: a shimmer over the (already full-size) empty map, so nothing moves when they do */}
          {!world && <Skeleton className="pointer-events-none absolute inset-0 !rounded-[var(--r-lg)] opacity-60" />}
          {/* hub pulses: HTML rings over the map, animated on the compositor (transform + opacity), so they cost no layout */}
          {!reduce && hubs.map(([n, x, y], i) => <GeoHubPulse key={n} x={x / W} y={y / H} size={(19.2 / W) * 100} delay={i * 270} active={onScreen} />)}
          </div>
          <div className="flex flex-wrap items-center gap-2 text-[11px] text-[var(--fg3)]">
            <span>{'Low'}</span><span className="flex gap-0.5">{GEO_STEPS.map(s => <i key={s} className="block h-2 w-[22px] rounded-[var(--r-sm)]" style={{ background: geoRamp(s) }} />)}</span><span>{'High'}</span>
            <span className="ms-2.5 inline-flex items-center gap-1"><i className="inline-block h-2 w-2 rounded-[var(--r-sm)] bg-[var(--muted)]" />{'No data'}</span>
          </div>
        </div>
        <div ref={listRef} className="flex flex-col gap-0.5">
          <div className="mb-1.5 text-xs text-[var(--fg3)]">{`Top countries · ${M.label}`}<span className="hidden [@media(pointer:coarse)]:inline">{' · tap to spotlight'}</span></div>
          {ranked.map(([n, v], i) => (
            <div key={n} className={cn('flex cursor-default items-center gap-2 rounded-[var(--r-md)] px-1.5 py-1 text-xs hover:bg-[var(--muted)]', TOUCH.tap36, spot === n && 'bg-[var(--muted)]')}
              onPointerEnter={e => { if (!isTouch(e)) setSpot(n) }} onPointerDown={e => { if (isTouch(e)) setSpot(s => (s === n ? null : n)) }} onPointerLeave={onMouseLeave(() => setSpot(null))}>
              <span className="min-w-0 flex-1 truncate">{names[n] ?? n}</span>
              <span className="h-[5px] w-11 flex-none overflow-hidden rounded-[var(--r-sm)] bg-[var(--muted)]">
                {/* scaleX from the start edge, not width: the bar grows without a layout per frame */}
                <motion.i key={metric} className="block h-full origin-left rounded-[var(--r-sm)] bg-[var(--accent)]" initial={{ scaleX: reduce ? v[metric] / ranked[0][1][metric] : 0 }}
                  animate={inView ? { scaleX: v[metric] / ranked[0][1][metric] } : undefined} transition={{ duration: 0.6, delay: i * 0.04, ease: [0.22, 1, 0.36, 1] }} />
              </span>
              <span className="w-[46px] text-end font-[family-name:var(--mono)] text-[11px] text-[var(--fg2)]">{(M.short ?? M.format)(v[metric])}</span>
            </div>
          ))}
        </div>
      </div>
      <PointerTooltip tip={tip} />
    </div>
  )
}

/**
 * A hub's expanding ring: an HTML element over the map with a native keyframe animation (WAAPI: scale + fade), so it
 * runs on the compositor with no script, style writes or layout per frame; paused (not torn down) while off screen.
 * `x`, `y` are fractions of the map box, `size` the ring's final diameter in % of its width.
 */
function GeoHubPulse({ x, y, size, delay, active }: { x: number; y: number; size: number; delay: number; active: boolean }) {
  const ref = useRef<HTMLSpanElement>(null), anim = useRef<Animation | null>(null)
  useEffect(() => {
    const el = ref.current; if (!el || typeof el.animate !== 'function') return
    const a = el.animate([{ transform: 'translate(-50%,-50%) scale(0.31)', opacity: 0.9 }, { transform: 'translate(-50%,-50%) scale(1)', opacity: 0 }], { duration: 2200, delay, iterations: Infinity, easing: 'ease-out' })
    anim.current = a
    return () => { a.cancel(); anim.current = null }
  }, [delay])
  useEffect(() => { const a = anim.current; if (!a) return; if (active) a.play(); else a.pause() }, [active])
  return <span ref={ref} aria-hidden className="pointer-events-none absolute aspect-square rounded-full border-[1.5px] border-[var(--c3)] opacity-0"
    style={{ left: `${x * 100}%`, top: `${y * 100}%`, width: `${size}%`, transform: 'translate(-50%,-50%)' }} />
}

export type GlobeHub = [name: string, lon: number, lat: number]
export type GlobeRoute = { from: number; to: number; color: string; ms?: number }
type GeoVec = [number, number, number]
const GEO_RAD = Math.PI / 180
const geoVec = (lon: number, lat: number): GeoVec => [Math.cos(lat * GEO_RAD) * Math.sin(lon * GEO_RAD), Math.sin(lat * GEO_RAD), Math.cos(lat * GEO_RAD) * Math.cos(lon * GEO_RAD)]
const geoSlerp = (a: GeoVec, b: GeoVec, t: number): GeoVec => { const d = Math.acos(Math.max(-1, Math.min(1, a[0] * b[0] + a[1] * b[1] + a[2] * b[2]))), s = Math.sin(d) || 1, k1 = Math.sin((1 - t) * d) / s, k2 = Math.sin(t * d) / s; return [a[0] * k1 + b[0] * k2, a[1] * k1 + b[1] * k2, a[2] * k1 + b[2] * k2] }

/** Resolves CSS colours (including var(--token)) to [r, g, b] against an element, for canvas drawing. */
function geoResolver(el: Element) {
  const cv = document.createElement('canvas').getContext('2d')!, cs = getComputedStyle(el), cache = new Map<string, [number, number, number]>()
  return (c: string): [number, number, number] => {
    let hit = cache.get(c); if (hit) return hit
    const v = c.startsWith('var(') ? cs.getPropertyValue(c.slice(4, -1).split(',')[0].trim()).trim() : c
    cv.fillStyle = '#000'; cv.fillStyle = v || '#888'
    const s = cv.fillStyle as string
    hit = s.startsWith('#') ? [1, 3, 5].map(i => parseInt(s.slice(i, i + 2), 16)) as [number, number, number] : (s.match(/[\d.]+/g)?.slice(0, 3).map(Number) as [number, number, number]) ?? [128, 128, 128]
    cache.set(c, hit); return hit
  }
}
const GEO_NO_LAND: number[] = []
const geoRgba = ([r, g, b]: [number, number, number], a: number) => `rgba(${r},${g},${b},${a})`

/**
 * 3D dot globe on a canvas: land as dots, great-circle routes between hubs with travelling heads, pulsing hubs
 * with labels. Drag to spin (it keeps its momentum), toggle auto-rotate, hover or tap a route in the side list to
 * highlight it. On touch only sideways drags spin it, so vertical swipes keep scrolling the page; on phones the canvas
 * is no taller than it is wide. Colours come from the theme tokens and are re-read when the theme changes. The land points
 * load on first render (`loadGlobeLand`) unless you pass `land`; the canvas has its final size from the start.
 */
export function Globe({ hubs, routes, land: landProp, height = 440, className }:
  { hubs: GlobeHub[]; routes: GlobeRoute[]; /** land sample points, [lon, lat, …] (default: the bundled set, loaded lazily) */ land?: number[]; height?: number; className?: string }) {
  const loadedLand = useGeoLazy(geoLand, !!landProp)
  const land = landProp ?? loadedLand ?? GEO_NO_LAND
  const reduce = useReducedMotion()
  const [auto, setAuto] = useState(!reduce)
  const [hl, setHl] = useState(-1)
  const cvRef = useRef<HTMLCanvasElement>(null), bgRef = useRef<HTMLCanvasElement>(null)
  const visible = useInView(cvRef, { amount: 0.05 })
  const inView = useInView(cvRef, { once: true, amount: 0.3 })
  const pts = useMemo(() => { const out: GeoVec[] = []; for (let i = 0; i < land.length; i += 2) out.push(geoVec(land[i], land[i + 1])); return out }, [land])
  const arcs = useMemo(() => routes.map(r => {
    const A = geoVec(hubs[r.from][1], hubs[r.from][2]), B = geoVec(hubs[r.to][1], hubs[r.to][2]), dist = Math.acos(A[0] * B[0] + A[1] * B[1] + A[2] * B[2])
    return Array.from({ length: 49 }, (_, k) => { const t = k / 48, v = geoSlerp(A, B, t), h = 1 + Math.sin(t * Math.PI) * dist * 0.18; return [v[0] * h, v[1] * h, v[2] * h] as GeoVec })
  }), [routes, hubs])
  const latency = useMemo(() => routes.map((r, i) => r.ms ?? Math.round(20 + ((i * 73 + 41) % 180))), [routes])
  const S = useRef({ rotY: -10 * GEO_RAD, rotX: -20 * GEO_RAD, vY: 0, vX: 0, heads: routes.map((_, i) => (i * 0.37) % 1), drag: null as null | { x: number; y: number; t: number; touch?: boolean }, W: 0, H: 0, dpr: 1, col: null as null | ((c: string) => [number, number, number]), font: '' })
  const live = useRef({ auto, hl, reduce }); live.current = { auto, hl, reduce }
  const [grab, setGrab] = useState(false)
  const routesRef = useRef<HTMLDivElement>(null)
  useOutside([routesRef], () => setHl(-1), hl >= 0)
  const { tokens, dark } = useTheme()

  // the shaded disc and its rim never move: they are drawn once (per size and theme) on a canvas underneath, so a frame
  // paints only the dots, routes and hubs
  const drawBg = () => {
    const bg = bgRef.current, st = S.current; if (!bg || !st.col || !st.W) return
    const g = bg.getContext('2d')!, C = st.col, W = st.W, H = st.H, R = Math.min(W, H) * 0.42, cx = W / 2, cy = H / 2
    g.setTransform(st.dpr, 0, 0, st.dpr, 0, 0); g.clearRect(0, 0, W, H)
    const grd = g.createRadialGradient(cx - R * 0.35, cy - R * 0.35, R * 0.1, cx, cy, R); grd.addColorStop(0, geoRgba(C('var(--card)'), 1)); grd.addColorStop(1, geoRgba(C('var(--line)'), 1))
    g.fillStyle = grd; g.beginPath(); g.arc(cx, cy, R, 0, Math.PI * 2); g.fill(); g.strokeStyle = geoRgba(C('var(--fg3)'), 0.35); g.lineWidth = 1; g.stroke()
  }
  useEffect(() => {
    const cv = cvRef.current!, bg = bgRef.current!, st = S.current
    const size = () => {
      st.dpr = Math.min(2, devicePixelRatio || 1); st.W = cv.clientWidth; st.H = cv.clientHeight; cv.width = bg.width = st.W * st.dpr; cv.height = bg.height = st.H * st.dpr
      drawBg(); if (!looping.current) draw(0, performance.now())
    }
    size()
    const ro = new ResizeObserver(size); ro.observe(cv)
    return () => ro.disconnect()
  }, [])
  // canvas colours are resolved from the theme tokens: re-read them whenever the theme changes (works with
  // UIProvider target="self" too, where nothing on <html> changes)
  useEffect(() => {
    const cv = cvRef.current!, st = S.current
    st.col = geoResolver(cv); st.font = getComputedStyle(cv).fontFamily
    drawBg(); if (!looping.current) draw(0, performance.now()) // eslint-disable-line react-hooks/exhaustive-deps
  }, [tokens, dark]) // eslint-disable-line react-hooks/exhaustive-deps
  const draw = (dt: number, now: number) => {
    const cv = cvRef.current, st = S.current; if (!cv || !st.col || !st.W) return
    const g = cv.getContext('2d')!, { auto: spin, hl: h, reduce: still } = live.current, C = st.col
    // momentum decays per 60th of a second whatever the frame rate (0.95 and 0.9 per frame at 60 fps)
    if (!st.drag) { st.rotY += (st.vY + (spin ? 0.12 : 0)) * dt; st.rotX += st.vX * dt; st.vY *= 0.95 ** (dt * 60); st.vX *= 0.9 ** (dt * 60); st.rotX = clamp(st.rotX, -1.2, 1.2) }
    if (coasting.current && Math.abs(st.vY) + Math.abs(st.vX) < 0.002) { coasting.current = false; setCoast(false) }
    const W = st.W, H = st.H, R = Math.min(W, H) * 0.42, cx = W / 2, cy = H / 2
    const cY = Math.cos(st.rotY), sY = Math.sin(st.rotY), cX = Math.cos(st.rotX), sX = Math.sin(st.rotX)
    const proj = (v: GeoVec) => { const x1 = v[0] * cY + v[2] * sY, z1 = -v[0] * sY + v[2] * cY, y2 = v[1] * cX - z1 * sX, z2 = v[1] * sX + z1 * cX; return [cx + x1 * R, cy - y2 * R, z2] }
    g.setTransform(st.dpr, 0, 0, st.dpr, 0, 0); g.clearRect(0, 0, W, H)
    const fg = C('var(--fg)'), hubC = C('var(--c3)')
    // land dots, batched into alpha buckets so the fill style changes 9 times a frame, not once per dot
    const buckets: number[][] = Array.from({ length: 9 }, () => [])
    for (const v of pts) { const [x, y, z] = proj(v); if (z < -0.08) continue; buckets[z < 0 ? 0 : 1 + Math.min(7, Math.floor(z * 8))].push(x, y, 1.1 + Math.max(0, z) * 0.9) }
    buckets.forEach((b, k) => { if (!b.length) return; g.fillStyle = geoRgba(fg, k === 0 ? 0.08 : 0.25 + ((k - 0.5) / 8) * 0.6); for (let i = 0; i < b.length; i += 3) g.fillRect(b[i] - b[i + 2] / 2, b[i + 1] - b[i + 2] / 2, b[i + 2], b[i + 2]) })
    routes.forEach((r, i) => {
      if (!still) st.heads[i] = (st.heads[i] + dt * (0.25 + ((i * 0.13) % 0.2))) % 1.6
      const t = still ? 1 : st.heads[i], on = h < 0 || h === i, col = C(r.color), P = arcs[i].map(proj)
      const stroke = (from: number, to: number) => { g.beginPath(); let moved = false; for (let k = from; k <= to; k++) { const [x, y, z] = P[k]; if (z < -0.05) { moved = false; continue } if (moved) g.lineTo(x, y); else g.moveTo(x, y); moved = true } g.stroke() }
      g.lineWidth = h === i ? 2.4 : 1.4; g.strokeStyle = geoRgba(col, on ? 0.35 : 0.08); stroke(0, 48)
      const head = Math.min(1, t), tail = still ? 0 : Math.max(0, t - 0.35)
      if (head > tail) {
        g.strokeStyle = geoRgba(col, on ? 0.95 : 0.2); g.lineWidth = h === i ? 3 : 2; stroke(Math.floor(tail * 48), Math.floor(head * 48))
        const [hx, hy, hz] = P[Math.floor(head * 48)]
        if (hz > -0.05 && t < 1) { g.fillStyle = geoRgba(col, 1); g.beginPath(); g.arc(hx, hy, 2.6, 0, Math.PI * 2); g.fill() }
      }
    })
    hubs.forEach(([n, lon, lat], i) => {
      const [x, y, z] = proj(geoVec(lon, lat)); if (z < 0) return
      if (!still) { const p = ((now / 1000 + i * 0.3) % 2) / 2; g.strokeStyle = geoRgba(hubC, (1 - p) * 0.7 * z); g.lineWidth = 1.2; g.beginPath(); g.arc(x, y, 3 + p * 10, 0, Math.PI * 2); g.stroke() }
      g.fillStyle = geoRgba(hubC, 1); g.beginPath(); g.arc(x, y, 3, 0, Math.PI * 2); g.fill()
      if (z > 0.35) { g.font = `500 11px ${st.font}`; g.textAlign = 'left'; g.fillStyle = geoRgba(fg, Math.min(1, (z - 0.35) * 3)); g.fillText(n, x + 7, y + 4) }
    })
  }
  // the loop runs only while something moves: auto-rotate, a drag or its momentum, or the route heads and hub pulses
  // (which reduced motion turns off); 30 fps on touch screens. Otherwise the globe is redrawn when it changes.
  const [coast, setCoast] = useState(false), coasting = useRef(false)
  const loopOn = visible && (auto || grab || coast || !reduce), looping = useRef(loopOn); looping.current = loopOn
  useFrameLoop(loopOn, draw, { coarseFps: 30 })
  useEffect(() => { if (!loopOn) draw(0, performance.now()) }, [loopOn, hl, pts]) // eslint-disable-line react-hooks/exhaustive-deps
  const down = (e: ReactPointerEvent<HTMLCanvasElement>) => { const st = S.current; st.drag = { x: e.clientX, y: e.clientY, t: performance.now(), touch: isTouch(e) }; e.currentTarget.setPointerCapture(e.pointerId); st.vY = st.vX = 0; setGrab(true) }
  const move = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    const st = S.current; if (!st.drag) return
    const R = Math.min(st.W, st.H) * 0.42, dx = e.clientX - st.drag.x, dy = st.drag.touch ? 0 : e.clientY - st.drag.y, dtm = Math.max(1, performance.now() - st.drag.t) / 1000
    st.rotY += dx / R; st.rotX = clamp(st.rotX + dy / R, -1.2, 1.2); st.vY = (dx / R / dtm) * 0.6; st.vX = (dy / R / dtm) * 0.6
    st.drag = { x: e.clientX, y: e.clientY, t: performance.now(), touch: st.drag.touch }
    if (!looping.current) draw(0, performance.now())
  }
  const up = () => { const st = S.current; st.drag = null; setGrab(false); if (Math.abs(st.vY) + Math.abs(st.vX) >= 0.002) { coasting.current = true; setCoast(true) } }
  const row = (r: GlobeRoute, i: number): ReactNode => (
    <div key={i} className={cn('flex cursor-default items-center gap-2 rounded-[var(--r-md)] p-2 text-xs', TOUCH.tap36, hl === i && 'bg-[var(--muted)]')}
      onPointerEnter={e => { if (!isTouch(e)) setHl(i) }} onPointerDown={e => { if (isTouch(e)) setHl(h => (h === i ? -1 : i)) }}
      onPointerLeave={onMouseLeave(() => setHl(-1))} tabIndex={0} onFocus={() => setHl(i)} onBlur={() => setHl(-1)}>
      <i className="h-2 w-2 flex-none rounded-full" style={{ background: safeColor(r.color) }} /><span className="flex-1">{`${hubs[r.from][0]} → ${hubs[r.to][0]}`}</span>
      <b className="font-[family-name:var(--mono)] text-[11px] font-medium text-[var(--fg2)]">{`${fmt.number(latency[i])} ms`}</b>
    </div>
  )
  return (
    <div className={cn('flex flex-col gap-3', className)}>
      <div className="flex justify-end"><Button size="sm" className={TOUCH.tap36} aria-pressed={auto} onClick={() => setAuto(a => !a)}>{auto ? 'Auto-rotate on' : 'Auto-rotate off'}</Button></div>
      <div className="grid items-center gap-5 md:grid-cols-[minmax(0,1fr)_230px]">
        <motion.div className="relative" style={{ height: `min(${height}px, calc(100vw - 32px))` }}
          initial={{ opacity: 0, scale: 0.92 }} animate={inView ? { opacity: 1, scale: 1 } : undefined} transition={{ duration: 0.8, ease: [0.22, 1, 0.36, 1] }}>
          <canvas ref={bgRef} aria-hidden className="pointer-events-none absolute inset-0 block h-full w-full" />
          <canvas ref={cvRef} role="img" aria-label={'Rotating globe with routes between cities'} className={cn('relative block h-full w-full touch-pan-y', grab ? 'cursor-grabbing' : 'cursor-grab')}
            onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up} />
        </motion.div>
        <div ref={routesRef} className="flex flex-col gap-0.5"><div className="mb-1.5 text-xs text-[var(--fg3)]">{'Live routes'}<span className="hidden [@media(pointer:coarse)]:inline">{' · drag the globe sideways to spin it'}</span></div>{routes.map(row)}</div>
      </div>
    </div>
  )
}
