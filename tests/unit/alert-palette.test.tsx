// AlertDialog (focus, no outside dismiss, async confirm) and CommandPalette (groups, nested pages, async results with
// abort, recents, virtualised long lists).
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { AlertDialog, type Command, type CommandLoader, CommandPalette } from '../../src/lib/overlay'

describe('AlertDialog', () => {
  function Harness({ onConfirm, onOpenChange = () => {} }: { onConfirm: () => void | Promise<unknown>; onOpenChange?: (v: boolean) => void }) {
    const [open, setOpen] = useState(true)
    return <AlertDialog open={open} onOpenChange={v => { setOpen(v); onOpenChange(v) }} title="Delete workspace?" description="Everything in it goes too." confirmLabel="Delete" onConfirm={onConfirm} />
  }

  it('is an alertdialog named and described by its title and description, with focus on Cancel', async () => {
    render(<Harness onConfirm={() => {}} />)
    const dlg = await screen.findByRole('alertdialog', { name: 'Delete workspace?' })
    expect(dlg).toHaveAccessibleDescription('Everything in it goes too.')
    expect(dlg).toHaveAttribute('aria-modal', 'true')
    await waitFor(() => expect(screen.getByRole('button', { name: 'Cancel' })).toHaveFocus())
  })

  it('does not close on an outside click, but does on Escape and Cancel', async () => {
    const user = userEvent.setup()
    const change = vi.fn()
    render(<Harness onConfirm={() => {}} onOpenChange={change} />)
    const dlg = await screen.findByRole('alertdialog')
    const backdrop = dlg.parentElement!.previousElementSibling as HTMLElement
    fireEvent.click(backdrop)
    expect(screen.getByRole('alertdialog')).toBeInTheDocument()
    expect(change).not.toHaveBeenCalled()
    await waitFor(() => expect(screen.getByRole('button', { name: 'Cancel' })).toHaveFocus())
    await user.keyboard('{Escape}')
    expect(change).toHaveBeenLastCalledWith(false)
  })

  it('waits on an async confirm, shows its error, and closes once it succeeds', async () => {
    const user = userEvent.setup()
    const change = vi.fn()
    let settle: { resolve: () => void; reject: (e: Error) => void } = { resolve: () => {}, reject: () => {} }
    const confirm = vi.fn(() => new Promise<void>((resolve, reject) => { settle = { resolve, reject } }))
    render(<Harness onConfirm={confirm} onOpenChange={change} />)
    await user.click(await screen.findByRole('button', { name: 'Delete' }))
    expect(confirm).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('button', { name: /Delete/ })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled()
    expect(screen.getByRole('alertdialog')).toHaveAttribute('aria-busy', 'true')
    fireEvent.keyDown(screen.getByRole('alertdialog'), { key: 'Escape' }) // ignored while pending
    expect(change).not.toHaveBeenCalled()
    await act(async () => settle.reject(new Error('Network down')))
    expect(screen.getByRole('alert')).toHaveTextContent('Network down')
    expect(screen.getByRole('alertdialog')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Delete' }))
    await act(async () => settle.resolve())
    expect(change).toHaveBeenLastCalledWith(false)
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument())
  })
})

describe('CommandPalette', () => {
  const run = vi.fn()
  const commands: Command[] = [
    { id: 'new', label: 'New issue', group: 'Actions', run: () => run('new') },
    { id: 'status', label: 'Change status…', group: 'Actions', children: [
      { id: 'todo', label: 'Todo', run: () => run('todo') }, { id: 'done', label: 'Done', run: () => run('done') },
    ] },
    { id: 'inbox', label: 'Go to inbox', group: 'Navigation', run: () => run('inbox') },
  ]
  const Palette = (p: Partial<React.ComponentProps<typeof CommandPalette>>) => {
    const [open, setOpen] = useState(true)
    return <CommandPalette open={open} onOpenChange={setOpen} commands={commands} {...p} />
  }
  const options = () => within(screen.getByRole('listbox')).queryAllByRole('option').map(o => o.textContent?.replace(/↵$/, '').trim())

  it('groups entries under headings', async () => {
    render(<Palette />)
    const list = await screen.findByRole('listbox')
    expect(within(list).getByText('Actions')).toBeInTheDocument()
    expect(within(list).getByText('Navigation')).toBeInTheDocument()
    expect(options()).toEqual(['New issue', 'Change status…', 'Go to inbox'])
  })

  it('opens a nested page with Enter and goes back with Backspace on an empty search', async () => {
    const user = userEvent.setup()
    render(<Palette />)
    const input = await screen.findByRole('combobox')
    await user.type(input, 'status')
    await user.keyboard('{Enter}')
    expect(options()).toEqual(['Todo', 'Done'])
    expect(screen.getByRole('combobox')).toHaveValue('')
    expect(screen.getByRole('navigation', { name: 'Palette pages' })).toHaveTextContent('Change status…')
    await user.keyboard('{ArrowDown}{Enter}')
    await waitFor(() => expect(run).toHaveBeenCalledWith('done'))
    run.mockClear()
  })

  it('Backspace on an empty search pops the page and restores the query it was opened from', async () => {
    const user = userEvent.setup()
    render(<Palette />)
    const input = await screen.findByRole('combobox')
    await user.type(input, 'change')
    await user.keyboard('{Enter}')
    expect(options()).toEqual(['Todo', 'Done'])
    await user.keyboard('{Backspace}')
    expect(screen.getByRole('combobox')).toHaveValue('change')
    expect(options()).toEqual(['Change status…'])
  })

  it('loads async results debounced, aborting the superseded request, and ignores stale answers', async () => {
    const user = userEvent.setup()
    const calls: { q: string; signal: AbortSignal; resolve: (c: Command[]) => void }[] = []
    const load: CommandLoader = (q, { signal }) => new Promise(resolve => { calls.push({ q, signal, resolve }) })
    render(<Palette loadItems={load} debounce={10} />)
    const input = await screen.findByRole('combobox')
    await waitFor(() => expect(calls).toHaveLength(1)) // the empty query
    await user.type(input, 'fi')
    await waitFor(() => expect(calls.at(-1)!.q).toBe('fi'))
    expect(calls.slice(0, -1).every(c => c.signal.aborted)).toBe(true)
    expect(screen.getByRole('status', { name: 'Loading results' })).toBeInTheDocument()
    await user.type(input, 'x')
    await waitFor(() => expect(calls.at(-1)!.q).toBe('fix'))
    const fi = calls.find(c => c.q === 'fi')!
    expect(fi.signal.aborted).toBe(true)
    await act(async () => fi.resolve([{ id: 'stale', label: 'Stale result', run }])) // too late: ignored
    expect(screen.queryByText('Stale result')).not.toBeInTheDocument()
    await act(async () => calls.at(-1)!.resolve([{ id: 'i1', label: 'Fix login', group: 'Issues', run }]))
    expect(options()).toEqual(['Fix login'])
    expect(within(screen.getByRole('listbox')).getByText('Issues')).toBeInTheDocument()
  })

  it('shows a loader’s error', async () => {
    const load: CommandLoader = () => Promise.reject(new Error('Search is down'))
    render(<Palette loadItems={load} debounce={0} />)
    expect(await screen.findByRole('alert')).toHaveTextContent('Search is down')
  })

  it('remembers recently run entries as a Recent group', async () => {
    const user = userEvent.setup()
    const { unmount } = render(<Palette recents={2} recentKey="test-recents" />)
    await user.type(await screen.findByRole('combobox'), 'inbox')
    await user.keyboard('{Enter}')
    unmount()
    render(<Palette recents={2} recentKey="test-recents" />)
    const list = await screen.findByRole('listbox')
    expect(within(list).getByText('Recent')).toBeInTheDocument()
    expect(options()[0]).toBe('Go to inbox')
  })

  it('virtualises long result lists, keeping the active option rendered and counted', async () => {
    const user = userEvent.setup()
    const many: Command[] = Array.from({ length: 500 }, (_, i) => ({ id: `c${i}`, label: `Command ${i}`, group: 'All', run }))
    render(<CommandPalette open onOpenChange={() => {}} commands={many} />)
    const input = await screen.findByRole('combobox')
    expect(screen.getAllByRole('option').length).toBeLessThan(40)
    expect(screen.getAllByRole('option')[0]).toHaveAttribute('aria-setsize', '500')
    input.focus()
    for (let i = 0; i < 60; i++) await user.keyboard('{ArrowDown}')
    const active = document.getElementById(input.getAttribute('aria-activedescendant')!)
    expect(active).toHaveTextContent('Command 60')
    expect(active).toHaveAttribute('aria-posinset', '61')
  })
})
