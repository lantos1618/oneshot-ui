// 0.4 wave 2 (overlays, navigation, layout, data grid, scheduler): modal state shared across drop-in copies of the
// library, right-to-left behaviour (keys, sides, pins, week start) and the module catalogs (de/ar strings).
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState, type ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { LocaleProvider } from '../../src/lib/core'
import { UI_MESSAGES_AR } from '../../src/lib/provider'
import { CommandPalette, Dialog, DropdownMenu, Sheet } from '../../src/lib/overlay'
import { Pagination, Tabs, ToggleGroup } from '../../src/lib/navigation'
import { DataGrid, type GridPinned } from '../../src/lib/datagrid'
import { Scheduler } from '../../src/lib/scheduler'
import { SplitPane, TreeView } from '../../src/lib/layout'

const ar = (ui: ReactNode) => <LocaleProvider locale="ar-EG" messages={UI_MESSAGES_AR}>{ui}</LocaleProvider>
/** Inside an inert subtree? (jsdom keeps `inert` as a property only.) */
const isInert = (el: Element | null) => { for (let n = el as HTMLElement | null; n; n = n.parentElement) if (n.inert) return true; return false }
const rtlEn = (ui: ReactNode) => <LocaleProvider locale="en-GB" dir="rtl">{ui}</LocaleProvider>

describe('modal state shared by drop-in copies', () => {
  it('stacks dialogs from two copies of the module: inert and scroll lock unwind in order', async () => {
    // a second, independent copy of the overlay module, as a drop-in file would be (its own module-level code)
    vi.resetModules()
    const copy = await import('../../src/lib/overlay?copy=2' as string) as typeof import('../../src/lib/overlay')
    expect(copy.Dialog).not.toBe(Dialog)
    document.documentElement.style.overflow = 'clip' // a host style the lock must put back
    function Page() {
      const [outer, setOuter] = useState(false), [inner, setInner] = useState(false)
      return (
        <div>
          <button onClick={() => setOuter(true)}>Open outer</button>
          <main data-testid="page">Page content</main>
          <Dialog.Root open={outer} onOpenChange={setOuter}>
            <Dialog.Content aria-label="Outer">
              <button onClick={() => setInner(true)}>Open inner</button>
              <copy.Dialog.Root open={inner} onOpenChange={setInner}>
                <copy.Dialog.Content aria-label="Inner"><copy.Dialog.Close>Close inner</copy.Dialog.Close></copy.Dialog.Content>
              </copy.Dialog.Root>
            </Dialog.Content>
          </Dialog.Root>
        </div>
      )
    }
    const user = userEvent.setup()
    render(<Page />)
    const pageInert = () => isInert(screen.getByTestId('page'))
    await user.click(screen.getByRole('button', { name: 'Open outer' }))
    await waitFor(() => expect(pageInert()).toBe(true))
    expect(document.documentElement.style.overflow).toBe('hidden')
    await user.click(screen.getByRole('button', { name: 'Open inner' }))
    const outer = screen.getByRole('dialog', { name: 'Outer' })
    // the inner dialog (other copy) is now the top layer: the outer panel is inert, the inner one is not
    await waitFor(() => expect(isInert(outer)).toBe(true))
    const inner = screen.getByRole('dialog', { name: 'Inner' })
    expect(isInert(inner)).toBe(false)
    // Escape closes only the top one, and hands the page back to the outer dialog
    fireEvent.keyDown(document, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Inner' })).toBeNull())
    await waitFor(() => expect(isInert(outer)).toBe(false))
    expect(document.documentElement.style.overflow).toBe('hidden') // still locked: the outer one is open
    expect(pageInert()).toBe(true)
    fireEvent.keyDown(document, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Outer' })).toBeNull())
    await waitFor(() => expect(pageInert()).toBe(false))
    expect(document.documentElement.style.overflow).toBe('clip') // the host's own style is restored
    document.documentElement.style.overflow = ''
  })
})

describe('right to left', () => {
  it('Sheet side="end" opens from the left in RTL and from the right in LTR; left/right stay physical', () => {
    const { rerender } = render(<Sheet open onOpenChange={() => {}} title="Filters" responsive={false}>x</Sheet>)
    expect(screen.getByRole('dialog', { name: 'Filters' })).toHaveAttribute('data-side', 'right')
    rerender(rtlEn(<Sheet open onOpenChange={() => {}} title="Filters" responsive={false}>x</Sheet>))
    expect(screen.getByRole('dialog', { name: 'Filters' })).toHaveAttribute('data-side', 'left')
    rerender(rtlEn(<Sheet open onOpenChange={() => {}} title="Filters" side="right" responsive={false}>x</Sheet>))
    expect(screen.getByRole('dialog', { name: 'Filters' })).toHaveAttribute('data-side', 'right')
    rerender(rtlEn(<Sheet open onOpenChange={() => {}} title="Filters" side="start" responsive={false}>x</Sheet>))
    expect(screen.getByRole('dialog', { name: 'Filters' })).toHaveAttribute('data-side', 'right')
  })

  it('tabs and toggle groups: ← moves forward in RTL', async () => {
    const user = userEvent.setup()
    render(rtlEn(<>
      <Tabs items={[{ value: 'a', label: 'One' }, { value: 'b', label: 'Two' }, { value: 'c', label: 'Three' }]} />
      <ToggleGroup type="single" defaultValue="l" aria-label="Align"><ToggleGroup.Item value="l">Start</ToggleGroup.Item><ToggleGroup.Item value="c">Centre</ToggleGroup.Item></ToggleGroup>
    </>))
    await user.click(screen.getByRole('tab', { name: 'One' }))
    await user.keyboard('{ArrowLeft}')
    expect(screen.getByRole('tab', { name: 'Two' })).toHaveAttribute('aria-selected', 'true')
    await user.keyboard('{ArrowRight}')
    expect(screen.getByRole('tab', { name: 'One' })).toHaveAttribute('aria-selected', 'true')
    await user.click(screen.getByRole('radio', { name: 'Start' }))
    await user.keyboard('{ArrowLeft}')
    expect(screen.getByRole('radio', { name: 'Centre' })).toHaveAttribute('aria-checked', 'true')
  })

  it('submenus open with ← and close with → in RTL', async () => {
    const user = userEvent.setup()
    render(rtlEn(
      <DropdownMenu.Root>
        <DropdownMenu.Trigger>View</DropdownMenu.Trigger>
        <DropdownMenu.Content>
          <DropdownMenu.Sub>
            <DropdownMenu.SubTrigger>Export</DropdownMenu.SubTrigger>
            <DropdownMenu.SubContent><DropdownMenu.Item>PNG</DropdownMenu.Item></DropdownMenu.SubContent>
          </DropdownMenu.Sub>
        </DropdownMenu.Content>
      </DropdownMenu.Root>,
    ))
    await user.click(screen.getByRole('button', { name: 'View' }))
    const sub = await screen.findByRole('menuitem', { name: 'Export' })
    sub.focus()
    await user.keyboard('{ArrowRight}') // the wrong way in RTL: nothing opens
    expect(sub).toHaveAttribute('aria-expanded', 'false')
    await user.keyboard('{ArrowLeft}')
    expect(sub).toHaveAttribute('aria-expanded', 'true')
    await waitFor(() => expect(screen.getByRole('menuitem', { name: 'PNG' })).toHaveFocus())
    await user.keyboard('{ArrowRight}')
    expect(sub).toHaveAttribute('aria-expanded', 'false')
    expect(sub).toHaveFocus()
  })

  it('tree view: ← opens a folder in RTL; split pane: ← grows the first pane', async () => {
    const user = userEvent.setup()
    render(rtlEn(<>
      <TreeView nodes={[{ id: 'src', label: 'src', children: [{ id: 'a', label: 'a.ts' }] }]} />
      <SplitPane first="A" second="B" defaultSize={40} stackBelow={0} />
    </>))
    const folder = screen.getByRole('treeitem', { name: /src/ })
    folder.focus()
    await user.keyboard('{ArrowLeft}')
    expect(folder).toHaveAttribute('aria-expanded', 'true')
    await user.keyboard('{ArrowRight}')
    expect(folder).toHaveAttribute('aria-expanded', 'false')
    const sep = screen.getByRole('separator', { name: 'Resize panes' })
    sep.focus()
    await user.keyboard('{ArrowLeft}')
    expect(sep).toHaveAttribute('aria-valuenow', '42')
  })

  it('data grid: ← moves to the next cell in RTL, and left/right pins are physical (left is the end)', async () => {
    type R = { id: number; name: string; mrr: number }
    const rows: R[] = [{ id: 1, name: 'Acme', mrr: 10 }, { id: 2, name: 'Bolt', mrr: 20 }]
    const onPins = vi.fn<(p: GridPinned) => void>()
    const user = userEvent.setup()
    render(rtlEn(<DataGrid<R> aria-label="Accounts" rows={rows} rowKey={r => r.id} defaultPinnedColumns={{ left: ['mrr'] }} onPinnedColumnsChange={onPins}
      columns={[{ key: 'name', label: 'Name' }, { key: 'mrr', label: 'MRR', type: 'number' }]} />))
    const grid = screen.getByRole('grid', { name: 'Accounts' })
    // MRR is pinned to the physical left, which is the end in RTL: it comes last
    expect(within(grid).getAllByRole('columnheader').map(h => h.textContent?.replace(/[▲▼]/g, '').trim()).filter(Boolean)).toEqual(['Name', 'MRR'])
    await user.click(within(grid).getByText('Acme'))
    await user.keyboard('{ArrowLeft}')
    expect(document.activeElement).toHaveTextContent('10')
    await user.keyboard('{ArrowRight}')
    expect(document.activeElement).toHaveTextContent('Acme')
    // the Columns menu: pin Name to the start (the right in RTL); the change reports logical and physical keys
    await user.click(screen.getByRole('button', { name: 'Columns' }))
    await user.click(screen.getByRole('button', { name: 'Pin Name right' }))
    expect(onPins).toHaveBeenLastCalledWith({ start: ['name'], end: ['mrr'], left: ['mrr'], right: ['name'] })
  })

  it('scheduler: the week starts on the locale’s first day (Saturday in ar-EG) and dates use its digits', () => {
    render(ar(<Scheduler defaultView="month" today={new Date(2026, 10, 9)} />))
    const region = screen.getByRole('region')
    // the first column heading is Saturday, in Arabic
    const sat = new Intl.DateTimeFormat('ar-EG', { weekday: 'short' }).format(new Date(2026, 10, 7))
    expect(within(region).getAllByText(sat)[0]).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'اليوم' })).toBeInTheDocument()
    expect(within(region).getAllByText('٩').length).toBeGreaterThan(0)
  })
})

describe('module catalogs', () => {
  it('German and Arabic strings come from the module catalogs', async () => {
    render(<LocaleProvider locale="de-DE"><CommandPalette open onOpenChange={() => {}} commands={[{ id: 'a', label: 'Open settings' }]} /></LocaleProvider>)
    expect(screen.getByRole('dialog', { name: 'Befehlspalette' })).toBeInTheDocument()
    expect(screen.getByPlaceholderText('Befehl eingeben oder suchen…')).toBeInTheDocument()
  })

  it('Pagination in Arabic: labels and digits', () => {
    render(ar(<Pagination page={2} total={5} onChange={() => {}} />))
    expect(screen.getByRole('navigation')).toBeInTheDocument()
    expect(screen.getByText('٢')).toBeInTheDocument()
  })

  it('an app overrides one key through the provider', () => {
    render(<LocaleProvider messages={{ 'overlay.palette': 'Quick actions' }}><CommandPalette open onOpenChange={() => {}} commands={[]} /></LocaleProvider>)
    expect(screen.getByRole('dialog', { name: 'Quick actions' })).toBeInTheDocument()
  })
})

void act
