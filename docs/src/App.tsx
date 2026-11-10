// The docs site: one page per registry item (component or small family), grouped by area. Each page has the
// description, its tags, install snippets (npm, the drop-in CLI, shadcn), the showcase cards that use it (mounted live),
// props tables generated from the TypeScript types (scripts/build-docs-data.mjs) and the drop-in file's size.
// Areas and tags come from the vocabulary in src/showcase/tags.ts; the sidebar filters by text (synonyms included) and
// by tags (OR within a facet, AND across), kept in the URL as ?tags=…&q=… so a filtered list can be shared.
import { Suspense, createContext, createElement, lazy, useCallback, useContext, useEffect, useMemo, useRef, useState, type ComponentType, type ReactNode } from 'react'
import {
  Badge, Button, Card, Collapse, CommandPalette, Icon, IconButton, Input, Kbd, Sheet, ThemeToggle, UIProvider, cn, useHotkey, type Command,
} from '../../src/lib'
import { CodeBlock, CodeTabs } from '../../src/lib/code'
import { ShellContext } from '../../src/showcase/kit'
import {
  TAG_BY_ID, type TagFacet, type TagId, tagFacetCounts, tagMatches, tagParseUrl, tagSearchString, tagToggle, tagsOfFacet,
} from '../../src/showcase/tags'
import data from '../generated/items.json'
import demos from '../generated/demos.json'

type Prop = { name: string; type: string; required: boolean; default: string | null; doc: string }
type Api = { name: string; kind: 'component' | 'hook' | 'function' | 'value'; doc: string; props?: Prop[]; inherited?: number; inheritedFrom?: string[]; signature?: string }
type Item = {
  name: string; title: string; type: string; description: string; tier: 'core' | 'extras' | 'block'; family: string | null; import: string | null
  kind: TagId; area: TagId; tags: TagId[]; module?: string; exports: string[]; embeds: string[]
  dependencies: string[]; requires: string[]; bytes: number; tokens: number; file: string; packageFile: string | null; api: Api[]
}
type Demo = { section: string; file: string; exportName: string; titles: string[] }

const ITEMS = data.items as unknown as Item[]
const AREAS = (data.areas as [string, string][]).filter(([id]) => ITEMS.some(i => i.area === id))
const FAMILY_LABEL: Record<string, string> = { ai: 'AI', vizkit: 'Chart math' }
/** Sidebar groups by tier: core by area, then each extras family, then the copy-in blocks. */
const TIERS: { label: string; groups: { key: string; label: string; match: (i: Item) => boolean }[] }[] = [
  { label: 'Core', groups: AREAS.map(([id, label]) => ({ key: `core-${id}`, label, match: i => i.tier === 'core' && i.area === id })) },
  { label: 'Extras', groups: (data.families as string[]).map(f => ({ key: `extras-${f}`, label: FAMILY_LABEL[f] ?? f[0].toUpperCase() + f.slice(1), match: i => i.family === f })) },
  { label: 'Blocks', groups: [{ key: 'blocks', label: 'Copy-in blocks', match: i => i.tier === 'block' }] },
]
const DEMOS = demos as Record<string, Demo>
const BY_NAME = new Map(ITEMS.map(i => [i.name, i]))
const REPO = 'https://github.com/lantos1618/oneshot-ui'
// the registry is deployed next to the docs (docs-dist/r, docs-dist/files): links stay relative to the page
const here = () => new URL('.', location.href).href.replace(/\/$/, '')

const TYPE_LABEL: Record<string, string> = { 'registry:ui': 'component', 'registry:block': 'block (copy-in)', 'registry:lib': 'utilities', 'registry:hook': 'hooks' }
/** The first sentence or two of a long description (the API section below has all of it). */
const lead = (s: string) => {
  if (s.length <= 240) return s
  const parts = s.split(/(?<=[.!?])\s+(?=[A-Z`])/)
  let out = ''
  for (const p of parts) { if (out && (out + ' ' + p).length > 240) break; out = out ? `${out} ${p}` : p }
  return out
}
const kb = (n: number) => `${(n / 1024).toFixed(1)} KB`
const tok = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : `${n}`)

/* routing: #/ (home) and #/c/<name> */
function useRoute() {
  const read = () => decodeURIComponent(location.hash.replace(/^#\/?/, ''))
  const [route, setRoute] = useState(read)
  useEffect(() => {
    const on = () => { setRoute(read()); window.scrollTo({ top: 0 }) }
    addEventListener('hashchange', on)
    return () => removeEventListener('hashchange', on)
  }, [])
  return route
}
const go = (name?: string) => { location.hash = name ? `/c/${name}` : '/' }

/* Tag filter: the selection and text query, shared by the sidebar, the home page and the tag chips on item pages. */
type DocsFilterValue = { q: string; tags: TagId[]; setQ: (q: string) => void; toggle: (id: TagId) => void; pick: (id: TagId) => void; clear: () => void }
const DocsFilter = createContext<DocsFilterValue>({ q: '', tags: [], setQ: () => {}, toggle: () => {}, pick: () => {}, clear: () => {} })
/** What search reads for an item, plus its kind and tags (their labels and synonyms count too). */
const searchable = (i: Item) => ({ text: `${i.name} ${i.title} ${i.exports.join(' ')} ${i.description}`, tags: [i.kind, ...i.tags] })
const DOCS_FACETS: [TagFacet, string][] = [['use', 'Use case'], ['capability', 'Capability'], ['kind', 'Kind'], ['status', 'Status']]
const tagHref = (id: TagId) => `${tagSearchString('', [id], '')}#/`

function useDocsFilter(): DocsFilterValue {
  const [q, setQ] = useState(() => tagParseUrl(location.search).q)
  const [tags, setTags] = useState<TagId[]>(() => tagParseUrl(location.search).tags)
  const synced = useRef(location.search) // the search string the state matches
  useEffect(() => {
    const search = tagSearchString(location.search, tags, q)
    synced.current = search
    if (search !== location.search) history.replaceState(history.state, '', `${location.pathname}${search}${location.hash}`)
  }, [tags, q])
  useEffect(() => {
    // back/forward to another filter; a route change (#/c/…) fires popstate too, with the search string we wrote
    const on = () => { if (location.search === synced.current) return; const u = tagParseUrl(location.search); synced.current = location.search; setTags(u.tags); setQ(u.q) }
    addEventListener('popstate', on); return () => removeEventListener('popstate', on)
  }, [])
  const toggle = useCallback((id: TagId) => setTags(cur => tagToggle(cur, id)), [])
  const pick = useCallback((id: TagId) => { setTags([id]); setQ(''); go() }, [])
  const clear = useCallback(() => { setTags([]); setQ('') }, [])
  return useMemo(() => ({ q, tags, setQ, toggle, pick, clear }), [q, tags, toggle, pick, clear])
}

/** A tag as a link to the filtered list (the item page's chips). */
function TagLink({ id }: { id: TagId }) {
  const { pick } = useContext(DocsFilter)
  return (
    <a href={tagHref(id)} title={TAG_BY_ID[id].desc} onClick={e => { if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return; e.preventDefault(); pick(id) }}
      className="group/tag rounded-full no-underline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--accent)]">
      <Badge size="sm" className="group-hover/tag:!bg-[var(--accent-soft)] group-hover/tag:!text-[var(--accent)]">{TAG_BY_ID[id].label}</Badge>
    </a>
  )
}

/** Toggle chips for each facet, with how many items each would match. */
function TagFacets({ counts }: { counts: Record<TagId, number> }) {
  const { tags, toggle } = useContext(DocsFilter)
  return (
    <div className="flex flex-col gap-3">
      {DOCS_FACETS.map(([facet, label]) => (
        <div key={facet} role="group" aria-label={label} className="flex flex-col gap-1.5">
          <span className="px-0.5 text-[11px] font-semibold tracking-wide text-[var(--fg3)] uppercase">{label}</span>
          <div className="flex flex-wrap gap-1">
            {tagsOfFacet(facet).map(d => {
              const id = d.id as TagId, on = tags.includes(id), n = counts[id]
              if (!n && !on) return null
              return (
                <button key={id} type="button" aria-pressed={on} title={d.desc} onClick={() => toggle(id)}
                  className={cn('inline-flex h-6 cursor-pointer items-center gap-1 rounded-full border px-2 text-[11px] font-medium whitespace-nowrap [@media(pointer:coarse)]:h-8',
                    on ? 'border-[var(--primary)] bg-[var(--primary)] text-[var(--on-primary)]' : 'border-[var(--line)] bg-[var(--card)] text-[var(--fg2)] hover:bg-[var(--muted)]')}>
                  {d.label}<span className={cn('tabular-nums', !on && 'text-[var(--fg3)]')}>{n}</span>
                </button>
              )
            })}
          </div>
        </div>
      ))}
    </div>
  )
}

export function App() {
  return (
    <UIProvider>
      <Docs />
    </UIProvider>
  )
}

function Docs() {
  const filter = useDocsFilter()
  const route = useRoute()
  const [menu, setMenu] = useState(false)
  const [search, setSearch] = useState(false)
  useHotkey('mod+k', e => { e.preventDefault(); setSearch(true) })
  const item = route.startsWith('c/') ? BY_NAME.get(route.slice(2)) : undefined
  useEffect(() => { document.title = item ? `${item.title} · @lyndon/ui docs` : '@lyndon/ui docs' }, [item])
  const commands = useMemo<Command[]>(() => ITEMS.map(i => ({
    id: i.name, label: i.title, group: AREAS.find(([a]) => a === i.area)?.[1], hint: `~${tok(i.tokens)} tokens`,
    keywords: [i.name, ...i.exports, ...i.tags.flatMap(t => [TAG_BY_ID[t].label, ...TAG_BY_ID[t].synonyms])], run: () => go(i.name),
  })), [])
  return (
    <DocsFilter.Provider value={filter}>
    <div className="min-h-dvh bg-[var(--bg)] text-[var(--fg)]">
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:rounded-[var(--r-md)] focus:bg-[var(--card)] focus:p-2">Skip to content</a>
      <header className="sticky top-0 z-30 border-b border-[var(--line)] bg-[color-mix(in_srgb,var(--bg)_85%,transparent)] backdrop-blur">
        <div className="mx-auto flex h-14 max-w-[1280px] items-center gap-2 px-4">
          <IconButton icon="menu" label="Components" className="min-[900px]:!hidden" onClick={() => setMenu(true)} />
          <a href="#/" className="mr-auto flex items-center gap-2 text-sm font-semibold text-[var(--fg)] no-underline">
            <span className="grid h-7 w-7 place-items-center rounded-[var(--r-md)] bg-[var(--primary)] text-xs text-[var(--on-primary)]">ly</span>
            <span>@lyndon/ui <span className="font-normal text-[var(--fg3)]">docs · {data.version}</span></span>
          </a>
          <Button size="sm" onClick={() => setSearch(true)} className="max-[520px]:!hidden !justify-start !text-[var(--fg3)] min-w-[200px]">
            <Icon name="search" size={14} />Search components<Kbd className="ml-auto">⌘K</Kbd>
          </Button>
          <IconButton icon="search" label="Search components" className="min-[521px]:!hidden" onClick={() => setSearch(true)} />
          <Button size="sm" variant="ghost" asChild className="max-[700px]:!hidden"><a href="./showcase/">Showcase</a></Button>
          <Button size="sm" variant="ghost" asChild className="max-[700px]:!hidden"><a href={REPO}>GitHub</a></Button>
          <ThemeToggle />
        </div>
      </header>
      <div className="mx-auto flex max-w-[1280px] gap-8 px-4">
        <aside className="sticky top-14 hidden h-[calc(100dvh-56px)] w-[248px] flex-none overflow-y-auto py-6 pr-2 min-[900px]:block">
          <Sidebar current={item?.name} />
        </aside>
        <main id="main" className="min-w-0 flex-1 py-8 pb-24">
          {item ? <ItemPage key={item.name} item={item} /> : route.startsWith('c/') ? <NotFound name={route.slice(2)} /> : <Home />}
        </main>
      </div>
      <Sheet open={menu} onOpenChange={setMenu} title="Components" side="left" responsive={false}>
        <div onClick={e => { if ((e.target as HTMLElement).closest('a')) setMenu(false) }}><Sidebar current={item?.name} /></div>
      </Sheet>
      <CommandPalette open={search} onOpenChange={setSearch} commands={commands} placeholder="Search components, hooks and exports…" />
    </div>
    </DocsFilter.Provider>
  )
}

function Sidebar({ current }: { current?: string }) {
  const { q, setQ, tags, clear } = useContext(DocsFilter)
  const [open, setOpen] = useState(tags.length > 0)
  const counts = useMemo(() => tagFacetCounts(ITEMS.map(searchable), q, tags), [q, tags])
  const shown = ITEMS.filter(i => tagMatches(searchable(i), q, tags))
  const filtering = !!q.trim() || tags.length > 0
  return (
    <nav aria-label="Components" className="flex flex-col gap-5">
      <div className="flex flex-col gap-2">
        <Input type="search" placeholder="Filter by name, tag or synonym…" aria-label="Filter components" value={q} onChange={e => setQ(e.target.value)} />
        <div className="flex items-center gap-1">
          <Button size="xs" variant="ghost" aria-expanded={open} onClick={() => setOpen(!open)} className="!px-1.5">
            <Icon name="sliders" size={13} />Tags{tags.length > 0 && <Badge size="sm" tone="accent">{tags.length}</Badge>}
            <Icon name="chevronDown" size={13} className={cn('transition-transform', open && 'rotate-180')} />
          </Button>
          <span className="flex-1" />
          {filtering && <><span className="text-[11px] text-[var(--fg3)] tabular-nums" aria-live="polite">{shown.length} found</span><Button size="xs" variant="ghost" onClick={clear}>Clear</Button></>}
        </div>
        {tags.length > 0 && (
          <ul aria-label="Active filters" className="m-0 flex list-none flex-wrap gap-1 p-0">
            {tags.map(id => <li key={id}><ActiveTag id={id} /></li>)}
          </ul>
        )}
        <Collapse open={open}><div className="pt-1"><TagFacets counts={counts} /></div></Collapse>
      </div>
      <a href="#/" className={cn('rounded-[var(--r-md)] px-2 py-1.5 text-[13px] no-underline', !current ? 'bg-[var(--muted)] font-medium text-[var(--fg)]' : 'text-[var(--fg2)] hover:text-[var(--fg)]')}>Introduction</a>
      {TIERS.map(tier => tier.groups.some(g => shown.some(g.match)) && (
        <div key={tier.label} className="flex flex-col gap-4">
          <h2 className="m-0 px-2 text-xs font-semibold text-[var(--fg)]">{tier.label}</h2>
          {tier.groups.map(({ key, label, match }) => {
            const list = shown.filter(match)
            if (!list.length) return null
            return (
              <div key={key}>
                <h3 className="m-0 mb-1 flex items-baseline justify-between px-2 text-[11px] font-semibold tracking-wide text-[var(--fg3)] uppercase">{label}<span className="font-normal tabular-nums">{list.length}</span></h3>
                <ul className="m-0 flex list-none flex-col p-0">
                  {list.map(i => (
                    <li key={i.name}>
                      <a href={`#/c/${i.name}`} aria-current={i.name === current ? 'page' : undefined}
                        className={cn('flex h-8 items-center justify-between gap-2 rounded-[var(--r-md)] px-2 text-[13px] no-underline [@media(pointer:coarse)]:h-10',
                          i.name === current ? 'bg-[var(--muted)] font-medium text-[var(--fg)]' : 'text-[var(--fg2)] hover:bg-[var(--muted)] hover:text-[var(--fg)]')}>
                        <span className="truncate">{i.title}</span>
                        <span className="flex-none text-[11px] text-[var(--fg3)] tabular-nums">{tok(i.tokens)}</span>
                      </a>
                    </li>
                  ))}
                </ul>
              </div>
            )
          })}
        </div>
      ))}
      {filtering && !shown.length && <p className="m-0 px-2 text-[13px] text-[var(--fg3)]">Nothing matches. <button type="button" onClick={clear} className="cursor-pointer border-0 bg-transparent p-0 text-[var(--accent)] underline">Clear filters</button></p>}
    </nav>
  )
}

function ActiveTag({ id }: { id: TagId }) {
  const { toggle } = useContext(DocsFilter)
  return (
    <button type="button" onClick={() => toggle(id)} aria-label={`Remove filter: ${TAG_BY_ID[id].label}`}
      className="inline-flex h-6 cursor-pointer items-center gap-1 rounded-full border border-[var(--primary)] bg-[var(--primary)] ps-2 pe-1.5 text-[11px] font-medium text-[var(--on-primary)] [@media(pointer:coarse)]:h-8">
      {TAG_BY_ID[id].label}<Icon name="x" size={11} />
    </button>
  )
}

/** The home page while a filter is on: the matching items as cards (on phones the sidebar sits in a sheet). */
function Results() {
  const { q, tags, clear } = useContext(DocsFilter)
  const shown = ITEMS.filter(i => tagMatches(searchable(i), q, tags))
  return (
    <Section title={`${shown.length} ${shown.length === 1 ? 'match' : 'matches'}${tags.length ? ` for ${tags.map(t => TAG_BY_ID[t].label).join(' + ')}` : ''}${q.trim() ? ` “${q.trim()}”` : ''}`}>
      <div className="flex flex-wrap gap-1">{tags.map(id => <ActiveTag key={id} id={id} />)}<Button size="xs" variant="ghost" onClick={clear}>Clear filters</Button></div>
      <div className="grid gap-3 [grid-template-columns:repeat(auto-fill,minmax(min(100%,260px),1fr))]">
        {shown.map(i => (
          <Card key={i.name} className="flex flex-col gap-1.5">
            <a href={`#/c/${i.name}`} className="text-sm font-semibold text-[var(--fg)]">{i.title}</a>
            <p className="m-0 text-xs text-[var(--fg3)]">{AREAS.find(([a]) => a === i.area)?.[1]} · {i.kind}</p>
            <p className="m-0 line-clamp-2 text-[13px] text-[var(--fg2)]">{lead(i.description)}</p>
            <div className="flex flex-wrap gap-1">{i.tags.filter(t => t !== i.area).slice(0, 4).map(t => <TagLink key={t} id={t} />)}</div>
          </Card>
        ))}
      </div>
    </Section>
  )
}

function Home() {
  const { q, tags, toggle } = useContext(DocsFilter)
  const sorted = [...ITEMS].sort((a, b) => a.tokens - b.tokens)
  const median = sorted[Math.floor(sorted.length / 2)]
  if (tags.length || q.trim()) return <article className="flex max-w-[960px] flex-col gap-6"><Results /></article>
  const useCases = tagsOfFacet('use').map(t => [t.id as TagId, ITEMS.filter(i => i.tags.includes(t.id as TagId)).length] as const).filter(([, n]) => n > 0)
  return (
    <article className="flex max-w-[860px] flex-col gap-6">
      <div>
        <h1 className="m-0 mb-2 text-[28px] leading-tight font-semibold tracking-tight">@lyndon/ui</h1>
        <p className="m-0 text-sm text-[var(--fg2)]">
          Animated React 19 components with themes, in the shadcn style: forms, overlays, navigation, a data grid, charts, diagrams,
          maps, media and AI chat. Styled with Tailwind, animated with motion, themed by CSS variables. Every component is also a
          self-contained drop-in file ({ITEMS.length} of them; median ~{tok(median.tokens)} tokens).
        </p>
      </div>
      <Section title="Install the package">
        <CodeTabs tabs={[
          { label: 'npm', code: 'npm i @lyndon/ui motion', language: 'sh' },
          { label: 'pnpm', code: 'pnpm add @lyndon/ui motion', language: 'sh' },
          { label: 'App', code: `import { UIProvider, Button } from '@lyndon/ui'\n\nexport function App() {\n  return (\n    <UIProvider>\n      <Button variant="primary">Save</Button>\n    </UIProvider>\n  )\n}`, language: 'ts' },
        ]} />
        <p className="m-0 text-[13px] text-[var(--fg2)]">Tailwind v4: add <code>@source "../node_modules/@lyndon/ui/dist";</code> to your CSS. No Tailwind: <code>import '@lyndon/ui/styles.css'</code>.</p>
      </Section>
      <Section title="Or copy single components">
        <CodeTabs tabs={[
          { label: 'CLI (offline)', code: 'npx @lyndon/ui add button dialog data-grid --dir src/components/ui\nnpx @lyndon/ui list\nnpx @lyndon/ui info data-grid', language: 'sh' },
          { label: 'shadcn', code: `npx shadcn add ${here()}/r/data-grid.json`, language: 'sh' },
        ]} />
        <p className="m-0 text-[13px] text-[var(--fg2)]">
          Each file includes exactly the helpers it needs and imports only react, react-dom and motion. Files share one
          <code> &lt;UIProvider&gt;</code> (the ui-provider item, added automatically). For AI tools: <a href="./llms.txt">llms.txt</a> lists every
          file with its size in tokens.
        </p>
      </Section>
      <Section title="Browse by use case">
        <div className="flex flex-wrap gap-1.5">
          {useCases.map(([id, n]) => (
            <button key={id} type="button" onClick={() => toggle(id)} title={TAG_BY_ID[id].desc}
              className="inline-flex h-[30px] cursor-pointer items-center gap-1.5 rounded-full border border-[var(--line)] bg-[var(--card)] px-3 text-xs font-medium text-[var(--fg2)] hover:bg-[var(--muted)] hover:text-[var(--fg)] [@media(pointer:coarse)]:h-9">
              {TAG_BY_ID[id].label}<span className="text-[var(--fg3)] tabular-nums">{n}</span>
            </button>
          ))}
        </div>
      </Section>
      <Section title="Browse by area">
        <div className="grid gap-3 [grid-template-columns:repeat(auto-fill,minmax(min(100%,240px),1fr))]">
          {AREAS.map(([id, label]) => {
            const list = ITEMS.filter(i => i.area === id)
            return (
              <Card key={id} className="flex flex-col gap-2">
                <h3 className="m-0 text-sm font-semibold">{label}</h3>
                <p className="m-0 text-xs text-[var(--fg3)]">{list.length} {list.length === 1 ? 'item' : 'items'}</p>
                <div className="flex flex-wrap gap-x-2 gap-y-1 text-[13px]">
                  {list.slice(0, 8).map(i => <a key={i.name} href={`#/c/${i.name}`} className="text-[var(--accent)]">{i.title}</a>)}
                  {list.length > 8 && <span className="text-[var(--fg3)]">+{list.length - 8}</span>}
                </div>
              </Card>
            )
          })}
        </div>
      </Section>
    </article>
  )
}

function Section({ title, children, id }: { title: string; children: ReactNode; id?: string }) {
  return (
    <section id={id} className="flex flex-col gap-3">
      <h2 className="m-0 text-base font-semibold">{title}</h2>
      {children}
    </section>
  )
}

function ItemPage({ item }: { item: Item }) {
  const demo = DEMOS[item.name]
  const area = AREAS.find(([a]) => a === item.area)?.[1]
  const components = item.api.filter(a => a.kind === 'component').map(a => a.name)
  const block = item.type === 'registry:block'
  const source = `src/${block ? 'blocks' : 'lib'}/${item.module ?? 'core'}.tsx`
  const importLine = `import { ${(components.length ? components : item.exports).slice(0, 6).join(', ')} } from '${item.import ?? '@lyndon/ui'}'`
  return (
    <article className="flex max-w-[960px] flex-col gap-8">
      <header className="flex flex-col gap-2">
        <p className="m-0 text-xs text-[var(--fg3)]">{area}</p>
        <h1 className="m-0 text-[28px] leading-tight font-semibold tracking-tight">{item.title}</h1>
        <p className="m-0 max-w-[72ch] text-sm text-[var(--fg2)]">{lead(item.description)}</p>
        <div className="flex flex-wrap gap-1.5">
          <Badge>{TYPE_LABEL[item.type] ?? item.type.replace('registry:', '')}</Badge>
          <Badge>~{tok(item.tokens)} tokens</Badge>
          <Badge>{kb(item.bytes)}</Badge>
          {item.requires.includes('ui-provider') && <Badge tone="accent">inside &lt;UIProvider&gt;</Badge>}
          {item.dependencies.filter(d => d !== 'react' && d !== 'react-dom').map(d => <Badge key={d} tone="neutral">{d}</Badge>)}
        </div>
        {item.tags.length > 1 && (
          <ul aria-label="Tags" className="m-0 flex list-none flex-wrap gap-1 p-0">
            {item.tags.filter(t => t !== item.area).map(t => <li key={t}><TagLink id={t} /></li>)}
          </ul>
        )}
      </header>
      <Section title="Install">
        <CodeTabs tabs={[
          ...(block ? [] : [{ label: 'npm', code: `npm i @lyndon/ui motion\n\n${importLine}`, language: 'ts' as const }]),
          { label: 'Drop-in (CLI)', code: `npx @lyndon/ui add ${item.name}`, language: 'sh' },
          { label: 'shadcn', code: `npx shadcn add ${here()}/r/${item.name}.json`, language: 'sh' },
        ]} />
      </Section>
      <Section title="Example">
        {demo ? <DocsDemo demo={demo} /> : (
          <p className="m-0 text-[13px] text-[var(--fg2)]">No dedicated example card; it appears inside other components. See the <a href="./showcase/">showcase</a>.</p>
        )}
      </Section>
      <Section title="API">
        {item.api.map(a => <ApiEntry key={a.name} api={a} />)}
      </Section>
      <Section title="Drop-in file">
        <dl className="m-0 grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1.5 text-[13px]">
          <dt className="text-[var(--fg3)]">File</dt><dd className="m-0"><a href={`./${item.file}`}>{item.name}.tsx</a> · {kb(item.bytes)} · ~{tok(item.tokens)} tokens · <a href={`./r/${item.name}.json`}>registry item</a></dd>
          {item.packageFile && <><dt className="text-[var(--fg3)]">Package variant</dt><dd className="m-0"><a href={`./${item.packageFile}`}>{item.name}.package.tsx</a> (imports @lyndon/ui)</dd></>}
          {item.import && <><dt className="text-[var(--fg3)]">Tier</dt><dd className="m-0">{item.tier === 'core' ? 'Core' : `Extras · ${item.family}`} · <code>{item.import}</code></dd></>}
          <dt className="text-[var(--fg3)]">Exports</dt><dd className="m-0 font-[family-name:var(--mono)] text-xs">{item.exports.join(', ')}</dd>
          {item.embeds.length > 0 && <><dt className="text-[var(--fg3)]">Embeds</dt><dd className="m-0 text-xs">{item.embeds.map((e, i) => {
            const target = ITEMS.find(x => x.exports.includes(e))
            return <span key={e}>{i > 0 && ', '}{target ? <a href={`#/c/${target.name}`}>{e}</a> : e}</span>
          })}</dd></>}
          <dt className="text-[var(--fg3)]">Source</dt><dd className="m-0"><a href={`${REPO}/blob/main/${source}`}>{source}</a></dd>
        </dl>
      </Section>
    </article>
  )
}

function ApiEntry({ api }: { api: Api }) {
  return (
    <div className="flex flex-col gap-2">
      <h3 className="m-0 font-[family-name:var(--mono)] text-[13px] font-semibold">
        {api.kind === 'component' ? `<${api.name}>` : api.name}
        <span className="ml-2 font-[family-name:var(--font)] text-[11px] font-normal text-[var(--fg3)]">{api.kind}</span>
      </h3>
      {api.doc && <p className="m-0 max-w-[80ch] text-[13px] text-[var(--fg2)]">{api.doc}</p>}
      {api.signature && <CodeBlock code={api.signature} language="ts" lineNumbers={false} collapseAt={false} />}
      {api.props && (api.props.length ? <PropsTable props={api.props} /> : <p className="m-0 text-[13px] text-[var(--fg3)]">No props of its own.</p>)}
      {api.inherited ? <p className="m-0 text-xs text-[var(--fg3)]">Also takes {api.inherited} props from React's DOM attribute types (passed to the root element).</p> : null}
    </div>
  )
}

function PropsTable({ props }: { props: Prop[] }) {
  return (
    <div className="overflow-x-auto rounded-[var(--r-lg)] border border-[var(--line)]">
      <table className="w-full border-collapse text-left text-[13px]">
        <thead className="bg-[var(--muted)] text-xs text-[var(--fg2)]">
          <tr><th className="px-3 py-2 font-medium">Prop</th><th className="px-3 py-2 font-medium">Type</th><th className="px-3 py-2 font-medium">Default</th><th className="px-3 py-2 font-medium max-[700px]:hidden">Description</th></tr>
        </thead>
        <tbody>
          {props.map(p => (
            <tr key={p.name} className="border-t border-[var(--line)] align-top">
              <td className="px-3 py-2 font-[family-name:var(--mono)] text-xs whitespace-nowrap">{p.name}{p.required && <span className="text-[var(--bad)]" title="required">*</span>}
                {p.doc && <p className="m-0 mt-1 font-[family-name:var(--font)] text-xs whitespace-normal text-[var(--fg2)] min-[701px]:hidden">{p.doc}</p>}</td>
              <td className="max-w-[340px] px-3 py-2 font-[family-name:var(--mono)] text-xs break-words text-[var(--fg2)]">{p.type}</td>
              <td className="px-3 py-2 font-[family-name:var(--mono)] text-xs text-[var(--fg2)]">{p.default ?? '–'}</td>
              <td className="px-3 py-2 text-xs text-[var(--fg2)] max-[700px]:hidden">{p.doc}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/* Live examples: the showcase section (lazy-loaded), showing only the cards that use this page's components. */
const SECTIONS = import.meta.glob<Record<string, ComponentType>>('../../src/showcase/*Section.tsx')
const lazySection = (file: string, exportName: string) => lazy(async () => {
  const load = SECTIONS[`../../src/showcase/${file}.tsx`]
  if (!load) throw new Error(`no showcase section ${file}`)
  const mod = await load()
  return { default: mod[exportName] }
})
const lazyCache = new Map<string, ReturnType<typeof lazySection>>()

function DocsDemo({ demo }: { demo: Demo }) {
  const { pick } = useContext(DocsFilter)
  // the cards' tag chips filter this site's list instead of linking to the showcase
  const shell = useMemo(() => ({ query: '', tags: [], setQuery: () => {}, focusFilter: () => {}, pickTag: pick, tagHref }), [pick])
  const key = `${demo.file}:${demo.exportName}`
  if (!lazyCache.has(key)) lazyCache.set(key, lazySection(demo.file, demo.exportName))
  const sectionDemo = lazyCache.get(key)! // cached per section, so it is the same component on every render
  const sel = demo.titles.map(t => `:not([data-spec="${t.replace(/["\\]/g, '\\$&')}"])`).join('')
  return (
    <div className="docs-demo">
      <style>{`.docs-demo [data-spec]${sel}{display:none}`}</style>
      <ShellContext.Provider value={shell}>
        <Suspense fallback={<Card className="h-40 animate-pulse" />}>
          {createElement(sectionDemo)}
        </Suspense>
      </ShellContext.Provider>
      <p className="m-0 mt-2 text-xs text-[var(--fg3)]">From the <a href={`./showcase/#${demo.section}`}>showcase</a> ({demo.titles.join(', ')}).</p>
    </div>
  )
}

function NotFound({ name }: { name: string }) {
  return (
    <div className="flex flex-col items-start gap-3">
      <h1 className="m-0 text-[22px] font-semibold">No component “{name}”</h1>
      <Button onClick={() => go()}>Back to the introduction</Button>
    </div>
  )
}
