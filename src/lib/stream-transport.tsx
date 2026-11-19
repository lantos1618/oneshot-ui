import { tryJson } from './core'

type JsonStreamFormat = 'auto' | 'sse' | 'ndjson'
type JsonStreamEnd = { done: boolean; values: number; malformed: number }
type JsonStreamOptions = { format?: JsonStreamFormat; maxChars: number; onMalformed?: (line: string) => void }

async function* withStreamReader<T, R>(stream: ReadableStream<T>, read: (reader: ReadableStreamDefaultReader<T>) => AsyncGenerator<unknown, R>): AsyncGenerator<unknown, R> {
  const reader = stream.getReader()
  try {
    return yield* read(reader)
  } finally {
    try { await reader.cancel() } catch { /* the source may have errored */ }
    reader.releaseLock()
  }
}

async function* decodeJsonStream(reader: ReadableStreamDefaultReader<unknown>, { format = 'auto', maxChars, onMalformed }: JsonStreamOptions,
  first?: ReadableStreamReadResult<unknown>): AsyncGenerator<unknown, JsonStreamEnd> {
  const dec = new TextDecoder()
  let mode = format === 'auto' ? null : format
  let buf = '', data: string | undefined, over = false, done = false, values = 0, malformed = 0
  const bad = (s: string) => { malformed++; onMalformed?.(s) }

  function* value(s: string): Generator<unknown> {
    const j = tryJson(s)
    if (!j.ok) { bad(s); return }
    values++
    yield j.v
  }

  function* line(raw: string): Generator<unknown> {
    const l = raw.endsWith('\r') ? raw.slice(0, -1) : raw
    if (!mode) {
      if (!l.trim()) return
      mode = /^(data|event|id|retry):|^:/.test(l) ? 'sse' : 'ndjson'
    }
    if (mode === 'ndjson') {
      if (!l.trim()) return
      if (l.length > maxChars) bad(l)
      else yield* value(l)
      return
    }
    if (!l) {
      if (data !== undefined && !over) {
        if (data.trim() === '[DONE]') done = true
        else yield* value(data)
      }
      data = undefined; over = false
      return
    }
    if (l.startsWith(':')) return
    if (!l.startsWith('data:')) {
      if (!/^(event|id|retry)(:|$)/.test(l)) bad(l)
      return
    }
    if (over) return
    const part = l.slice(5).replace(/^ /, '')
    const size = data === undefined ? part.length : data.length + 1 + part.length
    if (size > maxChars) { bad(part); over = true; data = undefined }
    else data = data === undefined ? part : data + '\n' + part
  }

  // Keep only enough of a line to detect overflow, including an SSE prefix and optional CR.
  // Discard the rest through the next newline so a split suffix can't be mistaken for another value.
  const lineCap = Math.max(0, maxChars) + 'data: \r'.length + 1
  function* text(chunk: string): Generator<unknown> {
    for (let start = 0; !done && start < chunk.length;) {
      const newline = chunk.indexOf('\n', start)
      const end = newline === -1 ? chunk.length : newline
      buf += chunk.slice(start, Math.min(end, start + lineCap - buf.length))
      if (newline === -1) return
      yield* line(buf)
      buf = ''
      start = newline + 1
    }
  }

  for (let next = first ?? await reader.read(); !next.done; next = await reader.read()) {
    yield* text(typeof next.value === 'string' ? next.value : dec.decode(next.value as Uint8Array, { stream: true }))
    if (done) return { done, values, malformed }
  }
  yield* text(dec.decode())
  if (!done && buf) yield* line(buf)
  if (!done && mode === 'sse') yield* line('')
  return { done, values, malformed }
}

function readJsonStream(stream: ReadableStream<Uint8Array | string>, opts: JsonStreamOptions): AsyncGenerator<unknown, JsonStreamEnd> {
  return withStreamReader(stream, reader => decodeJsonStream(reader, opts))
}

async function* readStreamSource(src: Response | ReadableStream<unknown> | AsyncIterable<unknown>, opts: JsonStreamOptions): AsyncGenerator<unknown, JsonStreamEnd | null> {
  if (typeof Response !== 'undefined' && src instanceof Response) {
    if (!src.ok) throw new Error(`Request failed (${src.status})`)
    if (!src.body) throw new Error('The response has no body')
    return yield* readJsonStream(src.body, opts)
  }
  if (typeof ReadableStream !== 'undefined' && src instanceof ReadableStream) {
    return yield* withStreamReader(src, async function* (reader) {
      const first = await reader.read()
      if (first.done) return null
      if (ArrayBuffer.isView(first.value) || typeof first.value === 'string') return yield* decodeJsonStream(reader, opts, first)
      for (let next: ReadableStreamReadResult<unknown> = first; !next.done; next = await reader.read()) yield next.value
      return null
    })
  }
  yield* src as AsyncIterable<unknown>
  return null
}

export { readJsonStream, readStreamSource, type JsonStreamEnd, type JsonStreamFormat }
