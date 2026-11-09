import { Fragment, createContext, memo, useContext, useMemo, useState, type CSSProperties, type ReactNode } from 'react'
import { Icon, ScrollEdges, cn, safeMediaUrl, safeUrl, useMediaQuery, useScrollEdges } from './core'
import { CopyButton } from './feedback'
import { CodeBlock, InlineCode, type CodeLanguage } from './code'
import { useViewport } from './motion'

/* ════════════════════════════════════════════════════════════════════════════
 * Markdown: a GFM-subset renderer for model output.
 * Own parser, linear time, React nodes only (no innerHTML). Raw HTML shows as text. Links go through safeUrl,
 * images render as links unless `images="allow"`. While `streaming`, half-received syntax at the end of the text
 * (an unclosed `**`, `` ` ``, `[text](ht`, a table header without its delimiter row, an open code fence) renders as
 * what it will most likely become, and completed blocks keep their identity so only the last ones re-render.
 * Not supported (shown as text): raw HTML, indented code blocks, setext headings (`---` is always a rule),
 * reference-style links and footnotes.
 * ══════════════════════════════════════════════════════════════════════════ */

/** Longer input is cut to this many characters before parsing (the renderer says so under the text). */
export const MARKDOWN_MAX_CHARS = 200_000
/** Block containers (quotes, list items) nested deeper than this render their content as a plain paragraph. */
const MD_MAX_DEPTH = 12
/** Emphasis nested deeper than this keeps its text but drops the extra wrappers. */
const MD_MAX_INLINE_DEPTH = 12
/** Table columns beyond this are dropped. */
const MD_MAX_COLS = 50
/** A link destination plus title longer than this is not a link (keeps failed matches cheap). */
const MD_LINK_MAX = 2048
const MD_SAFE_SCHEMES = ['https:', 'http:', 'mailto:']

export type MdInline =
  | { type: 'text'; text: string }
  | { type: 'code'; text: string }
  | { type: 'em' | 'strong' | 'del'; children: MdInline[] }
  /** `pending`: a link whose destination is still streaming in (rendered as link text without an href). */
  | { type: 'link'; href: string; title?: string; children: MdInline[]; pending?: boolean }
  | { type: 'image'; src: string; alt: string; title?: string }
  | { type: 'break' }
  | { type: 'citation'; n: number }

export type MdAlign = 'left' | 'center' | 'right' | null
/** `checked` is set on task items only. */
export type MdListItem = { checked?: boolean; children: MdBlock[] }
/** A parsed block. `range` is its [start, end) offsets in the source, set on top-level blocks. */
export type MdBlock = { range?: [number, number] } & (
  | { type: 'heading'; level: 1 | 2 | 3 | 4 | 5 | 6; children: MdInline[] }
  | { type: 'paragraph'; children: MdInline[] }
  /** `open`: the fence hasn't been closed (yet). */
  | { type: 'code'; lang: string; text: string; open?: boolean }
  | { type: 'quote'; children: MdBlock[] }
  | { type: 'list'; ordered: boolean; start?: number; tight: boolean; items: MdListItem[] }
  | { type: 'table'; align: MdAlign[]; head: MdInline[][]; rows: MdInline[][][] }
  | { type: 'hr' })

/* ── Block helpers (hand-written scanners: no regex with nested quantifiers on unbounded input) ──────────────── */

const mdBlank = (l: string) => /^\s*$/.test(l)
/** Leading indentation in columns (tab → next multiple of 4). */
function mdIndent(l: string) {
  let c = 0
  for (let i = 0; i < l.length; i++) { if (l[i] === ' ') c++; else if (l[i] === '\t') c += 4 - (c % 4); else break }
  return c
}
/** Remove up to `cols` columns of leading whitespace. */
function mdDedent(l: string, cols: number) {
  let c = 0, i = 0
  while (i < l.length && c < cols) {
    if (l[i] === ' ') { c++; i++ } else if (l[i] === '\t') { const w = 4 - (c % 4); if (c + w > cols) return ' '.repeat(c + w - cols) + l.slice(i + 1); c += w; i++ } else break
  }
  return l.slice(i)
}
function mdIsHr(l: string) {
  let ch = '', n = 0, lead = 0
  for (let i = 0; i < l.length; i++) {
    const c = l[i]
    if (c === ' ' || c === '\t') { if (!ch) lead++; continue }
    if (c !== '-' && c !== '*' && c !== '_') return false
    if (!ch) ch = c; else if (c !== ch) return false
    n++
  }
  return n >= 3 && lead <= 3
}
function mdFence(l: string) {
  const m = /^( {0,3})(`{3,}|~{3,})(.*)$/.exec(l)
  if (!m || (m[2][0] === '`' && m[3].includes('`'))) return null
  return { indent: m[1].length, fence: m[2], info: m[3].trim() }
}
function mdFenceCloses(l: string, fence: string) {
  const m = /^ {0,3}(`+|~+)[ \t]*$/.exec(l)
  return !!m && m[1][0] === fence[0] && m[1].length >= fence.length
}
function mdAtx(l: string): { level: 1 | 2 | 3 | 4 | 5 | 6; text: string } | null {
  const m = /^ {0,3}(#{1,6})(?=[ \t]|$)/.exec(l)
  if (!m) return null
  let t = l.slice(m[0].length).trim(), j = t.length
  while (j > 0 && t[j - 1] === '#') j--
  if (j === 0) t = ''; else if (j < t.length && (t[j - 1] === ' ' || t[j - 1] === '\t')) t = t.slice(0, j).trimEnd()
  return { level: m[1].length as 1, text: t }
}
type MdItemStart = { ordered: boolean; marker: string; start: number; content: string; indent: number }
function mdItem(l: string): MdItemStart | null {
  const m = /^( {0,3})(?:([-+*])|(\d{1,9})([.)]))(?=[ \t]|$)/.exec(l)
  if (!m) return null
  const width = m[0].length, rest = l.slice(width)
  const blank = mdBlank(rest), sp = mdIndent(rest)
  const pad = blank || sp >= 5 ? 1 : sp
  return { ordered: !m[2], marker: m[2] ?? m[4], start: m[3] ? Number(m[3]) : 1, content: blank ? '' : mdDedent(rest, pad), indent: width + pad }
}
const mdSameList = (a: MdItemStart, b: MdItemStart | null) => !!b && a.ordered === b.ordered && a.marker === b.marker
const mdQuote = (l: string) => /^ {0,3}>/.test(l)
/** Does this line start a block that ends a paragraph? */
function mdInterrupts(l: string) {
  if (mdIndent(l) > 3) return false
  if (mdFence(l) || mdAtx(l) || mdIsHr(l) || mdQuote(l)) return true
  const it = mdItem(l)
  return !!it && it.content.trim() !== '' && (!it.ordered || it.start === 1)
}
/** Split a table row on unescaped pipes (outer pipes optional), at most MD_MAX_COLS cells. */
function mdCells(l: string) {
  let s = l.trim()
  if (s.startsWith('|')) s = s.slice(1)
  if (s.endsWith('|') && !s.endsWith('\\|')) s = s.slice(0, -1)
  const out: string[] = []
  let cur = ''
  for (let i = 0; i < s.length; i++) {
    const c = s[i]
    if (c === '\\' && s[i + 1] === '|') { cur += '\\|'; i++ } else if (c === '|') { out.push(cur.trim()); cur = ''; if (out.length >= MD_MAX_COLS) return out } else cur += c
  }
  out.push(cur.trim())
  return out
}
function mdDelimRow(l: string): MdAlign[] | null {
  if (!l.includes('|')) return null
  const out: MdAlign[] = []
  for (const c of mdCells(l)) {
    if (!/^:?-+:?$/.test(c)) return null
    const L = c.startsWith(':'), R = c.endsWith(':')
    out.push(L && R ? 'center' : R ? 'right' : L ? 'left' : null)
  }
  return out
}
function mdTableAt(lines: string[], i: number) {
  if (i + 1 >= lines.length || !lines[i].includes('|') || mdIndent(lines[i]) > 3) return null
  const align = mdDelimRow(lines[i + 1])
  if (!align) return null
  const head = mdCells(lines[i])
  return head.length === align.length ? { head, align } : null
}
const MD_LANGS: Record<string, CodeLanguage> = {
  ts: 'ts', tsx: 'ts', typescript: 'ts', js: 'js', jsx: 'js', javascript: 'js', mjs: 'js', cjs: 'js', py: 'py', python: 'py',
  sh: 'sh', bash: 'sh', shell: 'sh', zsh: 'sh', console: 'sh', 'shell-session': 'sh', json: 'json', jsonc: 'json', json5: 'json',
}
/** A last line that is only the start of some syntax (`-`, `1.`, `--`, a backtick or two) while streaming: wait for more. */
const MD_UNDECIDED = /^ {0,3}(?:[-+*_]{1,2}|\d{1,9}[.)]?|[`~]{1,2})$/

/* ── Block parser ────────────────────────────────────────────────────────── */

type MdRange = [number, number]
/**
 * Parse `lines` into blocks. `atEof`: the last line is the end of the whole (possibly still streaming) source, so
 * the leaf ending there is parsed as a partial tail when `streaming`. `ranges` collects each block's line span.
 */
function mdBlocks(lines: string[], atEof: boolean, streaming: boolean, depth: number, ranges?: MdRange[]): MdBlock[] {
  const n = lines.length
  const out: MdBlock[] = []
  /** The block ending at line `e` is the streaming tail (nothing but at most one empty line after it). */
  const tailAt = (e: number) => streaming && atEof && (e >= n - 1 || (e === n - 2 && lines[n - 1] === ''))
  const push = (b: MdBlock, from: number, to: number) => { out.push(b); ranges?.push([from, to]) }
  if (depth > MD_MAX_DEPTH) {
    const text = mdParaText(lines)
    if (text) push({ type: 'paragraph', children: mdInline(text, { partial: tailAt(n - 1) }) }, 0, n - 1)
    return out
  }
  let i = 0
  while (i < n) {
    const line = lines[i]
    if (mdBlank(line)) { i++; continue }
    const from = i
    if (streaming && atEof && i === n - 1 && MD_UNDECIDED.test(line)) { i++; continue }

    const fence = mdFence(line)
    if (fence) {
      const body: string[] = []
      let closed = false
      for (i++; i < n; i++) {
        if (mdFenceCloses(lines[i], fence.fence)) { closed = true; i++; break }
        body.push(mdDedent(lines[i], fence.indent))
      }
      if (!closed && streaming && atEof) {
        if (from === n - 1) continue // still typing the info string: wait for the newline (no flash of the wrong language)
        const last = body[body.length - 1]
        if (/^ {0,3}(`+|~+)$/.test(last) && last.trim()[0] === fence.fence[0]) body.pop() // half-received closing fence
      }
      push({ type: 'code', lang: fence.info.split(/[ \t{]/)[0].toLowerCase(), text: body.join('\n'), open: !closed || undefined }, from, i - 1)
      continue
    }

    const atx = mdAtx(line)
    if (atx) {
      i++
      const partial = tailAt(from), children = mdInline(atx.text, { partial })
      if (children.length || !partial) push({ type: 'heading', level: atx.level, children }, from, from)
      continue
    }

    if (mdIsHr(line)) { push({ type: 'hr' }, from, from); i++; continue }

    if (mdQuote(line)) {
      const q: string[] = []
      while (i < n) {
        const l = lines[i], m = /^ {0,3}> ?/.exec(l)
        if (m) { q.push(l.slice(m[0].length)); i++; continue }
        if (!mdBlank(l) && q.length && !mdBlank(q[q.length - 1]) && !mdInterrupts(l) && !mdFence(q[0])) { q.push(l); i++; continue } // lazy continuation
        break
      }
      push({ type: 'quote', children: mdBlocks(q, tailAt(i - 1), streaming, depth + 1) }, from, i - 1)
      continue
    }

    const first = mdItem(line)
    if (first) {
      const items: MdListItem[] = []
      let tight = true, lastEnd = i
      while (i < n) {
        const it = mdItem(lines[i])
        if (!it || !mdSameList(first, it) || mdIsHr(lines[i])) break
        const body = [it.content], ci = it.indent
        let j = i + 1
        while (j < n) {
          const l = lines[j]
          if (mdBlank(l)) { body.push(''); j++; continue }
          if (mdIndent(l) >= ci) { body.push(mdDedent(l, ci)); j++; continue }
          if (body[body.length - 1] !== '' && !mdInterrupts(l) && !mdItem(l) && !mdTableAt(lines, j)) { body.push(l); j++; continue } // lazy continuation
          break
        }
        let trailing = 0
        while (body.length > 1 && body[body.length - 1] === '') { body.pop(); trailing++ }
        const end = j - 1 - trailing
        let content = body, checked: boolean | undefined
        const task = /^\[([ xX])\](?:[ \t]|$)/.exec(content[0])
        if (task) { checked = task[1] !== ' '; content = [content[0].slice(task[0].length), ...content.slice(1)] }
        const kids = mdBlocks(content, tailAt(end), streaming, depth + 1)
        if (kids.length > 1 && content.includes('')) tight = false
        items.push({ checked, children: kids })
        lastEnd = end
        i = j
        if (i >= n || !mdSameList(first, mdItem(lines[i])) || mdIsHr(lines[i])) { i = end + 1; break }
        if (trailing) tight = false
      }
      push({ type: 'list', ordered: first.ordered, start: first.ordered ? first.start : undefined, tight, items }, from, lastEnd)
      continue
    }

    const table = mdTableAt(lines, i)
    if (table && streaming && atEof && i + 1 === n - 1) { i = n; continue } // delimiter row still arriving: wait (its alignment and column count aren't final)
    if (table) {
      const rows: MdInline[][][] = []
      for (i += 2; i < n && !mdBlank(lines[i]) && !mdInterrupts(lines[i]); i++) {
        const cells = mdCells(lines[i]), partial = tailAt(i)
        rows.push(table.head.map((_, k) => mdInline(cells[k] ?? '', { partial: partial && k === cells.length - 1 })))
      }
      push({ type: 'table', align: table.align, head: table.head.map(h => mdInline(h)), rows }, from, i - 1)
      continue
    }

    // paragraph
    const para = [line]
    for (i++; i < n; i++) {
      const l = lines[i]
      if (mdBlank(l) || mdInterrupts(l) || mdTableAt(lines, i)) break
      para.push(l)
    }
    const partial = tailAt(i - 1)
    if (partial) {
      // a table header (and maybe a half-typed delimiter row) at the end: hide it until the table is certain, rather
      // than flash raw pipes or a table whose columns and alignment then change
      let k = para.length
      while (k > 0 && para[k - 1].trimStart().startsWith('|')) k--
      const rest = para.slice(k)
      if (rest.length && rest.length <= 2 && (rest.length === 1 || /^[\s|:-]*$/.test(rest[1]))) {
        if (k > 0) push({ type: 'paragraph', children: mdInline(mdParaText(para.slice(0, k))) }, from, from + k - 1)
        continue
      }
    }
    const children = mdInline(mdParaText(para), { partial })
    if (children.length) push({ type: 'paragraph', children }, from, i - 1)
  }
  return out
}
function mdParaText(lines: string[]) { return lines.map(l => l.replace(/^[ \t]+/, '')).join('\n').trim() }

/** Parse the top level of `src` from offset `base` (a line start), recording source offsets. */
function mdParseTop(src: string, streaming: boolean, base: number): MdBlock[] {
  const lines = (base ? src.slice(base) : src).split('\n')
  const starts: number[] = new Array(lines.length)
  for (let i = 0, o = base; i < lines.length; i++) { starts[i] = o; o += lines[i].length + 1 }
  const ranges: MdRange[] = []
  const blocks = mdBlocks(lines, true, streaming, 0, ranges)
  blocks.forEach((b, k) => { const [a, z] = ranges[k]; b.range = [starts[a], starts[z] + lines[z].length] })
  return blocks
}
function mdNormalize(src: string) {
  return (src.length > MARKDOWN_MAX_CHARS ? src.slice(0, MARKDOWN_MAX_CHARS) : src).replace(/\r\n?/g, '\n').replace(/\0/g, '�')
}

/**
 * Parse Markdown (GFM subset) into blocks; pure and linear in the input. With `streaming`, syntax cut off at the end
 * of the text is parsed as what it is most likely becoming (see `Markdown`). Input over MARKDOWN_MAX_CHARS is cut.
 */
export function parseMarkdown(src: string, { streaming = false }: { streaming?: boolean } = {}): MdBlock[] {
  return mdParseTop(mdNormalize(src), streaming, 0)
}

/* ── Inline parser ───────────────────────────────────────────────────────── */

type MdEmph = 'em' | 'strong' | 'del'
/** `opens` is innermost first (each new match wraps the earlier ones); `closes` too. */
type MdDelim = { ch: string; len: number; orig: number; canOpen: boolean; canClose: boolean; strictOpen: boolean; opens: MdEmph[] | null; closes: MdEmph[] | null; prev: number; next: number; dead: boolean }
type MdTok = MdInline | MdDelim
const mdIsDelim = (t: MdTok): t is MdDelim => 'ch' in t
/** Letters and digits (the common case) answer without a regex. */
const mdAlnum = (c: string) => { const k = c.charCodeAt(0); return (k >= 48 && k <= 57) || (k >= 65 && k <= 90) || (k >= 97 && k <= 122) }
const mdWs = (c: string | undefined) => !c || (c === ' ' || c === '\n' || (!mdAlnum(c) && /\s/.test(c)))
const mdPunct = (c: string | undefined) => !!c && !mdAlnum(c) && c !== ' ' && /[!-/:-@[-`{-~\p{P}\p{S}]/u.test(c)
const mdAsciiPunct = (c: string | undefined) => !!c && /[!-/:-@[-`{-~]/.test(c)
const mdUnescape = (s: string) => s.replace(/\\([!-/:-@[-`{-~])/g, '$1')
/** Characters that end a plain-text run. */
const MD_SPECIAL = new Set(['\\', '*', '_', '~', '`', '[', ']', '!', '<', '\n', 'h', 'w'])

/** Bare autolink (`https://…`, `http://…`, `www.…`) starting at `i`: [href, end] or null. */
function mdBareLink(t: string, i: number): [string, number] | null {
  const www = t.startsWith('www.', i)
  if (!www && !t.startsWith('https://', i) && !t.startsWith('http://', i)) return null
  let j = i
  while (j < t.length && !/[\s<]/.test(t[j])) j++
  let url = t.slice(i, j), open = 0, close = 0
  for (let k = 0; k < url.length; k++) { if (url[k] === '(') open++; else if (url[k] === ')') close++ }
  for (;;) { // trailing punctuation is not part of the link; a closing paren only when unbalanced
    const c = url[url.length - 1]
    if (c && '?!.,:*_~\'";'.includes(c)) url = url.slice(0, -1)
    else if (c === ')' && close > open) { url = url.slice(0, -1); close-- }
    else break
  }
  const body = url.slice(www ? 4 : url.indexOf('//') + 2)
  if (!body || body.startsWith('.')) return null
  return [www ? `https://${url}` : url, i + url.length]
}
/** `<scheme:…>` or `<a@b.c>` at `i`: [href, text, end] or null. */
function mdAngleLink(t: string, i: number): [string, string, number] | null {
  const lim = Math.min(t.length, i + MD_LINK_MAX)
  let j = i + 1
  while (j < lim && !' \t\n<>'.includes(t[j])) j++
  if (t[j] !== '>' || j === i + 1) return null
  const body = t.slice(i + 1, j)
  if (/^[a-z][a-z0-9+.-]{1,31}:/i.test(body)) return [body, body, j + 1]
  const at = body.indexOf('@')
  if (at > 0 && at === body.lastIndexOf('@')) {
    const dom = body.slice(at + 1)
    if (dom.includes('.') && !dom.startsWith('.') && !dom.endsWith('.')) return [`mailto:${body}`, body, j + 1]
  }
  return null
}
/** Destination and optional title inside `(…)`, between s and e (exclusive). */
function mdDest(t: string, s: number, e: number): { href: string; title?: string } | null {
  while (s < e && mdWs(t[s])) s++
  let href: string, j: number
  if (t[s] === '<') {
    const g = t.indexOf('>', s)
    if (g < 0 || g >= e) return null
    href = t.slice(s + 1, g); j = g + 1
  } else {
    j = s
    while (j < e && !mdWs(t[j])) j++
    href = t.slice(s, j)
  }
  const rest = t.slice(j, e).trim()
  if (!rest) return { href: mdUnescape(href) }
  const q = rest[0], z = rest[rest.length - 1]
  if (rest.length >= 2 && ((q === '"' && z === '"') || (q === "'" && z === "'") || (q === '(' && z === ')'))) return { href: mdUnescape(href), title: mdUnescape(rest.slice(1, -1)) }
  return null
}

/**
 * Parse inline Markdown. Linear: code spans are paired with one pointer per backtick-run length, brackets and parens
 * with one stack pass each, emphasis with the CommonMark delimiter algorithm (an openers bottom per kind).
 * `partial`: the text is cut off at the end (streaming), so unclosed code, links and emphasis close optimistically.
 */
function mdInline(src: string, { partial = false, links = true }: { partial?: boolean; links?: boolean } = {}): MdInline[] {
  let end = src.length
  if (partial) { // a half-received marker at the very end: hide it until it means something
    while (end > 0 && '*_~`'.includes(src[end - 1])) end--
    if (end === src.length && src[end - 1] === '\\') end--
  }
  const t = end < src.length ? src.slice(0, end) : src
  const len = t.length
  if (!len) return []

  // 1. code spans: start → [contentStart, contentEnd, end]
  const spans = new Map<number, [number, number, number]>()
  if (t.includes('`')) {
    const runs: { pos: number; len: number; esc: boolean }[] = []
    for (let i = 0; i < len; i++) {
      if (t[i] !== '`') continue
      let j = i
      while (j < len && t[j] === '`') j++
      let b = 0
      for (let k = i - 1; k >= 0 && t[k] === '\\'; k--) b++
      runs.push({ pos: i, len: j - i, esc: b % 2 === 1 }); i = j - 1
    }
    const byLen = new Map<number, number[]>(), ptr = new Map<number, number>()
    runs.forEach((r, k) => { const a = byLen.get(r.len); if (a) a.push(k); else byLen.set(r.len, [k]) })
    let skip = 0
    for (const r of runs) {
      if (r.pos < skip) continue
      const p = r.esc ? r.pos + 1 : r.pos, L = r.esc ? r.len - 1 : r.len
      if (!L) continue
      const bucket = byLen.get(L)
      let k = ptr.get(L) ?? 0
      while (bucket && k < bucket.length && runs[bucket[k]].pos <= p) k++
      ptr.set(L, k)
      if (bucket && k < bucket.length) { const c = runs[bucket[k]]; spans.set(p, [p + L, c.pos, c.pos + L]); skip = c.pos + L; ptr.set(L, k + 1) }
      else if (partial) { spans.set(p, [p + L, len, len]); skip = len }
    }
  }

  // 2. bracket and paren pairs (outside code spans, not escaped)
  let brackets: Int32Array | null = null, parens: Int32Array | null = null
  if (links && t.includes('[')) {
    brackets = new Int32Array(len).fill(-1); parens = new Int32Array(len).fill(-1)
    const bs: number[] = [], ps: number[] = []
    for (let i = 0; i < len; i++) {
      const sp = spans.get(i)
      if (sp) { i = sp[2] - 1; continue }
      const c = t[i]
      if (c === '\\') i++
      else if (c === '[') bs.push(i)
      else if (c === ']') { const o = bs.pop(); if (o !== undefined) brackets[o] = i }
      else if (c === '(') ps.push(i)
      else if (c === ')') { const o = ps.pop(); if (o !== undefined) parens[o] = i }
    }
  }

  // 3. tokens
  const toks: MdTok[] = [], delims: MdDelim[] = []
  let buf = ''
  const flush = () => { if (buf) { toks.push({ type: 'text', text: buf }); buf = '' } }
  const node = (n: MdInline) => { flush(); toks.push(n) }
  let i = 0
  while (i < len) {
    const sp = spans.get(i)
    if (sp) {
      let code = t.slice(sp[0], sp[1]).replace(/\n/g, ' ')
      if (code.length > 1 && code[0] === ' ' && code[code.length - 1] === ' ' && code.trim()) code = code.slice(1, -1)
      node({ type: 'code', text: code }); i = sp[2]; continue
    }
    const c = t[i]
    if (c === '\\') {
      const nx = t[i + 1]
      if (nx === '\n') { node({ type: 'break' }); i += 2 } else if (mdAsciiPunct(nx)) { buf += nx; i += 2 } else { buf += c; i++ }
      continue
    }
    if (c === '*' || c === '_' || c === '~') {
      let j = i
      while (j < len && t[j] === c) j++
      if (c === '~' && j - i > 2) { buf += t.slice(i, j); i = j; continue }
      const before = t[i - 1], after = t[j]
      const left = !mdWs(after) && (!mdPunct(after) || mdWs(before) || mdPunct(before))
      const right = !mdWs(before) && (!mdPunct(before) || mdWs(after) || mdPunct(after))
      flush()
      const d: MdDelim = {
        ch: c, len: j - i, orig: j - i, opens: null, closes: null, prev: delims.length - 1, next: -1, dead: false, strictOpen: left && !right,
        canOpen: c === '_' ? left && (!right || mdPunct(before)) : left, canClose: c === '_' ? right && (!left || mdPunct(after)) : right,
      }
      if (delims.length) delims[delims.length - 1].next = delims.length
      delims.push(d); toks.push(d)
      i = j; continue
    }
    if (c === '`') { let j = i; while (j < len && t[j] === '`') j++; buf += t.slice(i, j); i = j; continue } // unmatched run
    if ((c === '[' || (c === '!' && t[i + 1] === '[')) && brackets && parens) {
      const img = c === '!', o = img ? i + 1 : i, close = brackets[o]
      if (close < 0) {
        if (partial) { if (img) buf += '!'; i = o + 1; continue } // `[` still waiting for its `]`: hide it
        buf += t.slice(i, o + 1); i = o + 1; continue
      }
      const inner = t.slice(o + 1, close)
      if (!img && /^\d{1,3}$/.test(inner) && t[close + 1] !== '(') { node({ type: 'citation', n: Number(inner) }); i = close + 1; continue }
      const label = () => mdInline(inner, { links: false })
      if (t[close + 1] === '(') {
        const pc = parens[close + 1]
        if (pc < 0) {
          if (partial) { node(img ? { type: 'image', src: '', alt: mdUnescape(inner) } : { type: 'link', href: '', children: label(), pending: true }); i = len; continue }
        } else if (pc - close <= MD_LINK_MAX) {
          const d = mdDest(t, close + 2, pc)
          if (d) {
            node(img ? { type: 'image', src: d.href, alt: mdUnescape(inner), title: d.title } : { type: 'link', href: d.href, title: d.title, children: label() })
            i = pc + 1; continue
          }
        }
      } else if (partial && close === len - 1 && !img) { node({ type: 'link', href: '', children: label(), pending: true }); i = len; continue }
      buf += t.slice(i, o + 1); i = o + 1; continue
    }
    if (c === '<' && links) {
      const a = mdAngleLink(t, i)
      if (a) node({ type: 'link', href: a[0], children: [{ type: 'text', text: a[1] }] }); else buf += c
      i = a ? a[2] : i + 1; continue
    }
    if ((c === 'h' || c === 'w') && links && (i === 0 || /[\s*_~(]/.test(t[i - 1]))) {
      const a = mdBareLink(t, i)
      if (a) { node({ type: 'link', href: a[0], children: [{ type: 'text', text: t.slice(i, a[1]) }] }); i = a[1]; continue }
    }
    if (c === '\n') {
      let k = buf.length
      while (k > 0 && buf[k - 1] === ' ') k--
      const hard = buf.length - k >= 2
      buf = buf.slice(0, k)
      if (hard) node({ type: 'break' }); else buf += '\n'
      i++; continue
    }
    let j = i + 1 // plain run
    while (j < len && !MD_SPECIAL.has(t[j])) j++
    buf += t.slice(i, j); i = j
  }
  flush()

  // 4. emphasis (CommonMark process_emphasis; ~ pairs only with a run of the same length)
  const unlink = (k: number) => { const d = delims[k]; d.dead = true; if (d.prev >= 0) delims[d.prev].next = d.next; if (d.next >= 0) delims[d.next].prev = d.prev }
  if (delims.length) {
    const bottoms = new Int32Array(18).fill(-1) // per (char, can open, length mod 3)
    let c = 0
    while (c >= 0) {
      const C = delims[c]
      if (!C.canClose || C.len === 0) { c = C.next; continue }
      const key = (C.ch === '*' ? 0 : C.ch === '_' ? 6 : 12) + (C.canOpen ? 3 : 0) + (C.orig % 3)
      const bottom = bottoms[key]
      let o = C.prev, found = false
      while (o >= 0 && o !== bottom) {
        const O = delims[o]
        if (O.ch === C.ch && O.canOpen && O.len > 0) {
          if (C.ch === '~') { if (O.len === C.len) { found = true; break } }
          else if (!((O.canClose || C.canOpen) && (O.orig + C.orig) % 3 === 0 && !(O.orig % 3 === 0 && C.orig % 3 === 0))) { found = true; break }
        }
        o = O.prev
      }
      if (found) {
        const O = delims[o]
        if (C.ch === '~') { (O.opens ??= []).push('del'); (C.closes ??= []).push('del'); O.len = 0; C.len = 0 }
        else { const k = O.len >= 2 && C.len >= 2 ? 2 : 1, ty: MdEmph = k === 2 ? 'strong' : 'em'; (O.opens ??= []).push(ty); (C.closes ??= []).push(ty); O.len -= k; C.len -= k }
        for (let k = O.next; k !== c && k >= 0; k = delims[k].next) delims[k].dead = true // delimiters in between are text now
        O.next = c; C.prev = o
        if (O.len === 0) unlink(o)
        if (C.len === 0) { const nx = C.next; unlink(c); c = nx }
      } else {
        bottoms[key] = C.prev
        const nx = C.next
        if (!C.canOpen) unlink(c)
        c = nx
      }
    }
  }
  const endCloses: MdEmph[] = []
  if (partial) { // close what is still open, innermost first
    for (let k = delims.length - 1; k >= 0; k--) {
      const O = delims[k]
      if (O.dead || !O.strictOpen || O.len === 0) continue
      if (O.ch === '~') { (O.opens ??= []).push('del'); endCloses.push('del'); O.len = 0; continue }
      while (O.len > 0) { const m = O.len >= 2 ? 2 : 1, ty: MdEmph = m === 2 ? 'strong' : 'em'; (O.opens ??= []).push(ty); endCloses.push(ty); O.len -= m }
    }
  }

  // 5. tree (frames past the depth cap share their parent's children, so depth stays bounded)
  type Frame = { type: MdEmph | 'root' | 'skip'; children: MdInline[] }
  const root: Frame = { type: 'root', children: [] }
  const stack: Frame[] = [root]
  let real = 0
  const add = (nd: MdInline) => {
    const kids = stack[stack.length - 1].children, prev = kids[kids.length - 1]
    if (nd.type === 'text' && prev?.type === 'text') kids[kids.length - 1] = { type: 'text', text: prev.text + nd.text }
    else kids.push(nd)
  }
  const pop = () => {
    if (stack.length < 2) return
    const f = stack.pop()!
    if (f.type === 'skip') return
    real--
    if (f.children.length) add({ type: f.type as MdEmph, children: f.children })
  }
  const open = (ty: MdEmph) => {
    if (real >= MD_MAX_INLINE_DEPTH) stack.push({ type: 'skip', children: stack[stack.length - 1].children })
    else { real++; stack.push({ type: ty, children: [] }) }
  }
  for (const tk of toks) {
    if (!mdIsDelim(tk)) { add(tk); continue }
    if (tk.closes) tk.closes.forEach(pop)
    if (tk.len) add({ type: 'text', text: tk.ch.repeat(tk.len) })
    if (tk.opens) for (let k = tk.opens.length - 1; k >= 0; k--) open(tk.opens[k]) // outermost first
  }
  endCloses.forEach(pop)
  while (stack.length > 1) pop()
  return root.children
}

/* ── Rendering ───────────────────────────────────────────────────────────── */

type MdOptions = { onLinkClick?: (href: string, e: React.MouseEvent) => void; renderCitation?: (n: number) => ReactNode; images: 'link' | 'allow'; streaming?: boolean }
/** Callbacks reach links and citations through context, so memoised blocks don't re-render when they change identity. */
const MdContext = createContext<MdOptions>({ images: 'link' })

const MD_LINK = 'text-[color-mix(in_srgb,var(--accent)_78%,var(--fg))] underline decoration-[color-mix(in_srgb,var(--accent)_45%,transparent)] underline-offset-2 transition-colors hover:decoration-current'
const mdAbsolute = (href: string) => /^https?:/i.test(href) || href.startsWith('//')

function MdLinkView({ href, title, pending, children }: { href: string; title?: string; pending?: boolean; children: ReactNode }) {
  const { onLinkClick } = useContext(MdContext)
  if (pending) return <span className={MD_LINK}>{children}</span>
  const safe = safeUrl(href, { allow: MD_SAFE_SCHEMES, fallback: '' })
  if (!safe) return <span title="Link removed: unsupported address" className="underline decoration-dotted underline-offset-2">{children}</span>
  return (
    <a href={safe} title={title} target={mdAbsolute(safe) ? '_blank' : undefined} rel="noopener noreferrer nofollow" className={MD_LINK}
      onClick={onLinkClick ? e => onLinkClick(safe, e) : undefined}>{children}</a>
  )
}

const MD_IMAGE_CHIP = 'inline-flex max-w-full items-center gap-1 rounded-[var(--r-sm)] border border-[var(--line)] bg-[var(--muted)] px-1.5 align-baseline text-[13px] leading-[1.6] text-[var(--fg2)] no-underline'
function MdImageView({ src, alt, title }: { src: string; alt: string; title?: string }) {
  const { images, onLinkClick } = useContext(MdContext)
  if (images === 'allow') {
    const u = safeMediaUrl(src)
    if (u) return <img src={u} alt={alt} title={title} loading="lazy" decoding="async" referrerPolicy="no-referrer" className="inline-block h-auto max-w-full rounded-[var(--r-md)] align-middle" />
  }
  const href = safeUrl(src, { allow: ['https:', 'http:'], fallback: '' })
  const body = <><Icon name="image" size={13} className="flex-none text-[var(--fg3)]" /><span className="truncate">{alt || 'Image'}</span></>
  if (!href) return <span className={MD_IMAGE_CHIP} title="Image not shown">{body}</span>
  return (
    <a href={href} target={mdAbsolute(href) ? '_blank' : undefined} rel="noopener noreferrer nofollow" title={`Open image${title ? `: ${title}` : ''} (not loaded automatically)`}
      className={cn(MD_IMAGE_CHIP, 'transition-colors hover:border-[var(--line2)] hover:text-[var(--fg)]')} onClick={onLinkClick ? e => onLinkClick(href, e) : undefined}>
      {body}<span className="sr-only"> (image, opens in a new tab)</span>
    </a>
  )
}

function MdCitationView({ n }: { n: number }) {
  const { renderCitation } = useContext(MdContext)
  if (renderCitation) return <>{renderCitation(n)}</>
  return <sup className="ui-num text-[11px] text-[var(--fg3)]">[{n}]</sup>
}

function mdRenderInline(nodes: MdInline[]): ReactNode[] {
  return nodes.map((n, k) => {
    switch (n.type) {
      case 'text': return <Fragment key={k}>{n.text}</Fragment>
      case 'code': return <InlineCode key={k} className="[overflow-wrap:anywhere]">{n.text}</InlineCode>
      case 'strong': return <strong key={k} className="font-semibold">{mdRenderInline(n.children)}</strong>
      case 'em': return <em key={k}>{mdRenderInline(n.children)}</em>
      case 'del': return <del key={k} className="text-[var(--fg2)]">{mdRenderInline(n.children)}</del>
      case 'link': return <MdLinkView key={k} href={n.href} title={n.title} pending={n.pending}>{mdRenderInline(n.children)}</MdLinkView>
      case 'image': return <MdImageView key={k} src={n.src} alt={n.alt} title={n.title} />
      case 'break': return <br key={k} />
      case 'citation': return <MdCitationView key={k} n={n.n} />
    }
  })
}

const MD_HEADING = {
  1: 'text-[22px] leading-[1.3] font-semibold tracking-[-0.01em]',
  2: 'text-base leading-[1.4] font-semibold',
  3: 'text-sm font-semibold',
  4: 'text-sm font-semibold text-[var(--fg2)]',
  5: 'text-[13px] font-semibold text-[var(--fg2)]',
  6: 'text-[13px] font-medium text-[var(--fg3)]',
} as const
const MD_ALIGN = { left: 'text-left', center: 'text-center', right: 'text-right' } as const
/** Vertical rhythm for a stack of blocks: 12px between blocks, more above headings. */
const MD_FLOW = '[&>*+*]:mt-3 [&>*+h1]:mt-6 [&>*+h2]:mt-5 [&>*+h3]:mt-4 [&>*+h4]:mt-4'

/** While streaming, the last block gets a caret keyed by the text length (0/undefined: no caret). */
type MdCaretKey = number | undefined
/**
 * Blinking caret that takes no room: a zero-width inline anchor with the glyph absolutely positioned on it, so it
 * never wraps a line or grows a line box. It is remounted (keyed by the text length) on every update, so browsers see a
 * new element instead of one that moved: no layout-shift entries per token, and it stays solid while text arrives.
 */
function MdCaret() {
  return <span aria-hidden data-md-caret className="pointer-events-none relative inline-block h-[1em] w-0 align-baseline"><span className="ui-caret absolute bottom-[-0.15em] left-0 leading-none whitespace-nowrap" /></span>
}

const mdPlainText = (ns: MdInline[]): string => ns.map(n => n.type === 'text' || n.type === 'code' ? n.text : n.type === 'image' ? n.alt : n.type === 'citation' ? `[${n.n}]` : n.type === 'break' ? ' ' : mdPlainText(n.children)).join('')
/** Column minimum widths in em (at the table's 13px), from the header text: ~0.62em per character plus cell padding. */
const mdColumnEms = (head: MdInline[][]) => head.map(h => Math.max(6, Math.min(30, mdPlainText(h).length) * 0.62 + 2))

/**
 * Table in a scrolling card. A table that first renders while streaming uses a fixed layout with column widths from
 * its header row, so columns don't resize as rows arrive; it keeps that layout when the stream ends (switching back
 * to automatic widths then would be a jump). Tables rendered complete use automatic widths.
 */
function MdTableView({ block, caret }: { block: Extract<MdBlock, { type: 'table' }>; caret?: MdCaretKey }) {
  const [edgesRef, edges] = useScrollEdges<HTMLDivElement>()
  const scrolls = edges.left || edges.right
  const { streaming } = useContext(MdContext)
  const [fixed] = useState(!!streaming) // decided once, at mount
  const head = block.head
  // header-derived widths (a streaming table only appears once its header and delimiter rows are complete)
  const ems = useMemo(() => mdColumnEms(head), [head])
  const total = ems.reduce((a, b) => a + b, 0)
  const lastRow = block.rows.length - 1
  return (
    <div className="relative overflow-hidden rounded-[var(--r-lg)] border border-[var(--line)] bg-[var(--card)]">
      <div ref={edgesRef} tabIndex={scrolls ? 0 : undefined} role={scrolls ? 'region' : undefined} aria-label={scrolls ? 'Table, scrolls sideways' : undefined}
        className="overflow-x-auto overscroll-x-contain focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[var(--accent)]">
        <table className={cn('w-full border-collapse text-[13px] leading-[1.5] [overflow-wrap:normal]', fixed && 'table-fixed')} style={fixed ? { minWidth: `${total.toFixed(2)}em` } : undefined}>
          {fixed && <colgroup>{ems.map((w, k) => <col key={k} style={{ width: `${((w / total) * 100).toFixed(3)}%` }} />)}</colgroup>}
          <thead className="bg-[color-mix(in_srgb,var(--muted)_60%,var(--card))]">
            <tr>
              {block.head.map((h, k) => (
                <th key={k} scope="col" className={cn('border-b border-[var(--line)] px-3 py-2 font-semibold text-[var(--fg)]', fixed ? 'break-words' : 'whitespace-nowrap', MD_ALIGN[block.align[k] ?? 'left'])}>{mdRenderInline(h)}{caret && lastRow < 0 && k === head.length - 1 ? <MdCaret key={caret} /> : null}</th>
              ))}
            </tr>
          </thead>
          {block.rows.length > 0 && (
            <tbody>
              {block.rows.map((r, y) => (
                <tr key={y} className="border-b border-[var(--line)] last:border-b-0">
                  {r.map((c, k) => <td key={k} className={cn('px-3 py-2 align-top break-words text-[var(--fg2)]', MD_ALIGN[block.align[k] ?? 'left'])}>{mdRenderInline(c)}{caret && y === lastRow && k === r.length - 1 ? <MdCaret key={caret} /> : null}</td>)}
                </tr>
              ))}
            </tbody>
          )}
        </table>
      </div>
      <ScrollEdges {...edges} />
    </div>
  )
}

/** A fence in a language CodeBlock doesn't highlight: the same frame, plain text. */
function MdPlainCode({ text, lang }: { text: string; lang: string }) {
  const [edgesRef, edges] = useScrollEdges<HTMLPreElement>()
  const phone = useMediaQuery('(max-width: 639px)')
  const scrolls = edges.left || edges.right
  const label = lang || 'text'
  return (
    <div className="overflow-hidden rounded-[var(--r-lg)] border border-[var(--line)] bg-[color-mix(in_srgb,var(--muted)_45%,var(--card))]">
      <div className="flex min-h-10 items-center gap-2 border-b border-[var(--line)] bg-[var(--card)] py-1 pr-1.5 pl-3 text-xs [@media(pointer:coarse)]:min-h-11">
        <span className="flex min-w-0 items-center gap-1.5 font-medium text-[var(--fg)]"><Icon name="file" size={13} className="text-[var(--fg3)]" /><span className="truncate">snippet</span></span>
        <span className="flex-none rounded-[var(--r-sm)] bg-[var(--muted)] px-1.5 py-0.5 font-[family-name:var(--mono)] text-[11px] font-medium text-[var(--fg3)] max-[420px]:hidden">{label}</span>
        <span className="flex-1" />
        <CopyButton text={() => text} size={phone ? 'icon-sm' : 'sm'} iconOnly={phone} variant="ghost"
          className={phone ? 'text-[var(--fg2)] hover:text-[var(--fg)]' : '!h-7 !gap-1 !px-2 font-medium text-[var(--fg2)] hover:text-[var(--fg)] [@media(pointer:coarse)]:!h-9'} />
      </div>
      <pre ref={edgesRef} tabIndex={scrolls ? 0 : undefined} role={scrolls ? 'region' : undefined} aria-label={scrolls ? `${label} code, scrolls` : undefined}
        className="m-0 overflow-x-auto px-3 py-2.5 font-[family-name:var(--mono)] text-xs leading-[1.65] whitespace-pre text-[var(--fg)] [overflow-wrap:normal] focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[var(--accent)]">{text || ' '}</pre>
    </div>
  )
}

function MdBlocksView({ blocks, caret }: { blocks: MdBlock[]; caret?: MdCaretKey }) {
  return <>{blocks.map((b, k) => <MdBlockNode key={k} block={b} caret={k === blocks.length - 1 ? caret : undefined} />)}</>
}

function MdBlockNode({ block: b, caret }: { block: MdBlock; caret?: MdCaretKey }): ReactNode {
  switch (b.type) {
    case 'heading': {
      const H = `h${b.level}` as 'h1'
      return <H className={cn('m-0 text-[var(--fg)]', MD_HEADING[b.level])}>{mdRenderInline(b.children)}{caret ? <MdCaret key={caret} /> : null}</H>
    }
    case 'paragraph': return <p className="m-0">{mdRenderInline(b.children)}{caret ? <MdCaret key={caret} /> : null}</p>
    case 'code': {
      const lang = MD_LANGS[b.lang]
      return lang ? <CodeBlock code={b.text} language={lang} collapseAt={false} className="[overflow-wrap:normal]" /> : <MdPlainCode text={b.text} lang={b.lang} />
    }
    case 'quote': return <blockquote className="m-0 border-l-2 border-[var(--line2)] pl-3.5 text-[var(--fg2)] [&>*+*]:mt-2"><MdBlocksView blocks={b.children} caret={caret} /></blockquote>
    case 'list': {
      const L = b.ordered ? 'ol' : 'ul'
      return (
        <L start={b.ordered && b.start !== 1 ? b.start : undefined}
          className={cn('m-0 pl-6 marker:text-[var(--fg3)]', b.ordered ? 'list-decimal' : 'list-disc', b.tight ? '[&>li+li]:mt-1' : '[&>li+li]:mt-2.5')}>
          {b.items.map((it, k) => {
            const last = k === b.items.length - 1 ? caret : undefined, task = it.checked !== undefined
            return (
              <li key={k} className={cn('pl-0.5', b.tight ? '[&>*+*]:mt-1' : '[&>*+*]:mt-2', task && 'relative list-none')}>
                {task && (
                  <span aria-hidden className={cn('absolute top-[0.3em] -left-5 flex size-[15px] items-center justify-center rounded-[var(--r-sm)] border',
                    it.checked ? 'border-[var(--primary)] bg-[var(--primary)] text-[var(--on-primary)]' : 'border-[var(--line2)] bg-[var(--card)]')}>
                    {it.checked && <Icon name="check" size={11} strokeWidth={3} />}
                  </span>
                )}
                {task && <span className="sr-only">{it.checked ? 'Done: ' : 'To do: '}</span>}
                {it.children.length === 0 && last ? <MdCaret key={last} /> : <MdBlocksView blocks={it.children} caret={last} />}
              </li>
            )
          })}
        </L>
      )
    }
    case 'table': return <MdTableView block={b} caret={caret} />
    case 'hr': return <hr className="my-1 border-0 border-t border-[var(--line)]" />
  }
}

/** A top-level block: re-renders only when its parse changes (the same object while streaming appends after it). */
const MdTopBlock = memo(MdBlockNode, (a, b) => a.block === b.block && a.caret === b.caret)

/** Parse with reuse: while the text only grows, every block but the last two is kept as the same object. */
function useMdBlocks(src: string, streaming: boolean) {
  // a mutable box held in state: the parse is a pure function of (previous parse, src), so re-running it is harmless
  const [cache] = useState<{ last: { src: string; streaming: boolean; blocks: MdBlock[] } | null }>(() => ({ last: null }))
  return useMemo(() => {
    const prev = cache.last
    let blocks: MdBlock[]
    if (prev && streaming && prev.streaming && prev.blocks.length > 2 && src.length >= prev.src.length && src.startsWith(prev.src)) {
      const keep = prev.blocks.length - 2
      blocks = prev.blocks.slice(0, keep).concat(mdParseTop(src, true, prev.blocks[keep].range?.[0] ?? 0))
    } else blocks = mdParseTop(src, streaming, 0)
    cache.last = { src, streaming, blocks }
    return blocks
  }, [cache, src, streaming])
}

export type MarkdownProps = {
  children: string
  /** The text is still arriving: half-received syntax at the end renders as what it is becoming, and a caret shows. */
  streaming?: boolean
  className?: string
  /** Called on link (and image link) clicks with the checked href; call `e.preventDefault()` to handle navigation yourself. */
  onLinkClick?: (href: string, e: React.MouseEvent) => void
  /** Renders citation markers like `[1]` (default: a small superscript `[1]`). */
  renderCitation?: (n: number) => ReactNode
  /** 'link' (default): images render as a link chip and are never fetched. 'allow': `<img>` for http(s), blob: and data:image sources. */
  images?: 'link' | 'allow'
  /** Show a blinking caret after the last block while streaming (default true). */
  caret?: boolean
}

/**
 * Markdown for model output (GFM subset: headings, emphasis, strikethrough, code, fences → CodeBlock, quotes, nested
 * and task lists, tables, rules, links, autolinks, hard breaks, `[n]` citations). Builds React nodes only; raw HTML
 * shows as text; links are limited to https, http, mailto and relative URLs, and absolute ones open in a new tab with
 * `rel="noopener noreferrer nofollow"`; images are links unless `images="allow"`. With `streaming`, completed blocks
 * don't re-render as text arrives, and unfinished syntax at the end never flashes as raw characters.
 */
export function Markdown({ children, streaming = false, className, onLinkClick, renderCitation, images = 'link', caret = true }: MarkdownProps) {
  const raw = typeof children === 'string' ? children : String(children ?? '')
  const src = useMemo(() => mdNormalize(raw), [raw])
  const blocks = useMdBlocks(src, streaming)
  const opts = useMemo(() => ({ onLinkClick, renderCitation, images, streaming }), [onLinkClick, renderCitation, images, streaming])
  const { ref, visible } = useViewport<HTMLDivElement>(null, { amount: 0 })
  const showCaret = streaming && caret
  return (
    <MdContext.Provider value={opts}>
      <div ref={ref} className={cn('min-w-0 text-sm leading-[1.65] text-[var(--fg)] [overflow-wrap:anywhere]', MD_FLOW, className)}
        style={showCaret ? { '--ui-play': visible ? 'running' : 'paused' } as CSSProperties : undefined}>
        {blocks.map((b, k) => <MdTopBlock key={k} block={b} caret={showCaret && k === blocks.length - 1 ? src.length + 1 : undefined} />)}
        {showCaret && blocks.length === 0 && <p className="m-0"><MdCaret /></p>}
        {raw.length > MARKDOWN_MAX_CHARS && <p className="m-0 text-[11px] text-[var(--fg3)]">Cut off after {MARKDOWN_MAX_CHARS.toLocaleString('en')} characters.</p>}
      </div>
    </MdContext.Provider>
  )
}
