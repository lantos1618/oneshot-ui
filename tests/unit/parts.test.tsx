// Composable parts (0.4): Slot / asChild, and the Root/Trigger/Content families of Tabs, Dialog, Sheet, AlertDialog,
// Popover, Tooltip, HoverCard, DropdownMenu, ContextMenu, Accordion, Toggle, ToggleGroup and Toolbar. Queries go by role
// and accessible name only.
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createRef, useState, type AnchorHTMLAttributes, type Ref } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { fakeTimers, tick } from '../helpers'
import { Button, IconButton, Slot, composeRefs, mergeSlotProps } from '../../src/lib/core'
import { AlertDialog, ContextMenu, Dialog, DropdownMenu, HoverCard, MenuItem, Popover, Sheet, Tooltip } from '../../src/lib/overlay'
import { Tabs, Toggle, ToggleGroup, Toolbar } from '../../src/lib/navigation'
import { Accordion } from '../../src/lib/data'

/** A stand-in for a router Link (Next.js, React Router): an <a> that navigates client-side on a plain click. */
function FakeLink({ href, navigate, onClick, ref, ...p }: AnchorHTMLAttributes<HTMLAnchorElement> & { href: string; navigate: (to: string) => void; ref?: Ref<HTMLAnchorElement> }) {
  return <a ref={ref} href={href} {...p} onClick={e => { onClick?.(e); if (!e.defaultPrevented) { e.preventDefault(); navigate(href) } }} />
}

describe('Slot and asChild', () => {
  it('merges classes, styles, id lists and props (the child wins plain props)', () => {
    render(<Slot className="a" style={{ color: 'red', margin: 1 }} aria-describedby="tip" aria-labelledby="lbl" title="slot" data-x="1"><span className="b" style={{ margin: 2 }} aria-describedby="own" aria-labelledby="mine" title="child">hi</span></Slot>)
    const el = screen.getByText('hi')
    expect(el.getAttribute('aria-labelledby')).toBe('mine lbl')
    expect(el.className).toBe('a b')
    expect(el.style.color).toBe('red')
    expect(el.style.margin).toBe('2px')
    expect(el.getAttribute('aria-describedby')).toBe('own tip')
    expect(el).toHaveAttribute('title', 'child')
    expect(el).toHaveAttribute('data-x', '1')
  })

  it('chains handlers child-first, and a defaultPrevented event skips the slot handler', async () => {
    const user = userEvent.setup(), order: string[] = []
    const { rerender } = render(<Slot onClick={() => order.push('slot')}><button onClick={() => order.push('child')}>go</button></Slot>)
    await user.click(screen.getByRole('button', { name: 'go' }))
    expect(order).toEqual(['child', 'slot'])
    order.length = 0
    rerender(<Slot onClick={() => order.push('slot')}><button onClick={e => { order.push('child'); e.preventDefault() }}>go</button></Slot>)
    await user.click(screen.getByRole('button', { name: 'go' }))
    expect(order).toEqual(['child'])
  })

  it('composes the slot ref with the child ref (React 19 ref as a prop)', () => {
    const outer = createRef<HTMLElement>(), inner = createRef<HTMLButtonElement>(), cb = vi.fn()
    const { unmount } = render(<Slot ref={composeRefs(outer, cb)}><button ref={inner}>x</button></Slot>)
    const btn = screen.getByRole('button')
    expect(outer.current).toBe(btn)
    expect(inner.current).toBe(btn)
    expect(cb).toHaveBeenCalledWith(btn)
    unmount()
    expect(outer.current).toBeNull()
    expect(inner.current).toBeNull()
    expect(cb).toHaveBeenLastCalledWith(null)
  })

  it('needs exactly one element child', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(() => render(<Slot>text</Slot>)).toThrow(/exactly one React element/)
    expect(() => render(<Slot><><i /><b /></></Slot>)).toThrow(/exactly one React element/)
    expect(() => render(<Slot>{[<i key="1" />, <b key="2" />]}</Slot>)).toThrow(/exactly one React element/)
    spy.mockRestore()
  })

  it('mergeSlotProps keeps the slot handler when the child has none', () => {
    const f = vi.fn()
    const merged = mergeSlotProps({ onClick: f, className: 'x' }, { className: undefined })
    expect(merged.onClick).toBe(f)
    expect(merged.className).toBe('x')
  })

  it('Button asChild renders a link with the button look; disabled blocks it', async () => {
    const user = userEvent.setup(), navigate = vi.fn()
    const { rerender } = render(<Button asChild variant="primary"><FakeLink href="/pricing" navigate={navigate}>Pricing</FakeLink></Button>)
    const link = screen.getByRole('link', { name: 'Pricing' })
    expect(link).toHaveAttribute('href', '/pricing')
    expect(link.className).toContain('inline-flex')
    expect(link).not.toHaveAttribute('type')
    await user.click(link)
    expect(navigate).toHaveBeenCalledWith('/pricing')
    navigate.mockClear()
    rerender(<Button asChild disabled><FakeLink href="/pricing" navigate={navigate}>Pricing</FakeLink></Button>)
    expect(screen.getByRole('link', { name: 'Pricing' })).toHaveAttribute('aria-disabled', 'true')
    fireEvent.click(screen.getByRole('link', { name: 'Pricing' }))
    expect(navigate).not.toHaveBeenCalled()
  })

  it('IconButton asChild puts the icon inside your element and names it', () => {
    render(<IconButton asChild icon="settings" label="Settings"><a href="/settings" /></IconButton>)
    const link = screen.getByRole('link', { name: 'Settings' })
    expect(link.querySelector('svg')).not.toBeNull()
    expect(link).toHaveAttribute('href', '/settings')
  })
})

describe('Tabs parts', () => {
  function Parts(p: { value?: string; onValueChange?: (v: string) => void; orientation?: 'horizontal' | 'vertical'; lazy?: boolean; keepMounted?: boolean; activationMode?: 'automatic' | 'manual' }) {
    return (
      <Tabs.Root defaultValue="a" {...p}>
        <Tabs.List aria-label="Sections">
          <Tabs.Trigger value="a">Account</Tabs.Trigger>
          <Tabs.Trigger value="b">Billing</Tabs.Trigger>
          <Tabs.Trigger value="x" disabled>Locked</Tabs.Trigger>
          <Tabs.Trigger value="c">Team</Tabs.Trigger>
        </Tabs.List>
        <Tabs.Content value="a">Account panel</Tabs.Content>
        <Tabs.Content value="b"><input aria-label="Billing email" /></Tabs.Content>
        <Tabs.Content value="c">Team panel</Tabs.Content>
      </Tabs.Root>
    )
  }

  it('links tabs and panels and starts on defaultValue', () => {
    render(<Parts />)
    const tab = screen.getByRole('tab', { name: 'Account' }), panel = screen.getByRole('tabpanel', { name: 'Account' })
    expect(tab).toHaveAttribute('aria-selected', 'true')
    expect(tab).toHaveAttribute('aria-controls', panel.id)
    expect(screen.getByRole('tablist', { name: 'Sections' })).toHaveAttribute('aria-orientation', 'horizontal')
    expect(screen.queryByText('Team panel')).toBeNull()
  })

  it('is controlled with value + onValueChange', async () => {
    const user = userEvent.setup(), onValueChange = vi.fn()
    const { rerender } = render(<Parts value="a" onValueChange={onValueChange} />)
    await user.click(screen.getByRole('tab', { name: 'Team' }))
    expect(onValueChange).toHaveBeenCalledWith('c')
    expect(screen.getByRole('tab', { name: 'Account' })).toHaveAttribute('aria-selected', 'true') // parent didn't change it
    rerender(<Parts value="c" onValueChange={onValueChange} />)
    expect(screen.getByRole('tab', { name: 'Team' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByText('Team panel')).toBeInTheDocument()
  })

  it('arrows skip disabled tabs and wrap; vertical uses ↑/↓, not ←/→', async () => {
    const user = userEvent.setup()
    const { unmount } = render(<Parts />)
    await user.click(screen.getByRole('tab', { name: 'Billing' }))
    await user.keyboard('{ArrowRight}')
    expect(document.activeElement).toBe(screen.getByRole('tab', { name: 'Team' }))
    expect(screen.getByRole('tab', { name: 'Team' })).toHaveAttribute('aria-selected', 'true')
    await user.keyboard('{ArrowRight}')
    expect(document.activeElement).toBe(screen.getByRole('tab', { name: 'Account' }))
    unmount()
    render(<Parts orientation="vertical" />)
    expect(screen.getByRole('tablist')).toHaveAttribute('aria-orientation', 'vertical')
    await user.click(screen.getByRole('tab', { name: 'Account' }))
    await user.keyboard('{ArrowRight}')
    expect(document.activeElement).toBe(screen.getByRole('tab', { name: 'Account' }))
    await user.keyboard('{ArrowDown}')
    expect(document.activeElement).toBe(screen.getByRole('tab', { name: 'Billing' }))
    await user.keyboard('{End}')
    expect(document.activeElement).toBe(screen.getByRole('tab', { name: 'Team' }))
    await user.keyboard('{ArrowUp}{ArrowUp}')
    expect(screen.getByRole('tab', { name: 'Account' })).toHaveAttribute('aria-selected', 'true')
  })

  it('horizontal Home/End select the first and last enabled tabs; onChange is an alias of onValueChange', async () => {
    const user = userEvent.setup(), onValueChange = vi.fn(), onChange = vi.fn()
    render(<Tabs.Root defaultValue="b" onValueChange={onValueChange} onChange={onChange}>
      <Tabs.List aria-label="Sections">
        <Tabs.Trigger value="z" disabled>Locked first</Tabs.Trigger>
        <Tabs.Trigger value="a">Account</Tabs.Trigger><Tabs.Trigger value="b">Billing</Tabs.Trigger><Tabs.Trigger value="c">Team</Tabs.Trigger>
        <Tabs.Trigger value="y" disabled>Locked last</Tabs.Trigger>
      </Tabs.List>
      <Tabs.Content value="a">Account panel</Tabs.Content><Tabs.Content value="b">Billing panel</Tabs.Content><Tabs.Content value="c">Team panel</Tabs.Content>
    </Tabs.Root>)
    await user.tab() // the selected tab is the Tab stop
    expect(screen.getByRole('tab', { name: 'Billing' })).toHaveFocus()
    await user.keyboard('{End}')
    expect(screen.getByRole('tab', { name: 'Team' })).toHaveFocus()
    expect(screen.getByRole('tab', { name: 'Team' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('tabpanel', { name: 'Team' })).toHaveTextContent('Team panel')
    await user.keyboard('{Home}')
    expect(screen.getByRole('tab', { name: 'Account' })).toHaveFocus()
    expect(onValueChange.mock.calls.map(c => c[0])).toEqual(['c', 'a'])
    expect(onChange.mock.calls).toEqual(onValueChange.mock.calls)
  })

  it('manual activation moves focus with arrows and selects with Enter', async () => {
    const user = userEvent.setup()
    render(<Parts activationMode="manual" />)
    await user.click(screen.getByRole('tab', { name: 'Account' }))
    await user.keyboard('{ArrowRight}')
    expect(document.activeElement).toBe(screen.getByRole('tab', { name: 'Billing' }))
    expect(screen.getByRole('tab', { name: 'Billing' })).toHaveAttribute('aria-selected', 'false')
    await user.keyboard('{Enter}')
    expect(screen.getByRole('tab', { name: 'Billing' })).toHaveAttribute('aria-selected', 'true')
  })

  it('lazy mounts a panel on its first visit and keeps it (with its state)', async () => {
    const user = userEvent.setup()
    render(<Parts lazy />)
    expect(screen.queryByRole('textbox', { name: 'Billing email' })).toBeNull()
    await user.click(screen.getByRole('tab', { name: 'Billing' }))
    await user.type(screen.getByRole('textbox', { name: 'Billing email' }), 'a@b.co')
    await user.click(screen.getByRole('tab', { name: 'Account' }))
    const kept = screen.getByRole('textbox', { name: 'Billing email', hidden: true })
    expect(kept.closest('[role=tabpanel]')).toHaveAttribute('hidden')
    expect(screen.queryByText('Team panel')).toBeNull() // never visited
    await user.click(screen.getByRole('tab', { name: 'Billing' }))
    expect(screen.getByRole('textbox', { name: 'Billing email' })).toHaveValue('a@b.co')
  })

  it('keepMounted and forceMount keep hidden panels in the DOM', () => {
    const { unmount } = render(<Parts keepMounted />)
    expect(screen.getByText('Team panel')).not.toBeVisible()
    unmount()
    render(<Tabs.Root defaultValue="a"><Tabs.List><Tabs.Trigger value="a">A</Tabs.Trigger><Tabs.Trigger value="b">B</Tabs.Trigger></Tabs.List>
      <Tabs.Content value="a">A panel</Tabs.Content><Tabs.Content value="b" forceMount>B panel</Tabs.Content></Tabs.Root>)
    expect(screen.getByText('B panel')).not.toBeVisible()
    expect(screen.getByRole('tab', { name: 'B' })).toHaveAttribute('aria-controls')
  })

  it('a Root without a selection still has one Tab stop (the first enabled tab)', () => {
    render(<Tabs.Root><Tabs.List><Tabs.Trigger value="x" disabled>X</Tabs.Trigger><Tabs.Trigger value="a">A</Tabs.Trigger><Tabs.Trigger value="b">B</Tabs.Trigger></Tabs.List></Tabs.Root>)
    expect(screen.getAllByRole('tab').filter(t => t.tabIndex === 0).map(t => t.textContent)).toEqual(['A'])
  })

  it('the config API renders the same structure as before', () => {
    render(<Tabs items={[{ value: 'o', label: 'Overview', content: 'Overview panel' }, { value: 'a', label: 'Activity', content: 'Activity panel' }]} />)
    const list = screen.getByRole('tablist')
    expect(within(list).getAllByRole('tab').map(t => [t.textContent, t.getAttribute('aria-selected'), t.tabIndex])).toEqual([['Overview', 'true', 0], ['Activity', 'false', -1]])
    expect(screen.getByRole('tabpanel')).toHaveTextContent('Overview panel')
  })
})

describe('Dialog parts', () => {
  function Parts({ open, onOpenChange }: { open?: boolean; onOpenChange?: (v: boolean) => void }) {
    return (
      <Dialog.Root open={open} onOpenChange={onOpenChange}>
        <Dialog.Trigger>Rename</Dialog.Trigger>
        <Dialog.Content>
          <Dialog.Title>Rename project</Dialog.Title>
          <Dialog.Description>Shown in the sidebar.</Dialog.Description>
          <input aria-label="Name" />
          <Dialog.Footer><Dialog.Close>Cancel</Dialog.Close><Dialog.Close variant="primary">Save</Dialog.Close></Dialog.Footer>
        </Dialog.Content>
      </Dialog.Root>
    )
  }

  it('opens from its Trigger, is named and described, and Close returns focus to the trigger', async () => {
    const user = userEvent.setup()
    render(<Parts />)
    const trigger = screen.getByRole('button', { name: 'Rename' })
    expect(trigger).toHaveAttribute('aria-haspopup', 'dialog')
    await user.click(trigger)
    const dialog = await screen.findByRole('dialog', { name: 'Rename project' })
    await waitFor(() => expect(dialog).toHaveAccessibleDescription('Shown in the sidebar.'))
    await waitFor(() => expect(dialog.contains(document.activeElement)).toBe(true))
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    await waitFor(() => expect(document.activeElement).toBe(trigger))
  })

  it('is controlled with open + onOpenChange (Escape asks to close)', async () => {
    const user = userEvent.setup(), onOpenChange = vi.fn()
    render(<Parts open onOpenChange={onOpenChange} />)
    await screen.findByRole('dialog')
    await waitFor(() => expect(screen.getByRole('dialog').contains(document.activeElement)).toBe(true))
    await user.keyboard('{Escape}')
    expect(onOpenChange).toHaveBeenCalledWith(false)
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })

  it('focuses the first field, and traps Tab and Shift+Tab inside the open dialog', async () => {
    // jsdom lays nothing out, so every element would count as hidden: give them a box
    vi.spyOn(Element.prototype, 'getClientRects').mockReturnValue([{ width: 10, height: 10 }] as unknown as DOMRectList)
    const user = userEvent.setup()
    render(<><button>outside</button><Parts /></>)
    await user.click(screen.getByRole('button', { name: 'Rename' }))
    const dialog = await screen.findByRole('dialog', { name: 'Rename project' })
    await waitFor(() => expect(within(dialog).getByRole('textbox', { name: 'Name' })).toHaveFocus())
    const stops = [...within(dialog).queryAllByRole('textbox'), ...within(dialog).getAllByRole('button')]
    const start = document.activeElement
    const seen = new Set<Element | null>()
    for (let i = 0; i < stops.length; i++) {
      await user.tab()
      expect(dialog.contains(document.activeElement), `Tab ${i + 1}`).toBe(true)
      seen.add(document.activeElement)
    }
    expect(seen.size).toBe(stops.length) // every stop visited once, then round again
    expect(document.activeElement).toBe(start)
    for (let i = 0; i < stops.length; i++) {
      await user.tab({ shift: true })
      expect(dialog.contains(document.activeElement), `Shift+Tab ${i + 1}`).toBe(true)
    }
    expect(document.activeElement).toBe(start)
    expect(screen.getByRole('button', { name: 'outside', hidden: true })).not.toHaveFocus()
  })

  it('a click on the backdrop closes a Dialog, but not an AlertDialog', async () => {
    const user = userEvent.setup()
    /** The layer behind the panel that takes clicks outside it. */
    const backdrop = (panel: HTMLElement) => [...document.querySelectorAll<HTMLElement>('[aria-hidden="true"]')].find(el => !el.contains(panel) && !panel.contains(el) && el.childElementCount === 0 && el.parentElement?.contains(panel))!
    const { unmount } = render(<Parts />)
    await user.click(screen.getByRole('button', { name: 'Rename' }))
    const dialog = await screen.findByRole('dialog')
    await user.click(backdrop(dialog))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    unmount()
    render(<AlertDialog.Root defaultOpen><AlertDialog.Content><AlertDialog.Title>Sure?</AlertDialog.Title><AlertDialog.Footer><AlertDialog.Cancel /></AlertDialog.Footer></AlertDialog.Content></AlertDialog.Root>)
    const alert = await screen.findByRole('alertdialog')
    await user.click(backdrop(alert))
    expect(screen.getByRole('alertdialog', { name: 'Sure?' })).toBeInTheDocument()
  })

  it('Trigger asChild makes your element the trigger', async () => {
    const user = userEvent.setup()
    render(<Dialog.Root><Dialog.Trigger asChild><a href="#x" role="button">Open it</a></Dialog.Trigger><Dialog.Content><Dialog.Title>Hi</Dialog.Title></Dialog.Content></Dialog.Root>)
    const a = screen.getByRole('button', { name: 'Open it' })
    expect(a.tagName).toBe('A')
    await user.click(a)
    expect(await screen.findByRole('dialog', { name: 'Hi' })).toBeInTheDocument()
  })

  it('Sheet parts: titled panel with a default ✕ Close', async () => {
    const user = userEvent.setup()
    render(<Sheet.Root defaultOpen><Sheet.Content side="left"><Sheet.Header><Sheet.Title>Filters</Sheet.Title><Sheet.Close /></Sheet.Header>Body</Sheet.Content></Sheet.Root>)
    const sheet = await screen.findByRole('dialog', { name: 'Filters' })
    await user.click(within(sheet).getByRole('button', { name: 'Close' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  })

  it('the config Dialog still renders a named modal dialog with its footer', async () => {
    render(<Dialog open onOpenChange={() => {}} title="Delete project" description="Gone for good." footer={<button>Delete</button>} />)
    const d = await screen.findByRole('dialog', { name: 'Delete project' })
    expect(d).toHaveAttribute('aria-modal', 'true')
    await waitFor(() => expect(d).toHaveAccessibleDescription('Gone for good.'))
    expect(within(d).getByRole('heading', { level: 2, name: 'Delete project' })).toBeInTheDocument()
    expect(within(d).getByRole('button', { name: 'Delete' })).toBeInTheDocument()
  })
})

describe('AlertDialog parts', () => {
  it('focuses Cancel, and an async Action spins then closes', async () => {
    const user = userEvent.setup()
    let resolve = () => {}
    const onConfirm = vi.fn(() => new Promise<void>(r => { resolve = r }))
    render(
      <AlertDialog.Root>
        <AlertDialog.Trigger variant="outline-danger">Archive</AlertDialog.Trigger>
        <AlertDialog.Content>
          <AlertDialog.Title>Archive project?</AlertDialog.Title>
          <AlertDialog.Description>It leaves the sidebar.</AlertDialog.Description>
          <AlertDialog.Footer><AlertDialog.Cancel /><AlertDialog.Action onConfirm={onConfirm}>Archive it</AlertDialog.Action></AlertDialog.Footer>
        </AlertDialog.Content>
      </AlertDialog.Root>,
    )
    await user.click(screen.getByRole('button', { name: 'Archive' }))
    const dlg = await screen.findByRole('alertdialog', { name: 'Archive project?' })
    await waitFor(() => expect(document.activeElement).toBe(within(dlg).getByRole('button', { name: 'Cancel' })))
    await user.click(within(dlg).getByRole('button', { name: 'Archive it' }))
    expect(onConfirm).toHaveBeenCalled()
    await waitFor(() => expect(dlg).toHaveAttribute('aria-busy', 'true'))
    expect(within(dlg).getByRole('button', { name: 'Cancel' })).toBeDisabled()
    await act(async () => { resolve() })
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull())
  })

  it('shows a rejected Action’s error and stays open', async () => {
    const user = userEvent.setup()
    render(
      <AlertDialog.Root defaultOpen>
        <AlertDialog.Content>
          <AlertDialog.Title>Revoke?</AlertDialog.Title><AlertDialog.Description>Apps stop working.</AlertDialog.Description>
          <AlertDialog.Footer><AlertDialog.Cancel /><AlertDialog.Action onConfirm={() => Promise.reject(new Error('Network down'))}>Revoke</AlertDialog.Action></AlertDialog.Footer>
        </AlertDialog.Content>
      </AlertDialog.Root>,
    )
    const dlg = await screen.findByRole('alertdialog')
    await user.click(within(dlg).getByRole('button', { name: 'Revoke' }))
    expect(await within(dlg).findByRole('alert')).toHaveTextContent('Network down')
  })
})

describe('Popover, Tooltip and HoverCard parts', () => {
  it('Popover: trigger asChild, Close, controlled and uncontrolled', async () => {
    const user = userEvent.setup(), onOpenChange = vi.fn()
    render(
      <Popover.Root onOpenChange={onOpenChange}>
        <Popover.Trigger asChild><button>Share</button></Popover.Trigger>
        <Popover.Content side="right" align="center" arrow aria-label="Share options"><Popover.Close>Done</Popover.Close></Popover.Content>
      </Popover.Root>,
    )
    const trigger = screen.getByRole('button', { name: 'Share' })
    expect(trigger).toHaveAttribute('aria-expanded', 'false')
    await user.click(trigger)
    expect(onOpenChange).toHaveBeenLastCalledWith(true)
    const panel = await screen.findByRole('dialog', { name: 'Share options' })
    await waitFor(() => expect(document.activeElement).toBe(within(panel).getByRole('button', { name: 'Done' })))
    await user.click(within(panel).getByRole('button', { name: 'Done' }))
    expect(onOpenChange).toHaveBeenLastCalledWith(false)
    await waitFor(() => expect(document.activeElement).toBe(trigger))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  })

  it('Popover: a controlled one shows only what open says, and only asks to change', async () => {
    const user = userEvent.setup(), onOpenChange = vi.fn()
    const pop = (open: boolean) => (
      <Popover.Root open={open} onOpenChange={onOpenChange}>
        <Popover.Trigger>Share</Popover.Trigger>
        <Popover.Content aria-label="Share options"><Popover.Close>Done</Popover.Close></Popover.Content>
      </Popover.Root>
    )
    const { rerender } = render(pop(false))
    const trigger = screen.getByRole('button', { name: 'Share' })
    await user.click(trigger)
    expect(onOpenChange).toHaveBeenLastCalledWith(true)
    expect(screen.queryByRole('dialog')).toBeNull() // the parent kept it closed
    expect(trigger).toHaveAttribute('aria-expanded', 'false')
    rerender(pop(true))
    const panel = await screen.findByRole('dialog', { name: 'Share options' })
    expect(trigger).toHaveAttribute('aria-expanded', 'true')
    await user.click(within(panel).getByRole('button', { name: 'Done' }))
    expect(onOpenChange).toHaveBeenLastCalledWith(false)
    expect(screen.getByRole('dialog', { name: 'Share options' })).toBeInTheDocument() // still open until the parent says so
    rerender(pop(false))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  })

  it('Tooltip: shows on focus, describes its trigger, Escape hides; controlled open', async () => {
    const user = userEvent.setup()
    const { unmount } = render(<Tooltip.Root delay={0}><Tooltip.Trigger asChild><button>Bold</button></Tooltip.Trigger><Tooltip.Content side="bottom" arrow>Bold ⌘B</Tooltip.Content></Tooltip.Root>)
    await user.tab()
    const tip = await screen.findByRole('tooltip')
    expect(screen.getByRole('button', { name: 'Bold' })).toHaveAccessibleDescription('Bold ⌘B')
    expect(tip).toHaveTextContent('Bold ⌘B')
    await user.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('tooltip')).toBeNull())
    unmount()
    render(<Tooltip.Root open><Tooltip.Trigger>Help</Tooltip.Trigger><Tooltip.Content>Always shown</Tooltip.Content></Tooltip.Root>)
    expect(screen.getByRole('tooltip')).toHaveTextContent('Always shown')
  })

  it('Tooltip: hover opens it after `delay` and leaving closes it at once', async () => {
    fakeTimers()
    render(<Tooltip.Root delay={400}><Tooltip.Trigger asChild><button>Bold</button></Tooltip.Trigger><Tooltip.Content>Bold ⌘B</Tooltip.Content></Tooltip.Root>)
    const btn = screen.getByRole('button', { name: 'Bold' })
    fireEvent.pointerEnter(btn, { pointerType: 'mouse' })
    await tick(399)
    expect(screen.queryByRole('tooltip')).toBeNull()
    await tick(1)
    expect(screen.getByRole('tooltip')).toHaveTextContent('Bold ⌘B')
    fireEvent.pointerLeave(btn, { pointerType: 'mouse' })
    await tick(1)
    expect(screen.queryByRole('tooltip')).toBeNull()
    // a pointer that leaves before the delay never opens it
    fireEvent.pointerEnter(btn, { pointerType: 'mouse' })
    await tick(200)
    fireEvent.pointerLeave(btn, { pointerType: 'mouse' })
    await tick(1000)
    expect(screen.queryByRole('tooltip')).toBeNull()
  })

  it('HoverCard: hover or focus opens it after openDelay, leaving closes it after closeDelay', async () => {
    fakeTimers()
    const onOpenChange = vi.fn()
    render(<HoverCard.Root openDelay={300} closeDelay={150} onOpenChange={onOpenChange}><HoverCard.Trigger asChild><a href="#u">@alex</a></HoverCard.Trigger><HoverCard.Content side="bottom">Alex Lee</HoverCard.Content></HoverCard.Root>)
    const link = screen.getByRole('link', { name: '@alex' })
    fireEvent.pointerEnter(link, { pointerType: 'mouse' })
    await tick(299)
    expect(screen.queryByRole('tooltip')).toBeNull()
    await tick(1)
    expect(screen.getByRole('tooltip')).toHaveTextContent('Alex Lee')
    expect(link).toHaveAccessibleDescription('Alex Lee')
    fireEvent.pointerLeave(link, { pointerType: 'mouse' })
    await tick(149)
    expect(screen.getByRole('tooltip')).toBeInTheDocument() // time to reach the card
    await tick(1)
    await tick(500) // and its exit
    expect(screen.queryByRole('tooltip')).toBeNull()
    expect(onOpenChange.mock.calls.map(c => c[0])).toEqual([true, false])
    // keyboard focus opens it the same way
    act(() => { link.focus() })
    await tick(300)
    expect(screen.getByRole('tooltip')).toHaveTextContent('Alex Lee')
    act(() => { link.blur() })
    await tick(650)
    expect(screen.queryByRole('tooltip')).toBeNull()
  })

  it('HoverCard: defaultOpen starts open; a controlled one follows open', () => {
    const { unmount } = render(<HoverCard.Root defaultOpen><HoverCard.Trigger asChild><a href="#u">@alex</a></HoverCard.Trigger><HoverCard.Content side="bottom">Alex Lee</HoverCard.Content></HoverCard.Root>)
    expect(screen.getByRole('tooltip')).toHaveTextContent('Alex Lee')
    unmount()
    const { rerender } = render(<HoverCard.Root open={false}><HoverCard.Trigger asChild><a href="#u">@alex</a></HoverCard.Trigger><HoverCard.Content side="bottom">Alex Lee</HoverCard.Content></HoverCard.Root>)
    expect(screen.queryByText('Alex Lee')).toBeNull()
    rerender(<HoverCard.Root open><HoverCard.Trigger asChild><a href="#u">@alex</a></HoverCard.Trigger><HoverCard.Content side="bottom">Alex Lee</HoverCard.Content></HoverCard.Root>)
    expect(screen.getByRole('tooltip')).toHaveTextContent('Alex Lee')
  })
})

describe('DropdownMenu parts', () => {
  function Menu({ onPick = () => {}, open, onOpenChange }: { onPick?: (s: string) => void; open?: boolean; onOpenChange?: (v: boolean) => void }) {
    const [grid, setGrid] = useState(true)
    const [density, setDensity] = useState('comfortable')
    return (
      <DropdownMenu.Root open={open} onOpenChange={onOpenChange}>
        <DropdownMenu.Trigger>View</DropdownMenu.Trigger>
        <DropdownMenu.Content aria-label="View options">
          <DropdownMenu.Label>Show</DropdownMenu.Label>
          <DropdownMenu.CheckboxItem checked={grid} onCheckedChange={setGrid}>Grid</DropdownMenu.CheckboxItem>
          <DropdownMenu.RadioGroup value={density} onValueChange={setDensity} aria-label="Density">
            <DropdownMenu.RadioItem value="compact">Compact</DropdownMenu.RadioItem>
            <DropdownMenu.RadioItem value="comfortable">Comfortable</DropdownMenu.RadioItem>
          </DropdownMenu.RadioGroup>
          <DropdownMenu.Separator />
          <DropdownMenu.Sub>
            <DropdownMenu.SubTrigger>Export</DropdownMenu.SubTrigger>
            <DropdownMenu.SubContent>
              <DropdownMenu.Item onSelect={() => onPick('png')}>PNG</DropdownMenu.Item>
              <DropdownMenu.Item onSelect={() => onPick('svg')}>SVG</DropdownMenu.Item>
            </DropdownMenu.SubContent>
          </DropdownMenu.Sub>
          <DropdownMenu.Item disabled>Delete</DropdownMenu.Item>
          <DropdownMenu.Item onSelect={e => { onPick('copy'); e.preventDefault() }}>Copy link<DropdownMenu.Shortcut>⌘L</DropdownMenu.Shortcut></DropdownMenu.Item>
          <DropdownMenu.Item onSelect={() => onPick('duplicate')}>Duplicate</DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Root>
    )
  }
  const focused = () => document.activeElement?.textContent

  it('opens with ↓ on the trigger and focuses the first item; ↑/↓ wrap and skip disabled rows', async () => {
    const user = userEvent.setup()
    render(<Menu />)
    const trigger = screen.getByRole('button', { name: 'View' })
    expect(trigger).toHaveAttribute('aria-haspopup', 'menu')
    trigger.focus()
    await user.keyboard('{ArrowDown}')
    await screen.findByRole('menu', { name: 'View options' })
    await waitFor(() => expect(focused()).toBe('Grid'))
    await user.keyboard('{End}')
    expect(focused()).toBe('Duplicate')
    await user.keyboard('{ArrowUp}{ArrowUp}')
    expect(focused()).toBe('Export') // Delete is disabled
    await user.keyboard('{ArrowDown}{ArrowDown}{ArrowDown}')
    expect(focused()).toBe('Grid') // wrapped
  })

  it('typeahead jumps by first letters and cycles a repeated letter', async () => {
    const user = userEvent.setup()
    render(<Menu />)
    await user.click(screen.getByRole('button', { name: 'View' }))
    await waitFor(() => expect(focused()).toBe('Grid'))
    await user.keyboard('c')
    expect(focused()).toBe('Compact')
    await user.keyboard('c')
    expect(focused()).toBe('Comfortable')
    await user.keyboard('c')
    expect(focused()).toBe('Copy link⌘L')
    vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(Date.now() + 2000)
    fireEvent.keyDown(document.activeElement!, { key: 'd' }); fireEvent.keyDown(document.activeElement!, { key: 'u' })
    expect(focused()).toBe('Duplicate')
    vi.useRealTimers()
  })

  it('checkbox and radio items toggle, announce their state and keep the menu open', async () => {
    const user = userEvent.setup()
    render(<Menu />)
    await user.click(screen.getByRole('button', { name: 'View' }))
    const grid = await screen.findByRole('menuitemcheckbox', { name: 'Grid' })
    expect(grid).toHaveAttribute('aria-checked', 'true')
    await user.click(grid)
    expect(grid).toHaveAttribute('aria-checked', 'false')
    const compact = screen.getByRole('menuitemradio', { name: 'Compact' })
    expect(compact).toHaveAttribute('aria-checked', 'false')
    compact.focus(); await user.keyboard('{Enter}')
    expect(compact).toHaveAttribute('aria-checked', 'true')
    expect(screen.getByRole('menuitemradio', { name: 'Comfortable' })).toHaveAttribute('aria-checked', 'false')
    expect(within(screen.getByRole('group', { name: 'Density' })).getAllByRole('menuitemradio')).toHaveLength(2)
    expect(screen.getByRole('menu')).toBeInTheDocument()
  })

  it('submenu: → opens and focuses its first item, ← closes it and returns to its trigger; picking closes everything', async () => {
    const user = userEvent.setup(), onPick = vi.fn()
    render(<Menu onPick={onPick} />)
    const trigger = screen.getByRole('button', { name: 'View' })
    await user.click(trigger)
    const sub = await screen.findByRole('menuitem', { name: 'Export' })
    expect(sub).toHaveAttribute('aria-haspopup', 'menu')
    sub.focus()
    await user.keyboard('{ArrowRight}')
    await waitFor(() => expect(focused()).toBe('PNG'))
    expect(sub).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByRole('menu', { name: 'Export' })).toBeInTheDocument()
    await user.keyboard('{ArrowDown}')
    expect(focused()).toBe('SVG')
    await user.keyboard('{ArrowLeft}')
    expect(document.activeElement).toBe(sub)
    await waitFor(() => expect(screen.queryByRole('menu', { name: 'Export' })).toBeNull())
    await user.keyboard('{Enter}')
    await waitFor(() => expect(focused()).toBe('PNG'))
    await user.keyboard('{Escape}') // Escape in a submenu closes only the submenu
    expect(document.activeElement).toBe(sub)
    expect(screen.getByRole('menu', { name: 'View options' })).toBeInTheDocument()
    await user.keyboard('{Enter}')
    await waitFor(() => expect(focused()).toBe('PNG'))
    await user.keyboard('{Enter}')
    expect(onPick).toHaveBeenCalledWith('png')
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull())
    expect(document.activeElement).toBe(trigger)
  })

  it('onSelect can keep the menu open with preventDefault; Escape closes and refocuses the trigger', async () => {
    const user = userEvent.setup(), onPick = vi.fn()
    render(<Menu onPick={onPick} />)
    const trigger = screen.getByRole('button', { name: 'View' })
    await user.click(trigger)
    await user.click(await screen.findByRole('menuitem', { name: /Copy link/ }))
    expect(onPick).toHaveBeenCalledWith('copy')
    expect(screen.getByRole('menu')).toBeInTheDocument()
    await user.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull())
    expect(document.activeElement).toBe(trigger)
  })

  it('is controlled with open + onOpenChange', async () => {
    const user = userEvent.setup(), onOpenChange = vi.fn()
    const { rerender } = render(<Menu open={false} onOpenChange={onOpenChange} />)
    await user.click(screen.getByRole('button', { name: 'View' }))
    expect(onOpenChange).toHaveBeenCalledWith(true)
    expect(screen.queryByRole('menu')).toBeNull()
    rerender(<Menu open onOpenChange={onOpenChange} />)
    expect(await screen.findByRole('menu')).toBeInTheDocument()
  })

  it('Item asChild renders a link row; MenuItem in the config DropdownMenu still closes on pick', async () => {
    const user = userEvent.setup(), pick = vi.fn()
    render(
      <>
        <DropdownMenu.Root defaultOpen><DropdownMenu.Trigger>Go</DropdownMenu.Trigger>
          <DropdownMenu.Content><DropdownMenu.Item asChild><a href="#inbox">Inbox</a></DropdownMenu.Item></DropdownMenu.Content></DropdownMenu.Root>
        <DropdownMenu trigger="Options"><MenuItem onSelect={pick}>Edit</MenuItem></DropdownMenu>
      </>,
    )
    const link = await screen.findByRole('menuitem', { name: 'Inbox' })
    expect(link.tagName).toBe('A')
    await user.click(screen.getByRole('button', { name: 'Options' }))
    await user.click(await screen.findByRole('menuitem', { name: 'Edit' }))
    expect(pick).toHaveBeenCalled()
    await waitFor(() => expect(screen.queryByRole('menuitem', { name: 'Edit' })).toBeNull())
  })
})

describe('ContextMenu parts', () => {
  function Board({ onOpenChange }: { onOpenChange?: (v: boolean) => void }) {
    const [done, setDone] = useState(false)
    return (
      <ContextMenu.Root onOpenChange={onOpenChange}>
        <ContextMenu.Trigger label="Board options">Board</ContextMenu.Trigger>
        <ContextMenu.Content aria-label="Board options">
          <ContextMenu.CheckboxItem checked={done} onCheckedChange={setDone}>Show done</ContextMenu.CheckboxItem>
          <ContextMenu.Item>Rename</ContextMenu.Item>
        </ContextMenu.Content>
      </ContextMenu.Root>
    )
  }

  it('opens on right-click and on Shift+F10, toggles checkbox items, and Escape returns focus to the area', async () => {
    const user = userEvent.setup(), onOpenChange = vi.fn()
    render(<Board onOpenChange={onOpenChange} />)
    const area = screen.getByRole('group', { name: 'Board options' })
    fireEvent.contextMenu(area, { clientX: 20, clientY: 20 })
    expect(onOpenChange).toHaveBeenLastCalledWith(true)
    const item = await screen.findByRole('menuitemcheckbox', { name: 'Show done' })
    await waitFor(() => expect(document.activeElement).toBe(item))
    await user.keyboard(' ')
    expect(item).toHaveAttribute('aria-checked', 'true')
    await user.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull())
    expect(onOpenChange).toHaveBeenLastCalledWith(false)
    expect(document.activeElement).toBe(area)
    await user.keyboard('{Shift>}{F10}{/Shift}')
    expect(await screen.findByRole('menu', { name: 'Board options' })).toBeInTheDocument()
  })

  it('the config ContextMenu (now on parts) still opens submenus by keyboard and runs the choice', async () => {
    const user = userEvent.setup(), email = vi.fn()
    render(<ContextMenu label="File options" items={[{ label: 'Open' }, { label: 'Share', items: [{ label: 'Copy link' }, { label: 'Email', onSelect: email }] }, '-', { label: 'Delete', danger: true }]}>File</ContextMenu>)
    const area = screen.getByRole('group', { name: 'File options' })
    area.focus()
    await user.keyboard('{Shift>}{F10}{/Shift}')
    await waitFor(() => expect(document.activeElement?.textContent).toBe('Open'))
    await user.keyboard('{ArrowDown}{ArrowRight}')
    await waitFor(() => expect(document.activeElement?.textContent).toBe('Copy link'))
    await user.keyboard('{ArrowDown}{Enter}')
    expect(email).toHaveBeenCalled()
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull())
    expect(document.activeElement).toBe(area)
  })
})

describe('Accordion parts', () => {
  function Parts(p: { type?: 'single' | 'multiple'; collapsible?: boolean }) {
    const items = (
      <>
        <Accordion.Item value="a"><Accordion.Trigger>Shipping</Accordion.Trigger><Accordion.Content>Ships in 2 days</Accordion.Content></Accordion.Item>
        <Accordion.Item value="b"><Accordion.Trigger>Returns</Accordion.Trigger><Accordion.Content forceMount><input aria-label="Reason" /></Accordion.Content></Accordion.Item>
        <Accordion.Item value="c" disabled><Accordion.Trigger>Warranty</Accordion.Trigger><Accordion.Content>Two years</Accordion.Content></Accordion.Item>
      </>
    )
    return p.type === 'multiple' ? <Accordion.Root type="multiple" defaultValue={['a']}>{items}</Accordion.Root> : <Accordion.Root type="single" defaultValue="a" collapsible={p.collapsible}>{items}</Accordion.Root>
  }

  it('single: one open at a time; without collapsible the open one stays open', async () => {
    const user = userEvent.setup()
    render(<Parts />)
    const shipping = screen.getByRole('button', { name: 'Shipping' }), returns = screen.getByRole('button', { name: 'Returns' })
    expect(shipping).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByRole('region', { name: 'Shipping' })).toHaveTextContent('Ships in 2 days')
    await user.click(shipping)
    expect(shipping).toHaveAttribute('aria-expanded', 'true')
    await user.click(returns)
    expect(returns).toHaveAttribute('aria-expanded', 'true')
    expect(shipping).toHaveAttribute('aria-expanded', 'false')
    expect(screen.getByRole('button', { name: 'Warranty' })).toBeDisabled()
  })

  it('single collapsible closes again; multiple keeps several open', async () => {
    const user = userEvent.setup()
    const { unmount } = render(<Parts collapsible />)
    await user.click(screen.getByRole('button', { name: 'Shipping' }))
    expect(screen.getByRole('button', { name: 'Shipping' })).toHaveAttribute('aria-expanded', 'false')
    unmount()
    render(<Parts type="multiple" />)
    await user.click(screen.getByRole('button', { name: 'Returns' }))
    expect(screen.getAllByRole('button', { expanded: true }).map(b => b.textContent)).toEqual(['Shipping', 'Returns'])
  })

  it('forceMount keeps a closed panel (and its state) in the DOM; controlled value works', async () => {
    const user = userEvent.setup(), onValueChange = vi.fn()
    const { unmount } = render(<Parts />)
    expect(screen.getByRole('textbox', { hidden: true })).toHaveAttribute('aria-label', 'Reason') // hidden nodes have no accessible name
    expect(screen.queryByRole('textbox')).toBeNull()
    expect(screen.queryByText('Two years')).toBeNull()
    unmount()
    render(<Accordion.Root value="b" onValueChange={onValueChange}><Accordion.Item value="a"><Accordion.Trigger>A</Accordion.Trigger><Accordion.Content>a</Accordion.Content></Accordion.Item>
      <Accordion.Item value="b"><Accordion.Trigger>B</Accordion.Trigger><Accordion.Content>b</Accordion.Content></Accordion.Item></Accordion.Root>)
    await user.click(screen.getByRole('button', { name: 'A' }))
    expect(onValueChange).toHaveBeenCalledWith('a')
    expect(screen.getByRole('button', { name: 'B' })).toHaveAttribute('aria-expanded', 'true')
  })

  it('the config Accordion keeps its structure and index-based value', async () => {
    const user = userEvent.setup(), onValueChange = vi.fn()
    render(<Accordion defaultOpen={[0]} onValueChange={onValueChange} items={[{ title: 'One', content: 'First' }, { title: 'Two', content: 'Second' }]} />)
    expect(screen.getByRole('region', { name: 'One' })).toHaveTextContent('First')
    await user.click(screen.getByRole('button', { name: 'Two' }))
    expect(onValueChange).toHaveBeenLastCalledWith([1])
    await user.click(screen.getByRole('button', { name: 'Two' }))
    expect(onValueChange).toHaveBeenLastCalledWith([])
  })
})

describe('Toggle, ToggleGroup and Toolbar', () => {
  it('Toggle flips aria-pressed; controlled follows its prop', async () => {
    const user = userEvent.setup(), onPressedChange = vi.fn()
    const { rerender } = render(<Toggle aria-label="Mute">M</Toggle>)
    const t = screen.getByRole('button', { name: 'Mute' })
    expect(t).toHaveAttribute('aria-pressed', 'false')
    await user.click(t)
    expect(t).toHaveAttribute('aria-pressed', 'true')
    rerender(<Toggle aria-label="Mute" pressed={false} onPressedChange={onPressedChange}>M</Toggle>)
    await user.click(t)
    expect(onPressedChange).toHaveBeenCalledWith(true)
    expect(t).toHaveAttribute('aria-pressed', 'false')
  })

  it('single ToggleGroup is a radio group: one Tab stop, arrows move and select', async () => {
    const user = userEvent.setup(), onValueChange = vi.fn()
    render(<><button>before</button><ToggleGroup type="single" defaultValue="week" onValueChange={onValueChange} aria-label="Range">
      <ToggleGroup.Item value="day">Day</ToggleGroup.Item><ToggleGroup.Item value="week">Week</ToggleGroup.Item><ToggleGroup.Item value="month">Month</ToggleGroup.Item>
    </ToggleGroup></>)
    const group = screen.getByRole('radiogroup', { name: 'Range' })
    const radios = within(group).getAllByRole('radio')
    expect(radios.map(r => r.getAttribute('aria-checked'))).toEqual(['false', 'true', 'false'])
    expect(radios.filter(r => r.tabIndex === 0)).toEqual([radios[1]])
    await user.click(screen.getByRole('button', { name: 'before' }))
    await user.tab()
    expect(document.activeElement).toBe(radios[1])
    await user.keyboard('{ArrowRight}')
    expect(document.activeElement).toBe(radios[2])
    expect(radios[2]).toHaveAttribute('aria-checked', 'true')
    expect(onValueChange).toHaveBeenLastCalledWith('month')
    await user.click(radios[2]) // not deselectable by default
    expect(radios[2]).toHaveAttribute('aria-checked', 'true')
  })

  it('multiple ToggleGroup uses aria-pressed: arrows only move focus, Space toggles', async () => {
    const user = userEvent.setup(), onValueChange = vi.fn()
    render(<ToggleGroup type="multiple" defaultValue={['b']} onValueChange={onValueChange} aria-label="Style">
      <ToggleGroup.Item value="b" aria-label="Bold">B</ToggleGroup.Item><ToggleGroup.Item value="i" aria-label="Italic">I</ToggleGroup.Item><ToggleGroup.Item value="u" aria-label="Underline" disabled>U</ToggleGroup.Item>
    </ToggleGroup>)
    expect(screen.getByRole('group', { name: 'Style' })).toBeInTheDocument()
    const bold = screen.getByRole('button', { name: 'Bold' }), italic = screen.getByRole('button', { name: 'Italic' })
    expect(bold).toHaveAttribute('aria-pressed', 'true')
    await user.tab()
    expect(document.activeElement).toBe(bold)
    await user.keyboard('{ArrowRight}')
    expect(document.activeElement).toBe(italic)
    expect(italic).toHaveAttribute('aria-pressed', 'false')
    await user.keyboard('{ArrowRight}') // the disabled one is skipped: wraps to Bold
    expect(document.activeElement).toBe(bold)
    await user.keyboard('{ArrowLeft} ')
    expect(italic).toHaveAttribute('aria-pressed', 'true')
    expect(onValueChange).toHaveBeenLastCalledWith(['b', 'i'])
  })

  it('ToggleGroup: loop={false} stops at the ends; vertical uses ↑/↓, not ←/→', async () => {
    const user = userEvent.setup()
    const { unmount } = render(<ToggleGroup type="single" defaultValue="day" loop={false} aria-label="Range">
      <ToggleGroup.Item value="day">Day</ToggleGroup.Item><ToggleGroup.Item value="week">Week</ToggleGroup.Item>
    </ToggleGroup>)
    await user.tab()
    expect(screen.getByRole('radio', { name: 'Day' })).toHaveFocus()
    await user.keyboard('{ArrowLeft}')
    expect(screen.getByRole('radio', { name: 'Day' })).toHaveFocus() // no wrap to the end
    await user.keyboard('{ArrowRight}{ArrowRight}')
    expect(screen.getByRole('radio', { name: 'Week' })).toHaveFocus() // no wrap to the start
    expect(screen.getByRole('radio', { name: 'Week' })).toHaveAttribute('aria-checked', 'true')
    unmount()
    render(<ToggleGroup type="single" defaultValue="top" orientation="vertical" aria-label="Edge">
      <ToggleGroup.Item value="top">Top</ToggleGroup.Item><ToggleGroup.Item value="bottom">Bottom</ToggleGroup.Item>
    </ToggleGroup>)
    expect(screen.getByRole('radiogroup', { name: 'Edge' })).toHaveAttribute('aria-orientation', 'vertical')
    await user.tab()
    await user.keyboard('{ArrowRight}')
    expect(screen.getByRole('radio', { name: 'Top' })).toHaveFocus()
    await user.keyboard('{ArrowDown}')
    expect(screen.getByRole('radio', { name: 'Bottom' })).toHaveFocus()
    expect(screen.getByRole('radio', { name: 'Bottom' })).toHaveAttribute('aria-checked', 'true')
    await user.keyboard('{ArrowUp}')
    expect(screen.getByRole('radio', { name: 'Top' })).toHaveFocus()
  })

  it('Toolbar: one Tab stop across buttons and toggle groups; arrows skip separators and disabled items; it remembers the last item', async () => {
    const user = userEvent.setup()
    render(
      <>
        <button>before</button>
        <Toolbar aria-label="Formatting">
          <Toolbar.ToggleGroup type="multiple" aria-label="Style"><Toolbar.ToggleItem value="b" aria-label="Bold">B</Toolbar.ToggleItem><Toolbar.ToggleItem value="i" aria-label="Italic">I</Toolbar.ToggleItem></Toolbar.ToggleGroup>
          <Toolbar.Separator />
          <Toolbar.ToggleGroup type="single" defaultValue="left" aria-label="Align"><Toolbar.ToggleItem value="left" aria-label="Left">L</Toolbar.ToggleItem><Toolbar.ToggleItem value="right" aria-label="Right">R</Toolbar.ToggleItem></Toolbar.ToggleGroup>
          <Toolbar.Button disabled>Off</Toolbar.Button>
          <Toolbar.Button>Link</Toolbar.Button>
        </Toolbar>
        <button>after</button>
      </>,
    )
    const bar = screen.getByRole('toolbar', { name: 'Formatting' })
    expect(bar).toHaveAttribute('aria-orientation', 'horizontal')
    await user.click(screen.getByRole('button', { name: 'before' }))
    await user.tab()
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Bold' }))
    await user.keyboard('{ArrowRight}{ArrowRight}')
    expect(document.activeElement).toBe(screen.getByRole('radio', { name: 'Left' }))
    await user.keyboard('{ArrowRight}')
    expect(document.activeElement).toBe(screen.getByRole('radio', { name: 'Right' }))
    expect(screen.getByRole('radio', { name: 'Left' })).toHaveAttribute('aria-checked', 'true') // in a toolbar arrows only move
    await user.keyboard(' ')
    expect(screen.getByRole('radio', { name: 'Right' })).toHaveAttribute('aria-checked', 'true')
    await user.keyboard('{ArrowRight}')
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Link' }))
    await user.keyboard('{Home}')
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Bold' }))
    await user.keyboard('{End}')
    await user.tab()
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'after' }))
    await user.tab({ shift: true })
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Link' }))
    expect(within(bar).getAllByRole('separator')).toHaveLength(1)
  })
})
