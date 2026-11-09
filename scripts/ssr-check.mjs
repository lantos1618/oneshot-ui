// Server-render check: renders <UIProvider><Button/></UIProvider>, ThemeScript, every showcase section and the whole
// page (also in Arabic, which must come out dir="rtl") with react-dom/server renderToString (modules loaded through Vite SSR, so the TSX sources are used as they are).
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
const expect = (name, ok, detail) => results.push(ok ? { name, ok: true, size: 0, warnings: [] } : { name, ok: false, error: detail, warnings: [] })
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
  // CSP: every <style> carries the nonce; injectStyles={false} renders none; fonts are off unless asked for
  {
    const withNonce = renderToString(h(lib.UIProvider, { nonce: 'n0nce', fonts: true }, h(lib.Button, null, 'x')))
    const styles = withNonce.match(/<style[^>]*>/g) ?? []
    expect('UIProvider nonce on every <style>', styles.length === 2 && styles.every(t => t.includes('nonce="n0nce"')), styles.join(' '))
    const none = renderToString(h(lib.UIProvider, { injectStyles: false }, h(lib.Button, null, 'x')))
    expect('UIProvider injectStyles={false}: no <style>, no font request', !/<style|googleapis/.test(none), none.slice(0, 200))
    expect('UIProvider default: no Google Fonts', !renderToString(h(lib.UIProvider, null, 'x')).includes('googleapis'), 'FONT_CSS rendered by default')
  }
  // Theme storage: junk never throws, and only library tokens and values survive
  {
    const junk = [null, 1, 'x', [], { variant: { default: -1 } }, { theme: 'ayu', variant: { ayu: 'x' } }, { variant: { ayu: 99 } }, { radius: Infinity },
      { radius: '8' }, { font: 'x"}</style><img src=//x>' }, { useCustom: true, custom: { dark: 1, v: { bg: 'url(http://x/) #fff' } } },
      { useCustom: true, custom: { v: { bg: '#123456', card: 'red;position:fixed', __proto__: { x: 1 } } } }, JSON.parse('{"__proto__":{"polluted":1},"constructor":{"prototype":{"p":1}}}')]
    let bad = ''
    for (const j of junk) {
      try {
        const s = lib.themeLoad(j)
        for (const dark of [false, true]) {
          const t = lib.themeTokens(s, dark)
          for (const [k, v] of Object.entries(t)) if (!lib.themeTokenOk(k, v)) bad ||= `${JSON.stringify(j)} → --${k}: ${v}`
        }
        lib.themePalette(j ?? {}, true); lib.themeTokens(j ?? {}, false)
      } catch (e) { bad ||= `${JSON.stringify(j)} threw ${e.message}` }
    }
    expect('themeLoad/themeTokens on junk: no throw, only safe tokens', !bad && ({}).polluted === undefined, bad)
    expect('themeCSS drops unsafe values', !/url\(|<\/style/.test(lib.themeCSS({ bg: 'url(http://x)', font: '"x"}</style>', ok: '#fff' }, '*/</style>')), 'unsafe value kept')
    const src = lib.themeScriptSource()
    expect('ThemeScript reads ui-theme:v1 and validates css', src.includes('"ui-theme:v1"') && src.includes('"ui-theme"') && src.includes('R.test'), src.slice(0, 120))
  }
  const dir = join(root, 'src/showcase')
  // card bodies mount lazily in the browser; render them eagerly here so every component is server-rendered
  const { SpecEagerContext } = await vite.ssrLoadModule('/src/showcase/kit.tsx')
  const eager = el => h(SpecEagerContext.Provider, { value: true }, el)
  for (const f of readdirSync(dir).filter(f => f.endsWith('Section.tsx')).sort()) {
    const mod = await vite.ssrLoadModule(`/src/showcase/${f}`).catch(e => ({ __loadError: e }))
    if (mod.__loadError) { results.push({ name: f, ok: false, error: `import failed: ${mod.__loadError.message}`, warnings: [] }); continue }
    for (const [name, C] of Object.entries(mod)) if (/Section$/.test(name) && typeof C === 'function') await check(name, () => h(lib.UIProvider, null, eager(h(C))))
  }
  await check('Showcase (whole page)', async () => eager(h((await vite.ssrLoadModule('/src/showcase/index.tsx')).default)))
  // right to left: the whole page in Arabic carries dir="rtl" and lang="ar-EG" on its .ui-root (in the server HTML)
  {
    const Showcase = (await vite.ssrLoadModule('/src/showcase/index.tsx')).default
    errors.length = 0
    let html = ''
    try { html = renderToString(h(Showcase, { locale: 'ar-EG' })) } catch (e) { html = `threw ${e?.message ?? e}` }
    const root = /<div[^>]*class="ui-root[^"]*"[^>]*>/.exec(html)?.[0] ?? ''
    expect('Showcase locale="ar-EG": .ui-root has dir="rtl" lang="ar-EG"', /\sdir="rtl"/.test(root) && /\slang="ar-EG"/.test(root), root || html.slice(0, 200))
    expect('Showcase locale="ar-EG": no console.error', !errors.length, errors[0] ?? '')
    const small = renderToString(h(lib.UIProvider, { locale: 'ar-EG' }, h(lib.Button, null, 'x')))
    expect('UIProvider locale="ar-EG": dir="rtl" on .ui-root', /class="ui-root"[^>]*dir="rtl"|dir="rtl"[^>]*class="ui-root"/.test(small), small.slice(0, 300))
  }
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
