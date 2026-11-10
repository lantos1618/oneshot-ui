import { memo, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { motion, useReducedMotion } from 'motion/react'
import { Button, Icon, IconButton, ScrollEdges, cn, defineMessages, sleep, spring, useControllable, useMediaQuery, useMessages, useRoving, useScrollEdges, useSize, useWidth } from './core'
import { ActiveIndicator, SegmentedControl } from './forms'
import { CopyButton } from './feedback'
import { useViewport } from './motion'
import type { MarkdownCodeRenderer } from './markdown'

/* ════════════════════════════════════════════════════════════════════════════
 * Code: highlighted block, install command, tabbed example, terminal, diff.
 * Tokenised in the page with one regex per language (no highlighter library).
 * Code reads left to right in every locale: the line rows, terminal and diff panes set dir="ltr"; headers mirror.
 * ══════════════════════════════════════════════════════════════════════════ */

/** The code views' UI strings (machine-drafted de/ar). Override with `<UIProvider messages={{ 'code.wrap': … }}>`. */
export const CODE_MESSAGES = defineMessages('code', {
  en: {
    code: 'Code', scrolls: '{label}, scrolls', copy: 'Copy', snippet: 'snippet', changes: 'Changes', changesTitle: 'Changes since the previous version',
    wrap: 'Wrap', wrapLines: 'Wrap lines', collapse: 'Collapse', showAll: 'Show all {count, number} lines', packageManager: 'Package manager',
    installCommand: 'Install command', exampleLanguage: 'Example language', example: '{label} example', replay: 'Replay', unified: 'Unified', split: 'Split',
    copyNew: 'Copy new version', changesTo: 'Changes to {file}', theFile: 'the file', before: 'Before', after: 'After', fileChanges: 'changes',
  },
  de: {
    code: 'Code', scrolls: '{label}, scrollbar', copy: 'Kopieren', snippet: 'Ausschnitt', changes: 'Änderungen', changesTitle: 'Änderungen seit der vorigen Version',
    wrap: 'Umbruch', wrapLines: 'Zeilen umbrechen', collapse: 'Einklappen', showAll: 'Alle {count, number} Zeilen anzeigen', packageManager: 'Paketmanager',
    installCommand: 'Installationsbefehl', exampleLanguage: 'Sprache des Beispiels', example: 'Beispiel in {label}', replay: 'Erneut abspielen', unified: 'Zusammen', split: 'Geteilt',
    copyNew: 'Neue Version kopieren', changesTo: 'Änderungen an {file}', theFile: 'der Datei', before: 'Vorher', after: 'Nachher', fileChanges: 'Änderungen',
  },
  ar: {
    code: 'الشيفرة', scrolls: '{label}، قابل للتمرير', copy: 'نسخ', snippet: 'مقتطف', changes: 'التغييرات', changesTitle: 'التغييرات منذ الإصدار السابق',
    wrap: 'التفاف', wrapLines: 'التفاف الأسطر', collapse: 'طي', showAll: 'عرض كل الأسطر ({count, number})', packageManager: 'مدير الحزم',
    installCommand: 'أمر التثبيت', exampleLanguage: 'لغة المثال', example: 'مثال {label}', replay: 'إعادة التشغيل', unified: 'موحَّد', split: 'منقسم',
    copyNew: 'نسخ الإصدار الجديد', changesTo: 'التغييرات على {file}', theFile: 'الملف', before: 'قبل', after: 'بعد', fileChanges: 'التغييرات',
  },
})

export type CodeLanguage = 'ts' | 'js' | 'py' | 'sh' | 'json'
type CodeTokenKind = 'com' | 'str' | 'kw' | 'num' | 'fn' | 'attr' | 'prop' | 'var' | 'pre'

const CODE_TOKEN_CLASS: Record<CodeTokenKind, string> = {
  com: 'text-[var(--fg3)] italic',
  str: 'text-[color-mix(in_srgb,var(--ok)_72%,var(--fg))]',
  kw: 'text-[color-mix(in_srgb,var(--bad)_75%,var(--fg))]',
  num: 'text-[color-mix(in_srgb,var(--c3)_60%,var(--fg))]',
  fn: 'text-[color-mix(in_srgb,var(--accent)_82%,var(--fg))]',
  attr: 'text-[color-mix(in_srgb,var(--warn)_66%,var(--fg))]',
  prop: 'text-[color-mix(in_srgb,var(--accent)_82%,var(--fg))]',
  var: 'text-[color-mix(in_srgb,var(--c3)_60%,var(--fg))]',
  pre: '',
}
const CODE_JS: [RegExp, CodeTokenKind[]] = [/(\/\/.*$)|(`(?:[^`\\]|\\.)*`|'(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*")|\b(const|let|var|function|return|if|else|for|while|import|from|export|default|await|async|new|class|extends|true|false|null|undefined|try|catch|throw|of|in|type|interface|as|satisfies|typeof|keyof)\b|\b(\d+(?:\.\d+)?)\b|([A-Za-z_$][\w$]*)(?=\s*\()/g, ['com', 'str', 'kw', 'num', 'fn']]
const CODE_LANGS: Record<CodeLanguage, [RegExp, CodeTokenKind[]]> = {
  ts: CODE_JS,
  js: CODE_JS,
  py: [/(#.*$)|(f?"(?:[^"\\]|\\.)*"|f?'(?:[^'\\]|\\.)*')|\b(def|class|return|import|from|as|if|elif|else|for|in|while|with|True|False|None|await|async|lambda|try|except|raise|print)\b|\b(\d+(?:\.\d+)?)\b|([A-Za-z_]\w*)(?=\s*\()|(@\w+)/g, ['com', 'str', 'kw', 'num', 'fn', 'attr']],
  sh: [/(#.*$)|("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')|(^|\s)(npm|pnpm|yarn|bun|npx|curl|git|cd|export|echo)\b|(\s-{1,2}[\w-]+)|(\$\w+|\$\{[^}]+\})/g, ['com', 'str', 'pre', 'kw', 'attr', 'var']],
  json: [/("(?:[^"\\]|\\.)*")(?=\s*:)|("(?:[^"\\]|\\.)*")|\b(true|false|null)\b|(-?\d+(?:\.\d+)?)/g, ['prop', 'str', 'kw', 'num']],
}
export const CODE_LANGUAGE_NAMES: Record<CodeLanguage, string> = { ts: 'TypeScript', js: 'JavaScript', py: 'Python', sh: 'Shell', json: 'JSON' }

/** Guess the language from a file name (`run-import.ts` → ts). */
export function codeLanguageOf(filename?: string): CodeLanguage {
  const ext = filename?.split('.').pop()?.toLowerCase() ?? ''
  if (ext === 'ts' || ext === 'tsx') return 'ts'
  if (ext === 'py') return 'py'
  if (ext === 'sh' || ext === 'bash' || ext === 'zsh') return 'sh'
  if (ext === 'json') return 'json'
  return ext === 'js' || ext === 'jsx' || ext === 'mjs' ? 'js' : 'ts'
}

/** Markdown fence info words CodeBlock highlights, and the language each one means. */
export const CODE_FENCE_LANGS: Readonly<Record<string, CodeLanguage>> = {
  ts: 'ts', tsx: 'ts', typescript: 'ts', js: 'js', jsx: 'js', javascript: 'js', mjs: 'js', cjs: 'js', py: 'py', python: 'py',
  sh: 'sh', bash: 'sh', shell: 'sh', zsh: 'sh', console: 'sh', 'shell-session': 'sh', json: 'json', jsonc: 'json', json5: 'json',
}

/** Lines longer than this render as plain text (minified bundles, data blobs): highlighting them helps nobody and costs time. */
export const CODE_HIGHLIGHT_MAX = 2000

/**
 * Highlight one line of code: returns spans coloured with theme tokens. The patterns have no overlapping alternatives
 * (string bodies are `[^"\\]|\\.`), so time is linear in the line; lines over CODE_HIGHLIGHT_MAX come back as plain text.
 */
export function highlightCode(line: string, lang: CodeLanguage = 'ts'): ReactNode[] {
  if (line.length > CODE_HIGHLIGHT_MAX) return [line]
  const [src, names] = CODE_LANGS[lang] ?? CODE_JS
  const re = new RegExp(src.source, src.flags)
  const out: ReactNode[] = []; let last = 0, k = 0, m: RegExpExecArray | null
  while ((m = re.exec(line))) {
    if (m[0] === '') { re.lastIndex++; continue }
    if (m.index > last) out.push(line.slice(last, m.index))
    let gi = 1; while (gi < m.length && m[gi] === undefined) gi++
    const kind = names[gi - 1]
    if (kind === 'pre') out.push(m[gi], <span key={k++} className={CODE_TOKEN_CLASS.kw}>{m[gi + 1]}</span>)
    else out.push(<span key={k++} className={kind ? CODE_TOKEN_CLASS[kind] : undefined}>{m[0]}</span>)
    last = m.index + m[0].length
  }
  if (last < line.length) out.push(line.slice(last))
  return out
}

/** One step of an lcsDiff: kept (`=`, both indexes), removed (`-`, index in before) or added (`+`, index in after). Indexes are 0-based. */
export type LcsStep = { type: '=' | '-' | '+'; a: number | null; b: number | null }
/** lcsDiff's default size cap: the changed middle (after the common start and end are trimmed) may hold at most this many cells. */
export const LCS_MAX_CELLS = 4_000_000

/**
 * Diff two sequences by longest common subsequence: lcsDiff(beforeLines, afterLines) or over words, items, anything.
 * `equal` compares two items (default ===); `prefer` picks which side comes first when both are possible (default 'delete').
 * The common start and end are matched first; if the changed middle is still larger than `maxCells` (m·n, default
 * 4 million, about 16 MB), it comes back as one block removed and one block added instead of an exact diff.
 */
export function lcsDiff<T>(before: readonly T[], after: readonly T[], { equal = (x: T, y: T) => x === y, prefer = 'delete', maxCells = LCS_MAX_CELLS }: { equal?: (x: T, y: T) => boolean; prefer?: 'delete' | 'insert'; maxCells?: number } = {}): LcsStep[] {
  let lo = 0, hiA = before.length, hiB = after.length
  while (lo < hiA && lo < hiB && equal(before[lo], after[lo])) lo++
  while (hiA > lo && hiB > lo && equal(before[hiA - 1], after[hiB - 1])) { hiA--; hiB-- }
  const m = hiA - lo, n = hiB - lo, out: LcsStep[] = []
  for (let k = 0; k < lo; k++) out.push({ type: '=', a: k, b: k })
  if ((m + 1) * (n + 1) > maxCells) { // too big for an exact diff: the whole middle changed
    const del = (): void => { for (let k = 0; k < m; k++) out.push({ type: '-', a: lo + k, b: null }) }
    const add = (): void => { for (let k = 0; k < n; k++) out.push({ type: '+', a: null, b: lo + k }) }
    if (prefer === 'delete') { del(); add() } else { add(); del() }
  } else {
    const W = n + 1, L = new Int32Array((m + 1) * W) // L[i*W + j] = LCS length of before[lo+i..] and after[lo+j..]
    for (let i = m - 1; i >= 0; i--) for (let j = n - 1; j >= 0; j--)
      L[i * W + j] = equal(before[lo + i], after[lo + j]) ? L[(i + 1) * W + j + 1] + 1 : Math.max(L[(i + 1) * W + j], L[i * W + j + 1])
    for (let i = 0, j = 0; i < m || j < n;) {
      if (i < m && j < n && equal(before[lo + i], after[lo + j])) { out.push({ type: '=', a: lo + i, b: lo + j }); i++; j++ }
      else if (j >= n || (i < m && (prefer === 'delete' ? L[(i + 1) * W + j] >= L[i * W + j + 1] : L[(i + 1) * W + j] > L[i * W + j + 1]))) out.push({ type: '-', a: lo + i++, b: null })
      else out.push({ type: '+', a: null, b: lo + j++ })
    }
  }
  for (let k = 0; k < before.length - hiA; k++) out.push({ type: '=', a: hiA + k, b: hiB + k })
  return out
}

export type CodeDiffRow = { type: '=' | '+' | '-'; text: string; a: number | null; b: number | null }
/** Line diff via longest common subsequence (lcsDiff). `a` / `b` are 1-based line numbers in before / after. */
export function codeLineDiff(before: string[], after: string[]): CodeDiffRow[] {
  return lcsDiff(before, after).map(s => ({ type: s.type, text: s.b != null ? after[s.b] : before[s.a!], a: s.a == null ? null : s.a + 1, b: s.b == null ? null : s.b + 1 }))
}

/* ── shared pieces ─────────────────────────────────────────────────────────── */

type CodeRow = { text: string; no?: number | null; kind?: 'hi' | 'add' | 'del' | 'hunk' | 'blank'; plain?: boolean }
const CODE_ROW_BG = { hi: 'bg-[color-mix(in_srgb,var(--accent)_10%,transparent)]', add: 'bg-[color-mix(in_srgb,var(--ok)_11%,transparent)]', del: 'bg-[color-mix(in_srgb,var(--bad)_10%,transparent)]', hunk: 'bg-[var(--muted)] text-[var(--fg3)]', blank: 'bg-[color-mix(in_srgb,var(--muted)_60%,transparent)]' }

/** Highlighted lines are cached by language and text: re-renders, tab switches and remounts reuse the same elements. */
const CODE_HL_CACHE = new Map<string, ReactNode[]>()
const CODE_HL_CACHE_MAX = 3000
function codeHighlightCached(text: string, lang: CodeLanguage): ReactNode[] {
  const k = lang + '\u0000' + text
  let v = CODE_HL_CACHE.get(k)
  if (!v) { v = highlightCode(text, lang); if (CODE_HL_CACHE.size >= CODE_HL_CACHE_MAX) CODE_HL_CACHE.delete(CODE_HL_CACHE.keys().next().value!); CODE_HL_CACHE.set(k, v) }
  return v
}

/**
 * The rows of a code view. Memoised (by row content), and focusable with a label only while it actually scrolls,
 * so keyboard users can scroll it without adding a Tab stop to every short snippet.
 */
const CodeRows = memo(function CodeRows({ rows, lang, wrap, numbers = true, label, className }: { rows: CodeRow[]; lang: CodeLanguage; wrap?: boolean; numbers?: boolean; label?: string; className?: string }) {
  const t = useMessages(CODE_MESSAGES)
  const ref = useRef<HTMLPreElement>(null)
  const [scrolls, setScrolls] = useState(false)
  useLayoutEffect(() => {
    const el = ref.current; if (!el || typeof ResizeObserver === 'undefined') return
    const upd = () => setScrolls(el.scrollWidth > el.clientWidth + 1 || el.scrollHeight > el.clientHeight + 1)
    upd(); const ro = new ResizeObserver(upd); ro.observe(el); return () => ro.disconnect()
  }, [rows, wrap])
  return (
    <pre ref={ref} dir="ltr" tabIndex={scrolls ? 0 : undefined} role={scrolls ? 'region' : undefined} aria-label={scrolls ? t('scrolls', { label: label ?? t('code') }) : undefined}
      className={cn('relative m-0 overflow-auto py-2.5 font-[family-name:var(--mono)] text-xs leading-[1.65] [contain:inline-size] focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[var(--accent)]', className)}>
      {rows.map((r, i) => (
        <span key={i} data-kind={r.kind} className={cn('flex min-h-[1.65em] pe-3', r.kind && CODE_ROW_BG[r.kind])}>
          {numbers && (
            <span className={cn('relative w-[46px] flex-none pe-4 text-end whitespace-nowrap select-none', r.kind === 'hi' ? 'text-[var(--accent)]' : 'text-[var(--fg3)]')}>
              {r.no ?? ''}{r.kind === 'add' && <span className="absolute end-1 text-[var(--ok)]">+</span>}{r.kind === 'del' && <span className="absolute end-1 text-[var(--bad)]">−</span>}
            </span>
          )}
          <span className={cn('min-w-0 flex-1', wrap ? 'break-words whitespace-pre-wrap' : 'whitespace-pre')}>{r.plain ? r.text : (r.text ? codeHighlightCached(r.text, lang) : ' ')}</span>
        </span>
      ))}
    </pre>
  )
}, (a, b) => a.lang === b.lang && a.wrap === b.wrap && a.numbers === b.numbers && a.label === b.label && a.className === b.className
  && a.rows.length === b.rows.length && a.rows.every((r, i) => { const q = b.rows[i]; return r.text === q.text && r.no === q.no && r.kind === q.kind && r.plain === q.plain }))

const CODE_HEAD = 'flex h-10 items-center gap-2 border-b border-[var(--line)] bg-[var(--card)] pe-1.5 ps-3 text-xs [@media(pointer:coarse)]:h-11'
/** Header that may wrap onto a second row on narrow cards (no tabs inside, so no fixed height needed). */
const CODE_HEAD_WRAP = 'flex min-h-10 flex-wrap items-center gap-x-2 gap-y-1 border-b border-[var(--line)] bg-[var(--card)] py-1 pe-1.5 ps-3 text-xs [@media(pointer:coarse)]:min-h-11'
const CODE_BOX = 'overflow-hidden rounded-[var(--r-lg)] border border-[var(--line)] bg-[color-mix(in_srgb,var(--muted)_45%,var(--card))]'
/** Small text button in a code header (Wrap, Changes, Copy): ghost Button, 28px (36px on touch). */
const CODE_TOOL = '!h-7 !gap-1 !px-2 font-medium text-[var(--fg2)] hover:text-[var(--fg)] aria-pressed:!bg-[var(--muted)] aria-pressed:text-[var(--fg)] [@media(pointer:coarse)]:!h-9 [@media(pointer:coarse)]:min-w-9'

/** Copy button for a code header: "Copy" → "Copied" (icon only on phones, or always with `iconOnly`). */
function CodeCopy({ text, iconOnly, label }: { text: () => string; iconOnly?: boolean; label?: string }) {
  const t = useMessages(CODE_MESSAGES)
  const phone = useMediaQuery('(max-width: 639px)')
  const icon = iconOnly || phone
  return <CopyButton text={text} label={label ?? t('copy')} size={icon ? 'icon-sm' : 'sm'} iconOnly={icon} variant="ghost" className={icon ? 'text-[var(--fg2)] hover:text-[var(--fg)]' : CODE_TOOL} />
}

/** Underlined tabs that sit inside a code header. ← / → (Home / End) move between tabs; when they overflow (phones) the clipped edges fade. */
function CodeHeaderTabs({ tabs, value, onChange, label }: { tabs: string[]; value: string; onChange: (v: string) => void; label: string }) {
  const group = useId(), refs = useRef<(HTMLButtonElement | null)[]>([]), list = useRef<HTMLDivElement | null>(null)
  const [edgesRef, edges] = useScrollEdges<HTMLDivElement>()
  const i = tabs.indexOf(value)
  const { onKeyDown } = useRoving(tabs.length, () => {}, { orientation: 'horizontal', index: Math.max(0, i), onMove: n => { onChange(tabs[n]); refs.current[n]?.focus() } })
  useEffect(() => { // keep the open tab in view by scrolling the strip only (scrollIntoView would also move the page)
    const el = list.current, t = refs.current[i]; if (!el || !t) return
    if (t.offsetLeft < el.scrollLeft) el.scrollLeft = t.offsetLeft - 8
    else if (t.offsetLeft + t.offsetWidth > el.scrollLeft + el.clientWidth) el.scrollLeft = t.offsetLeft + t.offsetWidth - el.clientWidth + 8
  }, [i])
  return (
    <div className="relative flex h-full min-w-0 flex-1">
      <div ref={el => { list.current = el; edgesRef(el) }} dir="ltr" role="tablist" aria-label={label} onKeyDown={e => { if (e.key !== 'Enter') onKeyDown(e) }}
        className="flex h-full min-w-0 flex-1 gap-0.5 overflow-x-auto [contain:inline-size] overscroll-x-contain [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {tabs.map((t, k) => (
          <button key={t} ref={el => { refs.current[k] = el }} type="button" role="tab" aria-selected={t === value} tabIndex={t === value ? 0 : -1} onClick={() => onChange(t)}
            className={cn('relative h-full min-w-8 flex-none cursor-pointer border-0 bg-transparent px-2.5 text-xs font-medium [@media(pointer:coarse)]:px-3 transition-colors focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[var(--accent)]', t === value ? 'text-[var(--fg)]' : 'text-[var(--fg3)] hover:text-[var(--fg)]')}>
            {t}
            {t === value && <ActiveIndicator group={group} className="top-auto bottom-0 h-0.5 rounded-[var(--r-sm)] bg-[var(--fg)]" />}
          </button>
        ))}
      </div>
      <ScrollEdges {...edges} hint={null} />
    </div>
  )
}

/* ── Code block ────────────────────────────────────────────────────────────── */

/**
 * Code block: file name with icon, language badge, line numbers, highlighted lines, wrap toggle and copy.
 * Pass `previous` to get a "Changes" toggle that shows an inline diff (computed the first time it's opened, then labelled
 * +N −M; very large changes fall back to one removed and one added block); long code collapses behind
 * a fade with "Show all N lines". Without `defaultWrap`, lines wrap by default when the block is narrower than 520px (phones).
 */
export function CodeBlock({ code, filename, language, lineNumbers = true, highlight = [], previous, defaultWrap, collapseAt = 300, className }:
  { code: string; filename?: string; language?: CodeLanguage; lineNumbers?: boolean; highlight?: number[]; previous?: string; defaultWrap?: boolean; collapseAt?: number | false; className?: string }) {
  const t = useMessages(CODE_MESSAGES)
  const lang = language ?? codeLanguageOf(filename)
  const lines = useMemo(() => code.replace(/\n$/, '').split('\n'), [code])
  const [diffOn, setDiffOn] = useState(false)
  const [diffSeen, setDiffSeen] = useState(false) // the diff is computed the first time Changes is opened, not on render
  const diff = useMemo(() => previous == null || !diffSeen ? null : codeLineDiff(previous.replace(/\n$/, '').split('\n'), lines), [previous, lines, diffSeen])
  const adds = diff?.filter(r => r.type === '+').length ?? 0, dels = diff?.filter(r => r.type === '-').length ?? 0
  const [box, boxW] = useWidth<HTMLDivElement>()
  const [wrapSet, setWrap] = useState<boolean | null>(null) // null until the reader toggles it
  const wrap = wrapSet ?? defaultWrap ?? (boxW > 0 && boxW < 520)
  const [open, setOpen] = useState(false)
  const [inner, { height: full }] = useSize<HTMLDivElement>()
  const hiKey = highlight.join(',')
  const rows: CodeRow[] = useMemo(() => diffOn && diff
    ? diff.map(r => ({ text: r.text, no: r.type === '-' ? r.a : r.b, kind: r.type === '+' ? 'add' : r.type === '-' ? 'del' : undefined }))
    : lines.map((text, i) => ({ text, no: i + 1, kind: highlight.includes(i + 1) ? 'hi' : undefined })), [diffOn, diff, lines, hiKey]) // eslint-disable-line react-hooks/exhaustive-deps
  const collapsible = collapseAt !== false && full > collapseAt + 40
  const height = !collapsible ? 'auto' : open ? full + 48 : collapseAt
  return (
    <div ref={box} className={cn(CODE_BOX, className)}>
      <div className={CODE_HEAD_WRAP}>
        <span className="flex min-w-0 items-center gap-1.5 font-medium text-[var(--fg)]"><Icon name="file" size={13} className="text-[var(--fg3)]" /><span className="truncate">{filename ?? t('snippet')}</span></span>
        <span className="flex-none rounded-[var(--r-sm)] bg-[var(--muted)] px-1.5 py-0.5 font-[family-name:var(--mono)] text-[11px] font-medium text-[var(--fg3)] max-[420px]:hidden">{CODE_LANGUAGE_NAMES[lang]}</span>
        <span className="flex-1" />
        {previous != null && (
          <Button size="sm" variant="ghost" className={CODE_TOOL} aria-pressed={diffOn} onClick={() => { setDiffSeen(true); setDiffOn(v => !v) }} title={t('changesTitle')}>
            <Icon name="diff" size={13} /><span className="max-sm:sr-only">{t('changes')}</span>
            {diff && <span className="ui-num text-[11px]"><span className="text-[var(--ok)]">+{adds}</span> <span className="text-[var(--bad)]">−{dels}</span></span>}
          </Button>
        )}
        <Button size="sm" variant="ghost" className={CODE_TOOL} aria-pressed={wrap} onClick={() => setWrap(!wrap)} title={t('wrapLines')}><Icon name="wrap" size={13} className="ui-flip sm:hidden" /><span className="max-sm:hidden">{t('wrap')}</span><span className="sr-only sm:hidden">{t('wrapLines')}</span></Button>
        <CodeCopy text={() => code} />
      </div>
      <motion.div className="relative overflow-hidden" initial={false} animate={{ height }} transition={spring(0.12, 0.45)}>
        <div ref={inner}>
          <motion.div key={String(diffOn)} initial={{ opacity: 0.3 }} animate={{ opacity: 1 }} transition={{ duration: 0.2 }}>
            <CodeRows rows={rows} lang={lang} wrap={wrap} numbers={lineNumbers} label={filename ?? t('code')} className={cn(!wrap && 'overflow-y-hidden')} />
          </motion.div>
        </div>
        {collapsible && (
          <div className={cn('pointer-events-none absolute inset-x-0 bottom-0 flex items-end justify-center pb-2.5', open ? 'h-12' : 'h-[70px] bg-gradient-to-b from-transparent to-[color-mix(in_srgb,var(--muted)_45%,var(--card))]')}>
            <Button size="sm" aria-expanded={open} onClick={() => setOpen(o => !o)} className="pointer-events-auto [@media(pointer:coarse)]:!h-10 [@media(pointer:coarse)]:!px-4">
              {open ? t('collapse') : t('showAll', { count: rows.length })}
            </Button>
          </div>
        )}
      </motion.div>
    </div>
  )
}

/** Inline code (`useFlow()`) for running text. */
export function InlineCode({ children, className }: { children: ReactNode; className?: string }) {
  return <code className={cn('rounded-[var(--r-sm)] border border-[var(--line)] bg-[var(--muted)] px-1.5 py-px font-[family-name:var(--mono)] text-[max(0.9em,11px)]', className)}>{children}</code>
}

/* ── Install command ───────────────────────────────────────────────────────── */

const CODE_PMS = { npm: 'npm install', pnpm: 'pnpm add', yarn: 'yarn add', bun: 'bun add' } as const
export type PackageManager = keyof typeof CODE_PMS

/** Install command with package-manager tabs (sliding underline) and a Copy → Copied button. */
export function InstallCommand({ pkg, value, defaultValue = 'npm', onChange, className }:
  { pkg: string; value?: PackageManager; defaultValue?: PackageManager; onChange?: (pm: PackageManager) => void; className?: string }) {
  const t = useMessages(CODE_MESSAGES)
  const [pm, setPm] = useControllable<PackageManager>(value, defaultValue, onChange)
  const cmd = `${CODE_PMS[pm]} ${pkg}`
  return (
    <div className={cn(CODE_BOX, className)}>
      <div className={cn(CODE_HEAD, '!ps-1')}>
        <CodeHeaderTabs tabs={Object.keys(CODE_PMS)} value={pm} onChange={v => setPm(v as PackageManager)} label={t('packageManager')} />
        <CodeCopy text={() => cmd} />
      </div>
      <motion.div key={pm} dir="ltr" initial={{ opacity: 0, x: -4 }} animate={{ opacity: 1, x: 0 }} transition={{ duration: 0.2 }}>
        <CodeRows rows={[{ text: cmd, no: null }]} lang="sh" numbers={false} label={t('installCommand')} className="!py-3 ps-3" />
      </motion.div>
    </div>
  )
}

/* ── Tabbed example ────────────────────────────────────────────────────────── */

export type CodeTab = { label: string; code: string; language?: CodeLanguage }
/** The same example in several languages. Tabs slide, the box animates its height, Copy copies the open tab. */
export function CodeTabs({ tabs, value, defaultValue, onChange, className }: { tabs: CodeTab[]; value?: string; defaultValue?: string; onChange?: (v: string) => void; className?: string }) {
  const t = useMessages(CODE_MESSAGES)
  const [cur, setCur] = useControllable(value, defaultValue ?? tabs[0].label, onChange)
  const tab = tabs.find(t => t.label === cur) ?? tabs[0]
  const [inner, { height: h }] = useSize<HTMLDivElement>()
  const rows = useMemo(() => tab.code.split('\n').map((text, i): CodeRow => ({ text, no: i + 1 })), [tab.code])
  return (
    <div className={cn(CODE_BOX, className)}>
      <div className={cn(CODE_HEAD, '!ps-1')}>
        <CodeHeaderTabs tabs={tabs.map(t => t.label)} value={tab.label} onChange={setCur} label={t('exampleLanguage')} />
        <CodeCopy text={() => tab.code} />
      </div>
      <motion.div className="overflow-hidden" initial={false} animate={{ height: h || 'auto' }} transition={spring(0.15, 0.4)}>
        <div ref={inner} role="tabpanel" aria-label={tab.label}>
          <motion.div key={tab.label} initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.22 }}>
            <CodeRows rows={rows} lang={tab.language ?? 'ts'} label={t('example', { label: tab.label })} />
          </motion.div>
        </div>
      </motion.div>
    </div>
  )
}

/* ── Terminal ──────────────────────────────────────────────────────────────── */

export type TerminalLine = { cmd: string } | { out: ReactNode }
type TerminalShown = { cmd?: string; out?: ReactNode; typing?: boolean }
const TERM_CURSOR = 'inline-block h-3.5 w-[7px] bg-[var(--fg)] align-[-2px] animate-[ui-blink_1s_steps(1)_infinite] motion-reduce:animate-none'

/**
 * Terminal: commands type out character by character, output streams in, then a prompt waits with a
 * blinking cursor (paused off screen, steady under reduced motion). Starts when scrolled into view; the header button
 * replays it. The box reserves the height of the finished session up front, so typing never pushes the page.
 */
export function Terminal({ lines, title = 'zsh', className }: { lines: TerminalLine[]; title?: string; className?: string }) {
  const t = useMessages(CODE_MESSAGES)
  const { ref: box, seen: inView, visible: onScreen } = useViewport<HTMLDivElement>(null, { amount: 0.5 })
  const cursor = cn(TERM_CURSOR, !onScreen && '[animation-play-state:paused]')
  const reduce = useReducedMotion()
  const [shown, setShown] = useState<TerminalShown[]>([])
  const [done, setDone] = useState(false)
  const gen = useRef(0)
  const play = async () => {
    const g = ++gen.current, alive = () => g === gen.current
    setShown([]); setDone(false)
    for (const l of lines) {
      if (!alive()) return
      if ('cmd' in l) {
        setShown(s => [...s, { cmd: '', typing: true }])
        for (let i = 1; i <= l.cmd.length; i++) {
          if (!alive()) return
          const text = l.cmd.slice(0, i)
          setShown(s => s.map((x, k) => k === s.length - 1 ? { ...x, cmd: text } : x))
          if (!reduce) await sleep(28 + Math.random() * 40)
        }
        if (!reduce) await sleep(350)
        if (!alive()) return
        setShown(s => s.map((x, k) => k === s.length - 1 ? { ...x, typing: false } : x))
      } else {
        setShown(s => [...s, { out: l.out }])
        if (!reduce) await sleep(260)
      }
    }
    if (alive()) setDone(true)
  }
  useEffect(() => { if (inView) play(); return () => { gen.current++ } }, [inView]) // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div ref={box} className={cn('overflow-hidden rounded-[var(--r-lg)] border border-[var(--line)] bg-[color-mix(in_srgb,var(--bg)_60%,var(--muted))] text-[var(--fg)]', className)}>
      <div className="flex h-[34px] items-center gap-1.5 border-b border-[var(--line)] bg-[color-mix(in_srgb,var(--card)_50%,transparent)] pe-1.5 ps-3 text-[11px] text-[var(--fg3)] [@media(pointer:coarse)]:h-11">
        <i className="h-2.5 w-2.5 rounded-full bg-[#ED6A5E]" /><i className="h-2.5 w-2.5 rounded-full bg-[#F4BF4F]" /><i className="h-2.5 w-2.5 rounded-full bg-[#61C554]" />
        <span className="ms-2">{title}</span>
        <IconButton icon={<Icon name="replay" size={13} />} label={t('replay')} onClick={play} className="ms-auto [@media(pointer:coarse)]:!h-9 [@media(pointer:coarse)]:!w-9" />
      </div>
      <div dir="ltr" className="m-0 grid min-h-[210px] p-3 font-[family-name:var(--mono)] text-xs leading-[1.6] break-words whitespace-pre-wrap [&>*]:[grid-area:1/1]">
        {/* the whole session, invisible, in the same cell: the box is its final height from the start */}
        <div aria-hidden className="invisible">
          {lines.map((l, i) => 'cmd' in l ? <div key={i}><span>❯</span> <span>{l.cmd}</span><span className="inline-block w-[7px]" /></div> : <div key={i}>{l.out}</div>)}
          <div>❯ </div>
        </div>
        <div role="log" aria-live="off" className="min-w-0">
          {shown.map((l, i) => l.cmd !== undefined
            ? <div key={i}><span className="text-[var(--ok)]">❯</span> <span>{l.cmd}</span>{l.typing && <span className={cursor} />}</div>
            : <motion.div key={i} initial={reduce ? false : { opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.2 }}>{l.out}</motion.div>)}
          {done && <div><span className="text-[var(--ok)]">❯</span> <span className={cursor} /></div>}
        </div>
      </div>
    </div>
  )
}

/* ── Diff ──────────────────────────────────────────────────────────────────── */

/**
 * Diff computed from `before` and `after` text (LCS line diff). Unified or split view, hunk header,
 * old / new line numbers, +N / −M stats, syntax colours and copy (copies the new version). When the diff is narrower
 * than 560px (phones) split view falls back to unified and the toggle hides, since two columns can't be read there.
 */
export function Diff({ before, after, filename, language, hunk, defaultMode = 'unified', className }:
  { before: string; after: string; filename?: string; language?: CodeLanguage; hunk?: string; defaultMode?: 'unified' | 'split'; className?: string }) {
  const t = useMessages(CODE_MESSAGES)
  const lang = language ?? codeLanguageOf(filename)
  const [picked, setMode] = useState(defaultMode)
  const [box, boxW] = useWidth<HTMLDivElement>()
  const narrow = boxW > 0 && boxW < 560, mode = narrow ? 'unified' : picked
  const A = useMemo(() => before.split('\n'), [before]), B = useMemo(() => after.split('\n'), [after])
  const rows = useMemo(() => codeLineDiff(A, B), [A, B])
  const adds = rows.filter(r => r.type === '+').length, dels = rows.filter(r => r.type === '-').length
  const head: CodeRow = { text: `@@ -1,${A.length} +1,${B.length} @@${hunk ? ' ' + hunk : ''}`, kind: 'hunk', plain: true }
  // split view: pair each run of removals with the following run of additions
  const pairs = useMemo(() => {
    const out: [CodeRow, CodeRow][] = []
    for (let i = 0; i < rows.length;) {
      if (rows[i].type === '=') { const r = rows[i++]; out.push([{ text: r.text, no: r.a }, { text: r.text, no: r.b }]); continue }
      const del: CodeDiffRow[] = [], add: CodeDiffRow[] = []
      while (i < rows.length && rows[i].type === '-') del.push(rows[i++])
      while (i < rows.length && rows[i].type === '+') add.push(rows[i++])
      for (let k = 0; k < Math.max(del.length, add.length); k++) out.push([
        del[k] ? { text: del[k].text, no: del[k].a, kind: 'del' } : { text: '', kind: 'blank', plain: true },
        add[k] ? { text: add[k].text, no: add[k].b, kind: 'add' } : { text: '', kind: 'blank', plain: true },
      ])
    }
    return out
  }, [rows])
  return (
    <div ref={box} className={cn(CODE_BOX, className)}>
      <div className={CODE_HEAD_WRAP}>
        <span className="flex min-w-0 items-center gap-1.5 font-medium"><Icon name="file" size={13} className="text-[var(--fg3)]" /><span className="truncate">{filename ?? t('fileChanges')}</span></span>
        <span className="ui-num flex-none text-[11px]"><span className="text-[var(--ok)]">+{adds}</span> <span className="text-[var(--bad)]">−{dels}</span></span>
        <span className="flex-1" />
        {!narrow && <SegmentedControl size="sm" options={[{ value: 'unified', label: t('unified') }, { value: 'split', label: t('split') }]} value={mode} onChange={v => setMode(v as 'unified' | 'split')} className="!p-0.5" />}
        <CodeCopy text={() => after} iconOnly label={t('copyNew')} />
      </div>
      <motion.div key={mode} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.2 }}>
        {mode === 'unified'
          ? <CodeRows lang={lang} label={t('changesTo', { file: filename ?? t('theFile') })} rows={[head, ...rows.map((r): CodeRow => ({ text: r.text, no: r.type === '-' ? r.a : r.b, kind: r.type === '+' ? 'add' : r.type === '-' ? 'del' : undefined }))]} />
          : <div dir="ltr" className="grid grid-cols-2">
              <CodeRows lang={lang} label={t('before')} rows={[{ ...head, text: `@@ -1,${A.length} @@` }, ...pairs.map(p => p[0])]} />
              <CodeRows lang={lang} label={t('after')} rows={[{ ...head, text: `@@ +1,${B.length} @@` }, ...pairs.map(p => p[1])]} className="border-s border-[var(--line)]" />
            </div>}
      </motion.div>
    </div>
  )
}

/* ── Markdown fences ───────────────────────────────────────────────────────── */

/**
 * Markdown's `renderCode` (and, through `aiMarkdownText(markdownCodeBlock)`, MessageParts' text) with highlighting: ts/js/py/sh/json fences (and their
 * aliases, CODE_FENCE_LANGS) become a CodeBlock; any other language keeps Markdown's plain frame.
 * `<Markdown renderCode={markdownCodeBlock}>`. Kept out of Markdown so the highlighter is only bundled where it is used.
 */
export const markdownCodeBlock: MarkdownCodeRenderer = ({ code, lang }) => {
  const language = CODE_FENCE_LANGS[lang.toLowerCase()]
  return language ? <CodeBlock code={code} language={language} collapseAt={false} className="[overflow-wrap:normal]" /> : null
}
