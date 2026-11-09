import { Fragment, useEffect, useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react'
import { motion, useInView, useReducedMotion } from 'motion/react'
import { AnimatedNumber, Badge, Button, Icon, ScrollEdges, Spinner, TOUCH, cn, defineMessages, isTouch, onMouseLeave, surface, useLocale, useMessages, useScrollEdges, useWidth, type IconName } from './core'
import { Collapse } from './feedback'
import { PointerTooltip, usePointerTooltip } from './overlay'
import { useFrameLoop } from './motion'
import { DG_COLLAPSE_STICKY, DgChevron } from './diagramkit'
import { TAG_SR_ONLY, TagGlyph, layoutTimeTags, timeTagLook, timeTagMs, timeTagTint, useTagFocus, type TimeTag, type TimeTagKind } from './annotate'

/* DIAGRAMS · Trace waterfall: nested spans on one streaming timeline. */

/* ════════════════════════════════════════════════════════════════════════════
 * Trace waterfall
 * ══════════════════════════════════════════════════════════════════════════ */

export type TraceSpan = { id: string; parent?: string | null; name: string; meta?: string; kind: 'llm' | 'tool' | 'agent'; /** default by kind: asterisk, code, bot */ icon?: IconName; start: number; duration: number; cost?: number; tokens?: number }
const TRACE_BAR = {
  llm: 'bg-[color-mix(in_srgb,var(--accent)_72%,var(--card))]',
  tool: 'bg-[color-mix(in_srgb,var(--c4)_58%,var(--card))]',
  agent: 'bg-[color-mix(in_srgb,var(--fg3)_16%,var(--card))] shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--fg3)_40%,transparent)]',
} as const
const TRACE_ICON = { llm: 'text-[var(--accent)]', tool: 'text-[color-mix(in_srgb,var(--c4)_80%,var(--fg))]', agent: 'text-[var(--fg2)]' } as const
/** Spawn connector colours: thin and quiet, brighter along the hovered span's chain. */
const TRACE_WIRE = 'border-[color-mix(in_srgb,var(--fg3)_50%,transparent)]', TRACE_WIRE_ON = 'border-[color-mix(in_srgb,var(--accent)_75%,var(--fg2))]'
type TraceWire = { c: TraceSpan; part: 'stub' | 'through' | 'elbow' }

/** TraceWaterfall's UI strings (machine-drafted de/ar). */
export const TRACE_MESSAGES = defineMessages('trace', {
  en: {
    title: 'Trace', span: 'Span', simulate: 'Simulate failure', replay: 'Replay',
    llm: 'LLM call', tool: 'Tool call', agent: 'Agent',
    live: 'Live', liveError: 'Live · {n, plural, one {# error} other {# errors}}', complete: 'Complete', completeError: 'Completed with {n, plural, one {# error} other {# errors}}',
    duration: 'Duration', cost: 'Cost', tokens: 'Tokens', llmCalls: 'LLM calls', toolCalls: 'Tool calls', errors: 'Errors',
    tipStart: 'Start {start} · {elapsed}', soFar: '{elapsed} so far', tokenCount: '{n} tokens',
    failed: 'Failed after {time} · {message}', slowest: 'Slowest', running: '{name} running',
    events: 'Events', eventAt: '{label} at {time}',
  },
  de: {
    title: 'Trace', span: 'Span', simulate: 'Fehler simulieren', replay: 'Wiederholen',
    llm: 'LLM-Aufruf', tool: 'Tool-Aufruf', agent: 'Agent',
    live: 'Live', liveError: 'Live · {n, plural, one {# Fehler} other {# Fehler}}', complete: 'Abgeschlossen', completeError: 'Abgeschlossen mit {n, plural, one {# Fehler} other {# Fehlern}}',
    duration: 'Dauer', cost: 'Kosten', tokens: 'Tokens', llmCalls: 'LLM-Aufrufe', toolCalls: 'Tool-Aufrufe', errors: 'Fehler',
    tipStart: 'Start {start} · {elapsed}', soFar: 'bisher {elapsed}', tokenCount: '{n} Tokens',
    failed: 'Fehlgeschlagen nach {time} · {message}', slowest: 'Langsamster', running: '{name} läuft',
    events: 'Ereignisse', eventAt: '{label} bei {time}',
  },
  ar: {
    title: 'التتبّع', span: 'المقطع', simulate: 'محاكاة إخفاق', replay: 'إعادة التشغيل',
    llm: 'استدعاء نموذج لغوي', tool: 'استدعاء أداة', agent: 'وكيل',
    live: 'مباشر', liveError: 'مباشر، {n, plural, one {خطأ واحد} two {خطآن} few {# أخطاء} many {# خطأً} other {# خطأ}}', complete: 'اكتمل', completeError: 'اكتمل مع {n, plural, one {خطأ واحد} two {خطأين} few {# أخطاء} many {# خطأً} other {# خطأ}}',
    duration: 'المدة', cost: 'التكلفة', tokens: 'الرموز', llmCalls: 'استدعاءات النموذج', toolCalls: 'استدعاءات الأدوات', errors: 'الأخطاء',
    tipStart: 'البدء {start}، {elapsed}', soFar: '{elapsed} حتى الآن', tokenCount: '{n} رمز',
    failed: 'أخفق بعد {time}، {message}', slowest: 'الأبطأ', running: '{name} قيد التشغيل',
    events: 'الأحداث', eventAt: '{label} عند {time}',
  },
})

/**
 * Nested spans on one streaming timeline (agent runs, API requests, jobs). Plays when scrolled into view:
 * bars grow with a cursor, the stat strip rolls (duration, cost, tokens, calls, errors) and a Live badge
 * settles to Complete. Groups collapse. `failure` lets Simulate failure fail a span part-way and reveal its retry.
 * Spawn connectors run from each parent bar, at the moment a child starts, down to that child's bar; hovering or
 * tapping a span highlights its chain back to the root. Hover or tap a span for its numbers. On phones the timeline
 * scrolls sideways with the span names pinned.
 * `annotations` (deploys, approvals, retries; `at` in ms from the trace start) draw as dashed rules over the time grid
 * with flags in a row of their own (reserved up front, so rows never move); flags that would overlap drop out to a dot
 * on their rule, and `annotationStyle="rug"` shows icons instead, folding crowded ones into "+N". Hover, tap or focus a
 * flag for its tooltip; the flag row is one Tab stop (←/→, Home/End, Escape).
 */
export function TraceWaterfall({ spans, total, title, subtitle, failure, speed = 1.2, annotations, annotationKinds, annotationStyle = 'flags', className }:
  { spans: TraceSpan[]; total: number; title?: ReactNode; subtitle?: ReactNode
    failure?: { span: string; at: number; message: string; retry?: string }; speed?: number
    /** events over the run, `at` in ms from the trace start: deploys, approvals, retries */
    annotations?: TimeTag[]
    /** labels, icons and colours per annotation kind */
    annotationKinds?: TimeTagKind[]
    /** 'flags' (default): rules with labelled flags; 'rug': icons only */
    annotationStyle?: 'flags' | 'rug'
    className?: string }) {
  const reduce = useReducedMotion()
  const { fmt, dir, locale } = useLocale()
  const m = useMessages(TRACE_MESSAGES)
  /** Seconds on the plot's own scale: "1.5s" / "1,5 s" / "١٫٥ ث". */
  const secs = (v: number, d = 1) => fmt.number(v, { style: 'unit', unit: 'second', unitDisplay: 'narrow', minimumFractionDigits: d, maximumFractionDigits: d })
  // The playhead advances every frame, but React renders the waterfall at most 10 times a second: the exact time lives
  // in a ref, and each frame writes only the moving geometry (bar widths, their labels' positions, the playhead line)
  // straight into the DOM. Rendering the whole tree every frame cost a phone (4× CPU) ~40% of its main thread.
  const clockRef = useRef(0), [, setClockTick] = useState(0), sinceRender = useRef(0)
  const setClock = (c: number) => { clockRef.current = c; setClockTick(x => x + 1) }
  const clock = clockRef.current // eslint-disable-line react-hooks/refs
  const geo = useRef(new Map<string, HTMLElement>()), headEl = useRef<HTMLDivElement>(null), drawFrame = useRef((c: number) => { void c })
  const geoRef = (key: string) => (el: HTMLElement | null) => { if (el) geo.current.set(key, el); else geo.current.delete(key) }
  const [playing, setPlaying] = useState(false)
  const [fail, setFail] = useState(false)
  const [closed, setClosed] = useState<Set<string>>(new Set())
  const box = useRef<HTMLDivElement>(null)
  const inView = useInView(box, { once: true, amount: 0.3 })
  const onScreen = useInView(box) // playback pauses while scrolled away and resumes on return
  const [laneRef, laneW] = useWidth<HTMLDivElement>()
  const [scrollRef, scroll] = useScrollEdges<HTMLDivElement>()
  const { tip, show, hide } = usePointerTooltip()
  const [hot, setHot] = useState<string | null>(null)
  // annotations: one flag row (reserved whenever the prop is set) and rules through every row
  const ann = annotations ?? []
  const [annOn, setAnnOn] = useState<string | null>(null)
  const annRow = useRef<HTMLDivElement>(null)
  const annSec = (t: TimeTag) => timeTagMs(t.at) / 1000
  const annFocus = useTagFocus({ tags: ann, activeId: annOn, onActive: setAnnOn, label: m('events'), describe: t => m('eventAt', { label: t.label, time: secs(annSec(t)) }) })
  const annW = (t: TimeTag) => t.label.length * 6.2 + 26
  const annLayout = laneW > 0 && ann.length ? layoutTimeTags(ann, { x: ms => (ms / 1000 / total) * laneW, width: laneW, style: annotationStyle, maxStack: 1, size: 16, labelWidth: annW }) : null
  // a flag that only dropped out because it would run past the end flips to the left of its rule when there is room
  const annFlip = new Set<string>()
  if (annLayout?.style === 'flags') {
    let end = -Infinity
    for (const p of annLayout.points) {
      if (p.flag) { end = p.x + annW(p.tag); continue }
      if (p.x + annW(p.tag) > laneW && p.x - annW(p.tag) >= end + 2) { p.flag = true; annFlip.add(p.tag.id); end = p.x }
    }
  }
  const annTip = (t: TimeTag) => {
    const { icon, color } = timeTagLook(t, annotationKinds)
    return (
      <span className="flex items-start gap-1.5">
        <TagGlyph aria-hidden icon={icon} color={color} size={16} className="mt-px" />
        <span><b className="font-semibold">{t.label}</b> <span className="ui-num text-[var(--fg2)]">{secs(annSec(t))}</span>{t.detail && <><br /><span className="text-[var(--fg2)]">{t.detail}</span></>}</span>
      </span>
    )
  }
  // the tooltip of the lit flag sits under it (hover, tap or keyboard alike)
  useEffect(() => {
    if (!annOn) return
    const t = ann.find(a => a.id === annOn), el = annRow.current?.querySelector<HTMLElement>(`[data-ann="${CSS.escape(annOn)}"]`)
    if (!t || !el) return
    const r = el.getBoundingClientRect()
    show({ clientX: r.left + Math.min(r.width, 24) / 2, clientY: r.bottom + 50 }, annTip(t))
  }, [annOn]) // eslint-disable-line react-hooks/exhaustive-deps
  const kids = (id: string | null) => spans.filter(s => (s.parent ?? null) === id && (fail || s.id !== failure?.retry))
  const root0 = () => spans.find(s => !s.parent)
  const depth = (s: TraceSpan): number => s.parent ? 1 + depth(spans.find(x => x.id === s.parent)!) : 0
  const slowest = spans.filter(s => s.kind === 'tool' && s.id !== failure?.retry).sort((a, b) => b.duration - a.duration)[0]
  const D = (s: TraceSpan) => fail && s.id === failure?.span ? failure.at : s.duration
  const play = (withFail: boolean) => { setFail(withFail); if (reduce) { setClock(total); setPlaying(false) } else { setClock(0); setPlaying(true) } }
  useEffect(() => { if (inView && clock === 0 && !playing) play(false) }, [inView]) // eslint-disable-line react-hooks/exhaustive-deps
  useFrameLoop(playing && onScreen, dt => {
    const n = Math.min(total, clockRef.current + dt * speed)
    clockRef.current = n
    drawFrame.current(n)
    if (n >= total) { setClock(total); setPlaying(false) } else if ((sinceRender.current += dt) >= 0.1) { sinceRender.current = 0; setClock(n) }
  }, 0.25)
  // the per-frame geometry, for the spans as rendered last (closes over the current failure mode and lane width)
  useLayoutEffect(() => {
    drawFrame.current = c => {
      for (const s of spans) {
        const bar = geo.current.get(s.id + ':bar'), label = geo.current.get(s.id + ':label')
        if (!bar && !label) continue
        const started = c >= s.start, w = started ? Math.min(c, s.start + D(s)) - s.start : 0, op = started ? '1' : '0'
        if (bar) { bar.style.width = pct(w); bar.style.opacity = op }
        if (label) { label.style.left = `calc(${pct(s.start + w)} + 10px)`; label.style.opacity = op } // rtl-lint-ignore: LTR plot
      }
      if (headEl.current && laneW > 0) headEl.current.style.left = `calc(var(--split) + ${(laneW * Math.min(c, total)) / total}px)` // rtl-lint-ignore: LTR plot
    }
  })

  // aggregate stats
  let cost = 0, tok = 0, llm = 0, tool = 0, errs = 0
  spans.forEach(s => {
    if (s.id === failure?.retry && !fail) return
    const started = clock >= s.start, end = s.start + D(s), w = started ? Math.min(clock, end) - s.start : 0
    if (fail && s.id === failure?.span && clock >= end) errs++
    if (s.kind === 'agent') return
    const frac = started ? Math.min(1, w / s.duration) : 0
    cost += (s.cost ?? 0) * frac; tok += (s.tokens ?? 0) * frac; if (started) { if (s.kind === 'llm') llm++; else tool++ }
  })
  const done = clock >= total, root = spans.find(s => !s.parent)
  if (done && !fail && root?.cost) cost = root.cost
  // the stat strip rolls once per second (and settles at the end)
  const sec = Math.floor(Math.min(clock, total)), statSec = useRef(-1), stats = useRef({ dur: 0, cost: 0, tok: 0, llm: 0, tool: 0, errs: 0 })
  if (sec !== statSec.current || done) { statSec.current = sec; stats.current = { dur: Math.min(total, Math.round(clock)), cost, tok, llm, tool, errs } }
  const S = stats.current
  const pct = (t: number) => `${(t / total) * 100}%`
  const ticks = Array.from({ length: Math.floor(total / 10) + 1 }, (_, i) => i * 10)

  // spawn connectors, drawn row by row so they follow Collapse, scrolling and streaming for free: the parent row
  // holds a stub down from its bar, rows in between a pass-through, the child row an elbow into its bar. Rows are
  // ordered over the whole tree (collapsed ones too: Collapse clips their pieces while it animates).
  const wires = new Map<string, TraceWire[]>()
  {
    const flat: TraceSpan[] = [], walk = (s: TraceSpan) => { flat.push(s); kids(s.id).forEach(walk) }
    if (root0()) walk(root0()!)
    const at = new Map(flat.map((s, i) => [s.id, i])), add = (i: number, w: TraceWire) => { const id = flat[i].id; wires.set(id, [...(wires.get(id) ?? []), w]) }
    flat.forEach((c, ic) => {
      const ip = c.parent ? at.get(c.parent) : undefined
      if (ip === undefined || clock < c.start) return
      add(ip, { c, part: 'stub' }); for (let i = ip + 1; i < ic; i++) add(i, { c, part: 'through' }); add(ic, { c, part: 'elbow' })
    })
  }
  const lit = tip ? hot : null, chain = new Set<string>()
  for (let id = lit; id; id = spans.find(x => x.id === id)?.parent ?? null) chain.add(id)

  const row = (s: TraceSpan): ReactNode => {
    const d = depth(s), ch = kids(s.id), isOpen = !closed.has(s.id)
    const du = D(s), started = clock >= s.start, end = s.start + du, fin = clock >= end, w = started ? Math.min(clock, end) - s.start : 0
    const failed = fail && s.id === failure?.span && fin, frac = started ? Math.min(1, w / s.duration) : 0
    const live = started && !fin
    const traceTip = (ev: ReactPointerEvent) => { setHot(s.id); if (!started) return hide(); const elapsed = secs(Math.min(clock, end) - s.start); show(ev, <><b className="font-semibold">{s.name}</b> <span className="text-[var(--fg3)]">{s.meta}</span><br /><span className="text-[var(--fg2)]">{m('tipStart', { start: secs(s.start), elapsed: fin ? elapsed : m('soFar', { elapsed }) })}{s.cost ? ` · ${fmt.usd(s.cost)}` : ''}{s.tokens ? ` · ${m('tokenCount', { n: fmt.compact(s.tokens) })}` : ''}</span></>) }
    return (
      <Fragment key={s.id}>
        <motion.div key={failed ? 'f' : 'n'} animate={failed && !reduce ? { x: [0, -4, 4, -2, 2, 0] } : undefined} transition={{ duration: 0.35 }}
          className={cn('relative grid h-10 grid-cols-[var(--split)_1fr] items-center', d === 0 ? 'bg-[color-mix(in_srgb,var(--muted)_55%,transparent)]' : '', failed ? 'bg-[color-mix(in_srgb,var(--bad)_7%,transparent)]' : 'hover:bg-[color-mix(in_srgb,var(--muted)_70%,transparent)]')}
          onPointerDown={e => { if (isTouch(e)) traceTip(e) }} onPointerMove={e => traceTip(e)}
          onPointerLeave={onMouseLeave(hide)}>
          <div dir={dir} className={cn('sticky left-0 z-[2] flex h-full min-w-0 items-center gap-2 pe-2.5 text-[13px] shadow-[1px_0_0_var(--line)]', /* rtl-lint-ignore: pinned column of the LTR plot */
            failed ? 'bg-[color-mix(in_srgb,var(--bad)_7%,var(--card))]' : d === 0 ? 'bg-[color-mix(in_srgb,var(--muted)_55%,var(--card))]' : 'bg-[var(--card)]')} style={{ paddingInlineStart: `calc(12px + ${d} * var(--ind))` }}>
            {Array.from({ length: d }, (_, i) => <span key={i} className="absolute inset-y-0 w-px bg-[var(--line)]" style={{ insetInlineStart: `calc(21px + ${i} * var(--ind))` }} />)}
            {ch.length ? <DgChevron open={isOpen} label={s.name} onClick={() => setClosed(c => { const n = new Set(c); if (n.has(s.id)) n.delete(s.id); else n.add(s.id); return n })} /> : <span className="w-[18px] flex-none" />}
            <span className={cn('grid h-6 w-6 flex-none place-items-center rounded-[var(--r-md)] border border-[var(--line)] bg-[var(--card)] max-sm:hidden', TRACE_ICON[s.kind])}><Icon name={s.icon ?? (s.kind === 'llm' ? 'asterisk' : s.kind === 'tool' ? 'code' : 'bot')} size={13} /></span>
            <span dir="auto" className="min-w-0 truncate"><span className={failed ? 'text-[var(--bad)]' : 'text-[var(--fg)]'}>{s.name}</span>{s.meta && <em className="ms-1 text-[var(--fg3)] not-italic">{s.meta}</em>}</span>
            <span className="ms-auto flex flex-none">{live && s.kind !== 'agent' && <Spinner size={12} tone="accent" label={m('running', { name: s.name })} className="motion-reduce:animate-none" />}</span>
          </div>
          <div className="relative h-full border-s border-[var(--line)]">
            {ticks.slice(1).map(t => <span key={t} className="pointer-events-none absolute inset-y-0 w-px bg-[var(--line)] opacity-70" style={{ /* rtl-lint-ignore: LTR plot */ left: pct(t) }} />)}
            {wires.get(s.id)?.map(({ c, part }) => (
              <span key={`${c.id}-${part}`} aria-hidden style={{ /* rtl-lint-ignore: LTR plot */ left: `calc(${pct(c.start)} - 6px)` }}
                className={cn('pointer-events-none absolute transition-[opacity,border-color] duration-200', chain.has(c.id) ? TRACE_WIRE_ON : TRACE_WIRE,
                  part === 'elbow' ? 'top-0 h-5 w-[7px] rounded-es-[5px] border-b border-s' : 'w-0 border-s', part === 'stub' && 'top-[27px] bottom-0', part === 'through' && 'inset-y-0', part === 'stub' && !isOpen && 'opacity-0')} />
            ))}
            <div ref={geoRef(s.id + ':bar')} className={cn('absolute top-[13px] h-3.5 min-w-0.5 overflow-hidden rounded-[var(--r-md)]', failed ? 'bg-[color-mix(in_srgb,var(--bad)_72%,var(--card))]' : TRACE_BAR[s.kind])}
              style={{ /* rtl-lint-ignore: LTR plot */ left: pct(s.start), width: pct(w), opacity: started ? 1 : 0 }}>
              {live && <span className="absolute inset-y-0 end-0 w-10 max-w-full bg-[linear-gradient(90deg,transparent,rgba(255,255,255,.55))]" />}
            </div>
            <div ref={geoRef(s.id + ':label')} className="absolute top-[11px] flex items-center gap-2 text-xs whitespace-nowrap text-[var(--fg2)]" style={{ /* rtl-lint-ignore: LTR plot */ left: `calc(${pct(s.start + w)} + 10px)`, opacity: started ? 1 : 0 }}>
              {failed ? (
                <span className="inline-flex items-center gap-1 font-medium text-[var(--bad)]"><Icon name="alertCircle" size={12} /><span dir={dir}>{m('failed', { time: secs(du), message: failure!.message })}</span></span>
              ) : started && (
                <>
                  <span>{secs(fin ? s.duration : w, s.duration >= 10 && fin ? 0 : 1)}{s.cost ? <> · <span className={fin ? 'text-[var(--fg2)]' : 'text-[var(--fg3)]'}>{fmt.usd(s.cost * (fin ? 1 : frac))}</span></> : null}</span>
                  {fin && s === slowest && <span className="rounded-[var(--r-sm)] bg-[var(--warn-soft)] px-1.5 py-0.5 text-[11px] font-semibold tracking-[.04em] text-[var(--warn)] uppercase">{m('slowest')}</span>}
                </>
              )}
            </div>
          </div>
        </motion.div>
        {ch.length > 0 && <Collapse open={isOpen} className={DG_COLLAPSE_STICKY}>{ch.map(row)}</Collapse>}
      </Fragment>
    )
  }
  const badge = !done ? (errs ? ['warn', m('liveError', { n: errs })] : ['accent', m('live')]) : (errs ? ['bad', m('completeError', { n: errs })] : ['ok', m('complete')])
  const stat = (label: string, v: ReactNode, cls?: string) => <div className="border-[var(--line)] px-4 py-3 not-first:border-s max-md:[&:nth-child(4)]:border-s-0 max-md:[&:nth-child(n+4)]:border-t"><span className="mb-1 block text-xs text-[var(--fg3)]">{label}</span><b className={cn('flex items-baseline text-[22px] font-semibold tracking-tight', cls)}>{v}</b></div>
  return (
    <div ref={box} className={cn('flex flex-col gap-3', className)}>
      <div className="flex justify-end gap-2">
        <Button size="sm" className={TOUCH.tap36} onClick={() => play(true)} disabled={!failure}>{m('simulate')}</Button>
        <Button size="sm" className={TOUCH.tap36} onClick={() => play(false)}>{m('replay')}</Button>
      </div>
      <div className={cn('overflow-hidden', surface.card)}>
        <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5 border-b border-[var(--line)] px-4 py-3 text-sm">
          <span className="text-[var(--accent)]">✦</span><b className="font-semibold">{title ?? m('title')}</b>{subtitle && <span className="text-[var(--fg3)]">{subtitle}</span>}
          <span className="flex-1" />
          <span className="me-1.5 flex flex-wrap items-center gap-3 text-xs text-[var(--fg2)]">
            {(['llm', 'tool', 'agent'] as const).map(k => <span key={k} className="inline-flex items-center gap-1"><i className={cn('inline-block h-2.5 w-2.5 rounded-[var(--r-sm)]', TRACE_BAR[k])} />{m(k)}</span>)}
          </span>
          <Badge tone={badge[0] as 'ok'}><span className={cn('h-1.5 w-1.5 rounded-full bg-current', !done && 'animate-pulse motion-reduce:animate-none')} />{badge[1]}</Badge>
        </div>
        <div className="grid grid-cols-3 border-b border-[var(--line)] md:grid-cols-6">
          {stat(m('duration'), <AnimatedNumber locale={locale} value={S.dur} format={{ style: 'unit', unit: 'second', unitDisplay: 'narrow' }} />)}
          {stat(m('cost'), <AnimatedNumber locale={locale} value={S.cost} format={{ style: 'currency', currency: 'USD', currencyDisplay: 'narrowSymbol', minimumFractionDigits: 2, maximumFractionDigits: 2 }} />)}
          {stat(m('tokens'), <AnimatedNumber locale={locale} value={Math.round(S.tok)} format={{ notation: 'compact', maximumFractionDigits: 1 }} />)}
          {stat(m('llmCalls'), <AnimatedNumber locale={locale} value={S.llm} />)}
          {stat(m('toolCalls'), <AnimatedNumber locale={locale} value={S.tool} />)}
          {stat(m('errors'), <AnimatedNumber locale={locale} value={S.errs} />, S.errs ? 'text-[var(--bad)]' : undefined)}
        </div>
        <div className="relative">
        {/* the waterfall is a plot: time runs left to right in every locale (like Gantt and charts); the span names, the
            header, the stat strip and tooltips follow the locale */}
        <div dir="ltr" className="relative">
        <div ref={scrollRef} className="relative overflow-x-auto overscroll-x-contain [--ind:28px] [--split:38%] max-sm:[--ind:12px] max-sm:[--split:168px]">
          <div className="min-w-[560px]">
            <div className="grid h-9 grid-cols-[var(--split)_1fr] items-center border-b border-[var(--line)] text-xs text-[var(--fg3)]">
              <div dir={dir} className="sticky left-0 z-[2] flex h-full items-center bg-[var(--card)] ps-4 shadow-[1px_0_0_var(--line)]">{m('span')}</div>{/* rtl-lint-ignore: pinned column of the LTR plot */}
              <div ref={laneRef} className="relative h-full border-s border-[var(--line)]">{ticks.map(t => <span key={t} className="absolute top-2.5 translate-x-1.5" style={{ left: pct(t) }}>{secs(t, 0)}</span>)}</div>{/* rtl-lint-ignore: LTR plot geometry */}
            </div>
            <div className="relative">
              {annotations && (
                <div className="grid h-9 grid-cols-[var(--split)_1fr] items-center border-b border-[var(--line)]">
                  <div dir={dir} className="sticky left-0 z-[3] flex h-full items-center bg-[var(--card)] ps-4 text-xs text-[var(--fg3)] shadow-[1px_0_0_var(--line)]">{m('events')}</div>{/* rtl-lint-ignore: pinned column of the LTR plot */}
                  <div ref={annRow} {...annFocus.props} className="relative z-[2] h-full rounded-[var(--r-sm)] border-s border-[var(--line)] outline-none focus-visible:shadow-[inset_0_0_0_2px_var(--accent)]"
                    onPointerLeave={onMouseLeave(() => { setAnnOn(null); hide() })}>
                    {ann.map(t => {
                      const p = annLayout?.points.find(q => q.tag.id === t.id), { icon, color } = timeTagLook(t, annotationKinds)
                      const on = annOn === t.id, reached = clock >= annSec(t), opt = annFocus.option(t)
                      const bind = { 'data-ann': t.id, onPointerEnter: () => setAnnOn(t.id), onPointerDown: (e: ReactPointerEvent) => { if (isTouch(e)) setAnnOn(t.id) } }
                      const left = `${(annSec(t) / total) * 100}%` /* rtl-lint-ignore: LTR plot */
                      if (!p || p.hidden) return <span key={t.id} {...opt} {...bind} style={TAG_SR_ONLY} />
                      if (annotationStyle === 'rug') return (
                        <span key={t.id} {...opt} {...bind} className="ui-target absolute top-1/2 -translate-x-1/2 -translate-y-1/2 cursor-default transition-opacity duration-200" style={{ /* rtl-lint-ignore: inside the LTR plot island */ left, opacity: reached || on ? 1 : 0.55 }}>
                          <TagGlyph aria-hidden icon={icon} color={color} size={16} active={on} more={p.more?.length} />
                        </span>
                      )
                      return p.flag ? (
                        <span key={t.id} {...opt} {...bind} className={cn('absolute top-1 flex h-5 cursor-default items-center gap-1 px-1.5 text-[11px] leading-none font-medium whitespace-nowrap text-[var(--fg)] transition-[opacity,box-shadow] duration-200',
                          /* rtl-lint-ignore: LTR plot island */ annFlip.has(t.id) ? 'flex-row-reverse -translate-x-full rounded-s-[var(--r-sm)] border-e-2' : 'rounded-e-[var(--r-sm)] border-s-2')}
                          style={{ /* rtl-lint-ignore: inside the LTR plot island */ left, borderColor: color, background: timeTagTint(color, on ? 30 : reached ? 16 : 7), color: reached || on ? undefined : 'var(--fg2)' }}>
                          {icon && <span aria-hidden className="text-[10px]">{icon}</span>}{t.label}
                        </span>
                      ) : (
                        <span key={t.id} {...opt} {...bind} className={cn('ui-target absolute bottom-1 h-1.5 w-1.5 -translate-x-1/2 cursor-default rounded-full transition-transform duration-150', on && 'scale-150')} style={{ /* rtl-lint-ignore: inside the LTR plot island */ left, background: color, opacity: reached || on ? 1 : 0.55 }} />
                      )
                    })}
                  </div>
                </div>
              )}
              {root && row(root)}
              {laneW > 0 && (
                <div ref={headEl} className="pointer-events-none absolute top-0 bottom-0 w-[1.5px] bg-[var(--accent)] opacity-80" style={{ /* rtl-lint-ignore: LTR plot */ left: `calc(var(--split) + ${(laneW * Math.min(clock, total)) / total}px)` }}>
                  <i className="absolute -top-1 -start-[3.5px] h-2 w-2 rounded-full bg-[var(--accent)]" />
                </div>
              )}
              {ann.length > 0 && (
                <div aria-hidden className="pointer-events-none absolute inset-0 z-[1]">
                  {ann.map(t => {
                    const on = annOn === t.id, f = annSec(t) / total
                    if (annotationStyle === 'rug' && !on) return null
                    return <span key={t.id} className={cn('absolute inset-y-0 border-s transition-opacity duration-200', on ? 'border-solid' : 'border-dashed')}
                      style={{ /* rtl-lint-ignore: LTR plot */ left: `calc(var(--split) + (100% - var(--split)) * ${f})`, borderColor: timeTagLook(t, annotationKinds).color, opacity: on ? 1 : clock >= annSec(t) ? 0.7 : 0.3 }} />
                  })}
                </div>
              )}
            </div>
          </div>
        </div>
        {/* span names are pinned on the left, so only the right edge fades */}
        <ScrollEdges left={false} right={scroll.right} touched={scroll.touched} />
        </div>
        </div>
      </div>
      <PointerTooltip tip={tip} />
    </div>
  )
}
