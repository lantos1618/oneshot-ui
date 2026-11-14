import {
  fromAiSdkResult, fromLangGraphEvents, fromOtel,
  type AgentPricing, type AgentRun, type AiSdkResultLike, type LangGraphStreamEvent, type OtlpTraceExport,
} from '../lib/agentrun'

/* Agent runs from three real sources, recorded: an OTLP/JSON export of OpenTelemetry GenAI spans (a support agent that
 * hands off to a billing agent), a Vercel AI SDK generateText result (a research assistant, four steps) and LangGraph
 * astream_events v2 events (a trip planner with a subgraph, a failing tool, a human approval). The showcase's
 * "Live agent run" card and the adapter tests read them. Prices are samples, not a provider's price list. */

/** Sample prices in USD per million tokens (illustrative; use your provider's). */
export const AGENT_PRICING_SAMPLE: AgentPricing = {
  'gpt-4.1-mini': { input: 0.4, output: 1.6, cachedInput: 0.1 },
  'gpt-4.1': { input: 2, output: 8, cachedInput: 0.5 },
  'claude-sonnet-4-5': { input: 3, output: 15, cachedInput: 0.3 },
  'claude-haiku-4-5': { input: 1, output: 5, cachedInput: 0.1 },
}

/* ── OpenTelemetry: OTLP/JSON ──────────────────────────────────────────────── */

const OT_T0 = 1793715600000 // 2026-11-03 14:20:00 UTC
const OT_TRACE = '4bf92f3577b34da6a3ce929d0e0e4736'
const otNs = (ms: number) => `${OT_T0 + ms}000000`
type OtAttr = string | number | boolean | string[]
const otKv = (a: Record<string, OtAttr>) => Object.entries(a).map(([key, v]) => ({
  key, value: Array.isArray(v) ? { arrayValue: { values: v.map(stringValue => ({ stringValue })) } } : typeof v === 'string' ? { stringValue: v } : typeof v === 'boolean' ? { boolValue: v } : Number.isInteger(v) ? { intValue: String(v) } : { doubleValue: v },
}))
const otSpan = (spanId: string, parentSpanId: string, name: string, from: number, to: number, attributes: Record<string, OtAttr>, extra: { error?: string; events?: [number, string, Record<string, OtAttr>][] } = {}) => ({
  traceId: OT_TRACE, spanId, parentSpanId, name, kind: name.startsWith('GET ') || name.startsWith('POST ') ? 3 : 1,
  startTimeUnixNano: otNs(from), endTimeUnixNano: otNs(to), attributes: otKv(attributes),
  events: [...(extra.error ? [[to, 'exception', { 'exception.type': extra.error.split(':')[0], 'exception.message': extra.error }] as [number, string, Record<string, OtAttr>]] : []), ...(extra.events ?? [])]
    .map(([t, n, a]) => ({ timeUnixNano: otNs(t), name: n, attributes: otKv(a) })),
  status: extra.error ? { code: 2, message: extra.error } : { code: 1 },
})
const otChat = (model: string, response: string, input: number, output: number, cached: number, finish: string) => ({
  'gen_ai.operation.name': 'chat', 'gen_ai.provider.name': 'openai', 'gen_ai.system': 'openai', 'gen_ai.request.model': model, 'gen_ai.response.model': response,
  'gen_ai.usage.input_tokens': input, 'gen_ai.usage.output_tokens': output, ...(cached ? { 'gen_ai.usage.cache_read.input_tokens': cached } : {}), 'gen_ai.response.finish_reasons': [finish],
})
const otTool = (name: string, call: string) => ({ 'gen_ai.operation.name': 'execute_tool', 'gen_ai.tool.name': name, 'gen_ai.tool.call.id': call, 'gen_ai.tool.type': 'function' })

/**
 * An OTLP/JSON trace export (what an OpenTelemetry collector's file exporter writes, or `/v1/traces` receives): a
 * support agent answers a refund request, looks up the order and the policy in parallel, hands off to a billing agent
 * whose first refund call fails with a 503, retries after a person approves, and answers. GenAI semantic conventions
 * (gen_ai.operation.name, gen_ai.request.model, gen_ai.usage.*, gen_ai.tool.name, gen_ai.agent.name), plus one HTTP
 * client span under a tool (dropped by fromOtel's default `include: 'genai'`).
 */
export const OTEL_TRACE_SAMPLE: OtlpTraceExport = {
  resourceSpans: [{
    resource: { attributes: otKv({ 'service.name': 'support-agent', 'service.version': '2.14.0', 'deployment.environment.name': 'production' }) },
    scopeSpans: [{
      scope: { name: 'openai-agents', version: '0.6.1' },
      spans: [
        otSpan('a1f0c6d2e9b84c11', '', 'invoke_agent Support agent', 0, 11850, { 'gen_ai.operation.name': 'invoke_agent', 'gen_ai.agent.name': 'Support agent', 'gen_ai.agent.id': 'asst_support', 'gen_ai.provider.name': 'openai', 'gen_ai.conversation.id': 'conv_5f1c' }),
        otSpan('b2c4d6e8f0a21302', 'a1f0c6d2e9b84c11', 'chat gpt-4.1', 120, 1920, otChat('gpt-4.1', 'gpt-4.1-2025-04-14', 1830, 96, 1024, 'tool_calls')),
        otSpan('c3d5e7f9a1b32403', 'a1f0c6d2e9b84c11', 'execute_tool lookup_order', 1950, 2410, otTool('lookup_order', 'call_8xLq2')),
        otSpan('c3d5e7f9a1b32499', 'c3d5e7f9a1b32403', 'GET /v2/orders/{id}', 1980, 2390, { 'http.request.method': 'GET', 'url.full': 'https://orders.internal/v2/orders/A-20931', 'http.response.status_code': 200 }),
        otSpan('d4e6f8a0b2c43504', 'a1f0c6d2e9b84c11', 'execute_tool search_policy', 1960, 3120, otTool('search_policy', 'call_8xLq3')),
        otSpan('e5f7a9b1c3d54605', 'a1f0c6d2e9b84c11', 'chat gpt-4.1', 3150, 4900, otChat('gpt-4.1', 'gpt-4.1-2025-04-14', 2610, 141, 1792, 'tool_calls')),
        otSpan('f6a8b0c2d4e65706', 'a1f0c6d2e9b84c11', 'execute_tool transfer_to_billing', 4920, 4960, otTool('transfer_to_billing', 'call_9mDe1')),
        otSpan('a7b9c1d3e5f76807', 'a1f0c6d2e9b84c11', 'invoke_agent Billing agent', 4980, 10400, { 'gen_ai.operation.name': 'invoke_agent', 'gen_ai.agent.name': 'Billing agent', 'gen_ai.agent.id': 'asst_billing', 'gen_ai.provider.name': 'openai' }),
        otSpan('b8c0d2e4f6a87908', 'a7b9c1d3e5f76807', 'chat gpt-4.1-mini', 5010, 6230, otChat('gpt-4.1-mini', 'gpt-4.1-mini-2025-04-14', 1420, 88, 0, 'tool_calls')),
        otSpan('c9d1e3f5a7b98a09', 'a7b9c1d3e5f76807', 'execute_tool issue_refund', 6260, 7400, otTool('issue_refund', 'call_Rf01'), { error: 'PaymentsError: 503 Service Unavailable' }),
        otSpan('d0e2f4a6b8c09b10', 'a7b9c1d3e5f76807', 'execute_tool issue_refund', 7900, 9380, otTool('issue_refund', 'call_Rf02'), {
          events: [[7900, 'retry', { attempt: 2, 'retry.reason': '503 from payments' }], [7950, 'approval.requested', { amount: 'CHF 84.00', policy: 'refunds over CHF 50' }], [9100, 'approval.granted', { approver: 'Dana (support lead)' }]],
        }),
        otSpan('e1f3a5b7c9d1ac11', 'a7b9c1d3e5f76807', 'chat gpt-4.1-mini', 9400, 10380, otChat('gpt-4.1-mini', 'gpt-4.1-mini-2025-04-14', 1890, 164, 1280, 'stop')),
        otSpan('f2a4b6c8d0e2bd12', 'a1f0c6d2e9b84c11', 'chat gpt-4.1', 10420, 11800, otChat('gpt-4.1', 'gpt-4.1-2025-04-14', 3120, 212, 2560, 'stop')),
      ],
    }],
  }],
}

/* ── Vercel AI SDK: a generateText result ──────────────────────────────────── */

const AS_T0 = 1793783550000 // 2026-11-04 09:12:30 UTC
const asAt = (ms: number) => new Date(AS_T0 + ms).toISOString()
/**
 * A `generateText({ model, tools, stopWhen: stepCountIs(6) })` result (AI SDK 5 field names, as JSON: timestamps are
 * ISO strings): a research assistant searches the web and its notes in parallel, fetches two pages (one times out),
 * checks the facts and saves a note in parallel, then writes the answer. Four steps, with usage per step.
 */
export const AI_SDK_RESULT_SAMPLE: AiSdkResultLike = {
  finishReason: 'stop',
  response: { id: 'msg_01J9ZK4Q7R', modelId: 'claude-sonnet-4-5', timestamp: asAt(0) },
  totalUsage: { inputTokens: 21150, outputTokens: 966, cachedInputTokens: 13184 },
  steps: [
    {
      content: [
        { type: 'tool-call', toolCallId: 'toolu_01', toolName: 'searchWeb', input: { query: 'EU AI Act general-purpose model obligations 2026' } },
        { type: 'tool-call', toolCallId: 'toolu_02', toolName: 'recallNotes', input: { topic: 'AI Act' } },
        { type: 'tool-result', toolCallId: 'toolu_01', toolName: 'searchWeb', output: { results: 8 } },
        { type: 'tool-result', toolCallId: 'toolu_02', toolName: 'recallNotes', output: { notes: 3 } },
      ],
      finishReason: 'tool-calls', usage: { inputTokens: 1240, outputTokens: 118, totalTokens: 1358 },
      response: { id: 'msg_01J9ZK4Q7R', modelId: 'claude-sonnet-4-5', timestamp: asAt(0) },
    },
    {
      content: [
        { type: 'tool-call', toolCallId: 'toolu_03', toolName: 'fetchPage', input: { url: 'https://digital-strategy.ec.europa.eu/en/policies/regulatory-framework-ai' } },
        { type: 'tool-call', toolCallId: 'toolu_04', toolName: 'fetchPage', input: { url: 'https://artificialintelligenceact.eu/gpai-guidelines/' } },
        { type: 'tool-error', toolCallId: 'toolu_03', toolName: 'fetchPage', error: 'Timeout after 8000 ms' },
        { type: 'tool-result', toolCallId: 'toolu_04', toolName: 'fetchPage', output: { chars: 41230 } },
      ],
      finishReason: 'tool-calls', usage: { inputTokens: 4880, outputTokens: 96, totalTokens: 4976, cachedInputTokens: 1152 },
      response: { id: 'msg_01J9ZK5B2M', modelId: 'claude-sonnet-4-5', timestamp: asAt(3400) },
    },
    {
      content: [
        { type: 'text', text: 'The fetched guidelines cover the August 2025 and 2026 dates; checking them before saving.' },
        { type: 'tool-call', toolCallId: 'toolu_05', toolName: 'checkFacts', input: { claims: 4 } },
        { type: 'tool-call', toolCallId: 'toolu_06', toolName: 'saveNote', input: { title: 'GPAI obligations timeline' } },
        { type: 'tool-result', toolCallId: 'toolu_05', toolName: 'checkFacts', output: { verified: 4 } },
        { type: 'tool-result', toolCallId: 'toolu_06', toolName: 'saveNote', output: { id: 'note_77' } },
      ],
      finishReason: 'tool-calls', usage: { inputTokens: 7310, outputTokens: 240, totalTokens: 7550, cachedInputTokens: 4864 },
      response: { id: 'msg_01J9ZK6X0C', modelId: 'claude-sonnet-4-5', timestamp: asAt(11800) },
    },
    {
      content: [{ type: 'text', text: 'Providers of general-purpose AI models have had transparency and copyright obligations since 2 August 2025…' }],
      text: 'Providers of general-purpose AI models have had transparency and copyright obligations since 2 August 2025…',
      finishReason: 'stop', usage: { inputTokens: 7720, outputTokens: 512, totalTokens: 8232, cachedInputTokens: 7168 },
      response: { id: 'msg_01J9ZK7H4D', modelId: 'claude-sonnet-4-5', timestamp: asAt(14600) },
    },
  ],
}
/** When AI_SDK_RESULT_SAMPLE's call ended (ms epoch): the last step has no successor to end it. */
export const AI_SDK_RESULT_ENDED = AS_T0 + 19900

/**
 * The same kind of run as an AI SDK UI message stream (the parts `toUIMessageStreamResponse()` sends), each with the
 * time it arrived: two steps, a tool call in the first, usage per step through message-metadata.
 */
export const AI_SDK_STREAM_SAMPLE: { at: number; part: Record<string, unknown> }[] = ([
  [0, { type: 'start', messageId: 'msg_stream_1' }],
  [10, { type: 'start-step' }],
  [900, { type: 'tool-input-start', toolCallId: 'call_1', toolName: 'searchWeb' }],
  [1100, { type: 'tool-input-available', toolCallId: 'call_1', toolName: 'searchWeb', input: { query: 'Lisbon in December' } }],
  [2600, { type: 'tool-output-available', toolCallId: 'call_1', output: { results: 6 } }],
  [2610, { type: 'finish-step' }],
  [2612, { type: 'message-metadata', messageMetadata: { model: 'gpt-4.1-mini', usage: { inputTokens: 820, outputTokens: 42 } } }],
  [2620, { type: 'start-step' }],
  [3100, { type: 'text-start', id: 't1' }],
  [3150, { type: 'text-delta', id: 't1', delta: 'December in Lisbon is mild' }],
  [4400, { type: 'text-end', id: 't1' }],
  [4410, { type: 'finish-step' }],
  [4412, { type: 'message-metadata', messageMetadata: { usage: { inputTokens: 1460, outputTokens: 210, cachedInputTokens: 768 } } }],
  [4420, { type: 'finish' }],
] as [number, Record<string, unknown>][]).map(([ms, part]) => ({ at: AS_T0 + ms, part }))

/* ── LangGraph: astream_events v2 ──────────────────────────────────────────── */

const LG_T0 = 1793897110 // 2026-11-05 16:45:10 UTC, in seconds (Python's time.time())
const LG_THREAD = 'thread-7f3a'
const LG_IDS = {
  graph: '1efa9c2e-6b1d-6f40-8000-0c2b4a1d9e01', planner: '1efa9c2e-6b1d-6f40-8001-3d9a7b02c1f2', plannerLlm: '9b4c7e21-0d5a-4c8e-b1f3-2a6d8e0c4b11',
  researcher: '1efa9c2e-6b1d-6f40-8002-5e1b3c7d9a03', agent1: '1efa9c2e-7a0c-6c22-8001-6f2a4d8b1c04', llm1: '3c8d1f42-7e6b-4a9c-8d2e-1b5f7a3c9e21',
  route1: '4d9e2a53-8f7c-4b0d-9e3f-2c6a8b4d0f32', write1: '5e0f3b64-9a8d-4c1e-af40-3d7b9c5e1a43', tools1: '1efa9c2e-7a0c-6c22-8002-7a3b5e9c2d05',
  flights1: '6f1a4c75-ab9e-4d2f-b051-4e8cad6f2b54', hotels: '7a2b5d86-bcaf-4e30-c162-5f9dbe7a3c65', agent2: '1efa9c2e-7a0c-6c22-8003-8b4c6fad3e06',
  llm2: '8b3c6e97-cdb0-4f41-d273-6aaecf8b4d76', tools2: '1efa9c2e-7a0c-6c22-8004-9c5d7abe4f07', flights2: '9c4d7fa8-dec1-4052-e384-7bbfda9c5e87',
  agent3: '1efa9c2e-7a0c-6c22-8005-ad6e8bcf5a08', llm3: 'ad5e8ab9-efd2-4163-f495-8cc0ebad6f98', review: '1efa9c2e-6b1d-6f40-8003-be7f9cd06b09',
  book: '1efa9c2e-6b1d-6f40-8004-cf8a0de17c10', bookHotel: 'be6f9bca-f0e3-4274-a5a6-9dd1fcbe7a09', writer: '1efa9c2e-6b1d-6f40-8005-d09b1ef28d11', writerLlm: 'cf7a0cdb-01f4-4385-b6b7-aee20dcf8b1a',
}
type LgId = keyof typeof LG_IDS
const lgAi = (model: string, input: number, output: number, cached: number, content: string, toolCalls: { name: string; id: string; args: Record<string, unknown> }[] = []) => ({
  type: 'ai', content, tool_calls: toolCalls.map(c => ({ ...c, type: 'tool_call' })),
  usage_metadata: { input_tokens: input, output_tokens: output, total_tokens: input + output, ...(cached ? { input_token_details: { cache_read: cached } } : {}) },
  response_metadata: { model_name: model, stop_reason: toolCalls.length ? 'tool_use' : 'end_turn' },
})
const lg = (sec: number, event: string, name: string, id: LgId, parents: LgId[], extra: { node?: string; step?: number; ns?: string; model?: string; tags?: string[]; data?: Record<string, unknown> } = {}): LangGraphStreamEvent => ({
  event, name, run_id: LG_IDS[id], parent_ids: parents.map(p => LG_IDS[p]), tags: extra.tags ?? (extra.node ? [`graph:step:${extra.step ?? 1}`] : []),
  metadata: { thread_id: LG_THREAD, ...(extra.node ? { langgraph_node: extra.node, langgraph_step: extra.step ?? 1, langgraph_triggers: [`branch:to:${extra.node}`] } : {}), ...(extra.ns ? { checkpoint_ns: extra.ns } : {}),
    ...(extra.model ? { ls_provider: 'anthropic', ls_model_name: extra.model, ls_model_type: 'chat', ls_temperature: 0 } : {}) },
  data: extra.data ?? {}, timestamp: Math.round((LG_T0 + sec) * 1000) / 1000,
})
const LG_R = ['graph', 'researcher'] as LgId[], LG_NS = 'researcher:6c2a1e0b-4d3f-5e7a-9b1c-2d4e6f8a0b1c'
/**
 * `graph.astream_events(inputs, config, version="v2")` from a LangGraph trip planner, as a Python server relays them
 * (each with a `timestamp` added, epoch seconds): a planner node, a researcher subgraph (create_react_agent: agent and
 * tools nodes) whose flight search times out (ToolNode reports it as a ToolMessage with status "error") and succeeds on
 * the next turn, a human_review node that asks for approval through custom events, a booking tool and a writer. Internal
 * runnables (a routing function, a hidden channel write) are included, as LangChain sends them.
 */
export const LANGGRAPH_EVENTS_SAMPLE: LangGraphStreamEvent[] = [
  lg(0, 'on_chain_start', 'LangGraph', 'graph', [], { data: { input: { messages: [{ type: 'human', content: 'Plan 3 nights in Lisbon from Zurich, 4–7 December, under €1,300.' }] } } }),
  lg(0.004, 'on_chain_start', 'planner', 'planner', ['graph'], { node: 'planner', step: 1 }),
  lg(0.01, 'on_chat_model_start', 'ChatAnthropic', 'plannerLlm', ['graph', 'planner'], { node: 'planner', step: 1, model: 'claude-haiku-4-5' }),
  lg(0.42, 'on_chat_model_stream', 'ChatAnthropic', 'plannerLlm', ['graph', 'planner'], { node: 'planner', step: 1, model: 'claude-haiku-4-5', data: { chunk: { type: 'AIMessageChunk', content: 'Plan:' } } }),
  lg(1.38, 'on_chat_model_end', 'ChatAnthropic', 'plannerLlm', ['graph', 'planner'], { node: 'planner', step: 1, model: 'claude-haiku-4-5', data: { output: lgAi('claude-haiku-4-5-20251001', 612, 184, 0, 'Plan: find flights ZRH→LIS, 3 hotel nights, check budget, book after approval.') } }),
  lg(1.386, 'on_chain_end', 'planner', 'planner', ['graph'], { node: 'planner', step: 1 }),
  lg(1.39, 'on_chain_start', 'researcher', 'researcher', ['graph'], { node: 'researcher', step: 2 }),
  lg(1.396, 'on_chain_start', 'agent', 'agent1', LG_R, { node: 'agent', step: 1, ns: LG_NS }),
  lg(1.402, 'on_chat_model_start', 'ChatAnthropic', 'llm1', [...LG_R, 'agent1'], { node: 'agent', step: 1, ns: LG_NS, model: 'claude-sonnet-4-5' }),
  lg(2.1, 'on_chat_model_stream', 'ChatAnthropic', 'llm1', [...LG_R, 'agent1'], { node: 'agent', step: 1, ns: LG_NS, model: 'claude-sonnet-4-5', data: { chunk: { type: 'AIMessageChunk', content: '' } } }),
  lg(3.26, 'on_chat_model_end', 'ChatAnthropic', 'llm1', [...LG_R, 'agent1'], { node: 'agent', step: 1, ns: LG_NS, model: 'claude-sonnet-4-5', data: { output: lgAi('claude-sonnet-4-5-20250929', 1480, 156, 0, '', [
    { name: 'search_flights', id: 'toolu_01Fz', args: { origin: 'ZRH', destination: 'LIS', date: '2026-12-04' } }, { name: 'search_hotels', id: 'toolu_01Hq', args: { city: 'Lisbon', nights: 3 } }]) } }),
  lg(3.262, 'on_chain_start', 'should_continue', 'route1', [...LG_R, 'agent1'], { node: 'agent', step: 1, ns: LG_NS, tags: ['seq:step:3'] }),
  lg(3.264, 'on_chain_end', 'should_continue', 'route1', [...LG_R, 'agent1'], { node: 'agent', step: 1, ns: LG_NS, tags: ['seq:step:3'], data: { output: 'tools' } }),
  lg(3.265, 'on_chain_start', 'ChannelWrite<agent,messages>', 'write1', [...LG_R, 'agent1'], { node: 'agent', step: 1, ns: LG_NS, tags: ['seq:step:2', 'langgraph:hidden'] }),
  lg(3.266, 'on_chain_end', 'ChannelWrite<agent,messages>', 'write1', [...LG_R, 'agent1'], { node: 'agent', step: 1, ns: LG_NS, tags: ['seq:step:2', 'langgraph:hidden'] }),
  lg(3.268, 'on_chain_end', 'agent', 'agent1', LG_R, { node: 'agent', step: 1, ns: LG_NS }),
  lg(3.272, 'on_chain_start', 'tools', 'tools1', LG_R, { node: 'tools', step: 2, ns: LG_NS }),
  lg(3.276, 'on_tool_start', 'search_flights', 'flights1', [...LG_R, 'tools1'], { node: 'tools', step: 2, ns: LG_NS, data: { input: { origin: 'ZRH', destination: 'LIS', date: '2026-12-04' } } }),
  lg(3.28, 'on_tool_start', 'search_hotels', 'hotels', [...LG_R, 'tools1'], { node: 'tools', step: 2, ns: LG_NS, data: { input: { city: 'Lisbon', nights: 3 } } }),
  lg(4.91, 'on_tool_end', 'search_hotels', 'hotels', [...LG_R, 'tools1'], { node: 'tools', step: 2, ns: LG_NS, data: { output: { type: 'tool', name: 'search_hotels', tool_call_id: 'toolu_01Hq', status: 'success', content: '12 hotels, from €96/night' } } }),
  lg(8.28, 'on_chain_end', 'tools', 'tools1', LG_R, { node: 'tools', step: 2, ns: LG_NS, data: { output: { messages: [
    { type: 'tool', name: 'search_flights', tool_call_id: 'toolu_01Fz', status: 'error', content: 'Error: TimeoutError("flights API did not answer in 5 s")\n Please fix your mistakes.' },
    { type: 'tool', name: 'search_hotels', tool_call_id: 'toolu_01Hq', status: 'success', content: '12 hotels, from €96/night' }] } } }),
  lg(8.286, 'on_chain_start', 'agent', 'agent2', LG_R, { node: 'agent', step: 3, ns: LG_NS }),
  lg(8.292, 'on_chat_model_start', 'ChatAnthropic', 'llm2', [...LG_R, 'agent2'], { node: 'agent', step: 3, ns: LG_NS, model: 'claude-sonnet-4-5' }),
  lg(10.02, 'on_chat_model_end', 'ChatAnthropic', 'llm2', [...LG_R, 'agent2'], { node: 'agent', step: 3, ns: LG_NS, model: 'claude-sonnet-4-5', data: { output: lgAi('claude-sonnet-4-5-20250929', 2210, 74, 1408, '', [
    { name: 'search_flights', id: 'toolu_02Fz', args: { origin: 'ZRH', destination: 'LIS', date: '2026-12-04' } }]) } }),
  lg(10.026, 'on_chain_end', 'agent', 'agent2', LG_R, { node: 'agent', step: 3, ns: LG_NS }),
  lg(10.03, 'on_chain_start', 'tools', 'tools2', LG_R, { node: 'tools', step: 4, ns: LG_NS }),
  lg(10.034, 'on_tool_start', 'search_flights', 'flights2', [...LG_R, 'tools2'], { node: 'tools', step: 4, ns: LG_NS, data: { input: { origin: 'ZRH', destination: 'LIS', date: '2026-12-04' } } }),
  lg(11.62, 'on_tool_end', 'search_flights', 'flights2', [...LG_R, 'tools2'], { node: 'tools', step: 4, ns: LG_NS, data: { output: { type: 'tool', name: 'search_flights', tool_call_id: 'toolu_02Fz', status: 'success', content: 'TP931 07:05 €212, LX2084 09:40 €264' } } }),
  lg(11.626, 'on_chain_end', 'tools', 'tools2', LG_R, { node: 'tools', step: 4, ns: LG_NS }),
  lg(11.63, 'on_chain_start', 'agent', 'agent3', LG_R, { node: 'agent', step: 5, ns: LG_NS }),
  lg(11.636, 'on_chat_model_start', 'ChatAnthropic', 'llm3', [...LG_R, 'agent3'], { node: 'agent', step: 5, ns: LG_NS, model: 'claude-sonnet-4-5' }),
  lg(13.9, 'on_chat_model_end', 'ChatAnthropic', 'llm3', [...LG_R, 'agent3'], { node: 'agent', step: 5, ns: LG_NS, model: 'claude-sonnet-4-5', data: { output: lgAi('claude-sonnet-4-5-20250929', 2980, 388, 2176, 'TP931 on 4 Dec and Hotel Lumiares, 3 nights: €1,184 in total.') } }),
  lg(13.906, 'on_chain_end', 'agent', 'agent3', LG_R, { node: 'agent', step: 5, ns: LG_NS }),
  lg(13.91, 'on_chain_end', 'researcher', 'researcher', ['graph'], { node: 'researcher', step: 2 }),
  lg(13.914, 'on_chain_start', 'human_review', 'review', ['graph'], { node: 'human_review', step: 3 }),
  lg(13.92, 'on_custom_event', 'approval_requested', 'review', ['graph'], { node: 'human_review', step: 3, data: { label: 'Approve booking', summary: 'TP931 + Hotel Lumiares, €1,184' } }),
  lg(19.4, 'on_custom_event', 'approval_granted', 'review', ['graph'], { node: 'human_review', step: 3, data: { by: 'Maya' } }),
  lg(19.406, 'on_chain_end', 'human_review', 'review', ['graph'], { node: 'human_review', step: 3 }),
  lg(19.41, 'on_chain_start', 'book', 'book', ['graph'], { node: 'book', step: 4 }),
  lg(19.416, 'on_tool_start', 'book_hotel', 'bookHotel', ['graph', 'book'], { node: 'book', step: 4, data: { input: { hotel: 'Hotel Lumiares', nights: 3, checkin: '2026-12-04' } } }),
  lg(21.05, 'on_tool_end', 'book_hotel', 'bookHotel', ['graph', 'book'], { node: 'book', step: 4, data: { output: { type: 'tool', name: 'book_hotel', status: 'success', content: 'Confirmed: LUM-48213' } } }),
  lg(21.056, 'on_chain_end', 'book', 'book', ['graph'], { node: 'book', step: 4 }),
  lg(21.06, 'on_chain_start', 'writer', 'writer', ['graph'], { node: 'writer', step: 5 }),
  lg(21.066, 'on_chat_model_start', 'ChatAnthropic', 'writerLlm', ['graph', 'writer'], { node: 'writer', step: 5, model: 'claude-haiku-4-5' }),
  lg(23.48, 'on_chat_model_end', 'ChatAnthropic', 'writerLlm', ['graph', 'writer'], { node: 'writer', step: 5, model: 'claude-haiku-4-5', data: { output: lgAi('claude-haiku-4-5-20251001', 1320, 296, 0, 'You’re booked: TP931 on 4 December, Hotel Lumiares for 3 nights…') } }),
  lg(23.486, 'on_chain_end', 'writer', 'writer', ['graph'], { node: 'writer', step: 5 }),
  lg(23.49, 'on_chain_end', 'LangGraph', 'graph', [], { data: { output: { messages: 9 } } }),
]

/* ── The three as runs ─────────────────────────────────────────────────────── */

export type AgentRunFixture = { key: 'otel' | 'ai-sdk' | 'langgraph'; label: string; run: () => AgentRun }
/** The three recorded runs through their adapters, with sample prices. */
export const AGENT_RUN_FIXTURES: AgentRunFixture[] = [
  { key: 'otel', label: 'OpenTelemetry', run: () => fromOtel(OTEL_TRACE_SAMPLE, { pricing: AGENT_PRICING_SAMPLE }) },
  { key: 'ai-sdk', label: 'AI SDK', run: () => fromAiSdkResult(AI_SDK_RESULT_SAMPLE, { name: 'Research assistant', pricing: AGENT_PRICING_SAMPLE, endedAt: AI_SDK_RESULT_ENDED }) },
  { key: 'langgraph', label: 'LangGraph', run: () => fromLangGraphEvents(LANGGRAPH_EVENTS_SAMPLE, { pricing: AGENT_PRICING_SAMPLE, agentNodes: ['planner', 'writer'], name: 'Trip planner' }) },
]
