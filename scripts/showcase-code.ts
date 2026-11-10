// Build-time data for the showcase's view-code drawer (src/showcase/CodeDrawer.tsx), served by a Vite plugin so the page
// ships each card's usage example and the props of the components it renders, not raw source: the drawer used to bundle
// every *Section.tsx as text (~520 KB, eager) and read props by parsing ~2.9 MB of library source in the browser.
//
// The drawer imports `import.meta.glob('./*Section.tsx', { query: '?showcase-code', import: 'default' })`: lazy, so a
// section's data loads the first time the drawer opens. This plugin answers those ids with that section's data:
//   { examples: { [card title]: { code, file, components } }, props: { [component]: api } }
// Usage examples are sliced from the card's own JSX (its <Spec> children, plus the state, helpers and imports they use);
// props come from the TypeScript types (scripts/registry/api.mjs, the same tables as the docs site).
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import type { Plugin } from 'vite'
import { analyze } from './registry/analyze.mjs'
import { apiOfDecl } from './registry/api.mjs'
import { bundleOf } from './tiers.mjs'

/** A card's usage example: the code, the section file it came from, and the library components it renders (in order). */
export type CodeExample = { code: string; file: string; components: string[] }

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
export const codeTitleOf = (tag: string) => {
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
export function codeExampleFor(title: string, sources: Record<string, string>): CodeExample | null {
  for (const [path, src] of Object.entries(sources)) {
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
    // library imports point at the single-file bundles: core at ./ui, each extras module at its bundle (ui-charts …)
    const byFrom = new Map<string, string[]>()
    for (const imp of imports) {
      const m = imp.match(/^import\s+(type\s+)?\{([\s\S]*)\}\s*from\s*'([^']+)'/)
      if (!m) continue
      const lib = /^\.\.\/lib(?:\/(\w+))?$/.exec(m[3])
      const bundle = lib?.[1] ? bundleOf(lib[1]) : 'ui'
      if (!bundle) throw new Error(`showcase-code: ${m[3]} is in no single-file bundle (scripts/tiers.mjs)`)
      const from = lib ? `./${bundle}` : m[3]
      if (from === './kit') continue
      const names = m[2].split(',').map(n => n.trim()).filter(Boolean).filter(n => need.has(n.replace(/^type\s+/, '').split(/\s+as\s+/).pop()!))
        .map(n => (m[1] && !n.startsWith('type ') ? `type ${n}` : n))
      byFrom.set(from, [...(byFrom.get(from) ?? []), ...names])
    }
    if (needRow && !byFrom.get('./ui')?.includes('cn')) byFrom.set('./ui', [...(byFrom.get('./ui') ?? []), 'cn'])
    const importLines = [...byFrom].filter(([, names]) => names.length).map(([from, names]) =>
      names.every(n => n.startsWith('type ')) ? `import type { ${names.map(n => n.slice(5)).join(', ')} } from '${from}'` : `import { ${names.join(', ')} } from '${from}'`)
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
    // the library components it renders, in order of first use (for the Props tab)
    const libNames = new Set(imports.filter(i => /from '\.\.\/lib(\/\w+)?'/.test(i)).flatMap(i => (i.match(/\{([\s\S]*)\}/)?.[1] ?? '').split(',').map(n => n.trim()).filter(n => /^[A-Z]/.test(n))))
    const components = [...new Set([...code.matchAll(/<([A-Z][\w]*)[\s/>]/g)].map(m => m[1]).filter(n => libNames.has(n)))]
    return { code, file: path.replace(/^\.\//, 'src/showcase/'), components }
  }
  return null
}

/* The plugin ────────────────────────────────────────────────────────────────── */

const QUERY = '?showcase-code'

/** A component the showcase loads lazily (kit.tsx, specLazy): `const LazyX = specLazy(() => import('../lib/m').then(m => m.X))`,
 * with the one-line comment above it (a comment would otherwise stick to the import that replaces it). */
const LAZY = /^(?:\/\*[^\n]*\*\/\n)?const (Lazy(\w+)) = specLazy\(\(\) => import\('\.\.\/lib\/(\w+)'\)\.then\(m => m\.(\w+)\)\)\n/gm

/** Every card's example in one section file. */
function showcaseExamples(file: string, raw: string): Record<string, CodeExample> {
  const out: Record<string, CodeExample> = {}
  // a lazily loaded library component reads as the plain import it stands for (LazyX is X in the example)
  const lazy = new Map<string, { name: string; mod: string }>()
  let src = raw.replace(LAZY, (m, local: string, short: string, mod: string, name: string) => { if (short !== name) return m; lazy.set(local, { name, mod }); return '' })
  if (lazy.size) {
    src = `${[...lazy.values()].map(({ name, mod }) => `import { ${name} } from '../lib/${mod}'`).join('\n')}\n${src}`
    src = src.replace(new RegExp(`\\b(${[...lazy.keys()].join('|')})\\b`, 'g'), l => lazy.get(l)!.name)
  }
  const open = /<Spec\b/g
  for (let m = open.exec(src); m; m = open.exec(src)) {
    const title = codeTitleOf(src.slice(m.index, codeTagEnd(src, m.index + 5).end))
    if (title && !out[title]) { const ex = codeExampleFor(title, { [file]: src }); if (ex) out[title] = ex }
  }
  return out
}

type ShowcaseCodeData = { stamp: number; sections: Map<string, { examples: Record<string, CodeExample>; props: Record<string, unknown> }> }

/** Serves `src/showcase/XSection.tsx?showcase-code`. Everything is worked out once (one TypeScript program for the props) and
 * again only when a section or library file has changed since. */
export function showcaseCode({ root }: { root: string }): Plugin {
  const showcase = join(root, 'src/showcase'), dirs = ['src/lib', 'src/blocks', 'src/showcase'].map(d => join(root, d))
  let data: ShowcaseCodeData | null = null
  const stampNow = () => Math.max(...dirs.flatMap(d => readdirSync(d).filter(f => /\.tsx?$/.test(f)).map(f => statSync(join(d, f)).mtimeMs)))
  const build = (): ShowcaseCodeData => {
    const stamp = stampNow()
    if (data && data.stamp === stamp) return data
    const files = readdirSync(showcase).filter(f => /Section\.tsx$/.test(f)).sort()
    const examples = new Map(files.map(f => [f, showcaseExamples(`./${f}`, readFileSync(join(showcase, f), 'utf8'))]))
    const names = new Set([...examples.values()].flatMap(e => Object.values(e).flatMap(x => x.components)))
    const api = new Map<string, unknown>()
    const graph = analyze(root, { extraDirs: ['src/blocks'] })
    try { for (const n of names) { const a = apiOfDecl(graph, n); if (a?.kind === 'component') api.set(n, a) } } finally { graph.close() }
    const sections = new Map([...examples].map(([f, ex]) => {
      const props = Object.fromEntries([...new Set(Object.values(ex).flatMap(x => x.components))].filter(n => api.has(n)).map(n => [n, api.get(n)]))
      return [f, { examples: ex, props }]
    }))
    return (data = { stamp, sections })
  }
  return {
    name: 'showcase-code',
    load(id) {
      if (!id.endsWith(QUERY)) return null
      const path = id.slice(0, -QUERY.length), file = path.slice(path.lastIndexOf('/') + 1)
      this.addWatchFile(path)
      const section = build().sections.get(file) ?? { examples: {}, props: {} }
      return { code: `export default JSON.parse(${JSON.stringify(JSON.stringify(section))})`, moduleType: 'js' }
    },
  }
}
