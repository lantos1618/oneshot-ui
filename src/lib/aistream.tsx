import { useCallback, useEffect, useRef, useState } from 'react'

/* ════════════════════════════════════════════════════════════════════════════
 * 11a. AI STREAM: the message model (parts), a chunk reducer, stream parsers and useAiChat
 *
 * Headless: no UI here (the parts renderer lives in aichat.tsx, PromptInput in ai.tsx), and it imports only React.
 *
 * Chunk protocol (AiChunk). One JSON object per chunk; the names on the right are the AI SDK UI message stream
 * events (`result.toUIMessageStreamResponse()`, SSE `data: {…}`) that `toAiChunk` maps onto them:
 *
 *   start            { messageId? }                       ← start
 *   text-delta       { delta, id? }                       ← text-delta { id, delta }   (text-start: ignored)
 *   text-end         { id? }                              ← text-end
 *   reasoning-delta  { delta, id? }                       ← reasoning-delta            (reasoning-start: ignored)
 *   reasoning-end    { id? }                              ← reasoning-end
 *   tool-start       { id, name, args?, needsApproval? }  ← tool-input-start { toolCallId, toolName }
 *   tool-args-delta  { id, delta }                        ← tool-input-delta { toolCallId, inputTextDelta }
 *   tool-args        { id, args, name? }                  ← tool-input-available { toolCallId, toolName, input }
 *   tool-approval    { id, summary? }                     ← tool-approval-request { toolCallId, approvalId }
 *   tool-result      { id, result }                       ← tool-output-available { toolCallId, output }
 *   tool-error       { id, error }                        ← tool-output-error / tool-input-error { toolCallId, errorText }
 *   source           { url, title?, snippet?, id? }       ← source-url { sourceId, url, title }
 *   file             { url, mediaType, name? }            ← file { url, mediaType }
 *   data             { name, data, id? }                  ← data-<name> { id?, data }  (same id replaces)
 *   finish           { }                                  ← finish, abort              (start-step/finish-step: ignored)
 *   error            { message }                          ← error { errorText }
 *
 * A bare string is shorthand for a text-delta, so `send` can be an async generator of plain text.
 * ══════════════════════════════════════════════════════════════════════════ */

/** Version of the chunk protocol above. */
export const AI_STREAM_VERSION = 1

export type AiRole = 'user' | 'assistant' | 'system'
export type AiToolState = 'pending' | 'running' | 'awaiting-approval' | 'done' | 'error'
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
export type AiErrorPart = { type: 'error'; message: string }
export type AiPart = AiTextPart | AiReasoningPart | AiToolPart | AiSourcePart | AiFilePart | AiDataPart | AiErrorPart
export type AiMessage = {
  id: string; role: AiRole; parts: AiPart[]; status?: 'streaming' | 'done' | 'error'; createdAt?: number
  /** the person pressed Stop while it streamed */
  stopped?: boolean
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
  | { type: 'error'; message: string }

/** Size caps: text per part, raw tool-argument JSON, parts per message, messages kept, one SSE event / NDJSON line, error text. */
// (messages: Conversation virtualises long logs, so the cap only bounds memory; older messages drop off the top)
export const AI_LIMITS = { partChars: 200_000, argsChars: 100_000, parts: 400, messages: 2_000, lineChars: 1_000_000, errorChars: 2_000 }

let aiSeq = 0
/** A fresh id for a message or part ("msg-…"), unique within the page. */
export const aiId = (prefix = 'ai') => `${prefix}-${Date.now().toString(36)}${(++aiSeq).toString(36)}`

const aiCap = (s: string, n: number) => s.length > n ? s.slice(0, n) : s
const aiStr = (v: unknown, n = AI_LIMITS.errorChars) => aiCap(typeof v === 'string' ? v : v instanceof Error ? v.message : (() => { try { return JSON.stringify(v) ?? String(v) } catch { return String(v) } })(), n)
const aiTryJson = (s: string): { ok: true; v: unknown } | { ok: false } => { try { return { ok: true, v: JSON.parse(s) } } catch { return { ok: false } } }

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
      tool(c.id, t => ({ ...t, name: c.name ? aiCap(String(c.name), 200) : t.name, ...(c.args !== undefined ? { args: c.args } : {}),
        state: ask ? 'awaiting-approval' : c.args !== undefined ? 'running' : t.state,
        ...(ask ? { approval: { summary: typeof ask === 'object' && ask.summary ? aiStr(ask.summary) : undefined } } : {}) }), c.name)
      break
    }
    case 'tool-args-delta':
      tool(c.id, t => { const argsText = aiCap((t.argsText ?? '') + (typeof c.delta === 'string' ? c.delta : ''), AI_LIMITS.argsChars); const j = aiTryJson(argsText); return { ...t, argsText, ...(j.ok ? { args: j.v } : {}) } })
      break
    case 'tool-args':
      tool(c.id, t => ({ ...t, args: c.args, argsText: undefined, name: c.name ? aiCap(String(c.name), 200) : t.name, state: t.state === 'awaiting-approval' || t.state === 'done' || t.state === 'error' ? t.state : 'running' }), c.name)
      break
    case 'tool-approval':
      tool(c.id, t => t.approval?.approved !== undefined || t.state === 'done' ? t : { ...t, state: 'awaiting-approval', approval: { summary: c.summary ? aiStr(c.summary) : t.approval?.summary } })
      break
    case 'tool-result':
      tool(c.id, t => t.approval && t.approval.approved === false ? t : { ...t, state: 'done', result: c.result }) // a denied call never shows a result
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
      add({ type: 'error', message: aiStr(c.message ?? 'Something went wrong') || 'Something went wrong' })
      status = 'error'
      break
    default: return messages
  }
  const msg: AiMessage = { ...base, parts }
  const out = status === 'error' ? aiSettle(msg, 'error') : msg
  return open ? [...messages.slice(0, -1), out] : [...messages, out].slice(-AI_LIMITS.messages)
}

/**
 * Normalises one decoded event to an AiChunk: accepts this module's chunk names, AI SDK UI message stream events
 * (see the table at the top of this file) and plain strings (text deltas). Returns null for events with no visible
 * effect (step markers, text-start, message-metadata…) and for anything unrecognised.
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
    case 'finish': case 'abort': return { type: 'finish' }
    case 'error': return { type: 'error', message: aiStr(o.message ?? o.errorText ?? 'Something went wrong') }
    default:
      if (t.startsWith('data-') && t.length > 5) return { type: 'data', name: t.slice(5), data: o.data, ...withId }
      return null
  }
}

export type AiStreamFormat = 'auto' | 'sse' | 'ndjson'
/**
 * Decodes a byte (or string) stream into AiChunks: Server-Sent Events (`data: {…}` lines, events end at a blank line,
 * `[DONE]` ends the stream) or NDJSON (one JSON object per line). `auto` decides from the first non-empty line.
 * Reads may split anywhere, even inside a UTF-8 character. Malformed lines are skipped (reported to `onMalformed`),
 * and an event or line longer than `AI_LIMITS.lineChars` is dropped. Leaving the loop early cancels the stream.
 */
export async function* parseAiStream(stream: ReadableStream<Uint8Array | string>, { format = 'auto', onMalformed }: { format?: AiStreamFormat; onMalformed?: (line: string) => void } = {}): AsyncGenerator<AiChunk> {
  const reader = stream.getReader()
  const dec = new TextDecoder()
  let buf = '', mode: 'sse' | 'ndjson' | null = format === 'auto' ? null : format, data: string[] = [], dataLen = 0, over = false, ended = false
  const bad = (s: string) => onMalformed?.(s.length > 200 ? s.slice(0, 200) + '…' : s)
  const decode = (s: string): AiChunk | null => { const j = aiTryJson(s); if (!j.ok) { bad(s); return null } return toAiChunk(j.v) }
  function* line(raw: string): Generator<AiChunk> {
    const l = raw.endsWith('\r') ? raw.slice(0, -1) : raw
    if (!mode) { if (!l.trim()) return; mode = /^(data|event|id|retry):|^:/.test(l) ? 'sse' : 'ndjson' }
    if (mode === 'ndjson') { if (!l.trim()) return; if (l.length > AI_LIMITS.lineChars) { bad(l); return } const ch = decode(l); if (ch) yield ch; return }
    if (!l) { // end of an SSE event
      if (data.length && !over) { const s = data.join('\n'); if (s.trim() === '[DONE]') ended = true; else { const ch = decode(s); if (ch) yield ch } }
      data = []; dataLen = 0; over = false; return
    }
    if (l.startsWith(':') || !l.startsWith('data:')) return // comments, keep-alives, event:/id:/retry:
    const v = l.slice(5).replace(/^ /, '')
    dataLen += v.length
    if (dataLen > AI_LIMITS.lineChars) { if (!over) bad(v); over = true; return }
    data.push(v)
  }
  try {
    while (!ended) {
      const { value, done } = await reader.read()
      if (done) break
      buf += typeof value === 'string' ? value : dec.decode(value as Uint8Array, { stream: true })
      let i: number
      while (!ended && (i = buf.indexOf('\n')) >= 0) { const l = buf.slice(0, i); buf = buf.slice(i + 1); yield* line(l) }
      if (buf.length > AI_LIMITS.lineChars) { bad(buf); buf = ''; if (mode === 'sse') over = true } // a runaway line: drop it
    }
    if (!ended) { buf += dec.decode(); if (buf) yield* line(buf); if (mode === 'sse') yield* line('') }
  } finally {
    try { await reader.cancel() } catch { /* already closed */ }
  }
}

/**
 * Reads an AI SDK UI message stream (the Response of `result.toUIMessageStreamResponse()`, or its body) as AiChunks,
 * without the `ai` package: it is SSE of JSON events, mapped by `toAiChunk`. Use it in useAiChat's `send`:
 * `(messages, { signal }) => fetch('/api/chat', { method: 'POST', body: …, signal }).then(fromAiSdkUIMessageStream)`.
 * A non-2xx Response throws (useAiChat shows it as an error part).
 */
export function fromAiSdkUIMessageStream(res: Response | ReadableStream<Uint8Array>): AsyncGenerator<AiChunk> {
  if (typeof ReadableStream !== 'undefined' && res instanceof ReadableStream) return parseAiStream(res, { format: 'sse' })
  const r = res as Response
  if (!r.ok) throw new Error(`Request failed (${r.status})`)
  if (!r.body) throw new Error('The response has no body')
  return parseAiStream(r.body, { format: 'sse' })
}

/** What `send` may return: chunks (or AI SDK events, or strings) as an async iterable, a stream of them or of bytes, a Response, or a promise of one of these. */
export type AiSendResult = AsyncIterable<AiChunk | string | Record<string, unknown>> | ReadableStream<AiChunk | Uint8Array | string> | Response
export type AiSend = (messages: AiMessage[], opts: { signal: AbortSignal }) => AiSendResult | Promise<AiSendResult>

/** Turns whatever `send` returned into one async iterable of AiChunks (bytes are parsed as SSE or NDJSON). */
export async function* aiChunksOf(src: AiSendResult | Promise<AiSendResult>): AsyncGenerator<AiChunk> {
  const s = await src
  if (typeof Response !== 'undefined' && s instanceof Response) { yield* fromAiSdkUIMessageStream(s); return }
  if (typeof ReadableStream !== 'undefined' && s instanceof ReadableStream) {
    const reader = (s as ReadableStream<unknown>).getReader()
    let first: ReadableStreamReadResult<unknown>
    try { first = await reader.read() } catch (e) { reader.releaseLock(); throw e }
    if (first.done) return
    const v = first.value
    if (ArrayBuffer.isView(v) || typeof v === 'string') { // bytes or text: hand the rest to the SSE / NDJSON parser
      let sent = false
      const rest = new ReadableStream<Uint8Array | string>({
        async pull(ctl) { if (!sent) { sent = true; ctl.enqueue(v as Uint8Array | string); return } const r = await reader.read(); if (r.done) ctl.close(); else ctl.enqueue(r.value as Uint8Array | string) },
        cancel() { return reader.cancel() },
      })
      yield* parseAiStream(rest); return
    }
    try {
      for (let r: ReadableStreamReadResult<unknown> = first; !r.done; r = await reader.read()) { const ch = toAiChunk(r.value); if (ch) yield ch }
    } finally { try { await reader.cancel() } catch { /* closed */ } }
    return
  }
  for await (const e of s as AsyncIterable<unknown>) { const ch = toAiChunk(e); if (ch) yield ch }
}

export type AiChatStatus = 'ready' | 'submitted' | 'streaming' | 'error'
export type AiChatOptions = {
  /** Calls your model and returns its stream. Abort the request when `signal` fires (Stop, regenerate, unmount). */
  send: AiSend
  initialMessages?: AiMessage[]
  /** The assistant message once it finished (also after Stop and on errors). */
  onFinish?: (message: AiMessage, messages: AiMessage[]) => void
  onError?: (error: unknown) => void
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
  error: unknown
  /** The prompt being typed, for inputs that don't keep their own text. */
  input: string
  setInput: (v: string) => void
  /** Sends a user message (text and/or files) and streams the reply. Returns false when busy or empty. */
  submit: (text: string, files?: File[], opts?: { metadata?: Record<string, unknown> }) => boolean
  /** Aborts the reply in flight; what arrived so far stays, marked `stopped`. */
  stop: () => void
  /** Drops the last assistant reply and asks again (also Retry after an error). */
  regenerate: () => void
  /** Approve or deny a tool call that is awaiting approval. Resolves once the host's handler finished. */
  decideTool: (toolId: string, approved: boolean) => Promise<void>
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
export function useAiChat({ send, initialMessages = [], onFinish, onError, onApprovalRequest, continueAfterApproval = true }: AiChatOptions): AiChat {
  const [messages, setMsgs] = useState<AiMessage[]>(initialMessages)
  const [status, setStatusState] = useState<AiChatStatus>('ready')
  const [error, setError] = useState<unknown>(null)
  const [input, setInput] = useState('')
  const live = useRef(messages), ctl = useRef<AbortController | null>(null), gen = useRef(0), pending = useRef<null | (() => void)>(null)
  const urls = useRef(new Set<string>()), alive = useRef(true), statusRef = useRef<AiChatStatus>('ready')
  const cb = useRef({ send, onFinish, onError, onApprovalRequest, continueAfterApproval })
  cb.current = { send, onFinish, onError, onApprovalRequest, continueAfterApproval }
  const setStatus = useCallback((s: AiChatStatus) => { statusRef.current = s; if (alive.current) setStatusState(s) }, [])

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
    setStatus('submitted'); setError(null)
    let started = false
    try {
      for await (const ch of aiChunksOf(cb.current.send(history, { signal: ac.signal }))) {
        if (g !== gen.current) return
        if (!started) { started = true; setStatus('streaming') }
        live.current = applyAiChunk(live.current, ch)
        schedule()
        if (ch.type === 'error') break
      }
      if (g !== gen.current) return
      let last = live.current[live.current.length - 1]
      if (last?.role === 'assistant' && last.status === 'streaming') { last = aiSettle(last, 'done'); live.current = [...live.current.slice(0, -1), last] }
      const failed = last?.role === 'assistant' && last.status === 'error'
      const err = failed ? new Error((last.parts.find(p => p.type === 'error') as AiErrorPart | undefined)?.message ?? 'Stream error') : null
      flush(); setStatus(failed ? 'error' : 'ready'); if (err) setError(err)
      finish(err)
    } catch (err) {
      if (g !== gen.current || ac.signal.aborted) return
      live.current = applyAiChunk(live.current, { type: 'error', message: aiStr(err) || 'Something went wrong' })
      flush(); setStatus('error'); setError(err)
      finish(err ?? new Error('Something went wrong'))
    } finally { if (ctl.current === ac) ctl.current = null }
  }, [finish, flush, schedule, setStatus])

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
    patch(t => ({ ...t, approval: { ...t.approval, approved }, state: !approved ? 'error' : host ? 'running' : 'pending', ...(approved ? {} : { error: 'Denied. The tool was not run.' }) }))
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
  }, [flush, run])

  const setMessages = useCallback((m: AiMessage[] | ((m: AiMessage[]) => AiMessage[])) => commit(typeof m === 'function' ? m(live.current) : m), [commit])

  return { messages, status, busy: status === 'submitted' || status === 'streaming', error, input, setInput, submit, stop, regenerate, decideTool, setMessages }
}
