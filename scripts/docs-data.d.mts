// The shape of docs/generated/*.json, written by scripts/build-docs-data.mjs and read by the docs app (docs/src).
import type { TagId } from '../src/showcase/tags.ts'
import type { Api } from './registry/api.mjs'

/** One docs page: a registry item (dist-registry/index.json) with its props tables and where its source lives. */
export type DocsItem = {
  name: string; title: string; type: string; description: string
  tier: 'core' | 'extras' | 'block'; family: string | null; import: string | null
  kind: TagId; area: TagId; tags: TagId[]
  /** The module its first export is declared in, and that file relative to the repository (null when unknown). */
  module: string | null; sourcePath: string | null
  exports: string[]; embeds: string[]; dependencies: string[]; requires: string[]
  bytes: number; tokens: number; file: string; packageFile: string | null
  api: Api[]
}

/** docs/generated/items.json. `ref` is the commit the registry was built from (`main` when unknown), for source links. */
export type DocsData = { version: string; repo: string; ref: string; areas: [string, string][]; families: string[]; items: DocsItem[] }

/** The showcase cards a page mounts: the section (id, file, exported component) and up to three card titles in it. */
export type DocsDemo = { section: string; file: string; exportName: string; titles: string[] }

/** docs/generated/demos.json: item name → its demo. */
export type DocsDemos = Record<string, DocsDemo>
