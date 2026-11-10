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

// reduced motion on for these components (motion asks for "(prefers-reduced-motion)", which the shared stub doesn't match)
vi.mock('motion/react', async orig => ({ ...(await orig<typeof import('motion/react')>()), useReducedMotion: () => true }))

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

describe('AgentTransitMap layers', () => {
  it('draws the map once and its moving parts in layers over it', () => {
    const { container } = render(<TransitSimMap machines={AGENT_WORKFLOWS} order={AGENT_WORKFLOW_ORDER} />)
    // one accessible drawing; the heat, the queue/hubs/rings and the labels are hidden layers of the same size
    expect(screen.getAllByRole('img', { name: 'Transit map of agent teams' })).toHaveLength(1)
    const svgs = container.querySelectorAll('svg[viewBox="0 0 1000 720"]')
    expect(svgs.length).toBe(5)
    svgs.forEach((s, i) => { if (i > 0) expect(s.getAttribute('aria-hidden')).toBe('true') })
    // heat starts cold, styled by the heat tween (one style write, theme tokens as the colours)
    const heat = svgs[1].querySelectorAll('path')
    expect(heat.length).toBeGreaterThan(10)
    heat.forEach(p => { expect(p.style.stroke).toBe('var(--fg3)'); expect(p.style.opacity).toBe('0') })
    expect(screen.getByText('Event queue')).toBeInTheDocument()
  })
  it('places the train by rotation (stepped, under reduced motion) and keeps it under the Index station', () => {
    const { container } = render(<TransitSimMap machines={AGENT_WORKFLOWS} order={AGENT_WORKFLOW_ORDER} />)
    const train = container.querySelector('rect[width="24"][height="8"]')!.closest('svg')!.parentElement!.parentElement!
    expect(train.style.transform).toMatch(/^rotate\([\d.]+deg\)$/)
    // the train's layer comes before the hubs' drawing in the DOM, so the Index station is drawn over it
    const hubs = container.querySelector('circle[r="10"][stroke="var(--fg)"]')!
    expect(train.compareDocumentPosition(hubs) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })
})

describe('TraceWaterfall bars', () => {
  const spans = [
    { id: 'r', name: 'Run', kind: 'agent' as const, start: 0, duration: 10 },
    { id: 'a', parent: 'r', name: 'Search', kind: 'tool' as const, start: 1, duration: 4 },
  ]
  it('reveal by clip-path on a bar of the span’s full width (no width animation)', () => {
    vi.stubGlobal('IntersectionObserver', SeenObserver)
    const { container } = render(<TraceWaterfall spans={spans} total={10} />)
    const bars = [...container.querySelectorAll<HTMLElement>('div[style*="clip-path"]')]
    expect(bars).toHaveLength(2)
    // reduced motion shows the finished run: full width, nothing clipped away
    expect(bars.map(b => b.style.width)).toEqual(['100%', '40%'])
    bars.forEach(b => expect(b.style.clipPath).toMatch(/^inset\(0(px)? min\(0(\.0+)?%, calc\(100% - 2px\)\) 0(px)? 0(px)? round/))
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
