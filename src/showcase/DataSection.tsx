import { useState } from 'react'
import { motion } from 'motion/react'
import { Accordion, Avatar, AvatarStack, Badge, DataGrid, DataTable, type GridColumn, Icon, InlineDatePicker, JsonViewer, Kbd, type ShortcutGroup, ShortcutOverlay, ShortcutSheet, StatCard, TaskList, type Tone, gridFilter, StatGrid, useToast } from '../lib'
import { Row, Section, Spec, SpecAction } from './kit'

type DataInvoice = { id: string; customer: string; status: string; amount: number }
const DATA_INVOICES: DataInvoice[] = [
  { id: '#1042', customer: 'Acme GmbH', status: 'Overdue', amount: 4280 }, { id: '#1043', customer: 'Northwind', status: 'Paid', amount: 1250 },
  { id: '#1044', customer: 'Globex', status: 'Pending', amount: 980 }, { id: '#1045', customer: 'Initech', status: 'Paid', amount: 3120 },
]
const DATA_STATUS_TONE: Record<string, Tone> = { Paid: 'ok', Pending: 'warn', Overdue: 'bad' }

/* Stat cards: seeded series, like the original page */
const DATA_KPIS: { label: string; value: number; format?: Intl.NumberFormatOptions; color: string; lowerIsBetter?: boolean }[] = [
  { label: 'Active users', value: 12480, color: 'var(--accent)' },
  { label: 'Conversion', value: 0.042, format: { style: 'percent', maximumFractionDigits: 1 }, color: 'var(--ok)' },
  { label: 'Revenue', value: 84200, format: { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }, color: 'var(--c3)' },
  { label: 'Churn', value: 0.018, format: { style: 'percent', maximumFractionDigits: 1 }, color: 'var(--bad)', lowerIsBetter: true },
]
function dataSeries() {
  let sd = 5; const R = () => (sd = (sd * 9301 + 49297) % 233280) / 233280
  return DATA_KPIS.map(k => { const a: number[] = []; let x = k.value * 0.82; for (let i = 0; i < 20; i++) { x *= 1 + (R() - 0.42) * 0.06; a.push(x) } a[19] = k.value; return a })
}

/* Data grid: 36 seeded customers */
type DataCustomer = { id: number; name: string; company: string; plan: string; status: string; country: string; mrr: number; seats: number; joined: Date }
const DATA_ST = ['Active', 'Trial', 'Churned', 'Paused'], DATA_PL = ['Free', 'Pro', 'Team', 'Enterprise']
const DATA_ST_TONE: Record<string, Tone> = { Active: 'ok', Trial: 'accent', Churned: 'bad', Paused: 'warn' }
const DATA_CUSTOMERS: DataCustomer[] = (() => {
  const NAMES = ['Alex Lee', 'Bea Kim', 'Chris Moe', 'Dana Ng', 'Eli Park', 'Fay Ito', 'Gus Roy', 'Hana Ali', 'Ivo Berg', 'Jo Marsh', 'Kai Sun', 'Lea Brun']
  const COS = ['Northwind', 'Quill Labs', 'Arcwise', 'Meridian', 'Helix Bio', 'Lumen', 'Vertex', 'Orbital'], CC = ['CH', 'GB', 'DE', 'US', 'FR', 'NL', 'SE', 'AU']
  let s0 = 11; const R = () => (s0 = (s0 * 9301 + 49297) % 233280) / 233280
  return Array.from({ length: 36 }, (_, i) => ({
    id: i + 1, name: NAMES[i % 12], company: COS[Math.floor(R() * 8)], plan: DATA_PL[Math.floor(R() * 4)], status: DATA_ST[Math.floor(R() * 4)],
    country: CC[Math.floor(R() * 8)], mrr: Math.round(R() * 4000 + 20), seats: Math.floor(R() * 80) + 1, joined: new Date(2025, Math.floor(R() * 22), Math.floor(R() * 27) + 1),
  }))
})()
const dataEur = (n: number) => '€' + n.toLocaleString('en-GB')
const DATA_GRID_COLS: GridColumn<DataCustomer>[] = [
  { key: 'name', label: 'Customer', width: 170 }, { key: 'company', label: 'Company', width: 140 },
  { key: 'plan', label: 'Plan', width: 110, options: DATA_PL },
  { key: 'status', label: 'Status', width: 110, options: DATA_ST, render: (r, c) => <Badge tone={DATA_ST_TONE[r.status]}>{c}</Badge> },
  { key: 'country', label: 'Country', width: 90 },
  { key: 'mrr', label: 'MRR', width: 100, type: 'number', text: r => dataEur(r.mrr) },
  { key: 'seats', label: 'Seats', width: 80, type: 'number' },
  { key: 'joined', label: 'Joined', width: 120, type: 'date' },
]

const DATA_JSON = {
  id: 'run_8f2k1', status: 'completed', ok: true, retries: 3, error: null, started_at: '2026-11-07T09:30:00Z', duration_ms: 4182,
  flow: { name: 'csv-import', version: 12, owner: { name: 'Alex Lee', team: 'Platform' } },
  steps: [{ name: 'parse', ms: 812, rows: 1234 }, { name: 'validate', ms: 1104, passed: 1156, failed: 78 }, { name: 'import', ms: 1980 }],
  tags: ['nightly', 'billing'],
}
const DATA_SHORTCUTS: ShortcutGroup[] = [
  { title: 'General', items: [['Command palette', ['⌘', 'K']], ['Toggle theme', ['⌘', '⇧', 'L']], ['Shortcuts', ['?']]] },
  { title: 'Navigation', items: [['Toggle sidebar', ['[']], ['Go to inbox', ['G', 'I']], ['Next item', ['J']], ['Previous item', ['K']]] },
  { title: 'Editing', items: [['Bold', ['⌘', 'B']], ['Undo', ['⌘', 'Z']], ['Save', ['⌘', 'S']]] },
]

export function DataSection() {
  const [series, setSeries] = useState(dataSeries)
  const [spin, setSpin] = useState(0)
  const [keys, setKeys] = useState(false)
  const toast = useToast()
  const today = new Date(); today.setHours(0, 0, 0, 0)
  const refresh = () => {
    setSeries(s => s.map(a => { const b = [...a]; for (let k = 0; k < 3; k++) { b.shift(); b.push(b[b.length - 1] * (1 + (Math.random() - 0.45) * 0.07)) } return b }))
    setSpin(n => n + 1)
  }
  return (
    <Section id="data" title="Data display" desc="When data changes, show the change: rows slide, numbers roll, panels grow.">
      <Spec title="Stat cards" desc="KPI tiles: number, change and a sparkline. Numbers roll on update; churn is better when it falls." span={2}
        actions={<SpecAction onClick={refresh} aria-label="Refresh data">
          <motion.span key={spin} className="grid" initial={{ rotate: 0 }} animate={{ rotate: spin ? 360 : 0 }} transition={{ duration: 0.5 }}><Icon name="refresh" size={12} /></motion.span>Refresh
        </SpecAction>}>
        <StatGrid>
          {DATA_KPIS.map((k, i) => {
            const a = series[i]
            return <StatCard key={k.label} label={k.label} value={a[a.length - 1]} format={k.format} trend={a} color={k.color} lowerIsBetter={k.lowerIsBetter} />
          })}
        </StatGrid>
      </Spec>
      <Spec title="Sortable table" desc="Click a header; rows slide. Click a row to open it." keys={[[['Tab'], 'To a row'], [['↵'], 'Open']]}>
        <DataTable rows={DATA_INVOICES} rowKey={r => r.id} onRowClick={r => toast({ title: `Invoice ${r.id}`, description: `${r.customer} · ${r.status}`, tone: 'info' })} columns={[
          { key: 'customer', label: 'Customer' },
          { key: 'status', label: 'Status', render: r => <Badge tone={DATA_STATUS_TONE[r.status]} dot>{r.status}</Badge> },
          { key: 'amount', label: 'Amount', align: 'right', render: r => `€${r.amount.toLocaleString('en-GB')}` },
        ]} />
      </Spec>
      <Spec title="Accordion" desc="Panels grow to fit">
        <Accordion defaultOpen={[0]} items={[
          { title: 'What is included?', content: 'All components, light and dark themes, and keyboard support.' },
          { title: 'Can I use it commercially?', content: 'Yes. Every library used here is MIT licensed.' },
          { title: 'Does it need a build step?', content: 'No. One file you drop into any React project.' },
          { title: 'How do I theme it?', content: 'Change the CSS variables, or pick a theme in the appearance menu.' },
        ]} />
      </Spec>
      <Spec title="Animated list" desc="Type and press Enter. Tick items off; ✕ removes them smoothly.">
        <TaskList defaultValue={[{ id: 'a', text: 'Review pull request' }, { id: 'b', text: 'Book design critique' }, { id: 'c', text: 'Send weekly update' }]} />
      </Spec>
      <Spec title="Avatars and presence" desc="Stack spreads on hover, focus or tap">
        <div className="flex flex-1 flex-col items-center justify-center gap-5">
          <AvatarStack names={['Alex Lee', 'Bea Kim', 'Chris Moe', 'Dana Ng', 'Eli Park', 'Fay Ito', 'Gus Roy', 'Hana Ali', 'Ivo Berg']} caption="9 people editing" />
          <Row><Avatar name="Alex Lee" status="online" /><Avatar name="Sam Park" status="away" /><Avatar name="Mia Chen" status="offline" /></Row>
        </div>
      </Spec>
      <Spec title="Data grid" desc="Filter as Bricks, Text or Scratch-style Blocks (all in sync), search every cell ripgrep-style, group rows with totals, sort, resize columns, shift-click row ranges, double-click a cell to edit (on touch: tap it, then tap again or its pencil)." span={3}
        keys={[[['Tab'], 'Into the cells'], [['←', '↑', '↓', '→'], 'Move'], [['↵'], 'Edit (or F2)'], [['Space'], 'Select row']]}>
        <DataGrid aria-label="Customers" columns={DATA_GRID_COLS} defaultRows={DATA_CUSTOMERS} rowKey={r => r.id} rowLabel={r => r.name}
          defaultFilter={gridFilter('AND', ['status', 'is', 'Active'], ['mrr', '>', '500'])} defaultSort={{ key: 'mrr', dir: -1 }}
          groupable={['status', 'plan', 'country', 'company']}
          groupSummary={rs => { const mrr = rs.reduce((s, r) => s + r.mrr, 0), seats = rs.reduce((s, r) => s + r.seats, 0); const b = 'font-[family-name:var(--mono)] font-semibold text-[var(--fg2)]'
            return <>MRR <b className={b}>{dataEur(mrr)}</b> · Seats <b className={b}>{seats}</b> · Avg <b className={b}>{dataEur(Math.round(mrr / rs.length))}</b></> }} />
      </Spec>
      <Spec title="Date picker" desc="Two modes: a single date, or a range. Type dd/mm/yyyy (slashes fill in) or pick on the calendar.">
        <InlineDatePicker defaultValue={[today, today]} />
      </Spec>
      <Spec title="JSON viewer" desc="Collapsible tree, typed colours. Filter keys; click a key to copy its path.">
        <JsonViewer data={DATA_JSON} />
      </Spec>
      <Spec title="Keyboard shortcuts" desc="Grouped sheet. The full sheet opens as an overlay." actions={<SpecAction onClick={() => setKeys(true)}>Open all <Kbd className="leading-none">?</Kbd></SpecAction>}>
        <ShortcutSheet groups={DATA_SHORTCUTS.slice(0, 2)} />
        <ShortcutOverlay open={keys} onOpenChange={setKeys} groups={DATA_SHORTCUTS} />
      </Spec>
    </Section>
  )
}
