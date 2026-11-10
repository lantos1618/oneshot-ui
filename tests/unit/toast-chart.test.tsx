// 0.8.2: the toast API (ids, update, dismiss, promise toasts, dedupe, max + "+n more", pause, announcements, undo) and
// the chart kit's data-table fallback and export (exportChart: CSV, SVG with inlined colours, PNG through a mocked canvas).
import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { useRef, type ReactNode, type RefObject } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { LocaleProvider } from '../../src/lib/core'
import { UI_MESSAGES_DE } from '../../src/lib/provider'
import { BarList, Chart, DonutChart, ScatterChart, ToastProvider, UIProvider, exportChart, toast, useToast, type ToastApi } from '../../src/lib'

/* ── Toasts ─────────────────────────────────────────────────────────────── */

let api: ToastApi
function Grab() { api = useToast(); return null }
const mount = (max?: number) => render(<ToastProvider max={max}><Grab /></ToastProvider>)
const region = () => screen.getByRole('region', { name: 'Notifications' })
const dismissButtons = () => within(region()).queryAllByRole('button', { name: 'Dismiss notification' })
const deferred = <T,>() => { let resolve!: (v: T) => void, reject!: (e: unknown) => void; const promise = new Promise<T>((a, b) => { resolve = a; reject = b }); return { promise, resolve, reject } }

describe('toast API', () => {
  it('returns an id; update changes the toast in place, dismiss(id) and dismiss() remove', async () => {
    mount()
    let id: string | number = ''
    act(() => { id = api({ title: 'Saving…', duration: Infinity }) })
    expect(typeof id === 'string' || typeof id === 'number').toBe(true)
    const before = dismissButtons()[0]
    act(() => { expect(api.update(id, { title: 'Saved', description: '3 files' })).toBe(true) })
    expect(within(region()).getByText('Saved')).toBeTruthy()
    expect(within(region()).getByText('3 files')).toBeTruthy()
    expect(dismissButtons()).toHaveLength(1)
    expect(dismissButtons()[0]).toBe(before) // same element: it kept its slot
    expect(api.update('nope', { title: 'x' })).toBe(false)
    act(() => { api({ title: 'Second', duration: Infinity }); api({ title: 'Third', duration: Infinity }) })
    act(() => api.dismiss(id))
    await vi.waitFor(() => expect(within(region()).queryByText('Saved')).toBeNull())
    act(() => api.dismiss())
    await vi.waitFor(() => expect(dismissButtons()).toHaveLength(0))
  })

  it('dedupes by id: the same id replaces the toast instead of stacking a second', () => {
    mount()
    act(() => { api({ id: 'sync', title: 'Syncing', duration: Infinity }) })
    act(() => { expect(api({ id: 'sync', title: 'Synced', duration: Infinity })).toBe('sync') })
    expect(dismissButtons()).toHaveLength(1)
    expect(within(region()).getByText('Synced')).toBeTruthy()
    expect(within(region()).queryByText('Syncing')).toBeNull()
  })

  it('promise: one toast morphs from loading to success with the value, keeping its element', async () => {
    mount()
    const d = deferred<number>()
    let id: string | number = ''
    act(() => { id = api.promise(d.promise, { loading: 'Uploading…', success: n => ({ title: `Uploaded ${n} files`, description: 'Shared' }), error: 'Failed' }) })
    expect(within(region()).getByText('Uploading…')).toBeTruthy()
    const el = dismissButtons()[0]
    await act(async () => { d.resolve(3); await d.promise })
    expect(await within(region()).findByText('Uploaded 3 files')).toBeTruthy()
    expect(within(region()).queryByText('Uploading…')).toBeNull()
    expect(dismissButtons()).toEqual([el])
    expect(typeof id).toBe('string')
  })

  it('promise: rejection shows the error toast (assertive), from a function of the error', async () => {
    mount()
    const d = deferred<number>()
    act(() => { api.promise(() => d.promise, { loading: { title: 'Uploading…' }, success: 'Done', error: e => ({ title: 'Upload failed', description: (e as Error).message }) }) })
    await act(async () => { d.reject(new Error('Disk full')); await d.promise.catch(() => {}) })
    expect(await within(region()).findByText('Upload failed')).toBeTruthy()
    expect(within(region()).getByText('Disk full')).toBeTruthy()
    expect(within(region()).getByRole('alert').textContent).toBe('Error: Upload failed. Disk full')
  })

  it('shows at most `max` per position with a "+n more" badge; older ones come back as newer ones leave', async () => {
    mount(2)
    act(() => { for (const t of ['One', 'Two', 'Three', 'Four']) api({ id: t, title: t, duration: Infinity }) })
    expect(within(region()).getByText('Four')).toBeTruthy()
    expect(within(region()).getByText('Three')).toBeTruthy()
    expect(within(region()).queryByText('Two')).toBeNull()
    expect(within(region()).getByText('+2 more')).toBeTruthy()
    act(() => api.dismiss('Four'))
    expect(await within(region()).findByText('Two')).toBeTruthy()
    expect(within(region()).getByText('+1 more')).toBeTruthy()
  })

  it('times out; pauses while hovered, focused or the tab is hidden; Infinity never times out', () => {
    vi.useFakeTimers()
    mount()
    const gone = vi.fn(), sticky = vi.fn()
    act(() => { api({ title: 'Hover me', duration: 1000, onDismiss: gone }); api({ title: 'Sticky', duration: Infinity, onDismiss: sticky }) })
    const card = within(region()).getByText('Hover me').closest('[class*="pointer-events-auto"]')!
    fireEvent.pointerEnter(card)
    act(() => { vi.advanceTimersByTime(3000) })
    expect(gone).not.toHaveBeenCalled()
    fireEvent.pointerLeave(card)
    // focus inside the region pauses too
    act(() => { (dismissButtons()[0] as HTMLButtonElement).focus() })
    act(() => { vi.advanceTimersByTime(3000) })
    expect(gone).not.toHaveBeenCalled()
    act(() => { (document.activeElement as HTMLElement).blur() })
    // a hidden tab pauses
    const vis = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden')
    act(() => { document.dispatchEvent(new Event('visibilitychange')) })
    act(() => { vi.advanceTimersByTime(3000) })
    expect(gone).not.toHaveBeenCalled()
    vis.mockReturnValue('visible')
    act(() => { document.dispatchEvent(new Event('visibilitychange')) })
    act(() => { vi.advanceTimersByTime(1100) })
    expect(gone).toHaveBeenCalledWith('timeout', expect.anything())
    act(() => { vi.advanceTimersByTime(60_000) })
    expect(sticky).not.toHaveBeenCalled()
  })

  it('un-pauses when the hovered toast is removed from code (no pointerleave arrives)', () => {
    vi.useFakeTimers()
    mount()
    const gone = vi.fn()
    act(() => { api({ id: 'a', title: 'Hovered', duration: Infinity }) })
    fireEvent.pointerEnter(within(region()).getByText('Hovered').closest('[class*="pointer-events-auto"]')!)
    act(() => { api.dismiss('a'); api({ title: 'Next', duration: 1000, onDismiss: gone }) })
    act(() => { vi.advanceTimersByTime(1100) })
    expect(gone).toHaveBeenCalledWith('timeout', expect.anything())
  })

  it('announces each toast once, politely, with its tone; updates are announced again', () => {
    mount()
    let id: string | number = ''
    act(() => { id = api({ title: 'Saved', description: 'All changes stored', duration: Infinity }) })
    const polite = within(region()).getByRole('status')
    expect(polite.textContent).toBe('Success: Saved. All changes stored')
    act(() => { api.update(id, { title: 'Saved again', description: undefined, tone: 'info' }) })
    expect(polite.textContent).toBe('Info: Saved again')
    act(() => { api({ title: 'Couldn’t connect', tone: 'bad', duration: Infinity }) })
    expect(within(region()).getByRole('alert').textContent).toBe('Error: Couldn’t connect')
    expect(polite.textContent).toBe('Info: Saved again')
    // dismissed and shown again under the same id: announced again
    act(() => { api({ id: 'again', title: 'Ping', duration: Infinity }) })
    act(() => { api({ title: 'Other', duration: Infinity }) })
    act(() => api.dismiss('again'))
    act(() => { api({ id: 'again', title: 'Ping', duration: Infinity }) })
    expect(polite.textContent).toBe('Success: Ping')
  })

  it('action buttons close the toast unless onClick prevents it; undoable commits only without Undo', async () => {
    mount()
    const onUndo = vi.fn(), onCommit = vi.fn(), keep = vi.fn((e: { preventDefault: () => void }) => e.preventDefault())
    act(() => { api.undoable({ title: 'Archived', onUndo, onCommit, duration: Infinity }) })
    fireEvent.click(within(region()).getByRole('button', { name: 'Undo' }))
    expect(onUndo).toHaveBeenCalledTimes(1)
    expect(onCommit).not.toHaveBeenCalled()
    const commit2 = vi.fn()
    let id: string | number = ''
    act(() => { id = api.undoable({ title: 'Deleted', onUndo: () => {}, onCommit: commit2, duration: Infinity }) })
    act(() => api.dismiss(id))
    expect(commit2).toHaveBeenCalledTimes(1)
    act(() => { api({ title: 'Keep me', duration: Infinity, action: { label: 'Copy link', onClick: keep } }) })
    fireEvent.click(within(region()).getByRole('button', { name: 'Copy link' }))
    expect(keep).toHaveBeenCalled()
    expect(within(region()).getByText('Keep me')).toBeTruthy()
  })

  it('a standalone `toast` works without a hook, through the page-wide region', async () => {
    render(<UIProvider persist={false}><p>app</p></UIProvider>)
    let id: string | number = ''
    act(() => { id = toast({ title: 'From anywhere', duration: Infinity, position: 'top-center' }) })
    expect(within(region()).getByText('From anywhere')).toBeTruthy()
    act(() => { toast.update(id, { title: 'Updated from anywhere' }) })
    expect(within(region()).getByText('Updated from anywhere')).toBeTruthy()
    act(() => toast.dismiss())
    await vi.waitFor(() => expect(within(region()).queryByText('Updated from anywhere')).toBeNull())
  })
})

/* ── Chart data table ───────────────────────────────────────────────────── */

const ITEMS = [{ label: 'Germany', value: 4210 }, { label: 'France', value: 1320 }, { label: 'Japan', value: 870 }]

describe('chart data table', () => {
  it('renders a visually hidden table by default; the chart is described by its caption', () => {
    render(<BarList items={ITEMS} label="Top countries" />)
    const table = screen.getByRole('table', { name: /Top countries/ })
    expect(table.closest('.sr-only')).not.toBeNull()
    expect(within(table).getAllByRole('columnheader').map(h => h.textContent)).toEqual(['Item', 'Value'])
    expect(within(table).getAllByRole('rowheader').map(h => h.textContent)).toEqual(['Germany', 'France', 'Japan'])
    expect(within(table).getAllByRole('cell').map(c => c.textContent)).toEqual(['4,210', '1,320', '870'])
    expect(screen.getByRole('group', { name: 'Top countries' })).toHaveAccessibleDescription(/^3 items, .*870/)
  })

  it("formats numbers with the provider's locale", () => {
    render(<LocaleProvider locale="de-DE" messages={UI_MESSAGES_DE}><BarList items={ITEMS} label="Länder" /></LocaleProvider>)
    const table = screen.getByRole('table', { name: /Länder/ })
    expect(within(table).getAllByRole('cell')[0].textContent).toBe('4.210')
    expect(within(table).getAllByRole('columnheader')[0].textContent).toBe('Eintrag')
  })

  it('table="toggle" adds a Show data button that reveals it as a scrollable region; "shown" shows it at once', () => {
    const { unmount } = render(<DonutChart table="toggle" centerLabel="Traffic" data={[{ label: 'Direct', value: 42 }, { label: 'Search', value: 58 }]} />)
    const button = screen.getByRole('button', { name: 'Show data' })
    expect(button).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByRole('region', { name: 'Traffic by share' })).toBeNull()
    fireEvent.click(button)
    expect(screen.getByRole('button', { name: 'Hide data' })).toHaveAttribute('aria-expanded', 'true')
    const shown = screen.getByRole('region', { name: 'Traffic by share' })
    expect(within(shown).getAllByRole('row')).toHaveLength(3)
    expect(within(shown).getAllByRole('cell').map(c => c.textContent)).toEqual(['42', '42%', '58', '58%'])
    unmount()
    render(<ScatterChart table="shown" label="Spend vs revenue" xLabel="Spend" yLabel="Revenue" points={[{ x: 1, y: 2, label: 'A' }, { x: 3, y: 4, label: 'B' }]} />)
    const t = within(screen.getByRole('region', { name: 'Spend vs revenue' }))
    expect(t.getAllByRole('columnheader').map(h => h.textContent)).toEqual(['Label', 'Spend', 'Revenue'])
    expect(screen.queryByRole('button', { name: 'Show data' })).toBeNull()
  })

  it('Chart: every row, one column per value, the series labels as headers and ISO times as raw values', () => {
    const t0 = Date.UTC(2026, 0, 1)
    render(<Chart table="shown" label="Load" x="t" xTime data={[{ t: t0, cpu: 12.5, mem: 40 }, { t: t0 + 3600e3, cpu: null, mem: 42 }]}
      series={[{ key: 'cpu', label: 'CPU' }, { key: 'mem', label: 'Memory', type: 'bar' }]} />)
    const t = within(screen.getByRole('region', { name: 'Load' }))
    expect(t.getAllByRole('columnheader').map(h => h.textContent)).toEqual(['Time', 'CPU', 'Memory'])
    expect(t.getAllByRole('rowheader')[0]).toHaveAttribute('data-v', '2026-01-01T00:00:00.000Z')
    expect(t.getAllByRole('cell').map(c => c.textContent)).toEqual(['12.5', '40', '', '42'])
  })
})

/* ── Export ─────────────────────────────────────────────────────────────── */

const THEME = { '--c2': '#2563eb', '--c3': '#f97316', '--card': '#ffffff', '--fg': '#111111', '--fg2': '#444444', '--fg3': '#666666', '--line': '#e5e5e5', '--muted': '#f2f2f2', '--accent': '#2563eb' } as Record<string, string>
function Themed({ children }: { children: ReactNode }) { return <div style={THEME}>{children}</div> }
let chartRef: RefObject<HTMLDivElement | null>
function Donut(p: { exportable?: boolean }) {
  chartRef = useRef<HTMLDivElement>(null)
  return <Themed><DonutChart ref={chartRef} centerLabel="Traffic" exportable={p.exportable} data={[{ label: 'Direct, organic', value: 42, color: 'var(--c2)' }, { label: '=SUM(A1)', value: 58, color: 'var(--c3)' }]} /></Themed>
}

describe('exportChart', () => {
  beforeEach(() => {
    Object.assign(URL, { createObjectURL: vi.fn(() => 'blob:chart'), revokeObjectURL: vi.fn() })
  })
  afterEach(() => { vi.restoreAllMocks() })

  it('CSV: header and raw rows from the data table, quoted, formula-safe, with a BOM', async () => {
    render(<Donut />)
    const blob = await exportChart(chartRef, { format: 'csv', download: false })
    expect(blob.type).toContain('text/csv')
    const bytes = new Uint8Array(await blob.arrayBuffer())
    expect([...bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf])
    const text = new TextDecoder().decode(bytes.slice(3))
    expect(text.split('\r\n')).toEqual(['Item,Value,Share', '"Direct, organic",42,0.42', "'=SUM(A1),58,0.58", ''])
  })

  it('SVG: the theme colours are inlined (no CSS variables or classes left), titled with the chart label', async () => {
    render(<Donut />)
    const svg = await (await exportChart(chartRef, { format: 'svg', download: false })).text()
    expect(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg"')).toBe(true)
    expect(svg).toContain('#2563eb')
    expect(svg).toContain('#f97316')
    expect(svg).toContain('<title>Traffic by share</title>')
    expect(svg).toContain('fill="#ffffff"') // the card behind the chart
    expect(svg).toContain('>Direct, organic</text>') // the HTML legend, redrawn as SVG text
    expect(svg).not.toContain('var(--')
    expect(svg).not.toContain('class=')
    expect(new DOMParser().parseFromString(svg, 'image/svg+xml').querySelector('parsererror')).toBeNull()
  })

  it('PNG: draws the serialised SVG on a canvas at `scale` and downloads it under the chart label', async () => {
    const drawImage = vi.fn(), scale = vi.fn()
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ scale, drawImage } as unknown as CanvasRenderingContext2D)
    vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(function (this: HTMLCanvasElement, cb: BlobCallback) { cb(new Blob(['png'], { type: 'image/png' })) })
    class FakeImage { onload: (() => void) | null = null; onerror: (() => void) | null = null; set src(v: string) { this._src = v; queueMicrotask(() => this.onload?.()) } get src() { return this._src } _src = '' }
    vi.stubGlobal('Image', FakeImage)
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) { expect(this.download).toBe('traffic-by-share.png') })
    render(<Donut />)
    const blob = await exportChart(chartRef, { format: 'png', scale: 3 })
    expect(blob.type).toBe('image/png')
    expect(scale).toHaveBeenCalledWith(3, 3)
    expect(drawImage).toHaveBeenCalledTimes(1)
    expect((drawImage.mock.calls[0][0] as FakeImage).src).toBe('blob:chart')
    expect(click).toHaveBeenCalledTimes(1)
    vi.unstubAllGlobals()
  })

  it('the exportable menu: ⋯ opens Download PNG / SVG / CSV, arrows move, Escape closes, CSV downloads', async () => {
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    render(<Donut exportable />)
    const trigger = screen.getByRole('button', { name: 'Export chart' })
    fireEvent.click(trigger)
    const menu = screen.getByRole('menu', { name: 'Export chart' })
    expect(within(menu).getAllByRole('menuitem').map(i => i.textContent)).toEqual(['Download PNG', 'Download SVG', 'Download CSV'])
    expect(document.activeElement).toBe(within(menu).getByRole('menuitem', { name: 'Download PNG' }))
    fireEvent.keyDown(menu, { key: 'ArrowDown' })
    expect(document.activeElement).toBe(within(menu).getByRole('menuitem', { name: 'Download SVG' }))
    fireEvent.keyDown(menu, { key: 'Escape' })
    expect(screen.queryByRole('menu')).toBeNull()
    expect(document.activeElement).toBe(trigger)
    fireEvent.click(trigger)
    await act(async () => { fireEvent.click(screen.getByRole('menuitem', { name: 'Download CSV' })) })
    await vi.waitFor(() => expect(click).toHaveBeenCalledTimes(1))
    expect((click.mock.contexts[0] as HTMLAnchorElement).download).toBe('traffic-by-share.csv')
  })
})
