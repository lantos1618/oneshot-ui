/** Form-control plumbing: FormFieldContext, useFormControl, useFormFieldProps. Part of @lyndon/ui/core. */
import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { dayKey } from './locale'
import { useControllable } from './hooks'

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


/** Serialised form value: a string, one field per array item (repeated names), or null to submit nothing. */
export type FormValue = string | string[] | null

/** A local date as submitted by the date controls: "2026-11-08", like <input type="date">; '' for none. */
export const formDate = (d?: Date | null) => d ? dayKey(d) : ''

/** Disabled look for fields and field triggers that don't use inputClass (which already carries it): muted fill and secondary text, no hover. */
export const formDisabledClass = 'disabled:cursor-not-allowed disabled:bg-[var(--muted)] disabled:text-[var(--fg3)] disabled:hover:border-[var(--line)] ' +
  'aria-disabled:cursor-not-allowed aria-disabled:bg-[var(--muted)] aria-disabled:text-[var(--fg3)] aria-disabled:hover:border-[var(--line)]'

/** Read-only look for fields that don't use inputClass: muted fill, normal text; still focusable and selectable. */
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
 *   - with `required` or a `validity` message, an invisible proxy the browser validates; when validation (or a form
 *     library) focuses it, focus moves to the real control, which shows its error state until the value (or the message)
 *     changes
 *   - an anchor that listens for the form's `reset` (uncontrolled values return to `defaultValue`) and fires bubbling
 *     `input` and `change` events on user edits, like a native field
 * `markEdited()` reports a user edit that `set` can't express (the value is derived from other state), so the form still
 * hears `input` and `change`.
 */
export function useFormControl<T>(p: FormControlProps & {
  value: T | undefined; defaultValue: T; onChange?: (v: T) => void
  serialize: (v: T) => FormValue
  /** whether `required` is met (default: something is submitted) */ filled?: (v: T) => boolean
  /** why the value can't be submitted (out of range, half typed…), shown by the browser and Form; null when it can */ validity?: (v: T) => string | null
  /** focus the real control (called when the proxy gets focus) */ focus?: () => void
  /** reset local state too (typed text, a query…) on form reset */ onReset?: () => void
  /** 'checkbox' validates like a required native checkbox (a "tick this box" message) */ kind?: 'text' | 'checkbox'
}) {
  const field = useContext(FormFieldContext)
  const f = useFormFieldProps(p)
  const [value, setValue, resetValue] = useControllable(p.value, p.defaultValue, p.onChange)
  const name = f.name
  const disabled = !!f.disabled, readOnly = !!f.readOnly, required = !!f.required
  const [failed, setFailed] = useState(false) // the browser found it invalid; cleared by the next change
  const invalid = !!f.invalid || failed
  const anchor = useRef<HTMLInputElement>(null), byUser = useRef(false), edited = useRef(false), fns = useRef(p)
  useLayoutEffect(() => { fns.current = p })
  const set = useCallback((v: T) => { if (disabled || readOnly) return; byUser.current = true; setValue(v) }, [disabled, readOnly, setValue])
  const markEdited = useCallback(() => { if (!disabled && !readOnly) edited.current = true }, [disabled, readOnly])
  const serial = p.serialize(value)
  const vals = serial === null ? [] : Array.isArray(serial) ? serial : [serial]
  const filled = p.filled ? p.filled(value) : vals.some(v => v !== '')
  const message = p.validity?.(value) ?? null
  const key = JSON.stringify([serial, message]), last = useRef(key)
  useEffect(() => {
    const changed = last.current !== key, user = byUser.current, forced = edited.current
    last.current = key; byUser.current = false; edited.current = false
    if (!changed && !forced) return
    setFailed(false)
    if (user || forced) { const a = anchor.current; a?.dispatchEvent(new Event('input', { bubbles: true })); a?.dispatchEvent(new Event('change', { bubbles: true })) }
  })
  useEffect(() => {
    const form = anchor.current?.form
    if (!form) return
    const on = () => { resetValue(); setFailed(false); fns.current.onReset?.() }
    form.addEventListener('reset', on)
    return () => form.removeEventListener('reset', on)
  }, [p.form, resetValue])
  const check = p.kind === 'checkbox'
  const inputs = (
    <>
      <input type="hidden" ref={anchor} form={p.form} />
      {name && !disabled && vals.map((v, i) => <input key={i} type="hidden" name={name} form={p.form} value={v} />)}
      {(required || message) && !disabled && !readOnly && (
        <input ref={el => el?.setCustomValidity(message ?? '')} tabIndex={-1} aria-hidden required={required} form={p.form} data-ui-field={name}
          type={check ? 'checkbox' : 'text'} {...(check ? { checked: filled } : { value: filled ? 'filled' : '' })}
          onChange={() => {}} onFocus={() => fns.current.focus?.()} onInvalid={() => setFailed(true)}
          className="pointer-events-none absolute bottom-0 start-2 m-0 h-px w-px appearance-none border-0 p-0 opacity-0" />
      )}
    </>
  )
  return {
    value, set, markEdited, name, disabled, readOnly, required, invalid, field, inputs,
    control: { id: f.id, 'aria-invalid': invalid || undefined, 'aria-describedby': f['aria-describedby'] },
    labelledBy: p['aria-labelledby'] ?? field?.labelId,
    onBlur: (e: import('react').FocusEvent<HTMLElement>) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) fns.current.onBlur?.(e) },
  }
}
