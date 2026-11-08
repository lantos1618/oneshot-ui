import { useEffect, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { Avatar, Badge, Banner, Button, CopyButton, DateRangePicker, Dialog, DropdownMenu, Field, HoldToConfirm, HoverCard, Icon, InlineEdit, Input, Kbd, MenuItem, MenuSeparator,
  type Notification, NotificationBell, Popover, PopoverContent, PopoverTrigger, Select, Sheet, Switch, Tooltip, Tour, type TourStep, useToast } from '../lib'
import { Row, Section, Spec } from './kit'

const OV_TOUR: TourStep[] = [
  { target: 'title', title: 'Your projects', body: 'Everything you’re working on lives here.' },
  { target: 'new', title: 'Create in one click', body: 'Start a new project from any page.' },
  { target: 'search', title: 'Find anything', body: 'Search across projects, files and people.' },
]
function OvTourDemo() {
  const [step, setStep] = useState(-1)
  return (
    <Tour steps={OV_TOUR} step={step} onStepChange={setStep} className="flex flex-col gap-3">
      <div className="flex flex-col gap-3 rounded-[10px] border border-[var(--line)] bg-[var(--bg)] p-3">
        <Row className="justify-between">
          <b data-tour="title" className="px-1 py-0.5 text-sm font-semibold">Projects</b>
          <Button data-tour="new" size="sm" variant="primary" tabIndex={step >= 0 ? -1 : 0}>New project</Button>
        </Row>
        <div data-tour="search" className="flex h-[34px] items-center gap-2 rounded-[var(--r-md)] border border-[var(--line)] bg-[var(--card)] px-2.5 text-[13px] text-[var(--fg3)]">
          <Icon name="search" size={13} />Search projects…
        </div>
        <div className="flex flex-col">
          {([['Website redesign', '2 h ago', 'bg-[var(--c2)]'], ['Mobile app', 'Yesterday', 'bg-[var(--c3)]'], ['Brand refresh', '3 days ago', 'bg-[var(--c4)]']] as const).map(([n, t, c], i) => (
            <div key={n} className={`flex items-center gap-2.5 px-1 py-2 text-[13px] ${i ? 'border-t border-[var(--line)]' : ''}`}>
              <span className={`h-2 w-2 flex-none rounded-[3px] ${c}`} />{n}<span className="ml-auto text-xs text-[var(--fg3)]">{t}</span>
            </div>
          ))}
        </div>
      </div>
      <Row className="justify-between"><span className="text-xs text-[var(--fg3)]">3 steps · about 20 seconds</span><Button size="sm" onClick={() => setStep(0)}>Start tour</Button></Row>
    </Tour>
  )
}

const OV_POOL: [string, string, string][] = [['Eli Park', 'mentioned you in', 'Launch plan'], ['Alex Lee', 'approved', 'Brand refresh'], ['Bea Kim', 'replied to', 'Copy review']]
const ovNote = (id: string, who: string, what: string, obj: string, time: string): Notification =>
  ({ id, title: <><b className="font-medium">{who}</b> {what} <b className="font-medium">{obj}</b></>, time })
function OvNotificationDemo() {
  const [items, setItems] = useState<Notification[]>(() => [
    ovNote('n1', 'Bea Kim', 'commented on', 'Homepage hero', '2m ago'), ovNote('n2', 'Chris Moe', 'assigned you', 'Pricing page', '1h ago'), ovNote('n3', 'Dana Ng', 'shared', 'Q4 research', '3h ago'),
  ])
  const add = () => {
    const [who, what, obj] = OV_POOL[Math.floor(Math.random() * OV_POOL.length)]
    setItems(list => [ovNote(`n${Date.now()}`, who, what, obj, 'now'), ...list].slice(0, 5))
  }
  return (
    <>
      <Row><NotificationBell items={items} onChange={setItems} max={5} /></Row>
      <Button size="sm" className="self-start" onClick={add}>Simulate new</Button>
    </>
  )
}

function OvBannerDemo() {
  const [open, setOpen] = useState(true)
  return (
    <>
      <Banner open={open} onOpenChange={setOpen}>Dark mode is here. Try it from settings.</Banner>
      <AnimatePresence>
        {!open && <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.2, delay: 0.15 }}>
          <Button size="sm" onClick={() => setOpen(true)}>Show banner again</Button>
        </motion.div>}
      </AnimatePresence>
    </>
  )
}

/** Window event the page shell sends (⌘K "Open modal" / "Open drawer") to open this section's demo dialog or sheet. */
export const OVERLAY_DEMO_EVENT = 'showcase:overlay-demo'
export type OverlayDemo = 'modal' | 'sheet'

export function OverlaysSection({ openPalette }: { openPalette: () => void }) {
  const toast = useToast()
  const [modal, setModal] = useState(false)
  const [sheet, setSheet] = useState(false)
  const [deleted, setDeleted] = useState<'no' | 'yes' | 'restored'>('no')
  const [picked, setPicked] = useState('')
  const [title, setTitle] = useState('Q4 planning notes')
  const pick = (n: string) => () => setPicked(`Selected: ${n}`)
  useEffect(() => {
    const on = (e: Event) => { const d = (e as CustomEvent<OverlayDemo>).detail; if (d === 'modal') setModal(true); else if (d === 'sheet') setSheet(true) }
    addEventListener(OVERLAY_DEMO_EVENT, on); return () => removeEventListener(OVERLAY_DEMO_EVENT, on)
  }, [])
  return (
    <Section id="overlays" title="Overlays" desc="Things that open should feel like they come from somewhere.">
      <Spec title="Dropdown menu" desc="Scales from its trigger. Items stagger in; the first takes focus.">
        <Row><DropdownMenu trigger={<>Options <Icon name="chevronDown" size={14} /></>}>
          <MenuItem shortcut="E" onSelect={pick('Edit')}>Edit</MenuItem><MenuItem shortcut="D" onSelect={pick('Duplicate')}>Duplicate</MenuItem>
          <MenuItem onSelect={pick('Share')}>Share</MenuItem><MenuSeparator /><MenuItem danger onSelect={pick('Delete')}>Delete</MenuItem>
        </DropdownMenu></Row>
        <span className="min-h-4 text-xs text-[var(--fg3)]" aria-live="polite">{picked}</span>
      </Spec>
      <Spec title="Modal" desc="Springs in, backdrop fades, focus trapped, page scroll locked">
        <Row><Button variant="outline-danger" onClick={() => setModal(true)}>Delete project</Button></Row>
        <span className="min-h-4 text-xs text-[var(--fg3)]" aria-live="polite">{deleted === 'yes' ? 'Project deleted.' : deleted === 'restored' ? 'Restored.' : ''}</span>
        <Dialog open={modal} onOpenChange={setModal} title="Delete “Website redesign”?" description="This removes 24 files and 3 automations. You can restore it from trash for 30 days."
          footer={<><Button onClick={() => setModal(false)}>Cancel</Button><Button variant="danger" onClick={() => {
            setModal(false); setDeleted('yes')
            toast({ title: 'Project deleted', description: 'Website redesign', action: { label: 'Undo', onClick: () => { setDeleted('restored'); toast({ title: 'Restored', description: 'Website redesign', tone: 'info' }) } } })
          }}>Delete</Button></>} />
      </Spec>
      <Spec title="Sheet / drawer" desc="Slides from the edge">
        <Row><Button onClick={() => setSheet(true)}>Open filters</Button></Row>
        <Sheet open={sheet} onOpenChange={setSheet} title="Filters" footer={<><Button onClick={() => setSheet(false)}>Reset</Button><Button variant="primary" onClick={() => { setSheet(false); toast({ title: 'Filters applied' }) }}>Apply</Button></>}>
          <div className="flex flex-col gap-4">
            <Field label="Status"><Select options={[{ value: 'any', label: 'Any' }, { value: 'paid', label: 'Paid' }, { value: 'due', label: 'Overdue' }]} defaultValue="any" /></Field>
            <Field label="Date range"><DateRangePicker /></Field>
            <Switch label="Only mine" />
          </div>
        </Sheet>
      </Spec>
      <Spec title="Tooltip" desc="Short delay, quick fade. Tap on touch">
        <Row>
          <Tooltip content={<>Bold <Kbd className="!border-current !bg-transparent !text-inherit">⌘B</Kbd></>}><Button size="icon" aria-label="Bold"><b>B</b></Button></Tooltip>
          <Tooltip content="Italic"><Button size="icon" aria-label="Italic"><i>I</i></Button></Tooltip>
          <Tooltip content="Insert link"><Button size="icon" aria-label="Link"><Icon name="link" /></Button></Tooltip>
        </Row>
      </Spec>
      <Spec title="Command palette" desc="Keyboard access to everything. Every word must match; tags show why.">
        <Row><Button onClick={openPalette}>Open palette</Button><span className="text-xs text-[var(--fg3)] [@media(hover:none)]:hidden">or press <Kbd>⌘K</Kbd> / <Kbd>Ctrl K</Kbd></span><span className="hidden text-xs text-[var(--fg3)] [@media(hover:none)]:inline">or tap the search icon in the header</span></Row>
      </Spec>
      <Spec title="Popover" desc="Rich content, not just a menu">
        <Row><Popover><PopoverTrigger>Share</PopoverTrigger>
          <PopoverContent className="w-[min(280px,calc(100vw-16px))] p-3">
            <b className="text-[13px]">Share this page</b><div className="mt-0.5 mb-2.5 text-xs text-[var(--fg3)]">Anyone with the link can view</div>
            <Row className="flex-nowrap"><Input readOnly value="example.com/p/x7k2" className="!h-8 min-w-0 font-[family-name:var(--mono)] !text-xs [@media(pointer:coarse)]:!h-9 [@media(pointer:coarse)]:!text-base" /><CopyButton text="example.com/p/x7k2" size="sm" /></Row>
            <div className="mt-3"><Switch label="Allow comments" defaultChecked /></div>
          </PopoverContent></Popover></Row>
      </Spec>
      <Spec title="Hover card" desc="Profile preview on hover or focus; tap on touch">
        <div className="text-[13px] leading-loose">Assigned to <HoverCard trigger={<a href="#overlays" onClick={e => e.preventDefault()} className="font-medium text-[var(--accent)] no-underline [@media(pointer:coarse)]:py-2">@alexlee</a>}>
          <div className="flex items-center gap-2.5"><Avatar name="Alex Lee" size={40} status="online" /><div className="flex-1"><b className="block">Alex Lee</b><span className="text-xs text-[var(--fg3)]">Design lead · Zürich</span></div><Badge tone="ok" dot>Online</Badge></div>
          <p className="my-2.5 text-xs text-[var(--fg2)]">Working on the onboarding redesign.</p>
          <div className="mb-2.5 flex gap-4 text-xs text-[var(--fg3)]"><span><b className="text-[var(--fg)]">128</b> commits</span><span><b className="text-[var(--fg)]">24</b> reviews</span><span><b className="text-[var(--fg)]">6</b> projects</span></div>
          <Button size="sm" className="w-full">Message</Button>
        </HoverCard> for review.</div>
      </Spec>
      <Spec title="Hold to confirm" desc="Press and hold for destructive actions">
        <HoldToConfirm onConfirm={() => toast({ title: 'Workspace deleted', tone: 'bad' })} status={{ done: 'Workspace deleted' }} />
      </Spec>
      <Spec title="Onboarding tour" desc="Spotlight steps through the UI, with a tooltip anchored to each target"><OvTourDemo /></Spec>
      <Spec title="Notification centre" desc="Unread count, mark all read. The bell shakes when something new arrives."><OvNotificationDemo /></Spec>
      <Spec title="Announcement banner" desc="Dismiss collapses smoothly"><OvBannerDemo /></Spec>
      <Spec title="Inline edit" desc="Click to edit, Enter saves, Esc cancels">
        <InlineEdit value={title} onSave={setTitle} label="title" helper="Last edited 2 h ago" className="text-[17px]" />
      </Spec>
    </Section>
  )
}
