// Writes dist/tokens.css: the same CSS UIProvider puts in its <style> (TOKENS, the page rule and UI_DIR_CSS), for apps
// whose CSP has no 'unsafe-inline' or nonce for styles. Link it (or `import '@lyndon/ui/tokens.css'`) and render
// <UIProvider injectStyles={false}>. Reads the built dist/utils.js, so run it after build:lib.
import { readFileSync, writeFileSync } from 'node:fs'

const dist = new URL('../dist/', import.meta.url)
const { TOKENS, UI_DIR_CSS } = await import(new URL('utils.js', dist).href)
if (typeof TOKENS !== 'string' || typeof UI_DIR_CSS !== 'string') throw new Error('dist/utils.js does not export TOKENS and UI_DIR_CSS')
// The page rule UIProvider adds with target="html" (PROVIDER_PAGE_CSS in src/lib/provider.tsx): kept in step by this check.
const PAGE = 'html{background:var(--bg);color:var(--fg)}'
if (!readFileSync(new URL('provider.js', dist), 'utf8').includes(PAGE)) throw new Error('dist/provider.js no longer carries the page rule; update scripts/build-tokens.mjs')
const css = `/* @lyndon/ui theme tokens: the CSS UIProvider injects. Use with <UIProvider injectStyles={false}>.
   The html rule themes the page background (UIProvider adds it with target="html", the default); the [dir=rtl] rules
   mirror .ui-flip icons in right-to-left locales. */
${TOKENS}
${PAGE}
${UI_DIR_CSS}
`
writeFileSync(new URL('tokens.css', dist), css)
console.log(`tokens.css ${(css.length / 1024).toFixed(1)} KB`)
