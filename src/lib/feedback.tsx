import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { AnimatePresence, type AnimationPlaybackControls, animate, motion, useAnimate, useInView, useMotionValue, useTransform } from 'motion/react'
import { AnimatedNumber, Badge, Button, type ButtonProps, Icon, IconButton, type IconName, Spinner, TONE_SOFT, type Tone, cn, floatingSurface, prefersReducedMotion, sleep, spring, useControllable } from './core'
import { CheckMark, Switch } from './forms'

/* ════════════════════════════════════════════════════════════════════════════
 * 8. FEEDBACK
 * ══════════════════════════════════════════════════════════════════════════ */

export type ToastInput = { title: ReactNode; description?: ReactNode; tone?: 'ok' | 'bad' | 'info'; action?: { label: string; onClick: () => void }; duration?: number }
type ToastItem = ToastInput & { id: number }
const ToastCtx = createContext<(t: ToastInput) => void>(() => {})
/** const toast = useToast(); toast({ title: 'Saved', tone: 'ok', action: { label: 'Undo', onClick } }) */
export const useToast = () => useContext(ToastCtx)

/**
 * Hosts toasts (UIProvider includes one). At most `max` (default 5) are on screen: a new toast drops the oldest, so a
 * burst of notifications can't pile up without limit. The region stays usable while a modal makes the page inert.
 */
export function ToastProvider({ children, max = 5 }: { children: ReactNode; max?: number }) {
  const [items, setItems] = useState<ToastItem[]>([])
  const close = useCallback((id: number) => setItems(x => x.filter(t => t.id !== id)), [])
  const limit = Math.max(1, Math.floor(Number.isFinite(max) ? max : 5))
  const push = useCallback((t: ToastInput) => setItems(x => [...x, { ...t, id: Date.now() + Math.random() }].slice(-limit)), [limit])
  return (
    <ToastCtx.Provider value={push}>
      {children}
      {/* one live region for all toasts (the toasts themselves carry no role, so nothing is announced twice) */}
      <div role="region" aria-label="Notifications" data-modal-keep className="pointer-events-none fixed right-[max(16px,env(safe-area-inset-right))] bottom-[max(16px,env(safe-area-inset-bottom))] z-[80] flex flex-col items-end gap-2 max-[640px]:left-[max(12px,env(safe-area-inset-left))] max-[640px]:right-[max(12px,env(safe-area-inset-right))] max-[640px]:items-stretch" aria-live="polite">
        <AnimatePresence initial={false}>
          {items.map(t => <Toast key={t.id} t={t} onClose={() => close(t.id)} />)}
        </AnimatePresence>
      </div>
    </ToastCtx.Provider>
  )
}

/**
 * One toast. Dismiss with the ✕, by swiping it right (touch or mouse), or let it time out. Full width on phones.
 * The timer pauses while it is hovered, focused or being touched.
 */
function Toast({ t, onClose }: { t: ToastItem; onClose: () => void }) {
  const [paused, setPaused] = useState(false)
  const left = useRef(t.duration ?? 4200)
  useEffect(() => {
    if (paused) return
    const start = Date.now(), timer = setTimeout(onClose, left.current)
    return () => { clearTimeout(timer); left.current -= Date.now() - start }
  }, [paused, onClose])
  const tone = t.tone ?? 'ok'
  return (
    <motion.div layout initial={{ opacity: 0, y: 20, scale: 0.95 }} animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, x: 60, transition: { duration: 0.2 } }} transition={spring(0.3, 0.45)}
      drag="x" dragConstraints={{ left: 0, right: 0 }} dragElastic={{ left: 0.1, right: 0.9 }}
      onDragStart={() => setPaused(true)} onDragEnd={(_, i) => { if (i.offset.x > 80 || i.velocity.x > 500) onClose(); else setPaused(false) }}
      onPointerEnter={() => setPaused(true)} onPointerLeave={() => setPaused(false)} onPointerDown={() => setPaused(true)} onFocus={() => setPaused(true)} onBlur={() => setPaused(false)}
      className={cn(floatingSurface, 'pointer-events-auto flex max-w-[340px] min-w-[260px] cursor-grab touch-pan-y items-center gap-3 rounded-xl p-3 pr-2 text-[13px] active:cursor-grabbing max-[640px]:max-w-none max-[640px]:min-w-0')}>
      <span className={cn('grid h-5 w-5 flex-none place-items-center rounded-full', tone === 'bad' ? TONE_SOFT.bad : tone === 'info' ? TONE_SOFT.accent : TONE_SOFT.ok)}>
        <Icon name={tone === 'bad' ? 'alert' : tone === 'info' ? 'info' : 'check'} size={11} strokeWidth={3} />
      </span>
      <div className="flex-1 select-none"><b className="block font-medium">{t.title}</b>{t.description && <span className="text-xs text-[var(--fg3)]">{t.description}</span>}</div>
      {t.action && <Button size="sm" onClick={() => { t.action!.onClick(); onClose() }}>{t.action.label}</Button>}
      <IconButton icon="x" label="Dismiss notification" onClick={onClose} />
    </motion.div>
  )
}

const ALERT_ICON: Record<Tone, IconName> = { neutral: 'info', accent: 'info', ok: 'check', warn: 'alert', bad: 'alert' }
/** Tinted message: icon + bold title + text. */
export function Alert({ tone = 'accent', title, children, action, className }:
  { tone?: Tone; title: ReactNode; children?: ReactNode; action?: ReactNode; className?: string }) {
  return (
    <div role={tone === 'bad' ? 'alert' : 'status'} className={cn('flex items-start gap-2.5 rounded-[10px] p-3 text-[13px]', TONE_SOFT[tone], className)}>
      <Icon name={ALERT_ICON[tone]} size={16} className="mt-0.5" />
      <p className="m-0 flex-1 text-[var(--fg)]"><b className="block font-semibold">{title}</b>{children && <span className="text-[var(--fg2)]">{children}</span>}</p>
      {action}
    </div>
  )
}

const PROGRESS_TONE = { primary: 'bg-[var(--primary)]', ok: 'bg-[var(--ok)]', warn: 'bg-[var(--warn)]', bad: 'bg-[var(--bad)]', accent: 'bg-[var(--accent)]' } as const
/** Linear progress bar; the fill springs to each new value. */
export function Progress({ value, max = 100, tone = 'primary', className, label }:
  { value: number; max?: number; tone?: keyof typeof PROGRESS_TONE; className?: string; label?: string }) {
  return (
    <div role="progressbar" aria-label={label} aria-valuenow={Math.round(value)} aria-valuemin={0} aria-valuemax={max} className={cn('h-1.5 overflow-hidden rounded-[3px] bg-[var(--muted)]', className)}>
      <motion.div className={cn('h-full rounded-[3px] transition-colors duration-300', PROGRESS_TONE[tone])} initial={false} animate={{ width: `${Math.min(100, (value / max) * 100)}%` }} transition={spring(0.1, 0.5)} />
    </div>
  )
}

/** Circular progress with a percentage in the middle. Pulses once when it reaches 100. */
export function ProgressRing({ value, size = 56, stroke = 5, label, tone = 'primary', className }:
  { value: number; size?: number; stroke?: number; label?: ReactNode; tone?: 'primary' | 'ok'; className?: string }) {
  const r = (size - stroke) / 2, c = 2 * Math.PI * r
  const [scope, animate] = useAnimate()
  const prev = useRef(value)
  useEffect(() => {
    if (value >= 100 && prev.current < 100 && scope.current) animate(scope.current, { scale: [1, 1.08, 1] }, { duration: 0.45, ease: 'easeOut' })
    prev.current = value
  }, [value, animate, scope])
  return (
    <div ref={scope} className={cn('relative inline-grid place-items-center', className)} style={{ width: size, height: size }} role="progressbar" aria-valuenow={Math.round(value)} aria-valuemin={0} aria-valuemax={100}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--muted)" strokeWidth={stroke} />
        <motion.circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={tone === 'ok' ? 'var(--ok)' : 'var(--primary)'} strokeWidth={stroke} strokeLinecap="round"
          strokeDasharray={c} initial={false} animate={{ strokeDashoffset: c * (1 - Math.min(100, value) / 100) }} transition={spring(0.1, 0.6)} />
      </svg>
      <span className={cn('absolute font-semibold', size < 52 ? 'text-[11px]' : 'text-xs')}>{label ?? <AnimatedNumber value={Math.min(100, value) / 100} format={{ style: 'percent' }} />}</span>
    </div>
  )
}

/** Centred icon, title, hint and action. The icon bobs gently (off for reduced motion or `bob={false}`). */
export function EmptyState({ icon = 'inbox', title, description, action, bob = true, className }:
  { icon?: IconName; title: ReactNode; description?: ReactNode; action?: ReactNode; bob?: boolean; className?: string }) {
  return (
    <div className={cn('flex flex-col items-center gap-3 py-4 text-center', className)}>
      <motion.span initial={{ scale: 0.8, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={spring(0.4, 0.5)}
        className="grid h-12 w-12 place-items-center rounded-2xl bg-[var(--muted)] text-[var(--fg3)]">
        <motion.span className="grid" animate={bob ? { y: [0, -5, 0] } : undefined} transition={{ duration: 2.6, repeat: Infinity, ease: 'easeInOut' }}><Icon name={icon} size={22} /></motion.span>
      </motion.span>
      <div><div className="font-semibold">{title}</div>{description && <div className="text-xs text-[var(--fg3)]">{description}</div>}</div>
      {action}
    </div>
  )
}

/** Animates height between 0 and auto when `open` changes. Accordion, Banner, TreeView and ThinkingSteps use it. */
export function Collapse({ open, children, className }: { open: boolean; children: ReactNode; className?: string }) {
  return (
    <AnimatePresence initial={false}>
      {open && (
        <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }}
          transition={spring(0.1, 0.32)} className={cn('overflow-hidden', className)}>{children}</motion.div>
      )}
    </AnimatePresence>
  )
}

/** Height follows the content with a spring, so state swaps inside never jump (permission cards, wizards, tabs of different heights). */
export function AutoHeight({ children, className }: { children: ReactNode; className?: string }) {
  const inner = useRef<HTMLDivElement>(null)
  const [h, setH] = useState<number | 'auto'>('auto')
  useLayoutEffect(() => {
    const el = inner.current; if (!el) return
    const ro = new ResizeObserver(() => setH(el.offsetHeight)); ro.observe(el)
    return () => ro.disconnect()
  }, [])
  return <motion.div initial={false} animate={{ height: h }} transition={spring(0.15, 0.4)} className={cn('overflow-hidden', className)}><div ref={inner}>{children}</div></motion.div>
}

/** Three bouncing dots: someone (the assistant, a teammate) is typing. The bounce pauses while off screen. `label` is announced. */
export function TypingDots({ label = 'Assistant is typing', className }: { label?: string; className?: string }) {
  const ref = useRef<HTMLSpanElement>(null)
  const onScreen = useInView(ref) // the bounce repeats forever: only run it while visible
  return (
    <span ref={ref} role="status" aria-label={label} className={cn('inline-flex gap-1 py-1.5', className)}>
      {[0, 1, 2].map(i => (
        <motion.span key={i} className="h-1.5 w-1.5 rounded-full bg-[var(--fg3)]" animate={onScreen ? { y: [0, -4, 0], opacity: [0.4, 1, 0.4] } : { y: 0, opacity: 0.6 }}
          transition={onScreen ? { duration: 0.7, repeat: Infinity, delay: i * 0.12 } : { duration: 0.15 }} />
      ))}
    </span>
  )
}

/** Dismissible banner. Collapses its height smoothly when closed; controllable (`open`/`onOpenChange`) so it can be shown again. */
export function Banner({ children, badge = 'New', open, defaultOpen = true, onOpenChange, onDismiss, className }:
  { children: ReactNode; badge?: ReactNode; open?: boolean; defaultOpen?: boolean; onOpenChange?: (open: boolean) => void; onDismiss?: () => void; className?: string }) {
  const [shown, setShown] = useControllable(open, defaultOpen, onOpenChange)
  return (
    <Collapse open={shown} className={className}>
      <div role="status" className="flex items-center gap-2.5 rounded-[var(--r-md)] border border-[var(--line)] bg-[var(--card)] p-2 pl-3">
        {badge && <Badge tone="accent" className="flex-none">{badge}</Badge>}
        <span className="flex-1 text-[13px]">{children}</span>
        <IconButton icon="x" label="Dismiss" onClick={() => { setShown(false); onDismiss?.() }} />
      </div>
    </Collapse>
  )
}

/* Buttons with behaviour ───────────────────────────────────────────────────── */

/**
 * Runs an async action: the button's width tweens down to a spinner square, then out to a green
 * “Saved” with a drawn check, then back. Content never stretches: only the frame's width animates.
 */
export function AsyncButton({ onClick, children, successLabel = 'Saved', variant = 'primary', size, className, ...p }:
  Omit<ButtonProps, 'onClick'> & { onClick: () => Promise<unknown>; successLabel?: string }) {
  const [state, setState] = useState<'idle' | 'loading' | 'done'>('idle')
  const [w, setW] = useState<number>()
  const probe = useRef<HTMLSpanElement>(null)
  const busy = useRef(false) // width changes tween only around a run; otherwise (fonts loading, new label) they snap
  const run = async () => {
    busy.current = true
    setState('loading')
    try { await onClick(); setState('done'); await sleep(1500) } finally { setState('idle') }
  }
  const check = (draw: boolean) => <CheckMark checked size={14} strokeWidth={3} draw={draw} delay={0.1} duration={0.35} />
  const body = (live: boolean) => state === 'loading' ? <Spinner /> : state === 'done' ? <>{check(live)}{successLabel}</> : children
  useLayoutEffect(() => {
    const el = probe.current?.firstElementChild as HTMLElement | null
    if (!el) return
    const read = () => setW(state === 'loading' ? el.offsetHeight : el.offsetWidth)
    read()
    const ro = new ResizeObserver(read); ro.observe(el) // e.g. web fonts finishing loading
    return () => ro.disconnect()
  }, [state, children, successLabel, size])
  return (
    <motion.span className={cn('relative inline-flex align-middle', className)} initial={false} animate={{ width: w ?? 'auto' }}
      transition={state === 'idle' && !busy.current ? { duration: 0 } : spring(0.12, 0.4)} onAnimationComplete={() => { if (state === 'idle') busy.current = false }}>
      <Button variant={variant} size={size} disabled={state !== 'idle'} onClick={run} aria-live="polite" {...p}
        className={cn('w-full !px-0', state === 'done' && '!border-[var(--ok)] !bg-[var(--ok)] !text-[var(--card)] !opacity-100', state === 'loading' && '!opacity-100')}>
        <AnimatePresence mode="popLayout" initial={false}>
          <motion.span key={state} className="flex items-center gap-1.5 whitespace-nowrap" initial={{ opacity: 0, scale: 0.6 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.6 }} transition={spring(0.3, 0.3)}>
            {body(true)}
          </motion.span>
        </AnimatePresence>
      </Button>
      {/* invisible twin at natural width: what the frame tweens to */}
      <span ref={probe} aria-hidden className="pointer-events-none invisible absolute top-0 left-0 w-max">
        <Button variant={variant} size={size} tabIndex={-1}><span className="flex items-center gap-1.5">{body(false)}</span></Button>
      </span>
    </motion.span>
  )
}

/** Heart that bursts on like, with a rolling count. Controlled (`liked`) or uncontrolled (`defaultLiked`). */
export function LikeButton({ count, liked: likedProp, defaultLiked = false, onChange, className }:
  { count: number; liked?: boolean; defaultLiked?: boolean; onChange?: (liked: boolean) => void; className?: string }) {
  const [liked, setLiked] = useControllable(likedProp, defaultLiked, onChange)
  const total = count + (liked ? 1 : 0) - (defaultLiked ? 1 : 0)
  return (
    <Button aria-pressed={liked} aria-label={`Like, ${total}`} className={className} onClick={() => setLiked(!liked)}>
      <motion.span animate={liked ? { scale: [1, 1.45, 1], rotate: [0, -12, 0] } : { scale: 1 }} transition={spring(0.5, 0.5)}
        className={liked ? 'text-[var(--bad)]' : ''}><Icon name="heart" fill={liked ? 'currentColor' : 'none'} /></motion.span>
      <AnimatedNumber value={total} />
    </Button>
  )
}

/**
 * Copy to the clipboard. `copied` turns true only after the write succeeded (and back after `ms`); `failed` after it was
 * refused. `text` may be a string or a function read at copy time; copy(override) copies something else.
 */
export function useCopy(text?: string | (() => string), ms = 1300) {
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle')
  const src = useRef(text), t = useRef<ReturnType<typeof setTimeout>>(undefined)
  useLayoutEffect(() => { src.current = text })
  useEffect(() => () => clearTimeout(t.current), [])
  const copy = useCallback(async (override?: string) => {
    const v = override ?? (typeof src.current === 'function' ? src.current() : src.current) ?? ''
    clearTimeout(t.current)
    let ok = false
    try { if (!navigator.clipboard) throw new Error('no clipboard'); await navigator.clipboard.writeText(v); ok = true } catch { /* blocked or unavailable */ }
    setState(ok ? 'copied' : 'failed')
    t.current = setTimeout(() => setState('idle'), ms)
    return ok
  }, [ms])
  return { copied: state === 'copied', failed: state === 'failed', copy }
}

/**
 * Copies `text`; the icon swaps to a check once the clipboard accepted it (or to a warning if it refused). Icon-only for
 * the icon sizes unless `iconOnly={false}`; otherwise shows `label` → "Copied". The result is announced.
 */
export function CopyButton({ text, label = 'Copy', size = 'icon', iconOnly = size === 'icon' || size === 'icon-sm', variant, className, onCopy }:
  { text: string | (() => string); label?: string; size?: ButtonProps['size']; iconOnly?: boolean; variant?: ButtonProps['variant']; className?: string; onCopy?: (ok: boolean) => void }) {
  const { copied, failed, copy } = useCopy(text)
  const state = copied ? 'copied' : failed ? 'failed' : 'idle'
  const said = copied ? 'Copied' : failed ? 'Couldn’t copy' : label
  return (
    <Button size={size} variant={variant} aria-label={iconOnly ? label : undefined} title={iconOnly ? label : undefined} className={className} onClick={async () => { const ok = await copy(); onCopy?.(ok) }}>
      <AnimatePresence mode="popLayout" initial={false}>
        <motion.span key={state} initial={{ scale: 0.5, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.5, opacity: 0 }} transition={spring(0.5, 0.4)}
          className={copied ? 'text-[var(--ok)]' : failed ? 'text-[var(--bad)]' : ''}><Icon name={copied ? 'check' : failed ? 'alert' : 'copy'} size={size === 'icon-sm' || size === 'sm' ? 14 : 16} strokeWidth={copied ? 3 : 2} /></motion.span>
      </AnimatePresence>
      {!iconOnly && said}
      <span className="sr-only" aria-live="polite">{state === 'idle' ? '' : said}</span>
    </Button>
  )
}

type HoldPhase = 'idle' | 'holding' | 'cancelled' | 'done'
/** Shortest hold HoldToConfirm accepts, whatever `duration` says. */
const HOLD_MIN_MS = 500
const HOLD_STATUS: Record<HoldPhase, string> = { idle: 'Release early to cancel', holding: 'Keep holding…', cancelled: 'Cancelled. Release early to cancel', done: 'Deleted' }

/**
 * Press and hold (pointer, touch, Space or Enter) to confirm a destructive action. The fill sweeps
 * across and the label inverts exactly where the fill has reached; releasing early springs it back.
 * When it completes the button pops, shows `doneLabel`, and resets after `resetAfter` ms.
 * A status line under it reads Keep holding… / Cancelled / done (`status={false}` hides it).
 * `duration` is at least 500 ms. It guards against slips, not against a hostile page: serve pages that use it with
 * `frame-ancestors 'none'` (or 'self') so another site can't frame it and coach a user into holding.
 */
export function HoldToConfirm({ onConfirm, duration = 1200, children = 'Hold to delete', doneLabel = 'Deleted', resetAfter = 2000, status, className }:
  { onConfirm: () => void; duration?: number; children?: ReactNode; doneLabel?: ReactNode; resetAfter?: number; status?: Partial<Record<HoldPhase, ReactNode>> | false; className?: string }) {
  const [phase, setPhase] = useState<HoldPhase>('idle')
  const phaseRef = useRef<HoldPhase>('idle')
  const p = useMotionValue(0)
  const clip = useTransform(p, v => `inset(0 ${100 - v * 100}% 0 0)`)
  const ctl = useRef<AnimationPlaybackControls | null>(null), reset = useRef<ReturnType<typeof setTimeout>>(undefined)
  const [scope, animateEl] = useAnimate()
  const confirm = useRef(onConfirm); confirm.current = onConfirm
  const set = (ph: HoldPhase) => { phaseRef.current = ph; setPhase(ph) }
  useEffect(() => () => { ctl.current?.stop(); clearTimeout(reset.current) }, [])

  const finish = () => {
    if (phaseRef.current !== 'holding') return
    set('done'); p.set(1); confirm.current()
    if (scope.current) animateEl(scope.current, { scale: [1, 1.06, 1] }, { duration: 0.35, ease: 'easeOut' })
    reset.current = setTimeout(() => { p.set(0); set('idle') }, resetAfter)
  }
  const ms = Math.max(HOLD_MIN_MS, Number.isFinite(duration) ? duration : 1200) // never instant: a hold must be a hold
  const start = () => {
    if (phaseRef.current === 'done' || phaseRef.current === 'holding') return
    set('holding'); ctl.current?.stop()
    ctl.current = animate(p, 1, { duration: (ms / 1000) * (1 - p.get()), ease: 'linear', onComplete: finish })
  }
  const stop = () => {
    if (phaseRef.current !== 'holding') return
    ctl.current?.stop(); set('cancelled')
    ctl.current = animate(p, 0, spring(0.1, 0.3))
  }
  const label = phase === 'done' ? <><Icon name="check" size={13} strokeWidth={3} />{doneLabel}</> : children
  const msg = status === false ? null : { ...HOLD_STATUS, ...status }[phase]
  return (
    <div className={cn('flex flex-col items-start gap-2', className)}>
      <span ref={scope} className="inline-flex">
        <Button variant="outline-danger"
          className={cn('min-w-[150px] touch-none [-webkit-touch-callout:none]', phase !== 'idle' && phase !== 'cancelled' && '!border-[var(--bad)]')}
          onPointerDown={e => { if (e.button === 0) start() }}
          onPointerUp={stop} onPointerLeave={stop} onPointerCancel={stop} onContextMenu={e => e.preventDefault()}
          onKeyDown={e => { if ((e.key === ' ' || e.key === 'Enter') && !e.repeat) { e.preventDefault(); start() } }}
          onKeyUp={e => { if (e.key === ' ' || e.key === 'Enter') stop() }} onBlur={stop}>
          <motion.span aria-hidden className="absolute inset-0 origin-left bg-[var(--bad)]" style={{ scaleX: p }} />
          <span className="relative flex items-center gap-1.5">{label}</span>
          <motion.span aria-hidden className="absolute inset-0 flex items-center justify-center gap-1.5 text-white" style={{ clipPath: clip }}>{label}</motion.span>
        </Button>
      </span>
      {msg && <span aria-live="polite" className={cn('text-xs', phase === 'done' ? 'font-medium text-[var(--bad)]' : 'text-[var(--fg3)]')}>{msg}</span>}
    </div>
  )
}

/* Consent and connection ───────────────────────────────────────────────────── */

export type CookieCategory = { id: string; label: string; description: string; required?: boolean; defaultOn?: boolean }
export type CookieChoice = { kind: 'accept' | 'reject' | 'custom'; allowed: Record<string, boolean> }

/**
 * Cookie banner where rejecting is as easy as accepting. "Customise" expands the per-category
 * switches in place (required ones are locked on) and becomes "Save choices". Slides up when `open`.
 * Place it inside a relative container (it sits at the bottom edge) or pass `className` to position it.
 */
export function CookieConsent({ categories, open, onDecision, title = 'We use cookies', description = 'Essential cookies keep the site working. Others help us improve it.', className }:
  { categories: CookieCategory[]; open: boolean; onDecision: (c: CookieChoice) => void; title?: ReactNode; description?: ReactNode; className?: string }) {
  const [custom, setCustom] = useState(false)
  const [on, setOn] = useState<Record<string, boolean>>(() => Object.fromEntries(categories.map(c => [c.id, !!(c.required || c.defaultOn)])))
  const all = (v: boolean) => Object.fromEntries(categories.map(c => [c.id, c.required ? true : v]))
  const decide = (kind: CookieChoice['kind']) => { setCustom(false); onDecision({ kind, allowed: kind === 'custom' ? on : all(kind === 'accept') }) }
  return (
    <AnimatePresence>
      {open && (
        <motion.div role="dialog" aria-label="Cookie consent" initial={{ y: 40, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 30, opacity: 0, transition: { duration: 0.2 } }}
          transition={spring(0.25, 0.4)} className={cn(floatingSurface, 'absolute inset-x-2 bottom-2 z-10 rounded-[var(--r-md)] p-3 text-[13px]', className)}>
          <b className="font-semibold">{title}</b>
          <p className="m-0 mt-0.5 mb-2.5 text-xs text-[var(--fg3)]">{description}</p>
          <Collapse open={custom}>
            <div className="mb-2">
              {categories.map(c => (
                <div key={c.id} className="border-b border-[var(--line)] py-2">
                  <Switch checked={on[c.id]} disabled={c.required} onChange={v => setOn(o => ({ ...o, [c.id]: v }))}
                    label={<span><b className="block text-[13px] font-medium">{c.label}{c.required && <Icon name="lock" size={11} className="ml-1 inline text-[var(--fg3)]" />}</b><span className="block text-xs text-[var(--fg3)]">{c.description}</span></span>} />
                </div>
              ))}
            </div>
          </Collapse>
          <div className="flex flex-wrap justify-end gap-1.5">
            <Button size="sm" variant="ghost" aria-expanded={custom} onClick={() => custom ? decide('custom') : setCustom(true)}>{custom ? 'Save choices' : 'Customise'}</Button>
            <Button size="sm" onClick={() => decide('reject')}>Reject all</Button>
            <Button size="sm" variant="primary" onClick={() => decide('accept')}>Accept all</Button>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}

/**
 * Connection bar for the top of a view. When `online` turns false it slides down, explains that
 * edits are kept locally and counts down to the next automatic retry (calling `onRetry`), with a
 * "Retry now" link. Back online, it turns green with `backMessage` and hides itself after a moment.
 */
export function OfflineIndicator({ online, onRetry, retryEvery = 5, backMessage = 'Back online. Synced 3 changes.', className }:
  { online: boolean; onRetry?: () => void; retryEvery?: number; backMessage?: ReactNode; className?: string }) {
  const [mode, setMode] = useState<'hidden' | 'offline' | 'back'>(online ? 'hidden' : 'offline')
  const [left, setLeft] = useState(retryEvery)
  const [pulse, setPulse] = useState(0), [shake, setShake] = useState(0)
  const was = useRef(online), retry = useRef(onRetry), count = useRef(retryEvery); retry.current = onRetry
  useEffect(() => {
    if (online === was.current) return
    was.current = online
    if (!online) { count.current = retryEvery; setLeft(retryEvery); setMode('offline'); return }
    setMode('back')
    const t = setTimeout(() => setMode('hidden'), 2200)
    return () => clearTimeout(t)
  }, [online, retryEvery])
  useEffect(() => {
    if (mode !== 'offline') return
    const t = setInterval(() => {
      count.current -= 1
      if (count.current <= 0) { count.current = retryEvery; retry.current?.(); setPulse(k => k + 1) }
      setLeft(count.current)
    }, 1000)
    return () => clearInterval(t)
  }, [mode, retryEvery])
  return (
    <div className={cn('pointer-events-none absolute inset-x-0 top-0 z-10 overflow-hidden', className)}>
      <AnimatePresence initial={false}>
        {mode !== 'hidden' && (
          <motion.div key={mode} role="status" initial={{ y: '-100%' }} animate={{ y: 0 }} exit={{ y: '-100%', transition: { duration: 0.25 } }} transition={spring(0.2, 0.35)}
            className={cn('pointer-events-auto flex items-center gap-2 px-3 py-2 text-xs', mode === 'offline' ? TONE_SOFT.warn : TONE_SOFT.ok)}>
            <Icon name={mode === 'offline' ? 'wifiOff' : 'check'} size={14} strokeWidth={mode === 'offline' ? 2 : 2.6} />
            {mode === 'offline' ? (
              <>
                <motion.span key={pulse} className="flex-1" initial={pulse ? { opacity: 0.5 } : false} animate={{ opacity: 1 }} transition={{ duration: 0.3 }}>
                  You’re offline. Edits are saved locally. Retrying in <b className="ui-num">{left}</b>s
                </motion.span>
                <motion.button key={`r${shake}`} className="flex-none cursor-pointer border-0 bg-transparent p-0 text-xs font-semibold text-current underline [@media(pointer:coarse)]:-my-2 [@media(pointer:coarse)]:min-h-8 [@media(pointer:coarse)]:px-1"
                  animate={shake ? { x: [0, -3, 3, 0] } : undefined} transition={{ duration: 0.25 }}
                  onClick={() => { retry.current?.(); count.current = retryEvery; setLeft(retryEvery); setShake(k => k + 1) }}>Retry now</motion.button>
              </>
            ) : <span className="flex-1">{backMessage}</span>}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

/** Confetti burst from a point (defaults to screen centre). Use it for real milestones, not every click. */
export function confetti({ x = innerWidth / 2, y = innerHeight / 2, count = 120 } = {}) {
  if (prefersReducedMotion()) return
  const c = document.createElement('canvas'); c.width = innerWidth; c.height = innerHeight
  c.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:100'; document.body.appendChild(c)
  const ctx = c.getContext('2d')!, cs = getComputedStyle(document.documentElement)
  const colors = ['--c2', '--c3', '--c4', '--bad', '--warn'].map(k => cs.getPropertyValue(k).trim() || '#2563EB')
  const ps = Array.from({ length: count }, () => {
    const a = Math.random() * Math.PI * 2, v = 4 + Math.random() * 9
    return { x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 6, r: Math.random() * Math.PI, vr: (Math.random() - 0.5) * 0.4, w: 5 + Math.random() * 5, c: colors[Math.floor(Math.random() * colors.length)] }
  })
  const t0 = performance.now()
  const frame = (t: number) => {
    const life = (t - t0) / 1800; ctx.clearRect(0, 0, c.width, c.height)
    for (const p of ps) {
      p.vy += 0.32; p.vx *= 0.985; p.x += p.vx; p.y += p.vy; p.r += p.vr
      ctx.save(); ctx.globalAlpha = Math.max(0, 1 - life); ctx.translate(p.x, p.y); ctx.rotate(p.r); ctx.fillStyle = p.c; ctx.fillRect(-p.w / 2, -p.w / 4, p.w, p.w / 2); ctx.restore()
    }
    if (life < 1) requestAnimationFrame(frame); else c.remove()
  }
  requestAnimationFrame(frame)
}
