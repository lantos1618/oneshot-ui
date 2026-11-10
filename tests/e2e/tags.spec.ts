// The showcase's tag filter in a real browser: ?tags= in the URL filters the page before it paints, card chips and
// facet chips write it back, synonyms search, and the empty state clears everything. Desktop light and iPhone 13 only.
import { TAG_BY_ID, TAG_CARDS, type TagId, tagCardTags, tagFilterMatch } from '../../src/showcase/tags'
import { createRequire } from 'node:module'
import { expect, test } from './fixtures'

const AXE = createRequire(import.meta.url).resolve('axe-core/axe.min.js')
/** axe-core violations inside the first element matching `selector`. */
async function axeIn(page: import('@playwright/test').Page, selector: string) {
  if (!(await page.evaluate(() => 'axe' in window))) await page.addScriptTag({ path: AXE })
  await page.waitForTimeout(400) // the sheet's entry animation
  return page.evaluate(async sel => {
    const axe = (window as unknown as { axe: { run: (ctx: unknown, opts: unknown) => Promise<{ violations: { id: string; nodes: { target: unknown[] }[] }[] }> } }).axe
    const res = await axe.run(document.querySelector(sel), { resultTypes: ['violations'] })
    return res.violations.map(v => `${v.id}: ${v.nodes.map(n => String(n.target)).join(', ')}`)
  }, selector)
}

test.describe('tag filter', () => {

  /** Titles of the cards the filter leaves visible. */
  const visible = (page: import('@playwright/test').Page) => page.evaluate(() => [...document.querySelectorAll<HTMLElement>('main [data-spec]')].filter(c => c.offsetParent).map(c => c.dataset.spec!))
  const expected = (tags: TagId[]) => Object.keys(TAG_CARDS).filter(t => tagFilterMatch(tagCardTags(TAG_CARDS[t]), tags)).sort()

  test('tags filter: the URL filters the page and the filter writes the URL', async ({ showcase }, info) => {
    test.skip(!['desktop-light', 'iphone-13'].includes(info.project.name), 'runs on desktop light and iPhone 13')
    const page = showcase.page
    const t0 = Date.now()
    await page.goto('/?tags=charts,keyboard', { waitUntil: 'load' })
    await page.locator('main [data-spec]').first().waitFor({ state: 'attached' })
    await expect.poll(async () => (await visible(page)).sort()).toEqual(expected(['charts', 'keyboard']))
    expect(page.url()).toContain('?tags=charts,keyboard')

    if (info.project.name === 'iphone-13') {
      // the chip row opens in filter mode with the picked tags as removable chips; the sheet holds the facets
      await expect(page.getByRole('list', { name: 'Active filters' })).toBeVisible()
      await page.getByRole('button', { name: 'Filter by tag' }).click()
      const sheet = page.getByRole('dialog', { name: 'Filter by tag' })
      await sheet.getByRole('button', { name: /^Statistics \d/ }).click()
      await expect(page).toHaveURL(/\?tags=charts,statistics,keyboard$/)
      expect(await axeIn(page, '[role="dialog"]'), 'axe violations in the tag sheet').toEqual([])
      await sheet.getByRole('button', { name: /^Show \d+ components?$/ }).click()
      await expect(sheet).toBeHidden()
      await expect.poll(async () => (await visible(page)).sort()).toEqual(expected(['charts', 'statistics', 'keyboard']))
      await page.getByRole('button', { name: `Remove filter: ${TAG_BY_ID.statistics.label}` }).click()
      await expect(page).toHaveURL(/\?tags=charts,keyboard$/)
    } else {
      // facet chips: OR within a facet, AND across
      await page.getByRole('button', { name: 'Filter by tag' }).click()
      await page.getByRole('group', { name: 'Area' }).getByRole('button', { name: /^Inputs \d/ }).click()
      await expect(page).toHaveURL(/\?tags=inputs,charts,keyboard$/)
      await expect.poll(async () => (await visible(page)).sort()).toEqual(expected(['inputs', 'charts', 'keyboard']))
      expect((await showcase.axeStable(null, 300)).map(v => `${v.id}: ${v.nodes.map(n => n.target).join(', ')}`), 'axe violations in the sidebar with tags picked').toEqual([])
      // one Tab stop per facet: arrows move between its chips
      const area = page.getByRole('group', { name: 'Area' })
      await area.getByRole('button', { name: /^Inputs \d/ }).focus()
      await page.keyboard.press('ArrowRight')
      await expect(area.getByRole('button', { name: /^Forms \d/ })).toBeFocused()
      await expect(area.locator('button[tabindex="0"]')).toHaveCount(1)
      // a card's chip filters by that tag alone
      const card = page.locator('[data-spec="Combobox"]')
      await card.scrollIntoViewIfNeeded()
      await card.getByRole('link', { name: `Show components tagged ${TAG_BY_ID.search.label}` }).click()
      await expect(page).toHaveURL(/\?tags=search$/)
      await expect.poll(async () => (await visible(page)).sort()).toEqual(expected(['search']))
      // synonyms: "dropdown" finds Select
      await page.getByRole('button', { name: 'Clear filters' }).first().click()
      await page.getByRole('textbox', { name: 'Filter components by name or use case' }).fill('dropdown')
      await expect.poll(() => visible(page)).toContain('Select')
      await expect(page).toHaveURL(/\?q=dropdown$/)
      // empty state, then clear
      await page.getByRole('textbox', { name: 'Filter components by name or use case' }).fill('zzqx')
      await expect(page.getByRole('status').filter({ hasText: 'No components match' })).toBeVisible()
      await page.locator('main').getByRole('button', { name: 'Clear filters' }).click()
      await expect.poll(async () => (await visible(page)).length).toBe(Object.keys(TAG_CARDS).length)
      expect(new URL(page.url()).search).toBe('')
    }
    expect(showcase.errorsSince(t0), 'console errors').toEqual([])
  })
})
