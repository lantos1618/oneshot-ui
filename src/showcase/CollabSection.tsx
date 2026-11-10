import { useState, type ReactNode } from 'react'
import { useReducedMotion } from 'motion/react'
import { type Notification, NotificationBell, useViewport } from '../lib'
import { type InboxConversation } from '../lib/collab'
import { DEMO_PRESENCE_ME, DEMO_PRESENCE_PEOPLE, useInboxSim, usePresenceSim } from '../examples/collab-sim'
import { Section, Spec, specLazy } from './kit'

/* The collaboration module loads when one of its cards first mounts. */
const LazyAnchoredComments = specLazy(() => import('../lib/collab').then(m => m.AnchoredComments))
const LazyChatInbox = specLazy(() => import('../lib/collab').then(m => m.ChatInbox))
const LazyLivePresence = specLazy(() => import('../lib/collab').then(m => m.LivePresence))

const COLLAB_INBOX: InboxConversation[] = [
  { id: 'bk', name: 'Bea Kim', role: 'Design lead', location: 'London', timeZone: 'Europe/London', online: true, last: '11:42', unread: 2,
    files: ['Pricing mock v3.fig', 'Onboarding flow.pdf', 'Hero spacing.png'],
    messages: [{ id: 'm1', from: 'them', text: 'Morning! Did you see the new pricing mock?' }, { id: 'm2', from: 'me', text: 'Yes, looks great. One question on the toggle.' }, { id: 'm3', from: 'them', text: 'Shoot' }, { id: 'm4', from: 'them', text: 'Also can you review the deck before 3?' }] },
  { id: 'cm', name: 'Chris Moe', role: 'Staff engineer', location: 'Zürich', timeZone: 'Europe/Zurich', online: true, last: '10:05',
    files: ['auth-fix.diff', 'Incident notes.md', 'Load test.csv', 'Session tokens.pdf', 'Rollout plan.md'],
    messages: [{ id: 'm5', from: 'them', text: 'Shipped the auth fix 🚀' }, { id: 'm6', from: 'me', text: 'Legend, thanks Chris' }] },
  { id: 'dn', name: 'Dana Ng', role: 'VP Engineering', location: 'Berlin', timeZone: 'Europe/Berlin', online: false, last: 'Yesterday', unread: 1,
    files: ['Q4 roadmap.pdf', 'Hiring plan.xlsx', 'Org chart.png', 'Offsite agenda.md', 'Budget.xlsx', 'Team health.pdf', 'Retro.md'],
    messages: [{ id: 'm7', from: 'them', text: 'Lunch on Friday?' }] },
  { id: 'ep', name: 'Eli Park', role: 'VP Sales', location: 'New York', timeZone: 'America/New_York', online: false, last: 'Mon',
    files: ['Northwind MSA.pdf', 'Order form.pdf', 'Pricing sheet.xlsx', 'Security review.pdf', 'Renewal deck.key', 'Call notes.md', 'Quote.pdf', 'Logo.svg', 'W-9.pdf'],
    messages: [{ id: 'm8', from: 'me', text: 'Sent you the contract' }, { id: 'm9', from: 'them', text: 'Got it, signing today' }] },
]

/** LivePresence fed by the drifting-cursor simulation (only while on screen, and not under reduced motion). */
function PresenceDemo({ actions }: { actions: ReactNode }) {
  const reduce = useReducedMotion()
  const { ref, visible } = useViewport<HTMLDivElement>(null, { amount: 0 })
  const cursors = usePresenceSim(DEMO_PRESENCE_PEOPLE, visible && !reduce)
  return (
    <div ref={ref} className="flex flex-1 flex-col">
      <LazyLivePresence className="flex-1" cursors={cursors} me={DEMO_PRESENCE_ME} label="Q4 planning" actions={actions}>
        <div className="absolute inset-4 flex flex-col gap-2">
          <b className="text-sm">Q4 planning</b>
          {['92%', '92%', '64%', '92%', '64%'].map((wd, i) => <div key={i} className="h-[9px] rounded-[var(--r-sm)] bg-[var(--line)]" style={{ width: wd }} />)}
        </div>
      </LazyLivePresence>
    </div>
  )
}

/** ChatInbox driven by the demo host: canned replies, and pings from other threads while on screen. */
function InboxDemo() {
  const { ref, visible } = useViewport<HTMLDivElement>(null, { amount: 0 })
  const inbox = useInboxSim(COLLAB_INBOX, { active: visible })
  return <div ref={ref}><LazyChatInbox {...inbox} /></div>
}

export function CollabSection() {
  const [notes, setNotes] = useState<Notification[]>([
    { id: 'n1', title: 'Bea mentioned you', body: '“@alex can you review the deck?”', time: '3 min ago' },
    { id: 'n2', title: 'Deploy finished', body: 'production · v2.4.1', time: '1 h ago' },
    { id: 'n3', title: 'Dana joined Q4 planning', time: 'Yesterday', read: true },
  ])
  return (
    <Section id="collab" title="Collaboration" desc="Comments, presence and conversations: the pieces that make an app feel shared.">
      <Spec title="Comments and threads" desc="Anchored to highlighted text. Reply, react, resolve." span={2}>
        <LazyAnchoredComments
          me={DEMO_PRESENCE_ME.name}
          doc={[
            ['The new onboarding flow cuts setup from ', { thread: 't0', text: 'eleven steps to four' }, ', mostly by importing settings from the workspace.'],
            ['We still need to decide whether ', { thread: 't1', text: 'the team invite step' }, ' is optional or required for paid plans.'],
          ]}
          defaultThreads={[
            { id: 't0', reactions: { '👍': 2 }, messages: [
              { id: 'a', author: 'Bea Kim', text: 'Love this. Can we show the step count in the header?', time: '2 h' },
              { id: 'b', author: 'Chris Moe', text: 'Yes, adding it to the progress bar.', time: '1 h' }] },
            { id: 't1', messages: [{ id: 'c', author: 'Dana Ng', text: 'Required for Team and up, optional for Pro?', time: '35 min' }] },
          ]} />
      </Spec>
      <Spec title="Live presence" desc="Collaborators’ cursors with names. Move your mouse in the canvas (or tap it on a phone).">
        <PresenceDemo actions={<NotificationBell items={notes} onChange={setNotes} />} />
      </Spec>
      <Spec title="Chat inbox" desc="Three panes: conversations, thread, details. Unread counts, typing indicator, replies arrive." span={3}>
        <InboxDemo />
      </Spec>
    </Section>
  )
}
