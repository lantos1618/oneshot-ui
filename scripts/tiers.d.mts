export const CORE: string[]
export const EXTRAS: Record<string, { modules: string[]; deps: string[] }>
export const BARRELS: string[]
export const ENTRIES: string[]
export const INTERNAL: string[]
export const LAZY: string[]
export const BUNDLE_FAMILIES: Record<string, string[]>
export const BUNDLES: Record<string, string[]>
export function tierOf(m: string): 'core' | 'extras' | undefined
export function familyOf(m: string): string | undefined
export function bundleOf(m: string): string | undefined
export function importOf(m: string): string
export function assertPlaced(files: string[], where: string): void
