import { useEffect, useRef, useState, type ReactNode } from 'react'
import { AnimatePresence, animate, motion, useInView } from 'motion/react'
import { Alert, Avatar, Badge, Button, EmptyState, Icon, IconButton, OfflineIndicator, Progress, ProgressRing, Skeleton, Spinner, Switch, cn, confetti, floatingSurface, sleep, spring, useToast } from '../lib'
import { CookieConsent } from '../blocks'
import { Row, Section, Spec, SpecPreview } from './kit'

/** Small browser-window mock used by the consent and offline demos: a page with a header, a hero and some copy. */
function FbMockWindow({ children, className }: { children?: ReactNode; className?: string }) {
  return (
    <div className={`relative h-[190px] overflow-hidden rounded-[var(--r-md)] border border-[var(--line)] bg-[var(--bg)] ${className ?? ''}`}>
      <div className="flex items-center gap-1 border-b border-[var(--line)] bg-[var(--card)] px-2.5 py-2">
        {[0, 1, 2].map(i => <i key={i} className="h-2 w-2 rounded-full bg-[var(--line2)]" />)}
        <span className="ml-2 h-3.5 flex-1 rounded-full bg-[var(--muted)] px-2" aria-hidden />
      </div>
      <div aria-hidden className="flex flex-col gap-2 p-3">
        <div className="flex items-center gap-2"><i className="h-3 w-3 rounded-[var(--r-sm)] bg-[var(--primary)]" /><i className="h-2 w-12 rounded-full bg-[var(--line2)]" /><span className="flex-1" /><i className="h-2 w-8 rounded-full bg-[var(--line)]" /><i className="h-2 w-8 rounded-full bg-[var(--line)]" /></div>
        <div className="mt-1 h-3 w-[70%] rounded-full bg-[var(--line2)]" />
        {['w-[92%]', 'w-[84%]', 'w-[60%]'].map((w, i) => <div key={i} className={`h-2 rounded-full bg-[var(--line)] ${w}`} />)}
        <div className="mt-1 grid grid-cols-3 gap-2">{[0, 1, 2].map(i => <div key={i} className="h-12 rounded-[var(--r-sm)] bg-[var(--muted)]" />)}</div>
      </div>
      {children}
    </div>
  )
}

const FB_STAGES = ['Uploading', 'Processing', 'Finalising']
function FbProgressDemo() {
  // starts mid-upload, so the card shows the bar, the ring and a stage at a glance; Resume finishes, Again restarts
  const [p, setP] = useState(60)
  const [run, setRun] = useState<'paused' | 'running' | 'done'>('paused')
  const start = async () => {
    setRun('running')
    for (let v = run === 'done' ? 0 : p; v <= 100; v += 4) { setP(v); await sleep(55) }
    setRun('done')
  }
  const label = run === 'done' ? 'Upload complete' : run === 'running' ? `${FB_STAGES[Math.min(2, Math.floor(p / 34))]}…` : 'Processing · paused'
  return (
    <>
      <div className="flex items-center gap-2.5 rounded-[var(--r-md)] border border-[var(--line)] px-3 py-2">
        <Icon name="file" size={16} className="flex-none text-[var(--fg3)]" />
        <div className="min-w-0 flex-1"><b className="block truncate text-[13px] font-medium">brand-guidelines.pdf</b><span className="text-xs text-[var(--fg3)]" aria-live="polite">{label}</span></div>
        <span className="ui-num text-[13px] font-medium">{Math.round(p)}%</span>
      </div>
      <Progress value={p} tone={run === 'done' ? 'ok' : 'primary'} label="Upload progress" />
      <Row className="justify-between"><ProgressRing value={p} size={48} tone={run === 'done' ? 'ok' : 'primary'} aria-label="Upload progress" />
        <Button size="sm" disabled={run === 'running'} onClick={start}>{run === 'done' ? 'Again' : run === 'running' ? 'Uploading…' : 'Resume'}</Button></Row>
    </>
  )
}

function FbSkeletonDemo() {
  const [loading, setLoading] = useState(true)
  const reload = async () => { setLoading(true); await sleep(1300); setLoading(false) }
  // the first load plays when the card scrolls into view, so you see the shimmer hand over to content
  const ref = useRef<HTMLDivElement>(null), seen = useInView(ref, { once: true, amount: 0.6 })
  useEffect(() => { if (!seen) return; const t = setTimeout(() => setLoading(false), 1300); return () => clearTimeout(t) }, [seen])
  const rows = [['Alex Lee', 'Updated the roadmap'], ['Bea Kim', 'Shipped v2.4']]
  return (
    <>
      <div ref={ref} className="min-h-[96px]" aria-busy={loading}>
        <AnimatePresence mode="wait">
          {loading ? (
            <motion.div key="s" exit={{ opacity: 0, transition: { duration: 0.12 } }} className="flex flex-col gap-2.5">
              {rows.map(([n]) => <div key={n} className="flex items-center gap-2.5"><Skeleton className="h-[34px] w-[34px] rounded-full" /><div className="flex flex-1 flex-col gap-2"><Skeleton className="h-2.5 w-[55%]" /><Skeleton className="h-[9px] w-[85%]" /></div></div>)}
            </motion.div>
          ) : (
            <motion.div key="c" className="flex flex-col gap-2.5">
              {rows.map(([n, d], i) => (
                <motion.div key={n} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.35, delay: i * 0.08 }} className="flex items-center gap-2.5 text-[13px]">
                  <Avatar name={n} size={34} /><div><b className="block font-medium">{n}</b><span className="text-xs text-[var(--fg3)]">{d}</span></div>
                </motion.div>
              ))}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
      <Button size="sm" className="self-start" disabled={loading} onClick={reload}>Reload</Button>
    </>
  )
}

function FbLiveBadge() {
  const [deployed, setDeployed] = useState(false)
  const ref = useRef<HTMLSpanElement>(null), visible = useInView(ref)
  useEffect(() => { if (!visible) return; const t = setInterval(() => setDeployed(d => !d), 2600); return () => clearInterval(t) }, [visible])
  return (
    <motion.span ref={ref} key={String(deployed)} initial={{ scale: 0.9 }} animate={{ scale: 1 }} transition={spring(0.5, 0.35)} className="inline-flex" aria-live="polite">
      {deployed ? <Badge tone="accent" dot>Deployed</Badge> : <Badge tone="ok"><Spinner size={10} className="!border-[1.5px]" />Deploying</Badge>}
    </motion.span>
  )
}

const FB_COOKIES = [{ id: 'essential', label: 'Essential', description: 'Required for the site to work', required: true }, { id: 'analytics', label: 'Analytics', description: 'Anonymous usage stats' }, { id: 'marketing', label: 'Marketing', description: 'Personalised ads' }]
function FbCookieDemo() {
  const toast = useToast()
  const ref = useRef<HTMLDivElement>(null), inView = useInView(ref, { amount: 0.6, once: true })
  const [decided, setDecided] = useState(false)
  return (
    <div ref={ref}>
      <FbMockWindow className="!h-[280px]">
        <CookieConsent categories={FB_COOKIES} open={inView && !decided} className="max-h-[calc(100%-16px)] overflow-auto"
          onDecision={c => { setDecided(true); toast({ title: c.kind === 'accept' ? 'All cookies accepted' : c.kind === 'reject' ? 'Only essential cookies' : 'Saved your choices', tone: 'info' }) }} />
        <AnimatePresence>
          {decided && (
            <motion.div className="absolute bottom-2.5 left-2.5" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
              <Button size="sm" onClick={() => setDecided(false)}><Icon name="settings" size={13} />Cookie settings</Button>
            </motion.div>
          )}
        </AnimatePresence>
      </FbMockWindow>
    </div>
  )
}

function FbOfflineDemo() {
  // starts offline so the card shows the banner; it only counts down while on screen (off screen it reads as online)
  const [online, setOnline] = useState(false)
  const ref = useRef<HTMLDivElement>(null), inView = useInView(ref)
  return (
    <>
      <div ref={ref}><FbMockWindow><OfflineIndicator online={online || !inView} /></FbMockWindow></div>
      <Switch label={<span className="text-[13px] text-[var(--fg2)]">Connected</span>} checked={online} onChange={setOnline} />
    </>
  )
}

function FbUpgradeDemo() {
  const toast = useToast()
  const LIM = 10
  const [used, setUsed] = useState(8)
  const [card, setCard] = useState<'hidden' | 'offer' | 'pro'>('hidden')
  const cardRef = useRef<HTMLDivElement>(null), barRef = useRef<HTMLDivElement>(null)
  const add = () => {
    if (card === 'pro') { setUsed(u => u + 1); return }
    if (used < LIM) {
      setUsed(used + 1)
      if (barRef.current) animate(barRef.current, { scaleY: [1, 1.8, 1] }, { duration: 0.35 })
      if (used + 1 === LIM) toast({ title: 'That was your last free project', description: 'Upgrade for unlimited', tone: 'info' })
      return
    }
    if (card === 'offer' && cardRef.current) animate(cardRef.current, { x: [0, -4, 4, 0] }, { duration: 0.3 })
    setCard('offer')
  }
  const tone = card === 'pro' ? 'ok' : used >= LIM ? 'bad' : used >= 8 ? 'warn' : 'primary'
  return (
    <>
      <Row className="justify-between"><span className="text-[13px] text-[var(--fg2)]">Projects</span><span className="ui-num text-xs text-[var(--fg3)]">{used} / {card === 'pro' ? '∞' : LIM}</span></Row>
      <div ref={barRef}><Progress value={card === 'pro' ? LIM : used} max={LIM} tone={tone} label="Projects used" /></div>
      <Button size="sm" className="self-start" onClick={add}><Icon name="plus" size={13} />New project</Button>
      <AnimatePresence mode="wait">
        {card !== 'hidden' && (
          <motion.div ref={cardRef} key={card} initial={{ opacity: 0, y: 8, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 6, transition: { duration: 0.15 } }} transition={spring(0.25, 0.35)}
            className="rounded-[var(--r-lg)] border border-[var(--line)] bg-[linear-gradient(160deg,var(--accent-soft),var(--card)_60%)] p-3">
            {card === 'offer' ? (
              <>
                <b className="text-sm">You’ve used all {LIM} projects</b>
                <div className="mt-0.5 text-xs text-[var(--fg3)]">Upgrade to Pro to keep building.</div>
                <ul className="my-2 mb-3 flex list-none flex-col gap-1 p-0 text-xs text-[var(--fg2)]">
                  {['Unlimited projects', 'Advanced analytics', 'Priority support'].map(t => <li key={t} className="flex items-center gap-1.5"><Icon name="check" size={12} strokeWidth={3} className="text-[var(--ok)]" />{t}</li>)}
                </ul>
                <Row className="justify-between"><Button size="sm" variant="ghost" onClick={() => setCard('hidden')}>Maybe later</Button>
                  <Button size="sm" variant="primary" onClick={() => {
                    setCard('pro')
                    const r = cardRef.current?.getBoundingClientRect(); if (r) confetti({ x: r.left + r.width / 2, y: r.top + r.height / 2 })
                  }}>Upgrade · €24/mo</Button></Row>
              </>
            ) : (
              <><b className="flex items-center gap-1.5 text-sm text-[var(--ok)]"><Icon name="check" size={14} strokeWidth={3} />You’re on Pro</b><div className="text-xs text-[var(--fg3)]">Unlimited projects unlocked.</div></>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </>
  )
}

function FbAlertsDemo() {
  const [shown, setShown] = useState(true)
  const toast = useToast()
  return (
    <div className="grid gap-2.5 sm:grid-cols-2">
      <Alert title="New version available">Refresh to update.</Alert>
      <Alert tone="ok" title="Payment received">€1,250 from Northwind.</Alert>
      <Alert tone="warn" title="Storage almost full">You’ve used 92% of 100 GB.</Alert>
      <Alert tone="bad" title="Sync failed" action={<Button size="xs" onClick={() => toast({ title: 'Synced', description: '3 changes uploaded', tone: 'ok' })}>Retry</Button>}>Your changes are saved locally.</Alert>
      <div className="sm:col-span-2">
        {shown
          ? <Alert tone="neutral" title="Tip: press ⌘K to jump anywhere" action={<IconButton icon="x" label="Dismiss tip" size="icon-sm" onClick={() => setShown(false)} className="-my-1 -mr-1" />}>Dismissible: it stays gone until you bring it back.</Alert>
          : <Button size="sm" onClick={() => setShown(true)}>Show the tip again</Button>}
      </div>
    </div>
  )
}

function FbCelebrationDemo() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-2 rounded-[var(--r-md)] bg-[linear-gradient(160deg,var(--accent-soft),var(--card)_70%)] p-4 text-center">
      <span className="text-[28px]" aria-hidden>🏆</span>
      <b className="text-base font-semibold">1,000 customers</b>
      <span className="max-w-[240px] text-xs text-[var(--fg2)]">Your team crossed a real milestone today. Confetti is for moments like this.</span>
      <Button variant="primary" className="mt-1" onClick={e => { const r = e.currentTarget.getBoundingClientRect(); confetti({ x: r.left + r.width / 2, y: r.top }) }}>🎉 Celebrate</Button>
      <span className="text-[11px] text-[var(--fg3)]">Respects reduced motion</span>
    </div>
  )
}

export function FeedbackSection() {
  const toast = useToast()
  return (
    <Section id="feedback" title="Feedback" desc="Tell people what happened, what’s happening, and what to do next.">
      <Spec title="Alerts" desc="Tinted, icon plus text. Four tones, an action, and one you can dismiss." span={2}><FbAlertsDemo /></Spec>
      <Spec title="Toasts" desc="Stack with springs, undo inline">
        <Row>
          <Button onClick={() => toast({ title: 'Changes saved', description: 'Just now', tone: 'ok' })}>Success</Button>
          <Button onClick={() => toast({ title: 'Message archived', action: { label: 'Undo', onClick: () => toast({ title: 'Restored', tone: 'info' }) } })}>With undo</Button>
          <Button onClick={() => toast({ title: 'Couldn’t connect', description: 'Check your network and retry', tone: 'bad' })}>Error</Button>
        </Row>
        <SpecPreview label="A stack of toasts" className="flex flex-col items-end gap-1.5">
          {([['Message archived', 'Undo', 'check'], ['Changes saved', 'Just now', 'check']] as const).map(([t, d], i) => (
            <div key={t} className={cn(floatingSurface, 'flex w-full max-w-[250px] items-center gap-2 px-3 py-2 text-xs', i === 1 && 'scale-[0.96]')}>
              <Icon name="check" size={13} className="text-[var(--ok)]" /><b className="flex-1 font-medium">{t}</b>
              {i === 0 ? <span className="font-semibold text-[var(--accent)]">{d}</span> : <span className="text-[var(--fg3)]">{d}</span>}
            </div>
          ))}
        </SpecPreview>
      </Spec>
      <Spec title="Progress" desc="Linear and ring, with percentage"><FbProgressDemo /></Spec>
      <Spec title="Skeleton loading" desc="Shimmer, then content fades up"><FbSkeletonDemo /></Spec>
      <Spec title="Empty state" desc="An invitation to act">
        <EmptyState icon="calendar" title="No events yet" description="Create one to see it here" action={<Button size="sm" variant="primary">New event</Button>} />
      </Spec>
      <Spec title="Badges and status" desc="Never colour alone">
        <Row><Badge tone="ok" dot>Live</Badge><Badge tone="warn" dot>Pending</Badge><Badge tone="bad" dot>Failed</Badge><Badge tone="accent">New</Badge><Badge>Draft</Badge></Row>
        <Row><Badge size="sm" tone="ok" dot>Live</Badge><Badge size="sm" tone="accent">New</Badge><Badge size="sm">12</Badge><span className="text-xs text-[var(--fg3)]">Small, for counts and dense rows</span></Row>
        <Row><FbLiveBadge /></Row>
      </Spec>
      <Spec title="Celebration" desc="Confetti for real milestones, not every click"><FbCelebrationDemo /></Spec>
      <Spec title="Upgrade prompt" desc="Appears at the limit, with the value of upgrading"><FbUpgradeDemo /></Spec>
      <Spec title="Cookie consent" desc="Reject is as easy as accept. Customise expands in place." span={2}><FbCookieDemo /></Spec>
      <Spec title="Offline indicator" desc="Explains what still works and retries on its own"><FbOfflineDemo /></Spec>
    </Section>
  )
}
