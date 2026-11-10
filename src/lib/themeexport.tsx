/**
 * Theme export and import. Pure functions (no hooks, no DOM), so they also run on the server and in build scripts.
 * Every exporter starts from the tokens UIProvider applies (themeTokens), in light and dark:
 *   themeToCSS           the library's own variables: :root, prefers-color-scheme and [data-theme="dark"]
 *   themeToTailwind      a Tailwind CSS v4 @theme block (--color-*, --radius-*, --font-*, --shadow-card), dark via @variant dark
 *   themeToShadcn        shadcn/ui variables as oklch(): :root and .dark
 *   themeToDTCG          W3C Design Tokens (DTCG 2025.10) JSON: groups color, radius, font, shadow
 *   themeToTokensStudio  Tokens Studio for Figma JSON: token sets global/light/dark plus $themes
 * themeImport reads a shadcn, CSS or Tailwind block, or DTCG / Tokens Studio JSON, back into Custom palettes, checked
 * like saved settings (themeLoad), with a note for each colour it had to guess, blend, clip or nudge for contrast.
 * Part of @lyndon/ui/themeexport (also in @lyndon/ui/utils).
 */
import { type CustomTheme, DEFAULT_THEME, FONTS, type Palette, THEMES, type ThemeSettings, contrast, derive, hex, luminance, mix, rgb, themeLoad, themeSafeTokens, themeTokens } from './core'

/* ════════════════════════════════════════════════════════════════════════════
 * 1. SOURCE
 * ══════════════════════════════════════════════════════════════════════════ */

export type ThemeExportMode = 'light' | 'dark'

/**
 * What the exporters read: resolved tokens (as themeTokens returns them) per mode, and a name for the header. A built-in
 * theme has both modes; a Custom theme is one palette, so it has one (the mode it leans).
 */
export type ThemeExportSource = { label: string; modes: Partial<Record<ThemeExportMode, Record<string, string>>> }

/** Settings (resolved with themeTokens) or tokens you already have. */
export type ThemeExportInput = ThemeSettings | ThemeExportSource

/** The export formats, with the file each one downloads as. Labels are product and format names (not translated). */
export const THEME_EXPORT_FORMATS = [
  { id: 'css', label: 'CSS', filename: 'theme.css', type: 'text/css' }, // i18n-ignore
  { id: 'tailwind', label: 'Tailwind', filename: 'theme.tailwind.css', type: 'text/css' }, // i18n-ignore
  { id: 'shadcn', label: 'shadcn', filename: 'shadcn-theme.css', type: 'text/css' }, // i18n-ignore
  { id: 'dtcg', label: 'DTCG', filename: 'tokens.json', type: 'application/json' }, // i18n-ignore
  { id: 'tokens-studio', label: 'Figma', filename: 'tokens-studio.json', type: 'application/json' }, // i18n-ignore
] as const

export type ThemeExportFormat = (typeof THEME_EXPORT_FORMATS)[number]['id']

/** The font stack of --mono (not a theme setting: the same in every theme). */
const TX_MONO = '"Geist Mono",ui-monospace,"SF Mono",Menlo,monospace'

/** Colour tokens in export order: the 15 base colours, then what derive() adds. */
const TX_COLOURS = ['bg', 'card', 'muted', 'line', 'line2', 'fg', 'fg2', 'fg3', 'primary', 'on-primary', 'accent', 'accent-soft', 'ok', 'ok-soft',
  'warn', 'warn-soft', 'bad', 'bad-soft', 'c1', 'c2', 'c3', 'c4', 'c-neutral', 'band'] as const

/**
 * The export source for a set of settings: both modes for a built-in family ("Nord (Light / Dark)"), the one palette
 * for a Custom theme. Settings are validated first (themeLoad), so this never throws.
 */
export function themeExportSource(s: ThemeSettings): ThemeExportSource {
  const c = themeLoad(s)
  // i18n-ignore: theme names are proper nouns in a code comment of the export
  if (c.useCustom && c.custom) return { label: 'Custom', modes: { [c.custom.dark ? 'dark' : 'light']: themeTokens(c, c.custom.dark) } }
  const t = THEMES.find(x => x.id === c.theme) ?? THEMES[0], i = c.variant[t.id] ?? 0
  const name = (list: [string, Palette][]) => list[Math.min(i, list.length - 1)][0]
  return { label: `${t.name} (${name(t.light)} / ${name(t.dark)})`, modes: { light: themeTokens(c, false), dark: themeTokens(c, true) } }
}

type TxSource = { label: string; base: ThemeExportMode; light?: Record<string, string>; dark?: Record<string, string> }

/** Normalise an input: settings resolve through themeTokens; given tokens keep only values themeTokenOk accepts. */
function txSource(input: ThemeExportInput): TxSource {
  const src = input && typeof input === 'object' && 'modes' in input && input.modes && typeof input.modes === 'object' ? input : themeExportSource(input as ThemeSettings)
  const clean = (t: unknown) => (t && typeof t === 'object' ? themeSafeTokens(t as Record<string, string>) : undefined)
  let light = clean(src.modes.light), dark = clean(src.modes.dark)
  if (!light?.bg && !dark?.bg) ({ light, dark } = { light: themeTokens(DEFAULT_THEME, false), dark: themeTokens(DEFAULT_THEME, true) })
  return { label: typeof src.label === 'string' ? src.label : '', base: light?.bg ? 'light' : 'dark', light: light?.bg ? light : undefined, dark: dark?.bg ? dark : undefined }
}

/** The first mode, and the tokens of the second that differ from it (null for a one-palette theme). */
const txModes = (s: TxSource) => {
  const first = (s[s.base] ?? {}) as Record<string, string>
  const second = s.base === 'light' && s.dark ? s.dark : null
  return { first, second, changed: (keys: readonly string[]) => keys.filter(k => second && second[k] !== undefined && second[k] !== first[k]) }
}

/** A comment that can't close itself or a <style>. */
const txComment = (text: string) => `/* ${text.replace(/\*\//g, '* /').replace(/</g, '\\3c ')} */`

/** The header line of each export. */
const txTitle = (s: TxSource, what: string) => `${s.label ? `${s.label} · ` : ''}@lyndon/ui theme · ${what}`

/** A number with at most `d` decimals and no trailing zeros. */
const txNum = (n: number, d: number) => { const v = Number(n.toFixed(d)); return String(Object.is(v, -0) ? 0 : v) }

/** A px token ('8px') as a number. */
const txPx = (v: string | undefined, fallback: number) => { const n = parseFloat(v ?? ''); return Number.isFinite(n) ? n : fallback }

/** The families of a CSS font stack, unquoted. */
const txFamilies = (stack: string) => stack.split(',').map(f => f.trim().replace(/^["']|["']$/g, '')).filter(Boolean)

/** An rgba()/hex token value as [r, g, b] (0–255) and alpha. */
function txRgba(v: string): { c: number[]; a: number } {
  const m = /^rgba?\((\d{1,3}),(\d{1,3}),(\d{1,3})(?:,([\d.]+))?\)$/.exec(v.replace(/\s+/g, ''))
  if (m) return { c: [+m[1], +m[2], +m[3]], a: m[4] === undefined ? 1 : Math.min(1, Number(m[4])) }
  return { c: rgb(v), a: 1 }
}

/* ════════════════════════════════════════════════════════════════════════════
 * 2. OKLCH
 * ══════════════════════════════════════════════════════════════════════════ */

const txLinear = (v: number) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)
const txGamma = (v: number) => (v <= 0.0031308 ? 12.92 * v : 1.055 * Math.sign(v) * Math.abs(v) ** (1 / 2.4) - 0.055)

/** sRGB (0–255) → OKLab [L, a, b] (Björn Ottosson's matrices). */
function txOklab(c: number[]): [number, number, number] {
  const [r, g, b] = c.map(v => txLinear(v / 255))
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b)
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b)
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b)
  return [0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s, 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s, 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s]
}

/** OKLab → sRGB (0–255, not clamped: values outside 0–255 are out of the sRGB gamut). */
function txFromOklab(L: number, A: number, B: number): number[] {
  const l = (L + 0.3963377774 * A + 0.2158037573 * B) ** 3, m = (L - 0.1055613458 * A - 0.0638541728 * B) ** 3, s = (L - 0.0894841775 * A - 1.291485548 * B) ** 3
  return [4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s, -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s, -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s].map(v => txGamma(v) * 255)
}

/** '#RRGGBB' → OKLCH [L 0–1, C, H 0–360] (H is 0 for greys). */
export function hexToOklch(color: string): [number, number, number] {
  const [L, A, B] = txOklab(rgb(color)), C = Math.hypot(A, B)
  return [L, C, C < 5e-5 ? 0 : ((Math.atan2(B, A) * 180) / Math.PI + 360) % 360]
}

/** OKLCH → '#RRGGBB', clipped to sRGB. */
export function oklchToHex(L: number, C: number, H: number): string {
  const h = (H * Math.PI) / 180
  return hex(txFromOklab(L, C * Math.cos(h), C * Math.sin(h)))
}

/**
 * A colour as CSS `oklch()`, like shadcn/ui writes it (`oklch(0.141 0.005 285.8)`, `oklch(1 0 0 / 10%)`): L and C get
 * the fewest decimals (3 to 6) that convert back to the same '#RRGGBB', the hue three.
 */
export function oklchString(color: string, alpha = 1) {
  const [L, C, H] = hexToOklch(color), want = hex(rgb(color))
  let d = 3
  while (d < 6 && oklchToHex(Number(L.toFixed(d)), Number(C.toFixed(d)), Number(H.toFixed(3))) !== want) d++
  const c = txNum(C, d)
  return `oklch(${txNum(L, d)} ${c} ${c === '0' ? 0 : txNum(H, 3)}${alpha < 1 ? ` / ${txNum(alpha * 100, 2)}%` : ''})`
}

/* ════════════════════════════════════════════════════════════════════════════
 * 3. EXPORTERS
 * ══════════════════════════════════════════════════════════════════════════ */

/** Non-colour tokens after the colours, in order. */
const TX_REST = ['shadow', 'r-sm', 'r-md', 'r-lg', 'font'] as const

/**
 * The library's own CSS variables, both modes, the way UIProvider's style sheet applies them: `:root` (light), the dark
 * values under `@media (prefers-color-scheme: dark)` unless `data-theme="light"`, and under `:root[data-theme="dark"]`.
 * A Custom theme is one `:root` block. Use it with `<UIProvider injectStyles={false}>` or in a page without React.
 */
export function themeToCSS(input: ThemeExportInput): string {
  const s = txSource(input), { first, second, changed } = txModes(s)
  const decl = (t: Record<string, string>, keys: readonly string[], scheme: string, pad: string) =>
    [...keys.filter(k => t[k] !== undefined).map(k => `${pad}--${k}: ${t[k]};`), `${pad}color-scheme: ${scheme};`].join('\n')
  let out = `${txComment(txTitle(s, 'CSS variables'))}\n:root {\n${decl(first, [...TX_COLOURS, ...TX_REST], s.base, '  ')}\n}\n`
  if (second) {
    const keys = changed([...TX_COLOURS, ...TX_REST])
    out += `@media (prefers-color-scheme: dark) {\n  :root:not([data-theme="light"]) {\n${decl(second, keys, 'dark', '    ')}\n  }\n}\n:root[data-theme="dark"] {\n${decl(second, keys, 'dark', '  ')}\n}\n`
  }
  return out
}

/** Tailwind theme variable for each library token. */
const TX_TAILWIND: [string, string][] = [...TX_COLOURS.map(k => [k, `color-${k}`] as [string, string]),
  ['r-sm', 'radius-sm'], ['r-md', 'radius-md'], ['r-lg', 'radius-lg'], ['font', 'font-sans'], ['mono', 'font-mono'], ['shadow', 'shadow-card']]

export type ThemeTailwindOptions = {
  /**
   * What `dark:` (and the dark values) follow. 'data-theme' (default): `data-theme="dark"` on an ancestor, which
   * UIProvider sets; 'class': a `.dark` class (next-themes, shadcn); 'media': the OS setting, Tailwind's default.
   * The first two add a `@custom-variant dark` line.
   */
  dark?: 'data-theme' | 'class' | 'media'
  /**
   * Map the theme variables onto the library's own (`@theme inline { --color-card: var(--card) }`) instead of copying
   * values: for apps that render UIProvider, which already switches the variables per mode and per user choice.
   */
  inline?: boolean
}

/**
 * A Tailwind CSS v4 theme: `@theme { --color-bg … --radius-md … --font-sans … --shadow-card }`, so utilities like
 * `bg-card`, `text-fg2`, `border-line`, `bg-accent-soft`, `rounded-md` and `shadow-card` use it. The dark values sit in
 * `@layer theme { :root { @variant dark { … } } }`. Paste it after `@import "tailwindcss";`.
 */
export function themeToTailwind(input: ThemeExportInput, { dark = 'data-theme', inline = false }: ThemeTailwindOptions = {}): string {
  const s = txSource(input)
  if (inline) {
    return `${txComment(txTitle(s, 'Tailwind CSS v4, mapped onto the variables UIProvider sets'))}\n@theme inline {\n${TX_TAILWIND.map(([k, n]) => `  --${n}: var(--${k});`).join('\n')}\n}\n`
  }
  const { first, second, changed } = txModes(s), all = { ...first, mono: TX_MONO }
  const variant = dark === 'class' ? '@custom-variant dark (&:where(.dark, .dark *));\n\n' : dark === 'media' ? '' : '@custom-variant dark (&:where([data-theme=dark], [data-theme=dark] *));\n\n'
  let out = `${txComment(txTitle(s, 'Tailwind CSS v4'))}\n${second ? variant : ''}@theme {\n${TX_TAILWIND.filter(([k]) => all[k as keyof typeof all] !== undefined).map(([k, n]) => `  --${n}: ${all[k as keyof typeof all]};`).join('\n')}\n}\n`
  if (second) {
    const keys = new Set(changed(TX_TAILWIND.map(t => t[0])))
    out += `\n@layer theme {\n  :root, :host {\n    @variant dark {\n${TX_TAILWIND.filter(([k]) => keys.has(k)).map(([k, n]) => `      --${n}: ${second[k]};`).join('\n')}\n    }\n  }\n}\n`
  }
  return out
}

/** shadcn/ui variable ← library token. `success` and `warning` are extras (not in shadcn's default set). */
const TX_SHADCN: [string, string][] = [
  ['background', 'bg'], ['foreground', 'fg'], ['card', 'card'], ['card-foreground', 'fg'], ['popover', 'card'], ['popover-foreground', 'fg'],
  ['primary', 'primary'], ['primary-foreground', 'on-primary'], ['secondary', 'muted'], ['secondary-foreground', 'fg'], ['muted', 'muted'],
  ['muted-foreground', 'fg2'], ['accent', 'muted'], ['accent-foreground', 'fg'], ['destructive', 'bad'], ['border', 'line'], ['input', 'line2'],
  ['ring', 'accent'], ['chart-1', 'c1'], ['chart-2', 'c2'], ['chart-3', 'c3'], ['chart-4', 'c4'], ['chart-5', 'c-neutral'],
  ['sidebar', 'bg'], ['sidebar-foreground', 'fg'], ['sidebar-primary', 'primary'], ['sidebar-primary-foreground', 'on-primary'], ['sidebar-accent', 'muted'],
  ['sidebar-accent-foreground', 'fg'], ['sidebar-border', 'line'], ['sidebar-ring', 'accent'], ['success', 'ok'], ['warning', 'warn'],
]

/** shadcn's `@theme inline` block (in its globals.css), for a project that doesn't have it yet. */
const TX_SHADCN_INLINE = `@theme inline {\n  --radius-sm: calc(var(--radius) - 4px);\n  --radius-md: calc(var(--radius) - 2px);\n  --radius-lg: var(--radius);\n  --radius-xl: calc(var(--radius) + 4px);\n${
  TX_SHADCN.map(([n]) => `  --color-${n}: var(--${n});`).join('\n')}\n}\n`

/**
 * shadcn/ui theme variables, as `oklch()` like current shadcn (Tailwind v4): `:root` (light, with `--radius`) and
 * `.dark`. Replace the two blocks in your globals.css. Mapping: background ← bg, card/popover ← card,
 * secondary/muted/accent ← muted (shadcn's accent is a hover surface), muted-foreground ← fg2, destructive ← bad,
 * border ← line, input ← line2, ring ← accent, chart-1…5 ← c1, c2, c3, c4, c-neutral, sidebar-* likewise, plus
 * `--success` and `--warning`. `--radius` is the theme radius + 2px (shadcn's buttons use radius − 2px).
 * `themeInline` adds shadcn's `@theme inline` mapping for a project that has none.
 */
export function themeToShadcn(input: ThemeExportInput, { themeInline = false }: { themeInline?: boolean } = {}): string {
  const s = txSource(input), { first, second } = txModes(s)
  const block = (sel: string, t: Record<string, string>, radius: boolean) => `${sel} {\n${radius ? `  --radius: ${txNum((txPx(t['r-md'], 8) + 2) / 16, 4)}rem;\n` : ''}${
    TX_SHADCN.filter(([, k]) => t[k]).map(([n, k]) => `  --${n}: ${oklchString(t[k])};`).join('\n')}\n}\n`
  const head = txComment(txTitle(s, s.base === 'dark' && !second ? 'shadcn/ui variables (one dark palette, in :root)' : 'shadcn/ui variables'))
  return `${head}\n${block(':root', first, true)}${second ? `\n${block('.dark', second, false)}` : ''}${themeInline ? `\n${TX_SHADCN_INLINE}` : ''}`
}

/** A DTCG colour value (2025.10: colour space, components and the hex fallback). */
function txDtcgColour(v: string) {
  const { c, a } = txRgba(v)
  return { colorSpace: 'srgb', components: c.map(x => Number((x / 255).toFixed(4))), ...(a < 1 ? { alpha: a } : {}), hex: hex(c).toLowerCase() }
}

/** The layers of a box-shadow token: offsets, blur, spread and colour. */
function txShadowLayers(v: string) {
  const out: { x: number; y: number; blur: number; spread: number; color: string }[] = []
  for (const m of v.matchAll(/(-?[\d.]+)(?:px)?\s+(-?[\d.]+)(?:px)?\s+([\d.]+)(?:px)?(?:\s+(-?[\d.]+)(?:px)?)?\s+(rgba?\([^)]*\)|#[0-9a-fA-F]{3,8})/g))
    out.push({ x: +m[1], y: +m[2], blur: +m[3], spread: m[4] ? +m[4] : 0, color: m[5] })
  return out
}

const txDim = (n: number) => ({ value: n, unit: 'px' })

/** The DTCG tree of one mode's tokens. */
function txDtcgTree(t: Record<string, string>) {
  return {
    color: Object.fromEntries(TX_COLOURS.filter(k => t[k]).map(k => [k, txDtcgColour(t[k])])),
    radius: { sm: txDim(txPx(t['r-sm'], 4)), md: txDim(txPx(t['r-md'], 8)), lg: txDim(txPx(t['r-lg'], 14)) },
    font: { sans: txFamilies(t.font ?? ''), mono: txFamilies(TX_MONO) },
    shadow: { card: txShadowLayers(t.shadow ?? '').map(l => ({ color: txDtcgColour(l.color), offsetX: txDim(l.x), offsetY: txDim(l.y), blur: txDim(l.blur), spread: txDim(l.spread) })) },
  }
}

/** The vendor key of this library's $extensions. */
export const THEME_DTCG_EXTENSION = '@lyndon/ui'

const TX_DTCG_TYPES = { color: 'color', radius: 'dimension', font: 'fontFamily', shadow: 'shadow' } as const

/**
 * W3C Design Tokens (DTCG format 2025.10) as an object: groups `color` (`$type: color`, values as
 * `{ colorSpace: 'srgb', components, alpha?, hex }`), `radius` (dimension `{ value, unit: 'px' }`), `font`
 * (fontFamily lists) and `shadow` (`card`). Modes, as the format has none of its own:
 * - `modes: 'extensions'` (default): `$value` is the light value; the dark one is in
 *   `$extensions["@lyndon/ui"].modes.dark` of each token that changes.
 * - `modes: 'sets'`: two top-level groups, `light` and `dark`, each a full tree (one file per mode for Style Dictionary).
 * A Custom theme has its one mode only (`$extensions["@lyndon/ui"].mode` on the root says which).
 */
export function themeToDTCGTokens(input: ThemeExportInput, { modes = 'extensions' }: { modes?: 'extensions' | 'sets' } = {}): Record<string, unknown> {
  const s = txSource(input), { first, second } = txModes(s)
  const desc = `${txTitle(s, 'design tokens')}.`
  const typed = (tree: ReturnType<typeof txDtcgTree>, other?: ReturnType<typeof txDtcgTree>) => Object.fromEntries((Object.keys(TX_DTCG_TYPES) as (keyof typeof TX_DTCG_TYPES)[]).map(g => {
    const group = tree[g] as Record<string, unknown>, alt = other?.[g] as Record<string, unknown> | undefined
    return [g, { $type: TX_DTCG_TYPES[g], ...Object.fromEntries(Object.entries(group).map(([k, v]) => {
      const d = alt?.[k], differs = d !== undefined && JSON.stringify(d) !== JSON.stringify(v)
      return [k, differs ? { $value: v, $extensions: { [THEME_DTCG_EXTENSION]: { modes: { dark: d } } } } : { $value: v }]
    })) }]
  }))
  const one = txDtcgTree(first), two = second ? txDtcgTree({ ...first, ...second }) : undefined
  if (modes === 'sets') {
    return { $description: desc, ...(two ? { light: typed(one), dark: typed(two) } : { [s.base]: typed(one) }) }
  }
  return { $description: two ? `${desc} $value is the light mode; $extensions["${THEME_DTCG_EXTENSION}"].modes.dark holds the dark value.` : desc,
    $extensions: { [THEME_DTCG_EXTENSION]: two ? { modes: ['light', 'dark'] } : { mode: s.base } }, ...typed(one, two) }
}

/** Pretty JSON with short arrays of numbers or strings (colour components, font lists) kept on one line. */
const txJson = (v: unknown) => JSON.stringify(v, null, 2).replace(/\[\n\s*((?:-?[\d.e-]+|"[^"\n]*")(?:,\n\s*(?:-?[\d.e-]+|"[^"\n]*"))*)\n\s*\]/g, (_, items: string) => `[${items.split(/,\n\s*/).join(', ')}]`) + '\n'

/** themeToDTCGTokens as formatted JSON (a `tokens.json`). */
export const themeToDTCG = (input: ThemeExportInput, opts?: { modes?: 'extensions' | 'sets' }) => txJson(themeToDTCGTokens(input, opts))

/**
 * Tokens Studio for Figma (legacy `value`/`type` format): sets `global` (radius, fonts), `light` and `dark` (colours,
 * shadow), with `$themes` Light and Dark and `$metadata.tokenSetOrder`. Load it in the plugin's JSON tab, or sync it
 * from a repository.
 */
export function themeToTokensStudio(input: ThemeExportInput): string {
  const s = txSource(input), { first, second } = txModes(s)
  const set = (t: Record<string, string>) => ({
    color: Object.fromEntries(TX_COLOURS.filter(k => t[k]).map(k => [k, { value: t[k], type: 'color' }])),
    shadow: { card: { value: txShadowLayers(t.shadow ?? '').map(l => ({ x: String(l.x), y: String(l.y), blur: String(l.blur), spread: String(l.spread), color: l.color, type: 'dropShadow' })), type: 'boxShadow' } },
  })
  const global = {
    radius: Object.fromEntries((['sm', 'md', 'lg'] as const).map(k => [k, { value: first[`r-${k}`] ?? '', type: 'borderRadius' }])),
    font: { sans: { value: txFamilies(first.font ?? '').join(', '), type: 'fontFamilies' }, mono: { value: txFamilies(TX_MONO).join(', '), type: 'fontFamilies' } },
  }
  const modes: ThemeExportMode[] = second ? ['light', 'dark'] : [s.base]
  const sets = Object.fromEntries(modes.map(m => [m, set(m === s.base ? first : { ...first, ...second })]))
  return txJson({
    global, ...sets,
    $themes: modes.map(m => ({ id: m, name: m === 'light' ? 'Light' : 'Dark', selectedTokenSets: { global: 'source', [m]: 'enabled' } })),
    $metadata: { tokenSetOrder: ['global', ...modes] },
  })
}

/** One export by format id (what the appearance panel's tabs show). */
export function themeExport(format: ThemeExportFormat, input: ThemeExportInput): string {
  switch (format) {
    case 'tailwind': return themeToTailwind(input)
    case 'shadcn': return themeToShadcn(input)
    case 'dtcg': return themeToDTCG(input)
    case 'tokens-studio': return themeToTokensStudio(input)
    default: return themeToCSS(input)
  }
}

/* ════════════════════════════════════════════════════════════════════════════
 * 4. IMPORT
 * ══════════════════════════════════════════════════════════════════════════ */

export type ThemeImportFormat = 'shadcn' | 'css' | 'tailwind' | 'dtcg' | 'tokens-studio'

/**
 * Something themeImport changed or guessed: `missing` (no value: a default or a derived colour was used), `blended`
 * (a translucent colour was flattened onto the background), `clipped` (outside sRGB, e.g. a wide-gamut oklch()),
 * `contrast` (derive() nudged it to reach 4.5:1: `from` → `to`) and `font` (a font the panel doesn't offer; kept yours).
 */
export type ThemeImportNote = { code: 'missing' | 'blended' | 'clipped' | 'contrast' | 'font'; mode: ThemeExportMode; token: string; from?: string; to?: string }

export type ThemeImportResult =
  | { ok: true; format: ThemeImportFormat; light: CustomTheme | null; dark: CustomTheme | null; radius: number | null; font: string | null; notes: ThemeImportNote[] }
  | { ok: false; error: 'empty' | 'too-large' | 'invalid-json' | 'unrecognised' }

/** The most text themeImport reads (a theme is a few kB). */
export const THEME_IMPORT_MAX = 200_000

type TxVars = Map<string, string>

/** Every block of `--name: value` declarations with its mode, from its selector and enclosing at-rules. */
function txCssVars(css: string): { light: TxVars; dark: TxVars; tailwind: boolean } {
  const src = css.replace(/\/\*[\s\S]*?\*\//g, '')
  const light: TxVars = new Map(), dark: TxVars = new Map()
  const levels: { prelude: string; text: string }[] = [{ prelude: '', text: '' }]
  let tailwind = false
  const flush = (preludes: string[], text: string) => {
    const p = preludes.join(' ').toLowerCase()
    if (/@theme\b/.test(p)) tailwind = true
    if (/@(keyframes|font-face|property|supports\s+not)/.test(p)) return
    const isDark = /dark/.test(p.replace(/:not\([^)]*\)/g, ''))
    for (const m of text.matchAll(/--([\w-]{1,60})\s*:\s*([^;{}]{0,200})/g)) {
      const name = m[1].toLowerCase(), value = m[2].replace(/!important\s*$/i, '').trim()
      if (value) (isDark ? dark : light).set(name, value)
    }
  }
  for (const ch of src) {
    const top = levels[levels.length - 1]
    if (ch === '{') {
      if (levels.length > 16) return { light, dark, tailwind }
      const cut = top.text.lastIndexOf(';')
      levels.push({ prelude: top.text.slice(cut + 1).trim(), text: '' }); top.text = top.text.slice(0, cut + 1)
    } else if (ch === '}') {
      if (levels.length === 1) continue
      const b = levels.pop()!
      flush([...levels.map(l => l.prelude), b.prelude], b.text)
      levels[levels.length - 1].text += ';'
    } else top.text += ch
  }
  flush([], levels[0].text)
  return { light, dark, tailwind }
}

/** A DTCG / Tokens Studio colour value as a CSS colour string (or an alias `{path}`), or null. */
function txDtcgValue(v: unknown): string | null {
  if (typeof v === 'string') return v.length <= 200 ? v : null
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null
  const o = v as Record<string, unknown>, cs = o.colorSpace, comps = o.components, a = typeof o.alpha === 'number' ? o.alpha : 1
  const n = (x: unknown) => (x === 'none' ? 0 : typeof x === 'number' && Number.isFinite(x) ? x : NaN)
  if (Array.isArray(comps) && comps.length === 3) {
    const [x, y, z] = comps.map(n)
    if ([x, y, z, a].every(Number.isFinite)) {
      if (cs === 'srgb') return `rgb(${x * 255} ${y * 255} ${z * 255} / ${a})`
      if (cs === 'srgb-linear') return `rgb(${[x, y, z].map(c => txGamma(c) * 255).join(' ')} / ${a})`
      if (cs === 'hsl') return `hsl(${x} ${y}% ${z}% / ${a})`
      if (cs === 'oklch') return `oklch(${x} ${y} ${z} / ${a})`
      if (cs === 'oklab') return `oklab(${x} ${y} ${z} / ${a})`
    }
  }
  return typeof o.hex === 'string' && /^#[0-9a-f]{6}$/i.test(o.hex) ? (a < 1 ? `rgb(${rgb(o.hex).join(' ')} / ${a})` : o.hex) : null
}

/** A DTCG dimension (`{ value, unit }` or '8px') as a CSS length string. */
const txDtcgDim = (v: unknown) => typeof v === 'string' ? v : v && typeof v === 'object' && typeof (v as { value?: unknown }).value === 'number'
  ? `${(v as { value: number }).value}${(v as { unit?: unknown }).unit === 'rem' ? 'rem' : 'px'}` : null

/** Tokens from DTCG or Tokens Studio JSON, as the same name → CSS value maps the CSS reader makes. */
function txJsonVars(doc: unknown): { light: TxVars; dark: TxVars; studio: boolean } {
  const light: TxVars = new Map(), dark: TxVars = new Map()
  let count = 0, studio = false
  const isDarkSeg = (k: string) => /dark|night/i.test(k), isModeSeg = (k: string) => /^(light|dark|day|night|global|core|base)$/i.test(k) || /(^|[-_ ])(light|dark)($|[-_ ])/i.test(k)
  const put = (path: string[], type: string | undefined, raw: unknown, ext: unknown) => {
    const mode = path.some(isDarkSeg) ? dark : light, clean = path.filter(k => !isModeSeg(k))
    const key = clean.join('.').toLowerCase(), last = clean[clean.length - 1]?.toLowerCase() ?? ''
    const t = type ?? (clean[0] && /^colou?rs?$/i.test(clean[0]) ? 'color' : undefined)
    const value = t === 'dimension' || t === 'borderRadius' ? txDtcgDim(raw) : t === 'fontFamily' || t === 'fontFamilies'
      ? (Array.isArray(raw) ? raw.filter(x => typeof x === 'string').join(', ') : typeof raw === 'string' ? raw : null) : txDtcgValue(raw)
    if (!value) return
    mode.set(key, value)
    if (t === 'color' && last) mode.set(last, value)
    const alt = ext && typeof ext === 'object' ? (ext as Record<string, unknown>)[THEME_DTCG_EXTENSION] : null
    const d = alt && typeof alt === 'object' ? ((alt as { modes?: Record<string, unknown> }).modes)?.dark : undefined
    if (d !== undefined) { const dv = t === 'color' || !t ? txDtcgValue(d) : txDtcgDim(d); if (dv) { dark.set(key, dv); if (t === 'color' && last) dark.set(last, dv) } }
  }
  const walk = (node: unknown, path: string[], type: string | undefined, depth: number) => {
    if (!node || typeof node !== 'object' || Array.isArray(node) || depth > 10 || ++count > 5000) return
    const o = node as Record<string, unknown>
    const own = typeof o.$type === 'string' ? o.$type : undefined
    if ('$value' in o) return put(path, own ?? type, o.$value, o.$extensions)
    if ('value' in o && typeof o.type === 'string') { studio = true; return put(path, o.type, o.value, undefined) }
    for (const k of Object.keys(o)) if (!k.startsWith('$') && k.length <= 60) walk(o[k], [...path, k], own ?? type, depth + 1)
  }
  walk(doc, [], undefined, 0)
  if (doc && typeof doc === 'object' && ('$themes' in doc || '$metadata' in doc)) studio = true
  return { light, dark, studio }
}

/* Colour parsing ─────────────────────────────────────────────────────────── */

type TxColour = { c: number[]; a: number; clipped: boolean }

/** A number, or a percentage of `pct`; 'none' is 0. NaN when it is neither. */
const txArg = (s: string | undefined, pct: number) => {
  if (s === undefined) return NaN
  if (s === 'none') return 0
  const n = parseFloat(s)
  return /^-?[\d.]+(e-?\d+)?%$/.test(s) ? (n * pct) / 100 : /^-?[\d.]+(e-?\d+)?(deg)?$/.test(s) ? n : NaN
}

/** HSL (degrees, 0–1, 0–1) → sRGB 0–255. */
const txHsl = (h: number, s: number, l: number) => {
  const k = (n: number) => (n + h / 30) % 12, a = s * Math.min(l, 1 - l)
  return [0, 8, 4].map(n => (l - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1))) * 255)
}

/**
 * A CSS colour: hex (3, 4, 6 or 8 digits), rgb()/rgba(), hsl()/hsla(), shadcn's old bare `H S% L%`, oklch(), oklab(),
 * white, black or transparent. Anything else (other names, color-mix(), var() left over) is null.
 */
function txParseColour(raw: string): TxColour | null {
  const v = raw.trim().toLowerCase()
  if (!v || v.length > 200) return null
  if (v === 'white' || v === 'black') return { c: v === 'white' ? [255, 255, 255] : [0, 0, 0], a: 1, clipped: false }
  if (v === 'transparent') return { c: [0, 0, 0], a: 0, clipped: false }
  const h = /^#([0-9a-f]{3,8})$/.exec(v)?.[1]
  if (h) {
    if (h.length === 5 || h.length === 7) return null
    const full = h.length <= 4 ? [...h].map(x => x + x).join('') : h
    return { c: rgb('#' + full.slice(0, 6)), a: full.length === 8 ? parseInt(full.slice(6), 16) / 255 : 1, clipped: false }
  }
  const fn = /^(rgba?|hsla?|oklch|oklab)\(([^()]*)\)$/.exec(v)
  const bare = !fn && /^-?[\d.]+(deg)?\s+[\d.]+%\s+[\d.]+%(\s*\/\s*[\d.]+%?)?$/.test(v)
  if (!fn && !bare) return null
  const body = fn ? fn[2] : v, kind = fn ? fn[1].replace(/a$/, '') : 'hsl'
  const [main, slash] = body.split('/')
  const parts = main.trim().split(/\s*,\s*|\s+/).filter(Boolean)
  const alphaStr = slash?.trim() ?? (parts.length === 4 ? parts.pop() : undefined)
  if (parts.length !== 3) return null
  const a = alphaStr === undefined ? 1 : txArg(alphaStr, 1)
  let c: number[]
  if (kind === 'rgb') c = parts.map(p => txArg(p, 255))
  else if (kind === 'hsl') c = txHsl(txArg(parts[0], 360), txArg(parts[1], 1), txArg(parts[2], 1))
  else if (kind === 'oklch') { const L = txArg(parts[0], 1), C = txArg(parts[1], 0.4), H = (txArg(parts[2], 360) * Math.PI) / 180; c = txFromOklab(L, C * Math.cos(H), C * Math.sin(H)) }
  else c = txFromOklab(txArg(parts[0], 1), txArg(parts[1], 0.4), txArg(parts[2], 0.4))
  if (![...c, a].every(Number.isFinite)) return null
  const clipped = c.some(x => x < -0.5 || x > 255.5)
  return { c: c.map(x => Math.max(0, Math.min(255, x))), a: Math.max(0, Math.min(1, a)), clipped }
}

/** A length in px ('0.625rem', '10px', '8'), or null. */
const txLength = (v: string | undefined) => {
  const m = v && /^(-?[\d.]+)(px|rem|em)?$/.exec(v.trim())
  if (!m) return null
  const n = parseFloat(m[1]) * (m[2] === 'rem' || m[2] === 'em' ? 16 : 1)
  return Number.isFinite(n) ? n : null
}

/** Whether a colour has a visible hue (OKLCH chroma ≥ 0.04): a grey ring isn't a usable accent. */
const txChromatic = (c: string) => hexToOklch(c)[1] >= 0.04

/** Palette keys whose value derive() may nudge, and so get a `contrast` note when it does. */
const TX_NUDGED = ['primary', 'on-primary', 'accent', 'ok', 'warn', 'bad', 'fg2', 'fg3'] as const

/** One mode's variables → a Custom palette (null without a background and a text colour). */
function txPalette(vars: TxVars, mode: ThemeExportMode, shadcn: boolean, notes: ThemeImportNote[]): CustomTheme | null {
  const raw = (name: string): string | undefined => { // follow var(--x) and {x.y} references (a few levels)
    let v = vars.get(name)
    for (let i = 0; i < 6 && v; i++) {
      const ref = /^var\(\s*--([\w-]+)\s*(?:,\s*([^)]*))?\)$/.exec(v) ?? /^\{([\w.-]+)\}$/.exec(v)
      if (!ref) return v
      v = vars.get(ref[1].toLowerCase()) ?? vars.get(ref[1].toLowerCase().replace(/^colou?rs?\./, '')) ?? ref[2]?.trim()
    }
    return v
  }
  const col = (token: string, names: string[], over: string): string | undefined => {
    for (const n of names) {
      const r = raw(n), c = r ? txParseColour(r) : null
      if (!c) continue
      if (c.clipped) notes.push({ code: 'clipped', mode, token })
      if (c.a < 1) { notes.push({ code: 'blended', mode, token }); return mix(over, hex(c.c), c.a) }
      return hex(c.c)
    }
    return undefined
  }
  const bg = col('bg', shadcn ? ['background'] : ['bg', 'background'], mode === 'dark' ? '#000000' : '#FFFFFF')
  const fg = bg && col('fg', shadcn ? ['foreground'] : ['fg', 'foreground'], bg)
  if (!bg || !fg) return null
  const dark = luminance(bg) < 0.2, def = (dark ? THEMES[0].dark : THEMES[0].light)[0][1]
  const card = col('card', ['card'], bg) ?? bg
  const or = (v: string | undefined, token: keyof Palette, fallback: string, note = false) => { if (v) return v; if (note) notes.push({ code: 'missing', mode, token }); return fallback }
  const derived = (k: number) => mix(card, fg, k)
  const chroma = (token: string, names: string[]) => { for (const n of names) { const c = col(token, [n], card); if (c && txChromatic(c)) return c } return undefined }
  const v: Palette = shadcn ? {
    bg, card, fg,
    muted: or(col('muted', ['muted', 'secondary'], card), 'muted', derived(dark ? 0.07 : 0.045)),
    line: or(col('line', ['border'], card), 'line', derived(dark ? 0.14 : 0.1)),
    line2: '', fg2: or(col('fg2', ['muted-foreground'], card), 'fg2', mix(fg, card, 0.35)), fg3: '',
    primary: or(col('primary', ['primary'], card), 'primary', fg), 'on-primary': '',
    accent: or(chroma('accent', ['ring', 'sidebar-ring', 'sidebar-primary', 'primary']), 'accent', def.accent, true),
    ok: or(col('ok', ['success'], card), 'ok', def.ok, true), warn: or(col('warn', ['warning'], card), 'warn', def.warn, true),
    bad: or(col('bad', ['destructive'], card), 'bad', def.bad, true), c3: or(col('c3', ['chart-3'], card), 'c3', def.c3),
  } : {
    bg, card, fg,
    muted: or(col('muted', ['muted'], card), 'muted', derived(dark ? 0.07 : 0.045)), line: or(col('line', ['line', 'border'], card), 'line', derived(dark ? 0.14 : 0.1)),
    line2: '', fg2: or(col('fg2', ['fg2'], card), 'fg2', mix(fg, card, 0.35)), fg3: or(col('fg3', ['fg3'], card), 'fg3', ''),
    primary: or(col('primary', ['primary'], card), 'primary', fg), 'on-primary': '',
    accent: or(col('accent', ['accent'], card), 'accent', def.accent, true), ok: or(col('ok', ['ok', 'success'], card), 'ok', def.ok, true),
    warn: or(col('warn', ['warn', 'warning'], card), 'warn', def.warn, true), bad: or(col('bad', ['bad', 'destructive'], card), 'bad', def.bad, true),
    c3: or(col('c3', ['c3'], card), 'c3', def.c3),
  }
  const line2 = col('line2', shadcn ? ['input'] : ['line2', 'input'], card)
  v.line2 = line2 && line2 !== v.line ? line2 : derived(dark ? 0.24 : 0.17)
  if (!v.fg3) { const lighter = mix(v.fg2, card, 0.25); v.fg3 = contrast(lighter, card) >= 4.5 ? lighter : v.fg2 } // shadcn has one muted text colour
  const onP = col('on-primary', shadcn ? ['primary-foreground'] : ['on-primary', 'primary-foreground'], v.primary)
  v['on-primary'] = onP ?? (luminance(v.primary) > 0.45 ? mix(fg, '#000000', 0.2) : '#FFFFFF')
  const clean = themeLoad({ custom: { dark, v }, useCustom: true }).custom! // the storage rules: 15 keys, each #RRGGBB
  const d = derive(clean.v, dark)
  for (const k of TX_NUDGED) if (d[k] !== clean.v[k]) notes.push({ code: 'contrast', mode, token: k, from: clean.v[k], to: d[k] })
  return clean
}

/**
 * Read a theme back into Custom palettes, best effort: a shadcn/ui `:root { … } .dark { … }` block (oklch, hsl, the
 * old bare `H S% L%`, rgb or hex values), this library's CSS or Tailwind export, or DTCG / Tokens Studio JSON. Both
 * modes come back when the input has them (`light`, `dark`), with `radius` and `font` when it sets them. Colours are
 * flattened to '#RRGGBB' (translucent ones onto the background) and checked like saved settings; derive()'s contrast
 * nudges still apply when the palette is used, and each one is listed in `notes`. Nothing in the text is ever
 * evaluated or injected: only colours, one length and a font name from the offered list come out.
 */
export function themeImport(text: string): ThemeImportResult {
  if (typeof text !== 'string' || !text.trim()) return { ok: false, error: 'empty' }
  if (text.length > THEME_IMPORT_MAX) return { ok: false, error: 'too-large' }
  const src = text.trim()
  let vars: { light: TxVars; dark: TxVars }, format: ThemeImportFormat
  if (src.startsWith('{')) {
    let doc: unknown
    try { doc = JSON.parse(src) } catch { return { ok: false, error: 'invalid-json' } }
    const j = txJsonVars(doc)
    vars = j; format = j.studio ? 'tokens-studio' : 'dtcg'
  } else {
    const c = txCssVars(src), strip = (m: TxVars) => new Map([...m].map(([k, v]) => [k.startsWith('color-') ? k.slice(6) : k, v]))
    vars = { light: strip(c.light), dark: strip(c.dark) }
    format = c.tailwind ? 'tailwind' : vars.light.has('background') || vars.dark.has('background') ? 'shadcn' : 'css'
  }
  const notes: ThemeImportNote[] = []
  const shadcn = (m: TxVars) => m.has('background') && !m.has('bg')
  const darkVars = vars.dark.size ? new Map([...vars.light, ...vars.dark]) : null // .dark overrides :root, as in the cascade
  const light = vars.light.size ? txPalette(vars.light, 'light', shadcn(vars.light), notes) : null
  const dark = darkVars ? txPalette(darkVars, 'dark', shadcn(darkVars), notes) : null
  if (!light && !dark) return { ok: false, error: 'unrecognised' }
  const all = darkVars ?? vars.light, get = (...names: string[]) => names.map(n => all.get(n) ?? vars.light.get(n)).find(Boolean)
  const shadcnR = txLength(get('radius')), libR = txLength(get('r-md', 'radius-md', 'radius.md'))
  const radius = libR ?? (shadcnR === null ? null : shadcnR - 2)
  const family = txFamilies(get('font', 'font-sans', 'font.sans') ?? '')[0]
  let font: string | null = null
  if (family) {
    const known = FONTS.find(f => f[0].toLowerCase() === family.toLowerCase())
    if (known) font = known[0]
    else notes.push({ code: 'font', mode: light ? 'light' : 'dark', token: 'font', from: /^[A-Za-z0-9 -]{1,40}$/.test(family) ? family : undefined })
  }
  return { ok: true, format, light, dark, radius: radius === null ? null : themeLoad({ radius: Math.round(radius * 4) / 4 }).radius, font, notes }
}

/**
 * The settings an import applies: its palette for `prefer` (or the one mode it has) as the Custom theme, its radius
 * and font, over `current`. Validated by themeLoad; null for a failed import.
 */
export function themeImportSettings(result: ThemeImportResult, current: ThemeSettings = DEFAULT_THEME, prefer: ThemeExportMode = 'light'): ThemeSettings | null {
  if (!result.ok) return null
  const pick = result[prefer] ?? result.light ?? result.dark
  if (!pick) return null
  return themeLoad({ ...current, custom: pick, useCustom: true, radius: result.radius ?? current.radius, font: result.font ?? current.font }, current)
}
