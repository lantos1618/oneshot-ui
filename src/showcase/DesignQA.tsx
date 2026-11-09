import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { Badge, Button, IconButton, Kbd, OverlayPortal, Spinner, cn, spring } from '../lib'

/* Design QA: an audit of every card on the page (off-grid spacing, one-off heights, font sizes and radii,
 * misalignment, clipped content, low contrast), a measuring overlay (box model, gaps to neighbours, pinned
 * distances), an 8px grid, element outlines and a live layout-shift (CLS) meter. Opened from the header
 * ruler button or ⇧D. A page tool for this showcase, ported from the original page; not a library component. */

type QaMode = 'm' | 'g' | 'o'
type QaKind = 'spacing' | 'size' | 'type' | 'radius' | 'align' | 'clip' | 'contrast'
type QaIssue = { el: Element; msg: string; val: number }
type QaResult = { issues: Record<QaKind, QaIssue[]>; checked: number; ms: number; total: number; score: number }

/* Shared state, so the header button, ⌘K commands and keyboard shortcuts drive the same panel. */
type QaState = { open: boolean; m: boolean; g: boolean; o: boolean; runs: number; cls: number }
let qaState: QaState = { open: false, m: false, g: false, o: false, runs: 0, cls: 0 }
const qaListeners = new Set<() => void>()
const qaSet = (patch: Partial<QaState>) => { qaState = { ...qaState, ...patch }; qaListeners.forEach(l => l()) }
const qaSubscribe = (l: () => void) => { qaListeners.add(l); return () => { qaListeners.delete(l) } }
/** Current Design QA state (panel open, active overlays). */
export const useDesignQA = () => useSyncExternalStore(qaSubscribe, () => qaState, () => qaState)

/** Imperative controls for the Design QA panel (used by the header button and the command palette). */
export const designQA = {
  toggle: () => qaState.open ? qaSet({ open: false, m: false, g: false, o: false }) : qaSet({ open: true }),
  open: () => qaSet({ open: true }),
  run: () => qaSet({ open: true, runs: qaState.runs + 1 }),
  setMode: (k: QaMode, v?: boolean) => qaSet({ open: true, [k]: v ?? !qaState[k] }),
  showCls: () => qaSet({ open: true, cls: qaState.cls + 1 }),
}

/** The ruler glyph used for the header button and panel title. */
export function QaRulerIcon({ size = 16 }: { size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="flex-none"><path d="M3 21 21 3M7 21v-3M11 21v-5M15 21v-3M3 17h3M3 13h5M3 9h3" /></svg>
}

/** Header button that opens and closes the Design QA panel (⇧D). */
export function DesignQAButton() {
  const { open } = useDesignQA()
  return <Button size="icon" aria-label="Design QA" title="Design QA (⇧D)" aria-pressed={open} onClick={designQA.toggle} className="aria-pressed:!bg-[var(--muted)]"><QaRulerIcon /></Button>
}

/* Audit ─────────────────────────────────────────────────────────────────────── */

const qaPx = (v: string) => parseFloat(v) || 0
/** On the spacing scale: 0, 1, 1.5, even values up to 12, then multiples of 4. */
const qaOnGrid = (n: number) => { const v = Math.abs(Math.round(n * 10) / 10); if (v === 0 || v === 1 || v === 1.5) return true; return v <= 12 ? v % 2 === 0 : v % 4 === 0 }
const qaCard = (el: Element) => el.closest<HTMLElement>('[data-spec]')
const qaVisible = (el: Element) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 && !!qaCard(el) }
/** A short readable name for an element: its card, then tag plus label or text. */
function qaName(el: Element): [string, string] {
  const card = qaCard(el)?.dataset.spec ?? ''
  const label = el.getAttribute('aria-label') || el.getAttribute('role') || (el.textContent ?? '').trim().replace(/\s+/g, ' ')
  const tag = el.tagName.toLowerCase() + (el.id && !el.id.startsWith('«') && !el.id.includes(':') ? '#' + el.id : '')
  return [card, label ? `${tag} “${label.length > 18 ? label.slice(0, 17) + '…' : label}”` : tag]
}

type QaRgb = { r: number; g: number; b: number; a: number }
const qaColorCache = new Map<string, QaRgb | null>()
let qaCtx: CanvasRenderingContext2D | null | undefined
/** Any CSS colour (rgb, color(srgb …), oklch, color-mix results) as sRGB, via a 1×1 canvas. */
function qaRgb(c: string): QaRgb | null {
  if (qaColorCache.has(c)) return qaColorCache.get(c)!
  let out: QaRgb | null = null
  const m = c.match(/^rgba?\(([^)]+)\)$/)
  if (m) { const p = m[1].split(/[\s,/]+/).filter(Boolean).map(Number); out = { r: p[0], g: p[1], b: p[2], a: p[3] ?? 1 } }
  else {
    if (qaCtx === undefined) { const cv = document.createElement('canvas'); cv.width = cv.height = 1; qaCtx = cv.getContext('2d', { willReadFrequently: true }) }
    if (qaCtx) { qaCtx.clearRect(0, 0, 1, 1); qaCtx.fillStyle = '#000'; qaCtx.fillStyle = c; qaCtx.fillRect(0, 0, 1, 1); const d = qaCtx.getImageData(0, 0, 1, 1).data; out = { r: d[0], g: d[1], b: d[2], a: d[3] / 255 } }
  }
  qaColorCache.set(c, out)
  return out
}
const qaLum = ({ r, g, b }: QaRgb) => { const f = (v: number) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4) }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b) }
/** The solid colour behind an element and the element that paints it, or null when it sits on a gradient, image or translucent layer. */
function qaBgOf(el: Element): { c: QaRgb; at: Element | null } | null {
  for (let e: Element | null = el; e; e = e.parentElement) {
    const cs = getComputedStyle(e), c = qaRgb(cs.backgroundColor)
    if (c && c.a > 0.9) return { c, at: e }
    if (c && c.a > 0.25) return null
    if (cs.backgroundImage !== 'none' && e !== el) return null
  }
  const c = qaRgb(getComputedStyle(document.body).backgroundColor)
  return c && { c, at: null }
}
/** Opacity the text is drawn with against its background: the product of `opacity` from the element up to (not
 * including) the one that paints the background. The card itself fades in on scroll, so it stops there too. */
function qaOpacity(el: Element, bgAt: Element | null) {
  let o = 1
  for (let e: Element | null = el; e && e !== bgAt && !e.hasAttribute('data-spec'); e = e.parentElement) o *= parseFloat(getComputedStyle(e).opacity)
  return o
}
/** `fg` drawn at `alpha` over `bg`. */
const qaBlend = (fg: QaRgb, bg: QaRgb, alpha: number): QaRgb => ({ r: fg.r * alpha + bg.r * (1 - alpha), g: fg.g * alpha + bg.g * (1 - alpha), b: fg.b * alpha + bg.b * (1 - alpha), a: 1 })

/** Scan every visible card. Rules ported from the original page. */
function qaAudit(): { issues: Record<QaKind, QaIssue[]>; checked: number } {
  const els = [...document.querySelectorAll('main [data-spec] *')].filter(e => !e.closest('[data-qa-skip]') && qaVisible(e))
  const issues: Record<QaKind, QaIssue[]> = { spacing: [], size: [], radius: [], type: [], align: [], clip: [], contrast: [] }
  const hist = { h: new Map<number, Element[]>(), fs: new Map<number, Element[]>(), rad: new Map<number, Element[]>() }
  const add = (m: Map<number, Element[]>, k: number, el: Element) => { if (!m.has(k)) m.set(k, []); m.get(k)!.push(el) }
  for (const el of els) {
    if (el.closest('svg') && el.tagName.toLowerCase() !== 'svg') continue
    const cs = getComputedStyle(el), r = el.getBoundingClientRect()
    // 1. spacing on a 4px scale (2px steps allowed up to 12px)
    const flexy = cs.display.includes('flex') || cs.display.includes('grid')
    const autoMargin = el.matches('.mt-auto,.mb-auto,.my-auto,.m-auto')
    for (const p of ['paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft', 'marginTop', 'marginBottom', 'rowGap', 'columnGap'] as const) {
      const v = qaPx(cs[p])
      if (p.startsWith('margin') && autoMargin) continue // an auto margin (pushing to the end of a flex column) isn't a spacing value
      if (v && !qaOnGrid(v) && !(p.endsWith('Gap') && !flexy)) issues.spacing.push({ el, msg: `${p.replace(/([A-Z])/g, '-$1').toLowerCase()} ${v}px`, val: v })
    }
    // 2. control heights, font sizes and radii: collected, judged by rarity below
    if (el.matches('button:not([role=switch]):not([role=checkbox]):not([role=radio]):not([role=tab]),input:not([type=checkbox]):not([type=radio]):not([type=range]):not([type=color]),select')) add(hist.h, Math.round(r.height), el)
    const hasText = [...el.childNodes].some(n => n.nodeType === 3 && n.textContent!.trim())
    if (hasText) {
      add(hist.fs, qaPx(cs.fontSize), el)
      // 3. contrast of text on a solid background (WCAG AA: 4.5:1, or 3:1 for large text)
      // the text colour's own alpha and every ancestor's opacity count: faded text is blended into its background (as axe does)
      const fg = qaRgb(cs.color), bgOf = qaBgOf(el), alpha = fg && bgOf ? fg.a * qaOpacity(el, bgOf.at) : 0
      if (fg && bgOf && alpha > 0.1 && !el.closest('[disabled],[aria-disabled="true"],[aria-hidden="true"],[inert]')) {
        const a = qaLum(qaBlend(fg, bgOf.c, alpha)), b = qaLum(bgOf.c), ratio = (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)
        const fs = qaPx(cs.fontSize), big = fs >= 18 || (fs >= 14 && +cs.fontWeight >= 700)
        if (ratio < (big ? 3 : 4.5)) issues.contrast.push({ el, msg: `${ratio.toFixed(2)}:1 at ${fs}px${alpha < 0.99 ? `, ${Math.round(alpha * 100)}% opacity` : ''}`, val: ratio })
      }
    }
    const rad = qaPx(cs.borderTopLeftRadius)
    if (rad && rad < 100 && !cs.borderTopLeftRadius.includes('%') && (cs.borderTopWidth !== '0px' || (qaRgb(cs.backgroundColor)?.a ?? 0) > 0)) add(hist.rad, rad, el)
    // 4. clipped content
    if ((cs.overflow === 'hidden' || cs.overflowX === 'hidden') && cs.textOverflow !== 'ellipsis' && el.scrollWidth > el.clientWidth + 2 && el.clientWidth > 20 && !el.matches('svg,canvas') && el.children.length < 3 && (el.textContent ?? '').trim().length > 2)
      issues.clip.push({ el, msg: `content ${el.scrollWidth - el.clientWidth}px wider than box`, val: el.scrollWidth - el.clientWidth })
    // 5. rows that claim to centre their children but don't
    if (cs.display.includes('flex') && cs.flexDirection.startsWith('row') && cs.alignItems === 'center' && cs.flexWrap === 'nowrap') {
      const kids = [...el.children].filter(k => { const kr = k.getBoundingClientRect(); return kr.height > 6 && kr.height < r.height + 1 && getComputedStyle(k).position !== 'absolute' })
      if (kids.length > 1) {
        const pt = qaPx(cs.paddingTop) + qaPx(cs.borderTopWidth), pb = qaPx(cs.paddingBottom) + qaPx(cs.borderBottomWidth), cy = r.top + pt + (r.height - pt - pb) / 2
        const worst = Math.max(...kids.map(k => { const kr = k.getBoundingClientRect(); return Math.abs(kr.top + kr.height / 2 - cy) }))
        if (worst > 1.5 && worst < 8) issues.align.push({ el, msg: `children off-centre by ${worst.toFixed(1)}px`, val: worst })
      }
    }
  }
  // 6. near-miss left edges inside each card (1 to 3px apart looks like a mistake)
  document.querySelectorAll<HTMLElement>('main [data-spec]').forEach(sp => {
    const base = sp.getBoundingClientRect().left
    if (!sp.getBoundingClientRect().width) return
    const edges = [...sp.querySelectorAll('h3,p,label,input,select,textarea,button,[data-spec-body] > *')].filter(e => !e.closest('[data-qa-skip]') && qaVisible(e))
      .map(e => ({ e, x: Math.round((e.getBoundingClientRect().left - base) * 2) / 2 }))
    for (const a of edges) {
      const near = edges.find(b => b !== a && Math.abs(b.x - a.x) >= 1 && Math.abs(b.x - a.x) <= 3 && a.e.parentElement === b.e.parentElement)
      if (near && a.x > near.x) issues.align.push({ el: a.e, msg: `left edge ${(a.x - near.x).toFixed(1)}px off its sibling`, val: a.x - near.x })
    }
  })
  // rarity: sizes used by only one or two elements stand out as one-offs
  const rare = (m: Map<number, Element[]>, list: QaIssue[], label: string, allow: (k: number) => boolean) => {
    const total = [...m.values()].reduce((a, v) => a + v.length, 0)
    for (const [k, arr] of m) if (arr.length <= 2 && arr.length / total < 0.02 && !allow(k)) arr.forEach(el => list.push({ el, msg: `${label} ${k}px (used ${arr.length}×)`, val: k }))
  }
  rare(hist.h, issues.size, 'height', k => [28, 30, 32, 36, 40, 44].includes(k))
  rare(hist.fs, issues.type, 'font-size', k => [10, 11, 12, 13, 14, 15, 16, 17, 18, 20, 22, 24, 26, 28, 36, 40, 44].includes(k))
  rare(hist.rad, issues.radius, 'radius', k => k >= 18 || [2, 3, 4, 5, 6, 7, 8, 9, 10, 12, 13, 14, 16].includes(k))
  // one row per element and message
  for (const k of Object.keys(issues) as QaKind[]) {
    const seen = new Set<string>()
    issues[k] = issues[k].filter(i => { const key = i.msg + '|' + qaName(i.el).join(); if (seen.has(key)) return false; seen.add(key); return true })
  }
  return { issues, checked: els.length }
}

const QA_GROUPS: [QaKind, string, string, string][] = [
  ['spacing', 'Off-grid spacing', 'bg-[var(--warn)]', 'padding, margin and gaps not on the 4px scale'],
  ['size', 'One-off control heights', 'bg-[var(--warn)]', 'controls whose height no other control shares'],
  ['type', 'One-off font sizes', 'bg-[var(--c3)]', 'sizes outside the type scale'],
  ['radius', 'One-off radii', 'bg-[var(--c3)]', 'corner radii used once or twice'],
  ['align', 'Misalignment', 'bg-[var(--bad)]', 'near-miss edges and off-centre rows'],
  ['clip', 'Clipped content', 'bg-[var(--bad)]', 'content wider than its box'],
  ['contrast', 'Low contrast', 'bg-[var(--bad)]', 'text below WCAG AA'],
]
const QA_TONE = { ok: 'ok', warn: 'warn', bad: 'bad' } as const

/* Overlay drawing (imperative: it follows the pointer every frame) ──────────── */

/* Measurement colours are fixed, saturated and translucent so they read on light and dark pages alike. */
const QA_COL = { content: '#2563EB', margin: 'rgba(249,115,22,.18)', pad: 'rgba(22,163,74,.18)', pin: '#DB2777', bad: '#DC2626', ok: '#16A34A' }
const qaFmt = (v: number) => String(Math.round(v * 10) / 10)
function qaDiv(host: HTMLElement, css: Partial<CSSStyleDeclaration>, text?: string) {
  const d = document.createElement('div')
  Object.assign(d.style, { position: 'fixed', pointerEvents: 'none', boxSizing: 'border-box' }, css)
  if (text != null) { d.textContent = text; Object.assign(d.style, { font: '600 10px/1.3 var(--mono)', color: '#fff', padding: '2px 4px', borderRadius: '4px', whiteSpace: 'nowrap', zIndex: '1' }) }
  host.appendChild(d)
  return d
}
const qaBox = (host: HTMLElement, x: number, y: number, w: number, h: number, css: Partial<CSSStyleDeclaration>) =>
  qaDiv(host, { left: x + 'px', top: y + 'px', width: Math.max(0, w) + 'px', height: Math.max(0, h) + 'px', ...css })
const qaLabel = (host: HTMLElement, txt: string, x: number, y: number, bg = QA_COL.content) =>
  qaDiv(host, { left: Math.max(2, Math.min(innerWidth - 120, x)) + 'px', top: Math.max(2, y) + 'px', background: bg }, txt)
const qaLine = (host: HTMLElement, x: number, y: number, w: number, h: number, bg: string) =>
  qaDiv(host, { left: x + 'px', top: y + 'px', width: Math.max(1, w) + 'px', height: Math.max(1, h) + 'px', background: bg })

/** Margin (orange), padding (green) and content box (blue), with size, padding and font size. */
function qaDrawBoxModel(host: HTMLElement, el: Element) {
  const r = el.getBoundingClientRect(), cs = getComputedStyle(el)
  const m = (['Top', 'Right', 'Bottom', 'Left'] as const).map(s => qaPx(cs[`margin${s}`])), p = (['Top', 'Right', 'Bottom', 'Left'] as const).map(s => qaPx(cs[`padding${s}`]))
  const M = { background: QA_COL.margin }, P = { background: QA_COL.pad }
  qaBox(host, r.left - m[3], r.top - m[0], r.width + m[1] + m[3], m[0], M); qaBox(host, r.left - m[3], r.bottom, r.width + m[1] + m[3], m[2], M)
  qaBox(host, r.left - m[3], r.top, m[3], r.height, M); qaBox(host, r.right, r.top, m[1], r.height, M)
  qaBox(host, r.left, r.top, r.width, p[0], P); qaBox(host, r.left, r.bottom - p[2], r.width, p[2], P)
  qaBox(host, r.left, r.top + p[0], p[3], r.height - p[0] - p[2], P); qaBox(host, r.right - p[1], r.top + p[0], p[1], r.height - p[0] - p[2], P)
  qaBox(host, r.left, r.top, r.width, r.height, { outline: `1.5px solid ${QA_COL.content}`, background: 'rgba(37,99,235,.08)' })
  const pad = p.every(v => v === p[0]) ? qaFmt(p[0]) : p.map(qaFmt).join(' ')
  const hasText = [...el.childNodes].some(n => n.nodeType === 3 && n.textContent!.trim())
  qaLabel(host, `${qaFmt(r.width)} × ${qaFmt(r.height)}${pad !== '0' ? ' · pad ' + pad : ''} · ${hasText ? qaPx(cs.fontSize) + 'px' : el.tagName.toLowerCase()}`, r.left, r.top - 20)
  return r
}
/** Gaps to the nearest sibling on each side: green when both sides match, red when they don't. */
function qaDrawSiblingGaps(host: HTMLElement, el: Element, r: DOMRect) {
  const parent = el.parentElement
  if (!parent) return
  const sib = [...parent.children].filter(s => s !== el && s.getBoundingClientRect().width && getComputedStyle(s).position !== 'absolute')
  if (!sib.length) return
  const pcs = getComputedStyle(parent), row = pcs.display.includes('flex') && pcs.flexDirection.startsWith('row')
  const gaps: ['l' | 'r' | 't' | 'b', number][] = []
  for (const s of sib) {
    const q = s.getBoundingClientRect()
    if (row || Math.abs(q.top - r.top) < 4) { if (q.right <= r.left) gaps.push(['l', r.left - q.right]); if (q.left >= r.right) gaps.push(['r', q.left - r.right]) }
    else { if (q.bottom <= r.top) gaps.push(['t', r.top - q.bottom]); if (q.top >= r.bottom) gaps.push(['b', q.top - r.bottom]) }
  }
  const pick = (d: string) => gaps.filter(g => g[0] === d).sort((a, b) => a[1] - b[1])[0]
  const a = pick('l') ?? pick('t'), b = pick('r') ?? pick('b')
  const col = a && b ? (Math.abs(a[1] - b[1]) < 0.6 ? QA_COL.ok : QA_COL.bad) : QA_COL.pin
  for (const g of [a, b]) {
    if (!g) continue
    const [d, v] = g
    if (d === 'l') { qaLine(host, r.left - v, r.top + r.height / 2, v, 1, col); qaLabel(host, qaFmt(v), r.left - v / 2 - 10, r.top + r.height / 2 + 4, col) }
    if (d === 'r') { qaLine(host, r.right, r.top + r.height / 2, v, 1, col); qaLabel(host, qaFmt(v), r.right + v / 2 - 10, r.top + r.height / 2 + 4, col) }
    if (d === 't') { qaLine(host, r.left + r.width / 2, r.top - v, 1, v, col); qaLabel(host, qaFmt(v), r.left + r.width / 2 + 4, r.top - v / 2 - 8, col) }
    if (d === 'b') { qaLine(host, r.left + r.width / 2, r.bottom, 1, v, col); qaLabel(host, qaFmt(v), r.left + r.width / 2 + 4, r.bottom + v / 2 - 8, col) }
  }
}
/** Distance from the pinned element to the hovered one. */
function qaDrawPinned(host: HTMLElement, pinned: Element, r: DOMRect) {
  const q = pinned.getBoundingClientRect()
  qaBox(host, q.left, q.top, q.width, q.height, { outline: `2px dashed ${QA_COL.pin}` })
  qaLabel(host, 'pinned', q.left, q.top - 20, QA_COL.pin)
  const hx = r.left >= q.right ? [q.right, r.left] : q.left >= r.right ? [r.right, q.left] : null
  const vy = r.top >= q.bottom ? [q.bottom, r.top] : q.top >= r.bottom ? [r.bottom, q.top] : null
  if (hx) { const y = Math.max(r.top, q.top) + Math.min(r.height, q.height) / 2; qaLine(host, hx[0], y, hx[1] - hx[0], 1, QA_COL.pin); qaLabel(host, qaFmt(hx[1] - hx[0]), (hx[0] + hx[1]) / 2 - 10, y + 4, QA_COL.pin) }
  if (vy) { const x = Math.max(r.left, q.left) + Math.min(r.width, q.width) / 2; qaLine(host, x, vy[0], 1, vy[1] - vy[0], QA_COL.pin); qaLabel(host, qaFmt(vy[1] - vy[0]), x + 4, (vy[0] + vy[1]) / 2 - 8, QA_COL.pin) }
  if (!hx && !vy) qaLabel(host, `Δx ${qaFmt(r.left - q.left)} · Δy ${qaFmt(r.top - q.top)}`, r.left, r.bottom + 6, QA_COL.pin)
}

let qaFlashHost: HTMLElement | null = null
/** Outline an element in red with a message for a couple of seconds. */
function qaFlash(el: Element, msg: string) {
  const host = qaFlashHost
  if (!host || !el.isConnected) return
  const r = el.getBoundingClientRect()
  const b = qaBox(host, r.left - 3, r.top - 3, r.width + 6, r.height + 6, { outline: `2px solid ${QA_COL.bad}`, background: 'rgba(220,38,38,.1)', borderRadius: '3px' })
  const l = qaLabel(host, msg, r.left, r.top - 22, QA_COL.bad)
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches
  if (!reduce) [b, l].forEach(n => n.animate({ opacity: [0, 1, 1, 1, 0] }, { duration: 2400 }))
  // follow the element if the page scrolls while the flash is up
  const t0 = performance.now()
  const track = () => {
    if (!b.isConnected) return
    const q = el.getBoundingClientRect()
    Object.assign(b.style, { left: q.left - 3 + 'px', top: q.top - 3 + 'px', width: q.width + 6 + 'px', height: q.height + 6 + 'px' })
    Object.assign(l.style, { left: Math.max(2, Math.min(innerWidth - 120, q.left)) + 'px', top: Math.max(2, q.top - 22) + 'px' })
    if (performance.now() - t0 < 2400) requestAnimationFrame(track)
  }
  requestAnimationFrame(track)
  setTimeout(() => { b.remove(); l.remove() }, 2400)
}
/** Scroll an element into the middle of the screen, then flash it once the scroll has landed. */
function qaReveal(el: Element, msg: string) {
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches
  const r = el.getBoundingClientRect(), inView = r.top > 70 && r.bottom < innerHeight - 10
  if (!inView) el.scrollIntoView({ block: 'center', behavior: reduce ? 'auto' : 'smooth' })
  if (inView || reduce) { requestAnimationFrame(() => qaFlash(el, msg)); return }
  let done = false
  const go = () => { if (done) return; done = true; removeEventListener('scrollend', go); qaFlash(el, msg) }
  addEventListener('scrollend', go, { once: true })
  setTimeout(go, 'onscrollend' in window ? 3000 : 700)
}

/* Layout shift (CLS), measured live with the Core Web Vitals session-window rule ──────────── */

type QaShiftEntry = PerformanceEntry & { value: number; hadRecentInput: boolean; sources?: readonly { node: Node | null; previousRect: DOMRectReadOnly; currentRect: DOMRectReadOnly }[] }
/** One source of layout shift, aggregated: every shift whose largest moving element sits in the same card or landmark. */
type QaShiftSource = { name: string; total: number; count: number; node: Element | null; tags: Map<string, number> }
const qaCls = { score: 0, win: 0, winStart: 0, last: 0, sum: 0, count: 0, sources: new Map<string, QaShiftSource>(), unsupported: false, started: false, version: 0 }
const qaClsListeners = new Set<() => void>()
function qaStartCls() {
  if (qaCls.started) return
  qaCls.started = true
  if (typeof PerformanceObserver === 'undefined' || !PerformanceObserver.supportedEntryTypes?.includes('layout-shift')) { qaCls.unsupported = true; return }
  try {
    new PerformanceObserver(list => {
      for (const en of list.getEntries() as QaShiftEntry[]) {
        if (en.hadRecentInput) continue
        // the panel growing as results arrive is the tool's own doing, not the page's
        const els = (en.sources ?? []).map(x => x.node instanceof Element ? x.node : x.node?.parentElement ?? null)
        if (els.length && els.every(e => e?.closest('[data-qa-panel]'))) continue
        const t = en.startTime
        if (t - qaCls.last > 1000 || t - qaCls.winStart > 5000) { qaCls.win = 0; qaCls.winStart = t }
        qaCls.win += en.value; qaCls.last = t; qaCls.score = Math.max(qaCls.score, qaCls.win)
        const src = [...(en.sources ?? [])].sort((a, b) => b.currentRect.width * b.currentRect.height - a.currentRect.width * a.currentRect.height)[0]
        const node = src?.node instanceof Element ? src.node : src?.node?.parentElement ?? null
        const area = node && (qaCard(node)?.dataset.spec ?? node.closest('section')?.id ?? node.closest('nav,header,aside,[role=dialog]')?.getAttribute('aria-label') ?? node.closest('nav,header,aside')?.tagName.toLowerCase() ?? 'page')
        const name = area ?? 'unknown', tag = node?.tagName.toLowerCase() ?? '?'
        const agg = qaCls.sources.get(name) ?? { name, total: 0, count: 0, node: null, tags: new Map<string, number>() }
        agg.total += en.value; agg.count++; agg.node = node ?? agg.node; agg.tags.set(tag, (agg.tags.get(tag) ?? 0) + 1)
        qaCls.sources.set(name, agg); qaCls.sum += en.value; qaCls.count++
        if (qaState.m && qaFlashHost && src) [src.previousRect, src.currentRect].forEach((r, k) => {
          const b = qaBox(qaFlashHost!, r.x, r.y, r.width, r.height, k ? { outline: `2px solid ${QA_COL.bad}`, background: 'rgba(220,38,38,.1)' } : { outline: `1.5px solid ${QA_COL.content}` })
          setTimeout(() => b.remove(), 1200)
        })
      }
      qaCls.version++
      qaClsListeners.forEach(l => l())
    }).observe({ type: 'layout-shift', buffered: true })
  } catch { qaCls.unsupported = true }
}
const qaClsRating = (v: number) => v <= 0.1 ? ['Good', QA_TONE.ok] as const : v <= 0.25 ? ['Needs work', QA_TONE.warn] as const : ['Poor', QA_TONE.bad] as const

function QaClsMeter({ focusKey }: { focusKey: number }) {
  const [, setV] = useState(0)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => { const l = () => setV(qaCls.version); qaClsListeners.add(l); return () => { qaClsListeners.delete(l) } }, [])
  useEffect(() => { if (focusKey) ref.current?.focus() }, [focusKey])
  if (qaCls.unsupported) return <div className="border-b border-[var(--line)] px-3 py-2.5 text-xs text-[var(--fg3)]">Layout-shift measurement isn’t supported in this browser.</div>
  const [label, tone] = qaClsRating(qaCls.score)
  const top = [...qaCls.sources.values()].sort((a, b) => b.total - a.total).slice(0, 5)
  const fmt = (v: number) => v < 0.0005 ? '<0.001' : v.toFixed(3)
  return (
    <div ref={ref} tabIndex={-1} className="flex flex-col gap-1.5 border-b border-[var(--line)] px-3 py-2.5 outline-none">
      <div className="flex items-center gap-2 text-[13px]">
        <b className="font-semibold">Layout shift (CLS)</b>
        <span aria-live="polite" className="ml-auto"><Badge tone={tone} className="ui-num font-[family-name:var(--mono)] font-semibold">{qaCls.score.toFixed(3)} · {label}</Badge></span>
      </div>
      {top.length ? (
        <div className="flex flex-col">
          <span className="ui-num px-1.5 pb-0.5 text-[11px] text-[var(--fg3)]">Top sources · {fmt(qaCls.sum)} in {qaCls.count} shift{qaCls.count === 1 ? '' : 's'} so far</span>
          {top.map(s => {
            const tags = [...s.tags.entries()].sort((a, b) => b[1] - a[1]).slice(0, 2).map(([t]) => t).join(', ')
            return (
              <button key={s.name} type="button" onClick={() => s.node && qaReveal(s.node, `${fmt(s.total)} over ${s.count} shift${s.count === 1 ? '' : 's'}`)} disabled={!s.node?.isConnected}
                className="flex cursor-pointer items-baseline gap-2 rounded-[var(--r-md)] border-0 bg-transparent px-1.5 py-1 text-left text-xs text-[var(--fg2)] hover:bg-[var(--muted)] hover:text-[var(--fg)] disabled:cursor-default">
                <span className="ui-num min-w-11 font-[family-name:var(--mono)] text-[11px] text-[var(--fg)]">{fmt(s.total)}</span>
                <span className="min-w-0 flex-1 truncate">{s.name}</span>
                <span className="ui-num flex-none text-[11px] text-[var(--fg3)]">{s.count}× {tags}</span>
              </button>
            )
          })}
        </div>
      ) : <span className="text-xs text-[var(--fg3)]">No unexpected shifts yet. Shifts within 0.5 s of your own input don’t count.</span>}
    </div>
  )
}

/* Panel ─────────────────────────────────────────────────────────────────────── */

const qaTyping = (t: EventTarget | null) => t instanceof Element && !!t.closest('input,textarea,select,[contenteditable="true"],[contenteditable=""]')
const QA_CHIP = 'h-7 [@media(pointer:coarse)]:h-8 cursor-pointer rounded-full border border-[var(--line)] bg-[var(--card)] px-3 text-xs font-medium text-[var(--fg2)] hover:text-[var(--fg)] aria-pressed:border-[var(--accent)] aria-pressed:bg-[var(--accent-soft)] aria-pressed:text-[var(--accent)] focus-visible:outline-2 focus-visible:outline-[var(--accent)]'

/** The Design QA panel plus its overlays. Mount once; drive it with `designQA` or `DesignQAButton`. */
export function DesignQA() {
  const st = useDesignQA()
  const [result, setResult] = useState<QaResult | null>(null)
  const [scanning, setScanning] = useState(false)
  const [expanded, setExpanded] = useState<Set<QaKind>>(new Set())
  const ovRef = useRef<HTMLDivElement>(null)
  const flashRef = useRef<HTMLDivElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const runId = useRef(0)

  useEffect(() => { qaStartCls() }, [])
  useEffect(() => { qaFlashHost = flashRef.current; return () => { qaFlashHost = null } })

  // ⇧D toggles the panel; with it open, M / G / O toggle the tools and Esc leaves measure mode
  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      if (qaTyping(e.target) || e.metaKey || e.ctrlKey || e.altKey) return
      if (e.shiftKey && e.key.toLowerCase() === 'd') { e.preventDefault(); designQA.toggle(); return }
      if (!qaState.open) return
      const k = ({ m: 'm', g: 'g', o: 'o' } as Record<string, QaMode>)[e.key.toLowerCase()]
      if (k && !e.shiftKey) { e.preventDefault(); designQA.setMode(k) }
      else if (e.key === 'Escape') {
        if (qaState.m) { e.preventDefault(); designQA.setMode('m', false) }
        else if (panelRef.current?.contains(document.activeElement)) designQA.toggle()
      }
    }
    addEventListener('keydown', on); return () => removeEventListener('keydown', on)
  }, [])

  // Run audit: let the button paint "Scanning" first, then scan synchronously
  useEffect(() => {
    if (!st.runs) return
    const id = ++runId.current
    setScanning(true)
    const t = setTimeout(() => {
      const t0 = performance.now(), res = qaAudit(), ms = Math.round(performance.now() - t0)
      if (id !== runId.current) return
      const total = Object.values(res.issues).reduce((a, l) => a + l.length, 0)
      setResult({ ...res, ms, total, score: Math.max(0, 100 - Math.round(total / Math.max(1, res.checked) * 1000)) })
      setExpanded(new Set())
      setScanning(false)
    }, 40)
    return () => clearTimeout(t)
  }, [st.runs])

  // Measure mode: hover draws the box model and sibling gaps; click pins an element (clicks don't reach the page)
  useEffect(() => {
    const ov = ovRef.current
    if (!st.m || !ov) return
    let target: Element | null = null, pinned: Element | null = null, raf = 0, lx = -1, ly = -1
    const outside = (el: Element) => !!el.closest('[data-qa-panel],header')
    const redraw = () => {
      raf = 0; ov.replaceChildren()
      if (!target?.isConnected) return
      const r = qaDrawBoxModel(ov, target)
      qaDrawSiblingGaps(ov, target, r)
      if (pinned && pinned !== target && pinned.isConnected) qaDrawPinned(ov, pinned, r)
    }
    const schedule = () => { if (!raf) raf = requestAnimationFrame(redraw) }
    const move = (e: PointerEvent) => {
      if (e.pointerType === 'touch') return
      lx = e.clientX; ly = e.clientY
      const el = document.elementFromPoint(lx, ly)
      if (!el || outside(el)) { if (target) { target = null; schedule() } return }
      if (el !== target) { target = el; schedule() }
    }
    // touch has no hover: the first tap on an element measures it, a second tap on it pins it
    let touch = false
    const down = (e: PointerEvent) => { touch = e.pointerType === 'touch' }
    const click = (e: MouseEvent) => {
      if (!(e.target instanceof Element) || outside(e.target)) return
      e.preventDefault(); e.stopPropagation()
      if (touch) {
        lx = e.clientX; ly = e.clientY
        const el = document.elementFromPoint(lx, ly)
        if (el && !outside(el) && el !== target) { target = el; schedule(); return }
      }
      pinned = pinned === target ? null : target; schedule()
    }
    // content scrolls under a still pointer: hit-test again
    const scroll = () => { if (lx >= 0) { const el = document.elementFromPoint(lx, ly); target = el && !outside(el) ? el : null } schedule() }
    document.addEventListener('pointermove', move, { passive: true })
    document.addEventListener('pointerdown', down, { passive: true, capture: true })
    document.addEventListener('click', click, true)
    addEventListener('scroll', scroll, { passive: true, capture: true })
    return () => {
      document.removeEventListener('pointermove', move); document.removeEventListener('click', click, true); document.removeEventListener('pointerdown', down, { capture: true })
      removeEventListener('scroll', scroll, { capture: true }); cancelAnimationFrame(raf); ov.replaceChildren()
    }
  }, [st.m])

  const score = result?.score
  const scoreTone = score == null ? 'neutral' : score >= 90 ? QA_TONE.ok : score >= 75 ? QA_TONE.warn : QA_TONE.bad
  const toggleGroup = (k: QaKind) => setExpanded(s => { const n = new Set(s); if (n.has(k)) n.delete(k); else n.add(k); return n })

  return (
    <OverlayPortal>
      {st.g && <div aria-hidden className="pointer-events-none fixed inset-0 z-[74] [background-image:linear-gradient(rgba(219,39,119,.10)_1px,transparent_1px),linear-gradient(90deg,rgba(219,39,119,.10)_1px,transparent_1px),linear-gradient(rgba(219,39,119,.05)_1px,transparent_1px),linear-gradient(90deg,rgba(219,39,119,.05)_1px,transparent_1px)] [background-size:32px_32px,32px_32px,8px_8px,8px_8px]" />}
      {st.o && <style>{'main [data-spec] *{outline:1px solid rgba(219,39,119,.32)!important}'}</style>}
      {st.m && <style>{'main{cursor:crosshair}'}</style>}
      <div ref={ovRef} aria-hidden className="pointer-events-none fixed inset-0 z-[75]" />
      <div ref={flashRef} aria-hidden className="pointer-events-none fixed inset-0 z-[76]" />
      <AnimatePresence>
        {st.open && (
          <motion.div ref={panelRef} data-qa-panel role="dialog" aria-label="Design QA"
            initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 10, transition: { duration: 0.15 } }} transition={spring(0.25, 0.35)}
            className="fixed bottom-[calc(env(safe-area-inset-bottom,0px)+16px)] left-4 z-[77] flex max-h-[min(70vh,640px)] w-[min(340px,calc(100vw-32px))] flex-col rounded-[var(--r-lg)] border border-[var(--line)] bg-[var(--card)] text-[13px] text-[var(--fg)] shadow-[var(--shadow)] max-[640px]:inset-x-0 max-[640px]:bottom-0 max-[640px]:max-h-[55dvh] max-[640px]:w-auto max-[640px]:rounded-b-none max-[640px]:border-x-0 max-[640px]:border-b-0 max-[640px]:pb-[env(safe-area-inset-bottom,0px)] [@media(max-height:500px)]:max-h-[calc(100dvh-24px)]">
            <div className="flex flex-none items-center gap-2 border-b border-[var(--line)] py-2 pr-2 pl-3">
              <QaRulerIcon size={15} /><b className="text-sm font-semibold">Design QA</b>
              {score != null && <span className="ml-auto" aria-label={`Score ${score} out of 100`}><Badge tone={scoreTone} className="ui-num font-[family-name:var(--mono)] font-semibold">{score}/100</Badge></span>}
              <IconButton icon="x" label="Close Design QA" onClick={designQA.toggle} className={score == null ? 'ml-auto' : ''} />
            </div>
            <div className="flex flex-none flex-wrap items-center gap-1.5 border-b border-[var(--line)] px-3 py-2.5">
              <Button size="sm" variant="primary" onClick={designQA.run} disabled={scanning} aria-busy={scanning} className="min-w-[92px]">
                {scanning ? <><Spinner />Scanning</> : result ? 'Re-run' : 'Run audit'}
              </Button>
              {([['m', 'Measure'], ['g', 'Grid'], ['o', 'Outlines']] as const).map(([k, label]) => (
                <button key={k} type="button" aria-pressed={st[k]} title={`${label} (${k.toUpperCase()})`} onClick={() => designQA.setMode(k)} className={QA_CHIP}>{label}</button>
              ))}
            </div>
            <QaClsMeter focusKey={st.cls} />
            <div className="min-h-0 flex-1 overflow-auto p-1.5">
              {!result ? (
                <div className="p-4 text-center text-[var(--fg3)]">Run the audit to scan every component for spacing, size, alignment, clipping and contrast issues.</div>
              ) : QA_GROUPS.map(([k, label, dot, desc]) => {
                const list = result.issues[k], open = expanded.has(k)
                return (
                  <div key={k} className="mb-1">
                    <button type="button" aria-expanded={open} onClick={() => toggleGroup(k)}
                      className="flex w-full cursor-pointer items-center gap-2 rounded-[var(--r-md)] border-0 bg-transparent p-2 text-left text-[13px] font-medium text-[var(--fg)] hover:bg-[var(--muted)]">
                      <span className={cn('h-2 w-2 flex-none rounded-full', list.length ? dot : 'bg-[var(--ok)]')} />{label}
                      <Badge size="sm" className="ui-num ml-auto font-[family-name:var(--mono)] font-semibold">{list.length}</Badge>
                    </button>
                    {open && (
                      <div className="flex flex-col pr-1 pb-1.5 pl-6">
                        <span className="px-2 pt-0.5 pb-1.5 text-xs text-[var(--fg3)]">{desc}</span>
                        {list.slice(0, 40).map((i, j) => {
                          const [card, what] = qaName(i.el)
                          return (
                            <button key={j} type="button" onClick={() => qaReveal(i.el, i.msg)}
                              className="flex cursor-pointer gap-2 rounded-[var(--r-md)] border-0 bg-transparent px-2 py-1 text-left text-xs text-[var(--fg2)] hover:bg-[var(--muted)] hover:text-[var(--fg)]">
                              <span className="min-w-[58px] flex-none font-[family-name:var(--mono)] text-[11px] text-[var(--fg3)]">{i.msg.split(' ').slice(-2).join(' ')}</span>
                              <span className="min-w-0 break-words">{card} · {what}</span>
                            </button>
                          )
                        })}
                        {list.length > 40 && <span className="px-2 py-1 text-xs text-[var(--fg3)]">+{list.length - 40} more</span>}
                        {!list.length && <span className="px-2 py-1 text-xs text-[var(--fg3)]">Nothing found.</span>}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
            <div className="flex-none border-t border-[var(--line)] px-3 py-2 text-[11px] text-[var(--fg3)]" aria-live="polite">
              {result
                ? `Checked ${result.checked.toLocaleString('en-GB')} elements in ${result.ms} ms · ${result.total} findings`
                : <>
                  <span className="[@media(hover:none)]:hidden">Measure: hover to see the box model and the gaps on both sides (green = equal). Click to pin, then hover another element for the distance. <Kbd>M</Kbd> <Kbd>G</Kbd> <Kbd>O</Kbd></span>
                  <span className="hidden [@media(hover:none)]:inline">Measure: tap an element to see its box model and the gaps on both sides (green = equal). Tap it again to pin, then tap another for the distance.</span>
                </>}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </OverlayPortal>
  )
}
