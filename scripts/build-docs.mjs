// Builds the GitHub Pages site into docs-dist/: the docs app (docs/), the showcase under showcase/, and the registry
// next to them (r/*.json for `npx shadcn add`, files/*.tsx, index.json), plus llms.txt and llms-full.txt.
// Needs dist-registry/ (pnpm build:registry). Usage: node scripts/build-docs.mjs
import { cpSync, writeFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { requireBuilt, root } from './paths.mjs'

const out = join(root, 'docs-dist')
const t0 = Date.now()
const step = (label, fn) => { const t = Date.now(); fn(); console.log(`docs: ${label} (${((Date.now() - t) / 1000).toFixed(1)} s)`) }
const run = (cmd, args) => execFileSync(cmd, args, { cwd: root, stdio: ['ignore', 'inherit', 'inherit'] })
const vite = join(root, 'node_modules/.bin/vite')

requireBuilt('dist-registry/index.json', 'pnpm build:registry')
// the home page links llms.txt: build-registry writes it next to the index
const llms = ['llms.txt', 'llms-full.txt'].map(f => requireBuilt(f, 'pnpm build:registry'))
step('props and demo data', () => run(process.execPath, [join(root, 'scripts/build-docs-data.mjs')]))
step('docs app', () => run(vite, ['build', '--config', 'docs/vite.config.ts', '--logLevel', 'warn']))
step('showcase', () => run(vite, ['build', '--outDir', 'docs-dist/showcase', '--emptyOutDir', '--base', './', '--logLevel', 'warn']))
step('registry and llms.txt', () => {
  for (const p of ['r', 'files', 'index.json']) cpSync(join(root, 'dist-registry', p), join(out, p), { recursive: true })
  for (const f of llms) cpSync(f, join(out, basename(f)))
  writeFileSync(join(out, '.nojekyll'), '') // serve files as they are (no Jekyll pass)
})
console.log(`docs-dist ready in ${((Date.now() - t0) / 1000).toFixed(1)} s`)
