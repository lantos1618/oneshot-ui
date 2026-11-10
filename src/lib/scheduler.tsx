import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode, type KeyboardEvent as RKeyboardEvent, type PointerEvent as RPointerEvent } from 'react'
import { AnimatePresence, motion } from './motionkit'
import { Avatar, AvatarStack, Button, useCoarsePointer, IconButton, ScrollEdges, TOUCH, addDays, addMonths, cn, dateFormat, dayKey, maxOf, safeColor, sameDay, spring, startOfDay, startOfWeek, surface, useControllable, usePointerDrag, useScrollEdges, useWidth, plural, fmt, LOCALE, useLive, useLatestState, uid, haptic, MOVE_SLOP } from './core'
import { SegmentedControl } from './fields'
import { useToast } from './feedback'

export type SchedulerEvent = {
  id: string; /** the day (time is ignored) */ date: Date; /** hours from midnight, e.g. 9.5 = 09:30 */ start: number; /** hours */ duration: number
  title: string; /** any CSS colour, e.g. 'var(--c3)' */ color?: string; attendees?: string[]
}
export type SchedulerView = 'day' | '3day' | 'week' | 'month' | 'year'

/** Saturday and Sunday (Date#getDay). */
const SC_WEEKEND = [6, 0]
/** Weeks start on Monday (en-GB, as fmt.weekdays). */
const SC_WEEK_START = 1

const SC_VIEWS: SchedulerView[] = ['year', 'month', 'week', '3day', 'day']
/** fractional hours as a Date on a fixed day, for formatting as a clock time in the locale (9.5 → "09:30" / "9:30 AM") */
const scAt = (h: number) => { const m = Math.round(h * 60); return new Date(2000, 0, 1, Math.floor(m / 60), m % 60) }
const SC_SNAP = 0.25
/** how long a finger has to rest before a touch creates or moves an event (so swipes still scroll) */
const SC_HOLD = 380
/** below this width the scheduler switches to phone layout: 3-day default, swipeable week, dots in month */
const SC_NARROW = 640
/** a drag of an event or a chip starts after this many px (a smaller wobble is still a tap) */
const SC_DRAG_START = 4
/** days shown by each time-grid view */
const SC_SPAN = { day: 1, '3day': 3, week: 7 } as const satisfies Partial<Record<SchedulerView, number>>
type ScGridView = keyof typeof SC_SPAN
/** the time gutter's width (px); narrow is 44px = Tailwind's scroll-ps-11 on the swipeable week */
const SC_GUTTER = { narrow: 44, wide: 52 } as const
/** the time grid's height cap, and the placeholder's height before mount (full class names, for Tailwind) */
const SC_GRID_H = { max: 'max-h-[min(460px,75svh)]', fixed: 'h-[min(460px,75svh)]' } as const

type ScDrag =
  | { mode: 'create'; ev: SchedulerEvent; anchor: number; top: number }
  | { mode: 'move' | 'resize'; ev: SchedulerEvent; sx: number; sy: number; s0: number; du0: number; d0: Date; cols: [number, number, number][]; moved: boolean; touch: boolean }
  | { mode: 'chip'; ev: SchedulerEvent; sx: number; sy: number; ox: number; oy: number; w: number; started: boolean; x: number; y: number; cell: number | null }

/**
 * Calendar with Day, Week, Month and Year views (plus 3-day on phones). In Day/Week, drag on empty time to
 * create an event (then type its title), drag an event to move it (across days too) or its bottom edge to
 * resize, all on a 15-minute snap. In Month, drag chips between days. Click any date to zoom in; ← / → and
 * the arrows page through time. Under ~640px it opens on a 3-day view, the week swipes sideways with snap,
 * month cells show dots, and tapping an event shows its details. On touch, press and hold to create or move
 * (a swipe keeps scrolling); a tapped (selected) event drags straight away and shows a resize grip.
 */
export function Scheduler({ events, defaultEvents = [], onChange, defaultView = 'week', today: todayProp, startHour = 8, endHour = 19, hourHeight = 44, newEvent, className }:
  { events?: SchedulerEvent[]; defaultEvents?: SchedulerEvent[]; onChange?: (e: SchedulerEvent[]) => void; defaultView?: SchedulerView
    /** fills in an event created by dragging on empty time (e.g. the current user as attendee, a colour); the drag still sets its date and times */
    newEvent?: (draft: SchedulerEvent) => Partial<Omit<SchedulerEvent, 'date' | 'start' | 'duration'>>
    /** the day treated as today (opening date, highlight); by default the client's date, read after mount so server and client render the same */ today?: Date
    startHour?: number; endHour?: number; hourHeight?: number; className?: string }) {
  const [list, setList] = useControllable(events, defaultEvents, onChange)
  const ref = useRef(list); ref.current = list
  const commit = (next: SchedulerEvent[]) => { ref.current = next; setList(next) }
  const [view, setView] = useState<SchedulerView>(defaultView)
  // the clock is read after mount (and every minute, for the now-line), never during a server render
  const [now, setNow] = useState<Date | null>(null)
  useEffect(() => { const tick = () => setNow(new Date()); tick(); const t = setInterval(tick, 60_000); return () => clearInterval(t) }, [])
  const today = todayProp ?? now
  const [curState, setCur] = useState<Date | null>(() => todayProp ? startOfDay(todayProp) : null)
  const cur = curState ?? today ?? new Date(0) // only the pre-mount render, which shows no dates, sees the fallback
  const ready = !!(curState ?? today)
  useEffect(() => { if (!curState && now) setCur(startOfDay(now)) }, [now]) // eslint-disable-line react-hooks/exhaustive-deps
  const [trans, setTrans] = useState<{ zoom?: number; dir?: number }>({})
  const [drag, setDrag, getDrag] = useLatestState<ScDrag | null>(null)
  const [naming, setNaming, getNaming] = useLatestState<string | null>(null)
  const [picked, setPicked] = useState<string | null>(null)
  const [pending, setPending] = useState<{ x: number; y: number } | null>(null)
  const toast = useToast(), locale = LOCALE
  const isWeekend = (d: Date) => SC_WEEKEND.includes(d.getDay())
  // events are wall-clock times on local calendar days: format them in the locale but never shift them into the provider's time zone
  const scDf = (d: Date, o: Intl.DateTimeFormatOptions) => dateFormat(locale, o.hour ? { ...o, hourCycle: 'h23' } : o).format(d)
  const scHM = (h: number) => scDf(scAt(h), { hour: 'numeric', minute: '2-digit' })
  const dayNum = (d: Date) => scDf(d, { day: 'numeric' })
  const sow = (d: Date) => startOfWeek(d, SC_WEEK_START)
  /** the days a time-grid view shows */
  const gridDays = (v: ScGridView, c: Date) => v === 'week' ? Array.from({ length: 7 }, (_, i) => addDays(sow(c), i)) : Array.from({ length: SC_SPAN[v] }, (_, i) => addDays(startOfDay(c), i))
  const [root, rootW] = useWidth<HTMLDivElement>()
  const narrow = rootW > 0 && rootW < SC_NARROW
  const chosen = useRef(false)
  // phones open on 3 days instead of a week of 35px columns (until the user picks a view themselves)
  useEffect(() => { if (narrow && !chosen.current && view === 'week') setView('3day') }, [narrow]) // eslint-disable-line react-hooks/exhaustive-deps
  const H0 = startHour, H1 = endHour, hr = hourHeight

  const go = (v: SchedulerView, date?: Date) => { setTrans({ zoom: Math.sign(SC_VIEWS.indexOf(v) - SC_VIEWS.indexOf(view)) }); if (date) setCur(date); setView(v); setPicked(null) }
  const shift = (dir: number) => {
    setTrans({ dir }); setPicked(null)
    const c = cur
    setCur(view === 'month' ? addMonths(c, dir) : view === 'year' ? new Date(c.getFullYear() + dir, 0, 1) : addDays(c, SC_SPAN[view] * dir))
  }
  const on = (d: Date) => ref.current.filter(e => sameDay(e.date, d)).sort((a, b) => a.start - b.start)
  const scFmt = (d: Date, o: Intl.DateTimeFormatOptions) => ready ? scDf(d, o) : '\u00a0'
  /** "9 – 15 Nov 2026" in the locale's own range shape (Intl formatRange) */
  const range = (a: Date, b: Date) => {
    if (!ready) return '\u00a0'
    const f = dateFormat(locale, { day: 'numeric', month: 'short', year: 'numeric' }) as Intl.DateTimeFormat & { formatRange?: (a: Date, b: Date) => string }
    return f.formatRange ? f.formatRange(a, b) : `${f.format(a)} – ${f.format(b)}`
  }
  const title = view === 'day' ? scFmt(cur, narrow ? { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' } : { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
    : view === '3day' ? range(cur, addDays(cur, 2))
      : view === 'week' ? range(sow(cur), addDays(sow(cur), 6))
        : view === 'month' ? scFmt(cur, { month: 'long', year: 'numeric' }) : scFmt(cur, { year: 'numeric' })
  const period = view === 'year' ? cur.getFullYear() : view === 'month' ? `${cur.getFullYear()}-${cur.getMonth()}` : view === 'week' ? dayKey(sow(cur)) : `${view}:${dayKey(cur)}`

  /* ---- gestures ----
   * Mouse and pen: one pointer drag (usePointerDrag, captured on the root, so an event re-rendering into another day
   * column keeps the pointer). Touch: the finger has to rest SC_HOLD ms first (moving earlier is a scroll and cancels),
   * except on the selected event, which drags straight away. Touch moves are followed through touch events on the
   * touched node, which (unlike pointer events) can stop the page scrolling and keep coming when the node re-renders. */
  const gs = useRef<{ begin: () => ScDrag | null; onTap?: () => void; armed: boolean; timer: number; lx: number; ly: number } | null>(null)
  const ptrDrag = usePointerDrag({
    onMove: p => {
      const g = gs.current; if (!g) return
      g.lx = p.x; g.ly = p.y
      if (!g.armed) { if (Math.hypot(p.dx, p.dy) > MOVE_SLOP) ptrDrag.cancel(); return }
      dragMove(p.x, p.y)
    },
    onEnd: (p, cancelled) => {
      const g = gs.current; gs.current = null; if (!g) return
      clearTimeout(g.timer); setPending(null)
      if (g.armed) { if (cancelled) setDrag(null); else dragUp() }
      else if (!cancelled && Math.hypot(p.dx, p.dy) <= MOVE_SLOP) g.onTap?.()
    },
  })
  const gesture = (e: RPointerEvent, begin: () => ScDrag | null, hold: boolean, onTap?: () => void) => {
    const sx = e.clientX, sy = e.clientY
    const showPending = () => { const r = root.current?.getBoundingClientRect(); if (r) setPending({ x: sx - r.left, y: sy - r.top }) }
    if (e.pointerType !== 'touch') {
      ptrDrag.start(e, root.current)
      const g = { begin, onTap, armed: false, timer: 0, lx: sx, ly: sy }
      gs.current = g
      const arm = () => { const d = begin(); if (!d) return ptrDrag.cancel(); g.armed = true; setPending(null); setDrag(d); if (hold) haptic(10); dragMove(g.lx, g.ly) }
      if (hold) { showPending(); g.timer = window.setTimeout(arm, SC_HOLD) } else arm()
      return
    }
    const el = e.target as HTMLElement
    let armed = !hold, timer = 0, lx = sx, ly = sy
    const arm = () => { const d = begin(); if (!d) return end(); armed = true; timer = 0; setPending(null); setDrag(d); if (hold) haptic(10); dragMove(lx, ly) }
    const move = (x: number, y: number) => {
      lx = x; ly = y
      if (!armed) { if (Math.hypot(x - sx, y - sy) > MOVE_SLOP) end(); return }
      dragMove(x, y)
    }
    const onTouch = (ev: TouchEvent) => { const t = ev.touches[0]; if (!t) return; if (armed && ev.cancelable) ev.preventDefault(); move(t.clientX, t.clientY) }
    const noMenu = (ev: Event) => { if (armed || timer) ev.preventDefault() }
    const end = () => {
      clearTimeout(timer); setPending(null)
      el.removeEventListener('touchmove', onTouch); el.removeEventListener('touchend', up); el.removeEventListener('touchcancel', up)
      removeEventListener('contextmenu', noMenu)
    }
    const up = () => { const was = armed, still = Math.hypot(lx - sx, ly - sy) <= MOVE_SLOP; end(); if (was) dragUp(); else if (still) onTap?.() }
    el.addEventListener('touchmove', onTouch, { passive: false }); el.addEventListener('touchend', up); el.addEventListener('touchcancel', up)
    addEventListener('contextmenu', noMenu)
    if (hold) { showPending(); timer = window.setTimeout(arm, SC_HOLD) } else arm()
  }
  const snapAt = (y: number, top: number, round: (n: number) => number) => round(((y - top) / hr + H0) / SC_SNAP) * SC_SNAP
  const downGrid = (e: RPointerEvent, day: Date) => {
    if (e.button !== 0 || (e.target as HTMLElement).closest('[data-sc-ev],input')) return
    const touch = e.pointerType !== 'mouse'
    if (!touch) e.preventDefault()
    setPicked(null)
    const col = e.currentTarget as HTMLElement, y = e.clientY
    gesture(e, () => {
      const r = col.getBoundingClientRect()
      const at = Math.min(H1 - SC_SNAP, Math.max(H0, snapAt(y, r.top, Math.floor)))
      const draft: SchedulerEvent = { id: uid('ev'), date: day, start: at, duration: SC_SNAP * 2, title: 'New event', color: 'var(--accent)', attendees: [] }
      return { mode: 'create', ev: { ...draft, ...newEvent?.(draft), date: day, start: at, duration: draft.duration }, anchor: at, top: r.top }
    }, touch)
  }
  const downEvent = (e: RPointerEvent, ev: SchedulerEvent) => {
    if (e.button !== 0 || (e.target as HTMLElement).closest('input')) return
    const touch = e.pointerType !== 'mouse'
    e.stopPropagation(); if (!touch || picked === ev.id) e.preventDefault()
    const resize = !!(e.target as HTMLElement).closest('[data-sc-resize]'), sx = e.clientX, sy = e.clientY
    gesture(e, () => {
      const cols = [...(root.current?.querySelectorAll<HTMLElement>('[data-sc-col]') ?? [])].map(c => { const r = c.getBoundingClientRect(); return [Number(c.dataset.scCol), r.left, r.right] as [number, number, number] })
      return { mode: resize ? 'resize' : 'move', ev, sx, sy, s0: ev.start, du0: ev.duration, d0: ev.date, cols, moved: false, touch }
    }, touch && picked !== ev.id, () => setPicked(p => p === ev.id ? null : ev.id))
  }
  const downChip = (e: RPointerEvent, ev: SchedulerEvent) => {
    if (e.button !== 0) return
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
    const touch = e.pointerType !== 'mouse'
    const sx = e.clientX, sy = e.clientY
    gesture(e, () => ({ mode: 'chip', ev, sx, sy, ox: sx - r.left, oy: sy - r.top, w: r.width, started: touch, x: r.left, y: r.top, cell: null }), touch, () => go('day', new Date(ev.date)))
  }
  const dragMove = (x: number, y: number) => {
    const d = getDrag(); if (!d) return
    if (d.mode === 'create') {
      const t = Math.min(H1, Math.max(H0, snapAt(y, d.top, Math.round)))
      const a = Math.min(d.anchor, t), b = Math.max(d.anchor + SC_SNAP, t)
      setDrag({ ...d, ev: { ...d.ev, start: a, duration: Math.max(SC_SNAP, b - a) } })
    } else if (d.mode === 'resize') {
      const dy = (y - d.sy) / hr
      setDrag({ ...d, moved: d.moved || Math.abs(y - d.sy) > SC_DRAG_START, ev: { ...d.ev, duration: Math.max(SC_SNAP, Math.min(H1 - d.ev.start, Math.round((d.du0 + dy) / SC_SNAP) * SC_SNAP)) } })
    } else if (d.mode === 'move') {
      const dy = (y - d.sy) / hr, hit = d.cols.find(([, l, r]) => x >= l && x < r)
      setDrag({ ...d, moved: d.moved || Math.hypot(x - d.sx, y - d.sy) > SC_DRAG_START, ev: { ...d.ev, start: Math.max(H0, Math.min(H1 - d.ev.duration, Math.round((d.s0 + dy) / SC_SNAP) * SC_SNAP)), date: hit ? new Date(hit[0]) : d.ev.date } })
    } else if (d.mode === 'chip') {
      if (!d.started && Math.hypot(x - d.sx, y - d.sy) <= SC_DRAG_START) return
      const hitEl = document.elementFromPoint(x, y)?.closest<HTMLElement>('[data-sc-cell]'), cell = hitEl && root.current?.contains(hitEl) ? hitEl : null
      setDrag({ ...d, started: true, x: x - d.ox, y: y - d.oy, cell: cell ? Number(cell.dataset.scCell) : null })
    }
  }
  const dragUp = () => {
    const d = getDrag(); setDrag(null); if (!d) return
    if (d.mode === 'create') { commit([...ref.current, d.ev]); setNaming(d.ev.id); return }
    if (d.mode === 'chip') {
      if (!d.started) { go('day', new Date(d.ev.date)); return }
      if (d.cell !== null && !sameDay(new Date(d.cell), d.ev.date)) {
        const date = new Date(d.cell)
        commit(ref.current.map(x => x.id === d.ev.id ? { ...x, date } : x))
        toast({ title: 'Event moved', description: `${d.ev.title} → ${scFmt(date, { weekday: 'short', day: 'numeric', month: 'short' })}` })
      }
      return
    }
    // a tap (no movement) selects the event: on phones that shows its details and lets it drag at once
    if (!d.moved) { if (d.touch || narrow) setPicked(p => p === d.ev.id ? null : d.ev.id); return }
    const o = ref.current.find(x => x.id === d.ev.id)
    if (o && (o.start !== d.ev.start || o.duration !== d.ev.duration || !sameDay(o.date, d.ev.date))) commit(ref.current.map(x => x.id === d.ev.id ? d.ev : x))
  }

  /* ---- keyboard on a focused event: ← / → move it a day, ↑ / ↓ by 15 minutes (Shift: resize); focus stays on it ---- */
  const [setSaid, live] = useLive()
  const refocus = useRef<string | null>(null)
  useEffect(() => { // after a keyboard move the event may re-render in another column (or period): put focus back on it
    const id = refocus.current; if (!id) return
    let n = 0, raf = 0
    const tryFocus = () => {
      const el = root.current?.querySelector<HTMLElement>(`[data-sc-ev="${CSS.escape(id)}"]`)
      if (el) { refocus.current = null; if (document.activeElement !== el) el.focus({ preventScroll: false }) } else if (n++ < 40) raf = requestAnimationFrame(tryFocus)
    }
    tryFocus()
    return () => cancelAnimationFrame(raf)
  })
  const keyEvent = (e: RKeyboardEvent, ev: SchedulerEvent, days: Date[]) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); setPicked(p => p === ev.id ? null : ev.id); return }
    const key = e.key
    const dDay = key === 'ArrowLeft' ? -1 : key === 'ArrowRight' ? 1 : 0, dMin = key === 'ArrowUp' ? -SC_SNAP : key === 'ArrowDown' ? SC_SNAP : 0
    if (!dDay && !dMin) return
    e.preventDefault(); e.stopPropagation() // never let the scheduler page through time while an event has focus
    let next: SchedulerEvent
    if (dMin && e.shiftKey) next = { ...ev, duration: Math.max(SC_SNAP, Math.min(H1 - ev.start, ev.duration + dMin)) }
    else if (dMin) next = { ...ev, start: Math.max(H0, Math.min(H1 - ev.duration, ev.start + dMin)) }
    else next = { ...ev, date: addDays(ev.date, dDay) }
    if (next.start === ev.start && next.duration === ev.duration && sameDay(next.date, ev.date)) return
    commit(ref.current.map(x => x.id === ev.id ? next : x))
    refocus.current = ev.id
    // moved past the visible days: page along with it
    if (dDay && !days.some(d => sameDay(d, next.date))) { setTrans({ dir: dDay }); setCur(view === 'day' ? startOfDay(next.date) : addDays(cur, SC_SPAN[view as ScGridView] * dDay)) }
    setSaid(`${next.title}: ${scFmt(next.date, { weekday: 'long', day: 'numeric', month: 'long' })}, ${scHM(next.start)} to ${scHM(next.start + next.duration)}`)
  }

  const finishName = (ev: SchedulerEvent, value: string | null) => {
    if (getNaming() !== ev.id) return
    setNaming(null)
    if (value === null) { commit(ref.current.filter(x => x.id !== ev.id)); return }
    const name = value.trim() || 'New event'
    commit(ref.current.map(x => x.id === ev.id ? { ...x, title: name } : x))
    toast({ title: 'Event created', description: `${name} · ${scFmt(ev.date, { weekday: 'short', day: 'numeric', month: 'short' })} · ${scHM(ev.start)}` })
  }

  /* ---- views ---- */
  const scroller = useRef<HTMLDivElement | null>(null), placed = useRef<HTMLDivElement | null>(null)
  const swipeWeek = narrow && view === 'week'
  // each new time grid (view or period change) opens just after the start hour, and a swipeable week on today's column
  const placeGrid = useCallback((el: HTMLDivElement | null) => {
    scroller.current = el; edgeRef(el)
    if (!el || el === placed.current) return
    placed.current = el; el.scrollTop = hr * 0.5
    // today's column just past the sticky 44px time gutter at the start edge
    const td = el.querySelector<HTMLElement>('[data-sc-today]')
    if (td) { const er = el.getBoundingClientRect(), tr = td.getBoundingClientRect(); el.scrollLeft += tr.left - (er.left + SC_GUTTER.narrow) }
  }, [hr]) // eslint-disable-line react-hooks/exhaustive-deps
  const nowH = now ? now.getHours() + now.getMinutes() / 60 : -1
  const [edgeRef, edges] = useScrollEdges<HTMLDivElement>()

  const gridView = () => {
    const days = gridDays(view as ScGridView, cur)
    // on a phone the week keeps readable columns and scrolls sideways (snapping per day) under a sticky time gutter
    const cols = { gridTemplateColumns: `${narrow ? SC_GUTTER.narrow : SC_GUTTER.wide}px repeat(${days.length},minmax(${swipeWeek ? 92 : 0}px,1fr))` }
    const live = drag && drag.mode !== 'chip' ? drag.ev : null
    const gut = 'sticky start-0 z-[6] bg-[var(--card)]'
    return (
      <div className="relative">
        <div ref={placeGrid} className={cn('relative overflow-auto overscroll-x-contain', SC_GRID_H.max, swipeWeek && 'snap-x snap-mandatory scroll-ps-11')}>
          <div className="grid min-w-full" style={cols}>
            <div className={cn(gut, 'top-0 z-[8] border-b border-[var(--line)]')} />
            {days.map(d => {
              const td = sameDay(d, today), wide = view !== 'day'
              return (
                <button key={+d} onClick={() => wide && go('day', d)} aria-label={`${scFmt(d, { weekday: 'short' })} ${dayNum(d)}, ${scFmt(d, { weekday: 'long', day: 'numeric', month: 'long' })}`} data-sc-today={td && swipeWeek ? '' : undefined}
                  className={cn('sticky top-0 z-[7] snap-start border-0 border-b border-[var(--line)] bg-[var(--card)] px-1.5 py-2 text-center text-xs text-[var(--fg3)]', wide && 'cursor-pointer hover:bg-[var(--muted)]')}>
                  {scFmt(d, { weekday: 'short' })}{' '}{/* the space keeps the visible text "Mon 9", which starts the name */}
                  <b className={cn('mx-auto block text-base leading-tight font-semibold', td ? 'mt-0.5 h-[30px] w-[30px] rounded-full bg-[var(--bad)] leading-[30px] text-[var(--card)]' : 'text-[var(--fg)]')}>{ready ? dayNum(d) : '\u00a0'}</b>
                </button>
              )
            })}
            <div className={gut} style={{ height: (H1 - H0) * hr }}>

              {Array.from({ length: H1 - H0 - 1 }, (_, i) => (
                <span key={i} className="absolute end-2 -translate-y-1/2 font-[family-name:var(--mono)] text-[11px] text-[var(--fg3)]" style={{ top: (i + 1) * hr }}>{scDf(scAt(H0 + i + 1), { hour: '2-digit', minute: '2-digit' })}</span>
              ))}
            </div>
            {days.map(d => {
              const evs = on(d).filter(e => e.id !== live?.id)
              if (live && sameDay(live.date, d)) evs.push(live)
              return (
                <div key={+d} data-sc-col={+d} onPointerDown={e => downGrid(e, d)}
                  className={cn('relative cursor-cell border-s border-[var(--line)] bg-[linear-gradient(var(--line)_1px,transparent_1px)] select-none [-webkit-touch-callout:none] [@media(pointer:fine)]:touch-none', isWeekend(d) && 'bg-[color-mix(in_srgb,var(--muted)_50%,transparent)]')}
                  style={{ height: (H1 - H0) * hr, backgroundSize: `100% ${hr}px` }}>
                  {sameDay(d, now) && nowH > H0 && nowH < H1 && (
                    <div className="pointer-events-none absolute inset-x-0 z-[4] h-0.5 bg-[var(--bad)] before:absolute before:-top-1 before:-start-[5px] before:h-2.5 before:w-2.5 before:rounded-full before:bg-[var(--bad)]" style={{ top: (nowH - H0) * hr }} />
                  )}
                  {evs.map(ev => {
                    const h = Math.max(18, ev.duration * hr - 2), isLive = live?.id === ev.id, people = ev.attendees ?? [], sel = picked === ev.id && !isLive
                    return (
                      <motion.div key={ev.id} data-sc-ev={ev.id} layout={!isLive} initial={naming === ev.id ? { scale: 0.96 } : false} animate={{ scale: 1 }} transition={spring(0.4, 0.3)}
                        onPointerDown={e => downEvent(e, ev)} role="button" tabIndex={0} aria-pressed={picked === ev.id}
                        aria-keyshortcuts="ArrowLeft ArrowRight ArrowUp ArrowDown" aria-description={'Arrows move it, Shift with up or down changes its length'}
                        onKeyDown={e => keyEvent(e, ev, days)}
                        className={cn('absolute end-[3px] start-[3px] flex cursor-grab flex-col overflow-hidden rounded-[var(--r-md)] px-2 py-1 text-xs leading-[1.3] outline-none [@media(pointer:coarse)]:min-h-8 select-none [-webkit-touch-callout:none] focus-visible:shadow-[inset_0_0_0_2px_var(--ec)] [@media(pointer:fine)]:touch-none',
                          narrow && 'px-1.5',
                          'bg-[color-mix(in_srgb,var(--ec)_13%,var(--card))] text-[color-mix(in_srgb,var(--ec)_60%,var(--fg))] shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--ec)_30%,transparent)]',
                          sel && 'z-[5] touch-none overflow-visible shadow-[inset_0_0_0_2px_var(--ec),0_6px_16px_rgba(0,0,0,.14)]',
                          isLive && 'z-[5] cursor-grabbing shadow-[inset_0_0_0_1.5px_var(--ec),0_10px_24px_rgba(0,0,0,.18)]',
                          isLive && drag?.mode === 'create' && 'bg-[color-mix(in_srgb,var(--accent)_18%,var(--card))] opacity-90')}
                        style={{ top: (ev.start - H0) * hr + 1, height: h, '--ec': ev.color ?? 'var(--accent)' } as CSSProperties}>
                        <ScEventBody title={ev.title} time={`${scHM(ev.start)} – ${scHM(ev.start + ev.duration)}`} people={people} height={h}
                          naming={naming === ev.id ? (
                            <input autoFocus placeholder={'Event title'} aria-label={'Event title'} onPointerDown={e => e.stopPropagation()}
                              onKeyDown={e => { e.stopPropagation(); if (e.key === 'Enter') e.currentTarget.blur(); if (e.key === 'Escape') finishName(ev, null) }}
                              onBlur={e => finishName(ev, e.currentTarget.value)}
                              className={cn('w-full border-0 bg-transparent p-0 text-xs font-semibold text-inherit outline-none placeholder:text-[color-mix(in_srgb,var(--ec)_50%,var(--fg3))]', TOUCH.input)} />
                          ) : null} />
                        <i data-sc-resize className={cn('absolute inset-x-0 bottom-0 h-2 cursor-ns-resize', sel && '-bottom-3 grid h-6 touch-none place-items-center')}>
                          {sel && <span className="h-1.5 w-8 rounded-full bg-[var(--ec)] shadow-[0_0_0_2px_var(--card)]" />}
                        </i>
                      </motion.div>
                    )
                  })}
                </div>
              )
            })}
          </div>
        </div>
        {swipeWeek && <ScrollEdges {...edges} hint={'Swipe for more days'} />}
      </div>
    )
  }

  const monthView = () => {
    const start = sow(addMonths(cur, 0)), m = cur.getMonth()
    const chipDrag = drag?.mode === 'chip' && drag.started ? drag : null
    return (
      <>
        <div className="grid grid-cols-7 border-b border-[var(--line)]">{fmt.weekdays(narrow ? 'narrow' : 'short').map((d, i) => <span key={i} className={cn('p-2 text-xs text-[var(--fg3)]', narrow ? 'px-0 text-center' : 'text-end')}>{d}</span>)}</div>
        <div className={cn('grid grid-cols-7', narrow ? '[grid-auto-rows:minmax(56px,auto)]' : '[grid-auto-rows:minmax(104px,auto)]')}>
          {Array.from({ length: 42 }, (_, i) => {
            const d = addDays(start, i), evs = on(d), out = d.getMonth() !== m
            // phone: the whole cell is one button (date + a dot per event); drag chips in the wider layout
            if (narrow) return (
              <button key={+d} onClick={() => go('day', d)} aria-label={`${scFmt(d, { weekday: 'long', day: 'numeric', month: 'long' })}, ${plural(evs.length, 'event', undefined, { zero: 'no events' })}`}
                className={cn('flex min-w-0 cursor-pointer flex-col items-center gap-1 border-0 border-e border-b border-[var(--line)] bg-transparent p-1 pt-1.5 [&:nth-child(7n)]:border-e-0',
                  (isWeekend(d) || out) && 'bg-[color-mix(in_srgb,var(--muted)_45%,transparent)]')}>
                {/* days of the neighbouring months: a muted date (still readable), not a faded cell */}
                <span className={cn('grid h-[26px] w-[26px] place-items-center rounded-full text-[13px] font-medium', sameDay(d, today) ? 'bg-[var(--bad)] text-[var(--card)]' : out ? 'font-normal text-[var(--fg3)]' : 'text-[var(--fg2)]')}>{dayNum(d)}</span>
                <span className="flex flex-wrap justify-center gap-[3px]">
                  {evs.slice(0, 3).map(e => <i key={e.id} className="h-1.5 w-1.5 rounded-full" style={{ background: safeColor(e.color, 'var(--accent)') }} />)}
                  {evs.length > 3 && <span className="text-[11px] leading-[6px] text-[var(--fg3)]">+</span>}
                </span>
              </button>
            )
            return (
              <div key={+d} data-sc-cell={+d}
                className={cn('flex min-w-0 flex-col gap-0.5 border-e border-b border-[var(--line)] p-1 transition-colors [&:nth-child(7n)]:border-e-0',
                  (isWeekend(d) || out) && 'bg-[color-mix(in_srgb,var(--muted)_45%,transparent)]', chipDrag?.cell === +d && '!bg-[var(--accent-soft)] shadow-[inset_0_0_0_2px_var(--accent)]')}>
                <button onClick={() => go('day', d)} aria-label={`Open ${scFmt(d, { weekday: 'long', day: 'numeric', month: 'long' })}`}
                  className={cn('h-[26px] w-[26px] cursor-pointer self-end rounded-full border-0 text-xs font-medium [@media(pointer:coarse)]:h-8 [@media(pointer:coarse)]:w-8', sameDay(d, today) ? 'bg-[var(--bad)] text-[var(--card)]' : cn('bg-transparent hover:bg-[var(--muted)] hover:text-[var(--fg)]', out ? 'font-normal text-[var(--fg3)]' : 'text-[var(--fg2)]'))}>{dayNum(d)}</button>
                {evs.slice(0, 3).map(e => (
                  <div key={e.id} data-sc-chip onPointerDown={ev => downChip(ev, e)} title={`${e.title} · ${scHM(e.start)}`} role="button" tabIndex={0}
                    onKeyDown={k => { if (k.key === 'Enter' || k.key === ' ') { k.preventDefault(); go('day', new Date(e.date)) } }}
                    className={cn('flex cursor-grab items-center gap-1.5 overflow-hidden rounded-[var(--r-md)] px-1.5 py-0.5 text-xs leading-tight whitespace-nowrap select-none [-webkit-touch-callout:none] hover:bg-[var(--muted)] [@media(pointer:coarse)]:min-h-8 [@media(pointer:fine)]:touch-none', chipDrag?.ev.id === e.id && 'opacity-30')}>
                    <i className="h-1.5 w-1.5 flex-none rounded-full" style={{ background: safeColor(e.color, 'var(--accent)') }} />
                    <span className="hidden flex-none font-[family-name:var(--mono)] text-[11px] text-[var(--fg3)] sm:inline">{scHM(e.start)}</span><span className="truncate">{e.title}</span>
                  </div>
                ))}
                {evs.length > 3 && <button onClick={() => go('day', d)} className="cursor-pointer border-0 bg-transparent px-1.5 py-0.5 text-start text-[11px] font-medium text-[var(--fg3)] hover:text-[var(--fg)] [@media(pointer:coarse)]:min-h-8">{`+${evs.length - 3} more`}</button>}
              </div>
            )
          })}
        </div>
        {chipDrag && (

          <div className="pointer-events-none fixed z-[150] flex items-center gap-1.5 rounded-[var(--r-md)] bg-[var(--card)] px-1.5 py-0.5 text-xs whitespace-nowrap shadow-[var(--shadow)]" style={{ left: chipDrag.x, top: chipDrag.y, width: chipDrag.w }}>
            <i className="h-1.5 w-1.5 flex-none rounded-full" style={{ background: safeColor(chipDrag.ev.color, 'var(--accent)') }} />
            <span className="font-[family-name:var(--mono)] text-[11px] text-[var(--fg3)]">{scHM(chipDrag.ev.start)}</span><span className="truncate">{chipDrag.ev.title}</span>
          </div>
        )}
      </>
    )
  }

  const yearView = () => {
    const y = cur.getFullYear()
    return (
      <div className={cn('grid gap-5 p-4 sm:grid-cols-3 lg:grid-cols-4', narrow ? 'grid-cols-2 gap-3 p-3' : 'grid-cols-2')}>
        {Array.from({ length: 12 }, (_, m) => {
          const first = new Date(y, m, 1), n = new Date(y, m + 1, 0).getDate(), lead = (first.getDay() - SC_WEEK_START + 7) % 7
          const days = Array.from({ length: n }, (_, i) => {
            const d = new Date(y, m, i + 1), c = on(d).length, td = sameDay(d, today)
            const cls = cn('grid aspect-square place-items-center rounded-[var(--r-sm)] p-0 text-[11px] font-medium', td ? 'bg-[var(--bad)] text-[var(--card)]' : 'text-[var(--fg2)]')
            const bg = td ? undefined : { background: `color-mix(in srgb,var(--accent) ${Math.round(Math.min(1, c / 4) * 55)}%,transparent)` }
            // phone: days are too small to tap, so the whole month is the button (opens Month view)
            return narrow ? <span key={i} className={cls} style={bg}>{dayNum(d)}</span>
              : <button key={i} onClick={() => go('day', d)} title={`${scDf(d, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })}, ${plural(c, 'event', undefined, { zero: 'no events' })}`} className={cn(cls, 'cursor-pointer border-0 hover:shadow-[inset_0_0_0_1.5px_var(--accent)]')} style={bg}>{dayNum(d)}</button>
          })
          const grid = (
            <div className="grid grid-cols-7 gap-0.5">
              {fmt.weekdays('narrow').map((c, i) => <span key={i} className="pb-0.5 text-center text-[11px] text-[var(--fg3)]">{c}</span>)}
              {Array.from({ length: lead }, (_, i) => <span key={`l${i}`} />)}
              {days}
            </div>
          )
          return narrow ? (
            <button key={m} onClick={() => go('month', first)} aria-label={`Open ${scFmt(first, { month: 'long', year: 'numeric' })}`}
              className="cursor-pointer rounded-[var(--r-md)] border-0 bg-transparent p-1 text-start hover:bg-[var(--muted)]">
              <span className="block pb-1.5 text-[13px] font-semibold">{scFmt(first, { month: 'long' })}</span>{grid}
            </button>
          ) : (
            <div key={m}>
              <button onClick={() => go('month', first)} className="cursor-pointer border-0 bg-transparent p-0 pb-2 text-start text-[13px] font-semibold hover:text-[var(--accent)]">{scFmt(first, { month: 'long' })}</button>
              {grid}
            </div>
          )
        })}
      </div>
    )
  }

  const card = useRef<HTMLDivElement>(null)
  const onKey = (e: RKeyboardEvent) => {
    if (e.key === 'Escape') { setPicked(null); return }
    // events and chips handle their own arrows; inputs and groups keep theirs
    if (e.defaultPrevented || (e.target as HTMLElement).closest('input,[role=group],[data-sc-ev],[data-sc-chip]')) return
    const key = e.key
    if (key !== 'ArrowLeft' && key !== 'ArrowRight') return
    e.preventDefault(); shift(key === 'ArrowLeft' ? -1 : 1)
    card.current?.focus({ preventScroll: true }) // the focused control is replaced by the new period: keep focus in the calendar
  }
  const z = trans.zoom ?? 0, dx = trans.dir ?? 0
  const sel = picked ? list.find(x => x.id === picked) : undefined
  const views = [{ value: 'day', label: 'Day' }, ...(narrow ? [{ value: '3day', label: '3 days' }] : []), { value: 'week', label: 'Week' }, { value: 'month', label: 'Month' }, { value: 'year', label: 'Year' }]
  const tap = TOUCH.tap36
  return (
    <div ref={root} className={cn('relative flex flex-col gap-3', className)}>
      <div className="flex flex-wrap items-center gap-2">
        <SegmentedControl size="sm" value={view} onChange={v => { chosen.current = true; go(v as SchedulerView) }} options={views}
          className={cn('[@media(pointer:coarse)]:[&>button]:h-9', narrow && 'w-full [&>button]:px-1')} />
        <Button size="sm" className={tap} onClick={() => { setTrans({}); setCur(startOfDay(today ?? new Date())); setPicked(null) }}>{'Today'}</Button>
        <span className={cn('flex-1', narrow && 'hidden')} />
        <span className={cn('flex items-center gap-2', narrow && 'flex-1')}>
          <IconButton icon="chevronLeft" label={'Previous'} variant="default" onClick={() => shift(-1)} className={TOUCH.tap36} />
          <b className={cn('text-center text-[13px] font-semibold', narrow ? 'min-w-0 flex-1' : 'min-w-[180px]')} aria-live="polite">{title}</b>
          <IconButton icon="chevronRight" label={'Next'} variant="default" onClick={() => shift(1)} className={TOUCH.tap36} />
        </span>
      </div>
      <AnimatePresence initial={false}>
        {sel && (view === 'day' || view === '3day' || view === 'week') && (
          <motion.div key="sel" initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4, transition: { duration: 0.12 } }} transition={spring(0.25, 0.3)}
            role="status" style={{ '--ec': sel.color ?? 'var(--accent)' } as CSSProperties}
            className="flex items-center gap-2.5 rounded-[var(--r-md)] border border-[color-mix(in_srgb,var(--ec)_35%,var(--line))] bg-[color-mix(in_srgb,var(--ec)_8%,var(--card))] py-1.5 pe-1.5 ps-3 text-[13px]">
            <i className="h-2 w-2 flex-none rounded-full bg-[var(--ec)]" />
            <span className="min-w-0 flex-1">
              <b className="block font-semibold [overflow-wrap:anywhere]">{sel.title}</b>
              <span className="text-xs text-[var(--fg2)]">{scFmt(sel.date, { weekday: 'short', day: 'numeric', month: 'short' })} · {scHM(sel.start)} – {scHM(sel.start + sel.duration)}</span>
            </span>
            {!!sel.attendees?.length && <AvatarStack names={sel.attendees} max={3} size={26} spread={false} className="flex-none" />}
            <IconButton icon="x" label={'Close event details'} onClick={() => setPicked(null)} className={TOUCH.tap36} />
          </motion.div>
        )}
      </AnimatePresence>
      {live}
      <div ref={card} onKeyDown={onKey} tabIndex={-1} aria-label={`Calendar, ${title}. Left and right arrows change the ${view === 'month' ? 'month' : view === 'year' ? 'year' : 'dates'}`} role="region" className={cn(surface.card, 'overflow-hidden outline-none')}>
        <AnimatePresence mode="wait" initial={false}>
          <motion.div key={`${view}:${period}`} initial={{ opacity: 0, scale: z ? (z > 0 ? 1.02 : 0.98) : 1, x: (dx * 16) }} animate={{ opacity: 1, scale: 1, x: 0 }}
            exit={{ opacity: 0, scale: z ? (z > 0 ? 0.98 : 1.02) : 1, x: (-dx * 16), transition: { duration: 0.12 } }} transition={spring(0.2, 0.32)}>
            {!ready ? <div className={SC_GRID_H.fixed} /> : view === 'month' ? monthView() : view === 'year' ? yearView() : gridView()}
          </motion.div>
        </AnimatePresence>
      </div>
      {(view === 'day' || view === '3day' || view === 'week') && (
        <p className="m-0 hidden text-xs text-[var(--fg3)] [@media(pointer:coarse)]:block">{'Press and hold empty time to add an event. Tap an event for details, then drag it or its handle.'}</p>
      )}
      {/* touch feedback while a press is being held */}
      <AnimatePresence>
        {pending && (

          <motion.span key="hold" aria-hidden className="pointer-events-none absolute z-[20] h-12 w-12 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-[var(--accent)]"

            style={{ left: pending.x, top: pending.y }}
 initial={{ scale: 0.3, opacity: 0 }} animate={{ scale: 1, opacity: 0.7 }} exit={{ opacity: 0, transition: { duration: 0.1 } }} transition={{ duration: SC_HOLD / 1000, ease: 'easeOut' }} />
        )}
      </AnimatePresence>
    </div>
  )
}

export type OrgNode = { id: string; name: string; role: string; children?: OrgNode[] }
const OC_W = 170, OC_H = 54, OC_GX = 22, OC_GY = 56

/**
 * Hierarchy laid out as a tidy tree in a fixed-height canvas that scrolls inside (the page never moves). Connectors
 * draw themselves in after every change. Click a node's count to fold its team (the badge then shows "+N" people
 * hidden); Expand all opens everything. Wide charts open scaled to fit the width (down to 55%, then they scroll,
 * centred); "Actual size" switches to 100%. Nodes move by transform.
 */
export function OrgChart({ root, defaultCollapsed = [], height = 420, className }:
  { root: OrgNode; defaultCollapsed?: string[]; height?: number; className?: string }) {
  const [closed, setClosed] = useState(() => new Set(defaultCollapsed))
  const [version, setVersion] = useState(0)
  const [box, width] = useWidth<HTMLDivElement>()
  const toggle = (id: string) => { setClosed(s => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n }); setVersion(v => v + 1) }
  const count = (n: OrgNode): number => (n.children ?? []).reduce((a, k) => a + 1 + count(k), 0)

  // layout: leaves take the next x slot, parents centre over their visible children
  const pos = new Map<string, { x: number; y: number; shown: boolean; parent: OrgNode | null }>()
  let x = 0
  const place = (n: OrgNode, depth: number, parent: OrgNode | null) => {
    const kids = closed.has(n.id) ? [] : n.children ?? []
    const y = depth * (OC_H + OC_GY) + 20
    if (!kids.length) { pos.set(n.id, { x, y, shown: true, parent }); x += OC_W + OC_GX }
    else { kids.forEach(k => place(k, depth + 1, n)); const a = pos.get(kids[0].id)!.x, b = pos.get(kids[kids.length - 1].id)!.x; pos.set(n.id, { x: (a + b) / 2, y, shown: true, parent }) }
  }
  place(root, 0, null)
  const all: { n: OrgNode; parent: OrgNode | null }[] = []
  const walk = (n: OrgNode, parent: OrgNode | null) => { all.push({ n, parent }); n.children?.forEach(k => walk(k, n)) }
  walk(root, null)
  // hidden nodes tuck under their nearest visible ancestor
  all.forEach(({ n, parent }) => { if (!pos.has(n.id)) { const p = pos.get(parent!.id)!; pos.set(n.id, { x: p.x, y: p.y, shown: false, parent }) } })
  const treeW = x - OC_GX, shown = all.filter(a => pos.get(a.n.id)!.shown)
  const [fit, setFit] = useState(true)
  const scale = fit && width ? Math.max(0.55, Math.min(1, (width - 26) / treeW)) : 1
  // layout in unscaled units; the sizer below is the scaled footprint the scroller sees
  const availW = (width - 2) / scale
  const innerW = Math.max(treeW + 24, availW), off = Math.max(12, (availW - treeW) / 2)
  const innerH = Math.max(maxOf(shown.map(a => pos.get(a.n.id)!.y)) + OC_H + 30, (height - 2) / scale)

  const [edgeRef, edges] = useScrollEdges<HTMLDivElement>()
  const setBox = useCallback((el: HTMLDivElement | null) => { box.current = el; edgeRef(el) }, []) // eslint-disable-line react-hooks/exhaustive-deps
  // mouse: drag the empty canvas to pan (touch pans natively)

  const pan0 = useRef({ l: 0, t: 0 })
  const pan = usePointerDrag({ cursor: 'grabbing', onMove: p => { const el = box.current; if (el) { el.scrollLeft = pan0.current.l - p.dx; el.scrollTop = pan0.current.t - p.dy } } })
  const panning = pan.dragging
  const startPan = (e: RPointerEvent<HTMLDivElement>) => {
    const el = box.current
    if (e.pointerType !== 'mouse' || e.button !== 0 || !el || (e.target as HTMLElement).closest('button,[role=treeitem]')) return
    pan0.current = { l: el.scrollLeft, t: el.scrollTop }; pan.start(e)
  }
  const centred = useRef(false)

  // the middle of the scroll range
  const mid = (el: HTMLElement) => (1) * (el.scrollWidth - el.clientWidth) / 2
  useEffect(() => { const el = box.current; if (el && width && !centred.current) { centred.current = true; el.scrollLeft = mid(el) } }, [width, box]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { const el = box.current; if (el) el.scrollLeft = mid(el) }, [fit]) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className={cn('flex flex-col gap-2', className)}>
      <div className="flex items-center justify-between gap-2">
        <span className="hidden text-xs text-[var(--fg3)] [@media(pointer:coarse)]:inline">{'Drag to pan · tap a count to fold a team'}</span>
        <span className="ms-auto flex gap-1.5">
          {(scale < 1 || !fit) && <Button size="sm" className={TOUCH.tap36} aria-pressed={!fit} onClick={() => setFit(f => !f)}>{fit ? 'Actual size' : 'Fit to width'}</Button>}
          <Button size="sm" className={TOUCH.tap36} onClick={() => { setClosed(new Set()); setVersion(v => v + 1) }} disabled={!closed.size}>{'Expand all'}</Button>
        </span>
      </div>
      <div className="relative">
      <div ref={setBox} role="group" aria-roledescription={'organisation chart'} aria-label={'Organisation chart'} onPointerDown={startPan}
        className={cn(surface.card, 'relative overflow-auto overscroll-x-contain !bg-[var(--bg)] bg-[radial-gradient(circle,var(--line2)_1px,transparent_1.2px)] bg-[length:18px_18px] [@media(pointer:fine)]:cursor-grab', panning && '[@media(pointer:fine)]:cursor-grabbing select-none')}
        style={{ height }}>
        {width > 0 && (
          <div className="relative overflow-hidden" style={{ width: innerW * scale, height: innerH * scale }}>
          <motion.div className="absolute top-0 start-0 origin-top-left" style={{ width: innerW, height: innerH }} initial={false} animate={{ scale }} transition={spring(0.15, 0.45)}>
            <svg width={innerW} height={innerH} className="pointer-events-none absolute top-0 start-0 overflow-visible" aria-hidden>
              {shown.filter(a => a.parent).map(({ n, parent }) => {
                const p = pos.get(parent!.id)!, c = pos.get(n.id)!
                const px = p.x + off + OC_W / 2, py = p.y + OC_H, cx = c.x + off + OC_W / 2, cy = c.y, my = py + OC_GY / 2, s = Math.sign(cx - px)
                const d = s ? `M${px},${py + 12} V${my - 8} Q${px},${my} ${px + s * 8},${my} H${cx - s * 8} Q${cx},${my} ${cx},${my + 8} V${cy}` : `M${px},${py + 12} V${cy}`
                return <motion.path key={`${n.id}:${version}`} d={d} fill="none" stroke="var(--line2)" strokeWidth={1.5} initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 0.5, delay: 0.1, ease: 'easeOut' }} />
              })}
            </svg>
            {all.map(({ n }) => {
              const p = pos.get(n.id)!, kids = n.children?.length ?? 0, isClosed = closed.has(n.id)
              return (
                <motion.div key={n.id} role="group" aria-label={`${n.name}, ${n.role}`} aria-hidden={!p.shown || undefined}
                  initial={false} animate={{ x: p.x + off, y: p.y, opacity: p.shown ? 1 : 0 }} transition={spring(0.15, 0.45)}
                  className={cn(surface.card, 'absolute top-0 start-0 flex items-center gap-2.5 px-3 py-2.5 shadow-[0_1px_2px_rgba(0,0,0,.05)]', p.shown ? 'z-[1]' : 'pointer-events-none z-0')}
                  style={{ width: OC_W, height: OC_H }}>
                  <Avatar name={n.name} size={32} className="!border-0" />
                  <div className="min-w-0"><b className="block truncate text-[13px] leading-tight font-semibold">{n.name}</b><span className="block truncate text-[11px] text-[var(--fg3)]">{n.role}</span></div>
                  {kids > 0 && (
                    <button onClick={() => toggle(n.id)} tabIndex={p.shown ? 0 : -1} aria-expanded={!isClosed} aria-label={isClosed ? `+${count(n)} hidden, expand ${n.name}’s team` : `${plural(kids, 'report')}, collapse ${n.name}’s team`}
                      className={cn('absolute -bottom-[11px] left-1/2 h-[22px] min-w-[22px] -translate-x-1/2 cursor-pointer rounded-full border px-1.5 font-[family-name:var(--mono)] text-[11px] font-semibold [@media(pointer:coarse)]:-bottom-4 [@media(pointer:coarse)]:h-8 [@media(pointer:coarse)]:min-w-8 [@media(pointer:coarse)]:px-2 [@media(pointer:coarse)]:text-xs',
                        isClosed ? 'border-[var(--primary)] bg-[var(--primary)] text-[var(--on-primary)]' : 'border-[var(--line)] bg-[var(--card)] text-[var(--fg2)] hover:border-[var(--fg3)] hover:text-[var(--fg)]')}>
                      {isClosed ? `+${fmt.number(count(n))}` : fmt.number(kids)}
                    </button>
                  )}
                </motion.div>
              )
            })}
          </motion.div>
          </div>
        )}
      </div>
      <ScrollEdges {...edges} fade="bg" hint={'Swipe to pan'} className="rounded-[var(--r-lg)]" />
      </div>
    </div>
  )
}

/**
 * Body of a day/week event. The title wraps; when the event is too short for everything it drops the
 * attendees first, then the time, and only then truncates the title to one line (measured, so it adapts to
 * column width and to live resizing).
 */
function ScEventBody({ title, time, people, height, naming }: { title: string; time: string; people: string[]; height: number; naming: ReactNode }) {
  const [ref, width] = useWidth<HTMLDivElement>()
  const w = Math.round(width)
  const [fit, setFit] = useState(0)
  const coarse = useCoarsePointer()
  useLayoutEffect(() => { setFit(0) }, [title, time, height, w, people.length, !!naming])
  // 0: everything · 1: no attendees · 2: no time · 3: title cut to one line
  useLayoutEffect(() => { const el = ref.current; if (el && fit < 3 && el.scrollHeight > el.clientHeight + 1) setFit(fit + 1) })
  return (
    <div ref={ref} className="flex min-h-0 flex-1 flex-col overflow-hidden">
      {naming ?? (
        <b className={cn('font-semibold', fit >= 3 ? 'truncate' : '[overflow-wrap:anywhere]')}>
          <span aria-hidden className="me-1.5 inline-block h-1.5 w-1.5 rounded-full bg-[var(--ec)] align-[2px]" />{title}
        </b>
      )}
      {' '/* keeps "Title 09:00 – 10:00" readable as one name */}
      {fit < 2 && <span className="text-[11px] text-[color-mix(in_srgb,var(--ec)_45%,var(--fg))] [overflow-wrap:anywhere]">{time}</span>}
      {/* the event's accessible name comes from this content: title, time (even when hidden for space) and attendees */}
      {fit >= 2 && <span className="sr-only">{time}</span>}
      {people.length > 0 && <span className="sr-only">{`, with ${fmt.list(people)}`}</span>}

      {fit < 1 && people.length > 0 && (
        <div aria-hidden>
          <AvatarStack names={people} max={3} size={coarse ? 24 : 20} spread={false}
            className="!items-start pt-1 [&_span[title]]:!border-[1.5px] [&_span[title]]:[@media(pointer:coarse)]:!text-[11px]" />
        </div>
      )}
    </div>
  )
}
