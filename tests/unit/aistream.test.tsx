// AI streaming (0.3): the chunk reducer, the SSE/NDJSON parser, useAiChat (stop, errors, approvals) and the
// conversation parts. Components are queried by role and accessible name only.
import { act, fireEvent, render, renderHook, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  AI_LIMITS, aiChunksOf, aiMessageText, applyAiChunk, fromAiSdkUIMessageStream, parseAiStream, toAiChunk, useAiChat,
  type AiChunk, type AiMessage, type AiToolPart,
} from '../../src/lib/aistream'
import { AssistantChat, Conversation, Message, MessageParts, Suggestions, aiNearBottom } from '../../src/lib/aichat'
import { PromptInput, StreamingText } from '../../src/lib/ai'
import { useStreamedText } from '../../src/lib/ai'

const run = (chunks: (AiChunk | string)[], start: AiMessage[] = []) => chunks.reduce(applyAiChunk, start)
const last = (ms: AiMessage[]) => ms[ms.length - 1]
const enc = new TextEncoder()
/** A byte stream that delivers `parts` as separate reads. */
const bytes = (parts: (string | Uint8Array)[]) => new ReadableStream<Uint8Array>({
  start(c) { parts.forEach(p => c.enqueue(typeof p === 'string' ? enc.encode(p) : p)); c.close() },
})
const collect = async <T,>(it: AsyncIterable<T>) => { const out: T[] = []; for await (const x of it) out.push(x); return out }
const user = (text: string, id = 'u1'): AiMessage => ({ id, role: 'user', status: 'done', parts: [{ type: 'text', text }] })

describe('applyAiChunk (reducer)', () => {
  it('opens an assistant message and appends text deltas into one part', () => {
    const before = [user('hi')]
    const ms = run(['Hel', { type: 'text-delta', delta: 'lo ' }, { type: 'text-delta', delta: 'world' }], before)
    expect(ms).toHaveLength(2)
    expect(before).toHaveLength(1) // never mutated
    expect(last(ms)).toMatchObject({ role: 'assistant', status: 'streaming', parts: [{ type: 'text', text: 'Hello world', state: 'streaming' }] })
    expect(aiMessageText(last(ms))).toBe('Hello world')
  })

  it('start uses the given id and does not duplicate an open message', () => {
    const ms = run([{ type: 'start', messageId: 'm1' }, { type: 'start' }, { type: 'text-delta', delta: 'x' }])
    expect(ms).toHaveLength(1)
    expect(ms[0].id).toBe('m1')
  })

  it('reasoning deltas, reasoning-end and text-end settle the parts', () => {
    const ms = run([{ type: 'reasoning-delta', delta: 'think ' }, { type: 'reasoning-delta', delta: 'hard' }, { type: 'reasoning-end' }, { type: 'text-delta', delta: 'ok' }, { type: 'text-end' }])
    expect(last(ms).parts).toEqual([{ type: 'reasoning', text: 'think hard', state: 'done' }, { type: 'text', text: 'ok', state: 'done' }])
  })

  it('a tool call in between starts a new text part afterwards', () => {
    const ms = run(['before', { type: 'tool-start', id: 't1', name: 'search' }, 'after'])
    expect(last(ms).parts.map(p => p.type)).toEqual(['text', 'tool', 'text'])
  })

  it('tool lifecycle: start, streamed args, result', () => {
    let ms = run([{ type: 'tool-start', id: 't1', name: 'weather' }])
    expect(last(ms).parts[0]).toMatchObject({ type: 'tool', id: 't1', name: 'weather', state: 'pending' })
    ms = run([{ type: 'tool-args-delta', id: 't1', delta: '{"city":' }], ms)
    expect((last(ms).parts[0] as AiToolPart).args).toBeUndefined() // partial JSON is kept as text only
    expect((last(ms).parts[0] as AiToolPart).argsText).toBe('{"city":')
    ms = run([{ type: 'tool-args-delta', id: 't1', delta: '"Oslo"}' }], ms)
    expect((last(ms).parts[0] as AiToolPart).args).toEqual({ city: 'Oslo' })
    ms = run([{ type: 'tool-args', id: 't1', args: { city: 'Oslo' } }], ms)
    expect(last(ms).parts[0]).toMatchObject({ state: 'running', args: { city: 'Oslo' } })
    ms = run([{ type: 'tool-result', id: 't1', result: { temp: 4 } }], ms)
    expect(last(ms).parts[0]).toMatchObject({ state: 'done', result: { temp: 4 } })
  })

  it('tool errors and approval requests', () => {
    const err = run([{ type: 'tool-start', id: 't', name: 'x' }, { type: 'tool-error', id: 't', error: 'boom' }])
    expect(last(err).parts[0]).toMatchObject({ state: 'error', error: 'boom' })
    const ask = run([{ type: 'tool-start', id: 'a', name: 'mail.send', needsApproval: { summary: 'Send it' } }])
    expect(last(ask).parts[0]).toMatchObject({ state: 'awaiting-approval', approval: { summary: 'Send it' } })
    const ask2 = run([{ type: 'tool-start', id: 'b', name: 'x' }, { type: 'tool-approval', id: 'b', summary: 'Do it' }])
    expect(last(ask2).parts[0]).toMatchObject({ state: 'awaiting-approval', approval: { summary: 'Do it' } })
  })

  it('a denied tool never takes a result', () => {
    const denied: AiMessage = { id: 'a', role: 'assistant', status: 'streaming', parts: [{ type: 'tool', id: 't', name: 'x', state: 'error', approval: { approved: false } }] }
    const ms = run([{ type: 'tool-result', id: 't', result: 'ran anyway' }], [denied])
    expect(last(ms).parts[0]).not.toHaveProperty('result')
  })

  it('sources (deduplicated), files and data (same id replaces)', () => {
    const ms = run([
      { type: 'source', url: 'https://a.example', title: 'A' }, { type: 'source', url: 'https://a.example', title: 'A again' },
      { type: 'file', url: 'https://x.example/p.png', mediaType: 'image/png', name: 'p.png' },
      { type: 'data', name: 'chart', id: 'c1', data: { v: 1 } }, { type: 'data', name: 'chart', id: 'c1', data: { v: 2 } },
    ])
    expect(last(ms).parts).toEqual([
      { type: 'source', url: 'https://a.example', title: 'A' },
      { type: 'file', url: 'https://x.example/p.png', mediaType: 'image/png', name: 'p.png' },
      { type: 'data', name: 'chart', id: 'c1', data: { v: 2 } },
    ])
  })

  it('finish settles streaming parts; error adds an error part', () => {
    const done = run(['a', { type: 'finish' }])
    expect(last(done)).toMatchObject({ status: 'done', parts: [{ state: 'done' }] })
    const failed = run(['a', { type: 'error', message: 'rate limited' }])
    expect(last(failed).status).toBe('error')
    expect(last(failed).parts[1]).toEqual({ type: 'error', message: 'rate limited' })
    // after finish, the next delta opens a new message
    expect(run(['b'], done)).toHaveLength(2)
  })

  it('ignores unknown chunks and caps text', () => {
    const ms = run(['x'])
    expect(applyAiChunk(ms, { type: 'nope' } as unknown as AiChunk)).toBe(ms)
    const big = run(['a'.repeat(AI_LIMITS.partChars), 'more'])
    expect((last(big).parts[0] as { text: string }).text).toHaveLength(AI_LIMITS.partChars)
  })
})

describe('toAiChunk (AI SDK UI message stream mapping)', () => {
  it('maps AI SDK event names', () => {
    expect(toAiChunk({ type: 'text-delta', id: '0', delta: 'hi' })).toEqual({ type: 'text-delta', id: '0', delta: 'hi' })
    expect(toAiChunk({ type: 'tool-input-start', toolCallId: 'c', toolName: 'get' })).toEqual({ type: 'tool-start', id: 'c', name: 'get' })
    expect(toAiChunk({ type: 'tool-input-delta', toolCallId: 'c', inputTextDelta: '{' })).toEqual({ type: 'tool-args-delta', id: 'c', delta: '{' })
    expect(toAiChunk({ type: 'tool-input-available', toolCallId: 'c', toolName: 'get', input: { a: 1 } })).toEqual({ type: 'tool-args', id: 'c', args: { a: 1 }, name: 'get' })
    expect(toAiChunk({ type: 'tool-output-available', toolCallId: 'c', output: 2 })).toEqual({ type: 'tool-result', id: 'c', result: 2 })
    expect(toAiChunk({ type: 'tool-output-error', toolCallId: 'c', errorText: 'bad' })).toEqual({ type: 'tool-error', id: 'c', error: 'bad' })
    expect(toAiChunk({ type: 'tool-approval-request', toolCallId: 'c', approvalId: 'x' })).toEqual({ type: 'tool-approval', id: 'c' })
    expect(toAiChunk({ type: 'source-url', sourceId: 's', url: 'https://a', title: 'A' })).toEqual({ type: 'source', url: 'https://a', title: 'A', id: 's' })
    expect(toAiChunk({ type: 'data-weather', id: 'w', data: { t: 1 } })).toEqual({ type: 'data', name: 'weather', id: 'w', data: { t: 1 } })
    expect(toAiChunk({ type: 'error', errorText: 'oops' })).toEqual({ type: 'error', message: 'oops' })
    expect(toAiChunk({ type: 'abort' })).toEqual({ type: 'abort' })
    expect(toAiChunk({ type: 'start-step' })).toBeNull()
    expect(toAiChunk('plain')).toEqual({ type: 'text-delta', delta: 'plain' })
    expect(toAiChunk(42)).toBeNull()
  })
})

describe('parseAiStream', () => {
  it('parses SSE split across reads, including inside a UTF-8 character', async () => {
    const event = 'data: {"type":"text-delta","delta":"héllo ✓"}\n\n'
    const b = enc.encode(event + 'data: {"type":"finish"}\n\ndata: [DONE]\n\ndata: {"type":"text-delta","delta":"after done"}\n\n')
    const cut = event.indexOf('é') + 1 // the middle of the two-byte é
    const out = await collect(parseAiStream(bytes([b.slice(0, 7), b.slice(7, cut), b.slice(cut, cut + 5), b.slice(cut + 5)])))
    expect(out).toEqual([{ type: 'text-delta', delta: 'héllo ✓' }, { type: 'finish' }])
  })

  it('handles CRLF, comments, event: lines and multi-line data', async () => {
    const out = await collect(parseAiStream(bytes([': keep-alive\r\nevent: message\r\ndata: {"type":"text-delta",\r\ndata: "delta":"a"}\r\n\r\n'])))
    expect(out).toEqual([{ type: 'text-delta', delta: 'a' }])
  })

  it('skips malformed SSE events and reports them', async () => {
    const bad = vi.fn()
    const out = await collect(parseAiStream(bytes(['data: {not json\n\n', 'data: {"type":"text-delta","delta":"ok"}\n\n']), { onMalformed: bad }))
    expect(out).toEqual([{ type: 'text-delta', delta: 'ok' }])
    expect(bad).toHaveBeenCalledWith('{not json')
  })

  it('parses NDJSON with lines split across reads and a final line without newline', async () => {
    const bad = vi.fn()
    const out = await collect(parseAiStream(bytes(['{"type":"text-del', 'ta","delta":"a"}\n', 'garbage\n\n', '{"type":"reasoning-delta","delta":"b"}']), { onMalformed: bad }))
    expect(out).toEqual([{ type: 'text-delta', delta: 'a' }, { type: 'reasoning-delta', delta: 'b' }])
    expect(bad).toHaveBeenCalledTimes(1)
  })

  it('drops a line over the size cap', async () => {
    const huge = '{"type":"text-delta","delta":"' + 'x'.repeat(AI_LIMITS.lineChars + 10) + '"}\n'
    const bad = vi.fn()
    const out = await collect(parseAiStream(bytes([huge, '{"type":"finish"}\n']), { format: 'ndjson', onMalformed: bad }))
    expect(out).toEqual([{ type: 'finish' }])
    expect(bad).toHaveBeenCalled()
  })

  it('reads an AI SDK Response and rejects a failed one', async () => {
    const res = new Response(bytes(['data: {"type":"start","messageId":"m"}\n\ndata: {"type":"text-delta","id":"0","delta":"Hi"}\n\ndata: [DONE]\n\n']))
    expect(await collect(fromAiSdkUIMessageStream(res))).toEqual([{ type: 'start', messageId: 'm' }, { type: 'text-delta', id: '0', delta: 'Hi' }])
    expect(() => fromAiSdkUIMessageStream(new Response('nope', { status: 500 }))).toThrow(/500/)
  })

  it('aiChunksOf accepts object streams, byte streams, strings and async iterables', async () => {
    const objs = new ReadableStream<AiChunk>({ start(c) { c.enqueue({ type: 'text-delta', delta: 'a' }); c.close() } })
    expect(await collect(aiChunksOf(objs))).toEqual([{ type: 'text-delta', delta: 'a' }])
    expect(await collect(aiChunksOf(bytes(['{"type":"text-delta","delta":"b"}\n'])))).toEqual([{ type: 'text-delta', delta: 'b' }])
    async function* gen() { yield 'c'; yield { type: 'finish' } as AiChunk }
    expect(await collect(aiChunksOf(Promise.resolve(gen())))).toEqual([{ type: 'text-delta', delta: 'c' }, { type: 'finish' }])
  })
})

/** An async generator `send` that waits for `release()` between chunks, and records the abort signal. */
function gatedSend(chunks: (AiChunk | string)[], { failAt }: { failAt?: number } = {}) {
  const calls: { messages: AiMessage[]; signal: AbortSignal }[] = []
  let credits = 0, open: (() => void) | null = null
  const release = () => { if (open) { const o = open; open = null; o() } else credits++ }
  const send = vi.fn((messages: AiMessage[], { signal }: { signal: AbortSignal }) => {
    calls.push({ messages, signal })
    return (async function* () {
      for (let i = 0; i < chunks.length; i++) {
        if (credits > 0) credits--
        else await new Promise<void>((res, rej) => { open = res; signal.addEventListener('abort', () => rej(new DOMException('Aborted', 'AbortError')), { once: true }) })
        if (failAt === i) throw new Error('provider down')
        yield chunks[i]
      }
    })()
  })
  return { send, calls, release }
}

describe('useAiChat', () => {
  it('submits, streams and finishes', async () => {
    async function* send() { yield 'Hello'; yield { type: 'text-delta', delta: ' there' } as AiChunk; yield { type: 'finish' } as AiChunk }
    const onFinish = vi.fn()
    const { result } = renderHook(() => useAiChat({ send, onFinish }))
    act(() => { result.current.submit('hi') })
    expect(result.current.messages[0]).toMatchObject({ role: 'user', parts: [{ type: 'text', text: 'hi' }] })
    await waitFor(() => expect(result.current.status).toBe('ready'))
    expect(aiMessageText(result.current.messages[1])).toBe('Hello there')
    expect(result.current.messages[1].status).toBe('done')
    expect(onFinish).toHaveBeenCalledTimes(1)
  })

  it('ignores empty submits and submits while busy', async () => {
    const g = gatedSend(['a'])
    const { result } = renderHook(() => useAiChat({ send: g.send }))
    let ok = true
    act(() => { ok = result.current.submit('   ') })
    expect(ok).toBe(false)
    act(() => { result.current.submit('one') })
    act(() => { ok = result.current.submit('two') })
    expect(ok).toBe(false)
    expect(g.send).toHaveBeenCalledTimes(1)
  })

  it('stop aborts the request and keeps what arrived, marked stopped', async () => {
    const g = gatedSend(['par', 'tial', ' never'])
    const { result } = renderHook(() => useAiChat({ send: g.send }))
    act(() => { result.current.submit('go') })
    await act(async () => { g.release() })
    await waitFor(() => expect(result.current.status).toBe('streaming'))
    await act(async () => { g.release() })
    await waitFor(() => expect(aiMessageText(result.current.messages[1])).toBe('partial'))
    act(() => { result.current.stop() })
    expect(g.calls[0].signal.aborted).toBe(true)
    expect(result.current.status).toBe('ready')
    expect(result.current.messages[1]).toMatchObject({ stopped: true, status: 'done' })
    expect(aiMessageText(result.current.messages[1])).toBe('partial')
  })

  it('turns a thrown error into an error part, and regenerate retries', async () => {
    const onError = vi.fn()
    let fail = true
    const send = vi.fn(async function* (_messages: AiMessage[]) { yield 'Hal'; if (fail) throw new Error('provider down'); yield 'lo' })
    const { result } = renderHook(() => useAiChat({ send, onError }))
    act(() => { result.current.submit('hi') })
    await waitFor(() => expect(result.current.status).toBe('error'))
    expect(result.current.messages[1].parts).toContainEqual({ type: 'error', message: 'provider down' })
    expect(onError).toHaveBeenCalled()
    fail = false
    act(() => { result.current.regenerate() })
    await waitFor(() => expect(result.current.status).toBe('ready'))
    expect(result.current.messages).toHaveLength(2)
    expect(aiMessageText(result.current.messages[1])).toBe('Hallo')
    expect(send).toHaveBeenCalledTimes(2)
    expect(send.mock.calls[1][0]).toHaveLength(1) // the failed reply is not sent back
  })

  it('an error chunk from the stream also ends in the error state', async () => {
    async function* send() { yield { type: 'error', message: 'quota' } as AiChunk; yield 'not shown' }
    const { result } = renderHook(() => useAiChat({ send }))
    act(() => { result.current.submit('hi') })
    await waitFor(() => expect(result.current.status).toBe('error'))
    expect(aiMessageText(result.current.messages[1])).toBe('')
  })

  it('does not run a tool before approval, then runs it and continues the same message', async () => {
    const host = vi.fn(async (_t: AiToolPart, ok: boolean) => ok ? { sent: true } : undefined)
    const send = vi.fn(async function* (messages: AiMessage[]) {
      if (last(messages).role === 'assistant') { yield 'Sent.'; return }
      yield { type: 'tool-start', id: 'c1', name: 'mail.send', args: { to: 'sam' }, needsApproval: true } as AiChunk
      yield { type: 'finish' } as AiChunk
    })
    const { result } = renderHook(() => useAiChat({ send, onApprovalRequest: host }))
    act(() => { result.current.submit('email sam') })
    await waitFor(() => expect(result.current.status).toBe('ready'))
    expect(result.current.messages[1].parts[0]).toMatchObject({ state: 'awaiting-approval' })
    expect(host).not.toHaveBeenCalled()
    await act(async () => { await result.current.decideTool('c1', true) })
    expect(host).toHaveBeenCalledWith(expect.objectContaining({ id: 'c1', name: 'mail.send' }), true)
    await waitFor(() => expect(result.current.status).toBe('ready'))
    expect(result.current.messages).toHaveLength(2)
    expect(result.current.messages[1].parts[0]).toMatchObject({ state: 'done', result: { sent: true }, approval: { approved: true } })
    expect(aiMessageText(result.current.messages[1])).toBe('Sent.')
  })

  it('deny tells the host, records it, and never shows a result', async () => {
    const host = vi.fn(async () => undefined)
    const send = vi.fn(async function* (messages: AiMessage[]) {
      if (last(messages).role === 'assistant') { yield 'Okay, not sending.'; return }
      yield { type: 'tool-start', id: 'c1', name: 'mail.send', needsApproval: true } as AiChunk
    })
    const { result } = renderHook(() => useAiChat({ send, onApprovalRequest: host }))
    act(() => { result.current.submit('email sam') })
    await waitFor(() => expect(result.current.messages[1]?.parts[0]).toMatchObject({ state: 'awaiting-approval' }))
    await waitFor(() => expect(result.current.status).toBe('ready'))
    await act(async () => { await result.current.decideTool('c1', false) })
    expect(host).toHaveBeenCalledWith(expect.anything(), false)
    await waitFor(() => expect(result.current.status).toBe('ready'))
    const tool = result.current.messages[1].parts[0] as AiToolPart
    expect(tool).toMatchObject({ state: 'denied', approval: { approved: false } })
    expect(tool.result).toBeUndefined()
    // a second decision is ignored
    await act(async () => { await result.current.decideTool('c1', true) })
    expect(host).toHaveBeenCalledTimes(1)
  })

  it('creates object URLs for attachments and revokes them when the messages go away', async () => {
    const create = vi.fn(() => 'blob:mock/1'), revoke = vi.fn()
    Object.assign(URL, { createObjectURL: create, revokeObjectURL: revoke })
    async function* send() { yield 'ok' }
    const { result, unmount } = renderHook(() => useAiChat({ send }))
    act(() => { result.current.submit('see file', [new File(['x'], 'a.png', { type: 'image/png' })]) })
    expect(result.current.messages[0].parts[0]).toMatchObject({ type: 'file', name: 'a.png', mediaType: 'image/png', url: 'blob:mock/1' })
    await waitFor(() => expect(result.current.status).toBe('ready'))
    act(() => { result.current.setMessages([]) })
    expect(revoke).toHaveBeenCalledWith('blob:mock/1')
    unmount()
  })
})

describe('useStreamedText / StreamingText', () => {
  it('replays a finished string, and continues an appended one without restarting', () => {
    vi.useFakeTimers()
    const mm = window.matchMedia
    window.matchMedia = ((q: string) => ({ ...mm(q), matches: false })) as typeof window.matchMedia // motion on
    try {
      const { result, rerender } = renderHook(({ t, live }) => useStreamedText(t, { cps: 600, live }), { initialProps: { t: 'Hello world', live: true } })
      expect(result.current.text).toBe('')
      act(() => { vi.advanceTimersByTime(40) })
      const before = result.current.shown
      expect(before).toBeGreaterThan(0)
      rerender({ t: 'Hello world, and more', live: true }) // append-only: keeps its place
      expect(result.current.shown).toBe(before)
      for (let i = 0; i < 200; i++) act(() => { vi.advanceTimersByTime(10) })
      expect(result.current.text).toBe('Hello world, and more')
      expect(result.current.done).toBe(false) // live: not done until live is false
      rerender({ t: 'Hello world, and more', live: false })
      expect(result.current.done).toBe(true)
      rerender({ t: 'Something else', live: false }) // not an append: replays from the start
      expect(result.current.shown).toBe(0)
    } finally { window.matchMedia = mm }
  })

  it('word mode keeps going when a tick is skipped (the uneven rhythm never stalls it)', () => {
    vi.useFakeTimers()
    const mm = window.matchMedia
    window.matchMedia = ((q: string) => ({ ...mm(q), matches: false })) as typeof window.matchMedia
    let k = 0
    vi.spyOn(Math, 'random').mockImplementation(() => (k++ % 2 ? 0.9 : 0.1)) // every other tick is a skip
    try {
      const done = vi.fn()
      render(<StreamingText text="one two three four" wordDelay={10} onDone={done} />)
      for (let i = 0; i < 40; i++) act(() => { vi.advanceTimersByTime(10) })
      expect(done).toHaveBeenCalledWith('one two three four')
    } finally { window.matchMedia = mm }
  })

  it('StreamingText shows everything at once under reduced motion and reports it', () => {
    const done = vi.fn()
    render(<StreamingText text="All at once" onDone={done} />)
    expect(screen.getByText('All at once')).toBeInTheDocument()
    expect(done).toHaveBeenCalledWith('All at once')
  })
})

/** Gives a scroller fake layout numbers (jsdom has none). */
function fakeScroll(el: HTMLElement, { height = 100, content = 1000 } = {}) {
  let top = 0
  Object.defineProperty(el, 'clientHeight', { configurable: true, get: () => height })
  Object.defineProperty(el, 'scrollHeight', { configurable: true, get: () => content })
  Object.defineProperty(el, 'scrollTop', { configurable: true, get: () => top, set: v => { top = Math.max(0, Math.min(content - height, v)) } })
  el.scrollTo = ((o: ScrollToOptions) => { top = Math.max(0, Math.min(content - height, o.top ?? 0)); el.dispatchEvent(new Event('scroll')) }) as typeof el.scrollTo
  return { setContent: (c: number) => { content = c }, get top() { return top } }
}

describe('Conversation (stays pinned to the bottom)', () => {
  it('aiNearBottom', () => {
    expect(aiNearBottom({ scrollTop: 900, scrollHeight: 1000, clientHeight: 100 })).toBe(true)
    expect(aiNearBottom({ scrollTop: 500, scrollHeight: 1000, clientHeight: 100 })).toBe(false)
  })

  it('follows new content, stops when scrolled up, and Jump to latest pins it again', async () => {
    const { rerender } = render(<Conversation><p>one</p></Conversation>)
    const log = screen.getByRole('log', { name: 'Conversation' })
    const s = fakeScroll(log)
    rerender(<Conversation><p>one</p><p>two</p></Conversation>)
    expect(s.top).toBe(900) // pinned: scrolled to the end after the render
    expect(screen.queryByRole('button', { name: 'Jump to latest' })).toBeNull()
    // the person scrolls up
    fireEvent.wheel(log, { deltaY: -100 })
    log.scrollTop = 300; fireEvent.scroll(log)
    const jump = await screen.findByRole('button', { name: 'Jump to latest' })
    s.setContent(1400)
    rerender(<Conversation><p>one</p><p>two</p><p>three</p></Conversation>)
    expect(s.top).toBe(300) // not yanked down while reading
    fireEvent.click(jump)
    expect(s.top).toBe(1300)
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Jump to latest' })).toBeNull())
    s.setContent(1600)
    rerender(<Conversation><p>one</p><p>two</p><p>three</p><p>four</p></Conversation>)
    expect(s.top).toBe(1500)
  })
})

describe('parts and inputs', () => {
  it('Suggestions call onPick', async () => {
    const pick = vi.fn()
    render(<Suggestions items={['Plan the week', 'Draft a reply']} onPick={pick} />)
    await userEvent.click(within(screen.getByRole('group', { name: 'Suggestions' })).getByRole('button', { name: 'Draft a reply' }))
    expect(pick).toHaveBeenCalledWith('Draft a reply')
  })

  it('MessageParts renders text, a tool card with approval, sources and an error with Retry', async () => {
    const decide = vi.fn(), retry = vi.fn()
    const m: AiMessage = { id: 'a', role: 'assistant', status: 'done', parts: [
      { type: 'text', text: 'Answer text' },
      { type: 'tool', id: 't1', name: 'calendar.create', state: 'awaiting-approval', args: { title: '<b>Review</b>' }, approval: { summary: 'Create the event' } },
      { type: 'source', url: 'javascript:alert(1)', title: 'Sneaky' },
      { type: 'error', message: 'Rate limited' },
    ] }
    render(<MessageParts message={m} onDecideTool={decide} onRetry={retry} />)
    expect(screen.getByText('Answer text')).toBeInTheDocument()
    const card = screen.getByRole('group', { name: 'Approval needed' })
    expect(within(card).getByText('Create the event')).toBeInTheDocument()
    expect(within(card).getByText('<b>Review</b>')).toBeInTheDocument() // args are data, not markup
    expect(document.querySelector('b')?.textContent).not.toBe('Review')
    expect(screen.getByRole('link', { name: /Sneaky/ })).toHaveAttribute('href', '#') // unsafe source URL neutralised
    expect(within(card).getByRole('button', { name: 'Approve' })).toBeDisabled() // armed after 500 ms
    await waitFor(() => expect(within(card).getByRole('button', { name: 'Approve' })).toBeEnabled(), { timeout: 2000 })
    await userEvent.click(within(card).getByRole('button', { name: 'Approve' }))
    expect(decide).toHaveBeenCalledWith('t1', true)
    expect(screen.getByRole('alert')).toHaveTextContent('Rate limited')
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(retry).toHaveBeenCalled()
  })

  it('Message shows user text as plain text', () => {
    render(<Message message={user('<img src=x onerror=alert(1)> **not bold**')} />)
    expect(screen.getByText('<img src=x onerror=alert(1)> **not bold**')).toBeInTheDocument()
    expect(document.querySelector('img')).toBeNull()
  })

  it('PromptInput: Enter sends text and files, Shift+Enter does not, Stop while streaming', async () => {
    const create = vi.fn(() => 'blob:mock/p'), revoke = vi.fn()
    Object.assign(URL, { createObjectURL: create, revokeObjectURL: revoke })
    const submit = vi.fn(), stop = vi.fn()
    const { rerender, container } = render(<PromptInput onSubmit={submit} onStop={stop} />)
    const box = screen.getByRole('textbox', { name: 'Message' })
    const input = container.querySelector('input[type=file]') as HTMLInputElement
    await userEvent.upload(input, new File(['x'], 'shot.png', { type: 'image/png' }))
    expect(screen.getByRole('button', { name: 'Remove shot.png' })).toBeInTheDocument()
    await userEvent.type(box, 'hello{Shift>}{Enter}{/Shift}there')
    expect(submit).not.toHaveBeenCalled()
    await userEvent.type(box, '{Enter}')
    expect(submit).toHaveBeenCalledWith('hello\nthere', [expect.objectContaining({ name: 'shot.png' })])
    expect(box).toHaveValue('')
    expect(revoke).toHaveBeenCalledWith('blob:mock/p') // the preview URL is released once sent
    rerender(<PromptInput onSubmit={submit} onStop={stop} status="streaming" />)
    await userEvent.click(screen.getByRole('button', { name: 'Stop' }))
    expect(stop).toHaveBeenCalled()
  })

  it('PromptInput rejects files over the size cap', async () => {
    const reject = vi.fn()
    const { container } = render(<PromptInput onSubmit={() => {}} maxFileSize={2} onReject={reject} />)
    await userEvent.upload(container.querySelector('input[type=file]') as HTMLInputElement, new File(['too big'], 'big.txt', { type: 'text/plain' }))
    expect(reject).toHaveBeenCalledWith([expect.objectContaining({ name: 'big.txt' })], 'size')
    expect(screen.queryByRole('button', { name: 'Remove big.txt' })).toBeNull()
  })
})

describe('AssistantChat with useAiChat', () => {
  function Live({ send }: { send: Parameters<typeof useAiChat>[0]['send'] }) {
    const chat = useAiChat({ send })
    return <AssistantChat chat={chat} starters={['Say hi']} />
  }

  it('submits typed text, streams the answer, and offers Regenerate', async () => {
    async function* send() { yield 'Hi **there**'; yield { type: 'finish' } as AiChunk }
    render(<Live send={send} />)
    await userEvent.type(screen.getByRole('combobox', { name: 'Message' }), 'Hello{Enter}')
    expect(await screen.findByText('Hello')).toBeInTheDocument()
    await waitFor(() => expect(screen.getByRole('log')).toHaveTextContent('Hi'))
    expect(await screen.findByRole('button', { name: 'Regenerate' })).toBeInTheDocument()
  })

  it('starter suggestions submit, and Stop aborts the stream', async () => {
    const g = gatedSend(['first', ' second'])
    render(<Live send={g.send} />)
    await userEvent.click(screen.getByRole('button', { name: 'Say hi' }))
    expect(g.send).toHaveBeenCalledTimes(1)
    await act(async () => { g.release() })
    await waitFor(() => expect(screen.getByRole('log')).toHaveTextContent('first'))
    await userEvent.click(screen.getByRole('button', { name: 'Stop' }))
    expect(g.calls[0].signal.aborted).toBe(true)
    expect(await screen.findByRole('button', { name: 'Retry' })).toBeInTheDocument()
    expect(screen.getByRole('log')).toHaveTextContent('Stopped')
  })

  it('still works with the scripted respond prop', async () => {
    render(<AssistantChat respond={() => ({ versions: ['Scripted answer'] })} defaultTurns={['Old question']} />)
    expect(screen.getByText('Old question')).toBeInTheDocument()
    expect(screen.getByText('Scripted answer')).toBeInTheDocument()
  })
})

describe('Conversation (virtualised past 60 messages)', () => {
  // a ResizeObserver driven by hand, so items can "grow" as a streaming message would
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
        .map(el => ({ target: el, borderBoxSize: [{ blockSize: sizes[Number(el.getAttribute('data-index'))], inlineSize: 300 }], contentRect: { height: sizes[Number(el.getAttribute('data-index'))], width: 300 } }))
      if (entries.length) o.cb(entries as unknown as ResizeObserverEntry[], o as unknown as ResizeObserver)
    }
  })
  const ids = (from: number, to: number) => Array.from({ length: to - from }, (_, i) => `m${from + i}`)
  const Log = ({ list, last = '' }: { list: string[]; last?: string }) => <Conversation>{list.map((id, i) => <p key={id}>{id}{i === list.length - 1 ? last : ''}</p>)}</Conversation>
  /** jsdom has no layout: the scroller is as tall as the virtualizer's assumed viewport, its content as tall as the list. */
  let tail = 0 // height of the last (streaming) message, which sits below the virtual window
  const layout = (log: HTMLElement) => {
    Object.defineProperty(log, 'clientHeight', { configurable: true, get: () => 600 })
    Object.defineProperty(log, 'scrollHeight', { configurable: true, get: () => (parseFloat(log.querySelector<HTMLElement>('[data-virtual]')?.style.paddingTop ?? '') || 0) + tail })
    let top = log.scrollTop // a browser clamps scrollTop and fires scroll when it changes
    Object.defineProperty(log, 'scrollTop', { configurable: true, get: () => top, set: (t: number) => {
      const next = Math.max(0, Math.min(log.scrollHeight - 600, t)); if (next !== top) { top = next; log.dispatchEvent(new Event('scroll')) } } })
    log.scrollTop = 1e9
    log.scrollTo = ((o: ScrollToOptions) => { log.scrollTop = o.top ?? 0; log.dispatchEvent(new Event('scroll')) }) as typeof log.scrollTo // smooth scrolls land at once
  }
  const max = (log: HTMLElement) => log.scrollHeight - log.clientHeight

  beforeEach(() => { tail = 0 })
  it('renders only the messages in view, pinned to the bottom while the last one grows', () => {
    const { rerender } = render(<Log list={ids(0, 100)} />)
    const log = screen.getByRole('log'); act(() => layout(log))
    expect(screen.queryByText('m0')).toBeNull()
    expect(screen.getByText('m99')).toBeInTheDocument()
    expect(log.querySelectorAll('[data-index]').length).toBeLessThan(20)
    expect(log.scrollTop).toBe(max(log))
    resize({ 97: 300 }) // an older message is measured taller than estimated
    tail = 400; rerender(<Log list={ids(0, 100)} last=" and a long streamed answer" />) // the reply grows
    expect(log.scrollTop).toBe(max(log))
    tail = 900; rerender(<Log list={ids(0, 100)} last=" and a long streamed answer that keeps going" />)
    expect(log.scrollTop).toBe(max(log))
    rerender(<Log list={ids(0, 101)} />) // a new message arrives
    expect(screen.getByText('m100')).toBeInTheDocument()
    expect(screen.getByText(/^m99/)).toBeInTheDocument()
    expect(log.scrollTop).toBe(max(log))
    expect(screen.queryByRole('button', { name: 'Jump to latest' })).toBeNull()
  })

  it('keeps the reader’s place when older messages are prepended, and Jump to latest returns to the end', async () => {
    const { rerender } = render(<Log list={ids(10, 110)} />)
    const log = screen.getByRole('log'); act(() => layout(log))
    act(() => { fireEvent.wheel(log, { deltaY: -100 }); log.scrollTop = 2400; fireEvent.scroll(log) }) // reading m30 (20 × 120 px down)
    const jump = await screen.findByRole('button', { name: 'Jump to latest' })
    rerender(<Log list={ids(0, 110)} />) // 10 older messages load above
    expect(log.scrollTop).toBe(2400 + 10 * 120)
    expect(screen.getByText('m30')).toBeInTheDocument()
    rerender(<Log list={ids(0, 111)} />) // a new reply below doesn't pull the reader down
    expect(log.scrollTop).toBe(3600)
    fireEvent.click(jump)
    expect(log.scrollTop).toBe(max(log))
    expect(screen.getByText('m110')).toBeInTheDocument()
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Jump to latest' })).toBeNull())
  })

  it('short conversations are not virtualised', () => {
    render(<Log list={ids(0, 60)} />)
    expect(screen.getByText('m0')).toBeInTheDocument()
    expect(screen.getByRole('log').querySelector('[data-index]')).toBeNull()
  })
})
