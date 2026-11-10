import { createContext, useContext, useId, useLayoutEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent, type ReactNode } from 'react'
import { AnimatedNumber, type AsChildProps, Button, Chevron, DeltaBadge, Icon, IconButton, Kbd, TOUCH, cn, inputClass, spring, surface, useControllable, useHotkey, SparkChart, rowHoverClass, plural, writeClipboard, useRequiredContext, PartButton, useResizeObserver, type TableSort, ariaSort, collator, compareCells, idPart, nextSort, revealInScroller, uid } from './core'
import { PresenceList, shake, useFlip } from './motion'
import { Collapse, EmptyState, useToast } from './feedback'
import { CheckboxBox } from './fields'
import { Dialog } from './overlay'

/**
 * Responsive grid for StatCards, sized by its own width (container query), not the viewport: four tiles sit in
 * one row from ~600px, fall back to 2 × 2 below that and stack in one column under ~300px.
 */
export function StatGrid({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn('@container', className)}>
      <div className="grid grid-cols-1 gap-2.5 @[300px]:grid-cols-2 @[600px]:grid-cols-4">{children}</div>
    </div>
  )
}

/**
 * KPI tile: label, a ▲ / ▼ delta pill tinted by whether the change is good, a rolling value and an area
 * sparkline along the bottom. Set `lowerIsBetter` for metrics like churn, where a fall is good news.
 * Without `delta`, the change is computed from `trend` (last point vs `compareTo` points earlier). The label
 * wraps and the delta pill drops below it rather than clipping; the value shrinks in narrow tiles. Lay tiles out with StatGrid.
 */
export function StatCard({ label, value, format, delta, trend, lowerIsBetter, color = 'var(--accent)', compareTo = 7, deltaLabel, className }:
  { label: string; value: number; format?: Intl.NumberFormatOptions; /** percent change, e.g. 3.2 */ delta?: number; trend?: number[]
    lowerIsBetter?: boolean; color?: string; compareTo?: number; deltaLabel?: string; className?: string }) {
  // change from `compareTo` points back; no pill when that base is 0 (no meaningful percentage)
  const base = trend && trend.length > compareTo ? trend[trend.length - 1 - compareTo] : 0
  const d = delta ?? (trend && base ? ((trend[trend.length - 1] - base) / Math.abs(base)) * 100 : undefined)
  const spark = trend && trend.length > 1 ? trend : null
  return (
    <div className={cn(surface.md, '@container flex min-w-0 flex-col overflow-hidden px-3 pt-2.5', !spark && 'pb-3', className)}>
      <div className="flex flex-wrap items-center justify-between gap-x-1.5 gap-y-1">
        <span className="min-w-0 text-xs leading-tight [overflow-wrap:anywhere] text-[var(--fg3)]">{label}</span>
        {d !== undefined && <DeltaBadge value={d} lowerIsBetter={lowerIsBetter} title={deltaLabel} />}
      </div>
      <AnimatedNumber value={value} format={format} className="mt-1 font-[family-name:var(--font)] text-base leading-[1.2] font-semibold tracking-[-.02em] tabular-nums @[150px]:text-[22px]" />
      {spark && <SparkChart data={spark} variant="area" height={34} color={color} className="mt-1.5" />}
    </div>
  )
}

/** A DataTable column. `align` 'end' puts the cell at the end edge, for numbers; 'start' is the default. */
export type Column<T> = { key: keyof T & string; label: string; /** 'left' and 'right' are deprecated aliases of 'start' and 'end' */ align?: 'start' | 'end' | 'left' | 'right'; sortable?: boolean; render?: (row: T) => ReactNode; className?: string }
/** Sort state of a DataTable: the column key and 1 (ascending) or -1 (descending). */
export type DataSort<T> = TableSort<keyof T & string>

/**
 * A sortable column header's button: the label and an arrow that points up (ascending), turns down (descending) or
 * fades (`dir` undefined: not sorted by this column). Put it in a `<th aria-sort={ariaSort(sort, key)}>`; the click
 * usually sets `nextSort(sort, key)`. DataTable and DataGrid use it.
 */
export function SortHeader({ dir, onClick, children, className }: { dir: 1 | -1 | undefined; onClick: (e: ReactMouseEvent<HTMLButtonElement>) => void; children: ReactNode; className?: string }) {
  return (
    <button type="button" onClick={onClick}
      className={cn('inline-flex cursor-pointer items-center gap-1 border-0 bg-transparent p-0 font-[inherit] text-inherit hover:text-[var(--fg)]', TOUCH.tap36, className)}>
      {children}
      <Icon name="arrowUp" size={11} className={cn('flex-none transition-[transform,opacity] duration-200 motion-reduce:transition-none', dir === undefined && 'opacity-30', dir === -1 && 'rotate-180')} />
    </button>
  )
}

/**
 * Sortable table; rows slide to their new position when the order changes. A header click sorts ascending, then
 * descending, then back to the original order. Numbers and Dates sort by value, text naturally ("item 2" before
 * "item 10"), and empty cells last either way. Sort is uncontrolled (`initialSort`) or controlled (`sort` +
 * `onSortChange`). With `onRowClick` a click anywhere on a row opens it, and the first cell is a real button, so keyboard
 * users Tab to it and press Enter or Space. With no rows it shows `empty` (default "No rows"). Scrolls sideways inside
 * its box when too wide.
 */
export function DataTable<T extends object>({ columns, rows, rowKey, initialSort, sort: sortProp, onSortChange, onRowClick, empty, className }:
  { columns: Column<T>[]; rows: T[]; rowKey: (r: T) => string; initialSort?: DataSort<T>
    /** controlled sort; null = original order */ sort?: DataSort<T> | null; onSortChange?: (s: DataSort<T> | null) => void
    onRowClick?: (r: T) => void; /** shown in place of the rows when there are none (default "No rows") */ empty?: ReactNode; className?: string }) {
  const [sort, setSort] = useControllable<DataSort<T> | null>(sortProp, initialSort ?? null, onSortChange)
  const sorted = useMemo(() => {
    if (!sort) return rows
    const coll = collator()
    return [...rows].sort((a, b) => compareCells(a[sort.key], b[sort.key], sort.dir, coll))
  }, [rows, sort])
  const body = useRef<HTMLTableSectionElement>(null)
  useFlip(body, { transition: spring(0.15, 0.4) }) // rows slide to their place when the sort changes
  const end = (c: Column<T>) => c.align === 'right' || c.align === 'end'
  const cell = (r: T, c: Column<T>) => c.render ? c.render(r) : String(r[c.key] ?? '')
  return (
    <div className={cn('overflow-x-auto', className)}>
      <table className="w-full border-collapse text-[13px]">
        <thead>
          <tr>{columns.map(c => (
            <th key={c.key} aria-sort={ariaSort(sort, c.key)}
              className={cn('border-b border-[var(--line)] px-2 py-1.5 text-xs font-medium whitespace-nowrap text-[var(--fg3)] first:ps-0 last:pe-0', end(c) ? 'text-end' : 'text-start')}>
              {c.sortable === false ? c.label
                : <SortHeader dir={sort?.key === c.key ? sort.dir : undefined} onClick={() => setSort(nextSort(sort, c.key, { clearable: true }))}>{c.label}</SortHeader>}
            </th>
          ))}</tr>
        </thead>
        <tbody ref={body}>
          {!sorted.length && <tr><td colSpan={columns.length} className="border-b border-[var(--line)] p-0">{empty ?? <EmptyState size="sm" title="No rows" />}</td></tr>}
          {sorted.map(r => (
            <tr key={rowKey(r)} data-flip={rowKey(r)}
              // mouse and touch: the whole row; controls inside cells keep their own clicks
              onClick={onRowClick && (e => { if (!(e.target as Element).closest('button,a,input,select,textarea,label')) onRowClick(r) })}
              className={cn(onRowClick && 'cursor-pointer hover:bg-[var(--muted)] has-[[data-row-open]:focus-visible]:bg-[var(--muted)]')}>
              {columns.map((c, i) => (
                <td key={c.key} className={cn('border-b border-[var(--line)] px-2 py-2 first:ps-0 last:pe-0', end(c) && 'ui-num text-end', c.className)}>
                  {onRowClick && i === 0
                    ? <button data-row-open onClick={() => onRowClick(r)}
                      className="cursor-pointer rounded-[var(--r-sm)] border-0 bg-transparent p-0 text-start font-[inherit] text-inherit outline-none focus-visible:shadow-[0_0_0_2px_var(--accent)]">{cell(r, c)}</button>
                    : cell(r, c)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

type AccCtxV = { open: string[]; toggle: (v: string) => void; base: string; disabled?: boolean }
const AccCtx = createContext<AccCtxV | null>(null)
type AccItemCtxV = { value: string; on: boolean; disabled?: boolean; triggerId: string; panelId: string }
const AccItemCtx = createContext<AccItemCtxV | null>(null)
const useAccItem = (part: string) => useRequiredContext(AccItemCtx, `<Accordion.${part}>`, '<Accordion.Item>')

/** Props of Accordion.Root: `type="single"` (one open `value`, '' for none) or `"multiple"` (a list of open values). */
export type AccordionRootProps = { className?: string; children: ReactNode; disabled?: boolean } & (
  | { type?: 'single'; value?: string; defaultValue?: string; onValueChange?: (value: string) => void; /** the open item can be closed again (leaving none open) */ collapsible?: boolean }
  | { type: 'multiple'; value?: string[]; defaultValue?: string[]; onValueChange?: (value: string[]) => void; collapsible?: never })

/**
 * Accordion.Root: which items are open. `type="single"` (default) keeps at most one open, and with `collapsible` it can
 * be closed again; `type="multiple"` lets any number stay open. Controlled (`value` + `onValueChange`) or `defaultValue`.
 */
export function AccordionRoot(props: AccordionRootProps) {
  const multiple = props.type === 'multiple'
  const toList = (v: string | string[] | undefined) => v === undefined ? undefined : Array.isArray(v) ? v : v ? [v] : []
  const [open, setOpen] = useControllable<string[]>(toList(props.value), toList(props.defaultValue) ?? [],
    (v: string[]) => (props.onValueChange as ((x: string | string[]) => void) | undefined)?.(multiple ? v : v[0] ?? ''))
  const base = useId()
  const toggle = (v: string) => {
    if (open.includes(v)) { if (multiple || props.collapsible) setOpen(open.filter(x => x !== v)) }
    else setOpen(multiple ? [...open, v] : [v])
  }
  return <AccCtx.Provider value={{ open, toggle, base, disabled: props.disabled }}><div className={props.className}>{props.children}</div></AccCtx.Provider>
}
/** Accordion.Item: one section (`value`), with a rule under it. `disabled` locks it. */
export function AccordionItem({ value, disabled, className, children }: { value: string; disabled?: boolean; className?: string; children: ReactNode }) {
  const acc = useRequiredContext(AccCtx, '<Accordion.Item>', '<Accordion.Root>')
  const on = acc.open.includes(value), id = `${acc.base}-${idPart(value)}`
  return (
    <AccItemCtx.Provider value={{ value, on, disabled: disabled || acc.disabled, triggerId: `${id}-h`, panelId: `${id}-p` }}>
      <div data-state={on ? 'open' : 'closed'} className={cn('border-b border-[var(--line)]', className)}>{children}</div>
    </AccItemCtx.Provider>
  )
}
/** Accordion.Trigger: the row that opens and closes its item (aria-expanded, aria-controls); the chevron turns. `asChild` renders your element (no chevron). */
export function AccordionTrigger({ className, children, asChild }: { className?: string; children: ReactNode } & AsChildProps) {
  const acc = useContext(AccCtx), it = useAccItem('Trigger')
  const props = {
    id: it.triggerId, 'aria-expanded': it.on, 'aria-controls': it.panelId, 'data-state': it.on ? 'open' : 'closed',
    onClick: () => { if (!it.disabled) acc?.toggle(it.value) },
    className: cn('flex w-full cursor-pointer items-center justify-between gap-3 rounded-[var(--r-md)] border-0 bg-transparent px-1.5 py-3 text-start text-[13px] font-medium transition-colors disabled:cursor-default disabled:opacity-50 [@media(pointer:coarse)]:min-h-11 [@media(pointer:coarse)]:text-sm', rowHoverClass, className),
  }
  const chevron = <Chevron open={it.on} />
  return <PartButton asChild={asChild} disabled={it.disabled} after={chevron} {...props}>{children}</PartButton>
}
/**
 * Accordion.Content (role=region, labelled by its trigger): grows to its content height. Unmounted while closed, or with
 * `forceMount` kept in the DOM (collapsed and hidden), e.g. for in-page search or to keep form state.
 */
export function AccordionContent({ className, children, forceMount }: { className?: string; children: ReactNode; forceMount?: boolean }) {
  const it = useAccItem('Content')
  const panel = <div id={it.panelId} role="region" aria-labelledby={it.triggerId} className={cn('pb-3 text-[13px] text-[var(--fg2)]', className)}>{children}</div>
  if (!forceMount) return <Collapse open={it.on}>{panel}</Collapse>
  return (
    <div className="ui-collapse" data-open={it.on ? '' : undefined} style={{ visibility: it.on ? 'visible' : 'hidden' }}><div>{panel}</div></div>
  )
}

function AccordionConfig({ items, multiple, defaultOpen = [], value, onValueChange, className }:
  { items: { title: ReactNode; content: ReactNode }[]; multiple?: boolean; defaultOpen?: number[]
    /** open panels (controlled) */ value?: number[]; onValueChange?: (open: number[]) => void; className?: string }) {
  const [open, setOpen] = useControllable(value, defaultOpen, onValueChange)
  return (
    <AccordionRoot type="multiple" value={open.map(String)} className={className}
      onValueChange={next => { const added = next.find(v => !open.includes(+v)); setOpen(multiple || added === undefined ? next.map(Number) : [+added]) }}>
      {items.map((it, i) => (
        <AccordionItem key={i} value={String(i)}>
          <AccordionTrigger>{it.title}</AccordionTrigger>
          <AccordionContent>{it.content}</AccordionContent>
        </AccordionItem>
      ))}
    </AccordionRoot>
  )
}

/**
 * Accordion: panels grow to their content height and the chevron rotates. Open panels (by index) are uncontrolled
 * (`defaultOpen`) or controlled (`value` + `onValueChange`); `multiple` lets several stay open.
 * Parts: Accordion.Root (type single|multiple, collapsible) / Item / Trigger (asChild) / Content (forceMount).
 */
export const Accordion = Object.assign(AccordionConfig, { Root: AccordionRoot, Item: AccordionItem, Trigger: AccordionTrigger, Content: AccordionContent })

/** Any list whose items animate in, out and into new positions. */
export function AnimatedList<T>({ items, keyOf, render, className }: { items: T[]; keyOf: (t: T) => string; render: (t: T) => ReactNode; className?: string }) {
  const list = useRef<HTMLUListElement>(null)
  useFlip(list, { transition: spring(0.25, 0.4) })
  return (
    <ul ref={list} className={cn('m-0 flex list-none flex-col gap-1.5 p-0', className)}>
      <PresenceList items={items} keyOf={keyOf}>
        {t => <li data-flip={keyOf(t)} className="ui-in [--ui-d:.4s] [--ui-s:.98] [--ui-so:1] [--ui-xo:24px] [--ui-y:-8px] [--ui-yo:0]">{render(t)}</li>}
      </PresenceList>
    </ul>
  )
}

export type Task = { id: string; text: string; done?: boolean }

/**
 * To-do list built on AnimatedList: type and press Enter (or Add) to add, an empty submit shakes the input,
 * ticking an item draws the check and strikes the text through, ✕ slides it out while the rest close up.
 */
export function TaskList({ value, defaultValue = [], onChange, placeholder: ph, className }:
  { value?: Task[]; defaultValue?: Task[]; onChange?: (t: Task[]) => void; placeholder?: string; className?: string }) {
  const [tasks, set] = useControllable(value, defaultValue, onChange)
  const input = useRef<HTMLInputElement>(null)
  const placeholder = ph ?? 'New task'
  const add = () => {
    const v = input.current!.value.trim()
    if (!v) { shake(input.current, 4); input.current!.focus(); return }
    set([...tasks, { id: uid('task'), text: v }]); input.current!.value = ''
  }
  return (
    <div className={cn('flex flex-col gap-2', className)}>
      <AnimatedList items={tasks} keyOf={t => t.id} render={t => (
        <div className={cn(surface.md, 'flex items-center gap-2.5 px-2.5 py-2 text-[13px]')}>
          {/* the button keeps the 16px box; on touch an invisible hit area grows it to a finger-sized target */}
          <button role="checkbox" aria-checked={!!t.done} aria-label={t.text} onClick={() => set(tasks.map(x => x.id === t.id ? { ...x, done: !x.done } : x))}
            className={cn('grid flex-none cursor-pointer place-items-center border-0 bg-transparent p-0', TOUCH.hit)}>
            <CheckboxBox checked={!!t.done} size={16} className="[@media(pointer:coarse)]:!h-[18px] [@media(pointer:coarse)]:!w-[18px]" />
          </button>
          <span className={cn('flex-1 transition-colors [@media(pointer:coarse)]:text-sm', t.done && 'text-[var(--fg3)] line-through')}>{t.text}</span>
          <IconButton icon="x" label={`Remove ${t.text}`} onClick={() => set(tasks.filter(x => x.id !== t.id))} className={cn(TOUCH.tap36, '[@media(pointer:coarse)]:!-my-1')} />
        </div>
      )} />
      <div className="flex gap-2">
        <input ref={input} placeholder={placeholder} aria-label={placeholder} onKeyDown={e => e.key === 'Enter' && !e.nativeEvent.isComposing && add()}
          className={cn(inputClass, '!h-8 min-w-0 flex-1 [@media(pointer:coarse)]:!h-11', TOUCH.input)} />
        <Button size="sm" variant="primary" onClick={add} className="[@media(pointer:coarse)]:!h-11 [@media(pointer:coarse)]:!px-4">{'Add'}</Button>
      </div>
    </div>
  )
}

type JvCtx = { closed: Set<string>; toggle: (p: string) => void; q: string; copy: (p: string) => void }

/** Stands in for a value JsonViewer won't expand: a reference back to an ancestor, a branch past the depth cap, the rest of a huge tree. */
class JvMarker { readonly text: string; constructor(text: string) { this.text = text } }
const JV_MAX_DEPTH = 64
const JV_MAX_NODES = 5000
const jvIsObj = (v: unknown): v is object => v !== null && typeof v === 'object' && !(v instanceof JvMarker)
/**
 * The path of child `k` under path `p` (the key for collapse state, search, scroll targets and "copy path"): `p[3]` in
 * an array, `p.name` for an identifier key, `p["a.b"]` for any other key, so `"a.b"` and `a → b` never share a path.
 */
const jvChild = (p: string, k: string, arr: boolean) =>
  arr ? `${p}[${k}]` : /^[A-Za-z_$][\w$]*$/.test(k) ? (p ? `${p}.${k}` : k) : `${p}[${JSON.stringify(k)}]`
/**
 * A copy of `data` that is safe to render: cycles become [Circular] (tracked per path with a WeakSet, so shared but
 * acyclic references still show), nesting stops at JV_MAX_DEPTH levels, and the tree stops after JV_MAX_NODES values.
 * Objects are rebuilt with a null prototype, so a `__proto__` key is just a key. Throwing getters show as [Unreadable].
 */
function jvSafe(data: unknown): unknown {
  const path = new WeakSet<object>(); let nodes = 0
  const go = (v: unknown, depth: number): unknown => {
    if (v === null || typeof v !== 'object') return v
    if (path.has(v)) return new JvMarker('[Circular]')
    if (depth >= JV_MAX_DEPTH) return new JvMarker('[…deeper levels hidden]')
    let entries: [string, unknown][]
    try { entries = Object.entries(v) } catch { return new JvMarker('[Unreadable]') }
    path.add(v)
    const arr = Array.isArray(v), out: Record<string, unknown> | unknown[] = arr ? [] : Object.create(null)
    for (let i = 0; i < entries.length; i++) {
      if (++nodes > JV_MAX_NODES) { const more = new JvMarker(`[…${entries.length - i} more]`); if (Array.isArray(out)) out.push(more); else out['…'] = more; break }
      const x = go(entries[i][1], depth + 1)
      if (Array.isArray(out)) out.push(x); else out[entries[i][0]] = x
    }
    path.delete(v)
    return out
  }
  return go(data, 0)
}

function JsonValue({ v }: { v: unknown }) {
  if (v instanceof JvMarker) return <span className="text-[var(--fg3)] italic">{v.text}</span>
  if (v === null) return <span className="text-[var(--fg3)] italic">null</span>
  if (typeof v === 'string') return <span className="text-[color-mix(in_srgb,var(--ok)_85%,var(--fg))]">"{v}"</span>
  if (typeof v === 'number') return <span className="text-[color-mix(in_srgb,var(--c3)_70%,var(--fg))]">{v}</span>
  return <span className="text-[color-mix(in_srgb,var(--bad)_75%,var(--fg))]">{String(v)}</span>
}

function JsonNode({ k, v, path, last, ctx }: { k: string | number | null; v: unknown; path: string; last: boolean; ctx: JvCtx }) {
  const isObj = jvIsObj(v), arr = Array.isArray(v)
  const hit = k !== null && !!ctx.q && String(k).toLowerCase().includes(ctx.q)
  const key = k !== null && (
    <><button data-jv-path={path} data-hit={hit || undefined} onClick={() => ctx.copy(path)} title={`Copy path ${path}`}
      className={cn('min-w-6 cursor-pointer rounded-[var(--r-sm)] border-0 p-0 font-[inherit] text-[var(--accent)] hover:bg-[var(--accent-soft)] [@media(pointer:coarse)]:min-h-8 [@media(pointer:coarse)]:min-w-8 [@media(pointer:coarse)]:text-start', typeof k === 'number' ? 'text-end' : 'text-start', hit ? 'bg-[var(--warn-soft)]' : 'bg-transparent')}>
      {typeof k === 'number' ? k : `"${k}"`}</button><span className="text-[var(--fg2)]">: </span></>
  )
  // keys and toggles are at least 24×24px (WCAG 2.5.8): rows are 24px tall (leading-6 on the box), index keys right-align
  const row = 'flex items-baseline whitespace-pre'
  const pad = <span className="w-[18px] flex-none [@media(pointer:coarse)]:w-7" />
  if (!isObj) return <div className={row}>{pad}{key}<JsonValue v={v} />{!last && <span className="text-[var(--fg3)]">,</span>}</div>
  const entries = Object.entries(v as object), open = !ctx.closed.has(path)
  return (
    <div>
      <div className={row}>
        <button onClick={() => ctx.toggle(path)} aria-expanded={open} aria-label={(open ? `Collapse ${path || 'root'}` : `Expand ${path || 'root'}`)}
          className="-ms-1.5 grid h-6 w-6 flex-none cursor-pointer place-items-center self-center border-0 bg-transparent p-0 text-[var(--fg3)] [@media(pointer:coarse)]:-ms-2 [@media(pointer:coarse)]:me-1 [@media(pointer:coarse)]:h-8 [@media(pointer:coarse)]:w-8">
          <span className={cn('grid transition-transform duration-150 motion-reduce:transition-none', !open && '-rotate-90')}><Icon name="chevronDown" size={10} strokeWidth={2.5} /></span>
        </button>
        {key}<span className="text-[var(--fg2)]">{arr ? '[' : '{'}</span>
        <span className="ms-1.5 text-[11px] text-[var(--fg3)]">{(arr ? plural(entries.length, 'item') : plural(entries.length, 'key'))}</span>
        {!open && <span className="text-[var(--fg2)]"> {arr ? ']' : '}'}{!last && ','}</span>}
      </div>
      <Collapse open={open}>
        <div className="ms-1.5 border-s border-[var(--line)] ps-4">
          {entries.map(([kk, vv], i) => (
            <JsonNode key={kk} k={arr ? i : kk} v={vv} last={i === entries.length - 1} ctx={ctx}
              path={jvChild(path, kk, arr)} />
          ))}
        </div>
        <div className={row}>{pad}<span className="text-[var(--fg2)]">{arr ? ']' : '}'}</span>{!last && <span className="text-[var(--fg3)]">,</span>}</div>
      </Collapse>
    </div>
  )
}

/**
 * JSON tree with typed colours (strings, numbers, booleans, null). Filter highlights matching keys, opens their
 * branches and scrolls to the first hit; click a key to copy its path (e.g. `steps[1].failed`); collapse or
 * expand everything at once. Branches animate open and shut. Cyclic data shows [Circular]; very deep or very large
 * data is cut off with a marker instead of overflowing the stack.
 */
export function JsonViewer({ data, defaultCollapsed = [], onCopyPath, maxHeight = 330, className }:
  { data: unknown; /** paths to start closed, e.g. ['flow.owner'] */ defaultCollapsed?: string[]; onCopyPath?: (path: string) => void; maxHeight?: number; className?: string }) {
  const [closed, setClosed] = useState(() => new Set(defaultCollapsed))
  const [q, setQ] = useState('')
  const [noMatch, setNoMatch] = useState(false)
  const box = useRef<HTMLDivElement>(null), tree = useRef<HTMLDivElement>(null)
  // the first hit, kept in view (also while its branches animate open) until the next filter or a click in the tree
  const jump = useRef<string | null>(null)
  const reveal = () => {
    if (!jump.current) return
    const el = box.current?.querySelector<HTMLElement>(`[data-jv-path="${CSS.escape(jump.current)}"]`)
    revealInScroller(el, { scroller: box.current }); revealInScroller(el, { axis: 'x', scroller: box.current })
  }
  useLayoutEffect(reveal)
  useResizeObserver(tree, reveal)
  const toast = useToast()
  const safe = useMemo(() => jvSafe(data), [data])
  const containers = useMemo(() => {
    const out: string[] = []
    const walk = (v: unknown, p: string) => { if (jvIsObj(v)) { if (p) out.push(p); Object.entries(v).forEach(([k, x]) => walk(x, jvChild(p, k, Array.isArray(v)))) } }
    walk(safe, ''); return out
  }, [safe])
  const allClosed = containers.length > 0 && containers.every(p => closed.has(p))
  const copy = (p: string) => {
    if (onCopyPath) return onCopyPath(p)
    const said = (ok: boolean) => toast({ title: ok ? 'Path copied' : 'Couldn’t copy the path', description: <code className="font-[family-name:var(--mono)]">{p}</code>, tone: ok ? undefined : 'bad' })
    void writeClipboard(p).then(said)
  }
  const filter = (raw: string) => {
    const s = raw.trim().toLowerCase(); setQ(s)
    jump.current = null
    if (!s) { setNoMatch(false); return }
    // first key that matches, in document order
    let first: string | null = null
    const walk = (v: unknown, p: string) => {
      if (first || !jvIsObj(v)) return
      for (const [k, x] of Object.entries(v)) { const np = jvChild(p, k, Array.isArray(v)); if (k.toLowerCase().includes(s)) { first = np; return } walk(x, np); if (first) return }
    }
    walk(safe, '')
    setNoMatch(!first)
    if (first) {
      const target: string = first
      jump.current = target
      setClosed(c => { const n = new Set(c); [...n].forEach(p => { if (target.startsWith(p) && /^[.[]/.test(target.slice(p.length))) n.delete(p) }); return n })
    }
  }
  const ctx: JvCtx = { closed, q, copy, toggle: p => { jump.current = null; setClosed(c => { const n = new Set(c); if (n.has(p)) n.delete(p); else n.add(p); return n }) } }
  return (
    <div className={cn('flex flex-col gap-2.5', className)}>
      <div className="flex gap-2">
        <input placeholder={'Filter keys'} aria-label={'Filter keys'} onChange={e => filter(e.target.value)}
          className={cn(inputClass, '!h-8 min-w-0 flex-1 [@media(pointer:coarse)]:!h-10', TOUCH.input)} />
        <Button size="sm" onClick={() => { jump.current = null; setClosed(allClosed ? new Set() : new Set(containers)) }} className={TOUCH.row}>{allClosed ? 'Expand all' : 'Collapse all'}</Button>
      </div>
      <span role="status" className="sr-only">{noMatch ? 'No matching keys' : ''}</span>
      {noMatch && <p aria-hidden className="m-0 text-xs text-[var(--fg3)]">{'No matching keys'}</p>}
      {/* touch: 32px rows so every key and toggle is a finger-sized target; the box scrolls both ways */}
      <div ref={box} onPointerDown={() => { jump.current = null }} onWheel={() => { jump.current = null }} className="overflow-auto overscroll-x-contain rounded-[var(--r-md)] border border-[var(--line)] bg-[color-mix(in_srgb,var(--muted)_35%,var(--card))] px-2.5 py-2 font-[family-name:var(--mono)] text-xs leading-6 [@media(pointer:coarse)]:text-[13px] [@media(pointer:coarse)]:leading-8" style={{ maxHeight }}>
        {/* as wide as the widest row, so long keys and values scroll with the box instead of being clipped by a branch */}
        <div ref={tree} className="w-max min-w-full"><JsonNode k={null} v={safe} path="" last ctx={ctx} /></div>
      </div>
    </div>
  )
}

export type ShortcutGroup = { title: string; items: [label: string, keys: string[]][] }

/**
 * Keyboard shortcuts in titled groups (General / Navigation / Editing…). Inline by default (`columns={2}` lays groups side
 * by side); `variant="dialog"` shows them in a dialog instead, controlled by `open` + `onOpenChange` (two columns, a
 * Close button), and `hotkey` also toggles that dialog with ? (ignored while typing in a field).
 */
export function ShortcutSheet({ groups, columns, className, variant = 'inline', open = false, onOpenChange, hotkey = false, title }:
  { groups: ShortcutGroup[]; columns?: 1 | 2; className?: string
    /** 'inline' (default) or 'dialog' */ variant?: 'inline' | 'dialog'
    /** dialog only: shown, and its change */ open?: boolean; onOpenChange?: (v: boolean) => void
    /** dialog only: ? toggles it */ hotkey?: boolean; /** dialog only: its title (default "Keyboard shortcuts") */ title?: string }) {
  const dialog = variant === 'dialog'
  useHotkey('?', () => onOpenChange?.(!open), { enabled: dialog && hotkey, ignoreEditable: true })
  const sheet = (
    <div className={cn('grid gap-x-5 gap-y-3', (columns ?? (dialog ? 2 : 1)) === 2 && 'sm:grid-cols-2', dialog ? 'mt-2' : className)}>
      {groups.map(g => (
        <section key={g.title} aria-label={g.title}>
          {/* not a heading: the sheet sits under card titles and dialog titles of different levels; the section carries the name */}
          <div aria-hidden className="m-0 mb-1.5 text-[11px] font-semibold tracking-[.05em] text-[var(--fg3)] uppercase">{g.title}</div>
          {g.items.map(([label, keys], i) => (
            <div key={i} className="flex items-center justify-between border-b border-[var(--line)] py-1.5 text-[13px] last:border-0">
              <span>{label}</span><span className="flex gap-1">{keys.map((k, i) => <Kbd key={i}>{k}</Kbd>)}</span>
            </div>
          ))}
        </section>
      ))}
    </div>
  )
  if (!dialog) return sheet
  return (
    <Dialog open={open} onOpenChange={v => onOpenChange?.(v)} title={title ?? 'Keyboard shortcuts'} className={cn('!max-w-[640px]', className)}
      footer={<Button size="sm" onClick={() => onOpenChange?.(false)} data-autofocus>{'Close'}</Button>}>
      {sheet}
    </Dialog>
  )
}

