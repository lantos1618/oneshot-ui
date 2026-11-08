import { Fragment, useState, type ReactNode } from 'react'
import { Button, Kanban, type KanbanColumn, OrgChart, type OrgNode, highlightCode, Scheduler, type SchedulerEvent, SortableList, SplitPane, Timeline, type TimelineItem, TreeView, useToast } from '../lib'
import { Section, Spec } from './kit'

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

function LayoutPane({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-8 flex-none items-center border-b border-[var(--line)] bg-[color-mix(in_srgb,var(--muted)_40%,var(--card))] px-3 text-[11px] font-semibold tracking-[.05em] whitespace-nowrap text-[var(--fg3)] uppercase">{title}</div>
      <div className="min-h-0 flex-1 overflow-auto px-3 py-2.5 font-[family-name:var(--mono)] text-xs leading-[1.7] whitespace-pre text-[var(--fg2)]">{children}</div>
    </div>
  )
}

export function LayoutSection() {
  const toast = useToast()
  const [list, setList] = useState([
    { id: '1', t: 'Onboarding email', color: 'var(--accent)' }, { id: '2', t: 'Pricing experiment', color: 'var(--c3)' }, { id: '3', t: 'Referral program', color: 'var(--c4)' },
    { id: '4', t: 'Annual plan discount', color: 'var(--warn)' }, { id: '5', t: 'In-app tour', color: 'var(--fg3)' },
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
      <Spec title="Kanban board" desc="Drag cards between columns and drag a column header to reorder columns. Tab to a card’s ⠿ handle: arrows move between cards, Alt + arrows move the card, Alt + Shift + ← / → move its column. On touch, press and hold a card to pick it up. In progress has a WIP limit of 3." span={3}>
        <Kanban defaultValue={LAYOUT_BOARD} doneColumn="done" newCard={() => ({ tag: { label: 'Eng', tone: 'accent' }, assignees: ['Alex Lee'], priority: 'Med', due: 'Nov 20' })} />
      </Spec>
      <Spec title="Sortable list" desc="Drag the handle, or focus a row and use Alt + ↑ / ↓">
        <SortableList items={list} onChange={setList} render={i => i.t} label="Growth experiments" />
      </Spec>
      <Spec title="Tree view" desc="Arrow keys to move, Enter to open, F2 to rename a file or folder (or double-click a file)">
        <TreeView nodes={LAYOUT_TREE} defaultExpanded={['my-app', 'src', 'components']} aria-label="Project files"
          onOpen={n => toast({ title: 'Opened', description: n.label })} onRename={(_, v, prev) => toast({ title: 'Renamed', description: `${prev} → ${v}` })} />
      </Spec>
      <Spec title="Activity timeline" desc="Grouped by day, new events slide in">
        <Button size="sm" className="-mt-2 self-end [@media(pointer:coarse)]:!h-9" onClick={simulate}>Simulate</Button>
        <Timeline items={feed} />
      </Spec>
      <Spec title="Split panes" desc="Drag a divider to resize, double-click it (or focus it and press Enter) to reset. Arrow keys nudge, Shift + arrows take big steps. Panes snap closed below their minimum." span={3}>
        <div className="overflow-hidden rounded-[var(--r-lg)] border border-[var(--line)] bg-[var(--card)]">
          <SplitPane style={{ height: 340 }} defaultSize={26} min={14} label="Resize explorer"
            first={<LayoutPane title="Explorer">{'▾ src\n   ▾ components\n      Button.tsx\n      Dialog.tsx\n   main.tsx\n▸ public\n  package.json'}</LayoutPane>}
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
