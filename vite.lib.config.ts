// Builds the publishable library into dist/. Types come from tsconfig.lib.json (+ scripts/fix-dts.mjs).
//
//   vite build --config vite.lib.config.ts                     one ES module per source module (preserveModules), each
//                                                              starting with "use client", so `@lyndon/ui/charts` etc. are
//                                                              real entry points and App Router can import them. The barrels
//                                                              (index.js, all.js, core.js, diagrams.js, forms.js) have no directive:
//                                                              they only re-export, and Next.js rejects re-export-all inside a
//                                                              client boundary.
//   vite build --config vite.lib.config.ts --mode utils        dist/utils.js: the pure core helpers bundled on their own, with
//                                                              no directive and no imports of the client modules
//   vite build --config vite.lib.config.ts --mode utils-extras dist/utils-extras.js: the same for the extras helpers
import react from '@vitejs/plugin-react'
import { defineConfig, type UserConfig } from 'vite'
import { readdirSync } from 'node:fs'
import { BARRELS as BARREL_MODULES, assertPlaced } from './scripts/tiers.mjs'

// every module must have a tier, or it would be built (or left out) without anyone deciding where it belongs
assertPlaced(readdirSync('src/lib').filter(f => /\.tsx?$/.test(f)), 'vite.lib.config')

const external = [/^react($|\/)/, /^react-dom($|\/)/, /^motion($|\/)/]
/** Entry modules that only re-export: no 'use client' banner. */
const BARRELS = new Set(['index', 'all', ...BARREL_MODULES].map(m => `${m}.js`))

export default defineConfig(({ mode }): UserConfig => mode === 'utils' || mode === 'utils-extras'
  ? {
      plugins: [react()],
      build: {
        outDir: 'dist', emptyOutDir: false, sourcemap: false, minify: false,
        lib: { entry: { [mode]: `src/lib/${mode}.ts` }, formats: ['es'] },
        rolldownOptions: { external, treeshake: { moduleSideEffects: false, manualPureFunctions: ['createContext', 'cn', 'memo', 'uiShared', 'registerIcons'] } },
      },
    }
  : {
      plugins: [react()],
      build: {
        outDir: 'dist', emptyOutDir: true, sourcemap: false, minify: false,
        // all, core, diagrams and forms are re-export barrels: as entries they still get their own dist/*.js for their subpaths
        lib: { entry: { index: 'src/lib/index.ts', all: 'src/lib/all.ts', ...Object.fromEntries(BARREL_MODULES.map(m => [m, `src/lib/${m}.tsx`])) }, formats: ['es'] },
        rolldownOptions: {
          external,
          output: { preserveModules: true, preserveModulesRoot: 'src/lib', entryFileNames: '[name].js', banner: chunk => (BARRELS.has(chunk.fileName) ? '' : "'use client';") },
        },
      },
    })
