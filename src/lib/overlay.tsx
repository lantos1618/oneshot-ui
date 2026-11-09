import { cloneElement, createContext, isValidElement, useCallback, useContext, useEffect, useId, useLayoutEffect, useRef, useState, type HTMLAttributes, type ReactElement, type ReactNode, type RefObject, type KeyboardEvent as RKeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react'
import { createPortal } from 'react-dom'
import { AnimatePresence, motion, useDragControls, type Variants } from 'motion/react'
import { Button, type ButtonProps, FOCUSABLE, Icon, IconButton, type IconName, Kbd, cn, floatingSurface, isTouch, menuItemClass, prefersReducedMotion, spring, useControllable, useFocusTrap, useLongPress, useMediaQuery, useOutside, useRoving, AnimatedNumber } from './core'
import { EmptyState } from './feedback'

/* ════════════════════════════════════════════════════════════════════════════
 * 5. FLOATING LAYER: one Popover powers menus, selects, date pickers, hover cards.
 * ══════════════════════════════════════════════════════════════════════════ */

type PopCtx = { open: boolean; setOpen: (v: boolean) => void; triggerRef: RefObject<HTMLButtonElement | null>; id: string }
const PopoverCtx = createContext<PopCtx | null>(null)
export const usePopover = () => {
  const c = useContext(PopoverCtx); if (!c) throw new Error('usePopover must be inside <Popover>'); return c
}

/** Anchored panel. Closes on outside click and Escape; springs in from its trigger. Controlled (`open`) or uncontrolled (`defaultOpen`). */
export function Popover({ open: o, defaultOpen = false, onOpenChange, children, className }:
  { open?: boolean; defaultOpen?: boolean; onOpenChange?: (v: boolean) => void; children: ReactNode; className?: string }) {
  const [open, setOpen] = useControllable(o, defaultOpen, onOpenChange)
  const wrap = useRef<HTMLDivElement>(null), triggerRef = useRef<HTMLButtonElement>(null), id = useId()
  useOutside([wrap], () => setOpen(false), open)
  return (
    <PopoverCtx.Provider value={{ open, setOpen, triggerRef, id }}>
      <div ref={wrap} className={cn('relative inline-block', className)}
        onKeyDown={e => { if (e.key === 'Escape' && open) { e.stopPropagation(); setOpen(false); triggerRef.current?.focus() } }}>
        {children}
      </div>
    </PopoverCtx.Provider>
  )
}

/** Trigger button. Takes all Button props. */
export function PopoverTrigger({ children, onClick, ...p }: ButtonProps) {
  const { open, setOpen, triggerRef, id } = usePopover()
  return (
    <Button ref={triggerRef} aria-expanded={open} aria-haspopup="dialog" aria-controls={id}
      onClick={e => { setOpen(!open); onClick?.(e) }} {...p}>{children}</Button>
  )
}

const SIDE = {
  'bottom-start': 'top-[calc(100%+6px)] left-0 origin-top-left', 'bottom-end': 'top-[calc(100%+6px)] right-0 origin-top-right',
  'bottom-center': 'top-[calc(100%+6px)] left-1/2 -translate-x-1/2 origin-top', 'top-start': 'bottom-[calc(100%+8px)] left-0 origin-bottom-left',
  'top-center': 'bottom-[calc(100%+8px)] left-1/2 -translate-x-1/2 origin-bottom', 'top-end': 'bottom-[calc(100%+8px)] right-0 origin-bottom-right',
  right: 'left-[calc(100%+8px)] top-1/2 -translate-y-1/2 origin-left', left: 'right-[calc(100%+8px)] top-1/2 -translate-y-1/2 origin-right',
} as const
export type Placement = keyof typeof SIDE
const FLIP_SIDE: Partial<Record<Placement, Placement>> = {
  'bottom-start': 'top-start', 'bottom-end': 'top-end', 'bottom-center': 'top-center', 'top-start': 'bottom-start', 'top-end': 'bottom-end', 'top-center': 'bottom-center',
}

/**
 * Absolutely positioned panel next to its (relative) parent. Flips to the other side when it would
 * run off the bottom (or top) of the viewport and there is more room there (`flip={false}` pins it), and
 * slides sideways to stay 8px inside the screen edges on narrow (phone) viewports. Never wider than the screen.
 * The side is chosen once, when it opens, and stays locked while it is open, so content that shrinks or grows (a
 * filtered list) never makes it jump to the other side. `flip="scroll"` never flips: when the panel doesn't fit on its
 * side the page scrolls just enough to show it (for type-to-filter lists, whose height changes as you type: above the
 * field they would shrink from the top and cover the label).
 */
export function FloatingPanel({ open, placement = 'bottom-start', flip = true, matchWidth, className, children, role = 'dialog', id, ...p }:
  { open: boolean; placement?: Placement; flip?: boolean | 'scroll'; matchWidth?: boolean; className?: string; children: ReactNode; role?: string; id?: string } & Omit<HTMLAttributes<HTMLDivElement>, 'onAnimationStart' | 'onDrag' | 'onDragStart' | 'onDragEnd'>) {
  const [side, setSide] = useState<Placement>(placement)
  const [shift, setShift] = useState(0)
  const ref = useRef<HTMLDivElement>(null), shiftRef = useRef(0)
  useLayoutEffect(() => { // horizontal clamp: keep the panel inside the viewport
    if (!open) { shiftRef.current = 0; setShift(0); return }
    const el = ref.current, inner = el?.firstElementChild as HTMLElement | null
    if (!el || !inner || getComputedStyle(inner).position === 'fixed') return
    const left = el.getBoundingClientRect().left - shiftRef.current, right = left + inner.offsetWidth
    let dx = right > innerWidth - 8 ? innerWidth - 8 - right : 0
    if (left + dx < 8) dx = 8 - left
    shiftRef.current = dx; setShift(dx)
  }, [open, side])
  useLayoutEffect(() => {
    if (!open) return
    const el = ref.current, alt = FLIP_SIDE[placement]
    if (!el || !flip || !alt) { setSide(placement); return }
    const anchor = ((el.offsetParent as HTMLElement | null) ?? el.parentElement)?.getBoundingClientRect()
    if (!anchor) return
    const h = el.offsetHeight, below = innerHeight - anchor.bottom - 8, above = anchor.top - 8
    const wantsUp = placement.startsWith('top'), fitsDown = h + 6 <= below, fitsUp = h + 8 <= above
    // flip only to a side where it fits; when it fits neither (tall panel, short phone screen) open downward and
    // scroll the page so the panel is in view, instead of hanging off the top of the screen
    const flipIt = flip !== 'scroll' && (wantsUp ? !fitsUp && (fitsDown || below > above) : !fitsDown && fitsUp)
    setSide(flipIt ? alt : placement)
    if (flip === 'scroll' ? !(wantsUp ? fitsUp : fitsDown) : !fitsDown && !fitsUp) {
      const r = requestAnimationFrame(() => el.scrollIntoView({ block: 'nearest', behavior: prefersReducedMotion() ? 'auto' : 'smooth' }))
      return () => cancelAnimationFrame(r)
    }
  }, [open, placement, flip])
  const up = side.startsWith('top')
  return (
    <AnimatePresence>
      {open && (
        <div ref={ref} className={cn('absolute z-50', SIDE[side], matchWidth && 'w-full')} style={shift ? { marginLeft: shift } : undefined}>
          <motion.div id={id} role={role} initial={{ opacity: 0, y: up ? 4 : -4, scale: 0.97 }} animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, scale: 0.97, transition: { duration: 0.12 } }} transition={spring(0.25, 0.3)}
            className={cn(floatingSurface, 'max-w-[calc(100vw-16px)] min-w-[min(180px,calc(100vw-16px))] p-1', className)} {...p}>
            {children}
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  )
}

/**
 * The panel of a Popover. On open it moves focus inside: to an element marked `data-autofocus`, else the first
 * focusable one, else the panel itself (unless a child already took focus, e.g. a Calendar's selected day).
 * On close it hands focus back to the trigger when focus was inside the panel (or nowhere).
 */
export function PopoverContent({ placement, className, children, role }:
  { placement?: Placement; className?: string; children: ReactNode; role?: string }) {
  const { open, id, triggerRef } = usePopover()
  const wasOpen = useRef(false)
  useEffect(() => {
    const panel = document.getElementById(id)
    if (open) {
      wasOpen.current = true
      if (!panel || panel.contains(document.activeElement)) return
      const target = panel.querySelector<HTMLElement>('[data-autofocus]') ?? panel.querySelector<HTMLElement>(FOCUSABLE) ?? panel
      target.focus({ preventScroll: true })
      return
    }
    if (!wasOpen.current) return
    wasOpen.current = false
    const a = document.activeElement
    if (!a || a === document.body || panel?.contains(a)) triggerRef.current?.focus({ preventScroll: true })
  }, [open]) // eslint-disable-line react-hooks/exhaustive-deps
  return <FloatingPanel open={open} id={id} placement={placement} role={role} tabIndex={-1} className={cn('outline-none', className)}>{children}</FloatingPanel>
}

/* Menus ───────────────────────────────────────────────────────────────────── */

/** Variants for a menu's item list: items slide in one after another. */
export const menuListVariants: Variants = { hidden: {}, show: { transition: { staggerChildren: 0.03 } } }
const menuItemVariants: Variants = { hidden: { opacity: 0, x: -6 }, show: { opacity: 1, x: 0, transition: { duration: 0.2 } } }

/** One row in a DropdownMenu. Not a Tab stop (arrows move between rows); closes the menu and returns focus to the trigger when chosen. */
export function MenuItem({ children, shortcut, icon, danger, disabled, onSelect, className }:
  { children: ReactNode; shortcut?: string; icon?: IconName; danger?: boolean; disabled?: boolean; onSelect?: () => void; className?: string }) {
  const pop = useContext(PopoverCtx)
  return (
    <motion.button type="button" variants={menuItemVariants} role="menuitem" tabIndex={-1} disabled={disabled}
      className={cn(menuItemClass, danger && 'text-[var(--bad)]', disabled && 'cursor-default opacity-50', className)}
      onClick={() => { onSelect?.(); pop?.setOpen(false); pop?.triggerRef.current?.focus() }}>
      <span className="flex items-center gap-2">{icon && <Icon name={icon} size={15} className={danger ? '' : 'text-[var(--fg3)]'} />}{children}</span>
      {shortcut && <Kbd>{shortcut}</Kbd>}
    </motion.button>
  )
}
/** Thin rule between groups of menu rows. */
export const MenuSeparator = ({ className }: { className?: string }) => <div role="separator" className={cn('mx-1 my-1 h-px bg-[var(--line)]', className)} />
/** Small grey heading over a group of rows in a menu, listbox or palette. */
export const MenuLabel = ({ children, id, className }: { children: ReactNode; id?: string; className?: string }) =>
  <div id={id} role="presentation" className={cn('px-2 pt-2 pb-1 text-[11px] text-[var(--fg3)]', className)}>{children}</div>

/** Arrow keys, Home and End move between menu items. */
function menuKeys(e: RKeyboardEvent<HTMLDivElement>) {
  const items = [...e.currentTarget.querySelectorAll<HTMLElement>('[role=menuitem]:not([disabled])')]
  const i = items.indexOf(document.activeElement as HTMLElement)
  const go = (n: number) => { e.preventDefault(); items[(n + items.length) % items.length]?.focus() }
  if (e.key === 'ArrowDown') go(i + 1)
  else if (e.key === 'ArrowUp') go(i < 0 ? -1 : i - 1)
  else if (e.key === 'Home') go(0)
  else if (e.key === 'End') go(-1)
}

/** The item list inside a DropdownMenu: arrow keys move, Tab or focus leaving the menu closes it. */
function DropdownList({ children }: { children: ReactNode }) {
  const { setOpen, triggerRef } = usePopover()
  return (
    <motion.div initial="hidden" animate="show" variants={menuListVariants}
      onKeyDown={e => { if (e.key === 'Tab') setOpen(false); else menuKeys(e) }}
      onBlur={e => { const to = e.relatedTarget as Node | null; if (to && !e.currentTarget.contains(to) && !triggerRef.current?.contains(to)) setOpen(false) }}>
      {children}
    </motion.div>
  )
}

/**
 * <DropdownMenu trigger="Options"><MenuItem shortcut="E">Edit</MenuItem>…</DropdownMenu>
 * Opens with click, Enter or ↓; the first item takes focus and the rest stagger in. Tab or moving focus away closes it.
 */
export function DropdownMenu({ trigger, children, placement, variant, size, className }:
  { trigger: ReactNode; children: ReactNode; placement?: Placement; className?: string } & Pick<ButtonProps, 'variant' | 'size'>) {
  const [open, setOpen] = useState(false)
  const id = useId()
  useEffect(() => {
    if (!open) return
    const r = requestAnimationFrame(() => document.getElementById(id)?.querySelector<HTMLElement>('[role=menuitem]:not([disabled])')?.focus({ preventScroll: true }))
    return () => cancelAnimationFrame(r)
  }, [open, id])
  return (
    <Popover open={open} onOpenChange={setOpen} className={className}>
      <PopoverTrigger variant={variant} size={size} aria-haspopup="menu" onKeyDown={e => { if (e.key === 'ArrowDown' && !open) { e.preventDefault(); setOpen(true) } }}>{trigger}</PopoverTrigger>
      <PopoverContent placement={placement} role="menu">
        <div id={id} className="contents"><DropdownList>{children}</DropdownList></div>
      </PopoverContent>
    </Popover>
  )
}

/* Context menu ─────────────────────────────────────────────────────────────── */

export type ContextMenuEntry =
  | { label: string; icon?: IconName; shortcut?: string; danger?: boolean; onSelect?: () => void; items?: ContextMenuEntry[] }
  | '-'
type CtxAction = Exclude<ContextMenuEntry, '-'>
type CtxAt = { x: number; y: number; altX?: number }

/** Keep a fixed panel inside the viewport; `altX` is where it goes (right edge) if it has to flip left. */
function ctxClamp(el: HTMLElement, at: CtxAt) {
  const w = el.offsetWidth, h = el.offsetHeight
  let left = at.x, flipped = false
  if (left + w > innerWidth - 8) { left = at.altX !== undefined ? at.altX - w : innerWidth - w - 8; flipped = at.altX !== undefined }
  return { left: Math.max(8, left), top: Math.max(8, Math.min(at.y, innerHeight - h - 8)), flipped }
}

const ctxPanelVariants: Variants = {
  hidden: { opacity: 0, scale: 0.94 },
  show: { opacity: 1, scale: 1, transition: { ...spring(0.25, 0.25), staggerChildren: 0.025 } },
}

function ContextMenuPanel({ entries, at, active, panelRef, label, onHover, onPick, onKey, openSub }:
  { entries: ContextMenuEntry[]; at: CtxAt; active: number; panelRef: RefObject<HTMLDivElement | null>; label?: string; openSub?: number
    onHover: (i: number) => void; onPick: (i: number) => void; onKey: (e: RKeyboardEvent<HTMLDivElement>) => void }) {
  const [place, setPlace] = useState<{ left: number; top: number; flipped: boolean } | null>(null)
  useLayoutEffect(() => { if (panelRef.current) setPlace(ctxClamp(panelRef.current, at)) }, [at.x, at.y, at.altX]) // eslint-disable-line react-hooks/exhaustive-deps
  let k = -1
  return (
    <motion.div ref={panelRef} role="menu" aria-label={label} variants={ctxPanelVariants} initial="hidden" animate="show"
      exit={{ opacity: 0, scale: 0.97, transition: { duration: 0.1 } }}
      style={{ left: place?.left ?? at.x, top: place?.top ?? at.y, visibility: place ? 'visible' : 'hidden' }}
      className={cn(floatingSurface, 'fixed z-[85] min-w-[200px] p-1', place?.flipped ? 'origin-top-right' : 'origin-top-left')}
      onKeyDown={onKey} onContextMenu={e => { e.preventDefault(); e.stopPropagation() }}>
      {entries.map((it, j) => {
        if (it === '-') return <MenuSeparator key={`sep${j}`} />
        const i = ++k
        return (
          <motion.button key={it.label} variants={menuItemVariants} role="menuitem" tabIndex={i === active ? 0 : -1} data-active={i === active}
            aria-haspopup={it.items ? 'menu' : undefined} aria-expanded={it.items ? openSub === i : undefined}
            className={cn(menuItemClass, it.danger && 'text-[var(--bad)]')}
            onPointerEnter={() => onHover(i)} onClick={() => onPick(i)}>
            <span className="flex items-center gap-2">{it.icon && <Icon name={it.icon} size={15} className={it.danger ? '' : 'text-[var(--fg3)]'} />}{it.label}</span>
            {it.items ? <Icon name="chevronRight" size={13} className="text-[var(--fg3)]" />
              : it.shortcut && <span className="font-[family-name:var(--mono)] text-[11px] text-[var(--fg3)]">{it.shortcut}</span>}
          </motion.button>
        )
      })}
    </motion.div>
  )
}

/**
 * Right-click, long-press (touch) or press the Menu key / Shift+F10 on the focused area to open a menu
 * at that point. Items can have one level of submenu (→ opens, ← closes). The menu stays inside the
 * viewport, focuses its first item, and closes on Escape, outside click, scroll or resize.
 * `children` may be a function of `open` so the target can highlight itself.
 */
export function ContextMenu({ items, children, className, label = 'Options', onOpenChange }:
  { items: ContextMenuEntry[]; children: ReactNode | ((open: boolean) => ReactNode); className?: string; label?: string; onOpenChange?: (open: boolean) => void }) {
  const [at, setAt] = useState<CtxAt | null>(null)
  const [act, setAct] = useState(0)
  const [sub, setSub] = useState<{ i: number; at: CtxAt } | null>(null)
  const [subAct, setSubAct] = useState(-1)
  const area = useRef<HTMLDivElement>(null), menu = useRef<HTMLDivElement>(null), subMenu = useRef<HTMLDivElement>(null)
  const actions = items.filter((e): e is CtxAction => e !== '-')
  const subActions = sub ? (actions[sub.i]?.items ?? []).filter((e): e is CtxAction => e !== '-') : []
  const open = !!at

  const notify = useRef(onOpenChange); notify.current = onOpenChange
  useEffect(() => { notify.current?.(open) }, [open])

  const openAt = (x: number, y: number) => { setSub(null); setSubAct(-1); setAct(0); setAt({ x, y }) }
  const close = useCallback((refocus = false) => {
    setAt(null); setSub(null); setSubAct(-1)
    if (refocus) area.current?.focus({ preventScroll: true })
  }, [])

  useOutside([menu, subMenu], () => close(), open)
  useEffect(() => {
    if (!open) return
    const off = () => close()
    addEventListener('scroll', off, { capture: true, passive: true }); addEventListener('resize', off)
    return () => { removeEventListener('scroll', off, { capture: true }); removeEventListener('resize', off) }
  }, [open, close])
  // focus follows the active row (main menu, or the submenu once it has been entered)
  useEffect(() => {
    if (!open) return
    const r = requestAnimationFrame(() => {
      const panel = subAct >= 0 ? subMenu.current : menu.current
      panel?.querySelectorAll<HTMLElement>('[role=menuitem]')[subAct >= 0 ? subAct : act]?.focus({ preventScroll: true })
    })
    return () => cancelAnimationFrame(r)
  }, [open, act, subAct, sub])

  const showSub = (i: number, focus: boolean) => {
    const btn = menu.current?.querySelectorAll<HTMLElement>('[role=menuitem]')[i]
    if (!btn || !actions[i]?.items) { setSub(null); setSubAct(-1); return }
    const r = btn.getBoundingClientRect()
    setSub({ i, at: { x: r.right + 4, y: r.top - 5, altX: r.left - 4 } }); setSubAct(focus ? 0 : -1)
  }
  const pick = (entry: CtxAction | undefined, i: number, level: 0 | 1) => {
    if (!entry) return
    if (entry.items && level === 0) { setAct(i); showSub(i, true); return }
    close(true); entry.onSelect?.()
  }
  const onKey = (e: RKeyboardEvent<HTMLDivElement>) => {
    e.stopPropagation()
    const inSub = subAct >= 0, list = inSub ? subActions : actions, cur = inSub ? subAct : act, set = inSub ? setSubAct : setAct
    const move = (n: number) => { e.preventDefault(); set((n + list.length) % list.length); if (!inSub) { setSub(null) } }
    if (e.key === 'ArrowDown') move(cur + 1)
    else if (e.key === 'ArrowUp') move(cur - 1)
    else if (e.key === 'Home') move(0)
    else if (e.key === 'End') move(list.length - 1)
    else if (e.key === 'ArrowRight' && !inSub && actions[act]?.items) { e.preventDefault(); showSub(act, true) }
    else if (e.key === 'ArrowLeft' && inSub) { e.preventDefault(); setSub(null); setSubAct(-1) }
    else if (e.key === 'Escape') { e.preventDefault(); close(true) }
    else if (e.key === 'Tab') { e.preventDefault(); close(true) }
    else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick(list[cur], cur, inSub ? 1 : 0) }
  }
  const inArea = (t: EventTarget) => !!area.current?.contains(t as Node)
  // touch: long-press opens the menu just under the finger (the menu's own events bubble here through the portal, hence inArea)
  const hold = useLongPress({ onPress: ({ x, y }) => { navigator.vibrate?.(10); openAt(x, y + 10) } })
  const fromArea = <E extends { target: EventTarget }>(fn: (e: E) => void) => (e: E) => { if (inArea(e.target)) fn(e) }

  return (
    // a named group (not a button: the area holds arbitrary content); aria-keyshortcuts tells screen readers how to open it
    <div ref={area} tabIndex={0} role="group" aria-label={label} aria-keyshortcuts="Shift+F10 ContextMenu" data-state={open ? 'open' : 'closed'}
      className={cn('relative select-none outline-none [-webkit-touch-callout:none] focus-visible:ring-2 focus-visible:ring-[var(--accent)]', className)}
      onContextMenu={e => { if (!inArea(e.target)) return; e.preventDefault(); hold.cancel(); openAt(e.clientX, e.clientY) }}
      onPointerDown={fromArea(hold.bind.onPointerDown)} onPointerMove={hold.bind.onPointerMove}
      onPointerUp={hold.bind.onPointerUp} onPointerCancel={hold.bind.onPointerCancel} onClickCapture={fromArea(hold.bind.onClickCapture)}
      onKeyDown={e => {
        if (!inArea(e.target) || open) return
        if (e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10')) {
          e.preventDefault(); const r = e.currentTarget.getBoundingClientRect(); openAt(r.left + r.width / 2, r.top + r.height / 2)
        }
      }}>
      {typeof children === 'function' ? children(open) : children}
      <OverlayPortal>
        <AnimatePresence>
          {at && <ContextMenuPanel key="main" entries={items} at={at} active={act} panelRef={menu} label={label} openSub={sub?.i} onKey={onKey}
            onHover={i => { setAct(i); setSubAct(-1); showSub(i, false) }} onPick={i => pick(actions[i], i, 0)} />}
          {at && sub && <ContextMenuPanel key={`sub${sub.i}`} entries={actions[sub.i]?.items ?? []} at={sub.at} active={subAct} panelRef={subMenu}
            label={actions[sub.i]?.label} onKey={onKey} onHover={setSubAct} onPick={i => pick(subActions[i], i, 1)} />}
        </AnimatePresence>
      </OverlayPortal>
    </div>
  )
}

/* Tooltip and hover card ───────────────────────────────────────────────────── */

/**
 * Open state for hover UI that also works by touch: mouse and pen hover (after `openDelay`, closing `closeDelay` ms after
 * leaving), keyboard focus, and a tap on the trigger (spread `tap`) toggles it. Spread `bind` on the wrapper. A tap anywhere
 * outside `ref` closes it; `touchHide` ms auto-hides a tapped one. Returns { open, setOpen, bind, tap }.
 */
export function useHoverIntent(ref: RefObject<HTMLElement | null>, openDelay = 300, closeDelay = 100, touchHide = 0) {
  const [open, setOpenState] = useState(false)
  const t = useRef<ReturnType<typeof setTimeout>>(undefined), tapAt = useRef(0), isOpen = useRef(false)
  const setOpen = useCallback((v: boolean) => { isOpen.current = v; setOpenState(v) }, [])
  const show = () => { clearTimeout(t.current); t.current = setTimeout(() => setOpen(true), openDelay) }
  const hide = () => { clearTimeout(t.current); t.current = setTimeout(() => setOpen(false), closeDelay) }
  useEffect(() => () => clearTimeout(t.current), [])
  useOutside([ref], () => { clearTimeout(t.current); setOpen(false) }, open)
  return {
    open, setOpen,
    bind: {
      onPointerEnter: (e: ReactPointerEvent) => { if (!isTouch(e)) show() },
      onPointerLeave: (e: ReactPointerEvent) => { if (!isTouch(e)) hide() },
      // a tap focuses the trigger right after pointerup: that focus is part of the tap, not a separate open
      onFocus: () => { if (Date.now() - tapAt.current > 800) show() },
      onBlur: hide,
    },
    tap: {
      onPointerUp: (e: ReactPointerEvent) => {
        if (!isTouch(e)) return
        tapAt.current = Date.now(); clearTimeout(t.current)
        const next = !isOpen.current; setOpen(next)
        if (next && touchHide) t.current = setTimeout(() => setOpen(false), touchHide)
      },
    },
  }
}

const tipClass = 'flex items-center gap-1.5 whitespace-nowrap rounded-[var(--r-md)] bg-[var(--primary)] px-2 py-1 text-xs text-[var(--on-primary)] shadow-[var(--shadow)]'
/** Where a portalled tooltip sits for each placement: anchor point plus a CSS translate. */
function tipFixed(r: DOMRect, p: Placement) {
  if (p === 'right') return { left: r.right + 8, top: r.top + r.height / 2, transform: 'translateY(-50%)' }
  if (p === 'left') return { left: r.left - 8, top: r.top + r.height / 2, transform: 'translate(-100%,-50%)' }
  if (p.startsWith('bottom')) return { left: r.left + r.width / 2, top: r.bottom + 6, transform: 'translateX(-50%)' }
  return { left: r.left + r.width / 2, top: r.top - 8, transform: 'translate(-50%,-100%)' }
}

/**
 * Short delay, quick fade. Wrap the element that should show it. Shows on hover or keyboard focus; on touch a tap
 * shows it (another tap, a tap elsewhere or 2.5 s hides it). `portal` renders it in a fixed layer
 * so it escapes `overflow: hidden` parents (collapsed sidebars, scroll areas); `disabled` turns it off.
 * The trigger (a single element child) gets `aria-describedby` while the tip shows, so screen readers announce it.
 */
export function Tooltip({ content, children, placement = 'top-center', delay = 400, portal, disabled, className }:
  { content: ReactNode; children: ReactNode; placement?: Placement; delay?: number; portal?: boolean; disabled?: boolean; className?: string }) {
  const ref = useRef<HTMLSpanElement>(null)
  const { open, setOpen, bind, tap } = useHoverIntent(ref, delay, 0, 2500)
  const id = useId()
  const [rect, setRect] = useState<DOMRect | null>(null)
  const shown = open && !disabled
  useLayoutEffect(() => { if (shown && portal && ref.current) setRect(ref.current.getBoundingClientRect()) }, [shown, portal])
  const x = placement === 'right' ? -4 : placement === 'left' ? 4 : 0, y = x ? 0 : placement.startsWith('bottom') ? -3 : 3
  const el = isValidElement(children) ? children as ReactElement<{ 'aria-describedby'?: string }> : null
  const own = el?.props['aria-describedby']
  const trigger = el ? cloneElement(el, { 'aria-describedby': shown ? cn(own, id) : own }) : children
  return (
    <span ref={ref} className={cn('relative inline-flex', className)} {...bind} {...tap} aria-describedby={!el && shown ? id : undefined}
      onKeyDown={e => { if (e.key === 'Escape' && shown) { e.stopPropagation(); setOpen(false) } }}>
      {trigger}
      {portal ? (
        <OverlayPortal>
          <AnimatePresence>
            {shown && rect && (
              <span className="pointer-events-none fixed z-[90]" style={tipFixed(rect, placement)}>
                <motion.span id={id} role="tooltip" initial={{ opacity: 0, x, y }} animate={{ opacity: 1, x: 0, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.12 }} className={tipClass}>
                  {content}
                </motion.span>
              </span>
            )}
          </AnimatePresence>
        </OverlayPortal>
      ) : (
        <AnimatePresence>
          {shown && (
            <span className={cn('pointer-events-none absolute z-50', SIDE[placement])}>
              <motion.span id={id} role="tooltip" initial={{ opacity: 0, x, y }} animate={{ opacity: 1, x: 0, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.12 }} className={tipClass}>
                {content}
              </motion.span>
            </span>
          )}
        </AnimatePresence>
      )}
    </span>
  )
}

/**
 * Rich preview on hover or focus (profiles, links, citations). Stays open while the pointer is over the card. On touch,
 * tapping the trigger toggles it and tapping outside closes it. With `pinOnClick`, a mouse click on the trigger pins the
 * card open (leaving no longer closes it) until another click, an outside click or Escape. The card slides to stay on screen.
 */
export function HoverCard({ trigger, children, placement = 'top-start', pinOnClick, className, triggerClassName }:
  { trigger: ReactNode; children: ReactNode; placement?: Placement; pinOnClick?: boolean; className?: string; triggerClassName?: string }) {
  const ref = useRef<HTMLSpanElement>(null)
  const { open, setOpen, bind, tap } = useHoverIntent(ref, 300, 150)
  const [pinned, setPinned] = useState(false)
  const lastPointer = useRef('mouse')
  const shown = open || pinned
  useOutside([ref], () => { setPinned(false); setOpen(false) }, pinned, { escape: true })
  return (
    <span ref={ref} className={cn('relative inline-block', triggerClassName)} {...bind} onKeyDown={e => { if (e.key === 'Escape' && shown) { e.stopPropagation(); setPinned(false); setOpen(false) } }}>
      <span className="contents" {...tap} onPointerDown={e => { lastPointer.current = e.pointerType }}
        onClick={() => { if (!pinOnClick || lastPointer.current === 'touch') return; const next = !pinned; setPinned(next); setOpen(next) }}>{trigger}</span>
      <FloatingPanel open={shown} placement={placement} role="tooltip" className={cn('w-[250px] p-3 text-[13px] leading-snug', className)}>{children}</FloatingPanel>
    </span>
  )
}

/** What PointerTooltip shows and where (client coordinates); null hides it. */
export type PointerTip = { x: number; y: number; content: ReactNode; touch?: boolean } | null

/**
 * Small tooltip that follows the pointer (portalled, fixed), for charts, maps and diagrams. Pass null to hide; it fades out.
 * It sits beside the pointer (higher above a finger) and is clamped to the viewport, so it never runs off a phone screen.
 */
export function PointerTooltip({ tip, className }: { tip: PointerTip; className?: string }) {
  const last = useRef<PointerTip>(null)
  const el = useRef<HTMLDivElement>(null)
  const [box, setBox] = useState({ w: 160, h: 36 })
  if (tip) last.current = tip
  const t = tip ?? last.current
  useLayoutEffect(() => { const n = el.current; if (n && (Math.abs(n.offsetWidth - box.w) > 1 || Math.abs(n.offsetHeight - box.h) > 1)) setBox({ w: n.offsetWidth, h: n.offsetHeight }) })
  if (typeof document === 'undefined' || !t) return null
  const vw = document.documentElement.clientWidth, right = t.x + 14 + box.w <= vw - 8
  const left = Math.max(8, Math.min(vw - box.w - 8, right ? t.x + 14 : t.x - 14 - box.w))
  const top = Math.max(8, t.y - (t.touch ? box.h + 30 : 44))
  return createPortal(
    <div ref={el} role="tooltip" className={cn(floatingSurface, 'pointer-events-none fixed z-[90] w-max max-w-[calc(100vw-16px)] rounded-[var(--r-md)] px-2 py-1.5 text-xs leading-snug text-[var(--fg)] transition-opacity duration-150', className)}
      style={{ left, top, opacity: tip ? 1 : 0, fontFamily: 'var(--font)' }}>{t.content}</div>,
    document.body,
  )
}
/**
 * State for PointerTooltip: { tip, show(event, content), hide() }. A shown tip hides on the next pointerdown anywhere
 * (a tap elsewhere replaces it in the same event) and when the page scrolls, so tapped tooltips never go stale.
 */
export function usePointerTooltip() {
  const [tip, setTip] = useState<PointerTip>(null)
  const on = !!tip
  useEffect(() => {
    if (!on) return
    const off = () => setTip(null)
    document.addEventListener('pointerdown', off, true); addEventListener('scroll', off, { capture: true, passive: true })
    return () => { document.removeEventListener('pointerdown', off, true); removeEventListener('scroll', off, { capture: true }) }
  }, [on])
  return {
    tip,
    show: (e: { clientX: number; clientY: number; pointerType?: string }, content: ReactNode) => setTip({ x: e.clientX, y: e.clientY, content, touch: e.pointerType === 'touch' }),
    hide: () => setTip(null),
  }
}

/* Modal layer: Dialog, Sheet and CommandPalette are all a panel inside one ModalLayer ─────── */

/** Renders into the themed `.ui-root` (or body) so fixed layers escape clipping parents. */
export function OverlayPortal({ children }: { children: ReactNode }) {
  const [el, setEl] = useState<Element | null>(null)
  useEffect(() => setEl(document.querySelector('.ui-root') ?? document.body), [])
  return el ? createPortal(children, el) : null
}

let overlayLocks = 0
/** Stop the page from scrolling while `active` (modals, lightboxes, full-screen sheets). Every caller shares one counter, so nested locks unwind correctly. */
export function useScrollLock(active: boolean) {
  useEffect(() => {
    if (!active) return
    const root = document.documentElement, body = document.body
    if (overlayLocks++ === 0) {
      const gap = innerWidth - root.clientWidth
      root.style.overflow = 'hidden'
      if (gap > 0) body.style.paddingRight = `${gap}px`
    }
    return () => { if (--overlayLocks === 0) { root.style.overflow = ''; body.style.paddingRight = '' } }
  }, [active])
}

/** Open modal layers, innermost last. Only the top one handles Escape and keeps the rest of the page inert. */
const overlayModals: HTMLElement[] = []
let overlayInerted: HTMLElement[] = []
/**
 * Make everything outside the top modal `inert` (not focusable, clickable or read by screen readers): every sibling of
 * the modal and of each of its ancestors up to <body>. Elements that were already inert are left alone, and so is
 * anything marked `data-modal-keep` (the toast region). Called whenever the stack changes, so nesting unwinds.
 */
function overlaySyncInert() {
  for (const el of overlayInerted) el.inert = false
  overlayInerted = []
  const top = overlayModals[overlayModals.length - 1]
  for (let node: Element | null = top ?? null; node && node.parentElement && node !== document.body; node = node.parentElement) {
    for (const sib of node.parentElement.children) {
      if (sib === node || !(sib instanceof HTMLElement) || sib.inert || sib.matches('script,style,link,template,[data-modal-keep]')) continue
      sib.inert = true; overlayInerted.push(sib)
    }
  }
}

/**
 * Everything a modal needs except the panel itself: portal, fading backdrop, focus trap, body scroll lock,
 * Escape and outside click to close, and exit animations for whatever you render inside. While open the rest of
 * the page is `inert`, and Escape and Tab are handled at document level, so they work even when focus is outside the
 * panel. Nested modals stack: only the top one closes on Escape, and closing it hands the page back to the one below.
 */
export function ModalLayer({ open, onClose, children }: { open: boolean; onClose: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null)
  const close = useRef(onClose); close.current = onClose
  useFocusTrap(ref, open)
  useScrollLock(open)
  useEffect(() => {
    if (!open) return
    let el: HTMLElement | null = null, raf = 0
    const attach = () => { // the portal target is found in an effect, so the layer may mount a frame later
      el = ref.current
      if (!el) { raf = requestAnimationFrame(attach); return }
      overlayModals.push(el); overlaySyncInert()
    }
    attach()
    const key = (e: KeyboardEvent) => { // Escape with focus outside the panel (React's onKeyDown covers focus inside)
      if (e.key !== 'Escape' || e.defaultPrevented || !el || overlayModals[overlayModals.length - 1] !== el) return
      if (e.target instanceof Node && el.contains(e.target)) return
      e.preventDefault(); close.current()
    }
    document.addEventListener('keydown', key)
    return () => {
      cancelAnimationFrame(raf); document.removeEventListener('keydown', key)
      const i = el ? overlayModals.lastIndexOf(el) : -1
      if (i >= 0) { overlayModals.splice(i, 1); overlaySyncInert() }
    }
  }, [open])
  return (
    <OverlayPortal>
      <AnimatePresence>
        {open && (
          <div ref={ref} className="contents" onKeyDown={e => { if (e.key === 'Escape' && !e.defaultPrevented) { e.stopPropagation(); onClose() } }}>
            <motion.div className="fixed inset-0 z-[70] bg-black/40" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }} onClick={onClose} aria-hidden />
            {children}
          </div>
        )}
      </AnimatePresence>
    </OverlayPortal>
  )
}

type ModalProps = { open: boolean; onOpenChange: (v: boolean) => void }

/** Modal dialog. Springs in, backdrop fades, focus is trapped, Escape closes. Fits small screens: keeps clear of the safe
 * areas, scrolls inside when taller than the screen, and the footer wraps. */
export function Dialog({ open, onOpenChange, title, description, children, footer, className }:
  ModalProps & { title: ReactNode; description?: ReactNode; children?: ReactNode; footer?: ReactNode; className?: string }) {
  const id = useId()
  return (
    <ModalLayer open={open} onClose={() => onOpenChange(false)}>
      <div className="pointer-events-none fixed inset-0 z-[71] grid place-items-center px-[max(16px,env(safe-area-inset-left),env(safe-area-inset-right))] pt-[max(16px,env(safe-area-inset-top))] pb-[max(16px,env(safe-area-inset-bottom))]">
        <motion.div role="dialog" aria-modal="true" aria-labelledby={id}
          initial={{ opacity: 0, scale: 0.94, y: 8 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.96, transition: { duration: 0.15 } }}
          transition={spring(0.3, 0.4)} className={cn('pointer-events-auto max-h-full w-full max-w-[420px] overflow-auto overscroll-contain rounded-[var(--r-lg)] border border-[var(--line)] bg-[var(--card)] p-5 shadow-[var(--shadow)]', className)}>
          <h2 id={id} className="m-0 mb-1.5 text-base font-semibold">{title}</h2>
          {description && <p className="m-0 mb-4 text-[13px] text-[var(--fg2)]">{description}</p>}
          {children}
          {footer && <div className="mt-4 flex flex-wrap justify-end gap-2">{footer}</div>}
        </motion.div>
      </div>
    </ModalLayer>
  )
}

const SHEET = {
  right: { cls: 'top-0 right-0 bottom-0 w-[min(380px,92vw)] pt-[max(20px,env(safe-area-inset-top))] pb-[max(20px,env(safe-area-inset-bottom))]', off: { x: '100%' } },
  left: { cls: 'top-0 left-0 bottom-0 w-[min(380px,92vw)] pt-[max(20px,env(safe-area-inset-top))] pb-[max(20px,env(safe-area-inset-bottom))]', off: { x: '-100%' } },
  bottom: { cls: 'left-0 right-0 bottom-0 max-h-[85dvh] rounded-t-[var(--r-lg)] !pt-2 pb-[max(20px,env(safe-area-inset-bottom))]', off: { y: '100%' } },
}
/** Below this width a left or right Sheet opens as a bottom sheet instead. */
const SHEET_BOTTOM_BELOW = 640

/**
 * Panel that slides in from an edge. On screens narrower than 640px a `left`/`right` sheet becomes a bottom sheet
 * (pass `responsive={false}` to keep the edge drawer, e.g. for app navigation). A bottom sheet has a grab handle:
 * drag it (or the header) down to dismiss. Keeps clear of the safe areas.
 */
export function Sheet({ open, onOpenChange, title, side = 'right', responsive = true, children, footer, className }:
  ModalProps & { title: ReactNode; side?: keyof typeof SHEET; responsive?: boolean; children: ReactNode; footer?: ReactNode; className?: string }) {
  const narrow = useMediaQuery(`(max-width: ${SHEET_BOTTOM_BELOW - 1}px)`)
  const edge = responsive && narrow ? 'bottom' : side
  const { cls, off } = SHEET[edge]
  const drag = useDragControls()
  const bottom = edge === 'bottom'
  const grab = bottom ? { onPointerDown: (e: ReactPointerEvent) => drag.start(e), className: 'touch-none' } : null
  return (
    <ModalLayer open={open} onClose={() => onOpenChange(false)}>
      <motion.div key={edge} role="dialog" aria-modal="true" aria-label={typeof title === 'string' ? title : undefined}
        initial={off} animate={{ x: 0, y: 0 }} exit={off} transition={spring(0.15, 0.4)}
        drag={bottom ? 'y' : false} dragListener={false} dragControls={drag} dragConstraints={{ top: 0, bottom: 0 }} dragElastic={{ top: 0, bottom: 0.9 }}
        onDragEnd={(_, i) => { if (i.offset.y > 90 || i.velocity.y > 500) onOpenChange(false) }}
        className={cn('fixed z-[71] flex flex-col gap-3 overflow-auto overscroll-contain bg-[var(--card)] px-5 shadow-[var(--shadow)]', cls, className)}>
        {grab && <div aria-hidden {...grab} className="-mx-5 -mb-2 flex flex-none cursor-grab justify-center pt-1 pb-2 touch-none"><span className="h-1 w-9 rounded-full bg-[var(--line2)]" /></div>}
        <div className={cn('flex flex-none items-center justify-between', grab?.className)} onPointerDown={grab?.onPointerDown}>
          <h2 className="m-0 text-base font-semibold">{title}</h2>
          <IconButton icon="x" label="Close" onClick={() => onOpenChange(false)} onPointerDown={e => e.stopPropagation()} />
        </div>
        <div className="flex-1">{children}</div>
        {footer && <div className="flex flex-none flex-wrap justify-end gap-2">{footer}</div>}
      </motion.div>
    </ModalLayer>
  )
}

/* Command palette ──────────────────────────────────────────────────────────── */

/**
 * A palette entry. `keywords` are extra search terms (content tags, synonyms); `hint` is a short
 * secondary label shown after the name (and searched too).
 */
export type Command = { id: string; label: string; group?: string; icon?: IconName; shortcut?: string; keywords?: string[] | string; hint?: string; run: () => void }

const cmdkWords = (k: Command['keywords']) => (Array.isArray(k) ? k : k ? k.split(/\s*[|,]\s*/) : []).filter(Boolean)
type CmdkHit = { c: Command; labelHit: boolean; tags: string[] }
/** Every query word must appear in the label, a keyword or the hint (AND). Label matches rank first. */
function cmdkFilter(commands: Command[], q: string): CmdkHit[] {
  const query = q.toLowerCase().trim(), words = query.split(/\s+/).filter(Boolean)
  if (!words.length) return commands.map(c => ({ c, labelHit: false, tags: [] }))
  const hits: CmdkHit[] = []
  for (const c of commands) {
    const kws = cmdkWords(c.keywords), label = c.label.toLowerCase()
    const hay = [label, ...kws.map(k => k.toLowerCase()), (c.hint ?? '').toLowerCase()].join(' \u0000 ')
    if (!words.every(w => hay.includes(w))) continue
    const missing = words.filter(w => !label.includes(w))
    const tags = missing.length ? kws.filter(k => missing.some(w => k.toLowerCase().includes(w))).slice(0, 2) : []
    hits.push({ c, labelHit: label.includes(query), tags })
  }
  const ranked = hits.map((h, i) => ({ h, i })).sort((a, b) => Number(b.h.labelHit) - Number(a.h.labelHit) || a.i - b.i).map(x => x.h)
  // keep groups together, ordered by their best-ranked entry
  const order: string[] = []
  for (const h of ranked) { const g = h.c.group ?? ''; if (!order.includes(g)) order.push(g) }
  return order.flatMap(g => ranked.filter(h => (h.c.group ?? '') === g))
}
/** Bold the parts of `text` that match any query word. */
function cmdkMark(text: string, words: string[]) {
  if (!words.length) return text
  const re = new RegExp(`(${words.map(w => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})`, 'ig')
  return text.split(re).map((part, i) => i % 2 ? <b key={i} className="font-semibold text-[var(--fg)]">{part}</b> : part)
}

/**
 * ⌘K palette: type to filter (every word must match the label, keywords or hint), arrows to move,
 * Enter to run. Shows which keyword matched, marks the active row with ↵, and suggests a query when
 * nothing matches.
 */
export function CommandPalette({ open, onOpenChange, commands, placeholder = 'Type a command or search…', suggestion, className }:
  ModalProps & { commands: Command[]; placeholder?: string; suggestion?: string; className?: string }) {
  const [q, setQ] = useState('')
  const uid = useId()
  useEffect(() => { if (open) setQ('') }, [open])
  const list = cmdkFilter(commands, q)
  const words = q.toLowerCase().trim().split(/\s+/).filter(Boolean)
  const run = (i: number) => { const c = list[i]?.c; if (!c) return; onOpenChange(false); setTimeout(() => c.run(), 160) }
  const { active, setActive, onKeyDown } = useRoving(list.length, run, { homeEnd: false })
  useEffect(() => setActive(0), [q, setActive])
  const listRef = useRef<HTMLDivElement>(null)
  useEffect(() => { listRef.current?.querySelector(`[data-i="${active}"]`)?.scrollIntoView({ block: 'nearest' }) }, [active])
  const suggest = suggestion ?? (cmdkWords(commands.find(c => cmdkWords(c.keywords).length)?.keywords)[0] ?? commands[0]?.label.split(' ')[0] ?? '').toLowerCase()
  return (
    <ModalLayer open={open} onClose={() => onOpenChange(false)}>
      <motion.div role="dialog" aria-modal="true" aria-label="Command palette"
        initial={{ opacity: 0, scale: 0.96, y: -8 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.98, transition: { duration: 0.12 } }}
        transition={spring(0.25, 0.35)} className={cn(floatingSurface, 'fixed top-[14vh] left-1/2 z-[72] w-[min(540px,calc(100%-32px))] -translate-x-1/2 overflow-hidden max-[640px]:top-[max(12px,env(safe-area-inset-top))] [@media(max-height:500px)]:top-[max(8px,env(safe-area-inset-top))]', className)}>
        <div className="flex items-center gap-2 border-b border-[var(--line)] px-4">
          <Icon name="search" className="text-[var(--fg3)]" />
          <input data-autofocus value={q} onChange={e => setQ(e.target.value)} onKeyDown={onKeyDown} placeholder={placeholder}
            role="combobox" aria-expanded="true" aria-controls={`${uid}-list`} aria-activedescendant={list[active] ? `${uid}-${list[active].c.id}` : undefined}
            className="w-full border-0 bg-transparent py-3 text-base outline-none" />
        </div>
        <div ref={listRef} id={`${uid}-list`} role="listbox" className="max-h-[min(340px,50vh)] overflow-auto overscroll-contain p-1.5 max-[640px]:max-h-[min(420px,60dvh)]">
          {list.length === 0 && (
            <div className="p-6 text-center text-[13px] text-[var(--fg3)]">
              Nothing matches “{q}”.{suggest && <> Try <button className="cursor-pointer border-0 bg-transparent p-0 font-medium text-[var(--accent)] underline-offset-2 hover:underline" onClick={() => setQ(suggest)}>“{suggest}”</button>.</>}
            </div>
          )}
          {list.map(({ c, tags }, i) => (
            <div key={c.id}>
              {c.group && c.group !== list[i - 1]?.c.group && <MenuLabel>{c.group}</MenuLabel>}
              <button id={`${uid}-${c.id}`} data-i={i} role="option" aria-selected={i === active} tabIndex={-1} onPointerMove={() => setActive(i)} onClick={() => run(i)}
                className={cn(menuItemClass, 'relative', words.length ? 'text-[var(--fg2)]' : '')}>
                {i === active && <motion.span layoutId={`${uid}-active`} className="absolute inset-0 rounded-[var(--r-md)] bg-[var(--muted)]" transition={spring(0.15, 0.25)} />}
                <span className="relative flex min-w-0 items-center gap-2">
                  {c.icon && <Icon name={c.icon} size={15} className="text-[var(--fg3)]" />}
                  <span className="truncate">{cmdkMark(c.label, words)}</span>
                  {/* zero basis: the hint only takes what the label leaves, so the label is never the one cut short */}
                  {tags.length > 0 && <span className="min-w-0 flex-1 basis-0 truncate text-xs text-[var(--fg3)]">· {tags.join(' · ')}</span>}
                  {c.hint && !tags.length && <span className="min-w-0 flex-1 basis-0 truncate text-xs text-[var(--fg3)]">{c.hint}</span>}
                </span>
                <span className="relative flex flex-none items-center gap-1 [@media(hover:none)]:hidden">
                  {c.shortcut && <Kbd>{c.shortcut}</Kbd>}
                  {i === active && <Kbd aria-hidden>↵</Kbd>}
                </span>
              </button>
            </div>
          ))}
        </div>
        <div className="flex gap-3 border-t border-[var(--line)] px-3 py-2 text-[11px] text-[var(--fg3)] [@media(hover:none)]:hidden">
          <span><Kbd>↑</Kbd> <Kbd>↓</Kbd> move</span><span><Kbd>↵</Kbd> run</span><span><Kbd>esc</Kbd> close</span>
        </div>
      </motion.div>
    </ModalLayer>
  )
}

/* Inline edit ──────────────────────────────────────────────────────────────── */

/**
 * Click (or Enter) to edit; Enter or blur saves, Escape cancels. With `helper`, a line below shows
 * e.g. "Last edited 2 h ago" and turns into a green `savedHelper` after a change; the text flashes on save.
 */
export function InlineEdit({ value, onSave, className, helper, savedHelper = 'Saved just now', label }:
  { value: string; onSave: (v: string) => void; className?: string; helper?: ReactNode; savedHelper?: ReactNode; label?: string }) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(value)
  const [saves, setSaves] = useState(0)
  const btn = useRef<HTMLButtonElement>(null), refocus = useRef(false)
  useEffect(() => {
    if (editing || !refocus.current) return
    refocus.current = false
    const r = requestAnimationFrame(() => btn.current?.focus()) // next frame, so the Enter that saved doesn't re-open it
    return () => cancelAnimationFrame(r)
  }, [editing])
  const done = (save: boolean, viaKey = false) => {
    const v = draft.trim()
    if (save && v && v !== value) { onSave(v); setSaves(n => n + 1) } else setDraft(value)
    refocus.current = viaKey; setEditing(false)
  }
  const field = editing ? (
    <input autoFocus value={draft} aria-label={label ?? 'Title'} maxLength={80} onFocus={e => e.currentTarget.select()} onChange={e => setDraft(e.target.value)} onBlur={() => done(true)}
      onKeyDown={e => { e.stopPropagation(); if (e.nativeEvent.isComposing) return; if (e.key === 'Enter') { e.preventDefault(); done(true, true) } if (e.key === 'Escape') { e.preventDefault(); done(false, true) } }}
      style={{ width: `${Math.max(12, draft.length + 2)}ch` }}
      className={cn('-mx-2 max-w-full min-w-[min(200px,100%)] rounded-[var(--r-md)] border-0 bg-[var(--card)] px-2 py-1 font-semibold outline-none shadow-[0_0_0_1px_var(--fg3),0_0_0_4px_var(--muted)]', className)} />
  ) : (
    // the name is the visible text plus a hidden ", edit title", so speech users can say what they see
    <button ref={btn} onClick={() => { setDraft(value); setEditing(true) }}
      className={cn('group relative -mx-2 flex max-w-full cursor-text items-center gap-2 overflow-hidden rounded-[var(--r-md)] border-0 bg-transparent px-2 py-1 text-left font-semibold hover:bg-[var(--muted)]', className)}>
      {saves > 0 && <motion.span key={`f${saves}`} aria-hidden className="absolute inset-0 rounded-[var(--r-md)] bg-[var(--ok-soft)]" initial={{ opacity: 1 }} animate={{ opacity: 0 }} transition={{ duration: 0.9, ease: 'easeOut' }} />}
      <motion.span key={saves} className="relative truncate" initial={saves ? { opacity: 0.3, x: -3 } : false} animate={{ opacity: 1, x: 0 }} transition={spring(0.3, 0.3)}>{value}<span className="sr-only">, edit{label ? ` ${label}` : ''}</span></motion.span>
      <Icon name="edit" size={14} className="relative text-[var(--fg3)] opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100 [@media(hover:none)]:opacity-100" />
    </button>
  )
  if (helper === undefined) return field
  return (
    <div className="flex min-w-0 flex-col items-start gap-0.5">
      {field}
      <AnimatePresence mode="wait" initial={false}>
        <motion.span key={saves ? 'saved' : 'helper'} aria-live="polite" initial={{ opacity: 0, y: 3 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -3 }} transition={{ duration: 0.15 }}
          className={cn('text-xs', saves ? 'text-[var(--ok)]' : 'text-[var(--fg3)]')}>{saves ? savedHelper : helper}</motion.span>
      </AnimatePresence>
    </div>
  )
}

/* Notifications ────────────────────────────────────────────────────────────── */

export type Notification = { id: string; title: ReactNode; body?: ReactNode; time: string; read?: boolean }

/**
 * Bell with an unread count; shakes when new unread items arrive. The panel shows the newest `max`
 * items, staggering them in on open; clicking one marks it read, "Mark all read" clears them in sequence.
 */
export function NotificationBell({ items, onChange, max = 5, className }: { items: Notification[]; onChange: (items: Notification[]) => void; max?: number; className?: string }) {
  const unread = items.filter(n => !n.read).length
  const prev = useRef(unread), [shake, setShake] = useState(0)
  useEffect(() => { if (unread > prev.current) setShake(s => s + 1); prev.current = unread }, [unread])
  const cascade = useRef(false)
  const markAll = () => { cascade.current = true; onChange(items.map(n => ({ ...n, read: true }))); setTimeout(() => { cascade.current = false }, 600) }
  const shown = items.slice(0, max)
  return (
    <Popover className={className}>
      <PopoverTrigger size="icon" aria-label={`Notifications, ${unread} unread`} className="!overflow-visible">
        <motion.span key={shake} className="inline-flex origin-top" initial={false} animate={shake ? { rotate: [0, -14, 12, -8, 6, 0] } : undefined} transition={{ duration: 0.5 }}>
          <Icon name="bell" />
        </motion.span>
        <AnimatePresence>
          {unread > 0 && (
            <motion.span initial={{ scale: 0 }} animate={{ scale: 1 }} exit={{ scale: 0 }} transition={spring(0.5, 0.4)}
              className="pointer-events-none absolute -top-1.5 -right-1.5 grid h-5 min-w-5 place-items-center rounded-full border-2 border-[var(--card)] bg-[var(--bad)] px-1 text-[11px] font-semibold text-[var(--card)]">
              <AnimatedNumber value={unread} />
            </motion.span>
          )}
        </AnimatePresence>
      </PopoverTrigger>
      <PopoverContent className="w-[min(300px,calc(100vw-32px))] overflow-hidden !p-0">
        <div className="flex items-center justify-between border-b border-[var(--line)] px-3 py-2"><b className="text-[13px]">Notifications</b>
          <Button size="sm" variant="ghost" disabled={!unread} onClick={markAll}>Mark all read</Button></div>
        {items.length === 0 ? <EmptyState icon="bell" title="You’re all caught up" /> : (
          <div role="list">
            <AnimatePresence initial>
              {shown.map((n, i) => (
                <motion.div key={n.id} role="listitem" layout initial={{ opacity: 0, x: -6 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, height: 0, transition: { duration: 0.15 } }}
                  transition={{ ...spring(0.2, 0.35), delay: i * 0.04 }} className="overflow-hidden border-b border-[var(--line)] last:border-b-0">
                <button onClick={() => onChange(items.map(x => x.id === n.id ? { ...x, read: true } : x))}
                  className="flex w-full cursor-pointer gap-2.5 border-0 bg-transparent px-3 py-2.5 text-left text-xs hover:bg-[var(--muted)]">
                  <motion.span initial={false} animate={{ scale: n.read ? 0 : 1 }} transition={{ ...spring(0.4, 0.3), delay: cascade.current ? i * 0.06 : 0 }}
                    className="mt-1 h-[7px] w-[7px] flex-none rounded-full bg-[var(--accent)]" />
                  <span className="flex-1"><span className="block text-[13px]">{n.title}</span>{n.body && <span className="text-[var(--fg2)]">{n.body}</span>}<span className="block text-[var(--fg3)]">{n.time}</span></span>
                </button>
                </motion.div>
              ))}
            </AnimatePresence>
          </div>
        )}
      </PopoverContent>
    </Popover>
  )
}

/* Onboarding tour ──────────────────────────────────────────────────────────── */

export type TourStep = { target: string; title: ReactNode; body?: ReactNode }
type TourGeo = { x: number; y: number; w: number; h: number; left: number; top: number; above: boolean; ax: number }

/**
 * Guided tour over a region. Mark targets inside `children` with data-tour="…"; the spotlight springs
 * between them and a tooltip with an arrow anchors below each one (above if there's no room).
 * `step` is the open step (-1 = closed). Next/Done, Skip, ←/→ and Escape work.
 */
export function Tour({ steps, step, defaultStep = -1, onStepChange, children, className }:
  { steps: TourStep[]; step?: number; defaultStep?: number; onStepChange?: (step: number) => void; children: ReactNode; className?: string }) {
  const [i, setI] = useControllable(step, defaultStep, onStepChange)
  const wrap = useRef<HTMLDivElement>(null), tip = useRef<HTMLDivElement>(null), next = useRef<HTMLButtonElement>(null)
  const [geo, setGeo] = useState<TourGeo | null>(null)
  const placed = useRef(false)
  const open = i >= 0 && i < steps.length
  const go = (n: number) => setI(n >= 0 && n < steps.length ? n : -1)

  const measure = useCallback(() => {
    const w = wrap.current, t = tip.current
    if (!open || !w || !t) return
    const el = w.querySelector<HTMLElement>(`[data-tour="${steps[i].target}"]`)
    if (!el) return
    const sr = w.getBoundingClientRect(), r = el.getBoundingClientRect(), pad = 4
    const x = r.left - sr.left - pad, y = r.top - sr.top - pad, bw = r.width + pad * 2, bh = r.height + pad * 2
    const tw = t.offsetWidth, th = t.offsetHeight, SW = w.clientWidth, SH = w.clientHeight
    const left = Math.max(8, Math.min(SW - tw - 8, x))
    let top = y + bh + 12, above = false
    if (top + th > SH - 6) { top = Math.max(6, y - th - 12); above = true }
    setGeo({ x, y, w: bw, h: bh, left, top, above, ax: Math.max(12, Math.min(tw - 22, x + bw / 2 - left - 5)) })
  }, [open, i, steps])
  useLayoutEffect(() => { if (open) measure(); else { setGeo(null); placed.current = false } }, [open, measure])
  useEffect(() => {
    if (!open || !wrap.current) return
    const ro = new ResizeObserver(() => measure()); ro.observe(wrap.current)
    if (tip.current) ro.observe(tip.current)
    return () => ro.disconnect()
  }, [open, measure])
  const ready = open && !!geo
  useEffect(() => { if (ready) next.current?.focus({ preventScroll: true }) }, [ready])
  useEffect(() => { if (geo) placed.current = true }, [geo])

  const s = open ? steps[i] : null
  const move = placed.current ? spring(0.2, 0.45) : { duration: 0 }
  return (
    <div ref={wrap} className={cn('relative overflow-hidden rounded-[var(--r-md)]', className)}
      onKeyDown={e => {
        if (!open) return
        if (e.key === 'Escape') { e.stopPropagation(); go(-1) }
        if (e.key === 'ArrowRight') go(i + 1)
        if (e.key === 'ArrowLeft' && i > 0) go(i - 1)
      }}>
      {children}
      <AnimatePresence>
        {open && geo && (
          <motion.div key="spot" aria-hidden className="pointer-events-none absolute top-0 left-0 z-[5] rounded-[var(--r-md)] shadow-[0_0_0_9999px_rgba(0,0,0,.45)]"
            initial={{ opacity: 0, x: geo.x, y: geo.y, width: geo.w, height: geo.h }} animate={{ opacity: 1, x: geo.x, y: geo.y, width: geo.w, height: geo.h }}
            exit={{ opacity: 0, transition: { duration: 0.2 } }} transition={{ ...spring(0.2, 0.5), opacity: { duration: 0.25 } }} />
        )}
      </AnimatePresence>
      <AnimatePresence>
        {s && (
          <motion.div key="tip" ref={tip} role="dialog" aria-label="Product tour" aria-live="polite"
            initial={{ opacity: 0, y: 8 }} animate={geo ? { opacity: 1, y: 0, left: geo.left, top: geo.top } : { opacity: 0 }}
            exit={{ opacity: 0, y: 8, transition: { duration: 0.15 } }} transition={{ default: spring(0.25, 0.35), left: move, top: move }}
            style={{ visibility: geo ? 'visible' : 'hidden' }}
            className={cn(floatingSurface, 'absolute top-0 left-0 z-[6] w-[min(250px,calc(100%-16px))] rounded-[var(--r-md)] p-3 text-[13px]')}>
            {geo && <span aria-hidden className={cn('absolute h-2.5 w-2.5 border-[var(--line)] bg-[var(--card)]',
              geo.above ? '-bottom-[6px] rotate-[225deg] border-t border-l' : '-top-[6px] rotate-45 border-t border-l')} style={{ left: geo.ax }} />}
            <motion.div key={i} initial={{ opacity: 0, x: 6 }} animate={{ opacity: 1, x: 0 }} transition={{ duration: 0.2 }}>
              <b className="block font-semibold">{s.title}</b>
              {s.body && <div className="mt-1 mb-3 text-xs leading-normal text-[var(--fg3)]">{s.body}</div>}
            </motion.div>
            <div className="flex items-center justify-between gap-2">
              <span className="ui-num text-xs text-[var(--fg3)]">{i + 1} of {steps.length}</span>
              <div className="flex gap-1.5">
                {i < steps.length - 1 && <Button size="sm" variant="ghost" onClick={() => go(-1)}>Skip</Button>}
                <Button ref={next} size="sm" variant="primary" onClick={() => go(i + 1)}>{i === steps.length - 1 ? 'Done' : 'Next'}</Button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
