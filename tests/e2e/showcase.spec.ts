// Every showcase section, in every profile (desktop light, desktop dark, iPhone 13): renders without console errors,
// stays within its layout-shift budget, adds no axe violations beyond the baseline, and (on the phone) never makes
// the page scroll sideways.
import { ALLOWED_CONSOLE_ERRORS, CLS_BUDGET, CLS_OVERRIDES, SETTLE_MS, STEP_DWELL_MS } from './budgets'
import { UPDATE, readBaseline, writePart } from './baseline'
import { SECTION_IDS, axeCounts, expect, test, type AxeCounts, type AxeViolation } from './fixtures'

const baseline = readBaseline()

const allowed = (section: string, text: string) => ALLOWED_CONSOLE_ERRORS.some(([s, re]) => (s === '*' || s === section) && re.test(text))

/** Rules whose node count went up compared with the baseline, with the nodes to look at. */
function newViolations(found: AxeViolation[], known: AxeCounts = {}) {
  return found.filter(v => v.nodes.length > (known[v.id] ?? 0)).map(v =>
    `${v.id} (${v.impact}): ${v.nodes.length} nodes, baseline ${known[v.id] ?? 0}. ${v.help}\n` +
    v.nodes.slice(0, 5).map(n => `    ${n.target}\n      ${n.html}\n      ${n.summary}`).join('\n'))
}

test.describe('showcase', () => {
  test('page shell: loads cleanly, sections match SECTIONS, chrome has no new axe violations', async ({ showcase }, info) => {
    const t0 = Date.now()
    await showcase.open()
    const ids = await showcase.page.evaluate(() => [...document.querySelectorAll('main section[id], section[id]')].map(s => s.id))
    expect([...new Set(ids)], 'section ids on the page vs SECTIONS in src/showcase/kit.tsx').toEqual(SECTION_IDS)
    await showcase.page.waitForTimeout(SETTLE_MS)
    const errors = showcase.errorsSince(t0).filter(e => !allowed('shell', e))
    expect.soft(errors, 'console errors while loading').toEqual([])
    const v = await showcase.axeStable(null)
    const counts = axeCounts(v)
    writePart({ profile: info.project.name, section: '__shell', axe: counts, cls: null, clsTop: [] })
    if (!UPDATE) expect.soft(newViolations(v, baseline[info.project.name]?.__shell), 'new axe violations in the page chrome').toEqual([])
    const o = await showcase.horizontalOverflow(null)
    expect.soft(o.scrolls, `page scrolls sideways at ${o.viewport}px (scrollWidth ${o.scrollWidth})\n${o.offenders.join('\n')}`).toBe(false)
  })

  for (const id of SECTION_IDS) {
    test(`section ${id}`, async ({ showcase }, info) => {
      const profile = info.project.name
      await showcase.open(id)
      const t0 = Date.now()
      const hmr = 'the dev server hot-reloaded the page during the test (src/ was edited); run it again'
      let start: number
      try { start = await showcase.scrollThrough(id, STEP_DWELL_MS, SETTLE_MS) } catch (e) { test.skip(showcase.reloadedSince(t0), hmr); throw e }
      test.skip(showcase.reloadedSince(t0), hmr)

      await test.step('no console errors', () => {
        const errors = showcase.errorsSince(t0).filter(e => !allowed(id, e))
        expect.soft(errors, `console errors while showing #${id}`).toEqual([])
      })

      const cls = await showcase.shiftsSince(start)
      await test.step('layout shift within budget', () => {
        const o = CLS_OVERRIDES[`${profile}:${id}`] ?? CLS_OVERRIDES[id]
        const budget = o?.budget ?? CLS_BUDGET
        info.annotations.push({ type: 'cls', description: `${cls.total.toFixed(4)} (${cls.count} shifts, budget ${budget}) ${cls.top.join(', ')}` })
        expect.soft(cls.total, `CLS in #${id}: ${cls.count} shifts, largest sources: ${cls.top.join(', ') || 'none'}`).toBeLessThanOrEqual(budget)
      })

      const v = await showcase.axeStable(id)
      const counts = axeCounts(v)
      writePart({ profile, section: id, axe: counts, cls: cls.total, clsTop: cls.top })
      await test.step('no new axe violations', () => {
        info.annotations.push({ type: 'axe', description: JSON.stringify(counts) })
        if (!UPDATE) expect.soft(newViolations(v, baseline[profile]?.[id]), `axe violations in #${id} beyond tests/e2e/axe-baseline.json (run pnpm test:e2e:update-baseline if they are expected)`).toEqual([])
      })

      if (profile === 'iphone-13') {
        await test.step('no horizontal page scroll at 390px', async () => {
          const o = await showcase.horizontalOverflow(id)
          expect.soft(o.scrolls, `page scrolls sideways in #${id} (scrollWidth ${o.scrollWidth} > ${o.viewport})\n${o.offenders.join('\n')}`).toBe(false)
        })
      }
    })
  }
})
