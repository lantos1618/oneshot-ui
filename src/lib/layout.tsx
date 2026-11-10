import { Fragment, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode, type KeyboardEvent as RKeyboardEvent, type PointerEvent as RPointerEvent } from 'react'
import { Icon, type IconName, TOUCH, clamp, cn, prefersReducedMotion, safeColor, spring, surface, useCoarsePointer, useRefocus, useLongPress, usePointerDrag, useWidth, fmt, moveById } from './core'
import { PresenceList, useFlip } from './motion'
import { Collapse, EmptyState } from './feedback'
import { useVirtual } from './virtual'
import { type Magnet, MagnetBubble, magnetKeyDirection, useMagnet } from './magnet'

/*
 * Pointer-driven (mouse, pen, touch). The dragged item stays in place as a dashed slot while a
 * floating clone follows the pointer; `onMove` fires live as the slot should move, so React state is
 * the single source of truth and useFlip slides everything else out of the way. */

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
    let i = kids.findIndex(k => { const r = lyLayoutRect(k); return axis === 'x' ? (x < r.left + r.width / 2) : y < r.top + r.height / 2 })
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

/**
 * Reorderable list. Drag the ⠿ handle (only the handle starts a drag, so text stays selectable), or focus a
 * row and press Alt + ↑ / ↓ (the new position is announced). Rows show their rank and an optional colour dot.
 */
export function SortableList<T extends { id: string; color?: string }>({ items, onChange, render, ranked = true, className, label }:
  { items: T[]; onChange: (v: T[]) => void; render: (t: T) => ReactNode; ranked?: boolean; className?: string; label?: string }) {
  const ref = useRef(items); ref.current = items
  const root = useRef<HTMLDivElement>(null)
  const refocus = useRefocus(root)
  const hint = useId()
  const [lifted, setLifted] = useState<string | null>(null), liftT = useRef<ReturnType<typeof setTimeout>>(undefined)
  useEffect(() => () => clearTimeout(liftT.current), [])
  const [said, setSaid] = useState('')
  const moveTo = (id: string, index: number) => {
    const next = moveById(ref.current, id, index)
    if (next !== ref.current) { ref.current = next; onChange(next) }
  }
  const sort = useDragSort({ onMove: (id, _, i) => moveTo(id, i) })
  const list = useRef<HTMLDivElement>(null)
  useFlip(list, { transition: spring(0.18, 0.4) })
  return (
    <div ref={root} className={cn('flex flex-col gap-1.5', className)}>
      <span id={hint} hidden>{'Alt and arrow keys to move.'}</span>
      <span role="status" className="sr-only">{said}</span>
      <div ref={list} {...sort.listProps('list')} role="list" aria-label={label ?? 'Sortable list'} className="flex flex-col gap-1.5">
        {items.map((it, i) => (
          <div key={it.id} data-flip={it.id} {...sort.itemProps(it.id)} data-sl-item={it.id} role="listitem" tabIndex={0}
            aria-describedby={hint}
            onKeyDown={e => {
              if (!e.altKey || (e.key !== 'ArrowUp' && e.key !== 'ArrowDown')) return
              e.preventDefault(); const j = i + (e.key === 'ArrowUp' ? -1 : 1); if (j < 0 || j >= items.length) return
              moveTo(it.id, j); refocus(`[data-sl-item="${CSS.escape(it.id)}"]`)
              setLifted(it.id); clearTimeout(liftT.current); liftT.current = setTimeout(() => setLifted(null), 350)
              setSaid(`Moved to position ${j + 1} of ${items.length}`)
            }}
            className={cn('flex items-center gap-2.5 rounded-[var(--r-md)] border px-2.5 py-2 text-[13px] outline-none select-none focus-visible:shadow-[0_0_0_2px_var(--accent)]',
              sort.dragging === it.id ? 'border-dashed border-[var(--line2)] bg-transparent [&>*]:invisible' : 'border-[var(--line)] bg-[var(--card)]',
              lifted === it.id && 'shadow-[0_0_0_2px_var(--accent),0_8px_20px_rgba(0,0,0,.12)]')}>
            <span {...sort.handleProps(it.id)} aria-hidden title={'Drag to reorder'}
              className="grid h-[22px] w-[18px] flex-none cursor-grab touch-none place-items-center rounded-[var(--r-sm)] text-[var(--fg3)] hover:bg-[var(--muted)] hover:text-[var(--fg)] active:cursor-grabbing [@media(pointer:coarse)]:-my-1.5 [@media(pointer:coarse)]:-ms-1 [@media(pointer:coarse)]:h-9 [@media(pointer:coarse)]:w-9"><Icon name="grip" size={12} strokeWidth={3.2} /></span>
            {it.color && <span className="h-2 w-2 flex-none rounded-full" style={{ background: safeColor(it.color) }} />}
            <span className="min-w-0 flex-1 truncate">{render(it)}</span>
            {ranked && <span className="ui-num text-[11px] font-medium text-[var(--fg3)]">#{fmt.number(i + 1)}</span>}
          </div>
        ))}
      </div>
    </div>
  )
}

export type TreeNode = { id: string; label: string; /** shown on the right for files, e.g. "2.1 KB" */ size?: string; icon?: IconName; children?: TreeNode[] }
const TREE_EXT: Record<string, string> = { tsx: 'var(--accent)', ts: 'var(--accent)', jsx: 'var(--accent)', js: 'var(--warn)', css: 'var(--c3)', json: 'var(--warn)', md: 'var(--fg2)', svg: 'var(--c4)', png: 'var(--c4)', jpg: 'var(--c4)' }
function TreeIcon({ name, dir, open }: { name: string; dir: boolean; open: boolean }) {
  if (dir) return <Icon name="folder" size={15} strokeWidth={1.8} className="text-[var(--warn)]" fill={open ? 'color-mix(in srgb,var(--warn) 25%,transparent)' : 'none'} />
  return <Icon name="file" size={15} strokeWidth={1.8} style={{ color: TREE_EXT[name.split('.').pop() ?? ''] ?? 'var(--fg3)' }} />
}

const treeCount = (ns: TreeNode[]): number => ns.reduce((s, n) => s + 1 + (n.children ? treeCount(n.children) : 0), 0)
/** Trees with more nodes than this render only the rows in view. */
const TREE_VIRTUAL_AT = 300
type TreeFlat = {
  n: TreeNode; parent: TreeNode | null; depth: number; pos: number; size: number
  /** ancestors, root first (path[d] owns the thread line at level d) */ path: TreeNode[]
  /** per depth 0..depth: whether the node at that depth on this row's path has siblings after it (its parent's thread continues below) */ rails: boolean[]
}
/**
 * Row heights (px) with the classes that draw them: the virtualiser and PageUp/PageDown use the numbers, CSS the
 * classes (touch screens get the taller rows before any script runs), so each pair must change together.
 */
const TREE_ROW = { normal: [28, 'h-7 text-[13px]'], compact: [24, 'h-6 text-xs'], coarse: [36, '[@media(pointer:coarse)]:h-9 [@media(pointer:coarse)]:text-sm'] } as const
/** Indent geometry shared by rows and thread lines: the row's start padding and the per-level step (px). */
const treeIndent = (compact?: boolean) => compact ? { base: 4, step: 12 } : { base: 8, step: 16 }

/**
 * File tree with roving focus: ↑ / ↓ move, → opens or steps into a folder, ← closes or jumps to the parent,
 * Home / End jump, Enter opens (folders toggle, files call `onOpen`). With `onRename`, F2 renames any row (file or
 * folder) in place and double-click renames a file; the new name shows until `nodes` changes that label. Folders show
 * their item count, files their size; icons are coloured by extension. `compact` gives denser rows without the counts
 * (for side panels such as an IDE explorer). With no nodes it shows `empty` (default "No items"). Trees of more than 300
 * nodes (or `virtualize`) render only the visible rows of the flattened open nodes inside a `height` px scroller,
 * with aria-level / aria-setsize / aria-posinset on each row, so 10k-node trees stay instant.
 * `lines` draws thread lines (Reddit / VS Code style): a vertical guide per level from each open folder down through
 * its children, with an elbow into each child row. They are drawn per row, so they follow the open/close animation
 * and virtualisation; the selected row's branch is highlighted, and so is a line under the pointer. Clicking a line
 * collapses that folder (and selects it); keyboard users use ← instead, so the lines are not in the Tab order.
 * `'hover'` shows them only while the pointer or focus is in the tree (always on touch screens). Turning them on or
 * off never moves a row: the indent is the same either way.
 */
export function TreeView({ nodes, defaultExpanded = [], onSelect, onOpen, onRename, compact, lines = false, virtualize, height = 360, empty, className, 'aria-label': ariaLabelProp }:
  { nodes: TreeNode[]; defaultExpanded?: string[]; onSelect?: (n: TreeNode) => void; onOpen?: (n: TreeNode) => void
    onRename?: (n: TreeNode, name: string, previous: string) => void; compact?: boolean
    /** shown instead of the tree when `nodes` is empty (default "No items") */ empty?: ReactNode
    /** thread lines from each folder through its children (default false); 'hover' shows them while the tree is hovered or focused */ lines?: boolean | 'hover'
    /** render only the rows in view: true, false, or above this many nodes (default 300) */ virtualize?: boolean | number
    /** px, virtual mode: the tree scrolls inside this height */ height?: number; className?: string; 'aria-label'?: string }) {
  const [open, setOpen] = useState(() => new Set(defaultExpanded))
  const ariaLabel = ariaLabelProp ?? 'Files'
  const uid = useId()
  const [hot, setHot] = useState<string | null>(null) // the folder whose thread line is under the pointer
  // renamed labels, each kept only while `nodes` still has the label it replaced
  const [names, setNames] = useState<Record<string, { from: string; to: string }>>({})
  const [sel, setSel] = useState<string>(nodes[0]?.id ?? '')
  const [editing, setEditing] = useState<string | null>(null)
  const cancelRename = useRef(false)
  const rows = useRef(new Map<string, HTMLDivElement>())
  const name = (n: TreeNode) => { const o = names[n.id]; return o && o.from === n.label ? o.to : n.label }
  const flat = useMemo(() => {
    const out: TreeFlat[] = []
    const walk = (list: TreeNode[], parent: TreeNode | null, depth: number, path: TreeNode[], rails: boolean[]) => list.forEach((n, i) => {
      const own = [...rails, i < list.length - 1]
      out.push({ n, parent, depth, pos: i + 1, size: list.length, path, rails: own })
      if (n.children && open.has(n.id)) walk(n.children, n, depth + 1, [...path, n], own)
    })
    walk(nodes, null, 0, [], [])
    return out
  }, [nodes, open])
  const indexOf = useMemo(() => new Map(flat.map((f, i) => [f.n.id, i])), [flat])
  const total = useMemo(() => treeCount(nodes), [nodes])
  const virtualOn = virtualize === true || (virtualize !== false && total > (typeof virtualize === 'number' ? virtualize : TREE_VIRTUAL_AT))
  const coarse = useCoarsePointer()
  const box = useRef<HTMLDivElement>(null)
  // the Tab stop: the selected row, or the first one when the selected id is gone from `nodes`
  const tabStop = indexOf.has(sel) ? sel : flat[0]?.n.id
  const selAt = indexOf.get(sel) ?? 0
  const keep = useMemo(() => [selAt], [selAt])
  const rowH = TREE_ROW[coarse ? 'coarse' : compact ? 'compact' : 'normal'][0]
  const v = useVirtual({ count: flat.length, estimateSize: rowH, scrollRef: box, enabled: virtualOn, keep, initialRect: { width: 320, height } })
  const pendingFocus = useRef<string | null>(null)
  useLayoutEffect(() => { const id = pendingFocus.current; if (id && rows.current.get(id)) { pendingFocus.current = null; rows.current.get(id)!.focus({ preventScroll: true }) } })
  const toggle = (id: string, force?: boolean) => setOpen(s => { const n = new Set(s), on = force ?? !n.has(id); if (on) n.add(id); else n.delete(id); return n })
  const select = (n: TreeNode) => {
    setSel(n.id)
    if (virtualOn) { const i = indexOf.get(n.id); if (i != null) v.scrollToIndex(i, { align: 'auto' }) }
    const el = rows.current.get(n.id)
    if (el?.isConnected) el.focus({ preventScroll: virtualOn }); else pendingFocus.current = n.id
    onSelect?.(n)
  }
  const onKey = (e: RKeyboardEvent, n: TreeNode, i: number, parent: TreeNode | null) => {
    if (editing) return
    const dir = !!n.children, isOpen = open.has(n.id)
    const page = Math.max(1, Math.floor(v.viewportSize / rowH) - 1)
    const act: Record<string, () => void> = {
      ArrowDown: () => flat[i + 1] && select(flat[i + 1].n), ArrowUp: () => flat[i - 1] && select(flat[i - 1].n),
      Home: () => select(flat[0].n), End: () => select(flat[flat.length - 1].n),
      PageDown: () => select(flat[Math.min(flat.length - 1, i + page)].n), PageUp: () => select(flat[Math.max(0, i - page)].n),
      ArrowRight: () => { if (dir) { if (isOpen) { if (flat[i + 1]) select(flat[i + 1].n) } else toggle(n.id, true) } },
      ArrowLeft: () => { if (dir && isOpen) toggle(n.id, false); else if (parent) select(parent) },
      Enter: () => { if (dir) toggle(n.id); else onOpen?.(n) },
    }
    if (onRename) act.F2 = () => setEditing(n.id)
    const key = e.key
    if (act[key]) { e.preventDefault(); act[key]() }
  }
  const { base, step } = treeIndent(compact)
  // the selected row's branch is highlighted: an open folder's own thread, otherwise the thread it hangs from
  const selF = flat[selAt], activeOwner = selF && (selF.n.children && open.has(selF.n.id) ? selF.n.id : selF.parent?.id)
  /** The thread lines of one row: for each ancestor level, a vertical line (when that folder's children continue below
      this row) or, for the row's own parent, an elbow into the row. Each is a button that collapses its folder. */
  const threads = (f: TreeFlat) => f.path.map((owner, d) => {
    const own = d === f.depth - 1, cont = f.rails[d + 1]
    if (!own && !cont) return null
    const tone = owner.id === hot ? 'var(--fg3)' : owner.id === activeOwner ? 'var(--accent)' : 'var(--line2)'
    // the elbow reaches the chevron of a folder, or runs on under the empty chevron cell to the icon of a file
    const reach = step - 7 + (f.n.children ? -1 : 10)
    const ln = 'absolute transition-colors duration-150'
    return (
      <button key={owner.id} type="button" tabIndex={-1} aria-label={`Collapse ${name(owner)}`}
        onClick={e => { e.stopPropagation(); toggle(owner.id, false); select(owner) }} onDoubleClick={e => e.stopPropagation()}
        onPointerEnter={() => setHot(owner.id)} onPointerLeave={() => setHot(h => (h === owner.id ? null : h))}
        style={{ insetInlineStart: base + d * step + 7 - step / 2, width: step, '--tl': tone } as CSSProperties}
        className={cn('ui-target absolute inset-y-0 cursor-pointer border-0 bg-transparent p-0 outline-none', lines === 'hover' && 'opacity-0 transition-opacity duration-150 group-focus-within/tree:opacity-100 group-hover/tree:opacity-100 [@media(pointer:coarse)]:opacity-100')}>
        {own && !cont
          ? <span className={cn(ln, 'top-0 h-1/2 rounded-es-[var(--r-sm)] border-s border-b border-[var(--tl)]')} style={{ insetInlineStart: step / 2, width: reach }} />
          : <>
            <span className={cn(ln, 'inset-y-0 w-px bg-[var(--tl)]')} style={{ insetInlineStart: step / 2 }} />
            {own && <span className={cn(ln, 'top-1/2 h-px bg-[var(--tl)]')} style={{ insetInlineStart: step / 2, width: reach }} />}
          </>}
      </button>
    )
  })
  const row = (f: TreeFlat, i: number, extra?: { style?: CSSProperties; aria?: Record<string, number> }) => {
    const { n, depth, parent } = f, dir = !!n.children, isOpen = open.has(n.id)
    // with lines on, the row is named by its label and count only (not by the "Collapse …" buttons inside it)
    const idl = `${uid}t${encodeURIComponent(n.id)}`, named = !!lines && depth > 0 && editing !== n.id
    return (
      <div ref={el => { if (!el) return; rows.current.set(n.id, el); return () => { if (rows.current.get(n.id) === el) rows.current.delete(n.id) } }} role="treeitem" aria-level={depth + 1} aria-selected={sel === n.id}
        aria-expanded={dir ? isOpen : undefined} tabIndex={tabStop === n.id ? 0 : -1} data-index={virtualOn ? i : undefined} {...extra?.aria}
        aria-labelledby={named ? (compact ? `${idl}l` : `${idl}l ${idl}c`) : undefined}
        style={{ paddingInlineStart: base + depth * step, ...extra?.style }}
        onClick={() => { select(n); if (dir) toggle(n.id) }} onDoubleClick={() => { if (!dir && onRename) setEditing(n.id) }} onKeyDown={e => onKey(e, n, i, parent)}
        className={cn('relative flex cursor-pointer items-center gap-1.5 rounded-[var(--r-md)] pe-2 whitespace-nowrap outline-none focus-visible:shadow-[inset_0_0_0_2px_var(--accent)]', TREE_ROW[compact ? 'compact' : 'normal'][1], TREE_ROW.coarse[1],
          sel === n.id ? 'bg-[var(--accent-soft)] text-[color-mix(in_srgb,var(--accent)_78%,var(--fg))]' : 'hover:bg-[var(--muted)]')}>
        {lines && threads(f)}
        {/* above the thread lines' widened hit areas, so a click on the chevron toggles this row */}
        <span className="relative z-[1] grid w-3.5 flex-none place-items-center text-[var(--fg3)]">
          {dir && <span className={cn('grid transition-transform duration-[250ms] ease-[var(--ui-spring)] motion-reduce:transition-none', isOpen && 'rotate-90')}><Icon name="chevronRight" size={11} strokeWidth={3} /></span>}
        </span>
        {n.icon ? <Icon name={n.icon} size={15} className="text-[var(--fg3)]" /> : <TreeIcon name={name(n)} dir={dir} open={isOpen} />}
        {editing === n.id
          ? <input autoFocus defaultValue={name(n)} aria-label={`Rename ${name(n)}`} onClick={e => e.stopPropagation()}
            onFocus={e => { const val = e.currentTarget.value, dot = val.lastIndexOf('.'); e.currentTarget.setSelectionRange(0, dot > 0 ? dot : val.length) }}
            onKeyDown={e => {
              e.stopPropagation()
              if (e.key === 'Escape') { cancelRename.current = true; setEditing(null); rows.current.get(n.id)?.focus() }
              if (e.key === 'Enter') e.currentTarget.blur()
            }}
            onBlur={e => {
              if (cancelRename.current) { cancelRename.current = false; return }
              const val = e.currentTarget.value.trim(), prev = name(n)
              setEditing(null); rows.current.get(n.id)?.focus()
              if (val && val !== prev) { setNames(m => ({ ...m, [n.id]: { from: n.label, to: val } })); onRename?.(n, val, prev) }
            }}
            className={cn('w-[140px] min-w-0 rounded-[var(--r-sm)] border border-[var(--accent)] bg-[var(--card)] px-1 py-px text-[13px] text-[var(--fg)] outline-none [@media(pointer:coarse)]:flex-1', TOUCH.input)} />
          : <span key={name(n)} id={`${idl}l`} className={cn('truncate', name(n) !== n.label && 'ui-in [--ui-e:ease-out] [--ui-o:.3]')}>{name(n)}</span>}
        {/* the space keeps label and count apart in the accessible name (flex drops it visually) */}
        {!compact && <>{' '}<span id={`${idl}c`} className="ms-auto ps-2 text-[11px] tabular-nums text-[var(--fg2)]">{dir ? n.children!.length : n.size}</span></>}
      </div>
    )
  }
  if (!nodes.length) return <div className={className}>{empty ?? <EmptyState size="sm" title="No items" />}</div>
  if (virtualOn) return (
    <div ref={box} role="tree" aria-label={ariaLabel} className={cn('group/tree relative overflow-auto overscroll-contain select-none', className)} style={{ height }}>
      <div style={{ height: v.totalSize, position: 'relative' }}>
        {v.items.map(it => {
          const f = flat[it.index]
          return <Fragment key={f.n.id}>{row(f, it.index, { style: { position: 'absolute', top: 0, left: 0, right: 0, transform: `translateY(${it.start}px)` }, aria: { 'aria-setsize': f.size, 'aria-posinset': f.pos } })}</Fragment>
        })}
      </div>
    </div>
  )
  const render = (list: TreeNode[], depth: number, parent: TreeNode | null, path: TreeNode[], rails: boolean[]): ReactNode => list.map((n, k) => {
    // rows inside a closed (closing) folder aren't in `flat`: build their entry (and thread lines) here
    const i = indexOf.get(n.id) ?? -1, own = [...rails, k < list.length - 1], f = flat[i] ?? { n, parent, depth, pos: k + 1, size: list.length, path, rails: own }
    return (
      <li key={n.id} role="none">
        {row(f, i)}
        {n.children && <Collapse open={open.has(n.id)}><ul role="group" className="m-0 list-none p-0">{render(n.children, depth + 1, n, [...path, n], own)}</ul></Collapse>}
      </li>
    )
  })
  return <ul role="tree" aria-label={ariaLabel} className={cn('group/tree m-0 list-none p-0 select-none', className)}>{render(nodes, 0, null, [], [])}</ul>
}

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
            <PresenceList items={g.items} keyOf={it => it.id}>
              {(it, { enter }) => {
                const [glyph, color] = TL_KIND[it.kind ?? 'commit']
                return (
                  <li className="ui-grow relative [--ui-d:.4s] [--ui-do:.3s]">
                    <div><div className="relative grid grid-cols-[28px_1fr] gap-2.5 pb-3">
                      {it !== g.items[g.items.length - 1] && <span className="absolute top-[30px] bottom-0.5 start-[13.5px] w-px bg-[var(--line)]" />}
                      <span className={cn('grid h-7 w-7 place-items-center rounded-full border border-[var(--line)] bg-[var(--card)]', enter && 'ui-pop [--ui-d:.45s] [--ui-delay:.1s] [--ui-s:0]')} style={{ color }}>
                        <Icon name={glyph} size={13} strokeWidth={2.2} />
                      </span>
                      <div className="min-w-0">
                        <div className="pt-1 text-[13px] leading-[1.45] [&_b]:font-semibold">{it.title}</div>
                        {it.description && <div className="mt-0.5 text-[13px] text-[var(--fg2)]">{it.description}</div>}
                        {it.quote && <div className={cn(surface.md, 'mt-2 bg-transparent px-2.5 py-2 text-xs text-[var(--fg2)]')}>{it.quote}</div>}
                        {it.attachment && (
                          <div className={cn(surface.md, 'mt-2 flex items-center gap-2 bg-transparent px-2.5 py-2 text-xs text-[var(--fg2)]')}>
                            <Icon name="file" size={14} className="text-[var(--bad)]" /><b className="font-medium text-[var(--fg)]">{it.attachment.name}</b>
                            {it.attachment.size && <span className="ms-auto text-[var(--fg3)]">{it.attachment.size}</span>}
                          </div>
                        )}
                        <div className="mt-0.5 text-[11px] text-[var(--fg3)]">{it.time}</div>
                      </div>
                    </div></div>
                  </li>
                )
              }}
            </PresenceList>
          </ol>
        </section>
      ))}
    </div>
  )
}

/**
 * Two resizable panes, side by side or stacked (nest one inside another for IDE layouts). Drag the divider,
 * or focus it and use the arrow keys (Shift for big steps) or Home / End (first pane closed / at `max`); Enter or
 * double-click resets with a spring.
 * Releasing the first pane below `min` snaps it closed; drag the divider back out to reopen it.
 * Side-by-side panes stack (first on top) while the pane is narrower than `stackBelow` px (640 by default; 0 never stacks).
 * `magnets` (first-pane sizes in %, see useMagnet; `true` = thirds, half and the collapse point) pull the divider while
 * dragging, with guides and the mark's name by the divider; PageUp / PageDown and Ctrl/⌘ + arrows jump between them, Alt
 * (Option) drags freely.
 */
export function SplitPane({ first, second, direction = 'horizontal', defaultSize = 40, min = 15, max = 85, stackBelow = 640, label, magnets, className, style }:
  { first: ReactNode; second: ReactNode; direction?: 'horizontal' | 'vertical'; /** first pane, % */ defaultSize?: number; min?: number; max?: number
    stackBelow?: number; label?: string; magnets?: boolean | readonly Magnet[]; className?: string; style?: CSSProperties }) {
  const [state, setState] = useState<{ size: number; spring: false | 'reset' | 'snap' }>({ size: defaultSize, spring: false })
  const [box, boxW] = useWidth<HTMLDivElement>()
  const h = direction === 'horizontal' && !(boxW > 0 && boxW < stackBelow)
  const pctText = (n: number) => fmt.percent(n / 100, 0)
  const marks = useMemo<readonly Magnet[] | null>(() => magnets === true
    ? [{ value: 0, label: 'Collapse' }, { value: 100 / 3, label: 'One third' }, { value: 50, label: 'Half' }, { value: 200 / 3, label: 'Two thirds' }].filter(m => m.value <= max)
    : magnets || null, [magnets, max])
  const mg = useMagnet({ magnets: marks, min: 0, max: 100, describe: pctText })
  const [snapLabel, setSnapLabel] = useState<string | undefined>()
  const drag = usePointerDrag({
    cursor: h ? 'col-resize' : 'row-resize',
    onMove: p => {
      const r = box.current?.getBoundingClientRect(); if (!r) return
      const raw = h ? ((p.x - r.left) / r.width) * 100 : ((p.y - r.top) / r.height) * 100
      const res = mg.apply(clamp(raw, 0, 100), { px: h ? r.width : r.height, event: p.event })
      const size = clamp(res.value, 0, max), how = res.captured || res.released ? 'snap' as const : false
      if (mg.enabled) setSnapLabel(res.snapped?.label)
      setState(s => s.size === size ? s : { size, spring: how })
    },
    onEnd: () => { mg.reset(); setSnapLabel(undefined); setState(s => s.size > 0 && s.size < min ? { size: 0, spring: 'reset' } : s) }, // released below min: snap closed
  })
  const dragging = drag.dragging
  const set = (pct: number, animate: false | 'reset' | 'snap' = false) => { const p = clamp(pct, 0, max); setState({ size: p < min && !dragging ? 0 : p, spring: animate }) }
  const onKey = (e: RKeyboardEvent) => {
    const jump = mg.enabled ? magnetKeyDirection(e) : 0, to = jump ? mg.next(state.size, jump) : null
    if (to !== null) { e.preventDefault(); set(to, 'snap'); return }
    const step = e.shiftKey ? 10 : 2
    const k: Record<string, number> = h ? { ArrowLeft: -step, ArrowRight: step } : { ArrowUp: -step, ArrowDown: step }
    const d = k[e.key]
    if (d !== undefined) { e.preventDefault(); set(state.size === 0 && d > 0 ? min : state.size + d) }
    if (e.key === 'Home' || e.key === 'End') { e.preventDefault(); set(e.key === 'Home' ? 0 : max) }
    if (e.key === 'Enter') { e.preventDefault(); set(defaultSize, 'reset') }
  }
  const pos = (v: number) => `${clamp(v, 0, 100)}%`
  return (
    <div ref={box} className={cn('relative flex min-h-0 min-w-0 overflow-hidden', h ? 'flex-row' : 'h-full flex-col', className)} style={style}>
      <div className="flex min-h-0 min-w-0 flex-none flex-col overflow-hidden"
        style={{ flexBasis: `${state.size}%`, transition: state.spring === 'reset' ? 'flex-basis .4s var(--ui-spring-soft)' : state.spring === 'snap' && !prefersReducedMotion() ? 'flex-basis .25s var(--ui-spring)' : undefined }}>{first}</div>
      <div role="separator" aria-orientation={h ? 'vertical' : 'horizontal'} aria-label={label ?? 'Resize panes'}
 aria-valuemin={0} aria-valuemax={max} aria-valuenow={Math.round(state.size)} aria-valuetext={mg.enabled ? mg.valueText(state.size, pctText(state.size)) : undefined}
        aria-keyshortcuts={mg.enabled ? 'PageUp PageDown' : undefined} tabIndex={0}
        onPointerDown={e => { if (e.button === 0) { mg.reset(); drag.start(e) } }} onDoubleClick={() => set(defaultSize, 'reset')} onKeyDown={onKey}
        data-dragging={dragging || undefined}
        className={cn('group relative z-[2] flex-none touch-none outline-none', h ? '-mx-1 w-[7px] cursor-col-resize [@media(pointer:coarse)]:-mx-4 [@media(pointer:coarse)]:w-8' : '-my-1 h-[7px] cursor-row-resize [@media(pointer:coarse)]:-my-4 [@media(pointer:coarse)]:h-8')}>
        <span className={cn('absolute bg-[var(--line)] transition-all group-hover:bg-[var(--accent)] group-focus-visible:bg-[var(--accent)] group-data-[dragging]:bg-[var(--accent)]',
          h ? 'inset-y-0 start-[3px] w-px group-hover:start-[2px] group-hover:w-[3px] group-focus-visible:start-[2px] group-focus-visible:w-[3px] group-data-[dragging]:start-[2px] group-data-[dragging]:w-[3px] [@media(pointer:coarse)]:!start-[15.5px]'
            : 'inset-x-0 top-[3px] h-px group-hover:top-[2px] group-hover:h-[3px] group-focus-visible:top-[2px] group-focus-visible:h-[3px] group-data-[dragging]:top-[2px] group-data-[dragging]:h-[3px] [@media(pointer:coarse)]:!top-[15.5px]')} />
        {/* touch: a visible grip in the middle of the divider, inside the wider hit area */}
        <span aria-hidden className={cn('absolute top-1/2 left-1/2 hidden -translate-x-1/2 -translate-y-1/2 rounded-full border border-[var(--line2)] bg-[var(--card)] shadow-[0_1px_3px_rgba(0,0,0,.12)] group-data-[dragging]:border-[var(--accent)] [@media(pointer:coarse)]:block',
          h ? 'h-9 w-3' : 'h-3 w-9')} />
        {mg.enabled && <MagnetBubble label={snapLabel} show={dragging} className={h ? '!bottom-auto top-3 !mb-0' : '!bottom-auto top-1/2 !mb-0 -translate-y-1/2'} />}
      </div>
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">{second}</div>
      {/* while dragging: faint guides at each mark, the one the divider sits on in the accent */}
      {mg.enabled && dragging && mg.stops.filter(v => v > 0 && v <= max).map(v => (
        <span key={v} aria-hidden className={cn('pointer-events-none absolute z-[1]', h ? 'inset-y-0 w-px -ms-px' : 'inset-x-0 h-px -mt-px',
          Math.abs(v - state.size) < 1e-6 ? 'bg-[var(--accent)]' : 'bg-[color-mix(in_srgb,var(--accent)_35%,transparent)]')}
          style={h ? { insetInlineStart: pos(v) } : { top: pos(v) }} />
      ))}
      {mg.live}
    </div>
  )
}
