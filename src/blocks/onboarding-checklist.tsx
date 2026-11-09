import { useRef } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { AnimatedNumber, cn, defineMessages, spring, surface, useControllable, useMessages, CheckboxBox, confetti, useToast } from '../lib'

/* Onboarding checklist: tasks with progress and a celebration when done.
   Copy-in block (registry: `registry:block`), not part of the npm API: copy it into your app and edit freely. It builds
   on the library through `../lib` (in your app: `@lyndon/ui`). */

/* Strings: English plus machine-drafted German and Arabic (have them reviewed). */
const OB_MSG = defineMessages('onboarding', {
  en: { setUp: 'Get set up', complete: 'Setup complete', ready: 'You’re ready to go', allDone: 'All done. Nice work! 🎉', progress: '{n} of {total} complete', done: 'Done' },
  de: { setUp: 'Einrichten', complete: 'Einrichtung abgeschlossen', ready: 'Alles bereit', allDone: 'Alles erledigt. Gut gemacht! 🎉', progress: '{n} von {total} erledigt', done: 'Erledigt' },
  ar: { setUp: 'ابدأ الإعداد', complete: 'اكتمل الإعداد', ready: 'أنت جاهز للانطلاق', allDone: 'تم كل شيء. أحسنت! 🎉', progress: '{n} من {total} مكتملة', done: 'تم' },
})

/* ── Onboarding checklist ──────────────────────────────────────────────── */

export type OnboardingTask = { id: string; label: string; /** e.g. "~2 min"; replaced by "Done" once ticked */ estimate?: string }

/**
 * Onboarding checklist: a progress ring with the percentage, "n of 5 complete", rows you tick off
 * (Space / Enter too) with time estimates that turn into "Done", and confetti plus a toast at 100%.
 * `value` / `defaultValue` are the ids that are done.
 */
export function OnboardingChecklist({ tasks, value, defaultValue = [], onChange, title: titleProp, onComplete, className }:
  { tasks: OnboardingTask[]; value?: string[]; defaultValue?: string[]; onChange?: (done: string[]) => void; title?: string; onComplete?: () => void; className?: string }) {
  const [done, setDone] = useControllable(value, defaultValue, onChange)
  const tm = useMessages(OB_MSG), title = titleProp ?? tm('setUp')
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
      toast({ title: tm('complete'), description: tm('ready') }); onComplete?.()
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
              {all ? tm('allDone') : tm('progress', { n, total: tasks.length })}
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
              <span className={cn('text-xs', on ? 'text-[var(--ok)]' : 'text-[var(--fg3)]')}>{on ? tm('done') : t.estimate ?? ''}</span>

            </div>
          )
        })}
      </div>
    </div>
  )
}
