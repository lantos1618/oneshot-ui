/* Shared pieces of the form modules (fields, inputs, select, pickers, upload): not part of the public API. */

import { Fragment, useEffect, useLayoutEffect, useRef, type ReactNode, type Ref } from 'react'
import { formDisabledClass, cn, inputClass } from './core'
import { type Placement } from './overlay'

/** Run `cb` after the form around `ref` has been reset (native fields hold their reset values by then). */
export function useFormsAfterReset(ref: { current: HTMLInputElement | HTMLTextAreaElement | null }, cb: (el: HTMLInputElement | HTMLTextAreaElement) => void) {
  const fn = useRef(cb)
  useLayoutEffect(() => { fn.current = cb })
  useEffect(() => {
    const form = ref.current?.form
    if (!form) return
    const on = () => setTimeout(() => { if (ref.current) fn.current(ref.current) })
    form.addEventListener('reset', on)
    return () => form.removeEventListener('reset', on)
  }, [ref])
}

/** Hand `el` to a callback or object ref. */
export function formsAssignRef<T>(r: Ref<T> | undefined, el: T | null) { if (typeof r === 'function') r(el); else if (r) (r as { current: T | null }).current = el }

/** Give one element to several refs (yours and the caller's). */
export function formsMergeRefs<T>(...refs: (Ref<T> | undefined)[]) {
  return (el: T | null) => { for (const r of refs) { if (typeof r === 'function') r(el); else if (r) (r as { current: T | null }).current = el } }
}

/** Open a list upward when there isn't room below the trigger. */
export const formsPlacement = (el: HTMLElement | null, room = 270): Placement => {
  if (!el) return 'bottom-start'
  const r = el.getBoundingClientRect(), below = innerHeight - r.bottom
  return below < room && r.top > below ? 'top-start' : 'bottom-start'
}

/** Field triggers (Select, pickers): the shared field look plus the disabled, read-only and pointer states. */
export const formsTriggerClass = cn(inputClass, formDisabledClass, 'flex items-center gap-2 text-start aria-readonly:cursor-default aria-readonly:bg-[var(--muted)] aria-readonly:hover:border-[var(--line)]')

/** Scroll `el` into view inside its nearest scrollable ancestor only (never the page). */
export function formsScrollIntoList(el: HTMLElement, center = false) {
  let p = el.parentElement
  while (p && p !== document.body && !/(auto|scroll)/.test(getComputedStyle(p).overflowY)) p = p.parentElement
  if (!p || p === document.body) return
  const er = el.getBoundingClientRect(), pr = p.getBoundingClientRect()
  if (center) p.scrollTop += er.top - pr.top - (pr.height - er.height) / 2
  else if (er.top < pr.top) p.scrollTop -= pr.top - er.top + 4
  else if (er.bottom > pr.bottom) p.scrollTop += er.bottom - pr.bottom + 4
}

/**
 * A translated message with React nodes in its placeholders: formsInterleave(t('range'), { from: <b>2</b>, to: <b>8</b> })
 * for "{from} to {to}". Call t() without vars, so the placeholders come back as written.
 */
export function formsInterleave(message: string, parts: Record<string, ReactNode>): ReactNode {
  return message.split(/(\{\w+\})/).map((s, i) => {
    const k = /^\{(\w+)\}$/.exec(s)?.[1]
    return k && k in parts ? <Fragment key={i}>{parts[k]}</Fragment> : s
  })
}
