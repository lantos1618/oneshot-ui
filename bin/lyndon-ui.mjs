#!/usr/bin/env node
// lyndon-ui: copy @lyndon/ui drop-in component files into a project. Offline: it reads the dist-registry/ folder that
// ships inside the installed package, and never touches the network. Node 20+, no dependencies.
//
//   npx @lyndon/ui add <name…> [--dir src/components/ui] [--overwrite] [--dry-run] [--no-deps] [--package|--standalone]
//   npx @lyndon/ui list [--json]
//   npx @lyndon/ui info <name> [--json]
import { readFileSync, writeFileSync, mkdirSync, lstatSync, existsSync } from 'node:fs'
import { resolve, relative, isAbsolute, join, sep } from 'node:path'
import { parseArgs } from 'node:util'
import { fileURLToPath } from 'node:url'

const REGISTRY = fileURLToPath(new URL('../dist-registry/', import.meta.url))
const NAME = /^[a-z0-9][a-z0-9-]{0,63}$/
const out = (s = '') => process.stdout.write(s + '\n')
process.stdout.on('error', e => { if (e.code === 'EPIPE') process.exit(0); throw e }) // `lyndon-ui list | head`
const fail = (msg, code = 1) => { process.stderr.write(`lyndon-ui: ${msg}\n`); process.exit(code) }

const HELP = `Usage: lyndon-ui <command> [options]

Commands
  add <name…>     copy drop-in component files into your project (self-contained .tsx; they import only
                  react and react-dom, and the extras motion)
  list            list the components with their size and approximate token count
  info <name>     show what a component exports, embeds and needs

Options for add
  --dir <path>    where to write the files (default: src/components/ui)
  --overwrite     replace files that already exist (default: skip them and exit with code 2)
  --dry-run       print what would be written, write nothing
  --no-deps       do not also add what an item requires (ui-provider)
  --package       blocks: import the library from '@lyndon/ui' (default when it is in your package.json)
  --standalone    blocks: self-contained file, like the components

Other options
  --json          machine-readable output for list and info
  -h, --help      this help
  -v, --version   the package version

Examples
  npx @lyndon/ui add button dialog data-grid
  npx @lyndon/ui add pricing-table --dir src/blocks
  npx @lyndon/ui list
  npx @lyndon/ui info data-grid`

let parsed
try {
  parsed = parseArgs({
    allowPositionals: true,
    options: {
      dir: { type: 'string' }, overwrite: { type: 'boolean' }, 'dry-run': { type: 'boolean' }, 'no-deps': { type: 'boolean' },
      package: { type: 'boolean' }, standalone: { type: 'boolean' }, json: { type: 'boolean' },
      help: { type: 'boolean', short: 'h' }, version: { type: 'boolean', short: 'v' },
    },
  })
} catch (e) { fail(`${e.message}\n\n${HELP}`) }
const { values: opt, positionals } = parsed
const [command, ...names] = positionals

const index = (() => {
  try { return JSON.parse(readFileSync(join(REGISTRY, 'index.json'), 'utf8')) } catch { return fail(`no registry found at ${REGISTRY} (is the package built?)`) }
})()
const byName = new Map(index.items.map(e => [e.name, e]))

if (opt.version) { out(index.version); process.exit(0) }
if (opt.help || !command || command === 'help') { out(HELP); process.exit(command || opt.help ? 0 : 1) }

const kb = n => `${(n / 1024).toFixed(1)} KB`
const tok = n => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : `${n}`)
function lookup(name) {
  if (typeof name !== 'string' || !NAME.test(name)) fail(`invalid component name ${JSON.stringify(name)}: use names from \`lyndon-ui list\` (lowercase letters, digits and -)`)
  const e = byName.get(name)
  if (e) return e
  const near = [...byName.keys()].filter(n => n.includes(name) || name.includes(n) || distance(n, name) <= 2).slice(0, 5)
  return fail(`unknown component "${name}"${near.length ? `. Did you mean: ${near.join(', ')}?` : '. Run `lyndon-ui list`.'}`)
}
function distance(a, b) {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...new Array(b.length).fill(0)])
  for (let j = 1; j <= b.length; j++) d[0][j] = j
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1))
  return d[a.length][b.length]
}

switch (command) {
  case 'list': {
    if (opt.json) { out(JSON.stringify(index.items.map(({ name, type, title, description, bytes, tokens }) => ({ name, type, title, description, bytes, tokens })), null, 2)); break }
    const w = Math.max(...index.items.map(e => e.name.length))
    out(`${index.name} ${index.version}: ${index.items.length} drop-ins (sizes are the whole self-contained file; tokens ≈ bytes / ${+(1 / index.tokensPerByte).toFixed(2)})\n`)
    out(`${'name'.padEnd(w)}  ${'size'.padStart(8)}  ${'tokens'.padStart(7)}  description`)
    for (const e of index.items) {
      const desc = e.description.length > 70 ? e.description.slice(0, 69) + '…' : e.description
      out(`${e.name.padEnd(w)}  ${kb(e.bytes).padStart(8)}  ${('~' + tok(e.tokens)).padStart(7)}  ${e.type === 'registry:block' ? '[block] ' : ''}${desc}`)
    }
    break
  }
  case 'info': {
    if (names.length !== 1) fail('usage: lyndon-ui info <name>')
    const e = lookup(names[0])
    if (opt.json) { out(JSON.stringify(e, null, 2)); break }
    out(`${e.title} (${e.name}, ${e.type})\n\n${e.description}\n`)
    out(`File        dist-registry/${e.file}  ${kb(e.bytes)}, ~${tok(e.tokens)} tokens, ${e.declarations} declarations`)
    if (e.packageFile) out(`Package     dist-registry/${e.packageFile}  ${kb(e.packageBytes)}, ~${tok(e.packageTokens)} tokens (imports '@lyndon/ui')`)
    out(`Exports     ${e.exports.join(', ')}`)
    if (e.embeds.length) out(`Embeds      ${e.embeds.join(', ')}`)
    out(`npm         ${e.dependencies.join(', ') || '(none)'}`)
    if (e.requires.length) out(`Requires    ${e.requires.join(', ')} (render <UIProvider> once; or tokens.css with <UIProvider injectStyles={false}>)`)
    out(`From        src/lib/{${e.modules.join(',')}}.tsx`)
    out(`\nAdd it:     npx @lyndon/ui add ${e.name}`)
    break
  }
  case 'add': add(); break
  default: fail(`unknown command "${command}"\n\n${HELP}`)
}

function add() {
  if (!names.length) fail('usage: lyndon-ui add <name…> [--dir src/components/ui]')
  if (opt.package && opt.standalone) fail('--package and --standalone are exclusive')
  const cwd = process.cwd()
  const dir = resolve(cwd, opt.dir ?? 'src/components/ui')
  const projectPkg = (() => { try { return JSON.parse(readFileSync(join(cwd, 'package.json'), 'utf8')) } catch { return null } })()
  const projectDeps = { ...projectPkg?.dependencies, ...projectPkg?.devDependencies, ...projectPkg?.peerDependencies }
  const usePackage = opt.package || (!opt.standalone && Boolean(projectDeps[index.name]))

  // resolve the items, plus what they require (ui-provider), in a stable order
  const plan = new Map()
  const queue = names.map(n => ({ name: n, why: '' }))
  while (queue.length) {
    const { name, why } = queue.shift()
    const e = lookup(name)
    if (plan.has(e.name)) continue
    const variant = e.packageFile && usePackage ? 'package' : 'standalone'
    plan.set(e.name, { e, why, variant })
    if (!opt['no-deps'] && variant === 'standalone') for (const r of e.requires) queue.push({ name: r, why: `required by ${e.name}` })
  }

  if (existsSync(dir)) {
    const st = lstatSync(dir)
    if (st.isSymbolicLink()) fail(`${dir} is a symbolic link; pass the real directory with --dir`)
    if (!st.isDirectory()) fail(`${dir} exists and is not a directory`)
  }
  const written = [], skipped = []
  for (const { e, why, variant } of plan.values()) {
    const file = `${e.name}.tsx`
    const target = resolve(dir, file)
    const rel = relative(dir, target)
    if (!rel || rel.startsWith('..') || isAbsolute(rel) || rel.includes(sep)) fail(`refusing to write outside ${dir}: ${target}`)
    const source = join(REGISTRY, variant === 'package' ? e.packageFile : e.file)
    if (relative(REGISTRY, source).startsWith('..')) fail(`bad registry path for ${e.name}`)
    const shown = relative(cwd, target) || target
    let exists = false
    try { const st = lstatSync(target); exists = true; if (st.isSymbolicLink() || !st.isFile()) fail(`${shown} exists and is not a regular file; not touching it`) } catch (err) { if (err.code !== 'ENOENT') throw err }
    const note = `${kb(variant === 'package' ? e.packageBytes : e.bytes)}, ~${tok(variant === 'package' ? e.packageTokens : e.tokens)} tokens${variant === 'package' ? ", imports '@lyndon/ui'" : ''}${why ? `; ${why}` : ''}`
    if (exists && !opt.overwrite) { skipped.push(shown); out(`skip   ${shown} (exists; --overwrite replaces it)`); continue }
    if (opt['dry-run']) { out(`${exists ? 'would replace' : 'would write'} ${shown} (${note})`); written.push(shown); continue }
    mkdirSync(dir, { recursive: true })
    writeFileSync(target, readFileSync(source), { flag: exists ? 'w' : 'wx', mode: 0o644 })
    written.push(shown)
    out(`${exists ? 'replace' : 'write'}  ${shown} (${note})`)
  }

  const needed = new Set([...plan.values()].flatMap(({ e, variant }) => (variant === 'package' ? [index.name, ...e.dependencies.filter(d => d === 'motion')] : e.dependencies)))
  const missing = [...needed].filter(d => d !== 'react' && d !== 'react-dom' && !projectDeps[d])
  out('')
  if (missing.length && projectPkg) out(`Install: npm i ${missing.join(' ')}`)
  else if (!projectPkg) out(`Needs: ${['react@19', 'react-dom@19', ...[...needed].filter(d => d !== 'react' && d !== 'react-dom')].join(', ')} (no package.json in ${cwd})`)
  if ([...plan.values()].some(p => p.e.requires.includes('ui-provider') && p.variant === 'standalone'))
    out(`Wrap your app once in <UIProvider> from ${relative(cwd, join(dir, 'ui-provider.tsx')).split(sep).join('/')}: it injects the theme tokens the components use.`)
  out('Tailwind v4 picks the files up from src/ automatically; with v3 make sure `content` covers this folder.')
  if (opt['dry-run']) out(`(dry run: ${written.length} file(s) would be written)`)
  if (skipped.length) process.exit(2)
}
