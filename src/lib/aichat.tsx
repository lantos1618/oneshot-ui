import { Children, Fragment, createContext, isValidElement, useCallback, useContext, useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent as RKeyboardEvent, type ReactNode } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { Badge, Button, Chip, Icon, IconButton, Spinner, TOUCH, cn, defineMessages, floatingSurface, inputClass, menuItemClass, safeColor, sleep, spring, surface, useCoarsePointer, useControllable, useLocale, useMediaQuery, useMessages, useOutside, useRoving, type IconName, type Tone } from './core'
import { Collapse, CopyButton, TypingDots, confetti } from './feedback'
import { Checkbox, Slider, Switch } from './forms'
import { FloatingPanel, MenuItem, MenuLabel } from './overlay'
import { AttachmentChip, Citation, PromptInput, SendButton, SourceList, sourceDomain, ShimmerText, StreamingText, ToolCall, useAttachments, type Attachment } from './ai'
import { JsonViewer } from './data'
import { useVirtual } from './virtual'
import { Markdown, type MarkdownCodeRenderer } from './markdown'
import { markdownCodeBlock } from './code'
import { aiMessageText, type AiChat, type AiDataPart, type AiFilePart, type AiMessage, type AiSourcePart, type AiToolPart, type AiToolState } from './aistream'

/* ════════════════════════════════════════════════════════════════════════════
 * 11b. AI CHAT: rich assistant chat with generated UI parts, and the agent composer
 * Message parts render text as Markdown (code fences in a plain frame) and tool data as indented JSON unless you hand
 * them richer renderers (`AiRenderers`); `AI_RICH_RENDERERS` adds CodeBlock highlighting and JsonViewer. Keeping those
 * out of the components keeps each drop-in small. Chat bubbles sit on the inline end for the person and the start for the
 * assistant; every text block is dir="auto", so Arabic and English messages each read the right way.
 * ══════════════════════════════════════════════════════════════════════════ */

/** The conversation parts' strings (Conversation, Message, MessageParts, ToolCard, Reasoning, MessageActions, Suggestions). */
export const CHAT_PARTS_MESSAGES = defineMessages('chatParts', {
  en: {
    conversation: 'Conversation', jump: 'Jump to latest', suggestions: 'Suggestions', stopped: 'Stopped', good: 'Good response', bad: 'Bad response',
    regenerate: 'Regenerate', retry: 'Retry', thinking: 'Thinking…', secs: '{s}s', thoughtFor: 'Thought for {s}s', reasoning: 'Reasoning',
    approvalNeeded: 'Approval needed', approveQ: 'Approve this action?', demo: 'demo', to: 'To: {names}', deny: 'Deny', approve: 'Approve',
    preparing: 'Preparing', running: 'Running', needsApproval: 'Needs approval', done: 'Done', failed: 'Failed', denied: 'Denied',
    args: 'Arguments', result: 'Result', toolFailed: 'The tool failed.', error: 'Something went wrong', assistant: 'Assistant',
  },
  de: {
    conversation: 'Unterhaltung', jump: 'Zur neuesten Nachricht', suggestions: 'Vorschläge', stopped: 'Gestoppt', good: 'Gute Antwort', bad: 'Schlechte Antwort',
    regenerate: 'Neu erzeugen', retry: 'Erneut versuchen', thinking: 'Denkt nach …', secs: '{s} s', thoughtFor: '{s} s nachgedacht', reasoning: 'Gedankengang',
    approvalNeeded: 'Freigabe nötig', approveQ: 'Diese Aktion freigeben?', demo: 'Demo', to: 'An: {names}', deny: 'Ablehnen', approve: 'Freigeben',
    preparing: 'Wird vorbereitet', running: 'Läuft', needsApproval: 'Freigabe nötig', done: 'Fertig', failed: 'Fehlgeschlagen', denied: 'Abgelehnt',
    args: 'Argumente', result: 'Ergebnis', toolFailed: 'Das Werkzeug ist fehlgeschlagen.', error: 'Etwas ist schiefgelaufen', assistant: 'Assistent',
  },
  ar: {
    conversation: 'المحادثة', jump: 'الانتقال إلى الأحدث', suggestions: 'اقتراحات', stopped: 'توقّف', good: 'إجابة جيدة', bad: 'إجابة سيئة',
    regenerate: 'إعادة التوليد', retry: 'إعادة المحاولة', thinking: 'يفكّر…', secs: '{s} ث', thoughtFor: 'فكّر لمدة {s} ث', reasoning: 'التفكير',
    approvalNeeded: 'بحاجة إلى موافقة', approveQ: 'هل توافق على هذا الإجراء؟', demo: 'تجريبي', to: 'إلى: {names}', deny: 'رفض', approve: 'موافقة',
    preparing: 'قيد التحضير', running: 'قيد التشغيل', needsApproval: 'بحاجة إلى موافقة', done: 'تم', failed: 'فشل', denied: 'مرفوض',
    args: 'المعطيات', result: 'النتيجة', toolFailed: 'فشلت الأداة.', error: 'حدث خطأ ما', assistant: 'المساعد',
  },
})

/** AssistantChat's strings, and the answer cards (ChatChecklist, ChatApproval). */
export const CHAT_MESSAGES = defineMessages('chat', {
  en: {
    askOrCommand: 'Ask anything, or type / for commands', messageLabel: 'Message', commands: 'Commands', thinkingSr: 'Assistant is thinking…', failedSr: 'The reply failed',
    stopped: 'Stopped', answerSr: 'Assistant: {text}', retry: 'Retry', regenerate: 'Regenerate', followUps: 'Follow-ups', prevVersion: 'Previous version',
    nextVersion: 'Next version', versionOf: '{n, number} / {total, number}', noResponder: 'No responder is connected. Pass `chat` (useAiChat) or `respond`.',
    assistant: 'Assistant', toolRunning: '{label}…', openCount: '{count, number} open', allClear: 'All clear 🎉', editMessage: 'Edit message', done: 'Done',
    edit: 'Edit', dontSend: 'Don’t send', send: 'Send', sending: 'Sending…', sent: 'Sent', undoAction: 'Undo', unsent: 'Unsent. Nothing left your outbox.',
    declined: 'Not sent. The draft is saved.',
  },
  de: {
    askOrCommand: 'Frag etwas oder tippe / für Befehle', messageLabel: 'Nachricht', commands: 'Befehle', thinkingSr: 'Der Assistent denkt nach …', failedSr: 'Die Antwort ist fehlgeschlagen',
    stopped: 'Gestoppt', answerSr: 'Assistent: {text}', retry: 'Erneut versuchen', regenerate: 'Neu erzeugen', followUps: 'Anschlussfragen', prevVersion: 'Vorige Version',
    nextVersion: 'Nächste Version', versionOf: '{n, number} / {total, number}', noResponder: 'Keine Antwortquelle verbunden. Übergib `chat` (useAiChat) oder `respond`.',
    assistant: 'Assistent', toolRunning: '{label} …', openCount: '{count, number} offen', allClear: 'Alles erledigt 🎉', editMessage: 'Nachricht bearbeiten', done: 'Fertig',
    edit: 'Bearbeiten', dontSend: 'Nicht senden', send: 'Senden', sending: 'Wird gesendet …', sent: 'Gesendet', undoAction: 'Rückgängig', unsent: 'Zurückgeholt. Nichts hat deinen Postausgang verlassen.',
    declined: 'Nicht gesendet. Der Entwurf ist gespeichert.',
  },
  ar: {
    askOrCommand: 'اسأل عن أي شيء، أو اكتب / للأوامر', messageLabel: 'الرسالة', commands: 'الأوامر', thinkingSr: 'المساعد يفكّر…', failedSr: 'فشل الرد',
    stopped: 'توقّف', answerSr: 'المساعد: {text}', retry: 'إعادة المحاولة', regenerate: 'إعادة التوليد', followUps: 'أسئلة متابعة', prevVersion: 'الإصدار السابق',
    nextVersion: 'الإصدار التالي', versionOf: '{n, number} / {total, number}', noResponder: 'لا يوجد مصدر للردود. مرّر `chat` (useAiChat) أو `respond`.',
    assistant: 'المساعد', toolRunning: '{label}…', openCount: '{count, number} مفتوحة', allClear: 'اكتمل كل شيء 🎉', editMessage: 'تعديل الرسالة', done: 'تم',
    edit: 'تعديل', dontSend: 'عدم الإرسال', send: 'إرسال', sending: 'جارٍ الإرسال…', sent: 'أُرسلت', undoAction: 'تراجع', unsent: 'أُلغي الإرسال. لم يغادر شيء صندوق الصادر.',
    declined: 'لم تُرسل. المسودة محفوظة.',
  },
})

/* Renderers: what text and tool data look like inside a message ─────────── */

/** How a text part is drawn: `streaming` while it grows; `renderCitation(n)` draws `[n]`; `onLinkClick` is MessageParts' own. */
export type AiTextRenderer = (text: string, o: { streaming: boolean; renderCitation: (n: number) => ReactNode; onLinkClick?: (href: string, e: React.MouseEvent) => void }) => ReactNode
/**
 * Optional renderers for message parts. `text`: default Markdown with fences in a plain frame (`aiMarkdownText()`);
 * `value`: a tool call's arguments and result, default indented JSON. `AI_RICH_RENDERERS` (Markdown with fences
 * highlighted by CodeBlock, JsonViewer) is the full set; pass it to `renderers` or once to `<AiRenderersProvider renderers={…}>`.
 */
export type AiRenderers = { text?: AiTextRenderer; value?: (value: unknown) => ReactNode }
const AiRenderersCtx = createContext<AiRenderers>({})
/** Supplies AiRenderers to every MessageParts below it (props given to a component win). */
export function AiRenderersProvider({ renderers, children }: { renderers: AiRenderers; children: ReactNode }) {
  return <AiRenderersCtx.Provider value={renderers}>{children}</AiRenderersCtx.Provider>
}
/** Markdown for text parts with highlighted fences: `renderers={{ text: aiMarkdownText(markdownCodeBlock) }}`. */
export const aiMarkdownText = (renderCode?: MarkdownCodeRenderer): AiTextRenderer => (text, { streaming, renderCitation, onLinkClick }) =>
  <Markdown streaming={streaming} onLinkClick={onLinkClick} renderCitation={renderCitation} renderCode={renderCode} className="!text-[13px]">{text}</Markdown>
/** Markdown (fences highlighted by CodeBlock) for text, JsonViewer for tool data: how MessageParts rendered before 0.4. */
export const AI_RICH_RENDERERS: AiRenderers = { text: aiMarkdownText(markdownCodeBlock), value: v => <JsonViewer data={v} maxHeight={160} /> }

/** The default text renderer: Markdown, fences in its plain frame (no highlighter bundled). */
const aiDefaultText = aiMarkdownText()
/** The default value renderer: indented JSON (as text, never markup), capped, scrolling inside a 160px box. */
const aiJsonValue = (v: unknown) => {
  let s: string; try { s = typeof v === 'string' ? v : JSON.stringify(v, null, 2) ?? String(v) } catch { s = String(v) }
  return <pre dir="ltr" tabIndex={0} className="m-0 max-h-40 overflow-auto rounded-[var(--r-md)] border border-[var(--line)] bg-[var(--bg)] px-2 py-1.5 font-[family-name:var(--mono)] text-[11px] leading-normal break-all whitespace-pre-wrap outline-none focus-visible:shadow-[0_0_0_2px_var(--accent-soft)]">{s.length > 8000 ? s.slice(0, 8000) + '…' : s}</pre>
}

/* Answer parts: library components rendered inside an assistant turn ─────── */

/** Card frame for a generated answer part: title, caption, optional badge on the right. */
export function ChatCard({ title, sub, badge, children, className }: { title?: ReactNode; sub?: ReactNode; badge?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <div className={cn(surface.card, 'max-w-[560px] p-3', className)}>
      {title && <div className="mb-2 flex items-center gap-2"><b className="text-[13px]">{title}</b>{sub && <span className="text-xs text-[var(--fg3)]">{sub}</span>}<span className="flex-1" />{badge}</div>}
      {children}
    </div>
  )
}

/** @deprecated Use `SourceList` with `Source` items (`name` → `title`, `desc` → `domain`, `href` → `url`). Removed in 0.5. */
export function ChatSources({ items, className }: { items: { name: string; desc: string; color?: string; href?: string }[]; className?: string }) {
  return <SourceList className={className} sources={items.map(s => ({ title: s.name, domain: s.desc, color: s.color, url: s.href }))} />
}

/** Checklist answer: tick items off; the count updates and confetti fires when everything is done. */
export function ChatChecklist({ title, items, className }: { title: string; items: { label: string; note: string; tone?: Tone }[]; className?: string }) {
  const [done, setDone] = useState<boolean[]>(items.map(() => false))
  const t = useMessages(CHAT_MESSAGES)
  const ref = useRef<HTMLDivElement>(null)
  const left = done.filter(d => !d).length
  const toggle = (i: number, v: boolean) => {
    const next = done.map((d, k) => k === i ? v : d); setDone(next)
    if (next.every(Boolean) && ref.current) { const r = ref.current.getBoundingClientRect(); confetti({ x: r.left + r.width / 2, y: r.top + 20, count: 90 }) }
  }
  return (
    <div ref={ref} className={className}><ChatCard title={title} sub={<motion.span key={left} initial={{ opacity: 0, y: -3 }} animate={{ opacity: 1, y: 0 }} className="inline-block">{left ? t('openCount', { count: left }) : t('allClear')}</motion.span>}>
      {items.map((it, i) => (
        <div key={it.label} className="flex flex-wrap items-center gap-x-2 gap-y-1 border-t border-[var(--line)] py-2">
          <Checkbox checked={done[i]} onChange={v => toggle(i, v)}><span className={cn('transition-colors', done[i] && 'text-[var(--fg3)] line-through')}>{it.label}</span></Checkbox>
          <Badge tone={it.tone} className="ms-auto">{it.note}</Badge>
        </div>
      ))}
    </ChatCard></div>
  )
}

/** Approval answer: the drafted message with Edit, Don’t send and Send; after sending, Undo. */
export function ChatApproval({ title, to, body: initial, className }: { title: string; to: string; body: string; className?: string }) {
  const [state, setState] = useState<'ask' | 'edit' | 'sending' | 'sent' | 'unsent' | 'declined'>('ask')
  const [body, setBody] = useState(initial)
  const t = useMessages(CHAT_MESSAGES)
  const send = async () => { setState('sending'); await sleep(900); setState('sent') }
  return (
    <ChatCard title={title} sub={to} className={className}>
      {state === 'edit'
        ? <textarea autoFocus value={body} onChange={e => setBody(e.target.value)} rows={3} dir="auto" aria-label={t('editMessage')} className={cn(inputClass, '!h-auto mb-2.5 resize-none py-2 leading-normal shadow-[0_0_0_1.5px_var(--accent)]', TOUCH.input)} />
        : <div dir="auto" className="mb-2.5 rounded-[var(--r-md)] bg-[var(--muted)] px-3 py-2.5 text-[13px] leading-normal">{body}</div>}
      <div className="flex min-h-[30px] flex-wrap items-center justify-end gap-1.5">
        {(state === 'ask' || state === 'edit') && <>
          <Button size="sm" variant="ghost" onClick={() => setState(state === 'edit' ? 'ask' : 'edit')}>{state === 'edit' ? t('done') : t('edit')}</Button>
          <Button size="sm" onClick={() => setState('declined')}>{t('dontSend')}</Button>
          <Button size="sm" variant="primary" onClick={send}>{t('send')}</Button></>}
        {state === 'sending' && <span className="me-auto flex items-center gap-2 text-xs text-[var(--fg3)]"><Spinner size={12} />{t('sending')}</span>}
        {state === 'sent' && <><motion.span initial={{ scale: 0.6 }} animate={{ scale: 1 }} transition={spring(0.5, 0.35)} className="me-auto"><Badge tone="ok"><Icon name="check" size={11} strokeWidth={3} />{t('sent')}</Badge></motion.span>
          <Button size="sm" variant="ghost" onClick={() => setState('unsent')}>{t('undoAction')}</Button></>}
        {state === 'unsent' && <span className="me-auto text-xs text-[var(--fg3)]">{t('unsent')}</span>}
        {state === 'declined' && <span className="me-auto text-xs text-[var(--fg3)]">{t('declined')}</span>}
      </div>
    </ChatCard>
  )
}

/* Conversation parts (AI Elements style): Conversation, Message, MessageParts, ToolCard, Reasoning, MessageActions, Suggestions ─ */

/** Is a scroller within `threshold` px of its bottom? */
export const aiNearBottom = (el: { scrollTop: number; scrollHeight: number; clientHeight: number }, threshold = 32) => el.scrollHeight - el.scrollTop - el.clientHeight <= threshold

/**
 * Keeps a scroller pinned to its bottom while content grows, unless the person scrolled up (wheel, touch, keys or
 * the scrollbar; scrolls caused by layout changes never unpin it); scrolling back near the bottom, or `jump()`, pins it again. Attach `ref` to the scroller; content
 * growth is caught on every render of the owner and by a ResizeObserver on the scroller's first child. With
 * `follow: false` it only tracks `pinned` (for a scroller that keeps itself at the bottom, e.g. a useVirtual chat log);
 * `jump(scrollToEnd?)` then calls your scroll function.
 */
export function useStickToBottom<T extends HTMLElement = HTMLDivElement>({ threshold = 32, follow = true }: { threshold?: number; follow?: boolean } = {}) {
  const [el, ref] = useState<T | null>(null)
  const [pinned, setPinned] = useState(true)
  const pin = useRef(true), jumping = useRef(false), reduce = useReducedMotion()
  const set = useCallback((v: boolean) => { if (pin.current !== v) { pin.current = v; setPinned(v) } }, [])
  const toEnd = useCallback(() => { if (el && pin.current && follow) el.scrollTop = el.scrollHeight }, [el, follow])
  useEffect(() => {
    if (!el) return
    let touchY = 0, userAt = -1e9
    // only the reader unpins it (wheel, touch, keys, the scrollbar): scroll events from layout changes (a virtual
    // list correcting for measured sizes, content shrinking) never do
    const onScroll = () => {
      const near = aiNearBottom(el, threshold)
      if (jumping.current) { if (near) jumping.current = false; return }
      if (near) set(true); else if (performance.now() - userAt < 1000) set(false)
    }
    const away = () => { jumping.current = false; userAt = performance.now(); if (el.scrollHeight > el.clientHeight + 1) set(false) }
    const onPointer = () => { userAt = performance.now() }
    const onWheel = (e: WheelEvent) => { if (e.deltaY < 0) away() }
    const onTouchStart = (e: TouchEvent) => { touchY = e.touches[0]?.clientY ?? 0 }
    const onTouchMove = (e: TouchEvent) => { if ((e.touches[0]?.clientY ?? 0) > touchY + 4) away() }
    const onKey = (e: KeyboardEvent) => { if (['PageUp', 'ArrowUp', 'Home'].includes(e.key) && e.target === el) away() }
    el.addEventListener('scroll', onScroll, { passive: true }); el.addEventListener('wheel', onWheel, { passive: true })
    el.addEventListener('touchstart', onTouchStart, { passive: true }); el.addEventListener('touchmove', onTouchMove, { passive: true }); el.addEventListener('keydown', onKey); el.addEventListener('pointerdown', onPointer)
    const ro = new ResizeObserver(() => toEnd())
    ro.observe(el); if (el.firstElementChild) ro.observe(el.firstElementChild)
    return () => { el.removeEventListener('scroll', onScroll); el.removeEventListener('wheel', onWheel); el.removeEventListener('touchstart', onTouchStart); el.removeEventListener('touchmove', onTouchMove); el.removeEventListener('keydown', onKey); el.removeEventListener('pointerdown', onPointer); ro.disconnect() }
  }, [el, threshold, set, toEnd])
  useLayoutEffect(() => { toEnd() }) // after every render: new content while pinned stays in view
  const jump = useCallback((scrollToEnd?: () => void) => {
    if (!el) return
    pin.current = true; setPinned(true)
    if (scrollToEnd) { jumping.current = false; scrollToEnd(); return } // an instant jump the owner makes (a virtual list re-renders its end first)
    if (reduce) { el.scrollTop = el.scrollHeight; return }
    jumping.current = true
    el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' })
  }, [el, reduce])
  return { ref, pinned, jump, follow: toEnd }
}

/** Conversation renders every message up to this many children, then only the ones in view (useVirtual). */
export const CONVERSATION_VIRTUAL_AFTER = 60
/** Height a not-yet-measured message is assumed to have in a virtualised Conversation. */
const AI_MSG_ESTIMATE = 120

/**
 * The scrolling message log. Stays pinned to the newest message while replies stream, unless the person scrolled up;
 * then a "Jump to latest" button floats at the bottom (it never moves the layout). Give it a height (className, e.g.
 * `h-[420px]`) so streaming never pushes the page. `busy` sets aria-busy; the log itself is not a live region, so
 * screen readers aren't read every token (announce a summary yourself). Past `virtualizeAfter` children (default 60;
 * give each a stable `key`, e.g. the message id) it renders only the messages in view, measuring their real heights,
 * still pinned to the bottom while the last one grows and keeping your place when older ones are prepended.
 */
export function Conversation({ children, busy, label, jumpLabel, virtualizeAfter = CONVERSATION_VIRTUAL_AFTER, className, contentClassName }:
  { children: ReactNode; busy?: boolean; label?: string; jumpLabel?: string; /** children count above which it virtualises (Infinity: never) */ virtualizeAfter?: number
    className?: string; contentClassName?: string }) {
  const t = useMessages(CHAT_PARTS_MESSAGES)
  const kids = Children.toArray(children)
  const virtual = kids.length > virtualizeAfter
  const box = useRef<HTMLDivElement>(null)
  // Virtual mode windows every message but the last; the last (the one that streams) stays in normal flow below the
  // window, so pinning works the same in both modes: after every render, and whenever the content resizes, the
  // scroller goes to its scrollHeight in the same frame. (The virtualizer's own `anchor: 'end'` pins only after its
  // ResizeObserver has measured a growing item, a frame late, which shows up as layout shift on every token.)
  const stick = useStickToBottom<HTMLDivElement>()
  const keys = useRef<(string | number)[]>([])
  const prev = useRef<{ first: string | number | undefined; count: number }>({ first: undefined, count: 0 })
  keys.current = kids.map((k, i) => isValidElement(k) && k.key != null ? k.key : i)
  const keyAt = useCallback((i: number) => keys.current[i] ?? i, []) // stable, so streaming renders don't re-lay out the list
  const v = useVirtual({ count: virtual ? kids.length - 1 : 0, estimateSize: AI_MSG_ESTIMATE, scrollRef: box, getItemKey: keyAt, enabled: virtual, overscan: 4, initialOffset: 1e9 })
  useLayoutEffect(() => { // older messages prepended while the reader is scrolled up: keep what they are reading in place
    const el = box.current, p = prev.current, first = keys.current[0]
    prev.current = { first, count: kids.length }
    if (!el || !virtual || stick.pinned || kids.length <= p.count || first === p.first || p.first === undefined) return
    const k = keys.current.indexOf(p.first)
    if (k > 0) el.scrollTop += k * AI_MSG_ESTIMATE // the new ones are unmeasured, so each is the estimate
  })
  const setRef = useCallback((el: HTMLDivElement | null) => { box.current = el; stick.ref(el) }, [stick.ref]) // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className={cn('relative flex min-h-0 flex-col', className)}>
      <div ref={setRef} role="log" aria-live="off" aria-busy={busy || undefined} aria-label={label ?? t('conversation')} tabIndex={0}
        className={cn('min-h-0 flex-1 overflow-y-auto overscroll-contain rounded-[var(--r-md)] outline-none focus-visible:shadow-[0_0_0_2px_var(--accent-soft)]', virtual && '[overflow-anchor:none]')}>
        {virtual
          // one parent for the window and the last message, so a message moving from one to the other keeps its DOM
          ? <div className="relative" style={{ paddingTop: v.totalSize }} data-virtual="">
              {v.items.map(it => (
                <div key={it.key} data-index={it.index} ref={v.measureElement} className={cn('absolute top-0 start-0 flex w-full flex-col px-0.5 pb-3', contentClassName)}
                  style={{ transform: `translateY(${it.start}px)` }}>{kids[it.index]}</div>))}
              <div key={keys.current[kids.length - 1]} className={cn('flex flex-col px-0.5 pb-0.5', contentClassName)}>{kids[kids.length - 1]}</div>
            </div>
          : <div className={cn('flex flex-col gap-3 p-0.5', contentClassName)}>{children}</div>}
      </div>
      <AiJumpButton show={!stick.pinned} label={jumpLabel ?? t('jump')} onJump={() => stick.jump()} />
    </div>
  )
}

/** "Jump to latest": floats over the bottom of a log (never moves the layout) while the reader is scrolled up. */
function AiJumpButton({ show, label, onJump }: { show: boolean; label: string; onJump: () => void }) {
  return (
    <AnimatePresence>{show && (
      <div className="pointer-events-none absolute inset-x-0 bottom-2 flex justify-center">
        <motion.button key="jump" type="button" onClick={onJump} initial={{ opacity: 0, y: 8, scale: 0.95 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 8, scale: 0.95, transition: { duration: 0.12 } }} transition={spring(0.3, 0.3)}
          className={cn(floatingSurface, 'pointer-events-auto inline-flex h-8 cursor-pointer items-center gap-1.5 !rounded-full px-3 text-xs font-medium text-[var(--fg)] hover:bg-[var(--muted)] [@media(pointer:coarse)]:h-10')}>
          <Icon name="arrowDown" size={13} strokeWidth={2.5} />{label}</motion.button>
      </div>)}</AnimatePresence>
  )
}

/** AssistantChat's log: Conversation without virtualisation (pinned to the newest message, "Jump to latest"). */
function AiChatLog({ children, busy, className, contentClassName }: { children: ReactNode; busy?: boolean; className?: string; contentClassName?: string }) {
  const t = useMessages(CHAT_PARTS_MESSAGES)
  const stick = useStickToBottom<HTMLDivElement>()
  return (
    <div className={cn('relative flex min-h-0 flex-col', className)}>
      <div ref={stick.ref} role="log" aria-live="off" aria-busy={busy || undefined} aria-label={t('conversation')} tabIndex={0}
        className="min-h-0 flex-1 overflow-y-auto overscroll-contain rounded-[var(--r-md)] outline-none focus-visible:shadow-[0_0_0_2px_var(--accent-soft)]">
        <div className={cn('flex flex-col gap-3 p-0.5', contentClassName)}>{children}</div>
      </div>
      <AiJumpButton show={!stick.pinned} label={t('jump')} onJump={() => stick.jump()} />
    </div>
  )
}

/** Suggestion chips (starters, follow-ups). A group named by `label`; each chip calls `onPick(text)`. */
export function Suggestions({ items, onPick, label, disabled, className }: { items: string[]; onPick: (s: string) => void; label?: string; disabled?: boolean; className?: string }) {
  const t = useMessages(CHAT_PARTS_MESSAGES)
  if (!items.length) return null
  return (
    <div role="group" aria-label={label ?? t('suggestions')} className={cn('flex flex-wrap gap-1.5', className)}>
      {items.map(q => <Chip key={q} disabled={disabled} onClick={() => onPick(q)}><span dir="auto">{q}</span></Chip>)}
    </div>
  )
}

/**
 * The row under an answer: "Stopped" when it was cut short, Copy (`text`, read when clicked), thumbs up / down
 * (controlled `rating` + `onRate`, or uncontrolled), Regenerate or Retry (`onRetry`), and anything you add (`children`,
 * e.g. a version switcher).
 */
export function MessageActions({ text, onRetry, retryLabel, rating, defaultRating = 0, onRate, feedback = true, stopped, disabled, children, className }:
  { text?: string | (() => string); onRetry?: () => void; retryLabel?: string; rating?: 0 | 1 | -1; defaultRating?: 0 | 1 | -1; onRate?: (r: 0 | 1 | -1) => void
    feedback?: boolean; stopped?: boolean; disabled?: boolean; children?: ReactNode; className?: string }) {
  const [r, setR] = useControllable<0 | 1 | -1>(rating, defaultRating, onRate)
  const t = useMessages(CHAT_PARTS_MESSAGES)
  const hasText = typeof text === 'function' || !!text
  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.25 }} className={cn('flex flex-wrap items-center gap-0.5 text-[var(--fg3)] [@media(pointer:coarse)]:gap-1', className)}>
      {stopped && <span className="me-1.5 text-xs">{t('stopped')}</span>}
      {hasText && <CopyButton text={text!} size="icon-sm" variant="ghost" className="text-[var(--fg3)] hover:text-[var(--fg)]" />}
      {feedback && ([1, -1] as const).map(v => (
        <Button key={v} size="icon-sm" variant="ghost" aria-label={v === 1 ? t('good') : t('bad')} aria-pressed={r === v} title={v === 1 ? t('good') : t('bad')}
          className={r === v ? 'text-[var(--fg)] !bg-[var(--muted)]' : 'text-[var(--fg3)] hover:text-[var(--fg)]'} onClick={() => setR(r === v ? 0 : v)}>
          <motion.span key={r === v ? 'on' : 'off'} animate={r === v ? { scale: [1, 1.3, 1], rotate: [0, v === 1 ? -15 : 15, 0] } : undefined} transition={spring(0.5, 0.45)} className={cn('grid', v === -1 && 'rotate-180')}>
            <Icon name="thumbUp" size={14} /></motion.span>
        </Button>
      ))}
      {onRetry && <IconButton icon="refresh" label={retryLabel ?? t('regenerate')} disabled={disabled} onClick={onRetry} />}
      {children}
    </motion.div>
  )
}

/**
 * Collapsible model reasoning in the ThinkingSteps style. Open while it streams ("Thinking…" shimmers and counts),
 * folded to "Thought for Ns" once done (click to read it again). The text is shown as plain text, never as markup.
 */
export function Reasoning({ text, streaming, defaultOpen, className }: { text: string; streaming?: boolean; defaultOpen?: boolean; className?: string }) {
  const [user, setUser] = useState<boolean | null>(defaultOpen ?? null) // null: follow `streaming`
  const open = user ?? !!streaming
  const [live, setLive] = useState(0), [secs, setSecs] = useState<number | null>(null)
  const t = useMessages(CHAT_PARTS_MESSAGES), { fmt, dir } = useLocale()
  useEffect(() => { // counts while it streams; the final time becomes "Thought for Ns"
    if (!streaming) return
    const t0 = performance.now(), now = () => (performance.now() - t0) / 1000
    const t = setInterval(() => setLive(now()), 250)
    return () => { clearInterval(t); setSecs(now()) }
  }, [streaming])
  return (
    <div className={cn(surface.card, 'overflow-hidden text-[13px]', className)}>
      <button type="button" aria-expanded={open} onClick={() => setUser(!open)} className="flex w-full cursor-pointer items-center gap-2 border-0 bg-transparent px-3 py-2 text-start font-medium text-[var(--fg2)] hover:text-[var(--fg)] [@media(pointer:coarse)]:min-h-10">
        <Icon name="bulb" size={14} />
        {streaming ? <ShimmerText>{t('thinking')} <span className="tabular-nums">{t('secs', { s: fmt.number(live, { minimumFractionDigits: 1, maximumFractionDigits: 1 }) })}</span></ShimmerText>
          : <span>{secs != null ? t('thoughtFor', { s: fmt.number(Math.max(1, Math.round(secs))) }) : t('reasoning')}</span>}
        <motion.span className="ms-auto grid text-[var(--fg3)]" animate={{ rotate: open ? 0 : dir === 'rtl' ? 90 : -90 }} transition={spring(0.2, 0.3)}><Icon name="chevronDown" size={12} strokeWidth={2.5} /></motion.span>
      </button>
      <Collapse open={open}><div dir="auto" className="border-t border-[var(--line)] px-3 py-2 text-xs leading-relaxed whitespace-pre-wrap text-[var(--fg2)]">{text}</div></Collapse>
    </div>
  )
}

const acArgText = (v: unknown) => { let t: string; try { t = typeof v === 'string' ? v : JSON.stringify(v) ?? String(v) } catch { t = String(v) } return t.length > 160 ? t.slice(0, 157) + '…' : t }

/**
 * An approval prompt for an action the host wants to run: the tool, a summary, recipients and arguments exactly as
 * given (shown as data, never as markup), with Deny and Approve. Approve is disabled for the first 500 ms so a click
 * aimed at something else can't land on it as the card appears. It only reports the decision: run the action in
 * `onDecide` (or in useAiChat's `onApprovalRequest`), never before.
 */
export function ApprovalCard({ tool, summary, args, recipients, demo, busy, onDecide, className }:
  { tool: string; summary?: ReactNode; args?: unknown; recipients?: string[]; demo?: boolean; busy?: boolean; onDecide: (approved: boolean) => void; className?: string }) {
  const [armed, setArmed] = useState(false)
  const t = useMessages(CHAT_PARTS_MESSAGES), { fmt } = useLocale()
  useEffect(() => { const k = setTimeout(() => setArmed(true), 500); return () => clearTimeout(k) }, [])
  const rows = args && typeof args === 'object' && !Array.isArray(args) ? Object.entries(args as Record<string, unknown>).slice(0, 8) : args !== undefined ? [['input', args] as [string, unknown]] : []
  return (
    <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={spring(0.3, 0.35)} role="group" aria-label={t('approvalNeeded')}
      className={cn('flex flex-col gap-2 rounded-[var(--r-md)] border border-[color-mix(in_srgb,var(--warn)_40%,var(--line))] bg-[color-mix(in_srgb,var(--warn)_6%,var(--card))] py-2 pe-2 ps-3 text-[13px]', className)}>
      <div className="flex flex-wrap items-center gap-1.5"><Icon name="shield" size={14} className="text-[var(--warn)]" /><b className="font-medium">{t('approveQ')}</b>
        <code dir="ltr" className="rounded-[var(--r-sm)] bg-[var(--muted)] px-1.5 font-[family-name:var(--mono)] text-[11px] break-all">{tool}</code>{demo && <Badge>{t('demo')}</Badge>}</div>
      {summary && <span dir="auto" className="break-words">{summary}</span>}
      {!!recipients?.length && <span className="text-xs text-[var(--fg2)]">{t('to', { names: fmt.list(recipients) })}</span>}
      {rows.length > 0 && <dl dir="ltr" className="m-0 grid grid-cols-[auto_minmax(0,1fr)] gap-x-2 gap-y-0.5 text-xs">{rows.flatMap(([k, v]) => [<dt key={`k${k}`} className="font-[family-name:var(--mono)] text-[var(--fg3)]">{k}</dt>, <dd key={`v${k}`} className="m-0 break-words text-[var(--fg2)]">{acArgText(v)}</dd>])}</dl>}
      <div className="flex justify-end gap-2">
        <Button size="sm" disabled={busy} onClick={() => onDecide(false)}>{t('deny')}</Button>
        <Button size="sm" variant="primary" disabled={!armed || busy} loading={busy} onClick={() => onDecide(true)}>{t('approve')}</Button>
      </div>
    </motion.div>
  )
}

const AI_TOOL_BADGE: Record<AiToolState, ['preparing' | 'running' | 'needsApproval' | 'done' | 'failed', Tone | undefined]> = { pending: ['preparing', undefined], running: ['running', 'accent'], 'awaiting-approval': ['needsApproval', 'warn'], done: ['done', 'ok'], error: ['failed', 'bad'] }

/**
 * A tool call from a message: status icon, tool name and state, and (click to open) its arguments and result, as data
 * (indented JSON, or `renderValue`, e.g. `v => <JsonViewer data={v} />`). While it awaits approval it shows an ApprovalCard; `onDecide` gets the decision (useAiChat's
 * `decideTool`). A denied call says so and never shows a result.
 */
export function ToolCard({ part, onDecide, defaultOpen = false, renderValue, className }:
  { part: AiToolPart; onDecide?: (approved: boolean) => void; defaultOpen?: boolean; /** arguments and result (default: indented JSON) */ renderValue?: (value: unknown) => ReactNode; className?: string }) {
  const [open, setOpen] = useState(defaultOpen)
  const t = useMessages(CHAT_PARTS_MESSAGES), { dir } = useLocale()
  const show = renderValue ?? aiJsonValue
  const [busy, setBusy] = useState(false)
  useEffect(() => { if (part.state !== 'awaiting-approval') setBusy(false) }, [part.state])
  const denied = part.approval?.approved === false
  const [label, tone] = denied ? ['denied', undefined] as const : AI_TOOL_BADGE[part.state]
  const args = part.args !== undefined ? part.args : part.argsText
  const working = part.state === 'running' || part.state === 'pending'
  return (
    <div className={cn('overflow-hidden rounded-[var(--r-md)] border border-[var(--line)] text-xs', className)}>
      <button type="button" aria-expanded={open} onClick={() => setOpen(!open)}
        className="flex w-full cursor-pointer items-center gap-2 border-0 bg-[var(--muted)] px-2.5 py-2 text-start text-[var(--fg2)] [@media(pointer:coarse)]:min-h-10">
        <span className="grid w-3 flex-none place-items-center">{working ? <Spinner size={12} /> : part.state === 'awaiting-approval' ? <Icon name="shield" size={12} className="text-[var(--warn)]" />
          : <Icon name={part.state === 'done' ? 'check' : 'x'} size={12} strokeWidth={3} className={part.state === 'done' ? 'text-[var(--ok)]' : 'text-[var(--bad)]'} />}</span>
        <ShimmerText active={working} className="min-w-0 truncate font-[family-name:var(--mono)]">{part.name}</ShimmerText>
        <Badge size="sm" tone={tone} className="ms-auto flex-none">{t(label)}</Badge>
        <motion.span className="grid flex-none text-[var(--fg3)]" animate={{ rotate: open ? (dir === 'rtl' ? -90 : 90) : 0 }} transition={spring(0.2, 0.3)}><Icon name="chevronRight" size={11} strokeWidth={2.5} className="ui-flip" /></motion.span>
      </button>
      <Collapse open={open}>
        <div className="flex flex-col gap-2 p-2.5">
          {args !== undefined && <div><div className="mb-1 text-[11px] font-medium text-[var(--fg3)]">{t('args')}</div>{show(args)}</div>}
          {part.state === 'done' && !denied && <div><div className="mb-1 text-[11px] font-medium text-[var(--fg3)]">{t('result')}</div>{show(part.result ?? null)}</div>}
          {part.state === 'error' && <div dir="auto" className="text-[var(--bad)]">{part.error || t('toolFailed')}</div>}
        </div>
      </Collapse>
      {part.state === 'awaiting-approval' && onDecide && (
        <ApprovalCard tool={part.name} summary={part.approval?.summary} args={part.args} busy={busy} className="m-2"
          onDecide={ok => { setBusy(true); onDecide(ok) }} />)}
    </div>
  )
}

/** The person's chat bubble: a tail on the inline-end bottom corner, so it mirrors with the page direction. */
const AI_USER_BUBBLE = 'rounded-[14px] rounded-ee-[4px] bg-[var(--primary)] px-3 py-2 text-[13px] leading-normal break-words whitespace-pre-wrap text-[var(--on-primary)]'

/** The numbered source chips under an answer (the same numbers as its [n] citations). */
function AiMessageSources({ sources }: { sources: AiSourcePart[] }) {
  return <SourceList className="mt-1" sources={sources.map(s => ({ title: s.title || sourceDomain({ title: '', url: s.url }), url: s.url }))} />
}

/**
 * Renders a message's parts in order: text as Markdown (or through `renderers.text`; links through safeUrl, `[n]` is a
 * Citation of the message's n-th source), reasoning as Reasoning, tool calls as ToolCard (approvals go to
 * `onDecideTool`; data through `renderers.value`), files as attachment tiles, errors with a Retry (`onRetry`), and
 * `data` parts through `renderData` (nothing by default). Sources are collected into numbered chips at the end. Model
 * text never reaches the DOM as HTML. `renderers` (or an AiRenderersProvider above) adds code highlighting and JsonViewer:
 * `<MessageParts message={m} renderers={AI_RICH_RENDERERS} />`.
 */
export function MessageParts({ message, onDecideTool, onRetry, renderData, onLinkClick, renderers, className }:
  { message: AiMessage; onDecideTool?: (toolId: string, approved: boolean) => void; onRetry?: () => void; renderData?: (part: AiDataPart) => ReactNode
    onLinkClick?: (href: string, e: React.MouseEvent) => void; renderers?: AiRenderers; className?: string }) {
  const t = useMessages(CHAT_PARTS_MESSAGES)
  const fromCtx = useContext(AiRenderersCtx)
  const text = renderers?.text ?? fromCtx.text ?? aiDefaultText, value = renderers?.value ?? fromCtx.value
  const streaming = message.status === 'streaming'
  const sources = message.parts.filter((p): p is AiSourcePart => p.type === 'source')
  const lastText = message.parts.reduce((k, p, i) => p.type === 'text' ? i : k, -1)
  const cite = (n: number) => { const s = sources[n - 1]; return s ? <Citation n={n} source={{ title: s.title || sourceDomain({ title: '', url: s.url }), url: s.url, snippet: s.snippet }} /> : <>[{n}]</> }
  const visible = message.parts.some(p => p.type !== 'source' && p.type !== 'data')
  return (
    <div className={cn('flex min-w-0 flex-col gap-2', className)}>
      {streaming && !visible && <TypingDots />}
      {message.parts.map((p, i) => {
        switch (p.type) {
          case 'text': return p.text ? <Fragment key={i}>{text(p.text, { streaming: streaming && i === lastText && p.state !== 'done', renderCitation: cite, onLinkClick })}</Fragment> : null
          case 'reasoning': return <Reasoning key={i} text={p.text} streaming={p.state === 'streaming'} />
          case 'tool': return <ToolCard key={p.id} part={p} renderValue={value} onDecide={onDecideTool ? ok => onDecideTool(p.id, ok) : undefined} />
          case 'file': return <AttachmentChip key={i} name={p.name} size={p.size} url={/^image\//.test(p.mediaType) ? p.url : null} />
          case 'data': return renderData ? <div key={i}>{renderData(p)}</div> : null
          case 'error': return (
            <div key={i} role="alert" className="flex flex-wrap items-center gap-2 rounded-[var(--r-md)] border border-[color-mix(in_srgb,var(--bad)_35%,var(--line))] bg-[var(--bad-soft)] px-3 py-2 text-[13px] text-[var(--fg)]">
              <Icon name="alert" size={14} className="text-[var(--bad)]" /><span dir="auto" className="min-w-0 flex-1 break-words">{p.message || t('error')}</span>
              {onRetry && <Button size="sm" onClick={onRetry}>{t('retry')}</Button>}
            </div>)
          default: return null
        }
      })}
      {sources.length > 0 && <AiMessageSources sources={sources} />}
    </div>
  )
}

/**
 * One message. A user message is a bubble on the inline end (the right in LTR, the left in RTL; its text as plain text,
 * attachments as tiles above); an assistant message sits on the start side with a name row (`avatar`, `name`) and its
 * MessageParts, then `actions` once it stopped streaming; a system message is a quiet centred line. Pass the same
 * handlers (and `renderers`) as MessageParts.
 */
export function Message({ message, name, avatar, actions, onDecideTool, onRetry, renderData, onLinkClick, renderers, className }:
  { message: AiMessage; name?: string; avatar?: ReactNode; actions?: ReactNode; onDecideTool?: (toolId: string, approved: boolean) => void; onRetry?: () => void
    renderData?: (part: AiDataPart) => ReactNode; onLinkClick?: (href: string, e: React.MouseEvent) => void; renderers?: AiRenderers; className?: string }) {
  const t = useMessages(CHAT_PARTS_MESSAGES)
  if (message.role === 'system') return <div dir="auto" className={cn('self-center px-3 text-center text-xs text-[var(--fg3)]', className)}>{aiMessageText(message)}</div>
  if (message.role === 'user') {
    const files = message.parts.filter((p): p is AiFilePart => p.type === 'file'), text = aiMessageText(message)
    return (
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={spring(0.25, 0.4)} className={cn('flex max-w-[85%] flex-col items-end gap-1.5 self-end', className)}>
        {files.length > 0 && <div className="flex flex-wrap justify-end gap-1.5">{files.map((f, i) => <AttachmentChip key={i} name={f.name} size={f.size} url={/^image\//.test(f.mediaType) ? f.url : null} />)}</div>}
        {text && <div dir="auto" className={AI_USER_BUBBLE}>{text}</div>}
      </motion.div>
    )
  }
  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={spring(0.25, 0.4)} className={cn('flex max-w-[94%] min-w-0 flex-col gap-1.5 text-[13px]', className)}>
      <div className="flex items-center gap-1.5 text-xs font-medium text-[var(--fg3)]">{avatar ?? <i aria-hidden className="h-2 w-2 rounded-full bg-[var(--accent)]" />}{name ?? t('assistant')}</div>
      <MessageParts message={message} onDecideTool={onDecideTool} onRetry={onRetry} renderData={renderData} onLinkClick={onLinkClick} renderers={renderers} />
      {message.status !== 'streaming' && actions}
    </motion.div>
  )
}

/* Assistant chat ─────────────────────────────────────────────────────────── */

export type ChatScript = {
  /** [running label, done label, call detail] */
  tool?: [string, string, string]
  /** alternative answers; Regenerate cycles through them */
  versions: string[]
  /** generated UI shown under the answer (a chart, table, checklist…) */
  part?: ReactNode
  followUps?: string[]
}
export type SlashCommand = { cmd: string; prompt: string; hint: string }
type ChatTurn = { id: number; q: string; s: ChatScript; phase: 'dots' | 'tool' | 'stream' | 'done'; v: number; run: number; stopped: boolean; shown: string; rating: 0 | 1 | -1 }

/** AssistantChat's input: a pill text field with `/` commands in a keyboard popup, and Send / Stop. */
function AiSlashInput({ commands, placeholder, busy, onSend, onStop }: { commands: SlashCommand[]; placeholder: string; busy: boolean; onSend: (q: string) => void; onStop: () => void }) {
  const t = useMessages(CHAT_MESSAGES)
  const [text, setText] = useState('')
  const [slashOpen, setSlashOpen] = useState(true)
  const listId = useId()
  const matches = text.startsWith('/') ? commands.filter(c => c.cmd.startsWith(text.split(' ')[0].toLowerCase())) : []
  const popup = slashOpen && matches.length > 0
  const ask = (q: string) => { if (!q.trim() || busy) return; setText(''); onSend(q.trim()) }
  const go = (c: SlashCommand) => { setText(''); ask(c.prompt) }
  const roving = useRoving(matches.length, i => go(matches[i]), { homeEnd: false })
  return (
    <div className="relative">
      {/* sized for the full command list, so filtering never makes the panel above the field jump */}
      <FloatingPanel open={popup} placement="top-start" flip={false} role="presentation" style={{ minHeight: `min(${40 + commands.length * 36}px, 300px, 45dvh)` }} className="max-h-[min(300px,45dvh)] w-[min(280px,calc(100vw-32px))] overflow-y-auto overscroll-contain">
        <MenuLabel className="font-semibold tracking-wide uppercase">{t('commands')}</MenuLabel>
        <div role="listbox" id={listId} aria-label={t('commands')} className="flex flex-col">
          {matches.map((c, i) => (
            <div key={c.cmd} id={`${listId}-${i}`} role="option" aria-selected={i === roving.active} data-active={i === roving.active}
              onPointerEnter={() => roving.setActive(i)} onMouseDown={e => e.preventDefault()} onClick={() => go(c)} className={cn(menuItemClass, '[@media(pointer:coarse)]:min-h-11')}>
              <span dir="ltr" className="font-[family-name:var(--mono)] text-xs"><b className="font-semibold">{c.cmd.slice(0, text.split(' ')[0].length)}</b>{c.cmd.slice(text.split(' ')[0].length)}</span>
              <span dir="auto" className="min-w-0 truncate text-xs text-[var(--fg3)]">{c.hint}</span>
            </div>))}
        </div>
      </FloatingPanel>
      <div className="flex items-center gap-2 rounded-full border border-[var(--line)] bg-[var(--card)] py-1 pe-1 ps-4 focus-within:border-[var(--fg3)]">
        <input value={text} dir="auto" placeholder={placeholder} aria-label={t('messageLabel')} autoComplete="off" role="combobox" aria-expanded={popup} aria-autocomplete="list"
          aria-controls={popup ? listId : undefined} aria-activedescendant={popup ? `${listId}-${roving.active}` : undefined}
          onChange={e => { setText(e.target.value); setSlashOpen(true) }} onBlur={() => setTimeout(() => setSlashOpen(false), 150)} onFocus={() => setSlashOpen(true)}
          onKeyDown={e => {
            if (e.nativeEvent.isComposing) return // Enter that confirms an IME candidate must not send
            if (popup) {
              if (e.key === 'Tab') { e.preventDefault(); go(matches[roving.active]); return }
              if (e.key === 'Escape') { e.stopPropagation(); setSlashOpen(false); return }
              roving.onKeyDown(e); return
            }
            if (e.key === 'Enter') { e.preventDefault(); ask(text) }
          }}
          className={cn('h-8 min-w-0 flex-1 border-0 bg-transparent text-[13px] outline-none placeholder:text-[var(--fg3)]', TOUCH.input)} />
        <SendButton state={busy ? 'stop' : 'send'} onClick={() => busy ? onStop() : ask(text)} disabled={!busy && !text.trim()} />
      </div>
    </div>
  )
}

/** AssistantChat over useAiChat: the same frame, with real streamed parts. */
function AiLiveChat({ chat, starters, commands, placeholder, renderers, className }: { chat: AiChat; starters: string[]; commands: SlashCommand[]; placeholder: string; renderers?: AiRenderers; className?: string }) {
  const { messages, busy } = chat
  const t = useMessages(CHAT_MESSAGES)
  const [said, setSaid] = useState('')
  const prev = useRef(chat.status)
  useEffect(() => { // announce a short summary once, not every token
    if (prev.current !== chat.status) {
      const last = messages[messages.length - 1]
      if (chat.status === 'submitted') setSaid(t('thinkingSr'))
      else if (chat.status === 'error') setSaid(t('failedSr'))
      else if (chat.status === 'ready' && last?.role === 'assistant') setSaid(last.stopped ? t('stopped') : t('answerSr', { text: aiMessageText(last).slice(0, 300) }))
      prev.current = chat.status
    }
  }, [chat.status, messages]) // eslint-disable-line react-hooks/exhaustive-deps
  const lastAssistant = messages.reduce((k, m, i) => m.role === 'assistant' ? i : k, -1)
  return (
    <div className={cn('flex flex-col gap-2.5', className)}>
      <span className="sr-only" aria-live="polite">{said}</span>
      <AiChatLog busy={busy} className="h-[min(420px,62dvh)]" contentClassName="!gap-2.5">
        {!messages.length && <Suggestions items={starters} onPick={q => chat.submit(q)} />}
        {messages.map((m, i) => (
          <Message key={m.id} message={m} renderers={renderers} onDecideTool={chat.decideTool} onRetry={i === lastAssistant ? chat.regenerate : undefined}
            actions={m.role === 'assistant' && <MessageActions text={() => aiMessageText(m)} stopped={m.stopped} onRetry={i === lastAssistant ? chat.regenerate : undefined} retryLabel={m.stopped || m.status === 'error' ? t('retry') : t('regenerate')} disabled={busy} />} />
        ))}
      </AiChatLog>
      <AiSlashInput commands={commands} placeholder={placeholder} busy={busy} onSend={q => chat.submit(q)} onStop={chat.stop} />
    </div>
  )
}

/**
 * Rich assistant chat. Starter chips, `/` commands with a keyboard popup, a log that stays pinned to the newest answer
 * (with "Jump to latest" after you scroll up), Stop, and an action row (copy, thumbs up/down, regenerate).
 *
 * Real model: pass `chat` from useAiChat and the answers render as streamed parts (text, reasoning, tool cards with
 * approvals, sources, files; add `renderers={AI_RICH_RENDERERS}` for Markdown and a JSON tree). Scripted (0.2): `respond(question)` returns a ChatScript (typing dots, a
 * collapsible tool-call row, word-by-word streaming, generated UI parts, follow-up chips, versions ‹ 1/2 ›), and
 * `defaultTurns` opens mid-conversation with those questions already answered. Screen readers hear a short summary of
 * each answer once it is done, not every word.
 */
export function AssistantChat({ chat, starters = AI_NONE, commands = AI_NO_COMMANDS, respond, defaultTurns = AI_NONE, placeholder, renderers, className }:
  { /** a real chat from useAiChat (takes precedence over `respond`) */ chat?: AiChat; starters?: string[]; commands?: SlashCommand[]; respond?: (q: string) => ChatScript
    /** questions already asked and answered when it mounts (scripted mode) */ defaultTurns?: string[]; placeholder?: string
    /** live mode: how text and tool data render (see MessageParts) */ renderers?: AiRenderers; className?: string }) {
  const t = useMessages(CHAT_MESSAGES)
  const ph = placeholder ?? t('askOrCommand')
  if (chat) return <AiLiveChat chat={chat} starters={starters} commands={commands} placeholder={ph} renderers={renderers} className={className} />
  return <AiScriptedChat starters={starters} commands={commands} respond={respond ?? (() => ({ versions: [t('noResponder')] }))} defaultTurns={defaultTurns} placeholder={ph} className={className} />
}
const AI_NONE: string[] = [], AI_NO_COMMANDS: SlashCommand[] = []

/** AssistantChat driven by `respond(q) => ChatScript` (the 0.2 behaviour). */
function AiScriptedChat({ starters, commands, respond, defaultTurns, placeholder, className }:
  { starters: string[]; commands: SlashCommand[]; respond: (q: string) => ChatScript; defaultTurns: string[]; placeholder: string; className?: string }) {
  const [turns, setTurns] = useState<ChatTurn[]>(() => defaultTurns.map((q, i) => ({ id: -1 - i, q, s: respond(q), phase: 'done', v: 0, run: 0, stopped: false, shown: '', rating: 0 })))
  const [said, setSaid] = useState('') // what the live region announces
  const t = useMessages(CHAT_MESSAGES)
  const alive = useRef(true), cancelled = useRef(new Set<number>())
  useEffect(() => { alive.current = true; return () => { alive.current = false } }, [])
  const busy = turns.some(x => x.phase !== 'done')
  const streaming = turns.some(x => x.phase === 'stream')
  const patch = (id: number, p: Partial<ChatTurn> | ((x: ChatTurn) => Partial<ChatTurn>)) => setTurns(ts => ts.map(x => x.id === id ? { ...x, ...(typeof p === 'function' ? p(x) : p) } : x))

  const ask = async (q: string) => {
    q = q.trim(); if (!q || busy) return
    const id = Date.now(), s = respond(q)
    const live = () => alive.current && !cancelled.current.has(id) // Stop during the dots or the tool call ends the turn here
    setTurns(ts => [...ts, { id, q, s, phase: 'dots', v: 0, run: 0, stopped: false, shown: '', rating: 0 }])
    setSaid(t('thinkingSr'))
    await sleep(650); if (!live()) return
    if (s.tool) { patch(id, { phase: 'tool' }); setSaid(t('toolRunning', { label: s.tool[0] })); await sleep(1000); if (!live()) return }
    patch(id, { phase: 'stream' })
  }
  const restream = (turn: ChatTurn, v: number) => patch(turn.id, { v, run: turn.run + 1, phase: 'stream', stopped: false })
  const stop = () => {
    setTurns(ts => ts.map(turn => {
      if (turn.phase === 'stream') return { ...turn, stopped: true } // StreamingText freezes and reports what it showed
      if (turn.phase === 'dots' || turn.phase === 'tool') { cancelled.current.add(turn.id); return { ...turn, phase: 'done', stopped: true, shown: '' } }
      return turn
    }))
    setSaid(t('stopped'))
  }
  const finish = (turn: ChatTurn, shown: string) => { patch(turn.id, { phase: 'done', shown }); setSaid(turn.stopped ? t('stopped') : t('answerSr', { text: shown })) }

  return (
    <div className={cn('flex flex-col gap-2.5', className)}>
      <span className="sr-only" aria-live="polite">{said}</span>
      <AiChatLog busy={streaming} className="h-[min(420px,62dvh)]" contentClassName="!gap-2.5">
        <AnimatePresence>
          {!turns.length && starters.length > 0 && (
            <motion.div key="starters" exit={{ opacity: 0, y: -6, transition: { duration: 0.15 } }}><Suggestions items={starters} onPick={ask} /></motion.div>
          )}
        </AnimatePresence>
        {turns.map(turn => {
          const answer = turn.s.versions[turn.v], n = turn.s.versions.length
          return (
            <div key={turn.id} className="flex flex-col gap-2.5">
              <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={spring(0.25, 0.4)} dir="auto"
                className={cn(AI_USER_BUBBLE, 'max-w-[80%] self-end')}>{turn.q}</motion.div>
              <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={spring(0.25, 0.4)} className="max-w-[92%] text-[13px]">
                <div className="mb-1 flex items-center gap-1.5 text-xs font-medium text-[var(--fg3)]"><i className="h-2 w-2 rounded-full bg-[var(--accent)]" />{t('assistant')}</div>
                {turn.phase === 'dots' ? <TypingDots /> : <>
                  {turn.s.tool && (turn.phase !== 'done' || !turn.stopped || turn.shown) && <ToolCall status={turn.phase === 'tool' ? 'running' : 'done'} label={turn.s.tool[0]} doneLabel={turn.s.tool[1]} detail={turn.s.tool[2]} />}
                  {turn.phase !== 'tool' && <div dir="auto" className="mt-1.5 leading-relaxed">
                    {turn.phase === 'stream'
                      ? <StreamingText key={turn.run} text={answer} playing={!turn.stopped} wordDelay={45} onDone={shown => finish(turn, shown)} />
                      : <span className="whitespace-pre-wrap">{turn.stopped ? turn.shown : answer}</span>}
                  </div>}
                  {turn.phase === 'done' && !turn.stopped && turn.s.part && <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={spring(0.25, 0.35)} className="mt-2.5">{turn.s.part}</motion.div>}
                  {turn.phase === 'done' && !turn.stopped && turn.s.followUps && turn.s.followUps.length > 0 && turn.id === turns[turns.length - 1].id && (
                    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.3, delay: 0.2 }} className="mt-2.5"><Suggestions items={turn.s.followUps} onPick={ask} label={t('followUps')} /></motion.div>)}
                  {turn.phase === 'done' && (
                    <MessageActions className="mt-1.5" stopped={turn.stopped} text={!turn.stopped || turn.shown ? () => turn.stopped ? turn.shown : answer : undefined}
                      rating={turn.rating} onRate={r => patch(turn.id, { rating: r })} retryLabel={turn.stopped ? t('retry') : t('regenerate')} disabled={busy}
                      onRetry={() => restream(turn, turn.stopped && !turn.shown ? turn.v : (turn.v + 1) % n)}>
                      {n > 1 && <>
                        <IconButton icon={<Icon name="chevronLeft" size={14} className="ui-flip" />} label={t('prevVersion')} disabled={busy} onClick={() => restream(turn, (turn.v - 1 + n) % n)} />
                        <span className="text-xs tabular-nums">{t('versionOf', { n: turn.v + 1, total: n })}</span>
                        <IconButton icon={<Icon name="chevronRight" size={14} className="ui-flip" />} label={t('nextVersion')} disabled={busy} onClick={() => restream(turn, (turn.v + 1) % n)} />
                      </>}
                    </MessageActions>)}
                </>}
              </motion.div>
            </div>
          )
        })}
      </AiChatLog>
      <AiSlashInput commands={commands} placeholder={placeholder} busy={busy} onSend={ask} onStop={stop} />
    </div>
  )
}

/* Agent composer ─────────────────────────────────────────────────────────── */

export type ComposerMode = { id: string; label: string; desc: string; icon: IconName; tone: Tone }
export type Connector = { name: string; desc: string; color: string; on: boolean }
export type ComposerModel = { name: string; vendor: string; speeds: string[]; efforts: string[] }
export type WorkspaceItem = { label: string; title: string; sub: string; icon: string }

/** AgentComposer's strings, including its default permission modes and model. */
export const COMPOSER_MESSAGES = defineMessages('composer', {
  en: {
    modeAsk: 'Ask for approval', modeAskDesc: 'Pause before every tool call, edit or message, and ask you first.', modeApprove: 'Approve for me',
    modeApproveDesc: 'Handle routine steps automatically; ask only for risky ones.', modeYolo: 'YOLO', modeYoloDesc: 'Full autonomy. Runs everything without asking.',
    defaultModel: 'Default model', defaultVendor: 'Assistant', normal: 'Normal', medium: 'Medium',
    approvedRan: '✓ Approved. The action ran.', approvedUnsure: 'Approved. The app hasn’t confirmed that the action ran.', denied: 'Not approved. The action was not run.',
    deniedUnsure: 'Not approved. The app hasn’t confirmed whether anything ran.', actOn: 'Act on: “{q}”', working: 'Assistant is working…', messageSent: 'Message sent',
    failed: 'Something went wrong. Try again.', answerSr: 'Assistant: {text}', needsApprovalSr: 'Assistant: {text} Needs your approval: {tool}, {summary}',
    queueFull: 'Queue is full', queueFullDesc: 'Up to {max, number} follow-ups can wait; send this one when the queue clears.',
    phInput: 'Approve or deny above to continue', phBusy: 'Working… type to queue a follow-up', phAttached: 'Add a message, or just send', phIdle: 'Ask anything, or drop files here',
    workspace: 'Workspace', ctxAdded: '{count, number} added as context', itemsTap: '{count, plural, one {# item} other {# items}} · tap to add context',
    wsHint: 'Click an item or select text to add it as context', wsHintTouch: 'Tap an item, or select text and tap “Add to chat”', hero: 'What should we work on?',
    conversation: 'Conversation', queued: 'Queued', files: '{count, plural, one {# file} other {# files}}', contextOnly: 'Context only', removeQueued: 'Remove queued message',
    drop: 'Drop files to attach', dropSub: 'Images, PDFs, code, anything', remove: 'Remove {name}', clear: 'Clear', addFiles: 'Add files', upload: 'Upload files',
    uploadDesc: 'From your computer', photos: 'Add photos', photosDesc: 'Images and screenshots', permMode: 'Permission mode: {mode}', permModeLabel: 'Permission mode',
    connectors: 'Connectors', searchConnectors: 'Search connectors and MCP servers', searchConnectorsLabel: 'Search connectors', noConnectors: 'No connectors match',
    onOf: '{on, number} of {total, number} on', addConnector: '+ Add connector',
    modelSettings: 'Model settings', model: 'Model', speed: 'Speed', effort: 'Effort', oneSpeed: '{model} has one speed setting', oneEffort: '{model} has one effort setting',
    vendorOptions: '{vendor} options for {model}', toolsConnected: 'Tools: {count, number} connected', manage: 'Manage', advanced: 'Advanced settings', creativity: 'Creativity',
    memory: 'Use memory', memorySub: 'Remember preferences across chats', cites: 'Show citations', citesSub: 'Link claims to sources', web: 'Web search', webSub: 'Search when it helps',
    statusWorking: 'Working', statusQueued: '{count, number} queued', statusInput: 'Needs your input', addToChat: 'Add to chat', retry: 'Retry', regenerate: 'Regenerate',
  },
  de: {
    modeAsk: 'Um Freigabe bitten', modeAskDesc: 'Vor jedem Werkzeugaufruf, jeder Änderung und Nachricht anhalten und erst fragen.', modeApprove: 'Für mich freigeben',
    modeApproveDesc: 'Routineschritte selbst erledigen; nur bei riskanten fragen.', modeYolo: 'YOLO', modeYoloDesc: 'Volle Autonomie. Führt alles aus, ohne zu fragen.',
    defaultModel: 'Standardmodell', defaultVendor: 'Assistent', normal: 'Normal', medium: 'Mittel',
    approvedRan: '✓ Freigegeben. Die Aktion wurde ausgeführt.', approvedUnsure: 'Freigegeben. Die App hat nicht bestätigt, dass die Aktion ausgeführt wurde.', denied: 'Nicht freigegeben. Die Aktion wurde nicht ausgeführt.',
    deniedUnsure: 'Nicht freigegeben. Die App hat nicht bestätigt, ob etwas ausgeführt wurde.', actOn: 'Ausführen: „{q}“', working: 'Der Assistent arbeitet …', messageSent: 'Nachricht gesendet',
    failed: 'Etwas ist schiefgelaufen. Versuch es noch einmal.', answerSr: 'Assistent: {text}', needsApprovalSr: 'Assistent: {text} Braucht deine Freigabe: {tool}, {summary}',
    queueFull: 'Warteschlange ist voll', queueFullDesc: 'Bis zu {max, number} Anschlussnachrichten können warten; sende diese, wenn die Warteschlange frei ist.',
    phInput: 'Oben freigeben oder ablehnen, um weiterzumachen', phBusy: 'Arbeitet … tippe, um eine Anschlussfrage einzureihen', phAttached: 'Nachricht hinzufügen oder einfach senden', phIdle: 'Frag etwas oder leg Dateien hier ab',
    workspace: 'Arbeitsbereich', ctxAdded: '{count, number} als Kontext hinzugefügt', itemsTap: '{count, plural, one {# Element} other {# Elemente}} · tippen, um Kontext hinzuzufügen',
    wsHint: 'Klicke ein Element an oder markiere Text, um ihn als Kontext hinzuzufügen', wsHintTouch: 'Tippe auf ein Element oder markiere Text und tippe auf „Zum Chat hinzufügen“', hero: 'Woran arbeiten wir?',
    conversation: 'Unterhaltung', queued: 'Eingereiht', files: '{count, plural, one {# Datei} other {# Dateien}}', contextOnly: 'Nur Kontext', removeQueued: 'Eingereihte Nachricht entfernen',
    drop: 'Dateien zum Anhängen ablegen', dropSub: 'Bilder, PDFs, Code, alles', remove: '{name} entfernen', clear: 'Leeren', addFiles: 'Dateien hinzufügen', upload: 'Dateien hochladen',
    uploadDesc: 'Von deinem Computer', photos: 'Fotos hinzufügen', photosDesc: 'Bilder und Bildschirmfotos', permMode: 'Berechtigungsmodus: {mode}', permModeLabel: 'Berechtigungsmodus',
    connectors: 'Konnektoren', searchConnectors: 'Konnektoren und MCP-Server suchen', searchConnectorsLabel: 'Konnektoren suchen', noConnectors: 'Keine passenden Konnektoren',
    onOf: '{on, number} von {total, number} aktiv', addConnector: '+ Konnektor hinzufügen',
    modelSettings: 'Modelleinstellungen', model: 'Modell', speed: 'Tempo', effort: 'Aufwand', oneSpeed: '{model} hat nur eine Tempo-Stufe', oneEffort: '{model} hat nur eine Aufwandsstufe',
    vendorOptions: '{vendor}-Optionen für {model}', toolsConnected: 'Werkzeuge: {count, number} verbunden', manage: 'Verwalten', advanced: 'Erweiterte Einstellungen', creativity: 'Kreativität',
    memory: 'Gedächtnis nutzen', memorySub: 'Vorlieben über Chats hinweg merken', cites: 'Quellen anzeigen', citesSub: 'Aussagen mit Quellen verknüpfen', web: 'Websuche', webSub: 'Suchen, wenn es hilft',
    statusWorking: 'Arbeitet', statusQueued: '{count, number} eingereiht', statusInput: 'Wartet auf dich', addToChat: 'Zum Chat hinzufügen', retry: 'Erneut versuchen', regenerate: 'Neu erzeugen',
  },
  ar: {
    modeAsk: 'طلب الموافقة', modeAskDesc: 'التوقف قبل كل استدعاء أداة أو تعديل أو رسالة وسؤالك أولًا.', modeApprove: 'الموافقة نيابةً عني',
    modeApproveDesc: 'تنفيذ الخطوات الروتينية تلقائيًا؛ والسؤال عن الخطرة فقط.', modeYolo: 'YOLO', modeYoloDesc: 'استقلالية كاملة. ينفّذ كل شيء دون سؤال.',
    defaultModel: 'النموذج الافتراضي', defaultVendor: 'المساعد', normal: 'عادي', medium: 'متوسط',
    approvedRan: '✓ تمت الموافقة. نُفّذ الإجراء.', approvedUnsure: 'تمت الموافقة. لم يؤكّد التطبيق تنفيذ الإجراء.', denied: 'لم تتم الموافقة. لم يُنفَّذ الإجراء.',
    deniedUnsure: 'لم تتم الموافقة. لم يؤكّد التطبيق ما إذا كان شيء قد نُفّذ.', actOn: 'تنفيذ: «{q}»', working: 'المساعد يعمل…', messageSent: 'أُرسلت الرسالة',
    failed: 'حدث خطأ ما. حاول مجددًا.', answerSr: 'المساعد: {text}', needsApprovalSr: 'المساعد: {text} بحاجة إلى موافقتك: {tool}، {summary}',
    queueFull: 'قائمة الانتظار ممتلئة', queueFullDesc: 'يمكن أن تنتظر حتى {max, number} رسائل متابعة؛ أرسل هذه عندما تفرغ القائمة.',
    phInput: 'وافق أو ارفض أعلاه للمتابعة', phBusy: 'يعمل… اكتب لإضافة متابعة إلى الانتظار', phAttached: 'أضف رسالة، أو أرسل مباشرة', phIdle: 'اسأل عن أي شيء، أو أفلِت الملفات هنا',
    workspace: 'مساحة العمل', ctxAdded: 'أُضيف {count, number} كسياق', itemsTap: '{count, plural, one {عنصر واحد} two {عنصران} few {# عناصر} many {# عنصرًا} other {# عنصر}} · انقر لإضافة سياق',
    wsHint: 'انقر على عنصر أو حدّد نصًا لإضافته كسياق', wsHintTouch: 'انقر على عنصر، أو حدّد نصًا وانقر «إضافة إلى المحادثة»', hero: 'على ماذا نعمل؟',
    conversation: 'المحادثة', queued: 'في الانتظار', files: '{count, plural, one {ملف واحد} two {ملفان} few {# ملفات} many {# ملفًا} other {# ملف}}', contextOnly: 'سياق فقط', removeQueued: 'إزالة الرسالة المنتظرة',
    drop: 'أفلِت الملفات لإرفاقها', dropSub: 'صور، ملفات PDF، شيفرة، أي شيء', remove: 'إزالة {name}', clear: 'مسح', addFiles: 'إضافة ملفات', upload: 'رفع ملفات',
    uploadDesc: 'من جهازك', photos: 'إضافة صور', photosDesc: 'صور ولقطات شاشة', permMode: 'وضع الأذونات: {mode}', permModeLabel: 'وضع الأذونات',
    connectors: 'الموصِّلات', searchConnectors: 'ابحث في الموصِّلات وخوادم MCP', searchConnectorsLabel: 'البحث في الموصِّلات', noConnectors: 'لا توجد موصِّلات مطابقة',
    onOf: '{on, number} من {total, number} مفعّلة', addConnector: '+ إضافة موصِّل',
    modelSettings: 'إعدادات النموذج', model: 'النموذج', speed: 'السرعة', effort: 'الجهد', oneSpeed: 'لدى {model} إعداد سرعة واحد', oneEffort: 'لدى {model} إعداد جهد واحد',
    vendorOptions: 'خيارات {vendor} لـ {model}', toolsConnected: 'الأدوات: {count, number} متصلة', manage: 'إدارة', advanced: 'إعدادات متقدمة', creativity: 'الإبداع',
    memory: 'استخدام الذاكرة', memorySub: 'تذكّر التفضيلات بين المحادثات', cites: 'إظهار المصادر', citesSub: 'ربط الادعاءات بمصادرها', web: 'البحث على الويب', webSub: 'البحث عندما يفيد',
    statusWorking: 'يعمل', statusQueued: '{count, number} في الانتظار', statusInput: 'بانتظار إدخالك', addToChat: 'إضافة إلى المحادثة', retry: 'إعادة المحاولة', regenerate: 'إعادة التوليد',
  },
})
type AcT = ReturnType<typeof useMessages<keyof typeof COMPOSER_MESSAGES.en>>
/** The default permission modes, in the reader's language. */
const acModes = (t: AcT): ComposerMode[] => [
  { id: 'ask', label: t('modeAsk'), desc: t('modeAskDesc'), icon: 'hand', tone: 'accent' },
  { id: 'approve', label: t('modeApprove'), desc: t('modeApproveDesc'), icon: 'shield', tone: 'ok' },
  { id: 'yolo', label: t('modeYolo'), desc: t('modeYoloDesc'), icon: 'rocket', tone: 'warn' },
]
/** Used when no `models` are passed: one model with one speed and effort. */
const acModels = (t: AcT): ComposerModel[] => [{ name: t('defaultModel'), vendor: t('defaultVendor'), speeds: [t('normal')], efforts: [t('medium')] }]
/** Demo-only fallback for `needsApproval`: a word match over the person's text. Real apps return `needsApproval` from onSend. */
const AC_RISKY = /send|email|remind|create|open|post|deploy|delete/i
const AC_DEMO_NEEDS_APPROVAL = (text: string) => AC_RISKY.test(text)
const AC_NONE: WorkspaceItem[] = [], AC_NO_CONNECTORS: Connector[] = [], AC_NO_SAMPLES: ComposerSample[] = []
/** Most messages kept in the conversation and in the follow-up queue (older messages drop off the top). */
const AC_MAX_MSGS = 200, AC_MAX_QUEUE = 10, AC_MAX_FILES = 20

/** Settings the composer's model panel and Advanced settings dialog edit. */
export type ComposerSettings = { model: string; speed: string; effort: string; temp: number; memory: boolean; cites: boolean; web: boolean }
/** Extra context for `onSend`: the permission mode, the model settings and the connectors that are switched on. */
export type ComposerSendMeta = { mode: ComposerMode; settings: ComposerSettings; connectors: string[] }
/**
 * An action the host wants to run and needs the person to approve first. Shown on the approval card exactly as given
 * (tool, summary, recipients, args), never paraphrased by the model.
 */
export type ComposerAction = { tool: string; summary: string; args?: Record<string, unknown>; recipients?: string[] }
/** What onSend can return instead of a string: the reply to stream and, optionally, an action that needs approval. */
export type ComposerReply = { text?: string; needsApproval?: ComposerAction }
/** A canned attachment offered in the + menu (e.g. a sample file in a demo). */
export type ComposerSample = { title: string; desc: string; files: () => File[] }

type AcFile = Attachment
type AcDraft = { id: number; text: string; files: AcFile[]; ctx: string[] }
/** ok / no: the host confirmed the action ran / didn't run; ok? / no?: the host didn't confirm (or there is no host action). */
type AcApproval = 'busy' | 'ok' | 'ok?' | 'no' | 'no?'
type AcMsg = { id: number; role: 'u' | 'a'; d?: AcDraft; q?: string; text?: string; model?: string; mode?: ComposerMode; phase?: 'wait' | 'stream' | 'approve' | 'done'; note?: string
  action?: ComposerAction; demo?: boolean; approval?: AcApproval }
const AC_APPROVAL_TEXT = { ok: 'approvedRan', 'ok?': 'approvedUnsure', no: 'denied', 'no?': 'deniedUnsure' } as const satisfies Record<Exclude<AcApproval, 'busy'>, string>
// keep the closest step when the new model has a different enum
const acNearest = (list: string[], prev: string, prevList: string[]) => list.includes(prev) ? prev : list[Math.round((Math.max(0, prevList.indexOf(prev)) / Math.max(1, prevList.length - 1)) * (list.length - 1))] ?? list[0]

const AC_BAR = '!h-8 !gap-0 !rounded-full !px-2 text-xs text-[var(--fg2)] hover:text-[var(--fg)] aria-expanded:!bg-[var(--muted)] aria-expanded:text-[var(--fg)] [@media(pointer:coarse)]:!h-10 [@media(pointer:coarse)]:min-w-10'
/** A composer bar button: icon whose label slides out on hover, focus or while its panel is open. On phones (`compact`) it is an IconButton. */
function AcBarButton({ icon, label, expanded, onClick, className, children, haspopup = 'menu', compact, controls }:
  { icon: ReactNode; label: string; expanded: boolean; onClick: () => void; className?: string; children: ReactNode; haspopup?: 'menu' | 'dialog'; compact?: boolean; controls: string }) {
  const aria = { 'aria-haspopup': haspopup, 'aria-expanded': expanded, 'aria-controls': controls }
  // on phones the label stays hidden (the panel names itself), so the bar never overflows
  if (compact) return <IconButton icon={icon} label={label} tone="default" {...aria} onClick={onClick} className={cn(AC_BAR, '!w-8 [@media(pointer:coarse)]:!w-10', className)} />
  return (
    <Button variant="ghost" size="sm" aria-label={label} {...aria} onClick={onClick} className={cn('group', AC_BAR, className)}>
      <span className="grid flex-none place-items-center">{icon}</span>{/* rtl-lint-ignore: the label slides in from the start side (rtl: twins) */}
      <span className="inline-flex max-w-0 -translate-x-1 items-center gap-1 overflow-hidden whitespace-nowrap opacity-0 transition-all duration-300 ease-[cubic-bezier(.2,.8,.2,1)] group-hover:ms-1.5 group-hover:max-w-[180px] group-hover:translate-x-0 group-hover:opacity-100 group-focus-visible:ms-1.5 group-focus-visible:max-w-[180px] group-focus-visible:translate-x-0 group-focus-visible:opacity-100 group-aria-expanded:ms-1.5 group-aria-expanded:max-w-[180px] group-aria-expanded:translate-x-0 group-aria-expanded:opacity-100 rtl:translate-x-1 rtl:group-hover:translate-x-0 rtl:group-focus-visible:translate-x-0 rtl:group-aria-expanded:translate-x-0">{children}</span>
    </Button>
  )
}

/**
 * A composer panel (menu or dialog) on the shared FloatingPanel: opens above the bar (below when there's no room), and
 * on phones (`narrow`) spans the whole composer. Menus (`menu` = row count) move with ↑ ↓ Home End and focus the checked
 * or first row on open; Escape closes and hands focus back to the bar button.
 */
function AcPanel({ id, open, wide, narrow, label, menu, children, onClose }:
  { id: string; open: boolean; wide?: boolean; narrow?: boolean; label: string; menu?: number; children: ReactNode; onClose: () => void }) {
  const [fi, setFi] = useState(0)
  const rows = () => [...(document.getElementById(id)?.querySelectorAll<HTMLElement>('[role^=menuitem]') ?? [])]
  const roving = useRoving(menu ?? 0, i => rows()[i]?.click(), { index: fi, onMove: i => rows()[i]?.focus() })
  useEffect(() => {
    if (!open || !menu) return
    const r = requestAnimationFrame(() => { const el = rows(); (el.find(x => x.getAttribute('aria-checked') === 'true') ?? el[0])?.focus({ preventScroll: true }) })
    return () => cancelAnimationFrame(r)
  }, [open, menu]) // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <FloatingPanel open={open} id={id} placement="top-start" matchWidth={narrow} role={menu ? 'menu' : 'dialog'} aria-label={label}
      onFocus={e => { const i = rows().indexOf(e.target as HTMLElement); if (i >= 0) setFi(i) }}
      onKeyDown={(e: RKeyboardEvent<HTMLDivElement>) => {
        if (e.key === 'Escape') { e.stopPropagation(); onClose(); document.querySelector<HTMLElement>(`[aria-controls="${id}"]`)?.focus(); return }
        if (menu) roving.onKeyDown(e)
      }}
      className={cn('max-h-[min(440px,70dvh)] cursor-default overflow-y-auto overscroll-contain !rounded-[var(--r-lg)]', narrow ? '!w-full' : wide ? 'w-[300px]' : 'min-w-[240px]')}>
      {children}
    </FloatingPanel>
  )
}

/** Icon tile, title and description: the body of a composer menu row. */
function AcRowBody({ icon, title, desc, warn }: { icon: IconName; title: string; desc: string; warn?: boolean }) {
  return <>
    <span className={cn('grid h-7 w-7 flex-none place-items-center rounded-[var(--r-md)] bg-[var(--muted)]', warn ? 'text-[var(--warn)]' : 'text-[var(--fg)]')}><Icon name={icon} size={15} /></span>
    <span className="flex min-w-0 flex-1 flex-col"><b className={cn('text-[13px] font-medium', warn && 'text-[var(--warn)]')}>{title}</b><span className="text-xs leading-snug text-[var(--fg3)]">{desc}</span></span>
  </>
}
const AC_ROW = '!items-start !justify-start !gap-3 !p-2 [@media(pointer:coarse)]:!py-2.5'
/** MenuItem wraps its content in one more flex row: align that the same way. */
const AC_ITEM = AC_ROW + ' [&>span]:!items-start [&>span]:!gap-3 [&>span]:min-w-0 [&>span]:flex-1'
/** One choice in the permission-mode menu (menuitemradio; MenuItem has no radio role). */
function AcModeRow({ mode, checked, onPick }: { mode: ComposerMode; checked: boolean; onPick: () => void }) {
  return (
    <button type="button" role="menuitemradio" aria-checked={checked} tabIndex={-1} onClick={onPick} className={cn(menuItemClass, AC_ROW)}>
      <AcRowBody icon={mode.icon} title={mode.label} desc={mode.desc} warn={mode.tone === 'warn'} />
      {checked && <Icon name="check" size={14} strokeWidth={2.6} className="mt-1.5" />}
    </button>
  )
}

function AcStepSlider({ title, list, value, onChange, single }: { title: string; list: string[]; value: string; onChange: (v: string) => void; /** shown when there is only one step */ single: string }) {
  if (list.length < 2) return <div className="flex flex-col gap-1 text-[13px]"><span className="flex justify-between">{title}<b className="font-medium">{value}</b></span><span className="text-xs text-[var(--fg3)]">{single}</span></div>
  return <Slider label={title} steps={list} value={Math.max(0, list.indexOf(value))} onChange={i => onChange(list[i])} />
}

/** The person's message in AgentComposer: a muted bubble with its tail on the inline end. */
const AC_USER_BUBBLE = 'rounded-[16px] rounded-ee-[4px] bg-[var(--muted)] px-3 py-2 text-[13px] leading-normal break-words whitespace-pre-wrap'
/** One message of AgentComposer's log when it runs on useAiChat: the composer's user bubble (with its context chips), or the assistant's streamed parts. */
function AcLiveMessage({ m, chat, renderers }: { m: AiMessage; chat: AiChat; renderers?: AiRenderers }) {
  const t = useMessages(COMPOSER_MESSAGES)
  if (m.role === 'user') {
    const ctx = Array.isArray(m.metadata?.context) ? (m.metadata!.context as unknown[]).map(String) : []
    const files = m.parts.filter((p): p is AiFilePart => p.type === 'file'), text = aiMessageText(m)
    return (
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={spring(0.3, 0.35)} className="flex max-w-[82%] flex-col items-end gap-1 self-end">
        {(ctx.length > 0 || files.length > 0) && <div className="flex flex-wrap justify-end gap-1">{ctx.map(c => <Badge key={c} tone="accent">{c}</Badge>)}{files.map((f, i) => <Badge key={i}>📎 {f.name}</Badge>)}</div>}
        {text && <div dir="auto" className={AC_USER_BUBBLE}>{text}</div>}
      </motion.div>
    )
  }
  const last = chat.messages[chat.messages.length - 1]?.id === m.id
  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={spring(0.3, 0.35)} className="flex max-w-[88%] min-w-0 flex-col gap-1.5 px-0.5">
      <MessageParts message={m} renderers={renderers} onDecideTool={chat.decideTool} onRetry={last ? chat.regenerate : undefined} />
      {m.status !== 'streaming' && <MessageActions text={() => aiMessageText(m)} stopped={m.stopped} feedback={false} onRetry={last ? chat.regenerate : undefined} retryLabel={m.stopped || m.status === 'error' ? t('retry') : t('regenerate')} disabled={chat.busy} />}
    </motion.div>
  )
}

/**
 * Agent composer that doubles as a control panel. A workspace beside it (`items`, `doc`) adds context (click an item, or
 * select text and "Add to chat"; on phones it folds into a toggle and the bar shows icons only, its panels spanning the
 * composer). Attach with +, drag and drop or paste (file chips with upload progress). Pick a permission mode, toggle
 * connectors, choose the model with per-model speed/effort steps, and open advanced settings.
 *
 * `onSend(text, files, context, meta)` runs for each message (queued ones when their turn comes). Return the reply text
 * (or a promise of it) to stream it in the conversation; return nothing to only show the message. While a reply streams,
 * new messages queue as follow-ups (up to 10). The empty hero glides into the conversation on first send.
 *
 * Approvals come from the host: return `{ text, needsApproval: { tool, summary, args, recipients } }` from onSend
 * WITHOUT running the action. The card shows that action as given; on Approve or Deny the composer awaits
 * `onApprovalRequest(action, approved)`, where the host runs the action only if approved and resolves true when it ran
 * (approve) or to confirm nothing ran (deny). Without that confirmation the card says so instead of claiming an outcome.
 * `needsApproval` (a text test, default: a word match for send, email, create, deploy…) is a demo fallback only: it
 * applies when onSend returns a plain string in "Ask for approval" mode, after onSend already ran, so it can't stop anything.
 *
 * Real model: pass `chat` from useAiChat instead of onSend. Replies stream in as parts (`renderers` as in MessageParts,
 * e.g. AI_RICH_RENDERERS for Markdown), tool calls that need approval show the same card and wait for `chat.decideTool`
 * (run the tool in useAiChat's `onApprovalRequest`), and with an empty composer the send button stops the reply.
 * Advanced settings (creativity, memory, citations, web search) open inside the model-settings panel.
 */
export function AgentComposer({ chat: live, onSend, onApprovalRequest, items = AC_NONE, doc, modes: modesProp, connectors = AC_NO_CONNECTORS, models: modelsProp, samples = AC_NO_SAMPLES,
  needsApproval = AC_DEMO_NEEDS_APPROVAL, hero, hint, renderers, onAddConnector, className }:
  { /**
     * A real chat from useAiChat. Each message goes to `chat.submit(text, files, { metadata: { context, mode, settings, connectors } })`
     * (onSend is not called), replies render as streamed parts, tool approvals use the chat's `decideTool`, and Send
     * becomes Stop while a reply streams (type to queue a follow-up instead).
     */
    chat?: AiChat
    onSend?: (text: string, files: File[], context: string[], meta: ComposerSendMeta) => string | ComposerReply | void | Promise<string | ComposerReply | void>
    /** The person approved or denied `action` (from onSend's needsApproval). Run it now only if approved; resolve true when it ran (approve) or to confirm nothing ran (deny). */
    onApprovalRequest?: (action: ComposerAction, approved: boolean) => Promise<boolean>
    items?: WorkspaceItem[]; doc?: string; modes?: ComposerMode[]; connectors?: Connector[]; models?: ComposerModel[]; samples?: ComposerSample[]
    /** Demo fallback: which plain-string replies get a (non-blocking) approval card. Prefer returning needsApproval from onSend. */
    needsApproval?: (text: string) => boolean; hero?: string; hint?: string
    /** live mode: how text and tool data render (see MessageParts) */ renderers?: AiRenderers
    /** shows "+ Add connector" in the connectors panel (open your connector or MCP directory) */ onAddConnector?: () => void; className?: string }) {
  const t = useMessages(COMPOSER_MESSAGES), { fmt } = useLocale()
  const [full, setFull] = useState(false) // the follow-up queue refused a message: said in the status slot until the queue moves
  const modes = modesProp ?? acModes(t), models = modelsProp ?? acModels(t)
  const reduce = useReducedMotion()
  const [chat, setChat] = useState(!!live?.messages.length)
  const [text, setText] = useState('')
  const att = useAttachments({ max: AC_MAX_FILES }), files = att.files
  const [ctx, setCtx] = useState<string[]>([])
  const [mode, setMode] = useState(modes[1]?.id ?? modes[0].id)
  const [cons, setCons] = useState(connectors)
  const [conQ, setConQ] = useState('')
  const [S, setS] = useState<ComposerSettings>({ model: models[0].name, speed: models[0].speeds[0], effort: models[0].efforts[Math.min(1, models[0].efforts.length - 1)], temp: 0.7, memory: true, cites: true, web: true })
  const [adv, setAdv] = useState(false) // the advanced section of the settings panel
  const [pop, setPop] = useState<null | 'add' | 'mode' | 'con' | 'set'>(null)
  const [msgs, setMsgs] = useState<AcMsg[]>([])
  const [queue, setQueue] = useState<AcDraft[]>([])
  const [submitting, setSubmitting] = useState(false)
  const [said, setSaid] = useState('') // short summaries for screen readers
  const [sel, setSel] = useState<{ x: number; y: number; bottom: number; text: string } | null>(null)
  const narrow = useMediaQuery('(max-width: 639px)'), coarse = useCoarsePointer()
  const [wsOpen, setWsOpen] = useState(false) // phones: the workspace folds into a toggle above the composer
  const inp = useRef<HTMLTextAreaElement>(null), docRef = useRef<HTMLParagraphElement>(null), logRef = useRef<HTMLDivElement>(null)
  const barRef = useRef<HTMLDivElement>(null), mid = useRef(0), alive = useRef(true)
  const pid = useId(), panelId = (k: string) => `${pid}-${k}`
  const liveWaiting = !!live && live.messages.some(m => m.parts.some(p => p.type === 'tool' && p.state === 'awaiting-approval'))
  const busy = live ? live.busy || liveWaiting : msgs.some(m => m.role === 'a' && m.phase !== 'done')
  const streaming = live ? live.status === 'streaming' : msgs.some(m => m.phase === 'stream')
  const waiting = live ? liveWaiting : msgs.some(m => m.phase === 'approve')
  const queueRef = useRef(queue); queueRef.current = queue
  const approve = useRef(onApprovalRequest); approve.current = onApprovalRequest
  const curMode = modes.find(m => m.id === mode) ?? modes[0]
  const model = models.find(m => m.name === S.model) ?? models[0]
  const onCount = cons.filter(c => c.on).length
  const status = waiting ? 'input' : busy ? (queue.length ? 'queued' : 'working') : 'idle'
  useEffect(() => setFull(false), [queue.length])
  const workspace = items.length > 0 || !!doc

  useOutside([barRef], () => setPop(null), !!pop)
  useEffect(() => { const el = logRef.current; if (el && !live) el.scrollTo({ top: el.scrollHeight, behavior: reduce ? 'auto' : 'smooth' }) }, [msgs, reduce, live])
  useEffect(() => { alive.current = true; return () => { alive.current = false } }, [])
  useEffect(() => { if (live && !busy) next() }, [live, busy]) // eslint-disable-line react-hooks/exhaustive-deps -- a live reply finished: send the next queued follow-up

  /* selection → "Add to chat". Mouse: on mouseup. Touch: selection handles fire selectionchange, so follow that
     (debounced, and a cleared selection lingers briefly so tapping the button still works after iOS drops it). */
  useEffect(() => {
    let t: ReturnType<typeof setTimeout> | undefined
    const read = () => {
      const s = getSelection(), txt = s?.toString().trim()
      if (!txt || !s || !s.rangeCount || !docRef.current?.contains(s.anchorNode)) return false
      const r = s.getRangeAt(0).getBoundingClientRect(); setSel({ x: r.left + r.width / 2, y: r.top, bottom: r.bottom, text: txt }); return true
    }
    const up = () => setTimeout(() => { if (!read()) setSel(null) }, 0)
    const change = () => { clearTimeout(t); t = setTimeout(() => { if (!read()) setSel(null) }, read() ? 120 : 400) }
    const scroll = (e: Event) => { if (!(e.target instanceof Node) || !docRef.current?.contains(e.target)) setSel(null) }
    document.addEventListener('mouseup', up); document.addEventListener('selectionchange', change); addEventListener('scroll', scroll, true)
    return () => { clearTimeout(t); document.removeEventListener('mouseup', up); document.removeEventListener('selectionchange', change); removeEventListener('scroll', scroll, true) }
  }, [])
  const takeSel = () => { if (!sel) return; addCtx(`“${sel.text}”`); getSelection()?.removeAllRanges(); setSel(null) }

  const addFiles = (list: FileList | File[]) => { att.add(Array.from(list).slice(0, 8)); inp.current?.focus() }
  const addCtx = (label: string) => { setCtx(c => c.includes(label) ? c : [...c, label]); inp.current?.focus() }
  const toggleCtx = (label: string) => ctx.includes(label) ? setCtx(c => c.filter(x => x !== label)) : addCtx(label)

  const patchMsg = (id: number, p: Partial<AcMsg>) => setMsgs(ms => ms.map(x => x.id === id ? { ...x, ...p } : x))
  const addMsg = (m: AcMsg) => setMsgs(ms => [...ms, m].slice(-AC_MAX_MSGS))
  /** A reply from onSend as message fields: plain strings may get the demo approval fallback, objects carry the host's action. */
  const toReply = (r: string | ComposerReply, q: string): Partial<AcMsg> => {
    if (typeof r === 'string') return { text: r, ...(curMode.id === 'ask' && needsApproval(q) ? { action: { tool: cons.find(c => c.on)?.name ?? 'assistant', summary: t('actOn', { q }) }, demo: true } : {}) }
    return { text: r.text ?? '', action: r.needsApproval }
  }
  const run1 = (d: AcDraft) => {
    setChat(true)
    if (live) {
      live.submit(d.text, d.files.map(f => f.file), { metadata: { context: d.ctx, mode: curMode.id, settings: S, connectors: cons.filter(c => c.on).map(c => c.name) } })
      setSaid(t('working')); return
    }
    const id = ++mid.current
    addMsg({ id, role: 'u', d })
    const reply = onSend?.(d.text, d.files.map(f => f.file), d.ctx, { mode: curMode, settings: S, connectors: cons.filter(c => c.on).map(c => c.name) })
    if (reply == null) { setSaid(t('messageSent')); setTimeout(next, 0); return }
    const aid = ++mid.current, base: AcMsg = { id: aid, role: 'a', q: d.text, model: S.model, mode: curMode }
    const show = (r: string | ComposerReply) => { const p = toReply(r, d.text); return { ...p, phase: p.text ? 'stream' as const : p.action ? 'approve' as const : 'done' as const } }
    if (typeof (reply as Promise<unknown>).then !== 'function') { const p = show(reply as string | ComposerReply); addMsg({ ...base, ...p }); if (p.phase === 'done') next(); return }
    addMsg({ ...base, text: '', phase: 'wait' }); setSaid(t('working'))
    ;(reply as Promise<string | ComposerReply | void>).then(r => { if (!alive.current) return; const p = r == null ? { phase: 'done' as const } : show(r); patchMsg(aid, p); if (p.phase === 'done') next() },
      () => { if (alive.current) patchMsg(aid, { text: t('failed'), phase: 'stream' }) })
  }
  function next() {
    const q = queueRef.current
    if (q.length) { const [nx, ...rest] = q; setQueue(rest); setTimeout(() => run1(nx), 250) }
  }
  const streamDone = (m: AcMsg) => {
    if (m.action) { patchMsg(m.id, { phase: 'approve' }); setSaid(t('needsApprovalSr', { text: m.text ?? '', tool: m.action.tool, summary: m.action.summary })); return }
    patchMsg(m.id, { phase: 'done' }); setSaid(t('answerSr', { text: m.text ?? '' })); next()
  }
  const deciding = useRef(new Set<number>())
  const decide = async (m: AcMsg, ok: boolean) => {
    if (m.approval || deciding.current.has(m.id)) return
    deciding.current.add(m.id)
    patchMsg(m.id, { approval: 'busy' })
    let confirmed = false // only the host can say whether the action ran
    if (m.action && !m.demo && approve.current) { try { confirmed = (await approve.current(m.action, ok)) === true } catch { confirmed = false } }
    if (!alive.current) return
    const approval: AcApproval = ok ? (confirmed ? 'ok' : 'ok?') : (confirmed ? 'no' : 'no?')
    patchMsg(m.id, { phase: 'done', approval }); setSaid(t(AC_APPROVAL_TEXT[approval])); next()
  }

  const takeDraft = (): AcDraft => {
    const d = { id: ++mid.current, text: text.trim(), files: files.map(f => ({ ...f, url: null })), ctx } // previews only live in the composer; the sent message lists names
    att.clear(); setText(''); setCtx([]); return d
  }
  const canSend = !waiting && !submitting && (!!text.trim() || files.length > 0 || ctx.length > 0)
  const canStop = !!live && live.busy && !text.trim() && !files.length && !ctx.length // live: an empty composer stops the reply
  const submit = () => {
    if (!canSend) return
    if (busy) { if (queue.length >= AC_MAX_QUEUE) { setFull(true); setSaid(t('queueFullDesc', { max: AC_MAX_QUEUE })); return } setQueue(q => [...q, takeDraft()]); return }
    const d = takeDraft(); setSubmitting(true)
    setTimeout(() => { if (!alive.current) return; setSubmitting(false); run1(d) }, reduce ? 0 : 380)
  }
  const toggle = (k: NonNullable<typeof pop>) => setPop(p => p === k ? null : k)
  const close = () => setPop(null)
  const wordDelay = ({ 'Ultra fast': 14, Fast: 26, Priority: 30 } as Record<string, number>)[S.speed] ?? 45
  const placeholder = t(status === 'input' ? 'phInput' : busy ? 'phBusy' : files.length || ctx.length ? 'phAttached' : 'phIdle')
  const setModel = (name: string) => { const prev = model, m = models.find(x => x.name === name)!; setS(s => ({ ...s, model: name, speed: acNearest(m.speeds, s.speed, prev.speeds), effort: acNearest(m.efforts, s.effort, prev.efforts) })) }
  const shownCons = cons.filter(c => !conQ || (c.name + ' ' + c.desc).toLowerCase().includes(conQ.toLowerCase()))

  return (
    <div className={cn('grid gap-4 sm:min-h-[440px]', workspace && 'md:grid-cols-[240px_minmax(0,1fr)]', className)}>
      <span className="sr-only" aria-live="polite">{said}</span>
      {workspace && <aside aria-label={t('workspace')} className={cn(surface.card, 'flex flex-col gap-3 !bg-[var(--bg)] p-3 max-sm:gap-0 max-sm:p-0')}>
        {narrow
          ? <button type="button" aria-expanded={wsOpen} onClick={() => setWsOpen(o => !o)}
              className="flex min-h-11 w-full cursor-pointer items-center gap-2 rounded-[var(--r-lg)] border-0 bg-transparent px-3 text-start text-[13px] text-[var(--fg)]">
              <Icon name="file" size={15} className="text-[var(--fg3)]" /><b className="font-semibold">{t('workspace')}</b>
              <span className="min-w-0 flex-1 truncate text-xs text-[var(--fg3)]">{ctx.length ? t('ctxAdded', { count: ctx.length }) : t('itemsTap', { count: items.length })}</span>
              <motion.span className="grid text-[var(--fg3)]" animate={{ rotate: wsOpen ? 180 : 0 }} transition={spring(0.2, 0.3)}><Icon name="chevronDown" size={14} strokeWidth={2.5} /></motion.span>
            </button>
          : <div className="flex flex-col gap-0.5"><b className="text-[13px]">{t('workspace')}</b><span className="text-xs text-[var(--fg3)]">{t('wsHint')}</span></div>}
        <Collapse open={!narrow || wsOpen}><div className="flex flex-col gap-3 max-sm:px-3 max-sm:pb-3">
        {narrow && <span className="text-xs text-[var(--fg3)]">{t('wsHintTouch')}</span>}
        <div className="flex flex-col gap-1">
          {items.map(it => {
            const on = ctx.includes(it.label)
            return (
              <button key={it.label} type="button" aria-pressed={on} onClick={() => toggleCtx(it.label)}
                className={cn('flex cursor-pointer items-center gap-2.5 rounded-[var(--r-md)] border p-2 text-start transition-colors', on ? 'border-[var(--accent)] bg-[var(--accent-soft)]' : 'border-transparent bg-transparent hover:bg-[var(--muted)]')}>
                <span className="grid h-7 w-7 flex-none place-items-center rounded-[var(--r-md)] border border-[var(--line)] bg-[var(--card)] text-[13px]">{it.icon}</span>
                <span className="min-w-0"><b className="block text-[13px] font-medium">{it.title}</b><span className="block truncate text-xs text-[var(--fg3)]">{it.sub}</span></span>
              </button>
            )
          })}
        </div>
        {doc && <p ref={docRef} dir="auto" className={cn(surface.md, 'm-0 p-2 text-[13px] leading-relaxed text-[var(--fg2)] selection:bg-[var(--accent-soft)]')}>{doc}</p>}
        </div></Collapse>
      </aside>}

      <div className={cn('relative flex min-w-0 flex-col gap-3', !chat && 'items-center justify-center max-sm:pt-4')}>
        <AnimatePresence>{!chat && (
          <motion.div key="hero" exit={{ opacity: 0, y: -8, transition: { duration: 0.15 } }} className="flex flex-col items-center gap-1 text-center">
            <h4 className="m-0 text-[22px] font-semibold tracking-tight max-sm:text-base">{hero ?? t('hero')}</h4>{hint && <span dir="auto" className="text-xs text-[var(--fg3)]">{hint}</span>}
          </motion.div>)}</AnimatePresence>
        {chat && (
          <motion.div ref={logRef} role="log" aria-live="off" aria-busy={streaming} aria-label={t('conversation')} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4, delay: 0.15 }}
            className="flex max-h-[min(360px,55dvh)] flex-1 flex-col gap-3 overflow-auto px-0.5 py-1">
            {live ? live.messages.map(m => <AcLiveMessage key={m.id} m={m} chat={live} renderers={renderers} />) : msgs.map(m => m.role === 'u' ? (
              <motion.div key={m.id} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={spring(0.3, 0.35)} className="flex max-w-[82%] flex-col items-end gap-1 self-end">
                {(m.d!.ctx.length > 0 || m.d!.files.length > 0) && <div className="flex flex-wrap justify-end gap-1">{m.d!.ctx.map(c => <Badge key={c} tone="accent">{c}</Badge>)}{m.d!.files.map(f => <Badge key={f.id}>📎 {f.file.name}</Badge>)}</div>}
                {m.d!.text && <div dir="auto" className={AC_USER_BUBBLE}>{m.d!.text}</div>}
              </motion.div>
            ) : (
              <motion.div key={m.id} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={spring(0.3, 0.35)} className="flex max-w-[82%] flex-col gap-1.5">
                <div className="flex flex-wrap gap-1"><Badge>{m.model}</Badge><Badge tone={m.mode!.tone}>{m.mode!.label}</Badge></div>
                <div dir="auto" className="px-0.5 text-[13px] leading-normal">
                  {m.phase === 'wait' ? <TypingDots /> : m.phase === 'stream' ? <StreamingText text={m.text!} wordDelay={wordDelay} onDone={() => setTimeout(() => alive.current && streamDone(m), reduce ? 0 : 500)} /> : m.text}
                </div>
                {m.phase === 'approve' && m.action && <ApprovalCard tool={m.action.tool} summary={m.action.summary} args={m.action.args} recipients={m.action.recipients} demo={m.demo} busy={m.approval === 'busy'} onDecide={ok => decide(m, ok)} />}
                {m.approval && m.approval !== 'busy' && <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className={cn('rounded-[var(--r-md)] border px-3 py-2 text-[13px]', m.approval === 'ok' ? 'border-[color-mix(in_srgb,var(--ok)_35%,var(--line))] bg-[var(--ok-soft)] text-[var(--ok)]' : 'border-[var(--line)] bg-[var(--muted)] text-[var(--fg2)]')}>
                  {t(AC_APPROVAL_TEXT[m.approval])}</motion.div>}
                {m.note && <span className="text-xs text-[var(--fg3)]">{m.note}</span>}
              </motion.div>
            ))}
          </motion.div>
        )}
        {queue.length > 0 && <div className="flex w-full flex-col gap-1">
          <AnimatePresence initial={false}>{queue.map(d => (
            <motion.div key={d.id} layout initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, height: 0 }} transition={spring(0.3, 0.35)}
              className={cn(surface.dashed, 'flex items-center gap-2 bg-[var(--bg)] py-1 pe-1 ps-3 text-xs text-[var(--fg2)]')}>
              <b className="font-medium text-[var(--fg3)]">{t('queued')}</b><span dir="auto" className="min-w-0 flex-1 truncate">{d.text || (d.files.length ? t('files', { count: d.files.length }) : t('contextOnly'))}</span>
              <IconButton icon="x" label={t('removeQueued')} onClick={() => setQueue(q => q.filter(x => x.id !== d.id))} className={cn('!h-6 !w-6', TOUCH.tap)} />
            </motion.div>))}</AnimatePresence>
        </div>}

        <PromptInput layout value={text} onChange={setText} placeholder={placeholder} attachmentState={att} maxFiles={AC_MAX_FILES} uploadProgress
          inputRef={inp} barRef={barRef} canSubmit={canSend} onSubmit={() => { submit(); return false }}
          sendButton={{ state: submitting ? 'sending' : canStop ? 'stop' : busy ? 'queue' : 'send', disabled: !canSend && !canStop, onClick: canStop ? live!.stop : submit }}
          className={cn('w-full cursor-text !px-3 !pt-3', !chat && 'max-w-[600px]')}
          classNames={{ input: '!p-1', bar: 'relative !mt-1 cursor-default max-sm:!gap-0.5', send: 'transition-[opacity,transform] enabled:hover:scale-105 disabled:!opacity-25' }}
          dropHint={<span className="flex flex-col items-center gap-1"><Icon name="upload" size={22} /><b className="text-[13px]">{t('drop')}</b><span className="text-xs font-normal">{t('dropSub')}</span></span>}
          header={<>
              {ctx.length > 0 && <div className="mb-2 flex flex-wrap gap-1.5">
                {ctx.map(c => (
                  <motion.span key={c} initial={{ opacity: 0, scale: 0.8, y: 4 }} animate={{ opacity: 1, scale: 1, y: 0 }} transition={spring(0.4, 0.3)}
                    className="inline-flex h-6 max-w-full items-center gap-1.5 rounded-full bg-[var(--accent-soft)] pe-1 ps-2 text-xs font-medium text-[var(--accent)] [@media(pointer:coarse)]:h-8 [@media(pointer:coarse)]:pe-1.5">
                    <span dir="auto" className="min-w-0 truncate">{c.length > 38 ? c.slice(0, 36) + '…' : c}</span>
                    <button type="button" aria-label={t('remove', { name: c })} onClick={() => { setCtx(x => x.filter(y => y !== c)); inp.current?.focus() }} className={cn('grid h-[18px] w-[18px] flex-none cursor-pointer place-items-center rounded-full border-0 bg-transparent text-current opacity-70 hover:opacity-100', TOUCH.hit)}><Icon name="x" size={10} strokeWidth={3} /></button>
                  </motion.span>))}
                {ctx.length > 1 && <Button size="sm" variant="ghost" onClick={() => setCtx([])} className="!h-6 !px-1 text-[var(--fg3)] hover:text-[var(--fg)] [@media(pointer:coarse)]:!h-8 [@media(pointer:coarse)]:!px-2">{t('clear')}</Button>}
              </div>}
          </>}
          addButton={pick => (
                <span className="sm:relative">
                  <AcBarButton compact={narrow} controls={panelId('add')} icon={<Icon name="plus" size={16} strokeWidth={2.2} />} label={t('addFiles')} expanded={pop === 'add'} onClick={() => toggle('add')}>{t('addFiles')}</AcBarButton>
                  <AcPanel id={panelId('add')} open={pop === 'add'} narrow={narrow} label={t('addFiles')} menu={2 + samples.length} onClose={close}>
                    <MenuItem className={AC_ITEM} onSelect={() => { close(); pick('') }}><AcRowBody icon="upload" title={t('upload')} desc={t('uploadDesc')} /></MenuItem>
                    <MenuItem className={AC_ITEM} onSelect={() => { close(); pick('image/*') }}><AcRowBody icon="image" title={t('photos')} desc={t('photosDesc')} /></MenuItem>
                    {samples.map(x => <MenuItem key={x.title} className={AC_ITEM} onSelect={() => { close(); addFiles(x.files()) }}><AcRowBody icon="file" title={x.title} desc={x.desc} /></MenuItem>)}
                  </AcPanel>
                </span>
          )}
          tools={<>
                <span className="sm:relative">
                  <AcBarButton compact={narrow} controls={panelId('mode')} icon={<motion.span key={mode} initial={reduce ? false : { opacity: 0, scale: 0.6, rotate: -18 }} animate={{ opacity: 1, scale: [0.6, 1.12, 1], rotate: 0 }} transition={{ duration: 0.45, ease: [0.2, 0.8, 0.2, 1] }} className="grid"><Icon name={curMode.icon} size={16} /></motion.span>}
                    label={t('permMode', { mode: curMode.label })} expanded={pop === 'mode'} onClick={() => toggle('mode')} className={curMode.tone === 'warn' ? '!text-[var(--warn)]' : ''}>{curMode.label}</AcBarButton>
                  <AcPanel id={panelId('mode')} open={pop === 'mode'} narrow={narrow} label={t('permModeLabel')} menu={modes.length} onClose={close}>
                    {modes.map(m => <AcModeRow key={m.id} mode={m} checked={m.id === mode} onPick={() => { setMode(m.id); close(); inp.current?.focus() }} />)}
                  </AcPanel>
                </span>
                {cons.length > 0 && <span className="sm:relative">
                  <AcBarButton compact={narrow} controls={panelId('con')} haspopup="dialog" icon={<Icon name="plug" size={16} />} label={t('connectors')} expanded={pop === 'con'} onClick={() => toggle('con')} className={onCount ? '!text-[var(--accent)]' : ''}>
                    {t('connectors')}{onCount > 0 && <Badge size="sm" className="ms-1 min-w-[18px] justify-center !bg-[var(--accent)] font-semibold tabular-nums !text-[var(--card)]">{fmt.number(onCount)}</Badge>}
                  </AcBarButton>
                  <AcPanel id={panelId('con')} open={pop === 'con'} wide narrow={narrow} label={t('connectors')} onClose={close}>
                    <div className="p-1"><input autoFocus={!coarse} value={conQ} onChange={e => setConQ(e.target.value)} placeholder={t('searchConnectors')} aria-label={t('searchConnectorsLabel')} className={cn(inputClass, '!h-8 text-xs [@media(pointer:coarse)]:!h-10', TOUCH.input)} /></div>
                    <div className="flex max-h-[240px] flex-col overflow-auto overscroll-contain p-1">
                      {shownCons.length ? shownCons.map(c => (
                        <div key={c.name} onClick={e => { if (!(e.target as Element).closest('[role=switch]')) setCons(cs => cs.map(x => x.name === c.name ? { ...x, on: !x.on } : x)) }}
                          className={cn('flex cursor-pointer items-center gap-2.5 rounded-[var(--r-md)] px-1.5 py-1.5 hover:bg-[var(--muted)] [@media(pointer:coarse)]:min-h-12')}>
                          <span className="grid h-7 w-7 flex-none place-items-center rounded-[var(--r-md)] text-[11px] font-bold text-white [@media(pointer:coarse)]:text-[11px]" style={{ background: safeColor(c.color, 'var(--fg3)') }}>{c.name.slice(0, 2)}</span>
                          <span className="flex min-w-0 flex-1 flex-col"><b className="text-[13px] font-medium">{c.name}</b><span dir="auto" className="truncate text-[11px] text-[var(--fg3)]">{c.desc}</span></span>
                          <Switch checked={c.on} onChange={v => setCons(cs => cs.map(x => x.name === c.name ? { ...x, on: v } : x))} label={<span className="sr-only">{c.name}</span>} />
                        </div>)) : <span className="p-2 text-xs text-[var(--fg3)]">{t('noConnectors')}</span>}
                    </div>
                    <div className="flex items-center justify-between border-t border-[var(--line)] px-2 pt-1.5 pb-1"><span className="text-xs text-[var(--fg3)]">{t('onOf', { on: onCount, total: cons.length })}</span>
                      {onAddConnector && <Button size="sm" variant="ghost" onClick={() => { close(); onAddConnector() }}>{t('addConnector')}</Button>}</div>
                  </AcPanel>
                </span>}
                <span className="sm:relative">
                  <AcBarButton compact={narrow} controls={panelId('set')} haspopup="dialog" icon={<Icon name="sliders" size={16} />} label={t('modelSettings')} expanded={pop === 'set'} onClick={() => toggle('set')}>{S.model} · {S.speed} · {S.effort}</AcBarButton>
                  <AcPanel id={panelId('set')} open={pop === 'set'} wide narrow={narrow} label={t('modelSettings')} onClose={close}>
                    <div className="flex flex-col gap-3.5 p-2.5">
                      <label className="flex flex-col gap-1.5 text-[13px]"><span>{t('model')}</span>
                        <span className="relative flex items-center">
                          <select value={S.model} onChange={e => setModel(e.target.value)} className={cn(inputClass, 'cursor-pointer appearance-none pe-8', TOUCH.input)}>
                            {models.map(m => <option key={m.name} value={m.name}>{m.name} · {m.vendor}</option>)}
                          </select>
                          <Icon name="chevronDown" size={13} strokeWidth={2.5} className="pointer-events-none absolute end-2.5 text-[var(--fg3)]" />
                        </span></label>
                      <motion.div key={S.model} initial={reduce ? false : { opacity: 0.4, y: 4 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.2 }} className="flex flex-col gap-3.5">
                        <AcStepSlider title={t('speed')} list={model.speeds} value={S.speed} single={t('oneSpeed', { model: model.name })} onChange={v => setS(s => ({ ...s, speed: v }))} />
                        <AcStepSlider title={t('effort')} list={model.efforts} value={S.effort} single={t('oneEffort', { model: model.name })} onChange={v => setS(s => ({ ...s, effort: v }))} />
                        <span className="text-[11px] text-[var(--fg3)]">{t('vendorOptions', { vendor: model.vendor, model: model.name })}</span>
                      </motion.div>
                      {cons.length > 0 && <div className="flex items-center justify-between text-[13px]"><span>{t('toolsConnected', { count: onCount })}</span><Button size="sm" variant="ghost" onClick={() => setPop('con')}>{t('manage')}</Button></div>}
                      <div className="border-t border-[var(--line)] pt-2">
                        <button type="button" aria-expanded={adv} onClick={() => setAdv(a => !a)}
                          className="flex w-full cursor-pointer items-center gap-2 rounded-[var(--r-md)] border-0 bg-transparent px-1 py-1.5 text-start text-[13px] font-medium text-[var(--fg)] hover:bg-[var(--muted)] [@media(pointer:coarse)]:min-h-10">
                          {t('advanced')}<motion.span className="ms-auto grid text-[var(--fg3)]" animate={{ rotate: adv ? 180 : 0 }} transition={spring(0.2, 0.3)}><Icon name="chevronDown" size={12} strokeWidth={2.5} /></motion.span>
                        </button>
                        <Collapse open={adv}><div className="flex flex-col gap-3.5 px-1 pt-2 pb-1">
                          <Slider label={t('creativity')} min={0} max={1} step={0.1} value={S.temp} onChange={v => setS(s => ({ ...s, temp: v }))} format={v => fmt.number(v, { minimumFractionDigits: 1, maximumFractionDigits: 1 })} />
                          {([['memory', 'memorySub'], ['cites', 'citesSub'], ['web', 'webSub']] as const).map(([k, sub]) => (
                            <Switch key={k} checked={S[k]} onChange={v => setS(s => ({ ...s, [k]: v }))} label={<span className="flex flex-col"><span>{t(k)}</span><span className="text-xs text-[var(--fg3)]">{t(sub)}</span></span>} />
                          ))}
                        </div></Collapse>
                      </div>
                    </div>
                  </AcPanel>
                </span>
          </>}
          aside={status !== 'idle' && <span role="status" className="me-2 inline-flex min-w-0 max-sm:me-1 items-center gap-1.5 text-xs whitespace-nowrap text-[var(--fg3)]">
                <motion.i className={cn('h-[7px] w-[7px] rounded-full', status === 'working' ? 'bg-[var(--warn)]' : status === 'queued' ? 'bg-[var(--accent)]' : 'bg-[var(--bad)]')}
                  animate={status === 'working' ? { opacity: [1, 0.35, 1], scale: [1, 0.8, 1] } : { opacity: 1, scale: 1 }} transition={status === 'working' ? { duration: 1.2, repeat: Infinity } : undefined} />
                {status === 'working' ? t('statusWorking') : status === 'queued' ? (full ? t('queueFull') : t('statusQueued', { count: queue.length })) : t('statusInput')}</span>} />
      </div>

      <AnimatePresence>{sel && (
        <motion.button key="sel" type="button" initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.15 }}
          onPointerDown={e => { e.preventDefault(); takeSel() }} onMouseDown={e => e.preventDefault()} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); takeSel() } }}
          // touch: sit under the selection, clear of the native selection menu that iOS / Android draw above it
          // rtl-lint-ignore: fixed to the selection's viewport position
          style={{ left: Math.max(8, Math.min((document.documentElement.clientWidth || innerWidth) - 104, sel.x - 48)), top: coarse ? sel.bottom + 14 : sel.y - 36 }}
          className="fixed z-[60] cursor-pointer rounded-full border-0 bg-[var(--primary)] px-3 py-1 text-xs font-medium text-[var(--on-primary)] shadow-[var(--shadow)] [@media(pointer:coarse)]:min-h-10 [@media(pointer:coarse)]:px-4 [@media(pointer:coarse)]:text-[13px]">{t('addToChat')}</motion.button>
      )}</AnimatePresence>

    </div>
  )
}
