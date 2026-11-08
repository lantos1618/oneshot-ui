import { useEffect, useRef, useState, type ReactNode } from 'react'
import { AnimatePresence, animate, motion, useInView } from 'motion/react'
import { Alert, Avatar, Badge, Button, CookieConsent, EmptyState, Icon, OfflineIndicator, Progress, ProgressRing, Skeleton, Spinner, confetti, sleep, spring, useToast } from '../lib'
import { Row, Section, Spec } from './kit'

/** Small browser-window mock used by the consent and offline demos. */
function FbMockWindow({ children, className }: { children?: ReactNode; className?: string }) {
  return (
    <div className={`relative h-[190px] overflow-hidden rounded-[var(--r-md)] border border-[var(--line)] bg-[var(--bg)] ${className ?? ''}`}>
      <div className="flex gap-1 border-b border-[var(--line)] bg-[var(--card)] px-2.5 py-2">{[0, 1, 2].map(i => <i key={i} className="h-2 w-2 rounded-full bg-[var(--line2)]" />)}</div>
      <div className="flex flex-col gap-2 p-3">{['w-[90%]', 'w-[60%]', 'w-[90%]'].map((w, i) => <div key={i} className={`h-2 rounded bg-[var(--line)] ${w}`} />)}</div>
      {children}
    </div>
  )
}

const FB_STAGES = ['Uploading', 'Processing', 'Finalising']
function FbProgressDemo() {
  const [p, setP] = useState(0)
  const [run, setRun] = useState<'idle' | 'running' | 'done'>('idle')
  const start = async () => {
    setRun('running')
    for (let v = 0; v <= 100; v += 4) { setP(v); await sleep(55) }
    setRun('done')
  }
  const label = run === 'done' ? 'Upload complete' : run === 'running' ? `${FB_STAGES[Math.min(2, Math.floor(p / 34))]}…` : 'Ready to upload'
  return (
    <>
      <Row className="justify-between"><span className="text-[13px] text-[var(--fg2)]" aria-live="polite">{label}</span><span className="ui-num text-[13px] font-medium">{Math.round(p)}%</span></Row>
      <Progress value={p} tone={run === 'done' ? 'ok' : 'primary'} label="Upload progress" />
      <Row className="justify-between"><ProgressRing value={p} size={48} tone={run === 'done' ? 'ok' : 'primary'} /><Button size="sm" disabled={run === 'running'} onClick={start}>{run === 'done' ? 'Again' : 'Upload'}</Button></Row>
    </>
  )
}

function FbSkeletonDemo() {
  const [loading, setLoading] = useState(true)
  const reload = async () => { setLoading(true); await sleep(1300); setLoading(false) }
  useEffect(() => { const t = setTimeout(() => setLoading(false), 1300); return () => clearTimeout(t) }, [])
  const rows = [['Alex Lee', 'Updated the roadmap'], ['Bea Kim', 'Shipped v2.4']]
  return (
    <>
      <div className="min-h-[96px]" aria-busy={loading}>
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
  const [online, setOnline] = useState(true)
  return (
    <>
      <FbMockWindow><OfflineIndicator online={online} /></FbMockWindow>
      <Row><Button size="sm" onClick={() => setOnline(o => !o)}>{online ? 'Go offline' : 'Go online'}</Button><span className="text-xs text-[var(--fg3)]">{online ? 'Online' : 'Offline'}</span></Row>
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

export function FeedbackSection() {
  const toast = useToast()
  return (
    <Section id="feedback" title="Feedback" desc="Tell people what happened, what’s happening, and what to do next.">
      <Spec title="Toasts" desc="Stack with springs, undo inline">
        <Row>
          <Button onClick={() => toast({ title: 'Changes saved', description: 'Just now' })}>Success</Button>
          <Button onClick={() => toast({ title: 'Message archived', action: { label: 'Undo', onClick: () => toast({ title: 'Restored', tone: 'info' }) } })}>With undo</Button>
          <Button onClick={() => toast({ title: 'Couldn’t connect', description: 'Check your network and retry', tone: 'bad' })}>Error</Button>
        </Row>
      </Spec>
      <Spec title="Alerts" desc="Tinted, icon plus text">
        <Alert title="New version available">Refresh to update.</Alert>
        <Alert tone="bad" title="Sync failed">Your changes are saved locally.</Alert>
      </Spec>
      <Spec title="Progress" desc="Linear and ring, with percentage"><FbProgressDemo /></Spec>
      <Spec title="Skeleton loading" desc="Shimmer, then content fades up"><FbSkeletonDemo /></Spec>
      <Spec title="Empty state" desc="An invitation to act">
        <EmptyState icon="calendar" title="No events yet" description="Create one to see it here" action={<Button size="sm" variant="primary">New event</Button>} />
      </Spec>
      <Spec title="Badges and status" desc="Never colour alone">
        <Row><Badge tone="ok" dot>Live</Badge><Badge tone="warn" dot>Pending</Badge><Badge tone="bad" dot>Failed</Badge><Badge tone="accent">New</Badge><Badge>Draft</Badge></Row>
        <Row><FbLiveBadge /></Row>
      </Spec>
      <Spec title="Celebration" desc="Confetti for real milestones, not every click">
        <div className="flex min-h-[120px] flex-col items-center justify-center gap-2">
          <Button variant="primary" onClick={e => { const r = e.currentTarget.getBoundingClientRect(); confetti({ x: r.left + r.width / 2, y: r.top }) }}>🎉 Celebrate</Button>
          <span className="text-xs text-[var(--fg3)]">Respects reduced motion</span>
        </div>
      </Spec>
      <Spec title="Cookie consent" desc="Reject is as easy as accept. Customise expands in place."><FbCookieDemo /></Spec>
      <Spec title="Offline indicator" desc="Explains what still works and retries on its own"><FbOfflineDemo /></Spec>
      <Spec title="Upgrade prompt" desc="Appears at the limit, with the value of upgrading"><FbUpgradeDemo /></Spec>
    </Section>
  )
}
