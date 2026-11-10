# Working on the UI library

## Layout

- `src/lib/*.tsx`: the library, one module per area. `src/lib/index.ts` re-exports the core tier, `src/lib/all.ts` everything (see Tiers).
- `src/showcase/*.tsx`: the demo page, one file per section (`XSection`), plus `kit.tsx` (Spec, Section, Row, SECTIONS) and `index.tsx` (page shell).
- `scripts/build-single.mjs` generates `dist-single/ui.tsx` (one drop-in file) from the modules. Because of that, **every top-level name must be unique across all of `src/lib` and `src/showcase`**. Prefix internal helpers with your area if in doubt (e.g. `gridSort`, not `sort`).
- `GAPS.md`: what's missing, per component. Work through the rows in your scope.

## Tiers

Every module in `src/lib` belongs to the **core** tier or to one **extras** family; `scripts/tiers.mjs` is the list.

- Core (`@lyndon/ui`): foundation (helpers, shared, locale, safe, theme, hooks, icons, slot, primitives, formcontrol),
  motion, virtual, magnet, overlays and forms, navigation, feedback, data, layout, provider.
- Extras, each reached through its own subpath (`@lyndon/ui/charts`): vizkit, charts, diagrams, geo, content, lanes,
  media, collab, data (datagrid, scheduler, kanban), binary, ai, agents, theming.
- Core never imports extras, not even types. An extras module imports core, its own family and the families listed in
  its `deps`. Nothing imports a barrel except `./core`. No runtime import cycles. `tests/unit/tiers.test.ts` checks all
  of this, plus that `index.ts`, `all.ts`, `package.json` exports, the single-file bundles and the tag areas match.
- A new module: add it to `CORE` or a family in `scripts/tiers.mjs`, add its `./<name>` export to `package.json` and
  its area to `TAG_MODULE_AREA` (`src/showcase/tags.ts`). The builds fail until it is placed.
- Shared plumbing for extras goes in core (hooks, helpers, primitives, motion) or in `vizkit` for chart math; a helper
  two families need never lives in one of them.

## Rules

- Edit only the files your brief lists. Exception: you may append new icon paths to `ICONS` in `src/lib/icons.tsx` (re-read the file right before editing; keep the edit to the map). If you need any other change in a file you don't own, put a minimal local version in your own module and mention it in your report.
- Import siblings explicitly: `import { Button, cn, spring } from './core'`, never from another barrel (`./forms`, `./diagrams`). Showcase files import core from `'../lib'`, extras from `'../lib/<module>'`, and `'./kit'`.
- No new npm dependencies. Everything is React + `motion/react` + Tailwind.
- Do not run `pnpm build`, do not commit, do not restart the dev server.

## Style (match what's there)

- Colours only through tokens: `bg-[var(--card)]`, `text-[var(--fg2)]`, `border-[var(--line)]`, `var(--accent)`, `var(--ok|warn|bad)` and their `-soft` tints, `var(--c1..c4)` for chart series. Never hard-code a colour that only works in one theme. Radius, type and heights: see Scales below. Fonts: `var(--font)`, `var(--mono)`.
- **Scales.** Pick from these; anything else is token debt.
  - Radius: `rounded-[var(--r-sm)]` (theme radius ÷ 2, 4px by default: kbd, chips in fields, checkboxes, thin inner shapes), `rounded-[var(--r-md)]` (the theme radius, 8px: buttons, fields, menu rows, tiles), `rounded-[var(--r-lg)]` (≈1.6× + 1, 14px: cards, popovers, dialogs, sheets, toasts), `rounded-full` / `rounded-[var(--r-full)]` (pills, badges, avatars, dots, thin bars). Nested shapes may use `calc(var(--r-md)-2px)`. Not: `rounded`, `rounded-sm/md/lg/xl/2xl`, `rounded-[3px|5px|7px|9px|10px|12px]`.
  - Type (`--t-*`): 11px `text-[11px]` (xs: meta, captions, counts) · 12px `text-xs` (sm: secondary text, badges, small buttons) · 13px `text-[13px]` (md: control and component body text) · 14px `text-sm` (base: prose) · 16px `text-base` (lg: titles, dialog headings, touch inputs) · 22px `text-[22px]` (xl: stat values, OTP digits) · 28px `text-[28px]` (2xl: display/KPI). Chart tick labels may be 10px. Not: 10/11.5/12.5/15/17/18/20/24/36px, `text-lg/xl/2xl/4xl`.
  - Control heights (`--h-*`): 24 `h-6` (xs) · 30 `h-[30px]` (sm) · 36 `h-9` (md: buttons, every field and trigger) · 40 `h-10` (lg); icon buttons 24/28/36 (`icon-xs`/`icon-sm`/`icon`); list and nav rows 32 (`h-8`). On touch, xs/sm grow to 32. Use `Button`/`IconButton` `size` (`xs | sm | md | lg | icon-xs | icon-sm | icon`) rather than your own heights.
  - Badges: `Badge` is the one pill primitive, `size="sm"` (18px, 11px text: counts, deltas, dense rows) or `"md"` (20px, 12px text, default). Don't hand-roll pill spans.
  - Hover: fields and field triggers get `fieldHoverClass` (border → `--line2`; already in `inputClass`/`inputShellClass`), rows/accordion triggers get `rowHoverClass` (muted background).
  - Tiny controls (a chip's ×): add `ui-target` (`TOUCH.target`) for an invisible ≥24×24 hit area on desktop and 36 on touch.
  - Copy actions: use `CopyButton` (icon + label turn into "Copied" for 1.5 s, announced politely); don't build your own.
  - Infinite CSS animations (spinners, shimmer, carets) pause off screen: `Spinner`, `Skeleton` and `StatusIcon` do it themselves; elsewhere set `animation-play-state` (or `--ui-play` for `.ui-shimmer`/`.ui-caret`) from `useViewport().visible`.
  - Chart neutral series: `var(--c-neutral)` (≥4.5:1 on cards in every theme, light and dark), never `--fg`.
- Tailwind class strings must be literal (no `bg-[var(--${x})]`); pick from maps of full class strings.
- No tailwind-merge: to override a class a component already sets, use the `!` prefix (`className="!h-8"`).
- Animation: `motion/react` with `spring(bounce, duration)` from core. Use `initial={false}` where mount animation isn't wanted. Keyframe arrays that must replay on every change need a changing `key` (or `useAnimate`), because the same array on re-render does nothing. `MotionConfig reducedMotion="user"` already wraps everything.
- Reuse the shared pieces before writing new ones: `Button`, `IconButton`, `Badge`, `Card`, `Avatar`, `AnimatedNumber` (rolling digits), `ActiveIndicator` (sliding pill/underline via layoutId), `Popover`/`FloatingPanel`/`DropdownMenu`/`MenuItem`, `ModalLayer`/`Dialog`/`Sheet`, `Collapse`, `Select`/`Combobox`/`OptionList`, `Tooltip`, `HoverCard`, `useToast` (supports `action` for Undo), `useControllable`, `useDisclosure`, `useRoving`, `useListbox`, `useHotkey`, `useWidth`, `useActiveIndex`, `useStatusFlash`, `useLive`, `useResizeObserver`, `useRequiredContext`, `PartButton`, `gridKeyMove`/`focusStep`, `downloadBlob`, `writeClipboard`, `Legend`, `EmptyState size="sm"`, `svgN`, `useWheelZoom`/`usePinchPan`, `Chart` kit (`useChartShell` + `ChartShell`, chart math, `niceStep` and `TrackGrid` in `vizkit.tsx`), `confetti()`.
- Components: typed props, `className` passthrough, controlled (`value`/`onChange`) or uncontrolled (`defaultValue`) where it's an input, keyboard support and ARIA roles, touch support for anything draggable (pointer events + `touch-none`), a one-line JSDoc on each export saying what it is and how it behaves.
- Demos in the showcase use `<Spec title desc span>` inside `<Section>`. Use realistic content from the original. Every interactive demo should work, not just render.

## Verify before you report

1. Type-check your files: `cd /home/user/ui-library && pnpm exec tsc -b 2>&1 | grep -E "src/(lib|showcase)/(YOUR_FILES)"` (other helpers' in-progress errors may appear; ignore those, fix yours).
2. The dev server is already running at http://localhost:5173 with hot reload. Use Playwright (`require('playwright')`, `chromium.launch()`) to load it, scroll to your section (`#id`), screenshot it in light and dark (`document.documentElement` gets `data-theme` from the theme menu, or set `localStorage['ui-theme']='{"mode":"dark"}'` then reload), and exercise the interactions you built. Check there are no console errors from your code. Put screenshots in `/tmp/claude-0/-home-user/1f4f4ae9-b860-5799-9be6-05073139d048/scratchpad/` (make a subfolder for your area).
3. Report: what you built or fixed (by GAPS.md row), what you left and why, the files you touched, and anything you needed in a file you don't own.

## Formatting

- UI text is English, written inline where it is used (a small local `const TEXT = {…}` only when one string is reused).
  Text a person might want to change is a prop with an English default (`label = 'Loading'`). Counts go through
  `plural(n, 'file')`, extents through `rangeStr(values, format)`.
- Numbers and dates use the one fixed English formatter set `fmt` from `locale.tsx` (cached `Intl`): `fmt.number`,
  `compact`, `money`, `percent`, `bytes`, `duration`, `date`, `time`, `relative`, `list`… Never `toLocaleString()` or a new
  `Intl.*` per render. Weeks start on Monday; date controls take `hourCycle` and `timeZone` props.

## Review checklist

- **Comments:** a one-line summary, the contract and the keyboard model. No section banners, version tags, history
  ("as in 0.2", "the original page") or measurement anecdotes; no README text repeated in JSDoc.
- **Helpers:** check the inventory in Rules → "Reuse the shared pieces" before writing one; a pattern seen three times
  becomes a shared helper and the copies go.
- **Control flow:** guard clauses over nested ifs; lookup tables over ternary chains; parse a value once.
- **Size:** a component's file reads top to bottom; split a render into small named pieces before it passes a screen.
- **Types:** no `as unknown as`, no casts a generic would remove, no redundant `as string`.
- **Plumbing creep:** no prop threaded through three levels to reach one leaf; no context for one consumer.
- **Drop-in model:** a component must work as a registry file next to `ui-provider.tsx`; shared state goes through
  `uiShared`, not module globals.
- **Naming:** top-level names are unique across `src/lib` (area prefix for internals), and say what the thing is.

## Large refactors

Work from a scratch `REFACTOR_MAP.md` at the repo root (never committed): the files in batches of 3–5 in dependency
order (shared modules first), a checkbox per batch with before/after line counts, and a "Shared Utilities Inventory" of
every helper in helpers/hooks/core (existing and new) so no duplicate gets invented. Add new helpers next to the old ones
and keep the old API as a shim until every caller is migrated, so `pnpm exec tsc -b` and the batch's unit tests pass
after each batch. Delete the shims and the map at the end, then run the full verification.

## Mobile (phones and touch)

Test with Playwright device emulation: `devices['iPhone 13']` (390px, touch) and a 360px-wide touch context
(`{ viewport: { width: 360, height: 740 }, hasTouch: true, isMobile: true }`), plus one landscape check.

- **Tap targets:** every control a finger uses is at least 32×32px on touch screens (44 for primary actions). Keep the
  desktop look and grow the hit area on coarse pointers with the arbitrary variant
  `[@media(pointer:coarse)]:min-h-10` (works in Tailwind v3.2+ and v4), or an invisible `before:` hit area.
- **Nothing hover-only:** anything shown on hover (tooltips, hover cards, chart tooltips, row actions, reveal-on-hover
  buttons) must also work by tap or focus, and dismiss on outside tap. Long-press is fine as a secondary path.
- **Layout:** multi-pane UIs stack or turn into tabs/slide-overs below ~640px; toolbars wrap or scroll in their own
  row; wide things (tables, timelines, boards, diagrams) scroll inside their card with sticky labels where that helps
  and a visible hint that they scroll. The page itself never scrolls sideways.
- **Text:** at least 11px for anything people read (chart tick labels may be 10px). Don't truncate the only label of
  something; wrap or abbreviate.
- **Overlays:** dialogs, sheets, popovers and menus fit the viewport (sheets become bottom sheets on phones, popovers
  clamp to the screen edges), respect safe areas, and keep inputs ≥ 16px so iOS doesn't zoom on focus.
- **Gestures:** drags use pointer events with `touch-action` set so vertical page scrolling still works outside the
  drag handle; pinch/scroll-zoom areas don't trap page scroll.

## Testing

- **Unit and interaction tests** (`tests/unit/*.test.ts(x)`, Vitest + Testing Library + jsdom): `pnpm test`, or
  `pnpm test:watch`. Import from `src/lib`. Query by role and accessible name (`getByRole('tab', { name: 'Billing' })`),
  never by class names, so styling changes don't break tests. jsdom has no layout: `tests/setup.ts` stubs
  `matchMedia` (reduced motion on), `ResizeObserver`, `IntersectionObserver`, `innerText` and `execCommand`.
- **E2E** (`tests/e2e`, Playwright, Chromium): `pnpm test:e2e` builds the showcase and serves it with `vite preview`;
  `E2E_BASE_URL=http://localhost:5173 pnpm test:e2e` uses the dev server instead (a test that sees a hot reload
  skips itself). Every section on desktop light, desktop dark and iPhone 13 must log no console errors, stay inside
  its layout-shift budget, add no axe violations beyond the baseline, and (phone) not make the page scroll sideways.
  `--project desktop-light` or `-g "section charts"` narrows a run (it also matches the Design QA test of that section).
- **axe baseline:** `tests/e2e/axe-baseline.json` holds today's known violations (profile → section → rule → node
  count). A test fails only on a new rule or a higher count. After fixing violations run
  `pnpm test:e2e:update-baseline` (accepts the same filters) and commit the smaller file; never raise a count to make
  a new violation pass.
- **Budgets:** `tests/e2e/budgets.ts`: the CLS budget (0.05 per section), per-section overrides with a reason, and
  tolerated console errors. Remove an override when the fix lands.
- **Whole-page CLS** (`tests/e2e/page-cls.spec.ts`): the page is loaded and scrolled top to bottom without stopping on
  desktop and on iPhone 13 at 4× CPU, where cards come on screen before their demos mount; total CLS must stay under
  0.05. A card shows a placeholder of its demo's measured height until the demo mounts (`src/showcase/cardHeights.ts`):
  after changing how tall a demo is, rerun `node scripts/card-heights.mjs [url]` against the dev server or a preview.
  Demos that load something after mounting (generated images, a synthesised track) render a skeleton of the final
  size, and card fades stay opacity-only (a transform on the scroll anchor's ancestors turns scroll anchoring off).
- **Run Design QA before shipping a change** to a component or a showcase card. On the page: ⇧D (or the ruler button),
  then Run audit, on desktop and in the browser's iPhone emulation. Red groups (misalignment, clipped content, low
  contrast) are bugs; amber and orange ones (off-grid spacing, one-off sizes) are worth a look. As a test,
  `pnpm test:e2e design-qa` (`tests/e2e/design-qa.spec.ts`) runs the audit per section on desktop-light and iphone-13. It fails on a red finding beyond `tests/e2e/design-qa-baseline.json` (profile → section → rule →
  count) or on a CLS meter rated Poor. Add `E2E_BASE_URL=http://localhost:5173` to use the dev server, and
  `--project iphone-13` or `-g "design qa: section forms"` to narrow the run. CI runs it as part of `pnpm test:e2e`.
  `pnpm test:e2e:update-baseline design-qa` rewrites the baseline; run it only after a fix, never to let a new
  finding pass. If a finding is the tool's mistake, fix the rule in `src/showcase/DesignQA.tsx` with a comment
  saying why. Scripts can call `window.__designQA.audit('forms')`.
- **Before a PR:** `pnpm check` (types, tests' types, build, single files, SSR, unit tests), `pnpm test:pack` after a
  build, and `pnpm test:e2e` (which includes Design QA). CI runs the same (README, "CI").
