import { useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { AnimatedNumber, Badge, Button, Icon, cn, fmt, spring, surface, SegmentedControl } from '../lib'

/* Pricing table: plans with a monthly / yearly switch.
   Copy-in block (registry: `registry:block`), not part of the npm API: copy it into your app and edit freely. It builds
   on the library through `../lib` (in your app: `@lyndon/ui`). */

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
