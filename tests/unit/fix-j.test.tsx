// Package J (agents, media, collab): truncated runs, AICanvas talking to its model, audio sources, ChatInbox and
// LivePresence as real components (their simulations live in the examples), MasonryGallery saves, run-map memo keys.
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { UIProvider } from '../../src/lib/provider'
import { useAgentRun, type AgentRun, type AgentRunEvent, type AgentRunSource, type UseAgentRunOptions } from '../../src/lib/agentrun'
import { AICanvas, AgentTransitMap } from '../../src/lib/aiagent'
import { AudioPlayer, MasonryGallery, VideoPlayer, type GalleryItem } from '../../src/lib/media'
import { fakeTimers, tick, withMotion } from '../helpers'
import { AnchoredComments, ChatInbox, LivePresence, type AnchoredThread, type InboxConversation } from '../../src/lib/collab'

afterEach(() => { vi.unstubAllGlobals() })

/** IntersectionObserver that reports everything on screen. */
class SeenObserver {
  cb: IntersectionObserverCallback
  constructor(cb: IntersectionObserverCallback) { this.cb = cb }
  observe(el: Element) { this.cb([{ isIntersecting: true, intersectionRatio: 1, target: el } as unknown as IntersectionObserverEntry], this as unknown as IntersectionObserver) }
  unobserve() {} disconnect() {} takeRecords() { return [] }
  root = null; rootMargin = ''; thresholds = []
}

const t0 = 1_700_000_000_000
const RUN_START: AgentRunEvent[] = [
  { type: 'run-start', at: t0, id: 'r', name: 'Run' },
  { type: 'span-start', span: { id: 'a', kind: 'agent', name: 'Agent', startMs: t0 } },
  { type: 'span-start', span: { id: 't', parentId: 'a', kind: 'tool', name: 'search', startMs: t0 + 10 } },
]
async function* streamOf(evs: AgentRunEvent[]) { yield* evs }

describe('J-H1: a stream that closes before run-end', () => {
  function Probe({ source, options }: { source: AgentRunSource; options?: UseAgentRunOptions }) {
    const { run, status, closedEarly } = useAgentRun(source, options)
    return <p data-testid="probe">{status}:{run?.status ?? '-'}:{String(closedEarly)}</p>
  }
  it('is not ok: the run is cancelled, closedEarly is set and onError is called', async () => {
    const onError = vi.fn()
    render(<Probe source={streamOf(RUN_START)} options={{ onError }} />)
    await waitFor(() => expect(screen.getByTestId('probe').textContent).toBe('error:cancelled:true'))
    expect(onError).toHaveBeenCalledTimes(1)
    expect(onError.mock.calls[0][0]).toMatchObject({ name: 'AgentRunClosedEarlyError' })
  })
  it('an explicit run-end still finishes ok', async () => {
    const onError = vi.fn()
    const full = [...RUN_START, { type: 'span-end', id: 't', endMs: t0 + 20 }, { type: 'span-end', id: 'a', endMs: t0 + 30 }, { type: 'run-end', at: t0 + 30 }] as AgentRunEvent[]
    render(<Probe source={streamOf(full)} options={{ onError }} />)
    await waitFor(() => expect(screen.getByTestId('probe').textContent).toBe('done:ok:false'))
    expect(onError).not.toHaveBeenCalled()
  })
  it('AgentTransitMap does not call a truncated run Complete', async () => {
    const source = streamOf(RUN_START)
    function View() { const { run } = useAgentRun(source); return run ? <AgentTransitMap run={run} /> : null }
    render(<View />)
    await waitFor(() => expect(screen.getByText('Cancelled')).toBeInTheDocument())
    expect(screen.queryByText('Complete')).toBeNull()
  })
})

const DOC = '<style>\n.card { color: red; }\n</style>\n<div class="card">Hi</div>'
describe('J-H2 / J-M5: AICanvas and its model', () => {
  const ask = (q: string) => {
    fireEvent.change(screen.getByRole('textbox', { name: 'Ask for a change' }), { target: { value: q } })
    fireEvent.keyDown(screen.getByRole('textbox', { name: 'Ask for a change' }), { key: 'Enter' })
  }
  it('sends "Explain line N" to respond with the line, instead of a canned answer', async () => {
    const respond = vi.fn(async () => 'It sets the colour.')
    render(<AICanvas initial={DOC} respond={respond} />)
    ask('Explain line 2')
    await waitFor(() => expect(respond).toHaveBeenCalledWith('Explain line 2', DOC, { line: 2, lineText: '.card { color: red; }' }))
    expect(await screen.findByText('It sets the colour.')).toBeInTheDocument()
    expect(screen.queryByText(/part of the document’s/)).toBeNull()
  })
  it('offers nothing to ask without respond or explain', () => {
    render(<AICanvas initial={DOC} />)
    expect(screen.getByRole('textbox', { name: 'Ask for a change' })).toBeDisabled()
    fireEvent.click(screen.getAllByRole('button').find(b => b.dataset.line === '1')!)
    expect(screen.queryByRole('button', { name: /Ask about line/ })).toBeNull()
  })
  it('shows a failed reply with Retry and hands the error to onError', async () => {
    const err = new Error('rate limited'), onError = vi.fn()
    const respond = vi.fn().mockRejectedValueOnce(err).mockResolvedValueOnce('Done.')
    render(<AICanvas initial={DOC} respond={respond} onError={onError} />)
    ask('Make it blue')
    expect(await screen.findByText('Couldn’t get a reply.')).toBeInTheDocument()
    expect(onError).toHaveBeenCalledWith(err)
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(await screen.findByText('Done.')).toBeInTheDocument()
    expect(respond).toHaveBeenCalledTimes(2)
  })
  it('applies an edit from respond as a new version', async () => {
    render(<AICanvas initial={DOC} respond={async () => ({ reply: 'Made it blue.', code: DOC.replace('red', 'blue') })} />)
    ask('Make it blue')
    expect(await screen.findByText('Made it blue.', undefined, { timeout: 5000 })).toBeInTheDocument()
    expect(screen.getByText(/v2 of 2/)).toBeInTheDocument()
    // the shown version is the edited code, not a copy of v1
    await waitFor(() => expect(screen.getByRole('button', { name: /color: blue/ })).toBeInTheDocument())
    expect(screen.queryByRole('button', { name: /color: red/ })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Previous version' }))
    expect(screen.getByRole('button', { name: /color: red/ })).toBeInTheDocument()
  })
  it('with motion on, types the edit in as a diff and lands on the edited code', async () => {
    withMotion(); fakeTimers()
    render(<AICanvas initial={DOC} respond={async () => ({ reply: 'Made it blue.', code: DOC.replace('red', 'blue') })} />)
    ask('Make it blue')
    await tick(200)
    // mid-edit: the change is being typed in and no version is committed yet
    expect(screen.getByRole('status', { name: 'Editing untitled.html' })).toBeInTheDocument()
    expect(screen.getByText(/v1 of 1/)).toBeInTheDocument()
    for (let i = 0; i < 40 && !screen.queryByText('Made it blue.'); i++) await tick(500)
    expect(screen.getByText('Made it blue.')).toBeInTheDocument()
    expect(screen.getByText(/v2 of 2/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /color: blue/ })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /color: red/ })).toBeNull()
  })
})

/** A stand-in for HTMLAudioElement that records what was made and done. */
class FakeAudio {
  static made: FakeAudio[] = []
  src = ''; preload = ''; paused = true; currentTime = 0; duration = NaN; playbackRate = 1
  removed = false
  constructor() { FakeAudio.made.push(this) }
  addEventListener() {} removeEventListener() {}
  play() { this.paused = false; return Promise.resolve() }
  pause() { this.paused = true }
  removeAttribute(n: string) { if (n === 'src') { this.src = ''; this.removed = true } }
}

describe('J-H3: audio players follow src', () => {
  it('a new src makes a new track and releases the old one', async () => {
    FakeAudio.made = []
    vi.stubGlobal('Audio', FakeAudio)
    vi.stubGlobal('IntersectionObserver', SeenObserver)
    const { rerender } = render(<AudioPlayer src="https://x.example/a.mp3" title="A" peaks={[0.5, 0.5]} />)
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Play' })) })
    const first = FakeAudio.made.at(-1)!
    expect(first.src).toContain('a.mp3')
    rerender(<AudioPlayer src="https://x.example/b.mp3" title="B" peaks={[0.5, 0.5]} />)
    expect(first.removed).toBe(true)
    expect(first.paused).toBe(true)
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Play' })) })
    expect(FakeAudio.made.at(-1)!.src).toContain('b.mp3')
  })
})

describe('J-M15: VideoPlayer without a source', () => {
  it('says there is no video, not that the browser is at fault', () => {
    render(<VideoPlayer />)
    expect(screen.getByText('No video')).toBeInTheDocument()
    expect(screen.queryByText(/browser/)).toBeNull()
  })
})

const INBOX: InboxConversation[] = [
  { id: 'a', name: 'Ann Lo', role: 'Design', location: 'Oslo', timeZone: 'Europe/Oslo', online: true, last: '9:00', messages: [{ id: 'a1', from: 'them', text: 'Hi' }] },
  { id: 'b', name: 'Bo Ek', role: 'Eng', location: 'Lund', timeZone: 'Europe/Stockholm', online: false, last: 'Mon', messages: [{ id: 'b1', from: 'them', text: 'Yo' }] },
]
const send = (text: string) => {
  fireEvent.change(screen.getByRole('textbox', { name: 'Message' }), { target: { value: text } })
  fireEvent.click(screen.getByRole('button', { name: 'Send' }))
}

describe('J-H4 / J-M16: ChatInbox hands messages to the host and invents nothing', () => {
  it('calls onSend and adds no reply of its own', () => {
    vi.useFakeTimers()
    const onSend = vi.fn()
    render(<ChatInbox defaultConversations={INBOX} onSend={onSend} />)
    send('Lunch?')
    expect(onSend).toHaveBeenCalledWith('a', 'Lunch?')
    const log = screen.getByRole('log')
    expect(within(log).getByText('Lunch?')).toBeInTheDocument()
    act(() => { vi.advanceTimersByTime(30_000) })
    expect(log.textContent).toBe('TodayHiLunch?')
    expect(screen.queryByText('typing…')).toBeNull()
  })
  it('marks a message whose onSend rejected as not sent, with Retry', async () => {
    const onSend = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(undefined)
    render(<ChatInbox defaultConversations={INBOX} onSend={onSend} />)
    send('Lunch?')
    expect(await screen.findByText('Not sent')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    await waitFor(() => expect(screen.queryByText('Not sent')).toBeNull())
    expect(onSend).toHaveBeenCalledTimes(2)
  })
  it('controlled: the parent is authoritative, and onConversationsChange gets the new message', () => {
    const onChange = vi.fn()
    const { rerender } = render(<ChatInbox conversations={INBOX} onConversationsChange={onChange} />)
    send('Hello')
    const next = onChange.mock.calls.at(-1)![0] as InboxConversation[]
    expect(next.find(c => c.id === 'a')!.messages.at(-1)).toMatchObject({ from: 'me', text: 'Hello' })
    expect(next.find(c => c.id === 'b')!.messages).toEqual(INBOX[1].messages)
    // the parent ignored the change, so the log shows only what it was given
    expect(within(screen.getByRole('log')).queryByText('Hello')).toBeNull()
    // and a message the parent adds shows up
    const added = INBOX.map(c => c.id === 'a' ? { ...c, messages: [...c.messages, { id: 'a2', from: 'them' as const, text: 'From the host' }] } : c)
    rerender(<ChatInbox conversations={added} onConversationsChange={onChange} />)
    expect(within(screen.getByRole('log')).getByText('From the host')).toBeInTheDocument()
  })
  it('shows Call and Profile only with their handlers', () => {
    const { unmount } = render(<ChatInbox defaultConversations={INBOX} />)
    expect(screen.queryByRole('button', { name: 'Call' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Profile' })).toBeNull()
    unmount()
    const onCall = vi.fn()
    render(<ChatInbox defaultConversations={INBOX} onCall={onCall} />)
    fireEvent.click(screen.getByRole('button', { name: 'Call' }))
    expect(onCall).toHaveBeenCalledWith(INBOX[0])
    expect(screen.queryByRole('button', { name: 'Profile' })).toBeNull()
  })
})

describe('J-H5 / J-M17: AnchoredComments signs replies with `me`', () => {
  it('a reply carries your name, a real timestamp and a unique id', () => {
    const onChange = vi.fn()
    const threads: AnchoredThread[] = [{ id: 't', messages: [{ id: 'm', author: 'Kim', text: 'Hm?', time: '2 h' }] }]
    render(<AnchoredComments me="Sam Roe" doc={[['See ', { thread: 't', text: 'this' }]]} defaultThreads={threads} onChange={onChange} />)
    fireEvent.change(screen.getByRole('textbox', { name: 'Reply' }), { target: { value: 'Agreed' } })
    fireEvent.click(screen.getByRole('button', { name: 'Reply' }))
    const reply = onChange.mock.calls.at(-1)![0][0].messages.at(-1)
    expect(reply).toMatchObject({ author: 'Sam Roe', text: 'Agreed' })
    expect(typeof reply.createdAt).toBe('number')
    expect(reply.time).toBeUndefined()
    expect(reply.id).not.toBe('m')
    expect(screen.queryByText('Alex Lee')).toBeNull()
  })
})
// Type-only check (tsc -p tsconfig.test.json reads it; nothing runs): `me` is required, there is no built-in persona.
// @ts-expect-error `me` is required: there is no built-in persona to sign with
void (() => <AnchoredComments doc={[]} />)

describe('J-H6: LivePresence shows the cursors it is given', () => {
  it('renders exactly those people, and none of its own', () => {
    render(<LivePresence cursors={[{ name: 'Ann Lo', color: 'var(--c3)', x: 0.2, y: 0.3 }, { name: 'Bo Ek', color: 'var(--c4)', x: 0.5, y: 0.5 }]}><p>Doc</p></LivePresence>)
    expect(screen.getByText('2 people here')).toBeInTheDocument()
    expect(screen.getByRole('group', { name: /Ann Lo and Bo Ek editing/ })).toBeInTheDocument()
    expect(screen.getByText('Doc')).toBeInTheDocument()
    for (const fake of ['Bea Kim', 'Chris Moe', 'Dana Ng', 'Alex Lee', 'Q4 planning']) expect(screen.queryByText(new RegExp(fake))).toBeNull()
  })
  it('reports your cursor as fractions of the canvas', () => {
    const onCursorMove = vi.fn()
    render(<LivePresence cursors={[]} me={{ name: 'Me', color: 'var(--accent)' }} onCursorMove={onCursorMove} />)
    const canvas = screen.getByRole('group')
    canvas.getBoundingClientRect = () => ({ left: 0, top: 0, width: 200, height: 100, right: 200, bottom: 100, x: 0, y: 0, toJSON() {} })
    fireEvent.pointerMove(canvas, { clientX: 50, clientY: 25 })
    expect(onCursorMove).toHaveBeenCalledWith({ x: 0.25, y: 0.25 })
  })
})

const GALLERY: GalleryItem[] = [{ id: 1, src: 'https://x.example/1.jpg', title: 'Fjord', ratio: 1, category: 'Nature' }]
describe('J-H7: MasonryGallery saves only through the host', () => {
  const setup = () => {
    vi.stubGlobal('IntersectionObserver', SeenObserver)
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(600)
  }
  it('has no Save button and no toast without onSave', () => {
    setup()
    render(<UIProvider persist={false}><MasonryGallery items={GALLERY} /></UIProvider>)
    expect(screen.getByRole('button', { name: /Open Fjord/ })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Save Fjord/ })).toBeNull()
  })
  it('shows no "Saved" when the save fails', async () => {
    setup()
    render(<UIProvider persist={false}><MasonryGallery items={GALLERY} onSave={() => Promise.reject(new Error('nope'))} /></UIProvider>)
    fireEvent.click(screen.getByRole('button', { name: 'Save Fjord' }))
    expect(await screen.findByText('Couldn’t save')).toBeInTheDocument()
    expect(screen.queryByText(/Saved/)).toBeNull()
    expect(screen.getByRole('button', { name: 'Save Fjord' })).toHaveAttribute('aria-pressed', 'false')
  })
  it('flips to Saved once the host confirms', async () => {
    setup()
    const onSave = vi.fn(async () => {})
    render(<UIProvider persist={false}><MasonryGallery items={GALLERY} onSave={onSave} /></UIProvider>)
    fireEvent.click(screen.getByRole('button', { name: 'Save Fjord' }))
    expect(onSave).toHaveBeenCalledWith(GALLERY[0], true)
    await waitFor(() => expect(screen.getByRole('button', { name: 'Unsave Fjord' })).toHaveAttribute('aria-pressed', 'true'))
  })
})

describe('J-H8: run-map signatures', () => {
  const runWith = (n: number, status: 'running' | 'ok'): AgentRun => ({
    id: 'r', name: 'Run', startedAt: t0, status: 'running', events: [],
    spans: Array.from({ length: n }, (_, i) => ({ id: `s${i}`, kind: 'tool' as const, name: 'search', startMs: t0 + i, status, ...(status === 'ok' ? { endMs: t0 + i + 1 } : {}), attributes: {} })),
  })
  it('redraws a stop whose counts change to the same digits (10 running → 101 done)', () => {
    const { container, rerender } = render(<AgentTransitMap run={runWith(10, 'running')} />)
    const marks = () => [...container.querySelectorAll('svg text')].map(t => t.textContent)
    expect(marks()).toContain('10')
    rerender(<AgentTransitMap run={runWith(101, 'ok')} />)
    expect(marks()).toContain('101')
  })
})
