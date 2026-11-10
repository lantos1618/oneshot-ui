// The pre-paint theme script for the showcase's and the docs site's index.html: <ThemeScript>'s output
// (themeScriptSource() in src/lib/provider.tsx), generated from the source on every build so a page can't ship a stale
// copy, and a page without the placeholder fails the build instead of flashing the wrong theme.
import { join } from 'node:path'
import { runnerImport, type Plugin } from 'vite'

/** Where index.html wants the script. */
export const THEME_SCRIPT_MARK = '<!-- theme-script -->'

/** `html` with the placeholder replaced by `<script>{source}</script>`; throws when either is missing. */
export function themeScriptHtml(html: string, source: string) {
  if (!source.trim()) throw new Error('theme-script: themeScriptSource() returned no script')
  if (!html.includes(THEME_SCRIPT_MARK)) throw new Error(`theme-script: index.html has no ${THEME_SCRIPT_MARK} placeholder`)
  return html.replace(THEME_SCRIPT_MARK, () => `<script>${source}</script>`)
}

/** Vite plugin: fills the placeholder with themeScriptSource() as the library at `root` builds it (defaults). */
export function themeScript({ root }: { root: string }): Plugin & { transformIndexHtml: (html: string) => Promise<string> } {
  let cached: Promise<string> | null = null, build = false
  const load = () => runnerImport<{ themeScriptSource: () => string }>(join(root, 'src/lib/provider.tsx'), { root, configFile: false, logLevel: 'error' })
    .then(r => r.module.themeScriptSource())
  return {
    name: 'theme-script',
    configResolved(c) { build = c.command === 'build' },
    // the dev server re-reads the source on each page load, so an edit to the theme code shows up
    async transformIndexHtml(html: string) { return themeScriptHtml(html, await (build ? (cached ??= load()) : load())) },
  }
}
