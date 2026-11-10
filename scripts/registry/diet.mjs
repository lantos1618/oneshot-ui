// Comment diet for drop-in files (scripts/build-registry.mjs). An item's own exports keep their full docs; the library
// helpers a file embeds keep only the first sentence of their JSDoc and lose their other comments (prop docs, `//`
// notes, `{/* … */}` in JSX). About a fifth of every drop-in was comments on helpers the reader never calls directly.
// Directives stay: @ts-…, eslint, `/*!` licences and #__PURE__ / #__NO_SIDE_EFFECTS__ annotations.
import { parseSync } from 'vite'

const KEEP = /@ts-|eslint|^\/\*!|[@#]__(PURE|NO_SIDE_EFFECTS)__/
const ABBR = /\b(e\.g|i\.e|vs|cf|etc)\.$/

/** The first sentence of a JSDoc block, as a one-line JSDoc (a `@deprecated` tag survives). */
function summary(block) {
  const lines = block.replace(/^\/\*\*|\*\/$/g, '').split('\n').map(l => l.replace(/^\s*\* ?/, ''))
  const tagAt = lines.findIndex(l => /^\s*@\w/.test(l))
  const prose = (tagAt < 0 ? lines : lines.slice(0, tagAt)).join(' ').replace(/\s+/g, ' ').trim()
  let cut = prose.length
  // the first sentence; an example after a colon (`Join class names: cn('a', b && 'b')`) is left out too
  for (const m of prose.matchAll(/[.!?](?=\s|$)|:(?=\s+`)/g)) if (!ABBR.test(prose.slice(0, m.index + 1))) { cut = m.index + 1; break }
  let s = prose.slice(0, cut).replace(/:$/, '.')
  if (s.length > 160) s = s.slice(0, s.lastIndexOf(' ', 157)) + ' …'
  const deprecated = /@deprecated\b[^\n]*/.exec(block.replace(/^\s*\* ?/gm, ''))?.[0].trim()
  const text = [s, deprecated].filter(Boolean).join(' ')
  return text ? `/** ${text.replaceAll('*/', '*\\/')} */` : ''
}

/** `text` (one top-level statement with its leading comments) with its comments reduced as described above. */
export function dietPart(text) {
  let r
  try { r = parseSync('part.tsx', text, { lang: 'tsx' }) } catch { return text }
  if (r.errors?.length || !r.program.body.length) return text
  const first = r.program.body[0].start
  const empties = [] // JSX expression containers that hold only a comment
  const walk = n => {
    if (!n || typeof n !== 'object') return
    if (Array.isArray(n)) { n.forEach(walk); return }
    if (n.type === 'JSXExpressionContainer' && n.expression?.type === 'JSXEmptyExpression') empties.push([n.start, n.end])
    for (const k in n) if (k !== 'parent' && n[k] && typeof n[k] === 'object') walk(n[k])
  }
  if (r.comments.some(c => c.type === 'Block' && c.start > first)) walk(r.program)
  const edits = [] // [start, end, replacement], ascending and disjoint
  // the statement's own JSDoc is the last block comment before it (a module header or section banner may precede it)
  const own = r.comments.findLast(c => c.end <= first && c.type === 'Block')
  for (const c of r.comments) {
    const raw = text.slice(c.start, c.end)
    if (KEEP.test(raw)) continue
    let s = c.start, e = c.end
    let rep = c === own && raw.startsWith('/**') ? summary(raw) : ''
    if (!rep) {
      // `{/* … */}` in JSX: drop the braces too
      const box = empties.find(([a, b]) => a < s && e < b)
      if (box) [s, e] = box
      // a comment on a line of its own: drop the line; a trailing one: drop it and the spaces before it
      const ls = text.lastIndexOf('\n', s - 1) + 1, nl = text.indexOf('\n', e), le = nl < 0 ? text.length : nl
      if (!text.slice(ls, s).trim() && !text.slice(e, le).trim()) { s = ls; e = nl < 0 ? le : le + 1 }
      else {
        while (s > ls && (text[s - 1] === ' ' || text[s - 1] === '\t')) s--
        if (/[\w$]/.test(text[s - 1] ?? '') && /[\w$]/.test(text[e] ?? '')) rep = ' ' // a/* x */b must not become ab
      }
    }
    if (edits.length && s < edits.at(-1)[1]) continue // overlaps the previous edit (a line already dropped)
    edits.push([s, e, rep])
  }
  let out = '', last = 0
  for (const [s, e, rep] of edits) {
    // in the leading comments (before the statement) no blank lines survive; elsewhere text between edits is kept as is
    const gap = text.slice(last, s)
    out += (s <= first ? gap.replace(/^\s+/, '') : gap) + rep; last = e
  }
  const rest = text.slice(last)
  return last <= first ? out + rest.replace(/^\s+(?=\S)/, m => (out ? '\n' : '')) : out + rest
}
