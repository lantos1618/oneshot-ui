// 0.14: what the Swift port added, brought back. useFormDraft saves a snapshot (edits during a save stay dirty), seeds
// make the jittering components repeatable, late results of superseded host calls are dropped, and ScrollSpyNav,
// ChatBranches and AgentRunView moved from the showcase into the library.
import { act, fireEvent, render, renderHook, screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { AlertDialog, ScrollSpyNav, UIProvider, seededRandom, useGeneration, useScrollSpy } from '../../src/lib'
import { useFormDraft } from '../../src/lib/editor'
import { useStreamedText } from '../../src/lib/ai'
import { Terminal } from '../../src/lib/code'
import { DataFlow } from '../../src/lib/network'
import { WorkflowEngine, type WorkflowMachine } from '../../src/lib/statechart'
import { AudioPlayer } from '../../src/lib/media'
import { useAiChat, type AiChunk, type AiMessage } from '../../src/lib/aistream'
import { ChatBranches } from '../../src/lib/aichat'
import { AgentRunView } from '../../src/lib/aiagent'
import { AGENT_RUN_FIXTURES, CHAT_TREE_SAMPLE } from '../../src/examples'
import { withMotion } from '../helpers'

const deferred = <T = void,>() => {
  let resolve!: (v: T) => void, reject!: (e: unknown) => void
  const promise = new Promise<T>((a, b) => { resolve = a; reject = b })
  return { promise, resolve, reject }
}

describe('useFormDraft save', () => {
  it('commits the values from when the save started and keeps edits made during it dirty', async () => {
    const { result } = renderHook(() => useFormDraft({ name: 'Alex', email: 'a@x.io' }))
    act(() => result.current.set('name', 'Sam'))
    const req = deferred()
    const fn = vi.fn(() => req.promise)
    let saved!: Promise<boolean>
    act(() => { saved = result.current.save(fn) })
    expect(fn).toHaveBeenCalledWith({ name: 'Sam', email: 'a@x.io' })
    expect(result.current.saving).toBe(true)
    act(() => result.current.set('email', 'sam@x.io')) // typed while the request is in flight
    await act(async () => { req.resolve(); await saved })
    expect(await saved).toBe(true)
    expect(result.current.saving).toBe(false)
    expect(result.current.saved).toEqual({ name: 'Sam', email: 'a@x.io' })
    expect(result.current.values).toEqual({ name: 'Sam', email: 'sam@x.io' })
    expect(result.current.dirty).toBe(true)
  })

  it('marks nothing saved when the save fails, and ignores a second save while one runs', async () => {
    const { result } = renderHook(() => useFormDraft({ name: 'Alex' }))
    act(() => result.current.set('name', 'Sam'))
    const req = deferred()
    let first!: Promise<boolean>, second!: Promise<boolean>
    act(() => { first = result.current.save(() => req.promise) })
    const other = vi.fn()
    act(() => { second = result.current.save(other) })
    expect(await second).toBe(false)
    expect(other).not.toHaveBeenCalled()
    await act(async () => { req.reject(new Error('offline')); await first.catch(() => {}) })
    await expect(first).rejects.toThrow('offline')
    expect(result.current).toMatchObject({ saving: false, dirty: true, saved: { name: 'Alex' } })
  })
})

describe('seeds', () => {
  it('seededRandom repeats its sequence and stays in [0, 1)', () => {
    const a = seededRandom(7), b = seededRandom(7), xs = Array.from({ length: 50 }, a)
    expect(Array.from({ length: 50 }, b)).toEqual(xs)
    expect(xs.every(x => x >= 0 && x < 1)).toBe(true)
    expect(seededRandom(8)()).not.toBe(xs[0])
  })

  it('WorkflowEngine with a seed spaces its intake events the same way every time', () => {
    const machine: WorkflowMachine = { name: 'Ticket', event: 'ticket', start: 'a', states: { a: { at: ['support', 'Intake'], label: 'Intake', next: 'done' } } }
    const times = () => {
      const e = new WorkflowEngine({ t: machine }, ['t'], { lap: [0, 0], intake: 'ticket', seed: 3 }), at: number[] = []
      e.subscribe(ev => { if (ev.kind === 'queued') at.push(Math.round(e.clock * 10)) })
      for (let i = 0; i < 600; i++) e.tick(0.1)
      return at
    }
    const random = vi.spyOn(Math, 'random')
    const first = times()
    expect(first.length).toBeGreaterThan(3)
    expect(times()).toEqual(first)
    expect(random).not.toHaveBeenCalled()
  })

  it('useStreamedText with a seed reveals the same way every time', () => {
    withMotion()
    vi.useFakeTimers()
    const text = 'One two three four five six seven eight nine ten eleven twelve'
    const trace = () => {
      const { result, unmount } = renderHook(() => useStreamedText(text, { unit: 'word', wordDelay: 40, seed: 11 }))
      const seen: number[] = []
      for (let i = 0; i < 12; i++) { act(() => { vi.advanceTimersByTime(34) }); seen.push(result.current.shown) }
      unmount()
      return seen
    }
    const random = vi.spyOn(Math, 'random')
    const first = trace()
    expect(first.at(-1)).toBeGreaterThan(0)
    expect(trace()).toEqual(first)
    expect(random).not.toHaveBeenCalled()
  })

  it('Terminal with a seed types without Math.random', async () => {
    withMotion()
    vi.useFakeTimers()
    vi.stubGlobal('IntersectionObserver', SeenObserver)
    const random = vi.spyOn(Math, 'random')
    render(<Terminal lines={[{ cmd: 'pnpm add @lyndon/ui' }, { out: 'done' }]} seed={5} />)
    await act(async () => { await vi.advanceTimersByTimeAsync(5000) })
    expect(screen.getByRole('log')).toHaveTextContent('pnpm add @lyndon/ui')
    expect(random).not.toHaveBeenCalled()
  })

  it('DataFlow with a seed draws its simulated latency from the seed', async () => {
    vi.useFakeTimers()
    vi.stubGlobal('IntersectionObserver', SeenObserver)
    const r = seededRandom(9); r() // the first draw jitters the throughput, the second the p95
    const p95 = Math.round(42 + r() * 6)
    render(<DataFlow simulate seed={9} sources={[{ label: 'Web', icon: 'globe', color: 'var(--c1)', rate: 40 }]} targets={[{ label: 'Lake', icon: 'database', color: 'var(--c2)', share: 1 }]} />)
    await act(async () => { await vi.advanceTimersByTimeAsync(1000) })
    expect(screen.getByText('Latency p95').parentElement).toHaveTextContent(String(p95))
  })
})

/** Reports every observed element as fully on screen. */
class SeenObserver {
  cb: IntersectionObserverCallback
  constructor(cb: IntersectionObserverCallback) { this.cb = cb }
  observe(el: Element) { this.cb([{ isIntersecting: true, intersectionRatio: 1, target: el } as unknown as IntersectionObserverEntry], this as unknown as IntersectionObserver) }
  unobserve() {} disconnect() {} takeRecords() { return [] }
  root = null; rootMargin = ''; thresholds = []
}

describe('late results of superseded calls', () => {
  it('useGeneration: next() and unmount make earlier calls stale', () => {
    const { result, unmount } = renderHook(() => useGeneration())
    const a = result.current.next(), b = result.current.next()
    expect([a(), b()]).toEqual([false, true])
    result.current.invalidate()
    expect(b()).toBe(false)
    const c = result.current.next()
    unmount()
    expect(c()).toBe(false)
  })

  it('AlertDialog ignores a confirm that resolves after it was closed and reopened', async () => {
    const change = vi.fn(), req = deferred()
    const ui = (open: boolean) => <AlertDialog open={open} onOpenChange={change} title="Delete workspace?" description="Everything in it goes too." confirmLabel="Delete" onConfirm={() => req.promise} />
    const { rerender } = render(ui(true))
    fireEvent.click(await screen.findByRole('button', { name: 'Delete' }))
    expect(screen.getByRole('alertdialog')).toHaveAttribute('aria-busy', 'true')
    rerender(ui(false))
    rerender(ui(true))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Delete' })).toBeEnabled())
    await act(async () => { req.resolve() })
    expect(change).not.toHaveBeenCalled()
    expect(screen.getByRole('alertdialog')).toBeInTheDocument()
  })

  it('AudioPlayer does not report a play() that a pause interrupted, but does report a refused one', async () => {
    const plays: ReturnType<typeof deferred>[] = []
    class SlowAudio {
      src = ''; preload = ''; paused = true; currentTime = 0; duration = NaN; playbackRate = 1
      addEventListener() {} removeEventListener() {} removeAttribute() {}
      play() { this.paused = false; const d = deferred<unknown>(); plays.push(d); return d.promise }
      pause() { this.paused = true; plays.at(-1)?.reject(Object.assign(new Error('The play() request was interrupted by a call to pause()'), { name: 'AbortError' })) }
    }
    vi.stubGlobal('Audio', SlowAudio)
    vi.stubGlobal('IntersectionObserver', SeenObserver)
    render(<UIProvider><AudioPlayer src="https://x.example/a.mp3" title="A" peaks={[0.5, 0.5]} /></UIProvider>)
    const button = screen.getByRole('button', { name: 'Play' })
    await act(async () => { fireEvent.click(button) })
    await act(async () => { fireEvent.click(button) }) // pause before playback started
    await act(async () => {})
    expect(screen.queryByText('Couldn’t play audio')).toBeNull()
    await act(async () => { fireEvent.click(button) })
    await act(async () => { plays.at(-1)!.reject(Object.assign(new Error('blocked'), { name: 'NotAllowedError' })) })
    expect(await screen.findByText('Couldn’t play audio')).toBeInTheDocument()
  })

  it('useAiChat continues once, after the last pending approval, and not after a new reply started', async () => {
    const hosts: Record<string, ReturnType<typeof deferred<unknown>>> = { c1: deferred(), c2: deferred() }
    const send = vi.fn(async function* (messages: AiMessage[]): AsyncGenerator<AiChunk | string> {
      if (messages[messages.length - 1].role === 'assistant') { yield 'Both sent.'; return }
      yield { type: 'tool-start', id: 'c1', name: 'mail.send', needsApproval: true } as AiChunk
      yield { type: 'tool-start', id: 'c2', name: 'sms.send', needsApproval: true } as AiChunk
    })
    const { result } = renderHook(() => useAiChat({ send, onApprovalRequest: t => hosts[t.id].promise }))
    act(() => { result.current.submit('tell sam') })
    await waitFor(() => expect(result.current.messages[1]?.parts[1]).toMatchObject({ state: 'awaiting-approval' }))
    await waitFor(() => expect(result.current.status).toBe('ready'))
    let a!: Promise<void>, b!: Promise<void>
    act(() => { a = result.current.decideTool('c1', true); b = result.current.decideTool('c2', true) })
    await act(async () => { hosts.c2.resolve('ok'); await b })
    expect(send).toHaveBeenCalledTimes(1) // c1 is still running
    await act(async () => { hosts.c1.resolve('ok'); await a })
    await waitFor(() => expect(result.current.status).toBe('ready'))
    expect(send).toHaveBeenCalledTimes(2)

    // an approval that lands after Regenerate started a new reply does not continue anything
    send.mockClear()
    const late = deferred<unknown>()
    async function* again(): AsyncGenerator<AiChunk | string> { yield { type: 'tool-start', id: 'c3', name: 'mail.send', needsApproval: true } as AiChunk }
    send.mockImplementationOnce(again).mockImplementationOnce(async function* (): AsyncGenerator<AiChunk | string> { yield 'Fresh answer.' })
    hosts.c3 = late
    act(() => { result.current.regenerate() })
    await waitFor(() => expect(result.current.messages[1]?.parts[0]).toMatchObject({ id: 'c3', state: 'awaiting-approval' }))
    await waitFor(() => expect(result.current.status).toBe('ready'))
    let c!: Promise<void>
    act(() => { c = result.current.decideTool('c3', true) })
    act(() => { result.current.regenerate() })
    await waitFor(() => expect(result.current.status).toBe('ready'))
    await act(async () => { late.resolve('ok'); await c })
    await act(async () => {})
    expect(send).toHaveBeenCalledTimes(2) // the two regenerates, no continuation
  })
})

/** An IntersectionObserver the test drives: `fire(id)` reports that element entering the band. */
class SpyObserver {
  static all: SpyObserver[] = []
  els: Element[] = []
  cb: IntersectionObserverCallback; options?: IntersectionObserverInit
  constructor(cb: IntersectionObserverCallback, options?: IntersectionObserverInit) { this.cb = cb; this.options = options; SpyObserver.all.push(this) }
  observe(el: Element) { this.els.push(el) }
  unobserve() {} disconnect() { this.els = [] } takeRecords() { return [] }
  root = null; rootMargin = ''; thresholds = []
  static fire(id: string) {
    for (const o of SpyObserver.all) for (const el of o.els) if (el.id === id) o.cb([{ isIntersecting: true, target: el } as unknown as IntersectionObserverEntry], o as unknown as IntersectionObserver)
  }
}

describe('ScrollSpyNav and useScrollSpy', () => {
  const Page = ({ onNavigate }: { onNavigate?: (id: string) => void }) => (
    <div>
      <ScrollSpyNav onNavigate={onNavigate} items={[{ id: 'install', label: 'Install' }, { id: 'theme', label: 'Theme', items: [{ id: 'tokens', label: 'Tokens' }] }, { id: 'deploy', label: 'Deploy' }]} />
      {['install', 'theme', 'tokens', 'deploy'].map(id => <section key={id} id={id}>{id}</section>)}
    </div>
  )

  it('marks the section crossing the band as current and opens its group', () => {
    SpyObserver.all = []
    vi.stubGlobal('IntersectionObserver', SpyObserver)
    render(<Page />)
    const nav = screen.getByRole('navigation', { name: 'On this page' })
    expect(within(nav).getByRole('link', { name: 'Install' })).toHaveAttribute('aria-current', 'location')
    expect(within(nav).queryByRole('link', { name: 'Tokens' })).toBeNull()
    expect(SpyObserver.all.at(-1)!.options?.rootMargin).toBe('-40% 0px -55% 0px')
    act(() => SpyObserver.fire('tokens'))
    expect(within(nav).getByRole('link', { name: 'Tokens' })).toHaveAttribute('aria-current', 'location')
    expect(within(nav).getByRole('link', { name: 'Install' })).not.toHaveAttribute('aria-current')
    act(() => SpyObserver.fire('deploy'))
    expect(within(nav).queryByRole('link', { name: 'Tokens' })).toBeNull()
  })

  it('a plain click scrolls to the section; a modified click is left to the browser', () => {
    SpyObserver.all = []
    vi.stubGlobal('IntersectionObserver', SpyObserver)
    const go = vi.fn(), scrolled = vi.spyOn(Element.prototype, 'scrollIntoView')
    render(<Page onNavigate={go} />)
    const link = screen.getByRole('link', { name: 'Deploy' })
    expect(link).toHaveAttribute('href', '#deploy')
    expect(fireEvent.click(link)).toBe(false) // default prevented
    expect(go).toHaveBeenCalledWith('deploy')
    expect(scrolled).toHaveBeenCalledTimes(1)
    expect(fireEvent.click(link, { metaKey: true })).toBe(true)
    expect(go).toHaveBeenCalledTimes(1)
  })

  it('useScrollSpy watches a scroller of its own when given a root', () => {
    SpyObserver.all = []
    vi.stubGlobal('IntersectionObserver', SpyObserver)
    const box = document.createElement('div'), el = document.createElement('section')
    el.id = 'faq'; box.appendChild(el); document.body.appendChild(box)
    const { result } = renderHook(() => useScrollSpy(['faq'], { root: { current: box }, initial: '' }))
    expect(result.current).toBe('')
    expect(SpyObserver.all.at(-1)!.options?.root).toBe(box)
    act(() => SpyObserver.fire('faq'))
    expect(result.current).toBe('faq')
    box.remove()
  })
})

describe('ChatBranches', () => {
  const rowOf = (text: RegExp) => screen.getAllByRole('row').find(r => text.test(r.textContent ?? ''))!

  it('continues a branch through onLeafChange and offers forks only when the host handles them', () => {
    const leafChange = vi.fn(), regenerate = vi.fn()
    const { rerender } = render(<ChatBranches messages={CHAT_TREE_SAMPLE} leaf="a5" onLeafChange={leafChange} />)
    expect(screen.queryByRole('button', { name: 'Regenerate (new branch)' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Edit (new branch)' })).toBeNull()
    fireEvent.click(within(rowOf(/A lighter museum day/)).getByRole('button', { name: 'Previous branch' }))
    expect(leafChange).toHaveBeenLastCalledWith('a5') // a2b's newest leaf is the combining answer
    rerender(<ChatBranches messages={CHAT_TREE_SAMPLE} leaf="a5" onLeafChange={leafChange} onRegenerate={regenerate} />)
    fireEvent.click(within(rowOf(/Combined day 2/)).getByRole('button', { name: 'Regenerate (new branch)' }))
    expect(regenerate).toHaveBeenCalledWith(expect.objectContaining({ id: 'a5' }))
    expect(screen.getByText(/13 messages · 3 forks/)).toBeInTheDocument()
  })
})

describe('AgentRunView', () => {
  it('switches between the waterfall, the transit map and lanes', () => {
    const run = AGENT_RUN_FIXTURES[1].run(), change = vi.fn()
    render(<AgentRunView run={run} onModeChange={change} />)
    expect(screen.getAllByRole('tab').map(t => t.textContent)).toEqual(['Waterfall', 'Transit map', 'Lanes'])
    expect(screen.getByRole('tab', { name: 'Waterfall' })).toHaveAttribute('aria-selected', 'true')
    fireEvent.click(screen.getByRole('tab', { name: 'Lanes' }))
    expect(change).toHaveBeenCalledWith('lanes')
    expect(screen.getByRole('grid', { name: `${run.name} steps` })).toBeInTheDocument()
  })

  it('shows only the modes it is given', () => {
    render(<AgentRunView run={AGENT_RUN_FIXTURES[0].run()} modes={['lanes', 'waterfall']} defaultMode="lanes" />)
    expect(screen.getAllByRole('tab').map(t => t.textContent)).toEqual(['Lanes', 'Waterfall'])
    expect(screen.getByRole('tab', { name: 'Lanes' })).toHaveAttribute('aria-selected', 'true')
  })
})
