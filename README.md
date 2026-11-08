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
- **One file for AI tools**: the whole kit also ships as plain `.tsx` files you can paste into a chat or copy
  into a project (see [Single-file usage](#single-file-usage-for-ai-tools)).

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
  their own palette in the Customise grid of the appearance panel.
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
  components (previews of local files and recordings); drop them if you don't use those. The media demo's synthetic
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

## Subpath imports

`@lyndon/ui` is the all-in-one entry. Each area is also its own entry point (one ES module per area, with
types), which keeps dev servers and type-checking fast and makes the import show what you use:

```ts
import { Button, Card, Badge } from '@lyndon/ui/core'
import { Chart, DonutChart } from '@lyndon/ui/charts'
import { WorldMap } from '@lyndon/ui/geo'
import { cn, mix } from '@lyndon/ui/utils'
```

Entries: `core`, `motion`, `overlay`, `forms`, `navigation`, `feedback`, `data`, `datagrid`, `layout`,
`editor`, `scheduler`, `code`, `media`, `collab`, `pages`, `charts`, `diagrams`, `geo`, `ai`, `aichat`,
`aiagent`, `playground`, `appearance`, `provider`, `utils`, plus `styles.css`, `preflight.css` and `tokens.css`
(the token CSS UIProvider injects, for `injectStyles={false}`).
Tree-shaking works with either style: a bundler only keeps the components you import.

## Single-file usage for AI tools

The package also contains the kit as plain TypeScript files in `node_modules/@lyndon/ui/dist-single/` (not
importable through `exports`; copy them). They need only `react`, `react-dom`, `motion` and Tailwind:

| File | Contents | Needs |
| --- | --- | --- |
| `ui.tsx` | Theme and provider, primitives, inputs and forms, overlays, navigation, feedback, data display, layout | |
| `ui-content.tsx` | Editor, data grid, scheduler, code, media, collaboration, pages | `ui.tsx` |
| `ui-charts.tsx` | Chart kit, diagrams, maps | `ui.tsx` |
| `ui-ai.tsx` | AI chat, composer, agents | `ui.tsx` |
| `ui-all.tsx` | Everything in one file | |

Copy `ui.tsx` (plus any add-ons, side by side in the same folder) into your project, or attach it to a chat
with an AI assistant as the design system. Each file starts with `'use client'` and a stamp line with the package
version, the git commit it was built from and the sha256 of the rest of the file; `dist-single/SHA256SUMS` lists the
sha256 of each whole file (`cd node_modules/@lyndon/ui/dist-single && sha256sum -c SHA256SUMS`). A copied file
doesn't update itself: re-copy it whenever a release fixes a security issue (see [SECURITY.md](./SECURITY.md)).
A prompt that works well:

```text
Build the UI with the attached ui.tsx (React 19 + Tailwind + motion). Import components from './ui'.
Wrap the app in <UIProvider>. Use only the components and hooks it exports (Button, Card, Input, Select,
Dialog, Tabs, DataTable, useToast, …) and its colour tokens (bg-[var(--card)], text-[var(--fg2)],
border-[var(--line)], var(--accent)) instead of raw colours, so light/dark and every theme keep working.
Override a component's own classes with Tailwind's ! prefix (className="!h-8").
```

## Overriding classes

There is no tailwind-merge, so a class you pass does not replace one the component already sets. Use Tailwind's
important modifier: `<Input className="!h-8" />`, `<Button className="!rounded-full" />` (in Tailwind v4 the
`!` may also go at the end: `h-8!`). Prefer the props (`variant`, `size`, `tone`) and the CSS variables where
they exist.

## Accessibility and motion

- Components use native elements or the matching ARIA roles (dialog, menu, listbox, tablist, slider, …), with
  keyboard support (arrow keys, Home/End, Escape, type-ahead where it fits) and visible focus rings.
- Dialogs and sheets trap focus and restore it on close; while one is open the rest of the page is `inert` and
  Escape and Tab work wherever focus is (nested dialogs stack). Toasts are announced through an `aria-live` region
  and at most five show at once (`ToastProvider max`).
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
- **Approvals**: `AgentComposer`'s approval card and `PermissionRequest` only gate an action when you wire them, and
  they only report outcomes your app confirms:
  - `AgentComposer`: return `{ needsApproval: { tool, summary, args?, recipients? } }` from `onSend` instead of running
    the action, then run it inside `onApprovalRequest(action, approved)` when `approved` is true. Resolve `true` once
    it ran (or, on deny, to confirm nothing ran). Approve is disabled for 500 ms after the card appears.
  - `PermissionRequest`: `onDecide(allowed, always, draft)` receives the edited draft and may return a promise;
    pass `progress` for real delivery counts and `onUndo(): Promise<boolean>` to offer Undo.
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

## Recommended CI

There is no CI in this repository yet. When there is, these checks are the baseline:

- `pnpm install --frozen-lockfile`, then `pnpm audit --prod --audit-level=moderate` (blocking) and lockfile-lint.
- CodeQL (security-extended) and Semgrep (`p/react`, `p/xss`) plus custom rules for `innerHTML`,
  `srcDoc` with `allow-scripts`, non-literal `RegExp`, nested quantifiers (eslint-plugin-regexp), `Math.max(...`
  spreads and unvalidated `JSON.parse` of storage.
- OpenSSF Scorecard and zizmor for the workflows; actions pinned to commit SHAs; least-privilege `permissions`.
- Publishing through npm trusted publishing with provenance and 2FA; `prepublishOnly` already runs
  `pnpm build && pnpm test:ssr`.
- A pack check (`npm pack --dry-run`): no source maps, local paths or secrets (gitleaks), and a rebuild of
  `dist/` and `dist-single/` that must match what is published (compare with `SHA256SUMS`).

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
