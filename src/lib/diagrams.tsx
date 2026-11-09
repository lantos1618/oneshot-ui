/* ════════════════════════════════════════════════════════════════════════════
 * 14. DIAGRAMS: plans, statecharts, traces and flows. Each one is a plain component
 *     with data props; geometry is computed in render, animation comes from motion
 *     (or a small rAF loop for anything that streams). Everything reads the theme tokens.
 *
 *     `@lyndon/ui/diagrams` re-exports the four diagram modules; import one of them
 *     (`@lyndon/ui/gantt`, `/statechart`, `/trace`, `/network`) to load only that one.
 * ══════════════════════════════════════════════════════════════════════════ */
export * from './gantt'
export * from './statechart'
export * from './trace'
export * from './network'
