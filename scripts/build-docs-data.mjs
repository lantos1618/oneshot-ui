// Generates the data the docs site (docs/) renders, into docs/generated/:
//
//   items.json   one entry per registry item (dist-registry/index.json: run scripts/build-registry.mjs first), with
//                its area, and for every exported component a props table extracted from the TypeScript types:
//                name, type, required, default (from the parameter's destructuring) and JSDoc. Props inherited from
//                React's DOM attribute types are counted, not listed. Hooks and helpers get their signature.
//   demos.json   which showcase cards (src/showcase/*Section.tsx <Spec title>) use each item's components, so a docs
//                page can mount that section and show only those cards
//
// Uses the TypeScript 7 API (typescript/unstable/sync) over tsconfig.app.json.
import { readFileSync, writeFileSync, mkdirSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { SymbolFlags } from 'typescript/unstable/sync'
import { SyntaxKind } from 'typescript/unstable/ast'
import { analyze } from './registry/analyze.mjs'
import { isComponentName } from './registry/items.mjs'

const root = new URL('..', import.meta.url).pathname
const outDir = join(root, 'docs/generated')
const t0 = Date.now()
const index = JSON.parse(readFileSync(join(root, 'dist-registry/index.json'), 'utf8'))

const AREAS = [
  ['foundation', 'Foundation'], ['primitives', 'Primitives'], ['forms', 'Forms and inputs'], ['overlays', 'Overlays'], ['navigation', 'Navigation'],
  ['feedback', 'Feedback'], ['data', 'Data display'], ['layout', 'Layout'], ['content', 'Editors and content'], ['media', 'Media'],
  ['charts', 'Charts'], ['diagrams', 'Diagrams and maps'], ['ai', 'AI'], ['collab', 'Collaboration'], ['theming', 'Theming'], ['blocks', 'Blocks and pages'],
]
const AREA_OF_MODULE = {
  core: 'primitives', motion: 'foundation', virtual: 'foundation', provider: 'foundation', overlay: 'overlays', forms: 'forms', formkit: 'forms', fields: 'forms', inputs: 'forms', select: 'forms', pickers: 'forms', upload: 'forms', navigation: 'navigation',
  feedback: 'feedback', data: 'data', datagrid: 'data', layout: 'layout', editor: 'content', scheduler: 'layout', code: 'content', markdown: 'content',
  media: 'media', collab: 'collab', pages: 'blocks', charts: 'charts', diagrams: 'diagrams', gantt: 'diagrams', statechart: 'diagrams', trace: 'diagrams',
  network: 'diagrams', diagramkit: 'diagrams', geo: 'diagrams', aistream: 'ai', ai: 'ai', aichat: 'ai', aiagent: 'ai', appearance: 'theming',
}

const graph = analyze(root, { extraDirs: ['src/blocks'] })
let items
try {
  items = index.items.map(e => {
    const home = graph.decls.get(e.exports[0])?.module
    const area = e.type === 'registry:block' ? 'blocks' : ['ui-provider', 'utils', 'hooks', 'motion', 'virtual-list', 'ai-stream'].includes(e.name) ? (e.name === 'ai-stream' ? 'ai' : 'foundation') : AREA_OF_MODULE[home] ?? 'primitives'
    return {
      name: e.name, title: e.title, type: e.type, description: e.description, area, module: home,
      exports: e.exports, embeds: e.embeds, dependencies: e.dependencies, requires: e.requires,
      bytes: e.bytes, tokens: e.tokens, file: e.file, packageFile: e.packageFile ?? null,
      api: e.exports.map(apiOf).filter(Boolean),
    }
  })
} finally {
  graph.close()
}

function apiOf(name) {
  const d = graph.decls.get(name)
  if (!d || d.isType) return null
  const { checker } = graph
  const fn = functionNode(d.node, name)
  if (isComponentName(name) && fn) {
    const param = fn.parameters?.[0]
    if (!param) return { name, kind: 'component', doc: d.doc, props: [], inherited: 0 }
    const type = checker.getTypeAtLocation(param)
    const all = type ? checker.getPropertiesOfType(type) : []
    const own = all.filter(p => p.declarations.some(x => !x.path.includes('/node_modules/')))
    const types = own.length ? checker.getTypeOfSymbol(own) : []
    const defaults = {}
    if (param.name.kind === SyntaxKind.ObjectBindingPattern) {
      for (const el of param.name.elements) if (el.initializer && !el.dotDotDotToken) defaults[(el.propertyName ?? el.name).text] = el.initializer.getText().replace(/\s+/g, ' ')
    }
    const props = own.map((p, i) => {
      const optional = !!(p.flags & SymbolFlags.Optional)
      let t = types[i] ? checker.typeToString(types[i], fn) : 'unknown'
      if (optional) t = t.replace(/ \| undefined$/, '').replace(/^undefined \| /, '')
      return { name: p.name, type: t, required: !optional, default: defaults[p.name] ?? null, doc: p.getDocumentationComment(checker).replace(/\s+/g, ' ').trim() }
    })
    // required first, then in declaration order
    props.sort((a, b) => Number(b.required) - Number(a.required))
    const inheritedFrom = [...new Set(all.filter(p => !own.includes(p)).flatMap(p => p.declarations.map(x => x.path.match(/@types\/(react|react-dom)/)?.[1] ?? 'lib')))]
    return { name, kind: 'component', doc: d.doc, props, inherited: all.length - own.length, inheritedFrom }
  }
  // hooks, helpers, constants: the type as the checker prints it
  const nameNode = d.node.name ?? d.node.declarationList?.declarations?.find(x => x.name?.text === name)?.name
  const sym = nameNode ? checker.getSymbolAtLocation(nameNode) : null
  const type = sym ? checker.getTypeOfSymbol(sym) : null
  let signature = type ? checker.typeToString(type, d.node) : ''
  if (signature.length > 400) signature = signature.slice(0, 397) + '…'
  return { name, kind: /^use[A-Z]/.test(name) ? 'hook' : fn ? 'function' : 'value', doc: d.doc, signature }
}

/** The function behind a declaration: `function X`, `const X = (…) =>`, `const X = memo(function …)`. */
function functionNode(node, name) {
  if (node.kind === SyntaxKind.FunctionDeclaration) return node
  if (node.kind !== SyntaxKind.VariableStatement) return null
  let init = node.declarationList.declarations.find(x => x.name?.text === name)?.initializer
  while (init && init.kind === SyntaxKind.CallExpression) init = init.arguments?.[0]
  if (init && (init.kind === SyntaxKind.ArrowFunction || init.kind === SyntaxKind.FunctionExpression)) return init
  // Object.assign(DialogConfig, { Root, … }): the props are DialogConfig's
  if (init && init.kind === SyntaxKind.Identifier && init.text !== name) { const d = graph.decls.get(init.text); return d ? functionNode(d.node, init.text) : null }
  return null
}

// ── showcase cards per item ────────────────────────────────────────────────────────────────────────────────────────
const showcase = join(root, 'src/showcase')
const sections = []
for (const f of readdirSync(showcase).filter(f => /Section\.tsx$/.test(f)).sort()) {
  const text = readFileSync(join(showcase, f), 'utf8')
  const id = /<Section\s+id="([\w-]+)"/.exec(text)?.[1]
  const exportName = /export function (\w+Section)\b/.exec(text)?.[1]
  if (!id || !exportName) continue
  // top-level blocks: helper demos (function X / const X =) and the section itself
  const blocks = text.split(/\n(?=(?:export )?(?:function|const) \w)/)
  const helpers = new Map()
  for (const b of blocks) { const n = /^(?:export )?(?:function|const) (\w+)/.exec(b)?.[1]; if (n) helpers.set(n, b) }
  const tagsOf = (src, depth = 0, seen = new Set()) => {
    const tags = new Set([...src.matchAll(/<([A-Z]\w*)/g)].map(m => m[1]))
    for (const m of src.matchAll(/\b([a-z]\w*|[A-Z]\w*)\(/g)) tags.add(m[1]) // hooks and helpers called (useToast(), confetti())
    if (depth < 3) for (const t of [...tags]) if (helpers.has(t) && !seen.has(t)) { seen.add(t); tagsOf(helpers.get(t), depth + 1, seen).forEach(x => tags.add(x)) }
    return tags
  }
  const body = helpers.get(exportName) ?? ''
  const chunks = body.split(/(?=<Spec\b)/).slice(1)
  const specs = chunks.map(c => {
    const title = /<Spec[^>]*?\btitle=(?:"([^"]+)"|\{'([^']+)'\}|\{"([^"]+)"\})/.exec(c)
    return title ? { title: title[1] ?? title[2] ?? title[3], direct: new Set([...c.matchAll(/<([A-Z]\w*)/g)].map(m => m[1])), tags: tagsOf(c) } : null
  }).filter(Boolean)
  sections.push({ id, file: f.replace(/\.tsx$/, ''), exportName, specs })
}
const demos = {}
for (const it of items) {
  const roots = it.exports
  const words = it.title.toLowerCase().split(/\s+/)
  const scored = []
  for (const s of sections) for (const sp of s.specs) {
    let score = 0
    for (const r of roots) { if (sp.direct.has(r)) score += 3; else if (sp.tags.has(r)) score += 1 }
    const t = sp.title.toLowerCase(), own = it.title.toLowerCase()
    if (t === own || t === `${own}s`) score += 12 // a card named after the item wins, even when it calls the API through an alias (toast())
    else if (!score) continue
    else if (words.every(w => t.includes(w))) score += 4
    scored.push({ section: s.id, file: s.file, exportName: s.exportName, title: sp.title, score })
  }
  scored.sort((a, b) => b.score - a.score)
  // one section per page (it is mounted once), and only cards that use the item about as much as the best one does
  const best = scored.filter(x => x.section === scored[0]?.section && x.score * 2 >= scored[0].score).slice(0, 3)
  if (best.length) demos[it.name] = { section: best[0].section, file: best[0].file, exportName: best[0].exportName, titles: best.map(b => b.title) }
}

mkdirSync(outDir, { recursive: true })
writeFileSync(join(outDir, 'items.json'), JSON.stringify({ version: index.version, areas: AREAS, items }) + '\n')
writeFileSync(join(outDir, 'demos.json'), JSON.stringify(demos, null, 1) + '\n')
const withProps = items.reduce((a, i) => a + i.api.filter(x => x.kind === 'component').length, 0)
console.log(`docs/generated: ${items.length} pages, ${withProps} props tables, ${Object.keys(demos).length} pages with live demos · ${Date.now() - t0} ms`)
