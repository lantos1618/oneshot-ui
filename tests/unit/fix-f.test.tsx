// Package F (diagrams and geo): props that change after mount, bad dependency graphs and machines, weekend shading on
// any weekday, honest run badges and latencies, scoped theme changes, and lazy map data that fails to load.
import { act, fireEvent, render, renderHook, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Gantt, type GanttPhase } from '../../src/lib/gantt'
import { DataFlow, NetworkGraph, ProcessFlow, type FlowNode } from '../../src/lib/network'
import { Globe, WorldMap } from '../../src/lib/geo'
import { StateMachine, WorkflowEngine, type WorkflowEvent, type WorkflowMachine } from '../../src/lib/statechart'
import { TraceWaterfall, type TraceRun } from '../../src/lib/trace'
import { useDgDots } from '../../src/lib/diagramkit'

const geoFail = vi.hoisted(() => ({ on: true }))
vi.mock('../../src/lib/geoworld', () => {
  if (geoFail.on) throw new Error('chunk failed')
  return { WORLD_MAP: { w: 600, h: 263, countries: [['1', 'Testland', 'M1,1L5,1L5,5Z']] } }
})

afterEach(() => { vi.restoreAllMocks() })

const task = (id: string, start: number, duration: number) => ({ id, name: `Task ${id}`, start, duration, progress: 0, owner: 'o' })
const PHASES: GanttPhase[] = [{ id: 'p', name: 'Phase', tasks: [task('a', 0, 3), task('b', 3, 3), task('c', 6, 0)] }]
const MON = new Date(2026, 10, 2) // Monday 2 Nov 2026

describe('F-H1: later prop changes', () => {
  it('Gantt takes added and removed tasks', () => {
    const { rerender } = render(<Gantt phases={PHASES} dependencies={[['a', 'b']]} start={MON} days={14} />)
    const next: GanttPhase[] = [{ id: 'p', name: 'Phase', tasks: [task('a', 0, 3), task('d', 4, 2)] }, { id: 'q', name: 'Later', tasks: [task('e', 7, 2)] }]
    expect(() => rerender(<Gantt phases={next} dependencies={[['a', 'd']]} start={MON} days={14} />)).not.toThrow()
    expect(screen.getAllByText('Task d').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Task e').length).toBeGreaterThan(0) // a new phase opens expanded
    expect(screen.queryByText('Task b')).toBeNull()
  })

  it('NetworkGraph takes added and removed nodes', () => {
    const groups: [string, string][] = [['G', 'var(--c2)']]
    const { rerender } = render(<NetworkGraph nodes={[{ label: 'One', group: 0 }, { label: 'Two', group: 0 }]} links={[[0, 1]]} groups={groups} />)
    expect(() => rerender(<NetworkGraph nodes={[{ label: 'One', group: 0 }, { label: 'Two', group: 0 }, { label: 'Three', group: 0 }]} links={[[0, 1], [1, 2]]} groups={groups} />)).not.toThrow()
    expect(screen.getByText('Three')).toBeTruthy()
    expect(() => rerender(<NetworkGraph nodes={[{ label: 'One', group: 0 }]} links={[[0, 1]]} groups={groups} />)).not.toThrow()
    expect(screen.queryByText('Two')).toBeNull()
  })

  it('ProcessFlow takes added nodes and ignores edges to missing ones', () => {
    const node = (id: string, x: number): FlowNode => ({ id, x, y: 0, icon: 'play', color: 'var(--c2)', title: `Step ${id}`, desc: '', body: '', foot: ['', ''] })
    const { rerender, container } = render(<ProcessFlow nodes={[node('a', 0)]} edges={[]} steps={[]} />)
    rerender(<ProcessFlow nodes={[node('a', 0), node('b', 300)]} edges={[{ from: 'a', to: 'b', label: 'kept' }, { from: 'b', to: 'gone', label: 'dangling' }]} steps={[]} />)
    expect(screen.getByText('Step b')).toBeTruthy()
    // one edge is drawn (a → b, with its label); the one to a missing node is not
    const edges = [...container.querySelectorAll('svg[aria-hidden] > g > path')]
    expect(edges).toHaveLength(1)
    expect(edges[0].getAttribute('d')).not.toMatch(/NaN|undefined/)
    expect(screen.getByText('kept')).toBeTruthy()
    expect(screen.queryByText('dangling')).toBeNull()
  })

  it('DataFlow takes added sources and targets without NaN', () => {
    const src = { label: 'Postgres', icon: 'database' as const, color: 'var(--c2)', rate: 10 }
    const dst = { label: 'Warehouse', icon: 'warehouse' as const, color: 'var(--c3)', share: 1 }
    // the links are SVG cubic paths ("M x,y C …"); the particles run on a canvas
    const links = () => [...container.querySelectorAll('svg path')].map(p => p.getAttribute('d') ?? '').filter(d => /^M\S+,\S+ C/.test(d))
    const { rerender, container } = render(<DataFlow sources={[src]} targets={[dst]} />)
    expect(links()).toHaveLength(2) // a lone source or target (one row: no spacing to divide by)
    expect(container.innerHTML).not.toMatch(/NaN|Infinity/)
    rerender(<DataFlow sources={[src, { ...src, label: 'Kafka' }]} targets={[dst, { ...dst, label: 'Alerts' }]} />)
    expect(screen.getByText('Kafka')).toBeTruthy()
    expect(screen.getByText('Alerts')).toBeTruthy()
    expect(links()).toHaveLength(4)
    expect(new Set(links()).size, 'each link has its own path').toBe(4)
    expect(container.innerHTML).not.toMatch(/NaN|Infinity/)
  })

  it('Globe takes added routes', () => {
    const hubs: [string, number, number][] = [['A', 0, 0], ['B', 10, 10], ['C', 20, 0]]
    const { rerender } = render(<Globe hubs={hubs} routes={[{ from: 0, to: 1, color: 'var(--c2)', ms: 40 }]} land={[0, 0]} />)
    expect(() => rerender(<Globe hubs={hubs} routes={[{ from: 0, to: 1, color: 'var(--c2)', ms: 40 }, { from: 1, to: 2, color: 'var(--c3)' }, { from: 0, to: 9, color: 'red' }]} land={[0, 0]} />)).not.toThrow()
    expect(screen.getByText('B → C')).toBeTruthy()
  })
})

describe('F-H2: Gantt dependency graph', () => {
  it('renders a cycle and an unknown id, warns and lists them, and still moves tasks', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    render(<Gantt phases={PHASES} dependencies={[['a', 'b'], ['b', 'a'], ['b', 'nope']]} start={MON} days={14} />)
    expect(warn).toHaveBeenCalled()
    const status = screen.getByRole('status')
    expect(status.textContent).toMatch(/2 dependencies ignored/)
    expect(status.textContent).toMatch(/closes a cycle/)
    expect(status.textContent).toMatch(/no task "nope"/)
    const bar = screen.getByRole('slider', { name: /^Task a,/ })
    fireEvent.keyDown(bar, { key: 'ArrowRight' })
    expect(screen.getByRole('slider', { name: /^Task b,/ }).getAttribute('aria-valuenow')).toBe('4') // pushed after a
  })
})

describe('F-H3: Gantt on any weekday', () => {
  it('skips Saturday and Sunday in the workload when the plan starts on a Wednesday', () => {
    const wed = new Date(2026, 10, 4)
    render(<Gantt phases={[{ id: 'p', name: 'Phase', tasks: [task('a', 0, 10)] }]} dependencies={[]} start={wed} days={14} />)
    fireEvent.click(screen.getByRole('button', { name: 'Workload' }))
    const days = [...document.querySelectorAll('[title$=" Nov"]')].map(el => el.getAttribute('title')!.replace(/^1 task on /, ''))
    expect(days).toContain('6 Nov') // Friday
    expect(days).toContain('9 Nov') // Monday
    expect(days).not.toContain('7 Nov')
    expect(days).not.toContain('8 Nov')
  })
})

const M = (states: WorkflowMachine['states'], start = 'a'): Record<string, WorkflowMachine> => ({ m: { name: 'M', event: 'go', start, states } })

describe('F-H4: WorkflowEngine', () => {
  it('throws at creation for an unknown next state, naming the machine and the state', () => {
    expect(() => new WorkflowEngine(M({ a: { at: ['l', 'S'], label: 'A', next: 'typo' } }), [])).toThrow(/machine "m", state "a".*"typo"/)
  })
  it('throws for a fork without a join and for a missing start state', () => {
    expect(() => new WorkflowEngine(M({ a: { at: ['l', 'S'], label: 'A', orch: true, fork: ['b'] }, b: { at: ['l', 'B'], label: 'B', next: 'back' } }), [])).toThrow(/needs a `join`/)
    expect(() => new WorkflowEngine(M({ a: { at: ['l', 'S'], label: 'A' } }, 'x'), [])).toThrow(/start state "x"/)
  })
  it('keeps ticking after a subscriber throws', () => {
    const report = vi.fn()
    vi.stubGlobal('reportError', report)
    const eng = new WorkflowEngine(M({ a: { at: ['l', 'S'], label: 'A', work: 1, next: 'done' } }), ['m'], { lap: [0, 0] })
    eng.subscribe(() => { throw new Error('bad subscriber') })
    eng.fire('m')
    for (let i = 0; i < 40; i++) eng.tick(0.1)
    expect(report).toHaveBeenCalled()
    expect(eng.jobs[0]?.done).toBe(true)
    vi.unstubAllGlobals()
  })
  it('makes unmatched events observable', () => {
    const eng = new WorkflowEngine(M({ a: { at: ['l', 'S'], label: 'A', next: 'done' } }), ['m'], { lap: [0, 0] })
    const seen: WorkflowEvent[] = []
    eng.subscribe(e => seen.push(e))
    eng.fire('nope')
    expect(eng.unmatched).toBe(1)
    expect(seen.some(e => e.kind === 'unmatched' && e.ev === 'nope')).toBe(true)
  })
  it('ends a job whose guard names an unknown state with an error event', () => {
    const eng = new WorkflowEngine(M({ a: { at: ['l', 'S'], label: 'A', next: () => 'nowhere' } }), ['m'], { lap: [0, 0] })
    const seen: WorkflowEvent[] = []
    eng.subscribe(e => seen.push(e))
    eng.fire('m')
    for (let i = 0; i < 10; i++) eng.tick(0.1)
    expect(seen.find(e => e.kind === 'error')).toMatchObject({ message: expect.stringMatching(/"nowhere"/) })
    expect(eng.jobs[0].done).toBe(true)
  })
  it('queues intake events on its own only when `intake` is set', () => {
    const intakes = (o: { intake?: string }) => {
      const eng = new WorkflowEngine(M({ a: { at: ['l', 'S'], label: 'A', next: 'done' } }), ['m'], { lap: [1e9, 1e9], seed: 1, ...o })
      const seen: WorkflowEvent[] = []
      eng.subscribe(e => seen.push(e))
      for (let i = 0; i < 1000; i++) eng.tick(0.1) // 100 s
      return seen.filter(e => e.kind === 'queued' && e.cause === 'intake')
    }
    expect(intakes({})).toEqual([]) // the default: no timer
    const got = intakes({ intake: 'go' })
    expect(got.length).toBeGreaterThanOrEqual(5) // first at 6 s, then every 9–15 s
    expect(got.length).toBeLessThanOrEqual(12)
    expect(got.every(e => e.kind === 'queued' && e.ev === 'go')).toBe(true)
  })
})

const run = (status: TraceRun['status']): TraceRun => ({ id: status, name: 'Run', startedAt: 0, endedAt: 2000, status, spans: [
  { id: 'r', kind: 'agent', name: 'Root', startMs: 0, endMs: 2000, status: status === 'ok' ? 'ok' : 'cancelled' },
  { id: 't', parentId: 'r', kind: 'tool', name: 'fetch', startMs: 100, endMs: 1500, status: 'cancelled' },
] })

describe('F-H5: TraceWaterfall badge', () => {
  it.each([['error', 'Failed'], ['cancelled', 'Cancelled'], ['ok', 'Complete']] as const)('a finished %s run reads %s', (status, label) => {
    // a live run that ends settles at its end (jsdom never scrolls a replay into view)
    const now = Date.now(), live: TraceRun = { id: 'x', name: 'Run', startedAt: now - 2000, status: 'running', spans: [
      { id: 'r', kind: 'agent', name: 'Root', startMs: now - 2000, status: 'running' }, { id: 't', parentId: 'r', kind: 'tool', name: 'fetch', startMs: now - 1900, status: 'running' }] }
    const { rerender } = render(<TraceWaterfall run={live} />)
    expect(screen.getByText('Live')).toBeTruthy()
    const end = run(status), shift = (ms: number) => ms + now - 2000
    act(() => rerender(<TraceWaterfall run={{ ...end, id: 'x', startedAt: shift(0), endedAt: shift(2000), spans: end.spans.map(s => ({ ...s, startMs: shift(s.startMs), endMs: shift(s.endMs!) })) }} />))
    const header = screen.getByText('Run', { selector: 'b' }).parentElement!
    expect(within(header).getByText(label)).toBeTruthy()
    if (status !== 'ok') expect(within(header).queryByText('Complete')).toBeNull()
  })
})

describe('F-H6: Globe latencies', () => {
  it('shows no latency for a route without ms', () => {
    render(<Globe hubs={[['A', 0, 0], ['B', 10, 10]]} routes={[{ from: 0, to: 1, color: 'var(--c2)' }]} land={[0, 0]} />)
    expect(screen.getByText('A → B')).toBeTruthy()
    expect(screen.queryByText(/\bms$/)).toBeNull()
  })
  it('works without a UIProvider', () => {
    render(<Globe hubs={[['A', 0, 0], ['B', 10, 10]]} routes={[{ from: 0, to: 1, color: 'var(--c2)', ms: 42 }]} land={[0, 0]} />)
    expect(screen.getByRole('img', { name: /globe/i })).toBeTruthy()
    expect(screen.getByText('A → B')).toBeTruthy()
    expect(screen.getByText('42 ms')).toBeTruthy()
  })
})

describe('F-H7: DataFlow follows a scoped theme', () => {
  it('re-resolves its canvas colours when the closest .ui-root changes theme', async () => {
    // a theme per scope, and a 2D context that records the colours painted (jsdom has no canvas)
    const css = document.head.appendChild(document.createElement('style'))
    css.textContent = '.ui-root[data-theme="light"] { --c2: rgb(1, 2, 3) } .ui-root[data-theme="dark"] { --c2: rgb(4, 5, 6) }'
    const painted: string[] = []
    const ctx = new Proxy({}, {
      get: (_t, p) => p === 'createRadialGradient' || p === 'createLinearGradient' ? () => ({ addColorStop: () => {} }) : () => {},
      set: (_t, p, v) => { if (p === 'fillStyle' && typeof v === 'string') painted.push(v); return true },
    })
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(ctx as unknown as CanvasRenderingContext2D)
    try {
      const { container } = render(<div className="ui-root" data-theme="light"><DataFlow sources={[{ label: 'S', icon: 'database', color: 'var(--c2)', rate: 1 }]} targets={[{ label: 'T', icon: 'chart', color: 'var(--c3)', share: 1 }]} /></div>)
      expect(painted).toContain('rgba(1,2,3,1)')
      expect(painted).not.toContain('rgba(4,5,6,1)')
      act(() => { (container.firstChild as HTMLElement).setAttribute('data-theme', 'dark') })
      await waitFor(() => expect(painted).toContain('rgba(4,5,6,1)'))
    } finally { css.remove() }
  })
})

describe('F-M1: StateMachine engine identity', () => {
  it('keeps its engine when order is a new array with the same values', () => {
    const machines = M({ a: { at: ['l', 'S'], label: 'A', work: 5, next: 'done' } })
    const { rerender } = render(<StateMachine machines={machines} order={['m']} />)
    fireEvent.click(screen.getByRole('button', { name: 'Fire event' }))
    expect(screen.getAllByText('go').length).toBeGreaterThan(0) // queued
    rerender(<StateMachine machines={machines} order={['m']} />)
    expect(screen.queryByText(/^empty · jobs start/)).toBeNull()
  })
})

describe('F-M3: diagram dots always settle', () => {
  it('resolves dots dropped by clear(), by max and on unmount', async () => {
    const { result, unmount } = renderHook(() => useDgDots(2))
    let cleared = false, evicted = false, unmounted = false
    act(() => { void result.current.send('e1', 500).then(() => { evicted = true }) })
    act(() => { void result.current.send('e2', 500).then(() => { cleared = true }) })
    act(() => { void result.current.send('e3', 500).then(() => { unmounted = true }) })
    await act(async () => {})
    expect(evicted).toBe(true) // e1 pushed out by e3 (max 2)
    act(() => result.current.clear())
    await act(async () => {})
    expect(cleared).toBe(true)
    act(() => { void result.current.send('e4', 500).then(() => { unmounted = true }) })
    unmount()
    await Promise.resolve()
    expect(unmounted).toBe(true)
  })
})

describe('F-M9: lazy map data that fails', () => {
  it('shows Map unavailable with Retry, and Retry loads it', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    render(<WorldMap data={{ Testland: { v: 1 } }} metrics={[{ key: 'v', label: 'Value', format: String }]} />)
    expect(await screen.findByText('Map unavailable')).toBeTruthy()
    expect(err).toHaveBeenCalled()
    geoFail.on = false
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    await waitFor(() => expect(screen.queryByText('Map unavailable')).toBeNull())
  })
})
