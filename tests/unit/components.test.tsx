// Interaction tests for a handful of components. They query by role and accessible name only (no class names), so
// visual polish doesn't break them.
import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { Dialog } from '../../src/lib/overlay'
import { Tabs } from '../../src/lib/navigation'
import { Combobox, SegmentedControl } from '../../src/lib/forms'
import { CopyButton, ToastProvider, useToast } from '../../src/lib/feedback'
import { DataGrid, type GridColumn } from '../../src/lib/datagrid'
import { RichTextEditor } from '../../src/lib/editor'

/** Selected state, whichever ARIA pattern the control uses (radio, tab, toggle button). */
const isOn = (el: HTMLElement) => ['aria-checked', 'aria-selected', 'aria-pressed'].some(a => el.getAttribute(a) === 'true')

describe('Dialog (ModalLayer)', () => {
  function Harness({ onClose = () => {} }: { onClose?: () => void }) {
    const [open, setOpen] = useState(false)
    return (
      <>
        <button onClick={() => setOpen(true)}>Open dialog</button>
        <button>Outside</button>
        <Dialog open={open} onOpenChange={v => { setOpen(v); if (!v) onClose() }} title="Delete project" description="This cannot be undone."
          footer={<><button onClick={() => setOpen(false)}>Cancel</button><button>Delete</button></>}>
          <input aria-label="Type the name" />
        </Dialog>
      </>
    )
  }

  it('opens with a labelled modal dialog and moves focus inside', async () => {
    const user = userEvent.setup()
    render(<Harness />)
    await user.click(screen.getByRole('button', { name: 'Open dialog' }))
    const dialog = await screen.findByRole('dialog', { name: 'Delete project' })
    expect(dialog).toHaveAttribute('aria-modal', 'true')
    await waitFor(() => expect(dialog.contains(document.activeElement)).toBe(true))
  })

  it('keeps Tab inside the dialog', async () => {
    const user = userEvent.setup()
    render(<Harness />)
    await user.click(screen.getByRole('button', { name: 'Open dialog' }))
    const dialog = await screen.findByRole('dialog')
    await waitFor(() => expect(dialog.contains(document.activeElement)).toBe(true))
    for (let i = 0; i < 6; i++) {
      await user.tab()
      expect(dialog.contains(document.activeElement), `focus left the dialog after ${i + 1} Tab presses`).toBe(true)
    }
    for (let i = 0; i < 6; i++) {
      await user.tab({ shift: true })
      expect(dialog.contains(document.activeElement)).toBe(true)
    }
  })

  it('closes on Escape and returns focus to the trigger', async () => {
    const user = userEvent.setup(), onClose = vi.fn()
    render(<Harness onClose={onClose} />)
    const trigger = screen.getByRole('button', { name: 'Open dialog' })
    await user.click(trigger)
    const dialog = await screen.findByRole('dialog')
    await waitFor(() => expect(dialog.contains(document.activeElement)).toBe(true))
    await user.keyboard('{Escape}')
    expect(onClose).toHaveBeenCalledTimes(1)
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    await waitFor(() => expect(document.activeElement).toBe(trigger))
  })

  it('closes from a footer button', async () => {
    const user = userEvent.setup()
    render(<Harness />)
    await user.click(screen.getByRole('button', { name: 'Open dialog' }))
    await user.click(await screen.findByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })
})

describe('Tabs', () => {
  const items = [{ value: 'a', label: 'Account', content: 'Account panel' }, { value: 'b', label: 'Billing', content: 'Billing panel' }, { value: 'c', label: 'Team', content: 'Team panel' }]

  it('selects with the mouse and shows the panel', async () => {
    const user = userEvent.setup(), onChange = vi.fn()
    render(<Tabs items={items} onChange={onChange} />)
    expect(screen.getByRole('tab', { name: 'Account' })).toHaveAttribute('aria-selected', 'true')
    await user.click(screen.getByRole('tab', { name: 'Billing' }))
    expect(onChange).toHaveBeenLastCalledWith('b')
    expect(screen.getByRole('tab', { name: 'Billing' })).toHaveAttribute('aria-selected', 'true')
    expect(await screen.findByText('Billing panel')).toBeInTheDocument()
  })

  it('has one Tab stop and moves with arrows, Home and End', async () => {
    const user = userEvent.setup()
    render(<Tabs items={items} />)
    const tabs = screen.getAllByRole('tab')
    expect(tabs.filter(t => t.tabIndex === 0)).toHaveLength(1)
    await user.tab()
    expect(document.activeElement).toBe(tabs[0])
    await user.keyboard('{ArrowRight}')
    expect(document.activeElement).toBe(tabs[1])
    expect(tabs[1]).toHaveAttribute('aria-selected', 'true')
    await user.keyboard('{End}')
    expect(document.activeElement).toBe(tabs[2])
    await user.keyboard('{Home}')
    expect(document.activeElement).toBe(tabs[0])
    await user.keyboard('{ArrowLeft}') // wraps
    expect(document.activeElement).toBe(tabs[2])
  })
})

describe('SegmentedControl', () => {
  it('is a single-choice group navigable by arrow keys', async () => {
    const user = userEvent.setup(), onChange = vi.fn()
    render(<SegmentedControl aria-label="View" options={['Day', 'Week', 'Month']} defaultValue="Week" onChange={onChange} />)
    const group = screen.getByRole(/* radiogroup today; any grouping role works */ 'radiogroup', { name: 'View' })
    const opts = ['Day', 'Week', 'Month'].map(n => within(group).getByText(n).closest('button')!)
    expect(opts.map(isOn)).toEqual([false, true, false])
    await user.click(opts[2])
    expect(onChange).toHaveBeenLastCalledWith('Month')
    expect(opts.map(isOn)).toEqual([false, false, true])
    opts[2].focus()
    await user.keyboard('{ArrowLeft}')
    expect(onChange).toHaveBeenLastCalledWith('Week')
    expect(document.activeElement).toBe(opts[1])
    await user.keyboard('{Home}')
    expect(onChange).toHaveBeenLastCalledWith('Day')
  })
})

describe('Combobox', () => {
  const options = [{ value: 'gb', label: 'United Kingdom' }, { value: 'us', label: 'United States' }, { value: 'de', label: 'Germany' }, { value: 'fr', label: 'France' }]

  it('filters as you type and picks with Enter', async () => {
    const user = userEvent.setup(), onChange = vi.fn()
    render(<Combobox aria-label="Country" options={options} onChange={onChange} />)
    const input = screen.getByRole('combobox', { name: 'Country' })
    await user.click(input)
    expect(input).toHaveAttribute('aria-expanded', 'true')
    await user.type(input, 'united')
    await waitFor(() => expect(screen.getAllByRole('option')).toHaveLength(2))
    expect(screen.getAllByRole('option').map(o => o.textContent)).toEqual(['United Kingdom', 'United States'])
    await user.keyboard('{ArrowDown}{Enter}')
    expect(onChange).toHaveBeenLastCalledWith('us')
    expect(input).toHaveValue('United States')
    await waitFor(() => expect(input).toHaveAttribute('aria-expanded', 'false'))
  })

  it('picks with the mouse', async () => {
    const user = userEvent.setup(), onChange = vi.fn()
    render(<Combobox aria-label="Country" options={options} onChange={onChange} />)
    await user.type(screen.getByRole('combobox'), 'ger')
    await user.click(await screen.findByRole('option', { name: /Germany/ }))
    expect(onChange).toHaveBeenLastCalledWith('de')
    expect(screen.getByRole('combobox')).toHaveValue('Germany')
  })

  it('shows the empty message and closes on Escape', async () => {
    const user = userEvent.setup()
    render(<Combobox aria-label="Country" options={options} />)
    const input = screen.getByRole('combobox')
    await user.type(input, 'zzz')
    expect(await screen.findByText(/No matches/)).toBeInTheDocument()
    expect(screen.queryAllByRole('option')).toHaveLength(0)
    await user.keyboard('{Escape}')
    await waitFor(() => expect(input).toHaveAttribute('aria-expanded', 'false'))
  })
})

describe('CopyButton', () => {
  it('copies the text and announces it', async () => {
    const user = userEvent.setup(), onCopy = vi.fn()
    render(<CopyButton text="pnpm add @lyndon/ui" label="Copy install command" onCopy={onCopy} />)
    await user.click(screen.getByRole('button', { name: 'Copy install command' }))
    await waitFor(() => expect(onCopy).toHaveBeenCalledWith(true))
    expect(await navigator.clipboard.readText()).toBe('pnpm add @lyndon/ui')
    expect(await screen.findByText('Copied')).toBeInTheDocument()
  })

  it('reads a function at copy time', async () => {
    const user = userEvent.setup()
    let n = 0
    render(<CopyButton text={() => `value ${++n}`} label="Copy value" iconOnly={false} size="sm" />)
    await user.click(screen.getByRole('button', { name: /Copy value/ }))
    await waitFor(async () => expect(await navigator.clipboard.readText()).toBe('value 1'))
  })

  it('reports a refused clipboard', async () => {
    const user = userEvent.setup(), onCopy = vi.fn()
    vi.spyOn(navigator.clipboard, 'writeText').mockRejectedValue(new DOMException('denied', 'NotAllowedError'))
    render(<CopyButton text="x" label="Copy" onCopy={onCopy} />)
    await user.click(screen.getByRole('button', { name: 'Copy' }))
    await waitFor(() => expect(onCopy).toHaveBeenCalledWith(false))
    expect(await screen.findByText(/Couldn.t copy/)).toBeInTheDocument()
  })
})

describe('Toast', () => {
  function Sender({ duration }: { duration?: number }) {
    const toast = useToast()
    return <button onClick={() => toast({ title: 'Saved', description: 'All changes stored', duration })}>Save</button>
  }

  it('shows a toast in the notifications region and dismisses it', async () => {
    const user = userEvent.setup()
    render(<ToastProvider><Sender /></ToastProvider>)
    await user.click(screen.getByRole('button', { name: 'Save' }))
    const region = screen.getByRole('region', { name: 'Notifications' })
    expect(await within(region).findByText('Saved')).toBeInTheDocument()
    await user.click(within(region).getByRole('button', { name: /dismiss/i }))
    await waitFor(() => expect(within(region).queryByText('Saved')).not.toBeInTheDocument())
  })

  it('times out on its own', async () => {
    const user = userEvent.setup()
    render(<ToastProvider><Sender duration={150} /></ToastProvider>)
    await user.click(screen.getByRole('button', { name: 'Save' }))
    const region = screen.getByRole('region', { name: 'Notifications' })
    expect(await within(region).findByText('Saved')).toBeInTheDocument()
    await waitFor(() => expect(within(region).queryByText('Saved')).not.toBeInTheDocument(), { timeout: 3000 })
  })

  it('keeps at most `max` toasts', async () => {
    const user = userEvent.setup()
    render(<ToastProvider max={2}><Sender duration={60_000} /></ToastProvider>)
    for (let i = 0; i < 4; i++) await user.click(screen.getByRole('button', { name: 'Save' }))
    const region = screen.getByRole('region', { name: 'Notifications' })
    await waitFor(() => expect(within(region).getAllByText('Saved')).toHaveLength(2))
  })
})

describe('DataGrid', () => {
  type Row = { id: number; name: string; region: string; amount: number }
  const rows: Row[] = [
    { id: 1, name: 'Northwind', region: 'EU', amount: 300 },
    { id: 2, name: 'Quill', region: 'US', amount: 100 },
    { id: 3, name: 'Acme', region: 'EU', amount: 200 },
  ]
  const columns: GridColumn<Row>[] = [{ key: 'name', label: 'Name' }, { key: 'region', label: 'Region' }, { key: 'amount', label: 'Amount', type: 'number' }]
  const names = () => within(screen.getByRole('grid')).getAllByRole('row').slice(1).map(r => within(r).queryByText(/Northwind|Quill|Acme/)?.textContent).filter(Boolean)

  it('renders every row', () => {
    render(<DataGrid aria-label="Customers" columns={columns} defaultRows={rows} rowKey={r => r.id} rowLabel={r => r.name} />)
    expect(screen.getByRole('grid', { name: 'Customers' })).toBeInTheDocument()
    expect(names()).toEqual(['Northwind', 'Quill', 'Acme'])
  })

  it('sorts by a column header, toggling direction', async () => {
    const user = userEvent.setup()
    render(<DataGrid aria-label="Customers" columns={columns} defaultRows={rows} rowKey={r => r.id} />)
    await user.click(screen.getByRole('button', { name: /^Amount/ }))
    expect(screen.getByRole('columnheader', { name: /Amount/ })).toHaveAttribute('aria-sort', 'ascending')
    expect(names()).toEqual(['Quill', 'Acme', 'Northwind'])
    await user.click(screen.getByRole('button', { name: /^Amount/ }))
    expect(screen.getByRole('columnheader', { name: /Amount/ })).toHaveAttribute('aria-sort', 'descending')
    expect(names()).toEqual(['Northwind', 'Acme', 'Quill'])
    await user.click(screen.getByRole('button', { name: /^Name/ }))
    expect(names()).toEqual(['Acme', 'Northwind', 'Quill'])
  })

  it('filters with the search box', async () => {
    const user = userEvent.setup()
    render(<DataGrid aria-label="Customers" columns={columns} defaultRows={rows} rowKey={r => r.id} />)
    await user.type(screen.getByRole('textbox', { name: /Search rows/ }), 'quill')
    await waitFor(() => expect(names()).toEqual(['Quill']))
    await user.clear(screen.getByRole('textbox', { name: /Search rows/ }))
    await waitFor(() => expect(names()).toHaveLength(3))
  })

  it('rejects an oversized search instead of freezing', async () => {
    render(<DataGrid aria-label="Customers" columns={columns} defaultRows={rows} rowKey={r => r.id} />)
    const box = screen.getByRole('textbox', { name: /Search rows/ }) as HTMLInputElement
    const user = userEvent.setup()
    await user.click(box)
    await user.paste('(a+)+$'.repeat(40))
    await waitFor(() => expect(box).toHaveAttribute('aria-invalid', 'true'))
  })

  it('selects rows with their checkboxes', async () => {
    const user = userEvent.setup()
    render(<DataGrid aria-label="Customers" columns={columns} defaultRows={rows} rowKey={r => r.id} rowLabel={r => r.name} />)
    const boxes = within(screen.getByRole('grid')).getAllByRole('checkbox')
    await user.click(boxes[1])
    expect(boxes[1]).toBeChecked()
    expect(await screen.findByRole('region', { name: 'Selection' })).toBeInTheDocument()
    await user.click(screen.getByRole('checkbox', { name: 'Select all' }))
    expect(within(screen.getByRole('grid')).getAllByRole('checkbox').every(b => (b as HTMLInputElement).checked)).toBe(true)
  })
})

describe('RichTextEditor', () => {
  it('sanitises defaultValue before it reaches the DOM', async () => {
    const hits = vi.fn()
    ;(window as unknown as { __xss: () => void }).__xss = hits
    const { container } = render(<RichTextEditor aria-label="Notes"
      defaultValue={'<p>Hello <b>world</b><img src=x onerror="window.__xss()"></p><script>window.__xss()</script><a href="javascript:window.__xss()">link</a><iframe src="https://evil.test"></iframe><p style="position:fixed">x</p>'} />)
    const editor = await screen.findByRole('textbox', { name: 'Notes' })
    await act(async () => { await new Promise(r => setTimeout(r, 50)) })
    expect(editor).toHaveTextContent('Hello world')
    expect(within(editor).getByText('world').tagName).toBe('B')
    expect(container.querySelector('img, script, iframe, [onerror], [style*="fixed"]')).toBeNull()
    expect(container.querySelector('a[href^="javascript"]')).toBeNull()
    expect(editor.textContent).toContain('link')
    expect(hits).not.toHaveBeenCalled()
  })

  it('runs custom sanitize on defaultValue', async () => {
    const sanitize = vi.fn(() => '<p>replaced</p>')
    render(<RichTextEditor aria-label="Notes" defaultValue="<p>original</p>" sanitize={sanitize} />)
    expect(await screen.findByText('replaced')).toBeInTheDocument()
    expect(sanitize).toHaveBeenCalledWith('<p>original</p>')
  })
})
