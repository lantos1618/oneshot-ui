// Pack check: what `npm pack` would publish must be the built library and nothing else.
// - the entry points and single-file bundles are present, dist-single/SHA256SUMS matches the files
// - the CLI (bin/) and the registry it copies from (dist-registry/index.json and every file it lists) are present
// - no source maps, no sourceMappingURL comments, no source files outside the listed bundles
// - no local paths (home directories, file:// URLs) or obvious secrets in any packed file
// Usage: node tests/pack-check.mjs (after `pnpm build`). Exit code 1 on any problem.
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const root = new URL('..', import.meta.url).pathname
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
const problems = []

const out = execFileSync('npm', ['pack', '--dry-run', '--json', '--ignore-scripts'], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
const [info] = JSON.parse(out.slice(out.indexOf('[')))
const files = info.files.map(f => f.path).sort()

// 1. Required files: every export target, the CSS, the single-file bundles and their checksums
const required = new Set(['package.json', 'README.md', 'LICENSE', 'SECURITY.md', 'dist-single/SHA256SUMS', 'dist-registry/SHA256SUMS'])
for (const target of Object.values(pkg.exports)) {
  for (const p of typeof target === 'string' ? [target] : Object.values(target)) required.add(p.replace(/^\.\//, ''))
}
for (const f of pkg.files.filter(f => !f.includes('*'))) required.add(f)
for (const bin of Object.values(pkg.bin ?? {})) required.add(bin.replace(/^\.\//, ''))
// the registry the CLI copies from: index.json and every file it lists
const registry = JSON.parse(readFileSync(join(root, 'dist-registry/index.json'), 'utf8'))
for (const e of registry.items) for (const f of [e.file, e.packageFile].filter(Boolean)) required.add(`dist-registry/${f}`)
for (const r of required) if (!files.includes(r)) problems.push(`missing from the package: ${r}`)

// 2. Nothing that shouldn't ship
const allowedFile = f => /^(dist\/[\w./-]+\.(js|d\.ts|css)|dist-single\/(ui|ui-content|ui-charts|ui-ai|ui-all)\.tsx|dist-single\/SHA256SUMS|dist-registry\/index\.json|dist-registry\/SHA256SUMS|dist-registry\/files\/[a-z0-9-]+(\.package)?\.tsx|bin\/lyndon-ui\.mjs|package\.json|README\.md|SECURITY\.md|LICENSE)$/.test(f)
for (const f of files) {
  if (f.endsWith('.map')) problems.push(`source map in the package: ${f}`)
  else if (!allowedFile(f)) problems.push(`unexpected file in the package: ${f}`)
}

// 3. Content: no source map references, local paths or secrets
const LOCAL = [/\/home\/[a-z_][\w.-]*\//i, /\/Users\/[\w.-]+\//, /\/root\/(?!\s)/, /[A-Z]:\\\\?Users\\\\?/, /file:\/\/\//, /\/tmp\/claude-/]
const SECRET = [/-----BEGIN [A-Z ]*PRIVATE KEY-----/, /\bAKIA[0-9A-Z]{16}\b/, /\bgh[pousr]_[A-Za-z0-9]{36,}\b/, /\bnpm_[A-Za-z0-9]{36}\b/, /\bsk-(ant-)?[A-Za-z0-9_-]{20,}\b/, /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/]
for (const f of files) {
  const text = readFileSync(join(root, f), 'utf8')
  if (/^\s*\/\/# sourceMappingURL=/m.test(text)) problems.push(`sourceMappingURL comment in ${f}`)
  for (const re of LOCAL) { const m = re.exec(text); if (m) problems.push(`local path in ${f}: …${text.slice(Math.max(0, m.index - 30), m.index + 40).replace(/\s+/g, ' ')}…`) }
  for (const re of SECRET) if (re.test(text)) problems.push(`possible secret in ${f} (${re})`)
}

/** Each line of `dir`/SHA256SUMS matches its file; a missing file is reported, not thrown. */
function checkSums(dir, rebuild) {
  let sums
  try { sums = readFileSync(join(root, dir, 'SHA256SUMS'), 'utf8') } catch { problems.push(`${dir}/SHA256SUMS is missing (${rebuild})`); return }
  for (const line of sums.trim().split('\n')) {
    const [sum, name] = line.trim().split(/\s+/)
    let bytes
    try { bytes = readFileSync(join(root, dir, name)) } catch { problems.push(`${dir}/SHA256SUMS lists ${name}, which is missing (${rebuild})`); continue }
    if (createHash('sha256').update(bytes).digest('hex') !== sum) problems.push(`${dir}/SHA256SUMS: ${name} does not match (${rebuild})`)
  }
}

// 4. the SHA256SUMS files (`sha256sum -c` in node_modules) match the single-file bundles and the registry drop-ins;
// the registry index's own sha256 fields are checked by scripts/check-registry.mjs
checkSums('dist-single', 'rebuild with pnpm build:single')
checkSums('dist-registry', 'rebuild with pnpm build:registry')
if (registry.version !== pkg.version) problems.push(`dist-registry/index.json is for ${registry.version}, package.json is ${pkg.version}`)

const kb = n => `${(n / 1024).toFixed(0)} KB`
console.log(`${info.name}@${info.version}: ${files.length} files, ${kb(info.size)} packed, ${kb(info.unpackedSize)} unpacked`)
if (problems.length) {
  console.error(`\nPack check failed (${problems.length}):\n` + problems.map(p => `  - ${p}`).join('\n'))
  process.exit(1)
}
console.log(`Pack check passed: no source maps, local paths or secrets; checksums match; ${registry.items.length} registry drop-ins and the CLI included.`)
