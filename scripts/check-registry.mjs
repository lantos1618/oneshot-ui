// Checks dist-registry/ (run after scripts/build-registry.mjs):
//   1. index.json matches the files (bytes, sha256), every r/*.json has its content, every drop-in imports only
//      react, react-dom and motion (the .package.tsx block variants import @lyndon/ui instead), and no core item imports motion
//   2. every drop-in type-checks on its own: tsconfig.registry.json compiles each file as a separate module with the
//      app's strict settings (noUnusedLocals included, so an embedded helper nothing uses fails the check)
//   3. every drop-in loads on the server (Vite SSR), and a sample renders with react-dom/server inside the UIProvider
//      of ui-provider.tsx: components from other files must see its context (theme, toasts)
// Usage: node scripts/check-registry.mjs [--no-tsc] [--no-ssr]
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { requireBuilt, root } from './paths.mjs'
import { sha256 } from './registry/stamp.mjs'
import { withSsr } from './ssr.mjs'

const dir = join(root, 'dist-registry')
const args = new Set(process.argv.slice(2))
const problems = []
const t0 = Date.now()

// 1. index and files
const index = JSON.parse(readFileSync(requireBuilt('dist-registry/index.json', 'pnpm build:registry'), 'utf8'))
const ALLOWED = /^(react|react-dom|react-dom\/[\w-]+|react\/jsx-runtime|motion|motion\/react)$/
for (const e of index.items) {
  const file = join(dir, e.file)
  if (!existsSync(file)) { problems.push(`${e.name}: missing ${e.file}`); continue }
  const text = readFileSync(file, 'utf8')
  if (Buffer.byteLength(text) !== e.bytes) problems.push(`${e.name}: bytes ${Buffer.byteLength(text)} ≠ index ${e.bytes}`)
  if (sha256(text) !== e.sha256) problems.push(`${e.name}: sha256 does not match index.json`)
  if (!text.startsWith("'use client'\n")) problems.push(`${e.name}: no 'use client' directive`)
  for (const m of text.matchAll(/^import\s[^'"]*?from\s+'([^']+)'/gm)) if (!ALLOWED.test(m[1])) problems.push(`${e.name}: imports ${m[1]}`)
  for (const m of text.matchAll(/\bimport\(\s*(['"])([^'"]+)\1\s*\)/g)) if (!ALLOWED.test(m[2])) problems.push(`${e.name}: dynamic import('${m[2]}')`)
  for (const name of e.exports) if (!new RegExp(`^export (?:declare )?(?:async )?(?:function\\s*\\*?|const|let|class|type|interface|enum) ?${name}\\b`, 'm').test(text)) problems.push(`${e.name}: does not export ${name}`)
  if (!existsSync(join(dir, 'r', `${e.name}.json`))) problems.push(`${e.name}: no r/${e.name}.json`)
}
for (const f of readdirSync(join(dir, 'r')).filter(f => f.endsWith('.json') && f !== 'registry.json')) {
  const item = JSON.parse(readFileSync(join(dir, 'r', f), 'utf8'))
  if (item.name + '.json' !== f) problems.push(`r/${f}: name ${item.name}`)
  if (!item.type?.startsWith('registry:')) problems.push(`r/${f}: type ${item.type}`)
  if (item.files) for (const fl of item.files) if (!fl.content || !fl.path || !fl.type) problems.push(`r/${f}: file entry without path/type/content`)
  if (!item.files && !item.css) problems.push(`r/${f}: neither files nor css`)
}
console.log(`index: ${index.items.length} items checked`)
// Core drop-ins never need motion; only extras (and the blocks that animate with it) do.
for (const e of index.items) if (e.tier === 'core' && (e.dependencies?.includes('motion') || /from\s+'motion(\/[\w-]+)?'/.test(readFileSync(join(dir, e.file), 'utf8')))) problems.push(`${e.name}: a core item needs motion`)

// 2. standalone type-check
if (!args.has('--no-tsc')) {
  try {
    execFileSync(join(root, 'node_modules/.bin/tsc'), ['-p', 'tsconfig.registry.json', '--noEmit'], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
    console.log(`tsc: ${readdirSync(join(dir, 'files')).length} files type-check on their own`)
  } catch (e) {
    const out = `${e.stdout ?? ''}${e.stderr ?? ''}`.trim().split('\n')
    problems.push(`tsc -p tsconfig.registry.json: ${out.filter(l => /error TS/.test(l)).length} errors\n    ${out.slice(0, 30).join('\n    ')}`)
  }
}

// 3. server rendering
if (!args.has('--no-ssr')) {
  await withSsr(root, async ({ load: loadPath, render }) => {
    const { createElement: h } = await import('react')
    const load = name => loadPath(`/dist-registry/files/${name}.tsx`)
    let loaded = 0
    for (const e of index.items) {
      try { await load(e.name); loaded++ } catch (err) { problems.push(`${e.name}: fails to load on the server: ${String(err?.message ?? err).split('\n')[0]}`) }
    }
    console.log(`ssr: ${loaded}/${index.items.length} files load`)
    const { UIProvider } = await load('ui-provider')
    const opts = [{ value: 'a', label: 'Alpha' }, { value: 'b', label: 'Beta' }]
    const SAMPLE = {
      button: m => h(m.Button, { variant: 'primary' }, 'Save'),
      badge: m => h(m.Badge, null, 'New'),
      card: m => h(m.Card, null, 'Body'),
      tabs: m => h(m.Tabs, { items: [{ value: 'a', label: 'A', content: 'one' }, { value: 'b', label: 'B', content: 'two' }] }),
      accordion: m => h(m.Accordion, { items: [{ title: 'Q', content: 'A' }] }),
      select: m => h(m.Select, { options: opts, defaultValue: 'a', 'aria-label': 'Pick' }),
      switch: m => h(m.Switch, { label: 'On' }),
      alert: m => h(m.Alert, { title: 'Heads up' }, 'Text'),
      progress: m => h(m.Progress, { value: 40 }),
      avatar: m => h(m.Avatar, { name: 'Ada Lovelace' }),
      'theme-toggle': m => h(m.ThemeToggle), // useTheme(): throws unless the provider from ui-provider.tsx is shared
      dialog: m => h(m.Dialog, { open: false, onOpenChange: () => {}, title: 'T' }, 'x'),
      tooltip: m => h(m.Tooltip, { content: 'Tip' }, h('button', null, 'b')),
    }
    let rendered = 0
    for (const [name, make] of Object.entries(SAMPLE)) {
      if (!index.items.some(e => e.name === name)) { problems.push(`ssr sample: no item ${name}`); continue }
      let el
      try { el = h(UIProvider, { persist: false }, make(await load(name))) } catch (err) { problems.push(`ssr ${name}: ${String(err?.message ?? err).split('\n')[0]}`); continue }
      const { html, errors, error } = render(el)
      if (error) { problems.push(`ssr ${name}: ${String(error?.message ?? error).split('\n')[0]}`); continue }
      if (!html.includes('ui-root')) problems.push(`ssr ${name}: no .ui-root wrapper`)
      if (errors.length) problems.push(`ssr ${name}: console.error ${errors[0].slice(0, 160)}`)
      rendered++
    }
    console.log(`ssr: ${rendered}/${Object.keys(SAMPLE).length} sample components render inside ui-provider.tsx's UIProvider`)
  })
}

if (problems.length) {
  console.error(`\nRegistry check failed (${problems.length}):\n` + problems.map(p => `  - ${p}`).join('\n'))
  process.exit(1)
}
console.log(`Registry check passed (${((Date.now() - t0) / 1000).toFixed(1)} s)`)
