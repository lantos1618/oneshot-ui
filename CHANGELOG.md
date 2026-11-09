# Changelog

All notable changes to `@lyndon/ui`. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/);
versions follow [semver](https://semver.org/) (while on 0.x, a minor version may break APIs).

## [0.5.0]

Tags over time, magnets, and fixes from review.

### Added
- **Chart annotations** (`@lyndon/ui/annotate`): `Chart` takes `annotations` (`TimeTag[]` with kinds) drawn as pins,
  an icon rug, flags, shaded bands, rolled-up counts or dots; `style: 'auto'` switches pins → rug → rollup by
  measured density at the current width; `reserve: 'current' | 'max'`; linking via `activeId`/`onActiveChange`;
  keyboard tag list. `xTime` time axis with locale-formatted round ticks. Helpers: `layoutTimeTags`, `timeTicks`,
  `useTagFocus`, `TagGlyph`, `TagTooltip`, `timeTagBadge`.
- **Timelines** (`@lyndon/ui/timeline`): `Swimlanes`, `StateRibbon` (with `compact` size), `TagJournal`
  (virtualised) and `ChartWithJournal` (two-way linked hover, focus and selection); `TraceWaterfall` takes
  `annotations` (deploys, approvals) as flags or a rug.
- **Magnets** (`@lyndon/ui/magnet`): point and zone magnets with hysteresis, flick pass-through, Alt/two-finger
  bypass, haptics, spring settle and announcements, on `Slider`, `RangeSlider`, `ColorPicker` (`hueMagnets`),
  `SplitPane`, media seek bars (`chapters`) and `Gantt` task drag; `useMagnet` and `magnetize` for custom drags.
- **TreeView `lines`** (`true | 'hover'`): Reddit-style thread lines; click a line to collapse its branch.
- `OfflineIndicator` `paused`; Slider `valueText`; showcase cards show "Good at / Breaks when" notes and a
  Light day / Busy day switch for the timeline demos (sample data in `@lyndon/ui/examples`: `tagsDay`).

### Fixed
- DataGrid: pinned columns left a blank strip (or overlapped) on narrow screens because the table's automatic width
  overrode `table-layout: fixed`; the table width is now the sum of its columns, so sticky offsets match.
- OfflineIndicator no longer flashes on each retry, jumps when switching to "Back online", or announces the countdown
  every second; one bar changes in place.
- Hover in self-scrolling linked lists no longer steals the active item while navigating by keyboard.

### Changed
- `OfflineIndicator` reads new message keys (`feedback.offlineSaved`, `feedback.retryIn`, `feedback.retrying`,
  `feedback.offlineSaid`) instead of `status.offline`; override those to change its text.
- Drop-ins that gained features are larger: `chart` ~62 → 92 KB, `slider` ~44 → 79 KB, `trace-waterfall` ~64 → 86 KB
  (annotation and magnet code is included even when unused).

## [0.4.0]

### Breaking

Sample data, demo helpers and page blocks left the stable API (GAP-ANALYSIS "Cut or simplify"). Sample data and demo
helpers moved to a new entry, `@lyndon/ui/examples` (not covered by semver: it may change in any release). Page blocks
became copy-in registry blocks (`registry:block`), no longer exported by the package. Migration:

| Before (0.3) | Now (0.4) |
| --- | --- |
| `import { AI_CANVAS_SAMPLE } from '@lyndon/ui'` (or `/aiagent`) | `import { AI_CANVAS_SAMPLE } from '@lyndon/ui/examples'` |
| `import { AGENT_WORKFLOWS, AGENT_WORKFLOW_ORDER } from '@lyndon/ui'` (or `/diagrams`) | `… from '@lyndon/ui/examples'` |
| `<StateMachine />`, `<AgentTransitMap />` ran the sample workflows by default | pass them: `<StateMachine machines={AGENT_WORKFLOWS} order={AGENT_WORKFLOW_ORDER} />` (without `machines` both render empty, at full size) |
| `import { mediaArt, mediaImage, mediaSynthTrack, mediaRecordVideo, type MediaArtKind } from '@lyndon/ui'` (or `/media`) | `… from '@lyndon/ui/examples'` |
| `import { describeSample } from '@lyndon/ui'` (or `/charts`) | `import { describeSample } from '@lyndon/ui/examples'` |
| `import { MotionPlayground } from '@lyndon/ui'` or `'@lyndon/ui/playground'` | `import { MotionPlayground } from '@lyndon/ui/examples'` (the `./playground` subpath is gone) |
| `import { WORLD_MAP } from '@lyndon/ui'` (or `/geo`) | `import { WORLD_MAP } from '@lyndon/ui/geoworld'`, or `await loadWorldMap()` / `useWorldMap()` from `@lyndon/ui` |
| `import { GLOBE_LAND } from '@lyndon/ui'` (or `/geo`) | `import { GLOBE_LAND } from '@lyndon/ui/geoland'`, or `await loadGlobeLand()` |
| `import { PricingTable, type Plan } from '@lyndon/ui'` (or `/pages`) | registry block `pricing-table` (copy it in from the registry, then import it from your copy) |
| `import { Checkout, type CheckoutItem, type CheckoutDetails } from '@lyndon/ui'` | registry block `checkout` |
| `import { ProfileCard } from '@lyndon/ui'` | registry block `profile-card` |
| `import { OnboardingChecklist, type OnboardingTask } from '@lyndon/ui'` | registry block `onboarding-checklist` |
| `import { CookieConsent, type CookieCategory, type CookieChoice } from '@lyndon/ui'` (or `/feedback`) | registry block `cookie-consent` |

More breaking changes in 0.4:

| Before (0.3) | Now (0.4) |
| --- | --- |
| `RTE_SAMPLE`, `MENTION_PEOPLE`, `MENTION_COMMANDS` from `@lyndon/ui` / `/editor` | `@lyndon/ui/examples` (removed from the main entry, not just deprecated) |
| `PAGE_CSS` from `@lyndon/ui` / `/utils` | `@lyndon/ui/examples` |
| `PhoneFrame` from `@lyndon/ui` / `/navigation` | `@lyndon/ui/examples` |
| `AvatarGroup` (deprecated) | `AvatarStack` with `spread={false}` |
| `InlineDatePicker` from `/data` | `/pickers`, `/forms` or `@lyndon/ui` (typed fields are now a locale-ordered `DateField`) |
| UIProvider rendered a `ToastProvider` | `useToast()` without a provider uses one page-wide queue (mounted on the first toast); an explicit `<ToastProvider>` keeps its own |
| Chat message text: Markdown with highlighted code fences | Markdown with plain code fences; pass `renderers={AI_RICH_RENDERERS}` (or `<AiRenderersProvider>`) for highlighting and JsonViewer |
| `ShortcutOverlay` | `<ShortcutSheet variant="dialog">` (`ShortcutOverlay` is a deprecated alias) |
| DataGrid `onPinnedColumnsChange` reported `{ left, right }` | reports `{ start, end, left, right }`; sticky cells use `inset-inline-start/end`; prefer `defaultPinnedColumns={{ start, end }}` |
| `Sheet` defaulted to `side="right"` | defaults to `side="end"` (still the right edge in LTR); `start`/`end` added |
| Scheduler weeks started on Monday everywhere | weeks start on the locale's first day (`en-US`: Sunday); hour labels follow the locale's clock |
| DataGrid pager landmark "Pagination" | named "{grid label}: pages"; `Pagination` takes `aria-label` |

Deprecated (still exported, removed in 0.5):

| Deprecated | Use |
| --- | --- |
| `ChatSources({ items: [{ name, desc, color, href }] })` | `SourceList({ sources: [{ title, domain, color, url }] })` |
| `type SourceCard` | `type Source` (one model for Citation, SourceList and SourcesPanel) |

### Added
- **Internationalisation and RTL.** `UIProvider` takes `locale`, `dir` (`auto` from the locale), `timeZone`,
  `weekStartsOn`, `hourCycle` and `messages`; `useLocale()` gives `{ locale, dir, t, fmt, … }`; every module's
  strings go through per-module catalogues (`defineMessages` / `useMessages`) with English plus machine-drafted
  German and Arabic (`UI_MESSAGES_DE`, `UI_MESSAGES_AR`, module `*_MESSAGES`; review before shipping them).
  Numbers, dates and relative times follow the locale (Arabic-Indic digits in `ar-EG`). Every component is laid out
  with logical CSS and mirrors in RTL; arrow keys follow the reading direction (`logicalArrow`), motion offsets use
  `dirX`, directional icons flip (`.ui-flip`). Plots, timelines, media seek bars, code and diagrams stay left to
  right by convention (see CONVENTIONS.md). Tooling: `scripts/i18n-extract.mjs`, `scripts/rtl-lint.mjs`; e2e gains
  `desktop-rtl` and `iphone-rtl` profiles.
- **Composable parts and `asChild`.** `Slot` and `asChild` (Button, IconButton, every Trigger); part APIs for Tabs
  (vertical, overflow scrolling, lazy panels), Dialog, Sheet, AlertDialog, Popover, Tooltip, HoverCard,
  DropdownMenu and ContextMenu (checkbox and radio items, submenus, typeahead), Accordion; new Toggle, ToggleGroup
  and Toolbar. The config APIs are built on the parts and keep working.
- **Dates and times.** Calendar `min`/`max`/`isDateUnavailable`/`weekStartsOn`/`locale`/`numberOfMonths` and a
  month/year quick picker (APG date grid); new `DateField`, `TimeField`, `DateTimeField`, `DateTimePicker` (IANA
  time zones, ISO 8601 with offset, DST rules documented), `MonthPicker`, `YearPicker`, `TimeZonePicker`; range
  presets; async `MultiSelect` (`loadOptions`, creatable, groups).
- **Drop-in files, registry, CLI and docs.** One self-contained `.tsx` per component (about 200, median ~11k
  tokens) built from the dependency graph; a shadcn-compatible registry (`r/<name>.json`, blocks as
  `registry:block`); `npx @lyndon/ui add|list|info` (offline, safe paths); a docs site with live demos and props
  tables generated from the types, deployed to GitHub Pages; `llms.txt` and `llms-full.txt`. Module state and
  contexts are shared across drop-in files (`uiShared`); each file embeds only the icons it draws.
- **Module splits.** `core` is a barrel over `helpers`, `theme`, `locale`, `hooks`, `icons`, `primitives`, `slot`,
  `safe`, `formcontrol`, `shared`; `forms` over `fields`, `inputs`, `select`, `pickers`, `upload`; each is its
  own subpath.

### Changed
- **Diagrams split** into `@lyndon/ui/gantt` (Gantt), `/statechart` (Statechart, StateDiagram, WorkflowEngine,
  StateMachine, `useStatechart`), `/trace` (TraceWaterfall) and `/network` (Sankey, NetworkGraph, ProcessFlow,
  DataFlow). `@lyndon/ui/diagrams` still re-exports all four.
- **Statecharts:** one renderer (`Statechart`) and one hook (`useStatechart`: travelling dots, on-screen state, reduced
  motion, repaint) under both presets; `StateDiagram` (UML) and `StateMachine` (live WorkflowEngine) are thin layers
  over them, with the same visuals, keyboard and ARIA.
- **Geo map data loads lazily:** WorldMap's country outlines (67 KB) and Globe's land points (24 KB) are separate
  modules inside the package, loaded with `import()` on first render (no network fetch). Until then WorldMap shows a
  placeholder of the map's exact size (also what the server renders), so nothing shifts. `WorldMap` takes `map`
  and `Globe` takes `land` to supply the data yourself. New: `loadWorldMap`, `loadGlobeLand`, `useWorldMap`,
  `type WorldMapData`.
- **Sources:** one `Source` model (`title`, `url?`, `domain?`, `snippet?`, `letter?`, `color?`) for `Citation`,
  the new `SourceList` (chips) and `SourcesPanel`; `sourceDomain(source)` gives the label they show.
- **AgentComposer is built on PromptInput** (as ChatComposer already was). PromptInput gained the hooks it needed:
  `attachmentState` (own the files with `useAttachments`; `type AttachmentState`), `header`, `addButton`, `aside`,
  `sendButton` + `canSubmit`, `inputRef`, `barRef`, `dropHint`, `uploadProgress`, `layout`, `classNames`. Clicking
  the box's padding focuses the text.
- **Collapse and AutoHeight are one implementation:** `Collapse` animates open/closed and, while open, follows its
  content's height with a spring; `open` is optional (always shown) and `transition` configurable. `AutoHeight` is
  `Collapse` without `open`.
- **AI chat renderers:** `MessageParts`/`Message` take `renderers` (`AiRenderers`) or `<AiRenderersProvider>`;
  `AI_RICH_RENDERERS` adds highlighted code and JsonViewer. Model pickers are native selects, AgentComposer's
  advanced settings are inline, "+ Add connector" needs `onAddConnector`, PermissionRequest has neutral defaults.
- **Labels default to translated text** (charts, comments, presence, forms, pickers): pass your own to override.
  Chart `format` defaults to the provider locale's compact format. `useRoving` swaps ←/→ in RTL.
- Removed module-scope helpers that are now locale-aware inside components: `chartRange`, `chartFixed`,
  `forestPct`, `forestCi`, `inboxTime`. `timeOptions`/`timeZoneOptions` return `TimeOption[]`. `RANGE_PRESETS` no
  longer has "Last 14 days"; DateRangePicker shows ranges with `Intl` `formatRange`.

## [0.3.0]

Real data: model streams, form submission, async data and long lists.

### Added
- **Markdown** (`@lyndon/ui/markdown`): streaming-safe GFM renderer for model output (headings, lists, task lists,
  tables, quotes, code fences via CodeBlock, links, autolinks, `[n]` citations). React nodes only, links through
  `safeUrl`, images shown as links unless `images="allow"`, 200k-character cap, linear-time parser. Half-received
  syntax never flashes, an open fence renders as code, streamed tables keep fixed column widths, and the caret
  causes no layout shift.
- **AI streams** (`@lyndon/ui/aistream`): message model with parts (text, reasoning, tool, source, file, data,
  error), `applyAiChunk` reducer, `parseAiStream` (SSE / NDJSON byte streams), `fromAiSdkUIMessageStream`, and
  `useAiChat` (submit, stop via AbortSignal, regenerate, tool approvals that run only after `decideTool`, errors
  with retry, frame-throttled updates). Chat parts exported separately: `Conversation` (stays pinned to the
  newest message, "Jump to latest"), `Message`, `MessageParts`, `Reasoning`, `ToolCard`, `ApprovalCard`,
  `MessageActions`, `Suggestions`, `PromptInput` (attachments by paste/drop/pick, model picker, Send/Stop),
  `useAttachments`, `AttachmentChip`. Long conversations virtualise past 60 messages (cap 2,000). README:
  Next.js route handler streaming from the Anthropic API.
- **Forms:** every custom control (Select, Combobox, MultiSelect, date and time pickers, TagInput, sliders, OTP,
  Phone, Currency, Rating, ColorPicker, NumberStepper, SegmentedControl, RadioGroup, Switch, Checkbox,
  FileUpload) takes `name`, `required`, `disabled`, `readOnly`, `invalid`, `onBlur`, `form` and `ref`, submits
  through hidden inputs (`new FormData(form)`, server actions), resets with the form and receives focus on
  error. New `Form` and `FormField`; README recipes for server actions and react-hook-form + zod.
- **Async Combobox:** `loadOptions(query, { signal })` with debounce, abort, loading/empty/error states with
  retry, `minChars`, `creatable`, option groups.
- **Virtualization** (`@lyndon/ui/virtual`): `useVirtual` (dynamic heights, window or element scrolling,
  bottom anchoring for chats, `scrollToIndex`, SSR-safe, keeps the focused row rendered) and `VirtualList`.
  Used by OptionList (over 100 options), DataGrid (over 100 rows), TreeView (over 300 nodes), CommandPalette
  (over 60 results) and long conversations.
- **DataGrid:** server mode (controlled sort, filter, search, pages or infinite loading, loading and error
  states), column pin/hide/reorder (popover, drag, Ctrl+Shift+arrows), controlled selection with select-all
  across pages (`GridSelection`), full ARIA grid row/column counts on virtual rows. 50k rows scroll with no long
  tasks and about 20 rows in the DOM.
- **CommandPalette:** groups, async `loadItems`, nested pages, recents. **AlertDialog** with async confirm.

### Changed
- `Field` is now `FormField` with the same props. `ChatComposer` wraps `PromptInput`; `StreamingText` wraps
  `useStreamedText`, which now follows an append-only growing string (`live`). AssistantChat and AgentComposer
  take `chat` from `useAiChat`; their scripted props still work.
- Primary/accent/danger button hovers no longer lower text contrast.

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
