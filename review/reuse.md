# Reuse review: duplication and shared pieces

Line numbers approximate; search by name.

## Ranked opportunities

| # | Opportunity | Duplicated in | Shared piece | Effort |
|---|---|---|---|---|
| 1 | Second workflow engine | aiagent `aiFlowEngine` + `AT_MACHINES` ≈ diagrams `WorkflowEngine` + DiagramsSection `WORKFLOWS` | One `WorkflowEngine` (segment/meter hooks) + shared `AGENT_WORKFLOWS` | M |
| 2 | Five private icon sets | layout `LY_GLYPH/LyGlyph/LyGrip`, editor `EDITOR_GLYPHS`, diagrams `DIAGRAM_ICONS/DgGlyph/DG_PLAY`, code `CODE_ICON/CodeSvg`, media `MEDIA_ICON/MediaSvg` (many copies/drifts of ICONS) | Fold ~30 unique paths into `ICONS`; `Icon` gets `filled`, `style`; delete wrappers | S–M |
| 3 | Inline `<svg>` icons | aiagent play/pause, aichat list-plus, media volume + compare arrows, datagrid chevron, diagrams `DgChevron`, ProcessFlow tick | `<Icon>` (in motion.span for rotation) | S |
| 4 | Drawn check / checkbox box rebuilt | forms Checkbox + OptionList box, data TaskList, pages OnboardingChecklist, feedback AsyncButton, ai tick | forms `CheckMark`, `CheckboxBox` | S |
| 5 | Step/status icon ×4 | ai `StepIcon`, layout `KanbanCheck`, diagrams ProcessFlow badge, navigation `Steps` | core `StatusIcon({status,size,number})` | S |
| 6 | Hand-rolled spinners ×5 | editor UnsavedChangesBar, layout KanbanCheck, diagrams trace/process, ai StepIcon | core `Spinner` (+tone) | S |
| 7 | Tap-away/Escape dismiss ×5 | charts `useChartDismiss`, diagrams `useDgDismiss`, geo map/globe inline, editor emoji inline | core `useOutside(refs, fn, enabled, {escape, keep})` | S |
| 8 | Touch-vs-hover helpers | charts `chartIsTouch/chartLeave/chartFree`, diagrams `dgLeave`, aiagent `atFollow`, geo, ai Citation | core `isTouch`, `onMouseLeave`, `releaseTouchCapture`; export overlay `useHoverIntent` | S |
| 9 | Citation re-implements HoverCard | ai `Citation` (timers, clamp, flip, pin) | `HoverCard` + `pinOnClick` | S |
| 10 | Hand-rolled listbox/menu popovers | ai `ConfidenceField` (copies menuItemClass), aichat `AcPanel` + slash list, editor Mentions + AddressAutocomplete | `FloatingPanel` + `OptionList` + `useRoving`; `MenuItem` for AcPanel | M |
| 11 | Hand-written arrow roving ×6 | editor ×2, aichat AcPanel, pages SettingsPage, navigation Tabs, code CodeHeaderTabs | `useRoving` + orientation, Home/End, focusRefs | S |
| 12 | Tablists with own overflow fade | code `CodeHeaderTabs`, editor emoji tabs, pages settings nav | navigation `Tabs` (variant, bare) + `ScrollEdges` | M |
| 13 | Static "scrolls sideways" hints | aiagent ×2, diagrams statechart | `ScrollEdges` (move to core) | S |
| 14 | rAF + IntersectionObserver by hand | aiagent transit map, collab LivePresence, collab ChatInbox | `useFrameLoop` (move to motion) + `useInView` | S |
| 15 | Tween helpers | charts `useChartTween`, diagrams `countTo`/`DgDot`, media compare intro | motion `useTween`, `tween()` | S |
| 16 | Shake/play helpers ×6 | editor, forms, data, pages, collab, diagrams/feedback | motion `play(el,kf)`, `shake(el)` | S |
| 17 | Media-query helpers ×9 | ai `aiUseMedia` (exported), charts `useChartCoarse`, editor/forms/layout reduced/coarse, inline matchMedia | core `useMediaQuery`, `useCoarsePointer`, `prefersReducedMotion()`, `isCoarsePointer()` | S |
| 18 | Size hooks ×4 | media masonry, scheduler (useWidth copies); code `useCodeHeight`, ai `AutoHeight` | core `useWidth`, `useSize`; export `AutoHeight` from feedback | S |
| 19 | Height collapse by hand ×4 | ai, aiagent, appearance, datagrid | feedback `Collapse` | S |
| 20 | Typing dots ×2 | collab `InboxTyping` copies ai `TypingDots` | `TypingDots` in feedback | S |
| 21 | Composer/send button ×5 | ai ChatComposer, aichat AssistantChat + AgentComposer, aiagent AICanvas, collab ChatInbox | `SendButton`, `useAutoGrow` (or Textarea) | M |
| 22 | Chat bubble markup | ai ChatMessage (unused), collab, editor, media VoiceNote, aichat | `ChatBubble` | S |
| 23 | Three LCS diffs | code `codeLineDiff`, aiagent `aiLineDiff`, ai `wordDiff` | `lcsDiff<T>()` | S |
| 24 | Regex tokenisers | code `highlightCode`, aiagent `aiHighlight`, datagrid `gridMark`, forms `formsHighlight` | html/css in `CODE_LANGS`; core `splitMatches` | S |
| 25 | Copy button ×3 | feedback CopyButton, code CodeCopyButton, aichat inline | `useCopy`; CopyButton className/iconOnly | S |
| 26 | Date helpers ×8 | forms, scheduler, charts, datagrid, data, diagrams | core date section | S |
| 27 | Number formatters | forms/aichat file size, aiagent/diagrams cost, compact, money, duration; `'en-GB'` ×21 | core `fmt` + `LOCALE` | S |
| 28 | Media seek sliders ×4 | media Video/Audio/Mini/VoiceNote | `useSeekSlider` | S |
| 29 | Waveform bars ×3 | media Audio + VoiceNote, ai VoiceInput | `Waveform` | S |
| 30 | Sparkline renderers ×4 | charts SparkChart, data Sparkline (unused), StatCard inline, KanbanMetric inline | `SparkChart` everywhere | S |
| 31 | Delta pill ×3 | data StatCard, layout KanbanMetric, charts TickerTable | core `DeltaBadge` | S |
| 32 | Avatar stack ×4 | core AvatarGroup (unused), data AvatarStack, inline in ai/layout/scheduler | one `AvatarStack` in core | S |
| 33 | Toggle/suggestion chips | diagrams `DgChip`, media filters, playground presets, aichat/aiagent suggestions | core `Chip` | S |
| 34 | Range sliders restyled | motion `MotionRange`, aichat `AcStepSlider`, aiagent `atRange`, media volume | forms `Slider` (+disabled, compact, steps) | S |
| 35 | Long-press ×3 | overlay ContextMenu, layout useDragSort hold, diagrams Gantt | core `useLongPress` | M |
| 36 | Pinch/pan ×3 | media Lightbox + AvatarCropper, diagrams ProcessFlow | `usePinchPan` | M |
| 37 | Resize drags ×2 | datagrid `startResize`, layout SplitPane | `usePointerDrag` | S |
| 38 | Lightbox bypasses modal layer | media Lightbox own portal + body overflow lock (fights shared lock; outside `.ui-root`) | `OverlayPortal` + `useScrollLock` | S |
| 39 | Three tooltip renderers | diagrams `PointerTooltip`, charts `ChartTooltip`, overlay `Tooltip` | move PointerTooltip to overlay; share clamp + `TooltipRow` | M |
| 40 | Surface class strings | card surface ×20, md ×21; MegaMenu retypes floatingSurface; `Card` unused in lib | core `surface` map; move floatingSurface/menuItemClass/inputClass to core | S |
| 41 | Import cycle overlay ↔ feedback ↔ forms | EmptyState, floatingSurface, Switch, Progress | moving constants (#40) to core breaks it | S |
| 42 | Input shell classes | data InlineDatePicker, datagrid query bars | forms `inputShellClass(invalid)` | S |
| 43 | Hand-made icon buttons | code CODE_TOOL, media buttons, aichat AcBarButton, ~12 more | `IconButton` with `icon: IconName | ReactNode`, `tone: onDark` | S |
| 44 | Tap-target constants | diagrams `DG_TAP`, ai `aiTouch`, ChartsSection `CHART_TAP`, ~25 literals | core `TOUCH` | S |
| 45 | Small helpers | `dgSleep`, `mediaClamp`, `mediaMix`, forms colour helpers, focusable selectors | core `clamp`, `sleep`, colour exports, `FOCUSABLE` | S |
| 46 | Single-key hotkeys by hand | data ShortcutOverlay `?`, navigation sidebar `[` | `useHotkey(…, {ignoreEditable})` | S |
| 47 | Seeded RNG ×7 | media + 5 showcase files | `seeded()` | S |
| 48 | Two in-view hooks | motion `useInViewOnce` (unused), charts `useChartInView`; pair pattern ×6 | motion `useViewport → {ref, seen, visible}` | S |
| 49 | MenuLabel unused; retyped ×3 | ai, aichat, editor headers | `MenuLabel` | S |
| 50 | Mini trace table | aiagent transit trace ≈ TraceWaterfall | reuse `TraceRow` | L |

## Delete / unexport
- Unused: ai `ChatMessage`, `ChatComposer` (or make them the base for #21/22); core `useStreamedText`, `Separator`, `AvatarGroup`; data `Sparkline`, `ShortcutList`; motion `useInViewOnce`, `MotionRange`; overlay `MenuLabel` (use it or delete).
- Make private / move: `aiUseMedia`, `aiTouch`, `aiPricingCard`, `DIAGRAM_ICONS`, `useChartFrame`, `useChartInView`, `useChartTween`.
