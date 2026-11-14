import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Badge, sleep, useToast, useViewport, fmt } from '../lib'
import { PromptInput, AgentPlan, SourceList, Citation, sourceDomain, ConfidenceField, GhostTextInput, ModelComparison, PermissionRequest, type Source, SourcesPanel, SuggestedEdit, ThinkingSteps, VoiceInput, type StepStatus } from '../lib/ai'
import { AICanvas, AgentRunView, type AgentRunViewMode } from '../lib/aiagent'
import { AI_RICH_RENDERERS, AgentComposer, Conversation, Message, MessageActions, Suggestions, AssistantChat, ChatCard, ChatChecklist, type ChatScript, type ComposerModel, type ComposerAction, type ComposerReply, type ComposerSample, type ComposerSendMeta, type Connector, type SlashCommand, type WorkspaceItem } from '../lib/aichat'
import { type AiChunk, type AiMessage, type AiToolPart, aiMessageText, useAiChat } from '../lib/aistream'
import { Chart } from '../lib/charts'
import { CodeBlock } from '../lib/code'
import { AI_DEMO_RISKY, ChatApproval } from '../examples/ai-demo'
import { AGENT_WORKFLOWS, AGENT_WORKFLOW_ORDER, AGENT_RUN_FIXTURES, type AgentRunFixture } from '../examples'
import { canvasDemoProps } from '../examples/canvas-demo'
import { TransitSimMap } from '../examples/transit-sim'
import { Button, Icon, SegmentedControl } from '../lib'
import { replayRun, useAgentRun, type AgentRunSource } from '../lib/agentrun'
import { Section, Spec, SpecAction } from './kit'

export type Invoice = { id: string; customer: string; status: string; amount: number }

const MRR = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov'].map((label, i) => ({ label, mrr: [29.6, 30.1, 31.4, 31.9, 32.6, 36.2, 37.0, 38.1, 39.4, 40.2, 41.3][i] * 1000 }))
const TOP = [['Northwind', 'Enterprise', 'Active', 3904], ['Quill Labs', 'Team', 'Active', 3900], ['Helix Bio', 'Enterprise', 'Trial', 3672], ['Meridian', 'Team', 'Active', 2960], ['Arcwise', 'Pro', 'Trial', 2811]] as const
const RETRY = `async function withRetry(fn, { retries = 3, base = 300 } = {}) {
  for (let i = 0; ; i++) {
    try { return await fn(); }
    catch (err) {
      if (i >= retries || err.status < 500) throw err;
      const wait = base * 2 ** i * (0.5 + Math.random());
      await new Promise(r => setTimeout(r, wait));
    }
  }
}`
const STARTERS = ['Summarise this week', 'Draft a reply to Sam', 'What’s blocking launch?', 'Chart MRR this year', 'Top customers table', 'Write a retry snippet']
const COMMANDS: SlashCommand[] = [
  { cmd: '/chart', prompt: 'Chart MRR this year', hint: 'Line chart from billing' }, { cmd: '/table', prompt: 'Top customers table', hint: 'Ranked table with status' },
  { cmd: '/code', prompt: 'Write a retry snippet', hint: 'Code block with copy' }, { cmd: '/summary', prompt: 'Summarise this week', hint: 'Summary with sources' },
  { cmd: '/draft', prompt: 'Draft a reply to Sam', hint: 'Email with approval' }, { cmd: '/blockers', prompt: 'What’s blocking launch?', hint: 'Checklist of blockers' },
]

function respond(q: string): ChatScript {
  const k = /chart|mrr|revenue|graph/i.test(q) ? 'chart' : /table|customer|top/i.test(q) ? 'table' : /code|snippet|retry/i.test(q) ? 'code' : /week|summar/i.test(q) ? 'sum' : /reply|sam|draft|email/i.test(q) ? 'draft' : /block|launch/i.test(q) ? 'block' : 'other'
  switch (k) {
    case 'sum': return { tool: ['Reading 34 messages', 'Read 34 messages', 'threads.search(since="7d") → 34 messages, 6 threads'],
      versions: ['This week: the redesign moved into build, two bugs were fixed before release, and launch slipped to Thursday because legal review is still open.', 'Short version: build started, two bugs fixed, launch is now Thursday pending legal.'],
      part: <SourceList sources={[{ title: 'Linear', domain: 'Weekly digest', color: '#5E6AD2' }, { title: 'Slack', domain: '#launch, 34 messages', color: '#16A34A' }, { title: 'Notion', domain: 'Launch checklist', color: '#71717A' }]} />,
      followUps: ['Chart MRR this year', 'What’s blocking launch?'] }
    case 'draft': return { tool: ['Reading thread with Sam', 'Read thread with Sam', 'threads.get("Sam") → 5 messages'],
      versions: ['Hi Sam, thanks for the notes. I’ve applied the copy changes and moved the CTA above the fold. Could you take another look by Wednesday?', 'Hey Sam, done. Copy updated and CTA moved up. Mind a quick re-review before Wednesday?'],
      part: <ChatApproval title="Send to Sam?" to="Email · sam@quill.io" body="Hi Sam, thanks for the notes. I’ve applied the copy changes and moved the CTA above the fold. Could you take another look by Wednesday?" />,
      followUps: ['Summarise this week'] }
    case 'block': return { tool: ['Checking open issues', 'Checked open issues', 'issues.list(label="launch", state="open") → 3'],
      versions: ['Three things: legal sign-off on the new terms, one payment bug on Safari, and final hero images. Legal is the critical path.'],
      part: <ChatChecklist title="Blocking launch" items={[{ label: 'Legal sign-off on new terms', note: 'Critical path', tone: 'bad' }, { label: 'Safari payment bug', note: 'In review', tone: 'warn' }, { label: 'Final hero images', note: 'Due Wed', tone: 'accent' }]} />,
      followUps: ['Top customers table', 'Draft a reply to Sam'] }
    case 'chart': return { tool: ['Querying billing', 'Queried billing', 'sql: SELECT month, SUM(mrr) FROM subscriptions GROUP BY 1 → 11 rows'],
      versions: ['MRR grew 38% this year, from €29.6k to €41.3k, with the biggest jump in June after the annual plan launched.'],
      part: <ChatCard title="MRR" sub="Jan – Nov 2026" badge={<Badge tone="ok">+38%</Badge>}><Chart data={MRR} x="label" series={[{ key: 'mrr', label: 'MRR', type: 'area' }]} height={150} legend={false} zero={false} domain={[28000, 42000]} format={n => `€${(n / 1000).toFixed(1)}k`} /></ChatCard>,
      followUps: ['Top customers table', 'Write a retry snippet'] }
    case 'table': return { tool: ['Ranking customers', 'Ranked customers', 'customers.top(by="mrr", limit=5)'],
      versions: ['Your top five customers make up 31% of MRR. Two are on trial, worth a nudge before month end.'],
      part: <AiTopTable />,
      followUps: ['Chart MRR this year'] }
    case 'code': return { tool: ['Reading flow docs', 'Read flow docs', 'docs.search("retries backoff") → 3 pages'],
      versions: ['Here’s a retry wrapper with exponential backoff and jitter. It stops on 4xx errors, which won’t succeed on retry.'],
      part: <CodeBlock code={RETRY} filename="retry.js" className="max-w-[560px]" />, followUps: ['Summarise this week'] }
    default: return { tool: ['Searching workspace', 'Searched workspace', 'search(query) → 0 exact matches'],
      versions: ['I didn’t find anything specific for that. Try a starter, or type / to see what I can show you.'], followUps: ['Summarise this week', 'Chart MRR this year'] }
  }
}

/** The "Top customers table" answer: amounts in the reader's locale. */
function AiTopTable() {
  return (
    <ChatCard>
      <div className="-mx-1 overflow-x-auto px-1 [contain:inline-size]"><table className="w-full min-w-[300px] border-collapse text-xs">
        <thead><tr className="text-start text-[var(--fg3)]">{['Company', 'Plan', 'Status'].map(h => <th key={h} className="border-b border-[var(--line)] px-1.5 py-1 text-start font-medium">{h}</th>)}<th className="border-b border-[var(--line)] px-1.5 py-1 text-end font-medium">MRR</th></tr></thead>
        <tbody>{TOP.map(([c, p, s, m]) => <tr key={c} className="[&:not(:last-child)>td]:border-b [&>td]:border-[var(--line)]"><td className="px-1.5 py-[7px]">{c}</td><td className="px-1.5">{p}</td><td className="px-1.5"><Badge tone={s === 'Active' ? 'ok' : 'accent'}>{s}</Badge></td><td className="ui-num px-1.5 text-end">{fmt.money(m, 'EUR')}</td></tr>)}</tbody>
      </table></div>
      <a href="#data" className="mt-2 inline-flex min-h-8 items-center text-xs text-[var(--accent)] no-underline">Open in data grid <span className="inline-block">→</span></a>
    </ChatCard>
  )
}

const THOUGHTS = [
  { label: 'Understanding the request', detail: 'Compare our pricing with two competitors and suggest a yearly discount.', duration: 1.2 },
  { label: 'Searching sources', detail: 'Found pricing pages and two changelog posts.', sources: ['Pricing docs', 'Changelog', 'Community forum'], duration: 2.4 },
  { label: 'Comparing plans', detail: 'Competitors discount yearly plans by 15 to 20%.', duration: 1.8 },
  { label: 'Checking the maths', detail: '24 × 12 × 0.8 = 230.40 a year, saving 57.60.', duration: 1.3 },
  { label: 'Drafting the answer', detail: 'Recommend 20% off yearly, shown as €19 a month.', duration: 1.4 },
]
const SRC: Source[] = [
  { title: 'Product analytics', url: 'https://analytics.example.com/funnel', snippet: 'Last 30 days, 4,210 sessions.' },
  { title: 'UX research report', url: 'https://notes.example.com/research', snippet: 'October study, 18 participants.' },
  { title: 'Retention cohorts', url: 'https://analytics.example.com/cohorts', snippet: 'Q3 cohorts, invited vs solo workspaces.' },
]

/* Agent composer demo: a workspace, connectors, models and a canned reply (a real app passes its own). */
const AC_ITEMS: WorkspaceItem[] = [
  { label: 'Invoice #1042', title: 'Invoice #1042', sub: 'Acme GmbH · €4,280 · overdue', icon: '📄' },
  { label: 'auth.ts · L42–58', title: 'auth.ts', sub: 'Lines 42–58 · token refresh', icon: '⌘' },
  { label: 'Linear · ENG-812', title: 'ENG-812', sub: 'Checkout times out on retry', icon: '◎' },
]
const AC_DOC = 'Q3 revenue grew 18% to €2.4M, driven by annual Pro upgrades. Churn fell to 2.1%, but EU payment failures doubled after the processor change in August.'
const AC_CONNECTORS: Connector[] = ([['Exa', 'Web search for agents', '#1F2937', true], ['GitHub', 'Repos, issues, pull requests', '#24292F', true], ['Linear', 'Issues and projects', '#5E6AD2', false], ['Slack', 'Channels and messages', '#4A154B', false], ['Google Drive', 'Docs, Sheets, Slides', '#1A73E8', true], ['Notion', 'Pages and databases', '#37352F', false], ['Postgres', 'MCP server · read-only SQL', '#336791', false], ['Filesystem', 'MCP server · local files', '#0F766E', false], ['Stripe', 'Payments and invoices', '#635BFF', false]] as const)
  .map(([name, desc, color, on]) => ({ name, desc, color, on }))
const AI_DEMO_MODELS: ComposerModel[] = [
  { name: 'Opus 5.5', vendor: 'Anthropic', speeds: ['Normal', 'Fast'], efforts: ['Low', 'Medium', 'High', 'Max'], wordDelay: { Fast: 26 } },
  { name: 'Sonnet 5.5', vendor: 'Anthropic', speeds: ['Normal', 'Fast'], efforts: ['Low', 'Medium', 'High'], wordDelay: { Fast: 26 } },
  { name: 'Haiku 5.5', vendor: 'Anthropic', speeds: ['Normal'], efforts: ['Low', 'Medium'] },
  { name: 'Reasoner R2', vendor: 'Provider B', speeds: ['Normal', 'Priority'], efforts: ['Minimal', 'Low', 'Medium', 'High', 'Ultra'], wordDelay: { Priority: 30 } },
  { name: 'Open 70B', vendor: 'Fast host', speeds: ['Normal', 'Fast', 'Ultra fast'], efforts: ['Off', 'Low', 'High'], wordDelay: { Fast: 26, 'Ultra fast': 14 } },
]
const AC_SAMPLES: ComposerSample[] = [{ title: 'Attach sample', desc: 'Adds a demo report.pdf', files: () => [new File([new Uint8Array(248000)], 'Q3 report.pdf', { type: 'application/pdf' })] }]
/**
 * The demo's "agent": a canned reply that mentions what was attached. Anything that would act (send, remind, create,
 * deploy…) comes back as an action for approval and is NOT run here; the permission mode decides whether to ask.
 */
function acDemoReply(text: string, files: File[], context: string[], { settings, mode }: ComposerSendMeta): string | ComposerReply {
  const about = context[0] || files[0]?.name || 'that', more = context.length + files.length - 1
  const reply = `Looking at ${about}${more > 0 ? ` and ${more} more` : ''}. ${/fast|priority/i.test(settings.speed) ? 'Quick take:' : 'Here’s what I found:'} the key points are clear and I’ve drafted next steps below.`
  const email = /send|email|remind/i.test(text), act = AI_DEMO_RISKY.test(text)
  if (!act || mode.id === 'yolo' || (mode.id === 'approve' && !email)) return reply // routine (or YOLO): no card
  return { text: reply, needsApproval: email
    ? { tool: 'gmail.send', summary: 'Send “Invoice #1042 is overdue” to the Northwind billing contacts', recipients: ['ap@northwind.example', 'sam.lee@northwind.example'],
        args: { subject: 'Invoice #1042 is overdue', attachments: files.map(f => f.name).join(', ') || 'none' } }
    : { tool: 'linear.createIssue', summary: `Create an issue: “${text.length > 60 ? text.slice(0, 57) + '…' : text}”`, args: { team: 'Launch', priority: 'High' } } }
}
/** The demo host: pretends to run an approved action; on deny it runs nothing, so it confirms that. */
const acDemoApprove = async (_action: ComposerAction, approved: boolean) => { await sleep(approved ? 700 : 150); return true }

const PERM_RECIPIENTS = ['Alex Lee', 'Ben Kim', 'Cara Mills']
const PERM_DRAFT = { subject: 'Launch moved to Thursday', body: 'Hi all, quick heads up: we’re moving the launch from Tuesday to Thursday so legal can finish the terms review. Nothing else changes. Thanks for your patience.' }
/** PermissionRequest wired to a pretend mail host: progress is simulated here, not in the component. */
function PermissionDemo() {
  const [progress, setProgress] = useState<{ sent: number; total: number }>()
  const [got, setGot] = useState<string | null>(null)
  const onDecide = async (allowed: boolean, _always: boolean, draft: { subject: string; body: string }) => {
    setGot(allowed ? draft.subject : null); if (!allowed) return
    for (let i = 0; i <= 12; i++) { setProgress({ sent: i, total: 12 }); await sleep(110 + Math.random() * 90) }
  }
  return <>
    <PermissionRequest title="Send an email to 12 people" reason="You asked to “let the launch list know about the delay”. Sending email is never automatic." recipients={PERM_RECIPIENTS} total={12} list="Launch list"
      draft={PERM_DRAFT} progress={progress} onDecide={onDecide} onUndo={async () => { await sleep(500); return true }} />
    {got && <span className="text-xs text-[var(--fg3)]">The host received the subject “{got}”</span>}
  </>
}

/** Clicks a control inside a demo once, right after mount, so the card opens mid-flow (an answered question, a finished
 * run) instead of empty. Runs before the card is on screen, so the growth it causes never shifts what you're reading. */
const AI_PLAN = ['Read the brief', 'Search 12 sources', 'Compare findings', 'Write summary']
/** Agent plan that opens mid-run (two steps done, the third working) and finishes once it is on screen; Replay restarts it. */
function AiPlanDemo({ run }: { run: number }) {
  const [cur, setCur] = useState(2)
  const { ref, visible } = useViewport<HTMLDivElement>(null, { amount: 0.5 })
  useEffect(() => { if (run) setCur(0) }, [run])
  useEffect(() => {
    if (!visible || cur >= AI_PLAN.length) return
    const t = setTimeout(() => setCur(c => c + 1), 1400 + (cur % 2) * 500)
    return () => clearTimeout(t)
  }, [visible, cur])
  const steps = AI_PLAN.map((label, i) => ({ label, status: (i < cur ? 'done' : i === cur ? 'active' : 'pending') as StepStatus }))
  return (
    <div ref={ref} className="flex flex-col gap-2">
      <AgentPlan steps={steps} />
      <span className="text-xs text-[var(--fg3)]" aria-live="polite">{cur >= AI_PLAN.length ? 'Done · summary ready' : `Step ${cur + 1} of ${AI_PLAN.length}: ${AI_PLAN[cur].toLowerCase()}…`}</span>
    </div>
  )
}

/* Live chat: a local fake model behind the same `send` interface a real one uses (no network, no keys) ─────────── */

/** Waits `ms`, or rejects as soon as the request is aborted (Stop, Regenerate, unmount). */
const liveWait = (ms: number, signal: AbortSignal) => new Promise<void>((res, rej) => {
  if (signal.aborted) { rej(new DOMException('Aborted', 'AbortError')); return }
  const t = setTimeout(res, ms)
  signal.addEventListener('abort', () => { clearTimeout(t); rej(new DOMException('Aborted', 'AbortError')) }, { once: true })
})
/** Streams `text` in uneven 2–9 character pieces, like tokens arriving. */
async function* liveType(text: string, signal: AbortSignal, kind: 'text-delta' | 'reasoning-delta' = 'text-delta'): AsyncGenerator<AiChunk> {
  for (let i = 0; i < text.length;) { const n = 2 + Math.floor(Math.random() * 8); await liveWait(kind === 'text-delta' ? 28 : 18, signal); yield { type: kind, delta: text.slice(i, i + n) }; i += n }
}
const LIVE_SUGGESTIONS = ['Plan our launch week', 'Book a design review with Sam', 'Explain the retry policy', 'Simulate an error']
const LIVE_MODELS = [{ value: 'fast', label: 'Fast model' }, { value: 'deep', label: 'Deep model' }]
const LIVE_PLAN = `## Launch week plan

Here’s a plan that keeps the **Thursday** date and leaves a buffer for legal [1]:

1. **Mon:** freeze scope, cut the release branch \`release/0.3\`
2. **Tue:** final QA on Safari payments (the open bug) [2]
3. **Wed:** legal sign-off, then schedule the announcement
4. **Thu:** ship at 10:00, watch error rates for two hours

| Owner | Deliverable | Status |
| --- | --- | --- |
| Priya | Notes | Draft |
| Sam | Images | Wed |

See the [launch checklist](https://notes.example.com/launch) for the full list.`
const LIVE_RETRY = `Retries use **exponential backoff with jitter**: wait \`base × 2^attempt\`, randomised by ±50%, and give up after three tries.

\`\`\`js
const wait = base * 2 ** attempt * (0.5 + Math.random())
\`\`\`

Errors below 500 are never retried, because a 4xx won’t succeed on a second attempt [1].`

/**
 * The demo's model: reasoning, then Markdown text with citations and sources, or a tool call that needs approval, or
 * an error part, depending on the question. It honours `signal`, so Stop and Regenerate cancel it mid-stream.
 */
async function* liveModel(messages: AiMessage[], { signal }: { signal: AbortSignal }): AsyncGenerator<AiChunk> {
  const last = messages[messages.length - 1]
  await liveWait(350, signal)
  if (last?.role === 'assistant') { // continuing after an approval decision
    const tool = last.parts.find((p): p is AiToolPart => p.type === 'tool')
    yield* liveType(tool?.approval?.approved
      ? `Done: **Design review** is booked for Thursday 14:00–14:30 and the invite went to Sam. Event id \`${String((tool.result as { id?: string } | undefined)?.id ?? 'evt')}\`.`
      : 'Okay, I didn’t book anything. Want me to suggest a different time instead?', signal)
    yield { type: 'finish' }; return
  }
  const q = aiMessageText(last ?? { id: '', role: 'user', parts: [] }).toLowerCase()
  yield { type: 'start' }
  if (/error|fail/.test(q)) { yield* liveType('Looking that up', signal); await liveWait(500, signal); throw new Error('The model provider returned 429 (rate limited). Nothing was lost; try again.') }
  const book = /book|review|meet|calendar/.test(q), retry = /retry|backoff/.test(q)
  yield* liveType(book ? 'The person wants a 30-minute review with Sam this week. Thursday afternoon is free on both calendars. Creating an event changes their calendar, so ask first.'
    : retry ? 'They want the retry rules in plain words. Summarise the backoff, show the formula, and say which errors are not retried.'
    : 'Launch is Thursday. Legal review is the critical path and the Safari bug is still open, so put QA before sign-off and keep a day of buffer.', signal, 'reasoning-delta')
  yield { type: 'reasoning-end' }
  if (book) {
    yield* liveType('Thursday 14:00 works for both of you. I’ll create the event once you approve:', signal)
    yield { type: 'tool-start', id: 'call_cal_1', name: 'calendar.createEvent' }
    const args = JSON.stringify({ title: 'Design review', with: ['sam@quill.example'], start: '2026-11-12T14:00', minutes: 30 })
    for (let i = 0; i < args.length; i += 12) { await liveWait(30, signal); yield { type: 'tool-args-delta', id: 'call_cal_1', delta: args.slice(i, i + 12) } }
    yield { type: 'tool-approval', id: 'call_cal_1', summary: 'Create “Design review” on Thu 12 Nov, 14:00–14:30, and invite sam@quill.example' }
    yield { type: 'finish' }; return
  }
  if (retry) yield { type: 'source', url: 'https://docs.example.com/retries', title: 'Retry policy', snippet: 'Backoff with jitter; 4xx responses are final.' }
  else {
    yield { type: 'source', url: 'https://notes.example.com/legal', title: 'Legal review status', snippet: 'Terms review due Wednesday EOD.' }
    yield { type: 'source', url: 'https://issues.example.com/ENG-812', title: 'ENG-812 · Safari payment bug', snippet: 'Checkout times out on retry in Safari 17.' }
  }
  yield* liveType(retry ? LIVE_RETRY : LIVE_PLAN, signal)
  yield { type: 'finish' }
}
/** The demo host runs the approved tool (pretend), then returns its result. Denied: nothing runs. */
const liveRunTool = async (tool: AiToolPart, approved: boolean) => { if (!approved) return undefined; await sleep(600); return { id: 'evt_7f3a', calendar: 'Work', created: true, tool: tool.name } }
/** 200 older messages (100 exchanges) for the virtualisation demo; batch `n` gets its own ids. */
const liveHistory = (n: number): AiMessage[] => Array.from({ length: 200 }, (_, i) => {
  const k = 200 - i
  return i % 2 === 0
    ? { id: `old-${n}-${i}`, role: 'user', status: 'done', parts: [{ type: 'text', text: `Earlier question #${n}.${k / 2 | 0}: how did week ${(k % 12) + 1} go?` }] }
    : { id: `old-${n}-${i}`, role: 'assistant', status: 'done', parts: [{ type: 'text', text: i % 6 === 1 ? `Week ${(k % 12) + 1}: **${(k * 7) % 40 + 10} tickets** closed, two incidents, and the migration moved to staging.\n\n- Payments: stable\n- Search: p95 down 18%` : `All on track. Nothing needs your attention this week.` }] }
})
const LIVE_INITIAL: AiMessage[] = [
  { id: 'live-u1', role: 'user', status: 'done', parts: [{ type: 'text', text: 'What changed in 0.3?' }] },
  { id: 'live-a1', role: 'assistant', status: 'done', parts: [
    { type: 'source', url: 'https://github.com/lantos1618/oneshot-ui', title: 'Release notes' },
    { type: 'text', text: 'Real streams: every AI component now takes **live model output** as message parts (text, reasoning, tools, sources, files) [1]. Pick a suggestion below to watch one stream.' }] },
]

/** Live chat wired to the fake model through useAiChat: Conversation + Message + MessageActions + Suggestions + PromptInput. */
function LiveChatDemo({ older }: { older: number }) {
  const [model, setModel] = useState('fast')
  const chat = useAiChat({ send: liveModel, initialMessages: LIVE_INITIAL, onApprovalRequest: liveRunTool })
  const { setMessages } = chat
  useEffect(() => { // "Load 200 older": prepends history, so the log virtualises (and keeps your place if you scrolled up)
    if (!older) return
    setMessages(ms => [...liveHistory(older), ...ms])
  }, [older, setMessages])
  const lastA = chat.messages.reduce((k, m, i) => m.role === 'assistant' ? i : k, -1)
  return (
    <div className="flex min-w-0 flex-col gap-2.5">
      <Conversation busy={chat.busy} className="h-[min(400px,58dvh)]">
        {chat.messages.map((m, i) => (
          <Message key={m.id} message={m} renderers={AI_RICH_RENDERERS} onDecideTool={chat.decideTool} onRetry={chat.regenerate}
            actions={m.role === 'assistant' && <MessageActions text={() => aiMessageText(m)} stopped={m.stopped} disabled={chat.busy}
              onRetry={i === lastA ? chat.regenerate : undefined} retryLabel={m.stopped || m.status === 'error' ? 'Retry' : 'Regenerate'} />} />
        ))}
      </Conversation>
      <div className="-mx-1 overflow-x-auto px-1 pb-0.5 [scrollbar-width:none]"><Suggestions items={LIVE_SUGGESTIONS} onPick={q => chat.submit(q)} disabled={chat.busy} className="!flex-nowrap [&>button]:flex-none" /></div>
      <PromptInput value={chat.input} onChange={chat.setInput} status={chat.status} onStop={chat.stop} onSubmit={(t, f) => chat.submit(t, f)} placeholder="Message the demo model (it runs in your browser)"
        models={LIVE_MODELS} model={model} onModelChange={setModel} accept="image/*,.pdf,.txt,.md" maxFiles={4} />
    </div>
  )
}

/** The tallest a panel has been for this source and view, so a replay that starts from one row doesn't pull the page up. */
function useLiveRunHeight(key: string) {
  const ref = useRef<HTMLDivElement>(null), seen = useRef(new Map<string, number>())
  const [h, setH] = useState(0)
  useLayoutEffect(() => {
    const el = ref.current
    setH(seen.current.get(key) ?? 0)
    if (!el || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(() => { const v = Math.max(seen.current.get(key) ?? 0, el.offsetHeight); if (v !== seen.current.get(key)) { seen.current.set(key, v); setH(v) } })
    ro.observe(el)
    return () => ro.disconnect()
  }, [key])
  return { ref, minHeight: h || undefined }
}

const LIVE_RUN_SPEED = 2
/** AICanvas on the scripted demo model (one per mount, so its suggestions start over). */
function CanvasDemo() {
  const props = useMemo(() => canvasDemoProps(), [])
  return <AICanvas {...props} />
}

/** One run model, three recorded sources, three views; Replay as stream feeds the run back through useAgentRun. */
function LiveAgentRunDemo() {
  const [srcKey, setSrcKey] = useState<AgentRunFixture['key']>('otel')
  const [view, setView] = useState<AgentRunViewMode>('waterfall')
  const [replay, setReplay] = useState(0)
  const fixture = AGENT_RUN_FIXTURES.find(f => f.key === srcKey) ?? AGENT_RUN_FIXTURES[0]
  const recorded = useMemo(() => fixture.run(), [fixture])
  const source = useMemo<AgentRunSource>(() => replay ? (signal: AbortSignal) => replayRun(recorded, { speed: LIVE_RUN_SPEED, signal }) : recorded, [recorded, replay])
  const { run, status } = useAgentRun(source)
  const shown = run ?? recorded
  const streaming = status === 'live' || status === 'connecting'
  const panel = useLiveRunHeight(`${srcKey}:${view}`)
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <SegmentedControl aria-label="Source" size="sm" value={srcKey} onChange={v => { setSrcKey(v as AgentRunFixture['key']); setReplay(0) }}
          options={AGENT_RUN_FIXTURES.map(f => ({ value: f.key, label: f.label }))} />
        <span className="flex-1" />
        <span className="text-xs text-[var(--fg3)]" aria-live="polite">{streaming ? `Streaming at ${LIVE_RUN_SPEED}×…` : replay ? 'Replayed' : 'Recorded'}</span>
        <Button size="sm" onClick={() => setReplay(n => n + 1)}><Icon name="play" size={12} filled />Replay as stream</Button>
      </div>
      <div ref={panel.ref} style={{ minHeight: panel.minHeight }}>
        <AgentRunView run={shown} mode={view} onModeChange={setView} subtitle={fixture.label} />
      </div>
    </div>
  )
}

export function AISection() {
  const [replay, setReplay] = useState(0)
  const [planRun, setPlanRun] = useState(0)
  const [older, setOlder] = useState(0)
  const toast = useToast()
  return (
    <Section id="ai" title="AI" desc="Streaming, showing work, asking permission, and being honest about uncertainty.">
      <Spec title="Live chat (real stream)" actions={<SpecAction onClick={() => setOlder(n => n + 1)}>Load 200 older</SpecAction>} desc="useAiChat over a local fake model that streams the same chunks a real one sends: reasoning, Markdown with citations and sources, a tool call that waits for your approval, and errors with Retry. Stop cancels the request through its AbortSignal; scroll up while it streams and it stops following. “Load 200 older” prepends history: past 60 messages the log renders only what is in view." span={3}>
        <LiveChatDemo older={older} />
      </Spec>
      <Spec title="Chat" desc="Answers compose the library’s own components: charts, tables, code blocks, sources, checklists and approval cards. Type / for commands." span={3}>
        <AssistantChat defaultTurns={['Chart MRR this year']} starters={STARTERS} commands={COMMANDS} respond={respond} />
      </Spec>
      <Spec title="Chat composer" desc="A composer that doubles as a control panel: attach (+, drag, paste), add context from the workspace, pick a permission mode, configure the model, toggle connectors. Keep typing while it works and follow-ups queue. The first send glides it into the conversation." span={3}>
        <AgentComposer onSend={acDemoReply} onApprovalRequest={acDemoApprove} items={AC_ITEMS} doc={AC_DOC} connectors={AC_CONNECTORS} models={AI_DEMO_MODELS} samples={AC_SAMPLES} hint="Try: “Summarise the invoice and draft a reminder”"
          onAddConnector={() => toast({ title: 'Connector directory', description: 'This would open the MCP / connector directory' })} />
      </Spec>
      <Spec title="Thinking steps" desc="Vertical stepper for reasoning. Click a finished step to read its detail." actions={<SpecAction onClick={() => setReplay(r => r + 1)}>Replay</SpecAction>}>
        <ThinkingSteps autoPlay replayKey={replay} steps={THOUGHTS} />
      </Spec>
      <Spec title="Agent plan" desc="Plan first, then live progress" actions={<SpecAction onClick={() => setPlanRun(r => r + 1)}>Replay</SpecAction>}>
        <AiPlanDemo run={planRun} />
      </Spec>
      <Spec title="Citations" desc="Hover or tap a number">
        <p className="m-0 text-[13px] leading-loose">Most users finish onboarding in under 3 minutes<Citation n={1} source={SRC[0]} />, though mobile is 40% slower<Citation n={2} source={SRC[1]} />.
          Teams that invite a colleague on day one keep using the product twice as often<Citation n={3} source={SRC[2]} />, so the invite step stays in the flow.</p>
        <ol className="m-0 mt-auto flex list-none flex-col gap-1 border-t border-[var(--line)] p-0 pt-2.5 text-xs text-[var(--fg3)]">
          {SRC.map((x, i) => <li key={x.title} className="flex gap-1.5"><span className="ui-num w-3 flex-none text-[var(--fg2)]">{i + 1}</span><span className="truncate">{x.title} · {sourceDomain(x)}</span></li>)}
        </ol>
      </Spec>
      <Spec title="Permission request" desc="Say what, to whom, and why. Then show the outcome." span={2}>
        <PermissionDemo />
      </Spec>
      <Spec title="Ghost text" desc="Type “Thanks”, press Tab or tap the suggestion" keys={[[['Tab'], 'Accept'], [['Esc'], 'Dismiss']]}>
        <GhostTextInput placeholder="Write a message" defaultValue="Thanks" suggestions={['Thanks for the quick turnaround!', 'Thanks, I’ll take a look today.', 'Let’s sync tomorrow at 10.', 'Looks great, ship it.']} />
      </Spec>
      <Spec title="Suggested edit" desc="Diff with accept and reject" span={2}>
        <SuggestedEdit action="Make it concise" before="I just wanted to quickly reach out to let you know that the meeting will probably have to be moved a little bit later." onRequest={async () => { await sleep(800); return 'The meeting is moving to 3 pm.' }} />
      </Spec>
      <Spec title="Confidence flags" desc="Only uncertain fields marked">
        <div className="flex flex-col">
          <ConfidenceField label="Name" value="Alex Lee" confidence={0.98} />
          <ConfidenceField label="Company" value="Northwind" confidence={0.95} />
          <ConfidenceField label="Phone" value="+41 44 123 45 67" confidence={0.48} prompt="Check" options={['+41 44 123 45 67', '+41 44 123 45 61']} />
          <ConfidenceField label="Date" value="7 Nov 2026" confidence={0.54} prompt="7 or 1 Nov?" options={['7 Nov 2026', '1 Nov 2026']} />
        </div>
      </Spec>
      <Spec title="Voice input" desc="Live waveform while listening">
        <VoiceInput transcript="Move the meeting to three" />
      </Spec>
      <Spec title="Sources panel" desc="Citations in the answer link to source cards. Hover either side, or tap a citation to open its source." span={2}>
        <SourcesPanel answer="A 20% yearly discount sits right at the market norm [1] and pays for itself through lower churn: annual customers churn far less than monthly ones [2]. In your own data, yearly Pro customers stay almost three years on average [3], so the discount is recovered within the first few months."
          sources={[
            { title: 'Pricing benchmarks 2026', domain: 'saasreport.example', letter: 'B', color: 'var(--accent)', snippet: 'Median yearly discount across 300 SaaS companies is 17%, with 20% the most common single value.' },
            { title: 'How annual plans reduce churn', domain: 'growthnotes.example', letter: 'G', color: 'var(--ok)', snippet: 'Customers on annual plans churned 3.4× less than monthly customers over 24 months.' },
            { title: 'Your billing data, Q3', domain: 'Internal · Postgres', letter: 'N', color: 'var(--warn)', snippet: '38% of Pro customers already pay yearly; their average lifetime is 31 months.' },
          ]} />
      </Spec>
      <Spec title="Model comparison" desc="Same prompt, three models, streamed side by side with latency, speed and cost. Vote for the best." span={3}>
        <ModelComparison autoRun onVote={async () => { await sleep(300); return true }} prompt="Summarise why our yearly plan should be 20% cheaper, in two sentences." models={[
          { name: 'Fast', tier: 'Speed tier', color: 'var(--c4)', firstToken: 0.2, speed: 22, tps: 210, cost: '$0.0004', text: 'A 20% yearly discount matches what most SaaS companies offer. It is worth it because yearly customers churn much less, so you earn the discount back quickly.' },
          { name: 'Balanced', tier: 'Default tier', color: 'var(--accent)', firstToken: 0.5, speed: 12, tps: 96, cost: '$0.002', text: 'Twenty percent off yearly is the market norm, so it won’t look unusual. Because annual customers churn about 3× less and your yearly users stay ~31 months, the discount pays for itself within the first quarter.' },
          { name: 'Deep', tier: 'Reasoning tier', color: 'var(--c3)', firstToken: 1.4, speed: 7, tps: 44, cost: '$0.011', text: 'Price the yearly plan at €19/month (20% off). It aligns with the median benchmark, and with annual churn 3.4× lower and a 31-month average lifetime in your data, expected revenue per customer rises roughly 40% despite the discount.' },
        ]} />
      </Spec>
      <Spec title="AI canvas" desc="Chat on the left, a living document on the right (stacked on phones). Edits stream in with changes highlighted. Click or tap a code line to ask about it." span={3}>
        <CanvasDemo />
      </Spec>
      <Spec title="Agent transit map" desc="A live state machine. The Indexing loop and the Intake endpoint fire events into a queue, and jobs start as slots free up. Endpoints emit follow-up triggers: Deploy starts a smoke test, Ledger starts an audit, and a failed smoke test starts a regression fix. Human and Risk stations wait for your approval (human in the loop). Hover or tap a trace row to follow a job." span={3}>
        <TransitSimMap machines={AGENT_WORKFLOWS} order={AGENT_WORKFLOW_ORDER} />
      </Spec>
      <Spec title="Live agent run" desc="One run model (AgentRun) from three real sources: an OpenTelemetry GenAI trace export (OTLP/JSON), a Vercel AI SDK generateText result and LangGraph astream_events. Pick a source and a view: the waterfall, the transit map or lanes. “Replay as stream” feeds the recorded run back through useAgentRun at 2×, so every view grows live as spans start and end." span={3}
        notes={{ good: 'Showing a real run from the tracing or SDK you already have, without glue code; watching a run live; comparing the same run as a timeline, a map and a step graph.', breaks: 'AI SDK results carry no per-tool timings (they are inferred; pass stepEnds or use its telemetry spans); LangGraph events have no times unless your server stamps them; the transit map has fixed lines, so a run with many tools piles onto a few stations.' }}>
        <LiveAgentRunDemo />
      </Spec>
    </Section>
  )
}
