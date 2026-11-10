# Changelog

All notable changes to `@lyndon/ui`, newest first. While on 0.x, a minor release may break APIs; each breaking
change is listed with how to migrate.

## 0.10.0

English only, no right-to-left, and a smaller chart kit. Breaking: see Removed for what to delete from your code.

### Removed
- Translations and message catalogues: `defineMessages`, `useMessages`, `createMessagesTranslator`, `messageCatalog`, `createTranslator`, `formatMessage`, `UI_MESSAGES_EN/DE/AR`, every `*_MESSAGES` catalogue, `t()` from `useLocale()`, the `messages` prop and the `messages-de` / `messages-ar` registry items. UI text is plain English; text you may want to change is a prop with an English default.
- Locale switching: `LocaleProvider`, `useLocale`, `resolveLocale`, `fmtFor`, `localeWeekStart`, `localeHourCycle`, and the `locale`, `timeZone`, `weekStartsOn` and `hourCycle` props of `UIProvider`; the `locale` and `weekStartsOn` props of the date controls and `AnimatedNumber`. Numbers and dates use the fixed English `fmt` (en-GB); weeks start on Monday. Date controls keep `hourCycle` and `timeZone`.
- Right-to-left support: `useDir`, `logicalArrow`, `dirX`, `localeDir`, `UI_DIR_CSS`, `UI_FLIP_ICONS`, `.ui-flip`, `rtl:` variants, `dir` props and LTR islands, `scripts/rtl-lint.mjs`, `scripts/i18n-extract.mjs`, the `desktop-rtl` / `iphone-rtl` e2e profiles and the showcase language menu.
- DataGrid pins and `GridPinned` take `left` / `right` only (`start` / `end` are gone); `useControllableState` (use `useControllable`, which now returns `[value, set, reset]`); `formsMergeRefs` (use `composeRefs`); `floatingSurface` (use `surface.floating`); `formsInterleave`.

### Added
- `plural(n, one, many?)` and `rangeStr(values, format?)`; `memoOnce(key, make)`.
- Hooks: `useActiveIndex(count, ref)` (bounded active index cleared by Escape, a tap outside and the mouse leaving), `useStatusFlash(ms)`, `useLive()`, `useResizeObserver(ref, cb)`.
- Helpers: `gridKeyMove` and `menuKeyMove` (one key-to-move map for grids, lists and menus), `downloadBlob`, `writeClipboard`; `UI_VERSION`.
- Charts: `useChartShell` + `ChartShell` (focus, live region, tooltip, data table, Show data, export menu and legend slot in one place); `ChartTable` takes raw rows plus per-column formats. Chart math (`PALETTE`, `CHART_NEUTRAL`, `seriesColor`, `linScale`, `polarPt`, `svgWedge`, `niceTicks`) lives in `vizkit.tsx`; `@lyndon/ui/charts` still exports `PALETTE`, `CHART_NEUTRAL` and `niceTicks`.

### Changed
- `useChartFocus` is replaced by `useChartShell`. Every chart's JSX now holds only its marks; `charts.tsx` is 20% shorter.
- Buttons and chips press with CSS (`motion-safe:active:scale-[.96]`) instead of `motion.button`; `Dialog.Close` draws its ✕ inline.
- Showcase: "Typed dates in any locale" is now "Typed dates" with a 12/24-hour switch; the "i18n" tag is "formatting".

### Fixed
- The shared-state key used a stale `'0.4'` version: it now derives from `UI_VERSION`.
- HexEditor's copy announced success when the clipboard refused it.
- PhoneInput built an `Intl.DisplayNames` per country on every render.
- `Popover.Root` re-created its context value on every render.
- AgentComposer's queued follow-ups could run after unmount.
- The currency input's parsing comment didn't match what it does.

## 0.9.0

Live agent runs, binary inspection, theme export and sharing, better toasts and chart export, and one tag vocabulary.

### Added
- `@lyndon/ui/agentrun`: one run model (agents, model calls, tools, retrieval, human steps; tokens, cost, errors) with `useAgentRun` for streams, SSE/NDJSON or polling, and adapters from OpenTelemetry GenAI spans (`fromOtel`), the Vercel AI SDK (`fromAiSdkResult`, `aiSdkRunMapper`) and LangGraph events (`langGraphRunMapper`). `TraceWaterfall run`, `AgentTransitMap run` and `runLaneNodes(run)` draw real runs live.
- `@lyndon/ui/binary`: `HexEditor` (virtualised to 100 MB, linked hex/ASCII, data inspector, overwrite editing with undo, search, copy as hex/C/Base64), `EntropyMap`, `ByteMap` (Hilbert curve), `BinarySectionList` and the linked `BinaryView`; helpers for entropy, strings, search and number decoding.
- Theme export to CSS, Tailwind v4 `@theme`, shadcn variables (`oklch`), W3C design tokens and Tokens Studio; `themeImport` for shadcn/DTCG themes; validated share links (`themeShareUrl`, `UIProvider themeFromUrl`); an "Export and share" area in the appearance panel (`ThemeExportPanel`).
- `toast()` returns an id; `toast.update`, `toast.dismiss`, `toast.promise`, `toast.undoable`, positions, dedupe by id, a visible limit with "+n more", pause on hover, focus and hidden tab; standalone `toast` export.
- Every chart renders an accessible data table (`table: 'hidden' | 'toggle' | 'shown'`) and can export PNG, SVG or CSV (`exportable`, `exportChart`).
- Showcase: one tag vocabulary (areas, use cases, capabilities, kinds, status) with synonyms, faceted filtering and shareable filter URLs; the registry, docs site and `llms.txt` carry the same tags.

### Fixed
- Custom themes never set their soft error tint (`bad-soft`).
- The appearance menu popover had no accessible name.

## 0.8.1

### Added
- `LaneGraph` and `useLaneGraph` take `hovered` and `onHoverChange`, so another view can drive the hover highlight.
- `CodeBlock` takes `marks`, `onTokenHover` and `onTokenClick` for character-precise highlights and token hover; `codeMarkRanges` helper.
- `Swimlanes` `labels: 'auto' | 'always' | 'icon'` (keep lane names on narrow screens).

### Changed
- Showcase: "Tags over time" shows labelled swimlanes under every chart style and includes the state ribbon and chart-with-journal views (the separate "Timeline views" card is gone); the AST example underlines a node's exact characters and finds the node under the word you hover in the code.

### Fixed
- In dark mode a host page's white body could show behind the themed page; `UIProvider` now themes `body` as well as `html`.

## 0.8.0

Graphs as rows: the Git graph's lanes are now a general-purpose component.

### Added
- `@lyndon/ui/lanes`: draw any directed graph as a list, one row per node with its edges in a lane gutter.
  - `layoutLanes(nodes, options)`: headless layout for any `{ id, parents }` nodes (`order`, `direction: 'down' | 'up'`, `pin`, `palette`).
  - `<LaneGutter row />`: one row's slice of the graph, stretching to the row's height.
  - `<LaneGraph nodes renderRow />`: virtualised list with your own row content, variable row heights, ancestry highlighting, keyboard that follows edges, selection and context menu; `useLaneGraph` for your own markup.
- Examples in `@lyndon/ui/examples`: chat branches, a syntax tree, an agent run and a dependency graph, each a data builder plus a `renderRow`.

### Changed
- `GitGraph` is built on `LaneGraph`; its API and behaviour are unchanged.
- The showcase's "Graphs as rows" card replaces the "Git graph" card, with tabs for Git, Chat, AST, Agent run and Dependencies.

## 0.7.0

A Git graph, and live demos that are much lighter on phones.

### Added
- `GitGraph` (`@lyndon/ui/gitgraph`): commit history with lanes, merges and refs; select a commit for its message and diff (`loadCommit`), Shift+click to compare a range (`loadDiff`), search, branch filter, first-parent and hide-merged views, keyboard that follows the graph's edges, and context-menu actions that call your app (`onCheckout`, `onCherryPick`, `onRevert`, …). Virtualised, so 50,000 commits scroll smoothly.
- `layoutGitGraph`, `parseGitLog` (reads the documented `GIT_LOG_COMMAND` output), `filterGitHistory`, `gitRange` for building your own views; sample history in `@lyndon/ui/examples` (`gitHistory`).
- `useFrameLoop` takes `{ maxDt, fps, coarseFps }` to cap the frame rate (30 fps on touch screens by default for the live demos).

### Changed
- `AgentTransitMap` draws its static map once and moves tokens with transforms; `Globe` paints only while something moves; `TraceWaterfall` reveals bars with clipping instead of width; `DataFlow`, `NetworkGraph` and `StateMachine` run at 30 fps on touch screens. Each uses roughly a third to a half less CPU on a phone.

### Fixed
- Number and variable tokens in code and diffs were too faint on deleted lines in light mode.

## 0.6.0

Faster on phones, a cleaner audit, and the promised removals.

### Changed
- Showcase demos mount as you scroll near them instead of all at load; on a phone the page paints in a fraction of the time and scrolls with far fewer stalls.
- Showcase cards that drew the same data in different ways are now one tabbed card each ("Tags over time", "Timeline views"); only the open tab is rendered.
- `TraceWaterfall` updates its moving parts directly instead of re-rendering every frame; `ShimmerText` no longer remounts its text; chart time labels are cached per locale.
- `JsonViewer` rows, toggles and path buttons, and date/time field segments, are at least 24 px (WCAG target size).
- Avatar initials follow the type scale; a few off-grid gaps and one-off control heights now use the standard scales.

### Added
- `mediaSynthTrackAsync` in `@lyndon/ui/examples` (generates the demo audio without blocking).
- Design QA runs as a routine check on desktop and iPhone (both directions); it ignores touch padding, screen-reader-only text and mid-animation states.

### Fixed
- `EmptyState`'s icon animation kept running off screen.
- Live chat source tiles had low contrast in dark mode.
- Masonry tiles now include the visible like count in their accessible name.

### Breaking
- Removed `ChatSources` (use `SourceList` with `Source` items: `name` → `title`, `desc` → `domain`, `href` → `url`), `type SourceCard` (use `Source`) and `ShortcutOverlay` (use `<ShortcutSheet variant="dialog">`), deprecated since 0.4.

## 0.5.0

Time annotations on charts, linked timelines, and magnets that snap values while you drag.

### Added
- `Chart` `annotations`: events as pins, a rug, flags, bands, counts or dots (`style: 'auto'` fits the width), keyboard-navigable and linkable with `activeId`.
- `Chart` `xTime` time axis; `@lyndon/ui/annotate` exports the building blocks (`layoutTimeTags`, `useTagFocus` …).
- `@lyndon/ui/timeline`: `Swimlanes`, `StateRibbon`, `TagJournal`, `ChartWithJournal` (chart and list linked); `TraceWaterfall` `annotations`.
- `@lyndon/ui/magnet`: snap points and zones on `Slider`, `RangeSlider`, `ColorPicker` (`hueMagnets`), `SplitPane` and `Gantt`; Alt drags freely; `useMagnet` for your own drags.
- `VideoPlayer` and `AudioPlayer` `chapters` (seek-bar breaks, PageUp/PageDown to jump).
- `TreeView` `lines` (click a line to collapse its branch), `OfflineIndicator` `paused`, `Slider` `valueText`.

### Changed
- The `chart`, `slider` and `trace-waterfall` drop-in files are larger (annotations and magnets included).

### Fixed
- `DataGrid` pinned columns no longer gap or overlap on narrow screens.
- `OfflineIndicator` no longer flashes, jumps, or reads the countdown aloud.

### Breaking
- `OfflineIndicator` text moved from `status.offline` to `feedback.offlineSaved`, `feedback.retryIn`, `feedback.retrying`, `feedback.offlineSaid`.

## 0.4.0

Translations and right-to-left, composable parts, date and time fields, a registry and CLI, a smaller API.

### Added
- `UIProvider` `locale`, `dir`, `timeZone` and `messages`; `useLocale()`; all text translatable, with draft German and Arabic; numbers and dates follow the locale.
- Every component mirrors in right-to-left (charts, code and diagrams stay left to right).
- `asChild`; composable parts for `Tabs`, `Dialog`, `Sheet`, `Popover`, `Tooltip`, `HoverCard`, `Accordion` and menus; new `Toggle`, `ToggleGroup`, `Toolbar`.
- `DateField`, `TimeField`, `DateTimeField`, `DateTimePicker`, `MonthPicker`, `YearPicker`, `TimeZonePicker`; `Calendar` `min`/`max`/`isDateUnavailable`; async `MultiSelect`.
- Every component as a drop-in `.tsx` file and in a shadcn registry; `npx @lyndon/ui add|list|info`; a docs site; `llms.txt`.
- Finer subpaths (`/pickers`, `/theme`, `/gantt`, `/statechart` …; old paths still work) and `@lyndon/ui/examples` (not semver-stable).
- One `Source` model for `Citation`, `SourcesPanel` and the new `SourceList`; more `PromptInput` slots.

### Changed
- Map and globe data load on first render (or pass `map` / `land`).
- `StateDiagram` and `StateMachine` share one renderer; `Collapse` follows content height (`AutoHeight` is `Collapse` without `open`).
- `AgentComposer` shows "Add connector" only with `onAddConnector`.
- Built-in labels and `Chart` number formats follow the locale.
- Every section passes axe in light, dark and right-to-left.

### Deprecated
- `ShortcutOverlay` → `<ShortcutSheet variant="dialog">`; `ChatSources` → `SourceList`; `type SourceCard` → `type Source`.

### Breaking
- Sample data, demo helpers and page blocks left the main API (see Migrating); `StateMachine` and `AgentTransitMap` render empty without `machines`.
- Chat code is unhighlighted unless you pass `renderers={AI_RICH_RENDERERS}`.
- `UIProvider` no longer adds a `ToastProvider`; `useToast()` works without one.
- `DataGrid` `onPinnedColumnsChange` reports `{ start, end, left, right }`; its pager is named "{grid label}: pages".
- `Sheet` defaults to `side="end"`; `Scheduler` weeks and hours follow the locale.
- Removed `chartRange`, `chartFixed`, `forestPct`, `forestCi`, `inboxTime`; `timeOptions` returns `TimeOption[]`; `RANGE_PRESETS` lost "Last 14 days".

### Migrating
- `AI_CANVAS_SAMPLE`, `AGENT_WORKFLOWS`, `AGENT_WORKFLOW_ORDER`, `describeSample`, `mediaArt`, `mediaImage`, `mediaSynthTrack`, `mediaRecordVideo`, `MediaArtKind`, `RTE_SAMPLE`, `MENTION_PEOPLE`, `MENTION_COMMANDS`, `PAGE_CSS`, `PhoneFrame`, `MotionPlayground` → `@lyndon/ui/examples` (`@lyndon/ui/playground` is gone).
- `<StateMachine />`, `<AgentTransitMap />` → pass `machines={AGENT_WORKFLOWS} order={AGENT_WORKFLOW_ORDER}`.
- `WORLD_MAP` → `@lyndon/ui/geoworld` or `loadWorldMap()` / `useWorldMap()`; `GLOBE_LAND` → `@lyndon/ui/geoland` or `loadGlobeLand()`.
- `PricingTable`, `Checkout`, `ProfileCard`, `OnboardingChecklist`, `CookieConsent` (and types) → copy in the matching registry block (`pricing-table` …).
- `AvatarGroup` → `<AvatarStack spread={false}>`; `InlineDatePicker` from `/data` → `/pickers`.

## 0.3.0

Streaming model output, native form submission, async options and long lists.

### Added
- `@lyndon/ui/markdown`: safe Markdown for streaming model output.
- `@lyndon/ui/aistream`: `useAiChat` (stop, regenerate, retry, tool approvals), `parseAiStream` (SSE, NDJSON), `fromAiSdkUIMessageStream`.
- Chat parts: `Conversation`, `Message`, `Reasoning`, `ToolCard`, `ApprovalCard`, `PromptInput` and more.
- Every form control submits and resets with its form (`name`, `required`, `disabled`, `readOnly`, `ref`); new `Form` and `FormField`.
- Async `Combobox`; `CommandPalette` async items and nested pages; new `AlertDialog`.
- `@lyndon/ui/virtual`; long lists, grids, trees and chats virtualise automatically.
- `DataGrid` server mode, column pin/hide/reorder, selection across pages.

### Changed
- `Field` is now `FormField` (`Field` still works); `StreamingText` takes `live`.
- `AssistantChat` and `AgentComposer` take `chat` from `useAiChat`.

### Fixed
- Button hovers no longer lower text contrast.

## 0.2.1

Polish: no layout shift, keyboard access everywhere, consistent sizing.

### Added
- `AgentTransitMap` queues and congestion; parent-to-child connectors in `TraceWaterfall` and `Gantt`.
- Every chart is keyboard-navigable (`useChartFocus`).
- Size scales, `Button` `xs`, `Badge` `size`, `TreeView` `compact`, `SplitPane` `stackBelow`, `Chart` `summary`, `MegaMenu` `open`, and more.
- Releases are tested in CI and published to npm with provenance.

### Changed
- `RichTextEditor`, `AICanvas`, `VoiceInput` and `MentionsInput` start empty.
- Colours reach 4.5:1 contrast in every palette; `ThinkingSteps` no longer auto-collapses; `SegmentedControl` is a radio group.

### Fixed
- Pages, including `AgentTransitMap` approvals, no longer shift while loading or streaming.
- `pnpm install --frozen-lockfile` works on pnpm 10.

## 0.2.0

Phones and touch, security hardening, review fixes.

### Added
- Touch support everywhere: bigger tap targets, no hover-only UI, bottom sheets.
- `safeUrl`, `safeMediaUrl`, `cssUrl`, `safeCssValue`, `safeColor` for untrusted data.
- `RichTextEditor` `sanitize` (on by default); `AgentComposer` and `PermissionRequest` approvals wait for your app.
- CSP `nonce` support, `tokens.css`, SECURITY.md, checksummed single-file builds.

### Changed
- AI preview can't load remote content; huge inputs are capped; saved themes are validated (`ui-theme:v1`).

### Fixed
- 36 bugs from the 0.1 review, including script injection in `RichTextEditor`.

### Breaking
- `UIProvider` no longer loads Google Fonts by default; pass `fonts` to keep them.

## 0.1.0

First release candidate.

### Added
- A theme system and 150+ components, per-area entry points, `ThemeScript`, and drop-in single-file builds for AI tools.
