import { useState } from 'react'
import { type InboxConversation, type Notification, NotificationBell } from '../lib'
import { Section, Spec, specLazy } from './kit'

/* The collaboration module loads when one of its cards first mounts. */
const LazyAnchoredComments = specLazy(() => import('../lib/collab').then(m => m.AnchoredComments))
const LazyChatInbox = specLazy(() => import('../lib/collab').then(m => m.ChatInbox))
const LazyLivePresence = specLazy(() => import('../lib/collab').then(m => m.LivePresence))

const COLLAB_INBOX: InboxConversation[] = [
  { id: 'bk', name: 'Bea Kim', role: 'Design lead', location: 'London', timeZone: 'Europe/London', online: true, last: '11:42', unread: 2,
    files: ['Pricing mock v3.fig', 'Onboarding flow.pdf', 'Hero spacing.png'],
    messages: [{ from: 'them', text: 'Morning! Did you see the new pricing mock?' }, { from: 'me', text: 'Yes, looks great. One question on the toggle.' }, { from: 'them', text: 'Shoot' }, { from: 'them', text: 'Also can you review the deck before 3?' }] },
  { id: 'cm', name: 'Chris Moe', role: 'Staff engineer', location: 'Zürich', timeZone: 'Europe/Zurich', online: true, last: '10:05',
    files: ['auth-fix.diff', 'Incident notes.md', 'Load test.csv', 'Session tokens.pdf', 'Rollout plan.md'],
    messages: [{ from: 'them', text: 'Shipped the auth fix 🚀' }, { from: 'me', text: 'Legend, thanks Chris' }] },
  { id: 'dn', name: 'Dana Ng', role: 'VP Engineering', location: 'Berlin', timeZone: 'Europe/Berlin', online: false, last: 'Yesterday', unread: 1,
    files: ['Q4 roadmap.pdf', 'Hiring plan.xlsx', 'Org chart.png', 'Offsite agenda.md', 'Budget.xlsx', 'Team health.pdf', 'Retro.md'],
    messages: [{ from: 'them', text: 'Lunch on Friday?' }] },
  { id: 'ep', name: 'Eli Park', role: 'VP Sales', location: 'New York', timeZone: 'America/New_York', online: false, last: 'Mon',
    files: ['Northwind MSA.pdf', 'Order form.pdf', 'Pricing sheet.xlsx', 'Security review.pdf', 'Renewal deck.key', 'Call notes.md', 'Quote.pdf', 'Logo.svg', 'W-9.pdf'],
    messages: [{ from: 'me', text: 'Sent you the contract' }, { from: 'them', text: 'Got it, signing today' }] },
]

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

        <LazyLivePresence className="flex-1" actions={<NotificationBell items={notes} onChange={setNotes} />} />
      </Spec>
      <Spec title="Chat inbox" desc="Three panes: conversations, thread, details. Unread counts, typing indicator, replies arrive." span={3}>
        <LazyChatInbox conversations={COLLAB_INBOX} />
      </Spec>
    </Section>
  )
}
