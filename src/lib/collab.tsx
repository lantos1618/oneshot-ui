import { useEffect, useLayoutEffect, useRef, useState, type PointerEvent as RPointerEvent, type ReactNode } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { Input } from './inputs'
import { Avatar, Badge, Button, EASE_OUT, Icon, IconButton, TOUCH, cn, isCoarsePointer, isTouch, onColorLabel, onMouseLeave, safeColor, spring, surface, svgN, uid, useControllable, useLatest, useNow, useWidth, plural, fmt } from './core'
import { play, useFrameLoop, useViewport } from './motion'
import { AnimatedList } from './data'
import { Collapse, TypingDots, useToast, EmptyState } from './feedback'

/** When a comment or message was written: `createdAt` (epoch ms or ISO) is shown relative to now; `time` is shown as it is (e.g. "2 h"). */
export type CollabTime = { createdAt?: number | string; time?: string }
export type Comment = CollabTime & { id: string; author: string; text: string; replies?: Comment[] }
const collabTime = ({ time, createdAt }: CollabTime) => time ?? (createdAt == null ? '' : fmt.relative(typeof createdAt === 'string' ? Date.parse(createdAt) : createdAt))

function CommentBox({ onSubmit, placeholder, autoFocus }: { onSubmit: (text: string) => void; placeholder: string; autoFocus?: boolean }) {
  const [t, setT] = useState('')
  return (
    <form className="flex gap-2" onSubmit={e => { e.preventDefault(); if (t.trim()) { onSubmit(t.trim()); setT('') } }}>
      <Input autoFocus={autoFocus} value={t} onChange={e => setT(e.target.value)} placeholder={placeholder} className={cn('!h-8 min-w-0 flex-1 [@media(pointer:coarse)]:!text-base', TOUCH.row)} />
      <Button size="sm" variant="primary" type="submit" disabled={!t.trim()} className={cn('flex-none', TOUCH.row)}>{'Send'}</Button>
    </form>
  )
}

/** Threaded comments with inline reply boxes. */
export function CommentThread({ comments, onChange, me = 'You', className }: { comments: Comment[]; onChange: (c: Comment[]) => void; /** your name on new comments (default "You") */ me?: string; className?: string }) {
  const [replyTo, setReplyTo] = useState<string | null>(null)
  const add = (text: string, parent: string | null) => {
    const c: Comment = { id: uid('comment'), author: me, createdAt: Date.now(), text }
    const ins = (list: Comment[]): Comment[] => parent === null ? [...list, c] : list.map(x => x.id === parent ? { ...x, replies: [...(x.replies ?? []), c] } : { ...x, replies: x.replies && ins(x.replies) })
    onChange(ins(comments)); setReplyTo(null)
  }
  const render = (list: Comment[], depth: number): ReactNode => (
    <AnimatedList items={list} keyOf={c => c.id} className={cn(depth > 0 && 'mt-2 border-s-2 border-[var(--line)] ps-3')} render={c => (
      <div className="flex gap-2.5">
        <Avatar name={c.author} size={26} className={COLLAB_AV} />
        <div className="min-w-0 flex-1 text-[13px]">
          <div><b className="font-medium">{c.author}</b> <span className="text-xs text-[var(--fg3)]">{collabTime(c)}</span></div>
          <p className="m-0 text-[var(--fg2)]">{c.text}</p>
          {depth === 0 && <button onClick={() => setReplyTo(replyTo === c.id ? null : c.id)} className="cursor-pointer border-0 bg-transparent p-0 text-xs text-[var(--fg3)] hover:text-[var(--fg)] [@media(pointer:coarse)]:min-h-8 [@media(pointer:coarse)]:pe-3">{'Reply'}</button>}
          {c.replies && render(c.replies, depth + 1)}
          <Collapse open={replyTo === c.id}><div className="pt-2"><CommentBox placeholder={'Reply…'} autoFocus onSubmit={t => add(t, c.id)} /></div></Collapse>
        </div>
      </div>
    )} />
  )
  return <div className={cn('flex flex-col gap-3', className)}>{render(comments, 0)}<CommentBox placeholder={'Add a comment…'} onSubmit={t => add(t, null)} /></div>
}

/** Avatar initials stay readable (≥ 11px) on touch screens, where small avatars otherwise shrink them to ~9px. */
const COLLAB_AV = '[@media(pointer:coarse)]:!h-[30px] [@media(pointer:coarse)]:!w-[30px] [@media(pointer:coarse)]:!text-[11px]'

export type ThreadMessage = CollabTime & { id: string; author: string; text: string }
export type AnchoredThread = {
  id: string; messages: ThreadMessage[]
  /** emoji → count (including yours) */
  reactions?: Record<string, number>
  /** emoji you reacted with */
  mine?: string[]
  resolved?: boolean
}
/** One paragraph of the document: plain text runs, and `{ thread, text }` runs that anchor a thread. */
export type AnchoredParagraph = (string | { thread: string; text: string })[]

/**
 * Comments anchored to highlighted text: the document sits on the left, threads on the right.
 * Hovering a highlight or a thread lights up both; clicking a highlight focuses its thread's reply box.
 * Threads take emoji reactions, replies, and Resolve (dims the anchor, toast with Undo) / Reopen. `me` is the name
 * new replies are signed with.
 */
export function AnchoredComments({ doc, threads, defaultThreads = [], onChange, me, reactions = ['👍', '🎉', '👀'], className }:
  { doc: AnchoredParagraph[]; threads?: AnchoredThread[]; defaultThreads?: AnchoredThread[]; onChange?: (t: AnchoredThread[]) => void; me: string; reactions?: string[]; className?: string }) {
  const [list, setList] = useControllable(threads, defaultThreads, onChange)
  const latest = useLatest(list)
  const [hot, setHot] = useState<string | null>(null)
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const [pop, setPop] = useState<Record<string, number>>({})
  const cards = useRef<Record<string, HTMLDivElement | null>>({})
  const toast = useToast()
  const [wrap, w] = useWidth<HTMLDivElement>()
  const patch = (id: string, f: (t: AnchoredThread) => AnchoredThread) => setList(latest.current.map(t => t.id === id ? f(t) : t))
  const byId = (id: string) => list.find(t => t.id === id)

  const react = (t: AnchoredThread, e: string) => {
    const on = !t.mine?.includes(e)
    patch(t.id, x => {
      const r = { ...x.reactions, [e]: (x.reactions?.[e] ?? 0) + (on ? 1 : -1) }
      if (r[e] <= 0) delete r[e]
      return { ...x, reactions: r, mine: on ? [...(x.mine ?? []), e] : (x.mine ?? []).filter(k => k !== e) }
    })
    setPop(p => ({ ...p, [t.id + e]: (p[t.id + e] ?? 0) + 1 }))
  }
  const resolve = (id: string, resolved: boolean) => {
    patch(id, x => ({ ...x, resolved }))
    if (resolved) toast({ title: 'Thread resolved', tone: 'ok', action: { label: 'Undo', onClick: () => patch(id, x => ({ ...x, resolved: false })) } })
  }
  const reply = (id: string) => {
    const v = (drafts[id] ?? '').trim(); if (!v) return
    patch(id, x => ({ ...x, messages: [...x.messages, { id: uid('reply'), author: me, text: v, createdAt: Date.now() }] }))
    setDrafts(d => ({ ...d, [id]: '' }))
  }
  const focusThread = (id: string) => {
    setHot(id); play(cards.current[id], { x: [0, -4, 0] }, { duration: 0.32, ease: EASE_OUT }) // "look here" nudge
    cards.current[id]?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
    // on touch, focusing the reply box would pop the keyboard over the thread you just jumped to
    if (!isCoarsePointer()) cards.current[id]?.querySelector('input')?.focus({ preventScroll: true })
  }

  return (
    <div ref={wrap} className={cn('grid gap-4', w === 0 || w >= 620 ? 'grid-cols-[minmax(0,1fr)_300px]' : 'grid-cols-1', className)}>
      <div className={cn(surface.card, 'self-start p-4 text-sm leading-[1.8] text-[var(--fg2)]')}>
        {doc.map((p, i) => (
          <p key={i} className="m-0 mb-2.5 last:mb-0">
            {p.map((run, j) => {
              if (typeof run === 'string') return <span key={j}>{run}</span>
              const t = byId(run.thread), res = !!t?.resolved, on = hot === run.thread
              return (
                <mark key={j} role="button" tabIndex={0} aria-label={(res ? `${run.text}: open comment thread (resolved)` : `${run.text}: open comment thread`)}
                  onClick={() => focusThread(run.thread)} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); focusThread(run.thread) } }}
                  onPointerEnter={e => { if (!isTouch(e)) setHot(run.thread) }} onPointerLeave={onMouseLeave(() => setHot(null))} onFocus={() => setHot(run.thread)} onBlur={() => setHot(null)}
                  className={cn('cursor-pointer rounded-[var(--r-sm)] px-px transition-[background-color,color] duration-200 outline-none focus-visible:shadow-[0_0_0_2px_var(--warn)]',
                    // touch: a taller hit area via padding, with the highlight kept to the text (content box)
                    '[@media(pointer:coarse)]:bg-clip-content [@media(pointer:coarse)]:py-[7px]',
                    res ? 'bg-transparent text-[var(--fg2)] underline decoration-[var(--fg3)] decoration-dotted underline-offset-4'
                      : on ? 'bg-[color-mix(in_srgb,var(--warn)_45%,transparent)] text-[var(--fg)]' : 'bg-[color-mix(in_srgb,var(--warn)_22%,transparent)] text-[var(--fg)]')}>
                  {run.text}
                </mark>
              )
            })}
          </p>
        ))}
      </div>
      <div className="flex flex-col gap-2.5">
        {list.map(t => (
          <motion.div key={t.id} ref={el => { cards.current[t.id] = el }} initial={false} animate={{ opacity: t.resolved ? 0.65 : 1, scale: 1 }} transition={{ duration: 0.2 }}
            onPointerEnter={e => { if (!isTouch(e)) setHot(t.id) }} onPointerLeave={onMouseLeave(() => setHot(null))}
            className={cn('overflow-hidden rounded-[var(--r-lg)] border bg-[var(--card)] transition-[box-shadow,border-color] duration-200',
              hot === t.id && !t.resolved ? 'border-[var(--warn)] shadow-[0_0_0_3px_var(--warn-soft)]' : 'border-[var(--line)]')}>
            <AnimatedList items={t.messages} keyOf={x => x.id} className="!gap-0" render={x => (
              <div className="flex gap-2 px-3 py-2.5">
                <Avatar name={x.author} size={26} className={cn('!border-0', COLLAB_AV)} />
                <div className="min-w-0">
                  <b className="text-xs font-semibold">{x.author}</b><span className="ms-1.5 text-[11px] text-[var(--fg3)]">{collabTime(x)}</span>
                  <p className="m-0 mt-0.5 text-[13px] leading-normal">{x.text}</p>
                </div>
              </div>
            )} />
            {t.resolved ? (
              <div className="flex items-center gap-2 px-3 pb-2.5 ps-12 text-xs text-[var(--fg3)]">
                <Icon name="check" size={12} strokeWidth={2.6} className="text-[var(--ok)]" />{'Resolved'}
                <button onClick={() => resolve(t.id, false)} className="ms-auto cursor-pointer rounded-full border border-[var(--line)] bg-[var(--card)] px-2 py-px text-xs text-[var(--fg)] hover:bg-[var(--muted)] [@media(pointer:coarse)]:min-h-9 [@media(pointer:coarse)]:px-3.5">{'Reopen'}</button>
              </div>
            ) : (<>
              <div className="flex flex-wrap items-center gap-1 px-3 pb-2 ps-12">
                {reactions.map(e => {
                  const mine = !!t.mine?.includes(e), n = t.reactions?.[e] ?? 0
                  return (
                    <motion.button key={`${e}${pop[t.id + e] ?? 0}`} aria-pressed={mine} aria-label={n ? `React ${e}, ${n}` : `React ${e}`} onClick={() => react(t, e)}
                      initial={pop[t.id + e] ? { scale: 0.8 } : false} animate={{ scale: 1 }} transition={spring(0.6, 0.35)}
                      className={cn('inline-flex h-6 cursor-pointer items-center gap-1 rounded-full border px-2 text-xs [@media(pointer:coarse)]:h-9 [@media(pointer:coarse)]:min-w-11 [@media(pointer:coarse)]:justify-center [@media(pointer:coarse)]:px-2.5 [@media(pointer:coarse)]:text-sm',
                        mine ? 'border-[var(--accent)] bg-[var(--accent-soft)]' : 'border-[var(--line)] bg-[var(--card)] hover:bg-[var(--muted)]')}>
                      <span>{e}</span>{n > 0 && <span className="tabular-nums text-[var(--fg2)]">{fmt.number(n)}</span>}
                    </motion.button>
                  )
                })}
                <span className="flex-1" />
                <button onClick={() => resolve(t.id, true)} className="inline-flex h-6 cursor-pointer items-center gap-1 rounded-full border border-[var(--line)] bg-[var(--card)] px-2 text-xs hover:bg-[var(--muted)] [@media(pointer:coarse)]:h-9 [@media(pointer:coarse)]:px-3 [@media(pointer:coarse)]:text-[13px]">
                  <Icon name="check" size={11} strokeWidth={2.6} />{'Resolve'}
                </button>
              </div>
              <form onSubmit={e => { e.preventDefault(); reply(t.id) }} className="flex gap-1.5 border-t border-[var(--line)] bg-[color-mix(in_srgb,var(--muted)_40%,var(--card))] p-2">
                <Input value={drafts[t.id] ?? ''} onChange={e => setDrafts(d => ({ ...d, [t.id]: e.target.value }))}
                  placeholder={'Reply…'} aria-label={'Reply'} className={cn('!h-[30px] min-w-0 flex-1 !px-2 [@media(pointer:coarse)]:!text-base', TOUCH.row)} onFocus={() => setHot(t.id)} />
                {/* the input shrinks (min-w-0), so the button is never pushed out of a narrow card */}
                <Button size="sm" variant="primary" type="submit" disabled={!(drafts[t.id] ?? '').trim()} className={cn('flex-none', TOUCH.row)}>{'Reply'}</Button>
              </form>
            </>)}
          </motion.div>
        ))}
      </div>
    </div>
  )
}

export type Collaborator = { name: string; /** a plain CSS colour (hex, rgb(), named) or token such as var(--c3), which keeps it theme-aware; anything else falls back to the accent */ color: string }
/** Someone's cursor on the shared canvas: `x` and `y` are fractions (0–1) of its width and height, so they carry across screen sizes. */
export type PresenceCursor = Collaborator & { id?: string; x: number; y: number }

function CollabCursor({ name, color: raw, elRef, hidden }: { name: string; color: string; elRef: (el: HTMLDivElement | null) => void; hidden?: boolean }) {
  const color = safeColor(raw, 'var(--accent)') // data → style/fill: no `;`, url() or other breakouts
  return (
    <div ref={elRef} aria-hidden className="pointer-events-none absolute top-0 left-0 z-[3] transition-opacity duration-150 will-change-transform" style={{ opacity: hidden ? 0 : 1 }}>
      <svg width="16" height="18" viewBox="0 0 16 18"><path d="M1 1l13 7-6 1.6L5.4 16z" fill={color} stroke="#fff" strokeWidth="1.4" strokeLinejoin="round" /></svg>
      <span className="absolute top-3.5 left-3 rounded-[5px_5px_5px_2px] px-2 py-0.5 text-[11px] font-semibold whitespace-nowrap" style={onColorLabel(color)}>{name}</span>
    </div>
  )
}
const cursorKey = (c: PresenceCursor) => c.id ?? c.name
const cursorAt = (x: number, y: number) => `translate(${svgN(x)}px,${svgN(y)}px)`

/**
 * Live presence on a shared canvas: each of `cursors` (your collaborators, from your presence channel) is drawn with
 * its name and glides to each new position, and an avatar stack ringed in each person's colour counts who's here.
 * `children` is the document under the cursors. With `me`, your own cursor follows the pointer inside the canvas and
 * `onCursorMove` reports where it is (fractions, null when it leaves) so you can broadcast it. Gliding pauses while
 * off screen; under reduced motion cursors jump to their positions.
 */
export function LivePresence({ cursors, me, label = 'Shared document', onCursorMove, actions, children, className }:
  { cursors: readonly PresenceCursor[]; me?: Collaborator; label?: string; onCursorMove?: (at: { x: number; y: number } | null) => void
    actions?: ReactNode; children?: ReactNode; className?: string }) {
  const box = useRef<HTMLDivElement>(null)
  const els = useRef(new Map<string, HTMLDivElement>())
  const shown = useRef(new Map<string, { x: number; y: number }>())
  const mine = useRef<HTMLDivElement | null>(null)
  const [meOn, setMeOn] = useState(false)
  const [gliding, setGliding] = useState(false)
  const reduce = !!useReducedMotion()
  const { visible } = useViewport(box, { amount: 0 })
  const want = useLatest(cursors)
  /** Moves each cursor `dt` seconds towards its position (new ones start there); true while any is still on its way. */
  const step = (dt: number) => {
    const el = box.current; if (!el) return false
    const W = el.clientWidth, H = el.clientHeight, k = Math.min(1, dt * 2.2), seen = new Set<string>()
    let busy = false
    for (const c of want.current) {
      const key = cursorKey(c), tx = c.x * W, ty = c.y * H
      let p = shown.current.get(key)
      if (!p || reduce) p = { x: tx, y: ty }
      else { p.x += (tx - p.x) * k; p.y += (ty - p.y) * k; if (Math.abs(tx - p.x) + Math.abs(ty - p.y) < 0.5) { p.x = tx; p.y = ty } else busy = true }
      shown.current.set(key, p); seen.add(key)
      const cur = els.current.get(key); if (cur) cur.style.transform = cursorAt(p.x, p.y)
    }
    for (const key of shown.current.keys()) if (!seen.has(key)) shown.current.delete(key)
    return busy
  }
  useLayoutEffect(() => { setGliding(step(0)) }, [cursors, reduce]) // eslint-disable-line react-hooks/exhaustive-deps
  useFrameLoop(gliding && visible && !reduce, dt => { if (!step(dt)) setGliding(false) })
  const move = (e: RPointerEvent) => {
    if (!me) return
    const r = box.current!.getBoundingClientRect()
    if (mine.current) mine.current.style.transform = cursorAt(e.clientX - r.left, e.clientY - r.top)
    if (!meOn) setMeOn(true)
    onCursorMove?.({ x: (e.clientX - r.left) / (r.width || 1), y: (e.clientY - r.top) / (r.height || 1) })
  }
  const all = [...(me ? [{ ...me, key: '' }] : []), ...cursors.map(c => ({ ...c, key: cursorKey(c) }))]
  return (
    <div className={cn('flex flex-col gap-3', className)}>
      <div className="flex items-center justify-between gap-2">
        <div className="flex">
          {all.map((p, i) => (
            <span key={p.key} className={cn('relative rounded-full', i > 0 && '-ms-1')} style={{ boxShadow: `0 0 0 2px var(--card), 0 0 0 3.5px ${safeColor(p.color, 'var(--accent)')}`, zIndex: all.length - i }}>
              <Avatar name={p.name} size={28} className="!border-0 [@media(pointer:coarse)]:!text-[11px]" />
            </span>
          ))}
        </div>
        <div className="flex items-center gap-2"><span className="text-xs text-[var(--fg3)]" aria-live="polite">{plural(all.length, 'person here', 'people here')}</span>{actions}</div>
      </div>
      {/* touch: tap or drag sideways to place your cursor (it stays put); vertical swipes still scroll the page */}
      <div ref={box} onPointerMove={move} onPointerDown={move} role="group" aria-label={all.length ? `${label}: ${fmt.list(all.map(p => p.name))} editing` : label}
        onPointerLeave={e => { if (me && e.pointerType === 'mouse') { setMeOn(false); onCursorMove?.(null) } }}
        className={cn(surface.md, 'relative min-h-[200px] flex-1 touch-pan-y overflow-hidden !bg-[var(--bg)]', me && 'cursor-none')}>
        {children}
        {cursors.map(c => { const key = cursorKey(c); return <CollabCursor key={key} name={c.name.split(' ')[0]} color={c.color} elRef={el => { if (el) els.current.set(key, el); else els.current.delete(key) }} /> })}
        {me && <CollabCursor name={'You'} color={me.color} hidden={!meOn} elRef={el => { mine.current = el }} />}
      </div>
    </div>
  )
}

/** A chat message. A message you sent is `sending` while `onSend` works on it and `failed` if it rejected. */
export type InboxMessage = { id: string; from: 'me' | 'them'; text: string; status?: 'sending' | 'failed' }
export type InboxConversation = {
  id: string; name: string; role: string; location: string
  /** IANA zone used for the live "Local time" in the details pane */
  timeZone: string
  online: boolean; last: string; unread?: number; messages: InboxMessage[]; files?: string[]
}

/** Most messages a ChatInbox thread keeps (older ones drop off the top). */
const INBOX_MAX_MESSAGES = 500
function InboxTyping({ name }: { name: string }) {
  return (
    <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, transition: { duration: 0.1 } }}
      className="flex self-start rounded-[var(--r-lg)] rounded-es-[5px] bg-[var(--muted)] px-3 py-1.5">
      <TypingDots label={`${name} is typing`} />
    </motion.div>
  )
}

/**
 * Three-pane chat inbox: searchable conversation list (unread counts, online dots, last-message time), the thread
 * (day divider, bubbles, typing indicator) and a details pane (role, location, live local time, shared files, and Call
 * / Profile when `onCall` / `onProfile` are given). The thread slides on switching.
 * `conversations` + `onConversationsChange` (or `defaultConversations`) hold the data: sending appends your message and
 * calls `onSend(conversationId, text)`; while its promise is pending the message shows as sending, and a rejection marks
 * it failed with Retry. Replies are yours to add (new messages in `conversations`), as is `typing` (who is typing now).
 * `selected` / `onSelectedChange` is the open conversation. Under ~860px the details pane becomes a slide-over; under
 * ~620px the list and thread swap.
 */
export function ChatInbox({ conversations, defaultConversations = [], onConversationsChange, selected, defaultSelected, onSelectedChange, onSend, typing = {}, onCall, onProfile, className }: {
  conversations?: InboxConversation[]; defaultConversations?: InboxConversation[]; onConversationsChange?: (c: InboxConversation[]) => void
  selected?: string; defaultSelected?: string; onSelectedChange?: (id: string) => void
  onSend?: (conversationId: string, text: string) => void | Promise<void>
  /** conversation ids whose other person is typing */ typing?: Readonly<Record<string, boolean>>
  onCall?: (c: InboxConversation) => void; onProfile?: (c: InboxConversation) => void
  className?: string }) {
  const [list, setListState] = useControllable(conversations, defaultConversations, onConversationsChange)
  // what was last set, so a send that settles before the next render builds on it
  const latest = useRef(list); latest.current = list
  const setList = (next: InboxConversation[]) => { latest.current = next; setListState(next) }
  const [cur, setCur] = useControllable(selected, defaultSelected ?? list[0]?.id ?? '', onSelectedChange)
  const [dir, setDir] = useState(0)
  const [q, setQ] = useState('')
  const [draft, setDraft] = useState('')
  const [pane, setPane] = useState<'list' | 'thread'>('list')
  const [details, setDetails] = useState(false)
  const scroller = useRef<HTMLDivElement>(null)
  const composer = useRef<HTMLInputElement>(null)
  const [wrap, w] = useWidth<HTMLDivElement>()
  const wide = w === 0 || w >= 860, mid = !wide && w >= 620, narrow = !wide && !mid
  const c = list.find(x => x.id === cur) ?? list[0]
  const { visible: onScreen } = useViewport(wrap, { amount: 0 })
  const clock = useNow(30000, onScreen) // read after mount, then every 30 s while on screen
  useEffect(() => { const el = scroller.current; if (el) el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' }) }, [c?.messages.length, typing[c?.id ?? ''], cur])
  const patchMessage = (convId: string, msgId: string, status: InboxMessage['status']) =>
    setList(latest.current.map(x => x.id === convId ? { ...x, messages: x.messages.map(m => { if (m.id !== msgId) return m; const { status: _, ...rest } = m; return status ? { ...rest, status } : rest }) } : x))

  const select = (id: string) => {
    if (id === cur) { setPane('thread'); return }
    const a = list.findIndex(x => x.id === cur), b = list.findIndex(x => x.id === id)
    setDir(Math.sign(b - a) || 1); setCur(id); setPane('thread'); setDraft('')
    if (list.find(x => x.id === id)?.unread) setList(list.map(x => x.id === id ? { ...x, unread: 0 } : x))
    if (!isCoarsePointer()) requestAnimationFrame(() => composer.current?.focus({ preventScroll: true }))
  }
  /** Hands a message to `onSend` (adding it to the thread, or updating it on Retry); a pending promise shows it as sending. */
  const deliver = (convId: string, msg: InboxMessage, add: boolean) => {
    const r = onSend?.(convId, msg.text), pending = !!r && typeof (r as Promise<void>).then === 'function'
    const { status: _, ...rest } = msg, m: InboxMessage = pending ? { ...rest, status: 'sending' } : rest
    setList(latest.current.map(x => x.id !== convId ? x : add
      ? { ...x, messages: [...x.messages, m].slice(-INBOX_MAX_MESSAGES), last: fmt.time(Date.now()) }
      : { ...x, messages: x.messages.map(y => y.id === m.id ? m : y) }))
    if (pending) (r as Promise<void>).then(() => patchMessage(convId, m.id, undefined), () => patchMessage(convId, m.id, 'failed'))
  }
  const send = () => {
    const v = draft.trim(); if (!v || !c) return
    setDraft(''); deliver(c.id, { id: uid('msg'), from: 'me', text: v }, true)
  }
  const shown = list.filter(x => x.name.toLowerCase().includes(q.trim().toLowerCase()))
  // local time in another zone; `clock` is read after mount, so the server never renders a time
  const time = c && clock !== null ? fmt.time(clock, { hour: '2-digit', minute: '2-digit', timeZone: c.timeZone }) : '–'

  const listPane = (
    <aside className={cn('flex min-h-0 flex-col', !narrow && 'border-e border-[var(--line)]')} aria-label={'Conversations'}>
      <div className="border-b border-[var(--line)] p-2.5"><Input value={q} onChange={e => setQ(e.target.value)} placeholder={'Search'} aria-label={'Search conversations'} className={cn('!h-8 [@media(pointer:coarse)]:!text-base', TOUCH.row)} /></div>
      <div className="min-h-0 flex-1 overflow-auto" role="listbox" aria-label={'Conversations'}>
        {shown.map(x => {
          const last = x.messages[x.messages.length - 1]
          return (
            <div key={x.id} role="option" aria-selected={x.id === cur} tabIndex={0} onClick={() => select(x.id)} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); select(x.id) } }}
              className={cn('relative flex cursor-pointer gap-2.5 border-b border-[var(--line)] px-3 py-2.5 outline-none focus-visible:shadow-[inset_0_0_0_2px_var(--accent)]',
                x.id === cur && !narrow ? 'bg-[var(--accent-soft)]' : 'hover:bg-[var(--muted)]')}>
              <Avatar name={x.name} size={36} status={x.online ? 'online' : undefined} className="!border-0" />
              <div className="min-w-0 flex-1">
                <b className="flex justify-between gap-2 text-[13px] font-semibold">{x.name}<span className="text-[11px] font-normal text-[var(--fg2)]">{x.last}</span></b>
                <p className={cn('m-0 mt-0.5 truncate pe-6 text-xs', typing[x.id] ? 'text-[var(--accent)]' : 'text-[var(--fg2)]')}>{typing[x.id] ? 'typing…' : last?.from === 'me' ? `You: ${last.text}` : last?.text ?? ''}</p>
              </div>
              <AnimatePresence>
                {!!x.unread && (
                  <motion.span key={x.unread} initial={{ scale: 0.4 }} animate={{ scale: 1 }} exit={{ scale: 0, opacity: 0 }} transition={spring(0.55, 0.4)} aria-label={`${x.unread} unread`}
                    className="absolute end-3 bottom-3 inline-flex"><Badge size="sm" className="min-w-[18px] justify-center !bg-[var(--accent)] font-semibold tabular-nums !text-[var(--card)]">{fmt.number(x.unread)}</Badge></motion.span>
                )}
              </AnimatePresence>
            </div>
          )
        })}
        {!shown.length && <EmptyState size="sm" title={q.trim() ? `No conversations match “${q}”` : 'No conversations yet'} />}
      </div>
    </aside>
  )

  const detailsPane = c && (
    <div className="flex flex-col items-center gap-1.5 overflow-auto px-3 py-4 text-center">
      <Avatar name={c.name} size={64} status={c.online ? 'online' : undefined} className="!border-0" />
      <b className="mt-1 text-sm">{c.name}</b>
      <span className="text-xs text-[var(--fg3)]">{c.role}</span>
      {(onCall || onProfile) && <div className="mt-2 flex gap-2">
        {onCall && <Button size="sm" className={TOUCH.tap36} onClick={() => onCall(c)}><Icon name="phone" size={13} />{'Call'}</Button>}
        {onProfile && <Button size="sm" className={TOUCH.tap36} onClick={() => onProfile(c)}><Icon name="user" size={13} />{'Profile'}</Button>}
      </div>}
      <dl className="m-0 mt-3 w-full text-start text-xs">
        {[['Location', c.location], ['Local time', time], ['Shared files', fmt.number(c.files?.length ?? 0)]].map(([k, v]) => (
          <div key={k} className="flex justify-between border-b border-[var(--line)] py-2"><dt className="text-[var(--fg3)]">{k}</dt><dd className="m-0 ui-num">{v}</dd></div>
        ))}
      </dl>
      {!!c.files?.length && (
        <ul className="m-0 mt-2 flex w-full list-none flex-col gap-1 p-0 text-start text-xs">
          {c.files.map(f => <li key={f} className="flex items-center gap-2 rounded-[var(--r-md)] px-1.5 py-1 hover:bg-[var(--muted)]"><Icon name="file" size={13} className="text-[var(--fg3)]" /><span className="truncate">{f}</span></li>)}
        </ul>
      )}
    </div>
  )

  const threadPane = c && (
    <div className="relative flex min-h-0 min-w-0 flex-col overflow-hidden">
      <div className="flex h-[54px] flex-none items-center gap-2.5 border-b border-[var(--line)] px-3 text-sm">
        {narrow && <IconButton icon="chevronLeft" label={'Back to conversations'} onClick={() => setPane('list')} className={TOUCH.tap36} />}
        <Avatar name={c.name} size={30} className="!border-0" />
        <div className="min-w-0 flex-1"><b className="block truncate font-semibold">{c.name}</b><div className="text-xs text-[var(--fg3)]">{typing[c.id] ? 'typing…' : c.online ? 'Online' : `Last seen ${c.last}`}</div></div>
        {!wide && <IconButton icon="info" label={'Conversation details'} aria-pressed={details} onClick={() => setDetails(d => !d)} className={TOUCH.tap36} />}
      </div>
      <motion.div key={c.id} ref={scroller} initial={dir ? { opacity: 0, x: 12 * dir } : false} animate={{ opacity: 1, x: 0 }} transition={spring(0.2, 0.3)}
        className="flex min-h-0 flex-1 flex-col gap-1.5 overflow-auto p-3" role="log" aria-label={`Messages with ${c.name}`}>
        <div className="my-2 flex items-center gap-3 text-[11px] text-[var(--fg3)]"><span className="h-px flex-1 bg-[var(--line)]" />{'Today'}<span className="h-px flex-1 bg-[var(--line)]" /></div>
        <AnimatePresence initial={false}>
          {c.messages.map(msg => (
            <motion.div key={msg.id} initial={{ opacity: 0, y: 10, scale: 0.96 }} animate={{ opacity: msg.status === 'sending' ? 0.6 : 1, y: 0, scale: 1 }} transition={spring(0.3, 0.35)}
              className={cn('flex flex-col gap-0.5', narrow ? 'max-w-[84%]' : 'max-w-[70%]', msg.from === 'me' ? 'origin-bottom-right items-end self-end' : 'origin-bottom-left items-start self-start')}>
              <div className={cn('rounded-[var(--r-lg)] px-3 py-2 text-[13px] leading-[1.45] [overflow-wrap:anywhere]', msg.from === 'me' ? 'rounded-ee-[5px] bg-[var(--primary)] text-[var(--on-primary)]' : 'rounded-es-[5px] bg-[var(--muted)]')}>
                {msg.text}
              </div>
              {msg.status === 'failed' && <span role="alert" className="flex items-center gap-1.5 text-[11px] text-[var(--bad)]">{'Not sent'}
                <button type="button" onClick={() => deliver(c.id, msg, false)} className="cursor-pointer border-0 bg-transparent p-0 font-semibold text-inherit underline underline-offset-2 [@media(pointer:coarse)]:min-h-8">{'Retry'}</button></span>}
            </motion.div>
          ))}
          {typing[c.id] && <InboxTyping key="typing" name={c.name.split(' ')[0]} />}
        </AnimatePresence>
      </motion.div>
      <form onSubmit={e => { e.preventDefault(); send() }} className="m-2.5 flex flex-none items-center gap-1.5 rounded-full border border-[var(--line)] bg-[var(--card)] py-1 pe-1 ps-4 focus-within:border-[var(--fg3)]">
        <input ref={composer} value={draft} onChange={e => setDraft(e.target.value)} placeholder={'Write a message'} aria-label={'Message'}
          className={cn('h-7 min-w-0 flex-1 border-0 bg-transparent text-[13px] text-[var(--fg)] outline-none placeholder:text-[var(--fg3)] [@media(pointer:coarse)]:h-9', TOUCH.input)} />
        <motion.button type="submit" aria-label={'Send'} disabled={!draft.trim()} whileTap={{ scale: 0.9 }}
          className="grid h-7 w-7 flex-none [@media(pointer:coarse)]:h-9 [@media(pointer:coarse)]:w-9 cursor-pointer place-items-center rounded-full border-0 bg-[var(--primary)] text-[var(--on-primary)] transition-opacity disabled:cursor-default disabled:opacity-40">
          <Icon name="send" size={15} strokeWidth={2.5} />
        </motion.button>
      </form>
      <AnimatePresence>
        {!wide && details && (
          <motion.div key="details" initial={{ x: '100%' }} animate={{ x: 0 }} exit={{ x: '100%' }} transition={spring(0.15, 0.35)}
            className="absolute inset-y-0 end-0 z-10 flex w-[min(260px,85%)] flex-col border-s border-[var(--line)] bg-[var(--card)] shadow-[var(--shadow)]">
            <div className="flex justify-end p-1.5"><IconButton icon="x" label={'Close details'} onClick={() => setDetails(false)} className={TOUCH.tap36} /></div>
            {detailsPane}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )

  return (
    <div ref={wrap} className={cn(surface.card, 'grid h-[480px] grid-rows-[minmax(0,1fr)] overflow-hidden',
      wide ? 'grid-cols-[260px_minmax(0,1fr)_240px]' : mid ? 'grid-cols-[220px_minmax(0,1fr)]' : 'grid-cols-1', className)}>
      {(!narrow || pane === 'list') && listPane}
      {(!narrow || pane === 'thread') && threadPane}
      {wide && <aside className="flex min-h-0 flex-col border-s border-[var(--line)]" aria-label={'Details'}>{detailsPane}</aside>}
    </div>
  )
}
