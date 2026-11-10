import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'vite'
import { showcaseCode } from './scripts/showcase-code.ts'

export default defineConfig({
  // showcaseCode: the view-code drawer's usage examples and props tables, built from the source (scripts/showcase-code.ts)
  plugins: [react(), tailwindcss(), showcaseCode({ root: import.meta.dirname })],
  build: { outDir: 'demo-dist' }, // dist/ is the published library
})
