import type { MentionCommand, MentionPerson } from '../lib/editor'

/* Sample editor content for the showcase (0.4: moved out of the library; the editors start empty). */

/** The showcase's sample document: pass it as RichTextEditor's `defaultValue`. */
export const RTE_SAMPLE = '<h2>Launch notes</h2><p>We’re shipping the new <b>pricing page</b> on Thursday. The yearly plan now saves <i>20%</i>, and the toggle sits above the cards.</p><ul><li>Legal review is done</li><li>Images are final</li></ul><blockquote>Ship small, ship often.</blockquote>'

/** Sample people for MentionsInput's `people`. */
export const MENTION_PEOPLE: MentionPerson[] = [
  { id: 'al', name: 'Alex Lee', sub: 'Design' }, { id: 'bk', name: 'Bea Kim', sub: 'Product' }, { id: 'cm', name: 'Chris Moe', sub: 'Engineering' },
  { id: 'dn', name: 'Dana Ng', sub: 'Research' }, { id: 'ep', name: 'Eli Park', sub: 'Sales' },
]

/** Sample slash commands for MentionsInput's `commands`. */
export const MENTION_COMMANDS: MentionCommand[] = [
  { cmd: '/todo', hint: 'Create a task' }, { cmd: '/remind', hint: 'Set a reminder' }, { cmd: '/poll', hint: 'Start a poll' }, { cmd: '/giphy', hint: 'Insert a GIF' }, { cmd: '/code', hint: 'Code block' },
]
