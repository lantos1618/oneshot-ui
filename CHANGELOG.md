# Changelog

All notable changes to `@lyndon/ui`, newest first. While on 0.x, a minor release may break APIs; each breaking
change is listed with how to migrate.

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
