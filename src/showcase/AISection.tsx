import { useEffect, useState } from 'react'
import { AICanvas, AI_CANVAS_SAMPLE, AgentComposer, AgentPlan, AgentTransitMap, AssistantChat, Badge, Chart, ChatApproval, ChatCard, ChatChecklist, type ChatScript, ChatSources, Citation, CodeBlock, type ComposerModel,
  type ComposerAction, type ComposerReply, type ComposerSample, type ComposerSendMeta, ConfidenceField, type Connector, GhostTextInput, LOCALE, ModelComparison, PermissionRequest, type SlashCommand, type Source, SourcesPanel, SuggestedEdit, ThinkingSteps, VoiceInput,
  type StepStatus, type WorkspaceItem, sleep, useViewport } from '../lib'
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
      part: <ChatSources items={[{ name: 'Linear', desc: 'Weekly digest', color: '#5E6AD2' }, { name: 'Slack', desc: '#launch, 34 messages', color: '#16A34A' }, { name: 'Notion', desc: 'Launch checklist', color: '#71717A' }]} />,
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
      part: <ChatCard>
        <div className="-mx-1 overflow-x-auto px-1 [contain:inline-size]"><table className="w-full min-w-[300px] border-collapse text-xs">
          <thead><tr className="text-left text-[var(--fg3)]">{['Company', 'Plan', 'Status'].map(h => <th key={h} className="border-b border-[var(--line)] px-1.5 py-1 font-medium">{h}</th>)}<th className="border-b border-[var(--line)] px-1.5 py-1 text-right font-medium">MRR</th></tr></thead>
          <tbody>{TOP.map(([c, p, s, m]) => <tr key={c} className="[&:not(:last-child)>td]:border-b [&>td]:border-[var(--line)]"><td className="px-1.5 py-[7px]">{c}</td><td className="px-1.5">{p}</td><td className="px-1.5"><Badge tone={s === 'Active' ? 'ok' : 'accent'}>{s}</Badge></td><td className="ui-num px-1.5 text-right">€{m.toLocaleString(LOCALE)}</td></tr>)}</tbody>
        </table></div>
        <a href="#data" className="mt-2 inline-flex min-h-8 items-center text-xs text-[var(--accent)] no-underline">Open in data grid →</a>
      </ChatCard>,
      followUps: ['Chart MRR this year'] }
    case 'code': return { tool: ['Reading flow docs', 'Read flow docs', 'docs.search("retries backoff") → 3 pages'],
      versions: ['Here’s a retry wrapper with exponential backoff and jitter. It stops on 4xx errors, which won’t succeed on retry.'],
      part: <CodeBlock code={RETRY} filename="retry.js" className="max-w-[560px]" />, followUps: ['Summarise this week'] }
    default: return { tool: ['Searching workspace', 'Searched workspace', 'search(query) → 0 exact matches'],
      versions: ['I didn’t find anything specific for that. Try a starter, or type / to see what I can show you.'], followUps: ['Summarise this week', 'Chart MRR this year'] }
  }
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
  { name: 'Opus 5.5', vendor: 'Anthropic', speeds: ['Normal', 'Fast'], efforts: ['Low', 'Medium', 'High', 'Max'] },
  { name: 'Sonnet 5.5', vendor: 'Anthropic', speeds: ['Normal', 'Fast'], efforts: ['Low', 'Medium', 'High'] },
  { name: 'Haiku 5.5', vendor: 'Anthropic', speeds: ['Normal'], efforts: ['Low', 'Medium'] },
  { name: 'Reasoner R2', vendor: 'Provider B', speeds: ['Normal', 'Priority'], efforts: ['Minimal', 'Low', 'Medium', 'High', 'Ultra'] },
  { name: 'Open 70B', vendor: 'Fast host', speeds: ['Normal', 'Fast', 'Ultra fast'], efforts: ['Off', 'Low', 'High'] },
]
const AC_SAMPLES: ComposerSample[] = [{ title: 'Attach sample', desc: 'Adds a demo report.pdf', files: () => [new File([new Uint8Array(248000)], 'Q3 report.pdf', { type: 'application/pdf' })] }]
/**
 * The demo's "agent": a canned reply that mentions what was attached. Anything that would act (send, remind, create,
 * deploy…) comes back as an action for approval and is NOT run here; the permission mode decides whether to ask.
 */
function acDemoReply(text: string, files: File[], context: string[], { settings, mode }: ComposerSendMeta): string | ComposerReply {
  const about = context[0] || files[0]?.name || 'that', more = context.length + files.length - 1
  const reply = `Looking at ${about}${more > 0 ? ` and ${more} more` : ''}. ${/fast|priority/i.test(settings.speed) ? 'Quick take:' : 'Here’s what I found:'} the key points are clear and I’ve drafted next steps below.`
  const email = /send|email|remind/i.test(text), act = email || /create|open|post|deploy|delete/i.test(text)
  if (!act || mode.id === 'yolo' || (mode.id === 'approve' && !email)) return reply // routine (or YOLO): no card
  return { text: reply, needsApproval: email
    ? { tool: 'gmail.send', summary: 'Send “Invoice #1042 is overdue” to the Northwind billing contacts', recipients: ['ap@northwind.example', 'sam.lee@northwind.example'],
        args: { subject: 'Invoice #1042 is overdue', attachments: files.map(f => f.name).join(', ') || 'none' } }
    : { tool: 'linear.createIssue', summary: `Create an issue: “${text.length > 60 ? text.slice(0, 57) + '…' : text}”`, args: { team: 'Launch', priority: 'High' } } }
}
/** The demo host: pretends to run an approved action; on deny it runs nothing, so it confirms that. */
const acDemoApprove = async (_action: ComposerAction, approved: boolean) => { await sleep(approved ? 700 : 150); return true }

/** PermissionRequest wired to a pretend mail host: progress is simulated here, not in the component. */
function PermissionDemo() {
  const [progress, setProgress] = useState<{ sent: number; total: number }>()
  const [got, setGot] = useState<string | null>(null)
  const onDecide = async (allowed: boolean, _always: boolean, draft: { subject: string; body: string }) => {
    setGot(allowed ? draft.subject : null); if (!allowed) return
    for (let i = 0; i <= 12; i++) { setProgress({ sent: i, total: 12 }); await sleep(110 + Math.random() * 90) }
  }
  return <>
    <PermissionRequest reason="You asked to “let the launch list know about the delay”. Sending email is never automatic." progress={progress} onDecide={onDecide} onUndo={async () => { await sleep(500); return true }} />
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

export function AISection() {
  const [replay, setReplay] = useState(0)
  const [planRun, setPlanRun] = useState(0)
  return (
    <Section id="ai" title="AI" desc="Streaming, showing work, asking permission, and being honest about uncertainty.">
      <Spec title="Chat" desc="Answers compose the library’s own components: charts, tables, code blocks, sources, checklists and approval cards. Type / for commands." span={3}>
        <AssistantChat defaultTurns={['Chart MRR this year']} starters={STARTERS} commands={COMMANDS} respond={respond} />
      </Spec>
      <Spec title="Chat composer" desc="A composer that doubles as a control panel: attach (+, drag, paste), add context from the workspace, pick a permission mode, configure the model, toggle connectors. Keep typing while it works and follow-ups queue. The first send glides it into the conversation." span={3}>
        <AgentComposer onSend={acDemoReply} onApprovalRequest={acDemoApprove} items={AC_ITEMS} doc={AC_DOC} connectors={AC_CONNECTORS} models={AI_DEMO_MODELS} samples={AC_SAMPLES} hint="Try: “Summarise the invoice and draft a reminder”" />
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
          {SRC.map((x, i) => <li key={x.title} className="flex gap-1.5"><span className="ui-num w-3 flex-none text-[var(--fg2)]">{i + 1}</span><span className="truncate">{x.title} · {new URL(x.url).hostname}</span></li>)}
        </ol>
      </Spec>
      <Spec title="Permission request" desc="Say what, to whom, and why. Then show the outcome." span={2}>
        <PermissionDemo />
      </Spec>
      <Spec title="Ghost text" desc="Type “Thanks”, press Tab or tap the suggestion" keys={[[['Tab'], 'Accept'], [['Esc'], 'Dismiss']]}>
        <GhostTextInput placeholder="Write a message" defaultValue="Thanks" suggestions={['Thanks for the quick turnaround!', 'Thanks, I’ll take a look today.', 'Let’s sync tomorrow at 10.', 'Looks great, ship it.']} />
      </Spec>
      <Spec title="Suggested edit" desc="Diff with accept and reject" span={2}>
        <SuggestedEdit before="I just wanted to quickly reach out to let you know that the meeting will probably have to be moved a little bit later." after="The meeting is moving to 3 pm." />
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
        <ModelComparison autoRun prompt="Summarise why our yearly plan should be 20% cheaper, in two sentences." models={[
          { name: 'Fast', tier: 'Speed tier', color: 'var(--c4)', firstToken: 0.2, speed: 22, tps: 210, cost: '$0.0004', text: 'A 20% yearly discount matches what most SaaS companies offer. It is worth it because yearly customers churn much less, so you earn the discount back quickly.' },
          { name: 'Balanced', tier: 'Default tier', color: 'var(--accent)', firstToken: 0.5, speed: 12, tps: 96, cost: '$0.002', text: 'Twenty percent off yearly is the market norm, so it won’t look unusual. Because annual customers churn about 3× less and your yearly users stay ~31 months, the discount pays for itself within the first quarter.' },
          { name: 'Deep', tier: 'Reasoning tier', color: 'var(--c3)', firstToken: 1.4, speed: 7, tps: 44, cost: '$0.011', text: 'Price the yearly plan at €19/month (20% off). It aligns with the median benchmark, and with annual churn 3.4× lower and a 31-month average lifetime in your data, expected revenue per customer rises roughly 40% despite the discount.' },
        ]} />
      </Spec>
      <Spec title="AI canvas" desc="Chat on the left, a living document on the right (stacked on phones). Edits stream in with changes highlighted. Click or tap a code line to ask about it." span={3}>
        <AICanvas {...AI_CANVAS_SAMPLE} />
      </Spec>
      <Spec title="Agent transit map" desc="A live state machine. The Indexing loop and the Intake endpoint fire events into a queue, and jobs start as slots free up. Endpoints emit follow-up triggers: Deploy starts a smoke test, Ledger starts an audit, and a failed smoke test starts a regression fix. Human and Risk stations wait for your approval (human in the loop). Hover or tap a trace row to follow a job." span={3}>
        <AgentTransitMap />
      </Spec>
    </Section>
  )
}
