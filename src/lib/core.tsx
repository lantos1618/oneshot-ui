/**
 * UI library: a single-file React component kit in the shadcn style.
 *
 * Drop this file into any React 19 project with Tailwind (v3.2+ or v4), or paste it into an AI
 * as the design system to build with. Converted from the "UI library" HTML catalogue.
 *
 *   Dependencies: react@19, react-dom@19, motion@13–14  ·  Tailwind for utility classes (or @lyndon/ui/styles.css).
 *   No icon package: icons are inline SVG paths (see `Icon`).
 *
 * Conventions (same as shadcn/ui):
 *   - Colours are CSS variables (see TOKENS). Use them in Tailwind as `bg-[var(--card)]`.
 *     Light/dark follows the OS; force one with <html data-theme="light|dark">.
 *   - Components take `className` and spread native props where it makes sense.
 *   - Variants are props (`variant`, `size`, `tone`), built with the tiny `variants()` helper.
 *   - Stateful inputs are controlled or uncontrolled: `value` + `onChange`, or `defaultValue`.
 *   - Motion: every animation uses `spring()` and respects prefers-reduced-motion (MotionConfig).
 *   - Wrap the app once in <UIProvider> (theme tokens, optional fonts, toasts). Options: storageKey, persist,
 *     fonts, target ('html' | 'self'), defaultTheme. Add <ThemeScript /> to <head> to avoid a theme flash with SSR.
 *
 * Since 0.4 this file is a barrel: the code lives in helpers, shared, locale, theme, hooks, icons, primitives, safe,
 * formcontrol and slot (each also importable as @lyndon/ui/<name>). Append icon paths to ICONS in icons.tsx.
 *
 * Contents
 *   1. Tokens and provider        8. Feedback (toasts, alerts, Collapse, async buttons)
 *   2. Utilities and hooks        9. Data display
 *   3. Icons                     10. Layout and code
 *   4. Primitives                11. AI patterns
 *   5. Floating layer + modals   12. Pages (pricing)
 *   6. Form controls             13. Charts (one SVG kit: Chart, Donut, Gauge, Radar, Scatter, Heatmap…)
 *   7. Navigation                14. More (range slider, inline edit, notifications, split pane, comments…)
 *                                    Showcase (default export) = usage examples for everything
 *
 * Shared building blocks: reach for these before writing something new.
 *   ActiveIndicator  sliding pill/underline (tabs, segmented, nav)   FloatingPanel / Popover  anchored panels
 *   ModalLayer       portal + backdrop + focus trap (dialog, sheet)   Collapse                 height 0 ↔ auto
 *   OptionList       listbox for Select / Combobox / MultiSelect      AnimatedNumber           rolling digits
 *   useControllable, useDisclosure, useRoving, useHotkey, useFocusTrap, useWidth, spring()
 *
 * Overriding a component's own classes: there is no tailwind-merge, so use Tailwind's important
 * prefix, e.g. <Input className="!h-8" />.
 */
export * from './helpers'
export * from './shared'
export * from './locale'
export * from './safe'
export * from './theme'
export * from './hooks'
export * from './icons'
export * from './slot'
export * from './primitives'
export * from './formcontrol'
