/** Slot / asChild: merge props onto a single child element, compose refs. Part of @lyndon/ui/core. */
import { type ButtonHTMLAttributes, type HTMLAttributes, type ReactNode, cloneElement as slotClone, type ReactElement as SlotElement, Fragment as SlotFragment, isValidElement as slotIsElement, type Ref as SlotRef, type RefCallback as SlotRefCallback, useMemo } from 'react'
import { cn } from './helpers'

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

type SlotMerge = (part: unknown, child: unknown) => unknown
/** Handlers run the child's first; a defaultPrevented event skips the part's. */
const slotChain: SlotMerge = (s, c) => (...args: unknown[]) => {
  const r = (c as (...a: unknown[]) => unknown)(...args)
  if (!(args[0] as { defaultPrevented?: boolean } | undefined)?.defaultPrevented) (s as (...a: unknown[]) => unknown)(...args)
  return r
}
const slotIds: SlotMerge = (s, c) => cn(c as string, s as string)
/** How a prop set on both the part and the child merges; any other prop: the child wins. */
const SLOT_MERGE: Record<string, SlotMerge> = {
  className: (s, c) => cn(s as string, c as string), style: (s, c) => ({ ...(s as object), ...(c as object) }),
  'aria-describedby': slotIds, 'aria-labelledby': slotIds,
}
const slotMergeOf = (k: string) => (/^on[A-Z]/.test(k) ? slotChain : SLOT_MERGE[k])

/**
 * Merge a part's props (`slot`) with its child's (`child`) by the asChild contract: classes joined, styles merged,
 * handlers chained (child first; a defaultPrevented event skips the part's), id lists joined, otherwise the child wins.
 */
export function mergeSlotProps(slot: Record<string, unknown>, child: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...slot }
  for (const k in child) {
    const s = slot[k], c = child[k]
    if (c === undefined) continue
    const merge = s == null ? undefined : slotMergeOf(k)
    out[k] = merge ? merge(s, c) : c
  }
  return out
}

/** The one element child asChild needs, or a descriptive error. */
export function slotOnlyChild(children: ReactNode): SlotElement<Record<string, unknown>> {
  if (!slotIsElement(children) || children.type === SlotFragment)
    throw new Error('asChild expects exactly one React element child (not text, an array or a fragment), e.g. <Button asChild><a href="/docs">Docs</a></Button>')
  return children as SlotElement<Record<string, unknown>>
}

/**
 * Renders its single child element instead of an element of its own, with its props merged in: the engine behind every
 * `asChild` (`<Button asChild><Link href="/pricing">Pricing</Link></Button>`). Contract, as in Radix / shadcn: exactly one
 * element child; className joined (the part's first); style merged (the child's keys win); handlers chained (see
 * mergeSlotProps); aria-describedby / aria-labelledby joined; refs composed; every other prop: the child wins. The child
 * must spread its props onto a DOM element and accept `ref`.
 */
export function Slot<E extends HTMLElement = HTMLElement>({ children, ref, ...props }: HTMLAttributes<E> & { children?: ReactNode; ref?: SlotRef<E> } & Record<`data-${string}`, unknown>) {
  const child = slotOnlyChild(children)
  const childRef = child.props.ref as SlotRef<E> | undefined
  const merged = useComposedRefs<E>(ref, childRef)
  return slotClone(child, { ...mergeSlotProps(props as Record<string, unknown>, child.props), ref: ref || childRef ? merged : undefined })
}

/**
 * A part's trigger: a `<button type="button">` with `after` rendered behind the children, or with `asChild` your element
 * (where `disabled` becomes aria-disabled, since a link or div has no disabled state).
 */
export function PartButton({ asChild, disabled, after, children, ref, ...p }: ButtonHTMLAttributes<HTMLButtonElement> & AsChildProps & { after?: ReactNode; ref?: SlotRef<HTMLButtonElement> }) {
  if (asChild) return <Slot<HTMLButtonElement> {...p} ref={ref} aria-disabled={disabled || undefined}>{children}</Slot>
  return <button type="button" ref={ref} disabled={disabled} {...p}>{children}{after}</button>
}
