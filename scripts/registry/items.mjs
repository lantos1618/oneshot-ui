// Which registry items (drop-in files) exist and what each one exports.
//
// Every exported component of src/lib becomes an item named after it in kebab-case (DataGrid → data-grid), unless it
// is listed in a FAMILY below, which groups parts that are used together into one file (Popover + PopoverTrigger +
// PopoverContent …) and attaches the hooks and helpers that belong to them. Names that a family lists but the library
// no longer exports are skipped with a warning, so the list survives refactors.
//
// BLOCKS are copy-in page sections (src/blocks/*.tsx, or still in src/lib while they move): they become
// `registry:block` items. EXCLUDE lists demo-only exports that get no item.

/** @type {Record<string, { roots: string[], title?: string, type?: string, description?: string }>} */
export const FAMILIES = {
  // foundation
  'ui-provider': { roots: ['UIProvider', 'ThemeScript', 'useTheme', 'themeScriptSource'], title: 'UIProvider', description: 'Wrap your app once: injects the theme tokens (CSS variables), applies and saves the theme (light, dark, system, seven palettes), provides the locale (English strings; add messages-de / messages-ar for those), hosts page-level UI such as the toast region and turns motion off for reduced-motion users. ThemeScript applies the saved theme before paint. Every other drop-in needs it; toasts, icons, translations and the appearance menu are separate items.' },
  'messages-de': { roots: ['UI_MESSAGES_DE'], title: 'German UI strings', type: 'registry:lib', description: 'German strings for the built-in UI: <UIProvider locale="de-DE" messages={UI_MESSAGES_DE}>. Machine-drafted; have a native speaker review them.' },
  'messages-ar': { roots: ['UI_MESSAGES_AR'], title: 'Arabic UI strings', type: 'registry:lib', description: 'Arabic strings for the built-in UI (right to left from the locale): <UIProvider locale="ar-EG" messages={UI_MESSAGES_AR}>. Machine-drafted; have a native speaker review them.' },
  utils: { roots: ['cn', 'variants', 'spring', 'sleep', 'clamp', 'mix', 'contrast', 'safeUrl', 'safeMediaUrl', 'safeColor', 'safeCssValue', 'cssUrl', 'fmt', 'fmtDate', 'maxOf', 'minOf', 'extent'], title: 'Utilities', type: 'registry:lib', description: 'Pure helpers: cn() and variants() for class names, spring() for motion, safeUrl/safeColor for model output, number and date formatting, clamp, mix and contrast.' },
  hooks: { roots: ['useControllable', 'useOutside', 'useDisclosure', 'useWidth', 'useSize', 'useMediaQuery', 'useCoarsePointer', 'usePointerDrag', 'useLongPress', 'useHotkey', 'useFocusTrap', 'useRoving', 'useStreamedText', 'useScrollEdges'], title: 'Hooks', type: 'registry:hook', description: 'Shared hooks: controlled-or-uncontrolled state, outside clicks, disclosure, element size, media queries, pointer drags, long press, hotkeys, focus trap, roving focus, streamed text and scroll edges.' },
  motion: { roots: ['Reveal', 'useViewport', 'useFrameLoop', 'useTween', 'play', 'shake', 'MOTION_PRESETS', 'motionTransition', 'EASE_OUT'], title: 'Motion helpers', description: 'Reveal on scroll, useViewport (pause work off screen), frame loops, tweens, play/shake keyframes and motion presets.' },
  'virtual-list': { roots: ['VirtualList', 'useVirtual'] },
  // core primitives
  button: { roots: ['Button', 'IconButton', 'buttonVariants'] },
  badge: { roots: ['Badge', 'DeltaBadge'] },
  card: { roots: ['Card', 'Separator'] },
  avatar: { roots: ['Avatar', 'AvatarStack'] },
  icon: { roots: ['Icon', 'ICONS', 'registerIcons', 'iconPath', 'isIconName'], description: 'Every icon (inline SVG paths) and <Icon>. Other drop-ins embed only the icons they draw: add this file to pass any icon name (icon="trash") to their props, or register your own paths with registerIcons().' },
  // overlays
  popover: { roots: ['Popover', 'PopoverRoot', 'PopoverTrigger', 'PopoverContent', 'PopoverClose', 'FloatingPanel', 'usePopover'] },
  'dropdown-menu': { roots: ['DropdownMenu', 'MenuItem', 'MenuSeparator', 'MenuLabel', 'MenuGroup', 'MenuShortcut', 'MenuCheckboxItem', 'MenuRadioGroup', 'MenuRadioItem', 'MenuSub', 'MenuSubTrigger', 'MenuSubContent', 'menuListVariants'] },
  'context-menu': { roots: ['ContextMenu', 'MenuItem', 'MenuSeparator', 'MenuLabel', 'MenuGroup', 'MenuShortcut', 'MenuCheckboxItem', 'MenuRadioGroup', 'MenuRadioItem', 'MenuSub', 'MenuSubTrigger', 'MenuSubContent'] },
  tooltip: { roots: ['Tooltip', 'PointerTooltip', 'usePointerTooltip', 'useHoverIntent'] },
  dialog: { roots: ['Dialog', 'ModalLayer', 'OverlayPortal', 'useScrollLock'] },
  // forms
  form: { roots: ['Form', 'FormField', 'Field', 'Label', 'FormFieldContext', 'useFormControl', 'useFormFieldProps', 'useControllableState'] },
  checkbox: { roots: ['Checkbox', 'CheckboxBox', 'CheckMark'] },
  'segmented-control': { roots: ['SegmentedControl', 'ActiveIndicator'] },
  slider: { roots: ['Slider', 'RangeSlider'] },
  select: { roots: ['Select', 'OptionList'] },
  'time-picker': { roots: ['TimePicker', 'timeOptions'] },
  'date-picker': { roots: ['DatePicker', 'formatDate'] },
  'file-upload': { roots: ['FileUpload', 'fileAccepts'] },
  // feedback
  toast: { roots: ['ToastProvider', 'useToast', 'toast'], title: 'Toast' },
  progress: { roots: ['Progress', 'ProgressRing'] },
  collapse: { roots: ['Collapse', 'AutoHeight'] },
  'copy-button': { roots: ['CopyButton', 'useCopy'] },
  confetti: { roots: ['confetti'], title: 'Confetti', type: 'registry:lib', description: 'confetti({ x, y, count }): a one-off burst of confetti from a point, drawn on a temporary canvas in the theme\'s chart colours. Does nothing under reduced motion. For real milestones, not every click.' },
  // data
  stat: { roots: ['StatCard', 'StatGrid'], title: 'Stat card' },
  'shortcut-sheet': { roots: ['ShortcutSheet', 'ShortcutOverlay'] },
  'data-grid': { roots: ['DataGrid', 'gridFilter', 'gridIsSelected', 'gridSelectedCount', 'GRID_NO_SELECTION'] },
  'sortable-list': { roots: ['SortableList', 'useDragSort'] },
  // content
  'rich-text-editor': { roots: ['RichTextEditor', 'sanitizeRichText'] },
  'unsaved-changes-bar': { roots: ['UnsavedChangesBar', 'useFormDraft'] },
  'code-block': { roots: ['CodeBlock', 'InlineCode', 'highlightCode', 'codeLanguageOf'] },
  diff: { roots: ['Diff', 'codeLineDiff'] },
  markdown: { roots: ['Markdown', 'parseMarkdown'] },
  'audio-player': { roots: ['AudioPlayer', 'useAudioTrack', 'createAudioTrack', 'useSeekSlider'] },
  // charts
  chart: { roots: ['Chart', 'Legend', 'useChartFocus', 'exportChart', 'niceTicks', 'compact', 'chartDownsample', 'PALETTE', 'CHART_NEUTRAL'] },
  // AI
  'ai-stream': { roots: ['useAiChat', 'applyAiChunk', 'toAiChunk', 'fromAiSdkUIMessageStream', 'aiMessageText', 'aiId', 'AI_LIMITS', 'AI_STREAM_VERSION'], title: 'AI streams (useAiChat)', type: 'registry:hook', description: 'The AI message model with parts (text, reasoning, tools, sources, files, data) and useAiChat, which streams from a ReadableStream, an AsyncIterable or an AI SDK UI message stream, with stop via AbortSignal.' },
  'prompt-input': { roots: ['PromptInput', 'useAutoGrow', 'useAttachments', 'AttachmentChip', 'SendButton'] },
  conversation: { roots: ['Conversation', 'useStickToBottom', 'aiNearBottom'] },
  'suggested-edit': { roots: ['SuggestedEdit', 'wordDiff'] },
  'state-machine': { roots: ['StateMachine', 'WorkflowEngine'] },
  'agent-run': { roots: ['useAgentRun', 'applyRunEvent', 'runFromEvents', 'runToEvents', 'runTotals', 'runLatestMs', 'runLaneNodes', 'agentSpanCost', 'otelTraceIds', 'otelToRunEvents', 'fromOtel', 'aiSdkResultToRunEvents', 'fromAiSdkResult', 'aiSdkRunMapper', 'fromAiSdkUIStream', 'langGraphRunMapper', 'fromLangGraphEvents', 'AGENT_RUN_LIMITS'], title: 'Agent runs (useAgentRun)', type: 'registry:hook', description: 'One model of an agent run (spans, events, tokens, cost) with a streaming reducer and useAgentRun, plus adapters from OpenTelemetry GenAI traces (OTLP/JSON), Vercel AI SDK results and UI streams, and LangGraph astream_events. TraceWaterfall, AgentTransitMap and LaneGraph draw a run.' },
  // graphs as rows
  lanes: { roots: ['LaneGraph', 'LaneGutter', 'useLaneGraph', 'layoutLanes', 'laneAncestry', 'laneColor', 'laneHash', 'laneGutterWidth', 'LANE_COLORS', 'LANE_MESSAGES'], title: 'Lane graph', description: 'Any DAG as rows: layoutLanes (headless: order, lanes, colours and each row\'s edges, O(n · lanes)), LaneGutter (one row\'s SVG slice, stretches to tall rows) and LaneGraph (a virtualised list of gutter + your renderRow, with selection, hover ancestry, keyboard moves along edges and live inserts). GitGraph is a preset of it.' },
}

/** Copy-in page sections: `registry:block` items. */
export const BLOCKS = ['PricingTable', 'Checkout', 'OnboardingChecklist', 'ProfileCard', 'CookieConsent']

/** Demo-only exports (moving to @lyndon/ui/examples): no item. */
export const EXCLUDE = ['PhoneFrame', 'MotionPlayground', 'ThemeProvider']

/** DataGrid → data-grid, OTPInput → otp-input, UIProvider → ui-provider. */
export const kebab = s => s.replace(/([a-z0-9])([A-Z])/g, '$1-$2').replace(/([A-Z]+)([A-Z][a-z])/g, '$1-$2').toLowerCase()
/** DataGrid → Data grid, OTPInput → OTP input, AICanvas → AI canvas. */
export const humanize = s => s.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2').split(' ')
  .map((w, i) => (i === 0 || /^[A-Z0-9]+$/.test(w) ? w : w.toLowerCase())).join(' ')
/** An exported value that is a React component: PascalCase, not an ALL_CAPS constant. */
export const isComponentName = n => /^[A-Z]/.test(n) && !/^[A-Z0-9_]+$/.test(n)
