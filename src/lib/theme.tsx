/** Theme engine: tokens (TOKENS, FONT_CSS), palettes (THEMES), derive(), validated storage, the circular reveal, ThemeProvider and useTheme. Part of @lyndon/ui/core. */
import { createContext, type CSSProperties, type ReactNode, useEffect, useLayoutEffect, useMemo, useState } from 'react'
import { flushSync } from 'react-dom'
import { clamp } from './helpers'
import { uiShared } from './shared'
import { useMediaQuery, useRequiredContext } from './hooks'
import { safeCssValue } from './safe'

const LIGHT = `--bg:#FAFAFA;--card:#FFFFFF;--muted:#F4F4F5;--line:#E4E4E7;--line2:#D4D4D8;--fg:#09090B;--fg2:#52525B;--fg3:#68686F;
--primary:#18181B;--on-primary:#FAFAFA;--accent:#2563EB;--accent-soft:#EFF4FF;--ok:#15803D;--ok-soft:#ECFDF3;--warn:#B45309;--warn-soft:#FFF7E6;
--bad:#DC2626;--bad-soft:#FEF2F2;--c1:#18181B;--c2:#2563EB;--c3:#F97316;--c4:#16A34A;--c-neutral:#6B6B6D;--band:rgba(37,99,235,.12);
--shadow:0 1px 2px rgba(0,0,0,.04),0 10px 30px rgba(0,0,0,.08);color-scheme:light;`

const DARK = `--bg:#09090B;--card:#111113;--muted:#1A1A1D;--line:#27272A;--line2:#3F3F46;--fg:#FAFAFA;--fg2:#A1A1AA;--fg3:#8E8E98;
--primary:#FAFAFA;--on-primary:#09090B;--accent:#60A5FA;--accent-soft:#132036;--ok:#4ADE80;--ok-soft:#0F2417;--warn:#FBBF24;--warn-soft:#2A1F08;
--bad:#F87171;--bad-soft:#2A1111;--c1:#FAFAFA;--c2:#60A5FA;--c3:#FB923C;--c4:#4ADE80;--c-neutral:#9D9D9E;--band:rgba(96,165,250,.16);
--shadow:0 1px 2px rgba(0,0,0,.3),0 10px 30px rgba(0,0,0,.5);color-scheme:dark;`

/**
 * The whole theme. Edit these values to re-skin every component. Also holds the touch rules: on coarse pointers text
 * fields are 16px (no iOS zoom on focus), and `.ui-hit` gives any element an invisible hit area of at least 36px
 * (set `--hit` to change it) without changing how it looks. `.ui-target` does the same on every pointer: at least 24×24px
 * with a mouse (WCAG 2.5.8) and 36px on touch, for tiny controls such as a chip's remove ×.
 * Scales (see CONVENTIONS.md): radius --r-sm/md/lg/full (from the theme radius), type --t-xs…--t-2xl
 * (11/12/13/14/16/22/28px) and control heights --h-xs/sm/md/lg (24/30/36/40px). Nothing here styles `html` or `body`: text styles are
 * scoped to `.ui-root` (UIProvider themes the page background with target="html"; FONT_CSS is the Google Fonts import).
 */
export const TOKENS = `:root{${LIGHT}--font:"Geist",ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif;--mono:"Geist Mono",ui-monospace,"SF Mono",Menlo,monospace;--r-sm:4px;--r-md:8px;--r-lg:14px;--r-full:9999px;
--t-xs:11px;--t-sm:12px;--t-md:13px;--t-base:14px;--t-lg:16px;--t-xl:22px;--t-2xl:28px;--h-xs:24px;--h-sm:30px;--h-md:36px;--h-lg:40px}
@media (prefers-color-scheme:dark){:root:not([data-theme="light"]){${DARK}}}
:root[data-theme="dark"]{${DARK}}
@layer base{.ui-root{font:14px/1.5 var(--font);color:var(--fg);-webkit-font-smoothing:antialiased;-webkit-text-size-adjust:100%;text-size-adjust:100%}
.ui-root button,.ui-root input,.ui-root select,.ui-root textarea{font:inherit;color:inherit}
.ui-root :focus-visible{outline:2px solid var(--accent);outline-offset:2px}}
@layer components{.ui-num{font-family:var(--mono);font-variant-numeric:tabular-nums}}
::view-transition-old(root),::view-transition-new(root){animation:none;mix-blend-mode:normal}
html.ui-theming *,html.ui-theming *::before,html.ui-theming *::after{transition:background-color .35s ease,color .35s ease,border-color .35s ease,fill .35s ease,stroke .35s ease!important}
.ui-shimmer{position:relative;overflow:hidden}
.ui-shimmer::after{content:"";position:absolute;inset:0;transform:translateX(-100%);background:linear-gradient(90deg,transparent,color-mix(in srgb,var(--card) 70%,transparent),transparent);animation:ui-shim 1.3s infinite;animation-play-state:var(--ui-play,running)}
@keyframes ui-shim{to{transform:translateX(100%)}}
@keyframes ui-blink{50%{opacity:0}}
.ui-caret::after{content:"▍";margin-left:1px;animation:ui-blink 1s steps(1) infinite;animation-play-state:var(--ui-play,running);color:var(--fg3)}
@media (prefers-reduced-motion:reduce){.ui-shimmer::after,.ui-caret::after{animation:none}}
@media (pointer:coarse){
.ui-root input:not([type=checkbox],[type=radio],[type=range],[type=color],[type=file],[type=button],[type=submit]),.ui-root select,.ui-root textarea,.ui-root [contenteditable="true"],.ui-root [contenteditable=""]{font-size:16px}
.ui-root button,.ui-root a,.ui-root [role=button],.ui-root [role=option],.ui-root [role=menuitem],.ui-root [role=tab]{-webkit-tap-highlight-color:transparent}}
@layer base{@media (pointer:coarse){.ui-hit{position:relative}.ui-hit::after{content:"";position:absolute;left:50%;top:50%;width:max(100%,var(--hit,36px));height:max(100%,var(--hit,36px));transform:translate(-50%,-50%)}}
.ui-target{position:relative}.ui-target::after{content:"";position:absolute;left:50%;top:50%;width:max(100%,24px);height:max(100%,24px);transform:translate(-50%,-50%)}
@media (pointer:coarse){.ui-target::after{width:max(100%,var(--hit,36px));height:max(100%,var(--hit,36px))}}}`

/** The Google Fonts import for Geist and Geist Mono. UIProvider adds it unless `fonts={false}`. */
export const FONT_CSS = "@import url('https://fonts.googleapis.com/css2?family=Geist:wght@400;500;600&family=Geist+Mono:wght@400;500&display=swap');"

/*
 * A theme is two palettes of 15 base colours (light and dark). derive() fills in the rest:
 * soft tints, chart colours (c1–c4 plus c-neutral, a mid-grey series colour that reads at 4.5:1 on cards in light and
 * dark), band and shadow, and nudges secondary text until it reads at 4.5:1. */

const BASE = ['bg', 'card', 'muted', 'line', 'line2', 'fg', 'fg2', 'fg3', 'primary', 'on-primary', 'accent', 'ok', 'warn', 'bad', 'c3'] as const

export type Palette = Record<(typeof BASE)[number], string>

/** The 15 keys of a Palette, in order (the order the share code and exporters use). */
export const THEME_PALETTE_KEYS: readonly (keyof Palette)[] = BASE

const P = (...c: string[]) => Object.fromEntries(BASE.map((k, i) => [k, c[i]])) as Palette

/** A theme family: one or more light palettes and one or more dark palettes, each with a name (e.g. Ayu Light · Mirage · Dark). */
export type Theme = { id: string; name: string; light: [string, Palette][]; dark: [string, Palette][] }

export const THEMES: Theme[] = [
 { id: 'default', name: 'Default', light: [['Light', P('#FAFAFA', '#FFFFFF', '#F4F4F5', '#E4E4E7', '#D4D4D8', '#09090B', '#52525B', '#68686F', '#18181B', '#FAFAFA', '#2563EB', '#15803D', '#B45309', '#DC2626', '#F97316')]], dark: [['Dark', P('#09090B', '#111113', '#1A1A1D', '#27272A', '#3F3F46', '#FAFAFA', '#A1A1AA', '#8E8E98', '#FAFAFA', '#09090B', '#60A5FA', '#4ADE80', '#FBBF24', '#F87171', '#FB923C')]] },
 { id: 'atom', name: 'Atom One', light: [['Light', P('#F5F5F6', '#FAFAFA', '#EDEDEE', '#E1E1E3', '#CFCFD2', '#383A42', '#696C77', '#A0A1A7', '#4078F2', '#FFFFFF', '#4078F2', '#50A14F', '#C18401', '#E45649', '#986801')]], dark: [['Dark', P('#21252B', '#282C34', '#2F343D', '#3A3F4B', '#4B5263', '#D7DAE0', '#ABB2BF', '#6B7280', '#61AFEF', '#21252B', '#61AFEF', '#98C379', '#E5C07B', '#E06C75', '#D19A66')]] },
 { id: 'ayu', name: 'Ayu', light: [['Light', P('#F3F4F5', '#FCFCFC', '#EEEFF1', '#E4E5E7', '#D3D5D8', '#5C6166', '#787B80', '#ADAEB1', '#FF9940', '#FFFFFF', '#399EE6', '#86B300', '#F2AE49', '#F07171', '#FA8D3E')]], dark: [['Mirage', P('#1C212B', '#242936', '#2A3040', '#343B4C', '#434B5E', '#CCCAC2', '#A0A4AD', '#707A8C', '#FFCC66', '#1F2430', '#73D0FF', '#D5FF80', '#FFD173', '#F28779', '#F29E74')], ['Dark', P('#0B0E14', '#0F131A', '#151A23', '#1E2430', '#2D3442', '#BFBDB6', '#8F8E8A', '#5A606B', '#E6B450', '#0B0E14', '#59C2FF', '#AAD94C', '#FFB454', '#F07178', '#FF8F40')]] },
 { id: 'gruvbox', name: 'Gruvbox', light: [['Light', P('#F2E5BC', '#FBF1C7', '#EBDBB2', '#E0D0A6', '#D5C4A1', '#3C3836', '#665C54', '#928374', '#AF3A03', '#FBF1C7', '#076678', '#79740E', '#B57614', '#9D0006', '#D65D0E')]], dark: [['Dark', P('#1D2021', '#282828', '#32302F', '#3C3836', '#504945', '#EBDBB2', '#BDAE93', '#928374', '#FE8019', '#1D2021', '#83A598', '#B8BB26', '#FABD2F', '#FB4934', '#FE8019')]] },
 { id: 'solarized', name: 'Solarized', light: [['Light', P('#EEE8D5', '#FDF6E3', '#F2ECD9', '#E2DBC5', '#D3CBB2', '#073642', '#586E75', '#93A1A1', '#268BD2', '#FDF6E3', '#268BD2', '#859900', '#B58900', '#DC322F', '#CB4B16')]], dark: [['Dark', P('#00212B', '#002B36', '#073642', '#0E4150', '#1F5261', '#EEE8D5', '#93A1A1', '#657B83', '#268BD2', '#FDF6E3', '#2AA198', '#859900', '#B58900', '#DC322F', '#CB4B16')]] },
 { id: 'nord', name: 'Nord', light: [['Light', P('#E5E9F0', '#ECEFF4', '#E1E6EE', '#D8DEE9', '#C5CDDB', '#2E3440', '#4C566A', '#8C96AA', '#5E81AC', '#ECEFF4', '#5E81AC', '#6C8E4E', '#B48A2E', '#BF616A', '#D08770')]], dark: [['Dark', P('#2E3440', '#3B4252', '#434C5E', '#4C566A', '#5A657C', '#ECEFF4', '#D8DEE9', '#8C96AA', '#88C0D0', '#2E3440', '#81A1C1', '#A3BE8C', '#EBCB8B', '#BF616A', '#D08770')]] },
 { id: 'tokyo', name: 'Tokyo Night', light: [['Day', P('#D5D6DB', '#E1E2E7', '#D8D9DE', '#C8C9D0', '#B4B5BE', '#343B58', '#4C5372', '#8990B3', '#2E7DE9', '#FFFFFF', '#2E7DE9', '#587539', '#8C6C3E', '#F52A65', '#B15C00')]], dark: [['Night', P('#16161E', '#1A1B26', '#24283B', '#292E42', '#3B4261', '#C0CAF5', '#A9B1D6', '#565F89', '#7AA2F7', '#16161E', '#7DCFFF', '#9ECE6A', '#E0AF68', '#F7768E', '#FF9E64')], ['Storm', P('#1F2335', '#24283B', '#2A2F45', '#33384F', '#414868', '#C0CAF5', '#A9B1D6', '#5C6594', '#7AA2F7', '#1F2335', '#7DCFFF', '#9ECE6A', '#E0AF68', '#F7768E', '#FF9E64')]] }
]

/** Font choices: [family, Google Fonts query or null if already loaded]. */
export const FONTS: [string, string | null][] = [['Geist', null], ['Inter', 'Inter:wght@400;500;600'], ['IBM Plex Sans', 'IBM+Plex+Sans:wght@400;500;600'], ['Manrope', 'Manrope:wght@400;500;600'], ['DM Sans', 'DM+Sans:wght@400;500;600'], ['JetBrains Mono', 'JetBrains+Mono:wght@400;500;600']]

/** Fonts already linked on this page (shared by every copy of the library). */
const loadedFonts = uiShared('fonts', () => new Set(['Geist']))

/**
 * Add the Google Fonts stylesheet for one of FONTS (once). Does nothing on the server. Components call it only when
 * the provider has `fonts` on (see `useTheme().fonts`); calling it yourself always fetches from fonts.googleapis.com.
 */
export function loadFont(family: string) {
  const q = FONTS.find(f => f[0] === family)?.[1]
  if (!q || loadedFonts.has(family) || typeof document === 'undefined') return
  const l = document.createElement('link'); l.rel = 'stylesheet'; l.href = `https://fonts.googleapis.com/css2?family=${q}&display=swap`
  document.head.appendChild(l); loadedFonts.add(family)
}

/** '#RRGGBB' → [r, g, b] (0–255). Anything else (a non-string, '#FFF', junk) reads as black instead of throwing. */
export const rgb = (h: string) => {
  const x = typeof h === 'string' ? h.trim().replace(/^#/, '') : ''
  return [0, 2, 4].map(i => { const n = parseInt(x.slice(i, i + 2), 16); return Number.isFinite(n) ? n : 0 })
}

/** [r, g, b] (0–255, clamped) → '#RRGGBB'. */
export const hex = (a: number[]) => '#' + a.map(v => Math.round(Math.max(0, Math.min(255, Number.isFinite(v) ? v : 0))).toString(16).padStart(2, '0')).join('').toUpperCase()

/** Blend two hex colours: mix('#000000', '#FFFFFF', 0.5) → '#808080' */
export const mix = (a: string, b: string, t: number) => { const A = rgb(a), B = rgb(b); return hex(A.map((v, i) => v + (B[i] - v) * t)) }

/** WCAG relative luminance of a '#RRGGBB' colour (0 black … 1 white). */
export const luminance = (h: string) => { const [r, g, b] = rgb(h).map(v => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4 }); return 0.2126 * r + 0.7152 * g + 0.0722 * b }

/** WCAG contrast ratio between two hex colours (1–21). */
export const contrast = (a: string, b: string) => { const x = luminance(a), y = luminance(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05) }

const readable = (c: string, bg: string, toward: string, min = 4.5) => { for (let i = 0; i < 12 && contrast(c, bg) < min; i++) c = mix(c, toward, 0.12); return c }

const THEME_SHADOW_LIGHT = '0 1px 2px rgba(0,0,0,.04),0 10px 30px rgba(0,0,0,.08)'

const THEME_SHADOW_DARK = '0 1px 2px rgba(0,0,0,.3),0 10px 30px rgba(0,0,0,.5)'

const THEME_FONT_TAIL = ',ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif'

/**
 * Text on a filled background (primary buttons): the pair that reaches 4.5:1 while changing the look least. In order:
 * keep both; push the ink to pure white/black on its own side; darken or lighten the fill by up to 25% (mixing toward
 * black or white keeps its hue); switch to the palette's ink on the other side (nudged until it reads); black or white.
 */
function themeOnFill(fill: string, ink: string, lightInk: string, darkInk: string): { fill: string; ink: string } {
  const ok = (i: string, f: string) => contrast(i, f) >= 4.5
  if (ok(ink, fill)) return { fill, ink }
  const inkLight = luminance(ink) > luminance(fill), extreme = inkLight ? '#FFFFFF' : '#000000'
  const pushed = readable(ink, fill, extreme)
  if (ok(pushed, fill)) return { fill, ink: pushed }
  for (let t = 0.04; t <= 0.25 + 1e-9; t += 0.03) { const f = mix(fill, inkLight ? '#000000' : '#FFFFFF', t); if (ok(ink, f)) return { fill: f, ink } }
  const other = inkLight ? readable(darkInk, fill, '#000000') : readable(lightInk, fill, '#FFFFFF')
  if (ok(other, fill)) return { fill, ink: other }
  return { fill, ink: contrast('#000000', fill) >= contrast('#FFFFFF', fill) ? '#000000' : '#FFFFFF' }
}

/** A colour used both as text on card/bg and as a fill under card-coloured text: nudged (hue kept) until it reads 4.5:1 on both. */
const themeReadableOn = (c: string, card: string, bg: string) => {
  const toward = luminance(card) < 0.2 ? '#FFFFFF' : '#000000'
  for (let i = 0; i < 16 && Math.min(contrast(c, card), contrast(c, bg)) < 4.5; i++) c = mix(c, toward, 0.08)
  return Math.min(contrast(c, card), contrast(c, bg)) < 4.5 ? mix(c, toward, 0.85) : c // last resort for odd custom palettes
}

/**
 * Expand a palette into every token the components use. Guarantees 4.5:1 for: fg, fg2, fg3 and c-neutral on card;
 * on-primary on primary (see themeOnFill); and accent, ok, warn and bad against card and bg, which covers both their use as
 * text (links, errors) and as fills under card-coloured text (accent and danger buttons, done ticks). Palettes that
 * already pass are returned unchanged.
 */
export function derive(p: Palette, dark: boolean): Record<string, string> {
  const soft = (c: string) => mix(c, p.card, dark ? 0.82 : 0.88)
  const [lightInk, darkInk] = luminance(p.fg) > luminance(p.card) ? [p.fg, p.card] : [p.card, p.fg]
  const onP = themeOnFill(p.primary, p['on-primary'], lightInk, darkInk)
  const accent = themeReadableOn(p.accent, p.card, p.bg), ok = themeReadableOn(p.ok, p.card, p.bg), bad = themeReadableOn(p.bad, p.card, p.bg)
  const warn = themeReadableOn(p.warn, p.card, p.bg)
  const [r, g, b] = rgb(accent)
  return {
    ...p, primary: onP.fill, 'on-primary': onP.ink, accent, ok, bad, warn,
    fg2: readable(p.fg2, p.card, p.fg), fg3: readable(p.fg3, p.card, p.fg),
    // warn-soft tints the palette's own amber, so it stays light even when --warn is darkened to read as text
    'accent-soft': soft(accent), 'ok-soft': soft(ok), 'warn-soft': soft(p.warn), 'bad-soft': soft(bad),
    c1: p.fg, c2: accent, c3: p.c3, c4: ok, 'c-neutral': readable(mix(p.fg, p.card, 0.4), p.card, p.fg), band: `rgba(${r},${g},${b},${dark ? 0.18 : 0.13})`,
    shadow: dark ? THEME_SHADOW_DARK : THEME_SHADOW_LIGHT,
  }
}

/** A palette the user made in the Customise grid. `dark` says which way it leans. */
export type CustomTheme = { dark: boolean; v: Palette }

/**
 * Saved appearance. `theme` is the family id, `variant` the chosen palette per family (index into its
 * light or dark list), and `custom` the user's own palette, used while `useCustom` is on.
 */
export type ThemeSettings = {
  theme: string; mode: 'system' | 'light' | 'dark'; radius: number; font: string
  variant: Record<string, number>; custom: CustomTheme | null; useCustom: boolean
}

export const DEFAULT_THEME: ThemeSettings = { theme: 'default', mode: 'system', radius: 8, font: 'Geist', variant: {}, custom: null, useCustom: false }

/** The localStorage key ThemeProvider, UIProvider and ThemeScript use by default (versioned; 'ui-theme' is migrated once). */
export const THEME_STORAGE_KEY = 'ui-theme:v1'

/** The original unversioned key, read once and migrated to THEME_STORAGE_KEY. */
export const THEME_LEGACY_KEY = 'ui-theme'

/*
 * Saved settings are same-origin state that anything on the origin (another app, an extension, an old version) can
 * write. Every field is checked against what the library itself produces; anything else falls back to the default. */

const THEME_HEX = /^#[0-9a-f]{6}$/i

const THEME_RADIUS_MAX = 32

const themeIsHex = (v: unknown): v is string => typeof v === 'string' && THEME_HEX.test(v)

const themeOwn = (o: object, k: string): unknown => (Object.hasOwn(o, k) ? (o as Record<string, unknown>)[k] : undefined)

const themeRadius = (v: unknown, fallback: number) => (typeof v === 'number' && Number.isFinite(v) ? clamp(v, 0, THEME_RADIUS_MAX) : fallback)

/** A font family that is safe inside `"…"` in CSS (letters, digits, spaces and hyphens). */
const themeFontName = (v: unknown): v is string => typeof v === 'string' && /^[A-Za-z0-9 -]{1,40}$/.test(v)

/** A palette with exactly the BASE keys, each '#RRGGBB'; bad or missing values come from `fallback`. */
function themeCleanPalette(v: unknown, fallback: Palette): Palette {
  const src = v && typeof v === 'object' ? v : {}
  const out = {} as Palette
  for (const k of BASE) { const c = themeOwn(src, k); out[k] = themeIsHex(c) ? c.toUpperCase() : fallback[k] }
  return out
}

/** Per-family palette indexes: only known family ids, each an integer within that family's light/dark lists. */
function themeCleanVariant(v: unknown): Record<string, number> {
  const out: Record<string, number> = {}
  if (!v || typeof v !== 'object' || Array.isArray(v)) return out
  for (const t of THEMES) {
    const i = themeOwn(v, t.id)
    if (Number.isInteger(i) && (i as number) >= 0 && (i as number) < Math.max(t.light.length, t.dark.length)) out[t.id] = i as number
  }
  return out
}

/**
 * Read saved settings strictly: each field must be something the library itself writes (a known theme id and font,
 * a light/dark/system mode, in-range integer variants, a finite radius clamped to 0–32, a custom palette of BASE keys
 * with '#RRGGBB' values). Invalid fields fall back to `base`; this never throws.
 */
export function themeLoad(raw: unknown, base: ThemeSettings = DEFAULT_THEME): ThemeSettings {
  const fallback = { ...base, variant: { ...base.variant } }
  try {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return fallback
    const r = raw as object
    const theme = themeOwn(r, 'theme'), mode = themeOwn(r, 'mode'), font = themeOwn(r, 'font'), rc = themeOwn(r, 'custom')
    const cv = rc && typeof rc === 'object' ? themeOwn(rc, 'v') : undefined
    const custom: CustomTheme | null = cv && typeof cv === 'object' && themeIsHex(themeOwn(cv, 'bg'))
      ? { dark: themeOwn(rc as object, 'dark') === true, v: themeCleanPalette(cv, THEMES[0].light[0][1]) } : fallback.custom
    return {
      theme: typeof theme === 'string' && THEMES.some(t => t.id === theme) ? theme : fallback.theme,
      mode: mode === 'light' || mode === 'dark' || mode === 'system' ? mode : fallback.mode,
      radius: themeRadius(themeOwn(r, 'radius'), fallback.radius),
      font: typeof font === 'string' && FONTS.some(f => f[0] === font) ? font : fallback.font,
      variant: Object.hasOwn(r, 'variant') ? themeCleanVariant(themeOwn(r, 'variant')) : fallback.variant,
      custom, useCustom: themeOwn(r, 'useCustom') === true && !!custom,
    }
  } catch { return fallback }
}

/** The palette a set of settings resolves to, with its display name ("Ayu Mirage", "Custom"). Never throws. */
export function themePalette(s: ThemeSettings, dark: boolean): { v: Palette; dark: boolean; label: string } {

  if (s?.useCustom && s.custom && typeof s.custom === 'object') return { v: themeCleanPalette(s.custom.v, THEMES[0].light[0][1]), dark: s.custom.dark === true, label: 'Custom' }
  const t = THEMES.find(x => x.id === s?.theme) ?? THEMES[0], list = dark ? t.dark : t.light
  const i = s?.variant && typeof s.variant === 'object' ? s.variant[t.id] : 0
  const [name, v] = list[Number.isInteger(i) ? clamp(i, 0, list.length - 1) : 0]
  return { v, dark, label: `${t.name} ${name}` }
}

/** Every CSS variable for a set of theme settings. Never throws; a radius or font it can't use falls back to the default. */
export function themeTokens(s: ThemeSettings, dark: boolean): Record<string, string> {
  const p = themePalette(s, dark), radius = themeRadius(s?.radius, DEFAULT_THEME.radius), font = themeFontName(s?.font) ? s.font : DEFAULT_THEME.font
  return { ...derive(p.v, p.dark), 'r-sm': `${Math.round(radius / 2)}px`, 'r-md': `${radius}px`, 'r-lg': `${Math.round(radius * 1.6 + 1)}px`, font: `"${font}"${THEME_FONT_TAIL}` }
}

/** Every token name themeTokens produces. ThemeScript and themeCSS accept no others. */
export const THEME_TOKEN_NAMES: readonly string[] = [...BASE, 'accent-soft', 'ok-soft', 'warn-soft', 'bad-soft', 'c1', 'c2', 'c4', 'c-neutral', 'band', 'shadow', 'r-sm', 'r-md', 'r-lg', 'font']

/**
 * The values themeTokens can produce: hex colours, rgba() with plain numbers, numbers and px lengths, the two
 * shadows, and the font stack with a plain family name. As one regex source, so ThemeScript can reuse it.
 */
export const THEME_VALUE_SOURCE = '^(?:#[0-9a-fA-F]{3,8}|rgba?\\(\\d{1,3},\\d{1,3},\\d{1,3}(?:,(?:0|1|0?\\.\\d+))?\\)|-?\\d+(?:\\.\\d+)?(?:px)?|' +
  [THEME_SHADOW_LIGHT, THEME_SHADOW_DARK].map(x => x.replace(/[.()]/g, '\\$&')).join('|') + '|"[A-Za-z0-9 -]{1,40}"' + THEME_FONT_TAIL.replace(/[.()]/g, '\\$&') + ')$'

const THEME_VALUE = new RegExp(THEME_VALUE_SOURCE)

/** True when `name: value` is a token themeTokens could have produced (so it's safe in a style sheet or inline style). */
export const themeTokenOk = (name: string, value: unknown): value is string => THEME_TOKEN_NAMES.includes(name) && typeof value === 'string' && THEME_VALUE.test(value)

/** Only the tokens that pass themeTokenOk. */
export function themeSafeTokens(tokens: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {}
  if (tokens && typeof tokens === 'object') for (const [k, v] of Object.entries(tokens)) if (themeTokenOk(k, v)) out[k] = v
  return out
}

/** Tokens safe to write into CSS: library tokens as themeTokenOk, or any other `--name` whose value passes safeCssValue. */
function themeCleanTokens(tokens: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {}
  if (tokens && typeof tokens === 'object') for (const [k, v] of Object.entries(tokens)) if (/^[a-z][a-z0-9-]{0,40}$/i.test(k) && (themeTokenOk(k, v) || safeCssValue(v) !== '')) out[k] = v
  return out
}

/**
 * The current theme as a CSS block you can paste into your own stylesheet, headed by its name. Values that could
 * break out of a declaration or load a resource are dropped, and the label can't close the comment or the
 * `<style>`, so the result is safe inside a `<style>` element.
 */
export const themeCSS = (tokens: Record<string, string>, label?: string) =>
  `${label ? `/* ${String(label).replace(/\*\//g, '* /').replace(/</g, '\\3c ')} */\n` : ''}:root {\n${Object.entries(themeCleanTokens(tokens)).map(([k, v]) => `  --${k}: ${v};`).join('\n')}\n}`

/**
 * Change one base colour of a palette the way the Customise grid does: editing bg, card or text
 * re-derives muted, lines and secondary text (and whether it reads as dark); editing primary picks a
 * readable on-primary by luminance.
 */
export function editPalette(base: Palette, baseDark: boolean, key: keyof Palette, value: string): CustomTheme {
  const v = { ...base, [key]: value.toUpperCase() }
  let dark = baseDark
  if (key === 'bg' || key === 'fg' || key === 'card') {
    dark = luminance(v.bg) < 0.2
    v.muted = mix(v.card, v.fg, dark ? 0.07 : 0.045); v.line = mix(v.card, v.fg, dark ? 0.14 : 0.1); v.line2 = mix(v.card, v.fg, dark ? 0.24 : 0.17)
    v.fg2 = mix(v.fg, v.card, 0.35); v.fg3 = mix(v.fg, v.card, 0.58)
  }
  if (key === 'primary') v['on-primary'] = luminance(v.primary) > 0.45 ? mix(v.fg, '#000000', 0.2) : '#FFFFFF'
  return { dark, v }
}

/*
 * A theme in a URL: `#theme=<code>`, where the code is base64url of a few bytes. Byte 0 is the format version (1);
 * then flags (mode in bits 0–1: system/light/dark, bit 2 a Custom palette follows, bit 3 it leans dark), radius × 4,
 * font index (FONTS), family index (THEMES), that family's variant, and with a Custom palette its 15 colours as RGB
 * (45 bytes). A link is input from anyone: the code must decode to exactly this shape, every index must be in range,
 * and the result then goes through themeLoad, the same check as saved settings. */

/** The query or hash parameter that carries a share code. */
export const THEME_SHARE_PARAM = 'theme'

const THEME_SHARE_VERSION = 1

const THEME_SHARE_MODES = ['system', 'light', 'dark'] as const

/** Bytes → base64url (no padding). */
const themeB64 = (bytes: number[]) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')

/**
 * The compact, URL-safe code for a set of settings (8 characters, or 68 with a Custom palette): the family and
 * its variant, mode, radius and font, plus the Custom palette when `useCustom` is on. Settings are normalised first.
 */
export function themeShareEncode(s: ThemeSettings): string {
  const c = themeLoad(s), custom = c.useCustom ? c.custom : null
  const ti = Math.max(0, THEMES.findIndex(t => t.id === c.theme)), fi = Math.max(0, FONTS.findIndex(f => f[0] === c.font))
  const flags = THEME_SHARE_MODES.indexOf(c.mode) | (custom ? 4 : 0) | (custom?.dark ? 8 : 0)
  const bytes = [THEME_SHARE_VERSION, flags, Math.round(c.radius * 4), fi, ti, c.variant[THEMES[ti].id] ?? 0]
  if (custom) for (const k of BASE) bytes.push(...rgb(custom.v[k]))
  return themeB64(bytes)
}

/**
 * Settings from a share code, or null when it isn't one (wrong characters, length, version, flags or an index out of
 * range). Fields the code doesn't carry (other families' variants, a saved Custom palette when the link has none)
 * come from `base`. Never throws.
 */
export function themeShareDecode(code: unknown, base: ThemeSettings = DEFAULT_THEME): ThemeSettings | null {
  try {
    if (typeof code !== 'string' || !/^[A-Za-z0-9_-]{8,80}$/.test(code)) return null
    const bin = atob(code.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (code.length % 4)) % 4))
    const b = Array.from(bin, ch => ch.charCodeAt(0))
    if (b[0] !== THEME_SHARE_VERSION || b[1] > 15 || (b[1] & 3) > 2) return null
    const custom = (b[1] & 4) !== 0
    if (b.length !== (custom ? 51 : 6) || b[2] > THEME_RADIUS_MAX * 4) return null
    const font = FONTS[b[3]], theme = THEMES[b[4]]
    if (!font || !theme || b[5] >= Math.max(theme.light.length, theme.dark.length)) return null
    const v = custom ? Object.fromEntries(BASE.map((k, i) => [k, hex(b.slice(6 + i * 3, 9 + i * 3))])) : null
    return themeLoad({
      theme: theme.id, mode: THEME_SHARE_MODES[b[1] & 3], radius: b[2] / 4, font: font[0], variant: b[5] || Object.hasOwn(base.variant, theme.id) ? { ...base.variant, [theme.id]: b[5] } : { ...base.variant },
      custom: v ? { dark: (b[1] & 8) !== 0, v } : base.custom, useCustom: custom,
    }, base)
  } catch { return null }
}

/** A URL (string, URL or Location), or the current page's, or null on the server. */
const themeUrlOf = (url?: string | URL | { href: string }) => {
  try {
    const href = typeof url === 'string' ? url : url?.href ?? (typeof location === 'undefined' ? null : location.href)
    return href == null ? null : new URL(href, 'http://localhost')
  } catch { return null }
}

/** The share code in a URL: `#theme=…` (also among other hash parameters) first, then `?theme=…`. */
function themeUrlCode(u: URL): string | null {
  return new URLSearchParams(u.hash.replace(/^#/, '')).get(THEME_SHARE_PARAM) ?? u.searchParams.get(THEME_SHARE_PARAM)
}

/**
 * Settings from a share link (`#theme=…` or `?theme=…`), validated like saved settings; null when the URL has no
 * valid code. Defaults to the current page's URL. UIProvider applies it on load with `themeFromUrl`.
 */
export function themeFromUrl(url?: string | URL | { href: string }, base: ThemeSettings = DEFAULT_THEME): ThemeSettings | null {
  const u = themeUrlOf(url), code = u && themeUrlCode(u)
  return code ? themeShareDecode(code, base) : null
}

/**
 * A link that opens `href` (default: the current page) with these settings: `#theme=<code>` by default (the hash never
 * reaches your server), or `?theme=<code>` with `{ param: 'query' }`. Other parameters are kept.
 */
export function themeShareUrl(s: ThemeSettings, href?: string, { param = 'hash' }: { param?: 'hash' | 'query' } = {}): string {
  const code = themeShareEncode(s), u = themeUrlOf(href)
  if (!u) return `#${THEME_SHARE_PARAM}=${code}`
  const h = new URLSearchParams(u.hash.replace(/^#/, ''))
  h.delete(THEME_SHARE_PARAM); u.searchParams.delete(THEME_SHARE_PARAM)
  if (param === 'query') u.searchParams.set(THEME_SHARE_PARAM, code); else h.set(THEME_SHARE_PARAM, code)
  u.hash = h.toString()
  const out = u.toString()
  return href !== undefined && !/^[a-z][a-z\d+.-]*:/i.test(href) ? out.replace(/^http:\/\/localhost/, '') : out // keep a relative href relative
}

/** Remove the share parameter from the address bar (after applying it), without a navigation or a history entry. */
function themeUrlStrip() {
  const u = themeUrlOf()
  if (!u || !themeUrlCode(u)) return
  const h = new URLSearchParams(u.hash.replace(/^#/, ''))
  h.delete(THEME_SHARE_PARAM); u.searchParams.delete(THEME_SHARE_PARAM)
  u.hash = h.toString()
  history.replaceState(history.state, '', u.toString())
}

/** Where a theme reveal starts: an element (its centre), a point, or by default the last place the user pressed. */
export type RevealOrigin = Element | { x: number; y: number } | null | undefined

/** Where the user last pressed (page-wide), so a reveal can start under their finger. */
const lastPress = uiShared('last-press', () => ({ x: 0, y: 0, at: 0 }))

/**
 * Apply a page-wide change with the theme reveal: a circle grows from `from` and uncovers the whole
 * page in its new colours (View Transitions API). Falls back to a colour cross-fade where that API is
 * missing, and to an instant change for reduced-motion users.
 */
export function revealTheme(update: () => void, from?: RevealOrigin) {
  const root = document.documentElement
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return update()
  const doc = document as Document & { startViewTransition?: (cb: () => void) => { ready: Promise<void> } }
  if (!doc.startViewTransition) {
    root.classList.add('ui-theming'); update(); setTimeout(() => root.classList.remove('ui-theming'), 420); return
  }
  const box = from instanceof Element ? from.getBoundingClientRect() : null
  const recent = Date.now() - lastPress.at < 1500
  // no origin: the end corner of the top bar, where theme toggles usually sit
  const x = box ? box.left + box.width / 2 : from && 'x' in from ? from.x : recent ? lastPress.x : (innerWidth - 40)
  const y = box ? box.top + box.height / 2 : from && 'y' in from ? from.y : recent ? lastPress.y : 28
  const r = Math.hypot(Math.max(x, innerWidth - x), Math.max(y, innerHeight - y))
  const vt = doc.startViewTransition(() => flushSync(update))
  vt.ready.then(() => root.animate({ clipPath: [`circle(0px at ${x}px ${y}px)`, `circle(${r}px at ${x}px ${y}px)`] },
    { duration: 550, easing: 'cubic-bezier(.22,1,.36,1)', pseudoElement: '::view-transition-new(root)' })).catch(() => {})
}

type ThemeContext = {
  settings: ThemeSettings; dark: boolean; tokens: Record<string, string>
  /** Name of what is showing: "Nord Dark", "Ayu Mirage", "Custom". */
  label: string
  /**
   * False on the server and during hydration, when `settings` are still the defaults; true once the saved
   * settings and the OS colour scheme have been read (before the first paint on the client).
   */
  ready: boolean
  /** Where the CSS variables go: on `<html>`, or on the provider's own wrapper (`target="self"`). */
  target: 'html' | 'self'
  /** Whether the provider may fetch fonts from Google Fonts (UIProvider `fonts`). Components that load fonts check this. */
  fonts: boolean
  /**
   * Change settings. Colour changes (theme, mode, variant, switching to or from Custom) play the reveal
   * from `from`; radius, font and live Custom edits apply in place. Picking a theme or mode leaves Custom.
   */
  set: (p: Partial<ThemeSettings>, from?: RevealOrigin) => void
  /** Flip between light and dark within the current theme. */
  toggle: (from?: RevealOrigin) => void
  reset: (from?: RevealOrigin) => void
}

const ThemeCtx = createContext<ThemeContext | null>(null)

/** const { settings, set, toggle, dark, tokens } = useTheme(); set({ theme: 'nord', mode: 'dark' }) */
export const useTheme = () => useRequiredContext(ThemeCtx, 'useTheme', '<UIProvider>')

/** Tokens as inline-style CSS variables, to theme one element and its subtree: <div style={themeStyle(tokens, dark)}>. Unsafe values are dropped. */
export function themeStyle(tokens: Record<string, string>, dark: boolean): CSSProperties {
  const s: Record<string, string> = { colorScheme: dark ? 'dark' : 'light' }
  for (const [k, v] of Object.entries(themeCleanTokens(tokens))) s[`--${k}`] = v
  return s as CSSProperties
}

/**
 * What ThemeProvider saves: the settings plus the resolved light and dark tokens, so ThemeScript can apply
 * the theme before React loads without any theme code of its own.
 */
export const themeStored = (s: ThemeSettings) => JSON.stringify({ ...s, css: { light: themeTokens(s, false), dark: themeTokens(s, true) } })

/** JSON.parse that returns a plain object or null, never throws. */
const themeParse = (raw: string | null): object | null => {
  if (raw === null) return null
  try { const v: unknown = JSON.parse(raw); return v && typeof v === 'object' && !Array.isArray(v) ? v : null } catch { return null }
}

/**
 * Saved settings for `key`, validated (null when nothing usable is saved). Junk (not JSON, not an object) is removed.
 * The default key migrates a valid value from the legacy 'ui-theme' key once (the legacy value is left for older copies).
 */
function themeRead(key: string, base: ThemeSettings): ThemeSettings | null {
  const raw = localStorage.getItem(key)
  if (raw !== null) {
    const o = themeParse(raw)
    if (!o) { localStorage.removeItem(key); return null }
    return themeLoad(o, base)
  }
  if (key !== THEME_STORAGE_KEY) return null
  const legacy = localStorage.getItem(THEME_LEGACY_KEY)
  if (legacy === null) return null
  const o = themeParse(legacy)
  if (!o) { localStorage.removeItem(THEME_LEGACY_KEY); return null }
  const s = themeLoad(o, base)
  localStorage.setItem(key, themeStored(s))
  return s
}

export type ThemeProviderProps = {
  children: ReactNode
  /** Settings to start from before anything is saved, and what Reset returns to. */
  defaultSettings?: Partial<ThemeSettings>
  /** localStorage key for the saved settings (default 'ui-theme:v1'). Use the same key on ThemeScript. */
  storageKey?: string
  /** Save the user's choice in localStorage and restore it on the next visit (default true). */
  persist?: boolean
  /** 'html' (default) puts the CSS variables and data-theme on <html>; 'self' leaves the page alone (UIProvider puts them on its wrapper). */
  target?: 'html' | 'self'
  /** Load the theme's font from Google Fonts when it changes (default false: nothing is fetched, the system stack is used). */
  fonts?: boolean
  /**
   * Apply a share link's theme (`#theme=…` or `?theme=…`, see themeShareUrl) on load, over the saved one, then remove
   * the parameter from the address bar (default false). The code is validated like saved settings; junk is ignored.
   */
  fromUrl?: boolean
}

/**
 * Applies the theme as CSS variables on <html>, follows the OS in 'system' mode, and remembers the choice.
 * SSR-safe: renders the defaults on the server and during hydration (no matchMedia or localStorage in
 * render), then reads the saved settings and the OS scheme in a layout effect, before the first paint.
 * Saved settings (and other tabs' changes) are validated field by field; see themeLoad.
 */
export function ThemeProvider({ children, defaultSettings, storageKey = THEME_STORAGE_KEY, persist = true, target = 'html', fonts = false, fromUrl = false }: ThemeProviderProps) {
  const initial = { ...DEFAULT_THEME, ...defaultSettings }
  const [settings, setSettings] = useState<ThemeSettings>(initial)
  const [ready, setReady] = useState(false)
  const sysDark = useMediaQuery('(prefers-color-scheme: dark)') // false on the server and while hydrating
  useLayoutEffect(() => { // restore the saved choice after hydration, before paint
    let saved: ThemeSettings | null = null
    if (persist) try { saved = themeRead(storageKey, initial); if (saved) setSettings(saved) } catch { /* storage blocked */ }
    if (fromUrl) try { // a share link wins over the saved choice (and is then saved as the choice)
      const shared = themeFromUrl(undefined, saved ?? initial)
      if (shared) setSettings(shared)
      themeUrlStrip()
    } catch { /* no history API */ }
    setReady(true)
    if (!persist) return
    const on = (e: StorageEvent) => { // another tab changed it: same validation as on load
      if (e.key !== storageKey || !e.newValue) return
      const o = themeParse(e.newValue)
      if (o) setSettings(themeLoad(o, initial))
    }
    addEventListener('storage', on); return () => removeEventListener('storage', on)
  }, [storageKey, persist, fromUrl]) // eslint-disable-line react-hooks/exhaustive-deps
  const modeDark = settings.mode === 'system' ? sysDark : settings.mode === 'dark'
  const dark = settings.useCustom && settings.custom ? settings.custom.dark : modeDark
  const tokens = useMemo(() => themeTokens(settings, modeDark), [settings, modeDark])
  const label = themePalette(settings, modeDark).label
  useEffect(() => { // remember where the user pressed, so reveals start under their finger
    const on = (e: PointerEvent) => { lastPress.x = e.clientX; lastPress.y = e.clientY; lastPress.at = Date.now() }
    addEventListener('pointerdown', on, true); return () => removeEventListener('pointerdown', on, true)
  }, [])
  useLayoutEffect(() => {
    if (!ready || target !== 'html') return
    const root = document.documentElement
    for (const [k, v] of Object.entries(tokens)) root.style.setProperty(`--${k}`, v)
    root.dataset.theme = dark ? 'dark' : 'light'; root.style.colorScheme = dark ? 'dark' : 'light'
  }, [ready, target, tokens, dark])
  useEffect(() => { if (ready && fonts) loadFont(settings.font) }, [ready, fonts, settings.font])
  useEffect(() => {
    if (ready && persist) try { localStorage.setItem(storageKey, themeStored(settings)) } catch { /* storage blocked */ }
  }, [ready, persist, settings, storageKey])
  const value = useMemo<ThemeContext>(() => {
    const set = (p: Partial<ThemeSettings>, from?: RevealOrigin) => {
      const patch = { ...p }
      if (patch.useCustom === undefined && ('theme' in patch || 'mode' in patch || 'variant' in patch)) patch.useCustom = false
      const next = { ...settings, ...patch }
      const apply = () => setSettings(s => ({ ...s, ...patch }))
      const recolours = next.theme !== settings.theme || next.mode !== settings.mode || next.useCustom !== settings.useCustom ||
        JSON.stringify(next.variant) !== JSON.stringify(settings.variant)
      if (recolours && !('custom' in patch)) revealTheme(apply, from)
      else apply() // radius, font and live colour edits change in place
    }
    return { settings, dark, tokens, label, ready, target, fonts, set, toggle: from => set({ mode: dark ? 'light' : 'dark' }, from), reset: from => revealTheme(() => setSettings(initial), from) }
  }, [settings, dark, tokens, label, ready, target, fonts]) // eslint-disable-line react-hooks/exhaustive-deps
  return <ThemeCtx.Provider value={value}>{children}</ThemeCtx.Provider>
}

/** HSL (h 0–360, s and l 0–100) to '#RRGGBB'. */
export function hsl2hex(h: number, s: number, l: number) {
  s /= 100; l /= 100
  const k = (n: number) => (n + h / 30) % 12, a = s * Math.min(l, 1 - l), f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1))
  return '#' + [f(0), f(8), f(4)].map(x => Math.round(x * 255).toString(16).padStart(2, '0')).join('').toUpperCase()
}

/** Hue (0–359) of a '#RRGGBB' colour; 0 for greys. */
export function hex2hue(hex: string) {
  const [r, g, b] = rgb(hex).map(v => v / 255), mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn
  if (!d) return 0
  const h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4
  return Math.round((h * 60 + 360) % 360)
}
