// Provenance shared by build-single and build-registry: package version, git commit (+dirty), checksums and the one-line
// file header. Importing it has no side effects; the two builds call assertProvenance() before writing anything.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { root } from '../paths.mjs'

export { root }
export const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
const git = args => { try { return execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim() } catch { return '' } }
export const commit = git(['rev-parse', '--short=12', 'HEAD'])
export const dirty = commit && git(['status', '--porcelain', '--', 'src', 'scripts', 'package.json']) ? '+dirty' : ''
export const sha256 = text => createHash('sha256').update(text, 'utf8').digest('hex')

/** Throws unless UI_VERSION matches package.json, and, for a release build (RELEASE=1), unless the git tree is clean. */
export function assertProvenance() {
  const uiVersion = /export const UI_VERSION = '([^']+)'/.exec(readFileSync(join(root, 'src/lib/shared.tsx'), 'utf8'))?.[1]
  if (uiVersion !== pkg.version) throw new Error(`UI_VERSION in src/lib/shared.tsx (${uiVersion}) must match package.json (${pkg.version})`)
  if (process.env.RELEASE && (dirty || !commit)) throw new Error('release build from a dirty or unknown git tree: commit first')
}

const docs = (pkg.homepage ?? '').replace(/#readme$/, '')
/** 'use client' and the one-line header: `/*! @lyndon/ui <ver> · <name> · <docs url> · needs ui-provider.tsx *\/`. */
export const header = (name, { needsProvider = true } = {}) =>
  `'use client'\n/*! ${pkg.name} ${pkg.version} · ${name} · ${docs}${needsProvider ? ' · needs ui-provider.tsx' : ''} */\n`
