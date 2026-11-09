import { useEffect, useRef, useState, type ReactNode } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { AnimatedNumber, Button, Icon, TOUCH, cn, defineMessages, dirX, spring, surface, useLocale, useMessages, useWidth, shake, Field, Input, NumberStepper, Select, Steps, Collapse, confetti } from '../lib'

/* Checkout: cart, details and payment steps with an order summary.
   Copy-in block (registry: `registry:block`), not part of the npm API: copy it into your app and edit freely. It builds
   on the library through `../lib` (in your app: `@lyndon/ui`). */

/* Strings: English plus machine-drafted German and Arabic (have them reviewed). Edit them here, or override any key with
   `<UIProvider messages={{ 'checkout.pay': … }}>`. */
const CO_MSG = defineMessages('checkout', {
  en: {
    stepCart: 'Cart', stepDetails: 'Details', stepPayment: 'Payment', paid: 'Payment successful', receipt: '{amount} paid · receipt sent to {email}', startOver: 'Start over',
    promoApplied: '{percent} off applied', promoInvalid: 'That code isn’t valid', promoEmpty: 'Enter a promo code',
    cardFull: 'Enter the full card number', expFormat: 'Use MM / YY', expired: 'This card has expired', cvcFront: '4 digits on the front', cvcBack: '3 digits on the back',
    qty: '{name} quantity', toDetails: 'Continue to details', fullName: 'Full name', email: 'Email', emailErr: 'Enter a valid email, like name@company.com',
    address: 'Company address', vat: 'VAT number', country: 'Country', toPayment: 'Continue to payment', cardNumber: 'Card number', expiry: 'Expiry', expiryMask: 'MM / YY', cvc: 'CVC',
    demo: 'Demo only: nothing is charged and nothing leaves the page.', processing: 'Processing', pay: 'Pay', summary: 'Order summary', subtotal: 'Subtotal',
    promo: 'Promo {code}', vatLine: 'VAT {rate}', total: 'Total', promoCode: 'Promo code', apply: 'Apply',
  },
  de: {
    stepCart: 'Warenkorb', stepDetails: 'Angaben', stepPayment: 'Zahlung', paid: 'Zahlung erfolgreich', receipt: '{amount} bezahlt · Beleg an {email} gesendet', startOver: 'Von vorn beginnen',
    promoApplied: '{percent} Rabatt angewendet', promoInvalid: 'Dieser Code ist ungültig', promoEmpty: 'Gutscheincode eingeben',
    cardFull: 'Vollständige Kartennummer eingeben', expFormat: 'Format MM / JJ', expired: 'Diese Karte ist abgelaufen', cvcFront: '4 Ziffern auf der Vorderseite', cvcBack: '3 Ziffern auf der Rückseite',
    qty: 'Menge {name}', toDetails: 'Weiter zu den Angaben', fullName: 'Vollständiger Name', email: 'E-Mail', emailErr: 'Gültige E-Mail eingeben, z. B. name@firma.de',
    address: 'Firmenadresse', vat: 'USt-IdNr.', country: 'Land', toPayment: 'Weiter zur Zahlung', cardNumber: 'Kartennummer', expiry: 'Ablaufdatum', expiryMask: 'MM / JJ', cvc: 'Prüfnummer',
    demo: 'Nur eine Demo: Es wird nichts belastet und nichts verlässt die Seite.', processing: 'Wird verarbeitet', pay: 'Bezahlen', summary: 'Bestellübersicht', subtotal: 'Zwischensumme',
    promo: 'Gutschein {code}', vatLine: 'MwSt. {rate}', total: 'Gesamt', promoCode: 'Gutscheincode', apply: 'Anwenden',
  },
  ar: {
    stepCart: 'السلة', stepDetails: 'التفاصيل', stepPayment: 'الدفع', paid: 'تم الدفع بنجاح', receipt: 'تم دفع {amount} · أُرسل الإيصال إلى {email}', startOver: 'البدء من جديد',
    promoApplied: 'تم تطبيق خصم {percent}', promoInvalid: 'هذا الرمز غير صالح', promoEmpty: 'أدخل رمزًا ترويجيًا',
    cardFull: 'أدخل رقم البطاقة كاملًا', expFormat: 'استخدم الشكل MM / YY', expired: 'انتهت صلاحية هذه البطاقة', cvcFront: '٤ أرقام على الوجه', cvcBack: '٣ أرقام على الظهر',
    qty: 'كمية {name}', toDetails: 'المتابعة إلى التفاصيل', fullName: 'الاسم الكامل', email: 'البريد الإلكتروني', emailErr: 'أدخل بريدًا إلكترونيًا صالحًا، مثل name@company.com',
    address: 'عنوان الشركة', vat: 'رقم ضريبة القيمة المضافة', country: 'الدولة', toPayment: 'المتابعة إلى الدفع', cardNumber: 'رقم البطاقة', expiry: 'تاريخ الانتهاء', expiryMask: 'MM / YY', cvc: 'رمز التحقق',
    demo: 'عرض تجريبي فقط: لا يُخصم أي مبلغ ولا يغادر شيء الصفحة.', processing: 'جارٍ المعالجة', pay: 'ادفع', summary: 'ملخص الطلب', subtotal: 'المجموع الفرعي',
    promo: 'رمز ترويجي {code}', vatLine: 'ضريبة القيمة المضافة {rate}', total: 'الإجمالي', promoCode: 'الرمز الترويجي', apply: 'تطبيق',
  },
})

const pagesSlide = {
  enter: (d: number) => ({ opacity: 0, x: 20 * d }),
  center: { opacity: 1, x: 0 },
  exit: (d: number) => ({ opacity: 0, x: -20 * d, transition: { duration: 0.14 } }),
}

/* ── Checkout ──────────────────────────────────────────────────────────── */

export type CheckoutItem = { id: string; name: string; detail: string; price: number; qty: number; /** CSS background for the thumbnail */ swatch?: string }
export type CheckoutDetails = { name: string; email: string; address: string; vat: string; country: string }

const CO_STEPS = ['stepCart', 'stepDetails', 'stepPayment'] as const
const coDigits = (v: string) => v.replace(/\D/g, '')
const coIsAmex = (d: string) => /^3[47]/.test(d)
const coBrand = (d: string) => /^4/.test(d) ? { name: 'VISA', bg: '#1A1F71' } : /^(5[1-5]|2[2-7])/.test(d) ? { name: 'Mastercard', bg: '#EB001B' } : coIsAmex(d) ? { name: 'Amex', bg: '#2E77BC' } : null
const coFormatCard = (d: string) => coIsAmex(d) ? [d.slice(0, 4), d.slice(4, 10), d.slice(10, 15)].filter(Boolean).join(' ') : d.replace(/(.{4})/g, '$1 ').trim()
const coFormatExp = (raw: string) => { let d = coDigits(raw).slice(0, 4); if (/^[2-9]$/.test(d)) d = '0' + d; return d.length > 2 ? `${d.slice(0, 2)} / ${d.slice(2)}` : d }

function CheckoutDone({ email, total, currency, onRestart }: { email: string; total: number; currency: string; onRestart: () => void }) {
  const ring = useRef<HTMLSpanElement>(null), tm = useMessages(CO_MSG), { fmt } = useLocale()
  useEffect(() => {
    const t = setTimeout(() => { const r = ring.current?.getBoundingClientRect(); if (r) confetti({ x: r.left + r.width / 2, y: r.top + r.height / 2, count: 90 }) }, 120)
    return () => clearTimeout(t)
  }, [])
  return (
    <div className="flex min-h-[250px] flex-col items-center justify-center gap-2.5 text-center" role="status">
      <motion.span ref={ring} initial={{ scale: 0.4 }} animate={{ scale: 1 }} transition={spring(0.5, 0.5)} className="grid h-16 w-16 place-items-center rounded-full bg-[var(--ok-soft)] text-[var(--ok)]">
        <Icon name="check" size={30} strokeWidth={2.6} />
      </motion.span>
      <b className="text-base">{tm('paid')}</b>
      <span className="text-[13px] text-[var(--fg2)]">{tm('receipt', { amount: fmt.money(total, currency), email })}</span>
      <Button size="sm" onClick={onRestart}><Icon name="refresh" size={13} />{tm('startOver')}</Button>
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
  const tm = useMessages(CO_MSG), { t, fmt, dir: textDir } = useLocale()
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
    if (r) { setPromo({ code: v, rate: r }); setPromoMsg({ ok: true, text: tm('promoApplied', { percent: fmt.percent(r, 0) }) }) }
    else { setPromoMsg({ ok: false, text: v ? tm('promoInvalid') : tm('promoEmpty') }); shake(q('[data-co-promo]'), 5) }
  }
  const toPayment = () => {
    if (!/^\S+@\S+\.\S+$/.test(det.email)) { setEmailErr(true); shake(q('#co-email'), 5); (q('#co-email') as HTMLInputElement | null)?.focus(); return }
    go(2)
  }
  const pay = () => {
    const d = coDigits(card), e = coDigits(exp), mm = +e.slice(0, 2), yy = +e.slice(2), now = new Date(), err: typeof payErr = {}
    if (d.length < (coIsAmex(d) ? 15 : 16)) err.card = tm('cardFull')
    if (e.length < 4 || mm < 1 || mm > 12) err.exp = tm('expFormat')
    else if (2000 + yy < now.getFullYear() || (2000 + yy === now.getFullYear() && mm < now.getMonth() + 1)) err.exp = tm('expired')
    if (cvc.length < (coIsAmex(d) ? 4 : 3)) err.cvc = coIsAmex(d) ? tm('cvcFront') : tm('cvcBack')
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
      {back && <Button onClick={() => go(step - 1)}>{t('common.back')}</Button>}{next}
    </div>
  )

  const panes = [
    <div className="flex flex-col gap-3">
      <ul className="m-0 list-none p-0">
        {items.map(it => (
          <li key={it.id} className="flex flex-wrap items-center gap-3 border-b border-[var(--line)] py-2.5 text-[13px]">
            <i className="h-11 w-11 flex-none rounded-[var(--r-md)]" style={{ background: it.swatch ?? 'var(--muted)' }} />
            <div className="min-w-[120px] flex-1"><b className="block font-medium">{it.name}</b><span className="text-xs text-[var(--fg3)]">{it.detail}</span></div>
            <NumberStepper value={it.qty} min={1} max={20} label={tm('qty', { name: it.name })} onChange={n => setItems(l => l.map(x => x.id === it.id ? { ...x, qty: n } : x))} />
            <AnimatedNumber value={it.price * it.qty} format={{ ...money, maximumFractionDigits: 0 }} className="min-w-[80px] justify-end font-medium" />
          </li>
        ))}
      </ul>
      {nav(false, <Button variant="primary" onClick={() => go(1)}>{tm('toDetails')}</Button>)}
    </div>,
    <div className="flex flex-col gap-3">
      <div className={cn('grid gap-2.5', wide ? 'grid-cols-2' : 'grid-cols-1')}>
        <Field label={tm('fullName')} htmlFor="co-name"><Input id="co-name" value={det.name} onChange={e => setDet({ ...det, name: e.target.value })} autoComplete="name" /></Field>
        <Field label={tm('email')} htmlFor="co-email" error={emailErr ? tm('emailErr') : undefined}>
          <Input id="co-email" type="email" value={det.email} aria-invalid={emailErr || undefined} onChange={e => { setDet({ ...det, email: e.target.value }); setEmailErr(false) }} autoComplete="email" />
        </Field>
        <Field label={tm('address')} htmlFor="co-addr" className="col-span-full"><Input id="co-addr" value={det.address} onChange={e => setDet({ ...det, address: e.target.value })} /></Field>
        <Field label={tm('vat')} htmlFor="co-vat" hint={t('common.optional')}><Input id="co-vat" value={det.vat} placeholder="CHE-123.456.789" /* i18n-ignore: a sample number */ onChange={e => setDet({ ...det, vat: e.target.value })} /></Field>
        <Field label={tm('country')}><Select aria-label={tm('country')} value={det.country} onChange={v => setDet({ ...det, country: v })} options={countries.map(c => ({ value: c, label: c }))} /></Field>
      </div>
      {nav(true, <Button variant="primary" onClick={toPayment}>{tm('toPayment')}</Button>)}
    </div>,
    <div className="flex flex-col gap-3">
      <Field label={tm('cardNumber')} htmlFor="co-card" error={payErr.card}>
        <div className="relative">
          <Input id="co-card" inputMode="numeric" autoComplete="off" placeholder="1234 1234 1234 1234" value={card} aria-invalid={!!payErr.card || undefined}
            onChange={e => { const d = coDigits(e.target.value); setCard(coFormatCard(d.slice(0, coIsAmex(d) ? 15 : 16))); setPayErr(p => ({ ...p, card: undefined })) }}
            className="pe-24 font-[family-name:var(--mono)] tracking-wide" />
          <AnimatePresence>
            {brand && (
              <motion.span key={brand.name} initial={{ opacity: 0, scale: 0.7 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.7, transition: { duration: 0.1 } }} transition={spring(0.5, 0.3)}
                className="absolute top-1/2 end-2.5 -mt-[10px] rounded-[var(--r-sm)] px-1.5 py-[3px] font-[family-name:var(--mono)] text-[11px] leading-[14px] font-bold tracking-wider text-white uppercase" style={{ background: brand.bg }}>
                {brand.name}
              </motion.span>
            )}
          </AnimatePresence>
        </div>
      </Field>
      <div className="grid grid-cols-2 gap-2.5">
        <Field label={tm('expiry')} htmlFor="co-exp" error={payErr.exp}>
          <Input id="co-exp" inputMode="numeric" placeholder={tm('expiryMask')} value={exp} aria-invalid={!!payErr.exp || undefined} className="font-[family-name:var(--mono)]"
            onChange={e => { const v = e.target.value; setExp(v.length < exp.length && exp.endsWith(' / ') ? v : coFormatExp(v)); setPayErr(p => ({ ...p, exp: undefined })) }} />
        </Field>
        <Field label={tm('cvc')} htmlFor="co-cvc" error={payErr.cvc}>
          <Input id="co-cvc" inputMode="numeric" placeholder="123" value={cvc} aria-invalid={!!payErr.cvc || undefined} className="font-[family-name:var(--mono)]"
            onChange={e => { setCvc(coDigits(e.target.value).slice(0, 4)); setPayErr(p => ({ ...p, cvc: undefined })) }} />
        </Field>
      </div>
      <p className="m-0 text-xs text-[var(--fg3)]">{tm('demo')}</p>
      {nav(true, <Button variant="primary" loading={paying} onClick={pay}>{paying ? tm('processing') : <>{tm('pay')} <AnimatedNumber value={total} format={money} /></>}</Button>)}
    </div>,
    <CheckoutDone email={det.email} total={total} currency={currency} onRestart={restart} />,
  ]

  return (
    <div ref={el => { wrap.current = el; root.current = el }} className={cn('grid gap-4', wide ? 'grid-cols-[minmax(0,1fr)_300px]' : 'grid-cols-1', className)}>
      <div className={cn(surface.card, 'flex min-w-0 flex-col gap-4 p-4')}>
        <Steps steps={CO_STEPS.map(k => tm(k))} current={step} />
        <div className="relative min-h-[250px] overflow-clip [overflow-clip-margin:8px]">
          {/* the next step slides in from the inline end (the left in RTL) */}
          <AnimatePresence mode="wait" initial={false} custom={dirX(dir, textDir)}>
            <motion.div key={step} custom={dirX(dir, textDir)} variants={pagesSlide} initial="enter" animate="center" exit="exit" transition={spring(0.2, 0.35)}>{panes[step]}</motion.div>
          </AnimatePresence>
        </div>
      </div>
      <aside aria-label={tm('summary')} className={cn(surface.card, 'flex flex-col gap-2.5 self-start !bg-[color-mix(in_srgb,var(--muted)_40%,var(--card))] p-4')}>
        <h4 className="m-0 text-sm font-semibold">{tm('summary')}</h4>
        <div className={row}><span>{tm('subtotal')}</span><AnimatedNumber value={sub} format={money} /></div>
        <Collapse open={!!promo}><div className={cn(row, '!text-[var(--ok)]')}><span>{tm('promo', { code: promo?.code ?? '' })}</span><AnimatedNumber value={-disc} format={money} /></div></Collapse>
        <div className={row}><span>{tm('vatLine', { rate: fmt.percent(vatRate, 2) })}</span><AnimatedNumber value={tax} format={money} /></div>
        <div className="flex justify-between border-t border-[var(--line)] pt-2.5 text-sm font-semibold"><span>{tm('total')}</span><AnimatedNumber value={total} format={money} className="font-[family-name:var(--font)] tabular-nums" /></div>
        <form className="flex gap-1.5" data-co-promo onSubmit={e => { e.preventDefault(); apply() }}>
          <Input value={code} onChange={e => { setCode(e.target.value); if (promoMsg && !promoMsg.ok) setPromoMsg(null) }} placeholder={tm('promoCode')} aria-label={tm('promoCode')}
            aria-invalid={promoMsg?.ok === false || undefined} disabled={step === 3} className={cn('!h-8 uppercase placeholder:normal-case', TOUCH.row)} />
          <Button size="sm" type="submit" disabled={step === 3} className={cn('!h-8 flex-none', TOUCH.row)}>{tm('apply')}</Button>

        </form>
        <AnimatePresence mode="wait" initial={false}>
          {promoMsg && <motion.p key={promoMsg.text} initial={{ opacity: 0, y: -3 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.15 }} aria-live="polite"
            className={cn('m-0 text-xs', promoMsg.ok ? 'text-[var(--ok)]' : 'text-[var(--bad)]')}>{promoMsg.text}</motion.p>}
        </AnimatePresence>
      </aside>
    </div>
  )
}
