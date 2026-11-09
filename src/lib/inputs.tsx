import { useEffect, useId, useLayoutEffect, useRef, useState, type InputHTMLAttributes, type ReactNode, type Ref, type TextareaHTMLAttributes } from 'react'
import { AnimatePresence, animate, motion, useReducedMotion } from 'motion/react'
import { AnimatedNumber, FormFieldContext, type FormControlProps, formDisabledClass, formReadOnlyClass, useFormControl, useFormFieldProps, Button, Icon, clamp, cn, defineMessages, logicalArrow, numberFormat, useDir, useLocale, useMessages, hex2hue, hsl2hex, inputClass, isTouch, prefersReducedMotion, spring, useDisclosure, usePointerDrag, useRoving } from './core'
import { play, shake } from './motion'
import { FloatingPanel } from './overlay'
import { useFormsAfterReset, formsAssignRef, formsInterleave, formsMergeRefs } from './formkit'
import { inputShellClass, rangeInputClass, type Option } from './fields'
import { OptionList } from './select'


/** The input controls' own strings (machine-drafted de/ar). Override one with `<UIProvider messages={{ 'input.quantity': … }}>`. */
export const INPUT_MESSAGES = defineMessages('input', {
  en: {
    left: '{count} left', ruleLength: '8+ characters', ruleUpper: 'Uppercase', ruleNumber: 'Number', ruleSymbol: 'Symbol', met: '(met)', notMet: '(not met)',
    strength: 'Strength {score} of 4', quantity: 'Quantity', decrease: 'Decrease {label}', increase: 'Increase {label}',
    rating: 'Rating', stars: '{count, plural, one {# star} other {# stars}}', tapToRate: 'Tap to rate',
    terrible: 'Terrible', bad: 'Bad', okay: 'Okay', good: 'Good', excellent: 'Excellent',
    addTag: 'Add a tag…', otp: 'One-time code', digit: 'Digit {n}', hex: 'Hex colour', hue: 'Hue',
    range: '{from} to {to}', minimum: 'Minimum', maximum: 'Maximum', minimumOf: 'Minimum {label}', maximumOf: 'Maximum {label}',
    phone: 'Phone number', country: 'Country: {name} {dial}', countries: 'Country',
    currency: 'Currency {code}, change currency', amountIn: 'Amount in {code}', switchCurrency: 'Tap the currency to switch',
  },
  de: {
    left: 'noch {count}', ruleLength: 'Mind. 8 Zeichen', ruleUpper: 'Großbuchstabe', ruleNumber: 'Ziffer', ruleSymbol: 'Sonderzeichen', met: '(erfüllt)', notMet: '(nicht erfüllt)',
    strength: 'Stärke {score} von 4', quantity: 'Menge', decrease: '{label} verringern', increase: '{label} erhöhen',
    rating: 'Bewertung', stars: '{count, plural, one {# Stern} other {# Sterne}}', tapToRate: 'Tippe zum Bewerten',
    terrible: 'Furchtbar', bad: 'Schlecht', okay: 'Okay', good: 'Gut', excellent: 'Ausgezeichnet',
    addTag: 'Schlagwort hinzufügen…', otp: 'Einmalcode', digit: 'Ziffer {n}', hex: 'Hex-Farbe', hue: 'Farbton',
    range: '{from} bis {to}', minimum: 'Minimum', maximum: 'Maximum', minimumOf: '{label} (Minimum)', maximumOf: '{label} (Maximum)',
    phone: 'Telefonnummer', country: 'Land: {name} {dial}', countries: 'Land',
    currency: 'Währung {code}, Währung wechseln', amountIn: 'Betrag in {code}', switchCurrency: 'Tippe auf die Währung, um sie zu wechseln',
  },
  ar: {
    left: 'متبقٍ {count}', ruleLength: '8 أحرف أو أكثر', ruleUpper: 'حرف كبير', ruleNumber: 'رقم', ruleSymbol: 'رمز', met: '(متحقق)', notMet: '(غير متحقق)',
    strength: 'القوة {score} من 4', quantity: 'الكمية', decrease: 'إنقاص {label}', increase: 'زيادة {label}',
    rating: 'التقييم', stars: '{count, plural, zero {لا نجوم} one {نجمة واحدة} two {نجمتان} few {# نجوم} many {# نجمة} other {# نجمة}}', tapToRate: 'انقر للتقييم',
    terrible: 'سيئ جدًا', bad: 'سيئ', okay: 'مقبول', good: 'جيد', excellent: 'ممتاز',
    addTag: 'أضف وسمًا…', otp: 'رمز لمرة واحدة', digit: 'الرقم {n}', hex: 'لون سداسي عشري', hue: 'درجة اللون',
    range: 'من {from} إلى {to}', minimum: 'الحد الأدنى', maximum: 'الحد الأقصى', minimumOf: 'الحد الأدنى لـ{label}', maximumOf: 'الحد الأقصى لـ{label}',
    phone: 'رقم الهاتف', country: 'الدولة: {name} {dial}', countries: 'الدولة',
    currency: 'العملة {code}، تغيير العملة', amountIn: 'المبلغ بـ{code}', switchCurrency: 'انقر على العملة للتبديل',
  },
})

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
  const t = useMessages(INPUT_MESSAGES)
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
          <span ref={countRef} className={cn('ui-num inline-block text-xs transition-colors', TA_TONE[tone][0])}>{t('left', { count: left })}</span>
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

const PW_RULES: ['ruleLength' | 'ruleUpper' | 'ruleNumber' | 'ruleSymbol', RegExp][] = [['ruleLength', /.{8,}/], ['ruleUpper', /[A-Z]/], ['ruleNumber', /\d/], ['ruleSymbol', /[^A-Za-z0-9]/]]
const PW_BAR = ['bg-[var(--bad)]', 'bg-[var(--warn)]', 'bg-[var(--accent)]', 'bg-[var(--ok)]']

/**
 * Password with show/hide (the eye pops when it flips). `strength` adds four bars that fill in a stagger
 * and a rules checklist (8+ characters, uppercase, number, symbol) that ticks green as each is met.
 */
export function PasswordInput({ strength, rules = strength, className, onChange, invalid: inv, ref, id, name, required, disabled, readOnly, 'aria-describedby': db, ...p }:
  InputHTMLAttributes<HTMLInputElement> & { strength?: boolean; rules?: boolean; invalid?: boolean; ref?: Ref<HTMLInputElement> }) {
  const { invalid, ...f } = useFormFieldProps({ id, name, required, disabled, readOnly, invalid: inv, 'aria-describedby': db })
  const t = useMessages(INPUT_MESSAGES), { t: tc } = useLocale()
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
          <Button size="icon-sm" variant="ghost" disabled={f.disabled} aria-label={tc(show ? 'field.hidePassword' : 'field.showPassword')} title={tc(show ? 'field.hidePassword' : 'field.showPassword')}
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
              {/* rtl-lint-ignore: origin-left has its rtl: twin */}
              <motion.div className={cn('h-full origin-left rtl:origin-right transition-colors', PW_BAR[Math.max(0, score - 1)])} initial={false}
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
              <span aria-hidden>{passed[i] ? '✓' : '○'} </span>{t(label)}<span className="sr-only"> {t(passed[i] ? 'met' : 'notMet')}</span>
            </motion.span>
          ))}
        </div>
      )}
      {strength && <span className="sr-only" aria-live="polite">{v ? t('strength', { score }) : ''}</span>}
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
  const rtl = useDir() === 'rtl'
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
        style={{ backgroundImage: `linear-gradient(to ${rtl ? 'left' : 'right'}, var(--primary) ${pct}%, var(--muted) ${pct}%)` }} />
      {named && (
        <span className="relative mt-1.5 block h-4 [@media(pointer:coarse)]:mt-1 [@media(pointer:coarse)]:h-8">
          {steps.map((x, k) => (
            <button key={x} type="button" tabIndex={-1} disabled={disabled} onClick={() => set(k)} style={{ insetInlineStart: `${(k / (steps.length - 1)) * 100}%` }}
              className={cn('absolute top-0 cursor-pointer border-0 bg-transparent p-0 text-[11px] whitespace-nowrap disabled:cursor-default [@media(pointer:coarse)]:h-8 [@media(pointer:coarse)]:min-w-8',
                k === 0 ? '' : k === steps.length - 1 ? '-translate-x-full rtl:translate-x-full' : '-translate-x-1/2 rtl:translate-x-1/2', k === Math.round(v) && !disabled ? 'font-semibold text-[var(--fg)]' : k === Math.round(v) ? 'font-semibold text-[var(--fg3)]' : 'text-[var(--fg3)]')}>{x}</button> // rtl-lint-ignore: rtl: twins
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
export function NumberStepper({ value, defaultValue = 0, onChange, min = -Infinity, max = Infinity, step = 1, label: labelProp, format, className, ref, ...fp }: FormControlProps &
  { value?: number; defaultValue?: number; onChange?: (v: number) => void; min?: number; max?: number; step?: number; label?: string; format?: Intl.NumberFormatOptions; className?: string; ref?: Ref<HTMLDivElement> }) {
  const root = useRef<HTMLDivElement>(null)
  const t = useMessages(INPUT_MESSAGES), { locale, dir } = useLocale(), label = labelProp ?? t('quantity')
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
        aria-valuenow={v} aria-valuetext={numberFormat(locale, format).format(v)} aria-disabled={fc.disabled || undefined} aria-readonly={fc.readOnly || undefined}
        aria-valuemin={Number.isFinite(min) ? min : undefined} aria-valuemax={Number.isFinite(max) ? max : undefined}
        className={cn('inline-flex items-center overflow-hidden rounded-[var(--r-md)] border bg-[var(--card)] outline-none focus-visible:border-[var(--fg3)] focus-visible:shadow-[0_0_0_3px_var(--muted)]',
          fc.invalid ? 'border-[var(--bad)] shadow-[0_0_0_3px_var(--bad-soft)]' : 'border-[var(--line)]', fc.disabled ? 'cursor-not-allowed bg-[var(--muted)] text-[var(--fg3)]' : fc.readOnly && 'bg-[var(--muted)]', className)}
        onKeyDown={e => {
          const d = ({ ArrowUp: 1, ArrowRight: 1, ArrowDown: -1, ArrowLeft: -1 } as Record<string, number>)[logicalArrow(e.key, dir)]
          if (d) { e.preventDefault(); change(v + d * step) }
          if (e.key === 'Home' && Number.isFinite(min)) { e.preventDefault(); change(min) }
          if (e.key === 'End' && Number.isFinite(max)) { e.preventDefault(); change(max) }
        }}>
        <button type="button" tabIndex={-1} className={btn} aria-label={t('decrease', { label })} aria-disabled={(v <= min && !locked) || undefined} disabled={locked} hidden={fc.readOnly}
          onPointerDown={e => { e.preventDefault(); root.current?.focus() }} onClick={() => change(v - step)}><Icon name="minus" size={14} /></button>
        <span className={cn('grid min-w-14 place-items-center text-base font-medium', fc.readOnly && 'h-[34px] px-2')}><AnimatedNumber value={v} format={format} locale={locale} /></span>
        <button type="button" tabIndex={-1} className={btn} aria-label={t('increase', { label })} aria-disabled={(v >= max && !locked) || undefined} disabled={locked} hidden={fc.readOnly}
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
  const refs = useRef<(HTMLButtonElement | null)[]>([])
  const t = useMessages(INPUT_MESSAGES), dir = useDir()
  const labels = labelsProp ?? [t('terrible'), t('bad'), t('okay'), t('good'), t('excellent')], prompt = promptProp ?? t('tapToRate'), ariaLabel = ariaLabelProp ?? t('rating')
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
            disabled={fc.disabled} aria-label={t('stars', { count: n })} onClick={() => pick(n)} onPointerEnter={e => !isTouch(e) && setHover(n)}
            onKeyDown={e => {
              const d = ({ ArrowRight: 1, ArrowUp: 1, ArrowLeft: -1, ArrowDown: -1 } as Record<string, number>)[logicalArrow(e.key, dir)]
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
export function TagInput({ value, defaultValue = [], onChange, placeholder: placeholderProp, className, ref, ...fp }: FormControlProps &
  { value?: string[]; defaultValue?: string[]; onChange?: (v: string[]) => void; placeholder?: string; className?: string; ref?: Ref<HTMLInputElement> }) {
  const input = useRef<HTMLInputElement>(null)
  const t = useMessages(INPUT_MESSAGES), { t: tc } = useLocale(), placeholder = placeholderProp ?? t('addTag')
  const [text, setText] = useState('')
  const fc = useFormControl<string[]>({ ...fp, value, defaultValue, onChange, serialize: t => t, filled: t => t.length > 0, focus: () => input.current?.focus(), onReset: () => setText('') })
  const tags = fc.value, set = fc.set, locked = fc.disabled || fc.readOnly
  const [dupe, setDupe] = useState<string | null>(null)
  const add = () => {
    const x = text.trim(); if (!x) return
    if (tags.includes(x)) { setDupe(x); setTimeout(() => setDupe(null), 300) } else set([...tags, x])
    setText('')
  }
  return (
    <div className={cn(inputShellClass(fc.invalid), 'relative flex flex-wrap gap-1.5 p-1.5', fc.disabled ? 'cursor-not-allowed !bg-[var(--muted)] text-[var(--fg3)] hover:!border-[var(--line)]' : fc.readOnly && '!bg-[var(--muted)]', className)}
      onBlur={e => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) add(); fc.onBlur(e) }}>
      <AnimatePresence initial={false}>
        {tags.map(tag => (
          <motion.span key={tag} layout initial={{ scale: 0.6, opacity: 0 }} animate={{ scale: 1, opacity: 1, x: dupe === tag ? [0, -4, 4, 0] : 0 }}
            exit={{ scale: 0.6, opacity: 0, transition: { duration: 0.15 } }} transition={spring(0.4, 0.35)}
            className={cn('inline-flex items-center gap-1 rounded-[var(--r-md)] py-1 ps-2 text-xs', locked ? 'bg-[var(--card)] pe-2 shadow-[inset_0_0_0_1px_var(--line)]' : 'bg-[var(--muted)] pe-1')}>
            {tag}
            {!locked && <button type="button" aria-label={tc('common.removeItem', { name: tag })} onClick={() => set(tags.filter(x => x !== tag))} className="ui-target cursor-pointer rounded-[var(--r-sm)] border-0 bg-transparent px-1 leading-none text-[var(--fg3)] hover:bg-[var(--line)] hover:text-[var(--fg)] [@media(pointer:coarse)]:-my-2 [@media(pointer:coarse)]:-me-1 [@media(pointer:coarse)]:min-h-8 [@media(pointer:coarse)]:min-w-8 [@media(pointer:coarse)]:text-base">×</button>}
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
export function OTPInput({ length = 6, value, defaultValue = '', onComplete, onChange, status, className, 'aria-label': ariaLabelProp, ref, ...fp }: FormControlProps &
  { length?: number; value?: string; defaultValue?: string; onComplete?: (code: string) => void; onChange?: (code: string) => void; status?: 'ok' | 'bad'; className?: string; 'aria-label'?: string; ref?: Ref<HTMLInputElement> }) {
  const refs = useRef<(HTMLInputElement | null)[]>([]), box = useRef<HTMLDivElement>(null)
  const t = useMessages(INPUT_MESSAGES), ariaLabel = ariaLabelProp ?? t('otp')
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
    // a code is read left to right in every locale (like the digits it is made of), so the boxes keep that order in RTL too
    <div ref={box} dir="ltr" className={cn('relative flex gap-2', className)} role="group" aria-label={labelled} aria-labelledby={labelled ? undefined : fc.labelledBy} aria-describedby={fc.control['aria-describedby']} id={fc.control.id} onBlur={fc.onBlur}>
      {vals.map((c, i) => (
        <input key={i} ref={el => { refs.current[i] = el; if (i === 0) formsAssignRef(ref, el) }} value={c} inputMode="numeric" autoComplete={i === 0 ? 'one-time-code' : 'off'} maxLength={1} aria-label={t('digit', { n: i + 1 })}
          disabled={fc.disabled} readOnly={fc.readOnly} aria-invalid={bad || undefined} onFocus={e => e.target.select()}
          onChange={e => typed(i, e.target.value.replace(/\D/g, '').slice(-1))}
          onKeyDown={e => {
            if (/^\d$/.test(e.key) && e.key === c) { e.preventDefault(); typed(i, c) } // same digit again: React fires no change, so handle it here
            else if (e.key === 'Backspace' && !c && i > 0) { e.preventDefault(); const n = [...vals]; n[i - 1] = ''; update(n); refs.current[i - 1]?.focus() }
            else if (logicalArrow(e.key, 'ltr') === 'ArrowLeft') { e.preventDefault(); refs.current[i - 1]?.focus() } // the boxes are always LTR (dir="ltr" above)
            else if (logicalArrow(e.key, 'ltr') === 'ArrowRight') { e.preventDefault(); refs.current[i + 1]?.focus() }
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
  const t = useMessages(INPUT_MESSAGES), rtl = useDir() === 'rtl'
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
            aria-label={fc.labelledBy ? undefined : t('hex')} dir="ltr" />
        </FormFieldContext.Provider>
      </div>
      <input type="range" min={0} max={360} value={hue} aria-label={t('hue')} disabled={locked} onChange={e => { const h = +e.target.value; setHue(h); apply(hsl2hex(h, 83, 53), 'hue') }}
        className="h-2.5 w-full disabled:cursor-not-allowed disabled:opacity-40 cursor-pointer appearance-none rounded-full bg-clip-content [@media(pointer:coarse)]:box-content [@media(pointer:coarse)]:-my-[11px] [@media(pointer:coarse)]:py-[11px] [@media(pointer:coarse)]:[&::-webkit-slider-thumb]:h-6 [@media(pointer:coarse)]:[&::-webkit-slider-thumb]:w-6 [@media(pointer:coarse)]:[&::-moz-range-thumb]:h-6 [@media(pointer:coarse)]:[&::-moz-range-thumb]:w-6 [&::-moz-range-thumb]:h-4 [&::-moz-range-thumb]:w-4 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-2 [&::-moz-range-thumb]:border-[rgba(0,0,0,.25)] [&::-moz-range-thumb]:bg-white [&::-webkit-slider-thumb]:h-[18px] [&::-webkit-slider-thumb]:w-[18px] [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-[rgba(0,0,0,.25)] [&::-webkit-slider-thumb]:bg-white"
        style={{ backgroundImage: `linear-gradient(${rtl ? 270 : 90}deg,#f00,#ff0,#0f0,#0ff,#00f,#f0f,#f00)` }} />
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
export function RangeSlider({ value, defaultValue = [20, 80], onChange, min = 0, max = 100, step = 1, minGap = 0, label, format: formatProp, valueText: valueTextProp, className, ref, ...fp }: FormControlProps &
  { value?: [number, number]; defaultValue?: [number, number]; onChange?: (v: [number, number]) => void; min?: number; max?: number; step?: number; minGap?: number
    label?: string; format?: (v: number) => ReactNode; valueText?: (v: number) => string; className?: string; ref?: Ref<HTMLButtonElement> }) {
  const track = useRef<HTMLDivElement>(null), thumbs = useRef<(HTMLButtonElement | null)[]>([])
  const t = useMessages(INPUT_MESSAGES), { locale, dir, fmt: lf } = useLocale(), rtl = dir === 'rtl'
  const format = formatProp ?? ((n: number) => <AnimatedNumber value={n} locale={locale} />), valueText = valueTextProp ?? lf.number
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
  // the low end is the start edge: the left in LTR, the right in RTL
  const valAt = (x: number) => { const r = track.current?.getBoundingClientRect(); return r ? min + ((rtl ? r.right - x : x - r.left) / (r.width || 1)) * (max - min) : min }
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
  const thumbLabel = (k: 0 | 1) => label ? t(k ? 'maximumOf' : 'minimumOf', { label: label.toLocaleLowerCase(locale) }) : t(k ? 'maximum' : 'minimum')
  return (
    <div role="group" aria-label={label} aria-labelledby={label ? undefined : fc.labelledBy} aria-disabled={fc.disabled || undefined} id={fc.control.id} aria-describedby={fc.control['aria-describedby']}
      className={cn('relative', className)} onBlur={fc.onBlur}>
      {label && <div className="mb-2 flex justify-between text-[13px]"><span className={fc.disabled ? 'text-[var(--fg3)]' : 'text-[var(--fg2)]'}>{label}</span><span className={fc.disabled ? 'text-[var(--fg3)]' : 'font-medium'}>{formsInterleave(t('range'), { from: format(v[0]), to: format(v[1]) })}</span></div>}
      <div ref={track} className={cn('relative h-5 touch-none transition-opacity [@media(pointer:coarse)]:-my-1.5 [@media(pointer:coarse)]:h-8', fc.disabled ? 'cursor-not-allowed opacity-40' : fc.readOnly ? 'cursor-default' : 'cursor-pointer')} onPointerDown={onTrackDown}>
        <div className={cn('absolute inset-x-0 top-2 h-1 rounded-full [@media(pointer:coarse)]:top-3.5', fc.invalid ? 'bg-[var(--bad-soft)] shadow-[0_0_0_1px_var(--bad)]' : 'bg-[var(--muted)]')} />
        <div className="absolute top-2 h-1 rounded-full bg-[var(--primary)] [@media(pointer:coarse)]:top-3.5" style={{ insetInlineStart: `${pct(v[0])}%`, insetInlineEnd: `${100 - pct(v[1])}%` }} />
        {([0, 1] as const).map(k => (
          <motion.button type="button" key={k} ref={el => { thumbs.current[k] = el; if (k === 0) formsAssignRef(ref, el) }} role="slider" aria-label={thumbLabel(k)} aria-valuemin={min} aria-valuemax={max} aria-valuenow={v[k]} aria-valuetext={valueText(v[k])}
            disabled={fc.disabled} aria-readonly={fc.readOnly || undefined} aria-invalid={fc.control['aria-invalid']}
            animate={{ scale: dragging === k ? 1.15 : 1 }} transition={spring(0.4, 0.3)}
            onPointerDown={e => { e.stopPropagation(); startDrag(k, e) }}
            onKeyDown={e => {
              const big = Math.max(step, (max - min) / 10)
              const to = ({ ArrowRight: v[k] + step, ArrowUp: v[k] + step, ArrowLeft: v[k] - step, ArrowDown: v[k] - step, PageUp: v[k] + big, PageDown: v[k] - big, Home: min, End: max } as Record<string, number>)[logicalArrow(e.key, dir)]
              if (to !== undefined) { e.preventDefault(); move(k, to) }
            }}
            /* rtl-lint-ignore: the centring translate has its rtl: twin */
            className={cn('absolute top-0 h-5 w-5 -translate-x-1/2 rtl:translate-x-1/2 touch-none rounded-full border-0 bg-transparent p-0 [@media(pointer:coarse)]:h-8 [@media(pointer:coarse)]:w-8', locked ? fc.disabled ? 'cursor-not-allowed' : 'cursor-default' : dragging === k ? 'z-10 cursor-grabbing' : 'cursor-grab')} style={{ insetInlineStart: `${pct(v[k])}%` }}>
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

/** The country's name in `locale` (from its flag's region code, via Intl.DisplayNames), else the English `name`. */
const phoneName = (c: PhoneCountry, locale: string) => {
  const cps = [...c.flag].map(ch => ch.codePointAt(0)! - 0x1f1e6)
  if (cps.length !== 2 || cps.some(n => n < 0 || n > 25) || /^en\b/i.test(locale)) return c.name
  try { return new Intl.DisplayNames(locale, { type: 'region' }).of(String.fromCharCode(65 + cps[0], 65 + cps[1])) ?? c.name } catch { return c.name }
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
export function PhoneInput({ countries = PHONE_COUNTRIES, value, defaultCountry = '+41', defaultValue = '', onChange, invalid: inv, 'aria-label': ariaLabelProp, className, ref, ...fp }: FormControlProps &
  { countries?: PhoneCountry[]; value?: string; defaultCountry?: string; defaultValue?: string; 'aria-label'?: string; className?: string; ref?: Ref<HTMLInputElement>
    onChange?: (v: { country: PhoneCountry; national: string; e164: string }) => void }) {
  const t = useMessages(INPUT_MESSAGES), { locale } = useLocale(), ariaLabel = ariaLabelProp ?? t('phone')
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
  const names = countries.map(c => phoneName(c, locale))
  const options: Option[] = countries.map((c, i) => ({ value: c.dial, label: names[i], leading: c.flag, hint: c.dial }))
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
        <button type="button" disabled={locked} aria-label={t('country', { name: phoneName(country, locale), dial: country.dial })} aria-haspopup="listbox" aria-expanded={open} aria-controls={lid} aria-activedescendant={open ? `${lid}-${active}` : undefined}
          onClick={() => { setActive(countries.indexOf(country)); setOpen(!open) }}
          onKeyDown={e => {
            if (!open) { if (['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(e.key)) { e.preventDefault(); setActive(countries.indexOf(country)); setOpen(true) } return }
            if (e.key === 'Escape') { e.stopPropagation(); return setOpen(false) }
            if (e.key === 'Tab') return setOpen(false)
            if (e.key === ' ') { e.preventDefault(); return pickIndex(active) }
            if (e.key.length === 1) { const k = names.findIndex(n => n.toLocaleLowerCase(locale).startsWith(e.key.toLocaleLowerCase(locale))); if (k >= 0) setActive(k); return }
            onKeyDown(e)
          }}
          className="flex flex-none cursor-pointer items-center gap-1 border-0 border-e border-[var(--line)] bg-[var(--muted)] px-2.5 text-sm outline-none hover:bg-[var(--line)] focus-visible:bg-[var(--line)] disabled:cursor-not-allowed disabled:hover:bg-[var(--muted)]">
          <motion.span key={`f${swaps}`} initial={swaps ? { scale: 0.5, rotate: -20 } : false} animate={{ scale: 1, rotate: 0 }} transition={spring(0.5, 0.4)} className="leading-none">{country.flag}</motion.span>
          <motion.span key={`c${swaps}`} initial={swaps ? { y: -6, opacity: 0 } : false} animate={{ y: 0, opacity: 1 }} transition={spring(0.4, 0.3)} className="ui-num text-xs text-[var(--fg2)]" dir="ltr">{country.dial}</motion.span>
          <Icon name="chevronDown" size={10} strokeWidth={3} className="text-[var(--fg3)]" />
        </button>
        {/* the number reads left to right in every locale (dir="ltr"), with the mask's ghost digits behind it */}
        <span className="relative flex min-w-0 flex-1" dir="ltr">
          {plus === null && <span aria-hidden className="pointer-events-none absolute inset-0 flex items-center overflow-hidden px-3 text-[13px] whitespace-pre text-transparent">{out}<span className="text-[var(--fg3)] opacity-70">{rest}</span></span>}
          <input ref={formsMergeRefs(input, ref)} {...fc.control} value={shown} onChange={onInput} inputMode="tel" autoComplete="tel-national" aria-label={fc.labelledBy && !fp['aria-labelledby'] ? undefined : ariaLabel}
            disabled={fc.disabled} readOnly={fc.readOnly} aria-required={fc.required || undefined} className="relative min-w-0 flex-1 border-0 bg-transparent px-3 text-[13px] outline-none disabled:cursor-not-allowed" />
        </span>
      </div>
      <FloatingPanel open={open} className="max-h-60 w-full overflow-auto overscroll-contain sm:w-[260px]" role="presentation">
        <OptionList id={lid} label={t('countries')} options={options} active={active} isSelected={o => o.value === country.dial} onPick={pickIndex} onHover={setActive} />
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
  const t = useMessages(INPUT_MESSAGES)
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
        <button type="button" disabled={locked} aria-label={t('currency', { code })} onClick={() => { const n = (ci + 1) % currencies.length; setCi(n); emit(plain, n) }}
          className="flex w-14 flex-none cursor-pointer items-center justify-center overflow-hidden border-0 border-e border-[var(--line)] bg-[var(--muted)] text-[13px] outline-none hover:bg-[var(--line)] focus-visible:bg-[var(--line)] disabled:cursor-not-allowed disabled:hover:bg-[var(--muted)]">
          <motion.b key={code} initial={{ y: -8, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={spring(0.4, 0.3)} className="font-semibold">{code}</motion.b>
        </button>
        <input ref={formsMergeRefs(input, ref)} {...fc.control} value={currencyShow(plain, seps)} inputMode="decimal" autoComplete="off" placeholder={`0${seps.decimal}00`}
          aria-label={fc.labelledBy && !fp['aria-labelledby'] ? undefined : t('amountIn', { code })} dir="ltr" disabled={fc.disabled} readOnly={fc.readOnly} aria-required={fc.required || undefined}
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
        {Number.isFinite(amount) && amount > 0 ? <bdi>{currencyTypo(numberFormat(locale, { style: 'currency', currency: code }).format(amount))}</bdi> : t('switchCurrency')}
      </span>
      {currencyName && !fc.disabled && <input type="hidden" name={currencyName} form={fp.form} value={code} />}
      {fc.inputs}
    </div>
  )
}
