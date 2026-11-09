import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react'
import { AnimatePresence, type AnimationPlaybackControls, animate, motion, useAnimate, useInView, useMotionValue, useTransform, type Transition } from 'motion/react'
import { AnimatedNumber, Badge, Button, type ButtonProps, Icon, IconButton, type IconName, Spinner, TONE_SOFT, type Tone, cn, defineMessages, dirX, floatingSurface, prefersReducedMotion, sleep, spring, uiAddHost, uiShared, useControllable, useLocale, useMessages } from './core'
import { CheckMark } from './forms'

/* ════════════════════════════════════════════════════════════════════════════
 * 8. FEEDBACK
 * ══════════════════════════════════════════════════════════════════════════ */

/** Feedback strings not in the core catalog (override with `<UIProvider messages={{ 'feedback.new': … }}>`). de/ar machine-drafted. */
const FEEDBACK_MSG = defineMessages('feedback', {
  en: {
    new: 'New', holdToDelete: 'Hold to delete', deleted: 'Deleted', holdIdle: 'Release early to cancel', holdHolding: 'Keep holding…',
    holdCancelled: 'Cancelled. Release early to cancel', backOnline: 'Back online.',
    offlineSaved: 'You’re offline. Edits are saved locally.', retryIn: 'Retrying in {seconds} s', retrying: 'Retrying…', offlineSaid: 'You’re offline. Retrying automatically.',
  },
  de: {
    new: 'Neu', holdToDelete: 'Zum Löschen halten', deleted: 'Gelöscht', holdIdle: 'Früher loslassen, um abzubrechen', holdHolding: 'Weiter halten…',
    holdCancelled: 'Abgebrochen. Früher loslassen, um abzubrechen', backOnline: 'Wieder online.',
    offlineSaved: 'Du bist offline. Änderungen werden lokal gespeichert.', retryIn: 'Neuer Versuch in {seconds} s', retrying: 'Neuer Versuch…', offlineSaid: 'Du bist offline. Es wird automatisch erneut versucht.',
  },
  ar: {
    new: 'جديد', holdToDelete: 'اضغط مطولًا للحذف', deleted: 'تم الحذف', holdIdle: 'أفلت مبكرًا للإلغاء', holdHolding: 'استمر في الضغط…',
    holdCancelled: 'أُلغي. أفلت مبكرًا للإلغاء', backOnline: 'عاد الاتصال.',
    offlineSaved: 'أنت غير متصل. تُحفظ التعديلات محليًا.', retryIn: 'إعادة المحاولة خلال {seconds} ث', retrying: 'جارٍ إعادة المحاولة…', offlineSaid: 'أنت غير متصل. ستتم إعادة المحاولة تلقائيًا.',
  },
})

export type ToastInput = { title: ReactNode; description?: ReactNode; tone?: 'ok' | 'bad' | 'info'; action?: { label: string; onClick: () => void }; duration?: number }
type ToastItem = ToastInput & { id: number }
/** A toast queue: the page-wide one (shared by every copy of the library) or a ToastProvider's own. */
type ToastQueue = { items: ToastItem[]; max: number; listeners: Set<() => void> }
const toastQueue = (max = 5): ToastQueue => ({ items: [], max, listeners: new Set() })
const toastEmit = (q: ToastQueue) => q.listeners.forEach(l => l())
const toastPush = (q: ToastQueue, t: ToastInput) => { q.items = [...q.items, { ...t, id: Date.now() + Math.random() }].slice(-q.max); toastEmit(q) }
const toastRemove = (q: ToastQueue, id: number) => { q.items = q.items.filter(t => t.id !== id); toastEmit(q) }
const toastNone: ToastItem[] = []
/** The page-wide queue behind useToast() outside a ToastProvider (one per page, whichever files the components came from). */
const toastPage = uiShared('toasts', () => toastQueue())
const ToastCtx = createContext<((t: ToastInput) => void) | null>(null)
/** Shows a toast in the page-wide region; the region mounts itself (in UIProvider's host) on the first toast. */
function toastShow(t: ToastInput) { uiAddHost('toasts', ToastPageRegion); toastPush(toastPage, t) }
/** const toast = useToast(); toast({ title: 'Saved', tone: 'ok', action: { label: 'Undo', onClick } }) */
export const useToast = () => useContext(ToastCtx) ?? toastShow

/** The page-wide toast region (mounted through UIProvider's host outlet). */
function ToastPageRegion() { return <ToastRegion queue={toastPage} /> }

/**
 * Hosts its own toasts for the tree inside it. UIProvider no longer needs one (0.4): useToast() outside a ToastProvider
 * uses the page-wide region. At most `max` (default 5) are on screen: a new toast drops the oldest, so a burst of
 * notifications can't pile up without limit. The region stays usable while a modal makes the page inert.
 */
export function ToastProvider({ children, max = 5 }: { children: ReactNode; max?: number }) {
  const [queue] = useState(() => toastQueue())
  queue.max = Math.max(1, Math.floor(Number.isFinite(max) ? max : 5))
  const push = useCallback((t: ToastInput) => toastPush(queue, t), [queue])
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <ToastRegion queue={queue} />
    </ToastCtx.Provider>
  )
}

/** The fixed region the toasts of one queue stack in: bottom end corner (bottom right, bottom left in RTL), full width on phones. */
function ToastRegion({ queue }: { queue: ToastQueue }) {
  const { t } = useLocale()
  const items = useSyncExternalStore(useCallback((cb: () => void) => { queue.listeners.add(cb); return () => { queue.listeners.delete(cb) } }, [queue]), () => queue.items, () => toastNone)
  const [heights, setHeights] = useState<Record<number, number>>({})
  const close = useCallback((id: number) => {
    toastRemove(queue, id)
    setHeights(({ [id]: _gone, ...rest }) => rest) // eslint-disable-line @typescript-eslint/no-unused-vars
  }, [queue])
  const report = useCallback((id: number, h: number) => setHeights(m => m[id] === h ? m : { ...m, [id]: h }), [])
  // Every toast sits at the bottom of the region and is lifted by the heights of the newer toasts below it (a transform),
  // so a toast leaving or arriving moves the others with an animated transform, never by re-flowing the layout.
  const lift = new Map<number, number>()
  for (let k = items.length - 1, acc = 0; k >= 0; k--) { lift.set(items[k].id, acc); acc += (heights[items[k].id] ?? 0) + 8 }
  return (
    // one live region for all toasts (the toasts themselves carry no role, so nothing is announced twice); the insets are
    // physical because they include the safe areas: right in LTR, left in RTL (rtl-lint-ignore)
    <div role="region" aria-label={t('feedback.notifications')} data-modal-keep className="pointer-events-none fixed right-[max(16px,env(safe-area-inset-right))] bottom-[max(16px,env(safe-area-inset-bottom))] z-[80] h-0 w-[340px] max-w-[calc(100vw-32px)] rtl:right-auto rtl:left-[max(16px,env(safe-area-inset-left))] max-[640px]:left-[max(12px,env(safe-area-inset-left))] max-[640px]:right-[max(12px,env(safe-area-inset-right))] max-[640px]:rtl:right-[max(12px,env(safe-area-inset-right))] max-[640px]:w-auto max-[640px]:max-w-none" aria-live="polite">
      <AnimatePresence initial={false}>
        {items.map(x => <Toast key={x.id} t={x} lift={lift.get(x.id) ?? 0} onSize={report} onClose={close} />)}
      </AnimatePresence>
    </div>
  )
}

/**
 * One toast. Dismiss with the ✕, by swiping it toward the end edge (right, left in RTL; touch or mouse), or let it time
 * out. Full width on phones. The timer pauses while it is hovered, focused or being touched. `lift` is its distance above
 * the region's bottom.
 */
function Toast({ t, lift, onSize, onClose: closeById }: { t: ToastItem; lift: number; onSize: (id: number, h: number) => void; onClose: (id: number) => void }) {
  const { t: tr, dir } = useLocale()
  const [paused, setPaused] = useState(false)
  const left = useRef(t.duration ?? 4200)
  const box = useRef<HTMLDivElement>(null)
  const onClose = useCallback(() => closeById(t.id), [closeById, t.id])
  useLayoutEffect(() => { // report the height before paint, so the stack lifts the others in the same frame
    const el = box.current; if (!el) return
    onSize(t.id, el.offsetHeight)
    const ro = new ResizeObserver(() => onSize(t.id, el.offsetHeight))
    ro.observe(el); return () => ro.disconnect()
  }, [t.id, onSize])
  useEffect(() => {
    if (paused) return
    const start = Date.now(), timer = setTimeout(onClose, left.current)
    return () => { clearTimeout(timer); left.current -= Date.now() - start }
  }, [paused, onClose])
  const tone = t.tone ?? 'ok', rtl = dir === 'rtl'
  return (
    <motion.div ref={box} initial={{ opacity: 0, y: 20 - lift, scale: 0.95 }} animate={{ opacity: 1, y: -lift, scale: 1 }}
      exit={{ opacity: 0, x: dirX(60, dir), transition: { duration: 0.2 } }} transition={spring(0.3, 0.45)}
      drag="x" dragConstraints={{ left: 0, right: 0 }} dragElastic={rtl ? { left: 0.9, right: 0.1 } : { left: 0.1, right: 0.9 }}
      onDragStart={() => setPaused(true)} onDragEnd={(_, i) => { if (dirX(i.offset.x, dir) > 80 || dirX(i.velocity.x, dir) > 500) onClose(); else setPaused(false) }}
      onPointerEnter={() => setPaused(true)} onPointerLeave={() => setPaused(false)} onPointerDown={() => setPaused(true)} onFocus={() => setPaused(true)} onBlur={() => setPaused(false)}
      className={cn(floatingSurface, 'pointer-events-auto absolute end-0 bottom-0 flex max-w-full min-w-[260px] cursor-grab touch-pan-y items-center gap-3 p-3 pe-2 text-[13px] active:cursor-grabbing max-[640px]:start-0 max-[640px]:min-w-0')}>
      <span className={cn('grid h-5 w-5 flex-none place-items-center rounded-full', tone === 'bad' ? TONE_SOFT.bad : tone === 'info' ? TONE_SOFT.accent : TONE_SOFT.ok)}>
        <Icon name={tone === 'bad' ? 'alert' : tone === 'info' ? 'info' : 'check'} size={11} strokeWidth={3} />
      </span>
      <div className="flex-1 select-none"><b className="block font-medium">{t.title}</b>{t.description && <span className="text-xs text-[var(--fg3)]">{t.description}</span>}</div>
      {t.action && <Button size="sm" onClick={() => { t.action!.onClick(); onClose() }}>{t.action.label}</Button>}
      <IconButton icon="x" label={tr('feedback.dismissNotification')} onClick={onClose} />
    </motion.div>
  )
}

const ALERT_ICON: Record<Tone, IconName> = { neutral: 'info', accent: 'info', ok: 'check', warn: 'alert', bad: 'alert' }
/** Tinted message: icon + bold title + text. */
export function Alert({ tone = 'accent', title, children, action, className }:
  { tone?: Tone; title: ReactNode; children?: ReactNode; action?: ReactNode; className?: string }) {
  return (
    <div role={tone === 'bad' ? 'alert' : 'status'} className={cn('flex items-start gap-2.5 rounded-[var(--r-md)] p-3 text-[13px]', TONE_SOFT[tone], className)}>
      <Icon name={ALERT_ICON[tone]} size={16} className="mt-0.5" />
      <p className="m-0 flex-1 text-[var(--fg)]"><b className="block font-semibold">{title}</b>{children && <span className="text-[var(--fg2)]">{children}</span>}</p>
      {action}
    </div>
  )
}

const PROGRESS_TONE = { primary: 'bg-[var(--primary)]', ok: 'bg-[var(--ok)]', warn: 'bg-[var(--warn)]', bad: 'bg-[var(--bad)]', accent: 'bg-[var(--accent)]' } as const
/** Linear progress bar; the fill springs to each new value. `label` names it for screen readers (default "Progress"; say what is progressing). */
export function Progress({ value, max = 100, tone = 'primary', className, label }:
  { value: number; max?: number; tone?: keyof typeof PROGRESS_TONE; className?: string; label?: string }) {
  const { t } = useLocale()
  return (
    <div role="progressbar" aria-label={label ?? t('status.progress')} aria-valuenow={Math.round(value)} aria-valuemin={0} aria-valuemax={max} className={cn('h-1.5 overflow-hidden rounded-full bg-[var(--muted)]', className)}>
      <motion.div className={cn('h-full rounded-full transition-colors duration-300', PROGRESS_TONE[tone])} initial={false} animate={{ width: `${Math.min(100, (value / max) * 100)}%` }} transition={spring(0.1, 0.5)} />
    </div>
  )
}

/**
 * Circular progress with a percentage in the middle (or `label`). Pulses once when it reaches 100. `aria-label` names the
 * progressbar for screen readers (default "Progress").
 */
export function ProgressRing({ value, size = 56, stroke = 5, label, tone = 'primary', className, 'aria-label': ariaLabel }:
  { value: number; size?: number; stroke?: number; label?: ReactNode; tone?: 'primary' | 'ok'; className?: string; 'aria-label'?: string }) {
  const { t } = useLocale()
  const r = (size - stroke) / 2, c = 2 * Math.PI * r
  const [scope, animate] = useAnimate()
  const prev = useRef(value)
  useEffect(() => {
    if (value >= 100 && prev.current < 100 && scope.current) animate(scope.current, { scale: [1, 1.08, 1] }, { duration: 0.45, ease: 'easeOut' })
    prev.current = value
  }, [value, animate, scope])
  return (
    <div ref={scope} className={cn('relative inline-grid place-items-center', className)} style={{ width: size, height: size }} role="progressbar" aria-label={ariaLabel ?? t('status.progress')} aria-valuenow={Math.round(value)} aria-valuemin={0} aria-valuemax={100}>
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
        className="grid h-12 w-12 place-items-center rounded-[var(--r-lg)] bg-[var(--muted)] text-[var(--fg3)]">
        <motion.span className="grid" animate={bob ? { y: [0, -5, 0] } : undefined} transition={{ duration: 2.6, repeat: Infinity, ease: 'easeInOut' }}><Icon name={icon} size={22} /></motion.span>
      </motion.span>
      <div><div className="font-semibold">{title}</div>{description && <div className="text-xs text-[var(--fg3)]">{description}</div>}</div>
      {action}
    </div>
  )
}

/**
 * Animated height. `open` toggles the content between 0 and its height (it unmounts when closed): Accordion, Banner,
 * TreeView and ThinkingSteps use it. While open, the height also follows the content with a spring, so state swaps
 * inside never jump (permission cards, wizards, tabs of different heights). Leave `open` out for that alone (AutoHeight).
 */
export function Collapse({ open = true, children, className, transition = spring(0.1, 0.32) }:
  { open?: boolean; children: ReactNode; className?: string; /** default spring(0.1, 0.32) */ transition?: Transition }) {
  return (
    <AnimatePresence initial={false}>
      {open && <CollapsePanel className={className} transition={transition}>{children}</CollapsePanel>}
    </AnimatePresence>
  )
}
function CollapsePanel({ children, className, transition }: { children: ReactNode; className?: string; transition: Transition }) {
  const inner = useRef<HTMLDivElement>(null)
  // 'auto' until measured: the first frame (and the server render) is the natural height, so opening and hydrating never shift
  const [h, setH] = useState<number | 'auto'>('auto')
  useLayoutEffect(() => {
    const el = inner.current; if (!el) return
    const ro = new ResizeObserver(() => setH(el.offsetHeight)); ro.observe(el)
    return () => ro.disconnect()
  }, [])
  return (
    <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: h, opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={transition} className={cn('overflow-hidden', className)}>
      <div ref={inner}>{children}</div>
    </motion.div>
  )
}

/** Height follows the content with a spring, so state swaps inside never jump. Collapse with no `open` (always shown), a little softer. */
export function AutoHeight({ children, className }: { children: ReactNode; className?: string }) {
  return <Collapse className={className} transition={spring(0.15, 0.4)}>{children}</Collapse>
}

/** Three bouncing dots: someone (the assistant, a teammate) is typing. The bounce pauses while off screen. `label` is announced. */
export function TypingDots({ label, className }: { label?: string; className?: string }) {
  const { t } = useLocale()
  const ref = useRef<HTMLSpanElement>(null)
  const onScreen = useInView(ref) // the bounce repeats forever: only run it while visible
  return (
    <span ref={ref} role="status" aria-label={label ?? t('status.assistantTyping')} className={cn('inline-flex gap-1 py-1.5', className)}>
      {[0, 1, 2].map(i => (
        <motion.span key={i} className="h-1.5 w-1.5 rounded-full bg-[var(--fg3)]" animate={onScreen ? { y: [0, -4, 0], opacity: [0.4, 1, 0.4] } : { y: 0, opacity: 0.6 }}
          transition={onScreen ? { duration: 0.7, repeat: Infinity, delay: i * 0.12 } : { duration: 0.15 }} />
      ))}
    </span>
  )
}

/** Dismissible banner. Collapses its height smoothly when closed; controllable (`open`/`onOpenChange`) so it can be shown again. */
export function Banner({ children, badge, open, defaultOpen = true, onOpenChange, onDismiss, className }:
  { children: ReactNode; /** default "New" in the locale; `null` for none */ badge?: ReactNode; open?: boolean; defaultOpen?: boolean; onOpenChange?: (open: boolean) => void; onDismiss?: () => void; className?: string }) {
  const [shown, setShown] = useControllable(open, defaultOpen, onOpenChange)
  const { t } = useLocale(), tf = useMessages(FEEDBACK_MSG)
  if (badge === undefined) badge = tf('new')
  return (
    <Collapse open={shown} className={className}>
      <div role="status" className="flex items-center gap-2.5 rounded-[var(--r-md)] border border-[var(--line)] bg-[var(--card)] p-2 ps-3">
        {badge && <Badge tone="accent" className="flex-none">{badge}</Badge>}
        <span className="flex-1 text-[13px]">{children}</span>
        <IconButton icon="x" label={t('common.dismiss')} onClick={() => { setShown(false); onDismiss?.() }} />
      </div>
    </Collapse>
  )
}

/* Buttons with behaviour ───────────────────────────────────────────────────── */

/**
 * Runs an async action: the button's width tweens down to a spinner square, then out to a green
 * “Saved” with a drawn check, then back. Content never stretches: only the frame's width animates.
 */
export function AsyncButton({ onClick, children, successLabel: successProp, variant = 'primary', size, className, ...p }:
  Omit<ButtonProps, 'onClick'> & { onClick: () => Promise<unknown>; /** default "Saved" in the locale */ successLabel?: string }) {
  const { t } = useLocale(), successLabel = successProp ?? t('common.saved')
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
      <span ref={probe} aria-hidden className="pointer-events-none invisible absolute top-0 start-0 w-max">
        <Button variant={variant} size={size} tabIndex={-1}><span className="flex items-center gap-1.5">{body(false)}</span></Button>
      </span>
    </motion.span>
  )
}

/** Heart that bursts on like, with a rolling count. Controlled (`liked`) or uncontrolled (`defaultLiked`). */
export function LikeButton({ count, liked: likedProp, defaultLiked = false, onChange, className }:
  { count: number; liked?: boolean; defaultLiked?: boolean; onChange?: (liked: boolean) => void; className?: string }) {
  const [liked, setLiked] = useControllable(likedProp, defaultLiked, onChange)
  const { t } = useLocale()
  const total = count + (liked ? 1 : 0) - (defaultLiked ? 1 : 0)
  return (
    <Button aria-pressed={liked} aria-label={t('feedback.like', { count: total })} className={className} onClick={() => setLiked(!liked)}>
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
 * Copies `text`. On success the icon swaps to a check and the label (or, icon-only, the accessible name and tooltip) to
 * `copiedLabel` for `duration` ms (default 1.5 s); a refusal shows a warning and `failedLabel`. Either result is announced
 * in a polite live region next to the button. Icon-only for the icon sizes unless `iconOnly={false}`. The label keeps the
 * width of the longer of `label`/`copiedLabel`, so the button doesn't change size. Takes every other button prop.
 */
export function CopyButton({ text, label: labelProp, copiedLabel: copiedProp, failedLabel: failedProp, duration = 1500, size = 'icon', iconOnly = size === 'icon' || size === 'icon-sm' || size === 'icon-xs', variant, className, onCopy, ...rest }:
  Omit<ButtonProps, 'onClick' | 'children' | 'size' | 'variant'> & {
    text: string | (() => string); label?: string; copiedLabel?: string; failedLabel?: string; duration?: number
    size?: ButtonProps['size']; iconOnly?: boolean; variant?: ButtonProps['variant']; className?: string; onCopy?: (ok: boolean) => void
  }) {
  const { copied, failed, copy } = useCopy(text, duration)
  const { t } = useLocale()
  const label = labelProp ?? t('common.copy'), copiedLabel = copiedProp ?? t('common.copied'), failedLabel = failedProp ?? t('common.copyFailed')
  const state = copied ? 'copied' : failed ? 'failed' : 'idle'
  const said = copied ? copiedLabel : failed ? failedLabel : label
  const small = size === 'icon-sm' || size === 'sm' || size === 'xs' || size === 'icon-xs'
  return (
    <>
      <Button size={size} variant={variant} aria-label={iconOnly ? said : undefined} title={iconOnly ? said : undefined} className={className} {...rest}
        onClick={async () => { const ok = await copy(); onCopy?.(ok) }}>
        <AnimatePresence mode="popLayout" initial={false}>
          <motion.span key={state} initial={{ scale: 0.5, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.5, opacity: 0 }} transition={spring(0.5, 0.4)}
            className={cn('grid', copied ? 'text-[var(--ok)]' : failed ? 'text-[var(--bad)]' : '')}><Icon name={copied ? 'check' : failed ? 'alert' : 'copy'} size={small ? 14 : 16} strokeWidth={copied ? 3 : 2} /></motion.span>
        </AnimatePresence>
        {!iconOnly && (
          <span className="grid text-start [&>span]:col-start-1 [&>span]:row-start-1">
            {failed ? <span>{failedLabel}</span> : <>
              <span className={cn(copied && 'invisible')}>{label}</span>
              <span className={cn(!copied && 'invisible')}>{copiedLabel}</span>
            </>}
          </span>
        )}
      </Button>
      <span role="status" aria-live="polite" className="sr-only">{state === 'idle' ? '' : said}</span>
    </>
  )
}

type HoldPhase = 'idle' | 'holding' | 'cancelled' | 'done'
/** Shortest hold HoldToConfirm accepts, whatever `duration` says. */
const HOLD_MIN_MS = 500

/**
 * Press and hold (pointer, touch, Space or Enter) to confirm a destructive action. The fill sweeps
 * across and the label inverts exactly where the fill has reached; releasing early springs it back.
 * When it completes the button pops, shows `doneLabel`, and resets after `resetAfter` ms.
 * A status line under it reads Keep holding… / Cancelled / done (`status={false}` hides it).
 * `duration` is at least 500 ms. It guards against slips, not against a hostile page: serve pages that use it with
 * `frame-ancestors 'none'` (or 'self') so another site can't frame it and coach a user into holding.
 */
export function HoldToConfirm({ onConfirm, duration = 1200, children, doneLabel, resetAfter = 2000, status, className }:
  { onConfirm: () => void; duration?: number; /** default "Hold to delete" in the locale */ children?: ReactNode; /** default "Deleted" */ doneLabel?: ReactNode; resetAfter?: number; status?: Partial<Record<HoldPhase, ReactNode>> | false; className?: string }) {
  const tf = useMessages(FEEDBACK_MSG), { dir } = useLocale()
  const [phase, setPhase] = useState<HoldPhase>('idle')
  const phaseRef = useRef<HoldPhase>('idle')
  const p = useMotionValue(0)
  // the fill grows from the start edge: the clip trims the end side (right in LTR, left in RTL)
  const clip = useTransform(p, v => dir === 'rtl' ? `inset(0 0 0 ${100 - v * 100}%)` : `inset(0 ${100 - v * 100}% 0 0)`)
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
  const label = phase === 'done' ? <><Icon name="check" size={13} strokeWidth={3} />{doneLabel ?? tf('deleted')}</> : children ?? tf('holdToDelete')
  const said: Record<HoldPhase, ReactNode> = { idle: tf('holdIdle'), holding: tf('holdHolding'), cancelled: tf('holdCancelled'), done: tf('deleted') }
  const msg = status === false ? null : { ...said, ...status }[phase]
  return (
    <div className={cn('flex flex-col items-start gap-2', className)}>
      <span ref={scope} className="inline-flex">
        <Button variant="outline-danger"
          className={cn('min-w-[150px] touch-none [-webkit-touch-callout:none]', phase !== 'idle' && phase !== 'cancelled' && '!border-[var(--bad)]')}
          onPointerDown={e => { if (e.button === 0) start() }}
          onPointerUp={stop} onPointerLeave={stop} onPointerCancel={stop} onContextMenu={e => e.preventDefault()}
          onKeyDown={e => { if ((e.key === ' ' || e.key === 'Enter') && !e.repeat) { e.preventDefault(); start() } }}
          onKeyUp={e => { if (e.key === ' ' || e.key === 'Enter') stop() }} onBlur={stop}>
          {/* rtl-lint-ignore: the fill grows from the start edge (rtl: twin) */}
          <motion.span aria-hidden className="absolute inset-0 origin-left bg-[var(--bad)] rtl:origin-right" style={{ scaleX: p }} />
          <span className="relative flex items-center gap-1.5">{label}</span>
          <motion.span aria-hidden className="absolute inset-0 flex items-center justify-center gap-1.5 text-white" style={{ clipPath: clip }}>{label}</motion.span>
        </Button>
      </span>
      {msg && <span aria-live="polite" className={cn('text-xs', phase === 'done' ? 'font-medium text-[var(--bad)]' : 'text-[var(--fg3)]')}>{msg}</span>}
    </div>
  )
}

/* Connection ───────────────────────────────────────────────────── */

/**
 * Connection bar for the top of a view. When `online` turns false it slides down, explains that edits are kept
 * locally and counts down to the next automatic retry (calling `onRetry`), with a "Retry now" link; at each retry a
 * small spinner reads "Retrying…" for a second, in place. Back online, the same bar cross-fades to green with
 * `backMessage` and slides away after a moment. One persistent bar: both states share one grid cell, so nothing
 * stacks, jumps or reflows (the countdown has a fixed width), and only appearing/disappearing moves it (a transform,
 * none under reduced motion). Screen readers hear the state changes only, never the countdown. `paused` stops the
 * countdown and automatic retries (e.g. while the view is off screen) without pretending to be online.
 */
export function OfflineIndicator({ online, onRetry, retryEvery = 5, paused = false, backMessage, className }: {
  online: boolean; onRetry?: () => void; retryEvery?: number
  /** stop counting down and retrying automatically (e.g. while off screen); "Retry now" still works */ paused?: boolean
  /** default "Back online." in the locale; say what synced, e.g. "Back online. Synced 3 changes." */ backMessage?: ReactNode; className?: string
}) {
  const { t, fmt } = useLocale(), tf = useMessages(FEEDBACK_MSG)
  const [mode, setMode] = useState<'hidden' | 'offline' | 'back'>(online ? 'hidden' : 'offline')
  const [left, setLeft] = useState(retryEvery)
  const [retrying, setRetrying] = useState(false)
  const [changed, setChanged] = useState(false) // the live region speaks only after a change, never on mount
  const was = useRef(online), retry = useRef(onRetry), count = useRef(retryEvery), spinT = useRef<ReturnType<typeof setTimeout>>(undefined)
  retry.current = onRetry
  const runRetry = useCallback(() => {
    retry.current?.(); count.current = retryEvery; setLeft(retryEvery)
    setRetrying(true); clearTimeout(spinT.current); spinT.current = setTimeout(() => setRetrying(false), 1000)
  }, [retryEvery])
  useEffect(() => () => clearTimeout(spinT.current), [])
  useEffect(() => {
    if (online === was.current) return
    was.current = online; setChanged(true)
    if (online) { setMode('back'); return }
    count.current = retryEvery; setLeft(retryEvery); setRetrying(false); setMode('offline')
  }, [online, retryEvery])
  useEffect(() => { if (mode !== 'back') return; const id = setTimeout(() => setMode('hidden'), 2200); return () => clearTimeout(id) }, [mode])
  useEffect(() => {
    if (mode !== 'offline' || paused) return
    const id = setInterval(() => { count.current -= 1; if (count.current <= 0) runRetry(); else setLeft(count.current) }, 1000)
    return () => clearInterval(id)
  }, [mode, paused, runRetry])
  const offline = mode === 'offline'
  // the countdown keeps one width: every digit is stacked invisibly in the same cell (tabular in Latin, any width in
  // Arabic), drawn by CSS so the text stays "Retrying in 4 s" for copy and tests
  const digits = String(Math.max(1, Math.floor(retryEvery))).length
  const num = (
    <span className="ui-num inline-grid justify-items-center font-semibold [&>*]:[grid-area:1/1]">
      {'0123456789'.split('').map(d => <span key={d} data-n={fmt.number(Number(d.repeat(digits)))} className="invisible before:content-[attr(data-n)]" />)}
      <span>{fmt.number(left)}</span>
    </span>
  )
  const [before, after] = tf('retryIn', { seconds: '\u0000' }).split('\u0000')
  const live = !changed || mode === 'hidden' ? '' : offline ? tf('offlineSaid') : (backMessage ?? tf('backOnline'))
  const layer = 'col-start-1 row-start-1 flex min-w-0 items-center gap-2 transition-opacity duration-200'
  return (
    <div className={cn('pointer-events-none absolute inset-x-0 top-0 z-10 overflow-hidden', className)}>
      <span role="status" className="sr-only">{live}</span>
      <AnimatePresence initial={false}>
        {mode !== 'hidden' && (
          <motion.div key="bar" initial={{ y: '-100%' }} animate={{ y: 0 }} exit={{ y: '-100%', transition: { duration: 0.25 } }} transition={spring(0.2, 0.35)}
            className={cn('pointer-events-auto grid min-h-9 items-center px-3 py-1.5 text-xs transition-[background-color,color] duration-300', offline ? TONE_SOFT.warn : TONE_SOFT.ok)}>
            <div inert={!offline} className={cn(layer, offline ? 'opacity-100' : 'opacity-0')}>
              <Icon name="wifiOff" size={14} className="flex-none" />
              <span className="min-w-0 flex-1">
                {tf('offlineSaved')}{' '}
                {/* the countdown and the brief "Retrying…" share a cell; screen readers get the state from the live region */}
                <span aria-hidden className="inline-grid whitespace-nowrap align-bottom [&>*]:[grid-area:1/1]">
                  <span className={cn('transition-opacity duration-200', retrying ? 'opacity-0' : 'opacity-100')}>{before}{num}{after}</span>
                  <span className={cn('inline-flex items-center gap-1 transition-opacity duration-200', retrying ? 'opacity-100' : 'opacity-0')}>
                    {retrying && <Spinner size={10} label="" className="!border-[1.5px]" />}{tf('retrying')}
                  </span>
                </span>
              </span>
              <button type="button" onClick={runRetry}
                className="flex-none cursor-pointer border-0 bg-transparent p-0 text-xs font-semibold text-current underline [@media(pointer:coarse)]:-my-2 [@media(pointer:coarse)]:min-h-8 [@media(pointer:coarse)]:px-1">{t('common.retryNow')}</button>
            </div>
            <div aria-hidden inert={offline} className={cn(layer, offline ? 'opacity-0' : 'opacity-100')}>
              <Icon name="check" size={14} strokeWidth={2.6} className="flex-none" />
              <span className="min-w-0 flex-1">{backMessage ?? tf('backOnline')}</span>
            </div>
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
