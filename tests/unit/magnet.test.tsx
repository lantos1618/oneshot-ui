// Magnets (0.5): the pure magnetize core (hysteresis, zones, flicks, bypass), keyboard jumps, and Slider / RangeSlider /
// SplitPane / Gantt with magnets driven through their pointer drags (jsdom has no layout, so element rects are stubbed).
import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  Gantt, MAGNET_IDLE, MagnetMarks, RangeSlider, Slider, SplitPane, magnetKeyDirection, magnetStops, magnetize, nextMagnet,
  type Magnet, type MagnetState,
} from '../../src/lib/all'

// px 200 on 0..100: 2 px per unit; capture 8 px = 4 units, release 18 px = 9 units
const R = { min: 0, max: 100, px: 200, radius: 8, release: 18 }
/** Feed raw values through magnetize like a slow drag (100 ms apart), returning each value. */
function sweep(raws: number[], magnets: Magnet[], opts: Partial<typeof R> & { step?: number } = {}) {
  let st: MagnetState = MAGNET_IDLE, t = 0
  return raws.map(r => { const res = magnetize(r, magnets, st, { ...R, ...opts, t: (t += 100) }); st = res.state; return res })
}

describe('magnetize', () => {
  it('captures inside the capture radius and holds until the release radius (hysteresis)', () => {
    const out = sweep([44, 47, 53, 56, 58.5, 59.5, 55, 54.5, 53.5], [50])
    expect(out.map(r => r.value)).toEqual([44, 50, 50, 50, 50, 59.5, 55, 54.5, 50])
    expect(out[1].captured).toBe(true)
    expect(out[5].released).toBe(true)
    // coming back, 55 (10 px) and 54.5 (9 px) stay free: capture (8 px) is shorter than release (18 px)
    expect(out[6].snapped).toBeNull()
    expect(out[8].captured).toBe(true)
  })

  it('reports the mark, its label and kind', () => {
    const [r] = sweep([48.5], [{ value: 50, label: 'Half' }])
    expect(r.snapped).toMatchObject({ value: 50, label: 'Half', kind: 'point', index: 0 })
  })

  it('strength scales capture and release', () => {
    expect(sweep([44], [{ value: 50, strength: 1.5 }])[0].value).toBe(50) // 12 px ≤ 8 × 1.5
    expect(sweep([44], [{ value: 50 }])[0].value).toBe(44)
  })

  it('switches to a nearer mark while one is held', () => {
    // 16 px apart: capture shrinks to 4.8 px and release to 8 px, so leaving one can land on the other in one move
    const out = sweep([49, 53, 56, 57], [50, 58])
    expect(out.map(r => r.value)).toEqual([50, 50, 58, 58])
    expect(out[2].captured && out[2].released).toBe(true)
  })

  it('zone pull "edges" (default) makes the boundaries sticky and leaves the inside free', () => {
    const z = { from: 40, to: 60, label: 'Recommended' }
    const out = sweep([37, 45, 50, 55, 58], [z])
    expect(out.map(r => r.value)).toEqual([40, 40, 50, 55, 60]) // 45 is 10 px from the held edge: still held
    expect(out[0].snapped).toMatchObject({ kind: 'edge', label: 'Recommended' })
    expect(out[2].zone).toBe(z)
    expect(sweep([45], [z])[0].value).toBe(45)
  })

  it('zone pull "center" snaps the middle half of the zone, the outer quarters stay free', () => {
    const z: Magnet = { from: 20, to: 80, pull: 'center' } // 120 px wide: reach 30 px = 15 units
    expect(sweep([36], [z])[0].value).toBe(50)
    expect(sweep([64], [z])[0].value).toBe(50)
    expect(sweep([30], [z])[0].value).toBe(30)
    expect(sweep([36], [z])[0].snapped?.kind).toBe('center')
  })

  it('zone pull "inside" slows the thumb in the zone without sticking (a monotonic remap)', () => {
    const z: Magnet = { from: 40, to: 60, pull: 'inside' }
    const one = (r: number) => magnetize(r, [z], MAGNET_IDLE, R).value
    expect(one(30)).toBe(30) // outside the margin: untouched
    expect(one(70)).toBe(70)
    expect(one(35)).toBeCloseTo(40) // drawn in: the zone starts 5 units early
    expect(one(50)).toBeCloseTo(50) // the middle stays put
    expect(one(45)).toBeCloseTo(46.667, 2) // two-thirds speed inside
    expect(magnetize(50, [z], MAGNET_IDLE, R).snapped).toBeNull()
    const xs = Array.from({ length: 401 }, (_, i) => 20 + i / 10).map(one)
    xs.forEach((x, i) => { if (i) expect(x).toBeGreaterThanOrEqual(xs[i - 1]) })
  })

  it('flicks pass through marks, and a fast move releases a held one', () => {
    let st = MAGNET_IDLE
    const step = (raw: number, t: number) => { const r = magnetize(raw, [50], st, { ...R, t }); st = r.state; return r }
    step(30, 0)
    expect(step(49, 4).value).toBe(49) // 19 units in 4 ms ≈ 9.5 px/ms
    expect(step(49.5, 200).value).toBe(50) // slowed down: captured
    // speeding up to 3 px/ms lets go within a few ms, while the pointer is still inside the 18 px release radius
    const out = Array.from({ length: 8 }, (_, i) => step(49.5 + 1.5 * (i + 1), 201 + i))
    const free = out.findIndex(r => r.snapped === null)
    expect(free).toBeGreaterThan(0)
    expect(Math.abs(out[free].value - 50) * 2).toBeLessThan(18)
    expect(out[free].released).toBe(true)
    // one quick event after a calm stretch (13 px in 4 ms) is not a flick yet
    let calm = magnetize(40, [50], MAGNET_IDLE, { ...R, t: 0 })
    calm = magnetize(40.5, [50], calm.state, { ...R, t: 100 })
    expect(magnetize(47, [50], calm.state, { ...R, t: 104 }).value).toBe(50)
  })

  it('bypass moves freely and lets go of a held mark', () => {
    const held = magnetize(49, [50], MAGNET_IDLE, R)
    expect(held.value).toBe(50)
    const free = magnetize(49, [50], held.state, { ...R, bypass: true })
    expect(free).toMatchObject({ value: 49, snapped: null, released: true })
  })

  it('crowded marks keep the values between them reachable', () => {
    expect(sweep([51], [50, 52])[0].value).toBe(51) // 4 px apart: capture shrinks to 1.2 px
    expect(sweep([50.4], [50, 52])[0].value).toBe(50)
  })

  it('puts marks and free values on the step grid', () => {
    expect(sweep([32], [100 / 3], { step: 1 })[0].value).toBe(33)
    expect(sweep([20.4], [100 / 3], { step: 1 })[0].value).toBe(20)
  })
})

describe('keyboard jumps', () => {
  const marks: Magnet[] = [0, 25, { value: 100, label: 'Max' }, { from: 40, to: 60 }, { from: 70, to: 90, pull: 'center' }]
  it('lists every stop (points, zone edges, centres)', () => {
    expect(magnetStops(marks, { min: 0, max: 100 })).toEqual([0, 25, 40, 60, 70, 80, 90, 100])
  })
  it('finds the next and previous mark', () => {
    expect(nextMagnet(30, marks, 1, { min: 0, max: 100 })).toBe(40)
    expect(nextMagnet(40, marks, 1, { min: 0, max: 100 })).toBe(60)
    expect(nextMagnet(40, marks, -1, { min: 0, max: 100 })).toBe(25)
    expect(nextMagnet(100, marks, 1, { min: 0, max: 100 })).toBeNull()
  })
  it('PageUp / PageDown and Ctrl or ⌘ + arrows; plain arrows are not jumps', () => {
    expect(magnetKeyDirection({ key: 'PageUp' })).toBe(1)
    expect(magnetKeyDirection({ key: 'PageDown' })).toBe(-1)
    expect(magnetKeyDirection({ key: 'ArrowRight' })).toBe(0)
    expect(magnetKeyDirection({ key: 'ArrowRight', ctrlKey: true })).toBe(1)
    expect(magnetKeyDirection({ key: 'ArrowDown', metaKey: true })).toBe(-1)
    expect(magnetKeyDirection({ key: 'ArrowRight', ctrlKey: true, altKey: true })).toBe(0)
  })
})

/** Every element is `width` px wide from x = 0 (jsdom has no layout). */
const stubRect = (width: number, height = 20) => vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue(
  { x: 0, y: 0, left: 0, top: 0, right: width, bottom: height, width, height, toJSON: () => ({}) } as DOMRect)
afterEach(() => vi.restoreAllMocks())

// Slider: the input is 216 px wide and the thumb's centre stops 8 px short of each end, so x = 8 + 2 × value on 0..100
const sx = (v: number) => 8 + 2 * v
const pointer = (x: number, extra: Record<string, unknown> = {}) => ({ clientX: x, clientY: 10, pointerId: 1, pointerType: 'mouse', button: 0, buttons: 1, ...extra })
// event timestamps are injected, not read from a clock: every fired event is 100 ms after the last, so test drags are
// always slow (never a flick), however loaded the machine is. Timers are fake for the debounced announcement.
let clock = 0
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
  clock = 0
  vi.spyOn(Event.prototype, 'timeStamp', 'get').mockImplementation(() => clock)
})
const fire = { ...fireEvent } as typeof fireEvent
for (const k of ['pointerDown', 'pointerMove', 'pointerUp', 'keyDown'] as const) {
  fire[k] = ((el: Element | Window, init?: object) => { clock += 100; return fireEvent[k](el, init) }) as never
}

describe('Slider with magnets', () => {
  const MARKS: Magnet[] = [0, 25, { value: 50, label: 'Half' }, 75, 100]

  it('snaps on pointer moves, holds a little, then follows; onChange and FormData see plain numbers', async () => {
    stubRect(216)
    const onChange = vi.fn(), onSnap = vi.fn()
    render(<form data-testid="f"><Slider label="Volume" name="vol" defaultValue={10} magnets={MARKS} onChange={onChange} onSnap={onSnap} /></form>)
    const input = screen.getByRole('slider', { name: 'Volume' }) as HTMLInputElement
    expect(fire.pointerDown(input, pointer(sx(46.5)))).toBe(false) // the native drag is stopped
    expect(onChange).toHaveBeenLastCalledWith(50)
    expect(input).toHaveAttribute('aria-valuetext', '50, Half')
    expect(onSnap).toHaveBeenLastCalledWith(expect.objectContaining({ value: 50, label: 'Half' }), 50)
    fire.pointerMove(window, pointer(sx(54))) // 8 px away: still held
    expect(input.value).toBe('50')
    fire.pointerMove(window, pointer(sx(61))) // 22 px: let go
    expect(input.value).toBe('61')
    expect(onChange).toHaveBeenLastCalledWith(61)
    fire.pointerUp(window, pointer(sx(61), { buttons: 0 }))
    expect(new FormData(screen.getByTestId('f') as HTMLFormElement).get('vol')).toBe('61')
    // the polite announcement, debounced
    act(() => { vi.advanceTimersByTime(400) })
    expect(screen.getByText('Snapped to Half')).toBeInTheDocument()
  })

  it('a flick passes through marks (timestamps injected: 2 ms between moves)', () => {
    stubRect(216)
    render(<Slider label="Volume" defaultValue={10} magnets={MARKS} />)
    const input = screen.getByRole('slider', { name: 'Volume' }) as HTMLInputElement
    fire.pointerDown(input, pointer(sx(30)))
    clock += 2; fireEvent.pointerMove(window, pointer(sx(40))) // 20 px in 2 ms
    clock += 2; fireEvent.pointerMove(window, pointer(sx(49)))
    expect(input.value).toBe('49')
    fire.pointerMove(window, pointer(sx(49.5))) // 100 ms later: slow again, captured
    expect(input.value).toBe('50')
  })

  it('Alt bypasses the magnets', () => {
    stubRect(216)
    render(<Slider label="Volume" defaultValue={10} magnets={MARKS} />)
    const input = screen.getByRole('slider', { name: 'Volume' }) as HTMLInputElement
    fire.pointerDown(input, pointer(sx(48), { altKey: true }))
    expect(input.value).toBe('48')
    fire.pointerMove(window, pointer(sx(49), { altKey: true }))
    expect(input.value).toBe('49')
    fire.pointerMove(window, pointer(sx(49)))
    expect(input.value).toBe('50')
  })

  it('PageUp / PageDown and Ctrl + arrows jump between marks; arrows are left to the native input', () => {
    const onChange = vi.fn()
    render(<Slider label="Volume" defaultValue={30} magnets={MARKS} onChange={onChange} />)
    const input = screen.getByRole('slider', { name: 'Volume' })
    expect(input).toHaveAttribute('aria-keyshortcuts', 'PageUp PageDown')
    fire.keyDown(input, { key: 'PageUp' })
    expect(onChange).toHaveBeenLastCalledWith(50)
    fire.keyDown(input, { key: 'ArrowRight', ctrlKey: true })
    expect(onChange).toHaveBeenLastCalledWith(75)
    fire.keyDown(input, { key: 'PageDown' })
    expect(onChange).toHaveBeenLastCalledWith(50)
    onChange.mockClear()
    expect(fire.keyDown(input, { key: 'ArrowRight' })).toBe(true) // not prevented: the native step
    expect(onChange).not.toHaveBeenCalled()
  })

  it('draws ticks and bands only with magnets, and leaves a plain Slider alone', () => {
    const onChange = vi.fn()
    const { container, rerender } = render(<Slider label="Volume" defaultValue={30} onChange={onChange} />)
    const input = screen.getByRole('slider', { name: 'Volume' })
    expect(container.querySelector('[data-magnet-tick]')).toBeNull()
    expect(container.querySelector('[aria-live]')).toBeNull()
    expect(input).not.toHaveAttribute('aria-keyshortcuts')
    expect(fire.pointerDown(input, pointer(50))).toBe(true) // the native drag is untouched
    expect(fire.keyDown(input, { key: 'PageUp' })).toBe(true) // and so is the native PageUp
    expect(onChange).not.toHaveBeenCalled()
    rerender(<Slider label="Volume" defaultValue={30} magnets={[...MARKS, { from: 40, to: 60 }]} />)
    expect(container.querySelectorAll('[data-magnet-tick]')).toHaveLength(5)
    expect(container.querySelectorAll('[data-magnet-zone]')).toHaveLength(1)
  })

})

describe('RangeSlider with magnets', () => {
  // the track is 216 px for 0..1000: 0.216 px per unit, so 8 px ≈ 37 units
  const rx = (v: number) => v * 0.216
  it('snaps a dragged thumb to marks and to the other thumb (minGap), and serialises as usual', () => {
    stubRect(216)
    const onChange = vi.fn()
    render(<form data-testid="f"><RangeSlider label="Price" name="price" defaultValue={[200, 750]} min={0} max={1000} step={10} minGap={50} magnets={[500]} onChange={onChange} /></form>)
    const hi = screen.getByRole('slider', { name: 'Maximum price' })
    fire.pointerDown(hi, pointer(rx(750)))
    fire.pointerMove(window, pointer(rx(520)))
    expect(onChange).toHaveBeenLastCalledWith([200, 500])
    expect(hi).toHaveAttribute('aria-valuetext', '500')
    fire.pointerMove(window, pointer(rx(400))) // 100 units = 21.6 px from 500: let go
    expect(onChange).toHaveBeenLastCalledWith([200, 400])
    fire.pointerMove(window, pointer(rx(270))) // within reach of 200 + minGap
    expect(onChange).toHaveBeenLastCalledWith([200, 250])
    fire.pointerUp(window, pointer(rx(270), { buttons: 0 }))
    expect(new FormData(screen.getByTestId('f') as HTMLFormElement).getAll('price')).toEqual(['200', '250'])
  })

  it('PageUp jumps to the next mark, then falls back to a 10% step past the last one', () => {
    const onChange = vi.fn()
    render(<RangeSlider label="Price" defaultValue={[200, 750]} min={0} max={1000} step={10} magnets={[250, 500]} onChange={onChange} />)
    const lo = screen.getByRole('slider', { name: 'Minimum price' })
    fire.keyDown(lo, { key: 'PageUp' })
    expect(onChange).toHaveBeenLastCalledWith([250, 750])
    fire.keyDown(lo, { key: 'PageUp' })
    expect(onChange).toHaveBeenLastCalledWith([500, 750])
    fire.keyDown(lo, { key: 'PageUp' })
    expect(onChange).toHaveBeenLastCalledWith([600, 750])
  })

  it('without magnets nothing changes (no marks, the old PageUp step)', () => {
    const onChange = vi.fn()
    const { container } = render(<RangeSlider label="Price" defaultValue={[200, 750]} min={0} max={1000} step={10} onChange={onChange} />)
    expect(container.querySelector('[data-magnet-tick]')).toBeNull()
    fire.keyDown(screen.getByRole('slider', { name: 'Minimum price' }), { key: 'PageUp' })
    expect(onChange).toHaveBeenLastCalledWith([300, 750])
  })
})

describe('MagnetMarks', () => {
  it('positions ticks logically and highlights the one the value is on', () => {
    const marks = (value?: number) => <div><MagnetMarks magnets={[25, 50, 75]} min={0} max={100} value={value} inset={8} /></div>
    const { container, rerender } = render(marks(50))
    const ticks = () => [...container.querySelectorAll<HTMLElement>('[data-magnet-tick]')]
    expect(ticks()).toHaveLength(3)
    for (const t of ticks()) expect(t.style.left).toBe('') // inline-start, so RTL mirrors it
    expect(ticks()[0].style.insetInlineStart).toContain('25%')
    expect(ticks()[2].style.insetInlineStart).toContain('75%')
    // the tick the value is on looks different from the others; which one follows the value, and none without one
    const looks = () => ticks().map(t => t.className)
    const [a, on, c] = looks()
    expect(a).toBe(c)
    expect(on).not.toBe(a)
    rerender(marks(75))
    expect(looks()).toEqual([a, a, on])
    rerender(marks(60))
    expect(looks()).toEqual([a, a, a])
  })
})

describe('SplitPane with magnets', () => {
  it('snaps the divider to half while dragging and jumps with PageUp', () => {
    stubRect(1000, 400)
    render(<SplitPane first="A" second="B" defaultSize={30} magnets label="Resize" />)
    const sep = screen.getByRole('separator', { name: 'Resize' })
    fire.pointerDown(sep, pointer(300))
    fire.pointerMove(window, pointer(495))
    expect(sep).toHaveAttribute('aria-valuenow', '50')
    expect(sep).toHaveAttribute('aria-valuetext', '50%, Half')
    fire.pointerUp(window, pointer(495, { buttons: 0 }))
    fire.keyDown(sep, { key: 'PageUp' })
    expect(sep).toHaveAttribute('aria-valuenow', '67')
  })
})

describe('Gantt with magnets', () => {
  const phases = [{ id: 'p', name: 'Build', tasks: [
    { id: 'a', name: 'Design', start: 0, duration: 5, progress: 1, owner: 'AL' },
    { id: 'b', name: 'Build', start: 10, duration: 4, progress: 0, owner: 'BO' },
  ] }]
  // 42 days on a 420 px lane: 10 px a day; dragging B 44 px left puts its start at 5.6 days
  const drag = () => {
    const bar = screen.getByRole('slider', { name: /^Build,/ })
    fire.pointerDown(bar, pointer(500))
    fire.pointerMove(window, pointer(456))
    fire.pointerUp(window, pointer(456, { buttons: 0 }))
    return bar
  }
  it('without magnets a drag rounds to the nearest day', () => {
    stubRect(420)
    render(<Gantt phases={phases} dependencies={[]} start={new Date(2026, 10, 2)} />)
    expect(drag()).toHaveAttribute('aria-valuenow', '6')
  })
  it('with magnets a task start sticks to the end of another task', () => {
    stubRect(420)
    render(<Gantt phases={phases} dependencies={[]} start={new Date(2026, 10, 2)} magnets />)
    expect(drag()).toHaveAttribute('aria-valuenow', '5')
  })
})
