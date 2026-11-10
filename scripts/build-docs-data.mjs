// Generates the data the docs site (docs/) renders, into docs/generated/ (shapes: scripts/docs-data.d.mts):
//
//   items.json   one entry per registry item (dist-registry/index.json: run scripts/build-registry.mjs first), with
//                its tier, family and import path (scripts/tiers.mjs), kind, area and tags (src/showcase/tags.ts), its
//                source file, and for every exported component a props table extracted from the TypeScript types:
//                name, type, required, default (from the parameter's destructuring) and JSDoc. Props inherited from
//                React's DOM attribute types are counted, not listed. Hooks and helpers get their signature.
//   demos.json   which showcase cards (src/showcase/*Section.tsx <Spec title>) demonstrate each item (TAG_CARDS in
//                src/showcase/tags.ts names them; items no card names fall back to the cards that use their components),
//                so a docs page can mount that section and show only those cards
//
// Fails when a TAG_CARDS title matches no showcase card, or when an item gets no demo and isn't in NO_DEMO.
// Uses the TypeScript 7 API (typescript/unstable/sync) over tsconfig.app.json.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { analyze } from './registry/analyze.mjs'
import { apiOfDecl } from './registry/api.mjs'
import { pkg } from './registry/stamp.mjs'
import { requireBuilt, root } from './paths.mjs'
import { docsDemos, showcaseSections } from './showcase-sections.ts'
import { TAGS, TAG_CARDS } from '../src/showcase/tags.ts'
import { EXTRAS } from './tiers.mjs'

/** Items with no showcase card yet: their pages say so. Every other item must resolve to a demo. */
const NO_DEMO = new Set([
  'ai-renderers-provider', 'appearance-menu', 'appearance-panel', 'approval-card', 'card', 'chat-card', 'chat-checklist',
  'chevron', 'chip', 'code-copy', 'code-frame', 'collapse', 'date-time-field', 'hooks', 'match-text', 'menu-list', 'part-button', 'ring', 'scroll-edges', 'shimmer-text', 'sort-header', 'streaming-text',
  'theme-export-panel', 'theme-preview', 'theme-toggle', 'tool-call', 'tool-card', 'track-grid', 'typing-dots', 'ui-hosts', 'ui-provider', 'virtual-list', 'viz-tip',
])

const outDir = join(root, 'docs/generated')
const t0 = Date.now()
const index = JSON.parse(readFileSync(requireBuilt('dist-registry/index.json', 'pnpm build:registry'), 'utf8'))

// the areas of the tag vocabulary, in its order: the docs sidebar groups by them
const AREAS = TAGS.filter(t => t.facet === 'area').map(t => [t.id, t.label])
// source links point at the commit the registry was built from
const repo = pkg.homepage.replace(/#readme$/, '')
const ref = (index.commit ?? '').replace(/\+dirty$/, '') || 'main'

const graph = analyze(root)
let items
try {
  const fileOf = new Map(graph.modules.map(m => [m.name, relative(root, m.file).split(sep).join('/')]))
  items = index.items.map(e => {
    const home = graph.decls.get(e.exports[0])?.module ?? null
    return {
      name: e.name, title: e.title, type: e.type, description: e.description, tier: e.tier, family: e.family, import: e.import, kind: e.kind, area: e.area, tags: e.tags,
      module: home, sourcePath: (home && fileOf.get(home)) ?? null,
      exports: e.exports, embeds: e.embeds, dependencies: e.dependencies, requires: e.requires,
      bytes: e.bytes, tokens: e.tokens, file: e.file, packageFile: e.packageFile ?? null,
      api: e.exports.map(n => apiOfDecl(graph, n)).filter(Boolean),
    }
  })
} finally {
  graph.close()
}

const { demos, unknownCards } = docsDemos(items, showcaseSections(root), TAG_CARDS)
const named = new Set(Object.values(TAG_CARDS).flatMap(c => c.items))
const problems = [
  ...unknownCards.map(t => `TAG_CARDS card "${t}" is not a <Spec title> in any src/showcase/*Section.tsx`),
  ...items.filter(i => !demos[i.name] && !NO_DEMO.has(i.name)).map(i => `${i.name}: resolves to no showcase card (add one, name it in TAG_CARDS, or list the item in NO_DEMO)`),
  ...[...NO_DEMO].filter(n => demos[n] || !items.some(i => i.name === n)).map(n => `NO_DEMO lists ${n}, which ${demos[n] ? 'has a demo now' : 'is not a registry item'}`),
  ...[...named].filter(n => !items.some(i => i.name === n)).map(n => `TAG_CARDS names ${n}, which is not a registry item`),
]
if (problems.length) throw new Error(`build-docs-data:\n  ${problems.join('\n  ')}`)

mkdirSync(outDir, { recursive: true })
writeFileSync(join(outDir, 'items.json'), JSON.stringify({ version: index.version, repo, ref, areas: AREAS, families: Object.keys(EXTRAS), items }) + '\n')
writeFileSync(join(outDir, 'demos.json'), JSON.stringify(demos, null, 1) + '\n')
const withProps = items.reduce((a, i) => a + i.api.filter(x => x.kind === 'component').length, 0)
console.log(`docs/generated: ${items.length} pages, ${withProps} props tables, ${Object.keys(demos).length} pages with live demos · ${Date.now() - t0} ms`)
