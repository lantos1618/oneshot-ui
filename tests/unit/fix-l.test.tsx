// Package L (showcase, examples, blocks): the ⌘K overlay commands, the Checkout and SettingsPage blocks, card heights,
// and the shared demo helpers.
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { UIProvider } from '../../src/lib'
import { Checkout, type CheckoutItem, SettingsPage, type SettingsSection } from '../../src/blocks'
import { OVERLAY_DEMO_EVENT, OverlaysSection } from '../../src/showcase/OverlaysSection'
import { specSlug } from '../../src/showcase/kit'
import { CARD_HEIGHTS } from '../../src/showcase/cardHeights'
import { fakeLatency } from '../../src/examples/latency'

const ITEMS: CheckoutItem[] = [{ id: 'a', name: 'Plan', detail: 'Annual', price: 100, qty: 1 }]

/** Walk the checkout to the payment step with valid details and card. */
async function toPayment() {
  fireEvent.click(screen.getByRole('button', { name: 'Continue to details' }))
  fireEvent.change(await screen.findByLabelText('Email'), { target: { value: 'buyer@example.com' } })
  fireEvent.click(screen.getByRole('button', { name: 'Continue to payment' }))
  fireEvent.change(await screen.findByLabelText('Card number'), { target: { value: '4242424242424242' } })
  fireEvent.change(screen.getByLabelText('Expiry'), { target: { value: '1240' } })
  fireEvent.change(screen.getByLabelText('CVC'), { target: { value: '123' } })
}

describe('L-H1: ⌘K "Open modal" / "Open drawer"', () => {
  const dispatch = (detail: 'modal' | 'sheet') => act(() => { dispatchEvent(new CustomEvent(OVERLAY_DEMO_EVENT, { detail })) })

  it.each([['modal', 'Delete “Website redesign”?'], ['sheet', 'Filters']] as const)('opens the %s at once while its card has not mounted', (which, name) => {
    render(<UIProvider><OverlaysSection openPalette={() => {}} /></UIProvider>)
    expect(screen.queryByRole('dialog')).toBeNull()
    dispatch(which)
    expect(screen.getByRole('dialog', { name })).toBeInTheDocument()
  })
})

describe('L-H2: Checkout charges through onPay', () => {
  it('shows the onPay error, stays on Payment and does not call onComplete', async () => {
    const onPay = vi.fn(() => Promise.reject(new Error('Card declined by the bank')))
    const onComplete = vi.fn()
    render(<Checkout items={ITEMS} onPay={onPay} onComplete={onComplete} />)
    await toPayment()
    fireEvent.click(screen.getByRole('button', { name: /^Pay/ }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Card declined by the bank')
    expect(onPay).toHaveBeenCalledWith(expect.objectContaining({ total: expect.any(Number) }), expect.objectContaining({ number: '4242424242424242', expMonth: 12, expYear: 2040, cvc: '123', brand: 'VISA' }))
    expect(onComplete).not.toHaveBeenCalled()
    expect(screen.queryByText('Payment successful')).toBeNull()
    expect(screen.getByRole('button', { name: /^Pay/ })).toBeEnabled()
  })

  it('shows success and calls onComplete only once onPay resolves', async () => {
    let resolve = () => {}
    const onPay = vi.fn(() => new Promise<void>(r => { resolve = r }))
    const onComplete = vi.fn()
    render(<Checkout items={ITEMS} onPay={onPay} onComplete={onComplete} />)
    await toPayment()
    fireEvent.click(screen.getByRole('button', { name: /^Pay/ }))
    await new Promise(r => setTimeout(r, 1300)) // longer than the old fake 1.1 s timer
    expect(onComplete).not.toHaveBeenCalled()
    await act(async () => resolve())
    expect(await screen.findByText('Payment successful')).toBeInTheDocument()
    expect(onComplete).toHaveBeenCalledTimes(1)
  })

  it('prefills no personal details and offers no promo codes of its own', async () => {
    render(<Checkout items={ITEMS} onPay={() => Promise.resolve()} />)
    expect(screen.queryByLabelText('Promo code')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Continue to details' }))
    expect(await screen.findByLabelText('Full name')).toHaveValue('')
    expect(screen.getByLabelText('Email')).toHaveValue('')
    expect(screen.getByLabelText('Company address')).toHaveValue('')
    expect(document.body.textContent).not.toMatch(/Alex Lee|northwind|Demo only/i)
  })

  it('checks promo codes through validatePromo, and shows its failure', async () => {
    const validatePromo = vi.fn(async (c: string) => { if (c === 'BROKEN') throw new Error('Promo service is down'); return c === 'HALF' ? 0.5 : null })
    render(<Checkout items={ITEMS} onPay={() => Promise.resolve()} validatePromo={validatePromo} />)
    const field = screen.getByLabelText('Promo code'), apply = screen.getByRole('button', { name: 'Apply' })
    fireEvent.change(field, { target: { value: 'save10' } }); fireEvent.click(apply)
    expect(await screen.findByText('That code isn’t valid')).toBeInTheDocument()
    fireEvent.change(field, { target: { value: 'broken' } }); fireEvent.click(apply)
    expect(await screen.findByText('Promo service is down')).toBeInTheDocument()
    fireEvent.change(field, { target: { value: 'half' } }); fireEvent.click(apply)
    expect(await screen.findByText('50% off applied')).toBeInTheDocument()
    expect(validatePromo.mock.calls.map(c => c[0])).toEqual(['SAVE10', 'BROKEN', 'HALF'])
  })
})

const SECTIONS = (name = 'Ada', mentions = true): SettingsSection[] => [{ id: 'p', label: 'Profile', icon: 'user', rows: [
  { id: 'name', type: 'text', label: 'Display name', value: name },
  { id: 'mentions', type: 'toggle', label: 'Mentions', value: mentions },
] }]

describe('L-H3: SettingsPage surfaces failed saves', () => {
  it('rolls a toggle back and shows the error when onSave rejects', async () => {
    render(<SettingsPage sections={SECTIONS()} onSave={() => Promise.reject(new Error('server said no'))} />)
    const sw = screen.getByRole('switch', { name: /Mentions/ })
    fireEvent.click(sw)
    expect(await screen.findByRole('alert')).toHaveTextContent('Couldn’t save Mentions: server said no')
    expect(screen.getByRole('switch', { name: /Mentions/ })).toBeChecked()
    expect(screen.queryByText('Saved ✓')).toBeNull()
  })

  it('rolls text back to the last saved value when a later save fails', async () => {
    const onSave = vi.fn((_: string, v: unknown) => v === 'Bad' ? Promise.reject(new Error('taken')) : Promise.resolve())
    render(<SettingsPage sections={SECTIONS()} onSave={onSave} />)
    const input = screen.getByRole('textbox', { name: 'Display name' })
    fireEvent.change(input, { target: { value: 'Grace' } }); fireEvent.blur(input)
    expect(await screen.findByText('Saved ✓')).toBeInTheDocument()
    fireEvent.change(input, { target: { value: 'Bad' } }); fireEvent.blur(input)
    expect(await screen.findByRole('alert')).toHaveTextContent('taken')
    expect(input).toHaveValue('Grace')
  })

  it('shows no "Saved" without an onSave to confirm it', async () => {
    render(<SettingsPage sections={SECTIONS()} />)
    fireEvent.click(screen.getByRole('switch', { name: /Mentions/ }))
    await act(async () => {})
    expect(screen.getByRole('switch', { name: /Mentions/ })).not.toBeChecked()
    expect(screen.queryByText('Saved ✓')).toBeNull()
  })
})

describe('L-M19: SettingsPage follows its sections prop', () => {
  it('shows a changed prop value when there is no pending edit', async () => {
    let setName: (n: string) => void = () => {}
    function Host() { const [n, set] = useState('Ada'); setName = set; return <SettingsPage sections={SECTIONS(n)} onSave={() => Promise.resolve()} /> }
    render(<Host />)
    expect(screen.getByRole('textbox', { name: 'Display name' })).toHaveValue('Ada')
    act(() => setName('Lin'))
    expect(screen.getByRole('textbox', { name: 'Display name' })).toHaveValue('Lin')
    // a confirmed local save shows until the prop moves on
    const input = screen.getByRole('textbox', { name: 'Display name' })
    fireEvent.change(input, { target: { value: 'Mo' } }); fireEvent.blur(input)
    await screen.findByText('Saved ✓')
    expect(input).toHaveValue('Mo')
    act(() => setName('Kim'))
    expect(input).toHaveValue('Kim')
  })
})

describe('L-M2: card placeholder heights', () => {
  it('has a CARD_HEIGHTS entry for every card on the page, and none for a card that is gone', () => {
    const dir = join(__dirname, '..', '..', 'src/showcase')
    const slugs = new Set(readdirSync(dir).filter(f => /Section\.tsx$/.test(f))
      .flatMap(f => [...readFileSync(join(dir, f), 'utf8').matchAll(/<Spec\b[^>]*?\btitle="([^"]+)"/gs)].map(m => specSlug(m[1]))))
    expect(slugs.size).toBeGreaterThan(150)
    expect([...slugs].filter(s => !CARD_HEIGHTS[s]), 'cards without a measured height: rerun scripts/card-heights.mjs').toEqual([])
    expect(Object.keys(CARD_HEIGHTS).filter(k => !slugs.has(k)), 'stale CARD_HEIGHTS keys').toEqual([])
  })
})

describe('L-M11/M12: demo helpers', () => {
  it('fakeLatency resolves, rejects with what result throws, and rejects with AbortError on abort', async () => {
    await expect(fakeLatency(undefined, 1, () => 7)).resolves.toBe(7)
    await expect(fakeLatency(undefined, [1, 2], () => { throw new Error('Network error') })).rejects.toThrow('Network error')
    const c = new AbortController()
    const p = fakeLatency(c.signal, 10_000, () => 1)
    c.abort()
    await expect(p).rejects.toMatchObject({ name: 'AbortError' })
    await expect(fakeLatency(c.signal, 1, () => 1)).rejects.toMatchObject({ name: 'AbortError' })
  })

})

describe('L-H3: SettingsPage, an onSave that throws', () => {
  it('shows the error inside the panel, next to the rows', async () => {
    render(<SettingsPage sections={SECTIONS()} onSave={() => { throw new Error('sync failure') }} />)
    fireEvent.click(screen.getByRole('switch', { name: /Mentions/ }))
    await waitFor(() => expect(within(screen.getByRole('tabpanel')).getByRole('alert')).toHaveTextContent('sync failure'))
  })
})
