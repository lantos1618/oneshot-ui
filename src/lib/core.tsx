/**
 * UI library: a single-file React component kit in the shadcn style.
 *
 * Drop this file into any React 19 project with Tailwind (v3.2+ or v4), or paste it into an AI
 * as the design system to build with. Converted from the "UI library" HTML catalogue.
 *
 *   Dependencies: react@19, react-dom@19, motion@13–14  ·  Tailwind for utility classes (or @lyndon/ui/styles.css).
 *   No icon package: icons are inline SVG paths (see `Icon`).
 *
 * Conventions (same as shadcn/ui):
 *   - Colours are CSS variables (see TOKENS). Use them in Tailwind as `bg-[var(--card)]`.
 *     Light/dark follows the OS; force one with <html data-theme="light|dark">.
 *   - Components take `className` and spread native props where it makes sense.
 *   - Variants are props (`variant`, `size`, `tone`), built with the tiny `variants()` helper.
 *   - Stateful inputs are controlled or uncontrolled: `value` + `onChange`, or `defaultValue`.
 *   - Motion: every animation uses `spring()` and respects prefers-reduced-motion (MotionConfig).
 *   - Wrap the app once in <UIProvider> (theme tokens, optional fonts, toasts). Options: storageKey, persist,
 *     fonts, target ('html' | 'self'), defaultTheme. Add <ThemeScript /> to <head> to avoid a theme flash with SSR.
 *
 * Contents
 *   1. Tokens and provider        8. Feedback (toasts, alerts, Collapse, async buttons)
 *   2. Utilities and hooks        9. Data display
 *   3. Icons                     10. Layout and code
 *   4. Primitives                11. AI patterns
 *   5. Floating layer + modals   12. Pages (pricing)
 *   6. Form controls             13. Charts (one SVG kit: Chart, Donut, Gauge, Radar, Scatter, Heatmap…)
 *   7. Navigation                14. More (range slider, inline edit, notifications, split pane, comments…)
 *                                    Showcase (default export) = usage examples for everything
 *
 * Shared building blocks: reach for these before writing something new.
 *   ActiveIndicator  sliding pill/underline (tabs, segmented, nav)   FloatingPanel / Popover  anchored panels
 *   ModalLayer       portal + backdrop + focus trap (dialog, sheet)   Collapse                 height 0 ↔ auto
 *   OptionList       listbox for Select / Combobox / MultiSelect      AnimatedNumber           rolling digits
 *   useControllable, useDisclosure, useRoving, useHotkey, useFocusTrap, useWidth, spring()
 *
 * Overriding a component's own classes: there is no tailwind-merge, so use Tailwind's important
 * prefix, e.g. <Input className="!h-8" />.
 */
import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type ButtonHTMLAttributes, type CSSProperties, type HTMLAttributes, type ReactNode, type RefObject, type KeyboardEvent as RKeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react'
import { flushSync } from 'react-dom'
import { AnimatePresence, motion, useInView } from 'motion/react'


/* ════════════════════════════════════════════════════════════════════════════
 * 1. TOKENS AND PROVIDER
 * ══════════════════════════════════════════════════════════════════════════ */

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
 * scoped to `.ui-root` (see PAGE_CSS for the page background, FONT_CSS for the Google Fonts import).
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
/** Page background and text colour from the theme, on `html`. UIProvider adds it when the theme targets `<html>`. */
export const PAGE_CSS = 'html{background:var(--bg);color:var(--fg)}'
/** The Google Fonts import for Geist and Geist Mono. UIProvider adds it unless `fonts={false}`. */
export const FONT_CSS = "@import url('https://fonts.googleapis.com/css2?family=Geist:wght@400;500;600&family=Geist+Mono:wght@400;500&display=swap');"

/* Themes ─────────────────────────────────────────────────────────────────────
 * A theme is two palettes of 15 base colours (light and dark). derive() fills in the rest:
 * soft tints, chart colours (c1–c4 plus c-neutral, a mid-grey series colour that reads at 4.5:1 on cards in light and
 * dark), band and shadow, and nudges secondary text until it reads at 4.5:1. */

const BASE = ['bg', 'card', 'muted', 'line', 'line2', 'fg', 'fg2', 'fg3', 'primary', 'on-primary', 'accent', 'ok', 'warn', 'bad', 'c3'] as const
export type Palette = Record<(typeof BASE)[number], string>
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
const loadedFonts = new Set(['Geist'])
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
const luminance = (h: string) => { const [r, g, b] = rgb(h).map(v => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4 }); return 0.2126 * r + 0.7152 * g + 0.0722 * b }
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
    'accent-soft': soft(accent), 'ok-soft': soft(ok), 'warn-soft': soft(p.warn), // the tint comes from the palette's own amber, so it stays light even when --warn is darkened to read as text 'bad-soft': soft(bad),
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

/* Theme validation ───────────────────────────────────────────────────────────
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

/** Where a theme reveal starts: an element (its centre), a point, or by default the last place the user pressed. */
export type RevealOrigin = Element | { x: number; y: number } | null | undefined
let lastPress = { x: 0, y: 0, at: 0 }

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
  const x = box ? box.left + box.width / 2 : from && 'x' in from ? from.x : recent ? lastPress.x : innerWidth - 40
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
export const useTheme = () => { const c = useContext(ThemeCtx); if (!c) throw new Error('useTheme must be inside <UIProvider>'); return c }

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
}

/**
 * Applies the theme as CSS variables on <html>, follows the OS in 'system' mode, and remembers the choice.
 * SSR-safe: renders the defaults on the server and during hydration (no matchMedia or localStorage in
 * render), then reads the saved settings and the OS scheme in a layout effect, before the first paint.
 * Saved settings (and other tabs' changes) are validated field by field; see themeLoad.
 */
export function ThemeProvider({ children, defaultSettings, storageKey = THEME_STORAGE_KEY, persist = true, target = 'html', fonts = false }: ThemeProviderProps) {
  const initial = { ...DEFAULT_THEME, ...defaultSettings }
  const [settings, setSettings] = useState<ThemeSettings>(initial)
  const [ready, setReady] = useState(false)
  const sysDark = useMediaQuery('(prefers-color-scheme: dark)') // false on the server and while hydrating
  useLayoutEffect(() => { // restore the saved choice after hydration, before paint
    if (persist) try { const saved = themeRead(storageKey, initial); if (saved) setSettings(saved) } catch { /* storage blocked */ }
    setReady(true)
    if (!persist) return
    const on = (e: StorageEvent) => { // another tab changed it: same validation as on load
      if (e.key !== storageKey || !e.newValue) return
      const o = themeParse(e.newValue)
      if (o) setSettings(themeLoad(o, initial))
    }
    addEventListener('storage', on); return () => removeEventListener('storage', on)
  }, [storageKey, persist]) // eslint-disable-line react-hooks/exhaustive-deps
  const modeDark = settings.mode === 'system' ? sysDark : settings.mode === 'dark'
  const dark = settings.useCustom && settings.custom ? settings.custom.dark : modeDark
  const tokens = useMemo(() => themeTokens(settings, modeDark), [settings, modeDark])
  const label = themePalette(settings, modeDark).label
  useEffect(() => { // remember where the user pressed, so reveals start under their finger
    const on = (e: PointerEvent) => { lastPress = { x: e.clientX, y: e.clientY, at: Date.now() } }
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

/* ════════════════════════════════════════════════════════════════════════════
 * 2. UTILITIES AND HOOKS
 * ══════════════════════════════════════════════════════════════════════════ */

/** Join class names. (Add tailwind-merge here if you want later classes to override earlier ones.) */
export function cn(...c: (string | false | null | undefined | 0)[]) {
  return c.filter(Boolean).join(' ')
}

type VariantMap = Record<string, Record<string, string>>
type VariantProps<V extends VariantMap> = { [K in keyof V]?: keyof V[K] }
/** Tiny cva(): variants('base', { size: { sm: '…', md: '…' } }, { size: 'md' })({ size: 'sm' }) */
export function variants<V extends VariantMap>(base: string, map: V, defaults: VariantProps<V>) {
  return (p: VariantProps<V> & { className?: string } = {}) =>
    cn(base, ...Object.keys(map).map(k => map[k][String(p[k] ?? defaults[k])]), p.className)
}

/** One spring for the whole library, same signature as the original page: spring(bounce, duration). */
export const spring = (bounce = 0.25, duration = 0.45) => ({ type: 'spring' as const, bounce, duration })

/** Resolves after `ms` milliseconds: await sleep(300). */
export const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms))

/** Keep `n` inside [lo, hi]: clamp(140, 0, 100) → 100. */
export const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n))
/**
 * Largest value, like Math.max(...values) (NaN propagates, empty → `init`) but with a loop, so huge arrays don't
 * overflow the call stack (spreading ~125k+ arguments throws RangeError).
 */
export function maxOf(values: Iterable<number>, init = -Infinity) { let m = init; for (const v of values) m = Math.max(m, v); return m }
/** Smallest value, like Math.min(...values) with a loop (see maxOf). */
export function minOf(values: Iterable<number>, init = Infinity) { let m = init; for (const v of values) m = Math.min(m, v); return m }
/** [min, max] in one pass, with a loop (see maxOf). Empty → [Infinity, -Infinity]. */
export function extent(values: Iterable<number>): [number, number] { let lo = Infinity, hi = -Infinity; for (const v of values) { lo = Math.min(lo, v); hi = Math.max(hi, v) } return [lo, hi] }

/** Repeatable pseudo-random numbers (mulberry32): const r = seeded(42); r() → 0…1, the same sequence every time (safe for SSR and demos). */
export function seeded(seed: number) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
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

/** Selector for elements that can take keyboard focus. Use `focusables(root)` to also drop hidden, inert and aria-hidden ones. */
export const FOCUSABLE = 'a[href],area[href],button:not([disabled]),input:not([disabled]):not([type=hidden]),select:not([disabled]),textarea:not([disabled]),iframe,audio[controls],video[controls],[contenteditable=""],[contenteditable="true"],[tabindex]:not([tabindex="-1"])'
/** The Tab stops inside `root`, in DOM order: visible, enabled, tabIndex ≥ 0, not inside [inert] or aria-hidden. */
export function focusables(root: ParentNode | null | undefined): HTMLElement[] {
  if (!root) return []
  return [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(el =>
    el.tabIndex >= 0 && !el.closest('[inert],[aria-hidden="true"]') && el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden')
}

/* Formatting ───────────────────────────────────────────────────────────────── */

/** Locale every built-in formatter uses (numbers, money, dates). */
export const LOCALE = 'en-GB'
const fmtCache = new Map<string, Intl.NumberFormat>()
const fmtNumber = (o: Intl.NumberFormatOptions, locale = LOCALE) => {
  const k = locale + JSON.stringify(o)
  let f = fmtCache.get(k)
  if (!f) { f = new Intl.NumberFormat(locale, o); fmtCache.set(k, f) }
  return f
}
/**
 * Number formatters: fmt.compact(12400) → "12.4K", fmt.bytes(2.4e6) → "2.4 MB", fmt.usd(0.0042) → "$0.0042",
 * fmt.money(1234.5, 'EUR') → "€1,234.50", fmt.duration(1530) → "1.5 s" (milliseconds in), fmt.clock(75) → "1:15" (seconds in).
 */
export const fmt = {
  compact: (n: number) => fmtNumber({ notation: 'compact', maximumFractionDigits: 1 }).format(n),
  bytes: (n: number) => n < 1e3 ? `${Math.max(0, Math.round(n))} B` : n < 1e6 ? `${Math.round(n / 1e3)} KB` : n < 1e9 ? `${(n / 1e6).toFixed(1)} MB` : `${(n / 1e9).toFixed(1)} GB`,
  usd: (n: number) => { const a = Math.abs(n); return (n < 0 ? '-$' : '$') + a.toFixed(a >= 1 || a === 0 ? 2 : a >= 0.01 ? 3 : 4) },
  money: (n: number, currency = 'USD', locale = LOCALE) => fmtNumber({ style: 'currency', currency }, locale).format(n),
  duration: (ms: number) => {
    if (ms < 1000) return `${Math.max(0, Math.round(ms))} ms`
    if (ms < 60e3) return `${(ms / 1000).toFixed(ms < 10e3 ? 1 : 0)} s`
    const m = Math.floor(ms / 60e3), s = Math.round((ms % 60e3) / 1000)
    return s ? `${m} min ${s} s` : `${m} min`
  },
  clock: (seconds: number) => {
    const t = Math.max(0, Math.floor(seconds || 0)), h = Math.floor(t / 3600), m = Math.floor(t / 60) % 60, s = String(t % 60).padStart(2, '0')
    return h ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`
  },
}

/* Dates (local time, Monday-first weeks) ─────────────────────────────────── */

/** Midnight at the start of `d`'s day. */
export const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate())
/** `d` plus `n` days, at midnight (safe across daylight-saving changes). */
export const addDays = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n)
/** The first of `d`'s month plus `n` months. */
export const addMonths = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth() + n, 1)
/** Start of `d`'s week at midnight; weeks start on Monday unless `weekStartsOn` says otherwise (0 = Sunday). */
export const startOfWeek = (d: Date, weekStartsOn = 1) => addDays(d, -((d.getDay() - weekStartsOn + 7) % 7))
/** Same calendar day? Null-safe. */
export const sameDay = (a?: Date | null, b?: Date | null) => !!a && !!b && a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
/** Stable key for a day, "2026-11-08", for maps and React keys. */
export const dayKey = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
/** Format a date in LOCALE: fmtDate(d) → "8 Nov 2026"; pass Intl options for other shapes. Empty string for null. */
export const fmtDate = (d?: Date | null, opts: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short', year: 'numeric' }, locale = LOCALE) =>
  d ? new Intl.DateTimeFormat(locale, opts).format(d) : ''

/* State and DOM hooks ─────────────────────────────────────────────────────── */

/** Controlled-or-uncontrolled state, the pattern every input here uses. */
export function useControllable<T>(value: T | undefined, defaultValue: T, onChange?: (v: T) => void) {
  const [inner, setInner] = useState(defaultValue)
  const controlled = value !== undefined
  const current = controlled ? value : inner
  const set = useCallback((v: T) => { if (!controlled) setInner(v); onChange?.(v) }, [controlled, onChange])
  return [current, set] as const
}

/**
 * While `enabled`, call `handler` on a pointerdown outside every ref'd element, and on Escape with `escape: true`.
 * `keep(target)` returning true ignores that press (e.g. a trigger that lives elsewhere). Tap-away for popovers and highlights.
 */
export function useOutside(refs: RefObject<Element | null>[], handler: (e: PointerEvent | KeyboardEvent) => void, enabled = true,
  { escape = false, keep }: { escape?: boolean; keep?: (target: Element) => boolean } = {}) {
  const h = useRef({ handler, keep, refs })
  useLayoutEffect(() => { h.current = { handler, keep, refs } })
  useEffect(() => {
    if (!enabled) return
    const down = (e: PointerEvent) => {
      const t = e.target as Node
      if (h.current.refs.some(r => r.current?.contains(t))) return
      if (t instanceof Element && h.current.keep?.(t)) return
      h.current.handler(e)
    }
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') h.current.handler(e) }
    document.addEventListener('pointerdown', down, true)
    if (escape) document.addEventListener('keydown', key)
    return () => { document.removeEventListener('pointerdown', down, true); document.removeEventListener('keydown', key) }
  }, [enabled, escape])
}

/** Open state for a floating panel that closes on outside click: { open, setOpen, ref } (put ref on the wrapper). */
export function useDisclosure(initial = false) {
  const [open, setOpen] = useState(initial)
  const ref = useRef<HTMLDivElement>(null)
  useOutside([ref], () => setOpen(false), open)
  return { open, setOpen, ref }
}

/** Width of an element, kept up to date with ResizeObserver. Charts use it to stay responsive. */
export function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null)
  const [w, setW] = useState(0)
  useLayoutEffect(() => {
    const el = ref.current; if (!el) return
    setW(el.clientWidth)
    const ro = new ResizeObserver(([e]) => setW(e.contentRect.width)); ro.observe(el)
    return () => ro.disconnect()
  }, [])
  return [ref, w] as const
}

/** Content-box size of an element, kept up to date: const [ref, { width, height }] = useSize<HTMLDivElement>(). */
export function useSize<T extends HTMLElement>() {
  const ref = useRef<T>(null)
  const [size, setSize] = useState({ width: 0, height: 0 })
  useLayoutEffect(() => {
    const el = ref.current; if (!el) return
    const set = (width: number, height: number) => setSize(s => s.width === width && s.height === height ? s : { width, height })
    const r = el.getBoundingClientRect(), cs = getComputedStyle(el), px = (k: string) => parseFloat(cs.getPropertyValue(k)) || 0
    set(r.width - px('padding-left') - px('padding-right') - px('border-left-width') - px('border-right-width'),
      r.height - px('padding-top') - px('padding-bottom') - px('border-top-width') - px('border-bottom-width'))
    const ro = new ResizeObserver(([e]) => set(e.contentRect.width, e.contentRect.height)); ro.observe(el)
    return () => ro.disconnect()
  }, [])
  return [ref, size] as const
}

const mqSubscribe = (q: string) => (cb: () => void) => { const m = matchMedia(q); m.addEventListener('change', cb); return () => m.removeEventListener('change', cb) }
const mqNow = (q: string) => typeof matchMedia !== 'undefined' && matchMedia(q).matches
/** Live result of a media query, e.g. useMediaQuery('(max-width: 639px)') or useMediaQuery('(pointer: coarse)'). False on the server. */
export function useMediaQuery(query: string) {
  const sub = useMemo(() => mqSubscribe(query), [query])
  return useSyncExternalStore(sub, () => matchMedia(query).matches, () => false)
}
/** True on touch-first devices (coarse pointer): grow hit areas, skip hover-only affordances. */
export const useCoarsePointer = () => useMediaQuery('(pointer: coarse)')
/** Has the user asked for reduced motion? A plain call for event handlers and effects (false on the server). */
export const prefersReducedMotion = () => mqNow('(prefers-reduced-motion: reduce)')
/** Is the primary pointer coarse (touch)? A plain call for event handlers and effects; in render use useCoarsePointer. */
export const isCoarsePointer = () => mqNow('(pointer: coarse)')

/* Touch helpers: a finger fires pointerenter → down → up → leave on every tap ──── */

/** True when a pointer event came from a finger. */
export const isTouch = (e: { pointerType?: string }) => e.pointerType === 'touch'
/** A pointerleave handler that ignores touch, so the leave a lifted finger fires doesn't undo what the tap showed. */
export const onMouseLeave = (fn: (e: ReactPointerEvent) => void) => (e: ReactPointerEvent) => { if (!isTouch(e)) fn(e) }
/** On touch, drop the implicit pointer capture so a finger sliding across items enters each one, like a mouse. */
export const releaseTouchCapture = (e: ReactPointerEvent) => {
  const t = e.target as Element
  if (isTouch(e) && t.hasPointerCapture?.(e.pointerId)) t.releasePointerCapture(e.pointerId)
}

/** Where a drag is: pointer position, distance from where it started, and the native event. */
export type PointerDragState = { x: number; y: number; dx: number; dy: number; event: PointerEvent }
/**
 * One pointer drag with the failure cases handled: the pointer is captured, pointercancel or a lost capture ends it as
 * cancelled, a move with no button pressed ends it (released outside the window), and unmounting mid-drag tears it down.
 * Call `start(e)` from onPointerDown (optionally with the element to capture); `cursor` sets the page cursor and stops
 * text selection while dragging. Give the handle `touch-none` (or `touch-pan-y` for horizontal drags) so touch drags work.
 *   const drag = usePointerDrag({ onMove: p => setX(x0 + p.dx) }); <div onPointerDown={drag.start} className="touch-none" />
 */
export function usePointerDrag({ onStart, onMove, onEnd, cursor }: {
  onStart?: (p: PointerDragState) => void; onMove?: (p: PointerDragState) => void
  /** `cancelled` is true after pointercancel, lost capture, `cancel()` or unmount */ onEnd?: (p: PointerDragState, cancelled: boolean) => void
  cursor?: string }) {
  const fns = useRef({ onStart, onMove, onEnd, cursor })
  useLayoutEffect(() => { fns.current = { onStart, onMove, onEnd, cursor } })
  const stop = useRef<((cancelled: boolean) => void) | null>(null)
  const [dragging, setDragging] = useState(false)
  useEffect(() => () => stop.current?.(true), [])
  const start = useCallback((e: { pointerId: number; clientX: number; clientY: number; currentTarget?: EventTarget | null; nativeEvent?: Event }, capture?: Element | null) => {
    stop.current?.(true)
    const el = (capture ?? (e.currentTarget instanceof Element ? e.currentTarget : null))
    const id = e.pointerId, x0 = e.clientX, y0 = e.clientY
    let last: PointerDragState = { x: x0, y: y0, dx: 0, dy: 0, event: (e.nativeEvent ?? e) as PointerEvent }
    const at = (ev: PointerEvent): PointerDragState => ({ x: ev.clientX, y: ev.clientY, dx: ev.clientX - x0, dy: ev.clientY - y0, event: ev })
    try { el?.setPointerCapture(id) } catch { /* the pointer is already gone */ }
    const body = document.body, prev = [body.style.cursor, body.style.userSelect], cur = fns.current.cursor
    if (cur) { body.style.cursor = cur; body.style.userSelect = 'none' }
    const move = (ev: PointerEvent) => {
      if (ev.pointerId !== id) return
      if (ev.buttons === 0) { last = at(ev); return finish(false) } // the release happened where we couldn't see it
      last = at(ev); fns.current.onMove?.(last)
    }
    const up = (ev: PointerEvent) => { if (ev.pointerId === id) { last = at(ev); finish(false) } }
    const cancel = (ev: PointerEvent) => { if (ev.pointerId === id) finish(true) }
    const finish = (cancelled: boolean) => {
      if (stop.current !== finish) return
      stop.current = null
      removeEventListener('pointermove', move, true); removeEventListener('pointerup', up, true); removeEventListener('pointercancel', cancel, true)
      el?.removeEventListener('lostpointercapture', cancel as EventListener)
      try { if (el?.hasPointerCapture(id)) el.releasePointerCapture(id) } catch { /* already released */ }
      if (cur) { body.style.cursor = prev[0]; body.style.userSelect = prev[1] }
      setDragging(false); fns.current.onEnd?.(last, cancelled)
    }
    stop.current = finish
    addEventListener('pointermove', move, true); addEventListener('pointerup', up, true); addEventListener('pointercancel', cancel, true)
    el?.addEventListener('lostpointercapture', cancel as EventListener)
    setDragging(true); fns.current.onStart?.(last)
  }, [])
  const cancel = useCallback(() => stop.current?.(true), [])
  return { start, cancel, dragging }
}

/**
 * Press and hold: `onPress` fires once the pointer has stayed down `ms` (default 500) without moving more than `slop` px
 * (default 8). Touch and pen only unless `mouse`. Spread `bind` on the element; the click that ends a long-press is swallowed.
 */
export function useLongPress({ ms = 500, slop = 8, mouse = false, onPress }:
  { ms?: number; slop?: number; mouse?: boolean; onPress: (p: { x: number; y: number; pointerId: number; pointerType: string; target: Element }) => void }) {
  const fn = useRef(onPress)
  useLayoutEffect(() => { fn.current = onPress })
  const press = useRef<{ t: ReturnType<typeof setTimeout>; x: number; y: number; id: number } | null>(null)
  const firedAt = useRef(0)
  const cancel = useCallback(() => { if (press.current) clearTimeout(press.current.t); press.current = null }, [])
  useEffect(() => cancel, [cancel])
  const bind = {
    onPointerDown: (e: ReactPointerEvent) => {
      if (e.pointerType === 'mouse' && (!mouse || e.button !== 0)) return
      cancel()
      const { clientX: x, clientY: y, pointerId, pointerType } = e, target = e.target as Element
      press.current = { x, y, id: pointerId, t: setTimeout(() => { press.current = null; firedAt.current = Date.now(); fn.current({ x, y, pointerId, pointerType, target }) }, ms) }
    },
    onPointerMove: (e: ReactPointerEvent) => { const p = press.current; if (p && p.id === e.pointerId && Math.hypot(e.clientX - p.x, e.clientY - p.y) > slop) cancel() },
    onPointerUp: cancel, onPointerCancel: cancel,
    onClickCapture: (e: React.MouseEvent) => { if (Date.now() - firedAt.current < 700) { firedAt.current = 0; e.preventDefault(); e.stopPropagation() } },
  }
  return { bind, cancel, /** true right after a long-press fired (use it to skip your own click logic) */ fired: () => Date.now() - firedAt.current < 700 }
}

const coreEditable = (t: EventTarget | null) => t instanceof Element &&
  !!t.closest('input:not([type=checkbox],[type=radio],[type=range],[type=button],[type=submit],[type=reset],[type=color],[type=file]),textarea,select,[contenteditable="true"],[contenteditable=""],[role=textbox]')

/**
 * Keyboard shortcut, e.g. useHotkey('mod+k', open), useHotkey('alt+shift+n', add) or useHotkey('?', help). `mod` is ⌘ on
 * Mac, Ctrl elsewhere; modifiers must match exactly. Presses typed into a text field are skipped when `ignoreEditable`
 * is on (the default for keys without mod/ctrl/meta/alt), and so are presses another handler already consumed.
 * The third argument is `enabled`, or { enabled, ignoreEditable }.
 */
export function useHotkey(combo: string, handler: (e: KeyboardEvent) => void, options: boolean | { enabled?: boolean; ignoreEditable?: boolean } = true) {
  const h = useRef(handler)
  useLayoutEffect(() => { h.current = handler })
  const { enabled = true, ignoreEditable } = typeof options === 'boolean' ? { enabled: options } : options
  useEffect(() => {
    if (!enabled) return
    const parts = combo.toLowerCase().split('+'), key = parts.pop()!
    const has = (m: string) => parts.includes(m)
    const skipFields = ignoreEditable ?? !(has('mod') || has('ctrl') || has('meta') || has('alt'))
    const symbol = key.length === 1 && !/[a-z0-9]/.test(key) // '?', '[': typing them may need Shift
    const on = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.isComposing || e.key?.toLowerCase() !== key) return
      const mod = has('mod') ? e.metaKey || e.ctrlKey : (has('ctrl') === e.ctrlKey && has('meta') === e.metaKey)
      const shift = has('shift') === e.shiftKey || (symbol && !has('shift'))
      if (!mod || !shift || has('alt') !== e.altKey) return
      if (skipFields && coreEditable(e.target)) return
      e.preventDefault(); h.current(e)
    }
    addEventListener('keydown', on)
    return () => removeEventListener('keydown', on)
  }, [combo, enabled, ignoreEditable])
}

/** Open focus traps, innermost last: only the top one handles Tab, so nested modals don't fight. */
const coreTraps: RefObject<HTMLElement | null>[] = []
/**
 * Keep Tab focus inside `ref` while `active`: focuses `[data-autofocus]` or the first focusable on open, wraps Tab and
 * Shift+Tab at document level (so focus that slipped outside comes back), and restores the previous focus on close.
 * With nothing focusable inside it holds focus on the `[role=dialog]` (or first) element instead of letting Tab leave.
 * Nested traps stack: only the innermost one acts.
 */
export function useFocusTrap(ref: RefObject<HTMLElement | null>, active: boolean) {
  useEffect(() => {
    if (!active) return
    const prev = document.activeElement as HTMLElement | null
    coreTraps.push(ref)
    const holder = () => { // something to park focus on when there are no tab stops
      const el = ref.current?.querySelector<HTMLElement>('[role=dialog],[role=alertdialog]') ?? (ref.current?.firstElementChild as HTMLElement | null)
      if (el && !el.hasAttribute('tabindex')) el.tabIndex = -1
      return el
    }
    const raf = requestAnimationFrame(() => (ref.current?.querySelector<HTMLElement>('[data-autofocus]') ?? focusables(ref.current)[0] ?? holder())?.focus())
    const on = (e: KeyboardEvent) => {
      if (e.key !== 'Tab' || coreTraps[coreTraps.length - 1] !== ref || !ref.current) return
      const f = focusables(ref.current), a = document.activeElement
      if (!f.length) { e.preventDefault(); if (!ref.current.contains(a)) holder()?.focus(); return }
      const first = f[0], last = f[f.length - 1]
      if (e.shiftKey && (a === first || !ref.current.contains(a))) { e.preventDefault(); last.focus() }
      else if (!e.shiftKey && (a === last || !ref.current.contains(a))) { e.preventDefault(); first.focus() }
    }
    document.addEventListener('keydown', on)
    return () => {
      cancelAnimationFrame(raf); document.removeEventListener('keydown', on)
      const i = coreTraps.lastIndexOf(ref); if (i >= 0) coreTraps.splice(i, 1)
      queueMicrotask(() => prev?.focus?.()) // after the rest of the commit (e.g. a modal lifting `inert` off the page)
    }
  }, [active, ref])
}

/** Options for useRoving. */
export type RovingOptions = {
  /** wrap around at the ends (default true) */ loop?: boolean
  /** which arrows move: ↑↓ (default), ←→, or both */ orientation?: 'vertical' | 'horizontal' | 'both'
  /** items to skip */ isDisabled?: (i: number) => boolean
  /** Home/End jump to the first/last item (default true; turn off in text inputs) */ homeEnd?: boolean
  /** control the index yourself (e.g. the selected tab); otherwise it is internal state */ index?: number
  /** called with the new index after a key moved it: focus or select there */ onMove?: (i: number) => void
}
/**
 * Arrow-key roving index for lists, menus, tablists and toolbars: arrows move (skipping disabled items), Home/End jump,
 * Enter calls `onEnter`. Third argument: `loop` (boolean) or RovingOptions. Safe with zero items.
 */
export function useRoving(count: number, onEnter: (i: number) => void, options: boolean | RovingOptions = true) {
  const { loop = true, orientation = 'vertical', isDisabled, homeEnd = true, index, onMove } = typeof options === 'boolean' ? { loop: options } as RovingOptions : options
  const [inner, setActive] = useState(0)
  const active = index ?? inner
  useEffect(() => { if (index === undefined && count > 0 && inner >= count) setActive(count - 1) }, [count, inner, index])
  const step = (from: number, d: number) => {
    for (let k = 1; k <= count; k++) {
      let n = from + d * k
      if (loop) n = ((n % count) + count) % count
      else if (n < 0 || n >= count) return -1
      if (!isDisabled?.(n)) return n
    }
    return -1
  }
  const go = (n: number) => { if (n < 0) return; if (index === undefined) setActive(n); onMove?.(n) }
  const onKeyDown = (e: RKeyboardEvent) => {
    if (!count) return
    const v = orientation !== 'horizontal', hz = orientation !== 'vertical'
    const d = (v && e.key === 'ArrowDown') || (hz && e.key === 'ArrowRight') ? 1 : (v && e.key === 'ArrowUp') || (hz && e.key === 'ArrowLeft') ? -1 : 0
    if (d) { e.preventDefault(); go(step(Math.min(active, count - 1), d)) }
    else if (homeEnd && (e.key === 'Home' || e.key === 'End')) { e.preventDefault(); go(e.key === 'Home' ? step(-1, 1) : step(count, -1)) }
    else if (e.key === 'Enter' && !e.nativeEvent.isComposing) { e.preventDefault(); if (active < count && !isDisabled?.(active)) onEnter(active) }
  }
  return { active, setActive, onKeyDown }
}

/**
 * Reveals text the way a model streams it: a few characters (`unit: 'char'`, about `cps` per second) or a word
 * (`unit: 'word'`, every `wordDelay` ms) at a time. Give it a finished string to replay it, or a string that keeps
 * growing (append-only, e.g. a live model stream) and it carries on from where it is instead of restarting; with
 * `live` it is not `done` until `live` turns false, and it speeds up to stay close when a large chunk lands. Any
 * other change to `text` replays from the start. `start: false` pauses it. Under reduced motion it shows everything.
 * Returns `{ text: shown so far, done, shown: chars shown, total }`. StreamingText is this hook as a component.
 */
export function useStreamedText(text: string, { cps = 60, start = true, unit = 'char', wordDelay = 45, live = false, onProgress }:
  { cps?: number; start?: boolean; unit?: 'char' | 'word'; wordDelay?: number; live?: boolean; onProgress?: () => void } = {}) {
  const reduce = useMediaQuery('(prefers-reduced-motion: reduce)')
  const [st, setSt] = useState(() => ({ src: text, pos: 0 }))
  const progress = useRef(onProgress); progress.current = onProgress
  const src = useRef(text); src.current = text
  let { pos } = st
  if (st.src !== text) {
    // append-only? (compares the tail of what we had, so a long stream stays cheap to check)
    const prev = st.src, k = Math.min(prev.length, 256)
    const appended = text.length >= prev.length && text.startsWith(prev.slice(prev.length - k), prev.length - k)
    pos = appended ? Math.min(st.pos, text.length) : 0
    setSt({ src: text, pos }) // adjust state while rendering (React re-renders before committing)
  }
  const total = text.length
  const shown = reduce ? total : Math.min(pos, total)
  const behind = !reduce && start && pos < total
  useEffect(() => {
    if (!behind) return
    const word = unit === 'word'
    // one interval while it is behind (reading the latest text from a ref, so a stream of updates doesn't reset it);
    // it stops once caught up and starts again when more text arrives
    const id = setInterval(() => {
      if (word && Math.random() < 0.2) return // the uneven rhythm of the per-word random delay this replaced
      setSt(s => {
        const text = src.current, total = text.length
        if (s.src !== text || s.pos >= total) return s
        const lag = total - s.pos
        let to: number
        if (word) {
          const from = live && lag > 400 ? s.pos + Math.floor(lag / 10) : s.pos + 1 // live and far behind: catch up
          const sp = text.indexOf(' ', from)
          to = sp < 0 ? total : sp
        } else to = s.pos + 2 + Math.floor(Math.random() * 3) + (live ? Math.floor(lag / 12) : 0)
        return { src: s.src, pos: Math.min(total, to) }
      })
      progress.current?.()
    }, word ? Math.max(8, wordDelay * 0.85) : 1000 / (Math.max(1, cps) / 3))
    return () => clearInterval(id)
  }, [behind, cps, unit, wordDelay, live])
  return { text: text.slice(0, shown), done: !live && shown >= total, shown, total }
}

/**
 * Watches a horizontal scroller: `left` / `right` say whether more content is hidden on that side, `touched`
 * turns true once it has been scrolled. Pair with `ScrollEdges` for fades and a "scroll for more" hint.
 */
export function useScrollEdges<T extends HTMLElement>() {
  const [el, ref] = useState<T | null>(null) // callback ref, so a remounted scroller is picked up
  const [edges, setEdges] = useState({ left: false, right: false, touched: false })
  useEffect(() => {
    if (!el) return
    const upd = () => setEdges(e => {
      const left = el.scrollLeft > 2, right = el.scrollLeft + el.clientWidth < el.scrollWidth - 2, touched = e.touched || left
      return e.left === left && e.right === right && e.touched === touched ? e : { left, right, touched }
    })
    upd()
    el.addEventListener('scroll', upd, { passive: true })
    const ro = new ResizeObserver(upd); ro.observe(el); [...el.children].forEach(c => ro.observe(c))
    return () => { el.removeEventListener('scroll', upd); ro.disconnect() }
  }, [el])
  return [ref, edges] as const
}

const SCROLL_FADE = {
  card: ['from-[var(--card)]', 'bg-gradient-to-r', 'bg-gradient-to-l'],
  bg: ['from-[var(--bg)]', 'bg-gradient-to-r', 'bg-gradient-to-l'],
} as const
/**
 * Edge fades for a horizontal scroller, plus (on touch screens, until the first scroll) a small "scroll for
 * more" pill. Render it as a sibling of the scroller inside a `relative` wrapper; feed it `useScrollEdges`.
 */
export function ScrollEdges({ left, right, touched, hint = 'Swipe for more', fade = 'card', at = 'bottom', className }:
  { left: boolean; right: boolean; touched?: boolean; hint?: ReactNode; fade?: keyof typeof SCROLL_FADE; /** where the hint pill sits */ at?: 'top' | 'bottom'; className?: string }) {
  const [from, toR, toL] = SCROLL_FADE[fade]
  return (
    <>
      <span aria-hidden className={cn('pointer-events-none absolute inset-y-0 left-0 z-[6] w-5 to-transparent transition-opacity duration-200', from, toR, left ? 'opacity-100' : 'opacity-0', className)} />
      <span aria-hidden className={cn('pointer-events-none absolute inset-y-0 right-0 z-[6] w-5 to-transparent transition-opacity duration-200', from, toL, right ? 'opacity-100' : 'opacity-0', className)} />
      <AnimatePresence>
        {right && !touched && hint && (
          <motion.span key="hint" aria-hidden initial={{ opacity: 0, x: 6 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, transition: { duration: 0.15 } }}
            className={cn('pointer-events-none absolute right-2 z-[7] hidden items-center gap-1 rounded-full bg-[color-mix(in_srgb,var(--fg)_86%,transparent)] px-2.5 py-1 text-[11px] font-medium text-[var(--card)] shadow-[var(--shadow)] [@media(pointer:coarse)]:flex', at === 'top' ? 'top-2' : 'bottom-2')}>
            {hint}<Icon name="chevronRight" size={12} strokeWidth={2.6} />
          </motion.span>
        )}
      </AnimatePresence>
    </>
  )
}

/* ════════════════════════════════════════════════════════════════════════════
 * 3. ICONS: inline paths (24×24, stroke). Add your own to ICONS.
 * ══════════════════════════════════════════════════════════════════════════ */

export const ICONS = {
  check: 'M5 12l5 5L20 7', x: 'M18 6 6 18M6 6l12 12', plus: 'M12 5v14M5 12h14', minus: 'M5 12h14',
  chevronDown: 'm6 9 6 6 6-6', chevronUp: 'm18 15-6-6-6 6', chevronRight: 'm9 18 6-6-6-6', chevronLeft: 'm15 18-6-6 6-6',
  search: 'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM21 21l-4.3-4.3',
  copy: 'M9 9h11v11H9zM5 15H4V4h11v1',
  heart: 'M19.5 12.6 12 20l-7.5-7.4A4.9 4.9 0 0 1 12 6a4.9 4.9 0 0 1 7.5 6.6z',
  star: 'M12 2.5l2.9 6 6.6.9-4.8 4.6 1.2 6.5L12 17.4l-5.9 3.1 1.2-6.5L2.5 9.4l6.6-.9z',
  eye: 'M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12zM12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6z',
  eyeOff: 'M3 3l18 18M10.6 6.1A10 10 0 0 1 12 6c6.4 0 10 6 10 6a17 17 0 0 1-3.2 3.9M6.6 6.6A17 17 0 0 0 2 12s3.6 6 10 6a9.7 9.7 0 0 0 5.4-1.6M9.9 9.9a3 3 0 0 0 4.2 4.2',
  upload: 'M12 16V4m0 0-5 5m5-5 5 5M4 20h16', file: 'M14 3H6v18h12V7zM14 3v4h4',
  calendar: 'M4 6h16v15H4zM4 10h16M8 3v4M16 3v4', clock: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 7v5l3 2',
  trash: 'M4 7h16M10 11v6M14 11v6M5 7l1 13h12l1-13M9 7V4h6v3', edit: 'M4 20h4L19 9l-4-4L4 16zM13.5 6.5l4 4',
  share: 'M4 12v7h16v-7M12 3v12M7 8l5-5 5 5', bell: 'M6 8a6 6 0 1 1 12 0c0 7 3 8 3 8H3s3-1 3-8M10 20a2 2 0 0 0 4 0',
  settings: 'M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6zM19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z',
  user: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 21a8 8 0 0 1 16 0', home: 'M3 11l9-8 9 8M5 10v10h14V10',
  inbox: 'M3 13h5l2 3h4l2-3h5M5 5h14l2 8v6H3v-6z', folder: 'M3 6h6l2 2h10v11H3z', menu: 'M4 6h16M4 12h16M4 18h16',
  send: 'M12 19V5m0 0-6 6m6-6 6 6', stop: 'M7 7h10v10H7z', sparkles: 'M12 3l1.8 4.7L18.5 9.5l-4.7 1.8L12 16l-1.8-4.7L5.5 9.5l4.7-1.8zM19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z',
  alert: 'M12 9v4M12 17h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z',
  info: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 11v5M12 8h.01', mic: 'M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3zM5 11a7 7 0 0 0 14 0M12 18v3',
  link: 'M10 14a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1 1M14 10a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1-1',
  columns: 'M4 4h16v16H4zM9.5 4v16M14.5 4v16', pinLeft: 'M4 4v16M20 12H9M13 8l-4 4 4 4', pinRight: 'M20 4v16M4 12h11M11 8l4 4-4 4',
  more: 'M5 12h.01M12 12h.01M19 12h.01', grip: 'M9 6h.01M15 6h.01M9 12h.01M15 12h.01M9 18h.01M15 18h.01',
  sun: 'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8zM12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4',
  moon: 'M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z', terminal: 'M4 17l6-5-6-5M12 19h8',
  lock: 'M5 11h14v10H5zM8 11V7a4 4 0 0 1 8 0v4', globe: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18',
  arrowUp: 'M12 19V5M5 12l7-7 7 7', arrowDown: 'M12 5v14M19 12l-7 7-7-7', refresh: 'M20 11a8 8 0 1 0-2.3 5.7M20 4v7h-7',
  layers: 'M12 3 2 8l10 5 10-5zM2 13l10 5 10-5', monitor: 'M3 4h18v12H3zM8 20h8M12 16v4', keyboard: 'M3 6h18v12H3zM7 10h.01M11 10h.01M15 10h.01M7 14h10',
  code: 'm8 8-5 4 5 4M16 8l5 4-5 4', chart: 'M4 20V10M10 20V4M16 20v-7M22 20H2',
  shield: 'M12 3 4 6v6c0 5 3.5 8 8 9 4.5-1 8-4 8-9V6z', card: 'M4 5h16a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2zM2 10h20', message: 'M21 12a8 8 0 0 1-11.6 7.1L3 21l1.9-6.4A8 8 0 1 1 21 12z', phone: 'M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2', mapPin: 'M12 21s-7-6.1-7-11a7 7 0 0 1 14 0c0 4.9-7 11-7 11zM12 8a2 2 0 1 0 0 4 2 2 0 0 0 0-4z',
  users: 'M9 4.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7zM2 20a7 7 0 0 1 14 0M16 4a3.5 3.5 0 0 1 0 7M22 20a7 7 0 0 0-4-6.3', bolt: 'M13 2 4 14h7l-1 8 9-12h-7z', book: 'M4 19V5a2 2 0 0 1 2-2h14v16H6a2 2 0 0 0-2 2zM4 19a2 2 0 0 0 2 2h14', panel: 'M5 4h14a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2zM9 4v16', wifiOff: 'M2 2l20 20M8.5 16.5a5 5 0 0 1 7 0M5 13a10 10 0 0 1 5.2-2.8M19 13a10 10 0 0 0-2.4-1.7M2 8.8a15 15 0 0 1 4.2-2.7M22 8.8A15 15 0 0 0 10.7 5M12 20h.01',
  thumbUp: 'M7 10v11H3V10zM7 10l4-8a3 3 0 0 1 3 3v4h6a2 2 0 0 1 2 2.3l-1.4 8a2 2 0 0 1-2 1.7H7', plug: 'M9 7V3M15 7V3M7 7h10v4a5 5 0 0 1-10 0V7zM12 16v5', sliders: 'M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0M16 4v4M10 10v4M18 16v4', image: 'M5 4h14a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2zM9 8a2 2 0 1 0 0 4 2 2 0 0 0 0-4zM21 16l-5-5L5 20', hand: 'M8 13V5.5a1.5 1.5 0 0 1 3 0V12m0-6.5V4a1.5 1.5 0 0 1 3 0v8m0-6.5a1.5 1.5 0 0 1 3 0V13m0-4.5a1.5 1.5 0 0 1 3 0V15a6 6 0 0 1-6 6h-1.5a6 6 0 0 1-4.6-2.2L4.3 15.5a1.6 1.6 0 0 1 2.4-2.1L8 14.8', rocket: 'M5 15c-1.5 1.3-2 5-2 5s3.7-.5 5-2c.7-.8.7-2.1-.1-2.9a2.2 2.2 0 0 0-2.9-.1zM12 15l-3-3a22 22 0 0 1 2-4A13 13 0 0 1 22 2c0 2.7-.8 7.5-6 11a22 22 0 0 1-4 2zM9 12H4s.6-3 2-4c1.6-1.1 5 0 5 0M12 15v5s3-.6 4-2c1.1-1.6 0-5 0-5', bulb: 'M9 18h6M10 22h4M12 2a7 7 0 0 0-4 12.7V17h8v-2.3A7 7 0 0 0 12 2z', undo: 'M9 14 4 9l5-5M4 9h11a5 5 0 0 1 0 10h-3',
  // folded in from the layout, editor, diagram, code, media and chat glyph sets
  paperclip: 'm21 12-8.5 8.5a5 5 0 0 1-7-7L14 5a3.5 3.5 0 0 1 5 5l-8.5 8.5a2 2 0 0 1-3-3L15 8',
  commit: 'M3 12h6m6 0h6M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6z',
  pullRequest: 'M6 3.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5zM6 15.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5zM18 15.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5zM6 8.5v7M18 15.5V9a3 3 0 0 0-3-3h-4m0 0 2-2m-2 2 2 2',
  branch: 'M6 3.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5zM6 15.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5zM18 5.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5zM6 8.5v7M18 10.5c0 4-6 3-11 6',
  alertCircle: 'M12 9v4M12 17h.01M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z',
  listBullet: 'M9 6h11M9 12h11M9 18h11M4 6h.01M4 12h.01M4 18h.01', listOrdered: 'M10 6h10M10 12h10M10 18h10M4 4v4M3 8h2M3 14h2l-2 3h2',
  listPlus: 'M4 6h11M4 12h11M4 18h7M18 15v6M15 18h6', quote: 'M7 8h4v4H8a3 3 0 0 0 3 3M14 8h4v4h-3a3 3 0 0 0 3 3',
  database: 'M4 5c0-1.7 3.6-3 8-3s8 1.3 8 3-3.6 3-8 3-8-1.3-8-3zM4 5v14c0 1.7 3.6 3 8 3s8-1.3 8-3V5M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3',
  fileText: 'M14 3H6v18h12V7zM14 3v4h4M9 13h6M9 17h4', layout: 'M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2zM3 9h18M9 21V9',
  bot: 'M7 7h10a3 3 0 0 1 3 3v6a3 3 0 0 1-3 3H7a3 3 0 0 1-3-3v-6a3 3 0 0 1 3-3zM12 3v4M9 13h.01M15 13h.01',
  shieldCheck: 'M12 3 4 6v6c0 5 3.5 8 8 9 4.5-1 8-4 8-9V6zM9 12l2 2 4-4', plane: 'm22 2-7 20-4-9-9-4z',
  cloud: 'M7 18a5 5 0 1 1 1-9.9A6 6 0 0 1 19 10a4 4 0 0 1 0 8z', webhook: 'M18 16a4 4 0 1 1-4 4M6 16a4 4 0 1 0 4 4M12 4a4 4 0 0 0-2 7.5L6 16m6-12a4 4 0 0 1 2 7.5L18 16',
  stream: 'M3 6h13M3 12h18M3 18h9', warehouse: 'M3 21V9l9-6 9 6v12M7 21v-8h10v8M7 17h10', asterisk: 'M12 2v20M2 12h20M5 5l14 14M19 5 5 19',
  diff: 'M12 3v8M8 7h8M8 17h8', wrap: 'M3 6h18M3 12h15a3 3 0 0 1 0 6h-4m0 0 2-2m-2 2 2 2M3 18h7',
  replay: 'M3 12a9 9 0 1 0 3-6.7L3 8M3 3v5h5', forward: 'M21 12a9 9 0 1 1-3-6.7L21 8M21 3v5h-5',
  play: 'M8 5.5v13l11-6.5z', pause: 'M7 5h3.5v14H7zM13.5 5H17v14h-3.5z',
  volume: 'M11 5 6 9H3v6h3l5 4zM15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13', volumeX: 'M11 5 6 9H3v6h3l5 4zM16 9l6 6M22 9l-6 6',
  maximize: 'M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5', minimize: 'M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5',
  bookmark: 'M6 3h12v18l-6-4-6 4z', imageOff: 'M5 4h14a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2zM3 16l5-5 4 4 3-3 6 6M3 3l18 18',
  zoomIn: 'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM20 20l-3.5-3.5M8 11h6M11 8v6',
  chevronsLeftRight: 'm9 6-6 6 6 6M15 6l6 6-6 6',
} as const
export type IconName = keyof typeof ICONS

/**
 * An icon from ICONS (24×24 stroke paths). `filled` draws it solid in the text colour (play, pause, star); `fill` paints the
 * inside of a stroked one. Decorative: always aria-hidden, so label the control around it.
 */
export function Icon({ name, size = 16, strokeWidth = 2, className, fill = 'none', filled, style }:
  { name: IconName; size?: number; strokeWidth?: number; className?: string; fill?: string; filled?: boolean; style?: CSSProperties }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill={filled ? 'currentColor' : fill} stroke={filled ? 'none' : 'currentColor'} strokeWidth={strokeWidth}
      strokeLinecap="round" strokeLinejoin="round" className={cn('flex-none', className)} style={style} aria-hidden="true">
      <path d={ICONS[name]} />
    </svg>
  )
}
const isIconName = (v: unknown): v is IconName => typeof v === 'string' && v in ICONS

/* ════════════════════════════════════════════════════════════════════════════
 * 4. PRIMITIVES
 * ══════════════════════════════════════════════════════════════════════════ */

/**
 * Surface class strings: `card` (large radius, bordered), `md` (medium-radius tile), `muted` (tinted inset), `floating`
 * (popovers, menus, toasts), `dashed` (drop zones, empty slots). Add padding yourself.
 */
export const surface = {
  card: 'rounded-[var(--r-lg)] border border-[var(--line)] bg-[var(--card)]',
  md: 'rounded-[var(--r-md)] border border-[var(--line)] bg-[var(--card)]',
  muted: 'rounded-[var(--r-md)] bg-[var(--muted)]',
  floating: 'rounded-[var(--r-lg)] border border-[var(--line)] bg-[var(--card)] shadow-[var(--shadow)]',
  dashed: 'rounded-[var(--r-md)] border-[1.5px] border-dashed border-[var(--line2)]',
} as const
/** Shared surface for every floating panel (same as surface.floating). */
export const floatingSurface = 'rounded-[var(--r-lg)] border border-[var(--line)] bg-[var(--card)] shadow-[var(--shadow)]'
/** Row look shared by menus, listboxes and the palette. Rows are at least 40px tall on touch screens. */
export const menuItemClass = 'flex w-full cursor-pointer items-center justify-between gap-3 rounded-[var(--r-md)] border-0 bg-transparent px-2 py-2 text-left text-[13px] [@media(pointer:coarse)]:min-h-10 ' +
  'outline-none hover:bg-[var(--muted)] focus-visible:bg-[var(--muted)] data-[active=true]:bg-[var(--muted)]'
/**
 * The shared hover for fields and field triggers (Select, pickers, Combobox, MultiSelect, Phone, Currency…): the border
 * darkens to --line2. Hover-capable pointers only; focus and invalid borders still win. Rows and list items use
 * `rowHoverClass` (muted background) instead.
 */
export const fieldHoverClass = 'hover:border-[var(--line2)]'
/** Row hover for accordions, list rows and menu-like triggers: a muted background (hover-capable pointers only). */
export const rowHoverClass = 'hover:bg-[var(--muted)]'
/** Shared field look: every text-like control uses this (with the shared hover border). */
export const inputClass =
  'h-9 w-full rounded-[var(--r-md)] border border-[var(--line)] bg-[var(--card)] px-3 text-[13px] outline-none transition-[border-color,box-shadow] ' + fieldHoverClass + ' ' +
  'placeholder:text-[var(--fg3)] focus:border-[var(--fg3)] focus:shadow-[0_0_0_3px_var(--muted)] ' +
  'aria-[invalid=true]:border-[var(--bad)] aria-[invalid=true]:shadow-[0_0_0_3px_var(--bad-soft)] disabled:opacity-60'
/**
 * Touch-only sizing (desktop look unchanged): `tap` ≥32px, `tap36` ≥36px, `row` ≥40px rows, `hit` an invisible 36px hit
 * area around something small, `input` 16px text so iOS doesn't zoom on focus. `target` (every pointer): an invisible hit
 * area of at least 24×24px with a mouse and 36px on touch, for tiny buttons like a chip's ×.
 */
export const TOUCH = {
  tap: '[@media(pointer:coarse)]:min-h-8 [@media(pointer:coarse)]:min-w-8',
  tap36: '[@media(pointer:coarse)]:min-h-9 [@media(pointer:coarse)]:min-w-9',
  row: '[@media(pointer:coarse)]:min-h-10',
  hit: 'ui-hit',
  target: 'ui-target',
  input: '[@media(pointer:coarse)]:text-base',
} as const

export const buttonVariants = variants(
  'relative inline-flex items-center justify-center gap-1.5 whitespace-nowrap font-medium rounded-[var(--r-md)] border overflow-hidden ' +
  'cursor-pointer select-none transition-[background,opacity,border-color] disabled:opacity-60 disabled:cursor-default',
  {
    variant: {
      default: 'bg-[var(--card)] border-[var(--line)] hover:bg-[var(--muted)]',
      // hovers never lower text contrast: primary gets a soft ring; accent/danger move away from their card-coloured text
      primary: 'bg-[var(--primary)] text-[var(--on-primary)] border-[var(--primary)] hover:shadow-[0_0_0_3px_color-mix(in_srgb,var(--primary)_22%,transparent)]',
      accent: 'bg-[var(--accent)] text-[var(--card)] border-[var(--accent)] hover:bg-[color-mix(in_srgb,var(--accent)_88%,var(--fg))]',
      ghost: 'bg-transparent border-transparent hover:bg-[var(--muted)]',
      danger: 'bg-[var(--bad)] text-[var(--card)] border-[var(--bad)] hover:bg-[color-mix(in_srgb,var(--bad)_88%,var(--fg))]',
      'outline-danger': 'bg-[var(--card)] text-[var(--bad)] border-[var(--line)] hover:bg-[var(--bad-soft)]',
    },
    // heights follow the control scale (--h-xs/sm/md/lg = 24/30/36/40). Coarse pointers (touch): xs and sm sizes grow to
    // a 32px hit area; desktop sizes are unchanged
    size: {
      xs: 'h-6 gap-1 px-2 text-[11px] [@media(pointer:coarse)]:h-8', sm: 'h-[30px] px-3 text-xs [@media(pointer:coarse)]:h-8', md: 'h-9 px-3 text-[13px]', lg: 'h-10 px-4 text-sm',
      icon: 'h-9 w-9 p-0', 'icon-sm': 'h-7 w-7 p-0 [@media(pointer:coarse)]:h-8 [@media(pointer:coarse)]:w-8',
      'icon-xs': 'h-6 w-6 p-0 [@media(pointer:coarse)]:h-8 [@media(pointer:coarse)]:w-8',
    },
  },
  { variant: 'default', size: 'md' },
)
export type ButtonProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'onAnimationStart' | 'onDrag' | 'onDragStart' | 'onDragEnd' | 'onDragOver' | 'onDrop'> & {
  variant?: 'default' | 'primary' | 'accent' | 'ghost' | 'danger' | 'outline-danger'
  /** xs 24px · sm 30px · md 36px (default) · lg 40px; icon 36², icon-sm 28², icon-xs 24² (xs/sm sizes are 32px on touch). */
  size?: 'xs' | 'sm' | 'md' | 'lg' | 'icon' | 'icon-sm' | 'icon-xs'
  loading?: boolean
  ref?: React.Ref<HTMLButtonElement>
}
/** Every button presses down slightly (scale .96), like the original page. */
export function Button({ variant, size, loading, className, children, disabled, type = 'button', ...p }: ButtonProps) {
  return (
    <motion.button type={type} whileTap={disabled || loading ? undefined : { scale: 0.96 }} transition={{ duration: 0.12 }}
      disabled={disabled || loading} className={buttonVariants({ variant, size, className })} {...p}>
      {loading && <Spinner />}
      {children}
    </motion.button>
  )
}

const ICON_BUTTON_TONE = {
  muted: 'text-[var(--fg3)] hover:text-[var(--fg)]',
  default: '',
  danger: 'text-[var(--fg3)] hover:text-[var(--bad)] hover:!bg-[var(--bad-soft)]',
  /** on photos and video: always light, whatever the theme */
  onDark: '!border-transparent !bg-transparent text-white/85 hover:!bg-white/15 hover:text-white',
} as const
/**
 * Square icon button (toolbars, dismiss, overflow). `icon` is an ICONS name or any node; `tone` sets the colour: muted grey
 * (default), default (inherit), danger (red on hover), onDark (light, for media overlays). Always give it a label.
 */
export function IconButton({ icon, label, className, size = 'icon-sm', variant = 'ghost', tone = 'muted', ...p }:
  Omit<ButtonProps, 'children'> & { icon: IconName | ReactNode; label: string; tone?: keyof typeof ICON_BUTTON_TONE }) {
  return (
    <Button aria-label={label} title={label} size={size} variant={variant}
      className={cn(ICON_BUTTON_TONE[tone], className)} {...p}>
      {isIconName(icon) ? <Icon name={icon} size={size === 'icon-xs' ? 13 : size === 'icon-sm' ? 15 : 16} /> : icon}
    </Button>
  )
}

/**
 * `animation-play-state` for an infinite CSS animation (spinners): paused while the element is off screen, so nothing
 * keeps repainting where nobody can see it. One shared IntersectionObserver per element via motion's useInView.
 * (Components outside core can use motion's `useViewport().visible` the same way.)
 */
function useSpinPause<T extends Element>() {
  const ref = useRef<T>(null)
  const visible = useInView(ref, { margin: '64px' })
  const play = visible ? 'running' : 'paused'
  // --ui-play reaches the ::after animations of .ui-shimmer and .ui-caret (play-state itself doesn't inherit)
  return { ref, style: { animationPlayState: play, '--ui-play': play } as CSSProperties }
}

const SPINNER_TONE = { current: 'border-current', accent: 'border-[var(--accent)]', ok: 'border-[var(--ok)]', warn: 'border-[var(--warn)]', bad: 'border-[var(--bad)]' } as const
/** Spinning ring (role=status, "Loading"). `tone` colours it; default is the text colour. */
export function Spinner({ size = 14, tone = 'current', label = 'Loading', className }: { size?: number; tone?: keyof typeof SPINNER_TONE; label?: string; className?: string }) {
  const pause = useSpinPause<HTMLSpanElement>() // stops spinning while off screen
  return <span ref={pause.ref} role="status" aria-label={label} style={{ width: size, height: size, ...pause.style }}
    className={cn('inline-block flex-none animate-spin rounded-full border-2 border-r-transparent', SPINNER_TONE[tone], className)} />
}

export const TONE_SOFT = {
  neutral: 'bg-[var(--muted)] text-[var(--fg2)]',
  // text is the tone nudged toward --fg so it clears 4.5:1 on its own tint in light and dark
  ok: 'bg-[var(--ok-soft)] text-[color-mix(in_srgb,var(--ok)_78%,var(--fg))]',
  warn: 'bg-[var(--warn-soft)] text-[color-mix(in_srgb,var(--warn)_78%,var(--fg))]',
  bad: 'bg-[var(--bad-soft)] text-[color-mix(in_srgb,var(--bad)_78%,var(--fg))]',
  accent: 'bg-[var(--accent-soft)] text-[color-mix(in_srgb,var(--accent)_78%,var(--fg))]',
} as const
export type Tone = keyof typeof TONE_SOFT

/** The two badge geometries every pill, tag and count on the page uses: sm 18px / 11px text, md 20px / 12px text. */
export const BADGE_SIZE = { sm: 'h-[18px] gap-1 px-1.5 text-[11px]', md: 'h-5 gap-1 px-2 text-xs' } as const
/**
 * Status pill, tag or count: the one badge primitive. `size` sm (18px, for counts, deltas and dense rows) or md (20px,
 * default). Pair colour with a dot or word: never colour alone.
 */
export function Badge({ tone = 'neutral', size = 'md', dot, className, children }: { tone?: Tone; size?: keyof typeof BADGE_SIZE; dot?: boolean; className?: string; children: ReactNode }) {
  return (
    <span className={cn('inline-flex flex-none items-center rounded-full leading-none font-medium whitespace-nowrap', BADGE_SIZE[size], TONE_SOFT[tone], className)}>
      {dot && <span className="h-1.5 w-1.5 rounded-full bg-current" />}{children}
    </span>
  )
}

/**
 * ▲/▼ change pill, green when the change is good and red when it is bad (`lowerIsBetter` flips that), e.g. "▲ 3.2%".
 * Pops when the direction changes; screen readers hear "better" or "worse". Renders nothing for NaN/Infinity.
 */
export function DeltaBadge({ value, lowerIsBetter, digits = 1, suffix = '%', title, className }:
  { value: number; lowerIsBetter?: boolean; digits?: number; suffix?: string; title?: string; className?: string }) {
  if (!Number.isFinite(value)) return null
  const good = lowerIsBetter ? value < 0 : value >= 0
  return (
    <motion.span key={`${value >= 0}${good}`} initial={{ scale: 0.85 }} animate={{ scale: 1 }} transition={spring(0.5, 0.35)}
      title={title ?? `${good ? 'Better' : 'Worse'} than the previous period`}
      className={cn('ui-num inline-flex items-center rounded-full leading-none font-medium whitespace-nowrap', BADGE_SIZE.sm,
        good ? 'bg-[var(--ok-soft)] text-[color-mix(in_srgb,var(--ok)_72%,var(--fg))]' : 'bg-[var(--bad-soft)] text-[color-mix(in_srgb,var(--bad)_78%,var(--fg))]', className)}>
      {value >= 0 ? '▲' : '▼'} {Math.abs(value).toFixed(digits)}{suffix}<span className="sr-only">{good ? ' (better)' : ' (worse)'}</span>
    </motion.span>
  )
}

/** The states StatusIcon draws. */
export type StatusIconStatus = 'done' | 'active' | 'pending' | 'failed'
/**
 * Round step/status marker for steppers, checks and task lists: done (filled tick, pops in), failed (filled ✕), active
 * (spinning ring, or the step `number` in a bold ring), pending (grey ring, with `number` if given). `tone="ok"` paints done
 * green. Decorative unless you pass `label`.
 */
export function StatusIcon({ status, size = 18, number, tone = 'primary', label, className }:
  { status: StatusIconStatus; size?: number; number?: number; tone?: 'primary' | 'ok'; label?: string; className?: string }) {
  const spin = status === 'active' && number === undefined
  const pause = useSpinPause<HTMLSpanElement>() // the active ring stops spinning while off screen
  return (
    <span ref={pause.ref} role={label ? 'img' : undefined} aria-label={label} aria-hidden={label ? undefined : true} style={{ width: size, height: size, fontSize: Math.max(10, Math.round(size * 0.5)), ...(spin ? pause.style : null) }}
      className={cn('relative z-[1] grid flex-none place-items-center rounded-full border-[1.5px] font-semibold leading-none not-italic transition-colors',
        status === 'done' ? (tone === 'ok' ? 'border-[var(--ok)] bg-[var(--ok)] text-[var(--card)]' : 'border-[var(--primary)] bg-[var(--primary)] text-[var(--on-primary)]')
          : status === 'failed' ? 'border-[var(--bad)] bg-[var(--bad)] text-[var(--card)]'
            : spin ? 'animate-spin border-[var(--accent)] border-r-transparent bg-[var(--card)]'
              : status === 'active' ? 'border-[var(--fg)] bg-[var(--card)] text-[var(--fg)]' : 'border-[var(--line2)] bg-[var(--card)] text-[var(--fg3)]', className)}>
      <AnimatePresence initial={false}>
        {status === 'done' && <motion.span key="d" className="grid" initial={{ scale: 0.5 }} animate={{ scale: 1 }} transition={spring(0.5, 0.35)}><Icon name="check" size={Math.round(size * 0.55)} strokeWidth={3.5} /></motion.span>}
      </AnimatePresence>
      {status === 'failed' && <Icon name="x" size={Math.round(size * 0.55)} strokeWidth={3.5} />}
      {(status === 'pending' || status === 'active') && number !== undefined && number}
    </span>
  )
}

/**
 * Pill button for filters, toggles and suggestions. With `pressed` it is a toggle (aria-pressed, filled when on); without,
 * a plain suggestion chip. 30px tall, 36px on touch. Takes every button prop.
 */
export function Chip({ pressed, icon, className, children, type = 'button', ...p }: Omit<ButtonProps, 'variant' | 'size' | 'loading'> & { pressed?: boolean; icon?: IconName | ReactNode }) {
  return (
    <motion.button type={type} aria-pressed={pressed} whileTap={p.disabled ? undefined : { scale: 0.95 }} transition={{ duration: 0.12 }}
      className={cn('inline-flex h-[30px] flex-none cursor-pointer items-center gap-1.5 rounded-full border px-3 text-xs font-medium whitespace-nowrap transition-colors disabled:cursor-default disabled:opacity-50 [@media(pointer:coarse)]:h-9',
        pressed ? 'border-[var(--primary)] bg-[var(--primary)] text-[var(--on-primary)]' : 'border-[var(--line)] bg-[var(--card)] text-[var(--fg2)] hover:bg-[var(--muted)] hover:text-[var(--fg)]', className)} {...p}>
      {isIconName(icon) ? <Icon name={icon} size={13} /> : icon}{children}
    </motion.button>
  )
}

export function Kbd({ children, className }: { children: ReactNode; className?: string }) {
  return <kbd className={cn('rounded-[var(--r-sm)] border border-[var(--line)] bg-[var(--muted)] px-1 font-[family-name:var(--mono)] text-[11px] text-[var(--fg2)]', className)}>{children}</kbd>
}

/** Surface for grouping content. */
export function Card({ className, ...p }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn(surface.card, 'p-4', className)} {...p} />
}

export function Separator({ vertical, className }: { vertical?: boolean; className?: string }) {
  return <div role="separator" className={cn(vertical ? 'w-px self-stretch' : 'h-px w-full', 'bg-[var(--line)]', className)} />
}

/** Loading placeholder with a shimmer sweep (paused while off screen; off for reduced motion). */
export function Skeleton({ className }: { className?: string }) {
  const pause = useSpinPause<HTMLDivElement>()
  return <div ref={pause.ref} style={pause.style} className={cn('ui-shimmer rounded-[var(--r-md)] bg-[var(--muted)]', className)} />
}

const AV_COLORS = ['#DBEAFE:#1E40AF', '#FCE7F3:#9D174D', '#DCFCE7:#166534', '#FEF3C7:#92400E', '#EDE9FE:#5B21B6', '#E0F2FE:#075985']
export function Avatar({ name, src, size = 32, status, className }:
  { name: string; src?: string; size?: number; status?: 'online' | 'away' | 'offline'; className?: string }) {
  const initials = name.split(' ').map(s => s[0]).slice(0, 2).join('').toUpperCase(), img = safeMediaUrl(src)
  const [bg, fg] = AV_COLORS[[...name].reduce((a, c) => a + c.charCodeAt(0), 0) % AV_COLORS.length].split(':')
  return (
    <span className={cn('relative inline-grid flex-none place-items-center rounded-full border-2 border-[var(--card)] font-semibold', className)}
      style={{ width: size, height: size, fontSize: size >= 28 ? Math.max(11, size * 0.36) : size * 0.36, background: bg, color: fg }} title={name}>
      {img ? <img src={img} alt={name} className="h-full w-full rounded-full object-cover" /> : initials}
      {status && <span className={cn('absolute -right-0.5 -bottom-0.5 h-2.5 w-2.5 rounded-full border-2 border-[var(--card)]',
        status === 'online' ? 'bg-[var(--ok)]' : status === 'away' ? 'bg-[var(--warn)]' : 'bg-[var(--line2)]')} />}
    </span>
  )
}

/**
 * Overlapping avatars with a "+N" bubble that fan out on hover or keyboard focus (`spread={false}` keeps them still), and an
 * optional caption like "9 people editing" underneath. The group is one Tab stop that names everyone.
 */
export function AvatarStack({ names, max = 4, size = 32, caption, spread: canSpread = true, className }:
  { names: string[]; max?: number; size?: number; caption?: ReactNode; spread?: boolean; className?: string }) {
  const [spread, setSpread] = useState(false)
  const shown = names.slice(0, max), extra = names.length - shown.length
  const fan = canSpread && spread
  return (
    <div className={cn('flex flex-col items-center gap-2', className)}>
      <div className="flex outline-none" tabIndex={canSpread ? 0 : undefined} role="group" aria-label={`${names.length} people: ${names.join(', ')}`}
        onPointerEnter={e => e.pointerType === 'mouse' && setSpread(true)} onPointerLeave={e => e.pointerType === 'mouse' && setSpread(false)}
        onFocus={() => setSpread(true)} onBlur={() => setSpread(false)}>
        {[...shown, ...(extra > 0 ? [null] : [])].map((n, i) => (
          <motion.span key={n ?? '+'} initial={false} animate={{ x: fan ? i * 6 : 0 }} transition={spring(0.3, 0.35)} className={cn(i > 0 && '-ml-2')} style={{ zIndex: 10 - i }}>
            {n ? <Avatar name={n} size={size} />
              : <span className="grid place-items-center rounded-full border-2 border-[var(--card)] bg-[var(--muted)] text-xs font-semibold text-[var(--fg2)]" style={{ width: size, height: size }}>+{extra}</span>}
          </motion.span>
        ))}
      </div>
      {caption && <span className="text-xs text-[var(--fg3)]">{caption}</span>}
    </div>
  )
}
/** @deprecated Use AvatarStack (same props); kept as an alias. */
export function AvatarGroup({ names, max = 4, size = 32, className }: { names: string[]; max?: number; size?: number; className?: string }) {
  return <AvatarStack names={names} max={max} size={size} spread={false} className={cn('!items-start', className)} />
}

/** The CSS transition AnimatedNumber's digit columns and SparkChart's marks use (off for reduced motion). */
const ROLL_EASE = 'cubic-bezier(.22,1,.36,1)'
/**
 * Rolling number (replaces the NumberFlow web component): each digit rolls to its new value.
 * format: Intl.NumberFormatOptions, e.g. { style: 'currency', currency: 'EUR' }.
 * Screen readers get the formatted value as visually hidden text (the rolling columns are aria-hidden). Digits are
 * tabular and each takes one fixed column, so the number never shifts the layout around it while it rolls.
 * Cheap enough for live tickers: each digit is one CSS transform transition (one style write per change, none per
 * frame), nothing is written when a digit is unchanged, and the roll is skipped (the digit jumps) for reduced motion
 * and while the number is off screen.
 */
export function AnimatedNumber({ value, format, locale = LOCALE, className }:
  { value: number; format?: Intl.NumberFormatOptions; locale?: string; className?: string }) {
  const str = useMemo(() => new Intl.NumberFormat(locale, format).format(value), [value, format, locale])
  const ref = useRef<HTMLSpanElement>(null)
  const visible = useInView(ref, { margin: '64px' })
  const chars = [...str]
  return (
    <span ref={ref} className={cn('ui-num inline-flex leading-none whitespace-nowrap', className)}>
      <span className="sr-only">{str}</span>
      <span aria-hidden className="inline-flex">
        {chars.map((c, i) => {
          const key = chars.length - i // key from the right so digits keep their column as the number grows
          if (!/\d/.test(c)) return <span key={`s${key}`}>{c}</span>
          return (
            <span key={key} className="relative inline-block h-[1em] overflow-hidden text-center" style={{ width: '1ch' }}>
              <span className={cn('absolute inset-x-0 top-0 flex flex-col motion-reduce:!transition-none', !visible && '!transition-none')}
                style={{ transform: `translateY(${-Number(c)}em)`, transition: `transform .6s ${ROLL_EASE}` }}>
                {'0123456789'.split('').map(d => <span key={d} className="h-[1em] leading-none">{d}</span>)}
              </span>
            </span>
          )
        })}
      </span>
    </span>
  )
}

/* ════════════════════════════════════════════════════════════════════════════
 * Sparklines: word-sized charts. Here (not in charts) so the foundation bundle (stat cards, kanban metrics) can use
 * them; the chart kit imports SparkChart and chartPath from core.
 * ══════════════════════════════════════════════════════════════════════════ */

/** Curve shape for line paths: straight segments or a monotone cubic. */
export type Curve = 'linear' | 'monotone'
/** SVG path through points (the chart kit and SparkChart share it). 'monotone' is a monotone cubic (Fritsch–Carlson): smooth, never overshoots the data. */
export function chartPath(pts: [number, number][], curve: Curve = 'linear', join = false) {
  if (!pts.length) return ''
  const head = `${join ? 'L' : 'M'}${sparkP1(pts[0][0])},${sparkP1(pts[0][1])}`
  if (curve === 'linear' || pts.length < 2) return head + pts.slice(1).map(p => `L${sparkP1(p[0])},${sparkP1(p[1])}`).join('')
  const n = pts.length, dx: number[] = [], m: number[] = [], t: number[] = []
  for (let i = 0; i < n - 1; i++) { dx[i] = pts[i + 1][0] - pts[i][0]; m[i] = dx[i] ? (pts[i + 1][1] - pts[i][1]) / dx[i] : 0 }
  t[0] = m[0]; t[n - 1] = m[n - 2]
  for (let i = 1; i < n - 1; i++) t[i] = m[i - 1] * m[i] <= 0 ? 0 : (3 * (dx[i - 1] + dx[i])) / ((2 * dx[i] + dx[i - 1]) / m[i - 1] + (dx[i] + 2 * dx[i - 1]) / m[i])
  let d = head
  for (let i = 0; i < n - 1; i++) {
    const [x0, y0] = pts[i], [x1, y1] = pts[i + 1], h = dx[i] / 3
    d += `C${sparkP1(x0 + h)},${sparkP1(y0 + t[i] * h)},${sparkP1(x1 - h)},${sparkP1(y1 - t[i + 1] * h)},${sparkP1(x1)},${sparkP1(y1)}`
  }
  return d
}
const sparkP1 = (n: number) => n.toFixed(1)
/** Width plus a flag that turns true once the element has scrolled into view. */
function useSparkFrame(amount: number) {
  const [ref, w] = useWidth<HTMLDivElement>()
  const seen = useInView(ref, { once: true, amount })
  return [ref, w, seen] as const
}

export type SparkVariant = 'line' | 'bars' | 'winloss' | 'area'
/**
 * Word-sized chart for tables and tiles. Variants: 'line' (optional end dot and min/max dots), 'bars' (last bar highlighted),
 * 'winloss' (up/down against the previous value) and 'area' (optional dashed `target`). Fills its container's width unless `width` is set.
 */
export function SparkChart({ data, variant = 'line', width, height = 36, color = 'var(--accent)', curve = 'linear', endDot, minMax, target, className }:
  { data: number[]; variant?: SparkVariant; width?: number; height?: number; color?: string; curve?: Curve; endDot?: boolean; minMax?: boolean; target?: number; className?: string }) {
  const [ref, mw, seen] = useSparkFrame(0.1)
  // fewer than two points has no shape to draw (and Math.min() of nothing is Infinity): keep the box, draw nothing
  if (data.length < 2) return <div ref={ref} className={cn('min-w-0', className)} style={{ width: width ?? '100%', height }} />
  const W = width ?? mw, H = height, pad = variant === 'line' || variant === 'area' ? 4 : 0
  const lo = minOf(data, target ?? Infinity), hi = maxOf(data, target ?? -Infinity)
  const n = data.length, Y = (v: number) => H - pad - ((v - lo) / (hi - lo || 1)) * (H - pad * 2)
  const pts = data.map((v, i) => [(i / Math.max(1, n - 1)) * W, Y(v)] as [number, number])
  const flat = pts.map(p => [p[0], H - pad] as [number, number])
  const P = seen ? pts : flat, line = chartPath(P, curve)
  const bw = W / n, mi = data.indexOf(minOf(data)), ma = data.indexOf(maxOf(data))
  // Every mark moves by CSS transitions (paths through the CSS `d` property, dots and bars by transform), so a live
  // update is one style write per mark and the browser interpolates: no per-frame attribute writes. Reduced motion jumps.
  const ease = `.45s ${ROLL_EASE}`
  const path = (d: string): CSSProperties => ({ d: `path("${d}")`, transition: `d ${ease}` } as CSSProperties)
  const dot = (x: number, y: number): CSSProperties => ({ transform: `translate(${sparkP1(x)}px,${sparkP1(y)}px)`, transition: `transform ${ease}, fill ${ease}` })
  const bar = (k: number, originY: number): CSSProperties => ({ transform: `scaleY(${k})`, transformOrigin: `0 ${originY}px`, transition: `transform ${ease}` })
  const still = 'motion-reduce:!transition-none'
  return (
    <div ref={ref} className={cn('min-w-0', className)} style={{ width: width ?? '100%', height: H }}>
      {W > 0 && (
        <svg width={W} height={H} className="block overflow-visible" aria-hidden>
          {variant === 'area' && <path className={still} d={`${line}L${sparkP1(W)},${H}L0,${H}Z`} style={path(`${line}L${sparkP1(W)},${H}L0,${H}Z`)} fill={color} fillOpacity={0.15} />}
          {variant === 'area' && target !== undefined && <line x1={0} x2={W} y1={Y(target)} y2={Y(target)} stroke="var(--fg3)" strokeDasharray="3 3" />}
          {(variant === 'line' || variant === 'area') && <path className={still} d={line} style={path(line)} fill="none" stroke={color} strokeWidth={1.6} strokeLinejoin="round" strokeLinecap="round" />}
          {variant === 'line' && minMax && seen && <>
            <circle className={still} r={2.6} fill="var(--bad)" style={dot(pts[mi][0], pts[mi][1])} />
            <circle className={still} r={2.6} fill="var(--ok)" style={dot(pts[ma][0], pts[ma][1])} />
          </>}
          {(variant === 'line' || variant === 'area') && (endDot || minMax) && <circle className={still} r={2.6} fill={minMax ? 'var(--accent)' : color} style={dot(P[n - 1][0], P[n - 1][1])} />}
          {variant === 'bars' && data.map((v, i) => {
            // a full-height bar scaled from the bottom edge: its attributes never change, only its transform
            const k = seen ? (4 + ((v - lo) / (hi - lo || 1)) * (H - 6)) / (H - 2) : 0
            return <rect key={i} className={still} x={i * bw + 0.6} y={2} width={Math.max(0.5, bw - 1.2)} height={H - 2} fill={i === n - 1 ? color : 'var(--line2)'} style={bar(k, H)} />
          })}
          {variant === 'winloss' && <>
            <line x1={0} x2={W} y1={H / 2} y2={H / 2} stroke="var(--line2)" />
            {data.map((v, i) => {
              if (!i) return null
              // drawn above the baseline and mirrored below it with scaleY(-1): a change of direction flips through 0
              const up = v >= data[i - 1], h = H * 0.3
              return <rect key={i} className={still} x={i * bw + 0.6} y={H / 2 - 1 - h} width={Math.max(0.5, bw - 1.2)} height={h} fill={up ? 'var(--ok)' : 'var(--bad)'} opacity={0.85}
                style={bar(seen ? (up ? 1 : -1) : 0, H / 2)} />
            })}
          </>}
        </svg>
      )}
    </div>
  )
}

/* Security helpers ────────────────────────────────────────────────────────────
 * Use these wherever a URL, colour or CSS value comes from props, data, storage or model output. */

const SAFE_URL_SCHEMES = ['http:', 'https:', 'mailto:', 'tel:']

/**
 * Returns `url` when it's relative (`/x`, `x`, `?q`, `#id`) or uses an allowed scheme (default http, https, mailto, tel);
 * otherwise `fallback` ('#'). Blocks `javascript:`, `data:`, `vbscript:`, `file:` and OS protocol handlers.
 */
export function safeUrl(url: string | null | undefined, { allow = SAFE_URL_SCHEMES, fallback = '#' }: { allow?: string[]; fallback?: string } = {}): string {
  if (url == null) return fallback
  const u = String(url).trim()
  if (!u) return fallback
  const probe = u.replace(/[\u0000- \u007f-\u009f]/g, '') // browsers ignore these inside a scheme
  const m = /^([a-z][a-z0-9+.-]*):/i.exec(probe)
  if (!m) return u
  return allow.includes(m[1].toLowerCase() + ':') ? u : fallback
}

/** Like `safeUrl` for media `src`: also allows `blob:` and `data:` of the given kind (image, audio or video); otherwise ''. */
export function safeMediaUrl(url: string | null | undefined, kind: 'image' | 'audio' | 'video' = 'image'): string {
  const u = safeUrl(url, { allow: ['http:', 'https:', 'blob:', 'data:'], fallback: '' })
  if (/^data:/i.test(u) && !new RegExp(`^data:${kind}/`, 'i').test(u)) return ''
  return u
}

/** A CSS `url("…")` with the value checked by `safeMediaUrl` and quotes/backslashes escaped; 'none' when unsafe. */
export const cssUrl = (url: string | null | undefined) => {
  const u = safeMediaUrl(url)
  return u ? `url("${u.replace(/["\\\n\r]/g, c => `\\${c.charCodeAt(0).toString(16)} `)}")` : 'none'
}

/**
 * Returns `value` if it's a plain CSS value (colours, numbers, lengths, `var(--x)`, `color-mix(…)`, `calc(…)`) with
 * no way to break out of a declaration or load a resource; otherwise `fallback`. Rejects `;`, braces, quotes, `url(`,
 * `expression(`, `image-set(` and `@`.
 */
export function safeCssValue(value: string | number | null | undefined, fallback = ''): string {
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : fallback
  if (typeof value !== 'string') return fallback
  const s = value.trim()
  if (!s || s.length > 200 || !/^[\w#%.,()\s/+*-]+$/.test(s) || /url\s*\(|expression\s*\(|image-set\s*\(/i.test(s)) return fallback
  return s
}

/** `safeCssValue` for colours, falling back to `currentColor`. */
export const safeColor = (color: string | null | undefined, fallback = 'currentColor') => safeCssValue(color, fallback) || fallback

/* ════════════════════════════════════════════════════════════════════════════
 * FORM CONTROLS (0.3): the plumbing that makes a custom control behave like a native field (name + hidden inputs,
 * required, disabled, read-only, invalid, reset, focus, FormField ids). Used by forms.tsx; keep this section together.
 * ══════════════════════════════════════════════════════════════════════════ */

/** What a FormField hands to the control inside it: ids for the label, description and error, plus field-level flags. */
export type FormFieldState = {
  id: string; /** only when the field has a visible label */ labelId?: string; descriptionId?: string; errorId?: string
  name?: string; invalid?: boolean; required?: boolean; disabled?: boolean; readOnly?: boolean
}
/** Provided by FormField (and Field); every control reads it. Provide `null` to keep it from reaching nested controls. */
export const FormFieldContext = createContext<FormFieldState | null>(null)

/** The form props every value-holding control takes, named as on native inputs. */
export type FormControlProps = {
  /** submitted with the form through hidden inputs (each control documents its format) */ name?: string
  /** id of a <form> elsewhere on the page, like the native attribute */ form?: string
  /** the form can't be submitted while it's empty; focus moves here on a failed submit */ required?: boolean
  disabled?: boolean
  /** shows and submits the value but can't change it */ readOnly?: boolean
  /** error look plus aria-invalid */ invalid?: boolean
  /** focus left the whole control (its own list or popover counts as inside) */ onBlur?: (e: import('react').FocusEvent<HTMLElement>) => void
  id?: string; 'aria-describedby'?: string; 'aria-labelledby'?: string
}

/** Controlled-or-uncontrolled state like useControllable, plus `reset()` back to the latest `defaultValue`. */
export function useControllableState<T>(value: T | undefined, defaultValue: T, onChange?: (v: T) => void) {
  const [inner, setInner] = useState(defaultValue)
  const controlled = value !== undefined
  const def = useRef(defaultValue)
  useLayoutEffect(() => { def.current = defaultValue })
  const set = useCallback((v: T) => { if (!controlled) setInner(v); onChange?.(v) }, [controlled, onChange])
  const reset = useCallback(() => setInner(def.current), [])
  return [controlled ? value : inner, set, reset] as const
}

/** Serialised form value: a string, one field per array item (repeated names), or null to submit nothing. */
export type FormValue = string | string[] | null
/** A local date as submitted by the date controls: "2026-11-08", like <input type="date">; '' for none. */
export const formDate = (d?: Date | null) => d ? dayKey(d) : ''
/** Disabled look for fields and field triggers: muted fill and secondary text (≥4.5:1, never faded with opacity), no hover. */
export const formDisabledClass = 'disabled:cursor-not-allowed disabled:!opacity-100 disabled:bg-[var(--muted)] disabled:text-[var(--fg3)] disabled:hover:border-[var(--line)] ' +
  'aria-disabled:cursor-not-allowed aria-disabled:bg-[var(--muted)] aria-disabled:text-[var(--fg3)] aria-disabled:hover:border-[var(--line)]'
/** Read-only look for fields: muted fill, normal text; still focusable and selectable. */
export const formReadOnlyClass = 'aria-readonly:bg-[var(--muted)] read-only:bg-[var(--muted)]'
const formJoinIds = (...ids: (string | undefined | false)[]) => ids.filter(Boolean).join(' ') || undefined

/** For native inputs (Input, Textarea…): the FormField's id, name, flags and aria-describedby merged under your own props. */
export function useFormFieldProps(p: { id?: string; name?: string; required?: boolean; disabled?: boolean; readOnly?: boolean; invalid?: boolean; 'aria-describedby'?: string }) {
  const f = useContext(FormFieldContext)
  return {
    id: p.id ?? f?.id, name: p.name ?? f?.name, required: p.required ?? f?.required, disabled: p.disabled ?? f?.disabled, readOnly: p.readOnly ?? f?.readOnly,
    invalid: p.invalid ?? f?.invalid, 'aria-describedby': formJoinIds(p['aria-describedby'], f?.descriptionId, f?.errorId),
  }
}

/**
 * Everything a custom control needs to act like a native field. Returns the value and a setter (ignored while disabled or
 * read-only), the merged flags, `control` props for the focusable element (id, aria-invalid, aria-describedby),
 * `labelledBy` for controls whose focus target isn't a labelable element, `onBlur` for the root, and `inputs` to render
 * inside the root (give the root `relative`):
 *   - one hidden input per serialised value (`name`), so FormData and server actions see it; nothing while disabled
 *   - with `required`, an invisible proxy the browser validates; when validation (or a form library) focuses it, focus
 *     moves to the real control and the control shows its error state until the value changes
 *   - an anchor that listens for the form's `reset` (uncontrolled values return to `defaultValue`) and fires bubbling
 *     `input` and `change` events on user edits, like a native field
 */
export function useFormControl<T>(p: FormControlProps & {
  value: T | undefined; defaultValue: T; onChange?: (v: T) => void
  serialize: (v: T) => FormValue
  /** whether `required` is met (default: something is submitted) */ filled?: (v: T) => boolean
  /** focus the real control (called when the proxy gets focus) */ focus?: () => void
  /** reset local state too (typed text, a query…) on form reset */ onReset?: () => void
  /** 'checkbox' validates like a required native checkbox (a "tick this box" message) */ kind?: 'text' | 'checkbox'
}) {
  const field = useContext(FormFieldContext)
  const [value, setValue, resetValue] = useControllableState(p.value, p.defaultValue, p.onChange)
  const name = p.name ?? field?.name
  const disabled = !!(p.disabled ?? field?.disabled), readOnly = !!(p.readOnly ?? field?.readOnly), required = !!(p.required ?? field?.required)
  const [failed, setFailed] = useState(false) // the browser found it invalid; cleared by the next change
  const invalid = !!(p.invalid ?? field?.invalid) || failed
  const anchor = useRef<HTMLInputElement>(null), byUser = useRef(false), fns = useRef(p)
  useLayoutEffect(() => { fns.current = p })
  const set = useCallback((v: T) => { if (disabled || readOnly) return; byUser.current = true; setValue(v) }, [disabled, readOnly, setValue])
  const serial = p.serialize(value)
  const vals = serial === null ? [] : Array.isArray(serial) ? serial : [serial]
  const filled = p.filled ? p.filled(value) : vals.some(v => v !== '')
  const key = JSON.stringify(serial), last = useRef(key)
  useEffect(() => {
    const changed = last.current !== key, user = byUser.current
    last.current = key; byUser.current = false
    if (!changed) return
    setFailed(false)
    if (user) { const a = anchor.current; a?.dispatchEvent(new Event('input', { bubbles: true })); a?.dispatchEvent(new Event('change', { bubbles: true })) }
  })
  useEffect(() => {
    const f = anchor.current?.form
    if (!f) return
    const on = () => { resetValue(); setFailed(false); fns.current.onReset?.() }
    f.addEventListener('reset', on)
    return () => f.removeEventListener('reset', on)
  }, [p.form, resetValue])
  const check = p.kind === 'checkbox'
  const inputs = (
    <>
      <input type="hidden" ref={anchor} form={p.form} />
      {name && !disabled && vals.map((v, i) => <input key={i} type="hidden" name={name} form={p.form} value={v} />)}
      {required && !disabled && !readOnly && (
        <input tabIndex={-1} aria-hidden required form={p.form} data-ui-field={name} type={check ? 'checkbox' : 'text'} {...(check ? { checked: filled } : { value: filled ? 'filled' : '' })}
          onChange={() => {}} onFocus={() => fns.current.focus?.()} onInvalid={() => setFailed(true)}
          className="pointer-events-none absolute bottom-0 left-2 m-0 h-px w-px appearance-none border-0 p-0 opacity-0" />
      )}
    </>
  )
  return {
    value, set, name, disabled, readOnly, required, invalid, field, inputs,
    control: { id: p.id ?? field?.id, 'aria-invalid': invalid || undefined, 'aria-describedby': formJoinIds(p['aria-describedby'], field?.descriptionId, field?.errorId) },
    labelledBy: p['aria-labelledby'] ?? field?.labelId,
    onBlur: (e: import('react').FocusEvent<HTMLElement>) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) fns.current.onBlur?.(e) },
  }
}
/* ═══ end FORM CONTROLS ═══ */
