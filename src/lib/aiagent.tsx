import { Fragment, memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from 'react'
import { AnimatePresence, cubicBezier, motion, useReducedMotion } from 'motion/react'
import { flushSync } from 'react-dom'
import { Badge, Button, Chip, FONT_CSS, Icon, IconButton, Spinner, TOUCH, cn, defineMessages, ScrollEdges, sleep, spring, surface, themeCSS, useLocale, useMediaQuery, useMessages, useRoving, useScrollEdges, useTheme, useWidth } from './core'
import { CopyButton, TypingDots } from './feedback'
import { SegmentedControl, Slider, Switch } from './forms'
import { SendButton } from './ai'
import { lcsDiff } from './code'
import { WorkflowEngine, type WorkflowJob, type WorkflowMachine, type WorkflowToken } from './statechart'
import { useFrameLoop, useViewport } from './motion'

/* ════════════════════════════════════════════════════════════════════════════
 * 11c. AI WORKSPACES: the canvas (chat + living document) and the agent transit map
 * In RTL the chat and the panels mirror; the canvas's code and the transit map's drawing (and the trace's time strips)
 * stay left to right, because they are geometry, with their labels translated.
 * ══════════════════════════════════════════════════════════════════════════ */

/** AICanvas strings (machine-drafted de/ar). */
export const AI_CANVAS_MESSAGES = defineMessages('aiCanvas', {
  en: {
    explain: 'Line {n, number} is part of the document’s {kind, select, styles {styles} other {markup}}. Ask me to change it and I’ll edit it in place.',
    failed: 'Something went wrong. Try again.', noChange: 'No change.', noMoreEdits: 'I have no more edits. Use the version arrows to step back through v1 to v{n, number}.',
    cantEdit: 'I can’t edit this document yet.', assistant: 'Assistant', editing: 'Editing {file}', edited: 'Edited {file}', viewVersion: 'View v{n, number}',
    askChange: 'Ask for a change', code: 'Code', preview: 'Preview', prevVersion: 'Previous version', nextVersion: 'Next version', version: 'v{n, number}',
    copyCode: 'Copy code', emptyDoc: 'Nothing here yet. Ask for something and it will appear here.', previewOf: 'Preview of {file}, version {n, number}',
    scrollMore: 'Scroll for more', askLine: 'Ask about line {n, number}', explainLine: 'Explain line {n, number}: {text}',
    status: '{lines, plural, one {# line} other {# lines}} · v{cur, number} of {total, number}',
  },
  de: {
    explain: 'Zeile {n, number} gehört zu {kind, select, styles {den Stilen} other {dem Markup}} des Dokuments. Bitte mich um eine Änderung, dann bearbeite ich sie direkt.',
    failed: 'Etwas ist schiefgelaufen. Versuch es noch einmal.', noChange: 'Keine Änderung.', noMoreEdits: 'Ich habe keine weiteren Änderungen. Mit den Versionspfeilen kommst du zurück von v1 bis v{n, number}.',
    cantEdit: 'Dieses Dokument kann ich noch nicht bearbeiten.', assistant: 'Assistent', editing: 'Bearbeite {file}', edited: '{file} bearbeitet', viewVersion: 'v{n, number} ansehen',
    askChange: 'Um eine Änderung bitten', code: 'Code', preview: 'Vorschau', prevVersion: 'Vorige Version', nextVersion: 'Nächste Version', version: 'v{n, number}',
    copyCode: 'Code kopieren', emptyDoc: 'Noch leer. Bitte um etwas, dann erscheint es hier.', previewOf: 'Vorschau von {file}, Version {n, number}',
    scrollMore: 'Für mehr scrollen', askLine: 'Zu Zeile {n, number} fragen', explainLine: 'Erkläre Zeile {n, number}: {text}',
    status: '{lines, plural, one {# Zeile} other {# Zeilen}} · v{cur, number} von {total, number}',
  },
  ar: {
    explain: 'السطر {n, number} جزء من {kind, select, styles {أنماط} other {ترميز}} المستند. اطلب مني تغييره وسأعدّله في مكانه.',
    failed: 'حدث خطأ ما. حاول مجددًا.', noChange: 'لا تغيير.', noMoreEdits: 'لا تعديلات أخرى لديّ. استخدم أسهم الإصدارات للرجوع من v1 إلى v{n, number}.',
    cantEdit: 'لا يمكنني تعديل هذا المستند بعد.', assistant: 'المساعد', editing: 'جارٍ تعديل {file}', edited: 'عُدّل {file}', viewVersion: 'عرض v{n, number}',
    askChange: 'اطلب تغييرًا', code: 'الشيفرة', preview: 'معاينة', prevVersion: 'الإصدار السابق', nextVersion: 'الإصدار التالي', version: 'v{n, number}',
    copyCode: 'نسخ الشيفرة', emptyDoc: 'لا شيء هنا بعد. اطلب شيئًا وسيظهر هنا.', previewOf: 'معاينة {file}، الإصدار {n, number}',
    scrollMore: 'مرّر للمزيد', askLine: 'اسأل عن السطر {n, number}', explainLine: 'اشرح السطر {n, number}: {text}',
    status: '{lines, plural, zero {لا أسطر} one {سطر واحد} two {سطران} few {# أسطر} many {# سطرًا} other {# سطر}} · v{cur, number} من {total, number}',
  },
})

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

/* AI canvas ──────────────────────────────────────────────────────────────── */

export type CanvasEdit = { prompt: string; reply: string; code: string }
/** The default explainer: says whether a line is style or markup. */
const aiExplainKind = (ln: string) => /[{}]|:\s/.test(ln) ? 'styles' : 'markup'
/** What AICanvas's `respond` may return: an edit to stream in (`code` is the whole new document), a plain reply, or nothing. */
export type CanvasReply = { reply: string; code?: string } | string | null | undefined

type CvMsg = { id: number; role: 'u' | 'a'; text: string; tool?: { state: 'run' | 'done'; add: number; del: number; ver: number }; dots?: boolean; stream?: boolean }
type CvDiff = { lines: ['=' | '+' | '-', string][]; typing: number; chars: number; collapsing: boolean }

const AI_NO_EDITS: CanvasEdit[] = [], AI_CANVAS_SLOT = '\u0000'
/** A translated "Editing {file}" with the file name in bold. */
const aiCanvasBold = (s: string, file: string) => { const i = s.indexOf(AI_CANVAS_SLOT); return i < 0 ? s : <>{s.slice(0, i)}<b className="font-medium text-[var(--fg)]">{file}</b>{s.slice(i + 1)}</> }

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

/**
 * Chat on the left, a living document on the right. Asking for a change streams the edit into the file: added lines
 * type in highlighted, removed lines strike through and collapse. Toggle Code/Preview (the preview is a sandboxed
 * iframe), step through versions, copy, click or tap a line (or arrow to it and press Enter) to "Ask about line N",
 * or use the suggestion chips. Below 768px chat and document stack, rows grow to finger height on touch, and the
 * document scrolls into view while an edit streams in. A pill shows line count and version. The preview loads nothing
 * remote (CSP in the frame); `allowRemote` lets https images in. Starts empty: pass `initial`, and either `respond`
 * (your model: return the new document and a reply) or scripted `edits` (matched by prompt, else offered in order).
 * The showcase content is `AI_CANVAS_SAMPLE` in `@lyndon/ui/examples`.
 */
export function AICanvas({ file = 'untitled.html', initial = '', edits = AI_NO_EDITS, respond, explain: explainProp, intro, allowRemote = false, className }:
  { file?: string; initial?: string; edits?: CanvasEdit[]; respond?: (prompt: string, code: string) => CanvasReply | Promise<CanvasReply>; explain?: (n: number, line: string) => string; intro?: string; allowRemote?: boolean; className?: string }) {
  const reduce = useReducedMotion()
  const t = useMessages(AI_CANVAS_MESSAGES)
  const explain = explainProp ?? ((n: number, ln: string) => t('explain', { n, kind: aiExplainKind(ln) }))
  const asked = useRef<{ text: string; n: number } | null>(null) // the "Ask about line N" prompt, so a translated one still explains
  const [V, setV] = useState([initial])
  const [cur, setCur] = useState(0)
  const [view, setView] = useState<'code' | 'prev'>('code')
  const [msgs, setMsgs] = useState<CvMsg[]>(intro ? [{ id: 0, role: 'a', text: intro }] : [])
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
    const q = raw.trim(); if (!q || busy) return
    setBusy(true); setText(''); push({ role: 'u', text: q })
    const id = push({ role: 'a', text: '', dots: true })
    await sleep(700); if (!alive.current) return
    const m = q.match(/^explain line (\d+)/i), ask = asked.current?.text === q ? asked.current.n : null
    asked.current = null
    if (m || ask) {
      const n = ask ?? Number(m![1]), ln = V[cur].split('\n')[n - 1] ?? ''
      patch(id, { dots: false }); await streamInto(id, explain(n, ln)); setBusy(false); return
    }
    if (respond) {
      let r: CanvasReply
      try { r = await respond(q, V[V.length - 1]) } catch { r = t('failed') }
      if (!alive.current) return
      const reply = typeof r === 'string' ? r : r?.reply ?? ''
      if (r && typeof r === 'object' && typeof r.code === 'string') {
        patch(id, { dots: false, tool: { state: 'run', add: 0, del: 0, ver: 0 } })
        const done = await apply(r.code); if (!done || !alive.current) return
        patch(id, { tool: { state: 'done', ...done } })
      } else patch(id, { dots: false })
      await streamInto(id, reply || t('noChange')); setBusy(false); return
    }
    const idx = edits.findIndex(e => e.prompt.toLowerCase() === q.toLowerCase()), e = edits[idx >= 0 ? idx : step]
    if (!e) { patch(id, { dots: false, text: V.length > 1 ? t('noMoreEdits', { n: V.length }) : t('cantEdit') }); setBusy(false); return }
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
  const [edgeRef, edges] = useScrollEdges<HTMLDivElement>()
  const empty = !shown && !diff
  let num = 0
  return (
    <div className={cn('grid overflow-hidden md:h-[480px] md:grid-cols-[minmax(260px,340px)_minmax(0,1fr)]', surface.card, className)}>
      <div className="flex min-h-0 min-w-0 flex-col gap-2.5 border-[var(--line)] bg-[color-mix(in_srgb,var(--muted)_35%,var(--card))] p-3 max-md:h-[340px] max-md:border-b md:border-e">
        <div ref={logRef} aria-live="polite" aria-busy={busy} className="flex min-h-0 flex-1 flex-col gap-2.5 overflow-auto p-0.5">
          {msgs.map(m => m.role === 'u'
            ? <motion.div key={m.id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={spring(0.25, 0.35)} dir="auto" className="max-w-[85%] self-end rounded-[14px] rounded-ee-[4px] bg-[var(--primary)] px-3 py-2 text-[13px] text-[var(--on-primary)]">{m.text}</motion.div>
            : <motion.div key={m.id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={spring(0.25, 0.35)} className="max-w-[95%] text-[13px] leading-normal">
              <div className="mb-1 flex items-center gap-1.5 text-xs font-medium text-[var(--fg3)]"><i className="h-2 w-2 rounded-full bg-[var(--accent)]" />{t('assistant')}</div>
              {m.dots && <TypingDots />}
              {m.tool && <div className={cn('mt-1.5 flex flex-wrap items-center gap-2 px-2.5 py-2 text-xs text-[var(--fg2)]', surface.md)}>
                {m.tool.state === 'run' ? <><Spinner size={12} tone="accent" label={t('editing', { file })} /><span>{aiCanvasBold(t('editing', { file: AI_CANVAS_SLOT }), file)}</span></>
                  : <><Icon name="check" size={12} strokeWidth={3} className="text-[var(--ok)]" /><span>{aiCanvasBold(t('edited', { file: AI_CANVAS_SLOT }), file)}</span>
                    <span dir="ltr" className="font-[family-name:var(--mono)] text-[var(--ok)]">+{m.tool.add}</span><span dir="ltr" className="font-[family-name:var(--mono)] text-[var(--bad)]">−{m.tool.del}</span><span className="flex-1" />
                    <Button size="sm" variant="ghost" className={cn('!h-6', TOUCH.tap)} onClick={() => { setCur(m.tool!.ver - 1); setView('prev'); if (narrow) docPane.current?.scrollIntoView({ block: 'nearest', behavior: reduce ? 'auto' : 'smooth' }) }}>{t('viewVersion', { n: m.tool.ver })}</Button></>}
              </div>}
              {m.text && <div dir="auto" className={cn(m.tool && 'mt-2', m.stream && 'ui-caret')}>{m.text}</div>}
            </motion.div>)}
        </div>
        <div className="flex flex-wrap gap-1.5">
          {!busy && step < edits.length && (
            <motion.span key={step} initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} className="inline-flex">
              <Chip icon="sparkles" onClick={() => send(edits[step].prompt)}><span dir="auto">{edits[step].prompt}</span></Chip>
            </motion.span>
          )}
        </div>
        <div className="flex items-center gap-2 rounded-full border border-[var(--line)] bg-[var(--card)] py-1 pe-1 ps-4 focus-within:border-[var(--fg3)]">
          <input ref={inRef} value={text} onChange={e => setText(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) send(text) }} dir="auto" placeholder={t('askChange')} aria-label={t('askChange')}
            className={cn('h-8 min-w-0 flex-1 border-0 bg-transparent text-[13px] outline-none placeholder:text-[var(--fg3)]', TOUCH.input)} />
          <SendButton onClick={() => send(text)} disabled={busy || !text.trim()} />
        </div>
      </div>

      <div ref={docPane} className="flex min-h-0 min-w-0 flex-col max-md:h-[440px] max-md:scroll-mt-24">
        <div className="flex h-12 flex-none items-center gap-2.5 border-b border-[var(--line)] pe-2.5 ps-3 max-sm:gap-1.5 max-sm:pe-1.5 max-sm:ps-2">
          <span className="flex min-w-0 items-center gap-1.5 text-[13px] font-medium whitespace-nowrap max-sm:hidden"><Icon name="file" size={13} />{file}</span>
          <SegmentedControl size="sm" className="[@media(pointer:coarse)]:[&>button]:min-h-8" options={[{ value: 'code', label: t('code') }, { value: 'prev', label: t('preview') }]} value={view} onChange={v => { setView(v as 'code' | 'prev'); setSelLine(null) }} />
          <span className="flex-1" />
          <span className="flex items-center gap-0.5 text-xs text-[var(--fg2)]">
            <IconButton icon={<Icon name="chevronLeft" size={14} className="ui-flip" />} label={t('prevVersion')} className={TOUCH.tap} disabled={cur === 0 || !!diff} onClick={() => { setCur(c => c - 1); setFlash(f => f + 1); setSelLine(null) }} />
            <span className="ui-num w-6 text-center">{t('version', { n: cur + 1 })}</span>
            <IconButton icon={<Icon name="chevronRight" size={14} className="ui-flip" />} label={t('nextVersion')} className={TOUCH.tap} disabled={cur === V.length - 1 || !!diff} onClick={() => { setCur(c => c + 1); setFlash(f => f + 1); setSelLine(null) }} />
          </span>
          <CopyButton text={shown} size="icon-sm" label={t('copyCode')} className={TOUCH.tap} />
        </div>
        <div className="relative min-h-0 flex-1">
          {empty ? (
            <div className="absolute inset-0 grid place-items-center bg-[var(--card)] p-6 text-center text-[13px] text-[var(--fg3)]">
              <span><Icon name="file" size={18} className="mx-auto mb-2 block" />{t('emptyDoc')}</span>
            </div>
          ) : view === 'code' ? (
            <div ref={el => { codeRef.current = el; edgeRef(el) }} dir="ltr" onScroll={() => setSelLine(null)} className="absolute inset-0 overflow-auto overscroll-x-contain bg-[var(--card)] [contain:inline-size]">
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
                          <span className="me-4 w-6 flex-none text-end text-[var(--fg3)] select-none">{n}</span><span className="whitespace-pre">{t === '+' && i === diff.typing && diff.chars !== Infinity ? txt : aiHighlight(txt)}{txt ? '' : ' '}</span>
                        </motion.div>)}
                    </AnimatePresence>
                  )
                }) : shownLines.map((l, i) => (
                  <button key={i} type="button" data-line={i} tabIndex={i === Math.min(roving.active, lineCount - 1) ? 0 : -1} aria-pressed={selLine?.n === i + 1}
                    onFocus={() => roving.setActive(i)} onClick={e => { roving.setActive(i); pickLine(i, e.currentTarget) }}
                    className={cn('flex w-full cursor-pointer border-0 bg-transparent px-3 text-start [font:inherit] text-inherit outline-none [@media(pointer:coarse)]:min-h-8 [@media(pointer:coarse)]:items-center',
                      selLine?.n === i + 1 ? 'bg-[color-mix(in_srgb,var(--accent)_14%,transparent)]' : 'hover:bg-[color-mix(in_srgb,var(--muted)_70%,transparent)] focus-visible:bg-[color-mix(in_srgb,var(--muted)_70%,transparent)] focus-visible:shadow-[inset_2px_0_0_var(--accent)]')}>
                    <span className="me-4 w-6 flex-none text-end text-[var(--fg3)] select-none">{i + 1}</span><span className="whitespace-pre">{aiHighlight(l)}{l ? '' : ' '}</span>
                  </button>
                ))}
              </motion.pre>
            </div>
          ) : (
            <div className="absolute inset-0 bg-[var(--bg)] bg-[radial-gradient(circle,var(--line2)_1px,transparent_1.2px)] bg-[length:16px_16px]">
              <AiPreview key={`${cur}-${flash}`} html={shown} allowRemote={allowRemote} title={t('previewOf', { file, n: cur + 1 })} />
            </div>
          )}
          {view === 'code' && !empty && <ScrollEdges {...edges} at="top" hint={t('scrollMore')} />}
          <AnimatePresence>
            {selLine && view === 'code' && (
              <motion.button key={selLine.n} dir="ltr" initial={{ opacity: 0, x: 6 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.18 }}
                style={{ top: selLine.top - 4 }} onClick={() => { const ln = shownLines[selLine.n - 1].trim(), q = t('explainLine', { n: selLine.n, text: ln.slice(0, 40) + (ln.length > 40 ? '…' : '') }); asked.current = { text: q, n: selLine.n }; setText(q); setSelLine(null); inRef.current?.focus() }}
                className="absolute end-4 z-[3] h-7 cursor-pointer rounded-full border border-[var(--line)] bg-[var(--card)] px-2.5 text-xs font-medium shadow-[var(--shadow)] [@media(pointer:coarse)]:-mt-1.5 [@media(pointer:coarse)]:h-10 [@media(pointer:coarse)]:px-3.5 [@media(pointer:coarse)]:text-[13px]"><span dir="auto">{t('askLine', { n: selLine.n })}</span></motion.button>
            )}
          </AnimatePresence>
          <Badge size="sm" className="absolute bottom-3 start-3 border border-[var(--line)] !bg-[var(--card)] font-normal tabular-nums !text-[var(--fg3)]">{t('status', { lines: lineCount, cur: cur + 1, total: V.length })}</Badge>
        </div>
      </div>
    </div>
  )
}

/* Agent transit map: geometry ────────────────────────────────────────────── */

/** AgentTransitMap strings: its line, station, hub and zone names and its panels (machine-drafted de/ar). */
export const TRANSIT_MESSAGES = defineMessages('transit', {
  en: {
    research: 'Research', payments: 'Payments', approvals: 'Approvals', evals: 'Evals', memory: 'Memory', index: 'Indexing loop',
    Intake: 'Intake', Analyst: 'Analyst', Deploy: 'Deploy', Search: 'Search', 'Pay agent': 'Pay agent', Ledger: 'Ledger', Human: 'Human', Risk: 'Risk', Audit: 'Audit',
    Grader: 'Grader', Evals: 'Evals', Memory: 'Memory', Recall: 'Recall', Embed: 'Embed', Cache: 'Cache', Refresh: 'Refresh', Index: 'Index', Research: 'Research',
    Product: 'Product', Finance: 'Finance', zoneRead: 'Zone 1 · read', zoneWrite: 'Zone 2 · write', zoneQuality: 'Zone 4 · quality', zoneMoney: 'Zone 3 · money',
    needsApproval: '{name} needs your approval', policyTimeout: 'Approved by policy when it runs out', secs: '{n}s', reject: 'Reject', approve: 'Approve',
    moreWaiting: '+{n, number} more waiting', noApprovals: 'No approvals waiting', mapScrolls: 'Transit map, scrolls sideways', mapLabel: 'Transit map of agent teams',
    queueLabel: 'Event queue, {n, number} waiting', queue: 'Event queue', emptyQueue: 'empty', more: '+{n, number} more', jobs: '{n, number}/{max, number} jobs',
    dropped: ' · {n, number} dropped', swipeMap: 'Swipe the map', waitingSr: '{n, plural, one {# waiting for your approval} other {# waiting for your approval}}',
    routing: 'Routing decision', orchestrator: 'Orchestrator', job: 'Job (numbered, matches the trace)', queued: 'Queued for a busy agent', congestion: 'Congestion',
    waiting: 'Waiting for approval', play: 'Play', pause: 'Pause', speed: 'Speed', hitl: 'Human in the loop', maxJobs: 'Max jobs', fire: 'Fire event',
    traceScrolls: 'Trace table, scrolls sideways', trace: 'Trace', ago: '−{n, number}s', now: 'now', time: 'time', tokens: 'tokens', usd: 'USD',
    jobsAppear: 'Jobs appear here as they start.', rejected: 'rejected', done: 'done', inReview: '{n, number} in review', waitingFor: 'waiting for {station}',
    follow: 'Follow job {id}, {name}, on the map', swipeTrace: 'Swipe the trace',
  },
  de: {
    research: 'Recherche', payments: 'Zahlungen', approvals: 'Freigaben', evals: 'Evaluierung', memory: 'Gedächtnis', index: 'Indexierungsschleife',
    Intake: 'Eingang', Analyst: 'Analyst', Deploy: 'Deployment', Search: 'Suche', 'Pay agent': 'Zahl-Agent', Ledger: 'Hauptbuch', Human: 'Mensch', Risk: 'Risiko', Audit: 'Prüfung',
    Grader: 'Bewerter', Evals: 'Evals', Memory: 'Gedächtnis', Recall: 'Abruf', Embed: 'Einbetten', Cache: 'Cache', Refresh: 'Auffrischen', Index: 'Index', Research: 'Recherche',
    Product: 'Produkt', Finance: 'Finanzen', zoneRead: 'Zone 1 · lesen', zoneWrite: 'Zone 2 · schreiben', zoneQuality: 'Zone 4 · Qualität', zoneMoney: 'Zone 3 · Geld',
    needsApproval: '{name} braucht deine Freigabe', policyTimeout: 'Wird bei Ablauf per Richtlinie freigegeben', secs: '{n} s', reject: 'Ablehnen', approve: 'Freigeben',
    moreWaiting: '+{n, number} weitere warten', noApprovals: 'Keine Freigaben offen', mapScrolls: 'Liniennetz, seitlich scrollbar', mapLabel: 'Liniennetz der Agenten-Teams',
    queueLabel: 'Ereigniswarteschlange, {n, number} wartend', queue: 'Ereignisse', emptyQueue: 'leer', more: '+{n, number} weitere', jobs: '{n, number}/{max, number} Jobs',
    dropped: ' · {n, number} verworfen', swipeMap: 'Karte wischen', waitingSr: '{n, number} warten auf deine Freigabe',
    routing: 'Routing-Entscheidung', orchestrator: 'Orchestrator', job: 'Job (nummeriert, wie im Trace)', queued: 'Wartet auf einen belegten Agenten', congestion: 'Stau',
    waiting: 'Wartet auf Freigabe', play: 'Abspielen', pause: 'Pausieren', speed: 'Tempo', hitl: 'Mensch im Prozess', maxJobs: 'Max. Jobs', fire: 'Ereignis auslösen',
    traceScrolls: 'Trace-Tabelle, seitlich scrollbar', trace: 'Trace', ago: '−{n, number} s', now: 'jetzt', time: 'Zeit', tokens: 'Tokens', usd: 'USD',
    jobsAppear: 'Jobs erscheinen hier, sobald sie starten.', rejected: 'abgelehnt', done: 'fertig', inReview: '{n, number} in Prüfung', waitingFor: 'wartet auf {station}',
    follow: 'Job {id}, {name}, auf der Karte folgen', swipeTrace: 'Trace wischen',
  },
  ar: {
    research: 'البحث', payments: 'المدفوعات', approvals: 'الموافقات', evals: 'التقييمات', memory: 'الذاكرة', index: 'حلقة الفهرسة',
    Intake: 'الاستقبال', Analyst: 'المحلّل', Deploy: 'النشر', Search: 'البحث', 'Pay agent': 'وكيل الدفع', Ledger: 'السجل', Human: 'إنسان', Risk: 'المخاطر', Audit: 'التدقيق',
    Grader: 'المقيّم', Evals: 'التقييمات', Memory: 'الذاكرة', Recall: 'الاسترجاع', Embed: 'التضمين', Cache: 'التخزين المؤقت', Refresh: 'التحديث', Index: 'الفهرس', Research: 'البحث',
    Product: 'المنتج', Finance: 'المالية', zoneRead: 'المنطقة 1 · قراءة', zoneWrite: 'المنطقة 2 · كتابة', zoneQuality: 'المنطقة 4 · الجودة', zoneMoney: 'المنطقة 3 · المال',
    needsApproval: '{name} بحاجة إلى موافقتك', policyTimeout: 'تُمنح الموافقة وفق السياسة عند انتهاء الوقت', secs: '{n} ث', reject: 'رفض', approve: 'موافقة',
    moreWaiting: '+{n, number} أخرى في الانتظار', noApprovals: 'لا موافقات معلّقة', mapScrolls: 'خريطة الخطوط، تُمرَّر أفقيًا', mapLabel: 'خريطة خطوط فرق الوكلاء',
    queueLabel: 'قائمة الأحداث، {n, number} في الانتظار', queue: 'قائمة الأحداث', emptyQueue: 'فارغة', more: '+{n, number} أخرى', jobs: '{n, number}/{max, number} مهام',
    dropped: ' · أُسقط {n, number}', swipeMap: 'اسحب الخريطة', waitingSr: '{n, number} بانتظار موافقتك',
    routing: 'قرار توجيه', orchestrator: 'منسّق', job: 'مهمة (مرقّمة، تطابق السجل)', queued: 'في انتظار وكيل مشغول', congestion: 'ازدحام',
    waiting: 'بانتظار الموافقة', play: 'تشغيل', pause: 'إيقاف مؤقت', speed: 'السرعة', hitl: 'إنسان في الحلقة', maxJobs: 'أقصى عدد للمهام', fire: 'إطلاق حدث',
    traceScrolls: 'جدول السجل، يُمرَّر أفقيًا', trace: 'السجل', ago: '−{n, number} ث', now: 'الآن', time: 'الوقت', tokens: 'الرموز', usd: 'دولار',
    jobsAppear: 'تظهر المهام هنا عند بدئها.', rejected: 'مرفوضة', done: 'منجزة', inReview: '{n, number} قيد المراجعة', waitingFor: 'بانتظار {station}',
    follow: 'تتبّع المهمة {id}، {name}، على الخريطة', swipeTrace: 'اسحب السجل',
  },
})
type AtKey = keyof typeof TRANSIT_MESSAGES.en
/** A station, hub or line name in the reader's language (names the map doesn't know show as given). */
const atName = (t: (k: AtKey) => string, n: string) => Object.prototype.hasOwnProperty.call(TRANSIT_MESSAGES.en, n) ? t(n as AtKey) : n

type Pt = [number, number]
const AT_W = 1000, AT_H = 720
const AT_R: Pt = [250, 300], AT_P: Pt = [640, 300], AT_F: Pt = [640, 560], AT_LC: Pt = [342, 140], AT_LR = 92
const AT_LINES: Record<string, [string, string]> = { research: ['Research', '#7B78D8'], payments: ['Payments', '#C8603F'], approvals: ['Approvals', '#4A9C78'], evals: ['Evals', '#B07A2E'], memory: ['Memory', '#C45C7C'], index: ['Indexing loop', '#2E9DB0'] }
const AT_C = (k: string) => AT_LINES[k]?.[1] ?? 'var(--fg3)'
const AT_PATH: Record<string, Pt[]> = { research: [[70, 300], AT_R, AT_P, [840, 300]], payments: [[70, 120], AT_R, [250, 360], [450, 560], AT_F, [840, 560]], approvals: [[640, 60], AT_P, AT_F, [640, 690]], evals: [AT_P, [780, 160], [900, 160]], memory: [[250, 50], AT_R] }
const AT_ST: [string, string, Pt, number, number, 'start' | 'middle' | 'end'][] = [['Intake', 'research', [70, 300], 0, 26, 'start'], ['Analyst', 'research', [445, 300], 0, 30, 'middle'], ['Deploy', 'research', [840, 300], 0, 30, 'middle'], ['Search', 'payments', [70, 120], 0, -14, 'start'], ['Pay agent', 'payments', [350, 460], -18, 10, 'end'], ['Ledger', 'payments', [840, 560], 0, 30, 'middle'], ['Human', 'approvals', [640, 60], 20, 5, 'start'], ['Risk', 'approvals', [640, 420], 20, 5, 'start'], ['Audit', 'approvals', [640, 690], 20, 5, 'start'], ['Grader', 'evals', [710, 230], 22, 18, 'start'], ['Evals', 'evals', [900, 160], 0, -16, 'middle'], ['Memory', 'memory', [250, 50], -18, 5, 'end'], ['Recall', 'memory', [250, 210], -18, 5, 'end']]
const AT_LOOPST: [string, number, number, 'start' | 'middle' | 'end', number][] = [['Embed', 0, -14, 'middle', 270], ['Cache', 16, 4, 'start', 0], ['Refresh', 0, 26, 'middle', 90]]
const AT_ZONES: [number, number, number, number, 'zoneRead' | 'zoneWrite' | 'zoneQuality' | 'zoneMoney', string][] = [[40, 30, 520, 210, 'zoneRead', 'br'], [40, 250, 900, 120, 'zoneWrite', 'br'], [700, 30, 240, 210, 'zoneQuality', 'tl'], [300, 390, 640, 320, 'zoneMoney', 'br']]
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
/** map units between tokens queued at a busy agent (the head keeps AT_HEAD from the station, clear of its ring); the first AT_QVIS line up, the rest stack on the last slot */
const AT_GAP = 24, AT_QVIS = 4, AT_HEAD = 34
/** trace table: rows are absolutely placed in a fixed-height list, so new jobs never push the page */
const AT_ROWS = 6, AT_ROW_H = 42
/** approval cards: fixed size, stacked by transform inside an overlay on the map (nothing below them moves) */
const AT_CARD_W = 272, AT_CARD_H = 80, AT_CARD_GAP = 6, AT_CARDS = 2
/** event-queue panel in the empty corner under Intake (map units) */
const AT_EQ: Pt = [48, 396], AT_EQ_W = 214, AT_EQ_ROWS = 5, AT_EQ_ROW = 32
const atPos = (line: string, station: string): number | undefined => AT_SP[line]?.[station]
/** The polyline between two arc positions of a line, bends included (for congestion heat). */
function atSubPath(k: string, a: number, b: number) {
  if (a > b) [a, b] = [b, a]
  const pts = AT_PATH[k], c = atCum[k], p0 = atPoint(k, a), p1 = atPoint(k, b), out = [`M${p0.x.toFixed(1)},${p0.y.toFixed(1)}`]
  for (let i = 1; i < pts.length - 1; i++) if (c[i] > a + 0.5 && c[i] < b - 0.5) out.push(`L${pts[i][0]},${pts[i][1]}`)
  out.push(`L${p1.x.toFixed(1)},${p1.y.toFixed(1)}`)
  return out.join(' ')
}
/** Track segments between neighbouring stations, per line: the unit the congestion heat is painted on. */
const AT_SEGS = Object.keys(AT_PATH).flatMap(k => {
  const ss = [...new Set(Object.values(AT_SP[k] ?? {}).map(v => Math.round(v * 10) / 10))].sort((x, y) => x - y)
  return ss.slice(0, -1).map((a, i) => ({ key: `${k}:${i}`, line: k, a, b: ss[i + 1], d: atSubPath(k, a, ss[i + 1]) }))
})
/** Heat by tokens on (or queued at the end of) a segment: 1 a faint wash, 2 warm, 3+ hot. */
const AT_HEAT: [string, number, number][] = [['var(--fg3)', 0, 8], ['var(--fg3)', 0.22, 16], ['var(--warn)', 0.45, 20], ['var(--bad)', 0.45, 25]]
/** Heat changes ease over 500 ms with the library's default transition curve (what the CSS transition used). */
const AT_HEAT_MS = 500, atHeatEase = cubicBezier(0.4, 0, 0.2, 1)
type AtRgb = [number, number, number]
/** '#rgb', '#rrggbb' or 'rgb(…)' as [r, g, b]; null for anything else (that colour then switches without a blend). */
function atRgb(c: string): AtRgb | null {
  c = c.trim()
  const h = /^#([\da-f]{3}|[\da-f]{6})$/i.exec(c)?.[1]
  if (h) return (h.length === 3 ? [...h].map(x => parseInt(x + x, 16)) : [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16))) as AtRgb
  const m = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/i.exec(c)
  return m ? [+m[1], +m[2], +m[3]] : null
}
type AtHeatSeg = { lv: number; on: boolean; from: number[]; cur: number[]; t0: number }
/**
 * The congestion heat's tween, driven by the map's frame loop (in step with the tokens, 30 fps on touch) instead of CSS
 * transitions, which would restyle, lay out and repaint the map at the display's full rate for half a second after
 * every change. Values are [r, g, b, opacity, width]; a finished tween writes the token colour itself (var(--warn)), so
 * the heat follows a theme change while idle (blends re-read the colours at most once a second).
 */
function atHeatTween() {
  const segs: AtHeatSeg[] = AT_SEGS.map(() => ({ lv: 0, on: true, from: [], cur: [], t0: -1 }))
  const els: (SVGPathElement | null)[] = []
  let pal: (AtRgb | null)[] | null = null, palAt = -1e9
  const target = (g: AtHeatSeg, p: (AtRgb | null)[]) => { const [, o, w] = AT_HEAT[g.lv], c = p[Math.max(0, g.lv - 1)] ?? [0, 0, 0]; return [c[0], c[1], c[2], g.on ? o : o * 0.25, w] }
  const css: string[] = []
  const write = (i: number, v: number[], done: boolean) => {
    const el = els[i], g = segs[i]; if (!el) return
    const stroke = done || !pal?.[Math.max(0, g.lv - 1)] ? AT_HEAT[g.lv][0] : `rgb(${Math.round(v[0])},${Math.round(v[1])},${Math.round(v[2])})`
    const c = `stroke:${stroke};opacity:${Math.round(v[3] * 1000) / 1000};stroke-width:${Math.round(v[4] * 10) / 10}`
    if (css[i] !== c) { css[i] = c; el.style.cssText = c } // one write, and none when nothing changed
  }
  return {
    /** registers a heat path (data-i is its segment index) and paints it as it stands */
    reg: (el: SVGPathElement | null) => { if (!el) return; const i = Number(el.dataset.i); els[i] = el; const g = segs[i]; write(i, g.cur.length ? g.cur : [0, 0, 0, AT_HEAT[g.lv][1] * (g.on ? 1 : 0.25), AT_HEAT[g.lv][2]], true) },
    /** new levels (a digit per segment) and lit lines; starts tweens for what changed, or jumps there when `instant`. True if a tween started. */
    set(levels: string, lit: Set<string> | null, now: number, instant: boolean, host: Element | null) {
      // the theme's colours, re-read at most once a second (a finished tween writes var(--…), so only blends need them)
      if (host && (!pal || now - palAt > 1000)) { const cs = getComputedStyle(host); pal = ['--fg3', '--warn', '--bad'].map(v => atRgb(cs.getPropertyValue(v))); palAt = now }
      const p = pal ?? [null, null, null]
      let started = false
      segs.forEach((g, i) => {
        const lv = +(levels[i] ?? 0), on = !lit || lit.has(AT_SEGS[i].line)
        if (lv === g.lv && on === g.on) return
        const was = g.cur.length ? g.cur : target(g, p), blend = !!p[Math.max(0, g.lv - 1)] && !!p[Math.max(0, lv - 1)]
        g.lv = lv; g.on = on
        // a colour that can't be blended (not hex or rgb) switches at once; opacity and width still ease
        g.from = [...was]; if (!blend) g.from.splice(0, 3, ...target(g, p).slice(0, 3))
        if (instant) { g.cur = target(g, p); g.t0 = -1; write(i, g.cur, true) } else { g.t0 = now; started = true }
      })
      return started
    },
    busy: () => segs.some(g => g.t0 >= 0),
    /** advances running tweens to `now`; true while any is still running */
    step(now: number) {
      if (!pal) return false
      let busy = false
      segs.forEach((g, i) => {
        if (g.t0 < 0) return
        const u = Math.min(1, (now - g.t0) / AT_HEAT_MS), e = atHeatEase(u), to = target(g, pal!)
        g.cur = u >= 1 ? to : g.from.map((a, k) => a + (to[k] - a) * e)
        if (u >= 1) g.t0 = -1; else busy = true
        write(i, g.cur, u >= 1)
      })
      return busy
    },
  }
}
/** Pads a number to a fixed width (mono font), so a changing value never moves the text's start (no layout shift). */
const atPad = (s: string, n: number) => s.padStart(n, ' ')
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
/** Which way a token runs along its line on its latest move (+1 towards higher arc length). */
function atDirOf(tk: WorkflowToken) {
  const m = tk.move ?? tk.last; if (!m) return 1
  const a = atPos(tk.line, m.from), b = atPos(tk.line, m.to)
  return a === undefined || b === undefined ? 1 : Math.sign(b - a) || 1
}
/**
 * Where every token should be drawn, as [line, arc position]. Moving tokens follow the drawn line; tokens queued at a
 * busy agent line up on the line they came in on, oldest nearest the station; a token heading for an agent with a queue
 * stops at the back of it. With reduced motion a moving token is placed where it is going (no travel).
 */
function atLayout(eng: WorkflowEngine, agents: Set<string>, reduce: boolean) {
  const slot = new Map<number, number>(), side = new Map<string, number>()
  for (const [stn, q] of Object.entries(eng.queues)) q.forEach(tk => {
    const k = `${stn}|${tk.line}|${atDirOf(tk)}`, n = side.get(k) ?? 0
    slot.set(tk.uid, n); side.set(k, n + 1)
  })
  const out = new Map<number, [string, number]>()
  for (const j of eng.jobs) if (!j.done) for (const tk of j.tokens) {
    const m = tk.move ?? (tk.phase === 'queue' ? tk.last : null)
    if (!m) { out.set(tk.uid, [tk.line, atPos(tk.line, eng.machines[j.type].states[tk.state].at[1]) ?? 0]); continue }
    const a = atPos(tk.line, m.from) ?? 0, b = atPos(tk.line, m.to) ?? a, dir = Math.sign(b - a) || 1
    const back = (k: number) => { const s = b - dir * (AT_HEAD + AT_GAP * Math.min(k, AT_QVIS - 1)); return dir > 0 ? Math.max(s, Math.min(a + 6, b)) : Math.min(s, Math.max(a - 6, b)) }
    if (tk.phase === 'queue') { out.set(tk.uid, [tk.line, back(slot.get(tk.uid) ?? 0)]); continue }
    let s = reduce ? b : a + (b - a) * eng.progress(tk)
    const busy = agents.has(m.to) && ((eng.busy[m.to] && eng.busy[m.to] !== tk) || !!eng.queues[m.to]?.length)
    if (busy) { const lim = back(side.get(`${m.to}|${tk.line}|${dir}`) ?? 0); s = dir > 0 ? Math.min(s, lim) : Math.max(s, lim) }
    out.set(tk.uid, [tk.line, s])
  }
  return out
}
/** Congestion: tokens moving along, or queued at the end of, each segment of track, as a heat level digit (0–3) per segment. */
function atHeatKey(eng: WorkflowEngine) {
  const heat: Record<string, number> = {}
  for (const [k, n] of Object.entries(eng.occupancy())) {
    const [line, from, to] = k.split('|'), a = atPos(line, from), b = atPos(line, to)
    if (a === undefined || b === undefined) continue
    const lo = Math.min(a, b) - 0.5, hi = Math.max(a, b) + 0.5
    AT_SEGS.forEach(sg => { if (sg.line === line && sg.a >= lo && sg.b <= hi) heat[sg.key] = (heat[sg.key] ?? 0) + n })
  }
  return AT_SEGS.map(sg => Math.min(3, heat[sg.key] ?? 0)).join('')
}
const AT_NO_MACHINES: Record<string, WorkflowMachine> = {}, AT_NO_ORDER: string[] = []
type AtSpark = { id: number; x: number; y: number; text: string; t: number }
type AtFade = { id: number; x: number; y: number; line: string; jid: number; t: number; small: boolean }
type AtDisp = { line: string; s: number; tr: string }

// the track is a 6px band painted in the middle, so on touch the input itself can be a 32px target
const AT_RANGE = 'min-w-[90px] max-w-[200px] flex-1'
const AT_JOB_DOT = 'grid h-[18px] w-[18px] flex-none place-items-center rounded-full text-[11px] font-bold text-white [@media(pointer:coarse)]:text-[11px]'
const AT_TRACE_COLS = 'grid-cols-[minmax(150px,26%)_1fr_64px_64px_72px] gap-3'
/** A mouse hovering a row follows its job; a click or tap pins it (touch has no hover). Buttons inside keep their own clicks. */
const atFollow = (id: number, setHover: (h: number | null) => void, setPin: (f: (p: number | null) => number | null) => void) => ({
  onPointerEnter: (e: React.PointerEvent) => { if (e.pointerType === 'mouse') setHover(id) },
  onPointerLeave: (e: React.PointerEvent) => { if (e.pointerType === 'mouse') setHover(null) },
  onClick: (e: React.MouseEvent) => { if ((e.target as Element).closest('button')) return; setPin(p => p === id ? null : id) },
})
const atDim = (on: boolean) => cn('transition-opacity duration-200', !on && 'opacity-15')
/** memo() comparer for parts that pass a signature of everything they draw. */
const atSigEq = (a: { sig: string }, b: { sig: string }) => a.sig === b.sig

/*
 * Layers. The map is five stacked layers of the same size: the still drawing (zones, congestion heat, lines, ticks: an SVG
 * that re-renders only when the heat or the followed job changes), the train and approval pulses (HTML), the event queue,
 * hubs and countdown rings (SVG), the tokens (HTML), and the labels and queue counters (SVG). Moving parts are HTML boxes
 * sized in % of the map and placed by `transform` in % of their own size, so a frame only moves composited layers: no
 * layout, no repaint of the drawing, no measuring.
 */
/** Box of `u`×`u` map units, in % of the map. */
const atBox = (u: number) => ({ width: `${(u / AT_W) * 100}%`, height: `${(u / AT_H) * 100}%` })
/** Translate a `u`-unit box so its centre sits on map point p (0.1-unit steps, like the drawing's own transforms). */
const atAt = (p: { x: number; y: number }, u: number) =>
  `translate(${(((Math.round(p.x * 10) / 10) - u / 2) / u * 100).toFixed(2)}%,${(((Math.round(p.y * 10) / 10) - u / 2) / u * 100).toFixed(2)}%)`
const AT_TOK = 30, AT_TRAIN = 28, AT_PULSE = 38, AT_FLASH = 14
/**
 * The Indexing-loop train runs on the compositor: a box centred on the loop is turned by a looping rotate animation
 * (one lap per AT_LOOP_L / AT_LOOP_SPEED sim-seconds at speed 1, playbackRate = the engine's speed), with the train
 * at its edge facing along the track. The map's refresh keeps it in step with the engine clock. No script per frame.
 */
const AT_TRAIN_BOX = 2 * AT_LR + AT_TRAIN, AT_LAP_MS = (AT_LOOP_L / AT_LOOP_SPEED) * 1000
/** Where the train is at sim time `clock`, as the loop box's rotation (deg, 0 = the loop's right-hand point). */
const atTrainDeg = (clock: number) => ((((AT_LOOP_L * 0.55 + AT_LOOP_SPEED * clock) / AT_LR) * 180 / Math.PI + 180) % 360 + 360) % 360
/** A `u`-unit box centred on map point (x, y) by its position and margins (both margins are % of the map's width), so its
 * animations can stay pure scale + opacity, which run on the compositor (a % translate would keep them on the main thread). */
const atCentred = (x: number, y: number, u: number) => ({ left: `${(x / AT_W) * 100}%`, top: `${(y / AT_H) * 100}%`, marginLeft: `${(-u / 2 / AT_W) * 100}%`, marginTop: `${(-u / 2 / AT_W) * 100}%`, ...atBox(u) })
// each layer is a fixed-size box with strict containment: a change inside one lays out and repaints that layer only
const AT_SVG_LAYER = 'pointer-events-none absolute top-0 left-0 block h-full w-full [contain:strict]' // rtl-lint-ignore: map layer (LTR drawing)
const AT_HTML_LAYER = 'pointer-events-none absolute inset-0 [contain:strict]'
const AT_VIEWBOX = `0 0 ${AT_W} ${AT_H}`

/** The still drawing: zones, congestion heat, lines and ticks (three stacked SVGs). Re-renders only when the followed job's lines (`lit`) change; the heat paths are styled by the map's heat tween (`regHeat`). */
const AtMapBase = memo(function AtMapBase({ lit, fs, regHeat }: { lit: string | null; fs: number; regHeat: (el: SVGPathElement | null) => void }) {
  const t = useMessages(TRANSIT_MESSAGES)
  const litSet = useMemo(() => lit === null ? null : new Set(lit.split(',')), [lit])
  const on = (k: string) => !litSet || litSet.has(k)
  return <>
    <svg viewBox={AT_VIEWBOX} role="img" aria-label={t('mapLabel')} className="block h-auto w-full">
      {AT_ZONES.map(([x, y, w, h, l, pos]) => <g key={l}>
        <rect x={x} y={y} width={w} height={h} fill="var(--muted)" stroke="var(--line2)" strokeDasharray="5 4" />
        <text x={pos.includes('l') ? x + 14 : x + w - 14} y={pos.includes('t') ? y + 22 : y + h - 12} textAnchor={pos.includes('l') ? 'start' : 'end'} fill="var(--fg)" style={{ font: `500 ${12 * fs}px var(--font)` }}>{t(l)}</text>
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
        {Object.entries(AT_PATH).map(([k, pts]) => <path key={k} d={'M' + pts.map(p => p.join(',')).join(' L')} stroke={AT_C(k)} className={atDim(on(k))} />)}
        <path d={`M${AT_LC[0] - AT_LR},${AT_LC[1]} A${AT_LR},${AT_LR} 0 1,1 ${AT_LC[0] + AT_LR},${AT_LC[1]} A${AT_LR},${AT_LR} 0 1,1 ${AT_LC[0] - AT_LR},${AT_LC[1]}`} stroke={AT_C('index')} className={atDim(on('index'))} />
      </g>
      <g>
        {Object.entries(AT_PATH).flatMap(([k, pts]) => [pts[0], pts[pts.length - 1]].filter(p => ![AT_R, AT_P, AT_F].some(h => atSame(h, p))).map((p, i) => {
          const [ux, uy] = atDir(pts, p), nx = -uy, ny = ux
          return <line key={k + i} x1={p[0] - nx * 11} y1={p[1] - ny * 11} x2={p[0] + nx * 11} y2={p[1] + ny * 11} stroke={AT_C(k)} strokeWidth={4} className={atDim(on(k))} />
        }))}
        {AT_ST.map(([n, k, pt]) => {
          const pts = AT_PATH[k]; if (atSame(pts[0], pt) || atSame(pts[pts.length - 1], pt)) return null
          const [ux, uy] = atDir(pts, pt); return <line key={n} x1={pt[0]} y1={pt[1]} x2={pt[0] - uy * 10} y2={pt[1] + ux * 10} stroke={AT_C(k)} strokeWidth={3} className={atDim(on(k))} />
        })}
        {AT_LOOPST.map(([n, , , , ang]) => { const a = ang * Math.PI / 180; return <line key={n} x1={AT_LC[0] + Math.cos(a) * AT_LR} y1={AT_LC[1] + Math.sin(a) * AT_LR} x2={AT_LC[0] + Math.cos(a) * (AT_LR + 10)} y2={AT_LC[1] + Math.sin(a) * (AT_LR + 10)} stroke={AT_C('index')} strokeWidth={3} className={atDim(on('index'))} /> })}
      </g>
    </svg>
  </>
})

/** The global event queue panel (waiting for a job slot), redrawn only when what it shows changes. */
const AtQueuePanel = memo(function AtQueuePanel({ queue, qlen, qmax, maxJobs, running, active, dropped, narrow }:
  { sig: string; queue: { id: number; ev: string; from: string }[]; qlen: number; qmax: number; maxJobs: number; running: number; active: number; dropped: number; narrow: boolean }) {
  const t = useMessages(TRANSIT_MESSAGES), { fmt } = useLocale()
  return (
    <g transform={`translate(${AT_EQ[0]},${AT_EQ[1]})`} aria-label={t('queueLabel', { n: qlen })}>
      <rect width={AT_EQ_W} height={44 + AT_EQ_ROWS * AT_EQ_ROW + 46} rx={12} fill="var(--card)" stroke="var(--line2)" />
      <text x={14} y={26} fill="var(--fg)" style={{ font: '600 15px var(--font)' }}>{t('queue')}</text>
      <text x={AT_EQ_W - 14} y={26} textAnchor="end" fill="var(--fg3)" style={{ font: `${narrow ? 14 : 13}px var(--mono)` }}>{fmt.number(qlen)}/{fmt.number(qmax)}</text>
      <AnimatePresence initial={false}>
        {queue.map((q, i) => (
          <motion.g key={q.id} initial={{ opacity: 0, x: -10, y: 40 + i * AT_EQ_ROW }} animate={{ opacity: 1, x: 0, y: 40 + i * AT_EQ_ROW }} exit={{ opacity: 0, x: 10 }} transition={spring(0.25, 0.35)}>
            <rect x={10} width={AT_EQ_W - 20} height={26} rx={13} fill="var(--muted)" stroke={i === 0 ? 'var(--fg3)' : 'none'} />
            <circle cx={25} cy={13} r={4.5} fill={AT_C(q.from)} />
            <text x={37} y={18} fill="var(--fg)" style={{ font: '14px var(--mono)' }}>{q.ev}</text>
          </motion.g>))}
      </AnimatePresence>
      {!qlen && <text x={14} y={62} fill="var(--fg3)" style={{ font: '14px var(--font)' }}>{t('emptyQueue')}</text>}
      {qlen > AT_EQ_ROWS && <text x={AT_EQ_W - 14} y={40 + AT_EQ_ROWS * AT_EQ_ROW + 4} textAnchor="end" fill="var(--fg3)" style={{ font: `${narrow ? 14 : 13}px var(--font)` }}>{t('more', { n: qlen - AT_EQ_ROWS })}</text>}
      <g transform={`translate(14,${44 + AT_EQ_ROWS * AT_EQ_ROW + 22})`}>
        {Array.from({ length: maxJobs }, (_, i) => <circle key={i} cx={6 + i * 15} cy={0} r={5} fill={i < running ? 'var(--fg2)' : 'none'} stroke="var(--fg3)" strokeWidth={1.5} />)}
        <text x={14 + maxJobs * 15} y={5} fill="var(--fg2)" style={{ font: '14px var(--font)' }}>{t('jobs', { n: active, max: maxJobs })}{dropped ? t('dropped', { n: dropped }) : ''}</text>
      </g>
    </g>
  )
}, atSigEq)

/**
 * The map's short-lived marks (event sparks and the loop's event label), animated by the map's frame loop (with the
 * tokens, 30 fps on touch) instead of a script animation of their own at the display's full rate. Each starts when it
 * mounts; timings and easing are what the motion animations used (ease-in-out; keyframes evenly spaced).
 */
const atEaseInOut = cubicBezier(0.42, 0, 0.58, 1)
/** Value at `u` (0–1) along evenly spaced keyframes, each step eased. */
const atKeys = (k: number[], u: number) => { const n = k.length - 1, i = Math.min(n - 1, Math.floor(u * n)), f = atEaseInOut(Math.min(1, u * n - i)); return k[i] + (k[i + 1] - k[i]) * f }
type AtMarkKind = 'ring' | 'text' | 'ev'
const AT_MARK_MS: Record<AtMarkKind, number> = { ring: 900, text: 1800, ev: 1600 }
function atMarkPaint(el: SVGElement, kind: AtMarkKind, u: number) {
  if (kind === 'ring') { const e = atEaseInOut(u); el.setAttribute('r', (6 + 20 * e).toFixed(2)); el.style.opacity = (1 - e).toFixed(3) }
  else if (kind === 'text') { el.style.opacity = atKeys([0, 1, 1, 0], u).toFixed(3); el.setAttribute('transform', `translate(0,${(-10 * atEaseInOut(u)).toFixed(2)})`) }
  else el.style.opacity = atKeys([0, 1, 1, 0.35], u).toFixed(3)
}
function atMarks() {
  const live = new Map<SVGElement, { kind: AtMarkKind; t0: number }>()
  return {
    /** registers a mark (data-mark is its kind); it starts now */
    reg: (el: SVGElement | null) => {
      if (!el) return
      const kind = el.dataset.mark as AtMarkKind
      live.set(el, { kind, t0: performance.now() }); atMarkPaint(el, kind, 0)
      return () => { live.delete(el) }
    },
    busy: () => live.size > 0,
    /** advances the marks to `now`; true while any is still running */
    step(now: number) {
      for (const [el, m] of live) { const u = Math.min(1, (now - m.t0) / AT_MARK_MS[m.kind]); atMarkPaint(el, m.kind, u); if (u >= 1) live.delete(el) }
      return live.size > 0
    },
  }
}
/** Event sparks (an expanding ring and the event's name), redrawn only when one starts or ends; the map's frame loop animates them (`reg`). */
const AtSparks = memo(function AtSparks({ sparks, reg }: { sig: string; sparks: AtSpark[]; reg: (el: SVGElement | null) => void }) {
  return <g>
    {sparks.map(s => <g key={s.id}>
      <circle ref={reg} data-mark="ring" cx={s.x} cy={s.y} r={6} fill="none" stroke="var(--accent)" strokeWidth={2} />
      <text ref={reg} data-mark="text" x={s.x} y={s.y - 16} textAnchor="middle" fill="var(--accent)" style={{ font: '600 11px var(--mono)', opacity: 0 }}>{s.text}</text>
    </g>)}
  </g>
}, atSigEq)

/** The Index station and the three orchestrator hubs (still). */
const AtHubs = memo(function AtHubs() {
  return <g>
    <circle cx={AT_LC[0] - AT_LR} cy={AT_LC[1]} r={10} fill="var(--card)" stroke="var(--fg)" strokeWidth={3.5} />
    {AT_HUBS.map(([n, [x, y]]) => <circle key={n} cx={x} cy={y} r={22} fill="var(--card)" stroke="var(--fg)" strokeWidth={5} />)}
  </g>
})

/** Station, loop and hub names (still; they sit over the tokens). */
const AtLabels = memo(function AtLabels({ fs }: { fs: number }) {
  const t = useMessages(TRANSIT_MESSAGES), nm = (n: string) => atName(t, n)
  return <>
    {AT_ST.map(([n, , pt, dx, dy, anc]) => <text key={n} x={pt[0] + dx} y={pt[1] + dy} textAnchor={anc}>{nm(n)}</text>)}
    {AT_LOOPST.map(([n, dx, dy, anc, ang]) => { const a = ang * Math.PI / 180; return <text key={n} x={AT_LC[0] + Math.cos(a) * AT_LR + dx + Math.cos(a) * 6} y={AT_LC[1] + Math.sin(a) * AT_LR + dy} textAnchor={anc}>{nm(n)}</text> })}
    <text x={AT_LC[0] - AT_LR - 18} y={AT_LC[1] + 5} textAnchor="end" fill="var(--fg)" fontWeight={600}>{t('Index')}</text>
    {AT_HUBS.map(([n, [x, y], dx, dy, anc]) => <text key={n} x={x + dx} y={y + dy} textAnchor={anc} fill="var(--fg)" style={{ font: `600 ${15 * fs}px var(--font)` }}>{nm(n)}</text>)}
  </>
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
  return <div ref={ref} className="absolute opacity-0" style={atCentred(x, y, AT_PULSE)} /* rtl-lint-ignore: map coordinates (LTR drawing) */>
    <svg viewBox={`${-AT_PULSE / 2} ${-AT_PULSE / 2} ${AT_PULSE} ${AT_PULSE}`} className="block h-full w-full overflow-visible"><circle r={18} fill="none" stroke="var(--warn)" strokeWidth={2} /></svg>
  </div>
}
/** An orchestrator's routing flash (a red dot that pops and fades), once per mount; on the compositor. */
function AtFlash({ x, y }: { x: number; y: number }) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = ref.current; if (!el || typeof el.animate !== 'function') return
    const k = (s: number, o: number) => ({ transform: `scale(${s})`, opacity: o, easing: 'ease-in-out' })
    const a = el.animate([k(0.4, 1), k(1.2, 1), k(1, 0)], { duration: 1000, fill: 'forwards' })
    return () => a.cancel()
  }, [])
  return <div ref={ref} className="absolute rounded-full bg-[var(--bad)] opacity-0" style={atCentred(x, y, AT_FLASH)} /* rtl-lint-ignore: map coordinates (LTR drawing) */ />
}

/** The trace window's slide at sim time `clock`. */
const atStrip = (clock: number) => `translateX(${((AT_WIN - clock) / AT_WIN) * 100}%)`
/** Everything the map draws apart from the clock (tokens, queue, heat, approvals, marks, the trace's rows and states), as a string: the map re-renders when it changes. */
function atStructSig(eng: WorkflowEngine, F: { sparks: { id: number }[]; fading: { id: number }[]; hubFlash: number[]; evLabel: { n: number } }) {
  const tk = (k: WorkflowToken) => `${k.uid}${k.phase}${k.line}${k.state}${k.next ?? ''}`
  return [
    eng.jobs.map(j => `${j.id}${j.done ? (j.rejected ? 'r' : 'd') : ''}${j.state}:${j.tokens.map(tk).join('/')}`).join(','),
    eng.queue.map(q => q.id).join(','), eng.dropped, eng.waiting.map(tk).join(','),
    Object.entries(eng.queues).map(([s, q]) => q.length ? `${s}${q.length}${q[0].uid}` : '').join(''),
    atHeatKey(eng), F.sparks.map(s => s.id).join(','), F.fading.map(f => f.id).join(','), F.hubFlash.join(','), F.evLabel.n,
  ].join('|')
}
/** The engine clock as a tiny store: running trace rows subscribe, so they refresh without their row (a motion element) re-rendering. */
function atClockStore() {
  let v = 0
  const subs = new Set<() => void>()
  return { get: () => v, set: (x: number) => { v = x; subs.forEach(f => f()) }, sub: (f: () => void) => { subs.add(f); return () => { subs.delete(f) } } }
}
type AtClock = ReturnType<typeof atClockStore>
/** Approvals waiting at each station, as countdown-ring data. */
function atRings(eng: WorkflowEngine, machines: Record<string, WorkflowMachine>) {
  const at = (tk: WorkflowToken) => `${tk.line}|${machines[tk.job.type].states[tk.state].at[1]}`
  return [...new Set(eng.waiting.map(at))].map(k => {
    const [line, stn] = k.split('|'), q = eng.waiting.filter(tk => at(tk) === k)
    return { k, ...atPoint(line, atPos(line, stn) ?? 0), n: q.length, frac: Math.max(0, q[0].t / eng.hitlWait) }
  })
}
/** The countdown rings on stations waiting for a human (and how many wait there); they follow the clock store. */
function AtRings({ eng, machines, clock }: { eng: WorkflowEngine; machines: Record<string, WorkflowMachine>; clock: AtClock }) {
  useSyncExternalStore(clock.sub, () => atRings(eng, machines).map(r => `${r.k}${r.n}${(r.frac * 107).toFixed(1)}`).join(','), () => '')
  const C = 2 * Math.PI * 17
  return <>{atRings(eng, machines).map(r => (
    <g key={r.k} transform={`translate(${r.x.toFixed(1)},${r.y.toFixed(1)})`}>
      <circle r={17} fill="var(--card)" stroke="color-mix(in srgb, var(--warn) 25%, transparent)" strokeWidth={4} />
      <circle r={17} fill="none" stroke="var(--warn)" strokeWidth={4} strokeLinecap="round" strokeDasharray={`${(r.frac * C).toFixed(1)} ${C.toFixed(1)}`} transform="rotate(-90)" />
      {r.n > 1 && <g transform="translate(16,-16)"><circle r={9} fill="var(--warn)" /><text y={4} textAnchor="middle" fill="var(--card)" style={{ font: '700 11px var(--font)' }}>{r.n}</text></g>}
    </g>))}</>
}
/** An approval's seconds left (amber under 6); follows the clock store, re-rendering when the whole second changes. */
function AtCountdown({ tk, clock }: { tk: WorkflowToken; clock: AtClock }) {
  const t = useMessages(TRANSIT_MESSAGES)
  const [n, soon] = useSyncExternalStore(clock.sub, () => `${Math.ceil(tk.t)}|${tk.t < 6 ? 1 : ''}`, () => '0|').split('|')
  return <span className={cn('w-8 flex-none font-[family-name:var(--mono)] text-xs whitespace-pre', soon ? 'text-[var(--warn)]' : 'text-[var(--fg3)]')} title={t('policyTimeout')}>{atPad(t('secs', { n: Number(n) }), 3)}</span>
}
/** A trace bar's look: solid, or hatched while waiting; the opacity is folded into the colour (no layer per bar). */
const atSegFill = (s: { kind: string; sub: boolean }, c: string) => {
  const a = s.sub ? (s.kind === 'wait' ? 90 : 80) : s.kind === 'move' ? 45 : s.kind === 'wait' ? 90 : 100
  const col = a === 100 ? c : `color-mix(in srgb, ${c} ${a}%, transparent)`
  return s.kind === 'wait' ? `repeating-linear-gradient(135deg, ${col} 0 3px, transparent 3px 7px)` : col
}
/** A trace row's time strip and numbers; a running job's refresh with the clock store, a finished job's never. */
function AtTraceCells({ j, clock: store, strip }: { j: WorkflowJob; clock: AtClock; strip: (el: HTMLDivElement | null) => void }) {
  const t = useMessages(TRANSIT_MESSAGES), { fmt } = useLocale()
  const clock = useSyncExternalStore(store.sub, () => j.done ? j.t1 ?? store.get() : store.get(), () => 0)
  const tx = (v: number) => `${(v / AT_WIN) * 100}%`
  return <>
    <div dir="ltr" className="relative h-3.5 overflow-x-clip">
      {/* the window slides by transform: the map writes it into every strip (a finished row never re-renders for it) */}
      <div ref={strip} className="absolute inset-0">
        {j.segs.map((s, k) => { const b = s.t1 ?? clock; if (b < clock - AT_WIN) return null; return (
          <span key={k} title={s.label} className={cn('absolute rounded-[var(--r-sm)]', s.sub ? 'top-[3px] h-2' : 'top-0 h-3.5')}
            style={{ left: tx(s.t0), width: `max(1px, ${tx(b - s.t0)})`, background: atSegFill(s, AT_C(s.line)) }} /* rtl-lint-ignore: time axis (LTR) */ />) })}
      </div>
    </div>
    <span className="text-end font-[family-name:var(--mono)] text-xs whitespace-pre">{atPad(t('secs', { n: fmt.number((j.t1 ?? clock) - j.t0, { minimumFractionDigits: 1, maximumFractionDigits: 1 }) }), 6)}</span>
    <span className="text-end font-[family-name:var(--mono)] text-xs whitespace-pre">{atPad(fmt.compact(Math.round(j.usage.tokens / 100) * 100), 6)}</span>
    <span className="text-end font-[family-name:var(--mono)] text-xs whitespace-pre">{atPad(fmt.usd(j.usage.usd), 8)}</span>
  </>
}
type AtRowProps = {
  sig: string; j: WorkflowJob; i: number; cur: string; hover: boolean; pinned: boolean; clock: AtClock
  /** registers the row's time strip, which the map slides by writing its transform (rows don't re-render for it) */
  strip: (el: HTMLDivElement | null) => void
  setHover: (h: number | null) => void; setPin: (f: (p: number | null) => number | null) => void
}
/**
 * One trace row; re-renders only when its place, state or highlight changes (its numbers and bars refresh on their own).
 * A fixed-size box with strict containment, so its changing numbers lay out only itself.
 */
const AtTraceRow = memo(function AtTraceRow({ j, i, cur, hover, pinned, clock, strip, setHover, setPin }: AtRowProps) {
  const t = useMessages(TRANSIT_MESSAGES)
  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: j.done ? 0.6 : 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.25 }}
      {...atFollow(j.id, setHover, setPin)} style={{ transform: `translateY(${i * AT_ROW_H}px)`, height: AT_ROW_H }}
      className={cn('absolute inset-x-0 top-0 grid cursor-pointer items-center border-b border-[var(--line)] text-[13px] [contain:strict] hover:bg-[color-mix(in_srgb,var(--muted)_60%,transparent)]', AT_TRACE_COLS, hover && 'bg-[color-mix(in_srgb,var(--muted)_60%,transparent)]')}>
      <div className="sticky start-0 z-[1] flex min-w-0 items-center gap-2 bg-[var(--card)] whitespace-nowrap max-sm:shadow-[6px_0_6px_-6px_rgba(0,0,0,.25)] rtl:max-sm:shadow-[-6px_0_6px_-6px_rgba(0,0,0,.25)]">
        <button type="button" aria-pressed={pinned} aria-label={t('follow', { id: String(j.id), name: j.name })} /* the id as shown on the dot and the map */ onClick={() => setPin(p => p === j.id ? null : j.id)}
          className={cn(AT_JOB_DOT, TOUCH.hit, 'cursor-pointer border-0 transition-[background] duration-300 [text-shadow:0_0_2px_rgba(0,0,0,.55)]')} style={{ background: `color-mix(in srgb, ${AT_C(j.tokens[0]?.line ?? 'memory')} 70%, #000)` }}>{j.id}</button>
        <span className="max-w-[62%] flex-none truncate">{j.name}</span>
        <span className={cn('min-w-0 flex-1 truncate text-[11px]', j.done ? 'text-[var(--ok)]' : 'text-[var(--fg3)]')}>{cur}</span>
      </div>
      <AtTraceCells j={j} clock={clock} strip={strip} />
    </motion.div>
  )
}, atSigEq)

/** The job tokens: composited boxes the frame loop moves (`reg`); re-rendered only when a token comes, goes or changes look. */
const AtTokens = memo(function AtTokens({ tokens, hj, reg, place }:
  { sig: string; tokens: WorkflowToken[]; hj: WorkflowJob | null; reg: (el: HTMLDivElement | null) => void; place: (tk: WorkflowToken) => string }) {
  return <>{tokens.map(tk => { const q = tk.phase === 'queue'; return (
    <div key={tk.uid} data-uid={tk.uid} ref={reg} className={cn('absolute top-0 left-0 will-change-transform', atDim(!hj || hj === tk.job))} style={{ ...atBox(AT_TOK), transform: place(tk) }} /* rtl-lint-ignore: map coordinates (LTR drawing) */>
      <svg viewBox={`${-AT_TOK / 2} ${-AT_TOK / 2} ${AT_TOK} ${AT_TOK}`} className="block h-full w-full overflow-visible">
        {q && <circle r={tk.parent ? 11 : 13} fill="none" stroke="var(--fg3)" strokeWidth={1.5} strokeDasharray="3 2.5" />}
        <circle r={tk.parent ? 8 : 10} fill={AT_C(tk.line)} stroke="var(--card)" strokeWidth={2.5} />
        <text y={3.6} textAnchor="middle" fill="#fff" style={{ font: '700 10px var(--font)' }}>{tk.job.id}</text>
      </svg>
    </div>) })}</>
}, atSigEq)

/** One approval card (fixed size, stacked by transform); its countdown refreshes on its own, the card only when it moves or is followed. */
const AtCard = memo(function AtCard({ tk, i, hover, machines, eng, clock, done, setHover, setPin }:
  { sig: string; tk: WorkflowToken; i: number; hover: boolean; machines: Record<string, WorkflowMachine>; eng: WorkflowEngine; clock: AtClock; done: () => void
    setHover: (h: number | null) => void; setPin: (f: (p: number | null) => number | null) => void }) {
  const t = useMessages(TRANSIT_MESSAGES), { fmt, dir } = useLocale()
  const st = machines[tk.job.type].states[tk.state], amount = Number(tk.job.data.amount) || 0, y = i * (AT_CARD_H + AT_CARD_GAP)
  return (
    <motion.div dir={dir} role="group" aria-label={t('needsApproval', { name: tk.job.name })} initial={{ opacity: 0, x: -8, y }} animate={{ opacity: 1, x: 0, y }} exit={{ opacity: 0, x: -8 }} transition={spring(0.25, 0.35)}
      {...atFollow(tk.job.id, setHover, setPin)}
      className={cn('pointer-events-auto absolute top-0 start-0 flex w-full flex-col justify-between overflow-hidden rounded-[var(--r-md)] border bg-[color-mix(in_srgb,var(--warn)_5%,var(--card))] px-2.5 py-2 text-[13px] shadow-[0_6px_20px_-8px_rgba(0,0,0,.28)]',
        hover ? 'border-[var(--warn)]' : 'border-[color-mix(in_srgb,var(--warn)_45%,var(--line))]')} style={{ height: AT_CARD_H }}>
      <div className="flex items-center gap-2">
        <span className={AT_JOB_DOT} style={{ background: `color-mix(in srgb, ${AT_C(tk.line)} 70%, #000)` }}>{tk.job.id}</span>
        <b className="min-w-0 flex-1 truncate font-medium">{tk.job.name}</b>
        <AtCountdown tk={tk} clock={clock} />
      </div>
      <div className="flex items-center gap-1.5 [@media(pointer:coarse)]:[&>button]:min-h-9">
        <span className="min-w-0 flex-1 truncate text-xs text-[var(--fg3)]">{st.label}{amount ? ` · ${fmt.money(amount, 'CHF')}` : ''}</span>
        <Button size="sm" onClick={() => { eng.resolve(tk, 'reject'); done() }}>{t('reject')}</Button>
        <Button size="sm" variant="primary" onClick={() => { eng.resolve(tk, 'approve'); done() }}>{t('approve')}</Button>
      </div>
    </motion.div>
  )
}, atSigEq)

/** The map's legend (still). */
const AtLegend = memo(function AtLegend() {
  const t = useMessages(TRANSIT_MESSAGES), nm = (n: string) => atName(t, n)
  return (
    <div className="mt-1.5 mb-3 flex flex-wrap justify-center gap-x-5 gap-y-2 text-[13px] text-[var(--fg2)] max-sm:justify-start max-sm:gap-x-4">
      {Object.entries(AT_LINES).map(([k, [, c]]) => <span key={k} className="inline-flex items-center gap-2"><i className="inline-block h-[7px] w-5 rounded-[var(--r-sm)]" style={{ background: c }} />{nm(k)}</span>)}
      <span className="inline-flex items-center gap-2"><i className="inline-block h-2.5 w-2.5 rounded-full bg-[var(--bad)]" />{t('routing')}</span>
      <span className="inline-flex items-center gap-2"><i className="inline-block h-3 w-3 rounded-full bg-[var(--card)] shadow-[inset_0_0_0_2.5px_var(--fg)]" />{t('orchestrator')}</span>
      <span className="inline-flex items-center gap-2"><i className="inline-block h-3.5 w-3.5 rounded-full bg-[var(--fg2)]" />{t('job')}</span>
      <span className="inline-flex items-center gap-2"><i className="inline-block h-3.5 w-3.5 rounded-full bg-[var(--fg2)] outline-[1.5px] outline-offset-[1.5px] outline-[var(--fg3)] outline-dashed" />{t('queued')}</span>
      <span className="inline-flex items-center gap-2"><i className="inline-block h-2.5 w-7 rounded-full bg-[linear-gradient(90deg,color-mix(in_srgb,var(--fg3)_35%,transparent),color-mix(in_srgb,var(--warn)_60%,transparent),color-mix(in_srgb,var(--bad)_65%,transparent))] rtl:bg-[linear-gradient(-90deg,color-mix(in_srgb,var(--fg3)_35%,transparent),color-mix(in_srgb,var(--warn)_60%,transparent),color-mix(in_srgb,var(--bad)_65%,transparent))]" />{t('congestion')}</span>
      <span className="inline-flex items-center gap-2"><i className="inline-block h-3.5 w-3.5 rounded-full shadow-[inset_0_0_0_3px_var(--warn)]" />{t('waiting')}</span>
    </div>
  )
})

/** Pause, speed, human in the loop, max jobs and the fire-event chips; re-renders only when one of them changes. */
const AtControls = memo(function AtControls({ eng, machines, chips, rerender }:
  { sig: string; eng: WorkflowEngine; machines: Record<string, WorkflowMachine>; chips: string[]; rerender: () => void }) {
  const t = useMessages(TRANSIT_MESSAGES), { fmt } = useLocale()
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 pb-3 text-xs text-[var(--fg2)]">
      <IconButton size="icon" variant="default" tone="default" label={eng.paused ? t('play') : t('pause')} icon={<Icon name={eng.paused ? 'play' : 'pause'} size={14} filled />} onClick={() => { eng.paused = !eng.paused; rerender() }} />
      <label className="contents"><span>{t('speed')}</span><Slider min={0.25} max={3} step={0.25} value={eng.speed} onChange={v => { eng.speed = v; rerender() }} className={AT_RANGE} /></label>
      <span className="ui-num w-9">{fmt.number(eng.speed)}×</span>
      <span className="contents [@media(pointer:coarse)]:[&>label]:min-h-8"><Switch checked={eng.hitl} onChange={v => { eng.setHitl(v); rerender() }} label={<span className="me-1">{t('hitl')}</span>} /></span>
      <label className="contents"><span className="ms-2 max-sm:ms-0">{t('maxJobs')}</span><Slider min={1} max={6} step={1} value={eng.maxJobs} onChange={v => { eng.maxJobs = v; rerender() }} className={AT_RANGE} /></label>
      <span className="ui-num w-3.5">{fmt.number(eng.maxJobs)}</span>
      <span className="flex-1 max-sm:hidden" />
      <span className="max-sm:basis-full">{t('fire')}</span>
      <span className="flex flex-wrap gap-1.5">{chips.map(ty => (
        <Chip key={ty} dir="ltr" onClick={() => { eng.fire(ty); rerender() }} className="!h-7 font-[family-name:var(--mono)] !text-[11px] !font-normal [@media(pointer:coarse)]:!h-9">{machines[ty].event}</Chip>))}</span>
    </div>
  )
}, atSigEq)

/**
 * Live multi-agent "transit map", driven by the same WorkflowEngine as StateMachine. The Indexing
 * loop and the Intake endpoint fire events into a queue (drawn on the map, under Intake); jobs start as slots free up
 * and travel their state graph along the drawn lines, bends included. Agents take one job at a time: the others line
 * up on the incoming line with a counter, and track segments warm up (grey, amber, red) as tokens pile onto them.
 * Orchestrators route with guards, Product forks reviews and joins them, endpoints emit follow-up triggers. Human and
 * Risk stations wait for approval when human-in-the-loop is on: the station gets a countdown ring and an approval card
 * floats beside it, over the map, so nothing on the page moves. Pause, speed and max-jobs controls, fire-event chips,
 * and a live trace table (time, tokens, USD) whose connectors link a follow-up job to the job that triggered it: hover
 * a row, or press its job button, to follow that job on the map. The still drawing renders once; tokens and the train
 * are composited layers moved every frame without re-rendering (30 fps on touch screens); the panels refresh about 8
 * times a second, and only the parts that changed. Reduced motion places tokens at their stations without
 * travel. On phones the map keeps a readable size and scrolls sideways inside the card, as does the trace table.
 * Pass `machines` whose stations are the map's (the sample is `AGENT_WORKFLOWS` / `AGENT_WORKFLOW_ORDER` in
 * `@lyndon/ui/examples`); without any, the map is drawn with no traffic.
 */
export function AgentTransitMap({ machines = AT_NO_MACHINES, order = AT_NO_ORDER, className }:
  { machines?: Record<string, WorkflowMachine>; order?: string[]; className?: string }) {
  const eng = useMemo(() => atEngine(machines, order), [machines, order])
  const t = useMessages(TRANSIT_MESSAGES), { dir } = useLocale()
  const nm = (n: string) => atName(t, n)
  const agents = useMemo(() => new Set(Object.values(machines).flatMap(m => Object.values(m.states).filter(s => s.work).map(s => s.at[1]))), [machines])
  const [, setTick] = useState(0)
  const rerender = useCallback(() => setTick(x => (x + 1) % 1e6), [])
  const [hovered, setHover] = useState<number | null>(null), [pin, setPin] = useState<number | null>(null)
  const hover = hovered ?? pin // the job being followed on the map
  const { ref: host, visible } = useViewport<HTMLDivElement>(null, { amount: 0 })
  const narrow = useMediaQuery('(max-width: 639px)')
  const reduce = !!useReducedMotion()
  const [stageRef, stageW] = useWidth<HTMLDivElement>()
  const [mapScrollRef, mapEdges] = useScrollEdges<HTMLDivElement>()
  const [traceScrollRef, traceEdges] = useScrollEdges<HTMLDivElement>()
  const fx = useRef({ sparks: [] as AtSpark[], fading: [] as AtFade[], hubFlash: [0, 0, 0], evLabel: { text: '', n: 0 }, uid: 0 })
  const tokenEls = useRef(new Map<number, HTMLDivElement>()), trainEl = useRef<HTMLDivElement>(null), trainAnim = useRef<Animation | null>(null), since = useRef(0)
  const disp = useRef(new Map<number, AtDisp>())
  /** each token's transform when it mounted: React keeps passing that same value, so it never undoes the frame loop's writes */
  const born = useRef(new Map<number, string>()), trainBorn = useRef('')
  /** Puts the train where the engine clock says (jumping only if it drifted more than half a degree) and runs or stops it with the map. */
  const syncTrain = useCallback((running: boolean) => {
    const el = trainEl.current, a = trainAnim.current; if (!el) return
    const deg = atTrainDeg(eng.clock)
    if (!a) { el.style.transform = `rotate(${deg.toFixed(1)}deg)`; return } // reduced motion: it steps with the panels
    const want = (deg / 360) * AT_LAP_MS
    let d = want - (Number(a.currentTime ?? 0) % AT_LAP_MS); d -= Math.round(d / AT_LAP_MS) * AT_LAP_MS
    if (Math.abs(d) > AT_LAP_MS / 720) a.currentTime = want
    if (a.playbackRate !== eng.speed) a.playbackRate = eng.speed
    if (running && a.playState !== 'running') a.play(); else if (!running && a.playState === 'running') a.pause()
  }, [eng])
  useEffect(() => {
    const el = trainEl.current; if (!el || reduce || typeof el.animate !== 'function') return
    const a = el.animate([{ transform: 'rotate(0deg)' }, { transform: 'rotate(360deg)' }], { duration: AT_LAP_MS, iterations: Infinity, easing: 'linear' })
    a.pause(); trainAnim.current = a
    return () => { a.cancel(); trainAnim.current = null }
  }, [reduce])
  const reduceRef = useRef(reduce); reduceRef.current = reduce
  const heatTw = useMemo(() => atHeatTween(), []), clockStore = useMemo(() => atClockStore(), [])
  const loopOn = visible && !eng.paused
  const marks = useMemo(() => atMarks(), [])
  // heat tweens and marks started (or left running) while the frame loop is stopped (paused) run on a loop of their own
  const [heatSolo, setHeatSolo] = useState(false)
  const xyOf = (tk: WorkflowToken) => { const d = disp.current.get(tk.uid); return d ? atPoint(d.line, d.s) : atPoint(tk.line, atPos(tk.line, machines[tk.job.type].states[tk.state].at[1]) ?? 0) }
  // engine events → the short-lived marks on the map (sparks, fading tokens, hub flashes, the loop's event label)
  useEffect(() => eng.subscribe(ev => {
    const F = fx.current, now = performance.now(), calm = reduceRef.current
    if (ev.kind === 'queued') {
      if (ev.cause === 'intake' && !calm) { const q = atPoint('research', AT_SP.research.Intake); F.sparks = [...F.sparks, { id: ++F.uid, x: q.x, y: q.y, text: ev.ev, t: now }] }
      else if (ev.cause !== 'emit') F.evLabel = { text: ev.ev, n: F.evLabel.n + 1 }
    } else if (ev.kind === 'enter') {
      const st = eng.machines[ev.job.type].states[ev.state], hi = st.orch ? AT_HUBS.findIndex(h => h[0] === st.at[1]) : -1
      if (hi >= 0 && !calm) F.hubFlash[hi]++
    } else if (ev.kind === 'trigger' && ev.ev && !calm) {
      const p = xyOf(ev.token); F.sparks = [...F.sparks, { id: ++F.uid, x: p.x, y: p.y, text: ev.ev, t: now }]
    } else if (ev.kind === 'done') {
      const p = xyOf(ev.token); F.fading = [...F.fading, { id: ev.token.uid, x: p.x, y: p.y, line: ev.token.line, jid: ev.job.id, t: now, small: !!ev.token.parent }]
      disp.current.delete(ev.token.uid)
    }
  }), [eng]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { // two events to start with, so the map is busy as soon as it is seen
    const t1 = setTimeout(() => eng.fire(), 400), t2 = setTimeout(() => eng.fire(), 2000)
    return () => { clearTimeout(t1); clearTimeout(t2) }
  }, [eng])
  // every frame: step the engine, then glide each token towards its place on the line and write its transform straight
  // into its composited box (no React state, no layout); React re-renders about 8 times a second for counters, heat and panels
  useFrameLoop(loopOn, (dt, now) => {
    eng.tick(dt)
    heatTw.step(now); marks.step(now)
    const calm = reduceRef.current
    const want = atLayout(eng, agents, calm), D = disp.current, v = (AT_SPEED * eng.speed * 2 + 60) * dt
    for (const [uid, [line, s]] of want) {
      let d = D.get(uid)
      if (!d || calm) d = { line, s, tr: d?.tr ?? '' }
      else {
        if (d.line !== line) { const p = atPoint(d.line, d.s); d.line = line; d.s = atNear(line, [p.x, p.y]) } // changing lines at a shared station
        const diff = s - d.s; d.s = Math.abs(diff) > 320 ? s : d.s + Math.max(-v, Math.min(v, diff))
      }
      const tr = atAt(atPoint(d.line, d.s), AT_TOK), el = tokenEls.current.get(uid)
      if (tr !== d.tr && el) { d.tr = tr; el.style.transform = tr }
      D.set(uid, d)
    }
    for (const uid of D.keys()) if (!want.has(uid)) D.delete(uid)
    if ((since.current += dt) >= 0.125) {
      since.current = 0
      syncTrain(true)
      const F = fx.current, now = performance.now()
      if (F.sparks.some(s => now - s.t >= 1900)) F.sparks = F.sparks.filter(s => now - s.t < 1900)
      if (F.fading.some(f => now - f.t >= 800)) F.fading = F.fading.filter(f => now - f.t < 800)
      stripNow.current = atStrip(eng.clock)
      for (const el of strips.current) el.style.transform = stripNow.current
      // the map re-renders only when what it shows changed (a token, the queue, heat, approvals, marks); running trace
      // rows, countdowns and rings follow the clock store on their own. Committed in this frame, so the panels repaint
      // with the tokens instead of in a frame of their own.
      const sig = atStructSig(eng, fx.current)
      flushSync(() => { if (sig !== lastSig.current) { lastSig.current = sig; rerender() } clockStore.set(eng.clock) })
    }
  }, { coarseFps: 30 })
  const strips = useRef(new Set<HTMLDivElement>()), stripNow = useRef(atStrip(eng.clock)), lastSig = useRef('')
  const regStrip = useCallback((el: HTMLDivElement | null) => {
    if (!el) return
    strips.current.add(el); el.style.transform = stripNow.current
    return () => { strips.current.delete(el) }
  }, [])
  // the trace window slides by transform, not layout: written straight into each row's strip (an inherited custom
  // property would restyle every element of every row instead)
  useLayoutEffect(() => { stripNow.current = atStrip(eng.clock); for (const el of strips.current) if (el.style.transform !== stripNow.current) el.style.transform = stripNow.current })
  // paused mid-tween, or a mark mounted while paused (setHeatSolo(true) settles: same value, no further render)
  useLayoutEffect(() => { if (!loopOn && (heatTw.busy() || marks.busy())) setHeatSolo(true) }) // eslint-disable-line react-hooks/exhaustive-deps
  useFrameLoop(heatSolo && !loopOn, (_, now) => { const a = heatTw.step(now), b = marks.step(now); if (!a && !b) setHeatSolo(false) }, { coarseFps: 30 })
  /** A token's box mounts at its current place; from then on only the frame loop moves it. */
  const regToken = useCallback((el: HTMLDivElement | null) => {
    if (!el) return
    const uid = Number(el.dataset.uid)
    tokenEls.current.set(uid, el)
    const d = disp.current.get(uid); if (d) d.tr = el.style.transform
    return () => { tokenEls.current.delete(uid); born.current.delete(uid) }
  }, [])
  const F = fx.current
  const hj = hover !== null ? eng.jobs.find(j => j.id === hover) ?? null : null
  const lit = (k: string) => !hj || hj.lines.has(k)
  const tokens = eng.jobs.filter(j => !j.done).flatMap(j => j.tokens)
  const intakeType = eng.intake ? eng.typeOf(eng.intake) : undefined
  const chips = [...order, ...(intakeType && !order.includes(intakeType) ? [intakeType] : [])].filter(t => machines[t])
  const placeOf = (tk: WorkflowToken) => { let b = born.current.get(tk.uid); if (b === undefined) born.current.set(tk.uid, b = atAt(xyOf(tk), AT_TOK)); return b }
  if (!trainBorn.current) trainBorn.current = `rotate(${atTrainDeg(eng.clock).toFixed(1)}deg)`
  useEffect(() => syncTrain(loopOn), [syncTrain, loopOn, reduce])
  const stationXY = (line: string, stn: string) => atPoint(line, atPos(line, stn) ?? 0)

  const heatKey = atHeatKey(eng)
  const litKey = hj ? [...hj.lines].join(',') : null
  useLayoutEffect(() => {
    if (heatTw.set(heatKey, hj ? hj.lines : null, performance.now(), reduce, host.current) && !loopOn) setHeatSolo(true)
  }, [heatTw, heatKey, litKey, reduce, loopOn]) // eslint-disable-line react-hooks/exhaustive-deps
  // queue counters: one per agent with a queue, beside the head of its line-up, away from the station's label
  const queueTags = Object.entries(eng.queues).filter(([, q]) => q.length).map(([stn, q]) => {
    const tk = q[0], dir = atDirOf(tk), b = atPos(tk.line, stn) ?? 0, p = atPoint(tk.line, b - dir * AT_HEAD), r = p.a * Math.PI / 180
    const lab = AT_ST.find(x => x[0] === stn), nx = -Math.sin(r), ny = Math.cos(r), sd = lab && nx * lab[3] + ny * lab[4] > 0 ? -1 : 1
    return { stn, n: q.length, x: p.x + nx * sd * 24, y: p.y + ny * sd * 24 }
  })
  // approvals: grouped by station (a countdown ring on the station, cards anchored beside it)
  const waitBy = new Map<string, WorkflowToken[]>()
  eng.waiting.forEach(tk => { const k = narrow ? '*' : `${tk.line}|${machines[tk.job.type].states[tk.state].at[1]}`; waitBy.set(k, [...(waitBy.get(k) ?? []), tk]) })
  const rings = atRings(eng, machines)
  const maxCards = narrow ? 1 : AT_CARDS // phones: one card in a strip above the map, the rest counted
  const stageH = stageW * (AT_H / AT_W), cardW = narrow ? stageW : AT_CARD_W
  const fs = narrow ? 1.2 : 1 // phones: the map is drawn at ~0.8 scale, so labels grow to stay ≥ 11px on screen
  const anchorOf = (k: string) => {
    if (k === '*') return { left: 0, top: 0 }
    const [line, stn] = k.split('|'), p = stationXY(line, stn), lab = AT_ST.find(x => x[0] === stn)
    const past = lab && lab[3] > 0 ? lab[3] + stn.length * 8 + 14 : 30 // clear of the station's label when it sits to the right
    return { left: Math.max(4, Math.min(((p.x + past) / AT_W) * stageW, stageW - cardW - 4)), top: Math.max(4, (p.y / AT_H) * stageH - 26) }
  }
  // trace: follow-up jobs link to the job whose finish triggered them; the followed job's chain lights up
  const rowOf = new Map(eng.jobs.map((j, i) => [j.id, i]))
  const chain = new Set<number>()
  if (hover !== null) {
    for (let id: number | undefined = hover; id !== undefined && !chain.has(id); id = eng.jobs.find(j => j.id === id)?.parent) chain.add(id)
    const down = (id: number) => eng.jobs.forEach(j => { if (j.parent === id && !chain.has(j.id)) { chain.add(j.id); down(j.id) } }); down(hover)
  }
  const tx = (t: number) => `${(t / AT_WIN) * 100}%`
  const queueShown = eng.queue.slice(0, AT_EQ_ROWS), running = tokens.filter(t => !t.parent).length, active = eng.jobs.filter(j => !j.done).length

  const cardDone = useCallback(() => { setHover(null); setPin(null); rerender() }, [rerender])
  /** The approval cards waiting at one station (or, on phones, all of them): fixed-size, stacked by transform. */
  const atCards = (k: string, q: WorkflowToken[]) => (
    <div key={k} className={cn(k === '*' && 'pointer-events-none absolute inset-x-0 top-0')}>
      <AnimatePresence initial={false}>
        {q.slice(0, maxCards).map((tk, i) => <AtCard key={tk.uid} sig={`${i}|${hover === tk.job.id}|${tk.state}`} tk={tk} i={i} hover={hover === tk.job.id}
          machines={machines} eng={eng} clock={clockStore} done={cardDone} setHover={setHover} setPin={setPin} />)}
        {q.length > maxCards && <motion.div key="more" initial={{ opacity: 0, y: maxCards * (AT_CARD_H + AT_CARD_GAP) }} animate={{ opacity: 1, y: maxCards * (AT_CARD_H + AT_CARD_GAP) }} exit={{ opacity: 0 }}
          className="absolute top-0 start-0"><Badge className="border border-[var(--line)] !bg-[var(--card)] font-normal">{t('moreWaiting', { n: q.length - maxCards })}</Badge></motion.div>}
      </AnimatePresence>
    </div>
  )

  return (
    <div ref={host} className={cn('flex flex-col', className)}>
      {/* the map is geometry: it stays left to right in every locale (its labels are translated; cards set the page's dir) */}
      <div ref={stageRef} dir="ltr" className="relative">
      {/* phones: approvals get their own fixed-height strip above the map, so they never cover stations or shift anything */}
      {narrow && <div className="relative mb-2" style={{ height: AT_CARD_H + 26 }}>
        {!eng.waiting.length && <div className="grid h-[80px] place-items-center rounded-[var(--r-md)] border border-dashed border-[var(--line2)] text-xs text-[var(--fg3)]" dir={dir}>{t('noApprovals')}</div>}
        {stageW > 0 && waitBy.has('*') && atCards('*', waitBy.get('*')!)}
      </div>}
      <div ref={mapScrollRef} className={cn(narrow && '-mx-1 overflow-x-auto overscroll-x-contain rounded-[var(--r-md)] px-1 [contain:inline-size] [scrollbar-width:thin]')} tabIndex={narrow ? 0 : undefined} aria-label={narrow ? t('mapScrolls') : undefined}>
      <div className={cn('relative', narrow && 'min-w-[820px]')}>
        <AtMapBase lit={litKey} fs={fs} regHeat={heatTw.reg} />
        {/* the train (under the Index station) and the waiting stations' pulses (under their rings) */}
        <div aria-hidden className={AT_HTML_LAYER}>
          <div ref={trainEl} className={cn('absolute', atDim(lit('index')))} style={{ ...atCentred(AT_LC[0], AT_LC[1], AT_TRAIN_BOX), transform: trainBorn.current }} /* rtl-lint-ignore: map coordinates (LTR drawing) */>
            <div className="absolute rotate-90" style={{ left: `${(2 * AT_LR / AT_TRAIN_BOX) * 100}%`, top: `${(AT_LR / AT_TRAIN_BOX) * 100}%`, width: `${(AT_TRAIN / AT_TRAIN_BOX) * 100}%`, height: `${(AT_TRAIN / AT_TRAIN_BOX) * 100}%` }} /* rtl-lint-ignore: map coordinates (LTR drawing) */>
              <svg viewBox={`${-AT_TRAIN / 2} ${-AT_TRAIN / 2} ${AT_TRAIN} ${AT_TRAIN}`} className="block h-full w-full overflow-visible"><rect x={-12} y={-4} width={24} height={8} rx={4} fill="var(--card)" stroke={AT_C('index')} strokeWidth={2} /></svg>
            </div>
          </div>
          {!reduce && rings.map(r => <AtPulse key={r.k} x={r.x} y={r.y} active={visible} />)}
        </div>
        <svg viewBox={AT_VIEWBOX} aria-hidden className={AT_SVG_LAYER}>
          {/* the global event queue, waiting for a job slot */}
          <AtQueuePanel sig={`${queueShown.map(q => q.id).join(',')}|${eng.queue.length}|${eng.queueMax}|${eng.maxJobs}|${running}|${active}|${eng.dropped}|${narrow}`}
            queue={queueShown} qlen={eng.queue.length} qmax={eng.queueMax} maxJobs={eng.maxJobs} running={running} active={active} dropped={eng.dropped} narrow={narrow} />
          <AtSparks sig={F.sparks.map(s => s.id).join(',')} sparks={F.sparks} reg={marks.reg} />
          <AtHubs />
          {/* stations waiting for a human: a countdown ring (and how many are waiting) */}
          <AtRings eng={eng} machines={machines} clock={clockStore} />
        </svg>
        {/* routing flashes on the hubs, then the tokens: composited boxes the frame loop moves */}
        <div aria-hidden className={AT_HTML_LAYER}>
          {AT_HUBS.map(([n, [x, y]], i) => F.hubFlash[i] > 0 && <AtFlash key={n + F.hubFlash[i]} x={x} y={y} />)}
          <AtTokens sig={`${tokens.map(tk => `${tk.uid}:${tk.phase === 'queue'}:${!!tk.parent}:${tk.line}`).join(',')}|${hj?.id}`} tokens={tokens} hj={hj} reg={regToken} place={placeOf} />
          {F.fading.map(f => <motion.div key={'f' + f.id} className="absolute top-0 left-0" style={{ ...atBox(AT_TOK), transform: atAt(f, AT_TOK) }} initial={{ opacity: 1 }} animate={{ opacity: 0 }} transition={{ duration: 0.8 }} /* rtl-lint-ignore: map coordinates (LTR drawing) */>
            <svg viewBox={`${-AT_TOK / 2} ${-AT_TOK / 2} ${AT_TOK} ${AT_TOK}`} className="block h-full w-full overflow-visible">
              <circle r={f.small ? 8 : 10} fill={AT_C(f.line)} stroke="var(--card)" strokeWidth={2.5} /><text y={3.6} textAnchor="middle" fill="#fff" style={{ font: '700 10px var(--font)' }}>{f.jid}</text>
            </svg>
          </motion.div>)}
        </div>
        <svg viewBox={AT_VIEWBOX} aria-hidden className={AT_SVG_LAYER}>
          <g style={{ font: `${13 * fs}px var(--font)` }} fill="var(--fg2)">
            <AtLabels fs={fs} />
            {F.evLabel.text && <text key={F.evLabel.n} ref={marks.reg} data-mark="ev" x={AT_LC[0]} y={AT_LC[1] + 5} textAnchor="middle" style={{ font: '600 11px var(--mono)', opacity: 0 }}>{F.evLabel.text}</text>}
          </g>
          {/* queue counters beside each agent's line-up */}
          <g>
            {queueTags.map(t => { const w = (26 + String(t.n).length * 8) * fs; return (
              <g key={t.stn} transform={`translate(${t.x.toFixed(1)},${t.y.toFixed(1)})`}>
                <rect x={-w / 2} y={-11 * fs} width={w} height={22 * fs} rx={11 * fs} fill="var(--card)" stroke="var(--warn)" strokeWidth={1.5} />
                <text y={5 * fs} textAnchor="middle" fill="var(--fg)" style={{ font: `600 ${13 * fs}px var(--font)` }}>+{t.n}</text>
              </g>) })}
          </g>
        </svg>
      </div>
      </div>
      {narrow && <ScrollEdges {...mapEdges} hint={t('swipeMap')} className="!top-[114px]" />}
      {/* approvals float over the map beside the waiting station (pinned top-left on phones); fixed-size cards stacked
          by transform, so neither the page nor the other cards ever shift */}
      <span className="sr-only" aria-live="polite" dir={dir}>{eng.waiting.length ? t('waitingSr', { n: eng.waiting.length }) : ''}</span>
      {stageW > 0 && [...waitBy].filter(([k]) => k !== '*').map(([k, q]) => { const a = anchorOf(k); return (
        <div key={k} className="pointer-events-none absolute z-[2]" style={{ left: a.left, top: a.top, width: cardW }} /* rtl-lint-ignore: map coordinates (LTR drawing) */>{atCards(k, q)}</div>) })}
      </div>

      <AtLegend />

      <AtControls sig={`${eng.paused}|${eng.speed}|${eng.hitl}|${eng.maxJobs}|${chips.join(',')}`} eng={eng} machines={machines} chips={chips} rerender={rerender} />

      <div className="relative border-t border-[var(--line)]">
      <div ref={traceScrollRef} className="overflow-x-auto overscroll-x-contain [contain:inline-size]" tabIndex={narrow ? 0 : undefined} aria-label={narrow ? t('traceScrolls') : undefined}>
        <div className="min-w-[640px]">
          <div className={cn('grid h-9 items-center border-b border-[var(--line)] text-xs text-[var(--fg3)]', AT_TRACE_COLS)}>
            <span className="sticky start-0 z-[1] bg-[var(--card)] text-sm font-semibold text-[var(--fg)]">{t('trace')}</span>
            {/* time runs left to right in every locale */}
            <span dir="ltr" className="relative h-full font-[family-name:var(--mono)] text-[11px]"><span className="absolute top-2.5 start-0">{t('ago', { n: AT_WIN })}</span><span className="absolute top-2.5 left-1/2 -translate-x-1/2">{t('ago', { n: AT_WIN / 2 })}</span><span className="absolute top-2.5 end-0">{t('now')}</span></span>
            <span className="text-end font-[family-name:var(--mono)]">{t('time')}</span><span className="text-end font-[family-name:var(--mono)]">{t('tokens')}</span><span className="text-end font-[family-name:var(--mono)]">{t('usd')}</span>
          </div>
          {/* a fixed-height list: rows sit at translateY(index), the window slides by transform, numbers keep a fixed width */}
          <div className="relative overflow-y-auto overscroll-y-contain" style={{ height: AT_ROWS * AT_ROW_H }}>
            <div className="relative" style={{ height: Math.max(AT_ROWS, eng.jobs.length) * AT_ROW_H }}>
              {!eng.jobs.length && <span className="absolute top-3 start-0 text-xs text-[var(--fg3)]">{t('jobsAppear')}</span>}
              {/* follow-up connectors: from the triggering job at the moment it emitted, to the follow-up job's start */}
              <div aria-hidden className={cn('pointer-events-none absolute inset-0 grid', AT_TRACE_COLS)}>
                <span />
                <div dir="ltr" className="relative overflow-x-clip">
                  <div ref={regStrip} className="absolute inset-0">
                    {eng.jobs.map(j => {
                      const pi = j.parent === undefined ? undefined : rowOf.get(j.parent), ci = rowOf.get(j.id)!
                      if (pi === undefined) return null
                      const te = j.queuedAt ?? j.t0, up = ci < pi, yp = pi * AT_ROW_H + AT_ROW_H / 2 + (up ? -7 : 7), yc = ci * AT_ROW_H + AT_ROW_H / 2
                      const on = chain.has(j.id) && chain.has(j.parent!), col = on ? 'border-[var(--fg2)]' : 'border-[color-mix(in_srgb,var(--fg3)_55%,transparent)]'
                      return <Fragment key={j.id}>
                        <span className={cn('absolute w-0 border-s transition-colors duration-200', col)} style={{ left: tx(te), top: 0, height: Math.abs(yc - yp), transform: `translateY(${Math.min(yp, yc)}px)` }} /* rtl-lint-ignore: time axis (LTR) */ />
                        <span className={cn('absolute h-0 border-t transition-colors duration-200', col, j.t0 - te > 0.3 && 'border-dashed')} style={{ left: tx(te), top: 0, width: `calc(${tx(Math.max(0, j.t0 - te))} + 3px)`, transform: `translateY(${yc}px)` }} /* rtl-lint-ignore: time axis (LTR) */ />
                      </Fragment>
                    })}
                  </div>
                </div>
              </div>
              <AnimatePresence initial={false}>
                {eng.jobs.map((j, i) => {
                  const cur = j.done ? (j.rejected ? t('rejected') : t('done')) : j.tokens.length > 1 ? t('inReview', { n: j.tokens.length - 1 }) : j.tokens[0]?.phase === 'queue' ? t('waitingFor', { station: nm(machines[j.type].states[j.tokens[0].next!]?.at[1] ?? '') }) : (machines[j.type].states[j.state]?.label ?? j.state)
                  return <AtTraceRow key={j.id} sig={`${i}|${cur}|${j.done}|${j.tokens[0]?.line}|${hover === j.id}|${pin === j.id}`}
                    j={j} i={i} cur={cur} clock={clockStore} hover={hover === j.id} pinned={pin === j.id} strip={regStrip} setHover={setHover} setPin={setPin} />
                })}
              </AnimatePresence>
            </div>
          </div>
        </div>
      </div>
      {narrow && <ScrollEdges left={false} right={traceEdges.right} touched={traceEdges.touched} hint={t('swipeTrace')} />}
      </div>
    </div>
  )
}
