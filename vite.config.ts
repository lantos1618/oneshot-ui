import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'vite'
import { showcaseCode } from './scripts/showcase-code.ts'
import { themeScript } from './scripts/theme-script.ts'

export default defineConfig({
  // showcaseCode: the view-code drawer's usage examples and props tables, built from the source (scripts/showcase-code.ts)
  plugins: [react(), tailwindcss(), themeScript({ root: import.meta.dirname }), showcaseCode({ root: import.meta.dirname })],
  build: { outDir: 'demo-dist' }, // dist/ is the published library
})
