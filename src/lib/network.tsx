import { useEffect, useId, useLayoutEffect, useMemo, useReducer, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react'
import { AnimatePresence, animate, motion, useInView, useReducedMotion } from 'motion/react'
import { AnimatedNumber, Button, ICONS, Icon, StatusIcon, TOUCH, clamp, cn, defineMessages, isTouch, onMouseLeave, safeColor, sleep, spring, surface, useLocale, useMessages, useOutside, useWidth, type IconName } from './core'
import { Slider } from './forms'
import { PointerTooltip, usePointerTooltip } from './overlay'
import { useFrameLoop, useViewport } from './motion'
import { DG_DOTS, DgDot, dgBez, dgSafeId } from './diagramkit'
import type { StatechartDot } from './statechart'

/* DIAGRAMS · Flows and graphs: Sankey, force-directed network graph, process flow canvas and streaming data flow. */

/* ════════════════════════════════════════════════════════════════════════════
 * Sankey
 * ══════════════════════════════════════════════════════════════════════════ */

/** Sankey, NetworkGraph, ProcessFlow and DataFlow strings (machine-drafted de/ar). */
export const NETWORK_MESSAGES = defineMessages('network', {
  en: {
    sankey: 'Sankey diagram', flow: '{from} → {to} · {share}', graph: 'Network graph', shuffle: 'Shuffle',
    nodeLabel: '{name}, {group}, {n, plural, one {# connection} other {# connections}}',
    counts: '{nodes, plural, one {# node} other {# nodes}} · {links, plural, one {# link} other {# links}}',
    graphHint: 'Tap a node to highlight its links · drag a node to move it',
    idle: 'Idle · {n, plural, one {# step} other {# steps}}', completed: 'Completed in {time}', run: 'Run', fit: 'Fit view',
    review: 'Needs review', running: 'Running', done: 'Done', waiting: 'Waiting', panHint: 'Drag sideways to pan · pinch to zoom',
    engine: 'Engine', ingest: 'Ingest', transform: 'Transform', enrich: 'Enrich', route: 'Route',
    speed: 'Speed', resume: 'Resume', dataFlow: 'Data flow from sources through a processing engine to destinations',
    rate: '{n} ev/s', delivered: '{n} delivered', throughput: 'Throughput', processed: 'Processed', inFlight: 'In flight', latency: 'Latency p95', perSec: 'ev/s', ms: 'ms',
  },
  de: {
    sankey: 'Sankey-Diagramm', flow: '{from} → {to} · {share}', graph: 'Netzwerkgraph', shuffle: 'Mischen',
    nodeLabel: '{name}, {group}, {n, plural, one {# Verbindung} other {# Verbindungen}}',
    counts: '{nodes, plural, one {# Knoten} other {# Knoten}} · {links, plural, one {# Verbindung} other {# Verbindungen}}',
    graphHint: 'Tippe auf einen Knoten, um seine Verbindungen hervorzuheben · ziehe ihn, um ihn zu verschieben',
    idle: 'Bereit · {n, plural, one {# Schritt} other {# Schritte}}', completed: 'Abgeschlossen in {time}', run: 'Ausführen', fit: 'Ansicht einpassen',
    review: 'Prüfung nötig', running: 'Läuft', done: 'Fertig', waiting: 'Wartet', panHint: 'Seitlich ziehen zum Verschieben · zwei Finger zum Zoomen',
    engine: 'Engine', ingest: 'Aufnahme', transform: 'Umwandlung', enrich: 'Anreicherung', route: 'Weiterleitung',
    speed: 'Tempo', resume: 'Fortsetzen', dataFlow: 'Datenfluss von den Quellen über eine Verarbeitungs-Engine zu den Zielen',
    rate: '{n} Ereignisse/s', delivered: '{n} zugestellt', throughput: 'Durchsatz', processed: 'Verarbeitet', inFlight: 'Unterwegs', latency: 'Latenz p95', perSec: 'Ereignisse/s', ms: 'ms',
  },
  ar: {
    sankey: 'مخطط سانكي', flow: '{from} ← {to}، {share}', graph: 'مخطط الشبكة', shuffle: 'خلط',
    nodeLabel: '{name}، {group}، {n, plural, zero {لا اتصالات} one {اتصال واحد} two {اتصالان} few {# اتصالات} many {# اتصالًا} other {# اتصال}}',
    counts: '{nodes, plural, one {عقدة واحدة} two {عقدتان} few {# عقد} many {# عقدة} other {# عقدة}}، {links, plural, one {رابط واحد} two {رابطان} few {# روابط} many {# رابطًا} other {# رابط}}',
    graphHint: 'انقر على عقدة لإبراز روابطها، اسحب العقدة لتحريكها',
    idle: 'خامل، {n, plural, one {خطوة واحدة} two {خطوتان} few {# خطوات} many {# خطوة} other {# خطوة}}', completed: 'اكتمل في {time}', run: 'تشغيل', fit: 'ملاءمة العرض',
    review: 'يحتاج إلى مراجعة', running: 'قيد التشغيل', done: 'تم', waiting: 'بالانتظار', panHint: 'اسحب أفقيًا للتحريك، اضغط بإصبعين للتكبير',
    engine: 'المحرك', ingest: 'الاستيعاب', transform: 'التحويل', enrich: 'الإثراء', route: 'التوجيه',
    speed: 'السرعة', resume: 'استئناف', dataFlow: 'تدفق البيانات من المصادر عبر محرك المعالجة إلى الوجهات',
    rate: '{n} حدث/ث', delivered: 'سُلّم {n}', throughput: 'الإنتاجية', processed: 'تمت معالجته', inFlight: 'قيد النقل', latency: 'زمن الاستجابة p95', perSec: 'حدث/ث', ms: 'مللي ث',
  },
})

export type SankeyNode = { label: string; color?: string }
type SankeyHover = { k: 'link' | 'src' | 'dst'; i: number } | null

/**
 * Two-column Sankey: source nodes on the left, targets on the right, ribbons sized by value with % labels.
 * Hover, tap (or focus) a ribbon or a node to isolate its flows; tap outside to clear. The ribbons wipe in when scrolled into view.
 */
export function Sankey({ sources, targets, links, width = 300, height = 176, nodeWidth = 9, gap = 10, className }:
  { sources: SankeyNode[]; targets: SankeyNode[]; links: [number, number, number][]; width?: number; height?: number; nodeWidth?: number; gap?: number; className?: string }) {
  const [hover, setHover] = useState<SankeyHover>(null)
  const ref = useRef<SVGSVGElement>(null)
  const inView = useInView(ref, { once: true, amount: 0.4 })
  const { tip, show, hide } = usePointerTooltip()
  const m = useMessages(NETWORK_MESSAGES), { fmt } = useLocale()
  useOutside([ref], () => setHover(null), hover !== null, { escape: true })
  const clip = dgSafeId(useId())
  const W = width, H = height, pad = 4, nw = nodeWidth, xL = 70, xR = W - 70 - nw
  const total = links.reduce((a, l) => a + l[2], 0) || 1
  const k = (H - pad * 2 - gap * (Math.max(sources.length, targets.length) - 1)) / total
  const share = (v: number) => fmt.percent(v / total, 0)
  const lv = sources.map((_, i) => links.filter(l => l[0] === i).reduce((a, l) => a + l[2], 0))
  const rv = targets.map((_, i) => links.filter(l => l[1] === i).reduce((a, l) => a + l[2], 0))
  const place = (vals: number[]) => { const h = vals.map(v => v * k), tH = h.reduce((a, b) => a + b, 0) + gap * (vals.length - 1); let y = (H - tH) / 2; return h.map(hh => { const r = { y, h: hh }; y += hh + gap; return r }) }
  const LP = place(lv), RP = place(rv)
  const lOff = LP.map(n => n.y), rOff = RP.map(n => n.y), rStart = new Map<number, number>()
  links.map((l, i) => [l, i] as const).sort((a, b) => a[0][1] - b[0][1] || a[0][0] - b[0][0]).forEach(([l, i]) => { rStart.set(i, rOff[l[1]]); rOff[l[1]] += l[2] * k })
  const ribbons = links.map((l, i) => [l, i] as const).sort((a, b) => a[0][0] - b[0][0] || a[0][1] - b[0][1]).map(([l, i]) => {
    const h = l[2] * k, y0 = lOff[l[0]]; lOff[l[0]] += h
    const y1 = rStart.get(i)!, x0 = xL + nw, x1 = xR, mx = (x0 + x1) / 2
    return { i, l, d: `M${x0},${y0} C${mx},${y0} ${mx},${y1} ${x1},${y1} L${x1},${y1 + h} C${mx},${y1 + h} ${mx},${y0 + h} ${x0},${y0 + h} Z` }
  })
  const op = (i: number, l: [number, number, number]) => !hover ? 0.3 : hover.k === 'link' ? (hover.i === i ? 0.62 : 0.12) : (hover.k === 'src' ? l[0] : l[1]) === hover.i ? 0.62 : 0.1
  const node = (side: 'src' | 'dst', n: SankeyNode, i: number, p: { y: number; h: number }, v: number) => {
    const left = side === 'src', x = left ? xL : xR, tx = left ? xL - 7 : xR + nw + 7
    return (
      <motion.g key={`${side}${i}`} initial={{ opacity: 0 }} animate={inView ? { opacity: 1 } : undefined} transition={{ duration: 0.3, delay: left ? 0 : 0.55 }}
        tabIndex={0} role="button" aria-labelledby={`${clip}${side}${i}l ${clip}${side}${i}v`} className="cursor-default outline-none [&:focus-visible>rect:nth-child(2)]:stroke-[var(--fg)] [&:focus-visible>rect:nth-child(2)]:[stroke-width:2]"
        onPointerEnter={() => setHover({ k: side, i })} onPointerDown={() => { hide(); setHover({ k: side, i }) }} onPointerLeave={onMouseLeave(() => setHover(null))} onFocus={() => setHover({ k: side, i })} onBlur={() => setHover(null)}>
        <rect x={left ? 0 : x} y={p.y - 2} width={left ? x + nw : W - x} height={p.h + 4} fill="transparent" />
        <rect x={x} y={p.y} width={nw} height={p.h} rx={2} fill={n.color ?? PALETTE_DG[i % PALETTE_DG.length]} />
        {/* named by its two visible texts (aria-labelledby); the space between them (not rendered in SVG) keeps the
            visible text "Organic 60%" rather than "Organic60%", so name and visible label match */}
        <text id={`${clip}${side}${i}l`} x={tx} y={p.y + p.h / 2 - 2} textAnchor={left ? 'end' : 'start'} className="fill-[var(--fg)] [font:500_12px_var(--font)]">{n.label}</text>
        {' '}<text id={`${clip}${side}${i}v`} x={tx} y={p.y + p.h / 2 + 12} textAnchor={left ? 'end' : 'start'} className="fill-[var(--fg3)] [font:12px_var(--font)]">{share(v)}</text>
      </motion.g>
    )
  }
  return (
    // a flow diagram keeps its left-to-right geometry in every locale (like charts); the tooltip follows the locale
    <div dir="ltr" className={className}>
      <svg ref={ref} viewBox={`0 0 ${W} ${H}`} role="group" aria-label={m('sankey')} className="block h-auto w-full overflow-visible">
        <defs><clipPath id={clip}><motion.rect x={0} y={0} height={H} initial={{ width: 0 }} animate={inView ? { width: W } : undefined} transition={{ duration: 1, ease: [0.22, 1, 0.36, 1], delay: 0.1 }} /></clipPath></defs>
        <g clipPath={`url(#${clip})`}>
          {ribbons.map(({ i, l, d }) => (
            <motion.path key={i} d={d} fill={sources[l[0]].color ?? PALETTE_DG[l[0] % PALETTE_DG.length]} initial={false} animate={{ opacity: op(i, l) }} transition={{ duration: 0.15 }}
              onPointerEnter={() => setHover({ k: 'link', i })} onPointerDown={e => { setHover({ k: 'link', i }); show(e, m('flow', { from: sources[l[0]].label, to: targets[l[1]].label, share: share(l[2]) })) }}
              onPointerMove={e => show(e, m('flow', { from: sources[l[0]].label, to: targets[l[1]].label, share: share(l[2]) }))} onPointerLeave={onMouseLeave(() => { setHover(null); hide() })} />
          ))}
        </g>
        {sources.map((n, i) => node('src', n, i, LP[i], lv[i]))}
        {targets.map((n, i) => node('dst', n, i, RP[i], rv[i]))}
      </svg>
      <PointerTooltip tip={tip} />
    </div>
  )
}
const PALETTE_DG = ['var(--c2)', 'var(--c3)', 'var(--c4)', 'var(--c1)', 'var(--bad)', 'var(--warn)']

/* ════════════════════════════════════════════════════════════════════════════
 * Network graph (force layout, no library)
 * ══════════════════════════════════════════════════════════════════════════ */

export type NetworkNode = { label: string; group: number; size?: number }
type NetSim = { x: number; y: number; vx: number; vy: number; fx: number | null; fy: number | null }

/**
 * Force-directed graph (repulsion, springs, centring) simulated in-file. Drag a node to pin it while you move it,
 * hover, tap or focus a node to highlight its neighbours (tap it again or outside to clear), Shuffle to re-scatter.
 * Nodes catch touches in a wider ring; swipes over empty canvas still scroll the page. Settles when scrolled into view.
 * The simulation pauses while the graph is off screen or hidden (width 0) and resumes where it was when it comes back;
 * it stops once it has cooled down, and while it runs it moves the nodes by writing their attributes directly (no re-render per frame).
 */
export function NetworkGraph({ nodes, links, groups, width = 900, height = 340, className }:
  { nodes: NetworkNode[]; links: [number, number][]; groups: [string, string][]; /** used until the container is measured */ width?: number; height?: number; className?: string }) {
  // the layout is sized to the container (1 SVG unit = 1px) so labels stay 11px and the graph fills the card
  const [wrapRef, measured] = useWidth<HTMLDivElement>()
  const m = useMessages(NETWORK_MESSAGES)
  // hidden (display: none) measures 0: keep the last real size instead of re-laying out for the fallback width
  const lastW = useRef(0); if (measured > 0) lastW.current = Math.round(measured)
  const W = lastW.current || width, H = W < 560 ? Math.max(height, 420) : height
  // deterministic start (a golden-angle spiral by index), so the server and the first client render agree
  const sim = useRef<NetSim[]>(nodes.map((_, i) => ({ x: W / 2 + Math.cos(i * 2.39996) * 7 * Math.sqrt(i + 0.5), y: H / 2 + Math.sin(i * 2.39996) * 7 * Math.sqrt(i + 0.5), vx: 0, vy: 0, fx: null, fy: null })))
  const alpha = useRef(1)
  const [running, setRunning] = useState(false)
  const [, force] = useReducer((x: number) => x + 1, 0)
  const [hl, setHl] = useState<number | null>(null)
  const [dragging, setDragging] = useState<number | null>(null)
  const svgRef = useRef<SVGSVGElement>(null)
  const tap = useRef<{ i: number; x: number; y: number; was: boolean; moved: boolean } | null>(null)
  const inView = useInView(svgRef, { once: true, amount: 0.3 })
  const { visible } = useViewport(svgRef, { amount: 0 })
  const awake = visible && measured > 0
  const reduce = useReducedMotion()
  const lineEls = useRef<(SVGLineElement | null)[]>([]), nodeEls = useRef<(SVGGElement | null)[]>([])
  const nb = useMemo(() => { const s = nodes.map(() => new Set<number>()); links.forEach(([a, b]) => { s[a].add(b); s[b].add(a) }); return s }, [nodes, links])
  const r = (i: number) => nodes[i].size ?? 8
  const labelW = useMemo(() => nodes.map(n => n.label.length * 6.2), [nodes])
  const tick = () => {
    const ns = sim.current, a = alpha.current
    for (let i = 0; i < ns.length; i++) for (let j = i + 1; j < ns.length; j++) {
      const A = ns[i], B = ns[j], dx = B.x - A.x, dy = B.y - A.y, d2 = dx * dx + dy * dy || 0.01, d = Math.sqrt(d2), f = (3200 / d2) * a
      A.vx -= (dx / d) * f; A.vy -= (dy / d) * f; B.vx += (dx / d) * f; B.vy += (dy / d) * f
      const min = r(i) + r(j) + 44
      if (d < min) { const p = ((min - d) / d) * 0.25; A.vx -= dx * p; A.vy -= dy * p; B.vx += dx * p; B.vy += dy * p }
      // labels sit to the right of each dot: nudge apart vertically when one's label runs into the other
      const [L, Rt, li, ri] = dx >= 0 ? [A, B, i, j] : [B, A, j, i]
      if (Math.abs(dy) < 18 && Rt.x - r(ri) - 4 < L.x + r(li) + 5 + labelW[li]) { const p = (18 - Math.abs(dy)) * 0.15 * Math.max(a, 0.3), s = dy >= 0 ? 1 : -1; A.vy -= s * p; B.vy += s * p }
    }
    links.forEach(([ia, ib]) => { const A = ns[ia], B = ns[ib], dx = B.x - A.x, dy = B.y - A.y, d = Math.sqrt(dx * dx + dy * dy) || 0.01, f = (d - 92) * 0.025 * a; A.vx += (dx / d) * f; A.vy += (dy / d) * f; B.vx -= (dx / d) * f; B.vy -= (dy / d) * f })
    ns.forEach((n, i) => {
      n.vx += (W / 2 - 30 - n.x) * 0.002 * a; n.vy += (H / 2 - n.y) * 0.01 * a
      if (n.fx !== null && n.fy !== null) { n.x = n.fx; n.y = n.fy; n.vx = n.vy = 0; return }
      n.vx *= 0.82; n.vy *= 0.82
      n.x = clamp(n.x + n.vx, r(i) + 4, W - r(i) - 70); n.y = clamp(n.y + n.vy, r(i) + 4, H - r(i) - 4)
    })
    alpha.current = Math.max(0.02, a * 0.982)
  }
  /** Moves the drawn nodes and links to the simulation (attribute writes only, no reads, no React render). */
  const paint = () => {
    const ns = sim.current
    nodeEls.current.forEach((g, i) => g?.setAttribute('transform', `translate(${ns[i].x.toFixed(1)},${ns[i].y.toFixed(1)})`))
    links.forEach(([a, b], k) => { const l = lineEls.current[k]; if (!l) return; l.setAttribute('x1', ns[a].x.toFixed(1)); l.setAttribute('y1', ns[a].y.toFixed(1)); l.setAttribute('x2', ns[b].x.toFixed(1)); l.setAttribute('y2', ns[b].y.toFixed(1)) })
  }
  /** Cool enough to stop: low temperature and (almost) nothing moving. */
  const cooled = () => alpha.current <= 0.021 || (alpha.current < 0.08 && sim.current.every(n => Math.abs(n.vx) + Math.abs(n.vy) < 0.04))
  const settle = () => { for (let i = 0; i < 400; i++) tick(); force() }
  const kick = (a: number) => { alpha.current = Math.max(alpha.current, a); if (reduce && dragging === null) settle(); else setRunning(true) }
  useEffect(() => { if (inView) kick(1) }, [inView]) // eslint-disable-line react-hooks/exhaustive-deps
  const size = useRef([W, H])
  useEffect(() => { // container resized: stretch the current layout to the new box, then let it re-settle
    const [w0, h0] = size.current; if (w0 === W && h0 === H) return
    size.current = [W, H]
    sim.current.forEach(n => { n.x *= W / w0; n.y *= H / h0 })
    if (inView) kick(0.3); else force()
  }, [W, H]) // eslint-disable-line react-hooks/exhaustive-deps
  // runs only while on screen and laid out; `running` survives a pause, so it resumes where it left off
  useFrameLoop(running && awake, () => { tick(); paint(); if (cooled() && dragging === null) { alpha.current = 0.02; setRunning(false) } })
  useEffect(() => { if (!running) force() }, [running]) // one React render with the settled positions
  const toSvg = (e: { clientX: number; clientY: number }) => { const svg = svgRef.current!, m = svg.getScreenCTM()!.inverse(), p = new DOMPoint(e.clientX, e.clientY).matrixTransform(m); return p }
  const end = (i: number, e?: ReactPointerEvent) => {
    if (dragging !== i) return
    const n = sim.current[i], t = tap.current; n.fx = n.fy = null; setDragging(null); kick(0.3); tap.current = null
    // a touch tap (no drag) toggles the highlight and keeps it; a drag or a mouse release clears it as before
    if (e?.pointerType === 'touch' && e.type === 'pointerup' && t && !t.moved) setHl(t.was ? null : i)
    else if (e?.pointerType === 'touch' || !e) setHl(null)
  }
  // touch-action on SVG children isn't honoured everywhere: once a node drag is live, keep the page from scrolling under it
  const draggingRef = useRef(dragging); draggingRef.current = dragging
  useEffect(() => {
    const el = svgRef.current; if (!el) return
    const block = (ev: TouchEvent) => { if (draggingRef.current !== null) ev.preventDefault() }
    el.addEventListener('touchmove', block, { passive: false })
    return () => el.removeEventListener('touchmove', block)
  }, [])
  useOutside([], () => setHl(null), hl !== null && dragging === null, { escape: true, keep: t => !!t.closest('[data-net-node]') && !!svgRef.current?.contains(t) })
  const ns = sim.current
  const isOn = (i: number) => hl === null || i === hl || nb[hl].has(i)
  return (
    <div ref={wrapRef} className={cn('flex min-w-0 flex-col gap-2', className)}>
      <div className="flex justify-end"><Button size="sm" className={TOUCH.tap36} onClick={() => { sim.current.forEach(n => { n.x = W / 2 + (Math.random() - 0.5) * W * 0.55; n.y = H / 2 + (Math.random() - 0.5) * H * 0.65 }); kick(1) }}>{m('shuffle')}</Button></div>
      <svg ref={svgRef} viewBox={`0 0 ${W} ${H}`} width={W} height={H} role="group" aria-label={m('graph')} className="block max-w-full [direction:ltr] touch-pan-y select-none">
        <g>
          {links.map(([a, b], k) => {
            const on = hl !== null && (a === hl || b === hl)
            return <line key={k} ref={el => { lineEls.current[k] = el }} x1={ns[a].x.toFixed(1)} y1={ns[a].y.toFixed(1)} x2={ns[b].x.toFixed(1)} y2={ns[b].y.toFixed(1)}
              className={cn('transition-[stroke,opacity] duration-150', on ? 'stroke-[var(--fg2)] [stroke-width:1.8]' : 'stroke-[var(--line2)] [stroke-width:1.2]', hl !== null && !on && 'opacity-12')} />
          })}
        </g>
        <g>
          {nodes.map((n, i) => (
            <g key={i} ref={el => { nodeEls.current[i] = el }} transform={`translate(${ns[i].x.toFixed(1)},${ns[i].y.toFixed(1)})`} tabIndex={0} role="button" aria-label={m('nodeLabel', { name: n.label, group: groups[n.group][0], n: nb[i].size })} data-net-node=""
              className={cn('touch-none outline-none transition-opacity duration-150', dragging === i ? 'cursor-grabbing' : 'cursor-grab', !isOn(i) && 'opacity-25')}
              onPointerEnter={e => { if (dragging === null && !isTouch(e)) setHl(i) }} onPointerLeave={onMouseLeave(() => { if (dragging === null) setHl(null) })}
              onFocus={() => setHl(i)} onBlur={() => setHl(null)}
              onPointerDown={e => { e.preventDefault(); e.currentTarget.setPointerCapture(e.pointerId); tap.current = { i, x: e.clientX, y: e.clientY, was: hl === i, moved: false }; const q = toSvg(e); ns[i].fx = q.x; ns[i].fy = q.y; setDragging(i); setHl(i); alpha.current = Math.max(alpha.current, 0.4); setRunning(true) }}
              onPointerMove={e => { if (dragging !== i) return; const t = tap.current; if (t && !t.moved && Math.hypot(e.clientX - t.x, e.clientY - t.y) > 6) t.moved = true; const q = toSvg(e); ns[i].fx = clamp(q.x, r(i), W - r(i)); ns[i].fy = clamp(q.y, r(i), H - r(i)); alpha.current = Math.max(alpha.current, 0.3); if (reduce) { ns[i].x = ns[i].fx!; ns[i].y = ns[i].fy!; force() } }}
              onPointerUp={e => end(i, e)} onPointerCancel={e => end(i, e)}>
              <circle r={Math.max(r(i) + 6, 18)} fill="transparent" />
              <motion.circle r={r(i)} fill={groups[n.group][1]} className="stroke-[var(--card)] [stroke-width:2]" initial={false} animate={{ scale: dragging === i ? 1.2 : 1 }} transition={spring(0.4, 0.3)} />
              <text x={r(i) + 5} y={4} className="pointer-events-none fill-[var(--fg)] stroke-[var(--card)] [font:500_11px_var(--font)] [paint-order:stroke] [stroke-linejoin:round] [stroke-width:3px]">{n.label}</text>
            </g>
          ))}
        </g>
      </svg>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-[var(--fg3)]">
        {groups.map(([g, c]) => <span key={g} className="inline-flex items-center gap-1"><i className="inline-block h-[9px] w-[9px] rounded-full" style={{ background: c }} />{g}</span>)}
        <span className="ms-auto">{m('counts', { nodes: nodes.length, links: links.length })}</span>
        <span className="hidden w-full [@media(pointer:coarse)]:block">{m('graphHint')}</span>
      </div>
    </div>
  )
}

/* ════════════════════════════════════════════════════════════════════════════
 * Process flow (node canvas)
 * ══════════════════════════════════════════════════════════════════════════ */

export type FlowNode = { id: string; x: number; y: number; icon: IconName; color: string; title: string; desc: string
  /** body text; `{n}` is replaced by the step's animated counter */
  body: string; foot: [string, string] }
export type FlowEdge = { from: string; to: string; alt?: boolean; label?: string }
/** One stage of a run: its nodes execute in parallel; edges into them pulse first. */
export type FlowStep = { log: string; nodes: { id: string; ms: number; count?: number; tone?: 'ok' | 'warn' }[] }
type FlowStatus = 'run' | 'ok' | 'warn' | undefined
const FLOW_W = 232

/**
 * Workflow canvas. Run executes `steps` in order: edges pulse, nodes spin then tick, counters roll and a
 * status pill logs progress. Drag nodes by their header; drag the background to pan; Ctrl/⌘ + scroll zooms at the
 * pointer; +, − and Fit buttons. On touch a vertical swipe scrolls the page, so pan with a sideways drag or two
 * fingers (which also pinch-zoom). Reset cancels a run.
 */
export function ProcessFlow({ nodes: initial, edges, steps, height = 420, idle, done, onComplete, className }:
  { nodes: FlowNode[]; edges: FlowEdge[]; steps: FlowStep[]; height?: number; idle?: string; done?: (seconds: number) => string; onComplete?: () => void; className?: string }) {
  const [pos, setPos] = useState(() => Object.fromEntries(initial.map(n => [n.id, { x: n.x, y: n.y }])))
  const [hs, setHs] = useState<Record<string, number>>({})
  const [view, setView] = useState({ x: 0, y: 0, z: 1 })
  const viewRef = useRef(view); viewRef.current = view
  const [sel, setSel] = useState<string | null>(null)
  const [status, setStatus] = useState<Record<string, FlowStatus>>({})
  const [counts, setCounts] = useState<Record<string, number>>({})
  const [times, setTimes] = useState<Record<string, string>>({})
  const [edgeSt, setEdgeSt] = useState<Record<number, 'live' | 'done'>>({})
  const [dots, setDots] = useState<StatechartDot[]>([])
  const m = useMessages(NETWORK_MESSAGES), { t, fmt, dir } = useLocale()
  const idleText = idle ?? m('idle', { n: initial.length })
  const [log, setLog] = useState(idleText)
  const [running, setRunning] = useState(false)
  const gen = useRef(0)
  const pf = useRef<HTMLDivElement>(null)
  const nodeEls = useRef<Record<string, HTMLDivElement | null>>({})
  const paths = useRef<Record<string, SVGPathElement | null>>({})
  const inView = useInView(pf, { once: true, amount: 0.3 })
  const reduce = useReducedMotion()
  const fitted = useRef(false)

  useLayoutEffect(() => {
    const measure = () => setHs(Object.fromEntries(initial.map(n => [n.id, nodeEls.current[n.id]?.offsetHeight ?? 120])))
    measure()
    const ro = new ResizeObserver(measure); Object.values(nodeEls.current).forEach(el => el && ro.observe(el))
    return () => ro.disconnect()
  }, [initial])
  const tween = (to: { x: number; y: number; z: number }, dur = 0.5) => {
    const from = viewRef.current
    if (reduce) { setView(to); return }
    animate(0, 1, { duration: dur, ease: [0.22, 1, 0.36, 1], onUpdate: k => setView({ x: from.x + (to.x - from.x) * k, y: from.y + (to.y - from.y) * k, z: from.z + (to.z - from.z) * k }) })
  }
  /** Fit everything; `start` (phones) instead opens at a readable zoom on the first steps, to pan from. */
  const fit = (anim = true, start = false) => {
    const el = pf.current; if (!el) return
    let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9
    initial.forEach(n => { const p = pos[n.id]; x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y); x1 = Math.max(x1, p.x + FLOW_W); y1 = Math.max(y1, p.y + (hs[n.id] ?? 120)) })
    const Wc = el.clientWidth, Hc = el.clientHeight, pad = 36, all = Math.min(1.1, (Wc - pad * 2) / (x1 - x0), (Hc - pad * 2) / (y1 - y0))
    const z = start && all < 0.5 ? Math.min(0.72, (Hc - pad * 2) / (y1 - y0)) : all
    const to = { z, x: z === all ? (Wc - (x1 - x0) * z) / 2 - x0 * z : 20 - x0 * z, y: (Hc - (y1 - y0) * z) / 2 - y0 * z }
    if (anim) tween(to); else setView(to)
  }
  // open fitted to the whole flow (phones too: a readable zoom on the first two steps hid the rest); + / pinch zoom in
  useEffect(() => { if (!fitted.current && Object.keys(hs).length) { fitted.current = true; fit(false) } }) // eslint-disable-line react-hooks/exhaustive-deps
  const fitRef = useRef(fit)
  useLayoutEffect(() => { fitRef.current = fit })
  useEffect(() => { // refit when the canvas itself changes size (not on every render)
    let t = 0, w = pf.current?.clientWidth ?? 0
    const ro = new ResizeObserver(() => { const nw = pf.current?.clientWidth ?? 0; if (nw === w) return; w = nw; clearTimeout(t); t = window.setTimeout(() => fitRef.current(true), 120) })
    if (pf.current) ro.observe(pf.current)
    return () => { ro.disconnect(); clearTimeout(t) }
  }, [])
  const zoomAt = (f: number, cx: number, cy: number, anim = true) => {
    const v = viewRef.current, z = Math.max(0.2, Math.min(2, v.z * f)), wx = (cx - v.x) / v.z, wy = (cy - v.y) / v.z, to = { z, x: cx - wx * z, y: cy - wy * z }
    if (anim) tween(to, 0.25); else setView(to)
  }
  useEffect(() => {
    const el = pf.current; if (!el) return
    const wheel = (e: WheelEvent) => { if (!(e.ctrlKey || e.metaKey)) return; e.preventDefault(); const r = el.getBoundingClientRect(); zoomAt(e.deltaY < 0 ? 1.08 : 0.93, e.clientX - r.left, e.clientY - r.top, false) }
    el.addEventListener('wheel', wheel, { passive: false })
    return () => el.removeEventListener('wheel', wheel)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // pointers: drag a node, pan the canvas, pinch with two fingers
  const ptrs = useRef(new Map<number, { x: number; y: number }>())
  const drag = useRef<{ id?: string; sx: number; sy: number; ox: number; oy: number; pinch?: { d: number; z: number; wx: number; wy: number } } | null>(null)
  const [panning, setPanning] = useState(false)
  const onDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement).closest('[data-pfctl]')) return
    pf.current!.setPointerCapture(e.pointerId); ptrs.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
    if (ptrs.current.size === 2) {
      const [a, b] = [...ptrs.current.values()], r = pf.current!.getBoundingClientRect(), v = viewRef.current, mx = (a.x + b.x) / 2 - r.left, my = (a.y + b.y) / 2 - r.top
      // remember the world point under the fingers' midpoint: two fingers pan and pinch around it
      drag.current = { sx: 0, sy: 0, ox: 0, oy: 0, pinch: { d: Math.hypot(a.x - b.x, a.y - b.y), z: v.z, wx: (mx - v.x) / v.z, wy: (my - v.y) / v.z } }; setPanning(true); return
    }
    const node = (e.target as HTMLElement).closest<HTMLElement>('[data-node]')?.dataset.node
    if (node) { setSel(node); drag.current = { id: node, sx: e.clientX, sy: e.clientY, ox: pos[node].x, oy: pos[node].y } }
    else { setSel(null); setPanning(true); drag.current = { sx: e.clientX, sy: e.clientY, ox: viewRef.current.x, oy: viewRef.current.y } }
  }
  const onMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const g = drag.current; if (!g || !ptrs.current.has(e.pointerId)) return
    ptrs.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
    if (g.pinch && ptrs.current.size >= 2) {
      const [a, b] = [...ptrs.current.values()], r = pf.current!.getBoundingClientRect(), d = Math.hypot(a.x - b.x, a.y - b.y)
      const z = Math.max(0.2, Math.min(2, g.pinch.z * (d / g.pinch.d))), mx = (a.x + b.x) / 2 - r.left, my = (a.y + b.y) / 2 - r.top
      setView({ z, x: mx - g.pinch.wx * z, y: my - g.pinch.wy * z }); return
    }
    const dx = e.clientX - g.sx, dy = e.clientY - g.sy
    if (g.id) { const id = g.id; setPos(p => ({ ...p, [id]: { x: g.ox + dx / viewRef.current.z, y: g.oy + dy / viewRef.current.z } })) }
    else setView(v => ({ ...v, x: g.ox + dx, y: g.oy + dy }))
  }
  const onUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    ptrs.current.delete(e.pointerId)
    if (!ptrs.current.size) { drag.current = null; setPanning(false) }
    else if (drag.current?.pinch) { const [p] = [...ptrs.current.values()]; drag.current = { sx: p.x, sy: p.y, ox: viewRef.current.x, oy: viewRef.current.y } } // one finger left: keep panning from here
  }
  // a second finger landing after the page started scrolling can't be pinched; stop the page from moving under a live pinch
  useEffect(() => {
    const el = pf.current; if (!el) return
    const block = (ev: TouchEvent) => { if (ev.touches.length > 1) ev.preventDefault() }
    el.addEventListener('touchmove', block, { passive: false })
    return () => el.removeEventListener('touchmove', block)
  }, [])

  // geometry
  const anchor = (id: string, side: 'l' | 'r') => ({ x: pos[id].x + (side === 'r' ? FLOW_W : 0), y: pos[id].y + (hs[id] ?? 120) / 2 })
  const eg = edges.map(e => { const a = anchor(e.from, 'r'), b = anchor(e.to, 'l'), c = Math.max(60, Math.abs(b.x - a.x) / 2); return { d: `M${a.x},${a.y} C${a.x + c},${a.y} ${b.x - c},${b.y} ${b.x},${b.y}`, mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2 - 6 } })

  // run
  const reset = () => { gen.current++; counters.current.forEach(c => c.stop()); counters.current.clear(); setRunning(false); setStatus({}); setCounts({}); setTimes({}); setEdgeSt({}); setDots([]); setLog(idleText) }
  const pulse = (k: number) => reduce ? Promise.resolve() : new Promise<void>(res => {
    const key = `e${k}-${performance.now()}`
    setDots(ds => [...ds, { key, edge: `e${k}`, ms: 700, ease: 'inOut', onDone: () => { setDots(x => x.filter(d => d.key !== key)); res() } }])
  })
  // counters roll with motion's tween (ease-out cubic); Reset (a new generation) stops them
  const counters = useRef(new Set<{ stop: () => void }>())
  useEffect(() => () => counters.current.forEach(c => c.stop()), [])
  const countTo = (id: string, to: number, ms: number) => new Promise<void>(res => {
    const g0 = gen.current
    const c = animate(0, to, {
      duration: reduce ? 0 : ms / 1000, ease: [0.33, 1, 0.68, 1],
      onUpdate: v => { if (gen.current === g0) setCounts(cs => ({ ...cs, [id]: Math.round(v) })) },
      onComplete: () => { counters.current.delete(c); res() },
    })
    counters.current.add(c)
  })
  const run = async () => {
    if (running) return
    reset(); const g = ++gen.current, ok = () => g === gen.current
    setRunning(true); const t0 = performance.now()
    let prev: string[] = []
    for (const st of steps) {
      const ids = st.nodes.map(n => n.id), into = edges.map((e, k) => [e, k] as const).filter(([e]) => prev.includes(e.from) && ids.includes(e.to)).map(([, k]) => k)
      if (into.length) { setEdgeSt(s => ({ ...s, ...Object.fromEntries(into.map(k => [k, 'live' as const])) })); await Promise.all(into.map(pulse)); if (!ok()) return; setEdgeSt(s => ({ ...s, ...Object.fromEntries(into.map(k => [k, 'done' as const])) })) }
      setLog(st.log)
      await Promise.all(st.nodes.map(async n => {
        setStatus(s => ({ ...s, [n.id]: 'run' })); const s0 = performance.now()
        if (n.count !== undefined) await countTo(n.id, n.count, n.ms); else await sleep(n.ms)
        if (!ok()) return
        setStatus(s => ({ ...s, [n.id]: n.tone ?? 'ok' })); setTimes(ts => ({ ...ts, [n.id]: fmt.duration(Math.max(1000, performance.now() - s0)) }))
      }))
      if (!ok()) return
      prev = ids
    }
    setLog(done ? done((performance.now() - t0) / 1000) : m('completed', { time: fmt.duration(performance.now() - t0) })); setRunning(false); onComplete?.()
  }
  const ctl = 'grid h-[30px] w-[30px] [@media(pointer:coarse)]:h-9 [@media(pointer:coarse)]:w-9 cursor-pointer place-items-center border-0 bg-transparent text-base text-[var(--fg2)] hover:bg-[var(--muted)] hover:text-[var(--fg)] not-first:border-t not-first:border-[var(--line)]'
  const bodyText = (n: FlowNode) => { const parts = n.body.split('{n}'); return parts.length > 1 ? <>{parts[0]}<b className="font-[family-name:var(--mono)] font-semibold text-[var(--fg)]">{fmt.number(counts[n.id] ?? 0)}</b>{parts[1]}</> : n.body }
  return (
    <div className={cn('flex flex-col gap-3', className)}>
      <div className="flex justify-end gap-2">
        <Button size="sm" className={TOUCH.tap36} onClick={reset}>{t('common.reset')}</Button>
        <Button size="sm" variant="primary" className={TOUCH.tap36} onClick={run} disabled={running}><Icon name="play" size={12} filled />{m('run')}</Button>
      </div>
      <div ref={pf} onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}
        className={cn('relative touch-pan-y overflow-hidden rounded-[var(--r-lg)] border border-[var(--line)] select-none max-sm:!h-[min(var(--pf-h),68vh)]', DG_DOTS, panning ? 'cursor-grabbing' : 'cursor-grab')}
        style={{ height, '--pf-h': `${height}px`, backgroundPosition: `${view.x}px ${view.y}px`, backgroundSize: `${18 * view.z}px ${18 * view.z}px` } as CSSProperties}>
        {/* the world layer is plain geometry (pan/zoom transform, node x/y): LTR in every locale; the node cards and the
            canvas controls follow the locale */}
        <div dir="ltr" className="absolute top-0 left-0 origin-top-left" style={{ transform: `translate(${view.x}px,${view.y}px) scale(${view.z})` }}>{/* rtl-lint-ignore: world geometry */}
          <svg className="pointer-events-none absolute top-0 left-0 overflow-visible" width={1} height={1} aria-hidden>{/* rtl-lint-ignore */}
            {eg.map((g, k) => {
              const e = edges[k], st = edgeSt[k]
              return (
                <g key={k}>
                  <motion.path ref={el => { paths.current[`e${k}`] = el }} d={g.d} fill="none" strokeWidth={2} initial={{ opacity: 0 }}
                    animate={{ opacity: inView ? (st === 'done' && e.alt ? 0.6 : 1) : 0, strokeDashoffset: st === 'live' && !reduce ? [0, -12] : 0 }}
                    transition={{ opacity: { duration: 0.4, delay: st ? 0 : 0.2 + k * 0.08 }, strokeDashoffset: st === 'live' ? { duration: 0.6, ease: 'linear', repeat: Infinity } : { duration: 0 } }}
                    strokeDasharray={st === 'live' ? '6 6' : e.alt ? '5 5' : undefined}
                    className={cn('transition-[stroke] duration-300', st === 'live' ? (e.alt ? 'stroke-[var(--warn)]' : 'stroke-[var(--accent)]') : st === 'done' ? (e.alt ? 'stroke-[var(--warn)]' : 'stroke-[var(--fg3)]') : 'stroke-[var(--line2)]')} />
                  {e.label && <text x={g.mx} y={g.my} textAnchor="middle" className="fill-[var(--fg2)] stroke-[var(--bg)] [font:500_11px_var(--font)] [paint-order:stroke] [stroke-width:4px]">{e.label}</text>}
                </g>
              )
            })}
            {dots.map(d => <DgDot key={d.key} path={() => paths.current[d.edge]} ms={d.ms} ease={d.ease} onDone={d.onDone} />)}
          </svg>
          {initial.map((n, i) => {
            const st = status[n.id], hasL = edges.some(e => e.to === n.id), hasR = edges.some(e => e.from === n.id)
            return (
              <motion.div key={n.id} ref={el => { nodeEls.current[n.id] = el }} data-node={n.id} dir={dir} initial={{ opacity: 0, y: 10 }} animate={inView ? { opacity: 1, y: 0, scale: drag.current?.id === n.id ? 1.02 : 1 } : undefined}
                transition={{ opacity: { duration: 0.4, delay: i * 0.08 }, y: { duration: 0.4, delay: i * 0.08 }, scale: spring(0.4, 0.25) }}
                className={cn('absolute cursor-default rounded-[var(--r-lg)] border bg-[var(--card)] shadow-[0_1px_2px_rgba(0,0,0,.05)] transition-[border-color,box-shadow] duration-250',
                  st === 'run' ? 'border-[var(--accent)] !shadow-[0_0_0_3px_var(--accent-soft)]' : st === 'ok' ? 'border-[color-mix(in_srgb,var(--ok)_55%,var(--line))]' : st === 'warn' ? 'border-[color-mix(in_srgb,var(--warn)_60%,var(--line))]' : sel === n.id ? 'border-[var(--fg3)]' : 'border-[var(--line)]')}
                style={{ /* rtl-lint-ignore: canvas geometry */ left: pos[n.id].x, top: pos[n.id].y, width: FLOW_W, zIndex: sel === n.id ? 2 : undefined }}>
                {/* ports are where the edges attach: physical sides, whatever the card's text direction */}
                {hasL && <span /* rtl-lint-ignore: canvas geometry */ className={cn('absolute top-1/2 -left-1.5 -mt-1 h-2.5 w-2.5 rounded-full border-2 bg-[var(--card)]', st ? 'border-[var(--fg3)]' : 'border-[var(--line2)]')} />}
                {hasR && <span className={cn('absolute top-1/2 -right-1.5 -mt-1 h-2.5 w-2.5 rounded-full border-2 bg-[var(--card)]', st ? 'border-[var(--fg3)]' : 'border-[var(--line2)]')} />}
                <div className="flex cursor-grab touch-none items-center gap-2 border-b border-[var(--line)] px-3 py-2.5">
                  <span className="grid h-[26px] w-[26px] flex-none place-items-center rounded-[var(--r-md)]" style={{ color: safeColor(n.color), background: `color-mix(in srgb, ${safeColor(n.color)} 14%, var(--card))` }}><Icon name={n.icon} size={14} /></span>
                  <div className="min-w-0"><div className="text-[13px] leading-tight font-semibold">{n.title}</div><div className="text-[11px] text-[var(--fg3)]">{n.desc}</div></div>
                  {st === 'warn' ? (
                    // StatusIcon has no warning state: same shape, warn colour, "!" instead of the tick
                    <motion.span role="img" aria-label={m('review')} initial={{ scale: 0.4 }} animate={{ scale: 1 }} transition={spring(0.5, 0.35)}
                      className="ms-auto grid h-[18px] w-[18px] flex-none place-items-center rounded-full bg-[var(--warn)] text-[var(--card)]"><Icon name="alert" size={10} strokeWidth={3} /></motion.span>
                  ) : <StatusIcon status={st === 'run' ? 'active' : st === 'ok' ? 'done' : 'pending'} tone="ok" label={st === 'run' ? m('running') : st === 'ok' ? m('done') : m('waiting')} className="ms-auto motion-reduce:animate-none" />}
                </div>
                <div className="px-3 py-2 text-xs leading-[1.45] text-[var(--fg2)]">{bodyText(n)}</div>
                <div className="flex justify-between rounded-b-[var(--r-lg)] border-t border-[var(--line)] bg-[color-mix(in_srgb,var(--muted)_50%,var(--card))] px-3 py-2 text-[11px] text-[var(--fg3)]"><span>{n.foot[0]}</span><span>{times[n.id] ?? n.foot[1]}</span></div>
              </motion.div>
            )
          })}
        </div>
        <div data-pfctl className={cn('absolute bottom-3 start-3 flex flex-col overflow-hidden shadow-[0_1px_2px_rgba(0,0,0,.05)]', surface.md)}>
          <button type="button" aria-label={t('common.zoomIn')} className={ctl} onClick={() => zoomAt(1.25, pf.current!.clientWidth / 2, pf.current!.clientHeight / 2)}>+</button>
          <button type="button" aria-label={t('common.zoomOut')} className={ctl} onClick={() => zoomAt(0.8, pf.current!.clientWidth / 2, pf.current!.clientHeight / 2)}>−</button>
          <button type="button" aria-label={m('fit')} className={ctl} onClick={() => fit()}><Icon name="maximize" size={13} /></button>
        </div>
        <span data-pfctl className="pointer-events-none absolute top-2.5 start-3 hidden rounded-full border border-[var(--line)] bg-[var(--card)] px-2.5 py-1 text-[11px] text-[var(--fg3)] [@media(pointer:coarse)]:block">{m('panHint')}</span>
        <motion.div key={log} data-pfctl initial={{ opacity: 0.4 }} animate={{ opacity: 1 }} transition={{ duration: 0.2 }} aria-live="polite"
          className="absolute end-3 bottom-3 max-w-[calc(100%-76px)] truncate rounded-full border border-[var(--line)] bg-[var(--card)] px-3 py-1 text-xs text-[var(--fg2)] shadow-[0_1px_2px_rgba(0,0,0,.05)]">{log}</motion.div>
      </div>
    </div>
  )
}

/* ════════════════════════════════════════════════════════════════════════════
 * Data flow (sources → engine → destinations)
 * ══════════════════════════════════════════════════════════════════════════ */

export type DataFlowSource = { label: string; icon: IconName; color: string; rate: number }
export type DataFlowTarget = { label: string; icon: IconName; color: string; share: number }
/** A particle: which leg (0 in, 1 out), which path, progress 0–1 and speed. Drawn on one canvas, no DOM node each. */
type DfParticle = { stage: 0 | 1; p: number; t: number; v: number; src: number }
const DF_W = 960, DF_H = 380, DF_NW = 150, DF_NH = 44, DF_ER = 62, DF_NW_T = 148
/** Most particles in flight at once (new ones wait for a free slot). */
const DF_MAX = 120
/** Points per path in the arc-length lookup table. */
const DF_LUT = 64
/** A cubic Bézier [x0,y0, c1x,c1y, c2x,c2y, x1,y1] sampled at DF_LUT points evenly spaced by arc length (x, y pairs). */
function dfLut(P: number[]) {
  const N = 160, xs: number[] = [], ys: number[] = [], acc = [0]
  for (let k = 0; k <= N; k++) { const [x, y] = dgBez(P, k / N); xs.push(x); ys.push(y); if (k) acc.push(acc[k - 1] + Math.hypot(x - xs[k - 1], y - ys[k - 1])) }
  const L = acc[N] || 1, out = new Float32Array(DF_LUT * 2)
  for (let j = 0, k = 0; j < DF_LUT; j++) {
    const s = (j / (DF_LUT - 1)) * L
    while (k < N - 1 && acc[k + 1] < s) k++
    const f = (s - acc[k]) / (acc[k + 1] - acc[k] || 1)
    out[j * 2] = xs[k] + (xs[k + 1] - xs[k]) * f; out[j * 2 + 1] = ys[k] + (ys[k + 1] - ys[k]) * f
  }
  return out
}
const dfD = (P: number[]) => `M${P[0]},${P[1]} C${P[2]},${P[3]} ${P[4]},${P[5]} ${P[6]},${P[7]}`
/** CSS colours (var(), color-mix(), fallbacks) resolved to rgb() through an element's computed `color`. */
function dfResolve(el: HTMLElement, colors: string[]) {
  const prev = el.style.color
  const out = colors.map(c => { el.style.color = ''; el.style.color = safeColor(c, 'var(--fg3)'); return getComputedStyle(el).color })
  el.style.color = prev
  return out
}
/** A soft glow dot (the old blur filter) pre-rendered once per colour, so a frame is a few drawImage calls. */
function dfSprite(color: string, dpr: number) {
  const s = Math.ceil(16 * dpr), cv = document.createElement('canvas'); cv.width = cv.height = s
  const g = cv.getContext('2d')!, r = s / 2, grd = g.createRadialGradient(r, r, 0, r, r, r)
  grd.addColorStop(0, color); grd.addColorStop(0.35, color); grd.addColorStop(1, 'transparent')
  g.globalAlpha = 0.55; g.fillStyle = grd; g.fillRect(0, 0, s, s)
  g.globalAlpha = 1; g.fillStyle = color; g.beginPath(); g.arc(r, r, 1.6 * dpr, 0, Math.PI * 2); g.fill()
  return cv
}
/**
 * Streaming pipeline: particles leave each source at its event rate, pass through the processing engine
 * (its stage label cycles) and fan out to destinations by share. Hover, tap or focus a node to trace its path.
 * Speed slider, Pause, and a live stat strip (throughput, processed, in flight, p95 latency). Below 560px the
 * pipeline turns vertical (sources above the engine, destinations below) so labels stay full size on phones.
 * Particles are drawn on one canvas from per-path lookup tables (no DOM reads or writes per frame), capped at 120 in
 * flight, and everything pauses while the diagram is off screen.
 */
export function DataFlow({ sources, targets, engine: engineProp, stages: stagesProp, className }:
  { sources: DataFlowSource[]; targets: DataFlowTarget[]; engine?: string; stages?: string[]; className?: string }) {
  const [wrapRef, wrapW] = useWidth<HTMLDivElement>()
  const m = useMessages(NETWORK_MESSAGES), { t, fmt, locale } = useLocale()
  const engine = engineProp ?? m('engine')
  const stagesDefault = [m('ingest'), m('transform'), m('enrich'), m('route')], stages = stagesProp ?? stagesDefault
  const tall = wrapW > 0 && wrapW < 560
  // phones: two columns of sources, the engine, then two columns of destinations
  const cols2 = (n: number, i: number, top: number, w: number) => { const row = Math.floor(i / 2), solo = i === n - 1 && n % 2 === 1; return [solo ? (w - DF_NW_T) / 2 : 8 + (i % 2) * (DF_NW_T + 8), top + row * (DF_NH + 10)] as const }
  const srcRows = Math.ceil(sources.length / 2), dstRows = Math.ceil(targets.length / 2)
  const W = tall ? DF_NW_T * 2 + 24 : DF_W, er = tall ? 46 : DF_ER, nw = tall ? DF_NW_T : DF_NW, nh = DF_NH
  const ex = W / 2, ey = tall ? 8 + srcRows * (nh + 10) + 40 + er : DF_H / 2
  const dTop = ey + er + 52, H = tall ? dTop + dstRows * (nh + 10) : DF_H
  const [speed, setSpeed] = useState(1)
  const [paused, setPaused] = useState(false)
  const [hl, setHl] = useState<{ k: 's' | 'd'; i: number } | null>(null)
  const [stage, setStage] = useState(0)
  const [stats, setStats] = useState({ tp: 0, processed: 0, inflight: 0, p95: 42, delivered: targets.map(() => 0) })
  const box = useRef<HTMLDivElement>(null)
  const inView = useInView(box, { once: true, amount: 0.3 })
  const { visible } = useViewport(box, { amount: 0.05 })
  const reduce = useReducedMotion()
  const pulseC = useRef<SVGCircleElement>(null)
  const cvRef = useRef<HTMLCanvasElement>(null)
  const sim = useRef({ parts: [] as DfParticle[], acc: sources.map(() => 0), processed: 0, delivered: targets.map(() => 0) })
  const hlRef = useRef(hl); hlRef.current = hl
  const uid = dgSafeId(useId())
  const speedId = `${uid}-speed`
  const sy = (i: number) => 34 + i * ((H - 68 - nh) / Math.max(1, sources.length - 1)), dy = (i: number) => 70 + i * ((H - 140 - nh) / Math.max(1, targets.length - 1))
  const srcAt = (i: number) => tall ? cols2(sources.length, i, 8, W) : [20, sy(i)] as const
  const dstAt = (i: number) => tall ? cols2(targets.length, i, dTop, W) : [W - 20 - nw, dy(i)] as const
  const mid = (n: number, i: number) => i - (n - 1) / 2
  // the links as Bézier control points: they give both the drawn paths and the particles' lookup tables
  const inP = sources.map((_, i) => {
    const [sx0, sy0] = srcAt(i)
    if (tall) { const x0 = sx0 + nw / 2, y0 = sy0 + nh, x1 = ex + mid(sources.length, i) * 12, y1 = ey - er - 6; return [x0, y0, x0, y0 + 40, x1, y1 - 40, x1, y1] }
    const x0 = sx0 + nw, y0 = sy0 + nh / 2, x1 = ex - er - 6, y1 = ey + mid(sources.length, i) * 14; return [x0, y0, x0 + 110, y0, x1 - 110, y1, x1, y1]
  })
  const outP = targets.map((_, i) => {
    const [dx0, dy0] = dstAt(i)
    if (tall) { const x0 = ex + mid(targets.length, i) * 14, y0 = ey + er + 6, x1 = dx0 + nw / 2, y1 = dy0; return [x0, y0, x0, y0 + 30, x1, y1 - 30, x1, y1] }
    const x0 = ex + er + 6, y0 = ey + mid(targets.length, i) * 16, x1 = dx0, y1 = dy0 + nh / 2; return [x0, y0, x0 + 110, y0, x1 - 110, y1, x1, y1]
  })
  const geoKey = JSON.stringify([inP, outP])
  // sampled once per geometry (resize between wide and tall, or new sources/targets), never per frame
  const luts = useMemo(() => ({ in: inP.map(dfLut), out: outP.map(dfLut) }), [geoKey]) // eslint-disable-line react-hooks/exhaustive-deps
  const pickTarget = () => { const tot = targets.reduce((a, t) => a + t.share, 0); let r = Math.random() * tot; return Math.max(0, targets.findIndex(t => (r -= t.share) <= 0)) }

  // canvas: sized from a ResizeObserver entry (no layout reads), colours resolved on mount and on theme changes
  const cv = useRef({ w: 0, h: 0, dpr: 1, sprites: [] as HTMLCanvasElement[], srcSprite: [] as number[], dstSprite: [] as number[], accent: '', now: 0 })
  const drawRef = useRef<(dt: number, now: number) => void>(() => {})
  const colorKey = [...sources, ...targets].map(n => n.color).join('|')
  useEffect(() => {
    const el = cvRef.current; if (!el) return
    const ro = new ResizeObserver(([e]) => {
      const c = cv.current, dpr = Math.min(2, devicePixelRatio || 1), w = e.contentRect.width, h = e.contentRect.height
      if (w === c.w && h === c.h && dpr === c.dpr) return
      c.w = w; c.h = h; c.dpr = dpr; el.width = Math.round(w * dpr); el.height = Math.round(h * dpr)
      drawRef.current(0, c.now) // resizing clears a canvas: repaint the current frame (matters while paused)
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  useEffect(() => {
    const el = cvRef.current; if (!el) return
    const build = () => {
      const c = cv.current, dpr = Math.min(2, devicePixelRatio || 1), all = dfResolve(el, [...sources.map(s => s.color), ...targets.map(t => t.color), 'var(--accent)'])
      c.accent = all.pop()!
      const uniq = [...new Set(all)]
      c.sprites = uniq.map(col => dfSprite(col, dpr))
      c.srcSprite = sources.map((_, i) => uniq.indexOf(all[i])); c.dstSprite = targets.map((_, i) => uniq.indexOf(all[sources.length + i]))
      drawRef.current(0, c.now)
    }
    build()
    // theme switches change the tokens on <html> (data-theme, class, style) or the colour scheme
    const mo = new MutationObserver(build); mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'class', 'style'] })
    const mq = matchMedia('(prefers-color-scheme: dark)'); mq.addEventListener?.('change', build)
    return () => { mo.disconnect(); mq.removeEventListener?.('change', build) }
  }, [colorKey]) // eslint-disable-line react-hooks/exhaustive-deps

  const running = visible && !paused && !reduce
  // one frame: the engine's orbiting rings (dash offsets, so a rotation costs no layout) and every particle
  const draw = (dt: number, now: number) => {
    const S = sim.current, el = cvRef.current, c = cv.current; if (!el || !c.w) return
    c.now = now
    sources.forEach((s, i) => {
      S.acc[i] += (dt * s.rate / 40) * speed
      while (S.acc[i] >= 1) { S.acc[i]--; if (S.parts.length < DF_MAX) S.parts.push({ stage: 0, p: i, t: 0, v: 0.35 + Math.random() * 0.25, src: i }) }
    })
    const g = el.getContext('2d'); if (!g) return
    const k = (c.w / W) * c.dpr, h = hlRef.current, half = 8 * c.dpr
    g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, el.width, el.height)
    let pulse = false
    for (let j = S.parts.length - 1; j >= 0; j--) {
      const q = S.parts[j]
      q.t += dt * q.v * speed
      if (q.t >= 1) {
        if (q.stage === 0) { q.stage = 1; q.t = 0; q.p = pickTarget(); S.processed++; if (S.processed % 6 === 0) pulse = true }
        else { S.delivered[q.p]++; S.parts.splice(j, 1); continue }
      }
      const lut = (q.stage ? luts.out : luts.in)[q.p]; if (!lut) continue
      const f = q.t * (DF_LUT - 1), a = Math.min(DF_LUT - 2, Math.floor(f)), u = f - a
      const x = lut[a * 2] + (lut[a * 2 + 2] - lut[a * 2]) * u, y = lut[a * 2 + 1] + (lut[a * 2 + 3] - lut[a * 2 + 1]) * u
      const dim = h && !((h.k === 's' && q.stage === 0 && q.p === h.i) || (h.k === 'd' && q.stage === 1 && q.p === h.i))
      const sp = c.sprites[q.stage ? c.dstSprite[q.p] : c.srcSprite[q.p]]; if (!sp) continue
      g.globalAlpha = dim ? 0.12 : 1
      g.drawImage(sp, x * k - half, y * k - half)
    }
    g.globalAlpha = 1
    if (c.accent) {
      const ring = (r: number, alpha: number, lw: number, dash: number[], turn: number) => {
        g.globalAlpha = alpha; g.strokeStyle = c.accent; g.lineWidth = lw * k; g.setLineDash(dash.map(d => d * k))
        g.lineDashOffset = (reduce ? 0 : ((now / 1000) * turn) % 1) * 2 * Math.PI * r * k
        g.beginPath(); g.arc(ex * k, ey * k, r * k, 0, Math.PI * 2); g.stroke()
      }
      ring(er + 8, 0.35, 1.5, [3, 7], -1 / 24); ring(er + 18, 0.25, 1, [40, 300], 1 / 9)
      g.setLineDash([]); g.globalAlpha = 1
    }
    if (pulse) pulseC.current?.animate?.([{ fillOpacity: 0.2 }, { fillOpacity: 0.08 }], { duration: 500, easing: 'ease-out' })
  }
  drawRef.current = (dt, now) => draw(running ? dt : 0, now)
  useFrameLoop(running, (dt, now) => draw(dt, now))
  // leaving the screen (or pausing) keeps the particles where they are; reduced motion clears them
  useEffect(() => { if (reduce) { sim.current.parts = []; drawRef.current(0, 0) } }, [reduce])
  useEffect(() => {
    if (!visible || paused) return
    const id = setInterval(() => {
      const S = sim.current
      setStats({ tp: Math.round(sources.reduce((a, s) => a + s.rate, 0) * speed + (Math.random() - 0.5) * 12), processed: S.processed * 40, inflight: S.parts.length, p95: Math.round(42 / Math.max(0.4, speed) + Math.random() * 6), delivered: S.delivered.map(d => d * 40) })
    }, 1000)
    return () => clearInterval(id)
  }, [visible, paused, speed, sources])
  useEffect(() => { if (!visible) return; const id = setInterval(() => setStage(s => (s + 1) % stages.length), 1800); return () => clearInterval(id) }, [visible, stages.length])

  useOutside([], () => setHl(null), hl !== null, { escape: true, keep: t => !!t.closest('[data-df-node]') && !!box.current?.contains(t) })
  const on = (k: 's' | 'd', i: number) => !hl || (hl.k === k && hl.i === i)
  const linkOn = (k: 's' | 'd', i: number) => hl && (hl.k !== k || hl.i === i)
  const node = (k: 's' | 'd', n: DataFlowSource | DataFlowTarget, i: number, x: number, y: number, sub: string) => (
    // named by its visible label and sub line (aria-labelledby), so voice control can target it by what it shows
    <motion.g key={`${k}${i}`} transform={`translate(${x},${y})`} tabIndex={0} role="button" aria-labelledby={`${uid}${k}${i}l ${uid}${k}${i}v`}
      className={cn('cursor-default outline-none transition-opacity duration-200 [&:focus-visible>rect:first-child]:stroke-[var(--accent)] [&:focus-visible>rect:first-child]:[stroke-width:2]', !on(k, i) && '!opacity-30')}
      initial={{ opacity: 0 }} animate={inView ? { opacity: 1 } : undefined} transition={{ duration: 0.4, delay: (k === 'd' ? 0.4 : 0) + i * 0.06 }}
      data-df-node="" onPointerEnter={e => { if (!isTouch(e)) setHl({ k, i }) }} onPointerDown={e => { if (isTouch(e)) setHl(h => h && h.k === k && h.i === i ? null : { k, i }) }} onPointerLeave={onMouseLeave(() => setHl(null))} onFocus={() => setHl({ k, i })} onBlur={() => setHl(null)}>
      <rect width={nw} height={nh} rx={10} className="fill-[var(--card)] stroke-[var(--line)]" />
      <rect x={10} y={10} width={24} height={24} rx={7} style={{ fill: `color-mix(in srgb, ${safeColor(n.color)} 15%, var(--card))` }} />
      <g transform="translate(15.5,15.5) scale(0.54)" style={{ color: safeColor(n.color) }}><path d={ICONS[n.icon]} fill="none" stroke="currentColor" strokeWidth={3.6} strokeLinecap="round" strokeLinejoin="round" /></g>
      <text id={`${uid}${k}${i}l`} x={42} y={tall ? 19 : 20} className={cn('fill-[var(--fg)]', tall ? '[font:500_13px_var(--font)]' : '[font:500_12px_var(--font)]')}>{n.label}</text>
      {' '}<text id={`${uid}${k}${i}v`} x={42} y={34} className={cn('fill-[var(--fg3)]', tall ? '[font:12px_var(--font)]' : '[font:11px_var(--font)]')}>{sub}</text>
    </motion.g>
  )
  const lk = (d: string, k: 's' | 'd', i: number, order: number) => (
    <motion.path key={`${k}${i}`} d={d} fill="none" initial={{ pathLength: reduce ? 1 : 0 }} animate={inView ? { pathLength: 1 } : undefined} transition={{ duration: 0.8, delay: 0.1 + order * 0.05, ease: [0.22, 1, 0.36, 1] }}
      className={cn('transition-[opacity,stroke] duration-200 [stroke-width:1.5]', linkOn(k, i) ? 'stroke-[var(--fg3)]' : 'stroke-[var(--line2)]', hl && !linkOn(k, i) && 'opacity-15')} />
  )
  const stat = (label: string, v: number, unit?: string) => (
    <div className="rounded-[var(--r-md)] bg-[var(--muted)] px-3 py-2.5"><span className="block text-[11px] text-[var(--fg3)]">{label}</span>
      <b className="flex items-baseline text-lg font-semibold tracking-tight"><AnimatedNumber locale={locale} value={v} format={{ maximumFractionDigits: 0 }} />{unit && <span className="ms-0.5 text-xs font-normal text-[var(--fg3)]">{unit}</span>}</b></div>
  )
  return (
    <div ref={box} className={cn('flex flex-col gap-3', className)}>
      <div className="flex items-center justify-end gap-2">
        <label htmlFor={speedId} className="text-xs text-[var(--fg3)]">{m('speed')}</label>
        <div className="w-[90px] [@media(pointer:coarse)]:w-[120px]"><Slider id={speedId} min={0.3} max={3} step={0.1} value={speed} onChange={setSpeed} /></div>
        <Button size="sm" className={TOUCH.tap36} onClick={() => setPaused(p => !p)}>{paused ? m('resume') : t('common.pause')}</Button>
      </div>
      {/* geometry: left-to-right flow in every locale (like charts and Sankey) */}
      <div ref={wrapRef} dir="ltr" className="overflow-x-auto overscroll-x-contain rounded-[var(--r-lg)] border border-[var(--line)] bg-[var(--bg)]">
        <div className={cn('relative', tall ? 'mx-auto max-w-[420px]' : 'min-w-[640px] [@media(pointer:coarse)]:min-w-[960px]')}>
        {/* three layers with one geometry: links (SVG), particles (canvas), nodes and engine (SVG), so particles pass under the nodes */}
        <svg viewBox={`0 0 ${W} ${H}`} aria-hidden className="block h-auto w-full">
          {inP.map((P, i) => lk(dfD(P), 's', i, i))}
          {outP.map((P, i) => lk(dfD(P), 'd', i, sources.length + i))}
        </svg>
        <canvas ref={cvRef} aria-hidden className="pointer-events-none absolute inset-0 h-full w-full" />
        <svg viewBox={`0 0 ${W} ${H}`} role="group" aria-label={m('dataFlow')} className="pointer-events-none absolute inset-0 block h-full w-full [&_[data-df-node]]:pointer-events-auto">
          <g>
            {sources.map((s, i) => node('s', s, i, srcAt(i)[0], srcAt(i)[1], m('rate', { n: Math.round(s.rate * speed) })))}
            {targets.map((t, i) => node('d', t, i, dstAt(i)[0], dstAt(i)[1], m('delivered', { n: fmt.number(stats.delivered[i]) })))}
          </g>
          <g transform={`translate(${ex},${ey})`} role="img" aria-label={`${engine}: ${stages[stage]}`}>
            <motion.g initial={{ opacity: 0, scale: 0.85 }} animate={inView ? { opacity: 1, scale: 1 } : undefined} transition={spring(0.3, 0.6)}>
              <circle r={er + 18} fill="none" stroke="var(--accent)" strokeOpacity={0.12} />
              {/* the two orbiting rings are drawn on the particle canvas (rotating SVG cost a layout every frame) */}
              <circle r={er} className="fill-[var(--card)] stroke-[var(--line)]" />
              <circle ref={pulseC} r={er} fill="var(--accent)" fillOpacity={0.08} />
              <text y={-4} textAnchor="middle" className="fill-[var(--fg)] [font:600_13px_var(--font)]">{engine}</text>
              <AnimatePresence mode="wait" initial={false}>
                <motion.text key={stage} y={15} textAnchor="middle" className={cn('fill-[var(--fg3)]', tall ? '[font:500_12.5px_var(--font)]' : '[font:500_11px_var(--font)]')} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.18 }}>{stages[stage]}</motion.text>
              </AnimatePresence>
            </motion.g>
          </g>
        </svg>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {stat(m('throughput'), paused ? 0 : stats.tp, m('perSec'))}{stat(m('processed'), stats.processed)}{stat(m('inFlight'), stats.inflight)}{stat(m('latency'), stats.p95, m('ms'))}
      </div>
    </div>
  )
}
