import type { CheckoutCard, CheckoutItem } from '../blocks/checkout'
import { fakeLatency } from './latency'

/* The showcase's Checkout card: sample cart, one promo code and a pretend payment provider. None of this belongs in the
   block itself, which charges through the `onPay` you pass it. */

export const CHECKOUT_DEMO_ITEMS: CheckoutItem[] = [
  { id: 'pro', name: 'Pro plan', detail: 'Annual · 5 seats', price: 1152, qty: 1, swatch: 'linear-gradient(135deg,var(--accent),var(--c4))' },
  { id: 'storage', name: 'Extra storage', detail: '100 GB add-on', price: 48, qty: 1, swatch: 'linear-gradient(135deg,var(--c3),var(--warn))' },
]

/** The demo's only promo code. */
export const CHECKOUT_DEMO_PROMO = 'SAVE10'
/** A test card number the pretend provider declines, to show the failure path. */
export const CHECKOUT_DEMO_DECLINED = '4000 0000 0000 0002'

export const checkoutDemoPromo = (code: string) => fakeLatency(undefined, 300, () => code === CHECKOUT_DEMO_PROMO ? 0.1 : null)

/** Nothing is charged: waits like a provider would, and declines `CHECKOUT_DEMO_DECLINED`. */
export const checkoutDemoPay = (_order: unknown, card: CheckoutCard) => fakeLatency(undefined, 1100, () => {
  if (card.number === CHECKOUT_DEMO_DECLINED.replace(/\s/g, '')) throw new Error('Your card was declined. Try another card.')
})
