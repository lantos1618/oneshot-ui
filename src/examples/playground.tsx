import { motionTransition, useViewport } from '../lib/motion'
import { spring } from '../lib/helpers'

export type MotionPreset = [name: string, bounce: number, duration: number]
const springDefault = spring()
/** Playground presets; 'Default' is the library's spring(). */
export const MOTION_PRESETS: MotionPreset[] = [['Snappy', 0.1, 0.3], ['Default', springDefault.bounce, springDefault.duration], ['Bouncy', 0.55, 0.6], ['Gentle', 0, 0.9]]
import { useState, useRef, useLayoutEffect, useEffect } from 'react'
import { useAnimate, useReducedMotion, motion, type Transition } from 'motion/react'
import { cn, Badge, Button, Chip, fmt, isCoarsePointer } from '../lib/core'
import { SegmentedControl, Slider } from '../lib/forms'
import { CodeBlock } from '../lib/code'
/* Motion playground (an example, not part of the stable API): tune a spring or ease and copy the call. */


/** The code the playground shows for a set of values. */
const playgroundSnippet = (type: 'spring' | 'ease', bounce: number, duration: number) => {
  const s = type === 'spring' ? `{ type: 'spring', bounce: ${bounce}, duration: ${duration} }` : `{ duration: ${duration}, ease: [0.22, 1, 0.36, 1] }`
  return `import { animate } from 'motion'\n\nanimate(box, { x: 220 }, ${s})\nanimate(card, { scale: [0.8, 1], opacity: [0, 1] }, ${s})`
}

/**
 * Spring tuner: Spring/Ease toggle, bounce and duration sliders, presets, the exact code to copy,
 * and a stage where a box slides, a card scales in, a switch flips and a badge pops with those values.
 * Every change replays the stage; it also plays once when scrolled into view. `onChange` reports the
 * transition so you can wire it into your own components; `filename` labels the code block.
 */
export function MotionPlayground({ defaultType = 'spring', defaultBounce = 0.25, defaultDuration = 0.45, presets = MOTION_PRESETS, onChange, filename = 'usage.js', className }:
  { defaultType?: 'spring' | 'ease'; defaultBounce?: number; defaultDuration?: number; presets?: MotionPreset[]; onChange?: (t: Transition) => void; filename?: string; className?: string }) {
  const [type, setType] = useState<'spring' | 'ease'>(defaultType)
  const [bounce, setBounce] = useState(defaultBounce)
  const [duration, setDuration] = useState(defaultDuration)
  const [side, setSide] = useState(false)
  const [scope, animate] = useAnimate<HTMLDivElement>()
  const reduce = useReducedMotion()
  const { seen } = useViewport(scope, { amount: 0.4 })
  const latest = useRef({ type, bounce, duration, side })
  useLayoutEffect(() => { latest.current = { type, bounce, duration, side } })
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)

  const replay = () => {
    const { type, bounce, duration, side } = latest.current
    const t = reduce ? { duration: 0 } : motionTransition(type, bounce, duration), next = !side
    setSide(next); latest.current.side = next
    onChange?.(motionTransition(type, bounce, duration))
    if (!scope.current) return
    const track = scope.current.querySelector<HTMLElement>('[data-mp="track"]')
    const w = (track?.clientWidth ?? 300) - 72
    animate('[data-mp="box"]', { x: next ? w : 0 }, t)
    animate('[data-mp="card"]', { scale: [0.8, 1], opacity: [0, 1] }, t)
    animate('[data-mp="knob"]', { x: next ? (isCoarsePointer() ? 20 : 16) : 0 }, t)
    animate('[data-mp="badge"]', { scale: [0, 1] }, t)
  }
  const replaySoon = (ms = 120) => { clearTimeout(timer.current); timer.current = setTimeout(replay, ms) }
  useEffect(() => { if (seen) replaySoon(300) }, [seen]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => clearTimeout(timer.current), [])

  const code = playgroundSnippet(type, bounce, duration)
  return (
    <div className={cn('grid gap-4 md:grid-cols-[minmax(0,340px)_minmax(0,1fr)]', className)}>
      <div className="flex min-w-0 flex-col gap-3">
        <SegmentedControl className="self-start" value={type} onChange={v => { setType(v as 'spring' | 'ease'); latest.current.type = v as 'spring' | 'ease'; replaySoon(0) }}
          options={[{ value: 'spring', label: 'Spring' }, { value: 'ease', label: 'Ease' }]} />
        <Slider compact label={'Bounce'} min={0} max={0.8} step={0.05} value={bounce} disabled={type !== 'spring'} format={v => fmt.number(v, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          onChange={v => { setBounce(v); latest.current.bounce = v; replaySoon() }} />
        <Slider compact label={'Duration'} min={0.1} max={1.5} step={0.05} value={duration} format={v => fmt.number(v, { style: 'unit', unit: 'second', unitDisplay: 'narrow', minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          onChange={v => { setDuration(v); latest.current.duration = v; replaySoon() }} />
        <div className="flex min-h-[30px] flex-wrap gap-1.5 [@media(pointer:coarse)]:gap-2">
          {presets.map(([n, b, d]) => {
            const on = type === 'spring' ? b === bounce && d === duration : d === duration
            return <Chip key={n} pressed={on} onClick={() => { setBounce(b); setDuration(d); latest.current.bounce = b; latest.current.duration = d; replaySoon(0) }}>{n}</Chip>
          })}
        </div>
        <CodeBlock code={code} filename={filename} lineNumbers={false} className="min-h-[132px]" />
      </div>
      <div ref={scope} className="flex min-w-0 flex-col justify-center gap-5 rounded-[var(--r-lg)] border border-[var(--line)] bg-[var(--bg)] bg-[radial-gradient(circle,var(--line2)_1px,transparent_1.2px)] bg-[length:18px_18px] p-6 max-sm:gap-4 max-sm:p-4">
        <div data-mp="track" className="relative flex h-16 items-center rounded-[var(--r-md)] border border-[var(--line)] bg-[var(--card)] px-4">
          <motion.span data-mp="box" className="block h-10 w-10 rounded-[var(--r-md)] bg-[var(--accent)]" />
        </div>
        <div className="relative flex h-16 items-center gap-5 rounded-[var(--r-md)] border border-[var(--line)] bg-[var(--card)] px-4">
          <motion.div data-mp="card" className="flex flex-col rounded-[var(--r-md)] border border-[var(--line)] bg-[var(--card)] px-3 py-2 shadow-[var(--shadow)]">
            <b className="text-[13px] font-semibold">{'Card'}</b><span className="text-xs text-[var(--fg3)]">{'Scale in'}</span>
          </motion.div>
          <button role="switch" aria-checked={side} aria-label={'Preview switch'} onClick={replay}
            className={cn('relative h-[22px] w-[38px] flex-none cursor-pointer rounded-full border-0 p-0 transition-colors [@media(pointer:coarse)]:h-8 [@media(pointer:coarse)]:w-[52px]', side ? 'bg-[var(--primary)]' : 'bg-[var(--line2)]')}>
            <motion.i data-mp="knob" className="absolute top-[3px] start-[3px] block h-4 w-4 [@media(pointer:coarse)]:h-[26px] [@media(pointer:coarse)]:w-[26px] rounded-full bg-[var(--card)] shadow-[0_1px_2px_rgba(0,0,0,.25)]" />
          </button>
          <motion.span data-mp="badge" className="inline-flex"><Badge tone="accent">{'New'}</Badge></motion.span>
        </div>
        <Button size="sm" onClick={replay} className="self-center">{'Replay'}</Button>
      </div>
    </div>
  )
}
