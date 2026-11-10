// Lane graphs in a real browser ("Graphs as rows" card, every tab, git also at 50k commits and scrolled): each row's
// gutter spans the whole row, and every stroke that reaches the bottom edge of a row continues from the top edge of
// the next row at the same x. Regression (0.8 review): same-coloured lanes passing a row were de-duplicated away, so
// lanes showed as dashes; a gutter that doesn't fill its row (padding, an SVG sized wrong) shows up here too.
import { expect, test } from './fixtures'

/** For the rendered rows of the card's grid: gaps where a lane stops at a row boundary or the gutter misses its row. */
const laneBreaks = (grid: import('@playwright/test').Locator) => grid.evaluate(g => {
  const rows = [...g.querySelectorAll<HTMLElement>('[role=row][data-index]')].sort((a, b) => Number(a.dataset.index) - Number(b.dataset.index))
  const problems: string[] = []
  type Ends = { top: number[]; bottom: number[]; rowTop: number; rowBottom: number; index: number }
  const ends: Ends[] = rows.map(row => {
    const svg = row.querySelector('svg')!, box = svg.getBoundingClientRect(), r = row.getBoundingClientRect()
    if (Math.abs(box.top - r.top) > 1 || Math.abs(box.bottom - r.bottom) > 1) problems.push(`row ${row.dataset.index}: gutter ${box.top.toFixed(1)}–${box.bottom.toFixed(1)} vs row ${r.top.toFixed(1)}–${r.bottom.toFixed(1)}`)
    const top: number[] = [], bottom: number[] = []
    const at = (x: number) => Math.round((box.left + x) * 2) / 2
    for (const l of svg.querySelectorAll('line')) { // tails: y1/y2 resolve percentages
      if (l.y1.baseVal.value < 0.5) top.push(at(l.x1.baseVal.value))
      if (Math.abs(l.y2.baseVal.value - box.height) < 1) bottom.push(at(l.x1.baseVal.value))
    }
    for (const p of svg.querySelectorAll('path')) {
      const len = p.getTotalLength(), a = p.getPointAtLength(0), z = p.getPointAtLength(len)
      if (a.y < 0.5) top.push(at(a.x))
      if (Math.abs(z.y - box.height) < 1) bottom.push(at(z.x))
    }
    return { top: [...new Set(top)].sort((x, y) => x - y), bottom: [...new Set(bottom)].sort((x, y) => x - y), rowTop: r.top, rowBottom: r.bottom, index: Number(row.dataset.index) }
  })
  for (let i = 0; i + 1 < ends.length; i++) {
    const a = ends[i], b = ends[i + 1]
    if (b.index !== a.index + 1 || Math.abs(b.rowTop - a.rowBottom) > 1) continue // not neighbours on screen
    if (a.bottom.join() !== b.top.join()) problems.push(`rows ${a.index} → ${b.index}: leaves at [${a.bottom}] enters at [${b.top}]`)
  }
  return { problems, rows: rows.length }
})

test.describe('lane graphs', () => {
  test('lanes are continuous across rows in every tab, section code', async ({ showcase }) => {
    const { page } = showcase
    await showcase.open('code')
    const card = page.locator('[data-spec="Graphs as rows"]')
    await card.scrollIntoViewIfNeeded()
    await showcase.settleAnimations()
    for (const tab of ['Git', 'Chat', 'AST', 'Agent run', 'Dependencies']) {
      await card.getByRole('tab', { name: tab, exact: true }).click()
      const grid = card.getByRole('grid').first()
      await expect(grid).toBeVisible()
      await expect.poll(async () => (await laneBreaks(grid)).rows, `${tab}: rows rendered`).toBeGreaterThan(3)
      await expect.poll(async () => (await laneBreaks(grid)).problems, `${tab}: lane breaks`).toEqual([])
    }
    // a 50k-commit history, at the top and scrolled deep into it
    await card.getByRole('tab', { name: 'Git', exact: true }).click()
    await card.getByRole('switch', { name: '50k commits' }).click()
    const grid = card.getByRole('grid').first()
    await expect(grid).toHaveAttribute('aria-rowcount', /^\d{5}$/, { timeout: 10_000 })
    expect((await laneBreaks(grid)).problems, '50k: lane breaks at the top').toEqual([])
    await grid.evaluate(g => { g.scrollTop = g.scrollHeight * 0.6 })
    const deepest = () => grid.evaluate(g => Math.max(...[...g.querySelectorAll<HTMLElement>('[role=row][data-index]')].map(r => Number(r.dataset.index))))
    await expect.poll(deepest, 'the virtual window moved deep into the history').toBeGreaterThan(10_000)
    await expect.poll(async () => (await laneBreaks(grid)).problems, '50k: lane breaks deep in the history').toEqual([])
  })
})
