// Regressions in feedback, data and layout, in every profile:
// - Data grid · 50k rows: adjacent pinned cells touch (no gap, no overlap), before and after scrolling sideways.
// - Offline indicator: toggling Connected and scrolling the card away and back cause no layout shift.
// - Tree view: thread lines don't move rows when toggled, and clicking one collapses its folder.
import { expect, test } from './fixtures'

test.describe('0.5 regressions', () => {
  test('data grid pinned columns leave no gap, section data', async ({ showcase }) => {
    const { page } = showcase
    await showcase.open('data')
    const card = page.locator('[data-spec="Data grid · 50k rows"]')
    await card.scrollIntoViewIfNeeded()
    await page.waitForTimeout(800)
    const table = card.getByRole('grid')
    await expect(table).toBeVisible()
    /** For the header and the first body rows: the gap between each pair of neighbouring cells, in reading order. */
    const gaps = () => table.evaluate(t => {
      const out: string[] = []
      const rows = [t.querySelector('thead tr'), ...t.querySelectorAll('tbody tr')].slice(0, 6) as HTMLTableRowElement[]
      for (const r of rows) {
        const cells = [...r.children] as HTMLElement[]
        if (cells.length < 3) continue // group header rows span the table
        // compare each cell pinned to an inline edge with its neighbour pinned to the same edge: they must touch
        // (header cells are all sticky to the top; only an inline-start/end offset pins a column)
        const side = (el: HTMLElement) => { const cs = getComputedStyle(el); return cs.position !== 'sticky' ? null : cs.left !== 'auto' ? 's' : cs.right !== 'auto' ? 'e' : null }
        for (let i = 1; i < cells.length; i++) {
          const sd = side(cells[i]); if (!sd || side(cells[i - 1]) !== sd) continue
          const a = cells[i - 1].getBoundingClientRect(), b = cells[i].getBoundingClientRect()
          const gap = b.left - a.right
          if (Math.abs(gap) > 1) out.push(`${cells[i - 1].dataset.gk ?? cells[i - 1].dataset.ck ?? 'select'} → ${cells[i].dataset.gk ?? cells[i].dataset.ck}: ${gap.toFixed(1)}px`)
        }
      }
      return out
    })
    expect(await gaps(), 'gaps between adjacent pinned cells').toEqual([])
    // scroll sideways: pinned cells stick and still touch
    await table.evaluate(t => { t.parentElement!.scrollLeft = 240 })
    await page.waitForTimeout(200)
    expect(await gaps(), 'gaps between adjacent pinned cells after scrolling sideways').toEqual([])
    // the table lays out at its declared column widths, which the sticky offsets are computed from
    const widths = await table.evaluate(t => ({
      declared: [...t.querySelectorAll('col')].map(c => Math.round(parseFloat((c as HTMLElement).style.width))),
      actual: [...t.querySelectorAll('thead th')].map(th => Math.round(th.getBoundingClientRect().width)),
      scrolls: t.parentElement!.scrollWidth > t.parentElement!.clientWidth + 1,
    }))
    if (widths.scrolls) expect(widths.actual).toEqual(widths.declared)
  })

  test('offline indicator does not shift layout, section feedback', async ({ showcase }) => {
    const { page } = showcase
    await showcase.open('feedback')
    const card = page.locator('[data-spec="Offline indicator"]')
    await card.scrollIntoViewIfNeeded()
    await page.waitForTimeout(800)
    const t0 = await showcase.now()
    const sw = card.getByRole('switch')
    await sw.click(); await page.waitForTimeout(500) // offline → back online
    await sw.click(); await page.waitForTimeout(700) // back → offline while "Back online" shows
    await sw.click(); await page.waitForTimeout(2800) // back online, then the bar slides away
    await sw.click(); await page.waitForTimeout(800) // offline again
    await page.evaluate(() => scrollBy(0, 2500)); await page.waitForTimeout(1200)
    await page.evaluate(() => scrollBy(0, -2500)); await page.waitForTimeout(1200)
    // every layout shift attributed to the card, with or without recent input
    const shift = await page.evaluate(t0 => (window as unknown as { __e2e: { shifts: { t: number; v: number; sources: string[] }[] } }).__e2e.shifts
      .filter(s => s.t >= t0 && s.sources.includes('c-offline-indicator')).reduce((a, s) => a + s.v, 0), t0)
    expect(shift, 'layout shift in the offline indicator card').toBe(0)
    // the live region speaks the state, never the countdown
    const live = card.locator('[role=status].sr-only')
    await expect(live).not.toHaveText(/\d|[٠-٩]/)
  })

  test('tree view lines toggle without moving rows and collapse on click, section layout', async ({ showcase }) => {
    const { page } = showcase
    await showcase.open('layout')
    const card = page.locator('[data-spec="Tree view"]')
    await card.scrollIntoViewIfNeeded()
    await page.waitForTimeout(800)
    const tree = card.getByRole('tree')
    // row boxes relative to the tree (the page may scroll while the switch is tapped)
    const rects = () => tree.evaluate(t => { const o = t.getBoundingClientRect(); return [...t.querySelectorAll('[role=treeitem]')].map(r => { const b = r.getBoundingClientRect(); return [Math.round(b.top - o.top), Math.round(b.left - o.left), Math.round(b.width)].join(',') }) })
    const on = await rects()
    const sw = card.getByRole('switch')
    await expect(sw).toBeChecked()
    await sw.click(); await page.waitForTimeout(300)
    await expect(tree.getByRole('button', { name: /^Collapse / })).toHaveCount(0)
    expect(await rects()).toEqual(on)
    await sw.click(); await page.waitForTimeout(300)
    const folder = tree.getByRole('treeitem', { name: /^components/ })
    await expect(folder).toHaveAttribute('aria-expanded', 'true')
    const line = tree.getByRole('button', { name: /^Collapse components$|^طي components$/ }).first()
    const box = (await line.boundingBox())!
    expect(box.width).toBeGreaterThanOrEqual(12)
    await line.click()
    await expect(folder).toHaveAttribute('aria-expanded', 'false')
    await expect(folder).toBeFocused()
  })
})
