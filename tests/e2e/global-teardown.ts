// Prints what each section run measured, and with E2E_BASELINE=update merges it into the baseline files.
import { axeBaseline } from './baseline'
import { qaBaseline } from './design-qa-baseline'
import { UPDATE, countAll, type Counts, type JsonBaseline, type PartBase } from './json-baseline'

const sum = (c: Counts) => Object.values(c).reduce((a, n) => a + n, 0)
const list = (c: Counts) => Object.entries(c).map(([k, n]) => `${k} ${n}`).join(', ') || '-'
const name = (p: PartBase) => `${p.profile.padEnd(14)} ${p.section.padEnd(12)}`

function report<P extends PartBase>(title: string, baseline: JsonBaseline<P>, row: (p: P) => string) {
  const parts = baseline.readParts()
  if (!parts.length) return
  console.log(`\n${title} (${parts.length} section runs)\n` + parts.map(p => `${name(p)} ${row(p)}`).join('\n'))
  if (UPDATE) console.log(`Wrote ${baseline.file}: ${countAll(baseline.update(parts))} known findings`)
}

export default function globalTeardown() {
  report('Design QA: red | all findings | CLS', qaBaseline, p => `${list(p.red).padEnd(24)} | ${list(p.all).padEnd(48)} | ${p.cls.toFixed(3)}`)
  report('Showcase metrics', axeBaseline, p => `cls ${p.cls == null ? '  -   ' : p.cls.toFixed(4)}  axe ${p.axe ? sum(p.axe) : '-'}`)
}
