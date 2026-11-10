import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type InputHTMLAttributes, type ReactNode, type Ref, type RefObject, type TextareaHTMLAttributes } from 'react'
import { AnimatedNumber, FormFieldContext, type FormControlProps, formDisabledClass, formReadOnlyClass, useFormControl, useFormFieldProps, Button, Icon, clamp, cn, numberFormat, hex2hue, hsl2hex, inputClass, isTouch, prefersReducedMotion, spring, useCoarsePointer, useDisclosure, usePointerDrag, useListbox, plural, fmt, LOCALE, composeRefs, snapToStep, typeaheadIndex, useFlash } from './core'
import { ActiveIndicator, PresenceList, play, shake, useFlip } from './motion'
import { FloatingPanel } from './overlay'
import { FormsChip, useFormsAfterReset } from './formkit'
import { inputShellClass, rangeInputClass, useRadioGroup, type Option } from './fields'
import { OptionList } from './select'
import { MAGNET_SETTLE_CSS, type Magnet, type MagnetHit, MagnetBubble, MagnetMarks, magnetKeyDirection, useMagnet, useMagnetSettle } from './magnet'

/**
 * Text input. Set `invalid` to show the error ring; it shakes once when it becomes invalid. Your `ref` reaches the <input>.
 * Inside a FormField it takes the field's id, name, flags and aria-describedby. Disabled and read-only get a muted fill.
 */
export function Input({ invalid: inv, className, ref: outer, id, name, required, disabled, readOnly, 'aria-describedby': db, ...p }: InputHTMLAttributes<HTMLInputElement> & { invalid?: boolean; ref?: Ref<HTMLInputElement> }) {
  const ref = useRef<HTMLInputElement>(null)
  const { invalid, ...f } = useFormFieldProps({ id, name, required, disabled, readOnly, invalid: inv, 'aria-describedby': db })
  useEffect(() => { if (invalid) shake(ref.current) }, [invalid])
  return <input ref={composeRefs(ref, outer)} aria-invalid={invalid || undefined} className={cn(inputClass, className)} {...f} {...p} />
}

/** The textarea's top and bottom border (px), which scrollHeight leaves out. */
const TA_BORDER = 2
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
  useFormsAfterReset(ref, t => { setInnerLen(t.value.length); fitted.current = null; t.style.height = 'auto'; t.style.height = t.scrollHeight + TA_BORDER + 'px' })
  const fit = (anim: boolean) => {
    const t = ref.current; if (!t) return
    fitted.current = t.value
    const h0 = t.offsetHeight; t.style.height = 'auto'; const h1 = t.scrollHeight + TA_BORDER
    if (!anim || !h0 || h0 === h1 || prefersReducedMotion()) { t.style.height = h1 + 'px'; return }
    t.style.height = h1 + 'px'; t.animate?.({ height: [`${h0}px`, `${h1}px`] }, { duration: 150, easing: 'ease-out' })
  }
  useLayoutEffect(() => { if (ref.current && ref.current.value !== fitted.current) fit(false) })
  const left = maxLength ? maxLength - len : 0
  const tone = left < 5 ? 'bad' : left < 20 ? 'warn' : 'ok'
  useEffect(() => { if (maxLength && left === 0) play(countRef.current, { scale: [1.3, 1] }, spring(0.5, 0.3)) }, [left, maxLength])
  return (
    <div>
      <textarea ref={composeRefs(ref, outer)} rows={rows} maxLength={maxLength} value={value} defaultValue={defaultValue} aria-invalid={invalid || undefined} {...f}
        onChange={e => { setInnerLen(e.target.value.length); fit(true); onChange?.(e) }}
        className={cn(inputClass, 'resize-none overflow-hidden !py-2 leading-relaxed', className)} {...p} />
      {maxLength && (
        <div className="mt-1.5 flex items-center justify-end gap-1.5">
          <span ref={countRef} className={cn('ui-num inline-block text-xs transition-colors', TA_TONE[tone][0])}>{`${left} left`}</span>
          <svg width="18" height="18" viewBox="0 0 20 20" className="-rotate-90" aria-hidden>
            <circle cx="10" cy="10" r="8" fill="none" stroke="var(--line)" strokeWidth="2.5" />
            <circle cx="10" cy="10" r="8" fill="none" strokeWidth="2.5" strokeLinecap="round" strokeDasharray="50.27" className={cn('transition-[stroke,stroke-dashoffset] duration-150', TA_TONE[tone][1])}
              style={{ strokeDashoffset: 50.27 * (1 - Math.min(1, len / maxLength)) }} />
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
        <input ref={composeRefs(own, ref)} type={show ? 'text' : 'password'} aria-invalid={invalid || undefined} className={cn(inputClass, '!pe-10')} {...f} {...p}
          onChange={e => { setV(e.target.value); onChange?.(e) }} />
        <span className="absolute top-1/2 end-1 flex -translate-y-1/2">
          <Button size="icon-sm" variant="ghost" disabled={f.disabled} aria-label={(show ? 'Hide password' : 'Show password')} title={(show ? 'Hide password' : 'Show password')}
            className="text-[var(--fg3)] hover:text-[var(--fg)]" onClick={() => { setShow(!show); setFlips(f => f + 1) }}>
            <span key={flips} className={cn('grid', flips > 0 && 'ui-pop [--ui-d:.3s] [--ui-s:.7]')}>
              <Icon name={show ? 'eyeOff' : 'eye'} size={15} />
            </span>
          </Button>
        </span>
      </div>
      {strength && (
        <div className="grid grid-cols-4 gap-1" aria-hidden>
          {[0, 1, 2, 3].map(i => (
            <div key={i} className="h-1 overflow-hidden rounded-full bg-[var(--muted)]">
              <div className={cn('h-full origin-left motion-reduce:!transition-none', PW_BAR[Math.max(0, score - 1)])}
                style={{ transform: `scaleX(${i < score ? 1 : 0})`, transition: `transform .25s ease-out ${i < score && i >= from ? (i - from) * 0.05 : 0}s, background-color .15s` }} />
            </div>
          ))}
        </div>
      )}
      {rules && (
        <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs">
          {PW_RULES.map(([label], i) => (
            <span key={label + passed[i]} className={cn('inline-block transition-colors', passed[i] ? 'ui-pop text-[var(--ok)] [--ui-d:.3s] [--ui-s:.9]' : 'text-[var(--fg3)]')}>
              <span aria-hidden>{passed[i] ? '✓' : '○'} </span>{label}<span className="sr-only"> {(passed[i] ? '(met)' : '(not met)')}</span>
            </span>
          ))}
        </div>
      )}
      {strength && <span className="sr-only" aria-live="polite">{v ? `Strength ${score} of 4` : ''}</span>}
    </div>
  )
}

/**
 * Magnets on a native range input (Slider, the colour picker's hue): our own pointer drag through useMagnet (the native
 * drag is stopped on pointerdown and touchstart), the jump keys, a thumb position that settles with a spring, and focus
 * bookkeeping (we focus the input ourselves, which browsers count as focus-visible, so a pointer focus shows no ring).
 * The input stays for arrow keys, forms and screen readers. `inset` is the thumb's radius: its centre stops that far
 * short of each end. Spread `bind` on the input; draw the thumb at `thumbAt` (with MAGNET_SETTLE_CSS while `settling`).
 */
function useInputsMagnetRange({ input, magnets, min, max, step, value, locked, inset, set, describe, onSnap }: {
  input: RefObject<HTMLInputElement | null>; magnets?: readonly Magnet[] | null; min: number; max: number; step: number; value: number; locked: boolean; inset: number
  set: (v: number) => void; describe?: (v: number) => string; onSnap?: (hit: MagnetHit | null, value: number) => void }) {
  const mg = useMagnet({ magnets, min, max, step, describe, onSnap })
  const on = mg.enabled
  const live = useRef(value)
  useLayoutEffect(() => { live.current = value }, [value])
  const [dragging, setDragging] = useState(false), [kick, setKick] = useState(0), [focusVisible, setFocusVisible] = useState(false)
  const [pointerFocus, setPointerFocus] = useState(false)
  const commit = (n: number) => { if (n !== live.current) { live.current = n; set(n) } }
  const moveTo = (x: number, event: PointerEvent) => {
    const r = input.current?.getBoundingClientRect(); if (!r) return
    const w = Math.max(1, r.width - 2 * inset), f = clamp(((x - r.left) - inset) / w, 0, 1)
    const res = mg.apply(min + f * (max - min), { px: w, event })
    if (res.captured || res.released) setKick(k => k + 1)
    commit(res.value)
  }
  const drag = usePointerDrag({ onMove: p => moveTo(p.x, p.event), onEnd: () => { mg.reset(); setDragging(false) }, cursor: 'grabbing' })
  useEffect(() => {
    const el = input.current; if (!on || !el || locked) return
    // a touch drags a native range from touchstart: stop that so our drag (and its magnets) owns the gesture
    const stop = (e: TouchEvent) => { if (e.cancelable) e.preventDefault() }
    el.addEventListener('touchstart', stop, { passive: false })
    return () => el.removeEventListener('touchstart', stop)
  }, [on, locked, input])
  const { f, settling } = useMagnetSettle(clamp((value - min) / (max - min || 1), 0, 1), kick)
  const thumbAt = `calc(${inset}px + ${f} * (100% - ${2 * inset}px))`
  const bind = on ? {
    'aria-keyshortcuts': 'PageUp PageDown',
    onPointerDown: (e: React.PointerEvent<HTMLInputElement>) => {
      if (e.button !== 0 || locked) return
      e.preventDefault(); setPointerFocus(true); input.current?.focus({ preventScroll: true }); setDragging(true); mg.reset()
      drag.start(e, input.current); moveTo(e.clientX, e.nativeEvent)
    },
    onKeyDown: (e: React.KeyboardEvent<HTMLInputElement>) => {
      setPointerFocus(false); setFocusVisible(true)
      const d = magnetKeyDirection(e), to = d && !locked ? mg.next(live.current, d) : null
      if (to === null) return // not a jump key, or past the last mark: the native key does what it always did
      e.preventDefault(); commit(to); setKick(k => k + 1)
    },
    onFocus: (e: React.FocusEvent<HTMLInputElement>) => { try { setFocusVisible(!pointerFocus && e.currentTarget.matches(':focus-visible')) } catch { setFocusVisible(false) } },
    onBlurCapture: () => { setFocusVisible(false); setPointerFocus(false) },
  } : {}
  return { mg, on, dragging, focusVisible, pointerFocus, thumbAt, settling, bind }
}

/**
 * The drawn track over a magnetised native range (whose own thumb is hidden): `children` (a fill), ticks and zone bands,
 * and a thumb that springs onto marks, with the mark's label in a bubble while dragging or focused from the keyboard.
 */
function InputsMagnetOverlay({ hm, magnets, min, max, value, inset, locked, faded, className, thumbClassName, grow, children }: {
  hm: ReturnType<typeof useInputsMagnetRange>; magnets?: readonly Magnet[] | null; min: number; max: number; value: number; inset: number; locked: boolean
  faded: boolean; className: string; thumbClassName: string; /** thumb scale while dragged */ grow: number; children?: ReactNode }) {
  return (
    <span aria-hidden className={cn('pointer-events-none absolute inset-x-0 top-1/2 -translate-y-1/2 transition-opacity', faded && 'opacity-40', className)}>
      {children}
      <MagnetMarks magnets={magnets} min={min} max={max} value={value} inset={inset} />
      <span style={{ insetInlineStart: hm.thumbAt, scale: hm.dragging ? `${grow}` : undefined, transition: `scale .3s var(--ui-spring)${hm.settling ? `, inset-inline-start ${MAGNET_SETTLE_CSS}` : ''}` }}
        className={cn('absolute top-1/2 rounded-full motion-reduce:!transition-none', thumbClassName, !hm.pointerFocus && 'group-has-[input:focus-visible]/mg:shadow-[0_0_0_2px_var(--card),0_0_0_4px_var(--accent)]')}>
        <MagnetBubble label={hm.mg.at(value).label} show={(hm.dragging || hm.focusVisible) && !locked} />
      </span>
    </span>
  )
}

/** Thumb radius of the magnetised Slider (px): the native range's thumb centre stops this far short of each end. */
const SLIDER_INSET = 8
/** Thumb radius of the colour picker's hue range (px), on fine and coarse pointers. */
const HUE_INSET = 9, HUE_INSET_COARSE = 12
/** Saturation and lightness of the colour picked from the hue slider alone. */
const HUE_S = 83, HUE_L = 53

/**
 * Range slider with live value. `disabled` fades only the track (label and value stay legible in --fg3; the group gets aria-disabled). Native input: keyboard and screen readers for free, a 32px hit area on touch.
 * `steps` makes it a stepped picker over named stops (value = index; the names show under the track and can be tapped).
 * `compact` uses a smaller grey readout (settings panels).
 * `magnets` (see useMagnet) pull the thumb onto marks while dragging: ticks and zone bands on the track, the mark's label
 * in a bubble over the thumb, a spring as it settles, a tick on touch, "Snapped to …" announced. Hold Alt (Option) or put a
 * second finger down to drag freely; PageUp / PageDown and Ctrl/⌘ + arrows jump between marks, arrows still step.
 * The value stays a plain number (forms submit it as usual). `valueText` names a value for screen readers.
 */
export function Slider({ value, defaultValue, onChange, min: minProp = 0, max: maxProp = 100, step: stepProp = 1, label, format, compact, steps, magnets, onSnap, valueText, className, ref, ...fp }: FormControlProps &
  { value?: number; defaultValue?: number; onChange?: (v: number) => void; min?: number; max?: number; step?: number; label?: string; format?: (v: number) => ReactNode
    compact?: boolean; steps?: string[]; magnets?: readonly Magnet[] | null; onSnap?: (hit: MagnetHit | null, value: number) => void; valueText?: (v: number) => string; className?: string; ref?: Ref<HTMLInputElement> }) {
  const named = !!steps && steps.length > 1
  const min = named ? 0 : minProp, max = named ? steps.length - 1 : maxProp, step = named ? 1 : stepProp
  const input = useRef<HTMLInputElement>(null)
  const fit = (n: number) => snapToStep(n, { min, max, step }) // what the native range would show
  const fc = useFormControl<number>({ ...fp, value: value === undefined ? undefined : fit(value), defaultValue: fit(defaultValue ?? (named ? 0 : (min + max) / 2)), onChange, serialize: n => String(n), focus: () => input.current?.focus() })
  const v = fc.value, set = fc.set, disabled = fc.disabled, locked = disabled || fc.readOnly
  const pct = clamp(((v - min) / (max - min || 1)) * 100, 0, 100)
  const shown = named ? steps[clamp(Math.round(v), 0, steps.length - 1)] : format ? format(v) : v
  const text = (n: number) => valueText?.(n) ?? fmt.number(n)
  const hm = useInputsMagnetRange({ input, magnets: named ? null : magnets, min, max, step, value: v, locked, inset: SLIDER_INSET, set, describe: text, onSnap })
  const { mg, on, dragging, pointerFocus, thumbAt, settling, bind } = hm
  const mark = on ? mg.at(v) : null
  return (
    // disabled: only the track and thumb fade; the label and value switch to --fg3 (still ≥4.5:1, never faded with opacity)
    <div role="group" aria-label={label} aria-disabled={disabled || undefined} className={cn('relative', className)} onBlur={fc.onBlur}>
      {label && (
        <div className={cn('flex justify-between text-[13px]', compact ? 'mb-1.5' : 'mb-2')}>
          <span className={disabled ? 'text-[var(--fg3)]' : 'text-[var(--fg2)]'}>{label}</span>
          <span className={cn('ui-num', compact || disabled ? 'text-[var(--fg3)]' : 'font-medium', compact && 'text-xs')}>{shown}</span>
        </div>
      )}
      <div className={on ? 'group/mg relative' : 'contents'}>
        <input type="range" ref={composeRefs(input, ref)} {...fc.control} min={min} max={max} step={step} value={v} disabled={disabled} aria-label={label} aria-labelledby={label ? undefined : fc.labelledBy}
          aria-readonly={fc.readOnly || undefined} aria-valuetext={named ? String(shown) : mark?.label ? mg.valueText(v, text(v)) : valueText?.(v)}
          onChange={e => set(Number(e.target.value))} {...bind}
          className={cn(rangeInputClass, 'h-1.5 accent-[var(--primary)] transition-opacity disabled:cursor-not-allowed disabled:opacity-40', fc.readOnly && 'cursor-default', fc.invalid && 'outline outline-1 outline-offset-2 outline-[var(--bad)]',
            on && pointerFocus && 'outline-none', on && 'relative z-[1] !bg-transparent [&::-moz-range-thumb]:h-4 [&::-moz-range-thumb]:w-4 [&::-moz-range-thumb]:opacity-0 [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:opacity-0',
            on && !locked && (dragging ? 'cursor-grabbing' : 'cursor-pointer'))}
          style={on ? undefined : { backgroundImage: `linear-gradient(to right, var(--primary) ${pct}%, var(--muted) ${pct}%)` }} />
        {on && (
          <InputsMagnetOverlay hm={hm} magnets={magnets} min={min} max={max} value={v} inset={SLIDER_INSET} locked={locked} faded={disabled} grow={1.15}
            className="h-1.5" thumbClassName="-ms-2 -mt-2 h-4 w-4 bg-[var(--primary)] shadow-[0_1px_3px_rgba(0,0,0,.2)]">
            <span className="absolute inset-0 rounded-full bg-[var(--muted)]" />
            <span className="absolute inset-y-0 start-0 rounded-full bg-[var(--primary)]" style={{ width: thumbAt, transition: settling ? `width ${MAGNET_SETTLE_CSS}` : undefined }} />
          </InputsMagnetOverlay>
        )}
      </div>
      {named && (
        <span className="relative mt-1.5 block h-4 [@media(pointer:coarse)]:mt-1 [@media(pointer:coarse)]:h-8">
          {steps.map((x, k) => (
            <button key={x} type="button" tabIndex={-1} disabled={disabled} onClick={() => set(k)} style={{ insetInlineStart: `${(k / (steps.length - 1)) * 100}%` }}
              className={cn('absolute top-0 cursor-pointer border-0 bg-transparent p-0 text-[11px] whitespace-nowrap disabled:cursor-default [@media(pointer:coarse)]:h-8 [@media(pointer:coarse)]:min-w-8',
                k === 0 ? '' : k === steps.length - 1 ? '-translate-x-full' : '-translate-x-1/2', k === Math.round(v) && !disabled ? 'font-semibold text-[var(--fg)]' : k === Math.round(v) ? 'font-semibold text-[var(--fg3)]' : 'text-[var(--fg3)]')}>{x}</button>
          ))}
        </span>
      )}
      {mg.live}
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
export function NumberStepper({ value, defaultValue = 0, onChange, min = -Infinity, max = Infinity, step = 1, label: labelProp, format, className, ref, ...fp }: FormControlProps &
  { value?: number; defaultValue?: number; onChange?: (v: number) => void; min?: number; max?: number; step?: number; label?: string; format?: Intl.NumberFormatOptions; className?: string; ref?: Ref<HTMLDivElement> }) {
  const root = useRef<HTMLDivElement>(null)
  const label = labelProp ?? 'Quantity'
  const fc = useFormControl<number>({ ...fp, value, defaultValue, onChange, serialize: n => String(n), focus: () => root.current?.focus() })
  const v = fc.value, set = fc.set, locked = fc.disabled || fc.readOnly
  const change = (n: number) => {
    if (locked) return
    const c = snapToStep(n, { min, max, step })
    if (c === v) return shake(root.current, 4)
    set(c)
  }
  const btn = 'h-[34px] w-9 cursor-pointer border-0 bg-transparent text-base hover:bg-[var(--muted)] aria-disabled:opacity-40 aria-disabled:cursor-default grid place-items-center disabled:cursor-not-allowed disabled:hover:bg-transparent'
  const labelled = fc.labelledBy && !fp['aria-labelledby'] ? undefined : label // a FormField label names it instead
  return (
    <div className="relative inline-flex" onBlur={fc.onBlur}>
      <div ref={composeRefs(root, ref)} role="spinbutton" tabIndex={fc.disabled ? -1 : 0} aria-label={labelled} aria-labelledby={labelled ? undefined : fc.labelledBy} {...fc.control}
        aria-valuenow={v} aria-valuetext={numberFormat(LOCALE, format).format(v)} aria-disabled={fc.disabled || undefined} aria-readonly={fc.readOnly || undefined}
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
export function Rating({ value, defaultValue = 0, onChange, labels: labelsProp, prompt: promptProp, className, 'aria-label': ariaLabelProp, ref, ...fp }: FormControlProps &
  { value?: number; defaultValue?: number; onChange?: (v: number) => void; labels?: string[]; prompt?: string; className?: string; 'aria-label'?: string; ref?: Ref<HTMLButtonElement> }) {
  const stars = useRef<HTMLDivElement>(null)
  const labels = labelsProp ?? ['Terrible', 'Bad', 'Okay', 'Good', 'Excellent'], prompt = promptProp ?? 'Choose a rating', ariaLabel = ariaLabelProp ?? 'Rating'
  const fc = useFormControl<number>({ ...fp, value, defaultValue, onChange, serialize: n => n ? String(n) : '', focus: () => rg.focus() })
  const v = fc.value
  const locked = fc.disabled || fc.readOnly
  const [hover, setHover] = useState(0)
  const shown = (locked ? 0 : hover) || v
  const pick = (n: number) => {
    if (locked) return
    fc.set(n)
    stars.current?.querySelectorAll('button').forEach((el, i) => { if (i < n) play(el, { scale: [0.6, 1.2, 1] }, { duration: 0.4, ease: 'easeOut', delay: i * 0.05 }) })
  }
  const rg = useRadioGroup({ count: 5, checked: v - 1, isDisabled: () => fc.disabled, onSelect: i => pick(i + 1), ref, loop: false })
  const labelled = fc.labelledBy && !fp['aria-labelledby'] ? undefined : ariaLabel
  return (
    <div className={cn('relative flex flex-col gap-1.5', className)} onBlur={fc.onBlur}>
      <div ref={stars} className="flex gap-1 [@media(pointer:coarse)]:-mx-1.5 [@media(pointer:coarse)]:gap-0" role="radiogroup" aria-label={labelled} aria-labelledby={labelled ? undefined : fc.labelledBy} {...fc.control}
        aria-required={fc.required || undefined} aria-readonly={fc.readOnly || undefined} aria-disabled={fc.disabled || undefined} onPointerLeave={() => setHover(0)} onKeyDown={rg.onKeyDown}>
        {[1, 2, 3, 4, 5].map(n => (
          <button type="button" key={n} {...rg.item(n - 1)} role="radio" aria-checked={v === n}
            disabled={fc.disabled} aria-label={plural(n, 'star')} onClick={() => pick(n)} onPointerEnter={e => !isTouch(e) && setHover(n)}
            className={cn('border-0 bg-transparent p-0.5 transition-colors [@media(pointer:coarse)]:p-1.5', locked ? fc.disabled ? 'cursor-not-allowed' : 'cursor-default' : 'cursor-pointer',
              n <= shown ? (fc.disabled ? 'text-[var(--fg3)]' : 'text-[var(--warn)]') : fc.invalid ? 'text-[var(--bad)]' : 'text-[var(--line2)]')}>
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
export function TagInput({ value, defaultValue = [], onChange, placeholder: placeholderProp, className, ref, ...fp }: FormControlProps &
  { value?: string[]; defaultValue?: string[]; onChange?: (v: string[]) => void; placeholder?: string; className?: string; ref?: Ref<HTMLInputElement> }) {
  const input = useRef<HTMLInputElement>(null)
  const placeholder = placeholderProp ?? 'Add a tag…'
  const [text, setText] = useState('')
  const fc = useFormControl<string[]>({ ...fp, value, defaultValue, onChange, serialize: t => t, filled: t => t.length > 0, focus: () => input.current?.focus(), onReset: () => setText('') })
  const tags = fc.value, set = fc.set, locked = fc.disabled || fc.readOnly
  const [dupe, flashDupe] = useFlash<string | null>(300, null)
  const shell = useRef<HTMLDivElement>(null)
  useFlip(shell)
  const add = () => {
    const x = text.trim(); if (!x) return
    if (tags.includes(x)) flashDupe(x); else set([...tags, x])
    setText('')
  }
  return (
    <div ref={shell} className={cn(inputShellClass(fc.invalid), 'relative flex flex-wrap gap-1.5 p-1.5', fc.disabled ? 'cursor-not-allowed !bg-[var(--muted)] text-[var(--fg3)] hover:!border-[var(--line)]' : fc.readOnly && '!bg-[var(--muted)]', className)}
      onBlur={e => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) add(); fc.onBlur(e) }}>
      <PresenceList items={tags} keyOf={t => t}>
        {tag => <FormsChip id={tag} label={tag} locked={locked} shake={dupe === tag} onRemove={() => set(tags.filter(x => x !== tag))} />}
      </PresenceList>
      <input ref={composeRefs(input, ref)} {...fc.control} value={text} placeholder={fc.readOnly ? '' : placeholder} aria-label={fc.control.id && fc.labelledBy ? undefined : placeholder}
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

/** Boxes from a code: one digit per position, a space (or nothing) for an empty box. */
const otpSplit = (code: string, n: number) => { const c = code.replace(/[^\d ]/g, ''); return Array.from({ length: n }, (_, i) => (/\d/.test(c[i] ?? '') ? c[i] : '')) }
/** The code as reported: digits in place, a space for each empty box before the last digit ("1 3456"). */
const otpCode = (boxes: string[]) => boxes.map(c => c || ' ').join('').trimEnd()

/**
 * One-time code: auto-advance, paste fills every box, typing into a filled box replaces and re-pops it. Digits keep their
 * boxes: clearing one leaves a gap. `onChange(code, { complete })` fires on every edit with the code so far (a space marks
 * an empty box before the last digit, "1 3456"; use it to reset your hint), `onComplete` with the full code.
 * Controlled with `value` (set it to '' to clear the boxes) or uncontrolled with `defaultValue`; `length` may change.
 * Pass `status="bad"` after a wrong code and the boxes shake (again on every wrong attempt); `"ok"` makes them hop.
 * Form-native: `name` submits the digits typed so far from the first box ("123"; '' while a box before the last digit is
 * empty), `required` (every box filled), `disabled`, `readOnly`, `invalid` (same look as status "bad"), `onBlur`, `form`,
 * and `ref` on the first box.
 */
export function OTPInput({ length = 6, value, defaultValue = '', onComplete, onChange, status, className, 'aria-label': ariaLabel = 'One-time code', ref, ...fp }: FormControlProps &
  { length?: number; value?: string; defaultValue?: string; onComplete?: (code: string) => void; onChange?: (code: string, detail: { complete: boolean }) => void; status?: 'ok' | 'bad'; className?: string; 'aria-label'?: string; ref?: Ref<HTMLInputElement> }) {
  const refs = useRef<(HTMLInputElement | null)[]>([]), box = useRef<HTMLDivElement>(null)
  const fc = useFormControl<string[]>({ ...fp, value: value === undefined ? undefined : otpSplit(value, length), defaultValue: otpSplit(defaultValue, length),
    onChange: next => onChange?.(otpCode(next), { complete: next.every(Boolean) }),
    serialize: b => { const k = b.indexOf(''), head = k < 0 ? b : b.slice(0, k); return b.slice(head.length).some(Boolean) ? '' : head.join('') },
    filled: b => b.every(Boolean), focus: () => { const i = refs.current.findIndex(el => el && !el.value); refs.current[i < 0 ? length - 1 : i]?.focus() } })
  const vals = fc.value.length === length ? fc.value : otpSplit(otpCode(fc.value), length)
  const [attempt, setAttempt] = useState(0)
  useEffect(() => { if (status === 'bad' && attempt) shake(box.current, 8) }, [status, attempt])
  useEffect(() => { if (status === 'ok') refs.current.forEach((el, i) => play(el, { y: [0, -6, 0] }, { duration: 0.4, delay: i * 0.04 })) }, [status])
  const update = (next: string[]) => {
    if (fc.disabled || fc.readOnly) return
    fc.set(next)
    if (next.every(Boolean)) { setAttempt(a => a + 1); onComplete?.(next.join('')) }
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
        <input key={i} ref={el => { refs.current[i] = el; if (i === 0) composeRefs(ref)(el) }} value={c} inputMode="numeric" autoComplete={i === 0 ? 'one-time-code' : 'off'} maxLength={1} aria-label={`Digit ${i + 1}`}
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

const formsHexOk = (s: string) => /^#[0-9a-f]{6}$/i.test(s)
/** "#abc" → "#AABBCC", "#aabbcc" → "#AABBCC"; anything else is returned as given (and marked invalid). */
const formsHexNorm = (s: string) => { const t = s.trim(), m = /^#([0-9a-f]{3})$/i.exec(t); return (m ? `#${[...m[1]].map(c => c + c).join('')}` : t).toUpperCase() }

/**
 * Swatches, a hue slider and a hex field. The preview pops when a swatch or hex changes it (not while dragging hue).
 * `hueMagnets` pulls the hue thumb onto the primary hues (or your own marks) while dragging; see Slider's `magnets`.
 * Values are "#RRGGBB" ("#abc" is read as "#AABBCC"); any other `value` or `defaultValue` marks the picker invalid.
 * Form-native: `name` submits "#RRGGBB" (upper case; the last valid colour while the hex field holds a typo; nothing for
 * an invalid value, which stops the submit), `required`, `disabled`, `readOnly` (shows the colour and hex only), `invalid`,
 * `onBlur`, `form`, and `ref` on the hex field.
 */
export function ColorPicker({ value, defaultValue = '#2563EB', onChange, swatches = ['#18181B', '#2563EB', '#0891B2', '#16A34A', '#CA8A04', '#F97316', '#DC2626', '#DB2777'], hueMagnets, className, ref, ...fp }: FormControlProps &
  { value?: string; defaultValue?: string; onChange?: (v: string) => void; swatches?: string[]
    /** pull the hue thumb onto marks while dragging: true for the six primary and secondary hues (red, yellow, green, cyan, blue, magenta), or your own (degrees) */ hueMagnets?: boolean | readonly Magnet[]
    className?: string; ref?: Ref<HTMLInputElement> }) {
  const hexRef = useRef<HTMLInputElement>(null)
  const fc = useFormControl<string>({ ...fp, value: value === undefined ? undefined : formsHexNorm(value), defaultValue: formsHexNorm(defaultValue), onChange,
    serialize: x => (formsHexOk(x) ? x : ''), validity: x => (formsHexOk(x) ? null : 'Enter a colour as #RRGGBB'), focus: () => hexRef.current?.focus() })
  const c = fc.value, set = fc.set, locked = fc.disabled || fc.readOnly
  const [text, setText] = useState(c), [pops, setPops] = useState(0)
  const [hue, setHue] = useState(() => (formsHexOk(c) ? hex2hue(c) : 0))
  const group = useId()
  const own = useRef(c) // a new `value` from outside (not our own echo) refreshes the hex field and hue
  useEffect(() => { if (c === own.current) return; own.current = c; setText(c); if (formsHexOk(c)) setHue(hex2hue(c)) }, [c])
  const apply = (hex: string, src: 'swatch' | 'hex' | 'hue') => {
    if (locked) return
    const h = hex.toUpperCase(); own.current = h; set(h)
    if (src !== 'hex') setText(h)
    if (src !== 'hue') { setHue(hex2hue(h)); setPops(n => n + 1) }
  }
  const hueInput = useRef<HTMLInputElement>(null), coarse = useCoarsePointer()
  const hueMarks: readonly Magnet[] | null = hueMagnets === true
    ? ([['Red', 0], ['Yellow', 60], ['Green', 120], ['Cyan', 180], ['Blue', 240], ['Magenta', 300], ['Red', 360]] as const).map(([label, value]) => ({ value, label }))
    : hueMagnets || null
  const setHueFrom = (h: number) => { setHue(h); apply(hsl2hex(h, HUE_S, HUE_L), 'hue') }
  const hueInset = coarse ? HUE_INSET_COARSE : HUE_INSET
  const hm = useInputsMagnetRange({ input: hueInput, magnets: hueMarks, min: 0, max: 360, step: 1, value: hue, locked, inset: hueInset, set: setHueFrom, describe: n => `${n} degrees` })
  return (
    <div className={cn('relative flex flex-col gap-3', className)} onBlur={fc.onBlur}>
      <div className="flex items-center gap-3">
        <span key={pops} className={cn('h-10 w-10 flex-none rounded-[var(--r-lg)] shadow-[inset_0_0_0_1px_rgba(0,0,0,.08)]', pops > 0 && 'ui-pop [--ui-d:.4s] [--ui-r:-8deg] [--ui-s:.85]')} style={{ background: c }} aria-hidden />
        <FormFieldContext.Provider value={null}>
          <Input ref={composeRefs(hexRef, ref)} id={fc.control.id} aria-describedby={fc.control['aria-describedby']} value={text} onChange={e => { setText(e.target.value); const v = e.target.value.trim(); if (formsHexOk(v)) apply(v, 'hex') }}
            invalid={!formsHexOk(text.trim()) || fc.invalid} disabled={fc.disabled} readOnly={fc.readOnly} required={fc.required} spellCheck={false} className="!h-8 font-[family-name:var(--mono)]"
            aria-label={fc.labelledBy ? undefined : 'Hex colour'} />
        </FormFieldContext.Provider>
      </div>
      <div className={hm.on ? 'group/mg relative' : 'contents'}>
      <input type="range" ref={hueInput} min={0} max={360} value={hue} aria-label={'Hue'} disabled={locked} onChange={e => setHueFrom(+e.target.value)}
        aria-valuetext={hm.on ? hm.mg.valueText(hue, `${hue} degrees`) : undefined} {...hm.bind}
        className={cn(hm.on && 'relative [&::-moz-range-thumb]:opacity-0 [&::-webkit-slider-thumb]:opacity-0', hm.on && hm.pointerFocus && 'outline-none', hm.on && !locked && hm.dragging && '!cursor-grabbing', "h-2.5 w-full disabled:cursor-not-allowed disabled:opacity-40 cursor-pointer appearance-none rounded-full bg-clip-content [@media(pointer:coarse)]:box-content [@media(pointer:coarse)]:-my-[11px] [@media(pointer:coarse)]:py-[11px] [@media(pointer:coarse)]:[&::-webkit-slider-thumb]:h-6 [@media(pointer:coarse)]:[&::-webkit-slider-thumb]:w-6 [@media(pointer:coarse)]:[&::-moz-range-thumb]:h-6 [@media(pointer:coarse)]:[&::-moz-range-thumb]:w-6 [&::-moz-range-thumb]:h-4 [&::-moz-range-thumb]:w-4 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-2 [&::-moz-range-thumb]:border-[rgba(0,0,0,.25)] [&::-moz-range-thumb]:bg-white [&::-webkit-slider-thumb]:h-[18px] [&::-webkit-slider-thumb]:w-[18px] [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-[rgba(0,0,0,.25)] [&::-webkit-slider-thumb]:bg-white")}
        style={{ backgroundImage: `linear-gradient(${90}deg,#f00,#ff0,#0f0,#0ff,#00f,#f0f,#f00)` }} />
      {hm.on && (
        <InputsMagnetOverlay hm={hm} magnets={hueMarks} min={0} max={360} value={hue} inset={hueInset} locked={locked} faded={locked} grow={1.12} className="h-2.5"
          thumbClassName="-ms-[9px] -mt-[9px] h-[18px] w-[18px] border-2 border-[rgba(0,0,0,.25)] bg-white [@media(pointer:coarse)]:-ms-3 [@media(pointer:coarse)]:-mt-3 [@media(pointer:coarse)]:h-6 [@media(pointer:coarse)]:w-6" />
      )}
      </div>
      <div className="flex flex-wrap gap-2 [@media(pointer:coarse)]:grid [@media(pointer:coarse)]:grid-cols-[repeat(auto-fill,minmax(32px,1fr))] [@media(pointer:coarse)]:justify-items-center [@media(pointer:coarse)]:gap-1.5">
        {swatches.map(s => {
          const on = s.toUpperCase() === c
          return (
            <button type="button" key={s} aria-label={s} aria-pressed={on} disabled={locked} onClick={() => apply(s, 'swatch')} className="relative h-7 w-7 cursor-pointer rounded-full border-0 p-0 disabled:cursor-not-allowed [@media(pointer:coarse)]:h-8 [@media(pointer:coarse)]:w-8" style={{ background: s, color: s }}>
              {on && <ActiveIndicator group={group} className="!-inset-1 rounded-full border-2 border-current" />}
            </button>
          )
        })}
      </div>
      {hm.mg.live}
      {fc.inputs}
    </div>
  )
}

/**
 * Two-thumb slider for a range (default: the whole of `min`–`max`; values are put in order, onto the step grid, inside the
 * bounds and at least `minGap` apart). Drag either thumb (mouse or touch), click the track to move the nearest thumb there,
 * or use arrows / PageUp / PageDown / Home / End. `minGap` keeps the thumbs apart. The readout rolls (pass `format` to change it).
 * `magnets` (see useMagnet) pull a dragged thumb onto marks, and onto the other thumb (as close as `minGap` allows)
 * unless `magnetThumbs={false}`; PageUp / PageDown and Ctrl/⌘ + arrows jump between marks (past the last one PageUp /
 * PageDown take a 10% step as before); hold Alt (Option) or a second finger to drag freely.
 * Form-native: `name` submits two fields, low then high ("200", "750"; read with formData.getAll), `disabled` (the track
 * and thumbs fade, the label stays legible), `readOnly`, `invalid`, `onBlur`, `form`, and `ref` on the low thumb.
 */
export function RangeSlider({ value, defaultValue, onChange, min = 0, max = 100, step = 1, minGap = 0, label, format: formatProp, valueText: valueTextProp, magnets, magnetThumbs = true, onSnap, className, ref, ...fp }: FormControlProps &
  { value?: [number, number]; defaultValue?: [number, number]; onChange?: (v: [number, number]) => void; min?: number; max?: number; step?: number; minGap?: number
    label?: string; format?: (v: number) => ReactNode; valueText?: (v: number) => string; magnets?: readonly Magnet[] | null; magnetThumbs?: boolean; onSnap?: (hit: MagnetHit | null, value: number) => void; className?: string; ref?: Ref<HTMLButtonElement> }) {
  const track = useRef<HTMLDivElement>(null), thumbs = useRef<(HTMLButtonElement | null)[]>([])
  const format = formatProp ?? ((n: number) => <AnimatedNumber value={n} />), valueText = valueTextProp ?? fmt.number
  const snap = (n: number) => snapToStep(n, { min, max, step })
  const fit = (r: [number, number]): [number, number] => {
    const lo = snap(Math.min(r[0], r[1])), hi = Math.max(snap(Math.max(r[0], r[1])), Math.min(max, lo + minGap))
    return [Math.min(lo, Math.max(min, hi - minGap)), hi]
  }
  const v0 = value?.[0], v1 = value?.[1]
  const fitted = useMemo(() => (v0 === undefined || v1 === undefined ? undefined : fit([v0, v1])), [v0, v1, min, max, step, minGap]) // eslint-disable-line react-hooks/exhaustive-deps
  const fc = useFormControl<[number, number]>({ ...fp, value: fitted, defaultValue: fit(defaultValue ?? [min, max]), onChange, serialize: r => [String(r[0]), String(r[1])], focus: () => thumbs.current[0]?.focus() })
  const v = fc.value, set = fc.set, locked = fc.disabled || fc.readOnly
  const live = useRef(v)
  useLayoutEffect(() => { live.current = v }, [v])
  const [dragging, setDragging] = useState<0 | 1 | null>(null)
  const pct = (n: number) => clamp(((n - min) / (max - min || 1)) * 100, 0, 100)
  // while a thumb is dragged it is also pulled onto the other thumb (as close as minGap allows)
  const own = !!magnets?.length
  const other = (k: 0 | 1): Magnet => ({ value: k === 0 ? v[1] - minGap : v[0] + minGap, label: minGap ? 'Closest allowed' : 'Same value' })
  const mg = useMagnet({ magnets: own && magnetThumbs && dragging !== null ? [...magnets!, other(dragging)] : magnets, min, max, step, describe: valueText, onSnap })
  const [kicks, setKicks] = useState([0, 0]), [dragLabel, setDragLabel] = useState<string | undefined>(), [focusK, setFocusK] = useState<0 | 1 | null>(null)
  const kick = (k: 0 | 1) => setKicks(ks => k ? [ks[0], ks[1] + 1] : [ks[0] + 1, ks[1]])
  const move = (k: 0 | 1, n: number) => {
    if (locked) return
    const cur = live.current, x = snap(n), next: [number, number] = [cur[0], cur[1]]
    next[k] = k === 0 ? Math.max(min, Math.min(x, cur[1] - minGap)) : Math.min(max, Math.max(x, cur[0] + minGap))
    if (next[k] !== cur[k]) { live.current = next; set(next) }
  }
  const valAt = (x: number) => { const r = track.current?.getBoundingClientRect(); return r ? min + ((x - r.left) / (r.width || 1)) * (max - min) : min }
  const dragTo = (k: 0 | 1, x: number, event: PointerEvent) => {
    if (!own) return move(k, valAt(x))
    const res = mg.apply(valAt(x), { px: track.current?.getBoundingClientRect().width || undefined, event })
    if (res.captured || res.released) kick(k)
    setDragLabel(res.snapped?.label ?? res.zone?.label)
    move(k, res.value)
  }
  const thumb = useRef<0 | 1>(0)
  const thumbDrag = usePointerDrag({ onMove: p => dragTo(thumb.current, p.x, p.event), onEnd: () => { mg.reset(); setDragging(null) }, cursor: 'grabbing' })
  const startDrag = (k: 0 | 1, e: React.PointerEvent) => {
    if (e.button !== 0 || locked) return
    e.preventDefault(); thumbs.current[k]?.focus(); thumb.current = k; setDragging(k)
    thumbDrag.start(e, thumbs.current[k])
  }
  const onTrackDown = (e: React.PointerEvent) => {
    if (locked) return
    const n = valAt(e.clientX), d0 = Math.abs(n - v[0]), d1 = Math.abs(n - v[1])
    const k: 0 | 1 = d0 < d1 ? 0 : d1 < d0 ? 1 : n < v[0] ? 0 : 1
    mg.reset(); dragTo(k, e.clientX, e.nativeEvent); startDrag(k, e)
  }
  const thumbLabel = (k: 0 | 1) => label ? (k ? `Maximum ${label.toLowerCase()}` : `Minimum ${label.toLowerCase()}`) : (k ? 'Maximum' : 'Minimum')
  const s0 = useMagnetSettle(pct(v[0]) / 100, kicks[0]), s1 = useMagnetSettle(pct(v[1]) / 100, kicks[1])
  const pos = [`${s0.f * 100}%`, `${s1.f * 100}%`] as const
  const settle = (on: boolean, prop: string) => (on ? `${prop} ${MAGNET_SETTLE_CSS}` : '')
  return (
    <div role="group" aria-label={label} aria-labelledby={label ? undefined : fc.labelledBy} aria-disabled={fc.disabled || undefined} id={fc.control.id} aria-describedby={fc.control['aria-describedby']}
      className={cn('relative', className)} onBlur={fc.onBlur}>
      {label && <div className="mb-2 flex justify-between text-[13px]"><span className={fc.disabled ? 'text-[var(--fg3)]' : 'text-[var(--fg2)]'}>{label}</span><span className={fc.disabled ? 'text-[var(--fg3)]' : 'font-medium'}>{<>{format(v[0])} to {format(v[1])}</>}</span></div>}
      <div ref={track} className={cn('relative h-5 touch-none transition-opacity [@media(pointer:coarse)]:-my-1.5 [@media(pointer:coarse)]:h-8', fc.disabled ? 'cursor-not-allowed opacity-40' : fc.readOnly ? 'cursor-default' : 'cursor-pointer')} onPointerDown={onTrackDown}>
        <div className={cn('absolute inset-x-0 top-2 h-1 rounded-full [@media(pointer:coarse)]:top-3.5', fc.invalid ? 'bg-[var(--bad-soft)] shadow-[0_0_0_1px_var(--bad)]' : 'bg-[var(--muted)]')} />
        <div className="absolute top-2 h-1 rounded-full bg-[var(--primary)] motion-reduce:!transition-none [@media(pointer:coarse)]:top-3.5"
          style={{ insetInlineStart: pos[0], insetInlineEnd: `${100 - s1.f * 100}%`, transition: [settle(s0.settling, 'inset-inline-start'), settle(s1.settling, 'inset-inline-end')].filter(Boolean).join(',') || undefined }} />
        {own && <MagnetMarks magnets={magnets} min={min} max={max} value={v} />}
        {([0, 1] as const).map(k => (
          <button type="button" key={k} ref={el => { thumbs.current[k] = el; if (k === 0) composeRefs(ref)(el) }} role="slider" aria-label={thumbLabel(k)} aria-valuemin={min} aria-valuemax={max} aria-valuenow={v[k]}
            aria-valuetext={own ? mg.valueText(v[k], valueText(v[k])) : valueText(v[k])} aria-keyshortcuts={own ? 'PageUp PageDown' : undefined}
            disabled={fc.disabled} aria-readonly={fc.readOnly || undefined} aria-invalid={fc.control['aria-invalid']}
            onPointerDown={e => { e.stopPropagation(); mg.reset(); startDrag(k, e) }}
            onFocus={own ? e => { try { if (e.currentTarget.matches(':focus-visible')) setFocusK(k) } catch { /* old selector engines */ } } : undefined}
            onBlur={own ? () => setFocusK(null) : undefined}
            onKeyDown={e => {
              const jump = own ? magnetKeyDirection(e) : 0, to0 = jump ? mg.next(v[k], jump) : null
              if (to0 !== null) { e.preventDefault(); move(k, to0); kick(k); return }
              const big = Math.max(step, (max - min) / 10)
              const to = ({ ArrowRight: v[k] + step, ArrowUp: v[k] + step, ArrowLeft: v[k] - step, ArrowDown: v[k] - step, PageUp: v[k] + big, PageDown: v[k] - big, Home: min, End: max } as Record<string, number>)[e.key]
              if (to !== undefined) { e.preventDefault(); move(k, to) }
            }}

            className={cn('absolute top-0 h-5 w-5 -translate-x-1/2 touch-none rounded-full border-0 bg-transparent p-0 motion-reduce:!transition-none [@media(pointer:coarse)]:h-8 [@media(pointer:coarse)]:w-8', locked ? fc.disabled ? 'cursor-not-allowed' : 'cursor-default' : dragging === k ? 'z-10 cursor-grabbing' : 'cursor-grab')}
            style={{ insetInlineStart: pos[k], scale: dragging === k ? '1.15' : undefined, transition: ['scale .3s var(--ui-spring)', settle((k ? s1 : s0).settling, 'inset-inline-start')].filter(Boolean).join(',') }}>
            <span aria-hidden className="absolute inset-0 rounded-full border-2 border-[var(--primary)] bg-[var(--card)] shadow-[0_1px_3px_rgba(0,0,0,.2)] [@media(pointer:coarse)]:inset-1" />
            {own && <MagnetBubble label={dragging === k ? dragLabel : mg.at(v[k]).label} show={(dragging === k || focusK === k) && !locked} />}
          </button>
        ))}
      </div>
      {mg.live}
      {fc.inputs}
    </div>
  )
}

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
type PhoneValue = { country: PhoneCountry; digits: string }
const phoneE164 = (v: PhoneValue) => (v.digits ? v.country.dial + v.digits : '')

/**
 * Phone number with a country picker (flags and dial codes). Digits are formatted with the country's mask as you type,
 * and the digits still to come show as a grey placeholder. Typing `+44…` or `0044…` switches the country.
 * Controlled with `value` (E.164, e.g. "+41791234567": it sets the country and digits) or uncontrolled with
 * `defaultCountry` + `defaultValue` (national digits). `onChange` reports what the user typed or picked, with `e164` ''
 * while no digits are typed; a new `value` from you doesn't call it.
 * Form-native: `name` submits E.164 ("+41791234567"; '' while no digits are typed), `required`, `disabled`, `readOnly`,
 * `invalid`, `onBlur`, `form`, and `ref` on the number field. Reset returns to the default country and digits.
 */
export function PhoneInput({ countries = PHONE_COUNTRIES, value, defaultCountry = '+41', defaultValue = '', onChange, invalid: inv, 'aria-label': ariaLabel = 'Phone number', className, ref, ...fp }: FormControlProps &
  { countries?: PhoneCountry[]; value?: string; defaultCountry?: string; defaultValue?: string; 'aria-label'?: string; className?: string; ref?: Ref<HTMLInputElement>
    onChange?: (v: { country: PhoneCountry; national: string; e164: string }) => void }) {
  const initialCountry = () => countries.find(c => c.dial === defaultCountry) || countries[0]
  const [picked, setPicked] = useState(initialCountry) // the country while a controlled value has no digits to tell it
  /** E.164 (or national digits for `hint`) as a country and digits; `hint` wins when the dial code fits it (+1 is shared). */
  const read = (s: string, hint: PhoneCountry): PhoneValue => {
    const ds = s.replace(/\D/g, '')
    const c = s.trim().startsWith('+') ? (ds.startsWith(hint.dial.slice(1)) ? hint : phoneMatch(countries, ds)) : undefined
    return c ? { country: c, digits: ds.slice(c.dial.length - 1, c.dial.length - 1 + phoneMax(c)) } : { country: hint, digits: ds.slice(0, phoneMax(hint)) }
  }
  const input = useRef<HTMLInputElement>(null), caret = useRef<number | null>(null)
  const [plus, setPlus] = useState<string | null>(null) // "+4" while a dial code is still being typed
  const fc = useFormControl<PhoneValue>({ ...fp, invalid: inv, value: value === undefined ? undefined : read(value, picked), defaultValue: read(defaultValue, initialCountry()),
    onChange: v => onChange?.({ country: v.country, national: phoneFormat(phoneMask(v.country), v.digits).out, e164: phoneE164(v) }),
    serialize: phoneE164, focus: () => input.current?.focus(), onReset: () => { setPicked(initialCountry()); setPlus(null) } })
  const { country, digits } = fc.value, invalid = fc.invalid, locked = fc.disabled || fc.readOnly
  const [seen, setSeen] = useState(value)
  if (seen !== value) { setSeen(value); setPlus(null); if (fc.value.digits) setPicked(fc.value.country) } // a new value from outside
  const [swaps, setSwaps] = useState(0)
  const { open, setOpen, ref: wrap } = useDisclosure()
  const maxDigits = phoneMax(country)
  const { out, rest } = phoneFormat(phoneMask(country), digits)
  const shown = plus ?? out
  const options: Option[] = countries.map(c => ({ value: c.dial, label: c.name, leading: c.flag, hint: c.dial }))
  const put = (c: PhoneCountry, ds: string) => {
    if (c !== country) { setSwaps(n => n + 1); setPicked(c) }
    fc.set({ country: c, digits: ds.slice(0, phoneMax(c)) })
  }
  const pickIndex = (i: number) => { if (locked) return; put(countries[i], digits); setPlus(null); setOpen(false); input.current?.focus() }
  const lb = useListbox(options, pickIndex, { open, setOpen, selected: countries.indexOf(country), locked })
  useLayoutEffect(() => {
    const el = input.current
    if (caret.current === null || !el || document.activeElement !== el) return
    const at = formsCaretAfter(el.value, caret.current, /\d/); caret.current = null
    el.setSelectionRange(at, at)
  })
  const onInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (locked) return
    const raw = e.target.value, at = e.target.selectionStart ?? raw.length
    let t = raw.trimStart()
    if (t.startsWith('00')) t = '+' + t.slice(2)
    if (t.startsWith('+')) {
      const ds = t.slice(1).replace(/\D/g, '')
      const hit = phoneMatch(countries, ds)
      if (hit) { const rest = ds.slice(hit.dial.length - 1); put(hit, rest); setPlus(null); caret.current = rest.length; return }
      setPlus('+' + ds); fc.markEdited(); return
    }
    setPlus(null)
    let ds = raw.replace(/\D/g, '')
    let before = raw.slice(0, at).replace(/\D/g, '').length
    if (ds === digits && raw.length < shown.length && before > 0) { ds = ds.slice(0, before - 1) + ds.slice(before); before-- } // deleted a separator: drop the digit before it
    put(country, ds); caret.current = Math.min(before, maxDigits)
  }
  return (
    <div ref={wrap} className={cn('relative', className)} onBlur={fc.onBlur}>
      <div className={cn(inputShellClass(invalid), 'flex h-9 items-stretch overflow-hidden', fc.disabled ? 'cursor-not-allowed !bg-[var(--muted)] text-[var(--fg3)] hover:!border-[var(--line)]' : fc.readOnly && '!bg-[var(--muted)]')}>
        <button type="button" disabled={locked} {...lb.comboProps} aria-label={`Country: ${country.name} ${country.dial}`} aria-invalid={invalid || undefined}
          onClick={() => lb.show(!open)}
          onKeyDown={e => {
            if (!open || e.key.length !== 1 || e.key === ' ') return lb.onKeyDown(e)
            const k = typeaheadIndex(countries.map(c => c.name), e.key, lb.active)
            if (k >= 0) lb.setActive(k)
          }}
          className="flex flex-none cursor-pointer items-center gap-1 border-0 border-e border-[var(--line)] bg-[var(--muted)] px-2.5 text-sm outline-none hover:bg-[var(--line)] focus-visible:bg-[var(--line)] disabled:cursor-not-allowed disabled:hover:bg-[var(--muted)]">
          <span key={`f${swaps}`} className={cn('leading-none', swaps > 0 && 'ui-pop [--ui-d:.4s] [--ui-r:-20deg]')}>{country.flag}</span>
          <span key={`c${swaps}`} className={cn('ui-num text-xs text-[var(--fg2)]', swaps > 0 && 'ui-in [--ui-y:-6px]')}>{country.dial}</span>
          <Icon name="chevronDown" size={10} strokeWidth={3} className="text-[var(--fg3)]" />
        </button>
        {/* the mask's ghost digits sit behind the number */}
        <span className="relative flex min-w-0 flex-1">
          {plus === null && <span aria-hidden className="pointer-events-none absolute inset-0 flex items-center overflow-hidden px-3 text-[13px] whitespace-pre text-transparent">{out}<span className="text-[var(--fg3)] opacity-70">{rest}</span></span>}
          <input ref={composeRefs(input, ref)} {...fc.control} value={shown} onChange={onInput} inputMode="tel" autoComplete="tel-national" aria-label={fc.labelledBy && !fp['aria-labelledby'] ? undefined : ariaLabel}
            disabled={fc.disabled} readOnly={fc.readOnly} aria-required={fc.required || undefined} className="relative min-w-0 flex-1 border-0 bg-transparent px-3 text-[13px] outline-none disabled:cursor-not-allowed" />
        </span>
      </div>
      <FloatingPanel open={open} className="max-h-60 w-full overflow-auto overscroll-contain sm:w-[260px]" role="presentation">
        <OptionList id={lb.id} label={'Country'} options={options} active={lb.active} isSelected={o => o.value === country.dial} onPick={pickIndex} onHover={lb.setActive} />
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
/**
 * A typed amount as "1234.5" ('' when empty), or null when it can't be read for certain. Spaces and apostrophes group.
 * The last "." or "," is the decimal point when one to two digits (or none yet) follow it and it appears once, whatever
 * the currency; a separator before exactly three digits groups thousands, except the currency's own decimal separator
 * used once ("1,234" in EUR is three decimals, so it can't be read). Groups must be three digits each.
 */
const currencyParse = (raw: string, decimal: string): string | null => {
  const s = raw.replace(/[\s'’]/g, '')
  if (!/^[\d.,]*$/.test(s)) return null
  const at = Math.max(s.lastIndexOf('.'), s.lastIndexOf(',')), sep = s[at], tail = s.slice(at + 1), once = at >= 0 && s.indexOf(sep) === at
  let int = s, frac: string | null = null
  if (at >= 0) {
    if (once && tail.length <= 2) { int = s.slice(0, at); frac = tail }
    else if (tail.length !== 3 || (once && sep === decimal)) return null
  }
  if (/[.,]/.test(int) && !/^\d{1,3}([.,])\d{3}(?:\1\d{3})*$/.test(int)) return null
  const digits = int.replace(/[.,]/g, '').replace(/^0+(?=\d)/, '')
  return frac === null ? digits : `${digits || '0'}.${frac}`
}
const currencyShow = (plain: string, { group, decimal }: { group: string; decimal: string }) => {
  if (!plain) return ''
  const [i, f] = plain.split('.')
  return i.replace(/\B(?=(\d{3})+(?!\d))/g, group) + (f !== undefined ? decimal + f : '')
}
/** An amount as CurrencyInput shows it when you're not typing: whole numbers bare, others with two decimals. */
const currencyPlain = (n: number | null) => (n === null ? '' : Number.isInteger(n) ? String(n) : n.toFixed(2))

/**
 * Amount field: type it with either separator ("12.50" and "12,50" are both twelve fifty, whatever the currency), and
 * once you leave the field it shows with the currency's separators (1’234.50 CHF, 1.234,50 EUR…), at most two
 * decimals. Text it can't read for certain (three decimals, a misplaced group, a minus sign: amounts are positive) marks
 * the field invalid and empties the value. Select the code to cycle currencies; the formatted amount is written out below.
 * Controlled with `value` (a number, or null for empty) or uncontrolled with `defaultValue`; `onChange(amount, currency)`.
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
  const [code, locale] = currencies[ci], seps = currencySeps(locale)
  const sample = `Enter an amount like ${currencyShow('1234.50', seps)}`
  // the text being typed, shown while the value is still the amount it was read as (a value from outside replaces it)
  const [draft, setDraft] = useState<{ text: string; amount: number | null; bad: boolean } | null>(null)
  const input = useRef<HTMLInputElement>(null)
  const fc = useFormControl<number | null>({ ...fp, invalid: inv, value, defaultValue: defaultValue ?? null, onChange: n => onChange?.(n, code),
    serialize: n => (n === null ? '' : String(n)), validity: n => (draft?.bad && draft.amount === n ? sample : null),
    focus: () => input.current?.focus(), onReset: () => { setCi(initialCi()); setDraft(null) } })
  const v = fc.value, locked = fc.disabled || fc.readOnly
  const typing = draft && draft.amount === v ? draft : null
  const bad = !!typing?.bad
  return (
    <div className={cn('relative flex flex-col gap-1.5', className)} onBlur={e => { if (draft && !draft.bad) setDraft(null); fc.onBlur(e) }}>
      <div className={cn(inputShellClass(fc.invalid || bad), 'flex h-9 items-stretch overflow-hidden', fc.disabled ? 'cursor-not-allowed !bg-[var(--muted)] text-[var(--fg3)] hover:!border-[var(--line)]' : fc.readOnly && '!bg-[var(--muted)]')}>
        <button type="button" disabled={locked} aria-label={`Currency ${code}, change currency`}
          onClick={() => { const n = (ci + 1) % currencies.length; setCi(n); setDraft(null); onChange?.(v, currencies[n][0]); fc.markEdited() }}
          className="flex w-14 flex-none cursor-pointer items-center justify-center overflow-hidden border-0 border-e border-[var(--line)] bg-[var(--muted)] text-[13px] outline-none hover:bg-[var(--line)] focus-visible:bg-[var(--line)] disabled:cursor-not-allowed disabled:hover:bg-[var(--muted)]">
          <b key={code} className="ui-in font-semibold [--ui-y:-8px]">{code}</b>
        </button>
        <input ref={composeRefs(input, ref)} {...fc.control} aria-invalid={fc.invalid || bad || undefined} value={typing ? typing.text : currencyShow(currencyPlain(v), seps)} inputMode="decimal" autoComplete="off" placeholder={`0${seps.decimal}00`}
          aria-label={fc.labelledBy && !fp['aria-labelledby'] ? undefined : `Amount in ${code}`} disabled={fc.disabled} readOnly={fc.readOnly} aria-required={fc.required || undefined}
          onChange={e => {
            if (locked) return
            const text = e.target.value, p = currencyParse(text, seps.decimal)
            const amount = p && /\d/.test(p) ? parseFloat(p) : null
            setDraft({ text, amount, bad: p === null }); fc.set(amount)
          }}
          className="min-w-0 flex-1 border-0 bg-transparent px-3 text-end font-[family-name:var(--mono)] text-[13px] outline-none placeholder:text-[var(--fg3)] disabled:cursor-not-allowed" />
      </div>
      <span className={cn('text-xs', bad ? 'text-[var(--bad)]' : 'text-[var(--fg3)]')} aria-live="polite">
        {bad ? sample : v !== null ? currencyTypo(numberFormat(locale, { style: 'currency', currency: code }).format(v)) : 'Select the code to change currency'}
      </span>
      {currencyName && !fc.disabled && <input type="hidden" name={currencyName} form={fp.form} value={code} />}
      {fc.inputs}
    </div>
  )
}
