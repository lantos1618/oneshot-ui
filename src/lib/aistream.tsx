import { useCallback, useEffect, useRef, useState } from 'react'
import { tryJson, uiShared, useLatest, type RunStatus } from './core'

/** Version of the AiChunk protocol. */
export const AI_STREAM_VERSION = 1

export type AiRole = 'user' | 'assistant' | 'system'
/** `approved`: the person said yes and the tool has not reported back yet; `denied`: the person said no, so it never ran. */
export type AiToolState = 'pending' | 'running' | 'awaiting-approval' | 'approved' | 'denied' | 'done' | 'error'
export type AiTextPart = { type: 'text'; text: string; id?: string; state?: 'streaming' | 'done' }
export type AiReasoningPart = { type: 'reasoning'; text: string; id?: string; state?: 'streaming' | 'done' }
/**
 * A tool call. `args` is the parsed input (while it streams, `argsText` holds the raw JSON so far). `approval` is set
 * when the call needs the person's OK: `approved` stays undefined until they decide.
 */
export type AiToolPart = {
  type: 'tool'; id: string; name: string; state: AiToolState; args?: unknown; argsText?: string; result?: unknown; error?: string
  approval?: { summary?: string; approved?: boolean }
}
export type AiSourcePart = { type: 'source'; url: string; title?: string; snippet?: string; id?: string }
/** An attachment. `file` is the browser File (client-only, not serialisable); `url` may be an object URL, https or a data URL. */
export type AiFilePart = { type: 'file'; name: string; mediaType: string; url?: string; size?: number; file?: File }
/** Custom data for your own renderer (MessageParts' `renderData`). */
export type AiDataPart = { type: 'data'; name: string; data: unknown; id?: string }
/** A failed reply. `message` is what the model or your `send` reported, or '' (renderers then show "Something went wrong"). */
export type AiErrorPart = { type: 'error'; message: string }
export type AiPart = AiTextPart | AiReasoningPart | AiToolPart | AiSourcePart | AiFilePart | AiDataPart | AiErrorPart
export type AiMessage = {
  id: string; role: AiRole; parts: AiPart[]; status?: 'streaming' | 'done' | 'error'; createdAt?: number
  /** the person pressed Stop, or the server sent `abort` */
  stopped?: boolean
  /** the stream ended before its terminator (`finish` or `[DONE]`): what arrived is kept, with an error part */
  truncated?: boolean
  /** anything the host attaches (submit's `metadata`): context chips, model settings… */
  metadata?: Record<string, unknown>
}
export type AiChunk =
  | { type: 'start'; messageId?: string }
  | { type: 'text-delta'; delta: string; id?: string }
  | { type: 'text-end'; id?: string }
  | { type: 'reasoning-delta'; delta: string; id?: string }
  | { type: 'reasoning-end'; id?: string }
  | { type: 'tool-start'; id: string; name: string; args?: unknown; needsApproval?: boolean | { summary?: string } }
  | { type: 'tool-args-delta'; id: string; delta: string }
  | { type: 'tool-args'; id: string; args: unknown; name?: string }
  | { type: 'tool-approval'; id: string; summary?: string }
  | { type: 'tool-result'; id: string; result: unknown }
  | { type: 'tool-error'; id: string; error: string }
  | { type: 'source'; url: string; title?: string; snippet?: string; id?: string }
  | { type: 'file'; url: string; mediaType: string; name?: string }
  | { type: 'data'; name: string; data: unknown; id?: string }
  | { type: 'finish' }
  /** the server cancelled the reply: it is kept, marked `stopped` */
  | { type: 'abort' }
  | { type: 'error'; message: string }

/** Size caps: text per part, raw tool-argument JSON, parts per message, messages kept (older ones drop off the top), one SSE event / NDJSON line, error text. */
export const AI_LIMITS = { partChars: 200_000, argsChars: 100_000, parts: 400, messages: 2_000, lineChars: 1_000_000, errorChars: 2_000 }

/** The id counter, page-wide (shared by every copy of the library, so ids from different drop-in files never collide). */
const aiSeq = uiShared('ai-seq', () => ({ n: 0 }))
/** A fresh id for a message or part ("msg-…"), unique within the page. */
export const aiId = (prefix = 'ai') => `${prefix}-${Date.now().toString(36)}${(++aiSeq.n).toString(36)}`

const aiCap = (s: string, n: number) => s.length > n ? s.slice(0, n) : s
const aiJson = (v: unknown, indent?: number) => { try { return JSON.stringify(v, null, indent) ?? String(v) } catch { return String(v) } }
/**
 * A value as display text: strings as they are, Errors by their message, anything else as JSON (`indent` spaces), cut to
 * `max` characters with a trailing "…" when longer.
 */
export function valueText(v: unknown, max = Infinity, indent?: number): string {
  const s = typeof v === 'string' ? v : v instanceof Error ? v.message : aiJson(v, indent)
  return s.length > max ? s.slice(0, Math.max(0, max - 1)) + '…' : s
}
const aiStr = (v: unknown, n = AI_LIMITS.errorChars) => aiCap(typeof v === 'string' ? v : v instanceof Error ? v.message : aiJson(v), n)

/** The text parts of a message joined as plain text, e.g. for Copy. */
export const aiMessageText = (m: AiMessage) => m.parts.map(p => p.type === 'text' ? p.text : '').filter(Boolean).join('\n\n')

/** Marks a message's streaming parts as finished. */
function aiSettle(m: AiMessage, status: AiMessage['status']): AiMessage {
  return { ...m, status, parts: m.parts.map(p => (p.type === 'text' || p.type === 'reasoning') && p.state === 'streaming' ? { ...p, state: 'done' as const } : p) }
}

/**
 * Pure reducer for one chunk: returns a new message list (the old one is never mutated). Content chunks go to the
 * last message when it is a streaming assistant message; otherwise they open a new assistant message. Text and
 * reasoning deltas append to the latest part of that kind until something else (a tool call, a source) comes in
 * between. Everything is capped by `AI_LIMITS`; excess text is dropped, not thrown. Unknown chunks change nothing.
 */
export function applyAiChunk(messages: AiMessage[], chunk: AiChunk | string): AiMessage[] {
  const c: AiChunk = typeof chunk === 'string' ? { type: 'text-delta', delta: chunk } : chunk
  if (!c || typeof c !== 'object' || typeof c.type !== 'string') return messages
  const last = messages[messages.length - 1]
  const open = !!last && last.role === 'assistant' && last.status === 'streaming'
  if (c.type === 'finish') return open ? [...messages.slice(0, -1), aiSettle(last, 'done')] : messages
  if (c.type === 'abort') return open ? [...messages.slice(0, -1), { ...aiSettle(last, 'done'), stopped: true }] : messages
  if (c.type === 'start') {
    if (open && (!c.messageId || c.messageId === last.id)) return messages
    const kept = open ? [...messages.slice(0, -1), aiSettle(last, 'done')] : messages
    return [...kept, { id: c.messageId ? aiCap(String(c.messageId), 200) : aiId('msg'), role: 'assistant' as const, parts: [], status: 'streaming' as const, createdAt: Date.now() }].slice(-AI_LIMITS.messages)
  }
  const base: AiMessage = open ? last : { id: aiId('msg'), role: 'assistant', parts: [], status: 'streaming', createdAt: Date.now() }
  const parts = [...base.parts]
  const add = (p: AiPart) => { if (parts.length < AI_LIMITS.parts) parts.push(p) }
  const tool = (id: string, f: (t: AiToolPart) => AiToolPart, name?: string) => {
    const i = parts.findIndex(p => p.type === 'tool' && p.id === String(id))
    if (i >= 0) parts[i] = f(parts[i] as AiToolPart)
    else add(f({ type: 'tool', id: aiCap(String(id), 200), name: name ? aiCap(String(name), 200) : 'tool', state: 'pending' }))
  }
  let status: AiMessage['status'] = 'streaming'
  switch (c.type) {
    case 'text-delta': case 'reasoning-delta': {
      const kind = c.type === 'text-delta' ? 'text' : 'reasoning'
      const delta = typeof c.delta === 'string' ? c.delta : ''
      if (!delta) return messages
      const p = parts[parts.length - 1]
      if (p && p.type === kind && p.state === 'streaming' && (c.id == null || p.id == null || p.id === String(c.id))) parts[parts.length - 1] = { ...p, text: aiCap(p.text + delta, AI_LIMITS.partChars) }
      else add({ type: kind, text: aiCap(delta, AI_LIMITS.partChars), state: 'streaming', ...(c.id != null ? { id: String(c.id) } : {}) })
      break
    }
    case 'text-end': case 'reasoning-end': {
      const kind = c.type === 'text-end' ? 'text' : 'reasoning'
      for (let i = parts.length - 1; i >= 0; i--) { const p = parts[i]; if (p.type === kind && p.state === 'streaming' && (c.id == null || p.id == null || p.id === String(c.id))) { parts[i] = { ...p, state: 'done' }; break } }
      break
    }
    case 'tool-start': {
      const ask = c.needsApproval
      tool(c.id, t => {
        const u: AiToolPart = { ...t, name: c.name ? aiCap(String(c.name), 200) : t.name, ...(c.args !== undefined ? { args: c.args } : {}) }
        if (ask) return aiAskApproval(u, typeof ask === 'object' ? ask.summary : undefined)
        return c.args !== undefined && u.state === 'pending' ? { ...u, state: 'running' } : u
      }, c.name)
      break
    }
    case 'tool-args-delta':
      tool(c.id, t => { const argsText = aiCap((t.argsText ?? '') + (typeof c.delta === 'string' ? c.delta : ''), AI_LIMITS.argsChars); const j = tryJson(argsText); return { ...t, argsText, ...(j.ok ? { args: j.v } : {}) } })
      break
    case 'tool-args':
      tool(c.id, t => ({ ...t, args: c.args, argsText: undefined, name: c.name ? aiCap(String(c.name), 200) : t.name, state: t.state === 'pending' ? 'running' : t.state }), c.name)
      break
    case 'tool-approval':
      tool(c.id, t => aiAskApproval(t, c.summary))
      break
    case 'tool-result':
      tool(c.id, t => t.approval?.approved === false ? t : { ...t, state: 'done', result: c.result }) // a denied call never shows a result
      break
    case 'tool-error':
      tool(c.id, t => ({ ...t, state: 'error', error: aiStr(c.error) }))
      break
    case 'source':
      if (typeof c.url !== 'string' || parts.some(p => p.type === 'source' && p.url === c.url)) return messages
      add({ type: 'source', url: aiCap(c.url, 2048), ...(c.title ? { title: aiStr(c.title, 300) } : {}), ...(c.snippet ? { snippet: aiStr(c.snippet, 1000) } : {}), ...(c.id != null ? { id: String(c.id) } : {}) })
      break
    case 'file':
      if (typeof c.url !== 'string') return messages
      add({ type: 'file', url: aiCap(c.url, 2_000_000), mediaType: aiStr(c.mediaType ?? 'application/octet-stream', 200), name: aiStr(c.name ?? 'file', 300) })
      break
    case 'data': {
      const i = c.id != null ? parts.findIndex(p => p.type === 'data' && p.id === String(c.id) && p.name === c.name) : -1
      const p: AiDataPart = { type: 'data', name: aiStr(c.name, 200), data: c.data, ...(c.id != null ? { id: String(c.id) } : {}) }
      if (i >= 0) parts[i] = p; else add(p)
      break
    }
    case 'error':
      add({ type: 'error', message: aiStr(c.message ?? '') })
      status = 'error'
      break
    default: return messages
  }
  const msg: AiMessage = { ...base, parts }
  const out = status === 'error' ? aiSettle(msg, 'error') : msg
  return open ? [...messages.slice(0, -1), out] : [...messages, out].slice(-AI_LIMITS.messages)
}

/** Asks for approval once: a call that was already decided, or already ran, keeps its state. */
function aiAskApproval(t: AiToolPart, summary?: string): AiToolPart {
  if (t.approval?.approved !== undefined || t.state === 'done' || t.state === 'error' || t.state === 'denied' || t.state === 'approved') return t
  return { ...t, state: 'awaiting-approval', approval: { summary: summary ? aiStr(summary) : t.approval?.summary } }
}

/**
 * Normalises one decoded event to an AiChunk: accepts this module's chunk names, AI SDK UI message stream events
 * (README, "Streaming") and plain strings (text deltas). Returns null for events with no visible effect (step markers,
 * text-start, message-metadata…) and for anything unrecognised.
 */
export function toAiChunk(e: unknown): AiChunk | null {
  if (typeof e === 'string') return e ? { type: 'text-delta', delta: e } : null
  if (!e || typeof e !== 'object') return null
  const o = e as Record<string, unknown>, t = o.type
  if (typeof t !== 'string') return null
  const id = o.toolCallId ?? o.id
  const withId = o.id != null ? { id: String(o.id) } : {}
  switch (t) {
    case 'start': return { type: 'start', ...(typeof o.messageId === 'string' ? { messageId: o.messageId } : {}) }
    case 'text-delta': case 'reasoning-delta': return typeof o.delta === 'string' ? { type: t, delta: o.delta, ...withId } : null
    case 'text-end': case 'reasoning-end': return { type: t, ...withId }
    case 'tool-start': case 'tool-input-start':
      return id == null ? null : { type: 'tool-start', id: String(id), name: String(o.name ?? o.toolName ?? 'tool'), ...(o.args !== undefined ? { args: o.args } : {}), ...(o.needsApproval ? { needsApproval: o.needsApproval as boolean | { summary?: string } } : {}) }
    case 'tool-args-delta': case 'tool-input-delta': {
      const delta = o.delta ?? o.inputTextDelta
      return id == null || typeof delta !== 'string' ? null : { type: 'tool-args-delta', id: String(id), delta }
    }
    case 'tool-args': case 'tool-input-available':
      return id == null ? null : { type: 'tool-args', id: String(id), args: o.args ?? o.input, ...(o.name ?? o.toolName ? { name: String(o.name ?? o.toolName) } : {}) }
    case 'tool-approval': case 'tool-approval-request': return id == null ? null : { type: 'tool-approval', id: String(id), ...(typeof o.summary === 'string' ? { summary: o.summary } : {}) }
    case 'tool-result': case 'tool-output-available': return id == null ? null : { type: 'tool-result', id: String(id), result: o.result ?? o.output }
    case 'tool-error': case 'tool-output-error': case 'tool-input-error': return id == null ? null : { type: 'tool-error', id: String(id), error: aiStr(o.error ?? o.errorText ?? 'Tool failed') }
    case 'source': case 'source-url':
      return typeof o.url === 'string' ? { type: 'source', url: o.url, ...(o.title ? { title: String(o.title) } : {}), ...(o.snippet ? { snippet: String(o.snippet) } : {}), ...(o.sourceId ?? o.id ? { id: String(o.sourceId ?? o.id) } : {}) } : null
    case 'file': return typeof o.url === 'string' ? { type: 'file', url: o.url, mediaType: String(o.mediaType ?? 'application/octet-stream'), ...(o.name ?? o.filename ? { name: String(o.name ?? o.filename) } : {}) } : null
    case 'data': return typeof o.name === 'string' ? { type: 'data', name: o.name, data: o.data, ...withId } : null
    case 'finish': return { type: 'finish' }
    case 'abort': return { type: 'abort' }
    case 'error': return { type: 'error', message: aiStr(o.message ?? o.errorText ?? '') }
    default:
      if (t.startsWith('data-') && t.length > 5) return { type: 'data', name: t.slice(5), data: o.data, ...withId }
      return null
  }
}

export type AiStreamFormat = 'auto' | 'sse' | 'ndjson'
/** How a byte stream ended: `done` when it sent `[DONE]`; the values it decoded and the lines it could not read. */
export type JsonLinesEnd = { done: boolean; values: number; malformed: number }
/**
 * Decodes a byte (or string) stream of JSON values: Server-Sent Events (`data: {…}` lines, events end at a blank line,
 * `[DONE]` ends the stream) or NDJSON (one value per line). `auto` decides from the first non-empty line. Reads may split
 * anywhere, even inside a UTF-8 character. A line that is not JSON (or, in SSE, not a field or comment) is skipped and
 * reported to `onMalformed`; an event or line longer than `maxChars` is dropped and reported. Leaving the loop early
 * cancels the stream. Returns how it ended.
 */
export async function* parseJsonLines(stream: ReadableStream<Uint8Array | string>, { format = 'auto', maxChars = AI_LIMITS.lineChars, onMalformed }:
  { format?: AiStreamFormat; maxChars?: number; onMalformed?: (line: string) => void } = {}): AsyncGenerator<unknown, JsonLinesEnd> {
  const reader = stream.getReader()
  const dec = new TextDecoder()
  let buf = '', mode: 'sse' | 'ndjson' | null = format === 'auto' ? null : format, data: string[] = [], dataLen = 0, over = false, done = false, values = 0, malformed = 0
  const bad = (s: string) => { malformed++; onMalformed?.(valueText(s, 201)) }
  function* value(s: string): Generator<unknown> { const j = tryJson(s); if (!j.ok) { bad(s); return } values++; yield j.v }
  function* line(raw: string): Generator<unknown> {
    const l = raw.endsWith('\r') ? raw.slice(0, -1) : raw
    if (!mode) { if (!l.trim()) return; mode = /^(data|event|id|retry):|^:/.test(l) ? 'sse' : 'ndjson' }
    if (mode === 'ndjson') { if (!l.trim()) return; if (l.length > maxChars) { bad(l); return } yield* value(l); return }
    if (!l) { // end of an SSE event
      if (data.length && !over) { const s = data.join('\n'); if (s.trim() === '[DONE]') done = true; else yield* value(s) }
      data = []; dataLen = 0; over = false; return
    }
    if (l.startsWith(':')) return // comment or keep-alive
    if (!l.startsWith('data:')) { if (!/^(event|id|retry)(:|$)/.test(l)) bad(l); return }
    const v = l.slice(5).replace(/^ /, '')
    dataLen += v.length
    if (dataLen > maxChars) { if (!over) bad(v); over = true; return }
    data.push(v)
  }
  try {
    while (!done) {
      const { value, done: end } = await reader.read()
      if (end) break
      buf += typeof value === 'string' ? value : dec.decode(value as Uint8Array, { stream: true })
      let i: number
      while (!done && (i = buf.indexOf('\n')) >= 0) { const l = buf.slice(0, i); buf = buf.slice(i + 1); yield* line(l) }
      if (buf.length > maxChars) { bad(buf); buf = ''; if (mode === 'sse') over = true } // a runaway line: drop it
    }
    if (!done) { buf += dec.decode(); if (buf) yield* line(buf); if (mode === 'sse') yield* line('') }
  } finally {
    try { await reader.cancel() } catch { /* already closed */ }
  }
  return { done, values, malformed }
}

/** Anything a stream source may be: a fetch Response, a ReadableStream (of bytes, text or items) or an async iterable. */
export type StreamSource<T = unknown> = Response | ReadableStream<T | Uint8Array | string> | AsyncIterable<T>
/**
 * Every item of a stream source. A Response (2xx only; anything else throws) and a stream of bytes or text are decoded
 * with parseJsonLines; a stream or iterable of items is passed through. Returns how the decoded bytes ended, or null
 * when the source was items.
 */
export async function* streamItems(src: StreamSource, opts: { format?: AiStreamFormat; onMalformed?: (line: string) => void } = {}): AsyncGenerator<unknown, JsonLinesEnd | null> {
  if (typeof Response !== 'undefined' && src instanceof Response) {
    if (!src.ok) throw new Error(`Request failed (${src.status})`)
    if (!src.body) throw new Error('The response has no body')
    return yield* parseJsonLines(src.body, opts)
  }
  if (typeof ReadableStream !== 'undefined' && src instanceof ReadableStream) {
    const reader = (src as ReadableStream<unknown>).getReader()
    let first: ReadableStreamReadResult<unknown>
    try { first = await reader.read() } catch (e) { reader.releaseLock(); throw e }
    if (first.done) return null
    const v = first.value
    if (ArrayBuffer.isView(v) || typeof v === 'string') { // bytes or text: hand the rest to the decoder
      let sent = false
      const rest = new ReadableStream<Uint8Array | string>({
        async pull(ctl) { if (!sent) { sent = true; ctl.enqueue(v as Uint8Array | string); return } const r = await reader.read(); if (r.done) ctl.close(); else ctl.enqueue(r.value as Uint8Array | string) },
        cancel() { return reader.cancel() },
      })
      return yield* parseJsonLines(rest, opts)
    }
    try {
      for (let r: ReadableStreamReadResult<unknown> = first; !r.done; r = await reader.read()) yield r.value
    } finally { try { await reader.cancel() } catch { /* closed */ } }
    return null
  }
  yield* src as AsyncIterable<unknown>
  return null
}

/**
 * How a reply stream ended. `ok`: it finished (a `finish` chunk or `[DONE]`; a stream of items may also just end).
 * `cancelled`: the server sent `abort`. `error`: an `error` chunk, a byte stream with nothing readable in it
 * (`reason: 'unreadable'`, e.g. an HTML error page), or a byte stream that stopped before its terminator (`'truncated'`).
 */
export type AiStreamEnd = { status: Exclude<RunStatus, 'running'>; reason?: 'unreadable' | 'truncated'; chunks: number; malformed: number }

async function* aiChunkItems(items: AsyncGenerator<unknown, JsonLinesEnd | null>): AsyncGenerator<AiChunk, AiStreamEnd> {
  let chunks = 0, end: AiStreamEnd['status'] | null = null, r: IteratorResult<unknown, JsonLinesEnd | null>
  try {
    while (!(r = await items.next()).done) {
      const ch = toAiChunk(r.value)
      if (!ch) continue
      chunks++
      if (ch.type === 'finish') end = 'ok'; else if (ch.type === 'abort') end = 'cancelled'; else if (ch.type === 'error') end = 'error'
      yield ch
    }
  } finally { await items.return(null) }
  const wire = r.value, malformed = wire?.malformed ?? 0
  if (end) return { status: end, chunks, malformed }
  if (!chunks && malformed) return { status: 'error', reason: 'unreadable', chunks, malformed }
  if (wire && !wire.done) return { status: 'error', reason: chunks ? 'truncated' : 'unreadable', chunks, malformed }
  return { status: 'ok', chunks, malformed }
}

/**
 * Decodes a byte (or string) stream into AiChunks (parseJsonLines, then toAiChunk). Returns how it ended (AiStreamEnd):
 * a byte stream must end with `finish`, `abort` or `[DONE]`, or it counts as truncated.
 */
export function parseAiStream(stream: ReadableStream<Uint8Array | string>, opts: { format?: AiStreamFormat; onMalformed?: (line: string) => void } = {}): AsyncGenerator<AiChunk, AiStreamEnd> {
  return aiChunkItems(parseJsonLines(stream, opts))
}

/**
 * Reads an AI SDK UI message stream (the Response of `result.toUIMessageStreamResponse()`, or its body) as AiChunks,
 * without the `ai` package: it is SSE of JSON events, mapped by `toAiChunk`. A non-2xx Response throws (useAiChat shows
 * it as an error part). useAiChat's `send` can also return the Response itself.
 */
export function fromAiSdkUIMessageStream(res: Response | ReadableStream<Uint8Array>): AsyncGenerator<AiChunk, AiStreamEnd> {
  if (typeof ReadableStream !== 'undefined' && res instanceof ReadableStream) return parseAiStream(res, { format: 'sse' })
  const r = res as Response
  if (!r.ok) throw new Error(`Request failed (${r.status})`)
  if (!r.body) throw new Error('The response has no body')
  return parseAiStream(r.body, { format: 'sse' })
}

/** What `send` may return: chunks (or AI SDK events, or strings) as an async iterable, a stream of them or of bytes, a Response, or a promise of one of these. */
export type AiSendResult = AsyncIterable<AiChunk | string | Record<string, unknown>> | ReadableStream<AiChunk | Uint8Array | string> | Response
export type AiSend = (messages: AiMessage[], opts: { signal: AbortSignal }) => AiSendResult | Promise<AiSendResult>

/**
 * Turns whatever `send` returned into one async iterable of AiChunks: a Response or byte stream is decoded as SSE or
 * NDJSON (whichever it is), items go through toAiChunk. Returns how it ended (AiStreamEnd).
 */
export async function* aiChunksOf(src: AiSendResult | Promise<AiSendResult>, opts: { onMalformed?: (line: string) => void } = {}): AsyncGenerator<AiChunk, AiStreamEnd> {
  return yield* aiChunkItems(streamItems(await src, opts))
}

export type AiChatStatus = 'ready' | 'submitted' | 'streaming' | 'error'
export type AiChatOptions = {
  /** Calls your model and returns its stream. Abort the request when `signal` fires (Stop, regenerate, unmount). */
  send: AiSend
  initialMessages?: AiMessage[]
  /** The assistant message once it finished (also after Stop and on errors). */
  onFinish?: (message: AiMessage, messages: AiMessage[]) => void
  /** The reply failed: a throw from `send`, an `error` chunk, an unreadable or truncated stream. */
  onError?: (error: unknown) => void
  /** A line of the reply stream that could not be read (it is skipped). */
  onMalformed?: (line: string) => void
  /**
   * The person approved or denied a tool call that asked for approval. Run the tool here only if `approved`, and
   * return its result (it becomes the tool's result; a throw becomes its error). Without this handler the decision is
   * only recorded on the part (`approval.approved`) and sent back through `send`, for a server that runs tools itself.
   */
  onApprovalRequest?: (tool: AiToolPart, approved: boolean) => unknown
  /** Once every pending approval in the reply is decided, call `send` again so the model can continue (default true). */
  continueAfterApproval?: boolean
}
export type AiChat = {
  messages: AiMessage[]
  status: AiChatStatus
  /** true while a reply is requested or streaming */
  busy: boolean
  /** why the last reply failed; null unless `status` is 'error' */
  error: unknown
  /** The prompt being typed, for inputs that don't keep their own text. */
  input: string
  setInput: (v: string) => void
  /** Sends a user message (text and/or files) and streams the reply. Returns false when busy or empty. */
  submit: (text: string, files?: File[], opts?: { metadata?: Record<string, unknown> }) => boolean
  /** Aborts the reply in flight; what arrived so far stays, marked `stopped` (an empty stopped reply when nothing had arrived). */
  stop: () => void
  /** Drops the last assistant reply and asks again (also Retry after an error). */
  regenerate: () => void
  /** Approve or deny a tool call that is awaiting approval. Resolves once the host's handler finished. */
  decideTool: (toolId: string, approved: boolean) => Promise<void>
  /** Replaces the messages. Outside a reply this also clears an error status. */
  setMessages: (m: AiMessage[] | ((m: AiMessage[]) => AiMessage[])) => void
}

/**
 * Chat state over a real model stream. `send(messages, { signal })` returns the reply as chunks (AiChunk objects, an
 * AI SDK UI message stream Response, an SSE/NDJSON byte stream, or an async iterable of strings); the hook folds them
 * into `messages` with `applyAiChunk`, rendering at most once per animation frame. Stop aborts through the signal and
 * keeps what arrived; errors become an error part (Retry = `regenerate`). A tool call that needs approval waits for
 * `decideTool`: nothing runs before the person decides (see `onApprovalRequest`), then the model is asked to continue
 * in the same message. Attachments become file parts carrying the File and an object URL for previews, revoked when
 * the message goes away or on unmount.
 */
export function useAiChat({ send, initialMessages = [], onFinish, onError, onMalformed, onApprovalRequest, continueAfterApproval = true }: AiChatOptions): AiChat {
  const [messages, setMsgs] = useState<AiMessage[]>(initialMessages)
  const [state, setState] = useState<{ status: AiChatStatus; error: unknown }>({ status: 'ready', error: null })
  const [input, setInput] = useState('')
  const live = useRef(messages), ctl = useRef<AbortController | null>(null), gen = useRef(0), pending = useRef<null | (() => void)>(null)
  const urls = useRef(new Set<string>()), alive = useRef(true), statusRef = useRef<AiChatStatus>('ready')
  const cb = useLatest({ send, onFinish, onError, onMalformed, onApprovalRequest, continueAfterApproval })
  const setStatus = useCallback((s: AiChatStatus, error: unknown = null) => { statusRef.current = s; if (alive.current) setState({ status: s, error: s === 'error' ? error : null }) }, [])

  const flush = useCallback(() => { pending.current?.(); pending.current = null; if (alive.current) setMsgs(live.current) }, [])
  const schedule = useCallback(() => { // one render per frame however many chunks arrive (a timer while the tab is hidden)
    if (pending.current) return
    const tick = () => { pending.current = null; if (alive.current) setMsgs(live.current) }
    if (typeof requestAnimationFrame === 'function' && !(typeof document !== 'undefined' && document.hidden)) { const f = requestAnimationFrame(tick); pending.current = () => cancelAnimationFrame(f) }
    else { const t = setTimeout(tick, 16); pending.current = () => clearTimeout(t) }
  }, [])
  /** Revokes object URLs that no message refers to any more. */
  const sweep = useCallback((next: AiMessage[]) => {
    if (!urls.current.size) return
    const keep = new Set<string>()
    next.forEach(m => m.parts.forEach(p => { if (p.type === 'file' && p.url) keep.add(p.url) }))
    urls.current.forEach(u => { if (!keep.has(u)) { URL.revokeObjectURL(u); urls.current.delete(u) } })
  }, [])
  const commit = useCallback((next: AiMessage[]) => { live.current = next.slice(-AI_LIMITS.messages); sweep(live.current); flush() }, [flush, sweep])

  useEffect(() => {
    alive.current = true
    const u = urls.current
    return () => { alive.current = false; gen.current++; ctl.current?.abort(); pending.current?.(); u.forEach(x => URL.revokeObjectURL(x)); u.clear() }
  }, [])

  const finish = useCallback((failed: unknown) => {
    const fin = live.current[live.current.length - 1]
    if (fin?.role === 'assistant') cb.current.onFinish?.(fin, live.current)
    if (failed) cb.current.onError?.(failed)
  }, [])

  /** Streams a reply to `history`. `resume` reopens the last assistant message (after an approval) instead of starting a new one. */
  const run = useCallback(async (resume = false) => {
    ctl.current?.abort()
    const g = ++gen.current, ac = new AbortController(); ctl.current = ac
    if (resume) { const last = live.current[live.current.length - 1]; if (last?.role === 'assistant') live.current = [...live.current.slice(0, -1), { ...last, status: 'streaming' }] }
    const history = live.current
    setStatus('submitted')
    let started = false
    const it = aiChunksOf(cb.current.send(history, { signal: ac.signal }), { onMalformed: l => cb.current.onMalformed?.(l) })
    try {
      let r: IteratorResult<AiChunk, AiStreamEnd>
      while (!(r = await it.next()).done) {
        if (g !== gen.current) return
        if (!started) { started = true; setStatus('streaming') }
        live.current = applyAiChunk(live.current, r.value)
        schedule()
        if (r.value.type === 'error') break
      }
      if (g !== gen.current) return
      const end = r.done ? r.value : null
      if (end?.reason) live.current = applyAiChunk(live.current, { type: 'error', message: end.reason === 'truncated' ? 'The reply was cut off before it finished.' : 'The reply could not be read.' })
      let last = live.current[live.current.length - 1]
      if (last?.role === 'assistant' && (last.status === 'streaming' || end?.reason === 'truncated')) {
        last = { ...aiSettle(last, last.status === 'streaming' ? 'done' : last.status), ...(end?.reason === 'truncated' ? { truncated: true } : {}) }
        live.current = [...live.current.slice(0, -1), last]
      }
      const failed = last?.role === 'assistant' && last.status === 'error'
      const err = failed ? new Error((last.parts.find(p => p.type === 'error') as AiErrorPart | undefined)?.message || 'Something went wrong') : null
      flush(); setStatus(failed ? 'error' : 'ready', err)
      finish(err)
    } catch (err) {
      if (g !== gen.current || ac.signal.aborted) return
      live.current = applyAiChunk(live.current, { type: 'error', message: aiStr(err) })
      flush(); setStatus('error', err ?? new Error('Something went wrong'))
      finish(err ?? new Error('Something went wrong'))
    } finally {
      if (ctl.current === ac) ctl.current = null
      void it.return({ status: 'cancelled', chunks: 0, malformed: 0 }).catch(() => {})
    }
  }, [cb, finish, flush, schedule, setStatus])

  const isBusy = () => statusRef.current === 'submitted' || statusRef.current === 'streaming'

  const submit = useCallback((text: string, files: File[] = [], opts: { metadata?: Record<string, unknown> } = {}) => {
    const t = text.trim()
    if (isBusy() || (!t && !files.length)) return false
    const parts: AiPart[] = files.slice(0, 20).map(f => {
      let url: string | undefined
      try { url = URL.createObjectURL(f); urls.current.add(url) } catch { url = undefined }
      return { type: 'file', name: f.name, mediaType: f.type || 'application/octet-stream', size: f.size, url, file: f }
    })
    if (t) parts.push({ type: 'text', text: aiCap(t, AI_LIMITS.partChars) })
    commit([...live.current, { id: aiId('msg'), role: 'user', parts, status: 'done', createdAt: Date.now(), ...(opts.metadata ? { metadata: opts.metadata } : {}) }])
    setInput('')
    void run()
    return true
  }, [commit, run])

  const stop = useCallback(() => {
    if (!ctl.current) return
    gen.current++; ctl.current.abort(); ctl.current = null
    const last = live.current[live.current.length - 1]
    if (last?.role === 'assistant' && last.status === 'streaming') live.current = [...live.current.slice(0, -1), { ...aiSettle(last, 'done'), stopped: true }]
    else if (last?.role === 'user') live.current = [...live.current, { id: aiId('msg'), role: 'assistant', parts: [], status: 'done', stopped: true, createdAt: Date.now() }]
    flush(); setStatus('ready')
    finish(null)
  }, [finish, flush, setStatus])

  const regenerate = useCallback(() => {
    if (ctl.current) { gen.current++; ctl.current.abort(); ctl.current = null }
    let i = live.current.length - 1
    while (i >= 0 && live.current[i].role !== 'user') i--
    if (i < 0) return
    commit(live.current.slice(0, i + 1))
    void run()
  }, [commit, run])

  const deciding = useRef(new Set<string>())
  const decideTool = useCallback(async (toolId: string, approved: boolean) => {
    const find = () => { for (let i = live.current.length - 1; i >= 0; i--) { const p = live.current[i].parts.find(x => x.type === 'tool' && x.id === toolId); if (p) return { i, p: p as AiToolPart } } return null }
    const hit = find()
    if (!hit || hit.p.state !== 'awaiting-approval' || deciding.current.has(toolId)) return
    deciding.current.add(toolId)
    const patch = (f: (t: AiToolPart) => AiToolPart) => {
      live.current = live.current.map(m => m.parts.some(x => x.type === 'tool' && x.id === toolId) ? { ...m, parts: m.parts.map(x => x.type === 'tool' && x.id === toolId ? f(x) : x) } : m)
      flush()
    }
    const host = cb.current.onApprovalRequest
    patch(t => ({ ...t, approval: { ...t.approval, approved }, state: !approved ? 'denied' : host ? 'running' : 'approved' }))
    try {
      if (host) {
        const result = await host({ ...hit.p, approval: { ...hit.p.approval, approved } }, approved)
        if (approved) patch(t => ({ ...t, state: 'done', result }))
      }
    } catch (err) { patch(t => ({ ...t, state: 'error', error: aiStr(err) || 'Tool failed' })) }
    finally { deciding.current.delete(toolId) }
    if (!alive.current) return
    const after = find()
    const waiting = !!after && live.current[after.i].parts.some(x => x.type === 'tool' && x.state === 'awaiting-approval')
    if (!waiting && cb.current.continueAfterApproval && !isBusy() && after?.i === live.current.length - 1) void run(true)
  }, [cb, flush, run])

  const setMessages = useCallback((m: AiMessage[] | ((m: AiMessage[]) => AiMessage[])) => {
    commit(typeof m === 'function' ? m(live.current) : m)
    if (statusRef.current === 'error') setStatus('ready')
  }, [commit, setStatus])

  const { status, error } = state
  return { messages, status, busy: status === 'submitted' || status === 'streaming', error, input, setInput, submit, stop, regenerate, decideTool, setMessages }
}
