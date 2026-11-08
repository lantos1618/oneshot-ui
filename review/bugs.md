# Correctness review (36 findings; ✔ = reproduced in the browser)

Line numbers approximate; search by function name.

| # | Sev | File · function | What goes wrong | Fix |
|---|---|---|---|---|
| 1 | High ✔ | forms `Select`/`Combobox`/`MultiSelect`/`PhoneInput`; editor `AddressAutocomplete`; overlay `ModalLayer` | Escape that closes a dropdown inside a Sheet/Dialog also closes the Sheet | `e.stopPropagation()` on Escape when the list is open |
| 2 | High | forms `FormsFileRow` effect deps `[f, upload]` | Inline `upload` + parent re-render cancels and restarts every upload (duplicate real uploads) | Latest-ref for `upload`; depend on `[f.id]` |
| 3 | High ✔ | forms `Calendar` range drag | Release outside the grid → drag never ends; hovering keeps changing the range | Pointer capture or end on `buttons === 0` / window pointerup |
| 4 | Med ✔ | media `VideoPlayer` container keydown | Shortcuts fire on its own controls (arrows on volume seek; M/F/Space double-fire) | Ignore events whose target isn't the container |
| 5 | Med | core `useFocusTrap` selector | Counts disabled/hidden/invisible elements; Tab escapes the modal | Filter by tabIndex ≥ 0, visible, not aria-hidden/inert |
| 6 | Med | charts `ForestPlot`, `BoxViolinChart` via `useChartTween` | Tween returns the old array for a render → crash when rows added/removed | Guard indexes or snap tween when length changes |
| 7 | Med | charts `SparkChart`; data `Sparkline` | Empty data crashes; one point → NaN path | Early return when n < 2 |
| 8 | Med ✔ | aichat `AssistantChat` stop/ask | Stop does nothing during typing-dots/tool phase | Per-turn cancelled flag checked after each sleep |
| 9 | Med | aichat `AgentComposer` cleanup | Image object URLs leak | Track URLs in a ref; revoke on unmount |
| 10 | Med ✔ | navigation `MobileTabBar` action `key={spin}` | Remount drops keyboard focus to body | Key the inner icon, not the button |
| 11 | Med | overlay `Tooltip` | `aria-describedby` on the wrapper, not the trigger → never announced | Put it on the trigger |
| 12 | Med ✔ | layout `KanbanCardView`; media `MasonryTile` | `role="button"` wrapper containing buttons/checkboxes | Group/listitem + separate open/drag button |
| 13 | Med | layout `SortableList` row | aria-label replaces row content | Content as name; instructions via aria-describedby |
| 14 | Med | aichat log, aiagent canvas log/queue, feedback `OfflineIndicator` | Live regions announce every token/second/frame | Announce summaries; aria-busy while streaming |
| 15 | Med | datagrid cell editing | Mouse/tap only; cells not focusable | Roving tabIndex on cells, Enter/F2 edits |
| 16 | Med | aiagent `AgentTransitMap` rAF setTick | Whole map + table re-render ~60×/s with `layout` rows | Throttle to 4–10 Hz; refs/motion values; drop layout |
| 17 | Med | ai `ChatComposer`, aichat input, aiagent input, forms `TagInput` | Enter submits during IME composition | `if (e.nativeEvent.isComposing) return` |
| 18 | Med | forms `Select`/`MultiSelect`, core `useRoving` | Arrow/Enter reach disabled options | Skip disabled in roving and pick |
| 19 | Med | diagrams statechart auto-play effect without deps | Interval re-armed every render; frequent renders stop auto-play | Deps `[auto, visible, interval]` + refs |
| 20 | Med | scheduler `downEvent` | Page-wide `querySelectorAll('[data-sc-col]')` → two schedulers interfere | Query within the root |
| 21 | Med | ai `Citation` | `new URL()` throws on relative/invalid URL | try/catch fallback |
| 22 | Low | overlay `MenuItem`/`DropdownMenu` | Items are Tab stops; Tab doesn't close | tabIndex −1; close on Tab/focusout |
| 23 | Low | charts `Chart` tooltip, `DonutChart` | Stale hover index after data shrinks throws | Clamp/reset hover on length change |
| 24 | Low | charts `RadarChart`/`Gauge`/`FunnelChart`/`TickerTable`; data `StatCard`; layout checklist; forms `Slider` | Divide by zero → NaN/Infinity | `|| 1` and finiteness guards |
| 25 | Low | forms `Combobox` q, `ColorPicker`, `PasswordInput`, `OTPInput` length | Controlled value copied once; later prop changes ignored | Derive from props / sync |
| 26 | Low | forms `RadioGroup` | Value not in options → no tab stop; disabled selectable | Fallback tab stop; skip disabled |
| 27 | Low | layout `useDragSort.start` | Unmount mid-drag leaves ghost, listeners, cursor | Cleanup ref + unmount effect |
| 28 | Low | editor `RichTextEditor`; pages settings timers | Debounced saves dropped on unmount | Flush on unmount |
| 29 | Low | media `AvatarCropper` | toDataURL on every pointermove | Emit on pointerup / debounce |
| 30 | Low | feedback `CopyButton`, code copy, aichat copy | "Copied" even when clipboard rejects | Set done after the promise resolves |
| 31 | Low | feedback `Toast` in `ToastProvider` | role=status inside aria-live → announced twice | One live mechanism |
| 32 | Low | aiagent code lines/trace rows; data `DataTable` onRowClick; charts `Heatmap`; media `MediaCard` | Fake buttons (tabIndex −1), clickable tr, labels on non-focusable spans | Real focusable controls or drop the role |
| 33 | Low | aiagent `AiPreview` | innerHTML into a shadow root runs inline handlers (XSS if fed model output) | Sanitize or sandboxed iframe srcdoc |
| 34 | Low | core `useHotkey` | Ignores alt; fires inside text fields (swallows Ctrl+K in inputs) | Check alt; skip editable unless opted in |
| 35 | Low | core `useRoving` | count 0 → NaN index | Early return |
| 36 | Low | layout `Timeline` key day; ai file chips; aichat queue | Duplicate/index keys on removable lists | Stable ids |

## Systemic fixes
- Handlers that consume a key call `stopPropagation()`; container shortcuts ignore events from interactive descendants.
- One `usePointerDrag` (capture, pointercancel/lostpointercapture, buttons===0 guard, unmount teardown, scoped queries) for Calendar, useDragSort, Scheduler, RangeSlider, Gantt, datagrid resize, SplitPane.
- Effects never keyed on unstable callbacks or on nothing: latest-ref pattern everywhere.
- Chart data guard (`chartSafe`) + tween that snaps on shape change.
- Real focusable elements with roving tabindex; aria-describedby for instructions; live regions for short summaries only.
