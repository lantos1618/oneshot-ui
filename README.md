# @lyndon/ui

Animated React components with themes, in the shadcn style. Buttons, inputs and forms, overlays, navigation,
toasts, data tables and a data grid, a rich-text editor, a scheduler, code blocks, media players, charts,
diagrams and maps, collaboration widgets and AI chat patterns, all themed by CSS variables and animated with
[Motion](https://motion.dev).

- **Themes**: seven palette families (Default, Atom One, Ayu, Gruvbox, Solarized, Nord, Tokyo Night) in light
  and dark, user-made custom palettes, corner radius and font, with a "reveal" transition between themes.
- **No runtime CSS-in-JS**: components are Tailwind class strings plus a small token stylesheet.
- **SSR-ready**: every component module is marked `"use client"`, the theme renders deterministically on the server, and
  `ThemeScript` applies the saved theme before the first paint.
- **Drop-in files for AI tools and copy-paste**: every component is also one self-contained `.tsx` file with exactly
  the helpers it needs (`npx @lyndon/ui add data-grid`, or `npx shadcn add …/r/data-grid.json`), sized in tokens in
  [`llms.txt`](./llms.txt) (see [Drop-in files, registry and CLI](#drop-in-files-registry-and-cli)). Docs with props
  tables: [docs site](#docs-site).

## Install

```sh
pnpm add @lyndon/ui motion
# or: npm i @lyndon/ui motion
```

Requirements:

- **React 19** (`react` and `react-dom` `^19.0.0`). Components take `ref` as a normal prop, which React 18 does
  not support.
- **motion** `^13` or `^14` (peer dependency; v12 and older render some SVG animations incorrectly).
- **Tailwind CSS v4** (recommended), Tailwind v3.4, or no Tailwind at all with the precompiled stylesheet.

## Styles

The components are written with Tailwind utility classes. Pick one of these setups.

### Tailwind v4

Tell Tailwind to scan the package, in the CSS file that imports Tailwind:

```css
@import "tailwindcss";
@source "../node_modules/@lyndon/ui/dist";
```

The path is relative to that CSS file; adjust it so it reaches `node_modules`.

### Tailwind v3

Add the package to `content` in `tailwind.config.js`:

```js
export default {
  content: ['./src/**/*.{js,ts,jsx,tsx}', './node_modules/@lyndon/ui/dist/**/*.js'],
}
```

Arbitrary values and variants such as `[@media(pointer:coarse)]:min-h-10` work from v3.2. A few classes are
v4-only (container queries `@container`, the `not-first:` variant); with v3, add the
`@tailwindcss/container-queries` plugin or also import `@lyndon/ui/styles.css`.

### No Tailwind

Import the precompiled stylesheet once, for example in your root layout or entry file:

```ts
import '@lyndon/ui/preflight.css' // optional: Tailwind's reset (Preflight); skip it if you have your own
import '@lyndon/ui/styles.css'    // theme variables + every utility the components use, no reset
```

`styles.css` contains only Tailwind's theme layer and the utilities used by the library itself, so it does not
reset or restyle your page. `preflight.css` is the optional reset.

## UIProvider

Wrap your app once:

```tsx
import { UIProvider, Button } from '@lyndon/ui'

export function App() {
  return (
    <UIProvider>
      <Button variant="primary">Save</Button>
    </UIProvider>
  )
}
```

What it does:

- Injects a `<style>` with the design tokens (CSS variables such as `--bg`, `--card`, `--fg`, `--accent`,
  `--r-md`), the `.ui-root` text styles, focus rings and touch rules. Nothing in it styles `body`; with the
  default `target="html"` it also sets the page background on `html`.
- Makes no requests outside your origin. With `fonts` it also imports Geist and Geist Mono (and the appearance
  panel's font choices) from Google Fonts; without it, `--font` falls back to the system stack
  (`ui-sans-serif, system-ui, …`). If you want Geist without Google, self-host it and keep `fonts` off.
- Applies the current theme (CSS variables and `data-theme="light|dark"` on `<html>`), follows the OS in
  "system" mode, and remembers the user's choice in `localStorage`.
- Hosts toasts (`useToast()`) and turns animations off for users who prefer reduced motion
  (`MotionConfig reducedMotion="user"`).
- Renders a `<div class="ui-root">` around your app. Overlays (dialogs, sheets, popovers) portal into it.

| Prop | Default | |
| --- | --- | --- |
| `defaultTheme` | `{ theme: 'default', mode: 'system', radius: 8, font: 'Geist' }` | Starting settings before the user picks anything, and what Reset returns to. |
| `storageKey` | `'ui-theme:v1'` | `localStorage` key for the saved appearance. A value saved under the old `'ui-theme'` key is migrated once. |
| `persist` | `true` | Save and restore the user's theme. `false` always starts from `defaultTheme`. |
| `fonts` | `false` | `true` loads Geist (and the appearance panel's fonts) from Google Fonts: requests go to `fonts.googleapis.com` and `fonts.gstatic.com`. |
| `target` | `'html'` | `'self'` puts the theme variables on the `.ui-root` wrapper instead of `<html>` and leaves the host page alone (useful for embedding in an existing app). |
| `nonce` | | CSP nonce for the `<style>` elements UIProvider renders (and motion's layout styles). See [Content Security Policy](#content-security-policy). |
| `injectStyles` | `true` | `false` renders no `<style>`: link `@lyndon/ui/tokens.css` instead (for a CSP without nonces). |
| `themeFromUrl` | `false` | Apply a theme share link (`#theme=…` or `?theme=…`) on load, validated like saved settings, then remove it from the address bar. See [Exporting and sharing themes](#exporting-and-sharing-themes). |
| `className` | | Classes for the `.ui-root` wrapper. |

Changed: `fonts` used to default to `true`. Pass `<UIProvider fonts>` to keep loading Geist from Google
Fonts.

## Theming

```tsx
import { useTheme, THEMES } from '@lyndon/ui'

function ThemePicker() {
  const { settings, set, toggle, dark, label, tokens } = useTheme()
  return (
    <>
      <p>Showing {label}</p>                                {/* "Nord Dark" */}
      <button onClick={e => toggle(e.currentTarget)}>{dark ? 'Light' : 'Dark'}</button>
      {THEMES.map(t => (
        <button key={t.id} onClick={e => set({ theme: t.id }, e.currentTarget)}>{t.name}</button>
      ))}
      <button onClick={() => set({ radius: 12, font: 'Inter' })}>Rounder</button>
    </>
  )
}
```

- `set(patch, from?)` changes settings (`theme`, `mode: 'light' | 'dark' | 'system'`, `radius`, `font`,
  `variant`, `custom`, `useCustom`). Colour changes play a circular reveal from `from` (an element or a point).
- Ready-made UI: `<ThemeToggle />` (light/dark button), `<AppearanceMenu />` (gear button with the full panel)
  and `<AppearancePanel />` (the panel without the popover).
- **Tokens**: every colour is a CSS variable. Use them in your own code as `bg-[var(--card)]`,
  `text-[var(--fg2)]`, `border-[var(--line)]`, `var(--accent)`, `var(--ok|warn|bad)` and their `-soft` tints,
  `var(--c1..c4)` for chart series, `rounded-[var(--r-md)]`. Force a scheme on any element with
  `data-theme="light|dark"` on `<html>`.
- **Custom palettes**: a palette is 15 base colours (`Palette`); `derive(palette, dark)` fills in tints,
  chart colours and shadows and nudges secondary text to 4.5:1 contrast. `themeTokens(settings, dark)` gives
  every variable for a set of settings, `themeCSS(tokens, label)` turns them into a `:root { … }` block you can
  paste into a stylesheet, and `themeStyle(tokens, dark)` into an inline `style` for one subtree. Users can make
  their own palette in the Customise grid of the appearance panel. To take a theme elsewhere (Tailwind v4, shadcn/ui,
  DTCG, Figma), bring a shadcn theme in, or share one as a link, see
  [Exporting and sharing themes](#exporting-and-sharing-themes).
- **Saved settings are validated.** `localStorage` is shared by everything on your origin, so the saved appearance
  is treated as untrusted input: `themeLoad` keeps a field only if it is something the library writes (a known theme
  id and font, `light|dark|system`, an in-range integer variant, a finite radius clamped to 0–32, a custom palette of
  the 15 base keys with `#RRGGBB` values) and falls back to the default for anything else; a value that isn't a JSON
  object is removed. Changes from other tabs go through the same check. `themePalette`, `themeTokens`, `rgb` and
  `mix` never throw on bad input, and `themeCSS`/`themeStyle` drop values that could break out of a declaration or
  load a resource.
- `useTheme().ready` is `false` on the server and during hydration (settings are the defaults then) and `true`
  once the saved settings and the OS scheme have been read, before the first paint.

### Avoiding a flash of the wrong theme (ThemeScript)

On a server-rendered page the HTML arrives before React, so the saved theme can only be applied once
JavaScript runs. `ThemeScript` is a tiny blocking inline script for `<head>` that reads the saved settings
and applies `data-theme`, `color-scheme` and every CSS variable to `<html>` before the first paint. Give it the
same `storageKey`, `defaultTheme` and `persist` as `UIProvider`, and add `suppressHydrationWarning` to
`<html>` because the script changes its attributes before React hydrates. It needs `target="html"` (the
default). For a strict CSP, pass `nonce`, or hash the string from `themeScriptSource()`. The script applies the
saved CSS variables only when every name is a theme token and every value matches what `themeTokens` produces (hex,
`rgba()`, numbers and px, the two shadows, the font stack); otherwise it applies the defaults.

### Exporting and sharing themes

The appearance panel has an **Export and share** section (also on its own as `<ThemeExportPanel />`, e.g. for a
theme-builder page next to `<AppearancePanel />`): format tabs with the code, Copy code, Download, Copy share link and
Import. The same exporters are pure functions in `@lyndon/ui/themeexport` (and `@lyndon/ui/utils`, so they run on the
server and in build scripts). Each takes settings (resolved with `themeTokens`, exactly what UIProvider applies) or a
`{ label, modes: { light, dark } }` token source, and writes both modes. A Custom theme is one palette, so it exports
one mode.

```ts
import { themeToCSS, themeToTailwind, themeToShadcn, themeToDTCG, themeToTokensStudio, themeImport, themeImportSettings } from '@lyndon/ui/themeexport'

const settings = { ...DEFAULT_THEME, theme: 'nord', radius: 10 } // or useTheme().settings
writeFileSync('theme.css', themeToTailwind(settings))
```

| Function | Output |
| --- | --- |
| `themeToCSS(s)` | The library's own variables (`--bg`, `--card`, `--accent`, `--r-md`, `--font` …): light in `:root`, dark under `@media (prefers-color-scheme: dark)` (unless `data-theme="light"`) and `:root[data-theme="dark"]`, like UIProvider's style sheet. For `<UIProvider injectStyles={false}>` or pages without React. |
| `themeToTailwind(s, { dark?, inline? })` | A Tailwind CSS v4 `@theme` block: `--color-*` for every colour token, `--radius-sm/md/lg`, `--font-sans`, `--font-mono`, `--shadow-card`. |
| `themeToShadcn(s, { themeInline? })` | shadcn/ui variables as `oklch()`: `:root` (with `--radius`) and `.dark`. |
| `themeToDTCG(s, { modes? })` | W3C Design Tokens (DTCG 2025.10) JSON; `themeToDTCGTokens` returns the object. |
| `themeToTokensStudio(s)` | Tokens Studio for Figma JSON (the panel's **Figma** tab). |
| `themeExport(format, s)` | One of the above by id (`THEME_EXPORT_FORMATS` lists them with file names). |

**Tailwind v4.** Paste the block after `@import "tailwindcss";`. Utilities then follow the theme: `bg-card`,
`text-fg2`, `border-line`, `bg-accent-soft`, `text-bad`, `rounded-md`, `font-sans`, `shadow-card`.

```css
@import "tailwindcss";
@custom-variant dark (&:where([data-theme=dark], [data-theme=dark] *));

@theme {
  --color-bg: #E5E9F0;
  --color-card: #ECEFF4;
  --color-accent: #496485; /* Nord's #5E81AC, nudged by derive() to 4.5:1 on its cards */
  /* … every colour token … */
  --radius-md: 10px;
  --font-sans: "Geist",ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif;
  --shadow-card: 0 1px 2px rgba(0,0,0,.04),0 10px 30px rgba(0,0,0,.08);
}

@layer theme {
  :root, :host {
    @variant dark {
      --color-bg: #2E3440;
      /* … the dark values that differ … */
    }
  }
}
```

The dark values sit under `@variant dark`, so they follow whatever `dark:` means in your project. `dark` picks it:
`'data-theme'` (default) adds the `@custom-variant` above (UIProvider sets `data-theme` on `<html>`), `'class'` uses
a `.dark` class (next-themes, shadcn), `'media'` leaves Tailwind's default (the OS setting). If the app also renders
UIProvider, prefer `themeToTailwind(s, { inline: true })`: `@theme inline { --color-card: var(--card); … }` maps the
utilities onto the variables UIProvider already switches per mode and per user choice, with no values copied.

**shadcn/ui.** Replace the `:root` and `.dark` blocks in your `globals.css` (Tailwind v4 shadcn projects already have
the `@theme inline` mapping; pass `{ themeInline: true }` to include it):

```css
:root {
  --radius: 0.625rem;
  --background: oklch(0.985 0 0);
  --foreground: oklch(0.141 0.004 285.823);
  --primary: oklch(0.21 0.006 285.885);
  --primary-foreground: oklch(0.985 0 0);
  --destructive: oklch(0.577 0.215 27.325);
  --ring: oklch(0.546 0.215 262.881);
  /* … card, popover, secondary, muted, accent, border, input, chart-1…5, sidebar-*, success, warning */
}
.dark {
  --background: oklch(0.141 0.004 285.823);
  /* … */
}
```

Mapping: background ← `bg`; card and popover ← `card`; secondary, muted and accent ← `muted` (shadcn's accent is a
hover surface, not a brand colour); muted-foreground ← `fg2`; destructive ← `bad`; border ← `line`; input ← `line2`;
ring ← `accent`; chart-1…5 ← `c1`, `c2`, `c3`, `c4`, `c-neutral`; sidebar-* likewise; plus `--success` (`ok`) and
`--warning` (`warn`), which shadcn doesn't define. `--radius` is the theme radius + 2px, because shadcn's buttons use
`radius - 2px` and the library's use the radius itself (8px → `0.625rem`, shadcn's default).

**DTCG.** Groups `color` (`$type: "color"`, values `{ "colorSpace": "srgb", "components": [r, g, b], "alpha"?, "hex" }`),
`radius` (`dimension`, `{ "value": 8, "unit": "px" }`), `font` (`fontFamily` lists) and `shadow` (`card`). The format
has no modes of its own, so: `$value` is the light value and `$extensions["@lyndon/ui"].modes.dark` the dark one
(default), or `{ modes: 'sets' }` for two top-level groups, `light` and `dark`, each a full tree (one source per mode
in Style Dictionary).

```json
{
  "color": {
    "$type": "color",
    "bg": {
      "$value": { "colorSpace": "srgb", "components": [0.9804, 0.9804, 0.9804], "hex": "#fafafa" },
      "$extensions": { "@lyndon/ui": { "modes": { "dark": { "colorSpace": "srgb", "components": [0.0353, 0.0353, 0.0431], "hex": "#09090b" } } } }
    }
  },
  "radius": { "$type": "dimension", "md": { "$value": { "value": 8, "unit": "px" } } }
}
```

**Tokens Studio (Figma).** Sets `global` (radius, fonts), `light` and `dark` (colours, shadow) in the plugin's
`value`/`type` format, with `$themes` Light and Dark and `$metadata.tokenSetOrder`; paste it into the plugin's JSON
view or sync it from a repository.

**Import.** `themeImport(text)` reads a shadcn block (current `oklch()`, the older bare `222.2 84% 4.9%` HSL triplets,
`hsl()`, `rgb()` or hex), this library's CSS or Tailwind export, or DTCG / Tokens Studio JSON, and returns
`{ ok, format, light, dark, radius, font, notes }`: up to two Custom palettes, validated like saved settings.
`themeImportSettings(result, settings, 'dark')` gives the settings to apply. The panel's Import box previews the
palette, lets you pick light or dark when both are there, and applies it as the Custom theme. Best effort, and every
guess is reported in `notes` (shown in the panel):

- `missing`: no value for a colour the library needs (shadcn has no success or warning, and a grey `--ring` is not an
  accent), so the default theme's colour is used. Surfaces and lines it can derive (muted, line2, fg3) are derived silently.
- `blended`: a translucent value (shadcn's dark `--border: oklch(1 0 0 / 10%)`) is flattened onto the background.
- `clipped`: a colour outside sRGB (wide-gamut `oklch()`, e.g. shadcn's red destructive) is clipped to the nearest
  sRGB colour; the library's tokens are `#RRGGBB`.
- `contrast`: derive() still nudges imported palettes to 4.5:1 (secondary text, primary text, accent, ok, warn, bad),
  and each colour it moved is listed with its old and new value.
- `font`: a font the panel doesn't offer; your current font is kept.

Only colours (as `#RRGGBB`), one radius and a font from `FONTS` come out of an import; nothing in the text is
evaluated or written into a style sheet as is. Input over 200 kB is refused.

**Share links.** `themeShareUrl(settings)` returns the current URL with `#theme=<code>`: base64url of a few bytes
(the format version, mode, radius, font, family and variant; a Custom palette adds its 15 colours), 8 characters for
a built-in theme and 68 for a Custom one. `{ param: 'query' }` writes `?theme=` instead. `themeShareEncode` and
`themeShareDecode` work on the bare code, and `themeFromUrl(url?)` reads one from a URL. A link is input from anyone:
the code must have exactly the expected shape, version and in-range indexes, and then goes through `themeLoad`, the
same check as saved settings; anything else is ignored. Apps opt in to applying links with
`<UIProvider themeFromUrl>`: on load a valid code replaces (and is saved over) the saved appearance, and the
parameter is removed from the address bar with `history.replaceState`. With ThemeScript the saved theme shows for the
first paint and the linked one right after hydration.

**Caveats.**

- oklch conversion uses Björn Ottosson's OKLab matrices on sRGB. Exports pick the fewest decimals (3 to 6) that
  convert back to the same `#RRGGBB`, so a shadcn export imports back exactly; values typed by hand round to the
  nearest sRGB colour.
- `--band` (a translucent accent) and `--shadow` have no shadcn equivalent and are left out of that export; Tokens
  Studio and DTCG carry them.
- Tailwind writes shadow values into the `shadow-*` utilities at build time, so the dark `--shadow-card` applies to
  `shadow-(--shadow-card)` but not to `shadow-card`.
- `--mono` is not a theme setting; the exports write the default mono stack.

## Formatting

UI text is English, written where it is used. Text a person might want to change is a prop with an English default
(`<Spinner label="Saving" />`, `<CopyButton copiedLabel="Done" />`). Numbers and dates go through one fixed English
(en-GB) formatter set, `fmt`, built on cached `Intl` formatters:

```ts
import { fmt, plural, rangeStr } from '@lyndon/ui'

fmt.compact(12400)         // "12.4k"
fmt.money(1234.5, 'EUR')   // "€1,234.50"
fmt.date(new Date())       // "8 Nov 2026"
fmt.relative(Date.now() - 3 * 864e5) // "3 days ago"
plural(3, 'file')          // "3 files"
rangeStr([3, 1, 2])        // "1 to 3"
```

Weeks start on Monday. Date and time controls take `hourCycle` (12 or 24) and `timeZone` props where they matter.

## Content Security Policy

The library needs no `unsafe-eval`, no inline scripts of its own (except the optional `ThemeScript`) and, with
`fonts` off, no outside hosts. A minimal policy:

```text
default-src 'self'; script-src 'self' 'nonce-{N}'; style-src 'self' 'nonce-{N}'; style-src-attr 'unsafe-inline';
img-src 'self' data: blob:; media-src 'self' blob:; connect-src 'self'; font-src 'self';
object-src 'none'; base-uri 'none'; frame-ancestors 'none'
```

- **Nonce**: `<UIProvider nonce={N}>` puts it on the token `<style>` (and passes it to motion for its layout
  styles); `<ThemeScript nonce={N} />` on the inline script. Generate a fresh `N` per response.
- **No nonce**: `<UIProvider injectStyles={false}>` renders no `<style>` at all. Load the same CSS as a file
  instead: `import '@lyndon/ui/tokens.css'` (or link `node_modules/@lyndon/ui/dist/tokens.css`), so `style-src 'self'`
  is enough. With `fonts` on, the Google Fonts stylesheet is then added as a `<link>`.
- `style-src-attr 'unsafe-inline'` is needed because components position and animate things with `style`
  attributes (server-rendered ones included). Values the library takes from data (colours, URLs) are checked with
  `safeColor` / `cssUrl` before they reach a `style`.
- `data:` and `blob:` in `img-src`/`media-src` are only needed for the media, avatar-cropper and signature
  components (previews of local files and recordings) and for PNG chart export (`exportChart` draws the chart's SVG
  through a `blob:` image, or a `data:` one if blobs are blocked); drop them if you don't use those. The media demo's synthetic
  audio also fetches a `blob:` URL (`connect-src blob:`).
- With `fonts`: add `https://fonts.googleapis.com` to `style-src` and `https://fonts.gstatic.com` to `font-src`.
- `frame-ancestors 'none'` (or `'self'`) matters for pages with `HoldToConfirm` or approval prompts, so another
  site can't frame them and coach a user into confirming.

## Next.js (App Router)

All component modules start with `"use client"`, so you can import them from Server Components; they render
on the server and hydrate on the client.

```tsx
// app/layout.tsx (a Server Component)
import { UIProvider, ThemeScript } from '@lyndon/ui'
import './globals.css'

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <ThemeScript />
      </head>
      <body>
        <UIProvider>{children}</UIProvider>
      </body>
    </html>
  )
}
```

```css
/* app/globals.css */
@import "tailwindcss";
@source "../node_modules/@lyndon/ui/dist";
```

```tsx
// app/page.tsx (still a Server Component)
import { Button, Card } from '@lyndon/ui'

export default function Page() {
  return <Card className="p-6"><Button variant="primary">Hello</Button></Card>
}
```

Notes:

- Hooks (`useTheme`, `useToast`, …) and event handlers belong in your own `"use client"` components, as usual.
- Pure helpers (`cn`, `variants`, `mix`, `contrast`, `themeCSS`, `themeTokens`, `highlightCode`,
  `codeLineDiff`, `wordDiff`, `formatDate`, …) are also exported from `@lyndon/ui/utils`, which has no
  `"use client"` directive, so Server Components and route handlers can call them.
- A few demo-style components use random layouts or the current time; render those only on the client (for
  example `dynamic(() => …, { ssr: false })`) if you see hydration warnings.

## AI chat with real model streams

`useAiChat` (from `@lyndon/ui` or `@lyndon/ui/aistream`) turns a model stream into messages made of parts: text,
reasoning, tool calls, sources, files, custom data and errors. Its `send(messages, { signal })` returns the reply as
any of:

- an async iterable of chunks (or of plain strings, each a text delta),
- a `ReadableStream` of chunks, or of bytes in SSE (`data: {…}`) or NDJSON (one JSON chunk per line),
- a `Response` from the AI SDK's `result.toUIMessageStreamResponse()` (read without the `ai` package; see
  `fromAiSdkUIMessageStream`).

Stop aborts `signal` and keeps what arrived. A thrown error or an `error` chunk becomes an error part with Retry
(`regenerate`). State updates are batched to one render per animation frame.

| Chunk | Fields | AI SDK UI message stream event |
| --- | --- | --- |
| `start` | `messageId?` | `start` |
| `text-delta` / `text-end` | `delta`, `id?` | `text-delta` / `text-end` |
| `reasoning-delta` / `reasoning-end` | `delta`, `id?` | `reasoning-delta` / `reasoning-end` |
| `tool-start` | `id`, `name`, `args?`, `needsApproval?` | `tool-input-start` |
| `tool-args-delta` | `id`, `delta` (raw JSON text) | `tool-input-delta` |
| `tool-args` | `id`, `args`, `name?` | `tool-input-available` |
| `tool-approval` | `id`, `summary?` | `tool-approval-request` |
| `tool-result` / `tool-error` | `id`, `result` / `error` | `tool-output-available` / `tool-output-error` |
| `source` | `url`, `title?`, `snippet?` | `source-url` |
| `file` | `url`, `mediaType`, `name?` | `file` |
| `data` | `name`, `data`, `id?` | `data-<name>` |
| `finish` | | `finish`, `abort` |
| `error` | `message` | `error` (`errorText`) |

`applyAiChunk(messages, chunk)` is the pure reducer behind the hook, and `parseAiStream(stream)` the SSE/NDJSON
parser; both are exported for servers, tests and other state libraries.

The parts render with components you can use on their own (AI Elements style): `Conversation` (a log that stays
pinned to the newest message unless the reader scrolled up, then shows "Jump to latest"; past 60 messages it
renders only those in view, with `useVirtual`), `Message`,
`MessageParts`, `Reasoning`, `ToolCard`, `ApprovalCard`, `MessageActions`, `Suggestions` and `PromptInput`
(autogrowing textarea, attachments by paste, drop or pick, model picker, Send/Stop). `AssistantChat` and
`AgentComposer` also take `chat={useAiChat(…)}`. Their 0.2 scripted props (`respond`, `onSend`) still work.

**Renderers (0.4).** Out of the box a message's text renders as Markdown with code fences in a plain frame (no
highlighter), and tool arguments and results as indented JSON, so the chat drop-ins stay small. Pass richer renderers
where you want them: `renderers={AI_RICH_RENDERERS}` on `MessageParts`, `Message`, `AssistantChat` or `AgentComposer`
(fences highlighted by CodeBlock, and a JsonViewer tree), or once for a subtree with
`<AiRenderersProvider renderers={AI_RICH_RENDERERS}>`. Mix your own: `{ text: aiMarkdownText(markdownCodeBlock), value: v => … }`.
`Markdown` likewise shows fences in a plain frame unless you pass `renderCode={markdownCodeBlock}`.

A Next.js route handler that streams from the Anthropic API as NDJSON chunks (the key stays in the server
environment, `ANTHROPIC_API_KEY`; validate the request body in real code):

```ts
// app/api/chat/route.ts
import Anthropic from '@anthropic-ai/sdk'

const client = new Anthropic()

export async function POST(req: Request) {
  const { messages } = await req.json() // [{ role: 'user' | 'assistant', content: string }]
  const stream = client.messages.stream({
    model: process.env.ANTHROPIC_MODEL!, // a current Claude model ID
    max_tokens: 64000,
    thinking: { type: 'adaptive', display: 'summarized' }, // streams readable reasoning
    messages,
  }, { signal: req.signal })
  const enc = new TextEncoder()
  const body = new ReadableStream<Uint8Array>({
    async start(ctl) {
      const send = (chunk: object) => ctl.enqueue(enc.encode(JSON.stringify(chunk) + '\n'))
      try {
        for await (const e of stream) {
          if (e.type !== 'content_block_delta') continue
          if (e.delta.type === 'text_delta') send({ type: 'text-delta', delta: e.delta.text })
          else if (e.delta.type === 'thinking_delta') send({ type: 'reasoning-delta', delta: e.delta.thinking })
        }
        const final = await stream.finalMessage()
        send(final.stop_reason === 'refusal' ? { type: 'error', message: 'The model declined this request.' } : { type: 'finish' })
      } catch {
        send({ type: 'error', message: 'The model request failed.' }) // don't forward provider error details
      }
      ctl.close()
    },
    cancel() { stream.abort() }, // Stop in the browser closes the request
  })
  return new Response(body, { headers: { 'content-type': 'application/x-ndjson', 'cache-control': 'no-store' } })
}
```

```tsx
// app/chat.tsx
'use client'
import { AI_RICH_RENDERERS, AssistantChat, aiMessageText, useAiChat } from '@lyndon/ui'

export function Chat() {
  const chat = useAiChat({
    send: async (messages, { signal }) => {
      const res = await fetch('/api/chat', {
        method: 'POST', signal, headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ messages: messages.filter(m => m.role !== 'system').map(m => ({ role: m.role, content: aiMessageText(m) })).filter(m => m.content) }),
      })
      if (!res.ok || !res.body) throw new Error(`Chat failed (${res.status})`)
      return res.body // NDJSON bytes: useAiChat parses them
    },
  })
  return <AssistantChat chat={chat} renderers={AI_RICH_RENDERERS} starters={['Summarise this week']} />
}
```

With the AI SDK on the server instead, return `result.toUIMessageStreamResponse()` from the route and
`return fetch(…).then(fromAiSdkUIMessageStream)` from `send`.

Tool calls that need approval arrive as `tool-start` with `needsApproval` (or a `tool-approval` chunk). The tool card
shows an approval prompt and nothing runs until the person decides: `useAiChat({ onApprovalRequest: async (tool,
approved) => approved ? runTool(tool.name, tool.args) : undefined })` runs it in the browser and its return value
becomes the result; without that handler the decision is recorded on the part (`approval.approved`) for your
server. Either way `send` is then called again (`continueAfterApproval`) so the model can carry on.

## Live agent runs

The agent visuals (`TraceWaterfall`, `AgentTransitMap`, `LaneGraph`) can draw a real run, recorded or live, from the
tracing or SDK you already use. Everything goes through one model, from `@lyndon/ui/agentrun` (headless: React only):

```ts
type AgentRun   = { id, name, startedAt, endedAt?, status, spans: AgentSpan[], events: AgentEvent[] }   // epoch ms
type AgentSpan  = { id, parentId?, kind: 'agent' | 'llm' | 'tool' | 'retrieval' | 'chain' | 'human', name, model?,
                    startMs, endMs?, status: 'running' | 'ok' | 'error' | 'cancelled',
                    tokens?: { input, output, cached? }, costUsd?, error?, attributes }
type AgentEvent = { id, kind: 'approval' | 'handoff' | 'error' | 'retry' | 'note', atMs, label, spanId?, detail? }
```

A run streams as updates (`run-start`, `span-start`, `span-update`, `span-end`, `event`, `run-end`, `snapshot`) that
the pure reducer `applyRunEvent(run, update)` folds; a span that fails adds an error event, an agent that starts after
another adds a handoff. `useAgentRun(source)` keeps a run as React state, rendering at most once per animation frame:
the source is an `AgentRun`, an async iterable or `ReadableStream` of updates (bytes are parsed as SSE or NDJSON), a
`Response`, a function `(signal) => one of those`, or `{ fetchRun, intervalMs }` to poll. `mapper` turns your source's
own items into updates. Memoise the source: a new one starts over.

```tsx
const source = useMemo(() => (signal: AbortSignal) => fetch(`/api/runs/${id}/events`, { signal }), [id])
const { run, status } = useAgentRun(source)          // 'connecting' → 'live' → 'done'
if (!run) return null
<TraceWaterfall run={run} />                          // spans → rows, events → flags; grows while running
<AgentTransitMap run={run} stations={{ issue_refund: ['payments', 'Pay agent'], chain: null }} />
<LaneGraph nodes={runLaneNodes(run)} order="input" direction="up" renderRow={row => row.node.span.name} />
```

Without `run`, `AgentTransitMap` keeps its built-in simulation and `TraceWaterfall` its `spans` + `total`. Helpers:
`runTotals(run)` (duration, tokens, cost, calls, errors), `agentSpanCost(model, tokens, prices)`, `runToEvents(run)`
and `replayRun(run, { speed })` (plays a recorded run back as a live stream, rebased to now).

**OpenTelemetry GenAI.** `fromOtel(otlpJson, { pricing })` reads an OTLP/JSON trace export (a collector's file exporter,
or what your `/v1/traces` receiver gets) by the GenAI semantic conventions: `gen_ai.operation.name` (chat,
text_completion, generate_content, embeddings → llm; execute_tool → tool; invoke_agent → agent), `gen_ai.request.model`
/ `response.model`, `gen_ai.usage.input_tokens` / `output_tokens` (and cache reads), `gen_ai.tool.name`,
`gen_ai.agent.name`, span status and `exception` events. The AI SDK's telemetry spans, OpenInference and OpenLLMetry
attributes map too; HTTP and database spans under a tool are dropped (`include: 'all'` keeps them).

```ts
// a collector writes traces as OTLP/JSON; poll the latest export of one trace until it ends
const poll = useMemo(() => ({
  intervalMs: 1000,
  fetchRun: async (signal: AbortSignal) => {
    const res = await fetch(`/api/traces/${traceId}`, { signal })          // { resourceSpans: [...] }
    return fromOtel(await res.json(), { traceId, pricing: PRICES })
  },
}), [traceId])
const { run } = useAgentRun(poll)
```

**Vercel AI SDK.** `fromAiSdkResult(result, { pricing, stepEnds? })` reads a `generateText` / `streamText` result: a
model span per step (model, usage incl. cached input) and a span per tool call (input, output, `tool-error`). The SDK
records no tool timings, so they are inferred unless you pass `stepEnds`; with `experimental_telemetry` on, read its spans
with `fromOtel` instead. Live, `aiSdkRunMapper()` maps the UI message stream (the same parts `useAiChat` reads):

```ts
// server: forward each step's usage with the stream
return result.toUIMessageStreamResponse({
  messageMetadata: ({ part }) => part.type === 'finish-step' ? { usage: part.usage, model: part.response.modelId } : undefined,
})
// client: one request, one live run
const source = useMemo(() => (signal: AbortSignal) =>
  fetch('/api/agent', { method: 'POST', body: JSON.stringify({ prompt }), signal }), [prompt])
const { run } = useAgentRun(source, { mapper: () => aiSdkRunMapper({ name: 'Research', pricing: PRICES }) })
// or after the fact: fromAiSdkResult(await generateText({ … }), { stepEnds })
```

**LangGraph.** `langGraphRunMapper()` maps `astream_events(version="v2")` events: the root graph is the run, graph
nodes are chains (or agents: `agentNodes`, and subgraphs on their own), `on_chat_model_*` are model calls (usage from
`usage_metadata`), `on_tool_*` tools, `on_retriever_*` retrievals; internal runnables are skipped. A tool whose
exception ToolNode turned into an error ToolMessage is closed with that error; custom events named `*approval*` become
a human span. LangChain's events carry no times, so stamp them on the server:

```python
# FastAPI: relay the events as SSE, each with a timestamp
@app.get("/runs/{thread_id}/events")
async def events(thread_id: str):
    async def gen():
        async for ev in graph.astream_events(inputs, {"configurable": {"thread_id": thread_id}}, version="v2"):
            yield f"data: {json.dumps({**ev, 'timestamp': time.time()}, default=str)}\n\n"
    return StreamingResponse(gen(), media_type="text/event-stream")
```

```ts
const source = useMemo(() => (signal: AbortSignal) => fetch(`/runs/${threadId}/events`, { signal }), [threadId])
const { run } = useAgentRun(source, { mapper: () => langGraphRunMapper({ agentNodes: ['planner', 'writer'], pricing: PRICES }) })
// recorded: fromLangGraphEvents(events, { agentNodes })
```

`PRICES` is yours (`{ 'gpt-4.1': { input: 2, output: 8, cachedInput: 0.5 } }`, USD per million tokens; a key also
matches dated model ids). The showcase's "Live agent run" card plays recorded runs from all three sources
(`AGENT_RUN_FIXTURES` in `@lyndon/ui/examples`).

## Subpath imports

`@lyndon/ui` is the all-in-one entry. Each area is also its own entry point (one ES module per area, with
types), which keeps dev servers and type-checking fast and makes the import show what you use:

```ts
import { Button, Card, Badge } from '@lyndon/ui/core'
import { Chart, DonutChart } from '@lyndon/ui/charts'
import { WorldMap } from '@lyndon/ui/geo'
import { cn, mix } from '@lyndon/ui/utils'
```

Entries: `core` (re-exports `helpers`, `theme`, `locale`, `hooks`, `icons`, `primitives`, `slot`, `safe`,
`formcontrol` and `shared`, each also an entry), `motion`, `virtual`, `overlay`, `forms` (re-exports `fields`, `inputs`, `select`, `pickers` and `upload`, each also an entry), `navigation`, `feedback`, `data`, `datagrid`, `layout`,
`editor`, `scheduler`, `code`, `markdown`, `media`, `collab`, `pages`, `binary`, `charts`, `diagrams` (re-exports `gantt`,
`statechart`, `trace` and `network`, each also an entry), `geo` (its map data, `geoworld` and `geoland`, loads lazily),
`aistream`, `agentrun`, `ai`, `aichat`, `aiagent`, `appearance`, `themeexport` (theme exporters, import and share codes), `provider`, `utils`, plus `styles.css`, `preflight.css` and
`tokens.css` (the token CSS UIProvider injects, for `injectStyles={false}`). Sample data and demo helpers (the
showcase's documents, workflows, generated media, MotionPlayground) are in `@lyndon/ui/examples`, outside the stable API.
Tree-shaking works with either style: a bundler only keeps the components you import.

## Drop-in files, registry and CLI

Every component is also published as one **self-contained `.tsx` file**: the component (or a small family, such as
`dialog` with `DialogRoot`/`DialogContent`/…, or `dropdown-menu` with the menu items) plus exactly the library
helpers it uses, importing only `react`, `react-dom` and `motion`. A build script walks the dependency graph of the
library's top-level declarations with the TypeScript compiler and keeps the transitive closure, so `button.tsx` is
about 20 KB (~6k tokens) instead of the ~700 KB `ui.tsx`. There are about 200 of them; the median is ~8k tokens.

| Item | Size | ≈ tokens | | Item | Size | ≈ tokens |
| --- | ---: | ---: | --- | --- | ---: | ---: |
| `button` | 20 KB | 5.8k | | `chart` | 47 KB | 13k |
| `tabs` | 30 KB | 8.7k | | `select` | 68 KB | 19k |
| `dialog` | 38 KB | 11k | | `data-grid` | 199 KB | 57k |
| `ui-provider` | 91 KB | 26k | | `assistant-chat` | 225 KB | 64k |

`npx @lyndon/ui list` prints all of them with their sizes; `dist-registry/index.json` in the package (also
`@lyndon/ui/registry.json`) lists name, description, exports, the components each file embeds, npm dependencies,
bytes and approximate tokens (bytes ÷ 3.6).

### CLI

The package has a small CLI that copies drop-ins out of the installed package (no network, no dependencies, Node 20+):

```sh
npx @lyndon/ui add button dialog data-grid             # → src/components/ui/{button,dialog,data-grid,ui-provider}.tsx
npx @lyndon/ui add select --dir app/ui --dry-run        # show what would be written
npx @lyndon/ui add pricing-table                        # a block (see below)
npx @lyndon/ui list                                     # every item with size and tokens
npx @lyndon/ui info data-grid                           # exports, embedded components, dependencies
```

`add` also adds what an item requires (`ui-provider`, unless `--no-deps`), skips files that exist (exit code 2;
`--overwrite` replaces them), never writes outside `--dir` and refuses names that aren't registry names (no paths).
It prints the npm packages your `package.json` is missing (usually `motion`).

Wrap the app once in `<UIProvider>` from `ui-provider.tsx`. The files share it: React contexts (theme, forms)
and module state (toast queue, scroll lock, modal stack and `inert` list, focus-trap stack, icon registry) live on
`globalThis` under a versioned key (`@lyndon/ui@<minor>:<name>`, from `UI_VERSION`), so a provider or modal from one file works with
components from another, exactly as with the npm package.

`ui-provider` holds only the theme engine, `ThemeScript` and the host
outlet. Optional items: `toast` (toasts; `useToast()` without a `ToastProvider` uses one page-wide queue), `icon`
(the full icon set: each drop-in embeds only the icons it draws, and items that take icon names from props list
`suggests: ['icon']` in `index.json`). Embedded library helpers
keep a one-sentence summary of their docs; each item's own exports keep their full JSDoc.

### Blocks

Page sections that you are meant to edit (`pricing-table`, `checkout`, `onboarding-checklist`, `profile-card`,
`cookie-consent`) are `registry:block` items, not part of the npm API. `npx @lyndon/ui add pricing-table` writes the
block importing from `'@lyndon/ui'` when your `package.json` depends on it (a few KB), or a self-contained file
otherwise; `--package` / `--standalone` choose explicitly.

### shadcn CLI

The same items are a [shadcn registry](https://ui.shadcn.com/docs/registry): `dist-registry/r/<name>.json`
(`registry-item` schema: `name`, `type`, `files[].content`, `dependencies`, `registryDependencies`, `docs`, `meta`)
plus `r/registry.json`. Each UI item lists `ui-provider` in `registryDependencies`, so it comes along:

```sh
npx shadcn add https://lantos1618.github.io/oneshot-ui/r/data-grid.json
```

`r/tokens.json` carries the token CSS (`@lyndon/ui/tokens.css`) as a `css` block, for `<UIProvider injectStyles={false}>`
under a strict CSP. Its variables include `--card`, `--primary`, `--muted` and `--accent` at `:root`, which a shadcn
theme also defines; in a shadcn project prefer `<UIProvider target="self">`, which scopes the tokens to its wrapper.

**Hosting.** `.github/workflows/pages.yml` builds the registry with the Pages URL baked into `registryDependencies`
and deploys it with the docs to GitHub Pages (`/r/*.json`, `/files/*.tsx`, `/index.json`, `/llms.txt`). To host it
elsewhere, run `REGISTRY_BASE_URL=https://example.com/ui pnpm build:registry` and serve `dist-registry/` at that URL.
After a release the files are also on any npm CDN, e.g.
`https://unpkg.com/@lyndon/ui@<version>/dist-registry/files/button.tsx` (the `r/` JSON is not in the npm package).

### For AI tools

Attach the drop-ins the task needs plus `ui-provider.tsx` rather than a whole-library file. [`llms.txt`](./llms.txt)
is an index for AI tools (what the library is, install, theming, the CLI and registry, and every item with a one-line
description, its size in tokens and a link to its file); [`llms-full.txt`](./llms-full.txt) adds each item's exports
and embedded components. Both are generated by `pnpm build:registry`. A prompt that works well:

```text
Build the UI with the attached files (React 19 + Tailwind + motion): ui-provider.tsx, button.tsx, dialog.tsx, …
Import each component from its file. Wrap the app in <UIProvider>. Use only what the files export and the colour
tokens (bg-[var(--card)], text-[var(--fg2)], border-[var(--line)], var(--accent)) instead of raw colours, so
light/dark and every theme keep working. Override a component's own classes with Tailwind's ! prefix (className="!h-8").
```

### Whole library in one file

For tools with a large context only, the package also has the kit as a few big files in
`node_modules/@lyndon/ui/dist-single/` (not importable through `exports`; copy them). They are too large for most
chats (`ui-all.tsx` is about 1.7 MB, ~490k tokens); prefer the drop-ins above.

| File | Contents | Needs |
| --- | --- | --- |
| `ui.tsx` | Theme and provider, primitives, inputs and forms, overlays, navigation, feedback, data display, layout | |
| `ui-content.tsx` | Editor, data grid, scheduler, code, media, collaboration, pages | `ui.tsx` |
| `ui-charts.tsx` | Chart kit, diagrams, maps | `ui.tsx` |
| `ui-ai.tsx` | AI message model and streams (`useAiChat`), chat parts, composer, agents | `ui.tsx`, `ui-content.tsx` |
| `ui-all.tsx` | Everything in one file | |

**Integrity.** Every drop-in starts with `'use client'` and one short line naming the package version, the item and
the git commit it was built from (`/* @lyndon/ui 0.9.0 · button · ac0fa81 */`); the whole-library files also carry the
sha256 of the rest of the file in theirs. `dist-single/SHA256SUMS` lists the sha256 of each whole-library file
(`cd node_modules/@lyndon/ui/dist-single && sha256sum -c SHA256SUMS`), and `dist-registry/SHA256SUMS` and
`dist-registry/index.json` the sha256 of each drop-in (`cd node_modules/@lyndon/ui/dist-registry && sha256sum -c SHA256SUMS`). A copied file doesn't update itself: re-copy it whenever a
release fixes a security issue (see [SECURITY.md](./SECURITY.md)).

## Docs site

`docs/` is a Vite + React app built with the library itself: one page per registry item with its description, the
showcase cards that use it (mounted live), props tables generated from the TypeScript types at build time (name, type,
default from the destructuring, JSDoc), the drop-in's size and install commands for npm, the CLI and shadcn. It has
search (⌘K), the theme toggle and a phone layout. `pnpm docs:dev` runs it; `pnpm docs:build` (after `pnpm build`)
writes `docs-dist/` with the docs, the showcase under `showcase/`, the registry and `llms.txt`, and
`.github/workflows/pages.yml` deploys that to GitHub Pages.

## Toasts

`toast()` shows a toast and returns its id; the same function hangs off `useToast()` (the nearest `ToastProvider`'s
queue) and is exported as a standalone `toast` that needs no hook (the page-wide queue; its region mounts itself in
`UIProvider` on the first toast). Existing `const toast = useToast(); toast({ title })` calls keep working.

```tsx
import { toast } from '@lyndon/ui'

const id = toast({ title: 'Saving…', tone: 'loading' })   // tones: ok (default), info, warn, bad, loading
toast.update(id, { title: 'Saved', tone: 'ok' })          // in place: same slot, fresh timer, announced again
toast.dismiss(id)                                          // or toast.dismiss() for all

// one toast through a promise: loading → success or error, morphing in place
toast.promise(save(draft), {
  loading: 'Saving draft…',
  success: doc => ({ title: 'Draft saved', description: doc.name }),
  error: e => ({ title: 'Couldn’t save', description: String(e), action: { label: 'Retry', onClick: retry } }),
})

// Undo: the toast gets an Undo button; onCommit runs when it leaves without Undo (deferred delete)
toast.undoable({ title: 'Message archived', onUndo: restore, onCommit: archiveForGood })

toast({ id: 'new-version', title: 'A new version is available', duration: Infinity, action: { label: 'Reload', onClick: reload } })
```

- **Options:** `id` (dedupe: the same id replaces the toast instead of stacking), `title`, `description`, `tone`,
  `action` (`{ label?, onClick }`; the label defaults to "Undo"; the toast closes unless `onClick` calls
  `e.preventDefault()`), `duration` (ms, default 4200, 6000 with an action; `Infinity` stays until dismissed; loading
  toasts never time out), `position`, `onDismiss(reason)` (`timeout`, `close`, `swipe`, `action` or `api`).
- **Position:** `top-start`, `top-center`, `top-end`, `bottom-start`, `bottom-center`, `bottom-end` (default).
  Start is the left, end the right. Set it per toast, on `<ToastProvider position>`, or for the page-wide
  queue with `toast.configure({ position, max })`. Phones get full-width toasts.
- **Stacking:** at most `max` (default 5) per position are on screen, the newest ones. Older toasts wait behind a
  "+n more" badge and come back as newer ones leave. Moving toasts animate with transforms, so nothing reflows.
- **Timers** pause while a toast is hovered, while focus is in the region and while the tab is hidden. Swipe a toast
  toward its edge to dismiss it.
- **Screen readers** hear each toast and each update once: a polite status region, or an assertive alert for `bad`.
  The text starts with the tone ("Error: Couldn’t save"), because the icon is decorative.

## Chart data tables and export

Every chart (`Chart`, `DonutChart`, `RadarChart`, `ScatterChart`, `FunnelChart`, `BarList`, `Treemap`, `BulletChart`,
`Heatmap`, `CalendarHeatmap`, `RegressionChart`, `BoxViolinChart`, `DensityHistogram`, `ForestPlot`) renders its
data as a real `<table>`, with numbers formatted by the chart's `format` (or `fmt.number`).

- `table="hidden"` (default): the table is visually hidden. Screen-reader users can browse it with table navigation,
  and its caption holds the summary that the chart's `aria-describedby` points to.
- `table="toggle"` adds a **Show data** button under the chart that opens the table in a scrollable box.
- `table="shown"` shows it from the start.

`exportable` adds a ⋯ menu under the chart: Download PNG, Download SVG, Download CSV and, where the clipboard accepts
images, Copy image. It opens over the chart, so nothing moves. You can also export from code. Every chart takes a `ref`:

```tsx
import { Chart, exportChart } from '@lyndon/ui/charts'

const ref = useRef<HTMLDivElement>(null)
<Chart ref={ref} data={rows} x="month" series={[{ key: 'revenue' }]} table="toggle" exportable />

await exportChart(ref, { format: 'png', scale: 3 })                     // downloads "revenue-chart.png"
const blob = await exportChart(ref, { format: 'svg', download: false }) // just the Blob
```

- **Files** are named after the chart's label (`fileName` overrides it). `background` is `'auto'` (the card colour
  behind the chart), a CSS colour, or `'none'`.
- **Images** are drawn from the chart as it is on screen. Theme colours (CSS variables, `color-mix()`), opacity and
  fonts are inlined as plain values, so the SVG looks the same outside the page. HTML parts (legends, bar lists,
  heatmap cells, treemap tiles) are redrawn as SVG rects and text. Nothing external is loaded. PNG renders that SVG
  on a canvas at `scale` (default: the screen's pixel ratio, at least 2), capped at 16 megapixels.
- **CSV** comes from the data table: raw values (ISO times for time axes), UTF-8 with a BOM so spreadsheets read
  accents. Text cells that start like a formula (`=`, `+`, `-`, `@`) get a leading `'`.
- **Limits:** web fonts are not embedded. A PNG uses the fonts installed on the machine, and an SVG names the page's
  font stack. Gradients and shadows on HTML parts are dropped, and text cut off with an ellipsis is exported in full.
  Copy image needs a secure context and a browser with `ClipboardItem`.

## Tags over time (annotations and timelines)

Put events and periods on a time axis. One tag type, `TimeTag` (`{ id, at, end?, kind, label, icon?, color?, detail? }`;
`at`/`end` are epoch ms or `Date`), feeds every view:

```tsx
<Chart data={points} x="t" xTime series={[{ key: 'points' }]}
  annotations={{ tags, kinds, style: 'auto' }} />          // pins → rug → rolled-up counts as tags crowd
<Swimlanes tags={tags} kinds={kinds} start={dayStart} end={dayEnd} top={<Chart … />} />
<StateRibbon states={postureStates} pins={tags} start={dayStart} end={dayEnd} />
<ChartWithJournal tags={tags} kinds={kinds} chart={link => <Chart … annotations={{ ...link, style: 'dots' }} />} />
<TraceWaterfall … annotations={deploys} />                  // flags over the trace (rug when crowded)
```

- `style`: `pins` (on the line), `rug` (icon row under the axis), `flags` (dashed rules), `rollup` (count chips per
  time bin), `dots`, or `auto`, which measures collisions at the current width and falls back pins → rug → rollup.
  Spans render as shaded bands (`spans: 'bands' | 'none'`).
- `reserve: 'current'` (default) reserves only the room the shown style needs and eases when it changes; use `'max'`
  for live or streaming data so the chart's height never changes.
- Linking: `activeId` / `onActiveChange` / `onSelect` connect a chart, lanes, ribbon and journal. Each view is one Tab
  stop; ←/→ move through tags in time order (↑/↓ between lanes), Enter selects, Escape clears.

## Graphs as rows (lane graphs)

Many graphs are read one node at a time: commits, chat messages that branch when you edit or regenerate, the steps of
an agent run, a syntax tree, a dependency chain. A lane graph draws them as a **list**: one row per node, your content
in the row, and the edges in a narrow gutter of vertical lanes beside it, like `git log --graph`. Because every row
carries its own slice of the graph, the list virtualises (100k rows render ~40) and rows can be any height.

Three layers in `@lyndon/ui/lanes`, each usable on its own:

- `layoutLanes(nodes, options)`: headless and pure (no React). A node is `{ id, parents, time?, group? }` (extend it with
  anything); you get `{ rows, laneCount, rowOf(id) }`, each row `{ node, index, lane, color, edges, parents, children }`
  with edges `{ fromLane, toLane, kind: 'pass' | 'merge' | 'fork' | 'missing', half: 'top' | 'bottom' | 'full', color,
  firstParent }`. Options: `order: 'time' | 'topo' | 'input'`, `direction: 'down'` (newest first, like git) or `'up'`
  (oldest first, like a chat), `pin` (groups that keep the leftmost lanes), `palette` and `color(group)`.
- `<LaneGutter row laneWidth rowHeight? />`: one row's SVG slice (lanes passing by, rounded elbows, the node, stubs for
  missing parents). Without `rowHeight` it stretches to the row, so a 400px chat message stays joined to the next row.
- `<LaneGraph nodes renderRow />`: the virtualised list of gutter + your row, with selection, hover/focus lighting a
  node's ancestry, ↑/↓, Home/End, ← parent / → child along edges, `onContextMenu`, `rowHeight="auto"` for rows sized by
  their content, `anchor="end"` for chat-like lists, and rows inserted above keeping the reader's place.
  `hovered` + `onHoverChange` (node ids) make the hover controlled, so something outside the list can light a row and
  its ancestry (a word in a code panel, a point on a chart); without `hovered` the mouse drives it as before, and
  `onHoverChange` still reports it. `useLaneGraph(nodes, options)` gives the same layout and state for your own markup.

```tsx
import { LaneGraph } from '@lyndon/ui/lanes'
import { Message } from '@lyndon/ui/aichat'

// a chat where editing a question or regenerating an answer forks a branch: each message names its parent
const nodes = messages.map(m => ({ id: m.id, parents: m.parentId ? [m.parentId] : [], message: m }))

<LaneGraph
  nodes={nodes}
  order="input" direction="up"               // your order, oldest first
  pin={['active']} pinStart={() => leafId}   // the thread being read keeps lane 0
  rowHeight="auto" anchor="end"              // rows as tall as the message; start at the bottom
  selected={leafId} onActivate={row => setLeafId(latestLeafUnder(row.node.id))}
  renderRow={row => <Message message={row.node.message} />}
/>
```

**How the layout works** (one pass, O(n · lanes); 50k nodes in about 50 ms):

1. *Order.* Children come before parents (Kahn's algorithm). `'time'` takes the newest ready node next, `'topo'` the
   one readied last (a branch's nodes stay together), `'input'` keeps your order wherever it is already valid.
2. *Walk the rows* with a list of open lanes, each heading for the parent it waits for.
3. *Take a lane.* A node takes the lane waiting for it; if several wait (branches that started here), the one that came
   through a first parent, so a branch's own line stays straight; the others end in it as forks. If none waits, the
   node is a tip and takes the leftmost free lane (pinned groups have theirs reserved).
4. *Continue.* Its first parent continues in its lane; each further parent (a merge) joins the lane already heading
   there or opens the leftmost free lane. Parents that aren't in the list end in a short fading stub.
5. *Rows record their own strokes:* lanes passing by, edges into the node from above, edges out below. No row needs
   another's geometry. Colours belong to groups (a branch, a thread), not lane numbers, so new rows don't reshuffle them.
   `direction: 'up'` runs the same pass and flips the result.

**Examples** (`@lyndon/ui/examples`, the showcase's "Graphs as rows" card; each is a data builder plus a `renderRow`):

- *Git*: `GitGraph`, the built-in preset below.
- *Chat branches*: `chatBranchGraph(messages, leaf)` over `AiMessage & { parentId? | parents? }` (what `useAiChat` keeps,
  plus where it hangs); rows render `Message` at full height, `‹ 2 / 3 ›` switches branches, one message combines two.
- *AST*: `parseAst(source)` (a small JavaScript subset), `astLaneNodes(tree)` and `astNodeAt(tree, start, end?)` (the
  deepest node at a position). Linked both ways with a `CodeBlock`: hovering a row underlines exactly its characters
  (`marks`), hovering a word lights its node's row through `hovered` (`onTokenHover`), clicking one selects it.
- *Agent run*: steps with `after: [...]`, fanning out to tools and back in, with `StatusIcon` and durations.
- *Dependencies*: packages above the packages they use (`parents` = dependencies); shared ones show up as merges.

### GitGraph (the built-in preset)

A commit history graph in the style of VS Code's Git Graph, GitKraken or `git log --graph`: `LaneGraph` plus commit
columns (refs, subject, author, date, hash), search, a branch filter, details with diffs and a compare mode. It is
virtualised (50k commits scroll like 50) and never runs git: every action is a callback.

```tsx
import { GitGraph, parseGitLog } from '@lyndon/ui/gitgraph'

<GitGraph commits={commits} pin={['main', 'develop']}
  loadCommit={hash => api.commit(hash)}             // → { files: [{ path, status, before?, after? }] }, shown with <Diff>
  loadDiff={(from, to) => api.diff(from, to)}       // Shift+click a second commit to compare
  onCheckout={(hash, branch) => …} onCreateBranch={…} onCherryPick={…} onRevert={…} onCompare={…} />
```

**Data.** `GitCommit = { hash, parents, subject, body?, author: { name, email?, avatar? }, date, refs? }` with
`GitRef = { name, type: 'branch' | 'remote' | 'tag' | 'head' | 'stash' }` (a `head` ref names the checked-out branch, or
`HEAD` when detached). Any order. To show a real repository, pipe this into `parseGitLog(text)` (`GIT_LOG_COMMAND`):

```sh
git log --all --date-order --pretty=format:'%H%x1f%P%x1f%an%x1f%ae%x1f%at%x1f%D%x1f%s%x1e' > log.txt
```

Fields are split by `\x1f` and records by `\x1e`, so subjects can hold anything. Add `--decorate=full` to tell remote
branches from local ones without guessing (otherwise `origin/` and `upstream/` prefixes mark remotes), `%x1f%b` before
`%x1e` to include bodies, and `-n 50000` to cap the history.

**What the preset adds to the lane layout** (`layoutGitGraph(commits, { order, pin, firstParentLanes })` maps commits to
lane nodes and calls `layoutLanes`): `order: 'date'` is `'time'` (`git log --date-order`); a commit's group is the
branch it carries (`origin/x` counts as `x`), so a branch ref starts that branch's colour (main/master/trunk get `--c1`);
`pin` reserves the leftmost lanes for long-lived branches (default: whichever of main/master/trunk exists), starting at
the local branch; a lane opened for a merge takes the branch named in "Merge branch 'x'". Lanes past `maxLanes` (12; 6
on phones) fold into a dashed "+n lanes" gutter; its header button shows them all and the list then scrolls sideways.

Also exported: `filterGitHistory` (branch filter, `firstParent`, `hideMerged`), `gitRange` (git's `a..b`),
`gitFirstParentPath`, `gitLaneColor`.

- Keyboard: one Tab stop (the active row). ↑/↓, Home/End, PageUp/PageDown move; ← goes to the first parent
  (Shift+← the second), → to the child; Enter opens details,
  Shift+Enter compares with the selection; `/` searches, n/N jump between matches; Escape leaves compare, closes details,
  then clears the selection; Shift+F10 or the Menu key opens the actions menu (right-click and long-press too).
- Hover or focus lights the commit's first-parent ancestry and dims the other lanes. Rows are 32 px (44 on touch, two
  lines at 52 px under 640 px). Details are a side panel from 900 px and a sheet below. Rows are named
  "Commit a1b2c3d: Fix login, by Ana, 2 days ago".
- New commits added at the top keep the reader's place (when scrolled) and fade in; a polite live region counts them.
- Size: the `git-graph` drop-in is about 317 KB (~90k tokens; it embeds the lane graph, the virtualiser, menus, sheet,
  Markdown and Diff); `lanes` alone is about 89 KB (~25k tokens).
- Limits: the layout runs on the main thread (~0.05 s per 50k commits on a laptop); for bigger logs, filter by branch or
  page the history (missing parents render as stubs).

## Binary inspection (hex editor, entropy, byte map)

`@lyndon/ui/binary` looks inside files: a hex editor, an entropy strip and a Hilbert-curve byte map that share a cursor,
plus the pure helpers behind them. Data is a `Uint8Array` or `ArrayBuffer`; nothing copies or stringifies it whole.

- `<HexEditor data />`: offset · hex · text rows, virtualised with fixed-height rows (a 100 MB buffer renders ~25 rows;
  past ~8 M px of rows the scroll range is scaled, with the wheel and keys still moving by exact pixels and rows).
  `bytesPerRow` 8 / 16 / 32, `colorBy` `'class' | 'section' | 'none'`, `offsets` `'offset' | 'vaddr'` (section address),
  `cursor` / `selection` (controlled or not), `highlights` (tinted, labelled ranges), `readOnly`, `onChange(edits)`.
  Keys: arrows, Page Up/Down, Home/End (Ctrl: file ends), Shift extends, Tab switches hex ↔ text, Ctrl+G go to (hex,
  decimal, `+16`, or a section address), Ctrl+F search (hex with `??` wildcards or text; matches on screen are tinted),
  Ctrl+A, Ctrl+C. Typing overwrites (hex digits a nibble at a time, or text); edits are a patch over the data with
  Ctrl+Z / Ctrl+Shift+Z, and the handle's `getBytes()` returns a patched copy. Right-click or long-press: copy as hex,
  C array, Base64 or text, select the section, jump to the u32 at the cursor. The data inspector decodes the cursor as
  u8…i64, f32/f64, unix time, varint and zigzag in either byte order. Touch: tap selects, the grid scrolls sideways, the
  text column hides below 480 px (switch).
- `<EntropyMap data />` (or `entropy` + `length`): Shannon entropy per window (default 512 B) as bars on a theme-aware
  scale, an offset ruler, section bands, a threshold (default 7.2 bits) and the merged high-entropy regions, listed with
  range, size, section and value. Click, drag, Enter or a list item → `onSelect(range)`. `orientation="horizontal"`.
- `<ByteMap data />`: the file on a Hilbert curve (canvas, crisp on HiDPI, square box with no layout shift), coloured by
  `entropy | sections | class | strings`; hover/tap readout (offset → address, section, entropy), click → `onSelect`,
  Ctrl/⌘ + wheel or the buttons zoom into part of the file.
- `<BinaryView data sections />`: all of the above plus `BinarySectionList`, linked (a hot spot, section or region moves
  the hex editor there; high-entropy regions are tinted in the hex). Columns from 900 px, tabs (Map / Entropy / Hex) below.
- Helpers: `entropyWindows(bytes, window = 512, step?, { align })` (one O(n) pass with a 256-bin histogram and a running
  Σ c·log₂c: ~0.2 s for 100 MB), `shannonEntropy`, `highEntropyRegions`, `hilbertD2XY` / `hilbertXY2D`,
  `findStrings(bytes, { min: 4, encodings: ['ascii', 'utf16le'] })`, `classifyByte`, `sectionAt`, `searchBytes(bytes,
  pattern, { as: 'text' | 'hex' })` (native `indexOf`, ~50 ms for 100 MB), `parseHexPattern`, `decodeBytes`,
  `readVarint`, `formatBytesAs(bytes, 'hex' | 'c' | 'base64' | 'text')`, `parseByteOffset`, `entropyColor`.

```tsx
import { BinaryView, HexEditor } from '@lyndon/ui/binary'

const sections = [{ name: '.text', offset: 0x1000, size: 0x3000, vaddr: 0x401000 }, /* … */]
<BinaryView data={bytes} sections={sections} onChange={edits => setDirty(edits.length > 0)} />

// or on its own, linked to your own views
<HexEditor data={bytes} cursor={cursor} onCursorChange={setCursor} highlights={[{ start: 0x7000, end: 0x9000, label: 'packed' }]} readOnly />
```

Sample data: `binarySample()` / `BINARY_SAMPLE_SECTIONS` (a synthetic 44 KiB
ELF-like file) and `binarySampleLarge(mb)` in `@lyndon/ui/examples`.

## Magnets (snapping for sliders and drags)

Opt-in snapping that pulls a drag onto meaningful values and lets go when you push past or flick through:

```tsx
<Slider label="Volume" magnets={[0, 25, 50, 75, { value: 100, label: 'Max', strength: 1.5 },
  { from: 40, to: 60, label: 'Recommended', pull: 'edges' }]} onSnap={m => …} />
<RangeSlider magnets={[10, 25, 50, 100]} />          // thumbs also stick to each other (± minGap)
<SplitPane magnets />                                 // thirds, half and the collapse point
<VideoPlayer chapters={[{ start: 0, title: 'Intro' }, …]} />   // chapter starts are magnets
<Gantt magnets />                                     // bar edges stick to other tasks and the today line
<ColorPicker hueMagnets />
```

- Points: `number | { value, label?, radius?, strength? }`. Zones: `{ from, to, label?, pull?: 'edges' | 'center' |
  'inside' }` (`edges`: sticky boundaries; `center`: snaps the middle; `inside`: slows the thumb without sticking).
- Capture 8 px / release 18 px with a mouse (12 / 26 on touch), shrunk between crowded marks; flicks faster than 1 px/ms
  pass through. Hold **Alt/Option** (or put a second finger down) to bypass.
- Feedback: a short haptic tick on touch, a spring settle (none under reduced motion), the mark's label in the thumb
  bubble and a polite "Snapped to {label}" announcement. PageUp/PageDown and Ctrl/⌘+arrows jump between marks.
- Custom drags: `useMagnet`, the pure `magnetize`, `MagnetMarks` and `MagnetBubble` from `@lyndon/ui/magnet`.
  Snapped values submit through FormData like any other value.

## Forms

Every value-holding control (Select, Combobox, MultiSelect, DatePicker, DateRangePicker, DateField, TimeField, TimePicker,
DateTimeField, DateTimePicker, MonthPicker, YearPicker, TimeZonePicker, TagInput, Slider,
RangeSlider, OTPInput, PhoneInput, CurrencyInput, Rating, ColorPicker, NumberStepper, SegmentedControl, RadioGroup,
Switch, Checkbox, FileUpload) behaves like a native field: `name`, `required`, `disabled`, `readOnly`, `invalid`
(aria-invalid plus the error look), `onBlur`, `form`, and a `ref` that reaches the focusable element (so
`ref.current.focus()` works for focus-on-error). With `name`, hidden inputs carry the value, so `new FormData(form)`,
plain `<form action>` posts and server actions see it. A form `reset` returns uncontrolled controls to `defaultValue`.
User edits fire bubbling `input` and `change` events on the form, like native fields.

| Control | Submitted as |
|---|---|
| Select, Combobox, SegmentedControl, RadioGroup | the option `value`; `''` when nothing is chosen (Combobox sends the value, not the typed text) |
| TimePicker, TimeField | `"09:30"` (24-hour wall time, like `<input type="time">`; `"09:30:15"` with `granularity="second"`); `''` while empty or half-typed |
| MultiSelect, TagInput | one field per item: `labels=bug&labels=docs` (never comma-joined; read with `formData.getAll`); nothing when empty |
| DatePicker, DateField | local date `"2026-11-08"` (like `<input type="date">`); `''` when empty or half-typed |
| DateTimeField, DateTimePicker | ISO 8601 with the offset of `timeZone` at that instant: `"2026-11-08T09:30:00+01:00"`; `''` when empty. `timeZoneName="tz"` adds the zone (`"Europe/Zurich"`) |
| MonthPicker, YearPicker | `"2026-11"` (like `<input type="month">`), `"2026"`; `''` when empty |
| TimeZonePicker | the IANA name, `"Europe/Zurich"` |
| DateRangePicker | two fields, start then end: `period=2026-11-01&period=2026-11-07`; `''` for a missing side |
| Slider, NumberStepper, Rating | the number as a plain string: `"40"`; Rating sends `''` while unrated |
| RangeSlider | two fields, low then high: `price=200&price=750` |
| CurrencyInput | plain number `"1234.5"` (no separators or symbol); `currencyName` adds the code (`"CHF"`) |
| PhoneInput | E.164 `"+41791234567"`; `''` while empty |
| OTPInput | the digits typed so far: `"123456"` |
| ColorPicker | `"#2563EB"` (upper case) |
| Switch, Checkbox | `value` (default `"on"`) while on; nothing while off, like a native checkbox |
| FileUpload | a native file field with the picked or dropped files (use `multipart/form-data`) |

`required` means something is chosen (MultiSelect and TagInput: at least one item; DateRangePicker: both ends; OTPInput:
every box; Checkbox and Switch: ticked). The date controls also stop a submit, with a message, when a date is half-typed,
outside `min`/`max` or `isDateUnavailable`. The browser validates it like a native field and, when it focuses the field,
focus lands on the real control. Disabled controls submit nothing; read-only ones submit but can't be changed.

**Form and FormField** need no form library. `FormField` wires a label (`htmlFor`, or `aria-labelledby` for controls
that aren't labelable elements), a description and an error (both through `aria-describedby`; they share one line, so a
message appearing doesn't push the layout) to whatever control is inside, and passes `name`, `required`, `disabled`
and `readOnly` down. `Form` validates on submit, shows each failing field's message in its FormField, focuses the first
one, and re-checks as fields change; `errors` adds your own messages by field name. `Field` still works (it is FormField).

```tsx
import { Button, Checkbox, Combobox, DatePicker, Form, FormField, Input, MultiSelect } from '@lyndon/ui'

<Form onValues={data => save(Object.fromEntries(data))} errors={serverErrors}>
  <FormField label="Full name" name="name" required><Input /></FormField>
  <FormField label="Team" name="team" required description="Grouped by department"><Combobox options={teams} /></FormField>
  <FormField label="Start date" name="start" required><DatePicker /></FormField>
  <FormField label="Skills" name="skills"><MultiSelect options={skills} /></FormField>
  <FormField name="terms" required><Checkbox value="accepted">I accept the handbook</Checkbox></FormField>
  <Button type="submit">Submit</Button> <Button type="reset">Reset</Button>
</Form>
```

**Server actions** (Next.js App Router) get the same fields. The components are client components, so the form can sit
in a Server Component:

```tsx
// app/join/actions.ts
'use server'
export async function join(data: FormData) {
  const team = data.get('team')         // "web"
  const start = data.get('start')       // "2026-11-08"
  const skills = data.getAll('skills')  // ["react", "sql"]
}

// app/join/page.tsx
<form action={join}>
  <FormField label="Team" name="team" required><Select options={teams} /></FormField>
  <FormField label="Start date" name="start" required><DatePicker /></FormField>
  <FormField label="Skills" name="skills"><MultiSelect options={skills} /></FormField>
  <button>Join</button>
</form>
```

**react-hook-form + zod.** The library depends on neither. Native-backed inputs (`Input`, `Textarea`, `PasswordInput`)
take `register()` directly. The custom controls call `onChange` with a value rather than an event, so bind them with
`Controller`: `field` spreads straight on (`name`, `value`, `onChange`, `onBlur`, `ref`, `disabled`), and `ref` reaches
the focusable element, so `shouldFocusError` works.

```tsx
import { useForm, Controller } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'

const schema = z.object({
  email: z.string().email('Use a work email'),
  team: z.string().min(1, 'Choose a team'),
  start: z.date({ message: 'Pick a start date' }),
  skills: z.array(z.string()).min(1, 'Pick at least one skill'),
})

function JoinForm() {
  const { register, control, handleSubmit, formState: { errors } } = useForm<z.infer<typeof schema>>({
    resolver: zodResolver(schema), defaultValues: { email: '', team: '', skills: [] },
  })
  return (
    <form onSubmit={handleSubmit(save)} noValidate>
      <FormField label="Email" error={errors.email?.message}><Input {...register('email')} /></FormField>
      <Controller name="team" control={control} render={({ field, fieldState }) => (
        <FormField label="Team" error={fieldState.error?.message}><Combobox {...field} options={teams} /></FormField>
      )} />
      <Controller name="start" control={control} render={({ field, fieldState }) => (
        <FormField label="Start date" error={fieldState.error?.message}><DatePicker {...field} value={field.value ?? null} /></FormField>
      )} />
      <Controller name="skills" control={control} render={({ field, fieldState }) => (
        <FormField label="Skills" error={fieldState.error?.message}><MultiSelect {...field} options={skills} /></FormField>
      )} />
      <Button type="submit">Join</Button>
    </form>
  )
}
```

**Dates and times.** The date controls use English names and the `dd/mm/yyyy` order, weeks start on Monday, and
`hourCycle` (12 or 24, default 24) and `timeZone` are props where they matter.

- `Calendar`, `DatePicker`, `DateRangePicker`: `min`, `max`, `isDateUnavailable(date)` (disabled days stay focusable and
  are announced), `numberOfMonths` (1–3, stacked on phones), the caption opens a month grid and then a year grid, and
  the grid follows the ARIA date-grid keys (arrows, PageUp/PageDown for months, Shift for years, Home/End for the week).
  `presets` (default `RANGE_PRESETS`: Today, Yesterday, Last 7 days, Last 30 days, This month, Last month) are
  `[label, () => range]` pairs.
- `DateField`, `TimeField`, `DateTimeField`: typed segments with auto-advance, ↑/↓ to step, Backspace, and paste of ISO
  or locale-formatted text. `granularity` is `'day' | 'hour' | 'minute' | 'second'`; `hourCycle={12 | 24}` overrides the locale.
- `DateTimePicker` is a DateTimeField with a calendar popover and a time field, plus `timeZonePicker` for a searchable
  list of every IANA zone. `TimePicker` is a TimeField with suggested times every `step` minutes (its 0.3 props still work).
- **Time zones.** The value of DateTimeField and DateTimePicker is an ISO string with the offset of `timeZone` at that
  instant, so `new Date(value)` is the instant and the wall time stays readable. A wall time the clocks skip moves forward
  (01:30 on 29 March 2026 in London is `02:30+01:00`), and a repeated one takes the first (`01:30+01:00` on 25 October). A
  new zone in the picker keeps the wall time and changes the offset. `zonedParts`, `zonedDate`, `zoneOffset` and
  `toZonedISO` do the same conversions in your own code.

```tsx
<FormField label="Kick-off" name="kickoff"><DateTimePicker timeZone="Europe/Zurich" timeZonePicker timeZoneName="kickoff_tz" /></FormField>
<FormField label="Delivery" name="delivery"><DatePicker min={today} isDateUnavailable={d => d.getDay() % 6 === 0} /></FormField>
```

**Async Combobox and MultiSelect.** `loadOptions(query, { signal })` replaces (or adds to) `options`. It runs `debounce` ms (200) after
typing stops, once the query has `minChars`; a newer query aborts the older request (pass `signal` to `fetch`) and late
results are dropped. The list shows loading, empty and error states (Retry, or Enter in the field). `creatable` adds
“Create “x”” (`onCreate(text)` may return the Option to use), options can carry a `group`, `defaultOptions` show before
the first load, and `onInputChange` reports typing. MultiSelect takes the same props; with `loadOptions` it gets a search
box after the chips, stays open while you tick several results, and keeps the chips labelled across searches. Option lists past 100 items (Select, Combobox, MultiSelect) render
only the visible rows.

```tsx
<Combobox name="city" creatable loadOptions={(q, { signal }) =>
  fetch(`/api/cities?q=${encodeURIComponent(q)}`, { signal }).then(r => r.json())} />
```

## Composable parts

Every interactive family has two APIs that render the same thing. The **config props** are a quick, one-line form
(`<Tabs items={[…]} />`, `<Dialog title footer>`), and the **parts** are a shadcn/Radix-style form for when you need
your own markup. The config components are now built on the parts, so they look and behave the same. Each family is an
object: `Tabs.Root`, `Tabs.List` and so on. The parts are also exported by name (`TabsRoot`, `DialogTitle`,
`MenuCheckboxItem` …).

Every Root is controlled (`value`/`open` with `onValueChange`/`onOpenChange`) or uncontrolled
(`defaultValue`/`defaultOpen`). Keyboard support and ARIA work as in the config form.

| Family | Parts | Notes |
|---|---|---|
| Tabs | `Root` `List` `Trigger` `Content` | `orientation="vertical"`, `activationMode="manual"`, `lazy`, `keepMounted`; `Content forceMount`. A horizontal list that overflows scrolls with edge fades and keeps the selected tab in view |
| Dialog | `Root` `Trigger` `Content` `Title` `Description` `Close` `Footer` | `Close` with no children is the ✕ icon button |
| Sheet | `Root` `Trigger` `Content` `Header` `Title` `Description` `Close` `Footer` | `Content side responsive`; `Header` is the drag handle on a bottom sheet |
| AlertDialog | `Root` `Trigger` `Content` `Title` `Description` `Footer` `Cancel` (= `Close`) `Action` | `Action onConfirm` may return a promise: the button spins, and a rejection shows its message |
| Popover | `Root` `Trigger` `Content` `Close` | `Content side align sideOffset arrow` |
| Tooltip | `Root` `Trigger` `Content` | `Root delay disabled`; `Content side align sideOffset arrow portal` |
| HoverCard | `Root` `Trigger` `Content` | `Root openDelay closeDelay pinOnClick` |
| DropdownMenu | `Root` `Trigger` `Content` `Item` `CheckboxItem` `RadioGroup` `RadioItem` `Label` `Separator` `Group` `Sub` `SubTrigger` `SubContent` `Shortcut` | Typeahead, ↑/↓/Home/End, →/← for submenus |
| ContextMenu | `Root` `Trigger` `Content` plus the same item parts | Right-click, long-press, Shift+F10 |
| Accordion | `Root` `Item` `Trigger` `Content` | `Root type="single" \| "multiple"`, `collapsible`; `Item disabled`; `Content forceMount` |
| ToggleGroup | `Root` (= `ToggleGroup`) `Item` | `type="single"` is a radio group, `"multiple"` uses pressed buttons |
| Toolbar | `Root` (= `Toolbar`) `Button` `Link` `Toggle` `ToggleGroup` `ToggleItem` `Separator` | One Tab stop; arrows move across all items |
| Toggle | (one component) | `pressed`/`defaultPressed`/`onPressedChange`, `variant="ghost" \| "outline"`, `size` |

```tsx
import { Accordion, AlertDialog, Dialog, DropdownMenu, Tabs, Toolbar, Tooltip } from '@lyndon/ui'

<Tabs.Root defaultValue="profile" orientation="vertical" lazy>
  <Tabs.List aria-label="Settings">
    <Tabs.Trigger value="profile">Profile</Tabs.Trigger>
    <Tabs.Trigger value="billing">Billing</Tabs.Trigger>
  </Tabs.List>
  <Tabs.Content value="profile">…</Tabs.Content>
  <Tabs.Content value="billing">…</Tabs.Content>
</Tabs.Root>

<Dialog.Root>
  <Dialog.Trigger>Rename</Dialog.Trigger>
  <Dialog.Content>
    <Dialog.Title>Rename project</Dialog.Title>
    <Dialog.Description>Shown in the sidebar and in shared links.</Dialog.Description>
    <Input defaultValue="Website redesign" />
    <Dialog.Footer>
      <Dialog.Close>Cancel</Dialog.Close>
      <Dialog.Close variant="primary" onClick={save}>Save</Dialog.Close>
    </Dialog.Footer>
  </Dialog.Content>
</Dialog.Root>

<AlertDialog.Root open={open} onOpenChange={setOpen}>
  <AlertDialog.Content>
    <AlertDialog.Title>Revoke the API key?</AlertDialog.Title>
    <AlertDialog.Description>Apps using it stop working immediately.</AlertDialog.Description>
    <AlertDialog.Footer>
      <AlertDialog.Cancel />
      <AlertDialog.Action onConfirm={() => api.revoke(id)}>Revoke key</AlertDialog.Action>
    </AlertDialog.Footer>
  </AlertDialog.Content>
</AlertDialog.Root>

<DropdownMenu.Root>
  <DropdownMenu.Trigger>View</DropdownMenu.Trigger>
  <DropdownMenu.Content align="end">
    <DropdownMenu.Label>Show</DropdownMenu.Label>
    <DropdownMenu.CheckboxItem checked={grid} onCheckedChange={setGrid}>Grid</DropdownMenu.CheckboxItem>
    <DropdownMenu.RadioGroup value={density} onValueChange={setDensity} aria-label="Density">
      <DropdownMenu.RadioItem value="compact">Compact</DropdownMenu.RadioItem>
      <DropdownMenu.RadioItem value="comfortable">Comfortable</DropdownMenu.RadioItem>
    </DropdownMenu.RadioGroup>
    <DropdownMenu.Separator />
    <DropdownMenu.Sub>
      <DropdownMenu.SubTrigger icon="upload">Export</DropdownMenu.SubTrigger>
      <DropdownMenu.SubContent>
        <DropdownMenu.Item onSelect={() => exportAs('png')}>PNG</DropdownMenu.Item>
      </DropdownMenu.SubContent>
    </DropdownMenu.Sub>
    <DropdownMenu.Item onSelect={copy}>Copy link<DropdownMenu.Shortcut>⌘L</DropdownMenu.Shortcut></DropdownMenu.Item>
  </DropdownMenu.Content>
</DropdownMenu.Root>

<Accordion.Root type="single" collapsible defaultValue="shipping">
  <Accordion.Item value="shipping">
    <Accordion.Trigger>Shipping</Accordion.Trigger>
    <Accordion.Content>Free over €50.</Accordion.Content>
  </Accordion.Item>
</Accordion.Root>

<Toolbar aria-label="Formatting">
  <Toolbar.ToggleGroup type="multiple" value={marks} onValueChange={setMarks} aria-label="Text style">
    <Toolbar.ToggleItem value="bold" aria-label="Bold"><b>B</b></Toolbar.ToggleItem>
    <Toolbar.ToggleItem value="italic" aria-label="Italic"><i>I</i></Toolbar.ToggleItem>
  </Toolbar.ToggleGroup>
  <Toolbar.Separator />
  <Toolbar.Button>Link</Toolbar.Button>
</Toolbar>

<Tooltip.Root>
  <Tooltip.Trigger asChild><IconButton icon="info" label="Help" /></Tooltip.Trigger>
  <Tooltip.Content side="bottom" arrow>Opens the docs</Tooltip.Content>
</Tooltip.Root>
```

Menu items close the menu when chosen. Checkbox and radio items stay open so you can toggle several. Change this with
`closeOnSelect`, or call `e.preventDefault()` in `onSelect` to keep the menu open. Menu content positions its
submenus itself, so don't give it `overflow-hidden` or `overflow-auto`.

### Placement

`side` is `top`, `right`, `bottom` or `left`; `-start` and `-end` line a top or bottom panel up with the trigger's left
or right edge. `Sheet` takes `side="end"` (default, the right), `start` (the left), `left`, `right` or `bottom`.
DataGrid pins take `left`/`right`.

### asChild and links

`asChild` renders your single child element instead of the part's own element, with the part's props merged in. It
works on `Button`, `IconButton`, every `Trigger` and `Close`, `DropdownMenu.Item` and `ContextMenu.Item`,
`Tabs.Trigger`, `Accordion.Trigger`, `Toggle` and `ToggleGroup.Item`. Use it for links: the library has no router of
its own, so links work with any router.

```tsx
import Link from 'next/link' // or react-router's Link, TanStack's Link, or a plain <a>

<Button asChild variant="primary"><Link href="/pricing">See pricing</Link></Button>
<IconButton asChild icon="settings" label="Settings"><Link href="/settings" /></IconButton>
<DropdownMenu.Item asChild><Link href="/inbox">Inbox</Link></DropdownMenu.Item>
<Dialog.Trigger asChild><MyFancyButton>Open</MyFancyButton></Dialog.Trigger>
```

The contract (implemented by `Slot`, which is exported along with `mergeSlotProps`, `composeRefs` and
`useComposedRefs`):

- **One child.** The child must be exactly one React element: no text, array or fragment. Anything else throws an
  error that says so.
- **Props pass through.** The child must spread the props it receives onto a DOM element and accept `ref`. React 19
  function components that pass `...props` and `ref` through do, and so do router `Link`s.
- **className.** Both are kept: the part's classes first, then yours.
- **style.** The two are merged, and yours win on conflicts.
- **Event handlers.** Both run, yours first. Call `event.preventDefault()` in yours to skip the part's handler (for
  example, to stop a trigger from opening).
- **ID lists.** `aria-describedby` and `aria-labelledby` are joined, so a tooltip's description adds to yours.
- **ref.** The refs are composed, so the part and you both get the node.
- **Other props.** Yours win.
- **`Button asChild` with `disabled` or `loading`.** The child gets `aria-disabled` (and `aria-busy`), and clicks are
  blocked. The spinner only renders inside a real `<button>`.
- **`IconButton asChild`.** The icon goes inside your element, and `label` becomes its accessible name.

Nested `asChild`s compose. For example, one button can be both a tooltip trigger and a popover trigger:
`<Tooltip.Trigger asChild><Popover.Trigger asChild><IconButton … /></Popover.Trigger></Tooltip.Trigger>`.

## Overriding classes

There is no tailwind-merge, so a class you pass does not replace one the component already sets. Use Tailwind's
important modifier: `<Input className="!h-8" />`, `<Button className="!rounded-full" />` (in Tailwind v4 the
`!` may also go at the end: `h-8!`). Prefer the props (`variant`, `size`, `tone`) and the CSS variables where
they exist.

## Accessibility and motion

- Components use native elements or the matching ARIA roles (dialog, menu, listbox, tablist, slider, …), with
  keyboard support (arrow keys, Home/End, Escape, type-ahead where it fits) and visible focus rings.
- Dialogs and sheets trap focus and restore it on close; while one is open the rest of the page is `inert` and
  Escape and Tab work wherever focus is (nested dialogs stack). Toasts are announced once each, through a polite
  status region (an assertive alert for errors), and at most five per position show at once (`ToastProvider max`).
- Every chart is one Tab stop with an arrow-key readout, and its data is also a real table: visually hidden by default,
  or behind a "Show data" button (`table="toggle"`).
- Every animation respects `prefers-reduced-motion` (`MotionConfig reducedMotion="user"` plus CSS fallbacks);
  the theme reveal becomes an instant change.
- Touch: controls grow their hit areas on coarse pointers, hover-only affordances also work by tap or focus,
  and text fields are 16px on phones so iOS does not zoom.
- Secondary text colours are nudged to at least 4.5:1 contrast in every theme.

## Security and trust boundaries

What the components do with untrusted input, and what stays your job. Report vulnerabilities as described in
[SECURITY.md](./SECURITY.md).

- **Rich text**: `RichTextEditor` output (`onChange`) is HTML. It is sanitized by default (an allowlist of
  formatting tags; links limited to https, http, mailto and relative URLs, with every other attribute removed; pass
  `sanitize` to use your own, e.g. DOMPurify), but treat it as untrusted anyway: sanitize again on the server, and
  before rendering it anywhere else. Dropped content goes through the same sanitizer; paste is plain text.
- **Mentions**: `MentionsInput` segments are display text built from what the user typed and picked. Resolve the
  ids on the server before notifying or authorising anyone.
- **AI output**: the AI components take model output as data. Links pass through `safeUrl` (http, https, mailto,
  tel and relative only), colours through `safeColor`, and model HTML is previewed in a sandboxed frame without
  scripts. Never treat model text as instructions to your app.
- **Streamed AI messages** (`useAiChat`, `MessageParts`): model text renders only through `Markdown` (no raw HTML,
  links through `safeUrl`), user text as plain text, tool arguments and results as
  data (indented JSON text, or `JsonViewer`), and
  source links through `safeUrl`. Attachment previews use object URLs that are revoked when the file is removed,
  sent or unmounted, shown only through `safeMediaUrl`. Streams are capped (`AI_LIMITS`: 200,000 characters per
  part, 100,000 of tool-argument JSON, 400 parts per message, 2,000 messages, 1 MB per SSE event or NDJSON line;
  longer input is dropped, not thrown). Validate and authorise what the browser sends to your route; never let a
  client-sent message decide what a tool may do.
- **Approvals**: `AgentComposer`'s approval card and `PermissionRequest` only gate an action when you wire them, and
  they only report outcomes your app confirms:
  - `AgentComposer`: return `{ needsApproval: { tool, summary, args?, recipients? } }` from `onSend` instead of running
    the action, then run it inside `onApprovalRequest(action, approved)` when `approved` is true. Resolve `true` once
    it ran (or, on deny, to confirm nothing ran). Approve is disabled for 500 ms after the card appears.
  - `PermissionRequest`: `onDecide(allowed, always, draft)` receives the edited draft and may return a promise;
    pass `progress` for real delivery counts and `onUndo(): Promise<boolean>` to offer Undo.
  - `useAiChat`: a tool call that asks for approval stays `awaiting-approval` until `decideTool(id, approved)` (the
    tool card's Approve/Deny, armed after 500 ms). Run the tool in `onApprovalRequest(tool, approved)` only when
    `approved` is true, or on your server once the next request shows `approval.approved === true`. A denied call
    never shows a result, even if one arrives.
  On their own they are UI. The text-matching `needsApproval` fallback is a demo aid and gates nothing.
- **Files**: `FileUpload` filters picked and dropped files by `accept` (skipped ones go to `onReject`), but the name
  and type it checks are under the user's control. Validate type, size and content on the server.
- **URLs and colours from data**: `safeUrl`, `safeMediaUrl`, `cssUrl`, `safeCssValue` and `safeColor` (from
  `@lyndon/ui` or `@lyndon/ui/utils`) are applied to hrefs, image sources and colours the components take from
  props (MegaMenu, Breadcrumbs, Avatar, chart and diagram colours…). Use them in your own code for anything that
  comes from users or models.
- **Theme storage** is same-origin state: anything on your origin can write it, so it is validated on every read
  (see [Theming](#theming)). Don't store anything else under the same key.
- **Outside requests**: none, unless `fonts` is on (Google Fonts).
- **Resource limits**: the data grid's regex search is capped at 200 characters, rejects nested and stacked
  quantifiers, searches the first 500 characters of a cell, and stops after about 120 ms with a "search too slow"
  note; charts take `maxPoints` to sample long series; `JsonViewer` shows cycles as `[Circular]` and cuts off very
  deep or very large data; toasts are capped.
- **CSP and framing**: see [Content Security Policy](#content-security-policy). Serve pages with
  `HoldToConfirm` or approval prompts with `frame-ancestors 'none'` (or `'self'`); `HoldToConfirm` holds for at
  least 500 ms whatever `duration` says.

## CI

GitHub Actions run on every push to `main` and every pull request. All actions are pinned to commit SHAs, every
workflow has `permissions: contents: read` (jobs widen it only where they must), and the workflows pass actionlint
and zizmor.

- **`ci.yml` → check:** `pnpm install --frozen-lockfile`, `pnpm audit --prod --audit-level=moderate`,
  `tsc -b` plus the tests' own type-check, `pnpm build`, the single-file bundles type-checked on their own,
  `pnpm test:ssr`, `pnpm test` (Vitest), and `pnpm test:pack`: what `npm pack` would publish has every entry
  point, no source maps, `sourceMappingURL` comments, local paths or secret-shaped strings, and
  `dist-single/SHA256SUMS` matches the bundles, and the CLI and every drop-in listed in `dist-registry/index.json` are
  in the tarball with matching sha256.
- **`ci.yml` → check (registry and docs):** `pnpm test:registry` (every drop-in type-checks on its own under the
  app's strict settings, imports only react/react-dom/motion, loads on the server, and a sample renders inside the
  `UIProvider` of `ui-provider.tsx`), a CLI smoke test into a temporary project, and `pnpm typecheck:docs && pnpm docs:build`.
- **`pages.yml`:** on pushes to `main` and by hand, builds the docs, the showcase and the registry (with the Pages
  URL in `registryDependencies`) and deploys them to GitHub Pages (`pages: write` and `id-token: write` only in the
  deploy job).
- **`ci.yml` → e2e:** Playwright (Chromium) against the built showcase served by `vite preview`, on desktop light,
  desktop dark and iPhone 13: no console errors, no axe violations beyond `tests/e2e/axe-baseline.json`,
  layout-shift budgets per section, no sideways page scroll on the phone. The report is uploaded when it fails.
- **`codeql.yml`:** CodeQL, `security-extended` suite, on pushes, pull requests and weekly.
- **`dependabot.yml`:** weekly grouped updates for npm and for the pinned actions, with a 7-day cooldown.
- **`release.yml`:** manual only (`workflow_dispatch`). Publishes through npm trusted publishing with provenance
  from a protected `npm` environment after `pnpm check` and the pack check.

Run the same locally with `pnpm check`, `pnpm test:pack` and `pnpm test:e2e` (see "Testing" in CONVENTIONS.md).

Not automated yet, and recommended by the security review: Semgrep (`p/react`, `p/xss`) with custom rules for
`innerHTML`, `srcDoc` with `allow-scripts`, non-literal `RegExp`, nested quantifiers (eslint-plugin-regexp),
`Math.max(...` spreads and unvalidated `JSON.parse` of storage; lockfile-lint; OpenSSF Scorecard; gitleaks over
the history; and a reproducible-build diff of `dist/` against the published tarball.

## Browser support

Current evergreen browsers: Chrome and Edge 111+, Safari 16.4+, Firefox 128+ (the Tailwind v4 baseline; the
tokens use `color-mix()`). The theme reveal uses the View Transitions API where available and falls back to a
colour cross-fade elsewhere.

## Licence

MIT with a revenue threshold (see [LICENSE](./LICENSE)):

- **Free** for individuals and for organisations with up to USD 200,000 annual recurring revenue (including
  affiliates), for any use, including commercial.
- **Above USD 200,000 ARR** you may evaluate it, but need a commercial licence from the author (Lyndon Leong)
  before using it in production.
