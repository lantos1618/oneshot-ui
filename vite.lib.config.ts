// Builds the publishable library into dist/. Types come from tsconfig.lib.json (+ scripts/fix-dts.mjs).
//
//   vite build --config vite.lib.config.ts              one ES module per source module (preserveModules), each
//                                                       starting with "use client", so `@lyndon/ui/charts` etc. are
//                                                       real entry points and App Router can import them. The barrels
//                                                       (index.js, diagrams.js, examples.js) have no directive: they only
//                                                       re-export, and Next.js rejects re-export-all inside a client boundary.
//                                                       Also builds `@lyndon/ui/examples` (src/examples → dist/examples.js
//                                                       and dist/examples/*.js, with types from tsconfig.examples.json).
//   vite build --config vite.lib.config.ts --mode utils dist/utils.js: the pure helpers bundled on their own, with
//                                                       no directive and no imports of the client modules
import react from '@vitejs/plugin-react'
import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { defineConfig, type Plugin, type UserConfig } from 'vite'

const external = [/^react($|\/)/, /^react-dom($|\/)/, /^motion($|\/)/]
/** Entry modules that only re-export: no 'use client' banner. */
const BARRELS = new Set(['index.js', 'diagrams.js', 'examples.js'])

/**
 * Declarations for `@lyndon/ui/examples`. tsconfig.lib.json is rooted at src/lib, so the examples are declared on their
 * own (into node_modules/.tmp) and copied next to their JS: src/examples/x.tsx → dist/examples/x.d.ts (imports of
 * '../lib/y' become '../y'), and the barrel src/examples/index.ts → dist/examples.d.ts.
 */
function exampleTypes(): Plugin {
  return {
    name: 'lyndon-ui:example-types',
    apply: 'build',
    closeBundle() {
      const tmp = 'node_modules/.tmp/examples-dts'
      rmSync(tmp, { recursive: true, force: true })
      execFileSync('tsc', ['-p', 'tsconfig.examples.json'], { stdio: 'inherit' })
      const src = join(tmp, 'examples')
      mkdirSync('dist/examples', { recursive: true })
      for (const f of readdirSync(src).filter(f => f.endsWith('.d.ts'))) {
        const text = readFileSync(join(src, f), 'utf8')
        if (f === 'index.d.ts') writeFileSync('dist/examples.d.ts', text.replace(/(from\s*['"])\.\/(?!\.)/g, '$1./examples/'))
        else writeFileSync(join('dist/examples', f), text.replace(/(['"])\.\.\/lib\//g, '$1../'))
      }
    },
  }
}

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
      plugins: [react(), exampleTypes()],
      build: {
        outDir: 'dist', emptyOutDir: true, sourcemap: false, minify: false,
        // diagrams is a re-export barrel: as its own entry it still gets a dist/diagrams.js for `@lyndon/ui/diagrams`
        lib: { entry: { index: 'src/lib/index.ts', diagrams: 'src/lib/diagrams.tsx', examples: 'src/examples/index.ts' }, formats: ['es'] },
        rolldownOptions: {
          external,
          output: { preserveModules: true, preserveModulesRoot: 'src/lib', entryFileNames: '[name].js', banner: chunk => (BARRELS.has(chunk.fileName) ? '' : "'use client';") },
        },
      },
    })
