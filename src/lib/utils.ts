/**
 * `@lyndon/ui/utils`: pure helpers with no hooks, no browser APIs and no "use client" directive, so they
 * can be called from React Server Components, route handlers and build scripts. The published build
 * bundles their code into dist/utils.js (it does not import the client modules).
 */
export { safeUrl, safeMediaUrl, cssUrl, safeCssValue, safeColor, maxOf, minOf, extent } from './core'
export { cn, variants, spring, sleep, mix, contrast, derive, themePalette, themeTokens, themeCSS, themeStored, editPalette, THEMES, FONTS, DEFAULT_THEME, TOKENS, PAGE_CSS, FONT_CSS } from './core'
export type { Palette, Theme, ThemeSettings, CustomTheme } from './core'
export { themeScriptSource } from './provider'
export { highlightCode, codeLineDiff, codeLanguageOf, CODE_LANGUAGE_NAMES } from './code'
export type { CodeLanguage, CodeDiffRow } from './code'
export { wordDiff } from './ai'
export type { DiffSeg } from './ai'
export { formatDate } from './forms'
