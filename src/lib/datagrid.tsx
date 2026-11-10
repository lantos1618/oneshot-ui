import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent as RKeyboardEvent, type ReactElement, type ReactNode } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { Button, Icon, IconButton, clamp, ScrollEdges, Skeleton, Spinner, TOUCH, cn, dateFormat, spring, surface, useCoarsePointer, useControllable, usePointerDrag, useScrollEdges, useWidth, plural, fmt, LOCALE } from './core'
import { Popover, PopoverContent, PopoverTrigger } from './overlay'
import { SegmentedControl, Select, inputShellClass } from './forms'
import { useToast } from './feedback'
import { useDragSort } from './layout'
import { useVirtual } from './virtual'

export type GridColumn<T> = {
  key: keyof T & string; label: string; /** px */ width?: number
  /** number: numeric filter operators, right aligned. date/text: text operators on the displayed text */ type?: 'text' | 'number' | 'date'
  /** fixed set of values: filters offer a picker and the text query validates against it */ options?: string[]
  /** displayed (and searched) text; defaults to the value, dates as "12 Mar 2025" */ text?: (row: T) => string
  /** custom cell, e.g. a badge. `content` is the text with search matches highlighted */ render?: (row: T, content: ReactNode) => ReactNode
  /** double-click to edit (default: text and number columns without options) */ editable?: boolean
  /** start pinned to this side (sticky while the rest scrolls); the Columns menu changes it. */ pin?: GridPinSide
  /** start hidden; the Columns menu shows it */ hidden?: boolean
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
/** Longest search the grid compiles. */
const GRID_RG_MAX = 200
/** Only the first this-many characters of a cell are searched. */
const GRID_RG_CELL = 500
/** Milliseconds one search pass may take before the grid stops and shows what it has. */
const GRID_RG_BUDGET = 120
/**
 * Heuristic for patterns that backtrack catastrophically, returning why (or ''): a quantified group that itself holds a
 * quantifier, like (a+)+, (.*.*)*, (\w+\s?)+ or (x*){2,}; or three or more open-ended wildcards (.*, \w+, [^,]*…),
 * which are polynomial. Not a proof of safety: the search also caps cell length and its own running time.
 */
function gridRiskyPattern(src: string) {
  const Q = /[*+]|\{\d+,\d*\}/
  const flat = src.replace(/\\[wWsSdD]/g, '.').replace(/\\./g, 'x').replace(/\[[^\]]*\]/g, '.')
  if ((flat.match(/\.(?:[*+]|\{\d+,\})/g) ?? []).length >= 3) return 'Three or more open-ended wildcards (like .*.*.*) can freeze the page: use at most two'
  let tt = flat, prev = ''
  while (tt !== prev) { // collapse innermost groups: one that holds a quantifier becomes a quantified atom
    prev = tt
    tt = tt.replace(/\(([^()]*)\)/g, (_, inner: string) => (Q.test(inner) ? 'x+' : 'x'))
  }
  return /(?:[*+]|\{\d+,\d*\})(?:[*+]|\{\d+,\d*\})/.test(tt) ? 'Nested quantifiers like (a+)+ can freeze the page: simplify the pattern, or turn off .* to search literally' : ''
}
function gridCompileRg(raw: string, flags: { cs: boolean; w: boolean; rx: boolean }): GridRg {
  if (raw.length > GRID_RG_MAX) return { re: null, err: `Search is limited to ${GRID_RG_MAX} characters` }
  let q = raw.trim().replace(/^rg\s+/, ''), i: boolean | null = null, w = flags.w, F = !flags.rx, m: RegExpMatchArray | null
  while ((m = q.match(/^-(i|s|w|F)\s+/))) { if (m[1] === 'i') i = true; if (m[1] === 's') i = false; if (m[1] === 'w') w = true; if (m[1] === 'F') F = true; q = q.slice(m[0].length) }
  q = q.replace(/^"(.*)"$|^'(.*)'$/, (_, a, b) => a ?? b)
  if (!q) return { re: null, err: '' }
  const ignore = i ?? (flags.cs ? false : q === q.toLowerCase()) // smart case, like rg -S
  const risky = F ? '' : gridRiskyPattern(q)
  if (risky) return { re: null, err: risky }
  let src = F ? q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') : q
  if (w) src = `\\b(?:${src})\\b`
  try { return { re: new RegExp(src, 'g' + (ignore ? 'i' : '')), err: '' } } catch (e) { return { re: null, err: String((e as Error).message).replace(/^Invalid regular expression: (\/.*\/\w*: )?/, '') } }
}
/** The cell text with each precomputed match wrapped in <mark>. */
function gridMark(text: string, matches: RegExpMatchArray[] | undefined): ReactNode {
  if (!matches?.length || !text) return text
  const out: ReactNode[] = []; let last = 0, k = 0
  for (const m of matches) {
    if (!m[0]) continue
    const at = m.index ?? 0
    if (at > last) out.push(text.slice(last, at))
    out.push(<mark key={k++} className="rounded-[var(--r-sm)] bg-[color-mix(in_srgb,var(--warn)_35%,transparent)] px-px text-inherit">{m[0]}</mark>)
    last = at + m[0].length
  }
  if (!out.length) return text
  if (last < text.length) out.push(text.slice(last))
  return out
}

/* ---- text query: serialise, parse, highlight ---- */
/** Column labels by key and keys by lower-cased key/label. Maps, so names like `constructor` or `__proto__` are just unknown fields. */
type GridSchema = { label: Map<string, string>; field: Map<string, string>; kind: (k: string) => 'text' | 'number'; options: (k: string) => string[] | undefined }
const gridQv = (v: string) => /^[\w.-]+$/.test(v) ? v : `"${v}"`
function gridSerialise(n: GridFilterNode, s: GridSchema, top = true): string {
  if (!gridIsGroup(n)) { const l = s.label.get(n.f[0]) ?? n.f[0]; return `${/\s/.test(l) ? n.f[0] : l.toLowerCase()} ${n.f[1]} ${gridQv(n.f[2])}` }
  const inner = n.c.map(x => gridSerialise(x, s, false)).join(` ${n.j} `)
  return top || n.c.length < 2 ? inner : `(${inner})`
}
function gridParse(q: string, s: GridSchema): GridGroup {
  const toks = q.match(/"[^"]*"|>=|<=|≥|≤|[<>=()]|[^\s"<>=()]+/g) || []
  let i = 0
  const cond = (): GridCondition => {
    const f = s.field.get((toks[i] || '').toLowerCase())
    if (!f) throw new Error(`Unknown field “${toks[i] || '…'}”`)
    let op = toks[i + 1]
    if (op && op.toLowerCase() === 'is' && (toks[i + 2] || '').toLowerCase() === 'not') { op = 'is not'; i++ }
    op = ({ '>=': '≥', '<=': '≤' } as Record<string, string>)[op] || (op || '').toLowerCase()
    const ops = GRID_OPS[s.kind(f)]
    if (!ops.includes(op)) throw new Error(`“${toks[i + 1] || '…'}” isn’t an operator for ${s.label.get(f) ?? f} (try ${ops.join(', ')})`)
    const raw = toks[i + 2]
    if (raw === undefined || raw === ')') throw new Error(`Missing value for ${s.label.get(f) ?? f}`)
    let v = raw.replace(/^"|"$/g, '')
    const opts = s.options(f)
    if (opts) { const m = opts.find(x => x.toLowerCase() === v.toLowerCase()); if (!m && op !== 'contains') throw new Error(`${s.label.get(f) ?? f} is one of ${opts.join(', ')}`); v = m || v }
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
      if (i >= toks.length) throw new Error(`Condition missing after ${c}`)
      g.c.push(term())
    }
    g.j = (j ?? 'AND') as 'AND' | 'OR'
    return g
  }
  const tree = group()
  if (i < toks.length) throw new Error('Unexpected “)”')
  return tree
}
function gridHighlight(q: string, s: GridSchema): ReactNode {
  return q.split(/("[^"]*"|\s+|>=|<=|≥|≤|[<>=()])/).map((t, k) => {
    const l = t.toLowerCase()
    if (!t || /^\s+$/.test(t)) return t
    if (s.field.has(l)) return <span key={k} className="font-semibold text-[var(--accent)]">{t}</span>
    if (l === 'and' || l === 'or') return <span key={k} className="font-semibold text-[var(--c3)]">{t}</span>
    if (['is', 'not', 'contains', '>', '<', '=', '>=', '<=', '≥', '≤', '(', ')'].includes(l)) return <span key={k} className="text-[var(--fg2)]">{t}</span>
    return <span key={k} className="text-[color-mix(in_srgb,var(--ok)_80%,var(--fg))]">{t}</span>
  })
}

/* ---- library Select (keyboard, type-ahead) restyled for chips, blocks and the toolbar ---- */
const GRID_PICK = {
  chip: 'flex h-full min-w-0 shrink [@media(pointer:coarse)]:[&>button]:text-[13px] [&>button]:h-full [&>button]:w-auto [&>button]:min-w-0 [&>button]:max-w-[180px] [&>button]:gap-1 [&>button]:rounded-none [&>button]:border-y-0 [&>button]:border-s-0 [&>button]:bg-transparent [&>button]:px-2 [&>button]:text-xs [&>button]:text-[var(--fg)]',
  block: '[@media(pointer:coarse)]:[&>button]:h-8 [@media(pointer:coarse)]:[&>button]:text-[13px] [&>button]:h-6 [&>button]:w-auto [&>button]:gap-1 [&>button]:rounded-[var(--r-lg)] [&>button]:border-0 [&>button]:bg-white [&>button]:px-2 [&>button]:text-xs [&>button]:font-semibold [&>button]:text-[#18181B] [&>button_svg]:text-[#71717A] [&>div]:text-[var(--fg)] [&>div]:font-normal',
  toolbar: '[@media(pointer:coarse)]:[&>button]:h-9 [@media(pointer:coarse)]:[&>button]:text-[13px] [&>button]:h-7 [&>button]:w-auto [&>button]:min-w-[110px] [&>button]:px-2 [&>button]:text-xs [&>button]:text-[var(--fg)]',
} as const
function GridPick({ value, options, onChange, label, variant, className }:
  { value: string; options: [string, string][]; onChange: (v: string) => void; label: string; variant: keyof typeof GRID_PICK; className?: string }) {
  return <Select aria-label={label} value={value} options={options.map(([v, l]) => ({ value: v, label: l }))} onChange={onChange} className={cn(GRID_PICK[variant], className)} />
}

const GRID_TB_ITEMS = 'button:not([disabled]),input:not([disabled]):not([type=hidden]),select:not([disabled]),textarea:not([disabled]),[role=slider]'
/**
 * Makes everything focusable inside `ref` one Tab stop (a WAI-ARIA toolbar): ← / → (and Home / End) move between the
 * controls, Tab leaves. A text field keeps the arrows until its caret reaches the edge; open lists keep theirs; radio
 * buttons (the mode switch) are just stops here, so moving past them never changes the mode (Space or Enter picks).
 * Tab indexes are re-applied whenever the content changes, since the controls inside come and go.
 */
function useGridToolbar(ref: React.RefObject<HTMLElement | null>) {
  const cur = useRef(0)
  useEffect(() => {
    const root = ref.current; if (!root) return
    const items = () => [...root.querySelectorAll<HTMLElement>(GRID_TB_ITEMS)].filter(el => !el.closest('[role=listbox],[role=menu],[role=dialog]') && el.getClientRects().length > 0)
    const apply = () => {
      const list = items(); if (!list.length) return
      const a = document.activeElement, at = list.indexOf(a as HTMLElement)
      if (at >= 0) cur.current = at
      cur.current = Math.min(cur.current, list.length - 1)
      list.forEach((el, i) => { const want = i === cur.current ? '0' : '-1'; if (el.getAttribute('tabindex') !== want) el.setAttribute('tabindex', want) })
    }
    const onFocus = () => apply()
    const onKey = (e: KeyboardEvent) => {
      if (e.altKey || e.ctrlKey || e.metaKey) return
      const k = e.key; if (k !== 'ArrowLeft' && k !== 'ArrowRight' && k !== 'Home' && k !== 'End') return
      const t = e.target as HTMLElement
      if (t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement) { // text: arrows move the caret until it hits the edge
        if (k === 'Home' || k === 'End') return
        const { selectionStart: a, selectionEnd: b, value } = t
        if (a !== b || (k === 'ArrowLeft' && a !== 0) || (k === 'ArrowRight' && (a ?? 0) < value.length)) return
      }
      const list = items(), i = list.indexOf(t); if (i < 0) return
      const n = k === 'Home' ? 0 : k === 'End' ? list.length - 1 : clamp(i + (k === 'ArrowRight' ? 1 : -1), 0, list.length - 1)
      if (n === i) return
      e.preventDefault(); e.stopPropagation(); cur.current = n; apply(); list[n].focus()
    }
    apply()
    const mo = new MutationObserver(() => apply())
    mo.observe(root, { subtree: true, childList: true, attributes: true, attributeFilter: ['tabindex', 'disabled'] })
    // capture: runs before the controls' own arrow handling (the segmented control would otherwise switch modes)
    root.addEventListener('focusin', onFocus); root.addEventListener('keydown', onKey, true)
    return () => { mo.disconnect(); root.removeEventListener('focusin', onFocus); root.removeEventListener('keydown', onKey, true) }
  }, [ref])
}

/** One shared filter model, edited three ways (Bricks chips, a Text query, nested Blocks). */
function GridFilterBuilder({ tree, onChange, schema, fields, defaultField, count }:
  { tree: GridGroup; onChange: (t: GridGroup) => void; schema: GridSchema; fields: [string, string][]; defaultField: string; count: ReactNode }) {
  const [mode, setMode] = useState<'bricks' | 'text' | 'blocks'>('bricks')
  const [qText, setQText] = useState('')
  const [qErr, setQErr] = useState<string | null>(null)
  const [focusNew, setFocusNew] = useState<string | null>(null)
  const ref = useRef(tree); ref.current = tree
  const bar = useRef<HTMLDivElement>(null)
  useGridToolbar(bar)
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
    const sel = variant === 'chip' ? 'h-full min-w-0 shrink border-0 border-e border-[var(--line)] bg-transparent px-2 text-xs text-[var(--fg)]' : 'h-6 rounded-[var(--r-lg)] border-0 bg-white px-2 text-xs font-semibold text-[#18181B]'
    return (
      <>
        <GridPick label={'Field'} variant={variant} value={k} options={fields} onChange={x => setField(n.id, 0, x)} className={variant === 'chip' ? '[&>button]:font-semibold' : undefined} />
        <GridPick label={'Operator'} variant={variant} value={op} options={GRID_OPS[schema.kind(k)].map(o => [o, o])} onChange={x => setField(n.id, 1, x)} />
        {opts && op !== 'contains'
          ? <GridPick label={'Value'} variant={variant} value={v} options={opts.map(o => [o, o])} onChange={x => setField(n.id, 2, x)} />
          : <input aria-label={'Value'} value={v} placeholder={'value'} size={variant === 'block' ? 6 : undefined} autoFocus={focusNew === n.id}
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
            {i === 0 ? <span className="px-1 text-xs text-[var(--fg3)]">{'Where'}</span>
              : <button onClick={() => set({ ...ref.current, j: ref.current.j === 'AND' ? 'OR' : 'AND' })} aria-label={`Join: ${tree.j}. Click to switch`}
                className="h-7 cursor-pointer rounded-[var(--r-md)] border border-[var(--line)] bg-[var(--card)] px-2 font-[family-name:var(--mono)] text-[11px] font-semibold text-[var(--fg2)] hover:text-[var(--fg)] [@media(pointer:coarse)]:h-9 [@media(pointer:coarse)]:min-w-11">{tree.j}</button>}
            <span className="inline-flex h-7 min-w-0 max-w-full items-stretch rounded-[var(--r-md)] border border-[var(--line)] bg-[var(--card)] text-xs [@media(pointer:coarse)]:h-9">
              {condFields(n as GridCondition, 'chip')}
              <button onClick={() => remove(n.id)} aria-label={'Remove filter'} className="grid cursor-pointer place-items-center border-0 bg-transparent px-2 text-[var(--fg3)] hover:text-[var(--bad)] [@media(pointer:coarse)]:min-w-9"><Icon name="x" size={12} strokeWidth={2.4} /></button>
            </span>
          </motion.span>
        ))}
      </AnimatePresence>
      <button onClick={() => { const c = newCond(); setFocusNew(c.id); set({ ...ref.current, c: [...ref.current.c, c] }) }}
        className="h-7 cursor-pointer rounded-[var(--r-md)] border border-dashed border-[var(--line2)] bg-transparent px-2.5 text-xs font-medium text-[var(--fg2)] hover:border-[var(--fg3)] hover:text-[var(--fg)] [@media(pointer:coarse)]:h-9 [@media(pointer:coarse)]:px-3">{'+ Filter'}</button>
    </>
  ) : (
    <>
      <span className="px-1.5 text-xs text-[var(--fg3)]">{'This filter uses nested groups:'} <b className="font-[family-name:var(--mono)] font-medium text-[var(--fg)]">{gridSerialise(tree, schema)}</b></span>
      <Button size="sm" onClick={() => switchMode('blocks')} className={TOUCH.tap36}>{'Edit in Blocks'}</Button>
      <Button size="sm" variant="ghost" onClick={() => set({ ...ref.current, j: 'AND', c: gridConds(ref.current) })} className={TOUCH.tap36}>{'Flatten'}</Button>
    </>
  )

  /* Text */
  const mirror = useRef<HTMLDivElement>(null)
  const text = () => (
    <div className="flex w-full flex-col gap-1">
      <div className={cn(inputShellClass(!!qErr), GRID_FOCUS_RING, 'relative h-[30px] w-full min-w-[240px] !rounded-[var(--r-md)] [@media(pointer:coarse)]:h-10')}>
        <div ref={mirror} aria-hidden className={cn('pointer-events-none absolute inset-0 overflow-hidden px-2.5 font-[family-name:var(--mono)] text-xs leading-[28px] whitespace-pre text-[var(--fg)] [@media(pointer:coarse)]:leading-[38px]', TOUCH.input)}>{gridHighlight(qText, schema)} </div>
        <input value={qText} autoFocus spellCheck={false} autoComplete="off" aria-label={'Filter query'} aria-invalid={!!qErr || undefined}
          onChange={e => { applyText(e.target.value); if (mirror.current) mirror.current.scrollLeft = e.target.scrollLeft }}
          onScroll={e => { if (mirror.current) mirror.current.scrollLeft = e.currentTarget.scrollLeft }}
          onKeyUp={e => { if (mirror.current) mirror.current.scrollLeft = e.currentTarget.scrollLeft }}
          className={cn('absolute inset-0 w-full border-0 bg-transparent px-2.5 font-[family-name:var(--mono)] text-xs leading-[28px] whitespace-pre text-transparent caret-[var(--fg)] [@media(pointer:coarse)]:leading-[38px] outline-none selection:bg-[color-mix(in_srgb,var(--accent)_30%,transparent)]', TOUCH.input)} />
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
          }} className={cn('cursor-pointer rounded-[var(--r-sm)] border border-[var(--line)] bg-[var(--card)] px-1.5 py-0.5 font-[family-name:var(--mono)] text-[11px] text-[var(--fg2)] hover:border-[var(--accent)] hover:text-[var(--accent)] [@media(pointer:coarse)]:px-2 [@media(pointer:coarse)]:text-xs', TOUCH.tap)}>{l.toLowerCase()}</button>
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
  const blockBase = 'relative mb-2 rounded-[var(--r-md)] text-xs font-semibold text-white bg-[color-mix(in_srgb,var(--bc)_90%,#000)] shadow-[0_2px_0_color-mix(in_srgb,var(--bc)_60%,#000)]'
  const grip = (id: string) => <span {...sort.handleProps(id)} aria-label={'Drag block'} role="img" className={cn('cursor-grab touch-none px-0.5 text-[13px] opacity-75 select-none hover:opacity-100 [@media(pointer:coarse)]:-my-1 [@media(pointer:coarse)]:grid [@media(pointer:coarse)]:h-8 [@media(pointer:coarse)]:w-7 [@media(pointer:coarse)]:place-items-center', TOUCH.input)}>⠿</span>
  const x = (id: string, what: 'removeBlock' | 'removeGroup') => <button onClick={() => remove(id)} aria-label={what === 'removeBlock' ? 'Remove block' : 'Remove group'} className="ms-0.5 grid h-5 w-5 flex-none cursor-pointer place-items-center rounded-full border-0 bg-black/15 text-white hover:bg-black/30 [@media(pointer:coarse)]:h-8 [@media(pointer:coarse)]:w-8"><Icon name="x" size={10} strokeWidth={3} /></button>
  const block = (n: GridFilterNode, root = false): ReactNode => {
    const ghost = sort.dragging === n.id && 'opacity-40 !shadow-none outline-[1.5px] outline-dashed outline-[var(--line2)]'
    if (!gridIsGroup(n)) return (
      <motion.div key={n.id} layout="position" transition={spring(0.2, 0.35)} {...sort.itemProps(n.id)} style={{ '--bc': BC.cond } as CSSProperties}
        initial={{ opacity: 0, y: -6, scale: 0.96 }} animate={{ opacity: 1, y: 0, scale: 1 }}
        className={cn(blockBase, 'flex w-max max-w-full flex-wrap items-center gap-1.5 py-[7px] pe-2 ps-1.5 before:absolute before:top-0 before:start-[18px] before:h-1 before:w-4 before:rounded-b before:bg-black/15 after:absolute after:-bottom-1.5 after:start-[18px] after:h-1.5 after:w-4 after:rounded-b after:bg-[color-mix(in_srgb,var(--bc)_90%,#000)]', ghost)}>
        {grip(n.id)}<span className="opacity-90">{'where'}</span>{condFields(n, 'block')}{x(n.id, 'removeBlock')}
      </motion.div>
    )
    return (
      <motion.div key={n.id} layout={root ? false : 'position'} transition={spring(0.2, 0.35)} {...(root ? {} : sort.itemProps(n.id))} style={{ '--bc': BC[n.j] } as CSSProperties}
        initial={root ? false : { opacity: 0, y: -6, scale: 0.96 }} animate={{ opacity: 1, y: 0, scale: 1 }} className={cn(blockBase, 'w-full', root && '!mb-0', ghost)}>
        <div className="flex flex-wrap items-center gap-1.5 px-2 py-[7px]">

          {root ? <span className="opacity-90">{'Show rows where'}</span> : grip(n.id)}
          <motion.button key={n.j} initial={{ scale: 0.85 }} animate={{ scale: 1 }} transition={spring(0.5, 0.3)} aria-label={`Match ${(n.j === 'AND' ? 'all' : 'any') === 'all' ? 'all' : 'any'}. Click to switch`}
            onClick={() => set(gridUpdate(ref.current, n.id, g => ({ ...g, j: (g as GridGroup).j === 'AND' ? 'OR' : 'AND' })))}
            className="h-[22px] cursor-pointer rounded-[var(--r-lg)] border-0 bg-white/95 px-2.5 text-xs font-bold text-[#18181B] [@media(pointer:coarse)]:h-8 [@media(pointer:coarse)]:min-w-11 [@media(pointer:coarse)]:text-[13px]">{n.j === 'AND' ? 'all' : 'any'}</motion.button>
          <span className="opacity-90">{'of these are true'}</span>
          {!root && <span className="ms-auto">{x(n.id, 'removeGroup')}</span>}
        </div>
        <div {...sort.listProps(n.id)} className="ms-3.5 min-h-[38px] rounded-s-md bg-[var(--card)] px-2 pt-2 pb-0.5">
          {n.c.length ? n.c.map(k => block(k)) : <div className="px-0.5 pt-1 pb-2.5 font-medium text-[var(--fg3)]">{'Drop blocks here'}</div>}
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
        <span className="text-xs text-[var(--fg3)]">{'Add a block'}</span>
        {([['cond', 'where … is …'], ['AND', 'all of'], ['OR', 'any of']] as const).map(([k, l]) => (
          <button key={k} onClick={() => addBlock(k)} style={{ '--bc': BC[k] } as CSSProperties}
            className="cursor-pointer rounded-[var(--r-md)] border-0 bg-[color-mix(in_srgb,var(--bc)_90%,#000)] px-2.5 py-2 text-start text-xs font-semibold [@media(pointer:coarse)]:min-h-9 text-white shadow-[0_2px_0_color-mix(in_srgb,var(--bc)_60%,#000)] hover:brightness-110 active:translate-y-px">{l}</button>
        ))}
        <span className="mt-1.5 text-xs text-[var(--fg3)]">{'Drag ⠿ to reorder or drop a block inside a group to nest it. Text and Bricks stay in sync.'}</span>
      </div>
      <div className={cn(surface.dashed, 'min-h-[120px] bg-[var(--card)] p-2.5')}>{block(tree, true)}</div>
    </div>
  )

  return (
    <div ref={bar} data-fb role="toolbar" aria-label={'Filters. Left and right arrows move between controls'} className="flex flex-wrap items-center gap-1.5 rounded-t-[var(--r-md)] border border-b-0 border-[var(--line)] bg-[color-mix(in_srgb,var(--muted)_40%,var(--card))] p-2">
      <SegmentedControl size="sm" value={mode} onChange={switchMode} className="me-1 [@media(pointer:coarse)]:[&>button]:h-9" options={[{ value: 'bricks', label: 'Bricks' }, { value: 'text', label: 'Text' }, { value: 'blocks', label: 'Blocks' }]} />

      <span className="order-last ms-auto pe-1 text-xs text-[var(--fg3)] md:order-none md:hidden">{count}</span>
      <motion.div key={mode} initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.2 }}
        className={cn('flex min-w-0 flex-wrap items-center gap-1.5', mode === 'blocks' ? 'order-last basis-full' : mode === 'text' ? 'w-full md:w-auto md:flex-1' : 'flex-1 basis-[300px]')}>
        {mode === 'bricks' ? bricks() : mode === 'text' ? text() : blocks()}
      </motion.div>
      <span className={cn('hidden pe-1 text-xs whitespace-nowrap text-[var(--fg3)] md:inline', mode === 'text' && 'self-start pt-1.5', mode === 'blocks' && 'ms-auto')}>{count}</span>
    </div>
  )
}

/** The filter bar re-renders only when its props change (not on every scroll of a virtual grid). */
const GridFilterBuilderMemo = memo(GridFilterBuilder)

/** A visible accent ring on a text-field shell while its input has keyboard focus. */
const GRID_FOCUS_RING = 'has-[input:focus-visible]:!border-[var(--accent)] has-[input:focus-visible]:!shadow-[0_0_0_2px_var(--accent-soft)]'

const gridCmp = (x: unknown, y: unknown, coll: Intl.Collator) =>
  (typeof x === 'number' && typeof y === 'number') || (x instanceof Date && y instanceof Date) ? Number(x) - Number(y) : coll.compare(String(x), String(y))

/* ---- selection model ---- */
/** A row's key (what `rowKey` returns). */
export type GridKey = string | number
/**
 * Which rows are selected. `include`: exactly `keys`. `exclude`: every row matching the current filter and search, on
 * every page and including rows not loaded yet, except `keys`. That is "select all across pages" in server mode: send it
 * to your API as it is. The grid only creates `exclude` from the "Select all N rows" link, and drops it back to an empty
 * selection when the filter, search or sort changes (because "all" would then mean different rows).
 */
export type GridSelection = { mode: 'include' | 'exclude'; keys: ReadonlySet<GridKey> }
/** An empty selection. */
export const GRID_NO_SELECTION: GridSelection = { mode: 'include', keys: new Set() }
/** Whether the row with `key` is selected. */
export const gridIsSelected = (s: GridSelection, key: GridKey) => s.mode === 'include' ? s.keys.has(key) : !s.keys.has(key)
/** How many rows are selected, out of `total` rows matching the filter. */
export const gridSelectedCount = (s: GridSelection, total: number) => s.mode === 'include' ? s.keys.size : Math.max(0, total - s.keys.size)
function gridSelWith(s: GridSelection, ids: readonly GridKey[], on: boolean): GridSelection {
  const keys = new Set(s.keys), add = s.mode === 'include' ? on : !on
  for (const id of ids) { if (add) keys.add(id); else keys.delete(id) }
  return { mode: s.mode, keys }
}
/** Sort state: a column and a direction (1 ascending, -1 descending). */
export type GridSort<T> = { key: keyof T & string; dir: 1 | -1 }
/** Which edge a pinned column sticks to. */
export type GridPinSide = 'left' | 'right'
/** Pinned column keys per side, in display order. */
export type GridPinned = { left?: string[]; right?: string[] }
type GridDisp<T> = { g: string; rs: T[]; r?: undefined } | { r: T; g?: undefined }
/** Rows rendered when more than this many are shown (and always with `onLoadMore`) are virtualised. */
const GRID_VIRTUAL_AT = 100
const GRID_GROUP_H = 36

/** Everything a grid row's output depends on: a memoised row re-renders only when one of these changes. */
type GridRowProps<T> = {
  r: T; di: number; ri: number; on: boolean; tabKey: string | null; editKey: string | null; activeKey: string | null
  flash: { key: string; n: number } | null; marks?: Map<string, RegExpMatchArray[]>; cols: GridColumn<T>[]; stickKey: string; anim: boolean
  measure: (el: Element | null) => void | (() => void); draw: { current: (r: T, di: number, p: GridRowProps<T>) => ReactElement }
}
const GridRowMemo = memo(function GridRow<T>(p: GridRowProps<T>) { return p.draw.current(p.r, p.di, p) }) as <T>(p: GridRowProps<T> & { key?: React.Key }) => ReactElement

/** Props of DataGrid. Every 0.2 prop works as before; the rest add server data, column state and a selection API. */
export type DataGridProps<T> = {
  columns: GridColumn<T>[]; rows?: T[]; defaultRows?: T[]; onRowsChange?: (rows: T[]) => void; rowKey: (r: T) => GridKey
  defaultFilter?: GridGroup; defaultSort?: GridSort<T>; /** columns offered in Group by (client mode) */ groupable?: (keyof T & string)[]
  /** totals shown on each group row (default: sums of the number columns) */ groupSummary?: (rows: T[]) => ReactNode
  /** used in checkbox labels */ rowLabel?: (r: T) => string
  /** Export button; gets the selected rows that are loaded, and the selection (which may be `exclude` in server mode) */ onExport?: (rows: T[], selection: GridSelection) => void
  /** px; the rows scroll inside */ maxHeight?: number; 'aria-label'?: string; className?: string
  /** `rows` are already filtered, sorted and paged by your API: the grid only emits sort/filter/search/page changes. No grouping. */ server?: boolean
  /** controlled sort (null: unsorted) */ sort?: GridSort<T> | null; onSortChange?: (sort: GridSort<T> | null) => void
  /** controlled filter tree; the Bricks/Text/Blocks builder emits it */ filter?: GridGroup; onFilterChange?: (filter: GridGroup) => void
  /** the rg search box, debounced (150 ms): apply it on your API in server mode */ onSearchChange?: (query: string) => void
  /** server mode: rows matching on the server (pages, the count, aria-rowcount, "select all N") */ rowCount?: number
  /** 0-based page; with `pageSize` a pager shows (client mode pages locally) */ page?: number; defaultPage?: number; onPageChange?: (page: number) => void
  pageSize?: number; defaultPageSize?: number; /** offered in "Rows per page" */ pageSizes?: number[]; onPageSizeChange?: (size: number) => void
  /** infinite loading: called when the last rows scroll into view (once per row count) while `hasMore` and not `loading` */ onLoadMore?: () => void; hasMore?: boolean
  /** a request is in flight: skeleton rows when empty, dimmed rows otherwise, loading rows at the end with `onLoadMore` */ loading?: boolean
  /** a failed request: shown above the rows, with Retry when `onRetry` is given */ error?: ReactNode; onRetry?: () => void
  /** controlled selection (see GridSelection) */ selection?: GridSelection; defaultSelection?: GridSelection; onSelectionChange?: (s: GridSelection) => void
  /** server mode Delete (client mode deletes locally with Undo) */ onDelete?: (selection: GridSelection, loadedRows: T[]) => void
  /** column keys in display order (within each pinned side) */ columnOrder?: string[]; defaultColumnOrder?: string[]; onColumnOrderChange?: (order: string[]) => void
  /** hidden column keys (default: columns with `hidden`) */ hiddenColumns?: string[]; defaultHiddenColumns?: string[]; onHiddenColumnsChange?: (keys: string[]) => void
  /** pinned columns (default: columns with `pin`, else the first column on the left) */ pinnedColumns?: GridPinned; defaultPinnedColumns?: GridPinned; onPinnedColumnsChange?: (p: GridPinned) => void
  onColumnResize?: (key: string, width: number) => void
  /** px per row (default 38, 44 on touch screens); rows taller than this are measured */ rowHeight?: number
  /** virtualise the rows: true, false, or above this many rows (default 100). Small grids keep their row animations. */ virtualize?: boolean | number
}

/**
 * Data grid, generic over the row type, from a few rows to 100k (rows are virtualised above 100: only the ones in view
 * are in the DOM). Filter with Bricks (chips joined by AND/OR), a Text query (`status is active and mrr > 500`, with
 * highlighting and parse errors) or Scratch-style Blocks with nested groups (drag ⠿) — all three edit one filter.
 * Search every cell ripgrep-style (regex, smart case, whole word, literal; `-i -w -F` flags work too) with highlighted
 * hits. Group by a column with collapsible groups, counts and totals. Click headers to sort, drag their edge to resize,
 * drag a header (or Ctrl+Shift+← →) to reorder; the Columns menu hides, pins (left/right) and reorders. Shift-click
 * checkboxes for ranges, then Export or Delete (with Undo). Double-click a cell to edit; Enter saves, Escape cancels.
 * Keyboard: one Tab stop in the cells, arrows, Home/End, Ctrl+Home/End, PageUp/PageDown, Enter/F2 edits, Space selects.
 * `server` hands sorting, filtering, search and paging to your API (`rowCount`, `page`/`pageSize` or `onLoadMore`,
 * `loading`, `error`); `selection` is controlled with "select all across pages" semantics (see GridSelection).
 */
export function DataGrid<T extends object>(props: DataGridProps<T>) {
  const { columns, rows, defaultRows = [], onRowsChange, rowKey, defaultFilter, defaultSort, groupable, groupSummary, rowLabel, onExport, maxHeight = 420, 'aria-label': ariaLabelProp, className,
    server = false, sort: sortProp, onSortChange, filter: filterProp, onFilterChange, onSearchChange, rowCount, page: pageProp, defaultPage = 0, onPageChange,
    pageSize: pageSizeProp, defaultPageSize, pageSizes, onPageSizeChange, onLoadMore, hasMore = true, loading = false, error, onRetry,
    selection: selProp, defaultSelection, onSelectionChange, onDelete, columnOrder, defaultColumnOrder, onColumnOrderChange,
    hiddenColumns, defaultHiddenColumns, onHiddenColumnsChange, pinnedColumns, defaultPinnedColumns, onPinnedColumnsChange, onColumnResize, rowHeight, virtualize = GRID_VIRTUAL_AT } = props
  const [data, setData] = useControllable(rows, defaultRows, onRowsChange)
  const dataRef = useRef(data); dataRef.current = data
  const commit = (next: T[]) => { dataRef.current = next; setData(next) }
  const toast = useToast()
  const [initialFilter] = useState(() => defaultFilter ?? gridFilter('AND'))
  const [filter, setFilterRaw] = useControllable(filterProp, initialFilter, onFilterChange)
  const [sort, setSortRaw] = useControllable<GridSort<T> | null>(sortProp, defaultSort ?? null, onSortChange)
  const [sel, setSelRaw] = useControllable(selProp, defaultSelection ?? GRID_NO_SELECTION, onSelectionChange)
  const selRef = useRef(sel); selRef.current = sel
  const setSel = (s: GridSelection) => { selRef.current = s; setSelRaw(s) }
  const [page, setPageRaw] = useControllable(pageProp, defaultPage, onPageChange)
  const pageRef = useRef(page); pageRef.current = page
  const setPage = (p: number) => { if (p !== pageRef.current) { pageRef.current = p; setPageRaw(p) } }
  const [pageSize, setPageSize] = useControllable(pageSizeProp, defaultPageSize ?? 0, onPageSizeChange)
  const paged = pageSize > 0
  const [qInput, setQInput] = useState('') // what's typed; `q` follows it after a short pause
  const [q, setQ] = useState('')
  useEffect(() => { if (qInput === q) return; const t = setTimeout(() => setQ(qInput), 150); return () => clearTimeout(t) }, [qInput]) // eslint-disable-line react-hooks/exhaustive-deps
  const [flags, setFlags] = useState({ cs: false, w: false, rx: true })
  const [groupBy, setGroupBy] = useState('')
  const [closed, setClosed] = useState<Set<string>>(new Set())
  const last = useRef<GridKey | null>(null)
  const [widths, setWidths] = useState<Record<string, number>>(() => Object.fromEntries(columns.map(c => [c.key, c.width ?? 120])))
  const [resizing, setResizing] = useState<string | null>(null)
  const [edit, setEditState] = useState<{ id: GridKey; key: string } | null>(null)
  const editRef = useRef(edit)
  const setEdit = (e: typeof edit) => { editRef.current = e; setEditState(e) }
  const [flash, setFlash] = useState<{ id: GridKey; key: string; n: number } | null>(null)
  /* touch: tap a cell to select it, tap again (or its pencil) to edit; mouse keeps double-click */
  const [active, setActive] = useState<{ id: GridKey; key: string } | null>(null)
  /* keyboard: one roving Tab stop among the cells; arrows move it, Enter or F2 edits, Space selects the row */
  const [cursor, setCursor] = useState<{ id: GridKey; key: string } | null>(null)
  const pendingFocus = useRef<{ id: GridKey; key: string } | null>(null)
  const [said, setSaid] = useState('') // polite announcements (column moves)
  const tableRef = useRef<HTMLTableElement>(null)
  const ptr = useRef('mouse')
  const [scrollerCb, edges] = useScrollEdges<HTMLDivElement>()
  const scrollEl = useRef<HTMLDivElement | null>(null)
  const scroller = useCallback((el: HTMLDivElement | null) => { scrollEl.current = el; scrollerCb(el) }, [scrollerCb])
  const [gridBox, gridW] = useWidth<HTMLDivElement>()
  const narrow = gridW > 0 && gridW < 520
  const coarse = useCoarsePointer()
  const rowH = rowHeight ?? (coarse ? 44 : 38)
  const locale = LOCALE, timeZone = undefined
  // one formatter and collator per locale: building Intl objects per cell is the slowest part of a scroll frame
  const dateFmt = useMemo(() => dateFormat(locale, { day: 'numeric', month: 'short', year: 'numeric', ...(timeZone ? { timeZone } : null) }), [locale, timeZone])
  const collator = useMemo(() => new Intl.Collator(locale), [locale])

  /* ---- columns: order, visibility, pins ---- */
  const col = (k: string) => columns.find(c => c.key === k)
  const allKeys = useMemo(() => columns.map(c => c.key as string), [columns])
  const [orderRaw, setOrder] = useControllable(columnOrder, defaultColumnOrder ?? allKeys, onColumnOrderChange)
  const order = useMemo(() => { const known = new Set(allKeys), o = orderRaw.filter(k => known.has(k)); for (const k of allKeys) if (!o.includes(k)) o.push(k); return o }, [orderRaw, allKeys])
  const [hidden, setHidden] = useControllable(hiddenColumns, defaultHiddenColumns ?? columns.filter(c => c.hidden).map(c => c.key as string), onHiddenColumnsChange)
  const [initialPins] = useState<GridPinned>(() => defaultPinnedColumns ?? (columns.some(c => c.pin)
    ? { left: columns.filter(c => c.pin === 'left').map(c => c.key), right: columns.filter(c => c.pin === 'right').map(c => c.key) }
    : { left: columns[0] ? [columns[0].key] : [], right: [] }))
  const [pinsRaw, setPinsRaw] = useControllable(pinnedColumns, initialPins, onPinnedColumnsChange)
  const pins = useMemo(() => ({ start: pinsRaw.left ?? [], end: pinsRaw.right ?? [] }), [pinsRaw])
  const setPins = (left: string[], right: string[]) => setPinsRaw({ left, right })
  const pinOf = (k: string): 'start' | 'end' | null => pins.start.includes(k) ? 'start' : pins.end.includes(k) ? 'end' : null
  /** every column, arranged as displayed: start pins, the rest, end pins (hidden ones included, for the menu) */
  const arranged = useMemo(() => {
    const z = (k: string) => pins.start.includes(k) ? 0 : pins.end.includes(k) ? 2 : 1
    return [0, 1, 2].flatMap(n => order.filter(k => z(k) === n)).map(k => col(k)!).filter(Boolean)
  }, [order, pins, columns]) // eslint-disable-line react-hooks/exhaustive-deps
  const cols = useMemo(() => { const h = new Set(hidden); return arranged.filter(c => !h.has(c.key)) }, [arranged, hidden])
  const colW = (c: GridColumn<T>, i: number) => { const w = widths[c.key] ?? c.width ?? 120; return i === 0 && narrow && pinOf(c.key) === 'start' ? Math.min(w, 120) : w }
  const stick = new Map<string, { side: 'start' | 'end'; at: number; edge: boolean }>()
  {
    // on a phone only the first start pin stays sticky: more would leave no room for the rest of the row
    const first = cols.filter(c => pinOf(c.key) === 'start').slice(0, narrow ? 1 : undefined), last = narrow ? [] : cols.filter(c => pinOf(c.key) === 'end')
    // offsets are the cumulative colgroup widths, so the table must lay out at exactly those widths (see the table's style)
    let x = 40; first.forEach((c, i) => { stick.set(c.key, { side: 'start', at: x, edge: i === first.length - 1 }); x += colW(c, cols.indexOf(c)) })
    let r = 0; [...last].reverse().forEach((c, i) => { stick.set(c.key, { side: 'end', at: r, edge: i === last.length - 1 }); r += colW(c, cols.indexOf(c)) })
  }
  const pinStyle = (k: string): CSSProperties | undefined => { const s = stick.get(k); return s ? (s.side === 'start' ? { left: s.at } : { right: s.at }) : undefined }
  // the rule on a pinned zone's inner edge
  const pinCls = (k: string, head = false) => { const s = stick.get(k); return s ? cn('sticky', head ? 'z-[3]' : 'z-[1]', s.edge && (s.side === 'start' ? 'shadow-[inset_-1px_0_0_var(--line)]' : 'shadow-[inset_1px_0_0_var(--line)]')) : '' }
  /** move `k` one step (-1/1) among the columns of its pinned side; `shown` counts only visible columns */
  const moveCol = (k: string, step: -1 | 1, shown = true) => {
    const zone = pinOf(k), list = (shown ? cols : arranged).filter(c => pinOf(c.key) === zone).map(c => c.key as string)
    const i = list.indexOf(k), j = i + step
    if (i < 0 || j < 0 || j >= list.length) return false
    moveColTo(k, list[j], step > 0)
    const name = col(k)?.label ?? k
    setSaid(zone ? `${name} moved to position ${j + 1} of ${list.length} pinned ${zone === 'start' ? 'on the left' : 'on the right'}` : `${name} moved to position ${j + 1} of ${list.length}`)
    return true
  }
  const moveColTo = (k: string, target: string, after: boolean) => {
    if (k === target) return
    const o = order.filter(x => x !== k), at = o.indexOf(target)
    o.splice(at + (after ? 1 : 0), 0, k)
    setOrder(o)
  }
  const setPin = (k: string, side: 'start' | 'end' | null) => {
    const start = pins.start.filter(x => x !== k), end = pins.end.filter(x => x !== k)
    if (side === 'start') start.push(k); if (side === 'end') end.unshift(k)
    setPins(start, end)
    const name = col(k)?.label ?? k
    setSaid(side ? `${name} pinned ${side === 'start' ? 'left' : 'right'}` : `${name} unpinned`)
  }
  const toggleHidden = (k: string) => setHidden(hidden.includes(k) ? hidden.filter(x => x !== k) : [...hidden, k])

  /* ---- filter, search, sort ---- */
  const kind = (k: string): 'text' | 'number' => col(k)?.type === 'number' ? 'number' : 'text'
  const schema: GridSchema = useMemo(() => ({
    label: new Map(columns.map(c => [c.key, c.label])),
    field: new Map(columns.flatMap(c => [[c.label.toLowerCase(), c.key], [c.key.toLowerCase(), c.key]] as [string, string][])),
    kind: (k: string) => columns.find(c => c.key === k)?.type === 'number' ? 'number' : 'text',
    options: (k: string) => columns.find(c => c.key === k)?.options,
  }), [columns])
  const cellText = (r: T, c: GridColumn<T>) => { if (c.text) return c.text(r); const v = r[c.key]; return v instanceof Date ? dateFmt.format(v) : String(v ?? '') }
  const test = (r: T, [k, op, v]: GridCondition['f']) => {
    const c = col(k); if (!c || v === '' || v == null) return true
    if (kind(k) === 'number') { const x = Number(r[c.key]), n = Number(v); if (Number.isNaN(n)) return true; return ({ '>': x > n, '<': x < n, '=': x === n, '≥': x >= n, '≤': x <= n } as Record<string, boolean>)[op] ?? true }
    const a = cellText(r, c).toLowerCase(), b = v.toLowerCase()
    return op === 'is' ? a === b : op === 'is not' ? a !== b : a.includes(b)
  }
  const evalNode = (n: GridFilterNode, r: T): boolean => !gridIsGroup(n) ? test(r, n.f) : !n.c.length || (n.j === 'AND' ? n.c.every(x => evalNode(x, r)) : n.c.some(x => evalNode(x, r)))
  const rg = useMemo(() => gridCompileRg(q, flags), [q, flags])
  /* one pass: each cell is matched once (the matches feed the row filter, the hit count and the highlights), and the
     pass stops when it runs past GRID_RG_BUDGET, keeping what it found in the rows it reached. Server mode only marks. */
  const search = useMemo(() => {
    const base = server ? data : filter.c.length ? data.filter(r => evalNode(filter, r)) : data.slice()
    let rows = base, hits = 0, cut = 0
    const marks = new Map<T, Map<string, RegExpMatchArray[]>>()
    if (rg.re) {
      const re = rg.re, t0 = performance.now(); if (!server) rows = []
      for (let i = 0; i < base.length; i++) {
        if (i % 8 === 0 && i && performance.now() - t0 > GRID_RG_BUDGET) { cut = i; break }
        const r = base[i]; let m: Map<string, RegExpMatchArray[]> | null = null
        for (const c of columns) {
          const found = [...cellText(r, c).slice(0, GRID_RG_CELL).matchAll(re)]
          if (found.length) { (m ??= new Map()).set(c.key, found); hits += found.length }
        }
        if (m) { marks.set(r, m); if (!server) rows.push(r) }
      }
    }
    if (sort && !server) { const k = sort.key, d = sort.dir; rows.sort((a, b) => gridCmp(a[k], b[k], collator) * d) }
    return { rows, marks, hits, cut: server ? 0 : cut, of: base.length }
  }, [data, filter, rg, sort, columns, server, collator, dateFmt]) // eslint-disable-line react-hooks/exhaustive-deps
  const visible = search.rows, hits = search.hits
  const total = server ? (rowCount ?? data.length) : visible.length
  const pageCount = paged ? Math.max(1, Math.ceil(total / pageSize)) : 1
  const pg = paged ? clamp(page, 0, pageCount - 1) : 0
  const pageRows = useMemo(() => paged && !server ? visible.slice(pg * pageSize, pg * pageSize + pageSize) : visible, [visible, paged, server, pg, pageSize])
  const numCols = columns.filter(c => c.type === 'number')
  const groups = useMemo(() => {
    if (!groupBy || server) return null
    const m = new Map<string, T[]>(), c = col(groupBy)!
    pageRows.forEach(r => { const k = cellText(r, c); if (!m.has(k)) m.set(k, []); m.get(k)!.push(r) })
    const sum = (rs: T[]) => numCols[0] ? rs.reduce((s, r) => s + Number(r[numCols[0].key]), 0) : rs.length
    return [...m.entries()].sort((a, b) => sum(b[1]) - sum(a[1]))
  }, [pageRows, groupBy, server]) // eslint-disable-line react-hooks/exhaustive-deps
  const disp = useMemo<GridDisp<T>[] | null>(() => groups ? groups.flatMap(([g, rs]) => [{ g, rs }, ...(closed.has(g) ? [] : rs.map(r => ({ r })))]) : null, [groups, closed])
  const dispCount = disp ? disp.length : pageRows.length
  /** keyboard order: the rows in open groups, with their display index */
  const nav = useMemo(() => {
    const ids: GridKey[] = [], at: number[] = [], index = new Map<GridKey, number>()
    if (disp) disp.forEach((d, i) => { if (d.r) { const id = rowKey(d.r); index.set(id, ids.length); ids.push(id); at.push(i) } })
    else pageRows.forEach((r, i) => { const id = rowKey(r); index.set(id, i); ids.push(id); at.push(i) })
    return { ids, at, index }
  }, [disp, pageRows]) // eslint-disable-line react-hooks/exhaustive-deps

  /* when what the rows mean changes: back to page one, and an "all except" selection no longer applies */
  const resetForQuery = () => { setPage(0); if (selRef.current.mode === 'exclude') setSel(GRID_NO_SELECTION) }
  const resetRef = useRef(resetForQuery); resetRef.current = resetForQuery
  const setFilterRef = useRef(setFilterRaw); setFilterRef.current = setFilterRaw
  const setFilter = useCallback((f: GridGroup) => { setFilterRef.current(f); resetRef.current() }, []) // stable, so the memoised filter bar skips scroll renders
  const setSort = (s: GridSort<T> | null) => { setSortRaw(s); resetForQuery() }
  const firstQ = useRef(true)
  useEffect(() => { if (firstQ.current) { firstQ.current = false; return } onSearchChange?.(q); resetRef.current() }, [q]) // eslint-disable-line react-hooks/exhaustive-deps

  /* ---- selection ---- */
  const pageIds = useMemo(() => pageRows.map(rowKey), [pageRows]) // eslint-disable-line react-hooks/exhaustive-deps
  const { allSel, someSel } = useMemo(() => {
    let all = pageIds.length > 0, some = false
    for (const id of pageIds) { if (gridIsSelected(sel, id)) some = true; else all = false; if (some && !all) break }
    return { allSel: all, someSel: some }
  }, [pageIds, sel])
  const selCount = gridSelectedCount(sel, total)
  const headCb = useRef<HTMLInputElement>(null)
  useEffect(() => { if (headCb.current) headCb.current.indeterminate = someSel && !allSel })
  const isSel = (id: GridKey) => gridIsSelected(sel, id)
  const toggleRow = (id: GridKey, on: boolean, shift: boolean) => {
    const prev = last.current
    const a = prev != null ? nav.index.get(prev) : undefined, b = nav.index.get(id)
    const ids = shift && a != null && b != null ? nav.ids.slice(Math.min(a, b), Math.max(a, b) + 1) : [id]
    setSel(gridSelWith(selRef.current, ids, on))
    last.current = id
  }
  const setMany = (ids: readonly GridKey[], on: boolean) => setSel(gridSelWith(selRef.current, ids, on))
  const selectedLoaded = () => dataRef.current.filter(r => gridIsSelected(selRef.current, rowKey(r)))
  const del = () => {
    const before = dataRef.current, removed = selectedLoaded(), n = removed.length, gone = new Set(removed)
    commit(before.filter(r => !gone.has(r))); setSel(GRID_NO_SELECTION)
    const undo = () => {
      const cur = new Map(dataRef.current.map(r => [rowKey(r), r])), back = new Set(removed)
      const restored = before.flatMap(r => back.has(r) ? [r] : cur.has(rowKey(r)) ? [cur.get(rowKey(r))!] : [])
      const known = new Set(before.map(rowKey))
      commit([...restored, ...dataRef.current.filter(r => !known.has(rowKey(r)))])
    }
    toast({ title: `Deleted ${plural(n, 'row')}`, action: { label: 'Undo', onClick: undo } })
  }
  const exp = () => { const rs = selectedLoaded(); if (onExport) onExport(rs, selRef.current); else toast({ title: `Exported ${plural(selCount, 'row')}`, description: 'CSV ready' }) }
  const canSelectAll = sel.mode === 'include' && allSel && total > pageIds.length
  const selectAll = () => setSel(server ? { mode: 'exclude', keys: new Set() } : { mode: 'include', keys: new Set(visible.map(rowKey)) })

  /* ---- resize ---- */
  const rz = useRef<{ k: string; w0: number; w: number } | null>(null)
  const resize = usePointerDrag({
    cursor: 'col-resize',
    // the handle sits on the column's right edge: dragging right widens it
    onMove: p => { const r = rz.current; if (r) { r.w = Math.max(60, r.w0 + p.dx); setWidths(w => ({ ...w, [r.k]: r.w })) } },
    onEnd: () => { const r = rz.current; rz.current = null; setResizing(null); if (r && r.w !== r.w0) onColumnResize?.(r.k, r.w) },
  })
  const startResize = (e: React.PointerEvent<HTMLSpanElement>, k: string) => {
    if (e.button !== 0) return
    e.preventDefault(); e.stopPropagation()
    const w0 = widths[k] ?? col(k)?.width ?? 120
    rz.current = { k, w0, w: w0 }; setResizing(k); resize.start(e)
  }

  /* ---- drag a header to reorder (mouse and pen; touch uses the Columns menu, so horizontal scrolling still works) ---- */
  const [colDrag, setColDrag] = useState<{ k: string; over: string; after: boolean } | null>(null)
  const colDragRef = useRef<{ k: string; rects: { k: string; mid: number }[]; over: string; after: boolean } | null>(null)
  const dragged = useRef(false)
  const headDrag = usePointerDrag({
    cursor: 'grabbing',
    onMove: p => {
      const d = colDragRef.current; if (!d || !d.rects.length) return
      const hit = d.rects.find(r => p.x < r.mid), over = hit ? hit.k : d.rects[d.rects.length - 1].k, after = !hit
      if (over !== d.over || after !== d.after) { d.over = over; d.after = after; setColDrag({ k: d.k, over, after }) }
    },
    onEnd: (_, cancelled) => {
      const d = colDragRef.current; colDragRef.current = null; setColDrag(null)
      if (d && !cancelled && (d.over !== d.k)) { moveColTo(d.k, d.over, d.after); setSaid(`${col(d.k)?.label ?? d.k} moved`) }
      setTimeout(() => { dragged.current = false }) // the click that ends a drag lands on the header, not its sort button
    },
  })
  const onHeadPointerDown = (e: React.PointerEvent<HTMLTableCellElement>, k: string) => {
    if (e.button !== 0 || e.pointerType === 'touch' || resizing) return
    const th = e.currentTarget, x0 = e.clientX, id = e.pointerId
    const move = (ev: PointerEvent) => {
      if (ev.pointerId !== id || Math.abs(ev.clientX - x0) < 6) return
      off()
      const zone = pinOf(k)
      // one batch of reads at the start of the drag
      const rects = cols.filter(c => pinOf(c.key) === zone).map(c => {
        const r = tableRef.current?.querySelector<HTMLElement>(`th[data-ck="${CSS.escape(c.key)}"]`)?.getBoundingClientRect()
        return { k: c.key as string, mid: r ? r.left + r.width / 2 : 0 }
      })
      colDragRef.current = { k, rects, over: k, after: false }; dragged.current = true
      setColDrag({ k, over: k, after: false })
      headDrag.start({ pointerId: id, clientX: ev.clientX, clientY: ev.clientY, currentTarget: th, nativeEvent: ev }, th)
    }
    const off = () => { removeEventListener('pointermove', move, true); removeEventListener('pointerup', off, true); removeEventListener('pointercancel', off, true) }
    addEventListener('pointermove', move, true); addEventListener('pointerup', off, true); addEventListener('pointercancel', off, true)
  }
  const headerKey = (e: RKeyboardEvent, k: string) => {
    const key = e.key
    if (!(e.ctrlKey || e.metaKey) || !e.shiftKey || (key !== 'ArrowLeft' && key !== 'ArrowRight')) return
    e.preventDefault()

    if (moveCol(k, key === 'ArrowLeft' ? -1 : 1)) requestAnimationFrame(() => tableRef.current?.querySelector<HTMLElement>(`th[data-ck="${CSS.escape(k)}"] button`)?.focus())
  }

  /* ---- edit ---- */
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

  /* ---- virtual rows ---- */
  const virtualOn = virtualize === true || (virtualize !== false && (!!onLoadMore || dispCount > (typeof virtualize === 'number' ? virtualize : GRID_VIRTUAL_AT)))
  const tab = cursor && nav.index.has(cursor.id) && cols.some(c => c.key === cursor.key) ? cursor : nav.ids.length && cols[0] ? { id: nav.ids[0], key: cols[0].key as string } : null
  const tabAt = tab ? nav.at[nav.index.get(tab.id)!] : -1
  const estimate = useMemo(() => disp ? (i: number) => disp[i]?.g !== undefined ? GRID_GROUP_H : rowH : rowH, [disp, rowH])
  const keep = useMemo(() => tabAt >= 0 ? [tabAt] : undefined, [tabAt])
  const loadingRef = useRef(loading); loadingRef.current = loading
  const hasMoreRef = useRef(hasMore); hasMoreRef.current = hasMore
  const v = useVirtual({
    count: dispCount, estimateSize: estimate, scrollRef: scrollEl, enabled: virtualOn, paddingStart: rowH, scrollPaddingStart: rowH,
    getItemKey: i => { const d = disp?.[i]; return d ? (d.g !== undefined ? `g:${d.g}` : rowKey(d.r)) : rowKey(pageRows[i]) },
    initialRect: { width: 800, height: maxHeight }, keep,
    onEndReached: onLoadMore ? () => { if (hasMoreRef.current && !loadingRef.current) onLoadMore() } : undefined,
  })
  const vRef = useRef(v); vRef.current = v
  const firstScroll = useRef(true)
  useEffect(() => { if (firstScroll.current) { firstScroll.current = false; return } vRef.current.scrollToOffset(0) }, [pg, filter, q])

  /* ---- keyboard ---- */
  const td = 'h-[38px] overflow-hidden border-b border-[var(--line)] bg-[var(--card)] px-2.5 text-ellipsis whitespace-nowrap [@media(pointer:coarse)]:h-11'
  const sticky0 = 'sticky start-0 z-[1] w-10 px-0 text-center'
  const cb = 'm-0 h-3.5 w-3.5 cursor-pointer accent-[var(--primary)] [@media(pointer:coarse)]:h-[18px] [@media(pointer:coarse)]:w-[18px]'
  /** the whole checkbox cell is the hit area (a finger-sized label around the small native box) */
  const cbWrap = 'mx-auto flex h-full min-h-9 w-full min-w-9 cursor-pointer items-center justify-center'
  const onCell = (r: T, c: GridColumn<T>) => {
    if (ptr.current === 'mouse' || !canEdit(c)) return
    const id = rowKey(r)
    if (active?.id === id && active.key === c.key) { setActive(null); setEdit({ id, key: c.key }) } else setActive({ id, key: c.key })
  }
  const cellEl = (id: GridKey, key: string) => tableRef.current?.querySelector<HTMLElement>(`[data-gr="${CSS.escape(String(id))}"][data-gk="${CSS.escape(key)}"]`)
  /** move the Tab stop to a cell: scroll its row into view (rendering it if it was virtualised away), then focus it */
  const focusCell = (id: GridKey, key: string) => {
    setCursor({ id, key })
    const ni = nav.index.get(id)
    if (ni != null && virtualOn) v.scrollToIndex(nav.at[ni], { align: 'auto' })
    const el = cellEl(id, key)
    if (el) el.focus({ preventScroll: false }); else pendingFocus.current = { id, key }
  }
  useLayoutEffect(() => {
    const p = pendingFocus.current; if (!p) return
    const el = cellEl(p.id, p.key); if (el) { pendingFocus.current = null; el.focus({ preventScroll: false }) }
  })
  const onCellKey = (e: RKeyboardEvent, r: T, c: GridColumn<T>) => {
    if (e.target !== e.currentTarget || e.nativeEvent.isComposing) return
    const id = rowKey(r), ri = nav.index.get(id) ?? 0, ci = cols.findIndex(x => x.key === c.key)
    const to = (rr: number, cc: number) => { e.preventDefault(); if (!nav.ids.length) return; focusCell(nav.ids[clamp(rr, 0, nav.ids.length - 1)], cols[clamp(cc, 0, cols.length - 1)].key) }
    const pageRowsN = Math.max(1, Math.floor((v.viewportSize - rowH) / rowH) - 1)
    switch (e.key) {
      case 'ArrowDown': return to(ri + 1, ci)
      case 'ArrowUp': return to(ri - 1, ci)
      case 'ArrowRight': return to(ri, ci + 1)
      case 'ArrowLeft': return to(ri, ci - 1)
      case 'Home': return to(e.ctrlKey || e.metaKey ? 0 : ri, 0)
      case 'End': return to(e.ctrlKey || e.metaKey ? nav.ids.length - 1 : ri, cols.length - 1)
      case 'PageDown': return to(ri + pageRowsN, ci)
      case 'PageUp': return to(ri - pageRowsN, ci)
      case 'Enter': case 'F2': if (canEdit(c)) { e.preventDefault(); setCursor({ id, key: c.key }); setEdit({ id, key: c.key }) } return
      case ' ': e.preventDefault(); toggleRow(id, !isSel(id), e.shiftKey); return
    }
  }
  /** close the editor and put keyboard focus back on its cell */
  const closeEdit = (r: T, c: GridColumn<T>, value: string | null) => {
    const id = rowKey(r)
    if (value === null) setEdit(null); else save(r, c, value)
    cellEl(id, c.key)?.focus({ preventScroll: true })
  }

  /* ---- rows ---- */
  const rowBase = paged ? pg * pageSize : 0
  const animateRows = !virtualOn
  const hoverBg = 'group-hover/row:bg-[color-mix(in_srgb,var(--muted)_55%,var(--card))]'
  /* Rows are memoised (GridRow): scrolling a virtual grid only renders the rows that enter the view. Their handlers go
     through `H`, so a row that skipped a render still acts on the current filter, selection and columns. */
  const H = useRef({ toggleRow, setEdit, onCell, setCursor, onCellKey, closeEdit, save, setActive, cellText })
  H.current = { toggleRow, setEdit, onCell, setCursor, onCellKey, closeEdit, save, setActive, cellText }
  const stickKey = cols.map(c => { const st = stick.get(c.key); return st ? `${c.key}:${st.side}${st.at}${st.edge ? '|' : ''}` : c.key }).join(',')
  const drawRow = (r: T, di: number, p: GridRowProps<T>): ReactElement => {
    const id = rowKey(r), on = p.on, h = H.current
    const cells = <>
      <td className={cn(td, sticky0, hoverBg)}>
        <label className={cbWrap}><input type="checkbox" className={cb} checked={on} aria-label={`Select ${rowLabel?.(r) ?? id}`} onChange={() => {}} onClick={e => H.current.toggleRow(id, e.currentTarget.checked, e.shiftKey)} /></label>
      </td>
      {p.cols.map(c => {
        const editing = p.editKey === c.key, text = h.cellText(r, c), content = gridMark(text, p.marks?.get(c.key))
        const picked = !editing && p.activeKey === c.key
        return (
          <td key={c.key} data-gr={String(id)} data-gk={c.key} tabIndex={p.tabKey === c.key && !editing ? 0 : -1} style={pinStyle(c.key)}
            onDoubleClick={() => canEdit(c) && H.current.setEdit({ id, key: c.key })} title={canEdit(c) ? 'Double-click or press Enter to edit' : undefined}
            onPointerDown={e => { ptr.current = e.pointerType }} onClick={() => H.current.onCell(r, c)} onFocus={e => { if (e.target === e.currentTarget) H.current.setCursor({ id, key: c.key }) }}
            onKeyDown={e => H.current.onCellKey(e, r, c)} aria-readonly={!canEdit(c) || undefined}
            className={cn(td, 'relative outline-none focus-visible:shadow-[inset_0_0_0_2px_var(--accent)]', hoverBg, pinCls(c.key), c.type === 'number' && 'text-end tabular-nums', editing && '!p-0 shadow-[inset_0_0_0_2px_var(--accent)]',
              picked && 'shadow-[inset_0_0_0_2px_color-mix(in_srgb,var(--accent)_55%,transparent)]', picked && (c.type === 'number' ? '!ps-10' : '!pe-10'))}>
            {editing
              ? <input autoFocus defaultValue={String(r[c.key] ?? '')} aria-label={`Edit ${c.label}`} onFocus={e => e.currentTarget.select()}
                onKeyDown={e => {
                  if (e.nativeEvent.isComposing) return
                  if (e.key === 'Enter' || e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); H.current.closeEdit(r, c, e.key === 'Enter' ? e.currentTarget.value : null) }
                }} onBlur={e => H.current.save(r, c, e.currentTarget.value)}
                className={cn('h-full w-full border-0 bg-[var(--card)] px-2.5 text-[13px] text-[var(--fg)] shadow-[inset_0_0_0_2px_var(--accent)] outline-none [@media(pointer:coarse)]:!text-base', c.type === 'number' && 'text-end tabular-nums')} />
              : <>
                {p.flash && p.flash.key === c.key && (
                  <motion.span key={p.flash.n} aria-hidden className="pointer-events-none absolute inset-0 bg-[var(--accent-soft)]" initial={{ opacity: 1 }} animate={{ opacity: 0 }} transition={{ duration: 0.8 }} />
                )}
                <span className="relative">{c.render ? c.render(r, content) : content}</span>
                {picked && (
                  <button aria-label={`Edit ${c.label}`} onClick={e => { e.stopPropagation(); H.current.setActive(null); H.current.setEdit({ id, key: c.key }) }}
                    className={cn('absolute top-1/2 grid h-8 w-8 -translate-y-1/2 cursor-pointer place-items-center rounded-[var(--r-md)] border-0 bg-[var(--accent-soft)] text-[var(--accent)]', c.type === 'number' ? 'start-1' : 'end-1')}>
                    <Icon name="edit" size={14} />
                  </button>
                )}
              </>}
          </td>
        )
      })}
    </>
    const rowCls = cn('group/row', on && '[&>td]:!bg-[var(--accent-soft)]')
    const aria = { 'aria-rowindex': p.ri, 'aria-selected': on }
    return p.anim
      ? <motion.tr data-index={di} {...aria} layout="position" transition={spring(0.12, 0.45)} className={rowCls}>{cells}</motion.tr>
      : <tr data-index={di} ref={p.measure} {...aria} className={rowCls}>{cells}</tr>
  }
  const draw = useRef(drawRow); draw.current = drawRow
  const rowView = (r: T, di: number) => {
    const id = rowKey(r)
    return <GridRowMemo<T> key={id} r={r} di={di} ri={rowBase + di + 2} on={isSel(id)} tabKey={tab?.id === id ? tab.key : null} editKey={edit?.id === id ? edit.key : null}
      activeKey={active?.id === id ? active.key : null} flash={flash?.id === id ? flash : null} marks={search.marks.get(r)} cols={cols} stickKey={stickKey}
      anim={animateRows} measure={v.measureElement} draw={draw} />
  }
  const defaultSummary = (rs: T[]) => numCols.map((c, i) => <span key={c.key}>{i > 0 && ' · '}{c.label} <b className="font-[family-name:var(--mono)] font-semibold text-[var(--fg2)]">{fmt.number(rs.reduce((s, r) => s + Number(r[c.key]), 0))}</b></span>)
  const groupCol = groupBy ? col(groupBy) : undefined
  const groupView = (k: string, rs: T[], di: number) => {
    const open = !closed.has(k), ids = rs.map(rowKey), all = ids.every(id => isSel(id))
    const firstPinned = cols[0] ? stick.get(cols[0].key) : undefined
    return (
      <tr key={`g:${k}`} data-index={di} ref={animateRows ? undefined : v.measureElement} aria-rowindex={rowBase + di + 2}>
        <td className={cn(td, sticky0, '!h-9 !bg-[color-mix(in_srgb,var(--muted)_60%,var(--card))]')}>
          <label className={cbWrap}><input type="checkbox" className={cb} checked={all} aria-label={`Select group ${k}`} onChange={e => setMany(ids, e.currentTarget.checked)} /></label>
        </td>
        <td colSpan={cols.length} style={firstPinned?.side === 'start' ? { insetInlineStart: 40 } : undefined}
          className={cn(td, firstPinned?.side === 'start' && 'sticky z-[1]', '!h-9 overflow-visible !bg-[color-mix(in_srgb,var(--muted)_60%,var(--card))]')}>
          <button aria-expanded={open} onClick={() => setClosed(s => { const n = new Set(s); if (n.has(k)) n.delete(k); else n.add(k); return n })}
            className="inline-flex cursor-pointer items-center gap-2 border-0 bg-transparent p-0 text-[13px] font-medium text-[var(--fg)] [@media(pointer:coarse)]:min-h-9">
            <motion.span className="grid text-[var(--fg3)]" initial={false} animate={{ rotate: open ? 90 : 0 }} transition={{ duration: 0.2 }}><Icon name="chevronRight" size={11} strokeWidth={2.5} /></motion.span>
            {groupCol?.render ? groupCol.render(rs[0], k) : <b className="font-semibold">{k}</b>}
            <span className="text-xs font-normal text-[var(--fg3)]">{plural(rs.length, 'row')}</span>

          </button>
          <span className="sticky start-full float-end pe-1 text-xs text-[var(--fg3)]">{(groupSummary ?? defaultSummary)(rs)}</span>
        </td>
      </tr>
    )
  }
  const nCols = cols.length + 1
  const spacer = (key: string, h: number) => <tr key={key} aria-hidden className="pointer-events-none"><td colSpan={nCols} style={{ height: h, padding: 0, border: 0 }} /></tr>
  const body: ReactNode[] = []
  {
    let at = rowH
    for (const it of v.items) {
      if (virtualOn && it.start - at > 0.5) body.push(spacer(`sp:${it.index}`, it.start - at))
      const d = disp ? disp[it.index] : null
      body.push(d ? (d.g !== undefined ? groupView(d.g, d.rs, it.index) : rowView(d.r, it.index)) : rowView(pageRows[it.index], it.index))
      at = it.end
    }
    if (virtualOn && v.totalSize - at > 0.5) body.push(spacer('sp:end', v.totalSize - at))
  }
  const skeletonRows = (n: number, key: string) => Array.from({ length: n }, (_, i) => (
    <tr key={`${key}${i}`} aria-hidden>
      <td className={cn(td, sticky0)} />
      {cols.map((c, j) => <td key={c.key} style={pinStyle(c.key)} className={cn(td, pinCls(c.key))}><Skeleton className={cn('h-3', j % 3 === 0 ? 'w-3/4' : j % 3 === 1 ? 'w-1/2' : 'w-2/3', c.type === 'number' && 'ms-auto')} /></td>)}
    </tr>
  ))
  const infinite = !!onLoadMore
  const rowCountAria = disp ? dispCount + 1 : infinite ? (rowCount != null ? rowCount + 1 : hasMore ? -1 : dispCount + 1) : total + 1

  const fields: [string, string][] = useMemo(() => columns.map(c => [c.key, c.label]), [columns])
  const defaultField = (columns.find((c, i) => i > 0 && c.type !== 'number' && !c.options) ?? columns[0]).key
  const groupKeys = groups?.map(g => g[0]) ?? []
  const allClosed = groupKeys.length > 0 && groupKeys.every(k => closed.has(k))
  const rgToggle = (f: 'cs' | 'w' | 'rx', label: string, title: string) => (
    <button aria-pressed={flags[f]} title={title} onClick={() => setFlags(x => ({ ...x, [f]: !x[f] }))}
      className={cn('h-5 min-w-6 cursor-pointer rounded-[var(--r-sm)] border-0 px-1 font-[family-name:var(--mono)] text-[11px] font-semibold [@media(pointer:coarse)]:h-8 [@media(pointer:coarse)]:min-w-8 [@media(pointer:coarse)]:text-xs', flags[f] ? 'bg-[var(--accent-soft)] text-[color-mix(in_srgb,var(--accent)_78%,var(--fg))]' : 'bg-transparent text-[var(--fg3)] hover:bg-[var(--muted)] hover:text-[var(--fg)]')}>{label}</button>
  )
  const fmtN = (n: number) => fmt.number(n)
  const count = server ? plural(total, 'row') : `${fmtN(visible.length)} of ${plural(data.length, 'row')}`
  const startW = cols.reduce((s, c, i) => s + (stick.get(c.key)?.side === 'start' ? colW(c, i) : 0), 40)
  const endW = cols.reduce((s, c, i) => s + (stick.get(c.key)?.side === 'end' ? colW(c, i) : 0), 0)
  /** the checkbox column plus every visible column, exactly as the colgroup declares them */
  const tableW = cols.reduce((s, c, i) => s + colW(c, i), 40)
  const visibleCols = cols.length

  /** "Jump to rows": focus the grid's current cell (the one Tab would reach) */
  const jumpToRows = () => { if (tab) focusCell(tab.id, tab.key) }
  return (
    <div ref={gridBox} className={cn('relative flex min-w-0 flex-col', className)}>
      <button type="button" onClick={jumpToRows}
        className="sr-only z-[9] rounded-[var(--r-md)] bg-[var(--primary)] px-3 py-1.5 text-xs font-medium text-[var(--on-primary)] focus-visible:not-sr-only focus-visible:absolute focus-visible:top-2 focus-visible:end-2">{'Jump to rows'}</button>
      <GridFilterBuilderMemo tree={filter} onChange={setFilter} schema={schema} fields={fields} defaultField={defaultField} count={count} />
      <div className="flex flex-wrap items-center gap-2 border-x border-[var(--line)] bg-[var(--card)] p-2">
        <div className={cn(inputShellClass(!!rg.err), GRID_FOCUS_RING, 'flex h-7 min-w-[200px] flex-[0_1_380px] items-center pe-1 [@media(pointer:coarse)]:h-10', narrow && '!flex-[1_1_100%]')}>

          <span aria-hidden className="grid h-full place-items-center border-e border-[var(--line)] px-2 font-[family-name:var(--mono)] text-[11px] font-semibold text-[var(--fg3)]">rg</span>
          <input value={qInput} maxLength={GRID_RG_MAX + 50} onChange={e => setQInput(e.target.value)} placeholder={'search every cell, regex ok: north|quill'} spellCheck={false} autoComplete="off"
            onKeyDown={e => { if (e.key === 'Escape') { setQInput(''); setQ('') } if (e.key === 'ArrowDown' && !e.altKey) { e.preventDefault(); jumpToRows() } }}
            aria-label={'Search rows (ripgrep style)'} aria-invalid={!!rg.err || undefined} aria-keyshortcuts="ArrowDown" aria-description={'Down arrow jumps to the rows'}
            className={cn('h-full min-w-0 flex-1 border-0 bg-transparent px-2 font-[family-name:var(--mono)] text-xs text-[var(--fg)] outline-none placeholder:text-[var(--fg3)]', TOUCH.input)} />
          {rgToggle('cs', 'Aa', 'Match case (otherwise smart case, like rg -S)')}{rgToggle('w', '\\b', 'Whole word (-w)')}{rgToggle('rx', '.*', 'Regular expression (off = literal, like -F)')}
        </div>
        <span className="flex items-center gap-1.5 text-xs text-[var(--fg3)]" aria-live="polite">
          {loading && <><Spinner size={12} label={'Loading rows'} /><span aria-hidden>{'Loading…'}</span></>}
          {rg.err ? <span className="text-[var(--bad)]">{rg.err}</span> : rg.re ? <span>{server ? `${plural(hits, 'match', 'matches')} on this page` : `${plural(hits, 'match', 'matches')} in ${plural(visible.length, 'row')}`}
            {search.cut > 0 && <span className="text-[var(--warn)]">{` · search too slow, showing the first ${search.cut} of ${search.of} rows`}</span>}</span> : ''}
        </span>
        <span className={cn('ms-auto flex flex-wrap items-center gap-2', narrow && 'w-full')}>
          {!server && groupable && groupable.length > 0 && (
            <span className={cn('flex items-center gap-2 text-xs text-[var(--fg3)]', narrow && 'flex-1 [&>div]:flex-1 [&>div>button]:!w-full')}>{'Group by'}
              <GridPick label={'Group by'} variant="toolbar" value={groupBy} onChange={g => { setGroupBy(g); setClosed(new Set()) }}
                options={[['', 'None'], ...groupable.map(k => [k, col(k)?.label ?? k] as [string, string])]} />
            </span>
          )}
          {groupBy && !server && <Button size="sm" variant="ghost" onClick={() => setClosed(allClosed ? new Set() : new Set(groupKeys))} className="[@media(pointer:coarse)]:!h-9">{allClosed ? 'Expand all' : 'Collapse all'}</Button>}
          <Popover>
            <PopoverTrigger size="sm" variant="ghost" className="gap-1.5 [@media(pointer:coarse)]:!h-9" title={'Show, hide, pin and reorder columns'}><Icon name="columns" size={14} />{'Columns'}</PopoverTrigger>
            <PopoverContent placement="bottom-end" aria-label={'Columns'} className="w-[min(300px,calc(100vw-16px))] p-1.5">
              <div role="group" aria-label={'Show, pin and order columns'} className="flex flex-col">
                {arranged.map((c, i) => {
                  const shown = !hidden.includes(c.key), pin = pinOf(c.key), zone = arranged.filter(x => pinOf(x.key) === pin), zi = zone.indexOf(c)
                  return (
                    <div key={c.key} className={cn('flex h-8 items-center gap-0.5 rounded-[var(--r-md)] ps-1.5 [@media(pointer:coarse)]:h-10', i > 0 && pinOf(arranged[i - 1].key) !== pin && 'mt-1 border-t border-[var(--line)] pt-1')}>
                      <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 text-[13px]">
                        <input type="checkbox" className={cb} checked={shown} disabled={shown && visibleCols === 1} onChange={() => toggleHidden(c.key)} aria-label={`Show ${c.label}`} />
                        <span className={cn('truncate', !shown && 'text-[var(--fg3)]')}>{c.label}</span>
                      </label>
                      {/* start, then end: the icons and names say which screen edge that is */}
                      <IconButton size="icon-xs" icon="pinLeft" label={`Pin ${c.label} left`} aria-pressed={pin === 'start'} onClick={() => setPin(c.key, pin === 'start' ? null : 'start')} className={pin === 'start' ? '!text-[var(--accent)]' : undefined} />
                      <IconButton size="icon-xs" icon="pinRight" label={`Pin ${c.label} right`} aria-pressed={pin === 'end'} onClick={() => setPin(c.key, pin === 'end' ? null : 'end')} className={pin === 'end' ? '!text-[var(--accent)]' : undefined} />
                      <IconButton size="icon-xs" icon="chevronUp" label={`Move ${c.label} left`} disabled={zi <= 0} onClick={() => moveCol(c.key, -1, false)} />
                      <IconButton size="icon-xs" icon="chevronDown" label={`Move ${c.label} right`} disabled={zi >= zone.length - 1} onClick={() => moveCol(c.key, 1, false)} />
                    </div>
                  )
                })}
              </div>
              <div className="mt-1 flex justify-end border-t border-[var(--line)] pt-1">
                <Button size="xs" variant="ghost" onClick={() => { setOrder(allKeys); setHidden(columns.filter(c => c.hidden).map(c => c.key)); setPinsRaw(initialPins); setSaid('Columns reset') }}>{'Reset columns'}</Button>
              </div>
            </PopoverContent>
          </Popover>
        </span>
        <span className="sr-only" aria-live="polite">{said}</span>
      </div>
      {error != null && error !== false && (
        <div role="alert" className="flex flex-wrap items-center gap-2 border-x border-t border-[var(--line)] bg-[var(--bad-soft)] px-3 py-2 text-[13px] text-[var(--fg)]">
          <Icon name="alert" size={14} className="text-[var(--bad)]" /><span className="min-w-0 flex-1">{error}</span>
          {onRetry && <Button size="xs" onClick={onRetry}>{'Retry'}</Button>}
        </div>
      )}
      <div className="relative min-w-0">
      <div ref={scroller} aria-busy={loading || undefined} className={cn('relative overflow-auto overscroll-x-contain border border-[var(--line)] bg-[var(--card)]', paged ? 'rounded-none' : 'rounded-b-[var(--r-md)]')}
        style={{ maxHeight, scrollPaddingTop: rowH, scrollPaddingInlineStart: startW, scrollPaddingInlineEnd: endW }}>
        {/* The table's width is the sum of its columns (at least the scroller's): with `width: auto` a browser ignores
            `table-layout: fixed` and sizes columns from their content, so cells drift from the widths the sticky offsets
            are computed from (a gap, or an overlap, between pinned columns). */}
        <table ref={tableRef} role="grid" aria-label={ariaLabelProp ?? 'Rows'} aria-rowcount={rowCountAria} aria-colcount={nCols} aria-multiselectable="true"
          style={{ width: tableW, minWidth: '100%' }}
          className={cn('table-fixed border-separate border-spacing-0 text-[13px] transition-opacity', loading && dispCount > 0 && !infinite && 'opacity-60')}>
          {/* on a phone the first pinned column is capped so the rest of the row has room to scroll past it */}
          <colgroup><col style={{ width: 40 }} />{cols.map((c, i) => <col key={c.key} style={{ width: colW(c, i) }} />)}</colgroup>
          <thead>
            <tr aria-rowindex={1}>
              <th className={cn(td, sticky0, 'top-0 z-[3] bg-[color-mix(in_srgb,var(--muted)_50%,var(--card))]')}>
                <label className={cbWrap}><input ref={headCb} type="checkbox" className={cb} checked={allSel} aria-label={'Select all'} onChange={e => setMany(pageIds, e.currentTarget.checked)} /></label>
              </th>
              {cols.map(c => {
                const dragOver = colDrag && colDrag.over === c.key && colDrag.k !== c.key
                return (
                  <th key={c.key} data-ck={c.key} aria-sort={sort?.key === c.key ? (sort.dir === 1 ? 'ascending' : 'descending') : undefined} style={pinStyle(c.key)}
                    onPointerDown={e => onHeadPointerDown(e, c.key)}
                    className={cn(td, 'sticky top-0 z-[2] cursor-pointer bg-[color-mix(in_srgb,var(--muted)_50%,var(--card))] text-xs font-medium text-[var(--fg2)] select-none hover:text-[var(--fg)]', pinCls(c.key, true), c.type === 'number' ? 'text-end' : 'text-start',
                      // the drop line on the right (after) or left (before) edge
                      colDrag?.k === c.key && 'opacity-50', dragOver && (colDrag.after ? '!shadow-[inset_-2px_0_0_var(--accent)]' : '!shadow-[inset_2px_0_0_var(--accent)]'))}>
                    <button onClick={() => { if (dragged.current) { dragged.current = false; return } setSort({ key: c.key, dir: sort?.key === c.key ? (-sort.dir as 1 | -1) : 1 }) }}
                      onKeyDown={e => headerKey(e, c.key)} aria-keyshortcuts="Control+Shift+ArrowLeft Control+Shift+ArrowRight" aria-description={'Ctrl+Shift+arrows move the column'}
                      className={cn('cursor-pointer border-0 bg-transparent p-0 font-[inherit] text-inherit [@media(pointer:coarse)]:text-start', TOUCH.tap36)}>{c.label}{sort?.key === c.key && <span className="ms-1 text-[11px] text-[var(--accent)]">{sort.dir > 0 ? '▲' : '▼'}</span>}</button>
                    <span role="separator" aria-orientation="vertical" aria-label={`Resize ${c.label}`} onPointerDown={e => startResize(e, c.key)}
                      className="group/rz absolute top-0 end-0 bottom-0 w-[7px] cursor-col-resize touch-none [@media(pointer:coarse)]:w-4">
                      <span className={cn('absolute top-[9px] end-[3px] bottom-[9px] w-px bg-[var(--line2)] group-hover/rz:w-0.5 group-hover/rz:bg-[var(--accent)]', resizing === c.key && '!w-0.5 !bg-[var(--accent)]')} />
                    </span>
                  </th>
                )
              })}
            </tr>
          </thead>
          <tbody>
            {!dispCount && !loading && <tr><td colSpan={nCols} className="p-10 text-center text-[var(--fg3)]">{error != null && error !== false ? 'Couldn’t load rows' : server ? 'No rows' : 'No rows match these filters'}</td></tr>}
            {!dispCount && loading && skeletonRows(Math.max(3, Math.min(10, Math.floor(maxHeight / rowH) - 1)), 'sk')}
            {body}
            {infinite && loading && hasMore && dispCount > 0 && skeletonRows(3, 'more')}
          </tbody>
        </table>
      </div>
      <ScrollEdges {...edges} hint={'More columns'} />
      </div>
      {paged && (
        <div role="navigation" aria-label={`${ariaLabelProp ?? 'Rows'}: pages`} className="flex flex-wrap items-center justify-end gap-x-3 gap-y-1 rounded-b-[var(--r-md)] border border-t-0 border-[var(--line)] bg-[var(--card)] px-2 py-1.5 text-xs text-[var(--fg3)]">
          {pageSizes && pageSizes.length > 1 && (
            <span className="me-auto flex items-center gap-2">{'Rows per page'}
              <GridPick label={'Rows per page'} variant="toolbar" value={String(pageSize)} options={pageSizes.map(n => [String(n), fmtN(n)])} onChange={x => { setPageSize(Number(x)); setPage(0) }} className="[&>button]:!min-w-[72px]" />
            </span>
          )}
          <span className="ui-num">{total ? `${fmtN(pg * pageSize + 1)}–${fmtN(Math.min(total, pg * pageSize + pageSize))} of ${fmtN(total)}` : plural(0, 'row')}</span>
          <span className="flex items-center gap-1">
            <IconButton size="icon-sm" icon="chevronLeft" label={'Previous page'} disabled={pg <= 0} onClick={() => setPage(pg - 1)} />
            <span className="ui-num min-w-[86px] text-center" aria-live="polite">{`Page ${fmtN(pg + 1)} of ${fmtN(pageCount)}`}</span>
            <IconButton size="icon-sm" icon="chevronRight" label={'Next page'} disabled={pg >= pageCount - 1} onClick={() => setPage(pg + 1)} />
          </span>
        </div>
      )}
      <AnimatePresence initial={false}>
        {selCount > 0 && (
          <motion.div initial={{ height: 0, opacity: 0, marginTop: 0 }} animate={{ height: 'auto', opacity: 1, marginTop: 10 }} exit={{ height: 0, opacity: 0, marginTop: 0, transition: { duration: 0.18 } }} transition={spring(0.2, 0.35)}
            className="sticky bottom-2 z-[8] overflow-hidden rounded-[var(--r-md)] bg-[var(--primary)] text-[13px] text-[var(--on-primary)] shadow-[var(--shadow)]" role="region" aria-label={'Selection'}>
            <div className="flex min-h-11 flex-wrap items-center gap-x-2 gap-y-1 py-1.5 pe-2 ps-3 [@media(pointer:coarse)]:min-h-[52px]">
            <span className="ui-num whitespace-nowrap">{sel.mode === 'exclude' ? `All ${fmtN(selCount)} selected` : `${fmtN(selCount)} selected`}</span>
            {canSelectAll && <button onClick={selectAll} className="cursor-pointer border-0 bg-transparent px-1 text-xs font-medium underline underline-offset-2 [@media(pointer:coarse)]:min-h-9 [@media(pointer:coarse)]:text-[13px]">{`Select all ${fmtN(total)} rows`}</button>}
            <button onClick={() => setSel(GRID_NO_SELECTION)} className="cursor-pointer border-0 bg-transparent px-1 text-xs underline-offset-2 opacity-70 hover:underline hover:opacity-100 [@media(pointer:coarse)]:min-h-9 [@media(pointer:coarse)]:px-2.5 [@media(pointer:coarse)]:text-[13px]">{'Clear'}</button>
            <span className="flex-1" />
            <Button size="sm" onClick={exp} className={cn('!border-[color-mix(in_srgb,var(--on-primary)_30%,transparent)] !bg-transparent !text-inherit hover:!bg-[color-mix(in_srgb,var(--on-primary)_12%,transparent)]', TOUCH.tap36)}>{'Export'}</Button>
            {(!server || onDelete) && <Button size="sm" variant="danger" onClick={server ? () => onDelete!(selRef.current, selectedLoaded()) : del} className={TOUCH.tap36}>{'Delete'}</Button>}

            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
