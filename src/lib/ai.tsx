import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from 'react'
import { AnimatePresence, motion, useAnimate, useInView, useReducedMotion } from 'motion/react'
import { AnimatedNumber, Avatar, Badge, Button, Icon, IconButton, Kbd, Spinner, StatusIcon, TOUCH, cn, floatingSurface, inputClass, sleep, spring, surface, useControllable, useOutside, useRoving, type IconName } from './core'
import { AutoHeight, Collapse, Progress, TypingDots, useToast } from './feedback'
import { CheckMark, Checkbox, OptionList, type Option } from './forms'
import { FloatingPanel, MenuLabel, Tooltip, useHoverIntent } from './overlay'
import { lcsDiff } from './code'
import { Waveform } from './media'

/* ════════════════════════════════════════════════════════════════════════════
 * 11. AI PATTERNS: streaming, showing work, asking permission, honest uncertainty
 * ══════════════════════════════════════════════════════════════════════════ */

/** Text with a light sweeping across it. Use for in-progress labels ("Thinking…", "Reading 34 messages…"). */
export function ShimmerText({ children, active = true, className }: { children: ReactNode; active?: boolean; className?: string }) {
  const ref = useRef<HTMLSpanElement>(null)
  const onScreen = useInView(ref) // the sweep is a per-frame animation: only run it while visible
  if (!active) return <span className={className}>{children}</span>
  const cls = cn('bg-[linear-gradient(90deg,var(--fg3)_0%,var(--fg)_40%,var(--fg3)_80%)] bg-[length:200%_100%] bg-clip-text text-transparent', className)
  if (!onScreen) return <span ref={ref} className={cls} style={{ backgroundPosition: '100% 0' }}>{children}</span>
  return (
    <motion.span ref={ref} className={cls} initial={{ backgroundPosition: '100% 0' }} animate={{ backgroundPosition: '-100% 0' }} transition={{ duration: 1.6, ease: 'linear', repeat: Infinity }}>
      {children}
    </motion.span>
  )
}

/**
 * Reveals `text` word by word. Change `key` to restart; `playing={false}` freezes it (Stop).
 * Calls `onDone(text shown)` when it finishes or is stopped.
 */
export function StreamingText({ text, playing = true, wordDelay = 45, onDone, onProgress, className, caret = true }:
  { text: string; playing?: boolean; wordDelay?: number; onDone?: (shown: string) => void; onProgress?: () => void; className?: string; caret?: boolean }) {
  const words = text.split(' ')
  const reduce = useReducedMotion()
  const [n, setN] = useState(reduce ? words.length : 0)
  const doneRef = useRef(false), cb = useRef({ onDone, onProgress }); cb.current = { onDone, onProgress }
  useEffect(() => {
    if (doneRef.current) return
    if (n >= words.length || !playing) { doneRef.current = true; cb.current.onDone?.(words.slice(0, n).join(' ')); return }
    const t = setTimeout(() => { setN(v => v + 1); cb.current.onProgress?.() }, wordDelay * (0.6 + Math.random() * 0.9))
    return () => clearTimeout(t)
  }, [n, playing, words.length, wordDelay]) // eslint-disable-line react-hooks/exhaustive-deps
  const live = playing && n < words.length
  return <span className={cn('whitespace-pre-wrap', live && caret && 'ui-caret', className)}>{words.slice(0, n).join(' ')}</span>
}

/** Collapsible tool-call row: shimmering label and spinner while running, a check and the past tense when done. Click to see the call. */
export function ToolCall({ status, label, doneLabel, detail, className }:
  { status: 'running' | 'done' | 'failed'; label: string; doneLabel?: string; detail?: ReactNode; className?: string }) {
  const [open, setOpen] = useState(false)
  return (
    <motion.div initial={{ opacity: 0, scale: 0.97 }} animate={{ opacity: 1, scale: 1 }} transition={spring(0.3, 0.4)}
      className={cn('my-1.5 overflow-hidden rounded-[10px] border border-[var(--line)] text-xs', className)}>
      <button aria-expanded={open} onClick={() => setOpen(!open)}
        className="flex w-full cursor-pointer items-center gap-2 border-0 bg-[var(--muted)] px-2.5 py-2 text-left text-[var(--fg2)]">
        <AnimatePresence mode="popLayout" initial={false}>
          <motion.span key={status} initial={{ scale: 0.5, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={spring(0.5, 0.35)} className="grid">
            {status === 'running' ? <Spinner size={12} /> : <Icon name={status === 'done' ? 'check' : 'x'} size={12} strokeWidth={3} className={status === 'done' ? 'text-[var(--ok)]' : 'text-[var(--bad)]'} />}
          </motion.span>
        </AnimatePresence>
        <ShimmerText active={status === 'running'}>{status === 'running' ? `${label}…` : doneLabel ?? label}</ShimmerText>
        <motion.span className="ml-auto grid text-[var(--fg3)]" animate={{ rotate: open ? 90 : 0 }} transition={spring(0.2, 0.3)}><Icon name="chevronRight" size={11} strokeWidth={2.5} /></motion.span>
      </button>
      <Collapse open={open}><div className="px-2.5 py-2 font-[family-name:var(--mono)] text-[11px] leading-relaxed text-[var(--fg2)]">{detail}</div></Collapse>
    </motion.div>
  )
}

/* Composer pieces ───────────────────────────────────────────────────────── */

/** Grows a textarea with its content up to `max` px, then it scrolls: useAutoGrow(ref, text). */
export function useAutoGrow(ref: RefObject<HTMLTextAreaElement | null>, value: string, max = 160) {
  useLayoutEffect(() => { const t = ref.current; if (t) { t.style.height = 'auto'; t.style.height = Math.min(max, t.scrollHeight) + 'px' } }, [ref, value, max])
}

/** What SendButton shows: the up arrow, Stop (filled square), Queue (list +) or a spinner. */
export type SendButtonState = 'send' | 'stop' | 'queue' | 'sending'
const SEND_LABEL: Record<SendButtonState, string> = { send: 'Send', stop: 'Stop', queue: 'Queue message', sending: 'Sending' }
/**
 * Round primary send button for composers. `state` swaps the glyph with a spin-in (send ↑, stop ■, queue, sending
 * spinner); the label follows unless you pass one. 32px with an invisible 44px hit area on touch screens.
 */
export function SendButton({ state = 'send', label, disabled, onClick, className }:
  { state?: SendButtonState; label?: string; disabled?: boolean; onClick?: () => void; className?: string }) {
  const name = label ?? SEND_LABEL[state]
  return (
    <motion.button type="button" aria-label={name} title={name} onClick={onClick} disabled={disabled} whileTap={disabled ? undefined : { scale: 0.9 }}
      className={cn('relative grid h-8 w-8 flex-none cursor-pointer place-items-center rounded-full border-0 bg-[var(--primary)] text-[var(--on-primary)] transition-opacity disabled:cursor-default disabled:opacity-30 [--hit:44px]', TOUCH.hit, className)}>
      <AnimatePresence mode="popLayout" initial={false}>
        <motion.span key={state} initial={{ scale: 0, rotate: -90 }} animate={{ scale: 1, rotate: 0 }} exit={{ scale: 0 }} transition={spring(0.4, 0.3)} className="grid">
          {state === 'sending' ? <Spinner size={14} label="Sending" />
            : state === 'stop' ? <span className="block h-3 w-3 rounded-[2px] bg-current" />
            : <Icon name={state === 'queue' ? 'listPlus' : 'arrowUp'} size={15} strokeWidth={2.5} />}
        </motion.span>
      </AnimatePresence>
    </motion.button>
  )
}

/**
 * Message box: grows with text, Enter sends (never mid IME composition), Shift+Enter adds a line. + attaches files as
 * removable chips. Send turns into Stop while `busy`. `footer` replaces the + button.
 */
export function ChatComposer({ onSend, onStop, busy, placeholder = 'Ask anything…', footer, className }:
  { onSend: (text: string, files: File[]) => void; onStop?: () => void; busy?: boolean; placeholder?: string; footer?: ReactNode; className?: string }) {
  const [text, setText] = useState('')
  const [files, setFiles] = useState<{ id: number; file: File }[]>([])
  const ref = useRef<HTMLTextAreaElement>(null), fileRef = useRef<HTMLInputElement>(null), fid = useRef(0)
  useAutoGrow(ref, text)
  const send = () => { const t = text.trim(); if ((!t && !files.length) || busy) return; onSend(t, files.map(f => f.file)); setText(''); setFiles([]) }
  return (
    <div className={cn(surface.card, 'p-2 shadow-[0_1px_2px_rgba(0,0,0,.04)] focus-within:border-[var(--fg3)]', className)}>
      {files.length > 0 && <div className="mb-1.5 flex flex-wrap gap-1.5 px-1">{files.map(f => (
        <motion.span key={f.id} initial={{ opacity: 0, scale: 0.85 }} animate={{ opacity: 1, scale: 1 }} transition={spring(0.4, 0.3)}
          className="inline-flex h-6 max-w-full items-center gap-1 rounded-full bg-[var(--muted)] pr-1 pl-2 text-xs"><Icon name="file" size={12} /><span className="min-w-0 truncate">{f.file.name}</span>
          <button type="button" aria-label={`Remove ${f.file.name}`} onClick={() => { setFiles(x => x.filter(y => y.id !== f.id)); ref.current?.focus() }}
            className={cn('grid h-4 w-4 flex-none cursor-pointer place-items-center rounded-full border-0 bg-transparent text-[var(--fg3)] hover:text-[var(--fg)]', TOUCH.hit)}><Icon name="x" size={10} strokeWidth={3} /></button>
        </motion.span>))}</div>}
      <textarea ref={ref} rows={1} value={text} placeholder={placeholder} aria-label="Message" onChange={e => setText(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); send() } }}
        className={cn('block w-full resize-none border-0 bg-transparent px-1.5 py-1 text-[13px] leading-relaxed outline-none placeholder:text-[var(--fg3)]', TOUCH.input)} />
      <div className="mt-1 flex items-center gap-1">
        <input ref={fileRef} type="file" multiple hidden onChange={e => { const add = Array.from(e.target.files ?? []).map(file => ({ id: ++fid.current, file })); setFiles(f => [...f, ...add]); e.target.value = '' }} />
        {footer ?? <IconButton icon="plus" label="Add files" onClick={() => fileRef.current?.click()} />}
        <span className="flex-1" />
        <SendButton state={busy ? 'stop' : 'send'} onClick={busy ? onStop : send} disabled={!busy && !text.trim() && !files.length} />
      </div>
    </div>
  )
}

/* Thinking steps ─────────────────────────────────────────────────────────── */

export type StepStatus = 'done' | 'active' | 'pending' | 'failed'

export type ThoughtStep = { label: string; detail?: string; sources?: string[]; /** seconds this step takes when auto-playing */ duration?: number; status?: StepStatus }

/**
 * Reasoning as a vertical stepper. Static (pass `status` per step) or `autoPlay`: starts when scrolled into view,
 * types each step's detail, pops in source chips, records per-step durations and fills the connector. The header counts
 * "Thinking… 3.2s", then reads "Thought for Xs · N steps" and collapses. Change `replayKey` to run it again.
 */
export function ThinkingSteps({ steps, summary, defaultOpen = true, autoPlay = false, replayKey = 0, autoCollapse = true, className }:
  { steps: ThoughtStep[]; summary?: ReactNode; defaultOpen?: boolean; autoPlay?: boolean; replayKey?: number; autoCollapse?: boolean; className?: string }) {
  const [open, setOpen] = useState(defaultOpen)
  const ref = useRef<HTMLDivElement>(null)
  const inView = useInView(ref, { amount: 0.4, once: true })
  const onScreen = useInView(ref), vis = useRef(true); vis.current = onScreen // the run pauses while scrolled away
  const reduce = useReducedMotion()
  const [play, setPlay] = useState({ cur: autoPlay ? -1 : steps.length, words: 0, srcs: 0, times: [] as number[], elapsed: 0, running: false })
  useEffect(() => {
    if (!autoPlay || !inView) return
    let off = false, pausedFor = 0
    const now = () => performance.now() - pausedFor // clock that stands still while off screen
    const gate = async () => { if (vis.current) return; const at = performance.now(); while (!vis.current && !off) await sleep(200); pausedFor += performance.now() - at }
    const t0 = now()
    const tick = setInterval(() => { if (vis.current) setPlay(p => ({ ...p, elapsed: (now() - t0) / 1000 })) }, 100)
    ;(async () => {
      setOpen(true)
      setPlay({ cur: 0, words: 0, srcs: 0, times: [], elapsed: 0, running: true })
      const times: number[] = []
      for (let i = 0; i < steps.length; i++) {
        await gate(); if (off) return
        const s0 = now(), s = steps[i], words = (s.detail ?? '').split(' ').filter(Boolean)
        setPlay(p => ({ ...p, cur: i, words: 0, srcs: 0 }))
        for (let w = 1; w <= words.length; w++) { await sleep(reduce ? 0 : 35); await gate(); if (off) return; setPlay(p => ({ ...p, words: w })) }
        for (let k = 1; k <= (s.sources?.length ?? 0); k++) { await sleep(reduce ? 0 : 220); await gate(); if (off) return; setPlay(p => ({ ...p, srcs: k })) }
        const rest = (s.duration ?? 1.2) * 1000 - (now() - s0)
        if (rest > 0 && !reduce) { await sleep(rest); await gate() }
        if (off) return
        times.push((now() - s0) / 1000)
        setPlay(p => ({ ...p, times: [...times] }))
      }
      clearInterval(tick)
      setPlay(p => ({ ...p, cur: steps.length, running: false, elapsed: (now() - t0) / 1000 }))
      await sleep(reduce ? 0 : 1400)
      if (!off && autoCollapse) setOpen(false)
    })()
    return () => { off = true; clearInterval(tick) }
  }, [autoPlay, inView, replayKey]) // eslint-disable-line react-hooks/exhaustive-deps

  const statusOf = (s: ThoughtStep, i: number): StepStatus => !autoPlay ? s.status ?? 'pending' : i < play.cur || play.times[i] !== undefined ? 'done' : i === play.cur ? 'active' : 'pending'
  const header = !autoPlay ? summary
    : play.running ? <ShimmerText>Thinking… <span className="tabular-nums">{play.elapsed.toFixed(1)}s</span></ShimmerText>
    : play.cur >= steps.length ? <>{summary ?? `Thought for ${Math.round(play.elapsed)}s · ${steps.length} steps`}</> : 'Thinking…'
  return (
    <div ref={ref} className={cn(surface.card, 'overflow-hidden text-[13px]', className)}>
      <button onClick={() => setOpen(!open)} aria-expanded={open} className="flex w-full cursor-pointer items-center gap-2 border-0 bg-transparent p-3 text-left font-medium text-[var(--fg2)] hover:text-[var(--fg)]">
        <Icon name={autoPlay ? 'bulb' : 'sparkles'} size={14} />{header}
        <motion.span className="ml-auto grid text-[var(--fg3)]" animate={{ rotate: open ? 0 : -90 }} transition={spring(0.2, 0.3)}><Icon name="chevronDown" size={12} strokeWidth={2.5} /></motion.span>
      </button>
      <Collapse open={open}>
        <ol className="m-0 list-none px-3 pt-0.5 pb-3">
          {steps.map((s, i) => {
            const st = statusOf(s, i), live = autoPlay && i === play.cur
            const words = autoPlay ? (live ? play.words : st === 'done' ? Infinity : 0) : Infinity
            const srcs = autoPlay ? (live ? play.srcs : st === 'done' ? Infinity : 0) : Infinity
            const detail = (s.detail ?? '').split(' ').slice(0, words).join(' ')
            return (
              <li key={i} className="grid grid-cols-[22px_1fr] gap-2.5">
                <div className="flex flex-col items-center pt-px">
                  <StatusIcon status={st} />
                  {i < steps.length - 1 && <span className="relative my-1 min-h-3.5 w-0.5 flex-1 overflow-hidden rounded-sm bg-[var(--line)]">
                    <motion.b className="absolute inset-x-0 top-0 block bg-[var(--fg3)]" initial={false} animate={{ height: st === 'done' ? '100%' : '0%' }} transition={{ duration: 0.3 }} />
                  </span>}
                </div>
                <div className="min-w-0 pb-3">
                  <div className={cn('leading-5 font-medium', st === 'pending' ? 'text-[var(--fg3)]' : 'text-[var(--fg)]')}>
                    {s.label}{autoPlay && play.times[i] !== undefined && <span className="ml-1.5 font-[family-name:var(--mono)] text-[11px] font-normal text-[var(--fg3)]">{play.times[i].toFixed(1)}s</span>}
                  </div>
                  {detail && <motion.div initial={autoPlay ? { opacity: 0, y: -4 } : false} animate={{ opacity: 1, y: 0 }} className="mt-1 text-xs leading-normal text-[var(--fg2)]">{detail}</motion.div>}
                  {s.sources && srcs > 0 && <div className="mt-1.5 flex flex-wrap gap-1">{s.sources.slice(0, srcs).map(x => (
                    <motion.span key={x} initial={autoPlay ? { opacity: 0, scale: 0.85 } : false} animate={{ opacity: 1, scale: 1 }} transition={spring(0.4, 0.3)}
                      className="inline-flex items-center gap-1 rounded-full border border-[var(--line)] px-2 py-0.5 text-[11px] text-[var(--fg2)]"><Icon name="globe" size={10} strokeWidth={2.5} />{x}</motion.span>))}</div>}
                </div>
              </li>
            )
          })}
        </ol>
      </Collapse>
    </div>
  )
}

/* Agent plan ─────────────────────────────────────────────────────────────── */

/**
 * Plan first, then live progress. Pass `steps` with statuses to drive it yourself, or plain labels and it runs
 * itself: Run shows "Step i of n", stays disabled while running, then offers "Run again".
 */
export function AgentPlan({ steps, onDone, className }: { steps: (string | { label: string; status: StepStatus })[]; onDone?: () => void; className?: string }) {
  const controlled = typeof steps[0] === 'object'
  const [cur, setCur] = useState(-1), [ran, setRan] = useState(false)
  const running = cur >= 0 && cur < steps.length
  const run = async () => {
    for (let i = 0; i < steps.length; i++) { setCur(i); await sleep(800 + Math.random() * 500) }
    setCur(steps.length); setRan(true); onDone?.()
  }
  const items = steps.map((s, i) => typeof s === 'object' ? s : { label: s, status: (i < cur ? 'done' : i === cur ? 'active' : 'pending') as StepStatus })
  const done = items.filter(s => s.status === 'done').length
  return (
    <div className={cn('flex flex-col gap-2.5', className)}>
      <div className="flex items-center justify-between text-xs text-[var(--fg3)]"><span>Plan</span><span className="ui-num">{done}/{steps.length}</span></div>
      <Progress value={done} max={steps.length} tone="ok" />
      <ol className="m-0 flex list-none flex-col gap-2 p-0">
        {items.map((s, i) => (
          <motion.li key={i} layout className={cn('flex items-center gap-2.5 text-[13px] transition-colors', s.status === 'pending' ? 'text-[var(--fg3)]' : s.status === 'done' ? 'text-[var(--fg2)]' : 'text-[var(--fg)]')}>
            <StatusIcon status={s.status} />{s.label}
          </motion.li>
        ))}
      </ol>
      {!controlled && <div className="flex items-center gap-2.5">
        <Button size="sm" variant="primary" disabled={running} onClick={run}>{ran ? 'Run again' : 'Run'}</Button>
        <span className="text-xs tabular-nums text-[var(--fg3)]" aria-live="polite">{running ? `Step ${cur + 1} of ${steps.length}` : cur >= steps.length ? 'Done' : ''}</span>
      </div>}
    </div>
  )
}

/* Permission request ─────────────────────────────────────────────────────── */

type PermState = 'ask' | 'edit' | 'sending' | 'sent' | 'undone' | 'denied'
function PermResult({ icon, tone, title, sub }: { icon: ReactNode; tone: 'ok' | 'muted'; title: ReactNode; sub: ReactNode }) {
  return (
    <div className="flex items-start gap-3 p-3">
      <motion.span initial={{ scale: 0.6 }} animate={{ scale: 1 }} transition={spring(0.5, 0.45)}
        className={cn('grid h-9 w-9 flex-none place-items-center rounded-[10px]', tone === 'ok' ? 'bg-[var(--ok-soft)] text-[var(--ok)]' : 'bg-[var(--muted)] text-[var(--fg2)]')}>{icon}</motion.span>
      <div className="min-w-0 flex-1"><div className="text-sm leading-tight font-semibold">{title}</div><div className="mt-0.5 text-xs text-[var(--fg3)]">{sub}</div></div>
    </div>
  )
}
const permActs = 'flex items-center gap-1.5 border-t border-[var(--line)] bg-[color-mix(in_srgb,var(--muted)_45%,var(--card))] p-3'
// on phones the decision buttons stack full width, primary on top (44px on touch)
const permStack = 'max-sm:flex-col-reverse max-sm:items-stretch max-sm:[&>span]:hidden [@media(pointer:coarse)]:[&>button]:min-h-11'

/**
 * Ask before acting: say what, to whom, and why. Preview the payload (recipients and the message), edit the draft,
 * watch it send ("n of 12 delivered"), then undo within a 10 s countdown ring. Every state swap animates height.
 */
export function PermissionRequest({ title = 'Send an email to 12 people', app = 'inbox', reason, recipients = ['Alex Lee', 'Ben Kim', 'Cara Mills'], total = 12, list = 'Launch list',
  draft: initialDraft = { subject: 'Launch moved to Thursday', body: 'Hi all, quick heads up: we’re moving the launch from Tuesday to Thursday so legal can finish the terms review. Nothing else changes. Thanks for your patience.' },
  undoSeconds = 10, onDecide, className }:
  { title?: string; app?: IconName; reason: ReactNode; recipients?: string[]; total?: number; list?: string; draft?: { subject: string; body: string }; undoSeconds?: number; onDecide?: (allowed: boolean, always: boolean) => void; className?: string }) {
  const [state, setState] = useState<PermState>('ask')
  const [draft, setDraft] = useState(initialDraft)
  const [always, setAlways] = useState(false)
  const [preview, setPreview] = useState(false)
  const [sent, setSent] = useState(0)
  const [left, setLeft] = useState(undoSeconds)
  const gen = useRef(0)
  const send = async () => {
    const g = ++gen.current; setState('sending'); setSent(0); onDecide?.(true, always)
    for (let i = 1; i <= total; i++) { await sleep(110 + Math.random() * 90); if (g !== gen.current) return; setSent(i) }
    await sleep(250); if (g !== gen.current) return
    setLeft(undoSeconds); setState('sent')
  }
  useEffect(() => {
    if (state !== 'sent' || left <= 0) return
    const t = setTimeout(() => setLeft(l => l - 1), 1000); return () => clearTimeout(t)
  }, [state, left])
  const reset = () => { gen.current++; setState('ask'); setPreview(false) }
  const C = 2 * Math.PI * 8
  let body: ReactNode
  if (state === 'ask') body = (
    <div>
      <div className="p-3">
        <div className="flex items-start gap-3">
          <span className="grid h-9 w-9 flex-none place-items-center rounded-[10px] bg-[var(--muted)]"><Icon name={app} size={18} /></span>
          <div className="min-w-0 flex-1"><div className="text-sm leading-tight font-semibold">{title}</div><div className="mt-0.5 text-xs text-[var(--fg3)]">Assistant is asking · just now</div></div>
          <Badge tone="warn">Needs approval</Badge>
        </div>
        <div className="mt-3 flex items-start gap-2 rounded-[9px] bg-[var(--muted)] px-2.5 py-2 text-xs leading-snug text-[var(--fg2)]"><Icon name="info" size={14} className="mt-px text-[var(--fg3)]" /><span>{reason}</span></div>
        <button aria-expanded={preview} onClick={() => setPreview(!preview)}
          className={cn(surface.md, 'mt-3 flex w-full cursor-pointer items-center gap-2.5 p-2 text-left text-[13px] hover:border-[var(--line2)]')}>
          <span className="flex flex-none">{recipients.slice(0, 3).map((n, i) => <Avatar key={n} name={n} size={24} className={cn('[@media(pointer:coarse)]:!h-7 [@media(pointer:coarse)]:!w-7 [@media(pointer:coarse)]:!text-[11px]', i ? '-ml-2' : '')} />)}
            {total > 3 && <span className="-ml-2 grid h-6 w-6 place-items-center rounded-full border-2 border-[var(--card)] bg-[var(--muted)] text-[9px] font-semibold text-[var(--fg2)] [@media(pointer:coarse)]:h-7 [@media(pointer:coarse)]:w-7 [@media(pointer:coarse)]:text-[11px]">+{total - 3}</span>}</span>
          <span className="min-w-0 flex-1 truncate max-sm:whitespace-normal"><b className="font-medium">{list}</b> <span className="text-xs text-[var(--fg3)]">· “{draft.subject}”</span></span>
          <motion.span className="grid text-[var(--fg3)]" animate={{ rotate: preview ? 180 : 0 }}><Icon name="chevronDown" size={12} strokeWidth={2.5} /></motion.span>
        </button>
        <Collapse open={preview}>
          <div className="mt-2 rounded-[var(--r-md)] border border-[var(--line)] bg-[var(--bg)] p-3 text-[13px]">
            <span className="text-[11px] text-[var(--fg3)]">Subject</span><b className="block font-medium">{draft.subject}</b>
            <p className="m-0 mt-2 leading-relaxed whitespace-pre-wrap text-[var(--fg2)]">{draft.body}</p>
          </div>
        </Collapse>
        <div className="mt-3"><Checkbox checked={always} onChange={setAlways}><span className="text-xs text-[var(--fg2)]">Always allow emails to this list</span></Checkbox></div>
      </div>
      <div className={cn(permActs, permStack)}>
        <Button size="sm" variant="ghost" onClick={() => { setState('denied'); onDecide?.(false, false) }}>Deny</Button><span className="flex-1" />
        <Button size="sm" onClick={() => setState('edit')}>Edit draft</Button><Button size="sm" variant="primary" onClick={send}>Allow and send</Button>
      </div>
    </div>
  )
  else if (state === 'edit') body = (
    <form onSubmit={e => { e.preventDefault(); send() }}>
      <div className="p-3">
        <div className="flex items-start gap-3">
          <span className="grid h-9 w-9 flex-none place-items-center rounded-[10px] bg-[var(--muted)]"><Icon name={app} size={18} /></span>
          <div><div className="text-sm leading-tight font-semibold">Edit before sending</div><div className="mt-0.5 text-xs text-[var(--fg3)]">To {list} · {total} people</div></div>
        </div>
        <label className="mt-3 mb-1 block text-xs font-medium">Subject
          <input autoFocus value={draft.subject} onChange={e => setDraft({ ...draft, subject: e.target.value })} className={cn(inputClass, 'mt-1 !h-8 text-xs font-normal [@media(pointer:coarse)]:!h-10', TOUCH.input)} /></label>
        <label className="mt-2.5 block text-xs font-medium">Message
          <textarea rows={4} value={draft.body} onChange={e => setDraft({ ...draft, body: e.target.value })} className={cn(inputClass, '!h-auto mt-1 resize-none py-2 text-xs leading-normal font-normal', TOUCH.input)} /></label>
      </div>
      <div className={cn(permActs, permStack)}>
        <Button size="sm" variant="ghost" onClick={() => setState('ask')}>Back</Button><span className="flex-1" />
        <Button size="sm" variant="primary" type="submit" disabled={!draft.subject.trim()}>Send now</Button>
      </div>
    </form>
  )
  else if (state === 'sending') body = (
    <div className="flex items-start gap-3 p-3">
      <span className="grid h-9 w-9 flex-none place-items-center rounded-[10px] bg-[var(--muted)]"><Spinner /></span>
      <div className="flex-1"><div className="text-sm font-semibold">Sending…</div>
        <div className="mt-0.5 flex items-center gap-1 text-xs text-[var(--fg3)]"><AnimatedNumber value={sent} /> of {total} delivered</div>
        <Progress value={sent} max={total} className="mt-2.5" /></div>
    </div>
  )
  else if (state === 'sent') body = (
    <div>
      <PermResult tone="ok" title={`Sent to ${total} people`} sub={<>“{draft.subject}”{always && ' · Future emails to this list won’t ask'}</>}
        icon={<CheckMark size={18} strokeWidth={3} draw delay={0.1} duration={0.4} />} />
      <div className={permActs}>
        <svg width="16" height="16" viewBox="0 0 20 20" className="flex-none" aria-hidden>
          <circle cx="10" cy="10" r="8" fill="none" stroke="var(--line)" strokeWidth="2.5" />
          <motion.circle cx="10" cy="10" r="8" fill="none" stroke="var(--fg2)" strokeWidth="2.5" strokeLinecap="round" strokeDasharray={C} transform="rotate(-90 10 10)"
            initial={{ strokeDashoffset: 0 }} animate={{ strokeDashoffset: C * (1 - left / undoSeconds) }} transition={{ duration: 1, ease: 'linear' }} />
        </svg>
        <span className="text-xs tabular-nums text-[var(--fg3)]" aria-live="polite">{left > 0 ? `Undo available for ${left} s` : 'Delivered'}</span><span className="flex-1" />
        {left > 0 ? <Button size="sm" onClick={() => { gen.current++; setState('undone') }}>Undo send</Button> : <Button size="sm" onClick={reset}>Start over</Button>}
      </div>
    </div>
  )
  else body = (
    <div>
      {state === 'undone'
        ? <PermResult tone="muted" icon={<Icon name="undo" size={18} strokeWidth={2.5} />} title="Send undone" sub={`Nothing reached the ${total} recipients. The draft is saved.`} />
        : <PermResult tone="muted" icon={<Icon name="x" size={18} strokeWidth={2.5} />} title="Not sent" sub="The assistant was told you declined and won’t send this email." />}
      <div className={permActs}><span className="flex-1" /><Button size="sm" onClick={reset}>{state === 'undone' ? 'Back to request' : 'Undo'}</Button></div>
    </div>
  )
  return (
    <div className={cn(surface.card, 'overflow-hidden text-[13px] shadow-[0_1px_2px_rgba(0,0,0,.04)]', className)}>
      <AutoHeight>
        <AnimatePresence mode="wait" initial={false}>
          <motion.div key={state} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, transition: { duration: 0.12 } }} transition={{ duration: 0.25 }}>{body}</motion.div>
        </AnimatePresence>
      </AutoHeight>
    </div>
  )
}

/* Citations, ghost text, suggested edit, confidence, voice ─────────────────── */

export type Source = { title: string; url: string; snippet?: string }
/** Host name of a source link; relative or malformed URLs show as written instead of throwing. */
const aiHost = (url: string) => { try { return new URL(url).hostname || url } catch { return url } }
/**
 * Inline [n] citation. Hover or focus previews the source; a tap or click pins it open (tap again, Esc or tap
 * outside to close). The card clamps to the screen edges and flips below when there's no room above.
 * (Built from spans, so it is valid inside a <p>; HoverCard's panel is a <div>.)
 */
export function Citation({ n, source, className }: { n: number; source: Source; className?: string }) {
  const ref = useRef<HTMLSpanElement>(null), panel = useRef<HTMLSpanElement>(null), pointer = useRef('mouse')
  const { open, setOpen, bind, tap } = useHoverIntent(ref, 300, 150)
  const [pinned, setPinned] = useState(false)
  const shown = open || pinned
  const [pos, setPos] = useState<{ dx: number; w: number; up: boolean }>({ dx: 0, w: 250, up: true })
  const id = useId()
  const close = () => { setPinned(false); setOpen(false) }
  useOutside([ref], close, pinned, { escape: true })
  useLayoutEffect(() => {
    if (!shown || !ref.current) return
    // clientWidth, not innerWidth: on phones innerWidth grows with anything that overflows (including this card)
    const vw = document.documentElement.clientWidth || innerWidth
    const r = ref.current.getBoundingClientRect(), w = Math.min(250, vw - 16), h = panel.current?.offsetHeight ?? 110
    setPos({ w, up: r.top > h + 16, dx: Math.max(8 - r.left, Math.min(0, vw - 8 - (r.left + w))) })
  }, [shown])
  return (
    <span ref={ref} className={cn('relative inline-block', className)} {...bind} onKeyDown={e => { if (e.key === 'Escape' && shown) { e.stopPropagation(); close() } }}>
      <button type="button" aria-expanded={shown} aria-describedby={shown ? id : undefined} aria-label={`Source ${n}: ${source.title}`}
        {...tap} onPointerDown={e => { pointer.current = e.pointerType }}
        onClick={() => { if (pointer.current === 'touch') return; const v = !pinned; setPinned(v); setOpen(v) }}
        className={cn('mx-0.5 inline-grid h-4 min-w-4 cursor-pointer place-items-center rounded border-0 bg-[var(--muted)] px-1 align-[2px] text-[10px] font-semibold text-[var(--fg2)] hover:bg-[var(--accent-soft)] hover:text-[var(--accent)] aria-expanded:bg-[var(--accent-soft)] aria-expanded:text-[var(--accent)] [@media(pointer:coarse)]:text-[11px]', TOUCH.hit)}>{n}</button>
      <AnimatePresence>
        {shown && (
          <motion.span ref={panel} id={id} role="tooltip" initial={{ opacity: 0, y: pos.up ? 4 : -4, scale: 0.97 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, scale: 0.97, transition: { duration: 0.12 } }} transition={spring(0.25, 0.3)}
            style={{ left: pos.dx, width: pos.w }} className={cn(floatingSurface, 'absolute z-50 block p-3 text-left text-[13px] leading-snug', pos.up ? 'bottom-[calc(100%+6px)]' : 'top-[calc(100%+6px)]')}>
            <span className="mb-1 flex min-w-0 items-center gap-1.5 text-xs text-[var(--fg3)]"><Icon name="globe" size={12} /><span className="truncate">{aiHost(source.url)}</span></span>
            <b className="block font-medium">{source.title}</b>
            {source.snippet && <span className="mt-1 block text-xs text-[var(--fg2)]">{source.snippet}</span>}
          </motion.span>
        )}
      </AnimatePresence>
    </span>
  )
}

/**
 * Inline completion: the rest of the best-matching suggestion shows in grey after what you typed; Tab accepts it
 * (with a small bump). The hint line under it is a button too, so a tap accepts on touch screens. Pass `suggestions`, or a `suggest(text)` function.
 */
export function GhostTextInput({ suggestions, suggest, placeholder, value, defaultValue = '', onChange, className }:
  { suggestions?: string[]; suggest?: (text: string) => string | null; placeholder?: string; value?: string; defaultValue?: string; onChange?: (v: string) => void; className?: string }) {
  const [v, setV] = useControllable(value, defaultValue, onChange)
  const [bump, setBump] = useState(0)
  const full = !v ? null : suggestions ? suggestions.find(s => s.toLowerCase().startsWith(v.toLowerCase()) && s.length > v.length) ?? null : (() => { const r = suggest?.(v); return r ? v + r : null })()
  const rest = full ? full.slice(v.length) : null
  const accept = () => { if (full) { setV(full); setBump(b => b + 1) } }
  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      <motion.div key={bump} animate={bump ? { scale: [1.02, 1] } : undefined} transition={spring(0.4, 0.3)} className="relative">
        <div aria-hidden className="pointer-events-none absolute inset-0 flex items-center overflow-hidden border border-transparent px-3 text-[13px] whitespace-pre [@media(pointer:coarse)]:text-base">
          <span className="invisible">{v}</span><span className="text-[var(--fg3)]">{rest}</span>
        </div>
        <input value={v} placeholder={placeholder} onChange={e => setV(e.target.value)} aria-label="Message with suggestions" autoComplete="off"
          onKeyDown={e => { if (e.key === 'Tab' && full) { e.preventDefault(); accept() } }} className={cn(inputClass, 'relative !bg-transparent [@media(pointer:coarse)]:!h-11', TOUCH.input)} />
      </motion.div>
      <span className="flex min-h-6 items-center text-xs text-[var(--fg3)]" aria-live="polite">{rest
        ? <button type="button" onMouseDown={e => e.preventDefault()} onClick={accept}
            className="-mx-1.5 inline-flex min-w-0 cursor-pointer items-center gap-1.5 rounded-[var(--r-md)] border-0 bg-transparent px-1.5 py-0.5 text-left text-xs text-[var(--fg3)] hover:bg-[var(--muted)] hover:text-[var(--fg)] [@media(pointer:coarse)]:min-h-9 [@media(pointer:coarse)]:bg-[var(--muted)] [@media(pointer:coarse)]:text-[var(--fg2)]">
            <span className="[@media(pointer:coarse)]:hidden">Press <Kbd>Tab</Kbd> or click to accept</span>
            <span className="hidden min-w-0 truncate [@media(pointer:coarse)]:inline">Tap to accept: <b className="font-medium text-[var(--fg)]">{full}</b></span>
          </button>
        : 'Suggestions appear as you type'}</span>
    </div>
  )
}

export type DiffSeg = { t: '=' | '-' | '+'; text: string }
/** Word-level diff (lcsDiff over words, case-insensitive), with tiny unchanged islands folded into the change so it reads cleanly. */
export function wordDiff(a: string, b: string): DiffSeg[] {
  const tok = (s: string) => s.match(/[^\s.,!?;:]+\s*|[.,!?;:]\s*/g) ?? []
  const A = tok(a), B = tok(b), norm = (s: string) => s.trim().toLowerCase()
  const raw: DiffSeg[] = lcsDiff(A, B, { equal: (x, y) => norm(x) === norm(y), prefer: 'insert' })
    .map(s => s.type === '-' ? { t: '-', text: A[s.a!] } : { t: s.type, text: B[s.b!] })
  // group runs, then fold short equal runs sitting between two changes
  const runs: DiffSeg[] = []
  raw.forEach(s => { const l = runs[runs.length - 1]; if (l && l.t === s.t) l.text += s.text; else runs.push({ ...s }) })
  const out: DiffSeg[] = []
  for (let k = 0; k < runs.length; k++) {
    const r = runs[k]
    if (r.t === '=' && k > 0 && k < runs.length - 1 && r.text.trim().length <= 3) { out.push({ t: '-', text: r.text }, { t: '+', text: r.text }); continue }
    out.push(r)
  }
  const merged: DiffSeg[] = []
  for (let k = 0; k < out.length;) {
    if (out[k].t === '=') { merged.push(out[k++]); continue }
    let del = '', ins = ''
    while (k < out.length && out[k].t !== '=') { if (out[k].t === '-') del += out[k].text; else ins += out[k].text; k++ }
    if (del) merged.push({ t: '-', text: del.replace(/\s+$/, ins ? '' : ' ') })
    if (ins) merged.push({ t: '+', text: ins })
  }
  return merged
}

/**
 * Proposed rewrite. "Make it concise" shows "Rewriting…", then a word-level diff (struck deletions, green insertions,
 * staggered in) with counts. Accept applies it with an "Applied" badge and Undo; Reject goes back.
 */
export function SuggestedEdit({ before, after, action = 'Make it concise', onResolve, className }: { before: string; after: string; action?: string; onResolve?: (accepted: boolean) => void; className?: string }) {
  const [state, setState] = useState<'idle' | 'rewriting' | 'review' | 'applied'>('idle')
  const segs = wordDiff(before, after)
  const dels = segs.filter(s => s.t === '-').length, ins = segs.filter(s => s.t === '+').length
  const go = async () => { setState('rewriting'); await sleep(800); setState('review') }
  let n = 0
  return (
    <div className={cn('flex flex-col gap-2.5', className)}>
      <motion.p key={state === 'applied' ? 'a' : 'b'} animate={state === 'applied' ? { scale: [0.98, 1] } : undefined} transition={spring(0.4, 0.35)}
        className="m-0 rounded-[10px] bg-[var(--muted)] px-3 py-2.5 text-[13px] leading-[1.75]">
        {state === 'review' ? segs.map((s, k) => s.t === '=' ? <span key={k}>{s.text}</span> : (
          <motion.span key={k} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.25, delay: n++ * 0.12 }}
            className={s.t === '-' ? 'bg-[var(--bad-soft)] text-[var(--bad)] line-through' : 'bg-[var(--ok-soft)] text-[var(--ok)]'}>{s.text}</motion.span>
        )) : state === 'applied' ? after : before}
      </motion.p>
      <div className="flex min-h-[30px] flex-wrap items-center gap-2">
        {state === 'idle' && <Button size="sm" variant="primary" onClick={go}>{action}</Button>}
        {state === 'rewriting' && <ShimmerText className="text-xs">Rewriting…</ShimmerText>}
        {state === 'review' && <>
          <Button size="sm" variant="primary" onClick={() => { setState('applied'); onResolve?.(true) }}>Accept</Button>
          <Button size="sm" onClick={() => { setState('idle'); onResolve?.(false) }}>Reject</Button>
          <span className="text-xs text-[var(--fg3)]">{dels} removed, {ins} added</span></>}
        {state === 'applied' && <>
          <motion.span initial={{ scale: 0.6 }} animate={{ scale: 1 }} transition={spring(0.5, 0.35)}><Badge tone="ok"><Icon name="check" size={11} strokeWidth={3} />Applied</Badge></motion.span>
          <Button size="sm" variant="ghost" onClick={() => setState('idle')}>Undo</Button></>}
      </div>
    </div>
  )
}

/**
 * Extracted field; only low-confidence values get flagged. A flagged field shows a question ("7 or 1 Nov?"):
 * pick the right value (click, or ↓ to open, arrows and Enter) and it resolves with a check.
 */
export function ConfidenceField({ label, value, confidence, threshold = 0.8, prompt, options, onResolve, className }:
  { label: string; value: string; confidence: number; threshold?: number; prompt?: string; options?: string[]; onResolve?: (v: string) => void; className?: string }) {
  const [chosen, setChosen] = useState<string | null>(null)
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null), id = useId()
  useOutside([ref], () => setOpen(false), open)
  const low = confidence < threshold && chosen === null
  const choices = options ?? [value]
  const pick = (v: string) => { setChosen(v); setOpen(false); onResolve?.(v) }
  const roving = useRoving(choices.length, i => pick(choices[i]))
  const opts: Option[] = choices.map((c, i) => ({ value: c, label: c, hint: i === 0 ? 'likely' : undefined }))
  const pct = Math.round(confidence * 100)
  return (
    <div className={cn('flex items-center justify-between gap-3 border-b border-[var(--line)] py-2 text-[13px] last:border-0', className)}>
      <span className="text-[var(--fg2)]">{label}</span>
      {low ? (
        <div ref={ref} className="relative">
          <Tooltip content={`${pct}% sure. Please check.`}>
            <button type="button" aria-haspopup="listbox" aria-expanded={open} aria-controls={open ? id : undefined} aria-activedescendant={open ? `${id}-${roving.active}` : undefined}
              onClick={() => { if (choices.length < 2) return pick(choices[0]); roving.setActive(0); setOpen(!open) }}
              onKeyDown={e => {
                if (!open) { if (e.key === 'ArrowDown' && choices.length > 1) { e.preventDefault(); roving.setActive(0); setOpen(true) } return }
                if (e.key === 'Escape') { e.stopPropagation(); setOpen(false) } else if (e.key === 'Tab') setOpen(false); else roving.onKeyDown(e)
              }}
              className="inline-flex cursor-pointer items-center gap-1 rounded-md border-0 bg-[var(--warn-soft)] px-2 py-0.5 text-xs text-[color-mix(in_srgb,var(--warn)_66%,var(--fg))] [@media(pointer:coarse)]:min-h-8">
              <Icon name="alert" size={12} />{prompt ?? 'Check'}</button>
          </Tooltip>
          <FloatingPanel open={open} placement="bottom-end" role="presentation" className="min-w-[190px]">
            <MenuLabel>Which is right? <span className="tabular-nums">· {pct}% sure</span></MenuLabel>
            <OptionList id={id} options={opts} active={roving.active} isSelected={() => false} onPick={i => pick(choices[i])} onHover={roving.setActive} label={`Choose ${label}`} />
          </FloatingPanel>
        </div>
      ) : (
        <motion.span key={chosen ?? 'v'} initial={chosen ? { opacity: 0, x: 6 } : false} animate={{ opacity: 1, x: 0 }} transition={spring(0.3, 0.3)} className="flex items-center gap-1.5 font-medium">
          {chosen ?? value}{chosen && <Icon name="check" size={12} strokeWidth={3} className="text-[var(--ok)]" />}
        </motion.span>
      )}
    </div>
  )
}

/** Bar heights for VoiceInput's live waveform (fraction of its 32px height). */
const AI_VOICE_BARS = Array.from({ length: 28 }, (_, i) => (6 + ((i * 7) % 22)) / 32)
const AI_VOICE_FLAT = AI_VOICE_BARS.map(() => 0)
/**
 * Mic button with a live waveform. While listening, interim words appear in grey; when you stop, the transcript
 * settles into its final form. Controlled with `listening` / `onListeningChange`, or uncontrolled.
 * (Wire it to your speech API; the demo replays `transcript`.)
 */
export function VoiceInput({ transcript = 'Move the meeting to three', listening: lc, onListeningChange, onResult, className }:
  { transcript?: string; listening?: boolean; onListeningChange?: (v: boolean) => void; onResult?: (text: string) => void; className?: string }) {
  const [listening, setListening] = useControllable(lc, false, onListeningChange)
  const [heard, setHeard] = useState(0)
  const [final, setFinal] = useState<string | null>(null)
  const words = transcript.split(' ')
  useEffect(() => {
    if (!listening) return
    setHeard(0); setFinal(null)
    const t = setInterval(() => setHeard(h => Math.min(words.length, h + 1)), 380)
    return () => clearInterval(t)
  }, [listening, words.length])
  const toggle = () => {
    if (listening) { const text = words.slice(0, Math.max(heard, words.length)).join(' '); setFinal(text); onResult?.(text) }
    setListening(!listening)
  }
  return (
    <div className={cn('flex flex-col gap-2', className)}>
      <div className="flex items-center gap-3">
        <span className="relative flex-none">
          {listening && <motion.span aria-hidden className="absolute inset-0 rounded-full bg-[var(--bad)]" initial={{ opacity: 0.5, scale: 1 }} animate={{ opacity: 0, scale: 1.7 }} transition={{ duration: 1.2, repeat: Infinity, ease: 'easeOut' }} />}
          <motion.span key={String(listening)} animate={{ scale: [1.1, 1] }} transition={spring(0.5, 0.3)} className="block">
            <Button variant={listening ? 'danger' : 'primary'} size="icon" aria-pressed={listening} aria-label={listening ? 'Stop listening' : 'Start listening'} onClick={toggle} className="!rounded-full">
              <Icon name={listening ? 'stop' : 'mic'} fill={listening ? 'currentColor' : 'none'} size={15} />
            </Button>
          </motion.span>
        </span>
        <Waveform peaks={listening ? AI_VOICE_BARS : AI_VOICE_FLAT} live={listening} played={listening ? 1 : 0} tone="ink" barWidth={3} minHeight={12.5} intro={false} className="h-8 min-w-0 flex-1 gap-[3px] overflow-hidden" />
      </div>
      <div className="min-h-[20px] text-[13px]" aria-live="polite">
        {listening ? <span className="text-[var(--fg3)]">{heard ? <>{words.slice(0, heard).join(' ')}<span className="ui-caret" /></> : 'Listening… tap to stop'}</span>
          : final ? <motion.span initial={{ opacity: 0.4, filter: 'blur(2px)' }} animate={{ opacity: 1, filter: 'blur(0px)' }} transition={{ duration: 0.35 }} className="font-medium text-[var(--fg)]">“{final}”</motion.span>
          : <span className="text-xs text-[var(--fg3)]">Tap to talk</span>}
      </div>
    </div>
  )
}

/* Sources panel ──────────────────────────────────────────────────────────── */

export type SourceCard = { title: string; domain: string; snippet: string; /** favicon letter */ letter?: string; /** favicon colour (any CSS colour or token) */ color?: string }
/**
 * Answer with numbered citations next to their source cards (stacked below on phones). Hovering or focusing either
 * side highlights both; tapping or clicking a citation opens its card with a nudge (scrolling it into view) and keeps
 * the pair highlighted; tapping a card expands it. Write `[1]` in `answer` for citation 1.
 */
export function SourcesPanel({ answer, sources, className }: { answer: string; sources: SourceCard[]; className?: string }) {
  const [hov, setHot] = useState(-1), [pin, setPin] = useState(-1) // hover/focus highlight, and the last tapped pair
  const hot = hov >= 0 ? hov : pin
  const [open, setOpen] = useState<Set<number>>(new Set())
  const [nudge, setNudge] = useState<{ i: number; k: number }>({ i: -1, k: 0 })
  const toggle = (i: number, force?: boolean) => setOpen(o => { const n = new Set(o); if (force ?? !n.has(i)) n.add(i); else n.delete(i); return n })
  const hover = (i: number) => ({ onPointerEnter: (e: React.PointerEvent) => { if (e.pointerType === 'mouse') setHot(i) }, onPointerLeave: (e: React.PointerEvent) => { if (e.pointerType === 'mouse') setHot(-1) }, onFocus: () => setHot(i), onBlur: () => setHot(-1) })
  const parts = answer.split(/(\[\d+\])/)
  return (
    <div className={cn('@container', className)}><div className="grid gap-3 @[560px]:grid-cols-[minmax(0,1fr)_280px]">
      <p className={cn(surface.card, 'm-0 px-4 py-3 text-sm leading-[1.8]')}>
        {parts.map((p, k) => {
          const m = p.match(/^\[(\d+)\]$/); if (!m) return <span key={k}>{p}</span>
          const i = Number(m[1]) - 1
          return <button key={k} {...hover(i)} aria-label={`Source ${i + 1}: ${sources[i]?.title}`} onClick={() => { toggle(i, true); setPin(i); setNudge(n => ({ i, k: n.k + 1 })) }}
            className={cn('mx-0.5 inline-grid h-[17px] min-w-[17px] cursor-pointer place-items-center rounded-[5px] border-0 px-1 align-[1px] text-[11px] font-semibold transition-colors', TOUCH.hit,
              hot === i ? 'bg-[var(--accent)] text-[var(--card)]' : 'bg-[var(--muted)] text-[var(--fg2)]')}>{i + 1}</button>
        })}
      </p>
      <div className="flex flex-col gap-2">
        {sources.map((s, i) => <AiSourceCardView key={i} s={s} n={i + 1} hot={hot === i} open={open.has(i)} nudge={nudge.i === i ? nudge.k : 0} bind={hover(i)} onToggle={() => { toggle(i); setPin(i) }} />)}
      </div>
    </div></div>
  )
}

function AiSourceCardView({ s, n, hot, open, nudge, bind, onToggle }:
  { s: SourceCard; n: number; hot: boolean; open: boolean; nudge: number; bind: Record<string, (e: React.PointerEvent) => void>; onToggle: () => void }) {
  const [scope, animate] = useAnimate<HTMLDivElement>()
  useEffect(() => {
    if (!nudge) return
    animate(scope.current, { x: [0, -4, 0] }, spring(0.5, 0.3))
    // stacked under the answer on phones: bring the opened card into view
    const r = scope.current.getBoundingClientRect(); if (r.top < 0 || r.bottom > innerHeight) scope.current.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }, [nudge]) // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div ref={scope} role="button" tabIndex={0} aria-expanded={open} {...bind} onClick={onToggle} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onToggle() } }}
      className={cn('cursor-pointer rounded-[var(--r-md)] border bg-[var(--card)] px-3 py-2.5 transition-[border-color,box-shadow] outline-none',
        hot ? 'border-[var(--accent)] shadow-[0_0_0_3px_var(--accent-soft)]' : 'border-[var(--line)]')}>
      <div className="flex items-center gap-2">
        <span className="grid h-5 w-5 flex-none place-items-center rounded-[5px] text-[10px] font-bold text-white [@media(pointer:coarse)]:text-[11px]" style={{ background: `color-mix(in srgb, ${s.color ?? 'var(--accent)'} 58%, #000)` }}>{s.letter ?? s.title[0]}</span>
        <div className="min-w-0"><b className="block truncate text-[13px] font-medium">{s.title}</b><div className="text-[11px] text-[var(--fg3)]">{s.domain}</div></div>
        <span className="ml-auto font-[family-name:var(--mono)] text-[11px] font-semibold text-[var(--fg3)]">{n}</span>
      </div>
      <Collapse open={open}><p className="m-0 pt-1.5 text-xs leading-normal text-[var(--fg2)]">{s.snippet}</p></Collapse>
    </div>
  )
}

/* Model comparison ───────────────────────────────────────────────────────── */

export type CompareModel = { name: string; tier: string; color: string; /** seconds before the first token */ firstToken: number; /** words per second while streaming */ speed: number; text: string; tps: number; cost: string }
type McState = { phase: 'idle' | 'thinking' | 'streaming' | 'done'; words: number }
/**
 * Same prompt, several models streamed side by side at their own speeds: thinking dots, first-token time, tokens/s
 * and cost. Vote for the best answer (a toast confirms). Run restarts all of them.
 */
export function ModelComparison({ prompt, models, className }: { prompt: string; models: CompareModel[]; className?: string }) {
  const toast = useToast()
  const [st, setSt] = useState<McState[]>(models.map(() => ({ phase: 'idle', words: 0 })))
  const [win, setWin] = useState(-1)
  const gen = useRef(0)
  const reduce = useReducedMotion()
  const run = () => {
    const g = ++gen.current; setWin(-1)
    setSt(models.map(() => ({ phase: 'thinking', words: 0 })))
    models.forEach(async (m, i) => {
      const set = (s: McState) => setSt(a => a.map((x, k) => k === i ? s : x))
      await sleep(reduce ? 0 : m.firstToken * 1000); if (g !== gen.current) return
      const W = m.text.split(' ').length
      for (let w = 1; w <= W; w++) { set({ phase: 'streaming', words: w }); await sleep(reduce ? 0 : 1000 / m.speed); if (g !== gen.current) return }
      set({ phase: 'done', words: W })
    })
  }
  useEffect(() => () => { gen.current++ }, [])
  return (
    <div className={cn('flex flex-col gap-3', className)}>
      <div className={cn(surface.muted, 'flex flex-wrap items-center gap-2.5 px-3 py-2.5 text-[13px]')}>
        <span className="text-xs text-[var(--fg3)]">Prompt</span><b className="min-w-0 flex-1 basis-[200px] font-medium">{prompt}</b>
        <Button size="sm" variant="primary" onClick={run} className="max-sm:w-full">{st.some(s => s.phase !== 'idle') ? 'Run again' : 'Run'}</Button>
      </div>
      <div className={cn(surface.card, 'grid overflow-hidden md:grid-cols-3')}>
        {models.map((m, i) => {
          const s = st[i], started = s.phase === 'streaming' || s.phase === 'done'
          return (
            <motion.div key={m.name} animate={win === i ? { scale: [1, 1.02, 1] } : { scale: 1 }} transition={spring(0.5, 0.35)}
              className={cn('flex flex-col border-[var(--line)] md:min-h-[200px] transition-[box-shadow,background] max-md:[&+&]:border-t md:[&+&]:border-l',
                win === i && 'relative z-[1] bg-[color-mix(in_srgb,var(--ok)_6%,var(--card))] shadow-[inset_0_0_0_1.5px_var(--ok),0_0_0_3px_var(--ok-soft)]')}>
              <div className="flex items-start gap-2.5 px-3 pt-3 pb-1 text-[13px]">
                <i className="mt-1 h-2.5 w-2.5 flex-none rounded-[3px]" style={{ background: m.color }} />
                <div className="min-w-0"><b className="block leading-tight">{m.name}</b><span className="text-[11px] text-[var(--fg3)]">{m.tier}</span></div>
                <span className="flex-1" />
                <span className="text-[11px] leading-7 text-[var(--fg3)]">{s.phase === 'thinking' ? 'Thinking…' : s.phase === 'streaming' ? 'Streaming' : ''}</span>
                <IconButton icon="thumbUp" label={`Mark ${m.name} as best`} aria-pressed={win === i} tone={win === i ? 'default' : 'muted'}
                  className={win === i ? '!bg-[var(--ok-soft)] text-[var(--ok)]' : ''}
                  onClick={() => { setWin(i); toast({ title: 'Vote recorded', description: `${m.name} wins this round`, tone: 'ok' }) }} />
              </div>
              <div className="flex gap-3 border-b border-[var(--line)] px-3 pb-2.5 text-[11px] text-[var(--fg3)]">
                <span><b className="font-[family-name:var(--mono)] font-semibold text-[var(--fg)]">{started ? `${m.firstToken}s` : '–'}</b> first token</span>
                <span><b className="font-[family-name:var(--mono)] font-semibold text-[var(--fg)]">{s.phase === 'done' ? m.tps : '–'}</b> tok/s</span>
                <span><b className="font-[family-name:var(--mono)] font-semibold text-[var(--fg)]">{s.phase === 'done' ? m.cost : '–'}</b></span>
              </div>
              <div className="flex-1 p-3 text-[13px] leading-relaxed">
                {s.phase === 'idle' ? <span className="text-xs text-[var(--fg3)]">Press Run to stream all three.</span>
                  : s.phase === 'thinking' ? <TypingDots />
                  : <span className={cn(s.phase === 'streaming' && 'ui-caret')}>{m.text.split(' ').slice(0, s.words).join(' ')}</span>}
              </div>
            </motion.div>
          )
        })}
      </div>
    </div>
  )
}
