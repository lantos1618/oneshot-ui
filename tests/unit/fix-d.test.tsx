// Package D: navigation (roving keys, MegaMenu, sidebar), feedback (AsyncButton, LikeButton, HoldToConfirm, Progress),
// data (DataTable sorting and empty state, JsonViewer paths), layout (TreeView) and Kanban.
import { act, fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { AsyncButton, CollapsibleSidebar, DataTable, HoldToConfirm, JsonViewer, LikeButton, MegaMenu, Progress, Tabs, ToggleGroup, TreeView } from '../../src/lib'
import { Kanban, type KanbanColumn } from '../../src/lib/kanban'

describe('D-H1: arrow keys skip disabled asChild items', () => {
  it('Tabs: ArrowRight skips an aria-disabled asChild tab', async () => {
    const user = userEvent.setup()
    render(
      <Tabs.Root defaultValue="a">
        <Tabs.List aria-label="Sections">
          <Tabs.Trigger value="a">A</Tabs.Trigger>
          <Tabs.Trigger value="b" disabled asChild><a href="#b">B</a></Tabs.Trigger>
          <Tabs.Trigger value="c">C</Tabs.Trigger>
        </Tabs.List>
      </Tabs.Root>,
    )
    const [a, b, c] = screen.getAllByRole('tab')
    expect(b).toHaveAttribute('aria-disabled', 'true')
    await user.click(a)
    await user.keyboard('{ArrowRight}')
    expect(document.activeElement).toBe(c)
    expect(c).toHaveAttribute('aria-selected', 'true')
    expect(b).toHaveAttribute('aria-selected', 'false')
  })

  it('ToggleGroup: ArrowRight skips an aria-disabled asChild item', async () => {
    const user = userEvent.setup()
    render(
      <ToggleGroup type="single" defaultValue="a" aria-label="View">
        <ToggleGroup.Item value="a">A</ToggleGroup.Item>
        <ToggleGroup.Item value="b" disabled asChild><a href="#b">B</a></ToggleGroup.Item>
        <ToggleGroup.Item value="c">C</ToggleGroup.Item>
      </ToggleGroup>,
    )
    const [a, b, c] = within(screen.getByRole('radiogroup')).getAllByRole('radio')
    await user.click(a)
    await user.keyboard('{ArrowRight}')
    expect(document.activeElement).toBe(c)
    expect(c).toHaveAttribute('aria-checked', 'true')
    expect(b).toHaveAttribute('aria-checked', 'false')
  })
})

describe('D-M1: modifier arrows stay with the browser', () => {
  it('Alt+ArrowLeft on a tab is not default-prevented and moves nothing', () => {
    render(<Tabs items={[{ value: 'a', label: 'A' }, { value: 'b', label: 'B' }]} defaultValue="b" />)
    const [a, b] = screen.getAllByRole('tab')
    b.focus()
    expect(fireEvent.keyDown(b, { key: 'ArrowLeft', altKey: true })).toBe(true)
    expect(document.activeElement).toBe(b)
    expect(a).toHaveAttribute('aria-selected', 'false')
  })
})

describe('D-H2: AsyncButton shows a failure', () => {
  it('a rejected onClick shows the error state and calls onError, with no unhandled rejection', async () => {
    const boom = new Error('offline'), onError = vi.fn()
    render(<AsyncButton onClick={() => Promise.reject(boom)} onError={onError}>Save</AsyncButton>)
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(await screen.findByRole('button', { name: /Couldn’t save/ })).toBeInTheDocument()
    expect(screen.queryByText('Saved')).toBeNull()
    expect(onError).toHaveBeenCalledWith(boom)
  })

  it('a resolved onClick shows the success label, then returns to idle', async () => {
    vi.useFakeTimers()
    let done!: () => void
    render(<AsyncButton onClick={() => new Promise<void>(r => { done = r })} successLabel="Published">Publish</AsyncButton>)
    fireEvent.click(screen.getByRole('button', { name: 'Publish' }))
    expect(screen.queryByText('Published')).toBeNull()
    await act(async () => { done() })
    expect(screen.getByRole('button', { name: /Published/ })).toBeInTheDocument()
    act(() => { vi.advanceTimersByTime(1600) })
    expect(screen.getByRole('button', { name: /Publish/ })).toBeEnabled() // idle again (enabled only while idle)
  })
})

describe('D-H3: TreeView keeps a Tab stop', () => {
  it('the first row is the Tab stop when the selected id is no longer in the tree', () => {
    const { rerender } = render(<TreeView nodes={[{ id: 'a', label: 'a.ts' }, { id: 'b', label: 'b.ts' }]} />)
    expect(screen.getByRole('treeitem', { name: /a\.ts/ })).toHaveAttribute('tabindex', '0')
    rerender(<TreeView nodes={[{ id: 'c', label: 'c.ts' }, { id: 'd', label: 'd.ts' }]} />)
    const rows = screen.getAllByRole('treeitem')
    expect(rows.filter(r => r.tabIndex === 0)).toEqual([rows[0]])
  })

  it('renames only with onRename', () => {
    const { rerender } = render(<TreeView nodes={[{ id: 'a', label: 'a.ts' }]} />)
    fireEvent.keyDown(screen.getByRole('treeitem'), { key: 'F2' })
    expect(screen.queryByRole('textbox')).toBeNull()
    rerender(<TreeView nodes={[{ id: 'a', label: 'a.ts' }]} onRename={() => {}} />)
    fireEvent.keyDown(screen.getByRole('treeitem'), { key: 'F2' })
    expect(screen.getByRole('textbox', { name: 'Rename a.ts' })).toBeInTheDocument()
  })
})

type Inv = { id: string; name: string; due: Date | null }
const INV: Inv[] = [
  { id: '1', name: 'fri', due: new Date(2024, 0, 5) }, // "Fri Jan 05 2024": first as text, last by date
  { id: '2', name: 'none', due: null },
  { id: '3', name: 'mon', due: new Date(2024, 0, 1) },
  { id: '4', name: 'tue', due: new Date(2024, 0, 2) },
]
const names = () => screen.getAllByRole('row').slice(1).map(r => within(r).getAllByRole('cell')[0].textContent)

describe('D-H4: DataTable sorts Dates by value', () => {
  it('orders a Date column chronologically with empty cells last, both ways; a third click restores the order', async () => {
    const user = userEvent.setup()
    render(<DataTable rows={INV} rowKey={r => r.id} columns={[{ key: 'name', label: 'Name' }, { key: 'due', label: 'Due', render: r => r.due?.toISOString() ?? '' }]} />)
    const header = screen.getByRole('columnheader', { name: /Due/ })
    await user.click(within(header).getByRole('button'))
    expect(header).toHaveAttribute('aria-sort', 'ascending')
    expect(names()).toEqual(['mon', 'tue', 'fri', 'none'])
    await user.click(within(header).getByRole('button'))
    expect(header).toHaveAttribute('aria-sort', 'descending')
    expect(names()).toEqual(['fri', 'tue', 'mon', 'none'])
    await user.click(within(header).getByRole('button'))
    expect(header).not.toHaveAttribute('aria-sort')
    expect(names()).toEqual(['fri', 'none', 'mon', 'tue'])
  })
})

describe('D-M11: empty collections say so', () => {
  it('DataTable with no rows renders an empty-state row across every column', () => {
    render(<DataTable rows={[] as Inv[]} rowKey={r => r.id} columns={[{ key: 'name', label: 'Name' }, { key: 'due', label: 'Due' }]} />)
    const cell = screen.getByText('No rows').closest('td')
    expect(cell).toHaveAttribute('colspan', '2')
  })

  it('TreeView with no nodes shows `empty`', () => {
    render(<TreeView nodes={[]} empty="Nothing here yet" />)
    expect(screen.getByText('Nothing here yet')).toBeInTheDocument()
    expect(screen.queryByRole('tree')).toBeNull()
  })

  it('JsonViewer says when no key matches the filter', () => {
    render(<JsonViewer data={{ a: 1 }} />)
    fireEvent.change(screen.getByRole('textbox', { name: 'Filter keys' }), { target: { value: 'zzz' } })
    expect(screen.getByRole('status')).toHaveTextContent('No matching keys')
  })
})

describe('D-M13: JsonViewer paths are unambiguous', () => {
  it('a key "a.b" and the nested a → b get distinct paths and collapse independently', async () => {
    const user = userEvent.setup(), onCopyPath = vi.fn()
    render(<JsonViewer data={{ 'a.b': { x: 1 }, a: { b: { y: 2 } } }} onCopyPath={onCopyPath} />)
    const nested = screen.getByRole('button', { name: 'Collapse a.b' }), dotted = screen.getByRole('button', { name: 'Collapse ["a.b"]' })
    await user.click(nested)
    expect(nested).toHaveAttribute('aria-expanded', 'false')
    expect(dotted).toHaveAttribute('aria-expanded', 'true')
    await user.click(screen.getByTitle('Copy path ["a.b"]'))
    expect(onCopyPath).toHaveBeenCalledWith('["a.b"]')
  })
})

describe('D-M3: MegaMenu controlled open is authoritative', () => {
  const items = [{ label: 'Products', content: <a href="#p">Analytics</a> }, { label: 'Docs', content: <a href="#d">Guides</a> }]
  it('open={null} closes the panel, and focus only asks to open', () => {
    const onOpenChange = vi.fn()
    const { rerender } = render(<MegaMenu items={items} open="Products" onOpenChange={onOpenChange} />)
    const products = screen.getByRole('button', { name: 'Products' }), docs = screen.getByRole('button', { name: 'Docs' })
    expect(products).toHaveAttribute('aria-expanded', 'true')
    rerender(<MegaMenu items={items} open={null} onOpenChange={onOpenChange} />)
    expect(products).toHaveAttribute('aria-expanded', 'false')
    expect(onOpenChange).not.toHaveBeenCalled()
    act(() => docs.focus())
    expect(onOpenChange).toHaveBeenLastCalledWith('Docs')
    expect(docs).toHaveAttribute('aria-expanded', 'false')
  })
})

describe('D-M4: CollapsibleSidebar has no demo content', () => {
  it('renders no brand and no placeholder pane by default', () => {
    render(<CollapsibleSidebar items={[{ value: 'home', label: 'Home' }]} />)
    expect(screen.queryByText('Northwind')).toBeNull()
    expect(screen.getByRole('complementary', { name: 'Sidebar' })).toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'Home' }).firstElementChild).toBeEmptyDOMElement()
  })
})

describe('D-M7: HoldToConfirm announces its own outcome', () => {
  it('says doneLabel, not "Deleted", and nothing while idle', async () => {
    const onConfirm = vi.fn()
    const { container } = render(<HoldToConfirm onConfirm={onConfirm} duration={500} doneLabel="Archived">Hold to archive</HoldToConfirm>)
    const status = container.querySelector('[aria-live=polite]')!
    expect(status).toHaveTextContent(/^$/)
    fireEvent.pointerDown(screen.getByRole('button', { name: /Hold to archive/ }), { button: 0 })
    await vi.waitFor(() => expect(onConfirm).toHaveBeenCalled(), { timeout: 3000 })
    expect(status).toHaveTextContent('Archived')
    expect(status).not.toHaveTextContent('Deleted')
  })
})

describe('D-M9: LikeButton counts the same way controlled and uncontrolled', () => {
  function Controlled() {
    const [liked, setLiked] = useState(true)
    return <LikeButton count={10} liked={liked} onChange={setLiked} />
  }
  it.each([['controlled', <Controlled key="c" />], ['uncontrolled', <LikeButton key="u" count={10} defaultLiked />]])('%s: liked count 10 shows 10, unliking shows 9', async (_, el) => {
    const user = userEvent.setup()
    render(el)
    const btn = screen.getByRole('button', { name: /^Like/ })
    expect(btn).toHaveAccessibleName('Like, 10')
    await user.click(btn)
    expect(btn).toHaveAccessibleName('Like, 9')
  })
})

describe('Progress clamps its value', () => {
  it.each([[-5, 100, '0'], [150, 100, '100'], [3, 0, '0']])('value %s of %s → aria-valuenow %s', (value, max, now) => {
    render(<Progress value={value} max={max} />)
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', now)
  })
})

describe('D-M14: Kanban card ids are unique', () => {
  it('two cards added in the same millisecond get distinct ids', () => {
    vi.spyOn(Date, 'now').mockReturnValue(1_700_000_000_000)
    const onChange = vi.fn()
    render(<Kanban defaultValue={[{ id: 'todo', title: 'To do', cards: [] }] as KanbanColumn[]} onChange={onChange} />)
    fireEvent.click(screen.getByRole('button', { name: '+ Add card' }))
    const box = screen.getByRole('textbox', { name: 'New card in To do' })
    for (const title of ['One', 'Two']) {
      fireEvent.change(box, { target: { value: title } })
      fireEvent.keyDown(box, { key: 'Enter' })
    }
    const cards = (onChange.mock.lastCall![0] as KanbanColumn[])[0].cards
    expect(cards.map(c => c.title)).toEqual(['One', 'Two'])
    expect(new Set(cards.map(c => c.id)).size).toBe(2)
  })
})
