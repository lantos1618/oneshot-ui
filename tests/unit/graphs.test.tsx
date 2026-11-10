// The "graphs as rows" examples (src/examples/graphs.tsx): each builder turns its data into lane nodes correctly
// (the AST parser's tree, the dependency diamonds, the chat tree's forks and merge), and the chat example's
// branch switcher, collapse and keys work.
import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { layoutLanes } from '../../src/lib/lanes'
import {
  AGENT_RUN_SAMPLE, AST_SAMPLE, CHAT_TREE_SAMPLE, ChatBranchesExample, DEPENDENCY_SAMPLE, agentRunNodes, astLaneNodes, chatBranchGraph, chatFork, chatLeafOf, chatTreeHistory, dependencyNodes, parseAst,
  type AstNode,
} from '../../src/examples/graphs'

/** A tree as nested [kind label?] arrays, for readable expectations. */
const shape = (n: AstNode): unknown => [n.label ? `${n.kind} ${n.label}` : n.kind, ...n.children.map(shape)]

describe('parseAst', () => {
  it('builds the syntax tree with precedence, calls, members and arrows', () => {
    expect(shape(parseAst('const t = a.b(x => x + 1, 2) * 3'))).toEqual(
      ['Program', ['VariableDeclaration const t', ['Identifier t'],
        ['BinaryExpression *',
          ['CallExpression', ['MemberExpression .b', ['Identifier a'], ['Identifier b']],
            ['ArrowFunction', ['Identifier x'], ['BinaryExpression +', ['Identifier x'], ['NumericLiteral 1']]], ['NumericLiteral 2']],
          ['NumericLiteral 3']]]])
    expect(shape(parseAst('if (a > 1 + 2) f("s")'))).toEqual(
      ['Program', ['IfStatement', ['BinaryExpression >', ['Identifier a'], ['BinaryExpression +', ['NumericLiteral 1'], ['NumericLiteral 2']]],
        ['ExpressionStatement', ['CallExpression', ['Identifier f'], ['StringLiteral "s"']]]]])
  })

  it('records source spans and parses the sample', () => {
    const root = parseAst(AST_SAMPLE)
    expect(root.children.map(c => c.kind)).toEqual(['VariableDeclaration', 'VariableDeclaration', 'IfStatement'])
    const ternary = root.children[1].children[1]
    expect(ternary.kind).toBe('ConditionalExpression')
    expect(AST_SAMPLE.slice(ternary.start, ternary.end)).toBe('total > 100 ? total * 0.1 : 0')
    expect(() => parseAst('const = 1')).toThrow(SyntaxError)
  })

  it('becomes lane nodes in source order, each under the node containing it', () => {
    const nodes = astLaneNodes(parseAst('f(a, b)'))
    expect(nodes.map(x => [x.ast.kind, x.depth])).toEqual([['Program', 0], ['ExpressionStatement', 1], ['CallExpression', 2], ['Identifier', 3], ['Identifier', 3], ['Identifier', 3]])
    const L = layoutLanes(nodes, { order: 'input', direction: 'up' })
    expect(L.rows.map(r => r.node.id)).toEqual(nodes.map(x => x.id)) // a tree in source order is already topological
    expect(L.rows[2].children).toHaveLength(3) // the call forks to its callee and both arguments
  })
})

describe('dependencyNodes', () => {
  it('draws shared dependencies as merges: react is reached from four packages', () => {
    const L = layoutLanes(dependencyNodes(DEPENDENCY_SAMPLE), { order: 'topo' })
    const react = L.rows[L.rowOf('react')], app = L.rows[L.rowOf('my-app')]
    expect(react.children.map(c => L.rows[c].node.id).sort()).toEqual(['@lyndon/ui', 'framer-motion', 'my-app', 'react-dom'])
    expect(app.index).toBe(0) // the app is the only package nothing depends on
    expect(L.rows.at(-1)!.node.parents).toEqual([]) // a leaf package last
    expect(app.edges.filter(e => e.kind === 'merge').length).toBeGreaterThan(0)
    expect(react.edges.filter(e => e.half === 'top' && e.kind !== 'pass').length).toBeGreaterThan(0) // lanes ending in react
  })
})

describe('agentRunNodes', () => {
  it('fans out from the plan and back in at "Combine findings"', () => {
    const L = layoutLanes(agentRunNodes(AGENT_RUN_SAMPLE), { order: 'input', direction: 'up' })
    expect(L.rows[L.rowOf('plan')].children).toHaveLength(3)
    expect(L.rows[L.rowOf('join')].parents).toHaveLength(3)
    expect(L.rows.map(r => r.node.id)).toEqual(AGENT_RUN_SAMPLE.map(s => s.id))
  })
})

describe('chatBranchGraph', () => {
  it('finds the forks, the merge and the active thread', () => {
    const { nodes, active, children } = chatBranchGraph(CHAT_TREE_SAMPLE, 'a5')
    expect([...children].filter(([, k]) => k.length > 1).map(([id]) => id).sort()).toEqual(['a1', 'a3', 'u2b'])
    expect(nodes.find(x => x.id === 'u5')!.parents).toEqual(['a3', 'a2b'])
    expect([...active].sort()).toEqual(['a1', 'a2', 'a2b', 'a3', 'a5', 'u1', 'u2', 'u2b', 'u3', 'u5']) // both sides of the merge
    expect(nodes.find(x => x.id === 'a2c')!.siblings).toEqual(['a2b', 'a2c'])
    expect(nodes.find(x => x.id === 'a2c')!.group).toBe('branch:a2c') // a new branch starts a new colour
  })

  it('pins the active thread to lane 0', () => {
    const { nodes } = chatBranchGraph(CHAT_TREE_SAMPLE, 'a4')
    const L = layoutLanes(nodes, { order: 'input', direction: 'up', pin: ['active'], pinStart: () => 'a4' })
    for (const id of ['u1', 'a1', 'u2', 'a2', 'u3', 'a3', 'u4', 'a4']) expect(L.rows[L.rowOf(id)].lane).toBe(0)
    expect(L.rows[L.rowOf('u2b')].lane).toBeGreaterThan(0)
  })

  it('forks on edit and regenerate, and continues a branch at its newest leaf', () => {
    const edited = chatFork(CHAT_TREE_SAMPLE, 'u3', { id: 'u3b', role: 'user', parts: [{ type: 'text', text: 'And if it is sunny?' }] })
    expect(edited.at(-1)).toMatchObject({ id: 'u3b', parentId: 'a2' })
    const regen = chatFork(edited, 'u5', { id: 'u5b', role: 'user', parts: [] })
    expect(regen.at(-1)).toMatchObject({ parents: ['a3', 'a2b'] }) // a sibling of a merge keeps both parents
    const { children } = chatBranchGraph(regen, null)
    expect(children.get('a2')).toEqual(['u3', 'u3b'])
    expect(chatLeafOf('a1', children)).toBe('a2c') // the newest child each time: u2b, then its regenerated answer
    expect(chatLeafOf('a2', children)).toBe('u3b')
    expect(chatLeafOf('a3', children)).toBe('u5b')
  })
})

describe('chatTreeHistory', () => {
  it('builds a long branching conversation whose last message is on the thread', () => {
    const msgs = chatTreeHistory(2000), seen = new Set<string>()
    expect(msgs.length).toBeGreaterThanOrEqual(2000)
    for (const m of msgs) { for (const p of m.parents ?? (m.parentId ? [m.parentId] : [])) expect(seen.has(p)).toBe(true); seen.add(m.id) }
    const { nodes, children } = chatBranchGraph(msgs, msgs.at(-1)!.id)
    expect(chatLeafOf('q0', children)).toBe(msgs.at(-1)!.id)
    const L = layoutLanes(nodes, { order: 'input', direction: 'up', pin: ['active'], pinStart: () => msgs.at(-1)!.id })
    expect(L.rows.at(-1)!.lane).toBe(0)
    expect(L.laneCount).toBeLessThanOrEqual(3) // dead-end forks close again
  })
})

describe('ChatBranchesExample', () => {
  const rowOf = (text: RegExp) => screen.getAllByRole('row').find(r => text.test(r.textContent ?? ''))!

  it('renders every message as a row and switches branches with ‹ n / m ›', () => {
    render(<ChatBranchesExample />)
    expect(screen.getByRole('grid', { name: 'Conversation branches' })).toHaveAttribute('aria-rowcount', String(CHAT_TREE_SAMPLE.length))
    const museums = rowOf(/A lighter museum day/)
    expect(within(museums).getByText('2 / 2')).toBeInTheDocument()
    fireEvent.click(within(museums).getByRole('button', { name: 'Previous branch' }))
    // the active thread now ends where that branch's newest leaf is: the combining answer is the selected row again
    expect(rowOf(/Combined day 2/)).toHaveAttribute('aria-selected', 'true')
  })

  it('forks a new branch on regenerate and collapses the others to one line', () => {
    render(<ChatBranchesExample />)
    const grid = screen.getByRole('grid')
    fireEvent.click(within(rowOf(/I can’t book it/)).getByRole('button', { name: 'Regenerate (new branch)' }))
    expect(grid).toHaveAttribute('aria-rowcount', String(CHAT_TREE_SAMPLE.length + 1)) // virtualised: count the rows, not the rendered ones
    expect(rowOf(/Another take/)).toHaveAttribute('aria-selected', 'true')
    fireEvent.click(screen.getByRole('switch', { name: 'Collapse other branches' }))
    expect(within(rowOf(/Combined day 2/)).queryByRole('button', { name: 'Regenerate (new branch)' })).toBeNull() // off the thread: one line
  })

  it('moves along the tree with the keyboard and continues a branch with Enter', () => {
    render(<ChatBranchesExample />)
    const fado = rowOf(/Can you book a fado show/)
    act(() => fado.focus())
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowRight' }) // its answer
    expect(document.activeElement?.textContent).toMatch(/I can’t book it/)
    fireEvent.keyDown(document.activeElement!, { key: 'Enter' })
    expect(rowOf(/I can’t book it/)).toHaveAttribute('aria-selected', 'true')
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowLeft' }) // its question
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowLeft' }) // the answer it followed
    expect(document.activeElement?.textContent).toMatch(/Rain plan/)
  })
})
