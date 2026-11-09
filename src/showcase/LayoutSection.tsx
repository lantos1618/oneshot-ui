import { Fragment, useMemo, useState, type ReactNode } from 'react'
import { Kanban, type KanbanColumn, OrgChart, type OrgNode, highlightCode, Scheduler, type SchedulerEvent, SortableList, SplitPane, Timeline, type TimelineItem, type TreeNode, TreeView, useToast } from '../lib'
import { Section, Spec, SpecAction } from './kit'

const LAYOUT_PEOPLE: Record<string, string> = { AL: 'Alex Lee', BK: 'Bea Kim', CM: 'Chris Moe', DN: 'Dana Ng', EP: 'Eli Park' }
const lp = (...k: string[]) => k.map(x => LAYOUT_PEOPLE[x])

const LAYOUT_BOARD: KanbanColumn[] = [
  { id: 'backlog', title: 'Backlog', color: 'var(--fg3)', cards: [
    { id: 'k1', tag: { label: 'Research', tone: 'ok' }, title: 'Interview five enterprise customers', assignees: lp('AL'), priority: 'High', due: 'Nov 12',
      checklist: [{ text: 'Draft script', done: true }, { text: 'Book calls', done: true }, { text: 'Run 5 interviews', done: false }, { text: 'Synthesis doc', done: false }] },
    { id: 'k2', tag: { label: 'Design', tone: 'warn' }, title: 'Empty states for reports', assignees: lp('BK'), priority: 'Low', due: 'Nov 14', cover: ['var(--c3)', 'var(--warn)'] },
    { id: 'k3', tag: { label: 'Docs', tone: 'neutral' }, title: 'Write API pagination guide', assignees: lp('DN'), priority: 'Med', due: 'Nov 18', blocked: '#471 cursor API' },
  ] },
  { id: 'doing', title: 'In progress', color: 'var(--accent)', limit: 3, cards: [
    { id: 'k4', tag: { label: 'Eng', tone: 'accent' }, title: 'Migrate auth to passkeys', assignees: lp('CM', 'DN', 'AL'), priority: 'High', due: 'Nov 9', comments: 6, attachments: 2,
      pr: { number: '#482', checks: [{ name: 'Build', status: 'ok' }, { name: 'Tests', status: 'ok' }, { name: 'E2E', status: 'running' }] } },
    { id: 'k5', tag: { label: 'Perf', tone: 'warn' }, title: 'Cut dashboard p95 latency', assignees: lp('EP'), priority: 'Med', due: 'Nov 10',
      metric: { label: 'p95', value: '182 ms', delta: -12, lowerIsBetter: true, trend: [260, 248, 251, 230, 222, 210, 205, 196, 190, 182] } },
  ] },
  { id: 'review', title: 'Review', color: 'var(--warn)', cards: [
    { id: 'k6', tag: { label: 'Bug', tone: 'bad' }, title: 'Fix CSV export encoding', assignees: lp('EP', 'BK'), priority: 'High', due: 'Nov 8', comments: 3, attachments: 1,
      pr: { number: '#479', checks: [{ name: 'Build', status: 'ok' }, { name: 'Tests', status: 'bad' }] } },
    { id: 'k7', tag: { label: 'Eng', tone: 'accent' }, title: 'Rate limiter for webhooks', assignees: lp('DN'), priority: 'Med', due: 'Nov 11' },
  ] },
  { id: 'done', title: 'Done', color: 'var(--ok)', cards: [
    { id: 'k8', tag: { label: 'Design', tone: 'warn' }, title: 'Dark mode tokens', assignees: lp('AL', 'BK', 'CM', 'DN'), priority: 'Low', due: 'Nov 3', cover: ['var(--primary)', 'var(--accent)'], comments: 12, attachments: 4 },
  ] },
]

const LAYOUT_TREE = [{ id: 'my-app', label: 'my-app', children: [
  { id: 'src', label: 'src', children: [
    { id: 'components', label: 'components', children: [{ id: 'btn', label: 'Button.tsx', size: '2.1 KB' }, { id: 'dlg', label: 'Dialog.tsx', size: '4.8 KB' }, { id: 'tbl', label: 'Table.tsx', size: '7.3 KB' }] },
    { id: 'hooks', label: 'hooks', children: [{ id: 'flow', label: 'useFlow.ts', size: '1.2 KB' }, { id: 'theme', label: 'useTheme.ts', size: '0.9 KB' }] },
    { id: 'main', label: 'main.tsx', size: '0.6 KB' }, { id: 'css', label: 'styles.css', size: '3.4 KB' }] },
  { id: 'public', label: 'public', children: [{ id: 'fav', label: 'favicon.svg', size: '1.1 KB' }, { id: 'og', label: 'og.png', size: '84 KB' }] },
  { id: 'pkg', label: 'package.json', size: '1.4 KB' }, { id: 'readme', label: 'README.md', size: '2.2 KB' }] }]

const LAYOUT_TIMELINE: TimelineItem[] = [
  { id: 't1', day: 'Today', kind: 'deploy', title: <><b>v2.4.0</b> deployed to production</>, time: '10 min ago' },
  { id: 't2', day: 'Today', kind: 'comment', title: <><b>Bea Kim</b> commented on <b>Pricing page v2</b></>, time: '42 min ago', quote: '“Can we try the yearly toggle above the cards?”' },
  { id: 't3', day: 'Today', kind: 'commit', title: <><b>Chris Moe</b> pushed 3 commits to <b>auth-passkeys</b></>, time: '2 h ago' },
  { id: 't4', day: 'Yesterday', kind: 'file', title: <><b>Dana Ng</b> uploaded a file</>, time: 'Yesterday, 16:20', attachment: { name: 'Q4-roadmap.pdf', size: '2.4 MB' } },
  { id: 't5', day: 'Yesterday', kind: 'alert', title: <>Error rate above 2% on <b>/api/export</b></>, time: 'Yesterday, 09:05' },
]
const LAYOUT_POOL: Pick<TimelineItem, 'kind' | 'title'>[] = [
  { kind: 'commit', title: <><b>Alex Lee</b> merged <b>#482 Dark mode tokens</b></> },
  { kind: 'deploy', title: <>Preview deployed for <b>pricing-v2</b></> },
  { kind: 'comment', title: <><b>Eli Park</b> replied in <b>#design</b></> },
]

/** The demo week plus a seeded year of meetings, relative to this week so the views are never empty. */
function layoutEvents(): SchedulerEvent[] {
  const now = new Date(), wk0 = new Date(now.getFullYear(), now.getMonth(), now.getDate() - ((now.getDay() + 6) % 7))
  const day = (base: Date, n: number) => new Date(base.getFullYear(), base.getMonth(), base.getDate() + n)
  let seq = 0
  const ev: SchedulerEvent[] = ([
    [0, 9, 1, 'Standup', 'var(--accent)', ['AL', 'BK', 'CM', 'DN']], [0, 13, 1.5, 'Design review', 'var(--c3)', ['BK', 'CM']], [1, 10, 2, 'Customer interviews', 'var(--c4)', ['AL', 'EP', 'DN']],
    [2, 9.5, 0.75, '1:1 with Bea', 'var(--fg2)', ['BK']], [2, 14, 1, 'Sprint planning', 'var(--accent)', ['AL', 'BK', 'CM', 'DN', 'EP']], [3, 11, 1.25, 'Pricing workshop', 'var(--c3)', ['CM', 'EP']],
    [4, 15, 1, 'Demo day', 'var(--ok)', ['AL', 'DN', 'EP', 'BK']], [5, 10, 1.5, 'Hike', 'var(--c4)', ['AL', 'CM']],
  ] as const).map(([d, s, du, t, c, who]) => ({ id: `e${seq++}`, date: day(wk0, d), start: s, duration: du, title: t, color: c, attendees: lp(...who) }))
  let r = 7; const R = () => (r = (r * 9301 + 49297) % 233280) / 233280
  const TPL = [['Standup', 'var(--accent)', 9, 0.5], ['Design review', 'var(--c3)', 13, 1.5], ['Customer call', 'var(--c4)', 11, 1], ['1:1', 'var(--fg2)', 15, 0.5], ['Planning', 'var(--accent)', 14, 1], ['Investor update', 'var(--ok)', 16, 1], ['Workshop', 'var(--c3)', 10, 2]] as const
  for (let w = -45; w <= 8; w++) {
    if (w === 0) continue
    const base = day(wk0, w * 7), n = 2 + Math.floor(R() * 4)
    for (let i = 0; i < n; i++) {
      const [t, c, s, du] = TPL[Math.floor(R() * TPL.length)]
      ev.push({ id: `e${seq++}`, date: day(base, Math.floor(R() * 5)), start: s, duration: du, title: t, color: c, attendees: Object.keys(LAYOUT_PEOPLE).filter(() => R() < 0.4).slice(0, 4).map(k => LAYOUT_PEOPLE[k]) })
    }
  }
  return ev
}

const LAYOUT_ORG: OrgNode = { id: 'ceo', name: 'Alex Lee', role: 'CEO', children: [
  { id: 'vpd', name: 'Bea Kim', role: 'VP Design', children: [{ id: 'pd', name: 'Chris Moe', role: 'Product designer' }, { id: 'bd', name: 'Eli Park', role: 'Brand designer' }] },
  { id: 'vpe', name: 'Dana Ng', role: 'VP Engineering', children: [
    { id: 'staff', name: 'Chris Moe', role: 'Staff engineer', children: [{ id: 'e1', name: 'Eli Park', role: 'Engineer' }, { id: 'e2', name: 'Bea Kim', role: 'Engineer' }] },
    { id: 'plat', name: 'Alex Lee', role: 'Platform lead' }] },
  { id: 'vps', name: 'Eli Park', role: 'VP Sales', children: [{ id: 'ae', name: 'Dana Ng', role: 'Account exec' }, { id: 'se', name: 'Chris Moe', role: 'Solutions eng.' }] },
] }

const LAYOUT_EDITOR = ['import { useFlow } from "./hooks";', '', 'export function App() {', '  const flow = useFlow("csv-import");', '  return <Dashboard flow={flow} />;', '}']

const LAYOUT_EXPLORER: TreeNode[] = [
  { id: 'src', label: 'src', children: [
    { id: 'components', label: 'components', children: [{ id: 'button', label: 'Button.tsx' }, { id: 'dialog', label: 'Dialog.tsx' }] },
    { id: 'main', label: 'main.tsx' },
  ] },
  { id: 'public', label: 'public', children: [{ id: 'favicon', label: 'favicon.svg' }] },
  { id: 'pkg', label: 'package.json' },
]

function LayoutPane({ title, children, plain }: { title: string; children: ReactNode; plain?: boolean }) {
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-8 flex-none items-center border-b border-[var(--line)] bg-[color-mix(in_srgb,var(--muted)_40%,var(--card))] px-3 text-[11px] font-semibold tracking-[.05em] whitespace-nowrap text-[var(--fg3)] uppercase">{title}</div>
      <div className={plain ? 'min-h-0 flex-1 overflow-auto p-1.5' : 'min-h-0 flex-1 overflow-auto px-3 py-2.5 font-[family-name:var(--mono)] text-xs leading-[1.7] whitespace-pre text-[var(--fg2)]'}>{children}</div>
    </div>
  )
}

/* Tree view · 10k nodes: a generated monorepo (25 packages × 8 folders × 50 files) */
const LAYOUT_PKGS = ['auth', 'billing', 'search', 'analytics', 'editor', 'checkout', 'catalog', 'inbox', 'calendar', 'files', 'teams', 'settings', 'reports',
  'notifications', 'onboarding', 'payments', 'pricing', 'profile', 'admin', 'audit', 'chat', 'docs', 'exports', 'imports', 'webhooks']
const LAYOUT_DIRS = ['components', 'hooks', 'utils', 'api', 'types', 'styles', 'tests', 'fixtures']
const LAYOUT_WORDS = ['Button', 'Panel', 'Table', 'List', 'Header', 'Footer', 'Modal', 'Form', 'Field', 'Card', 'Badge', 'Menu', 'Tabs', 'Toolbar', 'Chart', 'Filter', 'Row', 'Cell', 'Item', 'View']
const LAYOUT_EXT: Record<string, string> = { components: 'tsx', hooks: 'ts', utils: 'ts', api: 'ts', types: 'ts', styles: 'css', tests: 'tsx', fixtures: 'json' }
function layoutBigTree(): TreeNode[] {
  let s0 = 42; const R = () => (s0 = (s0 * 9301 + 49297) % 233280) / 233280
  return [{ id: 'mono', label: 'monorepo', children: [{ id: 'packages', label: 'packages', children: LAYOUT_PKGS.map(pk => ({
    id: pk, label: pk, children: LAYOUT_DIRS.map(d => ({
      id: `${pk}/${d}`, label: d, children: Array.from({ length: 50 }, (_, i) => {
        const w = LAYOUT_WORDS[(i + pk.length) % 20], base = d === 'hooks' ? `use${w}${i}` : d === 'tests' ? `${w}${i}.test` : `${w}${i}`
        return { id: `${pk}/${d}/${i}`, label: `${base}.${LAYOUT_EXT[d]}`, size: `${(R() * 12 + 0.3).toFixed(1)} KB` }
      }),
    })),
  })) }, { id: 'readme', label: 'README.md', size: '4.2 KB' }, { id: 'pkgjson', label: 'package.json', size: '1.1 KB' }] }]
}
const layoutTreeCount = (ns: TreeNode[]): number => ns.reduce((s, n) => s + 1 + (n.children ? layoutTreeCount(n.children) : 0), 0)
const layoutFolders = (ns: TreeNode[]): string[] => ns.flatMap(n => n.children ? [n.id, ...layoutFolders(n.children)] : [])
function LayoutBigTree() {
  const toast = useToast()
  const nodes = useMemo(layoutBigTree, [])
  const [all, setAll] = useState(false)
  const total = useMemo(() => layoutTreeCount(nodes), [nodes])
  const folders = useMemo(() => layoutFolders(nodes), [nodes])
  return (
    <>
      <div className="flex flex-wrap items-center gap-2 text-xs text-[var(--fg3)]">
        <span className="ui-num">{total.toLocaleString('en-GB')} nodes · {folders.length} folders</span>
        <SpecAction onClick={() => setAll(a => !a)}>{all ? 'Collapse all' : 'Expand all'}</SpecAction>
      </div>
      <TreeView key={all ? 'all' : 'some'} nodes={nodes} height={340} defaultExpanded={all ? folders : ['mono', 'packages', 'auth', 'auth/components']} aria-label="Monorepo files"
        className="rounded-[var(--r-md)] border border-[var(--line)] p-1" onOpen={n => toast({ title: 'Opened', description: n.label })} />
    </>
  )
}

export function LayoutSection() {
  const toast = useToast()
  const [list, setList] = useState([
    { id: '1', t: 'Onboarding email', color: 'var(--accent)' }, { id: '2', t: 'Pricing experiment', color: 'var(--c3)' }, { id: '3', t: 'Referral program', color: 'var(--c4)' },
    { id: '4', t: 'Annual plan discount', color: 'var(--warn)' }, { id: '5', t: 'In-app tour', color: 'var(--fg3)' }, { id: '6', t: 'Win-back email', color: 'var(--ok)' },
    { id: '7', t: 'Pricing page FAQ', color: 'var(--c2)' },
  ])
  const [feed, setFeed] = useState(LAYOUT_TIMELINE)
  const [events] = useState(layoutEvents)
  const simulate = () => {
    const p = LAYOUT_POOL[Math.floor(Math.random() * LAYOUT_POOL.length)]
    setFeed(f => {
      const next = [{ ...p, id: `t${Date.now()}`, day: 'Today', time: 'Just now' }, ...f]
      const today = next.filter(x => x.day === 'Today')
      return today.length > 5 ? next.filter(x => x.id !== today[today.length - 1].id) : next
    })
  }
  return (
    <Section id="layout" title="Layout" desc="Boards, lists, trees and panes. Everything drags, reflows, and works with a keyboard.">
      <Spec title="Kanban board" desc="Drag cards between columns and drag a column header to reorder columns. On touch, press and hold a card to pick it up. In progress has a WIP limit of 3." span={3}
        keys={[[['Tab'], 'To a card’s ⠿ handle'], [['←', '↑', '↓', '→'], 'Between cards'], [['Alt', '←', '→'], 'Move the card'], [['Alt', '⇧', '←', '→'], 'Move its column']]}>
        <Kanban defaultValue={LAYOUT_BOARD} doneColumn="done" newCard={() => ({ tag: { label: 'Eng', tone: 'accent' }, assignees: ['Alex Lee'], priority: 'Med', due: 'Nov 20' })} />
      </Spec>
      <Spec title="Sortable list" desc="Drag the handle to reorder" keys={[[['Alt', '↑', '↓'], 'Move the focused row']]}>
        <SortableList items={list} onChange={setList} render={i => i.t} label="Growth experiments" />
      </Spec>
      <Spec title="Tree view" desc="Double-click a file to rename it" keys={[[['↑', '↓'], 'Move'], [['←', '→'], 'Fold'], [['↵'], 'Open'], [['F2'], 'Rename']]}>
        <TreeView nodes={LAYOUT_TREE} defaultExpanded={['my-app', 'src', 'components', 'hooks']} aria-label="Project files"
          onOpen={n => toast({ title: 'Opened', description: n.label })} onRename={(_, v, prev) => toast({ title: 'Renamed', description: `${prev} → ${v}` })} />
      </Spec>
      <Spec title="Tree view · 10k nodes" desc="Ten thousand files in a generated monorepo. Only the rows in view are rendered (flattened open folders), so Expand all stays instant; arrows, Page Up/Down and Home/End scroll the focused row into view."
        keys={[[['↑', '↓'], 'Move'], [['PgUp', 'PgDn'], 'Page'], [['Home', 'End'], 'First / last'], [['←', '→'], 'Fold']]}>
        <LayoutBigTree />
      </Spec>
      <Spec title="Activity timeline" desc="Grouped by day, new events slide in" actions={<SpecAction onClick={simulate}>Simulate event</SpecAction>}>
        <Timeline items={feed} />
      </Spec>
      <Spec title="Split panes" desc="Drag a divider to resize, double-click it to reset. Panes snap closed below their minimum." span={3}
        keys={[[['←', '→'], 'Nudge the focused divider'], [['⇧', '←', '→'], 'Big steps'], [['↵'], 'Reset']]}>
        <div className="overflow-hidden rounded-[var(--r-lg)] border border-[var(--line)] bg-[var(--card)]">
          <SplitPane className="h-[340px] max-sm:h-[560px]" defaultSize={26} min={14} label="Resize explorer"
            first={<LayoutPane title="Explorer" plain><TreeView compact nodes={LAYOUT_EXPLORER} defaultExpanded={['src', 'components']} aria-label="Explorer" /></LayoutPane>}
            second={
              <SplitPane direction="vertical" defaultSize={62} min={18} label="Resize terminal"
                first={<LayoutPane title="editor.ts">{LAYOUT_EDITOR.map((l, i) => <Fragment key={i}>{i > 0 && '\n'}{highlightCode(l, 'ts')}</Fragment>)}</LayoutPane>}
                second={<LayoutPane title="Terminal"><span className="text-[var(--ok)]">❯</span>{' npm run dev\n  Ready in 640 ms\n  Local: http://localhost:3000'}</LayoutPane>} />
            } />
        </div>
      </Spec>
      <Spec title="Calendar scheduler" desc="Day, week, month and year views. Drag on empty time to create, drag events to move or resize (15-minute snap), drag chips between days in month view, click any date to zoom in. Phones get a 3-day view and a swipeable week; press and hold to create or move." span={3}>

        <Scheduler defaultEvents={events} />
      </Spec>
      <Spec title="Org chart" desc="Hierarchy with collapsible branches. Click a node’s count to fold its team." span={3}>
        <OrgChart root={LAYOUT_ORG} defaultCollapsed={['staff']} />
      </Spec>
    </Section>
  )
}
