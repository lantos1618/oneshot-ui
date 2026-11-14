// Timelines (0.5): Swimlanes, StateRibbon, TagJournal / ChartWithJournal and the trace waterfall's flags. Layout maths
// (merging dense dots, ribbon slivers), lane grouping and order, the empty-lane hint, linking hover and focus between
// a chart and its journal, the keyboard model, and flags that never move the trace's rows. Queried by role and name.
import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fakeScroller } from '../helpers'
import { ChartWithJournal, StateRibbon, Swimlanes, TagJournal, TraceWaterfall, clusterTimeMarks, ribbonSegments, type TimeTag, type TimeTagKind, type TraceSpan } from '../../src/lib/all'

const at = (h: number, m = 0) => new Date(2026, 10, 9, h, m).getTime()
const START = at(9), END = at(17, 30)
const KINDS: TimeTagKind[] = [
  { kind: 'water', label: 'Water', icon: '💧', color: 'var(--c2)' },
  { kind: 'snack', label: 'Snack', icon: '🍎', color: 'var(--c3)' },
  { kind: 'coffee', label: 'Coffee', icon: '☕' },
]
const TAGS: TimeTag[] = [
  { id: 'w1', at: at(9, 40), kind: 'water', label: 'Water' },
  { id: 's1', at: at(10, 50), kind: 'snack', label: 'Snack' },
  { id: 'w2', at: at(11, 5), kind: 'water', label: 'Water' },
  { id: 'l1', at: at(12, 30), end: at(13, 5), kind: 'lunch', label: 'Lunch' },
  { id: 'w3', at: at(14, 20), kind: 'water', label: 'Water' },
]

/** jsdom has no layout: give measured boxes a width so merging and pin layout run. */
let width = 0
beforeEach(() => {
  width = 0
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(() => width)
})
afterEach(() => vi.restoreAllMocks())

describe('layout maths', () => {
  it('clusterTimeMarks merges dots closer than the gap and keeps the rest', () => {
    const tags: TimeTag[] = [at(9, 0), at(9, 1), at(9, 2), at(12, 0), at(17, 0)].map((t, i) => ({ id: `t${i}`, at: t, kind: 'water', label: 'Water' }))
    // 8.5 h over 510 px = 1 px per minute: three dots a minute apart merge, the others stay single
    const marks = clusterTimeMarks(tags, { start: START, end: END, width: 510, size: 10, gap: 6 })
    expect(marks.map(m => m.tags.length)).toEqual([3, 1, 1])
    expect(marks[0]).toMatchObject({ from: at(9, 0), to: at(9, 2) })
    // a wide plot keeps them apart
    expect(clusterTimeMarks(tags, { start: START, end: END, width: 51000, size: 10, gap: 6 })).toHaveLength(5)
  })
  it('clusterTimeMarks lets a growing chip swallow its neighbour', () => {
    const tags: TimeTag[] = [0, 4, 8, 12, 16].map((m, i) => ({ id: `t${i}`, at: at(9, m), kind: 'water', label: 'Water' }))
    expect(clusterTimeMarks(tags, { start: START, end: END, width: 510, size: 4, gap: 1 })).toHaveLength(1)
  })
  it('ribbonSegments gives slivers a minimum width and merges runs of them', () => {
    const states: TimeTag[] = [
      { id: 'a', at: at(9), end: at(12), kind: 'good', label: 'Good' },
      { id: 'b', at: at(12), end: at(12, 1), kind: 'bad', label: 'Slouch' }, // a lone sliver
      { id: 'c', at: at(12, 1), end: at(14), kind: 'good', label: 'Good' },
      { id: 'd', at: at(14), end: at(14, 1), kind: 'bad', label: 'Slouch' }, // a run of three slivers
      { id: 'e', at: at(14, 1), end: at(14, 2), kind: 'move', label: 'Move' },
      { id: 'f', at: at(14, 2), end: at(14, 3), kind: 'bad', label: 'Slouch' },
      { id: 'g', at: at(14, 3), kind: 'good', label: 'Good' }, // open: lasts until the end
    ]
    const segs = ribbonSegments(states, { start: START, end: END, width: 510, minPx: 4 })
    expect(segs.map(s => s.tags.map(t => t.id).join('+'))).toEqual(['a', 'b', 'c', 'd+e+f', 'g'])
    expect(segs[1]).toMatchObject({ mixed: false, w: 4 })
    expect(segs[3]).toMatchObject({ mixed: true, from: at(14), to: at(14, 3) })
    expect(segs[3].w).toBeGreaterThanOrEqual(4)
    expect(segs[4].to).toBe(END)
    // unmeasured (SSR): no merging
    expect(ribbonSegments(states, { start: START, end: END, width: 0 })).toHaveLength(7)
  })
})

describe('Swimlanes', () => {
  const lanes = () => within(screen.getByRole('group', { name: 'Tags by kind' })).getAllByRole('group').map(g => g.getAttribute('aria-label'))
  it('groups tags into one lane per kind, in kinds order, with kinds only seen on tags appended', () => {
    render(<Swimlanes tags={TAGS} kinds={KINDS} start={START} end={END} />)
    expect(lanes()).toEqual(['Water: 3 tags', 'Snack: 1 tag', 'Coffee: no tags', 'Lunch: 1 tag'])
    expect(screen.getByRole('button', { name: 'Lunch, 12:30 to 13:05, 35 min' })).toBeInTheDocument()
  })
  it("orders lanes by count with order='count'", () => {
    render(<Swimlanes tags={TAGS} kinds={KINDS} start={START} end={END} order="count" />)
    expect(lanes()).toEqual(['Water: 3 tags', 'Snack: 1 tag', 'Lunch: 1 tag', 'Coffee: no tags'])
  })
  it('says "None" in an empty lane, or drops it with hideEmpty', () => {
    const { rerender } = render(<Swimlanes tags={TAGS} kinds={KINDS} start={START} end={END} />)
    expect(within(screen.getByRole('group', { name: 'Coffee: no tags' })).getByText('None')).toBeInTheDocument()
    rerender(<Swimlanes tags={TAGS} kinds={KINDS} start={START} end={END} hideEmpty />)
    expect(screen.queryByRole('group', { name: 'Coffee: no tags' })).toBeNull()
  })
  it('merges dense dots of one kind into a count chip once the plot is measured', () => {
    width = 510
    const dense: TimeTag[] = [0, 1, 2].map(m => ({ id: `d${m}`, at: at(15, m), kind: 'water', label: 'Water' }))
    render(<Swimlanes tags={[...TAGS, ...dense]} kinds={KINDS} start={START} end={END} />)
    const chip = screen.getByRole('button', { name: '3 tags: Water, 15:00 to 15:02' })
    expect(chip).toHaveTextContent('3')
    expect(screen.getByRole('button', { name: 'Water, 9:40' })).toBeInTheDocument()
  })
  it('keyboard: one Tab stop, ←/→ along a lane, ↑/↓ between lanes, Enter selects, Escape clears', () => {
    const onActive = vi.fn(), onSelect = vi.fn()
    render(<><button>before</button><Swimlanes tags={TAGS} kinds={KINDS} start={START} end={END} onActiveChange={onActive} onSelect={onSelect} /></>)
    const marks = within(screen.getByRole('group', { name: 'Tags by kind' })).getAllByRole('button')
    expect(marks.filter(b => b.tabIndex === 0)).toHaveLength(1)
    const first = screen.getByRole('button', { name: 'Water, 9:40' })
    expect(first.tabIndex).toBe(0)
    act(() => first.focus())
    fireEvent.keyDown(first, { key: 'ArrowRight' })
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Water, 11:05' }))
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowDown' }) // nearest mark in the next lane with any
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Snack, 10:50' }))
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowDown' }) // skips the empty Coffee lane
    expect(document.activeElement).toHaveAccessibleName('Lunch, 12:30 to 13:05, 35 min')
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowUp' })
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowUp' })
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Water, 11:05' }))
    fireEvent.keyDown(document.activeElement!, { key: 'End' })
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Water, 14:20' }))
    fireEvent.click(document.activeElement!)
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ id: 'w3' }))
    expect(onActive).toHaveBeenLastCalledWith('w3')
    fireEvent.keyDown(document.activeElement!, { key: 'Escape' })
    expect(onActive).toHaveBeenLastCalledWith(null)
  })
  it('hover lights a mark (activeId), and a linked activeId lights it from outside', () => {
    const onActive = vi.fn()
    const { rerender } = render(<Swimlanes tags={TAGS} kinds={KINDS} start={START} end={END} activeId={null} onActiveChange={onActive} />)
    fireEvent.pointerEnter(screen.getByRole('button', { name: 'Snack, 10:50' }), { pointerType: 'mouse' })
    expect(onActive).toHaveBeenLastCalledWith('s1')
    rerender(<Swimlanes tags={TAGS} kinds={KINDS} start={START} end={END} activeId="w2" onActiveChange={onActive} />)
    expect(screen.getByRole('button', { name: 'Water, 11:05' })).toHaveAttribute('data-active', 'true')
    expect(screen.getByRole('button', { name: 'Water, 11:05' }).tabIndex).toBe(0)
  })
  it('caps the height at maxLanes lanes; the lanes past the cap are still there and reachable by keyboard', () => {
    const many: TimeTagKind[] = Array.from({ length: 12 }, (_, i) => ({ kind: `k${i}`, label: `Kind ${i}` }))
    const tags: TimeTag[] = [{ id: 'a', at: at(9, 40), kind: 'k0', label: 'First' }, { id: 'z', at: at(10), kind: 'k11', label: 'Last' }]
    const { rerender } = render(<Swimlanes tags={tags} kinds={many} start={START} end={END} maxLanes={5} />)
    const lanes = within(screen.getByRole('group', { name: 'Tags by kind' })).getAllByRole('group')
    expect(lanes.map(l => l.getAttribute('aria-label'))).toEqual(many.map((k, i) => `${k.label}: ${i === 0 || i === 11 ? '1 tag' : 'no tags'}`))
    const capped = lanes[0].closest<HTMLElement>('[style*="max-height"]')!
    expect(capped.style.maxHeight).toBe(`${5 * 26 + 4}px`) // five lanes of 26 px
    expect(capped).toContainElement(lanes[11])
    const first = screen.getByRole('button', { name: 'First, 9:40' })
    act(() => first.focus())
    fireEvent.keyDown(first, { key: 'ArrowDown' }) // past the empty lanes, below the cap
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Last, 10:00' }))
    rerender(<Swimlanes tags={tags} kinds={many} start={START} end={END} maxLanes={12} />)
    expect(document.querySelector('[style*="max-height"]')).toBeNull() // all fit: no cap
  })
})

describe('StateRibbon', () => {
  const states: TimeTag[] = [
    { id: 'g1', at: at(9), end: at(11), kind: 'good', label: 'Good posture' },
    { id: 'b1', at: at(11), end: at(11, 1), kind: 'bad', label: 'Slouching' },
    { id: 'm1', at: at(11, 1), end: at(11, 2), kind: 'move', label: 'Moving' },
    { id: 'g2', at: at(11, 2), end: END, kind: 'good', label: 'Good posture' },
  ]
  const kinds: TimeTagKind[] = [{ kind: 'good', label: 'Good posture', color: 'var(--ok)' }, { kind: 'bad', label: 'Slouching', color: 'var(--bad)' }, { kind: 'move', label: 'Moving', color: 'var(--warn)' }]
  it('merges a run of slivers into one mixed segment and totals each state in the legend', () => {
    width = 510
    render(<StateRibbon states={states} kinds={kinds} start={START} end={END} />)
    expect(screen.getByRole('button', { name: 'Several short states: 2 tags, 11:00 to 11:02' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Good posture, 9:00 to 11:00, 2 h' })).toBeInTheDocument()
    const legend = screen.getByRole('list', { name: 'Legend' })
    expect(within(legend).getAllByRole('listitem').map(li => li.textContent)).toEqual(['Good posture8 h 28 min', 'Slouching1 min', 'Moving1 min'])
  })
  it('folds crowded pins into "+N" and moves between rows with ↑/↓', () => {
    width = 300
    const pins: TimeTag[] = [0, 1, 2, 3].map(m => ({ id: `p${m}`, at: at(10, m), kind: 'water', label: 'Water' }))
    const bars: TimeTag[] = [{ id: 'lunch', at: at(12, 30), end: at(13, 5), kind: 'lunch', label: 'Lunch' }]
    render(<StateRibbon states={states} pins={pins} bars={bars} kinds={kinds} start={START} end={END} size="compact" />)
    const pin = screen.getByRole('button', { name: '4 tags: Water, 10:00 to 10:03' })
    act(() => pin.focus())
    fireEvent.keyDown(pin, { key: 'ArrowDown' })
    expect(document.activeElement).toHaveAccessibleName('Good posture, 9:00 to 11:00, 2 h')
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowDown' })
    expect(document.activeElement).toHaveAccessibleName('Lunch, 12:30 to 13:05, 35 min')
  })
})

describe('TagJournal and ChartWithJournal', () => {
  it('lists tags in time order with labelled edit and delete buttons, grouped by hour on request', () => {
    const onEdit = vi.fn(), onDelete = vi.fn()
    render(<TagJournal tags={[...TAGS].reverse()} kinds={KINDS} onEdit={onEdit} onDelete={onDelete} groupBy="hour" />)
    const list = screen.getByRole('list', { name: 'Journal' })
    // a row's name is its own text: time, label (and duration)
    const rows = within(list).getAllByRole('button').filter(b => b.dataset.row)
    const names = [/^9:40\s*Water$/, /^10:50\s*Snack$/, /^11:05\s*Water$/, /^12:30\s*Lunch\s*35 min$/, /^14:20\s*Water$/]
    expect(rows).toHaveLength(names.length)
    rows.forEach((r, i) => expect(r).toHaveAccessibleName(names[i]))
    expect(within(list).getByText('9:00')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Delete Snack, 10:50' }))
    expect(onDelete).toHaveBeenCalledWith(expect.objectContaining({ id: 's1' }))
    fireEvent.click(screen.getByRole('button', { name: 'Edit Water, 14:20' }))
    expect(onEdit).toHaveBeenCalledWith(expect.objectContaining({ id: 'w3' }))
  })
  it('links both ways: hovering the list lights the chart, the chart lights and scrolls the list without moving focus', () => {
    const Fake = ({ link }: { link: { activeId: string | null; onActiveChange: (id: string | null) => void } }) => (
      <div>
        <output aria-label="chart active">{link.activeId ?? 'none'}</output>
        <button onClick={() => link.onActiveChange('w3')}>chart tag w3</button>
      </div>
    )
    // the list is 60 px tall (jsdom has no layout), so the last rows are below its fold
    vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockImplementation(function (this: HTMLElement) { return this.getAttribute('aria-label') === 'Journal' ? 60 : 0 })
    render(<ChartWithJournal tags={TAGS} kinds={KINDS} chart={link => <Fake link={link} />} />)
    const list = screen.getByRole('list', { name: 'Journal' })
    const box = fakeScroller(list, { height: 60, content: () => parseFloat((list.firstElementChild as HTMLElement).style.height) })
    // list → chart: hovering a row lights the chart, and the list does not scroll itself
    const row = (name: RegExp) => screen.getByRole('button', { name })
    fireEvent.pointerEnter(row(/^10:50\s*Snack/).parentElement!, { pointerType: 'mouse' })
    expect(screen.getByRole('status', { name: 'chart active' })).toHaveTextContent('s1')
    expect(row(/^10:50\s*Snack/)).toHaveAttribute('aria-current', 'true')
    expect(box.top).toBe(0)
    // chart → list: the row lights and is scrolled into view, focus stays on the chart
    const chartTag = screen.getByRole('button', { name: 'chart tag w3' })
    act(() => chartTag.focus())
    fireEvent.click(chartTag)
    expect(row(/^14:20\s*Water/)).toHaveAttribute('aria-current', 'true')
    expect(document.activeElement).toBe(chartTag)
    expect(row(/^14:20\s*Water/).tabIndex).toBe(0)
    const item = row(/^14:20\s*Water/).closest<HTMLElement>('[data-index]')!
    const start = Number(/translateY\(([\d.]+)px\)/.exec(item.style.transform)![1])
    expect(start).toBeGreaterThan(60) // it was below the fold
    expect(box.top).toBeGreaterThan(0)
    expect(box.top).toBeLessThanOrEqual(start)
    expect(start).toBeLessThan(box.top + 60)
  })
  it('ignores rows sliding under a resting cursor after the list scrolls itself, until the pointer moves', () => {
    const onActive = vi.fn()
    const { rerender } = render(<TagJournal tags={TAGS} kinds={KINDS} activeId={null} onActiveChange={onActive} />)
    const rowOf = (name: RegExp) => screen.getByRole('button', { name }).parentElement!
    const list = screen.getByRole('list', { name: 'Journal' })
    fireEvent.pointerMove(list, { pointerType: 'mouse', clientX: 50, clientY: 40 })
    // a linked chart lights the last tag: the list scrolls to it on its own
    rerender(<TagJournal tags={TAGS} kinds={KINDS} activeId="w3" onActiveChange={onActive} />)
    fireEvent.pointerEnter(rowOf(/^10:50\s*Snack/), { pointerType: 'mouse', clientX: 50, clientY: 40 })
    fireEvent.pointerMove(list, { pointerType: 'mouse', clientX: 50, clientY: 40 }) // the browser's synthetic move, same spot
    fireEvent.pointerEnter(rowOf(/^11:05\s*Water/), { pointerType: 'mouse', clientX: 50, clientY: 40 })
    expect(onActive).not.toHaveBeenCalled()
    // a real move: hover counts again (a crossing's pointerenter comes at new coordinates, before its pointermove)
    fireEvent.pointerMove(list, { pointerType: 'mouse', clientX: 52, clientY: 58 })
    fireEvent.pointerEnter(rowOf(/^10:50\s*Snack/), { pointerType: 'mouse', clientX: 52, clientY: 60 })
    expect(onActive).toHaveBeenLastCalledWith('s1')
  })
  it('Swimlanes: arrow keys that move focus ignore marks entering under a resting cursor', () => {
    const onActive = vi.fn()
    render(<Swimlanes tags={TAGS} kinds={KINDS} start={START} end={END} onActiveChange={onActive} />)
    const first = screen.getByRole('button', { name: 'Water, 9:40' })
    act(() => first.focus())
    fireEvent.keyDown(first, { key: 'End' })
    onActive.mockClear()
    fireEvent.pointerEnter(screen.getByRole('button', { name: 'Snack, 10:50' }), { pointerType: 'mouse' })
    expect(onActive).not.toHaveBeenCalled()
  })
  it('keyboard: the list is one Tab stop and ↑/↓ move between rows', async () => {
    const onActive = vi.fn()
    render(<TagJournal tags={TAGS} kinds={KINDS} onActiveChange={onActive} />)
    const rows = screen.getAllByRole('button').filter(b => b.dataset.row)
    expect(rows.filter(r => r.tabIndex === 0)).toHaveLength(1)
    act(() => rows[0].focus())
    fireEvent.keyDown(rows[0], { key: 'ArrowDown' })
    expect(onActive).toHaveBeenLastCalledWith('s1')
    await act(() => new Promise(r => requestAnimationFrame(() => r(null))))
    expect(document.activeElement).toHaveAccessibleName(/^10:50\s*Snack$/)
    fireEvent.keyDown(document.activeElement!, { key: 'End' })
    expect(onActive).toHaveBeenLastCalledWith('w3')
  })
  it('shows an empty state', () => {
    render(<TagJournal tags={[]} />)
    expect(screen.getByText('Nothing logged yet')).toBeInTheDocument()
  })
})

describe('TraceWaterfall flags', () => {
  const spans: TraceSpan[] = [
    { id: 'root', name: 'Run', kind: 'agent', start: 0, duration: 10 },
    { id: 'a', parent: 'root', name: 'Plan', kind: 'llm', start: 0, duration: 4 },
    { id: 'b', parent: 'root', name: 'Search', kind: 'tool', start: 4, duration: 5 },
  ]
  const events = (n: number): TimeTag[] => Array.from({ length: n }, (_, i) => ({ id: `e${i}`, at: 500 + i * 700, kind: 'deploy', label: `Deploy ${i + 1}` }))
  it('reserves the flag row, so switching from a few events to many never moves the rows', () => {
    const { rerender } = render(<TraceWaterfall spans={spans} total={10} />)
    expect(screen.queryByRole('listbox', { name: 'Events' })).toBeNull() // no annotations prop: no row
    rerender(<TraceWaterfall spans={spans} total={10} annotations={[]} />)
    // with the prop set, the row is there before any event is
    const box = screen.getByRole('listbox', { name: 'Events' })
    const flagRow = box.parentElement!
    // the rows of the plot in order (flag row, then the span rows; the decorative grid and rules aside): the same
    // elements, nothing added above the spans
    const rows = () => [...flagRow.parentElement!.children].filter(r => !r.hasAttribute('aria-hidden'))
    const before = rows(), names = ['Run', 'Plan', 'Search'].map(n => screen.getByText(n))
    expect(before.indexOf(flagRow)).toBeLessThan(before.findIndex(r => r.contains(names[0])))
    rerender(<TraceWaterfall spans={spans} total={10} annotations={events(12)} />)
    expect(screen.getByRole('listbox', { name: 'Events' })).toBe(box)
    expect(rows()).toEqual(before)
    rows().forEach((r, i) => expect(r).toBe(before[i]))
    for (const [i, n] of ['Run', 'Plan', 'Search'].entries()) expect(screen.getByText(n)).toBe(names[i])
    expect(within(box).getAllByRole('option', { hidden: true })).toHaveLength(12) // the flags live inside the reserved row
  })
  it('flags drop out when crowded, and the row is one Tab stop with ←/→', () => {
    width = 400
    render(<TraceWaterfall spans={spans} total={10} annotations={events(12)} />)
    const box = screen.getByRole('listbox', { name: 'Events' })
    const shown = within(box).getAllByRole('option').filter(o => o.textContent)
    expect(shown.length).toBeGreaterThan(0)
    expect(shown.length).toBeLessThan(12)
    act(() => box.focus())
    fireEvent.keyDown(box, { key: 'Home' })
    fireEvent.keyDown(box, { key: 'ArrowRight' })
    expect(box.getAttribute('aria-activedescendant')).toBe(within(box).getByRole('option', { name: /Deploy 2/ }).id)
  })
})

