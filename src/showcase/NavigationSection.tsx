import { useRef, useState } from 'react'
import { AnimatePresence, motion, useInView } from 'motion/react'
import { Badge, Breadcrumbs, Button, CollapsibleSidebar, ContextMenu, type ContextMenuEntry, Icon, type IconName, MegaMenu, type MegaMenuItem, MobileTabBar, Pagination, PhoneFrame,
  type SidebarEntry, type TabBarItem, Tabs, Wizard, cn, spring, useToast } from '../lib'
import { Section, Spec } from './kit'

const NAV_SIDEBAR: SidebarEntry[] = [
  { value: 'home', label: 'Home', icon: 'home' }, { value: 'inbox', label: 'Inbox', icon: 'inbox', count: 4 }, { value: 'projects', label: 'Projects', icon: 'folder' },
  { value: 'analytics', label: 'Analytics', icon: 'chart' }, { heading: 'Workspace' }, { value: 'team', label: 'Team', icon: 'users' }, { value: 'settings', label: 'Settings', icon: 'settings' },
]

/* Mobile tab bar demo content (from the original page) */
const NAV_PHONE: Record<string, [string, [string, string, string][]]> = {
  home: ['Good morning', [['Daily summary', '3 new insights', 'bg-[var(--accent)]'], ['Team standup', 'In 20 minutes', 'bg-[var(--c4)]'], ['Pricing v2', 'Review requested', 'bg-[var(--c3)]'], ['Weekly report', 'Ready to share', 'bg-[var(--fg3)]']]],
  search: ['Search', [['Recent: pricing', '12 results', 'bg-[var(--fg3)]'], ['Recent: roadmap', '4 results', 'bg-[var(--fg3)]']]],
  inbox: ['Inbox', [['Bea Kim', 'Can you review the deck?', 'bg-[var(--c2)]'], ['Chris Moe', 'Shipped the auth fix', 'bg-[var(--ok)]'], ['Dana Ng', 'Lunch on Friday?', 'bg-[var(--warn)]']]],
  profile: ['Alex Lee', [['Settings', 'Account, privacy', 'bg-[var(--fg3)]'], ['Billing', 'Pro plan', 'bg-[var(--accent)]']]],
}
const NAV_PHONE_ORDER = ['home', 'search', 'inbox', 'profile']

function NavPhoneDemo() {
  const toast = useToast()
  const [tab, setTab] = useState('home')
  const [dir, setDir] = useState(1)
  const [inbox, setInbox] = useState(3)
  const items: TabBarItem[] = [
    { value: 'home', label: 'Home', icon: 'home' }, { value: 'search', label: 'Search', icon: 'search' },
    { value: 'inbox', label: 'Inbox', icon: 'inbox', count: inbox }, { value: 'profile', label: 'Profile', icon: 'user' },
  ]
  const pick = (v: string) => {
    setDir(Math.sign(NAV_PHONE_ORDER.indexOf(v) - NAV_PHONE_ORDER.indexOf(tab)) || 1); setTab(v)
    if (v === 'inbox') setInbox(0)
  }
  const [title, rows] = NAV_PHONE[tab]
  return (
    <PhoneFrame className="self-center">
      <div className="absolute inset-x-0 top-0 bottom-16 overflow-hidden">
        <AnimatePresence initial={false} custom={dir} mode="popLayout">
          <motion.div key={tab} custom={dir} className="absolute inset-0 px-4 pt-7 pb-2.5"
            variants={{ enter: (d: number) => ({ opacity: 0, x: 24 * d }), center: { opacity: 1, x: 0 }, exit: (d: number) => ({ opacity: 0, x: -24 * d }) }}
            initial="enter" animate="center" exit="exit" transition={spring(0.2, 0.35)}>
            <h4 className="m-0 mb-3 text-[22px] font-bold tracking-tight">{title}</h4>
            {rows.map(([t, d, c]) => (
              <div key={t} className="flex items-center gap-2.5 border-b border-[var(--line)] py-2.5 text-[13px]">
                <i className={cn('h-[34px] w-[34px] flex-none rounded-[var(--r-md)] opacity-85', c)} />
                <div className="min-w-0"><b className="block truncate font-medium">{t}</b><span className="block truncate text-[11px] text-[var(--fg3)]">{d}</span></div>
              </div>
            ))}
          </motion.div>
        </AnimatePresence>
      </div>
      <MobileTabBar className="absolute inset-x-0 bottom-0" items={items} value={tab} onChange={pick}
        onAction={() => toast({ title: 'New post', description: 'Composer would open here', tone: 'info' })} />
    </PhoneFrame>
  )
}

/* Mega menu: three panel layouts */
const NAV_TILE: Record<string, string> = {
  accent: 'bg-[var(--accent-soft)] text-[var(--accent)]', c3: 'bg-[color-mix(in_srgb,var(--c3)_14%,var(--card))] text-[var(--c3)]',
  c4: 'bg-[color-mix(in_srgb,var(--c4)_14%,var(--card))] text-[var(--c4)]', bad: 'bg-[var(--bad-soft)] text-[var(--bad)]',
  fg2: 'bg-[var(--muted)] text-[var(--fg2)]', warn: 'bg-[var(--warn-soft)] text-[var(--warn)]',
}
function NavMegaTile({ title, desc, icon, tone }: { title: string; desc: string; icon: IconName; tone: string }) {
  return (
    <a href="#navigation" className="flex gap-3 rounded-[var(--r-md)] p-2.5 text-[var(--fg)] no-underline hover:bg-[var(--muted)] focus-visible:bg-[var(--muted)] focus-visible:outline-none">
      <i className={cn('grid h-[34px] w-[34px] flex-none place-items-center rounded-[var(--r-md)]', NAV_TILE[tone])}><Icon name={icon} size={16} /></i>
      <div><b className="block text-[13px] font-semibold">{title}</b><span className="text-xs leading-snug text-[var(--fg3)]">{desc}</span></div>
    </a>
  )
}
const navMegaHead = 'm-0 mb-2 text-[11px] font-semibold tracking-wider text-[var(--fg3)] uppercase'
const navMegaLink = 'block py-1 text-[13px] text-[var(--fg2)] no-underline hover:text-[var(--fg)] focus-visible:text-[var(--fg)]'
const NAV_MEGA: MegaMenuItem[] = [
  { label: 'Products', content: (
    <div className="flex flex-wrap gap-4">
      <div className="grid w-[480px] max-w-full grid-cols-1 gap-1 sm:grid-cols-2">
        {([['Analytics', 'Dashboards that update live', 'chart', 'accent'], ['Automations', 'Workflows without code', 'bolt', 'c3'], ['Payments', 'Checkout and billing', 'card', 'c4'],
          ['Security', 'SSO, audit logs, roles', 'shield', 'bad'], ['Docs', 'Write and share pages', 'file', 'fg2'], ['Global edge', 'Fast everywhere', 'globe', 'warn']] as const)
          .map(([t, d, ic, tone]) => <NavMegaTile key={t} title={t} desc={d} icon={ic} tone={tone} />)}
      </div>
      <a href="#navigation" className="flex min-h-[180px] w-[200px] max-w-full flex-col justify-end rounded-[var(--r-md)] bg-[linear-gradient(140deg,color-mix(in_srgb,var(--accent)_85%,#000),var(--c4))] p-3 text-white no-underline">
        <b className="text-base">New: Flows 2.0</b><span className="text-xs opacity-85">Branching, retries and live traces.</span>
      </a>
    </div>
  ) },
  { label: 'Solutions', content: (
    <div className="grid grid-cols-[repeat(3,minmax(0,150px))] gap-4">
      {([['By team', ['Engineering', 'Design', 'Product', 'Finance']], ['By size', ['Startups', 'Scale-ups', 'Enterprise']], ['By industry', ['Fintech', 'Healthcare', 'Retail', 'Media']]] as const).map(([h, l]) => (
        <div key={h}><h5 className={navMegaHead}>{h}</h5>{l.map(x => <a key={x} href="#navigation" className={navMegaLink}>{x}</a>)}</div>
      ))}
    </div>
  ) },
  { label: 'Resources', content: (
    <div className="flex flex-wrap gap-4">
      <div className="flex w-[300px] max-w-full flex-col gap-1">
        {([['Guides', 'Step-by-step tutorials', 'book', 'accent'], ['Changelog', 'What shipped this week', 'bolt', 'c4'], ['Community', 'Ask and share', 'users', 'c3']] as const)
          .map(([t, d, ic, tone]) => <NavMegaTile key={t} title={t} desc={d} icon={ic} tone={tone} />)}
      </div>
      <div className="w-[200px] max-w-full"><h5 className={cn(navMegaHead, 'mt-1.5')}>Latest posts</h5>
        {['Designing calm dashboards', 'How we cut p95 by 40%', 'A guide to motion'].map(t => <a key={t} href="#navigation" className={cn(navMegaLink, 'py-1.5')}>{t}</a>)}
      </div>
    </div>
  ) },
  { label: 'Pricing', href: '#pages' },
]

/** The mega menu opens its first panel once it scrolls into view, so the card shows the menu, not an empty header. */
function NavMegaDemo() {
  const ref = useRef<HTMLDivElement>(null), seen = useInView(ref, { once: true, amount: 0.6 })
  return (
    <div ref={ref}>
      <MegaMenu items={NAV_MEGA} open={seen ? 0 : null}
        brand={<><span className="h-[22px] w-[22px] rounded-[var(--r-sm)] bg-[linear-gradient(135deg,var(--accent),var(--c4))]" />Northwind</>}
        actions={<><Button size="sm">Sign in</Button><Button size="sm" variant="primary">Get started</Button></>}>
        <div className="flex h-full flex-col items-start justify-end gap-2 p-5">
          <Badge tone="accent" size="sm">Flows 2.0 is live</Badge>
          <b className="max-w-[420px] text-[22px] leading-tight font-bold tracking-tight text-balance">Build faster with one UI kit</b>
          <span className="max-w-[420px] text-[13px] text-[var(--fg2)]">Components, charts and agent views that share one set of tokens.</span>
        </div>
      </MegaMenu>
    </div>
  )
}

/* Context menu */
function NavContextDemo() {
  const toast = useToast()
  const [out, setOut] = useState('')
  const [trashed, setTrashed] = useState(false)
  const chose = (n: string) => () => setOut(`Chose: ${n}`)
  const items: ContextMenuEntry[] = [
    { label: 'Open', icon: 'file', shortcut: '↵', onSelect: chose('Open') }, { label: 'Rename', icon: 'edit', shortcut: '⌘R', onSelect: chose('Rename') },
    { label: 'Duplicate', icon: 'copy', shortcut: '⌘D', onSelect: chose('Duplicate') },
    { label: 'Share', icon: 'share', items: [{ label: 'Copy link', icon: 'link', shortcut: '⌘L', onSelect: chose('Copy link') }, { label: 'Email', icon: 'send', onSelect: chose('Email') }, { label: 'Team chat', icon: 'users', onSelect: chose('Team chat') }] },
    '-',
    { label: 'Move to trash', icon: 'trash', shortcut: '⌫', danger: true, onSelect: () => {
      setOut('Chose: Move to trash'); setTrashed(true)
      toast({ title: 'Moved to trash', description: 'Q4-roadmap.pdf', action: { label: 'Undo', onClick: () => { setTrashed(false); setOut('Restored Q4-roadmap.pdf'); toast({ title: 'Restored', description: 'Q4-roadmap.pdf', tone: 'info' }) } } })
    } },
  ]
  return (
    <>
      <ContextMenu items={items} label="File options" className="grid h-[190px] place-items-center rounded-[var(--r-lg)] border-[1.5px] border-dashed border-[var(--line2)] focus-visible:border-[var(--accent)]">
        {open => (
          <div className="flex flex-col items-center gap-1.5">
            <motion.div animate={{ opacity: trashed ? 0.35 : 1, scale: trashed ? 0.95 : 1 }} transition={spring(0.2, 0.3)}
              className={cn('flex flex-col items-center gap-1.5 rounded-[var(--r-md)] px-4 py-3 transition-colors', open && 'bg-[var(--accent-soft)]')}>
              <Icon name="file" size={34} strokeWidth={1.4} className="text-[var(--accent)]" />
              <b className="text-[13px] font-medium">Q4-roadmap.pdf</b>
              <span className="text-xs text-[var(--fg3)]">{trashed ? 'In trash' : '2.4 MB · Edited today'}</span>
            </motion.div>
            <span className="px-3 text-center text-xs text-[var(--fg3)] [@media(hover:none)]:hidden">Right-click, long-press, or focus and press Shift+F10</span>
            <span className="hidden px-3 text-center text-xs text-[var(--fg3)] [@media(hover:none)]:inline">Press and hold the file for its menu</span>
          </div>
        )}
      </ContextMenu>
      <div className="min-h-[18px] text-xs text-[var(--fg3)]" aria-live="polite">{out}</div>
    </>
  )
}

export function NavigationSection() {
  const [page, setPage] = useState(5)
  return (
    <Section id="navigation" title="Navigation" desc="Indicators that travel to where you clicked so you never lose your place.">
      <Spec title="Tabs" desc="Underline travels, panel cross-fades">
        <Tabs items={[{ value: 'o', label: 'Overview', content: '12 projects, 4 active this week.' }, { value: 'a', label: 'Activity', content: 'Sam commented on “Homepage hero” 3 min ago.' }, { value: 's', label: 'Settings', content: 'Notifications on. Weekly digest off.' }]} />
      </Spec>
      <Spec title="Wizard stepper" desc="Progress line fills between steps">
        <Wizard steps={[{ label: 'Account', description: 'Create your account.' }, { label: 'Details', description: 'Tell us about your team.' }, { label: 'Done', description: 'All set. Welcome aboard.' }]} />
      </Spec>
      <Spec title="Breadcrumbs and pagination" desc="Depth and long lists">
        <Breadcrumbs items={[{ label: 'Home', href: '#navigation' }, { label: 'Projects', href: '#navigation' }, { label: 'Website redesign' }]} />
        <Pagination page={page} total={20} onChange={setPage} />
      </Spec>
      <Spec title="Collapsible sidebar" desc="App navigation that folds to icons. Labels become tooltips when collapsed." span={2} keys={[[["["], "Toggle"]]}>
        <CollapsibleSidebar items={NAV_SIDEBAR} user={{ name: 'Alex Lee', detail: 'Pro plan' }} />
      </Spec>
      <Spec title="Mobile tab bar" desc="Sliding indicator, centre action, badge">
        <NavPhoneDemo />
      </Spec>
      <Spec title="Mega menu" desc="Hover, tap or focus a top item. The panel morphs between menus instead of closing and reopening." span={3}
        keys={[[['←', '→'], 'Top items'], [['↓'], 'Into the panel'], [['Esc'], 'Close']]}>
        <NavMegaDemo />
      </Spec>
      <Spec title="Context menu" desc="Right-click, or long-press on touch. Submenus, shortcuts, keyboard." keys={[[['⇧', 'F10'], 'Open menu'], [['↑', '↓'], 'Move'], [['→'], 'Submenu']]}>
        <NavContextDemo />
      </Spec>
    </Section>
  )
}
