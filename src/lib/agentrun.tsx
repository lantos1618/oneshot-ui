import { useCallback, useEffect, useRef, useState } from 'react'
import { tryJson } from './core'

export type AgentSpanKind = 'agent' | 'llm' | 'tool' | 'retrieval' | 'chain' | 'human'
export type AgentSpanStatus = 'running' | 'ok' | 'error' | 'cancelled'
/** Token usage. `input` includes `cached` (prompt tokens served from the provider's cache). */
export type AgentTokens = { input: number; output: number; cached?: number }
/** One unit of work in a run: an agent, a model call, a tool call, a retrieval, a chain step or a wait for a person. */
export type AgentSpan = {
  id: string; parentId?: string; kind: AgentSpanKind; name: string; model?: string
  /** epoch ms; `endMs` is unset while the span runs */
  startMs: number; endMs?: number; status: AgentSpanStatus
  tokens?: AgentTokens; costUsd?: number
  /** what went wrong, for status 'error' */
  error?: string
  /** the source's own fields (gen_ai.*, tool input and output…), strings capped at AGENT_RUN_LIMITS.attrChars */
  attributes: Record<string, unknown>
}
export type AgentEventKind = 'approval' | 'handoff' | 'error' | 'retry' | 'note'
/** A moment in a run: an approval, a handoff between agents, an error, a retry or a note. */
export type AgentEvent = { id: string; kind: AgentEventKind; atMs: number; label: string; spanId?: string; detail?: string; attributes?: Record<string, unknown> }
/** A whole run. `status` is 'running' until a run-end arrives. */
export type AgentRun = {
  id: string; name: string; startedAt: number; endedAt?: number; status: AgentSpanStatus
  spans: AgentSpan[]; events: AgentEvent[]; attributes?: Record<string, unknown>
}
/** What a span-start carries: at least an id, kind, name and start; the rest is optional. */
export type AgentSpanStart = Pick<AgentSpan, 'id' | 'kind' | 'name' | 'startMs'> & Partial<Omit<AgentSpan, 'id' | 'kind' | 'name' | 'startMs'>>
/** One streaming update of a run (what `applyRunEvent` folds). */
export type AgentRunEvent =
  | { type: 'run-start'; at: number; id?: string; name?: string; attributes?: Record<string, unknown> }
  | { type: 'span-start'; span: AgentSpanStart }
  | { type: 'span-update'; id: string; kind?: AgentSpanKind; name?: string; model?: string; tokens?: AgentTokens; costUsd?: number; attributes?: Record<string, unknown> }
  | { type: 'span-end'; id: string; endMs: number; status?: Exclude<AgentSpanStatus, 'running'>; error?: string; model?: string; tokens?: AgentTokens; costUsd?: number; attributes?: Record<string, unknown> }
  | { type: 'event'; event: AgentEvent }
  | { type: 'run-end'; at: number; status?: Exclude<AgentSpanStatus, 'running'> }
  | { type: 'snapshot'; run: AgentRun }

/** Caps: spans and events per run, characters per attribute string, error and label text, span and model names, stream lines, ancestor depth. Excess is dropped, not thrown. */
export const AGENT_RUN_LIMITS = { spans: 5_000, events: 2_000, attrChars: 2_000, textChars: 1_000, nameChars: 300, modelChars: 200, lineChars: 1_000_000, depth: 64 }

const AR_KINDS = new Set<AgentSpanKind>(['agent', 'llm', 'tool', 'retrieval', 'chain', 'human'])
const AR_EVENT_KINDS = new Set<AgentEventKind>(['approval', 'handoff', 'error', 'retry', 'note'])
const AR_UPDATES = new Set(['run-start', 'span-start', 'span-update', 'span-end', 'event', 'run-end', 'snapshot'])

const arCap = (s: string, n: number) => s.length > n ? s.slice(0, n) + '…' : s
const arJson = (v: unknown) => { try { return JSON.stringify(v) ?? String(v) } catch { return String(v) } }
/** Any value as display text, capped. */
const arText = (v: unknown, n = AGENT_RUN_LIMITS.textChars) => arCap(typeof v === 'string' ? v : v instanceof Error ? v.message : arJson(v), n)
const arNum = (v: unknown): number | undefined => {
  const n = typeof v === 'number' ? v : typeof v === 'bigint' ? Number(v) : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN
  return Number.isFinite(n) ? n : undefined
}
/** A time as epoch ms: a Date, an ISO string, or a number in s, ms, µs or ns (told apart by size). */
const arTime = (v: unknown): number | undefined => {
  if (v instanceof Date) { const t = v.getTime(); return Number.isFinite(t) ? t : undefined }
  if (typeof v === 'string' && !/^\s*\d+(\.\d+)?\s*$/.test(v)) { const t = Date.parse(v); return Number.isFinite(t) ? t : undefined }
  // integer ns (19 digits) and µs (16) strings: split, so the ms part keeps its precision (Number('…ns') would round)
  if (typeof v === 'string' && /^\s*\d{16,19}\s*$/.test(v)) { const d = v.trim(), k = d.length >= 18 ? 6 : 3; return Number(d.slice(0, -k)) + Number(d.slice(-k)) / 10 ** k }
  const n = arNum(v)
  if (n === undefined || n <= 0) return undefined
  return n > 1e17 ? n / 1e6 : n > 1e14 ? n / 1e3 : n > 1e11 ? n : n * 1000
}
/** An attribute value as stored: primitives as they are (strings capped), anything else as capped JSON. */
const arAttr = (v: unknown): unknown => {
  if (v == null || typeof v === 'number' || typeof v === 'boolean') return v
  if (typeof v === 'string') return arCap(v, AGENT_RUN_LIMITS.attrChars)
  if (Array.isArray(v) && v.every(x => x == null || typeof x !== 'object')) return v.slice(0, 50).map(arAttr)
  return arCap(arJson(v), AGENT_RUN_LIMITS.attrChars)
}
const arAttrs = (a: Record<string, unknown> | undefined): Record<string, unknown> => {
  const out: Record<string, unknown> = {}
  if (a) for (const [k, v] of Object.entries(a)) if (v !== undefined) out[k] = arAttr(v)
  return out
}
const arTokens = (t: AgentTokens | undefined): AgentTokens | undefined => {
  if (!t) return undefined
  const input = arNum(t.input) ?? 0, output = arNum(t.output) ?? 0, cached = arNum(t.cached)
  return { input, output, ...(cached ? { cached } : {}) }
}
const arObj = (v: unknown): Record<string, unknown> | null => v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : null

/** Is it a whole AgentRun (spans and events arrays)? */
const arIsRun = (v: unknown): v is AgentRun => { const o = arObj(v); return !!o && Array.isArray(o.spans) && Array.isArray(o.events) && typeof o.startedAt === 'number' }

/** The time an update happened at (epoch ms), if it carries one. */
function arEventTime(e: AgentRunEvent): number | undefined {
  switch (e.type) {
    case 'run-start': case 'run-end': return e.at
    case 'span-start': return e.span?.startMs
    case 'span-end': return e.endMs
    case 'event': return e.event?.atMs
    case 'snapshot': return e.run?.startedAt
    default: return undefined
  }
}

/** The span ids of a run's roots (no parent, or a parent the run doesn't have). */
const arRoots = (spans: readonly AgentSpan[]) => { const ids = new Set(spans.map(s => s.id)); return spans.filter(s => !s.parentId || !ids.has(s.parentId)) }

/** A span's ancestors, nearest first (at most AGENT_RUN_LIMITS.depth, so a cyclic parent chain ends). */
export function* spanAncestors(span: AgentSpan, byId: ReadonlyMap<string, AgentSpan>, max = AGENT_RUN_LIMITS.depth): Generator<AgentSpan> {
  for (let p = span.parentId ? byId.get(span.parentId) : undefined, n = 0; p && n < max; p = p.parentId ? byId.get(p.parentId) : undefined, n++) yield p
}
/** The closest ancestor of a span that is an agent. */
export function nearestAgent(span: AgentSpan, byId: ReadonlyMap<string, AgentSpan>): AgentSpan | undefined {
  for (const p of spanAncestors(span, byId)) if (p.kind === 'agent') return p
  return undefined
}

type ArFields = { name?: string; model?: string; tokens?: AgentTokens; costUsd?: number; error?: string; attributes?: Record<string, unknown> }
/** The optional fields an update carries, sanitised and capped, with attributes merged over the span's own. */
const arPatchFields = (old: AgentSpan | undefined, e: ArFields): Partial<AgentSpan> => ({
  ...(e.name ? { name: arText(e.name, AGENT_RUN_LIMITS.nameChars) } : {}), ...(e.model ? { model: arText(e.model, AGENT_RUN_LIMITS.modelChars) } : {}),
  ...(e.tokens ? { tokens: arTokens(e.tokens) } : {}), ...(e.costUsd != null ? { costUsd: arNum(e.costUsd) } : {}),
  ...(e.error ? { error: arText(e.error) } : {}), ...(e.attributes ? { attributes: { ...old?.attributes, ...arAttrs(e.attributes) } } : {}),
})
/** The `error:<span>` event a failed span adds (its id makes replays idempotent). */
const arErrorEvent = (s: AgentSpan, atMs: number): AgentEvent => ({ id: `error:${s.id}`, kind: 'error', atMs, label: s.name, spanId: s.id, ...(s.error ? { detail: s.error } : {}) })

/** Inserts or replaces an event (same id), keeping events in time order. */
function arUpsertEvent(events: AgentEvent[], ev: AgentEvent): AgentEvent[] {
  const rest = events.filter(e => e.id !== ev.id)
  if (rest.length === events.length && rest.length >= AGENT_RUN_LIMITS.events) return events
  let i = rest.length
  while (i > 0 && rest[i - 1].atMs > ev.atMs) i--
  return [...rest.slice(0, i), ev, ...rest.slice(i)]
}
/** A handoff event when a span becomes an agent: from the agent that started most recently before it. */
function arHandoff(spans: readonly AgentSpan[], events: AgentEvent[], s: AgentSpan): AgentEvent[] {
  let prev: AgentSpan | undefined
  for (const x of spans) if (x !== s && x.id !== s.id && x.kind === 'agent' && x.startMs <= s.startMs && (!prev || x.startMs >= prev.startMs)) prev = x
  if (!prev || events.some(e => e.id === `handoff:${s.id}`)) return events
  return arUpsertEvent(events, { id: `handoff:${s.id}`, kind: 'handoff', atMs: s.startMs, label: `${prev.name} → ${s.name}`, spanId: s.id, attributes: { from: prev.id, to: s.id } })
}

/**
 * Pure reducer for one streaming update: returns a new run (the old one is never mutated). `run` may be null: the
 * first update opens one. span-start inserts or merges a span; span-update patches it; span-end closes it (an
 * `error` makes its status 'error' and adds an error event); a span that becomes an agent adds a handoff event from the
 * agent that started before it; `event` inserts or replaces an event by id (auto events have ids `error:<span>` and
 * `handoff:<span>`, so replaying a run never duplicates them); run-end closes the run and any span still open;
 * snapshot replaces the run. Unknown updates change nothing; everything is capped by AGENT_RUN_LIMITS.
 */
export function applyRunEvent(run: AgentRun | null | undefined, e: AgentRunEvent): AgentRun {
  const base = (): AgentRun => run ?? { id: 'run', name: '', startedAt: (e && arEventTime(e)) ?? Date.now(), status: 'running', spans: [], events: [] }
  if (!e || typeof e !== 'object' || !AR_UPDATES.has((e as { type: string }).type)) return base()
  if (e.type === 'snapshot') return arIsRun(e.run) ? e.run : base()
  const r = base()
  const find = (id: string) => { for (let i = r.spans.length - 1; i >= 0; i--) if (r.spans[i].id === id) return i; return -1 }
  switch (e.type) {
    case 'run-start': {
      const at = arNum(e.at) ?? r.startedAt
      return { ...r, ...(e.id != null ? { id: String(e.id) } : {}), ...(e.name != null ? { name: arText(e.name, AGENT_RUN_LIMITS.nameChars) } : {}), startedAt: run && r.spans.length ? Math.min(r.startedAt, at) : at,
        status: 'running', endedAt: undefined, ...(e.attributes ? { attributes: { ...r.attributes, ...arAttrs(e.attributes) } } : {}) }
    }
    case 'span-start': {
      const s = e.span
      if (!s || s.id == null) return r
      const id = String(s.id), i = find(id), old = i >= 0 ? r.spans[i] : undefined
      if (!old && r.spans.length >= AGENT_RUN_LIMITS.spans) return r
      const startMs = arNum(s.startMs) ?? old?.startMs ?? r.startedAt
      const span: AgentSpan = {
        ...old, id, kind: AR_KINDS.has(s.kind) ? s.kind : old?.kind ?? 'chain', name: arText(s.name ?? old?.name ?? id, AGENT_RUN_LIMITS.nameChars), startMs,
        status: s.status ?? old?.status ?? 'running', attributes: { ...old?.attributes, ...arAttrs(s.attributes) },
        ...(s.parentId != null ? { parentId: String(s.parentId) } : {}), ...(s.endMs != null ? { endMs: arNum(s.endMs) } : {}),
        ...arPatchFields(old, { model: s.model, tokens: s.tokens, costUsd: s.costUsd, error: s.error }),
      }
      const spans = i >= 0 ? r.spans.map((x, k) => k === i ? span : x) : [...r.spans, span]
      let events = span.kind === 'agent' && old?.kind !== 'agent' ? arHandoff(spans, r.events, span) : r.events
      if (span.status === 'error') events = arUpsertEvent(events, arErrorEvent(span, span.endMs ?? startMs))
      return { ...r, startedAt: Math.min(r.startedAt, startMs), spans, events }
    }
    case 'span-update': {
      const i = find(String(e.id))
      if (i < 0) return r
      const old = r.spans[i]
      const span: AgentSpan = { ...old, ...(e.kind && AR_KINDS.has(e.kind) ? { kind: e.kind } : {}), ...arPatchFields(old, e) }
      const spans = r.spans.map((x, k) => k === i ? span : x)
      return { ...r, spans, events: span.kind === 'agent' && old.kind !== 'agent' ? arHandoff(spans, r.events, span) : r.events }
    }
    case 'span-end': {
      const i = find(String(e.id))
      if (i < 0) return r
      const old = r.spans[i], endMs = Math.max(old.startMs, arNum(e.endMs) ?? old.startMs)
      const status = e.status ?? (e.error ? 'error' : 'ok')
      const span: AgentSpan = { ...old, endMs, status, ...arPatchFields(old, e) }
      const events = status === 'error' ? arUpsertEvent(r.events, arErrorEvent(span, endMs)) : r.events
      return { ...r, spans: r.spans.map((x, k) => k === i ? span : x), events }
    }
    case 'event': {
      const v = e.event
      if (!v || v.id == null) return r
      const ev: AgentEvent = { id: String(v.id), kind: AR_EVENT_KINDS.has(v.kind) ? v.kind : 'note', atMs: arNum(v.atMs) ?? r.startedAt, label: arText(v.label ?? v.kind ?? '', 300),
        ...(v.spanId != null ? { spanId: String(v.spanId) } : {}), ...(v.detail ? { detail: arText(v.detail) } : {}), ...(v.attributes ? { attributes: arAttrs(v.attributes) } : {}) }
      return { ...r, events: arUpsertEvent(r.events, ev) }
    }
    case 'run-end': {
      const at = arNum(e.at) ?? Date.now()
      const closing = e.status === 'cancelled' || e.status === 'error' ? 'cancelled' as const : 'ok' as const
      const spans = r.spans.map(s => s.endMs == null || s.status === 'running' ? { ...s, endMs: Math.max(s.startMs, s.endMs ?? at), status: s.status === 'running' ? closing : s.status } : s)
      const roots = arRoots(spans)
      const status = e.status ?? (roots.some(s => s.status === 'error') ? 'error' : 'ok')
      return { ...r, spans, endedAt: Math.max(r.startedAt, at), status }
    }
  }
  return r
}

/** Folds a list of updates into a run (null when the list is empty). */
export function runFromEvents(events: Iterable<AgentRunEvent>, run: AgentRun | null = null): AgentRun | null {
  let r = run
  for (const e of events) r = applyRunEvent(r, e)
  return r
}

/**
 * A run as the updates that build it, in time order (run-start, span starts and ends, events, run-end): feed them to
 * `replayRun` to watch a recorded run happen again, or send them over a socket. `runFromEvents(runToEvents(run))`
 * gives the run back.
 */
export function runToEvents(run: AgentRun): AgentRunEvent[] {
  const byId = new Map(run.spans.map(s => [s.id, s]))
  const depth = (s: AgentSpan) => [...spanAncestors(s, byId)].length
  const items: { t: number; rank: number; d: number; e: AgentRunEvent }[] = []
  for (const s of run.spans) {
    const d = depth(s)
    const { endMs, status, error, tokens, costUsd, ...start } = s
    items.push({ t: s.startMs, rank: 1, d, e: { type: 'span-start', span: { ...start, status: 'running' } } })
    if (endMs != null && status !== 'running') items.push({ t: endMs, rank: 0, d: -d, e: { type: 'span-end', id: s.id, endMs, status, ...(error ? { error } : {}), ...(tokens ? { tokens } : {}), ...(costUsd != null ? { costUsd } : {}) } })
    else if (tokens || costUsd != null) items.push({ t: s.startMs, rank: 1, d: d + 0.5, e: { type: 'span-update', id: s.id, ...(tokens ? { tokens } : {}), ...(costUsd != null ? { costUsd } : {}) } })
  }
  for (const ev of run.events) items.push({ t: ev.atMs, rank: 2, d: 0, e: { type: 'event', event: ev } })
  // same moment: ends first (children before parents), then starts (parents before children), then events
  items.sort((a, b) => a.t - b.t || a.rank - b.rank || a.d - b.d)
  const out: AgentRunEvent[] = [{ type: 'run-start', at: run.startedAt, id: run.id, name: run.name, ...(run.attributes ? { attributes: run.attributes } : {}) }, ...items.map(x => x.e)]
  if (run.status !== 'running') out.push({ type: 'run-end', at: run.endedAt ?? Math.max(run.startedAt, ...items.map(x => x.t)), status: run.status })
  return out
}

/** An update with every time passed through `f` (for replays rebased to now). */
function arShift(e: AgentRunEvent, f: (t: number) => number): AgentRunEvent {
  switch (e.type) {
    case 'run-start': case 'run-end': return { ...e, at: f(e.at) }
    case 'span-start': return { ...e, span: { ...e.span, startMs: f(e.span.startMs), ...(e.span.endMs != null ? { endMs: f(e.span.endMs) } : {}) } }
    case 'span-end': return { ...e, endMs: f(e.endMs) }
    case 'event': return { ...e, event: { ...e.event, atMs: f(e.event.atMs) } }
    case 'snapshot': { const r = e.run; return { ...e, run: { ...r, startedAt: f(r.startedAt), ...(r.endedAt != null ? { endedAt: f(r.endedAt) } : {}), spans: r.spans.map(s => ({ ...s, startMs: f(s.startMs), ...(s.endMs != null ? { endMs: f(s.endMs) } : {}) })), events: r.events.map(v => ({ ...v, atMs: f(v.atMs) })) } } }
    default: return e
  }
}
const arSleep = (ms: number, signal?: AbortSignal) => new Promise<void>(res => {
  if (signal?.aborted) return res()
  const t = setTimeout(done, ms)
  function done() { clearTimeout(t); signal?.removeEventListener('abort', done); res() }
  signal?.addEventListener('abort', done)
})

/**
 * Plays a recorded run (or a list of updates) back as a live stream: each update is yielded at its own moment,
 * `speed` times faster, with its times rebased so the run starts now (`rebase: false` keeps them). Pass the result to
 * `useAgentRun` and the views animate as if the run were happening. Stops when `signal` aborts.
 */
export async function* replayRun(source: AgentRun | readonly AgentRunEvent[], { speed = 1, signal, rebase = true }: { speed?: number; signal?: AbortSignal; rebase?: boolean } = {}): AsyncGenerator<AgentRunEvent> {
  const evs = Array.isArray(source) ? source as readonly AgentRunEvent[] : runToEvents(source as AgentRun)
  if (!evs.length) return
  const k = speed > 0 ? speed : 1
  const t0 = evs.reduce((m, e) => Math.min(m, arEventTime(e) ?? Infinity), Infinity)
  const base = Date.now(), from = Number.isFinite(t0) ? t0 : base
  const map = (t: number) => rebase ? base + (t - from) / k : t
  for (const e of evs) {
    if (signal?.aborted) return
    const t = arEventTime(e) ?? from, wait = base + (t - from) / k - Date.now()
    if (wait > 4) await arSleep(wait, signal)
    if (signal?.aborted) return
    yield arShift(e, map)
  }
}

/** Prices in USD per million tokens, by model id (a key also matches model ids that start with it, longest key first). */
export type AgentPricing = Record<string, { input: number; output: number; /** cached input tokens (default: input) */ cachedInput?: number }>
/** A model call's cost from its tokens and a price table, or undefined when the model has no price. */
export function agentSpanCost(model: string | undefined, tokens: AgentTokens | undefined, pricing: AgentPricing | undefined): number | undefined {
  if (!model || !tokens || !pricing) return undefined
  const key = Object.prototype.hasOwnProperty.call(pricing, model) ? model : Object.keys(pricing).filter(k => model.startsWith(k)).sort((a, b) => b.length - a.length)[0]
  const p = key ? pricing[key] : undefined
  if (!p) return undefined
  const cached = Math.min(tokens.cached ?? 0, tokens.input)
  return ((tokens.input - cached) * p.input + cached * (p.cachedInput ?? p.input) + tokens.output * p.output) / 1e6
}
/** The latest moment a run reports (its end, or the last start, end or event seen so far). */
export function runLatestMs(run: AgentRun): number {
  let t = run.endedAt ?? run.startedAt
  for (const s of run.spans) t = Math.max(t, s.endMs ?? s.startMs)
  for (const e of run.events) t = Math.max(t, e.atMs)
  return t
}
export type AgentRunTotals = { durationMs: number; tokens: AgentTokens; costUsd: number; llmCalls: number; toolCalls: number; errors: number; running: number }
/**
 * A run's totals: duration (to `now` while running, default the latest moment it reports), tokens and cost of the
 * model calls (spans of other kinds that carry usage are counted only when no model call does, so an agent's own
 * total never doubles its calls), model and tool calls (retrievals count as tools), errors and spans still running.
 */
export function runTotals(run: AgentRun, now?: number): AgentRunTotals {
  const llm = run.spans.filter(s => s.kind === 'llm'), metered = llm.some(s => s.tokens || s.costUsd != null) ? llm : run.spans.filter(s => s.tokens || s.costUsd != null)
  const tokens = { input: 0, output: 0, cached: 0 }
  let cost = 0
  for (const s of metered) { tokens.input += s.tokens?.input ?? 0; tokens.output += s.tokens?.output ?? 0; tokens.cached += s.tokens?.cached ?? 0; cost += s.costUsd ?? 0 }
  const end = run.status === 'running' ? (now ?? runLatestMs(run)) : run.endedAt ?? runLatestMs(run)
  return {
    durationMs: Math.max(0, end - run.startedAt), tokens, costUsd: cost, llmCalls: llm.length,
    toolCalls: run.spans.filter(s => s.kind === 'tool' || s.kind === 'retrieval').length,
    errors: run.spans.filter(s => s.status === 'error').length, running: run.spans.filter(s => s.status === 'running').length,
  }
}

/** A run's step as a LaneGraph node: `span` is the step, `group` the agent it ran under (lanes are coloured by it). */
export type AgentRunLaneNode = { id: string; parents: string[]; time: number; group: string; span: AgentSpan }
/**
 * A run's steps as LaneGraph nodes, in start order: each step's parents are the steps it waited for, i.e. the latest
 * steps that had finished when it started (parallel tool calls fan out from the model call that asked for them and fan
 * back in to the next call). Steps are the spans without children by default (`include` to choose others); a step
 * still running when another starts doesn't link to it. Use with `<LaneGraph nodes={runLaneNodes(run)} order="input" direction="up" />`.
 */
export function runLaneNodes(run: AgentRun, { include }: { include?: (span: AgentSpan) => boolean } = {}): AgentRunLaneNode[] {
  const byId = new Map(run.spans.map(s => [s.id, s])), parents = new Set(run.spans.map(s => s.parentId).filter(Boolean))
  const steps = run.spans.filter(include ?? (s => !parents.has(s.id))).slice(0, 2_000)
    .map((s, i) => ({ s, i })).sort((a, b) => a.s.startMs - b.s.startMs || a.i - b.i).map(x => x.s)
  const agentOf = (s: AgentSpan) => nearestAgent(s, byId)?.name ?? arRoots(run.spans)[0]?.name ?? run.name
  return steps.map((s, k) => {
    const done = steps.slice(0, k).filter(p => p.endMs != null && p.endMs <= s.startMs + 1)
    const latest = done.reduce((m, p) => Math.max(m, p.startMs), -Infinity)
    return { id: s.id, parents: done.filter(p => p.endMs! > latest || p.startMs >= latest).map(p => p.id), time: s.startMs, group: agentOf(s), span: s }
  })
}

/**
 * Decodes a byte (or string) stream of JSON values: Server-Sent Events (`data: {…}`, events end at a blank line,
 * `[DONE]` ends the stream) or NDJSON (one value per line), told apart by the first line. Malformed lines are skipped;
 * a line longer than AGENT_RUN_LIMITS.lineChars is dropped. Leaving the loop early cancels the stream.
 */
export async function* parseRunStream(stream: ReadableStream<Uint8Array | string>): AsyncGenerator<unknown> {
  const reader = stream.getReader(), dec = new TextDecoder()
  let buf = '', mode: 'sse' | 'ndjson' | null = null, data: string[] = [], ended = false
  function* line(raw: string): Generator<unknown> {
    const l = raw.endsWith('\r') ? raw.slice(0, -1) : raw
    if (!mode) { if (!l.trim()) return; mode = /^(data|event|id|retry):|^:/.test(l) ? 'sse' : 'ndjson' }
    if (mode === 'ndjson') { if (!l.trim() || l.length > AGENT_RUN_LIMITS.lineChars) return; const j = tryJson(l); if (j.ok) yield j.v; return }
    if (!l) { const s = data.join('\n'); data = []; if (!s) return; if (s.trim() === '[DONE]') { ended = true; return } const j = tryJson(s); if (j.ok) yield j.v; return }
    if (l.startsWith('data:') && data.join('').length < AGENT_RUN_LIMITS.lineChars) data.push(l.slice(5).replace(/^ /, ''))
  }
  try {
    while (!ended) {
      const { value, done } = await reader.read()
      if (done) break
      buf += typeof value === 'string' ? value : dec.decode(value, { stream: true })
      let i: number
      while (!ended && (i = buf.indexOf('\n')) >= 0) { const l = buf.slice(0, i); buf = buf.slice(i + 1); yield* line(l) }
      if (buf.length > AGENT_RUN_LIMITS.lineChars) buf = ''
    }
    if (!ended) { buf += dec.decode(); if (buf) yield* line(buf); if (mode === 'sse') yield* line('') }
  } finally { try { await reader.cancel() } catch { /* closed */ } }
}

/** Something that turns one item of a source (your server's event, an AI SDK part, a LangGraph event) into updates. */
export type AgentRunMapper = (item: unknown) => AgentRunEvent | readonly AgentRunEvent[] | null | undefined
/** Polls a run: `fetchRun` every `intervalMs` (default 1000) until the run is no longer running. */
export type AgentRunPoll = { fetchRun: (signal: AbortSignal) => Promise<AgentRun | null | undefined>; intervalMs?: number }
type ArStreamish = AsyncIterable<unknown> | ReadableStream<unknown> | Response
/**
 * What useAgentRun reads: a finished or running AgentRun (shown as it is), an async iterable or ReadableStream of
 * updates (or of anything a `mapper` understands; bytes are parsed as SSE or NDJSON), a fetch Response, a function
 * that opens one of these given an AbortSignal, or `{ fetchRun, intervalMs }` to poll. Keep it stable (memoise it):
 * a new source starts over.
 */
export type AgentRunSource = AgentRun | ArStreamish | ((signal: AbortSignal) => ArStreamish | Promise<ArStreamish>) | AgentRunPoll | null | undefined
export type UseAgentRunOptions = {
  /** makes a mapper for each new source (stateful mappers such as `langGraphRunMapper` start fresh); default: items are AgentRunEvents or AgentRuns */
  mapper?: () => AgentRunMapper
  /** the run to show before the source sends anything */
  initial?: AgentRun | null
  /**
   * when a stream ends before its run-end, close the run as 'cancelled' at its latest moment (default true). Either
   * way the stream counts as closed early: `closedEarly` turns true, `status` becomes 'error' and `onError` gets an
   * AgentRunClosedEarlyError. Only an explicit run-end makes a run 'ok'.
   */
  endOnClose?: boolean
  onError?: (error: unknown) => void
}
export type AgentRunStatus = 'idle' | 'connecting' | 'live' | 'done' | 'error'
export type AgentRunState = {
  run: AgentRun | null; status: AgentRunStatus; error: unknown
  /** the stream ended before the run did (no run-end): the run is truncated, not finished */
  closedEarly: boolean
  /** applies updates by hand (a WebSocket handler, a test), rendered on the next frame */
  push: (events: AgentRunEvent | readonly AgentRunEvent[]) => void
  /** replaces the run (or clears it) */
  reset: (run?: AgentRun | null) => void
}

/** What useAgentRun reports when a stream ends while its run is still running. */
export class AgentRunClosedEarlyError extends Error {
  readonly run: AgentRun
  constructor(run: AgentRun) { super('The run’s stream closed before the run ended'); this.name = 'AgentRunClosedEarlyError'; this.run = run }
}

const arIsPoll = (v: unknown): v is AgentRunPoll => !!arObj(v) && typeof (v as AgentRunPoll).fetchRun === 'function'
/** Every item of a source, bytes decoded. */
async function* arItems(src: ArStreamish | ((signal: AbortSignal) => ArStreamish | Promise<ArStreamish>), signal: AbortSignal): AsyncGenerator<unknown> {
  const s = typeof src === 'function' ? await src(signal) : src
  if (typeof Response !== 'undefined' && s instanceof Response) {
    if (!s.ok) throw new Error(`Request failed (${s.status})`)
    if (!s.body) throw new Error('The response has no body')
    yield* parseRunStream(s.body); return
  }
  if (typeof ReadableStream !== 'undefined' && s instanceof ReadableStream) {
    const reader = (s as ReadableStream<unknown>).getReader()
    const first = await reader.read()
    if (first.done) return
    const v = first.value
    if (ArrayBuffer.isView(v) || typeof v === 'string') {
      let sent = false
      const rest = new ReadableStream<Uint8Array | string>({
        async pull(ctl) { if (!sent) { sent = true; ctl.enqueue(v as Uint8Array | string); return } const r = await reader.read(); if (r.done) ctl.close(); else ctl.enqueue(r.value as Uint8Array | string) },
        cancel() { return reader.cancel() },
      })
      yield* parseRunStream(rest); return
    }
    try { for (let r: ReadableStreamReadResult<unknown> = first; !r.done; r = await reader.read()) yield r.value } finally { try { await reader.cancel() } catch { /* closed */ } }
    return
  }
  yield* s as AsyncIterable<unknown>
}
/** One item as updates: through the mapper, else taken as an update or a whole run. */
function arMapItem(item: unknown, map: AgentRunMapper | undefined): readonly AgentRunEvent[] {
  if (map) { const out = map(item); return out == null ? [] : Array.isArray(out) ? out : [out as AgentRunEvent] }
  if (arIsRun(item)) return [{ type: 'snapshot', run: item }]
  const o = arObj(item)
  return o && typeof o.type === 'string' && AR_UPDATES.has(o.type) ? [o as AgentRunEvent] : []
}

/**
 * A run as React state, from a live stream, a poll or a recorded run (see AgentRunSource). Updates are folded with
 * `applyRunEvent` and rendered at most once per animation frame however fast they arrive (a timer while the tab is
 * hidden). `status` is 'connecting' until the first update, 'live' while they arrive, then 'done' (or 'error'). A new
 * source aborts the old one (its signal fires) and starts over.
 *
 *   const { run } = useAgentRun(useMemo(() => (signal) => fetch('/runs/42/events', { signal }), []))
 *   <TraceWaterfall run={run ?? undefined} />
 */
export function useAgentRun(source: AgentRunSource, { mapper, initial = null, endOnClose = true, onError }: UseAgentRunOptions = {}): AgentRunState {
  const [run, setRun] = useState<AgentRun | null>(() => arIsRun(source) ? source : initial)
  const [status, setStatus] = useState<AgentRunStatus>(() => arIsRun(source) ? (source.status === 'running' ? 'live' : 'done') : source ? 'connecting' : 'idle')
  const [error, setError] = useState<unknown>(null)
  const [closedEarly, setClosedEarly] = useState(false)
  const live = useRef<AgentRun | null>(run), pending = useRef<null | (() => void)>(null), alive = useRef(true)
  const cb = useRef({ mapper, initial, endOnClose, onError })
  cb.current = { mapper, initial, endOnClose, onError }
  const flush = useCallback(() => { pending.current?.(); pending.current = null; if (alive.current) setRun(live.current) }, [])
  const schedule = useCallback(() => {
    if (pending.current) return
    const tick = () => { pending.current = null; if (alive.current) setRun(live.current) }
    if (typeof requestAnimationFrame === 'function' && !(typeof document !== 'undefined' && document.hidden)) { const f = requestAnimationFrame(tick); pending.current = () => cancelAnimationFrame(f) }
    else { const t = setTimeout(tick, 16); pending.current = () => clearTimeout(t) }
  }, [])
  const push = useCallback((events: AgentRunEvent | readonly AgentRunEvent[]) => {
    for (const e of Array.isArray(events) ? events : [events as AgentRunEvent]) live.current = applyRunEvent(live.current, e)
    schedule()
  }, [schedule])
  const reset = useCallback((r: AgentRun | null = null) => { live.current = r; flush() }, [flush])

  useEffect(() => {
    alive.current = true
    return () => { alive.current = false; pending.current?.(); pending.current = null }
  }, [])
  useEffect(() => {
    setClosedEarly(false)
    if (arIsRun(source)) { live.current = source; flush(); setStatus(source.status === 'running' ? 'live' : 'done'); setError(null); return }
    if (!source) { setStatus('idle'); return }
    const ac = new AbortController(), { signal } = ac
    live.current = cb.current.initial ?? null
    flush(); setStatus('connecting'); setError(null)
    const map = cb.current.mapper?.()
    const fail = (err: unknown) => { if (signal.aborted) return; flush(); setStatus('error'); setError(err); cb.current.onError?.(err) }
    void (async () => {
      try {
        if (arIsPoll(source)) {
          for (let misses = 0; !signal.aborted;) {
            try {
              const r = await source.fetchRun(signal)
              if (signal.aborted) return
              misses = 0
              if (r && arIsRun(r)) { live.current = r; schedule(); setStatus(r.status === 'running' ? 'live' : 'done'); if (r.status !== 'running') return }
            } catch (err) { if (signal.aborted) return; if (++misses >= 3) throw err }
            await arSleep(Math.max(100, source.intervalMs ?? 1000), signal)
          }
          return
        }
        let first = true
        for await (const item of arItems(source, signal)) {
          if (signal.aborted) return
          const evs = arMapItem(item, map)
          if (!evs.length) continue
          for (const e of evs) live.current = applyRunEvent(live.current, e)
          schedule()
          if (first) { first = false; setStatus('live') }
        }
        if (signal.aborted) return
        const r = live.current
        if (r && r.status === 'running') {
          if (cb.current.endOnClose) live.current = applyRunEvent(r, { type: 'run-end', at: runLatestMs(r), status: 'cancelled' })
          setClosedEarly(true)
          return fail(new AgentRunClosedEarlyError(live.current ?? r))
        }
        flush(); setStatus('done')
      } catch (err) { fail(err) }
    })()
    return () => { ac.abort(); pending.current?.(); pending.current = null }
  }, [source, flush, schedule])

  return { run, status, error, closedEarly, push, reset }
}

/** Sorts updates into time order (ends, then starts, then events at the same moment; ties keep their order) and folds them. */
function arBuild(events: AgentRunEvent[]): AgentRun | null {
  const rank = (e: AgentRunEvent) => e.type === 'run-start' ? -1 : e.type === 'span-end' ? 0 : e.type === 'run-end' ? 3 : e.type === 'event' ? 2 : 1
  let last = 0
  const sorted = events.map((e, i) => ({ e, i, t: last = arEventTime(e) ?? last })).sort((a, b) => (a.e.type === 'run-start' ? -1 : 0) - (b.e.type === 'run-start' ? -1 : 0) || a.t - b.t || rank(a.e) - rank(b.e) || a.i - b.i)
  return runFromEvents(sorted.map(x => x.e))
}
const arEmptyRun = (id: string, name: string, at = 0): AgentRun => ({ id, name, startedAt: at, status: 'ok', spans: [], events: [] })
/** Usage from any of the shapes providers report (input/output, prompt/completion, cache reads). */
function arUsage(u: unknown): AgentTokens | undefined {
  const o = arObj(u)
  if (!o) return undefined
  const input = arNum(o.inputTokens ?? o.input_tokens ?? o.promptTokens ?? o.prompt_tokens)
  const output = arNum(o.outputTokens ?? o.output_tokens ?? o.completionTokens ?? o.completion_tokens)
  if (input === undefined && output === undefined) return undefined
  const details = arObj(o.input_token_details ?? o.inputTokenDetails ?? o.prompt_tokens_details)
  const cached = arNum(o.cachedInputTokens ?? o.cached_input_tokens ?? o.cache_read_input_tokens ?? details?.cache_read ?? details?.cacheReadTokens ?? details?.cached_tokens)
  return { input: input ?? 0, output: output ?? 0, ...(cached ? { cached } : {}) }
}

export type OtelAnyValue = { stringValue?: string; intValue?: number | string; doubleValue?: number | string; boolValue?: boolean; bytesValue?: string; arrayValue?: { values?: OtelAnyValue[] }; kvlistValue?: { values?: OtelKeyValue[] } }
export type OtelKeyValue = { key: string; value?: OtelAnyValue }
/** A span as OTLP/JSON writes it (attributes may also be a plain object, as SDK span dumps have them). */
export type OtelSpan = {
  traceId?: string; spanId: string; parentSpanId?: string; name: string; kind?: number | string
  startTimeUnixNano: string | number; endTimeUnixNano?: string | number
  attributes?: OtelKeyValue[] | Record<string, unknown>
  events?: { timeUnixNano?: string | number; name: string; attributes?: OtelKeyValue[] | Record<string, unknown> }[]
  status?: { code?: number | string; message?: string }
}
/** An OTLP/JSON trace export (what a collector's file exporter or `/v1/traces` receives). */
export type OtlpTraceExport = {
  resourceSpans?: { resource?: { attributes?: OtelKeyValue[] | Record<string, unknown> }; scopeSpans?: { scope?: { name?: string; version?: string }; spans?: OtelSpan[] }[] }[]
}
export type FromOtelOptions = {
  /** which trace to read (default: the first span's) */ traceId?: string
  /** prices for spans that don't report `gen_ai.usage.cost` */ pricing?: AgentPricing
  /** your own kind for a span (null drops it, undefined falls back to the built-in rules) */
  classify?: (span: OtelSpan, attributes: Record<string, unknown>) => AgentSpanKind | null | undefined
  /** 'genai' (default): keep the root, spans with GenAI attributes and their ancestors (HTTP and database spans under a tool are dropped); 'all': every span */
  include?: 'genai' | 'all'
  /** the run's name (default: the root agent's name, else the root span's, else service.name) */ name?: string
}

const arOtelValue = (v: OtelAnyValue | undefined): unknown => {
  if (!v || typeof v !== 'object') return v
  if ('stringValue' in v) return v.stringValue
  if ('intValue' in v) return arNum(v.intValue)
  if ('doubleValue' in v) return arNum(v.doubleValue)
  if ('boolValue' in v) return !!v.boolValue
  if ('arrayValue' in v) return (v.arrayValue?.values ?? []).map(arOtelValue)
  if ('kvlistValue' in v) return arOtelAttrs(v.kvlistValue?.values)
  if ('bytesValue' in v) return v.bytesValue
  return undefined
}
/** OTLP attributes (KeyValue list or plain object) as a plain object. */
function arOtelAttrs(a: OtelKeyValue[] | Record<string, unknown> | undefined): Record<string, unknown> {
  if (Array.isArray(a)) { const out: Record<string, unknown> = {}; for (const kv of a) if (kv && typeof kv.key === 'string') out[kv.key] = arOtelValue(kv.value); return out }
  return arObj(a) ? { ...a } : {}
}
const AR_OI_KIND: Record<string, AgentSpanKind> = { LLM: 'llm', EMBEDDING: 'llm', TOOL: 'tool', RETRIEVER: 'retrieval', RERANKER: 'retrieval', AGENT: 'agent', CHAIN: 'chain', GUARDRAIL: 'chain', EVALUATOR: 'chain' }
const AR_TL_KIND: Record<string, AgentSpanKind> = { agent: 'agent', tool: 'tool', workflow: 'chain', task: 'chain' }
/** A span's kind by the GenAI conventions (gen_ai.operation.name), AI SDK telemetry, OpenInference and OpenLLMetry; undefined when it carries none of them. */
function arOtelKind(name: string, a: Record<string, unknown>): AgentSpanKind | undefined {
  const oi = a['openinference.span.kind'], tl = a['traceloop.span.kind'], op = String(a['gen_ai.operation.name'] ?? '').toLowerCase()
  if (typeof oi === 'string' && AR_OI_KIND[oi.toUpperCase()]) return AR_OI_KIND[oi.toUpperCase()]
  if (typeof tl === 'string' && AR_TL_KIND[tl.toLowerCase()]) return AR_TL_KIND[tl.toLowerCase()]
  if (op) {
    if (op === 'execute_tool') return 'tool'
    if (op === 'invoke_agent' || op === 'create_agent') return 'agent'
    if (/retriev|search/.test(op)) return 'retrieval'
    if (/human|approval|review/.test(op)) return 'human'
    return 'llm' // chat, text_completion, generate_content, embeddings
  }
  if (name === 'ai.toolCall' || a['ai.toolCall.name'] != null) return 'tool'
  if (/^ai\.\w+\.do(Generate|Stream)$/.test(name) || /^ai\.embed/.test(name)) return 'llm'
  if (/^ai\.(generate|stream)\w*$/.test(name)) return 'agent'
  if (a['gen_ai.tool.name'] != null) return 'tool'
  if (a['gen_ai.agent.name'] != null) return 'agent'
  if (a['gen_ai.request.model'] != null || a['llm.model_name'] != null) return 'llm'
  return undefined
}
const arPick = (a: Record<string, unknown>, keys: string[]) => { for (const k of keys) if (a[k] != null && a[k] !== '') return a[k]; return undefined }
/** Every span of an OTLP export (or a span list), with its resource's service name. */
function arOtelSpans(input: OtlpTraceExport | readonly OtelSpan[]): { span: OtelSpan; service?: string }[] {
  if (Array.isArray(input)) return (input as OtelSpan[]).filter(s => s && s.spanId).map(span => ({ span }))
  const out: { span: OtelSpan; service?: string }[] = []
  for (const rs of (input as OtlpTraceExport)?.resourceSpans ?? []) {
    const service = arOtelAttrs(rs?.resource?.attributes)['service.name']
    const scopes = rs?.scopeSpans ?? (rs as { instrumentationLibrarySpans?: typeof rs.scopeSpans }).instrumentationLibrarySpans ?? []
    for (const ss of scopes) for (const span of ss?.spans ?? []) if (span && span.spanId) out.push({ span, service: typeof service === 'string' ? service : undefined })
  }
  return out
}
/** The trace ids in an OTLP export, in order of first appearance (to pick one for `fromOtel`). */
export const otelTraceIds = (input: OtlpTraceExport | readonly OtelSpan[]) => [...new Set(arOtelSpans(input).map(x => x.span.traceId ?? ''))]

/**
 * One trace of an OTLP/JSON export as run updates (see `fromOtel`). Spans map by the OpenTelemetry GenAI semantic
 * conventions: `gen_ai.operation.name` (chat, text_completion, generate_content, embeddings → llm; execute_tool → tool;
 * invoke_agent, create_agent → agent), `gen_ai.request.model` / `gen_ai.response.model`, `gen_ai.usage.input_tokens` /
 * `output_tokens` (and the older prompt/completion names, cache reads), `gen_ai.tool.name`, `gen_ai.agent.name`, the
 * span status and `exception` events (errors). The AI SDK's telemetry spans (ai.generateText, ai.*.doGenerate,
 * ai.toolCall), OpenInference (`openinference.span.kind`) and OpenLLMetry (`traceloop.span.kind`) map too. Span events
 * named like `*approval*` or `*handoff*` become run events. Pure; never throws on malformed input.
 */
export function otelToRunEvents(input: OtlpTraceExport | readonly OtelSpan[], { traceId, pricing, classify, include = 'genai', name }: FromOtelOptions = {}): AgentRunEvent[] {
  const all = arOtelSpans(input)
  const tid = traceId ?? all[0]?.span.traceId
  const spans = all.filter(x => tid == null || x.span.traceId === tid)
  if (!spans.length) return []
  const ids = new Set(spans.map(x => x.span.spanId))
  const parentOf = (s: OtelSpan) => s.parentSpanId && ids.has(s.parentSpanId) ? s.parentSpanId : undefined
  const info = new Map<string, { span: OtelSpan; a: Record<string, unknown>; kind: AgentSpanKind | null; signal: boolean; service?: string }>()
  for (const { span, service } of spans) {
    const a = arOtelAttrs(span.attributes)
    const own = classify?.(span, a)
    const k = own === null ? null : own ?? arOtelKind(span.name, a)
    info.set(span.spanId, { span, a, kind: k === null ? null : k ?? (parentOf(span) ? 'chain' : 'agent'), signal: own !== undefined ? own !== null : k !== undefined, service })
  }
  // keep the roots, spans with a GenAI signal and their ancestors
  const keep = new Set<string>()
  for (const [id, x] of info) {
    if (x.kind === null) continue
    if (include === 'all' || x.signal || !parentOf(x.span)) {
      keep.add(id)
      for (let p = parentOf(x.span), n = 0; p && n < 256; p = parentOf(info.get(p)!.span), n++) if (info.get(p)!.kind !== null) keep.add(p)
    }
  }
  const keptParent = (s: OtelSpan) => { for (let p = parentOf(s), n = 0; p && n < 256; p = parentOf(info.get(p)!.span), n++) if (keep.has(p)) return p; return undefined }
  const out: AgentRunEvent[] = []
  let start = Infinity, end = -Infinity, open = false, rootName: string | undefined, rootStatus: AgentSpanStatus | undefined, service: string | undefined
  // starts parents first (depth-first from the roots) and ends children first, so ties sort right
  const kids = new Map<string | undefined, string[]>()
  for (const id of keep) { const p = keptParent(info.get(id)!.span); kids.set(p, [...(kids.get(p) ?? []), id]) }
  const order: string[] = [], walk = (id: string, n = 0) => { order.push(id); if (n < 256) for (const c of kids.get(id) ?? []) walk(c, n + 1) }
  for (const r of kids.get(undefined) ?? []) walk(r)
  const ends: AgentRunEvent[] = []
  for (const id of order) {
    const { span: s, a, kind, service: svc } = info.get(id)!
    const k = kind as AgentSpanKind
    const startMs = arTime(s.startTimeUnixNano) ?? 0, endMs = arTime(s.endTimeUnixNano)
    const parentId = keptParent(s)
    const model = arPick(a, ['gen_ai.response.model', 'gen_ai.request.model', 'ai.model.id', 'llm.model_name']) as string | undefined
    const input = arNum(arPick(a, ['gen_ai.usage.input_tokens', 'gen_ai.usage.prompt_tokens', 'ai.usage.inputTokens', 'ai.usage.promptTokens', 'llm.token_count.prompt', 'llm.usage.prompt_tokens']))
    const output = arNum(arPick(a, ['gen_ai.usage.output_tokens', 'gen_ai.usage.completion_tokens', 'ai.usage.outputTokens', 'ai.usage.completionTokens', 'llm.token_count.completion', 'llm.usage.completion_tokens']))
    const cached = arNum(arPick(a, ['gen_ai.usage.cache_read.input_tokens', 'gen_ai.usage.cache_read_input_tokens', 'gen_ai.usage.cached_tokens', 'ai.usage.cachedInputTokens', 'llm.token_count.prompt_details.cache_read']))
    const tokens = input != null || output != null ? { input: input ?? 0, output: output ?? 0, ...(cached ? { cached } : {}) } : undefined
    const costUsd = arNum(a['gen_ai.usage.cost']) ?? (k === 'llm' ? agentSpanCost(model, tokens, pricing) : undefined)
    const label = k === 'tool' ? String(arPick(a, ['gen_ai.tool.name', 'ai.toolCall.name', 'tool.name']) ?? s.name.replace(/^execute_tool\s+/, ''))
      : k === 'agent' ? String(arPick(a, ['gen_ai.agent.name']) ?? s.name.replace(/^(invoke_agent|create_agent)\s+/, ''))
      : s.name
    const code = s.status?.code, failed = code === 2 || code === '2' || /ERROR/i.test(String(code ?? ''))
    const exc = (s.events ?? []).find(e => e?.name === 'exception')
    const error = failed ? arText(s.status?.message || arOtelAttrs(exc?.attributes)['exception.message'] || a['error.type'] || 'Error') : undefined
    out.push({ type: 'span-start', span: { id, kind: k, name: label, startMs, ...(parentId ? { parentId } : {}), ...(model ? { model: String(model) } : {}), attributes: { ...a, 'otel.span_name': s.name } } })
    for (const [i, ev] of (s.events ?? []).entries()) {
      const evKind: AgentEventKind | null = /approv|human/i.test(ev?.name ?? '') ? 'approval' : /handoff|transfer/i.test(ev?.name ?? '') ? 'handoff' : /retry/i.test(ev?.name ?? '') ? 'retry' : null
      if (!evKind) continue
      const ea = arOtelAttrs(ev.attributes), detail = Object.entries(ea).map(([key, v]) => `${key}: ${arText(v, 200)}`).join(' · ')
      out.push({ type: 'event', event: { id: `${id}:ev${i}`, kind: evKind, atMs: arTime(ev.timeUnixNano) ?? startMs, label: ev.name, spanId: id, ...(detail ? { detail } : {}), attributes: ea } })
    }
    if (endMs != null && endMs >= startMs) ends.unshift({ type: 'span-end', id, endMs, status: failed ? 'error' : 'ok', ...(error ? { error } : {}), ...(tokens ? { tokens } : {}), ...(costUsd != null ? { costUsd } : {}) })
    else { open = true; if (tokens || costUsd != null) out.push({ type: 'span-update', id, ...(tokens ? { tokens } : {}), ...(costUsd != null ? { costUsd } : {}) }) }
    start = Math.min(start, startMs); end = Math.max(end, endMs ?? startMs)
    if (!parentId && rootName === undefined) { rootName = label; rootStatus = endMs == null ? 'running' : failed ? 'error' : 'ok'; service = svc }
  }
  return [{ type: 'run-start', at: start, id: tid ?? order[0], name: name ?? rootName ?? service ?? 'trace' }, ...out, ...ends,
    ...(open ? [] : [{ type: 'run-end' as const, at: end, status: (rootStatus === 'running' ? 'ok' : rootStatus) ?? 'ok' }])]
}
/** One trace of an OTLP/JSON export (OpenTelemetry GenAI spans) as an AgentRun; see otelToRunEvents for the mapping. */
export function fromOtel(input: OtlpTraceExport | readonly OtelSpan[], options: FromOtelOptions = {}): AgentRun {
  return arBuild(otelToRunEvents(input, options)) ?? arEmptyRun(options.traceId ?? 'trace', options.name ?? '')
}

type ArRec = Record<string, unknown>
/** The parts of a `generateText` / `streamText` step this adapter reads (AI SDK 4 and 5 field names both work). */
export type AiSdkStepLike = {
  content?: readonly ArRec[]; toolCalls?: readonly ArRec[]; toolResults?: readonly ArRec[]; text?: string
  finishReason?: string; usage?: ArRec; response?: { id?: string; timestamp?: Date | string | number; modelId?: string }; providerMetadata?: ArRec
}
/** A `generateText` result, or an awaited `streamText` result's fields (`await result.steps`, …). */
export type AiSdkResultLike = { steps?: readonly AiSdkStepLike[]; response?: { id?: string; modelId?: string; timestamp?: Date | string | number }; finishReason?: string; totalUsage?: ArRec; usage?: ArRec }
export type FromAiSdkOptions = {
  id?: string
  /** the run's name and root span's (default 'generateText') */ name?: string
  /** when the call started (default: the first step's response.timestamp) */ startedAt?: Date | string | number
  /** when it ended (default: the last step's start plus an estimate) */ endedAt?: Date | string | number
  /** when each step finished, e.g. recorded in `onStepFinish: () => ends.push(Date.now())`: exact step timings */ stepEnds?: readonly (Date | string | number)[]
  pricing?: AgentPricing
  /** share of a step with tool calls spent running its tools when timings are inferred (default 0.35) */ toolShare?: number
}

/** `{ costUsd }` when the model has a price, else nothing (to spread into an update). */
const arCostField = (model: string | undefined, usage: AgentTokens | undefined, pricing: AgentPricing | undefined) => { const c = agentSpanCost(model, usage, pricing); return c != null ? { costUsd: c } : {} }
/** Inferred step timings when the AI SDK reports none: a base, a time per output token, and extra when the step called tools. */
const AR_EST = { baseMs: 600, msPerOutputToken: 12, toolMs: 900 }

const arToolCalls = (step: AiSdkStepLike) => {
  const calls = new Map<string, { id: string; name: string; input?: unknown; output?: unknown; error?: string; done: boolean }>()
  const get = (p: ArRec) => { const id = String(p.toolCallId ?? p.id ?? `t${calls.size}`); let c = calls.get(id); if (!c) calls.set(id, c = { id, name: String(p.toolName ?? 'tool'), done: false }); return c }
  for (const p of step.content ?? []) {
    if (p?.type === 'tool-call') { const c = get(p); c.input = p.input ?? p.args }
    else if (p?.type === 'tool-result') { const c = get(p); c.output = p.output ?? p.result; c.done = true }
    else if (p?.type === 'tool-error') { const c = get(p); c.error = arText(p.error ?? 'Tool failed'); c.done = true }
  }
  for (const p of step.toolCalls ?? []) { const c = get(p); c.input ??= p.input ?? p.args }
  for (const p of step.toolResults ?? []) { const c = get(p); if (!c.done) { c.output = p.output ?? p.result; c.done = true } }
  return [...calls.values()]
}
/**
 * A `generateText` / `streamText` result as run updates (see `fromAiSdkResult`): a root agent span, one model span per
 * step (model id, usage incl. cached input, finish reason) and one span per tool call (input, output, or its error
 * from a `tool-error` content part). The SDK records no per-call timings: a step runs from its `response.timestamp`
 * (or `startedAt`) to the next step's, its tool calls share its last `toolShare`, in parallel (spans get
 * `attributes.timing = 'inferred'`). Pass `stepEnds` (from onStepFinish) for exact steps, or use the SDK's
 * `experimental_telemetry` with `fromOtel` for exact tool timings.
 */
export function aiSdkResultToRunEvents(result: AiSdkResultLike, { id, name = 'generateText', startedAt, endedAt, stepEnds = [], pricing, toolShare = 0.35 }: FromAiSdkOptions = {}): AgentRunEvent[] {
  const steps = (result?.steps ?? []).filter(Boolean)
  const ts = (i: number) => arTime(steps[i]?.response?.timestamp)
  const t0 = arTime(startedAt) ?? ts(0) ?? arTime(result?.response?.timestamp) ?? Date.now()
  const runId = id ?? result?.response?.id ?? 'ai-sdk-run', root = `${runId}:root`
  const out: AgentRunEvent[] = [{ type: 'run-start', at: t0, id: runId, name }, { type: 'span-start', span: { id: root, kind: 'agent', name, startMs: t0, attributes: { finishReason: result?.finishReason } } }]
  let at = t0, failed = false
  steps.forEach((step, i) => {
    const calls = arToolCalls(step), usage = arUsage(step.usage), model = step.response?.modelId ?? result?.response?.modelId
    const s0 = i === 0 ? t0 : Math.max(at, arTime(stepEnds[i - 1]) ?? ts(i) ?? at)
    const exact = arTime(stepEnds[i])
    const est = s0 + AR_EST.baseMs + (usage?.output ?? 0) * AR_EST.msPerOutputToken + (calls.length ? AR_EST.toolMs : 0)
    const s1 = Math.max(s0, exact ?? ts(i + 1) ?? (i === steps.length - 1 ? arTime(endedAt) : undefined) ?? est)
    const llmEnd = calls.length ? s0 + (s1 - s0) * (1 - Math.min(0.9, Math.max(0, toolShare))) : s1
    const sid = `${runId}:step${i + 1}`, inferred = exact === undefined ? { timing: 'inferred' } : {}
    out.push({ type: 'span-start', span: { id: sid, parentId: root, kind: 'llm', name: `Step ${i + 1}`, startMs: s0, ...(model ? { model } : {}), attributes: { step: i + 1, finishReason: step.finishReason, ...(step.text ? { text: step.text } : {}), ...inferred } } })
    const errored = step.finishReason === 'error'
    out.push({ type: 'span-end', id: sid, endMs: llmEnd, status: errored ? 'error' : 'ok', ...(errored ? { error: 'The model call failed' } : {}), ...(usage ? { tokens: usage } : {}), ...arCostField(model, usage, pricing) })
    for (const c of calls) {
      const tid = `${runId}:tool:${c.id}`
      out.push({ type: 'span-start', span: { id: tid, parentId: root, kind: 'tool', name: c.name, startMs: llmEnd, attributes: { toolCallId: c.id, input: c.input, ...inferred } } })
      out.push({ type: 'span-end', id: tid, endMs: s1, ...(c.error ? { status: 'error', error: c.error } : { status: 'ok' }), attributes: c.output !== undefined ? { output: c.output } : {} })
    }
    failed ||= errored
    at = s1
  })
  out.push({ type: 'span-end', id: root, endMs: at, status: failed || result?.finishReason === 'error' ? 'error' : 'ok' }, { type: 'run-end', at })
  return out
}
/** A `generateText` / `streamText` result (its `steps`) as an AgentRun; see aiSdkResultToRunEvents for the mapping and timings. */
export function fromAiSdkResult(result: AiSdkResultLike, options: FromAiSdkOptions = {}): AgentRun {
  return arBuild(aiSdkResultToRunEvents(result, options)) ?? arEmptyRun(options.id ?? 'ai-sdk-run', options.name ?? 'generateText')
}

/**
 * A live mapper for the AI SDK UI message stream (the parts of `toUIMessageStreamResponse()`, or this library's AiChunk
 * names): start opens the run, start-step / finish-step bound a model span (without step parts, the model span runs
 * until the next tool call, and a new one opens at the next text), tool-input-start … tool-output-available /
 * -error / -denied bound a tool span, tool-approval-request adds an approval event, error and abort end the run. Usage
 * arrives through `message-metadata` (`messageMetadata: ({ part }) => part.type === 'finish-step' ? { usage: part.usage,
 * model: … } : undefined` on the server). Parts carry no times: each is stamped when it arrives (`now`).
 *
 *   useAgentRun(source, { mapper: () => aiSdkRunMapper({ pricing }) })
 */
export function aiSdkRunMapper({ now = Date.now, name = 'streamText', pricing, model: model0 }: { now?: () => number; name?: string; pricing?: AgentPricing; model?: string } = {}): (part: unknown) => AgentRunEvent[] {
  let started = false, root = 'run:root', step = 0, llm: string | null = null, lastLlm: string | null = null, explicit = false, model = model0, ended = false
  const tools = new Set<string>(), lastUsage = new Map<string, AgentTokens>()
  const open = (t: number): AgentRunEvent[] => {
    step++; llm = lastLlm = `${root}:step${step}`
    return [{ type: 'span-start', span: { id: llm, parentId: root, kind: 'llm', name: `Step ${step}`, startMs: t, ...(model ? { model } : {}), attributes: { step } } }]
  }
  const close = (t: number): AgentRunEvent[] => { if (!llm) return []; const id = llm; llm = null; const u = lastUsage.get(id); return [{ type: 'span-end', id, endMs: t, ...(u ? { tokens: u } : {}), ...arCostField(model, u, pricing) }] }
  const begin = (t: number, id?: unknown): AgentRunEvent[] => {
    if (started) return []
    started = true; root = `${id ?? 'run'}:root`
    return [{ type: 'run-start', at: t, id: String(id ?? 'run'), name }, { type: 'span-start', span: { id: root, kind: 'agent', name, startMs: t, attributes: {} } }]
  }
  const finish = (t: number, status: 'ok' | 'error' | 'cancelled', error?: string): AgentRunEvent[] => {
    if (ended) return []
    ended = true
    const out: AgentRunEvent[] = [...close(t), ...[...tools].map(id => ({ type: 'span-end' as const, id, endMs: t, status: 'cancelled' as const }))]
    tools.clear()
    return [...out, { type: 'span-end', id: root, endMs: t, status, ...(error ? { error } : {}) }, { type: 'run-end', at: t, status }]
  }
  return (raw: unknown) => {
    const p = arObj(raw)
    if (!p || typeof p.type !== 'string' || ended) return []
    const t = now(), type = p.type, out: AgentRunEvent[] = []
    if (type !== 'start') out.push(...begin(t))
    const toolId = p.toolCallId ?? p.id, tid = toolId != null ? `${root}:tool:${toolId}` : null
    const meta = arObj(p.messageMetadata ?? (type === 'message-metadata' ? p.metadata : undefined))
    if (meta) {
      if (typeof meta.model === 'string' || typeof meta.modelId === 'string') model = String(meta.model ?? meta.modelId)
      const u = arUsage(meta.usage), target = llm ?? lastLlm
      if (u && target && type !== 'start' && type !== 'finish') { lastUsage.set(target, u); out.push({ type: 'span-update', id: target, tokens: u, ...(model ? { model } : {}), ...arCostField(model, u, pricing) }) }
    }
    switch (type) {
      case 'start': out.push(...begin(t, p.messageId)); break
      case 'start-step': explicit = true; out.push(...close(t), ...open(t)); break
      case 'finish-step': out.push(...close(t)); break
      case 'text-start': case 'text-delta': case 'reasoning-start': case 'reasoning-delta':
        if (!llm && !explicit) out.push(...open(t))
        break
      case 'tool-input-start': case 'tool-start': case 'tool-input-available': case 'tool-args':
        if (!tid || tools.has(tid)) break
        if (!explicit) out.push(...close(t))
        tools.add(tid)
        out.push({ type: 'span-start', span: { id: tid, parentId: root, kind: 'tool', name: String(p.toolName ?? p.name ?? 'tool'), startMs: t, attributes: { toolCallId: toolId, ...(p.input ?? p.args) !== undefined ? { input: p.input ?? p.args } : {} } } })
        break
      case 'tool-approval-request': case 'tool-approval':
        if (tid) out.push({ type: 'event', event: { id: `${tid}:approval`, kind: 'approval', atMs: t, label: 'approval requested', spanId: tid } })
        break
      case 'tool-output-available': case 'tool-result':
        if (tid && tools.delete(tid)) out.push({ type: 'span-end', id: tid, endMs: t, status: 'ok', attributes: { output: p.output ?? p.result } })
        break
      case 'tool-output-error': case 'tool-input-error': case 'tool-error':
        if (tid && tools.delete(tid)) out.push({ type: 'span-end', id: tid, endMs: t, status: 'error', error: arText(p.errorText ?? p.error ?? 'Tool failed') })
        break
      case 'tool-output-denied':
        if (tid && tools.delete(tid)) { out.push({ type: 'span-end', id: tid, endMs: t, status: 'cancelled' }, { type: 'event', event: { id: `${tid}:denied`, kind: 'approval', atMs: t, label: 'denied', spanId: tid } }) }
        break
      case 'finish': out.push(...finish(t, 'ok')); break
      case 'abort': out.push(...finish(t, 'cancelled')); break
      case 'error': out.push(...finish(t, 'error', arText(p.errorText ?? p.message ?? 'Stream error'))); break
    }
    return out
  }
}
/** A recorded UI message stream (parts with the time each arrived: `{ at, part }`, or bare parts stamped `startedAt`) as an AgentRun. */
export function fromAiSdkUIStream(parts: readonly (unknown | { at: number | string | Date; part: unknown })[], options: { name?: string; pricing?: AgentPricing; startedAt?: number } = {}): AgentRun {
  let clock = options.startedAt ?? 0
  const map = aiSdkRunMapper({ ...options, now: () => clock })
  const out: AgentRunEvent[] = []
  for (const x of parts) {
    const o = arObj(x), stamped = o && 'part' in o && 'at' in o
    if (stamped) clock = arTime(o.at) ?? clock
    out.push(...map(stamped ? o.part : x))
  }
  return runFromEvents(out) ?? arEmptyRun('run', options.name ?? 'streamText')
}

/** One `astream_events(version="v2")` event. `timestamp` isn't part of LangChain's event: add it on your server (epoch s or ms, or ISO). */
export type LangGraphStreamEvent = {
  event: string; name?: string; run_id: string; parent_ids?: readonly string[]; tags?: readonly string[]
  metadata?: Record<string, unknown>; data?: Record<string, unknown>; timestamp?: number | string
}
export type LangGraphMapperOptions = {
  /** prices for model calls */ pricing?: AgentPricing
  /** graph nodes that are agents (handoffs are drawn between them); subgraph nodes become agents on their own */ agentNodes?: readonly string[]
  /** keep LangChain's internal runnables (RunnableSequence, ChannelWrite, routing functions…) as chain spans (default false) */ includeInternal?: boolean
  /** the time of an event without a `timestamp` (default Date.now) */ now?: () => number
  /** the run's name (default: the root graph's) */ name?: string
}
/** A LangChain message (plain, model_dump'ed or `dumpd`'ed) as its fields. */
const arLcMsg = (m: unknown): ArRec | null => { const o = arObj(m); return o ? arObj(o.kwargs) ?? o : null }
/**
 * A live mapper for LangGraph / LangChain `astream_events(version="v2")` events (e.g. relayed by your Python server as
 * SSE). The root graph is the run; graph nodes (metadata.langgraph_node) are chain spans, or agents when listed in
 * `agentNodes` or once they turn out to be subgraphs; on_chat_model_* / on_llm_* are model spans (model from
 * ls_model_name or response_metadata, usage from usage_metadata, time to first token from the first stream chunk);
 * on_tool_* are tools and on_retriever_* retrievals. LangChain's internal runnables are skipped and their children
 * re-parented by `parent_ids`. A tool that never reports its end (ToolNode turns its exception into a ToolMessage with
 * status "error") is closed with that error when its node ends. Custom events named `*approval*` open and close a
 * human span (`…_requested`, then `…_granted` / `…_denied`), others become notes; `__interrupt__` chunks become
 * approval events. Events carry no times: give each a `timestamp` on the server, or they are stamped on arrival.
 */
export function langGraphRunMapper({ pricing, agentNodes = [], includeInternal = false, now = Date.now, name }: LangGraphMapperOptions = {}): (event: unknown) => AgentRunEvent[] {
  const kept = new Map<string, { kind: AgentSpanKind; name: string; parent?: string; node?: string; open: boolean; model?: string; streamed?: boolean; startMs: number }>()
  let rootId: string | null = null, ended = false
  const human = new Map<string, string>()
  const parentOf = (ids: readonly string[] | undefined) => { const p = ids ?? []; for (let i = p.length - 1; i >= 0; i--) if (kept.has(p[i])) return p[i]; return rootId ?? undefined }
  const closeOpen = (parent: string, t: number, output: unknown): AgentRunEvent[] => {
    // tools (and anything else) still open under a node that ended: ToolNode reports a tool's exception as a ToolMessage
    const msgs = (Array.isArray(arObj(output)?.messages) ? arObj(output)!.messages as unknown[] : Array.isArray(output) ? output : [output]).map(arLcMsg).filter(Boolean) as ArRec[]
    const out: AgentRunEvent[] = []
    for (const [id, k] of kept) {
      if (!k.open || id === parent) continue
      let p = k.parent, under = false
      for (let n = 0; p && n < 256; p = kept.get(p)?.parent, n++) if (p === parent) { under = true; break }
      if (!under) continue
      const err = msgs.find(m => m.status === 'error' && (m.name === k.name || !m.name))
      k.open = false
      out.push(err ? { type: 'span-end', id, endMs: t, status: 'error', error: arText(String(err.content ?? 'Tool failed').split('\n')[0].trim()) } : { type: 'span-end', id, endMs: t, status: 'cancelled' })
    }
    return out
  }
  return (raw: unknown) => {
    const e = arObj(raw) as LangGraphStreamEvent | null
    if (!e || typeof e.event !== 'string' || e.run_id == null || ended) return []
    const t = arTime(e.timestamp) ?? now(), id = String(e.run_id), md = arObj(e.metadata) ?? {}, data = arObj(e.data) ?? {}
    const nm = String(e.name ?? e.event), parents = (e.parent_ids ?? []).map(String), m = /^on_(chain|chat_model|llm|tool|retriever|prompt|parser|custom)_(start|stream|end|error|event)$/.exec(e.event)
    const out: AgentRunEvent[] = []
    if (e.event === 'on_custom_event') {
      const at = parentOf([...parents, id]), payload = data
      const detail = Object.keys(payload).length ? arText(payload, 300) : undefined
      if (/approv/i.test(nm) && /request|ask|pending/i.test(nm)) {
        const hid = `${id}:${nm}`; human.set(at ?? '', hid)
        out.push({ type: 'span-start', span: { id: hid, ...(at ? { parentId: at } : {}), kind: 'human', name: String(payload.label ?? 'approval'), startMs: t, attributes: payload } },
          { type: 'event', event: { id: `${hid}:ev`, kind: 'approval', atMs: t, label: nm, ...(at ? { spanId: at } : {}), ...(detail ? { detail } : {}) } })
      } else if (/approv|reject|denied/i.test(nm)) {
        const hid = human.get(at ?? ''), denied = /reject|den/i.test(nm)
        if (hid) { human.delete(at ?? ''); out.push({ type: 'span-end', id: hid, endMs: t, status: denied ? 'cancelled' : 'ok' }) }
        out.push({ type: 'event', event: { id: `${id}:${nm}:${t}`, kind: 'approval', atMs: t, label: nm, ...(at ? { spanId: at } : {}), ...(detail ? { detail } : {}) } })
      } else out.push({ type: 'event', event: { id: `${id}:${nm}:${t}`, kind: /retry/i.test(nm) ? 'retry' : 'note', atMs: t, label: nm, ...(at ? { spanId: at } : {}), ...(detail ? { detail } : {}) } })
      return out
    }
    if (!m) return []
    const [, what, phase] = m
    if (phase === 'start') {
      if (kept.has(id)) return []
      const isRoot = !parents.length && !rootId
      const node = typeof md.langgraph_node === 'string' ? md.langgraph_node : undefined
      const hidden = (e.tags ?? []).includes('langgraph:hidden')
      let kind: AgentSpanKind | null =
        what === 'chat_model' || what === 'llm' ? 'llm' : what === 'tool' ? 'tool' : what === 'retriever' ? 'retrieval'
        : what !== 'chain' ? null : isRoot ? 'chain' : node === nm && !hidden ? (agentNodes.includes(nm) ? 'agent' : 'chain') : includeInternal ? 'chain' : null
      if (isRoot) { rootId = id; out.push({ type: 'run-start', at: t, id: String(md.thread_id ?? md.run_id ?? id), name: name ?? nm }) }
      if (!kind) return out
      const parent = isRoot ? undefined : parentOf(parents)
      // a node inside another node is in a subgraph: that node is an agent
      const up = parent ? kept.get(parent) : undefined
      if (kind === 'chain' && node === nm && up?.node && up.kind === 'chain' && parent !== rootId) { up.kind = 'agent'; out.push({ type: 'span-update', id: parent!, kind: 'agent' }) }
      const model = kind === 'llm' ? String(md.ls_model_name ?? arObj(data.invocation_params)?.model ?? arObj(data.invocation_params)?.model_name ?? '') || undefined : undefined
      kept.set(id, { kind, name: nm, parent, node: node === nm ? node : undefined, open: true, model, startMs: t })
      const input = data.input
      out.push({ type: 'span-start', span: { id, kind, name: nm, startMs: t, ...(parent ? { parentId: parent } : {}), ...(model ? { model } : {}),
        attributes: { ...(md.ls_provider ? { provider: md.ls_provider } : {}), ...(node ? { 'langgraph.node': node } : {}), ...(md.langgraph_step != null ? { 'langgraph.step': md.langgraph_step } : {}), ...(kind === 'tool' && input !== undefined ? { input } : {}) } } })
      return out
    }
    const k = kept.get(id)
    if (phase === 'stream') {
      const chunk = arObj(data.chunk)
      if (k && k.kind === 'llm' && !k.streamed) { k.streamed = true; out.push({ type: 'span-update', id, attributes: { timeToFirstTokenMs: Math.max(0, t - k.startMs) } }) }
      if (chunk && '__interrupt__' in chunk) {
        const v = chunk.__interrupt__, first = Array.isArray(v) ? arObj(v[0]) : arObj(v)
        out.push({ type: 'event', event: { id: `${id}:interrupt:${t}`, kind: 'approval', atMs: t, label: 'interrupt', ...(k ? { spanId: id } : {}), detail: arText(first?.value ?? v, 300) } })
      }
      return out
    }
    if (!k || !k.open) {
      if (phase === 'end' && id === rootId && !ended) { ended = true; out.push({ type: 'run-end', at: t }) }
      return out
    }
    k.open = false
    const output = data.output, err = data.error ?? (phase === 'error' ? 'Error' : undefined)
    out.push(...closeOpen(id, t, output))
    if (k.kind === 'llm') {
      const gens = arObj(output)?.generations, msg = arLcMsg(Array.isArray(gens) ? arObj(arObj((gens as unknown[][])[0]?.[0])?.message) ?? (gens as unknown[][])[0]?.[0] : output)
      const usage = arUsage(msg?.usage_metadata) ?? arUsage(arObj(arObj(output)?.llm_output)?.token_usage) ?? arUsage(arObj(msg?.response_metadata)?.token_usage)
      const model = String(arObj(msg?.response_metadata)?.model_name ?? k.model ?? '') || undefined
      const cost = agentSpanCost(model, usage, pricing)
      const calls = Array.isArray(msg?.tool_calls) ? (msg!.tool_calls as unknown[]).map(c => arObj(c)?.name).filter(Boolean) : []
      out.push({ type: 'span-end', id, endMs: t, ...(err ? { status: 'error', error: arText(err) } : { status: 'ok' }), ...(model ? { model } : {}), ...(usage ? { tokens: usage } : {}), ...(cost != null ? { costUsd: cost } : {}),
        attributes: { ...(calls.length ? { toolCalls: calls } : {}), ...(arObj(msg?.response_metadata)?.finish_reason ? { finishReason: arObj(msg?.response_metadata)?.finish_reason } : {}) } })
    } else {
      const tm = k.kind === 'tool' ? arLcMsg(output) : null, toolErr = tm?.status === 'error' ? arText(tm.content ?? 'Tool failed') : undefined
      const docs = k.kind === 'retrieval' && Array.isArray(arObj(output)?.documents) ? (arObj(output)!.documents as unknown[]).length : Array.isArray(output) && k.kind === 'retrieval' ? output.length : undefined
      out.push({ type: 'span-end', id, endMs: t, ...(err || toolErr ? { status: 'error', error: arText(err ?? toolErr) } : { status: 'ok' }),
        ...(k.kind === 'tool' && output !== undefined ? { attributes: { output: tm?.content ?? output } } : docs != null ? { attributes: { documents: docs } } : {}) })
    }
    if (id === rootId) { ended = true; out.push({ type: 'run-end', at: t }) }
    return out
  }
}
/** Recorded LangGraph `astream_events` v2 events as an AgentRun; see langGraphRunMapper for the mapping. */
export function fromLangGraphEvents(events: readonly unknown[], options: LangGraphMapperOptions = {}): AgentRun {
  const map = langGraphRunMapper(options)
  return runFromEvents(events.flatMap(e => map(e))) ?? arEmptyRun('run', options.name ?? 'LangGraph')
}
