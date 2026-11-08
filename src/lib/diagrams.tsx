import { Fragment, useCallback, useEffect, useId, useLayoutEffect, useMemo, useReducer, useRef, useState, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react'
import { AnimatePresence, animate, motion, useInView, useReducedMotion } from 'motion/react'
import { AnimatedNumber, Avatar, Badge, Button, Chip, ICONS, Icon, LOCALE, ScrollEdges, Spinner, StatusIcon, TOUCH, addDays, clamp, cn, fmt, fmtDate, isTouch, onMouseLeave, sleep, spring, surface, useLongPress, useOutside, usePointerDrag, useScrollEdges, useWidth, type IconName } from './core'
import { Collapse } from './feedback'
import { SegmentedControl, Slider } from './forms'
import { PointerTooltip, usePointerTooltip } from './overlay'
import { play, useFrameLoop } from './motion'

/* ════════════════════════════════════════════════════════════════════════════
 * 14. DIAGRAMS: plans, statecharts, traces and flows. Each one is a plain component
 *     with data props; geometry is computed in render, animation comes from motion
 *     (or a small rAF loop for anything that streams). Everything reads the theme tokens.
 * ══════════════════════════════════════════════════════════════════════════ */

/* Shared bits ─────────────────────────────────────────────────────────────── */

/** Collapse sets overflow: hidden, which would stop sticky labels inside it; clip vertically only. */
const DG_COLLAPSE_STICKY = '!overflow-x-visible !overflow-y-clip'

const dgSafeId = (s: string) => s.replace(/[^a-zA-Z0-9_-]/g, '')
/** Dotted canvas background used by the statecharts and the process flow. */
const DG_DOTS = 'bg-[var(--bg)] [background-image:radial-gradient(circle,var(--line2)_1px,transparent_1.2px)] [background-size:18px_18px]'

/** Expand / collapse toggle for a group row (Gantt phases, trace spans): a chevron that turns, with a 36px touch hit area. */
function DgChevron({ open, label, onClick, className }: { open: boolean; label: string; onClick: () => void; className?: string }) {
  return (
    <button type="button" aria-label={`Toggle ${label}`} aria-expanded={open} onClick={onClick}
      className={cn('grid h-[18px] w-[18px] flex-none cursor-pointer place-items-center rounded border-0 bg-transparent text-[var(--fg3)] transition-transform duration-200 hover:bg-[var(--muted)] hover:text-[var(--fg)]', TOUCH.hit, !open && '-rotate-90', className)}>
      <Icon name="chevronDown" size={11} strokeWidth={2.5} />
    </button>
  )
}

/* ════════════════════════════════════════════════════════════════════════════
 * Gantt
 * ══════════════════════════════════════════════════════════════════════════ */

export type GanttTask = { id: string; name: string; start: number; duration: number; progress: number; owner: string; color?: string }
export type GanttPhase = { id: string; name: string; tasks: GanttTask[] }

const GANTT_ROW = 38
/** Task-name cells stay pinned while the timeline scrolls sideways on narrow screens. */
const GANTT_PIN = 'sticky left-0 z-[3] h-full shadow-[1px_0_0_var(--line)]'
const ganttEnd = (x: { s: number; d: number }) => x.s + x.d
const GANTT_CELL = { 1: 'bg-[color-mix(in_srgb,var(--ok)_22%,transparent)] text-[var(--fg2)]', 2: 'bg-[color-mix(in_srgb,var(--warn)_35%,transparent)] text-[var(--fg)]', 3: 'bg-[color-mix(in_srgb,var(--bad)_40%,transparent)] text-[var(--fg)]' } as const

/**
 * Project plan. Phases collapse; drag a bar to move it, drag its right edge (or Shift + arrow keys) to change its
 * duration, snapping to days. Dependants reschedule, and Links, Critical path, Baseline and Workload overlays toggle.
 * Tasks with duration 0 are milestones; `milestone` (default: the last one) anchors the critical path.
 * On touch: tap a bar for its details and links, long-press it to move it, or drag the grip on its right edge to
 * resize, so swipes over the chart still scroll. Narrow screens scroll the timeline inside the card, task names pinned.
 */
export function Gantt({ phases, dependencies, start, days = 42, today, people = {}, milestone, className }:
  { phases: GanttPhase[]; dependencies: [string, string][]; start: Date; days?: number; today?: number; people?: Record<string, string>; milestone?: string; className?: string }) {
  const tasks = useMemo(() => phases.flatMap(p => p.tasks.map(t => ({ ...t, phase: p.id }))), [phases])
  const initial = useMemo(() => Object.fromEntries(tasks.map(t => [t.id, { s: t.start, d: t.duration }])), [tasks])
  const [sched, setSched] = useState(initial)
  const [open, setOpen] = useState<Record<string, boolean>>(() => Object.fromEntries(phases.map(p => [p.id, true])))
  const [view, setView] = useState({ lk: false, cp: false, bl: false, wl: false })
  const [hover, setHover] = useState<string | null>(null)
  const [dragId, setDragId] = useState<string | null>(null)
  const drag = useRef<{ id: string; mode: 'move' | 'size'; s0: number; d0: number; dw: number } | null>(null)
  const press = useRef<{ x: number; y: number; moved: boolean } | null>(null) // a touch that may still become a long-press drag
  const { tip, show, hide } = usePointerTooltip()
  const [laneRef, laneW] = useWidth<HTMLDivElement>()
  const boxRef = useRef<HTMLDivElement>(null)
  const inView = useInView(boxRef, { once: true, amount: 0.3 })
  const uid = dgSafeId(useId())
  const byId = useMemo(() => Object.fromEntries(tasks.map(t => [t.id, t])), [tasks])
  const final = milestone ?? [...tasks].reverse().find(t => t.duration === 0)?.id ?? tasks[tasks.length - 1]?.id
  const preds = (id: string) => dependencies.filter(d => d[1] === id).map(d => d[0])
  const succs = (id: string) => dependencies.filter(d => d[0] === id).map(d => d[1])
  const fdate = (d: number) => fmtDate(addDays(start, d), { day: 'numeric', month: 'short' })
  const pct = (d: number) => `${(d / days) * 100}%`

  // walk back from the final milestone through the tightest predecessor
  const crit = useMemo(() => {
    const set = new Set<string>(); let cur: string | undefined = final
    while (cur) { set.add(cur); const ps = dependencies.filter(d => d[1] === cur).map(d => d[0]); if (!ps.length) break; cur = ps.reduce((a, b) => ganttEnd(sched[b]) > ganttEnd(sched[a]) ? b : a) }
    return set
  }, [sched, final, dependencies])
  const slackOf = (id: string) => { const ss = succs(id); return ss.length ? Math.max(0, Math.min(...ss.map(s => sched[s].s)) - ganttEnd(sched[id])) : 0 }

  const update = (id: string, next: { s: number; d: number }) => setSched(prev => {
    const S = Object.fromEntries(Object.entries(prev).map(([k, v]) => [k, { ...v }])); S[id] = next
    const push = (a: string) => succs(a).forEach(b => { const need = Math.max(...preds(b).map(p => ganttEnd(S[p]))); if (S[b].s < need) { S[b].s = need; push(b) } })
    push(id); return S
  })
  const moveTo = (id: string, s: number, d: number) => {
    const t = byId[id], ms = t.duration === 0
    const nd = ms ? 0 : Math.max(1, Math.min(days - s, d))
    const minS = Math.max(0, ...preds(id).map(p => ganttEnd(sched[p])))
    const ns = Math.max(minS, Math.min(days - Math.max(1, nd), s))
    if (ns !== sched[id].s || nd !== sched[id].d) update(id, { s: ns, d: nd })
  }

  // row geometry for the arrows (phase rows, then their tasks while open)
  const rowY: Record<string, number> = {}
  let r = 0
  phases.forEach(p => { r++; if (open[p.id]) p.tasks.forEach(t => { rowY[t.id] = r * GANTT_ROW; r++ }) })
  const bodyH = r * GANTT_ROW
  const X = (d: number) => (d / days) * laneW
  const barMid = (id: string) => rowY[id] + (byId[id].duration === 0 ? 20 : view.bl ? 17 : 19)
  const arrows = dependencies.filter(([a, b]) => rowY[a] !== undefined && rowY[b] !== undefined).map(([a, b]) => {
    const A = byId[a], B = byId[b]
    const x1 = A.duration === 0 ? X(sched[a].s) : X(ganttEnd(sched[a])), y1 = barMid(a)
    const x2 = B.duration === 0 ? X(sched[b].s) - 9 : X(sched[b].s), y2 = barMid(b), sg = Math.sign(y2 - y1) || 1
    const d = x2 - x1 >= 14
      ? `M${x1},${y1} H${x1 + 6} Q${x1 + 10},${y1} ${x1 + 10},${y1 + sg * 4} V${y2 - sg * 4} Q${x1 + 10},${y2} ${x1 + 14},${y2} H${x2 - 2}`
      : `M${x1},${y1} H${x1 + 8} V${y1 + (y2 - y1) / 2} H${x2 - 10} V${y2} H${x2 - 2}`
    const isCrit = crit.has(a) && crit.has(b)
    const shown = view.lk || hover === a || hover === b || (view.cp && isCrit)
    return { key: `${a}-${b}`, d, isCrit, shown }
  })

  const owners = [...new Set(tasks.map(t => t.owner))]
  const late = final ? ganttEnd(sched[final]) - (byId[final].start + byId[final].duration) : 0
  const tipFor = (id: string) => {
    const t = byId[id], x = sched[id], sl = slackOf(id)
    return <><b className="font-semibold">{t.name}</b><br /><span className="text-[var(--fg2)]">{t.duration === 0 ? fdate(x.s) : `${fdate(x.s)} to ${fdate(ganttEnd(x) - 1)} · ${x.d} days · ${Math.round(t.progress * 100)}%`}{sl ? ` · ${sl}d slack` : ''}</span></>
  }
  // dragging: usePointerDrag (capture, cancel and unmount handled); on touch a bar is picked up by a long-press,
  // so a swipe over the chart still scrolls it, and its resize grip drags straight away
  const barDrag = usePointerDrag({
    onMove: p => {
      const g = drag.current; if (!g) return
      const dd = Math.round(p.dx / g.dw)
      if (g.mode === 'size') moveTo(g.id, sched[g.id].s, g.d0 + dd); else moveTo(g.id, g.s0 + dd, sched[g.id].d)
    },
    onEnd: () => { drag.current = null; setDragId(null) },
  })
  const begin = (el: HTMLElement, e: { pointerId: number; clientX: number; clientY: number }, id: string, mode: 'move' | 'size') => {
    const lane = (el.parentElement as HTMLElement).getBoundingClientRect().width
    drag.current = { id, mode, s0: sched[id].s, d0: sched[id].d, dw: lane / days }
    barDrag.start(e, el); setDragId(id); hide()
  }
  const hold = useLongPress({ ms: 380, onPress: p => {
    const el = (p.target as Element).closest<HTMLElement>('[data-gantt-bar]'), id = el?.dataset.ganttBar
    press.current = null
    if (!el || !id) return
    begin(el, { pointerId: p.pointerId, clientX: p.x, clientY: p.y }, id, 'move'); setHover(id); navigator.vibrate?.(8)
  } })
  const onDown = (e: ReactPointerEvent<HTMLElement>, id: string) => {
    if (e.button !== 0) return
    const resize = !!(e.target as HTMLElement).dataset.resize
    if (isTouch(e) && !resize) { press.current = { x: e.clientX, y: e.clientY, moved: false }; hold.bind.onPointerDown(e); return } // a held finger picks the bar up
    begin(e.currentTarget, e, id, resize ? 'size' : 'move')
  }
  const onMove = (e: ReactPointerEvent<HTMLElement>, id: string) => {
    hold.bind.onPointerMove(e)
    const p = press.current
    if (p) { if (Math.hypot(e.clientX - p.x, e.clientY - p.y) > 8) p.moved = true; return }
    if (!drag.current && !isTouch(e)) show(e, tipFor(id))
  }
  const onUp = (e: ReactPointerEvent<HTMLElement>, id: string) => {
    hold.bind.onPointerUp()
    const p = press.current; press.current = null
    if (p && !p.moved && !drag.current) { setHover(id); show(e, tipFor(id)) } // a tap: details and links
  }
  const onCancel = () => { hold.cancel(); press.current = null }
  // once a touch drag is live, stop the browser from scrolling under it (touch-action was decided at touchstart)
  useEffect(() => {
    const el = boxRef.current; if (!el) return
    const block = (ev: TouchEvent) => { if (drag.current) ev.preventDefault() }
    el.addEventListener('touchmove', block, { passive: false })
    return () => el.removeEventListener('touchmove', block)
  }, [])
  // narrow screens: the timeline scrolls inside the card; open it a week before today rather than at day 0
  const ganttScroll = useRef<HTMLDivElement>(null)
  const [edgesRef, edges] = useScrollEdges<HTMLDivElement>()
  const scrollRef = useCallback((el: HTMLDivElement | null) => { ganttScroll.current = el; edgesRef(el) }, [edgesRef])
  useLayoutEffect(() => {
    const el = ganttScroll.current; if (!el || today === undefined || el.scrollWidth <= el.clientWidth + 1 || !laneW) return
    el.scrollLeft = Math.max(0, ((today - 7) / days) * laneW)
  }, [laneW > 0]) // eslint-disable-line react-hooks/exhaustive-deps
  useOutside([], () => setHover(null), hover !== null, { escape: true, keep: t => !!t.closest('[data-gantt-bar]') && !!boxRef.current?.contains(t) })
  const barEvents = (id: string) => ({
    'data-gantt-bar': id,
    onPointerDown: (e: ReactPointerEvent<HTMLElement>) => onDown(e, id), onPointerMove: (e: ReactPointerEvent<HTMLElement>) => onMove(e, id),
    onPointerUp: (e: ReactPointerEvent<HTMLElement>) => onUp(e, id), onPointerCancel: onCancel, onClickCapture: hold.bind.onClickCapture,
    onPointerEnter: (e: ReactPointerEvent<HTMLElement>) => { if (!isTouch(e)) setHover(id) },
    onPointerLeave: onMouseLeave(() => { setHover(null); hide() }),
    onContextMenu: (e: ReactMouseEvent) => { if (press.current || drag.current) e.preventDefault() },
    onKeyDown: (e: ReactKeyboardEvent) => onKey(e, id), onFocus: () => setHover(id), onBlur: () => setHover(null),
  })
  const onKey = (e: ReactKeyboardEvent, id: string) => {
    const step = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0
    if (!step) return
    e.preventDefault()
    if (e.shiftKey && byId[id].duration) moveTo(id, sched[id].s, sched[id].d + step); else moveTo(id, sched[id].s + step, sched[id].d)
  }
  const laneBg: CSSProperties = {
    backgroundImage: 'linear-gradient(90deg, var(--line) 1px, transparent 1px), linear-gradient(90deg, transparent 71.42%, color-mix(in srgb, var(--muted) 70%, transparent) 71.42%)',
    backgroundSize: `${(7 / days) * 100}% 100%`,
  }
  let order = 0 // entrance stagger

  return (
    <div className={cn('flex flex-col gap-2', className)}>
      <div className="flex flex-wrap justify-end gap-2">
        <Chip pressed={view.lk} onClick={() => setView(v => ({ ...v, lk: !v.lk }))}>Links</Chip>
        <Chip pressed={view.cp} onClick={() => setView(v => ({ ...v, cp: !v.cp }))}>Critical path</Chip>
        <Chip pressed={view.bl} onClick={() => setView(v => ({ ...v, bl: !v.bl }))}>Baseline</Chip>
        <Chip pressed={view.wl} onClick={() => setView(v => ({ ...v, wl: !v.wl }))}>Workload</Chip>
        <Button size="sm" className={TOUCH.tap36} onClick={() => setSched(initial)}>Reset</Button>
      </div>
      <div ref={boxRef} className={cn('relative overflow-hidden [--gd:10px] [--gs:30%] max-[700px]:[--gs:38%] max-sm:[--gd:15px] max-sm:[--gs:118px]', surface.card)}>
        <div ref={scrollRef} className="overflow-x-auto overscroll-x-contain">
        <div style={{ minWidth: `calc(var(--gs) + ${days} * var(--gd))` }}>
        <div className="grid h-11 grid-cols-[var(--gs)_1fr] border-b border-[var(--line)] text-xs text-[var(--fg3)]">
          <div className={cn('flex items-center pl-3', GANTT_PIN, 'bg-[var(--card)]')}>Task</div>
          <div className="relative border-l border-[var(--line)]">
            {Array.from({ length: Math.ceil(days / 7) }, (_, i) => <span key={i} className="absolute top-1.5 text-[11px] whitespace-nowrap" style={{ left: `calc(${pct(i * 7)} + 6px)` }}>{fdate(i * 7)}</span>)}
          </div>
        </div>
        <div className="relative" onPointerLeave={onMouseLeave(() => { hide(); setHover(null) })}>
          {phases.map(p => {
            const ts = p.tasks.map(t => ({ ...sched[t.id], t }))
            const s = Math.min(...ts.map(x => x.s)), e = Math.max(...ts.map(ganttEnd)), tot = ts.reduce((a, x) => a + x.d, 0) || 1
            const pr = ts.reduce((a, x) => a + x.d * x.t.progress, 0) / tot
            return (
              <Fragment key={p.id}>
                <div className="relative grid h-[38px] grid-cols-[var(--gs)_1fr] items-center bg-[color-mix(in_srgb,var(--muted)_55%,transparent)] hover:bg-[color-mix(in_srgb,var(--muted)_70%,transparent)]">
                  <div className={cn('flex min-w-0 items-center gap-2 pl-3 text-[13px] whitespace-nowrap', GANTT_PIN, 'bg-[color-mix(in_srgb,var(--muted)_55%,var(--card))]')}>
                    <DgChevron open={open[p.id]} label={p.name} onClick={() => setOpen(o => ({ ...o, [p.id]: !o[p.id] }))} />
                    <b className="font-semibold">{p.name}</b>
                    <span className="truncate text-xs text-[var(--fg3)] max-sm:hidden">{fdate(s)} to {fdate(e)} · {Math.round(pr * 100)}%</span>
                  </div>
                  <div className="relative h-full border-l border-[var(--line)]" style={laneBg}>
                    <div className="absolute top-[14px] h-[10px] rounded-[3px] bg-[color-mix(in_srgb,var(--fg3)_25%,var(--card))] transition-[left,width] duration-250 ease-[cubic-bezier(.22,1,.36,1)]"
                      style={{ left: pct(s), width: pct(Math.max(0.5, e - s)) }}>
                      <i className="absolute inset-y-0 left-0 rounded-[3px] bg-[var(--fg2)] opacity-60" style={{ width: `${pr * 100}%` }} />
                      <span className="absolute -top-[3px] left-0 h-[10px] w-0.5 rounded-[1px] bg-[var(--fg3)]" /><span className="absolute -top-[3px] right-0 h-[10px] w-0.5 rounded-[1px] bg-[var(--fg3)]" />
                    </div>
                  </div>
                </div>
                <Collapse open={open[p.id]} className={DG_COLLAPSE_STICKY}>
                  {p.tasks.map(t => {
                    const x = sched[t.id], ms = t.duration === 0, isCrit = crit.has(t.id), sl = slackOf(t.id), i = order++
                    const v = ganttEnd(x) - (t.start + t.duration), flipL = ms && x.s > days - 7
                    const color = t.color ?? 'var(--accent)', dragging = dragId === t.id
                    const dim = view.cp && !isCrit
                    return (
                      <div key={t.id} className="relative grid h-[38px] grid-cols-[var(--gs)_1fr] items-center hover:bg-[color-mix(in_srgb,var(--muted)_70%,transparent)]">
                        <div className={cn('flex min-w-0 items-center gap-2 pr-2.5 pl-10 text-[13px] whitespace-nowrap max-sm:pl-8', GANTT_PIN, 'bg-[var(--card)]')}>
                          <span className="truncate">{t.name}</span>
                          <Avatar name={people[t.owner] ?? t.owner} size={22} className="ml-auto max-[700px]:hidden" />
                        </div>
                        <div className="relative h-full border-l border-[var(--line)]" style={laneBg}>
                          <span className={cn('pointer-events-none absolute top-8 h-1 rounded-sm bg-[var(--fg3)] transition-opacity duration-200', view.bl ? 'opacity-45' : 'opacity-0')}
                            style={{ left: pct(t.start), width: pct(Math.max(0.4, t.duration)) }} />
                          <span title={sl ? `${sl} days of slack` : undefined} className={cn('pointer-events-none absolute top-[18px] h-0.5 bg-[length:6px_2px] bg-[linear-gradient(90deg,var(--fg3)_50%,transparent_50%)] transition-[opacity,left,width] duration-250', view.cp ? 'opacity-80' : 'opacity-0')}
                            style={{ left: pct(ganttEnd(x)), width: pct(isCrit ? 0 : sl) }} />
                          {ms ? (
                            <motion.span role="slider" tabIndex={0} aria-label={`${t.name} milestone, ${fdate(x.s)}`} aria-valuemin={0} aria-valuemax={days} aria-valuenow={x.s} aria-valuetext={fdate(x.s)}
                              className={cn('absolute top-[13px] -ml-[7px] h-3.5 w-3.5 cursor-grab rounded-[3px] shadow-[0_0_0_3px_var(--card)] transition-[left] duration-250 ease-[cubic-bezier(.22,1,.36,1)] select-none [-webkit-touch-callout:none]',
                                '[@media(pointer:coarse)]:top-[8px] [@media(pointer:coarse)]:-ml-[11.5px] [@media(pointer:coarse)]:h-[23px] [@media(pointer:coarse)]:w-[23px]',
                                view.cp && isCrit ? 'bg-[var(--bad)]' : 'bg-[var(--c3)]', dragging && 'cursor-grabbing !transition-none')}
                              style={{ left: pct(x.s), rotate: 45 }} initial={{ scale: 0 }} animate={inView ? { scale: 1 } : undefined} transition={{ duration: 0.45, delay: i * 0.05, ease: [0.22, 1, 0.36, 1] }}
                              {...barEvents(t.id)} />
                          ) : (
                            <motion.div role="slider" tabIndex={0} aria-label={`${t.name}, ${fdate(x.s)} to ${fdate(ganttEnd(x) - 1)}, ${x.d} days. Arrow keys move, Shift + arrows resize`}
                              aria-valuemin={0} aria-valuemax={days} aria-valuenow={x.s} aria-valuetext={`${fdate(x.s)}, ${x.d} days`}
                              className={cn('absolute flex origin-left cursor-grab items-center overflow-hidden rounded-md transition-[left,width,top,height,opacity,box-shadow] duration-250 ease-[cubic-bezier(.22,1,.36,1)] select-none [-webkit-touch-callout:none]',
                                'bg-[color-mix(in_srgb,var(--gc)_22%,var(--card))] shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--gc)_50%,transparent)]',
                                view.bl ? 'top-[5px] h-6' : 'top-2.5 h-[18px]', '[@media(pointer:coarse)]:top-[3px] [@media(pointer:coarse)]:h-8', dim && 'opacity-45',
                                view.cp && isCrit && '!shadow-[inset_0_0_0_1.5px_var(--bad),0_0_0_2px_color-mix(in_srgb,var(--bad)_18%,transparent)]',
                                dragging && 'z-[3] cursor-grabbing !shadow-[0_4px_14px_rgba(0,0,0,.18),inset_0_0_0_1px_var(--gc)] !transition-none')}
                              style={{ left: pct(x.s), width: pct(x.d), '--gc': color } as CSSProperties}
                              initial={{ scaleX: 0 }} animate={inView ? { scaleX: 1 } : undefined} transition={{ duration: 0.45, delay: i * 0.05, ease: [0.22, 1, 0.36, 1] }}
                              {...barEvents(t.id)}>
                              <i className="pointer-events-none absolute inset-y-0 left-0 bg-[var(--gc)] opacity-85" style={{ width: `${t.progress * 100}%` }} />
                              <span className="pointer-events-none relative z-[1] truncate px-2.5 text-xs font-medium text-[color-mix(in_srgb,var(--gc)_62%,var(--fg))]">{t.progress >= 1 ? '✓ ' : ''}{t.name}</span>
                              <span data-resize="1" aria-hidden className="group absolute inset-y-0 right-0 w-2 cursor-ew-resize touch-none [@media(pointer:coarse)]:w-5">
                                <span className="pointer-events-none absolute inset-y-1 right-[3px] w-0.5 rounded-[1px] bg-[var(--gc)] opacity-0 transition-opacity group-hover:opacity-90 [@media(pointer:coarse)]:right-[5px] [@media(pointer:coarse)]:w-[3px] [@media(pointer:coarse)]:opacity-80 [@media(pointer:coarse)]:shadow-[-4px_0_0_color-mix(in_srgb,var(--gc)_45%,transparent)]" />
                              </span>
                            </motion.div>
                          )}
                          <span className="pointer-events-none absolute top-3 text-[11px] font-medium whitespace-nowrap text-[var(--fg2)] transition-[left] duration-250 ease-[cubic-bezier(.22,1,.36,1)]"
                            style={{ left: flipL ? `calc(${pct(x.s)} - 14px)` : `calc(${pct(ms ? x.s : ganttEnd(x))} + ${ms ? 14 : 8}px)`, transform: flipL ? 'translateX(-100%)' : undefined }}>
                            {ms ? `${t.name} · ${fdate(x.s)}` : view.bl && v ? <span className={cn('ml-1.5 font-semibold', v > 0 ? 'text-[var(--bad)]' : 'text-[var(--ok)]')}>{v > 0 ? '+' : '−'}{Math.abs(v)}d</span> : null}
                          </span>
                        </div>
                      </div>
                    )
                  })}
                </Collapse>
              </Fragment>
            )
          })}
          {view.wl && (
            <>
              <div className="relative grid h-[38px] grid-cols-[var(--gs)_1fr] items-center bg-[color-mix(in_srgb,var(--muted)_55%,transparent)]">
                <div className={cn('flex items-center gap-1.5 pl-3 text-[13px]', GANTT_PIN, 'bg-[color-mix(in_srgb,var(--muted)_55%,var(--card))]')}><b className="font-semibold">Workload</b><span className="text-xs text-[var(--fg3)]">tasks per day</span></div>
                <div className="h-full border-l border-[var(--line)]" style={laneBg} />
              </div>
              {owners.map((o, oi) => (
                <div key={o} className="relative grid h-[38px] grid-cols-[var(--gs)_1fr] items-center">
                  <div className={cn('flex min-w-0 items-center gap-2 pl-10 text-[13px] whitespace-nowrap max-sm:pl-3', GANTT_PIN, 'bg-[var(--card)]')}><Avatar name={people[o] ?? o} size={22} /><span className="truncate">{people[o] ?? o}</span></div>
                  <div className="relative h-full border-l border-[var(--line)]" style={laneBg}>
                    {Array.from({ length: days }, (_, d) => {
                      if (d % 7 >= 5) return null
                      const n = tasks.filter(t => t.owner === o && t.duration > 0 && d >= sched[t.id].s && d < ganttEnd(sched[t.id])).length
                      if (!n) return null
                      return (
                        <motion.span key={d} title={`${n} task${n > 1 ? 's' : ''} on ${fdate(d)}`} initial={{ opacity: 0, scale: 0.6 }} animate={{ opacity: 1, scale: 1 }}
                          transition={{ duration: 0.25, delay: Math.min(0.5, (oi * days + d) * 0.006) }}
                          className={cn('absolute top-[9px] grid h-5 place-items-center rounded font-[family-name:var(--mono)] text-[11px] font-semibold', GANTT_CELL[Math.min(3, n) as 1 | 2 | 3])}
                          style={{ left: `calc(${pct(d)} + 1px)`, width: `calc(${pct(1)} - 2px)` }}>{n > 1 ? n : ''}</motion.span>
                      )
                    })}
                  </div>
                </div>
              ))}
            </>
          )}
          {/* overlay: dependency arrows and the today line, in lane coordinates */}
          <div ref={laneRef} className="pointer-events-none absolute inset-y-0 right-0 left-[var(--gs)] z-[2]">
            {laneW > 0 && (
              <svg width={laneW} height={bodyH} className="absolute top-0 left-0 overflow-visible" aria-hidden>
                <defs>
                  {[['a', 'var(--fg3)'], ['c', 'var(--bad)']].map(([k, c]) => (
                    <marker key={k} id={`${uid}${k}`} viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto">
                      <path d="M1 1L9 5L1 9" fill="none" stroke={c} strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
                    </marker>
                  ))}
                </defs>
                {arrows.map(a => {
                  const red = view.cp && a.isCrit
                  return <motion.path key={a.key} initial={false} animate={{ d: a.d, opacity: a.shown ? 1 : 0 }} transition={{ d: dragId ? { duration: 0 } : spring(0.1, 0.35), opacity: { duration: 0.15 } }}
                    fill="none" stroke={red ? 'var(--bad)' : 'var(--fg3)'} strokeWidth={red ? 1.8 : 1.3} markerEnd={`url(#${uid}${red ? 'c' : 'a'})`} />
                })}
              </svg>
            )}
            {today !== undefined && (
              <div className="absolute top-0 bottom-0 w-[1.5px] bg-[var(--accent)]" style={{ left: pct(today) }}>
                <span className="absolute -top-[26px] -left-5 rounded-full bg-[var(--accent)] px-1.5 py-0.5 text-[11px] leading-none font-semibold text-[var(--card)]">Today</span>
              </div>
            )}
          </div>
        </div>
        </div>
        </div>
        {/* task names are pinned on the left, so only the right edge fades */}
        <ScrollEdges left={false} right={edges.right} touched={edges.touched} hint="Swipe for more days" />
      </div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-[var(--fg2)]">
        <span className="inline-flex items-center gap-1.5"><i className="inline-block h-2 w-4 rounded-[3px] bg-[var(--fg2)] opacity-60" />Phase</span>
        <span className="inline-flex items-center gap-1.5"><i className="inline-block h-2.5 w-2.5 rotate-45 rounded-sm bg-[var(--c3)]" />Milestone</span>
        <span className="inline-flex items-center gap-1.5"><i className="inline-block h-3 w-0.5 bg-[var(--accent)]" />Today</span>
        <span className="text-[var(--fg3)] [@media(pointer:coarse)]:hidden">Hover a task to see its links</span>
        <span className="hidden text-[var(--fg3)] [@media(pointer:coarse)]:inline">Tap a task for its links · hold a bar to move it, drag its grip to resize</span>
        {view.cp && <><span className="inline-flex items-center gap-1.5"><i className="inline-block h-2 w-4 rounded-[3px] shadow-[inset_0_0_0_1.5px_var(--bad)]" />Critical path</span>
          <span className="inline-flex items-center gap-1.5"><i className="inline-block w-4 border-t-2 border-dashed border-[var(--fg3)]" />Slack</span></>}
        {view.bl && <span className="inline-flex items-center gap-1.5"><i className="inline-block h-1 w-4 rounded-sm bg-[var(--fg3)] opacity-50" />Baseline</span>}
        {final && <span className={cn('ml-auto', late > 0 ? 'text-[var(--bad)]' : 'text-[var(--fg2)]')}>
          {phases.find(p => p.id === byId[final].phase)?.name} {fdate(sched[final].s)}{late > 0 ? ` · ${late} days later than planned` : late < 0 ? ` · ${-late} days early` : ' · on plan'}</span>}
      </div>
      <PointerTooltip tip={tip} />
    </div>
  )
}

/* ════════════════════════════════════════════════════════════════════════════
 * Statechart renderer (shared by StateDiagram and StateMachine)
 * ══════════════════════════════════════════════════════════════════════════ */

export type StatechartNode = {
  id: string
  /** state/composite: x, y is the top-left corner; initial/final/history/end: the centre */
  kind: 'state' | 'composite' | 'initial' | 'final' | 'history' | 'end'
  x: number; y: number; w?: number; h?: number
  label?: string
  /** a second line: renders the compact, left-aligned station style */
  sub?: string
  dashed?: boolean; on?: boolean; was?: boolean; count?: number
  /** bump to replay the "entered" pulse */
  pulse?: number
}
export type StatechartEdge = { id: string; d: string; label?: string; lx?: number; ly?: number; anchor?: 'start' | 'middle' | 'end'; dashed?: boolean; live?: boolean }
export type StatechartDot = { key: string; edge: string; ms: number; ease?: 'linear' | 'inOut'; onDone?: () => void }

/** A dot that travels a path once (motion's frame loop, positioned by attribute, no re-renders), then calls onDone. */
function DgDot({ path, ms, ease, onDone }: { path: () => SVGPathElement | null | undefined; ms: number; ease?: 'linear' | 'inOut'; onDone?: () => void }) {
  const ref = useRef<SVGCircleElement>(null)
  const run = useRef<{ p: SVGPathElement; L: number; t0: number } | null>(null)
  const [active, setActive] = useState(true)
  const put = (u: number) => {
    const r = run.current, c = ref.current; if (!r || !c) return
    const e = ease === 'inOut' ? (u < 0.5 ? 2 * u * u : 1 - (-2 * u + 2) ** 2 / 2) : u, q = r.p.getPointAtLength(r.L * e)
    c.setAttribute('cx', String(q.x)); c.setAttribute('cy', String(q.y))
  }
  useLayoutEffect(() => {
    const p = path()
    if (!p || !ref.current) { setActive(false); onDone?.(); return }
    run.current = { p, L: p.getTotalLength(), t0: performance.now() }
    put(0); ref.current.setAttribute('opacity', '1')
  }, []) // eslint-disable-line react-hooks/exhaustive-deps
  useFrameLoop(active, (_, now) => {
    const r = run.current; if (!r) return
    const u = Math.min(1, (now - r.t0) / ms); put(u)
    if (u >= 1) { setActive(false); onDone?.() }
  })
  return <circle ref={ref} r={5.5} fill="var(--accent)" stroke="var(--card)" strokeWidth={1.5} opacity={0} />
}

function DgStateNode({ n, reduce, index }: { n: StatechartNode; reduce: boolean; index: number }) {
  const ref = useRef<SVGGElement>(null)
  useEffect(() => { if (n.pulse && !reduce) play(ref.current, { scale: [1, 1.06, 1] }, { duration: 0.35 }) }, [n.pulse, reduce])
  const w = n.w ?? 110, h = n.h ?? 44
  const box = 'transition-[fill,stroke] duration-250 [stroke-width:1.5]'
  let body: ReactNode = null
  if (n.kind === 'state') {
    body = (
      <>
        <rect x={n.x} y={n.y} width={w} height={h} rx={n.sub ? 10 : 12} strokeDasharray={n.dashed ? '4 3' : undefined}
          className={cn(box, n.on ? 'fill-[color-mix(in_srgb,var(--accent)_13%,var(--card))] stroke-[var(--accent)] [stroke-width:2.2]' : n.was ? 'fill-[var(--card)] stroke-[color-mix(in_srgb,var(--accent)_50%,var(--line2))]' : 'fill-[var(--card)] stroke-[var(--line2)]')} />
        {n.sub ? (
          <>
            <text x={n.x + 10} y={n.y + 19} className="fill-[var(--fg)] [font:600_12px_var(--font)]">{n.label}</text>
            <text x={n.x + 10} y={n.y + 34} className="fill-[var(--fg3)] [font:11px_var(--font)]">{n.sub}</text>
          </>
        ) : <text x={n.x + w / 2} y={n.y + h / 2} textAnchor="middle" dominantBaseline="central" className="pointer-events-none fill-[var(--fg)] [font:600_13px_var(--font)]">{n.label}</text>}
        {!!n.count && (
          <g transform={`translate(${n.x + w - 2},${n.y + 2})`}>
            <circle r={9} className="fill-[var(--accent)]" />
            <text y={3.5} textAnchor="middle" className="fill-white [font:700_10px_var(--font)]">{n.count}</text>
          </g>
        )}
      </>
    )
  } else if (n.kind === 'initial') body = <circle cx={n.x} cy={n.y} r={7} className={cn('transition-[fill] duration-250', n.on ? 'fill-[var(--accent)]' : 'fill-[var(--fg)]')} />
  else if (n.kind === 'final' || n.kind === 'end') body = (
    <>
      <circle cx={n.x} cy={n.y} r={10} className={n.kind === 'end' ? 'fill-[var(--fg)]' : 'fill-none stroke-[var(--fg)] [stroke-width:1.5]'} />
      <circle cx={n.x} cy={n.y} r={n.kind === 'end' ? 5 : 6} className={cn('transition-[fill] duration-250', n.kind === 'end' ? 'fill-[var(--bg)]' : n.on ? 'fill-[var(--accent)]' : 'fill-[var(--fg)]')} />
    </>
  )
  else if (n.kind === 'history') body = (
    <>
      <circle cx={n.x} cy={n.y} r={10} className="fill-[var(--card)] stroke-[var(--fg)] [stroke-width:1.5]" />
      <text x={n.x} y={n.y} textAnchor="middle" dominantBaseline="central" className="fill-[var(--fg)] [font:700_11px_var(--font)]">H</text>
    </>
  )
  return (
    <motion.g ref={ref} style={{ transformBox: 'fill-box', transformOrigin: 'center' }} initial={{ opacity: 0 }} whileInView={{ opacity: 1 }} viewport={{ once: true }} transition={{ duration: 0.35, delay: index * 0.03 }}>
      {body}
    </motion.g>
  )
}

/**
 * SVG statechart: composite states, states, pseudo states (initial, final, history), labelled transitions,
 * and dots that travel along a transition (each dot calls onDone when it arrives). Pure renderer: pass the
 * geometry and flags; StateDiagram and StateMachine drive it. It scales down to `minWidth` and scrolls sideways
 * below that; on phones and touch screens it stays at full size (labels stay ≥ 11px) and shows a swipe hint.
 */
export function Statechart({ width, height, nodes, edges, dots = [], label, minWidth = 760, className }:
  { width: number; height: number; nodes: StatechartNode[]; edges: StatechartEdge[]; dots?: StatechartDot[]; label: string; minWidth?: number; className?: string }) {
  const paths = useRef<Record<string, SVGPathElement | null>>({})
  const uid = dgSafeId(useId())
  const reduce = !!useReducedMotion()
  const [scrollRef, scroll] = useScrollEdges<HTMLDivElement>()
  return (
    <div className="relative min-w-0 overflow-hidden rounded-[var(--r-lg)]">
    <div ref={scrollRef} className={cn('overflow-x-auto overscroll-x-contain rounded-[var(--r-lg)] border border-[var(--line)]', DG_DOTS, className)}>
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={label} className="block h-auto w-full max-sm:!min-w-[var(--sc-phone)] [@media(pointer:coarse)]:!min-w-[var(--sc-phone)]" style={{ minWidth, '--sc-phone': `${width}px` } as CSSProperties}>
        <defs>
          {[['n', 'var(--fg3)'], ['l', 'var(--accent)']].map(([k, c]) => (
            <marker key={k} id={`${uid}${k}`} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto">
              <path d="M1 1L9 5L1 9" fill="none" stroke={c} strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
            </marker>
          ))}
        </defs>
        {nodes.filter(n => n.kind === 'composite').map(n => (
          <g key={n.id}>
            <rect x={n.x} y={n.y} width={n.w} height={n.h} rx={16}
              className={cn('transition-[fill,stroke] duration-250 [stroke-width:1.5]', n.on ? 'fill-[color-mix(in_srgb,var(--accent)_5%,transparent)] stroke-[var(--accent)]' : 'fill-[color-mix(in_srgb,var(--muted)_45%,transparent)] stroke-[var(--line2)]')} />
            <text x={n.x + 14} y={n.y + 22} className="fill-[var(--fg2)] [font:600_12px_var(--font)]">{n.label}</text>
          </g>
        ))}
        <g>
          {edges.map(e => (
            <g key={e.id}>
              <path ref={el => { paths.current[e.id] = el }} d={e.d} fill="none" strokeDasharray={e.dashed ? '5 4' : undefined} markerEnd={`url(#${uid}${e.live ? 'l' : 'n'})`}
                className={cn('transition-[stroke,stroke-width] duration-200', e.live ? 'stroke-[var(--accent)] [stroke-width:2.2]' : 'stroke-[var(--fg3)] [stroke-width:1.4]')} />
              {e.label && <text x={e.lx} y={e.ly} textAnchor={e.anchor ?? 'middle'}
                className={cn('stroke-[var(--bg)] [font:500_11px_var(--mono)] [paint-order:stroke] [stroke-width:4px] transition-[fill]', e.live ? 'fill-[var(--accent)]' : 'fill-[var(--fg2)]')}>{e.label}</text>}
            </g>
          ))}
        </g>
        {nodes.filter(n => n.kind !== 'composite').map((n, i) => <DgStateNode key={n.id} n={n} reduce={reduce} index={i} />)}
        <g>{dots.map(d => <DgDot key={d.key} path={() => paths.current[d.edge]} ms={d.ms} ease={d.ease} onDone={d.onDone} />)}</g>
      </svg>
    </div>
    <ScrollEdges {...scroll} fade="bg" className="inset-y-px" />
    </div>
  )
}

function DgPlayButton({ playing, onClick, label = 'Auto-play' }: { playing: boolean; onClick: () => void; label?: string }) {
  return (
    <Button size="icon-sm" aria-label={label} title={label} aria-pressed={playing} onClick={onClick} className={cn('!h-[30px] !w-[30px]', TOUCH.tap36)}>
      <Icon name={playing ? 'pause' : 'play'} size={13} filled />
    </Button>
  )
}
const dgSideLabel = 'text-xs text-[var(--fg3)]'

/* ════════════════════════════════════════════════════════════════════════════
 * State diagram (UML)
 * ══════════════════════════════════════════════════════════════════════════ */

export type DiagramState = {
  label?: string
  kind?: 'initial' | 'final'
  /** [x, y, w, h] of a simple state */
  box?: [number, number, number, number]
  /** [x, y, w, h] of a composite state (its substates name it as `parent`) */
  composite?: [number, number, number, number]
  /** centre of an initial or final pseudo state */
  at?: [number, number]
  parent?: string
}
export type DiagramTransition = {
  event: string
  /** a state, or a composite to fire from any of its substates */
  from: string
  /** a state, or 'H' for the composite's history */
  to: string
  guard?: string; action?: string
  /** SVG path of the arrow */
  d: string
  /** [x, y, text, anchor] */
  label: [number, number, string, ('start' | 'middle' | 'end')?]
  /** relative likelihood during auto-play (default 1) */
  weight?: number
}

/**
 * Interactive UML state diagram. Fire the events available from the current state (buttons, or auto-play);
 * a dot walks the transition, composites light while any substate is current, and a shallow history state
 * returns to the substate you left. Shows the current state, its context and a history log. Reset restarts.
 */
export function StateDiagram({ states, transitions, initial, history, width = 940, height = 340, interval = 1600, className }:
  { states: Record<string, DiagramState>; transitions: DiagramTransition[]; initial: string
    history?: { of: string; at: [number, number]; default: string; d: string }; width?: number; height?: number; interval?: number; className?: string }) {
  const M = useRef({ cur: initial, hist: history?.default ?? '', log: [] as { k: number; ev: string; from: string; to: string; guard?: string; act?: string }[] })
  const [, force] = useReducer((x: number) => x + 1, 0)
  const [live, setLive] = useState<number | null>(null)
  const [hLive, setHLive] = useState(false)
  const [dots, setDots] = useState<StatechartDot[]>([])
  const [pulse, setPulse] = useState(0)
  const [auto, setAuto] = useState(false)
  const busy = useRef(false)
  const box = useRef<HTMLDivElement>(null)
  const visible = useInView(box, { amount: 0.2 })
  const reduce = useReducedMotion()
  const { cur, hist, log } = M.current
  const within = (s: string, anc: string) => s === anc || states[s]?.parent === anc
  const nice = (s: string) => states[s]?.label ?? (states[s]?.kind === 'final' ? 'Final' : states[s]?.kind === 'initial' ? 'Start' : s)
  const available = transitions.map((t, i) => [t, i] as const).filter(([t]) => within(cur, t.from))
  const resumable = transitions.some(t => t.to === 'H' && within(cur, t.from))
  const travel = (edge: string, ms: number) => reduce ? Promise.resolve() : new Promise<void>(res => {
    const key = `${edge}-${performance.now()}`
    setDots(ds => [...ds, { key, edge, ms, ease: 'inOut', onDone: () => { setDots(x => x.filter(d => d.key !== key)); res() } }])
  })
  const fire = async (i: number) => {
    const t = transitions[i], m = M.current
    if (busy.current || !within(m.cur, t.from)) return
    busy.current = true
    const from = m.cur
    if (history && within(m.cur, history.of)) m.hist = m.cur // leaving or moving inside the composite: remember the substate
    setLive(i); await travel(`t${i}`, 650)
    let to = t.to
    if (to === 'H' && history) { to = m.hist; setHLive(true); if (m.hist === history.default) await travel('hdef', 350); setHLive(false) }
    setLive(null)
    m.cur = to; m.log = [{ k: performance.now(), ev: t.event, from, to, guard: t.guard, act: t.action }, ...m.log].slice(0, 12)
    busy.current = false; setPulse(p => p + 1); force()
  }
  const reset = () => { M.current = { cur: initial, hist: history?.default ?? '', log: [] }; setPulse(0); force() }
  // auto-play: one interval per (auto, visible, interval); each tick reads the latest props and fire() through a ref
  const step = useRef(() => {})
  useLayoutEffect(() => {
    step.current = () => {
      const m = M.current
      if (busy.current) return
      if (states[m.cur]?.kind === 'final') { M.current = { ...m, cur: initial, hist: history?.default ?? '' }; force(); return }
      const av = transitions.map((t, i) => [t, i] as const).filter(([t]) => within(m.cur, t.from))
      if (!av.length) return
      const w = av.map(([t]) => t.weight ?? 1)
      let r = Math.random() * w.reduce((a, b) => a + b, 0)
      fire((av.find((_, k) => (r -= w[k]) <= 0) ?? av[0])[1])
    }
  })
  useEffect(() => {
    if (!auto || !visible) return
    const id = setInterval(() => step.current(), interval)
    return () => clearInterval(id)
  }, [auto, visible, interval])

  const nodes: StatechartNode[] = []
  Object.entries(states).forEach(([id, s]) => {
    if (s.composite) nodes.push({ id, kind: 'composite', x: s.composite[0], y: s.composite[1], w: s.composite[2], h: s.composite[3], label: s.label, on: within(cur, id) })
  })
  if (history) nodes.push({ id: '__h', kind: 'history', x: history.at[0], y: history.at[1] })
  Object.entries(states).forEach(([id, s]) => {
    if (s.box) nodes.push({ id, kind: 'state', x: s.box[0], y: s.box[1], w: s.box[2], h: s.box[3], label: s.label, on: cur === id, was: resumable && hist === id, pulse: cur === id ? pulse : 0 })
    else if (s.kind && s.at) nodes.push({ id, kind: s.kind, x: s.at[0], y: s.at[1], on: cur === id })
  })
  const edges: StatechartEdge[] = [
    ...(history ? [{ id: 'hdef', d: history.d, dashed: true, live: hLive }] : []),
    ...transitions.map((t, i) => ({ id: `t${i}`, d: t.d, label: t.label[2], lx: t.label[0], ly: t.label[1], anchor: t.label[3], live: live === i })),
  ]
  const where = states[cur]?.parent ? `inside ${nice(states[cur].parent!)}` : resumable ? `history remembers ${nice(hist)}` : states[cur]?.kind === 'final' ? 'terminated · press Reset' : ''
  return (
    <div ref={box} className={cn('flex flex-col gap-3', className)}>
      <div className="flex justify-end gap-1.5">
        <DgPlayButton playing={auto} onClick={() => setAuto(a => !a)} />
        <Button size="sm" className={TOUCH.tap36} onClick={reset}>Reset</Button>
      </div>
      <div className="grid gap-4 min-[900px]:grid-cols-[minmax(0,1fr)_240px]">
        <Statechart width={width} height={height} nodes={nodes} edges={edges} dots={dots} label="State diagram" />
        <aside className="flex flex-col gap-4">
          <div className={cn('flex flex-col gap-0.5 p-3', surface.md)} aria-live="polite">
            <span className={dgSideLabel}>Current state</span>
            <AnimatePresence mode="popLayout" initial={false}>
              <motion.b key={cur} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} transition={spring(0.2, 0.3)} className="text-lg font-semibold tracking-tight">{nice(cur)}</motion.b>
            </AnimatePresence>
            <span className={cn(dgSideLabel, 'min-h-[17px]')}>{where}</span>
          </div>
          <div>
            <span className={dgSideLabel}>Events you can fire</span>
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {available.length ? available.map(([t, i]) => <Button key={i} size="sm" className={cn('font-[family-name:var(--mono)] !text-xs', TOUCH.tap36)} onClick={() => fire(i)}>{t.event}</Button>)
                : <span className={dgSideLabel}>No events from here</span>}
            </div>
          </div>
          <div>
            <span className={dgSideLabel}>History</span>
            <div className="mt-1.5 flex flex-col gap-1 text-xs">
              {log.length ? (
                <AnimatePresence initial={false}>
                  {log.slice(0, 5).map(x => (
                    <motion.div key={x.k} layout initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={spring(0.2, 0.3)}
                      className="flex flex-col rounded-[var(--r-md)] bg-[var(--muted)] px-2 py-1.5">
                      <b className="font-[family-name:var(--mono)] font-semibold">{x.ev}</b>
                      <span className="text-[var(--fg3)]">{nice(x.from)} → {nice(x.to)}{x.guard ? ` · [${x.guard}]` : ''}{x.act ? ` · / ${x.act}` : ''}</span>
                    </motion.div>
                  ))}
                </AnimatePresence>
              ) : <span className={dgSideLabel}>Fire an event to start</span>}
            </div>
          </div>
        </aside>
      </div>
    </div>
  )
}

/* ════════════════════════════════════════════════════════════════════════════
 * State machine: a live workflow engine plus its statechart
 * ══════════════════════════════════════════════════════════════════════════ */

/** One run of a workflow machine. */
export type WorkflowJob = {
  id: number; type: string; name: string; data: Record<string, number | boolean>; done: boolean; rejected?: boolean; tokens: WorkflowToken[]
  /** the main token's current state ('done' once finished) */
  state: string
  /** start and end on the engine clock (seconds) */
  t0: number; t1?: number
  /** what the job has used so far: agent work is metered at WorkflowEngineOptions.meter per second */
  usage: { tokens: number; usd: number }
  /** every line it has travelled */
  lines: Set<string>
  /** what it did, in order (work, waits and moves) on the engine clock; the open one has t1 null */
  segs: WorkflowSegment[]
}
/** A stretch of a job's timeline: an agent working, a wait (orchestrator, queue, human) or a move along a line. */
export type WorkflowSegment = { kind: 'work' | 'wait' | 'move'; label: string; line: string; t0: number; t1: number | null; /** from a forked branch */ sub: boolean }
/** Where a job is: one token per branch. While `move` is set it travels `line` from station `from` to `to`. */
export type WorkflowToken = {
  uid: number; job: WorkflowJob; state: string; parent: WorkflowToken | null; line: string
  phase: 'move' | 'work' | 'route' | 'queue' | 'hitl' | 'join'
  /** seconds left in this phase */
  t: number
  move: { from: string; to: string; dur: number } | null
  next?: string; kids: number; cb?: (() => void) | null; seg: WorkflowSegment | null
}
export type WorkflowState = {
  /** [line, station]: the station name is the agent; agents work one job at a time */
  at: [string, string]
  label: string
  /** seconds of agent work */
  work?: number
  /** orchestrators route instantly */
  orch?: boolean
  /** waits for a human (approved by policy after `hitlWait` seconds, or resolve() it) */
  hitl?: boolean
  /** next state, a guard function, 'back' (a forked branch returning) or 'done' */
  next?: string | ((job: WorkflowJob) => string)
  /** fork into these branch states, then continue at `join` once all are back */
  fork?: string[]; join?: string
  /** decision name and its labelled outcomes (for the chart) */
  guard?: string; to?: [string, string][]
}
export type WorkflowMachine = {
  name: string; short?: string; event: string; start: string; states: Record<string, WorkflowState>
  /** follow-up event queued when a job finishes */
  emits?: (job: WorkflowJob) => string | null
  init?: (seq: number) => Record<string, number | boolean>
  title?: (job: WorkflowJob) => string
}
/** A queued trigger event; `from` is the line it came from (for colour). */
export type WorkflowQueued = { id: number; ev: string; from: string }
export type WorkflowEvent =
  | { kind: 'spawn' | 'enter' | 'move' | 'guard' | 'join' | 'done' | 'trigger' | 'hitl' | 'hitl-done'; job: WorkflowJob; token: WorkflowToken; state: string; to?: string; guard?: string; result?: string; ev?: string }
  /** an event joined the queue: fired by hand, by the lap timer, by the intake timer, or emitted by a finished job */
  | { kind: 'queued'; job?: undefined; ev: string; from: string; cause: 'fire' | 'lap' | 'intake' | 'emit' }
export type WorkflowEngineOptions = {
  /** jobs that may run at once (default 3) */
  maxJobs?: number
  /** simulation speed: tick(dt) advances the clock by dt × speed (default 1) */
  speed?: number
  /** fire the next machine in `order` after lap[0] seconds, then every lap[1] (default [1.2, 7]; lap[1] = 0 turns it off) */
  lap?: [number, number]
  /** a trigger event that also arrives on its own every 9–15 s, first after 6 s (default 'request.received'; null turns it off) */
  intake?: string | null
  /** seconds a human-in-the-loop state waits before it is approved by policy (default 4) */
  hitlWait?: number
  /** seconds a token takes along `line` from station `from` to `to` (default 1) */
  travelTime?: (line: string, from: string, to: string) => number
  /** usage metered per second of agent work (default none) */
  meter?: { tokens: number; usd: number }
  /** the line a fired machine's event is drawn from (default its start state's line) */
  source?: (type: string) => string
  /** queue length; the oldest event is dropped beyond it (default 8) */
  queueMax?: number
}

/**
 * Token-based workflow engine. Events queue until a job slot frees up; each job walks its machine's states,
 * agents (stations with `work`) hold one token at a time, guards pick the next state, forks split into
 * branch tokens that join back, and human-in-the-loop states wait in `waiting` until resolve() or a timeout.
 * Every job keeps a segment timeline and usage meters. Drive it with tick(seconds) (from useFrameLoop);
 * subscribe() to every transition. StateMachine and AgentTransitMap both run on it.
 */
export class WorkflowEngine {
  machines: Record<string, WorkflowMachine>; order: string[]
  jobs: WorkflowJob[] = []; queue: WorkflowQueued[] = []; busy: Record<string, WorkflowToken> = {}
  /** tokens waiting for a human, oldest first */
  waiting: WorkflowToken[] = []
  maxJobs: number; speed: number; paused = false; hitl = true; hitlWait: number; queueMax: number
  /** simulated seconds since the engine started (stops while paused) */
  clock = 0
  /** events dropped because the queue was full */
  dropped = 0
  lap: [number, number]; intake: string | null
  private seq = 0; private uid = 0; private evIdx = 0; private lapT: number; private intakeT = 6
  private travelTime: (line: string, from: string, to: string) => number
  private meter: { tokens: number; usd: number }; private source: (type: string) => string
  private subs = new Set<(e: WorkflowEvent) => void>()
  constructor(machines: Record<string, WorkflowMachine>, order: string[], o: WorkflowEngineOptions = {}) {
    this.machines = machines; this.order = order
    this.maxJobs = o.maxJobs ?? 3; this.speed = o.speed ?? 1; this.hitlWait = o.hitlWait ?? 4; this.queueMax = o.queueMax ?? 8
    this.lap = o.lap ?? [1.2, 7]; this.lapT = this.lap[0]; this.intake = o.intake === undefined ? 'request.received' : o.intake
    this.travelTime = o.travelTime ?? (() => 1); this.meter = o.meter ?? { tokens: 0, usd: 0 }
    this.source = o.source ?? (t => { const m = this.machines[t]; return m.states[m.start].at[0] })
  }
  subscribe(f: (e: WorkflowEvent) => void) { this.subs.add(f); return () => { this.subs.delete(f) } }
  private emit(e: WorkflowEvent) { this.subs.forEach(f => f(e)) }
  /** The machine whose trigger is `ev`. */
  typeOf(ev: string) { return Object.keys(this.machines).find(k => this.machines[k].event === ev) }
  /** How far a moving token is along its move, 0…1 (1 when it isn't moving). */
  progress(tk: WorkflowToken) { return tk.move && tk.move.dur > 0 ? clamp(1 - tk.t / tk.move.dur, 0, 1) : 1 }
  private enqueue(ev: string, from: string, cause: 'fire' | 'lap' | 'intake' | 'emit') {
    if (this.queue.length >= this.queueMax) { this.queue.shift(); this.dropped++ }
    this.queue.push({ id: ++this.uid, ev, from }); this.emit({ kind: 'queued', ev, from, cause })
  }
  /** Queue the trigger event of a machine (defaults to the next one in `order`). */
  fire(type?: string, cause: 'fire' | 'lap' = 'fire') {
    const t = type ?? this.order[this.evIdx++ % this.order.length]
    if (this.machines[t]) this.enqueue(this.machines[t].event, this.source(t), cause)
  }
  private slots() { return this.maxJobs - this.jobs.filter(j => !j.done).length }
  private st(tk: WorkflowToken, s = tk.state) { return this.machines[tk.job.type].states[s] }
  private token(job: WorkflowJob, state: string, parent: WorkflowToken | null): WorkflowToken {
    return { uid: ++this.uid, job, state, parent, line: this.machines[job.type].states[state].at[0], phase: 'route', t: 0, move: null, kids: 0, seg: null }
  }
  private seg(tk: WorkflowToken, kind: WorkflowSegment['kind'], label: string) {
    const last = tk.seg
    if (last && last.kind === kind && last.label === label && last.line === tk.line) return
    if (last) last.t1 = this.clock
    tk.seg = { kind, label, line: tk.line, t0: this.clock, t1: null, sub: !!tk.parent }; tk.job.segs.push(tk.seg)
  }
  private closeSeg(tk: WorkflowToken) { if (tk.seg) { tk.seg.t1 = this.clock; tk.seg = null } }
  private spawn(type: string) {
    const m = this.machines[type], seq = ++this.seq, line = m.states[m.start].at[0]
    const job: WorkflowJob = { id: seq, type, name: m.name, data: { attempt: 0, ...m.init?.(seq) }, done: false, tokens: [], state: m.start, t0: this.clock, usage: { tokens: 0, usd: 0 }, lines: new Set([line]), segs: [] }
    if (m.title) job.name = m.title(job)
    const tk = this.token(job, m.start, null)
    job.tokens.push(tk); this.jobs.unshift(job)
    this.emit({ kind: 'spawn', job, token: tk, state: m.start }); this.enter(tk, m.start)
  }
  private enter(tk: WorkflowToken, state: string) {
    const st = this.st(tk, state); tk.state = state; tk.move = null
    if (!tk.parent) tk.job.state = state
    this.emit({ kind: 'enter', job: tk.job, token: tk, state })
    if (st.hitl && this.hitl) { tk.phase = 'hitl'; tk.t = this.hitlWait; this.seg(tk, 'wait', 'Waiting for human approval'); this.waiting.push(tk); this.emit({ kind: 'hitl', job: tk.job, token: tk, state }); return }
    if (st.orch) { tk.phase = 'route'; tk.t = 0.45; this.seg(tk, 'wait', st.label); return }
    if (st.work) { tk.phase = 'work'; tk.t = st.work; this.seg(tk, 'work', st.label); return }
    tk.phase = 'route'; tk.t = 0.3; this.seg(tk, 'wait', st.label)
  }
  private free(tk: WorkflowToken) { const st = this.st(tk); if (st.work && this.busy[st.at[1]] === tk) delete this.busy[st.at[1]] }
  private travel(tk: WorkflowToken, line: string, from: string, to: string, toState: string, cb: () => void) {
    const dur = Math.max(0, this.travelTime(line, from, to))
    tk.phase = 'move'; tk.line = line; tk.t = dur; tk.move = { from, to, dur }; tk.cb = cb
    this.seg(tk, 'move', `${line.charAt(0).toUpperCase()}${line.slice(1)} line`)
    this.emit({ kind: 'move', job: tk.job, token: tk, state: tk.state, to: toState })
  }
  private decide(tk: WorkflowToken) {
    const j = tk.job, st = this.st(tk)
    if (st.fork && !tk.parent) {
      tk.phase = 'join'; tk.kids = st.fork.length; this.seg(tk, 'wait', 'Waiting for reviews to join')
      st.fork.forEach(b => { const kid = this.token(j, tk.state, tk); kid.line = this.machines[j.type].states[b].at[0]; j.tokens.push(kid); this.go(kid, b) })
      return
    }
    const nx = typeof st.next === 'function' ? st.next(j) : st.next ?? 'done'
    if (nx === 'back' && tk.parent) {
      const p = tk.parent, pst = this.st(p); this.free(tk)
      this.travel(tk, tk.line, st.at[1], pst.at[1], pst.join!, () => {
        this.closeSeg(tk); j.tokens = j.tokens.filter(x => x !== tk)
        if (--p.kids === 0) { this.emit({ kind: 'join', job: j, token: p, state: p.state }); this.go(p, pst.join!) }
      })
      return
    }
    if (st.guard) this.emit({ kind: 'guard', job: j, token: tk, state: tk.state, guard: st.guard, result: nx })
    if (nx === 'done') { this.finish(tk); return }
    this.go(tk, nx)
  }
  private go(tk: WorkflowToken, state: string) {
    const st = this.st(tk, state); tk.next = state
    if (st.work && this.busy[st.at[1]] && this.busy[st.at[1]] !== tk) { tk.phase = 'queue'; this.seg(tk, 'wait', `Waiting for ${st.at[1]}`); return }
    if (st.work) this.busy[st.at[1]] = tk
    const cur = this.st(tk); this.free(tk)
    tk.job.lines.add(st.at[0])
    this.travel(tk, st.at[0], cur.at[1], st.at[1], state, () => this.enter(tk, state))
  }
  private finish(tk: WorkflowToken) {
    const j = tk.job; this.free(tk); this.closeSeg(tk)
    this.emit({ kind: 'move', job: j, token: tk, state: tk.state, to: 'done' })
    j.done = true; j.t1 = this.clock; j.state = 'done'
    this.emit({ kind: 'done', job: j, token: tk, state: 'done' })
    const ev = j.rejected ? null : this.machines[j.type].emits?.(j)
    if (ev) { this.emit({ kind: 'trigger', job: j, token: tk, state: 'done', ev }); this.enqueue(ev, tk.line, 'emit') }
  }
  /** Answer a token in `waiting`: approve, reject (the job ends and emits nothing) or 'timeout' (approved by policy). */
  resolve(tk: WorkflowToken, how: 'approve' | 'reject' | 'timeout') {
    const i = this.waiting.indexOf(tk); if (i < 0) return
    this.waiting.splice(i, 1)
    if (how === 'reject') { tk.job.rejected = true; this.seg(tk, 'wait', 'Rejected by a human'); this.emit({ kind: 'hitl-done', job: tk.job, token: tk, state: tk.state, result: 'rejected' }); this.finish(tk); return }
    this.seg(tk, 'work', how === 'timeout' ? 'Auto-approved by policy (timeout)' : 'Approved by a human')
    this.emit({ kind: 'hitl-done', job: tk.job, token: tk, state: tk.state, result: how === 'timeout' ? 'auto-approved' : 'approved' })
    tk.phase = 'work'; tk.t = 0.4
  }
  /** Human in the loop on or off; turning it off approves everything waiting. */
  setHitl(on: boolean) { this.hitl = on; if (!on) this.waiting.slice().forEach(tk => this.resolve(tk, 'timeout')) }
  /** Advance the simulation by `dt` seconds (× speed; nothing while paused). */
  tick(dt: number) {
    if (this.paused) return
    dt *= this.speed; this.clock += dt
    if (this.lap[1] > 0) { this.lapT -= dt; if (this.lapT <= 0) { this.lapT += this.lap[1]; this.fire(undefined, 'lap') } }
    if (this.intake) {
      this.intakeT -= dt
      const t = this.intakeT <= 0 ? this.typeOf(this.intake) : undefined
      if (this.intakeT <= 0) this.intakeT = 9 + Math.random() * 6
      if (t) this.enqueue(this.intake, this.source(t), 'intake')
    }
    while (this.queue.length && this.slots() > 0) { const t = this.typeOf(this.queue.shift()!.ev); if (t) this.spawn(t) }
    this.jobs.forEach(j => {
      if (j.done) return
      j.tokens.slice().forEach(tk => {
        if (tk.phase === 'move') { tk.t -= dt; if (tk.t <= 0) { const cb = tk.cb; tk.cb = null; tk.move = null; cb?.() } }
        else if (tk.phase === 'work' || tk.phase === 'route') {
          tk.t -= dt
          if (tk.phase === 'work') { j.usage.tokens += this.meter.tokens * dt; j.usage.usd += this.meter.usd * dt }
          if (tk.t <= 0) this.decide(tk)
        }
        else if (tk.phase === 'queue') { const st = this.st(tk, tk.next); if (!this.busy[st.at[1]]) this.go(tk, tk.next!) }
        else if (tk.phase === 'hitl') { tk.t -= dt; if (tk.t <= 0) this.resolve(tk, 'timeout') }
      })
    })
    while (this.jobs.length > 6 && this.jobs[this.jobs.length - 1].done) this.jobs.pop()
  }
}

/**
 * The agent-team workflows used by the StateMachine demo and AgentTransitMap: lines are agent teams, stations are
 * agents and orchestrators (the transit map draws exactly these stations). Pass them to WorkflowEngine or StateMachine.
 */
export const AGENT_WORKFLOWS: Record<string, WorkflowMachine> = {
  feature: { name: 'Feature spec', event: 'doc.changed', start: 'index', emits: () => 'deploy.finished', states: {
    index: { at: ['memory', 'Index'], label: 'Change detected', next: 'recall' },
    recall: { at: ['memory', 'Recall'], work: 1.0, label: 'Recall: load context', next: 'route' },
    route: { at: ['memory', 'Research'], orch: true, label: 'Research routes to Analyst', next: 'analyst' },
    analyst: { at: ['research', 'Analyst'], work: 2.2, label: 'Analyst: write spec', next: 'product' },
    product: { at: ['research', 'Product'], orch: true, label: 'Product forks review', fork: ['grade', 'risk'], join: 'deploy' },
    grade: { at: ['evals', 'Grader'], work: 1.8, label: 'Grader: run evals', next: 'back' },
    risk: { at: ['approvals', 'Risk'], work: 1.4, label: 'Risk: check exposure', next: 'back' },
    deploy: { at: ['research', 'Deploy'], work: 1.0, label: 'Deploy: ship', next: 'done' } } },
  purchase: { name: 'Purchase', event: 'invoice.received', start: 'index', emits: () => 'payment.booked',
    init: seq => ({ amount: [3400, 12000, 7800, 18500][seq % 4] }), title: j => `Purchase CHF ${(j.data.amount as number).toLocaleString(LOCALE)}`, states: {
      index: { at: ['memory', 'Index'], label: 'Invoice detected', next: 'recall' },
      recall: { at: ['memory', 'Recall'], work: 0.8, label: 'Recall: vendor history', next: 'route' },
      route: { at: ['memory', 'Research'], orch: true, label: 'Research routes to Payments', next: 'pay' },
      pay: { at: ['payments', 'Pay agent'], work: 2.0, label: 'Pay agent: draft PO', next: 'finance' },
      finance: { at: ['payments', 'Finance'], orch: true, label: 'Finance checks amount', next: j => (j.data.amount as number) > 10000 && !j.data.approved ? 'risk' : 'ledger', guard: 'amount > 10k', to: [['risk', '> 10k'], ['ledger', '≤ 10k']] },
      risk: { at: ['approvals', 'Risk'], work: 1.8, hitl: true, label: 'Risk: approve spend', next: j => { j.data.approved = true; return 'financeBack' }, to: [['financeBack', 'approved']] },
      financeBack: { at: ['approvals', 'Finance'], orch: true, label: 'Back to Finance', next: 'ledger' },
      ledger: { at: ['payments', 'Ledger'], work: 1.0, label: 'Ledger: book entry', next: 'done' } } },
  regression: { name: 'Regression fix', short: 'Regression', event: 'test.failed', start: 'index', emits: () => 'deploy.finished', states: {
    index: { at: ['memory', 'Index'], label: 'Failing test detected', next: 'recall' },
    recall: { at: ['memory', 'Recall'], work: 0.8, label: 'Recall: last green build', next: 'route' },
    route: { at: ['memory', 'Research'], orch: true, label: 'Research routes to Analyst', next: 'analyst' },
    analyst: { at: ['research', 'Analyst'], work: 1.6, label: 'Analyst: write fix', next: 'product' },
    product: { at: ['research', 'Product'], orch: true, label: 'Product sends to evals', next: 'grade' },
    grade: { at: ['evals', 'Grader'], work: 1.8, label: 'Grader: rerun suite', next: j => ((j.data.attempt as number)++ >= 1 || Math.random() < 0.55) ? 'ship' : 'retry', guard: 'tests pass?', to: [['ship', 'pass'], ['retry', 'fail']] },
    retry: { at: ['evals', 'Product'], orch: true, label: 'Tests failed: retry', next: 'analyst' },
    ship: { at: ['evals', 'Product'], orch: true, label: 'Tests green', next: 'deploy' },
    deploy: { at: ['research', 'Deploy'], work: 0.8, label: 'Deploy: ship fix', next: 'done' } } },
  intake: { name: 'Customer request', short: 'Request', event: 'request.received', start: 'intake', emits: () => 'deploy.finished', states: {
    intake: { at: ['research', 'Intake'], label: 'Request received', next: 'route' },
    route: { at: ['research', 'Research'], orch: true, label: 'Research triages', next: 'analyst' },
    analyst: { at: ['research', 'Analyst'], work: 1.6, label: 'Analyst: scope request', next: 'product' },
    product: { at: ['research', 'Product'], orch: true, label: 'Product asks for sign-off', next: 'human' },
    human: { at: ['approvals', 'Human'], work: 1.4, hitl: true, label: 'Human: approve scope', next: 'signed' },
    signed: { at: ['approvals', 'Product'], orch: true, label: 'Approved', next: 'deploy' },
    deploy: { at: ['research', 'Deploy'], work: 0.9, label: 'Deploy: ship', next: 'done' } } },
  smoke: { name: 'Smoke test', event: 'deploy.finished', start: 'shipped', emits: j => j.data.failed ? 'test.failed' : null, states: {
    shipped: { at: ['research', 'Deploy'], label: 'Deploy finished', next: 'product' },
    product: { at: ['research', 'Product'], orch: true, label: 'Product schedules checks', next: 'grade' },
    grade: { at: ['evals', 'Grader'], work: 1.2, label: 'Grader: smoke suite', next: j => { j.data.failed = Math.random() < 0.25; return j.data.failed ? 'done' : 'report' }, guard: 'smoke passes?', to: [['report', 'pass'], ['done', 'fail → test.failed']] },
    report: { at: ['evals', 'Evals'], work: 0.8, label: 'Evals: publish report', next: 'done' } } },
  audit: { name: 'Payment audit', short: 'Audit', event: 'payment.booked', start: 'booked', states: {
    booked: { at: ['payments', 'Ledger'], label: 'Payment booked', next: 'finance' },
    finance: { at: ['payments', 'Finance'], orch: true, label: 'Finance routes to Audit', next: 'audit' },
    audit: { at: ['approvals', 'Audit'], work: 1.6, label: 'Audit: reconcile entry', next: 'done' } } },
}
/** The machines the lap timer cycles through, in order (the other three are triggered by events). */
export const AGENT_WORKFLOW_ORDER = ['feature', 'purchase', 'regression']

const dgBez = (p: number[], t: number) => { const u = 1 - t; return [0, 1].map(k => u * u * u * p[k] + 3 * u * u * t * p[2 + k] + 3 * u * t * t * p[4 + k] + t * t * t * p[6 + k]) }
/** Columns by breadth-first depth from the start state; fork, join, guard and back edges included. */
function wfLayout(m: WorkflowMachine) {
  const E: { a: string; b: string; label: string; fork: boolean }[] = []
  Object.entries(m.states).forEach(([k, st]) => {
    if (st.fork) { st.fork.forEach(b => E.push({ a: k, b, label: 'fork', fork: true })); st.fork.forEach(b => E.push({ a: b, b: st.join!, label: 'join', fork: true })) }
    else if (st.to) st.to.forEach(([b, label]) => E.push({ a: k, b, label, fork: false }))
    else if (typeof st.next === 'string' && st.next !== 'back') E.push({ a: k, b: st.next, label: '', fork: false })
  })
  const depth: Record<string, number> = { [m.start]: 0 }, q = [m.start]
  while (q.length) { const k = q.shift()!; E.filter(e => e.a === k).forEach(e => { if (depth[e.b] === undefined) { depth[e.b] = depth[k] + 1; q.push(e.b) } }) }
  const cols: Record<number, string[]> = {}
  Object.entries(depth).forEach(([k, d]) => (cols[d] ??= []).push(k))
  const nCols = Math.max(...Object.keys(cols).map(Number)) + 1
  const W = Math.max(900, nCols * 150 + 40), H = 250, cw = (W - 40) / nCols, nw = Math.min(112, cw - 34), pos: Record<string, [number, number]> = {}
  Object.entries(cols).forEach(([d, ks]) => ks.forEach((k, i) => { pos[k] = [20 + (+d + 0.5) * cw, H / 2 + (i - (ks.length - 1) / 2) * 78] }))
  const edges: StatechartEdge[] = E.filter(e => pos[e.a] && pos[e.b]).map(e => {
    const [x1, y1] = pos[e.a], [x2, y2] = pos[e.b], back = x2 <= x1
    let P: number[]
    if (back) P = [x1, y1 + 22, x1, y1 + 92, x2, y2 + 92, x2, y2 + 22]
    else { const sx = x1 + nw / 2, ex = e.b === 'done' ? x2 - 12 : x2 - nw / 2 - 2, mx = (sx + ex) / 2; P = [sx, y1, mx, y1, mx, y2, ex, y2] }
    const [lx, ly] = dgBez(P, back ? 0.5 : P[6] - P[0] < 80 ? 0.35 : 0.62)
    return { id: `${e.a}>${e.b}`, d: `M${P[0]},${P[1]} C${P[2]},${P[3]} ${P[4]},${P[5]} ${P[6]},${P[7]}`, dashed: e.fork, label: e.label || undefined, lx, ly: ly + (back ? 14 : -6) }
  })
  return { pos, edges, W, H, nw }
}

/**
 * Live statechart of workflow machines, switchable with a segmented control. A shared WorkflowEngine runs
 * while the chart is on screen: lit states hold jobs (with a count), dots travel each transition as it
 * happens, guards and fork / join are labelled. Fire event queues the selected workflow's trigger; the log
 * shows the latest decisions.
 */
export function StateMachine({ machines = AGENT_WORKFLOWS, order, defaultValue, className }:
  { /** default AGENT_WORKFLOWS */ machines?: Record<string, WorkflowMachine>; order?: string[]; defaultValue?: string; className?: string }) {
  const engine = useMemo(() => new WorkflowEngine(machines, order ?? Object.keys(machines).slice(0, 3), { speed: 1.5 }), [machines, order])
  const [type, setType] = useState(defaultValue ?? Object.keys(machines)[0])
  const [, force] = useReducer((x: number) => x + 1, 0)
  const [dots, setDots] = useState<StatechartDot[]>([])
  const [log, setLog] = useState<{ k: string; id: number; name: string; text: ReactNode }[]>([])
  const box = useRef<HTMLDivElement>(null)
  const visible = useInView(box, { amount: 0.15 })
  const reduce = useReducedMotion()
  const m = machines[type]
  const L = useMemo(() => wfLayout(m), [m])
  const repaint = useRef(0)
  useFrameLoop(visible, dt => { engine.tick(dt); if ((repaint.current += dt) > 0.4) { repaint.current = 0; force() } })
  useEffect(() => engine.subscribe(ev => {
    if (ev.kind === 'queued') { force(); return }
    if (ev.job.type !== type) { if (ev.kind === 'enter' || ev.kind === 'done') force(); return }
    if (ev.kind === 'move' && ev.to && !reduce) {
      const edge = `${ev.state}>${ev.to}`, key = `${edge}-${performance.now()}-${Math.random()}`
      setDots(ds => [...ds.slice(-24), { key, edge, ms: 700, onDone: () => setDots(x => x.filter(d => d.key !== key)) }])
    }
    const text = ev.kind === 'hitl' ? <>waiting for <b>human approval</b></> : ev.kind === 'hitl-done' ? <>human: <b>{ev.result}</b></>
      : ev.kind === 'trigger' ? <>emits <b>{ev.ev}</b> → queued</> : ev.kind === 'guard' ? <><b>{ev.guard}?</b> → {ev.result}</>
      : ev.kind === 'join' ? <>reviews <b>joined</b></> : ev.kind === 'spawn' ? <><b>{machines[ev.job.type].event}</b> → started</> : ev.kind === 'done' ? <b>done</b> : null
    if (text) setLog(l => [{ k: `${ev.job.id}-${ev.kind}-${performance.now()}`, id: ev.job.id, name: ev.job.name, text }, ...l].slice(0, 5))
    force()
  }), [engine, type, reduce, machines])
  const counts: Record<string, number> = {}
  engine.jobs.filter(j => j.type === type && !j.done).forEach(j => j.tokens.forEach(t => { counts[t.state] = (counts[t.state] ?? 0) + 1 }))
  const nodes: StatechartNode[] = Object.entries(L.pos).map(([k, [x, y]]) => {
    if (k === 'done') return { id: k, kind: 'end', x, y }
    const st = m.states[k]
    const sub = st.hitl ? 'human approval' : st.work ? `${st.at[1] === 'Index' ? '' : 'agent · '}${st.work}s` : st.orch ? (st.guard ? 'decision' : st.fork ? 'fork → join' : 'orchestrator') : 'trigger'
    return { id: k, kind: 'state', x: x - L.nw / 2, y: y - 22, w: L.nw, h: 44, label: st.at[1] === 'Index' ? m.event : st.at[1], sub, dashed: !!st.orch, on: !!counts[k], count: counts[k] }
  })
  const pick = (v: string) => { setType(v); setDots([]); setLog([]) }
  return (
    <div ref={box} className={cn('flex flex-col gap-3', className)}>
      <div className="flex flex-wrap items-center justify-end gap-2">
        <div className="max-w-full overflow-x-auto"><SegmentedControl size="sm" value={type} onChange={pick} options={Object.entries(machines).map(([k, x]) => ({ value: k, label: x.short ?? x.name }))} /></div>
        <Button size="sm" variant="primary" className={TOUCH.tap36} onClick={() => { engine.fire(type); force() }}>Fire event</Button>
      </div>
      <Statechart key={type} width={L.W} height={L.H} nodes={nodes} edges={L.edges} dots={dots} label={`${m.name} statechart`} minWidth={900} />
      <div className="flex min-h-[22px] flex-wrap items-center gap-1.5 text-xs text-[var(--fg3)]">
        <span>Queue</span>
        {engine.queue.length ? engine.queue.map(q => <motion.span key={q.id} initial={{ opacity: 0, scale: 0.8 }} animate={{ opacity: 1, scale: 1 }} transition={spring(0.4, 0.3)}
          className={cn('rounded-full border px-2 py-px font-[family-name:var(--mono)] text-[11px]', q.ev === m.event ? 'border-[var(--accent)] text-[var(--accent)]' : 'border-[var(--line)] text-[var(--fg2)]')}>{q.ev}</motion.span>)
          : <span>empty · jobs start as soon as one of {engine.maxJobs} slots is free</span>}
      </div>
      <div className="flex max-h-[120px] flex-col gap-0.5 overflow-hidden font-[family-name:var(--mono)] text-xs text-[var(--fg2)]" aria-live="polite">
        {log.length ? (
          <AnimatePresence initial={false}>
            {log.map(x => (
              <motion.div key={x.k} layout initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={spring(0.2, 0.3)} className="flex gap-2.5 [&_b]:font-semibold [&_b]:text-[var(--fg)]">
                <span className="min-w-7 text-[var(--fg3)]">#{x.id}</span><span>{x.name}</span><span>{x.text}</span>
              </motion.div>
            ))}
          </AnimatePresence>
        ) : <div className="font-[family-name:var(--font)] text-[var(--fg3)]">Live engine. Fire an event to start a {m.name.toLowerCase()} job, or wait for the next trigger.</div>}
      </div>
    </div>
  )
}

/* ════════════════════════════════════════════════════════════════════════════
 * Trace waterfall
 * ══════════════════════════════════════════════════════════════════════════ */

export type TraceSpan = { id: string; parent?: string | null; name: string; meta?: string; kind: 'llm' | 'tool' | 'agent'; /** default by kind: asterisk, code, bot */ icon?: IconName; start: number; duration: number; cost?: number; tokens?: number }
const TRACE_BAR = {
  llm: 'bg-[color-mix(in_srgb,var(--accent)_72%,var(--card))]',
  tool: 'bg-[color-mix(in_srgb,var(--c4)_58%,var(--card))]',
  agent: 'bg-[color-mix(in_srgb,var(--fg3)_16%,var(--card))] shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--fg3)_40%,transparent)]',
} as const
const TRACE_ICON = { llm: 'text-[var(--accent)]', tool: 'text-[color-mix(in_srgb,var(--c4)_80%,var(--fg))]', agent: 'text-[var(--fg2)]' } as const

/**
 * Nested spans on one streaming timeline (agent runs, API requests, jobs). Plays when scrolled into view:
 * bars grow with a cursor, the stat strip rolls (duration, cost, tokens, calls, errors) and a Live badge
 * settles to Complete. Groups collapse. `failure` lets Simulate failure fail a span part-way and reveal its retry.
 * Hover or tap a span for its numbers. On phones the timeline scrolls sideways with the span names pinned.
 */
export function TraceWaterfall({ spans, total, title = 'Trace', subtitle, failure, speed = 1.2, className }:
  { spans: TraceSpan[]; total: number; title?: ReactNode; subtitle?: ReactNode
    failure?: { span: string; at: number; message: string; retry?: string }; speed?: number; className?: string }) {
  const reduce = useReducedMotion()
  const [clock, setClock] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [fail, setFail] = useState(false)
  const [closed, setClosed] = useState<Set<string>>(new Set())
  const box = useRef<HTMLDivElement>(null)
  const inView = useInView(box, { once: true, amount: 0.3 })
  const onScreen = useInView(box) // playback pauses while scrolled away and resumes on return
  const [laneRef, laneW] = useWidth<HTMLDivElement>()
  const [scrollRef, scroll] = useScrollEdges<HTMLDivElement>()
  const { tip, show, hide } = usePointerTooltip()
  const kids = (id: string | null) => spans.filter(s => (s.parent ?? null) === id && (fail || s.id !== failure?.retry))
  const depth = (s: TraceSpan): number => s.parent ? 1 + depth(spans.find(x => x.id === s.parent)!) : 0
  const slowest = spans.filter(s => s.kind === 'tool' && s.id !== failure?.retry).sort((a, b) => b.duration - a.duration)[0]
  const D = (s: TraceSpan) => fail && s.id === failure?.span ? failure.at : s.duration
  const play = (withFail: boolean) => { setFail(withFail); if (reduce) { setClock(total); setPlaying(false) } else { setClock(0); setPlaying(true) } }
  useEffect(() => { if (inView && clock === 0 && !playing) play(false) }, [inView]) // eslint-disable-line react-hooks/exhaustive-deps
  useFrameLoop(playing && onScreen, dt => setClock(c => { const n = c + dt * speed; if (n >= total) { setPlaying(false); return total } return n }), 0.25)

  // aggregate stats
  let cost = 0, tok = 0, llm = 0, tool = 0, errs = 0
  spans.forEach(s => {
    if (s.id === failure?.retry && !fail) return
    const started = clock >= s.start, end = s.start + D(s), w = started ? Math.min(clock, end) - s.start : 0
    if (fail && s.id === failure?.span && clock >= end) errs++
    if (s.kind === 'agent') return
    const frac = started ? Math.min(1, w / s.duration) : 0
    cost += (s.cost ?? 0) * frac; tok += (s.tokens ?? 0) * frac; if (started) { if (s.kind === 'llm') llm++; else tool++ }
  })
  const done = clock >= total, root = spans.find(s => !s.parent)
  if (done && !fail && root?.cost) cost = root.cost
  // the stat strip rolls once per second (and settles at the end)
  const sec = Math.floor(Math.min(clock, total)), statSec = useRef(-1), stats = useRef({ dur: 0, cost: 0, tok: 0, llm: 0, tool: 0, errs: 0 })
  if (sec !== statSec.current || done) { statSec.current = sec; stats.current = { dur: Math.min(total, Math.round(clock)), cost, tok, llm, tool, errs } }
  const S = stats.current
  const pct = (t: number) => `${(t / total) * 100}%`
  const ticks = Array.from({ length: Math.floor(total / 10) + 1 }, (_, i) => i * 10)

  const row = (s: TraceSpan): ReactNode => {
    const d = depth(s), ch = kids(s.id), isOpen = !closed.has(s.id)
    const du = D(s), started = clock >= s.start, end = s.start + du, fin = clock >= end, w = started ? Math.min(clock, end) - s.start : 0
    const failed = fail && s.id === failure?.span && fin, frac = started ? Math.min(1, w / s.duration) : 0
    const live = started && !fin
    const traceTip = (ev: ReactPointerEvent) => { if (!started) return hide(); show(ev, <><b className="font-semibold">{s.name}</b> <span className="text-[var(--fg3)]">{s.meta}</span><br /><span className="text-[var(--fg2)]">Start {s.start.toFixed(1)}s · {(Math.min(clock, end) - s.start).toFixed(1)}s{fin ? '' : ' so far'}{s.cost ? ` · ${fmt.usd(s.cost)}` : ''}{s.tokens ? ` · ${fmt.compact(s.tokens)} tokens` : ''}</span></>) }
    return (
      <Fragment key={s.id}>
        <motion.div key={failed ? 'f' : 'n'} animate={failed && !reduce ? { x: [0, -4, 4, -2, 2, 0] } : undefined} transition={{ duration: 0.35 }}
          className={cn('relative grid h-10 grid-cols-[var(--split)_1fr] items-center', d === 0 ? 'bg-[color-mix(in_srgb,var(--muted)_55%,transparent)]' : '', failed ? 'bg-[color-mix(in_srgb,var(--bad)_7%,transparent)]' : 'hover:bg-[color-mix(in_srgb,var(--muted)_70%,transparent)]')}
          onPointerDown={e => { if (isTouch(e)) traceTip(e) }} onPointerMove={e => traceTip(e)}
          onPointerLeave={onMouseLeave(hide)}>
          <div className={cn('sticky left-0 z-[2] flex h-full min-w-0 items-center gap-2 pr-2.5 text-[13px] shadow-[1px_0_0_var(--line)]',
            failed ? 'bg-[color-mix(in_srgb,var(--bad)_7%,var(--card))]' : d === 0 ? 'bg-[color-mix(in_srgb,var(--muted)_55%,var(--card))]' : 'bg-[var(--card)]')} style={{ paddingLeft: `calc(12px + ${d} * var(--ind))` }}>
            {Array.from({ length: d }, (_, i) => <span key={i} className="absolute inset-y-0 w-px bg-[var(--line)]" style={{ left: `calc(21px + ${i} * var(--ind))` }} />)}
            {ch.length ? <DgChevron open={isOpen} label={s.name} onClick={() => setClosed(c => { const n = new Set(c); if (n.has(s.id)) n.delete(s.id); else n.add(s.id); return n })} /> : <span className="w-[18px] flex-none" />}
            <span className={cn('grid h-6 w-6 flex-none place-items-center rounded-[7px] border border-[var(--line)] bg-[var(--card)] max-sm:hidden', TRACE_ICON[s.kind])}><Icon name={s.icon ?? (s.kind === 'llm' ? 'asterisk' : s.kind === 'tool' ? 'code' : 'bot')} size={13} /></span>
            <span className="min-w-0 truncate"><span className={failed ? 'text-[var(--bad)]' : 'text-[var(--fg)]'}>{s.name}</span>{s.meta && <em className="ml-1 text-[var(--fg3)] not-italic">{s.meta}</em>}</span>
            <span className="ml-auto flex flex-none">{live && s.kind !== 'agent' && <Spinner size={12} tone="accent" label={`${s.name} running`} className="motion-reduce:animate-none" />}</span>
          </div>
          <div className="relative h-full border-l border-[var(--line)]">
            {ticks.slice(1).map(t => <span key={t} className="pointer-events-none absolute inset-y-0 w-px bg-[var(--line)] opacity-70" style={{ left: pct(t) }} />)}
            <div className={cn('absolute top-[13px] h-3.5 min-w-0.5 overflow-hidden rounded-[var(--r-md)]', failed ? 'bg-[color-mix(in_srgb,var(--bad)_72%,var(--card))]' : TRACE_BAR[s.kind])}
              style={{ left: pct(s.start), width: pct(w), opacity: started ? 1 : 0 }}>
              {live && <span className="absolute inset-y-0 right-0 w-10 max-w-full bg-[linear-gradient(90deg,transparent,rgba(255,255,255,.55))]" />}
            </div>
            <div className="absolute top-[11px] flex items-center gap-2 text-xs whitespace-nowrap text-[var(--fg2)]" style={{ left: `calc(${pct(s.start + w)} + 10px)`, opacity: started ? 1 : 0 }}>
              {failed ? (
                <span className="inline-flex items-center gap-1 font-medium text-[var(--bad)]"><Icon name="alertCircle" size={12} />Failed after {du.toFixed(1)}s · {failure!.message}</span>
              ) : started && (
                <>
                  <span>{(fin ? s.duration : w).toFixed(s.duration >= 10 && fin ? 0 : 1)}s{s.cost ? <> · <span className={fin ? 'text-[var(--fg2)]' : 'text-[var(--fg3)]'}>{fmt.usd(s.cost * (fin ? 1 : frac))}</span></> : null}</span>
                  {fin && s === slowest && <span className="rounded-[5px] bg-[var(--warn-soft)] px-1.5 py-0.5 text-[11px] font-semibold tracking-[.04em] text-[var(--warn)]">SLOWEST</span>}
                </>
              )}
            </div>
          </div>
        </motion.div>
        {ch.length > 0 && <Collapse open={isOpen} className={DG_COLLAPSE_STICKY}>{ch.map(row)}</Collapse>}
      </Fragment>
    )
  }
  const badge = !done ? (errs ? ['warn', 'Live · 1 error'] : ['accent', 'Live']) : (errs ? ['bad', 'Completed with 1 error'] : ['ok', 'Complete'])
  const stat = (label: string, v: ReactNode, cls?: string) => <div className="border-[var(--line)] px-4 py-3 not-first:border-l max-md:[&:nth-child(4)]:border-l-0 max-md:[&:nth-child(n+4)]:border-t"><span className="mb-1 block text-xs text-[var(--fg3)]">{label}</span><b className={cn('flex items-baseline text-[22px] font-semibold tracking-tight', cls)}>{v}</b></div>
  return (
    <div ref={box} className={cn('flex flex-col gap-3', className)}>
      <div className="flex justify-end gap-2">
        <Button size="sm" className={TOUCH.tap36} onClick={() => play(true)} disabled={!failure}>Simulate failure</Button>
        <Button size="sm" className={TOUCH.tap36} onClick={() => play(false)}>Replay</Button>
      </div>
      <div className={cn('overflow-hidden', surface.card)}>
        <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5 border-b border-[var(--line)] px-4 py-3 text-sm">
          <span className="text-[var(--accent)]">✦</span><b className="font-semibold">{title}</b>{subtitle && <span className="text-[var(--fg3)]">{subtitle}</span>}
          <span className="flex-1" />
          <span className="mr-1.5 flex flex-wrap items-center gap-3 text-xs text-[var(--fg2)]">
            {(['llm', 'tool', 'agent'] as const).map(k => <span key={k} className="inline-flex items-center gap-1"><i className={cn('inline-block h-2.5 w-2.5 rounded-[3px]', TRACE_BAR[k])} />{{ llm: 'LLM call', tool: 'Tool call', agent: 'Agent' }[k]}</span>)}
          </span>
          <Badge tone={badge[0] as 'ok'}><span className={cn('h-1.5 w-1.5 rounded-full bg-current', !done && 'animate-pulse motion-reduce:animate-none')} />{badge[1]}</Badge>
        </div>
        <div className="grid grid-cols-3 border-b border-[var(--line)] md:grid-cols-6">
          {stat('Duration', <><AnimatedNumber value={S.dur} /><span className="ml-0.5 text-sm text-[var(--fg3)]">s</span></>)}
          {stat('Cost', <><span>$</span><AnimatedNumber value={S.cost} format={{ minimumFractionDigits: 2, maximumFractionDigits: 2 }} /></>)}
          {stat('Tokens', <AnimatedNumber value={Math.round(S.tok)} format={{ notation: 'compact', maximumFractionDigits: 1 }} />)}
          {stat('LLM calls', <AnimatedNumber value={S.llm} />)}
          {stat('Tool calls', <AnimatedNumber value={S.tool} />)}
          {stat('Errors', <AnimatedNumber value={S.errs} />, S.errs ? 'text-[var(--bad)]' : undefined)}
        </div>
        <div className="relative">
        <div ref={scrollRef} className="relative overflow-x-auto overscroll-x-contain [--ind:28px] [--split:38%] max-sm:[--ind:12px] max-sm:[--split:168px]">
          <div className="min-w-[560px]">
            <div className="grid h-9 grid-cols-[var(--split)_1fr] items-center border-b border-[var(--line)] text-xs text-[var(--fg3)]">
              <div className="sticky left-0 z-[2] flex h-full items-center bg-[var(--card)] pl-4 shadow-[1px_0_0_var(--line)]">Span</div>
              <div ref={laneRef} className="relative h-full border-l border-[var(--line)]">{ticks.map(t => <span key={t} className="absolute top-2.5 translate-x-1.5" style={{ left: pct(t) }}>{t}s</span>)}</div>
            </div>
            <div className="relative">
              {root && row(root)}
              {laneW > 0 && (
                <div className="pointer-events-none absolute top-0 bottom-0 w-[1.5px] bg-[var(--accent)] opacity-80" style={{ left: `calc(var(--split) + ${(laneW * Math.min(clock, total)) / total}px)` }}>
                  <i className="absolute -top-1 -left-[3.5px] h-2 w-2 rounded-full bg-[var(--accent)]" />
                </div>
              )}
            </div>
          </div>
        </div>
        {/* span names are pinned on the left, so only the right edge fades */}
        <ScrollEdges left={false} right={scroll.right} touched={scroll.touched} />
        </div>
      </div>
      <PointerTooltip tip={tip} />
    </div>
  )
}

/* ════════════════════════════════════════════════════════════════════════════
 * Sankey
 * ══════════════════════════════════════════════════════════════════════════ */

export type SankeyNode = { label: string; color?: string }
type SankeyHover = { k: 'link' | 'src' | 'dst'; i: number } | null

/**
 * Two-column Sankey: source nodes on the left, targets on the right, ribbons sized by value with % labels.
 * Hover, tap (or focus) a ribbon or a node to isolate its flows; tap outside to clear. The ribbons wipe in when scrolled into view.
 */
export function Sankey({ sources, targets, links, width = 300, height = 176, nodeWidth = 9, gap = 10, className }:
  { sources: SankeyNode[]; targets: SankeyNode[]; links: [number, number, number][]; width?: number; height?: number; nodeWidth?: number; gap?: number; className?: string }) {
  const [hover, setHover] = useState<SankeyHover>(null)
  const ref = useRef<SVGSVGElement>(null)
  const inView = useInView(ref, { once: true, amount: 0.4 })
  const { tip, show, hide } = usePointerTooltip()
  useOutside([ref], () => setHover(null), hover !== null, { escape: true })
  const clip = dgSafeId(useId())
  const W = width, H = height, pad = 4, nw = nodeWidth, xL = 70, xR = W - 70 - nw
  const total = links.reduce((a, l) => a + l[2], 0) || 1
  const k = (H - pad * 2 - gap * (Math.max(sources.length, targets.length) - 1)) / total
  const share = (v: number) => `${Math.round((v / total) * 100)}%`
  const lv = sources.map((_, i) => links.filter(l => l[0] === i).reduce((a, l) => a + l[2], 0))
  const rv = targets.map((_, i) => links.filter(l => l[1] === i).reduce((a, l) => a + l[2], 0))
  const place = (vals: number[]) => { const h = vals.map(v => v * k), tH = h.reduce((a, b) => a + b, 0) + gap * (vals.length - 1); let y = (H - tH) / 2; return h.map(hh => { const r = { y, h: hh }; y += hh + gap; return r }) }
  const LP = place(lv), RP = place(rv)
  const lOff = LP.map(n => n.y), rOff = RP.map(n => n.y), rStart = new Map<number, number>()
  links.map((l, i) => [l, i] as const).sort((a, b) => a[0][1] - b[0][1] || a[0][0] - b[0][0]).forEach(([l, i]) => { rStart.set(i, rOff[l[1]]); rOff[l[1]] += l[2] * k })
  const ribbons = links.map((l, i) => [l, i] as const).sort((a, b) => a[0][0] - b[0][0] || a[0][1] - b[0][1]).map(([l, i]) => {
    const h = l[2] * k, y0 = lOff[l[0]]; lOff[l[0]] += h
    const y1 = rStart.get(i)!, x0 = xL + nw, x1 = xR, mx = (x0 + x1) / 2
    return { i, l, d: `M${x0},${y0} C${mx},${y0} ${mx},${y1} ${x1},${y1} L${x1},${y1 + h} C${mx},${y1 + h} ${mx},${y0 + h} ${x0},${y0 + h} Z` }
  })
  const op = (i: number, l: [number, number, number]) => !hover ? 0.3 : hover.k === 'link' ? (hover.i === i ? 0.62 : 0.12) : (hover.k === 'src' ? l[0] : l[1]) === hover.i ? 0.62 : 0.1
  const node = (side: 'src' | 'dst', n: SankeyNode, i: number, p: { y: number; h: number }, v: number) => {
    const left = side === 'src', x = left ? xL : xR, tx = left ? xL - 7 : xR + nw + 7
    return (
      <motion.g key={`${side}${i}`} initial={{ opacity: 0 }} animate={inView ? { opacity: 1 } : undefined} transition={{ duration: 0.3, delay: left ? 0 : 0.55 }}
        tabIndex={0} role="button" aria-label={`${n.label}: ${share(v)}`} className="cursor-default outline-none"
        onPointerEnter={() => setHover({ k: side, i })} onPointerDown={() => { hide(); setHover({ k: side, i }) }} onPointerLeave={onMouseLeave(() => setHover(null))} onFocus={() => setHover({ k: side, i })} onBlur={() => setHover(null)}>
        <rect x={left ? 0 : x} y={p.y - 2} width={left ? x + nw : W - x} height={p.h + 4} fill="transparent" />
        <rect x={x} y={p.y} width={nw} height={p.h} rx={2} fill={n.color ?? PALETTE_DG[i % PALETTE_DG.length]} />
        <text x={tx} y={p.y + p.h / 2 - 2} textAnchor={left ? 'end' : 'start'} className="fill-[var(--fg)] [font:500_12px_var(--font)]">{n.label}</text>
        <text x={tx} y={p.y + p.h / 2 + 12} textAnchor={left ? 'end' : 'start'} className="fill-[var(--fg3)] [font:12px_var(--font)]">{share(v)}</text>
      </motion.g>
    )
  }
  return (
    <div className={className}>
      <svg ref={ref} viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Sankey diagram" className="block h-auto w-full overflow-visible">
        <defs><clipPath id={clip}><motion.rect x={0} y={0} height={H} initial={{ width: 0 }} animate={inView ? { width: W } : undefined} transition={{ duration: 1, ease: [0.22, 1, 0.36, 1], delay: 0.1 }} /></clipPath></defs>
        <g clipPath={`url(#${clip})`}>
          {ribbons.map(({ i, l, d }) => (
            <motion.path key={i} d={d} fill={sources[l[0]].color ?? PALETTE_DG[l[0] % PALETTE_DG.length]} initial={false} animate={{ opacity: op(i, l) }} transition={{ duration: 0.15 }}
              onPointerEnter={() => setHover({ k: 'link', i })} onPointerDown={e => { setHover({ k: 'link', i }); show(e, `${sources[l[0]].label} → ${targets[l[1]].label} · ${share(l[2])}`) }}
              onPointerMove={e => show(e, `${sources[l[0]].label} → ${targets[l[1]].label} · ${share(l[2])}`)} onPointerLeave={onMouseLeave(() => { setHover(null); hide() })} />
          ))}
        </g>
        {sources.map((n, i) => node('src', n, i, LP[i], lv[i]))}
        {targets.map((n, i) => node('dst', n, i, RP[i], rv[i]))}
      </svg>
      <PointerTooltip tip={tip} />
    </div>
  )
}
const PALETTE_DG = ['var(--c2)', 'var(--c3)', 'var(--c4)', 'var(--c1)', 'var(--bad)', 'var(--warn)']

/* ════════════════════════════════════════════════════════════════════════════
 * Network graph (force layout, no library)
 * ══════════════════════════════════════════════════════════════════════════ */

export type NetworkNode = { label: string; group: number; size?: number }
type NetSim = { x: number; y: number; vx: number; vy: number; fx: number | null; fy: number | null }

/**
 * Force-directed graph (repulsion, springs, centring) simulated in-file. Drag a node to pin it while you move it,
 * hover, tap or focus a node to highlight its neighbours (tap it again or outside to clear), Shuffle to re-scatter.
 * Nodes catch touches in a wider ring; swipes over empty canvas still scroll the page. Settles when scrolled into view.
 */
export function NetworkGraph({ nodes, links, groups, width = 900, height = 340, className }:
  { nodes: NetworkNode[]; links: [number, number][]; groups: [string, string][]; /** used until the container is measured */ width?: number; height?: number; className?: string }) {
  // the layout is sized to the container (1 SVG unit = 1px) so labels stay 11px and the graph fills the card
  const [wrapRef, measured] = useWidth<HTMLDivElement>()
  const W = Math.round(measured) || width, H = W < 560 ? Math.max(height, 420) : height
  // deterministic start (a golden-angle spiral by index), so the server and the first client render agree
  const sim = useRef<NetSim[]>(nodes.map((_, i) => ({ x: W / 2 + Math.cos(i * 2.39996) * 7 * Math.sqrt(i + 0.5), y: H / 2 + Math.sin(i * 2.39996) * 7 * Math.sqrt(i + 0.5), vx: 0, vy: 0, fx: null, fy: null })))
  const alpha = useRef(1)
  const [running, setRunning] = useState(false)
  const [, force] = useReducer((x: number) => x + 1, 0)
  const [hl, setHl] = useState<number | null>(null)
  const [dragging, setDragging] = useState<number | null>(null)
  const svgRef = useRef<SVGSVGElement>(null)
  const tap = useRef<{ i: number; x: number; y: number; was: boolean; moved: boolean } | null>(null)
  const inView = useInView(svgRef, { once: true, amount: 0.3 })
  const reduce = useReducedMotion()
  const nb = useMemo(() => { const s = nodes.map(() => new Set<number>()); links.forEach(([a, b]) => { s[a].add(b); s[b].add(a) }); return s }, [nodes, links])
  const r = (i: number) => nodes[i].size ?? 8
  const labelW = useMemo(() => nodes.map(n => n.label.length * 6.2), [nodes])
  const tick = () => {
    const ns = sim.current, a = alpha.current
    for (let i = 0; i < ns.length; i++) for (let j = i + 1; j < ns.length; j++) {
      const A = ns[i], B = ns[j], dx = B.x - A.x, dy = B.y - A.y, d2 = dx * dx + dy * dy || 0.01, d = Math.sqrt(d2), f = (3200 / d2) * a
      A.vx -= (dx / d) * f; A.vy -= (dy / d) * f; B.vx += (dx / d) * f; B.vy += (dy / d) * f
      const min = r(i) + r(j) + 44
      if (d < min) { const p = ((min - d) / d) * 0.25; A.vx -= dx * p; A.vy -= dy * p; B.vx += dx * p; B.vy += dy * p }
      // labels sit to the right of each dot: nudge apart vertically when one's label runs into the other
      const [L, Rt, li, ri] = dx >= 0 ? [A, B, i, j] : [B, A, j, i]
      if (Math.abs(dy) < 18 && Rt.x - r(ri) - 4 < L.x + r(li) + 5 + labelW[li]) { const p = (18 - Math.abs(dy)) * 0.15 * Math.max(a, 0.3), s = dy >= 0 ? 1 : -1; A.vy -= s * p; B.vy += s * p }
    }
    links.forEach(([ia, ib]) => { const A = ns[ia], B = ns[ib], dx = B.x - A.x, dy = B.y - A.y, d = Math.sqrt(dx * dx + dy * dy) || 0.01, f = (d - 92) * 0.025 * a; A.vx += (dx / d) * f; A.vy += (dy / d) * f; B.vx -= (dx / d) * f; B.vy -= (dy / d) * f })
    ns.forEach((n, i) => {
      n.vx += (W / 2 - 30 - n.x) * 0.002 * a; n.vy += (H / 2 - n.y) * 0.01 * a
      if (n.fx !== null && n.fy !== null) { n.x = n.fx; n.y = n.fy; n.vx = n.vy = 0; return }
      n.vx *= 0.82; n.vy *= 0.82
      n.x = clamp(n.x + n.vx, r(i) + 4, W - r(i) - 70); n.y = clamp(n.y + n.vy, r(i) + 4, H - r(i) - 4)
    })
    alpha.current = Math.max(0.02, a * 0.985)
  }
  const settle = () => { for (let i = 0; i < 400; i++) tick(); force() }
  const kick = (a: number) => { alpha.current = Math.max(alpha.current, a); if (reduce && dragging === null) settle(); else setRunning(true) }
  useEffect(() => { if (inView) kick(1) }, [inView]) // eslint-disable-line react-hooks/exhaustive-deps
  const size = useRef([W, H])
  useEffect(() => { // container resized: stretch the current layout to the new box, then let it re-settle
    const [w0, h0] = size.current; if (w0 === W && h0 === H) return
    size.current = [W, H]
    sim.current.forEach(n => { n.x *= W / w0; n.y *= H / h0 })
    if (inView) kick(0.3); else force()
  }, [W, H]) // eslint-disable-line react-hooks/exhaustive-deps
  useFrameLoop(running, () => { tick(); force(); if (alpha.current <= 0.021 && dragging === null) setRunning(false) })
  const toSvg = (e: { clientX: number; clientY: number }) => { const svg = svgRef.current!, m = svg.getScreenCTM()!.inverse(), p = new DOMPoint(e.clientX, e.clientY).matrixTransform(m); return p }
  const end = (i: number, e?: ReactPointerEvent) => {
    if (dragging !== i) return
    const n = sim.current[i], t = tap.current; n.fx = n.fy = null; setDragging(null); kick(0.3); tap.current = null
    // a touch tap (no drag) toggles the highlight and keeps it; a drag or a mouse release clears it as before
    if (e?.pointerType === 'touch' && e.type === 'pointerup' && t && !t.moved) setHl(t.was ? null : i)
    else if (e?.pointerType === 'touch' || !e) setHl(null)
  }
  // touch-action on SVG children isn't honoured everywhere: once a node drag is live, keep the page from scrolling under it
  const draggingRef = useRef(dragging); draggingRef.current = dragging
  useEffect(() => {
    const el = svgRef.current; if (!el) return
    const block = (ev: TouchEvent) => { if (draggingRef.current !== null) ev.preventDefault() }
    el.addEventListener('touchmove', block, { passive: false })
    return () => el.removeEventListener('touchmove', block)
  }, [])
  useOutside([], () => setHl(null), hl !== null && dragging === null, { escape: true, keep: t => !!t.closest('[data-net-node]') && !!svgRef.current?.contains(t) })
  const ns = sim.current
  const isOn = (i: number) => hl === null || i === hl || nb[hl].has(i)
  return (
    <div ref={wrapRef} className={cn('flex min-w-0 flex-col gap-2', className)}>
      <div className="flex justify-end"><Button size="sm" className={TOUCH.tap36} onClick={() => { sim.current.forEach(n => { n.x = W / 2 + (Math.random() - 0.5) * W * 0.55; n.y = H / 2 + (Math.random() - 0.5) * H * 0.65 }); kick(1) }}>Shuffle</Button></div>
      <svg ref={svgRef} viewBox={`0 0 ${W} ${H}`} width={W} height={H} role="img" aria-label="Network graph" className="block max-w-full touch-pan-y select-none">
        <g>
          {links.map(([a, b], k) => {
            const on = hl !== null && (a === hl || b === hl)
            return <line key={k} x1={ns[a].x} y1={ns[a].y} x2={ns[b].x} y2={ns[b].y}
              className={cn('transition-[stroke,opacity] duration-150', on ? 'stroke-[var(--fg2)] [stroke-width:1.8]' : 'stroke-[var(--line2)] [stroke-width:1.2]', hl !== null && !on && 'opacity-12')} />
          })}
        </g>
        <g>
          {nodes.map((n, i) => (
            <g key={i} transform={`translate(${ns[i].x},${ns[i].y})`} tabIndex={0} role="button" aria-label={`${n.label}, ${groups[n.group][0]}, ${nb[i].size} connections`} data-net-node=""
              className={cn('touch-none outline-none transition-opacity duration-150', dragging === i ? 'cursor-grabbing' : 'cursor-grab', !isOn(i) && 'opacity-25')}
              onPointerEnter={e => { if (dragging === null && !isTouch(e)) setHl(i) }} onPointerLeave={onMouseLeave(() => { if (dragging === null) setHl(null) })}
              onFocus={() => setHl(i)} onBlur={() => setHl(null)}
              onPointerDown={e => { e.preventDefault(); e.currentTarget.setPointerCapture(e.pointerId); tap.current = { i, x: e.clientX, y: e.clientY, was: hl === i, moved: false }; const q = toSvg(e); ns[i].fx = q.x; ns[i].fy = q.y; setDragging(i); setHl(i); alpha.current = Math.max(alpha.current, 0.4); setRunning(true) }}
              onPointerMove={e => { if (dragging !== i) return; const t = tap.current; if (t && !t.moved && Math.hypot(e.clientX - t.x, e.clientY - t.y) > 6) t.moved = true; const q = toSvg(e); ns[i].fx = clamp(q.x, r(i), W - r(i)); ns[i].fy = clamp(q.y, r(i), H - r(i)); alpha.current = Math.max(alpha.current, 0.3); if (reduce) { ns[i].x = ns[i].fx!; ns[i].y = ns[i].fy!; force() } }}
              onPointerUp={e => end(i, e)} onPointerCancel={e => end(i, e)}>
              <circle r={Math.max(r(i) + 6, 18)} fill="transparent" />
              <motion.circle r={r(i)} fill={groups[n.group][1]} className="stroke-[var(--card)] [stroke-width:2]" initial={false} animate={{ scale: dragging === i ? 1.2 : 1 }} transition={spring(0.4, 0.3)} />
              <text x={r(i) + 5} y={4} className="pointer-events-none fill-[var(--fg)] stroke-[var(--card)] [font:500_11px_var(--font)] [paint-order:stroke] [stroke-linejoin:round] [stroke-width:3px]">{n.label}</text>
            </g>
          ))}
        </g>
      </svg>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-[var(--fg3)]">
        {groups.map(([g, c]) => <span key={g} className="inline-flex items-center gap-1"><i className="inline-block h-[9px] w-[9px] rounded-full" style={{ background: c }} />{g}</span>)}
        <span className="ml-auto">{nodes.length} nodes · {links.length} links</span>
        <span className="hidden w-full [@media(pointer:coarse)]:block">Tap a node to highlight its links · drag a node to move it</span>
      </div>
    </div>
  )
}

/* ════════════════════════════════════════════════════════════════════════════
 * Process flow (node canvas)
 * ══════════════════════════════════════════════════════════════════════════ */

export type FlowNode = { id: string; x: number; y: number; icon: IconName; color: string; title: string; desc: string
  /** body text; `{n}` is replaced by the step's animated counter */
  body: string; foot: [string, string] }
export type FlowEdge = { from: string; to: string; alt?: boolean; label?: string }
/** One stage of a run: its nodes execute in parallel; edges into them pulse first. */
export type FlowStep = { log: string; nodes: { id: string; ms: number; count?: number; tone?: 'ok' | 'warn' }[] }
type FlowStatus = 'run' | 'ok' | 'warn' | undefined
const FLOW_W = 232

/**
 * Workflow canvas. Run executes `steps` in order: edges pulse, nodes spin then tick, counters roll and a
 * status pill logs progress. Drag nodes by their header; drag the background to pan; Ctrl/⌘ + scroll zooms at the
 * pointer; +, − and Fit buttons. On touch a vertical swipe scrolls the page, so pan with a sideways drag or two
 * fingers (which also pinch-zoom). Reset cancels a run.
 */
export function ProcessFlow({ nodes: initial, edges, steps, height = 420, idle, done, onComplete, className }:
  { nodes: FlowNode[]; edges: FlowEdge[]; steps: FlowStep[]; height?: number; idle?: string; done?: (seconds: number) => string; onComplete?: () => void; className?: string }) {
  const [pos, setPos] = useState(() => Object.fromEntries(initial.map(n => [n.id, { x: n.x, y: n.y }])))
  const [hs, setHs] = useState<Record<string, number>>({})
  const [view, setView] = useState({ x: 0, y: 0, z: 1 })
  const viewRef = useRef(view); viewRef.current = view
  const [sel, setSel] = useState<string | null>(null)
  const [status, setStatus] = useState<Record<string, FlowStatus>>({})
  const [counts, setCounts] = useState<Record<string, number>>({})
  const [times, setTimes] = useState<Record<string, string>>({})
  const [edgeSt, setEdgeSt] = useState<Record<number, 'live' | 'done'>>({})
  const [dots, setDots] = useState<StatechartDot[]>([])
  const [log, setLog] = useState(idle ?? `Idle · ${initial.length} steps`)
  const [running, setRunning] = useState(false)
  const gen = useRef(0)
  const pf = useRef<HTMLDivElement>(null)
  const nodeEls = useRef<Record<string, HTMLDivElement | null>>({})
  const paths = useRef<Record<string, SVGPathElement | null>>({})
  const inView = useInView(pf, { once: true, amount: 0.3 })
  const reduce = useReducedMotion()
  const fitted = useRef(false)

  useLayoutEffect(() => {
    const measure = () => setHs(Object.fromEntries(initial.map(n => [n.id, nodeEls.current[n.id]?.offsetHeight ?? 120])))
    measure()
    const ro = new ResizeObserver(measure); Object.values(nodeEls.current).forEach(el => el && ro.observe(el))
    return () => ro.disconnect()
  }, [initial])
  const tween = (to: { x: number; y: number; z: number }, dur = 0.5) => {
    const from = viewRef.current
    if (reduce) { setView(to); return }
    animate(0, 1, { duration: dur, ease: [0.22, 1, 0.36, 1], onUpdate: k => setView({ x: from.x + (to.x - from.x) * k, y: from.y + (to.y - from.y) * k, z: from.z + (to.z - from.z) * k }) })
  }
  /** Fit everything; `start` (phones) instead opens at a readable zoom on the first steps, to pan from. */
  const fit = (anim = true, start = false) => {
    const el = pf.current; if (!el) return
    let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9
    initial.forEach(n => { const p = pos[n.id]; x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y); x1 = Math.max(x1, p.x + FLOW_W); y1 = Math.max(y1, p.y + (hs[n.id] ?? 120)) })
    const Wc = el.clientWidth, Hc = el.clientHeight, pad = 36, all = Math.min(1.1, (Wc - pad * 2) / (x1 - x0), (Hc - pad * 2) / (y1 - y0))
    const z = start && all < 0.5 ? Math.min(0.72, (Hc - pad * 2) / (y1 - y0)) : all
    const to = { z, x: z === all ? (Wc - (x1 - x0) * z) / 2 - x0 * z : 20 - x0 * z, y: (Hc - (y1 - y0) * z) / 2 - y0 * z }
    if (anim) tween(to); else setView(to)
  }
  useEffect(() => { if (!fitted.current && Object.keys(hs).length) { fitted.current = true; fit(false, true) } }) // eslint-disable-line react-hooks/exhaustive-deps
  const fitRef = useRef(fit)
  useLayoutEffect(() => { fitRef.current = fit })
  useEffect(() => { // refit when the canvas itself changes size (not on every render)
    let t = 0, w = pf.current?.clientWidth ?? 0
    const ro = new ResizeObserver(() => { const nw = pf.current?.clientWidth ?? 0; if (nw === w) return; w = nw; clearTimeout(t); t = window.setTimeout(() => fitRef.current(true, true), 120) })
    if (pf.current) ro.observe(pf.current)
    return () => { ro.disconnect(); clearTimeout(t) }
  }, [])
  const zoomAt = (f: number, cx: number, cy: number, anim = true) => {
    const v = viewRef.current, z = Math.max(0.2, Math.min(2, v.z * f)), wx = (cx - v.x) / v.z, wy = (cy - v.y) / v.z, to = { z, x: cx - wx * z, y: cy - wy * z }
    if (anim) tween(to, 0.25); else setView(to)
  }
  useEffect(() => {
    const el = pf.current; if (!el) return
    const wheel = (e: WheelEvent) => { if (!(e.ctrlKey || e.metaKey)) return; e.preventDefault(); const r = el.getBoundingClientRect(); zoomAt(e.deltaY < 0 ? 1.08 : 0.93, e.clientX - r.left, e.clientY - r.top, false) }
    el.addEventListener('wheel', wheel, { passive: false })
    return () => el.removeEventListener('wheel', wheel)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // pointers: drag a node, pan the canvas, pinch with two fingers
  const ptrs = useRef(new Map<number, { x: number; y: number }>())
  const drag = useRef<{ id?: string; sx: number; sy: number; ox: number; oy: number; pinch?: { d: number; z: number; wx: number; wy: number } } | null>(null)
  const [panning, setPanning] = useState(false)
  const onDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement).closest('[data-pfctl]')) return
    pf.current!.setPointerCapture(e.pointerId); ptrs.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
    if (ptrs.current.size === 2) {
      const [a, b] = [...ptrs.current.values()], r = pf.current!.getBoundingClientRect(), v = viewRef.current, mx = (a.x + b.x) / 2 - r.left, my = (a.y + b.y) / 2 - r.top
      // remember the world point under the fingers' midpoint: two fingers pan and pinch around it
      drag.current = { sx: 0, sy: 0, ox: 0, oy: 0, pinch: { d: Math.hypot(a.x - b.x, a.y - b.y), z: v.z, wx: (mx - v.x) / v.z, wy: (my - v.y) / v.z } }; setPanning(true); return
    }
    const node = (e.target as HTMLElement).closest<HTMLElement>('[data-node]')?.dataset.node
    if (node) { setSel(node); drag.current = { id: node, sx: e.clientX, sy: e.clientY, ox: pos[node].x, oy: pos[node].y } }
    else { setSel(null); setPanning(true); drag.current = { sx: e.clientX, sy: e.clientY, ox: viewRef.current.x, oy: viewRef.current.y } }
  }
  const onMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const g = drag.current; if (!g || !ptrs.current.has(e.pointerId)) return
    ptrs.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
    if (g.pinch && ptrs.current.size >= 2) {
      const [a, b] = [...ptrs.current.values()], r = pf.current!.getBoundingClientRect(), d = Math.hypot(a.x - b.x, a.y - b.y)
      const z = Math.max(0.2, Math.min(2, g.pinch.z * (d / g.pinch.d))), mx = (a.x + b.x) / 2 - r.left, my = (a.y + b.y) / 2 - r.top
      setView({ z, x: mx - g.pinch.wx * z, y: my - g.pinch.wy * z }); return
    }
    const dx = e.clientX - g.sx, dy = e.clientY - g.sy
    if (g.id) { const id = g.id; setPos(p => ({ ...p, [id]: { x: g.ox + dx / viewRef.current.z, y: g.oy + dy / viewRef.current.z } })) }
    else setView(v => ({ ...v, x: g.ox + dx, y: g.oy + dy }))
  }
  const onUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    ptrs.current.delete(e.pointerId)
    if (!ptrs.current.size) { drag.current = null; setPanning(false) }
    else if (drag.current?.pinch) { const [p] = [...ptrs.current.values()]; drag.current = { sx: p.x, sy: p.y, ox: viewRef.current.x, oy: viewRef.current.y } } // one finger left: keep panning from here
  }
  // a second finger landing after the page started scrolling can't be pinched; stop the page from moving under a live pinch
  useEffect(() => {
    const el = pf.current; if (!el) return
    const block = (ev: TouchEvent) => { if (ev.touches.length > 1) ev.preventDefault() }
    el.addEventListener('touchmove', block, { passive: false })
    return () => el.removeEventListener('touchmove', block)
  }, [])

  // geometry
  const anchor = (id: string, side: 'l' | 'r') => ({ x: pos[id].x + (side === 'r' ? FLOW_W : 0), y: pos[id].y + (hs[id] ?? 120) / 2 })
  const eg = edges.map(e => { const a = anchor(e.from, 'r'), b = anchor(e.to, 'l'), c = Math.max(60, Math.abs(b.x - a.x) / 2); return { d: `M${a.x},${a.y} C${a.x + c},${a.y} ${b.x - c},${b.y} ${b.x},${b.y}`, mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2 - 6 } })

  // run
  const reset = () => { gen.current++; counters.current.forEach(c => c.stop()); counters.current.clear(); setRunning(false); setStatus({}); setCounts({}); setTimes({}); setEdgeSt({}); setDots([]); setLog(idle ?? `Idle · ${initial.length} steps`) }
  const pulse = (k: number) => reduce ? Promise.resolve() : new Promise<void>(res => {
    const key = `e${k}-${performance.now()}`
    setDots(ds => [...ds, { key, edge: `e${k}`, ms: 700, ease: 'inOut', onDone: () => { setDots(x => x.filter(d => d.key !== key)); res() } }])
  })
  // counters roll with motion's tween (ease-out cubic); Reset (a new generation) stops them
  const counters = useRef(new Set<{ stop: () => void }>())
  useEffect(() => () => counters.current.forEach(c => c.stop()), [])
  const countTo = (id: string, to: number, ms: number) => new Promise<void>(res => {
    const g0 = gen.current
    const c = animate(0, to, {
      duration: reduce ? 0 : ms / 1000, ease: [0.33, 1, 0.68, 1],
      onUpdate: v => { if (gen.current === g0) setCounts(cs => ({ ...cs, [id]: Math.round(v) })) },
      onComplete: () => { counters.current.delete(c); res() },
    })
    counters.current.add(c)
  })
  const run = async () => {
    if (running) return
    reset(); const g = ++gen.current, ok = () => g === gen.current
    setRunning(true); const t0 = performance.now()
    let prev: string[] = []
    for (const st of steps) {
      const ids = st.nodes.map(n => n.id), into = edges.map((e, k) => [e, k] as const).filter(([e]) => prev.includes(e.from) && ids.includes(e.to)).map(([, k]) => k)
      if (into.length) { setEdgeSt(s => ({ ...s, ...Object.fromEntries(into.map(k => [k, 'live' as const])) })); await Promise.all(into.map(pulse)); if (!ok()) return; setEdgeSt(s => ({ ...s, ...Object.fromEntries(into.map(k => [k, 'done' as const])) })) }
      setLog(st.log)
      await Promise.all(st.nodes.map(async n => {
        setStatus(s => ({ ...s, [n.id]: 'run' })); const s0 = performance.now()
        if (n.count !== undefined) await countTo(n.id, n.count, n.ms); else await sleep(n.ms)
        if (!ok()) return
        setStatus(s => ({ ...s, [n.id]: n.tone ?? 'ok' })); setTimes(t => ({ ...t, [n.id]: `${((performance.now() - s0) / 1000).toFixed(1)} s` }))
      }))
      if (!ok()) return
      prev = ids
    }
    setLog(done ? done((performance.now() - t0) / 1000) : `Completed in ${((performance.now() - t0) / 1000).toFixed(1)} s`); setRunning(false); onComplete?.()
  }
  const ctl = 'grid h-[30px] w-[30px] [@media(pointer:coarse)]:h-9 [@media(pointer:coarse)]:w-9 cursor-pointer place-items-center border-0 bg-transparent text-base text-[var(--fg2)] hover:bg-[var(--muted)] hover:text-[var(--fg)] not-first:border-t not-first:border-[var(--line)]'
  const bodyText = (n: FlowNode) => { const parts = n.body.split('{n}'); return parts.length > 1 ? <>{parts[0]}<b className="font-[family-name:var(--mono)] font-semibold text-[var(--fg)]">{(counts[n.id] ?? 0).toLocaleString(LOCALE)}</b>{parts[1]}</> : n.body }
  return (
    <div className={cn('flex flex-col gap-3', className)}>
      <div className="flex justify-end gap-2">
        <Button size="sm" className={TOUCH.tap36} onClick={reset}>Reset</Button>
        <Button size="sm" variant="primary" className={TOUCH.tap36} onClick={run} disabled={running}><Icon name="play" size={12} filled />Run</Button>
      </div>
      <div ref={pf} onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}
        className={cn('relative touch-pan-y overflow-hidden rounded-[var(--r-lg)] border border-[var(--line)] select-none max-sm:!h-[min(var(--pf-h),68vh)]', DG_DOTS, panning ? 'cursor-grabbing' : 'cursor-grab')}
        style={{ height, '--pf-h': `${height}px`, backgroundPosition: `${view.x}px ${view.y}px`, backgroundSize: `${18 * view.z}px ${18 * view.z}px` } as CSSProperties}>
        <div className="absolute top-0 left-0 origin-top-left" style={{ transform: `translate(${view.x}px,${view.y}px) scale(${view.z})` }}>
          <svg className="pointer-events-none absolute top-0 left-0 overflow-visible" width={1} height={1} aria-hidden>
            {eg.map((g, k) => {
              const e = edges[k], st = edgeSt[k]
              return (
                <g key={k}>
                  <motion.path ref={el => { paths.current[`e${k}`] = el }} d={g.d} fill="none" strokeWidth={2} initial={{ opacity: 0 }}
                    animate={{ opacity: inView ? (st === 'done' && e.alt ? 0.6 : 1) : 0, strokeDashoffset: st === 'live' && !reduce ? [0, -12] : 0 }}
                    transition={{ opacity: { duration: 0.4, delay: st ? 0 : 0.2 + k * 0.08 }, strokeDashoffset: st === 'live' ? { duration: 0.6, ease: 'linear', repeat: Infinity } : { duration: 0 } }}
                    strokeDasharray={st === 'live' ? '6 6' : e.alt ? '5 5' : undefined}
                    className={cn('transition-[stroke] duration-300', st === 'live' ? (e.alt ? 'stroke-[var(--warn)]' : 'stroke-[var(--accent)]') : st === 'done' ? (e.alt ? 'stroke-[var(--warn)]' : 'stroke-[var(--fg3)]') : 'stroke-[var(--line2)]')} />
                  {e.label && <text x={g.mx} y={g.my} textAnchor="middle" className="fill-[var(--fg2)] stroke-[var(--bg)] [font:500_11px_var(--font)] [paint-order:stroke] [stroke-width:4px]">{e.label}</text>}
                </g>
              )
            })}
            {dots.map(d => <DgDot key={d.key} path={() => paths.current[d.edge]} ms={d.ms} ease={d.ease} onDone={d.onDone} />)}
          </svg>
          {initial.map((n, i) => {
            const st = status[n.id], hasL = edges.some(e => e.to === n.id), hasR = edges.some(e => e.from === n.id)
            return (
              <motion.div key={n.id} ref={el => { nodeEls.current[n.id] = el }} data-node={n.id} initial={{ opacity: 0, y: 10 }} animate={inView ? { opacity: 1, y: 0, scale: drag.current?.id === n.id ? 1.02 : 1 } : undefined}
                transition={{ opacity: { duration: 0.4, delay: i * 0.08 }, y: { duration: 0.4, delay: i * 0.08 }, scale: spring(0.4, 0.25) }}
                className={cn('absolute cursor-default rounded-[var(--r-lg)] border bg-[var(--card)] shadow-[0_1px_2px_rgba(0,0,0,.05)] transition-[border-color,box-shadow] duration-250',
                  st === 'run' ? 'border-[var(--accent)] !shadow-[0_0_0_3px_var(--accent-soft)]' : st === 'ok' ? 'border-[color-mix(in_srgb,var(--ok)_55%,var(--line))]' : st === 'warn' ? 'border-[color-mix(in_srgb,var(--warn)_60%,var(--line))]' : sel === n.id ? 'border-[var(--fg3)]' : 'border-[var(--line)]')}
                style={{ left: pos[n.id].x, top: pos[n.id].y, width: FLOW_W, zIndex: sel === n.id ? 2 : undefined }}>
                {hasL && <span className={cn('absolute top-1/2 -left-1.5 -mt-1 h-2.5 w-2.5 rounded-full border-2 bg-[var(--card)]', st ? 'border-[var(--fg3)]' : 'border-[var(--line2)]')} />}
                {hasR && <span className={cn('absolute top-1/2 -right-1.5 -mt-1 h-2.5 w-2.5 rounded-full border-2 bg-[var(--card)]', st ? 'border-[var(--fg3)]' : 'border-[var(--line2)]')} />}
                <div className="flex cursor-grab touch-none items-center gap-2 border-b border-[var(--line)] px-3 py-2.5">
                  <span className="grid h-[26px] w-[26px] flex-none place-items-center rounded-[7px]" style={{ color: n.color, background: `color-mix(in srgb, ${n.color} 14%, var(--card))` }}><Icon name={n.icon} size={14} /></span>
                  <div className="min-w-0"><div className="text-[13px] leading-tight font-semibold">{n.title}</div><div className="text-[11px] text-[var(--fg3)]">{n.desc}</div></div>
                  {st === 'warn' ? (
                    // StatusIcon has no warning state: same shape, warn colour, "!" instead of the tick
                    <motion.span role="img" aria-label="Needs review" initial={{ scale: 0.4 }} animate={{ scale: 1 }} transition={spring(0.5, 0.35)}
                      className="ml-auto grid h-[18px] w-[18px] flex-none place-items-center rounded-full bg-[var(--warn)] text-[var(--card)]"><Icon name="alert" size={10} strokeWidth={3} /></motion.span>
                  ) : <StatusIcon status={st === 'run' ? 'active' : st === 'ok' ? 'done' : 'pending'} tone="ok" label={st === 'run' ? 'Running' : st === 'ok' ? 'Done' : 'Waiting'} className="ml-auto motion-reduce:animate-none" />}
                </div>
                <div className="px-3 py-2 text-xs leading-[1.45] text-[var(--fg2)]">{bodyText(n)}</div>
                <div className="flex justify-between rounded-b-[var(--r-lg)] border-t border-[var(--line)] bg-[color-mix(in_srgb,var(--muted)_50%,var(--card))] px-3 py-2 text-[11px] text-[var(--fg3)]"><span>{n.foot[0]}</span><span>{times[n.id] ?? n.foot[1]}</span></div>
              </motion.div>
            )
          })}
        </div>
        <div data-pfctl className={cn('absolute bottom-3 left-3 flex flex-col overflow-hidden shadow-[0_1px_2px_rgba(0,0,0,.05)]', surface.md)}>
          <button type="button" aria-label="Zoom in" className={ctl} onClick={() => zoomAt(1.25, pf.current!.clientWidth / 2, pf.current!.clientHeight / 2)}>+</button>
          <button type="button" aria-label="Zoom out" className={ctl} onClick={() => zoomAt(0.8, pf.current!.clientWidth / 2, pf.current!.clientHeight / 2)}>−</button>
          <button type="button" aria-label="Fit view" className={ctl} onClick={() => fit()}><Icon name="maximize" size={13} /></button>
        </div>
        <span data-pfctl className="pointer-events-none absolute top-2.5 left-3 hidden rounded-full border border-[var(--line)] bg-[var(--card)] px-2.5 py-1 text-[11px] text-[var(--fg3)] [@media(pointer:coarse)]:block">Drag sideways to pan · pinch to zoom</span>
        <motion.div key={log} data-pfctl initial={{ opacity: 0.4 }} animate={{ opacity: 1 }} transition={{ duration: 0.2 }} aria-live="polite"
          className="absolute right-3 bottom-3 max-w-[calc(100%-76px)] truncate rounded-full border border-[var(--line)] bg-[var(--card)] px-3 py-1 text-xs text-[var(--fg2)] shadow-[0_1px_2px_rgba(0,0,0,.05)]">{log}</motion.div>
      </div>
    </div>
  )
}

/* ════════════════════════════════════════════════════════════════════════════
 * Data flow (sources → engine → destinations)
 * ══════════════════════════════════════════════════════════════════════════ */

export type DataFlowSource = { label: string; icon: IconName; color: string; rate: number }
export type DataFlowTarget = { label: string; icon: IconName; color: string; share: number }
type DfParticle = { c: SVGCircleElement; core: SVGCircleElement; stage: 0 | 1; p: number; t: number; v: number }
const DF_W = 960, DF_H = 380, DF_NW = 150, DF_NH = 44, DF_ER = 62, DF_NW_T = 148

/**
 * Streaming pipeline: particles leave each source at its event rate, pass through the processing engine
 * (its stage label cycles) and fan out to destinations by share. Hover, tap or focus a node to trace its path.
 * Speed slider, Pause, and a live stat strip (throughput, processed, in flight, p95 latency). Below 560px the
 * pipeline turns vertical (sources above the engine, destinations below) so labels stay full size on phones.
 */
export function DataFlow({ sources, targets, engine = 'Engine', stages = ['Ingest', 'Transform', 'Enrich', 'Route'], className }:
  { sources: DataFlowSource[]; targets: DataFlowTarget[]; engine?: string; stages?: string[]; className?: string }) {
  const [wrapRef, wrapW] = useWidth<HTMLDivElement>()
  const tall = wrapW > 0 && wrapW < 560
  // phones: two columns of sources, the engine, then two columns of destinations
  const cols2 = (n: number, i: number, top: number, w: number) => { const row = Math.floor(i / 2), solo = i === n - 1 && n % 2 === 1; return [solo ? (w - DF_NW_T) / 2 : 8 + (i % 2) * (DF_NW_T + 8), top + row * (DF_NH + 10)] as const }
  const srcRows = Math.ceil(sources.length / 2), dstRows = Math.ceil(targets.length / 2)
  const W = tall ? DF_NW_T * 2 + 24 : DF_W, er = tall ? 46 : DF_ER, nw = tall ? DF_NW_T : DF_NW, nh = DF_NH
  const ex = W / 2, ey = tall ? 8 + srcRows * (nh + 10) + 40 + er : DF_H / 2
  const dTop = ey + er + 52, H = tall ? dTop + dstRows * (nh + 10) : DF_H
  const [speed, setSpeed] = useState(1)
  const [paused, setPaused] = useState(false)
  const [hl, setHl] = useState<{ k: 's' | 'd'; i: number } | null>(null)
  const [stage, setStage] = useState(0)
  const [stats, setStats] = useState({ tp: 0, processed: 0, inflight: 0, p95: 42, delivered: targets.map(() => 0) })
  const box = useRef<HTMLDivElement>(null)
  const inView = useInView(box, { once: true, amount: 0.3 })
  const visible = useInView(box, { amount: 0.05 })
  const reduce = useReducedMotion()
  const ptG = useRef<SVGGElement>(null), pulseC = useRef<SVGCircleElement>(null)
  const inL = useRef<(SVGPathElement | null)[]>([]), outL = useRef<(SVGPathElement | null)[]>([])
  const sim = useRef({ parts: [] as DfParticle[], acc: sources.map(() => 0), processed: 0, delivered: targets.map(() => 0), lastP: 0 })
  const hlRef = useRef(hl); hlRef.current = hl
  const glow = dgSafeId(useId())
  const sy = (i: number) => 34 + i * ((H - 68 - nh) / Math.max(1, sources.length - 1)), dy = (i: number) => 70 + i * ((H - 140 - nh) / Math.max(1, targets.length - 1))
  const srcAt = (i: number) => tall ? cols2(sources.length, i, 8, W) : [20, sy(i)] as const
  const dstAt = (i: number) => tall ? cols2(targets.length, i, dTop, W) : [W - 20 - nw, dy(i)] as const
  const mid = (n: number, i: number) => i - (n - 1) / 2
  const inD = sources.map((_, i) => {
    const [sx0, sy0] = srcAt(i)
    if (tall) { const x0 = sx0 + nw / 2, y0 = sy0 + nh, x1 = ex + mid(sources.length, i) * 12, y1 = ey - er - 6; return `M${x0},${y0} C${x0},${y0 + 40} ${x1},${y1 - 40} ${x1},${y1}` }
    const x0 = sx0 + nw, y0 = sy0 + nh / 2, x1 = ex - er - 6, y1 = ey + mid(sources.length, i) * 14; return `M${x0},${y0} C${x0 + 110},${y0} ${x1 - 110},${y1} ${x1},${y1}`
  })
  const outD = targets.map((_, i) => {
    const [dx0, dy0] = dstAt(i)
    if (tall) { const x0 = ex + mid(targets.length, i) * 14, y0 = ey + er + 6, x1 = dx0 + nw / 2, y1 = dy0; return `M${x0},${y0} C${x0},${y0 + 30} ${x1},${y1 - 30} ${x1},${y1}` }
    const x0 = ex + er + 6, y0 = ey + mid(targets.length, i) * 16, x1 = dx0, y1 = dy0 + nh / 2; return `M${x0},${y0} C${x0 + 110},${y0} ${x1 - 110},${y1} ${x1},${y1}`
  })
  const pickTarget = () => { const tot = targets.reduce((a, t) => a + t.share, 0); let r = Math.random() * tot; return Math.max(0, targets.findIndex(t => (r -= t.share) <= 0)) }

  useFrameLoop(visible && !paused && !reduce, dt => {
    const S = sim.current, g = ptG.current; if (!g) return
    sources.forEach((s, i) => {
      S.acc[i] += (dt * s.rate / 40) * speed
      while (S.acc[i] >= 1) {
        S.acc[i]--
        if (S.parts.length >= 140) continue
        const mk = (r: number, o: number) => { const c = document.createElementNS('http://www.w3.org/2000/svg', 'circle'); c.setAttribute('r', String(r)); c.setAttribute('fill', s.color); c.setAttribute('opacity', String(o)); g.appendChild(c); return c }
        const c = mk(2.6, 0.8); c.setAttribute('filter', `url(#${glow})`)
        S.parts.push({ c, core: mk(1.6, 1), stage: 0, p: i, t: 0, v: 0.35 + Math.random() * 0.25 })
      }
    })
    const h = hlRef.current
    for (let k = S.parts.length - 1; k >= 0; k--) {
      const q = S.parts[k]
      q.t += dt * q.v * speed
      if (q.t >= 1) {
        if (q.stage === 0) {
          q.stage = 1; q.t = 0; q.p = pickTarget(); S.processed++
          const col = targets[q.p].color; q.c.setAttribute('fill', col); q.core.setAttribute('fill', col)
          if (S.processed % 6 === 0 && pulseC.current) animate(pulseC.current, { fillOpacity: [0.2, 0.08] }, { duration: 0.5 })
        } else { S.delivered[q.p]++; q.c.remove(); q.core.remove(); S.parts.splice(k, 1); continue }
      }
      const path = (q.stage ? outL.current : inL.current)[q.p]; if (!path) continue
      const pt = path.getPointAtLength(q.t * path.getTotalLength())
      q.c.setAttribute('cx', String(pt.x)); q.c.setAttribute('cy', String(pt.y)); q.core.setAttribute('cx', String(pt.x)); q.core.setAttribute('cy', String(pt.y))
      const dim = h && !((h.k === 's' && q.stage === 0 && q.p === h.i) || (h.k === 'd' && q.stage === 1 && q.p === h.i))
      q.c.setAttribute('opacity', String(dim ? 0.1 : 0.8)); q.core.setAttribute('opacity', String(dim ? 0.12 : 1))
    }
  })
  useEffect(() => () => { sim.current.parts.forEach(q => { q.c.remove(); q.core.remove() }); sim.current.parts = [] }, [])
  useEffect(() => {
    if (!visible || paused) return
    const id = setInterval(() => {
      const S = sim.current
      setStats({ tp: Math.round(sources.reduce((a, s) => a + s.rate, 0) * speed + (Math.random() - 0.5) * 12), processed: S.processed * 40, inflight: S.parts.length, p95: Math.round(42 / Math.max(0.4, speed) + Math.random() * 6), delivered: S.delivered.map(d => d * 40) })
    }, 1000)
    return () => clearInterval(id)
  }, [visible, paused, speed, sources])
  useEffect(() => { if (!visible) return; const id = setInterval(() => setStage(s => (s + 1) % stages.length), 1800); return () => clearInterval(id) }, [visible, stages.length])

  useOutside([], () => setHl(null), hl !== null, { escape: true, keep: t => !!t.closest('[data-df-node]') && !!box.current?.contains(t) })
  const on = (k: 's' | 'd', i: number) => !hl || (hl.k === k && hl.i === i)
  const linkOn = (k: 's' | 'd', i: number) => hl && (hl.k !== k || hl.i === i)
  const node = (k: 's' | 'd', n: DataFlowSource | DataFlowTarget, i: number, x: number, y: number, sub: string) => (
    <motion.g key={`${k}${i}`} transform={`translate(${x},${y})`} tabIndex={0} role="button" aria-label={`${n.label}: ${sub}`}
      className={cn('cursor-default outline-none transition-opacity duration-200', !on(k, i) && '!opacity-30')}
      initial={{ opacity: 0 }} animate={inView ? { opacity: 1 } : undefined} transition={{ duration: 0.4, delay: (k === 'd' ? 0.4 : 0) + i * 0.06 }}
      data-df-node="" onPointerEnter={e => { if (!isTouch(e)) setHl({ k, i }) }} onPointerDown={e => { if (isTouch(e)) setHl(h => h && h.k === k && h.i === i ? null : { k, i }) }} onPointerLeave={onMouseLeave(() => setHl(null))} onFocus={() => setHl({ k, i })} onBlur={() => setHl(null)}>
      <rect width={nw} height={nh} rx={10} className="fill-[var(--card)] stroke-[var(--line)]" />
      <rect x={10} y={10} width={24} height={24} rx={7} style={{ fill: `color-mix(in srgb, ${n.color} 15%, var(--card))` }} />
      <g transform="translate(15.5,15.5) scale(0.54)" style={{ color: n.color }}><path d={ICONS[n.icon]} fill="none" stroke="currentColor" strokeWidth={3.6} strokeLinecap="round" strokeLinejoin="round" /></g>
      <text x={42} y={tall ? 19 : 20} className={cn('fill-[var(--fg)]', tall ? '[font:500_13px_var(--font)]' : '[font:500_12px_var(--font)]')}>{n.label}</text>
      <text x={42} y={34} className={cn('fill-[var(--fg3)]', tall ? '[font:12px_var(--font)]' : '[font:11px_var(--font)]')}>{sub}</text>
    </motion.g>
  )
  const lk = (d: string, k: 's' | 'd', i: number, ref: (el: SVGPathElement | null) => void, order: number) => (
    <motion.path key={`${k}${i}`} ref={ref} d={d} fill="none" initial={{ pathLength: reduce ? 1 : 0 }} animate={inView ? { pathLength: 1 } : undefined} transition={{ duration: 0.8, delay: 0.1 + order * 0.05, ease: [0.22, 1, 0.36, 1] }}
      className={cn('transition-[opacity,stroke] duration-200 [stroke-width:1.5]', linkOn(k, i) ? 'stroke-[var(--fg3)]' : 'stroke-[var(--line2)]', hl && !linkOn(k, i) && 'opacity-15')} />
  )
  const stat = (label: string, v: number, unit?: string) => (
    <div className="rounded-[var(--r-md)] bg-[var(--muted)] px-3 py-2.5"><span className="block text-[11px] text-[var(--fg3)]">{label}</span>
      <b className="flex items-baseline text-lg font-semibold tracking-tight"><AnimatedNumber value={v} format={{ maximumFractionDigits: 0 }} />{unit && <span className="ml-0.5 text-xs font-normal text-[var(--fg3)]">{unit}</span>}</b></div>
  )
  return (
    <div ref={box} className={cn('flex flex-col gap-3', className)}>
      <div className="flex items-center justify-end gap-2">
        <span className="text-xs text-[var(--fg3)]">Speed</span>
        <div className="w-[90px] [@media(pointer:coarse)]:w-[120px]"><Slider min={0.3} max={3} step={0.1} value={speed} onChange={setSpeed} /></div>
        <Button size="sm" className={TOUCH.tap36} onClick={() => setPaused(p => !p)}>{paused ? 'Resume' : 'Pause'}</Button>
      </div>
      <div ref={wrapRef} className="overflow-x-auto overscroll-x-contain rounded-[var(--r-lg)] border border-[var(--line)] bg-[var(--bg)]">
        <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Data flow from sources through a processing engine to destinations" className={cn('block h-auto w-full', tall ? 'mx-auto max-w-[420px]' : 'min-w-[640px] [@media(pointer:coarse)]:min-w-[960px]')}>
          <defs><filter id={glow} x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation={2.2} /></filter></defs>
          <g>
            {inD.map((d, i) => lk(d, 's', i, el => { inL.current[i] = el }, i))}
            {outD.map((d, i) => lk(d, 'd', i, el => { outL.current[i] = el }, sources.length + i))}
          </g>
          <g ref={ptG} />
          <g>
            {sources.map((s, i) => node('s', s, i, srcAt(i)[0], srcAt(i)[1], `${Math.round(s.rate * speed)} ev/s`))}
            {targets.map((t, i) => node('d', t, i, dstAt(i)[0], dstAt(i)[1], `${stats.delivered[i].toLocaleString(LOCALE)} delivered`))}
          </g>
          <g transform={`translate(${ex},${ey})`}>
            <motion.g initial={{ opacity: 0, scale: 0.85 }} animate={inView ? { opacity: 1, scale: 1 } : undefined} transition={spring(0.3, 0.6)}>
              <circle r={er + 18} fill="none" stroke="var(--accent)" strokeOpacity={0.12} />
              {/* the orbiting rings only spin while the diagram is on screen (an infinite SVG animation ticks every frame) */}
              {visible && !reduce ? <>
                <motion.circle r={er + 8} fill="none" stroke="var(--accent)" strokeOpacity={0.35} strokeWidth={1.5} strokeDasharray="3 7" animate={{ rotate: 360 }} transition={{ duration: 24, repeat: Infinity, ease: 'linear' }} />
                <motion.circle r={er + 18} fill="none" stroke="var(--accent)" strokeOpacity={0.25} strokeDasharray="40 300" animate={{ rotate: -360 }} transition={{ duration: 9, repeat: Infinity, ease: 'linear' }} />
              </> : <>
                <circle r={er + 8} fill="none" stroke="var(--accent)" strokeOpacity={0.35} strokeWidth={1.5} strokeDasharray="3 7" />
                <circle r={er + 18} fill="none" stroke="var(--accent)" strokeOpacity={0.25} strokeDasharray="40 300" />
              </>}
              <circle r={er} className="fill-[var(--card)] stroke-[var(--line)]" />
              <circle ref={pulseC} r={er} fill="var(--accent)" fillOpacity={0.08} />
              <text y={-4} textAnchor="middle" className="fill-[var(--fg)] [font:600_13px_var(--font)]">{engine}</text>
              <AnimatePresence mode="wait" initial={false}>
                <motion.text key={stage} y={15} textAnchor="middle" className={cn('fill-[var(--fg3)]', tall ? '[font:500_12.5px_var(--font)]' : '[font:500_11px_var(--font)]')} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.18 }}>{stages[stage]}</motion.text>
              </AnimatePresence>
            </motion.g>
          </g>
        </svg>
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {stat('Throughput', paused ? 0 : stats.tp, 'ev/s')}{stat('Processed', stats.processed)}{stat('In flight', stats.inflight)}{stat('Latency p95', stats.p95, 'ms')}
      </div>
    </div>
  )
}
