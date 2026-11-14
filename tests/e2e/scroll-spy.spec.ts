// "Scroll spy" card (navigation), in every profile: the visible list (chips on phones) follows the guide as it scrolls
// inside the card, a link scrolls the guide to its section without moving the page, and a group's sub-items open
// while it is current. The shell's own section list uses the same component.
import { expect, test } from './fixtures'

test.describe('scroll spy', () => {
  test('follows the guide and jumps to a section, section navigation', async ({ showcase }) => {
    const { page } = showcase
    await showcase.open('navigation')
    const card = page.locator('[data-spec="Scroll spy"]')
    await card.scrollIntoViewIfNeeded()
    await showcase.settleAnimations()
    const nav = card.getByRole('navigation', { name: 'Guide' })
    const guide = card.getByRole('region', { name: 'Getting started' })
    await expect(nav.getByRole('link', { name: 'Install' })).toHaveAttribute('aria-current', 'location')

    const pageY = await page.evaluate(() => scrollY)
    await nav.getByRole('link', { name: 'Deploy' }).click()
    await expect(nav.getByRole('link', { name: 'Deploy' })).toHaveAttribute('aria-current', 'location')
    await expect.poll(() => guide.evaluate(g => g.scrollTop)).toBeGreaterThan(0)
    expect(Math.abs(await page.evaluate(() => scrollY) - pageY), 'the page itself did not scroll').toBeLessThan(2)

    // scrolling the guide by hand back to Theme opens its sub-items
    await guide.evaluate(g => { const t = g.querySelector<HTMLElement>('#spy-theme')!; g.scrollTop += t.getBoundingClientRect().top - g.getBoundingClientRect().top - 4 })
    await expect(nav.getByRole('link', { name: 'Theme' })).toHaveAttribute('aria-current', 'location')
    if (await nav.evaluate(n => getComputedStyle(n).flexDirection === 'column')) await expect(nav.getByRole('link', { name: 'Tokens' })).toBeVisible()
  })
})
