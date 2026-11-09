import { useEffect, useId, useLayoutEffect, useRef, useState, type AriaAttributes, type InputHTMLAttributes, type ReactNode, type Ref, type TextareaHTMLAttributes, type KeyboardEvent as RKeyboardEvent } from 'react'
import { AnimatePresence, animate, motion, useReducedMotion } from 'motion/react'
import { AnimatedNumber, Badge, Button, ICONS, Icon, type IconName, IconButton, LOCALE, addDays, addMonths, clamp, cn, fmt, fmtDate, hex2hue, hsl2hex, inputClass, isTouch, menuItemClass, prefersReducedMotion, sameDay, spring, startOfDay, useCoarsePointer, useControllable, useDisclosure, usePointerDrag, useRoving } from './core'
import { play, shake } from './motion'
import { FloatingPanel, Popover, PopoverContent, type Placement, usePopover } from './overlay'
import { Progress } from './feedback'

/* ════════════════════════════════════════════════════════════════════════════
 * 6. FORM CONTROLS
 * ══════════════════════════════════════════════════════════════════════════ */

/**
 * Frame for composite fields (an input plus addons, chips or buttons inside one border): focus ring while anything inside
 * has focus, red ring when `invalid`. Add height and layout yourself: cn(inputShellClass(bad), 'flex h-9 items-stretch').
 */
export const inputShellClass = (invalid?: boolean) => cn('rounded-[var(--r-md)] border bg-[var(--card)] transition-[border-color,box-shadow]',
  invalid ? 'border-[var(--bad)] shadow-[0_0_0_3px_var(--bad-soft)]' : 'border-[var(--line)] hover:[&:not(:focus-within)]:border-[var(--line2)] focus-within:border-[var(--fg3)] focus-within:shadow-[0_0_0_3px_var(--muted)]')

/** Native range inputs: a thin track on desktop; on touch the input grows to a 32px hit area (padding, track drawn in the content box). */
export const rangeInputClass = 'w-full cursor-pointer appearance-none rounded-full bg-clip-content [@media(pointer:coarse)]:box-content [@media(pointer:coarse)]:py-[13px] [@media(pointer:coarse)]:-my-[13px]'


/** Scroll `el` into view inside its nearest scrollable ancestor only (never the page). */
function formsScrollIntoList(el: HTMLElement, center = false) {
  let p = el.parentElement
  while (p && p !== document.body && !/(auto|scroll)/.test(getComputedStyle(p).overflowY)) p = p.parentElement
  if (!p || p === document.body) return
  const er = el.getBoundingClientRect(), pr = p.getBoundingClientRect()
  if (center) p.scrollTop += er.top - pr.top - (pr.height - er.height) / 2
  else if (er.top < pr.top) p.scrollTop -= pr.top - er.top + 4
  else if (er.bottom > pr.bottom) p.scrollTop += er.bottom - pr.bottom + 4
}

/** Bold the first case-insensitive match of `query` inside `text` (for option lists and autocomplete). */
function formsHighlight(text: string, query?: string): ReactNode {
  const q = query?.trim()
  if (!q) return text
  const i = text.toLowerCase().indexOf(q.toLowerCase())
  if (i < 0) return text
  return <>{text.slice(0, i)}<mark className="bg-transparent font-semibold text-[var(--fg)]">{text.slice(i, i + q.length)}</mark>{text.slice(i + q.length)}</>
}

/** Form label. */
export function Label({ children, htmlFor, className }: { children: ReactNode; htmlFor?: string; className?: string }) {
  return <label htmlFor={htmlFor} className={cn('mb-1.5 block text-[13px] font-medium', className)}>{children}</label>
}

/** Label + control + hint/error. The hint turns red (or green) and is announced. */
export function Field({ label, hint, error, success, htmlFor, children, className }:
  { label?: ReactNode; hint?: ReactNode; error?: ReactNode; success?: ReactNode; htmlFor?: string; children: ReactNode; className?: string }) {
  const msg = error ?? success ?? hint
  return (
    <div className={className}>
      {label && <Label htmlFor={htmlFor}>{label}</Label>}
      {children}
      {msg && <p aria-live="polite" className={cn('mt-1.5 mb-0 text-xs',
        error ? 'text-[var(--bad)]' : success ? 'text-[var(--ok)]' : 'text-[var(--fg3)]')}>{msg}</p>}
    </div>
  )
}

/** Give one element to several refs (yours and the caller's). */
function formsMergeRefs<T>(...refs: (Ref<T> | undefined)[]) {
  return (el: T | null) => { for (const r of refs) { if (typeof r === 'function') r(el); else if (r) (r as { current: T | null }).current = el } }
}

/** Text input. Set `invalid` to show the error ring; it shakes once when it becomes invalid. Your `ref` reaches the <input>. */
export function Input({ invalid, className, ref: outer, ...p }: InputHTMLAttributes<HTMLInputElement> & { invalid?: boolean; ref?: Ref<HTMLInputElement> }) {
  const ref = useRef<HTMLInputElement>(null)
  const reduce = useReducedMotion()
  useEffect(() => {
    if (invalid && !reduce && ref.current) ref.current.animate([0, -6, 6, -4, 4, 0].map(x => ({ transform: `translateX(${x}px)` })), { duration: 350 })
  }, [invalid, reduce])
  return <input ref={formsMergeRefs(ref, outer)} aria-invalid={invalid || undefined} className={cn(inputClass, className)} {...p} />
}

const TA_TONE = {
  ok: ['text-[var(--fg3)]', 'stroke-[var(--primary)]'], warn: ['text-[var(--warn)]', 'stroke-[var(--warn)]'], bad: ['text-[var(--bad)]', 'stroke-[var(--bad)]'],
} as const

/**
 * Auto-growing textarea; the height animates as lines are added or removed.
 * With `maxLength` it shows "N left" and a ring that fills toward the limit, turning amber under 20 and red under 5, and pops at 0.
 */
export function Textarea({ className, maxLength, value, defaultValue, onChange, rows = 3, ...p }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  const ref = useRef<HTMLTextAreaElement>(null), countRef = useRef<HTMLSpanElement>(null), fitted = useRef<string | null>(null)
  const [innerLen, setInnerLen] = useState(String(defaultValue ?? '').length)
  const len = value !== undefined ? String(value).length : innerLen
  const fit = (anim: boolean) => {
    const t = ref.current; if (!t) return
    fitted.current = t.value
    const h0 = t.offsetHeight; t.style.height = 'auto'; const h1 = t.scrollHeight + 2
    if (!anim || !h0 || h0 === h1 || prefersReducedMotion()) { t.style.height = h1 + 'px'; return }
    t.style.height = h0 + 'px'; animate(t, { height: [h0, h1] }, { duration: 0.15 })
  }
  useLayoutEffect(() => { if (ref.current && ref.current.value !== fitted.current) fit(false) })
  const left = maxLength ? maxLength - len : 0
  const tone = left < 5 ? 'bad' : left < 20 ? 'warn' : 'ok'
  useEffect(() => { if (maxLength && left === 0) play(countRef.current, { scale: [1.3, 1] }, spring(0.5, 0.3)) }, [left, maxLength])
  return (
    <div>
      <textarea ref={ref} rows={rows} maxLength={maxLength} value={value} defaultValue={defaultValue}
        onChange={e => { setInnerLen(e.target.value.length); fit(true); onChange?.(e) }}
        className={cn(inputClass, 'resize-none overflow-hidden !py-2 leading-relaxed', className)} {...p} />
      {maxLength && (
        <div className="mt-1.5 flex items-center justify-end gap-1.5">
          <span ref={countRef} className={cn('ui-num inline-block text-xs transition-colors', TA_TONE[tone][0])}>{left} left</span>
          <svg width="18" height="18" viewBox="0 0 20 20" className="-rotate-90" aria-hidden>
            <circle cx="10" cy="10" r="8" fill="none" stroke="var(--line)" strokeWidth="2.5" />
            <motion.circle cx="10" cy="10" r="8" fill="none" strokeWidth="2.5" strokeLinecap="round" strokeDasharray="50.27" className={cn('transition-[stroke]', TA_TONE[tone][1])}
              initial={false} animate={{ strokeDashoffset: 50.27 * (1 - Math.min(1, len / maxLength)) }} transition={{ duration: 0.15 }} />
          </svg>
        </div>
      )}
    </div>
  )
}

const PW_RULES: [string, RegExp][] = [['8+ characters', /.{8,}/], ['Uppercase', /[A-Z]/], ['Number', /\d/], ['Symbol', /[^A-Za-z0-9]/]]
const PW_BAR = ['bg-[var(--bad)]', 'bg-[var(--warn)]', 'bg-[var(--accent)]', 'bg-[var(--ok)]']

/**
 * Password with show/hide (the eye pops when it flips). `strength` adds four bars that fill in a stagger
 * and a rules checklist (8+ characters, uppercase, number, symbol) that ticks green as each is met.
 */
export function PasswordInput({ strength, rules = strength, className, onChange, ...p }: InputHTMLAttributes<HTMLInputElement> & { strength?: boolean; rules?: boolean }) {
  const [show, setShow] = useState(false), [flips, setFlips] = useState(0)
  const [inner, setV] = useState(String(p.defaultValue ?? ''))
  const v = p.value !== undefined ? String(p.value) : inner // controlled: follow the prop
  const passed = PW_RULES.map(([, r]) => r.test(v))
  const score = v ? passed.filter(Boolean).length : 0
  const [prev, setPrev] = useState(score), [from, setFrom] = useState(0)
  if (score !== prev) { setFrom(prev); setPrev(score) }
  return (
    <div className={cn('flex flex-col gap-2', className)}>
      <div className="relative">
        <input type={show ? 'text' : 'password'} className={cn(inputClass, '!pr-10')} {...p}
          onChange={e => { setV(e.target.value); onChange?.(e) }} />
        <span className="absolute top-1/2 right-1 flex -translate-y-1/2">
          <Button size="icon-sm" variant="ghost" aria-label={show ? 'Hide password' : 'Show password'} title={show ? 'Hide password' : 'Show password'}
            className="text-[var(--fg3)] hover:text-[var(--fg)]" onClick={() => { setShow(!show); setFlips(f => f + 1) }}>
            <motion.span key={flips} className="grid" initial={flips ? { scale: 0.7 } : false} animate={{ scale: 1 }} transition={spring(0.5, 0.3)}>
              <Icon name={show ? 'eyeOff' : 'eye'} size={15} />
            </motion.span>
          </Button>
        </span>
      </div>
      {strength && (
        <div className="grid grid-cols-4 gap-1" aria-hidden>
          {[0, 1, 2, 3].map(i => (
            <div key={i} className="h-1 overflow-hidden rounded-full bg-[var(--muted)]">
              <motion.div className={cn('h-full origin-left transition-colors', PW_BAR[Math.max(0, score - 1)])} initial={false}
                animate={{ scaleX: i < score ? 1 : 0 }} transition={{ duration: 0.25, delay: i < score && i >= from ? (i - from) * 0.05 : 0 }} />
            </div>
          ))}
        </div>
      )}
      {rules && (
        <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs">
          {PW_RULES.map(([label], i) => (
            <motion.span key={label + passed[i]} initial={passed[i] ? { scale: 0.9 } : false} animate={{ scale: 1 }} transition={spring(0.5, 0.3)}
              className={cn('inline-block transition-colors', passed[i] ? 'text-[var(--ok)]' : 'text-[var(--fg3)]')}>
              <span aria-hidden>{passed[i] ? '✓' : '○'} </span>{label}<span className="sr-only">{passed[i] ? ' (met)' : ' (not met)'}</span>
            </motion.span>
          ))}
        </div>
      )}
      {strength && <span className="sr-only" aria-live="polite">{v ? `Strength ${score} of 4` : ''}</span>}
    </div>
  )
}

/** Props Switch and Checkbox share with native checkboxes, so they work inside a <form>. */
type FormsToggleProps = AriaAttributes & {
  checked?: boolean; defaultChecked?: boolean; onChange?: (v: boolean) => void; disabled?: boolean
  /** with `name`, a visually hidden checkbox submits `value` (default "on") when checked, like a native one */ name?: string; value?: string
  required?: boolean; id?: string; className?: string
}
/** The native checkbox behind a Switch/Checkbox: submitted with the form, validated for `required`, never focused. */
function FormsHiddenCheck({ name, value, checked, required, disabled }: { name?: string; value?: string; checked: boolean; required?: boolean; disabled?: boolean }) {
  if (!name && !required) return null
  return <input type="checkbox" aria-hidden tabIndex={-1} name={name} value={value ?? 'on'} checked={checked} required={required} disabled={disabled} onChange={() => {}}
    className="pointer-events-none absolute m-0 h-px w-px opacity-0" />
}
const formsAria = (p: Record<string, unknown>) => Object.fromEntries(Object.entries(p).filter(([k]) => k.startsWith('aria-'))) as AriaAttributes

/**
 * Toggle. The knob springs across and stretches (squash replays on every toggle). Takes id, name, value, required and
 * aria-* like a native checkbox (with `name` it submits inside a form); `label` puts it in a clickable row.
 */
export function Switch({ checked, defaultChecked = false, onChange, label, disabled, name, value, required, id, className, ...rest }: FormsToggleProps & { label?: ReactNode }) {
  const [on, set] = useControllable(checked, defaultChecked, onChange)
  const [flips, setFlips] = useState(0)
  const coarse = useCoarsePointer() // touch: a larger, iOS-sized switch (52×32)
  const btn = (
    <button type="button" id={id} role="switch" aria-checked={on} aria-required={required || undefined} disabled={disabled} aria-label={typeof label === 'string' ? label : undefined} {...formsAria(rest)} onClick={() => { set(!on); setFlips(f => f + 1) }}
      className={cn('relative h-[22px] w-[38px] flex-none cursor-pointer rounded-full border-0 p-0 transition-colors disabled:opacity-50 [@media(pointer:coarse)]:h-8 [@media(pointer:coarse)]:w-[52px]',
        on ? 'bg-[var(--primary)]' : 'bg-[var(--line2)]', !label && className)}>
      <motion.i className="absolute top-[3px] left-[3px] block h-4 w-4 [@media(pointer:coarse)]:h-[26px] [@media(pointer:coarse)]:w-[26px]" initial={false} animate={{ x: on ? (coarse ? 20 : 16) : 0 }} transition={spring(0.35, 0.4)}>
        <motion.i key={flips} className="block h-full w-full rounded-full bg-[var(--card)] shadow-[0_1px_2px_rgba(0,0,0,.25)]"
          initial={flips ? { scaleX: 1.3 } : false} animate={{ scaleX: 1 }} transition={spring(0.35, 0.4)} />
      </motion.i>
    </button>
  )
  const hidden = <FormsHiddenCheck name={name} value={value} checked={on} required={required} disabled={disabled} />
  if (!label) return <>{btn}{hidden}</>
  return <label className={cn('relative flex cursor-pointer items-center justify-between gap-3 text-[13px] [@media(pointer:coarse)]:min-h-10', className)}>{label}{btn}{hidden}</label>
}

/**
 * A checkmark that draws itself: the stroke grows in when `checked` turns on and retracts when it turns off. `draw` also
 * draws it on mount (e.g. a success state appearing); otherwise it starts in its current state. Inherits the text colour.
 */
export function CheckMark({ checked = true, size = 12, strokeWidth = 3.5, draw = false, delay = 0, duration, className }:
  { checked?: boolean; size?: number; strokeWidth?: number; draw?: boolean; delay?: number; duration?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" aria-hidden className={cn('flex-none', className)}>
      <motion.path d={ICONS.check} initial={draw ? { pathLength: 0 } : false} animate={{ pathLength: checked ? 1 : 0 }} transition={{ duration: duration ?? (checked ? 0.3 : 0.15), delay }} />
    </svg>
  )
}

/** The square box of a checkbox (filled with a drawn tick when checked; pops on change). For custom rows, lists and tables; the row carries the role. */
export function CheckboxBox({ checked, size = 18, pop = true, className }: { checked: boolean; size?: number; pop?: boolean; className?: string }) {
  return (
    <motion.span key={pop ? String(checked) : undefined} initial={false} animate={pop ? { scale: [1, 0.85, 1] } : undefined} transition={spring(0.5, 0.3)} aria-hidden
      style={{ width: size, height: size }}
      className={cn('grid flex-none place-items-center border-[1.5px] text-[var(--on-primary)] transition-colors', size < 18 ? 'rounded-[var(--r-sm)]' : 'rounded-[var(--r-sm)]',
        checked ? 'border-[var(--primary)] bg-[var(--primary)]' : 'border-[var(--line2)]', className)}>
      <CheckMark checked={checked} size={Math.round(size * 0.66)} strokeWidth={size < 18 ? 4 : 3.5} duration={checked ? (size < 18 ? 0.25 : 0.3) : (size < 18 ? 0.12 : 0.15)} />
    </motion.span>
  )
}

/** Checkbox with a drawn checkmark; `children` is its label. Takes id, name, value, required and aria-* like a native checkbox. */
export function Checkbox({ checked, defaultChecked = false, onChange, children, disabled, name, value, required, id, className, ...rest }: FormsToggleProps & { children?: ReactNode }) {
  const [on, set] = useControllable(checked, defaultChecked, onChange)
  return (
    <>
      <button type="button" id={id} role="checkbox" aria-checked={on} aria-required={required || undefined} disabled={disabled} {...formsAria(rest)} onClick={() => set(!on)}
        className={cn('flex cursor-pointer items-center gap-2.5 border-0 bg-transparent p-0 text-left text-[13px] select-none disabled:opacity-50 [@media(pointer:coarse)]:min-h-9', className)}>
        <CheckboxBox checked={on} />
        {children}
      </button>
      <FormsHiddenCheck name={name} value={value} checked={on} required={required} disabled={disabled} />
    </>
  )
}

export type Option = {
  value: string; label: string; hint?: string; icon?: IconName; disabled?: boolean
  /** colour dot, e.g. 'var(--bad)' */ dot?: string
  /** anything shown before the label: a flag, an emoji, an avatar */ leading?: ReactNode
}

/** Radio group with arrow-key navigation. */
export function RadioGroup({ options, value, defaultValue, onChange, label, className }:
  { options: Option[]; value?: string; defaultValue?: string; onChange?: (v: string) => void; label?: string; className?: string }) {
  const [v, set] = useControllable(value, defaultValue ?? options.find(o => !o.disabled)?.value ?? '', onChange)
  const refs = useRef<(HTMLButtonElement | null)[]>([])
  const sel = options.findIndex(o => o.value === v && !o.disabled)
  const tabStop = sel >= 0 ? sel : options.findIndex(o => !o.disabled) // value missing or disabled: the first enabled option takes Tab
  const { onKeyDown } = useRoving(options.length, () => {}, { orientation: 'both', isDisabled: i => !!options[i].disabled, index: Math.max(0, tabStop), homeEnd: false,
    onMove: n => { set(options[n].value); refs.current[n]?.focus() } })
  return (
    <div role="radiogroup" aria-label={label} className={cn('flex flex-col gap-2.5', className)} onKeyDown={onKeyDown}>
      {options.map((o, i) => {
        const on = o.value === v
        return (
          <button type="button" key={o.value} ref={el => { refs.current[i] = el }} role="radio" aria-checked={on} disabled={o.disabled} tabIndex={i === tabStop ? 0 : -1} onClick={() => set(o.value)}
            className="flex cursor-pointer items-center gap-2.5 border-0 bg-transparent p-0 text-left text-[13px] disabled:cursor-default disabled:opacity-50 [@media(pointer:coarse)]:min-h-9">
            <span className={cn('grid h-[18px] w-[18px] flex-none place-items-center rounded-full border-[1.5px]', on ? 'border-[var(--primary)]' : 'border-[var(--line2)]')}>
              <motion.i className="block h-2 w-2 rounded-full bg-[var(--primary)]" initial={false} animate={{ scale: on ? 1 : 0 }} transition={on ? spring(0.5, 0.35) : { duration: 0.1 }} />
            </span>
            <span>{o.label}{o.hint && <span className="block text-xs text-[var(--fg3)]">{o.hint}</span>}</span>
          </button>
        )
      })}
    </div>
  )
}

/**
 * The sliding highlight shared by SegmentedControl, Tabs, NavList, pricing toggles...
 * Render it inside the active item; motion animates it between items with the same `group`.
 */
export function ActiveIndicator({ group, className }: { group: string; className?: string }) {
  return <motion.span layoutId={group} className={cn('absolute inset-0', className)} transition={spring(0.2, 0.45)} />
}

/**
 * Segmented control with a sliding pill: a single choice, so it is a radiogroup (role=radio + aria-checked). One Tab
 * stop (the chosen segment); ←/→ (and ↑/↓) move and select, Home/End jump. Name the group with `aria-label`.
 */
export function SegmentedControl({ options, value, defaultValue, onChange, className, size = 'md', 'aria-label': ariaLabel }:
  { options: (Option | string)[]; value?: string; defaultValue?: string; onChange?: (v: string) => void; className?: string; size?: 'sm' | 'md'; 'aria-label'?: string }) {
  const opts = options.map(o => typeof o === 'string' ? { value: o, label: o } as Option : o)
  const [v, set] = useControllable(value, defaultValue ?? opts[0].value, onChange)
  const group = useId()
  const refs = useRef<(HTMLButtonElement | null)[]>([])
  const sel = opts.findIndex(o => o.value === v && !o.disabled)
  const tabStop = sel >= 0 ? sel : Math.max(0, opts.findIndex(o => !o.disabled))
  const { onKeyDown } = useRoving(opts.length, () => {}, { orientation: 'both', isDisabled: i => !!opts[i].disabled, index: tabStop,
    onMove: n => { set(opts[n].value); refs.current[n]?.focus() } })
  return (
    <div role="radiogroup" aria-label={ariaLabel} onKeyDown={onKeyDown} className={cn('relative inline-flex rounded-[calc(var(--r-md)+1px)] bg-[var(--muted)] p-1', className)}>
      {opts.map((o, i) => (
        <button type="button" key={o.value} ref={el => { refs.current[i] = el }} role="radio" aria-checked={o.value === v} tabIndex={i === tabStop ? 0 : -1} disabled={o.disabled}
          aria-label={o.label ? undefined : o.value} onClick={() => set(o.value)}
          className={cn('relative flex-1 cursor-pointer rounded-[calc(var(--r-md)-2px)] border-0 bg-transparent px-3 font-medium whitespace-nowrap transition-colors disabled:cursor-default disabled:opacity-50',
            size === 'sm' ? 'h-[22px] text-xs [@media(pointer:coarse)]:h-8' : 'h-7 text-[13px] [@media(pointer:coarse)]:h-9', o.value === v ? 'text-[var(--fg)]' : 'text-[var(--fg2)] hover:text-[var(--fg)]')}>
          {o.value === v && <ActiveIndicator group={group} className="rounded-[calc(var(--r-md)-2px)] bg-[var(--card)] shadow-[0_1px_2px_rgba(0,0,0,.08)]" />}
          <span className="relative flex items-center justify-center gap-1.5">{o.icon && <Icon name={o.icon} size={14} />}{o.label}{o.hint && <Badge tone="ok" size="sm">{o.hint}</Badge>}</span>
        </button>
      ))}
    </div>
  )
}

/**
 * Range slider with live value. `disabled` fades only the track (label and value stay legible in --fg3; the group gets aria-disabled). Native input: keyboard and screen readers for free, a 32px hit area on touch.
 * `steps` makes it a stepped picker over named stops (value = index; the names show under the track and can be tapped).
 * `compact` uses a smaller grey readout (settings panels).
 */
export function Slider({ value, defaultValue, onChange, min: minProp = 0, max: maxProp = 100, step: stepProp = 1, label, format, disabled, compact, steps, id, className }:
  { value?: number; defaultValue?: number; onChange?: (v: number) => void; min?: number; max?: number; step?: number; label?: string; format?: (v: number) => ReactNode
    disabled?: boolean; compact?: boolean; steps?: string[]; id?: string; className?: string }) {
  const named = !!steps && steps.length > 1
  const min = named ? 0 : minProp, max = named ? steps.length - 1 : maxProp, step = named ? 1 : stepProp
  const [v, set] = useControllable(value, defaultValue ?? (named ? 0 : (min + max) / 2), onChange)
  const pct = clamp(((v - min) / (max - min || 1)) * 100, 0, 100)
  const shown = named ? steps[clamp(Math.round(v), 0, steps.length - 1)] : format ? format(v) : v
  return (
    // disabled: only the track and thumb fade; the label and value switch to --fg3 (still ≥4.5:1, never faded with opacity)
    <div role="group" aria-label={label} aria-disabled={disabled || undefined} className={className}>
      {label && (
        <div className={cn('flex justify-between text-[13px]', compact ? 'mb-1.5' : 'mb-2')}>
          <span className={disabled ? 'text-[var(--fg3)]' : 'text-[var(--fg2)]'}>{label}</span>
          <span className={cn('ui-num', compact || disabled ? 'text-[var(--fg3)]' : 'font-medium', compact && 'text-xs')}>{shown}</span>
        </div>
      )}
      <input type="range" id={id} min={min} max={max} step={step} value={v} disabled={disabled} aria-label={label} aria-valuetext={named ? String(shown) : undefined}
        onChange={e => set(Number(e.target.value))}
        className={cn(rangeInputClass, 'h-1.5 accent-[var(--primary)] transition-opacity disabled:cursor-default disabled:opacity-40')}
        style={{ backgroundImage: `linear-gradient(to right, var(--primary) ${pct}%, var(--muted) ${pct}%)` }} />
      {named && (
        <span className="relative mt-1.5 block h-4 [@media(pointer:coarse)]:mt-1 [@media(pointer:coarse)]:h-8">
          {steps.map((x, k) => (
            <button key={x} type="button" tabIndex={-1} disabled={disabled} onClick={() => set(k)} style={{ left: `${(k / (steps.length - 1)) * 100}%` }}
              className={cn('absolute top-0 cursor-pointer border-0 bg-transparent p-0 text-[11px] whitespace-nowrap disabled:cursor-default [@media(pointer:coarse)]:h-8 [@media(pointer:coarse)]:min-w-8',
                k === 0 ? '' : k === steps.length - 1 ? '-translate-x-full' : '-translate-x-1/2', k === Math.round(v) && !disabled ? 'font-semibold text-[var(--fg)]' : k === Math.round(v) ? 'font-semibold text-[var(--fg3)]' : 'text-[var(--fg3)]')}>{x}</button>
          ))}
        </span>
      )}
    </div>
  )
}

/**
 * − value + with a rolling number. The whole control is one spinbutton tab stop: ↑/→ and ↓/← step,
 * Home and End jump to min and max, and it wiggles when you push past either limit.
 */
export function NumberStepper({ value, defaultValue = 0, onChange, min = -Infinity, max = Infinity, step = 1, label = 'Quantity', format, className }:
  { value?: number; defaultValue?: number; onChange?: (v: number) => void; min?: number; max?: number; step?: number; label?: string; format?: Intl.NumberFormatOptions; className?: string }) {
  const [v, set] = useControllable(value, defaultValue, onChange)
  const root = useRef<HTMLDivElement>(null)
  const change = (n: number) => {
    const c = clamp(n, min, max)
    if (c === v) return shake(root.current, 4)
    set(c)
  }
  const btn = 'h-[34px] w-9 cursor-pointer border-0 bg-[var(--card)] text-base hover:bg-[var(--muted)] aria-disabled:opacity-40 aria-disabled:cursor-default grid place-items-center'
  return (
    <div ref={root} role="spinbutton" tabIndex={0} aria-label={label} aria-valuenow={v} aria-valuetext={new Intl.NumberFormat(LOCALE, format).format(v)}
      aria-valuemin={Number.isFinite(min) ? min : undefined} aria-valuemax={Number.isFinite(max) ? max : undefined}
      className={cn('inline-flex items-center overflow-hidden rounded-[var(--r-md)] border border-[var(--line)] outline-none focus-visible:border-[var(--fg3)] focus-visible:shadow-[0_0_0_3px_var(--muted)]', className)}
      onKeyDown={e => {
        const d = ({ ArrowUp: 1, ArrowRight: 1, ArrowDown: -1, ArrowLeft: -1 } as Record<string, number>)[e.key]
        if (d) { e.preventDefault(); change(v + d * step) }
        if (e.key === 'Home' && Number.isFinite(min)) { e.preventDefault(); change(min) }
        if (e.key === 'End' && Number.isFinite(max)) { e.preventDefault(); change(max) }
      }}>
      <button type="button" tabIndex={-1} className={btn} aria-label={`Decrease ${label}`} aria-disabled={v <= min || undefined}
        onPointerDown={e => { e.preventDefault(); root.current?.focus() }} onClick={() => change(v - step)}><Icon name="minus" size={14} /></button>
      <span className="grid min-w-14 place-items-center text-base font-medium"><AnimatedNumber value={v} format={format} /></span>
      <button type="button" tabIndex={-1} className={btn} aria-label={`Increase ${label}`} aria-disabled={v >= max || undefined}
        onPointerDown={e => { e.preventDefault(); root.current?.focus() }} onClick={() => change(v + step)}><Icon name="plus" size={14} /></button>
    </div>
  )
}

/** 1–5 stars: every lit star pops again in sequence on each pick. Arrow keys change the rating. */
export function Rating({ value, defaultValue = 0, onChange, labels = ['Terrible', 'Bad', 'Okay', 'Good', 'Excellent'], prompt = 'Tap to rate', className }:
  { value?: number; defaultValue?: number; onChange?: (v: number) => void; labels?: string[]; prompt?: string; className?: string }) {
  const [v, set] = useControllable(value, defaultValue, onChange)
  const [hover, setHover] = useState(0)
  const refs = useRef<(HTMLButtonElement | null)[]>([])
  const shown = hover || v
  const pick = (n: number, focus = false) => {
    set(n)
    refs.current.forEach((el, i) => { if (i < n) play(el, { scale: [0.6, 1.2, 1] }, { duration: 0.4, ease: 'easeOut', delay: i * 0.05 }) })
    if (focus) refs.current[n - 1]?.focus()
  }
  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      <div className="flex gap-1 [@media(pointer:coarse)]:-mx-1.5 [@media(pointer:coarse)]:gap-0" role="radiogroup" aria-label="Rating" onPointerLeave={() => setHover(0)}>
        {[1, 2, 3, 4, 5].map(n => (
          <button type="button" key={n} ref={el => { refs.current[n - 1] = el }} role="radio" aria-checked={v === n} tabIndex={n === (v || 1) ? 0 : -1}
            aria-label={`${n} star${n > 1 ? 's' : ''}`} onClick={() => pick(n)} onPointerEnter={e => !isTouch(e) && setHover(n)}
            onKeyDown={e => {
              const d = ({ ArrowRight: 1, ArrowUp: 1, ArrowLeft: -1, ArrowDown: -1 } as Record<string, number>)[e.key]
              if (d) { e.preventDefault(); pick(Math.min(5, Math.max(1, (v || 0) + d)), true) }
            }}
            className={cn('cursor-pointer border-0 bg-transparent p-0.5 transition-colors [@media(pointer:coarse)]:p-1.5', n <= shown ? 'text-[#F59E0B]' : 'text-[var(--line2)]')}>
            <Icon name="star" size={22} fill="currentColor" strokeWidth={0} />
          </button>
        ))}
      </div>
      <span className="text-xs text-[var(--fg3)]" aria-live="polite">{shown ? labels[shown - 1] : prompt}</span>
    </div>
  )
}

/** Type and press Enter (or comma) to add; Backspace on empty removes the last tag. Duplicates wiggle. IME-safe. */
export function TagInput({ value, defaultValue = [], onChange, placeholder = 'Add a tag…', id, className }:
  { value?: string[]; defaultValue?: string[]; onChange?: (v: string[]) => void; placeholder?: string; id?: string; className?: string }) {
  const [tags, set] = useControllable(value, defaultValue, onChange)
  const [text, setText] = useState('')
  const [dupe, setDupe] = useState<string | null>(null)
  return (
    <div className={cn(inputShellClass(), 'flex flex-wrap gap-1.5 p-1.5', className)}>
      <AnimatePresence initial={false}>
        {tags.map(t => (
          <motion.span key={t} layout initial={{ scale: 0.6, opacity: 0 }} animate={{ scale: 1, opacity: 1, x: dupe === t ? [0, -4, 4, 0] : 0 }}
            exit={{ scale: 0.6, opacity: 0, transition: { duration: 0.15 } }} transition={spring(0.4, 0.35)}
            className="inline-flex items-center gap-1 rounded-[var(--r-md)] bg-[var(--muted)] py-1 pr-1 pl-2 text-xs">
            {t}
            <button type="button" aria-label={`Remove ${t}`} onClick={() => set(tags.filter(x => x !== t))} className="ui-target cursor-pointer rounded-[var(--r-sm)] border-0 bg-transparent px-1 leading-none text-[var(--fg3)] hover:bg-[var(--line)] hover:text-[var(--fg)] [@media(pointer:coarse)]:-my-2 [@media(pointer:coarse)]:-mr-1 [@media(pointer:coarse)]:min-h-8 [@media(pointer:coarse)]:min-w-8 [@media(pointer:coarse)]:text-base">×</button>
          </motion.span>
        ))}
      </AnimatePresence>
      <input id={id} value={text} placeholder={placeholder} aria-label={placeholder} onChange={e => setText(e.target.value)}
        onKeyDown={e => {
          if (e.nativeEvent.isComposing) return // Enter that confirms an IME candidate is not a submit
          const t = text.trim()
          if ((e.key === 'Enter' || e.key === ',') && t) {
            e.preventDefault()
            if (tags.includes(t)) { setDupe(t); setTimeout(() => setDupe(null), 300) } else set([...tags, t])
            setText('')
          }
          if (e.key === 'Backspace' && !text && tags.length) set(tags.slice(0, -1))
        }}
        className="min-w-20 flex-1 border-0 bg-transparent px-1 py-0.5 text-[13px] outline-none [@media(pointer:coarse)]:min-h-8" />
    </div>
  )
}

const otpSplit = (code: string, n: number) => { const d = code.replace(/\D/g, ''); return Array.from({ length: n }, (_, i) => d[i] ?? '') }

/**
 * One-time code: auto-advance, paste fills every box, typing into a filled box replaces and re-pops it.
 * `onChange` fires with the partial code on every edit (use it to reset your hint), `onComplete` with the full code.
 * Controlled with `value` (set it to '' to clear the boxes) or uncontrolled with `defaultValue`; `length` may change.
 * Pass `status="bad"` after a wrong code and the boxes shake (again on every wrong attempt); `"ok"` makes them hop.
 */
export function OTPInput({ length = 6, value, defaultValue = '', onComplete, onChange, status, className, 'aria-label': ariaLabel = 'One-time code' }:
  { length?: number; value?: string; defaultValue?: string; onComplete?: (code: string) => void; onChange?: (code: string) => void; status?: 'ok' | 'bad'; className?: string; 'aria-label'?: string }) {
  const [raw, setVals] = useState<string[]>(() => otpSplit(value ?? defaultValue, length))
  const vals = raw.length === length ? raw : otpSplit(raw.join(''), length)
  useEffect(() => { if (value !== undefined && value !== vals.join('')) setVals(otpSplit(value, length)) }, [value, length]) // eslint-disable-line react-hooks/exhaustive-deps
  const [attempt, setAttempt] = useState(0)
  const refs = useRef<(HTMLInputElement | null)[]>([]), box = useRef<HTMLDivElement>(null)
  useEffect(() => { if (status === 'bad' && attempt) shake(box.current, 8) }, [status, attempt])
  useEffect(() => { if (status === 'ok') refs.current.forEach((el, i) => play(el, { y: [0, -6, 0] }, { duration: 0.4, delay: i * 0.04 })) }, [status])
  const update = (next: string[]) => {
    setVals(next); const code = next.join(''); onChange?.(code)
    if (next.every(Boolean)) { setAttempt(a => a + 1); onComplete?.(code) }
  }
  const typed = (i: number, d: string) => {
    const n = [...vals]; n[i] = d; update(n)
    if (d) { play(refs.current[i], { scale: [1.12, 1] }, spring(0.5, 0.3)); refs.current[i + 1]?.focus() }
  }
  return (
    <div ref={box} className={cn('flex gap-2', className)} role="group" aria-label={ariaLabel}>
      {vals.map((c, i) => (
        <input key={i} ref={el => { refs.current[i] = el }} value={c} inputMode="numeric" autoComplete={i === 0 ? 'one-time-code' : 'off'} maxLength={1} aria-label={`Digit ${i + 1}`}
          onFocus={e => e.target.select()}
          onChange={e => typed(i, e.target.value.replace(/\D/g, '').slice(-1))}
          onKeyDown={e => {
            if (/^\d$/.test(e.key) && e.key === c) { e.preventDefault(); typed(i, c) } // same digit again: React fires no change, so handle it here
            else if (e.key === 'Backspace' && !c && i > 0) { e.preventDefault(); const n = [...vals]; n[i - 1] = ''; update(n); refs.current[i - 1]?.focus() }
            else if (e.key === 'ArrowLeft') { e.preventDefault(); refs.current[i - 1]?.focus() }
            else if (e.key === 'ArrowRight') { e.preventDefault(); refs.current[i + 1]?.focus() }
          }}
          onPaste={e => {
            const d = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, length); if (!d) return
            e.preventDefault(); const n = [...vals]; d.split('').forEach((ch, k) => { n[k] = ch }); update(n); refs.current[Math.min(d.length, length - 1)]?.focus()
          }}
          className={cn('h-12 w-10 min-w-0 rounded-[var(--r-md)] border bg-[var(--card)] text-center font-[family-name:var(--mono)] text-[22px] font-medium outline-none transition-colors focus:border-[var(--fg3)] focus:shadow-[0_0_0_3px_var(--muted)]',
            status === 'ok' ? 'border-[var(--ok)] text-[var(--ok)]' : status === 'bad' ? 'border-[var(--bad)]' : 'border-[var(--line)]')} />
      ))}
    </div>
  )
}
/** The option list shared by Select, Combobox, MultiSelect and the phone country picker. Keeps the active option scrolled into view. */
export function OptionList({ options, active, isSelected, onPick, onHover, id, multi, query, empty = 'No matches', label, className }:
  { options: Option[]; active: number; isSelected: (o: Option) => boolean; onPick: (i: number) => void; onHover: (i: number) => void; id: string; multi?: boolean
    /** bolds the matching part of each label */ query?: string; empty?: ReactNode; /** accessible name of the listbox */ label?: string; className?: string }) {
  const first = useRef(true)
  useEffect(() => {
    const el = document.getElementById(`${id}-${active}`)
    if (el) formsScrollIntoList(el, first.current)
    first.current = false
  }, [active, id, options.length])
  if (!options.length) return <div className={cn('p-3 text-center text-[13px] text-[var(--fg3)]', className)}>{empty}</div>
  return (
    <div role="listbox" id={id} aria-label={label} aria-multiselectable={multi || undefined} className={className}>
      {options.map((o, i) => {
        const sel = isSelected(o)
        return (
          // keyed by position: while a filter narrows the list the rows stay put and only their text changes, so nothing
          // slides up under the finger (no layout shift); rows added at the end still fade in
          <motion.div key={i} id={`${id}-${i}`} role="option" initial={{ opacity: 0, y: -3 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.18, delay: Math.min(i, 8) * 0.018 }} aria-selected={sel} aria-disabled={o.disabled} data-active={i === active}
            onPointerMove={() => onHover(i)} onPointerDown={e => e.preventDefault()} onClick={() => !o.disabled && onPick(i)}
            className={cn(menuItemClass, o.disabled && 'cursor-default opacity-50')}>
            <span className="flex min-w-0 items-center gap-2">
              {multi && <CheckboxBox checked={sel} size={16} pop={false} />}
              {o.leading && <span className="flex-none leading-none">{o.leading}</span>}
              {o.dot && <span className="h-2 w-2 flex-none rounded-full" style={{ background: o.dot }} />}
              {o.icon && <Icon name={o.icon} size={15} className="text-[var(--fg3)]" />}
              <span className="truncate">{formsHighlight(o.label, query)}{o.hint && <span className="ml-2 text-xs text-[var(--fg3)]">{o.hint}</span>}</span>
            </span>
            {!multi && sel && <Icon name="check" size={14} />}
          </motion.div>
        )
      })}
    </div>
  )
}

/** Open a list upward when there isn't room below the trigger. */
const formsPlacement = (el: HTMLElement | null, room = 270): Placement => {
  if (!el) return 'bottom-start'
  const r = el.getBoundingClientRect(), below = innerHeight - r.bottom
  return below < room && r.top > below ? 'top-start' : 'bottom-start'
}

/**
 * Custom select: arrows, Enter/Space, type-ahead that cycles through options starting with the typed letter
 * (works closed too), springs open, flips upward near the bottom of the viewport, checkmark on the current option.
 */
export function Select({ options, value, defaultValue, onChange, placeholder = 'Select…', className, 'aria-label': ariaLabel, id, icon, mono }:
  { options: Option[]; value?: string; defaultValue?: string; onChange?: (v: string) => void; placeholder?: string; className?: string; 'aria-label'?: string; id?: string
    /** leading icon in the trigger (TimePicker uses 'clock') */ icon?: IconName; mono?: boolean }) {
  const [v, set] = useControllable(value, defaultValue ?? '', onChange)
  const { open, setOpen, ref: wrap } = useDisclosure(), lid = useId()
  const [place, setPlace] = useState<Placement>('bottom-start')
  const sel = options.findIndex(o => o.value === v)
  const off = (i: number) => !!options[i]?.disabled
  const pick = (i: number) => { if (!options[i] || off(i)) return; set(options[i].value); setOpen(false) }
  const { active, setActive, onKeyDown } = useRoving(options.length, pick, { isDisabled: off })
  const show = (o: boolean) => { if (o) { setPlace(formsPlacement(wrap.current)); setActive(sel >= 0 ? sel : Math.max(0, options.findIndex(x => !x.disabled))) } setOpen(o) }
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
    <div ref={wrap} className={cn('relative', className)}>
      <button type="button" id={id} role="combobox" aria-label={ariaLabel} aria-expanded={open} aria-haspopup="listbox" aria-controls={lid} aria-activedescendant={open ? `${lid}-${active}` : undefined}
        onClick={() => show(!open)} onKeyDown={onKey}
        className={cn(inputClass, 'flex cursor-pointer items-center justify-between gap-2 text-left')}>
        <span className={cn('flex min-w-0 items-center gap-2', mono && 'ui-num')}>
          {icon && <Icon name={icon} size={15} className="text-[var(--fg3)]" />}
          {options[sel]?.leading && <span className="leading-none">{options[sel].leading}</span>}
          {options[sel]?.dot && <motion.span key={`d${v}`} initial={{ scale: 1.8 }} animate={{ scale: 1 }} transition={spring(0.5, 0.4)} className="h-2 w-2 flex-none rounded-full" style={{ background: options[sel].dot }} />}
          <motion.span key={v} initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} transition={spring(0.3, 0.3)} className={cn('truncate', sel < 0 && 'text-[var(--fg3)]')}>{options[sel]?.label ?? placeholder}</motion.span>
        </span>
        <motion.span animate={{ rotate: open ? 180 : 0 }} className="text-[var(--fg3)]"><Icon name="chevronDown" size={14} /></motion.span>
      </button>
      <FloatingPanel open={open} matchWidth placement={place} className={cn('max-h-64 overflow-auto', mono && 'ui-num')} role="presentation">
        <OptionList id={lid} options={options} active={active} isSelected={o => o.value === v} onPick={pick} onHover={setActive} />
      </FloatingPanel>
    </div>
  )
}

/** Options for a time picker: <Select options={timeOptions(30)} /> */
export const timeOptions = (stepMinutes = 30, from = 0, to = 24 * 60): Option[] =>
  Array.from({ length: Math.ceil((to - from) / stepMinutes) }, (_, i) => {
    const m = from + i * stepMinutes, v = `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
    return { value: v, label: v }
  })

/** Time picker: clock-icon trigger, 15-minute slots (configurable), opens scrolled to the chosen slot. A Select underneath, so the same keys work. */
export function TimePicker({ value, defaultValue = '09:00', onChange, step = 15, from = 7 * 60, to = 21 * 60, id, 'aria-label': ariaLabel, className }:
  { value?: string; defaultValue?: string; onChange?: (v: string) => void; step?: number; from?: number; to?: number; id?: string; 'aria-label'?: string; className?: string }) {
  const [opts] = useState(() => timeOptions(step, from, to))
  return <Select id={id} aria-label={ariaLabel} icon="clock" mono options={opts} value={value} defaultValue={defaultValue} onChange={onChange} className={className} />
}

/**
 * Type to filter (the match is bolded), arrows to move, Enter to choose. Options can carry a `leading` flag or emoji,
 * shown in the field once chosen. `empty` renders the no-match message for the current query.
 */
export function Combobox({ options, value, defaultValue, onChange, placeholder = 'Search…', id, empty = q => <>No matches for “{q}”</>, 'aria-label': ariaLabel, className }:
  { options: Option[]; value?: string; defaultValue?: string; onChange?: (v: string) => void; placeholder?: string; id?: string; empty?: (query: string) => ReactNode; 'aria-label'?: string; className?: string }) {
  const [v, set] = useControllable(value, defaultValue ?? '', onChange)
  const [q, setQ] = useState(options.find(o => o.value === v)?.label ?? '')
  const shownFor = useRef(v) // when the value changes from outside, show its label
  useEffect(() => { if (shownFor.current === v) return; shownFor.current = v; setQ(options.find(o => o.value === v)?.label ?? '') }, [v, options])
  const { open, setOpen, ref: wrap } = useDisclosure(), lid = useId()
  const input = useRef<HTMLInputElement>(null)
  const chosen = options.find(o => o.value === v && o.label === q)
  const filter = chosen ? '' : q // show the full list again when the field holds the chosen label
  const list = options.filter(o => o.label.toLowerCase().includes(filter.trim().toLowerCase()))
  const pick = (i: number) => { const o = list[i]; if (!o || o.disabled) return; shownFor.current = o.value; set(o.value); setQ(o.label); setOpen(false); play(input.current, { scale: [0.98, 1] }, spring(0.4, 0.3)) }
  const { active, setActive, onKeyDown } = useRoving(list.length, pick, { loop: false, homeEnd: false, isDisabled: i => !!list[i]?.disabled })
  return (
    <div ref={wrap} className={cn('relative', className)}>
      <span className="pointer-events-none absolute top-1/2 left-3 grid -translate-y-1/2 place-items-center text-[var(--fg3)]">
        {chosen?.leading ? <motion.span key={v} initial={{ scale: 0.5 }} animate={{ scale: 1 }} transition={spring(0.5, 0.35)} className="text-sm leading-none">{chosen.leading}</motion.span> : <Icon name="search" size={14} />}
      </span>
      <input ref={input} id={id} role="combobox" aria-label={ariaLabel} aria-expanded={open} aria-controls={lid} aria-autocomplete="list" aria-activedescendant={open && list.length ? `${lid}-${active}` : undefined}
        value={q} placeholder={placeholder} autoComplete="off" className={cn(inputClass, '!pl-8')}
        onChange={e => { setQ(e.target.value); setOpen(true); setActive(0) }} onFocus={() => setOpen(true)}
        onBlur={e => { if (!wrap.current?.contains(e.relatedTarget as Node)) setOpen(false) }}
        onKeyDown={e => {
          if (e.key === 'Escape') { if (open) { e.stopPropagation(); setOpen(false) } return }
          if (e.key === 'Tab') return setOpen(false)
          if (!open) setOpen(true)
          onKeyDown(e)
        }} />
      {/* never flips above the field: the list shrinks as you type, and above it would jump and cover the label */}
      <FloatingPanel open={open} matchWidth flip="scroll" className="max-h-[220px] overflow-auto" role="presentation">
        <OptionList id={lid} options={list} query={filter} active={active} isSelected={o => o.value === v} onPick={pick} onHover={setActive} empty={empty(q)} />
      </FloatingPanel>
    </div>
  )
}

/** Pick several: ticks draw in the list, chosen items become chips (with their colour dot) in the field. Backspace removes the last chip. */
export function MultiSelect({ options, value, defaultValue = [], onChange, placeholder = 'Select…', id, 'aria-label': ariaLabel, className }:
  { options: Option[]; value?: string[]; defaultValue?: string[]; onChange?: (v: string[]) => void; placeholder?: string; id?: string; 'aria-label'?: string; className?: string }) {
  const [v, set] = useControllable(value, defaultValue, onChange)
  const { open, setOpen, ref: wrap } = useDisclosure(), lid = useId()
  const [place, setPlace] = useState<Placement>('bottom-start')
  const off = (i: number) => !!options[i]?.disabled
  const toggle = (i: number) => { if (!options[i] || off(i)) return; const o = options[i].value; set(v.includes(o) ? v.filter(x => x !== o) : [...v, o]) }
  const { active, setActive, onKeyDown } = useRoving(options.length, toggle, { isDisabled: off })
  const show = (o: boolean) => { if (o) { setPlace(formsPlacement(wrap.current)); if (off(active)) setActive(Math.max(0, options.findIndex(x => !x.disabled))) } setOpen(o) }
  return (
    <div ref={wrap} className={cn('relative', className)}>
      <div id={id} role="combobox" tabIndex={0} aria-label={ariaLabel} aria-expanded={open} aria-controls={lid} aria-haspopup="listbox" aria-activedescendant={open ? `${lid}-${active}` : undefined}
        onClick={() => show(!open)} onKeyDown={e => {
          if (e.key === 'Escape') { if (open) { e.stopPropagation(); setOpen(false) } }
          else if (e.key === 'Tab') setOpen(false)
          else if (e.key === 'Backspace' && v.length) set(v.slice(0, -1))
          else if (!open && ['Enter', ' ', 'ArrowDown'].includes(e.key)) { e.preventDefault(); show(true) }
          else if (e.key === ' ') { e.preventDefault(); toggle(active) }
          else onKeyDown(e)
        }}
        className={cn(inputClass, 'relative flex !h-auto min-h-9 cursor-pointer flex-wrap items-center gap-1 py-1 !pr-8 focus-visible:border-[var(--fg3)]')}>
        {v.length === 0 && <span className="text-[var(--fg3)]">{placeholder}</span>}
        <AnimatePresence initial={false} mode="popLayout">
          {v.map(x => {
            const o = options.find(p => p.value === x)
            return (
              <motion.span key={x} layout initial={{ scale: 0.6, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.6, opacity: 0, transition: { duration: 0.12 } }} transition={spring(0.4, 0.35)}
                className="inline-flex items-center gap-1.5 rounded-[var(--r-md)] bg-[var(--muted)] py-0.5 pr-1 pl-2 text-xs">
                {o?.dot && <span className="h-2 w-2 flex-none rounded-full" style={{ background: o.dot }} />}
                {o?.label ?? x}
                <button type="button" tabIndex={-1} aria-label={`Remove ${o?.label ?? x}`} className="ui-target cursor-pointer rounded-[var(--r-sm)] border-0 bg-transparent px-0.5 leading-none hover:bg-[var(--line)] text-[var(--fg3)] hover:text-[var(--fg)] [@media(pointer:coarse)]:-my-2 [@media(pointer:coarse)]:-mr-1 [@media(pointer:coarse)]:min-h-8 [@media(pointer:coarse)]:min-w-8 [@media(pointer:coarse)]:text-base"
                  onClick={e => { e.stopPropagation(); set(v.filter(y => y !== x)) }}>×</button>
              </motion.span>
            )
          })}
        </AnimatePresence>
        <motion.span animate={{ rotate: open ? 180 : 0 }} className="absolute top-[11px] right-3 text-[var(--fg3)]"><Icon name="chevronDown" size={14} /></motion.span>
      </div>
      <FloatingPanel open={open} matchWidth placement={place} className="max-h-64 overflow-auto" role="presentation">
        <OptionList id={lid} multi options={options} active={active} isSelected={o => v.includes(o.value)} onPick={toggle} onHover={setActive} />
      </FloatingPanel>
    </div>
  )
}

/* Dates ─────────────────────────────────────────────────────────────────────── */

/** Format a date in the library locale ("8 Nov 2026"); same as core `fmtDate`. */
export const formatDate = (d?: Date | null, opts?: Intl.DateTimeFormatOptions) => fmtDate(d, opts)

/** A date range [start, end]; either side may be null while it is being picked. */
export type DateRange = [Date | null, Date | null]

/**
 * Month grid (day cells grow to 40×40 on touch). Always controlled, with its own prop names: a single date is `selected` +
 * `onSelect`, a range is `range` + `onRangeChange` (pass one pair); `month` is only the month shown first.
 * Keyboard: arrows move by day/week (crossing months), Home/End jump to the week's start/end, PageUp/PageDown change month
 * (with Shift, year), Enter picks. In range mode Shift+arrow or Shift+click extends the range from its anchor; you can also
 * click start then end, drag across days, or drag either end of an existing range. On touch, drag an end of the range, or
 * long-press a day and then drag to draw a new one, so a swipe over the grid still scrolls the page.
 * Months slide in the direction you move; the picked day pops.
 */
export function Calendar({ selected, onSelect, range, onRangeChange, month: initialMonth, today: todayProp, className, autoFocus }:
  { selected?: Date | null; onSelect?: (d: Date) => void; range?: DateRange; onRangeChange?: (r: DateRange) => void; month?: Date; className?: string
    /** the day marked as today; by default the client's date, read after mount so server and client render the same */ today?: Date
    /** focus the selected (or today's) day on mount, e.g. inside a popover */ autoFocus?: boolean }) {
  const [month, setMonth] = useState(() => addMonths(initialMonth ?? selected ?? range?.[0] ?? todayProp ?? new Date(), 0))
  const [dir, setDir] = useState(0)
  const [hover, setHover] = useState<Date | null>(null)
  const [focus, setFocus] = useState(() => startOfDay(selected ?? range?.[0] ?? initialMonth ?? todayProp ?? new Date()))
  const [clientToday, setClientToday] = useState<Date | null>(null)
  useEffect(() => { setClientToday(new Date()) }, [])
  const [kbd, setKbd] = useState(false)
  const wrap = useRef<HTMLDivElement>(null)
  const wantFocus = useRef(!!autoFocus)
  const anchor = useRef<Date | null>(null)
  const go = (n: number) => { setDir(n); setMonth(m => addMonths(m, n)) }
  const inMonth = (d: Date) => d.getMonth() === month.getMonth() && d.getFullYear() === month.getFullYear()
  const showMonthOf = (d: Date) => { const m = addMonths(d, 0); if (+m !== +month) { setDir(m > month ? 1 : -1); setMonth(m) } }
  const first = (month.getDay() + 6) % 7 // Monday first
  const days = Array.from({ length: 42 }, (_, i) => new Date(month.getFullYear(), month.getMonth(), i - first + 1))
  const [a, b] = range ?? [null, null]
  const probe = hover ?? (kbd ? focus : null)
  const end = b ?? (a && probe && probe > a ? probe : null) // preview the range while choosing its end
  const today = todayProp ?? clientToday
  const tabDay = inMonth(focus) ? focus : month

  // Move DOM focus to the roving day after keyboard navigation (also across month changes).
  useEffect(() => {
    if (!wantFocus.current) return
    wrap.current?.querySelector<HTMLElement>(`[data-grid="${+month}"] [data-day="${+tabDay}"]`)?.focus({ preventScroll: true })
  }, [+tabDay, +month]) // eslint-disable-line react-hooks/exhaustive-deps
  // Pop the selected day when it changes (switching to its month first if needed).
  const selT = selected ? +startOfDay(selected) : 0
  const popped = useRef(selT)
  useEffect(() => {
    if (!selT || selT === popped.current) return
    if (!inMonth(new Date(selT))) return showMonthOf(new Date(selT))
    popped.current = selT
    play(wrap.current?.querySelector(`[data-grid="${+month}"] [data-day="${selT}"]`), { scale: [0.8, 1] }, spring(0.5, 0.3))
  }, [selT, +month]) // eslint-disable-line react-hooks/exhaustive-deps

  const extend = (d: Date, from: Date) => {
    if (!onRangeChange) return
    let anc = anchor.current
    if (!anc || !(sameDay(anc, a) || sameDay(anc, b))) anc = a && b ? (sameDay(from, a) ? b : a) : a ?? from
    anchor.current = anc
    onRangeChange(d < anc ? [d, anc] : [anc, d])
  }
  const onKey = (e: RKeyboardEvent) => {
    const cur = tabDay, k = e.key, wd = (cur.getDay() + 6) % 7
    let next: Date | null = null
    if (k === 'ArrowLeft') next = addDays(cur, -1)
    else if (k === 'ArrowRight') next = addDays(cur, 1)
    else if (k === 'ArrowUp') next = addDays(cur, -7)
    else if (k === 'ArrowDown') next = addDays(cur, 7)
    else if (k === 'Home') next = addDays(cur, -wd)
    else if (k === 'End') next = addDays(cur, 6 - wd)
    else if (k === 'PageUp' || k === 'PageDown') {
      const t = addMonths(cur, (k === 'PageUp' ? -1 : 1) * (e.shiftKey ? 12 : 1))
      next = new Date(t.getFullYear(), t.getMonth(), Math.min(cur.getDate(), new Date(t.getFullYear(), t.getMonth() + 1, 0).getDate()))
    }
    if (!next) return
    e.preventDefault(); e.stopPropagation()
    wantFocus.current = true; setKbd(true); setHover(null)
    setFocus(next); showMonthOf(next)
    if (e.shiftKey && !k.startsWith('Page')) extend(next, cur)
  }

  // Range dragging: grab an end to move it, or press on a day and drag to draw a new range. A finger drags from an end
  // straight away, elsewhere only after a long-press, so a swipe that starts on the grid scrolls the page instead.
  const drag = useRef<{ end: 0 | 1; anchor?: Date; moved: boolean } | null>(null)
  const justDragged = useRef(false)
  const hold = useRef<{ t: ReturnType<typeof setTimeout>; x: number; y: number } | null>(null)
  const cancelHold = () => { if (hold.current) clearTimeout(hold.current.t); hold.current = null }
  useEffect(() => cancelHold, [])
  useEffect(() => { // once a drag has started, the finger moves the range, not the page
    const el = wrap.current; if (!el) return
    const on = (e: TouchEvent) => { if (drag.current) e.preventDefault() }
    el.addEventListener('touchmove', on, { passive: false })
    return () => el.removeEventListener('touchmove', on)
  }, [])
  const dayAt = (x: number, y: number) => {
    const el = document.elementFromPoint(x, y)?.closest<HTMLElement>('[data-day]')
    return el ? new Date(Number(el.dataset.day)) : null
  }
  const atRangeEnd = (d: Date) => !!a && !!b && (sameDay(d, a) || sameDay(d, b))
  const rangeDrag = usePointerDrag({
    onMove: ({ x, y }) => dragTo(x, y),
    onEnd: () => { if (drag.current?.moved) justDragged.current = true; drag.current = null },
  })
  const begin = (d: Date, e: { pointerId: number; clientX: number; clientY: number }, el: Element) => {
    drag.current = atRangeEnd(d) ? { end: sameDay(d, a) ? 0 : 1, moved: false } : { end: 1, anchor: d, moved: false }
    rangeDrag.start(e, el)
  }
  const onDown = (d: Date, e: React.PointerEvent) => {
    if (!onRangeChange || e.shiftKey || e.button !== 0) return
    if (!isTouch(e) || atRangeEnd(d)) return begin(d, e, e.currentTarget)
    cancelHold()
    const { pointerId, clientX, clientY } = e, el = e.currentTarget
    hold.current = { x: clientX, y: clientY, t: setTimeout(() => { hold.current = null; navigator.vibrate?.(10); begin(d, { pointerId, clientX, clientY }, el) }, 420) }
  }
  const onMove = (e: React.PointerEvent) => {
    if (kbd) setKbd(false)
    const h = hold.current
    if (h && Math.hypot(e.clientX - h.x, e.clientY - h.y) > 8) cancelHold()
  }
  const dragTo = (x: number, y: number) => {
    const g = drag.current, d = g && dayAt(x, y)
    if (!g || !d || !onRangeChange) return
    if (g.anchor) {
      if (!g.moved && sameDay(d, g.anchor)) return
      g.moved = true; onRangeChange(d < g.anchor ? [d, g.anchor] : [g.anchor, d]); return
    }
    g.moved = true
    const next: DateRange = g.end === 0 ? [d, b] : [a, d]
    if (next[0] && next[1] && next[0] > next[1]) { g.end = g.end === 0 ? 1 : 0; onRangeChange([next[1], next[0]]) } // dragged past the other end
    else onRangeChange(next)
  }
  const onClick = (d: Date, e: React.MouseEvent) => {
    if (justDragged.current) { justDragged.current = false; return } // the click that ends a drag
    const from = tabDay
    setFocus(d); if (!inMonth(d)) showMonthOf(d)
    if (!onRangeChange) return onSelect?.(d)
    if (e.shiftKey && a) return extend(d, from)
    anchor.current = null
    onRangeChange(!a || b || d < a ? [d, null] : [a, d])
  }

  return (
    <div ref={wrap} className={cn('w-[252px] max-w-full select-none [@media(pointer:coarse)]:w-[280px]', className)}
      onBlur={e => { if (!wrap.current?.contains(e.relatedTarget as Node)) { wantFocus.current = false; setKbd(false) } }}>
      <div className="mb-2 flex items-center justify-between">
        <IconButton icon="chevronLeft" label="Previous month" onClick={() => go(-1)} className="[@media(pointer:coarse)]:!h-9 [@media(pointer:coarse)]:!w-9" />
        <span className="text-[13px] font-semibold" aria-live="polite">{fmtDate(month, { month: 'long', year: 'numeric' })}</span>
        <IconButton icon="chevronRight" label="Next month" onClick={() => go(1)} className="[@media(pointer:coarse)]:!h-9 [@media(pointer:coarse)]:!w-9" />
      </div>
      <div className="grid grid-cols-7 text-center text-[11px] text-[var(--fg3)]" aria-hidden>{['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'].map(d => <span key={d} className="py-1">{d}</span>)}</div>
      <div className="relative overflow-hidden">
        <AnimatePresence initial={false} mode="popLayout" custom={dir}>
          <motion.div key={month.toISOString()} data-grid={+month} custom={dir} className={cn('grid grid-cols-7 gap-y-0.5', onRangeChange && 'touch-pan-y [-webkit-touch-callout:none]')}
            variants={{ in: (d: number) => ({ x: d * 40, opacity: 0 }), c: { x: 0, opacity: 1 }, out: (d: number) => ({ x: d * -40, opacity: 0 }) }}
            initial="in" animate="c" exit="out" transition={spring(0.1, 0.3)} onKeyDown={onKey}
            onPointerLeave={() => setHover(null)} onPointerMove={onMove} onPointerUp={cancelHold} onPointerCancel={cancelHold}
            onContextMenu={onRangeChange ? e => e.preventDefault() : undefined}>
            {days.map(d => {
              const outside = d.getMonth() !== month.getMonth()
              const isStart = sameDay(d, a), isEnd = sameDay(d, end), isSel = sameDay(d, selected) || isStart || isEnd
              const joined = !!a && !!end && !sameDay(a, end)
              const inRange = a && end && d > a && d < end
              return (
                <button type="button" key={d.toISOString()} data-day={d.getTime()} tabIndex={sameDay(d, tabDay) && !outside ? 0 : -1}
                  onClick={e => onClick(d, e)} onPointerDown={e => onDown(d, e)} onPointerEnter={e => e.pointerType === 'mouse' && setHover(d)}
                  aria-pressed={isSel} aria-current={sameDay(d, today) ? 'date' : undefined} aria-label={fmtDate(d, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
                  className={cn('h-8 cursor-pointer border-0 text-[13px] transition-colors focus-visible:relative focus-visible:z-10 [@media(pointer:coarse)]:h-10 [@media(pointer:coarse)]:text-sm',
                    isSel ? cn('bg-[var(--primary)] font-semibold text-[var(--on-primary)]', !joined ? 'rounded-[var(--r-md)]' : isStart ? 'rounded-l-[var(--r-md)]' : 'rounded-r-[var(--r-md)]', joined && onRangeChange && b && 'cursor-ew-resize', onRangeChange && atRangeEnd(d) && 'touch-none')
                      : inRange ? 'bg-[var(--muted)]' : 'rounded-[var(--r-md)] bg-transparent hover:bg-[var(--muted)]',
                    // outside-month days: secondary text (≥4.5:1 in every theme), not faded with opacity
                    outside && !isSel && 'text-[var(--fg3)]', sameDay(d, today) && !isSel && 'font-semibold text-[var(--accent)]')}>
                  {d.getDate()}
                </button>
              )
            })}
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  )
}

const pickerTrigger = cn(inputClass, 'flex cursor-pointer items-center gap-2 text-left')

/** Field-styled trigger for a Popover: wires aria-expanded and gives Escape somewhere to return focus. */
function FormsTrigger({ id, icon, children }: { id?: string; icon: IconName; children: ReactNode }) {
  const { open, setOpen, triggerRef, id: pid } = usePopover()
  return (
    <button type="button" ref={triggerRef} id={id} className={pickerTrigger} aria-haspopup="dialog" aria-expanded={open} aria-controls={pid} onClick={() => setOpen(!open)}>
      <Icon name={icon} size={15} className="text-[var(--fg3)]" />{children}
    </button>
  )
}

/** Date field: the calendar pops from the field (keyboard ready), the picked day pops, Today and Clear sit under the grid. Shows the weekday. */
export function DatePicker({ value, defaultValue = null, onChange, placeholder = 'Pick a date', id, className }:
  { value?: Date | null; defaultValue?: Date | null; onChange?: (d: Date | null) => void; placeholder?: string; id?: string; className?: string }) {
  const [d, set] = useControllable<Date | null>(value, defaultValue, onChange)
  const [open, setOpen] = useState(false)
  const pick = (x: Date | null, close = true) => { set(x); if (close) setTimeout(() => setOpen(false), 180) }
  return (
    <Popover open={open} onOpenChange={setOpen} className={cn('!block', className)}>
      <FormsTrigger id={id} icon="calendar">
        <motion.span key={d ? +d : 0} initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} transition={spring(0.3, 0.3)} className={cn('truncate', !d && 'text-[var(--fg3)]')}>
          {d ? formatDate(d, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }) : placeholder}
        </motion.span>
      </FormsTrigger>
      <PopoverContent className="p-3">
        <Calendar selected={d} onSelect={x => pick(x)} autoFocus />
        <div className="mt-2 flex justify-between border-t border-[var(--line)] pt-2">
          <Button size="sm" variant="ghost" onClick={() => pick(startOfDay(new Date()))}>Today</Button>
          <Button size="sm" variant="ghost" disabled={!d} onClick={() => pick(null, false)}>Clear</Button>
        </div>
      </PopoverContent>
    </Popover>
  )
}

/** Quick ranges shown beside the range calendar. Pass your own to DateRangePicker. */
export const RANGE_PRESETS: [string, () => DateRange][] = [
  ['Last 7 days', () => [addDays(new Date(), -6), startOfDay(new Date())]],
  ['Last 14 days', () => [addDays(new Date(), -13), startOfDay(new Date())]],
  ['Last 30 days', () => [addDays(new Date(), -29), startOfDay(new Date())]],
  ['This month', () => { const n = new Date(); return [new Date(n.getFullYear(), n.getMonth(), 1), new Date(n.getFullYear(), n.getMonth() + 1, 0)] }],
]

/** Range picker with presets (the matching preset stays highlighted). Stays open so you can drag either end to adjust; Done closes it. */
export function DateRangePicker({ value, defaultValue = [null, null], onChange, placeholder = 'Pick dates', presets = RANGE_PRESETS, id, className }:
  { value?: DateRange; defaultValue?: DateRange; onChange?: (r: DateRange) => void; placeholder?: string; presets?: [string, () => DateRange][]; id?: string; className?: string }) {
  const [r, set] = useControllable<DateRange>(value, defaultValue, onChange)
  const [open, setOpen] = useState(false)
  const [month, setMonth] = useState(0) // bump to re-mount the calendar on the preset's month
  const days = r[0] && r[1] ? Math.round((+r[1] - +r[0]) / 864e5) + 1 : 0
  const short = (d: Date) => formatDate(d, { day: 'numeric', month: 'short' })
  const current = presets.find(([, get]) => { const [x, y] = get(); return sameDay(x, r[0]) && sameDay(y, r[1]) })?.[0]
  return (
    <Popover open={open} onOpenChange={setOpen} className={cn('!block', className)}>
      <FormsTrigger id={id} icon="calendar">
        <span className={cn('flex-1 truncate', !r[0] && 'text-[var(--fg3)]')}>{r[0] ? `${short(r[0])} to ${r[1] ? `${short(r[1])} ${r[1].getFullYear()}` : '…'}` : placeholder}</span>
        {days > 0 && <Badge>{days} days</Badge>}
      </FormsTrigger>
      <PopoverContent className="p-3">
        <div className="flex flex-col gap-3 sm:flex-row">
          <div className="-mx-3 flex gap-0.5 overflow-x-auto border-[var(--line)] px-3 pb-2 [scrollbar-width:none] max-sm:w-0 max-sm:min-w-[calc(100%+24px)] sm:mx-0 sm:w-[112px] sm:flex-col sm:overflow-visible sm:border-r sm:px-0 sm:pr-2 sm:pb-0">
            {presets.map(([label, get]) => (
              <button type="button" key={label} aria-pressed={label === current} data-active={label === current} onClick={() => { set(get()); setMonth(m => m + 1) }}
                className={cn(menuItemClass, '!w-auto flex-none text-xs whitespace-nowrap max-sm:rounded-full max-sm:border max-sm:!border-[var(--line)] sm:!w-full', label === current && 'font-semibold')}>
                {label}{label === current && <Icon name="check" size={12} />}
              </button>
            ))}
          </div>
          <Calendar key={month} range={r} onRangeChange={set} />
        </div>
        <div className="mt-3 flex items-center gap-2 border-t border-[var(--line)] pt-3">
          <span className="min-w-0 flex-1 text-xs text-[var(--fg3)]">{!r[0] ? 'Tap or drag to choose dates' : !r[1] ? 'Choose an end date' : `${days} days · drag either end to adjust`}</span>
          <Button size="sm" variant="ghost" disabled={!r[0]} onClick={() => set([null, null])}>Clear</Button>
          <Button size="sm" variant="primary" onClick={() => setOpen(false)}>Done</Button>
        </div>
      </PopoverContent>
    </Popover>
  )
}

/* Files ─────────────────────────────────────────────────────────────────────── */

type FormsFile = { id: number; name: string; size: number; file?: File }
let formsFileSeq = 0
type FormsUploader = (file: File, onProgress: (pct: number) => void) => Promise<void>

function FormsFileRow({ f, upload, onRemove }: { f: FormsFile; upload?: FormsUploader; onRemove: () => void }) {
  const [pct, setPct] = useState(0)
  const [failed, setFailed] = useState(false)
  const uploader = useRef(upload) // latest uploader without restarting: an inline `upload` prop changes identity every render
  useLayoutEffect(() => { uploader.current = upload })
  useEffect(() => {
    let live = true
    const run = uploader.current
    if (run && f.file) {
      run(f.file, p => { if (live) setPct(Math.min(99, p)) }).then(() => { if (live) setPct(100) }, () => { if (live) setFailed(true) })
      return () => { live = false }
    }
    let p = 0 // no uploader given: simulate one so the row shows real progress
    const t = setInterval(() => { p = Math.min(100, p + 3 + Math.random() * 9); setPct(p); if (p >= 100) clearInterval(t) }, 70)
    return () => { live = false; clearInterval(t) }
  }, [f.id]) // eslint-disable-line react-hooks/exhaustive-deps
  const done = pct >= 100, size = f.size ? fmt.bytes(f.size) : ''
  return (
    <motion.div layout="position" initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }}
      exit={{ height: 0, opacity: 0, x: 20, transition: { opacity: { duration: 0.15 }, x: { duration: 0.15 }, height: { duration: 0.18, delay: 0.12 } } }}
      transition={spring(0.2, 0.35)} className="overflow-hidden">
      <div className="flex items-center gap-2.5 border-b border-[var(--line)] py-2 text-[13px]">
        <span className="grid h-8 w-8 flex-none place-items-center rounded-[var(--r-md)] bg-[var(--muted)] font-[family-name:var(--mono)] text-[11px] font-semibold text-[var(--fg2)] uppercase">{(f.name.split('.').pop() || 'file').slice(0, 4)}</span>
        <span className="min-w-0 flex-1">
          <span className="block truncate font-medium">{f.name}</span>
          <span className={cn('block text-xs transition-colors', done ? 'text-[var(--ok)]' : failed ? 'text-[var(--bad)]' : 'text-[var(--fg3)]')} aria-live="polite">{size && `${size} · `}{done ? 'Uploaded' : failed ? 'Upload failed' : `Uploading ${Math.round(pct)}%`}</span>
          <Progress value={pct} tone={done ? 'ok' : failed ? 'bad' : 'primary'} label={`Upload of ${f.name}`} className="mt-1 !h-1" />
        </span>
        <IconButton icon="x" label={`Remove ${f.name}`} onClick={onRemove} />
      </div>
    </motion.div>
  )
}

/**
 * True when `file` matches an `accept` string like the file input's: extensions ('.pdf'), MIME types ('application/pdf')
 * and wildcards ('image/*'), comma-separated. An empty `accept` accepts everything. This checks the name and the type
 * the browser reports, both of which the user controls: it is a convenience, not validation.
 */
export function fileAccepts(file: { name: string; type: string }, accept?: string) {
  const rules = (accept ?? '').split(',').map(r => r.trim().toLowerCase()).filter(Boolean)
  if (!rules.length) return true
  const name = file.name.toLowerCase(), type = (file.type || '').toLowerCase()
  return rules.some(r => r.startsWith('.') ? name.endsWith(r) : r.endsWith('/*') ? type.startsWith(r.slice(0, -1)) : type === r)
}

/**
 * Drop zone + file list. Each file shows a progress bar and "Uploading → Uploaded"; removed rows slide out and collapse.
 * Pass `upload(file, onProgress)` to upload for real (otherwise progress is simulated) and `defaultFiles` to seed the list.
 * Dropped and picked files are filtered by `accept` (and to one file without `multiple`); skipped ones go to `onReject`
 * and a note under the zone. `accept` only checks the name and reported type: validate type, size and content on the server.
 */
export function FileUpload({ onFiles, onReject, accept, multiple = true, hint = 'Any type, up to 20 MB', defaultFiles = [], upload, className }:
  { onFiles?: (f: File[]) => void; /** files dropped or picked that don't match `accept` */ onReject?: (f: File[]) => void; accept?: string; multiple?: boolean; hint?: string; defaultFiles?: { name: string; size: number }[]
    /** upload one file for real, reporting 0–100 progress; a rejected promise marks the row failed */ upload?: FormsUploader; className?: string }) {
  const [files, setFiles] = useState<FormsFile[]>(() => defaultFiles.map(f => ({ ...f, id: ++formsFileSeq })))
  const [over, setOver] = useState(false)
  const [skipped, setSkipped] = useState<string | null>(null)
  const input = useRef<HTMLInputElement>(null), zone = useRef<HTMLButtonElement>(null)
  const add = (list: FileList | null) => {
    if (!list?.length) return
    const all = [...list], ok = all.filter(f => fileAccepts(f, accept)), bad = all.filter(f => !ok.includes(f))
    const f = multiple ? ok : ok.slice(0, 1)
    setSkipped(bad.length ? `${bad.length === 1 ? `“${bad[0].name}” isn’t` : `${bad.length} files aren’t`} an accepted type${accept ? ` (${accept})` : ''}` : null)
    if (bad.length) onReject?.(bad)
    if (!f.length) return
    setFiles(x => [...f.map(file => ({ id: ++formsFileSeq, name: file.name, size: file.size, file })).reverse(), ...x]); onFiles?.(f)
  }
  return (
    <div className={cn('flex flex-col', className)}>
      <motion.button ref={zone} type="button" animate={{ scale: over ? 1.02 : 1 }} transition={spring(0.3, 0.3)} onClick={() => input.current?.click()}
        onDragOver={e => { e.preventDefault(); setOver(true) }} onDragLeave={() => setOver(false)}
        onDrop={e => { e.preventDefault(); setOver(false); add(e.dataTransfer.files); play(zone.current, { scale: [0.98, 1] }, spring(0.4, 0.3)) }}
        className={cn('mb-1 flex cursor-pointer flex-col items-center gap-1 rounded-[var(--r-md)] border-[1.5px] border-dashed p-4 text-center text-[13px] text-[var(--fg2)] transition-colors',
          over ? 'border-[var(--accent)] bg-[var(--accent-soft)]' : 'border-[var(--line2)] bg-transparent hover:bg-[var(--muted)]')}>
        <Icon name="upload" size={20} className="text-[var(--fg3)]" />
        <span className="[@media(hover:none)]:hidden"><b className="font-medium text-[var(--fg)]">Drop files</b> or click to browse</span>
        <span className="hidden [@media(hover:none)]:inline"><b className="font-medium text-[var(--fg)]">Tap to choose files</b></span>
        <span className="text-xs text-[var(--fg3)]">{hint}</span>
      </motion.button>
      <input ref={input} type="file" hidden accept={accept} multiple={multiple} onChange={e => { add(e.target.files); e.target.value = '' }} />
      {skipped && <p role="status" className="m-0 mb-1 text-xs text-[var(--bad)]">{skipped}</p>}
      <AnimatePresence initial={false}>
        {files.map(f => <FormsFileRow key={f.id} f={f} upload={upload} onRemove={() => setFiles(x => x.filter(y => y.id !== f.id))} />)}
      </AnimatePresence>
    </div>
  )
}

/* Colour ────────────────────────────────────────────────────────────────────── */

const formsHexOk = (s: string) => /^#[0-9a-f]{6}$/i.test(s)

/** Swatches, a hue slider and a hex field. The preview pops when a swatch or hex changes it (not while dragging hue). */
export function ColorPicker({ value, defaultValue = '#2563EB', onChange, swatches = ['#18181B', '#2563EB', '#0891B2', '#16A34A', '#CA8A04', '#F97316', '#DC2626', '#DB2777'], className }:
  { value?: string; defaultValue?: string; onChange?: (v: string) => void; swatches?: string[]; className?: string }) {
  const [c, set] = useControllable(value?.toUpperCase(), defaultValue.toUpperCase(), onChange)
  const [text, setText] = useState(c), [pops, setPops] = useState(0)
  const [hue, setHue] = useState(() => hex2hue(c))
  const group = useId()
  const own = useRef(c) // a new `value` from outside (not our own echo) refreshes the hex field and hue
  useEffect(() => { if (c === own.current) return; own.current = c; setText(c); if (formsHexOk(c)) setHue(hex2hue(c)) }, [c])
  const apply = (hex: string, src: 'swatch' | 'hex' | 'hue') => {
    const h = hex.toUpperCase(); own.current = h; set(h)
    if (src !== 'hex') setText(h)
    if (src !== 'hue') { setHue(hex2hue(h)); setPops(n => n + 1) }
  }
  return (
    <div className={cn('flex flex-col gap-3', className)}>
      <div className="flex items-center gap-3">
        <motion.span key={pops} initial={pops ? { scale: 0.85, rotate: -8 } : false} animate={{ scale: 1, rotate: 0 }} transition={spring(0.5, 0.4)}
          className="h-10 w-10 flex-none rounded-[var(--r-lg)] shadow-[inset_0_0_0_1px_rgba(0,0,0,.08)]" style={{ background: c }} aria-hidden />
        <Input value={text} onChange={e => { setText(e.target.value); const v = e.target.value.trim(); if (formsHexOk(v)) apply(v, 'hex') }}
          invalid={!formsHexOk(text.trim())} spellCheck={false} className="!h-8 font-[family-name:var(--mono)]" aria-label="Hex colour" />
      </div>
      <input type="range" min={0} max={360} value={hue} aria-label="Hue" onChange={e => { const h = +e.target.value; setHue(h); apply(hsl2hex(h, 83, 53), 'hue') }}
        className="h-2.5 w-full cursor-pointer appearance-none rounded-full bg-clip-content [@media(pointer:coarse)]:box-content [@media(pointer:coarse)]:-my-[11px] [@media(pointer:coarse)]:py-[11px] [@media(pointer:coarse)]:[&::-webkit-slider-thumb]:h-6 [@media(pointer:coarse)]:[&::-webkit-slider-thumb]:w-6 [@media(pointer:coarse)]:[&::-moz-range-thumb]:h-6 [@media(pointer:coarse)]:[&::-moz-range-thumb]:w-6 [&::-moz-range-thumb]:h-4 [&::-moz-range-thumb]:w-4 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-2 [&::-moz-range-thumb]:border-[rgba(0,0,0,.25)] [&::-moz-range-thumb]:bg-white [&::-webkit-slider-thumb]:h-[18px] [&::-webkit-slider-thumb]:w-[18px] [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-[rgba(0,0,0,.25)] [&::-webkit-slider-thumb]:bg-white"
        style={{ backgroundImage: 'linear-gradient(90deg,#f00,#ff0,#0f0,#0ff,#00f,#f0f,#f00)' }} />
      <div className="flex flex-wrap gap-2 [@media(pointer:coarse)]:grid [@media(pointer:coarse)]:grid-cols-[repeat(auto-fill,minmax(32px,1fr))] [@media(pointer:coarse)]:justify-items-center [@media(pointer:coarse)]:gap-1.5">
        {swatches.map(s => {
          const on = s.toUpperCase() === c
          return (
            <button type="button" key={s} aria-label={s} aria-pressed={on} onClick={() => apply(s, 'swatch')} className="relative h-7 w-7 cursor-pointer rounded-full border-0 p-0 [@media(pointer:coarse)]:h-8 [@media(pointer:coarse)]:w-8" style={{ background: s }}>
              {on && <motion.span layoutId={group} className="absolute -inset-1 rounded-full border-2" style={{ borderColor: s }} transition={spring(0.3, 0.35)} />}
            </button>
          )
        })}
      </div>
    </div>
  )
}

/* Range ─────────────────────────────────────────────────────────────────────── */

/**
 * Two-thumb slider for a range. Drag either thumb (mouse or touch), click the track to move the nearest thumb there,
 * or use arrows / PageUp / PageDown / Home / End. `minGap` keeps the thumbs apart. The readout rolls (pass `format` to change it).
 */
export function RangeSlider({ value, defaultValue = [20, 80], onChange, min = 0, max = 100, step = 1, minGap = 0, label, format = v => <AnimatedNumber value={v} />, valueText = String, className }:
  { value?: [number, number]; defaultValue?: [number, number]; onChange?: (v: [number, number]) => void; min?: number; max?: number; step?: number; minGap?: number
    label?: string; format?: (v: number) => ReactNode; valueText?: (v: number) => string; className?: string }) {
  const [v, set] = useControllable(value, defaultValue, onChange)
  const track = useRef<HTMLDivElement>(null), thumbs = useRef<(HTMLButtonElement | null)[]>([])
  const live = useRef(v)
  useLayoutEffect(() => { live.current = v }, [v])
  const [dragging, setDragging] = useState<0 | 1 | null>(null)
  const pct = (n: number) => clamp(((n - min) / (max - min || 1)) * 100, 0, 100)
  const snap = (n: number) => clamp(Math.round((n - min) / step) * step + min, min, max)
  const move = (k: 0 | 1, n: number) => {
    const cur = live.current, x = snap(n), next: [number, number] = [cur[0], cur[1]]
    next[k] = k === 0 ? Math.max(min, Math.min(x, cur[1] - minGap)) : Math.min(max, Math.max(x, cur[0] + minGap))
    if (next[k] !== cur[k]) { live.current = next; set(next) }
  }
  const valAt = (x: number) => { const r = track.current?.getBoundingClientRect(); return r ? min + ((x - r.left) / (r.width || 1)) * (max - min) : min }
  const thumb = useRef<0 | 1>(0)
  const thumbDrag = usePointerDrag({ onMove: p => move(thumb.current, valAt(p.x)), onEnd: () => setDragging(null), cursor: 'grabbing' })
  const startDrag = (k: 0 | 1, e: React.PointerEvent) => {
    if (e.button !== 0) return
    e.preventDefault(); thumbs.current[k]?.focus(); thumb.current = k; setDragging(k)
    thumbDrag.start(e, thumbs.current[k])
  }
  const onTrackDown = (e: React.PointerEvent) => {
    const n = valAt(e.clientX), d0 = Math.abs(n - v[0]), d1 = Math.abs(n - v[1])
    const k: 0 | 1 = d0 < d1 ? 0 : d1 < d0 ? 1 : n < v[0] ? 0 : 1
    move(k, n); startDrag(k, e)
  }
  const thumbLabel = (k: 0 | 1) => `${k ? 'Maximum' : 'Minimum'}${label ? ' ' + label.toLowerCase() : ''}`
  return (
    <div className={className}>
      {label && <div className="mb-2 flex justify-between text-[13px]"><span className="text-[var(--fg2)]">{label}</span><span className="font-medium">{format(v[0])} to {format(v[1])}</span></div>}
      <div ref={track} className="relative h-5 cursor-pointer touch-none [@media(pointer:coarse)]:-my-1.5 [@media(pointer:coarse)]:h-8" onPointerDown={onTrackDown}>
        <div className="absolute inset-x-0 top-2 h-1 rounded-full bg-[var(--muted)] [@media(pointer:coarse)]:top-3.5" />
        <div className="absolute top-2 h-1 rounded-full bg-[var(--primary)] [@media(pointer:coarse)]:top-3.5" style={{ left: `${pct(v[0])}%`, right: `${100 - pct(v[1])}%` }} />
        {([0, 1] as const).map(k => (
          <motion.button type="button" key={k} ref={el => { thumbs.current[k] = el }} role="slider" aria-label={thumbLabel(k)} aria-valuemin={min} aria-valuemax={max} aria-valuenow={v[k]} aria-valuetext={valueText(v[k])}
            animate={{ scale: dragging === k ? 1.15 : 1 }} transition={spring(0.4, 0.3)}
            onPointerDown={e => { e.stopPropagation(); startDrag(k, e) }}
            onKeyDown={e => {
              const big = Math.max(step, (max - min) / 10)
              const t = ({ ArrowRight: v[k] + step, ArrowUp: v[k] + step, ArrowLeft: v[k] - step, ArrowDown: v[k] - step, PageUp: v[k] + big, PageDown: v[k] - big, Home: min, End: max } as Record<string, number>)[e.key]
              if (t !== undefined) { e.preventDefault(); move(k, t) }
            }}
            className={cn('absolute top-0 h-5 w-5 -translate-x-1/2 touch-none rounded-full border-0 bg-transparent p-0 [@media(pointer:coarse)]:h-8 [@media(pointer:coarse)]:w-8', dragging === k ? 'z-10 cursor-grabbing' : 'cursor-grab')} style={{ left: `${pct(v[k])}%` }}>
            <span aria-hidden className="absolute inset-0 rounded-full border-2 border-[var(--primary)] bg-[var(--card)] shadow-[0_1px_3px_rgba(0,0,0,.2)] [@media(pointer:coarse)]:inset-1" />
          </motion.button>
        ))}
      </div>
    </div>
  )
}
/* Phone and currency ────────────────────────────────────────────────────────── */

/** A country for PhoneInput: digit groups like [2, 3, 2, 2] become the mask "XX XXX XX XX" unless `mask` is given. */
export type PhoneCountry = { flag: string; dial: string; name: string; groups: number[]; mask?: string }
export const PHONE_COUNTRIES: PhoneCountry[] = [
  { flag: '🇨🇭', dial: '+41', name: 'Switzerland', groups: [2, 3, 2, 2] }, { flag: '🇬🇧', dial: '+44', name: 'United Kingdom', groups: [4, 6] },
  { flag: '🇩🇪', dial: '+49', name: 'Germany', groups: [3, 8] }, { flag: '🇺🇸', dial: '+1', name: 'United States', groups: [3, 3, 4], mask: '(XXX) XXX-XXXX' },
  { flag: '🇦🇺', dial: '+61', name: 'Australia', groups: [3, 3, 3] }, { flag: '🇫🇷', dial: '+33', name: 'France', groups: [1, 2, 2, 2, 2] },
  { flag: '🇮🇹', dial: '+39', name: 'Italy', groups: [3, 3, 4] }, { flag: '🇪🇸', dial: '+34', name: 'Spain', groups: [3, 3, 3] },
  { flag: '🇳🇱', dial: '+31', name: 'Netherlands', groups: [1, 8] }, { flag: '🇮🇪', dial: '+353', name: 'Ireland', groups: [2, 3, 4] },
  { flag: '🇳🇿', dial: '+64', name: 'New Zealand', groups: [2, 3, 4] }, { flag: '🇸🇬', dial: '+65', name: 'Singapore', groups: [4, 4] },
  { flag: '🇯🇵', dial: '+81', name: 'Japan', groups: [2, 4, 4] },
]
const phoneMask = (c: PhoneCountry) => c.mask ?? c.groups.map(g => 'X'.repeat(g)).join(' ')
const phoneFormat = (mask: string, digits: string) => {
  let out = '', i = 0, k = 0
  for (; k < mask.length && i < digits.length; k++) out += mask[k] === 'X' ? digits[i++] : mask[k]
  return { out, rest: mask.slice(k).replace(/X/g, '0') }
}
/** Caret index in `s` just after the `n`th character matching `re` (0 → before the first). */
const formsCaretAfter = (s: string, n: number, re: RegExp) => {
  if (n <= 0) { const k = [...s].findIndex(ch => re.test(ch)); return k < 0 ? s.length : k }
  for (let i = 0, seen = 0; i < s.length; i++) if (re.test(s[i]) && ++seen === n) return i + 1
  return s.length
}

/** The longest dial code `digits` (without +) starts with. */
const phoneMatch = (countries: PhoneCountry[], digits: string) => countries.filter(c => digits.startsWith(c.dial.slice(1))).sort((x, y) => y.dial.length - x.dial.length)[0]
const phoneMax = (c: PhoneCountry) => (phoneMask(c).match(/X/g) || []).length

/**
 * Phone number with a country picker (flags and dial codes). Digits are formatted with the country's mask as you type,
 * and the digits still to come show as a grey placeholder. Typing `+44…` or `0044…` switches the country.
 * Controlled with `value` (E.164, e.g. "+41791234567": a new value picks the country and digits) or uncontrolled with
 * `defaultCountry` + `defaultValue` (national digits).
 */
export function PhoneInput({ countries = PHONE_COUNTRIES, value, defaultCountry = '+41', defaultValue = '', onChange, id, invalid, 'aria-label': ariaLabel = 'Phone number', className }:
  { countries?: PhoneCountry[]; value?: string; defaultCountry?: string; defaultValue?: string; id?: string; invalid?: boolean; 'aria-label'?: string; className?: string
    onChange?: (v: { country: PhoneCountry; national: string; e164: string }) => void }) {
  const [country, setCountry] = useState(() => (value?.startsWith('+') && phoneMatch(countries, value.slice(1).replace(/\D/g, ''))) || countries.find(c => c.dial === defaultCountry) || countries[0])
  const [digits, setDigits] = useState(() => value?.startsWith('+') ? value.replace(/\D/g, '').slice(country.dial.length - 1) : defaultValue.replace(/\D/g, ''))
  const [plus, setPlus] = useState<string | null>(null) // "+4" while a dial code is still being typed
  const [swaps, setSwaps] = useState(0)
  const input = useRef<HTMLInputElement>(null), caret = useRef<number | null>(null)
  const { open, setOpen, ref: wrap } = useDisclosure(), lid = useId()
  const mask = phoneMask(country), maxDigits = (mask.match(/X/g) || []).length
  const { out, rest } = phoneFormat(mask, digits)
  const shown = plus ?? out
  const options: Option[] = countries.map(c => ({ value: c.dial, label: c.name, leading: c.flag, hint: c.dial }))
  const choose = (c: PhoneCountry) => {
    if (c !== country) setSwaps(n => n + 1)
    setCountry(c); setDigits(d => d.slice(0, (phoneMask(c).match(/X/g) || []).length))
  }
  const pickIndex = (i: number) => { choose(countries[i]); setPlus(null); setOpen(false); input.current?.focus() }
  const { active, setActive, onKeyDown } = useRoving(countries.length, pickIndex)
  const first = useRef(true)
  useEffect(() => {
    if (first.current) { first.current = false; return }
    onChange?.({ country, national: out, e164: country.dial + digits })
  }, [country, digits]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { // controlled: follow a new value from outside
    if (value === undefined || value === country.dial + digits) return
    const ds = value.replace(/\D/g, ''), hit = value.trim().startsWith('+') ? phoneMatch(countries, ds) : undefined
    if (hit) { setCountry(hit); setDigits(ds.slice(hit.dial.length - 1, hit.dial.length - 1 + phoneMax(hit))) } else setDigits(ds.slice(0, maxDigits))
    setPlus(null)
  }, [value]) // eslint-disable-line react-hooks/exhaustive-deps
  useLayoutEffect(() => {
    const el = input.current
    if (caret.current === null || !el || document.activeElement !== el) return
    const at = formsCaretAfter(el.value, caret.current, /\d/); caret.current = null
    el.setSelectionRange(at, at)
  })
  const onInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value, at = e.target.selectionStart ?? raw.length
    let t = raw.trimStart()
    if (t.startsWith('00')) t = '+' + t.slice(2)
    if (t.startsWith('+')) {
      const ds = t.slice(1).replace(/\D/g, '')
      const hit = phoneMatch(countries, ds)
      if (hit) { choose(hit); setPlus(null); const rest = ds.slice(hit.dial.length - 1); setDigits(rest.slice(0, (phoneMask(hit).match(/X/g) || []).length)); caret.current = rest.length; return }
      setPlus('+' + ds); return
    }
    setPlus(null)
    let ds = raw.replace(/\D/g, '')
    let before = raw.slice(0, at).replace(/\D/g, '').length
    if (ds === digits && raw.length < shown.length && before > 0) { ds = ds.slice(0, before - 1) + ds.slice(before); before-- } // deleted a separator: drop the digit before it
    setDigits(ds.slice(0, maxDigits)); caret.current = Math.min(before, maxDigits)
  }
  return (
    <div ref={wrap} className={cn('relative', className)}>
      <div className={cn(inputShellClass(invalid), 'flex h-9 items-stretch overflow-hidden')}>
        <button type="button" aria-label={`Country: ${country.name} ${country.dial}`} aria-haspopup="listbox" aria-expanded={open} aria-controls={lid} aria-activedescendant={open ? `${lid}-${active}` : undefined}
          onClick={() => { setActive(countries.indexOf(country)); setOpen(!open) }}
          onKeyDown={e => {
            if (!open) { if (['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(e.key)) { e.preventDefault(); setActive(countries.indexOf(country)); setOpen(true) } return }
            if (e.key === 'Escape') { e.stopPropagation(); return setOpen(false) }
            if (e.key === 'Tab') return setOpen(false)
            if (e.key === ' ') { e.preventDefault(); return pickIndex(active) }
            if (e.key.length === 1) { const k = countries.findIndex(c => c.name.toLowerCase().startsWith(e.key.toLowerCase())); if (k >= 0) setActive(k); return }
            onKeyDown(e)
          }}
          className="flex flex-none cursor-pointer items-center gap-1 border-0 border-r border-[var(--line)] bg-[var(--muted)] px-2.5 text-sm outline-none hover:bg-[var(--line)] focus-visible:bg-[var(--line)]">
          <motion.span key={`f${swaps}`} initial={swaps ? { scale: 0.5, rotate: -20 } : false} animate={{ scale: 1, rotate: 0 }} transition={spring(0.5, 0.4)} className="leading-none">{country.flag}</motion.span>
          <motion.span key={`c${swaps}`} initial={swaps ? { y: -6, opacity: 0 } : false} animate={{ y: 0, opacity: 1 }} transition={spring(0.4, 0.3)} className="ui-num text-xs text-[var(--fg2)]">{country.dial}</motion.span>
          <Icon name="chevronDown" size={10} strokeWidth={3} className="text-[var(--fg3)]" />
        </button>
        <span className="relative flex min-w-0 flex-1">
          {plus === null && <span aria-hidden className="pointer-events-none absolute inset-0 flex items-center overflow-hidden px-3 text-[13px] whitespace-pre text-transparent">{out}<span className="text-[var(--fg3)] opacity-70">{rest}</span></span>}
          <input ref={input} id={id} value={shown} onChange={onInput} inputMode="tel" autoComplete="tel-national" aria-label={ariaLabel} aria-invalid={invalid || undefined}
            className="relative min-w-0 flex-1 border-0 bg-transparent px-3 text-[13px] outline-none" />
        </span>
      </div>
      <FloatingPanel open={open} className="max-h-60 w-full overflow-auto overscroll-contain sm:w-[260px]" role="presentation">
        <OptionList id={lid} label="Country" options={options} active={active} isSelected={o => o.value === country.dial} onPick={pickIndex} onHover={setActive} />
      </FloatingPanel>
    </div>
  )
}

/** Currencies CurrencyInput cycles through, with the locale whose separators it uses. */
export const CURRENCIES: [code: string, locale: string][] = [['CHF', 'de-CH'], ['EUR', 'de-DE'], ['GBP', 'en-GB'], ['USD', 'en-US']]
/** Browsers group de-CH with a typewriter apostrophe (1'234.50); Swiss typography uses the typographic one (1’234.50). */
const currencyTypo = (s: string) => s.replace(/'/g, '’')
const currencySeps = (locale: string) => {
  const parts = new Intl.NumberFormat(locale).formatToParts(12345.6)
  return { group: currencyTypo(parts.find(p => p.type === 'group')?.value ?? ','), decimal: parts.find(p => p.type === 'decimal')?.value ?? '.' }
}
/** Normalise what was typed into "1234.5" form: drop group separators, accept either mark as the decimal point, cap at 2 decimals. */
const currencyParse = (raw: string, group: string) => {
  const s = raw.split(group).join('').replace(/['’\s]/g, '').replace(/,/g, '.').replace(/[^\d.]/g, '')
  const dot = s.indexOf('.'), int = (dot < 0 ? s : s.slice(0, dot)).replace(/^0+(?=\d)/, '')
  return dot < 0 ? int : `${int || '0'}.${s.slice(dot + 1).replace(/\./g, '').slice(0, 2)}`
}
const currencyShow = (plain: string, { group, decimal }: { group: string; decimal: string }) => {
  if (!plain) return ''
  const [i, f] = plain.split('.')
  return i.replace(/\B(?=(\d{3})+(?!\d))/g, group) + (f !== undefined ? decimal + f : '')
}

/**
 * Amount field: thousands separators appear while you type, using the currency's locale (1’234.50 CHF, 1.234,50 EUR…),
 * at most two decimals. Tap the code to cycle currencies; the formatted amount is written out below.
 * Controlled with `value` (a number, or null for empty) or uncontrolled with `defaultValue`.
 */
export function CurrencyInput({ currencies = CURRENCIES, defaultCurrency, value, defaultValue, onChange, id, invalid, className }:
  { currencies?: [string, string][]; defaultCurrency?: string; value?: number | null; defaultValue?: number; id?: string; invalid?: boolean; className?: string
    onChange?: (amount: number | null, currency: string) => void }) {
  const [ci, setCi] = useState(() => Math.max(0, currencies.findIndex(c => c[0] === defaultCurrency)))
  const [plain, setPlain] = useState(() => { const v = value ?? defaultValue; return v !== undefined && v !== null ? String(v) : '' })
  useEffect(() => { // controlled: a different number from outside replaces what's typed (an echo of our own value doesn't)
    if (value === undefined) return
    const mine = plain ? parseFloat(plain) : null
    if (value !== mine && !(value === null && !plain)) setPlain(value === null ? '' : String(value))
  }, [value]) // eslint-disable-line react-hooks/exhaustive-deps
  const [code, locale] = currencies[ci], seps = currencySeps(locale)
  const input = useRef<HTMLInputElement>(null), caret = useRef<number | null>(null)
  const sig = /[\d.,]/ // characters whose count we keep to the right of the caret
  useLayoutEffect(() => {
    const el = input.current
    if (caret.current === null || !el) return
    const v = el.value; let n = caret.current, at = v.length
    while (n > 0 && at > 0) { at--; if (/\d/.test(v[at]) || v[at] === seps.decimal) n-- }
    caret.current = null; el.setSelectionRange(at, at)
  })
  const amount = plain && plain !== '0.' ? parseFloat(plain) : NaN
  const emit = (p: string, c: number) => onChange?.(p ? parseFloat(p) : null, currencies[c][0])
  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      <div className={cn(inputShellClass(invalid), 'flex h-9 items-stretch overflow-hidden')}>
        <button type="button" aria-label={`Currency ${code}, change currency`} onClick={() => { const n = (ci + 1) % currencies.length; setCi(n); emit(plain, n) }}
          className="flex w-14 flex-none cursor-pointer items-center justify-center overflow-hidden border-0 border-r border-[var(--line)] bg-[var(--muted)] text-[13px] outline-none hover:bg-[var(--line)] focus-visible:bg-[var(--line)]">
          <motion.b key={code} initial={{ y: -8, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={spring(0.4, 0.3)} className="font-semibold">{code}</motion.b>
        </button>
        <input ref={input} id={id} value={currencyShow(plain, seps)} inputMode="decimal" autoComplete="off" placeholder={`0${seps.decimal}00`} aria-label={`Amount in ${code}`} aria-invalid={invalid || undefined}
          onChange={e => {
            const raw = e.target.value, at = e.target.selectionStart ?? raw.length
            const p = currencyParse(raw, seps.group)
            caret.current = [...raw.slice(at)].filter(ch => sig.test(ch) && ch !== seps.group).length
            setPlain(p); emit(p, ci)
          }}
          className="min-w-0 flex-1 border-0 bg-transparent px-3 text-right font-[family-name:var(--mono)] text-[13px] outline-none placeholder:text-[var(--fg3)]" />
      </div>
      <span className="text-xs text-[var(--fg3)]" aria-live="polite">
        {Number.isFinite(amount) && amount > 0 ? currencyTypo(new Intl.NumberFormat(locale, { style: 'currency', currency: code }).format(amount)) : 'Tap the currency to switch'}
      </span>
    </div>
  )
}
