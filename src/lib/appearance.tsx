import { useEffect, useRef } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { Button, FONTS, Icon, IconButton, type Palette, THEMES, type Theme, type ThemeSettings, cn, editPalette, loadFont, spring, themeCSS, themePalette, useControllable, useTheme } from './core'
import { useCopy, useToast } from './feedback'
import { SegmentedControl, Slider } from './forms'
import { Popover, PopoverContent, PopoverTrigger } from './overlay'

/** One half (or all) of a theme thumbnail: page, card, two text lines, primary button, accent dot. */
function ThemeMini({ p, clip }: { p: Palette; clip?: string }) {
  return (
    <span className="absolute inset-0 block" style={{ background: p.bg, clipPath: clip }}>
      <span className="absolute inset-2 rounded-[var(--r-sm)]" style={{ background: p.card, boxShadow: `inset 0 0 0 1px ${p.line}` }} />
      <span className="absolute top-[15px] left-[15px] h-1 w-[34%] rounded-[var(--r-sm)]" style={{ background: p.fg }} />
      <span className="absolute top-[23px] left-[15px] h-[3px] w-[48%] rounded-[var(--r-sm)] opacity-90" style={{ background: p.fg3 }} />
      <span className="absolute bottom-[14px] left-[15px] h-2 w-[22px] rounded-[var(--r-sm)]" style={{ background: p.primary }} />
      <span className="absolute right-[15px] bottom-[14px] h-2 w-2 rounded-full" style={{ background: p.accent }} />
    </span>
  )
}
const previewFrame = 'relative mb-1.5 block h-[58px] overflow-hidden rounded-[calc(var(--r-lg)-5px)] shadow-[inset_0_0_0_1px_rgba(127,127,127,.2)]'

/** Theme thumbnail split diagonally: the light palette on the left, the chosen dark palette on the right. */
export function ThemePreview({ theme, variant = 0, className }: { theme: Theme; variant?: number; className?: string }) {
  const dark = theme.dark[Math.min(variant, theme.dark.length - 1)][1]
  return (
    <span className={cn(previewFrame, className)} aria-hidden>
      <ThemeMini p={theme.light[0][1]} clip="polygon(0 0,62% 0,38% 100%,0 100%)" />
      <ThemeMini p={dark} clip="polygon(62% 0,100% 0,100% 100%,38% 100%)" />
    </span>
  )
}

/** One-click light/dark switch for the header. The new theme sweeps out from the button. */
export function ThemeToggle({ className }: { className?: string }) {
  const { dark, toggle } = useTheme()
  return (
    <Button size="icon" aria-label={dark ? 'Switch to light theme' : 'Switch to dark theme'} onClick={e => toggle(e.currentTarget)} className={className}>
      <AnimatePresence mode="popLayout" initial={false}>
        <motion.span key={String(dark)} initial={{ rotate: -90, scale: 0.5, opacity: 0 }} animate={{ rotate: 0, scale: 1, opacity: 1 }} exit={{ rotate: 90, scale: 0.5, opacity: 0 }} transition={spring(0.4, 0.4)}>
          <Icon name={dark ? 'moon' : 'sun'} />
        </motion.span>
      </AnimatePresence>
    </Button>
  )
}

const CUSTOMISE: [keyof Palette, string][] = [['bg', 'Background'], ['card', 'Surface'], ['fg', 'Text'], ['primary', 'Primary'], ['accent', 'Accent'], ['ok', 'Success'], ['warn', 'Warning'], ['bad', 'Danger']]
const appearanceLabel = 'mb-2.5 text-xs font-medium text-[var(--fg2)]'
const appearanceSection = 'border-b border-[var(--line)] px-3 pt-2.5 pb-3'

/**
 * Everything in the appearance panel, without the popover: mode, theme families with split previews,
 * variant chips (Ayu Mirage / Dark, Tokyo Night / Storm), a Customise grid that creates a Custom theme,
 * corner radius, font, Reset and Copy CSS. Use it inside your own panel, or use AppearanceMenu. Font previews load from
 * Google Fonts only when the provider has `fonts` on; otherwise each font shows in the system fallback.
 */
export function AppearancePanel({ onClose, open = true, className }: { onClose?: () => void; open?: boolean; className?: string }) {
  const { settings, set, reset, dark, tokens, label, fonts } = useTheme()
  const preload = (f: string) => { if (fonts) loadFont(f) } // Google Fonts only when the provider allows it
  const toast = useToast()
  const grid = useRef<HTMLDivElement>(null)
  const { copied, copy: copyText } = useCopy(() => themeCSS(tokens, label))
  useEffect(() => { // land on the current theme, like the original
    if (!open) return
    const id = requestAnimationFrame(() => grid.current?.querySelector<HTMLElement>('[aria-pressed="true"]')?.focus())
    return () => cancelAnimationFrame(id)
  }, [open])
  const fam = THEMES.find(t => t.id === settings.theme) ?? THEMES[0]
  const list = dark ? fam.dark : fam.light
  const cur = Math.min(settings.variant[fam.id] ?? 0, list.length - 1)
  const base = themePalette(settings, dark)
  const copy = async () => {
    if (await copyText()) toast({ title: 'CSS variables copied', description: label })
    else toast({ title: 'Couldn’t copy', description: 'Clipboard blocked', tone: 'bad' })
  }
  return (
    <div className={className}>
      <div className="flex items-center justify-between px-3 pt-3 pb-1">
        <b className="text-base font-semibold">Appearance</b>
        {onClose && <IconButton icon="x" label="Close" onClick={onClose} />}
      </div>
      <div className={appearanceSection}>
        <div className={appearanceLabel}>Mode</div>
        <SegmentedControl aria-label="Mode" className={cn('w-full transition-opacity', settings.useCustom && 'opacity-60')} value={settings.mode} onChange={m => set({ mode: m as ThemeSettings['mode'] })}
          options={[{ value: 'light', label: 'Light', icon: 'sun' }, { value: 'dark', label: 'Dark', icon: 'moon' }, { value: 'system', label: 'System', icon: 'monitor' }]} />
      </div>
      <div className={appearanceSection}>
        <div className={appearanceLabel}>Theme</div>
        <div ref={grid} className="grid grid-cols-2 gap-2.5">
          {THEMES.map((t, i) => {
            const on = !settings.useCustom && t.id === settings.theme
            return (
              <motion.button key={t.id} aria-pressed={on} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.25, delay: 0.03 + i * 0.025 }}
                onClick={e => { if (!on) set({ theme: t.id }, e.currentTarget) }}
                className={cn('flex cursor-pointer flex-col gap-0.5 rounded-[var(--r-lg)] border bg-[var(--card)] p-1.5 pb-2 text-left transition-[border-color,box-shadow]',
                  on ? 'border-[var(--accent)] shadow-[0_0_0_1px_var(--accent)]' : 'border-[var(--line)] hover:border-[var(--line2)]')}>
                <ThemePreview theme={t} variant={settings.variant[t.id] ?? 0} />
                <span className="px-1 text-[13px] font-medium">{t.name}</span>
                <span className="px-1 text-[11px] text-[var(--fg3)]">{[...t.light, ...t.dark].map(x => x[0]).join(' · ')}</span>
              </motion.button>
            )
          })}
          {settings.custom && (
            <motion.button aria-pressed={settings.useCustom} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={spring(0.3, 0.35)}
              onClick={e => { if (!settings.useCustom) set({ useCustom: true }, e.currentTarget) }}
              className={cn('flex cursor-pointer flex-col gap-0.5 rounded-[var(--r-lg)] border bg-[var(--card)] p-1.5 pb-2 text-left transition-[border-color,box-shadow]',
                settings.useCustom ? 'border-[var(--accent)] shadow-[0_0_0_1px_var(--accent)]' : 'border-[var(--line)] hover:border-[var(--line2)]')}>
              <span className={previewFrame} aria-hidden><ThemeMini p={settings.custom.v} /></span>
              <span className="px-1 text-[13px] font-medium">Custom</span>
              <span className="px-1 text-[11px] text-[var(--fg3)]">Your colours</span>
            </motion.button>
          )}
        </div>
        <AnimatePresence initial={false}>
          {!settings.useCustom && list.length > 1 && (
            <motion.div key={fam.id + String(dark)} initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} transition={spring(0.1, 0.35)} className="overflow-hidden">
              <div className="mt-3 flex flex-wrap items-center gap-1.5 rounded-[var(--r-md)] bg-[var(--muted)] px-2.5 py-2">
                <span className="text-xs text-[var(--fg3)]">{fam.name} {dark ? 'dark' : 'light'} style</span><span className="flex-1" />
                {list.map(([n, v], i) => (
                  <button key={n} aria-pressed={i === cur} onClick={e => { if (i !== cur) set({ variant: { ...settings.variant, [fam.id]: i } }, e.currentTarget) }}
                    className={cn('inline-flex cursor-pointer items-center gap-1.5 rounded-full border bg-[var(--card)] py-1 pr-2.5 pl-1 text-xs [@media(pointer:coarse)]:min-h-8',
                      i === cur ? 'border-[var(--fg)] shadow-[0_0_0_1px_var(--fg)]' : 'border-[var(--line)] hover:border-[var(--line2)]')}>
                    <span className="h-4 w-4 rounded-full" style={{ background: v.bg, boxShadow: `inset 0 0 0 3px ${v.card},inset 0 0 0 5px ${v.accent}` }} />{n}
                  </button>
                ))}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
      <div className={appearanceSection}>
        <div className={cn(appearanceLabel, 'flex items-center justify-between')}>Customise<span className="text-[11px] font-normal text-[var(--fg3)]">{settings.useCustom ? 'Editing your Custom theme' : 'Edits create a Custom theme'}</span></div>
        <div className="mb-3 grid grid-cols-2 gap-2">
          {CUSTOMISE.map(([k, n]) => (
            <label key={k} className="relative flex min-w-0 cursor-pointer items-center gap-2 rounded-[var(--r-md)] border border-[var(--line)] px-2 py-1 text-xs hover:bg-[var(--muted)] [@media(pointer:coarse)]:min-h-9 has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-[var(--accent)]">
              <span className="h-[18px] w-[18px] flex-none rounded-[var(--r-sm)] shadow-[inset_0_0_0_1px_rgba(127,127,127,.35)]" style={{ background: base.v[k] }} />{n}
              <span className="ml-auto font-[family-name:var(--mono)] text-[11px] text-[var(--fg3)]">{base.v[k]}</span>
              <input type="color" aria-label={`${n} colour`} value={base.v[k].length === 7 ? base.v[k].toLowerCase() : '#000000'}
                onChange={e => set({ custom: editPalette(base.v, base.dark, k, e.target.value), useCustom: true })}
                className="absolute inset-0 h-full w-full cursor-pointer opacity-0" />
            </label>
          ))}
        </div>
        <Slider label="Corner radius" min={0} max={18} value={settings.radius} onChange={radius => set({ radius })} format={v => `${v} px`} />
        <div className="mt-3 mb-1.5 text-[13px]">Font</div>
        <div className="grid grid-cols-2 gap-1.5">
          {FONTS.map(([f]) => (
            <button key={f} aria-pressed={f === settings.font} onPointerEnter={() => preload(f)} onFocus={() => preload(f)} onClick={() => set({ font: f })} style={{ fontFamily: `"${f}",system-ui,sans-serif` }}
              className={cn('cursor-pointer rounded-[var(--r-md)] border bg-[var(--card)] px-2 py-2 text-left text-[13px] hover:bg-[var(--muted)]',
                f === settings.font ? 'border-[var(--fg)] shadow-[0_0_0_1px_var(--fg)]' : 'border-[var(--line)]')}>{f}</button>
          ))}
        </div>
      </div>
      <div className="sticky bottom-0 flex gap-2 bg-[var(--card)] p-3 max-[480px]:pb-[max(12px,env(safe-area-inset-bottom))]">
        <Button size="sm" onClick={e => reset(e.currentTarget)}>Reset</Button><span className="flex-1" />
        <Button size="sm" onClick={copy}><Icon name={copied ? 'check' : 'copy'} size={14} className={copied ? 'text-[var(--ok)]' : ''} />{copied ? 'Copied' : 'Copy CSS'}</Button>
      </div>
    </div>
  )
}

/**
 * The appearance panel behind a gear button for your app header (the gear turns while it is open).
 * Controlled with `open`/`onOpenChange` so a command palette entry can open it too.
 */
export function AppearanceMenu({ open: o, onOpenChange, className }: { open?: boolean; onOpenChange?: (v: boolean) => void; className?: string }) {
  const [open, setOpen] = useControllable(o, false, onOpenChange)
  const trigger = useRef<HTMLDivElement>(null)
  return (
    <div ref={trigger} className={cn('inline-flex', className)}>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger size="icon" aria-label="Appearance settings">
          <motion.span initial={false} animate={{ rotate: open ? 90 : 0 }} transition={spring(0.3, 0.5)} className="grid place-items-center"><Icon name="settings" /></motion.span>
        </PopoverTrigger>
        <PopoverContent placement="bottom-end" className="max-h-[min(680px,calc(100dvh-90px))] w-[min(372px,calc(100vw-32px))] overflow-auto overscroll-contain !p-0 max-[480px]:fixed max-[480px]:top-[calc(env(safe-area-inset-top,0px)+62px)] max-[480px]:right-[max(12px,env(safe-area-inset-right))] max-[480px]:left-[max(12px,env(safe-area-inset-left))] max-[480px]:w-auto max-[480px]:max-w-none max-[480px]:max-h-[calc(100dvh-74px-env(safe-area-inset-top,0px)-max(12px,env(safe-area-inset-bottom)))]">
          <AppearancePanel open={open} onClose={() => { setOpen(false); trigger.current?.querySelector('button')?.focus() }} />
        </PopoverContent>
      </Popover>
    </div>
  )
}
