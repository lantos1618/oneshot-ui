/**
 * Swimlanes, state ribbons and linked event lists on a shared time axis. Tags are TimeTag (annotate.tsx): point
 * events (`at`) and spans (`at` → `end`) grouped by `kind`. Every view here is a plot: time runs left to right.
 */
import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type FocusEvent as ReactFocusEvent, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react'
import { IconButton, cn, gridKeyMove, isTouch, safeColor, useControllable, useOutside, useWidth, plural, fmt, Legend } from './core'
import { EmptyState } from './feedback'
import { VirtualList, type VirtualListHandle } from './virtual'
import { TrackGrid, VIZ_FOCUS, VIZ_LIT_RING, VizTip, linScale, vizTipAnchor } from './vizkit'
import { TagGlyph, TagTooltip, countChipPx, layoutTimeTags, resolveTagKinds, timeTagLook, timeTagMs, timeTagTint, timeTicks, type TagKinds, type TimeTag, type TimeTagKind } from './annotate'

export type { TimeTag, TimeTagKind } from './annotate'

/** Default lane height for swimlanes, px. */
export const TIMELINE_LANE_HEIGHT = 22

/** Time → px across `width` (a flat range maps to the start). */
const timelineX = (start: number, end: number, width: number) => linScale(start, Math.max(end, start + 1), 0, width)

/** One mark placed on a row: the tags it stands for (several when merged), its time span and its px box. */
export type TimelineMark = { key: string; tags: TimeTag[]; from: number; to: number; x: number; w: number }

/**
 * Point marks on one row, merged so none overlap: `size` is a single mark's width in px, `gap` the space two marks need
 * between their edges (closer ones merge), `chip(n)` the width of a count chip for n tags. Merges the closest pair first and repeats,
 * so a chip that grows into its neighbour swallows it too. Pure (exported for tests and custom views).
 */
export function clusterTimeMarks(tags: TimeTag[], { start, end, width, size = 6, gap = 0, chip = countChipPx }:
  { start: number; end: number; width: number; size?: number; gap?: number; chip?: (n: number) => number }): TimelineMark[] {
  const X = timelineX(start, end, width)
  const sorted = [...tags].sort((a, b) => timeTagMs(a.at) - timeTagMs(b.at))
  const out: (TimelineMark & { sx: number })[] = sorted.map(t => { const at = timeTagMs(t.at), x = X(at); return { key: t.id, tags: [t], from: at, to: at, x, w: size, sx: x } })
  for (;;) {
    let best = -1, bestRoom = 0
    for (let i = 0; i < out.length - 1; i++) {
      const a = out[i], b = out[i + 1], room = b.x - a.x - (a.w + b.w) / 2 - gap
      if (room < bestRoom) { best = i; bestRoom = room }
    }
    if (best < 0) break
    const a = out[best], b = out[best + 1], merged = [...a.tags, ...b.tags], sx = a.sx + b.sx
    out.splice(best, 2, { key: a.key, tags: merged, from: a.from, to: b.to, sx, x: sx / merged.length, w: chip(merged.length) })
  }
  return out.map(({ sx: _sx, ...mk }) => mk)
}

/** A ribbon segment: a state (or a merged run of slivers, `mixed`) with its px box. */
export type RibbonSegment = TimelineMark & { mixed: boolean }

/**
 * Contiguous state spans laid out on a strip `width` px wide. A span narrower than `minPx` keeps its place but is drawn
 * `minPx` wide; a run of two or more such slivers merges into one `mixed` segment that lists them all. Pure.
 */
export function ribbonSegments(states: TimeTag[], { start, end, width, minPx = 4 }: { start: number; end: number; width: number; minPx?: number }): RibbonSegment[] {
  const X = timelineX(start, end, width)
  const sorted = [...states].sort((a, b) => timeTagMs(a.at) - timeTagMs(b.at))
  const raw = sorted.map((s, i) => {
    const from = Math.max(start, timeTagMs(s.at)), to = Math.min(end, s.end !== undefined ? timeTagMs(s.end) : i < sorted.length - 1 ? timeTagMs(sorted[i + 1].at) : end)
    return { tag: s, from, to }
  }).filter(r => r.to > r.from)
  const thin = (r: { from: number; to: number }) => width > 0 && X(r.to) - X(r.from) < minPx
  const out: RibbonSegment[] = []
  for (let i = 0; i < raw.length;) {
    const r = raw[i]
    if (!thin(r)) { out.push({ key: r.tag.id, tags: [r.tag], from: r.from, to: r.to, x: X(r.from), w: X(r.to) - X(r.from), mixed: false }); i++; continue }
    let j = i
    while (j + 1 < raw.length && thin(raw[j + 1])) j++
    const run = raw.slice(i, j + 1), from = run[0].from, to = run[run.length - 1].to
    const x0 = X(from), tw = X(to) - x0, ww = Math.max(minPx, tw), x = Math.min(Math.max(0, x0 + tw / 2 - ww / 2), Math.max(0, width - ww))
    out.push({ key: run[0].tag.id, tags: run.map(q => q.tag), from, to, x, w: ww, mixed: run.length > 1 })
    i = j + 1
  }
  return out
}

/** "1 h 35 min" from milliseconds. */
function timelineDuration(ms: number) {
  const min = Math.max(0, Math.round(ms / 60e3)), h = Math.floor(min / 60), mm = min % 60
  return [h && `${fmt.number(h)} h`, (mm || !h) && `${fmt.number(mm)} min`].filter(Boolean).join(' ')
}

/** What a tag is called: "Lunch, 12:30 to 13:05, 35 min" or "Water, 10:40". */
function timelineTagText(t: TimeTag) {
  const at = timeTagMs(t.at)
  if (t.end === undefined) return `${t.label}, ${fmt.time(at)}`
  return `${t.label}, ${fmt.time(at)} to ${fmt.time(timeTagMs(t.end))}, ${timelineDuration(timeTagMs(t.end) - at)}`
}
/** What a mark is called: one tag, or a merged cluster ("3 tags: Water, 15:00 to 15:02"). */
function timelineMarkText(mk: Pick<TimelineMark, 'tags' | 'from' | 'to'>, kinds: TagKinds) {
  if (mk.tags.length === 1) return timelineTagText(mk.tags[0])
  const one = mk.tags.every(t => t.kind === mk.tags[0].kind)
  const to = Math.max(...mk.tags.map(t => timeTagMs(t.end ?? t.at)))
  const what = one ? `${plural(mk.tags.length, 'tag')}: ${kinds.get(mk.tags[0].kind)?.label ?? mk.tags[0].label}` : plural(mk.tags.length, 'tag')
  return `${what}, ${fmt.time(mk.from)} to ${fmt.time(to)}`
}
/** How the timeline keyboard works, read after each view's summary. */
const TL_HELP = 'Arrow keys move between tags, up and down between rows. Enter selects, Escape clears.'
/** "12 tags from 09:00 to 17:30." */
const timelineSummary = (n: number, start: number, end: number) => `${plural(n, 'tag', 'tags', { zero: 'No tags' })} from ${fmt.time(start)} to ${fmt.time(end)}.`

/** annotate's TagGlyph in the tag's (or its kind's) colour and icon. */
function TimelineGlyph({ tag, kinds, size = 18, active, more, className }: { tag: TimeTag; kinds: TagKinds; size?: number; active?: boolean; more?: number; className?: string }) {
  const { icon, color } = timeTagLook(tag, kinds)
  return <TagGlyph aria-hidden icon={icon} color={color} size={size} active={active} more={more} className={className} />
}

/** Tooltip body for one or more tags: glyph, label, time (and duration for spans), detail; long lists roll up. */
function TimelineTipBody({ tags, kinds, extra }: { tags: TimeTag[]; kinds: TagKinds; extra?: ReactNode }) {
  const shown = tags.slice(0, 5)
  if (tags.length === 1) {
    const t = tags[0]
    return <TagTooltip tag={t} kinds={kinds} extra={t.end !== undefined || extra ? <>{t.end !== undefined && timelineDuration(timeTagMs(t.end) - timeTagMs(t.at))}{extra}</> : undefined} />
  }
  return (
    <div className="flex flex-col gap-1">
      {shown.map(t => {
        const at = timeTagMs(t.at)
        return (
          <div key={t.id} className="flex items-start gap-2">
            <TimelineGlyph tag={t} kinds={kinds} size={16} className="mt-px" />
            <div className="min-w-0">
              <b className="font-medium">{t.label}</b> <span className="ui-num text-[var(--fg2)]">{fmt.time(at)}{t.end !== undefined && <>–{fmt.time(timeTagMs(t.end))}</>}</span>
            </div>
          </div>
        )
      })}
      {tags.length > shown.length && <div className="text-[var(--fg3)]">+{tags.length - shown.length} more</div>}
      {extra}
    </div>
  )
}

type TlSource = 'hover' | 'focus' | 'tap' | null
/**
 * The page's last pointermove position (one shared capture listener): a pointerenter at exactly that spot came from
 * content scrolling under a resting cursor (page or list scroll), not from the pointer crossing into the element.
 */
let timelineLastPointer: { x: number; y: number } | null = null, timelinePointerWatch = false
/**
 * Hover only counts as intent after real pointer movement. When a list or lane scrolls itself (keyboard moves, a
 * linked view bringing a row into view), rows slide under a resting cursor and fire pointerenter; `arm()` before such
 * a scroll makes `allow()` refuse those until a pointermove at new coordinates (browsers' synthetic moves after a
 * scroll repeat the old ones).
 */
function useTimelineHoverGuard() {
  const pos = useRef<{ x: number; y: number } | null>(null), armed = useRef<{ x: number; y: number } | null | false>(false)
  useEffect(() => {
    if (timelinePointerWatch) return
    timelinePointerWatch = true
    addEventListener('pointermove', e => { timelineLastPointer = { x: e.clientX, y: e.clientY } }, { capture: true, passive: true })
  }, [])
  return {
    arm: () => { armed.current = pos.current ? { ...pos.current } : null },
    onMove: (e: ReactPointerEvent) => {
      const a = armed.current
      if (a !== false && (!a || Math.abs(e.clientX - a.x) > 1 || Math.abs(e.clientY - a.y) > 1)) armed.current = false
      pos.current = { x: e.clientX, y: e.clientY }
    },
    allow: (e: ReactPointerEvent) => armed.current === false && !(timelineLastPointer && timelineLastPointer.x === e.clientX && timelineLastPointer.y === e.clientY),
  }
}
type TlRow = { key: string; marks: TimelineMark[] }
/**
 * Roving focus over rows of marks (lanes, or the ribbon's pin / state / bar rows; real buttons, so roving tabindex
 * rather than a chart's activedescendant): the group is one Tab stop, ←/→ move along a row, ↑/↓ jump to the nearest
 * mark in the next row that has any, Home/End go to the row's ends, Enter or a click selects, Escape clears. Hover,
 * focus and tap set the active tag; leaving clears what that same pointer or focus set.
 */
function useTimelineNav(rows: TlRow[], active: string | null, setActive: (id: string | null) => void, onSelect?: (tag: TimeTag) => void) {
  const els = useRef(new Map<string, HTMLElement>())
  const last = useRef<string | null>(null), source = useRef<TlSource>(null)
  const guard = useTimelineHoverGuard()
  const flat = rows.flatMap((r, ri) => r.marks.map((mk, ci) => ({ mk, ri, ci })))
  const activeMark = active === null ? undefined : flat.find(f => f.mk.tags.some(t => t.id === active))
  const stop = activeMark?.mk.key ?? (flat.some(f => f.mk.key === last.current) ? last.current : flat[0]?.mk.key)
  const set = (id: string | null, via: TlSource) => { source.current = id === null ? null : via; if (id !== active) setActive(id) }
  const onKeyDown = (e: ReactKeyboardEvent<HTMLElement>) => {
    if (e.altKey || e.ctrlKey || e.metaKey) return
    const at = flat.find(f => els.current.get(f.mk.key) === e.target)
    if (!at) return
    const row = rows[at.ri].marks, mid = (mk: TimelineMark) => (mk.from + mk.to) / 2
    const nearest = (step: 1 | -1) => {
      for (let r = at.ri + step; r >= 0 && r < rows.length; r += step) {
        const ms = rows[r].marks
        if (!ms.length) continue
        const c = mid(at.mk)
        return ms.reduce((b, q) => (Math.abs(mid(q) - c) < Math.abs(mid(b) - c) ? q : b), ms[0])
      }
      return undefined
    }
    if (e.key === 'Escape') {
      if (active !== null) { e.preventDefault(); set(null, null) }
      return
    }
    // ↑/↓ go to the nearest mark in time on another row, not to the same index (rows differ in length)
    const vertical = e.key === 'ArrowDown' ? 1 : e.key === 'ArrowUp' ? -1 : 0
    const along = vertical ? null : gridKeyMove(e.key, at.ci, row.length, row.length)
    const next = vertical ? nearest(vertical) ?? at.mk : along === null ? undefined : row[along]
    if (!next) return
    e.preventDefault()
    if (next === at.mk) { set(next.tags[0].id, 'focus'); return }
    guard.arm() // focusing may scroll the lanes under the cursor
    els.current.get(next.key)?.focus()
  }
  const groupProps = {
    onKeyDown,
    onBlur: (e: ReactFocusEvent<HTMLElement>) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null) && source.current === 'focus') set(null, null) },
    onPointerLeave: (e: ReactPointerEvent) => { if (!isTouch(e) && source.current === 'hover') set(null, null) },
    onPointerMove: guard.onMove,
  }
  const markProps = (mk: TimelineMark) => ({
    ref: (el: HTMLElement | null) => { if (el) els.current.set(mk.key, el); else els.current.delete(mk.key) },
    tabIndex: mk.key === stop ? 0 : -1,
    'data-active': activeMark?.mk.key === mk.key || undefined,
    onFocus: (e: ReactFocusEvent<HTMLElement>) => { last.current = mk.key; if (e.currentTarget.matches(':focus-visible')) set(mk.tags[0].id, 'focus') },
    onPointerEnter: (e: ReactPointerEvent) => { if (!isTouch(e) && guard.allow(e)) set(mk.tags[0].id, 'hover') },
    onPointerDown: (e: ReactPointerEvent) => { if (isTouch(e)) set(mk.tags[0].id, 'tap') },
    onClick: () => { last.current = mk.key; set(mk.tags[0].id, source.current ?? 'tap'); if (mk.tags.length === 1) onSelect?.(mk.tags[0]) },
  })
  return {
    groupProps, markProps, activeKey: activeMark?.mk.key ?? null,
    anchor: () => (activeMark ? els.current.get(activeMark.mk.key) ?? null : null),
    clearTap: () => { if (source.current === 'tap') set(null, null) },
  }
}

/** Diameter of a swimlane dot, px. */
const TL_DOT = 10

/** Shared linking props: the tag that is lit (hover, focus, tap or a linked view) and what happens on select. */
export type TimelineLinkProps = {
  /** the lit tag (controlled); pair with `onActiveChange` to link views */
  activeId?: string | null
  defaultActiveId?: string | null
  onActiveChange?: (id: string | null) => void
  /** a tag was clicked or chosen with Enter */
  onSelect?: (tag: TimeTag) => void
}

/** Time axis labels under a plot column (percent positions, so it needs no measuring). */
function TimelineAxis({ ticks, start, end, className }: { ticks: { ms: number; label: string }[]; start: number; end: number; className?: string }) {
  const f = timelineX(start, end, 1)
  // labels centre on their tick; the ones at the very ends hug the edge instead of spilling out of the box
  return (
    <div aria-hidden className={cn('relative h-5 text-[10px] text-[var(--fg3)] ui-num', className)}>
      {ticks.map(k => <span key={k.ms} className={cn('absolute top-1 whitespace-nowrap', f(k.ms) < 0.02 ? '' : f(k.ms) > 0.98 ? '-translate-x-full' : '-translate-x-1/2')} style={{ left: `${f(k.ms) * 100}%` }}>{k.label}</span>)}
    </div>
  )
}

/** Props of Swimlanes. */
export type SwimlanesProps = TimelineLinkProps & {
  tags: TimeTag[]
  /** lane order, labels, icons and colours; kinds only found on tags are appended */
  kinds?: TimeTagKind[]
  /** the time range (epoch ms or Date), shared with `top` */
  start: number | Date
  end: number | Date
  /** 'kinds' keeps the `kinds` order (default); 'count' puts the busiest lanes first */
  order?: 'kinds' | 'count'
  /** drop lanes with no tags instead of showing a muted "None" */
  hideEmpty?: boolean
  /** a chart (or anything) drawn above the lanes on the same x range */
  top?: ReactNode
  /** px between `top`'s box edges and its plot (default: read from a Chart in `top`, else 40 left and 10 right) */
  topInset?: { left?: number; right?: number }
  /** lanes shown before the lane area scrolls (default 8) */
  maxLanes?: number
  /** dots of one kind with less than this (px) between their edges merge into a count chip (default 6) */
  mergePx?: number
  /** time labels under the lanes (default true; turn off when `top` is a Chart, whose own time labels sit just above) */
  axis?: boolean
  /**
   * lane labels on the left: 'auto' (default) shows icon and name from 480px of width and the icon alone below
   * that; 'always' keeps the name on narrow widths too, in a compact column (11px, wrapping to two lines); 'icon' never
   * shows the name (the lane's accessible name and tooltip still carry it)
   */
  labels?: 'auto' | 'always' | 'icon'
  /** accessible name */
  label?: string
  className?: string
}

/** How a swimlane mark draws: a span pill (tinted, stronger when lit), a count chip for merged dots, or a dot. */
function swimMarkLook(mk: TimelineMark, color: string, lit: boolean, left: number, pct: (t: number) => number): { className: string; style: CSSProperties } {
  if (mk.tags[0].end !== undefined) {
    const from = pct(mk.from)
    return { className: 'h-2.5 rounded-full', style: { left: `${from}%`, width: `max(8px, ${pct(mk.to) - from}%)`, background: timeTagTint(color, lit ? 85 : 60) } }
  }
  if (mk.tags.length > 1) {
    return {
      className: 'ui-num grid h-4 min-w-[18px] -translate-x-1/2 place-items-center rounded-full border-[1.5px] border-solid bg-[var(--card)] px-1 text-[10px] leading-none font-semibold text-[var(--fg)]',
      style: { left: `${left}%`, borderColor: color },
    }
  }
  return { className: '-translate-x-1/2 rounded-full', style: { left: `${left}%`, width: TL_DOT, height: TL_DOT, background: color } }
}

/** Swimlanes' label column width per `labels` mode (literal class strings for Tailwind). */
const SWIM_LABEL_COL = { auto: '[--tl-lw:30px] @[480px]:[--tl-lw:112px]', always: '[--tl-lw:84px] @[480px]:[--tl-lw:112px]', icon: '[--tl-lw:30px]' } as const
/** Swimlanes' label text per `labels` mode: hidden on narrow widths, compact and wrapping, or never shown. */
const SWIM_LABEL_TEXT = {
  auto: 'hidden truncate @[480px]:block',
  always: 'line-clamp-2 text-[11px] leading-[1.1] [overflow-wrap:anywhere] @[480px]:text-xs @[480px]:leading-snug',
  icon: 'hidden',
} as const

/**
 * One lane per kind of tag on a shared time axis (pattern E: Dynatrace annotation tracks, LifeLines): dots for point
 * tags, rounded pills for spans, an icon and label at the start of each lane, an optional chart on top (`top`) aligned
 * to the same `start`–`end`. Dots closer than `mergePx` merge into a count chip; empty lanes say "None" (or hide with
 * `hideEmpty`); more than `maxLanes` lanes scroll. Hover, focus or tap a mark for its tooltip. Keyboard: the lanes are
 * one Tab stop, ←/→ move along a lane, ↑/↓ between lanes, Enter selects, Escape clears. Link it to other views with
 * `activeId` / `onActiveChange`. `labels="always"` keeps lane names on phones (a compact column) instead of the icon alone.
 */
export function Swimlanes({ tags, kinds: kindsProp, start: startProp, end: endProp, order = 'kinds', hideEmpty, top, topInset, maxLanes = 8, mergePx = 6, axis = true, labels = 'auto',
  activeId, defaultActiveId = null, onActiveChange, onSelect, label, className }: SwimlanesProps) {
  const start = timeTagMs(startProp), end = timeTagMs(endProp)
  const kinds = useMemo(() => resolveTagKinds(kindsProp, tags), [kindsProp, tags])
  const [active, setActive] = useControllable(activeId, defaultActiveId, onActiveChange)
  const [plotRef, plotW] = useWidth<HTMLDivElement>()
  const box = useRef<HTMLDivElement>(null)
  const topBox = useRef<HTMLDivElement>(null)
  const scroller = useRef<HTMLDivElement>(null)
  const [fade, setFade] = useState({ top: false, bottom: false })
  const ids = useId()

  const lanes = useMemo(() => {
    const by = new Map<string, TimeTag[]>([...kinds.keys()].map(k => [k, []]))
    tags.forEach(t => by.get(t.kind)!.push(t))
    let ls = [...kinds.values()].map((k, i) => ({ kind: k, i, tags: by.get(k.kind)! }))
    if (order === 'count') ls = [...ls].sort((a, b) => b.tags.length - a.tags.length || a.i - b.i)
    return hideEmpty ? ls.filter(l => l.tags.length) : ls
  }, [kinds, tags, order, hideEmpty])
  const rows: TlRow[] = useMemo(() => lanes.map(l => {
    const points = l.tags.filter(t => t.end === undefined), spans = l.tags.filter(t => t.end !== undefined)
    const dots = plotW > 0 ? clusterTimeMarks(points, { start, end, width: plotW, size: TL_DOT, gap: mergePx })
      : points.map(t => ({ key: t.id, tags: [t], from: timeTagMs(t.at), to: timeTagMs(t.at), x: NaN, w: TL_DOT }))
    const pills = spans.map(t => ({ key: t.id, tags: [t], from: timeTagMs(t.at), to: timeTagMs(t.end!), x: NaN, w: 0 }))
    return { key: l.kind.kind, marks: [...dots, ...pills].sort((a, b) => a.from - b.from) }
  }), [lanes, plotW, start, end, mergePx])
  const nav = useTimelineNav(rows, active, setActive, onSelect)
  useOutside([box], nav.clearTap, active !== null)
  const ticks = useMemo(() => timeTicks(start, end, plotW), [start, end, plotW])
  const toPct = timelineX(start, end, 100), pct = (t: number) => toPct(Math.min(end, Math.max(start, t)))
  const scrolls = lanes.length > maxLanes
  useEffect(() => {
    const el = scroller.current
    if (!el || !scrolls) return
    const upd = () => setFade(f => { const t = el.scrollTop > 2, b = el.scrollTop < el.scrollHeight - el.clientHeight - 2; return f.top === t && f.bottom === b ? f : { top: t, bottom: b } })
    upd()
    el.addEventListener('scroll', upd, { passive: true })
    return () => el.removeEventListener('scroll', upd)
  }, [scrolls, lanes.length])
  // a Chart on top reports its plot gutters (data-plot-inset), so the lanes line up with it without guessing
  const [chartInset, setChartInset] = useState<[number, number] | null>(null)
  useLayoutEffect(() => {
    const v = topBox.current?.querySelector('[data-plot-inset]')?.getAttribute('data-plot-inset')?.split(' ').map(Number)
    const next: [number, number] | null = v && v.length === 2 && v.every(Number.isFinite) ? [v[0], v[1]] : null
    setChartInset(c => (c?.[0] === next?.[0] && c?.[1] === next?.[1] ? c : next))
  })
  const activeMark = rows.flatMap(r => r.marks).find(mk => mk.key === nav.activeKey)
  const insetL = topInset?.left ?? chartInset?.[0] ?? 40, insetR = topInset?.right ?? chartInset?.[1] ?? 10
  const laneH = TIMELINE_LANE_HEIGHT + 4

  return (
    <div className={cn('@container', className)}>
      <div ref={box} className={cn('relative [--tl-rp:16px]', SWIM_LABEL_COL[labels] ?? SWIM_LABEL_COL.auto)}>
        {top && <div ref={topBox} style={{ marginLeft: `calc(var(--tl-lw) - ${insetL}px)`, marginRight: `calc(var(--tl-rp) - ${insetR}px)` }}>{top}</div>}
        <div role="group" aria-roledescription="timeline" aria-label={label ?? 'Tags by kind'} aria-describedby={`${ids}-sum`} {...nav.groupProps} className="relative">
          <span id={`${ids}-sum`} className="sr-only">{timelineSummary(tags.length, start, end)} {TL_HELP}</span>
          <div ref={scroller} className={cn('relative', scrolls && 'overflow-y-auto overscroll-contain')} style={scrolls ? { maxHeight: maxLanes * laneH + 4 } : undefined}>
            <div className="relative py-0.5">
              <div className="pointer-events-none absolute inset-y-0 start-[var(--tl-lw)] end-[var(--tl-rp)]"><TrackGrid at={ticks.map(k => (k.ms - start) / Math.max(1, end - start))} /></div>
              {lanes.map((l, li) => (
                <div key={l.kind.kind} role="group" aria-label={`${l.kind.label}: ${plural(l.tags.length, 'tag', 'tags', { zero: 'no tags' })}`}
                  className="grid grid-cols-[var(--tl-lw)_minmax(0,1fr)_var(--tl-rp)] items-center [content-visibility:auto]" style={{ height: laneH, containIntrinsicSize: `auto ${laneH}px` }}>
                  <div aria-hidden title={l.kind.label} className="flex min-w-0 items-center gap-1.5 pe-2 text-xs text-[var(--fg2)]">
                    <span className="grid h-4 w-4 flex-none place-items-center text-[13px] leading-none" style={{ color: safeColor(l.kind.color) }}>{l.kind.icon ?? <span className="h-2 w-2 rounded-full" style={{ background: safeColor(l.kind.color) }} />}</span>
                    <span className={SWIM_LABEL_TEXT[labels] ?? SWIM_LABEL_TEXT.auto}>{l.kind.label}</span>
                  </div>
                  <div className="relative rounded-full bg-[color-mix(in_srgb,var(--muted)_75%,transparent)]" style={{ height: TIMELINE_LANE_HEIGHT }}>
                    {!l.tags.length && <span className="absolute inset-y-0 start-2.5 flex items-center text-[11px] text-[var(--fg3)] italic">None</span>}
                    {rows[li].marks.map(mk => {
                      const t0 = mk.tags[0], { color } = timeTagLook(t0, kinds), lit = nav.activeKey === mk.key
                      const look = swimMarkLook(mk, color, lit, plotW > 0 ? (mk.x / plotW) * 100 : pct(mk.from), pct)
                      return (
                        <button key={mk.key} type="button" {...nav.markProps(mk)} style={look.style}
                          className={cn('ui-target absolute top-1/2 -translate-y-1/2 cursor-pointer border-0 p-0 transition-[box-shadow] duration-150', VIZ_FOCUS, look.className, lit && VIZ_LIT_RING)}>
                          {mk.tags.length > 1 && <span aria-hidden>{mk.tags.length}</span>}<span className="sr-only">{timelineMarkText(mk, kinds)}</span>
                        </button>
                      )
                    })}
                  </div>
                  <span />
                </div>
              ))}
            </div>
          </div>
          {scrolls && <>
            <span aria-hidden className={cn('pointer-events-none absolute inset-x-0 top-0 h-4 bg-gradient-to-b from-[var(--card)] to-transparent transition-opacity', fade.top ? 'opacity-100' : 'opacity-0')} />
            <span aria-hidden className={cn('pointer-events-none absolute inset-x-0 bottom-0 h-4 bg-gradient-to-t from-[var(--card)] to-transparent transition-opacity', fade.bottom ? 'opacity-100' : 'opacity-0')} />
          </>}
        </div>
        <div className="grid grid-cols-[var(--tl-lw)_minmax(0,1fr)_var(--tl-rp)]"><span /><div ref={plotRef}>{axis && <TimelineAxis ticks={ticks} start={start} end={end} />}</div><span /></div>
        {activeMark && <VizTip at={() => vizTipAnchor(nav.anchor())}><TimelineTipBody tags={activeMark.tags} kinds={kinds} /></VizTip>}
      </div>
    </div>
  )
}

const RIBBON_SIZE = {
  md: { strip: 'h-7', pin: 18, stack: 2, bar: 'h-2', gap: 'gap-1.5' },
  compact: { strip: 'h-4', pin: 14, stack: 1, bar: 'h-1.5', gap: 'gap-1' },
} as const

/** Props of StateRibbon. */
export type StateRibbonProps = TimelineLinkProps & {
  /** contiguous state spans (a span without `end` lasts until the next one starts) */
  states: TimeTag[]
  /** point tags drawn as pins above the strip (merged into counts when they crowd) */
  pins?: TimeTag[]
  /** spans drawn as thin bars under the strip (e.g. lunch) */
  bars?: TimeTag[]
  /** labels, icons and colours per kind (states, pins and bars) */
  kinds?: TimeTagKind[]
  start: number | Date
  end: number | Date
  /** 'compact' for phones and widgets: a thinner strip, smaller pins */
  size?: 'md' | 'compact'
  /** narrowest drawn state, px; runs of narrower slivers merge (default 4) */
  minPx?: number
  /** legend of the state kinds with their total time (default true) */
  legend?: boolean
  /** time labels under the strip (default true) */
  axis?: boolean
  label?: string
  className?: string
}

/**
 * What you were doing all day in one strip (pattern F: sleep stages, Toggl and RescueTime day bars): contiguous states
 * coloured by kind, optional pins above for point tags (merged into counts when crowded) and bars below for spans.
 * Slivers too thin to see get a minimum width, runs of them merge into one "mixed" segment, and on touch every thin
 * mark has a finger-sized hit area. Hover, focus or tap for state and duration. Keyboard: one Tab stop, ←/→ along a
 * row, ↑/↓ between pins, states and bars. `size="compact"` suits phones and widgets.
 */
export function StateRibbon({ states, pins = [], bars = [], kinds: kindsProp, start: startProp, end: endProp, size = 'md', minPx = 4, legend = true, axis = true,
  activeId, defaultActiveId = null, onActiveChange, onSelect, label, className }: StateRibbonProps) {
  const start = timeTagMs(startProp), end = timeTagMs(endProp)
  const all = useMemo(() => [...states, ...pins, ...bars], [states, pins, bars])
  const kinds = useMemo(() => resolveTagKinds(kindsProp, all), [kindsProp, all])
  const [active, setActive] = useControllable(activeId, defaultActiveId, onActiveChange)
  const [plotRef, w] = useWidth<HTMLDivElement>()
  const box = useRef<HTMLDivElement>(null)
  const ids = useId()
  const S = RIBBON_SIZE[size]
  const segs = useMemo(() => ribbonSegments(states, { start, end, width: w, minPx }), [states, start, end, w, minPx])
  // pins use the chart rug's collision handling (annotate's layoutTimeTags): stacked up to `stack` rows, then folded into
  // a neighbour's "+N"; the pin row's height is reserved for every row, so switching days never moves the strip
  const pinMarks = useMemo(() => {
    if (!(w > 0)) return pins.map(t => ({ key: t.id, tags: [t], from: timeTagMs(t.at), to: timeTagMs(t.at), x: NaN, w: 0, row: 0 }))
    const byId = new Map(pins.map(t => [t.id, t]))
    return layoutTimeTags(pins, { x: timelineX(start, end, w), width: w, style: 'rug', maxStack: S.stack, size: S.pin, minGap: 10 }).points.filter(p => !p.hidden).map(p => {
      const more = (p.more ?? []).flatMap(id => byId.get(id) ?? [])
      return { key: p.tag.id, tags: [p.tag, ...more], from: p.ms, to: Math.max(p.ms, ...more.map(q => timeTagMs(q.at))), x: p.x, w: S.pin, row: p.row }
    })
  }, [pins, start, end, w, S.pin, S.stack])
  const pinStep = S.pin + 6 // room for a "+N" badge between rows (it also takes the 10px minGap beside a glyph)
  const barMarks = useMemo(() => bars.map(t => ({ key: t.id, tags: [t], from: Math.max(start, timeTagMs(t.at)), to: Math.min(end, timeTagMs(t.end ?? t.at)), x: NaN, w: 0 })), [bars, start, end])
  const rows: TlRow[] = [{ key: 'pins', marks: pinMarks }, { key: 'states', marks: segs }, { key: 'bars', marks: barMarks }]
  const nav = useTimelineNav(rows, active, setActive, onSelect)
  useOutside([box], nav.clearTap, active !== null)
  const ticks = useMemo(() => timeTicks(start, end, w, undefined, size === 'compact' ? 56 : 64), [start, end, w, size])
  const toPct = timelineX(start, end, 100), pct = (t: number) => toPct(Math.min(end, Math.max(start, t)))
  const at = (mk: TimelineMark, t: number) => (w > 0 && Number.isFinite(mk.x) ? (mk.x / w) * 100 : pct(t))
  const totals = useMemo(() => {
    const by = new Map<string, number>()
    ribbonSegments(states, { start, end, width: 0 }).forEach(s => by.set(s.tags[0].kind, (by.get(s.tags[0].kind) ?? 0) + s.to - s.from))
    return [...kinds.values()].filter(k => by.has(k.kind)).map(k => ({ k, ms: by.get(k.kind)! }))
  }, [states, start, end, kinds])
  const activeMark = rows.flatMap(r => r.marks).find(mk => mk.key === nav.activeKey)
  const activeSeg = segs.find(s => s.key === nav.activeKey)

  return (
    <div className={className}>
      <div ref={box} className="relative">
        <div role="group" aria-roledescription="timeline" aria-label={label ?? 'States over time'} aria-describedby={`${ids}-sum`} {...nav.groupProps} className={cn('relative flex flex-col', S.gap)}>
          <span id={`${ids}-sum`} className="sr-only">{timelineSummary(all.length, start, end)} {TL_HELP}</span>
          {pins.length > 0 && (
            <div className="relative" style={{ height: S.stack * pinStep + 4 }}>
              {pinMarks.map(mk => {
                const t0 = mk.tags[0]
                return (
                  <button key={mk.key} type="button" {...nav.markProps(mk)} style={{ left: `${at(mk, mk.from)}%` }}
                    className={cn('ui-target absolute bottom-0 flex -translate-x-1/2 cursor-pointer flex-col items-center rounded-full border-0 bg-transparent p-0', VIZ_FOCUS)}>
                    <TimelineGlyph tag={t0} kinds={kinds} size={S.pin} active={nav.activeKey === mk.key} more={mk.tags.length - 1} />
                    <span aria-hidden className="w-px bg-[var(--line2)]" style={{ height: 4 + mk.row * pinStep }} />
                    <span className="sr-only">{timelineMarkText(mk, kinds)}</span>
                  </button>
                )
              })}
            </div>
          )}
          <div ref={plotRef} className={cn('relative rounded-[var(--r-sm)] bg-[var(--muted)]', S.strip)}>
            {segs.map((sg, i) => {
              const t0 = sg.tags[0], left = at(sg, sg.from), width = w > 0 ? (sg.w / w) * 100 : pct(sg.to) - pct(sg.from)
              const dom = sg.mixed ? sg.tags.reduce((b, q) => (timeTagMs(q.end ?? q.at) - timeTagMs(q.at) > timeTagMs(b.end ?? b.at) - timeTagMs(b.at) ? q : b), t0) : t0
              const { color } = timeTagLook(dom, kinds), lit = nav.activeKey === sg.key, thin = w > 0 && sg.w < 24
              return (
                <button key={sg.key} type="button" {...nav.markProps(sg)} aria-label={sg.mixed ? `Several short states: ${timelineMarkText(sg, kinds)}` : timelineMarkText(sg, kinds)}
                  className={cn('absolute inset-y-0 cursor-pointer border-0 p-0 transition-[box-shadow] duration-150', VIZ_FOCUS, thin && 'ui-hit', lit && cn('z-[2]', VIZ_LIT_RING),
                    i === 0 && 'rounded-l-[var(--r-sm)]', i === segs.length - 1 && 'rounded-r-[var(--r-sm)]')}
                  style={{ left: `${left}%`, width: `${width}%`, background: sg.mixed ? `repeating-linear-gradient(135deg, ${color} 0 3px, ${timeTagTint(color, 40)} 3px 6px)` : color }} />
              )
            })}
          </div>
          {bars.length > 0 && (
            <div className={cn('relative', S.bar)}>
              {barMarks.map(mk => {
                const t0 = mk.tags[0]
                return <button key={mk.key} type="button" {...nav.markProps(mk)} aria-label={timelineMarkText(mk, kinds)}
                  className={cn('ui-target absolute inset-y-0 cursor-pointer rounded-full border-0 p-0', VIZ_FOCUS, nav.activeKey === mk.key && VIZ_LIT_RING)}
                  style={{ left: `${pct(mk.from)}%`, width: `max(6px, ${pct(mk.to) - pct(mk.from)}%)`, background: timeTagLook(t0, kinds).color }} />
              })}
            </div>
          )}
        </div>
        {axis && <TimelineAxis ticks={ticks} start={start} end={end} className="mt-0.5" />}
        {activeMark && (
          <VizTip at={() => vizTipAnchor(nav.anchor())}>
            <TimelineTipBody tags={activeMark.tags} kinds={kinds} extra={activeSeg?.mixed ? <div className="text-[var(--fg3)]">Several short states · {timelineDuration(activeSeg.to - activeSeg.from)}</div> : undefined} />
          </VizTip>
        )}
      </div>
      {legend && totals.length > 0 && (
        <Legend items={totals.map(({ k, ms }) => ({ key: k.kind, label: k.label, color: k.color, value: timelineDuration(ms) }))} />
      )}
    </div>
  )
}

/** Props of TagJournal. */
export type TagJournalProps = TimelineLinkProps & {
  tags: TimeTag[]
  kinds?: TimeTagKind[]
  /** an hour header above each hour's tags */
  groupBy?: 'hour'
  /** box height in px (default: fits the rows, up to `maxHeight`) */
  height?: number
  /** tallest the list grows before it scrolls (default 320) */
  maxHeight?: number
  /** show an Edit button per row */
  onEdit?: (tag: TimeTag) => void
  /** show a Delete button per row */
  onDelete?: (tag: TimeTag) => void
  /** shown when there are no tags */
  empty?: ReactNode
  label?: string
  className?: string
}

/** TagJournal row and hour-header heights, px (they size the rows and the virtual list's estimates). */
const JOURNAL_ROW = 36, JOURNAL_HEAD = 28

/**
 * A time-ordered list of tags (pattern H: Oura and WHOOP journals): time, glyph, label and detail, optionally grouped
 * by hour, virtualised so long days stay fast. Hovering or focusing a row lights that tag (`activeId` /
 * `onActiveChange`), and when the active tag changes elsewhere (a linked chart) the list scrolls it into view without
 * moving focus. `onEdit` / `onDelete` add labelled icon buttons. Keyboard: the list is one Tab stop (then the row's
 * buttons), ↑/↓ move between rows, Home/End jump, Enter selects, Escape clears.
 */
export function TagJournal({ tags, kinds: kindsProp, groupBy, height, maxHeight = 320, onEdit, onDelete, empty, activeId, defaultActiveId = null, onActiveChange, onSelect, label, className }: TagJournalProps) {
  const kinds = useMemo(() => resolveTagKinds(kindsProp, tags), [kindsProp, tags])
  const [active, setActive] = useControllable(activeId, defaultActiveId, onActiveChange)
  const list = useRef<VirtualListHandle>(null)
  const box = useRef<HTMLDivElement>(null)
  const rowEls = useRef(new Map<string, HTMLElement>())
  const guard = useTimelineHoverGuard()
  const mine = useRef<string | null | undefined>(undefined), source = useRef<TlSource>(null), lastFocus = useRef<string | null>(null)
  type Item = { head: number } | { tag: TimeTag }
  const items = useMemo(() => {
    const sorted = [...tags].sort((a, b) => timeTagMs(a.at) - timeTagMs(b.at)), out: Item[] = []
    let hour = NaN
    sorted.forEach(t => {
      if (groupBy === 'hour') {
        const d = new Date(timeTagMs(t.at))
        d.setMinutes(0, 0, 0)
        if (d.getTime() !== hour) { hour = d.getTime(); out.push({ head: hour }) }
      }
      out.push({ tag: t })
    })
    return out
  }, [tags, groupBy])
  const rowIds = items.flatMap(it => ('tag' in it ? [it.tag.id] : []))
  const indexOf = (id: string | null) => items.findIndex(it => 'tag' in it && it.tag.id === id)
  const activeIndex = indexOf(active)
  const stop = active !== null && rowIds.includes(active) ? active : lastFocus.current && rowIds.includes(lastFocus.current) ? lastFocus.current : rowIds[0]
  const stopIndex = indexOf(stop ?? null)
  // a change from outside (a linked chart): bring the row into view inside the list, leaving focus where it is
  useEffect(() => {
    if (mine.current === active) { mine.current = undefined; return }
    mine.current = undefined
    if (activeIndex >= 0) { guard.arm(); list.current?.scrollToIndex(activeIndex, { align: 'auto' }) }
  }, [activeIndex, active])
  const set = (id: string | null, via: TlSource) => { source.current = id === null ? null : via; if (id !== active) { mine.current = id; setActive(id) } }
  useOutside([box], () => { if (source.current === 'tap') set(null, null) }, active !== null)
  const est = items.reduce((s, it) => s + ('head' in it ? JOURNAL_HEAD : JOURNAL_ROW), 0) + 2
  const h = height ?? Math.min(maxHeight, Math.max(est, 80))
  // a row the keyboard moved to that wasn't mounted yet takes focus once it renders (the list keeps the stop row mounted)
  const focusNext = useRef<string | null>(null)
  useLayoutEffect(() => {
    const id = focusNext.current
    focusNext.current = null
    if (id) rowEls.current.get(id)?.focus()
  })
  const onKeyDown = (e: ReactKeyboardEvent<HTMLElement>) => {
    const i = rowIds.indexOf(lastFocus.current ?? '')
    if (i < 0 || e.altKey || e.ctrlKey || e.metaKey || !(e.target as HTMLElement).dataset.row) return
    if (e.key === 'Escape') {
      if (active !== null) { e.preventDefault(); set(null, null) }
      return
    }
    const j = e.key === 'ArrowLeft' || e.key === 'ArrowRight' ? null : gridKeyMove(e.key, i, rowIds.length)
    if (j === null) return
    e.preventDefault()
    const id = rowIds[j]
    guard.arm()
    list.current?.scrollToIndex(indexOf(id), { align: 'auto' })
    lastFocus.current = id
    set(id, 'focus')
    const el = rowEls.current.get(id)
    if (el) el.focus()
    else focusNext.current = id
  }
  if (!tags.length) return <EmptyState size="sm" className={cn('grid min-h-20 place-items-center', className)} title={empty ?? 'Nothing logged yet'} />
  return (
    <div ref={box} className={className} onKeyDown={onKeyDown}
      onBlur={e => { if (!e.currentTarget.contains(e.relatedTarget as Node | null) && source.current === 'focus') set(null, null) }}
      onPointerLeave={e => { if (!isTouch(e) && source.current === 'hover') set(null, null) }} onPointerMove={guard.onMove}>
      <VirtualList ref={list} count={items.length} height={h} tabIndex={-1} aria-label={label ?? 'Journal'} keep={stopIndex >= 0 ? [stopIndex] : undefined}
        getItemKey={i => { const it = items[i]; return 'tag' in it ? it.tag.id : `h${it.head}` }}
        estimateSize={i => ('head' in items[i] ? JOURNAL_HEAD : JOURNAL_ROW)}
        renderItem={i => {
          const it = items[i]
          if ('head' in it) return <div className="ui-num flex items-end px-2 pb-1 text-[11px] font-semibold text-[var(--fg3)]" style={{ height: JOURNAL_HEAD }}>{fmt.time(it.head)}</div>
          const t = it.tag, at = timeTagMs(t.at), lit = t.id === active, tab = t.id === stop ? 0 : -1
          return (
            <div className={cn('flex items-center gap-0.5 rounded-[var(--r-md)] pe-1 transition-colors duration-150', lit ? 'bg-[var(--muted)]' : 'hover:bg-[color-mix(in_srgb,var(--muted)_60%,transparent)]')}
              style={{ minHeight: JOURNAL_ROW }} onPointerEnter={e => { if (!isTouch(e) && guard.allow(e)) set(t.id, 'hover') }}>
              <button type="button" data-row="1" tabIndex={tab} aria-current={lit || undefined}
                ref={el => { if (el) rowEls.current.set(t.id, el); else rowEls.current.delete(t.id) }}
                onFocus={e => { lastFocus.current = t.id; if (e.currentTarget.matches(':focus-visible')) set(t.id, 'focus') }}
                onPointerDown={e => { if (isTouch(e)) set(t.id, 'tap') }}
                onClick={() => { lastFocus.current = t.id; set(t.id, source.current ?? 'tap'); onSelect?.(t) }}
                className={cn('flex min-w-0 flex-1 cursor-pointer items-center gap-2.5 rounded-[var(--r-md)] border-0 bg-transparent px-2 py-1.5 text-start text-[13px] text-[var(--fg)] [@media(pointer:coarse)]:min-h-10', VIZ_FOCUS, 'focus-visible:outline-offset-0')}>
                <span className="ui-num w-[4.25rem] flex-none text-xs text-[var(--fg3)]">{fmt.time(at)}</span>
                <TimelineGlyph tag={t} kinds={kinds} size={18} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate">{t.label}{t.end !== undefined && <span className="ms-1.5 text-xs text-[var(--fg3)]">{timelineDuration(timeTagMs(t.end) - at)}</span>}</span>
                  {t.detail && <span className="block truncate text-xs text-[var(--fg3)]">{t.detail}</span>}
                </span>
              </button>
              {onEdit && <IconButton icon="edit" size="icon-xs" label={`Edit ${timelineTagText(t)}`} tabIndex={tab} onClick={() => onEdit(t)} className="flex-none [@media(pointer:coarse)]:size-8" />}
              {onDelete && <IconButton icon="trash" size="icon-xs" label={`Delete ${timelineTagText(t)}`} tabIndex={tab} onClick={() => onDelete(t)} className="flex-none hover:text-[var(--bad)] [@media(pointer:coarse)]:size-8" />}
            </div>
          )
        }} />
    </div>
  )
}

/** What ChartWithJournal hands its chart: spread into Chart's `annotations` (add a `style`). */
export type TimelineLink = { tags: TimeTag[]; kinds?: TimeTagKind[]; activeId: string | null; onActiveChange: (id: string | null) => void; onSelect?: (tag: TimeTag) => void }

/** Props of ChartWithJournal. */
export type ChartWithJournalProps = TimelineLinkProps & Pick<TagJournalProps, 'groupBy' | 'onEdit' | 'onDelete' | 'empty'> & {
  tags: TimeTag[]
  kinds?: TimeTagKind[]
  /** the chart, given the link: `link => <Chart … annotations={{ ...link, style: 'dots' }} />` */
  chart: (link: TimelineLink) => ReactNode
  /** journal height beside the chart (default 260) */
  height?: number
  /** accessible name of the journal */
  label?: string
  className?: string
}

/**
 * A chart and its journal side by side (pattern H), linked both ways: hovering, focusing or tapping a tag on either
 * side lights it on the other, and the list scrolls the lit row into view without moving focus. Below 640 px of width
 * the list stacks under the chart. The chart is a render prop, so any annotated chart works:
 * `<ChartWithJournal tags={tags} chart={link => <Chart data={day} x="t" series={…} annotations={{ ...link, style: 'dots' }} />} />`.
 */
export function ChartWithJournal({ tags, kinds, chart, height = 260, groupBy, onEdit, onDelete, empty, activeId, defaultActiveId = null, onActiveChange, onSelect, label, className }: ChartWithJournalProps) {
  const [active, setActive] = useControllable(activeId, defaultActiveId, onActiveChange)
  const link: TimelineLink = { tags, kinds, activeId: active, onActiveChange: setActive, onSelect }
  return (
    <div className={cn('@container', className)}>
      <div className="grid gap-4 @[640px]:grid-cols-[minmax(0,1fr)_minmax(220px,36%)] @[640px]:items-start">
        <div className="min-w-0">{chart(link)}</div>
        <TagJournal tags={tags} kinds={kinds} groupBy={groupBy} onEdit={onEdit} onDelete={onDelete} empty={empty} maxHeight={height} label={label}
          activeId={active} onActiveChange={setActive} onSelect={onSelect}
          className="min-w-0 border-[var(--line)] @max-[639px]:border-t @max-[639px]:pt-2 @[640px]:border-s @[640px]:ps-3" />
      </div>
    </div>
  )
}
