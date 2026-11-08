import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { Button, Chip, FONT_CSS, Icon, IconButton, Spinner, TOUCH, cn, fmt, LOCALE, ScrollEdges, sleep, spring, surface, themeCSS, useMediaQuery, useRoving, useScrollEdges, useTheme } from './core'
import { Collapse, CopyButton, TypingDots } from './feedback'
import { SegmentedControl, Slider, Switch } from './forms'
import { SendButton } from './ai'
import { lcsDiff } from './code'
import { AGENT_WORKFLOWS, AGENT_WORKFLOW_ORDER, WorkflowEngine, type WorkflowMachine, type WorkflowToken } from './diagrams'
import { useFrameLoop, useViewport } from './motion'

/* ════════════════════════════════════════════════════════════════════════════
 * 11c. AI WORKSPACES: the canvas (chat + living document) and the agent transit map
 * ══════════════════════════════════════════════════════════════════════════ */

/* Tiny HTML/CSS highlighter for the canvas (code's highlightCode has no HTML/CSS mode yet) ─ */

const AI_HL_RE = /(\/\*.*?\*\/)|(<\/?[a-zA-Z][\w-]*|\/?>)|("[^"]*")|(var\(--[\w-]+(?:,[^)]*)?\))|([a-z-]+)(?=\s*:\s)|(\b\d+(?:\.\d+)?(?:px|%|em|s)?\b|\$\d+)/g
const AI_HL_CLS = ['text-[var(--fg3)] italic', 'text-[var(--accent)]', 'text-[var(--ok)]', 'text-[color-mix(in_srgb,var(--c3)_70%,var(--fg))]', 'text-[var(--bad)]', 'text-[color-mix(in_srgb,var(--c3)_70%,var(--fg))]']
function aiHighlight(line: string): ReactNode[] {
  const out: ReactNode[] = []; let last = 0, k = 0
  for (const m of line.matchAll(AI_HL_RE)) {
    if (m.index! > last) out.push(line.slice(last, m.index))
    const g = [1, 2, 3, 4, 5, 6].findIndex(i => m[i] !== undefined)
    out.push(<span key={k++} className={AI_HL_CLS[g]}>{m[0]}</span>)
    last = m.index! + m[0].length
  }
  out.push(line.slice(last))
  return out
}
/** Line diff for the streaming edit (code's lcsDiff): '=' kept, '+' added, '-' removed, in display order. */
const aiLineDiff = (a: string[], b: string[]): ['=' | '+' | '-', string][] => lcsDiff(a, b).map(s => [s.type, s.type === '+' ? b[s.b!] : a[s.a!]])

/* AI canvas ──────────────────────────────────────────────────────────────── */

/** The demo document: a pricing card that uses the host theme tokens, so it follows light/dark and every theme. */
function aiPricingCard(btnRadius: string | null, toggle: boolean, dark: boolean) {
  return `<style>
  /* uses the host theme tokens, so it follows Light / Dark / System and every theme */
  .card { width: 280px; padding: 24px; border-radius: var(--r-lg, 14px); font-family: var(--font);
    background: ${dark ? 'var(--primary)' : 'var(--card)'}; color: ${dark ? 'var(--on-primary)' : 'var(--fg)'};
    border: 1px solid ${dark ? 'transparent' : 'var(--line)'}; box-shadow: var(--shadow); }
  .price { font-size: 40px; font-weight: 700; letter-spacing: -.02em; margin: 8px 0; }
  .muted { color: ${dark ? 'color-mix(in srgb, var(--on-primary) 65%, transparent)' : 'var(--fg3)'}; font-size: 14px; }
  ul { padding-left: 18px; line-height: 1.9; font-size: 14px; }
  .cta { width: 100%; padding: ${btnRadius ? '12px' : '10px'}; border: 0; border-radius: ${btnRadius || 'var(--r-md, 8px)'}; font: 600 14px var(--font);
    background: var(--accent); color: var(--on-primary); }${toggle ? `
  .toggle { display: flex; gap: 4px; padding: 4px; border-radius: 999px; margin-bottom: 16px; font-size: 13px;
    background: ${dark ? 'color-mix(in srgb, var(--on-primary) 12%, transparent)' : 'var(--muted)'}; }
  .toggle label { flex: 1; text-align: center; padding: 4px; border-radius: 999px; cursor: pointer; }
  #yr:checked ~ .toggle .y, #mo:checked ~ .toggle .m { background: ${dark ? 'color-mix(in srgb, var(--on-primary) 22%, transparent)' : 'var(--card)'}; }
  #yr:checked ~ .p-mo, #mo:checked ~ .p-yr { display: none; }
  input[name="b"] { display: none; }` : ''}
</style><div class="card">${toggle ? `
  <input type="radio" name="b" id="mo" checked><input type="radio" name="b" id="yr">
  <div class="toggle"><label for="mo" class="m">Monthly</label><label for="yr" class="y">Yearly −20%</label></div>` : ''}
  <div class="muted">Pro plan</div>${toggle ? `
  <div class="price p-mo">$24<span class="muted">/mo</span></div>
  <div class="price p-yr">$19<span class="muted">/mo, billed yearly</span></div>` : `
  <div class="price">$24<span class="muted">/mo</span></div>`}
  <ul><li>Unlimited projects</li><li>Priority support</li><li>Version history</li></ul>
  <button class="cta">Start free trial</button>
</div>`
}
export type CanvasEdit = { prompt: string; reply: string; code: string }
const AI_CANVAS_EDITS: CanvasEdit[] = [
  { prompt: 'Make the button rounder', reply: 'Rounded the button into a pill and gave it a bit more padding so it reads as the main action.', code: aiPricingCard('999px', false, false) },
  { prompt: 'Add a monthly / yearly toggle', reply: 'Added a segmented toggle. It is pure CSS, so it works without JavaScript, and the yearly price shows the discount.', code: aiPricingCard('999px', true, false) },
  { prompt: 'Make it dark', reply: 'Inverted the card onto the theme’s primary surface. It still uses theme tokens, so it adapts to every theme.', code: aiPricingCard('999px', true, true) },
]
const aiExplainLine = (n: number, ln: string) => /border-radius/.test(ln) ? 'This sets how round the corners are. 999px makes a full pill; smaller values give softer rectangles.'
  : /:checked/.test(ln) ? 'This highlights whichever toggle option is checked. Hidden radio inputs hold the state, so no JavaScript is needed.'
  : /background/.test(ln) ? 'This sets the fill colour, which changes between the light and dark versions so text keeps enough contrast.'
  : /<button/.test(ln) ? 'This is the call to action. It stretches to the card width so it is easy to hit on mobile.'
  : `Line ${n} is part of the card’s ${/[{}]|:/.test(ln) ? 'styles' : 'markup'}. Ask me to change it and I’ll edit it in place.`

type CvMsg = { id: number; role: 'u' | 'a'; text: string; tool?: { state: 'run' | 'done'; add: number; del: number; ver: number }; dots?: boolean; stream?: boolean }
type CvDiff = { lines: ['=' | '+' | '-', string][]; typing: number; chars: number; collapsing: boolean }

/**
 * Renders the document in a sandboxed iframe (srcdoc, scripts off), so markup from a model can't run handlers in the page.
 * The theme tokens and the page's web fonts are copied in, so the preview follows the theme; it grows to its content.
 */
function AiPreview({ html, title }: { html: string; title: string }) {
  const { tokens, dark } = useTheme()
  const ref = useRef<HTMLIFrameElement>(null)
  const [h, setH] = useState(320)
  const [fonts, setFonts] = useState('')
  useEffect(() => { // the page's Google Fonts (if any), so var(--font) renders the same inside
    const links = [...document.querySelectorAll<HTMLLinkElement>('link[rel="stylesheet"][href*="fonts.googleapis.com"]')].map(l => `<link rel="stylesheet" href="${l.href}">`)
    const base = [...document.querySelectorAll('style')].some(s => s.textContent?.includes(FONT_CSS)) ? `<style>${FONT_CSS}</style>` : ''
    setFonts(base + links.join(''))
  }, [tokens.font])
  const doc = useMemo(() => `<!doctype html><html><head><meta charset="utf-8">${fonts}<style>${themeCSS(tokens)}
:root{color-scheme:${dark ? 'dark' : 'light'}}html,body{margin:0;background:transparent}
body{display:flex;justify-content:center;padding:16px 12px 24px;font:14px/1.5 var(--font);color:var(--fg)}</style></head><body>${html}</body></html>`, [html, tokens, dark, fonts])
  useEffect(() => {
    const f = ref.current; if (!f) return
    let ro: ResizeObserver | null = null
    // the body's own height (the document's scrollHeight never drops below the frame, so it could only grow)
    const fit = () => { const d = f.contentDocument; if (!d?.body) return; const m = () => setH(Math.ceil(d.body.getBoundingClientRect().height)); m(); ro?.disconnect(); ro = new ResizeObserver(m); ro.observe(d.body) }
    f.addEventListener('load', fit); fit()
    return () => { f.removeEventListener('load', fit); ro?.disconnect() }
  }, [doc])
  return (
    <motion.div initial={{ opacity: 0, scale: 0.97 }} animate={{ opacity: 1, scale: 1 }} transition={spring(0.25, 0.35)} className="w-full max-w-[360px]">
      {/* allow-same-origin without allow-scripts: nothing in the document can run, and the frame can still be measured */}
      <iframe ref={ref} title={title} srcDoc={doc} sandbox="allow-same-origin" className="block w-full border-0" style={{ height: h, colorScheme: dark ? 'dark' : 'light' }} />
    </motion.div>
  )
}

/**
 * Chat on the left, a living document on the right. Asking for a change streams the edit into the file: added lines
 * type in highlighted, removed lines strike through and collapse. Toggle Code/Preview (the preview is a sandboxed
 * iframe), step through versions, copy, click or tap a line (or arrow to it and press Enter) to "Ask about line N",
 * or use the suggestion chips. Below 768px chat and document stack, rows grow to finger height on touch, and the
 * document scrolls into view while an edit streams in. A pill shows line count and version.
 */
export function AICanvas({ file = 'pricing-card.html', initial = aiPricingCard(null, false, false), edits = AI_CANVAS_EDITS, explain = aiExplainLine, intro = 'I made a pricing card in the canvas. Ask me to change it, or tap a line of code to ask about it.', className }:
  { file?: string; initial?: string; edits?: CanvasEdit[]; explain?: (n: number, line: string) => string; intro?: string; className?: string }) {
  const reduce = useReducedMotion()
  const [V, setV] = useState([initial])
  const [cur, setCur] = useState(0)
  const [view, setView] = useState<'code' | 'prev'>('code')
  const [msgs, setMsgs] = useState<CvMsg[]>([{ id: 0, role: 'a', text: intro }])
  const [step, setStep] = useState(0)
  const [busy, setBusy] = useState(false)
  const [text, setText] = useState('')
  const [selLine, setSelLine] = useState<{ n: number; top: number } | null>(null)
  const [diff, setDiff] = useState<CvDiff | null>(null)
  const [flash, setFlash] = useState(0)
  const narrow = useMediaQuery('(max-width: 767px)'), docPane = useRef<HTMLDivElement>(null)
  const codeRef = useRef<HTMLDivElement>(null), logRef = useRef<HTMLDivElement>(null), inRef = useRef<HTMLInputElement>(null), alive = useRef(true)
  const Vref = useRef(V); Vref.current = V
  useEffect(() => { alive.current = true; return () => { alive.current = false } }, [])
  useEffect(() => { const el = logRef.current; if (el) el.scrollTop = el.scrollHeight }, [msgs])
  const push = (m: Omit<CvMsg, 'id'>) => { const id = Date.now() + Math.random(); setMsgs(ms => [...ms, { ...m, id }]); return id }
  const patch = (id: number, p: Partial<CvMsg>) => setMsgs(ms => ms.map(m => m.id === id ? { ...m, ...p } : m))
  const streamInto = async (id: number, t: string) => { const w = t.split(' '); for (let i = 1; i <= w.length; i++) { if (!alive.current) return; patch(id, { text: w.slice(0, i).join(' '), stream: i < w.length }); await sleep(reduce ? 0 : 20) } }

  const apply = async (newCode: string) => {
    setView('code'); setSelLine(null)
    // stacked on phones: bring the document into view so the edit can be watched as it streams in
    if (narrow && docPane.current) { const r = docPane.current.getBoundingClientRect(); if (r.top > innerHeight - 160 || r.bottom < 80) docPane.current.scrollIntoView({ block: 'nearest', behavior: reduce ? 'auto' : 'smooth' }) }
    const base = Vref.current[Vref.current.length - 1]
    const lines = aiLineDiff(base.split('\n'), newCode.split('\n'))
    setDiff({ lines, typing: -1, chars: 0, collapsing: false })
    await sleep(60)
    const first = codeRef.current?.querySelector<HTMLElement>('[data-changed]')
    if (first && codeRef.current) codeRef.current.scrollTo({ top: Math.max(0, first.offsetTop - 80), behavior: reduce ? 'auto' : 'smooth' })
    for (let i = 0; i < lines.length; i++) {
      if (lines[i][0] !== '+') continue
      const l = lines[i][1]
      for (let k = 0; k <= l.length; k += 7) { if (!alive.current) return; setDiff(d => d && { ...d, typing: i, chars: k }); if (!reduce) await sleep(6) }
      setDiff(d => d && { ...d, typing: i, chars: Infinity })
      const el = codeRef.current?.querySelector<HTMLElement>(`[data-i="${i}"]`), box = codeRef.current
      if (el && box && el.offsetTop > box.scrollTop + box.clientHeight - 40) box.scrollTop = el.offsetTop - box.clientHeight / 2
    }
    setDiff(d => d && { ...d, typing: lines.length })
    if (!reduce) await sleep(350)
    setDiff(d => d && { ...d, collapsing: true })
    if (!reduce) await sleep(300)
    const nv = [...Vref.current, newCode]; setV(nv); setCur(nv.length - 1); setDiff(null); setFlash(f => f + 1)
    return { add: lines.filter(x => x[0] === '+').length, del: lines.filter(x => x[0] === '-').length, ver: nv.length }
  }

  const send = async (raw: string) => {
    const t = raw.trim(); if (!t || busy) return
    setBusy(true); setText(''); push({ role: 'u', text: t })
    const id = push({ role: 'a', text: '', dots: true })
    await sleep(700); if (!alive.current) return
    const m = t.match(/^explain line (\d+)/i)
    if (m) {
      const n = Number(m[1]), ln = V[cur].split('\n')[n - 1] ?? ''
      patch(id, { dots: false }); await streamInto(id, explain(n, ln)); setBusy(false); return
    }
    const idx = edits.findIndex(e => e.prompt.toLowerCase() === t.toLowerCase()), e = edits[idx >= 0 ? idx : step]
    if (!e) { patch(id, { dots: false, text: `That’s all the demo edits I have. Use the version arrows to step back through v1 to v${V.length}.` }); setBusy(false); return }
    patch(id, { dots: false, tool: { state: 'run', add: 0, del: 0, ver: 0 } })
    const r = await apply(e.code); if (!r || !alive.current) return
    setStep(s => Math.max(s, (idx >= 0 ? idx : step) + 1))
    patch(id, { tool: { state: 'done', ...r } })
    await streamInto(id, e.reply); setBusy(false)
  }

  const shown = V[cur]
  const shownLines = shown.split('\n'), lineCount = shownLines.length
  // code lines are real buttons with one Tab stop: arrows move between lines, Enter or a click opens "Ask about line N"
  const pickLine = (i: number, el?: HTMLElement | null) => {
    if (!el) return
    const top = el.offsetTop - (codeRef.current?.scrollTop ?? 0) + (el.offsetHeight - 20) / 2
    setSelLine(s => s?.n === i + 1 ? null : { n: i + 1, top })
  }
  const lineAt = (i: number) => codeRef.current?.querySelector<HTMLElement>(`[data-line="${i}"]`)
  const roving = useRoving(lineCount, i => pickLine(i, lineAt(i)), { loop: false, onMove: i => lineAt(i)?.focus() })
  let num = 0
  return (
    <div className={cn('grid overflow-hidden md:h-[480px] md:grid-cols-[minmax(260px,340px)_minmax(0,1fr)]', surface.card, className)}>
      <div className="flex min-h-0 min-w-0 flex-col gap-2.5 border-[var(--line)] bg-[color-mix(in_srgb,var(--muted)_35%,var(--card))] p-3 max-md:h-[340px] max-md:border-b md:border-r">
        <div ref={logRef} aria-live="polite" aria-busy={busy} className="flex min-h-0 flex-1 flex-col gap-2.5 overflow-auto p-0.5">
          {msgs.map(m => m.role === 'u'
            ? <motion.div key={m.id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={spring(0.25, 0.35)} className="max-w-[85%] self-end rounded-[14px_14px_4px_14px] bg-[var(--primary)] px-3 py-2 text-[13px] text-[var(--on-primary)]">{m.text}</motion.div>
            : <motion.div key={m.id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={spring(0.25, 0.35)} className="max-w-[95%] text-[13px] leading-normal">
              <div className="mb-1 flex items-center gap-1.5 text-xs font-medium text-[var(--fg3)]"><i className="h-2 w-2 rounded-full bg-[var(--accent)]" />Assistant</div>
              {m.dots && <TypingDots />}
              {m.tool && <div className={cn('mt-1.5 flex flex-wrap items-center gap-2 px-2.5 py-2 text-xs text-[var(--fg2)]', surface.md)}>
                {m.tool.state === 'run' ? <><Spinner size={12} tone="accent" label={`Editing ${file}`} /><span>Editing <b className="font-medium text-[var(--fg)]">{file}</b></span></>
                  : <><Icon name="check" size={12} strokeWidth={3} className="text-[var(--ok)]" /><span>Edited <b className="font-medium text-[var(--fg)]">{file}</b></span>
                    <span className="font-[family-name:var(--mono)] text-[var(--ok)]">+{m.tool.add}</span><span className="font-[family-name:var(--mono)] text-[var(--bad)]">−{m.tool.del}</span><span className="flex-1" />
                    <Button size="sm" variant="ghost" className={cn('!h-6', TOUCH.tap)} onClick={() => { setCur(m.tool!.ver - 1); setView('prev'); if (narrow) docPane.current?.scrollIntoView({ block: 'nearest', behavior: reduce ? 'auto' : 'smooth' }) }}>View v{m.tool.ver}</Button></>}
              </div>}
              {m.text && <div className={cn(m.tool && 'mt-2', m.stream && 'ui-caret')}>{m.text}</div>}
            </motion.div>)}
        </div>
        <div className="flex flex-wrap gap-1.5">
          {!busy && step < edits.length && (
            <motion.span key={step} initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} className="inline-flex">
              <Chip icon="sparkles" onClick={() => send(edits[step].prompt)}>{edits[step].prompt}</Chip>
            </motion.span>
          )}
        </div>
        <div className="flex items-center gap-2 rounded-full border border-[var(--line)] bg-[var(--card)] py-1 pr-1 pl-4 focus-within:border-[var(--fg3)]">
          <input ref={inRef} value={text} onChange={e => setText(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) send(text) }} placeholder="Ask for a change" aria-label="Ask for a change"
            className={cn('h-8 min-w-0 flex-1 border-0 bg-transparent text-[13px] outline-none placeholder:text-[var(--fg3)]', TOUCH.input)} />
          <SendButton onClick={() => send(text)} disabled={busy || !text.trim()} />
        </div>
      </div>

      <div ref={docPane} className="flex min-h-0 min-w-0 flex-col max-md:h-[440px] max-md:scroll-mt-24">
        <div className="flex h-12 flex-none items-center gap-2.5 border-b border-[var(--line)] pr-2.5 pl-3 max-sm:gap-1.5 max-sm:pr-1.5 max-sm:pl-2">
          <span className="flex min-w-0 items-center gap-1.5 text-[13px] font-medium whitespace-nowrap max-sm:hidden"><Icon name="file" size={13} />{file}</span>
          <SegmentedControl size="sm" className="[@media(pointer:coarse)]:[&>button]:min-h-8" options={[{ value: 'code', label: 'Code' }, { value: 'prev', label: 'Preview' }]} value={view} onChange={v => { setView(v as 'code' | 'prev'); setSelLine(null) }} />
          <span className="flex-1" />
          <span className="flex items-center gap-0.5 text-xs text-[var(--fg2)]">
            <IconButton icon="chevronLeft" label="Previous version" className={TOUCH.tap} disabled={cur === 0 || !!diff} onClick={() => { setCur(c => c - 1); setFlash(f => f + 1); setSelLine(null) }} />
            <span className="ui-num w-6 text-center">v{cur + 1}</span>
            <IconButton icon="chevronRight" label="Next version" className={TOUCH.tap} disabled={cur === V.length - 1 || !!diff} onClick={() => { setCur(c => c + 1); setFlash(f => f + 1); setSelLine(null) }} />
          </span>
          <CopyButton text={shown} size="icon-sm" label="Copy code" className={TOUCH.tap} />
        </div>
        <div className="relative min-h-0 flex-1">
          {view === 'code' ? (
            <div ref={codeRef} onScroll={() => setSelLine(null)} className="absolute inset-0 overflow-auto bg-[var(--card)] [contain:inline-size]">
              <motion.pre key={diff ? 'diff' : `v${cur}-${flash}`} initial={diff ? false : { opacity: 0.3 }} animate={{ opacity: 1 }} transition={{ duration: 0.2 }}
                className="m-0 min-w-max pt-3 pb-12 font-[family-name:var(--mono)] text-xs leading-[1.65]" onKeyDown={diff ? undefined : roving.onKeyDown}>
                {diff ? diff.lines.map(([t, l], i) => {
                  const n = t === '-' ? '' : ++num
                  const txt = t === '+' ? (i < diff.typing || diff.chars === Infinity && i === diff.typing ? l : i === diff.typing ? l.slice(0, diff.chars) : '') : l
                  return (
                    <AnimatePresence key={i} initial={false}>
                      {!(t === '-' && diff.collapsing) && (
                        <motion.div data-i={i} data-changed={t !== '=' ? '' : undefined} exit={{ opacity: 0, height: 0 }} transition={{ duration: 0.18 }}
                          className={cn('flex px-3', t === '-' && 'bg-[color-mix(in_srgb,var(--bad)_14%,transparent)] line-through opacity-70', t === '+' && i <= diff.typing && 'bg-[color-mix(in_srgb,var(--ok)_16%,transparent)]')}>
                          <span className="mr-4 w-6 flex-none text-right text-[var(--fg3)] opacity-60 select-none">{n}</span><span className="whitespace-pre">{t === '+' && i === diff.typing && diff.chars !== Infinity ? txt : aiHighlight(txt)}{txt ? '' : ' '}</span>
                        </motion.div>)}
                    </AnimatePresence>
                  )
                }) : shownLines.map((l, i) => (
                  <button key={i} type="button" data-line={i} tabIndex={i === Math.min(roving.active, lineCount - 1) ? 0 : -1} aria-pressed={selLine?.n === i + 1}
                    onFocus={() => roving.setActive(i)} onClick={e => { roving.setActive(i); pickLine(i, e.currentTarget) }}
                    className={cn('flex w-full cursor-pointer border-0 bg-transparent px-3 text-left [font:inherit] text-inherit outline-none [@media(pointer:coarse)]:min-h-8 [@media(pointer:coarse)]:items-center',
                      selLine?.n === i + 1 ? 'bg-[color-mix(in_srgb,var(--accent)_14%,transparent)]' : 'hover:bg-[color-mix(in_srgb,var(--muted)_70%,transparent)] focus-visible:bg-[color-mix(in_srgb,var(--muted)_70%,transparent)] focus-visible:shadow-[inset_2px_0_0_var(--accent)]')}>
                    <span className="mr-4 w-6 flex-none text-right text-[var(--fg3)] opacity-60 select-none">{i + 1}</span><span className="whitespace-pre">{aiHighlight(l)}{l ? '' : ' '}</span>
                  </button>
                ))}
              </motion.pre>
            </div>
          ) : (
            <div className="absolute inset-0 grid place-items-center overflow-auto bg-[var(--bg)] bg-[radial-gradient(circle,var(--line2)_1px,transparent_1.2px)] bg-[length:16px_16px] p-6 max-sm:p-3">
              <AiPreview key={`${cur}-${flash}`} html={shown} title={`Preview of ${file}, version ${cur + 1}`} />
            </div>
          )}
          <AnimatePresence>
            {selLine && view === 'code' && (
              <motion.button key={selLine.n} initial={{ opacity: 0, x: 6 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.18 }}
                style={{ top: selLine.top - 4 }} onClick={() => { const ln = shownLines[selLine.n - 1].trim(); setText(`Explain line ${selLine.n}: ${ln.slice(0, 40)}${ln.length > 40 ? '…' : ''}`); setSelLine(null); inRef.current?.focus() }}
                className="absolute right-4 z-[3] h-7 cursor-pointer rounded-full border border-[var(--line)] bg-[var(--card)] px-2.5 text-xs font-medium shadow-[var(--shadow)] [@media(pointer:coarse)]:-mt-1.5 [@media(pointer:coarse)]:h-10 [@media(pointer:coarse)]:px-3.5 [@media(pointer:coarse)]:text-[13px]">Ask about line {selLine.n}</motion.button>
            )}
          </AnimatePresence>
          <span className="absolute tabular-nums bottom-3 left-3 rounded-full border border-[var(--line)] bg-[var(--card)] px-2.5 py-1 text-[11px] text-[var(--fg3)]">{lineCount} lines · v{cur + 1} of {V.length}</span>
        </div>
      </div>
    </div>
  )
}

/* Agent transit map: geometry ────────────────────────────────────────────── */

type Pt = [number, number]
const AT_W = 1000, AT_H = 720
const AT_R: Pt = [250, 300], AT_P: Pt = [640, 300], AT_F: Pt = [640, 560], AT_LC: Pt = [342, 140], AT_LR = 92
const AT_LINES: Record<string, [string, string]> = { research: ['Research', '#7B78D8'], payments: ['Payments', '#C8603F'], approvals: ['Approvals', '#4A9C78'], evals: ['Evals', '#B07A2E'], memory: ['Memory', '#C45C7C'], index: ['Indexing loop', '#2E9DB0'] }
const AT_C = (k: string) => AT_LINES[k]?.[1] ?? 'var(--fg3)'
const AT_PATH: Record<string, Pt[]> = { research: [[70, 300], AT_R, AT_P, [840, 300]], payments: [[70, 120], AT_R, [250, 360], [450, 560], AT_F, [840, 560]], approvals: [[640, 60], AT_P, AT_F, [640, 690]], evals: [AT_P, [780, 160], [900, 160]], memory: [[250, 50], AT_R] }
const AT_ST: [string, string, Pt, number, number, 'start' | 'middle' | 'end'][] = [['Intake', 'research', [70, 300], 0, 26, 'start'], ['Analyst', 'research', [445, 300], 0, 30, 'middle'], ['Deploy', 'research', [840, 300], 0, 30, 'middle'], ['Search', 'payments', [70, 120], 0, -14, 'start'], ['Pay agent', 'payments', [350, 460], -18, 10, 'end'], ['Ledger', 'payments', [840, 560], 0, 30, 'middle'], ['Human', 'approvals', [640, 60], 20, 5, 'start'], ['Risk', 'approvals', [640, 420], 20, 5, 'start'], ['Audit', 'approvals', [640, 690], 20, 5, 'start'], ['Grader', 'evals', [710, 230], 22, 18, 'start'], ['Evals', 'evals', [900, 160], 0, -16, 'middle'], ['Memory', 'memory', [250, 50], -18, 5, 'end'], ['Recall', 'memory', [250, 210], -18, 5, 'end']]
const AT_LOOPST: [string, number, number, 'start' | 'middle' | 'end', number][] = [['Embed', 0, -14, 'middle', 270], ['Cache', 16, 4, 'start', 0], ['Refresh', 0, 26, 'middle', 90]]
const AT_ZONES: [number, number, number, number, string, string][] = [[40, 30, 520, 210, 'Zone 1 · read', 'br'], [40, 250, 900, 120, 'Zone 2 · write', 'br'], [700, 30, 240, 210, 'Zone 4 · quality', 'tl'], [300, 390, 640, 320, 'Zone 3 · money', 'br']]
const AT_HUBS: [string, Pt, number, number, 'start' | 'end'][] = [['Research', AT_R, 14, -24, 'start'], ['Product', AT_P, -16, -24, 'end'], ['Finance', AT_F, 18, -24, 'start']]
const atSame = (a: Pt, b: Pt) => a[0] === b[0] && a[1] === b[1]
const atCum = Object.fromEntries(Object.entries(AT_PATH).map(([k, pts]) => { const c = [0]; for (let i = 1; i < pts.length; i++) c.push(c[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1])); return [k, c] }))
const atLen = (k: string) => k === 'index' ? 2 * Math.PI * AT_LR : atCum[k][atCum[k].length - 1]
function atPoint(k: string, s: number): { x: number; y: number; a: number } {
  if (k === 'index') { const L = atLen(k), th = Math.PI + (((s % L) + L) % L) / AT_LR; return { x: AT_LC[0] + AT_LR * Math.cos(th), y: AT_LC[1] + AT_LR * Math.sin(th), a: th * 180 / Math.PI + 90 } }
  const pts = AT_PATH[k], c = atCum[k]; s = Math.max(0, Math.min(c[c.length - 1], s))
  let i = 1; while (i < pts.length - 1 && c[i] < s) i++
  const [a, b] = [pts[i - 1], pts[i]], L = c[i] - c[i - 1], t = L ? (s - c[i - 1]) / L : 0
  return { x: a[0] + (b[0] - a[0]) * t, y: a[1] + (b[1] - a[1]) * t, a: Math.atan2(b[1] - a[1], b[0] - a[0]) * 180 / Math.PI }
}
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
const AT_SP: Record<string, Record<string, number>> = {}
AT_ST.forEach(([n, k, pt]) => { (AT_SP[k] ??= {})[n] = atNear(k, pt) })
Object.entries(AT_PATH).forEach(([k, pts]) => AT_HUBS.forEach(([n, pt]) => { if (pts.some(p => atSame(p, pt))) (AT_SP[k] ??= {})[n] = atNear(k, pt) }))
AT_SP.memory.Index = atNear('memory', [AT_LC[0] - AT_LR, AT_LC[1]])

/* Agent transit map: the shared WorkflowEngine (diagrams), on this geometry ─────── */

const AT_HITL_TIMEOUT = 25, AT_QMAX = 8, AT_WIN = 30
/** map units a token covers per simulated second along a line; the Indexing-loop train is slower */
const AT_SPEED = 150, AT_LOOP_SPEED = 70
const AT_LOOP_L = atLen('index')
const atPos = (line: string, station: string): number | undefined => AT_SP[line]?.[station]
/** Where a token is along its line right now: interpolated while it moves, else at its state's station. */
function atTokenS(eng: WorkflowEngine, tk: WorkflowToken) {
  if (tk.move) { const a = atPos(tk.line, tk.move.from) ?? 0, b = atPos(tk.line, tk.move.to) ?? a; return a + (b - a) * eng.progress(tk) }
  return atPos(tk.line, eng.machines[tk.job.type].states[tk.state].at[1]) ?? 0
}
const atXY = (eng: WorkflowEngine, tk: WorkflowToken) => atPoint(tk.line, atTokenS(eng, tk))
const atTranslate = (p: { x: number; y: number }) => `translate(${p.x.toFixed(1)},${p.y.toFixed(1)})`
const atTrainAt = (clock: number) => { const p = atPoint('index', AT_LOOP_L * 0.55 + AT_LOOP_SPEED * clock); return `${atTranslate(p)} rotate(${p.a.toFixed(1)})` }
/**
 * The engine behind the map: travel time follows the drawn distance, the Indexing loop fires the next workflow each
 * time its train completes a lap, Intake fires request.received, agents meter tokens and USD while they work, and
 * human-in-the-loop stations wait 25 s for Approve / Reject before policy approves them.
 */
function atEngine(machines: Record<string, WorkflowMachine>, order: string[]) {
  return new WorkflowEngine(machines, order, {
    speed: 1.5, maxJobs: 3, hitlWait: AT_HITL_TIMEOUT, queueMax: AT_QMAX,
    lap: [(AT_LOOP_L * 0.45) / AT_LOOP_SPEED, AT_LOOP_L / AT_LOOP_SPEED],
    travelTime: (line, from, to) => { const a = atPos(line, from), b = atPos(line, to); return a === undefined || b === undefined ? 0 : Math.abs(b - a) / AT_SPEED },
    meter: { tokens: 900, usd: 0.0011 },
    // jobs that start in Memory are triggered by the Indexing loop; others (Intake) by their own line
    source: t => { const m = machines[t], line = m.states[m.start].at[0]; return line === 'memory' ? 'index' : line },
  })
}
type AtSpark = { id: number; x: number; y: number; text: string; t: number }
type AtFade = { id: number; x: number; y: number; line: string; jid: number; t: number; small: boolean }

// the track is a 6px band painted in the middle, so on touch the input itself can be a 32px target
const AT_RANGE = 'min-w-[90px] max-w-[200px] flex-1'
const AT_JOB_DOT = 'grid h-[18px] w-[18px] flex-none place-items-center rounded-full text-[10px] font-bold text-white [@media(pointer:coarse)]:text-[11px]'
/** A mouse hovering a row follows its job; a click or tap pins it (touch has no hover). Buttons inside keep their own clicks. */
const atFollow = (id: number, setHover: (h: number | null) => void, setPin: (f: (p: number | null) => number | null) => void) => ({
  onPointerEnter: (e: React.PointerEvent) => { if (e.pointerType === 'mouse') setHover(id) },
  onPointerLeave: (e: React.PointerEvent) => { if (e.pointerType === 'mouse') setHover(null) },
  onClick: (e: React.MouseEvent) => { if ((e.target as Element).closest('button')) return; setPin(p => p === id ? null : id) },
})

/**
 * Live multi-agent "transit map", driven by the same WorkflowEngine and AGENT_WORKFLOWS as StateMachine. The Indexing
 * loop and the Intake endpoint fire events into a queue; jobs start as slots free up and walk their state graph
 * station by station. Agents take one job at a time (others queue), orchestrators route with guards, Product forks
 * reviews and joins them, endpoints emit follow-up triggers. Human and Risk stations wait for approval when
 * human-in-the-loop is on. Pause, speed and max-jobs controls, fire-event chips, and a live trace table (time, tokens,
 * USD): hover a row, or press its job button, to follow that job on the map. Moving parts are drawn every frame without
 * re-rendering; the panels refresh about 8 times a second. On phones the map keeps a readable size and scrolls
 * sideways inside the card, as does the trace table. Pass your own `machines` if they use the same stations.
 */
export function AgentTransitMap({ machines = AGENT_WORKFLOWS, order = AGENT_WORKFLOW_ORDER, className }:
  { machines?: Record<string, WorkflowMachine>; order?: string[]; className?: string }) {
  const eng = useMemo(() => atEngine(machines, order), [machines, order])
  const [, setTick] = useState(0)
  const rerender = () => setTick(x => (x + 1) % 1e6)
  const [hovered, setHover] = useState<number | null>(null), [pin, setPin] = useState<number | null>(null)
  const hover = hovered ?? pin // the job being followed on the map
  const { ref: host, visible } = useViewport<HTMLDivElement>(null, { amount: 0 })
  const narrow = useMediaQuery('(max-width: 639px)')
  const [mapScrollRef, mapEdges] = useScrollEdges<HTMLDivElement>()
  const [traceScrollRef, traceEdges] = useScrollEdges<HTMLDivElement>()
  const fx = useRef({ sparks: [] as AtSpark[], fading: [] as AtFade[], hubFlash: [0, 0, 0], evLabel: { text: '', n: 0 }, uid: 0 })
  const tokenEls = useRef(new Map<number, SVGGElement>()), trainEl = useRef<SVGRectElement>(null), since = useRef(0)
  // engine events → the short-lived marks on the map (sparks, fading tokens, hub flashes, the loop's event label)
  useEffect(() => eng.subscribe(ev => {
    const F = fx.current, now = performance.now()
    if (ev.kind === 'queued') {
      if (ev.cause === 'intake') { const q = atPoint('research', AT_SP.research.Intake); F.sparks.push({ id: ++F.uid, x: q.x, y: q.y, text: ev.ev, t: now }) }
      else if (ev.cause !== 'emit') F.evLabel = { text: ev.ev, n: F.evLabel.n + 1 }
    } else if (ev.kind === 'enter') {
      const st = eng.machines[ev.job.type].states[ev.state], hi = st.orch ? AT_HUBS.findIndex(h => h[0] === st.at[1]) : -1
      if (hi >= 0) F.hubFlash[hi]++
    } else if (ev.kind === 'trigger' && ev.ev) {
      const p = atXY(eng, ev.token); F.sparks.push({ id: ++F.uid, x: p.x, y: p.y, text: ev.ev, t: now })
    } else if (ev.kind === 'done') {
      const p = atXY(eng, ev.token); F.fading.push({ id: ev.token.uid, x: p.x, y: p.y, line: ev.token.line, jid: ev.job.id, t: now, small: !!ev.token.parent })
    }
  }), [eng])
  useEffect(() => { // two events to start with, so the map is busy as soon as it is seen
    const t1 = setTimeout(() => eng.fire(), 400), t2 = setTimeout(() => eng.fire(), 2000)
    return () => { clearTimeout(t1); clearTimeout(t2) }
  }, [eng])
  // every frame: step the engine and move the train and tokens straight in the DOM; React re-renders ~8×/s
  useFrameLoop(visible && !eng.paused, dt => {
    eng.tick(dt)
    trainEl.current?.setAttribute('transform', atTrainAt(eng.clock))
    for (const j of eng.jobs) if (!j.done) for (const tk of j.tokens) tokenEls.current.get(tk.uid)?.setAttribute('transform', atTranslate(atXY(eng, tk)))
    if ((since.current += dt) >= 0.125) {
      since.current = 0
      const F = fx.current, now = performance.now()
      F.sparks = F.sparks.filter(s => now - s.t < 1900); F.fading = F.fading.filter(f => now - f.t < 800)
      rerender()
    }
  })
  const F = fx.current
  const hj = hover !== null ? eng.jobs.find(j => j.id === hover) ?? null : null
  const lit = (k: string) => !hj || hj.lines.has(k)
  const dimCls = (on: boolean) => cn('transition-opacity duration-200', !on && 'opacity-15')
  const tokens = eng.jobs.filter(j => !j.done).flatMap(j => j.tokens)
  const intakeType = eng.intake ? eng.typeOf(eng.intake) : undefined
  const chips = [...order, ...(intakeType && !order.includes(intakeType) ? [intakeType] : [])].filter(t => machines[t])

  return (
    <div ref={host} className={cn('flex flex-col', className)}>
      <div className="relative">
      <div ref={mapScrollRef} className={cn(narrow && '-mx-1 overflow-x-auto overscroll-x-contain rounded-[var(--r-md)] px-1 [contain:inline-size] [scrollbar-width:thin]')} tabIndex={narrow ? 0 : undefined} aria-label={narrow ? 'Transit map, scrolls sideways' : undefined}>
      <svg viewBox={`0 0 ${AT_W} ${AT_H}`} role="img" aria-label="Transit map of agent teams" className={cn('block h-auto w-full', narrow && 'min-w-[680px]')}>
        {AT_ZONES.map(([x, y, w, h, l, pos]) => <g key={l}>
          <rect x={x} y={y} width={w} height={h} fill="var(--muted)" stroke="var(--line2)" strokeDasharray="5 4" />
          <text x={pos.includes('l') ? x + 14 : x + w - 14} y={pos.includes('t') ? y + 22 : y + h - 12} textAnchor={pos.includes('l') ? 'start' : 'end'} fill="var(--fg)" style={{ font: '500 12px var(--font)' }}>{l}</text>
        </g>)}
        <g fill="none" strokeWidth={8} strokeLinejoin="round">
          {Object.entries(AT_PATH).map(([k, pts]) => <path key={k} d={'M' + pts.map(p => p.join(',')).join(' L')} stroke={AT_C(k)} className={dimCls(lit(k))} />)}
          <path d={`M${AT_LC[0] - AT_LR},${AT_LC[1]} A${AT_LR},${AT_LR} 0 1,1 ${AT_LC[0] + AT_LR},${AT_LC[1]} A${AT_LR},${AT_LR} 0 1,1 ${AT_LC[0] - AT_LR},${AT_LC[1]}`} stroke={AT_C('index')} className={dimCls(lit('index'))} />
        </g>
        <g>
          {Object.entries(AT_PATH).flatMap(([k, pts]) => [pts[0], pts[pts.length - 1]].filter(p => ![AT_R, AT_P, AT_F].some(h => atSame(h, p))).map((p, i) => {
            const [ux, uy] = atDir(pts, p), nx = -uy, ny = ux
            return <line key={k + i} x1={p[0] - nx * 11} y1={p[1] - ny * 11} x2={p[0] + nx * 11} y2={p[1] + ny * 11} stroke={AT_C(k)} strokeWidth={4} className={dimCls(lit(k))} />
          }))}
          {AT_ST.map(([n, k, pt]) => {
            const pts = AT_PATH[k]; if (atSame(pts[0], pt) || atSame(pts[pts.length - 1], pt)) return null
            const [ux, uy] = atDir(pts, pt); return <line key={n} x1={pt[0]} y1={pt[1]} x2={pt[0] - uy * 10} y2={pt[1] + ux * 10} stroke={AT_C(k)} strokeWidth={3} className={dimCls(lit(k))} />
          })}
          {AT_LOOPST.map(([n, , , , ang]) => { const a = ang * Math.PI / 180; return <line key={n} x1={AT_LC[0] + Math.cos(a) * AT_LR} y1={AT_LC[1] + Math.sin(a) * AT_LR} x2={AT_LC[0] + Math.cos(a) * (AT_LR + 10)} y2={AT_LC[1] + Math.sin(a) * (AT_LR + 10)} stroke={AT_C('index')} strokeWidth={3} className={dimCls(lit('index'))} /> })}
        </g>
        <rect ref={trainEl} x={-12} y={-4} width={24} height={8} rx={4} fill="var(--card)" stroke={AT_C('index')} strokeWidth={2} transform={atTrainAt(eng.clock)} className={dimCls(lit('index'))} />
        <g>
          {F.sparks.map(s => <g key={s.id}>
            <motion.circle cx={s.x} cy={s.y} fill="none" stroke="var(--accent)" strokeWidth={2} initial={{ r: 6, opacity: 1 }} animate={{ r: 26, opacity: 0 }} transition={{ duration: 0.9 }} />
            <motion.text x={s.x} y={s.y - 16} textAnchor="middle" fill="var(--accent)" style={{ font: '600 11px var(--mono)' }} initial={{ opacity: 0, y: 0 }} animate={{ opacity: [0, 1, 1, 0], y: -10 }} transition={{ duration: 1.8 }}>{s.text}</motion.text>
          </g>)}
        </g>
        <g>
          <circle cx={AT_LC[0] - AT_LR} cy={AT_LC[1]} r={10} fill="var(--card)" stroke="var(--fg)" strokeWidth={3.5} />
          {AT_HUBS.map(([n, [x, y]], i) => <g key={n}>
            <circle cx={x} cy={y} r={22} fill="var(--card)" stroke="var(--fg)" strokeWidth={5} />
            {F.hubFlash[i] > 0 && <motion.circle key={F.hubFlash[i]} cx={x} cy={y} r={7} fill="var(--bad)" style={{ transformBox: 'fill-box', transformOrigin: 'center' }} initial={{ opacity: 1, scale: 0.4 }} animate={{ opacity: [1, 1, 0], scale: [0.4, 1.2, 1] }} transition={{ duration: 1 }} />}
          </g>)}
        </g>
        <g>
          {tokens.map(tk => (
            <g key={tk.uid} ref={el => { if (el) tokenEls.current.set(tk.uid, el); else tokenEls.current.delete(tk.uid) }} transform={atTranslate(atXY(eng, tk))} className={dimCls(!hj || hj === tk.job)}>
              <circle r={tk.parent ? 8 : 10} fill={AT_C(tk.line)} stroke="var(--card)" strokeWidth={2.5} />
              <text y={3.6} textAnchor="middle" fill="#fff" style={{ font: '700 10px var(--font)', pointerEvents: 'none' }}>{tk.job.id}</text>
            </g>))}
          {F.fading.map(f => <motion.g key={'f' + f.id} transform={atTranslate(f)} initial={{ opacity: 1 }} animate={{ opacity: 0 }} transition={{ duration: 0.8 }}>
            <circle r={f.small ? 8 : 10} fill={AT_C(f.line)} stroke="var(--card)" strokeWidth={2.5} /><text y={3.6} textAnchor="middle" fill="#fff" style={{ font: '700 10px var(--font)' }}>{f.jid}</text>
          </motion.g>)}
        </g>
        <g style={{ font: '13px var(--font)' }} fill="var(--fg2)">
          {AT_ST.map(([n, , pt, dx, dy, anc]) => <text key={n} x={pt[0] + dx} y={pt[1] + dy} textAnchor={anc}>{n}</text>)}
          {AT_LOOPST.map(([n, dx, dy, anc, ang]) => { const a = ang * Math.PI / 180; return <text key={n} x={AT_LC[0] + Math.cos(a) * AT_LR + dx + Math.cos(a) * 6} y={AT_LC[1] + Math.sin(a) * AT_LR + dy} textAnchor={anc}>{n}</text> })}
          <text x={AT_LC[0] - AT_LR - 18} y={AT_LC[1] + 5} textAnchor="end" fill="var(--fg)" fontWeight={600}>Index</text>
          {AT_HUBS.map(([n, [x, y], dx, dy, anc]) => <text key={n} x={x + dx} y={y + dy} textAnchor={anc} fill="var(--fg)" style={{ font: '600 15px var(--font)' }}>{n}</text>)}
          {F.evLabel.text && <motion.text key={F.evLabel.n} x={AT_LC[0]} y={AT_LC[1] + 5} textAnchor="middle" style={{ font: '600 11px var(--mono)' }} initial={{ opacity: 0 }} animate={{ opacity: [0, 1, 1, 0.35] }} transition={{ duration: 1.6 }}>{F.evLabel.text}</motion.text>}
        </g>
      </svg>
      </div>
      {narrow && <ScrollEdges {...mapEdges} hint="Swipe the map" />}
      </div>

      <div className="mt-1.5 mb-3 flex flex-wrap justify-center gap-x-5 gap-y-2 text-[13px] text-[var(--fg2)] max-sm:justify-start max-sm:gap-x-4">
        {Object.values(AT_LINES).map(([n, c]) => <span key={n} className="inline-flex items-center gap-2"><i className="inline-block h-[7px] w-5 rounded-[2px]" style={{ background: c }} />{n}</span>)}
        <span className="inline-flex items-center gap-2"><i className="inline-block h-2.5 w-2.5 rounded-full bg-[var(--bad)]" />Routing decision</span>
        <span className="inline-flex items-center gap-2"><i className="inline-block h-3 w-3 rounded-full bg-[var(--card)] shadow-[inset_0_0_0_2.5px_var(--fg)]" />Orchestrator</span>
        <span className="inline-flex items-center gap-2"><i className="inline-block h-3.5 w-3.5 rounded-full bg-[var(--fg2)]" />Job (numbered, matches the trace)</span>
      </div>

      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 pb-3 text-xs text-[var(--fg2)]">
        <IconButton size="icon" variant="default" tone="default" label={eng.paused ? 'Play' : 'Pause'} icon={<Icon name={eng.paused ? 'play' : 'pause'} size={14} filled />} onClick={() => { eng.paused = !eng.paused; rerender() }} />
        <label className="contents"><span>Speed</span><Slider min={0.25} max={3} step={0.25} value={eng.speed} onChange={v => { eng.speed = v; rerender() }} className={AT_RANGE} /></label>
        <span className="ui-num w-9">{eng.speed}×</span>
        <span className="contents [@media(pointer:coarse)]:[&>label]:min-h-8"><Switch checked={eng.hitl} onChange={v => { eng.setHitl(v); rerender() }} label={<span className="mr-1">Human in the loop</span>} /></span>
        <label className="contents"><span className="ml-2 max-sm:ml-0">Max jobs</span><Slider min={1} max={6} step={1} value={eng.maxJobs} onChange={v => { eng.maxJobs = v; rerender() }} className={AT_RANGE} /></label>
        <span className="ui-num w-3.5">{eng.maxJobs}</span>
        <span className="flex-1 max-sm:hidden" />
        <span className="max-sm:basis-full">Fire event</span>
        <span className="flex flex-wrap gap-1.5">{chips.map(t => (
          <Chip key={t} onClick={() => { eng.fire(t); rerender() }} className="!h-7 font-[family-name:var(--mono)] !text-[11px] !font-normal [@media(pointer:coarse)]:!h-9">{machines[t].event}</Chip>))}</span>
      </div>

      <div className="flex min-h-[30px] flex-wrap items-center gap-1.5 pb-3 text-xs">
        <span className="mr-1 text-[var(--fg2)]">Queue</span>
        <AnimatePresence initial={false}>
          {eng.queue.map(q => <motion.span key={q.id} layout initial={{ opacity: 0, scale: 0.8 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.8 }} transition={spring(0.4, 0.3)} title={`from ${q.from}`}
            className="inline-flex h-6 items-center gap-1.5 rounded-full border border-[var(--line)] bg-[var(--card)] pr-2.5 pl-2 font-[family-name:var(--mono)] text-[11px]"><i className="h-2 w-2 rounded-full" style={{ background: AT_C(q.from) }} />{q.ev}</motion.span>)}
        </AnimatePresence>
        {!eng.queue.length && <span className="text-[var(--fg3)]">empty</span>}
        {eng.dropped > 0 && <span className="text-[var(--fg3)]">{eng.dropped} dropped</span>}
      </div>

      <Collapse open={eng.waiting.length > 0}>
        <div className="mb-3 flex flex-col gap-1.5 rounded-[var(--r-lg)] border border-[color-mix(in_srgb,var(--warn)_40%,var(--line))] bg-[color-mix(in_srgb,var(--warn)_6%,var(--card))] p-2.5">
          <div className="flex items-baseline gap-2 px-1 text-[13px]" aria-live="polite"><b className="font-semibold">Needs your approval</b><span className="text-xs text-[var(--fg3)]">{eng.waiting.length} waiting · auto-approves after {AT_HITL_TIMEOUT}s</span></div>
          <AnimatePresence initial={false}>
            {eng.waiting.map(tk => { const st = machines[tk.job.type].states[tk.state], amount = Number(tk.job.data.amount) || 0; return (
              <motion.div key={tk.uid} layout initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, height: 0 }} transition={spring(0.3, 0.35)}
                {...atFollow(tk.job.id, setHover, setPin)}
                className={cn('flex flex-wrap items-center gap-x-2.5 gap-y-1.5 rounded-[var(--r-md)] border bg-[var(--card)] py-1.5 pr-1.5 pl-2.5 text-[13px] [@media(pointer:coarse)]:[&>button]:min-h-9', hover === tk.job.id ? 'border-[var(--fg3)]' : 'border-[var(--line)]')}>
                <span className={AT_JOB_DOT} style={{ background: `color-mix(in srgb, ${AT_C(tk.line)} 70%, #000)` }}>{tk.job.id}</span>
                <div className="flex min-w-0 flex-1 basis-[140px] flex-col"><b className="truncate font-medium">{tk.job.name}</b><span className="truncate text-xs text-[var(--fg3)]">{st.label}{amount ? ` · CHF ${amount.toLocaleString(LOCALE)}` : ''}</span></div>
                <span className={cn('ui-num text-xs', tk.t < 6 ? 'text-[var(--warn)]' : 'text-[var(--fg3)]')}>{Math.ceil(tk.t)}s</span>
                <Button size="sm" className="max-sm:ml-auto" onClick={() => { eng.resolve(tk, 'reject'); setHover(null); setPin(null); rerender() }}>Reject</Button>
                <Button size="sm" variant="primary" onClick={() => { eng.resolve(tk, 'approve'); setHover(null); setPin(null); rerender() }}>Approve</Button>
              </motion.div>) })}
          </AnimatePresence>
        </div>
      </Collapse>

      <div className="relative border-t border-[var(--line)]">
      <div ref={traceScrollRef} className="overflow-x-auto overscroll-x-contain [contain:inline-size]" tabIndex={narrow ? 0 : undefined} aria-label={narrow ? 'Trace table, scrolls sideways' : undefined}>
        <div className="min-w-[640px]">
          <div className="grid h-9 grid-cols-[minmax(150px,26%)_1fr_64px_64px_72px] items-center gap-3 border-b border-[var(--line)] text-xs text-[var(--fg3)]">
            <span className="sticky left-0 z-[1] bg-[var(--card)] text-sm font-semibold text-[var(--fg)]">Trace</span>
            <span className="relative h-full font-[family-name:var(--mono)] text-[11px]"><span className="absolute top-2.5 left-0">−{AT_WIN}s</span><span className="absolute top-2.5 left-1/2 -translate-x-1/2">−{AT_WIN / 2}s</span><span className="absolute top-2.5 right-0">now</span></span>
            <span className="text-right font-[family-name:var(--mono)]">time</span><span className="text-right font-[family-name:var(--mono)]">tokens</span><span className="text-right font-[family-name:var(--mono)]">USD</span>
          </div>
          <div className="min-h-[42px]">
            {/* rows only fade in and out (no layout animation): they re-render 8 times a second */}
            <AnimatePresence initial={false}>
              {eng.jobs.map(j => {
                const t0 = eng.clock - AT_WIN
                const cur = j.done ? (j.rejected ? 'rejected' : 'done') : j.tokens.length > 1 ? `${j.tokens.length - 1} in review` : (machines[j.type].states[j.state]?.label ?? j.state)
                return (
                  <motion.div key={j.id} initial={{ opacity: 0, y: -6 }} animate={{ opacity: j.done ? 0.6 : 1, y: 0 }} exit={{ opacity: 0 }} transition={spring(0.25, 0.35)}
                    {...atFollow(j.id, setHover, setPin)}
                    className={cn('grid h-[42px] cursor-pointer grid-cols-[minmax(150px,26%)_1fr_64px_64px_72px] items-center gap-3 border-b border-[var(--line)] text-[13px] hover:bg-[color-mix(in_srgb,var(--muted)_60%,transparent)]', hover === j.id && 'bg-[color-mix(in_srgb,var(--muted)_60%,transparent)]')}>
                    <div className="sticky left-0 z-[1] flex min-w-0 items-center gap-2 bg-[var(--card)] whitespace-nowrap max-sm:shadow-[6px_0_6px_-6px_rgba(0,0,0,.25)]">
                      <button type="button" aria-pressed={pin === j.id} aria-label={`Follow job ${j.id}, ${j.name}, on the map`} onClick={() => setPin(p => p === j.id ? null : j.id)}
                        className={cn(AT_JOB_DOT, TOUCH.hit, 'cursor-pointer border-0 transition-[background] duration-300 [text-shadow:0_0_2px_rgba(0,0,0,.55)]')} style={{ background: `color-mix(in srgb, ${AT_C(j.tokens[0]?.line ?? 'memory')} 70%, #000)` }}>{j.id}</button>
                      <span className="min-w-0 truncate">{j.name}</span>
                      <span className={cn('min-w-0 truncate text-[11px]', j.done ? 'text-[var(--ok)]' : 'text-[var(--fg3)]')}>{cur}</span>
                    </div>
                    <div className="relative h-3.5">
                      {j.segs.filter(s => (s.t1 ?? eng.clock) > t0).map((s, k) => { const a = Math.max(s.t0, t0), b = s.t1 ?? eng.clock, c = AT_C(s.line); return (
                        <span key={k} title={s.label} className={cn('absolute rounded', s.sub ? 'top-[3px] h-2 opacity-80' : 'top-0 h-3.5', s.kind === 'move' && 'opacity-45', s.kind === 'wait' && 'opacity-90')}
                          style={{ left: `${((a - t0) / AT_WIN) * 100}%`, width: `${Math.max(0.3, ((b - a) / AT_WIN) * 100)}%`, background: s.kind === 'wait' ? `repeating-linear-gradient(135deg, ${c} 0 3px, transparent 3px 7px)` : c }} />) })}
                    </div>
                    <span className="text-right font-[family-name:var(--mono)] text-xs">{((j.t1 ?? eng.clock) - j.t0).toFixed(1)}s</span>
                    <span className="text-right font-[family-name:var(--mono)] text-xs">{(j.usage.tokens / 1000).toFixed(1)}k</span>
                    <span className="text-right font-[family-name:var(--mono)] text-xs">{fmt.usd(j.usage.usd)}</span>
                  </motion.div>
                )
              })}
            </AnimatePresence>
          </div>
        </div>
      </div>
      {narrow && <ScrollEdges left={false} right={traceEdges.right} touched={traceEdges.touched} hint="Swipe the trace" />}
      </div>
    </div>
  )
}
