// Generates drop-in single files from the modules in src/lib (and src/showcase), for pasting into
// an AI tool or copying into a project without installing the package:
//
//   dist-single/ui.tsx           the core tier: theme, primitives, inputs, overlays, navigation, feedback, data, layout
//   dist-single/ui-charts.tsx    extras: chart math, charts, diagrams, maps                          (imports ./ui)
//   dist-single/ui-content.tsx   extras: code, editor, lanes, media, collab, data grid, scheduler,    (imports ./ui, ./ui-charts)
//                                kanban, binary, theme export and appearance panels
//   dist-single/ui-ai.tsx        extras: AI chat, composer, agents                                   (imports the others)
//   dist-single/ui-all.tsx       everything in one file
// The bundles follow the tiers in scripts/tiers.mjs.
//   dist-single/ui-with-examples.tsx  everything plus the showcase (default export) as usage examples (not published)
//
// Each file starts with 'use client', then a stamp: package version, git commit (when built from a checkout) and the
// sha256 of everything after the stamp line, so a pasted copy can be checked against a release. dist-single/SHA256SUMS
// lists the sha256 of each whole file (`cd dist-single && sha256sum -c SHA256SUMS`).
//
// Modules were split from one file and every top-level name is unique, so concatenation is safe;
// we only rewrite imports. An add-on imports from another bundle only what it uses.
import { readFileSync, writeFileSync, mkdirSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { commit, dirty, header, pkg, sha256 } from './registry/stamp.mjs'
import { BUNDLES, assertPlaced, bundleOf } from './tiers.mjs'

const root = new URL('..', import.meta.url).pathname
const LIB = Object.values(BUNDLES).flat()
assertPlaced(readdirSync(join(root, 'src/lib')).filter(f => /\.tsx?$/.test(f)), 'build-single')

// every `import … from '…'` statement, including ones spread over several lines
const IMPORT = /^import\s+(type\s+)?(?:\{([^}]*)\}|(\*\s+as\s+\w+)|(\w+))\s*from\s*'([^']+)';?[ \t]*\n?/gm
const REEXPORT = /^export\s+(type\s+)?(\{[^}]*\}|\*)\s*from\s*'\.[^']*';?[ \t]*\n?/gm

function load(file) {
  // a lazily imported library module (geo's map data, the showcase's specLazy cards) is concatenated into the same
  // bundle: resolve it in place
  const src = readFileSync(file, 'utf8').replace(/\bimport\('(?:\.\/|\.\.\/lib\/)(\w+)'\)/g, (_, m) =>
    `Promise.resolve({ ${[...readFileSync(libFile(m), 'utf8').matchAll(/^export (?:const|function) (\w+)/gm)].map(x => x[1]).join(', ')} })`)
  const imports = []
  // intra-library re-exports (`export { x } from './core'`, `export * from './y'`): in the concatenated
  // output those names already exist, so the line is dropped
  const body = src.replace(REEXPORT, '').replace(IMPORT, (_, typeOnly, named, star, def, from) => {
    if (named) imports.push({ from, names: named.split(',').map(s => s.trim()).filter(Boolean).map(n => (typeOnly && !n.startsWith('type ') ? `type ${n}` : n)) })
    else imports.push({ from, raw: `import ${typeOnly ?? ''}${star ?? def} from '${from}'` })
    return ''
  })
  return { imports, body: body.trim() }
}

function render(files, { self, exampleDefault }) {
  const external = new Map(), raw = new Set(), cross = new Map()
  const bodies = []
  for (const f of files) {
    const { imports, body } = load(f)
    for (const imp of imports) {
      if (imp.raw) { raw.add(imp.raw); continue }
      if (imp.from.startsWith('.')) {
        const mod = imp.from.replace(/^\.\.?\/(lib\/?)?/, '').replace(/^\.\//, '')
        const target = bundleOf(mod)
        if (!self || !target || self.includes(target)) continue // same bundle: already in this file
        if (!cross.has(target)) cross.set(target, new Set())
        imp.names.forEach(n => cross.get(target).add(n))
        continue
      }
      if (!external.has(imp.from)) external.set(imp.from, new Set())
      imp.names.forEach(n => external.get(imp.from).add(n))
    }
    bodies.push(body)
  }
  const sort = s => [...s].sort((a, b) => a.replace('type ', '').localeCompare(b.replace('type ', '')))
  const head = [
    ...raw,
    ...[...external].map(([from, names]) => `import { ${sort(names).join(', ')} } from '${from}'`),
    ...[...cross].map(([b, names]) => `import { ${sort(names).join(', ')} } from './${b}'`),
  ].join('\n')
  let out = bodies.join('\n\n')
  if (!exampleDefault) out = out.replace(/^export default /m, 'export ')
  // keep the library's doc comment (top of core.tsx) first
  if (out.startsWith('/**')) { const end = out.indexOf('*/') + 2; return out.slice(0, end) + '\n' + head + '\n' + out.slice(end) + '\n' }
  return head + '\n\n' + out + '\n'
}

const libFile = m => join(root, 'src/lib', `${m}.tsx`)
const showcaseDir = join(root, 'src/showcase')
// ui-with-examples: the sample data (src/examples) and copy-in blocks (src/blocks) the showcase imports, then the showcase
const samples = ['examples', 'blocks'].flatMap(d => readdirSync(join(root, 'src', d)).filter(f => /\.tsx?$/.test(f) && f !== 'index.ts').sort().map(f => join(root, 'src', d, f)))
const examples = [...samples, 'tags.ts', 'cardHeights.ts', 'kit.tsx', ...readdirSync(showcaseDir).filter(f => f.endsWith('.tsx') && f !== 'index.tsx' && f !== 'kit.tsx').sort(), 'index.tsx'].map(f => f.startsWith('/') ? f : join(showcaseDir, f))

mkdirSync(join(root, 'dist-single'), { recursive: true })
const sizes = [], sums = []
// every file is a client module (hooks, effects, browser APIs): the directive lets Next.js App Router import it
const write = (name, body, { listed = true } = {}) => {
  const text = header(name, { needsProvider: false }) + body
  writeFileSync(join(root, 'dist-single', name), text)
  if (listed) sums.push(`${sha256(text)}  ${name}`) // only the published files, so `sha256sum -c` works in node_modules
  sizes.push(`${name} ${(text.length / 1024).toFixed(0)} KB`)
}
for (const [b, mods] of Object.entries(BUNDLES)) {
  const banner = b === 'ui' ? '' : `/** ${b}.tsx: add-on to ui.tsx (keep both files side by side). Generated from src/lib/{${mods.join(',')}}.tsx. */\n`
  write(`${b}.tsx`, banner + render(mods.map(libFile), { self: [b], exampleDefault: false }))
}
write('ui-all.tsx', render(LIB.map(libFile), { exampleDefault: false }))
write('ui-with-examples.tsx', render([...LIB.map(libFile), ...examples], { exampleDefault: true }), { listed: false })
writeFileSync(join(root, 'dist-single', 'SHA256SUMS'), sums.join('\n') + '\n')
console.log('dist-single:', sizes.join(' · '), `· SHA256SUMS (${pkg.version}${commit ? ` ${commit}${dirty}` : ''})`)
