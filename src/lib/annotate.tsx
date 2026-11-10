/**
 * Timeline annotations: events and spans placed on a time axis, shared by Chart annotations, Swimlanes,
 * StateRibbon and linked lists. Plain layout maths (`layoutTimeTags`, `timeTicks`), one keyboard model
 * (`useTagFocus`) and the two visual atoms (`TagGlyph`, `TagTooltip`); the Chart draws them (`annotations` prop).
 */
import { useId, useRef, type CSSProperties, type FocusEvent as ReactFocusEvent, type HTMLAttributes, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from 'react'
import { cn, safeColor, fmt } from './core'
import { niceStep } from './vizkit'

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

/** How tags sit on a chart: pins on the line, an icon rug under the axis, flagged rules, rollup chips, dots, or auto. */
export type TimeTagStyle = 'auto' | 'pins' | 'rug' | 'flags' | 'rollup' | 'dots'
/**
 * Options of layoutTimeTags: `x` maps epoch ms to px, `width` is the plot's right edge. Defaults: minGap 2 px between
 * glyphs, maxStack 3 rows (rug, rollup, explicit pins), pinStack 2 rows (auto pins), size 20 px glyphs, binMin 34 px
 * (smallest rollup bin), domain [start] for the px per minute, labelWidth ≈ 6.4 px a character + 14 (flags).
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

/** Width in px of a glyph's "+N" badge; layouts keep it clear of the next glyph in its row. */
export const timeTagBadge = (n: number) => (String(n).length + 1) * 6 + 10
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
    last[host.row] = Math.max(last[host.row], host.x + timeTagBadge(host.more.length) - 4)
  }
  return { points: out, hidden, rows: used }
}

/**
 * Place tags on a time axis: points for the style, spans with px edges, rollup bins per kind. `style: 'auto'` picks
 * pins if every point fits in `pinStack` rows, else the rug if it fits in `maxStack` rows, else rollups (the smallest
 * clock step, 5 min to a day, at least `binMin` px wide; past `maxStack` kinds a bin gathers the rest as kind '*').
 * Pure and cheap: call it every render, so a resize re-picks.
 */
export function layoutTimeTags(tags: TimeTag[], { x, width, style = 'auto', minGap = 2, maxStack = 3, pinStack = 2, size = 20, domain, binMin = 34, labelWidth }: TimeTagLayoutOptions): TimeTagLayout {
  const pts = tags.filter(t => t.end === undefined).map(tag => { const ms = timeTagMs(tag.at); return { tag, ms, x: x(ms), row: 0 } as PlacedTimeTag }).sort((a, b) => a.ms - b.ms)
  const spans = tags.filter(t => t.end !== undefined).map(tag => { const from = timeTagMs(tag.at), to = timeTagMs(tag.end!); return { tag, from, to, x0: x(from), x1: x(to) } }).sort((a, b) => a.from - b.from)
  const need = size + minGap, rows = Math.max(1, maxStack)
  const done = (s: TimeTagLayout['style'], st: { points: PlacedTimeTag[]; hidden: number; rows: number }, bins: TimeTagBin[] = []): TimeTagLayout => ({ style: s, points: st.points, spans, bins, rows: st.rows, hidden: st.hidden })
  if (style === 'dots') return done('dots', { points: pts, hidden: 0, rows: pts.length ? 1 : 0 })
  if (style === 'flags') {
    let end = -Infinity
    const out = pts.map(p => {
      const w = labelWidth ? labelWidth(p.tag) : p.tag.label.length * 6.4 + 14
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
    g.set(p.tag.kind, [...(g.get(p.tag.kind) ?? []), p.tag.id]); groups.set(b, g)
  }
  const bins: TimeTagBin[] = [], binOf = new Map<string, number>()
  for (const [from, g] of [...groups].sort((a, b) => a[0] - b[0])) {
    const kinds = [...g].sort((a, b) => b[1].length - a[1].length)
    const keep = kinds.length > rows ? kinds.slice(0, rows - 1) : kinds, rest = kinds.slice(keep.length)
    const to = from + stepMs, bx = x(from + stepMs / 2), w = Math.abs(x(to) - x(from))
    keep.forEach(([kind, ids], row) => { ids.forEach(id => binOf.set(id, bins.length)); bins.push({ from, to, kind, count: ids.length, ids, x: bx, w, row }) })
    if (rest.length) {
      const ids = rest.flatMap(r => r[1]); ids.forEach(id => binOf.set(id, bins.length))
      bins.push({ from, to, kind: '*', count: ids.length, ids, x: bx, w, row: keep.length })
    }
  }
  const out = pts.map(p => ({ ...p, bin: binOf.get(p.tag.id) }))
  return done('rollup', { points: out, hidden: 0, rows: bins.length ? Math.max(...bins.map(b => b.row)) + 1 : 0 }, bins)
}

/** Round time ticks (1 min to a day, aligned to the local clock) with ≥ `minPx` per label: 9:00–17:30 at 640 px → hourly. */
export function timeTicks(startMs: number, endMs: number, widthPx: number, fmt: (ms: number) => string, minPx = 64): { ms: number; label: string }[] {
  const span = endMs - startMs
  if (!(span > 0) || !(widthPx > 0)) return []
  const maxTicks = Math.max(1, Math.floor(widthPx / minPx))
  const step = niceStep(span / 60_000, maxTicks, TIME_STEPS)
  const stepMs = step * 60_000, out: { ms: number; label: string }[] = []
  let t = timeStepFloor(startMs, Math.min(step, 1440))
  if (t < startMs) t += stepMs
  for (; t <= endMs && out.length < 500; t += stepMs) out.push({ ms: t, label: fmt(t) })
  return out
}

/** A tag's icon, colour and kind label (the tag's own, then its kind's). */
export function timeTagLook(tag: TimeTag, kinds?: TimeTagKind[]) {
  const k = kinds?.find(q => q.kind === tag.kind)
  return { icon: tag.icon ?? k?.icon, color: safeColor(tag.color ?? k?.color, 'var(--accent)'), kindLabel: k?.label ?? tag.label }
}
/** A tint of a colour on the card, readable in light and dark themes (chips, flags, bands). */
export const timeTagTint = (color: string, pct = 16) => `color-mix(in srgb, ${color} ${pct}%, var(--card))`

/** A tag's icon in a coloured ring; `active` grows it with a halo, `more` adds a "+N" badge on its end side (timeTagBadge wide). Decorative unless given a role. */
export function TagGlyph({ icon, color = 'var(--accent)', size = 20, active, more, className, style, ...rest }:
  { icon?: ReactNode; color?: string; size?: number; active?: boolean; more?: number } & HTMLAttributes<HTMLSpanElement>) {
  const c = safeColor(color, 'var(--accent)')
  return (
    <span {...rest} className={cn('relative inline-grid flex-none place-items-center rounded-full border-[1.5px] bg-[var(--card)] leading-none select-none motion-safe:transition-[transform,box-shadow] motion-safe:duration-150', active && 'scale-[1.18]', className)}
      style={{ width: size, height: size, fontSize: Math.round(size * 0.52), borderColor: c, boxShadow: active ? `0 0 0 3px ${timeTagTint(c, 35)}` : undefined, ...style }}>
      {icon ?? <span className="h-1.5 w-1.5 rounded-full" style={{ background: c }} />}
      {!!more && <span className="ui-num absolute start-[calc(100%-4px)] top-1/2 -translate-y-1/2 rounded-full border border-[var(--card)] bg-[var(--fg)] text-center text-[10px] leading-[13px] font-semibold text-[var(--card)]" style={{ width: timeTagBadge(more) }}>+{more}</span>}
    </span>
  )
}

/** Tooltip body for a tag: icon and label, the time (or from–to for a span) and the detail. Put it in any tooltip surface. */
export function TagTooltip({ tag, kinds, extra }: { tag: TimeTag; kinds?: TimeTagKind[]; /** a line under the rest, e.g. a rollup count */ extra?: ReactNode }) {
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
 * Keyboard model for tags, like a chart (useChartShell): one Tab stop (a horizontal listbox), ←/→ through the tags in time order
 *, Home/End, Enter/Space selects, Escape clears; the active tag is the aria-activedescendant
 * ("Water at 10:40"). Spread `props` on the box and `option(tag)` on every tag (folded ones with TAG_SR_ONLY). Handled
 * keys don't bubble; a tag the keyboard activated clears on blur.
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
  const go = (i: number) => { byKeyboard.current = true; onActive(order[Math.max(0, Math.min(order.length - 1, i))].id) }
  const onKeyDown = (e: ReactKeyboardEvent<HTMLElement>) => {
    if (!order.length || e.altKey || e.ctrlKey || e.metaKey) return
    switch (e.key) {
      case 'ArrowRight': case 'ArrowDown': go(cur < 0 ? 0 : cur + 1); break
      case 'ArrowLeft': case 'ArrowUp': go(cur < 0 ? 0 : cur - 1); break
      case 'Home': go(0); break
      case 'End': go(order.length - 1); break
      case 'Enter': case ' ': if (cur < 0) return; onSelect?.(order[cur]); break
      case 'Escape': if (cur < 0) return; onActive(null); break
      default: return
    }
    e.preventDefault(); e.stopPropagation()
  }
  const props = {
    tabIndex: 0, role: 'listbox', 'aria-orientation': 'horizontal' as const, 'aria-label': label ?? 'Tags',
    'aria-activedescendant': cur >= 0 ? optId(order[cur]) : undefined, onKeyDown,
    onFocus: (e: ReactFocusEvent<HTMLElement>) => { if (e.target === e.currentTarget && cur < 0 && order.length && e.currentTarget.matches(':focus-visible')) go(0) },
    onBlur: (e: ReactFocusEvent<HTMLElement>) => { if (byKeyboard.current && !e.currentTarget.contains(e.relatedTarget as Node | null)) { byKeyboard.current = false; onActive(null) } },
  }
  const option = (t: TimeTag) => ({ id: optId(t), role: 'option', 'aria-selected': t.id === activeId, 'aria-label': name(t) })
  return { props, option, order, name }
}

/** Visually hidden but present for assistive tech (the option of a tag folded into a "+N"). */
export const TAG_SR_ONLY: CSSProperties = { position: 'absolute', width: 1, height: 1, overflow: 'hidden', clipPath: 'inset(50%)', whiteSpace: 'nowrap' }
