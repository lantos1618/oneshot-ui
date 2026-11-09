// The axe baseline: violations known today, per profile and section, as rule id → node count. A test fails only when
// a rule appears that isn't in the baseline or its count grows. `pnpm test:e2e:update-baseline` rewrites it.
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { AxeCounts } from './fixtures'

const HERE = dirname(fileURLToPath(import.meta.url))
export const BASELINE_FILE = join(HERE, 'axe-baseline.json')
/** Per-test results land here (one file per profile+section) and global-teardown merges them. */
export const PARTS_DIR = join(HERE, '..', '..', 'node_modules', '.cache', 'e2e-parts')
export const UPDATE = process.env.AXE_BASELINE === 'update'

export type Baseline = Record<string, Record<string, AxeCounts>>

export function readBaseline(): Baseline {
  try { return JSON.parse(readFileSync(BASELINE_FILE, 'utf8')) as Baseline } catch { return {} }
}

export type Part = { profile: string; section: string; axe: AxeCounts | null; cls: number | null; clsTop: string[] }
export function writePart(p: Part) {
  mkdirSync(PARTS_DIR, { recursive: true })
  writeFileSync(join(PARTS_DIR, `${p.profile}__${p.section}.json`), JSON.stringify(p))
}
export function readParts(): Part[] {
  if (!existsSync(PARTS_DIR)) return []
  return readdirSync(PARTS_DIR).filter(f => f.endsWith('.json')).map(f => JSON.parse(readFileSync(join(PARTS_DIR, f), 'utf8')) as Part)
}
export function clearParts() { rmSync(PARTS_DIR, { recursive: true, force: true }) }

/** Merge measured counts into the baseline (profiles/sections not measured this run are kept). Sorted for stable diffs. */
export function mergeBaseline(base: Baseline, parts: Part[]): Baseline {
  const out: Baseline = structuredClone(base)
  for (const p of parts) if (p.axe) (out[p.profile] ??= {})[p.section] = p.axe
  const sorted: Baseline = {}
  for (const prof of Object.keys(out).sort()) {
    sorted[prof] = {}
    for (const sec of Object.keys(out[prof]).sort()) if (Object.keys(out[prof][sec]).length) sorted[prof][sec] = out[prof][sec]
  }
  return sorted
}

export const writeBaseline = (b: Baseline) => writeFileSync(BASELINE_FILE, JSON.stringify(b, null, 2) + '\n')
