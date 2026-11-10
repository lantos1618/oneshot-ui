/* Shared pieces of the form modules (fields, inputs, select, pickers, upload): not part of the public API. */

import { useEffect, useLayoutEffect, useRef } from 'react'
import { motion } from 'motion/react'
import { cn, inputClass, spring } from './core'

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
export function FormsChip({ label, dot, locked, onRemove, shake, tabbable = true }: {
  label: string; dot?: string; locked: boolean; onRemove: () => void
  /** wiggle once (a duplicate was typed) */ shake?: boolean
  /** false inside a combobox, whose own keys remove chips */ tabbable?: boolean }) {
  return (
    <motion.span layout initial={{ scale: 0.6, opacity: 0 }} animate={{ scale: 1, opacity: 1, x: shake ? [0, -4, 4, 0] : 0 }}
      exit={{ scale: 0.6, opacity: 0, transition: { duration: 0.12 } }} transition={{ ...spring(0.4, 0.35), x: { duration: 0.3 } }}
      className={cn('inline-flex items-center gap-1.5 rounded-[var(--r-md)] py-0.5 ps-2 text-xs', locked ? 'bg-[var(--card)] pe-2 shadow-[inset_0_0_0_1px_var(--line)]' : 'bg-[var(--muted)] pe-1')}>
      {dot && <span className="h-2 w-2 flex-none rounded-full" style={{ background: dot }} />}
      {label}
      {!locked && (
        <button type="button" tabIndex={tabbable ? undefined : -1} aria-label={`Remove ${label}`} onPointerDown={e => e.preventDefault()} onClick={e => { e.stopPropagation(); onRemove() }}
          className="ui-target cursor-pointer rounded-[var(--r-sm)] border-0 bg-transparent px-1 leading-none text-[var(--fg3)] hover:bg-[var(--line)] hover:text-[var(--fg)] [@media(pointer:coarse)]:-my-2 [@media(pointer:coarse)]:-me-1 [@media(pointer:coarse)]:min-h-8 [@media(pointer:coarse)]:min-w-8 [@media(pointer:coarse)]:text-base">×</button>
      )}
    </motion.span>
  )
}
