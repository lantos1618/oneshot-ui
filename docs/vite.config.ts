// Docs site: `pnpm docs:dev` (dev server) or `pnpm docs:build` (→ docs-dist/, deployed to GitHub Pages together with the
// registry, llms.txt and the showcase). The data under docs/generated/ comes from scripts/build-docs-data.mjs.
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { join } from 'node:path'
import { defineConfig } from 'vite'
import { showcaseCode } from '../scripts/showcase-code.ts'
import { themeScript } from '../scripts/theme-script.ts'

const root = join(import.meta.dirname, '..')

export default defineConfig({
  root: join(root, 'docs'),
  base: './',
  plugins: [react(), tailwindcss(), themeScript({ root }), showcaseCode({ root })],
  server: { fs: { allow: [root] } },
  build: { outDir: join(root, 'docs-dist'), emptyOutDir: true, chunkSizeWarningLimit: 1500 },
})
