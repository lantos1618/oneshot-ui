import { useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode, type Ref, type KeyboardEvent as RKeyboardEvent } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { type FormControlProps, Spinner, formDisabledClass, formReadOnlyClass, useFormControl, Button, Icon, type IconName, cn, inputClass, menuItemClass, spring, useCoarsePointer, useDisclosure, useRoving, composeRefs } from './core'
import { play } from './motion'
import { FloatingPanel, type Placement } from './overlay'
import { useVirtual } from './virtual'
import { formsPlacement, formsScrollIntoList, formsTriggerClass } from './formkit'
import { inputShellClass, CheckboxBox, type Option } from './fields'

/** Bold the first case-insensitive match of `query` inside `text` (for option lists and autocomplete). */
function formsHighlight(text: string, query?: string): ReactNode {
  const q = query?.trim()
  if (!q) return text
  const i = text.toLowerCase().indexOf(q.toLowerCase())
  if (i < 0) return text
  return <>{text.slice(0, i)}<mark className="bg-transparent font-semibold text-[var(--fg)]">{text.slice(i, i + q.length)}</mark>{text.slice(i + q.length)}</>
}

/** The nearest scrollable ancestor of `el` (the list's panel), or null. */
function formsScrollParent(el: HTMLElement | null): HTMLElement | null {
  let p = el?.parentElement ?? null
  while (p && p !== document.body && !/(auto|scroll)/.test(getComputedStyle(p).overflowY)) p = p.parentElement
  return p && p !== document.body ? p : null
}

/**
 * The option list shared by Select, Combobox, MultiSelect and the phone country picker. Keeps the active option scrolled
 * into view. Options with a `group` are listed under a heading (a role="group"). Past `virtualize` options (default 100)
 * only the rows in view are rendered (useVirtual on the panel that scrolls it); the active option is always rendered and
 * scrolled to, so aria-activedescendant keyboard navigation still works, and rows carry aria-setsize/aria-posinset.
 * Group headings are left out of a virtualised list.
 */
export function OptionList({ options, active, isSelected, onPick, onHover, id, multi, query, empty, label, className, virtualize = 100, busy }:
  { options: Option[]; active: number; isSelected: (o: Option) => boolean; onPick: (i: number) => void; onHover: (i: number) => void; id: string; multi?: boolean
    /** bolds the matching part of each label */ query?: string; empty?: ReactNode; /** accessible name of the listbox */ label?: string; className?: string
    /** render only visible rows past this many options (false: never) */ virtualize?: number | false
    /** results are loading (aria-busy) */ busy?: boolean }) {
  const first = useRef(true)
  const root = useRef<HTMLDivElement>(null), scroller = useRef<HTMLElement | null>(null)
  const virtual = virtualize !== false && options.length > virtualize
  useLayoutEffect(() => { // before useVirtual subscribes; looked up again only if the list moved
    if (!scroller.current?.contains(root.current)) scroller.current = formsScrollParent(root.current)
  })
  const coarse = useCoarsePointer()
  const v = useVirtual({ count: options.length, estimateSize: coarse ? 40 : 34, scrollRef: scroller, enabled: virtual, keep: active >= 0 && active < options.length ? [active] : undefined, overscan: 8 })
  useEffect(() => {
    if (virtual) { if (active >= 0 && active < options.length) v.scrollToIndex(active, { align: first.current ? 'center' : 'auto' }) }
    else { const el = document.getElementById(`${id}-${active}`); if (el) formsScrollIntoList(el, first.current) }
    first.current = false
  }, [active, id, options.length, virtual]) // eslint-disable-line react-hooks/exhaustive-deps
  if (!options.length) return <div ref={root} role="status" className={cn('p-3 text-center text-[13px] text-[var(--fg3)]', className)}>{empty ?? 'No matches'}</div>
  const row = (o: Option, i: number, style?: CSSProperties, animated = true) => {
    const sel = isSelected(o)
    const props = {
      id: `${id}-${i}`, role: 'option', 'aria-selected': sel, 'aria-disabled': o.disabled || undefined, 'data-active': i === active,
      onPointerMove: () => onHover(i), onPointerDown: (e: React.PointerEvent) => e.preventDefault(), onClick: () => !o.disabled && onPick(i),
      className: cn(menuItemClass, o.disabled && 'cursor-default text-[var(--fg3)] hover:bg-transparent'),
    }
    const body = (
      <>
        <span className="flex min-w-0 items-center gap-2">
          {multi && <CheckboxBox checked={sel} size={16} pop={false} />}
          {o.leading && <span className="flex-none leading-none">{o.leading}</span>}
          {o.dot && <span className="h-2 w-2 flex-none rounded-full" style={{ background: o.dot }} />}
          {o.icon && <Icon name={o.icon} size={15} className="text-[var(--fg3)]" />}
          <span className="truncate">{formsHighlight(o.label, query)}{o.hint && <span className="ms-2 text-xs text-[var(--fg3)]">{o.hint}</span>}</span>
        </span>
        {!multi && sel && <Icon name="check" size={14} />}
      </>
    )
    // keyed by position: while a filter narrows the list the rows stay put and only their text changes, so nothing
    // slides up under the finger (no layout shift); rows added at the end still fade in
    return animated
      ? <motion.div key={i} {...props} initial={{ opacity: 0, y: -3 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.18, delay: Math.min(i, 8) * 0.018 }}>{body}</motion.div>
      : <div key={i} {...props} {...v.setAria(i)} data-index={i} ref={v.measureElement} style={style}>{body}</div>
  }
  if (virtual) {
    return (
      <div ref={root} role="listbox" id={id} aria-label={label} aria-multiselectable={multi || undefined} aria-busy={busy || undefined} className={className}>
        <div style={{ height: v.totalSize, position: 'relative' }}>
          {v.items.map(it => row(options[it.index], it.index, { position: 'absolute', top: 0, left: 0, right: 0, transform: `translateY(${it.start}px)` }, false))}
        </div>
      </div>
    )
  }
  // consecutive options of one `group` go under its heading
  const blocks: { group?: string; from: number; items: Option[] }[] = []
  options.forEach((o, i) => { const last = blocks[blocks.length - 1]; if (last && last.group === o.group) last.items.push(o); else blocks.push({ group: o.group, from: i, items: [o] }) })
  return (
    <div ref={root} role="listbox" id={id} aria-label={label} aria-multiselectable={multi || undefined} aria-busy={busy || undefined} className={className}>
      {blocks.map(b => b.group === undefined ? b.items.map((o, k) => row(o, b.from + k)) : (
        <div key={`g${b.from}`} role="group" aria-labelledby={`${id}-g${b.from}`}>
          <div id={`${id}-g${b.from}`} role="presentation" className="px-2 pt-2 pb-1 text-[11px] font-medium tracking-wide text-[var(--fg3)] uppercase">{b.group}</div>
          {b.items.map((o, k) => row(o, b.from + k))}
        </div>
      ))}
    </div>
  )
}

/**
 * Custom select: arrows, Enter/Space, type-ahead that cycles through options starting with the typed letter
 * (works closed too), springs open, flips upward near the bottom of the viewport, checkmark on the current option.
 * Form-native: `name` submits the value ('' when none), `required`, `disabled`, `readOnly` (doesn't open), `invalid`,
 * `onBlur`, `form`, and `ref` on the trigger button. Long lists are virtualised.
 */
export function Select({ options, value, defaultValue, onChange, placeholder: placeholderProp, className, 'aria-label': ariaLabel, icon, mono, ref, ...fp }: FormControlProps &
  { options: Option[]; value?: string; defaultValue?: string; onChange?: (v: string) => void; placeholder?: string; className?: string; 'aria-label'?: string
    /** leading icon in the trigger (TimePicker uses 'clock') */ icon?: IconName; mono?: boolean; ref?: Ref<HTMLButtonElement> }) {
  const btn = useRef<HTMLButtonElement>(null)
  const placeholder = placeholderProp ?? 'Select…'
  const fc = useFormControl<string>({ ...fp, value, defaultValue: defaultValue ?? '', onChange, serialize: x => x, focus: () => btn.current?.focus() })
  const v = fc.value, set = fc.set, locked = fc.disabled || fc.readOnly
  const { open, setOpen, ref: wrap } = useDisclosure(), lid = useId()
  const [place, setPlace] = useState<Placement>('bottom-start')
  const sel = options.findIndex(o => o.value === v)
  const off = (i: number) => !!options[i]?.disabled
  const pick = (i: number) => { if (!options[i] || off(i)) return; set(options[i].value); setOpen(false) }
  const { active, setActive, onKeyDown } = useRoving(options.length, pick, { isDisabled: off })
  const show = (o: boolean) => { if (o && locked) return; if (o) { setPlace(formsPlacement(wrap.current)); setActive(sel >= 0 ? sel : Math.max(0, options.findIndex(x => !x.disabled))) } setOpen(o) }
  const nextMatch = (ch: string, from: number) => {
    for (let s = 1; s <= options.length; s++) { const k = (from + s + options.length) % options.length; if (!options[k].disabled && options[k].label.toLowerCase().startsWith(ch)) return k }
    return -1
  }
  const onKey = (e: RKeyboardEvent) => {
    const typed = e.key.length === 1 && e.key !== ' ' && !e.metaKey && !e.ctrlKey ? e.key.toLowerCase() : ''
    if (!open) {
      if (typed) { const k = nextMatch(typed, sel); if (k >= 0) set(options[k].value); return }
      if (['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(e.key)) { e.preventDefault(); show(true) }
      return
    }
    if (e.key === 'Escape') { e.stopPropagation(); return setOpen(false) } // closes the list, not the dialog around it
    if (e.key === 'Tab') return setOpen(false)
    if (e.key === ' ') { e.preventDefault(); return pick(active) }
    if (typed) { const k = nextMatch(typed, active); if (k >= 0) setActive(k); return }
    onKeyDown(e)
  }
  return (
    <div ref={wrap} className={cn('relative', className)} onBlur={fc.onBlur}>
      <button type="button" ref={composeRefs(btn, ref)} {...fc.control} role="combobox" aria-label={ariaLabel} aria-expanded={open} aria-haspopup="listbox" aria-controls={lid} aria-activedescendant={open ? `${lid}-${active}` : undefined}
        aria-required={fc.required || undefined} aria-readonly={fc.readOnly || undefined} disabled={fc.disabled}
        onClick={() => show(!open)} onKeyDown={onKey}
        className={cn(formsTriggerClass, 'cursor-pointer justify-between')}>
        <span className={cn('flex min-w-0 items-center gap-2', mono && 'ui-num')}>
          {icon && <Icon name={icon} size={15} className="text-[var(--fg3)]" />}
          {options[sel]?.leading && <span className="leading-none">{options[sel].leading}</span>}
          {options[sel]?.dot && <motion.span key={`d${v}`} initial={{ scale: 1.8 }} animate={{ scale: 1 }} transition={spring(0.5, 0.4)} className="h-2 w-2 flex-none rounded-full" style={{ background: options[sel].dot }} />}
          <motion.span key={v} initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} transition={spring(0.3, 0.3)} className={cn('truncate', sel < 0 && 'text-[var(--fg3)]')}>{options[sel]?.label ?? placeholder}</motion.span>
        </span>
        {!fc.readOnly && <motion.span animate={{ rotate: open ? 180 : 0 }} className="text-[var(--fg3)]"><Icon name="chevronDown" size={14} /></motion.span>}
      </button>
      <FloatingPanel open={open} matchWidth placement={place} className={cn('max-h-64 overflow-auto', mono && 'ui-num')} role="presentation">
        <OptionList id={lid} options={options} active={active} isSelected={o => o.value === v} onPick={pick} onHover={setActive} />
      </FloatingPanel>
      {fc.inputs}
    </div>
  )
}

/** What an async Combobox's `loadOptions` gets besides the query: abort it when the signal fires (a newer query or unmount). */
export type LoadOptionsContext = { signal: AbortSignal }
type FormsLoad = { q: string; status: 'idle' | 'loading' | 'done' | 'error'; items: Option[] }

/** The async list's message (too short, failed with Retry, loading, or no matches) and what the live region says. */
function useSelectStatus({ short, failed, loading, done, count, minChars, query, empty, retry }: { short: boolean; failed: boolean; loading: boolean; done: boolean; count: number
  minChars: number; query: string; empty?: (q: string) => ReactNode; retry: () => void }) {
  const message = short ? (minChars === 1 ? `Type at least ${minChars} character` : `Type at least ${minChars} characters`)
    : failed ? <span className="flex flex-col items-center gap-2"><span className="text-[var(--bad)]">{'Couldn’t load results'}</span>
      <Button size="xs" onPointerDown={e => e.preventDefault()} onClick={retry}>{'Retry'}</Button></span>
    : loading ? <span className="inline-flex items-center gap-2"><span aria-hidden className="grid"><Spinner size={13} /></span>{'Loading…'}</span>
    : empty ? empty(query) : `No matches for “${query}”`
  const live = loading ? 'Loading results' : failed ? 'Couldn’t load results. Press Enter to retry.' : done ? (count === 0 ? 'No results' : count === 1 ? `${count} result` : `${count} results`) : ''
  return { message, live }
}

/**
 * Type to filter (the match is bolded), arrows to move, Enter to choose. Options can carry a `leading` flag or emoji,
 * shown in the field once chosen, and a `group` heading. `empty` renders the no-match message for the current query.
 *
 * Async: give `loadOptions(query, { signal })` instead of (or as well as) `options`. It runs `debounce` ms (200) after
 * typing stops, once the query has `minChars`; a newer query aborts the older request (its signal fires and late results
 * are dropped). The list shows loading, empty and error states (Retry, or Enter in the field); `defaultOptions` are shown
 * before the first load and help label a `defaultValue`. `creatable` adds “Create “x”” when nothing matches exactly;
 * picking it calls `onCreate(text)` (return an Option to use its value) and selects it. `onInputChange` reports typing.
 * Lists past 100 options are virtualised. Never flips above the field (on phones it scrolls the page instead).
 * Form-native: `name` submits the chosen value (not the typed text; '' when none), `required`, `disabled`, `readOnly`,
 * `invalid`, `onBlur`, `form`, and `ref` on the text input.
 */
export function Combobox({ options = [], loadOptions, debounce = 200, minChars = 0, defaultOptions, creatable, createLabel, onCreate, onInputChange,
  value, defaultValue, onChange, placeholder, empty, 'aria-label': ariaLabel, className, ref, ...fp }: FormControlProps & {
    options?: Option[]; value?: string; defaultValue?: string; onChange?: (v: string) => void; placeholder?: string; empty?: (query: string) => ReactNode; 'aria-label'?: string; className?: string
    loadOptions?: (query: string, ctx: LoadOptionsContext) => Promise<Option[]>; debounce?: number; minChars?: number; defaultOptions?: Option[]
    creatable?: boolean; createLabel?: (query: string) => string; onCreate?: (text: string) => Option | void; onInputChange?: (query: string) => void
    ref?: Ref<HTMLInputElement> }) {
  const input = useRef<HTMLInputElement>(null)
  const known = useRef(new Map<string, Option>()) // every option seen (static, loaded, created), to label the value
  const indexed = useRef<unknown[]>([])
  if (indexed.current[0] !== options || indexed.current[1] !== defaultOptions) { // index once per options array, not per render
    indexed.current = [options, defaultOptions]
    for (const o of defaultOptions ?? []) if (!known.current.has(o.value)) known.current.set(o.value, o)
    for (const o of options) if (!known.current.has(o.value)) known.current.set(o.value, o)
  }
  const [created, setCreated] = useState<Option[]>([])
  const labelOf = (x: string) => known.current.get(x)?.label ?? (x && (loadOptions || creatable) ? x : '')
  const fc = useFormControl<string>({ ...fp, value, defaultValue: defaultValue ?? '', onChange, serialize: x => x, focus: () => input.current?.focus(),
    onReset: () => { const d = defaultValue ?? ''; shownFor.current = d; setQ(labelOf(d)) } })
  const v = fc.value, set = fc.set, locked = fc.disabled || fc.readOnly
  const [q, setQ] = useState(() => labelOf(v))
  const shownFor = useRef(v) // when the value changes from outside, show its label
  useEffect(() => { if (shownFor.current === v) return; shownFor.current = v; setQ(labelOf(v)) }, [v, options]) // eslint-disable-line react-hooks/exhaustive-deps
  const { open: isOpen, setOpen, ref: wrap } = useDisclosure(), lid = useId()
  const open = isOpen && !locked
  const chosenLabel = v ? labelOf(v) : ''
  const chosen = !!v && chosenLabel === q
  const filter = chosen ? '' : q // show the full list again when the field holds the chosen label
  const query = filter.trim()

  // async: debounced, aborted when superseded
  const { load, short, loading, failed, retry: reload } = useFormsLoader(loadOptions, { query, open, minChars, debounce, defaultOptions, onItems: items => items.forEach(o => known.current.set(o.value, o)) })

  const source = loadOptions ? [...(load.status === 'idle' && !query ? defaultOptions ?? [] : load.items), ...options] : options
  const hit = (o: Option) => o.label.toLowerCase().includes(query.toLowerCase())
  const seen = new Set<string>()
  const matches = [...(loadOptions ? source : source.filter(hit)), ...created.filter(hit)].filter(o => !seen.has(o.value) && !!seen.add(o.value))
  const canCreate = !!creatable && !!query && !chosen && !matches.some(o => o.label.toLowerCase() === query.toLowerCase())
  const retry = () => { reload(); input.current?.focus() }
  const { message, live } = useSelectStatus({ short, failed, loading, done: !!loadOptions && load.status === 'done', count: matches.length + (canCreate ? 1 : 0), minChars, query: q, empty, retry })
  const createOpt: Option | null = canCreate ? { value: query, label: createLabel ? createLabel(query) : `Create “${query}”`, icon: 'plus' } : null
  const list = short ? [] : createOpt ? [...matches, createOpt] : matches
  const pick = (i: number) => {
    let o = list[i]; if (!o || o.disabled) return
    if (o === createOpt) { o = onCreate?.(query) || { value: query, label: query }; known.current.set(o.value, o); const made = o; setCreated(c => [...c.filter(x => x.value !== made.value), made]) }
    shownFor.current = o.value; set(o.value); setQ(o.label); setOpen(false); play(input.current, { scale: [0.98, 1] }, spring(0.4, 0.3))
  }
  const { active, setActive, onKeyDown } = useRoving(list.length, pick, { loop: false, homeEnd: false, isDisabled: i => !!list[i]?.disabled })
  const leading = chosen ? known.current.get(v)?.leading : undefined
  return (
    <div ref={wrap} className={cn('relative', className)} onBlur={fc.onBlur}>
      <span className="pointer-events-none absolute top-1/2 start-3 grid -translate-y-1/2 place-items-center text-[var(--fg3)]">
        {leading ? <motion.span key={v} initial={{ scale: 0.5 }} animate={{ scale: 1 }} transition={spring(0.5, 0.35)} className="text-sm leading-none">{leading}</motion.span> : <Icon name="search" size={14} />}
      </span>
      <input ref={composeRefs(input, ref)} {...fc.control} role="combobox" aria-label={ariaLabel} aria-expanded={open} aria-controls={lid} aria-autocomplete="list" aria-activedescendant={open && list.length ? `${lid}-${active}` : undefined}
        aria-required={fc.required || undefined} disabled={fc.disabled} readOnly={fc.readOnly}
        value={q} placeholder={placeholder ?? 'Search…'} autoComplete="off" className={cn(inputClass, formDisabledClass, formReadOnlyClass, '!ps-8', loading && '!pe-8')}
        onChange={e => { setQ(e.target.value); onInputChange?.(e.target.value); setOpen(true); setActive(0) }} onFocus={() => setOpen(true)}
        onBlur={e => { if (!wrap.current?.contains(e.relatedTarget as Node)) setOpen(false) }}
        onKeyDown={e => {
          if (e.key === 'Escape') { if (open) { e.stopPropagation(); setOpen(false) } return }
          if (e.key === 'Tab') return setOpen(false)
          if (e.key === 'Enter' && failed) { e.preventDefault(); return retry() }
          if (!open) setOpen(true)
          onKeyDown(e)
        }} />
      {loading && <span aria-hidden className="pointer-events-none absolute top-1/2 end-3 grid -translate-y-1/2 text-[var(--fg3)]"><Spinner size={13} /></span>}
      <span className="sr-only" aria-live="polite">{open ? live : ''}</span>
      {/* never flips above the field: the list shrinks as you type, and above it would jump and cover the label */}
      <FloatingPanel open={open} matchWidth flip="scroll" className="max-h-[220px] overflow-auto" role="presentation">
        {list.length > 0 && (failed || (loading && !matches.length)) && <div className="p-3 pb-1 text-center text-[13px] text-[var(--fg3)]">{message}</div>}
        <OptionList id={lid} options={list} query={filter} active={active} isSelected={o => o !== createOpt && o.value === v} onPick={pick} onHover={setActive} empty={message} busy={loading} />
      </FloatingPanel>
      {fc.inputs}
    </div>
  )
}

/** Props of MultiSelect. With `loadOptions` it searches as you type, like an async Combobox. */
export type MultiSelectProps = FormControlProps & {
  options?: Option[]; value?: string[]; defaultValue?: string[]; onChange?: (v: string[]) => void; placeholder?: string; 'aria-label'?: string; className?: string; ref?: Ref<HTMLElement>
  /** fetch options for the typed query (pass `signal` to fetch); turns the field into a search box */ loadOptions?: (query: string, ctx: LoadOptionsContext) => Promise<Option[]>
  /** ms after typing stops (200) */ debounce?: number; /** characters before the first load (0) */ minChars?: number; /** shown before the first load */ defaultOptions?: Option[]
  /** offer “Create “x”” when nothing matches */ creatable?: boolean; createLabel?: (query: string) => string; onCreate?: (text: string) => Option | void
  onInputChange?: (query: string) => void; /** the no-match message for a query */ empty?: (query: string) => ReactNode
}

/**
 * Pick several: ticks draw in the list, chosen items become chips (with their colour dot) in the field. Backspace removes
 * the last chip. With `loadOptions(query, { signal })` the field becomes a search box: loads run `debounce` ms (200) after
 * typing stops, once the query has `minChars`; a newer query aborts the older request; the list shows loading, empty and
 * error states (Retry, or Enter); `defaultOptions` show before the first load, options can carry a `group`, and
 * `creatable` adds “Create “x”” (`onCreate(text)` may return the Option to use). Picking keeps the list open and the query,
 * so several results can be ticked in a row. Chosen values keep their labels across searches.
 * Form-native: `name` submits each value as its own field (name=a&name=b; read with formData.getAll), `required` (at
 * least one), `disabled`, `readOnly` (chips only), `invalid`, `onBlur`, `form`, and `ref` on the field (the search input
 * when async). Long lists are virtualised.
 */
export function MultiSelect(props: MultiSelectProps) {
  return props.loadOptions ? <FormsMultiAsync {...props} loadOptions={props.loadOptions} /> : <FormsMultiStatic {...props} />
}

/** MultiSelect's chips: each value's label and colour dot, with a × while it can be edited. */
function FormsChips({ values, optionOf, locked, onRemove }: { values: string[]; optionOf: (v: string) => Option | undefined; locked: boolean; onRemove: (v: string) => void }) {
  return (
    <AnimatePresence initial={false} mode="popLayout">
      {values.map(x => {
        const o = optionOf(x), label = o?.label ?? x
        return (
          <motion.span key={x} layout initial={{ scale: 0.6, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.6, opacity: 0, transition: { duration: 0.12 } }} transition={spring(0.4, 0.35)}
            className={cn('inline-flex items-center gap-1.5 rounded-[var(--r-md)] py-0.5 ps-2 text-xs', locked ? 'bg-[var(--card)] pe-2 shadow-[inset_0_0_0_1px_var(--line)]' : 'bg-[var(--muted)] pe-1')}>
            {o?.dot && <span className="h-2 w-2 flex-none rounded-full" style={{ background: o.dot }} />}
            {label}
            {!locked && <button type="button" tabIndex={-1} aria-label={`Remove ${label}`} className="ui-target cursor-pointer rounded-[var(--r-sm)] border-0 bg-transparent px-0.5 leading-none hover:bg-[var(--line)] text-[var(--fg3)] hover:text-[var(--fg)] [@media(pointer:coarse)]:-my-2 [@media(pointer:coarse)]:-me-1 [@media(pointer:coarse)]:min-h-8 [@media(pointer:coarse)]:min-w-8 [@media(pointer:coarse)]:text-base"
              onPointerDown={e => e.preventDefault()} onClick={e => { e.stopPropagation(); onRemove(x) }}>×</button>}
          </motion.span>
        )
      })}
    </AnimatePresence>
  )
}

/** MultiSelect over a fixed `options` list: the field itself is the combobox. */
function FormsMultiStatic({ options = [], value, defaultValue = [], onChange, placeholder, 'aria-label': ariaLabel, className, ref, ...rest }: MultiSelectProps) {
  const { loadOptions: _l, debounce: _d, minChars: _m, defaultOptions: _o, creatable: _c, createLabel: _cl, onCreate: _oc, onInputChange: _oi, empty: _e, ...fp } = rest
  const box = useRef<HTMLDivElement>(null)
  const fc = useFormControl<string[]>({ ...fp, value, defaultValue, onChange, serialize: x => x, filled: x => x.length > 0, focus: () => box.current?.focus() })
  const v = fc.value, set = fc.set, locked = fc.disabled || fc.readOnly
  const { open, setOpen, ref: wrap } = useDisclosure(), lid = useId()
  const [place, setPlace] = useState<Placement>('bottom-start')
  const off = (i: number) => !!options[i]?.disabled
  const toggle = (i: number) => { if (!options[i] || off(i)) return; const o = options[i].value; set(v.includes(o) ? v.filter(x => x !== o) : [...v, o]) }
  const { active, setActive, onKeyDown } = useRoving(options.length, toggle, { isDisabled: off })
  const show = (o: boolean) => { if (o && locked) return; if (o) { setPlace(formsPlacement(wrap.current)); if (off(active)) setActive(Math.max(0, options.findIndex(x => !x.disabled))) } setOpen(o) }
  return (
    <div ref={wrap} className={cn('relative', className)} onBlur={fc.onBlur}>
      <div ref={composeRefs<HTMLDivElement>(box, ref as Ref<HTMLDivElement>)} {...fc.control} role="combobox" tabIndex={fc.disabled ? -1 : 0} aria-label={ariaLabel} aria-labelledby={ariaLabel ? undefined : fc.labelledBy} aria-expanded={open} aria-controls={lid} aria-haspopup="listbox"
        aria-activedescendant={open ? `${lid}-${active}` : undefined} aria-required={fc.required || undefined} aria-readonly={fc.readOnly || undefined} aria-disabled={fc.disabled || undefined}
        onClick={() => show(!open)} onKeyDown={e => {
          if (locked) return
          if (e.key === 'Escape') { if (open) { e.stopPropagation(); setOpen(false) } }
          else if (e.key === 'Tab') setOpen(false)
          else if (e.key === 'Backspace' && v.length) set(v.slice(0, -1))
          else if (!open && ['Enter', ' ', 'ArrowDown'].includes(e.key)) { e.preventDefault(); show(true) }
          else if (e.key === ' ') { e.preventDefault(); toggle(active) }
          else onKeyDown(e)
        }}
        className={cn(inputClass, formDisabledClass, 'relative flex !h-auto min-h-9 flex-wrap items-center gap-1 py-1 !pe-8 focus-visible:border-[var(--fg3)] aria-readonly:bg-[var(--muted)]', locked ? fc.disabled ? 'cursor-not-allowed' : 'cursor-default' : 'cursor-pointer')}>
        {v.length === 0 && <span className="text-[var(--fg3)]">{placeholder ?? 'Select…'}</span>}
        <FormsChips values={v} optionOf={x => options.find(p => p.value === x)} locked={locked} onRemove={x => set(v.filter(y => y !== x))} />
        {!fc.readOnly && <motion.span animate={{ rotate: open ? 180 : 0 }} className="absolute end-3 top-[11px] text-[var(--fg3)]"><Icon name="chevronDown" size={14} /></motion.span>}
      </div>
      <FloatingPanel open={open} matchWidth placement={place} className="max-h-64 overflow-auto" role="presentation">
        <OptionList id={lid} multi options={options} active={active} isSelected={o => v.includes(o.value)} onPick={toggle} onHover={setActive} />
      </FloatingPanel>
      {fc.inputs}
    </div>
  )
}

/** MultiSelect with `loadOptions`: a search input after the chips is the combobox; results load as you type. */
function FormsMultiAsync({ options = [], loadOptions, debounce = 200, minChars = 0, defaultOptions, creatable, createLabel, onCreate, onInputChange,
  empty, value, defaultValue = [], onChange, placeholder, 'aria-label': ariaLabel, className, ref, ...fp }: MultiSelectProps & { loadOptions: NonNullable<MultiSelectProps['loadOptions']> }) {
  const input = useRef<HTMLInputElement>(null)
  const known = useRef(new Map<string, Option>()) // every option seen (static, loaded, created), to label the chips
  const indexed = useRef<unknown[]>([])
  if (indexed.current[0] !== options || indexed.current[1] !== defaultOptions) {
    indexed.current = [options, defaultOptions]
    for (const o of [...(defaultOptions ?? []), ...options]) if (!known.current.has(o.value)) known.current.set(o.value, o)
  }
  const [q, setQ] = useState('')
  const fc = useFormControl<string[]>({ ...fp, value, defaultValue, onChange, serialize: x => x, filled: x => x.length > 0, focus: () => input.current?.focus(), onReset: () => setQ('') })
  const v = fc.value, set = fc.set, locked = fc.disabled || fc.readOnly
  const { open: isOpen, setOpen, ref: wrap } = useDisclosure(), lid = useId()
  const open = isOpen && !locked
  const query = q.trim()
  const { load, short, loading, failed, retry: reload } = useFormsLoader(loadOptions, { query, open, minChars, debounce, defaultOptions, onItems: items => items.forEach(o => known.current.set(o.value, o)) })
  const hit = (o: Option) => o.label.toLowerCase().includes(query.toLowerCase())
  const seen = new Set<string>()
  const matches = [...(load.status === 'idle' && !query ? defaultOptions ?? [] : load.items), ...options.filter(hit)].filter(o => !seen.has(o.value) && !!seen.add(o.value))
  const same = (o?: Option) => !!o && o.label.toLowerCase() === query.toLowerCase()
  const canCreate = !!creatable && !!query && !matches.some(same) && !v.some(x => same(known.current.get(x)))
  const retry = () => { reload(); input.current?.focus() }
  const { message, live } = useSelectStatus({ short, failed, loading, done: load.status === 'done', count: matches.length + (canCreate ? 1 : 0), minChars, query: q, empty, retry })
  const createOpt: Option | null = canCreate ? { value: '\u0000create', label: createLabel ? createLabel(query) : `Create “${query}”`, icon: 'plus' } : null
  const list = short ? [] : createOpt ? [...matches, createOpt] : matches
  const toggle = (i: number) => {
    const o = list[i]
    if (!o || o.disabled) return
    if (o === createOpt) {
      const made = onCreate?.(query) || { value: query, label: query }
      known.current.set(made.value, made)
      if (!v.includes(made.value)) set([...v, made.value])
      setQ(''); onInputChange?.('')
      return
    }
    set(v.includes(o.value) ? v.filter(x => x !== o.value) : [...v, o.value])
  }
  const { active, setActive, onKeyDown } = useRoving(list.length, toggle, { loop: false, homeEnd: false, isDisabled: i => !!list[i]?.disabled })
  return (
    <div ref={wrap} className={cn('relative', className)} onBlur={fc.onBlur}>
      <div onPointerDown={e => { if (e.target !== input.current && !(e.target as HTMLElement).closest('button')) { e.preventDefault(); input.current?.focus() } }}
        className={cn(inputShellClass(fc.invalid), 'relative flex min-h-9 w-full flex-wrap items-center gap-1 py-1 ps-1.5 pe-8 text-[13px]',
          fc.disabled ? 'cursor-not-allowed bg-[var(--muted)] text-[var(--fg3)]' : fc.readOnly ? 'bg-[var(--muted)]' : 'cursor-text')}>
        <FormsChips values={v} optionOf={x => known.current.get(x)} locked={locked} onRemove={x => set(v.filter(y => y !== x))} />
        <input ref={composeRefs<HTMLInputElement>(input, ref as Ref<HTMLInputElement>)} {...fc.control} role="combobox" aria-label={ariaLabel} aria-expanded={open} aria-controls={lid} aria-autocomplete="list"
          aria-activedescendant={open && list.length ? `${lid}-${active}` : undefined} aria-required={fc.required || undefined} disabled={fc.disabled} readOnly={fc.readOnly}
          value={q} placeholder={v.length ? '' : placeholder ?? 'Search…'} autoComplete="off"
          className="h-7 min-w-[8ch] flex-1 border-0 bg-transparent px-1 text-[13px] [color:inherit] outline-none placeholder:text-[var(--fg3)] disabled:cursor-not-allowed [@media(pointer:coarse)]:text-base"
          onChange={e => { setQ(e.target.value); onInputChange?.(e.target.value); setOpen(true); setActive(0) }} onFocus={() => setOpen(true)}
          onBlur={e => { if (!wrap.current?.contains(e.relatedTarget as Node)) setOpen(false) }}
          onKeyDown={e => {
            if (locked) return
            if (e.key === 'Escape') { if (open) { e.stopPropagation(); setOpen(false) } return }
            if (e.key === 'Tab') return setOpen(false)
            if (e.key === 'Backspace' && !q && v.length) { e.preventDefault(); set(v.slice(0, -1)); return }
            if (e.key === 'Enter' && failed) { e.preventDefault(); return retry() }
            if (!open) setOpen(true)
            onKeyDown(e)
          }} />
        <span aria-hidden className="pointer-events-none absolute end-3 top-1/2 grid -translate-y-1/2 text-[var(--fg3)]">{loading ? <Spinner size={13} /> : <Icon name="search" size={14} />}</span>
      </div>
      <span className="sr-only" aria-live="polite">{open ? live : ''}</span>
      <FloatingPanel open={open} matchWidth flip="scroll" className="max-h-64 overflow-auto" role="presentation">
        {list.length > 0 && (failed || (loading && !matches.length)) && <div className="p-3 pb-1 text-center text-[13px] text-[var(--fg3)]">{message}</div>}
        <OptionList id={lid} multi options={list} query={query} active={active} isSelected={o => o !== createOpt && v.includes(o.value)} onPick={toggle} onHover={setActive} empty={message} busy={loading} />
      </FloatingPanel>
      {fc.inputs}
    </div>
  )
}

/**
 * The async half of Combobox and MultiSelect: runs `loadOptions` `debounce` ms after the query settles (while the list is
 * open and the query has `minChars`), aborts a superseded request and drops its late result, and reports loading and
 * errors. `retry()` loads the same query again.
 */
function useFormsLoader(loadOptions: ((q: string, ctx: LoadOptionsContext) => Promise<Option[]>) | undefined,
  { query, open, minChars, debounce, defaultOptions, onItems }: { query: string; open: boolean; minChars: number; debounce: number; defaultOptions?: Option[]; onItems: (items: Option[]) => void }) {
  const [load, setLoad] = useState<FormsLoad>({ q: '', status: 'idle', items: defaultOptions ?? [] })
  const [attempt, setAttempt] = useState(0)
  const fns = useRef({ loadOptions, onItems })
  useLayoutEffect(() => { fns.current = { loadOptions, onItems } })
  const short = !!loadOptions && query.length < minChars
  useEffect(() => {
    if (!fns.current.loadOptions || !open || short) return
    const ac = new AbortController()
    setLoad(l => ({ ...l, q: query, status: 'loading' }))
    const t = setTimeout(() => {
      fns.current.loadOptions?.(query, { signal: ac.signal }).then(
        items => { if (ac.signal.aborted) return; fns.current.onItems(items); setLoad({ q: query, status: 'done', items }) },
        () => { if (!ac.signal.aborted) setLoad({ q: query, status: 'error', items: [] }) })
    }, debounce)
    return () => { clearTimeout(t); ac.abort() }
  }, [query, open, attempt, short, debounce])
  return { load, short, loading: !!loadOptions && load.status === 'loading', failed: !!loadOptions && load.status === 'error', retry: () => setAttempt(a => a + 1) }
}
