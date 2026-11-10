import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { Badge, Button, Chip, FONT_CSS, Icon, IconButton, RUN_STATUS, Spinner, TOUCH, cn, ScrollEdges, onColorLabel, spring, surface, themeCSS, uid, useLatest, useMediaQuery, useRoving, useScrollEdges, useTheme, plural, fmt, svgN, svgTranslate } from './core'
import { CopyButton, TypingDots, EmptyState } from './feedback'
import { SegmentedControl } from './fields'
import { SendButton, StreamingText } from './ai'
import { lcsDiff } from './code'
import type { WorkflowMachine } from './statechart'
import { useFrameLoop, useViewport } from './motion'
import { nearestAgent, runLatestMs, runTotals, type AgentRun, type AgentSpan } from './agentrun'

/* Tiny HTML/CSS highlighter for the canvas (code's highlightCode has no HTML/CSS mode yet) ─ */

/**
 * One pass, linear time: an unterminated comment runs to the end of the line, `var(` stops at the next paren, and
 * every word is consumed whole (group 5) with an optional `: ` after it (group 6), so a failed property match can't
 * be retried from each letter. Lines over AI_HL_MAX render plain.
 */
const AI_HL_RE = /(\/\*.*?(?:\*\/|$))|(<\/?[a-zA-Z][\w-]*|\/?>)|("[^"]*")|(var\(--[\w-]+(?:,[^()]*)?\))|([a-z-]+)(\s*:\s)?|(\b\d+(?:\.\d+)?(?:px|%|em|s)?\b|\$\d+)/g
const AI_HL_MAX = 2000
const AI_HL_CLS = ['text-[var(--fg3)] italic', 'text-[var(--accent)]', 'text-[var(--ok)]', 'text-[color-mix(in_srgb,var(--c3)_70%,var(--fg))]', 'text-[var(--bad)]', 'text-[color-mix(in_srgb,var(--c3)_70%,var(--fg))]']
function aiHighlight(line: string): ReactNode[] {
  if (line.length > AI_HL_MAX) return [line]
  const out: ReactNode[] = []; let last = 0, k = 0
  for (const m of line.matchAll(AI_HL_RE)) {
    if (m.index! > last) out.push(line.slice(last, m.index))
    last = m.index! + m[0].length
    if (m[5] !== undefined) { // a word: a property only when ": " follows
      if (m[6] === undefined) out.push(m[5]); else out.push(<span key={k++} className={AI_HL_CLS[4]}>{m[5]}</span>, m[6])
      continue
    }
    const g = [1, 2, 3, 4, 5, 7].findIndex(i => m[i] !== undefined)
    out.push(<span key={k++} className={AI_HL_CLS[g]}>{m[0]}</span>)
  }
  out.push(line.slice(last))
  return out
}
/** Line diff for the streaming edit (code's lcsDiff): '=' kept, '+' added, '-' removed, in display order. */
const aiLineDiff = (a: string[], b: string[]): ['=' | '+' | '-', string][] => lcsDiff(a, b).map(s => [s.type, s.type === '+' ? b[s.b!] : a[s.a!]])


/** The page's Google Fonts stylesheets, matched by exact host (https://fonts.googleapis.com only). */
const aiFontLink = (href: string) => { try { const u = new URL(href); return u.protocol === 'https:' && u.hostname === 'fonts.googleapis.com' } catch { return false } }
const aiAttr = (s: string) => s.replace(/[&"<>]/g, c => ({ '&': '&amp;', '"': '&quot;', '<': '&lt;', '>': '&gt;' })[c]!)
const AI_STRIP_TAGS = 'script,noscript,iframe,frame,object,embed,base,meta,link'
/**
 * Removes what could only ever be blocked in the sandbox anyway (so the console stays quiet): <script> and other active
 * elements, on* handler attributes, and javascript: URLs. Uses an inert <template> in the browser; a regex pass on the
 * server (the frame only renders in the browser). The sandbox and CSP stay the real defence.
 */
function aiStripActive(html: string): string {
  if (typeof document === 'undefined') return html.replace(/<(script|noscript)\b[\s\S]*?(<\/\1\s*>|$)/gi, '').replace(/\son[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '')
  const t = document.createElement('template'); t.innerHTML = html
  t.content.querySelectorAll(AI_STRIP_TAGS).forEach(n => n.remove())
  t.content.querySelectorAll('*').forEach(el => {
    for (const a of [...el.attributes]) if (/^on/i.test(a.name) || (/^(href|src|action|formaction|xlink:href)$/i.test(a.name) && /^\s*javascript:/i.test(a.value))) el.removeAttribute(a.name)
  })
  return t.innerHTML
}

/**
 * Renders the document in a sandboxed iframe (srcdoc, scripts off), so markup from a model can't run handlers in the page.
 * A Content-Security-Policy meta comes first in the frame's head: nothing remote loads (no images, CSS imports,
 * url() backgrounds; Google Fonts only when the provider's `fonts` is on), so model HTML can't call home.
 * `allowRemote` lets https images in. `<base target="_blank">` without allow-popups makes links inert.
 * The theme tokens and the page's web fonts are copied in, so the preview follows the theme. Scripts and on* handlers are
 * stripped first (they could never run). The frame fills its pane at a fixed size and scrolls inside, so it never shifts.
 */
function AiPreview({ html, title, allowRemote = false }: { html: string; title: string; allowRemote?: boolean }) {
  const { tokens, dark, fonts: fontsOn } = useTheme()
  const [fonts, setFonts] = useState('')
  useEffect(() => { // only when the provider allows Google Fonts: the Geist import plus the page's font links (exact host)
    if (!fontsOn) { setFonts(''); return }
    const links = [...document.querySelectorAll<HTMLLinkElement>('link[rel="stylesheet"]')].filter(l => aiFontLink(l.href)).map(l => `<link rel="stylesheet" href="${aiAttr(l.href)}">`)
    setFonts(`<style>${FONT_CSS}</style>` + links.join(''))
  }, [tokens.font, fontsOn])
  const doc = useMemo(() => {
    const csp = ["default-src 'none'", `style-src 'unsafe-inline'${fonts ? ' https://fonts.googleapis.com' : ''}`, ...(fonts ? ['font-src https://fonts.gstatic.com'] : []),
      `img-src data: blob:${allowRemote ? ' https:' : ''}`, "form-action 'none'", "base-uri 'none'"].join('; ')
    return `<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="${csp}"><meta charset="utf-8"><base target="_blank">${fonts}<style>${themeCSS(tokens)}
:root{color-scheme:${dark ? 'dark' : 'light'}}html,body{margin:0;background:transparent}
body{box-sizing:border-box;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:24px 12px;font:14px/1.5 var(--font);color:var(--fg)}
@media (max-width:420px){body{padding:12px 8px}}</style></head><body>${aiStripActive(html)}</body></html>`
  }, [html, tokens, dark, fonts, allowRemote])
  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.2 }} className="absolute inset-0">
      {/* allow-same-origin without allow-scripts: nothing in the document can run.
          Never add allow-scripts alongside allow-same-origin: together they let the document remove its own sandbox
          and script the host page. No allow-popups either, so <base target="_blank"> leaves links doing nothing. */}
      <iframe title={title} srcDoc={doc} sandbox="allow-same-origin" className="block h-full w-full border-0" style={{ colorScheme: dark ? 'dark' : 'light' }} />
    </motion.div>
  )
}

/** What AICanvas's `respond` may return: an edit to stream in (`code` is the whole new document), a plain reply, or nothing. */
export type CanvasReply = { reply: string; code?: string } | string | null | undefined
/** What AICanvas passes `respond` with a prompt: for a question about a line, its number (1-based) and text. */
export type CanvasContext = { line?: number; lineText?: string }

type CvMsg = {
  id: string; role: 'u' | 'a'; text: string; tool?: { state: 'run' | 'done'; add: number; del: number; ver: number }; dots?: boolean; stream?: boolean
  /** the reply failed: what to ask again on Retry */ failed?: { prompt: string; ctx: CanvasContext }
}
type CvDiff = { lines: ['=' | '+' | '-', string][]; typing: number; chars: number; phase: 'type' | 'hold' | 'collapse'; t: number }
type CvStats = { add: number; del: number; ver: number }
/** The edit animation: characters typed per second, then a pause and the removed lines' collapse (seconds). */
const CV_TYPE_CPS = 900, CV_HOLD = 0.35, CV_COLLAPSE = 0.3
/** The next added line at or after `i` (lines.length when there is none). */
const cvNextAdd = (lines: CvDiff['lines'], i: number) => { while (i < lines.length && lines[i][0] !== '+') i++; return i }
const CV_LINE_Q = /^explain line (\d+)/i

/**
 * Chat on the left, a living document on the right. Asking for a change streams the edit into the file: added lines
 * type in highlighted, removed lines strike through and collapse. Toggle Code/Preview (the preview is a sandboxed
 * iframe), step through versions, copy, click or tap a line (or arrow to it and press Enter) to "Ask about line N",
 * or use a suggestion chip. Below 768px chat and document stack, rows grow to finger height on touch, and the
 * document scrolls into view while an edit streams in. A pill shows line count and version. The preview loads nothing
 * remote (CSP in the frame); `allowRemote` lets https images in.
 * Starts empty: pass `initial` and `respond(prompt, code, context)`, your model: return the new document and a reply.
 * A question about a line ("Ask about line N", or a prompt starting "Explain line N") reaches `respond` with
 * `{ line, lineText }`, or `explain(line, text)` when you pass one. Without either, nothing can be asked. When
 * `respond` throws, the reply shows the failure with Retry and `onError` gets the error. `suggestions` offers the next
 * prompt not yet sent as a chip. The showcase's scripted demo is `canvasDemoProps()` in the examples.
 */
export function AICanvas({ file = 'untitled.html', initial = '', respond, explain, suggestions, intro, allowRemote = false, onError, className }: {
  file?: string; initial?: string
  respond?: (prompt: string, code: string, context: CanvasContext) => CanvasReply | Promise<CanvasReply>
  explain?: (line: number, text: string) => string | Promise<string>
  suggestions?: readonly string[]; intro?: string; allowRemote?: boolean; onError?: (error: unknown) => void; className?: string }) {
  const reduce = !!useReducedMotion()
  const asked = useRef<{ text: string; n: number } | null>(null) // the "Ask about line N" prompt
  const [V, setV] = useState([initial])
  const [cur, setCur] = useState(0)
  const [view, setView] = useState<'code' | 'prev'>('code')
  const [msgs, setMsgs] = useState<CvMsg[]>(intro ? [{ id: 'intro', role: 'a', text: intro }] : [])
  const [sent, setSent] = useState<ReadonlySet<string>>(() => new Set())
  const [busy, setBusy] = useState(false)
  const [text, setText] = useState('')
  const [selLine, setSelLine] = useState<{ n: number; top: number } | null>(null)
  const [diff, setDiffState] = useState<CvDiff | null>(null)
  const dref = useRef<CvDiff | null>(null) // the frame loop reads and advances this, so a frame never works from a stale render
  const setDiff = (d: CvDiff | null) => { dref.current = d; setDiffState(d) }
  const [flash, setFlash] = useState(0)
  const narrow = useMediaQuery('(max-width: 767px)'), docPane = useRef<HTMLDivElement>(null)
  const codeRef = useRef<HTMLDivElement>(null), logRef = useRef<HTMLDivElement>(null), inRef = useRef<HTMLInputElement>(null), alive = useRef(true)
  const Vref = useLatest(V), applied = useRef<((s: CvStats) => void) | null>(null)
  const canAsk = !!respond, canAskLine = !!(respond || explain)
  useEffect(() => { alive.current = true; return () => { alive.current = false } }, [])
  useEffect(() => { const el = logRef.current; if (el) el.scrollTop = el.scrollHeight }, [msgs])
  const push = (m: Omit<CvMsg, 'id'>) => { const id = uid('cv'); setMsgs(ms => [...ms, { ...m, id }]); return id }
  const patch = (id: string, p: Partial<CvMsg>) => setMsgs(ms => ms.map(m => m.id === id ? { ...m, ...p } : m))

  /** Commits the new version the diff was building and settles the edit's promise. */
  const commit = (d: CvDiff, code: string) => {
    dref.current = null
    const nv = [...Vref.current, code]; setV(nv); setCur(nv.length - 1); setDiff(null); setFlash(f => f + 1)
    applied.current?.({ add: d.lines.filter(x => x[0] === '+').length, del: d.lines.filter(x => x[0] === '-').length, ver: nv.length }); applied.current = null
  }
  const target = useRef('')
  /** Streams `newCode` into the document (typed in on the frame loop) and resolves with the edit's size once it lands. */
  const apply = (newCode: string) => new Promise<CvStats>(res => {
    setView('code'); setSelLine(null)
    // stacked on phones: bring the document into view so the edit can be watched as it streams in
    if (narrow && docPane.current) { const r = docPane.current.getBoundingClientRect(); if (r.top > innerHeight - 160 || r.bottom < 80) docPane.current.scrollIntoView({ block: 'nearest', behavior: reduce ? 'auto' : 'smooth' }) }
    const base = Vref.current[Vref.current.length - 1]
    const lines = aiLineDiff(base.split('\n'), newCode.split('\n'))
    const d: CvDiff = { lines, typing: cvNextAdd(lines, 0), chars: 0, phase: 'type', t: 0 }
    applied.current = res; target.current = newCode
    if (reduce) commit(d, newCode); else setDiff(d)
  })
  useFrameLoop(!!diff && !reduce, dt => {
    const d = dref.current; if (!d) return
    if (d.phase === 'type') {
      const len = d.lines[d.typing]?.[1].length ?? 0, chars = d.chars + dt * CV_TYPE_CPS
      if (chars < len) { setDiff({ ...d, chars }); return }
      const next = cvNextAdd(d.lines, d.typing + 1)
      setDiff(next < d.lines.length ? { ...d, typing: next, chars: 0 } : { ...d, typing: d.lines.length, chars: 0, phase: 'hold', t: 0 })
    } else if (d.phase === 'hold') setDiff(d.t + dt >= CV_HOLD ? { ...d, phase: 'collapse', t: 0 } : { ...d, t: d.t + dt })
    else if (d.t + dt >= CV_COLLAPSE) commit(d, target.current)
    else setDiff({ ...d, t: d.t + dt })
  })
  // once the diff renders, scroll to its first change; then keep the line being typed in view
  const diffLines = diff?.lines, typing = diff?.typing
  useLayoutEffect(() => {
    const box = codeRef.current, first = box?.querySelector<HTMLElement>('[data-changed]')
    if (box && first) box.scrollTo({ top: Math.max(0, first.offsetTop - 80), behavior: reduce ? 'auto' : 'smooth' })
  }, [diffLines]) // eslint-disable-line react-hooks/exhaustive-deps
  useLayoutEffect(() => {
    const box = codeRef.current, el = box?.querySelector<HTMLElement>(`[data-i="${typing}"]`)
    if (box && el && el.offsetTop > box.scrollTop + box.clientHeight - 40) box.scrollTop = el.offsetTop - box.clientHeight / 2
  }, [typing])

  /** Gets the reply for message `id`: `explain` for a line when given, else `respond`; an edit streams in first. */
  const answer = async (id: string, q: string, ctx: CanvasContext) => {
    let r: CanvasReply
    try {
      r = ctx.line != null && explain ? await explain(ctx.line, ctx.lineText ?? '') : await respond!(q, Vref.current[Vref.current.length - 1], ctx)
    } catch (err) {
      if (!alive.current) return
      patch(id, { dots: false, text: 'Couldn’t get a reply.', failed: { prompt: q, ctx } }); setBusy(false); onError?.(err); return
    }
    if (!alive.current) return
    const reply = typeof r === 'string' ? r : r?.reply ?? ''
    if (r && typeof r === 'object' && typeof r.code === 'string') {
      patch(id, { dots: false, tool: { state: 'run', add: 0, del: 0, ver: 0 } })
      const done = await apply(r.code); if (!alive.current) return
      patch(id, { tool: { state: 'done', ...done } })
    }
    patch(id, { dots: false, text: reply || 'No change.', stream: true })
  }
  const send = (raw: string, lineAsked?: number) => {
    const q = raw.trim(); if (!q || busy) return
    const m = CV_LINE_Q.exec(q), n = lineAsked ?? (asked.current?.text === q ? asked.current.n : m ? Number(m[1]) : undefined)
    asked.current = null
    if (n == null && !canAsk) return
    setBusy(true); setText(''); setSent(s => new Set(s).add(q)); push({ role: 'u', text: q })
    const ctx: CanvasContext = n == null ? {} : { line: n, lineText: V[cur].split('\n')[n - 1] ?? '' }
    void answer(push({ role: 'a', text: '', dots: true }), q, ctx)
  }
  const retry = (m: CvMsg) => { if (!m.failed || busy) return; setBusy(true); patch(m.id, { failed: undefined, text: '', dots: true }); void answer(m.id, m.failed.prompt, m.failed.ctx) }
  const askLine = (n: number) => {
    const ln = shownLines[n - 1].trim(), q = `Explain line ${n}: ${ln.slice(0, 40) + (ln.length > 40 ? '…' : '')}`
    setSelLine(null)
    if (!canAsk) { send(q, n); return } // only an explainer: nothing to add to the question
    asked.current = { text: q, n }; setText(q); inRef.current?.focus()
  }

  const shown = V[cur]
  const shownLines = shown.split('\n'), lineCount = shownLines.length
  const suggestion = canAsk ? suggestions?.find(s => !sent.has(s)) : undefined
  // code lines are real buttons with one Tab stop: arrows move between lines, Enter or a click opens "Ask about line N"
  const pickLine = (i: number, el?: HTMLElement | null) => {
    if (!el || !canAskLine) return
    const top = el.offsetTop - (codeRef.current?.scrollTop ?? 0) + (el.offsetHeight - 20) / 2
    setSelLine(s => s?.n === i + 1 ? null : { n: i + 1, top })
  }
  const lineAt = (i: number) => codeRef.current?.querySelector<HTMLElement>(`[data-line="${i}"]`)
  const roving = useRoving(lineCount, i => pickLine(i, lineAt(i)), { loop: false, onMove: i => lineAt(i)?.focus() })
  const [edgeRef, edges] = useScrollEdges<HTMLDivElement>()
  const empty = !shown && !diff
  let num = 0
  return (
    <div className={cn('grid overflow-hidden md:h-[480px] md:grid-cols-[minmax(260px,340px)_minmax(0,1fr)]', surface.card, className)}>
      <div className="flex min-h-0 min-w-0 flex-col gap-2.5 border-[var(--line)] bg-[color-mix(in_srgb,var(--muted)_35%,var(--card))] p-3 max-md:h-[340px] max-md:border-b md:border-e">
        <div ref={logRef} aria-live="polite" aria-busy={busy} className="flex min-h-0 flex-1 flex-col gap-2.5 overflow-auto p-0.5">
          {msgs.map(m => m.role === 'u'
            ? <motion.div key={m.id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={spring(0.25, 0.35)} className="max-w-[85%] self-end rounded-[14px] rounded-ee-[4px] bg-[var(--primary)] px-3 py-2 text-[13px] text-[var(--on-primary)]">{m.text}</motion.div>
            : <motion.div key={m.id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={spring(0.25, 0.35)} className="max-w-[95%] text-[13px] leading-normal">
              <div className="mb-1 flex items-center gap-1.5 text-xs font-medium text-[var(--fg3)]"><i className="h-2 w-2 rounded-full bg-[var(--accent)]" />Assistant</div>
              {m.dots && <TypingDots />}
              {m.tool && <div className={cn('mt-1.5 flex flex-wrap items-center gap-2 px-2.5 py-2 text-xs text-[var(--fg2)]', surface.md)}>
                {m.tool.state === 'run' ? <><Spinner size={12} tone="accent" label={`Editing ${file}`} /><span>Editing <b className="font-medium text-[var(--fg)]">{file}</b></span></>
                  : <><Icon name="check" size={12} strokeWidth={3} className="text-[var(--ok)]" /><span>Edited <b className="font-medium text-[var(--fg)]">{file}</b></span>
                    <span className="font-[family-name:var(--mono)] text-[var(--ok)]">+{m.tool.add}</span><span className="font-[family-name:var(--mono)] text-[var(--bad)]">−{m.tool.del}</span><span className="flex-1" />
                    <Button size="sm" variant="ghost" className={cn('!h-6', TOUCH.tap)} onClick={() => { setCur(m.tool!.ver - 1); setView('prev'); if (narrow) docPane.current?.scrollIntoView({ block: 'nearest', behavior: reduce ? 'auto' : 'smooth' }) }}>{`View v${m.tool.ver}`}</Button></>}
              </div>}
              {m.failed ? <div role="alert" className="flex flex-wrap items-center gap-2 text-[var(--bad)]">{m.text}<Button size="sm" variant="ghost" className={cn('!h-6', TOUCH.tap)} onClick={() => retry(m)} disabled={busy}>Retry</Button></div>
                : m.text && <div className={cn(m.tool && 'mt-2')}>{m.stream ? <StreamingText text={m.text} wordDelay={20} onDone={() => { patch(m.id, { stream: false }); setBusy(false) }} /> : m.text}</div>}
            </motion.div>)}
        </div>
        <div className="flex flex-wrap gap-1.5">
          {!busy && suggestion && (
            <motion.span key={suggestion} initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} className="inline-flex">
              <Chip icon="sparkles" onClick={() => send(suggestion)}><span>{suggestion}</span></Chip>
            </motion.span>
          )}
        </div>
        <div className={cn('flex items-center gap-2 rounded-full border border-[var(--line)] bg-[var(--card)] py-1 pe-1 ps-4 focus-within:border-[var(--fg3)]', !canAsk && 'opacity-60')}>
          <input ref={inRef} value={text} disabled={!canAsk} onChange={e => setText(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) send(text) }}
            placeholder={canAsk ? 'Ask for a change' : 'No assistant connected'} aria-label={'Ask for a change'}
            className={cn('h-8 min-w-0 flex-1 border-0 bg-transparent text-[13px] outline-none placeholder:text-[var(--fg3)]', TOUCH.input)} />
          <SendButton onClick={() => send(text)} disabled={busy || !canAsk || !text.trim()} />
        </div>
      </div>

      <div ref={docPane} className="flex min-h-0 min-w-0 flex-col max-md:h-[440px] max-md:scroll-mt-24">
        <div className="flex h-12 flex-none items-center gap-2.5 border-b border-[var(--line)] pe-2.5 ps-3 max-sm:gap-1.5 max-sm:pe-1.5 max-sm:ps-2">
          <span className="flex min-w-0 items-center gap-1.5 text-[13px] font-medium whitespace-nowrap max-sm:hidden"><Icon name="file" size={13} />{file}</span>
          <SegmentedControl size="sm" className="[@media(pointer:coarse)]:[&>button]:min-h-8" options={[{ value: 'code', label: 'Code' }, { value: 'prev', label: 'Preview' }]} value={view} onChange={v => { setView(v as 'code' | 'prev'); setSelLine(null) }} />
          <span className="flex-1" />
          <span className="flex items-center gap-0.5 text-xs text-[var(--fg2)]">
            <IconButton icon={<Icon name="chevronLeft" size={14} />} label={'Previous version'} className={TOUCH.tap} disabled={cur === 0 || !!diff} onClick={() => { setCur(c => c - 1); setFlash(f => f + 1); setSelLine(null) }} />
            <span className="ui-num w-6 text-center">{`v${cur + 1}`}</span>
            <IconButton icon={<Icon name="chevronRight" size={14} />} label={'Next version'} className={TOUCH.tap} disabled={cur === V.length - 1 || !!diff} onClick={() => { setCur(c => c + 1); setFlash(f => f + 1); setSelLine(null) }} />
          </span>
          <CopyButton text={shown} size="icon-sm" label={'Copy code'} className={TOUCH.tap} />
        </div>
        <div className="relative min-h-0 flex-1">
          {empty ? (
            <EmptyState size="sm" icon="file" className="absolute inset-0 grid place-content-center bg-[var(--card)] p-6" title={canAsk ? 'Nothing here yet. Ask for something and it will appear here.' : 'Nothing here yet.'} />
          ) : view === 'code' ? (
            <div ref={el => { codeRef.current = el; edgeRef(el) }} onScroll={() => setSelLine(null)} className="absolute inset-0 overflow-auto overscroll-x-contain bg-[var(--card)] [contain:inline-size]">
              <motion.pre key={diff ? 'diff' : `v${cur}-${flash}`} initial={diff ? false : { opacity: 0.3 }} animate={{ opacity: 1 }} transition={{ duration: 0.2 }}
                className="m-0 min-w-max pt-3 pb-12 font-[family-name:var(--mono)] text-xs leading-[1.65]" onKeyDown={diff ? undefined : roving.onKeyDown}>
                {diff ? diff.lines.map(([t, l], i) => {
                  const n = t === '-' ? '' : ++num, typed = t === '+' && i === diff.typing
                  const txt = t === '+' ? (i < diff.typing ? l : typed ? l.slice(0, Math.floor(diff.chars)) : '') : l
                  return (
                    <AnimatePresence key={i} initial={false}>
                      {!(t === '-' && diff.phase === 'collapse') && (
                        <motion.div data-i={i} data-changed={t !== '=' ? '' : undefined} exit={{ opacity: 0, height: 0 }} transition={{ duration: 0.18 }}
                          className={cn('flex px-3', t === '-' && 'bg-[color-mix(in_srgb,var(--bad)_14%,transparent)] line-through opacity-70', t === '+' && i <= diff.typing && 'bg-[color-mix(in_srgb,var(--ok)_16%,transparent)]')}>
                          <span className="me-4 w-6 flex-none text-end text-[var(--fg3)] select-none">{n}</span><span className="whitespace-pre">{typed ? txt : aiHighlight(txt)}{txt ? '' : ' '}</span>
                        </motion.div>)}
                    </AnimatePresence>
                  )
                }) : shownLines.map((l, i) => (
                  <button key={i} type="button" data-line={i} tabIndex={i === Math.min(roving.active, lineCount - 1) ? 0 : -1} aria-pressed={canAskLine ? selLine?.n === i + 1 : undefined}
                    onFocus={() => roving.setActive(i)} onClick={e => { roving.setActive(i); pickLine(i, e.currentTarget) }}
                    className={cn('flex w-full border-0 bg-transparent px-3 text-start [font:inherit] text-inherit outline-none [@media(pointer:coarse)]:min-h-8 [@media(pointer:coarse)]:items-center', canAskLine && 'cursor-pointer',
                      selLine?.n === i + 1 ? 'bg-[color-mix(in_srgb,var(--accent)_14%,transparent)]' : 'hover:bg-[color-mix(in_srgb,var(--muted)_70%,transparent)] focus-visible:bg-[color-mix(in_srgb,var(--muted)_70%,transparent)] focus-visible:shadow-[inset_2px_0_0_var(--accent)]')}>
                    <span className="me-4 w-6 flex-none text-end text-[var(--fg3)] select-none">{i + 1}</span><span className="whitespace-pre">{aiHighlight(l)}{l ? '' : ' '}</span>
                  </button>
                ))}
              </motion.pre>
            </div>
          ) : (
            <div className="absolute inset-0 bg-[var(--bg)] bg-[radial-gradient(circle,var(--line2)_1px,transparent_1.2px)] bg-[length:16px_16px]">
              <AiPreview key={`${cur}-${flash}`} html={shown} allowRemote={allowRemote} title={`Preview of ${file}, version ${cur + 1}`} />
            </div>
          )}
          {view === 'code' && !empty && <ScrollEdges {...edges} at="top" hint={'Scroll for more'} />}
          <AnimatePresence>
            {selLine && view === 'code' && (
              <motion.button key={selLine.n} initial={{ opacity: 0, x: 6 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.18 }}
                style={{ top: selLine.top - 4 }} onClick={() => askLine(selLine.n)} disabled={busy && !canAsk}
                className="absolute end-4 z-[3] h-7 cursor-pointer rounded-full border border-[var(--line)] bg-[var(--card)] px-2.5 text-xs font-medium shadow-[var(--shadow)] [@media(pointer:coarse)]:-mt-1.5 [@media(pointer:coarse)]:h-10 [@media(pointer:coarse)]:px-3.5 [@media(pointer:coarse)]:text-[13px]"><span>{`Ask about line ${selLine.n}`}</span></motion.button>
            )}
          </AnimatePresence>
          <Badge size="sm" className="absolute bottom-3 start-3 border border-[var(--line)] !bg-[var(--card)] font-normal tabular-nums !text-[var(--fg3)]">{`${plural(lineCount, 'line')} · v${cur + 1} of ${V.length}`}</Badge>
        </div>
      </div>
    </div>
  )
}

/* The transit map: geometry and drawing shared by the run view here and the showcase's simulation ─────────────── */

type Pt = [number, number]
/** The map's lines: fixed hues like a transit map's, the same in light and dark. */
const AT_LINES: Record<string, { label: string; color: string }> = {
  research: { label: 'Research', color: '#7B78D8' }, payments: { label: 'Payments', color: '#C8603F' }, approvals: { label: 'Approvals', color: '#4A9C78' },
  evals: { label: 'Evals', color: '#B07A2E' }, memory: { label: 'Memory', color: '#C45C7C' }, index: { label: 'Indexing loop', color: '#2E9DB0' },
}
const AT_ZONE_NAMES: Record<string, string> = { zoneRead: 'Zone 1 · read', zoneWrite: 'Zone 2 · write', zoneQuality: 'Zone 4 · quality', zoneMoney: 'Zone 3 · money' }
/** Display name of a line, zone or station (stations are named by their id). */
const atName = (n: string) => AT_LINES[n]?.label ?? AT_ZONE_NAMES[n] ?? n
const atColor = (k: string) => AT_LINES[k]?.color ?? 'var(--fg3)'

const AT_W = 1000, AT_H = 720
const AT_R: Pt = [250, 300], AT_P: Pt = [640, 300], AT_F: Pt = [640, 560], AT_LC: Pt = [342, 140], AT_LR = 92
const AT_PATH: Record<string, Pt[]> = { research: [[70, 300], AT_R, AT_P, [840, 300]], payments: [[70, 120], AT_R, [250, 360], [450, 560], AT_F, [840, 560]], approvals: [[640, 60], AT_P, AT_F, [640, 690]], evals: [AT_P, [780, 160], [900, 160]], memory: [[250, 50], AT_R] }
const AT_ST: [string, string, Pt, number, number, 'start' | 'middle' | 'end'][] = [['Intake', 'research', [70, 300], 0, 26, 'start'], ['Analyst', 'research', [445, 300], 0, 30, 'middle'], ['Deploy', 'research', [840, 300], 0, 30, 'middle'], ['Search', 'payments', [70, 120], 0, -14, 'start'], ['Pay agent', 'payments', [350, 460], -18, 10, 'end'], ['Ledger', 'payments', [840, 560], 0, 30, 'middle'], ['Human', 'approvals', [640, 60], 20, 5, 'start'], ['Risk', 'approvals', [640, 420], 20, 5, 'start'], ['Audit', 'approvals', [640, 690], 20, 5, 'start'], ['Grader', 'evals', [710, 230], 22, 18, 'start'], ['Evals', 'evals', [900, 160], 0, -16, 'middle'], ['Memory', 'memory', [250, 50], -18, 5, 'end'], ['Recall', 'memory', [250, 210], -18, 5, 'end']]
const AT_LOOPST: [string, number, number, 'start' | 'middle' | 'end', number][] = [['Embed', 0, -14, 'middle', 270], ['Cache', 16, 4, 'start', 0], ['Refresh', 0, 26, 'middle', 90]]
const AT_ZONES: [number, number, number, number, 'zoneRead' | 'zoneWrite' | 'zoneQuality' | 'zoneMoney', string][] = [[40, 30, 520, 210, 'zoneRead', 'br'], [40, 250, 900, 120, 'zoneWrite', 'br'], [700, 30, 240, 210, 'zoneQuality', 'tl'], [300, 390, 640, 320, 'zoneMoney', 'br']]
const AT_HUBS: [string, Pt, number, number, 'start' | 'end'][] = [['Research', AT_R, 14, -24, 'start'], ['Product', AT_P, -16, -24, 'end'], ['Finance', AT_F, 18, -24, 'start']]
const atSame = (a: Pt, b: Pt) => a[0] === b[0] && a[1] === b[1]
const atCum = Object.fromEntries(Object.entries(AT_PATH).map(([k, pts]) => { const c = [0]; for (let i = 1; i < pts.length; i++) c.push(c[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1])); return [k, c] }))
/** A line's length in map units (the Indexing loop is a circle). */
const atLen = (k: string) => k === 'index' ? 2 * Math.PI * AT_LR : atCum[k][atCum[k].length - 1]
/** The point at arc position `s` along line `k`, with the track's direction there (deg). */
function atPoint(k: string, s: number): { x: number; y: number; a: number } {
  if (k === 'index') { const L = atLen(k), th = Math.PI + (((s % L) + L) % L) / AT_LR; return { x: AT_LC[0] + AT_LR * Math.cos(th), y: AT_LC[1] + AT_LR * Math.sin(th), a: th * 180 / Math.PI + 90 } }
  const pts = AT_PATH[k], c = atCum[k]; s = Math.max(0, Math.min(c[c.length - 1], s))
  let i = 1; while (i < pts.length - 1 && c[i] < s) i++
  const [a, b] = [pts[i - 1], pts[i]], L = c[i] - c[i - 1], t = L ? (s - c[i - 1]) / L : 0
  return { x: a[0] + (b[0] - a[0]) * t, y: a[1] + (b[1] - a[1]) * t, a: Math.atan2(b[1] - a[1], b[0] - a[0]) * 180 / Math.PI }
}
/** The arc position on line `k` nearest to a point. */
function atNear(k: string, pt: Pt): number {
  if (k === 'index') { const th = Math.atan2(pt[1] - AT_LC[1], pt[0] - AT_LC[0]); return ((((th - Math.PI) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI)) * AT_LR }
  const pts = AT_PATH[k], c = atCum[k]; let best = 0, bd = Infinity
  for (let i = 0; i < pts.length - 1; i++) {
    const [a, b] = [pts[i], pts[i + 1]], dx = b[0] - a[0], dy = b[1] - a[1], L = Math.hypot(dx, dy)
    const t = Math.max(0, Math.min(1, ((pt[0] - a[0]) * dx + (pt[1] - a[1]) * dy) / (L * L))), d = Math.hypot(a[0] + dx * t - pt[0], a[1] + dy * t - pt[1])
    if (d < bd - 0.01) { bd = d; best = c[i] + L * t }
  }
  return best
}
function atDir(pts: Pt[], pt: Pt): Pt {
  let best: Pt = [1, 0], bd = Infinity
  for (let i = 0; i < pts.length - 1; i++) {
    const [a, b] = [pts[i], pts[i + 1]], dx = b[0] - a[0], dy = b[1] - a[1], L = Math.hypot(dx, dy), t = Math.max(0, Math.min(1, ((pt[0] - a[0]) * dx + (pt[1] - a[1]) * dy) / (L * L)))
    const d = Math.hypot(a[0] + dx * t - pt[0], a[1] + dy * t - pt[1]); if (d < bd) { bd = d; best = [dx / L, dy / L] }
  }
  return best
}
/** Arc position of each station and hub, per line. */
const AT_SP: Record<string, Record<string, number>> = {}
AT_ST.forEach(([n, k, pt]) => { (AT_SP[k] ??= {})[n] = atNear(k, pt) })
Object.entries(AT_PATH).forEach(([k, pts]) => AT_HUBS.forEach(([n, pt]) => { if (pts.some(p => atSame(p, pt))) (AT_SP[k] ??= {})[n] = atNear(k, pt) }))
AT_SP.memory.Index = atNear('memory', [AT_LC[0] - AT_LR, AT_LC[1]])
const atPos = (line: string, station: string): number | undefined => AT_SP[line]?.[station]
/** The polyline between two arc positions of a line, bends included (for congestion heat). */
function atSubPath(k: string, a: number, b: number) {
  if (a > b) [a, b] = [b, a]
  const pts = AT_PATH[k], c = atCum[k], p0 = atPoint(k, a), p1 = atPoint(k, b), out = [`M${svgN(p0.x)},${svgN(p0.y)}`]
  for (let i = 1; i < pts.length - 1; i++) if (c[i] > a + 0.5 && c[i] < b - 0.5) out.push(`L${pts[i][0]},${pts[i][1]}`)
  out.push(`L${svgN(p1.x)},${svgN(p1.y)}`)
  return out.join(' ')
}
/** Track segments between neighbouring stations, per line: the unit congestion heat is painted on. */
const AT_SEGS = Object.keys(AT_PATH).flatMap(k => {
  const ss = [...new Set(Object.values(AT_SP[k] ?? {}).map(v => Math.round(v * 10) / 10))].sort((x, y) => x - y)
  return ss.slice(0, -1).map((a, i) => ({ key: `${k}:${i}`, line: k, a, b: ss[i + 1], d: atSubPath(k, a, ss[i + 1]) }))
})

/** Pads a number to a fixed width (mono font), so a changing value never moves the text's start (no layout shift). */
const atPad = (s: string, n: number) => s.padStart(n, ' ')
/** A memo signature from parts (joined by a separator no part contains, so different values never give the same signature). */
const atSig = (...parts: unknown[]) => parts.join('\u001f')
/** A signature of a list of signatures (its own separator, so lists of different lengths never collide). */
const atSigs = (items: readonly string[]) => items.join('\u001e')
/** memo() comparer for parts that pass a signature of everything they draw. */
const atSigEq = (a: { sig: string }, b: { sig: string }) => a.sig === b.sig

const AT_JOB_DOT = 'grid h-[18px] w-[18px] flex-none place-items-center rounded-full text-[11px] font-bold [@media(pointer:coarse)]:text-[11px]'
/** The trace table's columns: name, time strip, time, tokens, USD. */
const AT_TRACE_GRID = 'grid-cols-[minmax(150px,28%)_1fr_64px_64px_72px] gap-3'
/** Trace rows are a fixed height in a fixed-height list, so new rows never push the page. */
const AT_ROWS = 6, AT_ROW_H = 42
/** A mouse hovering a row follows it; a click or tap pins it (touch has no hover). Buttons inside keep their own clicks. */
const atFollow = <K,>(id: K, setHover: (h: K | null) => void, setPin: (f: (p: K | null) => K | null) => void) => ({
  onPointerEnter: (e: React.PointerEvent) => { if (e.pointerType === 'mouse') setHover(id) },
  onPointerLeave: (e: React.PointerEvent) => { if (e.pointerType === 'mouse') setHover(null) },
  onClick: (e: React.MouseEvent) => { if ((e.target as Element).closest('button')) return; setPin(p => p === id ? null : id) },
})
const atDim = (on: boolean) => cn('transition-opacity duration-200', !on && 'opacity-15')

/*
 * Layers. The map is stacked layers of the same size: the still drawing (zones, congestion heat, lines, ticks: an SVG
 * that re-renders only when the followed lines change), pulses (HTML), hubs and marks (SVG), the tokens (HTML), and the
 * labels (SVG). Moving parts are HTML boxes sized in % of the map and placed by `transform` in % of their own size, so
 * a frame only moves composited layers: no layout, no repaint of the drawing, no measuring.
 */
/** Box of `u`×`u` map units, in % of the map. */
const atBox = (u: number) => ({ width: `${(u / AT_W) * 100}%`, height: `${(u / AT_H) * 100}%` })
const atPct = (v: number, u: number) => `${((v - u / 2) / u * 100).toFixed(2)}%`
/** Translate a `u`-unit box so its centre sits on map point p. */
const atAt = (p: { x: number; y: number }, u: number) => `translate(${atPct(p.x, u)},${atPct(p.y, u)})`
const AT_TOK = 30, AT_PULSE = 38
/** A `u`-unit box centred on map point (x, y) by its position and margins (both margins are % of the map's width), so its
 * animations can stay pure scale + opacity, which run on the compositor (a % translate would keep them on the main thread). */
const atCentred = (x: number, y: number, u: number) => ({ left: `${(x / AT_W) * 100}%`, top: `${(y / AT_H) * 100}%`, marginLeft: `${(-u / 2 / AT_W) * 100}%`, marginTop: `${(-u / 2 / AT_W) * 100}%`, ...atBox(u) })
// each layer is a fixed-size box with strict containment: a change inside one lays out and repaints that layer only
const AT_SVG_LAYER = 'pointer-events-none absolute top-0 left-0 block h-full w-full [contain:strict]'
const AT_HTML_LAYER = 'pointer-events-none absolute inset-0 [contain:strict]'
const AT_VIEWBOX = `0 0 ${AT_W} ${AT_H}`

/** The still drawing: zones, congestion heat, lines and ticks (three stacked SVGs). Re-renders only when the followed lines (`lit`) change; the heat paths are styled by `regHeat`. */
const AtMapBase = memo(function AtMapBase({ lit, fs, regHeat }: { lit: string | null; fs: number; regHeat: (el: SVGPathElement | null) => void }) {
  const litSet = useMemo(() => lit === null ? null : new Set(lit.split(',')), [lit])
  const on = (k: string) => !litSet || litSet.has(k)
  return <>
    <svg viewBox={AT_VIEWBOX} role="img" aria-label={'Transit map of agent teams'} className="block h-auto w-full">
      {AT_ZONES.map(([x, y, w, h, l, pos]) => <g key={l}>
        <rect x={x} y={y} width={w} height={h} fill="var(--muted)" stroke="var(--line2)" strokeDasharray="5 4" />
        <text x={pos.includes('l') ? x + 14 : x + w - 14} y={pos.includes('t') ? y + 22 : y + h - 12} textAnchor={pos.includes('l') ? 'start' : 'end'} fill="var(--fg)" style={{ font: `500 ${12 * fs}px var(--font)` }}>{atName(l)}</text>
      </g>)}
    </svg>
    {/* the heat has its own small drawing on its own layer, so a heat tween lays out and repaints a few paths, not the whole map */}
    <svg viewBox={AT_VIEWBOX} aria-hidden className={cn(AT_SVG_LAYER, 'will-change-transform')}>
      <g fill="none" strokeLinecap="round" strokeLinejoin="round">
        {AT_SEGS.map((sg, i) => <path key={sg.key} ref={regHeat} data-i={i} d={sg.d} />)}
      </g>
    </svg>
    <svg viewBox={AT_VIEWBOX} aria-hidden className={AT_SVG_LAYER}>
      <g fill="none" strokeWidth={8} strokeLinejoin="round">
        {Object.entries(AT_PATH).map(([k, pts]) => <path key={k} d={'M' + pts.map(p => p.join(',')).join(' L')} stroke={atColor(k)} className={atDim(on(k))} />)}
        <path d={`M${AT_LC[0] - AT_LR},${AT_LC[1]} A${AT_LR},${AT_LR} 0 1,1 ${AT_LC[0] + AT_LR},${AT_LC[1]} A${AT_LR},${AT_LR} 0 1,1 ${AT_LC[0] - AT_LR},${AT_LC[1]}`} stroke={atColor('index')} className={atDim(on('index'))} />
      </g>
      <g>
        {Object.entries(AT_PATH).flatMap(([k, pts]) => [pts[0], pts[pts.length - 1]].filter(p => ![AT_R, AT_P, AT_F].some(h => atSame(h, p))).map((p, i) => {
          const [ux, uy] = atDir(pts, p), nx = -uy, ny = ux
          return <line key={k + i} x1={p[0] - nx * 11} y1={p[1] - ny * 11} x2={p[0] + nx * 11} y2={p[1] + ny * 11} stroke={atColor(k)} strokeWidth={4} className={atDim(on(k))} />
        }))}
        {AT_ST.map(([n, k, pt]) => {
          const pts = AT_PATH[k]; if (atSame(pts[0], pt) || atSame(pts[pts.length - 1], pt)) return null
          const [ux, uy] = atDir(pts, pt); return <line key={n} x1={pt[0]} y1={pt[1]} x2={pt[0] - uy * 10} y2={pt[1] + ux * 10} stroke={atColor(k)} strokeWidth={3} className={atDim(on(k))} />
        })}
        {AT_LOOPST.map(([n, , , , ang]) => { const a = ang * Math.PI / 180; return <line key={n} x1={AT_LC[0] + Math.cos(a) * AT_LR} y1={AT_LC[1] + Math.sin(a) * AT_LR} x2={AT_LC[0] + Math.cos(a) * (AT_LR + 10)} y2={AT_LC[1] + Math.sin(a) * (AT_LR + 10)} stroke={atColor('index')} strokeWidth={3} className={atDim(on('index'))} /> })}
      </g>
    </svg>
  </>
})
/** A map with no congestion: its heat paths stay unstyled. */
const atNoHeat = () => {}

/** The Index station and the three orchestrator hubs (still). */
const AtHubs = memo(function AtHubs() {
  return <g>
    <circle cx={AT_LC[0] - AT_LR} cy={AT_LC[1]} r={10} fill="var(--card)" stroke="var(--fg)" strokeWidth={3.5} />
    {AT_HUBS.map(([n, [x, y]]) => <circle key={n} cx={x} cy={y} r={22} fill="var(--card)" stroke="var(--fg)" strokeWidth={5} />)}
  </g>
})

/** Station, loop and hub names (still; they sit over the tokens). */
const AtLabels = memo(function AtLabels({ fs }: { fs: number }) {
  return <>
    {AT_ST.map(([n, , pt, dx, dy, anc]) => <text key={n} x={pt[0] + dx} y={pt[1] + dy} textAnchor={anc}>{n}</text>)}
    {AT_LOOPST.map(([n, dx, dy, anc, ang]) => { const a = ang * Math.PI / 180; return <text key={n} x={AT_LC[0] + Math.cos(a) * AT_LR + dx + Math.cos(a) * 6} y={AT_LC[1] + Math.sin(a) * AT_LR + dy} textAnchor={anc}>{n}</text> })}
    <text x={AT_LC[0] - AT_LR - 18} y={AT_LC[1] + 5} textAnchor="end" fill="var(--fg)" fontWeight={600}>Index</text>
    {AT_HUBS.map(([n, [x, y], dx, dy, anc]) => <text key={n} x={x + dx} y={y + dy} textAnchor={anc} fill="var(--fg)" style={{ font: `600 ${15 * fs}px var(--font)` }}>{n}</text>)}
  </>
})
/** The labels' layer. */
const AtLabelLayer = memo(function AtLabelLayer({ fs, children }: { fs: number; children?: ReactNode }) {
  return <svg viewBox={AT_VIEWBOX} aria-hidden className={AT_SVG_LAYER}><g style={{ font: `${13 * fs}px var(--font)` }} fill="var(--fg2)"><AtLabels fs={fs} />{children}</g></svg>
})

/**
 * A waiting station's expanding ring, as an HTML box over the map with a native keyframe animation (scale + fade on the
 * compositor, no script or layout per frame); paused, not torn down, while the map is off screen.
 */
function AtPulse({ x, y, active }: { x: number; y: number; active: boolean }) {
  const ref = useRef<HTMLDivElement>(null), anim = useRef<Animation | null>(null)
  useEffect(() => {
    const el = ref.current; if (!el || typeof el.animate !== 'function') return
    const a = el.animate([{ transform: 'scale(1)', opacity: 0.6 }, { transform: 'scale(1.6)', opacity: 0 }], { duration: 1600, iterations: Infinity, easing: 'ease-out' })
    anim.current = a
    return () => { a.cancel(); anim.current = null }
  }, [])
  useEffect(() => { const a = anim.current; if (!a) return; if (active) a.play(); else a.pause() }, [active])
  return <div ref={ref} className="absolute opacity-0" style={atCentred(x, y, AT_PULSE)}>
    <svg viewBox={`${-AT_PULSE / 2} ${-AT_PULSE / 2} ${AT_PULSE} ${AT_PULSE}`} className="block h-full w-full overflow-visible"><circle r={18} fill="none" stroke="var(--warn)" strokeWidth={2} /></svg>
  </div>
}

/** A numbered token in its line's colour: smaller for a fork's child, with a dashed ring while queued. */
function AtTokenGlyph({ n, color, small, queued }: { n: ReactNode; color: string; small?: boolean; queued?: boolean }) {
  return <svg viewBox={`${-AT_TOK / 2} ${-AT_TOK / 2} ${AT_TOK} ${AT_TOK}`} className="block h-full w-full overflow-visible">
    {queued && <circle r={small ? 11 : 13} fill="none" stroke="var(--fg3)" strokeWidth={1.5} strokeDasharray="3 2.5" />}
    <circle r={small ? 8 : 10} fill={color} stroke="var(--card)" strokeWidth={2.5} />
    <text y={3.6} textAnchor="middle" fill="#fff" style={{ font: '700 10px var(--font)' }}>{n}</text>
  </svg>
}

/** Where a token is drawn: a line and an arc position on it. */
type AtGlide = { line: string; s: number }
/**
 * Moves a token's drawn place `d` towards arc position `s` on `line` by at most `v` map units, switching lines at a
 * shared station first; a gap over `snap` units is jumped. True once it is there.
 */
function atGlide(d: AtGlide, line: string, s: number, v: number, snap = Infinity) {
  if (d.line !== line) { const p = atPoint(d.line, d.s); d.line = line; d.s = atNear(line, [p.x, p.y]) }
  const gap = Math.abs(s - d.s)
  d.s = gap <= v || gap > snap ? s : d.s + Math.sign(s - d.s) * v
  return d.s === s
}
/**
 * Token boxes moved by a frame loop. `reg` is their ref (data-id names the box); `placeOf(id, at)` is the transform a
 * box mounts with, remembered so React keeps passing the same value and never undoes the loop's writes; `write(id,
 * transform)` moves a box (skipped when unchanged).
 */
function useAtTokenEls() {
  return useMemo(() => {
    const els = new Map<string, HTMLElement>(), born = new Map<string, string>(), last = new Map<string, string>()
    return {
      reg: (el: HTMLElement | null) => {
        if (!el) return
        const id = el.dataset.id!
        els.set(id, el); last.set(id, el.style.transform)
        return () => { els.delete(id); born.delete(id); last.delete(id) }
      },
      placeOf: (id: string, at: () => string) => { let b = born.get(id); if (b === undefined) born.set(id, b = at()); return b },
      write: (id: string, tr: string) => { const el = els.get(id); if (el && last.get(id) !== tr) { last.set(id, tr); el.style.transform = tr } },
    }
  }, [])
}

/** The map, scrolling sideways inside its card on phones (where it keeps a readable size). */
function AtMapScroll({ narrow, hintClass, children }: { narrow: boolean; hintClass?: string; children: ReactNode }) {
  const [ref, edges] = useScrollEdges<HTMLDivElement>()
  return <>
    <div ref={ref} className={cn(narrow && '-mx-1 overflow-x-auto overscroll-x-contain rounded-[var(--r-md)] px-1 [contain:inline-size] [scrollbar-width:thin]')} tabIndex={narrow ? 0 : undefined} aria-label={narrow ? 'Transit map, scrolls sideways' : undefined}>
      <div className={cn('relative', narrow && 'min-w-[820px]')}>{children}</div>
    </div>
    {narrow && <ScrollEdges {...edges} hint={'Swipe the map'} className={hintClass} />}
  </>
}

/** A legend entry: a line's colour, or a swatch drawn by `swatch` (classes). */
type AtLegendItem = { label: string; swatch: string }
const AT_LEGEND_ITEM = 'inline-flex items-center gap-2'
/** The map's legend: the `lines` shown, then the `extras`. */
function AtLegend({ lines, extras }: { lines: readonly string[]; extras: readonly AtLegendItem[] }) {
  return (
    <div className="mt-1.5 mb-3 flex flex-wrap justify-center gap-x-5 gap-y-2 text-[13px] text-[var(--fg2)] max-sm:justify-start max-sm:gap-x-4">
      {lines.map(k => <span key={k} className={AT_LEGEND_ITEM}><i className="inline-block h-[7px] w-5 rounded-[var(--r-sm)]" style={{ background: atColor(k) }} />{atName(k)}</span>)}
      {extras.map(x => <span key={x.label} className={AT_LEGEND_ITEM}><i className={cn('inline-block', x.swatch)} />{x.label}</span>)}
    </div>
  )
}
const AT_LEGEND_ORCH: AtLegendItem = { label: 'Orchestrator', swatch: 'h-3 w-3 rounded-full bg-[var(--card)] shadow-[inset_0_0_0_2.5px_var(--fg)]' }
const AT_LEGEND_WAIT: AtLegendItem = { label: 'Waiting for approval', swatch: 'h-3.5 w-3.5 rounded-full shadow-[inset_0_0_0_3px_var(--warn)]' }
const AT_LEGEND_RUN: AtLegendItem[] = [
  { label: 'Agent (numbered, matches the trace)', swatch: 'h-3.5 w-3.5 rounded-full bg-[var(--fg2)]' },
  { label: 'Stop (visits)', swatch: 'h-3.5 w-3.5 rounded-full bg-[var(--card)] shadow-[inset_0_0_0_2.5px_var(--fg2)]' },
  { label: 'Failed here', swatch: 'h-3.5 w-3.5 rounded-full bg-[var(--card)] shadow-[inset_0_0_0_2.5px_var(--bad)]' },
  AT_LEGEND_WAIT,
]

/** The trace table: a header (title, the time `axis`, the number columns) over the rows, scrolling sideways on phones. */
function AtTraceFrame({ axis, narrow, children }: { axis: ReactNode; narrow: boolean; children: ReactNode }) {
  const [ref, edges] = useScrollEdges<HTMLDivElement>()
  return (
    <div className="relative border-t border-[var(--line)]">
      <div ref={ref} className="overflow-x-auto overscroll-x-contain [contain:inline-size]" tabIndex={narrow ? 0 : undefined} aria-label={narrow ? 'Trace table, scrolls sideways' : undefined}>
        <div className="min-w-[640px]">
          <div className={cn('grid h-9 items-center border-b border-[var(--line)] text-xs text-[var(--fg3)]', AT_TRACE_GRID)}>
            <span className="sticky start-0 z-[1] bg-[var(--card)] text-sm font-semibold text-[var(--fg)]">Trace</span>
            <span className="relative h-full font-[family-name:var(--mono)] text-[11px]">{axis}</span>
            {['time', 'tokens', 'USD'].map(h => <span key={h} className="text-end font-[family-name:var(--mono)]">{h}</span>)}
          </div>
          {children}
        </div>
      </div>
      {narrow && <ScrollEdges left={false} right={edges.right} touched={edges.touched} hint={'Swipe the trace'} />}
    </div>
  )
}
const AT_NUM = 'text-end font-[family-name:var(--mono)] text-xs whitespace-pre'
/** A trace row's time, tokens and cost, padded to fixed widths (a dash when unknown). */
function AtNums({ seconds, tokens, usd }: { seconds: number; tokens?: number | null; usd?: number | null }) {
  return <>
    <span className={AT_NUM}>{atPad(fmt.seconds(seconds), 6)}</span>
    <span className={AT_NUM}>{atPad(tokens ? fmt.compact(tokens) : '—', 6)}</span>
    <span className={AT_NUM}>{atPad(usd != null ? fmt.usd(usd) : '—', 8)}</span>
  </>
}
/** A trace row's name cell: the numbered dot in `color`, the name and a status line. */
function AtRowName({ n, color, name, status, bad, title, children }: { n: ReactNode; color: string; name: string; status: ReactNode; bad?: boolean; title?: string; children?: ReactNode }) {
  return (
    <div className="sticky start-0 z-[1] flex min-w-0 items-center gap-2 bg-[var(--card)] whitespace-nowrap max-sm:shadow-[6px_0_6px_-6px_rgba(0,0,0,.25)]">
      {children ?? <span className={AT_JOB_DOT} style={onColorLabel(color)}>{n}</span>}
      <span className={cn('max-w-[60%] flex-none truncate', bad && 'text-[var(--bad)]')}>{name}</span>
      <span className={cn('min-w-0 flex-1 truncate text-[11px]', bad ? 'text-[var(--bad)]' : 'text-[var(--fg3)]')} title={title}>{status}</span>
    </div>
  )
}
/** A trace bar's look: solid, or hatched while waiting; the opacity is folded into the colour (no layer per bar). */
const atSegFill = (s: { kind: string; sub: boolean }, c: string) => {
  const a = s.sub ? (s.kind === 'wait' ? 90 : 80) : s.kind === 'move' ? 45 : s.kind === 'wait' ? 90 : 100
  const col = a === 100 ? c : `color-mix(in srgb, ${c} ${a}%, transparent)`
  return s.kind === 'wait' ? `repeating-linear-gradient(135deg, ${col} 0 3px, transparent 3px 7px)` : col
}

/**
 * The transit map's geometry and drawing pieces, for building a simulation on the map (the showcase's TransitSimMap in
 * the examples uses them). Internal: may change in any release.
 */
export const transitMapKit = {
  AT_W, AT_H, AT_LC, AT_LR, AT_HUBS, AT_ST, AT_SP, AT_SEGS, AT_TOK, AT_PULSE, AT_ROWS, AT_ROW_H, AT_JOB_DOT, AT_TRACE_GRID, AT_SVG_LAYER, AT_HTML_LAYER, AT_VIEWBOX,
  AT_LEGEND_ORCH, AT_LEGEND_WAIT, AT_LINE_IDS: Object.keys(AT_LINES),
  atName, atColor, atLen, atPoint, atNear, atPos, atPad, atSig, atSigs, atSigEq, atFollow, atDim, atBox, atAt, atCentred, atSegFill, atGlide,
  AtMapBase, AtHubs, AtLabelLayer, AtPulse, AtTokenGlyph, AtMapScroll, AtLegend, AtTraceFrame, AtNums, AtRowName, useAtTokenEls,
}

/** AgentTransitMap without a run: the map and its legend, no traffic. */
function AtStaticMap({ className }: { className?: string }) {
  const narrow = useMediaQuery('(max-width: 639px)'), fs = narrow ? 1.2 : 1
  return (
    <div className={cn('flex flex-col', className)}>
      <div className="relative">
        <AtMapScroll narrow={narrow}>
          <AtMapBase lit={null} fs={fs} regHeat={atNoHeat} />
          <svg viewBox={AT_VIEWBOX} aria-hidden className={AT_SVG_LAYER}><AtHubs /></svg>
          <AtLabelLayer fs={fs} />
        </AtMapScroll>
      </div>
      <AtLegend lines={Object.keys(AT_LINES)} extras={[AT_LEGEND_ORCH]} />
    </div>
  )
}

/**
 * A multi-agent "transit map": agent teams are lines, agents and tools are stations, orchestrators are hubs. `run`
 * draws a real agent run (an AgentRun from useAgentRun, fromOtel, fromAiSdkResult or fromLangGraphEvents, finished or
 * live): each span stops at a station (`stations`, default transitRunStation: model calls at Analyst, retrievals at
 * Recall, people at Human, tools by name), each running agent is a numbered token that glides along the lines to where
 * its latest step is, stations count their visits and turn red where a step failed, and the trace table lists the
 * steps on the run's own timeline. Hover or tap a row to light its line. Without a run the map is drawn with no
 * traffic. Tokens are composited layers moved by a frame loop (30 fps on touch screens); reduced motion places them
 * at their stations. On phones the map keeps a readable size and scrolls sideways inside the card, as does the trace.
 * The showcase's live simulation (the WorkflowEngine driving the map) is `TransitSimMap` in the examples.
 */
export function AgentTransitMap({ run, stations, className }: {
  /** @deprecated ignored: the simulation moved to the examples (TransitSimMap); without `run` the map is drawn empty */
  machines?: Record<string, WorkflowMachine>
  /** @deprecated ignored, like `machines` */
  order?: string[]
  /** the agent run to draw (finished or live, e.g. from useAgentRun) */
  run?: AgentRun | null
  /** where a run's spans stop: [line, station] by span name or kind, or a function (default transitRunStation) */
  stations?: TransitRunStations
  className?: string }) {
  return run ? <AtRunMap run={run} stations={stations} className={className} /> : <AtStaticMap className={className} />
}

/** Where a run's span stops on the transit map: a line and one of its stations or hubs (e.g. ['payments', 'Search']). */
export type TransitStation = readonly [line: string, station: string]
/** AgentTransitMap's `stations`: a stop per span name or kind (null keeps it off the map), or a function returning one (undefined: the default). */
export type TransitRunStations = Partial<Record<string, TransitStation | null>> | ((span: AgentSpan, run: AgentRun) => TransitStation | null | undefined)
const AT_RUN_HUBS: TransitStation[] = [['research', 'Research'], ['research', 'Product'], ['payments', 'Finance']]
const AT_RUN_TOOLS: [RegExp, TransitStation][] = [
  [/memor|recall|remember|embed|vector|index/i, ['memory', 'Recall']],
  [/search|web|browse|fetch|lookup|find|get|read|query|list/i, ['payments', 'Search']],
  [/refund|pay|charge|invoice|bill|book|purchase|order|checkout/i, ['payments', 'Pay agent']],
  [/deploy|publish|release|send|email|notify|post|ship/i, ['research', 'Deploy']],
  [/ledger|write|save|create|update|insert|ticket|record|log|store/i, ['payments', 'Ledger']],
  [/eval|grade|score|test|check|verify|validate|review|lint/i, ['evals', 'Grader']],
]
/**
 * The default stop of a run's span on the transit map: the root agent at Intake, other agents at the hubs (Research,
 * Product, Finance in turn), model calls at Analyst, retrievals at Recall, people at Human, chains nowhere, and tools by
 * name (memory → Recall; search, get, read → Search; pay, refund, book → Pay agent; send, deploy → Deploy; create,
 * write, ticket → Ledger; check, test, review → Grader; anything else → Evals).
 */
export function transitRunStation(span: AgentSpan, run: AgentRun): TransitStation | null {
  switch (span.kind) {
    case 'human': return ['approvals', 'Human']
    case 'retrieval': return ['memory', 'Recall']
    case 'llm': return ['research', 'Analyst']
    case 'chain': return null
    case 'agent': {
      const sub = !!nearestAgent(span, new Map(run.spans.map(s => [s.id, s])))
      if (!sub && !run.spans.some(s => s.kind === 'agent' && s !== span && s.startMs < span.startMs)) return ['research', 'Intake']
      const others = run.spans.filter(s => s.kind === 'agent' && s.startMs <= span.startMs && s !== span).length
      return AT_RUN_HUBS[(others - 1 + AT_RUN_HUBS.length) % AT_RUN_HUBS.length]
    }
    default: return AT_RUN_TOOLS.find(([re]) => re.test(span.name))?.[1] ?? ['evals', 'Evals']
  }
}
/** A span's stop: `stations` (by name, then kind, or the function), else the default; stops the map doesn't have fall back to the default. */
function atRunStop(span: AgentSpan, run: AgentRun, stations: TransitRunStations | undefined): TransitStation | null {
  let st: TransitStation | null | undefined
  if (typeof stations === 'function') st = stations(span, run)
  else if (stations) st = Object.prototype.hasOwnProperty.call(stations, span.name) ? stations[span.name] : Object.prototype.hasOwnProperty.call(stations, span.kind) ? stations[span.kind] : undefined
  if (st === null) return null
  return st && atPos(st[0], st[1]) !== undefined ? st : transitRunStation(span, run)
}
type AtRunStopMark = { key: string; line: string; station: string; x: number; y: number; visits: number; running: number; errors: number; human: boolean; ids: string[] }
type AtRunTok = { id: string; n: number; line: string; s: number; error: boolean }
type AtRunRowData = { span: AgentSpan; stop: TransitStation | null; agent: number }
/** A run on the map: each span's stop, the stations' marks, a token per running agent (at its latest step), the lines used. */
function atRunModel(run: AgentRun, stations: TransitRunStations | undefined) {
  const byId = new Map(run.spans.map(s => [s.id, s]))
  const agents = run.spans.filter(s => s.kind === 'agent').sort((a, b) => a.startMs - b.startMs)
  const num = new Map(agents.map((a, i) => [a.id, i + 1]))
  const agentOf = (s: AgentSpan) => s.kind === 'agent' ? s.id : nearestAgent(s, byId)?.id ?? agents[0]?.id ?? ''
  const rows: AtRunRowData[] = [...run.spans].sort((a, b) => a.startMs - b.startMs).map(span => ({ span, stop: atRunStop(span, run, stations), agent: num.get(agentOf(span)) ?? 1 }))
  // stops by line, then station (ids may contain any character, so no joined keys)
  const marks = new Map<string, Map<string, AtRunStopMark>>(), lines = new Set<string>()
  for (const r of rows) {
    if (!r.stop) continue
    const [line, station] = r.stop, p = atPoint(line, atPos(line, station) ?? 0)
    lines.add(line)
    const onLine = marks.get(line) ?? new Map<string, AtRunStopMark>(); marks.set(line, onLine)
    const m = onLine.get(station) ?? { key: atSig(line, station), line, station, x: p.x, y: p.y, visits: 0, running: 0, errors: 0, human: false, ids: [] }
    m.visits++; m.ids.push(r.span.id)
    if (r.span.status === 'running') { m.running++; if (r.span.kind === 'human') m.human = true }
    if (r.span.status === 'error') m.errors++
    onLine.set(station, m)
  }
  // a token per running agent (or one for the run, when it has no agent span), at its latest step's stop
  const tokens: AtRunTok[] = []
  const owners = agents.length ? agents.filter(a => a.status === 'running') : run.status === 'running' ? [null] : []
  for (const a of owners) {
    const mine = rows.filter(r => r.stop && (a ? agentOf(r.span) === a.id : true))
    const cur = [...mine].reverse().find(r => r.span.status === 'running' && r.span.kind !== 'agent') ?? mine[mine.length - 1]
    if (!cur?.stop) continue
    tokens.push({ id: a?.id ?? 'run', n: a ? num.get(a.id)! : 1, line: cur.stop[0], s: atPos(cur.stop[0], cur.stop[1]) ?? 0, error: cur.span.status === 'error' })
  }
  return { rows: rows.filter(r => r.span.kind !== 'agent' && r.span.kind !== 'chain'), marks: [...marks.values()].flatMap(m => [...m.values()]), tokens, lines }
}
/** Map units a run's token glides per second. */
const AT_RUN_GLIDE = 340

/** The stations' visit marks: a ring in the line's colour with the count, red with "!" where a step failed, thicker while one runs there. */
const AtRunMarks = memo(function AtRunMarks({ marks, lit }: { sig: string; marks: AtRunStopMark[]; lit: string | null }) {
  return <g>
    {marks.map(m => { const on = !lit || m.ids.includes(lit); return (
      <g key={m.key} transform={svgTranslate(m.x, m.y)} className={atDim(on)}>
        <circle r={m.running ? 15 : 13} fill="var(--card)" stroke={m.errors ? 'var(--bad)' : atColor(m.line)} strokeWidth={m.running ? 4.5 : 3} />
        <text y={4} textAnchor="middle" fill={m.errors ? 'var(--bad)' : 'var(--fg)'} style={{ font: '700 11px var(--font)' }}>{m.errors ? '!' : m.visits}</text>
      </g>) })}
  </g>
}, atSigEq)

/** The run view of AgentTransitMap: stops, marks and tokens for a real run, with its steps in a table. */
function AtRunMap({ run, stations, className }: { run: AgentRun; stations?: TransitRunStations; className?: string }) {
  const reduce = !!useReducedMotion()
  const narrow = useMediaQuery('(max-width: 639px)')
  const { ref: host, visible } = useViewport<HTMLDivElement>(null, { amount: 0 })
  const listRef = useRef<HTMLDivElement>(null)
  const [hovered, setHovered] = useState<string | null>(null), [pin, setPin] = useState<string | null>(null)
  const lit = hovered ?? pin
  const model = useMemo(() => atRunModel(run, stations), [run, stations])
  const fs = narrow ? 1.2 : 1
  const totals = runTotals(run), latest = runLatestMs(run), span0 = Math.max(1, latest - run.startedAt)
  const litRow = lit ? model.rows.find(r => r.span.id === lit) : undefined
  const litKey = litRow?.stop ? litRow.stop[0] : lit ? '' : [...model.lines].join(',') || null
  // tokens glide along the lines to their agent's latest stop (the frame loop writes their transforms; React keeps the first)
  const toks = useAtTokenEls(), disp = useRef(new Map<string, AtGlide>())
  const [moving, setMoving] = useState(false)
  const want = useRef(model.tokens); want.current = model.tokens
  const step = (dt: number) => {
    let busy = false
    for (const tk of want.current) {
      let d = disp.current.get(tk.id)
      if (!d || reduce) { d = { line: tk.line, s: tk.s }; disp.current.set(tk.id, d) }
      else if (!atGlide(d, tk.line, tk.s, AT_RUN_GLIDE * dt)) busy = true
      toks.write(tk.id, atAt(atPoint(d.line, d.s), AT_TOK))
    }
    for (const id of disp.current.keys()) if (!want.current.some(tk => tk.id === id)) disp.current.delete(id)
    return busy
  }
  const tokSig = atSigs(model.tokens.map(tk => atSig(tk.id, tk.line, svgN(tk.s))))
  useLayoutEffect(() => { setMoving(step(0)) }, [tokSig, reduce]) // eslint-disable-line react-hooks/exhaustive-deps
  useFrameLoop(moving && visible, dt => { if (!step(dt)) setMoving(false) }, { coarseFps: 30 })
  const placeOf = (tk: AtRunTok) => toks.placeOf(tk.id, () => { const d = disp.current.get(tk.id); return atAt(atPoint(d?.line ?? tk.line, d?.s ?? tk.s), AT_TOK) })
  // a live run's table follows its newest step unless the reader scrolled up
  const rowCount = model.rows.length
  useLayoutEffect(() => {
    const el = listRef.current
    if (el && run.status === 'running' && el.scrollHeight - el.scrollTop - el.clientHeight < AT_ROW_H * 1.5 + 4) el.scrollTop = el.scrollHeight
  }, [rowCount, run.status])
  const status = RUN_STATUS[run.status]
  const waiting = model.marks.filter(m => m.human), waitingN = waiting.reduce((n, m) => n + m.running, 0)
  const tx = (ms: number) => `${(Math.max(0, ms - run.startedAt) / span0) * 100}%`

  return (
    <div ref={host} className={cn('flex flex-col', className)}>
      <div className="mb-2 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[13px]">
        <b className="min-w-0 truncate font-semibold">{run.name}</b>
        <Badge tone={status.tone} size="sm"><span className={cn('me-1 h-1.5 w-1.5 rounded-full bg-current', run.status === 'running' && 'animate-pulse motion-reduce:animate-none')} />{status.label}</Badge>
        <span className="ui-num text-xs text-[var(--fg2)]">{`${plural(rowCount, 'step')} · ${fmt.seconds(totals.durationMs / 1000)} · ${fmt.compact(totals.tokens.input + totals.tokens.output)} tokens · ${fmt.usd(totals.costUsd)}`}</span>
      </div>
      <div className="relative">
        <AtMapScroll narrow={narrow}>
          <AtMapBase lit={litKey} fs={fs} regHeat={atNoHeat} />
          <div aria-hidden className={AT_HTML_LAYER}>{!reduce && waiting.map(m => <AtPulse key={m.key} x={m.x} y={m.y} active={visible} />)}</div>
          <svg viewBox={AT_VIEWBOX} aria-hidden className={AT_SVG_LAYER}>
            <AtHubs />
            <AtRunMarks sig={atSig(lit, atSigs(model.marks.map(m => atSig(m.key, m.visits, m.running, m.errors))))} marks={model.marks} lit={lit} />
          </svg>
          <div aria-hidden className={AT_HTML_LAYER}>
            {model.tokens.map(tk => (
              <div key={tk.id} data-id={tk.id} ref={toks.reg} className="absolute top-0 left-0 will-change-transform" style={{ ...atBox(AT_TOK), transform: placeOf(tk) }}>
                <AtTokenGlyph n={tk.n} color={tk.error ? 'var(--bad)' : atColor(tk.line)} />
              </div>))}
          </div>
          <AtLabelLayer fs={fs} />
        </AtMapScroll>
      </div>
      <span className="sr-only" aria-live="polite">{waitingN ? `${fmt.number(waitingN)} waiting for your approval` : ''}</span>
      <AtLegend lines={Object.keys(AT_LINES).filter(k => model.lines.has(k))} extras={AT_LEGEND_RUN} />
      <AtTraceFrame narrow={narrow} axis={<><span className="absolute top-2.5 start-0">0</span><span className="absolute top-2.5 end-0">{fmt.seconds(span0 / 1000)}</span></>}>
        <div ref={listRef} className="relative overflow-y-auto overscroll-y-contain" style={{ height: AT_ROWS * AT_ROW_H }}>
          {!rowCount && <span className="absolute top-3 start-0 text-xs text-[var(--fg3)]">Steps appear here as the run reports them.</span>}
          {model.rows.map(({ span: s, stop, agent }) => {
            const col = stop ? atColor(stop[0]) : 'var(--c-neutral)', end = s.endMs ?? latest, failed = s.status === 'error'
            return (
              <div key={s.id} {...atFollow(s.id, setHovered, setPin)}
                className={cn('grid cursor-pointer items-center border-b border-[var(--line)] text-[13px] hover:bg-[color-mix(in_srgb,var(--muted)_60%,transparent)]', AT_TRACE_GRID, lit === s.id && 'bg-[color-mix(in_srgb,var(--muted)_60%,transparent)]')} style={{ height: AT_ROW_H }}>
                <AtRowName n={agent} color={col} name={s.name} bad={failed} title={s.error} status={failed && s.error ? s.error : stop ? stop[1] : 'off the map'} />
                <div className="relative h-3.5 overflow-x-clip">
                  <span className="absolute top-0 h-3.5 rounded-[var(--r-sm)]" style={{ left: tx(s.startMs), width: `max(2px, ${(Math.max(0, end - s.startMs) / span0) * 100}%)`, background: failed ? 'var(--bad)' : atSegFill({ kind: s.status === 'running' ? 'wait' : 'work', sub: false }, col) }} />
                </div>
                <AtNums seconds={(end - s.startMs) / 1000} tokens={s.tokens ? s.tokens.input + s.tokens.output : null} usd={s.costUsd} />
              </div>
            )
          })}
        </div>
      </AtTraceFrame>
    </div>
  )
}
