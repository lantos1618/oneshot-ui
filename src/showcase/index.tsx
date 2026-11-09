import { createContext, memo, useCallback, useContext, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type RefObject } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { ActiveIndicator, AppearanceMenu, Button, type Command, CommandPalette, Dialog, DropdownMenu, Icon, type IconName, Kbd, MenuItem, THEMES, ThemeToggle, UIProvider, type UIDir, UI_MESSAGES_AR, UI_MESSAGES_DE, type UIMessages, cn, fmtFor, useHotkey, useLocale, useMessages, useTheme, useToast } from '../lib'
import { AISection } from './AISection'
import { ButtonsSection } from './ButtonsSection'
import { ChartsSection } from './ChartsSection'
import { CodeSection } from './CodeSection'
import { CollabSection } from './CollabSection'
import { DataSection } from './DataSection'
import { FeedbackSection } from './FeedbackSection'
import { InputsSection } from './InputsSection'
import { LayoutSection } from './LayoutSection'
import { DiagramsSection } from './DiagramsSection'
import { FormsSection } from './FormsSection'
import { MediaSection } from './MediaSection'
import { MotionSection } from './MotionSection'
import { NavigationSection } from './NavigationSection'
import { OverlaysSection } from './OverlaysSection'
import { PagesSection } from './PagesSection'
import { SECTIONS, SECTION_TAGS, SHOWCASE_MSG, ShellContext, type SpecEntry, flashSpec, specMatches, useSpecs } from './kit'
import { CodeDrawer } from './CodeDrawer'
import { DesignQA, DesignQAButton, designQA } from './DesignQA'
import { OVERLAY_DEMO_EVENT, type OverlayDemo } from './OverlaysSection'

/** True when typing somewhere, so single-key shortcuts stay out of the way. */
const shellTyping = (t: EventTarget | null) => t instanceof Element && !!t.closest('input,textarea,select,[contenteditable="true"],[contenteditable=""]')

const SHELL_SHORTCUTS: [string, [string[], string][]][] = [
  ['General', [[['⌘', 'K'], 'Command palette'], [['/'], 'Filter components'], [['⌘', '⇧', 'L'], 'Toggle theme'], [['⇧', 'D'], 'Design QA'], [['?'], 'Keyboard shortcuts']]],
  ['Command palette', [[['↑', '↓'], 'Move'], [['↵'], 'Run'], [['Esc'], 'Close']]],
  ['Component filter', [[['Esc'], 'Clear and leave'], [['/'], 'Jump back in']]],
  ['Design QA (panel open)', [[['M'], 'Measure'], [['G'], '8px grid'], [['O'], 'Outlines'], [['Esc'], 'Leave measure']]],
]

/** Grouped keyboard shortcuts for this page, opened with `?`. */
function ShellShortcuts({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const t = useMessages(SHOWCASE_MSG), { t: tc } = useLocale()
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title={t('shortcuts')} description={t('shortcutsHint')} className="!max-w-[560px]">
      <div className="grid gap-x-6 gap-y-4 sm:grid-cols-2">
        {SHELL_SHORTCUTS.map(([group, items]) => (
          <div key={group}>
            <h5 className="m-0 mb-1 text-[11px] font-medium tracking-wide text-[var(--fg3)] uppercase">{group}</h5>
            {items.map(([keys, label]) => (
              <div key={label} className="flex items-center justify-between border-b border-[var(--line)] py-1.5 text-[13px] last:border-0">
                <span className="text-[var(--fg2)]">{label}</span><span className="flex gap-1">{keys.map(k => <Kbd key={k}>{k}</Kbd>)}</span>
              </div>
            ))}
          </div>
        ))}
      </div>
      <div className="mt-4 flex justify-end"><Button size="sm" onClick={() => onOpenChange(false)}>{tc('common.done')}</Button></div>
    </Dialog>
  )
}

/** Cards of one section in page order. */
function shellOrder(specs: SpecEntry[]) {
  const pos = (e: SpecEntry) => document.getElementById(e.id)
  return [...specs].sort((a, b) => {
    const x = pos(a), y = pos(b)
    if (!x || !y) return 0
    return x.compareDocumentPosition(y) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1
  })
}

const shellReduce = () => matchMedia('(prefers-reduced-motion: reduce)').matches
const shellJump = (id: string) => document.getElementById(id)?.scrollIntoView({ behavior: shellReduce() ? 'auto' : 'smooth' })

/** The section on screen, from one IntersectionObserver over the 16 sections (no scroll listeners). */
function useShellActiveSection() {
  const [active, setActive] = useState<string>('buttons')
  useEffect(() => {
    const io = new IntersectionObserver(es => es.forEach(e => e.isIntersecting && setActive(e.target.id)), { rootMargin: '-40% 0px -55% 0px' })
    SECTIONS.forEach(([id]) => { const el = document.getElementById(id); if (el) io.observe(el) })
    return () => io.disconnect()
  }, [])
  return active
}

/** One section link. Memoised so the sliding highlight (a layoutId animation, which makes motion re-project every
 * layout node on the page) only re-renders when the active section really changes, not on every card change. */
const ShellSectionLink = memo(function ShellSectionLink({ id, label, on, group, chip }: { id: string; label: string; on: boolean; group: string; chip?: boolean }) {
  return (
    <a href={`#${id}`} data-chip={chip ? id : undefined} onClick={e => { e.preventDefault(); shellJump(id) }} aria-current={on ? 'true' : undefined}
      className={chip
        ? cn('relative flex-none rounded-[var(--r-md)] border border-[var(--line)] px-2.5 py-1.5 text-[13px] whitespace-nowrap no-underline', on ? 'font-medium text-[var(--fg)]' : 'text-[var(--fg2)]')
        : cn('relative rounded-[var(--r-md)] px-2.5 py-1.5 text-[13px] no-underline', on ? 'font-medium text-[var(--fg)]' : 'text-[var(--fg2)] hover:bg-[var(--muted)] hover:text-[var(--fg)]')}>
      {on && <ActiveIndicator group={group} className={chip ? 'rounded-[calc(var(--r-md)-2px)] bg-[var(--muted)]' : 'rounded-[var(--r-md)] bg-[var(--muted)]'} />}<span className="relative">{label}</span>
    </a>
  )
})

type ShellNavProps = { ordered: SpecEntry[]; query: string; setQuery: (q: string) => void; total: number; filterRef: RefObject<HTMLInputElement | null>; goSpec: (s: SpecEntry, flash?: boolean) => void }

/**
 * Desktop sidebar: filter box, the section list, and below it a panel with the cards of the section on screen (it
 * tracks the card in view). The section links never move: the panel under them swaps its content and scrolls on
 * its own, so changing section doesn't reflow the list. While filtering, the panel lists every match instead.
 */
const ShellSideNav = memo(function ShellSideNav({ ordered, query, setQuery, total, filterRef, goSpec }: ShellNavProps) {
  const active = useShellActiveSection()
  const [activeSpec, setActiveSpec] = useState('')
  const sideRef = useRef<HTMLElement>(null), subRef = useRef<HTMLDivElement>(null)
  const group = useId(), subId = useId()
  useEffect(() => { // which card is on screen: one observer for all cards
    if (!sideRef.current?.offsetParent) return // hidden on mobile: don't track
    const io = new IntersectionObserver(es => es.forEach(e => e.isIntersecting && setActiveSpec(e.target.id)), { rootMargin: '-35% 0px -60% 0px' })
    ordered.forEach(s => { const el = document.getElementById(s.id); if (el) io.observe(el) })
    return () => io.disconnect()
  }, [ordered])
  const q = query.trim()
  const subs = q ? ordered.filter(s => specMatches(s, query)) : ordered.filter(s => s.section === active)
  useEffect(() => { // keep the current card's link in view, scrolling only the panel
    const box = subRef.current, a = box?.querySelector<HTMLElement>(`[data-sub="${activeSpec}"]`)
    if (!box || !a) return
    const r = a.getBoundingClientRect(), br = box.getBoundingClientRect()
    if (r.top < br.top + 8 || r.bottom > br.bottom - 8) box.scrollTo({ top: a.offsetTop - box.clientHeight / 2, behavior: shellReduce() ? 'auto' : 'smooth' })
  }, [activeSpec, active])
  const sectionLabel = Object.fromEntries(SECTIONS) as Record<string, string>
  const t = useMessages(SHOWCASE_MSG)
  return (
    <nav ref={sideRef} aria-label={t('sections')}
      className="sticky top-[calc(env(safe-area-inset-top,0px)+76px)] hidden max-h-[calc(100vh-env(safe-area-inset-top,0px)-96px)] flex-col self-start overflow-auto pb-5 [scrollbar-width:thin] min-[900px]:flex">
      <div className="relative mb-2.5 flex-none">
        <Icon name="search" size={13} strokeWidth={2.2} className="pointer-events-none absolute top-[9.5px] start-[9px] text-[var(--fg3)]" />
        <input ref={filterRef} value={query} onChange={e => setQuery(e.target.value)} placeholder={t('filterPlaceholder')} aria-label={t('filterLabel')}
          onKeyDown={e => { if (e.key === 'Escape') { setQuery(''); e.currentTarget.blur() } }}
          className="h-8 w-full rounded-[var(--r-md)] border border-[var(--line)] bg-[var(--card)] pe-8 ps-7 text-[13px] text-[var(--fg)] outline-none placeholder:text-xs placeholder:text-[var(--fg3)] focus:border-[var(--fg3)] focus:shadow-[0_0_0_3px_var(--muted)]" />
        <Kbd className="ui-num pointer-events-none absolute top-[7px] end-1.5" aria-live="polite">{q ? total : '/'}</Kbd>
      </div>
      <div className="flex flex-none flex-col gap-0.5">
        {SECTIONS.map(([id, label]) => {
          const none = !!q && !ordered.some(s => s.section === id && specMatches(s, query))
          return <div key={id} className={cn('flex flex-col', none && 'opacity-40')}><ShellSectionLink id={id} label={label} on={active === id} group={group} /></div>
        })}
      </div>
      <div className="mt-3 flex min-h-[120px] flex-1 flex-col border-t border-[var(--line)] pt-2.5">
        <h2 id={subId} className="m-0 mb-1 flex flex-none items-baseline justify-between px-2.5 text-[11px] font-medium tracking-wide text-[var(--fg3)] uppercase">
          <span className="truncate">{q ? t('matches') : sectionLabel[active]}</span><span className="ui-num w-8 flex-none text-end normal-case">{subs.length}</span>
        </h2>
        <div ref={subRef} role="list" aria-labelledby={subId} className="relative min-h-0 flex-1 overflow-auto overscroll-contain [scrollbar-width:thin]">
          {subs.map((s, i) => (
            <div key={s.id} role="listitem">
              {q && s.section !== subs[i - 1]?.section && <span aria-hidden className="mt-1.5 block px-2.5 text-[11px] text-[var(--fg3)]">{sectionLabel[s.section]}</span>}
              <a href={`#${s.id}`} data-sub={s.id} aria-current={activeSpec === s.id ? 'location' : undefined}
                onClick={e => { e.preventDefault(); goSpec(s, false); history.replaceState(null, '', `#${s.id}`) }}
                className={cn('block truncate rounded-[var(--r-md)] px-2.5 py-1 text-xs no-underline hover:bg-[var(--muted)] hover:text-[var(--fg)]',
                  activeSpec === s.id ? 'bg-[var(--muted)] text-[var(--fg)]' : 'text-[var(--fg2)]')}>{s.title}</a>
            </div>
          ))}
          {q && !subs.length && <span className="block px-2.5 py-1 text-xs text-[var(--fg3)]">{t('noMatches')}</span>}
        </div>
      </div>
    </nav>
  )
})

/**
 * Below 900px: a sticky horizontal chip row instead of the sidebar. Its first chip opens the component filter in
 * place of the chips (a tag tapped on a card opens it too); Cancel clears the filter and brings the chips back.
 */
const ShellChipNav = memo(function ShellChipNav({ query, setQuery, total, searching, setSearching, filterRef }:
  Pick<ShellNavProps, 'query' | 'setQuery' | 'total' | 'filterRef'> & { searching: boolean; setSearching: (v: boolean) => void }) {
  const active = useShellActiveSection()
  const chipsRef = useRef<HTMLDivElement>(null)
  const group = useId()
  const q = query.trim(), filtering = searching || !!q
  useEffect(() => {
    const row = chipsRef.current, chip = row?.querySelector<HTMLElement>(`[data-chip="${active}"]`)
    if (!row || !chip || !row.offsetParent) return
    // centre the chip; in RTL scrollLeft counts from the right edge (0 down to negative)
    const left = chip.offsetLeft - row.clientWidth / 2 + chip.offsetWidth / 2
    row.scrollTo({ left: getComputedStyle(row).direction === 'rtl' ? left - (row.scrollWidth - row.clientWidth) : left, behavior: shellReduce() ? 'auto' : 'smooth' })
  }, [active, filtering])
  const done = () => { setQuery(''); setSearching(false) }
  const t = useMessages(SHOWCASE_MSG), { t: tc, fmt } = useLocale()
  return (
    <nav aria-label={t('sections')} className="sticky top-[calc(env(safe-area-inset-top,0px)+57px)] z-30 -mx-4 -mt-4 min-w-0 bg-[var(--bg)] px-[max(16px,env(safe-area-inset-left))] py-2 sm:-mx-5 sm:px-5 min-[900px]:hidden">
      {filtering ? (
        <div role="search" className="flex items-center gap-2">
          <div className="relative min-w-0 flex-1">
            <Icon name="search" size={14} className="pointer-events-none absolute top-1/2 start-2.5 -translate-y-1/2 text-[var(--fg3)]" />
            <input ref={filterRef} value={query} onChange={e => setQuery(e.target.value)} placeholder={t('filterShort')} aria-label={t('filterLabel')} enterKeyHint="search"
              onKeyDown={e => { if (e.key === 'Escape') { done() } else if (e.key === 'Enter') e.currentTarget.blur() }}
              className="h-9 w-full rounded-[var(--r-md)] border border-[var(--line)] bg-[var(--card)] pe-12 ps-8 text-[13px] text-[var(--fg)] outline-none placeholder:text-[var(--fg3)] focus:border-[var(--fg3)] focus:shadow-[0_0_0_3px_var(--muted)]" />
            <span className="ui-num pointer-events-none absolute top-1/2 end-2.5 -translate-y-1/2 text-xs text-[var(--fg3)]" aria-live="polite">{q ? t('found', { count: fmt.number(total) }) : ''}</span>
          </div>
          <Button variant="ghost" onClick={done} className="flex-none !px-2.5">{tc('common.cancel')}</Button>
        </div>
      ) : (
        <div ref={chipsRef} className="-mx-[max(16px,env(safe-area-inset-left))] flex gap-1.5 overflow-x-auto px-[max(16px,env(safe-area-inset-left))] [scrollbar-width:none] sm:-mx-5 sm:px-5">
          <button type="button" onClick={() => { setSearching(true); requestAnimationFrame(() => filterRef.current?.focus()) }} aria-label={t('filterComponents')}
            className="inline-flex flex-none cursor-pointer items-center gap-1.5 rounded-[var(--r-md)] border border-[var(--line)] bg-[var(--card)] px-2.5 py-1.5 text-[13px] whitespace-nowrap text-[var(--fg2)]">
            <Icon name="search" size={14} />{t('filter')}
          </button>
          {SECTIONS.map(([id, label]) => <ShellSectionLink key={id} id={id} label={label} on={active === id} group={group} chip />)}
        </div>
      )}
    </nav>
  )
})

/** Scrolling commands wait until the palette has closed and released its scroll lock: overflow:hidden on
 * <html> (and the focus hand-back) would cancel a smooth scroll that started while it was still exiting. */
const shellAfterPalette = (fn: () => void) => () => {
  const t0 = Date.now()
  const tick = () => { if (document.documentElement.style.overflow === 'hidden' && Date.now() - t0 < 1000) requestAnimationFrame(tick); else fn() }
  setTimeout(tick, 30)
}

/** Ask the Overlays section to open its demo dialog or sheet (⌘K "Open modal" / "Open drawer"). */
const shellOverlayDemo = (which: OverlayDemo) => dispatchEvent(new CustomEvent<OverlayDemo>(OVERLAY_DEMO_EVENT, { detail: which }))

/* Locale and direction (0.4) ─────────────────────────────────────────────── */

/** The locales the switcher offers, with the example catalog each one uses (en-US and ja-JP fall back to English). */
const SHELL_LOCALES: [string, Partial<UIMessages> | undefined][] = [['en-GB', undefined], ['en-US', undefined], ['de-DE', UI_MESSAGES_DE], ['ar-EG', UI_MESSAGES_AR], ['ja-JP', undefined]]
type ShellLocale = { locale: string; dir: UIDir | 'auto' }
const SHELL_LOCALE_KEY = 'ui-showcase-locale'
const SHELL_LOCALE_DEFAULT: ShellLocale = { locale: 'en-GB', dir: 'auto' }
/** The saved choice, validated (falls back to en-GB / auto). */
function shellLocaleRead(): ShellLocale {
  try {
    const v: unknown = JSON.parse(localStorage.getItem(SHELL_LOCALE_KEY) ?? 'null')
    if (!v || typeof v !== 'object') return SHELL_LOCALE_DEFAULT
    const { locale, dir } = v as Record<string, unknown>
    return { locale: SHELL_LOCALES.some(([l]) => l === locale) ? locale as string : 'en-GB', dir: dir === 'ltr' || dir === 'rtl' ? dir : 'auto' }
  } catch { return SHELL_LOCALE_DEFAULT }
}
const ShellLocaleContext = createContext<{ value: ShellLocale; set: (v: Partial<ShellLocale>) => void }>({ value: SHELL_LOCALE_DEFAULT, set: () => {} })

/** Header menu: pick the provider's locale (each shown in its own language) and force a direction. Saved per viewer. */
function ShellLocaleMenu() {
  const { value, set } = useContext(ShellLocaleContext)
  const { t, dir } = useLocale(), tm = useMessages(SHOWCASE_MSG)
  const own = (l: string) => fmtFor(l).displayName(l, 'language')
  return (
    <DropdownMenu placement={dir === 'rtl' ? 'bottom-start' : 'bottom-end'} className="max-sm:[&>button]:!w-9 max-sm:[&>button]:!px-0" trigger={
      <span className="flex items-center gap-1.5 font-normal"><Icon name="globe" size={15} /><span className="sr-only">{t('locale.language')}: </span><span className="text-xs text-[var(--fg2)] max-sm:sr-only">{value.locale}</span></span>}>
      <div aria-hidden className="px-2 pt-1 pb-0.5 text-[11px] font-medium text-[var(--fg3)]">{t('locale.language')}</div>
      {SHELL_LOCALES.map(([l]) => (
        <MenuItem key={l} icon={value.locale === l ? 'check' : undefined} onSelect={() => set({ locale: l })} className={value.locale === l ? '' : '!ps-8'}>
          <span lang={l} className="whitespace-nowrap">{own(l)}</span><span className="ui-num text-[11px] whitespace-nowrap text-[var(--fg3)]">{l}</span>
        </MenuItem>
      ))}
      <div aria-hidden className="mt-1 border-t border-[var(--line)] px-2 pt-2 pb-0.5 text-[11px] font-medium text-[var(--fg3)]">{t('locale.direction')}</div>
      {(['auto', 'ltr', 'rtl'] as const).map(d => (
        <MenuItem key={d} icon={value.dir === d ? 'check' : undefined} onSelect={() => set({ dir: d })} className={value.dir === d ? '' : '!ps-8'}>
          <span className="whitespace-nowrap">{d === 'auto' ? tm('auto', { dir: t(dir === 'rtl' ? 'locale.rtl' : 'locale.ltr') }) : t(d === 'rtl' ? 'locale.rtl' : 'locale.ltr')}</span>
        </MenuItem>
      ))}
    </DropdownMenu>
  )
}

function ShowcaseBody() {
  const { set, toggle, settings } = useTheme()
  const tm = useMessages(SHOWCASE_MSG)
  const toast = useToast()
  const [palette, setPalette] = useState(false)
  const [appearance, setAppearance] = useState(false)
  const [keys, setKeys] = useState(false)
  const [query, setQuery] = useState('')
  const [mobileFilter, setMobileFilter] = useState(false)
  const filterRef = useRef<HTMLInputElement>(null), mobileFilterRef = useRef<HTMLInputElement>(null)
  /** Focus whichever filter box is on screen: the sidebar one, or the chip-row one below 900px (opened first). */
  const openFilter = useCallback((focus = true) => {
    const side = filterRef.current
    if (side?.offsetParent) { if (focus) { side.focus(); side.select() } return }
    setMobileFilter(true)
    if (focus) requestAnimationFrame(() => { mobileFilterRef.current?.focus(); mobileFilterRef.current?.select() })
  }, [])
  const specs = useSpecs()
  const ordered = useMemo(() => shellOrder(specs), [specs])
  const total = useMemo(() => ordered.filter(s => specMatches(s, query)).length, [ordered, query])
  const queryRef = useRef(query); queryRef.current = query // eslint-disable-line react-hooks/refs

  useHotkey('mod+k', () => setPalette(p => !p))
  useHotkey('mod+shift+l', () => toggle())
  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || shellTyping(e.target)) return
      if (e.key === '/') { e.preventDefault(); openFilter() }
      else if (e.key === '?') { e.preventDefault(); setKeys(k => !k) }
    }
    addEventListener('keydown', on); return () => removeEventListener('keydown', on)
  }, [openFilter])

  const goSpec = useCallback((s: SpecEntry, flash = true) => {
    const run = () => flash ? flashSpec(s.id) : document.getElementById(s.id)?.scrollIntoView({ behavior: shellReduce() ? 'auto' : 'smooth', block: 'start' })
    if (!specMatches(s, queryRef.current)) { setQuery(''); requestAnimationFrame(() => requestAnimationFrame(run)) } else run()
  }, [])
  const focusFilter = useCallback(() => openFilter(!matchMedia('(pointer: coarse)').matches || !!filterRef.current?.offsetParent), [openFilter])
  const shell = useMemo(() => ({ query, setQuery, focusFilter }), [query, focusFilter])

  // Commands are rebuilt only when the cards or theme change; runners reach the latest theme API through a ref.
  const api = useRef({ set, toggle, toast }); api.current = { set, toggle, toast } // eslint-disable-line react-hooks/refs
  const commands = useMemo(() => {
    const sectionLabel = Object.fromEntries(SECTIONS) as Record<string, string>
    const list: Command[] = [
      ...SECTIONS.map(([id, label]) => ({ id: `go-${id}`, label: `Go to ${label}`, group: 'Navigate', icon: 'layers' as IconName, keywords: [id, SECTION_TAGS[id] ?? ''], hint: 'Section', run: shellAfterPalette(() => shellJump(id)) })),
      ...ordered.map(s => ({ id: `spec-${s.id}`, label: s.title, group: 'Components', icon: 'layers' as IconName, keywords: [...s.tags, sectionLabel[s.section]], hint: s.desc, run: shellAfterPalette(() => goSpec(s)) })),
      { id: 'act-toggle', label: 'Toggle light / dark', group: 'Actions', icon: 'moon', shortcut: '⌘⇧L', keywords: ['theme', 'mode', 'dark mode', 'light mode', 'switch'], hint: 'Theme', run: () => api.current.toggle() },
      { id: 'act-settings', label: 'Open theme settings', group: 'Actions', icon: 'settings', keywords: ['appearance', 'colours', 'colors', 'customise', 'radius', 'font', 'palette'], hint: 'Appearance panel', run: () => setAppearance(true) },
      { id: 'act-toast', label: 'Show a toast', group: 'Actions', icon: 'bell', keywords: ['notification', 'feedback', 'demo'], hint: 'Demo', run: () => api.current.toast({ title: 'Changes saved', description: 'Synced across devices' }) },
      { id: 'act-keys', label: 'Keyboard shortcuts', group: 'Actions', icon: 'keyboard', shortcut: '?', keywords: ['help', 'keys', 'hotkeys', 'keyboard'], hint: 'Help', run: () => setKeys(true) },
      { id: 'act-modal', label: 'Open modal', group: 'Actions', icon: 'layers', keywords: ['dialog', 'overlay', 'demo', 'confirm'], hint: 'Overlays demo', run: shellAfterPalette(() => shellOverlayDemo('modal')) },
      { id: 'act-drawer', label: 'Open drawer', group: 'Actions', icon: 'panel', keywords: ['sheet', 'side panel', 'filters', 'overlay', 'demo'], hint: 'Overlays demo', run: shellAfterPalette(() => shellOverlayDemo('sheet')) },
      { id: 'act-filter', label: 'Filter components', group: 'Actions', icon: 'search', shortcut: '/', keywords: ['search', 'sidebar', 'tags', 'use case'], hint: 'Sidebar', run: () => requestAnimationFrame(() => openFilter()) },
      { id: 'qa-toggle', label: 'Design QA', group: 'Tools', icon: 'sliders', shortcut: '⇧D', keywords: ['audit', 'spacing', 'lint', 'design review'], hint: 'Panel', run: () => designQA.toggle() },
      { id: 'qa-run', label: 'Design QA: run audit', group: 'Tools', icon: 'check', keywords: ['audit', 'spacing', 'contrast', 'alignment', 'score'], hint: 'Scan every card', run: shellAfterPalette(() => designQA.run()) },
      { id: 'qa-measure', label: 'Design QA: measure', group: 'Tools', icon: 'sliders', shortcut: 'M', keywords: ['box model', 'distance', 'gap', 'ruler', 'spacing'], hint: 'Hover to measure', run: () => designQA.setMode('m', true) },
      { id: 'qa-grid', label: 'Design QA: grid overlay', group: 'Tools', icon: 'layers', shortcut: 'G', keywords: ['8px', 'baseline', 'grid', 'spacing'], hint: 'Toggle', run: () => designQA.setMode('g') },
      { id: 'qa-outline', label: 'Design QA: outlines', group: 'Tools', icon: 'layers', shortcut: 'O', keywords: ['outline', 'boxes', 'debug', 'layout'], hint: 'Toggle', run: () => designQA.setMode('o') },
      { id: 'qa-cls', label: 'Design QA: layout shift (CLS)', group: 'Tools', icon: 'chart', keywords: ['cls', 'web vitals', 'performance', 'jank', 'shift'], hint: 'Live meter', run: () => designQA.showCls() },
      { id: 'mode-light', label: 'Mode: Light', group: 'Appearance', icon: 'sun', run: () => api.current.set({ mode: 'light' }) },
      { id: 'mode-dark', label: 'Mode: Dark', group: 'Appearance', icon: 'moon', run: () => api.current.set({ mode: 'dark' }) },
      { id: 'mode-system', label: 'Mode: System', group: 'Appearance', icon: 'monitor', run: () => api.current.set({ mode: 'system' }) },
      ...THEMES.map(t => ({ id: `theme-${t.id}`, label: `Theme: ${t.name}`, group: 'Appearance', icon: 'layers' as IconName, keywords: ['theme', ...[...t.light, ...t.dark].map(v => v[0])], run: () => api.current.set({ theme: t.id }) })),
      ...THEMES.flatMap(t => (['light', 'dark'] as const).flatMap(mode => t[mode].length < 2 ? [] : t[mode].map(([n], i) => ({
        id: `theme-${t.id}-${mode}-${i}`, label: `Theme: ${t.name} ${n}`, group: 'Appearance', icon: 'layers' as IconName, keywords: ['theme', mode], hint: mode === 'dark' ? 'Dark variant' : 'Light variant',
        run: () => api.current.set({ theme: t.id, mode, variant: { ...settings.variant, [t.id]: i } }),
      })))),
    ]
    return list
  }, [ordered, goSpec, settings.variant, openFilter])
  const paletteEl = useMemo(() => <CommandPalette open={palette} onOpenChange={setPalette} commands={commands} placeholder={tm('paletteSearch')} suggestion="chart" />, [palette, commands, tm])

  // The sections never depend on shell state. Keeping them in one memoised element means scrolling, typing in
  // the filter or opening overlays doesn't re-render (and make motion re-measure) the whole page.
  const sections = useMemo(() => (
    <>
      <ButtonsSection /><MotionSection /><InputsSection /><FormsSection /><NavigationSection /><FeedbackSection />
      <OverlaysSection openPalette={() => setPalette(true)} /><DataSection /><LayoutSection /><CollabSection /><PagesSection />
      <ChartsSection /><DiagramsSection /><CodeSection /><MediaSection /><AISection />
    </>
  ), [])
  const q = query.trim()
  return (
    <ShellContext.Provider value={shell}>
      <header className="sticky top-[env(safe-area-inset-top,0px)] z-40 border-b border-[var(--line)] bg-[color-mix(in_srgb,var(--bg)_85%,transparent)] backdrop-blur-md">
        <div className="mx-auto flex h-14 max-w-[1320px] items-center gap-2 pr-[max(16px,env(safe-area-inset-right))] pl-[max(16px,env(safe-area-inset-left))] sm:gap-3 sm:px-5">
          <span role="heading" aria-level={1} className="flex items-center gap-2 font-semibold tracking-tight whitespace-nowrap"><i className="inline-block h-[18px] w-[18px] rounded-[var(--r-sm)] bg-[var(--primary)]" />{tm('libraryName')}</span>
          <span className="hidden text-xs text-[var(--fg3)] sm:inline">{tm('tagline')}</span>
          <span className="flex-1" />
          <Button onClick={() => setPalette(true)} className="max-[900px]:!w-9 max-[900px]:!px-0 min-[900px]:min-w-[220px] min-[900px]:!justify-between">
            {/* the visible words are the name (no aria-label to mismatch); below 900px only the icon shows, so the words stay for screen readers */}
            <span className="flex items-center gap-2 font-normal text-[var(--fg3)]"><Icon name="search" size={14} /><span className="max-[900px]:sr-only">{tm('searchComponents')}</span></span>
            <span aria-hidden className="max-[900px]:hidden"><Kbd>⌘K</Kbd></span>
          </Button>
          <DesignQAButton />
          <ShellLocaleMenu />
          <AppearanceMenu open={appearance} onOpenChange={setAppearance} />
          <ThemeToggle />
        </div>
      </header>
      <div className="mx-auto grid max-w-[1320px] gap-4 pt-4 pr-[max(16px,env(safe-area-inset-right))] pb-[max(80px,calc(env(safe-area-inset-bottom)+64px))] pl-[max(16px,env(safe-area-inset-left))] sm:px-5 min-[900px]:grid-cols-[212px_minmax(0,1fr)] min-[900px]:gap-8 min-[900px]:pt-6">
        <ShellSideNav ordered={ordered} query={query} setQuery={setQuery} total={total} filterRef={filterRef} goSpec={goSpec} />
        <ShellChipNav query={query} setQuery={setQuery} total={total} searching={mobileFilter} setSearching={setMobileFilter} filterRef={mobileFilterRef} />
        <main className="min-w-0">
          {sections}
          <AnimatePresence>
            {q && total === 0 && (
              <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.2 }}
                className="rounded-[var(--r-lg)] border border-dashed border-[var(--line2)] p-10 text-center text-[var(--fg3)]">
                {tm('noneMatch', { query: q })}<Button size="sm" className="ms-2" onClick={() => { setQuery(''); openFilter(!matchMedia('(pointer: coarse)').matches) }}>{tm('clearFilter')}</Button>
              </motion.div>
            )}
          </AnimatePresence>
        </main>
      </div>
      {paletteEl}
      <ShellShortcuts open={keys} onOpenChange={setKeys} />
      <CodeDrawer />
      <DesignQA />
    </ShellContext.Provider>
  )
}

/** Default export: the full catalogue. Import the named components to use them in your own app. */
/** The CSP nonce the page was served with, if any (Vite's `html.cspNonce` puts it on <meta property="csp-nonce">). */
const showcaseNonce = () => (typeof document === 'undefined' ? undefined : document.querySelector<HTMLMetaElement>('meta[property="csp-nonce"]')?.nonce || undefined)

export default function Showcase({ locale, dir = 'auto' }: { /** the server and first-render locale (default en-GB) */ locale?: string; dir?: UIDir | 'auto' } = {}) {
  // `locale` (en-GB) on the server and the first client render (no mismatch); the viewer's saved choice applies before
  // the first paint (a layout effect), so a saved Arabic page never flashes left to right
  const [loc, setLoc] = useState<ShellLocale>(() => (locale ? { locale, dir } : SHELL_LOCALE_DEFAULT))
  useLayoutEffect(() => { const saved = shellLocaleRead(); if (saved !== SHELL_LOCALE_DEFAULT || !locale) setLoc(saved) }, []) // eslint-disable-line react-hooks/exhaustive-deps
  const shellLocale = useMemo(() => ({
    value: loc,
    set: (v: Partial<ShellLocale>) => setLoc(cur => {
      const next = { ...cur, ...v }
      try { localStorage.setItem(SHELL_LOCALE_KEY, JSON.stringify(next)) } catch { /* storage blocked */ }
      return next
    }),
  }), [loc])
  const messages = SHELL_LOCALES.find(([l]) => l === loc.locale)?.[1]
  return (
    <ShellLocaleContext.Provider value={shellLocale}>
      <UIProvider fonts nonce={showcaseNonce()} locale={loc.locale} dir={loc.dir} messages={messages}><ShowcaseBody /></UIProvider>
    </ShellLocaleContext.Provider>
  )
}
