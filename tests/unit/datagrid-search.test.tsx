// DataGrid search and Text filter: the ripgrep-style box's guards against patterns that would freeze the page (the
// nested-quantifier and wildcard heuristic, the time budget per pass), its -i/-w/-F flags, and the Text query parser.
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { DataGrid, type GridColumn, type GridFilterNode } from '../../src/lib/datagrid'

type Row = { id: number; name: string; region: string; amount: number }
const rows: Row[] = [
  { id: 1, name: 'Northwind', region: 'EU', amount: 300 },
  { id: 2, name: 'Quill', region: 'US', amount: 100 },
  { id: 3, name: 'Acme', region: 'EU', amount: 200 },
  { id: 4, name: 'Literal (a+)+ Ltd', region: 'APAC', amount: 50 },
]
const columns: GridColumn<Row>[] = [
  { key: 'name', label: 'Name' }, { key: 'region', label: 'Region', options: ['EU', 'US', 'APAC'] }, { key: 'amount', label: 'Amount', type: 'number' },
]
const ALL = rows.map(r => r.name)
/** Names of the rows on screen, in order (read from the row text: search highlights split the cell text). */
const names = () => within(screen.getByRole('grid')).getAllByRole('row').slice(1).flatMap(r => ALL.filter(n => r.textContent!.includes(n)))
const searchBox = () => screen.getByRole('textbox', { name: /Search rows/ })

async function search(q: string, props: Partial<Omit<Parameters<typeof DataGrid<Row>>[0], "onLoadMore" | "hasMore" | "page" | "defaultPage" | "onPageChange" | "pageSize" | "defaultPageSize" | "pageSizes">> = {}) {
  const user = userEvent.setup()
  render(<DataGrid aria-label="Customers" columns={columns} defaultRows={rows} rowKey={r => r.id} {...props} />)
  await user.click(searchBox())
  await user.paste(q)
  return user
}

describe('DataGrid search: patterns that would freeze the page', () => {
  it.each([
    ['(a+)+$', /Nested quantifiers/],
    ['(\\w+\\s?)+$', /Nested quantifiers/],
    ['(x*){2,}y', /Nested quantifiers/],
    ['((ab)+)*c', /Nested quantifiers/],
    ['.*.*.*x', /Three or more open-ended wildcards/],
    ['\\w+-\\d+-[^,]*!', /Three or more open-ended wildcards/],
  ])('rejects %s with a message and leaves the rows alone', async (q, why) => {
    await search(q)
    await waitFor(() => expect(searchBox()).toHaveAttribute('aria-invalid', 'true'))
    expect(screen.getByText(why)).toBeInTheDocument()
    expect(names()).toEqual(ALL)
  })

  it.each(['(ab)+c', 'a.*b.*c', 'north|quill', '\\d{2,}'])('accepts the ordinary pattern %s', async q => {
    await search(q)
    await waitFor(() => expect(screen.getByText(/match(es)? in/)).toBeInTheDocument())
    expect(searchBox()).not.toHaveAttribute('aria-invalid')
  })

  it('searches literally with -F, or with the regex toggle off, so the same text is not flagged', async () => {
    const user = await search('-F (a+)+')
    await waitFor(() => expect(names()).toEqual(['Literal (a+)+ Ltd']))
    expect(searchBox()).not.toHaveAttribute('aria-invalid')
    await user.clear(searchBox())
    await user.click(screen.getByRole('button', { name: '.*' }))
    await user.click(searchBox())
    await user.paste('(a+)+')
    await waitFor(() => expect(names()).toEqual(['Literal (a+)+ Ltd']))
    expect(searchBox()).not.toHaveAttribute('aria-invalid')
  })

  it('rejects a search over 200 characters', async () => {
    await search('x'.repeat(201))
    await waitFor(() => expect(searchBox()).toHaveAttribute('aria-invalid', 'true'))
    expect(screen.getByText('Search is limited to 200 characters')).toBeInTheDocument()
  })

  it('stops a pass that runs over its time budget and says how far it got', async () => {
    // a clock that only moves while cells are read: 10 ms per Name cell
    let clock = 0
    vi.spyOn(performance, 'now').mockImplementation(() => clock)
    const many = Array.from({ length: 200 }, (_, i) => ({ id: i, name: `Customer ${i}`, region: 'EU', amount: i }))
    const slow: GridColumn<Row>[] = [{ ...columns[0], text: r => { clock += 10; return r.name } }, columns[1], columns[2]]
    const user = userEvent.setup()
    render(<DataGrid aria-label="Customers" columns={slow} defaultRows={many} rowKey={r => r.id} />)
    await user.click(searchBox())
    await user.paste('customer')
    const note = await screen.findByText(/search too slow, showing the first \d+ of 200 rows/)
    const reached = Number(/first (\d+)/.exec(note.textContent!)![1])
    expect(reached).toBeGreaterThan(0)
    expect(reached).toBeLessThan(200)
    expect(screen.getByText(new RegExp(`in ${reached} rows`))).toBeInTheDocument()
  })
})

describe('DataGrid search flags', () => {
  it.each([
    ['NORTH', []], // smart case: an upper-case letter makes it case-sensitive
    ['-i NORTH', ['Northwind']],
    ['-s acme', []],
    ['rg -i ACME', ['Acme']],
    ['-w ac', []],
    ['-w acme', ['Acme']],
    ['"quill"', ['Quill']],
  ])('%s', async (q, want) => {
    await search(q)
    await waitFor(() => expect(names()).toEqual(want))
  })
})

describe('DataGrid Text filter', () => {
  async function query(q: string) {
    const onFilterChange = vi.fn()
    const user = userEvent.setup()
    render(<DataGrid aria-label="Customers" columns={columns} defaultRows={rows} rowKey={r => r.id} onFilterChange={onFilterChange} />)
    await user.click(screen.getByRole('radio', { name: 'Text' }))
    const box = screen.getByRole('textbox', { name: 'Filter query' })
    await user.click(box)
    await user.paste(q)
    return { box, onFilterChange }
  }
  /** The conditions of a filter tree as `field op value` strings, groups bracketed. */
  const flat = (n: GridFilterNode): string => 'c' in n ? `(${n.c.map(flat).join(` ${n.j} `)})` : n.f.join(' ')

  it.each([
    ['region is EU', '(region is EU)', ['Northwind', 'Acme']],
    ['Region IS eu', '(region is EU)', ['Northwind', 'Acme']],
    ['region is not EU', '(region is not EU)', ['Quill', 'Literal (a+)+ Ltd']],
    ['name contains orth', '(name contains orth)', ['Northwind']],
    ['name is "literal (a+)+ ltd"', '(name is literal (a+)+ ltd)', ['Literal (a+)+ Ltd']],
    ['amount > 150', '(amount > 150)', ['Northwind', 'Acme']],
    ['amount >= 200', '(amount ≥ 200)', ['Northwind', 'Acme']],
    ['amount ≤ 100', '(amount ≤ 100)', ['Quill', 'Literal (a+)+ Ltd']],
    ['region is EU and amount > 250', '(region is EU AND amount > 250)', ['Northwind']],
    ['region is US OR amount > 250', '(region is US OR amount > 250)', ['Northwind', 'Quill']],
    ['(region is EU and amount < 250) or name is quill', '((region is EU AND amount < 250) OR name is quill)', ['Quill', 'Acme']],
  ])('%s', async (q, tree, want) => {
    const { box, onFilterChange } = await query(q)
    expect(box).not.toHaveAttribute('aria-invalid')
    expect(screen.getByText('✓ Valid query')).toBeInTheDocument()
    expect(flat(onFilterChange.mock.lastCall![0])).toBe(tree)
    expect(names()).toEqual(want)
  })

  it.each([
    ['colour is red', 'Unknown field “colour”'],
    ['region is', 'Missing value for Region'],
    ['region is Mars', 'Region is one of EU, US, APAC'],
    ['amount contains 5', '“contains” isn’t an operator for Amount (try >, <, =, ≥, ≤)'],
    ['name > 5', '“>” isn’t an operator for Name (try is, is not, contains)'],
    ['region is EU and', 'Condition missing after AND'],
    ['region is EU xor amount > 1', 'Expected AND or OR, got “xor”'],
    ['region is EU and amount > 1 or name is quill', 'Mixing AND and OR at one level: wrap one side in brackets'],
    ['(region is EU', 'Missing closing bracket'],
    ['region is EU)', 'Unexpected “)”'],
  ])('%s is an error', async (q, message) => {
    const { box, onFilterChange } = await query(q)
    expect(box).toHaveAttribute('aria-invalid', 'true')
    expect(screen.getByText(message)).toBeInTheDocument()
    expect(onFilterChange).not.toHaveBeenCalled()
    expect(names()).toEqual(ALL)
  })
})
