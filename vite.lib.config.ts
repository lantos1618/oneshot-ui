// Builds the publishable library into dist/. Types come from tsconfig.lib.json (+ scripts/fix-dts.mjs).
//
//   vite build --config vite.lib.config.ts              one ES module per source module (preserveModules), each
//                                                       starting with "use client", so `@lyndon/ui/charts` etc. are
//                                                       real entry points and App Router can import them. The barrel
//                                                       (index.js) has no directive: it only re-exports, and Next.js
//                                                       rejects re-export-all inside a client boundary
//   vite build --config vite.lib.config.ts --mode utils dist/utils.js: the pure helpers bundled on their own, with
//                                                       no directive and no imports of the client modules
import react from '@vitejs/plugin-react'
import { defineConfig, type UserConfig } from 'vite'

const external = [/^react($|\/)/, /^react-dom($|\/)/, /^motion($|\/)/]

export default defineConfig(({ mode }): UserConfig => mode === 'utils'
  ? {
      plugins: [react()],
      build: {
        outDir: 'dist', emptyOutDir: false, sourcemap: false, minify: false,
        lib: { entry: { utils: 'src/lib/utils.ts' }, formats: ['es'] },
        rolldownOptions: { external, treeshake: { moduleSideEffects: false, manualPureFunctions: ['createContext', 'cn'] } },
      },
    }
  : {
      plugins: [react()],
      build: {
        outDir: 'dist', emptyOutDir: true, sourcemap: false, minify: false,
        lib: { entry: { index: 'src/lib/index.ts' }, formats: ['es'] },
        rolldownOptions: {
          external,
          output: { preserveModules: true, preserveModulesRoot: 'src/lib', entryFileNames: '[name].js', banner: chunk => (chunk.fileName === 'index.js' ? '' : "'use client';") },
        },
      },
    })
