// Types for api.mjs, as far as TypeScript callers (scripts/showcase-code.ts) use it.
import type { Graph } from './analyze.mjs'
export type ApiProp = { name: string; type: string; required: boolean; default: string | null; doc: string }
export type Api =
  | { name: string; kind: 'component'; doc?: string; props: ApiProp[]; inherited: number; inheritedFrom?: string[] }
  | { name: string; kind: 'hook' | 'function' | 'value'; doc?: string; signature: string }
export function apiOfDecl(graph: Graph, name: string): Api | null
