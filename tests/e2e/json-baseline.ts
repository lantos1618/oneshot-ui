// A baseline of known findings, profile → section → rule → count, kept in a JSON file. Each test writes its measured
// counts as a part file; global-teardown prints the parts and, with E2E_BASELINE=update, merges them into the file.
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const CACHE = join(HERE, '..', '..', 'node_modules', '.cache')
/** `pnpm test:e2e:update-baseline` sets this: the run records what it finds instead of failing on it. */
export const UPDATE = process.env.E2E_BASELINE === 'update'

export type Counts = Record<string, number>
export type Baseline = Record<string, Record<string, Counts>>
export type PartBase = { profile: string; section: string }
export type JsonBaseline<P extends PartBase> = ReturnType<typeof jsonBaseline<P>>

/** Sum of every count in a baseline. */
export const countAll = (b: Baseline) => Object.values(b).flatMap(s => Object.values(s)).flatMap(c => Object.values(c)).reduce((a, n) => a + n, 0)
const sortedCounts = (c: Counts): Counts => Object.fromEntries(Object.entries(c).sort(([a], [b]) => a.localeCompare(b)))

/**
 * `file` (next to this module) holds the baseline; parts go to node_modules/.cache/`parts`. `counts(part)` is what a
 * part contributes (null: nothing measured). Every measured section is kept, `{}` when clean, so the file shows what
 * the run covered; profiles and sections not measured in a run are left as they were.
 */
export function jsonBaseline<P extends PartBase>({ file, parts, counts }: { file: string; parts: string; counts: (p: P) => Counts | null }) {
  const path = join(HERE, file), dir = join(CACHE, parts)
  const read = (): Baseline => { try { return JSON.parse(readFileSync(path, 'utf8')) as Baseline } catch { return {} } }
  const readParts = (): P[] => !existsSync(dir) ? [] : readdirSync(dir).filter(f => f.endsWith('.json'))
    .map(f => JSON.parse(readFileSync(join(dir, f), 'utf8')) as P)
    .sort((a, b) => a.profile.localeCompare(b.profile) || a.section.localeCompare(b.section))
  const merge = (base: Baseline, ps: P[]): Baseline => {
    const out = structuredClone(base)
    for (const p of ps) { const c = counts(p); if (c) (out[p.profile] ??= {})[p.section] = c }
    return Object.fromEntries(Object.keys(out).sort().map(prof =>
      [prof, Object.fromEntries(Object.keys(out[prof]).sort().map(sec => [sec, sortedCounts(out[prof][sec])]))]))
  }
  return {
    file: path,
    read,
    readParts,
    merge,
    writePart(p: P) { mkdirSync(dir, { recursive: true }); writeFileSync(join(dir, `${p.profile}__${p.section}.json`), JSON.stringify(p)) },
    clearParts() { rmSync(dir, { recursive: true, force: true }) },
    /** Merges this run's parts into the file and returns what was written. */
    update(ps = readParts()) { const next = merge(read(), ps); writeFileSync(path, JSON.stringify(next, null, 2) + '\n'); return next },
  }
}
