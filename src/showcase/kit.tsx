import { createContext, useContext, useId, useLayoutEffect, useState, useSyncExternalStore, type ReactNode } from 'react'
import { Card, Icon, Reveal, cn } from '../lib'
import { openCodeDrawer } from './CodeDrawer'

/* Showcase kit: Section, Spec (card), Row, the section list, use-case tags, and the card registry the
 * page shell reads for the sidebar filter, the component subnav and the ⌘K "Components" group. */

/** Use-case tags per card title, copied from the original page. The filter and ⌘K match on them. */
export const SPEC_TAGS: Record<string, string> = {
  'Variants': 'buttons, actions, call to action', 'Loading to success': 'buttons, loading, feedback, async', 'Like with burst': 'buttons, reactions, social, delight', 'Motion playground': 'animation, spring, developer, design tokens',
  'Switch': 'user input, settings, toggle', 'Checkbox and radio': 'user input, forms, selection', 'Text field with validation': 'user input, forms, validation, errors', 'One-time code': 'user input, auth, login, security, OTP',
  'Segmented control': 'user input, selection, view switcher, filters', 'Number stepper': 'user input, quantity, commerce', 'Slider': 'user input, range, settings, volume', 'Rating': 'user input, feedback, reviews',
  'Tag input': 'user input, labels, keywords', 'Date picker dropdown': 'user input, date, forms, scheduling', 'Date range picker': 'user input, date range, filters, reports', 'Time picker': 'user input, time, booking, scheduling',
  'Combobox': 'user input, search, autocomplete, selection', 'Multi-select': 'user input, selection, labels, filters', 'Select': 'user input, dropdown, selection, forms', 'Textarea': 'user input, long text, forms, bio',
  'Password': 'user input, auth, security, signup', 'Colour picker': 'user input, design, theming', 'File upload': 'user input, upload, files, drag and drop', 'Range slider': 'user input, range, price filter, filters',
  'Phone number': 'user input, forms, contact, international', 'Currency input': 'user input, money, payments, finance', 'Rich text editor': 'user input, writing, documents, editor, formatting',
  'Mentions and commands': 'user input, chat, mentions, slash commands, collaboration', 'Form with unsaved changes': 'forms, settings, save, validation', 'Signature pad': 'user input, contracts, sign, legal',
  'Address autocomplete': 'user input, forms, address, checkout, autocomplete', 'Emoji picker': 'user input, reactions, chat, social',
  'Tabs': 'navigation, sections, view switcher', 'Wizard stepper': 'navigation, multi-step, onboarding, process, forms', 'Breadcrumbs and pagination': 'navigation, paging, hierarchy',
  'Collapsible sidebar': 'navigation, app shell, layout', 'Mobile tab bar': 'navigation, mobile, app shell', 'Mega menu': 'navigation, marketing site, header', 'Context menu': 'actions, right click, menu, files',
  'Toasts': 'feedback, notification, undo, status', 'Alerts': 'feedback, status, errors, warnings', 'Progress': 'feedback, loading, status, upload', 'Skeleton loading': 'loading, placeholder, feedback',
  'Empty state': 'onboarding, empty, first run, feedback', 'Badges and status': 'status, labels, feedback', 'Celebration': 'delight, success, confetti, milestone', 'Cookie consent': 'privacy, legal, banner, consent',
  'Offline indicator': 'status, connectivity, errors, feedback', 'Upgrade prompt': 'monetisation, paywall, limits, plans',
  'Dropdown menu': 'overlay, actions, menu', 'Modal': 'overlay, dialog, confirm, destructive', 'Sheet / drawer': 'overlay, filters, side panel, mobile', 'Tooltip': 'overlay, help, hints',
  'Command palette': 'search, keyboard, navigation, power users', 'Popover': 'overlay, share, details', 'Hover card': 'overlay, preview, profile', 'Hold to confirm': 'destructive, confirm, safety, actions',
  'Onboarding tour': 'onboarding, walkthrough, help, first run', 'Notification centre': 'notification, inbox, activity, feedback', 'Announcement banner': 'marketing, announcement, news', 'Inline edit': 'user input, editing, tables, profile',
  'Stat cards': 'data, KPI, dashboard, metrics', 'Sortable table': 'data, table, sorting', 'Accordion': 'content, FAQ, disclosure', 'Animated list': 'data, list, feed', 'Date picker': 'user input, date, range, calendar, scheduling',
  'Avatars and presence': 'people, team, presence, collaboration', 'Data grid': 'data, table, spreadsheet, filters, search, query, grouping, admin', 'JSON viewer': 'developer, data, API, debugging', 'Keyboard shortcuts': 'keyboard, help, power users',
  'Kanban board': 'project management, tasks, drag and drop, workflow, planning', 'Sortable list': 'drag and drop, ordering, priorities', 'Tree view': 'files, hierarchy, navigation, explorer', 'Activity timeline': 'activity, history, feed, audit log',
  'Split panes': 'layout, IDE, resizable, editor', 'Calendar scheduler': 'scheduling, calendar, meetings, booking, planning, drag and drop', 'Org chart': 'people, hierarchy, team, HR',
  'Comments and threads': 'collaboration, comments, review, feedback', 'Live presence': 'collaboration, realtime, multiplayer, cursors', 'Chat inbox': 'chat, messaging, support, inbox',
  'Pricing table': 'pricing, plans, marketing, monetisation', 'Checkout': 'commerce, payments, checkout, forms', 'Settings page': 'settings, account, preferences', 'Profile': 'people, profile, social, account', 'Onboarding checklist': 'onboarding, progress, setup, activation',
  'Line with forecast band': 'charts, time series, forecast, uncertainty, trends', 'Bar': 'charts, comparison, categories', 'Doughnut': 'charts, part to whole, share', 'Stacked area': 'charts, time series, composition',
  'Radar': 'charts, comparison, profile, skills', 'Scatter': 'charts, correlation, statistics', 'Sparkline tile': 'charts, KPI, dashboard, trends', 'Waterfall': 'charts, finance, bridge, P&L',
  'Combo bar + line': 'charts, comparison, time series', 'Histogram': 'charts, distribution, statistics', 'Bubble': 'charts, three variables, portfolio', 'Funnel': 'charts, conversion, marketing, process',
  'Gauge': 'charts, KPI, target, score', 'Candlestick': 'charts, finance, trading, markets', 'Sparklines': 'charts, finance, tickers, realtime, trends', 'Polar area': 'charts, categories, comparison',
  'Gantt': 'project management, planning, timeline, dependencies, critical path', 'State diagram': 'state, workflow, lifecycle, process, UML, subscription', 'State machine': 'state, workflow, process, automation, agents',
  'Trace waterfall': 'observability, tracing, performance, agents, process, debugging', 'Heatmap': 'charts, activity, patterns', 'Calendar heatmap': 'charts, activity, contributions, streaks', 'Treemap': 'charts, part to whole, hierarchy, budget',
  'Sankey': 'charts, flows, process, conversion, budget', 'Bullet': 'charts, target, KPI, performance', 'Error bars': 'charts, statistics, uncertainty, experiments, A/B test',
  'Regression with confidence band': 'charts, statistics, uncertainty, forecast, correlation, data science', 'Box and violin': 'charts, statistics, distribution, outliers, data science',
  'Histogram and density': 'charts, statistics, distribution, data science', 'Forest plot': 'charts, statistics, uncertainty, experiments, meta-analysis, A/B test',
  'Map': 'charts, geo, countries, regions', 'Globe': 'charts, geo, network, global, routes', 'Network graph': 'charts, relationships, graph, dependencies', 'Process flow': 'process, workflow, automation, node editor, pipeline',
  'Data flow': 'process, pipeline, data, ETL, realtime', 'Code block': 'code, developer, docs, syntax', 'Install command': 'code, developer, docs, CLI', 'Tabbed example': 'code, developer, docs, API',
  'Terminal': 'code, developer, CLI, logs', 'Diff': 'code, developer, review, changes, version control', 'Video player': 'media, video, player', 'Audio player': 'media, audio, podcast, music', 'Compact audio': 'media, audio, voice note, chat',
  'Masonry gallery': 'media, images, gallery, portfolio', 'Media cards': 'media, content, cards, feed', 'Carousel': 'media, images, slider, marketing', 'Before / after': 'media, images, comparison, design',
  'Image with states': 'media, images, loading, errors', 'Avatar upload': 'upload, profile, images, crop',
  'Chat': 'AI, chat, assistant, streaming, AI output', 'Thinking steps': 'AI, reasoning, progress, transparency, AI output', 'Agent plan': 'AI, agents, plan, progress, tasks', 'Permission request': 'AI, approval, human in the loop, safety, agents',
  'Citations': 'AI, sources, trust, AI output', 'Ghost text': 'AI, autocomplete, suggestions, writing', 'Suggested edit': 'AI, review, accept or reject, writing, human in the loop', 'Confidence flags': 'AI, uncertainty, review, human in the loop, extraction',
  'Voice input': 'AI, voice, user input, dictation', 'Chat composer': 'AI, chat, user input, composer, upload, drag and drop, permissions, connectors, MCP', 'Sources panel': 'AI, sources, research, trust, citations', 'Model comparison': 'AI, evaluation, benchmarks, models, comparison', 'AI canvas': 'AI, canvas, editor, artifacts, code, documents',
  'Agent transit map': 'AI, agents, orchestration, process, state, human in the loop, workflow'
}
/** Tags every card in a section also gets. */
export const SECTION_TAGS: Record<string, string> = { buttons: 'actions', motion: 'animation', inputs: 'user input', forms: 'forms, user input', navigation: 'navigation', feedback: 'feedback', overlays: 'overlay', data: 'data', layout: 'layout', collab: 'collaboration', pages: 'pages, templates', charts: 'charts, data visualisation', code: 'developer', media: 'media', ai: 'AI', diagrams: 'charts, diagrams, data visualisation' }

const kitSplitTags = (s?: string) => (s ?? '').split(',').map(t => t.trim()).filter(Boolean)
const kitTagKeys = Object.keys(SPEC_TAGS)
/** Tags for a card: its own (by exact title, else by the parts of a merged title such as "Rating and tags"), then its section's. */
export function specTags(title: string, section?: string): string[] {
  let own = SPEC_TAGS[title]
  if (own === undefined) {
    const parts = title.toLowerCase().split(/\s*(?:,| and | \+ | & |\/)\s*/).filter(Boolean)
    own = parts.flatMap(p => kitTagKeys.filter(k => { const kl = k.toLowerCase(); return kl === p || kl.startsWith(p) || p.startsWith(kl) }).map(k => SPEC_TAGS[k])).join(',')
  }
  return [...new Set([...kitSplitTags(own), ...kitSplitTags(section ? SECTION_TAGS[section] : '')])]
}
export const specSlug = (t: string) => 'c-' + t.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')

/* Card registry ─────────────────────────────────────────────────────────────── */

export type SpecEntry = { key: string; id: string; title: string; desc: string; section: string; tags: string[] }
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

/** Does a card match the filter? Every word must appear in its title, description or tags. */
export function specMatches(e: Pick<SpecEntry, 'title' | 'desc' | 'tags'>, query: string) {
  const q = query.trim().toLowerCase()
  if (!q) return true
  const text = `${e.title} ${e.desc} ${e.tags.join(', ')}`.toLowerCase()
  return q.split(/\s+/).every(w => text.includes(w))
}

/* Page shell context: the sidebar filter query, shared with every card. */
type KitShell = { query: string; setQuery: (q: string) => void; focusFilter: () => void }
export const ShellContext = createContext<KitShell>({ query: '', setQuery: () => {}, focusFilter: () => {} })
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

/* Layout pieces ─────────────────────────────────────────────────────────────── */

/** A component card: title, one-line description, use-case tag chips, then the demo. Fades up when scrolled into view. */
export function Spec({ title, desc, children, span = 1 }: { title: string; desc?: string; children: ReactNode; span?: 1 | 2 | 3 }) {
  const key = useId()
  const section = useContext(SectionContext)
  const { query, setQuery, focusFilter } = useContext(ShellContext)
  const base = specSlug(title)
  const [id, setId] = useState(base)
  const tags = specTags(title, section)
  const tagKey = tags.join(',')
  useLayoutEffect(() => {
    setId(kitRegister({ key, id: base, title, desc: desc ?? '', section, tags }))
  }, [key, base, title, desc, section, tagKey]) // eslint-disable-line react-hooks/exhaustive-deps
  useLayoutEffect(() => () => { kitSpecs.delete(key); kitNotify() }, [key])
  const shown = specMatches({ title, desc: desc ?? '', tags }, query)
  const pickTag = (t: string) => {
    setQuery(t); focusFilter()
    scrollTo({ top: 0, behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' })
  }
  return (
    <Reveal id={id} data-spec={title}
      className={cn('group/spec min-w-0 scroll-mt-28 rounded-[var(--r-lg)] transition-shadow duration-500 data-[flash]:shadow-[0_0_0_2px_var(--accent),0_0_0_6px_var(--accent-soft)]',
        span === 2 && 'md:col-span-2', span === 3 && 'col-span-full', !shown && 'hidden')}>
      <Card className="flex h-full flex-col">
        <div className="flex min-w-0 items-start gap-1">
          <h3 className="m-0 min-w-0 flex-1 text-sm leading-snug font-semibold">{title}</h3>
          <button type="button" data-qa-skip onClick={() => openCodeDrawer(title)} aria-label={`View code for ${title}`} title="View code"
            className="-my-0.5 grid h-[22px] w-[22px] flex-none cursor-pointer place-items-center rounded-[var(--r-md)] border-0 bg-transparent text-[var(--fg3)] opacity-0 transition-[opacity,background-color] duration-150 group-hover/spec:opacity-100 hover:bg-[var(--muted)] hover:text-[var(--fg)] focus-visible:opacity-100 focus-visible:outline-2 focus-visible:outline-[var(--accent)] max-[900px]:opacity-100 [@media(hover:none)]:opacity-100 [@media(pointer:coarse)]:-my-[7px] [@media(pointer:coarse)]:-mr-[5px] [@media(pointer:coarse)]:-ml-[5px] [@media(pointer:coarse)]:h-8 [@media(pointer:coarse)]:w-8">
            <Icon name="code" size={15} />
          </button>
        </div>
        {desc && <p className="m-0 mt-1 text-xs leading-snug text-[var(--fg3)]">{desc}</p>}
        {tags.length > 0 && (
          <div className="mt-2 mb-4 flex flex-wrap gap-1">
            {/* on touch the button is 32px tall (transparent padding, pulled back with negative margins) around the same 21px pill */}
            {tags.slice(0, 4).map(t => (
              <button key={t} type="button" onClick={() => pickTag(t)} aria-label={`Show components tagged ${t}`}
                className="group/tag cursor-pointer border-0 bg-transparent p-0 [@media(pointer:coarse)]:-my-[5.5px] [@media(pointer:coarse)]:py-[5.5px]">
                <span className="block rounded-full bg-[var(--muted)] px-2 py-0.5 text-[11px] leading-normal font-medium text-[var(--fg2)] group-hover/tag:bg-[var(--accent-soft)] group-hover/tag:text-[var(--accent)]">{t}</span>
              </button>
            ))}
          </div>
        )}
        {!tags.length && <div className="mb-4" />}
        <div data-spec-body className="flex flex-1 flex-col gap-3">{children}</div>
      </Card>
    </Reveal>
  )
}

/** A page section: heading, intro line and a responsive card grid. Hides itself when the filter matches none of its cards. */
export function Section({ id, title, desc, children }: { id: string; title: string; desc: string; children: ReactNode }) {
  const { query } = useContext(ShellContext)
  const specs = useSpecs()
  const mine = specs.filter(s => s.section === id)
  const empty = !!query.trim() && mine.length > 0 && !mine.some(s => specMatches(s, query))
  return (
    <SectionContext.Provider value={id}>
      <section id={id} className={cn('mb-12 scroll-mt-28 md:mb-16 min-[900px]:scroll-mt-20', empty && 'hidden')}>
        <div className="mb-4"><h2 className="m-0 mb-1 text-[22px] leading-tight font-semibold tracking-tight min-[900px]:text-[26px]">{title}</h2><p className="m-0 text-[var(--fg2)]">{desc}</p></div>
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
