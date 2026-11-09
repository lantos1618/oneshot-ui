/** Form-control plumbing: FormFieldContext, useFormControl, useFormFieldProps, useControllableState. Part of @lyndon/ui/core. */
import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { dayKey } from './locale'

/* ════════════════════════════════════════════════════════════════════════════
 * FORM CONTROLS (0.3): the plumbing that makes a custom control behave like a native field (name + hidden inputs,
 * required, disabled, read-only, invalid, reset, focus, FormField ids). Used by forms.tsx; keep this section together.
 * ══════════════════════════════════════════════════════════════════════════ */

/** What a FormField hands to the control inside it: ids for the label, description and error, plus field-level flags. */
export type FormFieldState = {
  id: string; /** only when the field has a visible label */ labelId?: string; descriptionId?: string; errorId?: string
  name?: string; invalid?: boolean; required?: boolean; disabled?: boolean; readOnly?: boolean
}

/** Provided by FormField (and Field); every control reads it. Provide `null` to keep it from reaching nested controls. */
export const FormFieldContext = createContext<FormFieldState | null>(null)

/** The form props every value-holding control takes, named as on native inputs. */
export type FormControlProps = {
  /** submitted with the form through hidden inputs (each control documents its format) */ name?: string
  /** id of a <form> elsewhere on the page, like the native attribute */ form?: string
  /** the form can't be submitted while it's empty; focus moves here on a failed submit */ required?: boolean
  disabled?: boolean
  /** shows and submits the value but can't change it */ readOnly?: boolean
  /** error look plus aria-invalid */ invalid?: boolean
  /** focus left the whole control (its own list or popover counts as inside) */ onBlur?: (e: import('react').FocusEvent<HTMLElement>) => void
  id?: string; 'aria-describedby'?: string; 'aria-labelledby'?: string
}

/** Controlled-or-uncontrolled state like useControllable, plus `reset()` back to the latest `defaultValue`. */
export function useControllableState<T>(value: T | undefined, defaultValue: T, onChange?: (v: T) => void) {
  const [inner, setInner] = useState(defaultValue)
  const controlled = value !== undefined
  const def = useRef(defaultValue)
  useLayoutEffect(() => { def.current = defaultValue })
  const set = useCallback((v: T) => { if (!controlled) setInner(v); onChange?.(v) }, [controlled, onChange])
  const reset = useCallback(() => setInner(def.current), [])
  return [controlled ? value : inner, set, reset] as const
}

/** Serialised form value: a string, one field per array item (repeated names), or null to submit nothing. */
export type FormValue = string | string[] | null

/** A local date as submitted by the date controls: "2026-11-08", like <input type="date">; '' for none. */
export const formDate = (d?: Date | null) => d ? dayKey(d) : ''

/** Disabled look for fields and field triggers: muted fill and secondary text (≥4.5:1, never faded with opacity), no hover. */
export const formDisabledClass = 'disabled:cursor-not-allowed disabled:!opacity-100 disabled:bg-[var(--muted)] disabled:text-[var(--fg3)] disabled:hover:border-[var(--line)] ' +
  'aria-disabled:cursor-not-allowed aria-disabled:bg-[var(--muted)] aria-disabled:text-[var(--fg3)] aria-disabled:hover:border-[var(--line)]'

/** Read-only look for fields: muted fill, normal text; still focusable and selectable. */
export const formReadOnlyClass = 'aria-readonly:bg-[var(--muted)] read-only:bg-[var(--muted)]'

const formJoinIds = (...ids: (string | undefined | false)[]) => ids.filter(Boolean).join(' ') || undefined

/** For native inputs (Input, Textarea…): the FormField's id, name, flags and aria-describedby merged under your own props. */
export function useFormFieldProps(p: { id?: string; name?: string; required?: boolean; disabled?: boolean; readOnly?: boolean; invalid?: boolean; 'aria-describedby'?: string }) {
  const f = useContext(FormFieldContext)
  return {
    id: p.id ?? f?.id, name: p.name ?? f?.name, required: p.required ?? f?.required, disabled: p.disabled ?? f?.disabled, readOnly: p.readOnly ?? f?.readOnly,
    invalid: p.invalid ?? f?.invalid, 'aria-describedby': formJoinIds(p['aria-describedby'], f?.descriptionId, f?.errorId),
  }
}

/**
 * Everything a custom control needs to act like a native field. Returns the value and a setter (ignored while disabled or
 * read-only), the merged flags, `control` props for the focusable element (id, aria-invalid, aria-describedby),
 * `labelledBy` for controls whose focus target isn't a labelable element, `onBlur` for the root, and `inputs` to render
 * inside the root (give the root `relative`):
 *   - one hidden input per serialised value (`name`), so FormData and server actions see it; nothing while disabled
 *   - with `required`, an invisible proxy the browser validates; when validation (or a form library) focuses it, focus
 *     moves to the real control and the control shows its error state until the value changes
 *   - an anchor that listens for the form's `reset` (uncontrolled values return to `defaultValue`) and fires bubbling
 *     `input` and `change` events on user edits, like a native field
 */
export function useFormControl<T>(p: FormControlProps & {
  value: T | undefined; defaultValue: T; onChange?: (v: T) => void
  serialize: (v: T) => FormValue
  /** whether `required` is met (default: something is submitted) */ filled?: (v: T) => boolean
  /** focus the real control (called when the proxy gets focus) */ focus?: () => void
  /** reset local state too (typed text, a query…) on form reset */ onReset?: () => void
  /** 'checkbox' validates like a required native checkbox (a "tick this box" message) */ kind?: 'text' | 'checkbox'
}) {
  const field = useContext(FormFieldContext)
  const [value, setValue, resetValue] = useControllableState(p.value, p.defaultValue, p.onChange)
  const name = p.name ?? field?.name
  const disabled = !!(p.disabled ?? field?.disabled), readOnly = !!(p.readOnly ?? field?.readOnly), required = !!(p.required ?? field?.required)
  const [failed, setFailed] = useState(false) // the browser found it invalid; cleared by the next change
  const invalid = !!(p.invalid ?? field?.invalid) || failed
  const anchor = useRef<HTMLInputElement>(null), byUser = useRef(false), fns = useRef(p)
  useLayoutEffect(() => { fns.current = p })
  const set = useCallback((v: T) => { if (disabled || readOnly) return; byUser.current = true; setValue(v) }, [disabled, readOnly, setValue])
  const serial = p.serialize(value)
  const vals = serial === null ? [] : Array.isArray(serial) ? serial : [serial]
  const filled = p.filled ? p.filled(value) : vals.some(v => v !== '')
  const key = JSON.stringify(serial), last = useRef(key)
  useEffect(() => {
    const changed = last.current !== key, user = byUser.current
    last.current = key; byUser.current = false
    if (!changed) return
    setFailed(false)
    if (user) { const a = anchor.current; a?.dispatchEvent(new Event('input', { bubbles: true })); a?.dispatchEvent(new Event('change', { bubbles: true })) }
  })
  useEffect(() => {
    const f = anchor.current?.form
    if (!f) return
    const on = () => { resetValue(); setFailed(false); fns.current.onReset?.() }
    f.addEventListener('reset', on)
    return () => f.removeEventListener('reset', on)
  }, [p.form, resetValue])
  const check = p.kind === 'checkbox'
  const inputs = (
    <>
      <input type="hidden" ref={anchor} form={p.form} />
      {name && !disabled && vals.map((v, i) => <input key={i} type="hidden" name={name} form={p.form} value={v} />)}
      {required && !disabled && !readOnly && (
        <input tabIndex={-1} aria-hidden required form={p.form} data-ui-field={name} type={check ? 'checkbox' : 'text'} {...(check ? { checked: filled } : { value: filled ? 'filled' : '' })}
          onChange={() => {}} onFocus={() => fns.current.focus?.()} onInvalid={() => setFailed(true)}
          className="pointer-events-none absolute bottom-0 start-2 m-0 h-px w-px appearance-none border-0 p-0 opacity-0" />
      )}
    </>
  )
  return {
    value, set, name, disabled, readOnly, required, invalid, field, inputs,
    control: { id: p.id ?? field?.id, 'aria-invalid': invalid || undefined, 'aria-describedby': formJoinIds(p['aria-describedby'], field?.descriptionId, field?.errorId) },
    labelledBy: p['aria-labelledby'] ?? field?.labelId,
    onBlur: (e: import('react').FocusEvent<HTMLElement>) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) fns.current.onBlur?.(e) },
  }
}
