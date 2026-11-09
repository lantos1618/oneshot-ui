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
| `className` | | Classes for the `.ui-root` wrapper. |
| `locale` | `'en-GB'` | BCP 47 locale for built-in strings, numbers, dates and the week start. See [Internationalisation and RTL](#internationalisation-and-rtl). |
| `dir` | `'auto'` | `'ltr'`, `'rtl'`, or `'auto'` (from the locale: Arabic, Hebrew, Persian, Urdu… are right to left). |
| `timeZone` | the runtime's | IANA zone for formatted dates and times. Set it when you server-render dates. |
| `weekStartsOn` | from the locale | `0` = Sunday … `6` = Saturday. en-GB → 1, en-US → 0, ar-EG → 6. |
| `hourCycle` | from the locale | Force `'h12'` or `'h23'`. |
| `messages` | | A (partial) message catalog: `UI_MESSAGES_DE`, `UI_MESSAGES_AR`, or your own keys. Missing keys fall back to English. |

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

## Internationalisation and RTL

New in 0.4. `UIProvider` takes a locale, and everything that reads `useLocale()` formats and words itself for it:

```tsx
import { UIProvider, UI_MESSAGES_AR, UI_MESSAGES_DE } from '@lyndon/ui'

<UIProvider locale="de-DE" messages={UI_MESSAGES_DE}>…</UIProvider>   // German strings, 1.234,50 €, Monday weeks
<UIProvider locale="ar-EG" messages={UI_MESSAGES_AR}>…</UIProvider>   // Arabic, right to left, Saturday weeks
<UIProvider locale="en-US" timeZone="America/New_York">…</UIProvider> // English strings, Nov 8, 2026, 2:05 PM
```

The default is `en-GB`, not `navigator.language`, so the server and the first client render agree. To follow
the browser, pass its language after mount (`useEffect(() => setLocale(navigator.language), [])`), or read
`Accept-Language` on the server and pass that.

**In a component**, `useLocale()` returns `{ locale, dir, timeZone, weekStartsOn, hourCycle, t, fmt }`:

```tsx
const { t, fmt, dir, weekStartsOn } = useLocale()
t('common.removeItem', { name: file.name })                // "Remove report.pdf" · "report.pdf entfernen"
t('status.resultsCount', { count: n })                     // "No results" · "1 result" · "1,204 results"
fmt.money(1234.5, 'EUR')                                   // "€1,234.50" · "1.234,50 €" · "‏١٬٢٣٤٫٥٠ €"
fmt.date(d) · fmt.time(d) · fmt.relative(d)                // "8 Nov 2026" · "14:05" · "3 hours ago"
fmt.weekdays('short')                                      // from the locale's first day: ['Mon', … 'Sun']
fmt.number(n) · fmt.percent(0.125) · fmt.list(names) · fmt.compact(12400) · fmt.bytes(2.4e6)
```

`fmt` caches its `Intl` formatters per locale and options, so calling it in render is cheap. The module-level
`fmt`, `fmtDate` and `LOCALE` still exist and stay en-GB (for code outside React and for backwards
compatibility); `fmtFor(locale, { timeZone })` gives the same API for any locale, and `LocaleProvider` scopes a
locale to one subtree.

**Messages.** `UI_MESSAGES_EN` lists every built-in string under a stable key (`common.close`,
`status.noResults`, `paging.rangeOf`, `theme.appearance`…). Values use a small ICU subset: `{name}`,
`{n, number}`, `{count, plural, =0 {…} one {# item} other {# items}}` (plural categories from
`Intl.PluralRules`, so Arabic's zero/one/two/few/many/other work) and `{x, select, a {…} other {…}}`. Override
a few strings, or add your own keys and call `t('myApp.key')`:

```tsx
<UIProvider messages={{ 'common.close': 'Dismiss', 'myApp.greeting': 'Hi {name}' }}>
```

A key missing from your catalog falls back to English (development builds warn once per key); an unknown key
renders as the key itself. `formatMessage(pattern, vars, locale)` and `createTranslator(locale, messages)` are
exported for use outside components.

**Adding a locale.** Copy `UI_MESSAGES_EN` (typed as `UIMessages`, so TypeScript lists any key you missed),
translate the values, and pass it as `messages` with the matching `locale`. `UI_MESSAGES_DE` and
`UI_MESSAGES_AR` are machine-drafted examples: have a native speaker review them before shipping. Numbers,
dates, weekday and month names, plural rules, the week start and the clock come from `Intl`, so they need no
catalog.

**Right to left.** `dir` and `lang` go on the `.ui-root` wrapper (in the server HTML too), and with
`target="html"` on `<html>` after hydration. When you server-render, also put them on your own `<html>` tag so
the first paint is already mirrored: `<html lang={locale} dir={localeDir(locale)}>`. Inside components:

- Use logical utilities: `ms-*`/`me-*`, `ps-*`/`pe-*`, `start-*`/`end-*`, `border-s`/`border-e`,
  `rounded-s`/`rounded-e`, `text-start`/`text-end` (Tailwind v3.3+ or v4). `rtl:` variants for anything else.
- Keep safe-area padding physical (`pl-[max(16px,env(safe-area-inset-left))]`): the inset belongs to that side
  of the screen in both directions.
- Arrow keys: `switch (logicalArrow(e.key, dir))` treats ArrowLeft as "forward" in RTL.
- Motion offsets: `initial={{ x: dirX(12, dir) }}` slides in from the same logical side.
- Directional icons (chevrons, undo, list icons): add `className="ui-flip"`; UIProvider injects
  `[dir=rtl] .ui-flip { transform: scaleX(-1) }` (`UI_DIR_CSS`). With `injectStyles={false}`, add that rule to
  your CSS.
- `useDir()` returns `'ltr'` or `'rtl'`.

**What is translated in 0.4.** The infrastructure, the appearance panel (`AppearancePanel`, `AppearanceMenu`,
`ThemeToggle`), the page shell of the showcase, and the catalog keys for the strings that recur across modules.
The remaining components still render English literals and some physical classes; the 0.4 sweep routes them
through `t()`/`fmt` and logical utilities module by module. Two scripts track it:

```sh
node scripts/i18n-extract.mjs [files] [--summary] [--check]   # user-facing strings that bypass t()
node scripts/rtl-lint.mjs [files] [--all] [--summary]         # physical utilities, arrow keys, icons, inline styles
node scripts/rtl-lint.mjs --fix [files]                       # dry run: diff of the mechanical replacements
node scripts/rtl-lint.mjs --fix --write [files]               # apply them
```

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
`editor`, `scheduler`, `code`, `markdown`, `media`, `collab`, `pages`, `charts`, `diagrams` (re-exports `gantt`,
`statechart`, `trace` and `network`, each also an entry), `geo` (its map data, `geoworld` and `geoland`, loads lazily),
`aistream`, `ai`, `aichat`, `aiagent`, `appearance`, `provider`, `utils`, plus `styles.css`, `preflight.css` and
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

Wrap the app once in `<UIProvider>` from `ui-provider.tsx`. The files share it: React contexts (theme, locale, forms)
and module state (toast queue, scroll lock, modal stack and `inert` list, focus-trap stack, icon registry) live on
`globalThis` under a versioned key (`@lyndon/ui@0.4:<name>`), so a provider or modal from one file works with
components from another, exactly as with the npm package.

`ui-provider` holds only the theme engine, the locale engine with the English messages, `ThemeScript` and the host
outlet. Optional items: `toast` (toasts; `useToast()` without a `ToastProvider` uses one page-wide queue), `icon`
(the full icon set: each drop-in embeds only the icons it draws, and items that take icon names from props say so in
their header and list `suggests: ['icon']` in `index.json`), `messages-de` and `messages-ar` (drafted catalogues).

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

**Integrity.** Every drop-in and whole-library file starts with `'use client'` and a stamp line with the package
version, the git commit it was built from and the sha256 of the rest of the file. `dist-single/SHA256SUMS` lists the
sha256 of each whole-library file (`cd node_modules/@lyndon/ui/dist-single && sha256sum -c SHA256SUMS`) and
`dist-registry/index.json` the sha256 of each drop-in. A copied file doesn't update itself: re-copy it whenever a
release fixes a security issue (see [SECURITY.md](./SECURITY.md)).

## Docs site

`docs/` is a Vite + React app built with the library itself: one page per registry item with its description, the
showcase cards that use it (mounted live), props tables generated from the TypeScript types at build time (name, type,
default from the destructuring, JSDoc), the drop-in's size and install commands for npm, the CLI and shadcn. It has
search (⌘K), the theme toggle and a phone layout. `pnpm docs:dev` runs it; `pnpm docs:build` (after `pnpm build`)
writes `docs-dist/` with the docs, the showcase under `showcase/`, the registry and `llms.txt`, and
`.github/workflows/pages.yml` deploys that to GitHub Pages.

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

**Dates and times.** The date controls read `locale`, `weekStartsOn`, the hour cycle and `timeZone` from `UIProvider`
(or `LocaleProvider`), and each takes them as props too. Month and weekday names, digits, the order of the typed segments
(en-GB `dd/mm/yyyy`, en-US `mm/dd/yyyy`, ja-JP `yyyy/mm/dd`) and the 12/24-hour clock all come from `Intl`.

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

### Placement in RTL

`side` is physical, as in Floating UI and Radix: `top`, `right`, `bottom` and `left` are the same screen edge in both
directions. `align` is logical for top and bottom panels (`-start` lines up with the trigger's start edge, its right
edge in RTL). Things that hang off an inline edge mirror themselves: submenus and context menus open toward the
inline end, and a collapsed sidebar's tooltips pick their side from the direction. `Sheet` takes
`side="start" | "end"` (default `end`) as well as the physical `left`/`right`; DataGrid pins take `start`/`end`
(logical) or `left`/`right` (physical).

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
