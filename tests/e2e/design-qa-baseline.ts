// The Design QA baseline: red findings of the showcase's own audit (src/showcase/DesignQA.tsx) known today, per profile
// and section, as rule → count. design-qa.spec.ts fails when a red rule's count grows; `pnpm test:e2e:update-baseline`
// rewrites this file along with axe-baseline.json, for the profiles and sections that ran.
import { jsonBaseline, type Counts } from './json-baseline'

/** A finding as `window.__designQA.audit(section)` returns it. */
export type QaFinding = { rule: string; severity: 'red' | 'amber' | 'orange'; card: string; el: string; msg: string; val: number; tag: string }
export type QaCounts = Counts
export type QaPart = { profile: string; section: string; red: QaCounts; all: QaCounts; cls: number }
export const qaBaseline = jsonBaseline<QaPart>({ file: 'design-qa-baseline.json', parts: 'e2e-design-qa-parts', counts: p => p.red })
export const readQaBaseline = qaBaseline.read
export const writeQaPart = qaBaseline.writePart
