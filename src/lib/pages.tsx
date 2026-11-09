import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { AnimatedNumber, Avatar, Badge, Button, Icon, IconButton, type IconName, LOCALE, ScrollEdges, TOUCH, cn, fmt, spring, surface, useControllable, useRoving, useScrollEdges, useWidth } from './core'
import { shake } from './motion'
import { ActiveIndicator, CheckboxBox, Field, Input, NumberStepper, SegmentedControl, Select, Switch, type Option } from './forms'
import { Steps, Tabs, type TabItem } from './navigation'
import { Collapse, confetti, useToast } from './feedback'

/* ════════════════════════════════════════════════════════════════════════════
 * 12. PAGES
 * ══════════════════════════════════════════════════════════════════════════ */

export type Plan = {
  name: string; blurb: string; monthly: number; features: string[]
  /** features this plan lacks, shown greyed with a dash so plans compare at a glance */
  missing?: string[]; featured?: boolean; cta?: string
}
/**
 * Pricing table: monthly/yearly toggle (yearly saves `yearlyDiscount`), rolling prices, a billing line
 * that spells out the yearly total and saving, a highlighted plan, and included vs missing features.
 */
export function PricingTable({ plans, currency = 'EUR', yearlyDiscount = 0.2, onChoose, className }:
  { plans: Plan[]; currency?: string; yearlyDiscount?: number; onChoose?: (p: Plan, yearly: boolean) => void; className?: string }) {
  const [period, setPeriod] = useState('monthly')
  const yearly = period === 'yearly'
  const money = (n: number) => pagesMoney(n, currency)
  return (
    <div className={cn('flex flex-col gap-4', className)}>
      <SegmentedControl className="self-center [@media(pointer:coarse)]:[&>button]:h-10 [@media(pointer:coarse)]:[&>button>span>span]:!text-[11px]" value={period} onChange={setPeriod}
        options={[{ value: 'monthly', label: 'Monthly' }, { value: 'yearly', label: 'Yearly', hint: `−${Math.round(yearlyDiscount * 100)}%` }]} />
      <div className="grid gap-3 [grid-template-columns:repeat(auto-fit,minmax(220px,1fr))]">
        {plans.map(p => {
          const price = yearly ? Math.round(p.monthly * (1 - yearlyDiscount)) : p.monthly
          return (
            <motion.div key={p.name} whileHover={{ y: -3, boxShadow: 'var(--shadow)' }} transition={spring(0.3, 0.3)}
              className={cn(surface.card, 'relative flex flex-col gap-3 p-5', p.featured && 'border-[var(--primary)] shadow-[0_0_0_1px_var(--primary)]')}>
              {p.featured && <Badge className="absolute -top-2.5 left-5 !bg-[var(--primary)] font-semibold !text-[var(--on-primary)]">Most popular</Badge>}
              <div><h4 className="m-0 text-sm font-semibold">{p.name}</h4><p className="m-0 mt-0.5 min-h-[38px] text-[13px] text-[var(--fg2)]">{p.blurb}</p></div>
              <div>
                <div className="flex items-baseline gap-1">
                  <AnimatedNumber value={price} format={{ style: 'currency', currency, maximumFractionDigits: 0 }} className="font-[family-name:var(--font)] text-[28px] font-bold tracking-tight" />
                  <span className="text-[13px] text-[var(--fg3)]">/ month</span>
                </div>
                <AnimatePresence mode="wait" initial={false}>
                  <motion.div key={`${yearly}`} initial={{ opacity: 0, y: 3 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -3 }} transition={{ duration: 0.15 }} className="min-h-[18px] text-xs text-[var(--fg3)]">
                    {!p.monthly ? 'Free forever' : yearly ? `${money(price * 12)} billed yearly · save ${money((p.monthly - price) * 12)}` : 'Billed monthly'}
                  </motion.div>
                </AnimatePresence>
              </div>
              <Button className="w-full" variant={p.featured ? 'primary' : 'default'} onClick={() => onChoose?.(p, yearly)}>{p.cta ?? (p.monthly ? 'Start free trial' : 'Get started')}</Button>
              <ul className="m-0 flex list-none flex-col gap-2 p-0 text-[13px]">
                {p.features.map(f => <li key={f} className="flex items-start gap-2"><Icon name="check" size={14} strokeWidth={2.6} className="mt-0.5 text-[var(--ok)]" />{f}</li>)}
                {p.missing?.map(f => <li key={f} className="flex items-start gap-2 text-[var(--fg3)]"><Icon name="minus" size={14} strokeWidth={2.2} className="mt-0.5" /><span><span className="sr-only">Not included: </span>{f}</span></li>)}
              </ul>
            </motion.div>
          )
        })}
      </div>
    </div>
  )
}

/** Currency in LOCALE, without the decimals when they are .00: "€228", "€1,152.40". */
const pagesMoney = (n: number, currency: string) => fmt.money(n, currency).replace(/[.,]00(?=\D*$)/, '')
const pagesSlide = {
  enter: (d: number) => ({ opacity: 0, x: 20 * d }),
  center: { opacity: 1, x: 0 },
  exit: (d: number) => ({ opacity: 0, x: -20 * d, transition: { duration: 0.14 } }),
}

/* ── Checkout ──────────────────────────────────────────────────────────── */

export type CheckoutItem = { id: string; name: string; detail: string; price: number; qty: number; /** CSS background for the thumbnail */ swatch?: string }
export type CheckoutDetails = { name: string; email: string; address: string; vat: string; country: string }

const CO_STEPS = ['Cart', 'Details', 'Payment']
const coDigits = (v: string) => v.replace(/\D/g, '')
const coIsAmex = (d: string) => /^3[47]/.test(d)
const coBrand = (d: string) => /^4/.test(d) ? { name: 'VISA', bg: '#1A1F71' } : /^(5[1-5]|2[2-7])/.test(d) ? { name: 'Mastercard', bg: '#EB001B' } : coIsAmex(d) ? { name: 'Amex', bg: '#2E77BC' } : null
const coFormatCard = (d: string) => coIsAmex(d) ? [d.slice(0, 4), d.slice(4, 10), d.slice(10, 15)].filter(Boolean).join(' ') : d.replace(/(.{4})/g, '$1 ').trim()
const coFormatExp = (raw: string) => { let d = coDigits(raw).slice(0, 4); if (/^[2-9]$/.test(d)) d = '0' + d; return d.length > 2 ? `${d.slice(0, 2)} / ${d.slice(2)}` : d }

function CheckoutDone({ email, total, currency, onRestart }: { email: string; total: number; currency: string; onRestart: () => void }) {
  const ring = useRef<HTMLSpanElement>(null)
  useEffect(() => {
    const t = setTimeout(() => { const r = ring.current?.getBoundingClientRect(); if (r) confetti({ x: r.left + r.width / 2, y: r.top + r.height / 2, count: 90 }) }, 120)
    return () => clearTimeout(t)
  }, [])
  return (
    <div className="flex min-h-[250px] flex-col items-center justify-center gap-2.5 text-center" role="status">
      <motion.span ref={ring} initial={{ scale: 0.4 }} animate={{ scale: 1 }} transition={spring(0.5, 0.5)} className="grid h-16 w-16 place-items-center rounded-full bg-[var(--ok-soft)] text-[var(--ok)]">
        <Icon name="check" size={30} strokeWidth={2.6} />
      </motion.span>
      <b className="text-base">Payment successful</b>
      <span className="text-[13px] text-[var(--fg2)]">{fmt.money(total, currency)} paid · receipt sent to {email}</span>
      <Button size="sm" onClick={onRestart}><Icon name="refresh" size={13} />Start over</Button>
    </div>
  )
}

/**
 * Checkout: Cart → Details → Payment with slide transitions, quantity steppers and an order summary
 * whose subtotal, promo, VAT and total all roll. Promo codes come from `promoCodes` (wrong code shakes),
 * the email is validated, the card number is grouped as you type with a VISA / Mastercard / Amex badge,
 * expiry is masked MM / YY, and paying shows Processing then a success screen with confetti.
 */
export function Checkout({ items: initialItems, currency = 'EUR', vatRate = 0.081, promoCodes = { SAVE10: 0.1 }, defaultDetails, countries = ['Switzerland', 'United Kingdom', 'Germany'], onComplete, className }:
  { items: CheckoutItem[]; currency?: string; vatRate?: number; promoCodes?: Record<string, number>; defaultDetails?: Partial<CheckoutDetails>; countries?: string[]
    onComplete?: (o: { items: CheckoutItem[]; details: CheckoutDetails; total: number; promo?: string }) => void; className?: string }) {
  const blankDetails: CheckoutDetails = { name: 'Alex Lee', email: 'alex@northwind.io', address: 'Bahnhofstrasse 21, 8001 Zürich', vat: '', country: countries[0], ...defaultDetails }
  const [items, setItems] = useState(initialItems)
  const [step, setStep] = useState(0)
  const [dir, setDir] = useState(1)
  const [promo, setPromo] = useState<{ code: string; rate: number } | null>(null)
  const [code, setCode] = useState('')
  const [promoMsg, setPromoMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [det, setDet] = useState(blankDetails)
  const [emailErr, setEmailErr] = useState(false)
  const [card, setCard] = useState(''), [exp, setExp] = useState(''), [cvc, setCvc] = useState('')
  const [payErr, setPayErr] = useState<{ card?: string; exp?: string; cvc?: string }>({})
  const [paying, setPaying] = useState(false)
  const root = useRef<HTMLDivElement>(null)
  const [wrap, w] = useWidth<HTMLDivElement>()
  const wide = w === 0 || w >= 720
  const sub = items.reduce((a, x) => a + x.price * x.qty, 0), disc = sub * (promo?.rate ?? 0), tax = (sub - disc) * vatRate, total = sub - disc + tax
  const money = { style: 'currency', currency } as const
  const q = (sel: string) => root.current?.querySelector(sel)
  const go = (n: number) => { setDir(Math.sign(n - step) || 1); setStep(n) }
  const apply = () => {
    const v = code.trim().toUpperCase(), r = promoCodes[v]
    if (r) { setPromo({ code: v, rate: r }); setPromoMsg({ ok: true, text: `${Math.round(r * 100)}% off applied` }) }
    else { setPromoMsg({ ok: false, text: v ? 'That code isn’t valid' : 'Enter a promo code' }); shake(q('[data-co-promo]'), 5) }
  }
  const toPayment = () => {
    if (!/^\S+@\S+\.\S+$/.test(det.email)) { setEmailErr(true); shake(q('#co-email'), 5); (q('#co-email') as HTMLInputElement | null)?.focus(); return }
    go(2)
  }
  const pay = () => {
    const d = coDigits(card), e = coDigits(exp), mm = +e.slice(0, 2), yy = +e.slice(2), now = new Date(), err: typeof payErr = {}
    if (d.length < (coIsAmex(d) ? 15 : 16)) err.card = 'Enter the full card number'
    if (e.length < 4 || mm < 1 || mm > 12) err.exp = 'Use MM / YY'
    else if (2000 + yy < now.getFullYear() || (2000 + yy === now.getFullYear() && mm < now.getMonth() + 1)) err.exp = 'This card has expired'
    if (cvc.length < (coIsAmex(d) ? 4 : 3)) err.cvc = coIsAmex(d) ? '4 digits on the front' : '3 digits on the back'
    setPayErr(err)
    const first = err.card ? '#co-card' : err.exp ? '#co-exp' : err.cvc ? '#co-cvc' : null
    if (first) { shake(q(first), 5); return }
    setPaying(true)
    setTimeout(() => { setPaying(false); setDir(1); setStep(3); onComplete?.({ items, details: det, total, promo: promo?.code }) }, 1100)
  }
  const restart = () => {
    setItems(initialItems); setPromo(null); setCode(''); setPromoMsg(null); setDet(blankDetails); setCard(''); setExp(''); setCvc(''); setPayErr({}); setEmailErr(false)
    setDir(-1); setStep(0)
  }
  const brand = coBrand(coDigits(card))
  const row = 'flex justify-between text-[13px] text-[var(--fg2)]'
  // phones: the step's actions stick to the bottom of the screen while its fields scroll (and stay above the keyboard)
  const nav = (back: boolean, next: ReactNode) => (
    <div className={cn('flex gap-2', back ? 'justify-between' : 'justify-end',
      !wide && 'sticky bottom-0 z-[2] -mx-4 border-t border-[var(--line)] bg-[var(--card)] px-4 pt-3 pb-[max(12px,env(safe-area-inset-bottom))] [&>button]:h-11 [&>button:last-child]:flex-1')}>
      {back && <Button onClick={() => go(step - 1)}>Back</Button>}{next}
    </div>
  )

  const panes = [
    <div className="flex flex-col gap-3">
      <ul className="m-0 list-none p-0">
        {items.map(it => (
          <li key={it.id} className="flex flex-wrap items-center gap-3 border-b border-[var(--line)] py-2.5 text-[13px]">
            <i className="h-11 w-11 flex-none rounded-[var(--r-md)]" style={{ background: it.swatch ?? 'var(--muted)' }} />
            <div className="min-w-[120px] flex-1"><b className="block font-medium">{it.name}</b><span className="text-xs text-[var(--fg3)]">{it.detail}</span></div>
            <NumberStepper value={it.qty} min={1} max={20} label={`${it.name} quantity`} onChange={n => setItems(l => l.map(x => x.id === it.id ? { ...x, qty: n } : x))} />
            <AnimatedNumber value={it.price * it.qty} format={{ ...money, maximumFractionDigits: 0 }} className="min-w-[80px] justify-end font-medium" />
          </li>
        ))}
      </ul>
      {nav(false, <Button variant="primary" onClick={() => go(1)}>Continue to details</Button>)}
    </div>,
    <div className="flex flex-col gap-3">
      <div className={cn('grid gap-2.5', wide ? 'grid-cols-2' : 'grid-cols-1')}>
        <Field label="Full name" htmlFor="co-name"><Input id="co-name" value={det.name} onChange={e => setDet({ ...det, name: e.target.value })} autoComplete="name" /></Field>
        <Field label="Email" htmlFor="co-email" error={emailErr ? 'Enter a valid email, like name@company.com' : undefined}>
          <Input id="co-email" type="email" value={det.email} aria-invalid={emailErr || undefined} onChange={e => { setDet({ ...det, email: e.target.value }); setEmailErr(false) }} autoComplete="email" />
        </Field>
        <Field label="Company address" htmlFor="co-addr" className="col-span-full"><Input id="co-addr" value={det.address} onChange={e => setDet({ ...det, address: e.target.value })} /></Field>
        <Field label="VAT number" htmlFor="co-vat" hint="Optional"><Input id="co-vat" value={det.vat} placeholder="CHE-123.456.789" onChange={e => setDet({ ...det, vat: e.target.value })} /></Field>
        <Field label="Country"><Select aria-label="Country" value={det.country} onChange={v => setDet({ ...det, country: v })} options={countries.map(c => ({ value: c, label: c }))} /></Field>
      </div>
      {nav(true, <Button variant="primary" onClick={toPayment}>Continue to payment</Button>)}
    </div>,
    <div className="flex flex-col gap-3">
      <Field label="Card number" htmlFor="co-card" error={payErr.card}>
        <div className="relative">
          <Input id="co-card" inputMode="numeric" autoComplete="off" placeholder="1234 1234 1234 1234" value={card} aria-invalid={!!payErr.card || undefined}
            onChange={e => { const d = coDigits(e.target.value); setCard(coFormatCard(d.slice(0, coIsAmex(d) ? 15 : 16))); setPayErr(p => ({ ...p, card: undefined })) }}
            className="pr-24 font-[family-name:var(--mono)] tracking-wide" />
          <AnimatePresence>
            {brand && (
              <motion.span key={brand.name} initial={{ opacity: 0, scale: 0.7 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.7, transition: { duration: 0.1 } }} transition={spring(0.5, 0.3)}
                className="absolute top-1/2 right-2.5 -mt-[10px] rounded-[var(--r-sm)] px-1.5 py-[3px] font-[family-name:var(--mono)] text-[11px] leading-[14px] font-bold tracking-wider text-white uppercase" style={{ background: brand.bg }}>
                {brand.name}
              </motion.span>
            )}
          </AnimatePresence>
        </div>
      </Field>
      <div className="grid grid-cols-2 gap-2.5">
        <Field label="Expiry" htmlFor="co-exp" error={payErr.exp}>
          <Input id="co-exp" inputMode="numeric" placeholder="MM / YY" value={exp} aria-invalid={!!payErr.exp || undefined} className="font-[family-name:var(--mono)]"
            onChange={e => { const v = e.target.value; setExp(v.length < exp.length && exp.endsWith(' / ') ? v : coFormatExp(v)); setPayErr(p => ({ ...p, exp: undefined })) }} />
        </Field>
        <Field label="CVC" htmlFor="co-cvc" error={payErr.cvc}>
          <Input id="co-cvc" inputMode="numeric" placeholder="123" value={cvc} aria-invalid={!!payErr.cvc || undefined} className="font-[family-name:var(--mono)]"
            onChange={e => { setCvc(coDigits(e.target.value).slice(0, 4)); setPayErr(p => ({ ...p, cvc: undefined })) }} />
        </Field>
      </div>
      <p className="m-0 text-xs text-[var(--fg3)]">Demo only: nothing is charged and nothing leaves the page.</p>
      {nav(true, <Button variant="primary" loading={paying} onClick={pay}>{paying ? 'Processing' : <>Pay <AnimatedNumber value={total} format={money} /></>}</Button>)}
    </div>,
    <CheckoutDone email={det.email} total={total} currency={currency} onRestart={restart} />,
  ]

  return (
    <div ref={el => { wrap.current = el; root.current = el }} className={cn('grid gap-4', wide ? 'grid-cols-[minmax(0,1fr)_300px]' : 'grid-cols-1', className)}>
      <div className={cn(surface.card, 'flex min-w-0 flex-col gap-4 p-4')}>
        <Steps steps={CO_STEPS} current={step} />
        <div className="relative min-h-[250px] overflow-clip [overflow-clip-margin:8px]">
          <AnimatePresence mode="wait" initial={false} custom={dir}>
            <motion.div key={step} custom={dir} variants={pagesSlide} initial="enter" animate="center" exit="exit" transition={spring(0.2, 0.35)}>{panes[step]}</motion.div>
          </AnimatePresence>
        </div>
      </div>
      <aside aria-label="Order summary" className={cn(surface.card, 'flex flex-col gap-2.5 self-start !bg-[color-mix(in_srgb,var(--muted)_40%,var(--card))] p-4')}>
        <h4 className="m-0 text-sm font-semibold">Order summary</h4>
        <div className={row}><span>Subtotal</span><AnimatedNumber value={sub} format={money} /></div>
        <Collapse open={!!promo}><div className={cn(row, '!text-[var(--ok)]')}><span>Promo {promo?.code}</span><AnimatedNumber value={-disc} format={money} /></div></Collapse>
        <div className={row}><span>VAT {(vatRate * 100).toLocaleString(LOCALE, { maximumFractionDigits: 2 })}%</span><AnimatedNumber value={tax} format={money} /></div>
        <div className="flex justify-between border-t border-[var(--line)] pt-2.5 text-sm font-semibold"><span>Total</span><AnimatedNumber value={total} format={money} className="font-[family-name:var(--font)] tabular-nums" /></div>
        <form className="flex gap-1.5" data-co-promo onSubmit={e => { e.preventDefault(); apply() }}>
          <Input value={code} onChange={e => { setCode(e.target.value); if (promoMsg && !promoMsg.ok) setPromoMsg(null) }} placeholder="Promo code" aria-label="Promo code"
            aria-invalid={promoMsg?.ok === false || undefined} disabled={step === 3} className={cn('!h-8 uppercase placeholder:normal-case', TOUCH.row)} />
          <Button size="sm" type="submit" disabled={step === 3} className={cn('!h-8 flex-none', TOUCH.row)}>Apply</Button>
        </form>
        <AnimatePresence mode="wait" initial={false}>
          {promoMsg && <motion.p key={promoMsg.text} initial={{ opacity: 0, y: -3 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.15 }} aria-live="polite"
            className={cn('m-0 text-xs', promoMsg.ok ? 'text-[var(--ok)]' : 'text-[var(--bad)]')}>{promoMsg.text}</motion.p>}
        </AnimatePresence>
      </aside>
    </div>
  )
}

/* ── Settings page ─────────────────────────────────────────────────────── */

export type SettingsValue = boolean | string
export type SettingsRow = { id: string; label: string; description?: string } & (
  | { type: 'toggle'; value: boolean }
  | { type: 'text'; value: string; placeholder?: string }
  | { type: 'select'; value: string; options: Option[] }
  | { type: 'action'; action: string; onClick?: () => void })
export type SettingsSection = { id: string; label: string; icon: IconName; description?: string; rows: SettingsRow[] }

/**
 * Settings page: section nav on the left (pill slides; ↑/↓, Home/End move between sections), the panel
 * slides in from the direction you moved. Every change autosaves: toggles and selects at once, text
 * after a pause or on blur, then a "Saved ✓" flash instead of a Save button. Under ~600px the nav becomes
 * a scrolling row (←/→) with edge fades, keeping the open section in view. `onSave` may return a promise; the flash waits for it.
 */
export function SettingsPage({ sections, section, defaultSection, onSectionChange, onSave, className }:
  { sections: SettingsSection[]; section?: string; defaultSection?: string; onSectionChange?: (id: string) => void
    onSave?: (rowId: string, value: SettingsValue) => void | Promise<void>; className?: string }) {
  const [cur, setCur] = useControllable(section, defaultSection ?? sections[0]?.id, onSectionChange)
  const [vals, setVals] = useState<Record<string, SettingsValue>>(() => Object.fromEntries(sections.flatMap(s => s.rows.filter(r => r.type !== 'action').map(r => [r.id, (r as { value: SettingsValue }).value]))))
  const [dir, setDir] = useState(0)
  const [flash, setFlash] = useState(0)
  const [flashOn, setFlashOn] = useState(false)
  const timers = useRef<Record<string, number>>({})
  /** debounced text values not saved yet, by row id */
  const pending = useRef<Record<string, SettingsValue>>({})
  const save = useRef(onSave)
  useLayoutEffect(() => { save.current = onSave })
  const navRefs = useRef<(HTMLButtonElement | null)[]>([])
  const [wrap, w] = useWidth<HTMLDivElement>()
  const row = w !== 0 && w < 600
  const group = useId()
  const i = Math.max(0, sections.findIndex(s => s.id === cur)), sec = sections[i]
  const [navEdges, edges] = useScrollEdges<HTMLElement>()
  const navEl = useRef<HTMLElement | null>(null)
  useEffect(() => { // the row scrolls: keep the open section in view (scrolling the strip only, never the page)
    const el = navEl.current, t = navRefs.current[i]; if (!row || !el || !t) return
    if (t.offsetLeft < el.scrollLeft) el.scrollLeft = t.offsetLeft - 24
    else if (t.offsetLeft + t.offsetWidth > el.scrollLeft + el.clientWidth) el.scrollLeft = t.offsetLeft + t.offsetWidth - el.clientWidth + 24
  }, [i, row])
  useEffect(() => () => { // leaving the page: stop the timers, but save what was still waiting for its pause
    Object.values(timers.current).forEach(clearTimeout)
    Object.entries(pending.current).forEach(([id, v]) => { void save.current?.(id, v) })
    pending.current = {}
  }, [])

  const select = (n: number, focus = false) => {
    if (n === i) return
    setDir(Math.sign(n - i)); setCur(sections[n].id)
    if (focus) navRefs.current[n]?.focus()
  }
  // ↑ / ↓ (and ← / → when the nav is a row), Home / End
  const nav = useRoving(sections.length, n => select(n), { orientation: row ? 'both' : 'vertical', index: i, onMove: n => select(n, true) })
  const saved = async (id: string, v: SettingsValue) => {
    await onSave?.(id, v)
    setFlash(f => f + 1); setFlashOn(true)
    clearTimeout(timers.current.__flash); timers.current.__flash = window.setTimeout(() => setFlashOn(false), 1400)
  }
  const change = (id: string, v: SettingsValue, delay = 0) => {
    setVals(x => ({ ...x, [id]: v }))
    clearTimeout(timers.current[id])
    if (!delay) { delete pending.current[id]; saved(id, v); return }
    pending.current[id] = v
    timers.current[id] = window.setTimeout(() => { delete timers.current[id]; delete pending.current[id]; saved(id, v) }, delay)
  }
  const flush = (id: string) => {
    if (!(id in pending.current)) return
    const v = pending.current[id]
    clearTimeout(timers.current[id]); delete timers.current[id]; delete pending.current[id]; saved(id, v)
  }

  return (
    <div ref={wrap} className={cn(surface.card, 'grid min-h-[400px] overflow-hidden', row ? 'grid-cols-1' : 'grid-cols-[200px_minmax(0,1fr)]', className)}>
      <div className={cn('relative min-w-0', row ? 'border-b border-[var(--line)]' : 'border-r border-[var(--line)]')}>
      <nav ref={el => { navEl.current = el; navEdges(el) }} aria-label="Settings sections" onKeyDown={nav.onKeyDown} role="tablist" aria-orientation={row ? 'horizontal' : 'vertical'}
        className={cn('flex h-full gap-0.5 bg-[color-mix(in_srgb,var(--muted)_35%,var(--card))] p-2.5', row ? 'flex-row overflow-x-auto overscroll-x-contain [scrollbar-width:none] [&::-webkit-scrollbar]:hidden' : 'flex-col')}>
        {sections.map((s, k) => (
          <button key={s.id} ref={el => { navRefs.current[k] = el }} role="tab" aria-selected={k === i} tabIndex={k === i ? 0 : -1} onClick={() => select(k)}
            className={cn('relative flex h-[34px] flex-none cursor-pointer items-center gap-2.5 rounded-[var(--r-md)] border-0 bg-transparent px-2.5 text-left text-[13px] whitespace-nowrap transition-colors',
              k === i ? 'font-medium text-[var(--fg)]' : 'text-[var(--fg2)] hover:text-[var(--fg)]')}>
            {k === i && <ActiveIndicator group={group} className="rounded-[var(--r-md)] bg-[var(--card)] shadow-[0_1px_3px_rgba(0,0,0,.08),0_0_0_1px_var(--line)]" />}
            <Icon name={s.icon} size={15} className="relative" /><span className="relative">{s.label}</span>
          </button>
        ))}
      </nav>
      {row && <ScrollEdges {...edges} hint={null} />}
      </div>
      <div className={cn('relative min-w-0 overflow-hidden', row ? 'px-4 py-4' : 'px-6 py-5')} role="tabpanel" aria-label={sec?.label}>
        <span aria-live="polite" className={cn('absolute', row ? 'top-5 right-4' : 'top-6 right-6')}>
          <AnimatePresence>
            {flashOn && <motion.span key={flash} initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, transition: { duration: 0.3 } }} transition={{ duration: 0.2 }}
              className="absolute right-0 text-xs whitespace-nowrap text-[var(--ok)]">Saved ✓</motion.span>}
          </AnimatePresence>
        </span>
        {sec && (
          <motion.div key={sec.id} initial={dir ? { opacity: 0, x: row ? 16 * dir : 0, y: row ? 0 : 12 * dir } : false} animate={{ opacity: 1, x: 0, y: 0 }} transition={spring(0.2, 0.35)}>
            <h4 className="m-0 mb-1 pr-20 text-base font-semibold">{sec.label}</h4>
            {sec.description && <p className="m-0 mb-4 text-[13px] text-[var(--fg3)]">{sec.description}</p>}
            {sec.rows.map(r => {
              const text = <span className="block min-w-0"><b className="block text-[13px] font-medium">{r.label}</b>{r.description && <span className="mt-0.5 block text-xs text-[var(--fg3)]">{r.description}</span>}</span>
              if (r.type === 'toggle') return <div key={r.id} className="border-b border-[var(--line)] py-3 last:border-0"><Switch label={text} checked={!!vals[r.id]} onChange={v => change(r.id, v)} /></div>
              return (
                <div key={r.id} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b border-[var(--line)] py-3 last:border-0">
                  {text}
                  {r.type === 'text' && <Input value={String(vals[r.id] ?? '')} placeholder={r.placeholder} aria-label={r.label} className={cn('max-w-full [@media(pointer:coarse)]:!h-10', row ? '!w-full' : '!w-[220px]')}
                    onChange={e => change(r.id, e.target.value, 700)} onBlur={() => flush(r.id)} />}
                  {r.type === 'select' && <Select aria-label={r.label} value={String(vals[r.id])} options={r.options} onChange={v => change(r.id, v)} className={cn('[@media(pointer:coarse)]:[&>button]:!h-10', row ? '!w-full' : '!w-[180px]')} />}
                  {r.type === 'action' && <Button size="sm" onClick={r.onClick} className={TOUCH.tap36}>{r.action}</Button>}
                </div>
              )
            })}
          </motion.div>
        )}
      </div>
    </div>
  )
}

/* ── Profile ───────────────────────────────────────────────────────────── */

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
  return (
    <div className={cn(surface.card, 'overflow-hidden', className)}>
      <div className="h-[110px] bg-[linear-gradient(120deg,color-mix(in_srgb,var(--accent)_80%,#000),var(--c4)_60%,var(--c3))]" />
      <div className="px-4 pb-4">
        <div className="-mt-9 flex items-end justify-between">
          <Avatar name={name} size={76} className="!border-4" />
          <div className="flex gap-2">
            <IconButton icon="message" label={`Message ${name}`} variant="default" size="sm" className={cn('!w-[30px] !px-0 [@media(pointer:coarse)]:!w-10', TOUCH.row)} onClick={onMessage} />
            <motion.span key={String(on)} initial={{ scale: 0.92 }} animate={{ scale: 1 }} transition={spring(0.5, 0.35)} className="inline-flex">
              <Button size="sm" variant={on ? 'default' : 'primary'} aria-pressed={on} onClick={toggle} className={cn('min-w-[96px] [@media(pointer:coarse)]:px-4', TOUCH.row)}>

                {on ? <><Icon name="check" size={13} strokeWidth={2.6} />Following</> : 'Follow'}
              </Button>
            </motion.span>
          </div>
        </div>
        <div className="mt-2">
          <div className="flex items-center gap-2"><b className="text-base">{name}</b>{pro && <Badge tone="accent">Pro</Badge>}</div>
          {bio && <p className="m-0 mt-1 text-[13px] text-[var(--fg2)]">{bio}</p>}
        </div>
        <div className="mt-3 mb-1 flex flex-wrap gap-5 text-[13px] text-[var(--fg2)]">
          <span className="flex items-baseline gap-1" title={`${count.toLocaleString(LOCALE)} followers`}><AnimatedNumber value={count} format={{ notation: 'compact', maximumFractionDigits: 1 }} className="font-[family-name:var(--font)] text-sm font-semibold tabular-nums text-[var(--fg)]" />followers</span>
          <span className="flex items-baseline gap-1"><b className="text-sm tabular-nums text-[var(--fg)]">{following.toLocaleString(LOCALE)}</b>following</span>
          <span className="flex items-baseline gap-1"><b className="text-sm tabular-nums text-[var(--fg)]">{projects}</b>projects</span>
        </div>
        {tabs && <Tabs items={tabs} className="mt-2.5 [&_[role=tabpanel]]:min-h-[90px] [&_[role=tabpanel]]:text-[var(--fg2)]" />}
      </div>
    </div>
  )
}

/* ── Onboarding checklist ──────────────────────────────────────────────── */

export type OnboardingTask = { id: string; label: string; /** e.g. "~2 min"; replaced by "Done" once ticked */ estimate?: string }

/**
 * Onboarding checklist: a progress ring with the percentage, "n of 5 complete", rows you tick off
 * (Space / Enter too) with time estimates that turn into "Done", and confetti plus a toast at 100%.
 * `value` / `defaultValue` are the ids that are done.
 */
export function OnboardingChecklist({ tasks, value, defaultValue = [], onChange, title = 'Get set up', onComplete, className }:
  { tasks: OnboardingTask[]; value?: string[]; defaultValue?: string[]; onChange?: (done: string[]) => void; title?: string; onComplete?: () => void; className?: string }) {
  const [done, setDone] = useControllable(value, defaultValue, onChange)
  const ring = useRef<HTMLDivElement>(null)
  const toast = useToast()
  const n = tasks.filter(t => done.includes(t.id)).length, p = tasks.length ? n / tasks.length : 0, all = n === tasks.length && n > 0
  const R = 22, C = 2 * Math.PI * R
  const toggle = (id: string) => {
    const next = done.includes(id) ? done.filter(d => d !== id) : [...done, id]
    setDone(next)
    if (tasks.every(t => next.includes(t.id))) {
      const r = ring.current?.getBoundingClientRect()
      if (r) confetti({ x: r.left + r.width / 2, y: r.top + r.height / 2, count: 100 })
      toast({ title: 'Setup complete', description: 'You’re ready to go' }); onComplete?.()
    }
  }
  return (
    <div className={cn('flex flex-col gap-3', className)}>
      <div className="flex items-center gap-3">
        <motion.div ref={ring} key={String(all)} initial={all ? { scale: 0.85 } : false} animate={{ scale: 1 }} transition={spring(0.6, 0.5)}
          className="relative grid h-14 w-14 flex-none place-items-center" role="progressbar" aria-valuenow={Math.round(p * 100)} aria-valuemin={0} aria-valuemax={100} aria-label={title}>
          <svg width="56" height="56" viewBox="0 0 56 56" className="absolute inset-0 -rotate-90">
            <circle cx="28" cy="28" r={R} fill="none" stroke="var(--muted)" strokeWidth="6" />
            <motion.circle cx="28" cy="28" r={R} fill="none" stroke="var(--ok)" strokeWidth="6" strokeLinecap="round" strokeDasharray={C}
              initial={false} animate={{ strokeDashoffset: C * (1 - p) }} transition={spring(0.1, 0.55)} />
          </svg>
          <AnimatedNumber value={p} format={{ style: 'percent' }} className="relative text-xs font-semibold" />
        </motion.div>
        <div className="min-w-0">
          <b className="block text-sm">{title}</b>
          <AnimatePresence mode="wait" initial={false}>
            <motion.span key={String(all)} initial={{ opacity: 0, y: 3 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -3 }} transition={{ duration: 0.15 }} aria-live="polite"
              className={cn('block text-xs', all ? 'font-medium text-[var(--ok)]' : 'text-[var(--fg3)]')}>
              {all ? 'All done. Nice work! 🎉' : <>{n} of {tasks.length} complete</>}
            </motion.span>
          </AnimatePresence>
        </div>
      </div>
      <div className="flex flex-col gap-2">
        {tasks.map(t => {
          const on = done.includes(t.id)
          return (
            <div key={t.id} role="checkbox" aria-checked={on} tabIndex={0} onClick={() => toggle(t.id)} onKeyDown={e => { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); toggle(t.id) } }}
              className={cn(surface.md, 'flex cursor-pointer items-center gap-2.5 bg-transparent px-3 py-2.5 text-[13px] transition-colors select-none hover:bg-[var(--muted)] focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--accent)]')}>
              <CheckboxBox checked={on} className={cn(on && '!border-[var(--ok)] !bg-[var(--ok)] !text-[var(--card)]')} />
              <span className={cn('flex-1 transition-colors', on && 'text-[var(--fg3)] line-through')}>{t.label}</span>
              <span className={cn('text-xs', on ? 'text-[var(--ok)]' : 'text-[var(--fg3)]')}>{on ? 'Done' : t.estimate ?? ''}</span>
            </div>
          )
        })}
      </div>
    </div>
  )
}
