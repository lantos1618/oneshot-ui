import { createContext, useContext, useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { AnimatedNumber, type AsChildProps, Button, Slot, DeltaBadge, Icon, IconButton, Kbd, TOUCH, cn, fmtDate, inputClass, spring, surface, useControllable, useHotkey, SparkChart, rowHoverClass } from './core'
import { shake } from './motion'
import { Collapse, useToast } from './feedback'
import { Calendar, CheckboxBox, type DateRange, SegmentedControl, inputShellClass } from './forms'
import { Dialog } from './overlay'

/* ════════════════════════════════════════════════════════════════════════════
 * 9. DATA DISPLAY
 * ══════════════════════════════════════════════════════════════════════════ */

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

export type Column<T> = { key: keyof T & string; label: string; align?: 'left' | 'right'; sortable?: boolean; render?: (row: T) => ReactNode; className?: string }
/** Sort state of a DataTable: the column key and 1 (ascending) or -1 (descending). */
export type DataSort<T> = { key: keyof T & string; dir: 1 | -1 }

/**
 * Sortable table; rows slide to their new position when the order changes. Sort is uncontrolled (`initialSort`) or
 * controlled (`sort` + `onSortChange`). With `onRowClick` a click anywhere on a row opens it, and the first cell is a real
 * button, so keyboard users Tab to it and press Enter or Space. Scrolls sideways inside its box when too wide.
 */
export function DataTable<T extends object>({ columns, rows, rowKey, initialSort, sort: sortProp, onSortChange, onRowClick, className }:
  { columns: Column<T>[]; rows: T[]; rowKey: (r: T) => string; initialSort?: DataSort<T>
    /** controlled sort; null = original order */ sort?: DataSort<T> | null; onSortChange?: (s: DataSort<T> | null) => void
    onRowClick?: (r: T) => void; className?: string }) {
  const [sort, setSort] = useControllable<DataSort<T> | null>(sortProp, initialSort ?? null, onSortChange)
  const sorted = useMemo(() => {
    if (!sort) return rows
    return [...rows].sort((a, b) => {
      const x = a[sort.key], y = b[sort.key]
      return (typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y))) * sort.dir
    })
  }, [rows, sort])
  const cell = (r: T, c: Column<T>) => c.render ? c.render(r) : String(r[c.key] ?? '')
  return (
    <div className={cn('overflow-x-auto', className)}>
      <table className="w-full border-collapse text-[13px]">
        <thead>
          <tr>{columns.map(c => (
            <th key={c.key} aria-sort={sort?.key === c.key ? (sort.dir === 1 ? 'ascending' : 'descending') : undefined}
              className={cn('border-b border-[var(--line)] px-2 py-1.5 text-xs font-medium whitespace-nowrap text-[var(--fg3)] first:pl-0 last:pr-0', c.align === 'right' ? 'text-right' : 'text-left')}>
              {c.sortable === false ? c.label : (
                <button onClick={() => setSort({ key: c.key, dir: sort?.key === c.key ? (-sort.dir as 1 | -1) : 1 })}
                  className={cn('inline-flex cursor-pointer items-center gap-1 border-0 bg-transparent p-0 font-medium text-inherit hover:text-[var(--fg)]', TOUCH.tap36)}>
                  {c.label}
                  <motion.span animate={{ rotate: sort?.key === c.key && sort.dir === -1 ? 180 : 0, opacity: sort?.key === c.key ? 1 : 0.3 }}><Icon name="arrowUp" size={11} /></motion.span>
                </button>
              )}
            </th>
          ))}</tr>
        </thead>
        <tbody>
          {sorted.map(r => (
            <motion.tr key={rowKey(r)} layout="position" transition={spring(0.15, 0.4)}
              // mouse and touch: the whole row; controls inside cells keep their own clicks
              onClick={onRowClick && (e => { if (!(e.target as Element).closest('button,a,input,select,textarea,label')) onRowClick(r) })}
              className={cn(onRowClick && 'cursor-pointer hover:bg-[var(--muted)] has-[[data-row-open]:focus-visible]:bg-[var(--muted)]')}>
              {columns.map((c, i) => (
                <td key={c.key} className={cn('border-b border-[var(--line)] px-2 py-2 first:pl-0 last:pr-0', c.align === 'right' && 'ui-num text-right', c.className)}>
                  {onRowClick && i === 0
                    ? <button data-row-open onClick={() => onRowClick(r)}
                      className="cursor-pointer rounded-[var(--r-sm)] border-0 bg-transparent p-0 text-left font-[inherit] text-inherit outline-none focus-visible:shadow-[0_0_0_2px_var(--accent)]">{cell(r, c)}</button>
                    : cell(r, c)}
                </td>
              ))}
            </motion.tr>
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
const useAccItem = (part: string) => { const c = useContext(AccItemCtx); if (!c) throw new Error(`<Accordion.${part}> must be inside <Accordion.Item>`); return c }
const accIdPart = (v: string) => v.replace(/[^\w-]/g, '_')

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
  const acc = useContext(AccCtx)
  if (!acc) throw new Error('<Accordion.Item> must be inside <Accordion.Root>')
  const on = acc.open.includes(value), id = `${acc.base}-${accIdPart(value)}`
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
    className: cn('flex w-full cursor-pointer items-center justify-between gap-3 rounded-[var(--r-md)] border-0 bg-transparent px-1.5 py-3 text-left text-[13px] font-medium transition-colors disabled:cursor-default disabled:opacity-50 [@media(pointer:coarse)]:min-h-11 [@media(pointer:coarse)]:text-sm', rowHoverClass, className),
  }
  if (asChild) return <Slot {...props} aria-disabled={it.disabled || undefined}>{children}</Slot>
  return (
    <button type="button" disabled={it.disabled} {...props}>
      {children}
      <motion.span animate={{ rotate: it.on ? 180 : 0 }} transition={spring(0.2, 0.3)} className="text-[var(--fg3)]"><Icon name="chevronDown" size={14} /></motion.span>
    </button>
  )
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
    <motion.div initial={false} className="overflow-hidden" transition={spring(0.1, 0.32)}
      animate={it.on ? { height: 'auto', opacity: 1, visibility: 'visible' } : { height: 0, opacity: 0, transitionEnd: { visibility: 'hidden' } }}>{panel}</motion.div>
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
  return (
    <ul className={cn('m-0 flex list-none flex-col gap-1.5 p-0', className)}>
      <AnimatePresence initial={false}>
        {items.map(t => (
          <motion.li key={keyOf(t)} layout initial={{ opacity: 0, y: -8, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, x: 24, transition: { duration: 0.15 } }} transition={spring(0.25, 0.4)}>{render(t)}</motion.li>
        ))}
      </AnimatePresence>
    </ul>
  )
}

/* Task list ──────────────────────────────────────────────────────────────── */

export type Task = { id: string; text: string; done?: boolean }

/**
 * To-do list built on AnimatedList: type and press Enter (or Add) to add, an empty submit shakes the input,
 * ticking an item draws the check and strikes the text through, ✕ slides it out while the rest close up.
 */
export function TaskList({ value, defaultValue = [], onChange, placeholder = 'New task', className }:
  { value?: Task[]; defaultValue?: Task[]; onChange?: (t: Task[]) => void; placeholder?: string; className?: string }) {
  const [tasks, set] = useControllable(value, defaultValue, onChange)
  const input = useRef<HTMLInputElement>(null)
  const add = () => {
    const v = input.current!.value.trim()
    if (!v) { shake(input.current, 4); input.current!.focus(); return }
    set([...tasks, { id: `t${Date.now().toString(36)}`, text: v }]); input.current!.value = ''
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
        <Button size="sm" variant="primary" onClick={add} className="[@media(pointer:coarse)]:!h-11 [@media(pointer:coarse)]:!px-4">Add</Button>
      </div>
    </div>
  )
}

/* Inline date picker ─────────────────────────────────────────────────────── */

const dpFmt = (d: Date | null) => fmtDate(d, { day: '2-digit', month: '2-digit', year: 'numeric' }, 'en-GB') // always dd/mm/yyyy, the mask's shape
const dpParse = (v: string) => {
  const m = v.match(/^(\d{2})\/(\d{2})\/(\d{4})$/); if (!m) return null
  const d = new Date(+m[3], +m[2] - 1, +m[1])
  return d.getDate() === +m[1] && d.getMonth() === +m[2] - 1 ? d : null
}
const DP_MASK = 'dd/mm/yyyy'

/** dd/mm/yyyy field: slashes fill in as you type, the rest of the mask shows as ghost text, invalid dates shake. */
function DateMaskInput({ value, onCommit, label, inputRef }: { value: Date | null; onCommit: (d: Date) => void; label: string; inputRef?: React.RefObject<HTMLInputElement | null> }) {
  const [text, setText] = useState(dpFmt(value))
  const [err, setErr] = useState(false)
  const box = useRef<HTMLDivElement>(null), focused = useRef(false)
  const t = value?.getTime()
  useEffect(() => { if (!focused.current) { setText(dpFmt(value)); setErr(false) } }, [t]) // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div ref={box} className={cn(inputShellClass(err), 'relative h-9 min-w-0 flex-1 font-[family-name:var(--mono)] text-[13px] tracking-[.02em] [@media(pointer:coarse)]:h-11 [@media(pointer:coarse)]:tracking-normal', TOUCH.input)}>
      <span aria-hidden className="pointer-events-none absolute inset-0 flex items-center px-2.5 whitespace-pre text-transparent">{text}<em className="text-[var(--fg3)] not-italic">{DP_MASK.slice(text.length)}</em></span>
      <input ref={inputRef} value={text} inputMode="numeric" autoComplete="off" aria-label={`${label}, dd/mm/yyyy`} aria-invalid={err || undefined}
        onFocus={e => { focused.current = true; const el = e.currentTarget; setTimeout(() => el.select(), 0) }}
        onBlur={() => { focused.current = false; if (text && !dpParse(text)) setErr(true) }}
        onKeyDown={e => { if (e.key === 'Backspace' && text.endsWith('/') && e.currentTarget.selectionStart === text.length) { e.preventDefault(); setText(text.slice(0, -2)) } }}
        onChange={e => {
          const digits = e.target.value.replace(/\D/g, '').slice(0, 8), deleting = e.target.value.length < text.length
          let out = digits.slice(0, 2)
          if (digits.length > 2) out += '/' + digits.slice(2, 4)
          if (digits.length > 4) out += '/' + digits.slice(4)
          if (!deleting && (digits.length === 2 || digits.length === 4)) out += '/'
          setText(out); setErr(false)
          if (digits.length === 8) { const d = dpParse(out); if (!d) { setErr(true); shake(box.current, 5) } else onCommit(d) }
        }}
        className="absolute inset-0 w-full border-0 bg-transparent px-2.5 font-[inherit] tracking-[inherit] text-[var(--fg)] outline-none" />
    </div>
  )
}

/**
 * Inline date picker card with two modes: one date, or a range. Type dd/mm/yyyy into the masked fields (the
 * calendar jumps to the typed month) or pick on the calendar (drag across days in range mode). The footer
 * spells out the choice, counts the days, and Clear resets it. Composes `Calendar`.
 */
export function InlineDatePicker({ value, defaultValue = [null, null], onChange, defaultMode = 'date', className }:
  { value?: DateRange; defaultValue?: DateRange; onChange?: (r: DateRange) => void; defaultMode?: 'date' | 'range'; className?: string }) {
  const [[a, b], set] = useControllable<DateRange>(value, defaultValue, onChange)
  const [mode, setMode] = useState(defaultMode)
  const [jump, setJump] = useState<Date | null>(null)
  const toRef = useRef<HTMLInputElement>(null)
  const lo = a && b ? (a < b ? a : b) : a ?? b, hi = a && b ? (a < b ? b : a) : a ?? b
  const days = lo && hi ? Math.round((+hi - +lo) / 864e5) + 1 : 0
  const f = (d: Date, year = false) => fmtDate(d, { day: 'numeric', month: 'short', ...(year && { year: 'numeric' }) })
  const commitFrom = (d: Date) => { set([d, mode === 'date' || !hi || hi < d ? d : hi]); setJump(d); if (mode === 'range') toRef.current?.focus() }
  const commitTo = (d: Date) => { const s = lo ?? d; set(d < s ? [d, s] : [s, d]); setJump(d) }
  return (
    <div className={cn('flex flex-col gap-3', className)}>
      <SegmentedControl size="sm" className="self-start [@media(pointer:coarse)]:[&>button]:h-9" value={mode} onChange={m => { setMode(m as 'date' | 'range'); if (m === 'date' && lo) set([lo, lo]) }}
        options={[{ value: 'date', label: 'Date' }, { value: 'range', label: 'Date range' }]} />
      <div className="flex items-center gap-2">
        <DateMaskInput label={mode === 'range' ? 'From date' : 'Date'} value={lo} onCommit={commitFrom} />
        <AnimatePresence initial={false}>
          {mode === 'range' && (
            <motion.div key="to" className="flex min-w-0 flex-1 items-center gap-2" initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -8, transition: { duration: 0.12 } }} transition={spring(0.25, 0.35)}>
              <Icon name="arrowDown" size={14} className="-rotate-90 text-[var(--fg3)]" />
              <DateMaskInput label="To date" inputRef={toRef} value={hi && lo && +hi !== +lo ? hi : null} onCommit={commitTo} />
            </motion.div>
          )}
        </AnimatePresence>
      </div>
      <Calendar key={jump ? `${jump.getFullYear()}-${jump.getMonth()}-${+jump}` : 'cal'} month={jump ?? lo ?? undefined}
        className="!w-full [@media(pointer:coarse)]:[&_button[aria-label$=month]]:!h-9 [@media(pointer:coarse)]:[&_button[aria-label$=month]]:!w-9"
        {...(mode === 'range' ? { range: [lo, a && b && +a === +b ? null : hi] as DateRange, onRangeChange: (r: DateRange) => set(r[1] ? r : [r[0], r[0]]) } : { selected: lo, onSelect: (d: Date) => set([d, d]) })} />
      <div className="flex min-h-5 flex-wrap items-center justify-between gap-x-2.5 gap-y-1 text-[13px]" aria-live="polite">
        <span className="font-medium">{!lo || !hi ? 'No date selected' : days === 1 ? f(lo, true) : `${f(lo)} to ${f(hi)} ${hi.getFullYear()}`}</span>
        <span className="ml-auto flex items-center gap-2">
          {lo && <span className="text-xs text-[var(--fg3)]">{days === 1 ? 'Single day' : `${days} days`}</span>}
          <Button size="sm" variant="ghost" onClick={() => set([null, null])} disabled={!lo} className={TOUCH.tap36}>Clear</Button>

        </span>
      </div>
    </div>
  )
}

/* JSON viewer ────────────────────────────────────────────────────────────── */

type JvCtx = { closed: Set<string>; toggle: (p: string) => void; q: string; copy: (p: string) => void }

/** Stands in for a value JsonViewer won't expand: a reference back to an ancestor, a branch past the depth cap, the rest of a huge tree. */
class JvMarker { readonly text: string; constructor(text: string) { this.text = text } }
const JV_MAX_DEPTH = 64
const JV_MAX_NODES = 5000
const jvIsObj = (v: unknown): v is object => v !== null && typeof v === 'object' && !(v instanceof JvMarker)
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
      className={cn('cursor-pointer rounded-[var(--r-sm)] border-0 p-0 font-[inherit] text-[var(--accent)] hover:bg-[var(--accent-soft)] [@media(pointer:coarse)]:min-h-8 [@media(pointer:coarse)]:min-w-8 [@media(pointer:coarse)]:text-left', hit ? 'bg-[var(--warn-soft)]' : 'bg-transparent')}>
      {typeof k === 'number' ? k : `"${k}"`}</button><span className="text-[var(--fg2)]">: </span></>
  )
  const row = 'flex items-baseline whitespace-pre'
  const pad = <span className="w-[18px] flex-none [@media(pointer:coarse)]:w-7" />
  if (!isObj) return <div className={row}>{pad}{key}<JsonValue v={v} />{!last && <span className="text-[var(--fg3)]">,</span>}</div>
  const entries = Object.entries(v as object), open = !ctx.closed.has(path)
  return (
    <div>
      <div className={row}>
        <button onClick={() => ctx.toggle(path)} aria-expanded={open} aria-label={`${open ? 'Collapse' : 'Expand'} ${path || 'root'}`}
          className="mr-1 grid w-[14px] flex-none cursor-pointer place-items-center self-center border-0 bg-transparent p-0 text-[var(--fg3)] [@media(pointer:coarse)]:-ml-2 [@media(pointer:coarse)]:h-8 [@media(pointer:coarse)]:w-8">
          <motion.span initial={false} animate={{ rotate: open ? 0 : -90 }} transition={{ duration: 0.15 }} className="grid"><Icon name="chevronDown" size={10} strokeWidth={2.5} /></motion.span>
        </button>
        {key}<span className="text-[var(--fg2)]">{arr ? '[' : '{'}</span>
        <span className="ml-1.5 text-[11px] text-[var(--fg3)]">{entries.length} {arr ? 'items' : 'keys'}</span>
        {!open && <span className="text-[var(--fg2)]"> {arr ? ']' : '}'}{!last && ','}</span>}
      </div>
      <Collapse open={open}>
        <div className="ml-1.5 border-l border-[var(--line)] pl-4">
          {entries.map(([kk, vv], i) => (
            <JsonNode key={kk} k={arr ? i : kk} v={vv} last={i === entries.length - 1} ctx={ctx}
              path={arr ? `${path}[${kk}]` : path ? `${path}.${kk}` : kk} />
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
  const box = useRef<HTMLDivElement>(null)
  const toast = useToast()
  const safe = useMemo(() => jvSafe(data), [data])
  const containers = useMemo(() => {
    const out: string[] = []
    const walk = (v: unknown, p: string) => { if (jvIsObj(v)) { if (p) out.push(p); Object.entries(v).forEach(([k, x]) => walk(x, Array.isArray(v) ? `${p}[${k}]` : p ? `${p}.${k}` : k)) } }
    walk(safe, ''); return out
  }, [safe])
  const allClosed = containers.length > 0 && containers.every(p => closed.has(p))
  const copy = (p: string) => {
    if (onCopyPath) return onCopyPath(p)
    const said = (ok: boolean) => toast({ title: ok ? 'Path copied' : 'Couldn’t copy the path', description: <code className="font-[family-name:var(--mono)]">{p}</code>, tone: ok ? undefined : 'bad' })
    if (!navigator.clipboard) return said(false)
    navigator.clipboard.writeText(p).then(() => said(true), () => said(false))
  }
  const filter = (raw: string) => {
    const s = raw.trim().toLowerCase(); setQ(s)
    if (!s) return
    // first key that matches, in document order
    let first: string | null = null
    const walk = (v: unknown, p: string) => {
      if (first || !jvIsObj(v)) return
      for (const [k, x] of Object.entries(v)) { const np = Array.isArray(v) ? `${p}[${k}]` : p ? `${p}.${k}` : k; if (k.toLowerCase().includes(s)) { first = np; return } walk(x, np); if (first) return }
    }
    walk(safe, '')
    if (first) {
      const target: string = first
      setClosed(c => { const n = new Set(c); [...n].forEach(p => { if (target.startsWith(p) && /^[.[]/.test(target.slice(p.length))) n.delete(p) }); return n })
      setTimeout(() => box.current?.querySelector<HTMLElement>(`[data-jv-path="${CSS.escape(target)}"]`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }), 340)
    }
  }
  const ctx: JvCtx = { closed, q, copy, toggle: p => setClosed(c => { const n = new Set(c); if (n.has(p)) n.delete(p); else n.add(p); return n }) }
  return (
    <div className={cn('flex flex-col gap-2.5', className)}>
      <div className="flex gap-2">
        <input placeholder="Filter keys" aria-label="Filter keys" onChange={e => filter(e.target.value)}
          className={cn(inputClass, '!h-8 min-w-0 flex-1 [@media(pointer:coarse)]:!h-10', TOUCH.input)} />
        <Button size="sm" onClick={() => setClosed(allClosed ? new Set() : new Set(containers))} className={TOUCH.row}>{allClosed ? 'Expand all' : 'Collapse all'}</Button>
      </div>
      {/* touch: 32px rows so every key and toggle is a finger-sized target; the box scrolls both ways */}
      <div ref={box} className="overflow-auto overscroll-x-contain rounded-[var(--r-md)] border border-[var(--line)] bg-[color-mix(in_srgb,var(--muted)_35%,var(--card))] px-2.5 py-2 font-[family-name:var(--mono)] text-xs leading-[1.75] [@media(pointer:coarse)]:text-[13px] [@media(pointer:coarse)]:leading-8" style={{ maxHeight }}>

        {/* as wide as the widest row, so long keys and values scroll with the box instead of being clipped by a branch */}
        <div className="w-max min-w-full"><JsonNode k={null} v={safe} path="" last ctx={ctx} /></div>
      </div>
    </div>
  )
}

/* Keyboard shortcuts ─────────────────────────────────────────────────────── */

export type ShortcutGroup = { title: string; items: [label: string, keys: string[]][] }

/** Shortcut sheet in titled groups, e.g. General / Navigation / Editing. `columns={2}` lays groups side by side. */
export function ShortcutSheet({ groups, columns = 1, className }: { groups: ShortcutGroup[]; columns?: 1 | 2; className?: string }) {
  return (
    <div className={cn('grid gap-x-5 gap-y-3', columns === 2 && 'sm:grid-cols-2', className)}>
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
}

/** All shortcuts in a dialog. Pass `hotkey` to also toggle it with ? (ignored while typing in a field). */
export function ShortcutOverlay({ open, onOpenChange, groups, hotkey = false, className }:
  { open: boolean; onOpenChange: (v: boolean) => void; groups: ShortcutGroup[]; hotkey?: boolean; className?: string }) {
  useHotkey('?', () => onOpenChange(!open), { enabled: hotkey, ignoreEditable: true })
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title="Keyboard shortcuts" className={cn('!max-w-[640px]', className)}
      footer={<Button size="sm" onClick={() => onOpenChange(false)} data-autofocus>Close</Button>}>
      <ShortcutSheet groups={groups} columns={2} className="mt-2" />
    </Dialog>
  )
}

