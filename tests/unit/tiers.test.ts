// Architecture: the module tiers in scripts/tiers.mjs hold in the source, the barrels and package.json.
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { BARRELS, BUNDLE_FAMILIES, CORE, ENTRIES, EXTRAS, INTERNAL, LAZY, familyOf, tierOf } from '../../scripts/tiers.mjs'
import { TAG_MODULE_AREA } from '../../src/showcase/tags'

const root = join(__dirname, '../..')
const libDir = join(root, 'src/lib')
const files = readdirSync(libDir).filter(f => /\.tsx?$/.test(f))
const nameOf = (f: string) => f.replace(/\.tsx?$/, '')
const modules = files.map(nameOf).filter(m => !ENTRIES.includes(m))
const sourceOf = (m: string) => readFileSync(join(libDir, files.find(f => nameOf(f) === m)!), 'utf8')

/** Violations that are allowed for now, as 'from -> to'. Empty once the split is done. */
const KNOWN = new Set<string>([])

/** Core modules that still import motion while they move to the CSS animations in motion.tsx. Empty once that is done. */
const MOTION_KNOWN = new Set<string>([
  'primitives', 'magnet', 'overlay', 'formkit', 'fields', 'select', 'inputs', 'pickers', 'upload',
  'navigation', 'feedback', 'data', 'layout', 'provider',
])

type Edge = { to: string; typeOnly: boolean; dynamic: boolean; reexport: boolean }
const STATEMENT = /^(import|export)\s+(type\s+)?([\s\S]*?)\s*from\s*'\.\/([\w-]+)'/gm
function edgesOf(m: string): Edge[] {
  const src = sourceOf(m), out: Edge[] = []
  for (const [, kw, typeKw, clause, to] of src.matchAll(STATEMENT)) {
    const specs = /^\{([\s\S]*)\}$/.exec(clause.trim())?.[1].split(',').map(s => s.trim()).filter(Boolean)
    const typeOnly = !!typeKw || (!!specs?.length && specs.every(s => s.startsWith('type ')))
    out.push({ to, typeOnly, dynamic: false, reexport: kw === 'export' })
  }
  for (const [, to] of src.matchAll(/\bimport\(\s*'\.\/([\w-]+)'\s*\)/g)) out.push({ to, typeOnly: false, dynamic: true, reexport: false })
  return out
}
const graph = new Map(modules.map(m => [m, edgesOf(m)]))
const manifest = [...CORE, ...Object.values(EXTRAS).flatMap(f => f.modules)]

/** The modules an entry re-exports, following `export *` through barrels. */
function reexported(entry: string, seen = new Set<string>()) {
  for (const e of edgesOf(entry).filter(e => e.reexport)) {
    if (seen.has(e.to)) continue
    seen.add(e.to)
    if (BARRELS.includes(e.to) || e.to === 'index') reexported(e.to, seen)
  }
  return seen
}

describe('module tiers', () => {
  it('lists every module exactly once', () => {
    expect(manifest.filter((m, i) => manifest.indexOf(m) !== i)).toEqual([])
    expect(modules.filter(m => !manifest.includes(m))).toEqual([])
    expect(manifest.filter(m => !modules.includes(m))).toEqual([])
  })

  it('core never imports extras, not even types', () => {
    const bad = CORE.flatMap(m => (graph.get(m) ?? []).filter(e => tierOf(e.to) !== 'core').map(e => `${m} -> ${e.to}`))
    expect(bad.filter(v => !KNOWN.has(v))).toEqual([])
  })

  it('core never imports motion (it is an optional peer for extras)', () => {
    const bad = CORE.filter(m => /^(?:import|export)\s[^']*?from\s*'motion(?:\/[\w-]+)?'/m.test(sourceOf(m)))
    expect(bad.filter(m => !MOTION_KNOWN.has(m))).toEqual([])
    expect([...MOTION_KNOWN].filter(m => !bad.includes(m)), 'modules that no longer import motion: drop them from MOTION_KNOWN').toEqual([])
  })

  it('extras import only core, their own family and its declared deps', () => {
    const bad: string[] = []
    for (const [family, { modules: ms, deps }] of Object.entries(EXTRAS))
      for (const m of ms) for (const e of graph.get(m) ?? []) {
        const f = familyOf(e.to)
        if (f !== 'core' && f !== family && !deps.includes(f!)) bad.push(`${m} -> ${e.to}`)
      }
    expect(bad.filter(v => !KNOWN.has(v))).toEqual([])
  })

  it('the family graph is acyclic', () => {
    const state = new Map<string, 'visiting' | 'done'>()
    const cycles: string[] = []
    const visit = (f: string, path: string[]) => {
      if (state.get(f) === 'done') return
      if (state.get(f) === 'visiting') { cycles.push([...path, f].join(' -> ')); return }
      state.set(f, 'visiting')
      for (const d of EXTRAS[f].deps) visit(d, [...path, f])
      state.set(f, 'done')
    }
    Object.keys(EXTRAS).forEach(f => visit(f, []))
    expect(cycles).toEqual([])
  })

  it('no module imports a barrel except ./core', () => {
    const bad = modules.filter(m => !BARRELS.includes(m)).flatMap(m => (graph.get(m) ?? []).filter(e => BARRELS.includes(e.to) && e.to !== 'core').map(e => `${m} -> ${e.to}`))
    expect(bad.filter(v => !KNOWN.has(v))).toEqual([])
  })

  it('has no runtime import cycles', () => {
    const runtime = (m: string) => [...new Set((graph.get(m) ?? []).filter(e => !e.typeOnly && !e.dynamic).map(e => e.to))]
    const state = new Map<string, 'visiting' | 'done'>()
    const cycles: string[] = []
    const visit = (m: string, path: string[]) => {
      if (state.get(m) === 'done') return
      if (state.get(m) === 'visiting') { cycles.push([...path.slice(path.indexOf(m)), m].join(' -> ')); return }
      state.set(m, 'visiting')
      for (const d of runtime(m)) visit(d, [...path, m])
      state.set(m, 'done')
    }
    modules.forEach(m => visit(m, []))
    expect(cycles.filter(c => !KNOWN.has(c))).toEqual([])
  })

  it('index exports exactly core, all exports core and extras', () => {
    const publicOf = (ms: string[]) => [...ms.filter(m => !INTERNAL.includes(m) && !LAZY.includes(m)), ...(ms === manifest ? ['index'] : [])].sort()
    expect([...reexported('index')].sort()).toEqual(publicOf(CORE))
    expect([...reexported('all')].sort()).toEqual(publicOf(manifest))
  })

  it('package.json exports match the manifest', () => {
    const exportsMap = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).exports as Record<string, unknown>
    const subpaths = Object.keys(exportsMap).filter(k => /^\.\/[\w-]+$/.test(k)).map(k => k.slice(2))
    const special = ['all', 'utils', 'package.json']
    expect(subpaths.filter(s => !special.includes(s) && !manifest.includes(s))).toEqual([])
    expect(manifest.filter(m => !INTERNAL.includes(m) && !subpaths.includes(m))).toEqual([])
    for (const m of [...subpaths.filter(s => s !== 'package.json'), 'index']) {
      const entry = (m === 'index' ? exportsMap['.'] : exportsMap[`./${m}`]) as { types: string; default: string }
      expect(entry).toEqual({ types: `./dist/${m}.d.ts`, default: `./dist/${m}.js` })
    }
    expect(exportsMap['./utils/extras']).toEqual({ types: './dist/utils-extras.d.ts', default: './dist/utils-extras.js' })
  })

  it('every family is in exactly one single-file bundle, after the bundles it imports from', () => {
    const order = Object.keys(BUNDLE_FAMILIES), bundleOfFamily = new Map(order.flatMap(b => BUNDLE_FAMILIES[b].map(f => [f, b])))
    expect(Object.values(BUNDLE_FAMILIES).flat().sort()).toEqual(Object.keys(EXTRAS).sort())
    const late = Object.entries(EXTRAS).flatMap(([f, { deps }]) => deps.filter(d => order.indexOf(bundleOfFamily.get(d)!) > order.indexOf(bundleOfFamily.get(f)!)).map(d => `${f} -> ${d}`))
    expect(late).toEqual([])
  })

  it('the tag vocabulary gives every module an area', () => {
    expect(manifest.filter(m => !TAG_MODULE_AREA[m])).toEqual([])
    expect(Object.keys(TAG_MODULE_AREA).filter(m => !manifest.includes(m))).toEqual([])
  })

  it('utils is core only; blocks import only the core entry', () => {
    expect(edgesOf('utils').filter(e => tierOf(e.to) !== 'core').map(e => e.to)).toEqual([])
    const blocks = join(root, 'src/blocks')
    const bad = readdirSync(blocks).flatMap(f => [...readFileSync(join(blocks, f), 'utf8').matchAll(/from '(\.\.\/lib[^']*)'/g)].filter(m => m[1] !== '../lib').map(m => `${f}: ${m[1]}`))
    expect(bad).toEqual([])
  })
})
