import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { ActiveIndicator, Button, FLASH_MS, Icon, type IconName, Input, type Option, ScrollEdges, Select, Switch, TOUCH, cn, spring, surface, useControllable, useFlash, useLatest, useRoving, useScrollEdges, useWidth } from '../lib'

export type SettingsValue = boolean | string
export type SettingsRow = { id: string; label: string; description?: string } & (
  | { type: 'toggle'; value: boolean }
  | { type: 'text'; value: string; placeholder?: string }
  | { type: 'select'; value: string; options: Option[] }
  | { type: 'action'; action: string; onClick?: () => void })
export type SettingsSection = { id: string; label: string; icon: IconName; description?: string; rows: SettingsRow[] }

type SettingsValueRow = Exclude<SettingsRow, { type: 'action' }>
const hasValue = (r: SettingsRow): r is SettingsValueRow => r.type !== 'action'
const errorText = (e: unknown) => e instanceof Error && e.message ? e.message : typeof e === 'string' ? e : ''
/** A confirmed save, shown until the `sections` prop moves off the value it had then. */
type SettingsKept = { v: SettingsValue; base: SettingsValue }

/**
 * Settings page: section nav at the start (pill slides; ↑/↓, Home/End move between sections), the panel
 * slides in from the direction you moved. Every change autosaves: toggles and selects at once, text
 * after a pause or on blur. Under ~600px the nav becomes a scrolling row (←/→) with edge fades, keeping the open
 * section in view.
 *
 * `onSave` may return a promise: "Saved ✓" shows once it resolves. If it throws or rejects, the row goes back to its
 * last saved value and the error is shown. The `sections` values are the saved state: when they change, they win over
 * a confirmed local save.
 */
export function SettingsPage({ sections, section, defaultSection, onSectionChange, onSave, className }:
  { sections: SettingsSection[]; section?: string; defaultSection?: string; onSectionChange?: (id: string) => void
    onSave?: (rowId: string, value: SettingsValue) => void | Promise<void>; className?: string }) {
  const [cur, setCur] = useControllable(section, defaultSection ?? sections[0]?.id, onSectionChange)
  const rows = useMemo(() => new Map(sections.flatMap(s => s.rows.filter(hasValue).map(r => [r.id, r] as const))), [sections])
  const rowsNow = useLatest(rows)
  /** edits onSave hasn't confirmed yet (waiting for their pause, or saving) */
  const [draft, setDraft] = useState<Record<string, SettingsValue>>({})
  const [kept, setKept] = useState<Record<string, SettingsKept>>({})
  const [failed, setFailed] = useState<{ id: string; text: string } | null>(null)
  const valueOf = (id: string) => {
    const prop = rows.get(id)?.value, k = kept[id]
    return id in draft ? draft[id] : k && k.base === prop ? k.v : prop
  }
  const [dir, setDir] = useState(0)
  const flashN = useRef(0)
  const [flash, setFlash] = useFlash(FLASH_MS, 0)
  /** debounce timers, by row id */
  const timers = useRef<Record<string, number>>({})
  /** debounced text values not saved yet, by row id */
  const pending = useRef<Record<string, SettingsValue>>({})
  /** the latest save per row, so an older one finishing late doesn't win */
  const seq = useRef<Record<string, number>>({})
  const save = useLatest(onSave)
  const navRefs = useRef<(HTMLButtonElement | null)[]>([])
  const [wrap, w] = useWidth<HTMLDivElement>()
  const row = w !== 0 && w < 600
  const group = useId()
  const i = Math.max(0, sections.findIndex(s => s.id === cur)), sec = sections[i]
  const [navEdges, edges] = useScrollEdges<HTMLElement>()
  const navEl = useRef<HTMLElement | null>(null)
  useEffect(() => { // the row scrolls: keep the open section in view (scrolling the strip only, never the page)
    const el = navEl.current, t = navRefs.current[i]; if (!row || !el || !t) return
    const er = el.getBoundingClientRect(), tr = t.getBoundingClientRect()
    const by = tr.left < er.left ? tr.left - er.left - 24 : tr.right > er.right ? tr.right - er.right + 24 : 0
    if (by) el.scrollLeft += by
  }, [i, row])
  useEffect(() => () => { // leaving the page: stop the timers, but save what was still waiting for its pause
    Object.values(timers.current).forEach(clearTimeout)
    const fn = save.current // a rejection here has no page left to show it on: it surfaces as unhandled
    Object.entries(pending.current).forEach(([id, v]) => { void Promise.resolve().then(() => fn?.(id, v)) })
    pending.current = {}
  }, [save])

  const select = (n: number, focus = false) => {
    if (n === i) return
    setDir(Math.sign(n - i)); setCur(sections[n].id)
    if (focus) navRefs.current[n]?.focus()
  }
  // ↑ / ↓ (and ← / → when the nav is a row), Home / End
  const nav = useRoving(sections.length, n => select(n), { orientation: row ? 'both' : 'vertical', index: i, onMove: n => select(n, true) })
  const settle = (id: string, v: SettingsValue) => setDraft(d => {
    if (d[id] !== v) return d // edited again since
    const rest = { ...d }
    delete rest[id]
    return rest
  })
  const saved = async (id: string, v: SettingsValue) => {
    const n = seq.current[id] = (seq.current[id] ?? 0) + 1
    const base = rowsNow.current.get(id)?.value
    try {
      await save.current?.(id, v)
    } catch (e) {
      if (seq.current[id] !== n) return
      settle(id, v)
      const label = rowsNow.current.get(id)?.label ?? id, why = errorText(e)
      setFailed({ id, text: `Couldn’t save ${label}${why ? `: ${why}` : '.'}` })
      return
    }
    if (seq.current[id] !== n || base === undefined) return
    setKept(k => ({ ...k, [id]: { v, base } }))
    settle(id, v)
    setFailed(f => f?.id === id ? null : f)
    if (save.current) setFlash(++flashN.current)
  }
  const change = (id: string, v: SettingsValue, delay = 0) => {
    setDraft(x => ({ ...x, [id]: v })); setFailed(f => f?.id === id ? null : f)
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
      <div className={cn('relative min-w-0', row ? 'border-b border-[var(--line)]' : 'border-e border-[var(--line)]')}>
      <nav ref={el => { navEl.current = el; navEdges(el) }} aria-label={'Settings sections'} onKeyDown={nav.onKeyDown} role="tablist" aria-orientation={row ? 'horizontal' : 'vertical'}
        className={cn('flex h-full gap-0.5 bg-[color-mix(in_srgb,var(--muted)_35%,var(--card))] p-2.5', row ? 'flex-row overflow-x-auto overscroll-x-contain [scrollbar-width:none] [&::-webkit-scrollbar]:hidden' : 'flex-col')}>
        {sections.map((s, k) => (
          <button key={s.id} ref={el => { navRefs.current[k] = el }} role="tab" aria-selected={k === i} tabIndex={k === i ? 0 : -1} onClick={() => select(k)}
            className={cn('relative flex h-[34px] flex-none cursor-pointer items-center gap-2.5 rounded-[var(--r-md)] border-0 bg-transparent px-2.5 text-start text-[13px] whitespace-nowrap transition-colors',
              k === i ? 'font-medium text-[var(--fg)]' : 'text-[var(--fg2)] hover:text-[var(--fg)]')}>
            {k === i && <ActiveIndicator group={group} className="rounded-[var(--r-md)] bg-[var(--card)] shadow-[0_1px_3px_rgba(0,0,0,.08),0_0_0_1px_var(--line)]" />}
            <Icon name={s.icon} size={15} className="relative" /><span className="relative">{s.label}</span>
          </button>
        ))}
      </nav>
      {row && <ScrollEdges {...edges} hint={null} />}
      </div>
      <div className={cn('relative min-w-0 overflow-hidden', row ? 'px-4 py-4' : 'px-6 py-5')} role="tabpanel" aria-label={sec?.label}>
        <span aria-live="polite" className={cn('absolute', row ? 'top-5 end-4' : 'top-6 end-6')}>
          <AnimatePresence>
            {flash > 0 && <motion.span key={flash} initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, transition: { duration: 0.3 } }} transition={{ duration: 0.2 }}
              className="absolute end-0 text-xs whitespace-nowrap text-[var(--ok)]">{'Saved ✓'}</motion.span>}
          </AnimatePresence>
        </span>
        {sec && (
          <motion.div key={sec.id} initial={dir ? { opacity: 0, x: row ? 16 * dir : 0, y: row ? 0 : 12 * dir } : false}
 animate={{ opacity: 1, x: 0, y: 0 }} transition={spring(0.2, 0.35)}>
            <h4 className="m-0 mb-1 pe-20 text-base font-semibold">{sec.label}</h4>
            {sec.description && <p className="m-0 mb-4 text-[13px] text-[var(--fg3)]">{sec.description}</p>}
            {failed && <p role="alert" className="m-0 mb-3 rounded-[var(--r-md)] bg-[var(--bad-soft)] px-3 py-2 text-[13px] text-[var(--bad)]">{failed.text}</p>}
            {sec.rows.map(r => {
              const text = <span className="block min-w-0"><b className="block text-[13px] font-medium">{r.label}</b>{r.description && <span className="mt-0.5 block text-xs text-[var(--fg3)]">{r.description}</span>}</span>
              if (r.type === 'toggle') return <div key={r.id} className="border-b border-[var(--line)] py-3 last:border-0"><Switch label={text} checked={!!valueOf(r.id)} onChange={v => change(r.id, v)} /></div>
              return (
                <div key={r.id} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b border-[var(--line)] py-3 last:border-0">
                  {text}
                  {r.type === 'text' && <Input value={String(valueOf(r.id) ?? '')} placeholder={r.placeholder} aria-label={r.label} className={cn('max-w-full [@media(pointer:coarse)]:!h-10', row ? '!w-full' : '!w-[220px]')}
                    onChange={e => change(r.id, e.target.value, 700)} onBlur={() => flush(r.id)} />}
                  {r.type === 'select' && <Select aria-label={r.label} value={String(valueOf(r.id) ?? '')} options={r.options} onChange={v => change(r.id, v)} className={cn('[@media(pointer:coarse)]:[&>button]:!h-10', row ? '!w-full' : '!w-[180px]')} />}
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

