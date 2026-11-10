import { flushSync } from 'react-dom'
import { Suspense, createContext, lazy, startTransition, useContext, useEffect, useId, useLayoutEffect, useRef, useState, useSyncExternalStore, type ComponentType, type CSSProperties, type ReactNode } from 'react'
import { Badge, Button, type ButtonProps, Card, Icon, Kbd, cn, defineMessages, logicalArrow, useDir, useMessages } from '../lib'
import { CARD_HEIGHTS } from './cardHeights'
import { openCodeDrawer } from './CodeDrawer'
import { TAG_BY_ID, TAG_CARDS, type TagCard, type TagId, tagCardTags, tagChipOrder, tagMatches } from './tags'

/* Showcase kit: Section, Spec (card), Row, the section list, and the card registry the page shell reads for the sidebar
 * filter, the component subnav and the ⌘K "Components" group. Card tags come from the vocabulary in tags.ts. */

/** The area tag of each section (the ⌘K "Go to" commands match its label and synonyms). */
export const SECTION_AREA: Record<string, TagId> = {
  buttons: 'actions', motion: 'motion', inputs: 'inputs', forms: 'forms', navigation: 'navigation', feedback: 'feedback', overlays: 'overlays', data: 'data',
  layout: 'layout', collab: 'collaboration', pages: 'pages', charts: 'charts', diagrams: 'diagrams', code: 'code', media: 'media', ai: 'ai',
}
const KIT_NO_CARD: TagCard = { kind: 'component', tags: [], items: [] }
/** A card's tags and registry items by its title (tests/unit/tags.test.ts makes sure every card has an entry). */
export const specCard = (title: string): TagCard => TAG_CARDS[title] ?? KIT_NO_CARD
export const specSlug = (t: string) => 'c-' + t.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')

/* Card registry ─────────────────────────────────────────────────────────────── */

/** A card on the page. `tags` are tag ids (kind first); `text` is what search reads besides the tags. */
export type SpecEntry = { key: string; id: string; title: string; desc: string; section: string; tags: TagId[]; aka: readonly string[]; items: readonly string[]; text: string }
const kitSpecs = new Map<string, SpecEntry>()
const kitListeners = new Set<() => void>()
let kitSnapshot: SpecEntry[] = []
let kitPending = false
const kitNotify = () => {
  if (kitPending) return
  kitPending = true
  queueMicrotask(() => { kitPending = false; kitSnapshot = [...kitSpecs.values()]; kitListeners.forEach(l => l()) })
}
function kitRegister(e: SpecEntry): string {
  const taken = [...kitSpecs.values()].some(x => x.key !== e.key && x.id === e.id)
  const entry = taken ? { ...e, id: `${e.id}-${e.section}` } : e
  kitSpecs.set(e.key, entry); kitNotify()
  return entry.id
}
const kitSubscribe = (l: () => void) => { kitListeners.add(l); return () => { kitListeners.delete(l) } }
/** Every card on the page (title, id, section, tags), in mount order. Re-renders when cards mount or unmount. */
const kitServerSnapshot: SpecEntry[] = []
export const useSpecs = () => useSyncExternalStore(kitSubscribe, () => kitSnapshot, () => kitServerSnapshot)

/** What search reads for a card besides its tags: title, description, section and registry item names. */
export const specText = (title: string, desc: string, section: string, items: readonly string[]) => `${title} ${desc} ${section} ${items.join(' ')}`
/** Does a card match the filter? Every typed word must start a word of its title, description, registry items, tags or
 * their synonyms, and it must carry the selected tags (OR within a facet, AND across facets). */
export const specMatches = (e: Pick<SpecEntry, 'text' | 'tags' | 'aka'>, query: string, tags: readonly TagId[] = []) => tagMatches(e, query, tags)

/* Page shell context: the sidebar filter (query and tags), shared with every card. */
type KitShell = {
  query: string; tags: readonly TagId[]; setQuery: (q: string) => void; focusFilter: () => void
  /** a card's tag chip was picked: filter by that tag alone. Without it the chip is a plain link. */
  pickTag?: (id: TagId) => void
  /** where a tag chip links (default `?tags=<id>`, this page filtered) */
  tagHref?: (id: TagId) => string
}
/** The showcase chrome's own strings (cards, sidebar, header). Demo content stays English. de/ar machine-drafted. */
export const SHOWCASE_MSG = defineMessages('showcase', {
  en: {
    goodAt: 'Good at', breaksWhen: 'Breaks when', openState: 'Open state', viewCode: 'View code', viewCodeFor: 'View code for {title}', keyboard: 'Keyboard', tagsFor: 'Tags for {title}',
    showTagged: 'Show components tagged {tag}', skipNext: 'Skip to next card', sections: 'Sections', filterPlaceholder: 'Search by name or use case',
    filterShort: 'Name or use case', filterLabel: 'Filter components by name or use case', filterComponents: 'Filter components', filter: 'Filter',
    matches: 'Matches', noMatches: 'No matches', found: '{count} found', searchComponents: 'Search components',
    paletteSearch: 'Search components, use cases, actions, themes…', shortcuts: 'Keyboard shortcuts',
    shortcutsHint: 'With a hardware keyboard. Single keys work anywhere except while typing.', noneMatch: 'No components match “{query}”.',
    clearFilter: 'Clear filter', auto: 'Auto ({dir})', tagline: 'React · Motion · Tailwind', libraryName: 'UI library',
    tags: 'Tags', filterByTag: 'Filter by tag', clearFilters: 'Clear filters', removeTag: 'Remove filter: {tag}', activeFilters: 'Active filters',
    facetKind: 'Kind', facetArea: 'Area', facetUse: 'Use case', facetCapability: 'Capability', facetStatus: 'Status',
    noneMatchTags: 'No components match these filters.', showResults: '{count, plural, one {Show # component} other {Show # components}}',
    tagFilterHint: 'Within a group any tag matches; across groups all must.',
  },
  de: {
    goodAt: 'Gut für', breaksWhen: 'Stößt an Grenzen, wenn', openState: 'Geöffneter Zustand', viewCode: 'Code anzeigen', viewCodeFor: 'Code für {title} anzeigen', keyboard: 'Tastatur', tagsFor: 'Tags für {title}',
    showTagged: 'Komponenten mit {tag} anzeigen', skipNext: 'Zur nächsten Karte springen', sections: 'Abschnitte', filterPlaceholder: 'Nach Name oder Anwendungsfall suchen',
    filterShort: 'Name oder Anwendungsfall', filterLabel: 'Komponenten nach Name oder Anwendungsfall filtern', filterComponents: 'Komponenten filtern', filter: 'Filtern',
    matches: 'Treffer', noMatches: 'Keine Treffer', found: '{count} gefunden', searchComponents: 'Komponenten suchen',
    paletteSearch: 'Komponenten, Anwendungsfälle, Aktionen, Designs suchen…', shortcuts: 'Tastenkürzel',
    shortcutsHint: 'Mit einer Hardware-Tastatur. Einzelne Tasten funktionieren überall außer beim Tippen.', noneMatch: 'Keine Komponente passt zu „{query}“.',
    clearFilter: 'Filter entfernen', auto: 'Automatisch ({dir})', tagline: 'React · Motion · Tailwind', libraryName: 'UI-Bibliothek',
    tags: 'Tags', filterByTag: 'Nach Tag filtern', clearFilters: 'Filter zurücksetzen', removeTag: 'Filter entfernen: {tag}', activeFilters: 'Aktive Filter',
    facetKind: 'Art', facetArea: 'Bereich', facetUse: 'Anwendungsfall', facetCapability: 'Fähigkeit', facetStatus: 'Status',
    noneMatchTags: 'Keine Komponente passt zu diesen Filtern.', showResults: '{count, plural, one {# Komponente anzeigen} other {# Komponenten anzeigen}}',
    tagFilterHint: 'Innerhalb einer Gruppe genügt ein Tag; gruppenübergreifend müssen alle passen.',
  },
  ar: {
    goodAt: 'مناسب لـ', breaksWhen: 'يتعثر عندما', openState: 'الحالة المفتوحة', viewCode: 'عرض الشيفرة', viewCodeFor: 'عرض شيفرة {title}', keyboard: 'لوحة المفاتيح', tagsFor: 'وسوم {title}',
    showTagged: 'عرض المكونات الموسومة بـ {tag}', skipNext: 'انتقل إلى البطاقة التالية', sections: 'الأقسام', filterPlaceholder: 'ابحث بالاسم أو حالة الاستخدام',
    filterShort: 'الاسم أو حالة الاستخدام', filterLabel: 'تصفية المكونات بالاسم أو حالة الاستخدام', filterComponents: 'تصفية المكونات', filter: 'تصفية',
    matches: 'النتائج المطابقة', noMatches: 'لا توجد نتائج مطابقة', found: 'عُثر على {count}', searchComponents: 'البحث في المكونات',
    paletteSearch: 'ابحث في المكونات وحالات الاستخدام والإجراءات والسمات…', shortcuts: 'اختصارات لوحة المفاتيح',
    shortcutsHint: 'مع لوحة مفاتيح فعلية. تعمل المفاتيح المفردة في أي مكان إلا أثناء الكتابة.', noneMatch: 'لا توجد مكونات تطابق «{query}».',
    clearFilter: 'مسح التصفية', auto: 'تلقائي ({dir})', tagline: 'React · Motion · Tailwind', libraryName: 'مكتبة واجهات',
    tags: 'الوسوم', filterByTag: 'التصفية حسب الوسم', clearFilters: 'مسح عوامل التصفية', removeTag: 'إزالة عامل التصفية: {tag}', activeFilters: 'عوامل التصفية النشطة',
    facetKind: 'النوع', facetArea: 'المجال', facetUse: 'حالة الاستخدام', facetCapability: 'القدرة', facetStatus: 'الحالة',
    noneMatchTags: 'لا توجد مكونات تطابق عوامل التصفية هذه.', showResults: '{count, plural, one {عرض مكوّن واحد} other {عرض # مكونات}}',
    tagFilterHint: 'داخل المجموعة يكفي أي وسم؛ وبين المجموعات يجب أن تتحقق كلها.',
  },
})

export const ShellContext = createContext<KitShell>({ query: '', tags: [], setQuery: () => {}, focusFilter: () => {} })
const SectionContext = createContext('')

/** Scroll to a card and flash its outline so the eye finds it. */
export function flashSpec(id: string) {
  const el = document.getElementById(id)
  if (!el) return
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches
  const flash = () => {
    el.dataset.flash = ''
    clearTimeout(Number(el.dataset.flashT))
    el.dataset.flashT = String(setTimeout(() => { delete el.dataset.flash }, 1400))
  }
  const r = el.getBoundingClientRect()
  el.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'center' })
  if (reduce || (r.top > 60 && r.bottom < innerHeight)) return flash()
  // flash once the smooth scroll lands (long jumps can take a few seconds)
  let done = false
  const go = () => { if (done) return; done = true; removeEventListener('scrollend', go); flash() }
  addEventListener('scrollend', go, { once: true })
  setTimeout(go, 'onscrollend' in window ? 5000 : 900)
}

/* Lazy card bodies ──────────────────────────────────────────────────────────────
 * Mounting all ~180 demos at once cost a phone (4× CPU) an 8 s long task, and every animation frame then paid for
 * painting, layerizing and intersection-checking ~17k elements. So a card's header renders at once (the filter, the
 * sidebar and ⌘K need it) but its demo mounts only as the card comes within about a screen of the viewport, and
 * stays mounted after. Cards in view mount right away; the ones ahead mount one at a time in transitions (React
 * yields between them), so scrolling stays responsive. A card stays transparent until its demo is in, so a demo that
 * mounts on screen (after a jump) fades in instead of shifting the layout; demos above the viewport mount only as they
 * scroll back in. Cards far from the viewport (more than
 * ~2.5 screens) also skip rendering with `content-visibility: auto`; near ones don't, so popovers inside a card are
 * never clipped by the containment. */

/** What a card still waits for: its demo to mount, and/or being seen (15% on screen) to fade in. */
type KitCard = { mount?: (urgent: boolean) => void; seen?: () => void }
const kitCards = new Map<Element, KitCard>()
/** Unmounted cards within the mount margin, with their distance from the viewport when they entered it. */
const kitNear = new Map<Element, number>()
let kitNearIO: IntersectionObserver | null = null, kitViewIO: IntersectionObserver | null = null, kitFarIO: IntersectionObserver | null = null
let kitPumpT = 0, kitDeepLinked = false
/** On screen (and not hidden by the filter)? Reads layout: only for deep links. */
const kitOnScreen = (el: Element) => { const r = el.getBoundingClientRect(); return r.height > 0 && r.bottom > 0 && r.top < innerHeight }
const kitDone = (el: Element, c: KitCard) => { if (!c.mount && !c.seen) { kitCards.delete(el); kitViewIO?.unobserve(el) } }
function kitMountNow(el: Element, urgent: boolean) {
  const c = kitCards.get(el), mount = c?.mount
  if (!c || !mount) return
  c.mount = undefined; kitNear.delete(el); kitNearIO?.unobserve(el); kitDone(el, c)
  mount(urgent)
}
/** Mount the waiting card nearest the viewport (ties: the one that came near first), then the next 50 ms later.
 * Reads no layout: distances come from the observer. Cards that scroll on screen mount at once (kitViewIO). */
function kitPump() {
  kitPumpT = 0
  let next: Element | null = null, best = Infinity
  for (const [el, d] of kitNear) if (d < best) { best = d; next = el }
  if (next) kitMountNow(next, false)
  if (kitNear.size) kitPumpT = window.setTimeout(kitPump, 50)
}
/** Cards registered in this commit, looked at once it's done: a deep-linked card mounts synchronously, before the first
 * paint, so the page can scroll to where it really ends up. The ones on screen mount from the observer's first report,
 * right after the first paint: they are transparent until their demo is in anyway, their placeholders already have the
 * demo's height (cardHeights.ts), and finding them here forced a layout of the whole page and mounted their demos
 * before anything was painted (about half a second of a phone's first paint at 4× CPU). */
const kitFresh = new Set<Element>()
const kitIsHashTarget = (el: Element) => !!location.hash && decodeURIComponent(location.hash.slice(1)) === el.id
function kitFirstLook() {
  const now = [...kitFresh].filter(el => kitCards.get(el)?.mount && kitIsHashTarget(el))
  kitFresh.clear()
  if (now.length) flushSync(() => now.forEach(el => kitMountNow(el, true)))
}
function kitObservers() {
  if (kitNearIO || typeof IntersectionObserver === 'undefined') return
  // a screen and a half below: at a reading pace a demo has mounted well before it scrolls in. Nothing above: after a
  // jump, demos above the viewport stay unmounted until they scroll in at the top edge (still transparent, and the
  // content below is held by scroll anchoring); mounting them while out of sight changed the page above the reader,
  // which Chrome can still count as layout shift
  kitNearIO = new IntersectionObserver(es => {
    for (const e of es) {
      if (!e.isIntersecting || !kitCards.get(e.target)?.mount) { kitNear.delete(e.target); continue }
      const top = e.boundingClientRect.top, vh = e.rootBounds ? e.rootBounds.height / 2.5 : innerHeight // root = viewport + 1.5 screens below
      kitNear.set(e.target, Math.max(0, top - vh))
    }
    if (kitNear.size && !kitPumpT) kitPumpT = window.setTimeout(kitPump, 0)
  }, { rootMargin: '0px 0px 150% 0px' })
  // on screen: mount now; 15% on screen: fade in (one observer for every card instead of one each)
  kitViewIO = new IntersectionObserver(es => {
    for (const e of es) {
      const c = kitCards.get(e.target)
      if (!c || !e.isIntersecting) continue
      if (c.mount) kitMountNow(e.target, true)
      if (c.seen && e.intersectionRatio >= 0.149) { const seen = c.seen; c.seen = undefined; seen() }
      kitDone(e.target, c)
    }
  }, { threshold: [0, 0.15] })
  // far away: skip style, layout and paint (an attribute, not React state, so nothing re-renders)
  kitFarIO = new IntersectionObserver(es => {
    for (const e of es) e.target.toggleAttribute('data-far', !e.isIntersecting)
  }, { rootMargin: '250% 0px' })
}
/** Mount every card's demo now (the Design QA audit scans them all). */
export function mountAllSpecs() {
  for (const el of [...kitCards.keys()]) kitMountNow(el, true)
}
/** Render card demos right away instead of as they near the viewport (server renders that should include them, tests). */
export const SpecEagerContext = createContext(false)

/**
 * A library component whose module loads when a card first renders it, so the module stays out of the page's first
 * script (less to parse and run before the first paint on a phone): `const BinaryView = specLazy(() =>
 * import('../lib/binary').then(m => m.BinaryView))`. While it loads, the card keeps its placeholder (Spec's Suspense
 * boundary). In the view-code drawer it reads as `import { BinaryView } from './ui'` (scripts/showcase-code.ts).
 */
export function specLazy<P extends object>(load: () => Promise<ComponentType<P>>): ComponentType<P> {
  return lazy(() => load().then(c => ({ default: c })))
}

/* Layout pieces ─────────────────────────────────────────────────────────────── */

/** Everything Tab reaches inside an element: visible, enabled, not inert. */
const KIT_TABBABLE = 'a[href],button,input,select,textarea,[tabindex],[contenteditable=""],[contenteditable="true"],summary'
const kitTabbables = (root: Element | null) => root ? [...root.querySelectorAll<HTMLElement>(KIT_TABBABLE)]
  .filter(e => e.tabIndex >= 0 && !(e as HTMLButtonElement).disabled && !e.closest('[inert]') && e.getClientRects().length > 0) : []
/** Demos with at least this many Tab stops offer a "Skip to next card" link after the card's header. */
const KIT_SKIP_AT = 6
const kitReduce = () => matchMedia('(prefers-reduced-motion: reduce)').matches
/** The visible card after this one (cards hidden by the filter are skipped). */
const kitNextCard = (card: Element | null) => {
  const cards = [...document.querySelectorAll<HTMLElement>('main [data-spec]')].filter(c => c.offsetParent)
  const i = card ? cards.indexOf(card as HTMLElement) : -1
  return i >= 0 ? cards[i + 1] ?? null : null
}
/** Move focus to a card's first control (its code button) and scroll it into view. */
function kitFocusCard(card: HTMLElement) {
  card.querySelector<HTMLElement>('[data-kit-entry]')?.focus({ preventScroll: true })
  card.scrollIntoView({ block: 'start', behavior: kitReduce() ? 'auto' : 'smooth' })
}

/** A key hint for a card: keys pressed together, and what they do. */
export type SpecKey = [keys: string[], label: string]

/** A one-shot action in a card's header (Resample, Randomise, Replay…): the same size and place on every card. */
export function SpecAction({ className, ...p }: Omit<ButtonProps, 'size'>) {
  return <Button size="xs" className={cn('flex-none', className)} {...p} />
}

/** A static picture of a demo's open or finished state (a menu, a dialog, a toast), so the card shows what its trigger
 * does. Not interactive and hidden from assistive tech: the live control above it is the real thing. */
export function SpecPreview({ children, className, label }: { children: ReactNode; className?: string; label?: string }) {
  const t = useMessages(SHOWCASE_MSG)
  return (
    <div aria-hidden inert className={cn('relative mt-auto overflow-hidden rounded-[var(--r-md)] border border-dashed border-[var(--line)] bg-[var(--bg)] px-3 pt-6 pb-3 select-none', className)}>
      <span className="absolute top-1.5 start-2.5 text-[11px] font-medium text-[var(--fg3)]">{label ?? t('openState')}</span>
      {children}
    </div>
  )
}

/**
 * A component card: title, one-line description, key hints, use-case tag chips, then the demo. The demo mounts as the
 * card nears the viewport (see "Lazy card bodies" above; `SpecEagerContext` renders it at once) and the card fades in
 * when scrolled into view. `actions` go in the header's top-right slot (one-shot demo actions, or a Switch for a live mode).
 * Keyboard: the code button is one Tab stop and the tag chips another (arrows move between chips). Demos with many
 * controls get a "Skip to next card" link right after the header, so Tab doesn't have to walk the whole demo.
 */
/** What a pattern is good at and where it breaks down, shown under the demo (helps pick between similar components). */
export type SpecNotes = { good: ReactNode; breaks: ReactNode }

export function Spec({ title, desc, children, span = 1, actions, keys, notes }:
  { title: string; desc?: string; children: ReactNode; span?: 1 | 2 | 3; actions?: ReactNode; keys?: SpecKey[]; notes?: SpecNotes }) {
  const key = useId()
  const section = useContext(SectionContext)
  const { query, tags: picked, pickTag, tagHref } = useContext(ShellContext)
  const base = specSlug(title)
  const [id, setId] = useState(base)
  const [tagAt, setTagAt] = useState(0)
  const [skip, setSkip] = useState(false)
  const cardRef = useRef<HTMLDivElement>(null), bodyRef = useRef<HTMLDivElement>(null), tagRefs = useRef<(HTMLAnchorElement | null)[]>([])
  const card = specCard(title)
  const tags = tagCardTags(card)
  const text = specText(title, desc ?? '', section, card.items)
  useLayoutEffect(() => {
    setId(kitRegister({ key, id: base, title, desc: desc ?? '', section, tags: tagCardTags(card), aka: card.aka ?? [], items: card.items, text }))
  }, [key, base, title, desc, section, card, text])
  useLayoutEffect(() => () => { kitSpecs.delete(key); kitNotify() }, [key])
  // lazy demo: placeholders on the server and in the first client render; the deep-link target mounts before the first
  // paint, one on screen right after it, the rest as they near the viewport
  const eager = useContext(SpecEagerContext)
  const [live, setLive] = useState(eager)
  // the card stays transparent until its demo is in, then fades in once it's 15% on screen
  const [seen, setSeen] = useState(false)
  useLayoutEffect(() => {
    const el = cardRef.current
    kitObservers()
    if (!el || !kitViewIO) { setLive(true); setSeen(true); return } // no IntersectionObserver: everything at once
    const c: KitCard = { seen: () => setSeen(true) }
    if (!live) c.mount = urgent => urgent ? setLive(true) : startTransition(() => setLive(true))
    kitCards.set(el, c)
    kitViewIO.observe(el)
    if (c.mount) { kitNearIO?.observe(el); if (!kitFresh.size) queueMicrotask(kitFirstLook); kitFresh.add(el) }
    kitFarIO?.observe(el) // far-away cards skip rendering
    return () => {
      kitCards.delete(el); kitNear.delete(el); kitFresh.delete(el)
      kitViewIO?.unobserve(el); kitNearIO?.unobserve(el); kitFarIO?.unobserve(el); el.removeAttribute('data-far')
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps
  // fade in only once the new demo has settled (no resize for 120 ms, at most 0.8 s): a demo that lays itself out over a
  // few frames after mounting (effects, measured widths) does so while the card is still fully transparent, which
  // doesn't count as layout shift. Cards mounted ahead of the viewport have settled long before they're seen.
  const [settled, setSettled] = useState(eager)
  useEffect(() => {
    const body = bodyRef.current
    if (!live || settled || !body) return
    let quiet = 0
    const done = () => setSettled(true), arm = () => { clearTimeout(quiet); quiet = window.setTimeout(done, 120) }
    const ro = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(arm)
    ro?.observe(body); arm()
    const cap = window.setTimeout(done, 800)
    return () => { clearTimeout(quiet); clearTimeout(cap); ro?.disconnect() }
  }, [live, settled])
  useEffect(() => { // a deep link to this card: make sure it's on screen once its demo is in
    const el = cardRef.current
    if (!live || !el || kitDeepLinked || !kitIsHashTarget(el)) return
    kitDeepLinked = true
    requestAnimationFrame(() => { if (!kitOnScreen(el)) el.scrollIntoView({ block: 'start' }) })
  }, [live, id])
  const shown = specMatches({ text, tags, aka: card.aka ?? [] }, query, picked)
  const measured = CARD_HEIGHTS[base]
  const placeholder = measured && ({ '--kit-ph': `${measured[0]}px`, '--kit-ph-md': `${measured[1]}px` } as CSSProperties)
  const hold = <div aria-hidden data-spec-hold style={placeholder} className={cn('[overflow-anchor:none]', placeholder ? 'h-[var(--kit-ph)] md:h-[var(--kit-ph-md)]' : span === 3 ? 'h-[520px] md:h-[400px]' : span === 2 ? 'h-[320px] md:h-[300px]' : 'h-[220px] md:h-[260px]')} />
  const chips = tagChipOrder(card.tags).slice(0, 4)
  const onChip = (e: React.MouseEvent, id: TagId) => {
    if (!pickTag || e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return // a new tab gets the link
    e.preventDefault(); pickTag(id)
  }
  const dir = useDir(), t = useMessages(SHOWCASE_MSG)
  const tagKeys = (e: React.KeyboardEvent, i: number) => {
    const k = logicalArrow(e.key, dir) // ← is next in RTL
    // rtl-lint-ignore: `k` is logicalArrow-mapped
    const n = chips.length, d = k === 'ArrowRight' || k === 'ArrowDown' ? 1 : k === 'ArrowLeft' || k === 'ArrowUp' ? -1 : 0
    const j = d ? (i + d + n) % n : e.key === 'Home' ? 0 : e.key === 'End' ? n - 1 : -1
    if (j < 0) return
    e.preventDefault(); setTagAt(j); tagRefs.current[j]?.focus()
  }
  // decide, as focus enters the header, whether this demo is long enough to be worth skipping
  const onFocus = (e: React.FocusEvent) => {
    if (bodyRef.current?.contains(e.target)) return
    setSkip(kitTabbables(bodyRef.current).length >= KIT_SKIP_AT && !!kitNextCard(cardRef.current))
  }
  return (
    <div id={id} data-spec={title} ref={cardRef} onFocus={onFocus}
      // a CSS fade, opacity only: a plain element instead of a motion component per card (174 of them were a large share of
      // the first render on a phone), and no slide-up, because a change to the transform (or translate) of the scroll
      // anchor or any ancestor suppresses scroll anchoring for that frame; in a fast scroll on a phone some card on screen
      // is nearly always mid-fade, so demos growing above the viewport pushed the page down (whole-page CLS 0.4)
      className={cn('group/spec min-w-0 scroll-mt-28 rounded-[var(--r-lg)] transition-[opacity,box-shadow] duration-500 ease-[cubic-bezier(.22,1,.36,1)] motion-reduce:duration-200 [contain-intrinsic-size:auto_400px] data-[far]:[content-visibility:auto] data-[flash]:shadow-[0_0_0_2px_var(--accent),0_0_0_6px_var(--accent-soft)]',
        settled && seen ? 'opacity-100' : 'opacity-0', span === 2 && 'md:col-span-2', span === 3 && 'col-span-full', !shown && 'hidden')}>
      <Card className="relative flex h-full flex-col">
        <div className="flex min-w-0 items-start gap-1.5">
          <h3 className="m-0 min-w-0 flex-1 text-sm leading-snug font-semibold">{title}</h3>
          {actions && <div className="-my-0.5 flex flex-none flex-wrap items-center justify-end gap-1.5 [@media(pointer:coarse)]:-my-[7px]">{actions}</div>}
          <button type="button" data-qa-skip data-kit-entry onClick={() => openCodeDrawer(title)} aria-label={t('viewCodeFor', { title })} title={t('viewCode')}
            className="-my-0.5 grid h-[22px] w-[22px] flex-none cursor-pointer place-items-center rounded-[var(--r-md)] border-0 bg-transparent text-[var(--fg3)] transition-colors duration-150 hover:bg-[var(--muted)] hover:text-[var(--fg)] focus-visible:outline-2 focus-visible:outline-[var(--accent)] [@media(pointer:coarse)]:-my-[7px] [@media(pointer:coarse)]:-me-[5px] [@media(pointer:coarse)]:-ms-[5px] [@media(pointer:coarse)]:h-8 [@media(pointer:coarse)]:w-8">
            <Icon name="code" size={15} />
          </button>
        </div>
        {desc && <p className="m-0 mt-1 text-xs leading-snug text-[var(--fg3)]">{desc}</p>}
        {keys && keys.length > 0 && (
          <ul aria-label={t('keyboard')} className="m-0 mt-2 flex list-none flex-wrap gap-x-3 gap-y-1.5 p-0 text-[11px] leading-none text-[var(--fg3)]">
            {keys.map(([ks, label], i) => <li key={i} className="inline-flex items-center gap-1">{ks.map((k, j) => <Kbd key={j} className="inline-grid h-[18px] min-w-[18px] place-items-center leading-none">{k}</Kbd>)}<span className="ms-0.5">{label}</span></li>)}
          </ul>
        )}
        {chips.length > 0 && (
          <div role="toolbar" aria-label={t('tagsFor', { title })} className="mt-2 mb-4 flex flex-wrap gap-1">
            {/* one Tab stop for the row (arrows move inside it); on touch each chip is 32px tall (transparent padding, pulled back with negative margins) around the same 21px pill */}
            {chips.map((tag, i) => {
              const label = TAG_BY_ID[tag].label
              return (
                <a key={tag} ref={el => { tagRefs.current[i] = el }} href={tagHref ? tagHref(tag) : `?tags=${tag}`} tabIndex={i === Math.min(tagAt, chips.length - 1) ? 0 : -1}
                  onClick={e => onChip(e, tag)} onKeyDown={e => tagKeys(e, i)} onFocus={() => setTagAt(i)} aria-label={t('showTagged', { tag: label })} title={TAG_BY_ID[tag].desc}
                  className="group/tag inline-flex cursor-pointer rounded-full p-0 no-underline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--accent)] [@media(pointer:coarse)]:-my-[5.5px] [@media(pointer:coarse)]:py-[5.5px]">
                  <Badge size="sm" className="group-hover/tag:!bg-[var(--accent-soft)] group-hover/tag:!text-[var(--accent)]">{label}</Badge>
                </a>
              )
            })}
          </div>
        )}
        {!chips.length && <div className="mb-4" />}
        <a href="#" tabIndex={skip ? 0 : -1} aria-hidden={!skip || undefined} data-qa-skip
          onClick={e => { e.preventDefault(); const n = kitNextCard(cardRef.current); if (n) kitFocusCard(n) }}
          className="pointer-events-none absolute end-3 bottom-3 z-10 rounded-[var(--r-md)] border border-[var(--line)] bg-[var(--card)] px-2.5 py-1.5 text-xs font-medium text-[var(--fg)] no-underline opacity-0 shadow-[var(--shadow)] focus-visible:pointer-events-auto focus-visible:opacity-100 focus-visible:outline-2 focus-visible:outline-[var(--accent)]">
          {t('skipNext')} ↓
        </a>
        <div ref={bodyRef} data-spec-body className="flex flex-1 flex-col gap-3">
          {/* reserves the demo's height until it mounts: measured per card on a phone and a desktop (cardHeights.ts, from
              scripts/card-heights.mjs), else a typical height for the span. A card that mounts late (a fast scroll on a
              slow phone) then doesn't move what's below it. The placeholder is never the scroll anchor (it's replaced on
              mount, which would leave the browser nothing to keep in place), but the card around it still is: with the
              whole card excluded, a screen of unmounted cards left no anchor at all, and a demo growing above the
              viewport pushed the page down */}
          {live ? <Suspense fallback={hold}>{children}</Suspense> : hold}
        </div>
        {notes && (
          <dl className="m-0 mt-4 grid gap-x-6 gap-y-3 border-t border-[var(--line)] pt-3 text-xs leading-relaxed sm:grid-cols-2">
            <div><dt className="mb-0.5 text-[11px] font-semibold tracking-[.06em] text-[var(--fg3)] uppercase">{t('goodAt')}</dt><dd className="m-0 text-[var(--fg2)]">{notes.good}</dd></div>
            <div><dt className="mb-0.5 text-[11px] font-semibold tracking-[.06em] text-[var(--fg3)] uppercase">{t('breaksWhen')}</dt><dd className="m-0 text-[var(--fg2)]">{notes.breaks}</dd></div>
          </dl>
        )}
      </Card>
    </div>
  )
}

/** A page section: heading, intro line and a responsive card grid. Hides itself when the filter matches none of its cards. */
export function Section({ id, title, desc, children }: { id: string; title: string; desc: string; children: ReactNode }) {
  const { query, tags } = useContext(ShellContext)
  const specs = useSpecs()
  const mine = specs.filter(s => s.section === id)
  const empty = (!!query.trim() || tags.length > 0) && mine.length > 0 && !mine.some(s => specMatches(s, query, tags))
  return (
    <SectionContext.Provider value={id}>
      <section id={id} className={cn('mb-12 scroll-mt-28 md:mb-16 min-[900px]:scroll-mt-20', empty && 'hidden')}>
        <div className="mb-4"><h2 className="m-0 mb-1 text-[22px] leading-tight font-semibold tracking-tight min-[900px]:text-[28px]">{title}</h2><p className="m-0 text-[var(--fg2)]">{desc}</p></div>
        <div className="grid gap-4 [grid-template-columns:repeat(auto-fill,minmax(min(100%,300px),1fr))]">{children}</div>
      </section>
    </SectionContext.Provider>
  )
}
export const Row = ({ children, className }: { children: ReactNode; className?: string }) => <div className={cn('flex flex-wrap items-center gap-2', className)}>{children}</div>

export const SECTIONS = [
  ['buttons', 'Buttons'], ['motion', 'Motion'], ['inputs', 'Inputs'], ['forms', 'Forms'], ['navigation', 'Navigation'], ['feedback', 'Feedback'],
  ['overlays', 'Overlays'], ['data', 'Data display'], ['layout', 'Layout'], ['collab', 'Collaboration'], ['pages', 'Pages'],
  ['charts', 'Charts'], ['diagrams', 'Diagrams & maps'], ['code', 'Code'], ['media', 'Media'], ['ai', 'AI'],
] as const

export const SAMPLE_CODE = `import { Button, useToast } from './ui'

export function SaveBar() {
  const toast = useToast()
  // one primary action per view
  return <Button variant="primary" onClick={() => toast({ title: 'Saved' })}>Save</Button>
}`
