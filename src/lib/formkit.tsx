/* Shared pieces of the form modules (fields, inputs, select, pickers, upload): not part of the public API. */

import { type Ref, useEffect, useLayoutEffect, useRef } from 'react'
import { cn, composeRefs, inputClass } from './core'
import { play } from './motion'

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

/** Field triggers (Select, pickers): the shared field look (with its disabled and read-only states) plus the pointer states. */
export const formsTriggerClass = cn(inputClass, 'flex items-center gap-2 text-start aria-readonly:cursor-default aria-readonly:hover:border-[var(--line)]')

/** A removable chip (MultiSelect's choices, TagInput's tags): the label, an optional colour dot, and a × while editable. */
export function FormsChip({ id, label, dot, locked, onRemove, shake, tabbable = true, ref, ...presence }: {
  /** the key, for the slide when chips before it come and go (useFlip) */ id: string
  label: string; dot?: string; locked: boolean; onRemove: () => void
  /** wiggle once (a duplicate was typed) */ shake?: boolean
  /** false inside a combobox, whose own keys remove chips */ tabbable?: boolean; ref?: Ref<HTMLSpanElement> }) {
  const own = useRef<HTMLSpanElement>(null)
  useEffect(() => { if (shake) play(own.current, { x: [0, -4, 4, 0] }, { duration: 0.3 }) }, [shake])
  return (
    <span ref={composeRefs(own, ref)} data-flip={id} {...presence}
      className={cn('ui-in inline-flex [--ui-d:.35s] [--ui-do:.12s] [--ui-s:.6] items-center gap-1.5 rounded-[var(--r-md)] py-0.5 ps-2 text-xs', locked ? 'bg-[var(--card)] pe-2 shadow-[inset_0_0_0_1px_var(--line)]' : 'bg-[var(--muted)] pe-1')}>
      {dot && <span className="h-2 w-2 flex-none rounded-full" style={{ background: dot }} />}
      {label}
      {!locked && (
        <button type="button" tabIndex={tabbable ? undefined : -1} aria-label={`Remove ${label}`} onPointerDown={e => e.preventDefault()} onClick={e => { e.stopPropagation(); onRemove() }}
          className="ui-target cursor-pointer rounded-[var(--r-sm)] border-0 bg-transparent px-1 leading-none text-[var(--fg3)] hover:bg-[var(--line)] hover:text-[var(--fg)] [@media(pointer:coarse)]:-my-2 [@media(pointer:coarse)]:-me-1 [@media(pointer:coarse)]:min-h-8 [@media(pointer:coarse)]:min-w-8 [@media(pointer:coarse)]:text-base">×</button>
      )}
    </span>
  )
}
