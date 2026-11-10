// Builds the component registry from src/lib (and src/blocks) into dist-registry/:
//
//   dist-registry/files/<name>.tsx          one self-contained drop-in per component (or small family): the
//                                           component plus exactly the library helpers it needs (the transitive
//                                           closure of top-level declarations, in source order); imports only
//                                           react and react-dom (extras, and blocks that animate with it, also motion)
//   dist-registry/files/<name>.package.tsx  blocks only: the block as written, importing from '@lyndon/ui'
//   dist-registry/index.json                name, title, description, tier, family, import, kind, area, tags, exports, embedded
//                                           components, npm dependencies, bytes, approximate tokens (bytes / 3.6),
//                                           sha256; plus the tag vocabulary (src/showcase/tags.ts)
//   dist-registry/r/<name>.json             shadcn registry items (`npx shadcn add <base>/r/<name>.json`)
//   dist-registry/r/registry.json           shadcn registry index; r/tokens.json carries the token CSS
//   llms.txt, llms-full.txt                 (repo root) index for AI tools, built from index.json
//
// Usage: node scripts/build-registry.mjs   (REGISTRY_BASE_URL overrides where r/*.json say the registry is hosted)
//
// The dependency graph comes from the TypeScript 7 API over tsconfig.app.json (scripts/registry/analyze.mjs).
// Contexts created at the top level are made shared across files (see uiSharedContext below), so a <UIProvider> from
// ui-provider.tsx reaches the components in every other drop-in file. Other module state (toast queue, modal stack,
// scroll lock, focus traps, icon registry) is shared in the source itself through uiShared() (src/lib/shared.tsx).
// To keep the files small: ICONS keeps only the icons a file draws (the rest resolve through the page-wide icon
// registry; icon.tsx has them all), and embedded helpers keep only a one-sentence summary of their docs
// (scripts/registry/diet.mjs; the item's own exports keep theirs).
import { readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { assertProvenance, commit, dirty, header, pkg, sha256 } from './registry/stamp.mjs'
import { analyze, closure } from './registry/analyze.mjs'
import { isComponentDecl } from './registry/api.mjs'
import { dietPart } from './registry/diet.mjs'
import { FAMILIES, BLOCKS, EXCLUDE, kebab, humanize, isComponentName } from './registry/items.mjs'
import { libFiles, requireBuilt, root, warnOrFail } from './paths.mjs'
import { EXTRAS, assertPlaced, familyOf, importOf, tierOf } from './tiers.mjs'
// the tag vocabulary shared with the showcase and the docs (a .ts file: Node strips its types)
import { TAGS, TAG_FACETS, TAG_BY_ID, tagRegistryMeta } from '../src/showcase/tags.ts'

const out = join(root, 'dist-registry')
const repo = pkg.homepage.replace(/#readme$/, '')
const BASE = (process.env.REGISTRY_BASE_URL ?? 'https://lantos1618.github.io/oneshot-ui').replace(/\/$/, '')
const minor = pkg.version.split('.').slice(0, 2).join('.')
const t0 = Date.now()

const tokensOf = bytes => Math.round(bytes / 3.6)
const warn = msg => warnOrFail('build-registry', msg)

function build() {
  const { decls, modules } = graph
  const itemClosure = it => closure(graph, it.roots, rank)

  // modules in dependency order (imports first), so top-level code runs after what it uses
  const byName = new Map(modules.map((m, i) => [m.name, i]))
  const rank = new Array(modules.length)
  let next = 0
  const visit = (i, stack = new Set()) => {
    if (rank[i] !== undefined || stack.has(i)) return
    stack.add(i)
    // imports, and the modules a barrel (core, forms) re-exports: `import { cn } from './core'` needs helpers.tsx first
    for (const dep of [...modules[i].relImports, ...modules[i].reexports.map(r => r.from)]) { const j = byName.get(dep); if (j !== undefined && modules[j].dir === 'lib') visit(j, stack) }
    rank[i] = next++
  }
  ;['core', ...modules.map(m => m.name)].forEach(n => visit(byName.get(n)))

  // ── items ────────────────────────────────────────────────────────────────────────────────────────────────────────
  const items = []
  const claimed = new Set(EXCLUDE)
  const exists = n => decls.has(n)
  for (const [name, fam] of Object.entries(FAMILIES)) {
    const roots = fam.roots.filter(n => { const ok = exists(n) && !BLOCKS.includes(n); if (!ok && !BLOCKS.includes(n)) warn(`${name}: ${n} is not a top-level library name; skipped`); return ok })
    if (!roots.length) { warn(`${name}: no roots left; item skipped`); continue }
    roots.forEach(r => claimed.add(r))
    items.push({ name, title: fam.title ?? humanize(roots[0]), type: fam.type ?? 'registry:ui', roots, description: fam.description })
  }
  for (const n of BLOCKS) {
    if (!exists(n)) { warn(`block ${n} not found`); continue }
    claimed.add(n)
    items.push({ name: kebab(n), title: humanize(n), type: 'registry:block', roots: [n] })
  }
  const autos = []
  for (const d of decls.values()) {
    if (d.dir === 'lib' && graph.publicNames.has(d.name) && !claimed.has(d.name) && isComponentDecl(graph, d)) autos.push(d.name)
  }
  // composable parts join their component's item: DialogRoot, DialogContent → dialog; AlertDialogAction → alert-dialog
  const hosts = new Map(items.flatMap(it => it.roots.filter(isComponentName).map(r => [r, it])))
  const hostNames = [...hosts.keys(), ...autos]
  const partOf = n => { const h = partSuffix(n, hostNames); return h && PART.test(h.suffix) ? h.prefix : null }
  for (const n of autos) if (!partOf(n)) { const it = { name: kebab(n), title: humanize(n), type: 'registry:ui', roots: [n] }; items.push(it); hosts.set(n, it) }
  for (const n of autos) {
    const host = partOf(n)
    if (!host) continue
    let it = hosts.get(host), up = host
    while (!it && (up = partOf(up))) it = hosts.get(up) // a part of a part
    if (it) { if (!it.roots.includes(n)) it.roots.push(n) }
    else { const own = { name: kebab(n), title: humanize(n), type: 'registry:ui', roots: [n] }; items.push(own); hosts.set(n, own) }
  }
  const seenNames = new Set()
  for (const it of items) { if (seenNames.has(it.name)) throw new Error(`duplicate item name ${it.name}`); seenNames.add(it.name) }
  items.sort((a, b) => a.name.localeCompare(b.name))
  const componentRoots = new Set(items.filter(i => i.type !== 'registry:lib' && i.type !== 'registry:hook').flatMap(i => i.roots.filter(isComponentName)))
  const itemOfRoot = new Map(items.flatMap(i => i.roots.map(r => [r, i.name])))

  // ── files ────────────────────────────────────────────────────────────────────────────────────────────────────────
  rmSync(out, { recursive: true, force: true })
  mkdirSync(join(out, 'files'), { recursive: true })
  mkdirSync(join(out, 'r'), { recursive: true })
  const index = []
  for (const it of items) {
    const c = itemClosure(it)
    const first = decls.get(it.roots[0])
    const description = it.description ?? (first.doc || `${it.title} from @lyndon/ui.`)
    const embeds = [...c.names].filter(n => componentRoots.has(n) && !it.roots.includes(n) && decls.get(n).exported).sort()
    // the item's own exports (and their props types) keep their docs; embedded helpers go on a comment diet (registry/diet.mjs)
    const ownDocs = new Set(it.roots.flatMap(r => [r, `${r}Props`]))
    c.parts = c.parts.map(p => (p.names?.length && !p.names.some(n => ownDocs.has(n)) ? { ...p, text: dietPart(p.text) } : p))
    const { body, deps, icons } = renderBody(c, { allIcons: it.roots.includes('ICONS') })
    // takes icon names from its props (IconButton icon="…", EmptyState icon=…): the names it doesn't draw itself need icon.tsx
    const iconProps = icons && icons.kept < icons.total && c.names.has('isIconName')
    const needsProvider = it.type !== 'registry:lib' && it.type !== 'registry:hook' && it.name !== 'ui-provider'
    const text = stamp(it.name, body)
    writeFileSync(join(out, 'files', `${it.name}.tsx`), text)
    const bytes = Buffer.byteLength(text)
    const entry = {
      name: it.name, type: it.type, title: it.title, description, module: first.module,
      ...(first.dir === 'lib' ? { tier: tierOf(first.module), family: familyOf(first.module), import: importOf(first.module) } : { tier: 'block', family: null, import: null }),
      ...tagRegistryMeta({ name: it.name, type: it.type, module: first.module }),
      file: `files/${it.name}.tsx`, exports: it.roots, embeds,
      embedsItems: [...new Set(embeds.map(e => itemOfRoot.get(e)).filter(Boolean))].sort(),
      dependencies: deps, modules: [...new Set([...c.names].map(n => decls.get(n).module))].sort(),
      requires: needsProvider ? ['ui-provider'] : [],
      ...(iconProps ? { suggests: ['icon'] } : {}),
      ...(icons ? { icons: { embedded: icons.kept, of: icons.total } } : {}),
      bytes, tokens: tokensOf(bytes), declarations: c.names.size, sha256: sha256(text),
    }
    if (it.type === 'registry:block' && first.dir === 'extra') {
      const mod = modules.find(m => m.name === first.module)
      const src = readFileSync(mod.file, 'utf8').replace(/(from\s+['"])\.\.\/lib(\/[\w-]+)?(['"])/g, (_, a, sub = '', z) => {
        if (sub && !pkg.exports[`.${sub}`]) throw new Error(`block ${it.name} imports ../lib${sub}, which package.json doesn't export`)
        return `${a}@lyndon/ui${sub}${z}`
      })
      const ptext = stamp(it.name, src.replace(/^'use client'\n?/, ''))
      writeFileSync(join(out, 'files', `${it.name}.package.tsx`), ptext)
      entry.packageFile = `files/${it.name}.package.tsx`
      entry.packageBytes = Buffer.byteLength(ptext)
      entry.packageTokens = tokensOf(entry.packageBytes)
    }
    index.push(entry)
  }

  // ── shadcn registry ──────────────────────────────────────────────────────────────────────────────────────────────
  const tokensCss = readFileSync(requireBuilt('dist/tokens.css', 'pnpm build:css'), 'utf8')
  const shadcnItem = (e, { content, file, deps, name = e.name, standalone = true }) => ({
    $schema: 'https://ui.shadcn.com/schema/registry-item.json',
    name, type: e.type, title: e.title, description: e.description,
    author: pkg.author,
    dependencies: deps,
    registryDependencies: e.requires.includes('ui-provider') && standalone ? [`${BASE}/r/ui-provider.json`] : [],
    files: [{ path: `registry/lyndon-ui/${file}`, type: e.type === 'registry:block' ? 'registry:component' : e.type, content }],
    docs: e.requires.includes('ui-provider')
      ? `Render inside <UIProvider> once (${standalone ? 'added as ui-provider' : "import { UIProvider } from '@lyndon/ui'"}): it injects the theme tokens (--bg, --card, --fg, --accent …) the classes use, hosts toasts and handles reduced motion. For a CSP without inline styles add ${BASE}/r/tokens.json (or import '@lyndon/ui/tokens.css') and render <UIProvider injectStyles={false}>. Tailwind v4 must scan the file (it does for files under src/).`
      : undefined,
    categories: [e.modules.find(m => m !== 'core') ?? 'core'],
    meta: {
      package: `${pkg.name}@${pkg.version}`, source: repo, kind: e.kind, area: e.area, tags: e.tags, exports: e.exports, embeds: e.embeds,
      requires: e.requires.includes('ui-provider') ? 'UIProvider (ui-provider item) or @lyndon/ui/tokens.css with <UIProvider injectStyles={false}>' : undefined,
      tokensCss: '@lyndon/ui/tokens.css', tokensItem: `${BASE}/r/tokens.json`,
      bytes: Buffer.byteLength(content), approxTokens: tokensOf(Buffer.byteLength(content)),
    },
  })
  const registryItems = []
  for (const e of index) {
    const content = readFileSync(join(out, e.file), 'utf8')
    const ext = e.dependencies.filter(d => d !== 'react' && d !== 'react-dom')
    if (e.packageFile) {
      // blocks: the package-importing file is the default; the self-contained one is <name>-standalone
      const pcontent = readFileSync(join(out, e.packageFile), 'utf8')
      const item = shadcnItem(e, { content: pcontent, file: `blocks/${e.name}.tsx`, deps: [pkg.name, ...ext.filter(d => d === 'motion')], standalone: false })
      registryItems.push(item)
      registryItems.push(shadcnItem(e, { content, file: `blocks/${e.name}.tsx`, deps: ext, name: `${e.name}-standalone` }))
    } else registryItems.push(shadcnItem(e, { content, file: `${e.name}.tsx`, deps: ext }))
  }
  registryItems.push({
    $schema: 'https://ui.shadcn.com/schema/registry-item.json',
    name: 'tokens', type: 'registry:theme', title: 'Theme tokens',
    description: 'The CSS variables and base rules UIProvider injects (same as @lyndon/ui/tokens.css), for <UIProvider injectStyles={false}> under a strict CSP. They define --card, --primary, --muted and --accent at :root, which a shadcn/ui theme also uses: in a shadcn project prefer UIProvider target="self".',
    css: cssToObject(tokensCss),
    meta: { package: `${pkg.name}@${pkg.version}`, source: 'dist/tokens.css' },
  })
  for (const item of registryItems) writeFileSync(join(out, 'r', `${item.name}.json`), JSON.stringify(item, null, 2) + '\n')
  const registry = {
    $schema: 'https://ui.shadcn.com/schema/registry.json', name: 'lyndon-ui', homepage: BASE,
    items: registryItems.map(({ $schema: _schema, files, css: _css, ...rest }) => ({ ...rest, files: files?.map(({ content: _content, ...f }) => f) })),
  }
  writeFileSync(join(out, 'r', 'registry.json'), JSON.stringify(registry, null, 2) + '\n')

  const vocabulary = { source: 'src/showcase/tags.ts', facets: TAG_FACETS, tags: TAGS }
  const indexJson = { name: pkg.name, version: pkg.version, commit: commit ? commit + dirty : null, generated: 'scripts/build-registry.mjs', tokensPerByte: 1 / 3.6, vocabulary, items: index }
  writeFileSync(join(out, 'index.json'), JSON.stringify(indexJson, null, 2) + '\n')
  // `cd dist-registry && sha256sum -c SHA256SUMS` checks every drop-in (the files carry no checksum themselves)
  writeFileSync(join(out, 'SHA256SUMS'), index.flatMap(e => [`${e.sha256}  ${e.file}`, ...(e.packageFile ? [`${sha256(readFileSync(join(out, e.packageFile), 'utf8'))}  ${e.packageFile}`] : [])]).join('\n') + '\n')
  writeLlms(index)

  const total = index.reduce((a, e) => a + e.bytes, 0)
  const sorted = [...index].sort((a, b) => a.bytes - b.bytes)
  const med = sorted[Math.floor(sorted.length / 2)]
  console.log(`dist-registry: ${index.length} items (${index.filter(e => e.type === 'registry:block').length} blocks), ${(total / 1024 / 1024).toFixed(2)} MB total, ` +
    `median ${(med.bytes / 1024).toFixed(1)} KB (${med.name}), largest ${(sorted.at(-1).bytes / 1024).toFixed(0)} KB (${sorted.at(-1).name}); ${registryItems.length} shadcn items · ${Date.now() - t0} ms`)
}

// the suffixes that mark a composable part of another component (Dialog + Root, AlertDialog + Action, Tabs + List)
const PART = /^(Root|Trigger|Content|Close|Title|Description|Footer|Header|Action|Cancel|Item|List|Button|Link|Separator|Label|Portal|Overlay|Shortcut|Value|Indicator|Viewport|Panel|Body|Sub|SubTrigger|SubContent)$/
/** The longest other component name that `name` starts with, and the rest: partSuffix('AlertDialogAction', …) → { prefix: 'AlertDialog', suffix: 'Action' }. */
function partSuffix(name, names) {
  let best = null
  for (const p of names) if (p !== name && name.startsWith(p) && /^[A-Z]/.test(name.slice(p.length)) && (!best || p.length > best.prefix.length)) best = { prefix: p, suffix: name.slice(p.length) }
  return best
}

// ── rendering ──────────────────────────────────────────────────────────────────────────────────────────────────────

function renderBody(c, { allIcons = false } = {}) {
  // merge external imports: one statement per module; a name stays `type` only if every use imported it as a type
  const named = new Map(), raw = new Set()
  for (const imp of c.ext) {
    if (imp.kind === 'default') { raw.add(`import ${imp.typeOnly ? 'type ' : ''}${imp.local} from '${imp.from}'`); continue }
    if (imp.kind === 'namespace') { raw.add(`import ${imp.typeOnly ? 'type ' : ''}* as ${imp.local} from '${imp.from}'`); continue }
    if (!named.has(imp.from)) named.set(imp.from, new Map())
    const m = named.get(imp.from), prev = m.get(imp.local)
    if (prev && prev.imported !== imp.imported) throw new Error(`import conflict for ${imp.local}: ${prev.imported} vs ${imp.imported}`)
    m.set(imp.local, { imported: imp.imported, typeOnly: prev ? prev.typeOnly && imp.typeOnly : imp.typeOnly })
  }
  let body = c.parts.map(p => p.text.replace(/^\n+/, '').replace(/\s+$/, '')).join('\n\n')
  body = body.replace(/^export default /m, 'export ')
  // lazily imported library modules (map data): the declarations are in this file, so the import resolves at once
  for (const [m, names] of Object.entries(c.dynImports ?? {})) body = body.replaceAll(new RegExp(`import\\((['"])\\./${m}(\\.tsx?)?\\1\\)`, 'g'), `Promise.resolve({ ${names.join(', ')} })`)
  // drop the big section banners of the source modules (/* ════ 2. UTILITIES ════ */): they describe the module, not this file
  body = body.replace(/^\/\* ═+\n[\s\S]*?═+ \*\/\n+/gm, '')
  let icons = null
  if (!allIcons) ({ body, icons } = pruneIcons(body))
  // contexts: shared through globalThis so several drop-in files see the same provider
  const shared = shareContexts(body)
  if (shared !== body) {
    body = SHARED_HELPER.replace('@VERSION@', minor) + '\n\n' + shared
    if (!named.has('react')) named.set('react', new Map())
    named.get('react').set('createContext', { imported: 'createContext', typeOnly: false })
    named.get('react').set('Context', { imported: 'Context', typeOnly: true })
  }
  const order = f => (f === 'react' ? 0 : f === 'react-dom' ? 1 : f.startsWith('react-dom/') ? 2 : f.startsWith('motion') ? 3 : 4)
  const froms = [...named.keys()].sort((a, b) => order(a) - order(b) || a.localeCompare(b))
  const lines = [...raw, ...froms.map(f => {
    const specs = [...named.get(f)].sort(([a], [b]) => a.localeCompare(b))
      .map(([local, { imported, typeOnly }]) => `${typeOnly ? 'type ' : ''}${imported === local ? local : `${imported} as ${local}`}`)
    return `import { ${specs.join(', ')} } from '${f}'`
  })]
  const deps = [...new Set([...named.keys(), ...[...raw].map(r => /from '([^']+)'/.exec(r)[1])].map(f => (f.startsWith('@') ? f.split('/').slice(0, 2).join('/') : f.split('/')[0])))].sort()
  return { body: lines.join('\n') + '\n\n' + body + '\n', deps, icons }
}

/**
 * Keep only the icons a file draws: the ICONS entries whose name appears in the rest of the file as a string literal
 * ('check', name="check") or as ICONS.check. Other names still resolve: the pruned map's prototype is the page-wide icon
 * registry that every file (and icon.tsx, with all of them) fills. IconName stays the full union of names.
 */
function pruneIcons(body) {
  const m = /^export const ICONS = \{\n/m.exec(body)
  if (!m) return { body, icons: null }
  const start = m.index, close = body.indexOf('\n}', start) + 2, end = close + (body.startsWith(' as const', close) ? 9 : 0)
  const entries = [...body.slice(start, end).matchAll(/(\w+): '([^']*)'/g)].map(([, k, v]) => [k, v])
  const rest = body.slice(0, start) + body.slice(end)
  const used = new Set([...rest.matchAll(/(['"])(\w+)\1/g)].map(x => x[2]))
  for (const x of rest.matchAll(/\bICONS\.(\w+)/g)) used.add(x[1])
  const keep = entries.filter(([k]) => used.has(k))
  const typed = /^export type IconName = keyof typeof ICONS$/m.test(rest), key = typed ? 'IconName' : 'string'
  const map = keep.length
    ? `Object.assign(Object.create(iconRegistry) as Record<${key}, string>, {\n${keep.map(([k, v]) => `  ${k}: '${v}',`).join('\n')}\n})`
    : `iconRegistry as Record<${key}, string>`
  const icons = `/** The icons this file draws (${keep.length} of ${entries.length}). Any other name resolves through the page-wide registry: add icon.tsx for all of them, or registerIcons(). */
export const ICONS: Record<${key}, string> = ${map}`
  return { icons: { kept: keep.length, total: entries.length }, body: (body.slice(0, start) + icons + body.slice(end))
    .replace(/^export type IconName = keyof typeof ICONS$/m, '/** An icon name (this file embeds only the paths it draws, see ICONS). */\nexport type IconName = string') }
}

// `const X = createContext<T>(v)` (top level) → `const X = uiSharedContext<T>('X', v)`
function shareContexts(body) {
  const re = /^((?:export )?const (\w+)(?:\s*:[^=\n]+)?\s*=\s*)createContext\b/gm
  let out = '', last = 0, m
  while ((m = re.exec(body))) {
    let j = m.index + m[0].length
    let typeArgs = ''
    if (body[j] === '<') { // type arguments: count < and >, ignoring the > of =>
      let depth = 0
      const s = j
      do {
        if (body[j] === '<') depth++
        else if (body[j] === '>' && body[j - 1] !== '=') depth--
        j++
      } while (depth > 0 && j < body.length)
      typeArgs = body.slice(s, j)
    }
    if (body[j] !== '(') throw new Error(`createContext for ${m[2]}: expected a call`)
    out += body.slice(last, m.index) + `${m[1]}uiSharedContext${typeArgs}('${m[2]}', `
    last = j + 1
  }
  return out + body.slice(last)
}

const SHARED_HELPER = `/**
 * React contexts live on globalThis, keyed by name and library version, so the <UIProvider> from one drop-in file
 * and the components in another share the same theme, toast and form contexts.
 */
function uiSharedContext<T>(name: string, defaultValue: T): Context<T> {
  const store = ((globalThis as { __lyndonUiContexts?: Map<string, unknown> }).__lyndonUiContexts ??= new Map<string, unknown>())
  const key = \`@lyndon/ui@@VERSION@:\${name}\`
  if (!store.has(key)) store.set(key, createContext(defaultValue))
  return store.get(key) as Context<T>
}`

/** The one-line header (scripts/registry/stamp.mjs). The checksums live in index.json and dist-registry/SHA256SUMS. */
const stamp = (name, body) => header(name, { needsProvider: !/^ui-provider(\.tsx)?$/.test(name) }) + body

/** A small CSS → nested object converter for the shadcn `css` field (rules, @media/@layer blocks, @keyframes). */
function cssToObject(css) {
  css = css.replace(/\/\*[\s\S]*?\*\//g, '')
  let i = 0
  const parseBlock = () => {
    const obj = {}
    while (i < css.length) {
      const close = css.indexOf('}', i), open = css.indexOf('{', i)
      if (close !== -1 && (open === -1 || close < open)) {
        const decl = css.slice(i, close).trim()
        if (decl) Object.assign(obj, parseDecls(decl))
        i = close + 1
        return obj
      }
      if (open === -1) break
      const head = css.slice(i, open)
      const semi = head.lastIndexOf(';')
      if (semi !== -1) { Object.assign(obj, parseDecls(head.slice(0, semi))); }
      const selector = head.slice(semi + 1).trim().replace(/\s+/g, ' ')
      i = open + 1
      const inner = parseBlock()
      obj[selector] = obj[selector] && typeof obj[selector] === 'object' ? { ...obj[selector], ...inner } : inner
    }
    return obj
  }
  const parseDecls = text => Object.fromEntries(text.split(/;(?![^(]*\))/).map(s => s.trim()).filter(Boolean).map(s => {
    const k = s.indexOf(':')
    return [s.slice(0, k).trim(), s.slice(k + 1).trim()]
  }))
  return parseBlock()
}

// ── llms.txt ───────────────────────────────────────────────────────────────────────────────────────────────────────

function writeLlms(index) {
  const fmtTok = t => (t >= 1000 ? `${(t / 1000).toFixed(1)}k` : `${t}`)
  const first = s => s.split(/(?<=\.)\s/)[0].replace(/\s+/g, ' ')
  const tagList = e => e.tags.filter(t => t !== e.area).join(', ')
  // core by area (in the vocabulary's order), then each extras family, then the copy-in blocks
  const areas = TAGS.filter(t => t.facet === 'area').map(t => t.id)
  const groups = [
    ...areas.map(a => [`Core: ${TAG_BY_ID[a].label}`, index.filter(e => e.tier === 'core' && e.area === a), '@lyndon/ui']),
    ...Object.keys(EXTRAS).map(f => [`Extras: ${f}`, index.filter(e => e.family === f), EXTRAS[f].modules.filter(m => index.some(e => e.module === m)).map(m => `@lyndon/ui/${m}`).join(', ')]),
    ['Blocks', index.filter(e => e.tier === 'block'), 'copy-in, not in the package'],
  ].filter(([, list]) => list.length)
  const heading = (label, from) => `\n## ${label}\n\nImport from: ${from}.\n`
  const allLines = groups.flatMap(([label, list, from]) => [heading(label, from), ...list.map(e =>
    `- [${e.name}](${BASE}/${e.file}): ${first(e.description)} (${e.kind}, ~${fmtTok(e.tokens)} tokens${tagList(e) ? `; tags: ${tagList(e)}` : ''})`)])
  const vocab = TAG_FACETS.filter(f => f.id !== 'area').map(f => `- ${f.label}: ${TAGS.filter(t => t.facet === f.id).map(t => t.id).join(', ')}`).join('\n')
  const intro = `# @lyndon/ui

> Animated React 19 components in the shadcn style: Tailwind CSS (v4 or v3) for styling, CSS and the Web Animations API
> for animation (no animation library in core; the extras use motion), themes as CSS variables (seven palette families, light and dark). Forms, overlays, navigation, data grid, charts, diagrams, maps,
> media, AI chat and agent UIs. Every component is also a self-contained .tsx drop-in file.

Version ${pkg.version}. Source: ${repo}. Docs: ${BASE}/. Licence: MIT with a revenue threshold (free up to USD 200k ARR).

## Use it

- Install: \`npm i @lyndon/ui\` (peer deps react@19, react-dom@19). Core components come from \`@lyndon/ui\` and need nothing else; extras come from their own subpath (\`@lyndon/ui/charts\`, \`@lyndon/ui/kanban\`, …), named in each group below, and most of them animate with motion: \`npm i motion\` when you use one.
- Styles: Tailwind v4 \`@source "../node_modules/@lyndon/ui/dist";\`, or without Tailwind \`import '@lyndon/ui/styles.css'\`.
- Wrap the app once in \`<UIProvider>\`: it injects the theme tokens, applies the theme (light/dark/system), hosts toasts.
- Colours only through tokens: \`bg-[var(--card)]\`, \`text-[var(--fg2)]\`, \`border-[var(--line)]\`, \`var(--accent)\`, \`var(--ok|warn|bad)\`. Override a component's class with Tailwind's \`!\` prefix.
- Strict CSP: \`<UIProvider injectStyles={false}>\` plus \`import '@lyndon/ui/tokens.css'\`, or pass \`nonce\`.

## Drop-in files (for AI chats and copy-paste)

Each file below is one component (or a small family) with exactly the helpers it needs, importing only react and
react-dom (core) or those plus motion (most extras). Attach the ones you need plus ui-provider.tsx; they share one UIProvider. Sizes are approximate tokens.

- CLI (offline, from the installed package): \`npx @lyndon/ui add data-grid dialog --dir src/components/ui\`, \`npx @lyndon/ui list\`, \`npx @lyndon/ui info data-grid\`
- shadcn CLI: \`npx shadcn add ${BASE}/r/data-grid.json\` (pulls in ui-provider)
- Index with sizes, exports and embedded components: ${BASE}/index.json
- The same files from npm: https://unpkg.com/${pkg.name}@${pkg.version}/dist-registry/files/<name>.tsx
- Whole library in one file (dist-single/ui-all.tsx, ~${fmtTok(tokensOf(sizeOf('dist-single/ui-all.tsx')))} tokens): only for tools with a very large context; prefer the drop-ins

## Tags

Items are grouped below: core by area, then extras by family, then blocks; each line gives the item's kind and tags (ids from one vocabulary: labels,
descriptions and synonyms are in index.json under \`vocabulary\`; the showcase filters by them with \`?tags=id,id\`).

${vocab}
`
  writeFileSync(join(root, 'llms.txt'), intro + allLines.join('\n') + '\n')
  // llms-full.txt: the same, plus each item's exports and embedded components
  const full = intro + groups.flatMap(([label, list, from]) => [heading(label, from), ...list.map(e =>
    `### ${e.title} (\`${e.name}\`, ~${fmtTok(e.tokens)} tokens)\n\n${e.description}\n\n- File: ${BASE}/${e.file}\n- Kind: ${e.kind}; area: ${e.area}${tagList(e) ? `; tags: ${tagList(e)}` : ''}${e.import ? `\n- Import: \`${e.import}\`` : ''}\n- Exports: ${e.exports.join(', ')}` +
    (e.embeds.length ? `\n- Embeds: ${e.embeds.join(', ')}` : '') + (e.dependencies.length ? `\n- npm: ${e.dependencies.join(', ')}` : '') + '\n')]).join('\n')
  writeFileSync(join(root, 'llms-full.txt'), full + '\n')
}

const sizeOf = rel => readFileSync(requireBuilt(rel, 'pnpm build:single')).length

assertProvenance()
assertPlaced(libFiles(), 'build-registry')
const graph = analyze(root)
try {
  build()
} finally {
  graph.close()
}
