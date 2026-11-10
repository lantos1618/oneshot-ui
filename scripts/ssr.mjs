// Server rendering through Vite SSR (the TSX sources load as they are), with console.error captured per render.
// Shared by scripts/ssr-check.mjs and scripts/check-registry.mjs.
import { createServer } from 'vite'

/**
 * Runs `fn({ load, render })` against an SSR server for `root`, then restores console.error and closes the server.
 * `load(path)` is ssrLoadModule; `render(el)` is renderToString and never throws: `{ html, errors, error? }`, where
 * `errors` holds the first line of each console.error during that render.
 */
export async function withSsr(root, fn) {
  const vite = await createServer({ root, configFile: false, logLevel: 'error', appType: 'custom', server: { middlewareMode: true, hmr: false, ws: false } })
  const errors = [], origError = console.error
  console.error = (...a) => { errors.push(a.map(String).join(' ').split('\n')[0]) }
  try {
    const { renderToString } = await import('react-dom/server')
    const render = el => {
      errors.length = 0
      try { return { html: renderToString(el), errors: [...errors] } } catch (error) { return { html: '', errors: [...errors], error } }
    }
    return await fn({ load: path => vite.ssrLoadModule(path), render })
  } finally {
    console.error = origError
    await vite.close()
  }
}
