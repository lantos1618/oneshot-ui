// Shared e2e helpers: instrumentation injected before the page loads, the section list, axe and overflow probes.
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { test as base, expect, type Page } from '@playwright/test'

/** Per-project options: the theme mode. */
export type ShowcaseOptions = { themeMode: 'light' | 'dark' }

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const AXE_PATH = createRequire(join(ROOT, 'package.json')).resolve('axe-core/axe.min.js')

/** Section ids in page order, read from SECTIONS in src/showcase/kit.tsx (a test checks they match the page). */
export const SECTION_IDS: string[] = (() => {
  const src = readFileSync(join(ROOT, 'src/showcase/kit.tsx'), 'utf8')
  const block = /export const SECTIONS\s*=\s*\[([\s\S]*?)\]\s*as const/.exec(src)?.[1] ?? ''
  const ids = [...block.matchAll(/\[\s*'([a-z0-9-]+)'\s*,/g)].map(m => m[1])
  if (!ids.length) throw new Error('Could not read SECTIONS from src/showcase/kit.tsx')
  return ids
})()

/** Runs in the page before any of its scripts: records layout shifts and errors with timestamps. */
const INSTRUMENT = () => {
  type Shift = { t: number; v: number; input: boolean; sources: string[] }
  const w = window as unknown as { __e2e: { shifts: Shift[]; errors: { t: number; text: string }[] } }
  w.__e2e = { shifts: [], errors: [] }
  const where = (n: Node | null | undefined) => {
    const el = n && (n.nodeType === 1 ? n as Element : n.parentElement)
    if (!el) return '?'
    const card = el.closest('[id^="c-"]'), sec = el.closest('section[id]')
    return card?.id ?? (sec ? `section:${sec.id}` : el.closest('header,aside,nav')?.tagName.toLowerCase() ?? el.tagName.toLowerCase())
  }
  try {
    new PerformanceObserver(list => {
      for (const e of list.getEntries() as (PerformanceEntry & { value: number; hadRecentInput: boolean; sources?: { node?: Node }[] })[])
        w.__e2e.shifts.push({ t: e.startTime, v: e.value, input: e.hadRecentInput, sources: (e.sources ?? []).map(s => where(s.node)) })
    }).observe({ type: 'layout-shift', buffered: true })
  } catch { /* not supported */ }
}

export const test = base.extend<ShowcaseOptions & { showcase: Showcase }>({
  themeMode: ['light', { option: true }],
  showcase: async ({ page, themeMode }, provide) => {
    await page.addInitScript(mode => { try { localStorage.setItem('ui-theme:v1', JSON.stringify({ mode })) } catch { /* ignore */ } }, themeMode)
    await page.addInitScript(INSTRUMENT)
    // Web fonts are not under test and would add network flake and font-swap shifts: serve them empty.
    await page.route(/^https:\/\/fonts\.(googleapis|gstatic)\.com\//, route => route.fulfill({ status: 200, contentType: route.request().url().includes('gstatic') ? 'font/woff2' : 'text/css', body: '' }))
    const sc = new Showcase(page)
    page.on('console', m => {
      if (m.type() === 'error') sc.errors.push({ at: Date.now(), text: m.text() })
      else if (/^\[vite\] (hot updated|page reload|server connection lost)/.test(m.text())) sc.hmr.push({ at: Date.now(), text: m.text() })
    })
    page.on('pageerror', e => sc.errors.push({ at: Date.now(), text: `Uncaught ${e.name}: ${e.message}` }))
    await provide(sc)
  },
})
export { expect }

export type AxeCounts = Record<string, number>
/** Where axe looks: a section or element id, the first element matching a selector, or (null) the page chrome. */
export type AxeScope = string | { selector: string } | null
export type AxeViolation = { id: string; impact: string | null; help: string; nodes: { target: string; html: string; summary: string }[] }

export class Showcase {
  errors: { at: number; text: string }[] = []
  readonly page: Page
  constructor(page: Page) { this.page = page }

  /** Vite dev-server reloads seen (only when testing against `pnpm dev`, where other edits can hot-reload the page). */
  hmr: { at: number; text: string }[] = []

  async open(section?: string) {
    await this.page.goto('/', { waitUntil: 'load' })
    await this.page.locator(section ? `section#${section}` : 'section[id]').first().waitFor({ state: 'attached', timeout: 30_000 })
    await this.settleAnimations()
  }

  /** True when the dev server hot-reloaded the page since `since`: measurements taken across it are meaningless. */
  reloadedSince(since: number) { return this.hmr.some(h => h.at >= since) }

  /** Errors logged since `since` (ms epoch). */
  errorsSince(since: number) { return this.errors.filter(e => e.at >= since).map(e => e.text) }

  now() { return this.page.evaluate(() => performance.now()) }

  /**
   * Scroll through a section one viewport step at a time, dwelling on each so whileInView content mounts and settles.
   * Returns the performance.now() at which scrolling started.
   */
  async scrollThrough(id: string, dwell: number, settle: number) {
    const page = this.page
    const { top, height, vh } = await page.evaluate(id => {
      const el = document.getElementById(id)!
      return { top: el.getBoundingClientRect().top + scrollY, height: el.getBoundingClientRect().height, vh: innerHeight }
    }, id)
    await page.evaluate(y => scrollTo({ top: y, behavior: 'instant' }), Math.max(0, top - 80))
    const start = await this.now()
    await page.waitForTimeout(dwell)
    const step = Math.max(200, vh - 140)
    for (let y = top - 80 + step; y < top + height - 120; y += step) {
      await page.evaluate(y => scrollTo({ top: y, behavior: 'instant' }), y)
      await page.waitForTimeout(dwell)
    }
    // the section may have grown while it mounted: make sure its end has been on screen too
    const end = await page.evaluate(id => { const r = document.getElementById(id)!.getBoundingClientRect(); return r.bottom + scrollY }, id)
    await page.evaluate(y => scrollTo({ top: y, behavior: 'instant' }), Math.max(0, end - vh))
    await page.waitForTimeout(settle)
    return start
  }

  /** Layout shifts without recent input since `since` (performance.now()), with their total. */
  async shiftsSince(since: number) {
    const shifts = await this.page.evaluate(since => (window as unknown as { __e2e: { shifts: { t: number; v: number; input: boolean; sources: string[] }[] } }).__e2e.shifts.filter(s => s.t >= since && !s.input), since)
    const total = shifts.reduce((a, s) => a + s.v, 0)
    const bySource = new Map<string, number>()
    for (const s of shifts) for (const src of new Set(s.sources)) bySource.set(src, (bySource.get(src) ?? 0) + s.v)
    return { total, count: shifts.length, top: [...bySource.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([k, v]) => `${k} ${v.toFixed(4)}`) }
  }

  /** Wait (up to `max` ms) until no finite CSS/WAAPI animation is running, so axe doesn't see half-faded text. */
  async settleAnimations(max = 2500) {
    await this.page.waitForFunction(() => document.getAnimations().filter(a => a.playState === 'running' && Number.isFinite(a.effect?.getComputedTiming().endTime ?? Infinity)).length === 0, null, { timeout: max, polling: 100 }).catch(() => {})
  }

  /**
   * axe twice, a moment apart, keeping per rule the run with fewer nodes: entry animations and scripted demos make
   * colour-contrast flicker, and a real violation shows up in both runs.
   */
  async axeStable(id: AxeScope, gap = 1500): Promise<AxeViolation[]> {
    await this.settleAnimations()
    const a = await this.axe(id)
    await this.page.waitForTimeout(gap)
    await this.settleAnimations()
    const b = await this.axe(id)
    const byId = new Map(b.map(v => [v.id, v]))
    return a.flatMap(v => { const w = byId.get(v.id); return w ? [w.nodes.length <= v.nodes.length ? w : v] : [] })
  }

  /** axe-core violations inside one element (by id or `{ selector }`), or the page chrome outside the sections when null. */
  async axe(id: AxeScope): Promise<AxeViolation[]> {
    const page = this.page
    if (!(await page.evaluate(() => 'axe' in window))) await page.addScriptTag({ path: AXE_PATH })
    return page.evaluate(async id => {
      const axe = (window as unknown as { axe: { run: (ctx: unknown, opts: unknown) => Promise<{ violations: { id: string; impact: string | null; help: string; nodes: { target: unknown[]; html: string; failureSummary?: string }[] }[] }> } }).axe
      const chrome = ['header', 'aside', 'nav'].filter(sel => document.querySelector(sel)).map(sel => [sel])
      const ctx = typeof id === 'string' ? document.getElementById(id) : id ? document.querySelector(id.selector) : { include: chrome.length ? chrome : [['body']], exclude: [['section[id]']] }
      const res = await axe.run(ctx, { resultTypes: ['violations'], rules: { region: { enabled: false } } })
      return res.violations.map(v => ({
        id: v.id, impact: v.impact, help: v.help,
        nodes: v.nodes.map(n => ({ target: n.target.map(String).join(' ').slice(0, 200), html: n.html.slice(0, 200), summary: (n.failureSummary ?? '').replace(/\s+/g, ' ').slice(0, 240) })),
      }))
    }, id)
  }

  /** Whether the page itself scrolls sideways, and the elements in `scope` that stick out past the viewport. */
  async horizontalOverflow(scope: string | null) {
    return this.page.evaluate(scope => {
      const se = document.scrollingElement as HTMLElement
      const vw = document.documentElement.clientWidth
      const wide = se.scrollWidth > vw + 1
      const x0 = scrollX
      scrollBy({ left: 200, behavior: 'instant' }); const moved = scrollX !== x0; scrollTo({ left: x0, behavior: 'instant' })
      const clipped = (el: Element) => {
        for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
          const o = getComputedStyle(p).overflowX
          if (o !== 'visible') return true
        }
        return false
      }
      const root = scope ? document.getElementById(scope) : document.body
      const out: string[] = []
      if (wide || moved) for (const el of root?.querySelectorAll('*') ?? []) {
        const r = el.getBoundingClientRect()
        if (r.width && (r.right > vw + 1 || r.left < -1) && !clipped(el)) {
          const card = el.closest('[id^="c-"]')?.id
          out.push(`${card ?? ''} <${el.tagName.toLowerCase()} class="${String(el.getAttribute('class') ?? '').slice(0, 60)}"> ${r.left < -1 ? `left=${Math.round(r.left)}` : `right=${Math.round(r.right)}`}`)
          if (out.length >= 8) break
        }
      }
      return { scrollWidth: se.scrollWidth, viewport: vw, scrolls: wide || moved, offenders: out }
    }, scope)
  }
}

/** Rule id → number of failing nodes. */
export const axeCounts = (v: AxeViolation[]): AxeCounts => Object.fromEntries(v.map(x => [x.id, x.nodes.length]).sort((a, b) => String(a[0]).localeCompare(String(b[0]))))
