// The showcase's Design QA audit (src/showcase/DesignQA.tsx, ⇧D on the page) run per section, as a routine check: on
// desktop light and iPhone 13 (the projects are picked in playwright.config.ts). A section
// fails when a red rule (misalignment, clipped content, low contrast) finds more than tests/e2e/design-qa-baseline.json
// allows, or when the audit's layout-shift (CLS) meter rates the visit "Poor". Amber and orange findings (off-grid
// spacing, one-off sizes, type and radii) are reported in the test's annotations but don't fail it.
import { UPDATE } from './baseline'
import { STEP_DWELL_MS, SETTLE_MS } from './budgets'
import { readQaBaseline, writeQaPart, type QaCounts, type QaFinding } from './design-qa-baseline'
import { SECTION_IDS, expect, test } from './fixtures'

const baseline = readQaBaseline()
/** The meter's "Poor" threshold (Core Web Vitals): above this the panel's CLS badge is red. */
const CLS_POOR = 0.25

type QaApi = { audit: (section?: string) => { checked: number; findings: QaFinding[] }; cls: () => { score: number; sources: { name: string; total: number }[] } }
const count = (fs: QaFinding[]): QaCounts => {
  const c: QaCounts = {}
  for (const f of fs) c[f.rule] = (c[f.rule] ?? 0) + 1
  return Object.fromEntries(Object.entries(c).sort())
}
const line = (f: QaFinding) => `${f.rule}: ${f.card} › ${f.el}: ${f.msg}\n      ${f.tag}`

test.describe('design qa', () => {
  for (const id of SECTION_IDS) {
    test(`design qa: section ${id}`, async ({ showcase }, info) => {
      const profile = info.project.name, page = showcase.page
      await showcase.open(id)
      await page.waitForFunction(() => '__designQA' in window, null, { timeout: 15_000 })
      const t0 = Date.now()
      const hmr = 'the dev server hot-reloaded the page during the test (src/ was edited); run it again'
      try { await showcase.scrollThrough(id, STEP_DWELL_MS, SETTLE_MS) } catch (e) { test.skip(showcase.reloadedSince(t0), hmr); throw e }
      test.skip(showcase.reloadedSince(t0), hmr)

      // Twice, a moment apart, keeping per rule the run with fewer findings: looping demos and late entry animations
      // can catch an element mid-change; a real problem shows up in both runs.
      const audit = () => page.evaluate(id => (window as unknown as { __designQA: QaApi }).__designQA.audit(id), id)
      await showcase.settleAnimations()
      const a = await audit()
      await page.waitForTimeout(1200)
      await showcase.settleAnimations()
      const b = await audit()
      const rules = new Set([...a.findings, ...b.findings].map(f => f.rule))
      const findings = [...rules].flatMap(r => {
        const x = a.findings.filter(f => f.rule === r), y = b.findings.filter(f => f.rule === r)
        return y.length <= x.length ? y : x
      })
      const red = findings.filter(f => f.severity === 'red')
      const cls = await page.evaluate(() => (window as unknown as { __designQA: QaApi }).__designQA.cls())
      writeQaPart({ profile, section: id, red: count(red), all: count(findings), cls: cls.score })
      info.annotations.push({ type: 'design-qa', description: `${b.checked} elements; ${JSON.stringify(count(findings))}; CLS ${cls.score.toFixed(3)}` })

      await test.step('no new red Design QA findings', () => {
        if (UPDATE) return
        const known = baseline[profile]?.[id] ?? {}
        const grew = Object.entries(count(red)).filter(([rule, n]) => n > (known[rule] ?? 0))
        const detail = grew.map(([rule, n]) => `${rule}: ${n} findings, baseline ${known[rule] ?? 0}\n` + red.filter(f => f.rule === rule).slice(0, 8).map(f => '    ' + line(f)).join('\n'))
        expect.soft(detail, `red Design QA findings in #${id} beyond tests/e2e/design-qa-baseline.json (fix them; if a finding is the tool's mistake, fix the rule in src/showcase/DesignQA.tsx; run pnpm test:e2e:update-baseline only after fixing)`).toEqual([])
      })
      await test.step('layout shift not rated Poor', () => {
        expect.soft(cls.score, `Design QA CLS meter in #${id}: ${cls.score.toFixed(3)}; top sources ${cls.sources.slice(0, 4).map(s => `${s.name} ${s.total.toFixed(3)}`).join(', ') || 'none'}`).toBeLessThanOrEqual(CLS_POOR)
      })
    })
  }
})
