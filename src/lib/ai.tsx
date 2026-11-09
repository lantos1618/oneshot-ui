import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from 'react'
import { AnimatePresence, motion, useAnimate, useInView, useReducedMotion } from 'motion/react'
import { AnimatedNumber, Avatar, Badge, Button, Icon, IconButton, Kbd, Spinner, StatusIcon, TOUCH, cn, cssUrl, defineMessages, floatingSurface, inputClass, safeColor, safeUrl, sleep, spring, surface, useControllable, useLocale, useMessages, useOutside, useRoving, useStreamedText, type IconName } from './core'
import { AutoHeight, Collapse, Progress, TypingDots, useToast } from './feedback'
import { CheckMark, Checkbox, OptionList, fileAccepts, type Option } from './forms'
import { FloatingPanel, MenuLabel, Tooltip, useHoverIntent } from './overlay'
import { lcsDiff } from './code'
import { useViewport } from './motion'
import { Waveform } from './media'

/* ════════════════════════════════════════════════════════════════════════════
 * 11. AI PATTERNS: streaming, showing work, asking permission, honest uncertainty
 * Strings live in one small catalog per family (machine-drafted de/ar), so a drop-in carries only its own.
 * ══════════════════════════════════════════════════════════════════════════ */

/** The composer pieces' strings (SendButton, AttachmentChip, PromptInput). Override with `<UIProvider messages={{ 'aiInput.placeholder': … }}>`. */
export const AI_INPUT_MESSAGES = defineMessages('aiInput', {
  en: {
    send: 'Send', stop: 'Stop', queue: 'Queue message', sending: 'Sending', remove: 'Remove {name}', askAnything: 'Ask anything…', messageLabel: 'Message',
    addFiles: 'Add files', model: 'Model', drop: 'Drop files to attach', maxFiles: 'Up to {max, number} files',
    wrongType: '{count, plural, one {“{name}” isn’t an accepted type} other {# files aren’t an accepted type}}',
    tooBig: '{count, plural, one {“{name}” is over {max}} other {# files are over {max}}}',
  },
  de: {
    send: 'Senden', stop: 'Stoppen', queue: 'Nachricht einreihen', sending: 'Wird gesendet', remove: '{name} entfernen', askAnything: 'Frag etwas …', messageLabel: 'Nachricht',
    addFiles: 'Dateien hinzufügen', model: 'Modell', drop: 'Dateien zum Anhängen ablegen', maxFiles: 'Höchstens {max, number} Dateien',
    wrongType: '{count, plural, one {„{name}“ ist kein erlaubter Dateityp} other {# Dateien haben keinen erlaubten Typ}}',
    tooBig: '{count, plural, one {„{name}“ ist größer als {max}} other {# Dateien sind größer als {max}}}',
  },
  ar: {
    send: 'إرسال', stop: 'إيقاف', queue: 'إضافة الرسالة إلى الانتظار', sending: 'جارٍ الإرسال', remove: 'إزالة {name}', askAnything: 'اسأل عن أي شيء…', messageLabel: 'الرسالة',
    addFiles: 'إضافة ملفات', model: 'النموذج', drop: 'أفلِت الملفات لإرفاقها', maxFiles: '{max, number} ملفات كحد أقصى',
    wrongType: '{count, plural, one {نوع الملف «{name}» غير مقبول} other {# ملفات بنوع غير مقبول}}',
    tooBig: '{count, plural, one {حجم «{name}» أكبر من {max}} other {# ملفات أكبر من {max}}}',
  },
})

/** ToolCall, ThinkingSteps and AgentPlan strings. */
export const AI_WORK_MESSAGES = defineMessages('aiWork', {
  en: {
    running: '{label}…', thinking: 'Thinking…', secs: '{s}s', thoughtFor: 'Thought for {s}s · {count, plural, one {# step} other {# steps}}',
    startsInView: 'Starts when it scrolls into view.', plan: 'Plan', planProgress: 'Plan progress', run: 'Run', runAgain: 'Run again',
    stepOf: 'Step {n, number} of {total, number}', done: 'Done',
  },
  de: {
    running: '{label} …', thinking: 'Denkt nach …', secs: '{s} s', thoughtFor: '{s} s nachgedacht · {count, plural, one {# Schritt} other {# Schritte}}',
    startsInView: 'Startet, sobald es sichtbar ist.', plan: 'Plan', planProgress: 'Planfortschritt', run: 'Ausführen', runAgain: 'Erneut ausführen',
    stepOf: 'Schritt {n, number} von {total, number}', done: 'Fertig',
  },
  ar: {
    running: '{label}…', thinking: 'يفكّر…', secs: '{s} ث', thoughtFor: 'فكّر لمدة {s} ث · {count, plural, zero {لا خطوات} one {خطوة واحدة} two {خطوتان} few {# خطوات} many {# خطوة} other {# خطوة}}',
    startsInView: 'يبدأ عند ظهوره على الشاشة.', plan: 'الخطة', planProgress: 'تقدّم الخطة', run: 'تشغيل', runAgain: 'تشغيل مجددًا',
    stepOf: 'الخطوة {n, number} من {total, number}', done: 'تم',
  },
})
/** Seconds with one decimal in the reader's locale ("3.2", "3,2", "٣٫٢"). */
const aiSecs = (fmt: { number: (n: number, o?: Intl.NumberFormatOptions) => string }, s: number, digits = 1) => fmt.number(s, { minimumFractionDigits: digits, maximumFractionDigits: digits })
/** A translated sentence with a component in it: `aiAround(t('delivered', { sent: AI_SLOT }))` → [before, after]. */
const AI_SLOT = '\u0000'
const AI_TAB = 'Tab'
const aiAround = (s: string): [string, string] => { const i = s.indexOf(AI_SLOT); return i < 0 ? [s, ''] : [s.slice(0, i), s.slice(i + AI_SLOT.length)] }

/** Text with a light sweeping across it. Use for in-progress labels ("Thinking…", "Reading 34 messages…"). */
export function ShimmerText({ children, active = true, className }: { children: ReactNode; active?: boolean; className?: string }) {
  const ref = useRef<HTMLSpanElement>(null)
  const onScreen = useInView(ref) // the sweep is a per-frame animation: only run it while visible
  // one element in every state (switching between a span and a motion.span remounted the text, and everything inside
  // it, on each render of the parent), and the sweep is a native animation: no script per frame
  useEffect(() => {
    const el = ref.current
    if (!active || !onScreen || !el?.animate) return
    const a = el.animate([{ backgroundPosition: '100% 0' }, { backgroundPosition: '-100% 0' }], { duration: 1600, easing: 'linear', iterations: Infinity })
    return () => a.cancel()
  }, [active, onScreen])
  if (!active) return <span ref={ref} className={className}>{children}</span>
  const cls = cn('bg-[linear-gradient(90deg,var(--fg3)_0%,var(--fg)_40%,var(--fg3)_80%)] bg-[length:200%_100%] bg-clip-text text-transparent', className)
  return <span ref={ref} className={cls} style={{ backgroundPosition: '100% 0' }}>{children}</span>
}

/**
 * Reveals `text` word by word (useStreamedText as a component). Change `key` to restart; `playing={false}` freezes it
 * (Stop). Pass a growing string with `live` (a model stream) and it keeps going from where it is, catching up when a
 * large chunk lands. Calls `onDone(text shown)` when it finishes (for `live`, once `live` is false and it caught up)
 * or is stopped.
 */
export function StreamingText({ text, playing = true, live = false, wordDelay = 45, onDone, onProgress, className, caret = true }:
  { text: string; playing?: boolean; live?: boolean; wordDelay?: number; onDone?: (shown: string) => void; onProgress?: () => void; className?: string; caret?: boolean }) {
  const { text: shown, done } = useStreamedText(text, { unit: 'word', wordDelay, start: playing, live, onProgress })
  const doneRef = useRef(false), cb = useRef(onDone); cb.current = onDone
  const finished = done || !playing
  const shownRef = useRef(shown); shownRef.current = shown
  useEffect(() => { if (!doneRef.current && finished) { doneRef.current = true; cb.current?.(shownRef.current) } }, [finished])
  return <span className={cn('whitespace-pre-wrap', !finished && caret && 'ui-caret', className)}>{shown}</span>
}

/** Collapsible tool-call row: shimmering label and spinner while running, a check and the past tense when done. Click to see the call. */
export function ToolCall({ status, label, doneLabel, detail, className }:
  { status: 'running' | 'done' | 'failed'; label: string; doneLabel?: string; detail?: ReactNode; className?: string }) {
  const [open, setOpen] = useState(false)
  const t = useMessages(AI_WORK_MESSAGES), { dir } = useLocale()
  return (
    <motion.div initial={{ opacity: 0, scale: 0.97 }} animate={{ opacity: 1, scale: 1 }} transition={spring(0.3, 0.4)}
      className={cn('my-1.5 overflow-hidden rounded-[var(--r-md)] border border-[var(--line)] text-xs', className)}>
      <button aria-expanded={open} onClick={() => setOpen(!open)}
        className="flex w-full cursor-pointer items-center gap-2 border-0 bg-[var(--muted)] px-2.5 py-2 text-start text-[var(--fg2)]">
        <AnimatePresence mode="popLayout" initial={false}>
          <motion.span key={status} initial={{ scale: 0.5, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={spring(0.5, 0.35)} className="grid">
            {status === 'running' ? <Spinner size={12} /> : <Icon name={status === 'done' ? 'check' : 'x'} size={12} strokeWidth={3} className={status === 'done' ? 'text-[var(--ok)]' : 'text-[var(--bad)]'} />}
          </motion.span>
        </AnimatePresence>
        <ShimmerText active={status === 'running'}>{status === 'running' ? t('running', { label }) : doneLabel ?? label}</ShimmerText>
        <motion.span className="ms-auto grid text-[var(--fg3)]" animate={{ rotate: open ? (dir === 'rtl' ? -90 : 90) : 0 }} transition={spring(0.2, 0.3)}><Icon name="chevronRight" size={11} strokeWidth={2.5} className="ui-flip" /></motion.span>
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
/**
 * Round primary send button for composers. `state` swaps the glyph with a spin-in (send ↑, stop ■, queue, sending
 * spinner); the label follows unless you pass one. 32px with an invisible 44px hit area on touch screens.
 */
export function SendButton({ state = 'send', label, disabled, onClick, className }:
  { state?: SendButtonState; label?: string; disabled?: boolean; onClick?: () => void; className?: string }) {
  const t = useMessages(AI_INPUT_MESSAGES)
  const name = label ?? t(state === 'queue' ? 'queue' : state)
  return (
    <motion.button type="button" aria-label={name} title={name} onClick={onClick} disabled={disabled} whileTap={disabled ? undefined : { scale: 0.9 }}
      className={cn('relative grid h-8 w-8 flex-none cursor-pointer place-items-center rounded-full border-0 bg-[var(--primary)] text-[var(--on-primary)] transition-opacity disabled:cursor-default disabled:opacity-30 [--hit:44px]', TOUCH.hit, className)}>
      <AnimatePresence mode="popLayout" initial={false}>
        <motion.span key={state} initial={{ scale: 0, rotate: -90 }} animate={{ scale: 1, rotate: 0 }} exit={{ scale: 0 }} transition={spring(0.4, 0.3)} className="grid">
          {state === 'sending' ? <Spinner size={14} label={t('sending')} />
            : state === 'stop' ? <span className="block h-3 w-3 rounded-[var(--r-sm)] bg-current" />
            : <Icon name={state === 'queue' ? 'listPlus' : 'arrowUp'} size={15} strokeWidth={2.5} className={state === 'queue' ? 'ui-flip' : undefined} />}
        </motion.span>
      </AnimatePresence>
    </motion.button>
  )
}

/** A file waiting in a composer: `url` is an object URL for an image preview (revoked when it goes away), else null. */
export type Attachment = { id: number; file: File; url: string | null }

/**
 * Attachment state for composers: `add(files)` keeps at most `max` (and skips files over `maxSize` bytes or not
 * matching `accept`, passing them to `onReject` with a reason), makes object URLs for image previews and revokes them
 * on `remove`, `clear`, `take` (which hands back the Files) and unmount.
 */
export function useAttachments({ max = 10, maxSize = 20 * 1024 * 1024, accept, onReject }:
  { max?: number; maxSize?: number; accept?: string; onReject?: (files: File[], reason: 'type' | 'size' | 'count') => void } = {}) {
  const [files, setFiles] = useState<Attachment[]>([])
  const urls = useRef(new Set<string>()), fid = useRef(0), cur = useRef(files); cur.current = files
  const cb = useRef(onReject); cb.current = onReject
  useEffect(() => { const u = urls.current; return () => { u.forEach(x => URL.revokeObjectURL(x)); u.clear() } }, [])
  const drop = (f: Attachment) => { if (f.url) { URL.revokeObjectURL(f.url); urls.current.delete(f.url) } }
  const add = (list: FileList | File[]) => {
    const all = Array.from(list)
    const wrongType = all.filter(f => !fileAccepts(f, accept)), tooBig = all.filter(f => fileAccepts(f, accept) && f.size > maxSize)
    const ok = all.filter(f => fileAccepts(f, accept) && f.size <= maxSize)
    const room = Math.max(0, max - cur.current.length), taken = ok.slice(0, room), extra = ok.slice(room)
    if (wrongType.length) cb.current?.(wrongType, 'type')
    if (tooBig.length) cb.current?.(tooBig, 'size')
    if (extra.length) cb.current?.(extra, 'count')
    if (!taken.length) return
    const next = taken.map(file => {
      let url: string | null = null
      if (/^image\//.test(file.type)) { try { url = URL.createObjectURL(file); urls.current.add(url) } catch { url = null } }
      return { id: ++fid.current, file, url }
    })
    cur.current = [...cur.current, ...next]
    setFiles(cur.current)
  }
  const remove = (id: number) => { const f = cur.current.find(x => x.id === id); if (f) drop(f); cur.current = cur.current.filter(x => x.id !== id); setFiles(cur.current) }
  const clear = () => { cur.current.forEach(drop); cur.current = []; setFiles([]) }
  const take = () => { const out = cur.current.map(f => f.file); clear(); return out }
  return { files, add, remove, clear, take }
}
/** What useAttachments returns: pass it to PromptInput's `attachmentState` to own the files yourself. */
export type AttachmentState = ReturnType<typeof useAttachments>

/**
 * An attachment tile: image preview (only `blob:`, `data:image/` or http(s) URLs, through `cssUrl`) or the file
 * extension, the name and size, and a remove button when `onRemove` is given (visible on hover, focus and touch).
 * `uploading` plays a short progress bar along the bottom.
 */
export function AttachmentChip({ name, size, url, onRemove, uploading, className }:
  { name: string; size?: number; url?: string | null; onRemove?: () => void; uploading?: number; className?: string }) {
  const preview = url ? cssUrl(url) : 'none'
  const t = useMessages(AI_INPUT_MESSAGES), { fmt } = useLocale()
  return (
    <motion.div initial={{ opacity: 0, scale: 0.85 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.85, transition: { duration: 0.15 } }} transition={spring(0.4, 0.3)}
      className={cn('group/f relative flex h-12 max-w-[min(220px,100%)] items-center gap-2 overflow-hidden rounded-[var(--r-lg)] border border-[var(--line)] bg-[var(--bg)] py-1 pe-3 ps-1', className)}>
      <span className="grid h-10 w-10 flex-none place-items-center rounded-[var(--r-md)] bg-[var(--muted)] bg-cover bg-center font-[family-name:var(--mono)] text-[11px] font-bold text-[var(--fg2)]" style={preview !== 'none' ? { backgroundImage: preview } : undefined}>
        {preview !== 'none' ? '' : (name.split('.').pop() || 'file').slice(0, 4).toUpperCase()}</span>
      <span className="flex min-w-0 flex-col text-xs leading-tight"><b dir="auto" className="truncate font-medium">{name}</b>{size != null && <span className="text-[var(--fg3)]">{fmt.bytes(size)}</span>}</span>
      {uploading != null && <motion.i className="absolute bottom-0 start-0 h-0.5 bg-[var(--accent)]" initial={{ width: '0%', opacity: 1 }} animate={{ width: '100%', opacity: [1, 1, 0] }} transition={{ duration: 0.6 + (uploading % 4) * 0.2, ease: 'easeOut', opacity: { duration: 0.6 + (uploading % 4) * 0.2 + 0.3, times: [0, 0.75, 1] } }} />}
      {onRemove && <button type="button" aria-label={t('remove', { name })} onClick={onRemove}
        className={cn('absolute top-1 end-1 grid h-[18px] w-[18px] cursor-pointer place-items-center rounded-full border-0 bg-[var(--fg)] text-[var(--bg)] opacity-0 transition-opacity group-hover/f:opacity-100 focus-visible:opacity-100 [@media(pointer:coarse)]:opacity-100', TOUCH.hit)}><Icon name="x" size={10} strokeWidth={3} /></button>}
    </motion.div>
  )
}

/**
 * A model picker for composer bars: the platform's own <select> (a native menu on phones, nothing to bundle), styled as
 * a quiet bar button with a chevron on the end side.
 */
function AiModelSelect({ label, options, value, onChange, disabled, className }:
  { label: string; options: Option[]; value?: string; onChange?: (v: string) => void; disabled?: boolean; className?: string }) {
  return (
    <span className={cn('relative inline-flex min-w-0 flex-none items-center', className)}>
      <select aria-label={label} value={value ?? options[0]?.value} disabled={disabled} onChange={e => onChange?.(e.target.value)}
        className="h-8 w-full min-w-0 cursor-pointer appearance-none truncate rounded-[var(--r-md)] border-0 bg-transparent ps-2 pe-6 text-xs text-[var(--fg)] outline-none hover:bg-[var(--muted)] focus-visible:shadow-[0_0_0_2px_var(--accent-soft)] disabled:opacity-60 [@media(pointer:coarse)]:h-10 [@media(pointer:coarse)]:text-base">
        {options.map(o => <option key={o.value} value={o.value} disabled={o.disabled}>{o.label}</option>)}
      </select>
      <Icon name="chevronDown" size={12} strokeWidth={2.5} className="pointer-events-none absolute end-1.5 text-[var(--fg3)]" />
    </span>
  )
}

/** Chat status as PromptInput sees it (the same names as useAiChat's `status`). */
export type PromptStatus = 'ready' | 'submitted' | 'streaming' | 'error'

/** PromptInput's send button when you drive it yourself (e.g. queueing while a reply streams). */
export type PromptSendButton = { state: SendButtonState; disabled: boolean; onClick: () => void }
/**
 * The prompt box for chats. Grows with its text up to `maxHeight`, then scrolls. Enter sends (never mid IME
 * composition), Shift+Enter adds a line. Attach with +, paste or drag and drop; images preview through object URLs
 * that are revoked when removed or sent. Optional model picker (`models`, `model`, `onModelChange`) and your own
 * buttons (`tools`). While `status` is submitted or streaming, Send turns into Stop (`onStop`). `onSubmit(text, files)`
 * may return false to keep the draft. Text is controlled (`value`/`onChange`, e.g. useAiChat's input) or not.
 *
 * Composers built on it (AgentComposer, ChatComposer) can also own the files (`attachmentState` from useAttachments),
 * add chips above them (`header`), replace the + button (`addButton`, given a file-picker opener), add a status before
 * Send (`aside`), drive Send themselves (`sendButton` + `canSubmit`) and reach the textarea and bar (`inputRef`, `barRef`).
 */
export function PromptInput({ onSubmit, onStop, status = 'ready', value, defaultValue = '', onChange, placeholder, attachments = true, accept, maxFiles = 10, maxFileSize = 20 * 1024 * 1024,
  onReject, models, model, onModelChange, tools, disabled, autoFocus, maxHeight = 168, label, className,
  attachmentState, header, addButton, aside, sendButton, canSubmit, inputRef, barRef, dropHint, uploadProgress, layout, classNames }:
  { onSubmit: (text: string, files: File[]) => boolean | void; onStop?: () => void; status?: PromptStatus; value?: string; defaultValue?: string; onChange?: (v: string) => void
    placeholder?: string; attachments?: boolean; accept?: string; maxFiles?: number; maxFileSize?: number; onReject?: (files: File[], reason: 'type' | 'size' | 'count') => void
    models?: Option[]; model?: string; onModelChange?: (m: string) => void; tools?: ReactNode; disabled?: boolean; autoFocus?: boolean; maxHeight?: number; label?: string; className?: string
    /** the files, when you own them (useAttachments); default: PromptInput keeps its own */
    attachmentState?: AttachmentState
    /** shown above the file chips (context chips, quoted text…) */
    header?: ReactNode
    /** replaces the + button; `pick(accept?)` opens the file picker */
    addButton?: (pick: (accept?: string) => void) => ReactNode
    /** shown just before the send button */
    aside?: ReactNode
    /** the send button's state and action (default: from `status`, `onStop` and the draft) */
    sendButton?: PromptSendButton
    /** whether Enter submits (default: there is text or a file and no reply is running) */
    canSubmit?: boolean
    inputRef?: RefObject<HTMLTextAreaElement | null>; barRef?: RefObject<HTMLDivElement | null>
    /** what the drop overlay says (default: an upload icon and "Drop files to attach") */
    dropHint?: ReactNode
    /** play an upload bar on each new file chip */
    uploadProgress?: boolean
    /** animate the box's size and position (motion layout), e.g. when it moves from a hero into a conversation */
    layout?: boolean
    classNames?: { input?: string; bar?: string; send?: string } }) {
  const [text, setText] = useControllable(value, defaultValue, onChange)
  const [note, setNote] = useState('')
  const t = useMessages(AI_INPUT_MESSAGES), { fmt } = useLocale()
  const own = useAttachments({ max: maxFiles, maxSize: maxFileSize, accept, onReject: (f, why) => {
    const v = { count: f.length, name: f[0]?.name ?? '' }
    setNote(why === 'type' ? t('wrongType', v) : why === 'size' ? t('tooBig', { ...v, max: fmt.bytes(maxFileSize) }) : t('maxFiles', { max: maxFiles })); onReject?.(f, why)
  } })
  const att = attachmentState ?? own
  const [over, setOver] = useState(false)
  const ownRef = useRef<HTMLTextAreaElement>(null), fileRef = useRef<HTMLInputElement>(null), depth = useRef(0)
  const ref = inputRef ?? ownRef
  useAutoGrow(ref, text, maxHeight)
  useEffect(() => { if (!note) return; const t = setTimeout(() => setNote(''), 4000); return () => clearTimeout(t) }, [note])
  const busy = status === 'submitted' || status === 'streaming'
  const canSend = canSubmit ?? (!disabled && !busy && (!!text.trim() || att.files.length > 0))
  const send = () => {
    if (!canSend) return
    const files = att.files.map(f => f.file)
    if (onSubmit(text.trim(), files) === false) return
    att.clear(); setText('')
  }
  const addFiles = (l: FileList | File[]) => { if (attachments) { att.add(l); ref.current?.focus() } }
  const pick = (a?: string) => { const el = fileRef.current; if (!el) return; el.accept = a ?? accept ?? ''; el.click() }
  const btn = sendButton ?? { state: busy ? (onStop ? 'stop' : 'sending') : 'send', onClick: busy ? onStop ?? (() => {}) : send, disabled: busy ? !onStop : !canSend }
  return (
    <motion.div layout={layout} transition={layout ? spring(0.15, 0.6) : undefined}
      onMouseDown={e => { if (e.target === e.currentTarget) { e.preventDefault(); ref.current?.focus() } }}
      className={cn('relative rounded-[var(--r-lg)] border bg-[var(--card)] px-2.5 pt-2.5 pb-2 transition-[border-color,box-shadow]',
      over ? 'border-[var(--accent)] shadow-[0_0_0_4px_var(--accent-soft)]' : 'border-[var(--line)] shadow-[0_1px_2px_rgba(0,0,0,.04)] focus-within:border-[var(--line2)] focus-within:shadow-[0_0_0_4px_var(--muted)]', className)}
      onDragEnter={e => { if (!attachments || !e.dataTransfer.types.includes('Files')) return; e.preventDefault(); depth.current++; setOver(true) }}
      onDragOver={e => { if (attachments && e.dataTransfer.types.includes('Files')) e.preventDefault() }}
      onDragLeave={() => { depth.current = Math.max(0, depth.current - 1); if (!depth.current) setOver(false) }}
      onDrop={e => { if (!attachments) return; e.preventDefault(); depth.current = 0; setOver(false); if (e.dataTransfer.files.length) addFiles(e.dataTransfer.files) }}>
      {attachments && <div aria-hidden className={cn('pointer-events-none absolute inset-1 z-[4] flex items-center justify-center gap-2 rounded-[var(--r-lg)] border-2 border-dashed border-[var(--accent)] bg-[color-mix(in_srgb,var(--accent-soft)_92%,transparent)] text-[13px] font-semibold text-[var(--accent)] transition-opacity', over ? 'opacity-100' : 'opacity-0')}>
        {dropHint ?? <><Icon name="upload" size={16} />{t('drop')}</>}</div>}
      <motion.div layout={layout ? 'position' : undefined}>
        {header}
        {att.files.length > 0 && <div className="mb-2 flex flex-wrap gap-1.5">
          <AnimatePresence initial={false}>{att.files.map(f => <AttachmentChip key={f.id} name={f.file.name} size={f.file.size} url={f.url} uploading={uploadProgress ? f.id : undefined} onRemove={() => { att.remove(f.id); ref.current?.focus() }} />)}</AnimatePresence>
        </div>}
        <textarea ref={ref} rows={1} dir="auto" value={text} placeholder={placeholder ?? t('askAnything')} aria-label={label ?? t('messageLabel')} disabled={disabled} autoFocus={autoFocus} onChange={e => setText(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); send() } }}
          onPaste={e => { if (!attachments) return; const f = Array.from(e.clipboardData.files); if (f.length) { e.preventDefault(); addFiles(f) } }}
          className={cn('block min-h-6 w-full resize-none border-0 bg-transparent px-1 py-0.5 text-sm leading-normal text-[var(--fg)] outline-none placeholder:text-[var(--fg3)] disabled:opacity-60', TOUCH.input, classNames?.input)} />
        <div ref={barRef} className={cn('mt-1.5 flex min-w-0 items-center gap-1', classNames?.bar)}>
          {attachments && <>
            <input ref={fileRef} type="file" multiple hidden accept={accept} onChange={e => { if (e.target.files) addFiles(e.target.files); e.target.value = '' }} />
            {addButton ? addButton(pick)
              : <IconButton icon="plus" label={t('addFiles')} size="icon-sm" disabled={disabled} onClick={() => pick()} className="[@media(pointer:coarse)]:!h-10 [@media(pointer:coarse)]:!w-10" />}
          </>}
          {models && models.length > 0 && <AiModelSelect label={t('model')} options={models} value={model} onChange={onModelChange} disabled={disabled} className="max-w-[min(200px,45vw)]" />}
          {tools}
          <span className="min-w-0 flex-1 truncate px-1 text-[11px] text-[var(--fg3)]" role="status">{note}</span>
          {aside}
          <SendButton state={btn.state} onClick={btn.onClick} disabled={btn.disabled}
            className={cn('[@media(pointer:coarse)]:h-10 [@media(pointer:coarse)]:w-10', classNames?.send)} />
        </div>
      </motion.div>
    </motion.div>
  )
}

/**
 * Message box: grows with text, Enter sends (never mid IME composition), Shift+Enter adds a line. + attaches files
 * (also by paste and drop). Send turns into Stop while `busy`. `footer` replaces the + button. A PromptInput with the
 * 0.2 props.
 */
export function ChatComposer({ onSend, onStop, busy, placeholder, footer, className }:
  { onSend: (text: string, files: File[]) => void; onStop?: () => void; busy?: boolean; placeholder?: string; footer?: ReactNode; className?: string }) {
  return <PromptInput onSubmit={(t, f) => { onSend(t, f) }} onStop={onStop} status={busy ? 'streaming' : 'ready'} placeholder={placeholder} attachments={footer === undefined} tools={footer} className={className} />
}

/* Thinking steps ─────────────────────────────────────────────────────────── */

export type StepStatus = 'done' | 'active' | 'pending' | 'failed'

export type ThoughtStep = { label: string; detail?: string; sources?: string[]; /** seconds this step takes when auto-playing */ duration?: number; status?: StepStatus }


/** "Thinking… 3.2s": ticks on its own, so the step list doesn't re-render ten times a second. */
function AiThinkClock({ clock, live }: { clock: () => number; live: boolean }) {
  const [, tick] = useState(0)
  const t = useMessages(AI_WORK_MESSAGES), { fmt } = useLocale()
  useEffect(() => { if (!live) return; const t = setInterval(() => tick(n => n + 1), 100); return () => clearInterval(t) }, [live])
  return <span className="tabular-nums">{t('secs', { s: aiSecs(fmt, clock()) })}</span>
}

/** One step row of ThinkingSteps (also used, invisible, to reserve the tallest layout). */
function AiThoughtRow({ s, st, last, detail, srcs, time, animate, expandable, expanded, onToggle }:
  { s: ThoughtStep; st: StepStatus; last: boolean; detail: string; srcs: number; time?: number; animate: boolean; expandable?: boolean; expanded?: boolean; onToggle?: () => void }) {
  // one line: the label truncates and the time has its own slot, so a time appearing never wraps the row
  const t = useMessages(AI_WORK_MESSAGES), { fmt } = useLocale()
  const label = <><span className="min-w-0 truncate">{s.label}</span>{time !== undefined && <span className="flex-none text-[11px] font-normal tabular-nums text-[var(--fg3)]">{t('secs', { s: aiSecs(fmt, time) })}</span>}</>
  return (
    <li className="grid grid-cols-[22px_1fr] gap-2.5">
      <div className="flex flex-col items-center pt-px">
        <StatusIcon status={st} />
        {!last && <span className="relative my-1 min-h-3.5 w-0.5 flex-1 overflow-hidden rounded-[var(--r-sm)] bg-[var(--line)]">
          {/* scaleY, not height: the fill never triggers layout */}
          <motion.b className="absolute inset-0 block origin-top bg-[var(--fg3)]" initial={false} animate={{ scaleY: st === 'done' ? 1 : 0 }} transition={{ duration: 0.3 }} />
        </span>}
      </div>
      <div className="min-w-0 pb-3">
        <div className={cn('flex min-w-0 items-baseline gap-1.5 leading-5 font-medium', st === 'pending' ? 'text-[var(--fg3)]' : 'text-[var(--fg)]')}>
          {expandable ? <button type="button" aria-pressed={expanded} onClick={onToggle} className="flex min-w-0 cursor-pointer items-baseline gap-1.5 border-0 bg-transparent p-0 text-start font-medium text-inherit hover:underline">{label}</button> : label}
        </div>
        {detail && <motion.div initial={animate ? { opacity: 0, y: -4 } : false} animate={{ opacity: 1, y: 0 }} className="mt-1 text-xs leading-normal text-[var(--fg2)]">{detail}</motion.div>}
        {s.sources && srcs > 0 && <div className="mt-1.5 flex flex-wrap gap-1">{s.sources.slice(0, srcs).map(x => (
          <motion.span key={x} initial={animate ? { opacity: 0, scale: 0.85 } : false} animate={{ opacity: 1, scale: 1 }} transition={spring(0.4, 0.3)}
            className="inline-flex items-center gap-1 rounded-full border border-[var(--line)] px-2 py-0.5 text-[11px] text-[var(--fg2)]"><Icon name="globe" size={10} strokeWidth={2.5} />{x}</motion.span>))}</div>}
      </div>
    </li>
  )
}

/**
 * Reasoning as a vertical stepper. Static (pass `status` per step) or `autoPlay`: starts when scrolled into view,
 * types the current step's detail and pops in its source chips while finished steps fold to one line (with their
 * time; click one to read it again), and fills the connector. The list reserves the height of its tallest step up
 * front, so playing never pushes the page. The header counts "Thinking… 3.2s", then reads "Thought for Xs · N steps";
 * click it to fold the steps away. `autoCollapse` folds them by itself when done (it changes the height, so use it
 * where nothing sits below, e.g. the end of a chat). Change `replayKey` to run it again. Paused while off screen.
 */
export function ThinkingSteps({ steps, summary, defaultOpen = true, autoPlay = false, replayKey = 0, autoCollapse = false, className }:
  { steps: ThoughtStep[]; summary?: ReactNode; defaultOpen?: boolean; autoPlay?: boolean; replayKey?: number; autoCollapse?: boolean; className?: string }) {
  const [open, setOpen] = useState(defaultOpen)
  const t = useMessages(AI_WORK_MESSAGES), { fmt, dir } = useLocale()
  const ref = useRef<HTMLDivElement>(null)
  const inView = useInView(ref, { amount: 0.4, once: true })
  const onScreen = useInView(ref), vis = useRef(true); vis.current = onScreen // the run pauses while scrolled away
  const reduce = useReducedMotion()
  const [play, setPlay] = useState({ cur: autoPlay ? -1 : steps.length, words: 0, srcs: 0, times: [] as number[], elapsed: 0, running: false })
  const [pick, setPick] = useState(-1) // after a run: the finished step whose detail is shown
  const clock = useRef<() => number>(() => 0)
  useEffect(() => {
    if (!autoPlay || !inView) return
    let off = false, pausedFor = 0
    const now = () => performance.now() - pausedFor // clock that stands still while off screen
    const gate = async () => { if (vis.current) return; const at = performance.now(); while (!vis.current && !off) await sleep(200); pausedFor += performance.now() - at }
    const t0 = now()
    clock.current = () => (now() - t0) / 1000
    ;(async () => {
      setOpen(true); setPick(-1)
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
      const total = (now() - t0) / 1000
      clock.current = () => total
      setPlay(p => ({ ...p, cur: steps.length, running: false, elapsed: total }))
      await sleep(reduce ? 0 : 1400)
      if (!off && autoCollapse) setOpen(false)
    })()
    return () => { off = true }
  }, [autoPlay, inView, replayKey]) // eslint-disable-line react-hooks/exhaustive-deps

  const statusOf = (s: ThoughtStep, i: number): StepStatus => !autoPlay ? s.status ?? 'pending' : i < play.cur || play.times[i] !== undefined ? 'done' : i === play.cur ? 'active' : 'pending'
  const finished = autoPlay && play.cur >= steps.length
  const header = !autoPlay ? summary
    : play.running ? <ShimmerText>{t('thinking')} <AiThinkClock clock={() => clock.current()} live={onScreen} /></ShimmerText>
    : finished ? <>{summary ?? t('thoughtFor', { s: aiSecs(fmt, play.elapsed, 0), count: steps.length })}</> : t('thinking')
  const rows = (detailed: boolean) => steps.map((s, i) => {
    const st = statusOf(s, i)
    return <AiThoughtRow key={i} s={s} st={st} last={i === steps.length - 1} detail={detailed ? s.detail ?? '' : ''} srcs={detailed ? Infinity : 0}
      time={autoPlay ? play.times[i] : undefined} animate={false} expandable={finished && !!(s.detail || s.sources?.length)} expanded={i === shownStep}
      onToggle={() => setPick(i)} />
  })
  // autoPlay: every step stays one line (rows never move); the live step's detail types into a panel below the list,
  // which is as tall as the tallest step's detail from the start (every detail stacked invisibly in the same cell)
  const shownStep = !autoPlay ? -1 : finished ? (pick >= 0 ? pick : steps.length - 1) : play.cur
  const live = autoPlay && !finished && play.cur >= 0
  const cur = steps[shownStep]
  const detailOf = (s: ThoughtStep, words: number, srcs: number, animate: boolean) => <>
    <div className="mb-1 truncate text-[11px] font-medium text-[var(--fg3)]">{s.label}</div>
    {s.detail && <div className="text-xs leading-normal text-[var(--fg2)]">{(s.detail ?? '').split(' ').slice(0, words).join(' ')}</div>}
    {s.sources && srcs > 0 && <div className="mt-1.5 flex flex-wrap gap-1">{s.sources.slice(0, srcs).map(x => (
      <motion.span key={x} initial={animate ? { opacity: 0, scale: 0.85 } : false} animate={{ opacity: 1, scale: 1 }} transition={spring(0.4, 0.3)}
        className="inline-flex items-center gap-1 rounded-full border border-[var(--line)] px-2 py-0.5 text-[11px] text-[var(--fg2)]"><Icon name="globe" size={10} strokeWidth={2.5} />{x}</motion.span>))}</div>}
  </>
  // the rows and the invisible sizers only change between steps, not on every typed word
  const rowEls = useMemo(() => rows(false), [steps, play.cur, play.times, finished, pick]) // eslint-disable-line react-hooks/exhaustive-deps
  const ghosts = useMemo(() => steps.map((s, k) => <div key={'ghost' + k} aria-hidden className="invisible min-w-0">{detailOf(s, Infinity, Infinity, false)}</div>), [steps]) // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div ref={ref} className={cn(surface.card, 'overflow-hidden text-[13px]', className)}>
      <button onClick={() => setOpen(!open)} aria-expanded={open} className="flex w-full cursor-pointer items-center gap-2 border-0 bg-transparent p-3 text-start font-medium text-[var(--fg2)] hover:text-[var(--fg)]">
        <Icon name={autoPlay ? 'bulb' : 'sparkles'} size={14} />{header}
        <motion.span className="ms-auto grid text-[var(--fg3)]" animate={{ rotate: open ? 0 : dir === 'rtl' ? 90 : -90 }} transition={spring(0.2, 0.3)}><Icon name="chevronDown" size={12} strokeWidth={2.5} /></motion.span>
      </button>
      <Collapse open={open}>
        {autoPlay ? (
          <div className="px-3 pt-0.5 pb-3">
            <ol className="m-0 list-none p-0 [&>li>div:last-child]:pb-2">{rowEls}</ol>
            <div className={cn(surface.muted, 'grid px-2.5 py-2 [&>*]:[grid-area:1/1]')}>
              {ghosts}
              <div className="min-w-0" aria-live="off">
                {cur ? detailOf(cur, live ? play.words : Infinity, live ? play.srcs : Infinity, live)
                  : <span className="text-xs text-[var(--fg3)]">{play.cur < 0 ? t('startsInView') : ''}</span>}
              </div>
            </div>
          </div>
        ) : <ol className="m-0 list-none px-3 pt-0.5 pb-3">{rows(true)}</ol>}
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
  const t = useMessages(AI_WORK_MESSAGES), { fmt } = useLocale()
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
      <div className="flex items-center justify-between text-xs text-[var(--fg3)]"><span>{t('plan')}</span><span className="tabular-nums">{fmt.number(done)}/{fmt.number(steps.length)}</span></div>
      <Progress value={done} max={steps.length} tone="ok" label={t('planProgress')} />
      <ol className="m-0 flex list-none flex-col gap-2 p-0">
        {items.map((s, i) => (
          <motion.li key={i} layout className={cn('flex items-center gap-2.5 text-[13px] transition-colors', s.status === 'pending' ? 'text-[var(--fg3)]' : s.status === 'done' ? 'text-[var(--fg2)]' : 'text-[var(--fg)]')}>
            <StatusIcon status={s.status} />{s.label}
          </motion.li>
        ))}
      </ol>
      {!controlled && <div className="flex items-center gap-2.5">
        <Button size="sm" variant="primary" disabled={running} onClick={run}><span className="grid [&>*]:[grid-area:1/1]"><span aria-hidden className="invisible">{t('runAgain')}</span><span>{ran ? t('runAgain') : t('run')}</span></span></Button>
        <span className="text-xs tabular-nums text-[var(--fg3)]" aria-live="polite">{running ? t('stepOf', { n: cur + 1, total: steps.length }) : cur >= steps.length ? t('done') : ''}</span>
      </div>}
    </div>
  )
}

/* Permission request ─────────────────────────────────────────────────────── */

/** PermissionRequest's strings. */
export const AI_PERMISSION_MESSAGES = defineMessages('aiPermission', {
  en: {
    defaultTitle: 'Send an email', asking: 'Assistant is asking · just now', needsApproval: 'Needs approval', subject: 'Subject', messageField: 'Message',
    alwaysAllow: 'Always allow emails to this list', deny: 'Deny', editDraft: 'Edit draft', allowSend: 'Allow and send', editTitle: 'Edit before sending',
    toList: 'To {list} · {count, plural, one {# person} other {# people}}', back: 'Back', sendNow: 'Send now', undoing: 'Undoing…', sending: 'Sending…',
    delivered: '{sent} of {total, number} delivered', deliveredLabel: 'Delivered {sent, number} of {total, number}', recalling: 'Asking the app to recall it',
    waitingMail: 'Waiting for the mail app', waitingApp: 'Waiting for the app', sentTo: 'Sent to {count, plural, one {# person} other {# people}}', approved: 'Approved',
    handedOff: ' · handed to the app to send', noAskAgain: ' · Future emails to this list won’t ask', undoFor: 'Undo available for {n, number} s', deliveredDone: 'Delivered',
    sentToApp: 'Sent to the app', undoSend: 'Undo send', startOver: 'Start over', undone: 'Send undone',
    undoneSub: 'Nothing reached the {count, plural, one {# recipient} other {# recipients}}. The draft is saved.', undoFailed: 'Couldn’t undo',
    undoFailedSub: 'The app couldn’t recall it, so it may already have been delivered.', notSent: 'Not sent',
    failedSub: 'The app reported a problem. Nothing was confirmed as delivered.', deniedSub: 'You declined, and the app was told not to send this email.',
    undoAction: 'Undo', backToRequest: 'Back to request',
  },
  de: {
    defaultTitle: 'E-Mail senden', asking: 'Assistent fragt · gerade eben', needsApproval: 'Freigabe nötig', subject: 'Betreff', messageField: 'Nachricht',
    alwaysAllow: 'E-Mails an diese Liste immer erlauben', deny: 'Ablehnen', editDraft: 'Entwurf bearbeiten', allowSend: 'Erlauben und senden', editTitle: 'Vor dem Senden bearbeiten',
    toList: 'An {list} · {count, plural, one {# Person} other {# Personen}}', back: 'Zurück', sendNow: 'Jetzt senden', undoing: 'Wird zurückgenommen …', sending: 'Wird gesendet …',
    delivered: '{sent} von {total, number} zugestellt', deliveredLabel: '{sent, number} von {total, number} zugestellt', recalling: 'Die App wird gebeten, sie zurückzuholen',
    waitingMail: 'Warte auf die Mail-App', waitingApp: 'Warte auf die App', sentTo: 'An {count, plural, one {# Person} other {# Personen}} gesendet', approved: 'Freigegeben',
    handedOff: ' · zum Senden an die App übergeben', noAskAgain: ' · Künftige E-Mails an diese Liste fragen nicht mehr', undoFor: 'Rückgängig noch {n, number} s möglich', deliveredDone: 'Zugestellt',
    sentToApp: 'An die App übergeben', undoSend: 'Senden rückgängig', startOver: 'Neu beginnen', undone: 'Senden rückgängig gemacht',
    undoneSub: 'Bei {count, plural, one {# Empfänger} other {# Empfängern}} ist nichts angekommen. Der Entwurf ist gespeichert.', undoFailed: 'Rückgängig fehlgeschlagen',
    undoFailedSub: 'Die App konnte sie nicht zurückholen, sie wurde also womöglich schon zugestellt.', notSent: 'Nicht gesendet',
    failedSub: 'Die App hat ein Problem gemeldet. Keine Zustellung wurde bestätigt.', deniedSub: 'Du hast abgelehnt, und die App wurde angewiesen, diese E-Mail nicht zu senden.',
    undoAction: 'Rückgängig', backToRequest: 'Zurück zur Anfrage',
  },
  ar: {
    defaultTitle: 'إرسال بريد إلكتروني', asking: 'المساعد يطلب الإذن · الآن', needsApproval: 'بحاجة إلى موافقة', subject: 'الموضوع', messageField: 'الرسالة',
    alwaysAllow: 'السماح دائمًا بالرسائل إلى هذه القائمة', deny: 'رفض', editDraft: 'تعديل المسودة', allowSend: 'السماح والإرسال', editTitle: 'التعديل قبل الإرسال',
    toList: 'إلى {list} · {count, plural, one {شخص واحد} two {شخصان} few {# أشخاص} many {# شخصًا} other {# شخص}}', back: 'رجوع', sendNow: 'إرسال الآن', undoing: 'جارٍ التراجع…', sending: 'جارٍ الإرسال…',
    delivered: 'سُلّمت {sent} من {total, number}', deliveredLabel: 'سُلّمت {sent, number} من {total, number}', recalling: 'نطلب من التطبيق استرجاعها',
    waitingMail: 'في انتظار تطبيق البريد', waitingApp: 'في انتظار التطبيق', sentTo: 'أُرسلت إلى {count, plural, one {شخص واحد} two {شخصين} few {# أشخاص} many {# شخصًا} other {# شخص}}', approved: 'تمت الموافقة',
    handedOff: ' · سُلّمت إلى التطبيق لإرسالها', noAskAgain: ' · لن يُطلب الإذن مجددًا للرسائل إلى هذه القائمة', undoFor: 'يمكن التراجع خلال {n, number} ث', deliveredDone: 'تم التسليم',
    sentToApp: 'أُرسلت إلى التطبيق', undoSend: 'التراجع عن الإرسال', startOver: 'البدء من جديد', undone: 'تم التراجع عن الإرسال',
    undoneSub: 'لم يصل شيء إلى {count, plural, one {المستلم} two {المستلمَين} few {# مستلمين} many {# مستلمًا} other {# مستلم}}. المسودة محفوظة.', undoFailed: 'تعذّر التراجع',
    undoFailedSub: 'لم يتمكن التطبيق من استرجاعها، فربما سُلّمت بالفعل.', notSent: 'لم تُرسل',
    failedSub: 'أبلغ التطبيق عن مشكلة. لم يُؤكَّد تسليم أي شيء.', deniedSub: 'لقد رفضت، وأُبلغ التطبيق بعدم إرسال هذه الرسالة.',
    undoAction: 'تراجع', backToRequest: 'العودة إلى الطلب',
  },
})

type PermState = 'ask' | 'edit' | 'sending' | 'sent' | 'failed' | 'undoing' | 'undone' | 'undo-failed' | 'denied'
/** What PermissionRequest's onDecide may return: a promise that settles when the host finished (false or a rejection = it failed). */
export type PermissionOutcome = void | boolean | Promise<void | boolean>
function PermResult({ icon, tone, title, sub }: { icon: ReactNode; tone: 'ok' | 'muted'; title: ReactNode; sub: ReactNode }) {
  return (
    <div className="flex items-start gap-3 p-3">
      <motion.span initial={{ scale: 0.6 }} animate={{ scale: 1 }} transition={spring(0.5, 0.45)}
        className={cn('grid h-9 w-9 flex-none place-items-center rounded-[var(--r-md)]', tone === 'ok' ? 'bg-[var(--ok-soft)] text-[var(--ok)]' : 'bg-[var(--muted)] text-[var(--fg2)]')}>{icon}</motion.span>
      <div className="min-w-0 flex-1"><div className="text-sm leading-tight font-semibold">{title}</div><div className="mt-0.5 text-xs text-[var(--fg3)]">{sub}</div></div>
    </div>
  )
}
const AI_NO_RECIPIENTS: string[] = [], AI_EMPTY_DRAFT = { subject: '', body: '' }
const permActs = 'flex items-center gap-1.5 border-t border-[var(--line)] bg-[color-mix(in_srgb,var(--muted)_45%,var(--card))] p-3'
// on phones the decision buttons stack full width, primary on top (44px on touch)
const permStack = 'max-sm:flex-col-reverse max-sm:items-stretch max-sm:[&>span]:hidden [@media(pointer:coarse)]:[&>button]:min-h-11'

/**
 * Ask before acting: say what, to whom, and why. Preview the payload (`recipients`, `total`, `list` and the `draft`), edit the draft,
 * then Allow or Deny. The host does the work: `onDecide(allowed, always, draft)` gets the draft as edited, and may
 * return a promise that settles when sending finished (false or a rejection shows "Not sent"). Pass `progress`
 * ({ sent, total }) to show "n of 12 delivered" while it runs. With `onUndo`, a countdown ring offers Undo for
 * `undoSeconds`; "Nothing reached the recipients" is shown only when onUndo resolves true. Every state swap animates height.
 */
export function PermissionRequest({ title, app = 'inbox', reason, recipients = AI_NO_RECIPIENTS, total = recipients.length, list = '', draft: initialDraft = AI_EMPTY_DRAFT,
  undoSeconds = 10, onDecide, onUndo, progress, className }:
  { title?: string; app?: IconName; reason: ReactNode; recipients?: string[]; total?: number; list?: string; draft?: { subject: string; body: string }; undoSeconds?: number
    onDecide?: (allowed: boolean, always: boolean, draft: { subject: string; body: string }) => PermissionOutcome
    onUndo?: () => Promise<boolean>; progress?: { sent: number; total: number }; className?: string }) {
  const [state, setState] = useState<PermState>('ask')
  const t = useMessages(AI_PERMISSION_MESSAGES), { fmt } = useLocale()
  const [draft, setDraft] = useState(initialDraft)
  const [always, setAlways] = useState(false)
  const [preview, setPreview] = useState(false)
  const [left, setLeft] = useState(undoSeconds)
  const [confirmed, setConfirmed] = useState(false) // the host said it finished (promise resolved, or progress complete)
  const [settled, setSettled] = useState(false) // onDecide's promise (if any) has resolved
  const gen = useRef(0)
  const sent = Math.min(progress?.sent ?? 0, progress?.total ?? total), of = progress?.total ?? total
  const finish = (ok: boolean, sure: boolean) => { if (!ok) { setState('failed'); return } setConfirmed(sure); setLeft(undoSeconds); setState('sent') }
  const send = async () => {
    const g = ++gen.current; setState('sending'); setSettled(false)
    let out: PermissionOutcome
    try { out = onDecide?.(true, always, draft) } catch { finish(false, false); return }
    if (out && typeof (out as Promise<unknown>).then === 'function') {
      let r: void | boolean
      try { r = await out } catch { if (g === gen.current) finish(false, false); return }
      if (g !== gen.current) return
      if (r === false) return finish(false, false)
      if (!progress || progress.sent >= progress.total) finish(true, true); else setSettled(true)
    } else if (out === false) finish(false, false)
    else if (!progress) finish(true, false) // the host returned nothing to wait on: don't claim delivery
    else setSettled(true)
  }
  useEffect(() => { // with progress: done when every item is reported (and onDecide's promise, if any, resolved)
    if (state === 'sending' && settled && progress && progress.sent >= progress.total) finish(true, true)
  }, [state, settled, progress?.sent, progress?.total]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (state !== 'sent' || !onUndo || left <= 0) return
    const t = setTimeout(() => setLeft(l => l - 1), 1000); return () => clearTimeout(t)
  }, [state, left, onUndo])
  const undo = async () => {
    if (!onUndo) return
    const g = ++gen.current; setState('undoing')
    let ok = false; try { ok = (await onUndo()) === true } catch { ok = false }
    if (g === gen.current) setState(ok ? 'undone' : 'undo-failed')
  }
  const reset = () => { gen.current++; setState('ask'); setPreview(false) }
  const C = 2 * Math.PI * 8
  let body: ReactNode
  if (state === 'ask') body = (
    <div>
      <div className="p-3">
        <div className="flex items-start gap-3">
          <span className="grid h-9 w-9 flex-none place-items-center rounded-[var(--r-md)] bg-[var(--muted)]"><Icon name={app} size={18} /></span>
          <div className="min-w-0 flex-1"><div className="text-sm leading-tight font-semibold">{title ?? t('defaultTitle')}</div><div className="mt-0.5 text-xs text-[var(--fg3)]">{t('asking')}</div></div>
          <Badge tone="warn">{t('needsApproval')}</Badge>
        </div>
        <div className="mt-3 flex items-start gap-2 rounded-[var(--r-md)] bg-[var(--muted)] px-2.5 py-2 text-xs leading-snug text-[var(--fg2)]"><Icon name="info" size={14} className="mt-px text-[var(--fg3)]" /><span>{reason}</span></div>
        <button aria-expanded={preview} onClick={() => setPreview(!preview)}
          className={cn(surface.md, 'mt-3 flex w-full cursor-pointer items-center gap-2.5 p-2 text-start text-[13px] hover:border-[var(--line2)]')}>
          <span className="flex flex-none">{recipients.slice(0, 3).map((n, i) => <Avatar key={n} name={n} size={24} className={cn('[@media(pointer:coarse)]:!h-7 [@media(pointer:coarse)]:!w-7 [@media(pointer:coarse)]:!text-[11px]', i ? '-ms-2' : '')} />)}
            {total > 3 && <span className="-ms-2 grid h-6 w-6 place-items-center rounded-full border-2 border-[var(--card)] bg-[var(--muted)] text-[11px] font-semibold text-[var(--fg2)] [@media(pointer:coarse)]:h-7 [@media(pointer:coarse)]:w-7 [@media(pointer:coarse)]:text-[11px]">+{fmt.number(total - 3)}</span>}</span>
          <span className="min-w-0 flex-1 truncate max-sm:whitespace-normal"><b className="font-medium">{list}</b> <span dir="auto" className="text-xs text-[var(--fg3)]">· “{draft.subject}”</span></span>
          <motion.span className="grid text-[var(--fg3)]" animate={{ rotate: preview ? 180 : 0 }}><Icon name="chevronDown" size={12} strokeWidth={2.5} /></motion.span>
        </button>
        <Collapse open={preview}>
          <div className="mt-2 rounded-[var(--r-md)] border border-[var(--line)] bg-[var(--bg)] p-3 text-[13px]">
            <span className="text-[11px] text-[var(--fg3)]">{t('subject')}</span><b dir="auto" className="block font-medium">{draft.subject}</b>
            <p dir="auto" className="m-0 mt-2 leading-relaxed whitespace-pre-wrap text-[var(--fg2)]">{draft.body}</p>
          </div>
        </Collapse>
        <div className="mt-3"><Checkbox checked={always} onChange={setAlways}><span className="text-xs text-[var(--fg2)]">{t('alwaysAllow')}</span></Checkbox></div>
      </div>
      <div className={cn(permActs, permStack)}>
        <Button size="sm" variant="ghost" onClick={() => { setState('denied'); onDecide?.(false, false, draft) }}>{t('deny')}</Button><span className="flex-1" />
        <Button size="sm" onClick={() => setState('edit')}>{t('editDraft')}</Button><Button size="sm" variant="primary" onClick={send}>{t('allowSend')}</Button>
      </div>
    </div>
  )
  else if (state === 'edit') body = (
    <form onSubmit={e => { e.preventDefault(); send() }}>
      <div className="p-3">
        <div className="flex items-start gap-3">
          <span className="grid h-9 w-9 flex-none place-items-center rounded-[var(--r-md)] bg-[var(--muted)]"><Icon name={app} size={18} /></span>
          <div><div className="text-sm leading-tight font-semibold">{t('editTitle')}</div><div className="mt-0.5 text-xs text-[var(--fg3)]">{t('toList', { list, count: total })}</div></div>
        </div>
        <label className="mt-3 mb-1 block text-xs font-medium">{t('subject')}
          <input autoFocus dir="auto" value={draft.subject} onChange={e => setDraft({ ...draft, subject: e.target.value })} className={cn(inputClass, 'mt-1 !h-8 text-xs font-normal [@media(pointer:coarse)]:!h-10', TOUCH.input)} /></label>
        <label className="mt-2.5 block text-xs font-medium">{t('messageField')}
          <textarea rows={4} dir="auto" value={draft.body} onChange={e => setDraft({ ...draft, body: e.target.value })} className={cn(inputClass, '!h-auto mt-1 resize-none py-2 text-xs leading-normal font-normal', TOUCH.input)} /></label>
      </div>
      <div className={cn(permActs, permStack)}>
        <Button size="sm" variant="ghost" onClick={() => setState('ask')}>{t('back')}</Button><span className="flex-1" />
        <Button size="sm" variant="primary" type="submit" disabled={!draft.subject.trim()}>{t('sendNow')}</Button>
      </div>
    </form>
  )
  else if (state === 'sending' || state === 'undoing') body = (
    <div className="flex items-start gap-3 p-3">
      <span className="grid h-9 w-9 flex-none place-items-center rounded-[var(--r-md)] bg-[var(--muted)]"><Spinner /></span>
      <div className="flex-1"><div className="text-sm font-semibold">{state === 'undoing' ? t('undoing') : t('sending')}</div>
        {state === 'sending' && progress ? <>
          <div className="mt-0.5 flex items-center gap-1 text-xs text-[var(--fg3)]">{(([a, b]) => <>{a}<AnimatedNumber value={sent} locale={fmt.locale} />{b}</>)(aiAround(t('delivered', { sent: AI_SLOT, total: of })))}</div>
          <Progress value={sent} max={of} label={t('deliveredLabel', { sent, total: of })} className="mt-2.5" /></>
          : <div className="mt-0.5 text-xs text-[var(--fg3)]">{state === 'undoing' ? t('recalling') : app === 'inbox' ? t('waitingMail') : t('waitingApp')}</div>}</div>
    </div>
  )
  else if (state === 'sent') body = (
    <div>
      <PermResult tone="ok" title={confirmed ? t('sentTo', { count: of }) : t('approved')} sub={<><span dir="auto">“{draft.subject}”</span>{!confirmed && t('handedOff')}{always && t('noAskAgain')}</>}
        icon={<CheckMark size={18} strokeWidth={3} draw delay={0.1} duration={0.4} />} />
      <div className={permActs}>
        {onUndo && <svg width="16" height="16" viewBox="0 0 20 20" className="flex-none" aria-hidden>
          <circle cx="10" cy="10" r="8" fill="none" stroke="var(--line)" strokeWidth="2.5" />
          <motion.circle cx="10" cy="10" r="8" fill="none" stroke="var(--fg2)" strokeWidth="2.5" strokeLinecap="round" strokeDasharray={C} transform="rotate(-90 10 10)"
            initial={{ strokeDashoffset: 0 }} animate={{ strokeDashoffset: C * (1 - left / undoSeconds) }} transition={{ duration: 1, ease: 'linear' }} />
        </svg>}
        <span className="text-xs tabular-nums text-[var(--fg3)]" aria-live="polite">{onUndo && left > 0 ? t('undoFor', { n: left }) : confirmed ? t('deliveredDone') : t('sentToApp')}</span><span className="flex-1" />
        {onUndo && left > 0 ? <Button size="sm" onClick={undo}>{t('undoSend')}</Button> : <Button size="sm" onClick={reset}>{t('startOver')}</Button>}
      </div>
    </div>
  )
  else body = (
    <div>
      {state === 'undone' ? <PermResult tone="muted" icon={<Icon name="undo" size={18} strokeWidth={2.5} className="ui-flip" />} title={t('undone')} sub={t('undoneSub', { count: of })} />
        : state === 'undo-failed' ? <PermResult tone="muted" icon={<Icon name="info" size={18} strokeWidth={2.5} />} title={t('undoFailed')} sub={t('undoFailedSub')} />
        : state === 'failed' ? <PermResult tone="muted" icon={<Icon name="x" size={18} strokeWidth={2.5} />} title={t('notSent')} sub={t('failedSub')} />
        : <PermResult tone="muted" icon={<Icon name="x" size={18} strokeWidth={2.5} />} title={t('notSent')} sub={t('deniedSub')} />}
      <div className={permActs}><span className="flex-1" /><Button size="sm" onClick={reset}>{state === 'denied' ? t('undoAction') : t('backToRequest')}</Button></div>
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

/**
 * A source an answer used: one model for inline citations (Citation), source chips (SourceList) and the sources panel
 * (SourcesPanel). `url` links it (http(s), mailto or relative; anything else becomes #). `domain` is the short label
 * under the title (a site, an app, a channel; default: the URL's host). `snippet` is what was read (previews and
 * expanded cards). `letter` and `color` style its tile (default: the title's first letter on the accent).
 */
export type Source = { title: string; url?: string; domain?: string; snippet?: string; letter?: string; color?: string }
/** Source chips', citations' and SourcesPanel's strings. */
export const AI_SOURCE_MESSAGES = defineMessages('aiSource', {
  en: { source: 'Source {n, number}: {title}' },
  de: { source: 'Quelle {n, number}: {title}' },
  ar: { source: 'المصدر {n, number}: {title}' },
})
/** Host name of a source link; relative or malformed URLs show as written instead of throwing. */
const aiHost = (url: string) => { try { return new URL(url).hostname || url } catch { return url } }
/** A source's short label: its `domain`, else its URL's host. */
export const sourceDomain = (s: Source) => s.domain ?? (s.url ? aiHost(s.url) : '')
/** A source's tile: its letter on its colour, darkened to `shade` % (the rest black) so white text reads on any colour:
 * at most about 62 keeps 11px white text at 4.5:1 or more, also on the dark theme's lighter accent. */
function AiSourceTile({ s, shade, className }: { s: Source; shade: number; className: string }) {
  return <span className={cn('grid flex-none place-items-center text-[11px] font-bold text-white [@media(pointer:coarse)]:text-[11px]', className)}
    style={{ background: `color-mix(in srgb, ${safeColor(s.color, 'var(--accent)')} ${shade}%, #000)` }}>{s.letter ?? s.title[0]}</span>
}

/** Source chips under an answer: tile, title and domain, numbered, each a link when it has a `url`. */
export function SourceList({ sources, className }: { sources: Source[]; className?: string }) {
  const { fmt } = useLocale()
  return (
    <div className={cn('flex flex-wrap gap-1.5', className)}>
      {sources.map((s, i) => (
        <a key={i + s.title} href={safeUrl(s.url ?? '#ai')} target={s.url && /^https?:/i.test(safeUrl(s.url)) ? '_blank' : undefined} rel="noopener noreferrer" className={cn(surface.md, 'flex items-center gap-2 py-1.5 pe-2.5 ps-1.5 text-xs text-[var(--fg)] no-underline hover:border-[var(--fg3)]')}>
          <AiSourceTile s={s} shade={62} className="h-[22px] w-[22px] rounded-[var(--r-md)]" />
          <span><b dir="auto" className="block font-medium">{s.title}</b><span dir="ltr" className="text-[var(--fg3)]">{sourceDomain(s)}</span></span>
          <span className="ms-1 font-[family-name:var(--mono)] text-[11px] font-semibold text-[var(--fg3)] [@media(pointer:coarse)]:text-[11px]">{fmt.number(i + 1)}</span>
        </a>
      ))}
    </div>
  )
}
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
  const id = useId(), t = useMessages(AI_SOURCE_MESSAGES), { fmt, dir } = useLocale(), rtl = dir === 'rtl'
  const close = () => { setPinned(false); setOpen(false) }
  useOutside([ref], close, pinned, { escape: true })
  useLayoutEffect(() => {
    if (!shown || !ref.current) return
    // clientWidth, not innerWidth: on phones innerWidth grows with anything that overflows (including this card)
    const vw = document.documentElement.clientWidth || innerWidth
    const r = ref.current.getBoundingClientRect(), w = Math.min(250, vw - 16), h = panel.current?.offsetHeight ?? 110
    // the card starts at the button's start edge (left in LTR, right in RTL) and slides to stay 8px inside the screen
    setPos({ w, up: r.top > h + 16, dx: rtl ? Math.max(r.right - vw + 8, Math.min(0, r.right - w - 8)) : Math.max(8 - r.left, Math.min(0, vw - 8 - (r.left + w))) })
  }, [shown, rtl])
  return (
    <span ref={ref} className={cn('relative inline-block', className)} {...bind} onKeyDown={e => { if (e.key === 'Escape' && shown) { e.stopPropagation(); close() } }}>
      <button type="button" aria-expanded={shown} aria-describedby={shown ? id : undefined} aria-label={t('source', { n, title: source.title })}
        {...tap} onPointerDown={e => { pointer.current = e.pointerType }}
        onClick={() => { if (pointer.current === 'touch') return; const v = !pinned; setPinned(v); setOpen(v) }}
        className={cn('mx-0.5 inline-grid h-4 min-w-4 cursor-pointer place-items-center rounded-[var(--r-sm)] border-0 bg-[var(--muted)] px-1 align-[2px] text-[11px] font-semibold text-[var(--fg2)] hover:bg-[var(--accent-soft)] hover:text-[var(--accent)] aria-expanded:bg-[var(--accent-soft)] aria-expanded:text-[var(--accent)] [@media(pointer:coarse)]:text-[11px]', TOUCH.hit)}>{fmt.number(n)}</button>
      <AnimatePresence>
        {shown && (
          <motion.span ref={panel} id={id} role="tooltip" initial={{ opacity: 0, y: pos.up ? 4 : -4, scale: 0.97 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, scale: 0.97, transition: { duration: 0.12 } }} transition={spring(0.25, 0.3)}
            style={rtl ? { right: pos.dx, width: pos.w } : { left: pos.dx, width: pos.w }} /* rtl-lint-ignore: measured in px from the start edge */ className={cn(floatingSurface, 'absolute z-50 block p-3 text-start text-[13px] leading-snug', pos.up ? 'bottom-[calc(100%+6px)]' : 'top-[calc(100%+6px)]')}>
            <span className="mb-1 flex min-w-0 items-center gap-1.5 text-xs text-[var(--fg3)]"><Icon name="globe" size={12} /><span dir="ltr" className="truncate">{sourceDomain(source)}</span></span>
            <b dir="auto" className="block font-medium">{source.title}</b>
            {source.snippet && <span dir="auto" className="mt-1 block text-xs text-[var(--fg2)]">{source.snippet}</span>}
          </motion.span>
        )}
      </AnimatePresence>
    </span>
  )
}

/** GhostTextInput, SuggestedEdit, ConfidenceField, VoiceInput and ModelComparison strings. */
export const AI_ASSIST_MESSAGES = defineMessages('aiAssist', {
  en: {
    ghostLabel: 'Message with suggestions', pressTab: 'Press {key} or click to accept', tapAccept: 'Tap to accept:', ghostHint: 'Suggestions appear as you type',
    makeConcise: 'Make it concise', rewriting: 'Rewriting…', accept: 'Accept', reject: 'Reject', diffCounts: '{removed, number} removed, {added, number} added', applied: 'Applied', undoAction: 'Undo',
    likely: 'likely', sure: '{pct} sure. Please check.', check: 'Check', whichRight: 'Which is right?', pctSure: '· {pct} sure', choose: 'Choose {label}',
    stopListening: 'Stop listening', startListening: 'Start listening', listening: 'Listening… tap to stop', tapToTalk: 'Tap to talk',
    prompt: 'Prompt', run: 'Run', runAgain: 'Run again', thinking: 'Thinking…', streaming: 'Streaming', markBest: 'Mark {name} as best', voted: 'Vote recorded',
    wins: '{name} wins this round', firstToken: 'first token', tokPerSec: 'tok/s', secs: '{s}s', pressRun: 'Press Run to stream them all.',
  },
  de: {
    ghostLabel: 'Nachricht mit Vorschlägen', pressTab: '{key} drücken oder klicken zum Übernehmen', tapAccept: 'Zum Übernehmen tippen:', ghostHint: 'Vorschläge erscheinen beim Tippen',
    makeConcise: 'Kürzer fassen', rewriting: 'Wird umgeschrieben …', accept: 'Übernehmen', reject: 'Verwerfen', diffCounts: '{removed, number} entfernt, {added, number} hinzugefügt', applied: 'Übernommen', undoAction: 'Rückgängig',
    likely: 'wahrscheinlich', sure: '{pct} sicher. Bitte prüfen.', check: 'Prüfen', whichRight: 'Was stimmt?', pctSure: '· {pct} sicher', choose: '{label} wählen',
    stopListening: 'Zuhören beenden', startListening: 'Zuhören starten', listening: 'Hört zu … zum Beenden tippen', tapToTalk: 'Zum Sprechen tippen',
    prompt: 'Prompt', run: 'Ausführen', runAgain: 'Erneut ausführen', thinking: 'Denkt nach …', streaming: 'Streamt', markBest: '{name} als beste markieren', voted: 'Stimme gezählt',
    wins: '{name} gewinnt diese Runde', firstToken: 'erstes Token', tokPerSec: 'Tok./s', secs: '{s} s', pressRun: 'Auf „Ausführen“ drücken, um alle zu streamen.',
  },
  ar: {
    ghostLabel: 'رسالة مع اقتراحات', pressTab: 'اضغط {key} أو انقر للقبول', tapAccept: 'انقر للقبول:', ghostHint: 'تظهر الاقتراحات أثناء الكتابة',
    makeConcise: 'اجعله موجزًا', rewriting: 'جارٍ إعادة الصياغة…', accept: 'قبول', reject: 'رفض', diffCounts: 'حُذف {removed, number}، وأُضيف {added, number}', applied: 'تم التطبيق', undoAction: 'تراجع',
    likely: 'الأرجح', sure: 'متأكد بنسبة {pct}. يُرجى التحقق.', check: 'تحقّق', whichRight: 'أيهما الصحيح؟', pctSure: '· متأكد بنسبة {pct}', choose: 'اختر {label}',
    stopListening: 'إيقاف الاستماع', startListening: 'بدء الاستماع', listening: 'يستمع… انقر للإيقاف', tapToTalk: 'انقر للتحدث',
    prompt: 'الطلب', run: 'تشغيل', runAgain: 'تشغيل مجددًا', thinking: 'يفكّر…', streaming: 'يبث', markBest: 'اختيار {name} كأفضل إجابة', voted: 'تم تسجيل التصويت',
    wins: '{name} يفوز بهذه الجولة', firstToken: 'أول رمز', tokPerSec: 'رمز/ث', secs: '{s} ث', pressRun: 'اضغط «تشغيل» لبث الإجابات كلها.',
  },
})

/**
 * Inline completion: the rest of the best-matching suggestion shows in grey after what you typed; Tab accepts it
 * (with a small bump). The hint line under it is a button too, so a tap accepts on touch screens. Pass `suggestions`, or a `suggest(text)` function.
 */
export function GhostTextInput({ suggestions, suggest, placeholder, value, defaultValue = '', onChange, className }:
  { suggestions?: string[]; suggest?: (text: string) => string | null; placeholder?: string; value?: string; defaultValue?: string; onChange?: (v: string) => void; className?: string }) {
  const [v, setV] = useControllable(value, defaultValue, onChange)
  const [bump, setBump] = useState(0)
  const t = useMessages(AI_ASSIST_MESSAGES)
  const full = !v ? null : suggestions ? suggestions.find(s => s.toLowerCase().startsWith(v.toLowerCase()) && s.length > v.length) ?? null : (() => { const r = suggest?.(v); return r ? v + r : null })()
  const rest = full ? full.slice(v.length) : null
  const accept = () => { if (full) { setV(full); setBump(b => b + 1) } }
  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      <motion.div key={bump} animate={bump ? { scale: [1.02, 1] } : undefined} transition={spring(0.4, 0.3)} className="relative">
        <div aria-hidden className="pointer-events-none absolute inset-0 flex items-center overflow-hidden border border-transparent px-3 text-[13px] whitespace-pre [@media(pointer:coarse)]:text-base">
          <span className="invisible">{v}</span><span className="text-[var(--fg3)]">{rest}</span>
        </div>
        <input value={v} placeholder={placeholder} onChange={e => setV(e.target.value)} aria-label={t('ghostLabel')} autoComplete="off"
          onKeyDown={e => { if (e.key === 'Tab' && full) { e.preventDefault(); accept() } }} className={cn(inputClass, 'relative !bg-transparent [@media(pointer:coarse)]:!h-11', TOUCH.input)} />
      </motion.div>
      <span className="flex min-h-6 items-center text-xs text-[var(--fg3)]" aria-live="polite">{rest
        ? <button type="button" onMouseDown={e => e.preventDefault()} onClick={accept}
            className="-mx-1.5 inline-flex min-h-6 min-w-0 cursor-pointer items-center gap-1.5 rounded-[var(--r-md)] border-0 bg-transparent px-1.5 text-start text-xs text-[var(--fg3)] hover:bg-[var(--muted)] hover:text-[var(--fg)] [@media(pointer:coarse)]:min-h-9 [@media(pointer:coarse)]:bg-[var(--muted)] [@media(pointer:coarse)]:text-[var(--fg2)]">
            <span className="[@media(pointer:coarse)]:hidden">{(([a, b]) => <>{a}<Kbd>{AI_TAB}</Kbd>{b}</>)(aiAround(t('pressTab', { key: AI_SLOT })))}</span>
            <span className="hidden min-w-0 truncate [@media(pointer:coarse)]:inline">{t('tapAccept')} <b className="font-medium text-[var(--fg)]">{full}</b></span>
          </button>
        : t('ghostHint')}</span>
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
export function SuggestedEdit({ before, after, action, onResolve, className }: { before: string; after: string; action?: string; onResolve?: (accepted: boolean) => void; className?: string }) {
  const [state, setState] = useState<'idle' | 'rewriting' | 'review' | 'applied'>('idle')
  const t = useMessages(AI_ASSIST_MESSAGES)
  const segs = wordDiff(before, after)
  const dels = segs.filter(s => s.t === '-').length, ins = segs.filter(s => s.t === '+').length
  const go = async () => { setState('rewriting'); await sleep(800); setState('review') }
  let n = 0
  return (
    <div className={cn('flex flex-col gap-2.5', className)}>
      <motion.p key={state === 'applied' ? 'a' : 'b'} animate={state === 'applied' ? { scale: [0.98, 1] } : undefined} transition={spring(0.4, 0.35)}
        dir="auto" className="m-0 rounded-[var(--r-md)] bg-[var(--muted)] px-3 py-2.5 text-[13px] leading-[1.75]">
        {state === 'review' ? segs.map((s, k) => s.t === '=' ? <span key={k}>{s.text}</span> : (
          <motion.span key={k} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.25, delay: n++ * 0.12 }}
            className={s.t === '-' ? 'bg-[var(--bad-soft)] text-[var(--bad)] line-through' : 'bg-[var(--ok-soft)] text-[var(--ok)]'}>{s.text}</motion.span>
        )) : state === 'applied' ? after : before}
      </motion.p>
      <div className="flex min-h-[30px] flex-wrap items-center gap-2">
        {state === 'idle' && <Button size="sm" variant="primary" onClick={go}>{action ?? t('makeConcise')}</Button>}
        {state === 'rewriting' && <ShimmerText className="text-xs">{t('rewriting')}</ShimmerText>}
        {state === 'review' && <>
          <Button size="sm" variant="primary" onClick={() => { setState('applied'); onResolve?.(true) }}>{t('accept')}</Button>
          <Button size="sm" onClick={() => { setState('idle'); onResolve?.(false) }}>{t('reject')}</Button>
          <span className="text-xs text-[var(--fg3)]">{t('diffCounts', { removed: dels, added: ins })}</span></>}
        {state === 'applied' && <>
          <motion.span initial={{ scale: 0.6 }} animate={{ scale: 1 }} transition={spring(0.5, 0.35)}><Badge tone="ok"><Icon name="check" size={11} strokeWidth={3} />{t('applied')}</Badge></motion.span>
          <Button size="sm" variant="ghost" onClick={() => setState('idle')}>{t('undoAction')}</Button></>}
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
  const t = useMessages(AI_ASSIST_MESSAGES), { fmt, dir } = useLocale()
  useOutside([ref], () => setOpen(false), open)
  const low = confidence < threshold && chosen === null
  const choices = options ?? [value]
  const pick = (v: string) => { setChosen(v); setOpen(false); onResolve?.(v) }
  const roving = useRoving(choices.length, i => pick(choices[i]))
  const opts: Option[] = choices.map((c, i) => ({ value: c, label: c, hint: i === 0 ? t('likely') : undefined }))
  const pct = fmt.percent(Math.round(confidence * 100) / 100)
  return (
    <div className={cn('flex items-center justify-between gap-3 border-b border-[var(--line)] py-2 text-[13px] last:border-0', className)}>
      <span className="text-[var(--fg2)]">{label}</span>
      {low ? (
        <div ref={ref} className="relative">
          <Tooltip content={t('sure', { pct })}>
            <button type="button" aria-haspopup="listbox" aria-expanded={open} aria-controls={open ? id : undefined} aria-activedescendant={open ? `${id}-${roving.active}` : undefined}
              onClick={() => { if (choices.length < 2) return pick(choices[0]); roving.setActive(0); setOpen(!open) }}
              onKeyDown={e => {
                if (!open) { if (e.key === 'ArrowDown' && choices.length > 1) { e.preventDefault(); roving.setActive(0); setOpen(true) } return }
                if (e.key === 'Escape') { e.stopPropagation(); setOpen(false) } else if (e.key === 'Tab') setOpen(false); else roving.onKeyDown(e)
              }}
              className="inline-flex cursor-pointer items-center gap-1 rounded-[var(--r-md)] border-0 bg-[var(--warn-soft)] px-2 py-0.5 text-xs text-[color-mix(in_srgb,var(--warn)_66%,var(--fg))] [@media(pointer:coarse)]:min-h-8">
              <Icon name="alert" size={12} />{prompt ?? t('check')}</button>
          </Tooltip>
          <FloatingPanel open={open} placement="bottom-end" role="presentation" className="min-w-[190px]">
            <MenuLabel>{t('whichRight')} <span className="tabular-nums">{t('pctSure', { pct })}</span></MenuLabel>
            <OptionList id={id} options={opts} active={roving.active} isSelected={() => false} onPick={i => pick(choices[i])} onHover={roving.setActive} label={t('choose', { label })} />
          </FloatingPanel>
        </div>
      ) : (
        <motion.span key={chosen ?? 'v'} initial={chosen ? { opacity: 0, x: dir === 'rtl' ? -6 : 6 } : false} animate={{ opacity: 1, x: 0 }} transition={spring(0.3, 0.3)} className="flex items-center gap-1.5 font-medium">
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
 * Feed it what your speech API heard so far as `transcript` (it reveals the words as they arrive); with none it just
 * listens and reports an empty result.
 */
export function VoiceInput({ transcript = '', listening: lc, onListeningChange, onResult, className }:
  { transcript?: string; listening?: boolean; onListeningChange?: (v: boolean) => void; onResult?: (text: string) => void; className?: string }) {
  const [listening, setListening] = useControllable(lc, false, onListeningChange)
  const t = useMessages(AI_ASSIST_MESSAGES)
  const [heard, setHeard] = useState(0)
  const [final, setFinal] = useState<string | null>(null)
  const words = transcript.split(' ').filter(Boolean)
  useEffect(() => {
    if (!listening) return
    setHeard(0); setFinal(null)
    const t = setInterval(() => setHeard(h => Math.min(words.length, h + 1)), 380)
    return () => clearInterval(t)
  }, [listening, words.length])
  const toggle = () => {
    if (listening) { const text = words.join(' '); setFinal(text || null); onResult?.(text) }
    setListening(!listening)
  }
  return (
    <div className={cn('flex flex-col gap-2', className)}>
      <div className="flex items-center gap-3">
        <span className="relative flex-none">
          {listening && <motion.span aria-hidden className="absolute inset-0 rounded-full bg-[var(--bad)]" initial={{ opacity: 0.5, scale: 1 }} animate={{ opacity: 0, scale: 1.7 }} transition={{ duration: 1.2, repeat: Infinity, ease: 'easeOut' }} />}
          <motion.span key={String(listening)} animate={{ scale: [1.1, 1] }} transition={spring(0.5, 0.3)} className="block">
            <Button variant={listening ? 'danger' : 'primary'} size="icon" aria-pressed={listening} aria-label={listening ? t('stopListening') : t('startListening')} onClick={toggle} className="!rounded-full">
              <Icon name={listening ? 'stop' : 'mic'} fill={listening ? 'currentColor' : 'none'} size={15} />
            </Button>
          </motion.span>
        </span>
        <Waveform peaks={listening ? AI_VOICE_BARS : AI_VOICE_FLAT} live={listening} played={listening ? 1 : 0} tone="ink" barWidth={3} minHeight={12.5} intro={false} className="h-8 min-w-0 flex-1 gap-1 overflow-hidden" />
      </div>
      <div className="min-h-[20px] text-[13px]" aria-live="polite">
        {listening ? <span className="text-[var(--fg3)]">{heard ? <>{words.slice(0, heard).join(' ')}<span className="ui-caret" /></> : t('listening')}</span>
          : final ? <motion.span initial={{ opacity: 0.4, filter: 'blur(2px)' }} animate={{ opacity: 1, filter: 'blur(0px)' }} transition={{ duration: 0.35 }} dir="auto" className="font-medium text-[var(--fg)]">“{final}”</motion.span>
          : <span className="text-xs text-[var(--fg3)]">{t('tapToTalk')}</span>}
      </div>
    </div>
  )
}

/* Sources panel ──────────────────────────────────────────────────────────── */

/**
 * Answer with numbered citations next to their source cards (stacked below on phones). Hovering or focusing either
 * side highlights both; tapping or clicking a citation opens its card with a nudge (scrolling it into view) and keeps
 * the pair highlighted; tapping a card expands it. Write `[1]` in `answer` for citation 1.
 */
export function SourcesPanel({ answer, sources, className }: { answer: string; sources: Source[]; className?: string }) {
  const [hov, setHot] = useState(-1), [pin, setPin] = useState(-1) // hover/focus highlight, and the last tapped pair
  const hot = hov >= 0 ? hov : pin
  const [open, setOpen] = useState<Set<number>>(new Set())
  const [nudge, setNudge] = useState<{ i: number; k: number }>({ i: -1, k: 0 })
  const toggle = (i: number, force?: boolean) => setOpen(o => { const n = new Set(o); if (force ?? !n.has(i)) n.add(i); else n.delete(i); return n })
  const hover = (i: number) => ({ onPointerEnter: (e: React.PointerEvent) => { if (e.pointerType === 'mouse') setHot(i) }, onPointerLeave: (e: React.PointerEvent) => { if (e.pointerType === 'mouse') setHot(-1) }, onFocus: () => setHot(i), onBlur: () => setHot(-1) })
  const parts = answer.split(/(\[\d+\])/)
  const t = useMessages(AI_SOURCE_MESSAGES), { fmt } = useLocale()
  return (
    <div className={cn('@container', className)}><div className="grid gap-3 @[560px]:grid-cols-[minmax(0,1fr)_280px]">
      <p dir="auto" className={cn(surface.card, 'm-0 px-4 py-3 text-sm leading-[1.8]')}>
        {parts.map((p, k) => {
          const m = p.match(/^\[(\d+)\]$/); if (!m) return <span key={k}>{p}</span>
          const i = Number(m[1]) - 1
          return <button key={k} {...hover(i)} aria-label={t('source', { n: i + 1, title: sources[i]?.title ?? '' })} onClick={() => { toggle(i, true); setPin(i); setNudge(n => ({ i, k: n.k + 1 })) }}
            className={cn('mx-0.5 inline-grid h-[17px] min-w-[17px] cursor-pointer place-items-center rounded-[var(--r-sm)] border-0 px-1 align-[1px] text-[11px] font-semibold transition-colors', TOUCH.hit,
              hot === i ? 'bg-[var(--accent)] text-[var(--card)]' : 'bg-[var(--muted)] text-[var(--fg2)]')}>{fmt.number(i + 1)}</button>
        })}
      </p>
      <div className="flex flex-col gap-2">
        {sources.map((s, i) => <AiSourceCardView key={i} s={s} n={i + 1} hot={hot === i} open={open.has(i)} nudge={nudge.i === i ? nudge.k : 0} bind={hover(i)} onToggle={() => { toggle(i); setPin(i) }} />)}
      </div>
    </div></div>
  )
}

function AiSourceCardView({ s, n, hot, open, nudge, bind, onToggle }:
  { s: Source; n: number; hot: boolean; open: boolean; nudge: number; bind: Record<string, (e: React.PointerEvent) => void>; onToggle: () => void }) {
  const [scope, animate] = useAnimate<HTMLDivElement>()
  const { fmt } = useLocale()
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
        <AiSourceTile s={s} shade={58} className="h-5 w-5 rounded-[var(--r-sm)]" />
        <div className="min-w-0"><b dir="auto" className="block truncate text-[13px] font-medium">{s.title}</b><div dir="ltr" className="text-start text-[11px] text-[var(--fg3)]">{sourceDomain(s)}</div></div>
        <span className="ms-auto font-[family-name:var(--mono)] text-[11px] font-semibold text-[var(--fg3)]">{fmt.number(n)}</span>
      </div>
      <Collapse open={open && !!s.snippet}><p dir="auto" className="m-0 pt-1.5 text-xs leading-normal text-[var(--fg2)]">{s.snippet}</p></Collapse>
    </div>
  )
}

/* Model comparison ───────────────────────────────────────────────────────── */

export type CompareModel = { name: string; tier: string; color: string; /** seconds before the first token */ firstToken: number; /** words per second while streaming */ speed: number; text: string; tps: number; cost: string }
type McState = { phase: 'idle' | 'thinking' | 'streaming' | 'done'; words: number }
/**
 * Same prompt, several models streamed side by side at their own speeds: thinking dots, first-token time, tokens/s
 * and cost. Vote for the best answer (a toast confirms). Run restarts all of them. `autoRun` starts the first run by
 * itself the first time the comparison scrolls into view.
 */
export function ModelComparison({ prompt, models, autoRun = false, className }: { prompt: string; models: CompareModel[]; autoRun?: boolean; className?: string }) {
  const toast = useToast()
  const t = useMessages(AI_ASSIST_MESSAGES), { fmt } = useLocale()
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
  const { ref: box, seen } = useViewport<HTMLDivElement>(null, { amount: 0.3 })
  const ran = useRef(false)
  useEffect(() => { if (autoRun && seen && !ran.current) { ran.current = true; run() } }, [autoRun, seen]) // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div ref={box} className={cn('flex flex-col gap-3', className)}>
      <div className={cn(surface.muted, 'flex flex-wrap items-center gap-2.5 px-3 py-2.5 text-[13px]')}>
        <span className="text-xs text-[var(--fg3)]">{t('prompt')}</span><b dir="auto" className="min-w-0 flex-1 basis-[200px] font-medium">{prompt}</b>
        {/* both labels share one cell, so the button keeps the width of the longer one */}
        <Button size="sm" variant="primary" onClick={run} className="max-sm:w-full"><span className="grid [&>*]:[grid-area:1/1]">
          <span aria-hidden className="invisible">{t('runAgain')}</span><span>{st.some(s => s.phase !== 'idle') ? t('runAgain') : t('run')}</span>
        </span></Button>
      </div>
      <div className={cn(surface.card, 'grid overflow-hidden md:grid-cols-3')}>
        {models.map((m, i) => {
          const s = st[i], started = s.phase === 'streaming' || s.phase === 'done'
          return (
            <motion.div key={m.name} animate={win === i ? { scale: [1, 1.02, 1] } : { scale: 1 }} transition={spring(0.5, 0.35)}
              className={cn('flex flex-col border-[var(--line)] md:min-h-[200px] transition-[box-shadow,background] max-md:[&+&]:border-t md:[&+&]:border-s',
                win === i && 'relative z-[1] bg-[color-mix(in_srgb,var(--ok)_6%,var(--card))] shadow-[inset_0_0_0_1.5px_var(--ok),0_0_0_3px_var(--ok-soft)]')}>
              <div className="flex items-start gap-2.5 px-3 pt-3 pb-1 text-[13px]">
                <i className="mt-1 h-2.5 w-2.5 flex-none rounded-[var(--r-sm)]" style={{ background: safeColor(m.color, 'var(--accent)') }} />
                <div className="min-w-0"><b className="block leading-tight">{m.name}</b><span className="text-[11px] text-[var(--fg3)]">{m.tier}</span></div>
                <span className="flex-1" />
                <span className="w-[60px] flex-none text-end text-[11px] leading-7 text-[var(--fg3)]">{s.phase === 'thinking' ? t('thinking') : s.phase === 'streaming' ? t('streaming') : ''}</span>
                <IconButton icon="thumbUp" label={t('markBest', { name: m.name })} aria-pressed={win === i} tone={win === i ? 'default' : 'muted'}
                  className={win === i ? '!bg-[var(--ok-soft)] text-[var(--ok)]' : ''}
                  onClick={() => { setWin(i); toast({ title: t('voted'), description: t('wins', { name: m.name }), tone: 'ok' }) }} />
              </div>
              <div className="flex gap-3 border-b border-[var(--line)] px-3 pb-2.5 text-[11px] text-[var(--fg3)]">
                {/* fixed-width tabular cells: the numbers arriving never push the labels */}
                <span><b className="inline-block min-w-[4ch] font-semibold tabular-nums text-[var(--fg)]">{started ? t('secs', { s: fmt.number(m.firstToken) }) : '–'}</b> {t('firstToken')}</span>
                <span><b className="inline-block min-w-[3.5ch] font-semibold tabular-nums text-[var(--fg)]">{s.phase === 'done' ? fmt.number(m.tps) : '–'}</b> {t('tokPerSec')}</span>
                <span><b className="inline-block min-w-[7ch] font-semibold tabular-nums text-[var(--fg)]">{s.phase === 'done' ? m.cost : '–'}</b></span>
              </div>
              {/* the full answer sits invisibly in the same grid cell, so streaming fills reserved space instead of growing the card */}
              <div dir="auto" className="grid flex-1 p-3 text-[13px] leading-relaxed [&>*]:[grid-area:1/1]">
                <span aria-hidden className="invisible">{m.text}</span>
                <div>
                  {s.phase === 'idle' ? <span className="text-xs text-[var(--fg3)]">{t('pressRun')}</span>
                    : s.phase === 'thinking' ? <TypingDots />
                    : <span className={cn(s.phase === 'streaming' && 'ui-caret')}>{m.text.split(' ').slice(0, s.words).join(' ')}</span>}
                </div>
              </div>
            </motion.div>
          )
        })}
      </div>
    </div>
  )
}
