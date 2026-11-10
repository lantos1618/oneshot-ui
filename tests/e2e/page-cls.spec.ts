// Whole-page layout shift: load the showcase and scroll it from top to bottom without stopping, the way a reader
// flicks through it on a phone. Every section passing its own CLS budget (showcase.spec.ts, which dwells on each step
// until demos settle) didn't stop this from being "Poor" (0.36–0.49 on an iPhone at 4× CPU): there, cards come on screen
// before their demos mount, so a placeholder of the wrong height, a demo that grows after mounting, or anything that
// breaks scroll anchoring moves the page under the reader. If this fails, the sources name the cards: rerun
// `node scripts/card-heights.mjs` if a demo's height changed, and make demos that load something reserve their size.
import { CLS_BUDGET } from './budgets'
import { expect, test } from './fixtures'

/** Scroll step and pause: about 3.9 screens a second on a phone, faster than demos can mount at 4× CPU. */
const STEP_PX = 700, PAUSE_MS = 180
/** Profiles that run it, with the CPU slowdown that matches the device (Chromium's CDP throttling). */
const PROFILES: Record<string, number> = { 'desktop-light': 1, 'iphone-13': 4 }

test('page: scrolling the whole page without stopping stays within the CLS budget', async ({ page, showcase }, info) => {
  const rate = PROFILES[info.project.name]
  test.skip(rate === undefined, 'runs on desktop-light and iphone-13')
  test.setTimeout(240_000)
  if (rate > 1) await (await page.context().newCDPSession(page)).send('Emulation.setCPUThrottlingRate', { rate })
  const t0 = Date.now()
  await showcase.open()
  await page.waitForFunction(() => document.querySelectorAll('[data-spec]').length > 100, null, { timeout: 60_000 })
  await page.waitForTimeout(rate > 1 ? 2000 : 800)
  for (let y = 0, h = 1; y < h; y += STEP_PX) {
    h = await page.evaluate(y => { scrollTo({ top: y, behavior: 'instant' }); return document.documentElement.scrollHeight - innerHeight + 1 }, y) + STEP_PX
    await page.waitForTimeout(PAUSE_MS)
  }
  await page.waitForTimeout(1500)
  test.skip(showcase.reloadedSince(t0), 'the dev server hot-reloaded the page mid-run')
  const cls = await showcase.shiftsSince(0)
  info.annotations.push({ type: 'cls', description: `${cls.total.toFixed(4)} (${cls.count} shifts) ${cls.top.join(', ')}` })
  expect(cls.total, `whole-page CLS: ${cls.count} shifts, largest sources: ${cls.top.join(', ') || 'none'}`).toBeLessThan(CLS_BUDGET)
})
