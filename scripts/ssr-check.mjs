// Server-render check: renders <UIProvider><Button/></UIProvider>, ThemeScript, and every showcase section with
// react-dom/server renderToString (modules loaded through Vite SSR, so the TSX sources are used as they are).
// Usage: node scripts/ssr-check.mjs [SectionName …]   Exit code 1 if anything throws.
import { createServer } from 'vite'
import { readdirSync } from 'node:fs'
import { join } from 'node:path'
import { createRequire } from 'node:module'

const root = new URL('..', import.meta.url).pathname
const only = process.argv.slice(2)
// React throws when useSyncExternalStore has no getServerSnapshot. The showcase's own spec registry (kit.tsx) has
// none, which would hide everything below it, so fall back to getSnapshot and report each call site instead.
const require = createRequire(join(root, 'package.json'))
const React = require('react'), uses = React.useSyncExternalStore
const noServerSnapshot = new Set()
React.useSyncExternalStore = (sub, get, server) => {
  if (!server) { noServerSnapshot.add((new Error().stack ?? '').split('\n').slice(2).find(l => l.includes('/src/'))?.trim().replace(/^at /, '') ?? '?'); server = get }
  return uses(sub, get, server)
}
const vite = await createServer({ root, configFile: false, logLevel: 'error', appType: 'custom', server: { middlewareMode: true, hmr: false, ws: false } })
const { createElement: h } = await import('react')
const { renderToString } = await import('react-dom/server')

const errors = [] // console.error during render: React warnings, failed effects …
const origError = console.error
console.error = (...a) => { errors.push(a.map(String).join(' ').split('\n')[0]) }

const results = []
async function check(name, make) {
  if (only.length && !only.includes(name)) return
  errors.length = 0
  try {
    const html = renderToString(await make())
    results.push({ name, ok: true, size: html.length, warnings: [...errors] })
  } catch (e) {
    const where = String(e?.stack ?? '').split('\n').find(l => l.includes('/src/')) ?? ''
    results.push({ name, ok: false, error: `${e?.message ?? e}`.split('\n')[0], where: where.trim(), warnings: [...errors] })
  }
}

try {
  const lib = await vite.ssrLoadModule('/src/lib/index.ts')
  await check('UIProvider + Button', () => h(lib.UIProvider, null, h(lib.Button, null, 'Save')))
  await check('UIProvider target=self, fonts=false', () => h(lib.UIProvider, { target: 'self', fonts: false, persist: false }, h(lib.ThemeToggle)))
  await check('ThemeScript', () => h(lib.ThemeScript, { storageKey: 'app-theme', defaultTheme: { theme: 'nord' } }))
  await check('AppearancePanel', () => h(lib.UIProvider, null, h(lib.AppearancePanel)))
  const dir = join(root, 'src/showcase')
  for (const f of readdirSync(dir).filter(f => f.endsWith('Section.tsx')).sort()) {
    const mod = await vite.ssrLoadModule(`/src/showcase/${f}`).catch(e => ({ __loadError: e }))
    if (mod.__loadError) { results.push({ name: f, ok: false, error: `import failed: ${mod.__loadError.message}`, warnings: [] }); continue }
    for (const [name, C] of Object.entries(mod)) if (/Section$/.test(name) && typeof C === 'function') await check(name, () => h(lib.UIProvider, null, h(C)))
  }
  await check('Showcase (whole page)', async () => h((await vite.ssrLoadModule('/src/showcase/index.tsx')).default))
} finally {
  console.error = origError
  await vite.close()
}

for (const r of results) {
  console.log(`${r.ok ? 'ok  ' : 'FAIL'} ${r.name}${r.ok ? ` (${(r.size / 1024).toFixed(0)} KB)` : `: ${r.error}${r.where ? `\n       at ${r.where}` : ''}`}`)
  for (const w of new Set(r.warnings)) console.log(`       console.error: ${w.slice(0, 200)}`)
}
if (noServerSnapshot.size) console.log(`\nuseSyncExternalStore without getServerSnapshot (would throw in renderToString):\n  ${[...noServerSnapshot].join('\n  ')}`)
const failed = results.filter(r => !r.ok).length
console.log(`\n${results.length - failed}/${results.length} rendered on the server`)
process.exit(failed ? 1 : 0)
