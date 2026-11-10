import { act, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import {
  AgentTransitMap, TraceWaterfall, aiSdkRunMapper, applyRunEvent, fromAiSdkResult, fromAiSdkUIStream, fromLangGraphEvents, fromOtel,
  langGraphRunMapper, otelToRunEvents, replayRun, runFromEvents, runLaneNodes, runToEvents, runTotals, transitRunStation, useAgentRun,
  type AgentRun, type AgentRunEvent, type AgentRunSource,
} from '../../src/lib/all'
import {
  AGENT_PRICING_SAMPLE, AGENT_RUN_FIXTURES, AI_SDK_RESULT_ENDED, AI_SDK_RESULT_SAMPLE, AI_SDK_STREAM_SAMPLE, AgentRunLanes, LANGGRAPH_EVENTS_SAMPLE, OTEL_TRACE_SAMPLE,
} from '../../src/examples'

const byName = (r: AgentRun, name: string) => r.spans.filter(s => s.name === name)
const rel = (r: AgentRun, ms: number) => Math.round(ms - r.startedAt)
const parentName = (r: AgentRun, s: { parentId?: string }) => r.spans.find(x => x.id === s.parentId)?.name

describe('OpenTelemetry GenAI adapter', () => {
  const run = fromOtel(OTEL_TRACE_SAMPLE, { pricing: AGENT_PRICING_SAMPLE })
  it('builds the span tree by gen_ai.operation.name, dropping non-GenAI leaves', () => {
    expect(run.id).toBe('4bf92f3577b34da6a3ce929d0e0e4736')
    expect(run.name).toBe('Support agent')
    expect(run.spans).toHaveLength(12) // 13 spans, the HTTP client span under lookup_order dropped
    expect(run.spans.some(s => s.name.startsWith('GET '))).toBe(false)
    const kinds = run.spans.reduce<Record<string, number>>((m, s) => ({ ...m, [s.kind]: (m[s.kind] ?? 0) + 1 }), {})
    expect(kinds).toEqual({ agent: 2, llm: 5, tool: 5 })
    const billing = byName(run, 'Billing agent')[0]
    expect(parentName(run, billing)).toBe('Support agent')
    expect(byName(run, 'issue_refund').map(s => parentName(run, s))).toEqual(['Billing agent', 'Billing agent'])
  })
  it('keeps timings to the millisecond (ns strings), tokens incl. cache reads, and costs from prices', () => {
    expect(run.endedAt! - run.startedAt).toBe(11850)
    const chat = run.spans.find(s => s.kind === 'llm')!
    expect([rel(run, chat.startMs), chat.endMs! - chat.startMs]).toEqual([120, 1800])
    expect(chat.model).toBe('gpt-4.1-2025-04-14')
    expect(chat.tokens).toEqual({ input: 1830, output: 96, cached: 1024 })
    // (1830 − 1024) × $2 + 1024 × $0.5 + 96 × $8 per million
    expect(chat.costUsd).toBeCloseTo((806 * 2 + 1024 * 0.5 + 96 * 8) / 1e6, 9)
    const t = runTotals(run)
    expect(t).toMatchObject({ durationMs: 11850, llmCalls: 5, toolCalls: 5, errors: 1, running: 0 })
    expect(t.tokens).toEqual({ input: 10870, output: 701, cached: 6656 })
    expect(t.costUsd).toBeCloseTo(0.0119912, 6)
  })
  it('turns status ERROR, exception, approval and retry events and nested agents into run events', () => {
    const failed = byName(run, 'issue_refund')[0]
    expect(failed).toMatchObject({ status: 'error', error: 'PaymentsError: 503 Service Unavailable' })
    expect(run.events.map(e => [e.kind, rel(run, e.atMs)])).toEqual([['handoff', 4980], ['error', 7400], ['retry', 7900], ['approval', 7950], ['approval', 9100]])
    expect(run.events[0].label).toBe('Support agent → Billing agent')
    expect(run.events[4].detail).toContain('Dana')
    expect(run.status).toBe('ok')
  })
  it('reads AI SDK telemetry and OpenInference spans, accepts plain attribute objects, and keeps open spans running', () => {
    const r = fromOtel([
      { traceId: 't', spanId: 'a', name: 'ai.generateText', startTimeUnixNano: '1700000000000000000', endTimeUnixNano: '1700000003000000000', attributes: { 'ai.model.id': 'gpt-4.1-mini' } },
      { traceId: 't', spanId: 'b', parentSpanId: 'a', name: 'ai.generateText.doGenerate', startTimeUnixNano: '1700000000000000000', endTimeUnixNano: '1700000001000000000', attributes: { 'ai.model.id': 'gpt-4.1-mini', 'ai.usage.promptTokens': 100, 'ai.usage.completionTokens': 20 } },
      { traceId: 't', spanId: 'c', parentSpanId: 'a', name: 'ai.toolCall', startTimeUnixNano: '1700000001000000000', endTimeUnixNano: '1700000002000000000', attributes: { 'ai.toolCall.name': 'weather' } },
      { traceId: 't', spanId: 'd', parentSpanId: 'a', name: 'retrieve', startTimeUnixNano: '1700000002000000000', attributes: { 'openinference.span.kind': 'RETRIEVER' } },
    ])
    expect(r.spans.map(s => [s.kind, s.name, s.status])).toEqual([['agent', 'ai.generateText', 'ok'], ['llm', 'ai.generateText.doGenerate', 'ok'], ['tool', 'weather', 'ok'], ['retrieval', 'retrieve', 'running']])
    expect(r.spans[1].tokens).toEqual({ input: 100, output: 20 })
    expect(r.status).toBe('running')
  })
  it('never throws on junk, and `classify` can drop or re-kind spans', () => {
    expect(fromOtel({} as never).spans).toEqual([])
    expect(otelToRunEvents({ resourceSpans: [{ scopeSpans: [{ spans: [null as never] }] }] })).toEqual([])
    const r = fromOtel(OTEL_TRACE_SAMPLE, { classify: (s) => s.name.includes('transfer') ? null : undefined })
    expect(byName(r, 'transfer_to_billing')).toHaveLength(0)
  })
})

describe('Vercel AI SDK adapters', () => {
  const run = fromAiSdkResult(AI_SDK_RESULT_SAMPLE, { name: 'Research assistant', pricing: AGENT_PRICING_SAMPLE, endedAt: AI_SDK_RESULT_ENDED })
  it('maps steps to model spans and tool calls to parallel tool spans with inferred timings', () => {
    expect(run.spans.map(s => s.name)).toEqual(['Research assistant', 'Step 1', 'searchWeb', 'recallNotes', 'Step 2', 'fetchPage', 'fetchPage', 'Step 3', 'checkFacts', 'saveNote', 'Step 4'])
    expect(run.spans.slice(1).every(s => parentName(run, s) === 'Research assistant')).toBe(true)
    const [step2, f1, f2] = [byName(run, 'Step 2')[0], ...byName(run, 'fetchPage')]
    expect(rel(run, step2.startMs)).toBe(3400)
    expect(f1.startMs).toBe(step2.endMs) // tools start when the model call asking for them ends
    expect(f1.endMs).toBe(f2.endMs)
    expect(rel(run, f1.endMs!)).toBe(11800) // …and the step ends when the next one starts
    expect(f1.attributes.timing).toBe('inferred')
    expect(run.endedAt! - run.startedAt).toBe(19900)
  })
  it('keeps usage per step, tool errors and costs', () => {
    expect(byName(run, 'Step 2')[0].tokens).toEqual({ input: 4880, output: 96, cached: 1152 })
    expect(byName(run, 'fetchPage')[0]).toMatchObject({ status: 'error', error: 'Timeout after 8000 ms' })
    expect(runTotals(run).tokens).toEqual({ input: 21150, output: 966, cached: 13184 })
    expect(runTotals(run).costUsd).toBeCloseTo(0.0423432, 6)
    expect(run.events.map(e => e.kind)).toEqual(['error'])
  })
  it('uses exact step ends when given', () => {
    const t0 = Date.parse('2026-11-04T09:12:30Z')
    const r = fromAiSdkResult(AI_SDK_RESULT_SAMPLE, { stepEnds: [t0 + 3000, t0 + 11000, t0 + 14000, t0 + 19000] })
    expect(byName(r, 'searchWeb')[0].endMs! - t0).toBe(3000)
    expect(byName(r, 'searchWeb')[0].attributes.timing).toBeUndefined()
    expect(r.endedAt! - t0).toBe(19000)
  })
  it('maps the UI message stream live: steps, tools and usage from message-metadata', () => {
    const r = fromAiSdkUIStream(AI_SDK_STREAM_SAMPLE, { pricing: AGENT_PRICING_SAMPLE })
    expect(r.spans.map(s => [s.kind, s.name, rel(r, s.startMs), s.endMs! - s.startMs])).toEqual([
      ['agent', 'streamText', 0, 4420], ['llm', 'Step 1', 10, 2600], ['tool', 'searchWeb', 900, 1700], ['llm', 'Step 2', 2620, 1790]])
    expect(r.spans[1]).toMatchObject({ model: 'gpt-4.1-mini', tokens: { input: 820, output: 42 } })
    expect(r.spans[3].tokens).toEqual({ input: 1460, output: 210, cached: 768 })
    expect(r.spans[3].costUsd).toBeGreaterThan(0)
    expect(r.status).toBe('ok')
  })
  it('understands this library\'s AiChunks (no step parts) and stream errors', () => {
    let t = 1000
    const map = aiSdkRunMapper({ now: () => t })
    const evs: AgentRunEvent[] = []
    const feed = (p: object, at: number) => { t = at; evs.push(...map(p)) }
    feed({ type: 'text-delta', delta: 'Let me check' }, 1000)
    feed({ type: 'tool-start', id: 'x', name: 'lookup' }, 1500)
    feed({ type: 'tool-error', id: 'x', error: 'boom' }, 2000)
    feed({ type: 'text-delta', delta: 'Sorry' }, 2100)
    feed({ type: 'error', message: 'rate limited' }, 2500)
    const r = runFromEvents(evs)!
    expect(r.spans.map(s => [s.kind, s.startMs, s.endMs, s.status])).toEqual([['agent', 1000, 2500, 'error'], ['llm', 1000, 1500, 'ok'], ['tool', 1500, 2000, 'error'], ['llm', 2100, 2500, 'ok']])
    expect(r.status).toBe('error')
  })
})

describe('LangGraph astream_events v2 adapter', () => {
  const run = fromLangGraphEvents(LANGGRAPH_EVENTS_SAMPLE, { pricing: AGENT_PRICING_SAMPLE, agentNodes: ['planner', 'writer'], name: 'Trip planner' })
  it('keeps the graph, nodes, model, tool and human spans and skips internal runnables', () => {
    expect(run.id).toBe('thread-7f3a')
    expect(run.spans).toHaveLength(21)
    expect(run.spans.some(s => s.name === 'should_continue' || s.name.startsWith('ChannelWrite'))).toBe(false)
    expect(byName(run, 'researcher')[0].kind).toBe('agent') // a subgraph becomes an agent
    expect(byName(run, 'agent').map(s => [s.kind, parentName(run, s)])).toEqual([['chain', 'researcher'], ['chain', 'researcher'], ['chain', 'researcher']])
    expect(byName(run, 'Approve booking')[0]).toMatchObject({ kind: 'human', status: 'ok' })
    expect(parentName(run, byName(run, 'Approve booking')[0])).toBe('human_review')
  })
  it('converts timestamps in seconds and reads usage_metadata (cache reads), models and costs', () => {
    expect(run.endedAt! - run.startedAt).toBe(23490)
    const llms = run.spans.filter(s => s.kind === 'llm')
    expect(llms.map(s => s.model)).toEqual(['claude-haiku-4-5-20251001', 'claude-sonnet-4-5-20250929', 'claude-sonnet-4-5-20250929', 'claude-sonnet-4-5-20250929', 'claude-haiku-4-5-20251001'])
    expect(llms[2].tokens).toEqual({ input: 2210, output: 74, cached: 1408 })
    expect(llms[0].attributes.timeToFirstTokenMs).toBe(410)
    expect(runTotals(run).costUsd).toBeCloseTo(0.0239352, 6)
  })
  it('closes a tool that never ended with the ToolMessage error of its node', () => {
    const [first, retry] = byName(run, 'search_flights')
    expect(first).toMatchObject({ status: 'error', error: 'Error: TimeoutError("flights API did not answer in 5 s")' })
    expect(rel(run, first.endMs!)).toBe(8280)
    expect(retry.status).toBe('ok')
    expect(run.events.map(e => [e.kind, e.label])).toEqual([['handoff', 'planner → researcher'], ['error', 'search_flights'], ['approval', 'approval_requested'], ['approval', 'approval_granted'], ['handoff', 'researcher → writer']])
  })
  it('stamps events without timestamps on arrival, and maps interrupts to approvals', () => {
    let t = 5000
    const map = langGraphRunMapper({ now: () => t })
    const evs = [
      { event: 'on_chain_start', name: 'LangGraph', run_id: 'g', parent_ids: [] },
      { event: 'on_chain_start', name: 'ask', run_id: 'n', parent_ids: ['g'], metadata: { langgraph_node: 'ask' } },
      { event: 'on_chain_stream', name: 'LangGraph', run_id: 'g', parent_ids: [], data: { chunk: { __interrupt__: [{ value: 'Approve the refund?' }] } } },
      { event: 'on_chain_end', name: 'ask', run_id: 'n', parent_ids: ['g'] },
      { event: 'on_chain_end', name: 'LangGraph', run_id: 'g', parent_ids: [] },
    ].flatMap((e, i) => { t = 5000 + i * 100; return map(e) })
    const r = runFromEvents(evs)!
    expect(r.spans.map(s => [s.name, s.startMs, s.endMs])).toEqual([['LangGraph', 5000, 5400], ['ask', 5100, 5300]])
    expect(r.events).toMatchObject([{ kind: 'approval', label: 'interrupt', detail: 'Approve the refund?' }])
  })
})

describe('run model', () => {
  it('reduces streaming updates immutably, with handoffs, errors and run-end closing open spans', () => {
    const a = applyRunEvent(null, { type: 'run-start', at: 100, id: 'r1', name: 'Run' })
    const b = applyRunEvent(a, { type: 'span-start', span: { id: 'root', kind: 'agent', name: 'Lead', startMs: 100 } })
    const c = applyRunEvent(b, { type: 'span-start', span: { id: 'sub', parentId: 'root', kind: 'agent', name: 'Helper', startMs: 200 } })
    const d = applyRunEvent(c, { type: 'span-start', span: { id: 't', parentId: 'sub', kind: 'tool', name: 'grep', startMs: 250 } })
    const e = applyRunEvent(d, { type: 'span-end', id: 't', endMs: 400, error: 'exit 2' })
    const f = applyRunEvent(e, { type: 'run-end', at: 500 })
    expect(a.spans).toHaveLength(0) // untouched
    expect(c.events).toEqual([expect.objectContaining({ id: 'handoff:sub', kind: 'handoff', label: 'Lead → Helper', atMs: 200 })])
    expect(e.events.map(x => x.id)).toEqual(['handoff:sub', 'error:t'])
    expect(f.spans.map(s => [s.id, s.endMs, s.status])).toEqual([['root', 500, 'ok'], ['sub', 500, 'ok'], ['t', 400, 'error']])
    expect(f).toMatchObject({ status: 'ok', endedAt: 500 })
    expect(applyRunEvent(f, { type: 'nonsense' } as never)).toBe(f)
    expect(applyRunEvent(f, { type: 'span-end', id: 'missing', endMs: 1 })).toBe(f)
  })
  it('round-trips a run through runToEvents without duplicating events', () => {
    for (const fx of AGENT_RUN_FIXTURES) {
      const run = fx.run(), back = runFromEvents(runToEvents(run))!
      expect(back.spans.map(s => [s.id, s.startMs, s.endMs, s.status, s.tokens?.input])).toEqual(run.spans.map(s => [s.id, s.startMs, s.endMs, s.status, s.tokens?.input]))
      expect(back.events.map(e => e.id).sort()).toEqual(run.events.map(e => e.id).sort())
      expect([back.status, back.endedAt]).toEqual([run.status, run.endedAt])
    }
  })
  it('replays a run as a stream, rebased to now and sped up', async () => {
    const run = AGENT_RUN_FIXTURES[0].run()
    const start = Date.now(), evs: AgentRunEvent[] = []
    for await (const e of replayRun(run, { speed: 200 })) evs.push(e)
    const r = runFromEvents(evs)!
    expect(r.startedAt).toBeGreaterThanOrEqual(start)
    expect(r.endedAt! - r.startedAt).toBeCloseTo(11850 / 200, 0)
    expect(r.spans).toHaveLength(run.spans.length)
    const ac = new AbortController(), few: AgentRunEvent[] = []
    for await (const e of replayRun(run, { speed: 1, signal: ac.signal })) { few.push(e); if (few.length === 3) ac.abort() }
    expect(few).toHaveLength(3)
  })
  it('lays steps out as lanes: parallel tools fan out and back in', () => {
    const run = AGENT_RUN_FIXTURES[1].run(), nodes = runLaneNodes(run)
    const name = (id: string) => run.spans.find(s => s.id === id)!.name
    expect(nodes.map(n => [n.span.name, n.parents.map(name)])).toEqual([
      ['Step 1', []], ['searchWeb', ['Step 1']], ['recallNotes', ['Step 1']], ['Step 2', ['searchWeb', 'recallNotes']], ['fetchPage', ['Step 2']], ['fetchPage', ['Step 2']],
      ['Step 3', ['fetchPage', 'fetchPage']], ['checkFacts', ['Step 3']], ['saveNote', ['Step 3']], ['Step 4', ['checkFacts', 'saveNote']]])
    expect(new Set(nodes.map(n => n.group))).toEqual(new Set(['Research assistant']))
  })
  it('maps spans to transit stations by kind and tool name', () => {
    const run = AGENT_RUN_FIXTURES[0].run(), st = (n: string) => transitRunStation(run.spans.find(s => s.name === n)!, run)
    expect([st('Support agent'), st('Billing agent'), st('chat gpt-4.1'), st('lookup_order'), st('issue_refund'), st('search_policy')])
      .toEqual([['research', 'Intake'], ['research', 'Research'], ['research', 'Analyst'], ['payments', 'Search'], ['payments', 'Pay agent'], ['payments', 'Search']])
  })
})

describe('useAgentRun', () => {
  function Probe({ source }: { source: AgentRunSource }) {
    const { run, status } = useAgentRun(source)
    return <p data-testid="probe">{status}:{run?.spans.length ?? 0}:{run?.status ?? '-'}</p>
  }
  it('folds an async iterable of updates, ending in done', async () => {
    const run = AGENT_RUN_FIXTURES[2].run()
    const source = (async function* () { yield* runToEvents(run) })()
    render(<Probe source={source} />)
    await waitFor(() => expect(screen.getByTestId('probe').textContent).toBe('done:21:ok'))
  })
  it('parses an NDJSON byte stream, and marks a run whose stream ended early as cancelled', async () => {
    const evs = runToEvents(AGENT_RUN_FIXTURES[0].run()).slice(0, 6)
    const bytes = new TextEncoder().encode(evs.map(e => JSON.stringify(e)).join('\n') + '\n{oops\n')
    const stream = new ReadableStream<Uint8Array>({ start(c) { c.enqueue(bytes.slice(0, 50)); c.enqueue(bytes.slice(50)); c.close() } })
    render(<Probe source={stream} />)
    await waitFor(() => expect(screen.getByTestId('probe').textContent).toBe('error:4:cancelled'))
  })
  it('maps SSE items with a mapper, and polls fetchRun until the run ends', async () => {
    const sse = LANGGRAPH_EVENTS_SAMPLE.map(e => `event: message\ndata: ${JSON.stringify(e)}\n\n`).join('') + 'data: [DONE]\n\n'
    function Mapped() { const { run, status } = useAgentRun(new Response(sse), { mapper: () => langGraphRunMapper({ agentNodes: ['planner'] }) }); return <p data-testid="m">{status}:{run?.spans.length}</p> }
    const { unmount } = render(<Mapped />)
    await waitFor(() => expect(screen.getByTestId('m').textContent).toBe('done:21'))
    unmount()
    const final = AGENT_RUN_FIXTURES[0].run()
    let n = 0
    const poll = { intervalMs: 100, fetchRun: async () => ++n < 2 ? { ...final, status: 'running' as const } : final }
    render(<Probe source={poll} />)
    await waitFor(() => expect(screen.getByTestId('probe').textContent).toBe('done:12:ok'), { timeout: 3000 })
  })
})

describe('visuals with a run', () => {
  it('TraceWaterfall draws a run: one row per span, error rows, event flags, no Simulate button', () => {
    const run = AGENT_RUN_FIXTURES[0].run()
    render(<TraceWaterfall run={run} />)
    expect(screen.getByText('Support agent', { selector: 'b' })).toBeTruthy()
    for (const s of run.spans) expect(screen.getAllByText(s.name).length).toBeGreaterThan(0)
    expect(screen.getAllByText('issue_refund')).toHaveLength(2)
    expect(screen.getByRole('listbox', { name: 'Events' }).querySelectorAll('[data-ann]')).toHaveLength(run.events.length)
    expect(screen.queryByRole('button', { name: 'Simulate failure' })).toBeNull()
  })
  it('TraceWaterfall grows with a live run and settles when it ends', () => {
    const now = Date.now()
    const live: AgentRun = { id: 'live', name: 'Live run', startedAt: now - 2000, status: 'running', events: [], spans: [
      { id: 'a', kind: 'agent', name: 'Agent', startMs: now - 2000, status: 'running', attributes: {} },
      { id: 'l', parentId: 'a', kind: 'llm', name: 'Thinking', startMs: now - 1500, status: 'running', attributes: {} }] }
    const { rerender } = render(<TraceWaterfall run={live} />)
    expect(screen.getByText('Live')).toBeTruthy()
    expect(screen.getByRole('listbox', { name: 'Events' })).toBeTruthy() // reserved for events still to come
    expect(screen.getByRole('button', { name: 'Replay' })).toBeDisabled()
    const more = runFromEvents([
      { type: 'span-end', id: 'l', endMs: now - 500, tokens: { input: 10, output: 5 } },
      { type: 'span-start', span: { id: 't', parentId: 'a', kind: 'tool', name: 'search', startMs: now - 400 } },
      { type: 'span-end', id: 't', endMs: now - 100, error: 'HTTP 502' },
    ], live)!
    act(() => rerender(<TraceWaterfall run={more} />))
    expect(screen.getByText('search')).toBeTruthy()
    act(() => rerender(<TraceWaterfall run={applyRunEvent(more, { type: 'run-end', at: now })} />))
    // a live run that ends stays at its end: the failed tool shows its error, the badge settles
    expect(screen.getByText(/Failed after 0\.3\s?s · HTTP 502/)).toBeTruthy()
    expect(screen.getByText('Completed with 1 error')).toBeTruthy()
    expect(screen.getByRole('listbox', { name: 'Events' }).querySelectorAll('[data-ann]')).toHaveLength(1)
  })
  it('TraceWaterfall without a run is unchanged (spans + total)', () => {
    render(<TraceWaterfall spans={[{ id: 'r', name: 'Run', kind: 'agent', start: 0, duration: 4 }]} total={4} />)
    expect(screen.getByRole('button', { name: 'Simulate failure' })).toBeDisabled()
    expect(screen.queryByRole('listbox', { name: 'Events' })).toBeNull()
  })
  it('AgentTransitMap draws a run: steps in the table, stations, a summary', () => {
    const run = AGENT_RUN_FIXTURES[2].run()
    render(<AgentTransitMap run={run} />)
    expect(screen.getByText('Trip planner')).toBeTruthy()
    expect(screen.getByText('Complete')).toBeTruthy()
    expect(screen.getByText(/10 steps/)).toBeTruthy()
    expect(screen.getAllByText('search_flights')).toHaveLength(2)
    expect(screen.getByText(/TimeoutError/)).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Pause' })).toBeNull() // no simulation controls
  })
  it('AgentTransitMap takes a station mapping', () => {
    const run = AGENT_RUN_FIXTURES[0].run()
    render(<AgentTransitMap run={run} stations={{ issue_refund: ['payments', 'Ledger'], llm: null }} />)
    expect(screen.getAllByText('Ledger').length).toBeGreaterThan(1) // the map label and the two table rows
    expect(screen.getAllByText('off the map').length).toBe(5)
  })
  it('runLaneNodes feeds LaneGraph (AgentRunLanes)', () => {
    const run = AGENT_RUN_FIXTURES[1].run()
    render(<AgentRunLanes run={run} />)
    expect(screen.getAllByRole('row')).toHaveLength(10)
    expect(screen.getAllByText('waits for 2')).toHaveLength(3)
  })
})
