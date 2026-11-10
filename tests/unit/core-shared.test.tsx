// Core: page-wide shared state (uiShared, the UIProvider host outlet and the toast queue), the icon registry, and the
// accessible names and number formatting of Spinner, DeltaBadge, AnimatedNumber and AvatarStack.
import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { AnimatedNumber, AvatarStack, DeltaBadge, Icon, IconButton, Spinner, UIProvider, iconPath, isIconName, registerIcons, uiShared, useToast } from '../../src/lib'

describe('uiShared', () => {
  it('returns one value per name for the whole page (globalThis, versioned)', () => {
    const a = uiShared('test-shared', () => ({ n: 1 }))
    const b = uiShared('test-shared', () => ({ n: 2 }))
    expect(a).toBe(b)
    const store = (globalThis as { __lyndonUiShared?: Map<string, unknown> }).__lyndonUiShared!
    expect([...store.keys()].some(k => /^@lyndon\/ui@\d+\.\d+:test-shared$/.test(k))).toBe(true)
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
  it('AnimatedNumber rolls one column per digit', () => {
    const { container } = render(<AnimatedNumber value={1234} />)
    expect(container).toHaveTextContent(/^1,234/) // read once, as the number
    const columns = container.querySelector('[aria-hidden]')!.textContent!.match(/0123456789/g)
    expect(columns).toHaveLength(4)
  })
  it('AvatarStack names the group with a count and a list', () => {
    render(<AvatarStack names={['Ada', 'Bo', 'Cy']} />)
    expect(screen.getByRole('group', { name: '3 people: Ada, Bo and Cy' })).toBeTruthy()
  })
})
