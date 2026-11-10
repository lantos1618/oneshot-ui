import { useEffect, useRef, useState } from 'react'
import type { Collaborator, InboxConversation, InboxMessage, PresenceCursor } from '../lib/collab'

/* Showcase-only simulations for the collaboration components: drifting collaborators and an inbox that answers back. */

export const DEMO_PRESENCE_PEOPLE: Collaborator[] = [{ name: 'Bea Kim', color: 'var(--c3)' }, { name: 'Chris Moe', color: 'var(--c4)' }, { name: 'Dana Ng', color: 'var(--warn)' }]
export const DEMO_PRESENCE_ME: Collaborator = { name: 'Alex Lee', color: 'var(--accent)' }

/** Timers that are all cleared when the component unmounts. */
function useTimers() {
  const live = useRef(new Set<ReturnType<typeof setTimeout>>())
  useEffect(() => { const set = live.current; return () => { set.forEach(clearTimeout); set.clear() } }, [])
  return (ms: number, f: () => void) => { const t = setTimeout(() => { live.current.delete(t); f() }, ms); live.current.add(t); return t }
}

/** Cursors for LivePresence that wander to a new random spot every 1–3.5 s while `active`. */
export function usePresenceSim(people: readonly Collaborator[] = DEMO_PRESENCE_PEOPLE, active = true): PresenceCursor[] {
  const [cursors, setCursors] = useState<PresenceCursor[]>(() => people.map((p, i) => ({ ...p, id: p.name, x: 0.08 + i * 0.2, y: 0.2 + i * 0.15 })))
  const later = useTimers()
  useEffect(() => {
    if (!active) return
    const ts = people.map((_, i) => {
      const box = { t: 0 as ReturnType<typeof setTimeout> | 0 }
      const next = () => { box.t = later(1000 + Math.random() * 2500, () => { setCursors(cs => cs.map((c, k) => k === i ? { ...c, x: 0.04 + Math.random() * 0.76, y: 0.1 + Math.random() * 0.72 } : c)); next() }) }
      next()
      return box
    })
    return () => ts.forEach(b => { if (b.t) clearTimeout(b.t) })
  }, [people, active]) // eslint-disable-line react-hooks/exhaustive-deps
  return cursors
}

const DEMO_REPLIES = ['Sounds good 👍', 'On it', 'Can we chat at 4?', 'Perfect, thanks!', 'Let me check and get back to you']
const DEMO_PINGS = ['Quick one: are we still on for the review?', 'Sent you the notes from today', 'Can you take a look when you have a sec?', 'Heads up, the build is green again']
let demoSeq = 0
const demoMessage = (from: InboxMessage['from'], text: string): InboxMessage => ({ id: `demo-${++demoSeq}`, from, text })
const pick = <T,>(xs: readonly T[]) => xs[Math.floor(Math.random() * xs.length)]

/**
 * ChatInbox's demo host: every message you send is "delivered" after a short wait, then a canned reply is typed back;
 * while `active`, other threads ping up to three times. Spread the result into ChatInbox.
 */
export function useInboxSim(initial: InboxConversation[], { active = true, replies = DEMO_REPLIES }: { active?: boolean; replies?: readonly string[] } = {}) {
  const [conversations, setConversations] = useState(initial)
  const [typing, setTyping] = useState<Record<string, boolean>>({})
  const selected = useRef(initial[0]?.id), list = useRef(conversations); list.current = conversations
  const pings = useRef(3)
  const later = useTimers()
  const deliver = (id: string, text: string) => {
    setTyping(t => ({ ...t, [id]: false }))
    setConversations(l => l.map(x => x.id === id ? { ...x, messages: [...x.messages, demoMessage('them', text)], last: 'now', unread: id === selected.current ? 0 : (x.unread ?? 0) + 1 } : x))
  }
  const answer = (id: string, text: string, typeIn: number, sendIn: number) => { later(typeIn, () => setTyping(t => ({ ...t, [id]: true }))); later(sendIn, () => deliver(id, text)) }
  useEffect(() => {
    if (!active) return
    let t: ReturnType<typeof setTimeout> | undefined
    const schedule = () => {
      if (pings.current <= 0) return
      t = later(14000 + Math.random() * 8000, () => {
        const others = list.current.filter(x => x.id !== selected.current)
        if (others.length) { pings.current--; answer(pick(others).id, pick(DEMO_PINGS), 0, 1500) }
        schedule()
      })
    }
    schedule()
    return () => clearTimeout(t)
  }, [active]) // eslint-disable-line react-hooks/exhaustive-deps
  return {
    conversations, onConversationsChange: setConversations, typing,
    onSelectedChange: (id: string) => { selected.current = id },
    onSend: (id: string) => new Promise<void>(res => { later(300, res) }).then(() => answer(id, pick(replies), 400, 1800)),
  }
}
