import { createContext, useCallback, useContext, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type ButtonHTMLAttributes, type HTMLAttributes, type ReactNode, type Ref, type KeyboardEvent as RKeyboardEvent, type MouseEvent as ReactMouseEvent } from 'react'
import { AnimatePresence, motion, type Variants } from 'motion/react'
import { type AsChildProps, Avatar, Button, type ButtonProps, Icon, IconButton, type IconName, ScrollEdges, StatusIcon, cn, prefersReducedMotion, safeUrl, spring, useCoarsePointer, useComposedRefs, useControllable, useHotkey, useOutside, useScrollEdges, fmt, useResizeObserver, useRequiredContext, PartButton, focusStep, focusables, idPart, useLatest } from './core'
import { ActiveIndicator } from './fields'
import { Tooltip } from './overlay'

/**
 * Values registered by the items of a composite (tabs, toggle group) in mount order, with their disabled flag, so the
 * root knows which item is the Tab stop when none is selected.
 */
function useNavRegistry() {
  const [items, setItems] = useState<{ value: string; disabled: boolean }[]>([])
  const register = useCallback((value: string, disabled: boolean) => {
    setItems(a => { const i = a.findIndex(x => x.value === value); if (i >= 0 && a[i].disabled === disabled) return a; const next = [...a]; if (i >= 0) next[i] = { value, disabled }; else next.push({ value, disabled }); return next })
    return () => setItems(a => a.filter(x => x.value !== value))
  }, [])
  return [items, register] as const
}
/** The first enabled registered value. */
const navFirst = (items: { value: string; disabled: boolean }[]) => items.find(x => !x.disabled)?.value
/** The items of the composite `root` that match `sel`, without those of a composite nested inside it. */
const navOwn = (root: HTMLElement, sel: string, owner: string) => [...root.querySelectorAll<HTMLElement>(sel)].filter(el => el.closest(owner) === root)

export type TabItem = { value: string; label: ReactNode; content?: ReactNode; badge?: ReactNode }

type TabsCtxV = {
  value: string; select: (v: string) => void; base: string; group: string; orientation: 'horizontal' | 'vertical'; manual: boolean
  lazy: boolean; keepMounted: boolean; visited: Set<string>; switched: boolean
  tabs: { value: string; disabled: boolean }[]; registerTab: (v: string, disabled: boolean) => () => void
  panels: Set<string>; registerPanel: (v: string) => () => void
}
const TabsCtx = createContext<TabsCtxV | null>(null)
const useTabs = (part: string) => useRequiredContext(TabsCtx, `<Tabs.${part}>`, '<Tabs.Root>')

/**
 * Tabs.Root: the selected tab (`value` + `onValueChange`, or `defaultValue`). `orientation="vertical"` puts the list
 * beside the panels (↑/↓ move); `activationMode="manual"` makes arrows only move focus (Enter/Space select). Panels
 * unmount when hidden unless `keepMounted` (all stay mounted, hidden) or `lazy` (each mounts on first visit, then stays).
 */
export function TabsRoot({ value, defaultValue = '', onValueChange, onChange, orientation = 'horizontal', activationMode = 'automatic', lazy = false, keepMounted = false, className, children }:
  { value?: string; defaultValue?: string; onValueChange?: (value: string) => void; /** alias of onValueChange */ onChange?: (value: string) => void
    orientation?: 'horizontal' | 'vertical'; activationMode?: 'automatic' | 'manual'; lazy?: boolean; keepMounted?: boolean; className?: string; children: ReactNode }) {
  const notify = useCallback((v: string) => { onValueChange?.(v); onChange?.(v) }, [onValueChange, onChange])
  const [v, set] = useControllable(value, defaultValue, notify)
  const base = useId(), group = useId()
  const [tabs, registerTab] = useNavRegistry()
  const [panels, setPanels] = useState<Set<string>>(() => new Set())
  const registerPanel = useCallback((p: string) => {
    setPanels(s => s.has(p) ? s : new Set(s).add(p))
    return () => setPanels(s => { if (!s.has(p)) return s; const n = new Set(s); n.delete(p); return n })
  }, [])
  const [visited, setVisited] = useState<Set<string>>(() => new Set([v]))
  if (!visited.has(v)) setVisited(new Set(visited).add(v))
  const switched = useRef(false)
  const select = useCallback((n: string) => { switched.current = true; set(n) }, [set])
  const ctx = useMemo<TabsCtxV>(() => ({ value: v, select, base, group, orientation, manual: activationMode === 'manual', lazy, keepMounted, visited, switched: switched.current, tabs, registerTab, panels, registerPanel }),
    [v, select, base, group, orientation, activationMode, lazy, keepMounted, visited, tabs, registerTab, panels, registerPanel])
  return <TabsCtx.Provider value={ctx}><div data-orientation={orientation} className={cn(orientation === 'vertical' && 'flex items-start gap-5', className)}>{children}</div></TabsCtx.Provider>
}

/**
 * Tabs.List (role=tablist): one Tab stop; ←/→ (↑/↓ when vertical) move and select, Home/End jump to the ends. A
 * horizontal list that doesn't fit scrolls sideways with edge fades and keeps the selected tab in view. `fade`: the
 * colour behind it ('card' or 'bg').
 */
export function TabsList({ className, children, fade = 'card', 'aria-label': ariaLabel }: { className?: string; children: ReactNode; fade?: 'card' | 'bg'; 'aria-label'?: string }) {
  const c = useTabs('List'), vertical = c.orientation === 'vertical'
  const list = useRef<HTMLDivElement>(null)
  const [edgeRef, edges] = useScrollEdges<HTMLDivElement>()
  const ref = useComposedRefs<HTMLDivElement>(list, edgeRef)
  useEffect(() => { // keep the selected tab in view when the list scrolls
    const el = list.current
    if (!el || vertical || el.scrollWidth <= el.clientWidth + 1) return
    const tab = [...el.querySelectorAll<HTMLElement>('[role=tab]')].find(t => t.getAttribute('aria-selected') === 'true')
    if (!tab) return
    // scroll by the visible overflow
    const er = el.getBoundingClientRect(), tr = tab.getBoundingClientRect(), pad = 24
    const by = tr.left - pad < er.left ? tr.left - pad - er.left : tr.right + pad > er.right ? tr.right + pad - er.right : 0
    if (by) el.scrollBy?.({ left: by, behavior: prefersReducedMotion() ? 'auto' : 'smooth' })
  }, [c.value, vertical])
  const onKeyDown = (e: RKeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Enter' || (e.target as Element).closest('[role=tablist]') !== e.currentTarget) return
    const to = focusStep(navOwn(e.currentTarget, '[role=tab]', '[role=tablist]'), e, { orientation: vertical ? 'vertical' : 'horizontal' })
    if (!to) return
    e.preventDefault(); to.focus()
    if (!c.manual && to.dataset.value !== undefined) c.select(to.dataset.value)
  }
  if (vertical) return (
    <div ref={list} role="tablist" aria-orientation="vertical" aria-label={ariaLabel} onKeyDown={onKeyDown}
      className={cn('flex flex-none flex-col gap-0.5 border-e border-[var(--line)]', className)}>{children}</div>
  )
  return (
    <div className="relative">
      {/* the bottom rule is an inset shadow over 1px of padding (not a border), so the scroller doesn't clip the underline */}
      <div ref={ref} role="tablist" aria-orientation="horizontal" aria-label={ariaLabel} onKeyDown={onKeyDown}
        className={cn('flex gap-5 overflow-x-auto overflow-y-hidden pb-px shadow-[inset_0_-1px_0_var(--line)] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden', className)}>{children}</div>
      <ScrollEdges {...edges} fade={fade} hint={null} />
    </div>
  )
}

/**
 * Tabs.Trigger (role=tab): selects its `value`; the underline slides to it. `disabled` skips it. `asChild` renders your
 * element (e.g. a router link per tab) with the tab's props.
 */
export function TabsTrigger({ value, disabled = false, asChild, className, children }: { value: string; disabled?: boolean; className?: string; children: ReactNode } & AsChildProps) {
  const c = useTabs('Trigger'), on = c.value === value, vertical = c.orientation === 'vertical'
  const register = c.registerTab
  useLayoutEffect(() => register(value, disabled), [register, value, disabled])
  const none = !c.tabs.some(t => t.value === c.value && !t.disabled)
  const id = `${c.base}-tab-${idPart(value)}`
  const props = {
    role: 'tab', id, 'aria-selected': on, 'aria-controls': c.panels.has(value) ? `${c.base}-panel-${idPart(value)}` : undefined,
    tabIndex: on || (none && navFirst(c.tabs) === value) ? 0 : -1, 'data-value': value, 'data-state': on ? 'active' : 'inactive',
    onClick: () => { if (!disabled) c.select(value) },
    onKeyDown: (e: RKeyboardEvent<HTMLElement>) => { if (c.manual && !disabled && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); c.select(value) } },
    className: cn('relative flex flex-none cursor-pointer items-center gap-1.5 border-0 bg-transparent text-[13px] font-medium whitespace-nowrap transition-colors disabled:cursor-default disabled:opacity-50',
      vertical ? 'h-8 justify-start rounded-[var(--r-md)] pe-4 ps-2.5 text-start [@media(pointer:coarse)]:h-10' : 'px-0 py-2 [@media(pointer:coarse)]:py-2.5',
      on ? 'text-[var(--fg)]' : 'text-[var(--fg2)] hover:text-[var(--fg)]', vertical && !on && 'hover:bg-[var(--muted)]', className),
  }
  const bar = on && <ActiveIndicator group={c.group} className={vertical ? 'start-auto -end-px w-0.5 rounded-full bg-[var(--fg)]' : 'top-auto -bottom-px h-0.5 rounded-full bg-[var(--fg)]'} />
  return <PartButton asChild={asChild} disabled={disabled} after={bar} {...props}>{children}</PartButton>
}

/**
 * Tabs.Content (role=tabpanel, labelled by its tab): shown while its `value` is selected, fading in when you switch.
 * `forceMount` keeps this panel mounted (hidden) when inactive, like the Root's `keepMounted`/`lazy` do for all of them.
 */
export function TabsContent({ value, forceMount, className, children }: { value: string; forceMount?: boolean; className?: string; children: ReactNode }) {
  const c = useTabs('Content'), on = c.value === value, vertical = c.orientation === 'vertical'
  const mounted = on || forceMount || c.keepMounted || (c.lazy && c.visited.has(value))
  const register = c.registerPanel
  useLayoutEffect(() => mounted ? register(value) : undefined, [register, value, mounted])
  if (!mounted) return null
  return (
    <motion.div role="tabpanel" id={`${c.base}-panel-${idPart(value)}`} aria-labelledby={`${c.base}-tab-${idPart(value)}`} hidden={!on} data-state={on ? 'active' : 'inactive'}
      initial={on && c.switched ? { opacity: 0, y: -4 } : false} animate={on ? { opacity: 1, y: 0 } : { opacity: 0, y: -4 }} transition={{ duration: 0.2 }}
      className={cn('text-[13px]', vertical ? 'min-w-0 flex-1' : 'pt-3', className)}>{children}</motion.div>
  )
}

function TabsConfig({ items, value, defaultValue, onChange, orientation, className }:
  { items: TabItem[]; value?: string; defaultValue?: string; onChange?: (v: string) => void; orientation?: 'horizontal' | 'vertical'; className?: string }) {
  return (
    <TabsRoot value={value} defaultValue={defaultValue ?? items[0]?.value ?? ''} onValueChange={onChange} orientation={orientation} className={className}>
      <TabsList>{items.map(t => <TabsTrigger key={t.value} value={t.value}>{t.label}{t.badge}</TabsTrigger>)}</TabsList>
      {items.map(t => t.content !== undefined && <TabsContent key={t.value} value={t.value}>{t.content}</TabsContent>)}
    </TabsRoot>
  )
}

/**
 * Underline travels to the clicked tab; panel fades in. ← → move between tabs (and select them), Home/End jump to the ends.
 * Parts: Tabs.Root (value, orientation, activationMode, lazy, keepMounted) / Tabs.List / Tabs.Trigger (asChild) / Tabs.Content (forceMount).
 */
export const Tabs = Object.assign(TabsConfig, { Root: TabsRoot, List: TabsList, Trigger: TabsTrigger, Content: TabsContent })

export type NavItem = { value: string; label: string; icon?: IconName; badge?: ReactNode }

/** Vertical nav (sidebars, settings sections). Highlight slides to the active item. */
export function NavList({ items, value, defaultValue, onChange, collapsed, className }:
  { items: NavItem[]; value?: string; defaultValue?: string; onChange?: (v: string) => void; collapsed?: boolean; className?: string }) {
  const [v, set] = useControllable(value, defaultValue ?? items[0]?.value, onChange)
  const group = useId()
  return (
    <nav className={cn('flex flex-col gap-0.5', className)}>
      {items.map(it => (
        <button key={it.value} onClick={() => set(it.value)} aria-current={it.value === v ? 'page' : undefined} title={collapsed ? it.label : undefined}
          className={cn('relative flex h-8 cursor-pointer items-center gap-2.5 rounded-[var(--r-md)] border-0 bg-transparent px-2.5 text-start text-[13px] transition-colors [@media(pointer:coarse)]:h-10',
            it.value === v ? 'font-medium text-[var(--fg)]' : 'text-[var(--fg2)] hover:bg-[var(--muted)] hover:text-[var(--fg)]')}>
          {it.value === v && <ActiveIndicator group={group} className="rounded-[var(--r-md)] bg-[var(--muted)]" />}
          {it.icon && <Icon name={it.icon} size={16} className="relative" />}
          <AnimatePresence initial={false}>
            {!collapsed && <motion.span initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, transition: { duration: 0.08 } }} className="relative flex-1 truncate">{it.label}</motion.span>}
          </AnimatePresence>
          {!collapsed && it.badge && <span className="relative">{it.badge}</span>}
        </button>
      ))}
    </nav>
  )
}

/** A sidebar row: a nav item (badge may be a count) or a section heading. */
export type SidebarEntry = (NavItem & { count?: number }) | { heading: string }
const isHeading = (e: SidebarEntry): e is { heading: string } => 'heading' in e

const sbFade = { duration: 0.15 }
/** Frame width below which the sidebar starts folded and, expanded, slides over the main pane (px). */
const SB_NARROW = 440
/** Sidebar width folded to icons and expanded (px). */
const SB_RAIL = 60, SB_WIDE = 220

/**
 * App frame whose sidebar folds to icons. Labels become tooltips when collapsed; press `hotkey` (default `[`)
 * while it's on screen to toggle. Has an optional `title` (the brand, also naming the navigation), section headings,
 * count badges, a user footer, and a main pane that shows `children` (a function of the selected item, or a node).
 * Without `defaultCollapsed` it starts folded when the frame is narrower than 440px; in a frame that narrow, expanding
 * it slides it over the main pane (tap outside or pick an item to fold it again).
 */
export function CollapsibleSidebar({ items, title = '', user, value, defaultValue, onChange, collapsed, defaultCollapsed, onCollapsedChange, hotkey = '[', children, className }:
  { items: SidebarEntry[]; title?: string; user?: { name: string; detail?: string }; value?: string; defaultValue?: string; onChange?: (v: string) => void
    collapsed?: boolean; defaultCollapsed?: boolean; onCollapsedChange?: (v: boolean) => void; hotkey?: string | false
    children?: ReactNode | ((item: NavItem) => ReactNode); className?: string }) {
  const navItems = items.filter((e): e is NavItem & { count?: number } => !isHeading(e))
  const [v, setV] = useControllable(value, defaultValue ?? navItems[0]?.value, onChange)
  const [col, setCol] = useControllable(collapsed, defaultCollapsed ?? false, onCollapsedChange)
  const frame = useRef<HTMLDivElement>(null), group = useId()
  const coarse = useCoarsePointer() // touch: the toggle's tooltip would only repeat its label and the keyboard hint
  // narrow frame (phones): the expanded sidebar slides over the main pane instead of squeezing it; with no default
  // given, it also starts folded there (too narrow for labels and a usable main pane)
  const [over, setOver] = useState(false), measured = useRef(false)
  useResizeObserver(frame, el => {
    const narrow = el.offsetWidth < SB_NARROW
    setOver(narrow)
    if (!measured.current && narrow && collapsed === undefined && defaultCollapsed === undefined) setCol(true)
    measured.current = true
  })
  const toggle = useCallback(() => setCol(!col), [col, setCol])
  useHotkey(hotkey || '', () => { // only the sidebar that is on screen answers
    const r = frame.current?.getBoundingClientRect()
    if (r && r.bottom > 0 && r.top < innerHeight) toggle()
  }, { enabled: !!hotkey, ignoreEditable: true })
  const current = navItems.find(n => n.value === v) ?? navItems[0]
  const beside = 'right' // tooltips open away from the sidebar's edge
  return (
    <div ref={frame} className={cn('relative flex h-[400px] overflow-hidden rounded-[var(--r-lg)] border border-[var(--line)] bg-[var(--bg)]', className)}>
      {over && <div aria-hidden className="flex-none" style={{ width: SB_RAIL }} />}
      <AnimatePresence>
        {over && !col && <motion.div key="scrim" aria-hidden onClick={toggle} className="absolute inset-0 z-[5] bg-black/25"
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.2 }} />}
      </AnimatePresence>
      <motion.aside initial={false} animate={{ width: col ? SB_RAIL : SB_WIDE }} transition={spring(0.12, 0.4)} aria-label={title ? `${title} navigation` : 'Sidebar'}
        className={cn('flex flex-none flex-col gap-1.5 overflow-hidden border-e border-[var(--line)] bg-[var(--card)] p-2.5',
          over && 'absolute inset-y-0 start-0 z-10', over && !col && 'shadow-[var(--shadow)]')}>
        <div className="flex h-9 items-center gap-2 px-1 whitespace-nowrap">
          {title && <motion.span initial={false} animate={{ opacity: col ? 0 : 1, width: col ? 0 : 22 }} transition={sbFade} className="h-[22px] flex-none rounded-[var(--r-md)] bg-[linear-gradient(135deg,var(--accent),var(--c4))]" />}
          <motion.b initial={false} animate={{ opacity: col ? 0 : 1 }} transition={sbFade} className="min-w-0 flex-1 truncate text-sm font-semibold">{title}</motion.b>
          <Tooltip content={<>{col ? 'Expand' : 'Collapse'} <kbd className="font-[family-name:var(--mono)] opacity-70 [@media(hover:none)]:hidden">{hotkey || ''}</kbd></>} placement={col ? beside : 'bottom-center'} portal delay={300} disabled={coarse}>
            <IconButton icon="panel" label={col ? 'Expand sidebar' : 'Collapse sidebar'} aria-expanded={!col} onClick={toggle} />
          </Tooltip>
        </div>
        <nav className="mt-1.5 flex flex-1 flex-col gap-0.5">
          {items.map((it, k) => isHeading(it) ? (
            <motion.div key={`h${k}`} initial={false} animate={{ opacity: col ? 0 : 1 }} transition={sbFade} aria-hidden={col}
              className="px-2.5 pt-2.5 pb-1 text-[11px] whitespace-nowrap text-[var(--fg3)]">{it.heading}</motion.div>
          ) : (
            <Tooltip key={it.value} content={it.label} placement={beside} portal disabled={!col} delay={80}>
              <button onClick={() => { setV(it.value); if (over && !col) setCol(true) }} aria-current={it.value === v ? 'page' : undefined} aria-label={col ? it.label : undefined}
                className={cn('relative flex h-8 w-full cursor-pointer items-center gap-3 rounded-[var(--r-md)] border-0 bg-transparent px-2.5 text-start text-[13px] whitespace-nowrap transition-colors [@media(pointer:coarse)]:h-9',
                  it.value === v ? 'font-medium text-[var(--fg)]' : 'text-[var(--fg2)] hover:text-[var(--fg)]')}>
                {it.value === v && <ActiveIndicator group={group} className="rounded-[var(--r-md)] bg-[var(--muted)]" />}
                {it.icon && <Icon name={it.icon} size={16} className="relative" />}
                <motion.span initial={false} animate={{ opacity: col ? 0 : 1 }} transition={sbFade} className="relative flex-1 truncate">{it.label}</motion.span>
                {(it.count ?? 0) > 0 && (
                  <motion.span initial={false} animate={{ opacity: col ? 0 : 1 }} transition={sbFade}
                    className="relative rounded-full bg-[var(--accent)] px-1.5 py-px font-[family-name:var(--mono)] text-[11px] font-semibold text-[var(--card)]">{it.count}</motion.span>
                )}
                {(it.count ?? 0) > 0 && col && <span className="absolute top-1.5 start-[26px] h-1.5 w-1.5 rounded-full bg-[var(--accent)]" />}
                {!it.count && it.badge && !col && <span className="relative">{it.badge}</span>}
              </button>
            </Tooltip>
          ))}
        </nav>
        {user && (
          <div className="flex items-center gap-2 border-t border-[var(--line)] px-0.5 pt-2 whitespace-nowrap">
            <Avatar name={user.name} size={30} className="!border-0" />
            <motion.div initial={false} animate={{ opacity: col ? 0 : 1 }} transition={sbFade} className="min-w-0">
              <b className="block truncate text-xs font-semibold">{user.name}</b>{user.detail && <span className="block truncate text-[11px] text-[var(--fg3)]">{user.detail}</span>}
            </motion.div>
          </div>
        )}
      </motion.aside>
      <section aria-label={current?.label} className="relative min-w-0 flex-1 overflow-hidden">
        <AnimatePresence mode="wait" initial={false}>
          <motion.div key={current?.value} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, transition: { duration: 0.08 } }} transition={{ duration: 0.22 }}
            className="flex h-full flex-col gap-3 p-4">
            {current && (typeof children === 'function' ? children(current) : children)}
          </motion.div>
        </AnimatePresence>
      </section>
    </div>
  )
}

/** A tab in MobileTabBar. `count` shows a red badge (set it to 0 to clear it with an exit pop). */
export type TabBarItem = NavItem & { count?: number }

/**
 * Bottom tab bar for phone layouts (grows by the bottom safe area on notched phones): an accent line slides to the active tab, its icon bounces,
 * count badges pop out when cleared, and an optional raised centre button (`onAction`) sits in the middle.
 */
export function MobileTabBar({ items, value, defaultValue, onChange, onAction, actionLabel, actionIcon = 'plus', className }:
  { items: TabBarItem[]; value?: string; defaultValue?: string; onChange?: (v: string) => void; onAction?: () => void; actionLabel?: string; actionIcon?: IconName; className?: string }) {
  const [v, set] = useControllable(value, defaultValue ?? items[0]?.value ?? '', onChange)
  const group = useId(), touched = useRef(false)
  const [spin, setSpin] = useState(0)
  const mid = Math.ceil(items.length / 2)
  const cells: (TabBarItem | null)[] = onAction ? [...items.slice(0, mid), null, ...items.slice(mid)] : items
  return (
    <nav aria-label={'Tabs'} className={cn('grid h-[calc(64px+env(safe-area-inset-bottom,0px))] items-center border-t border-[var(--line)] bg-[color-mix(in_srgb,var(--card)_92%,transparent)] pb-[max(6px,env(safe-area-inset-bottom))] backdrop-blur-md', className)}
      style={{ gridTemplateColumns: `repeat(${cells.length}, minmax(0, 1fr))` }}>
      {cells.map(it => it === null ? (
        <span key="action" className="grid place-items-center">
          {/* the replay key sits on the icon, not the button, so pressing it keeps keyboard focus */}
          <motion.button aria-label={actionLabel ?? 'New'} onClick={() => { setSpin(s => s + 1); onAction?.() }} whileTap={{ scale: 0.92 }}
            className="-mt-5 grid h-11 w-11 cursor-pointer place-items-center rounded-full border-0 bg-[var(--primary)] text-[var(--on-primary)] shadow-[0_6px_16px_rgba(0,0,0,.2)]">
            <motion.span key={spin} className="grid" initial={false} animate={spin ? { rotate: [0, 90], scale: [1, 0.9, 1] } : undefined} transition={{ duration: 0.35, ease: 'easeOut' }}>
              <Icon name={actionIcon} size={20} />
            </motion.span>
          </motion.button>
        </span>
      ) : (
        <button key={it.value} onClick={() => { touched.current = true; set(it.value) }} aria-current={it.value === v ? 'page' : undefined}
          className={cn('relative flex h-full min-w-0 cursor-pointer flex-col items-center justify-center gap-1 border-0 bg-transparent text-[11px] font-medium transition-colors',
            it.value === v ? 'text-[var(--accent)]' : 'text-[var(--fg3)] hover:text-[var(--fg2)]')}>
          {it.value === v && <motion.span layoutId={group} className="absolute top-0 start-[calc(50%-14px)] h-[3px] w-7 rounded-b-[var(--r-sm)] bg-[var(--accent)]" transition={spring(0.25, 0.4)} />}
          <span className="relative inline-flex">
            <motion.span key={it.value === v ? 'on' : 'off'} className="inline-flex" initial={false}
              animate={it.value === v && touched.current ? { y: [0, -4, 0] } : { y: 0 }} transition={{ duration: 0.35, ease: 'easeOut' }}>
              {it.icon && <Icon name={it.icon} size={20} />}
            </motion.span>
            <AnimatePresence>
              {(it.count ?? 0) > 0 && (
                <motion.span aria-hidden initial={{ scale: 0 }} animate={{ scale: 1 }} exit={{ scale: 0, transition: { duration: 0.2 } }} transition={spring(0.5, 0.35)}
                  className="absolute -top-2 start-[calc(100%-7px)] grid h-[18px] min-w-[18px] place-items-center rounded-full border-2 border-[var(--card)] bg-[var(--bad)] px-1 text-[11px] leading-none font-bold text-[var(--card)]">{it.count}</motion.span>
              )}
            </AnimatePresence>
          </span>
          {/* the name is the visible label plus the count ("Inbox, 3 new"), so it matches what is on screen */}
          <span>{it.label}{(it.count ?? 0) > 0 && <span className="sr-only">{`, ${it.count ?? 0} new`}</span>}</span>
        </button>
      ))}
    </nav>
  )
}

export type MegaMenuItem = { label: string; content?: ReactNode; href?: string }

/** `custom` is the slide direction in screen terms: +1 enters from the right, -1 from the left. */
const megaSlide: Variants = {
  enter: (d: number) => ({ opacity: 0, x: 40 * d }),
  center: { opacity: 1, x: 0, transition: spring(0.15, 0.35) },
  exit: (d: number) => ({ opacity: 0, x: -40 * d, transition: { duration: 0.2 } }),
}

/**
 * Spatial arrow-key step through a panel laid out as a grid: the nearest item in the arrow's direction, scored by distance
 * along the arrow plus twice the sideways offset. Returns null at the grid's edge.
 */
function megaStep(items: HTMLElement[], from: HTMLElement, key: string): HTMLElement | null {
  const r = from.getBoundingClientRect(), cx = r.left + r.width / 2, cy = r.top + r.height / 2
  let best: HTMLElement | null = null, score = Infinity
  for (const el of items) {
    if (el === from) continue
    const b = el.getBoundingClientRect(), x = b.left + b.width / 2, y = b.top + b.height / 2
    const sameRow = b.top < r.bottom - 2 && b.bottom > r.top + 2
    const ok = key === 'ArrowDown' ? b.top >= r.bottom - 2 : key === 'ArrowUp' ? b.bottom <= r.top + 2
      : key === 'ArrowRight' ? x > cx + 1 && b.left >= r.left + 4 && (sameRow || b.left >= r.right - 2) : x < cx - 1 && b.right <= r.right - 4 && (sameRow || b.right <= r.left + 2)
    if (!ok) continue
    const vertical = key === 'ArrowDown' || key === 'ArrowUp'
    const s = vertical ? Math.abs(y - cy) + 2 * Math.abs(b.left - r.left) : Math.abs(x - cx) + 2 * Math.abs(y - cy)
    if (s < score) { score = s; best = el }
  }
  return best
}

/**
 * Site header whose menus share one panel. Hover or focus a top item to open it (it waits `closeDelay` ms
 * before closing, so you can travel to the panel); moving to another item morphs the panel's size and
 * position while the content slides in from that side.
 * Keyboard: ←/→ move between the top items (Home/End jump to the ends) and ↓ (or ↑ for the last link) moves into the
 * open panel. Inside the panel ↑↓←→ move through its links as a grid, Home/End jump to the first/last link, ←/→ at
 * the grid's edge go to the neighbouring top item, ↑ from the first row returns to the trigger, and Escape closes the
 * panel and returns focus to its trigger.
 * Items with `href` and no `content` are plain links (`href` passes through safeUrl: http(s), mailto, tel or relative).
 * `children` is the page under the header.
 * Open state: uncontrolled with `defaultOpen` (a top item's label or index, open on mount), or controlled with `open`
 * (label, index, or null for closed) + `onOpenChange(label | null)`, which fires on every open, switch and close.
 */
export function MegaMenu({ items, brand, actions, children, closeDelay = 160, defaultOpen, open: openProp, onOpenChange, className }:
  { items: MegaMenuItem[]; brand?: ReactNode; actions?: ReactNode; children?: ReactNode; closeDelay?: number
    /** top item (label or index) whose panel is open on mount */ defaultOpen?: string | number
    /** controlled: the open top item (label or index), or null for closed */ open?: string | number | null
    onOpenChange?: (label: string | null) => void; className?: string }) {
  const host = useRef<HTMLDivElement>(null), measures = useRef<(HTMLDivElement | null)[]>([]), triggers = useRef<(HTMLButtonElement | null)[]>([])
  const panel = useRef<HTMLDivElement>(null)
  const megaIndex = (v: string | number | null | undefined) => {
    const i = typeof v === 'number' ? v : typeof v === 'string' ? items.findIndex(it => it.label === v) : -1
    return i >= 0 && i < items.length && items[i].content ? i : -1
  }
  const notify = useCallback((i: number) => onOpenChange?.(i >= 0 ? items[i].label : null), [onOpenChange, items])
  const [cur, setCurRaw] = useControllable<number>(openProp === undefined ? undefined : megaIndex(openProp), megaIndex(defaultOpen), notify)
  const curRef = useLatest(cur)
  const setCur = (i: number) => { if (i !== curRef.current) setCurRaw(i) }
  // what the panel shows (it outlives `cur` while the panel fades out), the slide direction, and whether the panel
  // morphs from another open menu; derived from each change of `cur`, so a controlled `open` drives them too
  const [view, setView] = useState({ cur, shown: cur, dir: 1, morph: false })
  if (view.cur !== cur) setView(v => cur >= 0 ? { cur, shown: cur, dir: v.cur >= 0 && cur < v.cur ? -1 : 1, morph: v.cur >= 0 } : { ...v, cur, morph: false })
  const { shown, dir, morph: morphing } = view
  const openedAt = useRef(0)
  const [sizes, setSizes] = useState<{ w: number; h: number }[]>([])
  const [hostW, setHostW] = useState(0), [hostH, setHostH] = useState(0)
  const [edges, setEdges] = useState<{ l: number; r: number }[]>([])
  const closeT = useRef<ReturnType<typeof setTimeout>>(undefined)
  const pid = useId()

  const measure = useCallback(() => {
    const h = host.current
    if (!h) return
    const hr = h.getBoundingClientRect()
    setHostW(hr.width); setHostH(hr.height)
    setSizes(measures.current.map(m => ({ w: m?.offsetWidth ?? 0, h: m?.offsetHeight ?? 0 })))
    setEdges(triggers.current.map(t => { const r = t?.getBoundingClientRect(); return r ? { l: r.left - hr.left, r: r.right - hr.left } : { l: 0, r: 0 } }))
  }, [])
  useLayoutEffect(() => {
    measure()
    const ro = new ResizeObserver(() => measure())
    if (host.current) ro.observe(host.current)
    measures.current.forEach(m => m && ro.observe(m))
    return () => ro.disconnect()
  }, [measure, items])
  useLayoutEffect(() => { if (cur >= 0) measure() }, [cur, measure]) // the triggers may have scrolled since
  useEffect(() => () => clearTimeout(closeT.current), [])
  useOutside([host], e => {
    const t = triggers.current[cur], refocus = e.type === 'keydown' && host.current?.contains(document.activeElement)
    clearTimeout(closeT.current); setCur(-1)
    if (refocus) t?.focus()
  }, cur >= 0, { escape: true })

  const open = (i: number) => {
    clearTimeout(closeT.current)
    if (i === curRef.current) return
    openedAt.current = Date.now()
    setCur(i)
  }
  const close = (now = false) => {
    clearTimeout(closeT.current)
    if (now) setCur(-1); else closeT.current = setTimeout(() => setCur(-1), closeDelay)
  }
  const size = sizes[shown] ?? { w: 0, h: 0 }
  // the panel lines up with its trigger's start edge, clamped inside the frame
  const edge = edges[shown] ?? { l: 0, r: 0 }
  const left = shown >= 0 ? Math.max(8, Math.min(hostW - size.w - 8, (edge.l - 20))) : 0
  const morph = morphing ? spring(0.12, 0.4) : { duration: 0 }
  const maxW = Math.max(200, hostW - 16)
  const topItems = () => [...(host.current?.querySelectorAll<HTMLElement>('[data-mega-top]') ?? [])]
  const content = () => panel.current?.querySelector(`[data-mega="${cur}"]`)
  const enterPanel = (i: number, last = false) => {
    open(i)
    requestAnimationFrame(() => { const all = focusables(panel.current?.querySelector(`[data-mega="${i}"]`)); (last ? all[all.length - 1] : all[0])?.focus() })
  }
  const onTopKey = (e: React.KeyboardEvent<HTMLElement>, i: number) => {
    const to = focusStep(topItems(), e, { orientation: 'horizontal' })
    if (to) { e.preventDefault(); to.focus() }
    else if (items[i]?.content && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) { e.preventDefault(); enterPanel(i, e.key === 'ArrowUp') }
  }
  const onPanelKey = (e: React.KeyboardEvent) => {
    if (cur < 0 || !['ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return
    const all = focusables(content()), from = document.activeElement as HTMLElement | null
    if (!all.length || !from || !all.includes(from)) return
    e.preventDefault()
    if (e.key === 'Home' || e.key === 'End') return all[e.key === 'Home' ? 0 : all.length - 1].focus()
    const next = megaStep(all, from, e.key) // spatial: ← and → go to the item on that side of the screen in either direction
    if (next) return next.focus()
    if (e.key === 'ArrowUp') return triggers.current[cur]?.focus()
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { // at the edge: the neighbouring top item
      const tops = topItems(), at = tops.indexOf(triggers.current[cur] as HTMLElement)
      tops[(at + (e.key === 'ArrowRight' ? 1 : -1) + tops.length) % tops.length]?.focus()
    }
  }

  return (
    <div ref={host} className={cn('relative h-[420px] overflow-hidden rounded-[var(--r-lg)] border border-[var(--line)] bg-[var(--bg)]', className)}
      onBlur={e => { if (e.relatedTarget && !e.currentTarget.contains(e.relatedTarget as Node)) close(true) }}>
      <div className="relative z-[3] flex h-14 items-center gap-2 border-b border-[var(--line)] bg-[var(--card)] px-4">
        {brand && <span className="me-3 hidden flex-none items-center gap-2 text-sm font-semibold sm:flex">{brand}</span>}
        <nav aria-label={'Main'} className="flex min-w-0 gap-0.5 overflow-x-auto [scrollbar-width:none]">
          {items.map((it, i) => it.content ? (
            <button key={it.label} ref={el => { triggers.current[i] = el }} aria-expanded={cur === i} aria-controls={pid}
              onPointerEnter={e => { if (e.pointerType === 'mouse') open(i) }} onPointerLeave={e => { if (e.pointerType === 'mouse') close() }}
              onFocus={() => open(i)} onClick={() => { if (cur !== i) open(i); else if (Date.now() - openedAt.current > 350) close(true) }}
              data-mega-top onKeyDown={e => onTopKey(e, i)}
              className={cn('inline-flex h-9 flex-none cursor-pointer items-center gap-1 rounded-[var(--r-md)] border-0 px-3 text-[13px] font-medium transition-colors [@media(pointer:coarse)]:h-10',
                cur === i ? 'bg-[var(--muted)] text-[var(--fg)]' : 'bg-transparent text-[var(--fg2)] hover:text-[var(--fg)]')}>
              {it.label}<Icon name="chevronDown" size={12} className={cn('opacity-60 transition-transform duration-200', cur === i && 'rotate-180')} />
            </button>
          ) : (
            <a key={it.label} href={safeUrl(it.href)} onFocus={() => close(true)} data-mega-top onKeyDown={e => onTopKey(e, i)}
              className="inline-flex h-9 flex-none items-center rounded-[var(--r-md)] px-3 text-[13px] font-medium text-[var(--fg2)] no-underline hover:text-[var(--fg)] [@media(pointer:coarse)]:h-10">{it.label}</a>
          ))}
        </nav>
        <span className="flex-1" />
        {actions && <span className="hidden flex-none items-center gap-2 sm:flex">{actions}</span>}
      </div>
      <motion.div ref={panel} id={pid} role="region" aria-label={cur >= 0 ? items[cur].label : undefined} aria-hidden={cur < 0}
        // hidden once faded out: the first open then makes the panel appear at its size instead of resizing a box that
        // was there all along (which counted as a layout shift)
        className={cn('absolute top-16 z-[4] overflow-x-hidden overflow-y-auto overscroll-contain rounded-[var(--r-lg)] border border-[var(--line)] bg-[var(--card)] shadow-[var(--shadow)]', cur < 0 && 'pointer-events-none', shown < 0 && 'invisible')}
        initial={false}
        animate={cur >= 0 ? { opacity: 1, y: 0, scale: 1, left, width: size.w, height: hostH ? Math.min(size.h, hostH - 72) : size.h } : { opacity: 0, y: -4, scale: 0.98 }}
        onAnimationComplete={() => { if (cur < 0) setView(v => v.cur < 0 ? { ...v, shown: -1 } : v) }}
        transition={{ default: cur >= 0 ? spring(0.2, 0.3) : { duration: 0.15 }, left: morph, width: morph, height: morph }}
        onKeyDown={onPanelKey} onPointerEnter={() => clearTimeout(closeT.current)} onPointerLeave={e => { if (e.pointerType === 'mouse') close() }}>
        <AnimatePresence initial={false} custom={dir}>
          {shown >= 0 && (
            <motion.div key={shown} data-mega={shown} custom={dir} variants={megaSlide} initial={morphing ? 'enter' : false} animate="center" exit="exit"
              className="absolute top-0 start-0 w-max p-4" style={{ maxWidth: maxW }}>{items[shown]?.content}</motion.div>
          )}
        </AnimatePresence>
      </motion.div>
      {/* off-screen copies, measured so the panel knows each menu's size before it morphs */}
      <div aria-hidden className="pointer-events-none invisible absolute top-0 start-0">
        {items.map((it, i) => it.content ? <div key={it.label} ref={el => { measures.current[i] = el }} className="absolute top-0 start-0 w-max p-4" style={{ maxWidth: maxW }}>{it.content}</div> : null)}
      </div>
      <div className="absolute inset-x-0 top-14 bottom-0">{children}</div>
    </div>
  )
}

/** Trail of links to the current page (the last item, marked aria-current). Wraps on narrow screens; links grow their tap area on touch. Hrefs pass through safeUrl. */
export function Breadcrumbs({ items, className }: { items: { label: string; href?: string; onClick?: () => void }[]; className?: string }) {
  return (
    <nav aria-label={'Breadcrumb'} className={cn('flex flex-wrap items-center gap-1.5 text-[13px] text-[var(--fg3)]', className)}>
      {items.map((it, i) => {
        const last = i === items.length - 1
        return (
          <span key={i} className="flex items-center gap-1.5">
            {last ? <b aria-current="page" className="font-medium text-[var(--fg)]">{it.label}</b>
              : <a href={safeUrl(it.href)} onClick={e => { if (it.onClick) { e.preventDefault(); it.onClick() } }} className="text-[var(--fg2)] no-underline hover:text-[var(--fg)] [@media(pointer:coarse)]:-my-2 [@media(pointer:coarse)]:-mx-1 [@media(pointer:coarse)]:px-1 [@media(pointer:coarse)]:py-2">{it.label}</a>}
            {!last && <Icon name="chevronRight" size={12} />}
          </span>
        )
      })}
    </nav>
  )
}

/**
 * Page numbers with ellipses: 1 … 4 5 6 … 20. `total` is the number of pages; the current page's frame slides between numbers.
 * It is a navigation landmark named "Pagination": give each one on a page its own `aria-label` (e.g. "Search results pages").
 */
export function Pagination({ page, total, onChange, className, 'aria-label': ariaLabel }: { page: number; total: number; onChange: (p: number) => void; className?: string; 'aria-label'?: string }) {
  const nums: (number | '…')[] = []
  for (let p = 1; p <= total; p++) {
    if (p === 1 || p === total || Math.abs(p - page) <= 1) nums.push(p)
    else if (nums[nums.length - 1] !== '…') nums.push('…')
  }
  const group = useId()
  const cell = 'relative grid h-8 min-w-8 cursor-pointer place-items-center rounded-[var(--r-md)] border-0 bg-transparent px-1 text-[13px] hover:bg-[var(--muted)] disabled:opacity-40 disabled:cursor-default'
  return (
    <nav aria-label={ariaLabel ?? 'Pagination'} className={cn('flex items-center gap-1', className)}>

      <button className={cell} aria-label={'Previous page'} disabled={page <= 1} onClick={() => onChange(page - 1)}><Icon name="chevronLeft" size={14} /></button>
      {nums.map((n, i) => n === '…' ? <span key={`e${i}`} className="px-1 text-[var(--fg3)]">…</span> : (
        <button key={n} className={cn(cell, n === page && 'font-semibold')} aria-current={n === page ? 'page' : undefined} onClick={() => onChange(n)}>
          {n === page && <ActiveIndicator group={group} className="rounded-[var(--r-md)] border border-[var(--line)] bg-[var(--card)]" />}
          <span className="relative">{fmt.number(n)}</span>
        </button>
      ))}
      <button className={cell} aria-label={'Next page'} disabled={page >= total} onClick={() => onChange(page + 1)}><Icon name="chevronRight" size={14} /></button>
    </nav>
  )
}

/** Wizard progress: done steps fill, connecting lines draw across. On phones only the current step keeps its label. */
export function Steps({ steps, current, className }: { steps: string[]; current: number; className?: string }) {
  return (
    <ol className={cn('m-0 flex list-none items-center gap-1.5 p-0 text-xs', className)}>
      {steps.map((s, i) => (
        <li key={s} className="contents">
          <span className={cn('flex items-center gap-1.5', i <= current ? 'text-[var(--fg)]' : 'text-[var(--fg3)]')} aria-current={i === current ? 'step' : undefined}>
            <motion.span key={i === current ? `c${current}` : 'n'} className="grid" initial={false} animate={{ scale: i === current ? [1, 1.15, 1] : 1 }}>
              <StatusIcon status={i < current ? 'done' : i === current ? 'active' : 'pending'} number={i + 1} size={22} className="!text-[11px]" />
            </motion.span>
            <span className={cn(i === current ? 'whitespace-nowrap' : 'hidden sm:inline')}>{s}</span>
          </span>
          {i < steps.length - 1 && (
            <span className="relative h-0.5 min-w-4 flex-1 overflow-hidden rounded-full bg-[var(--line)]">
              <motion.b className="absolute inset-0 origin-left bg-[var(--primary)]" initial={false} animate={{ scaleX: i < current ? 1 : 0 }} transition={spring(0.1, 0.4)} />
            </span>
          )}
        </li>
      ))}
    </ol>
  )
}

export type WizardStep = { label: string; description?: ReactNode }

/**
 * Steps plus the current step's description and Back / Continue buttons. Back is hidden on the
 * first and last step; on the last step Continue becomes `restartLabel` and goes back to the start.
 */
export function Wizard({ steps, value, defaultValue = 0, onChange, onFinish, restartLabel, className }:
  { steps: WizardStep[]; value?: number; defaultValue?: number; onChange?: (step: number) => void; onFinish?: () => void; restartLabel?: string; className?: string }) {
  const [i, set] = useControllable(value, defaultValue, onChange)
  const last = i === steps.length - 1
  const [dir, setDir] = useState(1)
  const go = (n: number) => { setDir((n > i ? 1 : -1)); set(n) }
  useEffect(() => { if (last) onFinish?.() }, [last]) // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className={cn('flex flex-col gap-3', className)}>
      <Steps steps={steps.map(s => s.label)} current={i} />
      <div className="relative min-h-5 overflow-hidden text-[13px] text-[var(--fg2)]" aria-live="polite">
        <AnimatePresence mode="popLayout" initial={false} custom={dir}>
          <motion.p key={i} custom={dir} className="m-0" initial={{ opacity: 0, x: 12 * dir }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -12 * dir, transition: { duration: 0.12 } }}
            transition={spring(0.15, 0.35)}>{steps[i]?.description}</motion.p>
        </AnimatePresence>
      </div>
      <div className="flex items-center justify-between">
        <Button size="sm" onClick={() => go(Math.max(0, i - 1))} className={cn((i === 0 || last) && 'invisible')} aria-hidden={i === 0 || last} tabIndex={i === 0 || last ? -1 : 0}>{'Back'}</Button>
        <Button size="sm" variant="primary" onClick={() => go(last ? 0 : i + 1)}>{last ? restartLabel ?? 'Start over' : 'Continue'}</Button>

      </div>
    </div>
  )
}

const TOGGLE_SIZE = {
  sm: 'h-[30px] min-w-[30px] px-2 text-xs [@media(pointer:coarse)]:h-8', md: 'h-9 min-w-9 px-2.5 text-[13px]',
  'icon-sm': 'h-7 w-7 p-0 [@media(pointer:coarse)]:h-8 [@media(pointer:coarse)]:w-8', icon: 'h-9 w-9 p-0',
} as const
const TOGGLE_VARIANT = {
  ghost: 'border-transparent bg-transparent',
  outline: 'border-[var(--line)] bg-[var(--card)] aria-pressed:border-[var(--line2)] aria-checked:border-[var(--line2)]',
} as const
export type ToggleSize = keyof typeof TOGGLE_SIZE
export type ToggleVariant = keyof typeof TOGGLE_VARIANT
/** Classes for a toggle button: muted until pressed (aria-pressed or aria-checked), then filled. */
export const toggleClass = (variant: ToggleVariant = 'ghost', size: ToggleSize = 'md', className?: string) => cn(
  'relative inline-flex flex-none cursor-pointer items-center justify-center gap-1.5 rounded-[var(--r-md)] border font-medium whitespace-nowrap text-[var(--fg2)] no-underline outline-none transition-colors',
  'hover:bg-[var(--muted)] hover:text-[var(--fg)] focus-visible:ring-2 focus-visible:ring-[var(--accent)] disabled:cursor-not-allowed disabled:opacity-50',
  'aria-pressed:bg-[var(--muted)] aria-pressed:text-[var(--fg)] aria-checked:bg-[var(--muted)] aria-checked:text-[var(--fg)]',
  TOGGLE_VARIANT[variant], TOGGLE_SIZE[size], className)

type ToolbarCtxV = { orientation: 'horizontal' | 'vertical' }
const ToolbarCtx = createContext<ToolbarCtxV | null>(null)

type ToggleOwnProps = { variant?: ToggleVariant; size?: ToggleSize }
/**
 * A two-state button (aria-pressed): bold, mute, pin. `pressed` + `onPressedChange`, or `defaultPressed`. Give icon-only
 * toggles an `aria-label`. `asChild` renders your element. Inside a Toolbar it joins the toolbar's arrow-key order.
 */
export function Toggle({ pressed, defaultPressed = false, onPressedChange, variant, size, asChild, className, children, onClick, ref, ...p }:
  Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'onChange'> & ToggleOwnProps & AsChildProps & { pressed?: boolean; defaultPressed?: boolean; onPressedChange?: (pressed: boolean) => void; ref?: Ref<HTMLButtonElement> }) {
  const [on, set] = useControllable(pressed, defaultPressed, onPressedChange)
  const inToolbar = useContext(ToolbarCtx) !== null
  const props = {
    ...p, 'aria-pressed': on, 'data-state': on ? 'on' : 'off', 'data-toolbar-item': inToolbar ? '' : undefined, className: toggleClass(variant, size, className),
    onClick: (e: ReactMouseEvent<HTMLButtonElement>) => { onClick?.(e); if (!e.defaultPrevented) set(!on) },
  }
  return <PartButton asChild={asChild} ref={ref} {...props}>{children}</PartButton>
}

type TgCtxV = {
  single: boolean; value: string[]; toggle: (v: string) => void; variant?: ToggleVariant; size?: ToggleSize; disabled?: boolean
  inToolbar: boolean; tabStop: string | undefined; setFocused: (v: string) => void; register: (v: string, disabled: boolean) => () => void
}
const TgCtx = createContext<TgCtxV | null>(null)
type ToggleGroupBase = { variant?: ToggleVariant; size?: ToggleSize; disabled?: boolean; orientation?: 'horizontal' | 'vertical'; loop?: boolean; className?: string; children: ReactNode; 'aria-label'?: string; 'aria-labelledby'?: string }
/** Single: one value or none (a radio group). Multiple: any set of values (pressed buttons). */
export type ToggleGroupProps = ToggleGroupBase & (
  | { type: 'single'; value?: string; defaultValue?: string; onValueChange?: (value: string) => void; /** clicking the selected item clears the group */ deselectable?: boolean }
  | { type: 'multiple'; value?: string[]; defaultValue?: string[]; onValueChange?: (value: string[]) => void; deselectable?: never })

/**
 * A row of toggle buttons. `type="single"` is a radio group (role=radiogroup, items role=radio + aria-checked): arrows move
 * and select, like native radios. `type="multiple"` is a group of pressed buttons (aria-pressed): arrows move focus, Space
 * or Enter toggles. Either way it is one Tab stop. Inside a Toolbar, the toolbar owns the arrow keys (they only move
 * focus) and Space/Enter selects. Items: ToggleGroup.Item.
 */
export function ToggleGroupRoot(props: ToggleGroupProps) {
  const { type, variant, size, disabled, orientation = 'horizontal', loop = true, className, children } = props
  const single = type === 'single'
  const toList = (v: string | string[] | undefined) => v === undefined ? undefined : Array.isArray(v) ? v : v ? [v] : []
  const [value, setValue] = useControllable<string[]>(toList(props.value), toList(props.defaultValue) ?? [],
    (v: string[]) => (props.onValueChange as ((x: string | string[]) => void) | undefined)?.(single ? v[0] ?? '' : v))
  const inToolbar = useContext(ToolbarCtx) !== null
  const [items, register] = useNavRegistry()
  const [focused, setFocused] = useState<string>()
  const enabled = (v?: string) => v !== undefined && items.some(x => x.value === v && !x.disabled)
  const tabStop = enabled(focused) ? focused : value.find(enabled) ?? navFirst(items)
  const toggle = useCallback((v: string) => {
    const on = value.includes(v)
    if (single) { if (!on) setValue([v]); else if (props.deselectable) setValue([]) }
    else setValue(on ? value.filter(x => x !== v) : [...value, v])
  }, [value, single, setValue, props.deselectable])
  const ctx: TgCtxV = { single, value, toggle, variant, size, disabled, inToolbar, tabStop, setFocused, register }
  const onKeyDown = (e: RKeyboardEvent<HTMLDivElement>) => {
    if (inToolbar) return
    const to = focusStep(navOwn(e.currentTarget, '[data-tg-item]', '[data-tg-root]'), e, { orientation, loop })
    if (!to) return
    e.preventDefault(); to.focus()
    if (single && to.dataset.value !== undefined) setValue([to.dataset.value]) // radio: arrows select
  }
  return (
    <TgCtx.Provider value={ctx}>
      <div data-tg-root role={single ? 'radiogroup' : 'group'} aria-label={props['aria-label']} aria-labelledby={props['aria-labelledby']} aria-orientation={single ? orientation : undefined}
        aria-disabled={disabled || undefined} onKeyDown={onKeyDown} className={cn('inline-flex items-center gap-1', orientation === 'vertical' && 'flex-col', className)}>
        {children}
      </div>
    </TgCtx.Provider>
  )
}
/** ToggleGroup.Item: one button of the group (`value`). Give icon-only items an `aria-label`. `asChild` renders your element. */
export function ToggleGroupItem({ value, disabled: own, asChild, className, children, ...p }:
  Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'value' | 'onChange'> & AsChildProps & { value: string; disabled?: boolean }) {
  const g = useRequiredContext(TgCtx, '<ToggleGroup.Item>', '<ToggleGroup>')
  const disabled = own || g.disabled, on = g.value.includes(value), register = g.register
  useLayoutEffect(() => register(value, !!disabled), [register, value, disabled])
  const props = {
    ...p, 'data-tg-item': '', 'data-value': value, 'data-state': on ? 'on' : 'off', 'data-toolbar-item': g.inToolbar ? '' : undefined,
    ...(g.single ? { role: 'radio', 'aria-checked': on } : { 'aria-pressed': on }),
    tabIndex: g.inToolbar ? undefined : value === g.tabStop ? 0 : -1,
    className: toggleClass(g.variant, g.size, className),
    onFocus: () => g.setFocused(value),
    onClick: (e: ReactMouseEvent<HTMLButtonElement>) => { p.onClick?.(e); if (!e.defaultPrevented && !disabled) g.toggle(value) },
  }
  return <PartButton asChild={asChild} disabled={disabled} {...props}>{children}</PartButton>
}
/** Toggle buttons sharing one value (single, a radio group) or a set (multiple). Parts: ToggleGroup.Root (= ToggleGroup) and ToggleGroup.Item. */
export const ToggleGroup = Object.assign(ToggleGroupRoot, { Root: ToggleGroupRoot, Item: ToggleGroupItem })

const TOOLBAR_ITEM = '[data-toolbar-item]'
/**
 * A toolbar (role=toolbar): buttons, toggles, toggle groups, links and separators that share one Tab stop. ←/→ (↑/↓ when
 * vertical) move between every enabled item, Home/End jump to the ends; Tab leaves. The last focused item stays the Tab
 * stop. Name it with `aria-label`. Parts: Toolbar.Button, Toolbar.Link, Toolbar.Toggle, Toolbar.ToggleGroup, Toolbar.ToggleItem, Toolbar.Separator.
 */
export function ToolbarRoot({ orientation = 'horizontal', loop = true, className, children, 'aria-label': ariaLabel, 'aria-labelledby': labelledBy }:
  { orientation?: 'horizontal' | 'vertical'; loop?: boolean; className?: string; children: ReactNode; 'aria-label'?: string; 'aria-labelledby'?: string }) {
  const ref = useRef<HTMLDivElement>(null), active = useRef(0)
  const items = () => (ref.current ? navOwn(ref.current, TOOLBAR_ITEM, '[role=toolbar]') : [])
    .filter(el => !(el as HTMLButtonElement).disabled && el.getAttribute('aria-disabled') !== 'true')
  const sync = () => { const all = items(); const i = Math.min(active.current, all.length - 1); all.forEach((el, k) => { el.tabIndex = k === i ? 0 : -1 }) }
  useLayoutEffect(sync) // after every render: items may have come, gone or been disabled
  const ctx = useMemo(() => ({ orientation }), [orientation])
  return (
    <ToolbarCtx.Provider value={ctx}>
      <div ref={ref} role="toolbar" aria-orientation={orientation} aria-label={ariaLabel} aria-labelledby={labelledBy}
        onFocus={e => { const i = items().indexOf(e.target as HTMLElement); if (i >= 0 && i !== active.current) { active.current = i; sync() } }}
        onKeyDown={e => {
          if ((e.target as Element).closest('[role=toolbar]') !== e.currentTarget || (e.target as Element).matches('input,textarea,select,[contenteditable="true"]')) return
          const to = focusStep(items(), e, { orientation, loop })
          if (to) { e.preventDefault(); to.focus() }
        }}
        className={cn('flex items-center gap-1 rounded-[var(--r-lg)] border border-[var(--line)] bg-[var(--card)] p-1', orientation === 'vertical' ? 'inline-flex flex-col' : 'flex-wrap', className)}>
        {children}
      </div>
    </ToolbarCtx.Provider>
  )
}
/** Toolbar.Button: a small ghost Button in the toolbar's arrow-key order. All Button props, `asChild` too. */
export function ToolbarButton({ variant = 'ghost', size = 'sm', ...p }: ButtonProps) {
  return <Button variant={variant} size={size} data-toolbar-item="" {...p} />
}
/** Toolbar.Link: a link in the toolbar's arrow-key order (href passes through safeUrl). */
export function ToolbarLink({ href, className, children, ...p }: HTMLAttributes<HTMLAnchorElement> & { href: string }) {
  return <a href={safeUrl(href)} data-toolbar-item="" className={cn('inline-flex h-[30px] items-center rounded-[var(--r-md)] px-2 text-xs font-medium text-[var(--accent)] no-underline outline-none hover:bg-[var(--muted)] focus-visible:ring-2 focus-visible:ring-[var(--accent)] [@media(pointer:coarse)]:h-8', className)} {...p}>{children}</a>
}
/** Toolbar.Separator: a thin rule between groups (vertical in a horizontal toolbar). */
export function ToolbarSeparator({ className }: { className?: string }) {
  const t = useContext(ToolbarCtx), vertical = t?.orientation === 'vertical'
  return <div role="separator" aria-orientation={vertical ? 'horizontal' : 'vertical'} className={cn('flex-none bg-[var(--line)]', vertical ? 'my-0.5 h-px w-5' : 'mx-0.5 h-5 w-px', className)} />
}
/** Toolbar and its parts. */
export const Toolbar = Object.assign(ToolbarRoot, {
  Root: ToolbarRoot, Button: ToolbarButton, Link: ToolbarLink, Separator: ToolbarSeparator, Toggle, ToggleGroup: ToggleGroupRoot, ToggleItem: ToggleGroupItem,
})
