import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react'
import { motion, useReducedMotion } from 'motion/react'
import { Button, Icon, IconButton, ScrollEdges, cn, sleep, spring, useControllable, useMediaQuery, useRoving, useScrollEdges, useSize, useWidth } from './core'
import { ActiveIndicator, SegmentedControl } from './forms'
import { CopyButton } from './feedback'
import { useViewport } from './motion'

/* ════════════════════════════════════════════════════════════════════════════
 * Code: highlighted block, install command, tabbed example, terminal, diff.
 * Tokenised in the page with one regex per language (no highlighter library).
 * ══════════════════════════════════════════════════════════════════════════ */

export type CodeLanguage = 'ts' | 'js' | 'py' | 'sh' | 'json'
type CodeTokenKind = 'com' | 'str' | 'kw' | 'num' | 'fn' | 'attr' | 'prop' | 'var' | 'pre'

const CODE_TOKEN_CLASS: Record<CodeTokenKind, string> = {
  com: 'text-[var(--fg3)] italic',
  str: 'text-[color-mix(in_srgb,var(--ok)_72%,var(--fg))]',
  kw: 'text-[color-mix(in_srgb,var(--bad)_75%,var(--fg))]',
  num: 'text-[color-mix(in_srgb,var(--c3)_70%,var(--fg))]',
  fn: 'text-[var(--accent)]',
  attr: 'text-[color-mix(in_srgb,var(--warn)_66%,var(--fg))]',
  prop: 'text-[var(--accent)]',
  var: 'text-[color-mix(in_srgb,var(--c3)_70%,var(--fg))]',
  pre: '',
}
const CODE_JS: [RegExp, CodeTokenKind[]] = [/(\/\/.*$)|(`(?:\\.|[^`])*`|'(?:\\.|[^'])*'|"(?:\\.|[^"])*")|\b(const|let|var|function|return|if|else|for|while|import|from|export|default|await|async|new|class|extends|true|false|null|undefined|try|catch|throw|of|in|type|interface|as|satisfies|typeof|keyof)\b|\b(\d+(?:\.\d+)?)\b|([A-Za-z_$][\w$]*)(?=\s*\()/g, ['com', 'str', 'kw', 'num', 'fn']]
const CODE_LANGS: Record<CodeLanguage, [RegExp, CodeTokenKind[]]> = {
  ts: CODE_JS,
  js: CODE_JS,
  py: [/(#.*$)|(f?"(?:\\.|[^"])*"|f?'(?:\\.|[^'])*')|\b(def|class|return|import|from|as|if|elif|else|for|in|while|with|True|False|None|await|async|lambda|try|except|raise|print)\b|\b(\d+(?:\.\d+)?)\b|([A-Za-z_]\w*)(?=\s*\()|(@\w+)/g, ['com', 'str', 'kw', 'num', 'fn', 'attr']],
  sh: [/(#.*$)|("(?:\\.|[^"])*"|'(?:\\.|[^'])*')|(^|\s)(npm|pnpm|yarn|bun|npx|curl|git|cd|export|echo)\b|(\s-{1,2}[\w-]+)|(\$\w+|\$\{[^}]+\})/g, ['com', 'str', 'pre', 'kw', 'attr', 'var']],
  json: [/("(?:\\.|[^"])*")(?=\s*:)|("(?:\\.|[^"])*")|\b(true|false|null)\b|(-?\d+(?:\.\d+)?)/g, ['prop', 'str', 'kw', 'num']],
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

/** Highlight one line of code: returns spans coloured with theme tokens. */
export function highlightCode(line: string, lang: CodeLanguage = 'ts'): ReactNode[] {
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
/**
 * Diff two sequences by longest common subsequence: lcsDiff(beforeLines, afterLines) or over words, items, anything.
 * `equal` compares two items (default ===); `prefer` picks which side comes first when both are possible (default 'delete').
 */
export function lcsDiff<T>(before: readonly T[], after: readonly T[], { equal = (x: T, y: T) => x === y, prefer = 'delete' }: { equal?: (x: T, y: T) => boolean; prefer?: 'delete' | 'insert' } = {}): LcsStep[] {
  const m = before.length, n = after.length
  const L = Array.from({ length: m + 1 }, () => new Array<number>(n + 1).fill(0))
  for (let i = m - 1; i >= 0; i--) for (let j = n - 1; j >= 0; j--) L[i][j] = equal(before[i], after[j]) ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1])
  const out: LcsStep[] = []
  for (let i = 0, j = 0; i < m || j < n;) {
    if (i < m && j < n && equal(before[i], after[j])) out.push({ type: '=', a: i++, b: j++ })
    else if (j >= n || (i < m && (prefer === 'delete' ? L[i + 1][j] >= L[i][j + 1] : L[i + 1][j] > L[i][j + 1]))) out.push({ type: '-', a: i++, b: null })
    else out.push({ type: '+', a: null, b: j++ })
  }
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

function CodeRows({ rows, lang, wrap, numbers = true, className }: { rows: CodeRow[]; lang: CodeLanguage; wrap?: boolean; numbers?: boolean; className?: string }) {
  return (
    <pre className={cn('relative m-0 overflow-auto py-2.5 font-[family-name:var(--mono)] text-[12.5px] leading-[1.65] [contain:inline-size]', className)}>
      {rows.map((r, i) => (
        <span key={i} data-kind={r.kind} className={cn('flex min-h-[1.65em] pr-3', r.kind && CODE_ROW_BG[r.kind])}>
          {numbers && (
            <span className={cn('relative w-[46px] flex-none pr-4 text-right whitespace-nowrap select-none', r.kind === 'hi' ? 'text-[var(--accent)]' : 'text-[var(--fg3)] opacity-60', (r.kind === 'add' || r.kind === 'del') && 'opacity-100')}>
              {r.no ?? ''}{r.kind === 'add' && <span className="absolute right-1 text-[var(--ok)]">+</span>}{r.kind === 'del' && <span className="absolute right-1 text-[var(--bad)]">−</span>}
            </span>
          )}
          <span className={cn('min-w-0 flex-1', wrap ? 'break-words whitespace-pre-wrap' : 'whitespace-pre')}>{r.plain ? r.text : (r.text ? highlightCode(r.text, lang) : ' ')}</span>
        </span>
      ))}
    </pre>
  )
}

const CODE_HEAD = 'flex h-10 items-center gap-2 border-b border-[var(--line)] bg-[var(--card)] pr-1.5 pl-3 text-xs [@media(pointer:coarse)]:h-11'
/** Header that may wrap onto a second row on narrow cards (no tabs inside, so no fixed height needed). */
const CODE_HEAD_WRAP = 'flex min-h-10 flex-wrap items-center gap-x-2 gap-y-1 border-b border-[var(--line)] bg-[var(--card)] py-1 pr-1.5 pl-3 text-xs [@media(pointer:coarse)]:min-h-11'
const CODE_BOX = 'overflow-hidden rounded-[var(--r-lg)] border border-[var(--line)] bg-[color-mix(in_srgb,var(--muted)_45%,var(--card))]'
/** Small text button in a code header (Wrap, Changes, Copy): ghost Button, 28px (36px on touch). */
const CODE_TOOL = '!h-7 !gap-1 !px-2 font-medium text-[var(--fg2)] hover:text-[var(--fg)] aria-pressed:!bg-[var(--muted)] aria-pressed:text-[var(--fg)] [@media(pointer:coarse)]:!h-9 [@media(pointer:coarse)]:min-w-9'

/** Copy button for a code header: "Copy" → "Copied" (icon only on phones, or always with `iconOnly`). */
function CodeCopy({ text, iconOnly, label = 'Copy' }: { text: () => string; iconOnly?: boolean; label?: string }) {
  const phone = useMediaQuery('(max-width: 639px)')
  const icon = iconOnly || phone
  return <CopyButton text={text} label={label} size={icon ? 'icon-sm' : 'sm'} iconOnly={icon} variant="ghost" className={icon ? 'text-[var(--fg2)] hover:text-[var(--fg)]' : CODE_TOOL} />
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
            {t === value && <ActiveIndicator group={group} className="top-auto bottom-0 h-0.5 rounded-sm bg-[var(--fg)]" />}
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
 * Pass `previous` to get a "Changes +N −M" toggle that shows an inline diff; long code collapses behind
 * a fade with "Show all N lines". Without `defaultWrap`, lines wrap by default when the block is narrower than 520px (phones).
 */
export function CodeBlock({ code, filename, language, lineNumbers = true, highlight = [], previous, defaultWrap, collapseAt = 300, className }:
  { code: string; filename?: string; language?: CodeLanguage; lineNumbers?: boolean; highlight?: number[]; previous?: string; defaultWrap?: boolean; collapseAt?: number | false; className?: string }) {
  const lang = language ?? codeLanguageOf(filename)
  const lines = useMemo(() => code.replace(/\n$/, '').split('\n'), [code])
  const diff = useMemo(() => previous == null ? null : codeLineDiff(previous.replace(/\n$/, '').split('\n'), lines), [previous, lines])
  const adds = diff?.filter(r => r.type === '+').length ?? 0, dels = diff?.filter(r => r.type === '-').length ?? 0
  const [box, boxW] = useWidth<HTMLDivElement>()
  const [wrapSet, setWrap] = useState<boolean | null>(null) // null until the reader toggles it
  const wrap = wrapSet ?? defaultWrap ?? (boxW > 0 && boxW < 520)
  const [diffOn, setDiffOn] = useState(false)
  const [open, setOpen] = useState(false)
  const [inner, { height: full }] = useSize<HTMLDivElement>()
  const rows: CodeRow[] = diffOn && diff
    ? diff.map(r => ({ text: r.text, no: r.type === '-' ? r.a : r.b, kind: r.type === '+' ? 'add' : r.type === '-' ? 'del' : undefined }))
    : lines.map((text, i) => ({ text, no: i + 1, kind: highlight.includes(i + 1) ? 'hi' : undefined }))
  const collapsible = collapseAt !== false && full > collapseAt + 40
  const height = !collapsible ? 'auto' : open ? full + 48 : collapseAt
  return (
    <div ref={box} className={cn(CODE_BOX, className)}>
      <div className={CODE_HEAD_WRAP}>
        <span className="flex min-w-0 items-center gap-1.5 font-medium text-[var(--fg)]"><Icon name="file" size={13} className="text-[var(--fg3)]" /><span className="truncate">{filename ?? 'snippet'}</span></span>
        <span className="flex-none rounded-[5px] bg-[var(--muted)] px-1.5 py-0.5 font-[family-name:var(--mono)] text-[11px] font-medium text-[var(--fg3)] max-[420px]:hidden">{CODE_LANGUAGE_NAMES[lang]}</span>
        <span className="flex-1" />
        {diff && (
          <Button size="sm" variant="ghost" className={CODE_TOOL} aria-pressed={diffOn} onClick={() => setDiffOn(v => !v)} title="Changes since the previous version">
            <Icon name="diff" size={13} /><span className="max-sm:sr-only">Changes</span>
            <span className="ui-num text-[11px]"><span className="text-[var(--ok)]">+{adds}</span> <span className="text-[var(--bad)]">−{dels}</span></span>
          </Button>
        )}
        <Button size="sm" variant="ghost" className={CODE_TOOL} aria-pressed={wrap} onClick={() => setWrap(!wrap)} title="Wrap lines"><Icon name="wrap" size={13} className="sm:hidden" /><span className="max-sm:hidden">Wrap</span><span className="sr-only sm:hidden">Wrap lines</span></Button>
        <CodeCopy text={() => code} />
      </div>
      <motion.div className="relative overflow-hidden" initial={false} animate={{ height }} transition={spring(0.12, 0.45)}>
        <div ref={inner}>
          <motion.div key={String(diffOn)} initial={{ opacity: 0.3 }} animate={{ opacity: 1 }} transition={{ duration: 0.2 }}>
            <CodeRows rows={rows} lang={lang} wrap={wrap} numbers={lineNumbers} className={cn(!wrap && 'overflow-y-hidden')} />
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
  return <code className={cn('rounded-[5px] border border-[var(--line)] bg-[var(--muted)] px-1.5 py-px font-[family-name:var(--mono)] text-[max(0.9em,11px)]', className)}>{children}</code>
}

/* ── Install command ───────────────────────────────────────────────────────── */

const CODE_PMS = { npm: 'npm install', pnpm: 'pnpm add', yarn: 'yarn add', bun: 'bun add' } as const
export type PackageManager = keyof typeof CODE_PMS

/** Install command with package-manager tabs (sliding underline) and a Copy → Copied button. */
export function InstallCommand({ pkg, value, defaultValue = 'npm', onChange, className }:
  { pkg: string; value?: PackageManager; defaultValue?: PackageManager; onChange?: (pm: PackageManager) => void; className?: string }) {
  const [pm, setPm] = useControllable<PackageManager>(value, defaultValue, onChange)
  const cmd = `${CODE_PMS[pm]} ${pkg}`
  return (
    <div className={cn(CODE_BOX, className)}>
      <div className={cn(CODE_HEAD, '!pl-1')}>
        <CodeHeaderTabs tabs={Object.keys(CODE_PMS)} value={pm} onChange={v => setPm(v as PackageManager)} label="Package manager" />
        <CodeCopy text={() => cmd} />
      </div>
      <motion.div key={pm} initial={{ opacity: 0, x: -4 }} animate={{ opacity: 1, x: 0 }} transition={{ duration: 0.2 }}>
        <CodeRows rows={[{ text: cmd, no: null }]} lang="sh" numbers={false} className="!py-3 pl-3" />
      </motion.div>
    </div>
  )
}

/* ── Tabbed example ────────────────────────────────────────────────────────── */

export type CodeTab = { label: string; code: string; language?: CodeLanguage }
/** The same example in several languages. Tabs slide, the box animates its height, Copy copies the open tab. */
export function CodeTabs({ tabs, value, defaultValue, onChange, className }: { tabs: CodeTab[]; value?: string; defaultValue?: string; onChange?: (v: string) => void; className?: string }) {
  const [cur, setCur] = useControllable(value, defaultValue ?? tabs[0].label, onChange)
  const tab = tabs.find(t => t.label === cur) ?? tabs[0]
  const [inner, { height: h }] = useSize<HTMLDivElement>()
  return (
    <div className={cn(CODE_BOX, className)}>
      <div className={cn(CODE_HEAD, '!pl-1')}>
        <CodeHeaderTabs tabs={tabs.map(t => t.label)} value={tab.label} onChange={setCur} label="Example language" />
        <CodeCopy text={() => tab.code} />
      </div>
      <motion.div className="overflow-hidden" initial={false} animate={{ height: h || 'auto' }} transition={spring(0.15, 0.4)}>
        <div ref={inner} role="tabpanel" aria-label={tab.label}>
          <motion.div key={tab.label} initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.22 }}>
            <CodeRows rows={tab.code.split('\n').map((text, i) => ({ text, no: i + 1 }))} lang={tab.language ?? 'ts'} />
          </motion.div>
        </div>
      </motion.div>
    </div>
  )
}

/* ── Terminal ──────────────────────────────────────────────────────────────── */

export type TerminalLine = { cmd: string } | { out: ReactNode }
type TerminalShown = { cmd?: string; out?: ReactNode; typing?: boolean }
const TERM_CURSOR = 'inline-block h-3.5 w-[7px] bg-[var(--fg)] align-[-2px] animate-[ui-blink_1s_steps(1)_infinite]'

/**
 * Terminal: commands type out character by character, output streams in, then a prompt waits with a
 * blinking cursor. Starts when scrolled into view; the header button replays it.
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
      <div className="flex h-[34px] items-center gap-1.5 border-b border-[var(--line)] bg-[color-mix(in_srgb,var(--card)_50%,transparent)] pr-1.5 pl-3 text-[11px] text-[var(--fg3)] [@media(pointer:coarse)]:h-11">
        <i className="h-2.5 w-2.5 rounded-full bg-[#ED6A5E]" /><i className="h-2.5 w-2.5 rounded-full bg-[#F4BF4F]" /><i className="h-2.5 w-2.5 rounded-full bg-[#61C554]" />
        <span className="ml-2">{title}</span>
        <IconButton icon={<Icon name="replay" size={13} />} label="Replay" onClick={play} className="ml-auto [@media(pointer:coarse)]:!h-9 [@media(pointer:coarse)]:!w-9" />
      </div>
      <div className="m-0 min-h-[210px] p-3 font-[family-name:var(--mono)] text-xs leading-[1.6] break-words whitespace-pre-wrap" role="log" aria-live="off">
        {shown.map((l, i) => l.cmd !== undefined
          ? <div key={i}><span className="text-[var(--ok)]">❯</span> <span>{l.cmd}</span>{l.typing && <span className={cursor} />}</div>
          : <motion.div key={i} initial={reduce ? false : { opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.2 }}>{l.out}</motion.div>)}
        {done && <div><span className="text-[var(--ok)]">❯</span> <span className={cursor} /></div>}
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
        <CodeCopy text={() => after} iconOnly label="Copy new version" />
      </div>
      <motion.div key={mode} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.2 }}>
        {mode === 'unified'
          ? <CodeRows lang={lang} rows={[head, ...rows.map((r): CodeRow => ({ text: r.text, no: r.type === '-' ? r.a : r.b, kind: r.type === '+' ? 'add' : r.type === '-' ? 'del' : undefined }))]} />
          : <div className="grid grid-cols-2">
              <CodeRows lang={lang} rows={[{ ...head, text: `@@ -1,${A.length} @@` }, ...pairs.map(p => p[0])]} />
              <CodeRows lang={lang} rows={[{ ...head, text: `@@ +1,${B.length} @@` }, ...pairs.map(p => p[1])]} className="border-l border-[var(--line)]" />
            </div>}
      </motion.div>
    </div>
  )
}
