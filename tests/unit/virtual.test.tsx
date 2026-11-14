// Virtualization engine: window math, the hook against a scroll element (jsdom has no layout, so the viewport comes
// from `initialRect` and scrolling is simulated by setting scrollTop and dispatching `scroll`), dynamic measurement
// through a fake ResizeObserver, scrollToIndex alignments, bottom-anchored chat logs and VirtualList's ARIA.
import { act, fireEvent, render, screen } from '@testing-library/react'
import { useRef, type Key } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { VirtualList, useVirtual, virtualAlignOffset, virtualFind, virtualRange, virtualRowAria, virtualSetAria, virtualStarts, type Virtualizer, type VirtualOptions } from '../../src/lib/virtual'

describe('window math', () => {
  const starts = virtualStarts(100, () => 20) // 100 items of 20px

  it('builds prefix sums with padding, and redoes only the tail', () => {
    const s = virtualStarts(4, i => [10, 20, 30, 40][i], 5)
    expect([...s]).toEqual([5, 15, 35, 65, 105])
    const sizes = [10, 20, 99, 40]
    const again = virtualStarts(4, i => sizes[i], 5, s, 2)
    expect(again).toBe(s) // reused in place
    expect([...again]).toEqual([5, 15, 35, 134, 174])
  })

  it('finds the item at an offset (binary search, clamped)', () => {
    expect(virtualFind(starts, 100, 0)).toBe(0)
    expect(virtualFind(starts, 100, 19.9)).toBe(0)
    expect(virtualFind(starts, 100, 20)).toBe(1)
    expect(virtualFind(starts, 100, 1990)).toBe(99)
    expect(virtualFind(starts, 100, 99999)).toBe(99)
    expect(virtualFind(starts, 100, -50)).toBe(0)
  })

  it('computes the visible range and the overscanned range', () => {
    expect(virtualRange(starts, 100, 0, 100, 3)).toEqual({ visibleStart: 0, visibleEnd: 4, start: 0, end: 7 })
    expect(virtualRange(starts, 100, 410, 100, 3)).toEqual({ visibleStart: 20, visibleEnd: 25, start: 17, end: 28 })
    expect(virtualRange(starts, 100, 1900, 100, 3)).toEqual({ visibleStart: 95, visibleEnd: 99, start: 92, end: 99 })
    expect(virtualRange(starts, 0, 0, 100, 3)).toBeNull()
  })

  it('aligns an item: start, center, end, auto (and clamps to the scrollable range)', () => {
    // item 50: start 1000, size 20; viewport 100; total 2000
    expect(virtualAlignOffset(1000, 20, 100, 0, 2000, 'start')).toBe(1000)
    expect(virtualAlignOffset(1000, 20, 100, 0, 2000, 'end')).toBe(920)
    expect(virtualAlignOffset(1000, 20, 100, 0, 2000, 'center')).toBe(960)
    expect(virtualAlignOffset(1000, 20, 100, 950, 2000, 'auto')).toBeNull() // already fully visible
    expect(virtualAlignOffset(1000, 20, 100, 0, 2000, 'auto')).toBe(920) // below: least scroll puts it at the bottom
    expect(virtualAlignOffset(1000, 20, 100, 1500, 2000, 'auto')).toBe(1000) // above: at the top
    expect(virtualAlignOffset(1990, 20, 100, 0, 2000, 'start')).toBe(1900) // clamped to total - viewport
    expect(virtualAlignOffset(0, 20, 100, 500, 2000, 'end')).toBe(0)
    // a sticky 30px header: `start` keeps the item below it, `auto` treats it as covered
    expect(virtualAlignOffset(1000, 20, 100, 0, 2000, 'start', 30)).toBe(970)
    expect(virtualAlignOffset(1000, 20, 100, 990, 2000, 'auto', 30)).toBe(970)
  })

  it('has ARIA helpers for sets and grid rows', () => {
    expect(virtualSetAria(4, 50)).toEqual({ 'aria-setsize': 50, 'aria-posinset': 5 })
    expect(virtualRowAria(0)).toEqual({ 'aria-rowindex': 2 })
    expect(virtualRowAria(9, 2)).toEqual({ 'aria-rowindex': 12 })
  })
})

/* A list driven by the hook, exposing the virtualizer for assertions. */
let api: Virtualizer
function Harness({ count, getItemKey, ...o }: Partial<VirtualOptions> & { count: number }) {
  const ref = useRef<HTMLDivElement>(null)
  api = useVirtual({ estimateSize: 20, initialRect: { width: 300, height: 100 }, overscan: 2, ...o, count, getItemKey, scrollRef: ref })
  return (
    <div ref={ref} data-testid="scroller" style={{ height: 100, overflow: 'auto' }}>
      <div data-testid="inner" style={{ height: api.totalSize, position: 'relative' }}>
        {api.items.map(it => <div key={it.key} data-index={it.index} ref={api.measureElement} data-start={it.start}>Item {getItemKey ? String(getItemKey(it.index)) : it.index}</div>)}
      </div>
    </div>
  )
}
const shown = () => [...document.querySelectorAll('[data-index]')].map(e => Number(e.getAttribute('data-index')))
const scrollTo = (top: number) => act(() => { const el = screen.getByTestId('scroller'); el.scrollTop = top; fireEvent.scroll(el) })

describe('useVirtual', () => {
  it('renders the first viewport plus overscan, sized for the whole list', () => {
    render(<Harness count={1000} />)
    expect(shown()).toEqual([0, 1, 2, 3, 4, 5, 6]) // 5 visible (100 / 20) + 2 overscan below
    expect(screen.getByTestId('inner').style.height).toBe('20000px')
  })

  it('follows scrolling, re-rendering when the view nears the edge of what is rendered', () => {
    render(<Harness count={1000} />)
    scrollTo(5000) // items 250..254 visible
    expect(shown()).toEqual([248, 249, 250, 251, 252, 253, 254, 255, 256])
    scrollTo(19950) // the end
    expect(shown().at(-1)).toBe(999)
    expect(shown().length).toBeLessThanOrEqual(9)
  })

  it('renders everything when disabled, with the same items API', () => {
    render(<Harness count={30} enabled={false} />)
    expect(shown()).toHaveLength(30)
  })

  it('scrollToIndex aligns start, center, end and auto, and renders the target at once', () => {
    render(<Harness count={1000} />)
    const el = screen.getByTestId('scroller')
    act(() => api.scrollToIndex(500, { align: 'start' }))
    expect(el.scrollTop).toBe(10000)
    expect(shown()).toContain(500)
    act(() => api.scrollToIndex(500, { align: 'end' }))
    expect(el.scrollTop).toBe(9920)
    act(() => api.scrollToIndex(500, { align: 'center' }))
    expect(el.scrollTop).toBe(9960)
    act(() => api.scrollToIndex(501, { align: 'auto' })) // in view: no scroll
    expect(el.scrollTop).toBe(9960)
    act(() => api.scrollToIndex(20, { align: 'auto' }))
    expect(el.scrollTop).toBe(400)
    act(() => api.scrollToIndex(5000)) // past the end: clamped to the last item
    expect(el.scrollTop).toBe(19900)
    act(() => api.scrollToOffset(-10))
    expect(el.scrollTop).toBe(0)
  })

  it('keeps requested indexes rendered outside the window', () => {
    render(<Harness count={1000} keep={[900]} />)
    expect(shown()).toEqual([0, 1, 2, 3, 4, 5, 6, 900])
    expect(document.querySelector('[data-index="900"]')).toHaveAttribute('data-start', '18000')
  })

  it('keeps the focused item rendered after it scrolls out of view', () => {
    render(<Harness count={1000} />)
    const item = document.querySelector<HTMLElement>('[data-index="2"]')!
    item.tabIndex = 0
    act(() => item.focus())
    scrollTo(10000)
    expect(document.activeElement).toBe(item)
    expect(shown()).toContain(2)
    expect(shown()).toContain(500)
  })

  it('calls onEndReached once per count when the end comes into view', () => {
    const more = vi.fn()
    const { rerender } = render(<Harness count={100} onEndReached={more} />)
    expect(more).not.toHaveBeenCalled()
    scrollTo(1900)
    scrollTo(1890)
    expect(more).toHaveBeenCalledTimes(1)
    // re-renders while the end stays in view (the host re-rendering, a new callback) don't ask again for the same count
    rerender(<Harness count={100} onEndReached={more} />)
    rerender(<Harness count={100} onEndReached={(...a: unknown[]) => more(...a)} />)
    scrollTo(1880)
    expect(more).toHaveBeenCalledTimes(1)
    rerender(<Harness count={200} onEndReached={more} />)
    expect(more).toHaveBeenCalledTimes(1) // the new end is far away
    scrollTo(3900)
    expect(more).toHaveBeenCalledTimes(2)
  })

  it('stays SSR-safe: renders the initial window without touching the DOM during render', async () => {
    const { renderToString } = await import('react-dom/server')
    const html = renderToString(<Harness count={1000} />)
    expect((html.match(/data-index=/g) ?? []).length).toBe(7)
  })
})

describe('useVirtual: measured sizes', () => {
  // a ResizeObserver we can drive by hand
  let observers: { cb: ResizeObserverCallback; els: Set<Element> }[] = []
  const Real = globalThis.ResizeObserver
  beforeEach(() => {
    observers = []
    globalThis.ResizeObserver = class {
      o: { cb: ResizeObserverCallback; els: Set<Element> }
      constructor(cb: ResizeObserverCallback) { this.o = { cb, els: new Set() }; observers.push(this.o) }
      observe(el: Element) { this.o.els.add(el) }
      unobserve(el: Element) { this.o.els.delete(el) }
      disconnect() { this.o.els.clear() }
    } as unknown as typeof ResizeObserver
  })
  afterEach(() => { globalThis.ResizeObserver = Real })
  const resize = (sizes: Record<number, number>) => act(() => {
    for (const o of observers) {
      const entries = [...o.els].filter(el => el.hasAttribute('data-index') && Number(el.getAttribute('data-index')) in sizes)
        .map(el => ({ target: el, borderBoxSize: [{ blockSize: sizes[Number(el.getAttribute('data-index'))], inlineSize: 300 }] }))
      if (entries.length) o.cb(entries as unknown as ResizeObserverEntry[], o as unknown as ResizeObserver)
    }
  })
  const startOf = (i: number) => Number(document.querySelector(`[data-index="${i}"]`)?.getAttribute('data-start'))

  it('replaces estimates with measured sizes and shifts everything after', () => {
    render(<Harness count={100} />)
    resize({ 0: 100, 1: 5 })
    expect(startOf(1)).toBe(100)
    expect(startOf(2)).toBe(105)
    expect(screen.getByTestId('inner').style.height).toBe(`${2000 + 80 - 15}px`)
    expect(shown()).toEqual([0, 1, 2]) // the first item now fills the viewport
  })

  it('keeps sizes per key, so reordered items keep their measured height', () => {
    const keys = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']
    const { rerender } = render(<Harness count={8} getItemKey={(i: number): Key => keys[i]} />)
    resize({ 0: 60 }) // 'a'
    keys.reverse()
    rerender(<Harness count={8} getItemKey={(i: number): Key => keys[i]} keep={[7]} />)
    expect(startOf(7)).toBe(140) // 'a' is last now: 7 × 20 before it
    expect(screen.getByTestId('inner').style.height).toBe('200px')
  })

  it('adjusts the scroll when an item above the viewport changes size, so the view stays put', () => {
    render(<Harness count={1000} />)
    scrollTo(1000) // item 50 at the top; 48 and 49 are rendered above it
    resize({ 48: 50 })
    expect(screen.getByTestId('scroller').scrollTop).toBe(1030)
  })
})

describe('useVirtual: anchor end (chat log)', () => {
  function Chat({ ids }: { ids: string[] }) { return <Harness count={ids.length} anchor="end" getItemKey={i => ids[i]} /> }
  const ids = (from: number, to: number) => Array.from({ length: to - from }, (_, i) => `m${from + i}`)

  it('starts at the bottom and stays pinned while messages are appended', () => {
    const { rerender } = render(<Chat ids={ids(0, 50)} />)
    const el = screen.getByTestId('scroller')
    expect(el.scrollTop).toBe(900) // 1000 - 100
    expect(shown().at(-1)).toBe(49)
    rerender(<Chat ids={ids(0, 53)} />)
    expect(el.scrollTop).toBe(960)
    expect(shown().at(-1)).toBe(52)
  })

  it('keeps the reader’s place when older messages are prepended after scrolling up', () => {
    const { rerender } = render(<Chat ids={ids(10, 60)} />)
    const el = screen.getByTestId('scroller')
    scrollTo(200) // reading m20 at the top: no longer pinned
    rerender(<Chat ids={ids(0, 60)} />) // 10 older messages arrive above
    expect(el.scrollTop).toBe(400)
    expect(shown()).toContain(20) // m20 is index 20 now and still at the top
    rerender(<Chat ids={ids(0, 62)} />) // a new message below doesn't yank the reader down
    expect(el.scrollTop).toBe(400)
  })
})

describe('VirtualList', () => {
  it('renders a list with set size and position on each rendered item', () => {
    render(<VirtualList aria-label="Logs" count={500} estimateSize={30} measure={false} height={120} initialRect={{ width: 300, height: 120 }} renderItem={i => `Line ${i + 1}`} />)
    const list = screen.getByRole('list', { name: 'Logs' })
    const items = screen.getAllByRole('listitem')
    expect(items.length).toBeLessThan(20)
    expect(items[0]).toHaveTextContent('Line 1')
    expect(items[0]).toHaveAttribute('aria-setsize', '500')
    expect(items[3]).toHaveAttribute('aria-posinset', '4')
    expect(list).toHaveAttribute('tabindex', '0')
  })

  it('maps listbox to option items and exposes scrollToIndex through ref', () => {
    const ref: { current: import('../../src/lib/virtual').VirtualListHandle | null } = { current: null }
    render(<VirtualList ref={ref} role="listbox" aria-label="People" count={1000} estimateSize={30} measure={false} initialRect={{ width: 300, height: 120 }} renderItem={i => `Person ${i}`} />)
    act(() => ref.current!.scrollToIndex(700, { align: 'start' }))
    expect(screen.getByRole('option', { name: 'Person 700' })).toHaveAttribute('aria-posinset', '701')
  })
})
