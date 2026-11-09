import { Fragment, useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent } from 'react'
import { motion, useInView } from 'motion/react'
import { Avatar, Button, Chip, ScrollEdges, TOUCH, addDays, cn, fmtDate, isTouch, maxOf, minOf, onMouseLeave, spring, surface, useLongPress, useOutside, usePointerDrag, useScrollEdges, useWidth } from './core'
import { Collapse } from './feedback'
import { PointerTooltip, usePointerTooltip } from './overlay'
import { DG_COLLAPSE_STICKY, DgChevron, dgSafeId } from './diagramkit'

/* DIAGRAMS · Gantt: a project plan with dependencies, critical path, baseline and workload. */

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
 * Tasks with duration 0 are milestones; `milestone` (default: the last one) anchors the critical path. Thin connectors
 * drop from each phase bar to its tasks' starts (brighter for the task under the pointer).
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
  const slackOf = (id: string) => { const ss = succs(id); return ss.length ? Math.max(0, minOf(ss.map(s => sched[s].s)) - ganttEnd(sched[id])) : 0 }

  const update = (id: string, next: { s: number; d: number }) => setSched(prev => {
    const S = Object.fromEntries(Object.entries(prev).map(([k, v]) => [k, { ...v }])); S[id] = next
    const push = (a: string) => succs(a).forEach(b => { const need = maxOf(preds(b).map(p => ganttEnd(S[p]))); if (S[b].s < need) { S[b].s = need; push(b) } })
    push(id); return S
  })
  const moveTo = (id: string, s: number, d: number) => {
    const t = byId[id], ms = t.duration === 0
    const nd = ms ? 0 : Math.max(1, Math.min(days - s, d))
    const minS = maxOf(preds(id).map(p => ganttEnd(sched[p])), 0)
    const ns = Math.max(minS, Math.min(days - Math.max(1, nd), s))
    if (ns !== sched[id].s || nd !== sched[id].d) update(id, { s: ns, d: nd })
  }

  // row geometry for the arrows (phase rows, then their tasks while open)
  const rowY: Record<string, number> = {}, phaseY: Record<string, number> = {}
  let r = 0
  phases.forEach(p => { phaseY[p.id] = r * GANTT_ROW; r++; if (open[p.id]) p.tasks.forEach(t => { rowY[t.id] = r * GANTT_ROW; r++ }) })
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

  // phase → task connectors: down from the phase bar at the task's start, then a short tick into the task bar
  const spawns = phases.filter(p => open[p.id]).flatMap(p => p.tasks.map(t => {
    const ms = t.duration === 0, x = X(sched[t.id].s) - (ms ? 9 : 0) - 6, y1 = phaseY[p.id] + 24, y2 = barMid(t.id)
    return { key: t.id, on: hover === t.id, d: `M${x},${y1} V${y2 - 4} Q${x},${y2} ${x + 4},${y2} H${x + 7}` }
  }))
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
          {/* under the rows, so bars and pinned names paint over them */}
          {laneW > 0 && (
            <svg width={laneW} height={bodyH} className="pointer-events-none absolute top-0 left-[var(--gs)] overflow-visible" aria-hidden>
              {spawns.map(c => <motion.path key={c.key} initial={false} animate={{ d: c.d }} transition={dragId ? { duration: 0 } : spring(0.1, 0.35)} fill="none" strokeWidth={1}
                className={cn('transition-[stroke] duration-200', c.on ? 'stroke-[color-mix(in_srgb,var(--accent)_75%,var(--fg2))]' : 'stroke-[color-mix(in_srgb,var(--fg3)_50%,transparent)]')} />)}
            </svg>
          )}
          {phases.map(p => {
            const ts = p.tasks.map(t => ({ ...sched[t.id], t }))
            const s = minOf(ts.map(x => x.s)), e = maxOf(ts.map(ganttEnd)), tot = ts.reduce((a, x) => a + x.d, 0) || 1
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
                    <div className="absolute top-[14px] h-[10px] rounded-[var(--r-sm)] bg-[color-mix(in_srgb,var(--fg3)_25%,var(--card))] transition-[left,width] duration-250 ease-[cubic-bezier(.22,1,.36,1)]"
                      style={{ left: pct(s), width: pct(Math.max(0.5, e - s)) }}>
                      <i className="absolute inset-y-0 left-0 rounded-[var(--r-sm)] bg-[var(--fg2)] opacity-60" style={{ width: `${pr * 100}%` }} />
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
                          <span className={cn('pointer-events-none absolute top-8 h-1 rounded-[var(--r-sm)] bg-[var(--fg3)] transition-opacity duration-200', view.bl ? 'opacity-45' : 'opacity-0')}
                            style={{ left: pct(t.start), width: pct(Math.max(0.4, t.duration)) }} />
                          <span title={sl ? `${sl} days of slack` : undefined} className={cn('pointer-events-none absolute top-[18px] h-0.5 bg-[length:6px_2px] bg-[linear-gradient(90deg,var(--fg3)_50%,transparent_50%)] transition-[opacity,left,width] duration-250', view.cp ? 'opacity-80' : 'opacity-0')}
                            style={{ left: pct(ganttEnd(x)), width: pct(isCrit ? 0 : sl) }} />
                          {ms ? (
                            <motion.span role="slider" tabIndex={0} aria-label={`${t.name} milestone, ${fdate(x.s)}`} aria-valuemin={0} aria-valuemax={days} aria-valuenow={x.s} aria-valuetext={fdate(x.s)}
                              className={cn('absolute top-[13px] -ml-[7px] h-3.5 w-3.5 cursor-grab rounded-[var(--r-sm)] shadow-[0_0_0_3px_var(--card)] transition-[left] duration-250 ease-[cubic-bezier(.22,1,.36,1)] select-none [-webkit-touch-callout:none]',
                                '[@media(pointer:coarse)]:top-[8px] [@media(pointer:coarse)]:-ml-[11.5px] [@media(pointer:coarse)]:h-[23px] [@media(pointer:coarse)]:w-[23px]',
                                view.cp && isCrit ? 'bg-[var(--bad)]' : 'bg-[var(--c3)]', dragging && 'cursor-grabbing !transition-none')}
                              style={{ left: pct(x.s), rotate: 45 }} initial={{ scale: 0 }} animate={inView ? { scale: 1 } : undefined} transition={{ duration: 0.45, delay: i * 0.05, ease: [0.22, 1, 0.36, 1] }}
                              {...barEvents(t.id)} />
                          ) : (
                            <motion.div role="slider" tabIndex={0} aria-label={`${t.name}, ${fdate(x.s)} to ${fdate(ganttEnd(x) - 1)}, ${x.d} days. Arrow keys move, Shift + arrows resize`}
                              aria-valuemin={0} aria-valuemax={days} aria-valuenow={x.s} aria-valuetext={`${fdate(x.s)}, ${x.d} days`}
                              className={cn('absolute flex origin-left cursor-grab items-center overflow-hidden rounded-[var(--r-md)] transition-[left,width,top,height,opacity,box-shadow] duration-250 ease-[cubic-bezier(.22,1,.36,1)] select-none [-webkit-touch-callout:none]',
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
                          className={cn('absolute top-[9px] grid h-5 place-items-center rounded-[var(--r-sm)] font-[family-name:var(--mono)] text-[11px] font-semibold', GANTT_CELL[Math.min(3, n) as 1 | 2 | 3])}
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
        <span className="inline-flex items-center gap-1.5"><i className="inline-block h-2 w-4 rounded-[var(--r-sm)] bg-[var(--fg2)] opacity-60" />Phase</span>
        <span className="inline-flex items-center gap-1.5"><i className="inline-block h-2.5 w-2.5 rotate-45 rounded-[var(--r-sm)] bg-[var(--c3)]" />Milestone</span>
        <span className="inline-flex items-center gap-1.5"><i className="inline-block h-3 w-0.5 bg-[var(--accent)]" />Today</span>
        <span className="text-[var(--fg3)] [@media(pointer:coarse)]:hidden">Hover a task to see its links</span>
        <span className="hidden text-[var(--fg3)] [@media(pointer:coarse)]:inline">Tap a task for its links · hold a bar to move it, drag its grip to resize</span>
        {view.cp && <><span className="inline-flex items-center gap-1.5"><i className="inline-block h-2 w-4 rounded-[var(--r-sm)] shadow-[inset_0_0_0_1.5px_var(--bad)]" />Critical path</span>
          <span className="inline-flex items-center gap-1.5"><i className="inline-block w-4 border-t-2 border-dashed border-[var(--fg3)]" />Slack</span></>}
        {view.bl && <span className="inline-flex items-center gap-1.5"><i className="inline-block h-1 w-4 rounded-[var(--r-sm)] bg-[var(--fg3)] opacity-50" />Baseline</span>}
        {final && <span className={cn('ml-auto', late > 0 ? 'text-[var(--bad)]' : 'text-[var(--fg2)]')}>
          {phases.find(p => p.id === byId[final].phase)?.name} {fdate(sched[final].s)}{late > 0 ? ` · ${late} days later than planned` : late < 0 ? ` · ${-late} days early` : ' · on plan'}</span>}
      </div>
      <PointerTooltip tip={tip} />
    </div>
  )
}
