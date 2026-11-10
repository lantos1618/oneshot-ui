import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { motion } from 'motion/react'
import { Accordion, Avatar, AvatarStack, Badge, DataGrid, DataTable, type GridColumn, type GridFilterNode, type GridGroup, type GridSelection, type GridSort, GRID_NO_SELECTION, gridSelectedCount, Icon, SegmentedControl, Switch, InlineDatePicker, JsonViewer, Kbd, type ShortcutGroup, ShortcutSheet, StatCard, TaskList, type Tone, gridFilter, StatGrid, useToast } from '../lib'
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
const DATA_EUR_FMT = new Intl.NumberFormat('en-GB')
const dataEur = (n: number) => '€' + DATA_EUR_FMT.format(n)
const DATA_GRID_COLS: GridColumn<DataCustomer>[] = [
  { key: 'name', label: 'Customer', width: 170 }, { key: 'company', label: 'Company', width: 140 },
  { key: 'plan', label: 'Plan', width: 110, options: DATA_PL },
  { key: 'status', label: 'Status', width: 110, options: DATA_ST, render: (r, c) => <Badge tone={DATA_ST_TONE[r.status]}>{c}</Badge> },
  { key: 'country', label: 'Country', width: 90 },
  { key: 'mrr', label: 'MRR', width: 100, type: 'number', text: r => dataEur(r.mrr) },
  { key: 'seats', label: 'Seats', width: 80, type: 'number' },
  { key: 'joined', label: 'Joined', width: 120, type: 'date' },
]

/* Data grid · 50k rows: generated deterministically (same rows on the server and every reload) */
const DATA_FIRST = ['Alex', 'Bea', 'Chris', 'Dana', 'Eli', 'Fay', 'Gus', 'Hana', 'Ivo', 'Jo', 'Kai', 'Lea', 'Mo', 'Nia', 'Oli', 'Pia', 'Quinn', 'Rae', 'Sam', 'Tia']
const DATA_LAST = ['Lee', 'Kim', 'Moe', 'Ng', 'Park', 'Ito', 'Roy', 'Ali', 'Berg', 'Marsh', 'Sun', 'Brun', 'Diaz', 'Okafor', 'Novak', 'Silva', 'Haas', 'Costa', 'Weber', 'Lund']
const DATA_COS = ['Northwind', 'Quill Labs', 'Arcwise', 'Meridian', 'Helix Bio', 'Lumen', 'Vertex', 'Orbital', 'Acme', 'Globex', 'Initech', 'Umbrella', 'Stark', 'Wayne', 'Tyrell', 'Cyberdyne']
const DATA_CC = ['CH', 'GB', 'DE', 'US', 'FR', 'NL', 'SE', 'AU', 'JP', 'CA', 'ES', 'IT']
function dataBigRows(n: number): DataCustomer[] {
  let s0 = 20251109 // mulberry32: integer maths only, so the sequence never degenerates
  const R = () => { s0 = (s0 + 0x6D2B79F5) | 0; let t = Math.imul(s0 ^ (s0 >>> 15), 1 | s0); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296 }
  const out: DataCustomer[] = new Array(n)
  for (let i = 0; i < n; i++) {
    out[i] = { id: i + 1, name: `${DATA_FIRST[Math.floor(R() * 20)]} ${DATA_LAST[Math.floor(R() * 20)]}`, company: DATA_COS[Math.floor(R() * 16)], plan: DATA_PL[Math.floor(R() * 4)],
      status: DATA_ST[Math.floor(R() * 4)], country: DATA_CC[Math.floor(R() * 12)], mrr: Math.round(R() * 9000 + 20), seats: Math.floor(R() * 400) + 1, joined: new Date(2020, Math.floor(R() * 70), Math.floor(R() * 27) + 1) }
  }
  return out
}
const DATA_BIG_COLS: GridColumn<DataCustomer>[] = [
  { key: 'id', label: 'ID', width: 84, type: 'number', text: r => `#${r.id}`, editable: false },
  ...DATA_GRID_COLS,
]

/* Data grid · server mode: a fake API with latency. Sort, filter, search and paging all round-trip through it. */
type DataSrvQuery = { sort: GridSort<DataCustomer> | null; filter: GridGroup; q: string; offset: number; limit: number }
const dataSrvText = (r: DataCustomer, k: keyof DataCustomer) => k === 'joined' ? r.joined.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : k === 'mrr' ? dataEur(r.mrr) : String(r[k])
function dataSrvTest(r: DataCustomer, n: GridFilterNode): boolean {
  if ('c' in n) return !n.c.length || (n.j === 'AND' ? n.c.every(x => dataSrvTest(r, x)) : n.c.some(x => dataSrvTest(r, x)))
  const [k, op, v] = n.f, key = k as keyof DataCustomer
  if (v === '' || !(key in r)) return true
  if (key === 'mrr' || key === 'seats' || key === 'id') { const x = Number(r[key]), y = Number(v); return Number.isNaN(y) || ({ '>': x > y, '<': x < y, '=': x === y, '≥': x >= y, '≤': x <= y } as Record<string, boolean>)[op] !== false }
  const a = dataSrvText(r, key).toLowerCase(), b = v.toLowerCase()
  return op === 'is' ? a === b : op === 'is not' ? a !== b : a.includes(b)
}
/** "GET /customers": filters, searches (plain substring, the server's own rules), sorts and slices after 250–650 ms. */
function dataSrvFetch(all: DataCustomer[], query: DataSrvQuery, signal: AbortSignal, fail: boolean): Promise<{ rows: DataCustomer[]; total: number }> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => {
      if (fail) return reject(new Error('503 Service Unavailable: the customers API timed out.'))
      const q = query.q.trim().toLowerCase()
      let rows = all.filter(r => dataSrvTest(r, query.filter) && (!q || DATA_BIG_COLS.some(c => dataSrvText(r, c.key).toLowerCase().includes(q))))
      if (query.sort) { const { key, dir } = query.sort; rows = rows.slice().sort((a, b) => (a[key] < b[key] ? -1 : a[key] > b[key] ? 1 : 0) * dir) }
      resolve({ rows: rows.slice(query.offset, query.offset + query.limit), total: rows.length })
    }, 250 + ((query.offset / 50 + query.q.length * 7) % 9) * 50)
    signal.addEventListener('abort', () => { clearTimeout(t); reject(new DOMException('Aborted', 'AbortError')) })
  })
}
function DataServerGrid() {
  const all = useMemo(() => dataBigRows(12_000), [])
  const [mode, setMode] = useState<'pages' | 'infinite'>('pages')
  const [sort, setSort] = useState<GridSort<DataCustomer> | null>({ key: 'mrr', dir: -1 })
  const [filter, setFilter] = useState<GridGroup>(() => ({ id: 'srv', j: 'AND', c: [] }))
  const [q, setQ] = useState('')
  const [page, setPage] = useState(0)
  const [pageSize, setPageSize] = useState(50)
  const [selection, setSelection] = useState<GridSelection>(GRID_NO_SELECTION)
  const [res, setRes] = useState<{ rows: DataCustomer[]; total: number }>({ rows: [], total: 0 })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [fail, setFail] = useState(false)
  const [trips, setTrips] = useState(0)
  const [retry, setRetry] = useState(0)
  const ctl = useRef<AbortController | null>(null)
  const failRef = useRef(fail); failRef.current = fail
  const load = useCallback((offset: number, limit: number, append: boolean) => {
    ctl.current?.abort()
    const c = new AbortController(); ctl.current = c
    setLoading(true); setError(null); setTrips(n => n + 1)
    dataSrvFetch(all, { sort, filter, q, offset, limit }, c.signal, failRef.current).then(
      r => { if (c.signal.aborted) return; setRes(prev => append ? { rows: [...prev.rows, ...r.rows], total: r.total } : r); setLoading(false) },
      e => { if (c.signal.aborted || (e as Error).name === 'AbortError') return; setError((e as Error).message); setLoading(false) })
  }, [all, sort, filter, q])
  // pages: every page is a request; infinite: the first 100 rows, then onLoadMore appends the next 100
  useEffect(() => { if (mode === 'pages') load(page * pageSize, pageSize, false); else load(0, 100, false) }, [load, mode, page, pageSize, retry])
  useEffect(() => () => ctl.current?.abort(), [])
  const selected = gridSelectedCount(selection, res.total)
  return (
    <>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-[var(--fg3)]">
        <SegmentedControl size="sm" aria-label="Loading mode" value={mode} onChange={m => { setMode(m as typeof mode); setPage(0) }} options={[{ value: 'pages', label: 'Pages' }, { value: 'infinite', label: 'Infinite scroll' }]} />
        <Switch label="Fail requests" checked={fail} onChange={setFail} />
        <span className="ui-num max-sm:basis-full" aria-live="polite">{trips} round trips · {res.total.toLocaleString('en-GB')} matching on the server{selection.mode === 'exclude' ? ` · selection: all except ${selection.keys.size} (${selected.toLocaleString('en-GB')})` : selected ? ` · ${selected} selected` : ''}</span>
      </div>
      <DataGrid aria-label="Customers (server)" server columns={DATA_BIG_COLS} rows={res.rows} rowKey={r => r.id} rowLabel={r => r.name} rowCount={res.total}
        sort={sort} onSortChange={setSort} filter={filter} onFilterChange={setFilter} onSearchChange={setQ}
        selection={selection} onSelectionChange={setSelection} loading={loading} error={error} onRetry={() => { setFail(false); failRef.current = false; setRetry(n => n + 1) }}
        defaultPinnedColumns={{ start: ['id'], end: ['status'] }} maxHeight={380}
        {...(mode === 'pages'
          ? { page, onPageChange: setPage, pageSize, pageSizes: [25, 50, 100], onPageSizeChange: setPageSize }
          : { onLoadMore: () => load(res.rows.length, 100, true), hasMore: res.rows.length < res.total })} />
    </>
  )
}
function DataBigGrid() {
  const rows = useMemo(() => dataBigRows(50_000), [])
  return (
    <DataGrid aria-label="Customers (50,000)" columns={DATA_BIG_COLS} defaultRows={rows} rowKey={r => r.id} rowLabel={r => r.name} maxHeight={440}
      defaultPinnedColumns={{ start: ['id', 'name'], end: ['mrr'] }} defaultHiddenColumns={['seats']} groupable={['status', 'plan', 'country']} />
  )
}

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
      <Spec title="Accordion · composable" desc="Built from parts: single choice that can close again (collapsible), a disabled item, and a panel kept mounted while closed (forceMount) so its switch keeps its state.">
        <Accordion.Root type="single" collapsible defaultValue="shipping">
          <Accordion.Item value="shipping">
            <Accordion.Trigger>Shipping</Accordion.Trigger>
            <Accordion.Content>Free over €50. Arrives in 2–4 working days across the EU.</Accordion.Content>
          </Accordion.Item>
          <Accordion.Item value="returns">
            <Accordion.Trigger>Returns</Accordion.Trigger>
            <Accordion.Content forceMount><span className="mb-2 block">30 days, no questions asked.</span><Switch label="Email me a return label" /></Accordion.Content>
          </Accordion.Item>
          <Accordion.Item value="warranty" disabled>
            <Accordion.Trigger>Warranty <Badge size="sm" className="ms-auto me-1">Soon</Badge></Accordion.Trigger>
            <Accordion.Content>Two years on every product.</Accordion.Content>
          </Accordion.Item>
        </Accordion.Root>
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
      <Spec title="Data grid · 50k rows" desc="Fifty thousand generated rows, virtualised: only the rows in view are in the DOM, so scrolling, sorting and filtering stay smooth. ID and Customer are pinned left and MRR right; Seats is hidden. Open Columns to show, hide, pin or reorder, or drag a header." span={3}
        keys={[[['Tab'], 'Into the cells'], [['PgUp', 'PgDn'], 'Page'], [['Ctrl', 'Home', 'End'], 'First / last row'], [['Ctrl', '⇧', '←', '→'], 'Move a column']]}>
        <DataBigGrid />
      </Spec>
      <Spec title="Data grid · server mode" desc="Sorting, the filter builder, search and paging all round-trip through a fake API (250–650 ms latency): the grid only emits what changed. Switch to infinite scroll, or make requests fail to see the error and Retry. Select a page, then “Select all” to select across every page." span={3}>
        <DataServerGrid />
      </Spec>
      <Spec title="Date picker" desc="Two modes: a single date, or a range. Type the date (in the locale’s order and digits) or pick on the calendar.">
        <InlineDatePicker defaultValue={[today, today]} />
      </Spec>
      <Spec title="JSON viewer" desc="Collapsible tree, typed colours. Filter keys; click a key to copy its path.">
        <JsonViewer data={DATA_JSON} />
      </Spec>
      <Spec title="Keyboard shortcuts" desc="Grouped sheet. The full sheet opens as an overlay." actions={<SpecAction onClick={() => setKeys(true)}>Open all <Kbd className="leading-none">?</Kbd></SpecAction>}>
        <ShortcutSheet groups={DATA_SHORTCUTS.slice(0, 2)} />
        <ShortcutSheet variant="dialog" open={keys} onOpenChange={setKeys} groups={DATA_SHORTCUTS} />
      </Spec>
    </Section>
  )
}
