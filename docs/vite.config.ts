// Docs site: `pnpm docs:dev` (dev server) or `pnpm docs:build` (→ docs-dist/, deployed to GitHub Pages together with the
// registry, llms.txt and the showcase). The data under docs/generated/ comes from scripts/build-docs-data.mjs.
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { readFileSync } from 'node:fs'
import { defineConfig, type Plugin } from 'vite'

const root = new URL('..', import.meta.url).pathname

// the same theme script as the showcase's index.html (ThemeScript's output), so the saved theme applies before paint
const themeScript = (): Plugin => ({
  name: 'docs-theme-script',
  transformIndexHtml(html) {
    const script = /<script>\(function\(k,l,d,N,V\)[\s\S]*?<\/script>/.exec(readFileSync(`${root}index.html`, 'utf8'))?.[0] ?? ''
    return html.replace('<!-- theme-script -->', script)
  },
})

export default defineConfig({
  root: `${root}docs`,
  base: './',
  plugins: [react(), tailwindcss(), themeScript()],
  server: { fs: { allow: [root] } },
  build: { outDir: `${root}docs-dist`, emptyOutDir: true, chunkSizeWarningLimit: 1500 },
})
