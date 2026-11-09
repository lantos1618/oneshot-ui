import { createContext, useContext, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type AriaAttributes, type CSSProperties, type FormEvent, type FormHTMLAttributes, type InputHTMLAttributes, type ReactNode, type Ref, type TextareaHTMLAttributes, type KeyboardEvent as RKeyboardEvent } from 'react'
import { AnimatePresence, animate, motion, useReducedMotion } from 'motion/react'
import { AnimatedNumber, FormFieldContext, type FormControlProps, type FormFieldState, Spinner, formDate, formDisabledClass, formReadOnlyClass, useFormControl, useFormFieldProps, Badge, Button, ICONS, Icon, type IconName, IconButton, LOCALE, type HourCycle, type MessageVars, UI_MESSAGES_EN, type WeekDay, dateFormat, formatMessage, localeHourCycle, localeWeekStart, logicalArrow, numberFormat, useLocale, addDays, addMonths, clamp, cn, fmt, fmtDate, hex2hue, hsl2hex, inputClass, isTouch, menuItemClass, prefersReducedMotion, sameDay, spring, startOfDay, useCoarsePointer, useDisclosure, usePointerDrag, useRoving } from './core'
import { play, shake } from './motion'
import { FloatingPanel, Popover, PopoverContent, type Placement, usePopover } from './overlay'
import { useVirtual } from './virtual'
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

/** Form label. Inside a FormField it is wired up for you. */
export function Label({ children, htmlFor, id, className }: { children: ReactNode; htmlFor?: string; id?: string; className?: string }) {
  return <label htmlFor={htmlFor} id={id} className={cn('mb-1.5 block text-[13px] font-medium', className)}>{children}</label>
}

/** Field-level errors a Form shows under its FormFields, by field name (server errors, a schema's issues…). */
export type FormErrors = Record<string, ReactNode | undefined>
const FormsFormCtx = createContext<{ errors: FormErrors; native: Record<string, string> }>({ errors: {}, native: {} })

/** The validation message for a control the browser found invalid (falls back to plain English where the browser gives none). */
const formsMessage = (el: HTMLInputElement) => el.validationMessage || (el.validity?.valueMissing ? (el.type === 'checkbox' ? 'Tick this box to continue' : 'This field is required') : 'Check this value')

/**
 * A <form> that validates its fields and shows the messages in its FormFields, with no form library. On submit it checks
 * every field (native inputs and the custom controls' required proxies alike), shows each failing field's message under
 * it, focuses the first one and doesn't submit; once a submit has failed, messages update as fields change. When
 * everything is valid it calls `onSubmit(event)` and `onValues(formData, event)` (which also prevents the page load).
 * `errors` adds messages of your own by field name (from the server or a schema); they win over the browser's.
 * `validationBehavior="native"` keeps the browser's own bubbles instead. `action` works as usual (server actions get the
 * FormData, custom controls included). Reset returns uncontrolled controls to their `defaultValue` and clears messages.
 */
export function Form({ onSubmit, onValues, errors, validationBehavior = 'aria', onReset, children, ref: outer, ...rest }:
  Omit<FormHTMLAttributes<HTMLFormElement>, 'onSubmit'> & {
    onSubmit?: (e: FormEvent<HTMLFormElement>) => void; onValues?: (data: FormData, e: FormEvent<HTMLFormElement>) => void
    errors?: FormErrors; validationBehavior?: 'aria' | 'native'; ref?: Ref<HTMLFormElement> }) {
  const ref = useRef<HTMLFormElement>(null)
  const [native, setNative] = useState<Record<string, string>>({})
  const failedOnce = useRef(false)
  const collect = (form: HTMLFormElement) => {
    const out: Record<string, string> = {}
    for (const el of Array.from(form.elements) as HTMLInputElement[]) {
      const key = el.name || el.dataset?.uiField
      if (!key || out[key] || !el.willValidate || el.validity.valid) continue
      out[key] = formsMessage(el)
    }
    return out
  }
  useEffect(() => {
    const form = ref.current; if (!form) return
    // after the event: a state update inside a native listener would flush before React's own onChange runs and undo the keystroke
    let t: ReturnType<typeof setTimeout> | undefined
    const recheck = () => { if (failedOnce.current) { clearTimeout(t); t = setTimeout(() => setNative(collect(form))) } }
    const invalid = (e: Event) => { const el = e.target as HTMLInputElement, key = el.name || el.dataset?.uiField; if (key) setNative(n => n[key] ? n : { ...n, [key]: formsMessage(el) }) }
    form.addEventListener('input', recheck); form.addEventListener('change', recheck); form.addEventListener('invalid', invalid, true)
    return () => { clearTimeout(t); form.removeEventListener('input', recheck); form.removeEventListener('change', recheck); form.removeEventListener('invalid', invalid, true) }
  }, [])
  return (
    <FormsFormCtx.Provider value={{ errors: errors ?? {}, native }}>
      <form ref={formsMergeRefs(ref, outer)} noValidate={validationBehavior === 'aria'} {...rest}
        onReset={e => { failedOnce.current = false; setNative({}); onReset?.(e) }}
        onSubmit={e => {
          const form = e.currentTarget
          if (validationBehavior === 'aria' && !form.checkValidity()) {
            e.preventDefault(); failedOnce.current = true; setNative(collect(form))
            const first = (Array.from(form.elements) as HTMLInputElement[]).find(el => el.willValidate && !el.validity.valid)
            first?.focus()
            return
          }
          failedOnce.current = false; setNative({})
          onSubmit?.(e)
          if (onValues) {
            if (!rest.action) e.preventDefault()
            let data: FormData
            try { data = new FormData(form, (e.nativeEvent as SubmitEvent).submitter) } catch { data = new FormData(form) }
            onValues(data, e)
          }
        }}>
        {children}
      </form>
    </FormsFormCtx.Provider>
  )
}

/**
 * Label + control + description/error, wired to whatever control is inside: the label points at the control (htmlFor, or
 * aria-labelledby for controls that aren't labelable elements), the description and error are its aria-describedby,
 * and `error` makes it aria-invalid with the error look. `name`, `required`, `disabled` and `readOnly` pass down to the
 * control. Inside a Form, the browser's message (after a failed submit) or `errors[name]` shows when you give no `error`.
 * The description and the error share one line, so a message appearing doesn't push the layout down.
 */
export function FormField({ label, description, hint, error, success, name, required, disabled, readOnly, id, htmlFor, children, className }:
  { label?: ReactNode; description?: ReactNode; /** same as description */ hint?: ReactNode; error?: ReactNode; success?: ReactNode
    name?: string; required?: boolean; disabled?: boolean; readOnly?: boolean
    /** the control's id (generated when left out) */ id?: string; /** same as id */ htmlFor?: string; children: ReactNode; className?: string }) {
  const auto = useId()
  const form = useContext(FormsFormCtx)
  const err = error ?? (name ? form.errors[name] ?? form.native[name] : undefined)
  const desc = description ?? hint
  const msg = err ?? success ?? desc
  const fid = id ?? htmlFor ?? `${auto}c`, labelId = label ? `${auto}l` : undefined, msgId = `${auto}m`
  const state: FormFieldState = { id: fid, labelId, descriptionId: msg && !err ? msgId : undefined, errorId: err ? msgId : undefined, name, invalid: err ? true : undefined, required, disabled, readOnly }
  return (
    <div className={className}>
      {label && <Label htmlFor={fid} id={labelId}>{label}{required && <span aria-hidden className="ms-0.5 text-[var(--bad)]">*</span>}</Label>}
      <FormFieldContext.Provider value={state}>{children}</FormFieldContext.Provider>
      {msg && <p id={msgId} aria-live="polite" className={cn('mt-1.5 mb-0 text-xs',
        err ? 'text-[var(--bad)]' : success ? 'text-[var(--ok)]' : 'text-[var(--fg3)]')}>{msg}</p>}
    </div>
  )
}

/** Label + control + hint/error (the hint turns red or green and is announced). The original name of FormField; same props, `htmlFor` is the control's id. */
export function Field(props: Parameters<typeof FormField>[0]) {
  return <FormField {...props} />
}

/** Run `cb` after the form around `ref` has been reset (native fields hold their reset values by then). */
function useFormsAfterReset(ref: { current: HTMLInputElement | HTMLTextAreaElement | null }, cb: (el: HTMLInputElement | HTMLTextAreaElement) => void) {
  const fn = useRef(cb)
  useLayoutEffect(() => { fn.current = cb })
  useEffect(() => {
    const form = ref.current?.form
    if (!form) return
    const on = () => setTimeout(() => { if (ref.current) fn.current(ref.current) })
    form.addEventListener('reset', on)
    return () => form.removeEventListener('reset', on)
  }, [ref])
}

/** Hand `el` to a callback or object ref. */
function formsAssignRef<T>(r: Ref<T> | undefined, el: T | null) { if (typeof r === 'function') r(el); else if (r) (r as { current: T | null }).current = el }

/** Give one element to several refs (yours and the caller's). */
function formsMergeRefs<T>(...refs: (Ref<T> | undefined)[]) {
  return (el: T | null) => { for (const r of refs) { if (typeof r === 'function') r(el); else if (r) (r as { current: T | null }).current = el } }
}

/**
 * Text input. Set `invalid` to show the error ring; it shakes once when it becomes invalid. Your `ref` reaches the <input>.
 * Inside a FormField it takes the field's id, name, flags and aria-describedby. Disabled and read-only get a muted fill.
 */
export function Input({ invalid: inv, className, ref: outer, id, name, required, disabled, readOnly, 'aria-describedby': db, ...p }: InputHTMLAttributes<HTMLInputElement> & { invalid?: boolean; ref?: Ref<HTMLInputElement> }) {
  const ref = useRef<HTMLInputElement>(null)
  const reduce = useReducedMotion()
  const { invalid, ...f } = useFormFieldProps({ id, name, required, disabled, readOnly, invalid: inv, 'aria-describedby': db })
  useEffect(() => {
    if (invalid && !reduce && ref.current?.animate) ref.current.animate([0, -6, 6, -4, 4, 0].map(x => ({ transform: `translateX(${x}px)` })), { duration: 350 })
  }, [invalid, reduce])
  return <input ref={formsMergeRefs(ref, outer)} aria-invalid={invalid || undefined} className={cn(inputClass, formDisabledClass, formReadOnlyClass, className)} {...f} {...p} />
}

const TA_TONE = {
  ok: ['text-[var(--fg3)]', 'stroke-[var(--primary)]'], warn: ['text-[var(--warn)]', 'stroke-[var(--warn)]'], bad: ['text-[var(--bad)]', 'stroke-[var(--bad)]'],
} as const

/**
 * Auto-growing textarea; the height animates as lines are added or removed.
 * With `maxLength` it shows "N left" and a ring that fills toward the limit, turning amber under 20 and red under 5, and pops at 0.
 */
export function Textarea({ className, maxLength, value, defaultValue, onChange, rows = 3, invalid: inv, ref: outer, id, name, required, disabled, readOnly, 'aria-describedby': db, ...p }:
  TextareaHTMLAttributes<HTMLTextAreaElement> & { invalid?: boolean; ref?: Ref<HTMLTextAreaElement> }) {
  const { invalid, ...f } = useFormFieldProps({ id, name, required, disabled, readOnly, invalid: inv, 'aria-describedby': db })
  const ref = useRef<HTMLTextAreaElement>(null), countRef = useRef<HTMLSpanElement>(null), fitted = useRef<string | null>(null)
  const [innerLen, setInnerLen] = useState(String(defaultValue ?? '').length)
  const len = value !== undefined ? String(value).length : innerLen
  useFormsAfterReset(ref, t => { setInnerLen(t.value.length); fitted.current = null; t.style.height = 'auto'; t.style.height = t.scrollHeight + 2 + 'px' })
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
      <textarea ref={formsMergeRefs(ref, outer)} rows={rows} maxLength={maxLength} value={value} defaultValue={defaultValue} aria-invalid={invalid || undefined} {...f}
        onChange={e => { setInnerLen(e.target.value.length); fit(true); onChange?.(e) }}
        className={cn(inputClass, formDisabledClass, formReadOnlyClass, 'resize-none overflow-hidden !py-2 leading-relaxed', className)} {...p} />
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
export function PasswordInput({ strength, rules = strength, className, onChange, invalid: inv, ref, id, name, required, disabled, readOnly, 'aria-describedby': db, ...p }:
  InputHTMLAttributes<HTMLInputElement> & { strength?: boolean; rules?: boolean; invalid?: boolean; ref?: Ref<HTMLInputElement> }) {
  const { invalid, ...f } = useFormFieldProps({ id, name, required, disabled, readOnly, invalid: inv, 'aria-describedby': db })
  const [show, setShow] = useState(false), [flips, setFlips] = useState(0)
  const [inner, setV] = useState(String(p.defaultValue ?? ''))
  const own = useRef<HTMLInputElement>(null)
  useFormsAfterReset(own, el => setV(el.value))
  const v = p.value !== undefined ? String(p.value) : inner // controlled: follow the prop
  const passed = PW_RULES.map(([, r]) => r.test(v))
  const score = v ? passed.filter(Boolean).length : 0
  const [prev, setPrev] = useState(score), [from, setFrom] = useState(0)
  if (score !== prev) { setFrom(prev); setPrev(score) }
  return (
    <div className={cn('flex flex-col gap-2', className)}>
      <div className="relative">
        <input ref={formsMergeRefs(own, ref)} type={show ? 'text' : 'password'} aria-invalid={invalid || undefined} className={cn(inputClass, formDisabledClass, formReadOnlyClass, '!pe-10')} {...f} {...p}
          onChange={e => { setV(e.target.value); onChange?.(e) }} />
        <span className="absolute top-1/2 end-1 flex -translate-y-1/2">
          <Button size="icon-sm" variant="ghost" disabled={f.disabled} aria-label={show ? 'Hide password' : 'Show password'} title={show ? 'Hide password' : 'Show password'}
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
type FormsToggleProps = AriaAttributes & FormControlProps & {
  checked?: boolean; defaultChecked?: boolean; onChange?: (v: boolean) => void
  /** submitted as `name=value` (default "on") while checked; nothing while unchecked, like a native checkbox */ value?: string
  className?: string; ref?: Ref<HTMLButtonElement>
}
const formsAria = (p: Record<string, unknown>) => Object.fromEntries(Object.entries(p).filter(([k]) => k.startsWith('aria-') && k !== 'aria-describedby' && k !== 'aria-labelledby')) as AriaAttributes
/** The shared form wiring of Switch and Checkbox. `required` means it must be on (a native required checkbox). */
function useFormsToggle({ checked, defaultChecked = false, onChange, value, ref, ...p }: FormsToggleProps) {
  const btn = useRef<HTMLButtonElement>(null)
  const fc = useFormControl<boolean>({ ...p, value: checked, defaultValue: defaultChecked, onChange, serialize: on => on ? value ?? 'on' : null, filled: on => on, kind: 'checkbox', focus: () => btn.current?.focus() })
  return { ...fc, ref: formsMergeRefs(btn, ref) }
}

/**
 * Toggle. The knob springs across and stretches (squash replays on every toggle). Form-native: `name`/`value` (submits
 * like a native checkbox), `required` (must be on), `disabled`, `readOnly`, `invalid`, `onBlur`, `form`, and `ref` on the
 * switch button. `label` puts it in a clickable row.
 */
export function Switch({ label, className, ...props }: FormsToggleProps & { label?: ReactNode }) {
  const t = useFormsToggle(props)
  const on = t.value
  const [flips, setFlips] = useState(0)
  const coarse = useCoarsePointer() // touch: a larger, iOS-sized switch (52×32)
  const btn = (
    <button type="button" ref={t.ref} role="switch" aria-checked={on} aria-required={t.required || undefined} aria-readonly={t.readOnly || undefined} disabled={t.disabled}
      aria-label={typeof label === 'string' ? label : undefined} aria-labelledby={label ? undefined : t.labelledBy} {...t.control} {...formsAria(props)}
      onClick={() => { if (t.readOnly) return; t.set(!on); setFlips(f => f + 1) }}
      className={cn('relative h-[22px] w-[38px] flex-none cursor-pointer rounded-full border-0 p-0 transition-colors disabled:cursor-not-allowed disabled:opacity-50 aria-readonly:cursor-default [@media(pointer:coarse)]:h-8 [@media(pointer:coarse)]:w-[52px]',
        on ? 'bg-[var(--primary)]' : 'bg-[var(--line2)]', t.invalid && 'shadow-[0_0_0_2px_var(--bad)]', !label && className)}>
      <motion.i className="absolute top-[3px] start-[3px] block h-4 w-4 [@media(pointer:coarse)]:h-[26px] [@media(pointer:coarse)]:w-[26px]" initial={false} animate={{ x: on ? (coarse ? 20 : 16) : 0 }} transition={spring(0.35, 0.4)}>
        <motion.i key={flips} className="block h-full w-full rounded-full bg-[var(--card)] shadow-[0_1px_2px_rgba(0,0,0,.25)]"
          initial={flips ? { scaleX: 1.3 } : false} animate={{ scaleX: 1 }} transition={spring(0.35, 0.4)} />
      </motion.i>
    </button>
  )
  if (!label) return <span className="relative inline-flex" onBlur={t.onBlur}>{btn}{t.inputs}</span>
  return (
    <label onBlur={t.onBlur} className={cn('relative flex items-center justify-between gap-3 text-[13px] [@media(pointer:coarse)]:min-h-10', t.disabled ? 'cursor-not-allowed' : 'cursor-pointer', className)}>
      {label}{btn}{t.inputs}
    </label>
  )
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

/**
 * Checkbox with a drawn checkmark; `children` is its label. Form-native like Switch: `name`/`value`, `required` (must be
 * ticked), `disabled` (the box fades, the label stays legible in --fg3), `readOnly`, `invalid`, `onBlur`, `form`, `ref`.
 */
export function Checkbox({ children, className, ...props }: FormsToggleProps & { children?: ReactNode }) {
  const t = useFormsToggle(props)
  return (
    <span className="relative inline-flex max-w-full" onBlur={t.onBlur}>
      <button type="button" ref={t.ref} role="checkbox" aria-checked={t.value} aria-required={t.required || undefined} aria-readonly={t.readOnly || undefined} disabled={t.disabled}
        aria-labelledby={children ? undefined : t.labelledBy} {...t.control} {...formsAria(props)} onClick={() => { if (!t.readOnly) t.set(!t.value) }}
        className={cn('group/cb flex cursor-pointer items-center gap-2.5 border-0 bg-transparent p-0 text-start text-[13px] select-none disabled:cursor-not-allowed disabled:text-[var(--fg3)] aria-readonly:cursor-default [@media(pointer:coarse)]:min-h-9', className)}>
        <CheckboxBox checked={t.value} className={cn('group-disabled/cb:opacity-50', t.invalid && !t.value && '!border-[var(--bad)]')} />
        {children}
      </button>
      {t.inputs}
    </span>
  )
}

export type Option = {
  value: string; label: string; hint?: string; icon?: IconName; disabled?: boolean
  /** colour dot, e.g. 'var(--bad)' */ dot?: string
  /** anything shown before the label: a flag, an emoji, an avatar */ leading?: ReactNode
  /** heading the option is listed under; options of a group should be next to each other */ group?: string
}

/**
 * Radio group with arrow-key navigation. Form-native: `name` submits the chosen value ('' when none), `required`,
 * `disabled` (every option), `readOnly` (arrows move focus only), `invalid`, `onBlur`, `form`, and `ref` on the radio that
 * holds the Tab stop. Inside a FormField the group is labelled by the field's label.
 */
export function RadioGroup({ options, value, defaultValue, onChange, label, className, ref, ...fp }: FormControlProps &
  { options: Option[]; value?: string; defaultValue?: string; onChange?: (v: string) => void; label?: string; className?: string; ref?: Ref<HTMLButtonElement> }) {
  const refs = useRef<(HTMLButtonElement | null)[]>([])
  const fc = useFormControl<string>({ ...fp, value, defaultValue: defaultValue ?? options.find(o => !o.disabled)?.value ?? '', onChange, serialize: v => v, focus: () => refs.current[tabStopRef.current]?.focus() })
  const v = fc.value, set = fc.set
  const sel = options.findIndex(o => o.value === v && !o.disabled)
  const tabStop = sel >= 0 ? sel : options.findIndex(o => !o.disabled) // value missing or disabled: the first enabled option takes Tab
  const tabStopRef = useRef(tabStop); tabStopRef.current = tabStop
  const off = (i: number) => fc.disabled || !!options[i].disabled
  const { onKeyDown } = useRoving(options.length, () => {}, { orientation: 'both', isDisabled: off, index: Math.max(0, tabStop), homeEnd: false,
    onMove: n => { set(options[n].value); refs.current[n]?.focus() } })
  return (
    <div role="radiogroup" aria-label={label} aria-labelledby={label ? undefined : fc.labelledBy} aria-required={fc.required || undefined} aria-readonly={fc.readOnly || undefined}
      aria-disabled={fc.disabled || undefined} aria-invalid={fc.control['aria-invalid']} aria-describedby={fc.control['aria-describedby']} id={fc.control.id}
      className={cn('relative flex flex-col gap-2.5', className)} onKeyDown={onKeyDown} onBlur={fc.onBlur}>
      {options.map((o, i) => {
        const on = o.value === v
        return (
          <button type="button" key={o.value} ref={el => { refs.current[i] = el; if (i === tabStop) formsAssignRef(ref, el) }} role="radio" aria-checked={on} disabled={off(i)} tabIndex={i === tabStop ? 0 : -1} onClick={() => set(o.value)}
            className="group/rd flex cursor-pointer items-center gap-2.5 border-0 bg-transparent p-0 text-start text-[13px] disabled:cursor-not-allowed disabled:text-[var(--fg3)] [@media(pointer:coarse)]:min-h-9">
            <span className={cn('grid h-[18px] w-[18px] flex-none place-items-center rounded-full border-[1.5px] group-disabled/rd:opacity-50', on ? 'border-[var(--primary)]' : fc.invalid ? 'border-[var(--bad)]' : 'border-[var(--line2)]')}>
              <motion.i className="block h-2 w-2 rounded-full bg-[var(--primary)]" initial={false} animate={{ scale: on ? 1 : 0 }} transition={on ? spring(0.5, 0.35) : { duration: 0.1 }} />
            </span>
            <span>{o.label}{o.hint && <span className="block text-xs text-[var(--fg3)]">{o.hint}</span>}</span>
          </button>
        )
      })}
      {fc.inputs}
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
 * stop (the chosen segment); ←/→ (and ↑/↓) move and select, Home/End jump. Name the group with `aria-label` (or a
 * FormField label). Form-native: `name` submits the value; `disabled`, `readOnly`, `invalid`, `onBlur`, `form`, `ref`.
 */
export function SegmentedControl({ options, value, defaultValue, onChange, className, size = 'md', 'aria-label': ariaLabel, ref, ...fp }: FormControlProps &
  { options: (Option | string)[]; value?: string; defaultValue?: string; onChange?: (v: string) => void; className?: string; size?: 'sm' | 'md'; 'aria-label'?: string; ref?: Ref<HTMLButtonElement> }) {
  const opts = options.map(o => typeof o === 'string' ? { value: o, label: o } as Option : o)
  const refs = useRef<(HTMLButtonElement | null)[]>([])
  const fc = useFormControl<string>({ ...fp, value, defaultValue: defaultValue ?? opts[0].value, onChange, serialize: v => v, focus: () => refs.current[tabStopRef.current]?.focus() })
  const v = fc.value, set = fc.set
  const group = useId()
  const sel = opts.findIndex(o => o.value === v && !o.disabled)
  const tabStop = sel >= 0 ? sel : Math.max(0, opts.findIndex(o => !o.disabled))
  const tabStopRef = useRef(tabStop); tabStopRef.current = tabStop
  const off = (i: number) => fc.disabled || !!opts[i].disabled
  const { onKeyDown } = useRoving(opts.length, () => {}, { orientation: 'both', isDisabled: off, index: tabStop,
    onMove: n => { set(opts[n].value); refs.current[n]?.focus() } })
  return (
    <div role="radiogroup" aria-label={ariaLabel} aria-labelledby={ariaLabel ? undefined : fc.labelledBy} aria-readonly={fc.readOnly || undefined} aria-disabled={fc.disabled || undefined}
      aria-invalid={fc.control['aria-invalid']} aria-describedby={fc.control['aria-describedby']} id={fc.control.id} onKeyDown={onKeyDown} onBlur={fc.onBlur}
      className={cn('relative inline-flex rounded-[calc(var(--r-md)+1px)] bg-[var(--muted)] p-1', fc.invalid && 'shadow-[0_0_0_1px_var(--bad)]', className)}>
      {opts.map((o, i) => (
        <button type="button" key={o.value} ref={el => { refs.current[i] = el; if (i === tabStop) formsAssignRef(ref, el) }} role="radio" aria-checked={o.value === v} tabIndex={i === tabStop ? 0 : -1} disabled={off(i)}
          aria-label={o.label ? undefined : o.value} onClick={() => set(o.value)}
          className={cn('relative flex-1 cursor-pointer rounded-[calc(var(--r-md)-2px)] border-0 bg-transparent px-3 font-medium whitespace-nowrap transition-colors disabled:cursor-not-allowed',
            size === 'sm' ? 'h-[22px] text-xs [@media(pointer:coarse)]:h-8' : 'h-7 text-[13px] [@media(pointer:coarse)]:h-9',
            o.value === v ? 'text-[var(--fg)]' : 'text-[var(--fg2)] hover:text-[var(--fg)] disabled:text-[var(--fg3)] disabled:hover:text-[var(--fg3)]')}>
          {o.value === v && <ActiveIndicator group={group} className={cn('rounded-[calc(var(--r-md)-2px)] shadow-[0_1px_2px_rgba(0,0,0,.08)]', fc.disabled ? 'bg-[var(--line)]' : 'bg-[var(--card)]')} />}
          <span className="relative flex items-center justify-center gap-1.5">{o.icon && <Icon name={o.icon} size={14} />}{o.label}{o.hint && <Badge tone="ok" size="sm">{o.hint}</Badge>}</span>
        </button>
      ))}
      {fc.inputs}
    </div>
  )
}

/**
 * Range slider with live value. `disabled` fades only the track (label and value stay legible in --fg3; the group gets aria-disabled). Native input: keyboard and screen readers for free, a 32px hit area on touch.
 * `steps` makes it a stepped picker over named stops (value = index; the names show under the track and can be tapped).
 * `compact` uses a smaller grey readout (settings panels).
 */
export function Slider({ value, defaultValue, onChange, min: minProp = 0, max: maxProp = 100, step: stepProp = 1, label, format, compact, steps, className, ref, ...fp }: FormControlProps &
  { value?: number; defaultValue?: number; onChange?: (v: number) => void; min?: number; max?: number; step?: number; label?: string; format?: (v: number) => ReactNode
    compact?: boolean; steps?: string[]; className?: string; ref?: Ref<HTMLInputElement> }) {
  const named = !!steps && steps.length > 1
  const min = named ? 0 : minProp, max = named ? steps.length - 1 : maxProp, step = named ? 1 : stepProp
  const input = useRef<HTMLInputElement>(null)
  const fc = useFormControl<number>({ ...fp, value, defaultValue: defaultValue ?? (named ? 0 : (min + max) / 2), onChange, serialize: n => String(n), focus: () => input.current?.focus() })
  const v = fc.value, set = fc.set, disabled = fc.disabled
  const pct = clamp(((v - min) / (max - min || 1)) * 100, 0, 100)
  const shown = named ? steps[clamp(Math.round(v), 0, steps.length - 1)] : format ? format(v) : v
  return (
    // disabled: only the track and thumb fade; the label and value switch to --fg3 (still ≥4.5:1, never faded with opacity)
    <div role="group" aria-label={label} aria-disabled={disabled || undefined} className={cn('relative', className)} onBlur={fc.onBlur}>
      {label && (
        <div className={cn('flex justify-between text-[13px]', compact ? 'mb-1.5' : 'mb-2')}>
          <span className={disabled ? 'text-[var(--fg3)]' : 'text-[var(--fg2)]'}>{label}</span>
          <span className={cn('ui-num', compact || disabled ? 'text-[var(--fg3)]' : 'font-medium', compact && 'text-xs')}>{shown}</span>
        </div>
      )}
      <input type="range" ref={formsMergeRefs(input, ref)} {...fc.control} min={min} max={max} step={step} value={v} disabled={disabled} aria-label={label} aria-labelledby={label ? undefined : fc.labelledBy}
        aria-readonly={fc.readOnly || undefined} aria-valuetext={named ? String(shown) : undefined}
        onChange={e => set(Number(e.target.value))}
        className={cn(rangeInputClass, 'h-1.5 accent-[var(--primary)] transition-opacity disabled:cursor-not-allowed disabled:opacity-40', fc.readOnly && 'cursor-default', fc.invalid && 'outline outline-1 outline-offset-2 outline-[var(--bad)]')}
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
      {fc.inputs}
    </div>
  )
}

/**
 * − value + with a rolling number. The whole control is one spinbutton tab stop: ↑/→ and ↓/← step,
 * Home and End jump to min and max, and it wiggles when you push past either limit.
 * Form-native: `name` submits the number as a plain string ("3"); `disabled`, `readOnly`, `invalid`, `onBlur`, `form`,
 * and `ref` on the spinbutton. Inside a FormField the field's label names it (otherwise `label`).
 */
export function NumberStepper({ value, defaultValue = 0, onChange, min = -Infinity, max = Infinity, step = 1, label = 'Quantity', format, className, ref, ...fp }: FormControlProps &
  { value?: number; defaultValue?: number; onChange?: (v: number) => void; min?: number; max?: number; step?: number; label?: string; format?: Intl.NumberFormatOptions; className?: string; ref?: Ref<HTMLDivElement> }) {
  const root = useRef<HTMLDivElement>(null)
  const fc = useFormControl<number>({ ...fp, value, defaultValue, onChange, serialize: n => String(n), focus: () => root.current?.focus() })
  const v = fc.value, set = fc.set, locked = fc.disabled || fc.readOnly
  const change = (n: number) => {
    if (locked) return
    const c = clamp(n, min, max)
    if (c === v) return shake(root.current, 4)
    set(c)
  }
  const btn = 'h-[34px] w-9 cursor-pointer border-0 bg-transparent text-base hover:bg-[var(--muted)] aria-disabled:opacity-40 aria-disabled:cursor-default grid place-items-center disabled:cursor-not-allowed disabled:hover:bg-transparent'
  const labelled = fc.labelledBy && !fp['aria-labelledby'] ? undefined : label // a FormField label names it instead
  return (
    <div className="relative inline-flex" onBlur={fc.onBlur}>
      <div ref={formsMergeRefs(root, ref)} role="spinbutton" tabIndex={fc.disabled ? -1 : 0} aria-label={labelled} aria-labelledby={labelled ? undefined : fc.labelledBy} {...fc.control}
        aria-valuenow={v} aria-valuetext={new Intl.NumberFormat(LOCALE, format).format(v)} aria-disabled={fc.disabled || undefined} aria-readonly={fc.readOnly || undefined}
        aria-valuemin={Number.isFinite(min) ? min : undefined} aria-valuemax={Number.isFinite(max) ? max : undefined}
        className={cn('inline-flex items-center overflow-hidden rounded-[var(--r-md)] border bg-[var(--card)] outline-none focus-visible:border-[var(--fg3)] focus-visible:shadow-[0_0_0_3px_var(--muted)]',
          fc.invalid ? 'border-[var(--bad)] shadow-[0_0_0_3px_var(--bad-soft)]' : 'border-[var(--line)]', fc.disabled ? 'cursor-not-allowed bg-[var(--muted)] text-[var(--fg3)]' : fc.readOnly && 'bg-[var(--muted)]', className)}
        onKeyDown={e => {
          const d = ({ ArrowUp: 1, ArrowRight: 1, ArrowDown: -1, ArrowLeft: -1 } as Record<string, number>)[e.key]
          if (d) { e.preventDefault(); change(v + d * step) }
          if (e.key === 'Home' && Number.isFinite(min)) { e.preventDefault(); change(min) }
          if (e.key === 'End' && Number.isFinite(max)) { e.preventDefault(); change(max) }
        }}>
        <button type="button" tabIndex={-1} className={btn} aria-label={`Decrease ${label}`} aria-disabled={(v <= min && !locked) || undefined} disabled={locked} hidden={fc.readOnly}
          onPointerDown={e => { e.preventDefault(); root.current?.focus() }} onClick={() => change(v - step)}><Icon name="minus" size={14} /></button>
        <span className={cn('grid min-w-14 place-items-center text-base font-medium', fc.readOnly && 'h-[34px] px-2')}><AnimatedNumber value={v} format={format} /></span>
        <button type="button" tabIndex={-1} className={btn} aria-label={`Increase ${label}`} aria-disabled={(v >= max && !locked) || undefined} disabled={locked} hidden={fc.readOnly}
          onPointerDown={e => { e.preventDefault(); root.current?.focus() }} onClick={() => change(v + step)}><Icon name="plus" size={14} /></button>
      </div>
      {fc.inputs}
    </div>
  )
}

/**
 * 1–5 stars: every lit star pops again in sequence on each pick. Arrow keys change the rating.
 * Form-native: `name` submits the rating ("4"; '' while unrated), `required` (must be rated), `disabled`, `readOnly`
 * (shows the stars, no picking), `invalid`, `onBlur`, `form`, and `ref` on the star holding the Tab stop.
 */
export function Rating({ value, defaultValue = 0, onChange, labels = ['Terrible', 'Bad', 'Okay', 'Good', 'Excellent'], prompt = 'Tap to rate', className, 'aria-label': ariaLabel = 'Rating', ref, ...fp }: FormControlProps &
  { value?: number; defaultValue?: number; onChange?: (v: number) => void; labels?: string[]; prompt?: string; className?: string; 'aria-label'?: string; ref?: Ref<HTMLButtonElement> }) {
  const refs = useRef<(HTMLButtonElement | null)[]>([])
  const fc = useFormControl<number>({ ...fp, value, defaultValue, onChange, serialize: n => n ? String(n) : '', focus: () => refs.current[Math.max(0, (vRef.current || 1) - 1)]?.focus() })
  const v = fc.value, vRef = useRef(v); vRef.current = v
  const locked = fc.disabled || fc.readOnly
  const [hover, setHover] = useState(0)
  const shown = (locked ? 0 : hover) || v
  const pick = (n: number, focus = false) => {
    if (locked) { if (focus) refs.current[n - 1]?.focus(); return }
    fc.set(n)
    refs.current.forEach((el, i) => { if (i < n) play(el, { scale: [0.6, 1.2, 1] }, { duration: 0.4, ease: 'easeOut', delay: i * 0.05 }) })
    if (focus) refs.current[n - 1]?.focus()
  }
  const labelled = fc.labelledBy && !fp['aria-labelledby'] ? undefined : ariaLabel
  return (
    <div className={cn('relative flex flex-col gap-1.5', className)} onBlur={fc.onBlur}>
      <div className="flex gap-1 [@media(pointer:coarse)]:-mx-1.5 [@media(pointer:coarse)]:gap-0" role="radiogroup" aria-label={labelled} aria-labelledby={labelled ? undefined : fc.labelledBy} {...fc.control}
        aria-required={fc.required || undefined} aria-readonly={fc.readOnly || undefined} aria-disabled={fc.disabled || undefined} onPointerLeave={() => setHover(0)}>
        {[1, 2, 3, 4, 5].map(n => (
          <button type="button" key={n} ref={el => { refs.current[n - 1] = el; if (n === (v || 1)) formsAssignRef(ref, el) }} role="radio" aria-checked={v === n} tabIndex={n === (v || 1) ? 0 : -1}
            disabled={fc.disabled} aria-label={`${n} star${n > 1 ? 's' : ''}`} onClick={() => pick(n)} onPointerEnter={e => !isTouch(e) && setHover(n)}
            onKeyDown={e => {
              const d = ({ ArrowRight: 1, ArrowUp: 1, ArrowLeft: -1, ArrowDown: -1 } as Record<string, number>)[e.key]
              if (d) { e.preventDefault(); pick(Math.min(5, Math.max(1, (v || 0) + d)), true) }
            }}
            className={cn('border-0 bg-transparent p-0.5 transition-colors [@media(pointer:coarse)]:p-1.5', locked ? fc.disabled ? 'cursor-not-allowed' : 'cursor-default' : 'cursor-pointer',
              n <= shown ? (fc.disabled ? 'text-[var(--fg3)]' : 'text-[#F59E0B]') : fc.invalid ? 'text-[var(--bad)]' : 'text-[var(--line2)]')}>
            <Icon name="star" size={22} fill="currentColor" strokeWidth={0} />
          </button>
        ))}
      </div>
      <span className="text-xs text-[var(--fg3)]" aria-live="polite">{shown ? labels[shown - 1] : prompt}</span>
      {fc.inputs}
    </div>
  )
}

/**
 * Type and press Enter (or comma) to add; Backspace on empty removes the last tag. Duplicates wiggle. IME-safe.
 * Form-native: `name` submits each tag as its own field (name=a&name=b, so tags may contain commas; read them with
 * formData.getAll), `required` (at least one tag), `disabled`, `readOnly` (chips only), `invalid`, `onBlur`, `form`, and
 * `ref` on the text input. A tag still being typed is added on blur.
 */
export function TagInput({ value, defaultValue = [], onChange, placeholder = 'Add a tag…', className, ref, ...fp }: FormControlProps &
  { value?: string[]; defaultValue?: string[]; onChange?: (v: string[]) => void; placeholder?: string; className?: string; ref?: Ref<HTMLInputElement> }) {
  const input = useRef<HTMLInputElement>(null)
  const [text, setText] = useState('')
  const fc = useFormControl<string[]>({ ...fp, value, defaultValue, onChange, serialize: t => t, filled: t => t.length > 0, focus: () => input.current?.focus(), onReset: () => setText('') })
  const tags = fc.value, set = fc.set, locked = fc.disabled || fc.readOnly
  const [dupe, setDupe] = useState<string | null>(null)
  const add = () => {
    const t = text.trim(); if (!t) return
    if (tags.includes(t)) { setDupe(t); setTimeout(() => setDupe(null), 300) } else set([...tags, t])
    setText('')
  }
  return (
    <div className={cn(inputShellClass(fc.invalid), 'relative flex flex-wrap gap-1.5 p-1.5', fc.disabled ? 'cursor-not-allowed !bg-[var(--muted)] text-[var(--fg3)] hover:!border-[var(--line)]' : fc.readOnly && '!bg-[var(--muted)]', className)}
      onBlur={e => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) add(); fc.onBlur(e) }}>
      <AnimatePresence initial={false}>
        {tags.map(t => (
          <motion.span key={t} layout initial={{ scale: 0.6, opacity: 0 }} animate={{ scale: 1, opacity: 1, x: dupe === t ? [0, -4, 4, 0] : 0 }}
            exit={{ scale: 0.6, opacity: 0, transition: { duration: 0.15 } }} transition={spring(0.4, 0.35)}
            className={cn('inline-flex items-center gap-1 rounded-[var(--r-md)] py-1 ps-2 text-xs', locked ? 'bg-[var(--card)] pe-2 shadow-[inset_0_0_0_1px_var(--line)]' : 'bg-[var(--muted)] pe-1')}>
            {t}
            {!locked && <button type="button" aria-label={`Remove ${t}`} onClick={() => set(tags.filter(x => x !== t))} className="ui-target cursor-pointer rounded-[var(--r-sm)] border-0 bg-transparent px-1 leading-none text-[var(--fg3)] hover:bg-[var(--line)] hover:text-[var(--fg)] [@media(pointer:coarse)]:-my-2 [@media(pointer:coarse)]:-me-1 [@media(pointer:coarse)]:min-h-8 [@media(pointer:coarse)]:min-w-8 [@media(pointer:coarse)]:text-base">×</button>}
          </motion.span>
        ))}
      </AnimatePresence>
      <input ref={formsMergeRefs(input, ref)} {...fc.control} value={text} placeholder={fc.readOnly ? '' : placeholder} aria-label={fc.control.id && fc.labelledBy ? undefined : placeholder}
        disabled={fc.disabled} readOnly={fc.readOnly} aria-required={fc.required || undefined} onChange={e => setText(e.target.value)}
        onKeyDown={e => {
          if (e.nativeEvent.isComposing) return // Enter that confirms an IME candidate is not a submit
          if ((e.key === 'Enter' || e.key === ',') && text.trim()) { e.preventDefault(); add() }
          if (e.key === 'Backspace' && !text && tags.length) set(tags.slice(0, -1))
        }}
        className="min-w-20 flex-1 border-0 bg-transparent px-1 py-0.5 text-[13px] outline-none disabled:cursor-not-allowed [@media(pointer:coarse)]:min-h-8" />
      {fc.inputs}
    </div>
  )
}

const otpSplit = (code: string, n: number) => { const d = code.replace(/\D/g, ''); return Array.from({ length: n }, (_, i) => d[i] ?? '') }

/**
 * One-time code: auto-advance, paste fills every box, typing into a filled box replaces and re-pops it.
 * `onChange` fires with the partial code on every edit (use it to reset your hint), `onComplete` with the full code.
 * Controlled with `value` (set it to '' to clear the boxes) or uncontrolled with `defaultValue`; `length` may change.
 * Pass `status="bad"` after a wrong code and the boxes shake (again on every wrong attempt); `"ok"` makes them hop.
 * Form-native: `name` submits the digits typed so far ("123456"), `required` (every box filled), `disabled`, `readOnly`,
 * `invalid` (same look as status "bad"), `onBlur`, `form`, and `ref` on the first box.
 */
export function OTPInput({ length = 6, value, defaultValue = '', onComplete, onChange, status, className, 'aria-label': ariaLabel = 'One-time code', ref, ...fp }: FormControlProps &
  { length?: number; value?: string; defaultValue?: string; onComplete?: (code: string) => void; onChange?: (code: string) => void; status?: 'ok' | 'bad'; className?: string; 'aria-label'?: string; ref?: Ref<HTMLInputElement> }) {
  const refs = useRef<(HTMLInputElement | null)[]>([]), box = useRef<HTMLDivElement>(null)
  const [raw, setVals] = useState<string[]>(() => otpSplit(value ?? defaultValue, length))
  const vals = raw.length === length ? raw : otpSplit(raw.join(''), length)
  const fc = useFormControl<string>({ ...fp, value: vals.join(''), defaultValue, serialize: c => c, filled: c => c.length === length,
    focus: () => refs.current[Math.min(vals.filter(Boolean).length, length - 1)]?.focus(), onReset: () => setVals(otpSplit(defaultValue, length)) })
  useEffect(() => { if (value !== undefined && value !== vals.join('')) setVals(otpSplit(value, length)) }, [value, length]) // eslint-disable-line react-hooks/exhaustive-deps
  const [attempt, setAttempt] = useState(0)
  useEffect(() => { if (status === 'bad' && attempt) shake(box.current, 8) }, [status, attempt])
  useEffect(() => { if (status === 'ok') refs.current.forEach((el, i) => play(el, { y: [0, -6, 0] }, { duration: 0.4, delay: i * 0.04 })) }, [status])
  const update = (next: string[]) => {
    if (fc.disabled || fc.readOnly) return
    setVals(next); const code = next.join(''); fc.set(code); onChange?.(code)
    if (next.every(Boolean)) { setAttempt(a => a + 1); onComplete?.(code) }
  }
  const typed = (i: number, d: string) => {
    const n = [...vals]; n[i] = d; update(n)
    if (d) { play(refs.current[i], { scale: [1.12, 1] }, spring(0.5, 0.3)); refs.current[i + 1]?.focus() }
  }
  const bad = status === 'bad' || fc.invalid
  const labelled = fc.labelledBy && !fp['aria-labelledby'] ? undefined : ariaLabel
  return (
    <div ref={box} className={cn('relative flex gap-2', className)} role="group" aria-label={labelled} aria-labelledby={labelled ? undefined : fc.labelledBy} aria-describedby={fc.control['aria-describedby']} id={fc.control.id} onBlur={fc.onBlur}>
      {vals.map((c, i) => (
        <input key={i} ref={el => { refs.current[i] = el; if (i === 0) formsAssignRef(ref, el) }} value={c} inputMode="numeric" autoComplete={i === 0 ? 'one-time-code' : 'off'} maxLength={1} aria-label={`Digit ${i + 1}`}
          disabled={fc.disabled} readOnly={fc.readOnly} aria-invalid={bad || undefined} onFocus={e => e.target.select()}
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
            formDisabledClass, formReadOnlyClass, status === 'ok' ? 'border-[var(--ok)] text-[var(--ok)]' : bad ? 'border-[var(--bad)]' : 'border-[var(--line)]')} />
      ))}
      {fc.inputs}
    </div>
  )
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
export function OptionList({ options, active, isSelected, onPick, onHover, id, multi, query, empty = 'No matches', label, className, virtualize = 100, busy }:
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
  if (!options.length) return <div ref={root} role="status" className={cn('p-3 text-center text-[13px] text-[var(--fg3)]', className)}>{empty}</div>
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

/** Open a list upward when there isn't room below the trigger. */
const formsPlacement = (el: HTMLElement | null, room = 270): Placement => {
  if (!el) return 'bottom-start'
  const r = el.getBoundingClientRect(), below = innerHeight - r.bottom
  return below < room && r.top > below ? 'top-start' : 'bottom-start'
}

/** Field triggers (Select, pickers): the shared field look plus the disabled, read-only and pointer states. */
const formsTriggerClass = cn(inputClass, formDisabledClass, 'flex items-center gap-2 text-start aria-readonly:cursor-default aria-readonly:bg-[var(--muted)] aria-readonly:hover:border-[var(--line)]')

/**
 * Custom select: arrows, Enter/Space, type-ahead that cycles through options starting with the typed letter
 * (works closed too), springs open, flips upward near the bottom of the viewport, checkmark on the current option.
 * Form-native: `name` submits the value ('' when none), `required`, `disabled`, `readOnly` (doesn't open), `invalid`,
 * `onBlur`, `form`, and `ref` on the trigger button. Long lists are virtualised.
 */
export function Select({ options, value, defaultValue, onChange, placeholder = 'Select…', className, 'aria-label': ariaLabel, icon, mono, ref, ...fp }: FormControlProps &
  { options: Option[]; value?: string; defaultValue?: string; onChange?: (v: string) => void; placeholder?: string; className?: string; 'aria-label'?: string
    /** leading icon in the trigger (TimePicker uses 'clock') */ icon?: IconName; mono?: boolean; ref?: Ref<HTMLButtonElement> }) {
  const btn = useRef<HTMLButtonElement>(null)
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
      <button type="button" ref={formsMergeRefs(btn, ref)} {...fc.control} role="combobox" aria-label={ariaLabel} aria-expanded={open} aria-haspopup="listbox" aria-controls={lid} aria-activedescendant={open ? `${lid}-${active}` : undefined}
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
export function Combobox({ options = [], loadOptions, debounce = 200, minChars = 0, defaultOptions, creatable, createLabel = q => `Create “${q}”`, onCreate, onInputChange,
  value, defaultValue, onChange, placeholder = 'Search…', empty = q => <>No matches for “{q}”</>, 'aria-label': ariaLabel, className, ref, ...fp }: FormControlProps & {
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
  const createOpt: Option | null = canCreate ? { value: query, label: createLabel(query), icon: 'plus' } : null
  const list = short ? [] : createOpt ? [...matches, createOpt] : matches
  const pick = (i: number) => {
    let o = list[i]; if (!o || o.disabled) return
    if (o === createOpt) { o = onCreate?.(query) || { value: query, label: query }; known.current.set(o.value, o); const made = o; setCreated(c => [...c.filter(x => x.value !== made.value), made]) }
    shownFor.current = o.value; set(o.value); setQ(o.label); setOpen(false); play(input.current, { scale: [0.98, 1] }, spring(0.4, 0.3))
  }
  const { active, setActive, onKeyDown } = useRoving(list.length, pick, { loop: false, homeEnd: false, isDisabled: i => !!list[i]?.disabled })
  const leading = chosen ? known.current.get(v)?.leading : undefined
  const retry = () => { reload(); input.current?.focus() }
  const message = short ? <>Type at least {minChars} character{minChars === 1 ? '' : 's'}</>
    : failed ? <span className="flex flex-col items-center gap-2"><span className="text-[var(--bad)]">Couldn’t load results</span>
      <Button size="xs" onPointerDown={e => e.preventDefault()} onClick={retry}>Retry</Button></span>
    : loading ? <span className="inline-flex items-center gap-2"><span aria-hidden className="grid"><Spinner size={13} /></span>Loading…</span>
    : empty(q)
  return (
    <div ref={wrap} className={cn('relative', className)} onBlur={fc.onBlur}>
      <span className="pointer-events-none absolute top-1/2 start-3 grid -translate-y-1/2 place-items-center text-[var(--fg3)]">
        {leading ? <motion.span key={v} initial={{ scale: 0.5 }} animate={{ scale: 1 }} transition={spring(0.5, 0.35)} className="text-sm leading-none">{leading}</motion.span> : <Icon name="search" size={14} />}
      </span>
      <input ref={formsMergeRefs(input, ref)} {...fc.control} role="combobox" aria-label={ariaLabel} aria-expanded={open} aria-controls={lid} aria-autocomplete="list" aria-activedescendant={open && list.length ? `${lid}-${active}` : undefined}
        aria-required={fc.required || undefined} disabled={fc.disabled} readOnly={fc.readOnly}
        value={q} placeholder={placeholder} autoComplete="off" className={cn(inputClass, formDisabledClass, formReadOnlyClass, '!ps-8', loading && '!pe-8')}
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
      <span className="sr-only" aria-live="polite">{open ? loading ? 'Loading results' : failed ? 'Couldn’t load results. Press Enter to retry.' : loadOptions && load.status === 'done' ? `${list.length} result${list.length === 1 ? '' : 's'}` : '' : ''}</span>
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
  const { t } = useLocale()
  return (
    <AnimatePresence initial={false} mode="popLayout">
      {values.map(x => {
        const o = optionOf(x), label = o?.label ?? x
        return (
          <motion.span key={x} layout initial={{ scale: 0.6, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.6, opacity: 0, transition: { duration: 0.12 } }} transition={spring(0.4, 0.35)}
            className={cn('inline-flex items-center gap-1.5 rounded-[var(--r-md)] py-0.5 ps-2 text-xs', locked ? 'bg-[var(--card)] pe-2 shadow-[inset_0_0_0_1px_var(--line)]' : 'bg-[var(--muted)] pe-1')}>
            {o?.dot && <span className="h-2 w-2 flex-none rounded-full" style={{ background: o.dot }} />}
            {label}
            {!locked && <button type="button" tabIndex={-1} aria-label={t('common.removeItem', { name: label })} className="ui-target cursor-pointer rounded-[var(--r-sm)] border-0 bg-transparent px-0.5 leading-none hover:bg-[var(--line)] text-[var(--fg3)] hover:text-[var(--fg)] [@media(pointer:coarse)]:-my-2 [@media(pointer:coarse)]:-me-1 [@media(pointer:coarse)]:min-h-8 [@media(pointer:coarse)]:min-w-8 [@media(pointer:coarse)]:text-base"
              onPointerDown={e => e.preventDefault()} onClick={e => { e.stopPropagation(); onRemove(x) }}>×</button>}
          </motion.span>
        )
      })}
    </AnimatePresence>
  )
}

/** MultiSelect over a fixed `options` list: the field itself is the combobox. */
function FormsMultiStatic({ options = [], value, defaultValue = [], onChange, placeholder = 'Select…', 'aria-label': ariaLabel, className, ref, ...rest }: MultiSelectProps) {
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
      <div ref={formsMergeRefs<HTMLDivElement>(box, ref as Ref<HTMLDivElement>)} {...fc.control} role="combobox" tabIndex={fc.disabled ? -1 : 0} aria-label={ariaLabel} aria-labelledby={ariaLabel ? undefined : fc.labelledBy} aria-expanded={open} aria-controls={lid} aria-haspopup="listbox"
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
        {v.length === 0 && <span className="text-[var(--fg3)]">{placeholder}</span>}
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
function FormsMultiAsync({ options = [], loadOptions, debounce = 200, minChars = 0, defaultOptions, creatable, createLabel = q => `Create “${q}”`, onCreate, onInputChange,
  empty = q => <>No matches for “{q}”</>, value, defaultValue = [], onChange, placeholder = 'Search…', 'aria-label': ariaLabel, className, ref, ...fp }: MultiSelectProps & { loadOptions: NonNullable<MultiSelectProps['loadOptions']> }) {
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
  const createOpt: Option | null = canCreate ? { value: '\u0000create', label: createLabel(query), icon: 'plus' } : null
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
  const retry = () => { reload(); input.current?.focus() }
  const message = short ? <>Type at least {minChars} character{minChars === 1 ? '' : 's'}</>
    : failed ? <span className="flex flex-col items-center gap-2"><span className="text-[var(--bad)]">Couldn’t load results</span>
      <Button size="xs" onPointerDown={e => e.preventDefault()} onClick={retry}>Retry</Button></span>
    : loading ? <span className="inline-flex items-center gap-2"><span aria-hidden className="grid"><Spinner size={13} /></span>Loading…</span>
    : empty(q)
  return (
    <div ref={wrap} className={cn('relative', className)} onBlur={fc.onBlur}>
      <div onPointerDown={e => { if (e.target !== input.current && !(e.target as HTMLElement).closest('button')) { e.preventDefault(); input.current?.focus() } }}
        className={cn(inputShellClass(fc.invalid), 'relative flex min-h-9 w-full flex-wrap items-center gap-1 py-1 ps-1.5 pe-8 text-[13px]',
          fc.disabled ? 'cursor-not-allowed bg-[var(--muted)] text-[var(--fg3)]' : fc.readOnly ? 'bg-[var(--muted)]' : 'cursor-text')}>
        <FormsChips values={v} optionOf={x => known.current.get(x)} locked={locked} onRemove={x => set(v.filter(y => y !== x))} />
        <input ref={formsMergeRefs<HTMLInputElement>(input, ref as Ref<HTMLInputElement>)} {...fc.control} role="combobox" aria-label={ariaLabel} aria-expanded={open} aria-controls={lid} aria-autocomplete="list"
          aria-activedescendant={open && list.length ? `${lid}-${active}` : undefined} aria-required={fc.required || undefined} disabled={fc.disabled} readOnly={fc.readOnly}
          value={q} placeholder={v.length ? '' : placeholder} autoComplete="off"
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
      <span className="sr-only" aria-live="polite">{open ? loading ? 'Loading results' : failed ? 'Couldn’t load results. Press Enter to retry.' : load.status === 'done' ? `${list.length} result${list.length === 1 ? '' : 's'}` : '' : ''}</span>
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

/* Dates ─────────────────────────────────────────────────────────────────────── */
//
// Values (README "Forms" has the FormData table):
//   Calendar, DatePicker, DateField  a local Date at midnight; submitted as "2026-11-08" (like <input type="date">)
//   DateRangePicker                  [start, end] local Dates; two fields "2026-11-01", "2026-11-07"
//   TimeField, TimePicker            "09:30" (24-hour wall time; "09:30:15" with granularity="second"); '' while empty
//   DateTimeField, DateTimePicker    ISO 8601 with the offset of `timeZone` at that instant: "2026-11-08T09:30:00+01:00"
//                                    (new Date(value) is the instant); null while empty, submitted as '' then
//   MonthPicker "2026-11" · YearPicker "2026" · TimeZonePicker "Europe/Zurich"
// Locale, week start, hour cycle and time zone default to useLocale() (UIProvider); props win.

/** Format a date ("8 Nov 2026" in en-GB); same as core `fmtDate`. Pass `locale` for another language. */
export const formatDate = (d?: Date | null, opts?: Intl.DateTimeFormatOptions, locale?: string) => fmtDate(d, opts, locale)

/** A date range [start, end]; either side may be null while it is being picked. */
export type DateRange = [Date | null, Date | null]
/** Wall-clock fields of a date and time (month 1–12), as `zonedParts` returns them. */
export type ZonedParts = { year: number; month: number; day: number; hour: number; minute: number; second: number }
/** How fine a date-time field goes: 'day' is the date alone, 'hour' | 'minute' (default) | 'second' add the time. */
export type DateGranularity = 'day' | 'hour' | 'minute' | 'second'

type DatesSegType = 'year' | 'month' | 'day' | 'hour' | 'minute' | 'second' | 'dayPeriod'
type DatesPart = { type: DatesSegType } | { type: 'literal'; text: string }
/** What each segment holds: `hour` as shown (1–12 on a 12-hour clock), `dayPeriod` 0 am / 1 pm. */
type DatesVals = Partial<Record<DatesSegType, number | null>>
const DATES_SEGS: string[] = ['year', 'month', 'day', 'hour', 'minute', 'second', 'dayPeriod']
const datesPad = (n: number, w = 2) => String(n).padStart(w, '0')
const datesLeap = (y: number) => y % 4 === 0 && (y % 100 !== 0 || y % 400 === 0)
/** Days in month `m` (1–12) of year `y`. */
const datesDim = (y: number, m: number) => m === 2 ? (datesLeap(y) ? 29 : 28) : [4, 6, 9, 11].includes(m) ? 30 : 31
/** A local Date at midnight (years below 100 stay as given instead of becoming 19xx). */
const datesLocal = (y: number, m: number, d: number) => { const t = new Date(2000, 0, 1); t.setFullYear(y, m - 1, d); return t }
/** Milliseconds of a wall time read as if it were UTC. */
const datesUTC = (w: ZonedParts) => { const t = new Date(Date.UTC(2000, 0, 1, w.hour, w.minute, w.second)); t.setUTCFullYear(w.year, w.month - 1, w.day); return +t }
const datesSafeZone = (tz: string) => { try { dateFormat('en-US', { timeZone: tz }); return tz } catch { return 'UTC' } }
const datesSafeLocale = (l: string) => { try { return Intl.getCanonicalLocales(l)[0] ?? LOCALE } catch { return LOCALE } }
const datesIs12 = (hc: string | number | undefined) => hc === 12 || hc === 'h11' || hc === 'h12'

const datesCache = new Map<string, unknown>()
function datesMemo<T>(k: string, make: () => T): T {
  if (!datesCache.has(k)) datesCache.set(k, make())
  return datesCache.get(k) as T
}

/** Wall-clock fields of the instant `at` in the IANA `timeZone`: zonedParts(Date.UTC(2026, 6, 1, 8), 'Europe/London').hour → 9. */
export function zonedParts(at: Date | number, timeZone: string): ZonedParts {
  const f = dateFormat('en-US', { timeZone: datesSafeZone(timeZone), hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric' })
  const o: Record<string, number> = {}
  for (const p of f.formatToParts(at)) if (p.type !== 'literal') o[p.type] = Number(p.value)
  return { year: o.year, month: o.month, day: o.day, hour: o.hour % 24, minute: o.minute, second: o.second }
}
/** UTC offset of `timeZone` at `at`, in minutes east of UTC (Europe/London: 0 in winter, 60 in summer). */
export function zoneOffset(timeZone: string, at: Date | number = Date.now()): number {
  const t = Math.floor(+at / 1000) * 1000
  return Math.round((datesUTC(zonedParts(t, timeZone)) - t) / 6e4)
}
/**
 * The instant a wall-clock time names in `timeZone`. A time the clocks skip moves forward by the gap (01:30 on the
 * spring-forward night in London is 02:30 BST); a time that happens twice is the first one (still summer time), like
 * Temporal's 'compatible'. zonedDate({ year: 2026, month: 11, day: 8, hour: 9, minute: 30 }, 'Europe/Zurich').
 */
export function zonedDate(wall: Partial<ZonedParts> & { year: number; month: number; day: number }, timeZone: string): Date {
  const w: ZonedParts = { hour: 0, minute: 0, second: 0, ...wall }
  const u = datesUTC(w), before = zoneOffset(timeZone, u - 864e5), after = zoneOffset(timeZone, u + 864e5)
  const hits = [...new Set([before, after])].map(o => u - o * 6e4).filter(t => zoneOffset(timeZone, t) === Math.round((u - t) / 6e4)).sort((a, b) => a - b)
  return new Date(hits[0] ?? u - before * 6e4)
}
const datesOffsetText = (min: number) => `${min < 0 ? '-' : '+'}${datesPad(Math.floor(Math.abs(min) / 60))}:${datesPad(Math.abs(min) % 60)}`
/** ISO 8601 with the zone's offset at that instant: toZonedISO(date, 'Europe/Zurich') → "2026-11-08T09:30:00+01:00". */
export function toZonedISO(at: Date | number, timeZone: string): string {
  const w = zonedParts(at, timeZone)
  return `${datesPad(w.year, 4)}-${datesPad(w.month)}-${datesPad(w.day)}T${datesPad(w.hour)}:${datesPad(w.minute)}:${datesPad(w.second)}${datesOffsetText(zoneOffset(timeZone, at))}`
}

const DATES_ISO = /^\s*(\d{4,})-(\d{1,2})-(\d{1,2})(?:[T\s](\d{1,2}):(\d{2})(?::(\d{2})(?:[.,]\d+)?)?)?\s*(Z|[+-]\d{2}(?::?\d{2})?)?(?:\[[^\]]*\])?\s*$/i
const DATES_ISO_TIME = /^\s*T?(\d{1,2}):(\d{2})(?::(\d{2})(?:[.,]\d+)?)?\s*$/i
/** "2026-11-08", "2026-11-08T09:30", "…+01:00" or "…Z": the wall fields, whether a time was given, and the instant when an offset was. */
function datesParseISO(s: string): { wall: ZonedParts; time: boolean; at?: number } | null {
  const m = DATES_ISO.exec(s)
  if (!m) return null
  const wall = { year: +m[1], month: +m[2], day: +m[3], hour: +(m[4] ?? 0), minute: +(m[5] ?? 0), second: +(m[6] ?? 0) }
  if (wall.month < 1 || wall.month > 12 || wall.day < 1 || wall.day > datesDim(wall.year, wall.month) || wall.hour > 23 || wall.minute > 59 || wall.second > 59) return null
  let at: number | undefined
  if (m[7]) {
    const z = m[7].toUpperCase(), digits = z.slice(1).replace(':', '')
    at = datesUTC(wall) - (z === 'Z' ? 0 : (z[0] === '-' ? -1 : 1) * (+digits.slice(0, 2) * 60 + +(digits.slice(2, 4) || 0))) * 6e4
  }
  return { wall, time: m[4] !== undefined, at }
}

/** A Gregorian Intl.DateTimeFormat (cached), whatever calendar the locale uses by default. */
const datesDF = (locale: string, o: Intl.DateTimeFormatOptions) => dateFormat(locale, { calendar: 'gregory', ...o })
/** `n` in the locale's digits, zero-padded to `width` (ar-EG: ٠٨). */
const datesNum = (locale: string, n: number, width = 1) => numberFormat(locale, { useGrouping: false, minimumIntegerDigits: width }).format(n)
/** Arabic-Indic, Persian and full-width digits to ASCII, for typing and pasting. */
const datesAscii = (s: string) => s.replace(/[٠-٩۰-۹０-９]/g, c => {
  const k = c.charCodeAt(0)
  return String(k - (k >= 0xff10 ? 0xff10 : k >= 0x06f0 ? 0x06f0 : 0x0660))
})
/** Weekday names, Sunday first: short (narrow where short names run long, as in Arabic) and long. */
const datesWeekdays = (locale: string) => datesMemo(`wd${locale}`, () => {
  const names = (weekday: 'short' | 'narrow' | 'long') => Array.from({ length: 7 }, (_, i) => datesDF(locale, { weekday, timeZone: 'UTC' }).format(Date.UTC(2024, 0, 7 + i)))
  const short = names('short')
  return { short: short.some(s => s.length > 4) ? names('narrow') : short, long: names('long') }
})
const datesMonthNames = (locale: string, month: 'short' | 'long') => datesMemo(`mo${locale}${month}`, () =>
  Array.from({ length: 12 }, (_, i) => datesDF(locale, { month, timeZone: 'UTC' }).format(Date.UTC(2024, i, 15))))
/** The locale's am/pm words: ["AM", "PM"], ["午前", "午後"], ["ص", "م"]. */
const datesPeriods = (locale: string) => datesMemo(`dp${locale}`, () => [1, 13].map(h =>
  datesDF(locale, { hour: 'numeric', hourCycle: 'h12', timeZone: 'UTC' }).formatToParts(Date.UTC(2024, 0, 1, h)).find(p => p.type === 'dayPeriod')?.value ?? (h < 12 ? 'AM' : 'PM')))
const DATES_FIELD_EN: Record<DatesSegType, string> = { year: 'Year', month: 'Month', day: 'Day', hour: 'Hour', minute: 'Minute', second: 'Second', dayPeriod: 'AM/PM' }
/** A segment's localised name ("Day", "Tag", "日"), its accessible name. */
const datesFieldName = (locale: string, t: DatesSegType) => datesMemo(`fn${locale}${t}`, () => {
  try { const s = new Intl.DisplayNames(locale, { type: 'dateTimeField' }).of(t); if (s) return s[0].toLocaleUpperCase(locale) + s.slice(1) } catch { /* old engine */ }
  return DATES_FIELD_EN[t]
})
/** An empty segment's placeholder: "dd", "mm", "yyyy" (de-DE "tt.mm.jjjj"); dashes where the field name isn't Latin, and for the time. */
const datesPlaceholder = (locale: string, t: DatesSegType) => datesMemo(`ph${locale}${t}`, () => {
  const n = t === 'year' ? 4 : 2, c = datesFieldName(locale, t)[0].toLowerCase()
  return (t === 'year' || t === 'month' || t === 'day') && /[a-z]/.test(c) ? c.repeat(n) : '–'.repeat(n)
})
/** The zone's short name at an instant in the locale: "GMT", "BST", "CET", "GMT-5". */
const datesZoneName = (locale: string, timeZone: string, at: number) =>
  datesDF(locale, { timeZone, timeZoneName: 'short' }).formatToParts(at).find(p => p.type === 'timeZoneName')?.value ?? timeZone

/** The locale's segments and separators: en-GB dd/mm/yyyy, en-US mm/dd/yyyy, de-DE dd.mm.yyyy, ja-JP yyyy/mm/dd, then the time. */
function datesTemplate(locale: string, date: boolean, gran: DateGranularity | null, h12: boolean): DatesPart[] {
  const o: Intl.DateTimeFormatOptions = { timeZone: 'UTC' }
  if (date) Object.assign(o, { year: 'numeric', month: '2-digit', day: '2-digit' })
  if (gran && gran !== 'day') {
    o.hour = '2-digit'; o.hourCycle = h12 ? 'h12' : 'h23'
    if (gran !== 'hour') o.minute = '2-digit'
    if (gran === 'second') o.second = '2-digit'
  }
  return datesMemo(`tp${locale}${JSON.stringify(o)}`, () => {
    const out: DatesPart[] = []
    for (const p of datesDF(locale, o).formatToParts(Date.UTC(2026, 10, 8, 21, 5, 7))) {
      if (DATES_SEGS.includes(p.type)) { out.push({ type: p.type as DatesSegType }); continue }
      const text = p.value.replace(/[‎‏؜]/g, ''), prev = out[out.length - 1]
      if (!text) continue
      if (prev?.type === 'literal') prev.text += text
      else out.push({ type: 'literal', text })
    }
    while (out[0]?.type === 'literal') out.shift()
    while (out[out.length - 1]?.type === 'literal') out.pop()
    return out
  })
}
const datesShown = (tpl: DatesPart[]) => tpl.flatMap(p => p.type === 'literal' ? [] : [p.type])
/** A segment's [min, max]; the day's max follows the month (and year) once they are known. */
function datesRange(t: DatesSegType, v: DatesVals, h12: boolean): [number, number] {
  if (t === 'year') return [1, 9999]
  if (t === 'month') return [1, 12]
  if (t === 'day') return [1, v.month ? datesDim(v.year ?? 2024, v.month) : 31]
  if (t === 'hour') return h12 ? [1, 12] : [0, 23]
  if (t === 'dayPeriod') return [0, 1]
  return [0, 59]
}
const datesToVals = (w: Partial<ZonedParts> | null | undefined, h12: boolean): DatesVals => !w ? {} : {
  year: w.year, month: w.month, day: w.day, minute: w.minute, second: w.second,
  ...(w.hour != null && { hour: h12 ? w.hour % 12 || 12 : w.hour, dayPeriod: w.hour >= 12 ? 1 : 0 }),
}
/** The wall time the segments spell, or null while a shown segment is empty or the year has fewer than 4 digits. The day is clamped to the month. */
function datesFromVals(v: DatesVals, tpl: DatesPart[], h12: boolean): ZonedParts | null {
  const shown = datesShown(tpl), has = (t: DatesSegType) => shown.includes(t)
  if (shown.some(t => v[t] == null) || (has('year') && v.year! < 1000)) return null
  const year = has('year') ? v.year! : 2000, month = has('month') ? v.month! : 1
  return {
    year, month, day: has('day') ? Math.min(v.day!, datesDim(year, month)) : 1,
    hour: !has('hour') ? 0 : h12 ? (v.hour! % 12) + (v.dayPeriod ? 12 : 0) : v.hour!, minute: has('minute') ? v.minute! : 0, second: has('second') ? v.second! : 0,
  }
}
const datesAnyVal = (v: DatesVals, tpl: DatesPart[]) => datesShown(tpl).some(t => v[t] != null)

/**
 * Read pasted text: ISO first ("2026-11-08", "09:30", "2026-11-08T09:30"), else the numbers in the field's own order
 * ("08.11.2026 09:30" in de-DE, "11/8/2026, 9:30 PM" in en-US). Two-digit years become 20xx.
 */
function datesParseText(text: string, tpl: DatesPart[], locale: string, h12: boolean): DatesVals | null {
  const s = datesAscii(text).trim(), shown = datesShown(tpl)
  const iso = datesParseISO(s)
  if (iso) return datesToVals(iso.time || !shown.includes('year') ? iso.wall : { year: iso.wall.year, month: iso.wall.month, day: iso.wall.day }, h12)
  const tm = !shown.includes('year') && DATES_ISO_TIME.exec(s)
  const tokens = tm ? [tm[1], tm[2], tm[3] ?? '0'] : s.match(/\d+/g) ?? []
  if (!tokens.length) return null
  const v: DatesVals = {}
  shown.filter(t => t !== 'dayPeriod').forEach((t, i) => {
    const tok = tokens[i]
    if (tok === undefined) return
    v[t] = t === 'year' && tok.length <= 2 ? 2000 + Number(tok) : Number(tok)
  })
  if (v.hour != null && (h12 || shown.includes('dayPeriod'))) {
    const low = s.toLocaleLowerCase(locale), [am, pm] = datesPeriods(locale).map(x => x.toLocaleLowerCase(locale))
    const isPm = low.includes(pm) || /\bp\.?\s?m\b/.test(low), isAm = low.includes(am) || /\ba\.?\s?m\b/.test(low)
    if (v.hour > 12) { v.dayPeriod = 1; v.hour -= 12 } else if (v.hour === 0) { v.hour = 12; v.dayPeriod = 0 } else v.dayPeriod = isPm ? 1 : isAm ? 0 : v.hour === 12 ? 1 : 0
  }
  for (const t of shown) {
    const n = v[t]
    if (n == null) continue
    const [lo, hi] = datesRange(t, v, h12)
    if (n < lo || n > hi) return null
  }
  return v
}

/** Locale, week start, clock and zone for the date controls: props first, then useLocale() (UIProvider), then the runtime's zone. */
function useDatesLocale(p: { locale?: string; weekStartsOn?: number; timeZone?: string; hourCycle?: 12 | 24 | HourCycle }) {
  const ctx = useLocale()
  const locale = datesSafeLocale(p.locale ?? ctx.locale)
  const weekStartsOn = ((p.weekStartsOn ?? (p.locale ? localeWeekStart(locale) : ctx.weekStartsOn)) % 7) as WeekDay
  const h12 = datesIs12(p.hourCycle ?? (p.locale ? localeHourCycle(locale) : ctx.hourCycle))
  // the runtime's zone after hydration (the server renders UTC), so server and client markup match
  const runtimeZone = useSyncExternalStore(datesNoSubscribe, datesRuntimeZone, () => 'UTC')
  const timeZone = datesSafeZone(p.timeZone ?? ctx.timeZone ?? runtimeZone)
  /** A built-in message (UIProvider `messages` override it) or one of the date controls' own keys with its English text. */
  const t = (key: string, en: string, vars?: MessageVars) => key in UI_MESSAGES_EN ? ctx.t(key, vars) : formatMessage(ctx.messages[key] ?? en, vars, locale)
  return { locale, weekStartsOn, h12, timeZone, t }
}
type DatesL = ReturnType<typeof useDatesLocale>
const datesNoSubscribe = () => () => {}
const datesRuntimeZone = () => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC' } catch { return 'UTC' } }
/** Today's date, read after mount (null on the server and in the first render) so server and client markup match. */
function useDatesToday() {
  const [today, setToday] = useState<Date | null>(null)
  useEffect(() => { setToday(startOfDay(new Date())) }, [])
  return today
}

/** Why a picked day isn't allowed (outside min/max, or unavailable), as a message; null when it's fine. */
function datesDayProblem(d: Date | null | undefined, c: { min?: Date | null; max?: Date | null; isDateUnavailable?: (d: Date) => boolean }, L: DatesL): string | null {
  if (!d) return null
  const f = (x: Date) => datesDF(L.locale, { day: 'numeric', month: 'long', year: 'numeric' }).format(x)
  if (c.min && d < startOfDay(c.min)) return L.t('date.tooEarly', 'Choose {date} or later', { date: f(c.min) })
  if (c.max && d > startOfDay(c.max)) return L.t('date.tooLate', 'Choose {date} or earlier', { date: f(c.max) })
  if (c.isDateUnavailable?.(d)) return L.t('date.unavailable', 'That date isn’t available')
  return null
}

/**
 * A visually hidden input the browser validates with a custom message (an incomplete, out-of-range or unavailable
 * date), so native validation and Form show it under the field and stop the submit; when validation focuses it, focus
 * goes to the real control. Renders nothing while there is no problem.
 */
function DatesValidity({ message, name, form, focus, onInvalid }: { message: string | null; name?: string; form?: string; focus: () => void; onInvalid: () => void }) {
  if (!message) return null
  return (
    <input ref={el => el?.setCustomValidity(message)} tabIndex={-1} aria-hidden form={form} data-ui-field={name} value="x" onChange={() => {}} onFocus={focus} onInvalid={onInvalid}
      className="pointer-events-none absolute start-2 bottom-0 m-0 h-px w-px appearance-none border-0 p-0 opacity-0" />
  )
}

type DatesSegmentsProps = {
  tpl: DatesPart[]; vals: DatesVals; onVals: (v: DatesVals) => void; locale: string; h12: boolean
  /** where ↑/↓ start from in an empty segment (today, midnight) */ seed: () => DatesVals
  /** paste parser; the default reads ISO and the locale's own format */ parse?: (text: string) => DatesVals | null
  disabled: boolean; readOnly: boolean; invalid: boolean; required: boolean; /** aria-valuetext of an empty segment */ emptyText: string
  id?: string; labelledBy?: string; 'aria-label'?: string; describedBy?: string; inputRef?: Ref<HTMLInputElement>
  icon?: IconName; suffix?: ReactNode; children?: ReactNode; className?: string
  onKeyDown?: (e: RKeyboardEvent<HTMLDivElement>) => void; onFocusChange?: (within: boolean) => void
}

/**
 * The segment row behind DateField, TimeField and DateTimeField: one spinbutton input per segment, in the locale's
 * order, with its separators. Digits fill a segment and move on once it can't take another; ↑/↓ step it (wrapping),
 * PageUp/PageDown in bigger steps, Home/End to its ends; ←/→ (mirrored in RTL) and separator keys move between segments;
 * Backspace clears digit by digit, then moves back. Paste fills every segment. Typed digits may be Arabic-Indic or full-width.
 */
function DatesSegments(p: DatesSegmentsProps) {
  const uid = useId(), gid = `${uid}g`
  const refs = useRef<(HTMLInputElement | null)[]>([])
  const [buf, setBuf] = useState<{ t: DatesSegType; s: string } | null>(null)
  const segs = datesShown(p.tpl)
  const locked = p.disabled || p.readOnly
  const { vals, locale, h12 } = p
  const periods = datesPeriods(locale)
  const focusAt = (i: number) => { const el = refs.current[Math.max(0, Math.min(segs.length - 1, i))]; el?.focus(); el?.select() }
  const put = (t: DatesSegType, n: number | null) => p.onVals({ ...vals, [t]: n })
  const digit = (i: number, t: DatesSegType, d: string) => {
    const [lo, hi] = datesRange(t, vals, h12), max = t === 'year' ? 4 : String(hi).length
    const live = buf?.t === t && (vals[t] ?? null) === (Number(buf.s) >= lo ? Number(buf.s) : null)
    let s = (live ? buf.s : '') + d
    if (Number(s) > hi || s.length > max) s = d
    const n = Number(s), ok = n >= lo
    put(t, ok ? n : null)
    if (s.length >= max || n * 10 > hi) { setBuf(null); if (ok) focusAt(i + 1) } else setBuf({ t, s })
  }
  const period = (i: number, c: string) => {
    const k = c.toLocaleLowerCase(locale), [am, pm] = periods.map(x => x.toLocaleLowerCase(locale))
    const n = k === 'a' || am.startsWith(k) ? 0 : k === 'p' || pm.startsWith(k) ? 1 : -1
    if (n >= 0) { setBuf(null); put('dayPeriod', n); focusAt(i + 1) }
  }
  const seps = p.tpl.map(x => x.type === 'literal' ? x.text : '').join('') + '/.-:, '
  const char = (i: number, t: DatesSegType, raw: string) => {
    const c = datesAscii(raw)
    if (t === 'dayPeriod') period(i, c)
    else if (/\d/.test(c)) digit(i, t, c)
    else if (seps.includes(c)) { if (vals[t] != null) { setBuf(null); focusAt(i + 1) } }
    else if (segs.includes('dayPeriod')) period(segs.indexOf('dayPeriod'), c) // "9 p" sets pm from the hour
  }
  const step = (t: DatesSegType, key: string) => {
    const [lo, hi] = datesRange(t, vals, h12), cur = vals[t], size = hi - lo + 1
    const big: Record<DatesSegType, number> = { year: 10, month: 3, day: 7, hour: h12 ? 3 : 6, minute: 15, second: 15, dayPeriod: 1 }
    let n: number
    if (key === 'Home' || key === 'End') { if (t === 'year') return; n = key === 'Home' ? lo : hi }
    else if (cur == null) n = Math.min(hi, Math.max(lo, p.seed()[t] ?? lo))
    else {
      const d = key === 'ArrowUp' ? 1 : key === 'ArrowDown' ? -1 : key === 'PageUp' ? big[t] : -big[t]
      n = t === 'year' ? Math.min(hi, Math.max(lo, cur + d)) : lo + ((((cur - lo + d) % size) + size) % size)
    }
    setBuf(null); put(t, n)
  }
  const back = (i: number, t: DatesSegType) => {
    if (t === 'dayPeriod') { if (vals.dayPeriod == null) focusAt(i - 1); else put(t, null); return }
    const cur = buf?.t === t ? buf.s : vals[t] == null ? '' : String(vals[t])
    if (!cur) { setBuf(null); focusAt(i - 1); return }
    const s = cur.slice(0, -1), [lo] = datesRange(t, vals, h12)
    setBuf(s ? { t, s } : null); put(t, s && Number(s) >= lo ? Number(s) : null)
  }
  const onKey = (e: RKeyboardEvent<HTMLInputElement>, i: number, t: DatesSegType) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return
    const k = e.key
    if (k === 'ArrowLeft' || k === 'ArrowRight') {
      e.preventDefault()
      const rtl = getComputedStyle(e.currentTarget).direction === 'rtl'
      focusAt(i + (logicalArrow(k, rtl ? 'rtl' : 'ltr') === 'ArrowRight' ? 1 : -1))
      return
    }
    if (['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End'].includes(k)) { e.preventDefault(); if (!locked) step(t, k); return }
    if (k === 'Backspace' || k === 'Delete') { e.preventDefault(); if (locked) return; if (k === 'Delete') { setBuf(null); put(t, null) } else back(i, t); return }
    if (k.length !== 1 || e.nativeEvent.isComposing) return
    e.preventDefault()
    if (!locked) char(i, t, k)
  }
  // touch keyboards send no usable keydown: read what was inserted (or deleted) from the input event instead
  const onChange = (e: React.ChangeEvent<HTMLInputElement>, i: number, t: DatesSegType) => {
    if (locked) return
    const ne = e.nativeEvent as InputEvent
    if (ne.inputType?.startsWith('delete')) return back(i, t)
    const d = ne.data ?? e.target.value.slice(-1)
    if (d) char(i, t, d.slice(-1))
  }
  const onPaste = (e: React.ClipboardEvent<HTMLInputElement>) => {
    e.preventDefault()
    if (locked) return
    const text = e.clipboardData.getData('text')
    const v = p.parse ? p.parse(text) : datesParseText(text, p.tpl, locale, h12)
    if (v) { setBuf(null); p.onVals({ ...vals, ...v }) }
  }
  const shown = (t: DatesSegType) => {
    if (t === 'dayPeriod') return vals.dayPeriod == null ? '' : periods[vals.dayPeriod]
    const v = vals[t]
    // typed digits show as typed ("2", "20" in the year) while they still match the value (a reset or outside change wins)
    if (buf?.t === t && (v ?? null) === (Number(buf.s) >= datesRange(t, vals, h12)[0] ? Number(buf.s) : null)) return [...buf.s].map(c => datesNum(locale, Number(c))).join('')
    return v == null ? '' : datesNum(locale, v, t === 'year' ? 4 : 2)
  }
  const empty = !datesAnyVal(vals, p.tpl)
  const labelRef = p['aria-label'] ? gid : p.labelledBy
  return (
    <div role="group" id={gid} aria-label={p['aria-label']} aria-labelledby={p['aria-label'] ? undefined : p.labelledBy} aria-disabled={p.disabled || undefined} onKeyDown={p.onKeyDown}
      onFocus={() => p.onFocusChange?.(true)}
      onBlur={e => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) { setBuf(null); p.onFocusChange?.(false) } }}
      onPointerDown={e => { // a press on the padding or a separator lands in the first empty segment
        if ((e.target as HTMLElement).closest('input,button')) return
        e.preventDefault()
        if (!p.disabled) focusAt(Math.max(0, segs.findIndex(t => vals[t] == null)))
      }}
      className={cn(inputShellClass(p.invalid), 'relative flex h-9 w-full min-w-0 items-center gap-2 ps-3 pe-2 text-[13px] [@media(pointer:coarse)]:h-10 [@media(pointer:coarse)]:text-base',
        p.disabled ? 'cursor-not-allowed bg-[var(--muted)] text-[var(--fg3)]' : p.readOnly ? 'bg-[var(--muted)]' : 'cursor-text', p.className)}>
      {p.icon && <Icon name={p.icon} size={15} className="flex-none text-[var(--fg3)]" />}
      <div className="flex min-w-0 flex-1 items-center overflow-x-auto whitespace-nowrap [scrollbar-width:none]">
        {p.tpl.map((x, k) => {
          if (x.type === 'literal') return <span key={k} aria-hidden className={cn('whitespace-pre', empty && 'text-[var(--fg3)]')}>{x.text}</span>
          const t = x.type, i = segs.indexOf(t), [lo, hi] = datesRange(t, vals, h12), text = shown(t)
          const ph = datesPlaceholder(locale, t), sid = i === 0 && p.id ? p.id : `${uid}${t}`
          const widest = t === 'dayPeriod' ? periods.reduce((a, b) => (a.length >= b.length ? a : b)) : datesNum(locale, 0, t === 'year' ? 4 : 2)
          return (
            <span key={k} className="relative inline-block">
              <span aria-hidden className="invisible px-0.5 whitespace-pre tabular-nums">{text ? widest : ph}</span>
              <input ref={el => { refs.current[i] = el; if (i === 0) formsAssignRef(p.inputRef, el) }} id={sid} role="spinbutton"
                inputMode={t === 'dayPeriod' ? 'text' : 'numeric'} enterKeyHint="next" autoComplete="off" autoCorrect="off" spellCheck={false}
                aria-label={datesFieldName(locale, t)} aria-labelledby={labelRef ? `${labelRef} ${sid}` : undefined}
                aria-valuenow={vals[t] ?? undefined} aria-valuemin={lo} aria-valuemax={hi} aria-valuetext={text || p.emptyText}
                aria-invalid={p.invalid || undefined} aria-describedby={p.describedBy} aria-required={p.required || undefined} aria-readonly={p.readOnly || undefined}
                disabled={p.disabled} readOnly={p.readOnly} value={text} placeholder={ph}
                onKeyDown={e => onKey(e, i, t)} onChange={e => onChange(e, i, t)} onPaste={onPaste}
                onFocus={e => e.currentTarget.select()} onClick={e => e.currentTarget.select()} onBlur={() => setBuf(b => (b?.t === t ? null : b))}
                size={1} className="absolute inset-0 h-full w-full min-w-0 rounded-[var(--r-sm)] border-0 bg-transparent p-0 text-center tabular-nums [color:inherit] caret-transparent outline-none selection:bg-transparent placeholder:text-[var(--fg3)] focus:bg-[var(--primary)] focus:text-[var(--on-primary)] focus:placeholder:text-[var(--on-primary)] disabled:cursor-not-allowed" />
            </span>
          )
        })}
      </div>
      {p.suffix}
      {p.children}
    </div>
  )
}

/** How a field's value maps to wall-clock fields and back. `key` compares values (it is what changed means). */
type DatesConv<T> = { toWall: (v: T) => Partial<ZonedParts> | null; fromWall: (w: ZonedParts) => T; key: (v: T) => string; empty: T }

/**
 * Segment state for a field whose value is a T: keeps typed but incomplete segments, emits a value once every
 * segment is filled (and the empty value when a filled one is cleared), shows the value back (a clamped day, a time
 * moved past a daylight-saving gap), and re-reads it when it changes from outside or `sync` (locale, clock, zone) changes.
 */
function useDatesSegValue<T>(fc: { value: T; set: (v: T) => void }, conv: DatesConv<T>, tpl: DatesPart[], h12: boolean, sync: string) {
  const read = (v: T) => datesToVals(conv.toWall(v), h12)
  const [vals, setVals] = useState(() => read(fc.value))
  const k = conv.key(fc.value), seen = useRef(`${k}|${sync}`)
  useEffect(() => {
    if (seen.current === `${k}|${sync}`) return
    seen.current = `${k}|${sync}`; setVals(read(fc.value))
  }, [k, sync]) // eslint-disable-line react-hooks/exhaustive-deps
  const onVals = (v: DatesVals) => {
    const w = datesFromVals(v, tpl, h12)
    if (!w) {
      setVals(v)
      const ek = conv.key(conv.empty)
      if (k !== ek) { seen.current = `${ek}|${sync}`; fc.set(conv.empty) }
      return
    }
    const next = conv.fromWall(w), nk = conv.key(next)
    setVals({ ...v, ...read(next) })
    if (nk !== k) { seen.current = `${nk}|${sync}`; fc.set(next) }
  }
  const resetTo = (v: T) => { seen.current = `${conv.key(v)}|${sync}`; setVals(read(v)) }
  const wall = datesFromVals(vals, tpl, h12)
  return { vals, onVals, resetTo, wall, partial: !wall && datesAnyVal(vals, tpl) }
}
/** Today at midnight as segment values, where ↑/↓ start in an empty segment. */
const datesSeed = (h12: boolean) => () => { const n = new Date(); return datesToVals({ year: n.getFullYear(), month: n.getMonth() + 1, day: n.getDate(), hour: 0, minute: 0, second: 0 }, h12) }
const DATES_DAY_CONV: DatesConv<Date | null> = {
  toWall: d => (d ? { year: d.getFullYear(), month: d.getMonth() + 1, day: d.getDate() } : null),
  fromWall: w => datesLocal(w.year, w.month, w.day), key: d => (d ? formDate(d) : ''), empty: null,
}

/* Calendar ───────────────────────────────────────────────────────────────────── */

/** Prev/next arrows plus a title (a button when it opens the next level up), shared by the month and year grids. */
function DatesNavHeader({ title, onTitle, titleLabel, onPrev, onNext, prevLabel, nextLabel, prevDisabled, nextDisabled }: {
  title: string; onTitle?: () => void; titleLabel?: string; onPrev: () => void; onNext: () => void; prevLabel: string; nextLabel: string; prevDisabled?: boolean; nextDisabled?: boolean }) {
  return (
    <div className="mb-2 flex h-7 flex-none items-center justify-between [@media(pointer:coarse)]:h-9">
      <IconButton icon={<Icon name="chevronLeft" size={15} className="ui-flip" />} label={prevLabel} onClick={onPrev} disabled={prevDisabled} className="[@media(pointer:coarse)]:!h-9 [@media(pointer:coarse)]:!w-9" />
      {onTitle ? <button type="button" onClick={onTitle} aria-label={titleLabel} className={DATES_CAPTION}>{title}<Icon name="chevronDown" size={13} className="text-[var(--fg3)]" /></button>
        : <span className="text-[13px] font-semibold">{title}</span>}
      <IconButton icon={<Icon name="chevronRight" size={15} className="ui-flip" />} label={nextLabel} onClick={onNext} disabled={nextDisabled} className="[@media(pointer:coarse)]:!h-9 [@media(pointer:coarse)]:!w-9" />
    </div>
  )
}
const DATES_CAPTION = 'inline-flex h-7 cursor-pointer items-center gap-1 rounded-[var(--r-md)] border-0 bg-transparent px-2 text-[13px] font-semibold text-[var(--fg)] hover:bg-[var(--muted)] [@media(pointer:coarse)]:h-9'
const DATES_TILE = 'cursor-pointer rounded-[var(--r-md)] border-0 bg-transparent text-[13px] text-[var(--fg)] transition-colors hover:bg-[var(--muted)] aria-pressed:bg-[var(--primary)] aria-pressed:font-semibold aria-pressed:text-[var(--on-primary)] ' +
  'aria-disabled:cursor-default aria-disabled:text-[var(--fg3)] aria-disabled:line-through aria-disabled:hover:bg-transparent [@media(pointer:coarse)]:text-sm'

/** Arrow-key moves in a 3-column grid of 12 tiles: ←/→ (mirrored in RTL) by one, ↑/↓ by a row, Home/End to the ends. */
const datesTileMove = (e: RKeyboardEvent, i: number) => {
  const rtl = getComputedStyle(e.currentTarget).direction === 'rtl', k = logicalArrow(e.key, rtl ? 'rtl' : 'ltr')
  return k === 'ArrowLeft' ? i - 1 : k === 'ArrowRight' ? i + 1 : k === 'ArrowUp' ? i - 3 : k === 'ArrowDown' ? i + 3 : k === 'Home' ? 0 : k === 'End' ? 11 : null
}

/**
 * Twelve months of `year` to pick from (the calendar's quick picker, and MonthPicker). The title opens the year grid;
 * arrows move, PageUp/PageDown change the year, Enter picks, Escape goes back. Months wholly outside min/max are disabled.
 */
function DatesMonthGrid({ locale, year, onYear, selected, onPick, min, max, onTitle, onEscape, t }: {
  locale: string; year: number; onYear: (y: number) => void; selected?: { year: number; month: number } | null; onPick: (month: number) => void
  min?: Date | null; max?: Date | null; onTitle?: () => void; onEscape?: () => void; t: DatesL['t'] }) {
  const names = datesMonthNames(locale, 'short'), long = datesMonthNames(locale, 'long')
  const off = (m: number) => !!((min && new Date(year, m + 1, 0) < startOfDay(min)) || (max && new Date(year, m, 1) > max))
  const [active, setActive] = useState(() => selected && selected.year === year ? selected.month : 0)
  const refs = useRef<(HTMLButtonElement | null)[]>([])
  useEffect(() => { refs.current[active]?.focus({ preventScroll: true }) }, []) // eslint-disable-line react-hooks/exhaustive-deps
  const go = (i: number) => { const j = Math.max(0, Math.min(11, i)); setActive(j); refs.current[j]?.focus() }
  return (
    <div className="flex h-full flex-col" onKeyDown={e => {
      if (e.key === 'Escape' && onEscape) { e.stopPropagation(); onEscape(); return }
      if (e.key === 'PageUp' || e.key === 'PageDown') { e.preventDefault(); onYear(year + (e.key === 'PageUp' ? -1 : 1)); return }
      if (!(e.target as HTMLElement).dataset.tile) return
      const n = datesTileMove(e, active)
      if (n !== null) { e.preventDefault(); go(n) }
    }}>
      <DatesNavHeader title={datesNum(locale, year)} onTitle={onTitle} titleLabel={t('date.chooseYear', '{year}, choose year', { year: datesNum(locale, year) })}
        onPrev={() => onYear(year - 1)} onNext={() => onYear(year + 1)} prevLabel={t('date.previousYear', 'Previous year')} nextLabel={t('date.nextYear', 'Next year')}
        prevDisabled={!!min && year <= min.getFullYear()} nextDisabled={!!max && year >= max.getFullYear()} />
      <div role="group" aria-label={datesNum(locale, year)} className="grid flex-1 grid-cols-3 grid-rows-4 gap-1">
        {names.map((n, m) => (
          <button key={m} type="button" data-tile ref={el => { refs.current[m] = el }} tabIndex={m === active ? 0 : -1}
            aria-pressed={!!selected && selected.year === year && selected.month === m} aria-disabled={off(m) || undefined}
            onFocus={() => setActive(m)} onClick={() => { if (!off(m)) onPick(m) }} className={DATES_TILE}>
            <span aria-hidden>{n}</span><span className="sr-only">{long[m]} {datesNum(locale, year)}</span></button>
        ))}
      </div>
    </div>
  )
}

/** Twelve years per page to pick from (the calendar's quick picker, and YearPicker). Arrows move (paging at the edges), PageUp/PageDown page, Escape goes back. */
function DatesYearGrid({ locale, year, selected, onPick, min, max, onEscape, t }: {
  locale: string; year: number; selected?: number | null; onPick: (y: number) => void; min?: Date | null; max?: Date | null; onEscape?: () => void; t: DatesL['t'] }) {
  const [start, setStart] = useState(() => year - (((year % 12) + 12) % 12))
  const [active, setActive] = useState(year)
  const refs = useRef(new Map<number, HTMLButtonElement | null>())
  const want = useRef(true)
  useEffect(() => { if (want.current) refs.current.get(active)?.focus({ preventScroll: true }); want.current = false }, [active, start])
  const off = (y: number) => (!!min && y < min.getFullYear()) || (!!max && y > max.getFullYear())
  const go = (y: number) => { want.current = true; setActive(y); if (y < start || y >= start + 12) setStart(y - (((y % 12) + 12) % 12)) }
  const years = Array.from({ length: 12 }, (_, i) => start + i)
  return (
    <div className="flex h-full flex-col" onKeyDown={e => {
      if (e.key === 'Escape' && onEscape) { e.stopPropagation(); onEscape(); return }
      if (e.key === 'PageUp' || e.key === 'PageDown') { e.preventDefault(); go(active + (e.key === 'PageUp' ? -12 : 12)); return }
      if (!(e.target as HTMLElement).dataset.tile) return
      const n = datesTileMove(e, active - start)
      if (n !== null) { e.preventDefault(); go(start + n) }
    }}>
      <DatesNavHeader title={`${datesNum(locale, start)}–${datesNum(locale, start + 11)}`}
        onPrev={() => setStart(s => s - 12)} onNext={() => setStart(s => s + 12)} prevLabel={t('date.previousYears', 'Earlier years')} nextLabel={t('date.nextYears', 'Later years')}
        prevDisabled={!!min && start <= min.getFullYear()} nextDisabled={!!max && start + 11 >= max.getFullYear()} />
      <div role="group" aria-label={`${datesNum(locale, start)}–${datesNum(locale, start + 11)}`} className="grid flex-1 grid-cols-3 grid-rows-4 gap-1">
        {years.map(y => (
          <button key={y} type="button" data-tile ref={el => { refs.current.set(y, el) }} tabIndex={y === (years.includes(active) ? active : start) ? 0 : -1}
            aria-pressed={y === selected} aria-disabled={off(y) || undefined} onFocus={() => setActive(y)} onClick={() => { if (!off(y)) onPick(y) }}
            className={DATES_TILE}>{datesNum(locale, y)}</button>
        ))}
      </div>
    </div>
  )
}

/** Props of Calendar. */
export type CalendarProps = {
  selected?: Date | null; onSelect?: (d: Date) => void; range?: DateRange; onRangeChange?: (r: DateRange) => void
  /** the month shown first (defaults to the selection, then today) */ month?: Date; onMonthChange?: (firstShown: Date) => void
  /** the day marked as today; by default the client's date, read after mount so server and client render the same */ today?: Date
  /** focus the selected (or today's) day on mount, e.g. inside a popover */ autoFocus?: boolean
  /** first and last selectable days; days outside are disabled and navigation stops at them */ min?: Date | null; max?: Date | null
  /** days that can't be picked (weekends, holidays, booked days); they stay focusable and are announced as unavailable */ isDateUnavailable?: (d: Date) => boolean
  /** 0 Sunday … 6 Saturday (default: the locale's, from useLocale()) */ weekStartsOn?: WeekDay
  /** month and weekday names, digits (default: useLocale()) */ locale?: string
  /** months side by side, 1–3 (stacked on phones) */ numberOfMonths?: 1 | 2 | 3
  className?: string
}

/**
 * Month grid (an ARIA grid; day cells grow to 40×40 on touch). Always controlled: a single date is `selected` +
 * `onSelect`, a range is `range` + `onRangeChange` (pass one pair); `month` is only the month shown first.
 * Weekday and month names, digits and the first day of the week follow the locale (`locale`, `weekStartsOn`, or
 * UIProvider's). `min`, `max` and `isDateUnavailable(date)` disable days (they stay focusable and are announced as
 * unavailable; a range can't start or end on one). `numberOfMonths` shows up to 3 months (stacked on phones).
 * Click the month caption for a month grid, and its year for a year grid, to jump far.
 * Keyboard (ARIA APG date grid): arrows move by day/week across months (mirrored in RTL), Home/End go to the start/end of
 * the week, PageUp/PageDown change month (with Shift, year), Enter or Space picks. In range mode Shift+arrow or
 * Shift+click extends the range from its anchor; you can also click start then end, drag across days, or drag either
 * end of an existing range. On touch, drag an end of the range, or long-press a day and then drag to draw a new one, so a
 * swipe over the grid still scrolls the page. Months slide in the direction you move; the picked day pops.
 */
export function Calendar({ selected, onSelect, range, onRangeChange, month: initialMonth, onMonthChange, today: todayProp, className, autoFocus,
  min, max, isDateUnavailable, weekStartsOn: wsProp, locale: locProp, numberOfMonths = 1 }: CalendarProps) {
  const L = useDatesLocale({ locale: locProp, weekStartsOn: wsProp })
  const { locale, weekStartsOn } = L
  const n = Math.max(1, Math.min(3, Math.round(numberOfMonths)))
  const lo = min ? startOfDay(min) : null, hi = max ? startOfDay(max) : null
  const clampDay = (d: Date) => (lo && d < lo ? lo : hi && d > hi ? hi : d)
  const [month, setMonthState] = useState(() => addMonths(initialMonth ?? selected ?? range?.[0] ?? todayProp ?? clampDay(new Date()), 0))
  const [dir, setDir] = useState(0)
  const [hover, setHover] = useState<Date | null>(null)
  const [focus, setFocus] = useState(() => clampDay(startOfDay(selected ?? range?.[0] ?? initialMonth ?? todayProp ?? new Date())))
  const clientToday = useDatesToday()
  const [kbd, setKbd] = useState(false)
  const [view, setView] = useState<'days' | 'months' | 'years'>('days')
  const [pick, setPick] = useState({ year: month.getFullYear(), panel: 0 })
  const wrap = useRef<HTMLDivElement>(null)
  const wantFocus = useRef(!!autoFocus)
  const anchor = useRef<Date | null>(null)
  const uid = useId()
  const setMonth = (m: Date) => { setMonthState(m); onMonthChange?.(m) }
  const end0 = addMonths(month, n) // first day after the last month shown
  const go = (k: number) => { setDir(k); setMonth(addMonths(month, k)) }
  const shownDay = (d: Date) => d >= month && d < end0
  const showMonthOf = (d: Date) => {
    if (shownDay(d)) return
    const m = d < month ? addMonths(d, 0) : addMonths(d, 1 - n)
    setDir(m > month ? 1 : -1); setMonth(m)
  }
  const blocked = (d: Date) => !!((lo && d < lo) || (hi && d > hi) || isDateUnavailable?.(d))
  const [a, b] = range ?? [null, null]
  const probe = hover ?? (kbd ? focus : null)
  const end = b ?? (a && probe && probe > a ? probe : null) // preview the range while choosing its end
  const today = todayProp ?? clientToday
  const tabDay = shownDay(focus) ? focus : month
  const months = Array.from({ length: n }, (_, i) => addMonths(month, i))
  const caption = (m: Date) => datesDF(locale, { month: 'long', year: 'numeric' }).format(m)
  const dayLabel = (d: Date) => datesDF(locale, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(d)
  const wk = datesWeekdays(locale), order = Array.from({ length: 7 }, (_, i) => (weekStartsOn + i) % 7)

  // Move DOM focus to the roving day after keyboard navigation (also across month changes and back from the quick picker).
  useEffect(() => {
    if (!wantFocus.current || view !== 'days') return
    wrap.current?.querySelector<HTMLElement>(`[data-cal="${+month}"] [data-day="${+tabDay}"][data-in]`)?.focus({ preventScroll: true })
  }, [+tabDay, +month, view]) // eslint-disable-line react-hooks/exhaustive-deps
  // Pop the selected day when it changes (switching to its month first if needed).
  const selT = selected ? +startOfDay(selected) : 0
  const popped = useRef(selT)
  useEffect(() => {
    if (!selT || selT === popped.current) return
    if (!shownDay(new Date(selT))) return showMonthOf(new Date(selT))
    popped.current = selT
    play(wrap.current?.querySelector(`[data-cal="${+month}"] [data-day="${selT}"][data-in]`), { scale: [0.8, 1] }, spring(0.5, 0.3))
  }, [selT, +month]) // eslint-disable-line react-hooks/exhaustive-deps

  const extend = (d: Date, from: Date) => {
    if (!onRangeChange || blocked(d)) return
    let anc = anchor.current
    if (!anc || !(sameDay(anc, a) || sameDay(anc, b))) anc = a && b ? (sameDay(from, a) ? b : a) : a ?? from
    anchor.current = anc
    onRangeChange(d < anc ? [d, anc] : [anc, d])
  }
  const onKey = (e: RKeyboardEvent) => {
    if (!(e.target as HTMLElement).dataset.day) return
    const cur = tabDay, rtl = getComputedStyle(e.currentTarget).direction === 'rtl', k = logicalArrow(e.key, rtl ? 'rtl' : 'ltr')
    const wd = (cur.getDay() - weekStartsOn + 7) % 7
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
    next = clampDay(next)
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
    if (!onRangeChange || e.shiftKey || e.button !== 0 || blocked(d)) return
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
    if (!g || !d || !onRangeChange || blocked(d)) return
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
    setFocus(d); showMonthOf(d)
    if (blocked(d)) return
    if (!onRangeChange) return onSelect?.(d)
    if (e.shiftKey && a) return extend(d, from)
    anchor.current = null
    onRangeChange(!a || b || d < a ? [d, null] : [a, d])
  }
  const openPicker = (m: Date, panel: number) => { setPick({ year: m.getFullYear(), panel }); setView('months') }
  const pickMonth = (mo: number) => {
    const t = addMonths(new Date(pick.year, mo, 1), -pick.panel)
    setDir(t > month ? 1 : t < month ? -1 : 0); setMonth(t)
    setFocus(clampDay(new Date(pick.year, mo, Math.min(focus.getDate(), datesDim(pick.year, mo + 1)))))
    wantFocus.current = true; setView('days')
  }

  const cell = (d: Date, m: Date) => {
    const outside = d.getMonth() !== m.getMonth()
    if (outside && n > 1) return <div key={+d} role="gridcell" />
    const off = blocked(d)
    const isStart = sameDay(d, a), isEnd = sameDay(d, end), isSel = sameDay(d, selected) || isStart || isEnd
    const joined = !!a && !!end && !sameDay(a, end)
    const inRange = !!a && !!end && d > a && d < end
    const isToday = sameDay(d, today)
    return (
      <div key={+d} role="gridcell" aria-selected={isSel || inRange} className="flex">
        <button type="button" data-day={+d} data-in={outside ? undefined : ''} tabIndex={sameDay(d, tabDay) && !outside ? 0 : -1}
          onClick={e => onClick(d, e)} onPointerDown={e => onDown(d, e)} onPointerEnter={e => e.pointerType === 'mouse' && setHover(off ? null : d)}
          aria-pressed={isSel} aria-disabled={off || undefined} aria-current={isToday ? 'date' : undefined} aria-label={dayLabel(d)}
          className={cn('relative h-8 w-full cursor-pointer border-0 text-[13px] transition-colors focus-visible:z-10 [@media(pointer:coarse)]:h-10 [@media(pointer:coarse)]:text-sm',
            isSel ? cn('bg-[var(--primary)] font-semibold text-[var(--on-primary)]', !joined ? 'rounded-[var(--r-md)]' : isStart ? 'rounded-s-[var(--r-md)]' : 'rounded-e-[var(--r-md)]', joined && onRangeChange && b && 'cursor-ew-resize', onRangeChange && atRangeEnd(d) && 'touch-none')
              : inRange ? 'bg-[var(--muted)]' : 'rounded-[var(--r-md)] bg-transparent hover:bg-[var(--muted)]',
            // outside-month and unavailable days: secondary text (≥4.5:1 in every theme), not faded with opacity
            (outside || off) && !isSel && 'text-[var(--fg3)]', off && !isSel && 'cursor-default line-through hover:bg-transparent',
            isToday && !isSel && 'font-semibold text-[var(--accent)]')}>
          {datesNum(locale, d.getDate())}
          {isToday && <span aria-hidden className="absolute bottom-1 left-1/2 h-1 w-1 -translate-x-1/2 rounded-full bg-current" />}
        </button>
      </div>
    )
  }
  const panel = (m: Date, pi: number) => {
    const lead = (m.getDay() - weekStartsOn + 7) % 7
    const days = Array.from({ length: 42 }, (_, i) => new Date(m.getFullYear(), m.getMonth(), i - lead + 1))
    return (
      <div key={pi} data-grid={+m} className={n === 1 ? 'w-full' : 'w-[252px] max-w-full max-sm:!w-full [@media(pointer:coarse)]:w-[280px]'}>
        <div className="mb-2 flex h-7 items-center justify-center [@media(pointer:coarse)]:h-9">
          <button type="button" onClick={() => openPicker(m, pi)}
            aria-label={L.t('date.chooseMonthYear', '{month}, choose month and year', { month: caption(m) })} className={DATES_CAPTION}>
            {caption(m)}<Icon name="chevronDown" size={13} className="text-[var(--fg3)]" />
          </button>
        </div>
        <div role="grid" aria-label={caption(m)} aria-multiselectable={onRangeChange ? true : undefined} className="flex flex-col gap-y-0.5">
          <div role="row" className="grid grid-cols-7 text-center text-[11px] text-[var(--fg3)]">
            {order.map(w => <div key={w} role="columnheader" aria-label={wk.long[w]} className="truncate py-1">{wk.short[w]}</div>)}
          </div>
          {Array.from({ length: 6 }, (_, r) => <div key={r} role="row" className="grid grid-cols-7">{days.slice(r * 7, r * 7 + 7).map(d => cell(d, m))}</div>)}
        </div>
      </div>
    )
  }
  const navCls = '!absolute top-0 z-[1] [@media(pointer:coarse)]:!h-9 [@media(pointer:coarse)]:!w-9'
  return (
    <div ref={wrap} className={cn('max-w-full select-none', n === 1 && 'w-[252px] [@media(pointer:coarse)]:w-[280px]', className)}
      onBlur={e => { if (!wrap.current?.contains(e.relatedTarget as Node)) { wantFocus.current = false; setKbd(false) } }}>
      <div className="relative">
        <div className={cn('relative', view !== 'days' && 'invisible')} inert={view !== 'days'}>
          <div className="relative overflow-hidden">
            <AnimatePresence initial={false} mode="popLayout" custom={dir}>
              <motion.div key={+month} data-cal={+month} custom={dir} className={cn('flex gap-x-5 gap-y-4', n > 1 && 'flex-col sm:flex-row', onRangeChange && 'touch-pan-y [-webkit-touch-callout:none]')}
                variants={{ in: (d: number) => ({ x: d * 40, opacity: 0 }), c: { x: 0, opacity: 1 }, out: (d: number) => ({ x: d * -40, opacity: 0 }) }}
                initial="in" animate="c" exit="out" transition={spring(0.1, 0.3)} onKeyDown={onKey}
                onPointerLeave={() => setHover(null)} onPointerMove={onMove} onPointerUp={cancelHold} onPointerCancel={cancelHold}
                onContextMenu={onRangeChange ? e => e.preventDefault() : undefined}>
                {months.map(panel)}
              </motion.div>
            </AnimatePresence>
          </div>
          <IconButton icon={<Icon name="chevronLeft" size={15} className="ui-flip" />} label={L.t('date.previousMonth', 'Previous month')} onClick={() => go(-1)} disabled={!!lo && lo >= month} className={cn(navCls, 'start-0')} />
          <IconButton icon={<Icon name="chevronRight" size={15} className="ui-flip" />} label={L.t('date.nextMonth', 'Next month')} onClick={() => go(1)} disabled={!!hi && hi < end0} className={cn(navCls, 'end-0')} />
          <span className="sr-only" aria-live="polite" id={uid}>{months.map(caption).join(', ')}</span>
        </div>
        {view !== 'days' && (
          <div className="absolute inset-0 z-10 flex justify-center">
            <div className="flex h-full w-full max-w-[280px] flex-col">
              {view === 'months'
                ? <DatesMonthGrid key={pick.year} locale={locale} year={pick.year} onYear={y => setPick(p => ({ ...p, year: y }))} t={L.t}
                  selected={{ year: addMonths(month, pick.panel).getFullYear(), month: addMonths(month, pick.panel).getMonth() }} onPick={pickMonth} min={lo} max={hi}
                  onTitle={() => setView('years')} onEscape={() => { wantFocus.current = true; setView('days') }} />
                : <DatesYearGrid locale={locale} year={pick.year} selected={addMonths(month, pick.panel).getFullYear()} min={lo} max={hi} t={L.t}
                  onPick={y => { setPick(p => ({ ...p, year: y })); setView('months') }} onEscape={() => setView('months')} />}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

/** Field-styled trigger for a Popover: wires aria-expanded and gives Escape somewhere to return focus. */
function FormsTrigger({ icon, children, fc, ref }: { icon: IconName; children: ReactNode; ref?: Ref<HTMLButtonElement>
  fc: { control: { id?: string; 'aria-invalid'?: true; 'aria-describedby'?: string }; disabled: boolean; readOnly: boolean } }) {
  const { open, setOpen, triggerRef, id: pid } = usePopover()
  return (
    <button type="button" ref={formsMergeRefs(triggerRef, ref)} {...fc.control} disabled={fc.disabled} className={cn(formsTriggerClass, fc.readOnly ? 'cursor-default bg-[var(--muted)] hover:!border-[var(--line)]' : 'cursor-pointer')}
      aria-haspopup="dialog" aria-expanded={open} aria-controls={pid} onClick={() => { if (!fc.readOnly) setOpen(!open) }}>
      <Icon name={icon} size={15} className="text-[var(--fg3)]" />{children}
    </button>
  )
}

/** The date constraints DatePicker, DateRangePicker and DateField share with Calendar. */
type DatesConstraints = { min?: Date | null; max?: Date | null; isDateUnavailable?: (d: Date) => boolean; weekStartsOn?: WeekDay; locale?: string }

/**
 * Date field: the calendar pops from the field (keyboard ready), the picked day pops, Today and Clear sit under the grid.
 * Shows the weekday, in the locale. `min`, `max`, `isDateUnavailable`, `weekStartsOn`, `locale` and `numberOfMonths` go
 * to the Calendar; a value outside them is marked invalid and stops a form submit with a message. Form-native: `name`
 * submits the local date as "2026-11-08" (like <input type="date">; '' when empty), `required`, `disabled`, `readOnly`
 * (doesn't open), `invalid`, `onBlur`, `form`, and `ref` on the trigger. For typing a date, use DateField.
 */
export function DatePicker({ value, defaultValue = null, onChange, placeholder, min, max, isDateUnavailable, weekStartsOn, locale, numberOfMonths, className, ref, ...fp }: FormControlProps & DatesConstraints &
  { value?: Date | null; defaultValue?: Date | null; onChange?: (d: Date | null) => void; placeholder?: string; numberOfMonths?: 1 | 2 | 3; className?: string; ref?: Ref<HTMLButtonElement> }) {
  const L = useDatesLocale({ locale })
  const btn = useRef<HTMLButtonElement>(null)
  const fc = useFormControl<Date | null>({ ...fp, value, defaultValue, onChange, serialize: formDate, focus: () => btn.current?.focus() })
  const d = fc.value, set = fc.set
  const [open, setOpen] = useState(false)
  const [flagged, setFlagged] = useState(false)
  useEffect(() => setFlagged(false), [formDate(d)])
  const c = { min, max, isDateUnavailable }
  const problem = datesDayProblem(d, c, L)
  const today = startOfDay(new Date())
  const pick = (x: Date | null, close = true) => { set(x); if (close) setTimeout(() => setOpen(false), 180) }
  const invalid = fc.invalid || flagged || !!problem
  return (
    <span className={cn('relative block', className)} onBlur={fc.onBlur}>
      <Popover open={open && !fc.disabled && !fc.readOnly} onOpenChange={setOpen} className="!block">
        <FormsTrigger icon="calendar" fc={{ ...fc, control: { ...fc.control, 'aria-invalid': invalid || undefined } }} ref={formsMergeRefs(btn, ref)}>
          <motion.span key={d ? +d : 0} initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} transition={spring(0.3, 0.3)} className={cn('truncate', !d && 'text-[var(--fg3)]')}>
            {d ? datesDF(L.locale, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }).format(d) : placeholder ?? L.t('date.pickDate', 'Pick a date')}
          </motion.span>
        </FormsTrigger>
        <PopoverContent className="p-3" aria-label={L.t('date.chooseDate', 'Choose a date')}>
          <Calendar selected={d} onSelect={x => pick(x)} autoFocus {...c} weekStartsOn={weekStartsOn} locale={locale} numberOfMonths={numberOfMonths} />
          <div className="mt-2 flex justify-between border-t border-[var(--line)] pt-2">
            <Button size="sm" variant="ghost" disabled={!!datesDayProblem(today, c, L)} onClick={() => pick(today)}>{L.t('date.today', 'Today')}</Button>
            <Button size="sm" variant="ghost" disabled={!d} onClick={() => pick(null, false)}>{L.t('common.clear', 'Clear')}</Button>
          </div>
        </PopoverContent>
      </Popover>
      {!fc.disabled && <DatesValidity message={problem} name={fc.name} form={fp.form} focus={() => btn.current?.focus()} onInvalid={() => setFlagged(true)} />}
      {fc.inputs}
    </span>
  )
}

/** Quick ranges shown beside the range calendar: [label, () => range]. Pass your own (in your language) to DateRangePicker. */
export const RANGE_PRESETS: [string, () => DateRange][] = [
  ['Today', () => [startOfDay(new Date()), startOfDay(new Date())]],
  ['Yesterday', () => [addDays(new Date(), -1), addDays(new Date(), -1)]],
  ['Last 7 days', () => [addDays(new Date(), -6), startOfDay(new Date())]],
  ['Last 30 days', () => [addDays(new Date(), -29), startOfDay(new Date())]],
  ['This month', () => { const n = new Date(); return [new Date(n.getFullYear(), n.getMonth(), 1), new Date(n.getFullYear(), n.getMonth() + 1, 0)] }],
  ['Last month', () => { const n = new Date(); return [new Date(n.getFullYear(), n.getMonth() - 1, 1), new Date(n.getFullYear(), n.getMonth(), 0)] }],
]

/**
 * Range picker with presets (the matching preset stays highlighted; presets that fall outside `min`/`max` or start or end
 * on an unavailable day are disabled). Stays open so you can drag either end to adjust; Done closes it. Takes the
 * Calendar's `min`, `max`, `isDateUnavailable`, `weekStartsOn`, `locale` and `numberOfMonths` (2 is a good fit on desktop;
 * phones stack them). Form-native: `name` submits two fields, start then end ("2026-11-01", "2026-11-07"; '' for a missing
 * side; read with formData.getAll), `required` (both ends), `disabled`, `readOnly`, `invalid`, `onBlur`, `form`, `ref`.
 */
export function DateRangePicker({ value, defaultValue = [null, null], onChange, placeholder, presets = RANGE_PRESETS, min, max, isDateUnavailable, weekStartsOn, locale, numberOfMonths, className, ref, ...fp }: FormControlProps & DatesConstraints &
  { value?: DateRange; defaultValue?: DateRange; onChange?: (r: DateRange) => void; placeholder?: string; presets?: [string, () => DateRange][]; numberOfMonths?: 1 | 2 | 3; className?: string; ref?: Ref<HTMLButtonElement> }) {
  const L = useDatesLocale({ locale })
  const btn = useRef<HTMLButtonElement>(null)
  const fc = useFormControl<DateRange>({ ...fp, value, defaultValue, onChange, serialize: r => [formDate(r[0]), formDate(r[1])], filled: r => !!r[0] && !!r[1], focus: () => btn.current?.focus() })
  const r = fc.value, set = fc.set
  const [open, setOpen] = useState(false)
  const [month, setMonth] = useState(0) // bump to re-mount the calendar on the preset's month
  const [flagged, setFlagged] = useState(false)
  useEffect(() => setFlagged(false), [formDate(r[0]), formDate(r[1])])
  const c = { min, max, isDateUnavailable }
  const days = r[0] && r[1] ? Math.round((+r[1] - +r[0]) / 864e5) + 1 : 0
  const f = datesDF(L.locale, { day: 'numeric', month: 'short', year: 'numeric' })
  const current = presets.find(([, get]) => { const [x, y] = get(); return sameDay(x, r[0]) && sameDay(y, r[1]) })?.[0]
  const presetOff = (get: () => DateRange) => { const [x, y] = get(); return !!(datesDayProblem(x, c, L) || datesDayProblem(y, c, L)) }
  const problem = datesDayProblem(r[0], c, L) ?? datesDayProblem(r[1], c, L)
  const invalid = fc.invalid || flagged || !!problem
  const count = L.t('date.dayCount', '{count, plural, one {# day} other {# days}}', { count: days })
  return (
    <span className={cn('relative block', className)} onBlur={fc.onBlur}>
      <Popover open={open && !fc.disabled && !fc.readOnly} onOpenChange={setOpen} className="!block">
        <FormsTrigger icon="calendar" fc={{ ...fc, control: { ...fc.control, 'aria-invalid': invalid || undefined } }} ref={formsMergeRefs(btn, ref)}>
          <span className={cn('flex-1 truncate', !r[0] && 'text-[var(--fg3)]')}>{r[0] ? (r[1] ? f.formatRange(r[0], r[1]) : `${f.format(r[0])} – …`) : placeholder ?? L.t('date.pickDates', 'Pick dates')}</span>
          {days > 0 && <Badge>{count}</Badge>}
        </FormsTrigger>
        <PopoverContent className="p-3" aria-label={L.t('date.chooseDates', 'Choose dates')}>
          <div className="flex flex-col gap-3 sm:flex-row">
            {presets.length > 0 && (
              <div className="-mx-3 flex gap-0.5 overflow-x-auto border-[var(--line)] px-3 pb-2 [scrollbar-width:none] max-sm:w-0 max-sm:min-w-[calc(100%+24px)] sm:mx-0 sm:w-[112px] sm:flex-col sm:overflow-visible sm:border-e sm:px-0 sm:pe-2 sm:pb-0">
                {presets.map(([label, get]) => (
                  <button type="button" key={label} aria-pressed={label === current} data-active={label === current} disabled={presetOff(get)} onClick={() => { set(get()); setMonth(m => m + 1) }}
                    className={cn(menuItemClass, '!w-auto flex-none text-xs whitespace-nowrap disabled:cursor-default disabled:text-[var(--fg3)] disabled:hover:bg-transparent max-sm:rounded-full max-sm:border max-sm:!border-[var(--line)] sm:!w-full', label === current && 'font-semibold')}>
                    {label}{label === current && <Icon name="check" size={12} />}
                  </button>
                ))}
              </div>
            )}
            <Calendar key={month} range={r} onRangeChange={set} {...c} weekStartsOn={weekStartsOn} locale={locale} numberOfMonths={numberOfMonths} />
          </div>
          <div className="mt-3 flex items-center gap-2 border-t border-[var(--line)] pt-3">
            <span className="min-w-0 flex-1 text-xs text-[var(--fg3)]">{!r[0] ? L.t('date.rangeHintStart', 'Tap or drag to choose dates') : !r[1] ? L.t('date.rangeHintEnd', 'Choose an end date') : L.t('date.rangeHintDone', '{count} · drag either end to adjust', { count })}</span>
            <Button size="sm" variant="ghost" disabled={!r[0]} onClick={() => set([null, null])}>{L.t('common.clear', 'Clear')}</Button>
            <Button size="sm" variant="primary" onClick={() => setOpen(false)}>{L.t('common.done', 'Done')}</Button>
          </div>
        </PopoverContent>
      </Popover>
      {!fc.disabled && <DatesValidity message={problem} name={fc.name} form={fp.form} focus={() => btn.current?.focus()} onInvalid={() => setFlagged(true)} />}
      {fc.inputs}
    </span>
  )
}

/* Typed fields ───────────────────────────────────────────────────────────────── */

/**
 * Typed date entry: day, month and year segments in the locale's order, separators and digits (en-GB dd/mm/yyyy, en-US
 * mm/dd/yyyy, de-DE tt.mm.jjjj, ja-JP yyyy/mm/dd). Type digits (a segment moves on once it can't take another), ↑/↓
 * step a segment (PageUp/PageDown further), ←/→ move between segments, Backspace clears digit by digit, and pasting
 * "2026-11-08" or a date in the locale's format fills them all. `min`, `max` and `isDateUnavailable` mark the date
 * invalid and stop a form submit with a message (as does a half-typed date). Value: a local Date at midnight, or null
 * while empty or incomplete. Form-native: `name` submits "2026-11-08" ('' when empty), `required`, `disabled`,
 * `readOnly`, `invalid`, `onBlur`, `form`, and `ref` on the first segment.
 */
export function DateField({ value, defaultValue = null, onChange, min, max, isDateUnavailable, locale, className, 'aria-label': ariaLabel, ref, ...fp }: FormControlProps & Omit<DatesConstraints, 'weekStartsOn'> &
  { value?: Date | null; defaultValue?: Date | null; onChange?: (d: Date | null) => void; 'aria-label'?: string; className?: string; ref?: Ref<HTMLInputElement> }) {
  const L = useDatesLocale({ locale })
  const first = useRef<HTMLInputElement>(null), onReset = useRef(() => {})
  const fc = useFormControl<Date | null>({ ...fp, value, defaultValue, onChange, serialize: formDate, focus: () => first.current?.focus(), onReset: () => onReset.current() })
  const tpl = datesTemplate(L.locale, true, null, false)
  const seg = useDatesSegValue(fc, DATES_DAY_CONV, tpl, false, L.locale)
  useLayoutEffect(() => { onReset.current = () => seg.resetTo(defaultValue) })
  const [editing, setEditing] = useState(false), [flagged, setFlagged] = useState(false)
  useEffect(() => setFlagged(false), [formDate(fc.value), seg.partial])
  const range = datesDayProblem(fc.value, { min, max, isDateUnavailable }, L)
  const problem = range ?? (seg.partial ? L.t('date.incomplete', 'Enter a complete date') : null)
  return (
    <div className={cn('relative', className)} onBlur={fc.onBlur}>
      <DatesSegments tpl={tpl} vals={seg.vals} onVals={seg.onVals} locale={L.locale} h12={false} seed={datesSeed(false)} emptyText={L.t('date.empty', 'Empty')} icon="calendar"
        disabled={fc.disabled} readOnly={fc.readOnly} invalid={fc.invalid || flagged || (!!range && !editing)} required={fc.required}
        id={fc.control.id} labelledBy={fc.labelledBy} aria-label={ariaLabel} describedBy={fc.control['aria-describedby']} inputRef={formsMergeRefs(first, ref)} onFocusChange={setEditing} />
      {!fc.disabled && <DatesValidity message={problem} name={fc.name} form={fp.form} focus={() => first.current?.focus()} onInvalid={() => setFlagged(true)} />}
      {fc.inputs}
    </div>
  )
}

const datesTimeConv = (gran: DateGranularity): DatesConv<string> => ({
  toWall: s => { const m = DATES_ISO_TIME.exec(s ?? ''); return m ? { hour: +m[1], minute: +m[2], second: +(m[3] ?? 0) } : null },
  fromWall: w => `${datesPad(w.hour)}:${datesPad(w.minute)}${gran === 'second' ? `:${datesPad(w.second)}` : ''}`,
  key: s => s ?? '', empty: '',
})
/** "9:05" or "09:05:30" as seconds since midnight, for comparing. */
const datesSecs = (s?: string | null) => { const m = DATES_ISO_TIME.exec(s ?? ''); return m ? +m[1] * 3600 + +m[2] * 60 + +(m[3] ?? 0) : null }

/** Props of TimeField (TimePicker takes the same). */
export type TimeFieldProps = FormControlProps & {
  /** "09:30" (24-hour); '' when empty */ value?: string; defaultValue?: string; onChange?: (v: string) => void
  /** 'hour' | 'minute' (default) | 'second' */ granularity?: Exclude<DateGranularity, 'day'>
  /** 12 or 24-hour clock (default: the locale's) */ hourCycle?: 12 | 24 | HourCycle; locale?: string
  /** earliest and latest allowed time, "08:00" and "18:30" */ min?: string; max?: string
  /** an IANA zone the time is in: shown after it ("CET"); the value stays the wall time */ timeZone?: string
  /** minutes between suggested times; shows a list of them behind a clock button */ step?: number
  /** first and last suggestion, in minutes after midnight (default 0 and 24 × 60) */ from?: number; to?: number
  'aria-label'?: string; className?: string; ref?: Ref<HTMLElement>
}

/**
 * Typed time entry: hour and minute (and second) segments, with an am/pm segment on a 12-hour clock (from the locale or
 * `hourCycle`); type "930" or "9" then ":" and "30", ↑/↓ step a segment, "a"/"p" sets am/pm, pasting "14:30" or
 * "2:30 PM" fills it. `min`/`max` ("08:00", "18:00") mark it invalid. `step` adds a clock button with suggested times
 * every `step` minutes (between `from` and `to`), outside min/max disabled; Alt+↓ opens it. `timeZone` shows the zone's
 * short name after the time (the value is the wall time there). Value: "09:30" (24-hour, like <input type="time">;
 * "09:30:15" with granularity="second"), '' while empty or incomplete. Form-native: `name` submits it, `required`,
 * `disabled`, `readOnly`, `invalid`, `onBlur`, `form`, and `ref` on the first segment.
 */
export function TimeField({ value, defaultValue = '', onChange, granularity = 'minute', hourCycle, locale, min, max, timeZone, step, from = 0, to = 24 * 60, className, 'aria-label': ariaLabel, ref, ...fp }: TimeFieldProps) {
  const L = useDatesLocale({ locale, hourCycle, timeZone })
  const first = useRef<HTMLInputElement>(null), onReset = useRef(() => {})
  const fc = useFormControl<string>({ ...fp, value, defaultValue, onChange, serialize: x => x, focus: () => first.current?.focus(), onReset: () => onReset.current() })
  const h12 = L.h12
  const tpl = datesTemplate(L.locale, false, granularity, h12)
  const conv = useMemo(() => datesTimeConv(granularity), [granularity])
  const seg = useDatesSegValue(fc, conv, tpl, h12, `${L.locale}|${h12}|${granularity}`)
  useLayoutEffect(() => { onReset.current = () => seg.resetTo(defaultValue) })
  const [editing, setEditing] = useState(false), [flagged, setFlagged] = useState(false)
  useEffect(() => setFlagged(false), [fc.value, seg.partial])
  const v = datesSecs(fc.value), lo = datesSecs(min), hi = datesSecs(max)
  const fmtT = (s: number) => datesDF(L.locale, { hour: h12 ? 'numeric' : '2-digit', minute: '2-digit', hourCycle: h12 ? 'h12' : 'h23', timeZone: 'UTC' }).format(s * 1000)
  const range = v === null ? null : lo !== null && v < lo ? L.t('date.timeTooEarly', 'Choose {time} or later', { time: fmtT(lo) }) : hi !== null && v > hi ? L.t('date.timeTooLate', 'Choose {time} or earlier', { time: fmtT(hi) }) : null
  const problem = range ?? (seg.partial ? L.t('date.incompleteTime', 'Enter a complete time') : null)
  // suggestions
  const { open, setOpen, ref: wrap } = useDisclosure(), lid = useId()
  const [place, setPlace] = useState<Placement>('bottom-start')
  const opts = useMemo<Option[]>(() => !step ? [] : timeOptions(step, from, to).map(o => {
    const s = datesSecs(o.value)!
    return { value: o.value, label: fmtT(s), disabled: (lo !== null && s < lo) || (hi !== null && s > hi) }
  }), [step, from, to, lo, hi, L.locale, h12]) // eslint-disable-line react-hooks/exhaustive-deps
  const near = v === null ? -1 : opts.findIndex(o => datesSecs(o.value)! >= v)
  const pick = (i: number) => {
    const o = opts[i]; if (!o || o.disabled) return
    fc.set(granularity === 'second' ? `${o.value}:00` : granularity === 'hour' ? `${o.value.slice(0, 3)}00` : o.value); setOpen(false)
  }
  const { active, setActive, onKeyDown } = useRoving(opts.length, pick, { isDisabled: i => !!opts[i]?.disabled })
  const locked = fc.disabled || fc.readOnly
  const show = (o: boolean) => {
    if (o && locked) return
    if (o) { const i = near >= 0 ? near : opts.findIndex(x => !x.disabled); setActive(Math.max(0, i)); setPlace(formsPlacement(wrap.current)) }
    setOpen(o)
  }
  const zone = timeZone ? datesZoneName(L.locale, L.timeZone, Date.now()) : null
  return (
    <div ref={wrap} className={cn('relative', className)} onBlur={fc.onBlur}>
      <DatesSegments tpl={tpl} vals={seg.vals} onVals={seg.onVals} locale={L.locale} h12={h12} seed={datesSeed(h12)} emptyText={L.t('date.empty', 'Empty')} icon={step ? undefined : 'clock'}
        disabled={fc.disabled} readOnly={fc.readOnly} invalid={fc.invalid || flagged || (!!range && !editing)} required={fc.required}
        id={fc.control.id} labelledBy={fc.labelledBy} aria-label={ariaLabel} describedBy={fc.control['aria-describedby']} inputRef={formsMergeRefs(first, ref as Ref<HTMLInputElement>)}
        onFocusChange={setEditing} onKeyDown={e => { if (step && e.altKey && e.key === 'ArrowDown') { e.preventDefault(); show(true); setTimeout(() => wrap.current?.querySelector<HTMLElement>('[data-times]')?.focus()) } }}
        suffix={zone && <span className="flex-none text-xs text-[var(--fg3)]">{zone}</span>}>
        {step ? (
          <button type="button" data-times role="combobox" aria-label={L.t('date.showTimes', 'Show times')} aria-haspopup="listbox" aria-expanded={open} aria-controls={lid} aria-activedescendant={open ? `${lid}-${active}` : undefined}
            disabled={fc.disabled} onClick={() => show(!open)}
            onKeyDown={e => {
              if (!open) { if (['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(e.key)) { e.preventDefault(); show(true) } return }
              if (e.key === 'Escape') { e.stopPropagation(); setOpen(false); return }
              if (e.key === 'Tab') return setOpen(false)
              if (e.key === ' ') { e.preventDefault(); pick(active); return }
              onKeyDown(e)
            }}
            className={cn('-me-1 grid h-7 w-7 flex-none place-items-center rounded-[var(--r-md)] border-0 bg-transparent text-[var(--fg3)] [@media(pointer:coarse)]:h-8 [@media(pointer:coarse)]:w-8', locked ? 'cursor-default' : 'cursor-pointer hover:bg-[var(--muted)] hover:text-[var(--fg)]')}>
            <Icon name="clock" size={15} />
          </button>
        ) : null}
      </DatesSegments>
      {step ? (
        <FloatingPanel open={open} matchWidth placement={place} className="max-h-64 overflow-auto tabular-nums" role="presentation">
          <OptionList id={lid} options={opts} active={active} isSelected={o => !!fc.value && o.value === fc.value.slice(0, 5)} onPick={pick} onHover={setActive} label={L.t('date.suggestedTimes', 'Suggested times')} />
        </FloatingPanel>
      ) : null}
      {!fc.disabled && <DatesValidity message={problem} name={fc.name} form={fp.form} focus={() => first.current?.focus()} onInvalid={() => setFlagged(true)} />}
      {fc.inputs}
    </div>
  )
}

/** Options for a time picker: <Select options={timeOptions(30)} /> */
export const timeOptions = (stepMinutes = 30, from = 0, to = 24 * 60): Option[] =>
  Array.from({ length: Math.ceil((to - from) / stepMinutes) }, (_, i) => {
    const m = from + i * stepMinutes, v = `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
    return { value: v, label: v }
  })

/**
 * Time picker: a TimeField (type the time, or step it with ↑/↓) plus a clock button listing times every `step` minutes
 * (15) between `from` and `to` (07:00 to 21:00), opening scrolled to the current one. The 0.3 props still work
 * (`value`, `defaultValue` "09:00", `onChange`, `step`, `from`, `to`); it also takes TimeField's `hourCycle`, `locale`,
 * `granularity`, `min`, `max` and `timeZone`. `name` submits "HH:MM" (24-hour, like <input type="time">).
 */
export function TimePicker({ defaultValue = '09:00', step = 15, from = 7 * 60, to = 21 * 60, ...rest }: TimeFieldProps) {
  return <TimeField defaultValue={defaultValue} step={step} from={from} to={to} {...rest} />
}

const datesZonedConv = (zone: string, gran: DateGranularity): DatesConv<string | null> => ({
  toWall: s => { const p = s ? datesParseISO(s) : null; return !p ? null : p.at !== undefined ? zonedParts(p.at, zone) : p.wall },
  fromWall: w => toZonedISO(zonedDate(gran === 'day' ? { year: w.year, month: w.month, day: w.day } : w, zone), zone),
  key: s => s ?? '', empty: null,
})
/** An instant from a Date or an ISO string (an ISO string without an offset is read as wall time in `zone`). */
const datesInstant = (x: string | Date | null | undefined, zone: string) => {
  if (!x) return null
  if (x instanceof Date) return +x
  const p = datesParseISO(x)
  return !p ? null : p.at ?? +zonedDate(p.wall, zone)
}

/** Props of DateTimeField and DateTimePicker. */
export type DateTimeFieldProps = FormControlProps & {
  /** ISO 8601 with offset, "2026-11-08T09:30:00+01:00" (a Date, or ISO without offset, is read in `timeZone`); null when empty */
  value?: string | Date | null; defaultValue?: string | Date | null
  /** the new value (same format, always with the offset) and, for convenience, the instant and the zone */
  onChange?: (iso: string | null, detail: { date: Date | null; timeZone: string }) => void
  /** IANA zone the wall time is in (default: UIProvider's, else the browser's) */ timeZone?: string
  /** 'day' | 'hour' | 'minute' (default) | 'second' */ granularity?: DateGranularity
  hourCycle?: 12 | 24 | HourCycle; locale?: string
  /** earliest and latest instant (ISO or Date) */ min?: string | Date | null; max?: string | Date | null
  /** calendar days (in the zone) that can't be picked */ isDateUnavailable?: (d: Date) => boolean
  /** show the zone's short name after the time (default: when `timeZone` is set) */ showTimeZone?: boolean
  /** also submit the zone under this field name ("Europe/Zurich") */ timeZoneName?: string
  'aria-label'?: string; className?: string; ref?: Ref<HTMLInputElement>
}

/** DateTimeField and DateTimePicker in one: the picker adds the calendar popover and, with `timeZonePicker`, a zone picker. */
function DatesDateTime({ picker, timeZonePicker, defaultTimeZone, onTimeZoneChange, weekStartsOn, numberOfMonths, value, defaultValue = null, onChange, timeZone: tzProp,
  granularity = 'minute', hourCycle, locale, min, max, isDateUnavailable, showTimeZone, timeZoneName, className, 'aria-label': ariaLabel, ref, ...fp }: DateTimeFieldProps & {
    picker: boolean; timeZonePicker?: boolean; defaultTimeZone?: string; onTimeZoneChange?: (tz: string) => void; weekStartsOn?: WeekDay; numberOfMonths?: 1 | 2 | 3 }) {
  const [zoneInner, setZoneInner] = useState(defaultTimeZone)
  const L = useDatesLocale({ locale, hourCycle, timeZone: tzProp ?? zoneInner })
  const zone = L.timeZone, h12 = granularity !== 'day' && L.h12
  const norm = (v: string | Date | null | undefined) => v === undefined ? undefined : !v ? null : v instanceof Date ? toZonedISO(v, zone) : v
  const first = useRef<HTMLInputElement>(null), onReset = useRef(() => {})
  const fc = useFormControl<string | null>({ ...fp, value: norm(value), defaultValue: norm(defaultValue) ?? null, serialize: v => v ?? '', focus: () => first.current?.focus(), onReset: () => onReset.current(),
    onChange: onChange && (v => onChange(v, { date: v ? new Date(v) : null, timeZone: zone })) })
  const tpl = datesTemplate(L.locale, true, granularity, h12)
  const conv = useMemo(() => datesZonedConv(zone, granularity), [zone, granularity])
  const seg = useDatesSegValue(fc, conv, tpl, h12, `${L.locale}|${granularity}|${h12}|${zone}`)
  useLayoutEffect(() => { onReset.current = () => { seg.resetTo(norm(defaultValue) ?? null); if (tzProp === undefined) setZoneInner(defaultTimeZone) } })
  const [editing, setEditing] = useState(false), [flagged, setFlagged] = useState(false)
  useEffect(() => setFlagged(false), [fc.value, seg.partial])
  const [open, setOpen] = useState(false)
  const locked = fc.disabled || fc.readOnly
  // a pasted value with an offset is an instant: show it in this zone
  const parse = (text: string) => { const p = datesParseISO(datesAscii(text)); return p?.at !== undefined ? datesToVals(zonedParts(p.at, zone), h12) : datesParseText(text, tpl, L.locale, h12) }
  // validation, on the instant (and the calendar day in the zone)
  const at = datesInstant(fc.value, zone), lo = datesInstant(min, zone), hi = datesInstant(max, zone)
  const fmtAt = (t: number) => datesDF(L.locale, { timeZone: zone, day: 'numeric', month: 'short', year: 'numeric', ...(granularity !== 'day' && { hour: 'numeric', minute: '2-digit', hourCycle: h12 ? 'h12' : 'h23' }) }).format(t)
  const wallDay = seg.wall ? datesLocal(seg.wall.year, seg.wall.month, seg.wall.day) : null
  const range = at === null ? null : lo !== null && at < lo ? L.t('date.tooEarly', 'Choose {date} or later', { date: fmtAt(lo) }) : hi !== null && at > hi ? L.t('date.tooLate', 'Choose {date} or earlier', { date: fmtAt(hi) })
    : wallDay && isDateUnavailable?.(wallDay) ? L.t('date.unavailable', 'That date isn’t available') : null
  const problem = range ?? (seg.partial ? L.t('date.incomplete', 'Enter a complete date') : null)
  const changeZone = (z: string) => {
    if (!z || locked) return
    if (tzProp === undefined) setZoneInner(z)
    onTimeZoneChange?.(z)
    if (seg.wall) fc.set(toZonedISO(zonedDate(seg.wall, z), z)) // same wall time, new offset
  }
  const timeSegs = datesShown(tpl).filter(t => t === 'hour' || t === 'minute' || t === 'second' || t === 'dayPeriod')
  const pickDay = (d: Date) => {
    const v: DatesVals = { ...seg.vals, year: d.getFullYear(), month: d.getMonth() + 1, day: d.getDate() }
    for (const t of timeSegs) if (v[t] == null) v[t] = t === 'hour' && h12 ? 12 : 0
    seg.onVals(v)
  }
  const w = seg.wall
  const timeValue = w && granularity !== 'day' ? `${datesPad(w.hour)}:${datesPad(w.minute)}${granularity === 'second' ? `:${datesPad(w.second)}` : ''}` : ''
  const zp = (t: number | null) => (t === null ? null : (() => { const p = zonedParts(t, zone); return datesLocal(p.year, p.month, p.day) })())
  const showZone = showTimeZone ?? (!!tzProp || timeZonePicker)
  const zoneLabel = showZone && granularity !== 'day' ? datesZoneName(L.locale, zone, at ?? Date.now()) : null
  const field = (
    <DatesSegments tpl={tpl} vals={seg.vals} onVals={seg.onVals} locale={L.locale} h12={h12} seed={datesSeed(h12)} emptyText={L.t('date.empty', 'Empty')} parse={parse} icon={picker ? undefined : 'calendar'}
      disabled={fc.disabled} readOnly={fc.readOnly} invalid={fc.invalid || flagged || (!!range && !editing)} required={fc.required}
      id={fc.control.id} labelledBy={fc.labelledBy} aria-label={ariaLabel} describedBy={fc.control['aria-describedby']} inputRef={formsMergeRefs(first, ref)} onFocusChange={setEditing}
      onKeyDown={e => { if (picker && e.altKey && e.key === 'ArrowDown' && !locked) { e.preventDefault(); setOpen(true) } }}
      suffix={zoneLabel && <span className="flex-none text-xs text-[var(--fg3)]">{zoneLabel}</span>}>
      {picker && <DatesCalendarButton label={L.t('date.chooseDate', 'Choose a date')} disabled={fc.disabled} readOnly={fc.readOnly} />}
    </DatesSegments>
  )
  return (
    <div className={cn('flex flex-col gap-2 sm:flex-row sm:items-start', className)} onBlur={fc.onBlur}>
      <div className="relative min-w-0 flex-1">
        {picker ? (
          <Popover open={open && !locked} onOpenChange={setOpen} className="!block">
            {field}
            <PopoverContent className="p-3" aria-label={L.t('date.chooseDateTime', 'Choose date and time')}>
              {/* the popover's own controls are not the form field: keep FormField's name and id from reaching them */}
              <FormFieldContext.Provider value={null}>
                <Calendar selected={wallDay} onSelect={pickDay} autoFocus min={zp(lo)} max={zp(hi)} isDateUnavailable={isDateUnavailable} weekStartsOn={weekStartsOn} locale={L.locale} numberOfMonths={numberOfMonths} />
                <div className="mt-2 flex items-center gap-2 border-t border-[var(--line)] pt-2">
                  {granularity !== 'day' && (
                    <TimeField aria-label={L.t('date.time', 'Time')} value={timeValue} locale={L.locale} hourCycle={h12 ? 12 : 24} granularity={granularity === 'second' ? 'second' : granularity === 'hour' ? 'hour' : 'minute'}
                      className="min-w-0 flex-1" onChange={t => {
                        const tw = datesTimeConv('second').toWall(t)
                        if (!tw) return
                        const base = w ?? (() => { const p = zonedParts(Date.now(), zone); return { year: p.year, month: p.month, day: p.day } })()
                        seg.onVals({ ...seg.vals, ...datesToVals({ year: base.year, month: base.month, day: base.day, ...tw }, h12) })
                      }} />
                  )}
                  <Button size="sm" variant="primary" className="ms-auto" onClick={() => setOpen(false)}>{L.t('common.done', 'Done')}</Button>
                </div>
              </FormFieldContext.Provider>
            </PopoverContent>
          </Popover>
        ) : field}
        {!fc.disabled && <DatesValidity message={problem} name={fc.name} form={fp.form} focus={() => first.current?.focus()} onInvalid={() => setFlagged(true)} />}
        {fc.inputs}
        {timeZoneName && !fc.disabled && <input type="hidden" name={timeZoneName} form={fp.form} value={zone} />}
      </div>
      {timeZonePicker && (
        <FormFieldContext.Provider value={null}>
          <TimeZonePicker aria-label={L.t('date.timeZone', 'Time zone')} value={zone} onChange={changeZone} disabled={fc.disabled} readOnly={fc.readOnly} at={at ?? undefined} className="sm:w-[250px]" />
        </FormFieldContext.Provider>
      )}
    </div>
  )
}

/** The calendar button inside a DateTimePicker's field: the Popover trigger (Escape returns focus here). */
function DatesCalendarButton({ label, disabled, readOnly }: { label: string; disabled: boolean; readOnly: boolean }) {
  const { open, setOpen, triggerRef, id } = usePopover()
  return (
    <button type="button" ref={triggerRef} aria-label={label} aria-haspopup="dialog" aria-expanded={open} aria-controls={id} disabled={disabled} onClick={() => { if (!readOnly) setOpen(!open) }}
      className={cn('-me-1 grid h-7 w-7 flex-none place-items-center rounded-[var(--r-md)] border-0 bg-transparent text-[var(--fg3)] [@media(pointer:coarse)]:h-8 [@media(pointer:coarse)]:w-8',
        disabled || readOnly ? 'cursor-default' : 'cursor-pointer hover:bg-[var(--muted)] hover:text-[var(--fg)]')}>
      <Icon name="calendar" size={15} />
    </button>
  )
}

/**
 * Typed date and time in one field: the locale's date segments, then hour, minute (second) and am/pm, then the time
 * zone's short name. Same keys as DateField and TimeField; pasting an ISO string with an offset shows that instant in
 * `timeZone`. `granularity` 'day' | 'hour' | 'minute' | 'second'. Value: an ISO 8601 string with the offset of `timeZone`
 * at that instant, "2026-11-08T09:30:00+01:00" (so `new Date(value)` is the instant and the wall time is readable);
 * around daylight-saving changes a skipped time moves forward and a repeated one takes the first. null while empty or
 * incomplete. `min`/`max` (instants) and `isDateUnavailable` mark it invalid. Form-native: `name` submits the ISO string
 * ('' when empty), `timeZoneName` also submits the zone, plus `required`, `disabled`, `readOnly`, `invalid`, `onBlur`,
 * `form`, and `ref` on the first segment.
 */
export function DateTimeField(props: DateTimeFieldProps) {
  return <DatesDateTime {...props} picker={false} />
}

/**
 * Date and time picker: a DateTimeField with a calendar button (or Alt+↓) opening the Calendar with a TimeField under it,
 * and with `timeZonePicker` a searchable time-zone picker beside it. Same value as DateTimeField: an ISO 8601 string with
 * the zone's offset, "2026-11-08T09:30:00+01:00". Picking another zone keeps the wall time (09:30 stays 09:30, the offset
 * changes) and calls `onTimeZoneChange`; `timeZone` controls the zone, `defaultTimeZone` seeds it. Picking a day with no
 * time yet sets midnight. Takes the Calendar's `weekStartsOn` and `numberOfMonths`. Form-native like DateTimeField.
 */
export function DateTimePicker(props: DateTimeFieldProps & {
  /** show a time-zone picker next to the field */ timeZonePicker?: boolean; /** the zone at first (uncontrolled) */ defaultTimeZone?: string
  onTimeZoneChange?: (tz: string) => void; weekStartsOn?: WeekDay; numberOfMonths?: 1 | 2 | 3 }) {
  return <DatesDateTime {...props} picker />
}

/** Every IANA zone the runtime knows (plus UTC) as options sorted by their offset at `at`: "(GMT+01:00) Europe/Zurich". */
export function timeZoneOptions(at: Date | number = Date.now(), zones?: string[]): Option[] {
  let list = zones ?? (typeof Intl.supportedValuesOf === 'function' ? Intl.supportedValuesOf('timeZone') : ['UTC', 'Europe/London', 'Europe/Zurich', 'America/New_York', 'Asia/Tokyo'])
  if (!list.includes('UTC')) list = ['UTC', ...list]
  return list.map(z => ({ z, off: zoneOffset(z, at) })).sort((x, y) => x.off - y.off || x.z.localeCompare(y.z))
    .map(({ z, off }) => ({ value: z, label: `(GMT${datesOffsetText(off)}) ${z.replace(/_/g, ' ')}` }))
}

/**
 * Searchable time-zone picker: a Combobox of `Intl.supportedValuesOf('timeZone')` (about 420 zones, virtualised),
 * labelled with their current offset, "(GMT+01:00) Europe/Zurich", and sorted by it; type a city or "GMT+05". `zones`
 * limits the list, `at` is the instant the offsets are for (default now). Value: the IANA name. Form-native like Combobox.
 */
export function TimeZonePicker({ zones, at, placeholder, ...p }: Omit<Parameters<typeof Combobox>[0], 'options' | 'loadOptions'> & { zones?: string[]; at?: Date | number }) {
  const t = at === undefined ? undefined : +at
  const hour = Math.floor((t ?? Date.now()) / 36e5) // offsets only change on the hour
  const options = useMemo(() => timeZoneOptions(t ?? hour * 36e5, zones), [hour, zones]) // eslint-disable-line react-hooks/exhaustive-deps
  const L = useDatesLocale({})
  return <Combobox options={options} placeholder={placeholder ?? L.t('date.searchTimeZones', 'Search time zones')} {...p} />
}

/**
 * Month and year picker: a field that opens a grid of months (its title opens a grid of years), in the locale.
 * `min`/`max` disable months outside them. Value: a Date on the first of the month (null when empty). Form-native:
 * `name` submits "2026-11" (like <input type="month">), `required`, `disabled`, `readOnly`, `invalid`, `onBlur`, `form`, `ref`.
 */
export function MonthPicker({ value, defaultValue = null, onChange, min, max, locale, placeholder, className, ref, ...fp }: FormControlProps &
  { value?: Date | null; defaultValue?: Date | null; onChange?: (d: Date | null) => void; min?: Date | null; max?: Date | null; locale?: string; placeholder?: string; className?: string; ref?: Ref<HTMLButtonElement> }) {
  const L = useDatesLocale({ locale })
  const btn = useRef<HTMLButtonElement>(null)
  const fc = useFormControl<Date | null>({ ...fp, value, defaultValue, onChange, serialize: d => (d ? `${datesPad(d.getFullYear(), 4)}-${datesPad(d.getMonth() + 1)}` : ''), focus: () => btn.current?.focus() })
  const d = fc.value
  const [open, setOpen] = useState(false)
  const [view, setView] = useState<'months' | 'years'>('months')
  const [year, setYear] = useState(() => (d ?? new Date()).getFullYear())
  const show = (o: boolean) => { if (o) { setView('months'); setYear((d ?? new Date()).getFullYear()) } setOpen(o) }
  return (
    <span className={cn('relative block', className)} onBlur={fc.onBlur}>
      <Popover open={open && !fc.disabled && !fc.readOnly} onOpenChange={show} className="!block">
        <FormsTrigger icon="calendar" fc={fc} ref={formsMergeRefs(btn, ref)}>
          <span className={cn('truncate', !d && 'text-[var(--fg3)]')}>{d ? datesDF(L.locale, { month: 'long', year: 'numeric' }).format(d) : placeholder ?? L.t('date.pickMonth', 'Pick a month')}</span>
        </FormsTrigger>
        <PopoverContent className="p-3" aria-label={L.t('date.chooseMonth', 'Choose a month')}>
          <div className="h-[232px] w-[252px] max-w-full [@media(pointer:coarse)]:h-[280px] [@media(pointer:coarse)]:w-[280px]">
            {view === 'months'
              ? <DatesMonthGrid key={year} locale={L.locale} year={year} onYear={setYear} selected={d && { year: d.getFullYear(), month: d.getMonth() }} min={min} max={max} t={L.t}
                onTitle={() => setView('years')} onPick={m => { fc.set(new Date(year, m, 1)); setOpen(false) }} />
              : <DatesYearGrid locale={L.locale} year={year} selected={d?.getFullYear()} min={min} max={max} t={L.t} onPick={y => { setYear(y); setView('months') }} onEscape={() => setView('months')} />}
          </div>
        </PopoverContent>
      </Popover>
      {fc.inputs}
    </span>
  )
}

/**
 * Year picker: a field that opens a grid of twelve years (arrows page past the edges). `min`/`max` disable years outside
 * them. Value: the year as a number (null when empty). Form-native: `name` submits "2026", `required`, `disabled`,
 * `readOnly`, `invalid`, `onBlur`, `form`, `ref`.
 */
export function YearPicker({ value, defaultValue = null, onChange, min, max, locale, placeholder, className, ref, ...fp }: FormControlProps &
  { value?: number | null; defaultValue?: number | null; onChange?: (y: number | null) => void; min?: Date | null; max?: Date | null; locale?: string; placeholder?: string; className?: string; ref?: Ref<HTMLButtonElement> }) {
  const L = useDatesLocale({ locale })
  const btn = useRef<HTMLButtonElement>(null)
  const fc = useFormControl<number | null>({ ...fp, value, defaultValue, onChange, serialize: y => (y == null ? '' : String(y)), focus: () => btn.current?.focus() })
  const y = fc.value
  const [open, setOpen] = useState(false)
  return (
    <span className={cn('relative block', className)} onBlur={fc.onBlur}>
      <Popover open={open && !fc.disabled && !fc.readOnly} onOpenChange={setOpen} className="!block">
        <FormsTrigger icon="calendar" fc={fc} ref={formsMergeRefs(btn, ref)}>
          <span className={cn('truncate', y == null && 'text-[var(--fg3)]')}>{y != null ? datesNum(L.locale, y) : placeholder ?? L.t('date.pickYear', 'Pick a year')}</span>
        </FormsTrigger>
        <PopoverContent className="p-3" aria-label={L.t('date.chooseYearTitle', 'Choose a year')}>
          <div className="h-[232px] w-[252px] max-w-full [@media(pointer:coarse)]:h-[280px] [@media(pointer:coarse)]:w-[280px]">
            <DatesYearGrid locale={L.locale} year={y ?? new Date().getFullYear()} selected={y} min={min} max={max} t={L.t} onPick={n => { fc.set(n); setOpen(false) }} />
          </div>
        </PopoverContent>
      </Popover>
      {fc.inputs}
    </span>
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
 * Form-native: with `name`, the files in the list (picked or dropped) are submitted as a native file field (multipart
 * FormData / server actions; `defaultFiles` have no content and aren't sent); `required` (at least one file), `disabled`,
 * `invalid`, `onBlur`, `form`, and `ref` on the drop zone. Reset restores `defaultFiles`.
 */
export function FileUpload({ onFiles, onReject, accept, multiple = true, hint = 'Any type, up to 20 MB', defaultFiles = [], upload, className, name, ref, ...fp }: Omit<FormControlProps, 'readOnly'> &
  { onFiles?: (f: File[]) => void; /** files dropped or picked that don't match `accept` */ onReject?: (f: File[]) => void; accept?: string; multiple?: boolean; hint?: string; defaultFiles?: { name: string; size: number }[]
    /** upload one file for real, reporting 0–100 progress; a rejected promise marks the row failed */ upload?: FormsUploader; className?: string; ref?: Ref<HTMLButtonElement> }) {
  const [files, setFiles] = useState<FormsFile[]>(() => defaultFiles.map(f => ({ ...f, id: ++formsFileSeq })))
  const [over, setOver] = useState(false)
  const [skipped, setSkipped] = useState<string | null>(null)
  const input = useRef<HTMLInputElement>(null), zone = useRef<HTMLButtonElement>(null)
  const fc = useFormControl<number>({ ...fp, value: files.length, defaultValue: defaultFiles.length, serialize: () => null, filled: n => n > 0, focus: () => zone.current?.focus(),
    onReset: () => { setFiles(defaultFiles.map(f => ({ ...f, id: ++formsFileSeq }))); setSkipped(null) } })
  const fieldName = name ?? fc.field?.name
  useEffect(() => { // the native file input carries the list, so the form submits the files
    const el = input.current
    if (!el || !fieldName || typeof DataTransfer === 'undefined') return
    try { const dt = new DataTransfer(); files.forEach(f => { if (f.file) dt.items.add(f.file) }); el.files = dt.files } catch { /* very old browsers: nothing to submit */ }
  }, [files, fieldName])
  const add = (list: FileList | null) => {
    if (!list?.length || fc.disabled) return
    const all = [...list], ok = all.filter(f => fileAccepts(f, accept)), bad = all.filter(f => !ok.includes(f))
    const f = multiple ? ok : ok.slice(0, 1)
    setSkipped(bad.length ? `${bad.length === 1 ? `“${bad[0].name}” isn’t` : `${bad.length} files aren’t`} an accepted type${accept ? ` (${accept})` : ''}` : null)
    if (bad.length) onReject?.(bad)
    if (!f.length) return
    fc.set(files.length + f.length) // marks a user edit: the form hears input/change
    setFiles(x => [...f.map(file => ({ id: ++formsFileSeq, name: file.name, size: file.size, file })).reverse(), ...x]); onFiles?.(f)
  }
  return (
    <div className={cn('relative flex flex-col', className)} onBlur={fc.onBlur}>
      <motion.button ref={formsMergeRefs(zone, ref)} type="button" {...fc.control} disabled={fc.disabled} animate={{ scale: over ? 1.02 : 1 }} transition={spring(0.3, 0.3)} onClick={() => input.current?.click()}
        onDragOver={e => { e.preventDefault(); if (!fc.disabled) setOver(true) }} onDragLeave={() => setOver(false)}
        onDrop={e => { e.preventDefault(); setOver(false); add(e.dataTransfer.files); play(zone.current, { scale: [0.98, 1] }, spring(0.4, 0.3)) }}
        className={cn('mb-1 flex cursor-pointer flex-col items-center gap-1 rounded-[var(--r-md)] border-[1.5px] border-dashed p-4 text-center text-[13px] text-[var(--fg2)] transition-colors disabled:cursor-not-allowed disabled:bg-[var(--muted)] disabled:text-[var(--fg3)]',
          over ? 'border-[var(--accent)] bg-[var(--accent-soft)]' : fc.invalid ? 'border-[var(--bad)] bg-transparent' : 'border-[var(--line2)] bg-transparent hover:bg-[var(--muted)] disabled:hover:bg-[var(--muted)]')}>
        <Icon name="upload" size={20} className="text-[var(--fg3)]" />
        <span className="[@media(hover:none)]:hidden"><b className="font-medium text-[var(--fg)]">Drop files</b> or click to browse</span>
        <span className="hidden [@media(hover:none)]:inline"><b className="font-medium text-[var(--fg)]">Tap to choose files</b></span>
        <span className="text-xs text-[var(--fg3)]">{hint}</span>
      </motion.button>
      <input ref={input} type="file" hidden accept={accept} multiple={multiple} name={fieldName} form={fp.form} disabled={fc.disabled} onChange={e => { add(e.target.files); e.target.value = '' }} />
      {skipped && <p role="status" className="m-0 mb-1 text-xs text-[var(--bad)]">{skipped}</p>}
      <AnimatePresence initial={false}>
        {files.map(f => <FormsFileRow key={f.id} f={f} upload={upload} onRemove={() => { fc.set(files.length - 1); setFiles(x => x.filter(y => y.id !== f.id)) }} />)}
      </AnimatePresence>
      {fc.inputs}
    </div>
  )
}

/* Colour ────────────────────────────────────────────────────────────────────── */

const formsHexOk = (s: string) => /^#[0-9a-f]{6}$/i.test(s)

/**
 * Swatches, a hue slider and a hex field. The preview pops when a swatch or hex changes it (not while dragging hue).
 * Form-native: `name` submits "#RRGGBB" (upper case; the last valid colour while the hex field holds a typo), `required`,
 * `disabled`, `readOnly` (shows the colour and hex only), `invalid`, `onBlur`, `form`, and `ref` on the hex field.
 */
export function ColorPicker({ value, defaultValue = '#2563EB', onChange, swatches = ['#18181B', '#2563EB', '#0891B2', '#16A34A', '#CA8A04', '#F97316', '#DC2626', '#DB2777'], className, ref, ...fp }: FormControlProps &
  { value?: string; defaultValue?: string; onChange?: (v: string) => void; swatches?: string[]; className?: string; ref?: Ref<HTMLInputElement> }) {
  const hexRef = useRef<HTMLInputElement>(null)
  const fc = useFormControl<string>({ ...fp, value: value?.toUpperCase(), defaultValue: defaultValue.toUpperCase(), onChange, serialize: x => x, focus: () => hexRef.current?.focus() })
  const c = fc.value, set = fc.set, locked = fc.disabled || fc.readOnly
  const [text, setText] = useState(c), [pops, setPops] = useState(0)
  const [hue, setHue] = useState(() => hex2hue(c))
  const group = useId()
  const own = useRef(c) // a new `value` from outside (not our own echo) refreshes the hex field and hue
  useEffect(() => { if (c === own.current) return; own.current = c; setText(c); if (formsHexOk(c)) setHue(hex2hue(c)) }, [c])
  const apply = (hex: string, src: 'swatch' | 'hex' | 'hue') => {
    if (locked) return
    const h = hex.toUpperCase(); own.current = h; set(h)
    if (src !== 'hex') setText(h)
    if (src !== 'hue') { setHue(hex2hue(h)); setPops(n => n + 1) }
  }
  return (
    <div className={cn('relative flex flex-col gap-3', className)} onBlur={fc.onBlur}>
      <div className="flex items-center gap-3">
        <motion.span key={pops} initial={pops ? { scale: 0.85, rotate: -8 } : false} animate={{ scale: 1, rotate: 0 }} transition={spring(0.5, 0.4)}
          className="h-10 w-10 flex-none rounded-[var(--r-lg)] shadow-[inset_0_0_0_1px_rgba(0,0,0,.08)]" style={{ background: c }} aria-hidden />
        <FormFieldContext.Provider value={null}>
          <Input ref={formsMergeRefs(hexRef, ref)} id={fc.control.id} aria-describedby={fc.control['aria-describedby']} value={text} onChange={e => { setText(e.target.value); const v = e.target.value.trim(); if (formsHexOk(v)) apply(v, 'hex') }}
            invalid={!formsHexOk(text.trim()) || fc.invalid} disabled={fc.disabled} readOnly={fc.readOnly} required={fc.required} spellCheck={false} className="!h-8 font-[family-name:var(--mono)]"
            aria-label={fc.labelledBy ? undefined : 'Hex colour'} />
        </FormFieldContext.Provider>
      </div>
      <input type="range" min={0} max={360} value={hue} aria-label="Hue" disabled={locked} onChange={e => { const h = +e.target.value; setHue(h); apply(hsl2hex(h, 83, 53), 'hue') }}
        className="h-2.5 w-full disabled:cursor-not-allowed disabled:opacity-40 cursor-pointer appearance-none rounded-full bg-clip-content [@media(pointer:coarse)]:box-content [@media(pointer:coarse)]:-my-[11px] [@media(pointer:coarse)]:py-[11px] [@media(pointer:coarse)]:[&::-webkit-slider-thumb]:h-6 [@media(pointer:coarse)]:[&::-webkit-slider-thumb]:w-6 [@media(pointer:coarse)]:[&::-moz-range-thumb]:h-6 [@media(pointer:coarse)]:[&::-moz-range-thumb]:w-6 [&::-moz-range-thumb]:h-4 [&::-moz-range-thumb]:w-4 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-2 [&::-moz-range-thumb]:border-[rgba(0,0,0,.25)] [&::-moz-range-thumb]:bg-white [&::-webkit-slider-thumb]:h-[18px] [&::-webkit-slider-thumb]:w-[18px] [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-[rgba(0,0,0,.25)] [&::-webkit-slider-thumb]:bg-white"
        style={{ backgroundImage: 'linear-gradient(90deg,#f00,#ff0,#0f0,#0ff,#00f,#f0f,#f00)' }} />
      <div className="flex flex-wrap gap-2 [@media(pointer:coarse)]:grid [@media(pointer:coarse)]:grid-cols-[repeat(auto-fill,minmax(32px,1fr))] [@media(pointer:coarse)]:justify-items-center [@media(pointer:coarse)]:gap-1.5">
        {swatches.map(s => {
          const on = s.toUpperCase() === c
          return (
            <button type="button" key={s} aria-label={s} aria-pressed={on} disabled={locked} onClick={() => apply(s, 'swatch')} className="relative h-7 w-7 cursor-pointer rounded-full border-0 p-0 disabled:cursor-not-allowed [@media(pointer:coarse)]:h-8 [@media(pointer:coarse)]:w-8" style={{ background: s }}>
              {on && <motion.span layoutId={group} className="absolute -inset-1 rounded-full border-2" style={{ borderColor: s }} transition={spring(0.3, 0.35)} />}
            </button>
          )
        })}
      </div>
      {fc.inputs}
    </div>
  )
}

/* Range ─────────────────────────────────────────────────────────────────────── */

/**
 * Two-thumb slider for a range. Drag either thumb (mouse or touch), click the track to move the nearest thumb there,
 * or use arrows / PageUp / PageDown / Home / End. `minGap` keeps the thumbs apart. The readout rolls (pass `format` to change it).
 * Form-native: `name` submits two fields, low then high ("200", "750"; read with formData.getAll), `disabled` (the track
 * and thumbs fade, the label stays legible), `readOnly`, `invalid`, `onBlur`, `form`, and `ref` on the low thumb.
 */
export function RangeSlider({ value, defaultValue = [20, 80], onChange, min = 0, max = 100, step = 1, minGap = 0, label, format = v => <AnimatedNumber value={v} />, valueText = String, className, ref, ...fp }: FormControlProps &
  { value?: [number, number]; defaultValue?: [number, number]; onChange?: (v: [number, number]) => void; min?: number; max?: number; step?: number; minGap?: number
    label?: string; format?: (v: number) => ReactNode; valueText?: (v: number) => string; className?: string; ref?: Ref<HTMLButtonElement> }) {
  const track = useRef<HTMLDivElement>(null), thumbs = useRef<(HTMLButtonElement | null)[]>([])
  const fc = useFormControl<[number, number]>({ ...fp, value, defaultValue, onChange, serialize: r => [String(r[0]), String(r[1])], focus: () => thumbs.current[0]?.focus() })
  const v = fc.value, set = fc.set, locked = fc.disabled || fc.readOnly
  const live = useRef(v)
  useLayoutEffect(() => { live.current = v }, [v])
  const [dragging, setDragging] = useState<0 | 1 | null>(null)
  const pct = (n: number) => clamp(((n - min) / (max - min || 1)) * 100, 0, 100)
  const snap = (n: number) => clamp(Math.round((n - min) / step) * step + min, min, max)
  const move = (k: 0 | 1, n: number) => {
    if (locked) return
    const cur = live.current, x = snap(n), next: [number, number] = [cur[0], cur[1]]
    next[k] = k === 0 ? Math.max(min, Math.min(x, cur[1] - minGap)) : Math.min(max, Math.max(x, cur[0] + minGap))
    if (next[k] !== cur[k]) { live.current = next; set(next) }
  }
  const valAt = (x: number) => { const r = track.current?.getBoundingClientRect(); return r ? min + ((x - r.left) / (r.width || 1)) * (max - min) : min }
  const thumb = useRef<0 | 1>(0)
  const thumbDrag = usePointerDrag({ onMove: p => move(thumb.current, valAt(p.x)), onEnd: () => setDragging(null), cursor: 'grabbing' })
  const startDrag = (k: 0 | 1, e: React.PointerEvent) => {
    if (e.button !== 0 || locked) return
    e.preventDefault(); thumbs.current[k]?.focus(); thumb.current = k; setDragging(k)
    thumbDrag.start(e, thumbs.current[k])
  }
  const onTrackDown = (e: React.PointerEvent) => {
    if (locked) return
    const n = valAt(e.clientX), d0 = Math.abs(n - v[0]), d1 = Math.abs(n - v[1])
    const k: 0 | 1 = d0 < d1 ? 0 : d1 < d0 ? 1 : n < v[0] ? 0 : 1
    move(k, n); startDrag(k, e)
  }
  const thumbLabel = (k: 0 | 1) => `${k ? 'Maximum' : 'Minimum'}${label ? ' ' + label.toLowerCase() : ''}`
  return (
    <div role="group" aria-label={label} aria-labelledby={label ? undefined : fc.labelledBy} aria-disabled={fc.disabled || undefined} id={fc.control.id} aria-describedby={fc.control['aria-describedby']}
      className={cn('relative', className)} onBlur={fc.onBlur}>
      {label && <div className="mb-2 flex justify-between text-[13px]"><span className={fc.disabled ? 'text-[var(--fg3)]' : 'text-[var(--fg2)]'}>{label}</span><span className={fc.disabled ? 'text-[var(--fg3)]' : 'font-medium'}>{format(v[0])} to {format(v[1])}</span></div>}
      <div ref={track} className={cn('relative h-5 touch-none transition-opacity [@media(pointer:coarse)]:-my-1.5 [@media(pointer:coarse)]:h-8', fc.disabled ? 'cursor-not-allowed opacity-40' : fc.readOnly ? 'cursor-default' : 'cursor-pointer')} onPointerDown={onTrackDown}>
        <div className={cn('absolute inset-x-0 top-2 h-1 rounded-full [@media(pointer:coarse)]:top-3.5', fc.invalid ? 'bg-[var(--bad-soft)] shadow-[0_0_0_1px_var(--bad)]' : 'bg-[var(--muted)]')} />
        <div className="absolute top-2 h-1 rounded-full bg-[var(--primary)] [@media(pointer:coarse)]:top-3.5" style={{ left: `${pct(v[0])}%`, right: `${100 - pct(v[1])}%` }} />
        {([0, 1] as const).map(k => (
          <motion.button type="button" key={k} ref={el => { thumbs.current[k] = el; if (k === 0) formsAssignRef(ref, el) }} role="slider" aria-label={thumbLabel(k)} aria-valuemin={min} aria-valuemax={max} aria-valuenow={v[k]} aria-valuetext={valueText(v[k])}
            disabled={fc.disabled} aria-readonly={fc.readOnly || undefined} aria-invalid={fc.control['aria-invalid']}
            animate={{ scale: dragging === k ? 1.15 : 1 }} transition={spring(0.4, 0.3)}
            onPointerDown={e => { e.stopPropagation(); startDrag(k, e) }}
            onKeyDown={e => {
              const big = Math.max(step, (max - min) / 10)
              const t = ({ ArrowRight: v[k] + step, ArrowUp: v[k] + step, ArrowLeft: v[k] - step, ArrowDown: v[k] - step, PageUp: v[k] + big, PageDown: v[k] - big, Home: min, End: max } as Record<string, number>)[e.key]
              if (t !== undefined) { e.preventDefault(); move(k, t) }
            }}
            className={cn('absolute top-0 h-5 w-5 -translate-x-1/2 touch-none rounded-full border-0 bg-transparent p-0 [@media(pointer:coarse)]:h-8 [@media(pointer:coarse)]:w-8', locked ? fc.disabled ? 'cursor-not-allowed' : 'cursor-default' : dragging === k ? 'z-10 cursor-grabbing' : 'cursor-grab')} style={{ left: `${pct(v[k])}%` }}>
            <span aria-hidden className="absolute inset-0 rounded-full border-2 border-[var(--primary)] bg-[var(--card)] shadow-[0_1px_3px_rgba(0,0,0,.2)] [@media(pointer:coarse)]:inset-1" />
          </motion.button>
        ))}
      </div>
      {fc.inputs}
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
 * Form-native: `name` submits E.164 ("+41791234567"; '' while no digits are typed), `required`, `disabled`, `readOnly`,
 * `invalid`, `onBlur`, `form`, and `ref` on the number field. Reset returns to the default country and digits.
 */
export function PhoneInput({ countries = PHONE_COUNTRIES, value, defaultCountry = '+41', defaultValue = '', onChange, invalid: inv, 'aria-label': ariaLabel = 'Phone number', className, ref, ...fp }: FormControlProps &
  { countries?: PhoneCountry[]; value?: string; defaultCountry?: string; defaultValue?: string; 'aria-label'?: string; className?: string; ref?: Ref<HTMLInputElement>
    onChange?: (v: { country: PhoneCountry; national: string; e164: string }) => void }) {
  const initialCountry = () => countries.find(c => c.dial === defaultCountry) || countries[0]
  const [country, setCountry] = useState(() => (value?.startsWith('+') && phoneMatch(countries, value.slice(1).replace(/\D/g, ''))) || initialCountry())
  const [digits, setDigits] = useState(() => value?.startsWith('+') ? value.replace(/\D/g, '').slice(country.dial.length - 1) : defaultValue.replace(/\D/g, ''))
  const fc = useFormControl<string>({ ...fp, invalid: inv, value: digits ? country.dial + digits : '', defaultValue: '', serialize: x => x, focus: () => input.current?.focus(),
    onReset: () => { if (value !== undefined) return; const c = initialCountry(); setCountry(c); setDigits(defaultValue.replace(/\D/g, '').slice(0, phoneMax(c))); setPlus(null) } })
  const invalid = fc.invalid, locked = fc.disabled || fc.readOnly
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
  const pickIndex = (i: number) => { if (locked) return; fc.set(''); choose(countries[i]); setPlus(null); setOpen(false); input.current?.focus() }
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
    if (locked) return
    fc.set('') // marks a user edit (the value itself is country + digits)
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
    <div ref={wrap} className={cn('relative', className)} onBlur={fc.onBlur}>
      <div className={cn(inputShellClass(invalid), 'flex h-9 items-stretch overflow-hidden', fc.disabled ? 'cursor-not-allowed !bg-[var(--muted)] text-[var(--fg3)] hover:!border-[var(--line)]' : fc.readOnly && '!bg-[var(--muted)]')}>
        <button type="button" disabled={locked} aria-label={`Country: ${country.name} ${country.dial}`} aria-haspopup="listbox" aria-expanded={open} aria-controls={lid} aria-activedescendant={open ? `${lid}-${active}` : undefined}
          onClick={() => { setActive(countries.indexOf(country)); setOpen(!open) }}
          onKeyDown={e => {
            if (!open) { if (['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(e.key)) { e.preventDefault(); setActive(countries.indexOf(country)); setOpen(true) } return }
            if (e.key === 'Escape') { e.stopPropagation(); return setOpen(false) }
            if (e.key === 'Tab') return setOpen(false)
            if (e.key === ' ') { e.preventDefault(); return pickIndex(active) }
            if (e.key.length === 1) { const k = countries.findIndex(c => c.name.toLowerCase().startsWith(e.key.toLowerCase())); if (k >= 0) setActive(k); return }
            onKeyDown(e)
          }}
          className="flex flex-none cursor-pointer items-center gap-1 border-0 border-e border-[var(--line)] bg-[var(--muted)] px-2.5 text-sm outline-none hover:bg-[var(--line)] focus-visible:bg-[var(--line)] disabled:cursor-not-allowed disabled:hover:bg-[var(--muted)]">
          <motion.span key={`f${swaps}`} initial={swaps ? { scale: 0.5, rotate: -20 } : false} animate={{ scale: 1, rotate: 0 }} transition={spring(0.5, 0.4)} className="leading-none">{country.flag}</motion.span>
          <motion.span key={`c${swaps}`} initial={swaps ? { y: -6, opacity: 0 } : false} animate={{ y: 0, opacity: 1 }} transition={spring(0.4, 0.3)} className="ui-num text-xs text-[var(--fg2)]">{country.dial}</motion.span>
          <Icon name="chevronDown" size={10} strokeWidth={3} className="text-[var(--fg3)]" />
        </button>
        <span className="relative flex min-w-0 flex-1">
          {plus === null && <span aria-hidden className="pointer-events-none absolute inset-0 flex items-center overflow-hidden px-3 text-[13px] whitespace-pre text-transparent">{out}<span className="text-[var(--fg3)] opacity-70">{rest}</span></span>}
          <input ref={formsMergeRefs(input, ref)} {...fc.control} value={shown} onChange={onInput} inputMode="tel" autoComplete="tel-national" aria-label={fc.labelledBy && !fp['aria-labelledby'] ? undefined : ariaLabel}
            disabled={fc.disabled} readOnly={fc.readOnly} aria-required={fc.required || undefined} className="relative min-w-0 flex-1 border-0 bg-transparent px-3 text-[13px] outline-none disabled:cursor-not-allowed" />
        </span>
      </div>
      <FloatingPanel open={open} className="max-h-60 w-full overflow-auto overscroll-contain sm:w-[260px]" role="presentation">
        <OptionList id={lid} label="Country" options={options} active={active} isSelected={o => o.value === country.dial} onPick={pickIndex} onHover={setActive} />
      </FloatingPanel>
      {fc.inputs}
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
 * Form-native: `name` submits the amount as a plain number string ("1234.5", '' when empty; no separators or symbol),
 * `currencyName` also submits the currency code ("CHF"); `required`, `disabled`, `readOnly`, `invalid`, `onBlur`, `form`,
 * and `ref` on the amount field. Reset returns to `defaultValue` and `defaultCurrency`.
 */
export function CurrencyInput({ currencies = CURRENCIES, defaultCurrency, value, defaultValue, onChange, invalid: inv, className, currencyName, ref, ...fp }: FormControlProps &
  { currencies?: [string, string][]; defaultCurrency?: string; value?: number | null; defaultValue?: number; className?: string; ref?: Ref<HTMLInputElement>
    /** field name for the currency code */ currencyName?: string
    onChange?: (amount: number | null, currency: string) => void }) {
  const initialCi = () => Math.max(0, currencies.findIndex(c => c[0] === defaultCurrency))
  const [ci, setCi] = useState(initialCi)
  const [plain, setPlain] = useState(() => { const v = value ?? defaultValue; return v !== undefined && v !== null ? String(v) : '' })
  const fc = useFormControl<string>({ ...fp, invalid: inv, value: plain, defaultValue: '', serialize: x => { const n = parseFloat(x); return Number.isFinite(n) ? String(n) : '' },
    focus: () => input.current?.focus(), onReset: () => { setCi(initialCi()); if (value === undefined) setPlain(defaultValue !== undefined && defaultValue !== null ? String(defaultValue) : '') } })
  const invalid = fc.invalid, locked = fc.disabled || fc.readOnly
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
    <div className={cn('relative flex flex-col gap-1.5', className)} onBlur={fc.onBlur}>
      <div className={cn(inputShellClass(invalid), 'flex h-9 items-stretch overflow-hidden', fc.disabled ? 'cursor-not-allowed !bg-[var(--muted)] text-[var(--fg3)] hover:!border-[var(--line)]' : fc.readOnly && '!bg-[var(--muted)]')}>
        <button type="button" disabled={locked} aria-label={`Currency ${code}, change currency`} onClick={() => { const n = (ci + 1) % currencies.length; setCi(n); emit(plain, n) }}
          className="flex w-14 flex-none cursor-pointer items-center justify-center overflow-hidden border-0 border-e border-[var(--line)] bg-[var(--muted)] text-[13px] outline-none hover:bg-[var(--line)] focus-visible:bg-[var(--line)] disabled:cursor-not-allowed disabled:hover:bg-[var(--muted)]">
          <motion.b key={code} initial={{ y: -8, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={spring(0.4, 0.3)} className="font-semibold">{code}</motion.b>
        </button>
        <input ref={formsMergeRefs(input, ref)} {...fc.control} value={currencyShow(plain, seps)} inputMode="decimal" autoComplete="off" placeholder={`0${seps.decimal}00`}
          aria-label={fc.labelledBy && !fp['aria-labelledby'] ? undefined : `Amount in ${code}`} disabled={fc.disabled} readOnly={fc.readOnly} aria-required={fc.required || undefined}
          onChange={e => {
            if (locked) return
            const raw = e.target.value, at = e.target.selectionStart ?? raw.length
            const p = currencyParse(raw, seps.group)
            caret.current = [...raw.slice(at)].filter(ch => sig.test(ch) && ch !== seps.group).length
            fc.set(p); setPlain(p); emit(p, ci)
          }}
          className="min-w-0 flex-1 border-0 bg-transparent px-3 text-end font-[family-name:var(--mono)] text-[13px] outline-none placeholder:text-[var(--fg3)] disabled:cursor-not-allowed" />
      </div>
      <span className="text-xs text-[var(--fg3)]" aria-live="polite">
        {Number.isFinite(amount) && amount > 0 ? currencyTypo(new Intl.NumberFormat(locale, { style: 'currency', currency: code }).format(amount)) : 'Tap the currency to switch'}
      </span>
      {currencyName && !fc.disabled && <input type="hidden" name={currencyName} form={fp.form} value={code} />}
      {fc.inputs}
    </div>
  )
}
