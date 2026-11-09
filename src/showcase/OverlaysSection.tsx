import { useEffect, useMemo, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { AlertDialog, Avatar, Badge, Banner, Button, type Command, CommandPalette, CopyButton, DateRangePicker, Dialog, DropdownMenu, Field, HoldToConfirm, HoverCard, Icon, IconButton, InlineEdit, Input, Kbd, MenuItem, MenuSeparator,
  type Notification, NotificationBell, Popover, PopoverContent, PopoverTrigger, Select, Sheet, Switch, Tooltip, Tour, type TourStep, cn, floatingSurface, menuItemClass, useToast } from '../lib'
import { Row, Section, Spec, SpecPreview } from './kit'

const OV_TOUR: TourStep[] = [
  { target: 'title', title: 'Your projects', body: 'Everything you’re working on lives here.' },
  { target: 'new', title: 'Create in one click', body: 'Start a new project from any page.' },
  { target: 'search', title: 'Find anything', body: 'Search across projects, files and people.' },
]
function OvTourDemo() {
  const [step, setStep] = useState(-1)
  return (
    <Tour steps={OV_TOUR} step={step} onStepChange={setStep} className="flex flex-col gap-3">
      <div className="flex flex-col gap-3 rounded-[var(--r-lg)] border border-[var(--line)] bg-[var(--bg)] p-3">
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
              <span className={`h-2 w-2 flex-none rounded-[var(--r-sm)] ${c}`} />{n}<span className="ms-auto text-xs text-[var(--fg3)]">{t}</span>
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

const OV_MENU: [string, string?][] = [['Edit', 'E'], ['Duplicate', 'D'], ['Share']]
const ovPreviewMenu = (
  <div className={cn(floatingSurface, 'w-44 p-1')}>
    {OV_MENU.map(([t, k], i) => <div key={t} className={cn(menuItemClass, '!cursor-default !py-1.5', i === 0 && 'bg-[var(--muted)]')}>{t}{k && <Kbd>{k}</Kbd>}</div>)}
    <div className="my-1 h-px bg-[var(--line)]" />
    <div className={cn(menuItemClass, '!cursor-default !py-1.5 text-[var(--bad)]')}>Delete</div>
  </div>
)
const ovPreviewProfile = (
  <div className={cn(floatingSurface, 'w-full max-w-[280px] p-3')}>
    <div className="flex items-center gap-2.5"><Avatar name="Alex Lee" size={36} status="online" /><div className="min-w-0 flex-1"><b className="block text-[13px]">Alex Lee</b><span className="text-xs text-[var(--fg3)]">Design lead · Zürich</span></div><Badge tone="ok" dot size="sm">Online</Badge></div>
    <div className="mt-2.5 flex gap-4 text-xs text-[var(--fg3)]"><span><b className="text-[var(--fg)]">128</b> commits</span><span><b className="text-[var(--fg)]">24</b> reviews</span></div>
  </div>
)

/* Alert dialog: async confirm that can fail */
function OvAlertDemo() {
  const toast = useToast()
  const [open, setOpen] = useState(false)
  const [fail, setFail] = useState(true)
  const [revoked, setRevoked] = useState(false)
  const revoke = () => new Promise<void>((resolve, reject) => setTimeout(() => {
    if (fail) { setFail(false); reject(new Error('Couldn’t reach the API, so nothing was revoked. Try again.')) }
    else { setRevoked(true); toast({ title: 'API key revoked', description: 'sk_live_…4f2a', tone: 'bad' }); resolve() }
  }, 1100))
  return (
    <>
      <Row>
        <Button variant="outline-danger" onClick={() => { if (revoked) { setRevoked(false); setFail(true) } setOpen(true) }}>Revoke API key</Button>
        <span className="text-xs text-[var(--fg3)]" aria-live="polite">{revoked ? 'Revoked. Open it again to replay.' : ''}</span>
      </Row>
      <span className="text-xs text-[var(--fg3)]">The first attempt fails on purpose, to show the error; the second succeeds.</span>
      <AlertDialog open={open} onOpenChange={setOpen} title="Revoke the production API key?" confirmLabel="Revoke key" onConfirm={revoke}
        description={<>Apps using <code className="font-[family-name:var(--mono)] text-[var(--fg)]">sk_live_…4f2a</code> stop working immediately. This can’t be undone.</>} />
      <SpecPreview className="grid place-items-center bg-[color-mix(in_srgb,var(--fg)_14%,var(--bg))]">
        <div className={cn(floatingSurface, 'w-full max-w-[260px] p-3')}>
          <b className="block text-[13px]">Revoke the production API key?</b>
          <span className="mt-1 block text-xs leading-snug text-[var(--fg3)]">Apps using it stop working immediately.</span>
          <span className="mt-2 flex items-center gap-1 text-[11px] text-[var(--bad)]"><Icon name="alert" size={11} />Couldn’t reach the API.</span>
          <div className="mt-3 flex justify-end gap-1.5"><Button size="xs" tabIndex={-1}>Cancel</Button><Button size="xs" variant="danger" tabIndex={-1}>Revoke key</Button></div>
        </div>
      </SpecPreview>
    </>
  )
}

/* Command palette with groups, nested pages, async results and recents */
const OV_VERBS = ['Fix', 'Add', 'Remove', 'Refactor', 'Document', 'Speed up', 'Test', 'Polish', 'Migrate', 'Localise']
const OV_NOUNS = ['date picker', 'billing page', 'search index', 'login flow', 'CSV export', 'dark mode', 'onboarding tour', 'data grid', 'webhooks', 'chart tooltips', 'file upload', 'notifications', 'API keys', 'audit log', 'mobile nav', 'command palette']
const OV_ISSUES = Array.from({ length: 2400 }, (_, i) => ({ n: 1000 + i, title: `${OV_VERBS[i % 10]} ${OV_NOUNS[(i * 7) % 16]}`, team: ['Web', 'Platform', 'Design', 'Mobile'][i % 4] }))
const OV_PEOPLE = ['Alex Lee', 'Bea Kim', 'Chris Moe', 'Dana Ng', 'Eli Park', 'Fay Ito', 'Gus Roy', 'Hana Ali', 'Ivo Berg', 'Jo Marsh', 'Kai Sun', 'Lea Brun']
/** A fake search API: 250–400 ms, honours the abort signal. */
const ovDelay = <T,>(ms: number, signal: AbortSignal, value: () => T) => new Promise<T>((resolve, reject) => {
  const t = setTimeout(() => resolve(value()), ms)
  signal.addEventListener('abort', () => { clearTimeout(t); reject(new DOMException('Aborted', 'AbortError')) })
})
function OvPaletteDemo() {
  const [open, setOpen] = useState(false)
  const [last, setLast] = useState('')
  const did = (what: string) => () => setLast(what)
  const commands = useMemo<Command[]>(() => [
    { id: 'new-issue', label: 'New issue', group: 'Actions', icon: 'plus', shortcut: 'C', run: did('Created a new issue') },
    { id: 'assign', label: 'Assign to…', group: 'Actions', icon: 'user', placeholder: 'Search people…', loadChildren: (q, { signal }) => ovDelay(250, signal, () =>
      OV_PEOPLE.filter(p => p.toLowerCase().includes(q.toLowerCase().trim())).map(p => ({ id: `p:${p}`, label: p, group: 'People', run: did(`Assigned to ${p}`) }))) },
    { id: 'status', label: 'Change status…', group: 'Actions', icon: 'check', children: ['Backlog', 'Todo', 'In progress', 'In review', 'Done'].map(st => ({ id: `s:${st}`, label: st, group: 'Status', run: did(`Status set to ${st}`) })) },
    { id: 'labels', label: 'Add label…', group: 'Actions', icon: 'star', children: [
      { id: 'l-type', label: 'Type…', group: 'Labels', children: ['Bug', 'Feature', 'Chore'].map(l => ({ id: `lt:${l}`, label: l, run: did(`Labelled ${l}`) })) },
      { id: 'l-area', label: 'Area…', group: 'Labels', children: ['Web', 'Platform', 'Design', 'Mobile'].map(l => ({ id: `la:${l}`, label: l, run: did(`Labelled ${l}`) })) },
    ] },
    { id: 'inbox', label: 'Go to inbox', group: 'Navigation', icon: 'inbox', shortcut: 'G I', run: did('Opened the inbox') },
    { id: 'settings', label: 'Go to settings', group: 'Navigation', icon: 'settings', shortcut: 'G S', run: did('Opened settings') },
    { id: 'theme', label: 'Switch theme…', group: 'Preferences', icon: 'sun', children: ['Light', 'Dark', 'System'].map(t => ({ id: `t:${t}`, label: t, run: did(`Theme: ${t}`) })) },
  ], []) // eslint-disable-line react-hooks/exhaustive-deps
  const loadItems = (q: string, { signal }: { signal: AbortSignal }) => ovDelay(300 + q.length * 10, signal, () => {
    const w = q.toLowerCase().trim(); if (!w) return []
    return OV_ISSUES.filter(x => `${x.title} ${x.team} ${x.n}`.toLowerCase().includes(w)).slice(0, 400)
      .map((x): Command => ({ id: `i:${x.n}`, label: x.title, hint: `#${x.n} · ${x.team}`, group: 'Issues', icon: 'file', run: did(`Opened #${x.n} ${x.title}`) }))
  })
  return (
    <>
      <Row><Button onClick={() => setOpen(true)}>Open palette</Button><span className="text-xs text-[var(--fg3)]" aria-live="polite">{last}</span></Row>
      <span className="text-xs text-[var(--fg3)]">Try “Assign to…” (people load as you type), “Add label…” (two levels), or type “fix” for hundreds of issues from the fake API.</span>
      <CommandPalette open={open} onOpenChange={setOpen} commands={commands} loadItems={loadItems} recents={3} recentKey="showcase:palette-recents" placeholder="Search issues, people, actions…" suggestion="fix" />
    </>
  )
}

/* Dropdown menu built from parts: checkbox and radio items, a labelled group, a submenu, shortcuts, typeahead */
function OvViewMenu({ onPick }: { onPick: (what: string) => void }) {
  const [grid, setGrid] = useState(true)
  const [rulers, setRulers] = useState(false)
  const [density, setDensity] = useState('comfortable')
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger>View <Icon name="chevronDown" size={14} /></DropdownMenu.Trigger>
      <DropdownMenu.Content align="end" className="w-56" aria-label="View options">
        <DropdownMenu.Label>Show</DropdownMenu.Label>
        <DropdownMenu.CheckboxItem checked={grid} onCheckedChange={v => { setGrid(v); onPick(`Grid ${v ? 'on' : 'off'}`) }}>Grid<DropdownMenu.Shortcut>⌘'</DropdownMenu.Shortcut></DropdownMenu.CheckboxItem>
        <DropdownMenu.CheckboxItem checked={rulers} onCheckedChange={v => { setRulers(v); onPick(`Rulers ${v ? 'on' : 'off'}`) }}>Rulers<DropdownMenu.Shortcut>⇧R</DropdownMenu.Shortcut></DropdownMenu.CheckboxItem>
        <DropdownMenu.Separator />
        <DropdownMenu.Label>Density</DropdownMenu.Label>
        <DropdownMenu.RadioGroup value={density} onValueChange={v => { setDensity(v); onPick(`Density: ${v}`) }} aria-label="Density">
          <DropdownMenu.RadioItem value="compact">Compact</DropdownMenu.RadioItem>
          <DropdownMenu.RadioItem value="comfortable">Comfortable</DropdownMenu.RadioItem>
        </DropdownMenu.RadioGroup>
        <DropdownMenu.Separator />
        <DropdownMenu.Sub>
          <DropdownMenu.SubTrigger icon="upload">Export</DropdownMenu.SubTrigger>
          <DropdownMenu.SubContent>
            {['PNG', 'SVG', 'PDF'].map(f => <DropdownMenu.Item key={f} onSelect={() => onPick(`Exported as ${f}`)}>{f}</DropdownMenu.Item>)}
          </DropdownMenu.SubContent>
        </DropdownMenu.Sub>
        <DropdownMenu.Item icon="link" shortcut="L" onSelect={() => onPick('Copied link')}>Copy link</DropdownMenu.Item>
      </DropdownMenu.Content>
    </DropdownMenu.Root>
  )
}

/* The same overlays, written as parts */
function OvPartsDemo() {
  const toast = useToast()
  const [name, setName] = useState('Website redesign')
  const [draft, setDraft] = useState(name)
  const [archived, setArchived] = useState(false)
  return (
    <>
      <Row>
        <Dialog.Root onOpenChange={o => { if (o) setDraft(name) }}>
          <Dialog.Trigger>Rename</Dialog.Trigger>
          <Dialog.Content>
            <Dialog.Title>Rename project</Dialog.Title>
            <Dialog.Description>The name shows in the sidebar and in shared links.</Dialog.Description>
            <Field label="Name"><Input value={draft} onChange={e => setDraft(e.target.value)} /></Field>
            <Dialog.Footer>
              <Dialog.Close>Cancel</Dialog.Close>
              <Dialog.Close variant="primary" disabled={!draft.trim()} onClick={() => { setName(draft.trim()); toast({ title: 'Renamed', description: draft.trim() }) }}>Save</Dialog.Close>
            </Dialog.Footer>
          </Dialog.Content>
        </Dialog.Root>
        <Sheet.Root>
          <Sheet.Trigger>Details</Sheet.Trigger>
          <Sheet.Content side="start">
            <Sheet.Header><Sheet.Title>{name}</Sheet.Title><Sheet.Close /></Sheet.Header>
            <Sheet.Description>Created by Bea Kim · 24 files · 3 automations</Sheet.Description>
            <div className="flex flex-1 flex-col gap-3">
              <Switch label="Notify me about changes" defaultChecked />
              <Switch label="Show in the sidebar" defaultChecked />
            </div>
            <Sheet.Footer><Sheet.Close variant="primary">Done</Sheet.Close></Sheet.Footer>
          </Sheet.Content>
        </Sheet.Root>
        <AlertDialog.Root>
          <AlertDialog.Trigger variant="outline-danger" disabled={archived}>{archived ? 'Archived' : 'Archive'}</AlertDialog.Trigger>
          <AlertDialog.Content>
            <AlertDialog.Title>Archive “{name}”?</AlertDialog.Title>
            <AlertDialog.Description>It leaves the sidebar and stops syncing. You can restore it from Settings.</AlertDialog.Description>
            <AlertDialog.Footer>
              <AlertDialog.Cancel />
              <AlertDialog.Action tone="default" onConfirm={() => new Promise<void>(r => setTimeout(() => { setArchived(true); r() }, 700))}>Archive</AlertDialog.Action>
            </AlertDialog.Footer>
          </AlertDialog.Content>
        </AlertDialog.Root>
        <Popover.Root>
          <Tooltip.Root delay={300}>
            <Tooltip.Trigger asChild>
              <Popover.Trigger asChild><IconButton icon="info" label="Project info" size="icon" variant="default" /></Popover.Trigger>
            </Tooltip.Trigger>
            <Tooltip.Content side="bottom" arrow>Project info</Tooltip.Content>
          </Tooltip.Root>
          <Popover.Content side="top" align="center" sideOffset={10} arrow aria-label="Project info" className="w-[min(240px,calc(100vw-16px))] p-3">
            <b className="text-[13px]">{name}</b>
            <div className="mt-1 text-xs text-[var(--fg3)]">Owner <HoverCard.Root><HoverCard.Trigger asChild><a href="#overlays" onClick={e => e.preventDefault()} className="font-medium text-[var(--accent)] no-underline">@beakim</a></HoverCard.Trigger>
              <HoverCard.Content side="bottom" arrow className="!w-[200px]"><div className="flex items-center gap-2"><Avatar name="Bea Kim" size={28} /><div><b className="block text-[13px]">Bea Kim</b><span className="text-xs text-[var(--fg3)]">PM · Berlin</span></div></div></HoverCard.Content>
            </HoverCard.Root> · edited 2 h ago</div>
            <Popover.Close size="sm" className="mt-3 w-full">Got it</Popover.Close>
          </Popover.Content>
        </Popover.Root>
      </Row>
      <span className="text-xs text-[var(--fg3)]">Dialog, Sheet, AlertDialog, Popover, Tooltip and HoverCard as parts. The ⓘ button is one element that is both a tooltip and a popover trigger (two nested <code className="font-[family-name:var(--mono)]">asChild</code>s).</span>
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
      <Spec title="Dropdown menu" desc="Scales from its trigger. Items stagger in; the first takes focus. Type a letter to jump. “View” is built from parts: checkbox and radio items and a submenu.">
        <Row><DropdownMenu trigger={<>Options <Icon name="chevronDown" size={14} /></>}>
          <MenuItem shortcut="E" onSelect={pick('Edit')}>Edit</MenuItem><MenuItem shortcut="D" onSelect={pick('Duplicate')}>Duplicate</MenuItem>
          <MenuItem onSelect={pick('Share')}>Share</MenuItem><MenuSeparator /><MenuItem danger onSelect={pick('Delete')}>Delete</MenuItem>
        </DropdownMenu><OvViewMenu onPick={what => setPicked(what)} /><span className="text-xs text-[var(--fg3)]" aria-live="polite">{picked}</span></Row>
        <SpecPreview>{ovPreviewMenu}</SpecPreview>
      </Spec>
      <Spec title="Modal" desc="Springs in, backdrop fades, focus trapped, page scroll locked">
        <Row><Button variant="outline-danger" onClick={() => setModal(true)}>Delete project</Button>
          <span className="text-xs text-[var(--fg3)]" aria-live="polite">{deleted === 'yes' ? 'Project deleted.' : deleted === 'restored' ? 'Restored.' : ''}</span></Row>
        <Dialog open={modal} onOpenChange={setModal} title="Delete “Website redesign”?" description="This removes 24 files and 3 automations. You can restore it from trash for 30 days."
          footer={<><Button onClick={() => setModal(false)}>Cancel</Button><Button variant="danger" onClick={() => {
            setModal(false); setDeleted('yes')
            toast({ title: 'Project deleted', description: 'Website redesign', action: { label: 'Undo', onClick: () => { setDeleted('restored'); toast({ title: 'Restored', description: 'Website redesign', tone: 'info' }) } } })
          }}>Delete</Button></>} />
        <SpecPreview className="grid place-items-center bg-[color-mix(in_srgb,var(--fg)_14%,var(--bg))]">
          <div className={cn(floatingSurface, 'w-full max-w-[260px] p-3')}>
            <b className="block text-[13px]">Delete “Website redesign”?</b>
            <span className="mt-1 block text-xs leading-snug text-[var(--fg3)]">Removes 24 files and 3 automations. Restore from trash for 30 days.</span>
            <div className="mt-3 flex justify-end gap-1.5"><Button size="xs" tabIndex={-1}>Cancel</Button><Button size="xs" variant="danger" tabIndex={-1}>Delete</Button></div>
          </div>
        </SpecPreview>
      </Spec>
      <Spec title="Sheet / drawer" desc="Slides from the edge; a bottom sheet on phones">
        <Row><Button onClick={() => setSheet(true)}>Open filters</Button></Row>
        <Sheet open={sheet} onOpenChange={setSheet} title="Filters" footer={<><Button onClick={() => setSheet(false)}>Reset</Button><Button variant="primary" onClick={() => { setSheet(false); toast({ title: 'Filters applied' }) }}>Apply</Button></>}>
          <div className="flex flex-col gap-4">
            <Field label="Status"><Select options={[{ value: 'any', label: 'Any' }, { value: 'paid', label: 'Paid' }, { value: 'due', label: 'Overdue' }]} defaultValue="any" /></Field>
            <Field label="Date range"><DateRangePicker /></Field>
            <Switch label="Only mine" />
          </div>
        </Sheet>
        <SpecPreview className="!p-0 !pt-0">
          <div className="flex h-[132px] bg-[color-mix(in_srgb,var(--fg)_14%,var(--bg))]">
            <div className="flex-1" />
            <div className="flex w-[58%] flex-col gap-2 border-s border-[var(--line)] bg-[var(--card)] p-3 shadow-[var(--shadow)]">
              <b className="text-[13px]">Filters</b>
              {['Status', 'Date range'].map(l => <div key={l}><span className="text-[11px] text-[var(--fg3)]">{l}</span><div className="mt-0.5 h-5 rounded-[var(--r-sm)] border border-[var(--line)]" /></div>)}
              <div className="mt-auto flex justify-end gap-1"><i className="h-4 w-10 rounded-[var(--r-sm)] bg-[var(--muted)]" /><i className="h-4 w-10 rounded-[var(--r-sm)] bg-[var(--primary)]" /></div>
            </div>
          </div>
        </SpecPreview>
      </Spec>
      <Spec title="Popover" desc="Rich content, not just a menu">
        <Row><Popover><PopoverTrigger>Share</PopoverTrigger>
          <PopoverContent className="w-[min(280px,calc(100vw-16px))] p-3">
            <b className="text-[13px]">Share this page</b><div className="mt-0.5 mb-2.5 text-xs text-[var(--fg3)]">Anyone with the link can view</div>
            <Row className="flex-nowrap"><Input readOnly value="example.com/p/x7k2" className="!h-8 min-w-0 font-[family-name:var(--mono)] !text-xs [@media(pointer:coarse)]:!h-9 [@media(pointer:coarse)]:!text-base" /><CopyButton text="example.com/p/x7k2" size="sm" /></Row>
            <div className="mt-3"><Switch label="Allow comments" defaultChecked /></div>
          </PopoverContent></Popover></Row>
        <SpecPreview>
          <div className={cn(floatingSurface, 'w-full max-w-[260px] p-3')}>
            <b className="text-[13px]">Share this page</b><div className="mt-0.5 mb-2 text-xs text-[var(--fg3)]">Anyone with the link can view</div>
            <div className="flex h-7 items-center rounded-[var(--r-md)] border border-[var(--line)] px-2 font-[family-name:var(--mono)] text-xs text-[var(--fg2)]">example.com/p/x7k2</div>
          </div>
        </SpecPreview>
      </Spec>
      <Spec title="Hover card" desc="Profile preview on hover or focus; tap on touch">
        <div className="text-[13px] leading-loose">Assigned to <HoverCard trigger={<a href="#overlays" onClick={e => e.preventDefault()} className="font-medium text-[var(--accent)] no-underline [@media(pointer:coarse)]:py-2">@alexlee</a>}>
          <div className="flex items-center gap-2.5"><Avatar name="Alex Lee" size={40} status="online" /><div className="flex-1"><b className="block">Alex Lee</b><span className="text-xs text-[var(--fg3)]">Design lead · Zürich</span></div><Badge tone="ok" dot>Online</Badge></div>
          <p className="my-2.5 text-xs text-[var(--fg2)]">Working on the onboarding redesign.</p>
          <div className="mb-2.5 flex gap-4 text-xs text-[var(--fg3)]"><span><b className="text-[var(--fg)]">128</b> commits</span><span><b className="text-[var(--fg)]">24</b> reviews</span><span><b className="text-[var(--fg)]">6</b> projects</span></div>
          <Button size="sm" className="w-full">Message</Button>
        </HoverCard> for review.</div>
        <SpecPreview>{ovPreviewProfile}</SpecPreview>
      </Spec>
      <Spec title="Onboarding tour" desc="Spotlight steps through the UI, with a tooltip anchored to each target"><OvTourDemo /></Spec>
      <Spec title="Tooltip" desc="Short delay, quick fade. Tap on touch">
        <Row>
          <Tooltip content={<>Bold <Kbd className="!border-current !bg-transparent !text-inherit">⌘B</Kbd></>}><Button size="icon" aria-label="Bold"><b>B</b></Button></Tooltip>
          <Tooltip content="Italic"><Button size="icon" aria-label="Italic"><i>I</i></Button></Tooltip>
          <Tooltip content="Insert link"><Button size="icon" aria-label="Link"><Icon name="link" /></Button></Tooltip>
        </Row>
        <SpecPreview className="flex flex-col items-start gap-1.5">
          <span className="ms-1 rounded-[var(--r-md)] bg-[var(--primary)] px-2 py-1 text-xs text-[var(--on-primary)] shadow-[var(--shadow)]">Insert link</span>
          <Button size="icon" tabIndex={-1} aria-hidden><Icon name="link" /></Button>
        </SpecPreview>
      </Spec>
      <Spec title="Command palette" desc="Keyboard access to everything. Every word must match; tags show why." keys={[[['⌘', 'K'], 'Open'], [['↑', '↓'], 'Move'], [['↵'], 'Run']]}>
        <Row><Button onClick={openPalette}>Open palette</Button><span className="hidden text-xs text-[var(--fg3)] [@media(hover:none)]:inline">or tap the search icon in the header</span></Row>
      </Spec>
      <Spec title="Command palette · pages and async" desc="Groups, nested pages (Enter opens, Backspace on an empty search goes back), results from an API as you type (debounced, the stale request aborted), recent commands, and a virtualised list for long results."
        keys={[[['↵'], 'Run or open'], [['⌫'], 'Back a page'], [['↑', '↓'], 'Move']]}>
        <OvPaletteDemo />
      </Spec>
      <Spec title="Alert dialog" desc="For consequential actions: role=alertdialog, focus starts on Cancel, an outside click doesn’t dismiss it (it shakes), and the confirm waits on the request, showing its error if it fails.">
        <OvAlertDemo />
      </Spec>
      <Spec title="Hold to confirm" desc="Press and hold for destructive actions">
        <HoldToConfirm onConfirm={() => toast({ title: 'Workspace deleted', tone: 'bad' })} status={{ done: 'Workspace deleted' }} />
      </Spec>
      <Spec title="Notification centre" desc="Unread count, mark all read. The bell shakes when something new arrives."><OvNotificationDemo /></Spec>
      <Spec title="Announcement banner" desc="Dismiss collapses smoothly"><OvBannerDemo /></Spec>
      <Spec title="Composable overlays" desc="Every overlay is also a set of parts (Root, Trigger, Content, Title, Description, Close, Footer), shadcn style. Triggers take asChild; content takes side, align, sideOffset and arrow."
        keys={[[['Esc'], 'Close'], [['Tab'], 'Stays inside']]}>
        <OvPartsDemo />
      </Spec>
      <Spec title="Inline edit" desc="Click to edit, Enter saves, Esc cancels">
        <InlineEdit value={title} onSave={setTitle} label="title" helper="Last edited 2 h ago" className="text-base" />
      </Spec>
    </Section>
  )
}
