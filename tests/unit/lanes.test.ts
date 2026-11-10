// Lane graphs: the generic layout (order, lanes, edges, colours, pins, direction, cycles), the gutter at fixed and
// stretched heights, and LaneGraph's interactions (selection, keys along edges, context menu, variable-height rows).
// The git-specific layout tests stay in gitgraph.test.tsx; these are their generic counterparts.
import { createElement as h } from 'react'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { LaneGraph, LaneGutter, laneAncestry, laneColor, layoutLanes, type LaneLayout, type LaneNode } from '../../src/lib/lanes'
import { UIProvider } from '../../src/lib/provider'
import { GIT_SAMPLE, gitHistory } from '../../src/examples/git'
import { AGENT_RUN_SAMPLE, CHAT_TREE_SAMPLE, DEPENDENCY_SAMPLE, agentRunNodes, astLaneNodes, chatBranchGraph, dependencyNodes, parseAst, AST_SAMPLE } from '../../src/examples/graphs'

/** A node: `id`, its parents, a time in days. */
const n = (id: string, parents: string[], time: number, extra: Partial<LaneNode> = {}): LaneNode => ({ id, parents, time, ...extra })
const at = (L: LaneLayout, id: string) => L.rows[L.rowOf(id)]
const ids = (L: LaneLayout) => L.rows.map(r => r.node.id)

/** Every row's top strokes leave from exactly the lanes the row above continues at its bottom (no line starts or stops mid-air). */
function expectContinuous(L: LaneLayout) {
  let below = new Set<number>()
  for (const r of L.rows) {
    const top = new Set<number>(), bottom = new Set<number>()
    for (const e of r.edges) {
      if (e.half === 'full') { top.add(e.fromLane); bottom.add(e.toLane) }
      else if (e.half === 'top') { expect(e.toLane).toBe(r.lane); if (e.kind !== 'missing') top.add(e.fromLane) }
      else { expect(e.fromLane).toBe(r.lane); if (e.kind !== 'missing') bottom.add(e.toLane) }
    }
    expect([...top].sort()).toEqual([...below].sort())
    below = bottom
  }
  expect(below.size).toBe(0)
}
/** Parents below their children ('down') or above them ('up'). */
function expectTopological(L: LaneLayout) {
  for (const r of L.rows) for (const p of r.parents) if (p >= 0) expect(L.direction === 'down' ? p > r.index : p < r.index).toBe(true)
}
/** The git sample as plain lane nodes: a branch ref is the node's group. */
const SAMPLE: LaneNode[] = GIT_SAMPLE.map(c => ({ id: c.hash, parents: c.parents, time: +c.date, group: c.refs?.find(r => r.type === 'branch' || r.type === 'head')?.name }))

describe('layoutLanes', () => {
  it('lays out a chain in one lane', () => {
    const L = layoutLanes([n('a', [], 0), n('b', ['a'], 1), n('c', ['b'], 2)])
    expect(ids(L)).toEqual(['c', 'b', 'a'])
    expect(L.rows.map(r => r.lane)).toEqual([0, 0, 0])
    expect(L.laneCount).toBe(1)
    expect(L.rows[0].edges).toEqual([{ fromLane: 0, toLane: 0, kind: 'pass', half: 'bottom', color: L.rows[0].color, firstParent: true, child: 0, parent: 1 }])
    expect(L.rows[2].edges.map(e => e.half)).toEqual(['top']) // the root ends its lane
    expect(L.rows[1].children).toEqual([0])
    expectContinuous(L)
  })

  it('draws a fork and a merge', () => {
    const L = layoutLanes([n('a', [], 0), n('b', ['a'], 1), n('f', ['a'], 2), n('m', ['b', 'f'], 3)])
    expect(L.rows.map(r => [r.node.id, r.lane])).toEqual([['m', 0], ['f', 1], ['b', 0], ['a', 0]])
    expect(at(L, 'm').edges).toContainEqual(expect.objectContaining({ half: 'bottom', fromLane: 0, toLane: 1, kind: 'merge', firstParent: false }))
    expect(at(L, 'a').edges).toContainEqual(expect.objectContaining({ half: 'top', fromLane: 1, toLane: 0, kind: 'fork' }))
    expect([...at(L, 'a').children].sort()).toEqual([1, 2])
    expectContinuous(L)
  })

  it('opens a lane per extra parent of an octopus merge', () => {
    const L = layoutLanes([n('a', [], 0), n('p1', ['a'], 1), n('p2', ['a'], 2), n('p3', ['a'], 3), n('m', ['a', 'p1', 'p2', 'p3'], 4)])
    expect(L.rows[0].edges.filter(e => e.kind === 'merge').map(e => e.toLane)).toEqual([1, 2, 3])
    expect(L.laneCount).toBe(4)
    expectContinuous(L)
  })

  it('handles criss-cross merges and reuses freed lanes', () => {
    const cross = layoutLanes([n('a', [], 0), n('b1', ['a'], 1), n('c1', ['a'], 2), n('b2', ['b1', 'c1'], 3), n('c2', ['c1', 'b1'], 4)])
    expectContinuous(cross); expectTopological(cross)
    expect(cross.laneCount).toBeLessThanOrEqual(3)
    const reuse = layoutLanes([n('a', [], 0), n('f1', ['a'], 1), n('c', ['a'], 2), n('m1', ['c', 'f1'], 3), n('e', ['m1'], 4), n('f2', ['e'], 5), n('m2', ['e', 'f2'], 6)])
    expect(at(reuse, 'f1').lane).toBe(1)
    expect(at(reuse, 'f2').lane).toBe(1)
    expect(reuse.laneCount).toBe(2)
  })

  it('ends parents that are not in the list with a stub', () => {
    const L = layoutLanes([n('b', ['gone'], 1), n('m', ['b', 'also-gone'], 2)])
    expect(at(L, 'b').edges).toContainEqual(expect.objectContaining({ half: 'bottom', kind: 'missing', parent: -1, firstParent: true }))
    expect(at(L, 'm').edges).toContainEqual(expect.objectContaining({ half: 'bottom', kind: 'missing', parent: -1, firstParent: false }))
    expect(at(L, 'b').parents).toEqual([-1])
    expectContinuous(L)
  })

  it('survives cycles and repeated ids: every node is placed once, back links become stubs', () => {
    const L = layoutLanes([n('a', ['c'], 0), n('b', ['a'], 1), n('c', ['b'], 2), n('a', [], 9), n('d', ['d', 'a', 'a'], 3)])
    expect(ids(L).sort()).toEqual(['a', 'b', 'c', 'd'])
    expect(at(L, 'd').parents).toEqual([L.rowOf('a')]) // self-link and the repeat dropped
    expectContinuous(L)
    expect(L.rows.flatMap(r => r.edges).some(e => e.kind === 'missing')).toBe(true)
  })

  it('does not depend on the input order (time and topo)', () => {
    const shuffled = [...SAMPLE].sort((x, y) => (x.id.slice(9, 14) < y.id.slice(9, 14) ? -1 : 1))
    for (const order of ['time', 'topo'] as const) {
      const sig = (L: LaneLayout) => L.rows.map(r => `${r.node.id}:${r.lane}:${r.color}`).join()
      expect(sig(layoutLanes(shuffled, { order, pin: ['main', 'develop'] }))).toBe(sig(layoutLanes(SAMPLE, { order, pin: ['main', 'develop'] })))
    }
  })

  it('keeps the sample continuous and topological, and pins groups to the leftmost lanes', () => {
    for (const order of ['time', 'topo'] as const) {
      const L = layoutLanes(SAMPLE, { order, pin: ['main', 'develop'] })
      expectContinuous(L); expectTopological(L)
      const main = L.rows.find(r => r.node.group === 'main')!, develop = L.rows.find(r => r.node.group === 'develop')!
      expect(main.lane).toBe(0); expect(develop.lane).toBe(1)
      for (let r = main.index; r >= 0; r = L.rows[r].parents[0] ?? -1) expect(L.rows[r].lane).toBe(0) // main's first-parent line
      expect(main.color).toBe(0); expect(develop.color).toBe(1) // pinned groups take the first colours
    }
  })

  it('pinStart says where a pinned line starts', () => {
    const nodes = [n('a', [], 0), n('b', ['a'], 1), n('x', ['a'], 2), n('y', ['x'], 3)]
    expect(at(layoutLanes(nodes), 'b').lane).toBe(1) // y (newest) is the tip in lane 0
    const L = layoutLanes(nodes, { pin: ['mine'], pinStart: () => 'b' })
    expect(at(L, 'b').lane).toBe(0); expect(at(L, 'a').lane).toBe(0); expect(at(L, 'y').lane).toBe(1)
  })

  it('topo keeps a branch together; time interleaves', () => {
    const nodes = [n('a', [], 0), n('x1', ['a'], 1), n('y1', ['a'], 2), n('x2', ['x1'], 3), n('y2', ['y1'], 4)]
    expect(ids(layoutLanes(nodes, { order: 'time' }))).toEqual(['y2', 'x2', 'y1', 'x1', 'a'])
    expect(ids(layoutLanes(nodes, { order: 'topo' }))).toEqual(['y2', 'y1', 'x2', 'x1', 'a'])
  })

  it("keeps the input order with order: 'input', moving only a parent listed after its child", () => {
    const chat = [n('q', [], 0), n('a', ['q'], 0), n('q2', ['a'], 0), n('alt', ['q'], 0), n('a2', ['q2'], 0)].map(({ time, ...x }) => x)
    expect(ids(layoutLanes(chat, { order: 'input', direction: 'up' }))).toEqual(['q', 'a', 'q2', 'alt', 'a2'])
    expect(ids(layoutLanes([...chat].reverse(), { order: 'input' }))).toEqual(['a2', 'alt', 'q2', 'a', 'q'])
    expect(ids(layoutLanes([n('child', ['parent'], 0), n('parent', [], 0)].reverse(), { order: 'input', direction: 'up' }))).toEqual(['parent', 'child'])
    expect(layoutLanes([n('x', [], 0)].map(({ time, ...x }) => x)).rows).toHaveLength(1) // no times: 'input' by default
  })

  it("direction 'up' is the same layout upside down: rows reversed, halves and ends swapped", () => {
    const nodes = [n('a', [], 0), n('b', ['a'], 1), n('f', ['a'], 2), n('m', ['b', 'f'], 3)]
    const down = layoutLanes(nodes), up = layoutLanes(nodes, { direction: 'up' })
    expect(ids(up)).toEqual([...ids(down)].reverse())
    expect(up.rows.map(r => r.lane)).toEqual(down.rows.map(r => r.lane).reverse())
    expect(at(up, 'm').edges).toContainEqual(expect.objectContaining({ half: 'top', fromLane: 1, toLane: 0, kind: 'merge' }))
    expect(at(up, 'a').edges).toContainEqual(expect.objectContaining({ half: 'bottom', fromLane: 0, toLane: 1, kind: 'fork' }))
    expect(at(up, 'a').children.map(c => up.rows[c].node.id).sort()).toEqual(['b', 'f'])
    expectContinuous(up); expectTopological(up)
  })

  it('gives groups stable colours: a new node on top does not reshuffle them', () => {
    expect(laneColor('main', ['main'])).toBe(0)
    expect(laneColor('feature/x', ['main'])).toBe(laneColor('feature/x', ['main']))
    expect(laneColor('feature/x', ['main', 'develop'])).toBeGreaterThanOrEqual(2)
    const before = layoutLanes(SAMPLE, { pin: ['main', 'develop'] })
    const head = GIT_SAMPLE.find(c => c.refs?.some(r => r.type === 'head'))!
    const after = layoutLanes([n('new1', [head.hash], 1e15, { group: 'feature/commit-graph' }), ...SAMPLE.map(x => (x.id === head.hash ? { ...x, group: undefined } : x))], { pin: ['main', 'develop'] })
    for (const r of before.rows) expect(at(after, r.node.id).color).toBe(r.color)
  })

  it('names lanes opened for a merge with laneGroup, and colours with an explicit color()', () => {
    const nodes = [n('a', [], 0), n('f', ['a'], 1), n('m', ['a', 'f'], 2)]
    const L = layoutLanes(nodes, { laneGroup: () => 'feature/login', color: g => (g === 'feature/login' ? 5 : 2) })
    expect(at(L, 'f').color).toBe(5)
    expect(at(L, 'm').color).toBe(2)
  })

  it('marks a first-parent ancestry', () => {
    const L = layoutLanes([n('a', [], 0), n('b', ['a'], 1), n('f', ['a'], 2), n('m', ['b', 'f'], 3)])
    expect(L.rows.filter(r => laneAncestry(L, L.rowOf('m'))[r.index]).map(r => r.node.id).sort()).toEqual(['a', 'b', 'm'])
  })

  it('lays out 50k nodes quickly', () => {
    const nodes = gitHistory(50_000).map(c => ({ id: c.hash, parents: c.parents, time: +c.date }))
    const t = performance.now()
    const L = layoutLanes(nodes, { order: 'time' })
    expect(L.rows.length).toBe(nodes.length)
    expect(performance.now() - t).toBeLessThan(2000) // ~50 ms in Node; jsdom and CI machines are slower
    expectTopological(L)
  })
})

describe('LaneGutter', () => {
  const L = layoutLanes([n('a', [], 0), n('b', ['a'], 1), n('f', ['a'], 2), n('m', ['b', 'f'], 3)])

  it('draws a fixed-height slice: strokes end at the row height', () => {
    const { container } = render(h('div', null, h(LaneGutter, { row: L.rows[1], rowHeight: 40 })))
    const svg = container.querySelector('svg')!
    expect(svg.getAttribute('height')).toBe('40')
    expect([...svg.querySelectorAll('line')].map(l => l.getAttribute('y2'))).toContain('40')
    expect(svg.querySelector('circle')!.getAttribute('cy')).toBe('20')
  })

  it('stretches to a tall row: lines run to 100% and the node sits at nodeY', () => {
    const { container } = render(h('div', { style: { height: 300 } }, h(LaneGutter, { row: L.rows[1], nodeY: 18 })))
    const svg = container.querySelector('svg')!
    expect(svg.getAttribute('height')).toBe('100%')
    expect(svg.parentElement!.style.minHeight).toBe('36px') // the box the SVG covers, so it never props the row open
    expect([...svg.querySelectorAll('line')].map(l => l.getAttribute('y2'))).toContain('100%')
    expect(svg.querySelector('circle')!.getAttribute('cy')).toBe('18')
  })

  it('draws a merge node hollow and dims rows off the highlighted line', () => {
    const marks = laneAncestry(L, L.rowOf('f'))
    const { container } = render(h('div', null, h(LaneGutter, { row: L.rows[0], rowHeight: 32, highlight: marks })))
    const node = container.querySelector('circle')!
    expect(node.getAttribute('fill')).toBe('var(--card)')
    expect(node.parentElement!.getAttribute('opacity')).toBe('0.35')
  })
})

describe('LaneGutter rows join up', () => {
  // Regression (0.8 review): strokes were de-duplicated by colour and path, and a lane passing by (or the line below a
  // node) has no path of its own, only a tail line, so all but one same-coloured tail per row vanished and lanes
  // showed as dashes. Rendered row by row, every lane that leaves the bottom of row i must enter the top of row i + 1.
  /** x of every stroke touching each row's top edge and its bottom edge, from the rendered SVG of consecutive rows. */
  function ends(L: LaneLayout, rowHeight?: number) {
    const { container, unmount } = render(h('div', null, L.rows.map(r => h('div', { key: r.node.id, style: { height: 40 } }, h(LaneGutter, { row: r, rowHeight, laneCount: L.laneCount, nodeY: rowHeight ? undefined : 14 })))))
    const bottom = String(rowHeight ?? '100%')
    const out = [...container.querySelectorAll('svg')].map(svg => {
      const top = new Set<number>(), below = new Set<number>()
      for (const l of svg.querySelectorAll('line')) {
        const x = Number(l.getAttribute('x1'))
        if (l.getAttribute('y1') === '0') top.add(x)
        if (l.getAttribute('y2') === bottom) below.add(x)
      }
      for (const p of svg.querySelectorAll('path')) { const m = /^M([\d.]+) 0[VQH]/.exec(p.getAttribute('d') ?? ''); if (m) top.add(Number(m[1])) }
      return { top: [...top].sort((a, b) => a - b), bottom: [...below].sort((a, b) => a - b) }
    })
    unmount()
    return out
  }
  const graphs: [string, LaneLayout][] = [
    ['git sample', layoutLanes(SAMPLE, { pin: ['main', 'develop'] })],
    ['chat (up)', layoutLanes(chatBranchGraph(CHAT_TREE_SAMPLE, 'a5').nodes, { order: 'input', direction: 'up', pin: ['active'], pinStart: () => 'a5' })],
    ['AST (up)', layoutLanes(astLaneNodes(parseAst(AST_SAMPLE)), { order: 'input', direction: 'up' })],
    ['agent run (up)', layoutLanes(agentRunNodes(AGENT_RUN_SAMPLE), { order: 'input', direction: 'up' })],
    ['dependencies', layoutLanes(dependencyNodes(DEPENDENCY_SAMPLE), { order: 'topo' })],
  ]
  for (const [name, L] of graphs) for (const rowHeight of [32, undefined]) {
    it(`${name}, ${rowHeight ? 'fixed rows' : 'stretched rows'}: every lane leaving a row enters the next`, () => {
      const rows = ends(L, rowHeight)
      for (let i = 0; i + 1 < rows.length; i++) expect(rows[i + 1].top, `${name}: rows ${i} → ${i + 1}`).toEqual(rows[i].bottom)
      expect(rows[0].top).toEqual([]); expect(rows.at(-1)!.bottom).toEqual([]) // nothing runs off the ends
    })
  }
})

describe('LaneGraph', () => {
  const nodes = [
    { id: 'root', parents: [], title: 'Root' }, { id: 'left', parents: ['root'], title: 'Left' },
    { id: 'right', parents: ['root'], title: 'Right' }, { id: 'join', parents: ['left', 'right'], title: 'Join' },
  ]
  const renderRow = (row: { node: { title: string } }) => h('span', null, row.node.title)
  const focused = () => document.activeElement?.textContent ?? ''

  it('renders a row per node with your content, in a grid with one Tab stop', () => {
    render(h(LaneGraph<(typeof nodes)[number]>, { nodes, order: 'input', direction: 'up', renderRow, 'aria-label': 'Plan' }))
    expect(screen.getByRole('grid', { name: 'Plan' })).toHaveAttribute('aria-rowcount', '4')
    expect(screen.getAllByRole('row').map(r => r.textContent)).toEqual(['Root', 'Left', 'Right', 'Join'])
    expect(screen.getAllByRole('row').filter(r => r.tabIndex === 0)).toHaveLength(1)
  })

  it('moves with ↑/↓, Home/End, and along edges with ←/→', () => {
    render(h(LaneGraph<(typeof nodes)[number]>, { nodes, order: 'input', direction: 'up', renderRow }))
    const rows = screen.getAllByRole('row')
    act(() => rows[3].focus())
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowLeft' }) // Join's first parent
    expect(focused()).toBe('Left')
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowLeft' })
    expect(focused()).toBe('Root')
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowRight', shiftKey: true }) // another child
    expect(['Left', 'Right']).toContain(focused())
    fireEvent.keyDown(document.activeElement!, { key: 'End' })
    expect(focused()).toBe('Join')
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowLeft', shiftKey: true }) // the second parent
    expect(focused()).toBe('Right')
    fireEvent.keyDown(document.activeElement!, { key: 'Home' })
    expect(focused()).toBe('Root')
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowDown' })
    expect(focused()).toBe('Left')
  })

  it('selects on click and Enter, clears on Escape, and reports the context menu row', () => {
    const onSelect = vi.fn(), onContextMenu = vi.fn()
    render(h(LaneGraph<(typeof nodes)[number]>, { nodes, order: 'input', renderRow, onSelect, onContextMenu }))
    fireEvent.click(screen.getByRole('row', { name: 'Right' }))
    expect(onSelect).toHaveBeenLastCalledWith('right', expect.objectContaining({ node: nodes[2] }))
    expect(screen.getByRole('row', { name: 'Right' })).toHaveAttribute('aria-selected', 'true')
    fireEvent.keyDown(screen.getByRole('row', { name: 'Right' }), { key: 'Escape' })
    expect(onSelect).toHaveBeenLastCalledWith(null, null)
    fireEvent.contextMenu(screen.getByRole('row', { name: 'Left' }))
    expect(onContextMenu).toHaveBeenCalledWith(expect.objectContaining({ node: nodes[1] }), expect.anything())
  })

  it("renders variable-height rows with rowHeight 'auto'", () => {
    render(h(LaneGraph<(typeof nodes)[number]>, { nodes, order: 'input', direction: 'up', rowHeight: 'auto', anchor: 'end', renderRow: row => h('p', { style: { height: 40 + row.index * 30 } }, row.node.title) }))
    const rows = screen.getAllByRole('row')
    expect(rows).toHaveLength(4)
    expect(rows[0].style.height).toBe('') // sized by its content, measured
    expect(rows[0].querySelector('svg')!.getAttribute('height')).toBe('100%')
  })

  it('keeps the gutter an LTR island in RTL locales', () => {
    render(h(UIProvider, { locale: 'ar-EG', children: h(LaneGraph<(typeof nodes)[number]>, { nodes, order: 'input', renderRow }) }))
    const row = screen.getAllByRole('row')[0]
    expect(row.querySelector('[role=gridcell]')).toHaveAttribute('dir', 'ltr')
    expect(screen.getByRole('grid')).toHaveAccessibleName('المخطط')
  })
})
