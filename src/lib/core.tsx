/**
 * `@lyndon/ui/core`: the foundation every other module builds on. React 19 with Tailwind (v3.2+ or v4), or the
 * prebuilt @lyndon/ui/styles.css. No icon package: icons are inline SVG paths (see `Icon`).
 *
 * Conventions (same as shadcn/ui):
 *   - Colours are CSS variables (see TOKENS). Use them in Tailwind as `bg-[var(--card)]`.
 *     Light/dark follows the OS; force one with <html data-theme="light|dark">.
 *   - Components take `className` and spread native props where it makes sense.
 *   - Variants are props (`variant`, `size`, `tone`), built with the tiny `variants()` helper.
 *   - Stateful inputs are controlled or uncontrolled: `value` + `onChange`, or `defaultValue`.
 *   - Animation: the `ui-*` CSS classes in TOKENS (enter/exit keyframes, spring easings) and motion.tsx's Presence, Swap,
 *     useFlip and play; no animation library. Reduced motion keeps the fades and drops the movement.
 *   - Wrap the app once in <UIProvider> (theme tokens, optional fonts, toasts). Add <ThemeScript /> to <head> to avoid a
 *     theme flash with SSR.
 *
 * The code lives in helpers, shared, locale, safe, theme, hooks, icons, slot, primitives and formcontrol (each also
 * importable as @lyndon/ui/<name>). Append icon paths to ICONS in icons.tsx, or call registerIcons().
 *
 * Shared building blocks: reach for these before writing something new.
 *   ActiveIndicator  sliding pill/underline (tabs, segmented, nav)   FloatingPanel / Popover  anchored panels
 *   ModalLayer       portal + backdrop + focus trap (dialog, sheet)   Collapse                 height 0 ↔ auto
 *   OptionList       listbox for Select / Combobox / MultiSelect      AnimatedNumber           rolling digits
 *   useControllable, useDisclosure, useRoving, useHotkey, useFocusTrap, useWidth, useLive, useFlash, spring(), MOTION, Z
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
