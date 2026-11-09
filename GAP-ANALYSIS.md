# Gap analysis: @lyndon/ui after 0.2.0

Three passes fed this document:
- **Fixes:** a builder fixed the transit map and waterfall issues raised in review.
- **Live audit:** Playwright on desktop light/dark and iPhone 13, measuring layout shift, frames, CPU, axe-core, keyboard and screenshots.
- **Competitive comparison:** against shadcn/ui, Radix, React Aria, Mantine, Tremor, TanStack, React Flow, Aceternity/Magic UI, AI SDK Elements and assistant-ui.

Impact is H/M/L and effort is S/M/L.

## 0. Done in this round (from review feedback)

| Item | Result |
|---|---|
| Transit map: "needs approval" panel caused layout shift | Approvals float over the map next to the waiting station, with a countdown ring and a count bubble. Trace rows and the queue strip no longer shift either. **Transit card: 195 shifts (score 0.045 in 25 s) → 0**, at about 60 fps |
| Queue shown on the map | Per-station queues line up along the incoming line ("+n"). Congestion heat on each track segment runs grey → amber → red. Event-queue panel at Intake with job-slot dots and the drop count |
| Movement along the lines, not node to node | Tokens follow the drawn polyline, bends included, moved per frame through refs. Under reduced motion they jump instead of travelling. The engine now claims an agent when a token arrives, so queues are real |
| Spawn connectors in waterfalls | TraceWaterfall: elbow lines from the parent at the child's start time down into the child, with the hovered chain highlighted. The transit trace table links follow-up jobs to their trigger, dashed while queued. Gantt: phase → task connectors. The waterfall chart's existing connectors were checked and are correct |

Open: on phones the approval card covers the top-left of the map; station labels on phones are about 10 px.

## 1. Now: polish, measured defects (mostly S effort)

### Layout shift
1. **Sidebar subnav** reflows the section list. It is the largest shift source on the page: 0.24 total, and Design QA reports 0.167 "Needs work". The old subnav unmounts instantly while the new one animates open. Fix: fixed section positions, with a capped and scrolling subnav. (H/S)
2. **Masonry gallery:** images have no width or height. Tiles overflow 272 px over Media cards, then the card jumps 351 px. Fix: reserve aspect ratios. (H/S)
3. **Thinking steps** grows from 463 to 633 px and pushes the whole AI grid down. Fix: min-height, or keep finished steps one line high. (H/S)
4. **Smaller shifts:**
   - State machine workflow switch (0.037 late)
   - Error-bar toggle (0.024)
   - iPhone combobox flips above the field while typing (0.116)
   - Org chart collapse (0.041)
   - Model comparison "Run" button widening
   - Toast exits
   - Treemap, Funnel and Before/after animating layout properties instead of transforms
   - Sparkline digits jumping, because they don't use `tabular-nums`

   (M–L/S)

### Performance
5. **Data flow** forces about 2,000 layouts per second at 32% CPU: 5.8k `getPointAtLength` calls in 2 s, interleaved with attribute writes. Fix: sample each path once into a lookup table and move particles by transform, or draw them on one canvas. (H/M)
6. **Network graph** never settles once hidden by the filter: 15k mutations in 4 s while `display:none`. Fix: pause at width 0 or when not intersecting, and stop on low alpha. (H/S)
7. **Off-screen animations keep running:**
   - Spinners in Variants, Kanban and Thinking steps
   - The terminal caret, which also blinks under reduced motion
   - The empty-state loop, which runs even while hidden
   - Sparklines ticking at about 2,100 mutations/s, also under reduced motion
   - Map pulse style writes

   Fix: a shared `useInView` pause plus CSS `animation-play-state`. (M/S)
8. **Mount jank:** charts mounting on scroll (worst frame 217 ms) and the Code section (a 352 ms long task). Fix: stagger mounts and memoise highlight output. (M/M)

### Interaction
9. **Scheduler:** → on a focused event switches the week and drops focus to `<body>`. (H/S)
10. **Mega menu:** ↓ is stuck on the first link and ←/→ do nothing. Needs roving focus. (H/S)
11. **Field triggers have no hover state:** Select, the date pickers, Multi-select, Phone, Currency, accordion and list rows. Fix: a shared hover border. (M/S)
12. **Copy feedback** differs in four ways. Fix: one `CopyButton` that changes icon and label to "Copied" and announces it in a live region. (M/S)
13. **Video player** waits 8.6 s on "Preparing preview" with Play disabled. Fix: a poster with Play enabled, and clicking the surface toggles playback. (M/M)
14. **Phones:**
    - Process flow and org chart need fit-to-view.
    - Split panes should stack below 640 px.
    - Settings tabs and the AI canvas code need edge fades.

    (M/M)
15. **The AI canvas preview** logs 4 "blocked script" console errors. Fix: strip scripts before writing srcdoc. (L/S)

### Accessibility
16. **Tab order:** 54% of the page's Tab stops are showcase chrome: 575 tag chips and 149 code buttons. Fix: a roving chip group and a "skip to demo" link. (H/S)
17. **Charts have no keyboard access:** 15 charts have zero focusable elements, while Heatmap already supports arrows. Fix: a shared chart focus model with one Tab stop, arrows through points, a tooltip on focus and a data summary. (H/M)
18. **axe, fixable at the root:**
    - `aria-prohibited-attr` ×42: all from `AnimatedNumber`, `aria-label` on a span. One fix in core.
    - `label-content-name-mismatch` ×41.
    - `color-contrast`: 19 nodes in light, 13 in dark. Outside-month days 2.1:1, canvas line numbers 2.5:1.
    - `nested-interactive`: Sankey, Network graph, Data flow.
    - Unnamed progressbars ×3.

    (M/S)
19. **SegmentedControl** is announced as a toggle button. Fix: a radiogroup. Also: the Data grid filter bar is 37 Tab stops deep, and Design QA's contrast check misses element opacity. (L/S)

### Consistency
20. **Token debt:**
    - Radii: 17 different values (3 px ×343).
    - Font sizes: 26 different values.
    - Control heights: 20 one-off values.
    - Button sizes: some fall outside sm/md.

    Fix: radius tokens, a type scale, and an `xs` button size. (M/M)
21. **Charts:**
    - Series coloured `--fg` render glaring white in dark mode. Needs a `--c-neutral` token.
    - Chart controls sit in different places.
    - Candlestick has no date axis.

    (M/S)
22. **Mixed patterns:**
    - Five badge shapes.
    - KPI numerals switch between mono and sans.
    - Two tree styles.
    - US and UK spelling are mixed.
    - Section grid rows leave 150–255 px of blank space.

    (L/S)

### Showcase
23. **About 15 cards** open empty or with little to show: Chat, Model comparison, Progress 0%, Mega menu, Agent plan 0/4 and others. Fix: start them mid-flow. (H/M)
24. **Inputs show only the default state.** Add a states row: error, disabled, read-only, size, loading. Overlay cards should also show an inline preview of the open state. (M/M)
25. **"View code" is invisible until hover.** Keep it visible, add shortcut chips, and add a Props tab to the code drawer. (M/S)

## 2. Next: capability gaps vs the field (P0/P1)

| # | Gap | Pri | Effort | Evidence / approach |
|---|---|---|---|---|
| 1 | **Real AI streaming.** A message model with parts (text, reasoning, tool, source, file, data), an adapter for AI SDK `useChat`, ReadableStream or AsyncIterable, and stop via AbortSignal | P0 | L | Every AI component is scripted today: `respond(q)=>ChatScript`, the canned `CanvasEdit[]` |
| 2 | **Streaming-safe Markdown `Response`.** GFM, tables, code fences into CodeBlock, tolerant of half-received tokens, links through `safeUrl` | P0 | M | There is no Markdown rendering at all |
| 3 | **Tests + CI.** Vitest/Testing Library, axe per card, Playwright screenshots (light/dark/390), CLS budgets from this audit | P0 | L | Only `test:ssr` exists |
| 4 | **Form-native controls.** `name`, `required`, `disabled`, `invalid`, `onBlur`, `ref` and a hidden input on Select, Combobox, MultiSelect, pickers, TagInput, Slider, OTP, Phone, Currency | P0 | M | Only 3 of 31 form exports take `disabled`. This blocks react-hook-form and server actions |
| 5 | **`Form`/`FormField`** context for react-hook-form + zod | P0 | S | `Field` already exists |
| 6 | **Async Combobox:** loader, debounce, loading/error states, creatable, groups | P0 | M | It takes static `options` only |
| 7 | **`VirtualList`** used in DataGrid, OptionList, CommandPalette, TreeView and Chat | P0 | M | Zero virtualization today |
| 8 | **DataGrid server mode,** column pin/hide/reorder, a selection API, ARIA grid keys | P0 | L | The flagship grid can't be backed by an API |
| 9 | **i18n:** `locale` + `messages` on UIProvider, Intl names, `weekStartsOn` | P0 | M | `LOCALE='en-GB'` constant; hardcoded `Mo…Su` |
| 10 | **RTL:** logical utilities, mirrored keys and placements | P1 | M | 330 physical classes, 0 logical ones |
| 11 | **Composable parts + `asChild`** for Tabs, Dialog, Accordion, Select, Menu, Tooltip, alongside the config props | P1 | L | Advertised as "shadcn-style", but the APIs are config arrays only |
| 12 | **Registry/CLI** (`npx … add data-grid`) and one drop-in file per component | P1 | M | `ui.tsx` is 424 KB (~120k tokens) and `ui-all` 1.27 MB, too big for a chat |
| 13 | **Docs site** with props tables generated from the types, plus `llms.txt` | P1 | M | Props are documented only in JSDoc |
| 14 | **Dates:** min/max/unavailable dates, DateTimePicker, segmented DateField/TimeField, time zones | P1 | M | `TimePicker` is a Select of 15-minute slots |
| 15 | **AI Elements-style parts,** exported separately: Conversation (stays scrolled to the newest message), Branch switcher, Actions, Reasoning, Suggestions, context meter, PromptInput with attachments, Tool with arguments/results | P1 | M | Today these only live inside the monolithic `AssistantChat` and `AgentComposer` |

**Missing components (P1 unless noted):**
- **Primitives:**
  - AlertDialog (P0, S)
  - Toggle/ToggleGroup
  - Toolbar
  - Checkbox/radio menu items
  - Stack/Grid/Text/Heading layout primitives
  - Router-agnostic Link
  - Drawer with snap points
  - Icon adapter, so any `icon` prop takes a ReactNode
  - Input group (prefix/suffix)
  - Generic input mask
- **Data:**
  - Node editor in the React Flow class: handles, connect, minimap, undo, JSON
  - Horizontal bar/pie
  - Time/log axes and reference lines
  - Brush/zoom and synced crosshair
  - Faceted filter bar
- **Marketing:**
  - Marquee
  - Text effects
  - Hero/bento/testimonials/FAQ/footer blocks
- **Existing components:**
  - Toast: return an id, plus update and promise toasts.
  - Tabs: vertical orientation and overflow.
  - CommandPalette: groups, async and nested pages.
  - FileUpload: paste, camera, resumable uploads and limits.
  - Chart kit: export, a data-table fallback, more than 4 series colours.
  - Scheduler: RRULE, resources, agenda view.
  - RichTextEditor: a document model or Tiptap adapter.
- **Platform:**
  - Token system v2: spacing, type, z-index, motion, info tone, multiple brands, DTCG / Tailwind `@theme` export.
  - CHANGELOG + Changesets.
  - Bundle budgets: geo.js is 122 KB, 67 KB of it map data that should be lazy-loaded.
  - Server Component-safe display primitives.
  - Licence wording: it isn't OSI MIT, so say so plainly.

## 3. Differentiators: double down

1. **Agent operations visuals:** transit map, state machine, trace waterfall, plan, approvals with undo. Nobody else ships these. Next steps:
   - Adapters from AI SDK steps, LangGraph and OpenTelemetry GenAI spans, so the map and waterfall render live runs.
   - A congestion/queue API on top of this round's `queues`/`occupancy()`.
   - An "agent run" page template.
2. **Safe by default for model output:** `safeUrl`/`safeColor`, the sandboxed preview, validated storage, the CSP guide. Make it a headline, publish the threat model, and carry it into Markdown `Response`.
3. **Single-file AI drop-ins:** per-component files with their dependencies, `llms.txt`, an MCP server listing components and props, and a measured token cost per file.
4. **Theme engine:** export to Tailwind `@theme`, shadcn variables and DTCG, plus a shareable theme-builder page.
5. **Whole widgets** (Gantt critical path, DataGrid, Kanban, statistical charts): add headless hooks underneath (`useGridModel`, `useGanttModel`).

## 4. Cut or simplify

- **Sample content as defaults:**
  - RichTextEditor ships `RTE_SAMPLE` as its default value. This is a bug: real users get the sample document.
  - AICanvas sample edits, `AC_MODELS`, the VoiceInput transcript, and the transit/state machine default workflows.

  Move them to `@lyndon/ui/examples`.
- **Demo-only exports:** `mediaArt`, `mediaSynthTrack`, `describeSample`, `PAGE_CSS`, `MotionPlayground`, `PhoneFrame`. Move them to examples.
- **Merge duplicates:**
  - StreamingText + useStreamedText
  - Citation/ChatSources/SourcesPanel
  - ChatComposer + AgentComposer → PromptInput
  - ShortcutSheet + ShortcutOverlay
  - Collapse + AutoHeight
  - Statechart/StateDiagram/StateMachine → one renderer
  - Move InlineDatePicker into forms
- **Split big modules:** diagrams.tsx (1.8k lines), core.tsx, forms.tsx, and geo map data as lazy JSON.
- **Page blocks** (Pricing, Checkout, Cookie consent, Onboarding) belong in a copy-in "blocks" tier through the registry, not the stable API.
- **Stop recommending `ui-all.tsx`/`ui-with-examples.tsx` for AI chats.** They are too large.

## Suggested order

1. **0.2.1 polish.** One pass over section 1, items 1–19. Each is small and measured, and CI can then lock in budgets for CLS, long tasks and axe.
2. **0.3 real data.** Streaming message parts + Markdown Response, form-native controls + Form, async Combobox, VirtualList, the RichTextEditor default fix, tests + CI.
3. **0.4 reach.** i18n/RTL, DataGrid server mode, date/time, AI Elements-style parts, registry + per-component drop-ins, docs site.
4. **Moat.** Live adapters for the transit map and waterfall (OpenTelemetry/LangGraph/AI SDK), theme exports, MCP/`llms.txt`.

Evidence (scripts, JSON, screenshots) is in the session scratchpad under `ux-audit/`, `gap/` and `transit/`.
