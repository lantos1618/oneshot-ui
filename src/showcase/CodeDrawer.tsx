import { useSyncExternalStore } from 'react'
import { motion, useDragControls } from 'motion/react'
import { CodeBlock, IconButton, ModalLayer, cn, spring, useMediaQuery } from '../lib'

/* View code: the `</>` button on every card opens this drawer with a copy-pasteable usage example built from the
 * card's own JSX in the showcase source (its <Spec> children, plus the state, helpers and imports they use). */

/** Raw source of every section file, keyed by path. Vite inlines it; anywhere else (the single-file build in another
 * bundler, or no bundler at all) `import.meta.glob` doesn't exist, the call throws, and the drawer says so. */
const codeSources: Record<string, string> = (() => {
  try { return import.meta.glob('./*Section.tsx', { query: '?raw', import: 'default', eager: true }) as Record<string, string> } catch { return {} }
})()

/* Drawer state: one drawer for the whole page, opened from any card. */
let codeDrawerTitle = ''
const codeDrawerListeners = new Set<() => void>()
const codeDrawerSet = (t: string) => { codeDrawerTitle = t; codeDrawerListeners.forEach(l => l()) }
/** Open the view-code drawer for the card with this title. */
export const openCodeDrawer = (title: string) => codeDrawerSet(title)

/* Source scanning ───────────────────────────────────────────────────────────── */

/** Skip a `{…}` expression starting at `i` (strings and template literals inside are skipped whole). Returns the index after `}`. */
function codeSkipBraces(s: string, i: number) {
  let depth = 0
  for (; i < s.length; i++) {
    const c = s[i]
    if (c === '"' || c === "'" || c === '`') { const q = c; for (i++; i < s.length && s[i] !== q; i++) if (s[i] === '\\') i++; continue }
    if (c === '{') depth++
    else if (c === '}' && --depth === 0) return i + 1
  }
  return s.length
}
/** End of a JSX opening tag whose attributes start at `i`: index after `>`, and whether it was `/>`. */
function codeTagEnd(s: string, i: number) {
  for (; i < s.length; i++) {
    const c = s[i]
    if (c === '"' || c === "'") { const q = c; for (i++; i < s.length && s[i] !== q; i++); continue }
    if (c === '{') { i = codeSkipBraces(s, i) - 1; continue }
    if (c === '>') return { end: i + 1, self: s[i - 1] === '/' }
  }
  return { end: s.length, self: true }
}
const codeTitleOf = (tag: string) => {
  const m = tag.match(/\btitle=(?:"([^"]*)"|\{\s*'([^']*)'\s*\}|\{\s*"([^"]*)"\s*\}|\{\s*`([^`]*)`\s*\})/)
  return m ? (m[1] ?? m[2] ?? m[3] ?? m[4]) : null
}

/** The children of `<Spec title="…">…</Spec>` in `src`, tracking nested Specs so the right `</Spec>` closes it. */
function codeFindSpec(src: string, title: string): { inner: string; at: number } | null {
  const open = /<Spec\b/g
  for (let m = open.exec(src); m; m = open.exec(src)) {
    const tag = codeTagEnd(src, m.index + 5)
    if (codeTitleOf(src.slice(m.index, tag.end)) !== title) continue
    if (tag.self) return { inner: '', at: m.index }
    const tok = /<Spec\b|<\/Spec\s*>/g
    tok.lastIndex = tag.end
    let depth = 1
    for (let t = tok.exec(src); t; t = tok.exec(src)) {
      if (t[0].startsWith('</')) { if (--depth === 0) return { inner: src.slice(tag.end, t.index), at: m.index } }
      else { const inner = codeTagEnd(src, t.index + 5); if (!inner.self) depth++; tok.lastIndex = inner.end }
    }
    return null
  }
  return null
}

/** Remove the common indent and blank edges. */
function codeDedent(s: string) {
  const lines = s.replace(/^\s*\n/, '').replace(/\n\s*$/, '').split('\n')
  if (lines.length === 1) return lines[0].trim()
  const ind = Math.min(...lines.filter(l => l.trim()).map(l => l.match(/^ */)![0].length))
  return lines.map(l => l.slice(ind)).join('\n')
}
const codeIndent = (s: string, n: number) => s.split('\n').map(l => (l.trim() ? ' '.repeat(n) + l : l)).join('\n')

/** Identifiers a piece of code refers to, ignoring JSX text, strings, property names, object keys and JSX attribute names. */
function codeIdents(s: string) {
  const bare = s.replace(/`(?:[^`\\]|\\.)*`/g, m => (m.match(/(?<!\\)\$\{[^}]*\}/g) ?? []).join(' '))
    .replace(/>([^<>{}\n]*)</g, '><')
    .replace(/"[^"\n]*"|'[^'\n]*'/g, '""')
    .replace(/(?<!\.)\.(?!\.)\s*[A-Za-z_$][\w$]*/g, '')
    .replace(/([{,]\s*)[A-Za-z_$][\w$]*\s*:(?!:)/g, '$1')
    .replace(/(\s)[A-Za-z_$][\w$-]*=(?=["{'])/g, '$1')
  return new Set(bare.match(/[A-Za-z_$][\w$]*/g) ?? [])
}

/** Is a template literal still open at the end of this line? (Quotes and line comments outside it are skipped.) */
function codeTemplateAfter(line: string, open: boolean) {
  for (let i = 0; i < line.length; i++) {
    const c = line[i]
    if (open) { if (c === '\\') i++; else if (c === '`') open = false; continue }
    if (c === '"' || c === "'") { const q = c; for (i++; i < line.length && line[i] !== q; i++) if (line[i] === '\\') i++; continue }
    if (c === '/' && line[i + 1] === '/') break
    if (c === '`') open = true
  }
  return open
}

const CODE_IDENT = /^[A-Za-z_$][\w$]*/
/** Names bound by a `{ a, b: c, ...d }` or `[a, b = 1]` pattern. */
const codePatternNames = (inner: string) => inner.split(',').map(x => x.trim().replace(/^\.\.\./, '').split(/\s*=\s*/)[0].split(/\s*:\s*/).pop()!.trim()).filter(x => CODE_IDENT.test(x))
/** Names a declaration line binds: `function A`, `type A`, or every binding of `const a = …, { b, c } = …`. */
function codeDeclNames(line: string): string[] {
  const m = line.trim().match(/^(?:export\s+)?(?:default\s+)?(?:async\s+)?(function\*?|const|let|var|type|interface|class|enum)\s+(.*)$/)
  if (!m) return []
  if (!['const', 'let', 'var'].includes(m[1])) { const n = m[2].match(CODE_IDENT); return n ? [n[0]] : [] }
  const s = m[2], names: string[] = []
  for (let i = 0, first = true; i < s.length; first = false) {
    while (s[i] === ' ') i++
    if (!first && !/^(?:[A-Za-z_$][\w$]*|\{[^}]*\}|\[[^\]]*\])\s*(?::[^=]*)?=(?![=>])/.test(s.slice(i))) break
    if (s[i] === '{' || s[i] === '[') { const j = s.indexOf(s[i] === '{' ? '}' : ']', i); if (j < 0) break; names.push(...codePatternNames(s.slice(i + 1, j))); i = j + 1 }
    else { const n = s.slice(i).match(CODE_IDENT); if (!n) break; names.push(n[0]); i += n[0].length }
    // on to the next top-level comma
    let depth = 0
    for (; i < s.length; i++) {
      const c = s[i]
      if (c === '"' || c === "'" || c === '`') { const q = c; for (i++; i < s.length && s[i] !== q; i++) if (s[i] === '\\') i++; continue }
      if ('([{'.includes(c)) depth++
      else if (')]}'.includes(c)) depth--
      else if (depth === 0 && c === ';') return names
      else if (depth === 0 && c === ',') { i++; break }
    }
  }
  return names
}

type CodeChunk = { text: string; names: string[]; uses: Set<string>; start: number; end: number }

/** Split a file's top level into imports and declarations (a leading comment sticks to the declaration after it). */
function codeTopLevel(src: string): { imports: string[]; chunks: CodeChunk[] } {
  const lines = src.split('\n'), imports: string[] = [], chunks: CodeChunk[] = []
  let cur: string[] = [], comment: string[] = [], curStart = 0, commentStart = 0, pos = 0
  const flush = () => {
    if (!cur.length) return
    const text = cur.join('\n').replace(/\s+$/, '')
    if (/^import\b/.test(text)) imports.push(text)
    else {
      const first = cur.find(l => !/^\s*(\/\/|\/\*|\*)/.test(l)) ?? ''
      chunks.push({ text, names: codeDeclNames(first), uses: codeIdents(text), start: curStart, end: curStart + text.length })
    }
    cur = []
  }
  let inComment = false, inTemplate = false
  for (const line of lines) {
    const col0 = line.length > 0 && !/^\s/.test(line)
    const wasTemplate = inTemplate
    inTemplate = codeTemplateAfter(line, inTemplate)
    if (wasTemplate) cur.push(line)
    else if (inComment) { (cur.length ? cur : comment).push(line); if (line.includes('*/')) inComment = false }
    else if (col0 && /^(\/\/|\/\*)/.test(line)) { flush(); if (!comment.length) commentStart = pos; comment.push(line); inComment = line.startsWith('/*') && !line.includes('*/') }
    else if (col0 && !/^[}\])>'"`]/.test(line)) { flush(); curStart = comment.length ? commentStart : pos; cur = [...comment, line]; comment = [] }
    else if (!line.trim() && !cur.length) comment = []
    else { if (!cur.length) curStart = pos; cur.push(line) }
    pos += line.length + 1
  }
  flush()
  return { imports, chunks }
}

/** The component a card lives in: its parameters and the statements before its `return`, split at their indent. */
function codeComponent(chunk: CodeChunk): { params: string; statements: CodeChunk[] } | null {
  const lines = chunk.text.split('\n'), at = lines.findIndex(l => !/^\s*(\/\/|\/\*|\*)/.test(l))
  const sig = lines[at]?.match(/^(?:export\s+)?(?:default\s+)?function\s+\w+\s*\((.*)\)\s*(?::[^{]*)?\{\s*$/) ?? lines[at]?.match(/^(?:export\s+)?const\s+\w+\s*=\s*\((.*)\)\s*(?::[^=]*)?=>\s*\{\s*$/)
  if (!sig) return null
  const ret = lines.findIndex((l, i) => i > at && /^ {2}return\b/.test(l))
  const statements: CodeChunk[] = []
  let cur: string[] = []
  const flush = () => {
    if (!cur.length) return
    const text = codeDedent(cur.join('\n'))
    statements.push({ text, names: codeDeclNames(text.split('\n')[0]), uses: codeIdents(text), start: 0, end: 0 }); cur = []
  }
  for (const line of lines.slice(at + 1, ret < 0 ? lines.length - 1 : ret)) {
    if (!line.trim()) continue
    if (/^ {2}\S/.test(line) && !/^ {2}[}\])]/.test(line)) flush()
    cur.push(line)
  }
  flush()
  return { params: sig[1].trim(), statements }
}

/** Does this JSX have exactly one root element (so it needs no fragment)? Heuristic over its unindented lines. */
function codeSingleRoot(jsx: string) {
  const roots = jsx.split('\n').filter(l => /^\S/.test(l) && !/^(<\/|\/>|>|[}\])])/.test(l))
  return roots.length === 1 && /^<[A-Za-z]/.test(roots[0]) && !/(\/>|<\/[\w.]*>)\s*\S/.test(roots[0].replace(/(\/>|<\/[\w.]*>)\s*$/, ''))
}

const codePascal = (t: string) => t.replace(/[^A-Za-z0-9]+/g, ' ').trim().split(' ').map(w => w[0].toUpperCase() + w.slice(1)).join('') || 'Component'
const CODE_ROW_CLASS = 'flex flex-wrap items-center gap-2'

/** A usage example for one card: imports, the helpers and state its JSX needs, and the JSX itself. */
export function codeExampleFor(title: string): { code: string; file: string } | null {
  for (const [path, src] of Object.entries(codeSources)) {
    const found = codeFindSpec(src, title)
    if (!found) continue
    // the showcase's <Row> is a plain flex row: inline it so the example only needs the library
    const jsx = codeDedent(found.inner)
      .replace(/<Row>([\s\S]*?)<\/Row>/g, (m, inner: string) => /<Row\b/.test(inner) ? m : `<div className="${CODE_ROW_CLASS}">${inner}</div>`)
      .replace(/<Row className="([^"]*)">([\s\S]*?)<\/Row>/g, (m, c: string, inner: string) => /<Row\b/.test(inner) ? m : `<div className="${CODE_ROW_CLASS} ${c}">${inner}</div>`)
    const { imports, chunks } = codeTopLevel(src)
    // the component the card sits in supplies state, handlers and props
    const host = chunks.find(c => c.start <= found.at && found.at < c.end)
    const comp = host ? codeComponent(host) : null
    const statements = comp?.statements ?? [], helpersFrom = chunks.filter(c => c !== host)
    // what the JSX needs, transitively: the component's own statements, then top-level helpers and data
    // (helpers are top level, so only the JSX and the component's own statements can reach its locals)
    const need = codeIdents(jsx), needLocal = new Set(need), usedChunks = new Set<CodeChunk>(), usedStmts = new Set<CodeChunk>(), bound = new Set<string>()
    const declared = new Set(statements.flatMap(s => s.names)), state = new Set(statements.filter(s => /=\s*use(State|Reducer)\b/.test(s.text)).flatMap(s => s.names))
    for (let grew = true; grew;) {
      grew = false
      for (const s of statements) {
        if (usedStmts.has(s)) continue
        // an effect comes along when it drives state the card uses, unless it would drag in other state
        const hook = !s.names.length && /^use[A-Z]\w*\(/.test(s.text) && [...s.uses].some(u => bound.has(u)) && [...s.uses].every(u => !declared.has(u) || bound.has(u) || !state.has(u))
        if (hook || s.names.some(n => needLocal.has(n))) { usedStmts.add(s); s.names.forEach(n => bound.add(n)); s.uses.forEach(u => { need.add(u); needLocal.add(u) }); grew = true }
      }
      for (const c of helpersFrom) if (!usedChunks.has(c) && c.names.some(n => need.has(n))) { usedChunks.add(c); c.uses.forEach(u => need.add(u)); grew = true }
    }
    const needRow = need.has('Row')
    if (needRow) need.add('cn')
    const paramNames = comp?.params ? codeIdents(comp.params.split(/\)\s*:|}\s*:/)[0]) : new Set<string>()
    const usesParams = [...paramNames].some(p => need.has(p) && !bound.has(p))
    // keep only the imported names that are used; library imports point at the single-file build
    const importLines = imports.flatMap(imp => {
      const m = imp.match(/^import\s+(type\s+)?\{([\s\S]*)\}\s*from\s*'([^']+)'/)
      if (!m) return []
      const from = m[3] === '../lib' ? './ui' : m[3]
      if (from === './kit') return []
      const names = m[2].split(',').map(n => n.trim()).filter(Boolean).filter(n => need.has(n.replace(/^type\s+/, '').split(/\s+as\s+/).pop()!))
      if (from === './ui' && needRow && !names.includes('cn')) names.push('cn')
      return names.length ? [`import ${m[1] ?? ''}{ ${names.join(', ')} } from '${from}'`] : []
    })
    if (needRow) {
      const r = importLines.findIndex(l => / from 'react'$/.test(l) && l.startsWith('import {'))
      if (r >= 0) { if (!/\bReactNode\b/.test(importLines[r])) importLines[r] = importLines[r].replace(' }', ', type ReactNode }') }
      else importLines.unshift("import type { ReactNode } from 'react'")
    }
    const helpers = helpersFrom.filter(c => usedChunks.has(c)).map(c => c.text)
    if (needRow) helpers.unshift(`const Row = ({ children, className }: { children: ReactNode; className?: string }) => <div className={cn('${CODE_ROW_CLASS}', className)}>{children}</div>`)
    const body = statements.filter(s => usedStmts.has(s)).map(s => s.text)
    const ret = codeSingleRoot(jsx)
      ? (jsx.includes('\n') ? `return (\n${codeIndent(jsx, 4)}\n  )` : `return ${jsx}`)
      : `return (\n    <>\n${codeIndent(jsx, 6)}\n    </>\n  )`
    const fn = [`export function ${codePascal(title)}Example(${usesParams ? comp!.params : ''}) {`, ...body.map(b => codeIndent(b, 2)), `  ${ret}`, '}'].join('\n')
    const code = [importLines.join('\n'), ...helpers, fn].filter(Boolean).join('\n\n')
    return { code, file: path.replace(/^\.\//, 'src/showcase/') }
  }
  return null
}

/* Drawer ────────────────────────────────────────────────────────────────────── */

const codeSubscribe = (l: () => void) => { codeDrawerListeners.add(l); return () => { codeDrawerListeners.delete(l) } }

/**
 * Right-hand drawer with the open card's usage example; below 640px a bottom sheet (drag the handle or header down
 * to dismiss). Esc or the backdrop closes it; focus goes back to the `</>` button.
 */
export function CodeDrawer() {
  const title = useSyncExternalStore(codeSubscribe, () => codeDrawerTitle, () => '')
  const ex = title ? codeExampleFor(title) : null
  const close = () => codeDrawerSet('')
  const sheet = useMediaQuery('(max-width: 639px)') // same breakpoint as Sheet's bottom-sheet switch
  const drag = useDragControls()
  const off = sheet ? { y: '100%' } : { x: '100%' }
  const grab = sheet ? (e: React.PointerEvent) => drag.start(e) : undefined
  return (
    <ModalLayer open={!!title} onClose={close}>
      <motion.div key={sheet ? 'sheet' : 'drawer'} role="dialog" aria-modal="true" aria-label={`${title} usage`}
        initial={off} animate={{ x: 0, y: 0 }} exit={{ ...off, transition: { duration: 0.2 } }} transition={spring(0.12, 0.4)}
        drag={sheet ? 'y' : false} dragListener={false} dragControls={drag} dragConstraints={{ top: 0, bottom: 0 }} dragElastic={{ top: 0, bottom: 0.9 }}
        onDragEnd={(_, i) => { if (i.offset.y > 90 || i.velocity.y > 500) close() }}
        className={cn('fixed z-[71] flex flex-col bg-[var(--card)] shadow-[var(--shadow)]', sheet
          ? 'inset-x-0 bottom-0 max-h-[88dvh] rounded-t-2xl pb-[env(safe-area-inset-bottom,0px)]'
          : 'top-0 right-0 bottom-0 w-[min(620px,94vw)] pt-[env(safe-area-inset-top,0px)]')}>
        {sheet && <div aria-hidden onPointerDown={grab} className="flex flex-none cursor-grab touch-none justify-center pt-2 pb-1"><span className="h-1 w-9 rounded-full bg-[var(--line2)]" /></div>}
        <div onPointerDown={grab} className={cn('flex flex-none items-center gap-2 border-b border-[var(--line)] py-3 pr-3 pl-4', sheet && 'touch-none !pt-1')}>
          <h4 className="m-0 min-w-0 truncate text-[15px] font-semibold">{title}</h4>
          <span className="text-xs text-[var(--fg3)]">usage</span>
          <span className="flex-1" />
          <IconButton icon="x" label="Close" onClick={close} onPointerDown={e => e.stopPropagation()} />
        </div>
        <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-auto overscroll-contain p-4 max-sm:p-3">
          {ex ? (
            <>
              <CodeBlock code={ex.code} filename={`${codePascal(title)}.tsx`} language="ts" collapseAt={false} defaultWrap={matchMedia('(max-width: 640px)').matches} />
              <p className="m-0 text-xs text-[var(--fg3)]">From <code className="font-[family-name:var(--mono)]">{ex.file}</code>. Imports point at <code className="font-[family-name:var(--mono)]">./ui</code>, the single-file build.</p>
            </>
          ) : (
            <p className="m-0 rounded-[var(--r-md)] border border-dashed border-[var(--line2)] p-4 text-[13px] text-[var(--fg2)]">
              The showcase source isn’t bundled in this build. Look for <code className="font-[family-name:var(--mono)]">{`<Spec title="${title}">`}</code> in the examples to see how this card is built.
            </p>
          )}
        </div>
      </motion.div>
    </ModalLayer>
  )
}
