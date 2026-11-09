// DataGrid 0.3: virtual rows with ARIA grid indexes, keyboard navigation across the virtual window, server mode
// callbacks, controlled selection ("select all across pages"), and the column state (pin, hide, reorder).
// jsdom has no layout: the scroller's viewport is `maxHeight` (420px → about 10 rows of 38px).
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { DataGrid, GRID_NO_SELECTION, gridIsSelected, gridSelectedCount, type GridColumn, type GridSelection } from '../../src/lib/datagrid'

type Row = { id: number; name: string; region: string; amount: number }
const REGIONS = ['EU', 'US', 'APAC']
const makeRows = (n: number): Row[] => Array.from({ length: n }, (_, i) => ({ id: i + 1, name: `Customer ${i + 1}`, region: REGIONS[i % 3], amount: (i * 37) % 1000 }))
const columns: GridColumn<Row>[] = [{ key: 'name', label: 'Name' }, { key: 'region', label: 'Region' }, { key: 'amount', label: 'Amount', type: 'number' }]
const grid = () => screen.getByRole('grid')
const bodyRows = () => within(grid()).getAllByRole('row').filter(r => r.closest('tbody'))
const focusedRow = () => (document.activeElement as HTMLElement).getAttribute('data-gr')
const scroller = () => grid().parentElement as HTMLElement

describe('DataGrid: virtual rows', () => {
  it('renders only a window of a large grid, with aria-rowcount, aria-colcount and aria-rowindex', () => {
    render(<DataGrid aria-label="Customers" columns={columns} defaultRows={makeRows(10_000)} rowKey={r => r.id} />)
    expect(grid()).toHaveAttribute('aria-rowcount', '10001')
    expect(grid()).toHaveAttribute('aria-colcount', '4')
    const rows = bodyRows()
    expect(rows.length).toBeLessThan(30)
    expect(rows[0]).toHaveAttribute('aria-rowindex', '2')
    expect(within(grid()).getAllByRole('row')[0]).toHaveAttribute('aria-rowindex', '1')
    act(() => { scroller().scrollTop = 38 * 5000; fireEvent.scroll(scroller()) })
    const idx = bodyRows().map(r => Number(r.getAttribute('aria-rowindex')))
    expect(idx).toContain(5002)
    expect(bodyRows().length).toBeLessThan(30)
    expect(screen.getByText('Customer 5001')).toBeInTheDocument()
  })

  it('keeps small grids unvirtualised (every row rendered)', () => {
    render(<DataGrid aria-label="Customers" columns={columns} defaultRows={makeRows(60)} rowKey={r => r.id} />)
    expect(bodyRows()).toHaveLength(60)
  })

  it('navigates with the keyboard across the virtual window: Ctrl+End, PageUp, arrows, Ctrl+Home', async () => {
    const user = userEvent.setup()
    render(<DataGrid aria-label="Customers" columns={columns} defaultRows={makeRows(5000)} rowKey={r => r.id} />)
    await user.click(screen.getByText('Customer 1'))
    expect(focusedRow()).toBe('1')
    await user.keyboard('{Control>}{End}{/Control}')
    expect(focusedRow()).toBe('5000')
    expect((document.activeElement as HTMLElement).getAttribute('data-gk')).toBe('amount')
    expect(document.activeElement!.closest('tr')).toHaveAttribute('aria-rowindex', '5001')
    await user.keyboard('{ArrowUp}{ArrowUp}')
    expect(focusedRow()).toBe('4998')
    await user.keyboard('{PageUp}')
    const afterPage = Number(focusedRow())
    expect(afterPage).toBeLessThan(4998)
    expect(afterPage).toBeGreaterThan(4980)
    await user.keyboard('{Control>}{Home}{/Control}')
    expect(focusedRow()).toBe('1')
    for (let i = 0; i < 25; i++) await user.keyboard('{ArrowDown}')
    expect(focusedRow()).toBe('26')
    expect(scroller().scrollTop).toBeGreaterThan(0)
  })

  it('keeps the focused cell when it scrolls out of the window', async () => {
    const user = userEvent.setup()
    render(<DataGrid aria-label="Customers" columns={columns} defaultRows={makeRows(5000)} rowKey={r => r.id} />)
    await user.click(screen.getByText('Customer 3'))
    act(() => { scroller().scrollTop = 38 * 3000; fireEvent.scroll(scroller()) })
    expect(document.activeElement).toHaveTextContent('Customer 3')
    await user.keyboard('{ArrowDown}')
    expect(focusedRow()).toBe('4')
  })
})

describe('DataGrid: server mode', () => {
  it('emits sort, filter, search and page changes without touching the rows', async () => {
    const user = userEvent.setup()
    const onSort = vi.fn(), onFilter = vi.fn(), onSearch = vi.fn(), onPage = vi.fn()
    const rows = makeRows(50)
    function Server() {
      const [page, setPage] = useState(2)
      return <DataGrid server aria-label="Customers" columns={columns} rows={rows} rowKey={r => r.id} rowCount={1234} page={page} pageSize={50}
        onPageChange={p => { onPage(p); setPage(p) }} onSortChange={onSort} onFilterChange={onFilter} onSearchChange={onSearch} />
    }
    render(<Server />)
    expect(grid()).toHaveAttribute('aria-rowcount', '1235')
    expect(bodyRows()[0]).toHaveAttribute('aria-rowindex', '102') // page 3 starts at row 101
    expect(screen.getByRole('navigation', { name: 'Pagination' })).toHaveTextContent('101–150 of 1,234')
    await user.click(screen.getByRole('button', { name: 'Next page' }))
    expect(onPage).toHaveBeenLastCalledWith(3)
    await user.click(screen.getByRole('button', { name: /^Amount/ }))
    expect(onSort).toHaveBeenLastCalledWith({ key: 'amount', dir: 1 })
    expect(onPage).toHaveBeenLastCalledWith(0) // a new sort starts on page one
    expect(bodyRows()[0]).toHaveTextContent('Customer 1') // not sorted locally
    await user.click(screen.getByRole('button', { name: '+ Filter' }))
    expect(onFilter).toHaveBeenCalled()
    expect(onFilter.mock.lastCall![0].c).toHaveLength(1)
    await user.type(screen.getByRole('textbox', { name: /Search rows/ }), 'acme')
    await waitFor(() => expect(onSearch).toHaveBeenLastCalledWith('acme'))
    expect(bodyRows()).toHaveLength(50) // the server decides what matches
  })

  it('shows loading and error states, with Retry', async () => {
    const user = userEvent.setup()
    const retry = vi.fn()
    const { rerender } = render(<DataGrid server aria-label="Customers" columns={columns} rows={[]} rowKey={r => r.id} loading />)
    expect(scroller()).toHaveAttribute('aria-busy', 'true')
    expect(screen.getByRole('status', { name: 'Loading rows' })).toBeInTheDocument()
    rerender(<DataGrid server aria-label="Customers" columns={columns} rows={[]} rowKey={r => r.id} error="Timed out" onRetry={retry} />)
    expect(screen.getByRole('alert')).toHaveTextContent('Timed out')
    await user.click(screen.getByRole('button', { name: 'Retry' }))
    expect(retry).toHaveBeenCalled()
  })

  it('asks for more rows when the end scrolls into view (infinite)', () => {
    const more = vi.fn()
    render(<DataGrid server aria-label="Customers" columns={columns} rows={makeRows(200)} rowKey={r => r.id} onLoadMore={more} hasMore />)
    expect(more).not.toHaveBeenCalled()
    act(() => { scroller().scrollTop = 38 * 195; fireEvent.scroll(scroller()) })
    expect(more).toHaveBeenCalledTimes(1)
    expect(grid()).toHaveAttribute('aria-rowcount', '-1') // total unknown
  })
})

describe('DataGrid: selection API', () => {
  it('is controlled: reports changes and shows what it is given', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    const sel: GridSelection = { mode: 'include', keys: new Set([2]) }
    render(<DataGrid aria-label="Customers" columns={columns} defaultRows={makeRows(5)} rowKey={r => r.id} rowLabel={r => r.name} selection={sel} onSelectionChange={onChange} />)
    expect(screen.getByRole('checkbox', { name: 'Select Customer 2' })).toBeChecked()
    expect(screen.getByRole('region', { name: 'Selection' })).toHaveTextContent('1 selected')
    await user.click(screen.getByRole('checkbox', { name: 'Select Customer 4' }))
    expect([...onChange.mock.lastCall![0].keys]).toEqual([2, 4])
    expect(screen.getByRole('checkbox', { name: 'Select Customer 4' })).not.toBeChecked() // controlled: the parent didn't update
  })

  it('selects all across pages in server mode (exclude), and resets that when the query changes', async () => {
    const user = userEvent.setup()
    let latest: GridSelection = GRID_NO_SELECTION
    function Server() {
      const [selection, setSelection] = useState<GridSelection>(GRID_NO_SELECTION)
      latest = selection
      return <DataGrid server aria-label="Customers" columns={columns} rows={makeRows(50)} rowKey={r => r.id} rowLabel={r => r.name} rowCount={900} pageSize={50}
        selection={selection} onSelectionChange={setSelection} />
    }
    render(<Server />)
    await user.click(screen.getByRole('checkbox', { name: 'Select all' }))
    expect(latest.mode).toBe('include')
    expect(latest.keys.size).toBe(50)
    await user.click(screen.getByRole('button', { name: 'Select all 900 rows' }))
    expect(latest).toEqual({ mode: 'exclude', keys: new Set() })
    await user.click(screen.getByRole('checkbox', { name: 'Select Customer 3' }))
    expect(latest.mode).toBe('exclude')
    expect(gridIsSelected(latest, 3)).toBe(false)
    expect(gridIsSelected(latest, 4)).toBe(true)
    expect(gridSelectedCount(latest, 900)).toBe(899)
    expect(screen.getByRole('region', { name: 'Selection' })).toHaveTextContent('All 899 selected')
    await user.type(screen.getByRole('textbox', { name: /Search rows/ }), 'x')
    await waitFor(() => expect(latest).toEqual(GRID_NO_SELECTION))
  })

  it('shift-click selects a range in uncontrolled mode, as before', async () => {
    const user = userEvent.setup()
    render(<DataGrid aria-label="Customers" columns={columns} defaultRows={makeRows(8)} rowKey={r => r.id} rowLabel={r => r.name} />)
    await user.click(screen.getByRole('checkbox', { name: 'Select Customer 2' }))
    await user.keyboard('{Shift>}')
    await user.click(screen.getByRole('checkbox', { name: 'Select Customer 5' }))
    await user.keyboard('{/Shift}')
    expect(screen.getByRole('region', { name: 'Selection' })).toHaveTextContent('4 selected')
  })
})

describe('DataGrid: columns', () => {
  const headers = () => within(grid()).getAllByRole('columnheader').map(h => h.textContent?.trim()).filter(Boolean)

  it('hides, pins and reorders from the Columns menu, reporting each change', async () => {
    const user = userEvent.setup()
    const onHidden = vi.fn(), onPinned = vi.fn(), onOrder = vi.fn()
    render(<DataGrid aria-label="Customers" columns={columns} defaultRows={makeRows(3)} rowKey={r => r.id}
      onHiddenColumnsChange={onHidden} onPinnedColumnsChange={onPinned} onColumnOrderChange={onOrder} />)
    expect(headers()).toEqual(['Name', 'Region', 'Amount'])
    await user.click(screen.getByRole('button', { name: /Columns/ }))
    const menu = screen.getByRole('group', { name: 'Show, pin and order columns' })
    await user.click(within(menu).getByRole('checkbox', { name: 'Show Region' }))
    expect(onHidden).toHaveBeenLastCalledWith(['region'])
    expect(headers()).toEqual(['Name', 'Amount'])
    await user.click(within(menu).getByRole('button', { name: 'Pin Amount left' }))
    expect(onPinned).toHaveBeenLastCalledWith({ left: ['name', 'amount'], right: [] })
    expect(headers()).toEqual(['Name', 'Amount'])
    await user.click(within(menu).getByRole('button', { name: 'Move Amount left' }))
    expect(onOrder).toHaveBeenLastCalledWith(['amount', 'name', 'region'])
    expect(headers()).toEqual(['Amount', 'Name'])
    await user.click(within(menu).getByRole('button', { name: 'Pin Name right' }))
    expect(headers()).toEqual(['Amount', 'Name'])
    expect(within(grid()).getByRole('columnheader', { name: /Name/ }).style.right).toBe('0px')
    // the last visible column can't be hidden
    await user.click(within(menu).getByRole('checkbox', { name: 'Show Name' }))
    expect(within(menu).getByRole('checkbox', { name: 'Show Amount' })).toBeDisabled()
  })

  it('moves a column with Ctrl+Shift+arrows on its header, within its pinned side', async () => {
    const user = userEvent.setup()
    render(<DataGrid aria-label="Customers" columns={columns} defaultRows={makeRows(3)} rowKey={r => r.id} defaultPinnedColumns={{ left: [] }} />)
    within(grid()).getByRole('button', { name: /^Name/ }).focus()
    await user.keyboard('{Control>}{Shift>}{ArrowRight}{/Shift}{/Control}')
    expect(headers()).toEqual(['Region', 'Name', 'Amount'])
    await user.keyboard('{Control>}{Shift>}{ArrowRight}{/Shift}{/Control}')
    expect(headers()).toEqual(['Region', 'Amount', 'Name'])
    expect(screen.getByText(/Name moved to position 3 of 3/)).toBeInTheDocument()
  })

  it('honours column pin and hidden defaults and controlled order', () => {
    const cols: GridColumn<Row>[] = [{ key: 'name', label: 'Name' }, { key: 'region', label: 'Region', hidden: true }, { key: 'amount', label: 'Amount', type: 'number', pin: 'right' }]
    render(<DataGrid aria-label="Customers" columns={cols} defaultRows={makeRows(3)} rowKey={r => r.id} columnOrder={['amount', 'region', 'name']} />)
    expect(headers()).toEqual(['Name', 'Amount']) // Amount is pinned right, so it stays last
    expect(within(grid()).getByRole('columnheader', { name: /Amount/ }).style.right).toBe('0px')
  })
})
