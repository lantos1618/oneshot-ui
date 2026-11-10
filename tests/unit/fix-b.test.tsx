// Package B (overlays): Sheet across the 640px breakpoint, CommandPalette recents and run timing, Tooltip/HoverCard
// dismissal and wiring, menu first focus, placement gaps, long-press haptics, AlertDialog naming, window-mode VirtualList.
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { AlertDialog, CommandPalette, ContextMenu, DropdownMenu, FloatingPanel, HoverCard, Sheet, Tooltip, fitInside, fitPanel, type Command } from '../../src/lib/overlay'
import { VirtualList } from '../../src/lib/virtual'

/** matchMedia where `(max-width: 639px)` and `(pointer: coarse)` can be switched while mounted. */
function mockMedia({ narrow = false, coarse = false } = {}) {
  const state = { narrow, coarse }
  const subs = new Set<() => void>()
  const orig = window.matchMedia
  window.matchMedia = (q: string) => ({
    get matches() { return /max-width:\s*639px/.test(q) ? state.narrow : /pointer:\s*coarse/.test(q) ? state.coarse : /prefers-reduced-motion:\s*reduce/.test(q) },
    media: q, onchange: null,
    addEventListener: (_: string, cb: () => void) => { subs.add(cb) }, removeEventListener: (_: string, cb: () => void) => { subs.delete(cb) },
    addListener() {}, removeListener() {}, dispatchEvent: () => false,
  }) as unknown as MediaQueryList
  return {
    set(next: Partial<typeof state>) { Object.assign(state, next); act(() => subs.forEach(cb => cb())) },
    restore() { window.matchMedia = orig },
  }
}

describe('B-H1 Sheet across the 640px breakpoint', () => {
  it('keeps the panel, typed input and focus when the viewport narrows', async () => {
    const mq = mockMedia()
    try {
      const user = userEvent.setup()
      render(<Sheet.Root defaultOpen><Sheet.Content aria-label="Filters"><input aria-label="Name" /></Sheet.Content></Sheet.Root>)
      const input = await screen.findByRole('textbox', { name: 'Name' })
      await user.click(input)
      await user.keyboard('draft')
      expect(screen.getByRole('dialog', { name: 'Filters' })).toHaveAttribute('data-side', 'right')
      mq.set({ narrow: true })
      expect(screen.getByRole('dialog', { name: 'Filters' })).toHaveAttribute('data-side', 'bottom')
      const after = screen.getByRole('textbox', { name: 'Name' })
      expect(after).toBe(input)
      expect(after).toHaveValue('draft')
      expect(after).toHaveFocus()
    } finally { mq.restore() }
  })
})

describe('B-H2 CommandPalette recents', () => {
  const options = () => within(screen.getByRole('listbox')).queryAllByRole('option').map(o => o.textContent?.replace(/↵$/, '').trim())
  const inbox = (run: () => void): Command[] => [{ id: 'new', label: 'New issue', run: () => {} }, { id: 'inbox', label: 'Go to inbox', run }]

  it('lists stored recents when the commands arrive after mount', async () => {
    localStorage.setItem('fix-b-recents', JSON.stringify(['inbox']))
    const { rerender } = render(<CommandPalette open onOpenChange={() => {}} commands={[]} recents={3} recentKey="fix-b-recents" />)
    rerender(<CommandPalette open onOpenChange={() => {}} commands={inbox(() => {})} recents={3} recentKey="fix-b-recents" />)
    const list = await screen.findByRole('listbox')
    expect(within(list).getByText('Recent')).toBeInTheDocument()
    expect(options()[0]).toBe('Go to inbox')
  })

  it('Enter on a recent row runs the current command, not the one stored earlier', async () => {
    localStorage.setItem('fix-b-recents', JSON.stringify(['inbox']))
    const first = vi.fn(), second = vi.fn()
    const at = (run: () => void, open: boolean) => <CommandPalette open={open} onOpenChange={() => {}} commands={inbox(run)} recents={3} recentKey="fix-b-recents" />
    const { rerender } = render(at(first, true))
    rerender(at(first, false))
    rerender(at(second, true))
    const input = await screen.findByRole('combobox')
    expect(options()[0]).toBe('Go to inbox')
    await act(async () => { fireEvent.keyDown(input, { key: 'Enter' }) })
    await waitFor(() => expect(second).toHaveBeenCalledTimes(1))
    expect(first).not.toHaveBeenCalled()
  })
})

describe('B-M6 CommandPalette run timing', () => {
  it('runs the chosen command without waiting on a timer, and reports the exit', async () => {
    vi.useFakeTimers()
    const run = vi.fn(), change = vi.fn()
    render(<CommandPalette open onOpenChange={change} commands={[{ id: 'a', label: 'Archive', run }]} />)
    await act(async () => { fireEvent.click(screen.getByRole('option', { name: /Archive/ })) })
    expect(change).toHaveBeenCalledWith(false)
    expect(run).toHaveBeenCalledTimes(1)
  })
})

describe('B-M2 / B-M3 Tooltip and HoverCard', () => {
  it('a hover-shown Tooltip closes on Escape pressed anywhere', async () => {
    const user = userEvent.setup()
    render(<Tooltip.Root delay={0}><Tooltip.Trigger>Help</Tooltip.Trigger><Tooltip.Content>Shortcut: ?</Tooltip.Content></Tooltip.Root>)
    await user.hover(screen.getByText('Help'))
    expect(await screen.findByRole('tooltip')).toHaveTextContent('Shortcut: ?')
    expect(document.activeElement).toBe(document.body)
    fireEvent.keyDown(document.body, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('tooltip')).not.toBeInTheDocument())
  })

  it('a hover-shown HoverCard closes on Escape pressed anywhere', async () => {
    const user = userEvent.setup()
    render(<HoverCard.Root openDelay={0}><HoverCard.Trigger asChild><a href="#u">@sam</a></HoverCard.Trigger><HoverCard.Content>Sam’s card</HoverCard.Content></HoverCard.Root>)
    await user.hover(screen.getByRole('link'))
    expect(await screen.findByRole('tooltip')).toHaveTextContent('Sam’s card')
    fireEvent.keyDown(document.body, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('tooltip')).not.toBeInTheDocument())
  })

  it('a HoverCard describes its trigger and is valid inside a paragraph', () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    render(<p>Written by <HoverCard.Root defaultOpen><HoverCard.Trigger asChild><a href="#u">@sam</a></HoverCard.Trigger><HoverCard.Content>Sam, editor</HoverCard.Content></HoverCard.Root>.</p>)
    const card = screen.getByRole('tooltip')
    expect(card.id).not.toBe('')
    expect(screen.getByRole('link')).toHaveAttribute('aria-describedby', card.id)
    expect(screen.getByRole('link')).toHaveAccessibleDescription('Sam, editor')
    expect(err).not.toHaveBeenCalled()
  })

  it('the portalled Tooltip keeps inside the viewport and honours align', () => {
    expect(fitPanel({ anchor: { left: 980, top: 300, right: 1010, bottom: 320 }, size: { w: 120, h: 30 }, side: 'top', align: 'center', gap: 8, bounds: { w: 1024, h: 768 } }))
      .toEqual({ left: 1024 - 8 - 120, top: 300 - 8 - 30, side: 'top', fits: true })
    expect(fitPanel({ anchor: { left: 100, top: 300, right: 160, bottom: 320 }, size: { w: 120, h: 30 }, side: 'bottom', align: 'end', gap: 6, bounds: { w: 1024, h: 768 } }).left).toBe(160 - 120)
    expect(fitPanel({ anchor: { left: 100, top: 10, right: 160, bottom: 30 }, size: { w: 120, h: 30 }, side: 'top', align: 'start', gap: 8, bounds: { w: 1024, h: 768 } }).side).toBe('bottom')
    expect(fitInside(-20, 100, 400)).toBe(8)
  })
})

describe('B-M4 menu first focus', () => {
  it('a DropdownMenu focuses its first enabled item, skipping an aria-disabled link', async () => {
    const user = userEvent.setup()
    render(
      <DropdownMenu.Root>
        <DropdownMenu.Trigger>Go</DropdownMenu.Trigger>
        <DropdownMenu.Content aria-label="Go to">
          <DropdownMenu.Item asChild disabled><a href="#archive">Archive</a></DropdownMenu.Item>
          <DropdownMenu.Item>Inbox</DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Root>,
    )
    await user.click(screen.getByRole('button', { name: 'Go' }))
    await waitFor(() => expect(screen.getByRole('menuitem', { name: 'Inbox' })).toHaveFocus())
  })
})

describe('B-M5 placement gap', () => {
  it('a FloatingPanel whose sideOffset no longer fits below flips above', () => {
    const height = vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(330)
    const view = (open: boolean) => (
      <div data-testid="anchor" style={{ position: 'relative' }}>
        <FloatingPanel open={open} offset={20} role="dialog" aria-label="Panel">Body</FloatingPanel>
      </div>
    )
    const { rerender } = render(view(false))
    // 768px viewport: 340px free below the anchor (fits 330 + 6, not 330 + 20), 392px above
    vi.spyOn(screen.getByTestId('anchor'), 'getBoundingClientRect').mockReturnValue(DOMRect.fromRect({ x: 100, y: 400, width: 80, height: 20 }))
    rerender(view(true))
    expect(screen.getByRole('dialog', { name: 'Panel' }).parentElement).toHaveAttribute('data-side', 'top')
    height.mockRestore()
  })
})

describe('B-M8 long-press haptics', () => {
  it('does not call navigator.vibrate before the page has had a user activation', () => {
    const mq = mockMedia({ coarse: true })
    const nav = navigator as Navigator & { userActivation?: { hasBeenActive: boolean } }
    const vibrate = vi.fn(() => true)
    Object.defineProperty(navigator, 'vibrate', { value: vibrate, configurable: true })
    Object.defineProperty(navigator, 'userActivation', { value: { hasBeenActive: false }, configurable: true })
    try {
      vi.useFakeTimers()
      render(<ContextMenu label="Card options" items={[{ label: 'Rename' }]}>Card</ContextMenu>)
      const area = screen.getByRole('group', { name: 'Card options' })
      fireEvent.pointerDown(area, { pointerType: 'touch', pointerId: 1, clientX: 20, clientY: 20, button: 0 })
      act(() => { vi.advanceTimersByTime(600) })
      expect(screen.getByRole('menu')).toBeInTheDocument()
      expect(vibrate).not.toHaveBeenCalled()
      expect(nav.userActivation?.hasBeenActive).toBe(false)
    } finally {
      mq.restore()
      delete (navigator as unknown as Record<string, unknown>).vibrate
      delete (navigator as unknown as Record<string, unknown>).userActivation
    }
  })
})

describe('B-M9 dialog labelling', () => {
  it('AlertDialog.Content takes an aria-label when there is no Title', async () => {
    render(
      <AlertDialog.Root defaultOpen>
        <AlertDialog.Content aria-label="Delete file">
          <AlertDialog.Description>It goes for good.</AlertDialog.Description>
          <AlertDialog.Footer><AlertDialog.Cancel /><AlertDialog.Action>Delete</AlertDialog.Action></AlertDialog.Footer>
        </AlertDialog.Content>
      </AlertDialog.Root>,
    )
    const dlg = await screen.findByRole('alertdialog', { name: 'Delete file' })
    expect(dlg).toHaveAccessibleDescription('It goes for good.')
  })
})

describe('B-M11 window-mode VirtualList', () => {
  it('follows the list’s page offset when content above it grows', () => {
    const y = Object.getOwnPropertyDescriptor(window, 'scrollY')
    try {
      const { container } = render(<VirtualList window count={1000} estimateSize={20} measure={false} aria-label="Rows" renderItem={i => <span>Row {i}</span>} />)
      const inner = screen.getByRole('list', { name: 'Rows' }).firstElementChild as HTMLElement
      // a banner above grew: the list now starts 1000px down the page, and the page is scrolled to 3000
      Object.defineProperty(window, 'scrollY', { value: 3000, configurable: true })
      vi.spyOn(inner, 'getBoundingClientRect').mockReturnValue(DOMRect.fromRect({ x: 0, y: 1000 - 3000, width: 800, height: 20000 }))
      act(() => { fireEvent.scroll(window) })
      expect(container.querySelector('[data-index="100"]')).not.toBeNull()
      expect(container.querySelector('[data-index="150"]')).toBeNull()
    } finally { if (y) Object.defineProperty(window, 'scrollY', y) }
  })
})
