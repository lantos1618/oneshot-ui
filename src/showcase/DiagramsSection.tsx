import { useMemo } from 'react'
import { DataFlow, type DiagramState, type DiagramTransition, Gantt, type GanttPhase, Globe, type GlobeHub, type GlobeRoute, NetworkGraph, ProcessFlow, Sankey, StateDiagram, StateMachine, TraceWaterfall, type TraceSpan, type WorldMapData, WorldMap, useToast, useWorldMap } from '../lib'
import { AGENT_WORKFLOWS, AGENT_WORKFLOW_ORDER } from '../examples'
import { Section, Spec } from './kit'

/* Gantt: a six-week launch plan ─────────────────────────────────────────── */
const GANTT_PHASES: GanttPhase[] = [
  { id: 'disc', name: 'Discovery', tasks: [{ id: 'res', name: 'Research', start: 0, duration: 5, progress: 1, owner: 'AL', color: 'var(--c2)' }, { id: 'int', name: 'Interviews', start: 3, duration: 6, progress: 1, owner: 'BK', color: 'var(--c2)' }] },
  { id: 'des', name: 'Design', tasks: [{ id: 'wf', name: 'Wireframes', start: 9, duration: 5, progress: 1, owner: 'BK', color: 'var(--c3)' }, { id: 'vd', name: 'Visual design', start: 14, duration: 8, progress: 0.6, owner: 'CM', color: 'var(--c3)' }] },
  { id: 'bld', name: 'Build', tasks: [{ id: 'api', name: 'API', start: 15, duration: 13, progress: 0.35, owner: 'DN', color: 'var(--c4)' }, { id: 'fe', name: 'Frontend', start: 22, duration: 10, progress: 0.1, owner: 'EP', color: 'var(--c4)' }, { id: 'qa', name: 'QA', start: 32, duration: 5, progress: 0, owner: 'CM', color: 'var(--warn)' }] },
  { id: 'lch', name: 'Launch', tasks: [{ id: 'docs', name: 'Docs', start: 31, duration: 6, progress: 0, owner: 'AL', color: 'var(--fg2)' }, { id: 'go', name: 'Go live', start: 38, duration: 0, progress: 0, owner: 'EP', color: 'var(--c3)' }] },
]
const GANTT_DEPS: [string, string][] = [['res', 'wf'], ['int', 'wf'], ['wf', 'vd'], ['vd', 'fe'], ['api', 'qa'], ['fe', 'qa'], ['qa', 'go'], ['docs', 'go']]
const GANTT_PEOPLE = { AL: 'Alex Lee', BK: 'Bea Kim', CM: 'Chris Moe', DN: 'Dana Ng', EP: 'Eli Park' }

/* State diagram: subscription lifecycle (UML) ───────────────────────────── */
const SD_STATES: Record<string, DiagramState> = {
  init: { kind: 'initial', at: [36, 120] }, trial: { label: 'Trial', box: [70, 98, 110, 44] }, expired: { label: 'Expired', box: [70, 238, 110, 44] },
  active: { label: 'Active', composite: [258, 40, 384, 252] }, paying: { label: 'Paying', parent: 'active', box: [300, 90, 120, 44] }, pastdue: { label: 'Past due', parent: 'active', box: [300, 200, 120, 44] },
  paused: { label: 'Paused', box: [720, 60, 110, 44] }, cancelled: { label: 'Cancelled', box: [720, 200, 110, 44] }, end1: { kind: 'final', at: [775, 292] }, end2: { kind: 'final', at: [125, 318] },
}
const SD_TRANSITIONS: DiagramTransition[] = [
  { event: 'signup', from: 'init', to: 'trial', d: 'M43,120 L68,120', label: [28, 98, 'signup', 'start'] },
  { event: 'add card', from: 'trial', to: 'paying', action: 'charge', d: 'M180,112 C230,112 260,112 298,112', label: [238, 102, 'add card / charge'] },
  { event: 'trial ends', from: 'trial', to: 'expired', guard: 'no card', d: 'M150,142 L150,236', label: [157, 192, 'trial ends [no card]', 'start'] },
  { event: 'extend', from: 'expired', to: 'trial', d: 'M100,238 L100,144', label: [93, 192, 'extend', 'end'] },
  { event: 'archive', from: 'expired', to: 'end2', d: 'M125,282 L125,306', label: [133, 297, 'archive', 'start'], weight: 0.4 },
  { event: 'renew', from: 'paying', to: 'paying', action: 'charge', d: 'M420,100 C468,70 468,154 420,124', label: [470, 112, 'renew / charge', 'start'], weight: 1.5 },
  { event: 'payment fails', from: 'paying', to: 'pastdue', action: 'email', d: 'M335,134 L335,198', label: [341, 160, 'payment fails / email', 'start'] },
  { event: 'payment succeeds', from: 'pastdue', to: 'paying', d: 'M395,200 L395,136', label: [401, 184, 'payment succeeds', 'start'] },
  { event: '3rd failure', from: 'pastdue', to: 'cancelled', guard: 'retries = 3', action: 'cancel', d: 'M420,222 C540,222 640,222 718,222', label: [570, 212, '3rd failure [retries = 3] / cancel'], weight: 0.4 },
  { event: 'pause', from: 'active', to: 'paused', d: 'M642,82 L718,82', label: [680, 72, 'pause'] },
  { event: 'cancel', from: 'active', to: 'cancelled', action: 'refund', d: 'M642,160 C690,160 720,170 760,198', label: [692, 150, 'cancel / refund', 'start'], weight: 0.4 },
  { event: 'resume', from: 'paused', to: 'H', d: 'M830,82 C925,82 925,326 600,326 C400,326 300,322 289,273', label: [600, 318, 'resume (back to where you paused)'] },
  { event: 'after 30 days', from: 'cancelled', to: 'end1', d: 'M775,244 L775,280', label: [783, 266, '30 days', 'start'], weight: 0.4 },
]
const SD_HISTORY = { of: 'active', at: [282, 262] as [number, number], default: 'paying', d: 'M288,253 C300,210 300,150 300,136' }

/* State machine: the agent workflows are AGENT_WORKFLOWS from the examples (the transit map in the AI section runs the same ones) */

/* Trace: an agent run ───────────────────────────────────────────────────── */
const TRACE: TraceSpan[] = ([
  ['orc', null, 'Orchestrator', 'Opus 5.5', 'agent', 'asterisk', 0, 22, 0.22, 0],
  ['plan', 'orc', 'Plan the launch', 'Opus 5.5', 'llm', 'asterisk', 0.9, 6.9, 0.12, 18400],
  ['res', 'orc', 'Researcher', 'Sonnet 5.5', 'agent', 'bot', 8, 14, 0.01, 0],
  ['ws1', 'res', 'web_search', 'Linear pricing', 'tool', 'search', 8.9, 5.4, 0.005, 900],
  ['ws2', 'res', 'web_search', 'Notion pricing', 'tool', 'search', 9.2, 7.2, 0.005, 1100],
  ['ws2r', 'res', 'web_search', 'Notion pricing · retry', 'tool', 'search', 12.1, 4.2, 0.005, 1100],
  ['q', 'res', 'Query plan usage', 'Postgres', 'tool', 'database', 9.7, 3.5, 0, 0],
  ['g2', 'res', 'Read G2 reviews', '128 pages', 'tool', 'globe', 14.7, 7.3, 0, 0],
  ['wr', 'orc', 'Writer', 'Sonnet 5.5', 'agent', 'bot', 11, 11, 0.04, 0],
  ['bv', 'wr', 'Read brand voice', 'Docs', 'tool', 'fileText', 11.6, 3.6, 0, 0],
  ['pf2', 'wr', 'Read pricing frames', 'Design file', 'tool', 'layout', 11.9, 5.1, 0, 0],
  ['dc', 'wr', 'Draft plan copy', 'Sonnet 5.5', 'llm', 'asterisk', 17.7, 4.3, 0.04, 7800],
  ['cd', 'orc', 'Coder', 'GPT-6 Sol', 'agent', 'code', 15.3, 6.7, 0.06, 0],
  ['br', 'cd', 'Create branch', 'Git', 'tool', 'branch', 15.9, 2.1, 0, 0],
  ['wp', 'cd', 'Write pricing page', 'GPT-6 Sol', 'llm', 'code', 18.3, 3.7, 0.06, 6000],
] as const).map(([id, parent, name, meta, kind, icon, start, duration, cost, tokens]) => ({ id, parent, name, meta, kind, icon, start, duration, cost, tokens }))

/* Map: seeded demo metrics per country ──────────────────────────────────── */
const MAP_KEY: Record<string, number> = { 'United States of America': 98, 'United Kingdom': 88, Germany: 84, Switzerland: 80, France: 74, Canada: 70, Netherlands: 68, Australia: 66, Japan: 62, Sweden: 58, Spain: 52, Italy: 50, Ireland: 49, Singapore: 47, Brazil: 44, India: 42, 'South Korea': 40, Norway: 38, Denmark: 37, Austria: 36, Belgium: 35, Poland: 33, Mexico: 30, 'New Zealand': 29, Finland: 28, Portugal: 26, 'United Arab Emirates': 25, Israel: 24, China: 22, Nigeria: 18, 'South Africa': 20, Argentina: 17, Indonesia: 15, Turkey: 16, Chile: 14 }
/** The key markets right away; once the map's outlines have loaded (lazily), a seeded sprinkle of small ones too. */
const mapDemoData = (world: WorldMapData | null) => {
  const out: Record<string, Record<string, number> | null> = {}
  ;(world?.countries.map(c => c[1]) ?? Object.keys(MAP_KEY)).forEach(n => {
    // seeded per country, so a market's numbers are the same before and after the outlines arrive
    let sd = [...n].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 233280, 17)
    const R = () => (sd = (sd * 9301 + 49297) % 233280) / 233280
    const base = MAP_KEY[n] ?? (R() < 0.55 ? Math.round(R() * 12) : null)
    out[n] = base == null ? null : { users: base, rev: Math.max(1, Math.round(base * (0.6 + R() * 0.8))), growth: Math.round((MAP_KEY[n] ? 30 : 60) - base * 0.25 + R() * 25) }
  })
  return out
}
const MAP_METRICS = [
  { key: 'users', label: 'Users', format: (v: number) => `${(v * 1.3).toFixed(1)}k users`, short: (v: number) => `${(v * 1.3).toFixed(1)}k` },
  { key: 'rev', label: 'Revenue', format: (v: number) => `€${(v * 4.2).toFixed(0)}k` },
  { key: 'growth', label: 'Growth', format: (v: number) => `+${v}%` },
]
const MAP_HUBS: [string, number, number][] = [['London', 299.8, 52.4], ['Zürich', 312.7, 60.1], ['New York', 186.6, 72.9], ['San Francisco', 110.1, 78.5], ['Singapore', 473, 149], ['Sydney', 538.1, 217.2], ['Tokyo', 518.6, 82.5], ['São Paulo', 224.3, 197]]
const MAP_NAMES = { 'United States of America': 'United States', 'United Arab Emirates': 'UAE' }

/* Globe ─────────────────────────────────────────────────────────────────── */
const GLOBE_HUBS: GlobeHub[] = [['London', -0.1, 51.5], ['Zürich', 8.5, 47.4], ['New York', -74, 40.7], ['San Francisco', -122.4, 37.8], ['Singapore', 103.8, 1.35], ['Sydney', 151.2, -33.9], ['Tokyo', 139.7, 35.7], ['São Paulo', -46.6, -23.5], ['Dubai', 55.3, 25.2], ['Lagos', 3.4, 6.5]]
const GLOBE_ROUTES: GlobeRoute[] = ([[0, 2, 'var(--c2)', 72], [1, 4, 'var(--c3)', 164], [2, 3, 'var(--c4)', 61], [0, 8, 'var(--c3)', 108], [4, 5, 'var(--c2)', 93], [6, 3, 'var(--c4)', 118], [7, 0, 'var(--c2)', 187], [9, 1, 'var(--c3)', 96], [8, 6, 'var(--c4)', 131]] as const)
  .map(([from, to, color, ms]) => ({ from, to, color, ms }))

/* Network graph: services ───────────────────────────────────────────────── */
const NET_GROUPS: [string, string][] = [['Frontend', 'var(--c2)'], ['API', 'var(--c3)'], ['Data', 'var(--c4)'], ['Infra', 'var(--fg2)']]
const NET_NODES = ([['Web app', 0, 11], ['Mobile', 0, 9], ['Admin', 0, 7], ['Docs site', 0, 6], ['Gateway', 1, 13], ['Auth', 1, 10], ['Payments', 1, 10], ['Search', 1, 8], ['Notify', 1, 7], ['Postgres', 2, 12], ['Redis', 2, 8], ['Warehouse', 2, 9], ['Queue', 2, 8], ['CDN', 3, 9], ['Kubernetes', 3, 11], ['Monitoring', 3, 7], ['Secrets', 3, 6]] as const)
  .map(([label, group, size]) => ({ label, group, size }))
const NET_LINKS: [number, number][] = [[0, 4], [1, 4], [2, 4], [0, 13], [3, 13], [4, 5], [4, 6], [4, 7], [4, 8], [5, 9], [5, 10], [6, 9], [6, 12], [7, 11], [7, 10], [8, 12], [12, 11], [9, 11], [14, 4], [14, 9], [14, 10], [14, 15], [15, 4], [16, 5], [16, 6], [14, 16], [2, 5]]

/* Process flow: CSV import ──────────────────────────────────────────────── */
const PF_NODES = [
  { id: 'trig', x: 0, y: 150, icon: 'bolt' as const, color: 'var(--c3)', title: 'Trigger', desc: 'File uploaded', body: 'Watching /imports', foot: ['Event', 'webhook'] as [string, string] },
  { id: 'parse', x: 300, y: 150, icon: 'file' as const, color: 'var(--c2)', title: 'Parse CSV', desc: 'Read and type rows', body: '{n} rows parsed', foot: ['Step 2', '~0.8 s'] as [string, string] },
  { id: 'val', x: 600, y: 150, icon: 'shieldCheck' as const, color: 'var(--c2)', title: 'Validate', desc: 'Schema and business rules', body: '12 rules · required, ranges, dupes', foot: ['Step 3', '~1.1 s'] as [string, string] },
  { id: 'ok', x: 920, y: 20, icon: 'database' as const, color: 'var(--ok)', title: 'Import', desc: 'Write to database', body: '{n} records passed', foot: ['Success path', ''] as [string, string] },
  { id: 'bad', x: 920, y: 290, icon: 'alert' as const, color: 'var(--warn)', title: 'Review queue', desc: 'Hold for a human', body: '{n} records failed', foot: ['Error path', ''] as [string, string] },
  { id: 'done', x: 1240, y: 150, icon: 'plane' as const, color: 'var(--c4)', title: 'Notify', desc: 'Summary to Slack', body: 'Import report sent', foot: ['Final step', ''] as [string, string] },
]
const PF_EDGES = [{ from: 'trig', to: 'parse' }, { from: 'parse', to: 'val' }, { from: 'val', to: 'ok', label: '93.7%' }, { from: 'val', to: 'bad', alt: true, label: '6.3%' }, { from: 'ok', to: 'done' }, { from: 'bad', to: 'done', alt: true }]
const PF_STEPS = [
  { log: 'Triggered · orders-nov.csv', nodes: [{ id: 'trig', ms: 500 }] },
  { log: 'Parsing rows…', nodes: [{ id: 'parse', ms: 900, count: 1234 }] },
  { log: 'Validating 1,234 rows…', nodes: [{ id: 'val', ms: 1000 }] },
  { log: 'Importing and queueing…', nodes: [{ id: 'ok', ms: 1100, count: 1156 }, { id: 'bad', ms: 700, count: 78, tone: 'warn' as const }] },
  { log: 'Sending report…', nodes: [{ id: 'done', ms: 600 }] },
]

/* Data flow ─────────────────────────────────────────────────────────────── */
const DF_SOURCES = [{ label: 'Postgres', icon: 'database' as const, color: 'var(--c2)', rate: 120 }, { label: 'Stripe', icon: 'card' as const, color: 'var(--c3)', rate: 64 }, { label: 'S3 bucket', icon: 'cloud' as const, color: 'var(--c4)', rate: 90 }, { label: 'Webhooks', icon: 'webhook' as const, color: 'var(--fg2)', rate: 40 }, { label: 'Kafka', icon: 'stream' as const, color: 'var(--c2)', rate: 150 }]
const DF_TARGETS = [{ label: 'Warehouse', icon: 'warehouse' as const, color: 'var(--c2)', share: 0.45 }, { label: 'Dashboards', icon: 'chart' as const, color: 'var(--c4)', share: 0.3 }, { label: 'Alerts', icon: 'bell' as const, color: 'var(--warn)', share: 0.1 }, { label: 'Public API', icon: 'code' as const, color: 'var(--c3)', share: 0.15 }]

function DgWorldMapDemo(p: Omit<Parameters<typeof WorldMap>[0], 'data'>) {
  const world = useWorldMap()
  const data = useMemo(() => mapDemoData(world), [world])
  return <WorldMap data={data} {...p} />
}

export function DiagramsSection() {
  const toast = useToast()
  return (
    <Section id="diagrams" title="Diagrams & maps" desc="Plans, statecharts, traces, flows and maps. Drag, hover and fire events: everything is live and themed.">
      <Spec span={3} title="Gantt" desc="The plan: phases, progress, dependencies and milestones. Drag a bar to move it (on touch, hold it first), drag its right edge to change duration; dependants reschedule automatically.">
        <Gantt phases={GANTT_PHASES} dependencies={GANTT_DEPS} start={new Date(2026, 9, 19)} days={42} today={19} people={GANTT_PEOPLE} milestone="go" />
      </Spec>
      <Spec span={3} title="State diagram" desc="UML-style subscription lifecycle: a composite state, a history state (resume returns to where you paused), guards in [brackets], actions after the slash, a self-transition, initial and final states. Fire events to walk it.">
        <StateDiagram states={SD_STATES} transitions={SD_TRANSITIONS} initial="init" history={SD_HISTORY} />
      </Spec>
      <Spec span={3} title="State machine" desc="Statechart of the agent workflows, live. Lit states hold jobs right now, dots travel each transition as it happens, guards and fork / join are labelled.">
        <StateMachine machines={AGENT_WORKFLOWS} order={AGENT_WORKFLOW_ORDER} />
      </Spec>
      <Spec span={3} title="Trace waterfall" desc="What actually ran: nested spans on a shared timeline, streaming live. Works for API requests, jobs or agent runs.">
        <TraceWaterfall spans={TRACE} total={22} subtitle="Launch the new pricing page by Friday" failure={{ span: 'ws2', at: 2.6, message: '429 rate limited', retry: 'ws2r' }} />
      </Spec>
      <Spec title="Sankey" desc="Flows between stages. Hover or tap a ribbon or a node to isolate it.">
        <Sankey sources={[{ label: 'Organic', color: 'var(--c2)' }, { label: 'Paid', color: 'var(--c3)' }]} targets={[{ label: 'Signed up', color: 'var(--ok)' }, { label: 'Bounced', color: 'var(--fg3)' }, { label: 'Browsing', color: 'var(--warn)' }]}
          links={[[0, 0, 30], [0, 1, 18], [0, 2, 12], [1, 0, 15], [1, 1, 17], [1, 2, 8]]} height={300} />
      </Spec>
      <Spec span={2} title="Network graph" desc="Force layout. Drag nodes, hover or tap one to see its connections.">
        <NetworkGraph nodes={NET_NODES} links={NET_LINKS} groups={NET_GROUPS} />
      </Spec>
      <Spec span={3} title="Process flow" desc="Workflow canvas. Run it to watch each step execute. Drag nodes, drag the canvas to pan, Ctrl/⌘ + scroll or pinch to zoom.">
        <ProcessFlow nodes={PF_NODES} edges={PF_EDGES} steps={PF_STEPS} done={s => `Completed in ${s.toFixed(1)} s · 1,156 imported · 78 to review`}
          onComplete={() => toast({ title: 'Workflow complete', description: '1,156 imported, 78 need review', tone: 'ok' })} />
      </Spec>
      <Spec span={3} title="Data flow" desc="Sources stream into a processing engine and out to destinations. Hover or tap any node to trace its path.">
        <DataFlow sources={DF_SOURCES} targets={DF_TARGETS} />
      </Spec>
      <Spec span={3} title="Map" desc="Choropleth by country, hubs pulse. Hover or tap a country, or a row in the list.">
        <DgWorldMapDemo metrics={MAP_METRICS} hubs={MAP_HUBS} names={MAP_NAMES} />
      </Spec>
      <Spec span={3} title="Globe" desc="3D dot globe with live routes between hubs. Drag to spin (sideways on touch), it keeps its momentum.">
        <Globe hubs={GLOBE_HUBS} routes={GLOBE_ROUTES} />
      </Spec>
    </Section>
  )
}
