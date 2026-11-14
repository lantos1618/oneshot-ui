// Core: page-wide shared state (uiShared, the UIProvider host outlet and the toast queue), the icon registry, and the
// accessible names and number formatting of Spinner, DeltaBadge, AnimatedNumber and AvatarStack.
import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { AnimatedNumber, AvatarStack, DeltaBadge, Icon, IconButton, Spinner, UIProvider, iconPath, isIconName, registerIcons, uiShared, useToast } from '../../src/lib'
import { UI_SHARED_VERSION, UI_VERSION } from '../../src/lib/shared'

describe('uiShared', () => {
  type Store = Map<string, unknown>
  const store = () => (globalThis as { __lyndonUiShared?: Store }).__lyndonUiShared!

  it('gives every copy of the library on the page the same value per name, made once', async () => {
    // a second, independent copy of the module, as a drop-in file would be
    vi.resetModules()
    const copy = await import('../../src/lib/shared?copy=2' as string) as typeof import('../../src/lib/shared')
    expect(copy.uiShared).not.toBe(uiShared)
    const init = vi.fn(() => ({ n: 1 }))
    const a = uiShared('test-shared', init)
    expect(copy.uiShared('test-shared', () => ({ n: 2 }))).toBe(a)
    expect(uiShared('test-shared', () => ({ n: 3 }))).toBe(a)
    expect(init).toHaveBeenCalledTimes(1)
    expect(uiShared('test-shared-other', () => ({ n: 4 }))).not.toBe(a)
  })

  it('shares with copies of the same minor version only (the globalThis protocol other versions also follow)', () => {
    // what a copy of 0.0.x and one of this minor version (another patch release) left on the page
    const older = { from: 'older' }, sameMinor = { from: 'same minor' }
    store().set('@lyndon/ui@0.0:test-versioned', older)
    store().set(`@lyndon/ui@${UI_SHARED_VERSION}:test-same-minor`, sameMinor)
    expect(UI_SHARED_VERSION).toBe(UI_VERSION.split('.').slice(0, 2).join('.'))
    expect(uiShared('test-versioned', () => ({ from: 'this copy' }))).toEqual({ from: 'this copy' })
    expect(uiShared('test-same-minor', () => ({ from: 'this copy' }))).toBe(sameMinor)
  })
})

describe('toasts through the UIProvider host', () => {
  function Toaster({ title }: { title: string }) {
    const toast = useToast()
    return <button onClick={() => toast({ title, duration: 60_000 })}>show {title}</button>
  }
  it('useToast() outside a ToastProvider mounts the page-wide region in UIProvider on the first toast', () => {
    render(<UIProvider persist={false}><Toaster title="Shared hello" /></UIProvider>)
    expect(screen.queryByRole('region', { name: 'Notifications' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'show Shared hello' }))
    const region = screen.getByRole('region', { name: 'Notifications' })
    expect(within(region).getByText('Shared hello')).toBeTruthy()
    fireEvent.click(within(region).getAllByRole('button', { name: 'Dismiss notification' }).at(-1)!)
  })
  it('renders the region once even with two providers on the page', () => {
    render(<>
      <UIProvider persist={false}><Toaster title="One" /></UIProvider>
      <UIProvider persist={false} target="self"><Toaster title="Two" /></UIProvider>
    </>)
    fireEvent.click(screen.getByRole('button', { name: 'show Two' }))
    expect(screen.getAllByRole('region', { name: 'Notifications' })).toHaveLength(1)
    expect(screen.getByText('Two')).toBeTruthy()
  })
})

describe('icon registry', () => {
  it('resolves ICONS and registered paths; isIconName follows both', () => {
    expect(iconPath('check')).toBe('M5 12l5 5L20 7')
    expect(isIconName('zzLogo')).toBe(false)
    registerIcons({ zzLogo: 'M4 4h16v16H4z', check: 'M0 0' })
    expect(isIconName('zzLogo')).toBe(true)
    expect(iconPath('check')).toBe('M5 12l5 5L20 7') // existing names are kept
    const { container } = render(<><Icon name={'zzLogo' as never} /><IconButton icon="zzLogo" label="Home" /></>)
    expect([...container.querySelectorAll('path')].map(p => p.getAttribute('d'))).toEqual(['M4 4h16v16H4z', 'M4 4h16v16H4z'])
  })
})

describe('core primitives', () => {
  it('Spinner and DeltaBadge label and format their values', () => {
    render(<><Spinner /><DeltaBadge value={3.25} digits={1} /></>)
    expect(screen.getByRole('status', { name: 'Loading' })).toBeTruthy()
    expect(screen.getByTitle('Better than the previous period').textContent).toContain('3.3')
  })
  it('AnimatedNumber is read once, as the formatted number, and follows value changes', () => {
    /** the text assistive tech gets: everything outside aria-hidden */
    const spoken = (el: Element) => { const c = el.cloneNode(true) as Element; c.querySelectorAll('[aria-hidden]').forEach(n => n.remove()); return c.textContent }
    const { container, rerender } = render(<AnimatedNumber value={1234} />)
    expect(spoken(container)).toBe('1,234')
    expect(screen.getByText('1,234').closest('[aria-hidden]')).toBeNull()
    rerender(<AnimatedNumber value={98765} />)
    expect(spoken(container)).toBe('98,765')
    rerender(<AnimatedNumber value={0.25} format={{ style: 'percent' }} />)
    expect(spoken(container)).toBe('25%')
  })
  it('AvatarStack names the group with a count and a list', () => {
    render(<AvatarStack names={['Ada', 'Bo', 'Cy']} />)
    expect(screen.getByRole('group', { name: '3 people: Ada, Bo and Cy' })).toBeTruthy()
  })
})
