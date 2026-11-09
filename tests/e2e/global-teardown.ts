// Prints the measured CLS and axe counts per section, and with AXE_BASELINE=update rewrites axe-baseline.json.
import { BASELINE_FILE, UPDATE, mergeBaseline, readBaseline, readParts, writeBaseline } from './baseline'

export default function globalTeardown() {
  const parts = readParts().sort((a, b) => a.profile.localeCompare(b.profile) || a.section.localeCompare(b.section))
  if (!parts.length) return
  const rows = parts.map(p => `${p.profile.padEnd(14)} ${p.section.padEnd(12)} cls ${p.cls == null ? '  -   ' : p.cls.toFixed(4)}  axe ${p.axe ? Object.values(p.axe).reduce((a, n) => a + n, 0) : '-'}`)
  console.log(`\nShowcase metrics (${parts.length} section runs)\n` + rows.join('\n'))
  if (UPDATE) {
    const next = mergeBaseline(readBaseline(), parts)
    writeBaseline(next)
    const total = Object.values(next).flatMap(s => Object.values(s)).flatMap(c => Object.values(c)).reduce((a, n) => a + n, 0)
    console.log(`\nWrote ${BASELINE_FILE}: ${total} known violation nodes`)
  }
}
