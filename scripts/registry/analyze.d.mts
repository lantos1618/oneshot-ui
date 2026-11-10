// Types for analyze.mjs, as far as TypeScript callers (scripts/showcase-code.ts) use it.
export type Graph = { decls: Map<string, unknown>; close(): void }
export function analyze(root: string, options?: { tsconfig?: string; extraDirs?: string[] }): Graph
