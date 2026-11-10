import { memo, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type FocusEvent as ReactFocusEvent, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent, type ReactNode, type Ref, type RefObject, type CSSProperties } from 'react'
import { motion } from 'motion/react'
import { AnimatedNumber, Button, DeltaBadge, Icon, IconButton, SparkChart, TOUCH, chartPath, composeRefs, menuItemClass, type Curve, addDays, clamp, cn, dayKey, extent, fmt, isTouch, maxOf, minOf, onMouseLeave, prefersReducedMotion, releaseTouchCapture, safeColor, spring, startOfWeek, surface, useCoarsePointer, useControllable, useOutside, useWidth, plural, rangeStr, downloadBlob, writeClipboard, gridKeyMove, focusStep, useActiveIndex, useStatusFlash, useLive, Legend, useResizeObserver, svgN } from './core'
import { useTween, useViewport } from './motion'
import { CHART_NEUTRAL, PALETTE, linScale, niceTicks, polarPt, seriesColor, svgWedge, ticksIn } from './vizkit'
import { TAG_SR_ONLY, TagGlyph, TagTooltip, layoutTimeTags, timeTagLook, timeTagTint, timeTicks, useTagFocus, type TimeTag, type TimeTagKind, type TimeTagStyle } from './annotate'

export { CHART_NEUTRAL, PALETTE, niceTicks } from './vizkit'

/** Compact numbers: compact(12400) → "12.4K" (core fmt.compact). */
export const compact = fmt.compact

/** A cached time label per instant: a chart formats every x label on each render to size its axis (511 points for a long series). */
const chartTimeTexts = new Map<number, string>()
function chartTimeText(ms: number) {
  let s = chartTimeTexts.get(ms)
  if (s === undefined) { if (chartTimeTexts.size > 20000) chartTimeTexts.clear(); s = fmt.time(ms); chartTimeTexts.set(ms, s) }
  return s
}

/** Fixed decimals: chartFixed(1.234, 2) → "1.23". */
const chartFixed = (v: number, d = 1) => fmt.number(Math.round(v * 10 ** d) / 10 ** d, { minimumFractionDigits: d, maximumFractionDigits: d })
/** Whole percent of a fraction: 0.42 → "42%". */
const chartPct = (f: number) => fmt.percent(Number.isFinite(f) ? f : 0, 0)
/** Room for the widest y-tick label. */
const chartAxisPad = (labels: string[], min = 40) => Math.max(min, Math.ceil(maxOf(labels.map(s => s.length), 0) * 6.2 + 12))
/**
 * One row of chart data: the x label plus one field per series. Chart is generic over its rows, so typed rows
 * (interfaces included) work too and `x` / `series[].key` are checked against their keys; this is the untyped default.
 */
export type ChartDatum = Record<string, string | number | null | undefined>

/*
 * Several charts often scroll into view in the same frame. Starting all their draw-in animations inside the
 * IntersectionObserver callback made one long frame (200 ms+). Instead each chart queues its reveal and the queue
 * releases one chart per ~50 ms, outside the observer callback. */
const chartRevealQueue: (() => void)[] = []
let chartRevealTimer = 0
function chartRevealPump() {
  chartRevealTimer = 0
  chartRevealQueue.shift()?.()
  if (chartRevealQueue.length) chartRevealTimer = window.setTimeout(chartRevealPump, 50)
}
/** `seen`, released through the shared stagger queue (immediately for reduced motion and when nothing is queued). */
function useChartReveal(seen: boolean) {
  const [shown, setShown] = useState(false)
  useEffect(() => {
    if (!seen || shown) return
    let live = true
    const go = () => { if (live) setShown(true) }
    if (prefersReducedMotion()) { go(); return }
    chartRevealQueue.push(go)
    if (!chartRevealTimer) chartRevealTimer = window.setTimeout(chartRevealPump, 0)
    return () => { live = false; const k = chartRevealQueue.indexOf(go); if (k >= 0) chartRevealQueue.splice(k, 1) }
  }, [seen, shown])
  return shown
}

/** Ref, width and a flag that turns true once the element has scrolled into view (charts draw from zero until then). */
function useChartFrame<T extends HTMLElement>(amount = 0.25) {
  const [ref, w] = useWidth<T>()
  const { seen } = useViewport(ref, { amount })
  return [ref, w, useChartReveal(seen)] as const
}
/** Ref plus the scrolled-into-view flag. */
function useChartSeen<T extends Element>(amount = 0.25) {
  const { ref, seen } = useViewport<T>(null, { amount })
  return [ref, useChartReveal(seen)] as const
}

/** 'hidden' (default): a visually hidden table for screen readers; 'toggle': plus a "Show data" button; 'shown': on screen. */
export type ChartTableMode = 'hidden' | 'toggle' | 'shown'
/** Props every chart in the kit shares: the data table, the export menu and a ref to the chart's root (for exportChart). */
export type ChartKitProps = {
  /** the data table: 'hidden' (default, screen readers only), 'toggle' (a "Show data" button) or 'shown' */
  table?: ChartTableMode
  /** a ⋯ menu under the chart: Download PNG / SVG / CSV and Copy image (exportChart) */
  exportable?: boolean
  /** the chart's root element: pass it to exportChart */
  ref?: Ref<HTMLDivElement>
}
/** One cell of a chart's data table, raw: numbers keep their value for CSV (`data-v`) and are formatted for display. */
export type ChartCellValue = string | number | null | undefined
/** A chart's data as raw rows (the first column is the row header) and optional per-column formats for display (numbers default to the locale's). */
export type ChartTable = { head: string[]; rows: ChartCellValue[][]; formats?: (((v: never) => string) | undefined)[] }
/** Plain text of a label that may be a node (BarList labels): strings and numbers, else empty. */
const chartText = (l: ReactNode): string => (typeof l === 'string' || typeof l === 'number' ? String(l) : Array.isArray(l) ? l.map(chartText).join('') : '')

const chartTableSame = (a: ChartTable, b: ChartTable) => a === b || (a.head.join('\u0000') === b.head.join('\u0000') && a.rows.length === b.rows.length
  && a.rows.every((r, i) => r.length === b.rows[i].length && r.every((c, j) => c === b.rows[i][j])) && (a.formats ?? []).every((f, i) => f === b.formats?.[i]))
/**
 * The data table (memoised: a chart re-renders on every hover, its data rarely). Numbers are end-aligned with tabular
 * digits, formatted by their column's format or the locale's; the visible table scrolls inside a bounded, focusable box.
 */
const ChartDataTable = memo(function ChartDataTable({ id, sumId, label, summary, data, visible }:
  { id: string; sumId: string; label: string; summary: string; data: ChartTable; visible: boolean }) {
  const numeric = data.head.map((_, ci) => ci > 0 && data.rows.length > 0 && data.rows.every(r => r[ci] === undefined || r[ci] === null || typeof r[ci] === 'number'))
  const text = (v: ChartCellValue, ci: number) => {
    if (v === null || v === undefined) return ''
    const f = data.formats?.[ci] as ((v: string | number) => string) | undefined
    return f ? f(v) : typeof v === 'number' ? fmt.number(v) : v
  }
  return (
    <div id={id} data-chart-noexport {...(visible ? { role: 'region', 'aria-label': label, tabIndex: 0 } : {})}
      className={visible ? 'mt-3 max-h-[260px] self-stretch overflow-auto overscroll-contain rounded-[var(--r-md)] border border-[var(--line)] outline-none focus-visible:shadow-[0_0_0_2px_var(--accent)]' : 'sr-only'}>
      <table data-chart-table className="w-full border-collapse text-[13px]">
        <caption className="sr-only">{label}: <span id={sumId}>{summary}</span></caption>
        <thead className="sticky top-0 z-[1] bg-[var(--card)]">
          <tr>{data.head.map((h, i) => <th key={i} scope="col" className={cn('border-b border-[var(--line)] px-2.5 py-1.5 text-xs font-medium whitespace-nowrap text-[var(--fg2)]', numeric[i] ? 'text-end' : 'text-start')}>{h}</th>)}</tr>
        </thead>
        <tbody>
          {data.rows.map((r, ri) => (
            <tr key={ri} className="border-b border-[var(--line)] last:border-b-0">
              {r.map((v, ci) => ci === 0
                ? <th key={ci} scope="row" data-v={v ?? ''} className="px-2.5 py-1 text-start font-normal whitespace-nowrap">{text(v, ci)}</th>
                : <td key={ci} data-v={v ?? ''} className={cn('px-2.5 py-1 whitespace-nowrap', numeric[ci] ? 'ui-num text-end' : 'text-start')}>{text(v, ci)}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}, (a, b) => a.id === b.id && a.sumId === b.sumId && a.label === b.label && a.summary === b.summary && a.visible === b.visible && chartTableSame(a.data, b.data))

/** Options of useChartShell. */
export type ChartShellOptions = ChartKitProps & {
  /** the plot box: the focusable element that holds the marks (the chart's seen/width ref) */
  box: RefObject<HTMLDivElement | null>
  /** number of keyboard points (in a grid: rows × columns, row by row) */
  count: number
  /** accessible name */
  label: string
  /** one or two sentences describing the data (the table's caption, and the chart's description) */
  summary: string
  /** what a screen reader hears when the keyboard lands on point `i` */
  describe: (i: number) => string
  /** the data table (charts without one, such as SparkTile, get the summary as plain hidden text) */
  data?: ChartTable
  /** grid charts (heatmaps): points per row, so ↑/↓ move by a row and Home/End stay in the row */
  columns?: number
  /** the point the first arrow press lands on (default 0) */
  start?: number
  /** tooltip body for point `i`: shown over the element marked data-ci={i} when the keyboard lands on it, and by `bind(i)` for pointers */
  tip?: (i: number) => ReactNode
}
type ChartTip = { x: number; y: number; body: ReactNode }

/**
 * Everything a chart shares besides its marks: the active (hovered or keyboard) point, the keyboard model, the polite
 * live region, the pointer/keyboard tooltip, the data table with its "Show data" toggle, and the export menu. The chart
 * is one Tab stop (role=group, roledescription "chart", its name, and the table caption as its description). ←/→ step
 * through the points (↑/↓ too, or by a row in a grid), Home/End jump to the ends, Escape clears; Tab focus lands on the
 * first point, a mouse click doesn't. Render the result with `<ChartShell shell={…}>`.
 */
export function useChartShell(o: ChartShellOptions) {
  const { box, count, columns = 0, start = 0, tip: tipBody } = o
  const id = useId(), tblId = `${id}-tbl`, sumId = `${id}-sum`
  const [hover, setHover, leave] = useActiveIndex(count, box)
  const [say, live] = useLive()
  const [tip, setTip] = useState<ChartTip | null>(null)
  useOutside([box], () => setTip(null), !!tip, { escape: true })
  const [open, setOpen] = useState(o.table === 'shown')
  const [mode, setMode] = useState(o.table)
  if (mode !== o.table) { setMode(o.table); setOpen(o.table === 'shown') }
  const tipAt = (i: number | null) => {
    const b = box.current, el = i === null ? null : b?.querySelector(`[data-ci="${i}"]`)
    if (!b || !el || !tipBody) { setTip(null); return }
    const r = el.getBoundingClientRect(), bb = b.getBoundingClientRect()
    setTip({ x: r.left - bb.left + Math.min(r.width / 2, 60), y: r.top - bb.top - 34, body: tipBody(i!) })
  }
  const go = (i: number | null) => { setHover(i); say(i === null ? '' : o.describe(i)); if (tipBody) tipAt(i) }
  const place = (e: ReactPointerEvent, body: (() => ReactNode) | undefined) => { const r = box.current?.getBoundingClientRect(); if (r && body) setTip({ x: e.clientX - r.left, y: e.clientY - r.top - (isTouch(e) ? 70 : 34), body: body() }) }
  /** Pointer handlers for point `i`'s element: hover it and show its tooltip (`tip`, or `body` for a part such as an outlier) at the pointer. */
  const bind = (i: number, body = tipBody && (() => tipBody(i))) => ({
    onPointerEnter: () => setHover(i),
    onPointerDown: (e: ReactPointerEvent) => { releaseTouchCapture(e); setHover(i); place(e, body) },
    onPointerMove: (e: ReactPointerEvent) => place(e, body),
    onPointerLeave: onMouseLeave(() => setTip(null)),
  })
  const onKeyDown = (e: ReactKeyboardEvent<HTMLElement>) => {
    if (!count || e.altKey || e.ctrlKey || e.metaKey) return
    if (e.key === 'Escape') { if (hover !== null) { e.preventDefault(); go(null) } return }
    const next = hover === null ? (gridKeyMove(e.key, 0, count, columns) === null ? null : start) : gridKeyMove(e.key, hover, count, columns)
    if (next === null) return
    e.preventDefault()
    go(clamp(next, 0, count - 1))
  }
  const focusProps = {
    tabIndex: 0, role: 'group', 'aria-roledescription': 'chart', 'aria-label': o.label, 'aria-describedby': sumId, onKeyDown, ...leave,
    onFocus: (e: ReactFocusEvent<HTMLElement>) => { if (e.target === e.currentTarget && hover === null && count && e.currentTarget.matches(':focus-visible')) go(clamp(start, 0, count - 1)) },
    onBlur: (e: ReactFocusEvent<HTMLElement>) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) go(null) },
  }
  return { hover, setHover, bind, tip, focusProps, live, open, setOpen, tblId, sumId, o }
}
export type ChartShellState = ReturnType<typeof useChartShell>

/** Focus ring for a chart's focusable box (the active point carries the second, data-level mark). */
const CHART_FOCUS = 'rounded-[var(--r-md)] outline-none focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[var(--accent)]'

/**
 * Renders a chart around its marks: the focusable plot box (`boxClassName`, `style`; the marks are `children`) with the
 * live region and tooltip, then `after` (a legend or footer outside the box), the "Show data" / export bar and the data
 * table. The box is the chart's root (it carries `ref`, `className` and the export attributes) unless something sits next
 * to it; then an outer root does.
 */
function ChartShell({ shell, className, boxClassName, style, after, children }:
  { shell: ChartShellState; className?: string; boxClassName?: string; style?: CSSProperties; after?: ReactNode; children: ReactNode }) {
  const { o, open, setOpen, tblId, sumId, tip, live, focusProps } = shell
  const { table = 'hidden', exportable = false, ref: userRef, box, label, summary, data } = o
  const root = useRef<HTMLDivElement | null>(null)
  const bar = table === 'toggle' || exportable, visible = table === 'shown' || (table === 'toggle' && open)
  const outer = !!after || bar || table === 'shown'
  const rootRef = useMemo(() => composeRefs<HTMLDivElement>(root, userRef), [userRef])
  const boxRef = useMemo(() => (outer ? box : composeRefs<HTMLDivElement>(box, root, userRef)), [outer, box, userRef])
  const rootProps = { 'data-chart-root': '', 'data-chart-name': label }
  const tableEl = data ? <ChartDataTable id={tblId} sumId={sumId} label={label} summary={summary} data={data} visible={visible} /> : <span id={sumId} className="sr-only">{summary}</span>
  const plot = (
    <div ref={boxRef} {...(outer ? null : rootProps)} {...focusProps} className={cn('relative', CHART_FOCUS, boxClassName, !outer && className)} style={style}>
      {live}
      {children}
      {tip && <ChartTooltip x={tip.x} y={tip.y} width={box.current?.clientWidth ?? 300}>{tip.body}</ChartTooltip>}
      {!outer && tableEl}
    </div>
  )
  if (!outer) return plot
  return (
    <div ref={rootRef} {...rootProps} className={className}>
      {plot}
      {after}
      {bar && (
        // there from the first render (no layout shift); the menu opens over the chart
        <div data-chart-noexport className="mt-2 flex items-center justify-end gap-1 self-stretch">
          {table === 'toggle' && (
            <Button size="xs" variant="ghost" aria-expanded={open} aria-controls={tblId} onClick={() => setOpen(v => !v)}>
              <Icon name="columns" size={13} />{open ? 'Hide data' : 'Show data'}
            </Button>
          )}
          {exportable && <ChartExportMenu root={root} />}
        </div>
      )}
      {tableEl}
    </div>
  )
}

/** Formats for exportChart. */
export type ChartExportFormat = 'svg' | 'png' | 'csv'
/** Options of exportChart. */
export type ChartExportOptions = {
  format: ChartExportFormat
  /** PNG pixels per CSS pixel (default: the screen's, at least 2; lowered to stay under 16 megapixels) */
  scale?: number
  /** file name without the extension (default: the chart's label, e.g. "2025-and-2026-chart") */
  fileName?: string
  /** save the file (default true); `false` only returns the Blob (Copy image uses that) */
  download?: boolean
  /** 'auto' (default: the card colour behind the chart), any CSS colour, or 'none' for a transparent background */
  background?: string
}
type ChartExportTarget = Element | RefObject<Element | null> | null | undefined

/**
 * Export a chart as an SVG or PNG image or as CSV, and download it (`download: false` only returns the Blob).
 * `target` is the chart's ref (every chart takes `ref`), its root element, or any element around one chart.
 * Images are drawn from what is on screen, with theme colours, fonts and opacity inlined as plain values, so the file
 * looks the same outside the page (no CSS variables, classes or external resources). HTML parts of a chart (legends,
 * bar lists, heatmap cells, treemap tiles) are redrawn as SVG rects and text. PNG renders that SVG to a canvas through a
 * blob URL (a data URL if the page's CSP blocks blob images). CSV comes from the chart's data table: raw values,
 * UTF-8 with a BOM so spreadsheets read accents, and text cells that look like formulas are prefixed with '.
 *   const ref = useRef(null); <Chart ref={ref} … />; exportChart(ref, { format: 'png' })
 */
export async function exportChart(target: ChartExportTarget, options: ChartExportOptions): Promise<Blob> {
  const el = target && 'current' in target ? target.current : target
  if (!el) throw new Error('exportChart: no chart element')
  const root = el.closest('[data-chart-root]') ?? el.querySelector('[data-chart-root]') ?? el
  const label = root.getAttribute('data-chart-name') ?? '', name = chartFileName(options.fileName ?? label)
  let blob: Blob
  if (options.format === 'csv') blob = new Blob(['﻿', chartCsv(root)], { type: 'text/csv;charset=utf-8' })
  else {
    const img = chartSvgOf(root, options.background ?? 'auto', label || name)
    blob = options.format === 'svg' ? new Blob([img.svg], { type: 'image/svg+xml;charset=utf-8' })
      : await chartPng(img.svg, img.width, img.height, options.scale ?? Math.max(2, typeof devicePixelRatio === 'number' ? devicePixelRatio : 1))
  }
  if (options.download !== false) downloadBlob(blob, `${name}.${options.format}`)
  return blob
}

/** "Revenue by month, 2026" → "revenue-by-month-2026" (letters of any script kept). */
const chartFileName = (s: string) => s.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-+|-+$/g, '').slice(0, 80) || 'chart'

/** The chart's data table as CSV (RFC 4180 quoting). */
function chartCsv(root: Element) {
  const table = root.querySelector('table[data-chart-table]')
  if (!table) return ''
  const cell = (c: Element) => {
    const raw = c.getAttribute('data-v') ?? c.textContent ?? ''
    const s = /^[=+\-@\t\r]/.test(raw) && !Number.isFinite(Number(raw)) ? `'${raw}` : raw // no formula injection
    return /[",\r\n]/.test(s) || s !== s.trim() ? `"${s.replace(/"/g, '""')}"` : s
  }
  return [...table.querySelectorAll('tr')].map(tr => [...tr.children].map(cell).join(',')).join('\r\n') + '\r\n'
}

/** Draw an SVG string to a PNG at `scale` (capped at 16 megapixels, the iOS canvas limit). */
async function chartPng(svg: string, width: number, height: number, scale: number): Promise<Blob> {
  const s = Math.max(0.1, Math.min(scale, Math.sqrt(16e6 / Math.max(1, width * height))))
  const img = new Image()
  const load = (src: string) => new Promise<void>((ok, bad) => { img.onload = () => ok(); img.onerror = () => bad(new Error('exportChart: the image did not load')); img.src = src })
  const url = typeof URL.createObjectURL === 'function' ? URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml;charset=utf-8' })) : ''
  try {
    try { if (!url) throw new Error('no blob URLs'); await load(url) } catch { await load(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`) }
    const c = document.createElement('canvas')
    c.width = Math.max(1, Math.round(width * s)); c.height = Math.max(1, Math.round(height * s))
    const ctx = c.getContext('2d')
    if (!ctx) throw new Error('exportChart: no 2D canvas')
    ctx.scale(s, s); ctx.drawImage(img, 0, 0, width, height)
    return await new Promise<Blob>((ok, bad) => c.toBlob(b => (b ? ok(b) : bad(new Error('exportChart: the canvas gave no PNG'))), 'image/png'))
  } finally { if (url) URL.revokeObjectURL(url) }
}

/* ── SVG from the rendered chart ── */

const chartEsc = (s: string) => s.replace(/[&<>"]/g, c => (c === '&' ? '&amp;' : c === '<' ? '&lt;' : c === '>' ? '&gt;' : '&quot;'))
const chartN = (n: number) => String(Math.round(n * 100) / 100)
/** Resolve var(--x, fallback) in a value from the element's (inherited) custom properties. */
function chartResolveVars(value: string, el: Element): string {
  let s = value
  for (let guard = 0; guard < 12 && s.includes('var('); guard++) {
    const at = s.indexOf('var(')
    let depth = 0, end = at + 4, comma = -1
    for (; end < s.length; end++) {
      const ch = s[end]
      if (ch === '(') depth++
      else if (ch === ')') { if (depth === 0) break; depth-- }
      else if (ch === ',' && depth === 0 && comma < 0) comma = end
    }
    const name = s.slice(at + 4, comma < 0 ? end : comma).trim(), fallback = comma < 0 ? '' : s.slice(comma + 1, end).trim()
    let found = ''
    for (let a: Element | null = el; a && !found; a = a.parentElement) found = getComputedStyle(a).getPropertyValue(name).trim()
    s = s.slice(0, at) + (found || fallback) + s.slice(end + 1)
  }
  return s
}
/** Any CSS colour (color-mix, oklab, color(srgb …)) as rgb()/rgba(), through a 1×1 canvas; plain values pass through. */
const chartColorCache = new Map<string, string>()
let chartColorCtx: CanvasRenderingContext2D | null | undefined
function chartColor(c: string): string {
  const v = c.trim()
  if (!v || /^(#|rgba?\(|none$|transparent$|url\(|currentcolor$|context-)/i.test(v) || /^[a-z]+$/i.test(v)) return v
  const hit = chartColorCache.get(v)
  if (hit) return hit
  let out = v
  try {
    if (chartColorCtx === undefined) { const cv = document.createElement('canvas'); cv.width = cv.height = 1; chartColorCtx = cv.getContext('2d', { willReadFrequently: true }) }
    const ctx = chartColorCtx
    if (ctx) {
      ctx.clearRect(0, 0, 1, 1); ctx.fillStyle = '#000'; ctx.fillStyle = v; ctx.fillRect(0, 0, 1, 1)
      const [r, g, b, a] = ctx.getImageData(0, 0, 1, 1).data
      out = a === 255 ? `rgb(${r}, ${g}, ${b})` : `rgba(${r}, ${g}, ${b}, ${chartN(a / 255)})`
    }
  } catch { /* keep the value as it is */ }
  chartColorCache.set(v, out)
  return out
}
const chartClear = (c: string) => !c || c === 'transparent' || /^rgba\(.*,\s*0\)$/.test(c) || c === 'none'
/** Initial values: a computed value equal to one of these while the element sets its own value means the engine didn't apply it (jsdom). */
const CHART_INITIAL: Record<string, string> = { fill: 'rgb(0, 0, 0)', stroke: 'none', color: 'rgb(0, 0, 0)', 'stop-color': 'rgb(0, 0, 0)', 'background-color': 'rgba(0, 0, 0, 0)', opacity: '1' }
/** The computed value, or the element's own value (inline style, then attribute) with its variables resolved where the engine left it unresolved. */
function chartStyle(cs: CSSStyleDeclaration, prop: string, el: Element, own?: string | null) {
  const v = cs.getPropertyValue(prop).trim()
  if (own && (!v || v.includes('var(') || v === CHART_INITIAL[prop])) return chartResolveVars(own, el)
  return v.includes('var(') ? chartResolveVars(v, el) : v
}
const CHART_SVG_PAINT = ['fill', 'stroke', 'stop-color'] as const
const CHART_SVG_PROPS: Record<string, string | null> = {
  fill: null, stroke: 'none', 'stop-color': null, 'stroke-width': null, 'stroke-dasharray': 'none', 'stroke-dashoffset': '0px', 'stroke-linecap': 'butt',
  'stroke-linejoin': 'miter', opacity: '1', 'fill-opacity': '1', 'stroke-opacity': '1', 'stop-opacity': '1',
}
const CHART_SVG_TEXT: Record<string, string | null> = { 'font-family': null, 'font-size': null, 'font-weight': '400', 'font-style': 'normal' }
/** A CSS transform about its origin, as an SVG transform (or '' for none/identity). */
function chartTransform(cs: CSSStyleDeclaration, ox: number, oy: number) {
  const m = cs.transform
  if (!m || m === 'none' || m === 'matrix(1, 0, 0, 1, 0, 0)') return ''
  return `translate(${chartN(ox)} ${chartN(oy)}) ${m.replace(/,\s*/g, ' ')} translate(${chartN(-ox)} ${chartN(-oy)})`
}

/** One <svg> of the chart, cloned with its computed paint inlined, placed at its position in the export. */
function chartSvgClone(svg: SVGSVGElement, ox: number, oy: number, opacity: number) {
  const r = svg.getBoundingClientRect(), cs = getComputedStyle(svg)
  const w = svg.clientWidth || parseFloat(svg.getAttribute('width') ?? '') || r.width, h = svg.clientHeight || parseFloat(svg.getAttribute('height') ?? '') || r.height
  const clone = svg.cloneNode(true) as SVGSVGElement
  const src = [svg, ...svg.querySelectorAll('*')], dst = [clone, ...clone.querySelectorAll('*')]
  src.forEach((o, i) => {
    const c = dst[i], ocs = getComputedStyle(o), text = o.tagName === 'text' || o.tagName === 'tspan' || o === svg
    for (const [prop, dflt] of Object.entries(CHART_SVG_PROPS)) {
      const own = (o as SVGElement).style?.getPropertyValue(prop) || o.getAttribute(prop)
      let v = chartStyle(ocs, prop, o, own)
      c.removeAttribute(prop)
      if (!v || v === dflt) continue
      if ((CHART_SVG_PAINT as readonly string[]).includes(prop)) v = chartColor(v)
      c.setAttribute(prop, v)
    }
    if (text) for (const [prop, dflt] of Object.entries(CHART_SVG_TEXT)) {
      const v = chartStyle(ocs, prop, o, o.getAttribute(prop))
      c.removeAttribute(prop)
      if (v && v !== dflt) c.setAttribute(prop, v)
    }
    if (o !== svg && o instanceof SVGGraphicsElement && ocs.transform && ocs.transform !== 'none') { // CSS transforms (scatter dots scale from their centre)
      const box = typeof o.getBBox === 'function' ? o.getBBox() : null, [tx, ty] = ocs.transformOrigin.split(' ').map(parseFloat)
      const t = box ? chartTransform(ocs, (ocs.transformBox === 'fill-box' ? box.x : 0) + (tx || 0), (ocs.transformBox === 'fill-box' ? box.y : 0) + (ty || 0)) : ''
      if (t) c.setAttribute('transform', `${c.getAttribute('transform') ?? ''} ${t}`.trim())
    }
    if (ocs.display === 'none' || ocs.visibility === 'hidden') c.setAttribute('display', 'none')
    for (const a of ['class', 'style', 'aria-hidden', 'role', 'tabindex', 'data-ci', 'data-hm']) c.removeAttribute(a)
  })
  clone.setAttribute('width', chartN(w)); clone.setAttribute('height', chartN(h)); clone.setAttribute('overflow', 'visible')
  clone.removeAttribute('x'); clone.removeAttribute('y')
  // the box's top left before its own CSS transform (the donut is rotated -90° about its centre)
  const cx = r.left + r.width / 2 - ox, cy = r.top + r.height / 2 - oy
  const own = chartTransform(cs, w / 2, h / 2)
  return `<g transform="translate(${chartN(cx - w / 2)} ${chartN(cy - h / 2)})${own ? ' ' + own : ''}"${opacity < 1 ? ` opacity="${chartN(opacity)}"` : ''}>${new XMLSerializer().serializeToString(clone)}</g>`
}

/** A box's visible rect after a clip-path inset() (the bar wipes of BarList and FunnelChart). */
function chartClipInset(cs: CSSStyleDeclaration, r: DOMRect) {
  const m = /^inset\(([^)]*?)(?:\s+round\s+[^)]*)?\)$/.exec(cs.clipPath ?? '')
  if (!m) return { x: r.left, y: r.top, w: r.width, h: r.height }
  const v = m[1].trim().split(/\s+/), [t, ri, b, l] = [v[0], v[1] ?? v[0], v[2] ?? v[0], v[3] ?? v[1] ?? v[0]]
  const px = (s: string, full: number) => (s.endsWith('%') ? (parseFloat(s) / 100) * full : parseFloat(s) || 0)
  const x = r.left + px(l, r.width), y = r.top + px(t, r.height)
  return { x, y, w: Math.max(0, r.width - px(l, r.width) - px(ri, r.width)), h: Math.max(0, r.height - px(t, r.height) - px(b, r.height)) }
}

/** Paint a chart's DOM as SVG: <svg> parts are cloned, HTML parts become rects (backgrounds, borders) and text. */
function chartSvgOf(root: Element, background: string, title: string) {
  const skip = (e: Element) => e.matches('[data-chart-noexport], [role="tooltip"], .sr-only, script, style, template')
  const kids = [...root.children].filter(k => !skip(k))
  const rects = (kids.length ? kids : [root]).map(k => k.getBoundingClientRect())
  const PAD = 12
  const x0 = Math.min(...rects.map(r => r.left)) - PAD, y0 = Math.min(...rects.map(r => r.top)) - PAD
  const width = Math.max(1, Math.ceil(Math.max(...rects.map(r => r.right)) + PAD - x0)), height = Math.max(1, Math.ceil(Math.max(...rects.map(r => r.bottom)) + PAD - y0))
  const out: string[] = []
  type Clip = { l: number; t: number; r: number; b: number } | null
  const inClip = (c: Clip, x: number, y: number) => !c || (x >= c.l - 0.5 && x <= c.r + 0.5 && y >= c.t - 0.5 && y <= c.b + 0.5)
  const text = (node: Text, cs: CSSStyleDeclaration, el: Element, opacity: number, clip: Clip) => {
    const s = (node.textContent ?? '').replace(/\s+/g, ' ').trim()
    if (!s) return
    const range = document.createRange(); range.selectNodeContents(node)
    const r = typeof range.getBoundingClientRect === 'function' ? range.getBoundingClientRect() : el.getBoundingClientRect()
    if (!inClip(clip, r.left + r.width / 2, r.top + r.height / 2)) return
    const fill = chartColor(chartStyle(cs, 'color', el, (el as HTMLElement).style?.color) || '#000')
    out.push(`<text x="${chartN((r.left) - x0)}" y="${chartN(r.top + r.height / 2 - y0)}" dominant-baseline="central" fill="${chartEsc(fill)}"`
      + ` font-family="${chartEsc(cs.fontFamily || 'sans-serif')}" font-size="${chartEsc(cs.fontSize || '12px')}"${cs.fontWeight && cs.fontWeight !== '400' ? ` font-weight="${chartEsc(cs.fontWeight)}"` : ''}`
      + `${opacity < 1 ? ` opacity="${chartN(opacity)}"` : ''}>${chartEsc(s)}</text>`)
  }
  const walk = (e: Element, opacity: number, clip: Clip) => {
    if (skip(e)) return
    const cs = getComputedStyle(e)
    if (cs.display === 'none' || cs.visibility === 'hidden') return
    const o = parseFloat(cs.opacity), op = opacity * (Number.isFinite(o) ? o : 1)
    if (op < 0.01) return
    if (e instanceof SVGSVGElement) { out.push(chartSvgClone(e, x0, y0, op)); return }
    if (!(e instanceof HTMLElement)) return
    const r = e.getBoundingClientRect()
    if (clip && (r.right < clip.l || r.left > clip.r || r.bottom < clip.t || r.top > clip.b)) return
    if (r.width > 0 && r.height > 0) {
      const bg = chartColor(chartStyle(cs, 'background-color', e, e.style.backgroundColor || e.style.background))
      const rad = Math.min(parseFloat(cs.borderTopLeftRadius) || 0, r.width / 2, r.height / 2)
      if (!chartClear(bg)) {
        const b = chartClipInset(cs, r)
        if (b.w > 0.5 && b.h > 0.5) out.push(`<rect x="${chartN(b.x - x0)}" y="${chartN(b.y - y0)}" width="${chartN(b.w)}" height="${chartN(b.h)}"${rad ? ` rx="${chartN(rad)}"` : ''} fill="${chartEsc(bg)}"${op < 1 ? ` opacity="${chartN(op)}"` : ''}/>`)
      }
      for (const [side, x1, y1, x2, y2] of [['top', r.left, r.top, r.right, r.top], ['bottom', r.left, r.bottom, r.right, r.bottom], ['left', r.left, r.top, r.left, r.bottom], ['right', r.right, r.top, r.right, r.bottom]] as const) {
        const bw = parseFloat(cs.getPropertyValue(`border-${side}-width`)) || 0, style = cs.getPropertyValue(`border-${side}-style`)
        const bc = chartColor(chartStyle(cs, `border-${side}-color`, e, e.style.borderColor))
        if (!bw || style === 'none' || style === 'hidden' || chartClear(bc)) continue
        out.push(`<line x1="${chartN(x1 - x0)}" y1="${chartN(y1 - y0)}" x2="${chartN(x2 - x0)}" y2="${chartN(y2 - y0)}" stroke="${chartEsc(bc)}" stroke-width="${chartN(bw)}"${style === 'dashed' ? ` stroke-dasharray="${chartN(bw * 2)} ${chartN(bw)}"` : style === 'dotted' ? ` stroke-dasharray="${chartN(bw)} ${chartN(bw)}"` : ''}${op < 1 ? ` opacity="${chartN(op)}"` : ''}/>`)
      }
    }
    const clips = cs.overflowX !== 'visible' || cs.overflowY !== 'visible'
    const next: Clip = !clips ? clip : { l: Math.max(clip?.l ?? -Infinity, r.left), t: Math.max(clip?.t ?? -Infinity, r.top), r: Math.min(clip?.r ?? Infinity, r.right), b: Math.min(clip?.b ?? Infinity, r.bottom) }
    for (const n of e.childNodes) {
      if (n.nodeType === 3) text(n as Text, cs, e, op, next)
      else if (n.nodeType === 1) walk(n as Element, op, next)
    }
  }
  walk(root, 1, null)
  let bg = background === 'none' ? '' : background === 'auto' ? '' : chartColor(chartResolveVars(background, root))
  if (background === 'auto') {
    for (let a: Element | null = root; a && !bg; a = a.parentElement) { const c = chartColor(chartStyle(getComputedStyle(a), 'background-color', a, (a as HTMLElement).style?.backgroundColor)); if (!chartClear(c)) bg = c }
    bg ||= chartColor(chartResolveVars('var(--card, #ffffff)', root))
  }
  const font = getComputedStyle(root).fontFamily || 'sans-serif'
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" font-family="${chartEsc(font)}">`
    + `<title>${chartEsc(title)}</title>${bg ? `<rect width="${width}" height="${height}" fill="${chartEsc(bg)}"/>` : ''}${out.join('')}</svg>`
  return { svg, width, height }
}

const CHART_EXPORTS = [['png', 'Download PNG', 'download'], ['svg', 'Download SVG', 'download'], ['csv', 'Download CSV', 'download'], ['copy', 'Copy image', 'copy']] as const
/**
 * The ⋯ export menu (a small menu button, not overlay's DropdownMenu, so the chart kit stays free of the overlay
 * module): Download PNG / SVG / CSV and Copy image where the clipboard takes images. ↑/↓, Home/End move; Escape or Tab
 * closes; it opens over the chart, so nothing moves. Copy reports "Copied" on the button and to screen readers.
 */
function ChartExportMenu({ root }: { root: RefObject<HTMLElement | null> }) {
  const [open, setOpen] = useState(false)
  const [status, flash] = useStatusFlash()
  const [say, live] = useLive()
  const [canCopy, setCanCopy] = useState(false)
  useEffect(() => { setCanCopy(typeof ClipboardItem !== 'undefined' && typeof navigator.clipboard?.write === 'function') }, [])
  const box = useRef<HTMLDivElement>(null), trigger = useRef<HTMLButtonElement>(null), menu = useRef<HTMLDivElement>(null)
  useOutside([box], () => setOpen(false), open)
  useEffect(() => { if (open) menu.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus() }, [open])
  const close = (refocus: boolean) => { setOpen(false); if (refocus) trigger.current?.focus() }
  const run = async (kind: (typeof CHART_EXPORTS)[number][0]) => {
    close(true)
    if (kind === 'copy') {
      const ok = await writeClipboard(new ClipboardItem({ 'image/png': exportChart(root, { format: 'png', download: false }) }))
      flash(ok); say(ok ? 'Copied' : 'Couldn’t copy the image')
      return
    }
    try { await exportChart(root, { format: kind }); say('') } catch { flash(false); say('Couldn’t export the chart') }
  }
  const onKey = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(true); return }
    if (e.key === 'Tab') { close(false); return }
    const next = focusStep([...(menu.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])], e.key)
    if (next) { e.preventDefault(); next.focus() }
  }
  return (
    <div ref={box} className="relative">
      <IconButton ref={trigger} icon={status === 'ok' ? 'check' : status === 'fail' ? 'alert' : 'more'} label={status === 'ok' ? 'Copied' : 'Export chart'} size="icon-xs"
        aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(o => !o)}
        onKeyDown={e => { if (!open && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) { e.preventDefault(); setOpen(true) } }} />
      {open && (
        <motion.div ref={menu} role="menu" aria-label="Export chart" onKeyDown={onKey}
          initial={{ opacity: 0, y: 4, scale: 0.97 }} animate={{ opacity: 1, y: 0, scale: 1 }} transition={spring(0.2, 0.25)}
          className={cn(surface.floating, 'absolute end-0 bottom-full z-20 mb-1 flex w-max min-w-[176px] origin-bottom flex-col p-1')}>
          {CHART_EXPORTS.filter(([k]) => k !== 'copy' || canCopy).map(([k, label, icon]) => (
            <button key={k} type="button" role="menuitem" tabIndex={-1} className={menuItemClass} onClick={() => void run(k)}>
              <span className="flex items-center gap-2"><Icon name={icon} size={14} className="text-[var(--fg3)]" />{label}</span>
            </button>
          ))}
        </motion.div>
      )}
      {live}
    </div>
  )
}
/** Ease numbers to `to` in 250 ms; `snap`, the value after a snap and reduced motion jump. */
function useChartEase(to: number[], snap: boolean) {
  const [v, setV] = useState(to), cur = useRef<number[] | null>(null), key = to.join(), jump = snap || !cur.current
  useEffect(() => {
    const from = cur.current
    if (jump || !from || prefersReducedMotion()) { cur.current = snap ? null : to; setV(to); return }
    const t0 = performance.now()
    let raf = 0
    const step = (now: number) => {
      const u = Math.min(1, (now - t0) / 250), e = 1 - (1 - u) ** 3
      cur.current = to.map((x, i) => from[i] + (x - from[i]) * e); setV(cur.current)
      if (u < 1) raf = requestAnimationFrame(step)
    }
    raf = requestAnimationFrame(step)
    return () => cancelAnimationFrame(raf)
  }, [key, jump]) // eslint-disable-line react-hooks/exhaustive-deps
  return jump ? to : v
}
/**
 * At most `max` items of `data`, evenly spaced and always keeping the first and last (simple stride downsampling).
 * Returns `data` itself when it is already small enough or `max` isn't a positive number.
 */
export function chartDownsample<T>(data: T[], max?: number): T[] {
  if (!max || !Number.isFinite(max) || max < 2 || data.length <= max) return data
  const out: T[] = [], step = (data.length - 1) / (Math.floor(max) - 1)
  for (let i = 0; i < Math.floor(max); i++) out.push(data[Math.round(i * step)])
  return out
}
const linePath = (pts: [number, number][]) => chartPath(pts)
const num = (v: unknown) => (v === null || v === undefined || v === '' ? null : Number(v))

/**
 * Tooltip inside a chart's relative box (the in-box sibling of overlay's PointerTooltip, same surface): right of `x`,
 * flipping left when there is no room, clamped to the box, gliding between points.
 */
function ChartTooltip({ x, y, children, width }: { x: number; y: number; children: ReactNode; width: number }) {
  const ref = useRef<HTMLDivElement>(null)
  const [tw, setTw] = useState(150)
  useLayoutEffect(() => { const w = ref.current?.offsetWidth; if (w && Math.abs(w - tw) > 1) setTw(w) })
  const fitsR = x + 12 + tw <= width, fitsL = x - 12 - tw >= -8
  const right = fitsR || !fitsL
  const left = clamp(right ? x + 12 : x - 12 - tw, Math.min(0, width - tw), width - tw)
  return (
    <motion.div ref={ref} role="tooltip" className={cn(surface.floating, 'pointer-events-none absolute z-10 w-max max-w-[min(300px,calc(100vw-40px))] min-w-[120px] rounded-[var(--r-md)] px-2.5 py-1.5 text-xs')}
      initial={false} animate={{ left, top: y }} transition={spring(0.1, 0.25)}>
      {children}
    </motion.div>
  )
}
function TooltipRow({ color, label, value, dashed }: { color: string; label: ReactNode; value: ReactNode; dashed?: boolean }) {
  return (
    <div className="flex items-center gap-2">
      <span className={cn('h-2 w-2 rounded-[var(--r-sm)]', dashed && 'border border-dashed bg-transparent')} style={dashed ? { borderColor: safeColor(color) } : { background: safeColor(color) }} />
      <span className="flex-1 text-[var(--fg2)]">{label}</span><b className="ui-num font-medium">{value}</b>
    </div>
  )
}

/** One series of a Chart. `T` is the row type, so `key`, `from` and the whisker fields are checked against its keys. */
export type Series<T extends object = ChartDatum> = {
  key: keyof T & string; label?: string; type?: 'line' | 'area' | 'bar' | 'float'; color?: string; dashed?: boolean
  /** Which y-axis the series is measured on. A right axis appears as soon as one series uses it. */
  axis?: 'left' | 'right'
  /** Overrides the chart's `curve` for this series. */
  curve?: Curve
  /** Marker on every point (lines and areas). */
  points?: boolean
  /** Floating bar: spans data[from] → data[key] (waterfall steps, candle bodies, error-bar means). */
  from?: keyof T & string
  /** Line through the bar centre from data[low] to data[high]. Without caps it's a wick (drawn behind), with caps an error bar (drawn on top). */
  whisker?: { low: keyof T & string; high: keyof T & string; caps?: boolean; color?: string }
  /** Per-bar colour, e.g. up/down. */
  colorOf?: (d: T, i: number) => string
  /** Dashed connector from the end of each bar to the next one. */
  connectors?: boolean
  /** Small label above each bar, e.g. '+25'. */
  labelOf?: (d: T, i: number) => string | null
}
/**
 * Tags on a time-axis Chart. `style` 'auto' (default: pins → rug → rollup by width and density, see layoutTimeTags),
 * 'pins', 'rug', 'flags', 'rollup' or 'dots'; the room a style may need is reserved, so switching never moves the plot.
 * `spans: 'bands'` (default) shades durations. `activeId`/`onActiveChange` link to a list; `onSelect` runs on click,
 * Enter or a second tap; `label` names the tag list ("Tags").
 */
export type ChartAnnotations = {
  tags: TimeTag[]; kinds?: TimeTagKind[]; style?: TimeTagStyle; spans?: 'bands' | 'none'; activeId?: string | null
  onActiveChange?: (id: string | null) => void; onSelect?: (tag: TimeTag) => void; label?: string
  /** 'current' (default): room for the shown style's rows, eased when data or width change it. 'max': room for every style, so the height never changes: use it for live or streaming data. */
  reserve?: 'current' | 'max'
}
/** Horizontal grid lines at `ticks` (zero solid, the rest dashed) with labels left of `x1` when `format` is given, and an optional right axis. */
function ChartGridY({ ticks, Y, x1, x2, format, right, dash = '3 3', gap = 8 }:
  { ticks: number[]; Y: (v: number) => number; x1: number; x2: number; format?: (v: number) => string; right?: { ticks: number[]; Y: (v: number) => number; format: (v: number) => string }; dash?: string; gap?: number }) {
  return <>
    {ticks.map(t => <line key={t} x1={x1} x2={x2} y1={Y(t)} y2={Y(t)} stroke="var(--line)" strokeDasharray={t === 0 ? undefined : dash} />)}
    {format && ticks.map(t => <text key={t} x={x1 - gap} y={Y(t)} dy="0.32em" textAnchor="end" fill="var(--fg3)">{format(t)}</text>)}
    {right?.ticks.map(t => <text key={t} x={x2 + 8} y={right.Y(t)} dy="0.32em" fill="var(--fg3)">{right.format(t)}</text>)}
  </>
}
/** X-axis labels centred on their x at baseline `y`; `grid` [top, bottom] adds a faint vertical line per tick. */
function ChartAxisX({ ticks, y, grid }: { ticks: { x: number; label: string }[]; y: number; grid?: [number, number] }) {
  return <>{ticks.map((k, i) => <g key={`${i}-${k.label}`}>
    {grid && <line x1={k.x} x2={k.x} y1={grid[0]} y2={grid[1]} stroke="var(--line)" strokeOpacity={0.6} />}
    <text x={k.x} y={y} textAnchor="middle" fill="var(--fg3)">{k.label}</text>
  </g>)}</>
}

/** Props of Chart over rows of type `T`. */
export type ChartProps<T extends object = ChartDatum> = {
  data: T[]; x: NoInfer<keyof T & string>; series: Series<NoInfer<T>>[]; height?: number; stacked?: boolean
  band?: { lower: NoInfer<keyof T & string>; upper: NoInfer<keyof T & string>; label?: string }; gap?: number
  format?: (n: number) => string; rightFormat?: (n: number) => string; legend?: boolean; curve?: Curve
  /** Include 0 in the value axis (default). Turn off for prices. */
  zero?: boolean
  /** Minimum left-axis range, like a suggested min/max. */
  domain?: [number, number]
  tooltip?: (d: NoInfer<T>, i: number) => ReactNode
  /**
   * Draw at most this many rows (evenly sampled, first and last kept) so very long series stay fast. Off by default;
   * with it on, tooltip indexes refer to the sampled rows.
   */
  maxPoints?: number
  /** Accessible name (default: the series labels, e.g. "2025 and 2026 chart"). */
  label?: string
  /** Data summary read after the name (default: the x range and each series' range). */
  summary?: string
  /** Formats the x values for the axis, the tooltip header and the keyboard readout (e.g. day numbers → dates). */
  xFormat?: (v: NoInfer<T>[keyof T], i: number) => string
  /** Time x axis (rows placed by time, clock ticks): `true` reads epoch ms/Dates from `x`, or map a row. On with `annotations` over numeric/Date x. */
  xTime?: boolean | ((d: NoInfer<T>) => number | Date)
  /** tags over time (point events and spans); needs a time x axis */
  annotations?: ChartAnnotations
  className?: string
} & ChartKitProps

/**
 * The cartesian chart. Mix series types freely:
 *   line                     <Chart data x="month" series={[{ key: 'revenue' }]} curve="monotone" />
 *   stacked area             series={[{ key: 'a', type: 'area' }, { key: 'b', type: 'area' }]} stacked
 *   grouped / stacked bars   series={[{ key: 'a', type: 'bar' }, { key: 'b', type: 'bar' }]} (stacked)
 *   combo, two axes          series={[{ key: 'orders', type: 'bar' }, { key: 'rate', axis: 'right', points: true }]}
 *   forecast / confidence    band={{ lower: 'lo', upper: 'hi' }} plus a dashed series; nulls leave gaps
 *   histogram                bars with gap={0} (1px separators)
 *   waterfall                { type: 'float', from: 'start', key: 'end', connectors: true, labelOf, colorOf }
 *   candlestick              { type: 'float', from: 'open', key: 'close', whisker: { low: 'low', high: 'high' }, axis: 'right' }
 *   error bars               { type: 'float', from: 'floor', key: 'mean', whisker: { low: 'lo', high: 'hi', caps: true } }
 * Hover, tap or drag a finger sideways for a crosshair and tooltip (`tooltip` replaces its body); tap outside to dismiss.
 * Keyboard: the chart is one Tab stop; arrows, Home and End move the same crosshair and tooltip (useChartShell).
 * Draws in when scrolled into view.
 */
export function Chart<T extends object = ChartDatum>({ data: allRows, x, series, height = 220, stacked, band, gap = 0.3, format: formatProp, rightFormat, legend = true, curve = 'linear', zero = true, domain, tooltip, maxPoints, label, summary, xFormat, xTime, annotations: A, table, exportable, ref: userRef, className }: ChartProps<T>) {
  const format = formatProp ?? fmt.compact
  const data = useMemo(() => chartDownsample(allRows, maxPoints), [allRows, maxPoints])
  const [ref, w, seen] = useChartFrame<HTMLDivElement>()
  const val = (d: T, k: keyof T | undefined) => (k === undefined ? null : num(d[k]))
  const S = series.map((s, i) => ({ ...s, type: s.type ?? 'line', color: seriesColor(i, s.color), label: s.label ?? s.key, axis: s.axis ?? 'left', curve: s.curve ?? curve }))
  type RS = (typeof S)[number]
  const hasL = S.some(s => s.axis === 'left'), hasR = S.some(s => s.axis === 'right')
  // annotations add headroom (pins, flags) and a band under the axis (rug, rollup); set once the layout is known, below
  const aStyle = A?.style ?? 'auto', ROW = 23
  const pad = { l: 8, r: 10, t: S.some(s => s.labelOf) ? 22 : 10, b: 24 }
  let ih = height - pad.t - pad.b
  const n = data.length, slots = S.filter(s => s.type === 'bar' || s.type === 'float'), banded = slots.length > 0
  // stacking: each series sits on the sum of the stackable series before it (same type, same axis)
  const base = (i: number, si: number) => stacked ? S.slice(0, si).filter(s => s.type === S[si].type && s.axis === S[si].axis).reduce((a, s) => a + (num(data[i][s.key]) ?? 0), 0) : 0
  const top = (i: number, si: number) => { const v = num(data[i][S[si].key]); return v === null ? null : v + base(i, si) }
  const scale = (side: 'left' | 'right', dom?: [number, number]) => {
    const v = data.flatMap((d, i) => S.flatMap((s, si) => s.axis !== side ? [] : [top(i, si), s.from ? num(d[s.from]) : null, s.whisker ? num(d[s.whisker.low]) : null, s.whisker ? num(d[s.whisker.high]) : null])
      .concat(side === 'left' && band ? [num(d[band.lower]), num(d[band.upper])] : [])).filter((q): q is number => q !== null && Number.isFinite(q))
    if (!v.length && !dom) return null
    const lo = minOf(v, Math.min(dom?.[0] ?? Infinity, zero ? 0 : Infinity)), hi = maxOf(v, dom?.[1] ?? -Infinity)
    const ticks = niceTicks(lo, hi), y0 = ticks[0], y1 = ticks[ticks.length - 1]
    return { ticks, Y: (val: number) => linScale(y0, y1 || y0 + 1, pad.t + ih, pad.t)(val), rest: y0 <= 0 && y1 >= 0 ? 0 : y0 }
  }
  const L = hasL ? scale('left', domain) : null, R = hasR ? scale('right') : null, G = L ?? R
  // the axes take the room their widest tick label needs
  if (L) pad.l = chartAxisPad(L.ticks.map(format))
  if (R) pad.r = chartAxisPad(R.ticks.map(rightFormat ?? format))
  const iw = Math.max(0, w - pad.l - pad.r)
  const sc = (s: RS) => (s.axis === 'right' ? R : L) ?? G!
  const step = iw / Math.max(1, banded ? n : n - 1)
  // time x axis: rows placed by time; tx(ms) maps any time (a tag) onto the plot
  const v0: unknown = data[0]?.[x]
  const timeOf = typeof xTime === 'function' ? (d: T) => +xTime(d) : xTime || (xTime === undefined && A && (typeof v0 === 'number' || v0 instanceof Date)) ? (d: T) => +(d[x] as number | Date) : null
  const T = timeOf ? data.map(timeOf) : null
  const t0 = T?.[0] ?? 0, t1 = T?.[n - 1] ?? 1, linT = linScale(t0, t1 === t0 ? t0 + 1 : t1, pad.l, pad.l + iw)
  /** fractional row index of a time (binary search over the rows' times) */
  const fracAt = (ms: number) => {
    if (!T || n < 2 || ms <= T[0]) return 0
    let lo = 0, hi = n - 1
    if (ms >= T[hi]) return hi
    while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (T[mid] <= ms) lo = mid; else hi = mid }
    return lo + (ms - T[lo]) / (T[hi] - T[lo] || 1)
  }
  const X = (i: number) => (T && !banded ? linT(T[i]) : pad.l + (banded ? step * (i + 0.5) : step * i))
  const tx = (ms: number) => (banded ? pad.l + step * (fracAt(ms) + 0.5) : linT(ms))
  const xText = (i: number) => (xFormat ? xFormat(data[i][x], i) : T ? chartTimeText(T[i]) : String(data[i][x] ?? ''))
  // skip x labels that would collide: show every Nth (N from a tidy 1, 2, 3, 4, 5, 6, 10… set) so each one gets
  // its estimated 11px width plus a gap. Dense charts (histograms with gap={0}) rely on this.
  const labelW = maxOf(data.map((_, i) => xText(i).length), 0) * 6.6 + 10
  const need = Math.max(1, Math.ceil(labelW / (step || 1)))
  const every = [1, 2, 3, 4, 5, 6, 10, 12, 15, 20, 25, 50, 100].find(k => k >= need) ?? need
  const runs = (si: number) => { // indices of each unbroken run of non-null values (nulls leave gaps)
    const out: number[][] = [[]]
    data.forEach((_, i) => { if (top(i, si) === null) { if (out[out.length - 1].length) out.push([]) } else out[out.length - 1].push(i) })
    return out.filter(r => r.length)
  }
  const slotW = (step * (1 - gap)) / (stacked ? 1 : slots.length || 1)
  const bw = Math.max(1, gap ? slotW - 1 : slotW), rx = gap ? Math.min(4, bw / 4) : 0
  const bx = (i: number, s: RS) => X(i) - (step * (1 - gap)) / 2 + (stacked ? 0 : slots.indexOf(s) * slotW)
  const span = (i: number, si: number): [number, number] | null => {
    const s = S[si]
    if (s.type === 'float') { const a = val(data[i], s.from), b = num(data[i][s.key]); return a === null || b === null ? null : [a, b] }
    const v = top(i, si); return v === null ? null : [base(i, si), v]
  }
  const fmtOf = (s: RS) => (s.axis === 'right' ? rightFormat ?? format : format)
  /** the row under a pointer's x */
  const rowAt = (px: number) => clamp(Math.round(T && !banded ? fracAt(t0 + ((px - pad.l) / (iw || 1)) * (t1 - t0)) : (px - pad.l - (banded ? step / 2 : 0)) / step), 0, n - 1)
  const valueText = (i: number, si: number) => {
    const s = S[si]
    if (s.type === 'float') { const sp = span(i, si); return sp && `${fmtOf(s)(sp[0])} to ${fmtOf(s)(sp[1])}` }
    const v = num(data[i][s.key]); return v === null ? null : fmtOf(s)(v)
  }
  const names = S.map(s => s.label)
  const chartLabel = label ?? `${names.length ? fmt.list(names) : 'Data'} chart`
  // the data table: every row (not the downsampled ones), one column per value the series read, in the chart's format
  const fmtOf2 = (s: RS) => (s.axis === 'right' ? rightFormat ?? formatProp : formatProp)
  const col = (head: string, key: keyof T, f?: (v: number) => string): [string, keyof T, ((v: number) => string) | undefined] => [head, key, f]
  const tcols = S.flatMap(s => [
    ...(s.from ? [col(`${s.label} (${s.from})`, s.from, fmtOf2(s))] : []),
    col(s.from || s.whisker ? `${s.label} (${s.key})` : s.label, s.key, fmtOf2(s)),
    ...(s.whisker ? [s.whisker.low, s.whisker.high].map(k => col(`${s.label} (${k})`, k, fmtOf2(s))) : []),
  ]).concat(band ? [band.lower, band.upper].map(k => col(`${band.label ?? 'Range'} (${k})`, k, formatProp)) : [])
  const xCell = (d: T, i: number) => xFormat ? xFormat(d[x], i) : timeOf ? new Date(timeOf(d)).toISOString() : d[x] as ChartCellValue
  const tableData: ChartTable = {
    head: [timeOf ? 'Time' : 'Category', ...tcols.map(c => c[0])],
    rows: allRows.map((d, i) => [xCell(d, i), ...tcols.map(c => num(d[c[1]]))]),
    formats: [timeOf && !xFormat ? (iso: string) => chartTimeText(Date.parse(iso)) : undefined, ...tcols.map(c => c[2])],
  }
  const shell = useChartShell({
    table, exportable, ref: userRef, box: ref, count: n, label: chartLabel, data: tableData,
    summary: summary ?? (n ? [`${plural(n, 'point')} from ${xText(0)} to ${xText(n - 1)}.`, ...S.map(s => `${s.label}: ${rangeStr(data.map((_, i) => s.type === 'float' ? num(data[i][s.key]) ?? NaN : top(i, S.indexOf(s)) ?? NaN), fmtOf(s))}.`)].join(' ') : 'No data.'),
    describe: i => `${xText(i)}: ${S.map((s, si) => { const v = valueText(i, si); return v === null ? null : `${s.label} ${v}` }).filter(Boolean).join(', ')}`,
  })
  const { hover, setHover } = shell
  const onPlotPointer = (e: ReactPointerEvent<SVGSVGElement>) => setHover(rowAt(e.clientX - e.currentTarget.getBoundingClientRect().left))
  /* ── annotations: tags over time (annotate.tsx) ── */
  const aTags = !A ? [] : A.spans === 'none' ? A.tags.filter(t => t.end === undefined) : A.tags
  const [activeAt, setActiveRaw] = useControllable<string | null>(A?.activeId, null, A?.onActiveChange)
  const setActive = (id: string | null) => { if (id !== activeAt) setActiveRaw(id) }
  const tags = useTagFocus({ tags: aTags, activeId: activeAt, onActive: setActive, onSelect: A?.onSelect, label: A?.label })
  const tl = A && T && iw > 0 ? layoutTimeTags(aTags, { x: tx, width: w - pad.r, style: aStyle, domain: [t0, t1] }) : null
  // room for the tags: 'max' every style it may switch to; 'current' the shown style's rows, eased when they change
  const aMax = !tl || A?.reserve === 'max', st = aMax ? aStyle : tl.style, rows = aMax ? 3 : Math.max(1, tl.rows)
  const want = !A ? [0, 0] : [st === 'pins' ? 8 + (aMax && st === aStyle ? 3 : rows) * ROW : st === 'auto' ? 8 + 2 * ROW : st === 'flags' ? 24 : 6, /auto|rug|rollup/.test(st) ? rows * ROW + 6 : 0]
  const [aTop, aBand] = useChartEase(want, aMax)
  pad.t += aTop; ih = height - pad.t - pad.b
  const s0 = S.findIndex(s => s.type === 'line' || s.type === 'area')
  /** y of the first line series at a time (interpolated), or the plot floor */
  const lineY = (ms: number) => {
    const f = fracAt(ms), i = Math.floor(f), a = s0 < 0 || !n ? null : top(i, s0), b = s0 < 0 || !n ? null : top(Math.min(n - 1, i + 1), s0)
    const v = a === null ? b : b === null ? a : a + (b - a) * (f - i)
    return v === null ? pad.t + ih : sc(S[s0]).Y(v)
  }
  const pinY = (ms: number, row: number) => Math.max(10, lineY(ms) - 17 - row * ROW), rugY = (row: number) => height + 4 + ROW / 2 + row * ROW
  const look = (t: TimeTag) => timeTagLook(t, A?.kinds)
  const placed = tl?.points.find(p => p.tag.id === activeAt), host = placed?.hidden ? tl!.points.find(p => p.more?.includes(placed.tag.id)) : placed
  const aSpan = tl?.spans.find(p => p.tag.id === activeAt), aBin = placed?.bin !== undefined ? tl!.bins[placed.bin] : undefined
  const activeTag = placed?.tag ?? aSpan?.tag ?? null
  const anchor = !tl ? null : aSpan ? { x: clamp((aSpan.x0 + aSpan.x1) / 2, pad.l, w - pad.r), y: pad.t } : !host ? null
    : { x: aBin ? aBin.x : host.x, y: aBin ? rugY(aBin.row) : tl.style === 'pins' ? pinY(host.ms, host.row) : tl.style === 'rug' ? rugY(host.row) : tl.style === 'flags' ? pad.t : lineY(host.ms) }
  useOutside([ref], () => setActive(null), !!activeTag, { escape: true })
  const tap = useRef({ type: '', was: false })
  const tagPtr = (t: TimeTag) => ({
    onPointerEnter: (e: ReactPointerEvent) => { if (!isTouch(e)) { setHover(null); setActive(t.id) } },
    onPointerLeave: onMouseLeave(() => setActive(null)),
    onPointerDown: (e: ReactPointerEvent) => { tap.current = { type: e.pointerType, was: activeAt === t.id }; releaseTouchCapture(e); setHover(null); setActive(t.id) },
    onClick: () => { if (tap.current.type !== 'touch' || tap.current.was) A?.onSelect?.(t) },
  })
  const fade = { opacity: seen ? 1 : 0, transition: 'opacity .3s' }
  const whiskers = (caps: boolean) => S.map(s => s.whisker && !!s.whisker.caps === caps && data.map((d, i) => {
    const lo = num(d[s.whisker!.low]), hi = num(d[s.whisker!.high]), mid = num(d[s.key]); if (lo === null || hi === null || mid === null) return null
    const { Y } = sc(s), cx = bx(i, s) + bw / 2, cw = Math.min(7, bw / 2)
    const path = (a: number, b: number) => `M${svgN(cx)},${svgN(a)}L${svgN(cx)},${svgN(b)}` + (caps ? `M${svgN(cx - cw)},${svgN(a)}L${svgN(cx + cw)},${svgN(a)}M${svgN(cx - cw)},${svgN(b)}L${svgN(cx + cw)},${svgN(b)}` : '')
    return <motion.path key={`w${s.key}${i}`} fill="none" stroke={s.whisker!.color ?? (caps ? 'var(--fg2)' : s.colorOf?.(d, i) ?? s.color)} strokeWidth={1.5} strokeLinecap="round"
      initial={{ d: path(Y(mid), Y(mid)) }} animate={{ d: seen ? path(Y(lo), Y(hi)) : path(Y(mid), Y(mid)), opacity: hover === null || hover === i ? 1 : 0.55 }} transition={{ ...spring(0.15, 0.6), delay: seen ? 0.15 : 0 }} />
  }))
  const tagLayer = tl && aTags.length > 0 && (
          // the tags: one Tab stop after the series (useTagFocus); glyphs are its options, folded ones visually hidden
          <div {...tags.props} onFocus={e => { setHover(null); tags.props.onFocus(e) }} className="pointer-events-none absolute inset-0 outline-none" style={fade}>
            {/* options in time order (spans by their start), as the keyboard walks them */}
            {[...tl.spans.map(p => [p.from, <div key={p.tag.id} {...tags.option(p.tag)} {...tagPtr(p.tag)} className={cn(TOUCH.hit, 'pointer-events-auto absolute cursor-pointer')}
              style={{ left: p.x0, width: Math.max(8, p.x1 - p.x0), top: pad.t - 5, height: 12 }} />] as const), ...tl.points.map(p => [p.ms, (() => {
              const { icon, color } = look(p.tag), on = p.tag.id === activeAt || (host === p && !!activeTag), o = { ...tags.option(p.tag), ...tagPtr(p.tag) }
              if (p.hidden || tl.style === 'rollup') return <span key={p.tag.id} {...o} style={TAG_SR_ONLY} />
              if (tl.style === 'flags') return p.flag
                ? <div key={p.tag.id} {...o} className={cn(TOUCH.hit, 'pointer-events-auto absolute h-[18px] cursor-pointer rounded-e-[var(--r-sm)] border-s-2 px-1.5 text-[11px] leading-[16px] font-medium whitespace-nowrap text-[var(--fg)]')}
                  style={{ left: p.x - 1, top: pad.t - 22, borderColor: color, background: timeTagTint(color, on ? 32 : 18) }}>{p.tag.label}</div>
                : <div key={p.tag.id} {...o} className={cn(TOUCH.hit, 'pointer-events-auto absolute w-2.5 cursor-pointer')} style={{ left: p.x - 5, top: pad.t - 10, height: 14 }} />
              if (tl.style === 'dots') return <span key={p.tag.id} {...o} className={cn(TOUCH.hit, 'pointer-events-auto absolute cursor-pointer rounded-full border-2 border-[var(--card)] motion-safe:transition-transform', on && 'scale-150')}
                style={{ left: p.x - 5, top: lineY(p.ms) - 5, width: 10, height: 10, background: color }} />
              const y = tl.style === 'pins' ? pinY(p.ms, p.row) : rugY(p.row)
              return <TagGlyph key={p.tag.id} {...o} icon={icon} color={color} active={on} more={p.more?.length} className={cn(TOUCH.hit, 'pointer-events-auto !absolute cursor-pointer motion-safe:[transition:left_.3s,top_.3s,transform_.15s]')}
                style={{ left: p.x - 10, top: y - 10 }} />
            })()] as const)].sort((a, b) => a[0] - b[0]).map(e => e[1])}
            {tl.bins.map(b => {
              const k = A!.kinds?.find(q => q.kind === b.kind), color = b.kind === '*' ? 'var(--c-neutral)' : safeColor(k?.color, 'var(--accent)'), on = aBin === b
              const first = tl.points.find(p => p.tag.id === b.ids[0])!.tag
              return <div key={`${b.from}${b.kind}`} aria-hidden {...tagPtr(first)} className={cn(TOUCH.hit, 'ui-num pointer-events-auto absolute flex h-[18px] cursor-pointer items-center gap-0.5 overflow-hidden rounded-full px-1.5 text-[11px] whitespace-nowrap text-[var(--fg)]')}
                style={{ left: b.x, top: rugY(b.row) - 9, maxWidth: b.w - 2, transform: 'translateX(-50%)', background: timeTagTint(color, on ? 34 : 18), boxShadow: on ? `0 0 0 1.5px ${color}` : undefined }}>
                <span className="text-[10px]">{b.kind === '*' ? '+' : k?.icon}</span>{b.count}
              </div>
            })}
          </div>
  )
  return (
    <ChartShell shell={shell} className={className} style={{ height: height + aBand }}
      after={legend && <Legend items={[...S.map(s => ({ label: s.label, color: s.color, dashed: s.dashed })), ...(band ? [{ label: band.label ?? 'Range', color: '', band: true }] : [])]} />}>
      {w > 0 && G && (
        <svg width={w} height={height + aBand} aria-hidden className="block touch-pan-y overflow-visible text-[11px]" onPointerDown={onPlotPointer} onPointerMove={onPlotPointer}>
          <ChartGridY ticks={G.ticks} Y={G.Y} x1={pad.l} x2={w - pad.r} format={L ? format : undefined} right={R ? { ticks: R.ticks, Y: R.Y, format: rightFormat ?? format } : undefined} />
          {T && n > 1
            ? <ChartAxisX y={height - 6} ticks={timeTicks(t0, t1, iw, chartTimeText, Math.max(56, chartTimeText(t0).length * 6.6 + 18)).map(k => ({ x: tx(k.ms), label: k.label }))} grid={[pad.t, pad.t + ih]} />
            : <ChartAxisX y={height - 6} ticks={data.flatMap((_, i) => i % every === 0 ? [{ x: X(i), label: xText(i) }] : [])} />}
          {tl && <g style={fade}>
            {tl.spans.map(p => { const c = look(p.tag).color, on = p.tag.id === activeAt; return <g key={p.tag.id}>
              <rect x={p.x0} y={pad.t} width={Math.max(1, p.x1 - p.x0)} height={ih} fill={c} fillOpacity={on ? 0.24 : 0.1} />
              <rect x={p.x0} y={pad.t} width={Math.max(1, p.x1 - p.x0)} height={3} fill={c} />
            </g> })}
            {tl.style === 'flags' && tl.points.map(p => <line key={p.tag.id} x1={p.x} x2={p.x} y1={pad.t - (p.flag ? 4 : 10)} y2={pad.t + ih} stroke={look(p.tag).color} strokeDasharray="3 3" strokeOpacity={p.tag.id === activeAt ? 1 : 0.7} strokeWidth={p.tag.id === activeAt ? 2 : 1} />)}
            {aBin && <rect x={tx(aBin.from)} y={pad.t} width={Math.max(1, tx(aBin.to) - tx(aBin.from))} height={ih} fill="var(--line)" fillOpacity={0.5} />}
          </g>}
          {band && L && (() => {
            const pts = data.map((d, i) => [i, num(d[band.lower]), num(d[band.upper])] as const).filter(p => p[1] !== null && p[2] !== null)
            const dd = chartPath(pts.map(p => [X(p[0]), L.Y(p[2]!)]), curve) + chartPath(pts.slice().reverse().map(p => [X(p[0]), L.Y(p[1]!)]), curve, true) + 'Z'
            return <motion.path key={`band${pts.length}`} initial={{ d: dd, opacity: 0 }} animate={{ d: dd, opacity: seen ? 1 : 0 }} fill="var(--band)" transition={spring(0.1, 0.6)} />
          })()}
          {hover !== null && <line x1={X(hover)} x2={X(hover)} y1={pad.t} y2={pad.t + ih} stroke="var(--line2)" />}
          {whiskers(false)}
          {S.map((s, si) => (s.type === 'bar' || s.type === 'float') && data.map((d, i) => {
            const sp = span(i, si); if (!sp) return null
            const { Y } = sc(s), ya = Y(sp[0]), yb = Y(sp[1])
            return <motion.rect key={`${s.key}${i}`} x={bx(i, s)} width={bw} rx={rx} fill={s.colorOf?.(d, i) ?? s.color} stroke={gap ? undefined : 'var(--card)'} strokeWidth={gap ? undefined : 1}
              initial={{ y: ya, height: 0 }} animate={seen ? { y: Math.min(ya, yb), height: Math.max(1, Math.abs(ya - yb)), opacity: hover === null || hover === i ? 1 : 0.55 } : { y: ya, height: 0 }}
              transition={{ ...spring(0.15, 0.55), delay: Math.min(0.3, i * 0.025) }} />
          }))}
          {S.map(s => s.connectors && data.slice(0, -1).map((d, i) => {
            const v = num(d[s.key]); if (v === null) return null
            const y = sc(s).Y(v)
            return <motion.line key={`c${s.key}${i}`} x1={bx(i, s) + bw} x2={bx(i + 1, s)} y1={y} y2={y} stroke="var(--fg3)" strokeDasharray="3 3"
              initial={{ opacity: 0 }} animate={{ opacity: seen ? 1 : 0, y1: y, y2: y }} transition={{ duration: 0.3, delay: seen ? 0.45 : 0 }} />
          }))}
          {S.map((s, si) => s.labelOf && data.map((d, i) => {
            const sp = span(i, si), text = s.labelOf!(d, i); if (!sp || !text) return null
            const yTop = Math.min(sc(s).Y(sp[0]), sc(s).Y(sp[1])) - 6
            return <motion.text key={`l${s.key}${i}`} x={bx(i, s) + bw / 2} textAnchor="middle" fill="var(--fg2)" fontWeight={500}
              initial={{ opacity: 0, y: yTop + 6 }} animate={{ opacity: seen ? 1 : 0, y: seen ? yTop : yTop + 6 }} transition={{ ...spring(0.2, 0.5), delay: seen ? 0.35 + i * 0.03 : 0 }}>{text}</motion.text>
          }))}
          {S.map((s, si) => (s.type === 'line' || s.type === 'area') && runs(si).map(run => {
            const { Y, rest } = sc(s)
            const line = run.map(i => [X(i), Y(top(i, si)!)] as [number, number]), floor = run.map(i => [X(i), Y(stacked ? base(i, si) : rest)] as [number, number]), flat = run.map(i => [X(i), Y(rest)] as [number, number])
            const area = (up: [number, number][], low: [number, number][]) => chartPath(up, s.curve) + chartPath(low.slice().reverse(), s.curve, true) + 'Z'
            const d = chartPath(line, s.curve), d0 = chartPath(flat, s.curve)
            return (
              <g key={`${s.key}-${run[0]}-${run.length}`}>
                {s.type === 'area' && <motion.path initial={{ d: area(flat, flat) }} animate={{ d: seen ? area(line, floor) : area(flat, flat) }} fill={s.color} fillOpacity={0.18} transition={spring(0.1, 0.6)} />}
                <motion.path initial={{ d: d0 }} animate={{ d: seen ? d : d0 }} fill="none" stroke={s.color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round"
                  strokeDasharray={s.dashed ? '5 4' : undefined} transition={spring(0.1, 0.6)} />
                {s.points && run.map(i => <motion.circle key={i} cx={X(i)} r={3} fill="var(--card)" stroke={s.color} strokeWidth={2}
                  initial={{ cy: Y(rest) }} animate={{ cy: seen ? Y(top(i, si)!) : Y(rest) }} transition={spring(0.1, 0.6)} />)}
              </g>
            )
          }))}
          {whiskers(true)}
          {hover !== null && S.map((s, si) => { const v = top(hover, si); return (s.type === 'line' || s.type === 'area') && v !== null && <circle key={s.key} cx={X(hover)} cy={sc(s).Y(v)} r={4} fill={s.color} stroke="var(--card)" strokeWidth={2} /> })}
          {tl && /pins|dots/.test(tl.style) && <g style={fade}>{tl.points.map(p => {
            const c = look(p.tag).color, y = lineY(p.ms), stem = tl.style === 'pins' && !p.hidden
            return <g key={p.tag.id}>
              {stem && <line x1={p.x} x2={p.x} y1={y} y2={pinY(p.ms, p.row) + 10} stroke={c} strokeOpacity={0.5} />}
              <circle cx={p.x} cy={y} r={tl.style === 'dots' ? 0 : 2.5} fill={c} />
            </g>
          })}</g>}
          {activeTag && anchor && !aSpan && tl && <g pointerEvents="none">
            {(tl.style === 'rug' || tl.style === 'rollup') && <line x1={anchor.x} x2={anchor.x} y1={lineY(host!.ms)} y2={height - 18} stroke="var(--fg3)" strokeDasharray="2 3" />}
            <circle cx={host!.x} cy={lineY(host!.ms)} r={4.5} fill={look(activeTag).color} stroke="var(--card)" strokeWidth={2} />
          </g>}
        </svg>
      )}
      {tagLayer}
      {activeTag && anchor && w > 0 && (
        <ChartTooltip x={anchor.x} y={clamp(anchor.y - 10, 0, height + aBand - 64)} width={w}>
          <TagTooltip tag={activeTag} kinds={A?.kinds} extra={aBin && aBin.count > 1 ? `${aBin.kind === '*' ? 'Others' : look(activeTag).kindLabel} × ${aBin.count}, ${fmt.time(aBin.from)} to ${fmt.time(aBin.to)}` : undefined} />
        </ChartTooltip>
      )}
      {hover !== null && w > 0 && !activeTag && (
        <ChartTooltip x={X(hover)} y={pad.t} width={w}>
          {tooltip ? tooltip(data[hover], hover) : <>
            <div className="mb-1 font-medium">{xText(hover)}</div>
            {S.map((s, si) => {
              if (s.type === 'float') { const sp = span(hover, si); return sp && <TooltipRow key={s.key} color={s.colorOf?.(data[hover], hover) ?? s.color} label={s.label} value={`${fmtOf(s)(sp[0])} → ${fmtOf(s)(sp[1])}`} /> }
              const v = num(data[hover][s.key]); return v !== null && <TooltipRow key={s.key} color={s.color} label={s.label} dashed={s.dashed} value={fmtOf(s)(v)} />
            })}
            {band && num(data[hover][band.lower]) !== null && <TooltipRow color="var(--band)" label={band.label ?? 'Range'} value={`${format(num(data[hover][band.lower])!)}–${format(num(data[hover][band.upper])!)}`} />}
          </>}
        </ChartTooltip>
      )}
    </ChartShell>
  )
}

export type Slice = { label: string; value: number; color?: string }

/**
 * Share of a total. variant 'donut' (default; pie with thickness = size/2) or 'polar' (polar area: equal angles,
 * radius by value). Hover or tap a slice or legend row to focus it (tap outside to clear). Sweeps in when scrolled into view.
 */
export function DonutChart({ data, size = 150, thickness = 20, format: formatProp, centerLabel: centerProp, variant = 'donut', label, table, exportable, ref: userRef, className }:
  { data: Slice[]; size?: number; thickness?: number; format?: (n: number) => string; centerLabel?: string; variant?: 'donut' | 'polar'
    /** accessible name (default "<centerLabel> by share" / "Polar area chart") */ label?: string; className?: string } & ChartKitProps) {
  const [ref, seen] = useChartSeen<HTMLDivElement>()
  const format = formatProp ?? fmt.compact, centerLabel = centerProp ?? 'Total'
  const total = data.reduce((a, d) => a + d.value, 0) || 1
  const pctOf = (d: Slice) => fmt.percent(Math.round((d.value / total) * 100) / 100, 0)
  const name = label ?? (variant === 'polar' ? 'Polar area chart' : `${centerLabel} by share`)
  const shell = useChartShell({
    table, exportable, ref: userRef, box: ref, count: data.length, label: name,
    data: { head: ['Item', 'Value', 'Share'], rows: data.map(d => [d.label, d.value, d.value / total]), formats: [undefined, formatProp, (f: number) => fmt.percent(Math.round(f * 100) / 100, 0)] },
    summary: `${plural(data.length, 'slice')}, total ${format(total)}: ${fmt.list(data.map(d => `${d.label} ${format(d.value)} (${pctOf(d)})`))}.`,
    describe: i => `${data[i].label}: ${format(data[i].value)}, ${pctOf(data[i])} of ${format(total)}`,
  })
  const { hover, setHover } = shell
  const colorOf = (d: Slice, i: number) => seriesColor(i, d.color)
  const r = (size - thickness) / 2 - 2, c = 2 * Math.PI * r
  const cx = size / 2, R = size / 2 - 6, max = maxOf(data.map(d => d.value)) || 1
  /** angle of slice edge `k` (equal slices, from 12 o'clock) */
  const at = (k: number) => (k / data.length) * 2 * Math.PI - Math.PI / 2
  const sliceProps = (i: number) => ({ onPointerEnter: () => setHover(i), onPointerDown: () => setHover(i), onPointerLeave: onMouseLeave(() => setHover(null)) })
  let acc = 0
  return (
    <ChartShell shell={shell} className={className} boxClassName="flex flex-wrap items-center gap-5">
      <div className="relative" style={{ width: size, height: size }}>
        {variant === 'donut' ? (
          <svg width={size} height={size} aria-hidden className="-rotate-90">
            {data.map((d, i) => {
              const len = (d.value / total) * c, off = acc; acc += len
              return <motion.circle key={d.label} cx={size / 2} cy={size / 2} r={r} fill="none" stroke={colorOf(d, i)}
                strokeDasharray={`${Math.max(0, len - 2)} ${c}`} initial={{ strokeDashoffset: c, strokeWidth: thickness }}
                animate={{ strokeDashoffset: seen ? -off : c, strokeWidth: hover === i ? thickness + 6 : thickness, opacity: hover === null || hover === i ? 1 : 0.4 }}
                transition={{ ...spring(0.15, 0.8), delay: seen ? i * 0.05 : 0 }} {...sliceProps(i)} />
            })}
          </svg>
        ) : (
          <svg width={size} height={size} aria-hidden className="overflow-visible">
            {[0.25, 0.5, 0.75, 1].map(f => <circle key={f} cx={cx} cy={cx} r={R * f} fill="none" stroke="var(--line)" />)}
            {data.map((d, i) => {
              const rr = (d.value / max) * R + (hover === i ? 4 : 0)
              return <motion.path key={d.label} fill={colorOf(d, i)} fillOpacity={0.8} stroke="var(--card)" strokeWidth={2} strokeLinejoin="round"
                initial={{ d: svgWedge(cx, cx, 0, at(i), at(i + 1)) }} animate={{ d: svgWedge(cx, cx, seen ? rr : 0, at(i), at(i + 1)), opacity: hover === null || hover === i ? 1 : 0.45 }}
                transition={{ ...spring(0.2, 0.7), delay: seen && hover === null ? i * 0.06 : 0 }} {...sliceProps(i)} />
            })}
          </svg>
        )}
        {variant === 'donut' ? (
          <div aria-hidden className="pointer-events-none absolute inset-0 grid place-content-center text-center">
            <span className="text-xs text-[var(--fg3)]">{hover === null ? centerLabel : data[hover].label}</span>
            <AnimatedNumber value={hover === null ? total : data[hover].value} className="justify-center text-lg font-semibold" format={{ notation: 'compact', maximumFractionDigits: 1 }} />
          </div>
        ) : hover !== null && (() => {
          const [x, y] = polarPt(cx, cx, (data[hover].value / max) * R * 0.6, at(hover + 0.5))
          return <ChartTooltip x={x} y={y - 16} width={size + 150}><TooltipRow color={colorOf(data[hover], hover)} label={data[hover].label} value={format(data[hover].value)} /></ChartTooltip>
        })()}
      </div>
      <div aria-hidden className="flex min-w-[140px] flex-1 flex-col gap-1.5">
        {data.map((d, i) => (
          <div key={d.label} {...sliceProps(i)} className={cn('flex items-center gap-2 text-[13px] transition-opacity', TOUCH.tap, hover !== null && hover !== i && 'opacity-50')}>
            <span className="h-2.5 w-2.5 rounded-[var(--r-sm)]" style={{ background: safeColor(colorOf(d, i)) }} />
            <span className="flex-1 text-[var(--fg2)]">{d.label}</span><span className="ui-num">{format(d.value)}</span>
            <span className="ui-num w-10 text-end text-xs text-[var(--fg3)]">{pctOf(d)}</span>
          </div>
        ))}
      </div>
    </ChartShell>
  )
}

/**
 * Half-circle gauge. The arc sweeps and the number rolls up when scrolled into view, and again whenever `value` changes.
 * Colour comes from `color`, or from `thresholds` (fraction of the range → colour). `label` is the caption under the number.
 */
export function Gauge({ value, min = 0, max = 100, label, format, numberFormat = { maximumFractionDigits: 0 }, color, thresholds = [[0.6, 'var(--ok)'], [0.85, 'var(--warn)'], [1, 'var(--bad)']], className }:
  { value: number; min?: number; max?: number; label?: string; format?: (v: number) => string; numberFormat?: Intl.NumberFormatOptions; color?: string; thresholds?: [number, string][]; className?: string }) {
  const [ref, seen] = useChartSeen<HTMLDivElement>()
  const raw = (value - min) / (max - min || 1), t = Number.isFinite(raw) ? clamp(raw, 0, 1) : 0
  const stroke = color ?? thresholds.find(([at]) => t <= at)?.[1] ?? 'var(--primary)'
  const shown = useTween(seen && Number.isFinite(value) ? value : min, 800)
  const arc = 'M 12 82 A 68 68 0 0 1 148 82'
  return (
    <div ref={ref} className={cn('relative mx-auto w-full max-w-[220px]', className)}>
      <svg viewBox="0 0 160 92" className="block w-full" role="img" aria-label={`${label ?? 'Gauge'}: ${format ? format(value) : fmt.number(value, numberFormat)}`}>
        <path d={arc} fill="none" stroke="var(--muted)" strokeWidth={14} strokeLinecap="round" />
        <motion.path d={arc} fill="none" stroke={stroke} strokeWidth={14} strokeLinecap="round" initial={{ pathLength: 0 }} animate={{ pathLength: seen ? Math.max(0.001, t) : 0, stroke }} transition={spring(0.15, 0.9)} />
      </svg>
      <div className="absolute inset-x-0 bottom-1 text-center">
        {format ? <div className="ui-num text-2xl font-semibold">{format(shown)}</div> : <AnimatedNumber value={Math.round(shown)} format={numberFormat} className="justify-center text-[28px] font-semibold tracking-tight" />}
        {label && <div className="mt-1 text-xs text-[var(--fg3)]">{label}</div>}
      </div>
    </div>
  )
}

/** Radar / spider chart for comparing a few profiles across the same axes. Vertex dots, dashed or unfilled series; hover or tap an axis for its values. */
export function RadarChart({ axes, series, max, size = 240, format: formatProp, label, table, exportable, ref: userRef, className }:
  { axes: string[]; series: { label: string; values: number[]; color?: string; dashed?: boolean; fill?: boolean }[]; max?: number; size?: number; format?: (n: number) => string
    /** accessible name (default: the series labels) */ label?: string; className?: string } & ChartKitProps) {
  const [ref, seen] = useChartSeen<HTMLDivElement>()
  const format = formatProp ?? fmt.compact
  const name = label ?? `Radar chart: ${fmt.list(series.map(s => s.label))}`
  const shell = useChartShell({
    table, exportable, ref: userRef, box: ref, count: axes.length, label: name,
    data: { head: ['Axis', ...series.map(s => s.label)], rows: axes.map((a, i) => [a, ...series.map(s => Number.isFinite(s.values[i]) ? s.values[i] : null)]), formats: [undefined, ...series.map(() => formatProp)] },
    summary: [`${plural(axes.length, 'axis', 'axes')}: ${fmt.list(axes)}.`, ...series.map(s => `${s.label}: ${rangeStr(s.values, format)}.`)].join(' '),
    describe: i => `${axes[i]}: ${series.map(s => `${s.label} ${format(s.values[i] ?? 0)}`).join(', ')}`,
  })
  const { hover, setHover } = shell
  // an all-zero (or empty) chart would divide by zero: fall back to a unit scale
  const m = (max ?? maxOf(series.flatMap(s => s.values.filter(Number.isFinite)), 0)) || 1, cx = size / 2, cy = size / 2, R = size / 2 - 34
  const ang = (i: number) => (Math.PI * 2 * i) / (axes.length || 1) - Math.PI / 2
  const pt = (i: number, v: number) => polarPt(cx, cy, R * (v / m), ang(i))
  const colorOf = (i: number) => seriesColor(i, series[i].color)
  return (
    <ChartShell shell={shell} className={cn('flex flex-col items-center', className)} style={{ width: size, height: size }}
      after={<Legend items={series.map((s, i) => ({ label: s.label, color: colorOf(i), dashed: s.dashed }))} />}>
      <svg width={size} height={size} aria-hidden className="overflow-visible text-[11px]">
        {[0.25, 0.5, 0.75, 1].map(f => <path key={f} d={linePath(axes.map((_, i) => pt(i, m * f))) + 'Z'} fill="none" stroke="var(--line)" />)}
        {axes.map((a, i) => { const [x, y] = pt(i, m * 1.16); return <g key={a}><line x1={cx} y1={cy} x2={pt(i, m)[0]} y2={pt(i, m)[1]} stroke={hover === i ? 'var(--fg3)' : 'var(--line)'} /><text x={x} y={y} dy="0.32em" textAnchor="middle" fill={hover === i ? 'var(--fg)' : 'var(--fg2)'}>{a}</text></g> })}
        {series.map((s, si) => {
          const d = linePath(s.values.map((v, i) => pt(i, v))) + 'Z', d0 = linePath(s.values.map((_, i) => pt(i, 0))) + 'Z', color = colorOf(si)
          return <motion.path key={s.label} initial={{ d: d0 }} animate={{ d: seen ? d : d0 }} fill={s.fill === false ? 'none' : color} fillOpacity={0.15} stroke={color} strokeWidth={2}
            strokeDasharray={s.dashed ? '4 3' : undefined} strokeLinejoin="round" transition={{ ...spring(0.2, 0.8), delay: seen ? si * 0.1 : 0 }} />
        })}
        {series.map((s, si) => s.values.map((v, i) => {
          const [x, y] = seen ? pt(i, v) : [cx, cy]
          return <motion.circle key={`${s.label}${i}`} fill={colorOf(si)} stroke="var(--card)" strokeWidth={1.5} initial={{ cx, cy, r: 2.5 }}
            animate={{ cx: x, cy: y, r: hover === i ? 4.5 : 2.5 }} transition={{ ...spring(0.2, 0.8), delay: seen && hover === null ? si * 0.1 : 0 }} />
        }))}
        {axes.map((a, i) => <path key={a} d={svgWedge(cx, cy, R * 1.25, ang(i - 0.5), ang(i + 0.5))} fill="transparent" onPointerEnter={() => setHover(i)} onPointerDown={e => { releaseTouchCapture(e); setHover(i) }} />)}
      </svg>
      {hover !== null && (() => { const [x, y] = pt(hover, m * 0.55); return (
        <ChartTooltip x={x} y={y - 20} width={size + 60}>
          <div className="mb-1 font-medium">{axes[hover]}</div>
          {series.map((s, si) => <TooltipRow key={s.label} color={colorOf(si)} dashed={s.dashed} label={s.label} value={format(s.values[hover] ?? 0)} />)}
        </ChartTooltip>
      ) })()}
    </ChartShell>
  )
}

export type Point = { x: number; y: number; r?: number; label?: string; group?: string }
/**
 * Scatter plot; give points an `r` for a bubble chart and a `group` for colours. Points pop in when scrolled into view.
 * Hover or tap near a point (or slide a finger) for its tooltip; touch uses a wider catch radius.
 */
export function ScatterChart({ points: allPoints, height = 220, xLabel, yLabel, format: formatProp, xDomain, yDomain, maxPoints, label, table, exportable, ref: userRef, className }:
  { points: Point[]; height?: number; xLabel?: string; yLabel?: string; format?: (n: number) => string; xDomain?: [number, number]; yDomain?: [number, number]
    /** draw at most this many points (evenly sampled) */ maxPoints?: number; /** accessible name (default "Scatter plot" / "Bubble chart") */ label?: string; className?: string } & ChartKitProps) {
  const points = useMemo(() => chartDownsample(allPoints, maxPoints), [allPoints, maxPoints])
  // the keyboard walks the points left to right
  const order = useMemo(() => points.map((_, i) => i).sort((a, b) => points[a].x - points[b].x || points[a].y - points[b].y), [points])
  const [ref, w, seen] = useChartFrame<HTMLDivElement>()
  const groups = [...new Set(points.map(p => p.group ?? ''))]
  const format = formatProp ?? fmt.compact
  const xt = niceTicks(xDomain?.[0] ?? minOf(points.map(p => p.x)), xDomain?.[1] ?? maxOf(points.map(p => p.x)))
  const yt = niceTicks(yDomain?.[0] ?? minOf(points.map(p => p.y), 0), yDomain?.[1] ?? maxOf(points.map(p => p.y)))
  const pad = { l: chartAxisPad(yt.map(format)), r: 12, t: 10, b: 28 }, iw = w - pad.l - pad.r, ih = height - pad.t - pad.b
  const X = linScale(xt[0], xt[xt.length - 1], pad.l, pad.l + iw), Y = linScale(yt[0], yt[yt.length - 1], pad.t + ih, pad.t)
  const color = (p: Point) => seriesColor(groups.indexOf(p.group ?? ''))
  const bubbles = points.some(p => p.r !== undefined)
  const pointText = (p: Point) => (p.label ? `${p.label}: ` : '') + [`${xLabel ?? 'x'} ${format(p.x)}`, `${yLabel ?? 'y'} ${format(p.y)}`, ...(p.r !== undefined ? [`size ${format(p.r)}`] : []), ...(p.group ? [p.group] : [])].join(', ')
  const name = label ?? (bubbles ? 'Bubble chart' : 'Scatter plot')
  const tLabels = allPoints.some(p => p.label), tSizes = allPoints.some(p => p.r !== undefined), tGroups = new Set(allPoints.map(p => p.group ?? '')).size > 1
  // the active index walks `order` (left to right), so pointer and keyboard share it
  const shell = useChartShell({
    table, exportable, ref: userRef, box: ref, count: points.length, label: name,
    data: {
      head: [...(tLabels ? ['Label'] : []), xLabel ?? 'x', yLabel ?? 'y', ...(tSizes ? ['size'] : []), ...(tGroups ? ['Group'] : [])],
      rows: allPoints.map(p => [...(tLabels ? [p.label ?? ''] : []), p.x, p.y, ...(tSizes ? [p.r ?? null] : []), ...(tGroups ? [p.group ?? ''] : [])]),
      formats: [...(tLabels ? [undefined] : []), formatProp, formatProp, ...(tSizes ? [formatProp] : [])],
    },
    summary: [`${plural(points.length, 'point')}.`, `${xLabel ?? 'x'} ${rangeStr(points.map(p => p.x), format)}, ${yLabel ?? 'y'} ${rangeStr(points.map(p => p.y), format)}.`, ...(groups.length > 1 ? [`Groups: ${fmt.list(groups)}.`] : []), 'Arrow keys go left to right.'].join(' '),
    describe: k => pointText(points[order[k]]),
  })
  const hover = shell.hover === null ? null : order[shell.hover]
  const near = (e: ReactPointerEvent<SVGSVGElement>) => {
    const b = e.currentTarget.getBoundingClientRect(), mx = e.clientX - b.left, my = e.clientY - b.top, slop = isTouch(e) ? 22 : 6
    let best: number | null = null, bd = Infinity
    points.forEach((p, i) => { const d = Math.hypot(X(p.x) - mx, Y(p.y) - my) - (p.r ?? 4); if (d < slop && d < bd) { bd = d; best = i } })
    if (best !== null || !isTouch(e) || e.type === 'pointerdown') shell.setHover(best === null ? null : order.indexOf(best))
  }
  return (
    <ChartShell shell={shell} className={className} style={{ height }} after={groups.length > 1 && <Legend items={groups.map((g, i) => ({ label: g, color: seriesColor(i) }))} />}>
      {w > 0 && (
        <svg width={w} height={height} aria-hidden className="block touch-pan-y overflow-visible text-[11px]" onPointerDown={near} onPointerMove={near}>
          <ChartGridY ticks={yt} Y={Y} x1={pad.l} x2={w - pad.r} format={format} />
          <ChartAxisX y={height - 12} ticks={xt.map(t => ({ x: X(t), label: format(t) }))} />
          {xLabel && <text x={w - pad.r} y={height} textAnchor="end" fill="var(--fg3)">{xLabel}</text>}
          {yLabel && <text x={pad.l} y={pad.t - 2} fill="var(--fg3)">{yLabel}</text>}
          {/* plain circles scaled by a CSS transition (one transform each), not 40 JS-driven r tweens: cheap to mount */}
          {points.map((p, i) => (
            <circle key={i} cx={X(p.x)} cy={Y(p.y)} r={p.r ?? 4} fill={color(p)} fillOpacity={p.r ? 0.35 : 0.7} stroke={hover === i ? 'var(--fg2)' : color(p)} strokeWidth={p.r ? 1.5 : hover === i ? 1.5 : 0}
              style={{ transform: `scale(${seen ? (hover === i ? 1.35 : 1) : 0})`, transformBox: 'fill-box', transformOrigin: 'center',
                transition: `transform ${seen && hover === null ? '.5s' : '.2s'} cubic-bezier(.34,1.56,.64,1) ${seen && hover === null ? i * 0.012 : 0}s` }} />
          ))}
        </svg>
      )}
      {hover !== null && <ChartTooltip x={X(points[hover].x)} y={Y(points[hover].y) - 20} width={w}>
        {points[hover].label && <div className="mb-1 font-medium">{points[hover].label}</div>}
        <TooltipRow color={color(points[hover])} label={xLabel ?? 'x'} value={format(points[hover].x)} /><TooltipRow color={color(points[hover])} label={yLabel ?? 'y'} value={format(points[hover].y)} />
        {points[hover].r !== undefined && <TooltipRow color={color(points[hover])} label="size" value={format(points[hover].r!)} />}
      </ChartTooltip>}
    </ChartShell>
  )
}

/** Shade a cell from muted to `color` by t ∈ [0, 1]. */
const heat = (t: number, color = 'var(--accent)') => t <= 0 ? 'var(--muted)' : `color-mix(in srgb, ${color} ${Math.round(15 + t * 85)}%, var(--muted))`

/**
 * Matrix heatmap: rows × columns. Cells fade in when scrolled into view; hover or tap a cell (slide a finger across)
 * for its value in the footer, or focus the grid and move with the arrow keys. `shade` maps value/max → colour. On touch
 * screens cells grow to at least `touchCell`; when the grid is wider than its box it scrolls inside it with the row
 * labels pinned (`scrollTo` picks the start edge).
 */
export function Heatmap({ rows, cols, value, format: formatProp, cell = 18, touchCell = 24, label = (r, c) => `${rows[r]} · ${cols[c]}`, color = 'var(--accent)', shade, footer = true, scrollTo = 'start', name, table, exportable, ref: userRef, className }:
  {
    rows: string[]; cols: string[]; value: (r: number, c: number) => number; format?: (n: number) => string; cell?: number; touchCell?: number; label?: (r: number, c: number) => string
    color?: string; shade?: (t: number) => string; footer?: boolean; scrollTo?: 'start' | 'end'
    /** accessible name of the grid (default "Heatmap, 7 rows by 12 columns") */ name?: string; className?: string
  } & ChartKitProps) {
  const [ref, seen] = useChartSeen<HTMLDivElement>()
  const [scrolls, setScrolls] = useState(false)
  const coarse = useCoarsePointer()
  const format = formatProp ?? fmt.compact
  const size = coarse ? Math.max(cell, touchCell) : cell
  const vals = rows.map((_, r) => cols.map((_, c) => value(r, c))), max = maxOf(vals.flat().filter(Number.isFinite), 0) || 1
  const fill = (t: number) => safeColor(shade ? shade(t) : heat(t, color), 'var(--muted)')
  const gap = Math.ceil(30 / (size + 3)) // columns each label needs; skip labels that would collide
  let last = -gap
  const shown = cols.map((c, i) => (c && i - last >= gap ? ((last = i), c) : ''))
  useResizeObserver(ref, el => setScrolls(el.scrollWidth > el.clientWidth + 1), [size, cols.length])
  useLayoutEffect(() => { if (scrollTo === 'end' && ref.current) ref.current.scrollLeft = ref.current.scrollWidth }, [size, cols.length, scrollTo])
  // the staggered fade-in only applies to the first reveal; later hover changes answer straight away
  const [introDone, setIntroDone] = useState(false)
  useEffect(() => { if (!seen || introDone) return; const t = setTimeout(() => setIntroDone(true), 900); return () => clearTimeout(t) }, [seen, introDone])
  // keyboard: grid mode (one Tab stop; ↑/↓ move by a row, Home/End stay in the row); the active cell is r * nc + c
  const nc = cols.length, flat = vals.flat()
  const gridName = name ?? `Heatmap, ${plural(rows.length, 'row')} by ${plural(nc, 'column')}`
  // a matrix when every row and column has a label; otherwise (the calendar's blank labels) one row per cell
  const matrix = rows.every(Boolean) && cols.every(Boolean)
  const shell = useChartShell({
    table, exportable, ref: userRef, box: ref, count: rows.length * nc, columns: nc, start: scrollTo === 'end' ? nc - 1 : 0, label: gridName,
    data: matrix
      ? { head: ['Category', ...cols], rows: rows.map((r, ri) => [r, ...vals[ri]]), formats: [undefined, ...cols.map(() => formatProp)] }
      : { head: ['Item', 'Value'], rows: rows.flatMap((_, ri) => cols.map((_, ci) => [label(ri, ci), vals[ri][ci]])), formats: [undefined, formatProp] },
    summary: `Values ${rangeStr(flat, format)}. Arrow keys read the cells.`,
    describe: k => `${label(Math.floor(k / nc), k % nc)}: ${format(flat[k])}`,
  })
  const hover = shell.hover === null ? null : [Math.floor(shell.hover / nc), shell.hover % nc] as const
  const setHover = (r: number, c: number) => shell.setHover(r * nc + c)
  useEffect(() => { if (hover) ref.current?.querySelector<HTMLElement>(`[data-hm="${hover[0]}-${hover[1]}"]`)?.scrollIntoView({ block: 'nearest', inline: 'nearest' }) }, [shell.hover]) // eslint-disable-line react-hooks/exhaustive-deps
  const pin = 'sticky start-0 z-[1] bg-[var(--card)] shadow-[3px_0_0_var(--card)]'
  return (
    <ChartShell shell={shell} className={className} boxClassName="overflow-x-auto overscroll-x-contain"
      after={footer && <div className="mt-2 h-4 truncate text-xs text-[var(--fg2)]" aria-live="polite">{hover ? <>{label(hover[0], hover[1])} · <b className="ui-num font-medium">{format(vals[hover[0]][hover[1]])}</b></>
        : <>{coarse ? 'Tap a cell' : 'Hover a cell'}{scrolls && <span className="text-[var(--fg3)]"> · {coarse ? 'swipe for more' : 'scroll for more'}</span>}</>}</div>}>
      <div className="inline-grid gap-1 text-[11px] text-[var(--fg3)]" style={{ gridTemplateColumns: `auto repeat(${cols.length}, ${size}px)` }}>
        <span className={pin} />{shown.map((c, i) => <span key={i} aria-hidden className="overflow-visible text-start whitespace-nowrap">{c}</span>)}
        {rows.map((r, ri) => [
          <span key={`r${ri}`} aria-hidden className={cn('pe-1.5', pin)} style={{ lineHeight: `${size}px` }}>{r}</span>,
          // plain spans with CSS transitions (opacity + transform) rather than one motion component per cell: a 26-week
          // calendar has 182 cells, which made the mount frame long
          ...cols.map((_, ci) => {
            const on = hover?.[0] === ri && hover[1] === ci
            return <span key={`${ri}-${ci}`} data-hm={`${ri}-${ci}`} aria-hidden onPointerEnter={() => setHover(ri, ci)} onPointerDown={e => { releaseTouchCapture(e); setHover(ri, ci) }}
              className={cn('rounded-[var(--r-sm)] transition-[opacity,transform] duration-300 ease-out', on && 'relative z-[1] shadow-[0_0_0_1.5px_var(--card),0_0_0_3px_var(--fg2)]')}
              style={{ height: size, background: fill(vals[ri][ci] / max), opacity: seen ? 1 : 0, transform: `scale(${seen ? (on ? 1.2 : 1) : 0.6})`, transitionDelay: seen && !introDone ? `${Math.min(0.5, ci * 0.012 + ri * 0.02)}s` : '0s' }} />
          }),
        ])}
      </div>
    </ChartShell>
  )
}

const CAL_LEVELS = [0, 35, 60, 100]
const calShade = (k: number) => k === 0 ? 'var(--muted)' : `color-mix(in srgb, var(--c4) ${CAL_LEVELS[k]}%, var(--muted))`
const calLevel = (t: number) => t <= 0 ? 0 : t <= 0.4 ? 1 : t <= 0.7 ? 2 : 3

/**
 * GitHub-style contribution grid in 4 levels with a Less → More legend. `values` maps core dayKey(date) → count.
 * `end` is the last day shown (default: today, read after mount so server and client render the same).
 * Built on Heatmap; cells size to fit, and on touch screens stay tappable and scroll inside the card (newest week in view, days pinned).
 */
export function CalendarHeatmap({ values, weeks = 26, end: endProp, table, exportable, ref: userRef, className }: { values: Record<string, number>; weeks?: number; end?: Date; className?: string } & ChartKitProps) {
  const [ref, w] = useWidth<HTMLDivElement>()
  const [today, setToday] = useState<Date | null>(null)
  useEffect(() => { if (!endProp) setToday(new Date()) }, [endProp])
  const end = endProp ?? today
  const start = end && addDays(startOfWeek(end), -(weeks - 1) * 7) // Monday, `weeks` columns back
  const day = (wk: number, d: number) => addDays(start!, wk * 7 + d)
  const month = (wk: number) => fmt.date(day(wk, 0), { month: 'short' })
  const wd = fmt.weekdays('short') // rows from the locale's first day; every other one is labelled
  // label a column only where a new month starts
  const cols = start ? Array.from({ length: weeks }, (_, wk) => (wk === 0 || month(wk) !== month(wk - 1) ? month(wk) : '')) : []
  const cell = Math.max(8, Math.min(14, Math.floor((w - 34) / weeks) - 4)) // minus the Heatmap gap (gap-1)
  return (
    <div ref={ref} className={className}>
      {w > 0 && start && <Heatmap table={table} exportable={exportable} ref={userRef} name={`Contributions, last ${weeks} weeks`} cell={cell} touchCell={20} scrollTo="end" rows={[wd[0], '', wd[2], '', wd[4], '', '']} cols={cols} value={(r, c) => values[dayKey(day(c, r))] ?? 0} shade={t => calShade(calLevel(t))}
        label={(r, c) => fmt.date(day(c, r), { weekday: 'short', day: 'numeric', month: 'short' })} format={n => plural(n, 'contribution')} />}
      <div className="mt-1 flex items-center justify-end gap-1 text-[11px] text-[var(--fg3)]">
        {'Less'}{[0, 1, 2, 3].map(k => <span key={k} className="h-2.5 w-2.5 rounded-[var(--r-sm)]" style={{ background: calShade(k) }} />)}{'More'}
      </div>
    </div>
  )
}

/**
 * Funnel with step-to-step conversion. Bars grow in when scrolled into view (a clip-path wipe from the centre, so nothing
 * reflows); hover, tap or arrow-key a step for its share of the first step.
 */
export function FunnelChart({ steps, format: formatProp, label: labelProp, table, exportable, ref: userRef, className }: { steps: { label: string; value: number }[]; format?: (n: number) => string; /** accessible name */ label?: string; className?: string } & ChartKitProps) {
  const [ref, seen] = useChartSeen<HTMLDivElement>()
  const format = formatProp ?? fmt.compact, label = labelProp ?? 'Funnel'
  const max = steps[0]?.value || 1
  const ofPrev = (i: number) => (i > 0 && steps[i - 1].value ? steps[i].value / steps[i - 1].value : null)
  const share = (i: number) => chartPct(steps[i].value / max)
  const conv = (i: number) => { const f = ofPrev(i); return f === null ? null : chartPct(f) }
  const shell = useChartShell({
    table, exportable, ref: userRef, box: ref, count: steps.length, label,
    data: { head: ['Step', 'Count', 'Of first step', 'Of previous'], rows: steps.map((st, i) => [st.label, st.value, st.value / max, ofPrev(i)]), formats: [undefined, formatProp, chartPct, chartPct] },
    summary: `${plural(steps.length, 'step')}: ${fmt.list(steps.map(s => `${s.label} ${format(s.value)}`))}.` + (steps.length > 1 ? ` ${share(steps.length - 1)} reach the last step.` : ''),
    describe: i => `${steps[i].label}: ${format(steps[i].value)}, ${share(i)} of the first step` + (conv(i) !== null ? `, ${conv(i)} of the step before` : ''),
    tip: i => <>
      <div className="mb-1 font-medium">{steps[i].label}</div>
      <TooltipRow color={PALETTE[0]} label="Count" value={format(steps[i].value)} />
      <TooltipRow color={PALETTE[0]} label="Of first step" value={share(i)} />
    </>,
  })
  const { hover } = shell
  return (
    <ChartShell shell={shell} className={className} boxClassName="flex flex-col gap-1">
      {steps.map((s, i) => {
        const cut = (100 - (s.value / max) * 100) / 2
        return (
          <div key={s.label} aria-hidden>
            {i > 0 && <div className="py-0.5 text-center text-[11px] text-[var(--fg3)]">↓ {conv(i) ?? chartPct(0)}</div>}
            <div className="flex items-center gap-3 text-[13px]" {...shell.bind(i)}>
              <span className="w-24 flex-none truncate text-[var(--fg2)]">{s.label}</span>
              <div className="flex-1">
                <motion.div data-ci={i} className={cn('h-7 rounded-[var(--r-md)] transition-shadow', hover === i && 'shadow-[0_0_0_2px_var(--card),0_0_0_3.5px_var(--fg3)]')} style={{ background: PALETTE[0] }}
                  initial={{ clipPath: 'inset(0% 50% 0% 50% round 8px)' }}
                  animate={{ clipPath: seen ? `inset(0% ${cut}% 0% ${cut}% round 8px)` : 'inset(0% 50% 0% 50% round 8px)', opacity: (1 - i * 0.2) * (hover === null || hover === i ? 1 : 0.6) }}
                  transition={{ ...spring(0.15, 0.6), delay: seen ? i * 0.08 : 0 }} />
              </div>
              <span className="ui-num w-12 text-end">{format(s.value)}</span>
            </div>
          </div>
        )
      })}
    </ChartShell>
  )
}

/**
 * Ranked horizontal bars: top pages, countries, referrers. Bars grow in when scrolled into view (a clip-path wipe, no
 * reflow). Hover a row or arrow-key through them to highlight one; the values are always printed.
 */
export function BarList({ items, format: formatProp, color = 'var(--accent)', label: labelProp, table, exportable, ref: userRef, className }: { items: { label: ReactNode; value: number; key?: string }[]; format?: (n: number) => string; color?: string; /** accessible name */ label?: string; className?: string } & ChartKitProps) {
  const [ref, seen] = useChartSeen<HTMLDivElement>()
  const max = maxOf(items.map(i => i.value), 0) || 1
  const format = formatProp ?? fmt.compact, label = labelProp ?? 'Ranked list'
  const shell = useChartShell({
    table, exportable, ref: userRef, box: ref, count: items.length, label,
    data: { head: ['Item', 'Value'], rows: items.map(it => [chartText(it.label) || it.key || '', it.value]), formats: [undefined, formatProp] },
    summary: `${plural(items.length, 'item')}, ${rangeStr(items.map(i => i.value), format)}.`,
    describe: i => `${i + 1} of ${items.length}: ${chartText(items[i].label)} ${format(items[i].value)}`,
  })
  const { hover, setHover } = shell
  const wipe = (f: number) => `inset(0% ${f}% 0% 0% round 8px)`
  const bar = `color-mix(in srgb, ${safeColor(color, 'var(--accent)')} 16%, transparent)`
  return (
    <ChartShell shell={shell} className={className} boxClassName="flex flex-col gap-1">
      {items.map((it, i) => (
        <div key={it.key ?? String(it.label)} onPointerEnter={() => setHover(i)}
          className={cn('relative flex h-8 items-center justify-between overflow-hidden rounded-[var(--r-md)] px-2.5 text-[13px] transition-colors', hover === i && 'bg-[var(--muted)]')}>
          <motion.span aria-hidden className="absolute inset-0 rounded-[var(--r-md)]" style={{ background: bar }}
            initial={{ clipPath: wipe(100) }} animate={{ clipPath: wipe(seen ? 100 - (it.value / max) * 100 : 100) }}
            transition={{ ...spring(0.1, 0.6), delay: seen ? i * 0.04 : 0 }} />
          <span className="relative truncate">{it.label}</span><span className="ui-num relative text-[var(--fg2)]">{format(it.value)}</span>
        </div>
      ))}
    </ChartShell>
  )
}

/**
 * Squarified treemap: area ∝ value. Tiles grow out of their centres when scrolled into view and re-flow with a spring
 * when values change; both run on transforms (motion layout animations), never on left/top/width/height. Hover, tap or
 * arrow-key a tile to highlight it and see its share. `show` picks the second line: value or percent.
 */
export function Treemap({ items, height = 220, format: formatProp, show = 'value', label: labelProp, table, exportable, ref: userRef, className }:
  { items: { label: string; value: number; color?: string }[]; height?: number; format?: (n: number) => string; show?: 'value' | 'percent'; /** accessible name */ label?: string; className?: string } & ChartKitProps) {
  const [ref, w, seen] = useChartFrame<HTMLDivElement>()
  const format = formatProp ?? fmt.compact, label = labelProp ?? 'Treemap'
  const total = items.reduce((a, d) => a + d.value, 0) || 1
  type Rect = { x: number; y: number; w: number; h: number; i: number }
  const rects = useMemo(() => {
    const out: Rect[] = []
    const sorted = items.map((d, i) => ({ a: (d.value / total) * w * height, i })).sort((p, q) => q.a - p.a)
    let box = { x: 0, y: 0, w, h: height }, row: typeof sorted = []
    const worst = (r: typeof sorted, side: number) => { const s = r.reduce((a, d) => a + d.a, 0); return maxOf(r.map(d => Math.max((side * side * d.a) / (s * s), (s * s) / (side * side * d.a)))) }
    const lay = (r: typeof sorted) => {
      const s = r.reduce((a, d) => a + d.a, 0), wide = box.w >= box.h, side = wide ? box.h : box.w, thick = s / side
      let o = 0
      r.forEach(d => { const len = d.a / thick; out.push(wide ? { x: box.x, y: box.y + o, w: thick, h: len, i: d.i } : { x: box.x + o, y: box.y, w: len, h: thick, i: d.i }); o += len })
      box = wide ? { x: box.x + thick, y: box.y, w: box.w - thick, h: box.h } : { x: box.x, y: box.y + thick, w: box.w, h: box.h - thick }
    }
    for (const d of sorted) {
      const side = Math.min(box.w, box.h)
      if (!row.length || worst([...row, d], side) <= worst(row, side)) row.push(d)
      else { lay(row); row = [d] }
    }
    if (row.length) lay(row)
    return out
  }, [items, w, height, total])
  const pct = (i: number) => Math.round((items[i].value / total) * 100)
  const order = useMemo(() => rects.map(r => r.i), [rects]) // largest first; the active index walks this order
  const shell = useChartShell({
    table, exportable, ref: userRef, box: ref, count: items.length, label,
    data: { head: ['Item', 'Value', 'Share'], rows: items.map(it => [it.label, it.value, it.value / total]), formats: [undefined, formatProp, (f: number) => chartPct(Math.round(f * 100) / 100)] },
    summary: `${plural(items.length, 'part')}, largest first: ${fmt.list(order.map(i => `${items[i].label} ${chartPct(pct(i) / 100)}`))}.`,
    describe: k => { const i = order[k]; return `${items[i].label}: ${format(items[i].value)}, ${chartPct(pct(i) / 100)}` },
    tip: k => { const i = order[k]; return <TooltipRow color={seriesColor(i, items[i].color)} label={items[i].label} value={show === 'percent' ? chartPct(pct(i) / 100) : `${format(items[i].value)} · ${chartPct(pct(i) / 100)}`} /> },
  })
  const hover = shell.hover === null ? null : order[shell.hover]
  return (
    <ChartShell shell={shell} className={className} style={{ height }}>
      {w > 0 && rects.map((r, k) => {
        const it = items[r.i], color = seriesColor(r.i, it.color)
        return (
          // the box is laid out at its final rect straight away; `layout` animates the change as a transform (FLIP)
          // and the entrance is a scale from the centre, so no frame ever changes layout properties
          <motion.div key={it.label} data-ci={k} aria-hidden layout initial={{ scale: 0, opacity: 0 }} animate={seen ? { scale: 1, opacity: 1 } : { scale: 0, opacity: 0 }}
            transition={spring(0.2, 0.65)} className="absolute overflow-hidden p-[2px]" style={{ left: r.x, top: r.y, width: r.w, height: r.h }} {...shell.bind(k)}>
            <motion.div layout className={cn('h-full p-2 text-xs transition-[opacity,box-shadow]', hover === r.i && 'shadow-[inset_0_0_0_2px_var(--card)]')}
              style={{ borderRadius: 8, background: `color-mix(in srgb, ${safeColor(color, 'var(--accent)')} 72%, var(--fg))`, color: 'var(--card)', opacity: hover === null || hover === r.i ? 1 : 0.7 }}>
              {r.w > it.label.length * 6.5 + 18 && r.h > 34 && <motion.div layout="position">
                <b className="block truncate font-semibold">{it.label}</b>
                <span className="ui-num opacity-85">{show === 'percent' ? <AnimatedNumber value={pct(r.i) / 100} format={{ style: 'percent' }} /> : format(it.value)}</span>
              </motion.div>}
            </motion.div>
          </motion.div>
        )
      })}
    </ChartShell>
  )
}

/**
 * Stat tile: label, value that rolls up when scrolled into view, and a curved area sparkline under it. The tile is one
 * Tab stop: arrows walk the sparkline's points (a marker and readout follow), Home/End jump to the ends.
 */
export function SparkTile({ label, value, format, data, color = 'var(--ok)', height = 50, points, className }:
  { label: string; value: number; format?: Intl.NumberFormatOptions; data: number[]; color?: string; height?: number
    /** labels for the sparkline's points (keyboard readout), e.g. month names; default "point 3 of 14" */ points?: string[]; className?: string }) {
  const [ref, seen] = useChartSeen<HTMLDivElement>()
  const [boxRef, bw] = useWidth<HTMLDivElement>()
  const shown = useTween(seen ? value : 0, 1100)
  const n = data.length, lo = minOf(data), hi = maxOf(data), pad = 4
  const ptName = (i: number) => points?.[i] ?? `Point ${i + 1} of ${n}`
  const shell = useChartShell({
    box: ref, count: n, start: n - 1, label: `${label}: ${fmt.number(value, format)}`,
    summary: n ? `Trend of ${plural(n, 'point')}, ${rangeStr(data, fmt.compact)}, ${data[n - 1] >= data[0] ? 'up' : 'down'} ${chartPct(Math.abs((data[n - 1] - data[0]) / (Math.abs(data[0]) || 1)))} from the first.` : 'No trend data.',
    describe: i => `${ptName(i)}: ${fmt.compact(data[i])}`,
  })
  const { hover } = shell
  const px = linScale(0, Math.max(1, n - 1), 0, bw), py = (i: number) => linScale(lo, hi === lo ? lo + 1 : hi, height - pad, pad)(data[i])
  return (
    <ChartShell shell={shell} className={className} boxClassName="flex flex-col gap-1">
      <span aria-hidden className="text-xs text-[var(--fg3)]">{label}</span>
      <span aria-hidden><AnimatedNumber value={Math.round(shown)} format={format} className="text-[28px] font-semibold tracking-tight" /></span>
      <div ref={boxRef} aria-hidden className="relative mt-2" style={{ height }}>
        <SparkChart data={data} variant="area" curve="monotone" color={color} height={height} endDot />
        {hover !== null && bw > 0 && <>
          <span className="pointer-events-none absolute inset-y-0 w-px bg-[var(--line2)]" style={{ left: px(hover) }} />
          <span className="pointer-events-none absolute h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-[var(--card)]" style={{ left: px(hover), top: py(hover), background: safeColor(color) }} />
          <ChartTooltip x={px(hover)} y={-34} width={bw}><TooltipRow color={color} label={ptName(hover)} value={fmt.compact(data[hover])} /></ChartTooltip>
        </>}
      </div>
    </ChartShell>
  )
}

export type TickerRow = { symbol: string; name: string; data: number[] }
/**
 * Live price table: symbol, name, sparkline with an end dot, rolling last price and a % change pill (up/down coloured).
 * Feed it new `data` to tick. Price and change cells have a fixed width with tabular digits, so a tick never moves a column.
 */
export function TickerTable({ rows, className }: { rows: TickerRow[]; className?: string }) {
  return (
    <div role="table" aria-label={'Prices'} className={cn('flex flex-col', className)}>
      {rows.map(r => {
        const first = r.data[0] ?? 0, last = r.data[r.data.length - 1] ?? 0, ch = first ? (last / first - 1) * 100 : 0, up = ch >= 0
        return (
          <div key={r.symbol} role="row" className="grid h-11 grid-cols-[44px_minmax(0,1fr)_64px_62px] items-center gap-3 border-b border-[var(--line)] text-[13px] last:border-b-0 sm:grid-cols-[56px_minmax(0,1fr)_120px_72px_66px]">
            <span role="cell" className="font-[family-name:var(--mono)] text-xs font-semibold">{r.symbol}</span>
            <span role="cell" className="hidden truncate text-[var(--fg2)] sm:block">{r.name}</span>
            <SparkChart data={r.data} height={28} endDot color={up ? 'var(--ok)' : 'var(--bad)'} />
            <span role="cell" className="flex justify-end font-[family-name:var(--mono)] text-xs tabular-nums"><AnimatedNumber value={last} format={{ minimumFractionDigits: 2, maximumFractionDigits: 2 }} /></span>
            <span role="cell" className="flex min-w-[62px] justify-end tabular-nums"><DeltaBadge value={ch} digits={2} title={up ? 'Up since the first price shown' : 'Down since the first price shown'} className="min-w-[62px] justify-center font-[family-name:var(--mono)] tabular-nums" /></span>
          </div>
        )
      })}
    </div>
  )
}

/**
 * Bullet chart: qualitative bands, the actual bar (green when it meets its target, neutral grey when not) and a target
 * tick, one row per measure. Bars grow in when scrolled into view; hover, tap or arrow-key a row for numbers.
 */
export function BulletChart({ rows, max = 100, bands = [0.5, 0.75], format: formatProp, label: labelProp, table, exportable, ref: userRef, className }:
  { rows: { label: string; value: number; target: number }[]; max?: number; bands?: number[]; format?: (n: number) => string; /** accessible name */ label?: string; className?: string } & ChartKitProps) {
  const [ref, w, seen] = useChartFrame<HTMLDivElement>()
  const format = formatProp ?? fmt.compact, label = labelProp ?? 'Bullet chart'
  const L = 72, rowH = 31, iw = Math.max(0, w - L - 4), X = (v: number) => linScale(0, max || 1, L, L + iw)(clamp(v, 0, max))
  const bandFill = ['var(--line)', 'color-mix(in srgb, var(--line2) 60%, transparent)', 'var(--line2)']
  const met = (r: { value: number; target: number }) => r.value >= r.target
  const shell = useChartShell({
    table, exportable, ref: userRef, box: ref, count: rows.length, label,
    data: { head: ['Measure', 'Actual', 'Target', 'Target met'], rows: rows.map(r => [r.label, r.value, r.target, met(r) ? 'Yes' : 'No']), formats: [undefined, formatProp, formatProp] },
    summary: `${plural(rows.length, 'measure')} against targets. ${rows.filter(met).length} of ${rows.length} meet their target.`,
    describe: i => `${rows[i].label}: ${format(rows[i].value)}, target ${format(rows[i].target)}, ${met(rows[i]) ? 'met' : 'below target'}`,
    tip: i => <>
      <div className="mb-1 font-medium">{rows[i].label}</div>
      <TooltipRow color={met(rows[i]) ? 'var(--ok)' : CHART_NEUTRAL} label="Actual" value={format(rows[i].value)} />
      <TooltipRow color="var(--fg2)" label="Target" value={format(rows[i].target)} />
    </>,
  })
  const { hover } = shell
  return (
    <ChartShell shell={shell} className={className} style={{ height: rows.length * rowH }}>
      {w > 0 && (
        <svg width={w} height={rows.length * rowH} aria-hidden className="block overflow-visible text-[11px]">
          {rows.map((r, i) => {
            const y = 6 + i * rowH
            return (
              <g key={r.label} data-ci={i} {...shell.bind(i)}>
                <rect x={0} y={y - 6} width={w} height={rowH} fill="transparent" />
                <text x={0} y={y + 13} fill={hover === i ? 'var(--fg)' : 'var(--fg2)'} fontWeight={hover === i ? 600 : undefined}>{r.label}</text>
                <rect x={L} y={y} width={iw} height={18} rx={3} fill="var(--muted)" />
                {[...bands].sort((a, b) => b - a).map((b, k) => <rect key={b} x={L} y={y} width={iw * b} height={18} rx={3} fill={bandFill[k % bandFill.length]} />)}
                {hover === i && <rect x={L - 2} y={y - 2} width={iw + 4} height={22} rx={4} fill="none" stroke="var(--fg3)" strokeWidth={1.5} />}
                <motion.rect x={L} y={y + 6} height={6} rx={2} fill={met(r) ? 'var(--ok)' : CHART_NEUTRAL} initial={{ width: 0 }} animate={{ width: seen ? X(r.value) - L : 0 }}
                  transition={{ duration: 0.8, delay: seen ? i * 0.1 : 0, ease: [0.22, 1, 0.36, 1] }} />
                <line x1={X(r.target)} x2={X(r.target)} y1={y + 2} y2={y + 16} stroke="var(--fg)" strokeWidth={2.5} strokeLinecap="round" />
              </g>
            )
          })}
        </svg>
      )}
    </ChartShell>
  )
}

const statMean = (a: number[]) => a.reduce((s, x) => s + x, 0) / a.length
const statSd = (a: number[]) => { const m = statMean(a); return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / Math.max(1, a.length - 1)) }
const statQuantile = (a: number[], p: number) => { const s = [...a].sort((x, y) => x - y), i = (s.length - 1) * p, lo = Math.floor(i); return s[lo] + (s[Math.ceil(i)] - s[lo]) * (i - lo) }
const statKde = (a: number[], xs: number[], bw: number) => xs.map(x => a.reduce((s, v) => s + Math.exp(-0.5 * ((x - v) / bw) ** 2), 0) / (a.length * bw * 2.5066))
const statBandwidth = (a: number[]) => 1.06 * statSd(a) * a.length ** -0.2 || 1


function regressionFit(P: [number, number][]) {
  const n = P.length, xs = P.map(p => p[0]), ys = P.map(p => p[1]), mx = statMean(xs), my = statMean(ys)
  const sxx = xs.reduce((s, x) => s + (x - mx) ** 2, 0) || 1, sxy = P.reduce((s, [x, y]) => s + (x - mx) * (y - my), 0), b = sxy / sxx, a = my - b * mx
  const res = P.map(([x, y]) => y - (a + b * x)), sse = res.reduce((s, r) => s + r * r, 0), se = Math.sqrt(sse / Math.max(1, n - 2))
  const sst = ys.reduce((s, y) => s + (y - my) ** 2, 0) || 1, t = 1.96 + 2.4 / Math.max(1, n - 2) // ≈ t(0.975, n−2)
  const x0 = Math.floor(minOf(xs)), x1 = Math.ceil(maxOf(xs))
  const band = Array.from({ length: 41 }, (_, i) => { const x = x0 + ((x1 - x0) * i) / 40, h2 = 1 / n + (x - mx) ** 2 / sxx; return [x, a + b * x, t * se * Math.sqrt(h2), t * se * Math.sqrt(1 + h2)] })
  return { a, b, r2: 1 - sse / sst, se, n, seb: se / Math.sqrt(sxx), band, pts: P.map(p => [p[0], p[1]]) }
}

/**
 * Scatter with a least-squares fit, the 95% confidence band for the mean and (optionally) the wider 95% prediction interval.
 * Hover, tap or slide a finger for a crosshair readout; a stats footer shows slope, intercept, R², residual SE and n. New `points` morph in place.
 */
export function RegressionChart({ points, prediction = true, height = 240, xDomain, yDomain, footer = true, label: labelProp, table, exportable, ref: userRef, className }:
  { points: [number, number][]; prediction?: boolean; height?: number; xDomain?: [number, number]; yDomain?: [number, number]; footer?: boolean; /** accessible name */ label?: string; className?: string } & ChartKitProps) {
  const [ref, w, seen] = useChartFrame<HTMLDivElement>()
  const label = labelProp ?? 'Regression chart'
  const fit = useMemo(() => regressionFit(points), [points])
  const collapsed = useMemo(() => ({ ...fit, band: fit.band.map(r => [r[0], r[1], 0, 0]), pts: fit.pts.map(([x]) => [x, fit.a + fit.b * x]) }), [fit])
  const S = useTween(seen ? fit : collapsed)
  const xd = xDomain ?? extent(points.map(p => p[0])), yd = yDomain ?? [minOf(points.map(p => p[1]), 0), maxOf(points.map(p => p[1]))]
  const pad = { l: 40, r: 10, t: 10, b: 26 }, iw = Math.max(0, w - pad.l - pad.r), ih = height - pad.t - pad.b
  const X = linScale(xd[0], xd[1], pad.l, pad.l + iw), Y = linScale(yd[0], yd[1], pad.t + ih, pad.t)
  const shell = useChartShell({
    table, exportable, ref: userRef, box: ref, count: fit.band.length, start: 20, label, data: { head: ['x', 'y'], rows: points },
    summary: `${plural(fit.n, 'point')}. Fitted line y = ${chartFixed(fit.a)} + ${chartFixed(fit.b, 2)}x, R² ${chartFixed(fit.r2, 2)}. Arrow keys walk the fitted line.`,
    describe: i => { const r = fit.band[i]; return `x ${chartFixed(r[0], 0)}: fitted ${chartFixed(r[1])}, 95% CI plus or minus ${chartFixed(r[2])}` + (prediction ? `, prediction plus or minus ${chartFixed(r[3])}` : '') },
  })
  const { hover, setHover } = shell
  const poly = (k: number) => S.band.map(r => `${svgN(X(r[0]))},${svgN(Y(r[1] + r[k]))}`).join(' ') + ' ' + S.band.slice().reverse().map(r => `${svgN(X(r[0]))},${svgN(Y(r[1] - r[k]))}`).join(' ')
  const row = hover === null ? null : S.band[hover]
  const regressionPick = (e: ReactPointerEvent<SVGRectElement>) => {
    const xv = xd[0] + ((e.clientX - e.currentTarget.getBoundingClientRect().left) / (iw || 1)) * (xd[1] - xd[0]), b0 = fit.band[0][0], b1 = fit.band[40][0]
    setHover(clamp(Math.round(((xv - b0) / (b1 - b0 || 1)) * 40), 0, 40))
  }
  const kv = (k: string, v: string) => <span key={k} className="text-xs text-[var(--fg3)]">{k}<b className="ms-1 font-[family-name:var(--mono)] font-semibold text-[var(--fg)]">{v}</b></span>
  return (
    <ChartShell shell={shell} className={className} style={{ height }} after={footer && <div className="mt-2.5 flex flex-wrap gap-x-4 gap-y-1">
      {[kv('slope', `${chartFixed(S.b, 2)} ± ${chartFixed(1.96 * S.seb, 2)}`), kv('intercept', chartFixed(S.a)), kv('R²', chartFixed(S.r2, 2)), kv('residual SE', chartFixed(S.se)), kv('n', fmt.number(Math.round(S.n)))]}
    </div>}>
        {w > 0 && (
          <svg width={w} height={height} aria-hidden className="block touch-pan-y overflow-visible text-[11px]">
            <ChartGridY ticks={ticksIn(yd[0], yd[1], 5)} Y={Y} x1={pad.l} x2={w - pad.r} format={v => chartFixed(v, 0)} dash="2 3" gap={6} />
            <ChartAxisX y={height - 8} ticks={ticksIn(xd[0], xd[1]).map(t => ({ x: X(t), label: fmt.number(t) }))} />
            <motion.polygon points={poly(3)} fill="var(--accent)" initial={false} animate={{ opacity: prediction ? 0.07 : 0 }} />
            <polygon points={poly(2)} fill="var(--accent)" opacity={0.16} />
            {S.pts.map((p, i) => <circle key={i} cx={X(p[0])} cy={Y(p[1])} r={3} fill="var(--fg2)" opacity={0.55} />)}
            <path d={linePath(S.band.map(r => [X(r[0]), Y(r[1])]))} fill="none" stroke="var(--accent)" strokeWidth={2.2} />
            {row && <line x1={X(row[0])} x2={X(row[0])} y1={pad.t} y2={pad.t + ih} stroke="var(--fg3)" strokeDasharray="3 3" />}
            {row && <circle cx={X(row[0])} cy={Y(row[1])} r={4} fill="var(--accent)" stroke="var(--card)" strokeWidth={2} />}
            <rect x={pad.l} y={pad.t} width={iw} height={ih} fill="transparent" onPointerDown={e => regressionPick(e)} onPointerMove={e => regressionPick(e)} />
          </svg>
        )}
        {row && w > 0 && (
          <ChartTooltip x={X(row[0])} y={Math.max(0, Y(row[1] + row[3]) - 10)} width={w}>
            <div className="mb-1 font-medium">{`x = ${chartFixed(row[0], 0)}`}</div>
            <TooltipRow color="var(--accent)" label="ŷ" value={chartFixed(row[1])} />
            <TooltipRow color="var(--band)" label={'95% CI'} value={`± ${chartFixed(row[2])}`} />
            {prediction && <TooltipRow color="var(--band)" label="Prediction" value={`± ${chartFixed(row[3])}`} />}
          </ChartTooltip>
        )}
    </ChartShell>
  )
}

export type BoxGroup = { label: string; values: number[]; color?: string }
function boxStats(a: number[]) {
  const q1 = statQuantile(a, 0.25), q3 = statQuantile(a, 0.75), iqr = q3 - q1
  const lo = Math.max(minOf(a), q1 - 1.5 * iqr), hi = Math.min(maxOf(a), q3 + 1.5 * iqr), inner = a.filter(v => v >= lo && v <= hi)
  const ys = Array.from({ length: 41 }, (_, k) => lo + ((hi - lo) * k) / 40)
  // the violin is the density between the whisker ends, so outliers show as dots instead of long spikes
  return { q1, q2: statQuantile(a, 0.5), q3, lo, hi, ys, dens: statKde(inner, ys, statBandwidth(inner)), out: a.filter(v => v < lo || v > hi).slice(0, 6) }
}
/**
 * Distributions per group: box (median, quartiles, 1.5 × IQR whiskers), KDE violin, or both, with outliers as dots.
 * Hover or tap a box or outlier for numbers. New values morph in place.
 */
export function BoxViolinChart({ groups, mode = 'both', domain, height = 200, format: formatProp, label: labelProp, table, exportable, ref: userRef, className }:
  { groups: BoxGroup[]; mode?: 'box' | 'violin' | 'both'; domain?: [number, number]; height?: number; format?: (v: number) => string; /** accessible name */ label?: string; className?: string } & ChartKitProps) {
  const [ref, w, seen] = useChartFrame<HTMLDivElement>()
  const format = formatProp ?? ((v: number) => chartFixed(v)), label = labelProp ?? 'Box and violin chart'
  // the box and violin morph between samples; outliers (their count varies) tween on their own, so a changed count only
  // snaps the dots. useTween snaps whenever the shape changes, so adding or removing groups never indexes past the end.
  const stats = useMemo(() => groups.map(g => { const { out, ...k } = boxStats(g.values); return k }), [groups])
  const outs = useMemo(() => groups.map(g => boxStats(g.values).out), [groups])
  const collapsed = useMemo(() => stats.map(k => ({ ...k, q1: k.q2, q3: k.q2, lo: k.q2, hi: k.q2, ys: k.ys.map(() => k.q2), dens: k.dens.map(() => 0) })), [stats])
  const collapsedOuts = useMemo(() => outs.map((o, i) => o.map(() => stats[i].q2)), [outs, stats])
  const S = useTween(seen ? stats : collapsed), O = useTween(seen ? outs : collapsedOuts)
  const all = groups.flatMap(g => g.values), dom = domain ?? (all.length ? extent(all) : [0, 1])
  const pad = { l: 30, r: 10, t: 8, b: 24 }, iw = Math.max(0, w - pad.l - pad.r), ih = height - pad.t - pad.b
  const Y = linScale(dom[0], dom[1], pad.t + ih, pad.t), slot = iw / Math.max(1, groups.length), JIT = [-4, 3, -2, 5, -5, 2]
  const colorOf = (i: number) => seriesColor(i, groups[i].color)
  const boxTip = (i: number) => { const k = stats[i], c = colorOf(i); return <>
    <div className="mb-1 font-medium">{groups[i].label}</div>
    <TooltipRow color={c} label="median" value={format(k.q2)} />
    <TooltipRow color={c} label="IQR" value={`${format(k.q1)} – ${format(k.q3)}`} />
    <TooltipRow color={c} label="whiskers" value={`${format(k.lo)} – ${format(k.hi)}`} />
  </> }
  const shell = useChartShell({
    table, exportable, ref: userRef, box: ref, count: groups.length, label, tip: boxTip,
    data: {
      head: ['Group', 'Lower whisker', 'Q1', 'Median', 'Q3', 'Upper whisker', 'Outliers', 'n'],
      rows: groups.map((g, i) => { const k = stats[i]; return [g.label, k.lo, k.q1, k.q2, k.q3, k.hi, outs[i].length, g.values.length] }),
      formats: [undefined, format, format, format, format, format],
    },
    summary: `${plural(groups.length, 'group')}: ${fmt.list(groups.map((g, i) => `${g.label} median ${format(stats[i].q2)}`))}.`,
    describe: i => { const k = stats[i]; return `${groups[i].label}: median ${format(k.q2)}, quartiles ${format(k.q1)} to ${format(k.q3)}, whiskers ${format(k.lo)} to ${format(k.hi)}` + (outs[i].length ? `, ${plural(outs[i].length, 'outlier')}` : '') },
  })
  const { hover, setHover, bind } = shell
  return (
    <ChartShell shell={shell} className={className} style={{ height }}>
      {w > 0 && (
        <svg width={w} height={height} aria-hidden className="block overflow-visible text-[11px]">
          <ChartGridY ticks={ticksIn(dom[0], dom[1])} Y={Y} x1={pad.l} x2={w - pad.r} format={v => chartFixed(v, 0)} dash="2 3" gap={6} />
          {S.map((k, i) => {
            const g = groups[i], color = colorOf(i), cx = pad.l + slot * (i + 0.5), mx = maxOf(k.dens) || 1, wv = slot * 0.36, bxw = mode === 'both' ? 9 : 16
            const right = k.ys.map((v, j) => `L${svgN(cx + (k.dens[j] / mx) * wv)},${svgN(Y(v))}`).join(''), left = k.ys.map((v, j) => `L${svgN(cx - (k.dens[j] / mx) * wv)},${svgN(Y(v))}`).reverse().join('')
            return (
              <g key={g.label} data-ci={i} opacity={hover === null || hover === i ? 1 : 0.5} onPointerEnter={() => setHover(i)}>
                {mode !== 'box' && <path d={`M${svgN(cx)},${svgN(Y(k.lo))}${right}L${svgN(cx)},${svgN(Y(k.hi))}${left}Z`} fill={color} fillOpacity={mode === 'both' ? 0.16 : 0.3} stroke={color} strokeOpacity={0.7} strokeWidth={1.2} strokeLinejoin="round" />}
                {mode !== 'violin' && <>
                  <line x1={cx} x2={cx} y1={Y(k.lo)} y2={Y(k.hi)} stroke="var(--fg2)" />
                  {[k.lo, k.hi].map((v, j) => <line key={j} x1={cx - 5} x2={cx + 5} y1={Y(v)} y2={Y(v)} stroke="var(--fg2)" />)}
                  <rect x={cx - bxw} y={Y(k.q3)} width={bxw * 2} height={Math.max(0, Y(k.q1) - Y(k.q3))} rx={3} fill="var(--card)" stroke={color} strokeWidth={1.6} className="cursor-default" {...bind(i)} />
                  <line x1={cx - bxw} x2={cx + bxw} y1={Y(k.q2)} y2={Y(k.q2)} stroke="var(--fg)" strokeWidth={1.5} pointerEvents="none" />
                </>}
                {mode === 'violin' && <circle cx={cx} cy={Y(k.q2)} r={3} fill="var(--fg)" stroke="transparent" strokeWidth={16} {...bind(i)} />}
                {(O[i] ?? []).map((v, j) => <circle key={j} cx={cx + JIT[j % JIT.length]} cy={Y(v)} r={2.8} fill="var(--bad)" opacity={0.9} stroke="transparent" strokeWidth={14}
                  {...bind(i, () => <><div className="mb-1 font-medium">{g.label}</div><TooltipRow color="var(--bad)" label="outlier" value={format(v)} /></>)} />)}
                <text x={cx} y={height - 7} textAnchor="middle" fill={hover === i ? 'var(--fg)' : 'var(--fg3)'} fontWeight={hover === i ? 600 : undefined}>{g.label}</text>
              </g>
            )
          })}
        </svg>
      )}
    </ChartShell>
  )
}

/**
 * Histogram with a kernel-density curve, mean (dashed), median and a ±1σ shaded band. `bins` is usually driven by a slider;
 * bins, density and markers all morph when it or the data changes. Hover or tap a bar for its range and count.
 */
export function DensityHistogram({ values, bins = 18, domain, height = 190, label: labelProp, table, exportable, ref: userRef, className }: { values: number[]; bins?: number; domain?: [number, number]; height?: number; /** accessible name */ label?: string; className?: string } & ChartKitProps) {
  const [ref, w, seen] = useChartFrame<HTMLDivElement>()
  const label = labelProp ?? 'Histogram with density curve'
  const [d0, d1] = domain ?? [NaN, NaN]
  const dom = useMemo(() => (Number.isFinite(d0) ? [d0, d1] : niceTicks(minOf(values), maxOf(values)).filter((_, i, a) => i === 0 || i === a.length - 1)) as [number, number], [d0, d1, values])
  const xs = useMemo(() => Array.from({ length: 81 }, (_, i) => dom[0] + ((dom[1] - dom[0]) * i) / 80), [dom])
  const kde = useMemo(() => statKde(values, xs, statBandwidth(values)), [values, xs])
  const stats = useMemo(() => {
    const width = (dom[1] - dom[0]) / bins, counts = Array(Math.max(40, bins)).fill(0)
    values.forEach(v => { const k = Math.floor((v - dom[0]) / width); if (k >= 0 && k < bins) counts[k]++ })
    const dens = counts.map(c => c / (values.length * width))
    return { dens, bins, kde, m: statMean(values), md: statQuantile(values, 0.5), sd: statSd(values), ymax: maxOf(kde, maxOf(dens)) * 1.12 }
  }, [values, bins, kde, dom])
  const collapsed = useMemo(() => ({ ...stats, dens: stats.dens.map(() => 0), kde: stats.kde.map(() => 0), sd: 0 }), [stats])
  const S = useTween(seen ? stats : collapsed, 450)
  const pad = { l: 12, r: 8, t: 10, b: 24 }, iw = Math.max(0, w - pad.l - pad.r), ih = height - pad.t - pad.b
  const X = linScale(dom[0], dom[1], pad.l, pad.l + iw), Y = (v: number) => pad.t + ih - Math.min(1, v / (S.ymax || 1)) * ih
  const nb = Math.round(S.bins), bwv = (dom[1] - dom[0]) / nb
  const binLo = (i: number) => dom[0] + (i * (dom[1] - dom[0])) / bins, binN = (i: number) => Math.round(stats.dens[i] * values.length * ((dom[1] - dom[0]) / bins))
  const binTip = (i: number) => <><div className="mb-1 font-medium">{chartFixed(binLo(i), 0)}–{chartFixed(binLo(i + 1), 0)}</div><TooltipRow color="var(--accent)" label="values" value={fmt.number(binN(i))} /></>
  const shell = useChartShell({
    table, exportable, ref: userRef, box: ref, count: bins, label, tip: binTip,
    data: { head: ['Range', 'Count'], rows: Array.from({ length: bins }, (_, i) => [`${binLo(i)}–${binLo(i + 1)}`, binN(i)]), formats: [(r: string) => r.split('–').map(v => chartFixed(+v, 0)).join('–')] },
    summary: `${plural(values.length, 'value')} in ${bins} bins from ${chartFixed(dom[0], 0)} to ${chartFixed(dom[1], 0)}. Mean ${chartFixed(stats.m)}, median ${chartFixed(stats.md)}, standard deviation ${chartFixed(stats.sd)}.`,
    describe: i => `${chartFixed(binLo(i), 0)} to ${chartFixed(binLo(i + 1), 0)}: ${plural(binN(i), 'value')}`,
  })
  const { hover } = shell
  return (
    <ChartShell shell={shell} className={className} style={{ height }}>
      {w > 0 && (
        <svg width={w} height={height} aria-hidden className="block overflow-visible text-[11px]">
          <line x1={pad.l} x2={w - pad.r} y1={pad.t + ih} y2={pad.t + ih} stroke="var(--line)" />
          <rect x={X(S.m - S.sd)} y={pad.t} width={Math.max(0, X(S.m + S.sd) - X(S.m - S.sd))} height={ih} fill="color-mix(in srgb, var(--fg) 6%, transparent)" />
          {Array.from({ length: nb }, (_, i) => {
            const lo = dom[0] + i * bwv
            return <rect key={i} data-ci={i} x={X(lo) + 1} y={Y(S.dens[i])} width={Math.max(0, X(lo + bwv) - X(lo) - 2)} height={Math.max(0, Y(0) - Y(S.dens[i]))} rx={2} fill="var(--accent)" opacity={hover === i ? 0.5 : 0.22}
              {...shell.bind(i)} />
          })}
          <path d={chartPath(xs.map((v, i) => [X(v), Y(S.kde[i])]))} fill="none" stroke="var(--accent)" strokeWidth={2} pointerEvents="none" />
          <line x1={X(S.m)} x2={X(S.m)} y1={pad.t} y2={pad.t + ih} stroke="var(--bad)" strokeWidth={1.5} strokeDasharray="4 3" pointerEvents="none" />
          <line x1={X(S.md)} x2={X(S.md)} y1={pad.t} y2={pad.t + ih} stroke="var(--fg)" strokeWidth={1.5} pointerEvents="none" />
          <ChartAxisX y={height - 8} ticks={ticksIn(dom[0], dom[1]).map(t => ({ x: X(t), label: fmt.number(t) }))} />
          <text x={w - pad.r} y={pad.t + 10} textAnchor="end" fill="var(--bad)">{`mean ${chartFixed(S.m)}`}</text>
          <text x={w - pad.r} y={pad.t + 24} textAnchor="end" fill="var(--fg)">{`median ${chartFixed(S.md)}`}</text>
          <text x={w - pad.r} y={pad.t + 38} textAnchor="end" fill="var(--fg3)">{`σ ${chartFixed(S.sd)}`}</text>
        </svg>
      )}
    </ChartShell>
  )
}

export type ForestRow = { label: string; effect: number; se: number }
/**
 * Forest plot: effect sizes with 95% CI whiskers, squares sized by inverse-variance weight, a pooled diamond and a zero line.
 * Rows whose interval clears 0 are coloured as significant. New rows morph in place; hover or tap a row for its numbers.
 * Below 400px wide the right column shows the effect only (the interval stays drawn and is in the tooltip).
 */
export function ForestPlot({ rows, domain = [-0.1, 0.2], ticks = [-0.1, 0, 0.1, 0.2], height = 220, label: labelProp, valueLabel: valueProp, lower: lowerProp, higher: higherProp, name: nameProp, table, exportable, ref: userRef, className }:
  { rows: ForestRow[]; domain?: [number, number]; ticks?: number[]; height?: number; label?: string; valueLabel?: string; lower?: string; higher?: string; /** accessible name */ name?: string; className?: string } & ChartKitProps) {
  const [ref, w, seen] = useChartFrame<HTMLDivElement>()
  const label = labelProp ?? 'Segment', valueLabel = valueProp ?? 'Lift [95% CI]', lower = lowerProp ?? '← worse', higher = higherProp ?? 'better →', name = nameProp ?? 'Forest plot'
  /** +12.3% (signed, one decimal) */
  const forestPct = (v: number) => fmt.number(v, { style: 'percent', minimumFractionDigits: 1, maximumFractionDigits: 1, signDisplay: 'exceptZero' })
  /** the interval ends without the % sign: −1.2, 0.0, 3.4 */
  const forestCi = (v: number) => fmt.number(Math.round(v * 1000) / 10 || 0, { minimumFractionDigits: 1, maximumFractionDigits: 1 })
  const ci = (e: number, lo: number, hi: number) => `${forestPct(e)}, 95% CI ${forestPct(lo)} to ${forestPct(hi)}`
  const state = useMemo(() => {
    const wsum = rows.reduce((a, r) => a + 1 / r.se ** 2, 0) || 1
    return { rows: rows.map(r => [r.effect, r.se]), pooled: rows.reduce((a, r) => a + r.effect / r.se ** 2, 0) / wsum, pse: Math.sqrt(1 / wsum) }
  }, [rows])
  const collapsed = useMemo(() => ({ rows: state.rows.map(([, se]) => [0, se * 0.001]), pooled: 0, pse: state.pse * 0.001 }), [state])
  const S = useTween(seen ? state : collapsed)
  const narrow = w > 0 && w < 400
  const L = 72, R = narrow ? 50 : 118, T = 18, B = 34, X = (v: number) => linScale(domain[0], domain[1], L, L + Math.max(0, w - L - R))(clamp(v, domain[0], domain[1]))
  const rowH = (height - T - B) / (rows.length + 1.4), wts = S.rows.map(r => 1 / r[1] ** 2), maxW = maxOf(wts, 0) || 1, wsum = wts.reduce((a, b) => a + b, 0) || 1
  const py = T + rowH * (rows.length + 0.9), plo = S.pooled - 1.96 * S.pse, phi = S.pooled + 1.96 * S.pse
  const rowSig = (r: ForestRow) => r.effect - 1.96 * r.se > 0 || r.effect + 1.96 * r.se < 0
  const lo95 = (e: number, se: number) => e - 1.96 * se, hi95 = (e: number, se: number) => e + 1.96 * se
  const rowTip = (i: number) => i < rows.length ? <>
    <div className="mb-1 font-medium">{rows[i].label}</div>
    <div className="text-[var(--fg2)]">{ci(rows[i].effect, lo95(rows[i].effect, rows[i].se), hi95(rows[i].effect, rows[i].se))}</div>
    <div className="text-[var(--fg2)]">{rowSig(rows[i]) ? 'significant' : 'not significant'} · {`weight ${fmt.percent(wts[i] / wsum, 0)}`}</div>
  </> : <><div className="mb-1 font-medium">Pooled (inverse-variance)</div><div className="text-[var(--fg2)]">{ci(state.pooled, lo95(state.pooled, state.pse), hi95(state.pooled, state.pse))}</div></>
  const round6 = (v: number) => Math.round(v * 1e6) / 1e6
  const shell = useChartShell({
    table, exportable, ref: userRef, box: ref, count: rows.length + 1, label: name, tip: rowTip,
    data: {
      head: [label, valueLabel, 'Lower 95%', 'Upper 95%', 'Significant'],
      rows: [...rows.map(r => [r.label, round6(r.effect), round6(lo95(r.effect, r.se)), round6(hi95(r.effect, r.se)), rowSig(r) ? 'Yes' : 'No']),
        ['Pooled', round6(state.pooled), round6(lo95(state.pooled, state.pse)), round6(hi95(state.pooled, state.pse)), '']],
      formats: [undefined, forestPct, forestPct, forestPct],
    },
    summary: `${plural(rows.length, 'row')} and a pooled estimate of ${forestPct(state.pooled)}. ${rows.filter(rowSig).length} of ${rows.length} intervals clear zero.`,
    describe: i => i < rows.length ? `${rows[i].label}: ${forestPct(rows[i].effect)}, 95% interval ${forestPct(lo95(rows[i].effect, rows[i].se))} to ${forestPct(hi95(rows[i].effect, rows[i].se))}, ${rowSig(rows[i]) ? 'significant' : 'not significant'}`
      : `Pooled: ${forestPct(state.pooled)}, 95% interval ${forestPct(lo95(state.pooled, state.pse))} to ${forestPct(hi95(state.pooled, state.pse))}`,
  })
  const { hover } = shell
  return (
    <ChartShell shell={shell} className={className} style={{ height }}>
      {w > 0 && (
        <svg width={w} height={height} aria-hidden className="block overflow-visible text-[11px]">
          <text x={L - 8} y={10} textAnchor="end" fontWeight={600} fill="var(--fg2)">{label}</text>
          <text x={w - 2} y={10} textAnchor="end" fontWeight={600} fill="var(--fg2)">{narrow ? valueLabel.replace(/\s*\[.*\]\s*$/, '') : valueLabel}</text>
          {ticks.map(v => <g key={v}>
            <line x1={X(v)} x2={X(v)} y1={T} y2={height - B} stroke={v ? 'var(--line)' : 'var(--fg2)'} strokeWidth={v ? 1 : 1.2} strokeDasharray={v ? '2 3' : undefined} />
            <text x={X(v)} y={height - B + 14} textAnchor="middle" fill="var(--fg3)">{fmt.number(v, { style: 'percent', maximumFractionDigits: 0, signDisplay: 'exceptZero' })}</text>
          </g>)}
          <text x={X(0) - 4} y={height - 4} textAnchor="end" fill="var(--fg3)">{lower}</text>
          <text x={X(0) + 4} y={height - 4} fill="var(--fg3)">{higher}</text>
          {rows.map((r, i) => {
            const [e, se] = S.rows[i], lo = e - 1.96 * se, hi = e + 1.96 * se, cy = T + rowH * (i + 0.5), sig = lo > 0 || hi < 0, col = sig ? 'var(--accent)' : 'var(--fg3)', sz = 4 + 4 * Math.sqrt(wts[i] / maxW)
            return (
              <g key={r.label}>
                {hover === i && <rect x={2} y={cy - rowH / 2 + 1} width={w - 4} height={rowH - 2} rx={4} fill="var(--muted)" />}
                <text x={L - 8} y={cy} dy="0.32em" textAnchor="end" fill="var(--fg)">{r.label}</text>
                <line x1={X(lo)} x2={X(hi)} y1={cy} y2={cy} stroke={col} strokeWidth={1.6} strokeLinecap="round" />
                <rect data-ci={i} x={0} y={cy - rowH / 2} width={w} height={rowH} fill="transparent" {...shell.bind(i)} />
                <rect x={X(e) - sz / 2} y={cy - sz / 2} width={sz} height={sz} rx={1.5} fill={col} pointerEvents="none" />
                <text x={w - 2} y={cy} dy="0.32em" textAnchor="end" fontFamily="var(--mono)" pointerEvents="none" fill={sig ? 'var(--fg)' : 'var(--fg3)'}>{forestPct(e)}{narrow ? '' : ` [${forestCi(lo)}, ${forestCi(hi)}]`}</text>
              </g>
            )
          })}
          <line x1={8} x2={w - 2} y1={py - rowH * 0.6} y2={py - rowH * 0.6} stroke="var(--line)" />
          {hover === rows.length && <rect x={2} y={py - rowH / 2 + 1} width={w - 4} height={rowH - 2} rx={4} fill="var(--muted)" />}
          <text x={L - 8} y={py} dy="0.32em" textAnchor="end" fontWeight={600} fill="var(--fg)">{'Pooled'}</text>
          <path d={`M${svgN(X(plo))},${svgN(py)}L${svgN(X(S.pooled))},${svgN(py - 6)}L${svgN(X(phi))},${svgN(py)}L${svgN(X(S.pooled))},${svgN(py + 6)}Z`} fill="var(--fg)" />
          <rect data-ci={rows.length} x={0} y={py - rowH / 2} width={w} height={rowH} fill="transparent" {...shell.bind(rows.length)} />
          <text x={w - 2} y={py} dy="0.32em" textAnchor="end" fontFamily="var(--mono)" fontWeight={600} pointerEvents="none" fill="var(--fg)">{forestPct(S.pooled)}{narrow ? '' : ` [${forestCi(plo)}, ${forestCi(phi)}]`}</text>
        </svg>
      )}
    </ChartShell>
  )
}
