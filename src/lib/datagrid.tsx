import { useEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent as RKeyboardEvent, type ReactNode } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { Button, Icon, LOCALE, clamp, ScrollEdges, TOUCH, cn, fmtDate, spring, surface, useControllable, usePointerDrag, useScrollEdges, useWidth } from './core'
import { SegmentedControl, Select, inputShellClass } from './forms'
import { useToast } from './feedback'
import { useDragSort } from './layout'

/* ════════════════════════════════════════════════════════════════════════════
 * DATA GRID: filter builder (Bricks / Text / Blocks), ripgrep-style search, group by,
 * sort, resizable columns, range selection with bulk actions, inline edit.
 * ══════════════════════════════════════════════════════════════════════════ */

export type GridColumn<T> = {
  key: keyof T & string; label: string; /** px */ width?: number
  /** number: numeric filter operators, right aligned. date/text: text operators on the displayed text */ type?: 'text' | 'number' | 'date'
  /** fixed set of values: filters offer a picker and the text query validates against it */ options?: string[]
  /** displayed (and searched) text; defaults to the value, dates as "12 Mar 2025" */ text?: (row: T) => string
  /** custom cell, e.g. a badge. `content` is the text with search matches highlighted */ render?: (row: T, content: ReactNode) => ReactNode
  /** double-click to edit (default: text and number columns without options) */ editable?: boolean
}
export type GridCondition = { id: string; f: [field: string, op: string, value: string] }
export type GridGroup = { id: string; j: 'AND' | 'OR'; c: GridFilterNode[] }
export type GridFilterNode = GridCondition | GridGroup

const GRID_OPS = { text: ['is', 'is not', 'contains'], number: ['>', '<', '=', '≥', '≤'] }
let gridSeq = 0
const gridId = () => `gf${++gridSeq}`
const gridIsGroup = (n: GridFilterNode): n is GridGroup => 'c' in n
/** Build a filter tree: gridFilter('AND', ['status', 'is', 'Active'], ['mrr', '>', '500']) */
export const gridFilter = (j: 'AND' | 'OR', ...c: ([string, string, string] | GridGroup)[]): GridGroup =>
  ({ id: gridId(), j, c: c.map(x => Array.isArray(x) ? { id: gridId(), f: x } : x) })

/* ---- tree helpers ---- */
function gridRemove(g: GridGroup, id: string): [GridGroup, GridFilterNode | null] {
  let found: GridFilterNode | null = null
  const c: GridFilterNode[] = []
  for (const n of g.c) {
    if (n.id === id) { found = n; continue }
    if (gridIsGroup(n)) { const [nn, f] = gridRemove(n, id); if (f) found = f; c.push(nn) } else c.push(n)
  }
  return [found ? { ...g, c } : g, found]
}
function gridInsert(g: GridGroup, into: string, index: number, node: GridFilterNode): GridGroup {
  if (g.id === into) return { ...g, c: [...g.c.slice(0, index), node, ...g.c.slice(index)] }
  return { ...g, c: g.c.map(n => gridIsGroup(n) ? gridInsert(n, into, index, node) : n) }
}
function gridUpdate(g: GridGroup, id: string, fn: (n: GridFilterNode) => GridFilterNode): GridGroup {
  if (g.id === id) return fn(g) as GridGroup
  return { ...g, c: g.c.map(n => n.id === id ? fn(n) : gridIsGroup(n) ? gridUpdate(n, id, fn) : n) }
}
const gridContains = (n: GridFilterNode, id: string): boolean => n.id === id || (gridIsGroup(n) && n.c.some(x => gridContains(x, id)))
const gridConds = (n: GridFilterNode): GridCondition[] => gridIsGroup(n) ? n.c.flatMap(gridConds) : [n]

/* ---- ripgrep-style search ---- */
type GridRg = { re: RegExp | null; err: string }
function gridCompileRg(raw: string, flags: { cs: boolean; w: boolean; rx: boolean }): GridRg {
  let q = raw.trim().replace(/^rg\s+/, ''), i: boolean | null = null, w = flags.w, F = !flags.rx, m: RegExpMatchArray | null
  while ((m = q.match(/^-(i|s|w|F)\s+/))) { if (m[1] === 'i') i = true; if (m[1] === 's') i = false; if (m[1] === 'w') w = true; if (m[1] === 'F') F = true; q = q.slice(m[0].length) }
  q = q.replace(/^"(.*)"$|^'(.*)'$/, (_, a, b) => a ?? b)
  if (!q) return { re: null, err: '' }
  const ignore = i ?? (flags.cs ? false : q === q.toLowerCase()) // smart case, like rg -S
  let src = F ? q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') : q
  if (w) src = `\\b(?:${src})\\b`
  try { return { re: new RegExp(src, 'g' + (ignore ? 'i' : '')), err: '' } } catch (e) { return { re: null, err: String((e as Error).message).replace(/^Invalid regular expression: (\/.*\/\w*: )?/, '') } }
}
function gridMark(text: string, re: RegExp | null): ReactNode {
  if (!re || !text) return text
  const out: ReactNode[] = []; let last = 0, k = 0
  re.lastIndex = 0
  for (const m of text.matchAll(re)) {
    if (!m[0]) continue
    const at = m.index ?? 0
    if (at > last) out.push(text.slice(last, at))
    out.push(<mark key={k++} className="rounded-[2px] bg-[color-mix(in_srgb,var(--warn)_35%,transparent)] px-px text-inherit">{m[0]}</mark>)
    last = at + m[0].length
  }
  if (!out.length) return text
  if (last < text.length) out.push(text.slice(last))
  return out
}

/* ---- text query: serialise, parse, highlight ---- */
type GridSchema = { label: Record<string, string>; field: Record<string, string>; kind: (k: string) => 'text' | 'number'; options: (k: string) => string[] | undefined }
const gridQv = (v: string) => /^[\w.-]+$/.test(v) ? v : `"${v}"`
function gridSerialise(n: GridFilterNode, s: GridSchema, top = true): string {
  if (!gridIsGroup(n)) { const l = s.label[n.f[0]]; return `${/\s/.test(l) ? n.f[0] : l.toLowerCase()} ${n.f[1]} ${gridQv(n.f[2])}` }
  const inner = n.c.map(x => gridSerialise(x, s, false)).join(` ${n.j} `)
  return top || n.c.length < 2 ? inner : `(${inner})`
}
function gridParse(q: string, s: GridSchema): GridGroup {
  const toks = q.match(/"[^"]*"|>=|<=|≥|≤|[<>=()]|[^\s"<>=()]+/g) || []
  let i = 0
  const cond = (): GridCondition => {
    const f = s.field[(toks[i] || '').toLowerCase()]
    if (!f) throw new Error(`Unknown field “${toks[i] || '…'}”`)
    let op = toks[i + 1]
    if (op && op.toLowerCase() === 'is' && (toks[i + 2] || '').toLowerCase() === 'not') { op = 'is not'; i++ }
    op = ({ '>=': '≥', '<=': '≤' } as Record<string, string>)[op] || (op || '').toLowerCase()
    const ops = GRID_OPS[s.kind(f)]
    if (!ops.includes(op)) throw new Error(`“${toks[i + 1] || '…'}” isn’t an operator for ${s.label[f]} (try ${ops.join(', ')})`)
    const raw = toks[i + 2]
    if (raw === undefined || raw === ')') throw new Error(`Missing value for ${s.label[f]}`)
    let v = raw.replace(/^"|"$/g, '')
    const opts = s.options(f)
    if (opts) { const m = opts.find(x => x.toLowerCase() === v.toLowerCase()); if (!m && op !== 'contains') throw new Error(`${s.label[f]} is one of ${opts.join(', ')}`); v = m || v }
    i += 3
    return { id: gridId(), f: [f, op, v] }
  }
  const term = (): GridFilterNode => {
    if (toks[i] === '(') { i++; const g = group(); if (toks[i] !== ')') throw new Error('Missing closing bracket'); i++; return g }
    return cond()
  }
  const group = (): GridGroup => {
    const g: GridGroup = { id: gridId(), j: 'AND', c: [term()] }; let j: string | null = null
    while (i < toks.length && toks[i] !== ')') {
      const c = toks[i].toUpperCase()
      if (c !== 'AND' && c !== 'OR') throw new Error(`Expected AND or OR, got “${toks[i]}”`)
      if (j && j !== c) throw new Error('Mixing AND and OR at one level: wrap one side in brackets')
      j = c; i++
      if (i >= toks.length) throw new Error('Condition missing after ' + c)
      g.c.push(term())
    }
    g.j = (j ?? 'AND') as 'AND' | 'OR'
    return g
  }
  const t = group()
  if (i < toks.length) throw new Error('Unexpected “)”')
  return t
}
function gridHighlight(q: string, s: GridSchema): ReactNode {
  return q.split(/("[^"]*"|\s+|>=|<=|≥|≤|[<>=()])/).map((t, k) => {
    const l = t.toLowerCase()
    if (!t || /^\s+$/.test(t)) return t
    if (s.field[l]) return <span key={k} className="font-semibold text-[var(--accent)]">{t}</span>
    if (l === 'and' || l === 'or') return <span key={k} className="font-semibold text-[var(--c3)]">{t}</span>
    if (['is', 'not', 'contains', '>', '<', '=', '>=', '<=', '≥', '≤', '(', ')'].includes(l)) return <span key={k} className="text-[var(--fg2)]">{t}</span>
    return <span key={k} className="text-[color-mix(in_srgb,var(--ok)_80%,var(--fg))]">{t}</span>
  })
}

/* ---- library Select (keyboard, type-ahead) restyled for chips, blocks and the toolbar ---- */
const GRID_PICK = {
  chip: 'flex h-full min-w-0 shrink [@media(pointer:coarse)]:[&>button]:text-[13px] [&>button]:h-full [&>button]:w-auto [&>button]:min-w-0 [&>button]:max-w-[180px] [&>button]:gap-1 [&>button]:rounded-none [&>button]:border-y-0 [&>button]:border-l-0 [&>button]:bg-transparent [&>button]:px-2 [&>button]:text-xs [&>button]:text-[var(--fg)]',
  block: '[@media(pointer:coarse)]:[&>button]:h-8 [@media(pointer:coarse)]:[&>button]:text-[13px] [&>button]:h-6 [&>button]:w-auto [&>button]:gap-1 [&>button]:rounded-xl [&>button]:border-0 [&>button]:bg-white [&>button]:px-2 [&>button]:text-xs [&>button]:font-semibold [&>button]:text-[#18181B] [&>button_svg]:text-[#71717A] [&>div]:text-[var(--fg)] [&>div]:font-normal',
  toolbar: '[@media(pointer:coarse)]:[&>button]:h-9 [@media(pointer:coarse)]:[&>button]:text-[13px] [&>button]:h-7 [&>button]:w-auto [&>button]:min-w-[110px] [&>button]:px-2 [&>button]:text-xs [&>button]:text-[var(--fg)]',
} as const
function GridPick({ value, options, onChange, label, variant, className }:
  { value: string; options: [string, string][]; onChange: (v: string) => void; label: string; variant: keyof typeof GRID_PICK; className?: string }) {
  return <Select aria-label={label} value={value} options={options.map(([v, l]) => ({ value: v, label: l }))} onChange={onChange} className={cn(GRID_PICK[variant], className)} />
}

/** One shared filter model, edited three ways (Bricks chips, a Text query, nested Blocks). */
function GridFilterBuilder({ tree, onChange, schema, fields, defaultField, count }:
  { tree: GridGroup; onChange: (t: GridGroup) => void; schema: GridSchema; fields: [string, string][]; defaultField: string; count: ReactNode }) {
  const [mode, setMode] = useState<'bricks' | 'text' | 'blocks'>('bricks')
  const [qText, setQText] = useState('')
  const [qErr, setQErr] = useState<string | null>(null)
  const [focusNew, setFocusNew] = useState<string | null>(null)
  const ref = useRef(tree); ref.current = tree
  const set = (t: GridGroup) => { ref.current = t; onChange(t) }
  const newCond = (field = defaultField): GridCondition => ({ id: gridId(), f: [field, GRID_OPS[schema.kind(field)][schema.kind(field) === 'number' ? 0 : 2], schema.options(field)?.[0] ?? ''] })
  const setField = (id: string, i: 0 | 1 | 2, v: string) => set(gridUpdate(ref.current, id, n => {
    if (gridIsGroup(n)) return n
    if (i === 0) return { ...n, f: [v, GRID_OPS[schema.kind(v)][0], schema.options(v)?.[0] ?? ''] }
    const f = [...n.f] as GridCondition['f']; f[i] = v; return { ...n, f }
  }))
  const remove = (id: string) => set(gridRemove(ref.current, id)[0])
  const flat = tree.c.every(n => !gridIsGroup(n))
  const switchMode = (m: string) => { if (m === 'text') { setQText(gridSerialise(ref.current, schema)); setQErr(null) } setMode(m as typeof mode) }
  const applyText = (q: string) => {
    setQText(q)
    if (!q.trim()) { set({ ...ref.current, c: [] }); setQErr(null); return }
    try { const t = gridParse(q, schema); set({ ...t, id: ref.current.id }); setQErr(null) } catch (e) { setQErr((e as Error).message) }
  }

  const condFields = (n: GridCondition, variant: 'chip' | 'block') => {
    const [k, op, v] = n.f, opts = schema.options(k)
    const sel = variant === 'chip' ? 'h-full min-w-0 shrink border-0 border-r border-[var(--line)] bg-transparent px-2 text-xs text-[var(--fg)]' : 'h-6 rounded-xl border-0 bg-white px-2 text-xs font-semibold text-[#18181B]'
    return (
      <>
        <GridPick label="Field" variant={variant} value={k} options={fields} onChange={x => setField(n.id, 0, x)} className={variant === 'chip' ? '[&>button]:font-semibold' : undefined} />
        <GridPick label="Operator" variant={variant} value={op} options={GRID_OPS[schema.kind(k)].map(o => [o, o])} onChange={x => setField(n.id, 1, x)} />
        {opts && op !== 'contains'
          ? <GridPick label="Value" variant={variant} value={v} options={opts.map(o => [o, o])} onChange={x => setField(n.id, 2, x)} />
          : <input aria-label="Value" value={v} placeholder="value" size={variant === 'block' ? 6 : undefined} autoFocus={focusNew === n.id}
            onFocus={() => focusNew === n.id && setFocusNew(null)} onChange={e => setField(n.id, 2, e.target.value)}
            className={cn(sel, '[@media(pointer:coarse)]:text-base', variant === 'chip' ? 'w-[90px] min-w-[48px] outline-none' : 'outline-none focus:shadow-[0_0_0_2px_rgba(255,255,255,.6)] [@media(pointer:coarse)]:h-8')} />}
      </>
    )
  }

  /* Bricks */
  const bricks = () => flat ? (
    <>
      <AnimatePresence initial={false} mode="popLayout">
        {tree.c.map((n, i) => (
          <motion.span key={n.id} layout initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.9, transition: { duration: 0.12 } }} transition={spring(0.4, 0.3)} className="inline-flex min-w-0 max-w-full items-center gap-1.5">
            {i === 0 ? <span className="px-1 text-xs text-[var(--fg3)]">Where</span>
              : <button onClick={() => set({ ...ref.current, j: ref.current.j === 'AND' ? 'OR' : 'AND' })} aria-label={`Join: ${tree.j}. Click to switch`}
                className="h-7 cursor-pointer rounded-[7px] border border-[var(--line)] bg-[var(--card)] px-2 font-[family-name:var(--mono)] text-[11px] font-semibold text-[var(--fg2)] hover:text-[var(--fg)] [@media(pointer:coarse)]:h-9 [@media(pointer:coarse)]:min-w-11">{tree.j}</button>}
            <span className="inline-flex h-7 min-w-0 max-w-full items-stretch rounded-[7px] border border-[var(--line)] bg-[var(--card)] text-xs [@media(pointer:coarse)]:h-9">
              {condFields(n as GridCondition, 'chip')}
              <button onClick={() => remove(n.id)} aria-label="Remove filter" className="grid cursor-pointer place-items-center border-0 bg-transparent px-2 text-[var(--fg3)] hover:text-[var(--bad)] [@media(pointer:coarse)]:min-w-9"><Icon name="x" size={12} strokeWidth={2.4} /></button>
            </span>
          </motion.span>
        ))}
      </AnimatePresence>
      <button onClick={() => { const c = newCond(); setFocusNew(c.id); set({ ...ref.current, c: [...ref.current.c, c] }) }}
        className="h-7 cursor-pointer rounded-[7px] border border-dashed border-[var(--line2)] bg-transparent px-2.5 text-xs font-medium text-[var(--fg2)] hover:border-[var(--fg3)] hover:text-[var(--fg)] [@media(pointer:coarse)]:h-9 [@media(pointer:coarse)]:px-3.5">+ Filter</button>
    </>
  ) : (
    <>
      <span className="px-1.5 text-xs text-[var(--fg3)]">This filter uses nested groups: <b className="font-[family-name:var(--mono)] font-medium text-[var(--fg)]">{gridSerialise(tree, schema)}</b></span>
      <Button size="sm" onClick={() => switchMode('blocks')} className={TOUCH.tap36}>Edit in Blocks</Button>
      <Button size="sm" variant="ghost" onClick={() => set({ ...ref.current, j: 'AND', c: gridConds(ref.current) })} className={TOUCH.tap36}>Flatten</Button>
    </>
  )

  /* Text */
  const mirror = useRef<HTMLDivElement>(null)
  const text = () => (
    <div className="flex w-full flex-col gap-1">
      <div className={cn(inputShellClass(!!qErr), 'relative h-[30px] w-full min-w-[240px] !rounded-[7px] [@media(pointer:coarse)]:h-10')}>
        <div ref={mirror} aria-hidden className={cn('pointer-events-none absolute inset-0 overflow-hidden px-2.5 font-[family-name:var(--mono)] text-[12.5px] leading-[28px] whitespace-pre text-[var(--fg)] [@media(pointer:coarse)]:leading-[38px]', TOUCH.input)}>{gridHighlight(qText, schema)} </div>
        <input value={qText} autoFocus spellCheck={false} autoComplete="off" aria-label="Filter query" aria-invalid={!!qErr || undefined}
          onChange={e => { applyText(e.target.value); if (mirror.current) mirror.current.scrollLeft = e.target.scrollLeft }}
          onScroll={e => { if (mirror.current) mirror.current.scrollLeft = e.currentTarget.scrollLeft }}
          onKeyUp={e => { if (mirror.current) mirror.current.scrollLeft = e.currentTarget.scrollLeft }}
          className={cn('absolute inset-0 w-full border-0 bg-transparent px-2.5 font-[family-name:var(--mono)] text-[12.5px] leading-[28px] whitespace-pre text-transparent caret-[var(--fg)] [@media(pointer:coarse)]:leading-[38px] outline-none selection:bg-[color-mix(in_srgb,var(--accent)_30%,transparent)]', TOUCH.input)} />
      </div>
      <div className="flex flex-wrap items-center gap-1 px-0.5 pt-0.5">
        <span role="status" className={cn('text-xs', qErr ? 'text-[var(--bad)]' : qText.trim() ? 'text-[var(--ok)]' : 'text-[var(--fg3)]')}>
          {qErr ?? (qText.trim() ? '✓ Valid query' : 'No filter · showing everything')}
        </span>
        <span className="flex-1" />
        {fields.map(([k, l]) => (
          <button key={k} onClick={e => {
            const v = qText.trimEnd(), next = (v ? v + (/\b(and|or)$/i.test(v) ? ' ' : ' and ') : '') + (/\s/.test(l) ? k : l.toLowerCase()) + ' '
            applyText(next); const inp = (e.currentTarget.closest('[data-fb]') as HTMLElement).querySelector('input'); inp?.focus(); inp?.setSelectionRange(next.length, next.length)
          }} className={cn('cursor-pointer rounded-[5px] border border-[var(--line)] bg-[var(--card)] px-1.5 py-0.5 font-[family-name:var(--mono)] text-[11px] text-[var(--fg2)] hover:border-[var(--accent)] hover:text-[var(--accent)] [@media(pointer:coarse)]:px-2 [@media(pointer:coarse)]:text-xs', TOUCH.tap)}>{l.toLowerCase()}</button>
        ))}
      </div>
    </div>
  )

  /* Blocks */
  const sort = useDragSort({
    canDrop: (id, list) => { const [, n] = gridRemove(ref.current, id); return !!n && !gridContains(n, list) },
    onMove: (id, list, index) => { const [t, n] = gridRemove(ref.current, id); if (n) set(gridInsert(t, list, index, n)) },
  })
  const BC: Record<string, string> = { cond: 'var(--accent)', AND: 'var(--c3)', OR: 'var(--c4)' }
  const blockBase = 'relative mb-2 rounded-lg text-xs font-semibold text-white bg-[color-mix(in_srgb,var(--bc)_90%,#000)] shadow-[0_2px_0_color-mix(in_srgb,var(--bc)_60%,#000)]'
  const grip = (id: string) => <span {...sort.handleProps(id)} aria-label="Drag block" role="img" className={cn('cursor-grab touch-none px-0.5 text-[13px] opacity-75 select-none hover:opacity-100 [@media(pointer:coarse)]:-my-1 [@media(pointer:coarse)]:grid [@media(pointer:coarse)]:h-8 [@media(pointer:coarse)]:w-7 [@media(pointer:coarse)]:place-items-center', TOUCH.input)}>⠿</span>
  const x = (id: string, what: string) => <button onClick={() => remove(id)} aria-label={`Remove ${what}`} className="ml-0.5 grid h-5 w-5 flex-none cursor-pointer place-items-center rounded-full border-0 bg-black/15 text-white hover:bg-black/30 [@media(pointer:coarse)]:h-8 [@media(pointer:coarse)]:w-8"><Icon name="x" size={10} strokeWidth={3} /></button>
  const block = (n: GridFilterNode, root = false): ReactNode => {
    const ghost = sort.dragging === n.id && 'opacity-40 !shadow-none outline-[1.5px] outline-dashed outline-[var(--line2)]'
    if (!gridIsGroup(n)) return (
      <motion.div key={n.id} layout="position" transition={spring(0.2, 0.35)} {...sort.itemProps(n.id)} style={{ '--bc': BC.cond } as CSSProperties}
        initial={{ opacity: 0, y: -6, scale: 0.96 }} animate={{ opacity: 1, y: 0, scale: 1 }}
        className={cn(blockBase, 'flex w-max max-w-full flex-wrap items-center gap-1.5 py-[7px] pr-2 pl-1.5 before:absolute before:top-0 before:left-[18px] before:h-1 before:w-4 before:rounded-b before:bg-black/15 after:absolute after:-bottom-1.5 after:left-[18px] after:h-1.5 after:w-4 after:rounded-b after:bg-[color-mix(in_srgb,var(--bc)_90%,#000)]', ghost)}>
        {grip(n.id)}<span className="opacity-90">where</span>{condFields(n, 'block')}{x(n.id, 'block')}
      </motion.div>
    )
    return (
      <motion.div key={n.id} layout={root ? false : 'position'} transition={spring(0.2, 0.35)} {...(root ? {} : sort.itemProps(n.id))} style={{ '--bc': BC[n.j] } as CSSProperties}
        initial={root ? false : { opacity: 0, y: -6, scale: 0.96 }} animate={{ opacity: 1, y: 0, scale: 1 }} className={cn(blockBase, 'w-full', root && '!mb-0', ghost)}>
        <div className="flex flex-wrap items-center gap-1.5 px-2 py-[7px]">

          {root ? <span className="opacity-90">Show rows where</span> : grip(n.id)}
          <motion.button key={n.j} initial={{ scale: 0.85 }} animate={{ scale: 1 }} transition={spring(0.5, 0.3)} aria-label={`Match ${n.j === 'AND' ? 'all' : 'any'}. Click to switch`}
            onClick={() => set(gridUpdate(ref.current, n.id, g => ({ ...g, j: (g as GridGroup).j === 'AND' ? 'OR' : 'AND' })))}
            className="h-[22px] cursor-pointer rounded-xl border-0 bg-white/95 px-2.5 text-xs font-bold text-[#18181B] [@media(pointer:coarse)]:h-8 [@media(pointer:coarse)]:min-w-11 [@media(pointer:coarse)]:text-[13px]">{n.j === 'AND' ? 'all' : 'any'}</motion.button>
          <span className="opacity-90">of these are true</span>
          {!root && <span className="ml-auto">{x(n.id, 'group')}</span>}
        </div>
        <div {...sort.listProps(n.id)} className="ml-3.5 min-h-[38px] rounded-l-md bg-[var(--card)] px-2 pt-2 pb-0.5">
          {n.c.length ? n.c.map(k => block(k)) : <div className="px-0.5 pt-1 pb-2.5 font-medium text-[var(--fg3)]">Drop blocks here</div>}
        </div>
        <div className="h-3" />
      </motion.div>
    )
  }
  const addBlock = (kind: 'cond' | 'AND' | 'OR') => {
    const n: GridFilterNode = kind === 'cond' ? newCond() : { id: gridId(), j: kind, c: [{ id: gridId(), f: [fields.find(([k]) => schema.options(k))?.[0] ?? defaultField, 'is', ''] }] }
    if (gridIsGroup(n)) { const c = n.c[0] as GridCondition; c.f[2] = schema.options(c.f[0])?.[0] ?? '' }
    if (!gridIsGroup(n)) setFocusNew(n.id)
    set({ ...ref.current, c: [...ref.current.c, n] })
  }
  const blocks = () => (
    <div className="mt-1.5 grid w-full grid-cols-[minmax(0,1fr)] gap-3 md:grid-cols-[170px_minmax(0,1fr)]">
      <div className="flex flex-wrap gap-1.5 md:flex-col">
        <span className="text-xs text-[var(--fg3)]">Add a block</span>
        {([['cond', 'where … is …'], ['AND', 'all of'], ['OR', 'any of']] as const).map(([k, l]) => (
          <button key={k} onClick={() => addBlock(k)} style={{ '--bc': BC[k] } as CSSProperties}
            className="cursor-pointer rounded-[7px] border-0 bg-[color-mix(in_srgb,var(--bc)_90%,#000)] px-2.5 py-2 text-left text-xs font-semibold [@media(pointer:coarse)]:min-h-9 text-white shadow-[0_2px_0_color-mix(in_srgb,var(--bc)_60%,#000)] hover:brightness-110 active:translate-y-px">{l}</button>
        ))}
        <span className="mt-1.5 text-xs text-[var(--fg3)]">Drag ⠿ to reorder or drop a block inside a group to nest it. Text and Bricks stay in sync.</span>
      </div>
      <div className={cn(surface.dashed, 'min-h-[120px] bg-[var(--card)] p-2.5')}>{block(tree, true)}</div>
    </div>
  )

  return (
    <div data-fb className="flex flex-wrap items-center gap-1.5 rounded-t-[var(--r-md)] border border-b-0 border-[var(--line)] bg-[color-mix(in_srgb,var(--muted)_40%,var(--card))] p-2">
      <SegmentedControl size="sm" value={mode} onChange={switchMode} className="mr-1 [@media(pointer:coarse)]:[&>button]:h-9" options={[{ value: 'bricks', label: 'Bricks' }, { value: 'text', label: 'Text' }, { value: 'blocks', label: 'Blocks' }]} />
      <span className="order-last ml-auto pr-1 text-xs text-[var(--fg3)] md:order-none md:hidden">{count}</span>
      <motion.div key={mode} initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.2 }}
        className={cn('flex min-w-0 flex-wrap items-center gap-1.5', mode === 'blocks' ? 'order-last basis-full' : mode === 'text' ? 'w-full md:w-auto md:flex-1' : 'flex-1 basis-[300px]')}>
        {mode === 'bricks' ? bricks() : mode === 'text' ? text() : blocks()}
      </motion.div>
      <span className={cn('hidden pr-1 text-xs whitespace-nowrap text-[var(--fg3)] md:inline', mode === 'text' && 'self-start pt-1.5', mode === 'blocks' && 'ml-auto')}>{count}</span>
    </div>
  )
}

const gridCmp = (x: unknown, y: unknown) =>
  (typeof x === 'number' && typeof y === 'number') || (x instanceof Date && y instanceof Date) ? Number(x) - Number(y) : String(x).localeCompare(String(y))

/**
 * Data grid for a few hundred rows, generic over the row type. Filter with Bricks (chips joined by AND/OR), a
 * Text query (`status is active and mrr > 500`, with highlighting and parse errors) or Scratch-style Blocks with
 * nested groups (drag ⠿) — all three edit one filter. Search every cell ripgrep-style (regex, smart case, whole
 * word, literal; `-i -w -F` flags work too) with highlighted hits. Group by a column with collapsible groups,
 * counts and totals. Click headers to sort, drag their edge to resize, shift-click checkboxes for ranges, then
 * Export or Delete (with Undo). Double-click a cell to edit; Enter saves, Escape cancels.
 */
export function DataGrid<T extends object>({ columns, rows, defaultRows = [], onRowsChange, rowKey, defaultFilter, defaultSort, groupable, groupSummary, rowLabel, onExport, maxHeight = 420, 'aria-label': ariaLabel = 'Rows', className }:
  { columns: GridColumn<T>[]; rows?: T[]; defaultRows?: T[]; onRowsChange?: (rows: T[]) => void; rowKey: (r: T) => string | number
    defaultFilter?: GridGroup; defaultSort?: { key: keyof T & string; dir: 1 | -1 }; /** columns offered in Group by */ groupable?: (keyof T & string)[]
    /** totals shown on each group row (default: sums of the number columns) */ groupSummary?: (rows: T[]) => ReactNode
    /** used in checkbox labels */ rowLabel?: (r: T) => string; onExport?: (rows: T[]) => void; maxHeight?: number; 'aria-label'?: string; className?: string }) {
  const [data, setData] = useControllable(rows, defaultRows, onRowsChange)
  const dataRef = useRef(data); dataRef.current = data
  const commit = (next: T[]) => { dataRef.current = next; setData(next) }
  const toast = useToast()
  const [filter, setFilter] = useState<GridGroup>(() => defaultFilter ?? gridFilter('AND'))
  const [sort, setSort] = useState(defaultSort ?? null)
  const [q, setQ] = useState('')
  const [flags, setFlags] = useState({ cs: false, w: false, rx: true })
  const [groupBy, setGroupBy] = useState('')
  const [closed, setClosed] = useState<Set<string>>(new Set())
  const [sel, setSel] = useState<Set<string | number>>(new Set())
  const last = useRef<string | number | null>(null)
  const [widths, setWidths] = useState<Record<string, number>>(() => Object.fromEntries(columns.map(c => [c.key, c.width ?? 120])))
  const [resizing, setResizing] = useState<string | null>(null)
  const [edit, setEditState] = useState<{ id: string | number; key: string } | null>(null)
  const editRef = useRef(edit)
  const setEdit = (e: typeof edit) => { editRef.current = e; setEditState(e) }
  const [flash, setFlash] = useState<{ id: string | number; key: string; n: number } | null>(null)
  /* touch: tap a cell to select it, tap again (or its pencil) to edit; mouse keeps double-click */
  const [active, setActive] = useState<{ id: string | number; key: string } | null>(null)
  /* keyboard: one roving Tab stop among the cells; arrows move it, Enter or F2 edits, Space selects the row */
  const [cursor, setCursor] = useState<{ id: string | number; key: string } | null>(null)
  const tableRef = useRef<HTMLTableElement>(null)
  const ptr = useRef('mouse')
  const [scroller, edges] = useScrollEdges<HTMLDivElement>()
  const [gridBox, gridW] = useWidth<HTMLDivElement>()
  const narrow = gridW > 0 && gridW < 520

  const col = (k: string) => columns.find(c => c.key === k)
  const kind = (k: string): 'text' | 'number' => col(k)?.type === 'number' ? 'number' : 'text'
  const schema: GridSchema = useMemo(() => ({
    label: Object.fromEntries(columns.map(c => [c.key, c.label])),
    field: Object.fromEntries(columns.flatMap(c => [[c.key.toLowerCase(), c.key], [c.label.toLowerCase(), c.key]])),
    kind: (k: string) => columns.find(c => c.key === k)?.type === 'number' ? 'number' : 'text',
    options: (k: string) => columns.find(c => c.key === k)?.options,
  }), [columns])
  const cellText = (r: T, c: GridColumn<T>) => { if (c.text) return c.text(r); const v = r[c.key]; return v instanceof Date ? fmtDate(v) : String(v ?? '') }
  const test = (r: T, [k, op, v]: GridCondition['f']) => {
    const c = col(k); if (!c || v === '' || v == null) return true
    if (kind(k) === 'number') { const x = Number(r[c.key]), n = Number(v); if (Number.isNaN(n)) return true; return ({ '>': x > n, '<': x < n, '=': x === n, '≥': x >= n, '≤': x <= n } as Record<string, boolean>)[op] ?? true }
    const a = cellText(r, c).toLowerCase(), b = v.toLowerCase()
    return op === 'is' ? a === b : op === 'is not' ? a !== b : a.includes(b)
  }
  const evalNode = (n: GridFilterNode, r: T): boolean => !gridIsGroup(n) ? test(r, n.f) : !n.c.length || (n.j === 'AND' ? n.c.every(x => evalNode(x, r)) : n.c.some(x => evalNode(x, r)))
  const rg = useMemo(() => gridCompileRg(q, flags), [q, flags])
  const visible = useMemo(() => {
    const v = data.filter(r => evalNode(filter, r) && (!rg.re || columns.some(c => { rg.re!.lastIndex = 0; return rg.re!.test(cellText(r, c)) })))
    if (sort) v.sort((a, b) => gridCmp(a[sort.key], b[sort.key]) * sort.dir)
    return v
  }, [data, filter, rg, sort, columns]) // eslint-disable-line react-hooks/exhaustive-deps
  const hits = useMemo(() => rg.re ? visible.reduce((n, r) => n + columns.reduce((m, c) => { rg.re!.lastIndex = 0; return m + (cellText(r, c).match(rg.re!)?.length ?? 0) }, 0), 0) : 0, [visible, rg]) // eslint-disable-line react-hooks/exhaustive-deps
  const numCols = columns.filter(c => c.type === 'number')
  const groups = useMemo(() => {
    if (!groupBy) return null
    const m = new Map<string, T[]>()
    visible.forEach(r => { const c = col(groupBy)!, k = cellText(r, c); if (!m.has(k)) m.set(k, []); m.get(k)!.push(r) })
    const total = (rs: T[]) => numCols[0] ? rs.reduce((s, r) => s + Number(r[numCols[0].key]), 0) : rs.length
    return [...m.entries()].sort((a, b) => total(b[1]) - total(a[1]))
  }, [visible, groupBy]) // eslint-disable-line react-hooks/exhaustive-deps

  /* selection */
  const visIds = visible.map(rowKey)
  const allSel = visIds.length > 0 && visIds.every(id => sel.has(id)), someSel = visIds.some(id => sel.has(id))
  const headCb = useRef<HTMLInputElement>(null)
  useEffect(() => { if (headCb.current) headCb.current.indeterminate = someSel && !allSel })
  const toggleRow = (id: string | number, on: boolean, shift: boolean) => {
    const prev = last.current
    setSel(s => {
      const n = new Set(s)
      if (shift && prev != null && visIds.includes(prev)) {
        const [a, b] = [visIds.indexOf(prev), visIds.indexOf(id)].sort((x, y) => x - y)
        for (let i = a; i <= b; i++) { if (on) n.add(visIds[i]); else n.delete(visIds[i]) }
      } else if (on) n.add(id); else n.delete(id)
      return n
    })
    last.current = id
  }
  const setMany = (ids: (string | number)[], on: boolean) => setSel(s => { const n = new Set(s); ids.forEach(id => on ? n.add(id) : n.delete(id)); return n })
  const del = () => {
    const before = dataRef.current, removed = before.filter(r => sel.has(rowKey(r))), n = removed.length
    commit(before.filter(r => !sel.has(rowKey(r)))); setSel(new Set())
    const undo = () => {
      const cur = new Map(dataRef.current.map(r => [rowKey(r), r])), back = new Set(removed)
      const restored = before.flatMap(r => back.has(r) ? [r] : cur.has(rowKey(r)) ? [cur.get(rowKey(r))!] : [])
      const known = new Set(before.map(rowKey))
      commit([...restored, ...dataRef.current.filter(r => !known.has(rowKey(r)))])
    }
    toast({ title: `Deleted ${n} ${n === 1 ? 'row' : 'rows'}`, action: { label: 'Undo', onClick: undo } })
  }
  const exp = () => { const rs = data.filter(r => sel.has(rowKey(r))); if (onExport) onExport(rs); else toast({ title: `Exported ${rs.length} ${rs.length === 1 ? 'row' : 'rows'}`, description: 'CSV ready' }) }

  /* resize */
  const rz = useRef<{ k: string; w0: number } | null>(null)
  const resize = usePointerDrag({
    cursor: 'col-resize',
    onMove: p => { const r = rz.current; if (r) setWidths(w => ({ ...w, [r.k]: Math.max(60, r.w0 + p.dx) })) },
    onEnd: () => { rz.current = null; setResizing(null) },
  })
  const startResize = (e: React.PointerEvent<HTMLSpanElement>, k: string) => {
    if (e.button !== 0) return
    e.preventDefault(); e.stopPropagation()
    rz.current = { k, w0: widths[k] }; setResizing(k); resize.start(e)
  }

  /* edit */
  const canEdit = (c: GridColumn<T>) => c.editable ?? (c.type !== 'date' && !c.options)
  const save = (r: T, c: GridColumn<T>, raw: string) => {
    if (!editRef.current) return
    setEdit(null)
    const v = c.type === 'number' ? Math.max(0, Math.round(Number(raw)) || 0) : raw.trim() || r[c.key]
    if (v === r[c.key]) return
    const id = rowKey(r)
    commit(dataRef.current.map(x => rowKey(x) === id ? { ...x, [c.key]: v } as T : x))
    setFlash(f => ({ id, key: c.key, n: (f?.n ?? 0) + 1 }))
  }

  const td = 'h-[38px] overflow-hidden border-b border-[var(--line)] bg-[var(--card)] px-2.5 text-ellipsis whitespace-nowrap [@media(pointer:coarse)]:h-11'
  const sticky0 = 'sticky left-0 z-[1] w-10 px-0 text-center', sticky1 = 'sticky left-10 z-[1] shadow-[inset_-1px_0_0_var(--line)]'
  const cb = 'm-0 h-3.5 w-3.5 cursor-pointer accent-[var(--primary)] [@media(pointer:coarse)]:h-[18px] [@media(pointer:coarse)]:w-[18px]'
  /** the whole checkbox cell is the hit area (a finger-sized label around the small native box) */
  const cbWrap = 'mx-auto flex h-full min-h-9 w-full min-w-9 cursor-pointer items-center justify-center'
  const onCell = (r: T, c: GridColumn<T>) => {
    if (ptr.current === 'mouse' || !canEdit(c)) return
    const id = rowKey(r)
    if (active?.id === id && active.key === c.key) { setActive(null); setEdit({ id, key: c.key }) } else setActive({ id, key: c.key })
  }
  const rowOrder = groups ? groups.flatMap(([k, rs]) => closed.has(k) ? [] : rs.map(rowKey)) : visIds
  const tab = cursor && rowOrder.includes(cursor.id) && col(cursor.key) ? cursor : rowOrder.length ? { id: rowOrder[0], key: columns[0].key } : null
  const cellEl = (id: string | number, key: string) => tableRef.current?.querySelector<HTMLElement>(`[data-gr="${CSS.escape(String(id))}"][data-gk="${CSS.escape(key)}"]`)
  const focusCell = (id: string | number, key: string) => { setCursor({ id, key }); cellEl(id, key)?.focus({ preventScroll: false }) }
  const onCellKey = (e: RKeyboardEvent, r: T, c: GridColumn<T>) => {
    if (e.target !== e.currentTarget || e.nativeEvent.isComposing) return
    const id = rowKey(r), ri = rowOrder.indexOf(id), ci = columns.findIndex(x => x.key === c.key)
    const to = (rr: number, cc: number) => { e.preventDefault(); const nid = rowOrder[clamp(rr, 0, rowOrder.length - 1)], nk = columns[clamp(cc, 0, columns.length - 1)].key; focusCell(nid, nk) }
    switch (e.key) {
      case 'ArrowDown': return to(ri + 1, ci)
      case 'ArrowUp': return to(ri - 1, ci)
      case 'ArrowRight': return to(ri, ci + 1)
      case 'ArrowLeft': return to(ri, ci - 1)
      case 'Home': return to(e.ctrlKey || e.metaKey ? 0 : ri, 0)
      case 'End': return to(e.ctrlKey || e.metaKey ? rowOrder.length - 1 : ri, columns.length - 1)
      case 'PageDown': return to(ri + 10, ci)
      case 'PageUp': return to(ri - 10, ci)
      case 'Enter': case 'F2': if (canEdit(c)) { e.preventDefault(); setCursor({ id, key: c.key }); setEdit({ id, key: c.key }) } return
      case ' ': e.preventDefault(); toggleRow(id, !sel.has(id), e.shiftKey); return
    }
  }
  /** close the editor and put keyboard focus back on its cell */
  const closeEdit = (r: T, c: GridColumn<T>, value: string | null) => {
    const id = rowKey(r)
    if (value === null) setEdit(null); else save(r, c, value)
    cellEl(id, c.key)?.focus({ preventScroll: true })
  }
  const rowView = (r: T) => {
    const id = rowKey(r), on = sel.has(id)
    return (
      <motion.tr key={id} layout="position" transition={spring(0.12, 0.45)} className={cn('group/row', on && '[&>td]:!bg-[var(--accent-soft)]')}>
        <td className={cn(td, sticky0, 'group-hover/row:bg-[color-mix(in_srgb,var(--muted)_55%,var(--card))]')}>
          <label className={cbWrap}><input type="checkbox" className={cb} checked={on} aria-label={`Select ${rowLabel?.(r) ?? id}`} onChange={() => {}} onClick={e => toggleRow(id, e.currentTarget.checked, e.shiftKey)} /></label>
        </td>
        {columns.map((c, i) => {
          const editing = edit?.id === id && edit.key === c.key, text = cellText(r, c), content = gridMark(text, rg.re)
          const picked = !editing && active?.id === id && active.key === c.key
          return (
            <td key={c.key} data-gr={String(id)} data-gk={c.key} tabIndex={tab?.id === id && tab.key === c.key && !editing ? 0 : -1}
              onDoubleClick={() => canEdit(c) && setEdit({ id, key: c.key })} title={canEdit(c) ? 'Double-click or press Enter to edit' : undefined}
              onPointerDown={e => { ptr.current = e.pointerType }} onClick={() => onCell(r, c)} onFocus={e => { if (e.target === e.currentTarget) setCursor({ id, key: c.key }) }}
              onKeyDown={e => onCellKey(e, r, c)} aria-readonly={!canEdit(c) || undefined}
              className={cn(td, 'relative outline-none group-hover/row:bg-[color-mix(in_srgb,var(--muted)_55%,var(--card))] focus-visible:shadow-[inset_0_0_0_2px_var(--accent)]', i === 0 && sticky1, c.type === 'number' && 'text-right font-[family-name:var(--mono)] text-xs', editing && '!p-0 shadow-[inset_0_0_0_2px_var(--accent)]',
                picked && 'shadow-[inset_0_0_0_2px_color-mix(in_srgb,var(--accent)_55%,transparent)]', picked && (c.type === 'number' ? '!pl-10' : '!pr-10'))}>
              {editing
                ? <input autoFocus defaultValue={String(r[c.key] ?? '')} aria-label={`Edit ${c.label}`} onFocus={e => e.currentTarget.select()}
                  onKeyDown={e => {
                    if (e.nativeEvent.isComposing) return
                    if (e.key === 'Enter' || e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeEdit(r, c, e.key === 'Enter' ? e.currentTarget.value : null) }
                  }} onBlur={e => save(r, c, e.currentTarget.value)}
                  className={cn('h-full w-full border-0 bg-[var(--card)] px-2.5 text-[13px] text-[var(--fg)] outline-none [@media(pointer:coarse)]:!text-base', c.type === 'number' && 'text-right font-[family-name:var(--mono)] text-xs')} />
                : <>
                  {flash && flash.id === id && flash.key === c.key && (
                    <motion.span key={flash.n} aria-hidden className="pointer-events-none absolute inset-0 bg-[var(--accent-soft)]" initial={{ opacity: 1 }} animate={{ opacity: 0 }} transition={{ duration: 0.8 }} />
                  )}
                  <span className="relative">{c.render ? c.render(r, content) : content}</span>
                  {picked && (
                    <button aria-label={`Edit ${c.label}`} onClick={e => { e.stopPropagation(); setActive(null); setEdit({ id, key: c.key }) }}
                      className={cn('absolute top-1/2 grid h-8 w-8 -translate-y-1/2 cursor-pointer place-items-center rounded-[var(--r-md)] border-0 bg-[var(--accent-soft)] text-[var(--accent)]', c.type === 'number' ? 'left-1' : 'right-1')}>
                      <Icon name="edit" size={14} />
                    </button>
                  )}
                </>}
            </td>
          )
        })}
      </motion.tr>
    )
  }
  const defaultSummary = (rs: T[]) => numCols.map((c, i) => <span key={c.key}>{i > 0 && ' · '}{c.label} <b className="font-[family-name:var(--mono)] font-semibold text-[var(--fg2)]">{rs.reduce((s, r) => s + Number(r[c.key]), 0).toLocaleString(LOCALE)}</b></span>)
  const groupCol = groupBy ? col(groupBy) : undefined
  const fields: [string, string][] = columns.map(c => [c.key, c.label])
  const defaultField = (columns.find((c, i) => i > 0 && c.type !== 'number' && !c.options) ?? columns[0]).key
  const groupKeys = groups?.map(g => g[0]) ?? []
  const allClosed = groupKeys.length > 0 && groupKeys.every(k => closed.has(k))
  const rgToggle = (f: 'cs' | 'w' | 'rx', label: string, title: string) => (
    <button aria-pressed={flags[f]} title={title} onClick={() => setFlags(x => ({ ...x, [f]: !x[f] }))}
      className={cn('h-5 min-w-6 cursor-pointer rounded border-0 px-1 font-[family-name:var(--mono)] text-[11px] font-semibold [@media(pointer:coarse)]:h-8 [@media(pointer:coarse)]:min-w-8 [@media(pointer:coarse)]:text-xs', flags[f] ? 'bg-[var(--accent-soft)] text-[color-mix(in_srgb,var(--accent)_78%,var(--fg))]' : 'bg-transparent text-[var(--fg3)] hover:bg-[var(--muted)] hover:text-[var(--fg)]')}>{label}</button>
  )

  return (
    <div ref={gridBox} className={cn('flex min-w-0 flex-col', className)}>
      <GridFilterBuilder
 tree={filter} onChange={setFilter} schema={schema} fields={fields} defaultField={defaultField} count={`${visible.length} of ${data.length} rows`} />
      <div className="flex flex-wrap items-center gap-2 border-x border-[var(--line)] bg-[var(--card)] p-2">
        <div className={cn(inputShellClass(!!rg.err), 'flex h-7 min-w-[200px] flex-[0_1_380px] items-center pr-1 [@media(pointer:coarse)]:h-10', narrow && '!flex-[1_1_100%]')}>
          <span aria-hidden className="grid h-full place-items-center border-r border-[var(--line)] px-2 font-[family-name:var(--mono)] text-[11px] font-semibold text-[var(--fg3)]">rg</span>
          <input value={q} onChange={e => setQ(e.target.value)} onKeyDown={e => e.key === 'Escape' && setQ('')} placeholder="search every cell, regex ok: north|quill" spellCheck={false} autoComplete="off"
            aria-label="Search rows (ripgrep style)" aria-invalid={!!rg.err || undefined}
            className={cn('h-full min-w-0 flex-1 border-0 bg-transparent px-2 font-[family-name:var(--mono)] text-[12.5px] text-[var(--fg)] outline-none placeholder:text-[var(--fg3)]', TOUCH.input)} />
          {rgToggle('cs', 'Aa', 'Match case (otherwise smart case, like rg -S)')}{rgToggle('w', '\\b', 'Whole word (-w)')}{rgToggle('rx', '.*', 'Regular expression (off = literal, like -F)')}
        </div>
        <span className="text-xs text-[var(--fg3)]" aria-live="polite">
          {rg.err ? <span className="text-[var(--bad)]">{rg.err}</span> : rg.re ? `${hits} ${hits === 1 ? 'match' : 'matches'} in ${visible.length} ${visible.length === 1 ? 'row' : 'rows'}` : ''}
        </span>
        {groupable && groupable.length > 0 && (
          <span className={cn('ml-auto flex items-center gap-2 text-xs text-[var(--fg3)]', narrow && 'ml-0 w-full [&>div]:flex-1 [&>div>button]:!w-full')}>Group by
            <GridPick label="Group by" variant="toolbar" value={groupBy} onChange={v => { setGroupBy(v); setClosed(new Set()) }}
              options={[['', 'None'], ...groupable.map(k => [k, col(k)?.label ?? k] as [string, string])]} />
          </span>
        )}
        {groupBy && <Button size="sm" variant="ghost" onClick={() => setClosed(allClosed ? new Set() : new Set(groupKeys))} className={cn('[@media(pointer:coarse)]:!h-9', narrow && 'ml-auto')}>{allClosed ? 'Expand all' : 'Collapse all'}</Button>}
      </div>
      <div className="relative min-w-0">
      <div ref={scroller} className="relative overflow-auto overscroll-x-contain rounded-b-[var(--r-md)] border border-[var(--line)] bg-[var(--card)]" style={{ maxHeight }}>
        <table ref={tableRef} role="grid" aria-label={ariaLabel} className="min-w-full table-fixed border-separate border-spacing-0 text-[13px]">
          {/* on a phone the sticky first column is capped so the rest of the row has room to scroll past it */}
          <colgroup><col style={{ width: 40 }} />{columns.map((c, i) => <col key={c.key} style={{ width: i === 0 && narrow ? Math.min(widths[c.key], 120) : widths[c.key] }} />)}</colgroup>
          <thead>
            <tr>
              <th className={cn(td, sticky0, 'top-0 z-[3] bg-[color-mix(in_srgb,var(--muted)_50%,var(--card))]')}>
                <label className={cbWrap}><input ref={headCb} type="checkbox" className={cb} checked={allSel} aria-label="Select all" onChange={e => setMany(visIds, e.currentTarget.checked)} /></label>
              </th>
              {columns.map((c, i) => (
                <th key={c.key} aria-sort={sort?.key === c.key ? (sort.dir === 1 ? 'ascending' : 'descending') : undefined}
                  className={cn(td, 'sticky top-0 z-[2] cursor-pointer bg-[color-mix(in_srgb,var(--muted)_50%,var(--card))] text-xs font-medium text-[var(--fg2)] select-none hover:text-[var(--fg)]', i === 0 && 'left-10 z-[3] shadow-[inset_-1px_0_0_var(--line)]', c.type === 'number' ? 'text-right' : 'text-left')}>
                  <button onClick={() => setSort(s => ({ key: c.key, dir: s?.key === c.key ? (-s.dir as 1 | -1) : 1 }))}
                    className={cn('cursor-pointer border-0 bg-transparent p-0 font-[inherit] text-inherit [@media(pointer:coarse)]:text-left', TOUCH.tap36)}>{c.label}{sort?.key === c.key && <span className="ml-1 text-[11px] text-[var(--accent)]">{sort.dir > 0 ? '▲' : '▼'}</span>}</button>
                  <span role="separator" aria-orientation="vertical" aria-label={`Resize ${c.label}`} onPointerDown={e => startResize(e, c.key)}
                    className="group/rz absolute top-0 right-0 bottom-0 w-[7px] cursor-col-resize touch-none [@media(pointer:coarse)]:w-4">
                    <span className={cn('absolute top-[9px] right-[3px] bottom-[9px] w-px bg-[var(--line2)] group-hover/rz:w-0.5 group-hover/rz:bg-[var(--accent)]', resizing === c.key && '!w-0.5 !bg-[var(--accent)]')} />
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {!visible.length && <tr><td colSpan={columns.length + 1} className="p-10 text-center text-[var(--fg3)]">No rows match these filters</td></tr>}
            {groups ? groups.flatMap(([k, rs]) => {
              const open = !closed.has(k), ids = rs.map(rowKey), all = ids.every(id => sel.has(id))
              return [
                <tr key={`g:${k}`}>
                  <td className={cn(td, sticky0, '!h-9 !bg-[color-mix(in_srgb,var(--muted)_60%,var(--card))]')}>
                    <label className={cbWrap}><input type="checkbox" className={cb} checked={all} aria-label={`Select group ${k}`} onChange={e => setMany(ids, e.currentTarget.checked)} /></label>
                  </td>
                  <td colSpan={columns.length} className={cn(td, sticky1, '!h-9 overflow-visible !bg-[color-mix(in_srgb,var(--muted)_60%,var(--card))]')}>
                    <button aria-expanded={open} onClick={() => setClosed(s => { const n = new Set(s); if (n.has(k)) n.delete(k); else n.add(k); return n })}
                      className="inline-flex cursor-pointer items-center gap-2 border-0 bg-transparent p-0 text-[13px] font-medium text-[var(--fg)] [@media(pointer:coarse)]:min-h-9">
                      <motion.span className="grid text-[var(--fg3)]" initial={false} animate={{ rotate: open ? 90 : 0 }} transition={{ duration: 0.2 }}><Icon name="chevronRight" size={11} strokeWidth={2.5} /></motion.span>
                      {groupCol?.render ? groupCol.render(rs[0], k) : <b className="font-semibold">{k}</b>}
                      <span className="text-xs font-normal text-[var(--fg3)]">{rs.length} {rs.length === 1 ? 'row' : 'rows'}</span>
                    </button>
                    <span className="sticky left-full float-right pr-1 text-xs text-[var(--fg3)]">{(groupSummary ?? defaultSummary)(rs)}</span>
                  </td>
                </tr>,
                ...(open ? rs.map(rowView) : []),
              ]
            }) : visible.map(rowView)}
          </tbody>
        </table>
      </div>
      <ScrollEdges {...edges} hint="More columns" />
      </div>
      <AnimatePresence initial={false}>
        {sel.size > 0 && (
          <motion.div initial={{ height: 0, opacity: 0, marginTop: 0 }} animate={{ height: 'auto', opacity: 1, marginTop: 10 }} exit={{ height: 0, opacity: 0, marginTop: 0, transition: { duration: 0.18 } }} transition={spring(0.2, 0.35)}
            className="sticky bottom-2 z-[8] overflow-hidden rounded-[var(--r-md)] bg-[var(--primary)] text-[13px] text-[var(--on-primary)] shadow-[var(--shadow)]" role="region" aria-label="Selection">
            <div className="flex min-h-11 flex-wrap items-center gap-x-2 gap-y-1 py-1.5 pr-2 pl-3 [@media(pointer:coarse)]:min-h-[52px]">
            <span className="ui-num whitespace-nowrap">{sel.size} selected</span>
            <button onClick={() => setSel(new Set())} className="cursor-pointer border-0 bg-transparent px-1 text-xs underline-offset-2 opacity-70 hover:underline hover:opacity-100 [@media(pointer:coarse)]:min-h-9 [@media(pointer:coarse)]:px-2.5 [@media(pointer:coarse)]:text-[13px]">Clear</button>
            <span className="flex-1" />
            <Button size="sm" onClick={exp} className={cn('!border-[color-mix(in_srgb,var(--on-primary)_30%,transparent)] !bg-transparent !text-inherit hover:!bg-[color-mix(in_srgb,var(--on-primary)_12%,transparent)]', TOUCH.tap36)}>Export</Button>
            <Button size="sm" variant="danger" onClick={del} className={TOUCH.tap36}>Delete</Button>
            </div>

          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
