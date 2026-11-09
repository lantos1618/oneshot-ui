import { useState, type ReactNode } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { Button, Icon, cn, floatingSurface, spring, Switch, Collapse, useLocale } from '../lib'

/* Cookie consent banner where rejecting is as easy as accepting.
   Copy-in block (registry: `registry:block`), not part of the npm API: copy it into your app and edit freely. It builds
   on the library through `../lib` (in your app: `@lyndon/ui`). */

export type CookieCategory = { id: string; label: string; description: string; required?: boolean; defaultOn?: boolean }
export type CookieChoice = { kind: 'accept' | 'reject' | 'custom'; allowed: Record<string, boolean> }

/**
 * Cookie banner where rejecting is as easy as accepting. "Customise" expands the per-category
 * switches in place (required ones are locked on) and becomes "Save choices". Slides up when `open`.
 * Place it inside a relative container (it sits at the bottom edge) or pass `className` to position it.
 */
export function CookieConsent({ categories, open, onDecision, title, description, className }:
  { categories: CookieCategory[]; open: boolean; onDecision: (c: CookieChoice) => void; title?: ReactNode; description?: ReactNode; className?: string }) {
  const [custom, setCustom] = useState(false)
  const { t } = useLocale() // the built-in catalog has these strings (feedback.cookie…, translated in UI_MESSAGES_DE / _AR)
  const [on, setOn] = useState<Record<string, boolean>>(() => Object.fromEntries(categories.map(c => [c.id, !!(c.required || c.defaultOn)])))
  const all = (v: boolean) => Object.fromEntries(categories.map(c => [c.id, c.required ? true : v]))
  const decide = (kind: CookieChoice['kind']) => { setCustom(false); onDecision({ kind, allowed: kind === 'custom' ? on : all(kind === 'accept') }) }
  return (
    <AnimatePresence>
      {open && (
        <motion.div role="dialog" aria-label={t('feedback.cookieConsent')} initial={{ y: 40, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 30, opacity: 0, transition: { duration: 0.2 } }}
          transition={spring(0.25, 0.4)} className={cn(floatingSurface, 'absolute inset-x-2 bottom-2 z-10 rounded-[var(--r-md)] p-3 text-[13px]', className)}>
          <b className="font-semibold">{title ?? t('feedback.cookieTitle')}</b>
          <p className="m-0 mt-0.5 mb-2.5 text-xs text-[var(--fg3)]">{description ?? t('feedback.cookieBody')}</p>
          <Collapse open={custom}>
            <div className="mb-2">
              {categories.map(c => (
                <div key={c.id} className="border-b border-[var(--line)] py-2">
                  <Switch checked={on[c.id]} disabled={c.required} onChange={v => setOn(o => ({ ...o, [c.id]: v }))}
                    label={<span><b className="block text-[13px] font-medium">{c.label}{c.required && <Icon name="lock" size={11} className="ms-1 inline text-[var(--fg3)]" />}</b><span className="block text-xs text-[var(--fg3)]">{c.description}</span></span>} />
                </div>
              ))}
            </div>
          </Collapse>
          <div className="flex flex-wrap justify-end gap-1.5">
            <Button size="sm" variant="ghost" aria-expanded={custom} onClick={() => custom ? decide('custom') : setCustom(true)}>{custom ? t('feedback.saveChoices') : t('feedback.customise')}</Button>
            <Button size="sm" onClick={() => decide('reject')}>{t('feedback.rejectAll')}</Button>
            <Button size="sm" variant="primary" onClick={() => decide('accept')}>{t('feedback.acceptAll')}</Button>

          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
