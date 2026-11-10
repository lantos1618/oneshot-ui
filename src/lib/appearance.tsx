import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { Button, FONTS, Icon, IconButton, type Palette, THEMES, type ThemeSettings, cn, derive, editPalette, inputClass, loadFont, spring, themeCSS, themePalette, themeShareUrl, useControllable, useTheme, plural, downloadBlob } from './core'
import { Collapse, CopyButton, useCopy, useToast } from './feedback'
import { SegmentedControl } from './fields'
import { Slider } from './inputs'
import { TabsContent, TabsList, TabsRoot, TabsTrigger } from './navigation'
import { Popover, PopoverContent, PopoverTrigger } from './overlay'
import { THEME_EXPORT_FORMATS, type ThemeExportFormat, type ThemeExportMode, type ThemeImportNote, themeExport, themeImport, themeImportSettings } from './themeexport'
import { ThemePreview } from './provider'

export { ThemePreview, ThemeToggle } from './provider'

const THEME_IMPORT_ERRORS = {
  empty: 'Paste a theme to preview it', 'too-large': 'That is too long to be a theme', 'invalid-json': 'That JSON could not be read',
  unrecognised: 'No theme colours found: it needs a background and a text colour',
}

/**
 * Export, import and share for the current theme (the appearance panel's "Export and share" section; also usable on
 * its own, e.g. on a theme-builder page next to AppearancePanel). Tabs show the theme as CSS variables, a Tailwind v4
 * `@theme`, shadcn/ui variables, DTCG tokens and Tokens Studio JSON (themeexport), each with Copy and Download.
 * Copy share link copies `#theme=…` for this page (apps opt in to reading it with `<UIProvider themeFromUrl>`).
 * Import reads a pasted shadcn block, CSS or DTCG JSON, previews it with every guessed or contrast-adjusted colour
 * listed, and applies it as the Custom theme.
 */
export function ThemeExportPanel({ className }: { className?: string }) {
  const { settings, set, dark } = useTheme()
  const toast = useToast()
  const [format, setFormat] = useState<ThemeExportFormat>('css')
  const code = useMemo(() => themeExport(format, settings), [format, settings])
  const meta = THEME_EXPORT_FORMATS.find(f => f.id === format) ?? THEME_EXPORT_FORMATS[0]
  const { copy: copyLink } = useCopy()
  const [importing, setImporting] = useState(false)
  const [text, setText] = useState('')
  const result = useMemo(() => (text.trim() ? themeImport(text) : null), [text])
  const modes = result?.ok ? ([result.light && 'light', result.dark && 'dark'].filter(Boolean) as ThemeExportMode[]) : []
  const [pick, setPick] = useState<ThemeExportMode | null>(null)
  const mode = pick && modes.includes(pick) ? pick : modes.includes(dark ? 'dark' : 'light') ? (dark ? 'dark' : 'light') : modes[0]
  const chosen = result?.ok && mode ? result[mode] : null
  const preview = useMemo(() => (chosen ? (derive(chosen.v, chosen.dark) as Palette) : null), [chosen])
  const notes = result?.ok ? result.notes.filter(n => n.mode === mode || n.code === 'font') : []
  const ids = useId()
  const share = async () => {
    const ok = await copyLink(themeShareUrl(settings))
    toast(ok ? { title: 'Share link copied', description: 'Opens this page with your theme where theme links are on' } : { title: 'Couldn’t copy', description: 'Clipboard blocked', tone: 'bad' })
  }
  const apply = () => {
    if (!result?.ok || !mode) return
    const next = themeImportSettings(result, settings, mode)
    if (!next) return
    set({ custom: next.custom, useCustom: true, radius: next.radius, font: next.font })
    toast({ title: 'Theme imported', description: ((notes.filter(n => n.code === 'contrast').length) === 0 ? 'No colours needed adjusting' : (notes.filter(n => n.code === 'contrast').length) === 1 ? `${notes.filter(n => n.code === 'contrast').length} colour adjusted for contrast` : `${notes.filter(n => n.code === 'contrast').length} colours adjusted for contrast`), tone: 'ok' })
  }
  const noteText = (n: ThemeImportNote) => ({
    missing: `${n.token}: not set, so the default is used`, blended: `${n.token}: translucent, flattened onto the background`,
    clipped: `${n.token}: outside sRGB, clipped to the nearest colour`, contrast: `${n.token}: adjusted for 4.5:1 contrast, ${n.from} → ${n.to}`,
    font: `The font ${n.from ?? '?'} is not offered here, so yours is kept`,
  })[n.code]
  return (
    <div className={className}>
      <TabsRoot value={format} onValueChange={v => setFormat(v as ThemeExportFormat)}>
        <TabsList aria-label={'Export format'} className="gap-4">
          {THEME_EXPORT_FORMATS.map(f => <TabsTrigger key={f.id} value={f.id}>{f.label}</TabsTrigger>)}
        </TabsList>
        {THEME_EXPORT_FORMATS.map(f => (
          <TabsContent key={f.id} value={f.id} className="!pt-2">
            <pre tabIndex={0} role="region" aria-label={`${f.label} code`}
              className="m-0 max-h-56 overflow-auto overscroll-contain rounded-[var(--r-md)] border border-[var(--line)] bg-[var(--muted)] p-2.5 text-start font-[family-name:var(--mono)] text-[11px] leading-relaxed whitespace-pre text-[var(--fg2)] [@media(pointer:coarse)]:max-h-48">
              {f.id === format ? code : ''}
            </pre>
          </TabsContent>
        ))}
      </TabsRoot>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <CopyButton size="sm" text={() => code} label={'Copy code'} />
        <Button size="sm" onClick={() => downloadBlob(new Blob([code], { type: `${meta.type};charset=utf-8` }), meta.filename)} title={meta.filename}>
          <Icon name="download" size={14} />{'Download'}<span className="font-[family-name:var(--mono)] text-[11px] text-[var(--fg3)]">{meta.filename.slice(meta.filename.lastIndexOf('.'))}</span>
        </Button>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <Button size="sm" onClick={share}><Icon name="link" size={14} />{'Copy share link'}</Button>
        <Button size="sm" aria-expanded={importing} aria-controls={`${ids}-import`} onClick={() => setImporting(o => !o)}>
          <Icon name="upload" size={14} />{'Import'}
        </Button>
      </div>
      <Collapse open={importing}>
        <div id={`${ids}-import`} className="mt-3 rounded-[var(--r-md)] border border-[var(--line)] p-2.5">
          <label htmlFor={`${ids}-text`} className="mb-1.5 block text-xs font-medium text-[var(--fg2)]">{'Theme CSS or JSON'}</label>
          <textarea id={`${ids}-text`} rows={5} spellCheck={false} autoCapitalize="off" autoCorrect="off" value={text} onChange={e => setText(e.target.value)}
            placeholder={'Paste a shadcn :root { … } .dark { … } block, CSS variables, a Tailwind @theme or DTCG JSON'} aria-invalid={result && !result.ok ? true : undefined} aria-describedby={`${ids}-status`}
            className={cn(inputClass, '!h-auto max-h-48 min-h-24 resize-y !py-2 font-[family-name:var(--mono)] text-[11px] leading-relaxed')} />
          <div id={`${ids}-status`} aria-live="polite" className="mt-2 text-xs">
            {result && !result.ok && <p className="m-0 text-[var(--bad)]">{THEME_IMPORT_ERRORS[result.error]}</p>}
            {result?.ok && preview && (
              <>
                <div className="flex items-center gap-2.5">
                  <ThemePreview palette={preview} className="w-[96px] flex-none !mb-0 !rounded-[var(--r-md)]" />
                  <span className="min-w-0 text-[var(--fg2)]">{`${result.format} theme · ${(modes.length > 1 ? 'both' : modes[0]) === 'both' ? 'light and dark' : (modes.length > 1 ? 'both' : modes[0]) === 'dark' ? 'dark' : 'light'}`}</span>
                </div>
                {modes.length > 1 && (
                  <SegmentedControl size="sm" aria-label={'Palette to apply'} className="mt-2 w-full" value={mode} onChange={v => setPick(v as ThemeExportMode)}
                    options={[{ value: 'light', label: 'Light', icon: 'sun' }, { value: 'dark', label: 'Dark', icon: 'moon' }]} />
                )}
                {notes.length > 0 && (
                  <details className="mt-2">
                    <summary className="cursor-pointer text-[var(--fg2)]">{plural(notes.length, 'change')}</summary>
                    <ul className="m-0 mt-1 list-none space-y-0.5 p-0 text-[11px] text-[var(--fg3)]">
                      {notes.map((n, i) => <li key={i} className={n.code === 'contrast' ? 'text-[var(--fg2)]' : undefined}>{noteText(n)}</li>)}
                    </ul>
                  </details>
                )}
                <Button size="sm" variant="primary" className="mt-2.5 w-full" onClick={apply}>{'Apply as Custom theme'}</Button>
              </>
            )}
          </div>
        </div>
      </Collapse>
    </div>
  )
}

const CUSTOMISE: [keyof Palette, string][] = [['bg', 'Background'], ['card', 'Surface'], ['fg', 'Text'], ['primary', 'Primary'], ['accent', 'Accent'], ['ok', 'Success'], ['warn', 'Warning'], ['bad', 'Danger']]
const appearanceLabel = 'mb-2.5 text-xs font-medium text-[var(--fg2)]'
const appearanceSection = 'border-b border-[var(--line)] px-3 pt-2.5 pb-3'

/**
 * Everything in the appearance panel, without the popover: mode, theme families with split previews,
 * variant chips (Ayu Mirage / Dark, Tokyo Night / Storm), a Customise grid that creates a Custom theme,
 * corner radius, font, an "Export and share" section (ThemeExportPanel: CSS, Tailwind, shadcn, DTCG and Figma tokens,
 * import, share link), Reset and Copy CSS. Use it inside your own panel, or use AppearanceMenu. Font previews load from
 * Google Fonts only when the provider has `fonts` on; otherwise each font shows in the system fallback.
 */
export function AppearancePanel({ onClose, open = true, className }: { onClose?: () => void; open?: boolean; className?: string }) {
  const { settings, set, reset, dark, tokens, label, fonts } = useTheme()
  const preload = (f: string) => { if (fonts) loadFont(f) } // Google Fonts only when the provider allows it
  const toast = useToast()
  const grid = useRef<HTMLDivElement>(null)
  const { copied, copy: copyText } = useCopy(() => themeCSS(tokens, label))
  const [exportOpen, setExportOpen] = useState(false)
  const exportId = useId()
  useEffect(() => { // land on the current theme
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
        <b className="text-base font-semibold">{'Appearance'}</b>
        {onClose && <IconButton icon="x" label={'Close'} onClick={onClose} />}
      </div>
      <div className={appearanceSection}>
        <div className={appearanceLabel}>{'Mode'}</div>
        <SegmentedControl aria-label={'Mode'} className={cn('w-full transition-opacity', settings.useCustom && 'opacity-60')} value={settings.mode} onChange={m => set({ mode: m as ThemeSettings['mode'] })}
          options={[{ value: 'light', label: 'Light', icon: 'sun' }, { value: 'dark', label: 'Dark', icon: 'moon' }, { value: 'system', label: 'System', icon: 'monitor' }]} />
      </div>
      <div className={appearanceSection}>
        <div className={appearanceLabel}>{'Theme'}</div>
        <div ref={grid} className="grid grid-cols-2 gap-2.5">
          {THEMES.map((t, i) => {
            const on = !settings.useCustom && t.id === settings.theme
            return (
              <motion.button key={t.id} aria-pressed={on} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.25, delay: 0.03 + i * 0.025 }}
                onClick={e => { if (!on) set({ theme: t.id }, e.currentTarget) }}
                className={cn('flex cursor-pointer flex-col gap-0.5 rounded-[var(--r-lg)] border bg-[var(--card)] p-1.5 pb-2 text-start transition-[border-color,box-shadow]',
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
              className={cn('flex cursor-pointer flex-col gap-0.5 rounded-[var(--r-lg)] border bg-[var(--card)] p-1.5 pb-2 text-start transition-[border-color,box-shadow]',
                settings.useCustom ? 'border-[var(--accent)] shadow-[0_0_0_1px_var(--accent)]' : 'border-[var(--line)] hover:border-[var(--line2)]')}>
              <ThemePreview palette={settings.custom.v} />
              <span className="px-1 text-[13px] font-medium">{'Custom'}</span>
              <span className="px-1 text-[11px] text-[var(--fg3)]">{'Your colours'}</span>
            </motion.button>
          )}
        </div>
        <AnimatePresence initial={false}>
          {!settings.useCustom && list.length > 1 && (
            <motion.div key={fam.id + String(dark)} initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} transition={spring(0.1, 0.35)} className="overflow-hidden">
              <div className="mt-3 flex flex-wrap items-center gap-1.5 rounded-[var(--r-md)] bg-[var(--muted)] px-2.5 py-2">
                <span className="text-xs text-[var(--fg3)]">{`${fam.name} ${(dark ? 'dark' : 'light') === 'dark' ? 'dark' : 'light'} style`}</span><span className="flex-1" />
                {list.map(([n, v], i) => (
                  <button key={n} aria-pressed={i === cur} onClick={e => { if (i !== cur) set({ variant: { ...settings.variant, [fam.id]: i } }, e.currentTarget) }}
                    className={cn('inline-flex cursor-pointer items-center gap-1.5 rounded-full border bg-[var(--card)] py-1 pe-2.5 ps-1 text-xs [@media(pointer:coarse)]:min-h-8',
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
        <div className={cn(appearanceLabel, 'flex items-center justify-between')}>{'Customise'}<span className="text-[11px] font-normal text-[var(--fg3)]">{(settings.useCustom ? 'Editing your Custom theme' : 'Edits create a Custom theme')}</span></div>
        <div className="mb-3 grid grid-cols-2 gap-2">
          {CUSTOMISE.map(([k, n]) => (
            <label key={k} className="relative flex min-w-0 cursor-pointer items-center gap-2 rounded-[var(--r-md)] border border-[var(--line)] px-2 py-1 text-xs hover:bg-[var(--muted)] [@media(pointer:coarse)]:min-h-9 has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-[var(--accent)]">
              <span className="h-[18px] w-[18px] flex-none rounded-[var(--r-sm)] shadow-[inset_0_0_0_1px_rgba(127,127,127,.35)]" style={{ background: base.v[k] }} />{n}
              <span className="ms-auto font-[family-name:var(--mono)] text-[11px] text-[var(--fg3)]">{base.v[k]}</span>
              <input type="color" aria-label={`${n} colour`} value={base.v[k].length === 7 ? base.v[k].toLowerCase() : '#000000'}
                onChange={e => set({ custom: editPalette(base.v, base.dark, k, e.target.value), useCustom: true })}
                className="absolute inset-0 h-full w-full cursor-pointer opacity-0" />
            </label>
          ))}
        </div>
        <Slider label={'Corner radius'} min={0} max={18} value={settings.radius} onChange={radius => set({ radius })} format={v => `${v} px`} />
        <div className="mt-3 mb-1.5 text-[13px]">{'Font'}</div>
        <div className="grid grid-cols-2 gap-1.5">
          {FONTS.map(([f]) => (
            <button key={f} aria-pressed={f === settings.font} onPointerEnter={() => preload(f)} onFocus={() => preload(f)} onClick={() => set({ font: f })} style={{ fontFamily: `"${f}",system-ui,sans-serif` }}
              className={cn('cursor-pointer rounded-[var(--r-md)] border bg-[var(--card)] px-2 py-2 text-start text-[13px] hover:bg-[var(--muted)]',
                f === settings.font ? 'border-[var(--fg)] shadow-[0_0_0_1px_var(--fg)]' : 'border-[var(--line)]')}>{f}</button>
          ))}
        </div>
      </div>
      <div className={appearanceSection}>
        <button type="button" aria-expanded={exportOpen} aria-controls={`${exportId}-panel`} onClick={() => setExportOpen(o => !o)}
          className="flex w-full cursor-pointer items-center gap-2 rounded-[var(--r-md)] border-0 bg-transparent p-0 text-start [@media(pointer:coarse)]:min-h-9">
          <span className="text-xs font-medium text-[var(--fg2)]">{'Export and share'}</span>
          <span className="truncate text-[11px] text-[var(--fg3)]">{'Use this theme in other projects'}</span>
          <motion.span initial={false} animate={{ rotate: exportOpen ? 180 : 0 }} transition={spring(0.2, 0.3)} className="ms-auto grid text-[var(--fg3)]"><Icon name="chevronDown" size={14} /></motion.span>
        </button>
        <Collapse open={exportOpen}><div id={`${exportId}-panel`} className="pt-2.5"><ThemeExportPanel /></div></Collapse>
      </div>
      <div className="sticky bottom-0 flex gap-2 bg-[var(--card)] p-3 max-[480px]:pb-[max(12px,env(safe-area-inset-bottom))]">
        <Button size="sm" onClick={e => reset(e.currentTarget)}>{'Reset'}</Button><span className="flex-1" />
        <Button size="sm" onClick={copy}><Icon name={copied ? 'check' : 'copy'} size={14} className={copied ? 'text-[var(--ok)]' : ''} />{(copied ? 'Copied' : 'Copy CSS')}</Button>
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
        <PopoverTrigger size="icon" aria-label={'Appearance settings'}>
          <motion.span initial={false} animate={{ rotate: open ? 90 : 0 }} transition={spring(0.3, 0.5)} className="grid place-items-center"><Icon name="settings" /></motion.span>
        </PopoverTrigger>
        <PopoverContent aria-label={'Appearance'} placement={'bottom-end'} className="max-h-[min(680px,calc(100dvh-90px))] w-[min(372px,calc(100vw-32px))] overflow-auto overscroll-contain !p-0 max-[480px]:fixed max-[480px]:top-[calc(env(safe-area-inset-top,0px)+62px)] max-[480px]:right-[max(12px,env(safe-area-inset-right))] max-[480px]:left-[max(12px,env(safe-area-inset-left))] max-[480px]:w-auto max-[480px]:max-w-none max-[480px]:max-h-[calc(100dvh-74px-env(safe-area-inset-top,0px)-max(12px,env(safe-area-inset-bottom)))]">
          <AppearancePanel open={open} onClose={() => { setOpen(false); trigger.current?.querySelector('button')?.focus() }} />
        </PopoverContent>
      </Popover>
    </div>
  )
}
