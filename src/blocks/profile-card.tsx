import { useState, type ReactNode } from 'react'
import { motion } from 'motion/react'
import { AnimatedNumber, Avatar, Badge, Button, Icon, IconButton, TOUCH, cn, defineMessages, spring, surface, Tabs, type TabItem, useLocale, useMessages } from '../lib'

/* Profile card: cover, avatar, follow and message actions, stats and tabs.
   Copy-in block (registry: `registry:block`), not part of the npm API: copy it into your app and edit freely. It builds
   on the library through `../lib` (in your app: `@lyndon/ui`). */

/* Strings: English plus machine-drafted German and Arabic (have them reviewed). */
const PROFILE_MSG = defineMessages('profile', {
  en: { messageTo: 'Message {name}', following: 'Following', follow: 'Follow', pro: 'Pro', followersTitle: '{count, plural, one {# follower} other {# followers}}', followers: 'followers', followingCount: 'following', projects: 'projects' },
  de: { messageTo: 'Nachricht an {name}', following: 'Folge ich', follow: 'Folgen', pro: 'Pro', followersTitle: '{count, plural, one {# Follower} other {# Follower}}', followers: 'Follower', followingCount: 'folgt', projects: 'Projekte' },
  ar: { messageTo: 'مراسلة {name}', following: 'تتابعه', follow: 'متابعة', pro: 'احترافي', followersTitle: '{count, plural, zero {لا متابعين} one {متابع واحد} two {متابعان} few {# متابعين} many {# متابعًا} other {# متابع}}', followers: 'متابع', followingCount: 'يتابع', projects: 'مشاريع' },
})

/**
 * Profile card: gradient cover, avatar overlapping it, Message and Follow / Following (the compact
 * follower count rolls), a Pro badge, bio, stats and Posts / Projects / About tabs.
 */
export function ProfileCard({ name, bio, pro, followers, following, projects, tabs, defaultFollowing = false, onFollowChange, onMessage, className }:
  { name: string; bio?: ReactNode; pro?: boolean; followers: number; following: number; projects: number; tabs?: TabItem[]
    defaultFollowing?: boolean; onFollowChange?: (following: boolean) => void; onMessage?: () => void; className?: string }) {
  const [on, setOn] = useState(defaultFollowing)
  const count = followers + (on && !defaultFollowing ? 1 : !on && defaultFollowing ? -1 : 0)
  const toggle = () => { setOn(!on); onFollowChange?.(!on) }
  const tm = useMessages(PROFILE_MSG), { fmt } = useLocale()
  return (
    <div className={cn(surface.card, 'overflow-hidden', className)}>
      <div className="h-[110px] bg-[linear-gradient(120deg,color-mix(in_srgb,var(--accent)_80%,#000),var(--c4)_60%,var(--c3))]" />
      <div className="px-4 pb-4">
        <div className="-mt-9 flex items-end justify-between">
          <Avatar name={name} size={76} className="!border-4" />
          <div className="flex gap-2">
            <IconButton icon="message" label={tm('messageTo', { name })} variant="default" size="sm" className={cn('!w-[30px] !px-0 [@media(pointer:coarse)]:!w-10', TOUCH.row)} onClick={onMessage} />
            <motion.span key={String(on)} initial={{ scale: 0.92 }} animate={{ scale: 1 }} transition={spring(0.5, 0.35)} className="inline-flex">
              <Button size="sm" variant={on ? 'default' : 'primary'} aria-pressed={on} onClick={toggle} className={cn('min-w-[96px] [@media(pointer:coarse)]:px-4', TOUCH.row)}>

                {on ? <><Icon name="check" size={13} strokeWidth={2.6} />{tm('following')}</> : tm('follow')}
              </Button>
            </motion.span>
          </div>
        </div>
        <div className="mt-2">
          <div className="flex items-center gap-2"><b className="text-base">{name}</b>{pro && <Badge tone="accent">{tm('pro')}</Badge>}</div>
          {bio && <p className="m-0 mt-1 text-[13px] text-[var(--fg2)]">{bio}</p>}
        </div>
        <div className="mt-3 mb-1 flex flex-wrap gap-5 text-[13px] text-[var(--fg2)]">
          <span className="flex items-baseline gap-1" title={tm('followersTitle', { count })}><AnimatedNumber value={count} format={{ notation: 'compact', maximumFractionDigits: 1 }} className="font-[family-name:var(--font)] text-sm font-semibold tabular-nums text-[var(--fg)]" />{tm('followers')}</span>
          <span className="flex items-baseline gap-1"><b className="text-sm tabular-nums text-[var(--fg)]">{fmt.number(following)}</b>{tm('followingCount')}</span>
          <span className="flex items-baseline gap-1"><b className="text-sm tabular-nums text-[var(--fg)]">{fmt.number(projects)}</b>{tm('projects')}</span>

        </div>
        {tabs && <Tabs items={tabs} className="mt-2.5 [&_[role=tabpanel]]:min-h-[90px] [&_[role=tabpanel]]:text-[var(--fg2)]" />}
      </div>
    </div>
  )
}
