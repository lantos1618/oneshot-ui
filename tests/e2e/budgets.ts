// Budgets for the showcase e2e checks. Tighten these as the polish work lands; loosen one only with a reason.

/** Layout-shift budget while a section is scrolled through: the sum of layout-shift values not caused by input. */
export const CLS_BUDGET = 0.05

/**
 * Per-section CLS overrides, keyed `section` (all profiles) or `profile:section`. Each entry needs a reason and,
 * ideally, a GAP-ANALYSIS.md item that will let it go.
 */
export const CLS_OVERRIDES: Record<string, { budget: number; reason: string }> = {
}

/**
 * Console errors that are known and tolerated, as [section or '*', pattern, reason]. Anything else logged with
 * console.error or thrown on the page fails the test.
 */
export const ALLOWED_CONSOLE_ERRORS: [section: string, pattern: RegExp, reason: string][] = [
]

/** How long to wait on each viewport-sized step while scrolling through a section (whileInView mounts, entry animations). */
export const STEP_DWELL_MS = 450
/** Extra settle time after the last step, before measuring axe and overflow. */
export const SETTLE_MS = 900
