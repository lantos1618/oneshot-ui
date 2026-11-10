// The tier of every module in src/lib. Core is the root `@lyndon/ui` entry; each extras family is reached through its
// own subpaths (`@lyndon/ui/charts`, …) and may import only core, its own modules and the families in `deps`.
// tests/unit/tiers.test.ts enforces this; build-single, the registry, the docs and the showcase code drawer read it.

/** The modules behind `@lyndon/ui`, in dependency order. */
export const CORE = [
  'helpers', 'shared', 'locale', 'safe', 'theme', 'hooks', 'icons', 'slot', 'primitives', 'formcontrol', 'core',
  'motion', 'virtual', 'magnet',
  'overlay', 'formkit', 'fields', 'select', 'inputs', 'pickers', 'upload', 'forms',
  'navigation', 'feedback', 'data', 'layout',
  'provider',
]

/** Extras families: modules in dependency order, and the families they may import besides core. */
export const EXTRAS = {
  // motion/react for the extras (core has none): every family that animates with motion lists it
  motionkit: { modules: ['motionkit'], deps: [] },
  vizkit: { modules: ['vizkit'], deps: [] },
  charts: { modules: ['annotate', 'charts', 'timeline'], deps: ['vizkit', 'motionkit'] },
  diagrams: { modules: ['diagramkit', 'gantt', 'statechart', 'trace', 'network', 'diagrams'], deps: ['charts', 'vizkit', 'motionkit'] },
  geo: { modules: ['geoworld', 'geoland', 'geo'], deps: ['vizkit', 'motionkit'] },
  content: { modules: ['code', 'markdown', 'editor'], deps: ['motionkit'] },
  lanes: { modules: ['lanes', 'gitgraph'], deps: ['content', 'vizkit'] },
  media: { modules: ['media'], deps: ['motionkit'] },
  collab: { modules: ['collab'], deps: ['motionkit'] },
  data: { modules: ['datagrid', 'scheduler', 'kanban'], deps: ['motionkit'] },
  binary: { modules: ['binary'], deps: ['vizkit'] },
  ai: { modules: ['aistream', 'ai', 'aichat'], deps: ['content', 'media', 'motionkit'] },
  agents: { modules: ['agentrun', 'aiagent'], deps: ['ai', 'content', 'diagrams', 'motionkit'] },
  theming: { modules: ['themeexport', 'appearance'], deps: ['motionkit'] },
}

/** Modules that only re-export. Nothing imports a barrel except `./core`. */
export const BARRELS = ['core', 'forms', 'diagrams']

/** Modules with no subpath export of their own (internal plumbing of their tier). */
export const INTERNAL = ['formkit', 'diagramkit', 'motionkit']

/** Data that geo loads on demand: a subpath of its own, never in a barrel. */
export const LAZY = ['geoworld', 'geoland']

/** Entry points that are not modules of a tier: the root barrel, the transitional everything-barrel and the pure helpers. */
export const ENTRIES = ['index', 'all', 'utils', 'utils-extras']

/** Single-file bundles (dist-single) by family; `ui` is core. Each bundle may import only the bundles before it. */
export const BUNDLE_FAMILIES = {
  ui: [],
  'ui-charts': ['motionkit', 'vizkit', 'charts', 'diagrams', 'geo'],
  'ui-content': ['content', 'lanes', 'media', 'collab', 'data', 'binary', 'theming'],
  'ui-ai': ['ai', 'agents'],
}

const FAMILY_OF = Object.fromEntries(Object.entries(EXTRAS).flatMap(([f, { modules }]) => modules.map(m => [m, f])))

/** 'core' or 'extras' (undefined for a module the manifest doesn't know). */
export const tierOf = m => (CORE.includes(m) ? 'core' : FAMILY_OF[m] ? 'extras' : undefined)
/** The extras family of a module ('core' for core modules). */
export const familyOf = m => (CORE.includes(m) ? 'core' : FAMILY_OF[m])

/** Bundle name → modules, in dependency order. */
export const BUNDLES = Object.fromEntries(Object.entries(BUNDLE_FAMILIES).map(([b, fams]) => [b, b === 'ui' ? CORE : fams.flatMap(f => EXTRAS[f].modules)]))
/** The single-file bundle a module is concatenated into. */
export const bundleOf = m => Object.entries(BUNDLES).find(([, ms]) => ms.includes(m))?.[0]
/** How to import a module's names from the package: `@lyndon/ui` for core, its own subpath for extras. */
export const importOf = m => (tierOf(m) === 'core' ? '@lyndon/ui' : `@lyndon/ui/${m}`)

/** Throws unless every module file in src/lib is an entry or has a tier, so a new module can't be left out of a build. */
export function assertPlaced(files, where) {
  const missing = files.map(f => f.replace(/\.tsx?$/, '')).filter(m => !ENTRIES.includes(m) && !tierOf(m))
  if (missing.length) throw new Error(`${where}: ${missing.join(', ')} not in scripts/tiers.mjs (add each to CORE or an EXTRAS family)`)
}
