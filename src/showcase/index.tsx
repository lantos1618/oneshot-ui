import { memo, useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type RefObject } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { ActiveIndicator, AppearanceMenu, Badge, Button, Collapse, type Command, CommandPalette, Dialog, Icon, type IconName, Kbd, Sheet, THEMES, ThemeToggle, UIProvider, cn, useHotkey, useRoving, useTheme, useToast, fmt } from '../lib'
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
import { SECTIONS, SECTION_AREA, ShellContext, type SpecEntry, flashSpec, mountAllSpecs, specMatches, useSpecs } from './kit'
import { TAG_BY_ID, type TagFacet, type TagId, tagFacetCounts, tagParseUrl, tagSearchString, tagSuggest, tagToggle, tagsOfFacet } from './tags'
import { CodeDrawer } from './CodeDrawer'
import { DesignQA, DesignQAButton, designQA, useDesignQA } from './DesignQA'
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
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title={'Keyboard shortcuts'} description={'With a hardware keyboard. Single keys work anywhere except while typing.'} className="!max-w-[560px]">
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
      <div className="mt-4 flex justify-end"><Button size="sm" onClick={() => onOpenChange(false)}>{'Done'}</Button></div>
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
/** A tag's label, id and synonyms, for ⌘K keywords. */
const shellTagWords = (id: TagId) => [TAG_BY_ID[id].label, id, ...TAG_BY_ID[id].synonyms]
/** The tags the cards on the page use, with how many cards each (vocabulary order). */
const shellTagsInUse = (specs: SpecEntry[]): [TagId, number][] => {
  const n = new Map<TagId, number>()
  for (const s of specs) for (const t of s.tags) n.set(t, (n.get(t) ?? 0) + 1)
  return (Object.keys(TAG_BY_ID) as TagId[]).filter(id => n.has(id)).map(id => [id, n.get(id)!])
}
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

/* Tag filter (0.9) ───────────────────────────────────────────────────────────────────────────────────────────── */

/** The facets the filter offers, in order (kind is left out: area says more on this page; ?tags= still takes kinds). */
const SHELL_FACETS: [TagFacet, string][] = [['area', 'Area'], ['use', 'Use case'], ['capability', 'Capability'], ['status', 'Status']]
type ShellFilter = { query: string; tags: readonly TagId[]; setQuery: (q: string) => void; toggleTag: (id: TagId) => void; clear: () => void; counts: Record<TagId, number>; total: number }

/** One facet's tags as toggle chips with counts (OR within the facet). One Tab stop: arrows move, Enter or Space toggles.
 * A chip that would match nothing (and isn't on) is disabled and skipped. */
function ShellTagGroup({ facet, label, f, touch }: { facet: TagFacet; label: string; f: ShellFilter; touch?: boolean }) {
  const defs = tagsOfFacet(facet)
  const refs = useRef<(HTMLButtonElement | null)[]>([])
  const off = (i: number) => !f.tags.includes(defs[i].id as TagId) && !f.counts[defs[i].id as TagId]
  const { active, setActive, onKeyDown } = useRoving(defs.length, i => f.toggleTag(defs[i].id as TagId), { orientation: 'both', isDisabled: off, onMove: i => refs.current[i]?.focus() })
  const stop = off(active) ? Math.max(0, defs.findIndex((_, i) => !off(i))) : active
  const head = useId()
  return (
    <div className="flex flex-col gap-1.5">
      <span id={head} className="text-[11px] font-medium tracking-wide text-[var(--fg3)] uppercase">{label}</span>
      <div role="group" aria-labelledby={head} onKeyDown={onKeyDown} className="flex flex-wrap gap-1">
        {defs.map((d, i) => {
          const id = d.id as TagId, on = f.tags.includes(id)
          return (
            <button key={id} ref={el => { refs.current[i] = el }} type="button" aria-pressed={on} disabled={off(i)} tabIndex={i === stop ? 0 : -1} title={d.desc}
              onClick={() => { setActive(i); f.toggleTag(id) }} onFocus={() => setActive(i)}
              className={cn('inline-flex flex-none cursor-pointer items-center gap-1 rounded-full border px-2 text-[11px] leading-none font-medium whitespace-nowrap transition-colors duration-150 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--accent)] disabled:cursor-default disabled:opacity-50',
                touch ? 'h-8' : 'h-6 [@media(pointer:coarse)]:h-8',
                on ? 'border-[var(--primary)] bg-[var(--primary)] text-[var(--on-primary)]' : 'border-[var(--line)] bg-[var(--card)] text-[var(--fg2)] enabled:hover:bg-[var(--muted)] enabled:hover:text-[var(--fg)]')}>
              {d.label}<span className={cn('ui-num font-normal', on ? '' : 'text-[var(--fg3)]')}>{fmt.number(f.counts[id])}</span>
            </button>
          )
        })}
      </div>
    </div>
  )
}

/** Every facet's chips (the desktop sidebar's "Filter by tag" panel, and the phone's sheet). */
function ShellTagPanel({ f, touch }: { f: ShellFilter; touch?: boolean }) {
  return (
    <div className="flex flex-col gap-3">
      <p className="m-0 text-[11px] leading-snug text-[var(--fg3)]">{'Within a group any tag matches; across groups all must.'}</p>
      {SHELL_FACETS.map(([facet, key]) => <ShellTagGroup key={facet} facet={facet} label={key} f={f} touch={touch} />)}
    </div>
  )
}

/** The selected tags as removable chips (a list, so it reads "Active filters, 2 items"). */
function ShellActiveTags({ f, className }: { f: ShellFilter; className?: string }) {
  if (!f.tags.length) return null
  return (
    <ul aria-label={'Active filters'} className={cn('m-0 flex list-none gap-1 p-0', className)}>
      {f.tags.map(id => (
        <li key={id} className="flex-none">
          <button type="button" onClick={() => f.toggleTag(id)} aria-label={`Remove filter: ${TAG_BY_ID[id].label}`}
            className="inline-flex h-6 cursor-pointer items-center gap-1 rounded-full border border-[var(--primary)] bg-[var(--primary)] ps-2 pe-1.5 text-[11px] leading-none font-medium whitespace-nowrap text-[var(--on-primary)] focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--accent)] [@media(pointer:coarse)]:h-8">
            {TAG_BY_ID[id].label}<Icon name="x" size={11} strokeWidth={2.4} />
          </button>
        </li>
      ))}
    </ul>
  )
}

/** A tag whose name is exactly what was typed ("dropdown" → none, "streaming" → Streaming): offer it as a filter. */
function ShellSuggestTag({ f }: { f: ShellFilter }) {
  const hit = tagSuggest(f.query).filter(id => !f.tags.includes(id) && f.counts[id])[0]
  if (!hit) return null
  return (
    <button type="button" onClick={() => { f.toggleTag(hit); f.setQuery('') }}
      className="flex h-6 w-full cursor-pointer items-center gap-1.5 rounded-[var(--r-md)] border-0 bg-transparent px-2.5 text-start text-xs text-[var(--fg2)] hover:bg-[var(--muted)] hover:text-[var(--fg)] focus-visible:outline-2 focus-visible:outline-[var(--accent)] [@media(pointer:coarse)]:h-8">
      <Icon name="sliders" size={12} />{'Filter by tag'}: <span className="font-medium text-[var(--fg)]">{TAG_BY_ID[hit].label}</span>
    </button>
  )
}

type ShellNavProps = { ordered: SpecEntry[]; f: ShellFilter; filterRef: RefObject<HTMLInputElement | null>; goSpec: (s: SpecEntry, flash?: boolean) => void; tagsOpen: boolean; setTagsOpen: (v: boolean) => void }

/**
 * Desktop sidebar: filter box, "Filter by tag" (facet chips with counts, the picked ones as removable chips), the
 * section list, and below it a panel with the cards of the section on screen (it tracks the card in view). The section
 * links never move: the panel under them swaps its content and scrolls on its own, so changing section doesn't reflow
 * the list. While filtering, the panel lists every match instead.
 */
const ShellSideNav = memo(function ShellSideNav({ ordered, f, filterRef, goSpec, tagsOpen, setTagsOpen }: ShellNavProps) {
  const { query, setQuery, total } = f
  const active = useShellActiveSection()
  const [activeSpec, setActiveSpec] = useState('')
  const sideRef = useRef<HTMLElement>(null), subRef = useRef<HTMLDivElement>(null)
  const group = useId(), subId = useId(), panelId = useId()
  useEffect(() => { // which card is on screen: one observer for all cards
    if (!matchMedia('(min-width: 900px)').matches) return // hidden on phones (min-[900px]:flex): don't track; a media query, not offsetParent, which forced a layout of the whole page before the first paint
    const io = new IntersectionObserver(es => es.forEach(e => e.isIntersecting && setActiveSpec(e.target.id)), { rootMargin: '-35% 0px -60% 0px' })
    ordered.forEach(s => { const el = document.getElementById(s.id); if (el) io.observe(el) })
    return () => io.disconnect()
  }, [ordered])
  const q = query.trim(), filtering = !!q || f.tags.length > 0
  const subs = filtering ? ordered.filter(s => specMatches(s, query, f.tags)) : ordered.filter(s => s.section === active)
  useEffect(() => { // keep the current card's link in view, scrolling only the panel
    const box = subRef.current, a = box?.querySelector<HTMLElement>(`[data-sub="${activeSpec}"]`)
    if (!box || !a) return
    const r = a.getBoundingClientRect(), br = box.getBoundingClientRect()
    if (r.top < br.top + 8 || r.bottom > br.bottom - 8) box.scrollTo({ top: a.offsetTop - box.clientHeight / 2, behavior: shellReduce() ? 'auto' : 'smooth' })
  }, [activeSpec, active])
  const sectionLabel = Object.fromEntries(SECTIONS) as Record<string, string>
  return (
    <nav ref={sideRef} aria-label={'Sections'}
      className="sticky top-[calc(env(safe-area-inset-top,0px)+76px)] hidden max-h-[calc(100vh-env(safe-area-inset-top,0px)-96px)] flex-col self-start overflow-auto pb-5 [scrollbar-width:thin] min-[900px]:flex">
      <div className="relative mb-1.5 flex-none">
        <Icon name="search" size={13} strokeWidth={2.2} className="pointer-events-none absolute top-[9.5px] start-[9px] text-[var(--fg3)]" />
        <input ref={filterRef} value={query} onChange={e => setQuery(e.target.value)} placeholder={'Search by name or use case'} aria-label={'Filter components by name or use case'}
          onKeyDown={e => { if (e.key === 'Escape') { setQuery(''); e.currentTarget.blur() } }}
          className="h-8 w-full rounded-[var(--r-md)] border border-[var(--line)] bg-[var(--card)] pe-8 ps-7 text-[13px] text-[var(--fg)] outline-none placeholder:text-xs placeholder:text-[var(--fg3)] focus:border-[var(--fg3)] focus:shadow-[0_0_0_3px_var(--muted)]" />
        <Kbd className="ui-num pointer-events-none absolute top-[7px] end-1.5" aria-live="polite">{filtering ? total : '/'}</Kbd>
      </div>
      <div className="mb-2.5 flex flex-none flex-col gap-1.5">
        <div className="flex items-center gap-1">
          <Button size="xs" variant="ghost" aria-expanded={tagsOpen} aria-controls={panelId} onClick={() => setTagsOpen(!tagsOpen)} className="!px-1.5 !text-[var(--fg2)]">
            <Icon name="sliders" size={13} />{'Filter by tag'}
            {f.tags.length > 0 && <Badge size="sm" tone="accent">{fmt.number(f.tags.length)}</Badge>}
            <Icon name="chevronDown" size={13} className={cn('transition-transform duration-200', tagsOpen && 'rotate-180')} />
          </Button>
          <span className="flex-1" />
          {filtering && <Button size="xs" variant="ghost" onClick={f.clear} className="!px-1.5 !text-[var(--fg2)]">{'Clear filters'}</Button>}
        </div>
        <ShellActiveTags f={f} className="flex-wrap" />
        <div id={panelId}>
          <Collapse open={tagsOpen}><div className="pt-1 pb-2"><ShellTagPanel f={f} /></div></Collapse>
        </div>
      </div>
      <div className="flex flex-none flex-col gap-0.5">
        {SECTIONS.map(([id, label]) => {
          const none = filtering && !ordered.some(s => s.section === id && specMatches(s, query, f.tags))
          // a section with no matches greys out (in --fg3, which still reads at 4.5:1, rather than at 40% opacity)
          return <div key={id} className={cn('flex flex-col', none && '[&>a]:!text-[var(--fg3)]')}><ShellSectionLink id={id} label={label} on={active === id} group={group} /></div>
        })}
      </div>
      <div className="mt-3 flex min-h-[120px] flex-1 flex-col border-t border-[var(--line)] pt-2.5">
        <h2 id={subId} className="m-0 mb-1 flex flex-none items-baseline justify-between px-2.5 text-[11px] font-medium tracking-wide text-[var(--fg3)] uppercase">
          <span className="truncate">{filtering ? 'Matches' : sectionLabel[active]}</span><span className="ui-num w-8 flex-none text-end normal-case">{subs.length}</span>
        </h2>
        {q && <ShellSuggestTag f={f} />}
        <div ref={subRef} role="list" aria-labelledby={subId} className="relative min-h-0 flex-1 overflow-auto overscroll-contain [scrollbar-width:thin]">
          {subs.map((s, i) => (
            <div key={s.id} role="listitem">
              {filtering && s.section !== subs[i - 1]?.section && <span aria-hidden className="mt-1.5 block px-2.5 text-[11px] text-[var(--fg3)]">{sectionLabel[s.section]}</span>}
              <a href={`#${s.id}`} data-sub={s.id} aria-current={activeSpec === s.id ? 'location' : undefined}
                onClick={e => { e.preventDefault(); goSpec(s, false); history.replaceState(history.state, '', `${location.pathname}${location.search}#${s.id}`) }}
                className={cn('block truncate rounded-[var(--r-md)] px-2.5 py-1 text-xs no-underline hover:bg-[var(--muted)] hover:text-[var(--fg)]',
                  activeSpec === s.id ? 'bg-[var(--muted)] text-[var(--fg)]' : 'text-[var(--fg2)]')}>{s.title}</a>
            </div>
          ))}
          {filtering && !subs.length && <span className="block px-2.5 py-1 text-xs text-[var(--fg3)]">{'No matches'}</span>}
        </div>
      </div>
    </nav>
  )
})

/**
 * Below 900px: a sticky horizontal chip row instead of the sidebar. Its first chip opens the component filter in
 * place of the chips (a tag tapped on a card opens it too): the search box, a Tags button that opens the facet chips
 * in a sheet, and the picked tags as a row of removable chips. Cancel clears the filter and brings the chips back.
 */
const ShellChipNav = memo(function ShellChipNav({ f, searching, setSearching, filterRef }:
  Pick<ShellNavProps, 'f' | 'filterRef'> & { searching: boolean; setSearching: (v: boolean) => void }) {
  const { query, setQuery, total } = f
  const active = useShellActiveSection()
  const chipsRef = useRef<HTMLDivElement>(null)
  const group = useId()
  const [sheet, setSheet] = useState(false)
  const q = query.trim(), filtering = searching || !!q || f.tags.length > 0
  useEffect(() => {
    // in the next frame, with the layout the browser makes for it anyway: measuring here, right after the first commit,
    // forced an extra layout of the whole page before the first paint (a third of a second on a phone)
    const raf = requestAnimationFrame(() => {
      const row = chipsRef.current, chip = row?.querySelector<HTMLElement>(`[data-chip="${active}"]`)
      if (!row || !chip || !row.offsetParent) return
      // centre the chip
      const left = chip.offsetLeft - row.clientWidth / 2 + chip.offsetWidth / 2
      row.scrollTo({ left, behavior: shellReduce() ? 'auto' : 'smooth' })
    })
    return () => cancelAnimationFrame(raf)
  }, [active, filtering])
  const done = () => { f.clear(); setSearching(false) }
  return (
    <nav aria-label={'Sections'} className="sticky top-[calc(env(safe-area-inset-top,0px)+57px)] z-30 -mx-4 -mt-4 min-w-0 bg-[var(--bg)] px-[max(16px,env(safe-area-inset-left))] py-2 sm:-mx-5 sm:px-5 min-[900px]:hidden">
      {filtering ? (
        <div role="search" className="flex flex-col gap-2">
          <div className="flex items-center gap-2">
            <div className="relative min-w-0 flex-1">
              <Icon name="search" size={14} className="pointer-events-none absolute top-1/2 start-2.5 -translate-y-1/2 text-[var(--fg3)]" />
              <input ref={filterRef} value={query} onChange={e => setQuery(e.target.value)} placeholder={'Name or use case'} aria-label={'Filter components by name or use case'} enterKeyHint="search"
                onKeyDown={e => { if (e.key === 'Escape') { done() } else if (e.key === 'Enter') e.currentTarget.blur() }}
                className="h-9 w-full rounded-[var(--r-md)] border border-[var(--line)] bg-[var(--card)] pe-12 ps-8 text-[13px] text-[var(--fg)] outline-none placeholder:text-[var(--fg3)] focus:border-[var(--fg3)] focus:shadow-[0_0_0_3px_var(--muted)]" />
              <span className="ui-num pointer-events-none absolute top-1/2 end-2.5 -translate-y-1/2 text-xs text-[var(--fg3)]" aria-live="polite">{q ? `${fmt.number(total)} found` : ''}</span>
            </div>
            <Button onClick={() => setSheet(true)} aria-label={'Filter by tag'} aria-haspopup="dialog" className="flex-none !px-2.5">
              <Icon name="sliders" size={15} /><span className="max-[420px]:sr-only">{'Tags'}</span>
              {f.tags.length > 0 && <Badge size="sm" tone="accent">{fmt.number(f.tags.length)}</Badge>}
            </Button>
            <Button variant="ghost" onClick={done} className="flex-none !px-2.5">{'Cancel'}</Button>
          </div>
          {f.tags.length > 0 && (
            <div className="flex min-w-0 items-center gap-2">
              <ShellActiveTags f={f} className="-ms-[max(16px,env(safe-area-inset-left))] min-w-0 flex-1 overflow-x-auto ps-[max(16px,env(safe-area-inset-left))] [scrollbar-width:none] sm:-ms-5 sm:ps-5" />
              {!q && <span className="ui-num flex-none text-xs text-[var(--fg3)]" aria-live="polite">{`${fmt.number(total)} found`}</span>}
            </div>
          )}
        </div>
      ) : (
        <div ref={chipsRef} className="-mx-[max(16px,env(safe-area-inset-left))] flex gap-1.5 overflow-x-auto px-[max(16px,env(safe-area-inset-left))] [scrollbar-width:none] sm:-mx-5 sm:px-5">
          <button type="button" onClick={() => { setSearching(true); requestAnimationFrame(() => filterRef.current?.focus()) }} aria-label={'Filter components'}
            className="inline-flex flex-none cursor-pointer items-center gap-1.5 rounded-[var(--r-md)] border border-[var(--line)] bg-[var(--card)] px-2.5 py-1.5 text-[13px] whitespace-nowrap text-[var(--fg2)]">
            <Icon name="search" size={14} />{'Filter'}
          </button>
          {SECTIONS.map(([id, label]) => <ShellSectionLink key={id} id={id} label={label} on={active === id} group={group} chip />)}
        </div>
      )}
      <Sheet open={sheet} onOpenChange={setSheet} title={'Filter by tag'} footer={
        <div className="flex w-full items-center gap-2">
          {(q || f.tags.length > 0) && <Button variant="ghost" onClick={f.clear}>{'Clear filters'}</Button>}
          <span className="flex-1" />
          <Button variant="primary" onClick={() => setSheet(false)}>{(total === 1 ? `Show ${total} component` : `Show ${total} components`)}</Button>
        </div>}>
        <ShellTagPanel f={f} touch />
      </Sheet>
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

/** Card demos mount as they near the viewport (kit.tsx); a Design QA audit scans every card, so it mounts them all first. */
function ShellQaMountAll() {
  const { runs } = useDesignQA()
  useEffect(() => { if (runs) mountAllSpecs() }, [runs])
  return null
}

function ShowcaseBody() {
  const { set, toggle, settings } = useTheme()
  const toast = useToast()
  const [palette, setPalette] = useState(false)
  const [appearance, setAppearance] = useState(false)
  const [keys, setKeys] = useState(false)
  const [query, setQuery] = useState('')
  const [tags, setTags] = useState<TagId[]>([])
  const [tagsOpen, setTagsOpen] = useState(false)
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
  const total = useMemo(() => ordered.filter(s => specMatches(s, query, tags)).length, [ordered, query, tags])
  const counts = useMemo(() => tagFacetCounts(ordered, query, tags), [ordered, query, tags])
  const filterNow = useRef({ query, tags }); filterNow.current = { query, tags } // eslint-disable-line react-hooks/refs

  // The filter lives in the URL (?tags=search,keyboard&q=date), so a filtered view can be shared. Read before the first
  // paint (the server render has no filter), written back with replaceState as it changes, re-read on back/forward.
  const urlPending = useRef<string | null>('') // the filter just read from the URL, until state has caught up with it
  const urlSynced = useRef('') // the search string the state matches
  useLayoutEffect(() => {
    const read = () => {
      if (urlPending.current === null && location.search === urlSynced.current) return // only the hash changed (a #card link)
      const u = tagParseUrl(location.search)
      urlPending.current = `${u.tags.join(',')}|${u.q}`; urlSynced.current = location.search
      setTags(u.tags); setQuery(u.q)
      if (u.tags.length || u.q) setMobileFilter(true)
    }
    read()
    addEventListener('popstate', read); return () => removeEventListener('popstate', read)
  }, [])
  useEffect(() => {
    if (urlPending.current !== null) {
      if (urlPending.current !== `${tags.join(',')}|${query}`) return // an older render: don't write over the URL we just read
      urlPending.current = null
      return
    }
    const search = tagSearchString(location.search, tags, query)
    urlSynced.current = search
    if (search !== location.search) history.replaceState(history.state, '', `${location.pathname}${search}${location.hash}`)
  }, [tags, query])
  const toggleTag = useCallback((id: TagId) => setTags(cur => tagToggle(cur, id)), [])
  const clearFilters = useCallback(() => { setQuery(''); setTags([]) }, [])
  const filter = useMemo<ShellFilter>(() => ({ query, tags, setQuery, toggleTag, clear: clearFilters, counts, total }), [query, tags, toggleTag, clearFilters, counts, total])
  /** A card's tag chip (or ⌘K "Tag: …"): show only that tag's cards, from the top of the page. */
  const pickTag = useCallback((id: TagId) => {
    setTags([id]); setQuery('')
    if (filterRef.current?.offsetParent) setTagsOpen(true); else setMobileFilter(true)
    scrollTo({ top: 0, behavior: shellReduce() ? 'auto' : 'smooth' })
  }, [])

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
    if (!specMatches(s, filterNow.current.query, filterNow.current.tags)) { clearFilters(); requestAnimationFrame(() => requestAnimationFrame(run)) } else run()
  }, [clearFilters])
  const focusFilter = useCallback(() => openFilter(!matchMedia('(pointer: coarse)').matches || !!filterRef.current?.offsetParent), [openFilter])
  const shell = useMemo(() => ({ query, tags, setQuery, focusFilter, pickTag }), [query, tags, focusFilter, pickTag])

  // Commands are rebuilt only when the cards or theme change; runners reach the latest theme API through a ref.
  const api = useRef({ set, toggle, toast }); api.current = { set, toggle, toast } // eslint-disable-line react-hooks/refs
  const commands = useMemo(() => {
    const sectionLabel = Object.fromEntries(SECTIONS) as Record<string, string>
    const list: Command[] = [
      ...SECTIONS.map(([id, label]) => ({ id: `go-${id}`, label: `Go to ${label}`, group: 'Navigate', icon: 'layers' as IconName, keywords: [id, ...shellTagWords(SECTION_AREA[id])], hint: 'Section', run: shellAfterPalette(() => shellJump(id)) })),
      ...ordered.map(s => ({ id: `spec-${s.id}`, label: s.title, group: 'Components', icon: 'layers' as IconName, keywords: [...s.tags.flatMap(shellTagWords), ...s.aka, ...s.items, sectionLabel[s.section]], hint: s.desc, run: shellAfterPalette(() => goSpec(s)) })),
      // one command per tag that has cards: "Tag: Streaming" filters the page by it
      ...shellTagsInUse(ordered).map(([id, n]) => ({ id: `tag-${id}`, label: `Tag: ${TAG_BY_ID[id].label}`, group: 'Tags', icon: 'sliders' as IconName, keywords: shellTagWords(id), hint: `${n} ${n === 1 ? 'card' : 'cards'} · ${TAG_BY_ID[id].desc}`, run: shellAfterPalette(() => pickTag(id)) })),
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
  }, [ordered, goSpec, settings.variant, openFilter, pickTag])
  const paletteEl = useMemo(() => <CommandPalette open={palette} onOpenChange={setPalette} commands={commands} placeholder={'Search components, use cases, actions, themes…'} suggestion="chart" />, [palette, commands])

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
          <span role="heading" aria-level={1} className="flex items-center gap-2 font-semibold tracking-tight whitespace-nowrap"><i className="inline-block h-[18px] w-[18px] rounded-[var(--r-sm)] bg-[var(--primary)]" />{'UI library'}</span>
          <span className="hidden text-xs text-[var(--fg3)] sm:inline">{'React · Motion · Tailwind'}</span>
          <span className="flex-1" />
          <Button onClick={() => setPalette(true)} className="max-[900px]:!w-9 max-[900px]:!px-0 min-[900px]:min-w-[220px] min-[900px]:!justify-between">
            {/* the visible words are the name (no aria-label to mismatch); below 900px only the icon shows, so the words stay for screen readers */}
            <span className="flex items-center gap-2 font-normal text-[var(--fg3)]"><Icon name="search" size={14} /><span className="max-[900px]:sr-only">{'Search components'}</span></span>
            <span aria-hidden className="max-[900px]:hidden"><Kbd>⌘K</Kbd></span>
          </Button>
          <DesignQAButton />
          <AppearanceMenu open={appearance} onOpenChange={setAppearance} />
          <ThemeToggle />
        </div>
      </header>
      <div className="mx-auto grid max-w-[1320px] gap-4 pt-4 pr-[max(16px,env(safe-area-inset-right))] pb-[max(80px,calc(env(safe-area-inset-bottom)+64px))] pl-[max(16px,env(safe-area-inset-left))] sm:px-5 min-[900px]:grid-cols-[212px_minmax(0,1fr)] min-[900px]:gap-8 min-[900px]:pt-6">
        <ShellSideNav ordered={ordered} f={filter} filterRef={filterRef} goSpec={goSpec} tagsOpen={tagsOpen} setTagsOpen={setTagsOpen} />
        <ShellChipNav f={filter} searching={mobileFilter} setSearching={setMobileFilter} filterRef={mobileFilterRef} />
        <main className="min-w-0">
          {sections}
          <AnimatePresence>
            {(q || tags.length > 0) && total === 0 && (
              <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.2 }} role="status"
                className="flex flex-col items-center gap-3 rounded-[var(--r-lg)] border border-dashed border-[var(--line2)] p-10 text-center text-[var(--fg2)]">
                <span>{q ? `No components match “${q}”.` : 'No components match these filters.'}</span>
                {tags.length > 0 && <span className="text-xs text-[var(--fg3)]">{tags.map(id => TAG_BY_ID[id].label).join(' · ')}</span>}
                <Button size="sm" onClick={() => { clearFilters(); openFilter(!matchMedia('(pointer: coarse)').matches) }}>{'Clear filters'}</Button>
              </motion.div>
            )}
          </AnimatePresence>
        </main>
      </div>
      {paletteEl}
      <ShellShortcuts open={keys} onOpenChange={setKeys} />
      <CodeDrawer />
      <DesignQA />
      <ShellQaMountAll />
    </ShellContext.Provider>
  )
}

/** Default export: the full catalogue. Import the named components to use them in your own app. */
/** The CSP nonce the page was served with, if any (Vite's `html.cspNonce` puts it on <meta property="csp-nonce">). */
const showcaseNonce = () => (typeof document === 'undefined' ? undefined : document.querySelector<HTMLMetaElement>('meta[property="csp-nonce"]')?.nonce || undefined)

export default function Showcase() {
  return <UIProvider fonts themeFromUrl nonce={showcaseNonce()}><ShowcaseBody /></UIProvider>
}
