import { Fragment, createContext, isValidElement, useCallback, useContext, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type ButtonHTMLAttributes, type CSSProperties, type HTMLAttributes, type ReactNode, type Ref, type RefObject, type KeyboardEvent as RKeyboardEvent, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent } from 'react'
import { createPortal } from 'react-dom'
import { type AsChildProps, Button, type ButtonProps, Icon, IconButton, type IconName, Kbd, Slot, cn, isTouch, menuItemClass, prefersReducedMotion, presenceProps, composeRefs, spring, useControllable, useGeneration, usePresence, useFocusTrap, useLongPress, useMediaQuery, useOutside, useRoving, AnimatedNumber, Spinner, TOUCH, uiShared, surface, focusStep, useRequiredContext, PartButton, FOCUSABLE, Z, haptic, isEditableTarget, plural, useCoarsePointer, useLatest, useTypeahead, typeaheadIndex } from './core'
import { EmptyState } from './feedback'
import { ActiveIndicator, Presence, PresenceList, Swap, play, shake, useSwipe } from './motion'
import { useVirtual, virtualSetAria } from './virtual'

type PopCtx = { open: boolean; setOpen: (v: boolean) => void; triggerRef: RefObject<HTMLButtonElement | null>; id: string }
const PopoverCtx = createContext<PopCtx | null>(null)
export const usePopover = () => useRequiredContext(PopoverCtx, 'usePopover', '<Popover>')
const usePopoverPart = (part: string) => useRequiredContext(PopoverCtx, `<${part}>`, `<${part.split('.')[0]}.Root>`)

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
        onKeyDown={e => { if (e.key === 'Escape' && open && !e.defaultPrevented) { e.stopPropagation(); setOpen(false); triggerRef.current?.focus() } }}>
        {children}
      </div>
    </PopoverCtx.Provider>
  )
}

/** The part-button click contract: the caller's onClick runs first, and `e.preventDefault()` there skips the action. */
const partClick = <E extends { defaultPrevented: boolean }>(onClick: ((e: E) => void) | undefined, action: () => void) =>
  (e: E) => { onClick?.(e); if (!e.defaultPrevented) action() }

/** A Button (or, with `asChild`, your element) that runs `action` on click (see partClick). The building block of every Trigger and Close part. */
function OverlayPartButton({ asChild, onClick, action, children, ...p }: ButtonProps & { action: () => void }) {
  const click = partClick(onClick, action)
  if (asChild) return <Slot<HTMLButtonElement> {...p} onClick={click}>{children}</Slot>
  return <Button {...p} onClick={click}>{children}</Button>
}

/** Popover.Trigger: toggles the popover. Takes all Button props, or `asChild` to make your own element the trigger. */
export function PopoverTrigger({ children, ...p }: ButtonProps) {
  const { open, setOpen, triggerRef, id } = usePopoverPart('Popover.Trigger')
  return <OverlayPartButton ref={triggerRef} aria-expanded={open} aria-haspopup="dialog" aria-controls={open ? id : undefined} {...p} action={() => setOpen(!open)}>{children}</OverlayPartButton>
}

/** Popover.Close: closes the popover (focus goes back to its trigger). Button props, or `asChild`. */
export function PopoverClose({ children, ...p }: ButtonProps) {
  const { setOpen } = usePopoverPart('Popover.Close')
  return <OverlayPartButton {...p} action={() => setOpen(false)}>{children}</OverlayPartButton>
}

/** Default gap between a trigger and its floating panel in px: a little tighter below it. */
export const FLOAT_GAP = { bottom: 6, other: 8 } as const
/** How far floating panels keep inside the viewport edges, in px. */
export const VIEWPORT_MARGIN = 8

/** Panel placement: the side (`top`/`bottom`/`left`/`right`), then the alignment (`-start` = left or top edge, `-end` = right or bottom). The gap is a margin (floatGap). */
const SIDE = {
  'bottom-start': 'top-full left-0 origin-top-left', 'bottom-end': 'top-full right-0 origin-top-right',
  'bottom-center': 'top-full left-1/2 -translate-x-1/2 origin-top', 'top-start': 'bottom-full left-0 origin-bottom-left',
  'top-center': 'bottom-full left-1/2 -translate-x-1/2 origin-bottom', 'top-end': 'bottom-full right-0 origin-bottom-right',
  right: 'left-full top-1/2 -translate-y-1/2 origin-left', left: 'right-full top-1/2 -translate-y-1/2 origin-right',
  'right-start': 'left-full top-0 origin-top-left', 'right-end': 'left-full bottom-0 origin-bottom-left',
  'left-start': 'right-full top-0 origin-top-right', 'left-end': 'right-full bottom-0 origin-bottom-right',
} as const
export type Placement = keyof typeof SIDE

/** Which side of its trigger a floating part opens on. */
export type FloatSide = 'top' | 'right' | 'bottom' | 'left'
/** How a floating part lines up along that side: `start` is the left (or top) edge, `end` the right (or bottom). */
export type FloatAlign = 'start' | 'center' | 'end'
/** Positioning props of the floating content parts (Popover, DropdownMenu, HoverCard, Tooltip). */
export type FloatProps = {
  /** side of the trigger; flips to the opposite side when there is no room */ side?: FloatSide
  /** alignment along that side */ align?: FloatAlign
  /** gap between trigger and panel in px (default FLOAT_GAP: 6 below the trigger, 8 elsewhere) */ sideOffset?: number
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
const floatAlignOf = (p: Placement) => (p.split('-')[1] ?? 'center') as FloatAlign
const FLIP: Record<FloatSide, FloatSide> = { top: 'bottom', bottom: 'top', left: 'right', right: 'left' }
const flipPlacement = (p: Placement) => floatPlacement(FLIP[floatSideOf(p)], floatAlignOf(p), p)
/** The gap on `side`: `offset` when given, else FLOAT_GAP. */
const gapOf = (side: FloatSide, offset?: number) => offset ?? (side === 'bottom' ? FLOAT_GAP.bottom : FLOAT_GAP.other)
/** The margin that puts the panel `gapOf(side, offset)` away from its trigger. */
function floatGap(p: Placement, offset: number | undefined): CSSProperties {
  const s = floatSideOf(p), gap = gapOf(s, offset)
  return s === 'bottom' ? { marginTop: gap } : s === 'top' ? { marginBottom: gap } : s === 'right' ? { marginLeft: gap } : { marginRight: gap }
}

/** The layout viewport in px (clientWidth/clientHeight: without a classic scrollbar, and right on zoomed phones where innerWidth is not). */
export function viewportSize(): { w: number; h: number } {
  const d = document.documentElement
  return { w: d.clientWidth || innerWidth, h: d.clientHeight || innerHeight }
}
/** Where a box of `size` starting at `start` must start to stay `margin` inside `[0, extent]`; pinned to the start when it can't fit. */
export const fitInside = (start: number, size: number, extent: number, margin = VIEWPORT_MARGIN) => Math.max(margin, Math.min(extent - size - margin, start))

/** The anchor of fitPanel: a rect, or a point (left = right, top = bottom). */
export type FitAnchor = { left: number; top: number; right: number; bottom: number }
/**
 * Where a fixed panel goes next to `anchor`: on `side` (flipped to the opposite side when it doesn't fit there and does
 * on the other, or has more room), lined up by `align`, `gap` px away, and slid along the other axis to stay `margin` px
 * inside `bounds` (default: the viewport). `fits` is false when neither side had room. Pure, so it is testable without layout.
 */
export function fitPanel({ anchor, size, side, align = 'center', gap, bounds = viewportSize(), margin = VIEWPORT_MARGIN }:
  { anchor: FitAnchor; size: { w: number; h: number }; side: FloatSide; align?: FloatAlign; gap: number; bounds?: { w: number; h: number }; margin?: number }) {
  const vertical = side === 'top' || side === 'bottom'
  const room = (s: FloatSide) => s === 'bottom' ? bounds.h - anchor.bottom - margin : s === 'top' ? anchor.top - margin : s === 'right' ? bounds.w - anchor.right - margin : anchor.left - margin
  const need = (vertical ? size.h : size.w) + gap, alt = FLIP[side]
  const fitsHere = need <= room(side), fitsAlt = need <= room(alt)
  const s = fitsHere ? side : fitsAlt || room(alt) > room(side) ? alt : side
  const along = (lo: number, hi: number, len: number) => align === 'start' ? lo : align === 'end' ? hi - len : (lo + hi - len) / 2
  if (vertical) {
    const left = fitInside(along(anchor.left, anchor.right, size.w), size.w, bounds.w, margin)
    return { left, top: s === 'bottom' ? anchor.bottom + gap : anchor.top - gap - size.h, side: s, fits: fitsHere || fitsAlt }
  }
  const top = fitInside(along(anchor.top, anchor.bottom, size.h), size.h, bounds.h, margin)
  return { left: s === 'right' ? anchor.right + gap : anchor.left - gap - size.w, top, side: s, fits: fitsHere || fitsAlt }
}

/** Arrow positions for a panel's bordered 10px square and a tooltip's filled 8px one: the edge it sits on, and where along it. */
const FLOAT_ARROW = {
  panel: {
    edge: { bottom: '-top-[5px] border-t border-l', top: '-bottom-[5px] border-b border-r', right: '-left-[5px] border-b border-l', left: '-right-[5px] border-t border-r' },
    x: { start: 'left-4', center: 'left-[calc(50%-5px)]', end: 'right-4' }, y: { start: 'top-3', center: 'top-[calc(50%-5px)]', end: 'bottom-3' },
  },
  tip: {
    edge: { top: '-bottom-1', bottom: '-top-1', right: '-left-1', left: '-right-1' },
    x: { start: 'left-3', center: 'left-[calc(50%-4px)]', end: 'right-3' }, y: { start: 'top-2', center: 'top-[calc(50%-4px)]', end: 'bottom-2' },
  },
} as const
/** The arrow classes for placement `p`. */
const floatArrowClass = (p: Placement, kind: keyof typeof FLOAT_ARROW = 'panel') => {
  const s = floatSideOf(p), t = FLOAT_ARROW[kind]
  return cn(t.edge[s], t[s === 'top' || s === 'bottom' ? 'x' : 'y'][floatAlignOf(p)])
}

/**
 * Absolutely positioned panel next to its (relative) parent. Flips to the other side when it would
 * run off the bottom (or top) of the viewport and there is more room there (`flip={false}` pins it), and
 * slides sideways to stay VIEWPORT_MARGIN inside the screen edges on narrow (phone) viewports. Never wider than the screen.
 * Left/right placements flip horizontally the same way. The side is chosen once, when it opens, and stays locked while
 * it is open, so content that shrinks or grows (a filtered list) never makes it jump to the other side. `flip="scroll"` never flips: when the panel doesn't fit on its
 * side the page scrolls just enough to show it (for type-to-filter lists, whose height changes as you type: above the
 * field they would shrink from the top and cover the label). `offset` sets the gap in px, `arrow` draws a pointer.
 * `inline` renders spans instead of divs, so the panel is valid inside a `<p>` (hover cards on links in text).
 */
export function FloatingPanel({ open, placement = 'bottom-start', flip = true, matchWidth, offset, arrow, inline, className, children, role = 'dialog', id, ...p }:
  { open: boolean; placement?: Placement; flip?: boolean | 'scroll'; matchWidth?: boolean; offset?: number; arrow?: boolean; inline?: boolean; className?: string; children: ReactNode; role?: string; id?: string } & HTMLAttributes<HTMLDivElement>) {
  const [side, setSide] = useState<Placement>(placement)
  const [shift, setShift] = useState(0)
  const ref = useRef<HTMLDivElement>(null), shiftRef = useRef(0)
  const horizontal = (s: Placement) => s.startsWith('left') || s.startsWith('right')
  useLayoutEffect(() => { // horizontal clamp: keep the panel inside the viewport
    if (!open || horizontal(side)) { shiftRef.current = 0; setShift(0); return }
    const el = ref.current, inner = el?.firstElementChild as HTMLElement | null
    if (!el || !inner || getComputedStyle(inner).position === 'fixed') return
    const left = el.getBoundingClientRect().left - shiftRef.current
    const dx = fitInside(left, inner.offsetWidth, viewportSize().w) - left
    shiftRef.current = dx; setShift(dx)
  }, [open, side])
  useLayoutEffect(() => {
    if (!open) return
    const el = ref.current
    if (!el || !flip) { setSide(placement); return }
    const anchor = ((el.offsetParent as HTMLElement | null) ?? el.parentElement)?.getBoundingClientRect()
    if (!anchor) return
    const vp = viewportSize(), s = floatSideOf(placement), alt = flipPlacement(placement)
    const room = (k: FloatSide) => k === 'bottom' ? vp.h - anchor.bottom - VIEWPORT_MARGIN : k === 'top' ? anchor.top - VIEWPORT_MARGIN : k === 'right' ? vp.w - anchor.right - VIEWPORT_MARGIN : anchor.left - VIEWPORT_MARGIN
    const fits = (k: FloatSide) => (horizontal(placement) ? el.offsetWidth : el.offsetHeight) + gapOf(k, offset) <= room(k)
    if (horizontal(placement)) { // left/right: flip across when it doesn't fit and the other side has more room
      setSide(!fits(s) && room(FLIP[s]) > room(s) ? alt : placement)
      return
    }
    const wantsUp = s === 'top', fitsDown = fits('bottom'), fitsUp = fits('top')
    // flip only to a side where it fits; when it fits neither (tall panel, short phone screen) open downward and
    // scroll the page so the panel is in view, instead of hanging off the top of the screen
    const flipIt = flip !== 'scroll' && (wantsUp ? !fitsUp && (fitsDown || room('bottom') > room('top')) : !fitsDown && fitsUp)
    setSide(flipIt ? alt : placement)
    if (flip === 'scroll' ? !(wantsUp ? fitsUp : fitsDown) : !fitsDown && !fitsUp) {
      const r = requestAnimationFrame(() => el.scrollIntoView({ block: 'nearest', behavior: prefersReducedMotion() ? 'auto' : 'smooth' }))
      return () => cancelAnimationFrame(r)
    }
  }, [open, placement, flip, offset])
  const up = side.startsWith('top')
  // a right-anchored panel moves with margin-right; the others with margin-left
  const style = { ...floatGap(side, offset), ...(shift ? side.endsWith('-end') ? { marginRight: -shift } : { marginLeft: shift } : null) }
  const Box = inline ? 'span' : 'div'
  return (
    <Presence appear>
      {open && (
        <Box ref={ref} data-side={floatSideOf(side)} className={cn('absolute [--ui-do:.12s] [--ui-so:.97]', Z.popover, SIDE[side], matchWidth && 'w-full', inline && 'block')} style={style}>
          <Box id={id} role={role}
            className={cn(surface.floating, 'ui-in max-w-[calc(100vw-16px)] min-w-[min(180px,calc(100vw-16px))] p-1 [--ui-s:.97]', up ? '[--ui-y:4px]' : '[--ui-y:-4px]', inline && 'block', className)} {...p}>
            {children}
          </Box>
          {arrow && <span aria-hidden className={cn('ui-in pointer-events-none absolute h-2.5 w-2.5 rotate-45 border-[var(--line)] bg-[var(--card)]', floatArrowClass(side))} />}
        </Box>
      )}
    </Presence>
  )
}

/**
 * Popover.Content: the panel of a Popover. Position it with `side`/`align`/`sideOffset` (or `placement`), add `arrow`.
 * On open it moves focus inside: to an element marked `data-autofocus`, else the first
 * focusable one, else the panel itself (unless a child already took focus, e.g. a Calendar's selected day or a menu's first item).
 * On close it hands focus back to the trigger when focus was inside the panel (or nowhere).
 */
export function PopoverContent({ placement, side, align, sideOffset, arrow, className, children, role, 'aria-label': ariaLabel, 'aria-labelledby': labelledBy }:
  FloatProps & { className?: string; children: ReactNode; role?: string; /** names the panel (a dialog needs a name) */ 'aria-label'?: string; 'aria-labelledby'?: string }) {
  const { open, id, triggerRef } = usePopoverPart('Popover.Content')
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

/** Hover and touch timings (ms): tooltip open delay, hover-card open and close delays, how long a tapped tooltip stays, submenu open and close on hover. */
const HOVER = { tooltipDelay: 400, cardOpen: 300, cardClose: 150, touchHide: 2500, subOpen: 90, subClose: 220 } as const

/** Controlled-or-uncontrolled open flag whose setter ignores no-op calls, so `onOpenChange` fires once per change: `[open, setOpen, openRef]`. */
function useOpenState({ open, defaultOpen = false, onOpenChange }: { open?: boolean; defaultOpen?: boolean; onOpenChange?: (open: boolean) => void }) {
  const [inner, setInner] = useState(defaultOpen)
  const controlled = open !== undefined, value = controlled ? open : inner
  const now = useRef(value); now.current = value
  const notify = useLatest(onOpenChange)
  const setOpen = useCallback((v: boolean) => {
    if (v === now.current) return
    now.current = v
    if (!controlled) setInner(v)
    notify.current?.(v)
  }, [controlled, notify])
  return [value, setOpen, now] as const
}

/** One cancellable timer that opens or closes after a delay: `{ openIn(ms), closeIn(ms), cancel }`. Cleared on unmount. */
function useDelayedToggle(setOpen: (open: boolean) => void) {
  const t = useRef<ReturnType<typeof setTimeout>>(undefined), set = useLatest(setOpen)
  useEffect(() => () => clearTimeout(t.current), [])
  return useMemo(() => {
    const cancel = () => clearTimeout(t.current)
    const after = (v: boolean) => (ms: number) => { cancel(); t.current = setTimeout(() => set.current(v), ms) }
    return { openIn: after(true), closeIn: after(false), cancel }
  }, [set])
}

/** What the items of a menu (DropdownMenu, ContextMenu or Menu.List) need from it: close it, focus back on its trigger. */
type MenuCtxV = { close: (refocus?: boolean) => void }
const MenuCtx = createContext<MenuCtxV | null>(null)
/** Close the menu around an item: a DropdownMenu, a ContextMenu, a Menu.List, or (older usage) a plain Popover. */
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
const menuLabel = (el: HTMLElement) => (el.dataset.textValue ?? el.textContent ?? '').trim()
/** Pointer hover moves focus to the item (so arrows carry on from where the mouse is). */
const menuHoverFocus = (e: ReactPointerEvent<HTMLElement>) => { if (e.pointerType === 'mouse' && document.activeElement !== e.currentTarget) e.currentTarget.focus({ preventScroll: true }) }

/**
 * One menu's item list: ↑/↓ move (wrapping), Home/End jump, and typing a letter or a word jumps to the next item whose
 * label (or `textValue`) starts with it (repeating one letter cycles). Arrows and typeahead only act for the list that
 * owns the focused item, so a submenu's keys don't move its parent. While `open`, the first enabled item takes focus
 * (`autoFocus`). `onEscape` and `onTab` handle those keys (Tab from a nested submenu too). Put `ref` and `props` on the list.
 */
export function useMenuList<T extends HTMLElement = HTMLDivElement>({ open = true, autoFocus = true, onEscape, onTab }:
  { open?: boolean; autoFocus?: boolean; onEscape?: () => void; onTab?: (e: RKeyboardEvent<HTMLElement>) => void } = {}) {
  const ref = useRef<T>(null), type = useTypeahead(), on = useLatest({ onEscape, onTab })
  useLayoutEffect(() => {
    if (!open || !autoFocus) return
    const focusFirst = () => {
      const list = ref.current
      if (!list || list.contains(document.activeElement)) return true
      const first = menuItemsOf(list)[0]
      first?.focus({ preventScroll: true })
      return !first || document.activeElement === first
    }
    // a panel that is still hidden while it measures its place (ContextMenu) can't take focus yet: try again next frame
    if (focusFirst()) return
    const r = requestAnimationFrame(focusFirst)
    return () => cancelAnimationFrame(r)
  }, [open, autoFocus])
  const onKeyDown = useCallback((e: RKeyboardEvent<HTMLElement>) => {
    const { onEscape, onTab } = on.current
    if (e.key === 'Escape' && onEscape) { e.preventDefault(); e.stopPropagation(); onEscape(); return }
    if (e.key === 'Tab' && onTab) { onTab(e); return }
    const list = e.currentTarget
    if ((e.target as Element).closest?.('[data-menu-list]') !== list) return
    const items = menuItemsOf(list)
    if (!items.length) return
    const next = focusStep(items, e.key)
    if (next) { e.preventDefault(); next.focus(); return }
    if (e.key === ' ' || e.ctrlKey || e.metaKey || e.altKey) return
    const typed = type(e.key)
    const i = typed ? typeaheadIndex(items.map(menuLabel), typed, items.indexOf(document.activeElement as HTMLElement)) : -1
    if (i >= 0) { e.preventDefault(); items[i].focus() }
  }, [on, type])
  return { ref, props: { 'data-menu-list': '', onKeyDown } }
}

/**
 * Menu.List: a menu's item list without a trigger or panel, for composite widgets that bring their own (a composer's
 * slash-command popup). Arrows, Home/End and typeahead move between the items, the first one takes focus (`autoFocus`),
 * and choosing an item or pressing Escape calls `onClose`; `onTab` handles Tab. A `role="menu"` div unless `role` says otherwise.
 */
export function MenuList({ children, onClose, onTab, autoFocus = true, role = 'menu', className, ...aria }:
  { children: ReactNode; onClose?: () => void; onTab?: (e: RKeyboardEvent<HTMLElement>) => void; autoFocus?: boolean; role?: string; className?: string
    id?: string; 'aria-label'?: string; 'aria-labelledby'?: string }) {
  const { ref, props } = useMenuList({ autoFocus, onEscape: onClose, onTab })
  const close = useLatest(onClose)
  const menu = useMemo<MenuCtxV>(() => ({ close: () => close.current?.() }), [close])
  return <MenuCtx.Provider value={menu}><div ref={ref} role={role} className={className} {...aria} {...props}>{children}</div></MenuCtx.Provider>
}

type MenuItemBase = {
  children?: ReactNode; className?: string; disabled?: boolean
  /** label for typeahead when the text content isn't it */ textValue?: string
  /** indent to line up with checkbox and radio items */ inset?: boolean
}
const menuRowClass = (danger?: boolean, disabled?: boolean, inset?: boolean, className?: string) =>
  cn(menuItemClass, danger && 'text-[var(--bad)]', disabled && 'cursor-default opacity-50', inset && '!ps-8', className)

/** The body every menu row shares: a button that arrows reach (not a Tab stop), with a leading slot, the label and a trailing slot. */
function MenuRow({ leading, trailing, danger, disabled, inset, textValue, className, children, ...p }: Omit<MenuItemBase, 'children'> &
  { leading?: ReactNode; trailing?: ReactNode; danger?: boolean; children?: ReactNode; ref?: Ref<HTMLButtonElement> } & Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children' | 'className' | 'disabled'>) {
  const inMenu = useContext(MenuCtx) !== null
  return (
    <button type="button" tabIndex={-1} disabled={disabled} data-text-value={textValue}
      className={menuRowClass(danger, disabled, inset, className)} onPointerMove={inMenu ? menuHoverFocus : undefined} {...p}>
      <span className="flex min-w-0 flex-1 items-center gap-2">{leading}{children}</span>
      {trailing}
    </button>
  )
}

/**
 * One row in a menu (DropdownMenu.Item / ContextMenu.Item). Not a Tab stop (arrows and typeahead move between rows); choosing
 * it calls `onSelect` and closes the menu, returning focus to the trigger (`closeOnSelect={false}` or `e.preventDefault()`
 * in onSelect keeps it open). `shortcut` shows a key cap; `asChild` renders your element (a link) as the row.
 */
export function MenuItem({ children, shortcut, icon, danger, disabled, onSelect, closeOnSelect = true, textValue, inset, asChild, className }: MenuItemBase & AsChildProps &
  { shortcut?: string; icon?: IconName; danger?: boolean; onSelect?: (e: MenuSelectEvent) => void; closeOnSelect?: boolean }) {
  const close = useMenuClose(), inMenu = useContext(MenuCtx) !== null
  const onClick = (e: ReactMouseEvent<HTMLElement>) => {
    if (disabled) { e.preventDefault(); return }
    const ev = menuSelectEvent(e); onSelect?.(ev)
    if (closeOnSelect && !ev.defaultPrevented) close()
  }
  if (asChild) return (
    <Slot role="menuitem" tabIndex={-1} data-text-value={textValue} aria-disabled={disabled || undefined} className={menuRowClass(danger, disabled, inset, className)}
      onPointerMove={inMenu ? menuHoverFocus : undefined} onClick={onClick}>{children}</Slot>
  )
  return (
    <MenuRow role="menuitem" danger={danger} disabled={disabled} inset={inset} textValue={textValue} className={className} onClick={onClick}
      leading={icon && <Icon name={icon} size={15} className={danger ? '' : 'text-[var(--fg3)]'} />} trailing={shortcut && <Kbd>{shortcut}</Kbd>}>{children}</MenuRow>
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
      <Presence>
        {on && <span className="ui-in grid [--ui-do:.1s] [--ui-e:var(--ui-spring-pop)] [--ui-s:.4]">
          {kind === 'check' ? <Icon name="check" size={14} strokeWidth={2.4} /> : <span className="h-1.5 w-1.5 rounded-full bg-current" />}
        </span>}
      </Presence>
    </span>
  )
}

/**
 * A menu row that toggles (role=menuitemcheckbox, aria-checked): `checked` + `onCheckedChange`, or `defaultChecked`.
 * Stays open when toggled, so several can be flipped in a row (`closeOnSelect` closes it).
 */
export function MenuCheckboxItem({ checked, defaultChecked = false, onCheckedChange, onSelect, closeOnSelect = false, shortcut, children, disabled, textValue, className }: Omit<MenuItemBase, 'inset'> &
  { checked?: boolean; defaultChecked?: boolean; onCheckedChange?: (checked: boolean) => void; onSelect?: (e: MenuSelectEvent) => void; closeOnSelect?: boolean; shortcut?: string }) {
  const [on, set] = useControllable(checked, defaultChecked, onCheckedChange)
  const close = useMenuClose()
  return (
    <MenuRow role="menuitemcheckbox" aria-checked={on} disabled={disabled} textValue={textValue} className={className}
      leading={<MenuIndicator on={on} kind="check" />} trailing={shortcut && <Kbd>{shortcut}</Kbd>}
      onClick={e => { const ev = menuSelectEvent(e); onSelect?.(ev); if (ev.defaultPrevented) return; set(!on); if (closeOnSelect) close() }}>{children}</MenuRow>
  )
}

type MenuRadioCtxV = { value: string | undefined; set: (v: string) => void }
const MenuRadioCtx = createContext<MenuRadioCtxV | null>(null)
/** A set of radio menu items (role=group): one `value` (controlled with `onValueChange`, or `defaultValue`). */
export function MenuRadioGroup({ value, defaultValue, onValueChange, children, 'aria-label': label, className }:
  { value?: string; defaultValue?: string; onValueChange?: (value: string) => void; children: ReactNode; 'aria-label'?: string; className?: string }) {
  const [v, set] = useControllable<string | undefined>(value, defaultValue, onValueChange as (v: string | undefined) => void)
  const ctx = useMemo(() => ({ value: v, set }), [v, set])
  return <MenuRadioCtx.Provider value={ctx}><div role="group" aria-label={label} className={className}>{children}</div></MenuRadioCtx.Provider>
}
/** One choice in a MenuRadioGroup (role=menuitemradio, aria-checked). Stays open when picked unless `closeOnSelect`. */
export function MenuRadioItem({ value, onSelect, closeOnSelect = false, shortcut, children, disabled, textValue, className }: Omit<MenuItemBase, 'inset'> &
  { value: string; onSelect?: (e: MenuSelectEvent) => void; closeOnSelect?: boolean; shortcut?: string }) {
  const g = useRequiredContext(MenuRadioCtx, '<RadioItem>', 'a menu <RadioGroup>')
  const close = useMenuClose(), on = g.value === value
  return (
    <MenuRow role="menuitemradio" aria-checked={on} disabled={disabled} textValue={textValue} className={className}
      leading={<MenuIndicator on={on} kind="dot" />} trailing={shortcut && <Kbd>{shortcut}</Kbd>}
      onClick={e => { const ev = menuSelectEvent(e); onSelect?.(ev); if (ev.defaultPrevented) return; g.set(value); if (closeOnSelect) close() }}>{children}</MenuRow>
  )
}

/* Submenus ─ */

type MenuSubCtxV = { open: boolean; focusFirst: boolean; setOpen: (v: boolean, focusFirst?: boolean) => void; hover: () => void; triggerRef: RefObject<HTMLButtonElement | null>; id: string }
const MenuSubCtx = createContext<MenuSubCtxV | null>(null)
const useMenuSub = (part: string) => useRequiredContext(MenuSubCtx, `<${part}>`, 'a menu <Sub>')

/**
 * A nested menu (DropdownMenu.Sub / ContextMenu.Sub): wraps a SubTrigger and a SubContent. Opens on hover (mouse), click
 * or tap, → / Enter / Space; ← or Escape closes it and returns to the trigger.
 * `open` + `onOpenChange` to control it.
 */
export function MenuSub({ open, defaultOpen = false, onOpenChange, children }: { open?: boolean; defaultOpen?: boolean; onOpenChange?: (open: boolean) => void; children: ReactNode }) {
  const [o, setO, now] = useOpenState({ open, defaultOpen, onOpenChange })
  const timer = useDelayedToggle(setO)
  // opened by click or key: its first item takes focus; opened by hover: focus stays on the trigger row
  const [focusFirst, setFocusFirst] = useState(false)
  const triggerRef = useRef<HTMLButtonElement>(null), id = useId()
  const value = useMemo<MenuSubCtxV>(() => ({
    open: o, focusFirst, triggerRef, id,
    setOpen: (v, focus = false) => { timer.cancel(); setFocusFirst(v && focus); setO(v) },
    hover: () => { if (now.current) timer.cancel(); else timer.openIn(HOVER.subOpen) },
  }), [o, focusFirst, setO, id, timer, now])
  return (
    <MenuSubCtx.Provider value={value}>
      <div className="relative" onPointerEnter={() => { if (now.current) timer.cancel() }}
        onPointerLeave={e => { if (e.pointerType === 'mouse') timer.closeIn(HOVER.subClose) }}
        onBlur={e => { const to = e.relatedTarget as Node | null; if (to && !e.currentTarget.contains(to)) value.setOpen(false) }}>
        {children}
      </div>
    </MenuSubCtx.Provider>
  )
}
/** The row that opens a submenu (aria-haspopup=menu, aria-expanded); shows a chevron. */
export function MenuSubTrigger({ children, icon, disabled, textValue, inset, className }: MenuItemBase & { icon?: IconName }) {
  const sub = useMenuSub('SubTrigger')
  const openAndFocus = () => sub.setOpen(true, true)
  return (
    <MenuRow ref={sub.triggerRef} id={`${sub.id}-t`} role="menuitem" aria-haspopup="menu" aria-expanded={sub.open} aria-controls={sub.open ? sub.id : undefined}
      disabled={disabled} textValue={textValue} inset={inset} data-state={sub.open ? 'open' : 'closed'} className={cn('data-[state=open]:bg-[var(--muted)]', className)}
      leading={icon && <Icon name={icon} size={15} className="text-[var(--fg3)]" />} trailing={<Icon name="chevronRight" size={13} className="text-[var(--fg3)]" />}
      onPointerEnter={e => { if (e.pointerType === 'mouse') sub.hover() }} onClick={openAndFocus}
      onKeyDown={e => { if (e.key === 'ArrowRight' || e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); openAndFocus() } }}>{children}</MenuRow>
  )
}

/** A context menu or submenu panel: scales in from its corner, its rows after one another. */
const ctxPanelClass = 'ui-in ui-stagger [--ui-d:.25s] [--ui-do:.1s] [--ui-s:.94] [--ui-so:.97]'

/** The submenu's first row sits level with its trigger row: the panel's top padding plus border, in px. */
const SUB_ROW_ALIGN = 5
/** Gap between a submenu and its trigger row, in px. */
const SUB_GAP = 4

/**
 * The submenu panel. Opens to the right of its trigger, on the other side
 * when that has no room, and on a phone too narrow for either it overlaps just below the trigger; it also moves up to
 * stay on screen.
 */
export function MenuSubContent({ children, className, 'aria-label': ariaLabel }: { children: ReactNode; className?: string; 'aria-label'?: string }) {
  const sub = useMenuSub('SubContent')
  const back = () => { sub.setOpen(false); sub.triggerRef.current?.focus() }
  const { ref, props } = useMenuList<HTMLDivElement>({ open: sub.open, autoFocus: sub.focusFirst, onEscape: back })
  const [place, setPlace] = useState<{ left: number; top: number; onLeft: boolean } | null>(null)
  useLayoutEffect(() => {
    if (!sub.open) { setPlace(null); return }
    const el = ref.current, tr = sub.triggerRef.current
    if (!el || !tr) return
    const r = tr.getBoundingClientRect(), size = { w: el.offsetWidth, h: el.offsetHeight }, vp = viewportSize()
    const fit = fitPanel({ anchor: { left: r.left, right: r.right, top: r.top - SUB_ROW_ALIGN, bottom: r.bottom }, size, side: 'right', align: 'start', gap: SUB_GAP })
    let { left, top } = fit
    if (!fit.fits) { // no room on either side (a phone): overlap the trigger, just below it, or above when below doesn't fit
      left = fitInside(r.left + 24, size.w, vp.w)
      top = r.bottom + size.h <= vp.h - VIEWPORT_MARGIN ? r.bottom : r.top - size.h - 2 >= VIEWPORT_MARGIN ? r.top - size.h - 2 : fitInside(r.bottom, size.h, vp.h)
    }
    setPlace({ left: left - r.left, top: top - r.top, onLeft: left < r.left })
  }, [sub.open]) // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <Presence appear>
      {sub.open && (
        <div ref={ref} id={sub.id} role="menu" aria-label={ariaLabel} aria-labelledby={ariaLabel ? undefined : `${sub.id}-t`} {...props}
          style={place ? { left: place.left, top: place.top } : { visibility: 'hidden' }}
          className={cn(surface.floating, ctxPanelClass, 'absolute z-10 min-w-[180px] p-1', place?.onLeft ? 'origin-top-right' : 'origin-top-left', className)}
          onKeyDown={e => {
            if (e.key === 'ArrowLeft' && (e.target as Element).closest('[data-menu-list]') === e.currentTarget) { e.preventDefault(); e.stopPropagation(); back(); return }
            props.onKeyDown(e)
          }}>
          {children}
        </div>
      )}
    </Presence>
  )
}

/* Dropdown menu ─ */

/** The item list inside DropdownMenu content: arrow keys and typeahead move, Tab or focus leaving the menu closes it. */
function DropdownList({ children }: { children: ReactNode }) {
  const { open, setOpen, triggerRef } = usePopoverPart('DropdownMenu.Content')
  const { ref, props } = useMenuList<HTMLDivElement>({ open, onTab: () => setOpen(false) })
  return (
    <div ref={ref} {...props} className="ui-stagger"
      onBlur={e => { const to = e.relatedTarget as Node | null; if (to && !e.currentTarget.contains(to) && !triggerRef.current?.contains(to)) setOpen(false) }}>
      {children}
    </div>
  )
}

/** DropdownMenu.Root: the menu's open state (`open` + `onOpenChange`, or `defaultOpen`). Wraps trigger and content in an inline box. */
export function DropdownMenuRoot(p: { open?: boolean; defaultOpen?: boolean; onOpenChange?: (open: boolean) => void; children: ReactNode; className?: string }) {
  return <PopoverRoot {...p} />
}
/** DropdownMenu.Trigger: opens the menu on click, Enter, Space or ↓ (aria-haspopup=menu). Button props, or `asChild`. */
export function DropdownMenuTrigger({ onKeyDown, ...p }: ButtonProps) {
  const { open, setOpen } = usePopoverPart('DropdownMenu.Trigger')
  return <PopoverTrigger aria-haspopup="menu" {...p} onKeyDown={e => { onKeyDown?.(e); if (!e.defaultPrevented && !open && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) { e.preventDefault(); setOpen(true) } }} />
}
/** DropdownMenu.Content: the menu panel (role=menu). The first enabled item takes focus and the rest stagger in. `side`, `align`, `sideOffset`, `arrow`. */
export function DropdownMenuContent({ children, className, 'aria-label': ariaLabel, ...float }: FloatProps & { children: ReactNode; className?: string; 'aria-label'?: string }) {
  const { setOpen, triggerRef } = usePopoverPart('DropdownMenu.Content')
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
 * Opens with click, Enter or ↓; the first enabled item takes focus and the rest stagger in. ↑/↓, Home/End and typeahead move;
 * Tab or moving focus away closes it. Parts: DropdownMenu.Root/Trigger/Content/Item/CheckboxItem/RadioGroup/RadioItem/
 * Label/Separator/Group/Sub/SubTrigger/SubContent/Shortcut.
 */
export const DropdownMenu = Object.assign(DropdownMenuConfig, {
  Root: DropdownMenuRoot, Trigger: DropdownMenuTrigger, Content: DropdownMenuContent, Item: MenuItem, CheckboxItem: MenuCheckboxItem,
  RadioGroup: MenuRadioGroup, RadioItem: MenuRadioItem, Label: MenuLabel, Separator: MenuSeparator, Group: MenuGroup,
  Sub: MenuSub, SubTrigger: MenuSubTrigger, SubContent: MenuSubContent, Shortcut: MenuShortcut,
})

/** The menu item parts on their own, with Menu.List for widgets that bring their own panel. */
export const Menu = {
  List: MenuList, Item: MenuItem, CheckboxItem: MenuCheckboxItem, RadioGroup: MenuRadioGroup, RadioItem: MenuRadioItem,
  Label: MenuLabel, Separator: MenuSeparator, Group: MenuGroup, Shortcut: MenuShortcut,
}

export type ContextMenuEntry =
  | { label: string; icon?: IconName; shortcut?: string; danger?: boolean; onSelect?: () => void; items?: ContextMenuEntry[] }
  | '-'
type CtxAt = { x: number; y: number }

type CtxMenuV = { open: boolean; at: CtxAt | null; openAt: (x: number, y: number) => void; close: (refocus?: boolean) => void; area: RefObject<HTMLElement | null> }
const ContextMenuCtx = createContext<CtxMenuV | null>(null)
const useCtxMenu = (part: string) => useRequiredContext(ContextMenuCtx, `<ContextMenu.${part}>`, '<ContextMenu.Root>')
/** The name of a context-menu area (and its menu) when none is given. */
const CTX_LABEL = 'Options'

/** ContextMenu.Root: state for a menu opened at a point. `onOpenChange` reports it; `open={false}` closes it, `open` opens it mid-area. */
export function ContextMenuRoot({ open: openProp, onOpenChange, children }: { open?: boolean; onOpenChange?: (open: boolean) => void; children: ReactNode }) {
  const [at, setAt] = useState<CtxAt | null>(null)
  const area = useRef<HTMLElement>(null)
  const open = openProp ?? !!at
  const now = useRef(open); now.current = open
  const notify = useLatest(onOpenChange)
  const openAt = useCallback((x: number, y: number) => { setAt({ x, y }); if (!now.current) notify.current?.(true) }, [notify])
  const close = useCallback((refocus = false) => {
    setAt(null); if (now.current) notify.current?.(false)
    if (refocus) area.current?.focus({ preventScroll: true })
  }, [notify])
  useLayoutEffect(() => { // controlled from outside: open mid-area, or forget the point when closed
    if (openProp && !at && area.current) { const r = area.current.getBoundingClientRect(); setAt({ x: r.left + r.width / 2, y: r.top + r.height / 2 }) }
    else if (openProp === false && at) setAt(null)
  }, [openProp]) // eslint-disable-line react-hooks/exhaustive-deps
  const value = useMemo(() => ({ open, at, openAt, close, area }), [open, at, openAt, close])
  return <ContextMenuCtx.Provider value={value}>{children}</ContextMenuCtx.Provider>
}

/**
 * ContextMenu.Trigger: the area that opens the menu on right-click, long-press (touch), or the Menu key / Shift+F10 when
 * focused. A focusable named group (`label`, default "Options"); `children` may be a function of `open`. `asChild` puts it on your element.
 */
export function ContextMenuTrigger({ children, className, label = CTX_LABEL, asChild }:
  { children: ReactNode | ((open: boolean) => ReactNode); className?: string; label?: string } & AsChildProps) {
  const { open, openAt, area } = useCtxMenu('Trigger')
  const inArea = (t: EventTarget) => !!area.current?.contains(t as Node)
  // touch: long-press opens the menu just under the finger (the menu's own events bubble here through the portal, hence inArea)
  const hold = useLongPress({ onPress: ({ x, y }) => { haptic(10); openAt(x, y + 10) } })
  const fromArea = <E extends { target: EventTarget }>(fn: (e: E) => void) => (e: E) => { if (inArea(e.target)) fn(e) }
  const props = {
    ref: area as RefObject<HTMLDivElement | null>, tabIndex: 0, role: 'group', 'aria-label': label, 'aria-keyshortcuts': 'Shift+F10 ContextMenu', 'data-state': open ? 'open' : 'closed',
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
 * Home/End and typeahead move; Escape, Tab, an outside click, scroll or resize close it and return focus to the area.
 */
export function ContextMenuContent({ children, className, 'aria-label': ariaLabel }: { children: ReactNode; className?: string; 'aria-label'?: string }) {
  const { open, at, close } = useCtxMenu('Content')
  const [place, setPlace] = useState<{ left: number; top: number; onLeft: boolean } | null>(null)
  const shown = open && !!at
  const { ref: panel, props } = useMenuList<HTMLDivElement>({ open: shown, onEscape: () => close(true), onTab: e => { e.preventDefault(); close(true) } })
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
    const size = { w: el.offsetWidth, h: el.offsetHeight }
    const fit = fitPanel({ anchor: { left: at.x, right: at.x, top: at.y, bottom: at.y }, size, side: 'right', align: 'start', gap: 0 })
    setPlace({ left: fitInside(fit.left, size.w, viewportSize().w), top: fit.top, onLeft: fit.side === 'left' })
  }, [open, at?.x, at?.y]) // eslint-disable-line react-hooks/exhaustive-deps
  const menu = useMemo<MenuCtxV>(() => ({ close }), [close])
  return (
    <OverlayPortal>
      <MenuCtx.Provider value={menu}>
        <Presence appear>
          {shown && (
            <div ref={panel} role="menu" aria-label={ariaLabel} {...props}
              style={{ left: place?.left ?? at.x, top: place?.top ?? at.y, visibility: place ? 'visible' : 'hidden' }}
              className={cn(surface.floating, ctxPanelClass, 'fixed min-w-[200px] p-1', Z.menu, place?.onLeft ? 'origin-top-right' : 'origin-top-left', className)}
              onContextMenu={e => { e.preventDefault(); e.stopPropagation() }}
              // keys stay in the menu: the portal would bubble them to the area's own key handler
              onKeyDown={e => { e.stopPropagation(); props.onKeyDown(e) }}>
              {children}
            </div>
          )}
        </Presence>
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

function ContextMenuConfig({ items, children, className, label = CTX_LABEL, onOpenChange }:
  { items: ContextMenuEntry[]; children: ReactNode | ((open: boolean) => ReactNode); className?: string; label?: string; onOpenChange?: (open: boolean) => void }) {
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

/** Options for useHoverIntent. */
export type HoverIntentOptions = {
  /** ms before a hover or focus opens it (default 300) */ openDelay?: number
  /** ms after the pointer or focus leaves before it closes (default 150) */ closeDelay?: number
  /** ms after which a tapped one hides itself (0: never) */ touchHide?: number
  /** keep it open when the pointer or focus leaves (a pinned card); a tap outside or Escape still closes it */ hold?: boolean
  open?: boolean; defaultOpen?: boolean; onOpenChange?: (open: boolean) => void
}

/**
 * Open state for hover UI that also works by touch: mouse and pen hover (after `openDelay`, closing `closeDelay` ms after
 * leaving), keyboard focus, and a tap on the trigger (spread `tap`) toggles it. Spread `bind` on the wrapper. A tap
 * outside `ref` closes it, and so does Escape wherever focus is, so hover content can be dismissed without moving the
 * pointer. `touchHide` auto-hides a tapped one. `open` + `onOpenChange` control it, or set `defaultOpen`.
 * Returns { open, setOpen, bind, tap }.
 */
export function useHoverIntent(ref: RefObject<HTMLElement | null>, { openDelay = HOVER.cardOpen, closeDelay = HOVER.cardClose, touchHide = 0, hold = false, open, defaultOpen, onOpenChange }: HoverIntentOptions = {}) {
  const [isOpen, setOpen, now] = useOpenState({ open, defaultOpen, onOpenChange })
  const timer = useDelayedToggle(setOpen)
  const tapAt = useRef(0), held = useLatest(hold), controlled = open !== undefined
  useOutside([ref], () => { timer.cancel(); setOpen(false) }, isOpen)
  useEffect(() => {
    if (!isOpen) return
    // capture phase, before any dialog's handler: the first Escape closes the tip, and (uncontrolled) is consumed so the dialog stays
    const key = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return
      if (!controlled) e.preventDefault()
      timer.cancel(); setOpen(false)
    }
    document.addEventListener('keydown', key, true)
    return () => document.removeEventListener('keydown', key, true)
  }, [isOpen, controlled, timer, setOpen])
  const handlers = useMemo(() => {
    const show = () => timer.openIn(openDelay)
    const hide = () => { if (!held.current) timer.closeIn(closeDelay) }
    return {
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
          tapAt.current = Date.now(); timer.cancel()
          const next = !now.current; setOpen(next)
          if (next && touchHide) timer.closeIn(touchHide)
        },
      },
    }
  }, [timer, setOpen, now, held, openDelay, closeDelay, touchHide])
  return { open: isOpen, setOpen, ...handlers }
}

const tipClass = 'flex w-max max-w-[min(20rem,calc(100vw-16px))] items-center gap-1.5 rounded-[var(--r-md)] bg-[var(--primary)] px-2 py-1 text-xs text-[var(--on-primary)] shadow-[var(--shadow)]'

type TipCtxV = { shown: boolean; id: string; wrap: RefObject<HTMLSpanElement | null> }
const TipCtx = createContext<TipCtxV | null>(null)
const useTip = (part: string) => useRequiredContext(TipCtx, `<Tooltip.${part}>`, '<Tooltip.Root>')

/**
 * Tooltip.Root: wraps a Trigger and a Content in an inline box that listens for hover (after `delay` ms), keyboard focus
 * and taps. `open` + `onOpenChange` or `defaultOpen`; `disabled` turns it off. Escape hides it, wherever focus is.
 */
export function TooltipRoot({ open, defaultOpen, onOpenChange, delay = HOVER.tooltipDelay, disabled, children, className, describeSelf }:
  { open?: boolean; defaultOpen?: boolean; onOpenChange?: (open: boolean) => void; delay?: number; disabled?: boolean; children: ReactNode; className?: string
    /** the wrapper itself gets aria-describedby (when the trigger isn't a single element) */ describeSelf?: boolean }) {
  const ref = useRef<HTMLSpanElement>(null)
  const { open: shown, bind, tap } = useHoverIntent(ref, { openDelay: delay, closeDelay: 0, touchHide: HOVER.touchHide, open: disabled ? false : open, defaultOpen, onOpenChange })
  const id = useId()
  const value = useMemo(() => ({ shown, id, wrap: ref }), [shown, id])
  return (
    <TipCtx.Provider value={value}>
      <span ref={ref} className={cn('relative inline-flex', className)} {...bind} {...tap} aria-describedby={describeSelf && shown ? id : undefined}>
        {children}
      </span>
    </TipCtx.Provider>
  )
}
/** Tooltip.Trigger: gets aria-describedby while the tip shows. A plain button, or `asChild` for your own element. */
export function TooltipTrigger({ asChild, children, className, ...p }: HTMLAttributes<HTMLButtonElement> & AsChildProps & { ref?: Ref<HTMLButtonElement> }) {
  const { shown, id } = useTip('Trigger')
  return <PartButton asChild={asChild} aria-describedby={shown ? id : undefined} className={asChild ? className : cn('inline-flex cursor-default items-center border-0 bg-transparent p-0 text-inherit', className)} {...p}>{children}</PartButton>
}
/**
 * Tooltip.Content: the tip (role=tooltip). `side`/`align`/`sideOffset` (or `placement`) and `arrow`, with the same flip
 * and viewport clamp as the other floating parts; `portal` renders it in a fixed layer that escapes `overflow: hidden`
 * parents (it follows its trigger when the page scrolls).
 */
export function TooltipContent({ side, align, sideOffset, placement, arrow, portal, className, children }: FloatProps & { portal?: boolean; className?: string; children: ReactNode }) {
  const { shown, id, wrap } = useTip('Content')
  const want = floatPlacement(side, align, placement ?? 'top-center')
  const box = useRef<HTMLSpanElement>(null)
  const [pos, setPos] = useState<{ left: number; top: number; p: Placement } | null>(null)
  useLayoutEffect(() => {
    if (!shown) { setPos(null); return }
    let retry = 0
    const measure = () => {
      // on a first render already open, the Root's ref isn't attached yet: an inline tip's parent is that wrapper
      const t = box.current, w = wrap.current ?? (portal ? null : t?.offsetParent ?? t?.parentElement)
      if (!t || !w) { retry = requestAnimationFrame(measure); return }
      const r = w.getBoundingClientRect(), s = floatSideOf(want)
      const fit = fitPanel({ anchor: r, size: { w: t.offsetWidth, h: t.offsetHeight }, side: s, align: floatAlignOf(want), gap: gapOf(s, sideOffset) })
      const p = fit.side === s ? want : flipPlacement(want)
      // a portalled tip is fixed (viewport coordinates); an inline one is absolute inside the trigger's wrapper
      setPos(portal ? { left: fit.left, top: fit.top, p } : { left: fit.left - r.left, top: fit.top - r.top, p })
    }
    measure()
    addEventListener('scroll', measure, { capture: true, passive: true }); addEventListener('resize', measure)
    return () => { cancelAnimationFrame(retry); removeEventListener('scroll', measure, { capture: true }); removeEventListener('resize', measure) }
  }, [shown, want, sideOffset, portal, wrap])
  const p = pos?.p ?? want, s = floatSideOf(p)
  const x = s === 'right' ? -4 : s === 'left' ? 4 : 0, y = x ? 0 : s === 'bottom' ? -3 : 3
  const tip = shown && (
    <span ref={box} className={cn('pointer-events-none [--ui-do:.12s]', portal ? cn('fixed', Z.tooltip) : cn('absolute', Z.popover))}
      style={{ left: pos?.left ?? 0, top: pos?.top ?? 0, visibility: pos ? undefined : 'hidden' }}>
      <span id={id} role="tooltip" style={{ '--ui-x': `${x}px`, '--ui-y': `${y}px` } as CSSProperties} className={cn(tipClass, 'ui-in [--ui-d:.12s] [--ui-e:ease-out]', arrow && 'relative', className)}>
        {children}{arrow && <span aria-hidden className={cn('absolute h-2 w-2 rotate-45 bg-[var(--primary)]', floatArrowClass(p, 'tip'))} />}
      </span>
    </span>
  )
  return portal ? <OverlayPortal><Presence appear>{tip}</Presence></OverlayPortal> : <Presence appear>{tip}</Presence>
}

function TooltipConfig({ content, children, placement, delay, portal, disabled, className }:
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
 * shows it (another tap, a tap elsewhere or 2.5 s hides it); Escape hides it. Flips and slides to stay on screen.
 * `portal` renders it in a fixed layer so it escapes `overflow: hidden` parents (collapsed sidebars, scroll areas);
 * `disabled` turns it off. The trigger (a single element child) gets `aria-describedby` while the tip shows, so screen
 * readers announce it. Parts: Tooltip.Root (open state, delay) / Tooltip.Trigger (asChild) / Tooltip.Content (side, align, sideOffset, arrow, portal).
 */
export const Tooltip = Object.assign(TooltipConfig, { Root: TooltipRoot, Trigger: TooltipTrigger, Content: TooltipContent })

type HoverCardCtxV = { shown: boolean; id: string; setOpen: (v: boolean) => void; pinned: boolean; setPinned: (v: boolean) => void; pinOnClick?: boolean
  tap: { onPointerUp: (e: ReactPointerEvent) => void }; lastPointer: RefObject<string> }
const HoverCardCtx = createContext<HoverCardCtxV | null>(null)
const useHoverCard = (part: string) => useRequiredContext(HoverCardCtx, `<HoverCard.${part}>`, '<HoverCard.Root>')

/**
 * HoverCard.Root: hover/focus/tap state in an inline box (`openDelay`, `closeDelay`; `open` + `onOpenChange` or
 * `defaultOpen`). With `pinOnClick`, a mouse click on the trigger pins the card open until another click, an outside click or Escape.
 */
export function HoverCardRoot({ open, defaultOpen, onOpenChange, openDelay, closeDelay, pinOnClick, className, children }:
  { open?: boolean; defaultOpen?: boolean; onOpenChange?: (open: boolean) => void; openDelay?: number; closeDelay?: number; pinOnClick?: boolean; className?: string; children: ReactNode }) {
  const ref = useRef<HTMLSpanElement>(null)
  const [pinned, setPinned] = useState(false)
  const { open: shown, setOpen, bind, tap } = useHoverIntent(ref, {
    openDelay, closeDelay, hold: pinned, open, defaultOpen,
    onOpenChange: v => { if (!v) setPinned(false); onOpenChange?.(v) },
  })
  const lastPointer = useRef('mouse'), id = useId()
  const value = useMemo(() => ({ shown, id, setOpen, pinned, setPinned, pinOnClick, tap, lastPointer }), [shown, id, setOpen, pinned, pinOnClick, tap])
  return (
    <HoverCardCtx.Provider value={value}>
      <span ref={ref} className={cn('relative inline-block', className)} {...bind}>{children}</span>
    </HoverCardCtx.Provider>
  )
}
/** HoverCard.Trigger: what you hover (a link, a name); described by the card while it shows. Wraps its children in a span, or with `asChild` becomes your element. */
export function HoverCardTrigger({ children, asChild }: { children: ReactNode } & AsChildProps) {
  const c = useHoverCard('Trigger')
  const props = {
    ...c.tap, 'aria-describedby': c.shown ? c.id : undefined, 'aria-expanded': c.pinOnClick ? c.shown : undefined,
    onPointerDown: (e: ReactPointerEvent) => { c.lastPointer.current = e.pointerType },
    onClick: () => { if (!c.pinOnClick || c.lastPointer.current === 'touch') return; const next = !c.pinned; c.setPinned(next); c.setOpen(next) },
  }
  return asChild ? <Slot {...props}>{children}</Slot> : <span {...props}>{children}</span>
}
/** HoverCard.Content: the card (spans, so it is valid inside a `<p>`). `side`/`align`/`sideOffset` (or `placement`, default top-start) and `arrow`; it slides to stay on screen. */
export function HoverCardContent({ side, align, sideOffset, placement, arrow, className, children }: FloatProps & { className?: string; children: ReactNode }) {
  const { shown, id } = useHoverCard('Content')
  return (
    <FloatingPanel open={shown} id={id} inline placement={floatPlacement(side, align, placement ?? 'top-start')} offset={sideOffset} arrow={arrow} role="tooltip"
      className={cn('w-[250px] p-3 text-[13px] leading-snug', className)}>{children}</FloatingPanel>
  )
}

function HoverCardConfig({ trigger, children, placement, pinOnClick, className, triggerClassName }:
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
 * tapping the trigger toggles it and tapping outside closes it; Escape closes it. With `pinOnClick`, a mouse click on the
 * trigger pins the card open (leaving no longer closes it) until another click, an outside click or Escape. The card
 * slides to stay on screen, and is built from spans so it can sit inside a paragraph.
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
  const vw = viewportSize().w, right = t.x + 14 + box.w <= vw - VIEWPORT_MARGIN
  const left = fitInside(right ? t.x + 14 : t.x - 14 - box.w, box.w, vw)
  const top = Math.max(VIEWPORT_MARGIN, t.y - (t.touch ? box.h + 30 : 44))
  return createPortal(
    <div ref={el} role="tooltip" className={cn(surface.floating, 'pointer-events-none fixed w-max max-w-[calc(100vw-16px)] rounded-[var(--r-md)] px-2 py-1.5 text-xs leading-snug text-[var(--fg)] transition-opacity duration-150', Z.tooltip, className)}
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
/** Is the page's vertical scrollbar on the left (some browser and OS settings put it there)? */
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
      if (gap > 0) body.style[side] = `${(parseFloat(getComputedStyle(body)[side]) || 0) + gap}px`
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
 * Escape and outside click to close (`onOutsideClick` overrides the click), and exit animations for the panel you render inside (give it, or an element
 * in a positioning wrapper, the `ui-in` class with its `--ui-*` offsets: it leaves the way it came in). While open the rest of
 * the page is `inert`, and Escape and Tab are handled at document level, so they work even when focus is outside the
 * panel. Nested modals stack: only the top one closes on Escape, and closing it hands the page back to the one below.
 */
export function ModalLayer({ open, onClose, onOutsideClick, onExitComplete, children }: { open: boolean; onClose: () => void
  /** a click on the backdrop calls this instead of closing (AlertDialog: shake, don't dismiss) */ onOutsideClick?: () => void
  /** after the closing animation has finished and the layer is gone */ onExitComplete?: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null)
  const close = useRef(onClose); close.current = onClose
  const layer = usePresence<HTMLDivElement>(open, { appear: true }), exited = useLatest(onExitComplete)
  const was = useRef(layer.mounted)
  useEffect(() => { if (was.current && !layer.mounted) exited.current?.(); was.current = layer.mounted }, [layer.mounted, exited])
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
      {layer.mounted && (
        <div ref={composeRefs(ref, layer.ref)} {...presenceProps(layer)} className="ui-layer contents" onKeyDown={e => { if (e.key === 'Escape' && !e.defaultPrevented) { e.stopPropagation(); onClose() } }}>
          <div className={cn('ui-in fixed inset-0 bg-black/40 [--ui-d:.2s] [--ui-do:.2s] [--ui-e:linear]', Z.scrim)} onClick={onOutsideClick ?? onClose} aria-hidden />
          {children}
        </div>
      )}
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
const useDialogCtx = (part: string) => useRequiredContext(DialogCtx, `<${part}>`, '<Dialog.Root>, <Sheet.Root> or <AlertDialog.Root>')

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
/** Dialog.Close: closes it. With no children it is the ✕ icon button ("Close"); otherwise a Button, or `asChild`. */
export function DialogClose({ children, ...p }: ButtonProps) {
  const { setOpen } = useDialogCtx('Dialog.Close')
  if (children === undefined && !p.asChild) {
    const { onClick, ...rest } = p
    return <IconButton icon="x" label="Close" {...rest} onClick={partClick(onClick, () => setOpen(false))} />
  }
  return <OverlayPartButton {...p} action={() => setOpen(false)}>{children}</OverlayPartButton>
}
/** Register a Title or Description while it is mounted, so the panel only points aria-labelledby/-describedby at ids that exist. */
function useDialogPart(k: DialogPart, part: string) {
  const c = useDialogCtx(part), set = c.setPart
  useLayoutEffect(() => { set(k, true); return () => set(k, false) }, [k, set])
  return c.ids[k]
}
/** What every dialog panel carries: its role, aria-modal, and its name (`aria-label`, else the mounted Title) and description (the mounted Description). */
function useDialogA11y(role: 'dialog' | 'alertdialog', ariaLabel: string | undefined, part: string) {
  const { ids, parts } = useDialogCtx(part)
  return { role, 'aria-modal': true, 'aria-label': ariaLabel, 'aria-labelledby': !ariaLabel && parts.title ? ids.title : undefined, 'aria-describedby': parts.desc ? ids.desc : undefined } as const
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
      <Presence>
        {!!alert?.err && (
          <div role="alert" className="ui-grow [--ui-d:.18s] [--ui-do:.18s]">
            <div><p className="m-0 mt-3 flex items-start gap-1.5 text-[13px] text-[var(--bad)]"><Icon name="alert" size={14} className="mt-0.5 flex-none" />{alert.err}</p></div>
          </div>
        )}
      </Presence>
      {row}
    </>
  )
}

const dialogFrame = 'pointer-events-none fixed inset-0 grid place-items-center px-[max(16px,env(safe-area-inset-left),env(safe-area-inset-right))] pt-[max(16px,env(safe-area-inset-top))] pb-[max(16px,env(safe-area-inset-bottom))] ' + Z.modal
const dialogPanel = 'pointer-events-auto max-h-full w-full max-w-[420px] overflow-auto overscroll-contain rounded-[var(--r-lg)] border border-[var(--line)] bg-[var(--card)] p-5 shadow-[var(--shadow)]'
const dialogMotion = 'ui-in [--ui-d:.4s] [--ui-s:.94] [--ui-so:.96] [--ui-y:8px] [--ui-yo:0]'

/**
 * Dialog.Content: the modal panel (role=dialog, aria-modal) in a ModalLayer: springs in, backdrop fades, focus is trapped,
 * Escape and an outside click close it. Fits small screens: keeps clear of the safe areas and scrolls inside when tall.
 */
export function DialogContent({ className, children, 'aria-label': ariaLabel }: { className?: string; children: ReactNode; 'aria-label'?: string }) {
  const { open, setOpen } = useDialogCtx('Dialog.Content'), a11y = useDialogA11y('dialog', ariaLabel, 'Dialog.Content')
  return (
    <ModalLayer open={open} onClose={() => setOpen(false)}>
      <div className={dialogFrame}>
        <div {...a11y} className={cn(dialogPanel, dialogMotion, className)}>
          <DialogKindCtx.Provider value="dialog">{children}</DialogKindCtx.Provider>
        </div>
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

/** The edges a Sheet can slide in from: its placement and the offset it slides from (and back to). */
const SHEET = {
  right: 'top-0 right-0 bottom-0 w-[min(380px,92vw)] pt-[max(20px,env(safe-area-inset-top))] pb-[max(20px,env(safe-area-inset-bottom))] [--ui-x:100%]',
  left: 'top-0 left-0 bottom-0 w-[min(380px,92vw)] pt-[max(20px,env(safe-area-inset-top))] pb-[max(20px,env(safe-area-inset-bottom))] [--ui-x:-100%]',
  bottom: 'inset-x-0 bottom-0 max-h-[85dvh] rounded-t-[var(--r-lg)] !pt-2 pb-[max(20px,env(safe-area-inset-bottom))] [--ui-y:100%]',
}
/** The edge a Sheet slides in from (`start` = left, `end` = right, the default); `bottom` is a bottom sheet. */
export type SheetSide = 'start' | 'end' | 'left' | 'right' | 'bottom'
const sheetEdge = (side: SheetSide): keyof typeof SHEET => side === 'start' ? 'left' : side === 'end' ? 'right' : side
/** Below this width a left or right Sheet opens as a bottom sheet instead. */
const SHEET_BOTTOM_BELOW = 640
type SheetGrab = { onPointerDown: (e: ReactPointerEvent) => void; className: string } | null
const SheetGrabCtx = createContext<SheetGrab>(null)

/**
 * Sheet.Content: the panel that slides in from `side` (`end` or `right` by default, `start` or `left`, or `bottom`).
 * Below 640px a side sheet becomes a bottom sheet (`responsive={false}` keeps the edge drawer); crossing that width
 * while open restyles the same panel, so what is typed in it and the focus survive. A bottom sheet has a grab handle:
 * drag it, or the Sheet.Header, down to dismiss.
 */
export function SheetContent({ side = 'end', responsive = true, className, children, 'aria-label': ariaLabel }:
  { side?: SheetSide; responsive?: boolean; className?: string; children: ReactNode; 'aria-label'?: string }) {
  const { open, setOpen } = useDialogCtx('Sheet.Content'), a11y = useDialogA11y('dialog', ariaLabel, 'Sheet.Content')
  const narrow = useMediaQuery(`(max-width: ${SHEET_BOTTOM_BELOW - 1}px)`)
  const edge = responsive && narrow ? 'bottom' : sheetEdge(side)
  const bottom = edge === 'bottom'
  const panel = useRef<HTMLDivElement>(null)
  // dragged down far or fast enough, a bottom sheet closes from where it was let go; it can't be pulled up
  const swipe = useLatest(useSwipe(panel, { axis: 'y', elastic: [0, 0.9], slop: 0, onRelease: ({ offset, velocity }) => { if (offset <= 90 && velocity <= 500) return false; setOpen(false); return true } }))
  const grab = useMemo<SheetGrab>(() => bottom ? { onPointerDown: (e: ReactPointerEvent) => swipe.current(e), className: 'touch-none' } : null, [bottom, swipe])
  return (
    <ModalLayer open={open} onClose={() => setOpen(false)}>
      <div ref={panel} data-side={edge} {...a11y}
        className={cn('ui-in fixed flex flex-col gap-3 overflow-auto overscroll-contain bg-[var(--card)] px-5 shadow-[var(--shadow)] [--ui-d:.4s] [--ui-do:.25s] [--ui-e:var(--ui-spring-soft)] [--ui-o:1]', Z.modal, SHEET[edge], className)}>
        {grab && <div aria-hidden {...grab} className="-mx-5 -mb-2 flex flex-none cursor-grab justify-center pt-1 pb-2 touch-none"><span className="h-1 w-9 rounded-full bg-[var(--line2)]" /></div>}
        <DialogKindCtx.Provider value="sheet"><SheetGrabCtx.Provider value={grab}>{children}</SheetGrabCtx.Provider></DialogKindCtx.Provider>
      </div>
    </ModalLayer>
  )
}
/** Sheet.Header: the title row (title at the start, close at the end). On a bottom sheet it is also a drag handle (not from its buttons and fields). */
export function SheetHeader({ className, children }: { className?: string; children: ReactNode }) {
  const grab = useContext(SheetGrabCtx)
  const down = grab && ((e: ReactPointerEvent) => { if (!(e.target as Element).closest('button,a,input,select,textarea,[role=button]')) grab.onPointerDown(e) })
  return <div className={cn('flex flex-none items-center justify-between', grab?.className, className)} onPointerDown={down || undefined}>{children}</div>
}

function SheetConfig({ open, onOpenChange, title, side, responsive, children, footer, className }:
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
const useAlert = (part: string) => useRequiredContext(AlertCtx, `<AlertDialog.${part}>`, '<AlertDialog.Content>')

/**
 * AlertDialog.Content: the confirmation panel (role=alertdialog). An outside click doesn't close it (it shakes); Escape
 * and Cancel do (`onCancel` runs). While an Action's promise is pending both buttons wait; a rejection shows its message.
 */
export function AlertDialogContent({ className, children, onCancel, 'aria-label': ariaLabel }:
  { className?: string; children: ReactNode; /** Escape or Cancel */ onCancel?: () => void; /** names it when it has no Title */ 'aria-label'?: string }) {
  const { open, setOpen } = useDialogCtx('AlertDialog.Content'), a11y = useDialogA11y('alertdialog', ariaLabel, 'AlertDialog.Content')
  const [pending, setPending] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const panel = useRef<HTMLDivElement>(null)
  const gen = useGeneration()
  // closed and reopened from outside while an action was pending: that action's late result belongs to the old opening
  useEffect(() => { gen.invalidate(); if (open) { setErr(null); setPending(false) } }, [open, gen])
  const cancel = () => { if (pending) return; onCancel?.(); setOpen(false) }
  const confirm = async (fn: () => void | Promise<unknown>) => {
    if (pending) return
    setErr(null)
    const current = gen.next()
    try {
      const r = fn()
      if (r && typeof (r as Promise<unknown>).then === 'function') { setPending(true); panel.current?.focus({ preventScroll: true }); await r } // the buttons disable while it waits: keep focus in the dialog
      if (!current()) return
      setPending(false); setOpen(false)
    } catch (e) {
      if (!current()) return
      setPending(false); setErr((e instanceof Error ? e.message : String(e ?? '')) || 'Something went wrong. Try again.')
    }
  }
  return (
    <ModalLayer open={open} onClose={cancel} onOutsideClick={() => shake(panel.current)}>
      <div className={dialogFrame}>
        <div ref={panel} tabIndex={-1} {...a11y} aria-busy={pending || undefined} className={cn(dialogPanel, dialogMotion, 'outline-none', className)}>
          <DialogKindCtx.Provider value="alert"><AlertCtx.Provider value={{ pending, err, confirm, cancel }}>{children}</AlertCtx.Provider></DialogKindCtx.Provider>
        </div>
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
const cmdkFlatten = (cs: Command[]): Command[] => cs.flatMap(c => [c, ...cmdkFlatten(c.children ?? [])])
/** Result lists longer than this are virtualised. */
const CMDK_VIRTUAL_AT = 60
/** The stored recent ids (newest first), or [] when storage is blocked or holds junk. */
function cmdkStoredRecents(key: string | undefined): string[] {
  if (!key) return []
  try {
    const ids: unknown = JSON.parse(localStorage.getItem(key) ?? '[]')
    return Array.isArray(ids) ? ids.filter((id): id is string => typeof id === 'string') : []
  } catch { return [] }
}
/** A palette row: a group heading (the Recent group or a named one) or the hit at index `hit` of the result list. */
type CmdkRow = { kind: 'heading'; recent: boolean; group: string } | { kind: 'option'; hit: number }

/**
 * ⌘K palette: type to filter (every word must match the label, keywords or hint), arrows to move, Enter to run.
 * Groups keep together under their headings. Shows which keyword matched, marks the active row with ↵, and suggests
 * a query when nothing matches. `loadItems(query, { signal })` adds results from your API (debounced by `debounce` ms,
 * the previous request aborted, a spinner while loading, errors shown). Entries with `children` / `loadChildren` open
 * nested pages (Enter in, Backspace on an empty search out, or click the breadcrumb). `recents` keeps the last N
 * entries run as a Recent group (persisted under `recentKey`; ids that are no longer in `commands` drop out). Long result
 * lists are virtualised. A chosen command runs as the palette closes, once focus is back where it was;
 * `onExitComplete` fires when its closing animation has finished (for work that needs the page uncovered).
 */
export function CommandPalette({ open, onOpenChange, commands, placeholder, suggestion, loadItems, debounce = 150, recents = 0, recentKey, onExitComplete, className }:
  ModalProps & { commands: Command[]; placeholder?: string; suggestion?: string; loadItems?: CommandLoader; /** ms */ debounce?: number
    /** how many recently run entries to offer when the search is empty (0: none) */ recents?: number; /** localStorage key for recents */ recentKey?: string
    /** after the palette has closed and its exit animation finished */ onExitComplete?: () => void; className?: string }) {
  const [q, setQ] = useState('')
  const [stack, setStack] = useState<{ c: Command; q: string }[]>([])
  const uid = useId()
  useEffect(() => { if (open) { setQ(''); setStack([]) } }, [open])
  const top = stack[stack.length - 1]?.c
  const pageName = top?.label.replace(/(…|\.{3})$/, '')
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

  /* recents: only ids are kept, and the rows come from the current commands, so late or changed commands show up as they are */
  const [recentIds, setRecentIds] = useState<string[]>([])
  useEffect(() => { if (recents) setRecentIds(cmdkStoredRecents(recentKey)) }, [recentKey, recents])
  const byId = useMemo(() => new Map(cmdkFlatten(commands).map(c => [c.id, c])), [commands])
  const remember = (id: string) => {
    if (!recents) return
    const next = [id, ...recentIds.filter(x => x !== id)].slice(0, recents)
    setRecentIds(next)
    if (recentKey) try { localStorage.setItem(recentKey, JSON.stringify(next)) } catch { /* storage blocked: recents last for this visit */ }
  }

  const list = useMemo((): CmdkHit[] => {
    const showRecent = !stack.length && !q.trim() && recents > 0
    const r = showRecent ? recentIds.flatMap(id => { const c = byId.get(id); return c ? [{ c, labelHit: false, tags: [], recent: true }] : [] }).slice(0, recents) : []
    return [...r, ...cmdkFilter(pageCommands, q), ...asyncItems.map((c): CmdkHit => ({ c, labelHit: false, tags: [] }))]
  }, [pageCommands, q, asyncItems, recentIds, byId, stack.length, recents])
  const words = q.toLowerCase().trim().split(/\s+/).filter(Boolean)
  const choose = (i: number) => {
    const h = list[i]; if (!h) return
    const c = h.c
    if (c.children || c.loadChildren) { setStack(s => [...s, { c, q }]); setQ(''); return }
    remember(c.id)
    onOpenChange(false)
    // after React commits the close and the focus trap has queued its focus restore, still inside the user's gesture:
    // a command that opens another dialog then records the right element to return focus to
    queueMicrotask(() => c.run?.())
  }
  const back = (to = stack.length - 1) => { if (to < 0 || to >= stack.length) return; setQ(stack[to].q); setStack(s => s.slice(0, to)) }
  const { active, setActive, onKeyDown } = useRoving(list.length, choose, { homeEnd: false })
  useEffect(() => setActive(0), [q, pageKey, setActive])
  const inputRef = useRef<HTMLInputElement>(null)
  useEffect(() => { if (open && stack.length) inputRef.current?.focus() }, [pageKey]) // eslint-disable-line react-hooks/exhaustive-deps

  /* rows: group headings interleaved with entries; virtualised when long */
  const rows = useMemo(() => {
    const out: CmdkRow[] = [], at: number[] = []
    let prev: { recent: boolean; group: string } | null = null
    list.forEach((h, i) => {
      const g = { recent: !!h.recent, group: h.recent ? '' : h.c.group ?? '' }
      if ((g.recent || g.group) && (!prev || prev.recent !== g.recent || prev.group !== g.group)) out.push({ kind: 'heading', ...g })
      prev = g
      at.push(out.length); out.push({ kind: 'option', hit: i })
    })
    return { out, at }
  }, [list])
  const coarse = useCoarsePointer()
  const virtualOn = list.length > CMDK_VIRTUAL_AT
  const listRef = useRef<HTMLDivElement>(null)
  const est = useCallback((i: number) => rows.out[i]?.kind === 'heading' ? 29 : coarse ? 40 : 36, [rows, coarse])
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
        {!virtualOn && i === active && <ActiveIndicator group={`${uid}-active`} className="rounded-[var(--r-md)] bg-[var(--muted)]" transition={spring(0.15, 0.25)} />}
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
  const row = (r: CmdkRow) => r.kind === 'heading' ? <MenuLabel>{r.recent ? 'Recent' : r.group}</MenuLabel> : option(r.hit)
  const rowKey = (r: CmdkRow, k: number) => r.kind === 'heading' ? `h:${r.recent ? '' : r.group}:${k}` : `o:${list[r.hit].recent ? 'r' : 'c'}:${list[r.hit].c.id}:${r.hit}`
  const empty = list.length === 0 && (
    <EmptyState size="sm" className="p-6" title={loading ? 'Searching…' : found.error && found.page === pageKey ? null : <>{`Nothing matches “${q}”.`}{!stack.length && suggest && <> Try <button className="cursor-pointer border-0 bg-transparent p-0 font-medium text-[var(--accent)] underline-offset-2 hover:underline" onClick={() => setQ(suggest)}>{`“${suggest}”`}</button></>}</>} />
  )
  return (
    <ModalLayer open={open} onClose={() => onOpenChange(false)} onExitComplete={onExitComplete}>
      <div role="dialog" aria-modal="true" aria-label="Command palette"
        className={cn(surface.floating, 'ui-in [--ui-d:.35s] [--ui-do:.12s] [--ui-s:.96] [--ui-so:.98] [--ui-y:-8px] [--ui-yo:0] fixed top-[14vh] left-1/2 w-[min(540px,calc(100%-32px))] -translate-x-1/2 overflow-hidden max-[640px]:top-[max(12px,env(safe-area-inset-top))] [@media(max-height:500px)]:top-[max(8px,env(safe-area-inset-top))]', Z.palette, className)}>
        <div className="flex items-center gap-2 border-b border-[var(--line)] px-4">
          <Icon name="search" className="flex-none text-[var(--fg3)]" />
          {stack.length > 0 && (
            <nav aria-label="Palette pages" className="flex min-w-0 flex-none items-center gap-1 text-xs text-[var(--fg3)]">
              {stack.map((s, i) => (
                <span key={s.c.id} className="flex items-center gap-1">
                  <button onClick={() => back(i)} title={`Back to ${i ? stack[i - 1].c.label : 'all commands'}`}
                    className={cn('max-w-[120px] cursor-pointer truncate rounded-[var(--r-sm)] border-0 bg-[var(--muted)] px-1.5 py-0.5 text-xs text-[var(--fg2)] hover:text-[var(--fg)]', TOUCH.target)}>{s.c.label}</button>
                  <span aria-hidden>/</span>
                </span>
              ))}
            </nav>
          )}
          <input ref={inputRef} data-autofocus value={q} onChange={e => setQ(e.target.value)} placeholder={top?.placeholder ?? (pageName ? `Search ${pageName.toLowerCase()}…` : placeholder ?? 'Type a command or search…')}
            onKeyDown={e => { if (e.key === 'Backspace' && !q && stack.length) { e.preventDefault(); back(); return } onKeyDown(e) }}
            role="combobox" aria-expanded="true" aria-controls={`${uid}-list`} aria-autocomplete="list" aria-busy={loading || undefined}
            aria-activedescendant={list[active] ? optionId(active) : undefined} aria-label={pageName ? `Search ${pageName}` : 'Search commands'}
            className="w-full min-w-0 border-0 bg-transparent py-3 text-base outline-none" />
          {loading && <Spinner size={14} label="Loading results" className="text-[var(--fg3)]" />}
        </div>
        {asyncOn && found.error && found.page === pageKey && (
          <div role="alert" className="flex items-center gap-1.5 border-b border-[var(--line)] px-4 py-2 text-xs text-[var(--bad)]"><Icon name="alert" size={13} />{found.error}</div>
        )}
        {virtualOn ? (
          <div ref={listRef} id={`${uid}-list`} role="listbox" aria-label="Results" className="relative h-[min(340px,50vh)] overflow-auto overscroll-contain px-1.5 max-[640px]:h-[min(420px,60dvh)]">
            <div style={{ height: v.totalSize, position: 'relative' }}>
              {v.items.map(it => (
                <div key={rowKey(rows.out[it.index], it.index)} data-index={it.index} ref={v.measureElement}
                  style={{ position: 'absolute', top: 0, insetInlineStart: 0, width: '100%', transform: `translateY(${it.start}px)` }}>
                  {row(rows.out[it.index])}
                </div>
              ))}
            </div>
          </div>
        ) : (
          <div ref={listRef} id={`${uid}-list`} role="listbox" aria-label="Results" className="max-h-[min(340px,50vh)] overflow-auto overscroll-contain p-1.5 max-[640px]:max-h-[min(420px,60dvh)]">
            {empty}
            {rows.out.map((r, k) => <Fragment key={rowKey(r, k)}>{row(r)}</Fragment>)}
          </div>
        )}
        <div className="flex gap-3 border-t border-[var(--line)] px-3 py-2 text-[11px] text-[var(--fg3)] [@media(hover:none)]:hidden">
          <span><Kbd>↑</Kbd> <Kbd>↓</Kbd> move</span><span><Kbd>↵</Kbd> {list[active]?.c.children || list[active]?.c.loadChildren ? 'open' : 'run'}</span>
          {stack.length > 0 && <span><Kbd>⌫</Kbd> back</span>}<span><Kbd>esc</Kbd> close</span>
          <span className="ms-auto ui-num" aria-live="polite">{loading ? '' : plural(list.length, 'result', 'results', { zero: 'No results' })}</span>
        </div>
      </div>
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
      {saves > 0 && <span key={`f${saves}`} aria-hidden className="ui-in absolute inset-0 rounded-[var(--r-md)] bg-[var(--ok-soft)] opacity-0 [--ui-d:.9s] [--ui-e:ease-out] [--ui-o:1]" />}
      <span key={saves} className={cn('relative truncate', saves > 0 && 'ui-in [--ui-o:.3] [--ui-x:-3px]')}>{value}<span className="sr-only">{label ? `, edit ${label}` : ', edit'}</span></span>
      <Icon name="edit" size={14} className="relative text-[var(--fg3)] opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100 [@media(hover:none)]:opacity-100" />
    </button>
  )
  if (helper === undefined) return field
  return (
    <div className="flex min-w-0 flex-col items-start gap-0.5">
      {field}
      <Swap k={saves ? 'saved' : 'helper'} mode="wait">
        <span aria-live="polite" className={cn('ui-in text-xs [--ui-d:.15s] [--ui-e:ease-out] [--ui-y:3px] [--ui-yo:-3px]', saves ? 'text-[var(--ok)]' : 'text-[var(--fg3)]')}>{saves ? savedHelper ?? 'Saved just now' : helper}</span>
      </Swap>
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
  const prev = useRef(unread), bell = useRef<HTMLSpanElement>(null)
  useEffect(() => { if (unread > prev.current) play(bell.current, { rotate: [0, -14, 12, -8, 6, 0] }, { duration: 0.5 }); prev.current = unread }, [unread])
  const cascade = useRef(false)
  const shown = items.slice(0, max)
  // the dots clear one after another (60 ms apart, each spring about 200 ms); later clicks clear at once
  const markAll = () => { cascade.current = true; onChange(items.map(n => ({ ...n, read: true }))); setTimeout(() => { cascade.current = false }, shown.length * 60 + 200) }
  return (
    <Popover className={className}>
      <PopoverTrigger size="icon" aria-label={`Notifications, ${unread} unread`} className="!overflow-visible">
        <span ref={bell} className="inline-flex origin-top"><Icon name="bell" /></span>
        <Presence appear>
          {unread > 0 && (
            <span className="ui-in pointer-events-none absolute -top-1.5 -end-1.5 grid h-5 min-w-5 place-items-center rounded-full border-2 border-[var(--card)] bg-[var(--bad)] px-1 text-[11px] font-semibold text-[var(--card)] [--ui-d:.4s] [--ui-e:var(--ui-spring-pop)] [--ui-o:1] [--ui-s:0]">
              <AnimatedNumber value={unread} />
            </span>
          )}
        </Presence>
      </PopoverTrigger>
      <PopoverContent className="w-[min(300px,calc(100vw-32px))] overflow-hidden !p-0">
        <div className="flex items-center justify-between border-b border-[var(--line)] px-3 py-2"><b className="text-[13px]">Notifications</b>
          <Button size="sm" variant="ghost" disabled={!unread} onClick={markAll}>Mark all read</Button></div>
        {items.length === 0 ? <EmptyState icon="bell" title="You’re all caught up" /> : (
          <div role="list">
            <PresenceList items={shown} keyOf={n => n.id} appear>
              {(n, { index: i }) => (
                // slides in after the rows above it; removed, the row closes (ui-grow's exit)
                <div role="listitem" style={{ '--ui-delay': `${i * 0.04}s` } as CSSProperties}
                  className="ui-grow border-b border-[var(--line)] last:border-b-0 [--ui-do:.15s] [--ui-x:-6px] [&:not([data-ui-exit])]:[animation:ui-in_.35s_var(--ui-spring)_var(--ui-delay,0s)_backwards]">
                  <div>
                    <button onClick={() => onChange(items.map(x => x.id === n.id ? { ...x, read: true } : x))}
                      className="flex w-full cursor-pointer gap-2.5 border-0 bg-transparent px-3 py-2.5 text-start text-xs hover:bg-[var(--muted)]">
                      <span className="mt-1 h-[7px] w-[7px] flex-none rounded-full bg-[var(--accent)] motion-reduce:!transition-none"
                        style={{ scale: n.read ? '0' : '1', transition: `scale .3s var(--ui-spring) ${cascade.current ? i * 0.06 : 0}s` }} />
                      <span className="flex-1"><span className="block text-[13px]">{n.title}</span>{n.body && <span className="text-[var(--fg2)]">{n.body}</span>}<span className="block text-[var(--fg3)]">{n.time}</span></span>
                    </button>
                  </div>
                </div>
              )}
            </PresenceList>
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
 * `step` is the open step (-1 = closed). Next/Done, Skip, ←/→ (not while typing in a field) and Escape work.
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
    const left = fitInside(x, tw, SW)
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
  const move = placed.current ? 'left .45s var(--ui-spring), top .45s var(--ui-spring)' : undefined
  return (
    <div ref={wrap} className={cn('relative overflow-hidden rounded-[var(--r-md)]', className)}
      onKeyDown={e => {
        if (!open) return
        if (e.key === 'Escape') { e.stopPropagation(); go(-1) }
        else if (isEditableTarget(e.target)) return
        else if (e.key === 'ArrowRight') go(i + 1)
        else if (e.key === 'ArrowLeft' && i > 0) go(i - 1)
      }}>
      {children}
      <Presence appear>
        {open && geo && (
          <div aria-hidden style={{ translate: `${geo.x}px ${geo.y}px`, width: geo.w, height: geo.h }}
            className="ui-in pointer-events-none absolute top-0 left-0 z-[5] rounded-[var(--r-md)] shadow-[0_0_0_9999px_rgba(0,0,0,.45)] transition-[translate,width,height] duration-500 ease-[var(--ui-spring)] [--ui-d:.25s] [--ui-do:.2s] [--ui-e:linear] motion-reduce:transition-none" />
        )}
      </Presence>
      <Presence appear>
        {s && (
          <div ref={tip} role="dialog" aria-label="Product tour" aria-live="polite"
            style={{ left: geo?.left, top: geo?.top, visibility: geo ? 'visible' : 'hidden', transition: move }}
            className={cn(surface.floating, 'ui-in absolute top-0 left-0 z-[6] w-[min(250px,calc(100%-16px))] rounded-[var(--r-md)] p-3 text-[13px] [--ui-d:.35s] [--ui-y:8px]')}>
            {geo && <span aria-hidden className={cn('absolute h-2.5 w-2.5 border-[var(--line)] bg-[var(--card)]',
              geo.above ? '-bottom-[6px] rotate-[225deg] border-t border-l' : '-top-[6px] rotate-45 border-t border-l')} style={{ left: geo.ax }} />}
            <div key={i} className="ui-in [--ui-d:.2s] [--ui-e:ease-out] [--ui-x:6px]">
              <b className="block font-semibold">{s.title}</b>
              {s.body && <div className="mt-1 mb-3 text-xs leading-normal text-[var(--fg3)]">{s.body}</div>}
            </div>
            <div className="flex items-center justify-between gap-2">
              <span className="ui-num text-xs text-[var(--fg3)]">{`${i + 1} of ${steps.length}`}</span>
              <div className="flex gap-1.5">
                {i < steps.length - 1 && <Button size="sm" variant="ghost" onClick={() => go(-1)}>Skip</Button>}
                <Button ref={next} size="sm" variant="primary" onClick={() => go(i + 1)}>{i === steps.length - 1 ? 'Done' : 'Next'}</Button>
              </div>
            </div>
          </div>
        )}
      </Presence>
    </div>
  )
}
