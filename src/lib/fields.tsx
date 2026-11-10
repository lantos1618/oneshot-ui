import { createContext, useContext, useEffect, useId, useRef, useState, type AriaAttributes, type FormEvent, type FormHTMLAttributes, type ReactNode, type Ref } from 'react'
import { motion } from 'motion/react'
import { FormFieldContext, type FormControlProps, type FormFieldState, useFormControl, Badge, ICONS, Icon, type IconName, cn, spring, useCoarsePointer, useRoving, composeRefs } from './core'

/**
 * Frame for composite fields (an input plus addons, chips or buttons inside one border): focus ring while anything inside
 * has focus, red ring when `invalid`. Add height and layout yourself: cn(inputShellClass(bad), 'flex h-9 items-stretch').
 */
export const inputShellClass = (invalid?: boolean) => cn('rounded-[var(--r-md)] border bg-[var(--card)] transition-[border-color,box-shadow]',
  invalid ? 'border-[var(--bad)] shadow-[0_0_0_3px_var(--bad-soft)]' : 'border-[var(--line)] hover:[&:not(:focus-within)]:border-[var(--line2)] focus-within:border-[var(--fg3)] focus-within:shadow-[0_0_0_3px_var(--muted)]')

/** Native range inputs: a thin track on desktop; on touch the input grows to a 32px hit area (padding, track drawn in the content box). */
export const rangeInputClass = 'w-full cursor-pointer appearance-none rounded-full bg-clip-content [@media(pointer:coarse)]:box-content [@media(pointer:coarse)]:py-[13px] [@media(pointer:coarse)]:-my-[13px]'

/** Form label. Inside a FormField it is wired up for you. */
export function Label({ children, htmlFor, id, className }: { children: ReactNode; htmlFor?: string; id?: string; className?: string }) {
  return <label htmlFor={htmlFor} id={id} className={cn('mb-1.5 block text-[13px] font-medium', className)}>{children}</label>
}

/** Field-level errors a Form shows under its FormFields, by field name (server errors, a schema's issues…). */
export type FormErrors = Record<string, ReactNode | undefined>
const FormsFormCtx = createContext<{ errors: FormErrors; native: Record<string, string> }>({ errors: {}, native: {} })

/** The validation message for a control the browser found invalid (the browser's own, else ours). */
const formsMessage = (el: HTMLInputElement) =>
  el.validationMessage || (!el.validity?.valueMissing ? 'Check this value' : el.type === 'checkbox' ? 'Tick this box to continue' : 'This field is required')

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
      <form ref={composeRefs(ref, outer)} noValidate={validationBehavior === 'aria'} {...rest}
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
  return { ...fc, ref: composeRefs(btn, ref) }
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
          <button type="button" key={o.value} ref={el => { refs.current[i] = el; if (i === tabStop) composeRefs(ref)(el) }} role="radio" aria-checked={on} disabled={off(i)} tabIndex={i === tabStop ? 0 : -1} onClick={() => set(o.value)}
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
        <button type="button" key={o.value} ref={el => { refs.current[i] = el; if (i === tabStop) composeRefs(ref)(el) }} role="radio" aria-checked={o.value === v} tabIndex={i === tabStop ? 0 : -1} disabled={off(i)}
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
