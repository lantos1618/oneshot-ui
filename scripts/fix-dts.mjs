// tsc emits declarations with extensionless relative specifiers (`export * from './core'`), which
// TypeScript cannot resolve under moduleResolution node16/nodenext. Add `.js` to each one, so dist/*.d.ts
// work with every resolution mode (the files next to them are dist/*.js).
import { readFileSync, writeFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { requireBuilt } from './paths.mjs'

const dir = requireBuilt('dist', 'pnpm build:lib')
const SPEC = /((?:from|import)\s*\(?\s*)(['"])(\.\.?\/[^'"]+?)\2/g
let n = 0
for (const f of readdirSync(dir, { recursive: true })) {
  if (!String(f).endsWith('.d.ts')) continue
  const file = join(dir, String(f)), src = readFileSync(file, 'utf8')
  const out = src.replace(SPEC, (m, pre, q, spec) => /\.(js|mjs|cjs|json|css)$/.test(spec) ? m : (n++, `${pre}${q}${spec}.js${q}`))
  if (out !== src) writeFileSync(file, out)
}
console.log(`fix-dts: ${n} relative specifiers now end in .js`)
