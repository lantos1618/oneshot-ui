# Changelog

All notable changes to `@lyndon/ui`. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/);
versions follow [semver](https://semver.org/) (while on 0.x, a minor version may break APIs).

## [0.2.1]

### Added
- **Agent transit map:** per-station queues along the incoming lines ("+n"), congestion heat on each track segment
  (grey → amber → red), and an event-queue panel at Intake with job-slot dots and the drop count. Tokens travel
  along the drawn line geometry, bends included (they jump instead under reduced motion).
- **Spawn connectors:** TraceWaterfall draws elbow lines from a parent span to each child at its start time, with
  the hovered chain highlighted; the transit trace table links follow-up jobs to their trigger (dashed while
  queued); Gantt draws phase → task connectors.
- `WorkflowEngine` claims an agent when a token arrives, so queues are real, and exposes `occupancy()`.
- **Tests and CI:** Vitest + Testing Library unit and interaction tests (security helpers, theme storage and
  contrast, highlighter and diff caps, formatting, Dialog, Tabs, SegmentedControl, Combobox, CopyButton, Toast,
  DataGrid, RichTextEditor); a Playwright suite over every showcase section on desktop light, desktop dark and
  iPhone 13 (console errors, axe against a baseline, layout-shift budgets, no sideways scroll on phones); GitHub
  Actions for CI, CodeQL (security-extended), Dependabot and a manual npm release with provenance; a pack check.
  See "Testing" in CONVENTIONS.md.

### Fixed
- Agent transit map: the "needs approval" panel no longer shifts the layout. Approvals float over the map next to
  the waiting station with a countdown ring and a count bubble; the trace rows and queue strip stay put
  (195 layout shifts, score 0.045 over 25 s → 0).
- `pnpm install --frozen-lockfile` no longer fails on pnpm 10+ because of unapproved build scripts: esbuild's and
  @parcel/watcher's install scripts are declined in `pnpm-workspace.yaml` (both ship prebuilt binaries).

### Changed
- **Polish pass** (GAP-ANALYSIS.md section 1, measured in the showcase):
  - Layout shift: whole-page CLS while scrolling 0.188 → 0.001 on desktop and 0.209 → 0.007 on iPhone. The sidebar
    section list no longer moves; Masonry reserves image ratios; Thinking steps keeps one-line rows with a
    fixed detail panel; streaming demos (chat, model comparison, terminal) reserve their final height; toasts,
    treemap, funnel and before/after animate with transforms; the combobox no longer flips while typing.
  - Performance: Data flow 1,585 → 3 layouts/s (particles on one canvas with sampled paths); Network graph and
    map pulses stop when hidden or settled; SparkChart and AnimatedNumber use CSS transitions (Sparklines card
    9,871 → 287 mutations per 4 s); spinners, carets and shimmers pause off screen; charts mount one at a time.
  - Keyboard: every chart is one Tab stop with arrow-key navigation, tooltip on focus and a data summary
    (`useChartFocus`); mega menu roving focus; scheduler events move with arrows and keep focus; data grid filter
    bar is one toolbar with a "Jump to rows" shortcut; showcase chrome Tab stops per card 4.9 → 2.1.
  - Accessibility: axe on the whole page 113 → 0 (light) and 107 → 0 (dark) on desktop; primary, accent, ok, bad
    and warn colours reach 4.5:1 in every built-in and custom palette (`derive()`); SegmentedControl is a
    radiogroup; AnimatedNumber exposes one text value.
  - Consistency: radius, type and control-height scales (`--r-*`, `--t-*`, `--h-*`), `--c-neutral` chart token,
    Button `xs`, Badge `size`, one CopyButton with "Copied" feedback, field hover states, UK spelling.
  - Showcase: demos open mid-flow, input state rows, open-state previews for overlays, always-visible code button
    with a Props tab, Kbd shortcut chips, grid rows without holes, Design QA groups CLS by source and accounts for
    opacity in contrast.
- **Sample content is no longer a default:** RichTextEditor, AICanvas, VoiceInput and MentionsInput start empty;
  the samples are exported (`RTE_SAMPLE`, `AI_CANVAS_SAMPLE`, `MENTION_PEOPLE`, `MENTION_COMMANDS`).
- ThinkingSteps `autoCollapse` defaults to false; SegmentedControl uses `role=radio` instead of `aria-pressed`.

### Added (polish)
- Props: AssistantChat `defaultTurns`, ModelComparison `autoRun`, MegaMenu `defaultOpen`/`open`/`onOpenChange`,
  AICanvas `respond`, RichTextEditor `placeholder`, TreeView `compact`, SplitPane `stackBelow`, Chart `xFormat`/
  `summary`/`label`, FloatingPanel `flip="scroll"`, CopyButton `copiedLabel`/`duration`, ProgressRing and
  SegmentedControl `aria-label`.
- Exports: `CHART_NEUTRAL`, `useChartFocus`, `BADGE_SIZE`, `fieldHoverClass`, `rowHoverClass`, `TOUCH.target`.

## [0.2.0]

### Added
- Touch and phone support across every component: tap targets of at least 32 px, nothing hover-only, sheets that
  become bottom sheets, pointer-event gestures that leave page scrolling alone.
- About 40 shared primitives in place of duplicated code (popovers, option lists, roving focus, disclosure,
  scroll edges and more) and one workflow engine behind the agent and pipeline demos.
- Packaging: `"use client"` modules, SSR-safe theming with `ThemeScript`, React 19 peers, per-area entry points
  (`@lyndon/ui/forms`, `/charts`, `/ai` …), NodeNext-compatible types, CSS without Preflight plus a separate
  `preflight.css` and `tokens.css`, and a README.
- Security: a sanitised `RichTextEditor` (one allowlist for `defaultValue`, drops and `onChange`), a linear-time
  code highlighter with a per-line cap, a network-locked AI preview (CSP in every srcdoc), approvals that gate on
  the host, validated theme storage under a versioned key (`ui-theme:v1`, migrated from `ui-theme`), CSP nonce
  support, opt-in Google Fonts, `safeUrl` / `safeMediaUrl` / `cssUrl` / `safeCssValue` / `safeColor`, size caps
  for diffs and searches, SECURITY.md, and checksummed single-file builds (`dist-single/SHA256SUMS`).

### Fixed
- 36 bugs from the 0.1 review (see `review/bugs.md`).

## [0.1.0]

- Initial release candidate: theme system with a circular reveal, 150+ components across inputs, forms,
  navigation, feedback, overlays, data (grid, scheduler, kanban), charts and diagrams, maps, media, code and AI
  patterns; drop-in single-file builds for AI tools.
