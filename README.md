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
- Imports Geist and Geist Mono from Google Fonts, unless `fonts={false}`.
- Applies the current theme (CSS variables and `data-theme="light|dark"` on `<html>`), follows the OS in
  "system" mode, and remembers the user's choice in `localStorage`.
- Hosts toasts (`useToast()`) and turns animations off for users who prefer reduced motion
  (`MotionConfig reducedMotion="user"`).
- Renders a `<div class="ui-root">` around your app. Overlays (dialogs, sheets, popovers) portal into it.

| Prop | Default | |
| --- | --- | --- |
| `defaultTheme` | `{ theme: 'default', mode: 'system', radius: 8, font: 'Geist' }` | Starting settings before the user picks anything, and what Reset returns to. |
| `storageKey` | `'ui-theme'` | `localStorage` key for the saved appearance. |
| `persist` | `true` | Save and restore the user's theme. `false` always starts from `defaultTheme`. |
| `fonts` | `true` | `false` loads nothing from Google Fonts; `--font` falls back to `system-ui`. |
| `target` | `'html'` | `'self'` puts the theme variables on the `.ui-root` wrapper instead of `<html>` and leaves the host page alone (useful for embedding in an existing app). |
| `className` | | Classes for the `.ui-root` wrapper. |

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
- `useTheme().ready` is `false` on the server and during hydration (settings are the defaults then) and `true`
  once the saved settings and the OS scheme have been read, before the first paint.

### Avoiding a flash of the wrong theme (ThemeScript)

On a server-rendered page the HTML arrives before React, so the saved theme can only be applied once
JavaScript runs. `ThemeScript` is a tiny blocking inline script for `<head>` that reads the saved settings
and applies `data-theme`, `color-scheme` and every CSS variable to `<html>` before the first paint. Give it the
same `storageKey`, `defaultTheme` and `persist` as `UIProvider`, and add `suppressHydrationWarning` to
`<html>` because the script changes its attributes before React hydrates. It needs `target="html"` (the
default). For a strict CSP, pass `nonce`, or hash the string from `themeScriptSource()`.

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
`aiagent`, `playground`, `appearance`, `provider`, `utils`, plus `styles.css` and `preflight.css`.
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
with an AI assistant as the design system. Each file starts with `'use client'`. A prompt that works well:

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
- Dialogs and sheets trap focus and restore it on close; toasts are announced through an `aria-live` region.
- Every animation respects `prefers-reduced-motion` (`MotionConfig reducedMotion="user"` plus CSS fallbacks);
  the theme reveal becomes an instant change.
- Touch: controls grow their hit areas on coarse pointers, hover-only affordances also work by tap or focus,
  and text fields are 16px on phones so iOS does not zoom.
- Secondary text colours are nudged to at least 4.5:1 contrast in every theme.

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
