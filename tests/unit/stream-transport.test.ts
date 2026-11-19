import { renderHook, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { AI_LIMITS, parseJsonLines, streamItems } from '../../src/lib/aistream'
import { AGENT_RUN_LIMITS, parseRunStream, useAgentRun, type AgentRunEvent } from '../../src/lib/agentrun'

function streamOf<T>(...items: T[]) {
  return new ReadableStream<T>({ start(c) { for (const item of items) c.enqueue(item); c.close() } })
}

async function collect(items: AsyncIterable<unknown>) {
  const values = []
  for await (const item of items) values.push(item)
  return values
}

it('releases a chat object stream after reading it to completion', async () => {
  const item = { type: 'finish' }
  const stream = streamOf(item)
  const items = streamItems(stream)
  expect(await items.next()).toEqual({ value: item, done: false })
  expect(await items.next()).toEqual({ value: null, done: true })
  expect(stream.locked).toBe(false)
})

it('releases empty, errored, and wire-format chat sources', async () => {
  const empty = streamOf()
  expect(await streamItems(empty).next()).toEqual({ value: null, done: true })
  expect(empty.locked).toBe(false)

  const error = new Error('Read failed')
  const errored = new ReadableStream({ start(c) { c.error(error) } })
  await expect(streamItems(errored).next()).rejects.toBe(error)
  expect(errored.locked).toBe(false)

  const wire = streamOf('data: {"text":"ok"}\n\ndata: [DONE]\n\n')
  const items = streamItems(wire)
  expect(await items.next()).toEqual({ done: false, value: { text: 'ok' } })
  expect(await items.next()).toEqual({ done: true, value: { done: true, values: 1, malformed: 0 } })
  expect(wire.locked).toBe(false)
})

describe.each([
  { name: 'chat', parse: parseJsonLines, maxChars: AI_LIMITS.lineChars },
  { name: 'agent run', parse: parseRunStream, maxChars: AGENT_RUN_LIMITS.lineChars },
])('$name framing', ({ parse, maxChars }) => {
  it('decodes split UTF-8 and multiline CRLF SSE, then stops and unlocks at [DONE]', async () => {
    const text = ': heartbeat\r\nevent: update\r\ndata: {\r\ndata: "text":"é"}\r\n\r\ndata: [DONE]\r\n\r\ndata: 9\r\n\r\n'
    const bytes = new TextEncoder().encode(text)
    const cut = text.indexOf('é') + 1
    const cancel = vi.fn()
    const stream = new ReadableStream({ start(c) { c.enqueue(bytes.slice(0, cut)); c.enqueue(bytes.slice(cut)) }, cancel })
    expect(await collect(parse(stream))).toEqual([{ text: 'é' }])
    expect(cancel).toHaveBeenCalledTimes(1)
    expect(stream.locked).toBe(false)
  })

  it('cancels and releases the reader when the caller exits early', async () => {
    const cancel = vi.fn()
    const stream = new ReadableStream({ start(c) { c.enqueue('1\n') }, cancel })
    for await (const item of parse(stream)) { expect(item).toBe(1); break }
    expect(cancel).toHaveBeenCalledTimes(1)
    expect(stream.locked).toBe(false)
  })

  it('discards a split overlong NDJSON line through its newline and resumes', async () => {
    const stream = streamOf('1\r\n' + 'x'.repeat(maxChars + 10), '42\r\n', '{broken\n', '2')
    expect(await collect(parse(stream))).toEqual([1, 2])
    expect(stream.locked).toBe(false)
  })

  it('accepts an SSE payload at the cap and drops overlong lines and multiline events', async () => {
    const payload = '"' + 'x'.repeat(maxChars - 2) + '"'
    const stream = streamOf(
      'data: ' + payload + '\r', '\n\r\n',
      'data: ' + payload + ' \n\n',
      'data: ' + payload + '\ndata:\n\n',
      'data: 2',
    )
    expect(await collect(parse(stream))).toEqual([payload.slice(1, -1), 2])
    expect(stream.locked).toBe(false)
  })
})

it('reports a dropped split line once and bounds the malformed preview', async () => {
  const bad = vi.fn()
  const stream = streamOf('x'.repeat(512), '42\n1')
  const items = parseJsonLines(stream, { format: 'ndjson', maxChars: 256, onMalformed: bad })
  expect(await items.next()).toEqual({ done: false, value: 1 })
  expect(await items.next()).toEqual({ done: true, value: { done: false, values: 1, malformed: 1 } })
  expect(bad).toHaveBeenCalledExactlyOnceWith('x'.repeat(200) + '…')
})

it('releases a completed object stream read by useAgentRun', async () => {
  const stream = streamOf<AgentRunEvent>({ type: 'run-start', id: 'r', at: 1 }, { type: 'run-end', at: 2 })
  const { result } = renderHook(() => useAgentRun(stream))
  await waitFor(() => expect(result.current).toMatchObject({ status: 'done', run: { status: 'ok' } }))
  expect(stream.locked).toBe(false)
})

it('releases a run Response body and still treats [DONE] without run-end as early closure', async () => {
  const response = new Response('data: {"type":"run-start","id":"r","at":1}\n\ndata: [DONE]\n\n')
  const { result } = renderHook(() => useAgentRun(response))
  await waitFor(() => expect(result.current).toMatchObject({ status: 'error', closedEarly: true, run: { status: 'cancelled' } }))
  expect(response.body?.locked).toBe(false)
})
