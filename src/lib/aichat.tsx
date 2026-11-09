import { useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent as RKeyboardEvent, type ReactNode } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { Badge, Button, Chip, Icon, IconButton, Spinner, TOUCH, cn, cssUrl, fmt, inputClass, menuItemClass, safeColor, safeUrl, sleep, spring, surface, useCoarsePointer, useMediaQuery, useOutside, useRoving, type IconName, type Tone } from './core'
import { Collapse, CopyButton, TypingDots, confetti, useToast } from './feedback'
import { Checkbox, OptionList, Select, Slider, Switch } from './forms'
import { Dialog, FloatingPanel, MenuItem, MenuLabel } from './overlay'
import { SendButton, StreamingText, ToolCall, useAutoGrow } from './ai'

/* ════════════════════════════════════════════════════════════════════════════
 * 11b. AI CHAT: rich assistant chat with generated UI parts, and the agent composer
 * ══════════════════════════════════════════════════════════════════════════ */

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

/** Source chips under an answer: favicon letter, name and what was read, numbered. `href` must be http(s), mailto or relative (others become #); `color` must be a plain CSS colour. */
export function ChatSources({ items, className }: { items: { name: string; desc: string; color?: string; href?: string }[]; className?: string }) {
  return (
    <div className={cn('flex flex-wrap gap-1.5', className)}>
      {items.map((s, i) => (
        <a key={s.name} href={safeUrl(s.href ?? '#ai')} className={cn(surface.md, 'flex items-center gap-2 py-1.5 pr-2.5 pl-1.5 text-xs text-[var(--fg)] no-underline hover:border-[var(--fg3)]')}>
          <span className="grid h-[22px] w-[22px] flex-none place-items-center rounded-[var(--r-md)] text-[11px] font-bold text-white" style={{ background: `color-mix(in srgb, ${safeColor(s.color, 'var(--accent)')} 80%, #000)` }}>{s.name[0]}</span>
          <span><b className="block font-medium">{s.name}</b><span className="text-[var(--fg3)]">{s.desc}</span></span>
          <span className="ml-1 font-[family-name:var(--mono)] text-[11px] font-semibold text-[var(--fg3)] [@media(pointer:coarse)]:text-[11px]">{i + 1}</span>
        </a>
      ))}
    </div>
  )
}

/** Checklist answer: tick items off; the count updates and confetti fires when everything is done. */
export function ChatChecklist({ title, items, className }: { title: string; items: { label: string; note: string; tone?: Tone }[]; className?: string }) {
  const [done, setDone] = useState<boolean[]>(items.map(() => false))
  const ref = useRef<HTMLDivElement>(null)
  const left = done.filter(d => !d).length
  const toggle = (i: number, v: boolean) => {
    const next = done.map((d, k) => k === i ? v : d); setDone(next)
    if (next.every(Boolean) && ref.current) { const r = ref.current.getBoundingClientRect(); confetti({ x: r.left + r.width / 2, y: r.top + 20, count: 90 }) }
  }
  return (
    <div ref={ref} className={className}><ChatCard title={title} sub={<motion.span key={left} initial={{ opacity: 0, y: -3 }} animate={{ opacity: 1, y: 0 }} className="inline-block">{left ? `${left} open` : 'All clear 🎉'}</motion.span>}>
      {items.map((it, i) => (
        <div key={it.label} className="flex flex-wrap items-center gap-x-2 gap-y-1 border-t border-[var(--line)] py-2">
          <Checkbox checked={done[i]} onChange={v => toggle(i, v)}><span className={cn('transition-colors', done[i] && 'text-[var(--fg3)] line-through')}>{it.label}</span></Checkbox>
          <Badge tone={it.tone} className="ml-auto">{it.note}</Badge>
        </div>
      ))}
    </ChatCard></div>
  )
}

/** Approval answer: the drafted message with Edit, Don’t send and Send; after sending, Undo. */
export function ChatApproval({ title, to, body: initial, className }: { title: string; to: string; body: string; className?: string }) {
  const [state, setState] = useState<'ask' | 'edit' | 'sending' | 'sent' | 'unsent' | 'declined'>('ask')
  const [body, setBody] = useState(initial)
  const send = async () => { setState('sending'); await sleep(900); setState('sent') }
  return (
    <ChatCard title={title} sub={to} className={className}>
      {state === 'edit'
        ? <textarea autoFocus value={body} onChange={e => setBody(e.target.value)} rows={3} aria-label="Edit message" className={cn(inputClass, '!h-auto mb-2.5 resize-none py-2 leading-normal shadow-[0_0_0_1.5px_var(--accent)]', TOUCH.input)} />
        : <div className="mb-2.5 rounded-[var(--r-md)] bg-[var(--muted)] px-3 py-2.5 text-[13px] leading-normal">{body}</div>}
      <div className="flex min-h-[30px] flex-wrap items-center justify-end gap-1.5">
        {(state === 'ask' || state === 'edit') && <>
          <Button size="sm" variant="ghost" onClick={() => setState(state === 'edit' ? 'ask' : 'edit')}>{state === 'edit' ? 'Done' : 'Edit'}</Button>
          <Button size="sm" onClick={() => setState('declined')}>Don’t send</Button>
          <Button size="sm" variant="primary" onClick={send}>Send</Button></>}
        {state === 'sending' && <span className="mr-auto flex items-center gap-2 text-xs text-[var(--fg3)]"><Spinner size={12} />Sending…</span>}
        {state === 'sent' && <><motion.span initial={{ scale: 0.6 }} animate={{ scale: 1 }} transition={spring(0.5, 0.35)} className="mr-auto"><Badge tone="ok"><Icon name="check" size={11} strokeWidth={3} />Sent</Badge></motion.span>
          <Button size="sm" variant="ghost" onClick={() => setState('unsent')}>Undo</Button></>}
        {state === 'unsent' && <span className="mr-auto text-xs text-[var(--fg3)]">Unsent. Nothing left your outbox.</span>}
        {state === 'declined' && <span className="mr-auto text-xs text-[var(--fg3)]">Not sent. The draft is saved.</span>}
      </div>
    </ChatCard>
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

/**
 * Rich assistant chat. Starter chips, `/` commands with a keyboard popup, typing dots, a collapsible tool-call row,
 * word-by-word streaming with Stop (which also works before the first word), generated UI parts under the answer,
 * follow-up chips, and an action row (copy, thumbs up/down, regenerate with version ‹ 1/2 ›). `respond(question)` returns
 * the script for a turn. Screen readers hear a short summary of each answer once it is done, not every word.
 * `defaultTurns` opens mid-conversation: each question is shown already answered (through `respond`, no streaming).
 */
export function AssistantChat({ starters = [], commands = [], respond, defaultTurns = [], placeholder = 'Ask anything, or type / for commands', className }:
  { starters?: string[]; commands?: SlashCommand[]; respond: (q: string) => ChatScript; /** questions already asked and answered when it mounts */ defaultTurns?: string[]; placeholder?: string; className?: string }) {
  const [turns, setTurns] = useState<ChatTurn[]>(() => defaultTurns.map((q, i) => ({ id: -1 - i, q, s: respond(q), phase: 'done', v: 0, run: 0, stopped: false, shown: '', rating: 0 })))
  const [text, setText] = useState('')
  const [slashOpen, setSlashOpen] = useState(true)
  const [said, setSaid] = useState('') // what the live region announces
  const log = useRef<HTMLDivElement>(null), listId = useId()
  const alive = useRef(true), cancelled = useRef(new Set<number>())
  useEffect(() => { alive.current = true; return () => { alive.current = false } }, [])
  const busy = turns.some(t => t.phase !== 'done')
  const streaming = turns.some(t => t.phase === 'stream')
  const toBottom = () => { const el = log.current; if (el) el.scrollTop = el.scrollHeight }
  useLayoutEffect(toBottom, [turns.length, turns[turns.length - 1]?.phase])
  const patch = (id: number, p: Partial<ChatTurn> | ((t: ChatTurn) => Partial<ChatTurn>)) => setTurns(ts => ts.map(t => t.id === id ? { ...t, ...(typeof p === 'function' ? p(t) : p) } : t))

  const ask = async (q: string) => {
    q = q.trim(); if (!q || busy) return
    setText('')
    const id = Date.now(), s = respond(q)
    const live = () => alive.current && !cancelled.current.has(id) // Stop during the dots or the tool call ends the turn here
    setTurns(ts => [...ts, { id, q, s, phase: 'dots', v: 0, run: 0, stopped: false, shown: '', rating: 0 }])
    setSaid('Assistant is thinking…')
    await sleep(650); if (!live()) return
    if (s.tool) { patch(id, { phase: 'tool' }); setSaid(`${s.tool[0]}…`); await sleep(1000); if (!live()) return }
    patch(id, { phase: 'stream' })
  }
  const restream = (t: ChatTurn, v: number) => patch(t.id, { v, run: t.run + 1, phase: 'stream', stopped: false })
  const stop = () => {
    setTurns(ts => ts.map(t => {
      if (t.phase === 'stream') return { ...t, stopped: true } // StreamingText freezes and reports what it showed
      if (t.phase === 'dots' || t.phase === 'tool') { cancelled.current.add(t.id); return { ...t, phase: 'done', stopped: true, shown: '' } }
      return t
    }))
    setSaid('Stopped')
  }
  const finish = (t: ChatTurn, shown: string) => { patch(t.id, { phase: 'done', shown }); setSaid(t.stopped ? 'Stopped' : `Assistant: ${shown}`) }

  const matches = text.startsWith('/') ? commands.filter(c => c.cmd.startsWith(text.split(' ')[0].toLowerCase())) : []
  const popup = slashOpen && matches.length > 0
  const go = (c: SlashCommand) => { setText(''); ask(c.prompt) }
  const roving = useRoving(matches.length, i => go(matches[i]), { homeEnd: false })
  const chip = (q: string) => <Chip key={q} onClick={() => ask(q)}>{q}</Chip>

  return (
    <div className={cn('flex flex-col gap-2.5', className)}>
      <span className="sr-only" aria-live="polite">{said}</span>
      <div ref={log} role="log" aria-live="off" aria-busy={streaming} aria-label="Conversation" className="flex h-[min(420px,62dvh)] flex-col gap-2.5 overflow-auto p-0.5">
        <AnimatePresence>
          {!turns.length && starters.length > 0 && (
            <motion.div key="starters" exit={{ opacity: 0, y: -6, transition: { duration: 0.15 } }} className="flex flex-wrap gap-1.5" role="group" aria-label="Suggestions">
              {starters.map(chip)}
            </motion.div>
          )}
        </AnimatePresence>
        {turns.map(t => {
          const answer = t.s.versions[t.v], n = t.s.versions.length
          return (
            <div key={t.id} className="flex flex-col gap-2.5">
              <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={spring(0.25, 0.4)}
                className="max-w-[80%] self-end rounded-[14px_14px_4px_14px] bg-[var(--primary)] px-3 py-2 text-[13px] text-[var(--on-primary)]">{t.q}</motion.div>
              <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={spring(0.25, 0.4)} className="max-w-[92%] text-[13px]">
                <div className="mb-1 flex items-center gap-1.5 text-xs font-medium text-[var(--fg3)]"><i className="h-2 w-2 rounded-full bg-[var(--accent)]" />Assistant</div>
                {t.phase === 'dots' ? <TypingDots /> : <>
                  {t.s.tool && (t.phase !== 'done' || !t.stopped || t.shown) && <ToolCall status={t.phase === 'tool' ? 'running' : 'done'} label={t.s.tool[0]} doneLabel={t.s.tool[1]} detail={t.s.tool[2]} />}
                  {t.phase !== 'tool' && <div className="mt-1.5 leading-relaxed">
                    {t.phase === 'stream'
                      ? <StreamingText key={t.run} text={answer} playing={!t.stopped} wordDelay={45} onProgress={toBottom} onDone={shown => finish(t, shown)} />
                      : <span className="whitespace-pre-wrap">{t.stopped ? t.shown : answer}</span>}
                  </div>}
                  {t.phase === 'done' && !t.stopped && t.s.part && <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={spring(0.25, 0.35)} className="mt-2.5">{t.s.part}</motion.div>}
                  {t.phase === 'done' && !t.stopped && t.s.followUps && t.s.followUps.length > 0 && t.id === turns[turns.length - 1].id && (
                    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.3, delay: 0.2 }} className="mt-2.5 flex flex-wrap gap-1.5">
                      {t.s.followUps.map(chip)}
                    </motion.div>)}
                  {t.phase === 'done' && (
                    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.25 }} className="mt-1.5 flex flex-wrap items-center gap-0.5 text-[var(--fg3)] [@media(pointer:coarse)]:gap-1">
                      {t.stopped && <span className="mr-1.5 text-xs">Stopped</span>}
                      {(!t.stopped || t.shown) && <CopyButton text={() => t.stopped ? t.shown : answer} size="icon-sm" variant="ghost" className="text-[var(--fg3)] hover:text-[var(--fg)]" />}
                      {([1, -1] as const).map(r => (
                        <Button key={r} size="icon-sm" variant="ghost" aria-label={r === 1 ? 'Good response' : 'Bad response'} aria-pressed={t.rating === r} title={r === 1 ? 'Good response' : 'Bad response'}
                          className={t.rating === r ? 'text-[var(--fg)] !bg-[var(--muted)]' : 'text-[var(--fg3)] hover:text-[var(--fg)]'} onClick={() => patch(t.id, { rating: t.rating === r ? 0 : r })}>
                          <motion.span key={t.rating === r ? 'on' : 'off'} animate={t.rating === r ? { scale: [1, 1.3, 1], rotate: [0, r === 1 ? -15 : 15, 0] } : undefined} transition={spring(0.5, 0.45)} className={cn('grid', r === -1 && 'rotate-180')}>
                            <Icon name="thumbUp" size={14} /></motion.span>
                        </Button>
                      ))}
                      <IconButton icon="refresh" label={t.stopped ? 'Retry' : 'Regenerate'} disabled={busy} onClick={() => restream(t, t.stopped && !t.shown ? t.v : (t.v + 1) % n)} />
                      {n > 1 && <>
                        <IconButton icon="chevronLeft" label="Previous version" disabled={busy} onClick={() => restream(t, (t.v - 1 + n) % n)} />
                        <span className="text-xs tabular-nums">{t.v + 1} / {n}</span>
                        <IconButton icon="chevronRight" label="Next version" disabled={busy} onClick={() => restream(t, (t.v + 1) % n)} />
                      </>}
                    </motion.div>)}
                </>}
              </motion.div>
            </div>
          )
        })}
      </div>
      <div className="relative">
        {/* sized for the full command list, so filtering never makes the panel above the field jump */}
        <FloatingPanel open={popup} placement="top-start" flip={false} role="presentation" style={{ minHeight: `min(${40 + commands.length * 36}px, 300px, 45dvh)` }} className="max-h-[min(300px,45dvh)] w-[min(280px,calc(100vw-32px))] overflow-y-auto overscroll-contain">
          <MenuLabel className="font-semibold tracking-wide uppercase">Commands</MenuLabel>
          <OptionList id={listId} label="Commands" query={text.split(' ')[0]} active={roving.active} onHover={roving.setActive} isSelected={() => false} onPick={i => go(matches[i])}
            options={matches.map(c => ({ value: c.cmd, label: c.cmd, hint: c.hint }))} className="[&_[role=option]]:[@media(pointer:coarse)]:min-h-11" />
        </FloatingPanel>
        <div className="flex items-center gap-2 rounded-full border border-[var(--line)] bg-[var(--card)] py-1 pr-1 pl-4 focus-within:border-[var(--fg3)]">
          <input value={text} placeholder={placeholder} aria-label="Message" autoComplete="off" role="combobox" aria-expanded={popup} aria-autocomplete="list"
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
          <SendButton state={busy ? 'stop' : 'send'} onClick={() => busy ? stop() : ask(text)} disabled={!busy && !text.trim()} />
        </div>
      </div>
    </div>
  )
}

/* Agent composer ─────────────────────────────────────────────────────────── */

export type ComposerMode = { id: string; label: string; desc: string; icon: IconName; tone: Tone }
export type Connector = { name: string; desc: string; color: string; on: boolean }
export type ComposerModel = { name: string; vendor: string; speeds: string[]; efforts: string[] }
export type WorkspaceItem = { label: string; title: string; sub: string; icon: string }

const AC_MODES: ComposerMode[] = [
  { id: 'ask', label: 'Ask for approval', desc: 'Pause before every tool call, edit or message, and ask you first.', icon: 'hand', tone: 'accent' },
  { id: 'approve', label: 'Approve for me', desc: 'Handle routine steps automatically; ask only for risky ones.', icon: 'shield', tone: 'ok' },
  { id: 'yolo', label: 'YOLO', desc: 'Full autonomy. Runs everything without asking.', icon: 'rocket', tone: 'warn' },
]
/** Used when no `models` are passed: one model with one speed and effort. */
const AC_MODELS: ComposerModel[] = [{ name: 'Default model', vendor: 'Assistant', speeds: ['Normal'], efforts: ['Medium'] }]
/** Demo-only fallback for `needsApproval`: a word match over the person's text. Real apps return `needsApproval` from onSend. */
const AC_RISKY = /send|email|remind|create|open|post|deploy|delete/i
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

type AcFile = { id: number; file: File; url: string | null }
type AcDraft = { id: number; text: string; files: AcFile[]; ctx: string[] }
/** ok / no: the host confirmed the action ran / didn't run; ok? / no?: the host didn't confirm (or there is no host action). */
type AcApproval = 'busy' | 'ok' | 'ok?' | 'no' | 'no?'
type AcMsg = { id: number; role: 'u' | 'a'; d?: AcDraft; q?: string; text?: string; model?: string; mode?: ComposerMode; phase?: 'wait' | 'stream' | 'approve' | 'done'; note?: string
  action?: ComposerAction; demo?: boolean; approval?: AcApproval }
const AC_APPROVAL_TEXT: Record<Exclude<AcApproval, 'busy'>, string> = {
  ok: '✓ Approved. The action ran.', 'ok?': 'Approved. The app hasn’t confirmed that the action ran.',
  no: 'Not approved. The action was not run.', 'no?': 'Not approved. The app hasn’t confirmed whether anything ran.',
}
const acArg = (v: unknown) => { const t = typeof v === 'string' ? v : JSON.stringify(v) ?? String(v); return t.length > 160 ? t.slice(0, 157) + '…' : t }

/**
 * The approval card: what the host says it will do (tool, summary, recipients, arguments), with Deny and Approve.
 * Approve is disabled for the first 500 ms so a click aimed at something else can't land on it as the card appears.
 */
function AcApprovalCard({ action, demo, busy, onDecide }: { action: ComposerAction; demo?: boolean; busy: boolean; onDecide: (ok: boolean) => void }) {
  const [armed, setArmed] = useState(false)
  useEffect(() => { const t = setTimeout(() => setArmed(true), 500); return () => clearTimeout(t) }, [])
  const args = Object.entries(action.args ?? {}).slice(0, 8)
  return (
    <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={spring(0.3, 0.35)} role="group" aria-label="Approval needed"
      className="flex flex-col gap-2 rounded-[var(--r-md)] border border-[color-mix(in_srgb,var(--warn)_40%,var(--line))] bg-[color-mix(in_srgb,var(--warn)_6%,var(--card))] py-2 pr-2 pl-3 text-[13px]">
      <div className="flex flex-wrap items-center gap-1.5"><Icon name="shield" size={14} className="text-[var(--warn)]" /><b className="font-medium">Approve this action?</b>
        <code className="rounded-[var(--r-sm)] bg-[var(--muted)] px-1.5 font-[family-name:var(--mono)] text-[11px] break-all">{action.tool}</code>{demo && <Badge>demo</Badge>}</div>
      <span className="break-words">{action.summary}</span>
      {!!action.recipients?.length && <span className="text-xs text-[var(--fg2)]">To: {action.recipients.join(', ')}</span>}
      {args.length > 0 && <dl className="m-0 grid grid-cols-[auto_minmax(0,1fr)] gap-x-2 gap-y-0.5 text-xs">{args.flatMap(([k, v]) => [<dt key={`k${k}`} className="font-[family-name:var(--mono)] text-[var(--fg3)]">{k}</dt>, <dd key={`v${k}`} className="m-0 break-words text-[var(--fg2)]">{acArg(v)}</dd>])}</dl>}
      <div className="flex justify-end gap-2">
        <Button size="sm" disabled={busy} onClick={() => onDecide(false)}>Deny</Button>
        <Button size="sm" variant="primary" disabled={!armed || busy} loading={busy} onClick={() => onDecide(true)}>Approve</Button>
      </div>
    </motion.div>
  )
}

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
      <span className="grid flex-none place-items-center">{icon}</span>
      <span className="inline-flex max-w-0 -translate-x-1 items-center gap-1 overflow-hidden whitespace-nowrap opacity-0 transition-all duration-300 ease-[cubic-bezier(.2,.8,.2,1)] group-hover:ml-1.5 group-hover:max-w-[180px] group-hover:translate-x-0 group-hover:opacity-100 group-focus-visible:ml-1.5 group-focus-visible:max-w-[180px] group-focus-visible:translate-x-0 group-focus-visible:opacity-100 group-aria-expanded:ml-1.5 group-aria-expanded:max-w-[180px] group-aria-expanded:translate-x-0 group-aria-expanded:opacity-100">{children}</span>
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

function AcStepSlider({ title, list, value, onChange, model }: { title: string; list: string[]; value: string; onChange: (v: string) => void; model: string }) {
  if (list.length < 2) return <div className="flex flex-col gap-1 text-[13px]"><span className="flex justify-between">{title}<b className="font-medium">{value}</b></span><span className="text-xs text-[var(--fg3)]">{model} has one {title.toLowerCase()} setting</span></div>
  return <Slider label={title} steps={list} value={Math.max(0, list.indexOf(value))} onChange={i => onChange(list[i])} />
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
 */
export function AgentComposer({ onSend, onApprovalRequest, items = [], doc, modes = AC_MODES, connectors = [], models = AC_MODELS, samples = [], needsApproval = t => AC_RISKY.test(t),
  hero = 'What should we work on?', hint, className }:
  { onSend?: (text: string, files: File[], context: string[], meta: ComposerSendMeta) => string | ComposerReply | void | Promise<string | ComposerReply | void>
    /** The person approved or denied `action` (from onSend's needsApproval). Run it now only if approved; resolve true when it ran (approve) or to confirm nothing ran (deny). */
    onApprovalRequest?: (action: ComposerAction, approved: boolean) => Promise<boolean>
    items?: WorkspaceItem[]; doc?: string; modes?: ComposerMode[]; connectors?: Connector[]; models?: ComposerModel[]; samples?: ComposerSample[]
    /** Demo fallback: which plain-string replies get a (non-blocking) approval card. Prefer returning needsApproval from onSend. */
    needsApproval?: (text: string) => boolean; hero?: string; hint?: string; className?: string }) {
  const toast = useToast()
  const reduce = useReducedMotion()
  const [chat, setChat] = useState(false)
  const [text, setText] = useState('')
  const [files, setFiles] = useState<AcFile[]>([])
  const [ctx, setCtx] = useState<string[]>([])
  const [mode, setMode] = useState(modes[1]?.id ?? modes[0].id)
  const [cons, setCons] = useState(connectors)
  const [conQ, setConQ] = useState('')
  const [S, setS] = useState<ComposerSettings>({ model: models[0].name, speed: models[0].speeds[0], effort: models[0].efforts[Math.min(1, models[0].efforts.length - 1)], temp: 0.7, memory: true, cites: true, web: true })
  const [adv, setAdv] = useState<null | ComposerSettings>(null)
  const [pop, setPop] = useState<null | 'add' | 'mode' | 'con' | 'set'>(null)
  const [msgs, setMsgs] = useState<AcMsg[]>([])
  const [queue, setQueue] = useState<AcDraft[]>([])
  const [submitting, setSubmitting] = useState(false)
  const [over, setOver] = useState(false)
  const [said, setSaid] = useState('') // short summaries for screen readers
  const [sel, setSel] = useState<{ x: number; y: number; bottom: number; text: string } | null>(null)
  const narrow = useMediaQuery('(max-width: 639px)'), coarse = useCoarsePointer()
  const [wsOpen, setWsOpen] = useState(false) // phones: the workspace folds into a toggle above the composer
  const boxRef = useRef<HTMLDivElement>(null), inp = useRef<HTMLTextAreaElement>(null), fileRef = useRef<HTMLInputElement>(null), docRef = useRef<HTMLParagraphElement>(null), logRef = useRef<HTMLDivElement>(null)
  const barRef = useRef<HTMLDivElement>(null), depth = useRef(0), fid = useRef(0), mid = useRef(0), alive = useRef(true)
  const urls = useRef(new Set<string>()) // object URLs of image previews, revoked when the chip goes away or on unmount
  const pid = useId(), panelId = (k: string) => `${pid}-${k}`
  const busy = msgs.some(m => m.role === 'a' && m.phase !== 'done')
  const streaming = msgs.some(m => m.phase === 'stream')
  const waiting = msgs.some(m => m.phase === 'approve')
  const queueRef = useRef(queue); queueRef.current = queue
  const approve = useRef(onApprovalRequest); approve.current = onApprovalRequest
  const curMode = modes.find(m => m.id === mode) ?? modes[0]
  const model = models.find(m => m.name === S.model) ?? models[0]
  const onCount = cons.filter(c => c.on).length
  const status = waiting ? 'input' : busy ? (queue.length ? 'queued' : 'working') : 'idle'
  const workspace = items.length > 0 || !!doc

  useOutside([barRef], () => setPop(null), !!pop)
  useAutoGrow(inp, text, 168)
  useEffect(() => { const el = logRef.current; if (el) el.scrollTo({ top: el.scrollHeight, behavior: reduce ? 'auto' : 'smooth' }) }, [msgs, reduce])
  useEffect(() => { alive.current = true; const u = urls.current; return () => { alive.current = false; u.forEach(x => URL.revokeObjectURL(x)); u.clear() } }, [])

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

  const addFiles = (list: FileList | File[]) => {
    const add = Array.from(list).slice(0, Math.max(0, Math.min(8, AC_MAX_FILES - files.length))).map(f => {
      const url = /^image\//.test(f.type) ? URL.createObjectURL(f) : null
      if (url) urls.current.add(url)
      return { id: ++fid.current, file: f, url }
    })
    setFiles(fs => [...fs, ...add]); inp.current?.focus()
  }
  const dropUrl = (f: AcFile) => { if (f.url) { URL.revokeObjectURL(f.url); urls.current.delete(f.url) } }
  const addCtx = (label: string) => { setCtx(c => c.includes(label) ? c : [...c, label]); inp.current?.focus() }
  const toggleCtx = (label: string) => ctx.includes(label) ? setCtx(c => c.filter(x => x !== label)) : addCtx(label)

  const patchMsg = (id: number, p: Partial<AcMsg>) => setMsgs(ms => ms.map(x => x.id === id ? { ...x, ...p } : x))
  const addMsg = (m: AcMsg) => setMsgs(ms => [...ms, m].slice(-AC_MAX_MSGS))
  /** A reply from onSend as message fields: plain strings may get the demo approval fallback, objects carry the host's action. */
  const toReply = (r: string | ComposerReply, q: string): Partial<AcMsg> => {
    if (typeof r === 'string') return { text: r, ...(curMode.id === 'ask' && needsApproval(q) ? { action: { tool: cons.find(c => c.on)?.name ?? 'assistant', summary: `Act on: “${q}”` }, demo: true } : {}) }
    return { text: r.text ?? '', action: r.needsApproval }
  }
  const run1 = (d: AcDraft) => {
    setChat(true)
    const id = ++mid.current
    addMsg({ id, role: 'u', d })
    const reply = onSend?.(d.text, d.files.map(f => f.file), d.ctx, { mode: curMode, settings: S, connectors: cons.filter(c => c.on).map(c => c.name) })
    if (reply == null) { setSaid('Message sent'); setTimeout(next, 0); return }
    const aid = ++mid.current, base: AcMsg = { id: aid, role: 'a', q: d.text, model: S.model, mode: curMode }
    const show = (r: string | ComposerReply) => { const p = toReply(r, d.text); return { ...p, phase: p.text ? 'stream' as const : p.action ? 'approve' as const : 'done' as const } }
    if (typeof (reply as Promise<unknown>).then !== 'function') { const p = show(reply as string | ComposerReply); addMsg({ ...base, ...p }); if (p.phase === 'done') next(); return }
    addMsg({ ...base, text: '', phase: 'wait' }); setSaid('Assistant is working…')
    ;(reply as Promise<string | ComposerReply | void>).then(r => { if (!alive.current) return; const p = r == null ? { phase: 'done' as const } : show(r); patchMsg(aid, p); if (p.phase === 'done') next() },
      () => { if (alive.current) patchMsg(aid, { text: 'Something went wrong. Try again.', phase: 'stream' }) })
  }
  function next() {
    const q = queueRef.current
    if (q.length) { const [nx, ...rest] = q; setQueue(rest); setTimeout(() => run1(nx), 250) }
  }
  const streamDone = (m: AcMsg) => {
    if (m.action) { patchMsg(m.id, { phase: 'approve' }); setSaid(`Assistant: ${m.text} Needs your approval: ${m.action.tool}, ${m.action.summary}`); return }
    patchMsg(m.id, { phase: 'done' }); setSaid(`Assistant: ${m.text}`); next()
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
    patchMsg(m.id, { phase: 'done', approval }); setSaid(AC_APPROVAL_TEXT[approval]); next()
  }

  const takeDraft = (): AcDraft => {
    files.forEach(dropUrl) // previews only live in the composer; the sent message lists names
    const d = { id: ++mid.current, text: text.trim(), files: files.map(f => ({ ...f, url: null })), ctx }
    setText(''); setFiles([]); setCtx([]); return d
  }
  const canSend = !waiting && !submitting && (!!text.trim() || files.length > 0 || ctx.length > 0)
  const submit = () => {
    if (!canSend) return
    if (busy) { if (queue.length >= AC_MAX_QUEUE) { toast({ title: 'Queue is full', description: `Up to ${AC_MAX_QUEUE} follow-ups can wait; send this one when the queue clears.` }); return } setQueue(q => [...q, takeDraft()]); return }
    const d = takeDraft(); setSubmitting(true)
    setTimeout(() => { if (!alive.current) return; setSubmitting(false); run1(d) }, reduce ? 0 : 380)
  }
  const toggle = (k: NonNullable<typeof pop>) => setPop(p => p === k ? null : k)
  const close = () => setPop(null)
  const wordDelay = ({ 'Ultra fast': 14, Fast: 26, Priority: 30 } as Record<string, number>)[S.speed] ?? 45
  const placeholder = status === 'input' ? 'Approve or deny above to continue' : busy ? 'Working… type to queue a follow-up' : files.length || ctx.length ? 'Add a message, or just send' : 'Ask anything, or drop files here'
  const setModel = (name: string) => { const prev = model, m = models.find(x => x.name === name)!; setS(s => ({ ...s, model: name, speed: acNearest(m.speeds, s.speed, prev.speeds), effort: acNearest(m.efforts, s.effort, prev.efforts) })) }
  const shownCons = cons.filter(c => !conQ || (c.name + ' ' + c.desc).toLowerCase().includes(conQ.toLowerCase()))
  const pick = (accept: string) => { close(); if (fileRef.current) { fileRef.current.accept = accept; fileRef.current.click() } }

  return (
    <div className={cn('grid gap-4 sm:min-h-[440px]', workspace && 'md:grid-cols-[240px_minmax(0,1fr)]', className)}>
      <span className="sr-only" aria-live="polite">{said}</span>
      {workspace && <aside aria-label="Workspace" className={cn(surface.card, 'flex flex-col gap-3 !bg-[var(--bg)] p-3 max-sm:gap-0 max-sm:p-0')}>
        {narrow
          ? <button type="button" aria-expanded={wsOpen} onClick={() => setWsOpen(o => !o)}
              className="flex min-h-11 w-full cursor-pointer items-center gap-2 rounded-[var(--r-lg)] border-0 bg-transparent px-3 text-left text-[13px] text-[var(--fg)]">
              <Icon name="file" size={15} className="text-[var(--fg3)]" /><b className="font-semibold">Workspace</b>
              <span className="min-w-0 flex-1 truncate text-xs text-[var(--fg3)]">{ctx.length ? `${ctx.length} added as context` : `${items.length} items · tap to add context`}</span>
              <motion.span className="grid text-[var(--fg3)]" animate={{ rotate: wsOpen ? 180 : 0 }} transition={spring(0.2, 0.3)}><Icon name="chevronDown" size={14} strokeWidth={2.5} /></motion.span>
            </button>
          : <div className="flex flex-col gap-0.5"><b className="text-[13px]">Workspace</b><span className="text-xs text-[var(--fg3)]">Click an item or select text to add it as context</span></div>}
        <Collapse open={!narrow || wsOpen}><div className="flex flex-col gap-3 max-sm:px-3 max-sm:pb-3">
        {narrow && <span className="text-xs text-[var(--fg3)]">Tap an item, or select text and tap “Add to chat”</span>}
        <div className="flex flex-col gap-1">
          {items.map(it => {
            const on = ctx.includes(it.label)
            return (
              <button key={it.label} type="button" aria-pressed={on} onClick={() => toggleCtx(it.label)}
                className={cn('flex cursor-pointer items-center gap-2.5 rounded-[var(--r-md)] border p-2 text-left transition-colors', on ? 'border-[var(--accent)] bg-[var(--accent-soft)]' : 'border-transparent bg-transparent hover:bg-[var(--muted)]')}>
                <span className="grid h-7 w-7 flex-none place-items-center rounded-[var(--r-md)] border border-[var(--line)] bg-[var(--card)] text-[13px]">{it.icon}</span>
                <span className="min-w-0"><b className="block text-[13px] font-medium">{it.title}</b><span className="block truncate text-xs text-[var(--fg3)]">{it.sub}</span></span>
              </button>
            )
          })}
        </div>
        {doc && <p ref={docRef} className={cn(surface.md, 'm-0 p-2 text-[13px] leading-relaxed text-[var(--fg2)] selection:bg-[var(--accent-soft)]')}>{doc}</p>}
        </div></Collapse>
      </aside>}

      <div className={cn('relative flex min-w-0 flex-col gap-3', !chat && 'items-center justify-center max-sm:pt-4')}>
        <AnimatePresence>{!chat && (
          <motion.div key="hero" exit={{ opacity: 0, y: -8, transition: { duration: 0.15 } }} className="flex flex-col items-center gap-1 text-center">
            <h4 className="m-0 text-[22px] font-semibold tracking-tight max-sm:text-base">{hero}</h4>{hint && <span className="text-xs text-[var(--fg3)]">{hint}</span>}
          </motion.div>)}</AnimatePresence>
        {chat && (
          <motion.div ref={logRef} role="log" aria-live="off" aria-busy={streaming} aria-label="Conversation" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4, delay: 0.15 }}
            className="flex max-h-[min(360px,55dvh)] flex-1 flex-col gap-3 overflow-auto px-0.5 py-1">
            {msgs.map(m => m.role === 'u' ? (
              <motion.div key={m.id} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={spring(0.3, 0.35)} className="flex max-w-[82%] flex-col items-end gap-1 self-end">
                {(m.d!.ctx.length > 0 || m.d!.files.length > 0) && <div className="flex flex-wrap justify-end gap-1">{m.d!.ctx.map(c => <Badge key={c} tone="accent">{c}</Badge>)}{m.d!.files.map(f => <Badge key={f.id}>📎 {f.file.name}</Badge>)}</div>}
                {m.d!.text && <div className="rounded-[16px_16px_4px_16px] bg-[var(--muted)] px-3 py-2 text-[13px] leading-normal break-words whitespace-pre-wrap">{m.d!.text}</div>}
              </motion.div>
            ) : (
              <motion.div key={m.id} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={spring(0.3, 0.35)} className="flex max-w-[82%] flex-col gap-1.5">
                <div className="flex flex-wrap gap-1"><Badge>{m.model}</Badge><Badge tone={m.mode!.tone}>{m.mode!.label}</Badge></div>
                <div className="px-0.5 text-[13px] leading-normal">
                  {m.phase === 'wait' ? <TypingDots /> : m.phase === 'stream' ? <StreamingText text={m.text!} wordDelay={wordDelay} onDone={() => setTimeout(() => alive.current && streamDone(m), reduce ? 0 : 500)} /> : m.text}
                </div>
                {m.phase === 'approve' && m.action && <AcApprovalCard action={m.action} demo={m.demo} busy={m.approval === 'busy'} onDecide={ok => decide(m, ok)} />}
                {m.approval && m.approval !== 'busy' && <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className={cn('rounded-[var(--r-md)] border px-3 py-2 text-[13px]', m.approval === 'ok' ? 'border-[color-mix(in_srgb,var(--ok)_35%,var(--line))] bg-[var(--ok-soft)] text-[var(--ok)]' : 'border-[var(--line)] bg-[var(--muted)] text-[var(--fg2)]')}>
                  {AC_APPROVAL_TEXT[m.approval]}</motion.div>}
                {m.note && <span className="text-xs text-[var(--fg3)]">{m.note}</span>}
              </motion.div>
            ))}
          </motion.div>
        )}
        {queue.length > 0 && <div className="flex w-full flex-col gap-1">
          <AnimatePresence initial={false}>{queue.map(d => (
            <motion.div key={d.id} layout initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, height: 0 }} transition={spring(0.3, 0.35)}
              className={cn(surface.dashed, 'flex items-center gap-2 bg-[var(--bg)] py-1 pr-1 pl-3 text-xs text-[var(--fg2)]')}>
              <b className="font-medium text-[var(--fg3)]">Queued</b><span className="min-w-0 flex-1 truncate">{d.text || (d.files.length ? `${d.files.length} file(s)` : 'Context only')}</span>
              <IconButton icon="x" label="Remove queued message" onClick={() => setQueue(q => q.filter(x => x.id !== d.id))} className={cn('!h-6 !w-6', TOUCH.tap)} />
            </motion.div>))}</AnimatePresence>
        </div>}

        <motion.div ref={boxRef} layout transition={spring(0.15, 0.6)}
          onMouseDown={e => { if (e.target === e.currentTarget) { e.preventDefault(); inp.current?.focus() } }}
          onDragEnter={e => { if (!e.dataTransfer.types.includes('Files')) return; e.preventDefault(); depth.current++; setOver(true) }}
          onDragOver={e => { if (e.dataTransfer.types.includes('Files')) e.preventDefault() }}
          onDragLeave={() => { depth.current = Math.max(0, depth.current - 1); if (!depth.current) setOver(false) }}
          onDrop={e => { e.preventDefault(); depth.current = 0; setOver(false); if (e.dataTransfer.files.length) addFiles(e.dataTransfer.files) }}
          className={cn('relative w-full cursor-text rounded-[var(--r-lg)] border bg-[var(--card)] px-3 pt-3 pb-2 transition-[border-color,box-shadow]',
            !chat && 'max-w-[600px]', over ? 'border-[var(--accent)] shadow-[0_0_0_4px_var(--accent-soft)]' : 'border-[var(--line)] shadow-[0_1px_2px_rgba(0,0,0,.04),0_4px_16px_rgba(0,0,0,.04)] focus-within:border-[var(--line2)] focus-within:shadow-[0_0_0_4px_var(--muted)]')}>
          <div aria-hidden className={cn('pointer-events-none absolute inset-1 z-[4] flex flex-col items-center justify-center gap-1 rounded-[var(--r-lg)] border-2 border-dashed border-[var(--accent)] bg-[color-mix(in_srgb,var(--accent-soft)_92%,transparent)] text-[var(--accent)] transition-opacity', over ? 'opacity-100' : 'opacity-0')}>
            <Icon name="upload" size={22} /><b className="text-[13px]">Drop files to attach</b><span className="text-xs">Images, PDFs, code, anything</span>
          </div>
          <motion.div layout="position">
            {ctx.length > 0 && <div className="mb-2 flex flex-wrap gap-1.5">
              {ctx.map(c => (
                <motion.span key={c} initial={{ opacity: 0, scale: 0.8, y: 4 }} animate={{ opacity: 1, scale: 1, y: 0 }} transition={spring(0.4, 0.3)}
                  className="inline-flex h-6 max-w-full items-center gap-1.5 rounded-full bg-[var(--accent-soft)] pr-1 pl-2 text-xs font-medium text-[var(--accent)] [@media(pointer:coarse)]:h-8 [@media(pointer:coarse)]:pr-1.5">
                  <span className="min-w-0 truncate">{c.length > 38 ? c.slice(0, 36) + '…' : c}</span>
                  <button type="button" aria-label={`Remove ${c}`} onClick={() => { setCtx(x => x.filter(y => y !== c)); inp.current?.focus() }} className={cn('grid h-[18px] w-[18px] flex-none cursor-pointer place-items-center rounded-full border-0 bg-transparent text-current opacity-70 hover:opacity-100', TOUCH.hit)}><Icon name="x" size={10} strokeWidth={3} /></button>
                </motion.span>))}
              {ctx.length > 1 && <Button size="sm" variant="ghost" onClick={() => setCtx([])} className="!h-6 !px-1 text-[var(--fg3)] hover:text-[var(--fg)] [@media(pointer:coarse)]:!h-8 [@media(pointer:coarse)]:!px-2">Clear</Button>}
            </div>}
            {files.length > 0 && <div className="mb-2 flex flex-wrap gap-1.5">
              <AnimatePresence initial={false}>{files.map(f => (
                <motion.div key={f.id} initial={{ opacity: 0, scale: 0.85 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.85, transition: { duration: 0.15 } }} transition={spring(0.4, 0.3)}
                  className="group/f relative flex h-12 max-w-[min(220px,100%)] items-center gap-2 overflow-hidden rounded-[var(--r-lg)] border border-[var(--line)] bg-[var(--bg)] py-1 pr-3 pl-1">
                  <span className="grid h-10 w-10 flex-none place-items-center rounded-[var(--r-md)] bg-[var(--muted)] bg-cover bg-center font-[family-name:var(--mono)] text-[11px] font-bold text-[var(--fg2)]" style={f.url ? { backgroundImage: cssUrl(f.url) } : undefined}>
                    {f.url ? '' : (f.file.name.split('.').pop() || 'file').slice(0, 4).toUpperCase()}</span>
                  <span className="flex min-w-0 flex-col text-xs leading-tight"><b className="truncate font-medium">{f.file.name}</b><span className="text-[var(--fg3)]">{fmt.bytes(f.file.size)}</span></span>
                  <motion.i className="absolute bottom-0 left-0 h-0.5 bg-[var(--accent)]" initial={{ width: '0%', opacity: 1 }} animate={{ width: '100%', opacity: [1, 1, 0] }} transition={{ duration: 0.6 + (f.id % 4) * 0.2, ease: 'easeOut', opacity: { duration: 0.6 + (f.id % 4) * 0.2 + 0.3, times: [0, 0.75, 1] } }} />
                  <button type="button" aria-label={`Remove ${f.file.name}`} onClick={() => { dropUrl(f); setFiles(x => x.filter(y => y.id !== f.id)); inp.current?.focus() }}
                    className={cn('absolute top-1 right-1 grid h-[18px] w-[18px] cursor-pointer place-items-center rounded-full border-0 bg-[var(--fg)] text-[var(--bg)] opacity-0 transition-opacity group-hover/f:opacity-100 focus-visible:opacity-100 [@media(pointer:coarse)]:opacity-100', TOUCH.hit)}><Icon name="x" size={10} strokeWidth={3} /></button>
                </motion.div>))}</AnimatePresence>
            </div>}
            <textarea ref={inp} rows={1} value={text} placeholder={placeholder} aria-label="Message" onChange={e => setText(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); submit() } }}
              onPaste={e => { const f = Array.from(e.clipboardData.files); if (f.length) { e.preventDefault(); addFiles(f) } }}
              className={cn('block max-h-[168px] min-h-6 w-full resize-none border-0 bg-transparent p-1 text-sm leading-normal text-[var(--fg)] outline-none placeholder:text-[var(--fg3)]', TOUCH.input)} />
            <div ref={barRef} className="relative mt-1 flex cursor-default items-center gap-1 max-sm:gap-0.5">
              <input ref={fileRef} type="file" multiple hidden onChange={e => { if (e.target.files) addFiles(e.target.files); e.target.value = '' }} />
              <span className="sm:relative">
                <AcBarButton compact={narrow} controls={panelId('add')} icon={<Icon name="plus" size={16} strokeWidth={2.2} />} label="Add files" expanded={pop === 'add'} onClick={() => toggle('add')}>Add files</AcBarButton>
                <AcPanel id={panelId('add')} open={pop === 'add'} narrow={narrow} label="Add files" menu={2 + samples.length} onClose={close}>
                  <MenuItem className={AC_ITEM} onSelect={() => pick('')}><AcRowBody icon="upload" title="Upload files" desc="From your computer" /></MenuItem>
                  <MenuItem className={AC_ITEM} onSelect={() => pick('image/*')}><AcRowBody icon="image" title="Add photos" desc="Images and screenshots" /></MenuItem>
                  {samples.map(x => <MenuItem key={x.title} className={AC_ITEM} onSelect={() => { close(); addFiles(x.files()) }}><AcRowBody icon="file" title={x.title} desc={x.desc} /></MenuItem>)}
                </AcPanel>
              </span>
              <span className="sm:relative">
                <AcBarButton compact={narrow} controls={panelId('mode')} icon={<motion.span key={mode} initial={reduce ? false : { opacity: 0, scale: 0.6, rotate: -18 }} animate={{ opacity: 1, scale: [0.6, 1.12, 1], rotate: 0 }} transition={{ duration: 0.45, ease: [0.2, 0.8, 0.2, 1] }} className="grid"><Icon name={curMode.icon} size={16} /></motion.span>}
                  label={`Permission mode: ${curMode.label}`} expanded={pop === 'mode'} onClick={() => toggle('mode')} className={curMode.tone === 'warn' ? '!text-[var(--warn)]' : ''}>{curMode.label}</AcBarButton>
                <AcPanel id={panelId('mode')} open={pop === 'mode'} narrow={narrow} label="Permission mode" menu={modes.length} onClose={close}>
                  {modes.map(m => <AcModeRow key={m.id} mode={m} checked={m.id === mode} onPick={() => { setMode(m.id); close(); inp.current?.focus() }} />)}
                </AcPanel>
              </span>
              {cons.length > 0 && <span className="sm:relative">
                <AcBarButton compact={narrow} controls={panelId('con')} haspopup="dialog" icon={<Icon name="plug" size={16} />} label="Connectors" expanded={pop === 'con'} onClick={() => toggle('con')} className={onCount ? '!text-[var(--accent)]' : ''}>
                  Connectors{onCount > 0 && <Badge size="sm" className="ml-1 min-w-[18px] justify-center !bg-[var(--accent)] font-semibold tabular-nums !text-[var(--card)]">{onCount}</Badge>}
                </AcBarButton>
                <AcPanel id={panelId('con')} open={pop === 'con'} wide narrow={narrow} label="Connectors" onClose={close}>
                  <div className="p-1"><input autoFocus={!coarse} value={conQ} onChange={e => setConQ(e.target.value)} placeholder="Search connectors and MCP servers" aria-label="Search connectors" className={cn(inputClass, '!h-8 text-xs [@media(pointer:coarse)]:!h-10', TOUCH.input)} /></div>
                  <div className="flex max-h-[240px] flex-col overflow-auto overscroll-contain p-1">
                    {shownCons.length ? shownCons.map(c => (
                      <div key={c.name} onClick={e => { if (!(e.target as Element).closest('[role=switch]')) setCons(cs => cs.map(x => x.name === c.name ? { ...x, on: !x.on } : x)) }}
                        className={cn('flex cursor-pointer items-center gap-2.5 rounded-[var(--r-md)] px-1.5 py-1.5 hover:bg-[var(--muted)] [@media(pointer:coarse)]:min-h-12')}>
                        <span className="grid h-7 w-7 flex-none place-items-center rounded-[var(--r-md)] text-[11px] font-bold text-white [@media(pointer:coarse)]:text-[11px]" style={{ background: safeColor(c.color, 'var(--fg3)') }}>{c.name.slice(0, 2)}</span>
                        <span className="flex min-w-0 flex-1 flex-col"><b className="text-[13px] font-medium">{c.name}</b><span className="truncate text-[11px] text-[var(--fg3)]">{c.desc}</span></span>
                        <Switch checked={c.on} onChange={v => setCons(cs => cs.map(x => x.name === c.name ? { ...x, on: v } : x))} label={<span className="sr-only">{c.name}</span>} />
                      </div>)) : <span className="p-2 text-xs text-[var(--fg3)]">No connectors match</span>}
                  </div>
                  <div className="flex items-center justify-between border-t border-[var(--line)] px-2 pt-1.5 pb-1"><span className="text-xs text-[var(--fg3)]">{onCount} of {cons.length} on</span>
                    <Button size="sm" variant="ghost" onClick={() => toast({ title: 'Connector directory', description: 'This would open the MCP / connector directory' })}>+ Add connector</Button></div>
                </AcPanel>
              </span>}
              <span className="sm:relative">
                <AcBarButton compact={narrow} controls={panelId('set')} haspopup="dialog" icon={<Icon name="sliders" size={16} />} label="Model settings" expanded={pop === 'set'} onClick={() => toggle('set')}>{S.model} · {S.speed} · {S.effort}</AcBarButton>
                <AcPanel id={panelId('set')} open={pop === 'set'} wide narrow={narrow} label="Model settings" onClose={close}>
                  <div className="flex flex-col gap-3.5 p-2.5">
                    <div className="flex flex-col gap-1.5 text-[13px]"><span>Model</span>
                      <Select aria-label="Model" value={S.model} onChange={setModel} options={models.map(m => ({ value: m.name, label: `${m.name} · ${m.vendor}` }))} /></div>
                    <motion.div key={S.model} initial={reduce ? false : { opacity: 0.4, y: 4 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.2 }} className="flex flex-col gap-3.5">
                      <AcStepSlider title="Speed" list={model.speeds} value={S.speed} model={model.name} onChange={v => setS(s => ({ ...s, speed: v }))} />
                      <AcStepSlider title="Effort" list={model.efforts} value={S.effort} model={model.name} onChange={v => setS(s => ({ ...s, effort: v }))} />
                      <span className="text-[11px] text-[var(--fg3)]">{model.vendor} options for {model.name}</span>
                    </motion.div>
                    {cons.length > 0 && <div className="flex items-center justify-between text-[13px]"><span>Tools: {onCount} connected</span><Button size="sm" variant="ghost" onClick={() => setPop('con')}>Manage</Button></div>}
                    <Button size="sm" className="w-full" onClick={() => { close(); setAdv({ ...S }) }}>Advanced settings…</Button>
                  </div>
                </AcPanel>
              </span>
              <span className="flex-1" />
              {status !== 'idle' && <span role="status" className="mr-2 inline-flex min-w-0 max-sm:mr-1 items-center gap-1.5 text-xs whitespace-nowrap text-[var(--fg3)]">
                <motion.i className={cn('h-[7px] w-[7px] rounded-full', status === 'working' ? 'bg-[var(--warn)]' : status === 'queued' ? 'bg-[var(--accent)]' : 'bg-[var(--bad)]')}
                  animate={status === 'working' ? { opacity: [1, 0.35, 1], scale: [1, 0.8, 1] } : { opacity: 1, scale: 1 }} transition={status === 'working' ? { duration: 1.2, repeat: Infinity } : undefined} />
                {status === 'working' ? 'Working' : status === 'queued' ? `${queue.length} queued` : 'Needs your input'}</span>}
              <SendButton state={submitting ? 'sending' : busy ? 'queue' : 'send'} disabled={!canSend} onClick={submit}
                className="transition-[opacity,transform] enabled:hover:scale-105 disabled:!opacity-25 [@media(pointer:coarse)]:h-10 [@media(pointer:coarse)]:w-10" />
            </div>
          </motion.div>
        </motion.div>
      </div>

      <AnimatePresence>{sel && (
        <motion.button key="sel" type="button" initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.15 }}
          onPointerDown={e => { e.preventDefault(); takeSel() }} onMouseDown={e => e.preventDefault()} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); takeSel() } }}
          // touch: sit under the selection, clear of the native selection menu that iOS / Android draw above it
          style={{ left: Math.max(8, Math.min((document.documentElement.clientWidth || innerWidth) - 104, sel.x - 48)), top: coarse ? sel.bottom + 14 : sel.y - 36 }}
          className="fixed z-[60] cursor-pointer rounded-full border-0 bg-[var(--primary)] px-3 py-1 text-xs font-medium text-[var(--on-primary)] shadow-[var(--shadow)] [@media(pointer:coarse)]:min-h-10 [@media(pointer:coarse)]:px-4 [@media(pointer:coarse)]:text-[13px]">Add to chat</motion.button>
      )}</AnimatePresence>

      <Dialog open={!!adv} onOpenChange={o => !o && setAdv(null)} title="Advanced settings"
        footer={<><Button size="sm" onClick={() => setAdv(null)}>Cancel</Button><Button size="sm" variant="primary" onClick={() => { if (adv) { setS(adv); toast({ title: 'Settings saved', description: `${adv.model} · ${adv.speed} · ${adv.effort} effort · creativity ${adv.temp.toFixed(1)}`, tone: 'ok' }) } setAdv(null) }}>Done</Button></>}>
        {adv && <div className="flex flex-col gap-4">
          <Slider label="Creativity" min={0} max={1} step={0.1} value={adv.temp} onChange={v => setAdv({ ...adv, temp: v })} format={v => v.toFixed(1)} />
          {([['memory', 'Use memory', 'Remember preferences across chats'], ['cites', 'Show citations', 'Link claims to sources'], ['web', 'Web search', 'Search when it helps']] as const).map(([k, t, sub]) => (
            <Switch key={k} checked={adv[k]} onChange={v => setAdv({ ...adv, [k]: v })} label={<span className="flex flex-col"><span>{t}</span><span className="text-xs text-[var(--fg3)]">{sub}</span></span>} />
          ))}
        </div>}
      </Dialog>
    </div>
  )
}
