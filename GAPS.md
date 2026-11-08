# Gap table: React port vs the original UI library page

Source of truth: the "UI library" artifact (936 KB HTML). Status after round 1 (nine builders) and the round-2 audit
(three reviewers comparing every card side by side in the browser and in code).

## Where things stand

| | Round 0 (first audit) | After round 1 | After round 2 |
|---|---|---|---|
| Done | 45 | all but 22 | **all** |
| Partial | 60 | 20 | 0 |
| Missing | 43 | 2 | 0 |
| Needs a demo | 9 | 0 | 0 |

All 148 original component cards exist in the port, plus the page features (theme panel with variants and custom
colours, circular theme reveal, side-nav filter and subnav, mobile nav, command palette, shortcuts, view-code drawer,
Design QA tool). Verified in a full-page browser pass: 16 sections, no console errors or warnings in light or dark,
no sideways scroll at 390px, nothing animating off screen, and every text element at WCAG AA contrast in both themes.

### Closed in round 2

- **Page tools:** view-code drawer (complete copy-pasteable component per card), Design QA (audit, measure, grid,
  outlines, CLS), palette "Open modal" / "Open drawer", consistent `?` shortcut, hover-card nesting fix.
- **Library:** Kanban PR checks and metric sparkline, data grid uses the library `Select`, highlighted split-pane
  editor, F2 renames folders, scheduler titles wrap, `StatGrid` (4 → 2×2 → 1), popover focus management, single
  `<main>` landmark, responsive network graph, histogram label spacing, MRR chart axis, off-screen work paused.
- **Contrast:** badge/tint text, code tokens, treemap tiles and white-on-accent fills now clear 4.5:1 in light and dark.

### Known small leftovers (by choice)

- Week view at 390px: columns are ~35px, so event titles truncate (day view is readable on phones).
- Typing dots in chat animate briefly even if scrolled away mid-reply.
- Swiss currency separator shows `'` rather than `’` (comes from the browser's locale data).

## Deliberate differences (not gaps)

- Charts are one SVG kit (`Chart`, `DonutChart`, `ScatterChart`, …) instead of Chart.js; diagrams and maps sit in their own "Diagrams & maps" section.
- The port adds extras the original lacks: CVC check and amount on the Pay button, inbox shared-files list, theme reveal on every theme change, Copy CSS toast.
- Small demo-content differences: profile follower count (12.9k so the rolling count visibly changes), sortable table uses invoices.

## How it's built

`src/lib/*.tsx` (library, one module per area) → `pnpm build` produces the npm package (`dist/`: ESM, types, `styles.css`)
and drop-in single files (`dist-single/`: `ui.tsx` foundation, `ui-content.tsx`, `ui-charts.tsx`, `ui-ai.tsx` add-ons,
`ui-all.tsx`, `ui-with-examples.tsx`). `src/showcase/*.tsx` is the demo page.
