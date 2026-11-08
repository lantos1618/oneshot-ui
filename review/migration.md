# Migration round: fixes left for module owners

From the packaging/SSR round (`pnpm test:ssr` renders every section with react-dom/server; 19 of 21 pass).

1. **media.tsx `createAudioTrack`**: `new Audio()` runs inside `useState` initialisers → `Audio is not defined` on the server (MediaSection and the whole page fail SSR). Create the element lazily (first play/seek/load) or return an inert handle when `typeof Audio === 'undefined'`. `useAudioTrack`: `useSyncExternalStore(track.subscribe, track.get, track.get)`.
2. **diagrams.tsx NetworkGraph**: `Math.random()` initial layout → hydration mismatch. Deterministic layout (golden-angle spiral by index) or start the simulation in an effect.
3. **charts.tsx `useChartCoarse`**: matchMedia in a `useState` initialiser → use core `useCoarsePointer()`.
4. **ai.tsx `aiUseMedia`** (exported, used by aichat/aiagent): same issue → use core `useMediaQuery`; remove the export (also `aiTouch` → core `TOUCH`).
5. **charts.tsx `type Tweenable`** duplicates motion.tsx's export → breaks ui-all/ui-with-examples typecheck (TS2395). Import it from `./motion`.
6. **`new Date()` during render**: forms `Calendar`, charts `CalendarHeatmap` (`end = new Date()`), collab `inboxTime`, scheduler today/now-line → set "today" after mount (or a `today` prop) / `suppressHydrationWarning` on clocks.
7. **editor.tsx (signature pad) and geo.tsx (globe)** watch `<html>` for theme changes → with `UIProvider target="self"` canvases won't redraw. Depend on `useTheme().tokens` instead.
8. **showcase kit.tsx `useSpecs`**: add a server snapshot.
9. **core.tsx header comment**: says React 18/19 and "injects tokens + fonts"; update to React 19 and the new provider options.

Also from review/reuse.md and review/bugs.md: migrate every area to the shared pieces created in the foundation round, delete duplicates and local workarounds (touch hit-area hacks for Button/IconButton/CopyButton/SegmentedControl/Switch/Checkbox, the custom citation card if HoverCard now handles tap, slider touch area), and fix the remaining bugs in each area.
