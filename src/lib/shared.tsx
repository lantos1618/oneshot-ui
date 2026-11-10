/**
 * State shared by every copy of the library on a page: the npm package and any number of drop-in files (registry
 * items) see the same toast queue, modal stack, scroll lock and focus-trap stack, because each lives on `globalThis`
 * under a key with the library's minor version. Also the host outlet UIProvider renders, where features that need a
 * page-level element (the toast region) mount themselves on first use. Part of @lyndon/ui/core.
 */
import { type ComponentType, useLayoutEffect, useState, useSyncExternalStore } from 'react'

/** The library version (the one source; scripts/registry/stamp.mjs checks it against package.json). */
export const UI_VERSION = '0.10.0'
/** Minor version in the globalThis keys: copies of the same minor share state; other versions keep their own. */
export const UI_SHARED_VERSION = UI_VERSION.split('.').slice(0, 2).join('.')

/**
 * A module-level singleton that every copy of the library shares (the package and each drop-in file):
 * `const stack = uiShared('modal-stack', () => [] as HTMLElement[])`. `init` runs once per page (per minor version).
 * Use it for mutable module state that must be global: stacks, locks, queues, id counters.
 */
export function uiShared<T>(name: string, init: () => T): T {
  const store = ((globalThis as { __lyndonUiShared?: Map<string, unknown> }).__lyndonUiShared ??= new Map<string, unknown>())
  const key = `@lyndon/ui@${UI_SHARED_VERSION}:${name}`
  if (!store.has(key)) store.set(key, init())
  return store.get(key) as T
}

type UIHost = { key: string; Component: ComponentType }
const uiHostState = uiShared('hosts', () => ({ hosts: [] as UIHost[], owners: [] as object[], listeners: new Set<() => void>() }))
const uiHostNone: UIHost[] = []
const uiHostSubscribe = (cb: () => void) => { uiHostState.listeners.add(cb); return () => { uiHostState.listeners.delete(cb) } }
const uiHostEmit = () => uiHostState.listeners.forEach(l => l())

/**
 * Mount `Component` once in the page-level host of the outermost UIProvider (idempotent per `key`). Features call it on
 * first use (the toast region does when the first toast is shown), so UIProvider itself doesn't bundle them.
 */
export function uiAddHost(key: string, Component: ComponentType) {
  if (uiHostState.hosts.some(h => h.key === key)) return
  uiHostState.hosts = [...uiHostState.hosts, { key, Component }]
  uiHostEmit()
}

/** Renders the registered hosts (UIProvider includes it). Only the first mounted outlet on the page renders them. */
export function UIHosts() {
  const [me] = useState(() => ({}))
  const hosts = useSyncExternalStore(uiHostSubscribe, () => uiHostState.hosts, () => uiHostNone)
  const owner = useSyncExternalStore(uiHostSubscribe, () => uiHostState.owners[0], () => undefined)
  useLayoutEffect(() => {
    uiHostState.owners.push(me); uiHostEmit()
    return () => { const i = uiHostState.owners.indexOf(me); if (i >= 0) uiHostState.owners.splice(i, 1); uiHostEmit() }
  }, [me])
  if (owner !== me) return null
  return <>{hosts.map(({ key, Component }) => <Component key={key} />)}</>
}
