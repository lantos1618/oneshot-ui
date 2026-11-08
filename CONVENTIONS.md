# Working on the UI library

## Layout

- `src/lib/*.tsx`: the library, one module per area; `src/lib/index.ts` re-exports all of them (don't edit it; new modules are already registered).
- `src/showcase/*.tsx`: the demo page, one file per section (`XSection`), plus `kit.tsx` (Spec, Section, Row, SECTIONS) and `index.tsx` (page shell).
- `scripts/build-single.mjs` generates `dist-single/ui.tsx` (one drop-in file) from the modules. Because of that, **every top-level name must be unique across all of `src/lib` and `src/showcase`**. Prefix internal helpers with your area if in doubt (e.g. `gridSort`, not `sort`).
- The original page (source of truth for behaviour and details): `/root/.claude/projects/-home-user/1f4f4ae9-b860-5799-9be6-05073139d048/tool-results/artifact-42e1bc7a-1794118152-42d9.html`. CSS lines 1–2030, component markup ~2040–2345 (`<h3>` per component), JS after ~2400 (often `run('name', …)` blocks). Some lines are huge data blobs (~3302 world map, ~4404 globe): read with offset/limit or grep, never whole. You may copy its data (map paths, palettes, sample content) into the port.
- `GAPS.md`: what's missing, per component. Work through the rows in your scope.

## Rules

- Edit only the files your brief lists. Exception: you may append new icon paths to `ICONS` in `src/lib/core.tsx` (re-read the file right before editing; keep the edit to the map). If you need any other change in a file you don't own, put a minimal local version in your own module and mention it in your report.
- Import siblings explicitly: `import { Button, cn, spring } from './core'`. Showcase files import from `'../lib'` and `'./kit'`.
- No new npm dependencies. Everything is React + `motion/react` + Tailwind.
- Do not run `pnpm build`, do not commit, do not restart the dev server.

## Style (match what's there)

- Colours only through tokens: `bg-[var(--card)]`, `text-[var(--fg2)]`, `border-[var(--line)]`, `var(--accent)`, `var(--ok|warn|bad)` and their `-soft` tints, `var(--c1..c4)` for chart series. Never hard-code a colour that only works in one theme. Radius: `rounded-[var(--r-md)]` / `rounded-[var(--r-lg)]`. Fonts: `var(--font)`, `var(--mono)`.
- Tailwind class strings must be literal (no `bg-[var(--${x})]`); pick from maps of full class strings.
- No tailwind-merge: to override a class a component already sets, use the `!` prefix (`className="!h-8"`).
- Animation: `motion/react` with `spring(bounce, duration)` from core. Use `initial={false}` where mount animation isn't wanted. Keyframe arrays that must replay on every change need a changing `key` (or `useAnimate`), because the same array on re-render does nothing. `MotionConfig reducedMotion="user"` already wraps everything.
- Reuse the shared pieces before writing new ones: `Button`, `IconButton`, `Badge`, `Card`, `Avatar`, `AnimatedNumber` (rolling digits), `ActiveIndicator` (sliding pill/underline via layoutId), `Popover`/`FloatingPanel`/`DropdownMenu`/`MenuItem`, `ModalLayer`/`Dialog`/`Sheet`, `Collapse`, `Select`/`Combobox`/`OptionList`, `Tooltip`, `HoverCard`, `useToast` (supports `action` for Undo), `useControllable`, `useDisclosure`, `useRoving`, `useHotkey`, `useWidth`, `Chart` kit, `confetti()`.
- Components: typed props, `className` passthrough, controlled (`value`/`onChange`) or uncontrolled (`defaultValue`) where it's an input, keyboard support and ARIA roles, touch support for anything draggable (pointer events + `touch-none`), a one-line JSDoc on each export saying what it is and how it behaves.
- Demos in the showcase use `<Spec title desc span>` inside `<Section>`. Use realistic content from the original. Every interactive demo should work, not just render.

## Verify before you report

1. Type-check your files: `cd /home/user/ui-library && pnpm exec tsc -b 2>&1 | grep -E "src/(lib|showcase)/(YOUR_FILES)"` (other helpers' in-progress errors may appear; ignore those, fix yours).
2. The dev server is already running at http://localhost:5173 with hot reload. Use Playwright (`require('playwright')`, `chromium.launch()`) to load it, scroll to your section (`#id`), screenshot it in light and dark (`document.documentElement` gets `data-theme` from the theme menu, or set `localStorage['ui-theme']='{"mode":"dark"}'` then reload), and exercise the interactions you built. Check there are no console errors from your code. Put screenshots in `/tmp/claude-0/-home-user/1f4f4ae9-b860-5799-9be6-05073139d048/scratchpad/` (make a subfolder for your area).
3. Report: what you built or fixed (by GAPS.md row), what you left and why, the files you touched, and anything you needed in a file you don't own.

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
