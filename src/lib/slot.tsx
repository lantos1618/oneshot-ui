/** Slot / asChild: merge props onto a single child element, compose refs. Part of @lyndon/ui/core. */
import { type HTMLAttributes, type ReactNode, cloneElement as slotClone, type ReactElement as SlotElement, Fragment as SlotFragment, isValidElement as slotIsElement, type Ref as SlotRef, type RefCallback as SlotRefCallback, useMemo } from 'react'
import { cn } from './helpers'

/* ═══ SLOT / asChild (0.4) ═══════════════════════════════════════════════════════════════════════════════════════
 * `Slot` renders its single child element instead of an element of its own, merging its props onto that child. Every
 * part that takes `asChild` (Button, IconButton, the Trigger/Close parts of Dialog, Popover, menus, tabs…) uses it, so
 * you can render a router link, an <a>, or your own component and keep the part's behaviour, ARIA and classes:
 *
 *   <Button asChild variant="primary"><Link href="/pricing">Pricing</Link></Button>
 *   <Dialog.Trigger asChild><MyButton>Open</MyButton></Dialog.Trigger>
 *
 * The contract (the same as Radix / shadcn):
 *   - exactly one React element child (not text, not a fragment); anything else throws a descriptive error
 *   - className: both kept (the part's first); style: merged, the child's keys win
 *   - event handlers (on…): both run, the child's first; calling `event.preventDefault()` in the child's handler skips
 *     the part's (so `onClick={e => e.preventDefault()}` on a Trigger child stops it opening)
 *   - aria-describedby / aria-labelledby: id lists are joined
 *   - ref: composed (React 19 ref-as-prop), so both the part and you get the node
 *   - every other prop: the child's value wins
 * The child must spread the props it gets onto a DOM element and accept `ref` (any React 19 function component that
 * passes `...props` and `ref` through does, as do Next.js `Link`, React Router `Link` and TanStack `Link`).
 * ══════════════════════════════════════════════════════════════════════════════════════════════════════════════ */

/** `asChild` for parts that support it: render your element (merged with the part's props) instead of the part's own. */
export type AsChildProps = { /** render the single child element instead of the default one, merging props onto it */ asChild?: boolean }

/** One ref callback that feeds every given ref (callback or object). Returns a React 19 cleanup that detaches them all. */
export function composeRefs<T>(...refs: (SlotRef<T> | undefined | null)[]): SlotRefCallback<T> {
  return node => {
    const cleanups = refs.map(r => {
      if (typeof r === 'function') { const c = r(node); return typeof c === 'function' ? c : () => r(null) }
      if (r) { (r as { current: T | null }).current = node; return () => { (r as { current: T | null }).current = null } }
      return undefined
    })
    return () => cleanups.forEach(c => c?.())
  }
}

/** composeRefs, memoised on the refs, so the node isn't detached and re-attached on every render. */
export function useComposedRefs<T>(...refs: (SlotRef<T> | undefined | null)[]): SlotRefCallback<T> {
  return useMemo(() => composeRefs(...refs), refs) // eslint-disable-line react-hooks/exhaustive-deps
}

const SLOT_HANDLER = /^on[A-Z]/

const SLOT_ID_LISTS = new Set(['aria-describedby', 'aria-labelledby'])

/**
 * Merge a part's props (`slot`) with its child's (`child`) by the asChild contract: classes joined, styles merged,
 * handlers chained (child first; a defaultPrevented event skips the part's), id lists joined, otherwise the child wins.
 */
export function mergeSlotProps(slot: Record<string, unknown>, child: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...slot }
  for (const k in child) {
    const s = slot[k], c = child[k]
    if (c === undefined) continue
    if (SLOT_HANDLER.test(k) && typeof s === 'function' && typeof c === 'function') {
      out[k] = (...args: unknown[]) => {
        const r = (c as (...a: unknown[]) => unknown)(...args)
        if (!(args[0] as { defaultPrevented?: boolean } | undefined)?.defaultPrevented) (s as (...a: unknown[]) => unknown)(...args)
        return r
      }
    } else if (k === 'className' && s) out[k] = cn(s as string, c as string)
    else if (k === 'style' && s && c) out[k] = { ...(s as object), ...(c as object) }
    else if (SLOT_ID_LISTS.has(k) && s) out[k] = cn(c as string, s as string)
    else out[k] = c
  }
  return out
}

/** The one element child asChild needs, or a descriptive error. */
export function slotOnlyChild(children: ReactNode): SlotElement<Record<string, unknown>> {
  if (!slotIsElement(children) || children.type === SlotFragment)
    throw new Error('asChild expects exactly one React element child (not text, an array or a fragment), e.g. <Button asChild><a href="/docs">Docs</a></Button>')
  return children as SlotElement<Record<string, unknown>>
}

/** Renders its single child with its own props merged in (see the asChild contract above). The engine behind every `asChild`. */
export function Slot({ children, ref, ...props }: HTMLAttributes<HTMLElement> & { children?: ReactNode; ref?: SlotRef<HTMLElement> } & Record<`data-${string}`, unknown>) {
  const child = slotOnlyChild(children)
  const childRef = child.props.ref as SlotRef<HTMLElement> | undefined
  const merged = useComposedRefs<HTMLElement>(ref, childRef)
  return slotClone(child, { ...mergeSlotProps(props as Record<string, unknown>, child.props), ref: ref || childRef ? merged : undefined })
}
