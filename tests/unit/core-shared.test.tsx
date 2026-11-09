// 0.4 wave 2 core: page-wide shared state (uiShared, the UIProvider host outlet and the toast queue), icon registry,
// and the direction/locale behaviour of the core primitives (Spinner, DeltaBadge, AnimatedNumber, AvatarStack, Kbd, useRoving).
import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import {
  AnimatedNumber, AvatarStack, DeltaBadge, Icon, IconButton, Kbd, LocaleProvider, Spinner, UIProvider, UI_MESSAGES_AR, UI_MESSAGES_DE,
  iconPath, isIconName, registerIcons, uiShared, useRoving, useToast,
} from '../../src/lib'

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
  it('renders the region once even with two providers on the page, in the locale of the first', () => {
    render(<>
      <UIProvider persist={false} locale="de-DE" messages={UI_MESSAGES_DE}><Toaster title="Eins" /></UIProvider>
      <UIProvider persist={false} target="self"><Toaster title="Zwei" /></UIProvider>
    </>)
    fireEvent.click(screen.getByRole('button', { name: 'show Zwei' }))
    expect(screen.getAllByRole('region', { name: 'Benachrichtigungen' })).toHaveLength(1)
    expect(screen.getByText('Zwei')).toBeTruthy()
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

describe('core primitives in a locale', () => {
  it('Spinner and DeltaBadge speak the provider language', () => {
    render(<LocaleProvider locale="ar-EG" messages={UI_MESSAGES_AR}><Spinner /><DeltaBadge value={3.25} digits={1} /></LocaleProvider>)
    expect(screen.getByRole('status', { name: 'جارٍ التحميل' })).toBeTruthy()
    expect(screen.getByTitle('أفضل مقارنة بالفترة السابقة').textContent).toContain('٣٫٣') // Arabic digits and decimal sign
  })
  it('AnimatedNumber rolls the locale digits and keeps the number run left to right', () => {
    const { container } = render(<LocaleProvider locale="ar-EG"><AnimatedNumber value={1234} /></LocaleProvider>)
    expect(container.querySelector('.sr-only')!.textContent).toBe('١٬٢٣٤')
    const run = container.querySelector('[dir="ltr"]')!
    expect(run.querySelectorAll('.flex-col').length).toBe(4) // one rolling column per digit
    expect(run.querySelector('.flex-col')!.textContent).toBe('٠١٢٣٤٥٦٧٨٩')
  })
  it('AvatarStack names the group with a plural message and a locale list', () => {
    render(<LocaleProvider locale="de-DE" messages={UI_MESSAGES_DE}><AvatarStack names={['Ada', 'Bo', 'Cy']} /></LocaleProvider>)
    expect(screen.getByRole('group', { name: '3 Personen: Ada, Bo und Cy' })).toBeTruthy()
  })
  it('Kbd is always left to right', () => {
    render(<Kbd>⌘K</Kbd>)
    expect(screen.getByText('⌘K').getAttribute('dir')).toBe('ltr')
  })
  it('useRoving: in RTL ArrowLeft moves to the next item of a horizontal list', () => {
    function Bar() {
      const r = useRoving(3, () => {}, { orientation: 'horizontal' })
      return <div role="toolbar" tabIndex={0} onKeyDown={r.onKeyDown} data-active={r.active} />
    }
    render(<LocaleProvider locale="ar-EG"><Bar /></LocaleProvider>)
    const bar = screen.getByRole('toolbar')
    act(() => { fireEvent.keyDown(bar, { key: 'ArrowLeft' }) })
    expect(bar.getAttribute('data-active')).toBe('1')
    act(() => { fireEvent.keyDown(bar, { key: 'ArrowRight' }) })
    expect(bar.getAttribute('data-active')).toBe('0')
  })
})
