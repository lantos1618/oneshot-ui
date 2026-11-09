// The Design QA baseline: red findings of the showcase's own audit (src/showcase/DesignQA.tsx) known today, per profile
// and section, as rule → count. design-qa.spec.ts fails when a red rule's count grows; `pnpm test:e2e:update-baseline`
// (AXE_BASELINE=update) rewrites this file along with axe-baseline.json, for the profiles and sections that ran.
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
export const QA_BASELINE_FILE = join(HERE, 'design-qa-baseline.json')
const QA_PARTS_DIR = join(HERE, '..', '..', 'node_modules', '.cache', 'e2e-design-qa-parts')

/** A finding as `window.__designQA.audit(section)` returns it. */
export type QaFinding = { rule: string; severity: 'red' | 'amber' | 'orange'; card: string; el: string; msg: string; val: number; tag: string }
export type QaCounts = Record<string, number>
export type QaBaseline = Record<string, Record<string, QaCounts>>
export type QaPart = { profile: string; section: string; red: QaCounts; all: QaCounts; cls: number }

export function readQaBaseline(): QaBaseline {
  try { return JSON.parse(readFileSync(QA_BASELINE_FILE, 'utf8')) as QaBaseline } catch { return {} }
}
export function writeQaPart(p: QaPart) {
  mkdirSync(QA_PARTS_DIR, { recursive: true })
  writeFileSync(join(QA_PARTS_DIR, `${p.profile}__${p.section}.json`), JSON.stringify(p))
}
export function readQaParts(): QaPart[] {
  if (!existsSync(QA_PARTS_DIR)) return []
  return readdirSync(QA_PARTS_DIR).filter(f => f.endsWith('.json')).map(f => JSON.parse(readFileSync(join(QA_PARTS_DIR, f), 'utf8')) as QaPart)
}
export function clearQaParts() { rmSync(QA_PARTS_DIR, { recursive: true, force: true }) }

/** Merge measured red counts into the baseline (profiles and sections not measured this run are kept), sorted. Every
 * measured profile and section gets an entry, `{}` when clean, so the file shows what is covered. */
export function mergeQaBaseline(base: QaBaseline, parts: QaPart[]): QaBaseline {
  const out: QaBaseline = structuredClone(base)
  for (const p of parts) (out[p.profile] ??= {})[p.section] = p.red
  const sorted: QaBaseline = {}
  for (const prof of Object.keys(out).sort()) {
    sorted[prof] = {}
    for (const sec of Object.keys(out[prof]).sort()) sorted[prof][sec] = Object.fromEntries(Object.entries(out[prof][sec]).sort())
  }
  return sorted
}
export const writeQaBaseline = (b: QaBaseline) => writeFileSync(QA_BASELINE_FILE, JSON.stringify(b, null, 2) + '\n')
