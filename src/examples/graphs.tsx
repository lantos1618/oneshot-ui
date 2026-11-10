import { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Badge, Icon, IconButton, StatusIcon, cn, useLocale, type StatusIconStatus } from '../lib/core'
import { Switch } from '../lib/forms'
import { CodeBlock, type CodeMark, type CodeTokenRange } from '../lib/code'
import { Message, MessageActions } from '../lib/aichat'
import { aiMessageText, type AiMessage } from '../lib/aistream'
import { LaneGraph, layoutLanes, type LaneGraphHandle, type LaneNode, type LaneRow, type LaneRowState } from '../lib/lanes'

/* Graphs as rows: four small examples that feed different graph data into LaneGraph, each with its own renderRow.
 * The graph is always the same idea (nodes with parents, laid out by layoutLanes); only the rows differ.
 *
 *   chat branches   editing a message or regenerating an answer forks a branch; one message combines two branches
 *   AST             a short snippet parsed into a syntax tree, linked both ways with its code (row ↔ the characters it covers)
 *   agent run       steps that fan out and back in, with statuses and durations
 *   dependencies    packages and the packages they need: shared dependencies make diamonds
 *
 * (The fifth, git, is the library's own preset: GitGraph.) Each builder is a plain function, tested on its own. */

/* ── chat branches ─────────────────────────────────────────────────────────── */

/**
 * A chat message in a tree: an AiMessage (what useAiChat keeps) plus where it hangs. `parentId` is the message it
 * answers or follows (none for the first); `parents` instead, when it follows more than one (a message combining two
 * branches). An edit of a user message is a sibling of the original (same parent); so is a regenerated answer.
 */
export type ChatTreeMessage = AiMessage & { parentId?: string | null; parents?: readonly string[] }
/** A chat message as a lane node: `siblings` are the alternatives at its fork (itself included, oldest first). */
export type ChatBranchNode = LaneNode & { message: ChatTreeMessage; siblings: readonly string[] }

const chatParentsOf = (m: ChatTreeMessage) => m.parents ?? (m.parentId ? [m.parentId] : [])

/**
 * Lane nodes for a chat tree (messages oldest first) and its active thread: every ancestor of `leaf` (both sides of a
 * combining message), which LaneGraph pins to lane 0 with `pin: ['active'], pinStart: () => leaf`.
 */
export function chatBranchGraph(messages: readonly ChatTreeMessage[], leaf: string | null) {
  const kids = new Map<string, string[]>()
  for (const m of messages) for (const p of chatParentsOf(m)) kids.set(p, [...(kids.get(p) ?? []), m.id])
  const byId = new Map(messages.map(m => [m.id, m]))
  // a branch starts wherever a message has more than one child: each child after the first starts a new colour
  const nodes: ChatBranchNode[] = messages.map(m => {
    const ps = chatParentsOf(m), siblings = ps.length === 1 ? (kids.get(ps[0]) ?? [m.id]).filter(id => byId.get(id)?.role === m.role) : [m.id]
    return { id: m.id, parents: ps, group: siblings.length > 1 && siblings[0] !== m.id ? `branch:${m.id}` : undefined, message: m, siblings }
  })
  const active = new Set<string>()
  const stack = leaf && byId.has(leaf) ? [leaf] : []
  while (stack.length) { const id = stack.pop()!; if (active.has(id)) continue; active.add(id); stack.push(...chatParentsOf(byId.get(id)!).filter(p => byId.has(p))) }
  return { nodes, active, children: kids }
}

/** The newest leaf below `id` (following the last child each time): where "continue this branch" picks up. */
export function chatLeafOf(id: string, children: ReadonlyMap<string, readonly string[]>): string {
  let at = id
  for (let guard = 0; guard < 10_000; guard++) { const k = children.get(at); if (!k?.length) return at; at = k[k.length - 1] }
  return at
}

/** A new branch: `message` as a sibling of `of` (an edited question or a regenerated answer), appended to the list. */
export function chatFork(messages: readonly ChatTreeMessage[], of: string, message: Omit<ChatTreeMessage, 'parentId' | 'parents'>): ChatTreeMessage[] {
  const base = messages.find(m => m.id === of)
  if (!base) return [...messages]
  return [...messages, { ...message, ...(base.parents ? { parents: base.parents } : { parentId: base.parentId ?? null }) }]
}

const chatText = (id: string, role: 'user' | 'assistant', text: string, parent: string | string[] | null, extra: Partial<ChatTreeMessage> = {}): ChatTreeMessage =>
  ({ id, role, status: 'done', parts: [{ type: 'text', text }], ...(Array.isArray(parent) ? { parents: parent } : { parentId: parent }), ...extra })

/** The sample tree: a trip plan with an edited question, a regenerated answer, a side branch and a message that combines two branches. */
export const CHAT_TREE_SAMPLE: ChatTreeMessage[] = [
  chatText('u1', 'user', 'Plan three days in Lisbon in March. I like walking, food and a bit of history.', null),
  chatText('a1', 'assistant', `Here's a plan that keeps the hills manageable and leaves room for long lunches.

## Day 1 · Baixa, Alfama and the castle
- **Morning:** start at *Praça do Comércio*, walk up Rua Augusta and take the Santa Justa lift.
- **Afternoon:** Alfama on foot. Stop at the *Miradouro de Santa Luzia*, then **Castelo de São Jorge** before 4 pm (the light is best).
- **Evening:** dinner in Alfama; most fado houses start around 8:30 pm.

## Day 2 · Belém
- Tram 15 from Praça da Figueira (about 25 min).
- Jerónimos Monastery, then the *pastéis de Belém* queue moves faster than it looks.
- Walk the river to the MAAT at sunset.

## Day 3 · Sintra (day trip)
| | Option | Time |
|---|---|---|
| Train | Rossio → Sintra | 40 min |
| Pena Palace | timed ticket | 2 h |
| Quinta da Regaleira | the initiation well | 1.5 h |

> March is mild (15–18 °C) but showery: pack a light rain jacket, and book Pena tickets online.`, 'u1'),
  chatText('u2', 'user', 'Make day 2 about food instead.', 'a1'),
  chatText('a2', 'assistant', 'Day 2, rebuilt around food: **Mercado da Ribeira** for a late breakfast, a *bifana* in Bairro Alto, then a tasca dinner in Graça (book ahead on Saturdays).', 'u2'),
  chatText('u3', 'user', 'What if it rains all day?', 'a2'),
  chatText('a3', 'assistant', 'Rain plan: the **Tile Museum** (Museu do Azulejo) in the morning, lunch at the covered Time Out Market, and the *Gulbenkian* in the afternoon. All three are a short taxi apart.', 'u3'),
  // fork 1: the question edited
  chatText('u2b', 'user', 'Make day 2 about museums instead.', 'a1'),
  { id: 'a2b', role: 'assistant', status: 'done', parentId: 'u2b', parts: [
    { type: 'tool', id: 't1', name: 'search_museums', state: 'done', args: { city: 'Lisbon', month: 'March', open: 'Tuesday' }, result: [{ name: 'Gulbenkian Museum', closes: '18:00' }, { name: 'MAAT', closes: '19:00' }, { name: 'National Tile Museum', closes: '18:00' }] },
    { type: 'text', text: 'All three are open on Tuesdays in March. Day 2: **Gulbenkian** in the morning (allow 2 h), the **Tile Museum** after lunch, and the **MAAT** for the river view at the end of the day.' },
  ] },
  // fork 2: that answer regenerated
  chatText('a2c', 'assistant', 'A lighter museum day: just the **Tile Museum** and a long walk through Graça to the *Miradouro da Senhora do Monte*.', 'u2b'),
  // fork 3: a side question after the rain plan
  chatText('u4', 'user', 'Can you book a fado show for day 1?', 'a3'),
  chatText('a4', 'assistant', 'I can’t book it for you, but *Clube de Fado* and *Tasca do Chico* both take reservations online; Tasca do Chico doesn’t, so arrive by 8 pm.', 'u4'),
  // the merge: one message that follows two branches
  chatText('u5', 'user', 'Combine the food day and the museum day.', ['a3', 'a2b']),
  chatText('a5', 'assistant', 'Combined day 2: **Gulbenkian** at opening, lunch at **Mercado da Ribeira**, the **Tile Museum** in the afternoon, and a tasca dinner in Graça. If it rains, swap the walk for a taxi; everything indoors stays the same.', 'u5'),
]

/**
 * A long branching conversation of about `n` messages (for scrolling tests): rounds of question and answer from the
 * sample, every ninth answer regenerated and every thirteenth question edited. The last message is on the main thread.
 */
export function chatTreeHistory(n = 2000): ChatTreeMessage[] {
  const questions = CHAT_TREE_SAMPLE.filter(m => m.role === 'user'), answers = CHAT_TREE_SAMPLE.filter(m => m.role === 'assistant' && !m.parents)
  const out: ChatTreeMessage[] = []
  let parent: string | null = null
  for (let k = 0; out.length < n; k++) {
    const q = questions[k % questions.length], a = answers[k % answers.length]
    if (k % 13 === 6) { // an edited question: a sibling branch with its own answer, before the one the thread follows
      out.push(chatText(`q${k}e`, 'user', `${aiMessageText(q)} (edited)`, parent))
      out.push(chatText(`a${k}e`, 'assistant', aiMessageText(answers[(k + 1) % answers.length]), `q${k}e`))
    }
    out.push({ ...q, id: `q${k}`, parentId: parent, parents: undefined })
    if (k % 9 === 4) out.push(chatText(`a${k}r`, 'assistant', aiMessageText(answers[(k + 2) % answers.length]), `q${k}`)) // a regenerated answer
    out.push({ ...a, id: `a${k}`, parentId: `q${k}`, parents: undefined, parts: a.parts.map(p => (p.type === 'tool' ? { ...p, id: `${p.id}-${k}` } : p)) })
    parent = `a${k}`
  }
  return out
}

/** The chat branches example: the sample tree as lanes, the active thread pinned left, ‹ n / m › to switch branches, regenerate or edit to fork. */
export function ChatBranchesExample({ height = 560, messages: initial = CHAT_TREE_SAMPLE }: { height?: number; /** the tree to start from (default CHAT_TREE_SAMPLE); its last message is the active one */ messages?: ChatTreeMessage[] }) {
  const [messages, setMessages] = useState<ChatTreeMessage[]>(initial)
  const [leaf, setLeaf] = useState(() => initial[initial.length - 1]?.id ?? '')
  const [collapse, setCollapse] = useState(false)
  const [forks, setForks] = useState(0)
  const { nodes, active, children } = useMemo(() => chatBranchGraph(messages, leaf), [messages, leaf])
  const pinStart = useCallback(() => leaf, [leaf])
  const goBranch = useCallback((id: string) => setLeaf(chatLeafOf(id, children)), [children])
  const fork = (m: ChatTreeMessage) => {
    const n = forks + 1, id = `${m.id}-fork${n}`
    const text = m.role === 'user' ? `${aiMessageText(m).replace(/\.$/, '')}, but keep it cheap.` : `Another take (${n}): fewer stops, more time in each place, and lunch somewhere with a view.`
    let next = chatFork(messages, m.id, { id, role: m.role, status: 'done', parts: [{ type: 'text', text }] })
    let tip = id
    if (m.role === 'user') { tip = `${id}-reply`; next = [...next, chatText(tip, 'assistant', 'Budget version: the same route on foot and by tram, lunch at a *tasca* (about €12), and the free-entry Sunday mornings at the national museums.', id)] }
    setMessages(next); setForks(n); setLeaf(tip)
  }
  const renderRow = useCallback((row: LaneRow<ChatBranchNode>) => {
    const m = row.node.message, on = active.has(m.id), sibs = row.node.siblings, at = sibs.indexOf(m.id)
    if (collapse && !on) return (
      <div className="flex h-full min-w-0 items-center gap-2 pe-3 text-xs text-[var(--fg3)]">
        <span className="flex-none font-medium">{m.role === 'user' ? 'You' : 'Assistant'}</span>
        <span dir="auto" className="min-w-0 truncate">{aiMessageText(m).split('\n')[0] || m.parts.find(p => p.type === 'tool')?.type}</span>
      </div>
    )
    const switcher = sibs.length > 1 && (
      <span className="flex items-center gap-0.5 text-[11px] text-[var(--fg3)]">
        <IconButton size="icon-xs" icon={<Icon name="chevronLeft" size={13} className="ui-flip" />} label="Previous branch" disabled={at <= 0} onClick={e => { e.stopPropagation(); goBranch(sibs[at - 1]) }} />
        <span className="ui-num">{at + 1} / {sibs.length}</span>
        <IconButton size="icon-xs" icon={<Icon name="chevronRight" size={13} className="ui-flip" />} label="Next branch" disabled={at >= sibs.length - 1} onClick={e => { e.stopPropagation(); goBranch(sibs[at + 1]) }} />
      </span>
    )
    const merge = row.parents.length > 1 && <Badge size="sm" tone="accent" className="me-auto">Combines {row.parents.length} branches</Badge>
    return (
      <div className={cn('flex min-w-0 flex-col gap-1.5 py-2 pe-3', !on && 'opacity-60')}>
        <Message message={m} actions={
          <MessageActions text={() => aiMessageText(m)} feedback={false} onRetry={() => fork(m)} retryLabel="Regenerate (new branch)">{merge}{switcher}</MessageActions>} />
        {m.role === 'user' && (
          <span className="flex items-center justify-end gap-1">
            {merge}
            {switcher}
            <IconButton size="icon-xs" icon="edit" label="Edit (new branch)" onClick={e => { e.stopPropagation(); fork(m) }} />
          </span>
        )}
      </div>
    )
  }, [active, collapse, goBranch, messages, forks]) // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <div className="flex flex-wrap items-center gap-3 text-xs text-[var(--fg2)]">
        <Switch label={<span className="text-xs">Collapse other branches</span>} checked={collapse} onChange={setCollapse} />
        <span>{nodes.length} messages · {[...children.values()].filter(k => k.length > 1).length} forks · click a message to continue its branch</span>
      </div>
      <LaneGraph nodes={nodes} order="input" direction="up" pin={['active']} pinStart={pinStart} rowHeight="auto" estimateRowHeight={110} nodeY={18} anchor="end" height={height}
        aria-label="Conversation branches" selected={leaf} onActivate={row => goBranch(row.node.id)} emphasis={row => row.node.id === leaf}
        renderRow={renderRow} className="rounded-[var(--r-md)] border border-[var(--line)]" />
    </div>
  )
}

/* ── AST ───────────────────────────────────────────────────────────────────── */

/** A syntax tree node: its kind, a short label (a name, an operator), and the source span it covers ([start, end)). */
export type AstNode = { id: string; kind: string; label?: string; start: number; end: number; children: AstNode[] }
/** An AST node as a lane node: its parent is the node that contains it. */
export type AstLaneNode = LaneNode & { ast: AstNode; depth: number }

/** The snippet the AST example parses. */
export const AST_SAMPLE = `const total = cart.reduce((sum, item) =>
  sum + item.price * item.qty, 0)
const discount = total > 100 ? total * 0.1 : 0
if (discount > 0) notify(user, "You saved " + discount)`

type AstToken = { t: 'id' | 'num' | 'str' | 'op'; v: string; start: number; end: number }
const AST_OPS = ['===', '!==', '=>', '>=', '<=', '&&', '||', '+', '-', '*', '/', '>', '<', '?', ':', '(', ')', ',', '.', '=', ';', '{', '}']
/** Binding power of the binary operators the parser knows (higher binds tighter). */
const AST_PREC: Record<string, number> = { '||': 1, '&&': 2, '===': 3, '!==': 3, '<': 4, '>': 4, '<=': 4, '>=': 4, '+': 5, '-': 5, '*': 6, '/': 6 }

function astTokens(src: string): AstToken[] {
  const out: AstToken[] = []
  for (let i = 0; i < src.length;) {
    const ch = src[i]
    if (/\s/.test(ch)) { i++; continue }
    const word = /^[A-Za-z_$][\w$]*/.exec(src.slice(i)) ?? /^\d+(\.\d+)?/.exec(src.slice(i))
    if (word) { out.push({ t: /\d/.test(ch) ? 'num' : 'id', v: word[0], start: i, end: i + word[0].length }); i += word[0].length; continue }
    if (ch === '"' || ch === "'") { const j = src.indexOf(ch, i + 1); const end = j < 0 ? src.length : j + 1; out.push({ t: 'str', v: src.slice(i, end), start: i, end }); i = end; continue }
    const op = AST_OPS.find(o => src.startsWith(o, i))
    if (!op) throw new SyntaxError(`Unexpected "${ch}" at ${i}`)
    out.push({ t: 'op', v: op, start: i, end: i + op.length }); i += op.length
  }
  return out
}

/**
 * Parse a small JavaScript subset into an AstNode tree: const/let, if, return and expression statements; arrow
 * functions, calls, member access, ?: and the usual binary operators with precedence; identifiers, numbers and strings.
 * Enough for the example (a real app would use its compiler's AST: TypeScript, Babel, tree-sitter).
 */
export function parseAst(src: string): AstNode {
  const tk = astTokens(src)
  let i = 0, ids = 0
  const peek = (v?: string) => (v === undefined ? tk[i] : tk[i]?.v === v ? tk[i] : undefined)
  const eat = (v: string) => { const x = tk[i]; if (x?.v !== v) throw new SyntaxError(`Expected "${v}" at ${x?.start ?? src.length}`); i++; return x }
  const node = (kind: string, start: number, end: number, children: AstNode[] = [], label?: string): AstNode => ({ id: `n${ids++}`, kind, label, start, end, children })
  const ident = (x: AstToken) => node('Identifier', x.start, x.end, [], x.v)

  const primary = (): AstNode => {
    const x = tk[i]
    if (!x) throw new SyntaxError('Unexpected end')
    if (x.t === 'num') { i++; return node('NumericLiteral', x.start, x.end, [], x.v) }
    if (x.t === 'str') { i++; return node('StringLiteral', x.start, x.end, [], x.v) }
    if (x.t === 'id') {
      i++
      if (peek('=>')) { i++; const body = expression(); return node('ArrowFunction', x.start, body.end, [ident(x), body]) }
      return ident(x)
    }
    if (x.v === '(') {
      // an arrow function's parameters, or a parenthesised expression
      let depth = 0, j = i
      for (; j < tk.length; j++) { if (tk[j].v === '(') depth++; else if (tk[j].v === ')' && --depth === 0) break }
      if (tk[j + 1]?.v === '=>') {
        i++
        const params: AstNode[] = []
        while (!peek(')')) { params.push(ident(tk[i++])); if (peek(',')) i++ }
        i += 2 // ')' '=>'
        const body = expression()
        return node('ArrowFunction', x.start, body.end, [...params, body])
      }
      i++
      const inner = expression(); eat(')')
      return inner
    }
    throw new SyntaxError(`Unexpected "${x.v}" at ${x.start}`)
  }
  const postfix = (): AstNode => {
    let e = primary()
    for (;;) {
      if (peek('.')) { i++; const p = tk[i++]; e = node('MemberExpression', e.start, p.end, [e, ident(p)], `.${p.v}`) }
      else if (peek('(')) {
        i++
        const args: AstNode[] = []
        while (!peek(')')) { args.push(expression()); if (peek(',')) i++ }
        const close = eat(')')
        e = node('CallExpression', e.start, close.end, [e, ...args])
      } else return e
    }
  }
  const binary = (min: number): AstNode => { // precedence climbing
    let left = postfix()
    for (let op = tk[i]; op && AST_PREC[op.v] >= min; op = tk[i]) {
      i++
      const right = binary(AST_PREC[op.v] + 1)
      left = node('BinaryExpression', left.start, right.end, [left, right], op.v)
    }
    return left
  }
  const expression = (): AstNode => {
    const test = binary(1)
    if (!peek('?')) return test
    i++; const yes = expression(); eat(':'); const no = expression()
    return node('ConditionalExpression', test.start, no.end, [test, yes, no])
  }
  const statement = (): AstNode => {
    const x = tk[i]
    if (x.v === 'const' || x.v === 'let') {
      i++
      const name = tk[i++]; eat('=')
      const init = expression(); if (peek(';')) i++
      return node('VariableDeclaration', x.start, init.end, [ident(name), init], `${x.v} ${name.v}`)
    }
    if (x.v === 'if') {
      i++; eat('('); const test = expression(); eat(')')
      const then = statement()
      return node('IfStatement', x.start, then.end, [test, then])
    }
    if (x.v === 'return') { i++; const arg = expression(); if (peek(';')) i++; return node('ReturnStatement', x.start, arg.end, [arg]) }
    const e = expression(); if (peek(';')) i++
    return node('ExpressionStatement', e.start, e.end, [e])
  }
  const body: AstNode[] = []
  while (i < tk.length) body.push(statement())
  return node('Program', 0, src.length, body)
}

/** The tree as lane nodes in source order (a node before its children): each node's parent is the node containing it. */
export function astLaneNodes(root: AstNode): AstLaneNode[] {
  const out: AstLaneNode[] = []
  const walk = (n: AstNode, parent: string | null, depth: number) => {
    out.push({ id: n.id, parents: parent ? [parent] : [], group: n.kind, ast: n, depth })
    n.children.forEach(c => walk(c, n.id, depth + 1))
  }
  walk(root, null, 0)
  return out
}

/**
 * The deepest node whose span contains `[start, end)` (a token's range; `end` defaults to `start + 1`, one character):
 * what a word in the code belongs to. The root when nothing deeper does; null outside the root's span.
 */
export function astNodeAt(root: AstNode, start: number, end = start + 1): AstNode | null {
  if (start < root.start || end > root.end) return null
  let at = root
  for (;;) { const next = at.children.find(c => c.start <= start && end <= c.end); if (!next) return at; at = next }
}

/** Kinds by colour family, as full class strings. */
const AST_KIND_CLASS: Record<string, string> = {
  Program: 'text-[var(--fg)]', VariableDeclaration: 'text-[var(--accent)]', IfStatement: 'text-[var(--accent)]', ExpressionStatement: 'text-[var(--accent)]', ReturnStatement: 'text-[var(--accent)]',
  Identifier: 'text-[var(--fg2)]', NumericLiteral: 'text-[var(--ok)]', StringLiteral: 'text-[var(--ok)]',
}

/**
 * The AST example: the parsed snippet as a tree of rows (kind, label, the code it covers) beside the code. Hovering or
 * focusing a row underlines exactly that node's characters in the code, in the row's lane colour; hovering a word in the
 * code lights the deepest node containing it (LaneGraph's controlled `hovered`: its row and first-parent line, scrolled
 * into view inside the list), and clicking one selects that node (solid underline). The rows are the accessible part;
 * the marks are decoration.
 */
export function AstGraphExample({ source = AST_SAMPLE, height = 420 }: { source?: string; height?: number }) {
  const root = useMemo(() => parseAst(source), [source])
  const layout = useMemo(() => layoutLanes(astLaneNodes(root), { order: 'input', direction: 'up' }), [root])
  const graph = useRef<LaneGraphHandle>(null)
  // the hovered node, and where the mouse is: on its row, or on a word of its code
  const [hot, setHot] = useState<{ id: string; from: 'row' | 'code' } | null>(null)
  const [active, setActive] = useState(0)
  const [selected, setSelected] = useState<string | null>(null)
  const [focused, setFocused] = useState(false)
  const selectedRow = selected == null ? -1 : layout.rowOf(selected)
  const hotRow = hot ? layout.rowOf(hot.id) : -1
  const resting = !hot && !focused
  const shownRow = hotRow >= 0 ? hotRow : focused ? active : selectedRow >= 0 ? selectedRow : null
  const shown = shownRow == null ? undefined : layout.rows[shownRow]
  const at = shown?.node.ast
  const marks = useMemo<CodeMark[]>(() => (at && shown ? [{ start: at.start, end: at.end, color: layout.palette[shown.color], variant: resting ? 'solid' : 'wavy' }] : []), [at, shown, layout, resting])

  /* the list follows the code: scroll the row into view inside the list (not the page) */
  const reveal = useCallback((i: number) => {
    const el = graph.current?.element; if (!el || !el.clientHeight) return
    const h = el.querySelector<HTMLElement>('[role=row]')?.offsetHeight || 32, top = i * h
    if (top < el.scrollTop) el.scrollTop = top
    else if (top + h > el.scrollTop + el.clientHeight) el.scrollTop = top + h - el.clientHeight
  }, [])
  const codeRow = hot?.from === 'code' ? hotRow : -1
  useLayoutEffect(() => { if (codeRow >= 0) reveal(codeRow) }, [codeRow, reveal])

  const onHoverChange = useCallback((id: string | null) => setHot(h => (id ? { id, from: 'row' } : h?.from === 'row' ? null : h)), [])
  const nodeAt = (t: CodeTokenRange) => astNodeAt(root, t.start, t.end)
  const onTokenHover = (t: CodeTokenRange | null) => { const n = t && nodeAt(t); setHot(h => (n ? { id: n.id, from: 'code' } : h?.from === 'code' ? null : h)) }
  const onTokenClick = (t: CodeTokenRange) => {
    const n = nodeAt(t), i = n ? layout.rowOf(n.id) : -1; if (!n || i < 0) return
    setActive(i); setSelected(n.id); reveal(i)
  }

  const renderRow = useCallback((row: LaneRow<AstLaneNode>, state: LaneRowState) => {
    const n = row.node.ast, slice = source.slice(n.start, n.end).replace(/\s+/g, ' ')
    return (
      <div data-lit={state.lit || undefined} className="flex h-full min-w-0 items-center gap-2 pe-3 font-[family-name:var(--mono)] text-xs">
        <span className={cn('flex-none', AST_KIND_CLASS[n.kind] ?? 'text-[var(--fg)]')}>{n.kind}</span>
        {n.label && <Badge size="sm" className="flex-none font-[family-name:var(--mono)]">{n.label}</Badge>}
        {n.children.length > 0 && <span dir="ltr" className="min-w-0 truncate text-[var(--fg3)]">{slice}</span>}
      </div>
    )
  }, [source])
  // the row the code points at looks hovered too (its :hover background can't be set from outside)
  const rowClassName = useCallback((row: LaneRow<AstLaneNode>, state: LaneRowState) => (row.index === codeRow && !state.selected ? '!bg-[var(--muted)]' : undefined), [codeRow])
  return (
    <div className="grid min-w-0 gap-3 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <div className="min-w-0" onFocus={() => setFocused(true)} onBlur={e => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setFocused(false) }}>
        <LaneGraph ref={graph} nodes={layout} height={height} aria-label="Syntax tree" active={active} onActiveChange={setActive}
          selected={selected} onSelect={id => setSelected(id)} hovered={hot?.id ?? null} onHoverChange={onHoverChange} renderRow={renderRow} rowClassName={rowClassName}
          className="rounded-[var(--r-md)] border border-[var(--line)]" />
      </div>
      <div className="flex min-w-0 flex-col gap-2">
        <CodeBlock code={source} filename="discount.ts" marks={marks} onTokenHover={onTokenHover} onTokenClick={onTokenClick} defaultWrap />
        <p className="m-0 min-h-[1.5em] text-xs text-[var(--fg2)]">
          {at
            ? <><span className="font-medium text-[var(--fg)]">{at.kind}</span> · characters {at.start}–{at.end}{at.label ? ` · ${at.label}` : ''}</>
            : 'Hover a row or a word in the code to link them; click a word to select its node.'}
        </p>
      </div>
    </div>
  )
}

/* ── agent run ─────────────────────────────────────────────────────────────── */

/** One step of an agent run: `after` lists the steps it waited for (fan-in when several), `ms` how long it took. */
export type AgentRunStep = { id: string; name: string; tool?: string; status: StatusIconStatus; ms?: number; after: readonly string[]; note?: string }

/** A run that plans, fans out to three tools, joins, writes code and tests, fails a test, fixes it and opens a PR. */
export const AGENT_RUN_SAMPLE: AgentRunStep[] = [
  { id: 'plan', name: 'Plan the change', status: 'done', ms: 2100, after: [] },
  { id: 'web', name: 'Search the docs', tool: 'web.search', status: 'done', ms: 3400, after: ['plan'] },
  { id: 'repo', name: 'Read the codebase', tool: 'repo.grep', status: 'done', ms: 5200, after: ['plan'] },
  { id: 'db', name: 'Check the schema', tool: 'db.describe', status: 'done', ms: 900, after: ['plan'] },
  { id: 'join', name: 'Combine findings', status: 'done', ms: 1800, after: ['repo', 'web', 'db'] },
  { id: 'code', name: 'Write the migration', tool: 'fs.write', status: 'done', ms: 7300, after: ['join'] },
  { id: 'tests', name: 'Write tests', tool: 'fs.write', status: 'done', ms: 4100, after: ['join'] },
  { id: 'run1', name: 'Run tests', tool: 'shell', status: 'failed', ms: 12600, after: ['code', 'tests'], note: '2 failing' },
  { id: 'fix', name: 'Fix the null check', tool: 'fs.edit', status: 'done', ms: 2600, after: ['run1'] },
  { id: 'run2', name: 'Run tests again', tool: 'shell', status: 'done', ms: 11900, after: ['fix'], note: '48 passed' },
  { id: 'review', name: 'Review the diff', status: 'active', after: ['run2'] },
  { id: 'pr', name: 'Open a pull request', tool: 'github.pr', status: 'pending', after: ['review'] },
]

/** Agent steps as lane nodes, in run order (each after the steps it waited for). */
export const agentRunNodes = (steps: readonly AgentRunStep[]) => steps.map(s => ({ id: s.id, parents: s.after, step: s }))

/** The agent run example: steps with fan-out and fan-in, statuses and durations. */
export function AgentRunExample({ steps = AGENT_RUN_SAMPLE, height = 420 }: { steps?: readonly AgentRunStep[]; height?: number }) {
  const { fmt } = useLocale()
  const nodes = useMemo(() => agentRunNodes(steps), [steps])
  const renderRow = useCallback((row: LaneRow<(typeof nodes)[number]>) => {
    const s = row.node.step
    return (
      <div className="flex h-full min-w-0 items-center gap-2 pe-3 text-[13px]">
        <StatusIcon status={s.status} size={16} className="flex-none" />
        {/* the name keeps its room; on phones only the outcome note stays beside it */}
        <span className={cn('min-w-[9ch] truncate', s.status === 'pending' ? 'text-[var(--fg3)]' : 'text-[var(--fg)]')}>{s.name}</span>
        {row.parents.length > 1 && <Badge size="sm" className="flex-none max-sm:hidden">waits for {row.parents.length}</Badge>}
        {s.tool && <Badge size="sm" className="flex-none font-[family-name:var(--mono)] max-sm:hidden">{s.tool}</Badge>}
        {s.note && <Badge size="sm" tone={s.status === 'failed' ? 'bad' : 'ok'} className="flex-none">{s.note}</Badge>}
        <span className="flex-1" />
        <span className="ui-num flex-none text-xs text-[var(--fg3)]">{s.ms != null ? `${fmt.number(s.ms / 1000, { maximumFractionDigits: 1 })} s` : s.status === 'active' ? 'running' : '—'}</span>
      </div>
    )
  }, [fmt])
  return <LaneGraph nodes={nodes} order="input" direction="up" height={height} aria-label="Agent run" renderRow={renderRow} className="rounded-[var(--r-md)] border border-[var(--line)]" />
}

/* ── dependencies ──────────────────────────────────────────────────────────── */

/** A package and the packages it depends on (by name). `size`: unpacked bytes. */
export type DependencyPackage = { name: string; version: string; size: number; deps: readonly string[] }

/** A small app's dependency tree: react is needed by four packages, motion's helpers by two (diamonds). */
export const DEPENDENCY_SAMPLE: DependencyPackage[] = [
  { name: 'my-app', version: '1.4.0', size: 182_000, deps: ['@lyndon/ui', 'react-dom', 'react', 'zod', 'date-fns'] },
  { name: '@lyndon/ui', version: '0.8.0', size: 2_410_000, deps: ['react', 'react-dom', 'motion'] },
  { name: 'motion', version: '14.10.1', size: 1_120_000, deps: ['framer-motion', 'tslib'] },
  { name: 'framer-motion', version: '14.10.1', size: 2_980_000, deps: ['motion-dom', 'motion-utils', 'tslib', 'react'] },
  { name: 'motion-dom', version: '14.10.0', size: 612_000, deps: ['motion-utils'] },
  { name: 'motion-utils', version: '14.9.0', size: 96_000, deps: [] },
  { name: 'react-dom', version: '19.3.1', size: 6_840_000, deps: ['react', 'scheduler'] },
  { name: 'scheduler', version: '0.27.0', size: 92_000, deps: [] },
  { name: 'react', version: '19.3.1', size: 218_000, deps: [] },
  { name: 'zod', version: '4.2.0', size: 4_100_000, deps: [] },
  { name: 'date-fns', version: '4.1.0', size: 22_500_000, deps: [] },
  { name: 'tslib', version: '2.8.1', size: 52_000, deps: [] },
]

/** Packages as lane nodes: a package's parents are its dependencies, so dependents sit above what they use. */
export const dependencyNodes = (packages: readonly DependencyPackage[]) => packages.map(p => ({ id: p.name, parents: p.deps, pkg: p }))

/** The dependency example: name@version, size and how many packages use each one. */
export function DependencyGraphExample({ packages = DEPENDENCY_SAMPLE, height = 420 }: { packages?: readonly DependencyPackage[]; height?: number }) {
  const { fmt } = useLocale()
  const nodes = useMemo(() => dependencyNodes(packages), [packages])
  const renderRow = useCallback((row: LaneRow<(typeof nodes)[number]>) => {
    const p = row.node.pkg
    return (
      <div className="flex h-full min-w-0 items-center gap-2 pe-3 text-[13px]">
        <span dir="ltr" className="min-w-0 truncate font-[family-name:var(--mono)] text-xs"><span className="text-[var(--fg)]">{p.name}</span><span className="text-[var(--fg3)]">@{p.version}</span></span>
        {row.children.length > 1 && <Badge size="sm" tone="accent">used by {row.children.length}</Badge>}
        <span className="flex-1" />
        <span className="ui-num flex-none text-xs text-[var(--fg3)]">{fmt.bytes(p.size)}</span>
      </div>
    )
  }, [fmt])
  return <LaneGraph nodes={nodes} order="topo" height={height} aria-label="Dependencies" renderRow={renderRow} className="rounded-[var(--r-md)] border border-[var(--line)]" />
}
