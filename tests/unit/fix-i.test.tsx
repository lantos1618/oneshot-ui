// Package I fixes: honest stream endings, no fake "Sent" / "Vote recorded", AgentComposer's log and failures,
// VoiceInput, tool states, the slash popup and PermissionRequest's Deny.
import { act, fireEvent, render, renderHook, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { aiChunksOf, applyAiChunk, useAiChat, type AiChat, type AiChunk, type AiMessage, type AiToolPart } from '../../src/lib/aistream'
import * as aichat from '../../src/lib/aichat'
import { AgentComposer, AssistantChat, ToolCard } from '../../src/lib/aichat'
import { ModelComparison, PermissionRequest, VoiceInput } from '../../src/lib/ai'
import { ToastProvider } from '../../src/lib/feedback'

const enc = new TextEncoder()
const bytes = (parts: string[]) => new ReadableStream<Uint8Array>({ start(c) { parts.forEach(p => c.enqueue(enc.encode(p))); c.close() } })
const collect = async <T,>(it: AsyncIterable<T>) => { const out: T[] = []; for await (const x of it) out.push(x); return out }
const lastMsg = (ms: AiMessage[]) => ms[ms.length - 1]

describe('I-H1: a stream that fails never ends as a silent success', () => {
  it('zero chunks and only malformed lines (an HTML error page) is an error, and each line is reported', async () => {
    const onError = vi.fn(), onMalformed = vi.fn()
    const send = () => new Response(bytes(['<!doctype html>\n<h1>Bad gateway</h1>\n']))
    const { result } = renderHook(() => useAiChat({ send, onError, onMalformed }))
    act(() => { result.current.submit('hi') })
    await waitFor(() => expect(result.current.status).toBe('error'))
    expect(lastMsg(result.current.messages)).toMatchObject({ role: 'assistant', status: 'error' })
    expect(lastMsg(result.current.messages).parts).toContainEqual({ type: 'error', message: 'The reply could not be read.' })
    expect(onError).toHaveBeenCalledTimes(1)
    expect(onMalformed).toHaveBeenCalledWith('<!doctype html>')
  })

  it('an NDJSON Response is parsed (not forced to SSE)', async () => {
    const res = new Response(bytes(['{"type":"text-delta","delta":"a"}\n{"type":"finish"}\n']))
    const it = aiChunksOf(res)
    expect(await collect(it)).toEqual([{ type: 'text-delta', delta: 'a' }, { type: 'finish' }])
    const again = aiChunksOf(new Response(bytes(['{"type":"text-delta","delta":"b"}\n{"type":"finish"}\n'])))
    let r = await again.next(); while (!r.done) r = await again.next()
    expect(r.value).toMatchObject({ status: 'ok', chunks: 2, malformed: 0 })
  })

  it('a byte stream that stops before its terminator is truncated and calls onError', async () => {
    const onError = vi.fn(), onFinish = vi.fn()
    const send = () => bytes(['data: {"type":"text-delta","delta":"Half an ans"}\n\n'])
    const { result } = renderHook(() => useAiChat({ send, onError, onFinish }))
    act(() => { result.current.submit('hi') })
    await waitFor(() => expect(result.current.status).toBe('error'))
    const m = lastMsg(result.current.messages)
    expect(m).toMatchObject({ role: 'assistant', truncated: true, status: 'error' })
    expect(m.parts[0]).toMatchObject({ type: 'text', text: 'Half an ans', state: 'done' })
    expect(onError).toHaveBeenCalledTimes(1)
    expect(result.current.error).toBeInstanceOf(Error)
  })

  it('a server abort keeps the reply, marked stopped, without an error', async () => {
    const onError = vi.fn()
    const send = () => bytes(['data: {"type":"text-delta","delta":"par"}\n\ndata: {"type":"abort"}\n\n'])
    const { result } = renderHook(() => useAiChat({ send, onError }))
    act(() => { result.current.submit('hi') })
    await waitFor(() => expect(lastMsg(result.current.messages)).toMatchObject({ role: 'assistant', stopped: true, status: 'done' }))
    expect(result.current.status).toBe('ready')
    expect(onError).not.toHaveBeenCalled()
    expect(applyAiChunk([], { type: 'abort' })).toEqual([])
  })
})

describe('I-H2: ChatApproval is a showcase demo, not a library component', () => {
  it('is not exported from aichat', () => {
    expect('ChatApproval' in aichat).toBe(false)
  })
})

const MODELS = [
  { name: 'Fast', tier: 'Speed', color: 'red', firstToken: 0, speed: 100, tps: 1, cost: '$0', text: 'a' },
  { name: 'Deep', tier: 'Reasoning', color: 'blue', firstToken: 0, speed: 100, tps: 1, cost: '$0', text: 'b' },
]
describe('I-H3: ModelComparison says "Vote recorded" only when the host confirms', () => {
  it('no toast when onVote resolves false, or without onVote; a toast when it resolves true', async () => {
    const user = userEvent.setup()
    const onVote = vi.fn(async () => false)
    const { unmount } = render(<ToastProvider><ModelComparison prompt="p" models={MODELS} onVote={onVote} /></ToastProvider>)
    await user.click(screen.getByRole('button', { name: 'Mark Fast as best' }))
    await waitFor(() => expect(onVote).toHaveBeenCalledWith(MODELS[0], 0))
    await act(async () => {})
    expect(screen.queryByText('Vote recorded')).toBeNull()
    unmount()

    const r2 = render(<ToastProvider><ModelComparison prompt="p" models={MODELS} /></ToastProvider>)
    await user.click(screen.getByRole('button', { name: 'Mark Deep as best' }))
    expect(screen.getByRole('button', { name: 'Mark Deep as best' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.queryByText('Vote recorded')).toBeNull()
    r2.unmount()

    render(<ToastProvider><ModelComparison prompt="p" models={MODELS} onVote={async () => true} /></ToastProvider>)
    await user.click(screen.getByRole('button', { name: 'Mark Fast as best' }))
    expect(await screen.findByText('Vote recorded')).toBeInTheDocument()
  })
})

/** Gives a scroller fake layout numbers (jsdom has none). */
function fakeScroll(el: HTMLElement, { height = 100, content = 1000 } = {}) {
  let top = 0
  Object.defineProperty(el, 'clientHeight', { configurable: true, get: () => height })
  Object.defineProperty(el, 'scrollHeight', { configurable: true, get: () => content })
  Object.defineProperty(el, 'scrollTop', { configurable: true, get: () => top, set: v => { top = Math.max(0, Math.min(content - height, v)) } })
  return { setContent: (c: number) => { content = c }, get top() { return top } }
}
const fakeChat = (messages: AiMessage[], status: AiChat['status'] = 'streaming'): AiChat => ({
  messages, status, busy: status === 'submitted' || status === 'streaming', error: null, input: '', setInput: () => {},
  submit: () => true, stop: () => {}, regenerate: () => {}, decideTool: async () => {}, setMessages: () => {},
})
const userMsg: AiMessage = { id: 'u', role: 'user', status: 'done', parts: [{ type: 'text', text: 'Plan the week' }] }
const reply = (text: string): AiMessage => ({ id: 'a', role: 'assistant', status: 'streaming', parts: [{ type: 'text', text, state: 'streaming' }] })

describe('I-H4: AgentComposer’s log follows a streaming reply', () => {
  it('live mode: the log scrolls to the end as the reply grows', () => {
    const { rerender } = render(<AgentComposer chat={fakeChat([userMsg, reply('Monday')])} />)
    const log = screen.getByRole('log', { name: 'Conversation' })
    const s = fakeScroll(log)
    rerender(<AgentComposer chat={fakeChat([userMsg, reply('Monday: plan. Tuesday: build.')])} />)
    expect(s.top).toBe(900)
    s.setContent(1500)
    rerender(<AgentComposer chat={fakeChat([userMsg, reply('Monday: plan. Tuesday: build. Wednesday: ship.')])} />)
    expect(s.top).toBe(1400)
  })
})

describe('I-H5: VoiceInput', () => {
  it('appending to the transcript keeps what is shown instead of restarting the reveal', () => {
    const { rerender } = render(<VoiceInput listening transcript="move the" />)
    expect(screen.getByText(/move the/)).toBeInTheDocument()
    rerender(<VoiceInput listening transcript="move the meeting" />)
    expect(screen.queryByText('Listening… tap to stop')).toBeNull()
    expect(screen.getByText(/move the/)).toBeInTheDocument()
  })

  it('fires onResult when the parent stops listening', () => {
    const onResult = vi.fn()
    const { rerender } = render(<VoiceInput listening transcript="move the meeting" onResult={onResult} />)
    rerender(<VoiceInput listening={false} transcript="move the meeting" onResult={onResult} />)
    expect(onResult).toHaveBeenCalledWith('move the meeting')
    expect(screen.getByText('“move the meeting”')).toBeInTheDocument()
  })
})

describe('I-M1, I-M2: tool states', () => {
  it('an approved call whose continuation is skipped reads Approved, not a spinner', async () => {
    const send = vi.fn(async function* () { yield { type: 'tool-start', id: 'c1', name: 'cal.create', needsApproval: true } as AiChunk; yield { type: 'finish' } as AiChunk })
    const { result } = renderHook(() => useAiChat({ send, continueAfterApproval: false }))
    act(() => { result.current.submit('book it') })
    await waitFor(() => expect(result.current.messages[1]?.parts[0]).toMatchObject({ state: 'awaiting-approval' }))
    await act(async () => { await result.current.decideTool('c1', true) })
    const part = result.current.messages[1].parts[0] as AiToolPart
    expect(part.state).toBe('approved')
    render(<ToolCard part={part} />)
    expect(screen.getByText('Approved')).toBeInTheDocument()
    expect(screen.queryByRole('status', { name: /loading/i })).toBeNull()
  })

  it('tool-start after a decided approval keeps the decision', () => {
    const decided: AiMessage = { id: 'a', role: 'assistant', status: 'streaming', parts: [{ type: 'tool', id: 't', name: 'x', state: 'denied', approval: { approved: false } }] }
    const out = applyAiChunk([decided], { type: 'tool-start', id: 't', name: 'x', needsApproval: true })
    expect(out[0].parts[0]).toMatchObject({ state: 'denied', approval: { approved: false } })
    const approved = applyAiChunk([{ ...decided, parts: [{ type: 'tool', id: 't', name: 'x', state: 'approved', approval: { approved: true } }] }], { type: 'tool-start', id: 't', name: 'x', args: { a: 1 } })
    expect(approved[0].parts[0]).toMatchObject({ state: 'approved' })
  })
})

describe('I-M3: useAiChat status', () => {
  it('setMessages after an error returns to ready; stop before the first chunk marks the turn stopped', async () => {
    const { result } = renderHook(() => useAiChat({ send: async function* () { throw new Error('down') } }))
    act(() => { result.current.submit('hi') })
    await waitFor(() => expect(result.current.status).toBe('error'))
    expect(result.current.error).toBeInstanceOf(Error)
    act(() => { result.current.setMessages([]) })
    expect(result.current.status).toBe('ready')
    expect(result.current.error).toBeNull()

    let release!: () => void
    const slow = renderHook(() => useAiChat({ send: (_m, { signal }) => (async function* () { await new Promise<void>((res, rej) => { release = res; signal.addEventListener('abort', () => rej(new Error('aborted'))) }); yield 'late' })() }))
    act(() => { slow.result.current.submit('hi') })
    act(() => { slow.result.current.stop() })
    expect(lastMsg(slow.result.current.messages)).toMatchObject({ role: 'assistant', stopped: true, parts: [] })
    release?.()
  })
})

describe('I-M4, I-M5, I-M6: AgentComposer failures, attachments and approvals', () => {
  it('a rejected onSend shows the error with Retry and calls onError; Retry asks again', async () => {
    const user = userEvent.setup()
    const onError = vi.fn()
    const onSend = vi.fn().mockRejectedValueOnce(new Error('Model is down')).mockResolvedValueOnce('Back up')
    render(<AgentComposer onSend={onSend} onError={onError} />)
    await user.type(screen.getByRole('textbox', { name: 'Message' }), 'Hello{Enter}')
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('Model is down')
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: 'Model is down' }))
    await user.click(within(alert).getByRole('button', { name: 'Retry' }))
    expect(await screen.findByText('Back up')).toBeInTheDocument()
    expect(onSend).toHaveBeenCalledTimes(2)
  })

  it('a synchronous throw is caught too', async () => {
    const user = userEvent.setup()
    const onError = vi.fn()
    render(<AgentComposer onSend={() => { throw new Error('boom') }} onError={onError} />)
    await user.type(screen.getByRole('textbox', { name: 'Message' }), 'Hello{Enter}')
    expect(await screen.findByRole('alert')).toHaveTextContent('boom')
    expect(onError).toHaveBeenCalledTimes(1)
  })

  it('too many attachments: the status names what was not added', async () => {
    const { container } = render(<AgentComposer onSend={() => 'ok'} />)
    const input = container.querySelector<HTMLInputElement>('input[type=file]')!
    const files = Array.from({ length: 21 }, (_, i) => new File(['x'], `f${i}.txt`, { type: 'text/plain' }))
    fireEvent.change(input, { target: { files } })
    expect(await screen.findByText(/Up to 20 files: “f20\.txt” wasn’t added/)).toBeInTheDocument()
  })

  it('a plain-string reply gets no approval card by default', async () => {
    const user = userEvent.setup()
    render(<AgentComposer onSend={() => 'Done.'} modes={[{ id: 'ask', label: 'Ask', desc: 'Ask first', icon: 'hand', tone: 'accent' }]} />)
    await user.type(screen.getByRole('textbox', { name: 'Message' }), 'send the email to Sam{Enter}')
    expect(await screen.findByText('Done.')).toBeInTheDocument()
    await act(() => new Promise(r => setTimeout(r, 700)))
    expect(screen.queryByRole('group', { name: 'Approval needed' })).toBeNull()
  })
})

describe('I-M8: the / command popup', () => {
  it('keeps typed arguments, matches case-insensitively, and is a listbox', async () => {
    const user = userEvent.setup()
    const respond = vi.fn(() => ({ versions: ['ok'] }))
    render(<AssistantChat respond={respond} commands={[{ cmd: '/summary', prompt: 'Summarise this week', hint: 'Summary' }]} />)
    const box = screen.getByRole('combobox', { name: 'Message' })
    await user.type(box, '/SUM')
    expect(screen.getByRole('listbox', { name: 'Commands' })).toBeInTheDocument()
    await user.type(box, 'mary for the board{Enter}')
    expect(respond).toHaveBeenCalledWith('Summarise this week for the board')
  })
})

describe('I-M11: PermissionRequest Deny', () => {
  it('waits for the host and says Declined, without claiming what the host did', async () => {
    const user = userEvent.setup()
    let done!: () => void
    const onDecide = vi.fn((allowed: boolean) => allowed ? undefined : new Promise<void>(r => { done = r }))
    render(<PermissionRequest reason="why" onDecide={onDecide} />)
    await user.click(screen.getByRole('button', { name: 'Deny' }))
    expect(onDecide).toHaveBeenCalledWith(false, false, { subject: '', body: '' })
    expect(await screen.findByText('Declining…')).toBeInTheDocument()
    await act(async () => { done() })
    // the announcement and, once the card has swapped (at once here: reduced motion skips the extras' animations), the result title
    expect((await screen.findAllByText('Declined')).length).toBeGreaterThan(0)
    expect(await screen.findByText('You declined this request.')).toBeInTheDocument()
    expect(screen.queryByText(/app was told/)).toBeNull()
    await user.click(screen.getByRole('button', { name: 'Review again' }))
    expect(onDecide).toHaveBeenCalledTimes(1)
  })
})
