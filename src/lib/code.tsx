import { memo, useCallback, useEffect, useId, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { motion, useReducedMotion } from 'motion/react'
import { Button, Icon, IconButton, ScrollEdges, cn, sleep, spring, useControllable, useMediaQuery, useRoving, useScrollEdges, useSize, useWidth, useResizeObserver } from './core'
import { ActiveIndicator, SegmentedControl } from './fields'
import { CopyButton } from './feedback'
import { useViewport } from './motion'
import type { MarkdownCodeRenderer } from './markdown'

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

/**
 * A character range of CodeBlock's `code` ([start, end) offsets) drawn as an underline with a soft tint, line by line
 * (decorative: no ARIA; say what it means elsewhere). `color`: any CSS colour (default var(--accent)); `variant`:
 * 'wavy' (default) or 'solid'.
 */
export type CodeMark = { start: number; end: number; color?: string; variant?: 'wavy' | 'solid' }
/** The token under the pointer in a CodeBlock with `onTokenHover` / `onTokenClick`: [start, end) offsets into `code`, and its text. */
export type CodeTokenRange = { start: number; end: number; text: string }

/**
 * Where ranges fall on each line: per line, `[start, end)` columns and the index of the range. A range that runs over
 * several lines covers each line's part, without the indentation of the lines it continues on or the trailing spaces
 * of the lines it continues from; empty parts are left out. `lines` are the code's lines without their newlines.
 */
export function codeMarkRanges(lines: readonly string[], ranges: readonly { start: number; end: number }[]): { start: number; end: number; mark: number }[][] {
  const out = lines.map(() => [] as { start: number; end: number; mark: number }[])
  const starts: number[] = []
  for (let i = 0, at = 0; i < lines.length; i++) { starts.push(at); at += lines[i].length + 1 }
  ranges.forEach((r, mark) => {
    if (!(r.end > r.start) || !lines.length) return
    let lo = 0, hi = lines.length - 1 // the line the range starts on (binary search: hovering calls this on every change)
    while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (starts[mid] <= r.start) lo = mid; else hi = mid - 1 }
    for (let i = lo; i < lines.length && starts[i] < r.end; i++) {
      const line = lines[i]
      let a = Math.max(0, r.start - starts[i]), b = Math.min(line.length, r.end - starts[i])
      if (r.start < starts[i]) while (a < b && /\s/.test(line[a])) a++ // continues from the line above: skip the indentation
      if (r.end > starts[i] + line.length) while (b > a && /\s/.test(line[b - 1])) b-- // continues below: skip trailing spaces
      if (b > a) out[i].push({ start: a, end: b, mark })
    }
  })
  return out
}

/** A line cut into highlighted tokens and, between them, words, spaces and single punctuation marks: [s, e) columns and a class. */
type CodeSegment = { s: number; e: number; cls?: string }
const CODE_PIECE = /[\w$]+|\s+|[^\w$\s]/g
function codeSegments(line: string, lang: CodeLanguage): CodeSegment[] {
  if (line.length > CODE_HIGHLIGHT_MAX) return [{ s: 0, e: line.length }]
  const out: CodeSegment[] = []
  const gap = (from: number, to: number) => { for (const m of line.slice(from, to).matchAll(CODE_PIECE)) out.push({ s: from + m.index, e: from + m.index + m[0].length }) }
  const [src, names] = CODE_LANGS[lang] ?? CODE_JS
  const re = new RegExp(src.source, src.flags)
  let last = 0, m: RegExpExecArray | null
  while ((m = re.exec(line))) {
    if (m[0] === '') { re.lastIndex++; continue }
    gap(last, m.index)
    let gi = 1; while (gi < m.length && m[gi] === undefined) gi++
    const kind = names[gi - 1]
    if (kind === 'pre') { gap(m.index, m.index + m[gi].length); out.push({ s: m.index + m[gi].length, e: m.index + m[0].length, cls: CODE_TOKEN_CLASS.kw }) }
    else out.push({ s: m.index, e: m.index + m[0].length, cls: kind ? CODE_TOKEN_CLASS[kind] : undefined })
    last = m.index + m[0].length
  }
  gap(last, line.length)
  return out
}
const CODE_SEG_CACHE = new Map<string, CodeSegment[]>()
function codeSegmentsCached(text: string, lang: CodeLanguage): CodeSegment[] {
  const k = lang + '\u0000' + text
  let v = CODE_SEG_CACHE.get(k)
  if (!v) { v = codeSegments(text, lang); if (CODE_SEG_CACHE.size >= CODE_HL_CACHE_MAX) CODE_SEG_CACHE.delete(CODE_SEG_CACHE.keys().next().value!); CODE_SEG_CACHE.set(k, v) }
  return v
}

/** A mark's part on one line (columns), with its look. */
type CodeLineMark = { start: number; end: number; color: string; variant: 'wavy' | 'solid' }
const CODE_MARK_VARIANT = { wavy: 'decoration-wavy', solid: 'decoration-solid' } as const
/** The underline and tint of a mark; `--code-mark` is its colour (the caller's token, so it follows the theme). */
const CODE_MARK = 'rounded-[var(--r-sm)] bg-[color-mix(in_srgb,var(--code-mark)_15%,transparent)] underline [text-decoration-color:var(--code-mark)] decoration-[1.5px] underline-offset-[3px] [text-decoration-skip-ink:none] [box-decoration-break:clone] [-webkit-box-decoration-break:clone]'

/**
 * One line's text with marks or token events. The line is cut into segments once (cached by text), each carrying its
 * offsets in the code (`data-o`, `data-e`) so the pointer maps to a token without measuring; marked parts are wrapped in
 * an underline. Memoised: a hover re-renders only the lines whose marks change.
 */
const CodeLineText = memo(function CodeLineText({ text, lang, plain, start, marks, interactive }: { text: string; lang: CodeLanguage; plain?: boolean; start: number; marks?: readonly CodeLineMark[]; markKey?: string; interactive: boolean }) {
  if (!text) return ' '
  if (!marks?.length && !interactive) return <>{plain ? text : codeHighlightCached(text, lang)}</>
  const segs = plain ? [{ s: 0, e: text.length } as CodeSegment] : codeSegmentsCached(text, lang)
  const out: ReactNode[] = []
  let group: ReactNode[] = [], groupMark = -1, k = 0
  const flush = () => {
    if (!group.length) return
    if (groupMark < 0) out.push(...group)
    else { const m = marks![groupMark]; out.push(<span key={`m${k++}`} data-code-mark="" className={cn(CODE_MARK, CODE_MARK_VARIANT[m.variant])} style={{ '--code-mark': m.color } as CSSProperties}>{group}</span>) }
    group = []
  }
  for (const seg of segs) {
    for (let a = seg.s; a < seg.e;) {
      // the mark covering this column (the last one wins), and where the next mark starts or ends
      let mark = -1, b = seg.e
      marks?.forEach((m, i) => { if (m.start <= a && a < m.end) mark = i; if (m.start > a && m.start < b) b = m.start; if (m.end > a && m.end < b) b = m.end })
      if (mark !== groupMark) { flush(); groupMark = mark }
      const piece = text.slice(a, b)
      group.push(seg.cls || interactive ? <span key={k++} className={seg.cls} data-o={interactive ? start + seg.s : undefined} data-e={interactive ? start + seg.e : undefined}>{piece}</span> : piece)
      a = b
    }
  }
  flush()
  return <>{out}</>
}, (a, b) => a.text === b.text && a.lang === b.lang && a.plain === b.plain && a.start === b.start && a.markKey === b.markKey && a.interactive === b.interactive)

type CodeRow = { text: string; no?: number | null; kind?: 'hi' | 'add' | 'del' | 'hunk' | 'blank'; plain?: boolean; /** offset of the line in the code */ start?: number; marks?: CodeLineMark[]; markKey?: string }
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
const CodeRows = memo(function CodeRows({ rows, lang, wrap, numbers = true, label, className, onToken }: { rows: CodeRow[]; lang: CodeLanguage; wrap?: boolean; numbers?: boolean; label?: string; className?: string;
  /** token events (keep its identity stable): the mouse moved onto a token (null: off the tokens), or a token was clicked */ onToken?: (type: 'hover' | 'click', at: { start: number; end: number } | null) => void }) {
  const ref = useRef<HTMLPreElement>(null)
  const [scrolls, setScrolls] = useState(false)
  useResizeObserver(ref, el => setScrolls(el.scrollWidth > el.clientWidth + 1 || el.scrollHeight > el.clientHeight + 1), [rows, wrap])
  const tokenAt = (target: EventTarget) => {
    const el = target instanceof Element ? target.closest<HTMLElement>('[data-o]') : null
    return el ? { start: Number(el.dataset.o), end: Number(el.dataset.e) } : null
  }
  const mouse = (e: { pointerType?: string }) => !e.pointerType || e.pointerType === 'mouse' // a tap is a click, not a hover
  return (
    <pre ref={ref} tabIndex={scrolls ? 0 : undefined} role={scrolls ? 'region' : undefined} aria-label={scrolls ? `${label ?? 'Code'}, scrolls` : undefined}
      onPointerOver={onToken && (e => { if (mouse(e)) onToken('hover', tokenAt(e.target)) })}
      onPointerLeave={onToken && (e => { if (mouse(e)) onToken('hover', null) })}
      onClick={onToken && (e => { const at = tokenAt(e.target); if (at) onToken('click', at) })}
      className={cn('relative m-0 overflow-auto py-2.5 font-[family-name:var(--mono)] text-xs leading-[1.65] [contain:inline-size] focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[var(--accent)]', onToken && '[&_[data-o]]:cursor-pointer', className)}>
      {rows.map((r, i) => (
        <span key={i} data-kind={r.kind} className={cn('flex min-h-[1.65em] pe-3', r.kind && CODE_ROW_BG[r.kind])}>
          {numbers && (
            <span className={cn('relative w-[46px] flex-none pe-4 text-end whitespace-nowrap select-none', r.kind === 'hi' ? 'text-[var(--accent)]' : 'text-[var(--fg3)]')}>
              {r.no ?? ''}{r.kind === 'add' && <span className="absolute end-1 text-[var(--ok)]">+</span>}{r.kind === 'del' && <span className="absolute end-1 text-[var(--bad)]">−</span>}
            </span>
          )}
          <span className={cn('min-w-0 flex-1', wrap ? 'break-words whitespace-pre-wrap' : 'whitespace-pre')}>
            {r.marks || onToken
              ? <CodeLineText text={r.text} lang={lang} plain={r.plain} start={r.start ?? 0} marks={r.marks} markKey={r.markKey} interactive={!!onToken} />
              : r.plain ? r.text : (r.text ? codeHighlightCached(r.text, lang) : ' ')}
          </span>
        </span>
      ))}
    </pre>
  )
}, (a, b) => a.lang === b.lang && a.wrap === b.wrap && a.numbers === b.numbers && a.label === b.label && a.className === b.className && a.onToken === b.onToken
  && a.rows.length === b.rows.length && a.rows.every((r, i) => { const q = b.rows[i]; return r.text === q.text && r.no === q.no && r.kind === q.kind && r.plain === q.plain && r.start === q.start && r.markKey === q.markKey }))

const CODE_HEAD = 'flex h-10 items-center gap-2 border-b border-[var(--line)] bg-[var(--card)] pe-1.5 ps-3 text-xs [@media(pointer:coarse)]:h-11'
/** Header that may wrap onto a second row on narrow cards (no tabs inside, so no fixed height needed). */
const CODE_HEAD_WRAP = 'flex min-h-10 flex-wrap items-center gap-x-2 gap-y-1 border-b border-[var(--line)] bg-[var(--card)] py-1 pe-1.5 ps-3 text-xs [@media(pointer:coarse)]:min-h-11'
const CODE_BOX = 'overflow-hidden rounded-[var(--r-lg)] border border-[var(--line)] bg-[color-mix(in_srgb,var(--muted)_45%,var(--card))]'
/** Small text button in a code header (Wrap, Changes, Copy): ghost Button, 28px (36px on touch). */
const CODE_TOOL = '!h-7 !gap-1 !px-2 font-medium text-[var(--fg2)] hover:text-[var(--fg)] aria-pressed:!bg-[var(--muted)] aria-pressed:text-[var(--fg)] [@media(pointer:coarse)]:!h-9 [@media(pointer:coarse)]:min-w-9'

/** Copy button for a code header: "Copy" → "Copied" (icon only on phones, or always with `iconOnly`). */
function CodeCopy({ text, iconOnly, label }: { text: () => string; iconOnly?: boolean; label?: string }) {
  const phone = useMediaQuery('(max-width: 639px)')
  const icon = iconOnly || phone
  return <CopyButton text={text} label={label ?? 'Copy'} size={icon ? 'icon-sm' : 'sm'} iconOnly={icon} variant="ghost" className={icon ? 'text-[var(--fg2)] hover:text-[var(--fg)]' : CODE_TOOL} />
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
      <div ref={el => { list.current = el; edgesRef(el) }} role="tablist" aria-label={label} onKeyDown={e => { if (e.key !== 'Enter') onKeyDown(e) }}
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

/**
 * Code block: file name with icon, language badge, line numbers, highlighted lines, wrap toggle and copy.
 * Pass `previous` to get a "Changes" toggle that shows an inline diff (computed the first time it's opened, then labelled
 * +N −M; very large changes fall back to one removed and one added block); long code collapses behind
 * a fade with "Show all N lines". Without `defaultWrap`, lines wrap by default when the block is narrower than 520px (phones).
 * `marks` underline character ranges (CodeMark: wavy or solid, in any colour; a range over several lines underlines
 * each line's part); `onTokenHover` / `onTokenClick` report the token under the mouse (offsets into `code`), for
 * linking the code to something else (a syntax tree, a trace). Both are decorative and off in the Changes view.
 */
export function CodeBlock({ code, filename, language, lineNumbers = true, highlight = [], marks, onTokenHover, onTokenClick, previous, defaultWrap, collapseAt = 300, className }:
  { code: string; filename?: string; language?: CodeLanguage; lineNumbers?: boolean; highlight?: number[]
    /** character ranges to underline and tint */ marks?: readonly CodeMark[]
    /** the mouse moved onto a token (word, operator, string…) or off the tokens (null) */ onTokenHover?: (token: CodeTokenRange | null) => void
    /** a token was clicked or tapped */ onTokenClick?: (token: CodeTokenRange) => void
    previous?: string; defaultWrap?: boolean; collapseAt?: number | false; className?: string }) {
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
  const markKey = marks?.map(m => `${m.start}:${m.end}:${m.color ?? ''}:${m.variant ?? ''}`).join('|') ?? ''
  const starts = useMemo(() => { let at = 0; return lines.map(l => { const s = at; at += l.length + 1; return s }) }, [lines])
  const rows: CodeRow[] = useMemo(() => {
    if (diffOn && diff) return diff.map(r => ({ text: r.text, no: r.type === '-' ? r.a : r.b, kind: r.type === '+' ? 'add' : r.type === '-' ? 'del' : undefined }))
    const parts = marks?.length ? codeMarkRanges(lines, marks) : null
    return lines.map((text, i): CodeRow => {
      const ms = parts?.[i].map(p => ({ start: p.start, end: p.end, color: marks![p.mark].color ?? 'var(--accent)', variant: marks![p.mark].variant ?? 'wavy' }))
      return { text, no: i + 1, kind: highlight.includes(i + 1) ? 'hi' : undefined, start: starts[i], ...(ms?.length ? { marks: ms, markKey: ms.map(m => `${m.start}:${m.end}:${m.color}:${m.variant}`).join('|') } : null) }
    })
  }, [diffOn, diff, lines, starts, hiKey, markKey]) // eslint-disable-line react-hooks/exhaustive-deps
  // token events: one stable handler (CodeRows is memoised on it) that reads the latest callbacks and reports changes only
  const tokenProps = useRef({ code, onTokenHover, onTokenClick }); tokenProps.current = { code, onTokenHover, onTokenClick }
  const lastToken = useRef<string | null>(null)
  const onToken = useCallback((type: 'hover' | 'click', at: { start: number; end: number } | null) => {
    const { code: c, onTokenHover: hover, onTokenClick: click } = tokenProps.current
    const token = at && { ...at, text: c.slice(at.start, at.end) }
    if (type === 'click') { if (token) click?.(token); return }
    const key = at ? `${at.start}:${at.end}` : null
    if (key === lastToken.current) return
    lastToken.current = key
    hover?.(token)
  }, [])
  const tokens = !!(onTokenHover || onTokenClick) && !(diffOn && diff)
  const collapsible = collapseAt !== false && full > collapseAt + 40
  const height = !collapsible ? 'auto' : open ? full + 48 : collapseAt
  // the first measurement collapses a long block at once: animating it from full height shrank the page under the reader
  const measured = useRef(false)
  useEffect(() => { if (full > 0) measured.current = true }, [full])
  return (
    <div ref={box} className={cn(CODE_BOX, className)}>
      <div className={CODE_HEAD_WRAP}>
        <span className="flex min-w-0 items-center gap-1.5 font-medium text-[var(--fg)]"><Icon name="file" size={13} className="text-[var(--fg3)]" /><span className="truncate">{filename ?? 'snippet'}</span></span>
        <span className="flex-none rounded-[var(--r-sm)] bg-[var(--muted)] px-1.5 py-0.5 font-[family-name:var(--mono)] text-[11px] font-medium text-[var(--fg3)] max-[420px]:hidden">{CODE_LANGUAGE_NAMES[lang]}</span>
        <span className="flex-1" />
        {previous != null && (
          <Button size="sm" variant="ghost" className={CODE_TOOL} aria-pressed={diffOn} onClick={() => { setDiffSeen(true); setDiffOn(v => !v) }} title={'Changes since the previous version'}>
            <Icon name="diff" size={13} /><span className="max-sm:sr-only">{'Changes'}</span>
            {diff && <span className="ui-num text-[11px]"><span className="text-[var(--ok)]">+{adds}</span> <span className="text-[var(--bad)]">−{dels}</span></span>}
          </Button>
        )}
        <Button size="sm" variant="ghost" className={CODE_TOOL} aria-pressed={wrap} onClick={() => setWrap(!wrap)} title={'Wrap lines'}><Icon name="wrap" size={13} className="sm:hidden" /><span className="max-sm:hidden">{'Wrap'}</span><span className="sr-only sm:hidden">{'Wrap lines'}</span></Button>
        <CodeCopy text={() => code} />
      </div>
      <motion.div className="relative overflow-hidden" initial={false} animate={{ height }} transition={measured.current ? spring(0.12, 0.45) : { duration: 0 }}>
        <div ref={inner}>
          <motion.div key={String(diffOn)} initial={{ opacity: 0.3 }} animate={{ opacity: 1 }} transition={{ duration: 0.2 }}>
            <CodeRows rows={rows} lang={lang} wrap={wrap} numbers={lineNumbers} label={filename ?? 'Code'} className={cn(!wrap && 'overflow-y-hidden')} onToken={tokens ? onToken : undefined} />
          </motion.div>
        </div>
        {collapsible && (
          <div className={cn('pointer-events-none absolute inset-x-0 bottom-0 flex items-end justify-center pb-2.5', open ? 'h-12' : 'h-[70px] bg-gradient-to-b from-transparent to-[color-mix(in_srgb,var(--muted)_45%,var(--card))]')}>
            <Button size="sm" aria-expanded={open} onClick={() => setOpen(o => !o)} className="pointer-events-auto [@media(pointer:coarse)]:!h-10 [@media(pointer:coarse)]:!px-4">
              {open ? 'Collapse' : `Show all ${rows.length} lines`}
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

const CODE_PMS = { npm: 'npm install', pnpm: 'pnpm add', yarn: 'yarn add', bun: 'bun add' } as const
export type PackageManager = keyof typeof CODE_PMS

/** Install command with package-manager tabs (sliding underline) and a Copy → Copied button. */
export function InstallCommand({ pkg, value, defaultValue = 'npm', onChange, className }:
  { pkg: string; value?: PackageManager; defaultValue?: PackageManager; onChange?: (pm: PackageManager) => void; className?: string }) {
  const [pm, setPm] = useControllable<PackageManager>(value, defaultValue, onChange)
  const cmd = `${CODE_PMS[pm]} ${pkg}`
  return (
    <div className={cn(CODE_BOX, className)}>
      <div className={cn(CODE_HEAD, '!ps-1')}>
        <CodeHeaderTabs tabs={Object.keys(CODE_PMS)} value={pm} onChange={v => setPm(v as PackageManager)} label={'Package manager'} />
        <CodeCopy text={() => cmd} />
      </div>
      <motion.div key={pm} initial={{ opacity: 0, x: -4 }} animate={{ opacity: 1, x: 0 }} transition={{ duration: 0.2 }}>
        <CodeRows rows={[{ text: cmd, no: null }]} lang="sh" numbers={false} label={'Install command'} className="!py-3 ps-3" />
      </motion.div>
    </div>
  )
}

export type CodeTab = { label: string; code: string; language?: CodeLanguage }
/** The same example in several languages. Tabs slide, the box animates its height, Copy copies the open tab. */
export function CodeTabs({ tabs, value, defaultValue, onChange, className }: { tabs: CodeTab[]; value?: string; defaultValue?: string; onChange?: (v: string) => void; className?: string }) {
  const [cur, setCur] = useControllable(value, defaultValue ?? tabs[0].label, onChange)
  const tab = tabs.find(t => t.label === cur) ?? tabs[0]
  const [inner, { height: h }] = useSize<HTMLDivElement>()
  const rows = useMemo(() => tab.code.split('\n').map((text, i): CodeRow => ({ text, no: i + 1 })), [tab.code])
  return (
    <div className={cn(CODE_BOX, className)}>
      <div className={cn(CODE_HEAD, '!ps-1')}>
        <CodeHeaderTabs tabs={tabs.map(t => t.label)} value={tab.label} onChange={setCur} label={'Example language'} />
        <CodeCopy text={() => tab.code} />
      </div>
      <motion.div className="overflow-hidden" initial={false} animate={{ height: h || 'auto' }} transition={spring(0.15, 0.4)}>
        <div ref={inner} role="tabpanel" aria-label={tab.label}>
          <motion.div key={tab.label} initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.22 }}>
            <CodeRows rows={rows} lang={tab.language ?? 'ts'} label={`${tab.label} example`} />
          </motion.div>
        </div>
      </motion.div>
    </div>
  )
}

export type TerminalLine = { cmd: string } | { out: ReactNode }
type TerminalShown = { cmd?: string; out?: ReactNode; typing?: boolean }
const TERM_CURSOR = 'inline-block h-3.5 w-[7px] bg-[var(--fg)] align-[-2px] animate-[ui-blink_1s_steps(1)_infinite] motion-reduce:animate-none'

/**
 * Terminal: commands type out character by character, output streams in, then a prompt waits with a
 * blinking cursor (paused off screen, steady under reduced motion). Starts when scrolled into view; the header button
 * replays it. The box reserves the height of the finished session up front, so typing never pushes the page.
 */
export function Terminal({ lines, title = 'zsh', className }: { lines: TerminalLine[]; title?: string; className?: string }) {
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
        <IconButton icon={<Icon name="replay" size={13} />} label={'Replay'} onClick={play} className="ms-auto [@media(pointer:coarse)]:!h-9 [@media(pointer:coarse)]:!w-9" />
      </div>
      <div className="m-0 grid min-h-[210px] p-3 font-[family-name:var(--mono)] text-xs leading-[1.6] break-words whitespace-pre-wrap [&>*]:[grid-area:1/1]">
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

/**
 * Diff computed from `before` and `after` text (LCS line diff). Unified or split view, hunk header,
 * old / new line numbers, +N / −M stats, syntax colours and copy (copies the new version). When the diff is narrower
 * than 560px (phones) split view falls back to unified and the toggle hides, since two columns can't be read there.
 */
export function Diff({ before, after, filename, language, hunk, defaultMode = 'unified', className }:
  { before: string; after: string; filename?: string; language?: CodeLanguage; hunk?: string; defaultMode?: 'unified' | 'split'; className?: string }) {
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
        <span className="flex min-w-0 items-center gap-1.5 font-medium"><Icon name="file" size={13} className="text-[var(--fg3)]" /><span className="truncate">{filename ?? 'changes'}</span></span>
        <span className="ui-num flex-none text-[11px]"><span className="text-[var(--ok)]">+{adds}</span> <span className="text-[var(--bad)]">−{dels}</span></span>
        <span className="flex-1" />
        {!narrow && <SegmentedControl size="sm" options={[{ value: 'unified', label: 'Unified' }, { value: 'split', label: 'Split' }]} value={mode} onChange={v => setMode(v as 'unified' | 'split')} className="!p-0.5" />}
        <CodeCopy text={() => after} iconOnly label={'Copy new version'} />
      </div>
      <motion.div key={mode} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.2 }}>
        {mode === 'unified'
          ? <CodeRows lang={lang} label={`Changes to ${filename ?? 'the file'}`} rows={[head, ...rows.map((r): CodeRow => ({ text: r.text, no: r.type === '-' ? r.a : r.b, kind: r.type === '+' ? 'add' : r.type === '-' ? 'del' : undefined }))]} />
          : <div className="grid grid-cols-2">
              <CodeRows lang={lang} label={'Before'} rows={[{ ...head, text: `@@ -1,${A.length} @@` }, ...pairs.map(p => p[0])]} />
              <CodeRows lang={lang} label={'After'} rows={[{ ...head, text: `@@ +1,${B.length} @@` }, ...pairs.map(p => p[1])]} className="border-s border-[var(--line)]" />
            </div>}
      </motion.div>
    </div>
  )
}

/**
 * Markdown's `renderCode` (and, through `aiMarkdownText(markdownCodeBlock)`, MessageParts' text) with highlighting: ts/js/py/sh/json fences (and their
 * aliases, CODE_FENCE_LANGS) become a CodeBlock; any other language keeps Markdown's plain frame.
 * `<Markdown renderCode={markdownCodeBlock}>`. Kept out of Markdown so the highlighter is only bundled where it is used.
 */
export const markdownCodeBlock: MarkdownCodeRenderer = ({ code, lang }) => {
  const language = CODE_FENCE_LANGS[lang.toLowerCase()]
  return language ? <CodeBlock code={code} language={language} collapseAt={false} className="[overflow-wrap:normal]" /> : null
}
