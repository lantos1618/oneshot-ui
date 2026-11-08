// Writes dist/tokens.css: the same CSS UIProvider puts in its <style> (TOKENS + PAGE_CSS), for apps whose CSP has no
// 'unsafe-inline' or nonce for styles. Link it (or `import '@lyndon/ui/tokens.css'`) and render <UIProvider injectStyles={false}>.
// Reads the built dist/utils.js, so run it after build:lib.
import { writeFileSync } from 'node:fs'

const dist = new URL('../dist/', import.meta.url)
const { TOKENS, PAGE_CSS } = await import(new URL('utils.js', dist).href)
if (typeof TOKENS !== 'string' || typeof PAGE_CSS !== 'string') throw new Error('dist/utils.js does not export TOKENS and PAGE_CSS')
const css = `/* @lyndon/ui theme tokens: the CSS UIProvider injects. Use with <UIProvider injectStyles={false}>.
   The last rule themes the page background; it applies with target="html" (the default). */
${TOKENS}
${PAGE_CSS}
`
writeFileSync(new URL('tokens.css', dist), css)
console.log(`tokens.css ${(css.length / 1024).toFixed(1)} KB`)
