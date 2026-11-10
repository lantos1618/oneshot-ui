// Reduced motion (the `desktop-reduced` project emulates prefers-reduced-motion: reduce): core overlays still open and
// close, nothing they animate moves (fades only), and a closed overlay is gone quickly.
import type { Locator } from '@playwright/test'
import { expect, test } from './fixtures'

/** One-off animations running anywhere on the page whose keyframes move something (a transform, translate, scale or rotate); endless loaders (spinners) aside. */
const MOVING = () => document.getAnimations().filter(a => a.playState === 'running' && Number.isFinite(a.effect?.getComputedTiming().endTime) && (a.effect as KeyframeEffect | null)?.getKeyframes().some(k => ['transform', 'translate', 'scale', 'rotate'].some(p => k[p] !== undefined && k[p] !== 'none')))
  .map(a => `${(a as CSSAnimation).animationName ?? (a as CSSTransition).transitionProperty ?? 'script'} on <${((a.effect as KeyframeEffect).target as Element | null)?.tagName.toLowerCase()}>`)

test.describe('reduced motion', () => {
  test('dialog, dropdown menu, sheet and toast open and close without movement, section overlays', async ({ showcase }) => {
    const { page } = showcase
    await showcase.open('overlays')
    const still = async (what: string) => expect(await page.evaluate(MOVING), `moving animations while ${what}`).toEqual([])
    /** The trigger button of a showcase card, once the card has scrolled into view (cards mount their content lazily). */
    const trigger = async (card: string, name: string) => {
      const c = page.locator(`[data-spec="${card}"]`)
      await c.scrollIntoViewIfNeeded()
      await showcase.settleAnimations()
      return c.getByRole('button', { name, exact: true })
    }
    /** Open the overlay, check it shows without movement, close it with Escape, and expect it gone within 200 ms. */
    const cycle = async (what: string, button: Locator, layer: Locator) => {
      await button.click()
      await expect(layer).toBeVisible()
      await still(`${what} opens`)
      await page.keyboard.press('Escape')
      await still(`${what} closes`)
      await expect(layer).toHaveCount(0, { timeout: 200 })
    }
    await cycle('the dropdown menu', await trigger('Dropdown menu', 'Options'), page.getByRole('menu'))
    await cycle('the dialog', await trigger('Modal', 'Delete project'), page.getByRole('dialog', { name: /Delete/ }))
    await cycle('the sheet', await trigger('Sheet / drawer', 'Open filters'), page.getByRole('dialog', { name: 'Filters' }))

    await showcase.open('feedback')
    await (await trigger('Toasts', 'Success')).click()
    const toast = page.getByRole('region', { name: 'Notifications' }).getByText('Changes saved', { exact: true })
    await expect(toast).toBeVisible()
    await still('a toast shows')
    await page.getByRole('button', { name: 'Dismiss notification' }).click()
    await still('a toast leaves')
    await expect(toast).toHaveCount(0, { timeout: 200 })
  })
})
