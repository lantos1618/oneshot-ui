/**
 * `@lyndon/ui/utils/extras`: the pure helpers of the extras tier (code highlighting and diffs, word diffs, theme export
 * and OKLCH conversion), with no hooks, browser APIs or "use client", for servers and build scripts. Bundled on its own
 * into dist/utils-extras.js like `@lyndon/ui/utils`.
 */
export { themeExportSource, themeExport, themeToCSS, themeToTailwind, themeToShadcn, themeToDTCG, themeToDTCGTokens, themeToTokensStudio, themeImport, themeImportSettings, hexToOklch, oklchToHex, oklchString, THEME_EXPORT_FORMATS, THEME_DTCG_EXTENSION, THEME_IMPORT_MAX } from './themeexport'
export type { ThemeExportMode, ThemeExportSource, ThemeExportInput, ThemeExportFormat, ThemeTailwindOptions, ThemeImportFormat, ThemeImportNote, ThemeImportResult } from './themeexport'
export { highlightCode, codeLineDiff, codeLanguageOf, CODE_LANGUAGE_NAMES } from './code'
export type { CodeLanguage, CodeDiffRow } from './code'
export { wordDiff } from './ai'
export type { DiffSeg } from './ai'
