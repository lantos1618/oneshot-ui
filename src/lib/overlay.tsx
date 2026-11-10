import { Fragment, createContext, isValidElement, useCallback, useContext, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type HTMLAttributes, type ReactNode, type Ref, type RefObject, type KeyboardEvent as RKeyboardEvent, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent } from 'react'
import { createPortal } from 'react-dom'
import { AnimatePresence, motion, useDragControls, type Variants } from 'motion/react'
import { type AsChildProps, Button, type ButtonProps, FOCUSABLE, Icon, IconButton, type IconName, Kbd, Slot, cn, isTouch, menuItemClass, prefersReducedMotion, spring, useControllable, useFocusTrap, useLongPress, useMediaQuery, useOutside, useRoving, AnimatedNumber, Spinner, TOUCH, uiShared, surface, menuKeyMove } from './core'
import { EmptyState } from './feedback'
import { shake } from './motion'
import { useVirtual, virtualSetAria } from './virtual'

type PopCtx = { open: boolean; setOpen: (v: boolean) => void; triggerRef: RefObject<HTMLButtonElement | null>; id: string }
const PopoverCtx = createContext<PopCtx | null>(null)
export const usePopover = () => {
  const c = useContext(PopoverCtx); if (!c) throw new Error('usePopover must be inside <Popover>'); return c
}

/** Popover.Root (also plain `<Popover>`): anchored panel state. Closes on outside click and Escape; springs in from its trigger. Controlled (`open`) or uncontrolled (`defaultOpen`). */
export function PopoverRoot({ open: o, defaultOpen = false, onOpenChange, children, className }:
  { open?: boolean; defaultOpen?: boolean; onOpenChange?: (v: boolean) => void; children: ReactNode; className?: string }) {
  const [open, setOpen] = useControllable(o, defaultOpen, onOpenChange)
  const wrap = useRef<HTMLDivElement>(null), triggerRef = useRef<HTMLButtonElement>(null), id = useId()
  useOutside([wrap], () => setOpen(false), open)
  const ctx = useMemo(() => ({ open, setOpen, triggerRef, id }), [open, setOpen, id])
  return (
    <PopoverCtx.Provider value={ctx}>
      <div ref={wrap} className={cn('relative inline-block', className)}
        onKeyDown={e => { if (e.key === 'Escape' && open) { e.stopPropagation(); setOpen(false); triggerRef.current?.focus() } }}>
        {children}
      </div>
    </PopoverCtx.Provider>
  )
}

/**
 * A Button (or, with `asChild`, your element) that runs `action` on click. The caller's own onClick runs first; calling
 * `e.preventDefault()` there skips the action. The building block of every Trigger and Close part.
 */
function OverlayPartButton({ asChild, onClick, action, children, ...p }: ButtonProps & { action: () => void }) {
  const click = (e: ReactMouseEvent<HTMLButtonElement>) => { onClick?.(e); if (!e.defaultPrevented) action() }
  if (asChild) return <Slot<HTMLButtonElement> {...p} onClick={click}>{children}</Slot>
  return <Button {...p} onClick={click}>{children}</Button>
}

/** Popover.Trigger: toggles the popover. Takes all Button props, or `asChild` to make your own element the trigger. */
export function PopoverTrigger({ children, ...p }: ButtonProps) {
  const { open, setOpen, triggerRef, id } = usePopover()
  return <OverlayPartButton ref={triggerRef} aria-expanded={open} aria-haspopup="dialog" aria-controls={id} {...p} action={() => setOpen(!open)}>{children}</OverlayPartButton>
}

/** Popover.Close: closes the popover (focus goes back to its trigger). Button props, or `asChild`. */
export function PopoverClose({ children, ...p }: ButtonProps) {
  const { setOpen } = usePopover()
  return <OverlayPartButton {...p} action={() => setOpen(false)}>{children}</OverlayPartButton>
}

/** Panel placement: the side (`top`/`bottom`/`left`/`right`), then the alignment (`-start` = left or top edge, `-end` = right or bottom). */
const SIDE = {
  'bottom-start': 'top-[calc(100%+6px)] start-0 origin-top-left', 'bottom-end': 'top-[calc(100%+6px)] end-0 origin-top-right',
  'bottom-center': 'top-[calc(100%+6px)] left-1/2 -translate-x-1/2 origin-top', 'top-start': 'bottom-[calc(100%+8px)] start-0 origin-bottom-left',
  'top-center': 'bottom-[calc(100%+8px)] left-1/2 -translate-x-1/2 origin-bottom', 'top-end': 'bottom-[calc(100%+8px)] end-0 origin-bottom-right',
  right: 'left-[calc(100%+8px)] top-1/2 -translate-y-1/2 origin-left', left: 'right-[calc(100%+8px)] top-1/2 -translate-y-1/2 origin-right',
  'right-start': 'left-[calc(100%+8px)] top-0 origin-top-left', 'right-end': 'left-[calc(100%+8px)] bottom-0 origin-bottom-left',
  'left-start': 'right-[calc(100%+8px)] top-0 origin-top-right', 'left-end': 'right-[calc(100%+8px)] bottom-0 origin-bottom-right',
} as const
export type Placement = keyof typeof SIDE
const FLIP_SIDE: Partial<Record<Placement, Placement>> = {
  'bottom-start': 'top-start', 'bottom-end': 'top-end', 'bottom-center': 'top-center', 'top-start': 'bottom-start', 'top-end': 'bottom-end', 'top-center': 'bottom-center',
  right: 'left', left: 'right', 'right-start': 'left-start', 'right-end': 'left-end', 'left-start': 'right-start', 'left-end': 'right-end',
}

/** Which side of its trigger a floating part opens on. Physical: `right` is the right. */
export type FloatSide = 'top' | 'right' | 'bottom' | 'left'
/** How a floating part lines up along that side. Logical on top/bottom: `start` is the right edge. */
export type FloatAlign = 'start' | 'center' | 'end'
/** Positioning props of the floating content parts (Popover, DropdownMenu, HoverCard, Tooltip). */
export type FloatProps = {
  /** side of the trigger; flips to the opposite side when there is no room */ side?: FloatSide
  /** alignment along that side */ align?: FloatAlign
  /** gap between trigger and panel in px (default 6 below the trigger, 8 elsewhere) */ sideOffset?: number
  /** the single-string form ('bottom-start', 'top-center', 'right'…); `side`/`align` win when given */ placement?: Placement
  /** a small arrow pointing back at the trigger */ arrow?: boolean
}
/** side + align → Placement ('right' + 'center' → 'right'); either missing falls back to `fallback`'s. */
export function floatPlacement(side?: FloatSide, align?: FloatAlign, fallback: Placement = 'bottom-start'): Placement {
  if (!side && !align) return fallback
  const [fs, fa] = fallback.split('-') as [FloatSide, FloatAlign | undefined]
  const s = side ?? fs, a = align ?? fa ?? 'center'
  return (s === 'left' || s === 'right') && a === 'center' ? s : `${s}-${a}` as Placement
}
const floatSideOf = (p: Placement) => p.split('-')[0] as FloatSide
/** Margin that turns the default 6/8px gap into `offset`. */
function floatGap(p: Placement, offset: number | undefined): CSSProperties | undefined {
  if (offset === undefined) return undefined
  const s = floatSideOf(p), gap = offset - (s === 'bottom' ? 6 : 8)
  return s === 'bottom' ? { marginTop: gap } : s === 'top' ? { marginBottom: gap } : s === 'right' ? { marginLeft: gap } : { marginRight: gap }
}
/* Arrow classes: which edge it sits on (and which two borders draw it), then where along that edge. */
/** Arrow positions for a panel's bordered 10px square and a tooltip's filled 8px one: the edge it sits on, and where along it. */
const FLOAT_ARROW = {
  panel: {
    edge: { bottom: '-top-[5px] border-t border-l', top: '-bottom-[5px] border-b border-r', right: '-left-[5px] border-b border-l', left: '-right-[5px] border-t border-r' },
    x: { start: 'start-4', center: 'left-[calc(50%-5px)]', end: 'end-4' }, y: { start: 'top-3', center: 'top-[calc(50%-5px)]', end: 'bottom-3' },
  },
  tip: {
    edge: { top: '-bottom-1', bottom: '-top-1', right: '-left-1', left: '-right-1' },
    x: { start: 'start-3', center: 'left-[calc(50%-4px)]', end: 'end-3' }, y: { start: 'top-2', center: 'top-[calc(50%-4px)]', end: 'bottom-2' },
  },
} as const
/** The arrow classes for placement `p` (`center` ignores the alignment, for portalled tooltips). */
const floatArrowClass = (p: Placement, kind: keyof typeof FLOAT_ARROW = 'panel', center = false) => {
  const s = floatSideOf(p), a = (center ? 'center' : p.split('-')[1] ?? 'center') as FloatAlign, t = FLOAT_ARROW[kind]
  return cn(t.edge[s], t[s === 'top' || s === 'bottom' ? 'x' : 'y'][a])
}

/**
 * Absolutely positioned panel next to its (relative) parent. Flips to the other side when it would
 * run off the bottom (or top) of the viewport and there is more room there (`flip={false}` pins it), and
 * slides sideways to stay 8px inside the screen edges on narrow (phone) viewports. Never wider than the screen.
 * Left/right placements flip horizontally the same way. The side is chosen once, when it opens, and stays locked while
 * it is open, so content that shrinks or grows (a filtered list) never makes it jump to the other side. `flip="scroll"` never flips: when the panel doesn't fit on its
 * side the page scrolls just enough to show it (for type-to-filter lists, whose height changes as you type: above the
 * field they would shrink from the top and cover the label). `offset` sets the gap in px, `arrow` draws a pointer.
 */
export function FloatingPanel({ open, placement = 'bottom-start', flip = true, matchWidth, offset, arrow, className, children, role = 'dialog', id, ...p }:
  { open: boolean; placement?: Placement; flip?: boolean | 'scroll'; matchWidth?: boolean; offset?: number; arrow?: boolean; className?: string; children: ReactNode; role?: string; id?: string } & Omit<HTMLAttributes<HTMLDivElement>, 'onAnimationStart' | 'onDrag' | 'onDragStart' | 'onDragEnd'>) {
  const [side, setSide] = useState<Placement>(placement)
  const [shift, setShift] = useState(0)
  const ref = useRef<HTMLDivElement>(null), shiftRef = useRef(0)
  const horizontal = (s: Placement) => s.startsWith('left') || s.startsWith('right')
  useLayoutEffect(() => { // horizontal clamp: keep the panel inside the viewport
    if (!open || horizontal(side)) { shiftRef.current = 0; setShift(0); return }
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
    if (horizontal(placement)) { // left/right: flip across when it doesn't fit and the other side has more room
      const w = el.offsetWidth, roomR = innerWidth - anchor.right - 8, roomL = anchor.left - 8
      setSide((placement.startsWith('left') ? w + 8 > roomL && roomR > roomL : w + 8 > roomR && roomL > roomR) ? alt : placement)
      return
    }
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
  const gap = floatGap(side, offset)
  // a right-anchored panel moves with margin-right; the others with margin-left
  const rightAnchored = !side.endsWith('center') && side.endsWith('end') !== false
  const style = gap || shift ? { ...gap, ...(shift ? rightAnchored ? { marginRight: -shift } : { marginLeft: shift } : null) } : undefined
  return (
    <AnimatePresence>
      {open && (
        <div ref={ref} className={cn('absolute z-50', SIDE[side], matchWidth && 'w-full')} style={style}>
          <motion.div id={id} role={role} initial={{ opacity: 0, y: up ? 4 : -4, scale: 0.97 }} animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, scale: 0.97, transition: { duration: 0.12 } }} transition={spring(0.25, 0.3)}
            className={cn(surface.floating, 'max-w-[calc(100vw-16px)] min-w-[min(180px,calc(100vw-16px))] p-1', className)} {...p}>
            {children}
          </motion.div>
          {arrow && <motion.span aria-hidden initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, transition: { duration: 0.1 } }}
            className={cn('pointer-events-none absolute h-2.5 w-2.5 rotate-45 border-[var(--line)] bg-[var(--card)]', floatArrowClass(side))} />}
        </div>
      )}
    </AnimatePresence>
  )
}

/**
 * Popover.Content: the panel of a Popover. Position it with `side`/`align`/`sideOffset` (or `placement`), add `arrow`.
 * On open it moves focus inside: to an element marked `data-autofocus`, else the first
 * focusable one, else the panel itself (unless a child already took focus, e.g. a Calendar's selected day).
 * On close it hands focus back to the trigger when focus was inside the panel (or nowhere).
 */
export function PopoverContent({ placement, side, align, sideOffset, arrow, className, children, role, 'aria-label': ariaLabel, 'aria-labelledby': labelledBy }:
  FloatProps & { className?: string; children: ReactNode; role?: string; /** names the panel (a dialog needs a name) */ 'aria-label'?: string; 'aria-labelledby'?: string }) {
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
  return (
    <FloatingPanel open={open} id={id} placement={floatPlacement(side, align, placement)} offset={sideOffset} arrow={arrow} role={role} aria-label={ariaLabel} aria-labelledby={labelledBy}
      tabIndex={-1} className={cn('outline-none', className)}>{children}</FloatingPanel>
  )
}

/**
 * Anchored panel: `<Popover><PopoverTrigger>Share</PopoverTrigger><PopoverContent>…</PopoverContent></Popover>`, or the
 * parts `Popover.Root` / `Popover.Trigger` (asChild) / `Popover.Content` (side, align, sideOffset, arrow) / `Popover.Close`.
 */
export const Popover = Object.assign(PopoverRoot, { Root: PopoverRoot, Trigger: PopoverTrigger, Content: PopoverContent, Close: PopoverClose })

/** Variants for a menu's item list: items slide in one after another. */
export const menuListVariants: Variants = { hidden: {}, show: { transition: { staggerChildren: 0.03 } } }
/** Each item slides in from the left. */
const menuItemVariants: Variants = { hidden: { opacity: 0, x: -6 }, show: { opacity: 1, x: 0, transition: { duration: 0.2 } } }

/** What the items of a menu (DropdownMenu or ContextMenu content) need from it: close it, focus back on its trigger. */
type MenuCtxV = { close: (refocus?: boolean) => void }
const MenuCtx = createContext<MenuCtxV | null>(null)
/** Close the menu around an item: a DropdownMenu, a ContextMenu, or (older usage) a plain Popover. */
function useMenuClose() {
  const menu = useContext(MenuCtx), pop = useContext(PopoverCtx)
  return (refocus = true) => {
    if (menu) menu.close(refocus)
    else if (pop) { pop.setOpen(false); if (refocus) pop.triggerRef.current?.focus() }
  }
}

/** What a menu item's `onSelect` gets. Call `preventDefault()` to keep the menu open. */
export type MenuSelectEvent = { defaultPrevented: boolean; preventDefault: () => void; nativeEvent: ReactMouseEvent<HTMLElement> }
const menuSelectEvent = (e: ReactMouseEvent<HTMLElement>): MenuSelectEvent => {
  const ev: MenuSelectEvent = { defaultPrevented: false, preventDefault: () => { ev.defaultPrevented = true }, nativeEvent: e }
  return ev
}
const MENU_ITEM_SEL = '[role=menuitem],[role=menuitemcheckbox],[role=menuitemradio]'
/** The enabled items of one menu list (not those of a submenu nested inside it). */
const menuItemsOf = (list: Element | null | undefined) => list ? [...list.querySelectorAll<HTMLElement>(MENU_ITEM_SEL)]
  .filter(el => el.closest('[data-menu-list]') === list && !(el as HTMLButtonElement).disabled && el.getAttribute('aria-disabled') !== 'true') : []
/** Pointer hover moves focus to the item (so arrows carry on from where the mouse is). */
const menuHoverFocus = (e: ReactPointerEvent<HTMLElement>) => { if (e.pointerType === 'mouse' && document.activeElement !== e.currentTarget) e.currentTarget.focus({ preventScroll: true }) }

/**
 * Keyboard for one menu list: ↑/↓ move (wrapping), Home/End jump, and typing a letter or a word jumps to the next item
 * whose label (or `textValue`) starts with it (typeahead; repeating one letter cycles). Only acts for the list that owns
 * the focused item, so a submenu's keys don't move its parent.
 */
function useMenuKeys() {
  const buf = useRef({ s: '', t: 0 })
  return useCallback((e: RKeyboardEvent<HTMLElement>) => {
    const list = e.currentTarget
    if ((e.target as Element).closest?.('[data-menu-list]') !== list) return
    const items = menuItemsOf(list)
    if (!items.length) return
    const i = items.indexOf(document.activeElement as HTMLElement)
    const next = menuKeyMove(e.key, i, items.length)
    if (next !== null) { e.preventDefault(); items[next]?.focus() }
    else if (e.key.length === 1 && e.key !== ' ' && !e.ctrlKey && !e.metaKey && !e.altKey) {
      const b = buf.current, now = Date.now(), k = e.key.toLowerCase()
      b.s = now - b.t > 700 ? k : b.s + k; b.t = now
      const same = [...b.s].every(c => c === b.s[0]), q = same ? b.s[0] : b.s
      const from = same ? i + 1 : Math.max(i, 0)
      const order = [...items.slice(from), ...items.slice(0, from)]
      const label = (el: HTMLElement) => (el.dataset.textValue ?? el.textContent ?? '').trim().toLowerCase()
      const hit = order.find(el => label(el).startsWith(q))
      if (hit) { e.preventDefault(); hit.focus() }
    }
  }, [])
}

type MenuItemBase = {
  children?: ReactNode; className?: string; disabled?: boolean
  /** label for typeahead when the text content isn't it */ textValue?: string
  /** indent to line up with checkbox and radio items */ inset?: boolean
}
const menuRowClass = (danger?: boolean, disabled?: boolean, inset?: boolean, className?: string) =>
  cn(menuItemClass, danger && 'text-[var(--bad)]', disabled && 'cursor-default opacity-50', inset && '!ps-8', className)

/**
 * One row in a menu (DropdownMenu.Item / ContextMenu.Item). Not a Tab stop (arrows and typeahead move between rows); choosing
 * it calls `onSelect` and closes the menu, returning focus to the trigger (`closeOnSelect={false}` or `e.preventDefault()`
 * in onSelect keeps it open). `shortcut` shows a key cap; `asChild` renders your element (a link) as the row.
 */
export function MenuItem({ children, shortcut, icon, danger, disabled, onSelect, closeOnSelect = true, textValue, inset, asChild, className }: MenuItemBase & AsChildProps &
  { shortcut?: string; icon?: IconName; danger?: boolean; onSelect?: (e: MenuSelectEvent) => void; closeOnSelect?: boolean }) {
  const close = useMenuClose(), inMenu = useContext(MenuCtx) !== null
  const props = {
    role: 'menuitem', tabIndex: -1, 'data-text-value': textValue, className: menuRowClass(danger, disabled, inset, className),
    onPointerMove: inMenu ? menuHoverFocus : undefined,
    onClick: (e: ReactMouseEvent<HTMLElement>) => {
      if (disabled) { e.preventDefault(); return }
      const ev = menuSelectEvent(e); onSelect?.(ev)
      if (closeOnSelect && !ev.defaultPrevented) close()
    },
  }
  if (asChild) return <Slot {...props} aria-disabled={disabled || undefined}>{children}</Slot>
  return (
    <motion.button type="button" variants={menuItemVariants} disabled={disabled} {...props}>
      <span className="flex min-w-0 flex-1 items-center gap-2">{icon && <Icon name={icon} size={15} className={danger ? '' : 'text-[var(--fg3)]'} />}{children}</span>
      {shortcut && <Kbd>{shortcut}</Kbd>}
    </motion.button>
  )
}
/** Thin rule between groups of menu rows. */
export const MenuSeparator = ({ className }: { className?: string }) => <div role="separator" className={cn('mx-1 my-1 h-px bg-[var(--line)]', className)} />
/** Small grey heading over a group of rows in a menu, listbox or palette. */
export const MenuLabel = ({ children, id, inset, className }: { children: ReactNode; id?: string; inset?: boolean; className?: string }) =>
  <div id={id} role="presentation" className={cn('px-2 pt-2 pb-1 text-[11px] text-[var(--fg3)]', inset && 'ps-8', className)}>{children}</div>
/** A named group of menu rows (role=group). */
export const MenuGroup = ({ children, 'aria-label': label, className }: { children: ReactNode; 'aria-label'?: string; className?: string }) =>
  <div role="group" aria-label={label} className={className}>{children}</div>
/** End-aligned shortcut hint inside a menu row: `<DropdownMenu.Item>Copy<DropdownMenu.Shortcut>⌘C</DropdownMenu.Shortcut></DropdownMenu.Item>`. */
export const MenuShortcut = ({ children, className }: { children: ReactNode; className?: string }) =>
  <span className={cn('ms-auto ps-3 font-[family-name:var(--mono)] text-[11px] text-[var(--fg3)]', className)}>{children}</span>

/** The tick or dot in front of a checkbox or radio menu item; pops in when it turns on. */
function MenuIndicator({ on, kind }: { on: boolean; kind: 'check' | 'dot' }) {
  return (
    <span aria-hidden className="grid h-4 w-4 flex-none place-items-center text-[var(--fg)]">
      <AnimatePresence initial={false}>
        {on && <motion.span key="on" className="grid" initial={{ scale: 0.4, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.4, opacity: 0, transition: { duration: 0.1 } }} transition={spring(0.4, 0.3)}>
          {kind === 'check' ? <Icon name="check" size={14} strokeWidth={2.4} /> : <span className="h-1.5 w-1.5 rounded-full bg-current" />}
        </motion.span>}
      </AnimatePresence>
    </span>
  )
}

/**
 * A menu row that toggles (role=menuitemcheckbox, aria-checked): `checked` + `onCheckedChange`, or `defaultChecked`.
 * Stays open when toggled, so several can be flipped in a row (`closeOnSelect` closes it).
 */
export function MenuCheckboxItem({ checked, defaultChecked = false, onCheckedChange, onSelect, closeOnSelect = false, shortcut, children, disabled, textValue, className }: MenuItemBase &
  { checked?: boolean; defaultChecked?: boolean; onCheckedChange?: (checked: boolean) => void; onSelect?: (e: MenuSelectEvent) => void; closeOnSelect?: boolean; shortcut?: string }) {
  const [on, set] = useControllable(checked, defaultChecked, onCheckedChange)
  const close = useMenuClose()
  return (
    <motion.button type="button" variants={menuItemVariants} role="menuitemcheckbox" aria-checked={on} tabIndex={-1} disabled={disabled} data-text-value={textValue}
      className={menuRowClass(false, disabled, false, className)} onPointerMove={menuHoverFocus}
      onClick={e => { const ev = menuSelectEvent(e); onSelect?.(ev); if (ev.defaultPrevented) return; set(!on); if (closeOnSelect) close() }}>
      <span className="flex min-w-0 flex-1 items-center gap-2"><MenuIndicator on={on} kind="check" />{children}</span>
      {shortcut && <Kbd>{shortcut}</Kbd>}
    </motion.button>
  )
}

type MenuRadioCtxV = { value: string | undefined; set: (v: string) => void }
const MenuRadioCtx = createContext<MenuRadioCtxV | null>(null)
/** A set of radio menu items (role=group): one `value` (controlled with `onValueChange`, or `defaultValue`). */
export function MenuRadioGroup({ value, defaultValue, onValueChange, children, 'aria-label': label, className }:
  { value?: string; defaultValue?: string; onValueChange?: (value: string) => void; children: ReactNode; 'aria-label'?: string; className?: string }) {
  const [v, set] = useControllable<string | undefined>(value, defaultValue, onValueChange as (v: string | undefined) => void)
  return <MenuRadioCtx.Provider value={{ value: v, set }}><div role="group" aria-label={label} className={className}>{children}</div></MenuRadioCtx.Provider>
}
/** One choice in a MenuRadioGroup (role=menuitemradio, aria-checked). Stays open when picked unless `closeOnSelect`. */
export function MenuRadioItem({ value, onSelect, closeOnSelect = false, shortcut, children, disabled, textValue, className }: MenuItemBase &
  { value: string; onSelect?: (e: MenuSelectEvent) => void; closeOnSelect?: boolean; shortcut?: string }) {
  const g = useContext(MenuRadioCtx)
  if (!g) throw new Error('<RadioItem> must be inside a menu <RadioGroup>')
  const close = useMenuClose(), on = g.value === value
  return (
    <motion.button type="button" variants={menuItemVariants} role="menuitemradio" aria-checked={on} tabIndex={-1} disabled={disabled} data-text-value={textValue}
      className={menuRowClass(false, disabled, false, className)} onPointerMove={menuHoverFocus}
      onClick={e => { const ev = menuSelectEvent(e); onSelect?.(ev); if (ev.defaultPrevented) return; g.set(value); if (closeOnSelect) close() }}>
      <span className="flex min-w-0 flex-1 items-center gap-2"><MenuIndicator on={on} kind="dot" />{children}</span>
      {shortcut && <Kbd>{shortcut}</Kbd>}
    </motion.button>
  )
}

/* Submenus ─ */

type MenuSubCtxV = { open: boolean; setOpen: (v: boolean) => void; hover: () => void; triggerRef: RefObject<HTMLButtonElement | null>; id: string }
const MenuSubCtx = createContext<MenuSubCtxV | null>(null)
const useMenuSub = (part: string) => { const c = useContext(MenuSubCtx); if (!c) throw new Error(`<${part}> must be inside a menu <Sub>`); return c }
const menuFirstItem = (id: string) => requestAnimationFrame(() => menuItemsOf(document.getElementById(id))[0]?.focus({ preventScroll: true }))

/**
 * A nested menu (DropdownMenu.Sub / ContextMenu.Sub): wraps a SubTrigger and a SubContent. Opens on hover (mouse), click
 * or tap, → / Enter / Space; ← or Escape closes it and returns to the trigger.
 * `open` + `onOpenChange` to control it.
 */
export function MenuSub({ open, defaultOpen = false, onOpenChange, children }: { open?: boolean; defaultOpen?: boolean; onOpenChange?: (open: boolean) => void; children: ReactNode }) {
  const [o, setO] = useControllable(open, defaultOpen, onOpenChange)
  const now = useRef(o); now.current = o
  const triggerRef = useRef<HTMLButtonElement>(null), id = useId(), t = useRef<ReturnType<typeof setTimeout>>(undefined)
  useEffect(() => () => clearTimeout(t.current), [])
  const value = useMemo<MenuSubCtxV>(() => {
    const setOpen = (v: boolean) => { clearTimeout(t.current); if (v !== now.current) { now.current = v; setO(v) } }
    return { open: o, setOpen, triggerRef, id, hover: () => { clearTimeout(t.current); if (!now.current) t.current = setTimeout(() => setOpen(true), 90) } }
  }, [o, setO, id])
  return (
    <MenuSubCtx.Provider value={value}>
      <div className="relative" onPointerEnter={() => { if (now.current) clearTimeout(t.current) }}
        onPointerLeave={e => { if (e.pointerType !== 'mouse') return; clearTimeout(t.current); t.current = setTimeout(() => value.setOpen(false), 220) }}
        onBlur={e => { const to = e.relatedTarget as Node | null; if (to && !e.currentTarget.contains(to)) value.setOpen(false) }}>
        {children}
      </div>
    </MenuSubCtx.Provider>
  )
}
/** The row that opens a submenu (aria-haspopup=menu, aria-expanded); shows a chevron. */
export function MenuSubTrigger({ children, icon, disabled, textValue, inset, className }: MenuItemBase & { icon?: IconName }) {
  const sub = useMenuSub('SubTrigger')
  const openAndFocus = () => { sub.setOpen(true); menuFirstItem(sub.id) }
  return (
    <motion.button ref={sub.triggerRef} id={`${sub.id}-t`} type="button" variants={menuItemVariants} role="menuitem" aria-haspopup="menu" aria-expanded={sub.open}
      aria-controls={sub.open ? sub.id : undefined} tabIndex={-1} disabled={disabled} data-text-value={textValue} data-state={sub.open ? 'open' : 'closed'}
      className={cn(menuRowClass(false, disabled, inset, className), 'data-[state=open]:bg-[var(--muted)]')}
      onPointerMove={menuHoverFocus} onPointerEnter={e => { if (e.pointerType === 'mouse') sub.hover() }} onClick={openAndFocus}
      onKeyDown={e => { if (e.key === 'ArrowRight' || e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); openAndFocus() } }}>
      <span className="flex min-w-0 flex-1 items-center gap-2">{icon && <Icon name={icon} size={15} className="text-[var(--fg3)]" />}{children}</span>
      <Icon name="chevronRight" size={13} className="text-[var(--fg3)]" />
    </motion.button>
  )
}

const ctxPanelVariants: Variants = {
  hidden: { opacity: 0, scale: 0.94 },
  show: { opacity: 1, scale: 1, transition: { ...spring(0.25, 0.25), staggerChildren: 0.025 } },
}

/**
 * The submenu panel. Opens to the right of its trigger, on the other side
 * when that has no room, and on a phone too narrow for either it overlaps just below the trigger; it also moves up to
 * stay on screen.
 */
export function MenuSubContent({ children, className, 'aria-label': ariaLabel }: { children: ReactNode; className?: string; 'aria-label'?: string }) {
  const sub = useMenuSub('SubContent'), keys = useMenuKeys()
  const ref = useRef<HTMLDivElement>(null)
  const [place, setPlace] = useState<{ left: number; top: number; onLeft: boolean } | null>(null)
  useLayoutEffect(() => {
    if (!sub.open) { setPlace(null); return }
    const el = ref.current, tr = sub.triggerRef.current
    if (!el || !tr) return
    const r = tr.getBoundingClientRect(), w = el.offsetWidth, h = el.offsetHeight
    const right = r.width + 4, leftOf = -w - 4 // physical offsets from the trigger's left edge
    const fitsR = r.right + 4 + w <= innerWidth - 8, fitsL = r.left - 4 - w >= 8
    let left: number, top = -5
    if (fitsR) left = right
    else if (fitsL) left = leftOf
    else { left = Math.max(8, Math.min(innerWidth - 8 - w, (r.left + 24))) - r.left; top = r.height }
    if (r.top + top + h > innerHeight - 8) top = top > 0 && r.top - h - 2 >= 8 ? -h - 2 : Math.max(8, innerHeight - 8 - h) - r.top // overlapping: above the trigger when below doesn't fit
    setPlace({ left, top, onLeft: left < 0 })
  }, [sub.open]) // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <AnimatePresence>
      {sub.open && (
        <motion.div ref={ref} id={sub.id} role="menu" aria-label={ariaLabel} aria-labelledby={ariaLabel ? undefined : `${sub.id}-t`} data-menu-list
          variants={ctxPanelVariants} initial="hidden" animate="show" exit={{ opacity: 0, scale: 0.97, transition: { duration: 0.1 } }}
          style={place ? { left: place.left, top: place.top } : { visibility: 'hidden' }}
          className={cn(surface.floating, 'absolute z-10 min-w-[180px] p-1', place?.onLeft ? 'origin-top-right' : 'origin-top-left', className)}
          onKeyDown={e => {
            if ((e.target as Element).closest('[data-menu-list]') !== e.currentTarget) return
            if (e.key === 'ArrowLeft' || e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); sub.setOpen(false); sub.triggerRef.current?.focus(); return }
            keys(e)
          }}>
          {children}
        </motion.div>
      )}
    </AnimatePresence>
  )
}

/* Dropdown menu ─ */

/** The item list inside DropdownMenu content: arrow keys and typeahead move, Tab or focus leaving the menu closes it. */
function DropdownList({ children }: { children: ReactNode }) {
  const { setOpen, triggerRef } = usePopover(), keys = useMenuKeys()
  return (
    <motion.div data-menu-list initial="hidden" animate="show" variants={menuListVariants}
      onKeyDown={e => { if (e.key === 'Tab') setOpen(false); else keys(e) }}
      onBlur={e => { const to = e.relatedTarget as Node | null; if (to && !e.currentTarget.contains(to) && !triggerRef.current?.contains(to)) setOpen(false) }}>
      {children}
    </motion.div>
  )
}

/** DropdownMenu.Root: the menu's open state (`open` + `onOpenChange`, or `defaultOpen`). Wraps trigger and content in an inline box. */
export function DropdownMenuRoot(p: { open?: boolean; defaultOpen?: boolean; onOpenChange?: (open: boolean) => void; children: ReactNode; className?: string }) {
  return <PopoverRoot {...p} />
}
/** DropdownMenu.Trigger: opens the menu on click, Enter, Space or ↓ (aria-haspopup=menu). Button props, or `asChild`. */
export function DropdownMenuTrigger({ onKeyDown, ...p }: ButtonProps) {
  const { open, setOpen } = usePopover()
  return <PopoverTrigger aria-haspopup="menu" {...p} onKeyDown={e => { onKeyDown?.(e); if (!e.defaultPrevented && !open && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) { e.preventDefault(); setOpen(true) } }} />
}
/** DropdownMenu.Content: the menu panel (role=menu). The first item takes focus and the rest stagger in. `side`, `align`, `sideOffset`, `arrow`. */
export function DropdownMenuContent({ children, className, 'aria-label': ariaLabel, ...float }: FloatProps & { children: ReactNode; className?: string; 'aria-label'?: string }) {
  const { setOpen, triggerRef } = usePopover()
  const menu = useMemo<MenuCtxV>(() => ({ close: (refocus = true) => { setOpen(false); if (refocus) triggerRef.current?.focus() } }), [setOpen, triggerRef])
  return (
    <MenuCtx.Provider value={menu}>
      <PopoverContent {...float} role="menu" aria-label={ariaLabel} className={className}><DropdownList>{children}</DropdownList></PopoverContent>
    </MenuCtx.Provider>
  )
}

/** The config form: a trigger label and the items as children. */
function DropdownMenuConfig({ trigger, children, placement, variant, size, className, open, defaultOpen, onOpenChange }:
  { trigger: ReactNode; children: ReactNode; placement?: Placement; className?: string; open?: boolean; defaultOpen?: boolean; onOpenChange?: (open: boolean) => void } & Pick<ButtonProps, 'variant' | 'size'>) {
  return (
    <DropdownMenuRoot open={open} defaultOpen={defaultOpen} onOpenChange={onOpenChange} className={className}>
      <DropdownMenuTrigger variant={variant} size={size}>{trigger}</DropdownMenuTrigger>
      <DropdownMenuContent placement={placement}>{children}</DropdownMenuContent>
    </DropdownMenuRoot>
  )
}

/**
 * <DropdownMenu trigger="Options"><MenuItem shortcut="E">Edit</MenuItem>…</DropdownMenu>
 * Opens with click, Enter or ↓; the first item takes focus and the rest stagger in. ↑/↓, Home/End and typeahead move;
 * Tab or moving focus away closes it. Parts: DropdownMenu.Root/Trigger/Content/Item/CheckboxItem/RadioGroup/RadioItem/
 * Label/Separator/Group/Sub/SubTrigger/SubContent/Shortcut.
 */
export const DropdownMenu = Object.assign(DropdownMenuConfig, {
  Root: DropdownMenuRoot, Trigger: DropdownMenuTrigger, Content: DropdownMenuContent, Item: MenuItem, CheckboxItem: MenuCheckboxItem,
  RadioGroup: MenuRadioGroup, RadioItem: MenuRadioItem, Label: MenuLabel, Separator: MenuSeparator, Group: MenuGroup,
  Sub: MenuSub, SubTrigger: MenuSubTrigger, SubContent: MenuSubContent, Shortcut: MenuShortcut,
})

export type ContextMenuEntry =
  | { label: string; icon?: IconName; shortcut?: string; danger?: boolean; onSelect?: () => void; items?: ContextMenuEntry[] }
  | '-'
type CtxAt = { x: number; y: number }

type CtxMenuV = { open: boolean; at: CtxAt | null; openAt: (x: number, y: number) => void; close: (refocus?: boolean) => void; area: RefObject<HTMLElement | null> }
const ContextMenuCtx = createContext<CtxMenuV | null>(null)
const useCtxMenu = (part: string) => { const c = useContext(ContextMenuCtx); if (!c) throw new Error(`<ContextMenu.${part}> must be inside <ContextMenu.Root>`); return c }

/** ContextMenu.Root: state for a menu opened at a point. `onOpenChange` reports it; `open={false}` closes it, `open` opens it mid-area. */
export function ContextMenuRoot({ open: openProp, onOpenChange, children }: { open?: boolean; onOpenChange?: (open: boolean) => void; children: ReactNode }) {
  const [at, setAt] = useState<CtxAt | null>(null)
  const area = useRef<HTMLElement>(null)
  const open = openProp ?? !!at
  const now = useRef(open); now.current = open
  const notify = useRef(onOpenChange); notify.current = onOpenChange
  const openAt = useCallback((x: number, y: number) => { setAt({ x, y }); if (!now.current) notify.current?.(true) }, [])
  const close = useCallback((refocus = false) => {
    setAt(null); if (now.current) notify.current?.(false)
    if (refocus) area.current?.focus({ preventScroll: true })
  }, [])
  useLayoutEffect(() => { // controlled from outside: open mid-area, or forget the point when closed
    if (openProp && !at && area.current) { const r = area.current.getBoundingClientRect(); setAt({ x: r.left + r.width / 2, y: r.top + r.height / 2 }) }
    else if (openProp === false && at) setAt(null)
  }, [openProp]) // eslint-disable-line react-hooks/exhaustive-deps
  const value = useMemo(() => ({ open, at, openAt, close, area }), [open, at, openAt, close])
  return <ContextMenuCtx.Provider value={value}>{children}</ContextMenuCtx.Provider>
}

/**
 * ContextMenu.Trigger: the area that opens the menu on right-click, long-press (touch), or the Menu key / Shift+F10 when
 * focused. A focusable named group (`label`); `children` may be a function of `open`. `asChild` puts it on your element.
 */
export function ContextMenuTrigger({ children, className, label, asChild }:
  { children: ReactNode | ((open: boolean) => ReactNode); className?: string; label?: string } & AsChildProps) {
  const { open, openAt, area } = useCtxMenu('Trigger')
  const inArea = (t: EventTarget) => !!area.current?.contains(t as Node)
  // touch: long-press opens the menu just under the finger (the menu's own events bubble here through the portal, hence inArea)
  const hold = useLongPress({ onPress: ({ x, y }) => { navigator.vibrate?.(10); openAt(x, y + 10) } })
  const fromArea = <E extends { target: EventTarget }>(fn: (e: E) => void) => (e: E) => { if (inArea(e.target)) fn(e) }
  const props = {
    ref: area as RefObject<HTMLDivElement | null>, tabIndex: 0, role: 'group', 'aria-label': label ?? 'Options', 'aria-keyshortcuts': 'Shift+F10 ContextMenu', 'data-state': open ? 'open' : 'closed',
    className: cn('relative select-none outline-none [-webkit-touch-callout:none] focus-visible:ring-2 focus-visible:ring-[var(--accent)]', className),
    onContextMenu: (e: ReactMouseEvent<HTMLElement>) => { if (!inArea(e.target)) return; e.preventDefault(); hold.cancel(); openAt(e.clientX, e.clientY) },
    onPointerDown: fromArea(hold.bind.onPointerDown), onPointerMove: hold.bind.onPointerMove,
    onPointerUp: hold.bind.onPointerUp, onPointerCancel: hold.bind.onPointerCancel, onClickCapture: fromArea(hold.bind.onClickCapture),
    onKeyDown: (e: RKeyboardEvent<HTMLElement>) => {
      if (!inArea(e.target) || open) return
      if (e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10')) {
        e.preventDefault(); const r = e.currentTarget.getBoundingClientRect(); openAt(r.left + r.width / 2, r.top + r.height / 2)
      }
    },
  }
  const body = typeof children === 'function' ? children(open) : children
  if (asChild) return <Slot {...props} ref={area}>{body}</Slot>
  return <div {...props}>{body}</div>
}

/**
 * ContextMenu.Content: the menu, at the pointer (portalled, kept inside the viewport). Focuses its first item; ↑/↓,
 * Home/End and typeahead move; Escape, Tab, an outside click, scroll or resize close it.
 */
export function ContextMenuContent({ children, className, 'aria-label': ariaLabel }: { children: ReactNode; className?: string; 'aria-label'?: string }) {
  const { open, at, close } = useCtxMenu('Content')
  const panel = useRef<HTMLDivElement>(null), keys = useMenuKeys()
  const [place, setPlace] = useState<{ left: number; top: number; onLeft: boolean } | null>(null)
  useOutside([panel], () => close(), open)
  useEffect(() => {
    if (!open) return
    const off = () => close()
    addEventListener('scroll', off, { capture: true, passive: true }); addEventListener('resize', off)
    return () => { removeEventListener('scroll', off, { capture: true }); removeEventListener('resize', off) }
  }, [open, close])
  useLayoutEffect(() => {
    const el = panel.current
    if (!open || !at || !el) { setPlace(null); return }
    const w = el.offsetWidth, h = el.offsetHeight
    const onLeft = at.x + w > innerWidth - 8
    const left = Math.max(8, Math.min(innerWidth - w - 8, onLeft ? at.x - w : at.x))
    setPlace({ left, top: Math.max(8, Math.min(at.y, innerHeight - h - 8)), onLeft })
  }, [open, at?.x, at?.y]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!open || !at) return
    const r = requestAnimationFrame(() => menuItemsOf(panel.current)[0]?.focus({ preventScroll: true }))
    return () => cancelAnimationFrame(r)
  }, [open, at])
  const menu = useMemo<MenuCtxV>(() => ({ close }), [close])
  return (
    <OverlayPortal>
      <MenuCtx.Provider value={menu}>
        <AnimatePresence>
          {open && at && (
            <motion.div key="menu" ref={panel} role="menu" aria-label={ariaLabel} data-menu-list variants={ctxPanelVariants} initial="hidden" animate="show"
              exit={{ opacity: 0, scale: 0.97, transition: { duration: 0.1 } }}

              style={{ left: place?.left ?? at.x, top: place?.top ?? at.y, visibility: place ? 'visible' : 'hidden' }}
              className={cn(surface.floating, 'fixed z-[85] min-w-[200px] p-1', place?.onLeft ? 'origin-top-right' : 'origin-top-left', className)}
              onContextMenu={e => { e.preventDefault(); e.stopPropagation() }}
              onKeyDown={e => {
                e.stopPropagation()
                if (e.key === 'Escape' || e.key === 'Tab') { e.preventDefault(); close(true); return }
                keys(e)
              }}>
              {children}
            </motion.div>
          )}
        </AnimatePresence>
      </MenuCtx.Provider>
    </OverlayPortal>
  )
}

/** Config entries → parts. */
function ctxEntries(entries: ContextMenuEntry[]): ReactNode {
  return entries.map((it, j) => it === '-' ? <MenuSeparator key={`sep${j}`} /> : it.items ? (
    <MenuSub key={it.label}>
      <MenuSubTrigger icon={it.icon}>{it.label}</MenuSubTrigger>
      <MenuSubContent aria-label={it.label}>{ctxEntries(it.items)}</MenuSubContent>
    </MenuSub>
  ) : (
    <MenuItem key={it.label} icon={it.icon} danger={it.danger} onSelect={() => it.onSelect?.()}>{it.label}{it.shortcut && <MenuShortcut>{it.shortcut}</MenuShortcut>}</MenuItem>
  ))
}

function ContextMenuConfig({ items, children, className, label: labelProp, onOpenChange }:
  { items: ContextMenuEntry[]; children: ReactNode | ((open: boolean) => ReactNode); className?: string; label?: string; onOpenChange?: (open: boolean) => void }) {
  const label = labelProp ?? 'Options'
  return (
    <ContextMenuRoot onOpenChange={onOpenChange}>
      <ContextMenuTrigger className={className} label={label}>{children}</ContextMenuTrigger>
      <ContextMenuContent aria-label={label}>{ctxEntries(items)}</ContextMenuContent>
    </ContextMenuRoot>
  )
}

/**
 * Right-click, long-press (touch) or press the Menu key / Shift+F10 on the focused area to open a menu
 * at that point. Items can have submenus (→ opens, ← closes). The menu stays inside the
 * viewport, focuses its first item, and closes on Escape, outside click, scroll or resize.
 * `children` may be a function of `open` so the target can highlight itself. Parts: ContextMenu.Root/Trigger/Content plus
 * the menu item parts (Item, CheckboxItem, RadioGroup, RadioItem, Label, Separator, Group, Sub, SubTrigger, SubContent, Shortcut).
 */
export const ContextMenu = Object.assign(ContextMenuConfig, {
  Root: ContextMenuRoot, Trigger: ContextMenuTrigger, Content: ContextMenuContent, Item: MenuItem, CheckboxItem: MenuCheckboxItem,
  RadioGroup: MenuRadioGroup, RadioItem: MenuRadioItem, Label: MenuLabel, Separator: MenuSeparator, Group: MenuGroup,
  Sub: MenuSub, SubTrigger: MenuSubTrigger, SubContent: MenuSubContent, Shortcut: MenuShortcut,
})

/**
 * Open state for hover UI that also works by touch: mouse and pen hover (after `openDelay`, closing `closeDelay` ms after
 * leaving), keyboard focus, and a tap on the trigger (spread `tap`) toggles it. Spread `bind` on the wrapper. A tap anywhere
 * outside `ref` closes it; `touchHide` ms auto-hides a tapped one. `control` makes it controlled (`open` + `onOpenChange`)
 * or sets `defaultOpen`. Returns { open, setOpen, bind, tap }.
 */
export function useHoverIntent(ref: RefObject<HTMLElement | null>, openDelay = 300, closeDelay = 100, touchHide = 0,
  control: { open?: boolean; defaultOpen?: boolean; onOpenChange?: (open: boolean) => void } = {}) {
  const [inner, setInner] = useState(control.defaultOpen ?? false)
  const controlled = control.open !== undefined
  const open = controlled ? !!control.open : inner
  const t = useRef<ReturnType<typeof setTimeout>>(undefined), tapAt = useRef(0), isOpen = useRef(open)
  isOpen.current = open
  const notify = useRef(control.onOpenChange); notify.current = control.onOpenChange
  const setOpen = useCallback((v: boolean) => {
    if (v === isOpen.current) return
    isOpen.current = v
    if (!controlled) setInner(v)
    notify.current?.(v)
  }, [controlled])
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
function tipFixed(r: DOMRect, p: Placement, offset?: number) {
  const s = floatSideOf(p)
  if (s === 'right') return { left: r.right + (offset ?? 8), top: r.top + r.height / 2, transform: 'translateY(-50%)' }
  if (s === 'left') return { left: r.left - (offset ?? 8), top: r.top + r.height / 2, transform: 'translate(-100%,-50%)' }
  if (s === 'bottom') return { left: r.left + r.width / 2, top: r.bottom + (offset ?? 6), transform: 'translateX(-50%)' }
  return { left: r.left + r.width / 2, top: r.top - (offset ?? 8), transform: 'translate(-50%,-100%)' }
}

type TipCtxV = { shown: boolean; id: string; wrap: RefObject<HTMLSpanElement | null> }
const TipCtx = createContext<TipCtxV | null>(null)
const useTip = (part: string) => { const c = useContext(TipCtx); if (!c) throw new Error(`<Tooltip.${part}> must be inside <Tooltip.Root>`); return c }

/**
 * Tooltip.Root: wraps a Trigger and a Content in an inline box that listens for hover (after `delay` ms), keyboard focus
 * and taps. `open` + `onOpenChange` or `defaultOpen`; `disabled` turns it off. Escape hides it.
 */
export function TooltipRoot({ open, defaultOpen, onOpenChange, delay = 400, disabled, children, className, describeSelf }:
  { open?: boolean; defaultOpen?: boolean; onOpenChange?: (open: boolean) => void; delay?: number; disabled?: boolean; children: ReactNode; className?: string
    /** the wrapper itself gets aria-describedby (when the trigger isn't a single element) */ describeSelf?: boolean }) {
  const ref = useRef<HTMLSpanElement>(null)
  const { open: o, setOpen, bind, tap } = useHoverIntent(ref, delay, 0, 2500, { open, defaultOpen, onOpenChange })
  const id = useId(), shown = o && !disabled
  const value = useMemo(() => ({ shown, id, wrap: ref }), [shown, id])
  return (
    <TipCtx.Provider value={value}>
      <span ref={ref} className={cn('relative inline-flex', className)} {...bind} {...tap} aria-describedby={describeSelf && shown ? id : undefined}
        onKeyDown={e => { if (e.key === 'Escape' && shown) { e.stopPropagation(); setOpen(false) } }}>
        {children}
      </span>
    </TipCtx.Provider>
  )
}
/** Tooltip.Trigger: gets aria-describedby while the tip shows. A plain button, or `asChild` for your own element. */
export function TooltipTrigger({ asChild, children, className, ...p }: HTMLAttributes<HTMLButtonElement> & AsChildProps & { ref?: Ref<HTMLButtonElement> }) {
  const { shown, id } = useTip('Trigger')
  if (asChild) return <Slot aria-describedby={shown ? id : undefined} {...p}>{children}</Slot>
  return <button type="button" aria-describedby={shown ? id : undefined} className={cn('inline-flex cursor-default items-center border-0 bg-transparent p-0 text-inherit', className)} {...p}>{children}</button>
}
/**
 * Tooltip.Content: the tip (role=tooltip). `side`/`align`/`sideOffset` (or `placement`), `arrow`, and `portal` to render it
 * in a fixed layer that escapes `overflow: hidden` parents.
 */
export function TooltipContent({ side, align, sideOffset, placement, arrow, portal, className, children }: FloatProps & { portal?: boolean; className?: string; children: ReactNode }) {
  const { shown, id, wrap } = useTip('Content')
  const p = floatPlacement(side, align, placement ?? 'top-center'), s = floatSideOf(p)
  const [rect, setRect] = useState<DOMRect | null>(null)
  useLayoutEffect(() => { if (shown && portal && wrap.current) setRect(wrap.current.getBoundingClientRect()) }, [shown, portal, wrap])
  const x = s === 'right' ? -4 : s === 'left' ? 4 : 0, y = x ? 0 : s === 'bottom' ? -3 : 3
  const tip = (
    <motion.span id={id} role="tooltip" initial={{ opacity: 0, x, y }} animate={{ opacity: 1, x: 0, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.12 }} className={cn(tipClass, arrow && 'relative', className)}>
      {children}{arrow && <span aria-hidden className={cn('absolute h-2 w-2 rotate-45 bg-[var(--primary)]', floatArrowClass(p, 'tip', portal))} />}
    </motion.span>
  )
  return portal ? (
    <OverlayPortal>
      <AnimatePresence>
        {shown && rect && <span className="pointer-events-none fixed z-[90]" style={tipFixed(rect, p, sideOffset)}>{tip}</span>}
      </AnimatePresence>
    </OverlayPortal>
  ) : (
    <AnimatePresence>
      {shown && <span className={cn('pointer-events-none absolute z-50', SIDE[p])} style={floatGap(p, sideOffset)}>{tip}</span>}
    </AnimatePresence>
  )
}

function TooltipConfig({ content, children, placement = 'top-center', delay = 400, portal, disabled, className }:
  { content: ReactNode; children: ReactNode; placement?: Placement; delay?: number; portal?: boolean; disabled?: boolean; className?: string }) {
  const el = isValidElement(children) && children.type !== Fragment ? children : null
  return (
    <TooltipRoot delay={delay} disabled={disabled} className={className} describeSelf={!el}>
      {el ? <TooltipTrigger asChild>{el}</TooltipTrigger> : children}
      <TooltipContent placement={placement} portal={portal}>{content}</TooltipContent>
    </TooltipRoot>
  )
}

/**
 * Short delay, quick fade. Wrap the element that should show it. Shows on hover or keyboard focus; on touch a tap
 * shows it (another tap, a tap elsewhere or 2.5 s hides it). `portal` renders it in a fixed layer
 * so it escapes `overflow: hidden` parents (collapsed sidebars, scroll areas); `disabled` turns it off.
 * The trigger (a single element child) gets `aria-describedby` while the tip shows, so screen readers announce it.
 * Parts: Tooltip.Root (open state, delay) / Tooltip.Trigger (asChild) / Tooltip.Content (side, align, sideOffset, arrow, portal).
 */
export const Tooltip = Object.assign(TooltipConfig, { Root: TooltipRoot, Trigger: TooltipTrigger, Content: TooltipContent })

type HoverCardCtxV = { shown: boolean; setOpen: (v: boolean) => void; pinned: boolean; setPinned: (v: boolean) => void; pinOnClick?: boolean
  tap: { onPointerUp: (e: ReactPointerEvent) => void }; lastPointer: RefObject<string> }
const HoverCardCtx = createContext<HoverCardCtxV | null>(null)
const useHoverCard = (part: string) => { const c = useContext(HoverCardCtx); if (!c) throw new Error(`<HoverCard.${part}> must be inside <HoverCard.Root>`); return c }

/**
 * HoverCard.Root: hover/focus/tap state in an inline box (`openDelay`, `closeDelay`; `open` + `onOpenChange` or
 * `defaultOpen`). With `pinOnClick`, a mouse click on the trigger pins the card open until another click, an outside click or Escape.
 */
export function HoverCardRoot({ open, defaultOpen, onOpenChange, openDelay = 300, closeDelay = 150, pinOnClick, className, children }:
  { open?: boolean; defaultOpen?: boolean; onOpenChange?: (open: boolean) => void; openDelay?: number; closeDelay?: number; pinOnClick?: boolean; className?: string; children: ReactNode }) {
  const ref = useRef<HTMLSpanElement>(null)
  const { open: o, setOpen, bind, tap } = useHoverIntent(ref, openDelay, closeDelay, 0, { open, defaultOpen, onOpenChange })
  const [pinned, setPinned] = useState(false)
  const lastPointer = useRef('mouse')
  const shown = o || pinned
  useOutside([ref], () => { setPinned(false); setOpen(false) }, pinned, { escape: true })
  return (
    <HoverCardCtx.Provider value={{ shown, setOpen, pinned, setPinned, pinOnClick, tap, lastPointer }}>
      <span ref={ref} className={cn('relative inline-block', className)} {...bind} onKeyDown={e => { if (e.key === 'Escape' && shown) { e.stopPropagation(); setPinned(false); setOpen(false) } }}>
        {children}
      </span>
    </HoverCardCtx.Provider>
  )
}
/** HoverCard.Trigger: what you hover (a link, a name). Wraps its children, or with `asChild` becomes your element. */
export function HoverCardTrigger({ children, asChild }: { children: ReactNode } & AsChildProps) {
  const c = useHoverCard('Trigger')
  const props = {
    ...c.tap, onPointerDown: (e: ReactPointerEvent) => { c.lastPointer.current = e.pointerType },
    onClick: () => { if (!c.pinOnClick || c.lastPointer.current === 'touch') return; const next = !c.pinned; c.setPinned(next); c.setOpen(next) },
  }
  return asChild ? <Slot {...props}>{children}</Slot> : <span className="contents" {...props}>{children}</span>
}
/** HoverCard.Content: the card. `side`/`align`/`sideOffset` (or `placement`, default top-start) and `arrow`; it slides to stay on screen. */
export function HoverCardContent({ side, align, sideOffset, placement, arrow, className, children }: FloatProps & { className?: string; children: ReactNode }) {
  const { shown } = useHoverCard('Content')
  return (
    <FloatingPanel open={shown} placement={floatPlacement(side, align, placement ?? 'top-start')} offset={sideOffset} arrow={arrow} role="tooltip"
      className={cn('w-[250px] p-3 text-[13px] leading-snug', className)}>{children}</FloatingPanel>
  )
}

function HoverCardConfig({ trigger, children, placement = 'top-start', pinOnClick, className, triggerClassName }:
  { trigger: ReactNode; children: ReactNode; placement?: Placement; pinOnClick?: boolean; className?: string; triggerClassName?: string }) {
  return (
    <HoverCardRoot pinOnClick={pinOnClick} className={triggerClassName}>
      <HoverCardTrigger>{trigger}</HoverCardTrigger>
      <HoverCardContent placement={placement} className={className}>{children}</HoverCardContent>
    </HoverCardRoot>
  )
}

/**
 * Rich preview on hover or focus (profiles, links, citations). Stays open while the pointer is over the card. On touch,
 * tapping the trigger toggles it and tapping outside closes it. With `pinOnClick`, a mouse click on the trigger pins the
 * card open (leaving no longer closes it) until another click, an outside click or Escape. The card slides to stay on screen.
 * Parts: HoverCard.Root / HoverCard.Trigger (asChild) / HoverCard.Content (side, align, sideOffset, arrow).
 */
export const HoverCard = Object.assign(HoverCardConfig, { Root: HoverCardRoot, Trigger: HoverCardTrigger, Content: HoverCardContent })

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
    <div ref={el} role="tooltip" className={cn(surface.floating, 'pointer-events-none fixed z-[90] w-max max-w-[calc(100vw-16px)] rounded-[var(--r-md)] px-2 py-1.5 text-xs leading-snug text-[var(--fg)] transition-opacity duration-150', className)}

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

/** Renders into the themed `.ui-root` (or body) so fixed layers escape clipping parents. */
export function OverlayPortal({ children }: { children: ReactNode }) {
  const [el, setEl] = useState<Element | null>(null)
  useEffect(() => setEl(document.querySelector('.ui-root') ?? document.body), [])
  return el ? createPortal(children, el) : null
}

/**
 * Open scroll locks (page-wide: shared by every copy of the library, so locks from different drop-in files nest), and the
 * inline styles the first one replaced, which the last one puts back.
 */
const overlayLock = uiShared('scroll-lock', () => ({ count: 0, saved: null as { overflow: string; side: 'paddingLeft' | 'paddingRight'; pad: string } | null }))
/** Is the page's vertical scrollbar on the left (some browsers put it there under)? */
function overlayScrollbarLeft() {
  const probe = document.createElement('div')
  probe.style.cssText = 'position:fixed;left:0;top:0;width:0;height:0;visibility:hidden'
  document.body.appendChild(probe)
  const left = probe.getBoundingClientRect().left > 0
  probe.remove()
  return left
}
/**
 * Stop the page from scrolling while `active` (modals, lightboxes, full-screen sheets). Every caller on the page (any copy
 * of the library) shares one counter, so nested locks unwind correctly; the last unlock restores the styles the first
 * one replaced. The scrollbar's width is padded on the side it was on.
 */
export function useScrollLock(active: boolean) {
  useEffect(() => {
    if (!active) return
    const root = document.documentElement, body = document.body, s = overlayLock
    if (s.count++ === 0) {
      const w = innerWidth - root.clientWidth, gap = w > 0 && w < 64 ? w : 0 // a classic scrollbar (and not a layout-less test DOM)
      const side = gap > 0 && overlayScrollbarLeft() ? 'paddingLeft' : 'paddingRight'
      s.saved = { overflow: root.style.overflow, side, pad: body.style[side] }
      if (gap > 0) body.style[side]
 = `${(parseFloat(getComputedStyle(body)[side]) || 0) + gap}px`
      root.style.overflow = 'hidden'
    }
    return () => {
      if (--s.count > 0 || !s.saved) return
      root.style.overflow = s.saved.overflow; body.style[s.saved.side] = s.saved.pad; s.saved = null
    }
  }, [active])
}

/** Open modal layers, innermost last (page-wide, see uiShared). Only the top one handles Escape and keeps the rest of the page inert. */
const overlayModals = uiShared('modal-stack', () => [] as HTMLElement[])
const overlayInerted = uiShared('modal-inerted', () => [] as HTMLElement[])
/**
 * Make everything outside the top modal `inert` (not focusable, clickable or read by screen readers): every sibling of
 * the modal and of each of its ancestors up to <body>. Elements that were already inert are left alone, and so is
 * anything marked `data-modal-keep` (the toast region). Called whenever the stack changes, so nesting unwinds.
 */
function overlaySyncInert() {
  for (const el of overlayInerted) el.inert = false
  overlayInerted.length = 0
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
 * Escape and outside click to close (`onOutsideClick` overrides the click), and exit animations for whatever you render inside. While open the rest of
 * the page is `inert`, and Escape and Tab are handled at document level, so they work even when focus is outside the
 * panel. Nested modals stack: only the top one closes on Escape, and closing it hands the page back to the one below.
 */
export function ModalLayer({ open, onClose, onOutsideClick, children }: { open: boolean; onClose: () => void
  /** a click on the backdrop calls this instead of closing (AlertDialog: shake, don't dismiss) */ onOutsideClick?: () => void; children: ReactNode }) {
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
              transition={{ duration: 0.2 }} onClick={onOutsideClick ?? onClose} aria-hidden />
            {children}
          </div>
        )}
      </AnimatePresence>
    </OverlayPortal>
  )
}

type ModalProps = { open: boolean; onOpenChange: (v: boolean) => void }

/* Dialog, Sheet and AlertDialog parts share one Root context ─ */

type DialogPart = 'title' | 'desc'
type DialogCtxV = { open: boolean; setOpen: (v: boolean) => void; ids: Record<DialogPart, string>; parts: Record<DialogPart, boolean>; setPart: (k: DialogPart, on: boolean) => void }
const DialogCtx = createContext<DialogCtxV | null>(null)
/** Which panel the Title/Description/Footer parts are in: they keep that panel's spacing. */
const DialogKindCtx = createContext<'dialog' | 'sheet' | 'alert'>('dialog')
const useDialogCtx = (part: string) => { const c = useContext(DialogCtx); if (!c) throw new Error(`<${part}> must be inside <Dialog.Root>, <Sheet.Root> or <AlertDialog.Root>`); return c }

/** Dialog.Root (also Sheet.Root and AlertDialog.Root): the open state, `open` + `onOpenChange` or `defaultOpen`. Renders no element. */
export function DialogRoot({ open, defaultOpen = false, onOpenChange, children }: { open?: boolean; defaultOpen?: boolean; onOpenChange?: (open: boolean) => void; children: ReactNode }) {
  const [o, setO] = useControllable(open, defaultOpen, onOpenChange)
  const base = useId()
  const [parts, setParts] = useState<Record<DialogPart, boolean>>({ title: false, desc: false })
  const setPart = useCallback((k: DialogPart, on: boolean) => setParts(p => p[k] === on ? p : { ...p, [k]: on }), [])
  const value = useMemo(() => ({ open: o, setOpen: setO, ids: { title: `${base}-t`, desc: `${base}-d` }, parts, setPart }), [o, setO, base, parts, setPart])

  return <DialogCtx.Provider value={value}>{children}</DialogCtx.Provider>
}
/** Dialog.Trigger: opens it (aria-haspopup=dialog); focus comes back here on close. Button props, or `asChild`. */
export function DialogTrigger({ children, ...p }: ButtonProps) {
  const { open, setOpen } = useDialogCtx('Dialog.Trigger')
  return <OverlayPartButton aria-haspopup="dialog" aria-expanded={open} {...p} action={() => setOpen(true)}>{children}</OverlayPartButton>
}
const DIALOG_X = <svg width={15} height={15} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" aria-hidden><path d="M18 6 6 18M6 6l12 12" /></svg>
/** Dialog.Close: closes it. With no children it is the ✕ icon button ("Close"); otherwise a Button, or `asChild`. */
export function DialogClose({ children, ...p }: ButtonProps) {
  const { setOpen } = useDialogCtx('Dialog.Close')
  if (children === undefined && !p.asChild) {
    const { onClick, ...rest } = p
    return <IconButton icon={DIALOG_X} label="Close" {...rest} onPointerDown={e => e.stopPropagation()} onClick={e => { onClick?.(e); if (!e.defaultPrevented) setOpen(false) }} />
  }
  return <OverlayPartButton {...p} action={() => setOpen(false)}>{children}</OverlayPartButton>
}
/** Register a Title or Description while it is mounted, so the panel only points aria-labelledby/-describedby at ids that exist. */
function useDialogPart(k: DialogPart, part: string) {
  const c = useDialogCtx(part), set = c.setPart
  useLayoutEffect(() => { set(k, true); return () => set(k, false) }, [k, set])
  return c.ids[k]
}
/** Dialog.Title: the heading that names the panel (aria-labelledby). */
export function DialogTitle({ className, children, ...p }: HTMLAttributes<HTMLHeadingElement>) {
  const id = useDialogPart('title', 'Dialog.Title'), kind = useContext(DialogKindCtx)
  return <h2 id={id} className={cn('m-0 text-base font-semibold', kind !== 'sheet' && 'mb-1.5', className)} {...p}>{children}</h2>
}
/** Dialog.Description: the text that describes the panel (aria-describedby). */
export function DialogDescription({ className, children, ...p }: HTMLAttributes<HTMLElement>) {
  const id = useDialogPart('desc', 'Dialog.Description'), kind = useContext(DialogKindCtx)
  const cls = cn('m-0 text-[13px] text-[var(--fg2)]', kind === 'dialog' && 'mb-4', className)
  return kind === 'alert' ? <div id={id} className={cls} {...p}>{children}</div> : <p id={id} className={cls} {...p}>{children}</p>
}
/** Dialog.Footer: the action row (right-aligned, wraps on small screens). In an AlertDialog it also shows a failed confirm's error. */
export function DialogFooter({ className, children, ...p }: HTMLAttributes<HTMLDivElement>) {
  const kind = useContext(DialogKindCtx), alert = useContext(AlertCtx)
  const row = <div className={cn('flex flex-wrap justify-end gap-2', kind === 'sheet' ? 'flex-none' : 'mt-4', className)} {...p}>{children}</div>
  if (kind !== 'alert') return row
  return (
    <>
      <AnimatePresence initial={false}>
        {alert?.err && (
          <motion.p key="err" role="alert" initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} transition={{ duration: 0.18 }}
            className="m-0 mt-3 flex items-start gap-1.5 overflow-hidden text-[13px] text-[var(--bad)]"><Icon name="alert" size={14} className="mt-0.5 flex-none" />{alert.err}</motion.p>
        )}
      </AnimatePresence>
      {row}
    </>
  )
}

const dialogFrame = 'pointer-events-none fixed inset-0 z-[71] grid place-items-center px-[max(16px,env(safe-area-inset-left),env(safe-area-inset-right))] pt-[max(16px,env(safe-area-inset-top))] pb-[max(16px,env(safe-area-inset-bottom))]'
const dialogPanel = 'pointer-events-auto max-h-full w-full max-w-[420px] overflow-auto overscroll-contain rounded-[var(--r-lg)] border border-[var(--line)] bg-[var(--card)] p-5 shadow-[var(--shadow)]'
const dialogMotion = { initial: { opacity: 0, scale: 0.94, y: 8 }, animate: { opacity: 1, scale: 1, y: 0 }, exit: { opacity: 0, scale: 0.96, transition: { duration: 0.15 } }, transition: spring(0.3, 0.4) }

/**
 * Dialog.Content: the modal panel (role=dialog, aria-modal) in a ModalLayer: springs in, backdrop fades, focus is trapped,
 * Escape and an outside click close it. Fits small screens: keeps clear of the safe areas and scrolls inside when tall.
 */
export function DialogContent({ className, children, 'aria-label': ariaLabel }: { className?: string; children: ReactNode; 'aria-label'?: string }) {
  const { open, setOpen, ids, parts } = useDialogCtx('Dialog.Content')
  return (
    <ModalLayer open={open} onClose={() => setOpen(false)}>
      <div className={dialogFrame}>
        <motion.div role="dialog" aria-modal="true" aria-label={ariaLabel} aria-labelledby={!ariaLabel && parts.title ? ids.title : undefined} aria-describedby={parts.desc ? ids.desc : undefined}
          {...dialogMotion} className={cn(dialogPanel, className)}>
          <DialogKindCtx.Provider value="dialog">{children}</DialogKindCtx.Provider>
        </motion.div>
      </div>
    </ModalLayer>
  )
}

function DialogConfig({ open, onOpenChange, title, description, children, footer, className }:
  ModalProps & { title: ReactNode; description?: ReactNode; children?: ReactNode; footer?: ReactNode; className?: string }) {
  return (
    <DialogRoot open={open} onOpenChange={onOpenChange}>
      <DialogContent className={className}>
        <DialogTitle>{title}</DialogTitle>
        {description && <DialogDescription>{description}</DialogDescription>}
        {children}
        {footer && <DialogFooter>{footer}</DialogFooter>}
      </DialogContent>
    </DialogRoot>
  )
}

/**
 * Modal dialog. Springs in, backdrop fades, focus is trapped, Escape closes. Fits small screens: keeps clear of the safe
 * areas, scrolls inside when taller than the screen, and the footer wraps.
 * Parts: Dialog.Root / Trigger (asChild) / Content / Title / Description / Close (asChild) / Footer.
 */
export const Dialog = Object.assign(DialogConfig, {
  Root: DialogRoot, Trigger: DialogTrigger, Content: DialogContent, Title: DialogTitle, Description: DialogDescription, Close: DialogClose, Footer: DialogFooter,
})

/* Sheet ─ */

// physical edges; `start`/`end` resolve to one of these from the direction
const SHEET = {
  right: { cls: 'top-0 right-0 bottom-0 w-[min(380px,92vw)] pt-[max(20px,env(safe-area-inset-top))] pb-[max(20px,env(safe-area-inset-bottom))]', off: { x: '100%' } },
  left: { cls: 'top-0 left-0 bottom-0 w-[min(380px,92vw)] pt-[max(20px,env(safe-area-inset-top))] pb-[max(20px,env(safe-area-inset-bottom))]', off: { x: '-100%' } },
  bottom: { cls: 'inset-x-0 bottom-0 max-h-[85dvh] rounded-t-[var(--r-lg)] !pt-2 pb-[max(20px,env(safe-area-inset-bottom))]', off: { y: '100%' } },
}
/** The edge a Sheet slides in from (`start` = left, `end` = right); `bottom` is a bottom sheet. */
export type SheetSide = 'start' | 'end' | 'left' | 'right' | 'bottom'
const sheetEdge = (side: SheetSide): keyof typeof SHEET => side === 'start' ? 'left' : side === 'end' ? 'right' : side
/** Below this width a left or right Sheet opens as a bottom sheet instead. */
const SHEET_BOTTOM_BELOW = 640
type SheetGrab = { onPointerDown: (e: ReactPointerEvent) => void; className: string } | null
const SheetGrabCtx = createContext<SheetGrab>(null)

/**
 * Sheet.Content: the panel that slides in from `side` (default `end`: the right, or the left; `start`, or the
 * physical `left`/`right`, or `bottom`). Below 640px a side sheet becomes a bottom sheet (`responsive={false}` keeps the
 * edge drawer). A bottom sheet has a grab handle: drag it, or the Sheet.Header, down to dismiss.
 */
export function SheetContent({ side = 'end', responsive = true, className, children, 'aria-label': ariaLabel }:
  { side?: SheetSide; responsive?: boolean; className?: string; children: ReactNode; 'aria-label'?: string }) {
  const { open, setOpen, ids, parts } = useDialogCtx('Sheet.Content')
  const narrow = useMediaQuery(`(max-width: ${SHEET_BOTTOM_BELOW - 1}px)`)
  const edge = responsive && narrow ? 'bottom' : sheetEdge(side)

  const { cls, off } = SHEET[edge]
  const drag = useDragControls()
  const bottom = edge === 'bottom'
  const grab = useMemo<SheetGrab>(() => bottom ? { onPointerDown: (e: ReactPointerEvent) => drag.start(e), className: 'touch-none' } : null, [bottom, drag])
  return (
    <ModalLayer open={open} onClose={() => setOpen(false)}>
      <motion.div key={edge} data-side={edge} role="dialog" aria-modal="true" aria-label={ariaLabel}
 aria-labelledby={!ariaLabel && parts.title ? ids.title : undefined} aria-describedby={parts.desc ? ids.desc : undefined}
        initial={off} animate={{ x: 0, y: 0 }} exit={off} transition={spring(0.15, 0.4)}
        drag={bottom ? 'y' : false} dragListener={false} dragControls={drag} dragConstraints={{ top: 0, bottom: 0 }} dragElastic={{ top: 0, bottom: 0.9 }}
        onDragEnd={(_, i) => { if (i.offset.y > 90 || i.velocity.y > 500) setOpen(false) }}
        className={cn('fixed z-[71] flex flex-col gap-3 overflow-auto overscroll-contain bg-[var(--card)] px-5 shadow-[var(--shadow)]', cls, className)}>
        {grab && <div aria-hidden {...grab} className="-mx-5 -mb-2 flex flex-none cursor-grab justify-center pt-1 pb-2 touch-none"><span className="h-1 w-9 rounded-full bg-[var(--line2)]" /></div>}
        <DialogKindCtx.Provider value="sheet"><SheetGrabCtx.Provider value={grab}>{children}</SheetGrabCtx.Provider></DialogKindCtx.Provider>
      </motion.div>
    </ModalLayer>
  )
}
/** Sheet.Header: the title row (title at the start, close at the end). On a bottom sheet it is also a drag handle. */
export function SheetHeader({ className, children }: { className?: string; children: ReactNode }) {
  const grab = useContext(SheetGrabCtx)
  return <div className={cn('flex flex-none items-center justify-between', grab?.className, className)} onPointerDown={grab?.onPointerDown}>{children}</div>
}

function SheetConfig({ open, onOpenChange, title, side = 'end', responsive = true, children, footer, className }:
  ModalProps & { title: ReactNode; side?: SheetSide; responsive?: boolean; children: ReactNode; footer?: ReactNode; className?: string }) {
  return (
    <DialogRoot open={open} onOpenChange={onOpenChange}>
      <SheetContent side={side} responsive={responsive} className={className}>
        <SheetHeader><DialogTitle>{title}</DialogTitle><DialogClose /></SheetHeader>
        <div className="flex-1">{children}</div>
        {footer && <DialogFooter>{footer}</DialogFooter>}
      </SheetContent>
    </DialogRoot>
  )
}

/**
 * Panel that slides in from an edge: `side` is `end`, `start`, the physical
 * `left`/`right`, or `bottom`. On screens narrower than 640px a side sheet becomes a bottom sheet
 * (pass `responsive={false}` to keep the edge drawer, e.g. for app navigation). A bottom sheet has a grab handle:
 * drag it (or the header) down to dismiss. Keeps clear of the safe areas.
 * Parts: Sheet.Root / Trigger / Content (side, responsive) / Header / Title / Description / Close / Footer.
 */
export const Sheet = Object.assign(SheetConfig, {
  Root: DialogRoot, Trigger: DialogTrigger, Content: SheetContent, Header: SheetHeader, Title: DialogTitle, Description: DialogDescription, Close: DialogClose, Footer: DialogFooter,
})

type AlertCtxV = { pending: boolean; err: string | null; confirm: (fn: () => void | Promise<unknown>) => void; cancel: () => void }
const AlertCtx = createContext<AlertCtxV | null>(null)
const useAlert = (part: string) => { const c = useContext(AlertCtx); if (!c) throw new Error(`<AlertDialog.${part}> must be inside <AlertDialog.Content>`); return c }

/**
 * AlertDialog.Content: the confirmation panel (role=alertdialog). An outside click doesn't close it (it shakes); Escape
 * and Cancel do (`onCancel` runs). While an Action's promise is pending both buttons wait; a rejection shows its message.
 */
export function AlertDialogContent({ className, children, onCancel }: { className?: string; children: ReactNode; /** Escape or Cancel */ onCancel?: () => void }) {
  const { open, setOpen, ids, parts } = useDialogCtx('AlertDialog.Content')
  const [pending, setPending] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const panel = useRef<HTMLDivElement>(null)
  const alive = useRef(true)
  useEffect(() => { alive.current = true; return () => { alive.current = false } }, [])
  useEffect(() => { if (open) { setErr(null); setPending(false) } }, [open])
  const cancel = () => { if (pending) return; onCancel?.(); setOpen(false) }
  const confirm = async (fn: () => void | Promise<unknown>) => {
    if (pending) return
    setErr(null)
    try {
      const r = fn()
      if (r && typeof (r as Promise<unknown>).then === 'function') { setPending(true); panel.current?.focus({ preventScroll: true }); await r } // the buttons disable while it waits: keep focus in the dialog
      if (!alive.current) return
      setPending(false); setOpen(false)
    } catch (e) {
      if (!alive.current) return
      setPending(false); setErr((e instanceof Error ? e.message : String(e ?? '')) || 'Something went wrong. Try again.')
    }
  }
  return (
    <ModalLayer open={open} onClose={cancel} onOutsideClick={() => shake(panel.current)}>
      <div className={dialogFrame}>
        <motion.div ref={panel} tabIndex={-1} role="alertdialog" aria-modal="true" aria-labelledby={parts.title ? ids.title : undefined} aria-describedby={parts.desc ? ids.desc : undefined} aria-busy={pending || undefined}
          {...dialogMotion} className={cn(dialogPanel, 'outline-none', className)}>
          <DialogKindCtx.Provider value="alert"><AlertCtx.Provider value={{ pending, err, confirm, cancel }}>{children}</AlertCtx.Provider></DialogKindCtx.Provider>
        </motion.div>
      </div>
    </ModalLayer>
  )
}
/** AlertDialog.Cancel (also .Close): the least destructive action; takes focus when the dialog opens. Button props, or `asChild`. */
export function AlertDialogCancel({ children, ...p }: ButtonProps) {
  const a = useAlert('Cancel')
  return <OverlayPartButton data-autofocus disabled={a.pending} {...p} action={a.cancel}>{children ?? 'Cancel'}</OverlayPartButton>
}
/** AlertDialog.Action: confirms. `onConfirm` may return a promise: the button spins until it settles, then the dialog closes (or shows the error). */
export function AlertDialogAction({ children, tone = 'danger', onConfirm, variant, ...p }: ButtonProps & { tone?: 'danger' | 'default'; onConfirm?: () => void | Promise<unknown> }) {
  const a = useAlert('Action')
  return <OverlayPartButton variant={variant ?? (tone === 'danger' ? 'danger' : 'primary')} loading={a.pending} {...p} action={() => a.confirm(onConfirm ?? (() => {}))}>{children ?? 'Continue'}</OverlayPartButton>
}

function AlertDialogConfig({ open, onOpenChange, title, description, confirmLabel, cancelLabel, tone = 'danger', onConfirm, onCancel, children, className }:
  ModalProps & { title: ReactNode; description: ReactNode; confirmLabel?: ReactNode; cancelLabel?: ReactNode
    /** danger: red confirm button (deleting, revoking); default: primary */ tone?: 'danger' | 'default'
    onConfirm: () => void | Promise<unknown>; onCancel?: () => void; children?: ReactNode; className?: string }) {
  return (
    <DialogRoot open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent className={className} onCancel={onCancel}>
        <DialogTitle>{title}</DialogTitle>
        <DialogDescription>{description}</DialogDescription>
        {children && <div className="mt-4">{children}</div>}
        <DialogFooter><AlertDialogCancel>{cancelLabel}</AlertDialogCancel><AlertDialogAction tone={tone} onConfirm={onConfirm}>{confirmLabel}</AlertDialogAction></DialogFooter>
      </AlertDialogContent>
    </DialogRoot>
  )
}

/**
 * Confirmation for a consequential action (role="alertdialog"). It needs a `title` and a `description`, never closes
 * on an outside click (the panel shakes instead), and opens with focus on the least destructive action, Cancel.
 * Escape or Cancel close it. `onConfirm` may return a promise: Confirm then shows a spinner and both buttons wait;
 * it closes when the promise resolves, and stays open with the error's message (announced) when it rejects.
 * Parts: AlertDialog.Root / Trigger / Content / Title / Description / Footer / Cancel (= Close) / Action.
 */
export const AlertDialog = Object.assign(AlertDialogConfig, {
  Root: DialogRoot, Trigger: DialogTrigger, Content: AlertDialogContent, Title: DialogTitle, Description: DialogDescription, Footer: DialogFooter,
  Cancel: AlertDialogCancel, Action: AlertDialogAction, Close: AlertDialogCancel,
})

/** Loads palette entries for a query. Abort when `signal` fires (the query changed or the palette closed). */
export type CommandLoader = (query: string, options: { signal: AbortSignal }) => Promise<Command[]>
/**
 * A palette entry. `keywords` are extra search terms (content tags, synonyms); `hint` is a short secondary label shown
 * after the name (and searched too). An entry with `children` (or `loadChildren`) opens a nested page instead of running:
 * Enter pushes it, Backspace in the empty search box goes back.
 */
export type Command = {
  id: string; label: string; group?: string; icon?: IconName; shortcut?: string; keywords?: string[] | string; hint?: string
  run?: () => void
  /** a nested page of entries */ children?: Command[]
  /** a nested page whose entries come from your API, per query (debounced, aborted when superseded) */ loadChildren?: CommandLoader
  /** search placeholder on its nested page */ placeholder?: string
}

const cmdkWords = (k: Command['keywords']) => (Array.isArray(k) ? k : k ? k.split(/\s*[|,]\s*/) : []).filter(Boolean)
type CmdkHit = { c: Command; labelHit: boolean; tags: string[]; recent?: boolean }
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
/** The group key of the Recent entries (shown as "Recent"). */
const CMDK_RECENT = '\u0000recent'
const cmdkGroup = (h: CmdkHit | undefined) => h ? (h.recent ? CMDK_RECENT : h.c.group ?? '') : undefined
const cmdkFlatten = (cs: Command[]): Command[] => cs.flatMap(c => [c, ...cmdkFlatten(c.children ?? [])])
/** Result lists longer than this are virtualised. */
const CMDK_VIRTUAL_AT = 60

/**
 * ⌘K palette: type to filter (every word must match the label, keywords or hint), arrows to move, Enter to run.
 * Groups keep together under their headings. Shows which keyword matched, marks the active row with ↵, and suggests
 * a query when nothing matches. `loadItems(query, { signal })` adds results from your API (debounced by `debounce` ms,
 * the previous request aborted, a spinner while loading, errors shown). Entries with `children` / `loadChildren` open
 * nested pages (Enter in, Backspace on an empty search out, or click the breadcrumb). `recents` keeps the last N
 * entries run as a Recent group (persisted under `recentKey`). Long result lists are virtualised.
 */
export function CommandPalette({ open, onOpenChange, commands, placeholder, suggestion, loadItems, debounce = 150, recents = 0, recentKey, className }:
  ModalProps & { commands: Command[]; placeholder?: string; suggestion?: string; loadItems?: CommandLoader; /** ms */ debounce?: number
    /** how many recently run entries to offer when the search is empty (0: none) */ recents?: number; /** localStorage key for recents */ recentKey?: string; className?: string }) {
  const [q, setQ] = useState('')
  const [stack, setStack] = useState<{ c: Command; q: string }[]>([])
  const uid = useId()
  const groupLabel = (g: string) => g === CMDK_RECENT ? 'Recent' : g
  useEffect(() => { if (open) { setQ(''); setStack([]) } }, [open])
  const top = stack[stack.length - 1]?.c
  const pageKey = stack.map(s => s.c.id).join('/')
  const pageCommands = top ? top.children ?? [] : commands
  const loader = top ? top.loadChildren : loadItems
  const loaderRef = useRef(loader); loaderRef.current = loader

  /* async results: debounced, the previous request aborted */
  const [found, setFound] = useState<{ page: string; q: string; items: Command[]; loading: boolean; error: string }>({ page: '', q: '', items: [], loading: false, error: '' })
  useEffect(() => {
    if (!open || !loaderRef.current) return
    const ctl = new AbortController(), page = pageKey
    setFound(f => ({ ...f, loading: true, error: '' }))
    const t = setTimeout(() => {
      loaderRef.current?.(q, { signal: ctl.signal }).then(
        items => { if (!ctl.signal.aborted) setFound({ page, q, items, loading: false, error: '' }) },
        (e: unknown) => { if (!ctl.signal.aborted) setFound({ page, q, items: [], loading: false, error: (e instanceof Error && e.message) || 'Couldn’t load results' }) })
    }, debounce)
    return () => { clearTimeout(t); ctl.abort() }
  }, [open, q, pageKey, debounce, !!loader]) // eslint-disable-line react-hooks/exhaustive-deps
  const asyncOn = !!loader
  const loading = asyncOn && found.loading
  const asyncItems = asyncOn && found.page === pageKey && found.q === q ? found.items : [] // never show results for another query

  /* recents */
  const [recent, setRecent] = useState<Command[]>([])
  useEffect(() => {
    if (!recents || !recentKey) return
    try {
      const ids: unknown = JSON.parse(localStorage.getItem(recentKey) ?? '[]'), all = cmdkFlatten(commands)
      if (Array.isArray(ids)) setRecent(ids.map(id => all.find(c => c.id === id)).filter((c): c is Command => !!c).slice(0, recents))
    } catch { /* storage blocked or junk: no recents */ }
  }, [recentKey, recents]) // eslint-disable-line react-hooks/exhaustive-deps
  const remember = (c: Command) => {
    if (!recents) return
    const next = [c, ...recent.filter(x => x.id !== c.id)].slice(0, recents)
    setRecent(next)
    if (recentKey) try { localStorage.setItem(recentKey, JSON.stringify(next.map(x => x.id))) } catch { /* ignore */ }
  }

  const list = useMemo((): CmdkHit[] => {
    const showRecent = !stack.length && !q.trim() && recents > 0
    const r: CmdkHit[] = showRecent ? recent.map(c => ({ c, labelHit: false, tags: [], recent: true })) : []
    return [...r, ...cmdkFilter(pageCommands, q), ...asyncItems.map((c): CmdkHit => ({ c, labelHit: false, tags: [] }))]
  }, [pageCommands, q, asyncItems, recent, stack.length, recents])
  const words = q.toLowerCase().trim().split(/\s+/).filter(Boolean)
  const choose = (i: number) => {
    const h = list[i]; if (!h) return
    const c = h.c
    if (c.children || c.loadChildren) { setStack(s => [...s, { c, q }]); setQ(''); return }
    remember(c)
    onOpenChange(false); setTimeout(() => c.run?.(), 160)
  }
  const back = (to = stack.length - 1) => { if (to < 0 || to >= stack.length) return; setQ(stack[to].q); setStack(s => s.slice(0, to)) }
  const { active, setActive, onKeyDown } = useRoving(list.length, choose, { homeEnd: false })
  useEffect(() => setActive(0), [q, pageKey, setActive])
  const inputRef = useRef<HTMLInputElement>(null)
  useEffect(() => { if (open && stack.length) inputRef.current?.focus() }, [pageKey]) // eslint-disable-line react-hooks/exhaustive-deps

  /* rows: group headings interleaved with entries; virtualised when long */
  const rows = useMemo(() => {
    const out: ({ label: string; hit?: undefined } | { hit: number; label?: undefined })[] = [], at: number[] = []
    list.forEach((h, i) => { const g = cmdkGroup(h); if (g && g !== cmdkGroup(list[i - 1])) out.push({ label: g }); at.push(out.length); out.push({ hit: i }) })
    return { out, at }
  }, [list])
  const coarse = useMediaQuery('(pointer: coarse)')
  const virtualOn = list.length > CMDK_VIRTUAL_AT
  const listRef = useRef<HTMLDivElement>(null)
  const est = useCallback((i: number) => rows.out[i]?.label !== undefined ? 29 : coarse ? 40 : 36, [rows, coarse])
  const keepActive = useMemo(() => rows.at[active] != null ? [rows.at[active]] : undefined, [rows, active])
  const v = useVirtual({ count: rows.out.length, estimateSize: est, scrollRef: listRef, enabled: virtualOn, keep: keepActive, paddingStart: 6, paddingEnd: 6, initialRect: { width: 540, height: 340 } })
  useEffect(() => {
    if (virtualOn) { if (rows.at[active] != null) v.scrollToIndex(rows.at[active], { align: 'auto' }) }
    else listRef.current?.querySelector(`[data-i="${active}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [active, virtualOn]) // eslint-disable-line react-hooks/exhaustive-deps
  const suggest = suggestion ?? (cmdkWords(commands.find(c => cmdkWords(c.keywords).length)?.keywords)[0] ?? commands[0]?.label.split(' ')[0] ?? '').toLowerCase()
  const optionId = (i: number) => `${uid}-o${i}`

  const option = (i: number, style?: CSSProperties) => {
    const { c, tags } = list[i], nested = !!(c.children || c.loadChildren)
    return (
      <button id={optionId(i)} data-i={i} role="option" aria-selected={i === active} aria-haspopup={nested ? 'listbox' : undefined} tabIndex={-1}
        {...(virtualOn ? virtualSetAria(i, list.length) : null)} style={style}
        onPointerMove={() => i !== active && setActive(i)} onClick={() => choose(i)}
        className={cn(menuItemClass, 'relative', words.length ? 'text-[var(--fg2)]' : '', virtualOn && i === active && 'bg-[var(--muted)]')}>
        {!virtualOn && i === active && <motion.span layoutId={`${uid}-active`} className="absolute inset-0 rounded-[var(--r-md)] bg-[var(--muted)]" transition={spring(0.15, 0.25)} />}
        <span className="relative flex min-w-0 items-center gap-2">
          {c.icon && <Icon name={c.icon} size={15} className="text-[var(--fg3)]" />}
          <span className="truncate">{cmdkMark(c.label, words)}</span>
          {/* zero basis: the hint only takes what the label leaves, so the label is never the one cut short */}
          {tags.length > 0 && <span className="min-w-0 flex-1 basis-0 truncate text-xs text-[var(--fg3)]">· {tags.join(' · ')}</span>}
          {c.hint && !tags.length && <span className="min-w-0 flex-1 basis-0 truncate text-xs text-[var(--fg3)]">{c.hint}</span>}
        </span>
        <span className="relative flex flex-none items-center gap-1">
          {c.shortcut && <Kbd className="[@media(hover:none)]:hidden">{c.shortcut}</Kbd>}
          {nested ? <Icon name="chevronRight" size={14} className="text-[var(--fg3)]" />
            : i === active && <Kbd aria-hidden className="[@media(hover:none)]:hidden">↵</Kbd>}
        </span>
      </button>
    )
  }
  const empty = list.length === 0 && (
    <div className="p-6 text-center text-[13px] text-[var(--fg3)]">
      {loading ? 'Searching…' : found.error && found.page === pageKey ? null : <>{`Nothing matches “${q}”.`}{!stack.length && suggest && <> {'Try'} <button className="cursor-pointer border-0 bg-transparent p-0 font-medium text-[var(--accent)] underline-offset-2 hover:underline" onClick={() => setQ(suggest)}>{`“${suggest}”`}</button></>}</>}
    </div>
  )
  return (
    <ModalLayer open={open} onClose={() => onOpenChange(false)}>
      <motion.div role="dialog" aria-modal="true" aria-label={'Command palette'}
        initial={{ opacity: 0, scale: 0.96, y: -8 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.98, transition: { duration: 0.12 } }}
        transition={spring(0.25, 0.35)} className={cn(surface.floating, 'fixed top-[14vh] left-1/2 z-[72] w-[min(540px,calc(100%-32px))] -translate-x-1/2 overflow-hidden max-[640px]:top-[max(12px,env(safe-area-inset-top))] [@media(max-height:500px)]:top-[max(8px,env(safe-area-inset-top))]', className)}>
        <div className="flex items-center gap-2 border-b border-[var(--line)] px-4">
          <Icon name="search" className="flex-none text-[var(--fg3)]" />
          {stack.length > 0 && (
            <nav aria-label={'Palette pages'} className="flex min-w-0 flex-none items-center gap-1 text-xs text-[var(--fg3)]">
              {stack.map((s, i) => (
                <span key={s.c.id} className="flex items-center gap-1">
                  <button onClick={() => back(i)} title={`Back to ${i ? stack[i - 1].c.label : 'all commands'}`}
                    className={cn('max-w-[120px] cursor-pointer truncate rounded-[var(--r-sm)] border-0 bg-[var(--muted)] px-1.5 py-0.5 text-xs text-[var(--fg2)] hover:text-[var(--fg)]', TOUCH.target)}>{s.c.label}</button>
                  <span aria-hidden>/</span>
                </span>
              ))}
            </nav>
          )}
          <input ref={inputRef} data-autofocus value={q} onChange={e => setQ(e.target.value)} placeholder={top?.placeholder ?? (top ? `Search ${top.label.replace(/(…|\.{3})$/, '').toLowerCase()}…` : placeholder ?? 'Type a command or search…')}
            onKeyDown={e => { if (e.key === 'Backspace' && !q && stack.length) { e.preventDefault(); back(); return } onKeyDown(e) }}
            role="combobox" aria-expanded="true" aria-controls={`${uid}-list`} aria-autocomplete="list" aria-busy={loading || undefined}
            aria-activedescendant={list[active] ? optionId(active) : undefined} aria-label={top ? `Search ${top.label.replace(/(…|\.{3})$/, '')}` : 'Search commands'}
            className="w-full min-w-0 border-0 bg-transparent py-3 text-base outline-none" />
          {loading && <Spinner size={14} label={'Loading results'} className="text-[var(--fg3)]" />}
        </div>
        {asyncOn && found.error && found.page === pageKey && (
          <div role="alert" className="flex items-center gap-1.5 border-b border-[var(--line)] px-4 py-2 text-xs text-[var(--bad)]"><Icon name="alert" size={13} />{found.error}</div>
        )}
        {virtualOn ? (
          <div ref={listRef} id={`${uid}-list`} role="listbox" aria-label={'Results'} className="relative h-[min(340px,50vh)] overflow-auto overscroll-contain px-1.5 max-[640px]:h-[min(420px,60dvh)]">
            <div style={{ height: v.totalSize, position: 'relative' }}>
              {v.items.map(it => {
                const row = rows.out[it.index]
                return (
                  <div key={row.label !== undefined ? `l:${row.label}:${it.index}` : `o:${row.hit}`} data-index={it.index} ref={v.measureElement}
                    style={{ position: 'absolute', top: 0, insetInlineStart: 0, width: '100%', transform: `translateY(${it.start}px)` }}>
                    {row.label !== undefined ? <MenuLabel>{groupLabel(row.label)}</MenuLabel> : option(row.hit)}
                  </div>
                )
              })}
            </div>
          </div>
        ) : (
          <div ref={listRef} id={`${uid}-list`} role="listbox" aria-label={'Results'} className="max-h-[min(340px,50vh)] overflow-auto overscroll-contain p-1.5 max-[640px]:max-h-[min(420px,60dvh)]">
            {empty}
            {list.map((h, i) => (
              <div key={`${h.recent ? 'r' : 'c'}:${h.c.id}:${i}`}>
                {cmdkGroup(h) && cmdkGroup(h) !== cmdkGroup(list[i - 1]) && <MenuLabel>{groupLabel(cmdkGroup(h)!)}</MenuLabel>}
                {option(i)}
              </div>
            ))}
          </div>
        )}
        <div className="flex gap-3 border-t border-[var(--line)] px-3 py-2 text-[11px] text-[var(--fg3)] [@media(hover:none)]:hidden">
          <span><Kbd>↑</Kbd> <Kbd>↓</Kbd> {'move'}</span><span><Kbd>↵</Kbd> {list[active]?.c.children || list[active]?.c.loadChildren ? 'open' : 'run'}</span>
          {stack.length > 0 && <span><Kbd>⌫</Kbd> {'back'}</span>}<span><Kbd>{'esc'}</Kbd> {'close'}</span>
          <span className="ms-auto ui-num" aria-live="polite">{loading ? '' : (list.length === 0 ? 'No results' : list.length === 1 ? `${list.length} result` : `${list.length} results`)}</span>
        </div>
      </motion.div>
    </ModalLayer>
  )
}

/**
 * Click (or Enter) to edit; Enter or blur saves, Escape cancels. With `helper`, a line below shows
 * e.g. "Last edited 2 h ago" and turns into a green `savedHelper` after a change; the text flashes on save.
 */
export function InlineEdit({ value, onSave, className, helper, savedHelper, label }:
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
      className={cn('group relative -mx-2 flex max-w-full cursor-text items-center gap-2 overflow-hidden rounded-[var(--r-md)] border-0 bg-transparent px-2 py-1 text-start font-semibold hover:bg-[var(--muted)]', className)}>
      {saves > 0 && <motion.span key={`f${saves}`} aria-hidden className="absolute inset-0 rounded-[var(--r-md)] bg-[var(--ok-soft)]" initial={{ opacity: 1 }} animate={{ opacity: 0 }} transition={{ duration: 0.9, ease: 'easeOut' }} />}
      <motion.span key={saves} className="relative truncate" initial={saves ? { opacity: 0.3, x: -3 } : false} animate={{ opacity: 1, x: 0 }} transition={spring(0.3, 0.3)}>{value}<span className="sr-only">{label ? `, edit ${label}` : ', edit'}</span></motion.span>
      <Icon name="edit" size={14} className="relative text-[var(--fg3)] opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100 [@media(hover:none)]:opacity-100" />
    </button>
  )
  if (helper === undefined) return field
  return (
    <div className="flex min-w-0 flex-col items-start gap-0.5">
      {field}
      <AnimatePresence mode="wait" initial={false}>
        <motion.span key={saves ? 'saved' : 'helper'} aria-live="polite" initial={{ opacity: 0, y: 3 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -3 }} transition={{ duration: 0.15 }}
          className={cn('text-xs', saves ? 'text-[var(--ok)]' : 'text-[var(--fg3)]')}>{saves ? savedHelper ?? 'Saved just now' : helper}</motion.span>
      </AnimatePresence>
    </div>
  )
}

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
              className="pointer-events-none absolute -top-1.5 -end-1.5 grid h-5 min-w-5 place-items-center rounded-full border-2 border-[var(--card)] bg-[var(--bad)] px-1 text-[11px] font-semibold text-[var(--card)]">
              <AnimatedNumber value={unread} />
            </motion.span>
          )}
        </AnimatePresence>
      </PopoverTrigger>
      <PopoverContent className="w-[min(300px,calc(100vw-32px))] overflow-hidden !p-0">
        <div className="flex items-center justify-between border-b border-[var(--line)] px-3 py-2"><b className="text-[13px]">{'Notifications'}</b>
          <Button size="sm" variant="ghost" disabled={!unread} onClick={markAll}>{'Mark all read'}</Button></div>
        {items.length === 0 ? <EmptyState icon="bell" title={'You’re all caught up'} /> : (
          <div role="list">
            <AnimatePresence initial>
              {shown.map((n, i) => (
                <motion.div key={n.id} role="listitem" layout initial={{ opacity: 0, x: -6 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, height: 0, transition: { duration: 0.15 } }}
                  transition={{ ...spring(0.2, 0.35), delay: i * 0.04 }} className="overflow-hidden border-b border-[var(--line)] last:border-b-0">
                <button onClick={() => onChange(items.map(x => x.id === n.id ? { ...x, read: true } : x))}
                  className="flex w-full cursor-pointer gap-2.5 border-0 bg-transparent px-3 py-2.5 text-start text-xs hover:bg-[var(--muted)]">
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

export type TourStep = { target: string; title: ReactNode; body?: ReactNode }
type TourGeo = { x: number; y: number; w: number; h: number; left: number; top: number; above: boolean; ax: number }

/**
 * Guided tour over a region. Mark targets inside `children` with data-tour="…"; the spotlight springs
 * between them and a tooltip with an arrow anchors below each one (above if there's no room).
 * `step` is the open step (-1 = closed). Next/Done, Skip, ←/→ and Escape work. The spotlight and
 * tooltip are placed from measured geometry, so they are physical by nature.
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
        const key = e.key
        if (key === 'ArrowRight') go(i + 1)
        if (key === 'ArrowLeft' && i > 0) go(i - 1)
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
          <motion.div key="tip" ref={tip} role="dialog" aria-label={'Product tour'} aria-live="polite"
            initial={{ opacity: 0, y: 8 }} animate={geo ? { opacity: 1, y: 0, left: geo.left, top: geo.top } : { opacity: 0 }}
            exit={{ opacity: 0, y: 8, transition: { duration: 0.15 } }} transition={{ default: spring(0.25, 0.35), left: move, top: move }}
            style={{ visibility: geo ? 'visible' : 'hidden' }}

            className={cn(surface.floating, 'absolute top-0 left-0 z-[6] w-[min(250px,calc(100%-16px))] rounded-[var(--r-md)] p-3 text-[13px]')}>
            {geo && <span aria-hidden className={cn('absolute h-2.5 w-2.5 border-[var(--line)] bg-[var(--card)]',

              geo.above ? '-bottom-[6px] rotate-[225deg] border-t border-l' : '-top-[6px] rotate-45 border-t border-l')} style={{ left: geo.ax }} />}
            <motion.div key={i} initial={{ opacity: 0, x: 6 }}
 animate={{ opacity: 1, x: 0 }} transition={{ duration: 0.2 }}>
              <b className="block font-semibold">{s.title}</b>
              {s.body && <div className="mt-1 mb-3 text-xs leading-normal text-[var(--fg3)]">{s.body}</div>}
            </motion.div>
            <div className="flex items-center justify-between gap-2">
              <span className="ui-num text-xs text-[var(--fg3)]">{`${i + 1} of ${steps.length}`}</span>
              <div className="flex gap-1.5">
                {i < steps.length - 1 && <Button size="sm" variant="ghost" onClick={() => go(-1)}>{'Skip'}</Button>}
                <Button ref={next} size="sm" variant="primary" onClick={() => go(i + 1)}>{i === steps.length - 1 ? 'Done' : 'Next'}</Button>

              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
