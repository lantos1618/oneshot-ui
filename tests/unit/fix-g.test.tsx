// Package G fixes: DataGrid editing, export, paging and filters; Scheduler new events; HexEditor go to and search;
// ByteMap zoom.
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { DataGrid, gridFilter, type GridColumn, type GridGroup } from '../../src/lib/datagrid'
import { ToastProvider } from '../../src/lib/feedback'
import { Scheduler, type SchedulerEvent } from '../../src/lib/scheduler'
import { ByteMap, HexEditor } from '../../src/lib/binary'

type Row = { id: number; name: string; region: string; amount: number }
const REGIONS = ['EU', 'US', 'APAC']
const makeRows = (n: number): Row[] => Array.from({ length: n }, (_, i) => ({ id: i + 1, name: `Customer ${i + 1}`, region: REGIONS[i % 3], amount: (i * 37) % 1000 }))
const columns: GridColumn<Row>[] = [{ key: 'name', label: 'Name' }, { key: 'region', label: 'Region' }, { key: 'amount', label: 'Amount', type: 'number' }]
const grid = () => screen.getByRole('grid')
const scroller = () => grid().parentElement as HTMLElement
const cell = (id: number, key: string) => grid().querySelector<HTMLElement>(`[data-gr="${id}"][data-gk="${key}"]`)!

describe('DataGrid cell editor keeps what was typed (G-H1)', () => {
  const setup = () => {
    const onRowsChange = vi.fn()
    const user = userEvent.setup()
    render(<DataGrid aria-label="Customers" columns={columns} defaultRows={makeRows(3)} rowKey={r => r.id} onRowsChange={onRowsChange} />)
    const edit = async (id: number, key: string, text: string) => {
      await user.dblClick(cell(id, key))
      const input = screen.getByRole('textbox', { name: `Edit ${columns.find(c => c.key === key)!.label}` })
      await user.clear(input)
      if (text) await user.type(input, text)
      await user.keyboard('{Enter}')
      return input
    }
    const last = () => onRowsChange.mock.lastCall?.[0] as Row[] | undefined
    return { onRowsChange, edit, last }
  }

  it('saves a decimal as typed, without rounding', async () => {
    const { edit, last } = setup()
    await edit(1, 'amount', '12.5')
    expect(last()?.[0].amount).toBe(12.5)
  })

  it('saves a negative number, without clamping to 0', async () => {
    const { edit, last } = setup()
    await edit(2, 'amount', '-5')
    expect(last()?.[1].amount).toBe(-5)
  })

  it('rejects text in a number cell: the editor stays open, invalid, with the text and a message, and nothing is saved', async () => {
    const { edit, onRowsChange } = setup()
    const input = await edit(1, 'amount', 'abc')
    expect(input).toBeInTheDocument()
    expect(input).toHaveAttribute('aria-invalid', 'true')
    expect(input).toHaveValue('abc')
    expect(screen.getByRole('alert')).toHaveTextContent('Amount needs a number')
    expect(onRowsChange).not.toHaveBeenCalled()
    fireEvent.blur(input)
    expect(onRowsChange).not.toHaveBeenCalled()
  })

  it('rejects an empty number cell instead of saving 0', async () => {
    const { edit, onRowsChange } = setup()
    const input = await edit(1, 'amount', '')
    expect(input).toHaveAttribute('aria-invalid', 'true')
    expect(onRowsChange).not.toHaveBeenCalled()
  })

  it('clears a text cell', async () => {
    const { edit, last } = setup()
    await edit(1, 'name', '')
    expect(last()?.[0].name).toBe('')
  })

  it('saves text as typed', async () => {
    const { edit, last } = setup()
    await edit(1, 'name', '  Acme  ')
    expect(last()?.[0].name).toBe('  Acme  ')
  })

  it('uses a column parse, whose Error keeps the editor open with its message', async () => {
    const onRowsChange = vi.fn()
    const user = userEvent.setup()
    const cols: GridColumn<Row>[] = [columns[0], { key: 'amount', label: 'Amount', type: 'number', parse: t => /^\d+$/.test(t) ? Number(t) : new Error('Whole units only') }]
    render(<DataGrid aria-label="Customers" columns={cols} defaultRows={makeRows(2)} rowKey={r => r.id} onRowsChange={onRowsChange} />)
    await user.dblClick(cell(1, 'amount'))
    const input = screen.getByRole('textbox', { name: 'Edit Amount' })
    await user.clear(input); await user.type(input, '2.5{Enter}')
    expect(screen.getByRole('alert')).toHaveTextContent('Whole units only')
    await user.clear(input); await user.type(input, '7{Enter}')
    expect(onRowsChange.mock.lastCall?.[0][0].amount).toBe(7)
  })
})

describe('DataGrid Export (G-H2)', () => {
  it('downloads a CSV of the selected rows when there is no onExport, and reports what was written', async () => {
    const user = userEvent.setup()
    let blob: Blob | null = null
    const create = vi.fn((b: Blob) => { blob = b; return 'blob:test' })
    Object.assign(URL, { createObjectURL: create, revokeObjectURL: vi.fn() })
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) { expect(this.download).toBe('customers.csv') })
    const rows: Row[] = [{ id: 1, name: 'Acme, Inc', region: 'EU', amount: 5 }, { id: 2, name: '=SUM(A1)', region: 'US', amount: -3 }, { id: 3, name: 'Other', region: 'EU', amount: 1 }]
    render(<ToastProvider><DataGrid aria-label="Customers" columns={columns} defaultRows={rows} rowKey={r => r.id} /></ToastProvider>)
    await user.click(screen.getByRole('checkbox', { name: 'Select 1' }))
    await user.click(screen.getByRole('checkbox', { name: 'Select 2' }))
    await user.click(screen.getByRole('button', { name: 'Export' }))
    expect(click).toHaveBeenCalledTimes(1)
    const text = await blob!.text()
    expect(text.replace(/^﻿/, '').split('\r\n')).toEqual(['Name,Region,Amount', '"Acme, Inc",EU,5', "'=SUM(A1),US,-3"])
    expect(await screen.findByText('Exported 2 rows')).toBeInTheDocument()
    expect(screen.queryByText('CSV ready')).toBeNull()
  })

  it('hands the rows to onExport and shows no success of its own', async () => {
    const user = userEvent.setup()
    const onExport = vi.fn()
    render(<ToastProvider><DataGrid aria-label="Customers" columns={columns} defaultRows={makeRows(3)} rowKey={r => r.id} onExport={onExport} /></ToastProvider>)
    await user.click(screen.getByRole('checkbox', { name: 'Select 1' }))
    await user.click(screen.getByRole('button', { name: 'Export' }))
    expect(onExport).toHaveBeenCalledWith([makeRows(1)[0]], expect.objectContaining({ mode: 'include' }))
    expect(screen.queryByText(/Exported/)).toBeNull()
  })
})

describe('DataGrid infinite loading (G-H5)', () => {
  it('stays virtualised with virtualize={false}: rows past the view are not "seen", so no page is requested at mount', () => {
    const more = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const onLoadMore = vi.fn()
    render(<DataGrid server aria-label="Customers" columns={columns} rows={makeRows(200)} rowKey={r => r.id} onLoadMore={onLoadMore} hasMore virtualize={false} />)
    expect(onLoadMore).not.toHaveBeenCalled()
    act(() => { scroller().scrollTop = 38 * 195; fireEvent.scroll(scroller()) })
    expect(onLoadMore).toHaveBeenCalledTimes(1)
    expect(more).toHaveBeenCalled()
  })

  it('does not chain page after page when each page arrives', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    let calls = 0
    function Host() {
      const [rows, setRows] = useState(makeRows(50))
      return <DataGrid server aria-label="Customers" columns={columns} rows={rows} rowKey={r => r.id} virtualize={false} hasMore={rows.length < 1000}
        onLoadMore={() => { calls++; setRows(r => makeRows(r.length + 50)) }} />
    }
    render(<Host />)
    expect(calls).toBeLessThanOrEqual(1)
  })
})

describe('DataGrid sort uses the shared sort model', () => {
  it('cycles ascending, descending, unsorted, with aria-sort; empty cells last', async () => {
    const user = userEvent.setup()
    const rows = [{ id: 1, name: 'b', region: 'EU', amount: 10 }, { id: 2, name: 'a', region: 'US', amount: null as unknown as number }, { id: 3, name: 'c', region: 'EU', amount: 2 }]
    render(<DataGrid aria-label="Customers" columns={columns} defaultRows={rows} rowKey={r => r.id} />)
    const order = () => within(grid()).getAllByRole('row').slice(1).map(r => r.querySelector('[data-gk="name"]')?.textContent)
    const head = () => screen.getByRole('columnheader', { name: /Amount/ })
    await user.click(within(head()).getByRole('button', { name: /Amount/ }))
    expect(head()).toHaveAttribute('aria-sort', 'ascending')
    expect(order()).toEqual(['c', 'b', 'a'])
    await user.click(within(head()).getByRole('button', { name: /Amount/ }))
    expect(head()).toHaveAttribute('aria-sort', 'descending')
    expect(order()).toEqual(['b', 'c', 'a'])
    await user.click(within(head()).getByRole('button', { name: /Amount/ }))
    expect(head()).not.toHaveAttribute('aria-sort')
    expect(order()).toEqual(['b', 'a', 'c'])
  })
})

describe('DataGrid filters (G-M1, G-M3, G-M4)', () => {
  const textTab = async (user: ReturnType<typeof userEvent.setup>) => { await user.click(screen.getByRole('radio', { name: 'Text' })); return screen.getByRole('textbox', { name: 'Filter query' }) }

  it('rejects a non-number in a number condition instead of "Valid query"', async () => {
    const user = userEvent.setup()
    const onFilterChange = vi.fn()
    render(<DataGrid aria-label="Customers" columns={columns} defaultRows={makeRows(6)} rowKey={r => r.id} onFilterChange={onFilterChange} />)
    const q = await textTab(user)
    await user.type(q, 'amount > abc')
    expect(screen.getByText(/Amount needs a number/)).toBeInTheDocument()
    expect(screen.queryByText('✓ Valid query')).toBeNull()
    expect(q).toHaveAttribute('aria-invalid', 'true')
    expect(within(grid()).getAllByRole('row')).toHaveLength(7)
  })

  it('does not match empty cells in a numeric comparison', () => {
    const rows = [...makeRows(2), { id: 3, name: 'Blank', region: 'EU', amount: null as unknown as number }]
    render(<DataGrid aria-label="Customers" columns={columns} defaultRows={rows} rowKey={r => r.id} defaultFilter={gridFilter('AND', ['amount', '<', '5'])} />)
    expect(screen.queryByText('Blank')).toBeNull()
    expect(screen.getByText('Customer 1')).toBeInTheDocument()
  })

  it('follows a filter changed from outside while the Text tab is open', async () => {
    const user = userEvent.setup()
    function Host() {
      const [f, setF] = useState<GridGroup>(gridFilter('AND', ['region', 'is', 'EU']))
      return <>
        <button onClick={() => setF(gridFilter('AND', ['region', 'is', 'US']))}>Load view</button>
        <DataGrid aria-label="Customers" columns={columns} defaultRows={makeRows(6)} rowKey={r => r.id} filter={f} onFilterChange={setF} />
      </>
    }
    render(<Host />)
    const q = await textTab(user)
    expect(q).toHaveValue('region is EU')
    await user.click(screen.getByRole('button', { name: 'Load view' }))
    expect(screen.getByRole('textbox', { name: 'Filter query' })).toHaveValue('region is US')
  })

  it('round-trips a value with a double quote through the Text tab', async () => {
    const user = userEvent.setup()
    const rows = [{ id: 1, name: 'say "hi"', region: 'EU', amount: 1 }, { id: 2, name: 'other', region: 'EU', amount: 2 }]
    const onFilterChange = vi.fn()
    render(<DataGrid aria-label="Customers" columns={columns} defaultRows={rows} rowKey={r => r.id} defaultFilter={gridFilter('AND', ['name', 'is', 'say "hi"'])} onFilterChange={onFilterChange} />)
    const q = await textTab(user)
    expect(q).toHaveValue('name is "say \\"hi\\""')
    await user.type(q, ' ')
    expect(screen.getByText('✓ Valid query')).toBeInTheDocument()
    expect((onFilterChange.mock.lastCall?.[0] as GridGroup).c[0]).toMatchObject({ f: ['name', 'is', 'say "hi"'] })
    await waitFor(() => expect(within(grid()).getAllByRole('row')).toHaveLength(2))
  })
})

describe('Scheduler new events (G-H3)', () => {
  const create = (props: Partial<Parameters<typeof Scheduler>[0]> = {}) => {
    const onChange = vi.fn()
    const { container } = render(<ToastProvider><Scheduler today={new Date(2026, 2, 11)} defaultView="day" onChange={onChange} {...props} /></ToastProvider>)
    const col = container.querySelector<HTMLElement>('[data-sc-col]')!
    fireEvent.pointerDown(col, { button: 0, buttons: 1, pointerType: 'mouse', pointerId: 1, clientX: 20, clientY: 100 })
    fireEvent.pointerUp(window, { pointerId: 1, clientX: 20, clientY: 140 })
    return onChange.mock.lastCall?.[0] as SchedulerEvent[]
  }

  it('creates an event with no attendees (no invented person)', () => {
    const list = create()
    expect(list).toHaveLength(1)
    expect(list[0].attendees).toEqual([])
    expect(JSON.stringify(list)).not.toContain('Alex Lee')
  })

  it('lets the host fill in new events with newEvent', () => {
    const list = create({ newEvent: () => ({ attendees: ['Sam'], color: 'var(--c3)' }) })
    expect(list[0]).toMatchObject({ attendees: ['Sam'], color: 'var(--c3)' })
    expect(list[0].id).toMatch(/^ev-/)
  })
})

describe('HexEditor go to reads offsets the way they are shown (G-H4)', () => {
  const goTo = (text: string) => {
    const input = screen.getByRole('textbox', { name: 'Go to offset' })
    fireEvent.change(input, { target: { value: text } })
    return input
  }
  it('lands on 0x168 for "00000168" (as the offset column shows it) and for bare "168"', () => {
    const onCursor = vi.fn()
    render(<HexEditor data={new Uint8Array(0x2000)} onCursorChange={onCursor} inspector={false} />)
    fireEvent.keyDown(goTo('00000168'), { key: 'Enter' })
    expect(onCursor).toHaveBeenLastCalledWith(0x168)
    fireEvent.keyDown(goTo('360'), { key: 'Enter' })
    expect(onCursor).toHaveBeenLastCalledWith(0x360)
    fireEvent.keyDown(goTo('#360'), { key: 'Enter' })
    expect(onCursor).toHaveBeenLastCalledWith(360)
  })
  it('shows where the text points before jumping', () => {
    render(<HexEditor data={new Uint8Array(0x2000)} inspector={false} />)
    const input = goTo('168')
    expect(screen.getByText('→ 0x168 (360)')).toBeInTheDocument()
    expect(input).toHaveAccessibleDescription('→ 0x168 (360)')
  })
  it('accepts a controlled offsets prop and reports the header toggle (G-M9)', () => {
    const onOffsetsChange = vi.fn()
    const sections = [{ name: '.text', offset: 0, size: 0x100, vaddr: 0x401000 }]
    const { rerender } = render(<HexEditor data={new Uint8Array(0x100)} sections={sections} offsets="offset" onOffsetsChange={onOffsetsChange} inspector={false} />)
    expect(screen.getByText('00000000')).toBeInTheDocument()
    rerender(<HexEditor data={new Uint8Array(0x100)} sections={sections} offsets="vaddr" onOffsetsChange={onOffsetsChange} inspector={false} />)
    expect(screen.getByText('00401000')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /Show file offsets/ }))
    expect(onOffsetsChange).toHaveBeenCalledWith('offset')
  })
})

describe('HexEditor search and copy', () => {
  it('Enter right after typing jumps to a match of the new query, not the previous one (G-M6)', async () => {
    vi.useFakeTimers()
    try {
      const onCursor = vi.fn()
      const data = new TextEncoder().encode('..ELF....MZ..ELF....MZ')
      render(<HexEditor data={data} onCursorChange={onCursor} inspector={false} />)
      fireEvent.click(screen.getByRole('radio', { name: 'Text' }))
      const box = screen.getByRole('searchbox', { name: 'Search bytes' })
      fireEvent.change(box, { target: { value: 'ELF' } })
      await act(async () => { vi.advanceTimersByTime(300) })
      fireEvent.change(box, { target: { value: 'MZ' } })
      fireEvent.keyDown(box, { key: 'Enter' })
      expect(onCursor).toHaveBeenLastCalledWith(9)
    } finally { vi.useRealTimers() }
  })
  it('shows a failed copy on screen, not only to screen readers (G-M15)', async () => {
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: () => Promise.reject(new Error('denied')) } })
    render(<HexEditor data={new Uint8Array(16)} inspector={false} />)
    fireEvent.keyDown(screen.getByRole('group', { name: 'Hex editor' }), { key: 'c', ctrlKey: true })
    await waitFor(() => expect(screen.getAllByText('Couldn’t copy').some(el => !el.closest('.sr-only'))).toBe(true))
    Reflect.deleteProperty(navigator, 'clipboard')
  })
})

describe('ByteMap wheel zoom (G-M7)', () => {
  it('zooms by the wheel distance: a small Ctrl+wheel step zooms less than 2×', () => {
    const data = new Uint8Array(16384 * 64) // 64 bytes per cell at order 7
    render(<ByteMap data={data} />)
    expect(screen.getByText('64 bytes')).toBeInTheDocument()
    fireEvent.wheel(screen.getByRole('group', { name: 'Byte map' }), { deltaY: -10, ctrlKey: true })
    const per = Number(screen.getByText(/^\d+ bytes$/).textContent!.split(' ')[0])
    expect(per).toBeLessThan(64)
    expect(per).toBeGreaterThan(32)
  })
})
