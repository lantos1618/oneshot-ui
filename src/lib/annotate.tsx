/**
 * Timeline annotations: events and spans placed on a time axis, shared by Chart annotations, Swimlanes,
 * StateRibbon and linked lists. Plain layout maths (`layoutTimeTags`, `timeTicks`), one keyboard model
 * (`useTagFocus`) and the two visual atoms (`TagGlyph`, `TagTooltip`); the Chart draws them (`annotations` prop).
 */
import { useId, useRef, type CSSProperties, type FocusEvent as ReactFocusEvent, type HTMLAttributes, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from 'react'
import { cn, safeColor, fmt, gridKeyMove } from './core'
import { CHART_NEUTRAL, niceStep, seriesColor, textPx } from './vizkit'

/** One tag on a timeline: a point event (`at`) or a span (`at` → `end`). Times are epoch ms or Date. */
export type TimeTag = {
  id: string
  at: number | Date
  /** set for spans (durations), e.g. lunch 12:30–13:05 */
  end?: number | Date
  /** groups events into lanes and picks colour/icon defaults, e.g. 'water' */
  kind: string
  label: string
  icon?: ReactNode
  color?: string
  /** optional detail shown in tooltips and linked lists */
  detail?: ReactNode
}

/** How a kind of tag looks: lane label, icon and colour. */
export type TimeTagKind = { kind: string; label: string; icon?: ReactNode; color?: string }

/** Epoch ms for a tag time. */
export const timeTagMs = (t: number | Date) => (typeof t === 'number' ? t : t.getTime())

/** A kind with its colour settled (its own, else the palette's). */
export type ResolvedTagKind = TimeTagKind & { color: string }
/** Kinds by name, from resolveTagKinds. */
export type TagKinds = ReadonlyMap<string, ResolvedTagKind>
/**
 * The one kind lookup every tag view uses, so linked views agree: `kinds` in order, then kinds only seen on `tags`
 * (labelled by their first tag). A kind without a colour takes the palette colour of its place in that order.
 */
export function resolveTagKinds(kinds: readonly TimeTagKind[] | undefined, tags: readonly TimeTag[] = []): TagKinds {
  const map = new Map<string, ResolvedTagKind>()
  const add = (k: TimeTagKind) => { if (!map.has(k.kind)) map.set(k.kind, { ...k, color: seriesColor(map.size, k.color) }) }
  kinds?.forEach(add)
  tags.forEach(t => add({ kind: t.kind, label: t.label }))
  return map
}
const tagKindsOf = (kinds: readonly TimeTagKind[] | TagKinds | undefined, tag: TimeTag): TagKinds => (kinds instanceof Map ? kinds : resolveTagKinds(kinds as readonly TimeTagKind[] | undefined, [tag]))

/** How tags sit on a chart: pins on the line, an icon rug under the axis, flagged rules, rollup chips, dots, or auto. */
export type TimeTagStyle = 'auto' | 'pins' | 'rug' | 'flags' | 'rollup' | 'dots'
/**
 * layoutTimeTags defaults, which charts also use to reserve room: `size` px glyphs, `gap` px between stacked rows,
 * `minGap` px between glyphs in a row, `maxStack` rows (rug, rollup, explicit pins), `pinStack` rows (auto pins) and the
 * smallest rollup bin, `binMin` px.
 */
export const TAG_LAYOUT = { size: 20, gap: 3, minGap: 2, maxStack: 3, pinStack: 2, binMin: 34 } as const
/**
 * Options of layoutTimeTags: `x` maps epoch ms to px, `width` is the plot's right edge; the rest default to TAG_LAYOUT.
 * `domain` [start] sets the px per minute; `labelWidth` defaults to the label's estimated text width plus 14 (flags).
 */
export type TimeTagLayoutOptions = {
  x: (ms: number) => number; width: number; style?: TimeTagStyle; minGap?: number; maxStack?: number; pinStack?: number
  size?: number; domain?: [number, number]; binMin?: number; labelWidth?: (tag: TimeTag) => number
}
/**
 * A placed point: `row` 0 sits nearest the line or axis. `hidden` tags are folded into another glyph's `more` ("+N");
 * `flag` says whether a flag label is drawn; `bin` indexes the rollup chip that counts it.
 */
export type PlacedTimeTag = { tag: TimeTag; ms: number; x: number; row: number; hidden?: boolean; more?: string[]; flag?: boolean; bin?: number }
/** A placed span (duration). */
export type PlacedTimeSpan = { tag: TimeTag; from: number; to: number; x0: number; x1: number }
/** A rollup chip: `count` tags of one kind between `from` and `to` (kind '*' gathers the kinds that didn't fit). */
export type TimeTagBin = { from: number; to: number; kind: string; count: number; ids: string[]; x: number; w: number; row: number }
/** What layoutTimeTags returns: the resolved style, placed points (time order), spans, rollup bins and rows used. */
export type TimeTagLayout = { style: Exclude<TimeTagStyle, 'auto'>; points: PlacedTimeTag[]; spans: PlacedTimeSpan[]; bins: TimeTagBin[]; rows: number; hidden: number }

/** Bin and tick steps in minutes. */
const TIME_STEPS = [1, 2, 5, 10, 15, 20, 30, 60, 120, 180, 360, 720, 1440]
/** Start of the local-time step that contains `ms` (steps align to the local day: 14:00, 14:30…). */
const timeStepFloor = (ms: number, stepMin: number) => {
  const d = new Date(ms), mins = d.getHours() * 60 + d.getMinutes()
  if (stepMin >= 1440) return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
  return ms - ((mins % stepMin) * 60_000 + d.getSeconds() * 1000 + d.getMilliseconds())
}

/** Width in px of a count chip ("+N" badge on a glyph, merged-marks chip); layouts keep it clear of the next mark in its row. */
export const countChipPx = (n: number) => textPx(String(n).length + 1, 10)
/** Greedy rows: lowest row with `need` px of room, else fold into the last row's glyph (its "+N" badge then takes room too). */
function timeTagStack(pts: PlacedTimeTag[], rows: number, need: number) {
  const last: number[] = Array(rows).fill(-Infinity), lastAt: (PlacedTimeTag | null)[] = Array(rows).fill(null)
  let hidden = 0, used = 0
  const out: PlacedTimeTag[] = pts.map(p => ({ tag: p.tag, ms: p.ms, x: p.x, row: 0 }))
  for (const p of out) {
    const r = last.findIndex(l => p.x - l >= need)
    if (r >= 0) { p.row = r; last[r] = p.x; lastAt[r] = p; used = Math.max(used, r + 1); continue }
    const host = lastAt[rows - 1] ?? lastAt.find(Boolean)!
    p.hidden = true; p.row = host.row; hidden++
    host.more = [...(host.more ?? []), p.tag.id]
    // the badge sits on the glyph's end side, overlapping it by 4 px: the next glyph in that row starts past it
    last[host.row] = Math.max(last[host.row], host.x + countChipPx(host.more.length) - 4)
  }
  return { points: out, hidden, rows: used }
}

/**
 * Place tags on a time axis: points for the style, spans with px edges, rollup bins per kind. `style: 'auto'` picks
 * pins if every point fits in `pinStack` rows, else the rug if it fits in `maxStack` rows, else rollups (the smallest
 * clock step, 5 min to a day, at least `binMin` px wide; past `maxStack` kinds a bin gathers the rest as kind '*').
 * Pure and cheap: call it every render, so a resize re-picks.
 */
export function layoutTimeTags(tags: TimeTag[], { x, width, style = 'auto', minGap = TAG_LAYOUT.minGap, maxStack = TAG_LAYOUT.maxStack, pinStack = TAG_LAYOUT.pinStack, size = TAG_LAYOUT.size, domain, binMin = TAG_LAYOUT.binMin, labelWidth }: TimeTagLayoutOptions): TimeTagLayout {
  const pts = tags.filter(t => t.end === undefined).map(tag => { const ms = timeTagMs(tag.at); return { tag, ms, x: x(ms), row: 0 } as PlacedTimeTag }).sort((a, b) => a.ms - b.ms)
  const spans = tags.filter(t => t.end !== undefined).map(tag => { const from = timeTagMs(tag.at), to = timeTagMs(tag.end!); return { tag, from, to, x0: x(from), x1: x(to) } }).sort((a, b) => a.from - b.from)
  const need = size + minGap, rows = Math.max(1, maxStack)
  const done = (s: TimeTagLayout['style'], st: { points: PlacedTimeTag[]; hidden: number; rows: number }, bins: TimeTagBin[] = []): TimeTagLayout => ({ style: s, points: st.points, spans, bins, rows: st.rows, hidden: st.hidden })
  if (style === 'dots') return done('dots', { points: pts, hidden: 0, rows: pts.length ? 1 : 0 })
  if (style === 'flags') {
    let end = -Infinity
    const out = pts.map(p => {
      const w = labelWidth ? labelWidth(p.tag) : textPx(p.tag.label.length, 14)
      const flag = p.x >= end + minGap && p.x + w <= width + 1
      if (flag) end = p.x + w
      return { ...p, flag }
    })
    return done('flags', { points: out, hidden: out.filter(p => !p.flag).length, rows: pts.length ? 1 : 0 })
  }
  if (style === 'pins' || style === 'rug') return done(style, timeTagStack(pts, rows, need))
  if (style === 'auto') {
    const pins = timeTagStack(pts, Math.max(1, pinStack), need)
    if (!pins.hidden) return done('pins', pins)
    const rug = timeTagStack(pts, rows, need)
    if (!rug.hidden) return done('rug', rug)
  }
  // rollup: the bin size comes from the px per minute
  const t0 = domain?.[0] ?? pts[0]?.ms ?? 0, perMin = Math.abs(x(t0 + 60_000) - x(t0))
  const step = TIME_STEPS.find(m => m * perMin >= binMin) ?? 1440, stepMs = step * 60_000
  const groups = new Map<number, Map<string, string[]>>()
  for (const p of pts) {
    const b = timeStepFloor(p.ms, step), g = groups.get(b) ?? new Map<string, string[]>()
    g.set(p.tag.kind, [...(g.get(p.tag.kind) ?? []), p.tag.id])
    groups.set(b, g)
  }
  const bins: TimeTagBin[] = [], binOf = new Map<string, number>()
  for (const [from, g] of [...groups].sort((a, b) => a[0] - b[0])) {
    const kinds = [...g].sort((a, b) => b[1].length - a[1].length)
    const keep = kinds.length > rows ? kinds.slice(0, rows - 1) : kinds, rest = kinds.slice(keep.length)
    const to = from + stepMs, bx = x(from + stepMs / 2), w = Math.abs(x(to) - x(from))
    keep.forEach(([kind, ids], row) => { ids.forEach(id => binOf.set(id, bins.length)); bins.push({ from, to, kind, count: ids.length, ids, x: bx, w, row }) })
    if (rest.length) {
      const ids = rest.flatMap(r => r[1])
      ids.forEach(id => binOf.set(id, bins.length))
      bins.push({ from, to, kind: '*', count: ids.length, ids, x: bx, w, row: keep.length })
    }
  }
  const out = pts.map(p => ({ ...p, bin: binOf.get(p.tag.id) }))
  return done('rollup', { points: out, hidden: 0, rows: bins.length ? Math.max(...bins.map(b => b.row)) + 1 : 0 }, bins)
}

const DAY_MS = 86_400_000
/** A tick on a time axis: `unit` 'day' at local midnight (labelled with the date), else 'time' (the time of day). */
export type TimeTick = { ms: number; label: string; unit: 'time' | 'day' }
const TICK_DAY: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short' }
const TIME_WITH_DAY: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }
/** The default tick label: the date for day ticks ("9 Nov"), else the time ("14:00"). */
export const timeTickText = (ms: number, unit: TimeTick['unit']) => (unit === 'day' ? fmt.date(ms, TICK_DAY) : fmt.time(ms))
/** A time on an axis `spanMs` long: the time of day, with the date once the range passes a day. */
export const timeSpanText = (ms: number, spanMs: number) => (spanMs >= DAY_MS ? fmt.dateTime(ms, TIME_WITH_DAY) : fmt.time(ms))

/**
 * Round time ticks (1 min to days, aligned to the local clock) with ≥ `minPx` per label: 9:00–17:30 at 640 px → hourly.
 * Ticks at local midnight are day ticks; `format` labels each one (default timeTickText).
 */
export function timeTicks(startMs: number, endMs: number, widthPx: number, format: (ms: number, unit: TimeTick['unit']) => string = timeTickText, minPx = 64): TimeTick[] {
  const span = endMs - startMs
  if (!(span > 0) || !(widthPx > 0)) return []
  const maxTicks = Math.max(1, Math.floor(widthPx / minPx))
  const step = niceStep(span / 60_000, maxTicks, TIME_STEPS)
  const days = Math.floor(step / 1440), stepMs = step * 60_000, out: TimeTick[] = []
  // whole days step by the calendar, so a DST change never moves a day tick off midnight
  const next = (t: number) => { if (!days) return t + stepMs; const d = new Date(t); return new Date(d.getFullYear(), d.getMonth(), d.getDate() + days).getTime() }
  let t = timeStepFloor(startMs, Math.min(step, 1440))
  if (t < startMs) t = next(t)
  for (; t <= endMs && out.length < 500; t = next(t)) {
    const unit = timeStepFloor(t, 1440) === t ? 'day' : 'time'
    out.push({ ms: t, label: format(t, unit), unit })
  }
  return out
}

/** A tag's icon, colour and kind label (the tag's own, then its kind's; pass resolveTagKinds' map so linked views agree). */
export function timeTagLook(tag: TimeTag, kinds?: readonly TimeTagKind[] | TagKinds) {
  const k = tagKindsOf(kinds, tag).get(tag.kind)
  return { icon: tag.icon ?? k?.icon, color: safeColor(tag.color ?? k?.color, CHART_NEUTRAL), kindLabel: k?.label ?? tag.label }
}
/** A tint of a colour on the card, readable in light and dark themes (chips, flags, bands). */
export const timeTagTint = (color: string, pct = 16) => `color-mix(in srgb, ${color} ${pct}%, var(--card))`

/** A tag's icon in a coloured ring; `active` grows it with a halo, `more` adds a "+N" badge on its end side (countChipPx wide). Decorative unless given a role. */
export function TagGlyph({ icon, color = 'var(--accent)', size = 20, active, more, className, style, ...rest }:
  { icon?: ReactNode; color?: string; size?: number; active?: boolean; more?: number } & HTMLAttributes<HTMLSpanElement>) {
  const c = safeColor(color, 'var(--accent)')
  return (
    <span {...rest} className={cn('relative inline-grid flex-none place-items-center rounded-full border-[1.5px] bg-[var(--card)] leading-none select-none motion-safe:transition-[transform,box-shadow] motion-safe:duration-150', active && 'scale-[1.18]', className)}
      style={{ width: size, height: size, fontSize: Math.round(size * 0.52), borderColor: c, boxShadow: active ? `0 0 0 3px ${timeTagTint(c, 35)}` : undefined, ...style }}>
      {icon ?? <span className="h-1.5 w-1.5 rounded-full" style={{ background: c }} />}
      {!!more && <span className="ui-num absolute start-[calc(100%-4px)] top-1/2 -translate-y-1/2 rounded-full border border-[var(--card)] bg-[var(--fg)] text-center text-[10px] leading-[13px] font-semibold text-[var(--card)]" style={{ width: countChipPx(more) }}>+{more}</span>}
    </span>
  )
}

/** Tooltip body for a tag: icon and label, the time (or from–to for a span) and the detail. Put it in any tooltip surface. */
export function TagTooltip({ tag, kinds, extra }: { tag: TimeTag; kinds?: readonly TimeTagKind[] | TagKinds; /** a line under the rest, e.g. a rollup count */ extra?: ReactNode }) {
  const { icon, color } = timeTagLook(tag, kinds)
  return (
    <div className="flex flex-col gap-0.5">
      <div className="flex items-center gap-1.5 font-medium"><span aria-hidden className="inline-grid h-4 w-4 flex-none place-items-center rounded-full text-[10px]" style={{ background: timeTagTint(color, 22) }}>{icon}</span>{tag.label}</div>
      <div className="ui-num text-[var(--fg2)]">{fmt.time(timeTagMs(tag.at))}{tag.end !== undefined && <> – {fmt.time(timeTagMs(tag.end))}</>}</div>
      {tag.detail && <div className="text-[var(--fg2)]">{tag.detail}</div>}
      {extra && <div className="text-[var(--fg3)]">{extra}</div>}
    </div>
  )
}

/** Options of useTagFocus: `onSelect` runs on Enter/Space; `label` names the list ("Tags"); `describe` names an option. */
export type TagFocusOptions = {
  tags: TimeTag[]; activeId: string | null; onActive: (id: string | null) => void; onSelect?: (tag: TimeTag) => void
  label?: string; describe?: (tag: TimeTag) => string
}
/**
 * Keyboard model for tags drawn as marks: one Tab stop (a horizontal listbox with aria-activedescendant, like a chart's
 * points), arrows step through the tags in time order (the first press lands on the first), Home/End jump, Enter/Space
 * selects, Escape clears ("Water at 10:40"). Spread `props` on the box and `option(tag)` on every tag (folded ones
 * visually hidden). Handled keys don't bubble; a tag the keyboard activated clears on blur.
 */
export function useTagFocus({ tags, activeId, onActive, onSelect, label, describe }: TagFocusOptions) {
  const id = useId()
  const byKeyboard = useRef(false)
  const order = [...tags].sort((a, b) => timeTagMs(a.at) - timeTagMs(b.at))
  const name = describe ?? ((t: TimeTag) => t.end !== undefined
    ? `${t.label}, ${fmt.time(timeTagMs(t.at))} to ${fmt.time(timeTagMs(t.end))}`
    : `${t.label} at ${fmt.time(timeTagMs(t.at))}`)
  const optId = (t: TimeTag) => `${id}-t-${t.id.replace(/[^\w-]/g, '_')}`
  const cur = order.findIndex(t => t.id === activeId)
  const onKeyDown = (e: ReactKeyboardEvent<HTMLElement>) => {
    if (!order.length || e.altKey || e.ctrlKey || e.metaKey) return
    const move = cur < 0 && e.key.startsWith('Arrow') ? 0 : gridKeyMove(e.key, Math.max(0, cur), order.length)
    if (move !== null) { byKeyboard.current = true; onActive(order[move].id) }
    else if ((e.key === 'Enter' || e.key === ' ') && cur >= 0) onSelect?.(order[cur])
    else if (e.key === 'Escape' && cur >= 0) onActive(null)
    else return
    e.preventDefault()
    e.stopPropagation()
  }
  const props = {
    tabIndex: 0, role: 'listbox', 'aria-orientation': 'horizontal' as const, 'aria-label': label ?? 'Tags',
    'aria-activedescendant': cur >= 0 ? optId(order[cur]) : undefined, onKeyDown,
    onFocus: (e: ReactFocusEvent<HTMLElement>) => {
      if (e.target !== e.currentTarget || cur >= 0 || !order.length || !e.currentTarget.matches(':focus-visible')) return
      byKeyboard.current = true
      onActive(order[0].id)
    },
    onBlur: (e: ReactFocusEvent<HTMLElement>) => { if (byKeyboard.current && !e.currentTarget.contains(e.relatedTarget as Node | null)) { byKeyboard.current = false; onActive(null) } },
  }
  const option = (t: TimeTag) => ({ id: optId(t), role: 'option', 'aria-selected': t.id === activeId, 'aria-label': name(t) })
  return { props, option, order, name }
}

/** Visually hidden but present for assistive tech, as an inline style (prefer the `sr-only` class, which chart export skips). */
export const TAG_SR_ONLY: CSSProperties = { position: 'absolute', width: 1, height: 1, overflow: 'hidden', clipPath: 'inset(50%)', whiteSpace: 'nowrap' }
