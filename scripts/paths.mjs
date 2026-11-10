// Repository paths and build-step guards shared by the scripts.
import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

/** The repository root as a file path (URL.pathname would keep %20 and a leading / before a Windows drive letter). */
export const root = fileURLToPath(new URL('..', import.meta.url))

/** CI and release builds treat warnings as failures. */
const STRICT = !!(process.env.CI || process.env.RELEASE)

/** Logs `script: msg`, or throws it under CI or RELEASE so a skipped item can't pass unnoticed. */
export function warnOrFail(script, msg) {
  if (STRICT) throw new Error(`${script}: ${msg}`)
  console.warn(`${script}: ${msg}`)
}

/** The absolute path of a build output (repo-relative `rel`); throws naming the step that makes it when it is missing. */
export function requireBuilt(rel, step) {
  const path = join(root, rel)
  if (!existsSync(path)) throw new Error(`${rel} is missing: run \`${step}\` first`)
  return path
}

/** The module files in src/lib (`x.tsx`, plus the `.ts` entries). */
export const libFiles = () => readdirSync(join(root, 'src/lib')).filter(f => /\.tsx?$/.test(f))
