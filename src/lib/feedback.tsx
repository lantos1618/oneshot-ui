import { createContext, isValidElement, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type MouseEvent as ReactMouseEvent, type ReactNode } from 'react'
import { AnimatePresence, type AnimationPlaybackControls, animate, motion, useAnimate, useInView, useIsPresent, useMotionValue, useTransform, type Transition } from 'motion/react'
import { AnimatedNumber, Badge, Button, type ButtonProps, Icon, IconButton, type IconName, Spinner, TONE_SOFT, type Tone, cn, prefersReducedMotion, sleep, spring, uiAddHost, uiShared, useControllable, fmt, surface, useResizeObserver, useStatusFlash, writeClipboard } from './core'
import { CheckMark } from './fields'

/** A toast's id: the one `toast()` returns, or your own (`toast({ id: 'save', … })` replaces the toast with that id). */
export type ToastId = string | number
/** 'ok' (default), 'info', 'warn', 'bad' (announced assertively) or 'loading' (a spinner; stays until updated). */
export type ToastTone = 'ok' | 'bad' | 'info' | 'warn' | 'loading'
/** Where a stack sits: top or bottom × start, center or end. */
export type ToastPosition = 'top-start' | 'top-center' | 'top-end' | 'bottom-start' | 'bottom-center' | 'bottom-end'
/** Why a toast left: its timer, the ✕, a swipe, its action button, or `toast.dismiss()`. */
export type ToastDismissReason = 'timeout' | 'close' | 'swipe' | 'action' | 'api'
/** The button on a toast. `label` defaults to "Undo"; the toast closes after `onClick` unless it calls `e.preventDefault()`. */
export type ToastAction = { label?: string; onClick: (e: ReactMouseEvent<HTMLButtonElement>) => void }
export type ToastInput = {
  /** dedupe: a toast with the same id is replaced in place (same slot, timer restarted) instead of stacking a second one */
  id?: ToastId
  title: ReactNode; description?: ReactNode; tone?: ToastTone; action?: ToastAction
  /** ms on screen (default 4200, 6000 with an action); `Infinity` keeps it until it is dismissed. Loading toasts never time out. */
  duration?: number
  /** overrides the queue's position (ToastProvider `position`, or `toast.configure`) for this toast */
  position?: ToastPosition
  /** called once when the toast leaves, with the reason */
  onDismiss?: (reason: ToastDismissReason, id: ToastId) => void
}
/** What a promise toast shows in one state: a title, a full toast, or (success/error) a function of the value or error. */
export type ToastContent = ReactNode | Partial<Omit<ToastInput, 'id'>>
export type ToastPromiseOptions<T> = Omit<ToastInput, 'title' | 'tone'> & {
  loading: ToastContent; success: ToastContent | ((value: T) => ToastContent); error: ToastContent | ((error: unknown) => ToastContent)
}
/** `toast.undoable`: a toast with an Undo button; `onCommit` runs when it leaves without Undo (the deferred-delete pattern). */
export type ToastUndoOptions = Omit<ToastInput, 'action'> & { onUndo: () => void; onCommit?: () => void; undoLabel?: string }
/**
 * The toast function: `toast({ title })` shows one and returns its id. `update(id, patch)` changes it in place,
 * `dismiss(id?)` removes one (or all), `promise(p, { loading, success, error })` morphs one toast through a promise,
 * `undoable({ title, onUndo, onCommit })` adds an Undo button, `configure({ position, max })` sets the queue's defaults.
 */
export type ToastApi = ((t: ToastInput) => ToastId) & {
  update: (id: ToastId, patch: Partial<Omit<ToastInput, 'id'>>) => boolean
  dismiss: (id?: ToastId) => void
  promise: <T>(promise: Promise<T> | (() => Promise<T>), options: ToastPromiseOptions<T>) => ToastId
  undoable: (t: ToastUndoOptions) => ToastId
  configure: (o: { position?: ToastPosition; max?: number }) => void
}
type ToastItem = ToastInput & { id: ToastId; rev: number }
/**
 * A toast queue: the page-wide one (shared by every copy of the library) or a ToastProvider's own. `items` holds every
 * queued toast; at most `max` per position are on screen (the newest), the rest wait behind a "+n more" badge.
 */
type ToastQueue = { items: ToastItem[]; max: number; listeners: Set<() => void>; position?: ToastPosition }
const TOAST_KEEP = 50 // queued toasts beyond this drop the oldest, so a runaway loop can't pile them up without limit
const toastQueue = (max = 5): ToastQueue => ({ items: [], max, listeners: new Set() })
const toastEmit = (q: ToastQueue) => q.listeners.forEach(l => l())
/** ids for toasts without one, and revisions: unique per add or update, so a toast re-shown under the same id is new again */
const toastSeq = uiShared('toast-seq', () => ({ n: 0, rev: 0 }))
const toastRev = () => (toastSeq.rev = (toastSeq.rev ?? 0) + 1)
function toastAdd(q: ToastQueue, t: ToastInput): ToastId {
  const id = t.id ?? `toast-${++toastSeq.n}`, old = q.items.find(x => x.id === id)
  q.items = old ? q.items.map(x => (x === old ? { ...t, id, rev: toastRev() } : x)) : [...q.items, { ...t, id, rev: toastRev() }].slice(-TOAST_KEEP)
  toastEmit(q)
  return id
}
function toastUpdate(q: ToastQueue, id: ToastId, patch: Partial<Omit<ToastInput, 'id'>>) {
  if (!q.items.some(x => x.id === id)) return false
  q.items = q.items.map(x => (x.id === id ? { ...x, ...patch, id, rev: toastRev() } : x))
  toastEmit(q)
  return true
}
function toastDismiss(q: ToastQueue, id: ToastId | undefined, reason: ToastDismissReason) {
  const gone = q.items.filter(x => id === undefined || x.id === id)
  if (!gone.length) return
  q.items = q.items.filter(x => !gone.includes(x))
  toastEmit(q)
  gone.forEach(x => x.onDismiss?.(reason, x.id))
}
/** A promise state as toast fields: a plain node becomes the title. */
const toastPart = (c: ToastContent): Partial<ToastInput> =>
  c !== null && typeof c === 'object' && !isValidElement(c) && !Array.isArray(c) && !(Symbol.iterator in c) ? c as Partial<ToastInput> : { title: c as ReactNode }
function toastApi(q: ToastQueue, mount?: () => void): ToastApi {
  const show = (t: ToastInput) => { mount?.(); return toastAdd(q, t) }
  return Object.assign(show, {
    update: (id: ToastId, patch: Partial<Omit<ToastInput, 'id'>>) => toastUpdate(q, id, patch),
    dismiss: (id?: ToastId) => toastDismiss(q, id, 'api'),
    promise: <T,>(p: Promise<T> | (() => Promise<T>), { loading, success, error, ...rest }: ToastPromiseOptions<T>) => {
      // one toast for the whole life of the promise: the outcome replaces the loading state under the same id, so it
      // keeps its slot in the stack (and comes back if someone dismissed the spinner before the promise settled)
      const id = show({ title: '', ...rest, ...toastPart(loading), tone: 'loading' })
      const settle = (part: Partial<ToastInput>, tone: ToastTone) => show({ title: '', ...rest, ...part, tone: part.tone ?? tone, id })
      Promise.resolve().then(() => (typeof p === 'function' ? p() : p)).then(
        v => settle(toastPart(typeof success === 'function' ? success(v) : success), 'ok'),
        e => settle(toastPart(typeof error === 'function' ? (error as (e: unknown) => ToastContent)(e) : error), 'bad'))
      return id
    },
    undoable: ({ onUndo, onCommit, undoLabel, onDismiss, ...t }: ToastUndoOptions) => {
      let undone = false
      return show({ ...t, action: { label: undoLabel, onClick: () => { undone = true; onUndo() } }, onDismiss: (r, id) => { if (!undone) onCommit?.(); onDismiss?.(r, id) } })
    },
    configure: ({ position, max }: { position?: ToastPosition; max?: number }) => {
      if (position) q.position = position
      if (max !== undefined) q.max = Math.max(1, Math.floor(Number.isFinite(max) ? max : 5))
      toastEmit(q)
    },
  })
}
const toastNone: ToastItem[] = []
/** The page-wide queue behind `toast` and useToast() outside a ToastProvider (one per page, whichever files the components came from). */
const toastPage = uiShared('toasts', () => toastQueue())
/** Page-wide toasts without a hook: `const id = toast({ title: 'Saved' })`, then `toast.update(id, …)`, `toast.dismiss(id)`, `toast.promise(…)`. The region mounts itself in UIProvider's host on the first toast. */
export const toast: ToastApi = toastApi(toastPage, () => uiAddHost('toasts', ToastPageRegion))
const ToastCtx = createContext<ToastApi | null>(null)
/**
 * const toast = useToast(); const id = toast({ title: 'Saved', tone: 'ok', action: { label: 'Undo', onClick } })
 * The nearest ToastProvider's queue, or the page-wide `toast`. Same API: update, dismiss, promise, undoable.
 */
export const useToast = (): ToastApi => useContext(ToastCtx) ?? toast

/** The page-wide toast region (mounted through UIProvider's host outlet). */
function ToastPageRegion() { return <ToastRegion queue={toastPage} /> }

/**
 * Hosts its own toasts for the tree inside it. UIProvider no longer needs one: useToast() outside a ToastProvider
 * uses the page-wide region. At most `max` (default 5) per position are on screen; older ones wait behind a "+n more"
 * badge and come back as newer ones leave. `position` (default 'bottom-end') places the stack. The region stays usable
 * while a modal makes the page inert.
 */
export function ToastProvider({ children, max = 5, position }: { children: ReactNode; max?: number; position?: ToastPosition }) {
  const [queue] = useState(() => toastQueue())
  queue.max = Math.max(1, Math.floor(Number.isFinite(max) ? max : 5))
  queue.position = position
  const api = useMemo(() => toastApi(queue), [queue])
  return (
    <ToastCtx.Provider value={api}>
      {children}
      <ToastRegion queue={queue} />
    </ToastCtx.Provider>
  )
}

const TOAST_POSITIONS: ToastPosition[] = ['top-start', 'top-center', 'top-end', 'bottom-start', 'bottom-center', 'bottom-end']
// the insets include the safe areas; full width on phones
const TOAST_STACK: Record<ToastPosition, string> = {
  'top-start': 'top-[max(16px,env(safe-area-inset-top))] left-[max(16px,env(safe-area-inset-left))]',
  'top-center': 'top-[max(16px,env(safe-area-inset-top))] left-1/2 -translate-x-1/2',
  'top-end': 'top-[max(16px,env(safe-area-inset-top))] right-[max(16px,env(safe-area-inset-right))]',
  'bottom-start': 'bottom-[max(16px,env(safe-area-inset-bottom))] left-[max(16px,env(safe-area-inset-left))]',
  'bottom-center': 'bottom-[max(16px,env(safe-area-inset-bottom))] left-1/2 -translate-x-1/2',
  'bottom-end': 'bottom-[max(16px,env(safe-area-inset-bottom))] right-[max(16px,env(safe-area-inset-right))]',
}
const TOAST_PHONE = 'max-[640px]:left-[max(12px,env(safe-area-inset-left))] max-[640px]:right-[max(12px,env(safe-area-inset-right))] max-[640px]:w-auto max-[640px]:max-w-none max-[640px]:translate-x-0'
const TOAST_ALIGN = { start: 'start-0', center: 'start-0 end-0 mx-auto w-fit', end: 'end-0' } as const
const toastSubscribeHidden = (cb: () => void) => { document.addEventListener('visibilitychange', cb); return () => document.removeEventListener('visibilitychange', cb) }

/**
 * The fixed stacks the toasts of one queue sit in, one per position used. Every toast in the region pauses while one
 * is hovered or focused and while the tab is hidden. Screen readers hear each toast (and each update) once, through a
 * polite status region, or an assertive alert for the 'bad' tone; the toasts themselves carry no live role.
 */
function ToastRegion({ queue }: { queue: ToastQueue }) {
  const items = useSyncExternalStore(useCallback((cb: () => void) => { queue.listeners.add(cb); return () => { queue.listeners.delete(cb) } }, [queue]), () => queue.items, () => toastNone)
  const hidden = useSyncExternalStore(toastSubscribeHidden, () => document.visibilityState === 'hidden', () => false)
  const [hover, setHover] = useState(false), [focused, setFocused] = useState(false)
  const [heights, setHeights] = useState<Record<string, number>>({})
  const close = useCallback((id: ToastId, reason: ToastDismissReason) => {
    toastDismiss(queue, id, reason)
    setHeights(({ [String(id)]: _gone, ...rest }) => rest) // eslint-disable-line @typescript-eslint/no-unused-vars
    setHover(false)
  }, [queue])
  const report = useCallback((id: ToastId, h: number) => setHeights(m => m[String(id)] === h ? m : { ...m, [String(id)]: h }), [])
  // announcements: one node per message (a new key), so the same text twice is still read; each id+rev only once
  const [said, setSaid] = useState<{ polite: [number, string]; assertive: [number, string] }>({ polite: [0, ''], assertive: [0, ''] })
  const heard = useRef(new Set<string>())
  const announce = useCallback((id: ToastId, rev: number, tone: ToastTone | undefined, text: string) => {
    const k = `${String(id)}@${rev}`
    if (heard.current.has(k) || !text) return
    heard.current.add(k)
    if (heard.current.size > 200) heard.current = new Set([k])
    setSaid(s => (tone === 'bad' ? { ...s, assertive: [s.assertive[0] + 1, text] } : { ...s, polite: [s.polite[0] + 1, text] }))
  }, [])
  // a focused toast removed from the page sends no blur: drop the pause when focus has left the region that way
  const regionEl = useRef<HTMLDivElement>(null)
  useEffect(() => { if (focused && !regionEl.current?.contains(document.activeElement)) setFocused(false) }, [items, focused])
  const paused = hover || focused || hidden
  return (
    // a zero-size fixed anchor; the stacks inside are fixed to the viewport
    <div ref={regionEl} role="region" aria-label={'Notifications'} data-modal-keep className="pointer-events-none fixed top-0 left-0 z-[80] h-0 w-0"
      onFocus={() => setFocused(true)} onBlur={e => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setFocused(false) }}>
      <div role="status" aria-live="polite" className="sr-only">{said.polite[1] && <span key={said.polite[0]}>{said.polite[1]}</span>}</div>
      <div role="alert" aria-live="assertive" className="sr-only">{said.assertive[1] && <span key={said.assertive[0]}>{said.assertive[1]}</span>}</div>
      {TOAST_POSITIONS.map(pos => {
        const all = items.filter(x => (x.position ?? queue.position ?? 'bottom-end') === pos), shown = all.slice(-queue.max), more = all.length - shown.length
        const top = pos.startsWith('top'), align = pos.endsWith('start') ? 'start' : pos.endsWith('center') ? 'center' : 'end'
        // every toast sits at the stack's edge and is moved off it by the heights of the newer toasts (a transform), so
        // a toast leaving, arriving or growing (a promise settling) moves the others with an animated transform, never a re-flow
        const lift = new Map<ToastId, number>()
        let acc = 0
        for (let k = shown.length - 1; k >= 0; k--) { lift.set(shown[k].id, acc); acc += (heights[String(shown[k].id)] ?? 0) + 8 }
        return (
          <div key={pos} className={cn('fixed h-0 w-[340px] max-w-[calc(100vw-32px)]', TOAST_STACK[pos], TOAST_PHONE)}>
            <AnimatePresence initial={false}>
              {shown.map(x => <Toast key={x.id} t={x} lift={lift.get(x.id) ?? 0} top={top} align={align} paused={paused} onSize={report} onClose={close} announce={announce}
                onHover={setHover} />)}
              {more > 0 && (
                <motion.div key="more" className={cn('absolute', top ? 'top-0' : 'bottom-0', TOAST_ALIGN[align], align === 'center' && 'flex justify-center')}
                  initial={{ opacity: 0 }} animate={{ opacity: 1, y: top ? acc : -acc }} exit={{ opacity: 0 }} transition={spring(0.3, 0.45)}>
                  <Badge size="sm" className="shadow-[var(--shadow)]">+{`${more} more`}</Badge>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        )
      })}
    </div>
  )
}

const TOAST_ICON: Record<Exclude<ToastTone, 'loading'>, [IconName, string]> = { ok: ['check', TONE_SOFT.ok], info: ['info', TONE_SOFT.accent], warn: ['alert', TONE_SOFT.warn], bad: ['alert', TONE_SOFT.bad] }

/**
 * One toast. Dismiss with the ✕, by swiping it toward its edge (the end edge, or the start edge for start stacks; either
 * way for centred ones; touch or mouse), or let it time out. Full width on phones. The timer pauses while it is being
 * dragged and while the region is paused, and restarts when the toast is updated. A tone change (a promise settling)
 * morphs the icon in place. `lift` is its distance from the stack's edge.
 */
function Toast({ t, lift, top, align, paused, onSize, onClose: closeById, announce, onHover }: {
  t: ToastItem; lift: number; top: boolean; align: keyof typeof TOAST_ALIGN; paused: boolean; onSize: (id: ToastId, h: number) => void
  onClose: (id: ToastId, reason: ToastDismissReason) => void; announce: (id: ToastId, rev: number, tone: ToastTone | undefined, text: string) => void; onHover: (on: boolean) => void
}) {
  const [dragging, setDragging] = useState(false)
  // leaving while hovered (toast.dismiss, a timer elsewhere) sends no pointerleave: un-pause the region on the way out
  const hovered = useRef(false), present = useIsPresent()
  useEffect(() => { if (!present && hovered.current) { hovered.current = false; onHover(false) } }, [present, onHover])
  useEffect(() => () => { if (hovered.current) onHover(false) }, [onHover])
  const box = useRef<HTMLDivElement>(null), titleEl = useRef<HTMLElement>(null), descEl = useRef<HTMLSpanElement>(null)
  const onClose = useCallback((reason: ToastDismissReason) => closeById(t.id, reason), [closeById, t.id])
  const tone = t.tone ?? 'ok'
  const duration = tone === 'loading' ? Infinity : t.duration ?? (t.action ? 6000 : 4200)
  useLayoutEffect(() => { // report the height before paint, so the stack lifts the others in the same frame
    const el = box.current; if (!el) return
    onSize(t.id, el.offsetHeight)
    const ro = new ResizeObserver(() => onSize(t.id, el.offsetHeight))
    ro.observe(el); return () => ro.disconnect()
  }, [t.id, onSize])
  // the icon is decorative, so the tone is a word: on screen for screen readers, and in front of the announcement
  const toneWord = (tone === 'bad' ? 'Error' : tone === 'warn' ? 'Warning' : tone === 'info' ? 'Info' : tone === 'loading' ? 'Loading' : 'Success')
  useEffect(() => {
    const said = [titleEl.current?.textContent, descEl.current?.textContent].map(s => s?.trim()).filter(Boolean).join('. ')
    if (said) announce(t.id, t.rev, tone, `${toneWord}: ${said}`)
  }, [announce, t.id, t.rev, tone, toneWord])
  const left = useRef(duration), rev = useRef(t.rev)
  useEffect(() => {
    if (rev.current !== t.rev) { rev.current = t.rev; left.current = duration } // updated: a fresh timer
    if (paused || dragging || !Number.isFinite(left.current)) return
    const start = Date.now(), timer = setTimeout(() => onClose('timeout'), Math.max(0, left.current))
    return () => { clearTimeout(timer); left.current -= Date.now() - start }
  }, [paused, dragging, onClose, t.rev, duration])
  // swipe: toward the stack's own edge (end, or start for start stacks; centred stacks either way)
  const side = align === 'start' ? -1 : align === 'end' ? 1 : 0, v = top ? 1 : -1
  const out = (n: number) => n * (side || 1)
  const [icon, iconTone] = tone === 'loading' ? [null, TONE_SOFT.neutral] : TOAST_ICON[tone]
  return (
    <motion.div ref={box} initial={{ opacity: 0, y: v * lift - v * 20, scale: 0.95 }} animate={{ opacity: 1, y: v * lift, scale: 1 }}
      exit={{ opacity: 0, x: side ? 60 * side : 0, scale: side ? 1 : 0.95, transition: { duration: 0.2 } }} transition={spring(0.3, 0.45)}
      drag="x" dragConstraints={{ left: 0, right: 0 }} dragElastic={side === 0 ? 0.9 : (side > 0) ? { left: 0.1, right: 0.9 } : { left: 0.9, right: 0.1 }}
      onDragStart={() => setDragging(true)}
      onDragEnd={(_, i) => { if ((side ? out(i.offset.x) : Math.abs(i.offset.x)) > 80 || (side ? out(i.velocity.x) : Math.abs(i.velocity.x)) > 500) onClose('swipe'); else setDragging(false) }}
      onPointerEnter={() => { hovered.current = true; onHover(true) }} onPointerLeave={() => { hovered.current = false; onHover(false) }}
      className={cn(surface.floating, 'pointer-events-auto absolute flex max-w-full min-w-[260px] cursor-grab touch-pan-y items-center gap-3 p-3 pe-2 text-[13px] active:cursor-grabbing max-[640px]:start-0 max-[640px]:end-0 max-[640px]:w-auto max-[640px]:min-w-0',
        top ? 'top-0' : 'bottom-0', TOAST_ALIGN[align])}>
      <span aria-hidden className={cn('relative grid h-5 w-5 flex-none place-items-center overflow-hidden rounded-full transition-colors duration-300', iconTone)}>
        <AnimatePresence initial={false} mode="popLayout">
          <motion.span key={tone} className="grid place-items-center" initial={{ scale: 0.4, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.4, opacity: 0 }} transition={spring(0.45, 0.35)}>
            {icon ? <Icon name={icon} size={11} strokeWidth={3} /> : <Spinner size={12} className="!border-[1.5px]" />}
          </motion.span>
        </AnimatePresence>
      </span>
      <div className="min-w-0 flex-1 select-none"><span className="sr-only">{toneWord}: </span><b ref={titleEl} className="block font-medium">{t.title}</b>{t.description && <span ref={descEl} className="text-xs text-[var(--fg3)]">{t.description}</span>}</div>
      {t.action && <Button size="sm" onClick={e => { t.action!.onClick(e); if (!e.defaultPrevented) onClose('action') }}>{t.action.label ?? 'Undo'}</Button>}
      <IconButton icon="x" label={'Dismiss notification'} onClick={() => onClose('close')} />
    </motion.div>
  )
}

const ALERT_ICON: Record<Tone, IconName> = { neutral: 'info', accent: 'info', ok: 'check', warn: 'alert', bad: 'alert', danger: 'alert' }
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
  return (
    <div role="progressbar" aria-label={label ?? 'Progress'} aria-valuenow={Math.round(value)} aria-valuemin={0} aria-valuemax={max} className={cn('h-1.5 overflow-hidden rounded-full bg-[var(--muted)]', className)}>
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
  const r = (size - stroke) / 2, c = 2 * Math.PI * r
  const [scope, animate] = useAnimate()
  const prev = useRef(value)
  useEffect(() => {
    if (value >= 100 && prev.current < 100 && scope.current) animate(scope.current, { scale: [1, 1.08, 1] }, { duration: 0.45, ease: 'easeOut' })
    prev.current = value
  }, [value, animate, scope])
  return (
    <div ref={scope} className={cn('relative inline-grid place-items-center', className)} style={{ width: size, height: size }} role="progressbar" aria-label={ariaLabel ?? 'Progress'} aria-valuenow={Math.round(value)} aria-valuemin={0} aria-valuemax={100}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--muted)" strokeWidth={stroke} />
        <motion.circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={tone === 'ok' ? 'var(--ok)' : 'var(--primary)'} strokeWidth={stroke} strokeLinecap="round"
          strokeDasharray={c} initial={false} animate={{ strokeDashoffset: c * (1 - Math.min(100, value) / 100) }} transition={spring(0.1, 0.6)} />
      </svg>
      <span className={cn('absolute font-semibold', size < 52 ? 'text-[11px]' : 'text-xs')}>{label ?? <AnimatedNumber value={Math.min(100, value) / 100} format={{ style: 'percent' }} />}</span>
    </div>
  )
}

/**
 * Centred icon, title, hint and action. The icon bobs gently (off for reduced motion or `bob={false}`). `size="sm"` is
 * the one-line form for an empty list or panel: quiet centred text (role=status), with the icon only when one is given.
 */
export function EmptyState({ icon, title, description, action, bob = true, size = 'md', className }:
  { icon?: IconName; title: ReactNode; description?: ReactNode; action?: ReactNode; bob?: boolean; size?: 'sm' | 'md'; className?: string }) {
  if (size === 'sm') return (
    <div role="status" className={cn('p-4 text-center text-[13px] text-[var(--fg3)]', className)}>
      {icon && <Icon name={icon} size={18} className="mx-auto mb-2 block" />}{title}{description && <div className="text-xs">{description}</div>}{action}
    </div>
  )
  return <EmptyStateMd icon={icon ?? 'inbox'} title={title} description={description} action={action} bob={bob} className={className} />
}
function EmptyStateMd({ icon, title, description, action, bob, className }: { icon: IconName; title: ReactNode; description?: ReactNode; action?: ReactNode; bob: boolean; className?: string }) {
  // the loop runs only while the icon is on screen (an endless animation off screen still costs a frame each tick)
  const ref = useRef<HTMLSpanElement>(null), onScreen = useInView(ref)
  return (
    <div className={cn('flex flex-col items-center gap-3 py-4 text-center', className)}>
      <motion.span ref={ref} initial={{ scale: 0.8, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={spring(0.4, 0.5)}
        className="grid h-12 w-12 place-items-center rounded-[var(--r-lg)] bg-[var(--muted)] text-[var(--fg3)]">
        <motion.span className="grid" animate={bob && onScreen ? { y: [0, -5, 0], transition: { duration: 2.6, repeat: Infinity, ease: 'easeInOut' } } : { y: 0, transition: { duration: 0.2 } }}><Icon name={icon} size={22} /></motion.span>
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
  useResizeObserver(inner, el => setH(el.offsetHeight))
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
  const ref = useRef<HTMLSpanElement>(null)
  const onScreen = useInView(ref) // the bounce repeats forever: only run it while visible
  return (
    <span ref={ref} role="status" aria-label={label ?? 'Assistant is typing'} className={cn('inline-flex gap-1 py-1.5', className)}>
      {[0, 1, 2].map(i => (
        <motion.span key={i} className="h-1.5 w-1.5 rounded-full bg-[var(--fg3)]" animate={onScreen ? { y: [0, -4, 0], opacity: [0.4, 1, 0.4] } : { y: 0, opacity: 0.6 }}
          transition={onScreen ? { duration: 0.7, repeat: Infinity, delay: i * 0.12 } : { duration: 0.15 }} />
      ))}
    </span>
  )
}

/** Dismissible banner. Collapses its height smoothly when closed; controllable (`open`/`onOpenChange`) so it can be shown again. */
export function Banner({ children, badge, open, defaultOpen = true, onOpenChange, onDismiss, className }:
  { children: ReactNode; /** default "New"; `null` for none */ badge?: ReactNode; open?: boolean; defaultOpen?: boolean; onOpenChange?: (open: boolean) => void; onDismiss?: () => void; className?: string }) {
  const [shown, setShown] = useControllable(open, defaultOpen, onOpenChange)
  if (badge === undefined) badge = 'New'
  return (
    <Collapse open={shown} className={className}>
      <div role="status" className="flex items-center gap-2.5 rounded-[var(--r-md)] border border-[var(--line)] bg-[var(--card)] p-2 ps-3">
        {badge && <Badge tone="accent" className="flex-none">{badge}</Badge>}
        <span className="flex-1 text-[13px]">{children}</span>
        <IconButton icon="x" label={'Dismiss'} onClick={() => { setShown(false); onDismiss?.() }} />
      </div>
    </Collapse>
  )
}

/**
 * Runs an async action: the button's width tweens down to a spinner square, then out to a green
 * “Saved” with a drawn check, then back. Content never stretches: only the frame's width animates.
 */
export function AsyncButton({ onClick, children, successLabel: successProp, variant = 'primary', size, className, ...p }:
  Omit<ButtonProps, 'onClick'> & { onClick: () => Promise<unknown>; /** default "Saved" */ successLabel?: string }) {
  const successLabel = successProp ?? 'Saved'
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
  const [status, flash] = useStatusFlash(ms)
  const src = useRef(text)
  useLayoutEffect(() => { src.current = text })
  const copy = useCallback(async (override?: string) => {
    const ok = await writeClipboard(override ?? (typeof src.current === 'function' ? src.current() : src.current) ?? '')
    flash(ok)
    return ok
  }, [flash])
  return { copied: status === 'ok', failed: status === 'fail', copy }
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
  const label = labelProp ?? 'Copy', copiedLabel = copiedProp ?? 'Copied', failedLabel = failedProp ?? 'Couldn’t copy'
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
  { onConfirm: () => void; duration?: number; /** default "Hold to delete" */ children?: ReactNode; /** default "Deleted" */ doneLabel?: ReactNode; resetAfter?: number; status?: Partial<Record<HoldPhase, ReactNode>> | false; className?: string }) {
  const [phase, setPhase] = useState<HoldPhase>('idle')
  const phaseRef = useRef<HoldPhase>('idle')
  const p = useMotionValue(0)
  // the fill grows from the start edge: the clip trims the end side
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
  const label = phase === 'done' ? <><Icon name="check" size={13} strokeWidth={3} />{doneLabel ?? 'Deleted'}</> : children ?? 'Hold to delete'
  const said: Record<HoldPhase, ReactNode> = { idle: 'Release early to cancel', holding: 'Keep holding…', cancelled: 'Cancelled. Release early to cancel', done: 'Deleted' }
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
          <motion.span aria-hidden className="absolute inset-0 origin-left bg-[var(--bad)]" style={{ scaleX: p }} />
          <span className="relative flex items-center gap-1.5">{label}</span>
          <motion.span aria-hidden className="absolute inset-0 flex items-center justify-center gap-1.5 text-white" style={{ clipPath: clip }}>{label}</motion.span>
        </Button>
      </span>
      {msg && <span aria-live="polite" className={cn('text-xs', phase === 'done' ? 'font-medium text-[var(--bad)]' : 'text-[var(--fg3)]')}>{msg}</span>}
    </div>
  )
}

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
  /** default "Back online."; say what synced, e.g. "Back online. Synced 3 changes." */ backMessage?: ReactNode; className?: string
}) {
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
  // drawn by CSS so the text stays "Retrying in 4 s" for copy and tests
  const digits = String(Math.max(1, Math.floor(retryEvery))).length
  const num = (
    <span className="ui-num inline-grid justify-items-center font-semibold [&>*]:[grid-area:1/1]">
      {'0123456789'.split('').map(d => <span key={d} data-n={fmt.number(Number(d.repeat(digits)))} className="invisible before:content-[attr(data-n)]" />)}
      <span>{fmt.number(left)}</span>
    </span>
  )
  const live = !changed || mode === 'hidden' ? '' : offline ? 'You’re offline. Retrying automatically.' : (backMessage ?? 'Back online.')
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
                {'You’re offline. Edits are saved locally.'}{' '}
                {/* the countdown and the brief "Retrying…" share a cell; screen readers get the state from the live region */}
                <span aria-hidden className="inline-grid whitespace-nowrap align-bottom [&>*]:[grid-area:1/1]">
                  <span className={cn('transition-opacity duration-200', retrying ? 'opacity-0' : 'opacity-100')}>Retrying in {num} s</span>
                  <span className={cn('inline-flex items-center gap-1 transition-opacity duration-200', retrying ? 'opacity-100' : 'opacity-0')}>
                    {retrying && <Spinner size={10} label="" className="!border-[1.5px]" />}{'Retrying…'}
                  </span>
                </span>
              </span>
              {/* a 24px target (32px on touch) around the text, pulled back so the bar keeps its height */}
              <button type="button" onClick={runRetry}
                className="-my-1 min-h-6 flex-none cursor-pointer border-0 bg-transparent p-0 text-xs font-semibold text-current underline [@media(pointer:coarse)]:-my-2 [@media(pointer:coarse)]:min-h-8 [@media(pointer:coarse)]:px-1">{'Retry now'}</button>
            </div>
            <div aria-hidden inert={offline} className={cn(layer, offline ? 'opacity-0' : 'opacity-100')}>
              <Icon name="check" size={14} strokeWidth={2.6} className="flex-none" />
              <span className="min-w-0 flex-1">{backMessage ?? 'Back online.'}</span>
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
