// Finds user-facing English strings in src/lib that don't go through the message catalog (`t(…)`), for the i18n
// sweep. Parses each module with Vite's TSX parser (no extra dependency) and reports, per file:
//
//   text     JSX text:                       <span>No results</span>
//   attr     a user-facing JSX attribute:    aria-label="Close", title={`Remove ${name}`}, placeholder, alt, label…
//   default  a label-like prop's default:    function Spinner({ label = 'Loading' })
//   object   a label-like object property:   toast({ title: 'Copied' }), { label: 'Light', value: 'light' }
//
// Usage:
//   node scripts/i18n-extract.mjs                       report every module (strings with line numbers)
//   node scripts/i18n-extract.mjs src/lib/forms.tsx     only these files
//   node scripts/i18n-extract.mjs --summary             counts per file and kind only
//   node scripts/i18n-extract.mjs --kinds text,attr     only these kinds (default: all four)
//   node scripts/i18n-extract.mjs --json                machine-readable [{ file, line, col, kind, prop?, text }]
//   node scripts/i18n-extract.mjs --check               exit 1 if anything is found (CI, once a file is swept)
//   node scripts/i18n-extract.mjs --check --baseline scripts/i18n-baseline.json
//                                                       exit 1 only when a file has more strings than its baseline
//   node scripts/i18n-extract.mjs --write-baseline scripts/i18n-baseline.json
//
// Ignored: strings inside t(…) calls, className/style/key/id/data-* and other non-text props, strings with no letters,
// identifiers and CSS-like tokens (e.g. 'chevronRight', 'h-9 w-full'), URLs, and code samples marked with
// `// i18n-ignore` on the same or the previous line. Sample data (demo rows, chat transcripts) is reported as
// `object`; filter it out with --kinds text,attr,default.
import { readFileSync, readdirSync, writeFileSync, existsSync } from 'node:fs'
import { join, relative } from 'node:path'
import { parseAst } from 'vite'

const root = new URL('..', import.meta.url).pathname
const args = process.argv.slice(2)
const flag = n => args.includes(n)
const opt = n => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : undefined }
const optValues = new Set(['--kinds', '--baseline', '--write-baseline'].map(opt).filter(Boolean))
const files = args.filter(a => !a.startsWith('--') && !optValues.has(a))
const kinds = new Set((opt('--kinds') ?? 'text,attr,default,object').split(','))

/** JSX attributes whose value people read or hear. */
export const I18N_TEXT_ATTRS = /^(aria-(label|description|roledescription|valuetext|placeholder)|title|placeholder|alt|label|description|hint|caption|tooltip|heading|subtitle|message|empty|emptyText|emptyLabel|noResults|loadingText|confirmLabel|cancelLabel|actionLabel|submitLabel|okLabel|closeLabel|suggestion|sublabel|helper|helperText|error)$/
/** Prop defaults and object keys that hold text. */
export const I18N_TEXT_KEYS = /^(label|title|description|placeholder|hint|caption|tooltip|heading|subtitle|message|empty|emptyText|emptyLabel|noResults|loadingText|confirmLabel|cancelLabel|actionLabel|submitLabel|okLabel|closeLabel|ariaLabel|text|helper|helperText|sublabel)$/

/** Does this look like words a person reads (not an identifier, class list, URL, or symbol)? */
export function i18nLooksLikeText(s, kind) {
  const t = s.replace(/\s+/g, ' ').trim()
  if (!/\p{L}/u.test(t)) return false // no letters: numbers, symbols, punctuation
  if (/^(https?:|mailto:|tel:|data:|#|\/|\.\/)/.test(t)) return false
  if (/^[Mm][\d\s.,-]/.test(t) && /^[MmLlHhVvCcSsQqTtAaZz\d\s.,-]+$/.test(t)) return false // SVG path data
  if (/^[a-z][a-zA-Z0-9]*$/.test(t) && kind !== 'text') return false // camelCase identifier / icon name
  if (/^[a-z0-9-]+$/.test(t) && kind !== 'text') return false // kebab ids
  if (/(^|\s)(-?[a-z]+-\[|[a-z]+:[a-z-]+|(bg|text|border|rounded|flex|grid|px|py|h|w)-)/.test(t) && !/[A-Z]/.test(t[0])) return false // class lists
  if (kind === 'text' && t.length === 1 && !/\p{L}{1}/u.test(t)) return false
  return true
}

const isTCall = n => n?.type === 'CallExpression' && ((n.callee.type === 'Identifier' && /^(t|tr|translate|msg)$/.test(n.callee.name)) || (n.callee.type === 'MemberExpression' && n.callee.property?.name === 't'))

/** Strings an expression can evaluate to: literals, templates (with {…} for holes), both arms of ?: and ||/??/&&. */
function i18nStringsOf(n, src) {
  if (!n) return []
  switch (n.type) {
    case 'Literal': return typeof n.value === 'string' ? [{ text: n.value, node: n }] : []
    case 'TemplateLiteral': return [{ text: n.quasis.map(q => q.value.cooked ?? q.value.raw).join('{…}'), node: n }]
    case 'ConditionalExpression': return [...i18nStringsOf(n.consequent, src), ...i18nStringsOf(n.alternate, src)]
    case 'LogicalExpression': return [...i18nStringsOf(n.left, src), ...i18nStringsOf(n.right, src)]
    case 'JSXExpressionContainer': return i18nStringsOf(n.expression, src)
    case 'TSAsExpression': case 'TSSatisfiesExpression': case 'ParenthesizedExpression': return i18nStringsOf(n.expression, src)
    default: return []
  }
}

function i18nLineIndex(src) {
  const starts = [0]
  for (let i = 0; i < src.length; i++) if (src[i] === '\n') starts.push(i + 1)
  return pos => { let lo = 0, hi = starts.length - 1; while (lo < hi) { const m = (lo + hi + 1) >> 1; if (starts[m] <= pos) lo = m; else hi = m - 1 } return [lo + 1, pos - starts[lo] + 1] }
}

/** Every finding in one file's source. */
export function i18nExtract(src, file = 'input.tsx') {
  const ast = parseAst(src, { lang: file.endsWith('.ts') ? 'ts' : 'tsx' })
  const at = i18nLineIndex(src), lines = src.split('\n')
  const ignored = line => /i18n-ignore/.test(lines[line - 1] ?? '') || /i18n-ignore/.test(lines[line - 2] ?? '')
  const out = []
  const add = (kind, node, text, prop) => {
    if (!i18nLooksLikeText(text, kind)) return
    const [line, col] = at(node.type === 'JSXText' ? node.start + node.value.length - node.value.trimStart().length : node.start)
    if (ignored(line)) return
    out.push({ file, line, col, kind, ...(prop && { prop }), text: text.replace(/\s+/g, ' ').trim() })
  }
  const walk = (n, inT) => {
    if (!n || typeof n !== 'object') return
    if (Array.isArray(n)) { for (const x of n) walk(x, inT); return }
    if (typeof n.type !== 'string') return
    const t = inT || isTCall(n)
    if (!t) {
      if (n.type === 'JSXText') add('text', n, n.value)
      else if (n.type === 'JSXAttribute' && n.name?.type === 'JSXIdentifier' && I18N_TEXT_ATTRS.test(n.name.name)) {
        for (const s of i18nStringsOf(n.value, src)) add('attr', s.node, s.text, n.name.name)
      } else if (n.type === 'JSXExpressionContainer' && n.expression && (n.expression.type === 'Literal' || n.expression.type === 'TemplateLiteral' || n.expression.type === 'ConditionalExpression')) {
        // {'Text'} or {cond ? 'A' : 'B'} as a child: only when the container is a JSX child (not an attribute value)
        if (n.__child) for (const s of i18nStringsOf(n.expression, src)) add('text', s.node, s.text)
      } else if (n.type === 'AssignmentPattern' && n.left?.type === 'Identifier' && I18N_TEXT_KEYS.test(n.left.name)) {
        for (const s of i18nStringsOf(n.right, src)) add('default', s.node, s.text, n.left.name)
      } else if (n.type === 'Property' && !n.computed && (n.key?.type === 'Identifier' || n.key?.type === 'Literal') && I18N_TEXT_KEYS.test(n.key.name ?? n.key.value)) {
        for (const s of i18nStringsOf(n.value, src)) add('object', s.node, s.text, n.key.name ?? n.key.value)
      }
    }
    if ((n.type === 'JSXElement' || n.type === 'JSXFragment') && Array.isArray(n.children)) for (const c of n.children) if (c?.type === 'JSXExpressionContainer') c.__child = true
    for (const k in n) if (k !== 'type' && k !== 'start' && k !== 'end' && k !== '__child') walk(n[k], t)
  }
  walk(ast, false)
  return out.sort((a, b) => a.line - b.line || a.col - b.col)
}

function i18nMain() {
  const dir = join(root, 'src/lib')
  const list = files.length ? files.map(f => join(process.cwd(), f)) : readdirSync(dir).filter(f => /\.tsx?$/.test(f) && f !== 'index.ts' && f !== 'utils.ts').sort().map(f => join(dir, f))
  const all = []
  for (const f of list) all.push(...i18nExtract(readFileSync(f, 'utf8'), relative(root, f)).filter(x => kinds.has(x.kind)))
  const byFile = new Map()
  for (const x of all) { if (!byFile.has(x.file)) byFile.set(x.file, []); byFile.get(x.file).push(x) }
  const counts = Object.fromEntries([...byFile].map(([f, xs]) => [f, xs.length]))

  if (opt('--write-baseline')) { writeFileSync(opt('--write-baseline'), JSON.stringify(counts, null, 2) + '\n'); console.log(`wrote ${opt('--write-baseline')}`); return 0 }
  if (flag('--json')) { console.log(JSON.stringify(all, null, 2)); return 0 }
  const kindsOf = xs => ['text', 'attr', 'default', 'object'].map(k => [k, xs.filter(x => x.kind === k).length]).filter(([, n]) => n).map(([k, n]) => `${k} ${n}`).join(', ')
  if (!flag('--summary') && !flag('--check')) {
    for (const [f, xs] of byFile) {
      console.log(`\n${f}  (${xs.length}: ${kindsOf(xs)})`)
      for (const x of xs) console.log(`  ${String(x.line).padStart(5)}:${String(x.col).padEnd(4)} ${x.kind.padEnd(7)} ${x.prop ? x.prop + '=' : ''}${JSON.stringify(x.text)}`)
    }
    console.log('')
  }
  const w = Math.max(10, ...[...byFile.keys()].map(f => f.length))
  console.log(`${'file'.padEnd(w)}  strings  by kind`)
  for (const [f, xs] of [...byFile].sort((a, b) => b[1].length - a[1].length)) console.log(`${f.padEnd(w)}  ${String(xs.length).padStart(7)}  ${kindsOf(xs)}`)
  console.log(`${'total'.padEnd(w)}  ${String(all.length).padStart(7)}  ${kindsOf(all)}`)

  if (flag('--check')) {
    const base = opt('--baseline')
    if (base) {
      if (!existsSync(base)) { console.error(`baseline ${base} not found`); return 1 }
      const b = JSON.parse(readFileSync(base, 'utf8'))
      const worse = Object.entries(counts).filter(([f, n]) => n > (b[f] ?? 0))
      for (const [f, n] of worse) console.error(`✗ ${f}: ${n} untranslated strings (baseline ${b[f] ?? 0})`)
      return worse.length ? 1 : 0
    }
    if (all.length) console.error(`✗ ${all.length} user-facing strings bypass t()`)
    return all.length ? 1 : 0
  }
  return 0
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop())) process.exitCode = i18nMain()
