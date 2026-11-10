// The axe baseline: violations known today, per profile and section, as rule id → node count. A test fails only when
// a rule appears that isn't in the baseline or its count grows. `pnpm test:e2e:update-baseline` rewrites it.
import type { AxeCounts } from './fixtures'
import { jsonBaseline } from './json-baseline'

export { UPDATE } from './json-baseline'
export type Part = { profile: string; section: string; axe: AxeCounts | null; cls: number | null; clsTop: string[] }
export const axeBaseline = jsonBaseline<Part>({ file: 'axe-baseline.json', parts: 'e2e-parts', counts: p => p.axe })
export const readBaseline = axeBaseline.read
export const writePart = axeBaseline.writePart
