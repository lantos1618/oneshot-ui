// The docs site: one page per registry item (component or small family), grouped by area. Each page has the
// description, install snippets (npm, the drop-in CLI, shadcn), the showcase cards that use it (mounted live), props
// tables generated from the TypeScript types (scripts/build-docs-data.mjs) and the drop-in file's size.
import { Suspense, createElement, lazy, useEffect, useMemo, useState, type ComponentType, type ReactNode } from 'react'
import {
  Badge, Button, Card, CodeBlock, CodeTabs, CommandPalette, Icon, IconButton, Input, Kbd, Sheet, ThemeToggle, UIProvider,
  cn, useHotkey, type Command,
} from '../../src/lib'
import data from '../generated/items.json'
import demos from '../generated/demos.json'

type Prop = { name: string; type: string; required: boolean; default: string | null; doc: string }
type Api = { name: string; kind: 'component' | 'hook' | 'function' | 'value'; doc: string; props?: Prop[]; inherited?: number; inheritedFrom?: string[]; signature?: string }
type Item = {
  name: string; title: string; type: string; description: string; area: string; module?: string; exports: string[]; embeds: string[]
  dependencies: string[]; requires: string[]; bytes: number; tokens: number; file: string; packageFile: string | null; api: Api[]
}
type Demo = { section: string; file: string; exportName: string; titles: string[] }

const ITEMS = data.items as Item[]
const AREAS = (data.areas as [string, string][]).filter(([id]) => ITEMS.some(i => i.area === id))
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

export function App() {
  return (
    <UIProvider>
      <Docs />
    </UIProvider>
  )
}

function Docs() {
  const route = useRoute()
  const [menu, setMenu] = useState(false)
  const [search, setSearch] = useState(false)
  useHotkey('mod+k', e => { e.preventDefault(); setSearch(true) })
  const item = route.startsWith('c/') ? BY_NAME.get(route.slice(2)) : undefined
  useEffect(() => { document.title = item ? `${item.title} · @lyndon/ui docs` : '@lyndon/ui docs' }, [item])
  const commands = useMemo<Command[]>(() => ITEMS.map(i => ({
    id: i.name, label: i.title, group: AREAS.find(([a]) => a === i.area)?.[1], hint: `~${tok(i.tokens)} tokens`,
    keywords: [i.name, ...i.exports], run: () => go(i.name),
  })), [])
  return (
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
  )
}

function Sidebar({ current }: { current?: string }) {
  const [q, setQ] = useState('')
  const match = (i: Item) => {
    const s = q.trim().toLowerCase()
    return !s || `${i.name} ${i.title} ${i.exports.join(' ')} ${i.description}`.toLowerCase().includes(s)
  }
  return (
    <nav aria-label="Components" className="flex flex-col gap-5">
      <Input type="search" placeholder="Filter…" aria-label="Filter components" value={q} onChange={e => setQ(e.target.value)} />
      <a href="#/" className={cn('rounded-[var(--r-md)] px-2 py-1.5 text-[13px] no-underline', !current ? 'bg-[var(--muted)] font-medium text-[var(--fg)]' : 'text-[var(--fg2)] hover:text-[var(--fg)]')}>Introduction</a>
      {AREAS.map(([id, label]) => {
        const list = ITEMS.filter(i => i.area === id && match(i))
        if (!list.length) return null
        return (
          <div key={id}>
            <h2 className="m-0 mb-1 px-2 text-[11px] font-semibold tracking-wide text-[var(--fg3)] uppercase">{label}</h2>
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
    </nav>
  )
}

function Home() {
  const sorted = [...ITEMS].sort((a, b) => a.tokens - b.tokens)
  const median = sorted[Math.floor(sorted.length / 2)]
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
      <Section title="Browse">
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
  const importLine = `import { ${(components.length ? components : item.exports).slice(0, 6).join(', ')} } from '@lyndon/ui'`
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
          <dt className="text-[var(--fg3)]">Exports</dt><dd className="m-0 font-[family-name:var(--mono)] text-xs">{item.exports.join(', ')}</dd>
          {item.embeds.length > 0 && <><dt className="text-[var(--fg3)]">Embeds</dt><dd className="m-0 text-xs">{item.embeds.map((e, i) => {
            const target = ITEMS.find(x => x.exports.includes(e))
            return <span key={e}>{i > 0 && ', '}{target ? <a href={`#/c/${target.name}`}>{e}</a> : e}</span>
          })}</dd></>}
          <dt className="text-[var(--fg3)]">Source</dt><dd className="m-0"><a href={`${REPO}/blob/main/src/lib/${item.module ?? 'core'}.tsx`}>src/lib/{item.module ?? 'core'}.tsx</a></dd>
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
  const key = `${demo.file}:${demo.exportName}`
  if (!lazyCache.has(key)) lazyCache.set(key, lazySection(demo.file, demo.exportName))
  const sectionDemo = lazyCache.get(key)! // cached per section, so it is the same component on every render
  const sel = demo.titles.map(t => `:not([data-spec="${t.replace(/["\\]/g, '\\$&')}"])`).join('')
  return (
    <div className="docs-demo">
      <style>{`.docs-demo [data-spec]${sel}{display:none}`}</style>
      <Suspense fallback={<Card className="h-40 animate-pulse" />}>
        {createElement(sectionDemo)}
      </Suspense>
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
