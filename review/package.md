# Package / API review

## Before-publishing checklist (priority order)

1. **"use client"**: none anywhere → App Router server components fail on import. Add an output banner in the lib build and to each dist-single file; move pure utilities (`cn`, `mix`, `contrast`, `themeCSS`, `highlightCode`, `codeLineDiff`, `wordDiff`) to a `ui-library/utils` entry without it.
2. **SSR-safe theme**: ThemeProvider calls `matchMedia` and reads `localStorage` in `useState` initialisers → `renderToString` crashes and hydration mismatches. Start from defaults, read in effects (use core `useMediaQuery` with its server snapshot), add a blocking `<ThemeScript storageKey>` to avoid theme flash, expose `storageKey`/`persist` on `UIProvider`.
3. **Audio on the server**: `createAudioTrack` does `new Audio()` in a `useState` initialiser; `useAudioTrack` has no `getServerSnapshot`. Create lazily; pass a server snapshot.
4. **React version**: refs rely on React 19 ref-as-prop; peers say `>=18` (broken in a React 18 test app). Set peers to `^19` (or forwardRef everywhere). Tighten motion: `^11.11 || ^12 || ^14` (whatever is tested).
5. **Types**: emitted `.d.ts` use extensionless re-exports → break under NodeNext. Bundle declarations or emit `.js` specifiers. Export `XProps` for every component. `DataTable`/`DataGrid`/`useFormDraft`/`ChartDatum` use `Record<string, unknown>` → reject interfaces; use `T extends object`, make `Chart` generic over keys.
6. **Exports map**: add `default` condition and `./package.json`; drop or rework `./single` (raw TSX); `sideEffects: ["**/*.css"]`.
7. **CSS**: `styles.css` includes Tailwind Preflight (resets host pages) and showcase classes. Build from theme + utilities only with `@source "./"` scoped to src/lib. Scope UIProvider's global `body`/`html` styles to `.ui-root`; allow theme variables on the wrapper (`target="self"`).
8. **Leaked internals**: unexport `aiUseMedia`, `aiTouch`, `aiPricingCard`, `formsHighlight`, `useChart*`, `gridFilter`, `media*` helpers, `motionSnippet`, `describeSample`, `SHEET_BOTTOM_BELOW`, `DIAGRAM_ICONS`, `SAMPLE_ADDRESSES`; demo widgets (`MotionPlayground`, `PhoneFrame`, `AgentTransitMap`, `AgentComposer` without onSend, `AICanvas`/`ChatInbox` demo defaults) need real props or move to the showcase. Rename `aiUseMedia` (rules-of-hooks errors in consumer lint). Fix 4 missing keys in ui-content.
9. **Props**: Input ref merging; Switch/Checkbox accept `name`/`value`/`required`/`id`/`className`/aria and render a hidden input; add `className` to ~76 components; fill controlled/uncontrolled gaps (Accordion, Calendar, OTPInput, PhoneInput, CurrencyInput, Popover `defaultOpen`, FileUpload, TreeView, DataTable sort).
10. **Hydration**: `new Date()` in render (Calendar, Scheduler, CalendarHeatmap, ChatInbox clock), `Math.random` NetworkGraph layout, media queries in initialisers (`aiUseMedia`, `useChartCoarse`).
11. **Per-module entries**: `preserveModules` + subpath exports (`/charts`, `/geo`, `/ai`, …). `dist/index.js` is one 1 MB file (tree-shaking works in prod: Button 7 KB gz, Chart 32 KB, geo 35 KB gz).
12. **Docs and metadata**: README (install, peers, Tailwind v4 `@source "../node_modules/ui-library/dist"` / v3 `content`, no-Tailwind path, UIProvider, theming, SSR guide, single-file usage, `!` overrides, browser support), LICENSE, repository/homepage/keywords, check the name, slim the tarball (exclude `ui-with-examples.tsx`/sourcemap).
13. Optional: real streaming API for AI chat (`AsyncIterable<string>`), router `Link` slot for navigation, option to disable Google Fonts.

## Naming / consistency notes
- `onChange(value)` clashes with native `onChange(event)`; consider `onValueChange`/`onCheckedChange`.
- Tone vocab differs (Badge `Tone`, Progress, ProgressRing, OTPInput `status`); size vocab differs (Button, SegmentedControl, numeric sizes).
- `Steps current` vs `Wizard value`; `Pagination total` ambiguous; Switch `label` vs Checkbox `children`.

## What's fine
- No browser API at module scope; `import('dist/index.js')` works in Node (288 exports).
- Tree-shaking works; geo data is not pulled in by Button.
- Single files compile and render in a fresh strict Vite + Tailwind v4 app (light/dark, add-ons, showcase).
- No `any` in public `.d.ts`.
