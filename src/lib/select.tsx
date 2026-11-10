import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode, type Ref, type RefObject, type KeyboardEvent as RKeyboardEvent } from 'react'
import { type FormControlProps, Spinner, useFormControl, Button, Icon, type IconName, Chevron, cn, inputClass, menuItemClass, spring, useCoarsePointer, useDisclosure, useListbox, composeRefs, plural, revealInScroller, scrollParent, typeaheadIndex } from './core'
import { PresenceList, play, useFlip } from './motion'
import { FloatingPanel } from './overlay'
import { useVirtual } from './virtual'
import { FormsChip, formsTriggerClass } from './formkit'
import { inputShellClass, CheckboxBox, type Option } from './fields'

/** `text` with the first case-insensitive match of `query` in a <mark> (bold by default): option lists, autocomplete, search results. */
export function MatchText({ text, query, markClassName = 'bg-transparent font-semibold text-[var(--fg)]' }: { text: string; query?: string; markClassName?: string }) {
  const q = query?.trim(), i = q ? text.toLowerCase().indexOf(q.toLowerCase()) : -1
  if (!q || i < 0) return <>{text}</>
  return <>{text.slice(0, i)}<mark className={markClassName}>{text.slice(i, i + q.length)}</mark>{text.slice(i + q.length)}</>
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
    if (!scroller.current?.contains(root.current)) scroller.current = scrollParent(root.current)
  })
  const coarse = useCoarsePointer()
  const v = useVirtual({ count: options.length, estimateSize: coarse ? 40 : 34, scrollRef: scroller, enabled: virtual, keep: active >= 0 && active < options.length ? [active] : undefined, overscan: 8 })
  useEffect(() => {
    if (virtual) { if (active >= 0 && active < options.length) v.scrollToIndex(active, { align: first.current ? 'center' : 'auto' }) }
    else revealInScroller(document.getElementById(`${id}-${active}`), { center: first.current })
    first.current = false
  }, [active, id, options.length, virtual]) // eslint-disable-line react-hooks/exhaustive-deps
  // the empty listbox stays, so the combobox's aria-controls still points at something
  if (!options.length) return <><div role="listbox" id={id} aria-label={label} /><div ref={root} role="status" className={cn('p-3 text-center text-[13px] text-[var(--fg3)]', className)}>{empty ?? 'No matches'}</div></>
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
          <span className="truncate"><MatchText text={o.label} query={query} />{o.hint && <span className="ms-2 text-xs text-[var(--fg3)]">{o.hint}</span>}</span>
        </span>
        {!multi && sel && <Icon name="check" size={14} />}
      </>
    )
    // keyed by position: while a filter narrows the list the rows stay put and only their text changes, so nothing
    // slides up under the finger (no layout shift); rows added at the end still fade in
    return animated
      ? <div key={i} {...props} className={cn(props.className, 'ui-in [--ui-d:.18s] [--ui-e:ease-out] [--ui-y:-3px]')} style={{ '--ui-delay': `${Math.min(i, 8) * 0.018}s` } as CSSProperties}>{body}</div>
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
 * Form-native: `name` submits the value ('' when none, and when the value isn't one of `options`), `required`,
 * `disabled`, `readOnly` (doesn't open), `invalid`, `onBlur`, `form`, and `ref` on the trigger button. Long lists are virtualised.
 */
export function Select({ options, value, defaultValue = '', onChange, placeholder = 'Select…', className, 'aria-label': ariaLabel, icon, mono, ref, ...fp }: FormControlProps &
  { options: Option[]; value?: string; defaultValue?: string; onChange?: (v: string) => void; placeholder?: string; className?: string; 'aria-label'?: string
    /** leading icon in the trigger (TimePicker uses 'clock') */ icon?: IconName; mono?: boolean; ref?: Ref<HTMLButtonElement> }) {
  const btn = useRef<HTMLButtonElement>(null)
  const fc = useFormControl<string>({ ...fp, value, defaultValue, onChange, serialize: x => (options.some(o => o.value === x) ? x : ''), focus: () => btn.current?.focus() })
  const v = fc.value, set = fc.set, locked = fc.disabled || fc.readOnly
  const sel = options.findIndex(o => o.value === v)
  const { open, setOpen, ref: wrap } = useDisclosure()
  const pick = (i: number) => { if (!options[i] || options[i].disabled) return; set(options[i].value); setOpen(false) }
  const lb = useListbox(options, pick, { open, setOpen, selected: sel, locked }), active = lb.active
  const onKey = (e: RKeyboardEvent) => {
    const typed = e.key.length === 1 && e.key !== ' ' && !e.metaKey && !e.ctrlKey ? e.key : ''
    if (!typed) return lb.onKeyDown(e)
    const k = typeaheadIndex(options.map(o => o.label), typed, open ? active : sel, i => !!options[i].disabled)
    if (k >= 0) { if (open) lb.setActive(k); else if (!locked) set(options[k].value) }
  }
  return (
    <div ref={wrap} className={cn('relative', className)} onBlur={fc.onBlur}>
      <button type="button" ref={composeRefs(btn, ref)} {...fc.control} {...lb.comboProps} aria-label={ariaLabel}
        aria-required={fc.required || undefined} aria-readonly={fc.readOnly || undefined} disabled={fc.disabled}
        onClick={() => lb.show(!open)} onKeyDown={onKey}
        className={cn(formsTriggerClass, 'cursor-pointer justify-between')}>
        <span className={cn('flex min-w-0 items-center gap-2', mono && 'ui-num')}>
          {icon && <Icon name={icon} size={15} className="text-[var(--fg3)]" />}
          {options[sel]?.leading && <span className="leading-none">{options[sel].leading}</span>}
          {options[sel]?.dot && <span key={`d${v}`} className="ui-pop h-2 w-2 flex-none rounded-full [--ui-d:.4s] [--ui-s:1.8]" style={{ background: options[sel].dot }} />}
          <span key={v} className={cn('ui-in truncate [--ui-y:4px]', sel < 0 && 'text-[var(--fg3)]')}>{options[sel]?.label ?? placeholder}</span>
        </span>
        {!fc.readOnly && <Chevron open={open} />}
      </button>
      <FloatingPanel open={open} matchWidth className={cn('max-h-64 overflow-auto', mono && 'ui-num')} role="presentation">
        <OptionList id={lb.id} options={options} active={active} isSelected={o => o.value === v} onPick={pick} onHover={lb.setActive} />
      </FloatingPanel>
      {fc.inputs}
    </div>
  )
}

/** What an async Combobox's `loadOptions` gets besides the query: abort it when the signal fires (a newer query or unmount). */
export type LoadOptionsContext = { signal: AbortSignal }
type FormsLoader = (query: string, ctx: LoadOptionsContext) => Promise<Option[]>
type FormsLoad = { q: string; status: 'idle' | 'loading' | 'done' | 'error'; items: Option[]; error?: unknown }

/** The async list's message (too short, failed with Retry, loading, or no matches) and what the live region says. */
function selectStatus({ short, failed, loading, done, count, minChars, query, empty, retry }: { short: boolean; failed: boolean; loading: boolean; done: boolean; count: number
  minChars: number; query: string; empty?: (q: string) => ReactNode; retry: () => void }) {
  const message = short ? `Type at least ${plural(minChars, 'character')}`
    : failed ? <span className="flex flex-col items-center gap-2"><span className="text-[var(--bad)]">{'Couldn’t load results'}</span>
      <Button size="xs" onPointerDown={e => e.preventDefault()} onClick={retry}>{'Retry'}</Button></span>
    : loading ? <span className="inline-flex items-center gap-2"><span aria-hidden className="grid"><Spinner size={13} /></span>{'Loading…'}</span>
    : empty ? empty(query) : `No matches for “${query}”`
  const live = loading ? 'Loading results' : failed ? 'Couldn’t load results. Press Enter to retry.' : done ? plural(count, 'result', undefined, { zero: 'No results' }) : ''
  return { message, live }
}

/** Every option Combobox or MultiSelect has seen (static, default, loaded, created), to label values whose options come and go. */
function useOptionIndex(options: Option[], defaultOptions?: Option[]) {
  const known = useRef(new Map<string, Option>())
  const indexed = useRef<unknown[]>([])
  if (indexed.current[0] !== options || indexed.current[1] !== defaultOptions) { // index once per options array, not per render
    indexed.current = [options, defaultOptions]
    for (const o of [...(defaultOptions ?? []), ...options]) if (!known.current.has(o.value)) known.current.set(o.value, o)
  }
  return { optionOf: (v: string) => known.current.get(v), remember: (o: Option) => { known.current.set(o.value, o) } }
}
type FormsOptionIndex = ReturnType<typeof useOptionIndex>

/**
 * The list Combobox and MultiSelect show for a query: loaded results (or `defaultOptions` before the first load), then
 * the matching static options and the ones created earlier, without duplicates, plus “Create “x”” when creatable and
 * nothing (listed or already chosen) has that label. `resolve(i)` is the option to choose at `i`; for “Create” it makes
 * it (`onCreate` may return the Option to use) and remembers it.
 */
function useOptionSource(index: FormsOptionIndex, { options, defaultOptions, loadOptions, query, open, minChars, debounce, creatable, createLabel, onCreate, chosen, empty, onLoadError, focus }: {
  options: Option[]; defaultOptions?: Option[]; loadOptions?: FormsLoader; query: string; open: boolean; minChars: number; debounce: number
  creatable?: boolean; createLabel?: (query: string) => string; onCreate?: (text: string) => Option | void; chosen: string[]
  empty?: (query: string) => ReactNode; onLoadError?: (error: unknown) => void; focus: () => void }) {
  const [created, setCreated] = useState<Option[]>([])
  const { load, short, loading, failed, retry: reload } = useFormsLoader(loadOptions, { query, open, minChars, debounce, defaultOptions, onLoadError, onItems: items => items.forEach(index.remember) })
  const hit = (o: Option) => o.label.toLowerCase().includes(query.toLowerCase())
  const remote = !loadOptions ? [] : load.status === 'idle' && !query ? defaultOptions ?? [] : load.items
  const seen = new Set<string>()
  const matches = [...remote, ...options.filter(hit), ...created.filter(hit)].filter(o => !seen.has(o.value) && !!seen.add(o.value))
  const same = (o?: Option) => !!o && o.label.toLowerCase() === query.toLowerCase()
  const canCreate = !!creatable && !!query && !matches.some(same) && !chosen.some(x => same(index.optionOf(x)))
  const createOpt: Option | null = canCreate ? { value: FORMS_CREATE, label: createLabel ? createLabel(query) : `Create “${query}”`, icon: 'plus' } : null
  const list = short ? [] : createOpt ? [...matches, createOpt] : matches
  const retry = () => { reload(); focus() }
  const { message, live } = selectStatus({ short, failed, loading, done: !!loadOptions && load.status === 'done', count: list.length, minChars, query, empty, retry })
  const resolve = (i: number): Option | null => {
    const o = list[i]
    if (!o || o.disabled) return null
    if (o !== createOpt) return o
    const made = onCreate?.(query) || { value: query, label: query }
    index.remember(made); setCreated(c => [...c.filter(x => x.value !== made.value), made])
    return made
  }
  return { list, matches, resolve, isCreate: (o: Option) => o === createOpt, message, live, loading, failed, retry }
}
/** The value of the “Create” row: never a real option's value (the row itself is told apart by identity). */
const FORMS_CREATE = '\u0000create'

/** The async options props Combobox and MultiSelect share. */
type FormsAsyncProps = {
  /** fetch options for the typed query (pass `signal` to fetch) */ loadOptions?: FormsLoader
  /** ms after typing stops (200) */ debounce?: number; /** characters before the first load (0) */ minChars?: number; /** shown before the first load */ defaultOptions?: Option[]
  /** a load failed (the list shows Retry) */ onLoadError?: (error: unknown) => void
  /** offer “Create “x”” when nothing matches */ creatable?: boolean; createLabel?: (query: string) => string; onCreate?: (text: string) => Option | void
  onInputChange?: (query: string) => void; /** the no-match message for a query */ empty?: (query: string) => ReactNode
}

/**
 * Type to filter (the match is bolded), arrows to move, Enter to choose. Options can carry a `leading` flag or emoji,
 * shown in the field once chosen, and a `group` heading. `empty` renders the no-match message for the current query.
 * The field always shows the chosen option's label once you leave it: typed text that wasn't picked goes back to the
 * label, and a field emptied by hand clears the value. Escape does the same while the list is closed.
 *
 * Async: give `loadOptions(query, { signal })` instead of (or as well as) `options`. It runs `debounce` ms (200) after
 * typing stops, once the query has `minChars`; a newer query aborts the older request (its signal fires and late results
 * are dropped). The list shows loading, empty and error states (Retry, or Enter in the field; `onLoadError` gets the
 * reason); `defaultOptions` are shown before the first load and help label a `defaultValue`; static `options` are
 * filtered by the query and listed after the results. `creatable` adds “Create “x”” when nothing matches exactly;
 * picking it calls `onCreate(text)` (return an Option to use its value) and selects it. `onInputChange` reports typing.
 * Lists past 100 options are virtualised. Never flips above the field (on phones it scrolls the page instead).
 * Form-native: `name` submits the chosen value (not the typed text; '' when none, and when a static list doesn't have
 * it), `required`, `disabled`, `readOnly`, `invalid`, `onBlur`, `form`, and `ref` on the text input.
 */
export function Combobox({ options = [], loadOptions, debounce = 200, minChars = 0, defaultOptions, creatable, createLabel, onCreate, onInputChange, onLoadError,
  value, defaultValue = '', onChange, placeholder = 'Search…', empty, 'aria-label': ariaLabel, className, ref, ...fp }: FormControlProps & FormsAsyncProps & {
    options?: Option[]; value?: string; defaultValue?: string; onChange?: (v: string) => void; placeholder?: string; 'aria-label'?: string; className?: string
    ref?: Ref<HTMLInputElement> }) {
  const input = useRef<HTMLInputElement>(null)
  const index = useOptionIndex(options, defaultOptions)
  const free = !!loadOptions || !!creatable // values outside the known options are allowed (and shown as typed)
  const labelOf = (x: string) => index.optionOf(x)?.label ?? (free ? x : '')
  const [q, setQ] = useState<string | null>(null) // typed text; null: the field shows the value's label
  const fc = useFormControl<string>({ ...fp, value, defaultValue, onChange, serialize: x => (!x || free || index.optionOf(x) ? x : ''), focus: () => input.current?.focus(), onReset: () => setQ(null) })
  const v = fc.value, set = fc.set, locked = fc.disabled || fc.readOnly
  const [shownFor, setShownFor] = useState(v)
  if (shownFor !== v) { setShownFor(v); setQ(null) } // a new value from outside replaces what was typed
  const { open: isOpen, setOpen, ref: wrap } = useDisclosure()
  const open = isOpen && !locked
  const filter = q ?? '' // the field showing the chosen label lists everything again
  const src = useOptionSource(index, { options, defaultOptions, loadOptions, query: filter.trim(), open, minChars, debounce, creatable, createLabel, onCreate, chosen: v ? [v] : [], empty, onLoadError, focus: () => input.current?.focus() })
  const { list, loading, failed } = src
  const pick = (i: number) => {
    const o = src.resolve(i); if (!o) return
    set(o.value); setShownFor(o.value); setQ(null); setOpen(false); play(input.current, { scale: [0.98, 1] }, spring(0.4, 0.3))
  }
  // what's left in the field must be the value: unpicked text goes back to the label, and emptied text clears the value
  const commit = () => { if (q === null) return; if (!q.trim()) set(''); setQ(null) }
  const lb = useListbox(list, pick, { open, setOpen, input: true }), { active, setActive } = lb
  const leading = q === null ? index.optionOf(v)?.leading : undefined
  return (
    <div ref={wrap} className={cn('relative', className)} onBlur={fc.onBlur}>
      <span className="pointer-events-none absolute top-1/2 start-3 grid -translate-y-1/2 place-items-center text-[var(--fg3)]">
        {leading ? <span key={v} className="ui-pop text-sm leading-none">{leading}</span> : <Icon name="search" size={14} />}
      </span>
      <input ref={composeRefs(input, ref)} {...fc.control} {...lb.comboProps} aria-label={ariaLabel}
        aria-required={fc.required || undefined} disabled={fc.disabled} readOnly={fc.readOnly}
        value={q ?? labelOf(v)} placeholder={placeholder} autoComplete="off" className={cn(inputClass, '!ps-8', loading && open && '!pe-8')}
        onChange={e => { setQ(e.target.value); onInputChange?.(e.target.value); setOpen(true); setActive(0) }} onFocus={() => setOpen(true)}
        onBlur={e => { if (!wrap.current?.contains(e.relatedTarget as Node)) { setOpen(false); commit() } }}
        onKeyDown={e => {
          if (e.key === 'Enter' && failed) { e.preventDefault(); src.retry() }
          else if (e.key === 'Escape' && !open && q !== null) { e.stopPropagation(); commit() }
          else lb.onKeyDown(e)
        }} />
      {loading && open && <span aria-hidden className="pointer-events-none absolute top-1/2 end-3 grid -translate-y-1/2 text-[var(--fg3)]"><Spinner size={13} /></span>}
      <span className="sr-only" aria-live="polite">{open ? src.live : ''}</span>
      {/* never flips above the field: the list shrinks as you type, and above it would jump and cover the label */}
      <FloatingPanel open={open} matchWidth flip="scroll" className="max-h-[220px] overflow-auto" role="presentation">
        {list.length > 0 && (failed || (loading && !src.matches.length)) && <div className="p-3 pb-1 text-center text-[13px] text-[var(--fg3)]">{src.message}</div>}
        <OptionList id={lb.id} options={list} query={filter} active={active} isSelected={o => !src.isCreate(o) && o.value === v} onPick={pick} onHover={setActive} empty={src.message} busy={loading} />
      </FloatingPanel>
      {fc.inputs}
    </div>
  )
}

/** Props of MultiSelect. With `loadOptions` it searches as you type, like an async Combobox. */
export type MultiSelectProps = FormControlProps & FormsAsyncProps & {
  options?: Option[]; value?: string[]; defaultValue?: string[]; onChange?: (v: string[]) => void; placeholder?: string; 'aria-label'?: string; className?: string; ref?: Ref<HTMLElement>
}

/**
 * Pick several: ticks draw in the list, chosen items become chips (with their colour dot) in the field. Backspace removes
 * the last chip. With `loadOptions(query, { signal })` the field becomes a search box: loads run `debounce` ms (200) after
 * typing stops, once the query has `minChars`; a newer query aborts the older request; the list shows loading, empty and
 * error states (Retry, or Enter; `onLoadError` gets the reason); `defaultOptions` show before the first load, static
 * `options` are filtered by the query, options can carry a `group`, and `creatable` adds “Create “x”” (`onCreate(text)`
 * may return the Option to use). Picking keeps the list open and the query, so several results can be ticked in a row.
 * Chosen values keep their labels across searches.
 * Form-native: `name` submits each value as its own field (name=a&name=b; read with formData.getAll), `required` (at
 * least one), `disabled`, `readOnly` (chips only), `invalid`, `onBlur`, `form`, and `ref` on the field (the search input
 * when async). Long lists are virtualised.
 */
export function MultiSelect(props: MultiSelectProps) {
  return props.loadOptions ? <FormsMultiAsync {...props} loadOptions={props.loadOptions} /> : <FormsMultiStatic {...props} />
}

/** MultiSelect's chips: each value's label and colour dot, with a × while it can be edited. */
function FormsChips({ box, values, optionOf, locked, onRemove, tabbable }: { box: RefObject<HTMLDivElement | null>; values: string[]; optionOf: (v: string) => Option | undefined; locked: boolean; onRemove: (v: string) => void; tabbable: boolean }) {
  useFlip(box)
  return (
    <PresenceList items={values} keyOf={x => x} pop>
      {x => { const o = optionOf(x); return <FormsChip id={x} label={o?.label ?? x} dot={o?.dot} locked={locked} tabbable={tabbable} onRemove={() => onRemove(x)} /> }}
    </PresenceList>
  )
}

/** MultiSelect over a fixed `options` list: the field itself is the combobox. */
function FormsMultiStatic({ options = [], value, defaultValue = [], onChange, placeholder = 'Select…', 'aria-label': ariaLabel, className, ref, ...rest }: MultiSelectProps) {
  const { loadOptions: _l, debounce: _d, minChars: _m, defaultOptions: _o, creatable: _c, createLabel: _cl, onCreate: _oc, onInputChange: _oi, onLoadError: _le, empty: _e, ...fp } = rest
  const box = useRef<HTMLDivElement>(null)
  const fc = useFormControl<string[]>({ ...fp, value, defaultValue, onChange, serialize: x => x, filled: x => x.length > 0, focus: () => box.current?.focus() })
  const v = fc.value, set = fc.set, locked = fc.disabled || fc.readOnly
  const { open, setOpen, ref: wrap } = useDisclosure()
  const toggle = (i: number) => { if (!options[i] || options[i].disabled) return; const o = options[i].value; set(v.includes(o) ? v.filter(x => x !== o) : [...v, o]) }
  const lb = useListbox(options, toggle, { open, setOpen, locked })
  return (
    <div ref={wrap} className={cn('relative', className)} onBlur={fc.onBlur}>
      <div ref={composeRefs<HTMLDivElement>(box, ref as Ref<HTMLDivElement>)} {...fc.control} {...lb.comboProps} tabIndex={fc.disabled ? -1 : 0} aria-label={ariaLabel} aria-labelledby={ariaLabel ? undefined : fc.labelledBy}
        aria-required={fc.required || undefined} aria-readonly={fc.readOnly || undefined} aria-disabled={fc.disabled || undefined}
        onClick={() => lb.show(!open)} onKeyDown={e => {
          if (locked) return
          if (e.key === 'Backspace' && v.length) set(v.slice(0, -1))
          else lb.onKeyDown(e)
        }}
        className={cn(inputClass, 'relative flex !h-auto min-h-9 flex-wrap items-center gap-1 py-1 !pe-8 focus-visible:border-[var(--fg3)]', locked ? fc.disabled ? 'cursor-not-allowed' : 'cursor-default' : 'cursor-pointer')}>
        {v.length === 0 && <span className="text-[var(--fg3)]">{placeholder}</span>}
        <FormsChips box={box} values={v} optionOf={x => options.find(p => p.value === x)} locked={locked} tabbable={false} onRemove={x => set(v.filter(y => y !== x))} />
        {!fc.readOnly && <Chevron open={open} className="absolute end-3 top-[11px]" />}
      </div>
      <FloatingPanel open={open} matchWidth className="max-h-64 overflow-auto" role="presentation">
        <OptionList id={lb.id} multi options={options} active={lb.active} isSelected={o => v.includes(o.value)} onPick={toggle} onHover={lb.setActive} />
      </FloatingPanel>
      {fc.inputs}
    </div>
  )
}

/** MultiSelect with `loadOptions`: a search input after the chips is the combobox; results load as you type. */
function FormsMultiAsync({ options = [], loadOptions, debounce = 200, minChars = 0, defaultOptions, creatable, createLabel, onCreate, onInputChange, onLoadError,
  empty, value, defaultValue = [], onChange, placeholder = 'Search…', 'aria-label': ariaLabel, className, ref, ...fp }: MultiSelectProps & { loadOptions: FormsLoader }) {
  const input = useRef<HTMLInputElement>(null)
  const index = useOptionIndex(options, defaultOptions)
  const [q, setQ] = useState('')
  const fc = useFormControl<string[]>({ ...fp, value, defaultValue, onChange, serialize: x => x, filled: x => x.length > 0, focus: () => input.current?.focus(), onReset: () => setQ('') })
  const v = fc.value, set = fc.set, locked = fc.disabled || fc.readOnly
  const { open: isOpen, setOpen, ref: wrap } = useDisclosure()
  const open = isOpen && !locked
  const query = q.trim()
  const src = useOptionSource(index, { options, defaultOptions, loadOptions, query, open, minChars, debounce, creatable, createLabel, onCreate, chosen: v, empty, onLoadError, focus: () => input.current?.focus() })
  const { list, loading, failed } = src
  const toggle = (i: number) => {
    const creating = !!list[i] && src.isCreate(list[i]), o = src.resolve(i)
    if (!o) return
    if (creating) { if (!v.includes(o.value)) set([...v, o.value]); setQ(''); onInputChange?.(''); return }
    set(v.includes(o.value) ? v.filter(x => x !== o.value) : [...v, o.value])
  }
  const lb = useListbox(list, toggle, { open, setOpen, input: true }), { active, setActive } = lb
  const shell = useRef<HTMLDivElement>(null)
  return (
    <div ref={wrap} className={cn('relative', className)} onBlur={fc.onBlur}>
      <div ref={shell} onPointerDown={e => { if (e.target !== input.current && !(e.target as HTMLElement).closest('button')) { e.preventDefault(); input.current?.focus() } }}
        className={cn(inputShellClass(fc.invalid), 'relative flex min-h-9 w-full flex-wrap items-center gap-1 py-1 ps-1.5 pe-8 text-[13px]',
          fc.disabled ? 'cursor-not-allowed bg-[var(--muted)] text-[var(--fg3)]' : fc.readOnly ? 'bg-[var(--muted)]' : 'cursor-text')}>
        <FormsChips box={shell} values={v} optionOf={index.optionOf} locked={locked} tabbable onRemove={x => set(v.filter(y => y !== x))} />
        <input ref={composeRefs<HTMLInputElement>(input, ref as Ref<HTMLInputElement>)} {...fc.control} {...lb.comboProps} aria-label={ariaLabel} aria-required={fc.required || undefined} disabled={fc.disabled} readOnly={fc.readOnly}
          value={q} placeholder={v.length ? '' : placeholder} autoComplete="off"
          className="h-7 min-w-[8ch] flex-1 border-0 bg-transparent px-1 text-[13px] [color:inherit] outline-none placeholder:text-[var(--fg3)] disabled:cursor-not-allowed [@media(pointer:coarse)]:text-base"
          onChange={e => { setQ(e.target.value); onInputChange?.(e.target.value); setOpen(true); setActive(0) }} onFocus={() => setOpen(true)}
          onBlur={e => { if (!wrap.current?.contains(e.relatedTarget as Node)) setOpen(false) }}
          onKeyDown={e => {
            if (locked) return
            if (e.key === 'Backspace' && !q && v.length) { e.preventDefault(); set(v.slice(0, -1)) }
            else if (e.key === 'Enter' && failed) { e.preventDefault(); src.retry() }
            else lb.onKeyDown(e)
          }} />
        <span aria-hidden className="pointer-events-none absolute end-3 top-1/2 grid -translate-y-1/2 text-[var(--fg3)]">{loading && open ? <Spinner size={13} /> : <Icon name="search" size={14} />}</span>
      </div>
      <span className="sr-only" aria-live="polite">{open ? src.live : ''}</span>
      <FloatingPanel open={open} matchWidth flip="scroll" className="max-h-64 overflow-auto" role="presentation">
        {list.length > 0 && (failed || (loading && !src.matches.length)) && <div className="p-3 pb-1 text-center text-[13px] text-[var(--fg3)]">{src.message}</div>}
        <OptionList id={lb.id} multi options={list} query={query} active={active} isSelected={o => !src.isCreate(o) && v.includes(o.value)} onPick={toggle} onHover={setActive} empty={src.message} busy={loading} />
      </FloatingPanel>
      {fc.inputs}
    </div>
  )
}

/**
 * The async half of Combobox and MultiSelect: runs `loadOptions` `debounce` ms after the query settles (while the list is
 * open and the query has `minChars`), aborts a superseded request and drops its late result, and reports loading and
 * errors (`onLoadError` gets the reason). A cancelled request leaves no spinner behind. `retry()` loads the same query again.
 */
function useFormsLoader(loadOptions: FormsLoader | undefined,
  { query, open, minChars, debounce, defaultOptions, onItems, onLoadError }: { query: string; open: boolean; minChars: number; debounce: number; defaultOptions?: Option[]
    onItems: (items: Option[]) => void; onLoadError?: (error: unknown) => void }) {
  const [load, setLoad] = useState<FormsLoad>({ q: '', status: 'idle', items: defaultOptions ?? [] })
  const [attempt, setAttempt] = useState(0)
  const fns = useRef({ loadOptions, onItems, onLoadError })
  useLayoutEffect(() => { fns.current = { loadOptions, onItems, onLoadError } })
  const short = !!loadOptions && query.length < minChars
  useEffect(() => {
    if (!fns.current.loadOptions || !open || short) return
    const ac = new AbortController()
    setLoad(l => ({ ...l, q: query, status: 'loading' }))
    const t = setTimeout(() => {
      fns.current.loadOptions?.(query, { signal: ac.signal }).then(
        items => { if (ac.signal.aborted) return; fns.current.onItems(items); setLoad({ q: query, status: 'done', items }) },
        error => { if (ac.signal.aborted) return; setLoad({ q: query, status: 'error', items: [], error }); fns.current.onLoadError?.(error) })
    }, debounce)
    return () => { clearTimeout(t); ac.abort(); setLoad(l => (l.status === 'loading' ? { ...l, status: 'idle' } : l)) }
  }, [query, open, attempt, short, debounce])
  return { load, short, loading: !!loadOptions && load.status === 'loading', failed: !!loadOptions && load.status === 'error', retry: () => setAttempt(a => a + 1) }
}
