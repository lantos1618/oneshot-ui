# Changelog

All notable changes to `@lyndon/ui`, newest first. While on 0.x, a minor release may break APIs; each breaking
change is listed with how to migrate.

## 0.12.0

A code audit fixed 67 high-priority bugs, each with a regression test. Components no longer fake success: uploads,
saves, payments, votes, approvals and agent runs report only what your code confirms, and failures show with a way to
retry. Demo behaviour (simulated uploads, canned replies, random collaborators, workflow simulations) moved to the showcase.

### Breaking changes

| Before | After |
|---|---|
| `MOTION_PRESETS`, `MotionPreset` from `@lyndon/ui/motion` | Removed (showcase only) |
| `EASE_OUT` from `@lyndon/ui/motion` | Import it from `@lyndon/ui` or `@lyndon/ui/helpers` |
| `useHoverIntent(ref, 300, 150)` | `useHoverIntent(ref, { openDelay: 300, closeDelay: 150 })`; the default `closeDelay` is 150 ms (was 100) |
| `inset` on `MenuCheckboxItem` / `MenuRadioItem` | Removed (it had no effect) |
| FileUpload simulates progress and "Uploaded" | Pass `upload(file, onProgress, { signal })`; without it a file shows "Ready". The default hint follows `accept` and `maxSize` |
| FileUpload `onReject` reports wrong types only | `onReject(files, reason)` also reports `'size'` and `'count'` |
| RadioGroup preselects the first enabled option | Nothing is chosen; pass `defaultValue` to keep the old behaviour |
| RangeSlider defaults to `[20, 80]` | Defaults to `[min, max]` |
| OTPInput `onChange(code)` | `onChange(code, { complete })`; a space marks an empty box before the last digit ("1 3456") |
| OTPInput submits the digits with a gap closed up | The form value is `''` while there is a gap |
| CurrencyInput regroups while you type | Shows your text as typed and groups it when you leave the field |
| Date controls read pasted Arabic-Indic and full-width digits | Only ASCII digits are read |
| Date control docs list `locale` and `weekStartsOn` | Gone from the docs; the props never existed (dates are en-GB, weeks start on Monday, `hourCycle` sets the clock) |
| CollapsibleSidebar shows a brand title and a placeholder page | `title` defaults to `''` and the main pane shows only `children`; pass both (the placeholder is `SidebarPage` in the showcase) |
| SplitPane Home resets the split | Home closes the first pane and End opens it to `max`; reset with Enter or double-click |
| TreeView renames on F2 or double-click | Only when `onRename` is passed |
| `ChartTable.formats` entries of any shape | Typed `(v: number) => string`; use a `{ value, text }` cell for custom text |
| `timeTicks(start, end, width, format, minPx?)` with `format(ms)` | `format` is optional and receives `(ms, unit)`; each tick carries `unit: 'time' \| 'day'` |
| `timeTagBadge` | `countChipPx(n)` |
| `WorkflowEngineOptions.intake` defaults to `'request.received'` | No default; pass `intake: 'request.received'` (StateMachine: `options={{ intake: 'request.received' }}`) |
| StateMachine treats a station named `Index` as special | Mark that state `WorkflowState.trigger: true` |
| `TraceRun.status` and span `status` are `string` | `RunStatus`: `'running' \| 'ok' \| 'error' \| 'cancelled'` |
| TraceWaterfall `failure` prop and "Simulate failure" button | Removed; pass the failed span with `error: '…'` and its retry as its own span |
| DataFlow invents a p95 latency and jitter | The p95 tile shows only with `stats.p95`; pass `simulate` for the old demo behaviour |
| `DataGridProps` allows `onLoadMore` / `hasMore` with `page` / `pageSize` | Types require one paging mode; at runtime `onLoadMore` wins |
| `parseByteOffset('10')` is 10 | Bare digits are hex (`'10'` is 16); decimal needs `#` (`'#10'`) |
| HexEditor `offsets` sets the starting mode | `offsets` is controlled (`onOffsetsChange`); pass `defaultOffsets` for a starting mode the header can toggle |
| RichTextEditor always shows "Saved" | No indicator by default; return a Promise from `onChange` or pass `saveState` |
| `codeLanguageOf` returns `'ts'` for an unknown or missing name | Returns `undefined`; `codeLanguageOf(name) ?? 'ts'` gives the old result |
| `EMOJI_CATEGORIES` third field is a space-separated string | A `readonly string[]`; drop the `.split(' ')` |
| `GitFileChange` with optional `oldPath` | A discriminated union; `status: 'renamed'` requires `oldPath` |
| `GitGraphLayout.rowOf` is a `Map` | A `ReadonlyMap` |
| A denied tool call is `state: 'error'` with `approval.approved === false` | `state: 'denied'`; `AiToolState` also gains `'approved'` |
| `toAiChunk({ type: 'abort' })` returns `{ type: 'finish' }` | Returns `{ type: 'abort' }`; the reply is kept and marked `stopped` |
| A byte stream or Response may end without a terminator | It must end with `finish`, `abort` or `[DONE]`, or the reply is marked `truncated` |
| AgentComposer guesses `needsApproval` from the message text | Off by default; return `{ needsApproval }` from `onSend` or pass your own `needsApproval` |
| Model names "Fast", "Priority" and "Ultra fast" change the scripted word delay | Set `ComposerModel.wordDelay` (default 45 ms) |
| PromptInput `uploadProgress: boolean` plays a fake bar | `uploadProgress(attachment) => number \| undefined`, real 0–1 progress |
| AttachmentChip `uploading` is a seed number | A 0–1 fraction |
| SuggestedEdit fakes "Rewriting…" for 800 ms | Shows the diff at once with `after`; pass `onRequest: () => Promise<string>` to fetch it on request |
| AgentPlan runs itself (Run button, `onDone`) | Both removed; drive the step statuses from your agent (see the showcase's `AiPlanDemo`) |
| `ChatApproval` | Removed; build the card from `ChatCard` and your own send callback, or use `PermissionRequest` |
| `useAgentRun` treats a stream that closes before `run-end` as a successful run | The run is `cancelled`, `status` is `'error'`, `closedEarly` is true and `onError` gets an `AgentRunClosedEarlyError` |
| `<ChatInbox conversations={x} />` with `replies` / `simulateIncoming` | `<ChatInbox defaultConversations={x} onSend={send} />`, or control `conversations` with `onConversationsChange` |
| `InboxMessage` without `id` | `id` is required |
| LivePresence with built-in people, `people` and `title` | Pass `cursors` (0–1 positions), the document as `children` and a `label`; `me` and `onCursorMove` for your own cursor |
| AnchoredComments signs replies "Alex Lee" | `me` is required |
| MasonryGallery always shows Save and flips to Saved at once | Save renders only with `onSave(item, saved)` and flips once it resolves |
| AICanvas `edits` and the `CanvasEdit` export | Removed; answer through `respond(prompt, code, context)` or `explain` (the scripted demo is in the showcase) |
| AgentTransitMap simulates a run from `machines` / `order` | It draws `run` only; `machines` and `order` are ignored (the simulation is `TransitSimMap` in the showcase) |
| `AudioTrackHandle.play()` / `toggle()` resolve to a boolean | They resolve to `MediaPlayResult`: `{ ok: true } \| { ok: false, error }` |
| `AudioTrackHandle.view()` | `load()` and `sync()`; new `release()` |
| Checkout completes payment on a timer | `onPay(order, card): Promise<void>` is required; reject with an `Error` to show its message. `onComplete` gets the same `CheckoutOrder` |
| Checkout `promoCodes={{ SAVE10: 0.1 }}` | `validatePromo={c => ({ SAVE10: 0.1 })[c] ?? null}`; without it there is no promo field |
| Checkout prefills a sample name, email and address | `defaultDetails` starts empty |

### Fixed
- **Core:** `rangeStr` no longer throws above about 125k values, which broke every chart's screen-reader summary.
- **Core:** `fmt.relative`, `fmt.date`, `fmt.time` and `fmt.dateTime` return '' for an invalid date instead of throwing.
- **Core:** `<Button asChild disabled>` (or `loading`) no longer runs the child's own `onClick` on keyboard activation.
- **Core:** `rgb()` reads `#rgb` and `rgb()` colours instead of treating them as black; `revealTheme` works without `matchMedia`, e.g. on the server.
- **Forms:** Combobox text always matches the value: unpicked text reverts on blur, emptying the field clears the value, and a value whose options arrive later shows its label.
- **Forms:** async Combobox filters static `options` by the query, and a cancelled request in Combobox or MultiSelect no longer leaves the spinner running.
- **Forms:** DateField and DateTimeField mark an impossible date (31/02/2025) invalid instead of turning it into another date; unreadable pasted text shakes the field.
- **Forms:** CurrencyInput accepts either separator as the decimal point (amounts were multiplied by 100), marks text it can't read for certain as invalid, and shows 0 in the readout.
- **Forms:** FileUpload `multiple={false}` holds one file; `defaultFiles` no longer replay an upload; removing a row aborts its upload; failed uploads offer Retry and are not submitted.
- **Forms:** PhoneInput's country picker is announced as a combobox and its type-ahead cycles matches; `onChange` fires only for user edits; `e164` is '' with no digits.
- **Forms:** controlled CurrencyInput, PhoneInput and OTPInput show and submit the parent's `value`; OTPInput digits keep their boxes when one is cleared.
- **Forms:** Select and Combobox submit '' for a value that is not an option; RadioGroup `required` can fail; MonthPicker and YearPicker block the submit for an out-of-range value.
- **Forms:** NumberStepper and RangeSlider have no float drift; Slider and RangeSlider snap values to `step` and keep them in range; ColorPicker reads "#abc" and rejects non-hex text; TagInput no longer throws on a duplicate.
- **Overlays:** a Sheet keeps its text, scroll position and focus when the viewport crosses 640px.
- **Overlays:** CommandPalette shows recents from the current `commands` and runs the chosen command as it closes; a reopened palette could fire the previous one.
- **Overlays:** Tooltip flips, stays in the viewport, honours `align`, follows its trigger when portalled and wraps at 20rem; FloatingPanel counts `sideOffset` when flipping and clamps to the layout viewport.
- **Overlays:** Escape closes a hover-shown Tooltip or HoverCard wherever focus is; HoverCard sets `aria-describedby` (and `aria-expanded` with `pinOnClick`) and is valid inside a `<p>`.
- **Overlays:** DropdownMenu focuses its first enabled item and skips `aria-disabled` links; Popover and DropdownMenu set `aria-controls` only while the panel exists; a part used outside its Root is named in the error.
- **Overlays:** `AlertDialog.Content` takes `aria-label`; ContextMenu long-press no longer vibrates before a user gesture; Tour's arrow keys ignore typing in fields; NotificationBell's "Mark all read" covers every item.
- **Overlays:** `VirtualList window` re-measures its position on scroll and resize, so content growing above it no longer leaves gaps.
- **Navigation & data:** Tabs, ToggleGroup and Toolbar skip disabled `asChild` items and aria-disabled links; they and MegaMenu leave Alt/Ctrl/⌘ + arrow keys to the browser.
- **Navigation & data:** AsyncButton shows "Couldn't save" and calls `onError` when `onClick` rejects, instead of an unhandled rejection.
- **Navigation & data:** DataTable sorts dates and numbers by value and text naturally ("item 2" before "item 10"), with empty cells last.
- **Navigation & data:** MegaMenu respects a controlled `open`; TreeView keeps a Tab stop when the selected node is gone; MobileTabBar accepts empty `items`.
- **Navigation & data:** HoldToConfirm announces `doneLabel` (it always said "Deleted"); LikeButton counts the same way controlled or not and no longer throws; Progress and ProgressRing clamp their value.
- **Navigation & data:** JsonViewer keeps keys containing `.` or `[` apart from nested keys, and its filter says "No matching keys" when nothing matches.
- **Navigation & data:** Kanban and TaskList ids no longer collide; dismissed toasts no longer leave their heights behind; `confetti()` runs at the same speed on 120 Hz screens.
- **Charts:** all-negative data or a `domain` ending at 0 no longer squeezes the value axis; DensityHistogram counts the maximum in the last bin; RadarChart leaves a gap for a missing value instead of 0.
- **Charts:** FunnelChart keeps steps past the fifth visible; BoxViolinChart's table and CSV count every outlier; ForestPlot's default domain covers every interval and marks clipped ones with an arrow.
- **Charts:** fractional axes and readouts show the decimals they need; time axes show the date at midnight and follow DST; charts with no data say "No data."; DonutChart with all zeros totals 0; SparkChart leaves a gap for NaN.
- **Charts:** tooltips clear when the pointer leaves and follow data changes; a tag kind with no `color` gets the same colour in every view; Home and End reach the first and last point; TickerTable is a valid table on phones.
- **Charts:** Swimlanes under a Chart line up with that chart's real axis gutter.
- **Diagrams:** Gantt, NetworkGraph, ProcessFlow, DataFlow and Globe accept data added or removed after mount, keeping your drags for ids that still exist.
- **Diagrams:** Gantt no longer hangs on a dependency cycle or throws on an unknown task id (it lists ignored dependencies), and shades weekends whatever weekday `start` is.
- **Diagrams:** WorkflowEngine rejects machines that name unknown states, reports throwing guards and subscribers without stopping `tick()`, and counts unhandled events.
- **Diagrams:** TraceWaterfall shows "Failed" or "Cancelled" for a run that didn't succeed, draws cancelled spans muted, and picks a fitting tick step.
- **Diagrams:** Globe no longer invents latencies and works without UIProvider; WorldMap and Globe show a Retry message when their data fails to load; DataFlow and Globe repaint on theme changes.
- **Diagrams:** StateMachine no longer rebuilds its engine on every render; Reset no longer leaves a ProcessFlow run suspended; a cancelled pointer ends NetworkGraph drags and Globe spins.
- **DataGrid & binary:** the cell editor saves what was typed (no rounding, no 0 for bad input) and stays open with a message for an invalid number.
- **DataGrid & binary:** Export without `onExport` downloads a real CSV instead of reporting a fake "CSV ready".
- **DataGrid & binary:** `onLoadMore` always virtualises; number filters reject non-numbers and skip empty cells; the Text tab follows outside filter changes; `rowHeight` sizes the header; filter pills meet 4.5:1 contrast.
- **DataGrid & binary:** Scheduler no longer adds the attendee "Alex Lee" to new events, and "Today" matches the highlighted day.
- **DataGrid & binary:** HexEditor "Go to" reads hex like the displayed offsets, search jumps to a match of the new query, and copy results show in the status bar.
- **DataGrid & binary:** ByteMap zooms smoothly with a trackpad pinch; OrgChart is a labelled group with `aria-expanded` on its fold buttons.
- **Code & editor:** Diff, CodeBlock and GitGraph no longer show a phantom empty line for a new or deleted file or a trailing newline.
- **Code & editor:** GitGraph shows "Unknown date" instead of crashing, keeps its search position and count right, announces only new commits, offers Clear filters when nothing matches, and colours branch chips like their lanes.
- **Code & editor:** Markdown no longer turns `arr[0]` or `[1]: url` into citations; emoji have distinct accessible names (👍 and 👎 were both "thumbs").
- **Code & editor:** RichTextEditor keeps `/docs`, `#top` and `tel:` links as typed, and shows "Saved" only for a confirmed save.
- **Code & editor:** EmojiPicker arrow keys treat Recent and the main grid separately; MentionsInput and AddressAutocomplete close as focus leaves; SignaturePad follows theme changes; CodeTabs with no tabs renders nothing.
- **AI:** a failing reply stream no longer ends as a silent success: unreadable responses are errors, cut-off streams keep their text and are marked `truncated`, and a server abort marks the reply `stopped`.
- **AI:** `aiChunksOf` reads NDJSON as well as SSE and reports malformed lines; an approved tool call without `onApprovalRequest` reads "Approved" instead of spinning.
- **AI:** AgentComposer shows `onSend` errors with Retry, keeps refused follow-ups queued, names files it can't take, follows streaming replies, and no longer waits on guessed delays.
- **AI:** ModelComparison toasts "Vote recorded" only when the vote was recorded, and no longer throws on a vote; PermissionRequest's Deny waits for `onDecide`.
- **AI:** VoiceInput fires `onResult` when the parent stops listening; AssistantChat `/` commands keep their argument and ignore case; SourcesPanel shows an out-of-range `[n]` as text; GhostTextInput announces a suggestion once.
- **Agents/media/collab:** AICanvas sends line questions to your `respond` or `explain` instead of a canned answer, and shows a failed reply with Retry.
- **Agents/media/collab:** audio players play the new file when `src` changes and say why playback failed; VideoPlayer with no `src` says "No video".
- **Agents/media/collab:** ChatInbox no longer invents replies, AnchoredComments no longer signs as "Alex Lee", and MasonryGallery no longer claims "Saved" when nothing was saved.
- **Agents/media/collab:** AgentTransitMap station counts update; AvatarCropper no longer leaks an object URL on unmount; `usePinchPan` recovers from a lost pointer capture.
- **Blocks & showcase:** Checkout no longer fakes payment, prefills personal details, offers a built-in promo code or claims a receipt was sent.
- **Blocks & showcase:** SettingsPage shows a failed save and reverts the row, shows "Saved" only after `onSave` resolves, and follows its `sections` prop.
- **Blocks & showcase:** ⌘K "Open modal" and "Open drawer" open at once, and demo toggles that do nothing no longer say "Saved".
- **Build & docs:** nine docs pages showed the wrong live example or none; the docs build now checks every card.
- **Build & docs:** shadcn and DTCG theme exports read every colour form the CSS export accepts and keep alpha; `themeExport` throws for an unknown format.
- **Build & docs:** the showcase and docs use the current pre-paint theme script, and the docs "Source" link points at the item's real file and commit.
- **Build & docs:** build scripts work from paths with spaces and on Windows; missing steps, unresolved bundle imports and broken registry items fail the build instead of being skipped.
- **Tests:** several tests could pass without checking anything (Globe reduced motion, the DataGrid search guard, daylight saving, the 50k-commit scroll); they now test what they claim.

### Changed
- **Core:** the static `TOKENS` and `dist/tokens.css` match what UIProvider applies, so colours no longer shift at hydration.
- **Core:** `useWidth`, `useSize` and `useResizeObserver` follow a remounted element and report the content box from the first value; `useLive` re-announces a repeated message and takes `{ politeness, debounce }`.
- **Core:** disabled and read-only fields use a muted fill instead of 60% opacity; Avatar colours follow the theme; `<Icon>` takes registered names without a cast and warns about unknown names in development.
- **Core:** `fmtDate` and `formatDate` are deprecated aliases of `fmt.date`.
- **Forms:** Combobox and MultiSelect handle "Create" the same way and keep created options in later searches; a read-only date control no longer blocks the submit.
- **Forms:** date controls draw their icons with `Icon`, so `registerIcons` reaches them; fields built on `inputClass` no longer need `formDisabledClass` or `formReadOnlyClass`.
- **Overlays:** `HoverCard.Trigger` renders an inline `<span>`; FloatingPanel has a `data-side` attribute; overlay layers use the shared `Z` scale; `Sheet.Header` no longer starts a drag from its buttons, links or fields.
- **Overlays:** the one-line Tooltip, HoverCard, Sheet and ContextMenu take their defaults from their parts; `useVirtual`'s `scrollMargin` accepts a function.
- **Navigation & data:** DataTable and DataGrid headers cycle ascending → descending → unsorted, using the shared `SortHeader`.
- **Navigation & data:** `Column.align` values 'left' and 'right' are deprecated (use 'start' and 'end'); `DataSort<T>` and `GridSort<T>` are aliases of `TableSort`.
- **Navigation & data:** HoldToConfirm's idle line is empty and its cancelled line reads "Cancelled"; a renamed TreeView label shows until `nodes` changes it.
- **Charts:** chart, timeline and tag tooltips are portalled and stay on their mark while the page scrolls; DensityHistogram's table has From, To and Count columns.
- **Charts:** `timeTagLook` and `TagTooltip` accept the `kinds` array or the resolved map; the fallback colour is `CHART_NEUTRAL`.
- **Diagrams:** a fork's waiting segment reads "Waiting for branches to join" (set `WorkflowState.joinLabel` to change it); DataFlow throughput comes from the sources' rates or `stats.throughput`.
- **DataGrid & binary:** DataGrid sorting is numeric-aware with empty cells last; EntropyMap `selection` can be controlled.
- **Code & editor:** `<Markdown>` parses `[n]` citations only when you pass `renderCitation`; `parseMarkdown` takes a `citations` option.
- **Code & editor:** unknown files render as plain text with a "Text" badge, `.cjs` and `.jsonc` are recognised, and Markdown fences share CodeBlock's frame.
- **AI:** `parseAiStream`, `fromAiSdkUIMessageStream` and `aiChunksOf` return an `AiStreamEnd` from their generator; `for await` loops are unaffected.
- **AI:** PermissionRequest takes `copy` to word it for actions other than email; after a denial its button reads "Review again".
- **Agents/media/collab:** `Comment` and `ThreadMessage` take `createdAt`, shown relative to now; `time` is optional.
- **Agents/media/collab:** AgentTransitMap's running badge reads "Running" (was "Live"); AICanvas streams its replies.
- **Blocks & showcase:** the showcase's demo data uses one seeded generator and shared sample names, which changes some sample charts and rows.
- **Build & docs:** `pnpm check` runs lint, types, build, docs types, registry, SSR, unit tests and the pack check; CI and the release workflow both run it.
- **Tests:** unit tests run in Europe/London, and the date suites again in America/Santiago, so a local `TZ` no longer changes results; timing tests no longer depend on machine speed.
- **Tests:** the e2e baseline update flag is `E2E_BASELINE=update` (was `AXE_BASELINE`); `pnpm test:e2e:update-baseline` sets it.

### Added
- **Core:** the table sort model `compareCells`, `nextSort`, `ariaSort` and `TableSort`; colour helpers `parseRgba`, `parseColor`, `hslToRgb`, `srgbToLinear` and `resolveColor`; `onColorLabel` (white text at 4.5:1 on any colour); `RUN_STATUS`; `uid`.
- **Core:** hooks `useElementSize`, `useFlash`, `useDebounced`, `useNow`, `useLatest`, `useTypeahead`, `useObjectUrls` and `useThemeVersion`; `fmt.fixed`, `fmt.seconds` and a `{ zero }` form for `plural`; StatusIcon `warn` and `cancelled`; `Tone` accepts `danger`.
- **Forms:** `useFormControl({ validity })`, `markEdited()`, FileUpload `maxSize`, `filterFiles`, `useFileDrop`, Combobox and MultiSelect `onLoadError`, `MatchText` and `useRadioGroup`.
- **Overlays:** `fitPanel` (pure placement that flips and clamps), `fitInside`, `viewportSize`; `useMenuList` and `Menu.List`; `FloatingPanel inline`; `onExitComplete` on CommandPalette and ModalLayer.
- **Navigation & data:** `SortHeader`, `Ring` and `ProgressTone`; `empty` on DataTable and TreeView; AsyncButton `onError` and `errorLabel`.
- **Charts:** vizkit `tickDecimals`, `tickStep`, `textPx` and `VizTip`; annotate `resolveTagKinds`, `TAG_LAYOUT`, `timeTickText` and `timeSpanText`; `useChartShell({ tipAt })`.
- **Diagrams:** WorkflowEngine `error` and `unmatched` events and `engine.unmatched`; `WorkflowState.trigger` and `joinLabel`; StateMachine `options`; DataFlow `stats` and `simulate`; `TraceSpan.cancelled`.
- **DataGrid & binary:** `GridColumn.parse(text)`; Scheduler `newEvent(draft)`; HexEditor `defaultOffsets` and `onOffsetsChange`.
- **Code & editor:** `codeLines`, `diffStat`, `diffHunks`, `CodeFrame` and `CodeCopy` in `@lyndon/ui/code`; LaneGraph `onFresh`; `richTextHref`; RichTextEditor `saveState`.
- **AI:** ModelComparison `onVote`; AgentComposer `onError`; `useAiChat` `onMalformed`; `AiMessage.truncated`; `parseJsonLines`, `streamItems`, `valueText` and `attachmentRejectNote` in `@lyndon/ui/ai`.
- **Agents/media/collab:** `AgentRunState.closedEarly`, `spanAncestors` and `nearestAgent`; ChatInbox `onSend`, `typing`, `selected`, `onCall` and `onProfile`; AICanvas `suggestions` and `onError`; VideoPlayer `emptyLabel`.
- **Blocks & showcase:** `CheckoutOrder` and `CheckoutCard` types.

### Removed
- **Core:** `MOTION_PRESETS`, `MotionPreset` and the `EASE_OUT` export from `@lyndon/ui/motion`.
- **Forms:** FileUpload's simulated uploads.
- **Overlays:** `inset` on `MenuCheckboxItem` and `MenuRadioItem`.
- **Charts:** `timeTagBadge` (use `countChipPx`).
- **Diagrams:** TraceWaterfall's `failure` prop and "Simulate failure" button.
- **AI:** `ChatApproval`, AgentPlan's Run button and `onDone`, and ChatChecklist's "All clear" emoji.
- **Agents/media/collab:** ChatInbox `replies` and `simulateIncoming`, LivePresence `people` and `title`, AICanvas `edits` and `CanvasEdit`, and AgentTransitMap's built-in simulation.
- **Blocks & showcase:** Checkout `promoCodes`.

## 0.11.0

The library splits into a core tier and extras families. `@lyndon/ui` is now core only (foundation, motion, overlays,
forms, navigation, feedback, data, layout, provider); charts, diagrams, maps, content, media, AI and the rest come from
their own subpaths. `scripts/tiers.mjs` lists every module's tier, and `tests/unit/tiers.test.ts` enforces it: core never
imports extras, extras import only core, their own family and the families they declare, no module imports a barrel
except `./core`, there are no runtime import cycles, and the entry points and `package.json` exports match the list.

### Import migration

| Before | After |
|---|---|
| Extras names from root `@lyndon/ui` | `@lyndon/ui/<module>`, or `@lyndon/ui/all` for one release |
| `Kanban*` | `@lyndon/ui/kanban` |
| `AppearancePanel`, `AppearanceMenu`, `ThemeExportPanel` from root | `@lyndon/ui/appearance` (`ThemeToggle` and `ThemePreview` stay in root) |
| `useStreamedText` | `@lyndon/ui/ai` |
| `seeded` | removed |
| `highlightCode`, `codeLineDiff`, `codeLanguageOf`, `CODE_LANGUAGE_NAMES`, `wordDiff`, `theme*`/`oklch*` export helpers from `/utils` | `@lyndon/ui/utils/extras` |
| `SettingsPage` | registry block `settings-page` |
| `@lyndon/ui/examples` | removed |

### Added
- Subpaths `@lyndon/ui/kanban`, `@lyndon/ui/vizkit`, `@lyndon/ui/utils/extras`, and `@lyndon/ui/all` (deprecated: core plus every extras module, for one minor release).
- `useListbox` (open list, active option, combobox ARIA and keys for Select, Combobox, MultiSelect, TimePicker, the zone field, PhoneInput's country menu and AddressAutocomplete), `useRequiredContext`, `useRefocus`, `PartButton` (a part's trigger: a button, or your element with `asChild`), `focusStep` (DOM focus roving for menus, tabs, toggle groups and toolbars), `Legend` in core (charts, StateRibbon and ByteMap share it; entries take an optional `value`), `EmptyState size="sm"`, `svgN` / `svgTranslate`, `useWheelZoom`; `usePinchPan` moves to `@lyndon/ui/motion`.
- `vizkit`: `niceStep(span, max, steps?)` (one tick-step rule for value axes, trace and time ticks) and `TrackGrid` (grid lines across a time track).
- Docs: the sidebar groups items as Core (by area), Extras (by family) and Blocks; item pages show the import path. `dist-registry/index.json` items carry `tier`, `family` and `import`; llms.txt is grouped the same way. The single-file bundles follow the tiers (`ui` is core; `ui-charts`, `ui-content`, `ui-ai` the extras), and the showcase's code drawer imports each extras module from its bundle.

### Removed
- `menuKeyMove` (use `focusStep`), `seeded`, the `@lyndon/ui/pages` and `@lyndon/ui/examples` entries.

### Changed
- Select, TimePicker and the multi-select no longer pre-compute whether to open upward: the floating panel flips by its measured height.
- PhoneInput's country button and the date-time zone field use the shared listbox (the zone list now renders through `OptionList`).
- Every build script fails when a module in `src/lib` has no tier, and `dist-single/ui-all.tsx` is type-checked.

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
