import { useState } from 'react'
import { motion } from 'motion/react'
import { Badge, Button, Icon, Spinner, TOUCH, cn, inputClass, sleep, spring } from '../lib/core'
import { ChatCard } from '../lib/aichat'

/* Demo-only AI pieces for the showcase: nothing here talks to a real app. */

/** A word match over the person's text: the showcase's stand-in for an app that knows which requests act on something. */
export const AI_DEMO_RISKY = /send|email|remind|create|open|post|deploy|delete/i
/** AgentComposer `needsApproval` for the demo: plain-string replies to "risky" requests get a (non-blocking) approval card. */
export const aiDemoNeedsApproval = (text: string) => AI_DEMO_RISKY.test(text)

/**
 * A scripted approval answer for AssistantChat demos: the drafted message with Edit, Don't send and Send. Nothing is
 * sent: "Sent" appears after a fixed delay, which is why this lives in the showcase and not in the library.
 */
export function ChatApproval({ title, to, body: initial, className }: { title: string; to: string; body: string; className?: string }) {
  const [state, setState] = useState<'ask' | 'edit' | 'sending' | 'sent' | 'unsent' | 'declined'>('ask')
  const [body, setBody] = useState(initial)
  const send = async () => { setState('sending'); await sleep(900); setState('sent') }
  return (
    <ChatCard title={title} sub={to} badge={<Badge>{'demo'}</Badge>} className={className}>
      {state === 'edit'
        ? <textarea autoFocus value={body} onChange={e => setBody(e.target.value)} rows={3} aria-label={'Edit message'} className={cn(inputClass, '!h-auto mb-2.5 resize-none py-2 leading-normal shadow-[0_0_0_1.5px_var(--accent)]', TOUCH.input)} />
        : <div className="mb-2.5 rounded-[var(--r-md)] bg-[var(--muted)] px-3 py-2.5 text-[13px] leading-normal">{body}</div>}
      <div className="flex min-h-[30px] flex-wrap items-center justify-end gap-1.5">
        {(state === 'ask' || state === 'edit') && <>
          <Button size="sm" variant="ghost" onClick={() => setState(state === 'edit' ? 'ask' : 'edit')}>{state === 'edit' ? 'Done' : 'Edit'}</Button>
          <Button size="sm" onClick={() => setState('declined')}>{'Don’t send'}</Button>
          <Button size="sm" variant="primary" onClick={send}>{'Send'}</Button></>}
        {state === 'sending' && <span className="me-auto flex items-center gap-2 text-xs text-[var(--fg3)]"><Spinner size={12} />{'Sending…'}</span>}
        {state === 'sent' && <><motion.span initial={{ scale: 0.6 }} animate={{ scale: 1 }} transition={spring(0.5, 0.35)} className="me-auto"><Badge tone="ok"><Icon name="check" size={11} strokeWidth={3} />{'Sent'}</Badge></motion.span>
          <Button size="sm" variant="ghost" onClick={() => setState('unsent')}>{'Undo'}</Button></>}
        {state === 'unsent' && <span className="me-auto text-xs text-[var(--fg3)]">{'Unsent. Nothing left your outbox.'}</span>}
        {state === 'declined' && <span className="me-auto text-xs text-[var(--fg3)]">{'Not sent. The draft is saved.'}</span>}
      </div>
    </ChatCard>
  )
}
