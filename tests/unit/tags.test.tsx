// The tag vocabulary (src/showcase/tags.ts): integrity, every showcase card tagged, synonym search, the facet filter,
// the ?tags= URL round trip, card chips as links, and the registry items carrying tags.
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import {
  TAGS, TAG_BY_ID, TAG_CARDS, TAG_FACETS, TAG_ITEM_AREA, TAG_ITEM_TAGS, TAG_MODULE_AREA, type TagId, tagCardTags, tagChipOrder, tagFacetCounts,
  tagFilterMatch, tagNormalize, tagParseUrl, tagRegistryMeta, tagSearchString, tagSuggest, tagTextMatch, tagToggle,
} from '../../src/showcase/tags'
import { Section, ShellContext, Spec, SpecEagerContext, specText } from '../../src/showcase/kit'
import { UIProvider } from '../../src/lib'

const ROOT = join(__dirname, '..', '..')
const SHOWCASE = join(ROOT, 'src/showcase')

/** Every <Spec title="…"> in the section files, with its section id. */
const CARDS_ON_PAGE: [section: string, title: string][] = readdirSync(SHOWCASE).filter(f => /Section\.tsx$/.test(f)).sort().flatMap(f => {
  const text = readFileSync(join(SHOWCASE, f), 'utf8')
  const id = /<Section\s+id="([\w-]+)"/.exec(text)?.[1] ?? f
  return [...text.matchAll(/<Spec\b[^>]*?\btitle="([^"]+)"/gs)].map(m => [id, m[1]] as [string, string])
})
const entry = (title: string, section = '') => {
  const c = TAG_CARDS[title]
  return { text: specText(title, '', section, c.items), tags: tagCardTags(c), aka: c.aka }
}
/** Card titles a query finds (text only, no tags selected). */
const find = (q: string) => Object.keys(TAG_CARDS).filter(t => tagTextMatch(entry(t), q))

describe('tag vocabulary', () => {
  it('has unique kebab-case ids, known facets, labels, descriptions and synonyms', () => {
    const ids = TAGS.map(t => t.id)
    expect(new Set(ids).size, 'duplicate tag ids').toBe(ids.length)
    const facets = new Set(TAG_FACETS.map(f => f.id))
    for (const t of TAGS) {
      expect(t.id, 'ids are lowercase kebab-case (they go in URLs)').toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/)
      expect(facets.has(t.facet), `${t.id}: facet ${t.facet}`).toBe(true)
      expect(t.label.trim(), `${t.id}: label`).not.toBe('')
      expect(t.desc.length, `${t.id}: description`).toBeGreaterThan(10)
      expect(new Set(t.synonyms.map(s => s.toLowerCase())).size, `${t.id}: duplicate synonyms`).toBe(t.synonyms.length)
    }
    const labels = TAGS.map(t => t.label.toLowerCase())
    expect(new Set(labels).size, 'duplicate labels').toBe(labels.length)
    for (const f of TAG_FACETS) expect(TAGS.some(t => t.facet === f.id), `facet ${f.id} has tags`).toBe(true)
  })

  it('keeps one spelling per idea within a facet (no plural twins such as "chart" and "charts")', () => {
    for (const f of TAG_FACETS) {
      const words = TAGS.filter(t => t.facet === f.id).map(t => t.label.toLowerCase())
      for (const w of words) expect(words.includes(`${w}s`), `${f.id}: "${w}" and "${w}s" are both labels`).toBe(false)
    }
  })
})

describe('showcase cards', () => {
  it('tags every card on the page, and lists no card that is gone', () => {
    expect(CARDS_ON_PAGE.length, 'the scan of the section files found the cards').toBeGreaterThan(150)
    const onPage = new Set(CARDS_ON_PAGE.map(([, t]) => t))
    expect(CARDS_ON_PAGE.map(([, t]) => t).filter(t => !TAG_CARDS[t]), 'cards without an entry in TAG_CARDS (src/showcase/tags.ts)').toEqual([])
    expect(Object.keys(TAG_CARDS).filter(t => !onPage.has(t)), 'stale TAG_CARDS entries (no such <Spec title>)').toEqual([])
    expect(new Set(CARDS_ON_PAGE.map(([, t]) => t)).size, 'two cards share a title').toBe(CARDS_ON_PAGE.length)
  })

  it('gives each card a kind, 3–6 known tags with at least one area, and the registry items it shows', () => {
    for (const [title, c] of Object.entries(TAG_CARDS)) {
      expect(TAG_BY_ID[c.kind]?.facet, `${title}: kind ${c.kind}`).toBe('kind')
      expect(c.tags.length, `${title}: ${c.tags.length} tags`).toBeGreaterThanOrEqual(3)
      expect(c.tags.length, `${title}: ${c.tags.length} tags`).toBeLessThanOrEqual(6)
      for (const t of c.tags) {
        expect(TAG_BY_ID[t], `${title}: unknown tag ${t}`).toBeDefined()
        expect(TAG_BY_ID[t].facet, `${title}: ${t} is a kind (use the kind field)`).not.toBe('kind')
      }
      expect(new Set(c.tags).size, `${title}: duplicate tags`).toBe(c.tags.length)
      expect(c.tags.some(t => TAG_BY_ID[t].facet === 'area'), `${title}: no area tag`).toBe(true)
      expect(c.items.length, `${title}: no registry item`).toBeGreaterThan(0)
    }
  })

  it('uses every tag on at least one card', () => {
    const used = new Set(Object.values(TAG_CARDS).flatMap(tagCardTags))
    expect(TAGS.filter(t => !used.has(t.id)).map(t => t.id), 'tags no card carries').toEqual([])
  })

  // reads the built registry (pnpm build:registry): reported as skipped, not passed, until one is built
  const index = join(ROOT, 'dist-registry/index.json')
  it.skipIf(!existsSync(index))('names only registry items that exist', () => {
    const names = new Set((JSON.parse(readFileSync(index, 'utf8')) as { items: { name: string }[] }).items.map(e => e.name))
    const missing = Object.entries(TAG_CARDS).flatMap(([title, c]) => c.items.filter(i => !names.has(i)).map(i => `${title}: ${i}`))
    expect(missing).toEqual([])
    for (const n of [...Object.keys(TAG_ITEM_AREA), ...Object.keys(TAG_ITEM_TAGS)]) expect(names.has(n), `override for unknown item ${n}`).toBe(true)
  })
})

describe('search', () => {
  it('matches synonyms and aliases', () => {
    expect(find('dropdown')).toContain('Select')
    expect(find('autocomplete')).toContain('Combobox')
    expect(find('DAG')).toContain('Graphs as rows')
    expect(find('lane graph')).toContain('Graphs as rows')
    expect(find('virtualized')).toContain('Data grid · 50k rows') // US spelling of the Virtualised tag
    expect(find('color')).toContain('Colour picker')
    expect(find('drawer')).toContain('Sheet / drawer')
    expect(find('snackbar')).toContain('Toasts')
    expect(find('time zone')).toContain('Typed dates') // the formatting tag's synonym
  })

  it('needs every word, matches word starts and plurals, and ignores case and accents', () => {
    expect(find('charts')).toContain('Bar')
    expect(find('chart')).toContain('Bar')
    expect(find('DATA GRID server')).toEqual(['Data grid · server mode'])
    expect(find('combobox')).not.toContain('Select')
    expect(find('ai')).not.toContain('Data grid') // "ai" no longer matches inside "detail" or "maintain"
    expect(find('zzqx')).toEqual([])
    expect(find('  ')).toHaveLength(Object.keys(TAG_CARDS).length)
    expect(find('Sélect')).toContain('Select') // accents in the query are folded
    expect(find('colöur pïcker')).toContain('Colour picker')
  })

  it('suggests a tag when the query is its name or a synonym', () => {
    expect(tagSuggest('streaming')).toEqual(['streaming'])
    expect(tagSuggest('virtualized')).toEqual(['virtualised'])
    expect(tagSuggest('dropdown')).toEqual([])
  })
})

describe('facet filter', () => {
  const titles = (sel: TagId[]) => Object.keys(TAG_CARDS).filter(t => tagFilterMatch(tagCardTags(TAG_CARDS[t]), sel))
  it('ORs tags within a facet and ANDs across facets', () => {
    const inputs = titles(['inputs']), forms = titles(['forms']), either = titles(['inputs', 'forms'])
    expect(either.length).toBeGreaterThan(Math.max(inputs.length, forms.length))
    expect(either.every(t => inputs.includes(t) || forms.includes(t))).toBe(true)
    const both = titles(['charts', 'keyboard'])
    expect(both.length).toBeGreaterThan(0)
    expect(both.every(t => TAG_CARDS[t].tags.includes('charts') && TAG_CARDS[t].tags.includes('keyboard'))).toBe(true)
    expect(titles([])).toHaveLength(Object.keys(TAG_CARDS).length)
    expect(titles(['chart'])).toContain('Bar') // kinds filter too
  })

  it('counts what each chip would add', () => {
    const entries = Object.keys(TAG_CARDS).map(t => entry(t))
    const none = tagFacetCounts(entries, '', [])
    expect(none.charts).toBe(titles(['charts']).length)
    const picked = tagFacetCounts(entries, '', ['charts'])
    expect(picked.charts, 'a picked chip keeps its own count').toBe(none.charts)
    expect(picked.inputs, 'another area chip counts as if added (OR)').toBe(none.inputs)
    expect(picked.keyboard, 'another facet counts within the selection (AND)').toBe(titles(['charts', 'keyboard']).length)
    expect(tagFacetCounts(entries, 'dropdown', []).inputs).toBe(find('dropdown').filter(t => TAG_CARDS[t].tags.includes('inputs')).length)
  })

  it('toggles and normalises selections', () => {
    expect(tagToggle([], 'keyboard')).toEqual(['keyboard'])
    expect(tagToggle(['keyboard', 'charts'], 'keyboard')).toEqual(['charts'])
    expect(tagNormalize(['keyboard', 'nope', 'charts', 'charts', 'search'])).toEqual(['charts', 'search', 'keyboard']) // facet order: area, use, capability
  })
})

describe('URL', () => {
  it('round-trips tags and query, keeping other parameters', () => {
    const s = tagSearchString('?theme=dark', ['keyboard', 'charts'], 'date picker')
    expect(s).toBe('?theme=dark&tags=charts,keyboard&q=date+picker')
    expect(tagParseUrl(s)).toEqual({ tags: ['charts', 'keyboard'], q: 'date picker' })
    expect(new URLSearchParams(s).get('theme')).toBe('dark')
  })
  it('drops unknown tags and writes nothing for an empty filter', () => {
    expect(tagParseUrl('?tags=charts,bogus,,KEYBOARD').tags).toEqual(['charts'])
    expect(tagSearchString('?tags=charts&q=x', [], ' ')).toBe('')
    expect(tagParseUrl('')).toEqual({ tags: [], q: '' })
  })
})

describe('card chips', () => {
  const card = (shell?: Partial<React.ContextType<typeof ShellContext>>) => render(
    <UIProvider>
      <ShellContext.Provider value={{ query: '', tags: [], setQuery: () => {}, focusFilter: () => {}, ...shell }}>
        <SpecEagerContext.Provider value>
          <Section id="inputs" title="Inputs" desc="Demo"><Spec title="Select" desc="One of many"><span>demo</span></Spec></Section>
        </SpecEagerContext.Provider>
      </ShellContext.Provider>
    </UIProvider>,
  )

  it('link each chip to its tag filter, in one Tab stop', () => {
    card()
    const bar = screen.getByRole('toolbar', { name: /Select/ })
    const links = within(bar).getAllByRole('link')
    expect(links.map(a => a.getAttribute('href'))).toEqual(tagChipOrder(TAG_CARDS.Select.tags).slice(0, 4).map(t => `?tags=${t}`))
    expect(links.filter(a => a.tabIndex === 0)).toHaveLength(1)
    expect(links[0]).toHaveAccessibleName(`Show components tagged ${TAG_BY_ID[tagChipOrder(TAG_CARDS.Select.tags)[0]].label}`)
  })

  it('filter the page in place when the shell handles picks, and hide cards that don\'t match', () => {
    const picked: TagId[] = []
    const { unmount } = card({ pickTag: id => picked.push(id) })
    within(screen.getByRole('toolbar', { name: /Select/ })).getAllByRole('link')[0].click()
    expect(picked).toEqual([tagChipOrder(TAG_CARDS.Select.tags)[0]])
    unmount()
    // jsdom has no stylesheet: stand in the page's rule for the utility that hides a card (Tailwind's `hidden`)
    const css = document.head.appendChild(document.createElement('style'))
    css.textContent = '.hidden { display: none }'
    try {
      const other = card({ tags: ['charts'] })
      expect(screen.queryByRole('heading', { name: 'Select' }), 'a card the filter excludes is hidden').toBeNull()
      expect(screen.getByRole('heading', { name: 'Select', hidden: true })).not.toBeVisible()
      other.unmount()
      card({ tags: [TAG_CARDS.Select.tags[0]] })
      expect(screen.getByRole('heading', { name: 'Select' })).toBeVisible()
    } finally { css.remove() }
  })
})

describe('registry items', () => {
  it('get a kind, an area and tags from the vocabulary', () => {
    for (const [mod, area] of Object.entries(TAG_MODULE_AREA)) expect(TAG_BY_ID[area]?.facet, `module ${mod}`).toBe('area')
    const m = tagRegistryMeta({ name: 'data-grid', type: 'registry:ui', module: 'datagrid' })
    expect(m.kind).toBe('component')
    expect(m.area).toBe('data')
    expect(m.tags[0]).toBe('data')
    expect(m.tags).toEqual(expect.arrayContaining(['virtualised', 'server-mode', 'filtering']))
    expect(tagRegistryMeta({ name: 'hooks', type: 'registry:hook', module: 'hooks' }).kind).toBe('hook')
    expect(tagRegistryMeta({ name: 'pricing-table', type: 'registry:block', module: 'pricing-table' })).toMatchObject({ kind: 'block', area: 'pages' })
    expect(tagRegistryMeta({ name: 'gauge', type: 'registry:ui', module: 'charts' }).kind).toBe('chart')
  })

  // reads the built registry: reported as skipped, not passed, until `pnpm build` has made one
  const REGISTRY = join(ROOT, 'dist-registry')
  it.skipIf(!existsSync(join(REGISTRY, 'index.json')))('carry them in dist-registry/index.json and the shadcn items', () => {
    const dir = REGISTRY
    const index = JSON.parse(readFileSync(join(dir, 'index.json'), 'utf8')) as { vocabulary: { tags: { id: string }[] }; items: { name: string; kind: string; area: string; tags: string[] }[] }
    expect(index.vocabulary.tags.map(t => t.id)).toEqual(TAGS.map(t => t.id))
    for (const e of index.items) {
      expect(TAG_BY_ID[e.kind as TagId]?.facet, `${e.name}: kind`).toBe('kind')
      expect(TAG_BY_ID[e.area as TagId]?.facet, `${e.name}: area`).toBe('area')
      expect(e.tags[0], `${e.name}: tags start with the area`).toBe(e.area)
      for (const t of e.tags) expect(TAG_BY_ID[t as TagId], `${e.name}: unknown tag ${t}`).toBeDefined()
    }
    const r = JSON.parse(readFileSync(join(dir, 'r/data-grid.json'), 'utf8')) as { meta: { kind: string; area: string; tags: string[] } }
    expect(r.meta).toMatchObject({ kind: 'component', area: 'data' })
    expect(r.meta.tags).toContain('virtualised')
  })
})
