import { useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode, type RefObject, type KeyboardEvent as RKeyboardEvent, type PointerEvent as RPointerEvent } from 'react'
import { AnimatePresence, LayoutGroup, motion } from 'motion/react'
import { AvatarStack, Badge, DeltaBadge, Icon, type IconName, ScrollEdges, StatusIcon, type StatusIconStatus, TOUCH, type Tone, clamp, cn, prefersReducedMotion, safeColor, spring, surface, useCoarsePointer, useControllable, useLongPress, usePointerDrag, useScrollEdges, SparkChart } from './core'
import { Collapse, useToast } from './feedback'

/* ════════════════════════════════════════════════════════════════════════════
 * 10. LAYOUT: drag-sort engine, kanban, sortable list, tree, timeline, split panes
 * ══════════════════════════════════════════════════════════════════════════ */

/* Drag-sort engine ───────────────────────────────────────────────────────────
 * Pointer-driven (mouse, pen, touch). The dragged item stays in place as a dashed slot while a
 * floating clone follows the pointer; `onMove` fires live as the slot should move, so React state is
 * the single source of truth and motion's `layout` animates everything else out of the way. */

/** Rect without the element's own transform, so items mid-animation don't make the slot oscillate. */
function lyLayoutRect(el: HTMLElement) {
  const r = el.getBoundingClientRect(), t = getComputedStyle(el).transform
  if (!t || t === 'none') return r
  const m = new DOMMatrixReadOnly(t)
  return new DOMRect(r.left - m.m41, r.top - m.m42, r.width, r.height)
}

export type DragSortOptions = {
  /** Which way items flow; decides whether the pointer's x or y picks the insert position. */
  axis?: 'x' | 'y'
  /** The slot for `id` should now be at `index` (counted without the dragged item) in list `list`. */
  onMove: (id: string, list: string, index: number) => void
  onDrop?: (id: string, list: string | null) => void
  canDrop?: (id: string, list: string) => boolean
}

/** One drag (or a press that may become one). */
type LySession = {
  id: string; el: HTMLElement; touch: boolean; sx: number; sy: number; lx: number; ly: number
  /** a hold-to-drag press becomes armed once the hold completes */ armed: boolean; started: boolean
  over: string | null; ghost: HTMLElement | null; ox: number; oy: number; raf: number; scrollers: HTMLElement[]; off: (() => void)[]
}

/**
 * Sortable lists without a library. Spread `listProps(listId)` on each container, `itemProps(id)` on each
 * item, and `handleProps(id)` on the drag handle (or the item itself). Lists may nest; the deepest list
 * under the pointer wins, and `[data-sort-area]` on an ancestor widens a list's drop zone. Elements marked
 * `data-no-drag` inside a handle never start a drag. A drag in progress is torn down if the component unmounts.
 */
export function useDragSort({ axis = 'y', onMove, onDrop, canDrop }: DragSortOptions) {
  const group = useId()
  const [drag, setDrag] = useState<{ id: string; over: string | null } | null>(null)
  const cb = useRef({ onMove, onDrop, canDrop })
  useLayoutEffect(() => { cb.current = { onMove, onDrop, canDrop } })
  const ses = useRef<LySession | null>(null)
  const lists = () => [...document.querySelectorAll<HTMLElement>('[data-sort-list]')].filter(l => l.dataset.sortGroup === group)
  const findItem = (id: string) => [...document.querySelectorAll<HTMLElement>('[data-sort-item]')].find(i => i.dataset.sortGroup === group && i.dataset.sortItem === id) ?? null
  const itemsOf = (l: HTMLElement) => [...l.querySelectorAll<HTMLElement>('[data-sort-item]')].filter(i => i.dataset.sortGroup === group && i.parentElement?.closest('[data-sort-list]') === l)

  /** stop listening; the ghost (if any) stays for the caller to animate or remove */
  const teardown = (s: LySession) => {
    if (ses.current === s) ses.current = null
    cancelAnimationFrame(s.raf); s.off.forEach(f => f()); s.off = []
  }
  // unmounting mid-drag: drop the ghost, listeners and cursor at once (declared before the drag hooks so it runs first)
  useEffect(() => () => {
    const s = ses.current; if (!s) return
    teardown(s); s.ghost?.remove(); if (s.touch) document.body.style.cursor = ''
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const begin = (s: LySession) => {
    s.started = true
    const src = findItem(s.id) ?? s.el, r = src.getBoundingClientRect(); s.ox = s.sx - r.left; s.oy = s.sy - r.top
    const ghost = s.ghost = src.cloneNode(true) as HTMLElement
    const from = src.querySelectorAll<HTMLInputElement>('select,input,textarea'), to = ghost.querySelectorAll<HTMLInputElement>('select,input,textarea')
    from.forEach((f, i) => { if (to[i]) { to[i].value = f.value; if (f.type === 'checkbox') to[i].checked = f.checked } })
    ;[ghost, ...ghost.querySelectorAll<HTMLElement>('[data-sort-item],[data-sort-list],[id]')].forEach(n => { n.removeAttribute('data-sort-item'); n.removeAttribute('data-sort-list'); n.removeAttribute('id') })
    Object.assign(ghost.style, { position: 'fixed', left: `${r.left}px`, top: `${r.top}px`, width: `${r.width}px`, height: `${r.height}px`, margin: '0', zIndex: '200', pointerEvents: 'none', boxShadow: 'var(--shadow)', transform: prefersReducedMotion() ? 'none' : 'rotate(1.5deg) scale(1.03)', transition: 'transform .15s', opacity: '.97', cursor: 'grabbing' })
    ghost.setAttribute('aria-hidden', 'true')
    document.body.appendChild(ghost)
    if (s.touch) document.body.style.cursor = 'grabbing'
    for (let n = src.parentElement; n && n !== document.body; n = n.parentElement) { const cs = getComputedStyle(n); if (/auto|scroll/.test(cs.overflowX + cs.overflowY)) s.scrollers.push(n) }
    setDrag({ id: s.id, over: null })
    s.raf = requestAnimationFrame(() => edgeScroll(s))
  }
  const track = (s: LySession, x: number, y: number) => {
    if (!s.ghost) return
    s.ghost.style.left = `${x - s.ox}px`; s.ghost.style.top = `${y - s.oy}px`
    const self = findItem(s.id)
    const hit = lists().filter(l => {
      if (self?.contains(l)) return false
      const r = (l.closest<HTMLElement>('[data-sort-area]') ?? l).getBoundingClientRect()
      return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom
    }).pop()
    const lid = hit?.dataset.sortList ?? null
    if (lid !== s.over) { s.over = lid; setDrag({ id: s.id, over: lid }) }
    if (!hit || !lid || (cb.current.canDrop && !cb.current.canDrop(s.id, lid))) return
    const all = itemsOf(hit), kids = all.filter(k => k !== self)
    let i = kids.findIndex(k => { const r = lyLayoutRect(k); return axis === 'x' ? x < r.left + r.width / 2 : y < r.top + r.height / 2 })
    if (i < 0) i = kids.length
    if (self && all.indexOf(self) === i) return
    cb.current.onMove(s.id, lid, i)
  }
  // near the edge of a scrolling ancestor (or the viewport), keep scrolling so off-screen lists can be reached
  const edgeScroll = (s: LySession) => {
    if (ses.current !== s || !s.started) return
    const E = 44, step = (d: number) => Math.round(Math.min(1, (E - d) / E) * 14) || 1, lx = s.lx, ly = s.ly
    let moved = false
    for (const el of s.scrollers) {
      const r = el.getBoundingClientRect()
      if (el.scrollWidth > el.clientWidth && ly >= r.top && ly <= r.bottom) {
        const dx = lx < r.left + E ? -step(lx - r.left) : lx > r.right - E ? step(r.right - lx) : 0
        if (dx) { const b = el.scrollLeft; el.scrollLeft += dx; moved ||= el.scrollLeft !== b }
      }
      if (el.scrollHeight > el.clientHeight && lx >= r.left && lx <= r.right) {
        const dy = ly < r.top + E ? -step(ly - r.top) : ly > r.bottom - E ? step(r.bottom - ly) : 0
        if (dy) { const b = el.scrollTop; el.scrollTop += dy; moved ||= el.scrollTop !== b }
      }
    }
    const vy = ly < 56 ? -step(ly - 12) : ly > innerHeight - 56 ? step(innerHeight - 12 - ly) : 0
    if (vy) { const b = scrollY; scrollBy(0, vy); moved ||= scrollY !== b }
    if (moved) track(s, lx, ly)
    s.raf = requestAnimationFrame(() => edgeScroll(s))
  }
  const move = (s: LySession, x: number, y: number) => {
    s.lx = x; s.ly = y
    if (!s.started) {
      const d = Math.hypot(x - s.sx, y - s.sy)
      if (!s.armed) { if (d > 8) { teardown(s); hold.cancel() } return } // moved before the hold finished: it's a scroll, let it go
      if (d < 5) return
      begin(s)
    }
    track(s, x, y)
  }
  const drop = (s: LySession, cancelled: boolean) => {
    if (ses.current !== s) return
    teardown(s); hold.cancel()
    if (!s.started) return
    if (s.touch) document.body.style.cursor = ''
    const ghost = s.ghost
    const finish = () => { ghost?.remove(); setDrag(null); cb.current.onDrop?.(s.id, s.over) }
    const target = findItem(s.id)
    if (!cancelled && target && ghost && !prefersReducedMotion()) {
      const r = lyLayoutRect(target)
      const a = ghost.animate([{ left: ghost.style.left, top: ghost.style.top, transform: ghost.style.transform }, { left: `${r.left}px`, top: `${r.top}px`, transform: 'none' }], { duration: 200, easing: 'cubic-bezier(.2,.8,.2,1)' })
      a.onfinish = finish; a.oncancel = finish
    } else finish()
  }
  // mouse, pen and touch on a `touch-none` handle: one pointer drag, followed on the window and not captured, so moving the
  // item to another list (which re-mounts it) never loses the pointer
  const pointer = usePointerDrag({
    cursor: 'grabbing',
    onMove: p => { const s = ses.current; if (s && !s.touch) move(s, p.x, p.y) },
    onEnd: (_, cancelled) => { const s = ses.current; if (s && !s.touch) drop(s, cancelled) },
  })
  // touch and pen anywhere else: press and hold first (~0.35 s without moving), so a swipe over items still scrolls
  const hold = useLongPress({
    ms: 350, slop: 8,
    onPress: p => {
      const s = ses.current; if (!s || s.started) return
      s.armed = true; navigator.vibrate?.(10)
      if (!s.touch) pointer.start({ pointerId: p.pointerId, clientX: s.lx, clientY: s.ly })
      begin(s); track(s, s.lx, s.ly)
    },
  })

  const start = (e: RPointerEvent, id: string) => {
    if (e.button !== 0) return
    const t = e.target as HTMLElement
    if (t.closest('[data-no-drag]') || (t.closest('button,input,textarea,select,label,a') && !t.closest('[data-sort-handle]'))) return
    const el = findItem(id); if (!el) return
    if (ses.current) drop(ses.current, true)
    const isHold = e.pointerType !== 'mouse' && getComputedStyle(e.currentTarget as HTMLElement).touchAction !== 'none'
    const touch = e.pointerType === 'touch' && isHold
    const s: LySession = { id, el, touch, sx: e.clientX, sy: e.clientY, lx: e.clientX, ly: e.clientY, armed: !isHold, started: false, over: null, ghost: null, ox: 0, oy: 0, raf: 0, scrollers: [], off: [] }
    ses.current = s
    if (!isHold) { pointer.start({ pointerId: e.pointerId, clientX: e.clientX, clientY: e.clientY, nativeEvent: e.nativeEvent }); return }
    hold.bind.onPointerDown(e)
    if (!touch) return
    // A held touch is followed through touch events on the touched node: unlike pointer events they can stop the page
    // scrolling (preventDefault), and they keep arriving even if React re-parents or remounts that node mid-drag.
    const node = t
    const onTouchMove = (ev: TouchEvent) => { const p = ev.touches[0]; if (!p) return; if (s.armed && ev.cancelable) ev.preventDefault(); move(s, p.clientX, p.clientY) }
    const onTouchEnd = () => drop(s, false)
    const noMenu = (ev: Event) => { if (ses.current === s) ev.preventDefault() }
    node.addEventListener('touchmove', onTouchMove, { passive: false }); node.addEventListener('touchend', onTouchEnd); node.addEventListener('touchcancel', onTouchEnd)
    addEventListener('contextmenu', noMenu)
    s.off.push(() => {
      node.removeEventListener('touchmove', onTouchMove); node.removeEventListener('touchend', onTouchEnd); node.removeEventListener('touchcancel', onTouchEnd)
      removeEventListener('contextmenu', noMenu)
    })
  }
  // a pen lifted (or cancelled) before its hold finished
  const release = () => { const s = ses.current; if (s && !s.touch && !s.armed) teardown(s); hold.cancel() }
  return {
    /** id of the item being dragged, and the list under the pointer */
    dragging: drag?.id ?? null, over: drag?.over ?? null,
    listProps: (list: string) => ({ 'data-sort-list': list, 'data-sort-group': group }),
    itemProps: (id: string) => ({ 'data-sort-item': id, 'data-sort-group': group }),
    handleProps: (id: string) => ({
      'data-sort-handle': '', onPointerDown: (e: RPointerEvent) => start(e, id),
      onPointerMove: hold.bind.onPointerMove, onPointerUp: release, onPointerCancel: release, onClickCapture: hold.bind.onClickCapture,
    }),
  }
}

/** Move an item (by id) inside a list of lists to `index` of list `to`. Used by Kanban and the grid's Blocks. */
function lyMove<C extends { id: string }, I extends { id: string }>(cols: C[], get: (c: C) => I[], set: (c: C, items: I[]) => C, id: string, to: string, index: number) {
  let item: I | undefined
  const stripped = cols.map(c => { const items = get(c), i = items.findIndex(x => x.id === id); if (i < 0) return c; item = items[i]; return set(c, items.filter(x => x.id !== id)) })
  if (!item) return cols
  return stripped.map(c => c.id === to ? set(c, [...get(c).slice(0, index), item!, ...get(c).slice(index)]) : c)
}

/** Refocus an element by selector (inside `root`) after React re-renders (moved nodes lose focus). */
function useLyRefocus(root: RefObject<HTMLElement | null>) {
  const pending = useRef<string | null>(null)
  useEffect(() => { if (pending.current) { root.current?.querySelector<HTMLElement>(pending.current)?.focus(); pending.current = null } })
  return (selector: string) => { pending.current = selector }
}

/* Kanban ──────────────────────────────────────────────────────────────────── */

export type KanbanCard = {
  id: string; title: string; tag?: { label: string; tone: Tone }
  priority?: 'High' | 'Med' | 'Low'; due?: string; assignees?: string[]; /** @deprecated use assignees */ assignee?: string
  /** two colours for a gradient cover */ cover?: [string, string]
  checklist?: { text: string; done: boolean }[]; comments?: number; attachments?: number
  /** what it's waiting on; shows a Blocked badge and a striped card */ blocked?: string
  /** linked pull request with its CI checks, e.g. { number: '#482', checks: [{ name: 'Build', status: 'ok' }] } */
  pr?: { number: string; checks: { name: string; status: KanbanCheckStatus }[] }
  /** a tracked number: label, value, % change (▲ / ▼ pill, green when the change is good) and an optional sparkline */
  metric?: { label: string; value: string; delta: number; trend?: number[]; /** a fall is good news (latency, errors) */ lowerIsBetter?: boolean }
}
export type KanbanCheckStatus = 'ok' | 'bad' | 'running'
export type KanbanColumn = { id: string; title: string; color?: string; /** WIP limit */ limit?: number; cards: KanbanCard[] }

const KB_PRI: Record<string, string> = { High: 'var(--bad)', Med: 'var(--warn)', Low: 'var(--fg3)' }
const KB_CHECK: Record<KanbanCheckStatus, [StatusIconStatus, string]> = { ok: ['done', 'passed'], bad: ['failed', 'failed'], running: ['active', 'running'] }

/** Metric panel inside a card: value, change pill and a sparkline that fills the rest of the row. */
function KanbanMetric({ m }: { m: NonNullable<KanbanCard['metric']> }) {
  const good = m.lowerIsBetter ? m.delta < 0 : m.delta >= 0, color = good ? 'var(--ok)' : 'var(--bad)'
  const t = m.trend?.filter(Number.isFinite) ?? []
  return (
    <div className={cn(surface.md, '-mt-0.5 mb-2 grid grid-cols-[auto_1fr] items-center gap-2.5 p-2')}>
      <div className="min-w-0">
        <span className="block text-[11px] text-[var(--fg3)]">{m.label}</span>
        <span className="flex items-center gap-1.5">
          <b className="font-[family-name:var(--mono)] text-sm font-semibold tracking-[-.01em]">{m.value}</b>
          <DeltaBadge value={m.delta} lowerIsBetter={m.lowerIsBetter} digits={Number.isInteger(m.delta) ? 0 : 1} className="font-semibold" />
        </span>
      </div>
      {t.length > 1 && <SparkChart data={t} height={26} color={color} />}
    </div>
  )
}

/**
 * Board with rich cards. Drag cards between columns (drops at the pointer's position) and drag a column
 * header to reorder columns. Keys: each card has a drag-handle button (⠿); arrows move focus between cards, Alt + arrows
 * move the card, Alt + Shift + ← / → move its column. Columns with a `limit` turn red past it. "+ Add card" opens an
 * inline textarea (Enter adds). On touch, press and hold a card to pick it up.
 */
export function Kanban({ value, defaultValue = [], onChange, doneColumn, newCard, className }:
  { value?: KanbanColumn[]; defaultValue?: KanbanColumn[]; onChange?: (c: KanbanColumn[]) => void; /** column id counted as done (default: last) */ doneColumn?: string
    newCard?: (title: string) => Omit<KanbanCard, 'id' | 'title'>; className?: string }) {
  const [cols, setCols] = useControllable(value, defaultValue, onChange)
  const ref = useRef(cols); ref.current = cols
  const update = (fn: (c: KanbanColumn[]) => KanbanColumn[]) => { const next = fn(ref.current); if (next !== ref.current) { ref.current = next; setCols(next) } }
  const toast = useToast()
  const rootRef = useRef<HTMLDivElement>(null)
  const refocus = useLyRefocus(rootRef)
  const hint = useId()
  const [adding, setAdding] = useState<string | null>(null)
  const [openChk, setOpenChk] = useState<string[]>([])
  const moveCard = (id: string, to: string, index: number) =>
    update(cs => lyMove(cs, c => c.cards, (c, cards) => ({ ...c, cards }), id, to, index))
  const moveCol = (id: string, index: number) => update(cs => { const c = cs.find(x => x.id === id)!; const rest = cs.filter(x => x.id !== id); return [...rest.slice(0, index), c, ...rest.slice(index)] })
  const checkLimit = (colId: string) => {
    const c = ref.current.find(x => x.id === colId)
    if (c?.limit && c.cards.length > c.limit) toast({ title: 'WIP limit exceeded', description: `${c.title} has more than ${c.limit} cards`, tone: 'bad' })
  }
  const cards = useDragSort({ onMove: moveCard, onDrop: (_, list) => list && checkLimit(list) })
  const columns = useDragSort({ axis: 'x', onMove: (id, _, i) => moveCol(id, i) })
  const done = doneColumn ?? cols[cols.length - 1]?.id
  const total = cols.reduce((n, c) => n + c.cards.length, 0)
  const cardSel = (id: string) => `[data-kb-card="${CSS.escape(id)}"]`
  const focusCard = (id?: string) => { if (id) rootRef.current?.querySelector<HTMLElement>(cardSel(id))?.focus() }
  const [board, edges] = useScrollEdges<HTMLDivElement>()
  const anyDrag = !!(cards.dragging || columns.dragging)

  const onCardKey = (e: RKeyboardEvent, ci: number, ri: number, card: KanbanCard) => {
    const col = cols[ci], arrows = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown']
    if (e.target !== e.currentTarget || !arrows.includes(e.key)) return
    e.preventDefault()
    const dx = e.key === 'ArrowLeft' ? -1 : e.key === 'ArrowRight' ? 1 : 0, dy = e.key === 'ArrowUp' ? -1 : e.key === 'ArrowDown' ? 1 : 0
    if (e.altKey && e.shiftKey) { if (dx && cols[ci + dx]) { moveCol(col.id, ci + dx); refocus(cardSel(card.id)) } return }
    if (e.altKey) {
      if (dx && cols[ci + dx]) { moveCard(card.id, cols[ci + dx].id, Math.min(ri, cols[ci + dx].cards.length)); checkLimit(cols[ci + dx].id) }
      if (dy && ri + dy >= 0 && ri + dy < col.cards.length) moveCard(card.id, col.id, ri + dy)
      refocus(cardSel(card.id)); return
    }
    if (dy) focusCard(col.cards[ri + dy]?.id)
    if (dx) { const n = cols[ci + dx]; if (n?.cards.length) focusCard(n.cards[Math.min(ri, n.cards.length - 1)].id) }
  }
  const toggleItem = (cardId: string, i: number) => update(cs => cs.map(c => ({
    ...c, cards: c.cards.map(k => {
      if (k.id !== cardId || !k.checklist) return k
      const checklist = k.checklist.map((x, j) => j === i ? { ...x, done: !x.done } : x)
      if (checklist.every(x => x.done)) toast({ title: 'Checklist complete', description: k.title })
      return { ...k, checklist }
    }),
  })))
  const add = (colId: string, title: string) => {
    const id = `kb${Date.now().toString(36)}`
    update(cs => cs.map(c => c.id === colId ? { ...c, cards: [...c.cards, { ...(newCard?.(title) ?? { title }), id, title }] } : c))
    checkLimit(colId)
  }

  return (
    <LayoutGroup>
      <div ref={rootRef} className={cn('flex flex-col gap-2', className)}>
        <span id={hint} hidden>Arrow keys move between cards. Alt and arrow keys move this card; Alt, Shift and left or right move its column.</span>
        <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 text-xs text-[var(--fg3)]">
          <span className="hidden [@media(pointer:coarse)]:inline">Press and hold a card to move it</span>
          <span className="ml-auto" aria-live="polite">{total} cards · {cols.find(c => c.id === done)?.cards.length ?? 0} done</span>
        </div>
        <div className="relative">
        <div ref={board} {...columns.listProps('board')}
          className={cn('grid auto-cols-[minmax(220px,1fr)] grid-flow-col gap-3 overflow-x-auto overscroll-x-contain pb-1', !anyDrag && 'snap-x snap-mandatory')}>
          {cols.map((col, ci) => {
            const over = !!col.limit && col.cards.length > col.limit, isDragged = columns.dragging === col.id
            return (
              <motion.div key={col.id} layout="position" transition={spring(0.18, 0.4)} {...columns.itemProps(col.id)} data-sort-area=""
                role="group" aria-label={`${col.title}, ${col.cards.length} cards`}
                className={cn('flex min-h-[320px] snap-start flex-col gap-2 rounded-[var(--r-lg)] p-2.5 transition-[box-shadow,background-color]',
                  isDragged ? 'border-[1.5px] border-dashed border-[var(--line2)] bg-transparent [&>*]:opacity-0' : 'bg-[color-mix(in_srgb,var(--muted)_60%,var(--card))]',
                  cards.over === col.id && cards.dragging && 'shadow-[inset_0_0_0_1.5px_var(--line2)]', over && 'shadow-[inset_0_0_0_1.5px_color-mix(in_srgb,var(--bad)_50%,transparent)]')}>
                <div {...columns.handleProps(col.id)} title="Drag to reorder columns"
                  className={cn('group flex cursor-grab items-center gap-2 rounded-[var(--r-md)] px-1 pt-0.5 pb-1 text-[13px] font-semibold select-none [-webkit-touch-callout:none] active:cursor-grabbing', TOUCH.tap36)}>
                  <span className="-ml-0.5 text-[var(--fg3)] opacity-35 transition-opacity group-hover:opacity-100"><Icon name="grip" size={12} strokeWidth={3.2} /></span>
                  <i className="h-2 w-2 rounded-full" style={{ background: safeColor(col.color, 'var(--fg3)') }} />{col.title}
                  <motion.span key={col.cards.length} initial={{ scale: 1.3 }} animate={{ scale: 1 }} transition={spring(0.5, 0.3)}
                    className={cn('ui-num rounded-full px-2 py-px text-[11px] font-medium', over ? 'bg-[var(--bad-soft)] text-[var(--bad)]' : 'bg-[var(--card)] text-[var(--fg3)]')}>{col.cards.length}</motion.span>
                  {col.limit && <span className="ml-auto text-[11px] font-normal text-[var(--fg3)]">Limit {col.limit}</span>}
                </div>
                <div {...cards.listProps(col.id)} role="list" aria-label={`${col.title} cards`} className="flex min-h-10 flex-1 flex-col gap-2">
                  {col.cards.map((card, ri) => (
                    <KanbanCardView key={card.id} card={card} dragging={cards.dragging === card.id} sortProps={{ ...cards.itemProps(card.id), ...cards.handleProps(card.id) }}
                      label={`Move ${card.title}, ${col.title}, ${ri + 1} of ${col.cards.length}`} hint={hint} open={openChk.includes(card.id)}
                      onToggleOpen={() => setOpenChk(o => o.includes(card.id) ? o.filter(x => x !== card.id) : [...o, card.id])}
                      onToggleItem={i => toggleItem(card.id, i)} onKeyDown={e => onCardKey(e, ci, ri, card)} />
                  ))}
                </div>
                {adding === col.id
                  ? <textarea autoFocus rows={2} placeholder="Card title, Enter to add" aria-label={`New card in ${col.title}`}
                    onKeyDown={e => {
                      if (e.key === 'Escape') setAdding(null)
                      if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); const v = e.currentTarget.value.trim(); if (!v) return setAdding(null); add(col.id, v); e.currentTarget.value = '' }
                    }} onBlur={() => setTimeout(() => setAdding(a => a === col.id ? null : a), 120)}
                    className={cn('w-full resize-none rounded-[var(--r-md)] border border-[var(--line2)] bg-[var(--card)] px-2.5 py-2 text-[13px] outline-none placeholder:text-[var(--fg3)] focus:border-[var(--fg3)]', TOUCH.input)} />
                  : <button onClick={() => setAdding(col.id)} className={cn('cursor-pointer rounded-[var(--r-md)] border-0 bg-transparent px-1.5 py-1.5 text-left text-xs font-medium text-[var(--fg3)] hover:bg-[var(--card)] hover:text-[var(--fg)] [@media(pointer:coarse)]:text-[13px]', TOUCH.row)}>+ Add card</button>}
              </motion.div>
            )
          })}
        </div>
        <ScrollEdges {...edges} hint="More columns" at="top" className="!bottom-1" />

        </div>
      </div>
    </LayoutGroup>
  )
}

/** One card: a list item (not a button, so its checklist controls stay real controls) with a ⠿ drag-handle button for keyboard moves. */
function KanbanCardView({ card, dragging, sortProps, label, hint, open, onToggleOpen, onToggleItem, onKeyDown }:
  { card: KanbanCard; dragging: boolean; sortProps: Record<string, unknown>; label: string; hint: string; open: boolean; onToggleOpen: () => void; onToggleItem: (i: number) => void; onKeyDown: (e: RKeyboardEvent) => void }) {
  const done = card.checklist?.filter(x => x.done).length ?? 0, total = card.checklist?.length ?? 0
  const people = card.assignees ?? (card.assignee ? [card.assignee] : [])
  const coarse = useCoarsePointer()
  return (
    <motion.div layout layoutId={`kb-${card.id}`} transition={spring(0.18, 0.4)} {...sortProps} role="listitem"
      initial={{ opacity: 0, scale: 0.96 }} animate={{ opacity: 1, scale: 1 }}
      style={card.blocked && !dragging ? { background: 'repeating-linear-gradient(135deg,var(--card) 0 10px,color-mix(in srgb,var(--muted) 70%,var(--card)) 10px 20px)' } : undefined}
      className={cn('relative cursor-grab rounded-[var(--r-md)] border px-3 py-2.5 select-none [-webkit-touch-callout:none] active:cursor-grabbing has-[[data-kb-card]:focus-visible]:shadow-[0_0_0_2px_var(--accent)]',
        dragging ? 'border-dashed border-[var(--line2)] bg-transparent [&>*]:invisible' : 'border-[var(--line)] bg-[var(--card)] shadow-[0_1px_2px_rgba(0,0,0,.04)] hover:border-[var(--line2)]')}>
      {card.cover && <div className="-mx-1 -mt-1 mb-2 h-16 rounded-[calc(var(--r-md)-3px)] opacity-90" style={{ background: `linear-gradient(135deg,${card.cover[0]},${card.cover[1]})` }} />}
      <div className="flex flex-wrap items-center gap-1.5">
        {card.tag && <Badge tone={card.tag.tone}>{card.tag.label}</Badge>}
        {card.blocked && <Badge tone="bad"><Icon name="lock" size={10} />Blocked</Badge>}
        <button data-kb-card={card.id} aria-label={label} aria-describedby={hint} aria-roledescription="drag handle" onKeyDown={onKeyDown}
          className="ui-hit [--hit:40px] -my-1 -mr-1.5 ml-auto grid h-6 w-6 cursor-grab place-items-center rounded-[5px] border-0 bg-transparent p-0 text-[var(--fg3)] opacity-40 outline-none hover:bg-[var(--muted)] hover:opacity-100 focus-visible:opacity-100 active:cursor-grabbing">
          <Icon name="grip" size={12} strokeWidth={3.2} />
        </button>
      </div>
      <div className="mt-1.5 mb-2 text-[13px] leading-snug font-medium">{card.title}</div>
      {card.blocked && <div className="-mt-1 mb-2 text-xs text-[var(--fg2)]">Waiting on <b className="font-medium text-[var(--fg)]">{card.blocked}</b></div>}
      {card.metric && <KanbanMetric m={card.metric} />}
      {card.pr && (
        <div className={cn(surface.md, '-mt-0.5 mb-2 flex flex-wrap items-center gap-1.5 bg-transparent px-2 py-1.5 text-[11px] text-[var(--fg2)]')}>
          <Icon name="pullRequest" size={11} />
          <b className="font-[family-name:var(--mono)] text-[11px] font-semibold text-[var(--fg)]">{card.pr.number}</b>
          <span className="flex-1" />
          {card.pr.checks.map(c => (
            <span key={c.name} className="inline-flex items-center gap-1" title={`${c.name}: ${KB_CHECK[c.status][1]}`}>
              <StatusIcon status={KB_CHECK[c.status][0]} size={12} tone="ok" className={c.status === 'running' ? '!border-[var(--warn)] !border-r-transparent' : undefined} />
              {c.name}<span className="sr-only"> {KB_CHECK[c.status][1]}</span>
            </span>
          ))}
        </div>
      )}
      {card.checklist && (
        <>
          <button onClick={onToggleOpen} aria-expanded={open} aria-label={`Checklist, ${done} of ${total} done`} data-no-drag
            className={cn('-mt-0.5 mb-1.5 flex w-full cursor-pointer items-center gap-2 border-0 bg-transparent px-0 py-0.5 font-[family-name:var(--mono)] text-[11px] font-medium text-[var(--fg2)]', TOUCH.tap)}>
            <span className="h-[5px] flex-1 overflow-hidden rounded-full bg-[var(--muted)]">
              <motion.span className={cn('block h-full rounded-full', total && done === total ? 'bg-[var(--ok)]' : 'bg-[var(--accent)]')} initial={false} animate={{ width: `${total ? (done / total) * 100 : 0}%` }} transition={spring(0.2, 0.4)} />
            </span>{done}/{total}
          </button>
          <Collapse open={open}>
            <div className="pb-1.5">
              {card.checklist.map((x, i) => (
                <label key={i} data-no-drag className={cn('flex cursor-pointer items-center gap-2 py-1 text-xs [@media(pointer:coarse)]:min-h-9 [@media(pointer:coarse)]:text-[13px]')}>
                  <input type="checkbox" checked={x.done} onChange={() => onToggleItem(i)} className="m-0 accent-[var(--primary)] [@media(pointer:coarse)]:h-[18px] [@media(pointer:coarse)]:w-[18px]" />
                  <span className={cn(x.done && 'text-[var(--fg3)] line-through')}>{x.text}</span>
                </label>
              ))}
            </div>
          </Collapse>
        </>
      )}
      <div className="flex items-center gap-2 text-[11px] whitespace-nowrap text-[var(--fg3)]">
        {card.priority && <span role="img" aria-label={`${card.priority} priority`} title={`${card.priority} priority`} className="h-[7px] w-[7px] flex-none rounded-[2px]" style={{ background: KB_PRI[card.priority] }} />}
        {card.due && <span className="inline-flex items-center gap-1"><Icon name="calendar" size={11} />{card.due}</span>}
        {!!card.comments && <span className="inline-flex items-center gap-1" title={`${card.comments} comments`}><Icon name="message" size={11} />{card.comments}</span>}
        {!!card.attachments && <span className="inline-flex items-center gap-1" title={`${card.attachments} attachments`}><Icon name="paperclip" size={11} />{card.attachments}</span>}
        {people.length > 0 && <AvatarStack names={people} max={3} size={coarse ? 26 : 22} spread={false} className="ml-auto !items-end [&_span[title]]:[@media(pointer:coarse)]:!text-[11px]" />}
      </div>
    </motion.div>
  )
}

/* Sortable list ──────────────────────────────────────────────────────────── */

/**
 * Reorderable list. Drag the ⠿ handle (only the handle starts a drag, so text stays selectable), or focus a
 * row and press Alt + ↑ / ↓ (the new position is announced). Rows show their rank and an optional colour dot.
 */
export function SortableList<T extends { id: string; color?: string }>({ items, onChange, render, ranked = true, className, label = 'Sortable list' }:
  { items: T[]; onChange: (v: T[]) => void; render: (t: T) => ReactNode; ranked?: boolean; className?: string; label?: string }) {
  const ref = useRef(items); ref.current = items
  const root = useRef<HTMLDivElement>(null)
  const refocus = useLyRefocus(root)
  const hint = useId()
  const [lifted, setLifted] = useState<string | null>(null)
  const [said, setSaid] = useState('')
  const moveTo = (id: string, index: number) => {
    const cur = ref.current, it = cur.find(x => x.id === id)!, rest = cur.filter(x => x.id !== id)
    const next = [...rest.slice(0, index), it, ...rest.slice(index)]; ref.current = next; onChange(next)
  }
  const sort = useDragSort({ onMove: (id, _, i) => moveTo(id, i) })
  return (
    <div ref={root} className={cn('flex flex-col gap-1.5', className)}>
      <span id={hint} hidden>Alt and arrow keys to move.</span>
      <span role="status" className="sr-only">{said}</span>
      <div {...sort.listProps('list')} role="list" aria-label={label} className="flex flex-col gap-1.5">
        {items.map((it, i) => (
          <motion.div key={it.id} layout="position" transition={spring(0.18, 0.4)} {...sort.itemProps(it.id)} data-sl-item={it.id} role="listitem" tabIndex={0}
            aria-describedby={hint}
            onKeyDown={e => {
              if (!e.altKey || (e.key !== 'ArrowUp' && e.key !== 'ArrowDown')) return
              e.preventDefault(); const j = i + (e.key === 'ArrowUp' ? -1 : 1); if (j < 0 || j >= items.length) return
              moveTo(it.id, j); refocus(`[data-sl-item="${CSS.escape(it.id)}"]`); setLifted(it.id); setTimeout(() => setLifted(l => l === it.id ? null : l), 350)
              setSaid(`Moved to position ${j + 1} of ${items.length}`)
            }}
            className={cn('flex items-center gap-2.5 rounded-[var(--r-md)] border px-2.5 py-2 text-[13px] outline-none select-none focus-visible:shadow-[0_0_0_2px_var(--accent)]',
              sort.dragging === it.id ? 'border-dashed border-[var(--line2)] bg-transparent [&>*]:invisible' : 'border-[var(--line)] bg-[var(--card)]',
              lifted === it.id && 'shadow-[0_0_0_2px_var(--accent),0_8px_20px_rgba(0,0,0,.12)]')}>
            <span {...sort.handleProps(it.id)} aria-hidden title="Drag to reorder"
              className="grid h-[22px] w-[18px] flex-none cursor-grab touch-none place-items-center rounded-[5px] text-[var(--fg3)] hover:bg-[var(--muted)] hover:text-[var(--fg)] active:cursor-grabbing [@media(pointer:coarse)]:-my-1.5 [@media(pointer:coarse)]:-ml-1 [@media(pointer:coarse)]:h-9 [@media(pointer:coarse)]:w-9"><Icon name="grip" size={12} strokeWidth={3.2} /></span>
            {it.color && <span className="h-2 w-2 flex-none rounded-full" style={{ background: safeColor(it.color) }} />}
            <span className="min-w-0 flex-1 truncate">{render(it)}</span>
            {ranked && <span className="ui-num text-[11px] font-medium text-[var(--fg3)]">#{i + 1}</span>}
          </motion.div>
        ))}
      </div>
    </div>
  )
}

/* Tree view ──────────────────────────────────────────────────────────────── */

export type TreeNode = { id: string; label: string; /** shown on the right for files, e.g. "2.1 KB" */ size?: string; icon?: IconName; children?: TreeNode[] }
const TREE_EXT: Record<string, string> = { tsx: 'var(--accent)', ts: 'var(--accent)', jsx: 'var(--accent)', js: 'var(--warn)', css: 'var(--c3)', json: 'var(--warn)', md: 'var(--fg2)', svg: 'var(--c4)', png: 'var(--c4)', jpg: 'var(--c4)' }
function TreeIcon({ name, dir, open }: { name: string; dir: boolean; open: boolean }) {
  if (dir) return <Icon name="folder" size={15} strokeWidth={1.8} className="text-[var(--warn)]" fill={open ? 'color-mix(in srgb,var(--warn) 25%,transparent)' : 'none'} />
  return <Icon name="file" size={15} strokeWidth={1.8} style={{ color: TREE_EXT[name.split('.').pop() ?? ''] ?? 'var(--fg3)' }} />
}

/**
 * File tree with roving focus: ↑ / ↓ move, → opens or steps into a folder, ← closes or jumps to the parent,
 * Enter opens (folders toggle, files call `onOpen`). F2 renames any row (file or folder) in place; double-click renames a file.
 * Folders show their item count, files their size; icons are coloured by extension.
 */
export function TreeView({ nodes, defaultExpanded = [], onSelect, onOpen, onRename, className, 'aria-label': ariaLabel = 'Files' }:
  { nodes: TreeNode[]; defaultExpanded?: string[]; onSelect?: (n: TreeNode) => void; onOpen?: (n: TreeNode) => void
    onRename?: (n: TreeNode, name: string, previous: string) => void; className?: string; 'aria-label'?: string }) {
  const [open, setOpen] = useState(() => new Set(defaultExpanded))
  const [names, setNames] = useState<Record<string, string>>({})
  const [sel, setSel] = useState<string>(nodes[0]?.id ?? '')
  const [editing, setEditing] = useState<string | null>(null)
  const cancelRename = useRef(false)
  const rows = useRef(new Map<string, HTMLDivElement>())
  const name = (n: TreeNode) => names[n.id] ?? n.label
  const flat: { n: TreeNode; parent: TreeNode | null }[] = []
  const walk = (list: TreeNode[], parent: TreeNode | null) => list.forEach(n => { flat.push({ n, parent }); if (n.children && open.has(n.id)) walk(n.children, n) })
  walk(nodes, null)
  const toggle = (id: string, force?: boolean) => setOpen(s => { const n = new Set(s), on = force ?? !n.has(id); if (on) n.add(id); else n.delete(id); return n })
  const select = (n: TreeNode) => { setSel(n.id); rows.current.get(n.id)?.focus(); onSelect?.(n) }
  const onKey = (e: RKeyboardEvent, n: TreeNode, i: number, parent: TreeNode | null) => {
    if (editing) return
    const dir = !!n.children, isOpen = open.has(n.id)
    const act: Record<string, () => void> = {
      ArrowDown: () => flat[i + 1] && select(flat[i + 1].n), ArrowUp: () => flat[i - 1] && select(flat[i - 1].n),
      Home: () => select(flat[0].n), End: () => select(flat[flat.length - 1].n),
      ArrowRight: () => { if (dir) { if (isOpen) { if (flat[i + 1]) select(flat[i + 1].n) } else toggle(n.id, true) } },
      ArrowLeft: () => { if (dir && isOpen) toggle(n.id, false); else if (parent) select(parent) },
      Enter: () => { if (dir) toggle(n.id); else onOpen?.(n) }, F2: () => setEditing(n.id),
    }
    if (act[e.key]) { e.preventDefault(); act[e.key]() }
  }
  const render = (list: TreeNode[], depth: number, parent: TreeNode | null): ReactNode => list.map(n => {
    const dir = !!n.children, isOpen = open.has(n.id), i = flat.findIndex(f => f.n.id === n.id)
    return (
      <li key={n.id} role="none">
        <div ref={el => { if (el) rows.current.set(n.id, el); else rows.current.delete(n.id) }} role="treeitem" aria-level={depth + 1} aria-selected={sel === n.id}
          aria-expanded={dir ? isOpen : undefined} tabIndex={sel === n.id ? 0 : -1} style={{ paddingLeft: 8 + depth * 16 }}
          onClick={() => { select(n); if (dir) toggle(n.id) }} onDoubleClick={() => !dir && setEditing(n.id)} onKeyDown={e => onKey(e, n, i, parent)}
          className={cn('flex h-7 cursor-pointer items-center gap-1.5 rounded-md pr-2 text-[13px] whitespace-nowrap outline-none focus-visible:shadow-[inset_0_0_0_2px_var(--accent)] [@media(pointer:coarse)]:h-9 [@media(pointer:coarse)]:text-sm',
            sel === n.id ? 'bg-[var(--accent-soft)] text-[color-mix(in_srgb,var(--accent)_78%,var(--fg))]' : 'hover:bg-[var(--muted)]')}>
          <span className="grid w-3.5 flex-none place-items-center text-[var(--fg3)]">
            {dir && <motion.span initial={false} animate={{ rotate: isOpen ? 90 : 0 }} transition={spring(0.2, 0.25)} className="grid"><Icon name="chevronRight" size={11} strokeWidth={3} /></motion.span>}
          </span>
          {n.icon ? <Icon name={n.icon} size={15} className="text-[var(--fg3)]" /> : <TreeIcon name={name(n)} dir={dir} open={isOpen} />}
          {editing === n.id
            ? <input autoFocus defaultValue={name(n)} aria-label={`Rename ${name(n)}`} onClick={e => e.stopPropagation()}
              onFocus={e => { const v = e.currentTarget.value, dot = v.lastIndexOf('.'); e.currentTarget.setSelectionRange(0, dot > 0 ? dot : v.length) }}
              onKeyDown={e => {
                e.stopPropagation()
                if (e.key === 'Escape') { cancelRename.current = true; setEditing(null); rows.current.get(n.id)?.focus() }
                if (e.key === 'Enter') e.currentTarget.blur()
              }}
              onBlur={e => {
                if (cancelRename.current) { cancelRename.current = false; return }
                const v = e.currentTarget.value.trim(), prev = name(n)
                setEditing(null); rows.current.get(n.id)?.focus()
                if (v && v !== prev) { setNames(m => ({ ...m, [n.id]: v })); onRename?.(n, v, prev) }
              }}
              className={cn('w-[140px] min-w-0 rounded border border-[var(--accent)] bg-[var(--card)] px-1 py-px text-[13px] text-[var(--fg)] outline-none [@media(pointer:coarse)]:flex-1', TOUCH.input)} />
            : <motion.span key={name(n)} initial={{ opacity: names[n.id] ? 0.3 : 1 }} animate={{ opacity: 1 }} className="truncate">{name(n)}</motion.span>}
          <span className="ui-num ml-auto pl-2 text-[11px] text-[var(--fg2)]">{dir ? n.children!.length : n.size}</span>
        </div>
        {dir && <Collapse open={isOpen}><ul role="group" className="m-0 list-none p-0">{render(n.children!, depth + 1, n)}</ul></Collapse>}
      </li>
    )
  })
  return <ul role="tree" aria-label={ariaLabel} className={cn('m-0 list-none p-0 select-none', className)}>{render(nodes, 0, null)}</ul>
}

/* Activity timeline ──────────────────────────────────────────────────────── */

export type TimelineKind = 'commit' | 'comment' | 'deploy' | 'file' | 'alert'
export type TimelineItem = {
  /** stable key: new items can be prepended and animate in without remounting the rest */ id: string
  title: ReactNode; time: string; /** consecutive items with the same day share a heading */ day?: string
  kind?: TimelineKind; /** quoted text under the title */ quote?: ReactNode; /** file attachment chip */ attachment?: { name: string; size?: string }
  description?: ReactNode
}
const TL_KIND: Record<TimelineKind, [IconName, string]> = {
  commit: ['commit', 'var(--accent)'], comment: ['message', 'var(--c3)'], deploy: ['check', 'var(--ok)'], file: ['file', 'var(--fg2)'], alert: ['alertCircle', 'var(--bad)'],
}

/** Activity feed grouped by day. Prepend items (with new ids) and they slide in while the rest move down. */
export function Timeline({ items, className }: { items: TimelineItem[]; className?: string }) {
  // a day can come back later in the feed ("Today", "Yesterday", "Today"), so its key counts the earlier runs of that day
  const groups: { day: string; key: string; items: TimelineItem[] }[] = []
  items.forEach(it => {
    const d = it.day ?? '', g = groups[groups.length - 1]
    if (g && g.day === d) g.items.push(it)
    else groups.push({ day: d, key: `${d}#${groups.filter(x => x.day === d).length}`, items: [it] })
  })
  return (
    <div className={cn('flex flex-col', className)}>
      {groups.map(g => (
        <section key={g.key} aria-label={g.day || undefined}>
          {g.day && <div className="mt-1 mb-2 text-[11px] font-semibold tracking-[.05em] text-[var(--fg3)] uppercase">{g.day}</div>}
          <ol className="m-0 list-none p-0">
            <AnimatePresence initial={false}>
              {g.items.map((it, i) => {
                const [glyph, color] = TL_KIND[it.kind ?? 'commit']
                return (
                  <motion.li key={it.id} layout="position" initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }}
                    transition={spring(0.15, 0.4)} className="relative overflow-hidden">
                    <div className="relative grid grid-cols-[28px_1fr] gap-2.5 pb-3">
                      {i < g.items.length - 1 && <span className="absolute top-[30px] bottom-0.5 left-[13.5px] w-px bg-[var(--line)]" />}
                      <motion.span initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ ...spring(0.5, 0.45), delay: 0.1 }}
                        className="grid h-7 w-7 place-items-center rounded-full border border-[var(--line)] bg-[var(--card)]" style={{ color }}>
                        <Icon name={glyph} size={13} strokeWidth={2.2} />
                      </motion.span>
                      <div className="min-w-0">
                        <div className="pt-1 text-[13px] leading-[1.45] [&_b]:font-semibold">{it.title}</div>
                        {it.description && <div className="mt-0.5 text-[13px] text-[var(--fg2)]">{it.description}</div>}
                        {it.quote && <div className={cn(surface.md, 'mt-2 bg-transparent px-2.5 py-2 text-xs text-[var(--fg2)]')}>{it.quote}</div>}
                        {it.attachment && (
                          <div className={cn(surface.md, 'mt-2 flex items-center gap-2 bg-transparent px-2.5 py-2 text-xs text-[var(--fg2)]')}>
                            <Icon name="file" size={14} className="text-[var(--bad)]" /><b className="font-medium text-[var(--fg)]">{it.attachment.name}</b>
                            {it.attachment.size && <span className="ml-auto text-[var(--fg3)]">{it.attachment.size}</span>}
                          </div>
                        )}
                        <div className="mt-0.5 text-[11px] text-[var(--fg3)]">{it.time}</div>
                      </div>
                    </div>
                  </motion.li>
                )
              })}
            </AnimatePresence>
          </ol>
        </section>
      ))}
    </div>
  )
}

/* Split panes ────────────────────────────────────────────────────────────── */

/**
 * Two resizable panes, side by side or stacked (nest one inside another for IDE layouts). Drag the divider,
 * or focus it and use the arrow keys (Shift for big steps); Enter or double-click resets with a spring.
 * Releasing the first pane below `min` snaps it closed; drag the divider back out to reopen it.
 */
export function SplitPane({ first, second, direction = 'horizontal', defaultSize = 40, min = 15, max = 85, label = 'Resize panes', className, style }:
  { first: ReactNode; second: ReactNode; direction?: 'horizontal' | 'vertical'; /** first pane, % */ defaultSize?: number; min?: number; max?: number
    label?: string; className?: string; style?: CSSProperties }) {
  const [state, setState] = useState({ size: defaultSize, spring: false })
  const box = useRef<HTMLDivElement>(null)
  const h = direction === 'horizontal'
  const drag = usePointerDrag({
    cursor: h ? 'col-resize' : 'row-resize',
    onMove: p => {
      const r = box.current?.getBoundingClientRect(); if (!r) return
      setState({ size: clamp(h ? ((p.x - r.left) / r.width) * 100 : ((p.y - r.top) / r.height) * 100, 0, max), spring: false })
    },
    onEnd: () => setState(s => s.size > 0 && s.size < min ? { size: 0, spring: true } : s), // released below min: snap closed
  })
  const dragging = drag.dragging
  const set = (pct: number, animate = false) => { const p = clamp(pct, 0, max); setState({ size: p < min && !dragging ? 0 : p, spring: animate }) }
  const onKey = (e: RKeyboardEvent) => {
    const step = e.shiftKey ? 10 : 2, k = h ? { ArrowLeft: -step, ArrowRight: step } : { ArrowUp: -step, ArrowDown: step }
    const d = (k as unknown as Record<string, number | undefined>)[e.key]
    if (d !== undefined) { e.preventDefault(); set(state.size === 0 && d > 0 ? min : state.size + d) }
    if (e.key === 'Enter' || e.key === 'Home') { e.preventDefault(); set(defaultSize, true) }
  }
  return (
    <div ref={box} className={cn('flex min-h-0 min-w-0 overflow-hidden', h ? 'flex-row' : 'h-full flex-col', className)} style={style}>
      <motion.div className="flex min-h-0 min-w-0 flex-none flex-col overflow-hidden" initial={false} animate={{ flexBasis: `${state.size}%` }}
        transition={state.spring ? spring(0.15, 0.4) : { duration: 0 }}>{first}</motion.div>
      <div role="separator" aria-orientation={h ? 'vertical' : 'horizontal'} aria-label={label} aria-valuemin={0} aria-valuemax={max} aria-valuenow={Math.round(state.size)} tabIndex={0}
        onPointerDown={e => { if (e.button === 0) drag.start(e) }} onDoubleClick={() => set(defaultSize, true)} onKeyDown={onKey}
        data-dragging={dragging || undefined}
        className={cn('group relative z-[2] flex-none touch-none outline-none', h ? '-mx-1 w-[7px] cursor-col-resize [@media(pointer:coarse)]:-mx-4 [@media(pointer:coarse)]:w-8' : '-my-1 h-[7px] cursor-row-resize [@media(pointer:coarse)]:-my-4 [@media(pointer:coarse)]:h-8')}>
        <span className={cn('absolute bg-[var(--line)] transition-all group-hover:bg-[var(--accent)] group-focus-visible:bg-[var(--accent)] group-data-[dragging]:bg-[var(--accent)]',
          h ? 'inset-y-0 left-[3px] w-px group-hover:left-[2px] group-hover:w-[3px] group-focus-visible:left-[2px] group-focus-visible:w-[3px] group-data-[dragging]:left-[2px] group-data-[dragging]:w-[3px] [@media(pointer:coarse)]:!left-[15.5px]'
            : 'inset-x-0 top-[3px] h-px group-hover:top-[2px] group-hover:h-[3px] group-focus-visible:top-[2px] group-focus-visible:h-[3px] group-data-[dragging]:top-[2px] group-data-[dragging]:h-[3px] [@media(pointer:coarse)]:!top-[15.5px]')} />
        {/* touch: a visible grip in the middle of the divider, inside the wider hit area */}
        <span aria-hidden className={cn('absolute top-1/2 left-1/2 hidden -translate-x-1/2 -translate-y-1/2 rounded-full border border-[var(--line2)] bg-[var(--card)] shadow-[0_1px_3px_rgba(0,0,0,.12)] group-data-[dragging]:border-[var(--accent)] [@media(pointer:coarse)]:block',
          h ? 'h-9 w-3' : 'h-3 w-9')} />
      </div>
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">{second}</div>
    </div>
  )
}
