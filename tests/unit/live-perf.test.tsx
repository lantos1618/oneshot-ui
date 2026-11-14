// 0.7 live demos on phones: frame loops capped on touch screens and paused when nothing moves, the transit map's still
// drawing split from its moving layers, the trace waterfall's bars revealed by clip-path instead of a growing width.
import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { UIProvider } from '../../src/lib/provider'
import { frameLoopFps, useFrameLoop } from '../../src/lib/motion'
import { TransitSimMap } from '../../src/examples/transit-sim'
import { TraceWaterfall } from '../../src/lib/trace'
import { Globe } from '../../src/lib/geo'
import { AGENT_WORKFLOWS, AGENT_WORKFLOW_ORDER } from '../../src/examples'


/** IntersectionObserver that reports everything on screen. */
class SeenObserver {
  cb: IntersectionObserverCallback
  constructor(cb: IntersectionObserverCallback) { this.cb = cb }
  observe(el: Element) { this.cb([{ isIntersecting: true, intersectionRatio: 1, target: el } as unknown as IntersectionObserverEntry], this as unknown as IntersectionObserver) }
  unobserve() {} disconnect() {} takeRecords() { return [] }
  root = null; rootMargin = ''; thresholds = []
}
const realMatchMedia = window.matchMedia
/** matchMedia as in tests/setup.ts (reduced motion on), plus the given queries. */
const mediaWith = (...extra: RegExp[]) => {
  window.matchMedia = ((query: string) => ({
    matches: /prefers-reduced-motion:\s*reduce/.test(query) || extra.some(r => r.test(query)), media: query, onchange: null,
    addEventListener: () => {}, removeEventListener: () => {}, addListener: () => {}, removeListener: () => {}, dispatchEvent: () => false,
  })) as typeof window.matchMedia
}
afterEach(() => { window.matchMedia = realMatchMedia; vi.unstubAllGlobals() })

describe('frameLoopFps', () => {
  it('caps on coarse pointers only when coarseFps is set', () => {
    expect(frameLoopFps({}, true)).toBe(0)
    expect(frameLoopFps({ coarseFps: 30 }, false)).toBe(0)
    expect(frameLoopFps({ coarseFps: 30 }, true)).toBe(30)
    expect(frameLoopFps({ fps: 20 }, false)).toBe(20)
    expect(frameLoopFps({ fps: 20, coarseFps: 30 }, true)).toBe(20)
    expect(frameLoopFps({ fps: 50, coarseFps: 30 }, true)).toBe(30)
  })
})

function Loop({ onFrame, opts }: { onFrame: (dt: number) => void; opts?: Parameters<typeof useFrameLoop>[2] }) {
  useFrameLoop(true, onFrame, opts)
  return null
}
const countFrames = (coarse: boolean, opts?: Parameters<typeof useFrameLoop>[2]) => {
  if (coarse) mediaWith(/pointer:\s*coarse/)
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'requestAnimationFrame', 'cancelAnimationFrame', 'performance'] })
  const dts: number[] = []
  const { unmount } = render(<Loop onFrame={dt => dts.push(dt)} opts={opts} />)
  act(() => { vi.advanceTimersByTime(1000) })
  unmount()
  return dts
}

describe('useFrameLoop', () => {
  it('runs every frame by default', () => {
    expect(countFrames(true).length).toBeGreaterThanOrEqual(55)
  })
  it('runs at about 30 fps on touch screens with { coarseFps: 30 }, with dt covering the skipped frames', () => {
    const dts = countFrames(true, { coarseFps: 30 })
    expect(dts.length).toBeGreaterThanOrEqual(25)
    expect(dts.length).toBeLessThanOrEqual(34)
    expect(dts.slice(1).every(dt => dt > 0.025 && dt < 0.05)).toBe(true)
  })
  it('keeps every frame on fine pointers with { coarseFps: 30 }', () => {
    expect(countFrames(false, { coarseFps: 30 }).length).toBeGreaterThanOrEqual(55)
  })
  it('still takes maxDt as a number', () => {
    const dts = countFrames(false, 0.01)
    expect(Math.max(...dts)).toBeLessThanOrEqual(0.01)
  })
})

describe('AgentTransitMap', () => {
  it('is one accessible drawing, its moving layers hidden from assistive tech', () => {
    render(<TransitSimMap machines={AGENT_WORKFLOWS} order={AGENT_WORKFLOW_ORDER} />)
    expect(screen.getAllByRole('img')).toEqual([screen.getByRole('img', { name: 'Transit map of agent teams' })])
    expect(screen.getByText('Event queue')).toBeInTheDocument()
  })
})

describe('TraceWaterfall bars', () => {
  const spans = [
    { id: 'r', name: 'Run', kind: 'agent' as const, start: 0, duration: 10 },
    { id: 'a', parent: 'r', name: 'Search', kind: 'tool' as const, start: 1, duration: 4 },
  ]
  it('under reduced motion shows the finished run: each bar covers its span, nothing cut away', () => {
    vi.stubGlobal('IntersectionObserver', SeenObserver)
    const { container } = render(<TraceWaterfall spans={spans} total={10} />)
    expect(screen.getByText('Run')).toBeInTheDocument()
    expect(screen.getByText('4.0s')).toBeInTheDocument() // Search's label reads its whole duration
    // the bars: placed at the span's start, as long as the span (of a 10 s total)
    const bars = [...container.querySelectorAll<HTMLElement>('div[style*="left"][style*="width"]')]
    expect(bars.map(b => [b.style.left, b.style.width])).toEqual([['0%', '100%'], ['10%', '40%']])
    // and shown whole: visible, with no clip trimming the end of the bar
    for (const b of bars) {
      expect(b.style.opacity).toBe('1')
      expect(b.style.clipPath === '' || /^inset\(\S+ (min\()?0(\.0+)?(%|px)?[ ,]/.test(b.style.clipPath)).toBe(true)
    }
  })
})

describe('Globe', () => {
  it('draws the disc on its own canvas, and stays still (no frame loop) under reduced motion until it is spun', () => {
    vi.stubGlobal('IntersectionObserver', SeenObserver)
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'requestAnimationFrame', 'cancelAnimationFrame', 'performance'] })
    const raf = vi.spyOn(window, 'requestAnimationFrame')
    const framesIn = (ms: number) => { const n = raf.mock.calls.length; act(() => { vi.advanceTimersByTime(ms) }); return raf.mock.calls.length - n }
    const { container } = render(<UIProvider persist={false}><Globe hubs={[['A', 0, 0], ['B', 10, 10]]} routes={[{ from: 0, to: 1, color: 'var(--c2)' }]} land={[0, 0, 10, 10]} /></UIProvider>)
    expect(container.querySelectorAll('canvas')).toHaveLength(2)
    expect(screen.getAllByRole('img', { name: 'Rotating globe with routes between cities' })).toHaveLength(1)
    framesIn(100) // let mount-time one-off draws settle
    expect(framesIn(1000)).toBe(0)
    fireEvent.click(screen.getByRole('button', { name: 'Auto-rotate off' }))
    expect(framesIn(1000)).toBeGreaterThan(20)
  })
})
