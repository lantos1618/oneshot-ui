// Theme exports (CSS, Tailwind v4, shadcn, DTCG, Tokens Studio), import back, share codes and links, and the panel.
import { act, fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it } from 'vitest'
import {
  AppearancePanel, DEFAULT_THEME, THEMES, THEME_STORAGE_KEY, UIProvider, contrast, derive, editPalette, themeFromUrl, themeLoad, themeShareDecode, themeShareEncode, themeShareUrl, themeTokens, useTheme,
  hexToOklch, oklchString, oklchToHex, themeExport, themeExportSource, themeImport, themeImportSettings, themeToCSS, themeToDTCG, themeToDTCGTokens, themeToShadcn, themeToTailwind, themeToTokensStudio,
  THEME_EXPORT_FORMATS, type CustomTheme, type ThemeExportSource, type ThemeSettings,
} from '../../src/lib/all'

const LIGHT_CUSTOM: ThemeSettings = { ...DEFAULT_THEME, radius: 12, font: 'Inter', useCustom: true, custom: editPalette(editPalette(THEMES[5].light[0][1], false, 'accent', '#7C3AED').v, false, 'primary', '#0F766E') }
const DARK_CUSTOM: ThemeSettings = { ...DEFAULT_THEME, radius: 4, font: 'Manrope', useCustom: true, custom: editPalette(editPalette(THEMES[6].dark[0][1], true, 'bg', '#101418').v, true, 'accent', '#F472B6') }

/** Export source for imported palettes, with the same label as the original so the outputs compare as text. */
const sourceOf = (label: string, light: CustomTheme | null, dark: CustomTheme | null, radius: number, font: string): ThemeExportSource => ({
  label, modes: {
    ...(light ? { light: themeTokens({ ...DEFAULT_THEME, radius, font, custom: light, useCustom: true }, false) } : {}),
    ...(dark ? { dark: themeTokens({ ...DEFAULT_THEME, radius, font, custom: dark, useCustom: true }, true) } : {}),
  },
})

describe('themeExport', () => {
  it('runs the exporter of each format, and throws for an unknown one', () => {
    const by = { css: themeToCSS, tailwind: themeToTailwind, shadcn: themeToShadcn, dtcg: themeToDTCG, 'tokens-studio': themeToTokensStudio }
    expect(THEME_EXPORT_FORMATS.map(f => f.id).sort()).toEqual(Object.keys(by).sort())
    for (const s of [DEFAULT_THEME, LIGHT_CUSTOM, DARK_CUSTOM]) for (const { id } of THEME_EXPORT_FORMATS) expect(themeExport(id, s), id).toBe(by[id](s))
    expect(() => themeExport('scss' as never, DEFAULT_THEME)).toThrow(/unknown format "scss"/)
  })
})

describe('exporters: content', () => {
  it('CSS has light in :root and only the changed tokens for dark, under the media query and [data-theme=dark]', () => {
    const css = themeToCSS({ ...DEFAULT_THEME, theme: 'nord' })
    expect(css).toMatch(/^\/\* Nord \(Light \/ Dark\) · @lyndon\/ui theme · CSS variables \*\/\n:root \{\n {2}--bg: #E5E9F0;/)
    expect(css).toContain('@media (prefers-color-scheme: dark) {\n  :root:not([data-theme="light"]) {\n    --bg: #2E3440;')
    expect(css).toContain(':root[data-theme="dark"] {\n  --bg: #2E3440;')
    const dark = css.slice(css.indexOf(':root[data-theme="dark"]'))
    expect(dark).not.toContain('--r-md') // radius and font are the same in both modes
    expect(dark).toContain('color-scheme: dark;')
  })

  it('a Custom theme exports its one palette', () => {
    expect(themeToCSS(DARK_CUSTOM)).not.toContain('prefers-color-scheme')
    expect(themeToCSS(DARK_CUSTOM)).toContain('color-scheme: dark;')
    expect(themeToShadcn(DARK_CUSTOM)).not.toContain('.dark {')
    expect(themeToShadcn(DARK_CUSTOM)).toContain('one dark palette')
    expect(Object.keys(JSON.parse(themeToTokensStudio(DARK_CUSTOM)).$metadata.tokenSetOrder)).toHaveLength(2)
  })

  it('Tailwind maps tokens to --color-*, --radius-*, --font-* and --shadow-card, dark through @variant dark', () => {
    const tw = themeToTailwind(DEFAULT_THEME)
    expect(tw).toContain('@custom-variant dark (&:where([data-theme=dark], [data-theme=dark] *));')
    expect(tw).toMatch(/@theme \{\n {2}--color-bg: #FAFAFA;/)
    for (const v of ['--color-accent-soft:', '--color-c-neutral:', '--radius-md: 8px;', '--font-sans: "Geist"', '--font-mono: "Geist Mono"', '--shadow-card: 0 1px 2px']) expect(tw).toContain(v)
    expect(tw).toContain('@layer theme {\n  :root, :host {\n    @variant dark {\n      --color-bg: #09090B;')
    expect(themeToTailwind(DEFAULT_THEME, { dark: 'class' })).toContain('@custom-variant dark (&:where(.dark, .dark *));')
    expect(themeToTailwind(DEFAULT_THEME, { dark: 'media' })).not.toContain('@custom-variant')
    const inline = themeToTailwind(DEFAULT_THEME, { inline: true })
    expect(inline).toContain('@theme inline {\n  --color-bg: var(--bg);')
    expect(inline).toContain('--font-mono: var(--mono);')
    expect(inline).not.toContain('#')
  })

  it('shadcn has every variable as oklch(), :root with --radius and .dark', () => {
    const css = themeToShadcn(DEFAULT_THEME)
    const names = ['background', 'foreground', 'card', 'card-foreground', 'popover', 'popover-foreground', 'primary', 'primary-foreground', 'secondary', 'secondary-foreground',
      'muted', 'muted-foreground', 'accent', 'accent-foreground', 'destructive', 'border', 'input', 'ring', 'chart-1', 'chart-2', 'chart-3', 'chart-4', 'chart-5',
      'sidebar', 'sidebar-foreground', 'sidebar-primary', 'sidebar-primary-foreground', 'sidebar-accent', 'sidebar-accent-foreground', 'sidebar-border', 'sidebar-ring']
    const [root, dark] = css.split('.dark {')
    for (const n of names) {
      expect(root).toMatch(new RegExp(`\\n  --${n}: oklch\\([\\d.]+ [\\d.]+ [\\d.]+\\);`))
      expect(dark).toMatch(new RegExp(`\\n  --${n}: oklch\\([\\d.]+ [\\d.]+ [\\d.]+\\);`))
    }
    expect(root).toContain('--radius: 0.625rem;') // theme radius 8 + 2px, shadcn's default
    expect(root).toContain('--background: oklch(0.985 0 0);')
    expect(root).toContain('--card: oklch(1 0 0);')
    expect(themeToShadcn(DEFAULT_THEME, { themeInline: true })).toContain('@theme inline {\n  --radius-sm: calc(var(--radius) - 4px);')
  })

  it("a Custom palette's own colours, radius and font reach every format", () => {
    const [accent, primary] = ['#7C3AED', '#0F766E'] // LIGHT_CUSTOM, radius 12, Inter
    const css = themeToCSS(LIGHT_CUSTOM)
    expect(css).toMatch(/^\/\* Custom · @lyndon\/ui theme · CSS variables \*\/\n:root \{\n/)
    for (const v of [`--accent: ${accent};`, `--primary: ${primary};`, `--c2: ${accent};`, '--band: rgba(124,58,237,0.13);', '--r-md: 12px;', '--font: "Inter",', 'color-scheme: light;']) expect(css).toContain(v)
    const tw = themeToTailwind(LIGHT_CUSTOM)
    for (const v of [`--color-accent: ${accent};`, `--color-primary: ${primary};`, '--radius-md: 12px;', '--font-sans: "Inter",']) expect(tw).toContain(v)
    expect(tw).not.toContain('@variant dark') // one palette: no dark block
    const cn = themeToShadcn(LIGHT_CUSTOM)
    for (const v of ['--radius: 0.875rem;', `--primary: ${oklchString(primary)};`, `--ring: ${oklchString(accent)};`, `--chart-2: ${oklchString(accent)};`]) expect(cn).toContain(v)
    const dt = themeToDTCGTokens(LIGHT_CUSTOM) as Record<string, Record<string, { $value: unknown; $extensions?: unknown }>>
    expect(dt.color.accent.$value).toMatchObject({ hex: accent.toLowerCase() })
    expect(dt.color.primary.$value).toMatchObject({ hex: primary.toLowerCase() })
    expect(dt.radius.md.$value).toEqual({ value: 12, unit: 'px' })
    expect((dt.font.sans.$value as string[])[0]).toBe('Inter')
    expect(dt.color.accent.$extensions).toBeUndefined() // no dark values to carry
    const ts = JSON.parse(themeToTokensStudio(LIGHT_CUSTOM))
    expect(Object.keys(ts)).toEqual(['global', 'light', '$themes', '$metadata'])
    expect(ts.light.color.accent).toEqual({ value: accent, type: 'color' })
    expect(ts.global.radius.md).toEqual({ value: '12px', type: 'borderRadius' })
    expect(ts.global.font.sans.value).toMatch(/^Inter, /)

    // a dark Custom palette exports as dark only, with its own radius (4) and font (Manrope)
    const dcss = themeToCSS(DARK_CUSTOM)
    for (const v of ['--bg: #101418;', '--accent: #F472B6;', '--r-md: 4px;', '--font: "Manrope",', 'color-scheme: dark;']) expect(dcss).toContain(v)
    expect(dcss).not.toContain('color-scheme: light')
    expect(themeToShadcn(DARK_CUSTOM)).toContain('--radius: 0.375rem;')
    expect(themeToTailwind(DARK_CUSTOM)).toContain('--color-bg: #101418;')
    const dts = JSON.parse(themeToTokensStudio(DARK_CUSTOM))
    expect(dts.$metadata.tokenSetOrder).toEqual(['global', 'dark'])
    expect(dts.dark.color.bg.value).toBe('#101418')
    expect(dts.light).toBeUndefined()
  })

  it('Tokens Studio: a global set (radius, fonts), a colour and shadow set per mode, and a theme per mode', () => {
    const ts = JSON.parse(themeToTokensStudio(DEFAULT_THEME))
    expect(Object.keys(ts)).toEqual(['global', 'light', 'dark', '$themes', '$metadata'])
    expect(ts.global.radius.md).toEqual({ value: '8px', type: 'borderRadius' })
    for (const k of ['sm', 'md', 'lg']) expect(ts.global.radius[k].value).toMatch(/^\d+(\.\d+)?px$/)
    expect(parseFloat(ts.global.radius.sm.value)).toBeLessThan(8)
    expect(parseFloat(ts.global.radius.lg.value)).toBeGreaterThan(8)
    expect(ts.global.font.sans).toEqual({ value: 'Geist, ui-sans-serif, system-ui, -apple-system, Segoe UI, sans-serif', type: 'fontFamilies' })
    expect(ts.global.font.mono.value).toMatch(/^Geist Mono, /)
    expect(ts.light.color.bg).toEqual({ value: '#FAFAFA', type: 'color' })
    expect(ts.dark.color.bg).toEqual({ value: '#09090B', type: 'color' })
    expect(ts.light.color.band.value).toBe('rgba(37,99,235,0.13)')
    for (const m of ['light', 'dark']) {
      expect(Object.keys(ts[m])).toEqual(['color', 'shadow'])
      for (const [k, t] of Object.entries(ts[m].color as Record<string, { value: string; type: string }>)) {
        expect(t.type, k).toBe('color')
        expect(t.value, k).toMatch(/^(#[0-9A-F]{6}|rgba\(\d+,\d+,\d+,[\d.]+\))$/)
      }
      expect(Object.keys(ts[m].color)).toEqual(expect.arrayContaining(['bg', 'card', 'fg', 'primary', 'on-primary', 'accent', 'accent-soft', 'ok', 'warn', 'bad', 'bad-soft', 'c1', 'c2', 'c3', 'c4', 'c-neutral', 'band']))
      expect(ts[m].shadow.card.type).toBe('boxShadow')
      expect(ts[m].shadow.card.value).toHaveLength(2)
    }
    expect(ts.light.shadow.card.value[1]).toEqual({ x: '0', y: '10', blur: '30', spread: '0', color: 'rgba(0,0,0,.08)', type: 'dropShadow' })
    expect(ts.dark.shadow.card.value[1].color).toBe('rgba(0,0,0,.5)')
    expect(ts.$themes).toEqual([
      { id: 'light', name: 'Light', selectedTokenSets: { global: 'source', light: 'enabled' } },
      { id: 'dark', name: 'Dark', selectedTokenSets: { global: 'source', dark: 'enabled' } },
    ])
    expect(ts.$metadata).toEqual({ tokenSetOrder: ['global', 'light', 'dark'] })
  })

  it('drops tokens that could break out of the CSS, and a label that could close the comment', () => {
    const src: ThemeExportSource = { label: 'x */ </style><script>', modes: { light: { ...themeTokens(DEFAULT_THEME, false), fg: 'red;}</style>', accent: 'url(https://evil.test)' } } }
    for (const out of [themeToCSS(src), themeToTailwind(src), themeToShadcn(src)]) {
      expect(out).not.toMatch(/<\/style|<script|url\(|red;/)
      expect(out.indexOf('*/')).toBe(out.indexOf('\n') - 2) // only the header comment closes
    }
    expect(themeToCSS({ label: '', modes: {} })).toContain('--bg: #FAFAFA;') // nothing usable: the default theme
  })
})

describe('oklch', () => {
  it('converts exactly back to the same hex (every palette colour and a grid of colours)', () => {
    const colours = THEMES.flatMap(t => [...t.light, ...t.dark].flatMap(([, p]) => Object.values(p)))
    for (let r = 0; r < 256; r += 15) for (let g = 0; g < 256; g += 17) for (let b = 0; b < 256; b += 15) colours.push('#' + [r, g, b].map(v => v.toString(16).padStart(2, '0')).join('').toUpperCase())
    for (const c of colours) {
      const m = /^oklch\(([\d.]+) ([\d.]+) ([\d.]+)\)$/.exec(oklchString(c))!
      expect(oklchToHex(+m[1], +m[2], +m[3]), c).toBe(c)
    }
  })
  it('writes greys and white like shadcn', () => {
    expect(oklchString('#FFFFFF')).toBe('oklch(1 0 0)')
    expect(oklchString('#000000')).toBe('oklch(0 0 0)')
    expect(oklchString('#FFFFFF', 0.1)).toBe('oklch(1 0 0 / 10%)')
    const [L, C] = hexToOklch('#808080')
    expect(L).toBeCloseTo(0.5999, 3)
    expect(C).toBeLessThan(1e-4)
  })
})

describe('DTCG', () => {
  const isColour = (v: unknown) => {
    const c = v as { colorSpace: string; components: number[]; alpha?: number; hex: string }
    expect(c.colorSpace).toBe('srgb')
    expect(c.components).toHaveLength(3)
    for (const x of c.components) { expect(x).toBeGreaterThanOrEqual(0); expect(x).toBeLessThanOrEqual(1) }
    if (c.alpha !== undefined) expect(c.alpha).toBeLessThan(1)
    expect(c.hex).toMatch(/^#[0-9a-f]{6}$/)
  }
  const isDim = (v: unknown) => { expect(v).toEqual({ value: expect.any(Number), unit: 'px' }) }

  it('has the format shape: typed groups, $value on every token, dark values in $extensions', () => {
    const doc = themeToDTCGTokens(DEFAULT_THEME) as Record<string, Record<string, Record<string, unknown>>>
    expect(Object.keys(doc)).toEqual(['$description', '$extensions', 'color', 'radius', 'font', 'shadow'])
    expect(doc.color.$type).toBe('color'); expect(doc.radius.$type).toBe('dimension'); expect(doc.font.$type).toBe('fontFamily'); expect(doc.shadow.$type).toBe('shadow')
    for (const [g, group] of Object.entries(doc)) {
      if (g.startsWith('$')) continue
      for (const [name, token] of Object.entries(group)) {
        if (name.startsWith('$')) continue
        const t = token as { $value: unknown; $extensions?: Record<string, { modes: { dark: unknown } }> }
        expect(Object.keys(t).every(k => k === '$value' || k === '$extensions')).toBe(true)
        const values = [t.$value, ...(t.$extensions ? [t.$extensions['@lyndon/ui'].modes.dark] : [])]
        for (const v of values) {
          if (g === 'color') isColour(v)
          else if (g === 'radius') isDim(v)
          else if (g === 'font') expect(Array.isArray(v) && v.every(x => typeof x === 'string')).toBe(true)
          else for (const layer of v as Record<string, unknown>[]) { isColour(layer.color); for (const k of ['offsetX', 'offsetY', 'blur', 'spread']) isDim(layer[k]) }
        }
      }
    }
    expect(doc.color.bg.$extensions).toBeDefined()
    expect(doc.color.c3.$value).toMatchObject({ hex: '#f97316' })
    expect((doc.color.band.$value as { alpha: number }).alpha).toBe(0.13)
    expect(doc.radius.md.$extensions).toBeUndefined() // the same in dark
  })

  it("sets mode: a full tree per mode", () => {
    const doc = themeToDTCGTokens(DEFAULT_THEME, { modes: 'sets' }) as Record<string, Record<string, Record<string, Record<string, unknown>>>>
    expect(Object.keys(doc)).toEqual(['$description', 'light', 'dark'])
    expect(doc.dark.color.bg.$value).toMatchObject({ hex: '#09090b' })
    expect(doc.light.radius.md.$value).toEqual({ value: 8, unit: 'px' })
  })
})

describe('import', () => {
  it.each(THEMES.map(t => [t.id, t] as const))('shadcn round trip: export → import → export is unchanged (%s)', (_id, t) => {
    const s = { ...DEFAULT_THEME, theme: t.id, radius: 10 }
    const css = themeToShadcn(s), r = themeImport(css)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.format).toBe('shadcn')
    expect(r.radius).toBe(10)
    expect(themeToShadcn(sourceOf(themeExportSource(s).label, r.light, r.dark, r.radius!, s.font))).toBe(css)
    expect(r.notes.filter(n => n.code === 'contrast' || n.code === 'missing')).toEqual([])
  })

  it.each([['CSS', themeToCSS], ['Tailwind', themeToTailwind], ['DTCG', themeToDTCG], ['DTCG sets', (s: ThemeSettings) => themeToDTCG(s, { modes: 'sets' })], ['Tokens Studio', themeToTokensStudio]] as const)(
    '%s round trip gives back every palette colour, the radius and the font', (_n, fn) => {
      for (const t of THEMES) {
        const s = { ...DEFAULT_THEME, theme: t.id, radius: 6, font: 'IBM Plex Sans', variant: { [t.id]: t.dark.length - 1 } }
        const r = themeImport(fn(s))
        expect(r.ok, t.id).toBe(true)
        if (!r.ok) continue
        expect(r.light?.v, t.id).toEqual(themePaletteOf(s, false))
        expect(r.dark?.v, t.id).toEqual(themePaletteOf(s, true))
        expect([r.radius, r.font]).toEqual([6, 'IBM Plex Sans'])
      }
    })

  it("reads shadcn's own default theme (oklch with alpha, out-of-gamut red, no accent) and says what it changed", () => {
    const r = themeImport(SHADCN_NEUTRAL)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.light?.v.bg).toBe('#FFFFFF')
    expect(r.light?.v.fg).toBe('#0A0A0A')
    expect(r.dark?.dark).toBe(true)
    expect(r.radius).toBe(8)
    const codes = r.notes.map(n => `${n.mode} ${n.code} ${n.token}`)
    expect(codes).toContain('light missing accent') // a grey ring is not an accent
    expect(codes).toContain('light clipped bad') // destructive is outside sRGB
    expect(codes).toContain('dark blended line') // border is white at 10%
    for (const p of [r.light!, r.dark!]) {
      for (const v of Object.values(p.v)) expect(v).toMatch(/^#[0-9A-F]{6}$/)
      const d = derive(p.v, p.dark)
      for (const k of ['accent', 'ok', 'warn', 'bad']) expect(Math.min(contrast(d[k], d.card), contrast(d[k], d.bg))).toBeGreaterThanOrEqual(4.5)
    }
    const contrastNote = r.notes.find(n => n.code === 'contrast')
    if (contrastNote) expect(contrastNote.from).not.toBe(contrastNote.to)
  })

  it('reads the old shadcn format (bare HSL triplets) and hsl()/rgb()/hex values', () => {
    const r = themeImport(':root { --background: 0 0% 100%; --foreground: 222.2 84% 4.9%; --primary: hsl(222.2 47.4% 11.2%); --destructive: rgb(239 68 68); --ring: #3B82F6; --radius: 0.5rem }')
    expect(r.ok && r.light?.v).toMatchObject({ bg: '#FFFFFF', fg: '#020817', primary: '#0F172A', bad: '#EF4444', accent: '#3B82F6' })
    expect(r.ok && r.radius).toBe(6)
    expect(r.ok && r.dark).toBeNull()
  })

  it('resolves var() references and [data-theme] / @media dark blocks', () => {
    const r = themeImport(`:root { --brand: #7c3aed; --bg: #ffffff; --fg: #111111; --accent: var(--brand) }
      @media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) { --bg: #000; --fg: #eee } }`)
    expect(r.ok && r.format).toBe('css')
    expect(r.ok && r.light?.v.accent).toBe('#7C3AED')
    expect(r.ok && r.dark?.v).toMatchObject({ bg: '#000000', fg: '#EEEEEE', accent: '#7C3AED' })
  })

  it('reports a font it does not offer and keeps the current one', () => {
    const r = themeImport(':root { --bg: #fff; --fg: #000; --font: "Comic Neue", sans-serif }')
    expect(r.ok && r.font).toBeNull()
    expect(r.ok && r.notes).toContainEqual({ code: 'font', mode: 'light', token: 'font', from: 'Comic Neue' })
  })

  it.each([
    ['', 'empty'], ['   ', 'empty'], ['x'.repeat(200_001), 'too-large'], ['{"color": ', 'invalid-json'], ['body { color: red }', 'unrecognised'],
    [':root { --background: url(javascript:alert(1)); --foreground: expression(alert(1)) }', 'unrecognised'], ['{"color":{"bg":{"$value":"</style><script>"}}}', 'unrecognised'],
  ])('rejects %#', (text, error) => {
    expect(themeImport(text)).toEqual({ ok: false, error })
  })

  it('never lets anything but colours out, and does not pollute prototypes', () => {
    const r = themeImport('{"__proto__":{"polluted":true},"color":{"$type":"color","bg":{"$value":"#ffffff"},"fg":{"$value":"#000000"},"accent":{"$value":"red;}</style>"}},"font":{"sans":{"$type":"fontFamily","$value":["x\\"}</style>"]}}}')
    expect(({} as Record<string, unknown>).polluted).toBeUndefined()
    expect(r.ok).toBe(true)
    if (!r.ok) return
    for (const v of Object.values(r.light!.v)) expect(v).toMatch(/^#[0-9A-F]{6}$/)
    expect(r.font).toBeNull()
    expect(r.notes.find(n => n.code === 'font')?.from).toBeUndefined()
  })

  it('themeImportSettings applies the chosen palette with radius and font, validated', () => {
    const r = themeImport(themeToShadcn({ ...DEFAULT_THEME, theme: 'gruvbox', radius: 14 }))
    const s = themeImportSettings(r, { ...DEFAULT_THEME, font: 'Inter' }, 'dark')!
    expect(s.useCustom).toBe(true)
    expect(s.custom?.dark).toBe(true)
    expect(s.custom?.v.bg).toBe(THEMES.find(t => t.id === 'gruvbox')!.dark[0][1].bg)
    expect([s.radius, s.font]).toEqual([14, 'Inter'])
    expect(themeLoad(s)).toEqual(s)
    expect(themeImportSettings({ ok: false, error: 'empty' })).toBeNull()
  })
})

/** The palette themeTokens uses, as derive() outputs it (what an export carries). */
function themePaletteOf(s: ThemeSettings, dark: boolean) {
  const t = themeTokens(s, dark)
  return Object.fromEntries(['bg', 'card', 'muted', 'line', 'line2', 'fg', 'fg2', 'fg3', 'primary', 'on-primary', 'accent', 'ok', 'warn', 'bad', 'c3'].map(k => [k, t[k]]))
}

const SHADCN_NEUTRAL = `:root {
  --radius: 0.625rem; --background: oklch(1 0 0); --foreground: oklch(0.145 0 0); --card: oklch(1 0 0); --card-foreground: oklch(0.145 0 0);
  --primary: oklch(0.205 0 0); --primary-foreground: oklch(0.985 0 0); --secondary: oklch(0.97 0 0); --muted: oklch(0.97 0 0);
  --muted-foreground: oklch(0.556 0 0); --accent: oklch(0.97 0 0); --destructive: oklch(0.577 0.245 27.325); --border: oklch(0.922 0 0);
  --input: oklch(0.922 0 0); --ring: oklch(0.708 0 0); --chart-1: oklch(0.646 0.222 41.116); --chart-2: oklch(0.6 0.118 184.704); --chart-3: oklch(0.398 0.07 227.392);
}
.dark {
  --background: oklch(0.145 0 0); --foreground: oklch(0.985 0 0); --card: oklch(0.205 0 0); --primary: oklch(0.922 0 0); --primary-foreground: oklch(0.205 0 0);
  --muted: oklch(0.269 0 0); --muted-foreground: oklch(0.708 0 0); --destructive: oklch(0.704 0.191 22.216); --border: oklch(1 0 0 / 10%);
  --input: oklch(1 0 0 / 15%); --ring: oklch(0.556 0 0); --sidebar-primary: oklch(0.488 0.243 264.376);
}`

/* Share codes and links ────────────────────────────────────────────────────── */

const isValid = (s: ThemeSettings) => expect(themeLoad(s)).toEqual(s)

describe('share codes', () => {
  it('round-trips built-in themes (8 characters) and Custom palettes (68)', () => {
    for (const t of THEMES) for (const mode of ['system', 'light', 'dark'] as const) {
      const s = { ...DEFAULT_THEME, theme: t.id, mode, radius: 11.5, font: 'DM Sans', variant: t.dark.length > 1 ? { [t.id]: t.dark.length - 1 } : {} }
      const code = themeShareEncode(s)
      expect(code).toMatch(/^[A-Za-z0-9_-]{8}$/)
      expect(themeShareDecode(code)).toEqual(s)
    }
    for (const s of [LIGHT_CUSTOM, DARK_CUSTOM]) {
      const code = themeShareEncode(s)
      expect(code).toMatch(/^[A-Za-z0-9_-]{68}$/)
      expect(themeShareDecode(code)).toEqual(themeLoad(s))
    }
  })

  it('keeps what the code does not carry from the base settings', () => {
    const base = { ...DEFAULT_THEME, variant: { tokyo: 1 }, custom: LIGHT_CUSTOM.custom }
    expect(themeShareDecode(themeShareEncode({ ...DEFAULT_THEME, theme: 'ayu', variant: { ayu: 1 } }), base)).toMatchObject({ theme: 'ayu', variant: { tokyo: 1, ayu: 1 }, custom: LIGHT_CUSTOM.custom, useCustom: false })
  })

  const b64 = (bytes: number[]) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
  it.each([
    ['not a string', 42], ['empty', ''], ['too short', 'AQAg'], ['too long', 'A'.repeat(81)], ['bad characters', 'AQAgAAAA<script>'], ['padding', 'AQAgAAAA=='],
    ['script', '"><img src=x onerror=alert(1)>'], ['proto', '__proto__'], ['version 2', b64([2, 0, 32, 0, 0, 0])], ['version 0', b64([0, 0, 32, 0, 0, 0])],
    ['unknown flags', b64([1, 16, 32, 0, 0, 0])], ['mode 3', b64([1, 3, 32, 0, 0, 0])], ['radius out of range', b64([1, 0, 200, 0, 0, 0])],
    ['font index', b64([1, 0, 32, 99, 0, 0])], ['theme index', b64([1, 0, 32, 0, 99, 0])], ['variant index', b64([1, 0, 32, 0, 0, 5])],
    ['custom flag without palette', b64([1, 4, 32, 0, 0, 0])], ['palette without flag', b64([1, 0, 32, 0, 0, 0, ...Array(45).fill(255)])],
    ['short palette', b64([1, 4, 32, 0, 0, 0, ...Array(44).fill(255)])], ['trailing bytes', b64([1, 0, 32, 0, 0, 0, 0, 0, 0])],
  ])('rejects %s', (_n, code) => {
    expect(themeShareDecode(code)).toBeNull()
    expect(themeFromUrl(`https://app.test/#theme=${encodeURIComponent(String(code))}`)).toBeNull()
  })

  it('accepts any 45 palette bytes as colours, and the result passes the storage rules', () => {
    const s = themeShareDecode(b64([1, 4 | 8 | 2, 128, 5, 6, 1, ...Array.from({ length: 45 }, (_, i) => (i * 37) % 256)]))!
    isValid(s)
    expect(s).toMatchObject({ mode: 'dark', radius: 32, font: 'JetBrains Mono', theme: 'tokyo', useCustom: true, custom: { dark: true } })
  })

  it('links: hash by default, query on request, other parameters kept, relative stays relative', () => {
    const s = { ...DEFAULT_THEME, theme: 'nord', mode: 'dark' as const }, code = themeShareEncode(s)
    expect(themeShareUrl(s, 'https://app.test/docs?tab=2#intro')).toBe(`https://app.test/docs?tab=2#intro=&theme=${code}`)
    expect(themeShareUrl(s, 'https://app.test/?theme=old', { param: 'query' })).toBe(`https://app.test/?theme=${code}`)
    expect(themeShareUrl(s, '/builder')).toBe(`/builder#theme=${code}`)
    // an old code is replaced, wherever it was, and nothing else is lost
    expect(themeShareUrl(s, 'https://app.test/#a=1&theme=old&b=2')).toBe(`https://app.test/#a=1&b=2&theme=${code}`)
    expect(themeShareUrl(s, 'https://app.test/?theme=old#a=1')).toBe(`https://app.test/#a=1&theme=${code}`)
    expect(themeFromUrl(themeShareUrl(s, 'https://app.test/docs?tab=2'))).toEqual(s)
    expect(themeFromUrl(`https://app.test/?theme=${code}`)).toEqual(s)
    expect(themeFromUrl(new URL(`https://app.test/#a=1&theme=${code}`))).toEqual(s)
    expect(themeFromUrl('https://app.test/')).toBeNull()
    expect(themeFromUrl('::not a url')).toBeNull()
  })
})

describe('UIProvider themeFromUrl', () => {
  afterEach(() => history.replaceState(null, '', '/'))
  function Probe() {
    const { settings, dark } = useTheme()
    return <output data-testid="theme">{JSON.stringify({ theme: settings.theme, mode: settings.mode, radius: settings.radius, useCustom: settings.useCustom, dark })}</output>
  }
  const shown = () => JSON.parse(screen.getByTestId('theme').textContent!)
  const code = themeShareEncode({ ...DEFAULT_THEME, theme: 'solarized', mode: 'dark', radius: 3 })

  it('is off by default: the link is ignored and left in the address bar', () => {
    history.replaceState(null, '', `/page?x=1#theme=${code}`)
    render(<UIProvider><Probe /></UIProvider>)
    expect(shown()).toMatchObject({ theme: 'default', mode: 'system', radius: 8 })
    expect(location.hash).toBe(`#theme=${code}`)
  })

  it('applies a valid link over the saved theme, saves it and removes the parameter', () => {
    localStorage.setItem(THEME_STORAGE_KEY, JSON.stringify({ theme: 'nord', radius: 12 }))
    history.replaceState(null, '', `/page?x=1#theme=${code}`)
    render(<UIProvider themeFromUrl><Probe /></UIProvider>)
    expect(shown()).toMatchObject({ theme: 'solarized', mode: 'dark', radius: 3, dark: true })
    expect(location.pathname + location.search + location.hash).toBe('/page?x=1')
    expect(JSON.parse(localStorage.getItem(THEME_STORAGE_KEY)!)).toMatchObject({ theme: 'solarized', mode: 'dark', radius: 3 })
    expect(document.documentElement.dataset.theme).toBe('dark')
  })

  it('applies a Custom palette from a link', () => {
    history.replaceState(null, '', `/?theme=${themeShareEncode(DARK_CUSTOM)}`)
    render(<UIProvider themeFromUrl><Probe /></UIProvider>)
    expect(shown()).toMatchObject({ useCustom: true, dark: true, radius: 4 })
  })

  it('ignores junk and keeps the saved theme', () => {
    localStorage.setItem(THEME_STORAGE_KEY, JSON.stringify({ theme: 'nord' }))
    history.replaceState(null, '', '/#theme=AAAAAAAAAAAA')
    render(<UIProvider themeFromUrl><Probe /></UIProvider>)
    expect(shown().theme).toBe('nord')
    expect(location.hash).toBe('')
  })
})

/* The panel ─────────────────────────────────────────────────────────────── */

describe('AppearancePanel export and import', () => {
  function Probe() {
    const { settings } = useTheme()
    return <output data-testid="settings">{JSON.stringify(settings)}</output>
  }
  it('shows each format, imports a shadcn theme and applies it as Custom', async () => {
    const user = userEvent.setup()
    render(<UIProvider persist={false} defaultTheme={{ mode: 'light' }}><AppearancePanel /><Probe /></UIProvider>)
    await user.click(screen.getByRole('button', { name: /Export and share/ }))
    expect(screen.getByRole('tab', { name: 'CSS' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('region', { name: 'CSS code' }).textContent).toContain(':root {')
    expect(screen.getByLabelText('CSS code').textContent).toContain('--bg: #FAFAFA;')
    await user.click(screen.getByRole('tab', { name: 'shadcn' }))
    expect(screen.getByLabelText('shadcn code').textContent).toContain('--radius: 0.625rem;')
    await user.click(screen.getByRole('tab', { name: 'DTCG' }))
    expect(JSON.parse(screen.getByLabelText('DTCG code').textContent!).color.$type).toBe('color')
    await user.click(screen.getByRole('button', { name: 'Import' }))
    const box = screen.getByRole('textbox', { name: 'Theme CSS or JSON' })
    fireEvent.change(box, { target: { value: '{ nope' } })
    expect(screen.getByText('That JSON could not be read')).toBeInTheDocument()
    fireEvent.change(box, { target: { value: SHADCN_NEUTRAL } })
    expect(screen.getByText('shadcn theme · light and dark')).toBeInTheDocument()
    expect(screen.getByText(/changes?$/)).toBeInTheDocument()
    expect(screen.getByText('accent: not set, so the default is used')).toBeInTheDocument()
    await user.click(within(screen.getByRole('radiogroup', { name: 'Palette to apply' })).getByRole('radio', { name: 'Dark' }))
    await user.click(screen.getByRole('button', { name: 'Apply as Custom theme' }))
    const s = JSON.parse(screen.getByTestId('settings').textContent!) as ThemeSettings
    expect(s.useCustom).toBe(true)
    expect(s.custom?.dark).toBe(true)
    expect(s.custom?.v.bg).toBe('#0A0A0A')
    expect(s.radius).toBe(8)
  })

  it('copies a share link', async () => {
    const user = userEvent.setup()
    let copied = ''
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async (v: string) => { copied = v } } })
    render(<UIProvider persist={false} defaultTheme={{ theme: 'ayu', mode: 'dark' }}><AppearancePanel /></UIProvider>)
    await user.click(screen.getByRole('button', { name: /Export and share/ }))
    await act(async () => { await user.click(screen.getByRole('button', { name: 'Copy share link' })) })
    expect(themeFromUrl(copied)).toMatchObject({ theme: 'ayu', mode: 'dark' })
  })
})

describe('derive() fills every soft tint', () => {
  const rgbOf = (h: string) => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16))
  /** `soft` is a tint of `c` toward `card`: every channel between the two, and nearer the card (at most a fifth of the way from it). */
  const isTintOf = (soft: string, c: string, card: string, what: string) => {
    const S = rgbOf(soft), C = rgbOf(c), K = rgbOf(card)
    S.forEach((v, i) => {
      expect(v, what).toBeGreaterThanOrEqual(Math.min(C[i], K[i]) - 1)
      expect(v, what).toBeLessThanOrEqual(Math.max(C[i], K[i]) + 1)
      expect(Math.abs(v - K[i]), what).toBeLessThanOrEqual(Math.abs(C[i] - K[i]) * 0.2 + 1)
    })
  }
  it('includes bad-soft (it was lost to a comment): a light tint of bad, not a copy of another token', () => {
    for (const t of THEMES) for (const dark of [false, true]) {
      const tk = themeTokens({ ...DEFAULT_THEME, theme: t.id }, dark), what = `${t.id} ${dark ? 'dark' : 'light'}`
      for (const k of ['accent-soft', 'ok-soft', 'warn-soft', 'bad-soft']) expect(tk[k], `${what} ${k}`).toMatch(/^#[0-9A-F]{6}$/)
      for (const k of ['accent', 'ok', 'bad']) isTintOf(tk[`${k}-soft`], tk[k], tk.card, `${what} ${k}-soft`)
      for (const other of ['bad', 'bg', 'card', 'ok-soft', 'warn-soft', 'accent-soft']) expect(tk['bad-soft'], `${what} bad-soft vs ${other}`).not.toBe(tk[other])
    }
  })
})
