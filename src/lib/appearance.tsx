import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { Button, FONTS, Icon, IconButton, type Palette, THEMES, type Theme, type ThemeSettings, type UIMessageKey, cn, defineMessages, derive, editPalette, inputClass, loadFont, spring, themeCSS, themePalette, themeShareUrl, useControllable, useLocale, useMessages, useTheme } from './core'
import { Collapse, CopyButton, useCopy, useToast } from './feedback'
import { SegmentedControl, Slider } from './forms'
import { TabsContent, TabsList, TabsRoot, TabsTrigger } from './navigation'
import { Popover, PopoverContent, PopoverTrigger } from './overlay'
import { THEME_EXPORT_FORMATS, type ThemeExportFormat, type ThemeExportMode, type ThemeImportNote, themeExport, themeImport, themeImportSettings } from './themeexport'

/** One half (or all) of a theme thumbnail: page, card, two text lines, primary button, accent dot. */
function ThemeMini({ p, clip }: { p: Palette; clip?: string }) {
  return (
    <span className="absolute inset-0 block" style={{ background: p.bg, clipPath: clip }}>
      <span className="absolute inset-2 rounded-[var(--r-sm)]" style={{ background: p.card, boxShadow: `inset 0 0 0 1px ${p.line}` }} />
      <span className="absolute top-[15px] start-[15px] h-1 w-[34%] rounded-[var(--r-sm)]" style={{ background: p.fg }} />
      <span className="absolute top-[23px] start-[15px] h-[3px] w-[48%] rounded-[var(--r-sm)] opacity-90" style={{ background: p.fg3 }} />
      <span className="absolute bottom-[14px] start-[15px] h-2 w-[22px] rounded-[var(--r-sm)]" style={{ background: p.primary }} />
      <span className="absolute end-[15px] bottom-[14px] h-2 w-2 rounded-full" style={{ background: p.accent }} />
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
  const { t } = useLocale()
  return (
    <Button size="icon" aria-label={t(dark ? 'theme.switchToLight' : 'theme.switchToDark')} onClick={e => toggle(e.currentTarget)} className={className}>
      <AnimatePresence mode="popLayout" initial={false}>
        <motion.span key={String(dark)} initial={{ rotate: -90, scale: 0.5, opacity: 0 }} animate={{ rotate: 0, scale: 1, opacity: 1 }} exit={{ rotate: 90, scale: 0.5, opacity: 0 }} transition={spring(0.4, 0.4)}>
          <Icon name={dark ? 'moon' : 'sun'} />
        </motion.span>
      </AnimatePresence>
    </Button>
  )
}

/** Strings of the export, import and share controls (ThemeExportPanel). Override one as 'themeExport.<key>' in UIProvider messages. */
export const THEME_EXPORT_MESSAGES = defineMessages('themeExport', {
  en: {
    section: 'Export and share', subheading: 'Use this theme in other projects', formats: 'Export format', code: '{format} code',
    copyCode: 'Copy code', download: 'Download', shareLink: 'Copy share link', shareCopied: 'Share link copied',
    shareHint: 'Opens this page with your theme where theme links are on', import: 'Import', importTitle: 'Import a theme',
    importLabel: 'Theme CSS or JSON', importPlaceholder: 'Paste a shadcn :root { … } .dark { … } block, CSS variables, a Tailwind @theme or DTCG JSON',
    importApply: 'Apply as Custom theme', importApplied: 'Theme imported', importMode: 'Palette to apply',
    found: '{format} theme · {modes, select, both {light and dark} dark {dark} other {light}}',
    'error.empty': 'Paste a theme to preview it', 'error.too-large': 'That is too long to be a theme',
    'error.invalid-json': 'That JSON could not be read', 'error.unrecognised': 'No theme colours found: it needs a background and a text colour',
    notes: '{count, plural, one {# change} other {# changes}}', 'note.missing': '{token}: not set, so the default is used',
    'note.blended': '{token}: translucent, flattened onto the background', 'note.clipped': '{token}: outside sRGB, clipped to the nearest colour',
    'note.contrast': '{token}: adjusted for 4.5:1 contrast, {from} → {to}', 'note.font': 'The font {font} is not offered here, so yours is kept',
    adjusted: '{count, plural, =0 {No colours needed adjusting} one {# colour adjusted for contrast} other {# colours adjusted for contrast}}',
  },
  de: {
    section: 'Exportieren und teilen', subheading: 'Dieses Design in anderen Projekten nutzen', formats: 'Exportformat', code: '{format}-Code',
    copyCode: 'Code kopieren', download: 'Herunterladen', shareLink: 'Link zum Teilen kopieren', shareCopied: 'Link kopiert',
    shareHint: 'Öffnet diese Seite mit deinem Design, wo Design-Links aktiv sind', import: 'Importieren', importTitle: 'Design importieren',
    importLabel: 'Design als CSS oder JSON', importPlaceholder: 'Einen shadcn-Block :root { … } .dark { … }, CSS-Variablen, ein Tailwind-@theme oder DTCG-JSON einfügen',
    importApply: 'Als eigenes Design übernehmen', importApplied: 'Design importiert', importMode: 'Zu übernehmende Palette',
    found: '{format}-Design · {modes, select, both {hell und dunkel} dark {dunkel} other {hell}}',
    'error.empty': 'Füge ein Design ein, um es anzusehen', 'error.too-large': 'Das ist zu lang für ein Design',
    'error.invalid-json': 'Dieses JSON konnte nicht gelesen werden', 'error.unrecognised': 'Keine Designfarben gefunden: Hintergrund und Textfarbe fehlen',
    notes: '{count, plural, one {# Änderung} other {# Änderungen}}', 'note.missing': '{token}: nicht gesetzt, Standard wird verwendet',
    'note.blended': '{token}: transparent, auf den Hintergrund verrechnet', 'note.clipped': '{token}: außerhalb von sRGB, auf die nächste Farbe begrenzt',
    'note.contrast': '{token}: für Kontrast 4,5:1 angepasst, {from} → {to}', 'note.font': 'Die Schrift {font} gibt es hier nicht, deine bleibt',
    adjusted: '{count, plural, =0 {Keine Farbe musste angepasst werden} one {# Farbe für Kontrast angepasst} other {# Farben für Kontrast angepasst}}',
  },
  ar: {
    section: 'التصدير والمشاركة', subheading: 'استخدم هذه السمة في مشاريع أخرى', formats: 'صيغة التصدير', code: 'رمز {format}',
    copyCode: 'نسخ الرمز', download: 'تنزيل', shareLink: 'نسخ رابط المشاركة', shareCopied: 'تم نسخ رابط المشاركة',
    shareHint: 'يفتح هذه الصفحة بسمتك حيث تكون روابط السمات مفعّلة', import: 'استيراد', importTitle: 'استيراد سمة',
    importLabel: 'السمة بصيغة CSS أو JSON', importPlaceholder: 'الصق كتلة shadcn ‏:root { … } .dark { … } أو متغيرات CSS أو ‎@theme من Tailwind أو JSON بصيغة DTCG',
    importApply: 'تطبيق كسمة مخصصة', importApplied: 'تم استيراد السمة', importMode: 'اللوحة المراد تطبيقها',
    found: 'سمة {format} · {modes, select, both {فاتحة وداكنة} dark {داكنة} other {فاتحة}}',
    'error.empty': 'الصق سمة لمعاينتها', 'error.too-large': 'هذا أطول من أن يكون سمة',
    'error.invalid-json': 'تعذّرت قراءة JSON هذا', 'error.unrecognised': 'لم يُعثر على ألوان سمة: يلزم لون خلفية ولون نص',
    notes: '{count, plural, zero {لا تغييرات} one {تغيير واحد} two {تغييران} few {# تغييرات} many {# تغييرًا} other {# تغيير}}', 'note.missing': '{token}: غير محدد، فاستُخدم الافتراضي',
    'note.blended': '{token}: شفاف، دُمج مع الخلفية', 'note.clipped': '{token}: خارج نطاق sRGB، قُصّ إلى أقرب لون',
    'note.contrast': '{token}: عُدّل لتباين 4.5:1، {from} ← {to}', 'note.font': 'الخط {font} غير متاح هنا، فبقي خطك',
    adjusted: '{count, plural, =0 {لم يلزم تعديل أي لون} one {عُدّل لون واحد للتباين} two {عُدّل لونان للتباين} few {عُدّلت # ألوان للتباين} many {عُدّل # لونًا للتباين} other {عُدّل # لون للتباين}}',
  },
})

/** Save text as a file (a Blob link, so it works offline and under a CSP without outside hosts). */
function appearanceDownload(text: string, filename: string, type: string) {
  const url = URL.createObjectURL(new Blob([text], { type: `${type};charset=utf-8` }))
  const a = document.createElement('a')
  a.href = url; a.download = filename; a.rel = 'noopener'; a.style.display = 'none'
  document.body.appendChild(a); a.click(); a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
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
  const m = useMessages(THEME_EXPORT_MESSAGES)
  const { t } = useLocale()
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
    toast(ok ? { title: m('shareCopied'), description: m('shareHint') } : { title: t('common.copyFailed'), description: t('common.clipboardBlocked'), tone: 'bad' })
  }
  const apply = () => {
    if (!result?.ok || !mode) return
    const next = themeImportSettings(result, settings, mode)
    if (!next) return
    set({ custom: next.custom, useCustom: true, radius: next.radius, font: next.font })
    toast({ title: m('importApplied'), description: m('adjusted', { count: notes.filter(n => n.code === 'contrast').length }), tone: 'ok' })
  }
  const noteText = (n: ThemeImportNote) => n.code === 'font' ? m('note.font', { font: n.from ?? '?' }) : m(`note.${n.code}`, { token: n.token, from: n.from ?? '', to: n.to ?? '' })
  return (
    <div className={className}>
      <TabsRoot value={format} onValueChange={v => setFormat(v as ThemeExportFormat)}>
        <TabsList aria-label={m('formats')} className="gap-4">
          {THEME_EXPORT_FORMATS.map(f => <TabsTrigger key={f.id} value={f.id}>{f.label}</TabsTrigger>)}
        </TabsList>
        {THEME_EXPORT_FORMATS.map(f => (
          <TabsContent key={f.id} value={f.id} className="!pt-2">
            <pre dir="ltr" tabIndex={0} role="region" aria-label={m('code', { format: f.label })}
              className="m-0 max-h-56 overflow-auto overscroll-contain rounded-[var(--r-md)] border border-[var(--line)] bg-[var(--muted)] p-2.5 text-start font-[family-name:var(--mono)] text-[11px] leading-relaxed whitespace-pre text-[var(--fg2)] [@media(pointer:coarse)]:max-h-48">
              {f.id === format ? code : ''}
            </pre>
          </TabsContent>
        ))}
      </TabsRoot>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <CopyButton size="sm" text={() => code} label={m('copyCode')} />
        <Button size="sm" onClick={() => appearanceDownload(code, meta.filename, meta.type)} title={meta.filename}>
          <Icon name="download" size={14} />{m('download')}<span className="font-[family-name:var(--mono)] text-[11px] text-[var(--fg3)]" dir="ltr">{meta.filename.slice(meta.filename.lastIndexOf('.'))}</span>
        </Button>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <Button size="sm" onClick={share}><Icon name="link" size={14} />{m('shareLink')}</Button>
        <Button size="sm" aria-expanded={importing} aria-controls={`${ids}-import`} onClick={() => setImporting(o => !o)}>
          <Icon name="upload" size={14} />{m('import')}
        </Button>
      </div>
      <Collapse open={importing}>
        <div id={`${ids}-import`} className="mt-3 rounded-[var(--r-md)] border border-[var(--line)] p-2.5">
          <label htmlFor={`${ids}-text`} className="mb-1.5 block text-xs font-medium text-[var(--fg2)]">{m('importLabel')}</label>
          <textarea id={`${ids}-text`} dir="ltr" rows={5} spellCheck={false} autoCapitalize="off" autoCorrect="off" value={text} onChange={e => setText(e.target.value)}
            placeholder={m('importPlaceholder')} aria-invalid={result && !result.ok ? true : undefined} aria-describedby={`${ids}-status`}
            className={cn(inputClass, '!h-auto max-h-48 min-h-24 resize-y !py-2 font-[family-name:var(--mono)] text-[11px] leading-relaxed')} />
          <div id={`${ids}-status`} aria-live="polite" className="mt-2 text-xs">
            {result && !result.ok && <p className="m-0 text-[var(--bad)]">{m(`error.${result.error}`)}</p>}
            {result?.ok && preview && (
              <>
                <div className="flex items-center gap-2.5">
                  <span className="relative block h-[58px] w-[96px] flex-none overflow-hidden rounded-[var(--r-md)] shadow-[inset_0_0_0_1px_rgba(127,127,127,.2)]" aria-hidden><ThemeMini p={preview} /></span>
                  <span className="min-w-0 text-[var(--fg2)]">{m('found', { format: result.format, modes: modes.length > 1 ? 'both' : modes[0] })}</span>
                </div>
                {modes.length > 1 && (
                  <SegmentedControl size="sm" aria-label={m('importMode')} className="mt-2 w-full" value={mode} onChange={v => setPick(v as ThemeExportMode)}
                    options={[{ value: 'light', label: t('theme.light'), icon: 'sun' }, { value: 'dark', label: t('theme.dark'), icon: 'moon' }]} />
                )}
                {notes.length > 0 && (
                  <details className="mt-2">
                    <summary className="cursor-pointer text-[var(--fg2)]">{m('notes', { count: notes.length })}</summary>
                    <ul className="m-0 mt-1 list-none space-y-0.5 p-0 text-[11px] text-[var(--fg3)]">
                      {notes.map((n, i) => <li key={i} className={n.code === 'contrast' ? 'text-[var(--fg2)]' : undefined}>{noteText(n)}</li>)}
                    </ul>
                  </details>
                )}
                <Button size="sm" variant="primary" className="mt-2.5 w-full" onClick={apply}>{m('importApply')}</Button>
              </>
            )}
          </div>
        </div>
      </Collapse>
    </div>
  )
}

const CUSTOMISE: [keyof Palette, UIMessageKey][] = [['bg', 'theme.colour.bg'], ['card', 'theme.colour.card'], ['fg', 'theme.colour.fg'], ['primary', 'theme.colour.primary'], ['accent', 'theme.colour.accent'], ['ok', 'theme.colour.ok'], ['warn', 'theme.colour.warn'], ['bad', 'theme.colour.bad']]
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
  const { t } = useLocale()
  const grid = useRef<HTMLDivElement>(null)
  const { copied, copy: copyText } = useCopy(() => themeCSS(tokens, label))
  const mx = useMessages(THEME_EXPORT_MESSAGES)
  const [exportOpen, setExportOpen] = useState(false)
  const exportId = useId()
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
    if (await copyText()) toast({ title: t('theme.cssCopied'), description: label })
    else toast({ title: t('common.copyFailed'), description: t('common.clipboardBlocked'), tone: 'bad' })
  }
  return (
    <div className={className}>
      <div className="flex items-center justify-between px-3 pt-3 pb-1">
        <b className="text-base font-semibold">{t('theme.appearance')}</b>
        {onClose && <IconButton icon="x" label={t('common.close')} onClick={onClose} />}
      </div>
      <div className={appearanceSection}>
        <div className={appearanceLabel}>{t('theme.mode')}</div>
        <SegmentedControl aria-label={t('theme.mode')} className={cn('w-full transition-opacity', settings.useCustom && 'opacity-60')} value={settings.mode} onChange={m => set({ mode: m as ThemeSettings['mode'] })}
          options={[{ value: 'light', label: t('theme.light'), icon: 'sun' }, { value: 'dark', label: t('theme.dark'), icon: 'moon' }, { value: 'system', label: t('theme.system'), icon: 'monitor' }]} />
      </div>
      <div className={appearanceSection}>
        <div className={appearanceLabel}>{t('theme.theme')}</div>
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
              <span className={previewFrame} aria-hidden><ThemeMini p={settings.custom.v} /></span>
              <span className="px-1 text-[13px] font-medium">{t('theme.custom')}</span>
              <span className="px-1 text-[11px] text-[var(--fg3)]">{t('theme.customHint')}</span>
            </motion.button>
          )}
        </div>
        <AnimatePresence initial={false}>
          {!settings.useCustom && list.length > 1 && (
            <motion.div key={fam.id + String(dark)} initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} transition={spring(0.1, 0.35)} className="overflow-hidden">
              <div className="mt-3 flex flex-wrap items-center gap-1.5 rounded-[var(--r-md)] bg-[var(--muted)] px-2.5 py-2">
                <span className="text-xs text-[var(--fg3)]">{t('theme.variantStyle', { theme: fam.name, mode: dark ? 'dark' : 'light' })}</span><span className="flex-1" />
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
        <div className={cn(appearanceLabel, 'flex items-center justify-between')}>{t('theme.customise')}<span className="text-[11px] font-normal text-[var(--fg3)]">{t(settings.useCustom ? 'theme.customEditing' : 'theme.customCreates')}</span></div>
        <div className="mb-3 grid grid-cols-2 gap-2">
          {CUSTOMISE.map(([k, n]) => (
            <label key={k} className="relative flex min-w-0 cursor-pointer items-center gap-2 rounded-[var(--r-md)] border border-[var(--line)] px-2 py-1 text-xs hover:bg-[var(--muted)] [@media(pointer:coarse)]:min-h-9 has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-[var(--accent)]">
              <span className="h-[18px] w-[18px] flex-none rounded-[var(--r-sm)] shadow-[inset_0_0_0_1px_rgba(127,127,127,.35)]" style={{ background: base.v[k] }} />{t(n)}
              <span className="ms-auto font-[family-name:var(--mono)] text-[11px] text-[var(--fg3)]">{base.v[k]}</span>
              <input type="color" aria-label={t('theme.colourLabel', { name: t(n) })} value={base.v[k].length === 7 ? base.v[k].toLowerCase() : '#000000'}
                onChange={e => set({ custom: editPalette(base.v, base.dark, k, e.target.value), useCustom: true })}
                className="absolute inset-0 h-full w-full cursor-pointer opacity-0" />
            </label>
          ))}
        </div>
        <Slider label={t('theme.radius')} min={0} max={18} value={settings.radius} onChange={radius => set({ radius })} format={v => `${v} px`} />
        <div className="mt-3 mb-1.5 text-[13px]">{t('theme.font')}</div>
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
          <span className="text-xs font-medium text-[var(--fg2)]">{mx('section')}</span>
          <span className="truncate text-[11px] text-[var(--fg3)]">{mx('subheading')}</span>
          <motion.span initial={false} animate={{ rotate: exportOpen ? 180 : 0 }} transition={spring(0.2, 0.3)} className="ms-auto grid text-[var(--fg3)]"><Icon name="chevronDown" size={14} /></motion.span>
        </button>
        <Collapse open={exportOpen}><div id={`${exportId}-panel`} className="pt-2.5"><ThemeExportPanel /></div></Collapse>
      </div>
      <div className="sticky bottom-0 flex gap-2 bg-[var(--card)] p-3 max-[480px]:pb-[max(12px,env(safe-area-inset-bottom))]">
        <Button size="sm" onClick={e => reset(e.currentTarget)}>{t('common.reset')}</Button><span className="flex-1" />
        <Button size="sm" onClick={copy}><Icon name={copied ? 'check' : 'copy'} size={14} className={copied ? 'text-[var(--ok)]' : ''} />{t(copied ? 'common.copied' : 'theme.copyCss')}</Button>
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
  const { t, dir } = useLocale()
  return (
    <div ref={trigger} className={cn('inline-flex', className)}>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger size="icon" aria-label={t('theme.settings')}>
          <motion.span initial={false} animate={{ rotate: open ? 90 : 0 }} transition={spring(0.3, 0.5)} className="grid place-items-center"><Icon name="settings" /></motion.span>
        </PopoverTrigger>
        <PopoverContent aria-label={t('theme.appearance')} placement={dir === 'rtl' ? 'bottom-start' : 'bottom-end'} className="max-h-[min(680px,calc(100dvh-90px))] w-[min(372px,calc(100vw-32px))] overflow-auto overscroll-contain !p-0 max-[480px]:fixed max-[480px]:top-[calc(env(safe-area-inset-top,0px)+62px)] max-[480px]:right-[max(12px,env(safe-area-inset-right))] max-[480px]:left-[max(12px,env(safe-area-inset-left))] max-[480px]:w-auto max-[480px]:max-w-none max-[480px]:max-h-[calc(100dvh-74px-env(safe-area-inset-top,0px)-max(12px,env(safe-area-inset-bottom)))]">
          <AppearancePanel open={open} onClose={() => { setOpen(false); trigger.current?.querySelector('button')?.focus() }} />
        </PopoverContent>
      </Popover>
    </div>
  )
}
