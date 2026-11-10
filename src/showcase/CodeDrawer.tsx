import { useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import { motion, useDragControls } from 'motion/react'
import { IconButton, ModalLayer, SegmentedControl, cn, spring, useMediaQuery } from '../lib'
import { CodeBlock } from '../lib/code'

/* View code: the `</>` button on every card opens this drawer with a copy-pasteable usage example built from the
 * card's own JSX in the showcase source (its <Spec> children, plus the state, helpers and imports they use). */

/** A card's usage example and the props of the library components it renders, worked out at build time by the Vite plugin in
 * scripts/showcase-code.ts (one small module per section, loaded the first time the drawer opens). In any other bundler
 * (the single-file build) `import.meta.glob` doesn't exist, the call throws, and the drawer says the source isn't bundled. */
export type CodeExample = { code: string; file: string; components: string[] }
/** One prop as the TypeScript types describe it (scripts/registry/api.mjs, the same tables as the docs site). */
export type CodeProp = { name: string; type: string; required: boolean; default: string | null; doc: string }
export type CodePropsDoc = { name: string; doc?: string; props: CodeProp[]; inherited: number; inheritedFrom?: string[] }
type CodeSectionData = { examples: Record<string, CodeExample>; props: Record<string, CodePropsDoc> }
const codeLoaders: Record<string, () => Promise<CodeSectionData>> = (() => {
  try { return import.meta.glob('./*Section.tsx', { query: '?showcase-code', import: 'default' }) as Record<string, () => Promise<CodeSectionData>> } catch { return {} }
})()
let codeAll: Promise<CodeSectionData> | null = null
/** Every section's examples and props, merged (loaded once). */
const codeData = () => (codeAll ??= Promise.all(Object.values(codeLoaders).map(l => l())).then(all => ({
  examples: Object.assign({}, ...all.map(d => d.examples)), props: Object.assign({}, ...all.map(d => d.props)),
})))
const codePascal = (t: string) => t.replace(/[^A-Za-z0-9]+/g, ' ').trim().split(' ').map(w => w[0].toUpperCase() + w.slice(1)).join('') || 'Component'

/* Drawer state: one drawer for the whole page, opened from any card. */
let codeDrawerTitle = ''
const codeDrawerListeners = new Set<() => void>()
const codeDrawerSet = (t: string) => { codeDrawerTitle = t; codeDrawerListeners.forEach(l => l()) }
/** Open the view-code drawer for the card with this title. */
export const openCodeDrawer = (title: string) => codeDrawerSet(title)

/** The Props tab: every library component the card renders, with its props, types, defaults and notes. */
function CodePropsPanel({ docs }: { docs: CodePropsDoc[] }) {
  if (!docs.length) return <p className="m-0 rounded-[var(--r-md)] border border-dashed border-[var(--line2)] p-4 text-[13px] text-[var(--fg2)]">No props to show: this card only uses page markup.</p>
  return (
    <div className="flex flex-col gap-5">
      {docs.map(d => (
        <section key={d.name} className="flex flex-col gap-1.5">
          <h5 className="m-0 font-[family-name:var(--mono)] text-[13px] font-semibold">{`<${d.name}>`}</h5>
          {d.doc && <p className="m-0 text-xs leading-relaxed text-[var(--fg2)]">{d.doc}</p>}
          {d.props.length > 0 && (
            <div className="-mx-1 overflow-x-auto px-1">
              <table className="w-full border-collapse text-left text-xs">
                <thead><tr className="text-[11px] text-[var(--fg3)]">{['Prop', 'Type', 'Default'].map(h => <th key={h} scope="col" className="border-b border-[var(--line)] py-1.5 pr-3 font-medium">{h}</th>)}</tr></thead>
                <tbody>
                  {d.props.map(p => (
                    <tr key={p.name} className="align-top [&>td]:border-b [&>td]:border-[var(--line)] [&>td]:py-1.5 [&>td]:pr-3">
                      <td className="font-[family-name:var(--mono)] whitespace-nowrap text-[var(--fg)]">{p.name}{p.required && <span className="text-[var(--bad)]" title="Required">*</span>}
                        {p.doc && <div className="mt-0.5 max-w-[220px] font-[family-name:var(--font)] whitespace-normal text-[11px] text-[var(--fg3)]">{p.doc}</div>}</td>
                      <td className="font-[family-name:var(--mono)] break-words text-[var(--fg2)] [overflow-wrap:anywhere]">{p.type}</td>
                      <td className="font-[family-name:var(--mono)] text-[var(--fg2)] [overflow-wrap:anywhere]">{p.default ?? <span className="text-[var(--fg3)]">–</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {d.inherited > 0 && <p className="m-0 text-[11px] text-[var(--fg3)]">Also takes {d.inherited} props from <code className="font-[family-name:var(--mono)]">{(d.inheritedFrom ?? ['react']).join(' & ')}</code> types</p>}
        </section>
      ))}
      <p className="m-0 text-[11px] text-[var(--fg3)]">Read from the TypeScript types in <code className="font-[family-name:var(--mono)]">src/lib</code>. <span className="text-[var(--bad)]">*</span> required.</p>
    </div>
  )
}

/* Drawer ────────────────────────────────────────────────────────────────────── */

const codeSubscribe = (l: () => void) => { codeDrawerListeners.add(l); return () => { codeDrawerListeners.delete(l) } }

/**
 * Right-hand drawer with the open card's usage example; below 640px a bottom sheet (drag the handle or header down
 * to dismiss). Esc or the backdrop closes it; focus goes back to the `</>` button.
 */
export function CodeDrawer() {
  const title = useSyncExternalStore(codeSubscribe, () => codeDrawerTitle, () => '')
  // the examples load the first time the drawer opens (null while loading, undefined when this build has none)
  const [data, setData] = useState<CodeSectionData | null | undefined>(null)
  useEffect(() => {
    if (!title || data) return
    if (!Object.keys(codeLoaders).length) { setData(undefined); return }
    let live = true
    codeData().then(d => { if (live) setData(d) }, () => { if (live) setData(undefined) })
    return () => { live = false }
  }, [title, data])
  const ex = data?.examples[title] ?? null
  const docs = useMemo(() => ex ? ex.components.map(n => data?.props[n]).filter((d): d is CodePropsDoc => !!d) : [], [ex, data])
  const [tab, setTab] = useState<'usage' | 'props'>('usage')
  useEffect(() => { if (title) setTab('usage') }, [title])
  const close = () => codeDrawerSet('')
  const sheet = useMediaQuery('(max-width: 639px)') // same breakpoint as Sheet's bottom-sheet switch
  const drag = useDragControls()
  const off = sheet ? { y: '100%' } : { x: '100%' }
  const grab = sheet ? (e: React.PointerEvent) => drag.start(e) : undefined
  return (
    <ModalLayer open={!!title} onClose={close}>
      <motion.div key={sheet ? 'sheet' : 'drawer'} role="dialog" aria-modal="true" aria-label={`${title} usage`}
        initial={off} animate={{ x: 0, y: 0 }} exit={{ ...off, transition: { duration: 0.2 } }} transition={spring(0.12, 0.4)}
        drag={sheet ? 'y' : false} dragListener={false} dragControls={drag} dragConstraints={{ top: 0, bottom: 0 }} dragElastic={{ top: 0, bottom: 0.9 }}
        onDragEnd={(_, i) => { if (i.offset.y > 90 || i.velocity.y > 500) close() }}
        className={cn('fixed z-[71] flex flex-col bg-[var(--card)] shadow-[var(--shadow)]', sheet
          ? 'inset-x-0 bottom-0 max-h-[88dvh] rounded-t-[var(--r-lg)] pb-[env(safe-area-inset-bottom,0px)]'
          : 'top-0 right-0 bottom-0 w-[min(620px,94vw)] pt-[env(safe-area-inset-top,0px)]')}>
        {sheet && <div aria-hidden onPointerDown={grab} className="flex flex-none cursor-grab touch-none justify-center pt-2 pb-1"><span className="h-1 w-9 rounded-full bg-[var(--line2)]" /></div>}
        <div onPointerDown={grab} className={cn('flex flex-none items-center gap-2 border-b border-[var(--line)] py-3 pr-3 pl-4', sheet && 'touch-none !pt-1')}>
          <h4 className="m-0 min-w-0 truncate text-base font-semibold">{title}</h4>
          <span className="flex-1" />
          {ex && ex.components.length > 0 && <SegmentedControl size="sm" aria-label="Show" value={tab} onChange={v => setTab(v as 'usage' | 'props')} options={[{ value: 'usage', label: 'Usage' }, { value: 'props', label: 'Props' }]}
            className="flex-none" />}
          <IconButton icon="x" label="Close" onClick={close} onPointerDown={e => e.stopPropagation()} />
        </div>
        <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-auto overscroll-contain p-4 max-sm:p-3">
          {data === null ? <p className="m-0 text-[13px] text-[var(--fg3)]">Loading the example…</p> : ex && tab === 'props' ? <CodePropsPanel docs={docs} /> : ex ? (
            <>
              <CodeBlock code={ex.code} filename={`${codePascal(title)}.tsx`} language="ts" collapseAt={false} defaultWrap={matchMedia('(max-width: 640px)').matches} />
              <p className="m-0 text-xs text-[var(--fg3)]">From <code className="font-[family-name:var(--mono)]">{ex.file}</code>. Imports point at the single-file builds: <code className="font-[family-name:var(--mono)]">./ui</code> for core, <code className="font-[family-name:var(--mono)]">./ui-charts</code>, <code className="font-[family-name:var(--mono)]">./ui-content</code> or <code className="font-[family-name:var(--mono)]">./ui-ai</code> for extras.</p>
            </>
          ) : (
            <p className="m-0 rounded-[var(--r-md)] border border-dashed border-[var(--line2)] p-4 text-[13px] text-[var(--fg2)]">
              The showcase source isn’t bundled in this build. Look for <code className="font-[family-name:var(--mono)]">{`<Spec title="${title}">`}</code> in the examples to see how this card is built.
            </p>
          )}
        </div>
      </motion.div>
    </ModalLayer>
  )
}
