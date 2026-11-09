// Lists physical (left/right) Tailwind utilities and other direction-bound code in src/lib (and src/showcase), with
// the logical replacement, so components mirror under dir="rtl". Parses each file with Vite's TSX parser (no extra
// dependency) and looks only inside string literals and template strings, so `style.left` or `placement: 'left'`
// are not flagged.
//
//   class   a physical utility with a mechanical logical twin (auto-fixable):
//             ml/mr → ms/me · pl/pr → ps/pe · left/right → start/end · border-l/r → border-s/e · rounded-l/r → rounded-s/e
//             rounded-tl/tr/bl/br → rounded-ss/se/es/ee · text-left/right → text-start/end · float/clear-left/right
//             scroll-ml/mr/pl/pr → scroll-ms/me/ps/pe
//   manual  needs a decision: space-x / divide-x without an rtl: reverse, translate-x, origin-left/right,
//           gradients to l/r, a physical utility next to its own rtl:/ltr: variant
//   kept    physical on purpose and left alone: safe-area padding (env(safe-area-inset-left)), `left-1/2
//           -translate-x-1/2` centring
//   icon    a directional icon name ('chevronRight', 'undo'…): add the `ui-flip` class so it mirrors in RTL
//   keys    'ArrowLeft' / 'ArrowRight' handling: map the key through logicalArrow(e.key, dir)
//   style   a physical inline style key (left, marginRight, paddingLeft…): use insetInlineStart, marginInlineEnd…
//
// Usage:
//   node scripts/rtl-lint.mjs                         report src/lib (per file, with line numbers)
//   node scripts/rtl-lint.mjs src/lib/forms.tsx …     only these files (src/showcase files work too)
//   node scripts/rtl-lint.mjs --all                   src/lib and src/showcase
//   node scripts/rtl-lint.mjs --summary               counts per file only
//   node scripts/rtl-lint.mjs --json                  machine-readable findings
//   node scripts/rtl-lint.mjs --fix [files]           dry run: print a diff of the auto-fixable `class` findings
//   node scripts/rtl-lint.mjs --fix --write [files]   apply it
//   node scripts/rtl-lint.mjs --check                 exit 1 if any `class` or `manual` finding remains
//
// A line containing `rtl-lint-ignore` (or the line after one) is skipped.
import { readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { parseAst } from 'vite'

const root = new URL('..', import.meta.url).pathname

/** Split a class token into its variant prefix ("hover:max-[480px]:"), important mark and utility. */
export function rtlSplit(token) {
  let depth = 0, cut = 0
  for (let i = 0; i < token.length; i++) {
    const c = token[i]
    if (c === '[' || c === '(') depth++
    else if (c === ']' || c === ')') depth--
    else if (c === ':' && depth === 0) cut = i + 1
  }
  const prefix = token.slice(0, cut)
  let util = token.slice(cut), bang = ''
  if (util.startsWith('!')) { bang = '!'; util = util.slice(1) }
  let neg = ''
  if (util.startsWith('-')) { neg = '-'; util = util.slice(1) }
  let bangEnd = ''
  if (util.endsWith('!')) { bangEnd = '!'; util = util.slice(0, -1) } // Tailwind v4 trailing important
  return { prefix, bang, neg, util, bangEnd }
}

const SIDE = { l: 's', r: 'e', left: 'start', right: 'end' }
const CORNER = { tl: 'ss', tr: 'se', bl: 'es', br: 'ee' }
/** Mechanical replacements: [pattern on the utility, replacement]. */
const RTL_FIXES = [
  [/^m([lr])-(.+)$/, (_, s, v) => `m${SIDE[s]}-${v}`],
  [/^p([lr])-(.+)$/, (_, s, v) => `p${SIDE[s]}-${v}`],
  [/^(left|right)-(.+)$/, (_, s, v) => `${SIDE[s]}-${v}`],
  [/^border-([lr])((?:-.+)?)$/, (_, s, v) => `border-${SIDE[s]}${v}`],
  [/^rounded-([lr])((?:-.+)?)$/, (_, s, v) => `rounded-${SIDE[s]}${v}`],
  [/^rounded-(tl|tr|bl|br)((?:-.+)?)$/, (_, c, v) => `rounded-${CORNER[c]}${v}`],
  [/^text-(left|right)$/, (_, s) => `text-${SIDE[s]}`],
  [/^(float|clear)-(left|right)$/, (_, k, s) => `${k}-${SIDE[s]}`],
  [/^scroll-([mp])([lr])-(.+)$/, (_, k, s, v) => `scroll-${k}${SIDE[s]}-${v}`],
]
const RTL_MANUAL = [
  [/^space-x-/, 'space-x in RTL lays children out reversed: use gap-* (flex/grid) or add rtl:space-x-reverse', 'space-x-reverse'],
  [/^divide-x(-|$)/, 'divide-x draws the divider on the wrong side in RTL: add rtl:divide-x-reverse', 'divide-x-reverse'],
  [/^translate-x-/, 'horizontal translate does not mirror: add an rtl: twin (rtl:-translate-x-…), or use dirX() for motion offsets'],
  [/^origin-(left|right|top-left|top-right|bottom-left|bottom-right)$/, 'transform origin is physical: add an rtl: twin (rtl:origin-right…)'],
  [/^(bg-gradient-to|bg-linear-to)-(l|r|tl|tr|bl|br)$/, 'gradient direction is physical: add an rtl: twin or use bg-linear-to-… with a logical angle'],
  [/^inset-x-/, null], // symmetric: fine
]

/** Analyse one class string. Returns findings with the token, its suggestion, and whether it can be auto-fixed. */
export function rtlClassFindings(str) {
  const tokens = str.split(/\s+/).filter(Boolean)
  const out = []
  const utils = tokens.map(rtlSplit)
  const hasDirVariant = utils.some(u => /(^|:)(rtl|ltr):$/.test(u.prefix) || /(^|:)(rtl|ltr):/.test(u.prefix))
  const centred = utils.some(u => u.util === 'left-1/2') && utils.some(u => u.neg === '-' && u.util === 'translate-x-1/2')
  utils.forEach((u, i) => {
    const token = tokens[i]
    if (/(^|:)(rtl|ltr):/.test(u.prefix)) return // already a direction-specific variant
    if (/^(left|right)-(start|end|center|top|bottom)$/.test(u.util)) return // a placement value ('left-start'), not a class
    for (const [re, rep] of RTL_FIXES) {
      if (!re.test(u.util)) continue
      const logical = u.util.replace(re, rep)
      const suggestion = u.prefix + u.bang + u.neg + logical + u.bangEnd
      if (/safe-area-inset-(left|right)/.test(u.util)) out.push({ kind: 'kept', token, suggestion, reason: 'safe-area padding is physical: keep it' })
      else if (centred && /^(left|right)-1\/2$/.test(u.util)) out.push({ kind: 'kept', token, suggestion, reason: 'left-1/2 -translate-x-1/2 centres: symmetric, keep it' })
      else if (hasDirVariant) out.push({ kind: 'manual', token, suggestion, reason: 'string already has rtl:/ltr: variants: check by hand' })
      else out.push({ kind: 'class', token, suggestion, fixable: true })
      return
    }
    for (const [re, reason, reverse] of RTL_MANUAL) {
      if (!re.test(u.util)) continue
      if (!reason) return
      if (reverse && tokens.some(t => t.includes(`rtl:${reverse}`))) return
      if (/^translate-x-/.test(u.util) && centred && u.util === 'translate-x-1/2') return
      out.push({ kind: 'manual', token, reason })
      return
    }
  })
  return out
}

const RTL_ICON_NAMES = new Set(['chevronLeft', 'chevronRight', 'undo', 'forward', 'listBullet', 'listOrdered', 'listPlus', 'quote', 'wrap'])
const RTL_STYLE_KEYS = /^(left|right|marginLeft|marginRight|paddingLeft|paddingRight|borderLeft\w*|borderRight\w*|borderTopLeftRadius|borderTopRightRadius|borderBottomLeftRadius|borderBottomRightRadius)$/
const RTL_STYLE_LOGICAL = { left: 'insetInlineStart', right: 'insetInlineEnd', marginLeft: 'marginInlineStart', marginRight: 'marginInlineEnd', paddingLeft: 'paddingInlineStart', paddingRight: 'paddingInlineEnd', borderTopLeftRadius: 'borderStartStartRadius', borderTopRightRadius: 'borderStartEndRadius', borderBottomLeftRadius: 'borderEndStartRadius', borderBottomRightRadius: 'borderEndEndRadius' }
/** Could this string be a class list? (Words separated by spaces, each a plausible Tailwind token.) */
const rtlLooksLikeClasses = s => /^[\s\w\-:[\]().,/%!#&>*+=~@'"^$|?]+$/.test(s) && !/^[A-Z][a-z]+ [a-z]/.test(s.trim())

function rtlLineIndex(src) {
  const starts = [0]
  for (let i = 0; i < src.length; i++) if (src[i] === '\n') starts.push(i + 1)
  return pos => { let lo = 0, hi = starts.length - 1; while (lo < hi) { const m = (lo + hi + 1) >> 1; if (starts[m] <= pos) lo = m; else hi = m - 1 } return [lo + 1, pos - starts[lo] + 1] }
}

/**
 * All findings in one file, plus the source with the fixable ones applied.
 * Fixes are applied per string node, only to whole whitespace-separated tokens.
 */
export function rtlLint(src, file = 'input.tsx') {
  const ast = parseAst(src, { lang: file.endsWith('.ts') ? 'ts' : 'tsx' })
  const at = rtlLineIndex(src), lines = src.split('\n')
  const ignored = line => /rtl-lint-ignore/.test(lines[line - 1] ?? '') || /rtl-lint-ignore/.test(lines[line - 2] ?? '')
  const findings = [], edits = []
  const strNode = (n, text, start, end) => {
    if (!rtlLooksLikeClasses(text)) return
    const fs = rtlClassFindings(text)
    if (!fs.length) return
    const [line, col] = at(start)
    if (ignored(line)) return
    for (const f of fs) findings.push({ file, line, col, ...f })
    const fix = fs.filter(f => f.fixable)
    if (fix.length) edits.push({ start, end, map: new Map(fix.map(f => [f.token, f.suggestion])) })
  }
  const walk = (n, parent) => {
    if (!n || typeof n !== 'object') return
    if (Array.isArray(n)) { for (const x of n) walk(x, parent); return }
    if (typeof n.type !== 'string') return
    if (n.type === 'Literal' && typeof n.value === 'string') {
      if (RTL_ICON_NAMES.has(n.value)) {
        const [line, col] = at(n.start)
        if (!ignored(line) && !/ui-flip/.test(lines[line - 1])) findings.push({ file, line, col, kind: 'icon', token: n.value, reason: 'directional icon: add className="ui-flip" so it mirrors in RTL' })
      } else if (n.value === 'ArrowLeft' || n.value === 'ArrowRight') {
        const [line, col] = at(n.start)
        if (!ignored(line) && !/logicalArrow/.test(lines[line - 1])) findings.push({ file, line, col, kind: 'keys', token: n.value, reason: 'map e.key through logicalArrow(e.key, dir) so arrows follow the reading direction' })
      } else if (!(parent?.type === 'ImportDeclaration' || parent?.type === 'ExportNamedDeclaration' || parent?.type === 'ExportAllDeclaration')) strNode(n, n.value, n.start, n.end)
    } else if (n.type === 'TemplateElement') {
      strNode(n, n.value.raw, n.start, n.end)
    } else if (n.type === 'JSXAttribute' && n.name?.name === 'style' && n.value?.expression?.type === 'ObjectExpression') {
      for (const p of n.value.expression.properties) {
        const k = p.key?.name ?? p.key?.value
        if (p.type === 'Property' && !p.computed && RTL_STYLE_KEYS.test(k ?? '')) {
          const [line, col] = at(p.start)
          if (!ignored(line)) findings.push({ file, line, col, kind: 'style', token: k, suggestion: RTL_STYLE_LOGICAL[k], reason: `physical inline style: use ${RTL_STYLE_LOGICAL[k] ?? 'the logical property'} (or flip the value with the dir)` })
        }
      }
    }
    for (const k in n) if (k !== 'type' && k !== 'start' && k !== 'end') walk(n[k], n)
  }
  walk(ast, null)
  findings.sort((a, b) => a.line - b.line || a.col - b.col)
  let fixed = src
  for (const e of edits.sort((a, b) => b.start - a.start)) {
    const seg = fixed.slice(e.start, e.end).replace(/[^\s`'"{}$]+/g, tok => e.map.get(tok) ?? tok)
    fixed = fixed.slice(0, e.start) + seg + fixed.slice(e.end)
  }
  return { findings, fixed }
}

/** A minimal line diff (changed lines only, with numbers), enough to review a mechanical rewrite. */
export function rtlDiff(a, b, file) {
  const A = a.split('\n'), B = b.split('\n'), out = []
  for (let i = 0; i < Math.max(A.length, B.length); i++) if (A[i] !== B[i]) out.push(`@@ ${file}:${i + 1}\n- ${A[i]?.trim()}\n+ ${B[i]?.trim()}`)
  return out.join('\n')
}

function rtlMain() {
  const args = process.argv.slice(2), flag = n => args.includes(n)
  const files = args.filter(a => !a.startsWith('--'))
  const dirs = flag('--all') ? ['src/lib', 'src/showcase'] : ['src/lib']
  const list = files.length ? files.map(f => join(process.cwd(), f))
    : dirs.flatMap(d => readdirSync(join(root, d)).filter(f => /\.tsx?$/.test(f) && f !== 'index.ts').sort().map(f => join(root, d, f)))
  const all = []
  let diffs = '', changed = 0
  for (const f of list) {
    const src = readFileSync(f, 'utf8'), rel = relative(root, f)
    const { findings, fixed } = rtlLint(src, rel)
    all.push(...findings)
    if (flag('--fix') && fixed !== src) {
      changed++
      diffs += rtlDiff(src, fixed, rel) + '\n'
      if (flag('--write')) writeFileSync(f, fixed)
    }
  }
  if (flag('--json')) { console.log(JSON.stringify(all, null, 2)); return 0 }
  if (flag('--fix')) {
    console.log(diffs || 'nothing to fix')
    const n = all.filter(x => x.fixable).length
    console.log(`${flag('--write') ? 'fixed' : 'would fix'} ${n} classes in ${changed} files${flag('--write') ? '' : ' (dry run: add --write to apply)'}`)
    return 0
  }
  const byFile = new Map()
  for (const x of all) { if (!byFile.has(x.file)) byFile.set(x.file, []); byFile.get(x.file).push(x) }
  const KINDS = ['class', 'manual', 'kept', 'icon', 'keys', 'style']
  const tally = xs => KINDS.map(k => [k, xs.filter(x => x.kind === k).length])
  if (!flag('--summary')) {
    for (const [f, xs] of byFile) {
      console.log(`\n${f}`)
      for (const x of xs) console.log(`  ${String(x.line).padStart(5)}:${String(x.col).padEnd(4)} ${x.kind.padEnd(6)} ${x.token}${x.suggestion ? ` → ${x.suggestion}` : ''}${x.reason ? `  (${x.reason})` : ''}`)
    }
    console.log('')
  }
  const w = Math.max(10, ...[...byFile.keys()].map(f => f.length))
  console.log(`${'file'.padEnd(w)}  ${KINDS.map(k => k.padStart(6)).join(' ')}   fixable`)
  for (const [f, xs] of [...byFile].sort((a, b) => b[1].length - a[1].length)) console.log(`${f.padEnd(w)}  ${tally(xs).map(([, n]) => String(n).padStart(6)).join(' ')}   ${String(xs.filter(x => x.fixable).length).padStart(7)}`)
  console.log(`${'total'.padEnd(w)}  ${tally(all).map(([, n]) => String(n).padStart(6)).join(' ')}   ${String(all.filter(x => x.fixable).length).padStart(7)}`)
  if (flag('--check')) {
    const bad = all.filter(x => x.kind === 'class' || x.kind === 'manual').length
    if (bad) console.error(`✗ ${bad} physical utilities need a logical twin`)
    return bad ? 1 : 0
  }
  return 0
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop())) process.exitCode = rtlMain()
