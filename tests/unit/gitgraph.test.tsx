// Git graph: the layout adapter over layoutLanes (edges, refs, colours), the log parser, history filters and ranges, then
// the component: accessible names, keyboard navigation (rows, parents, children), selection, compare, the actions menu,
// search and virtualisation.
import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { GitGraph, filterGitHistory, gitFirstParentPath, gitLaneColor, gitRange, layoutGitGraph, parseGitLog, type GitCommit, type GitGraphLayout } from '../../src/lib/gitgraph'
import { GIT_SAMPLE, gitHistory } from '../../src/examples/git'

const DAY = 86400e3, T0 = Date.UTC(2026, 0, 1)
/** A commit: `hash`, its parents, a date in days since T0. */
const c = (hash: string, parents: string[], day: number, extra: Partial<GitCommit> = {}): GitCommit =>
  ({ hash, parents, subject: `commit ${hash}`, author: { name: 'Ana' }, date: T0 + day * DAY, ...extra })
const byHash = (L: GitGraphLayout, h: string) => L.rows[L.rowOf.get(h)!]

/** Every row's top edge lanes are exactly the lanes the row above leaves at its bottom (no line starts or stops mid-air). */
function expectContinuous(L: GitGraphLayout) {
  let below = new Set<number>()
  for (const r of L.rows) {
    const top = new Set<number>(), bottom = new Set<number>()
    for (const e of r.edges) {
      if (e.part === 'through') { top.add(e.fromLane); bottom.add(e.toLane) }
      else if (e.part === 'top') { expect(e.toLane).toBe(r.lane); if (!e.missing) top.add(e.fromLane) }
      else { expect(e.fromLane).toBe(r.lane); if (!e.missing) bottom.add(e.toLane) }
    }
    expect([...top].sort()).toEqual([...below].sort())
    below = bottom
  }
  expect(below.size).toBe(0)
}
/** Children come before parents. */
function expectTopological(L: GitGraphLayout) {
  for (const r of L.rows) for (const p of r.parents) if (p >= 0) expect(p).toBeGreaterThan(r.index)
}

// layoutGitGraph is layoutLanes (tested in lanes.test.ts) behind an adapter: these check the git view of its rows
// (type/part/missing edges, rowOf as a Map, commits) and the git-only options (pinned refs, branch colours, merge names).
describe('layoutGitGraph', () => {
  it('lays out a linear history in one lane', () => {
    const L = layoutGitGraph([c('a', [], 0), c('b', ['a'], 1), c('c', ['b'], 2)])
    expect(L.rows.map(r => r.commit.hash)).toEqual(['c', 'b', 'a'])
    expect(L.rows.map(r => r.lane)).toEqual([0, 0, 0])
    expect(L.laneCount).toBe(1)
    expect(L.rows[0].edges).toEqual([{ fromLane: 0, toLane: 0, type: 'straight', part: 'bottom', color: L.rows[0].color, child: 0, parent: 1, firstParent: true }])
    expect(L.rows[2].edges.map(e => e.part)).toEqual(['top']) // the root ends its lane
    expect(L.rows[1].children).toEqual([0])
    expect(L.rowOf).toBeInstanceOf(Map)
    expect(Object.fromEntries(L.rowOf)).toEqual({ c: 0, b: 1, a: 2 })
    expectContinuous(L)
  })

  it('draws a fork and a merge: the branch gets a lane, merges back with a merge edge, forks off with a fork edge', () => {
    const L = layoutGitGraph([c('a', [], 0), c('b', ['a'], 1), c('f', ['a'], 2), c('m', ['b', 'f'], 3)])
    expect(L.rows.map(r => [r.commit.hash, r.lane])).toEqual([['m', 0], ['f', 1], ['b', 0], ['a', 0]])
    expect(L.laneCount).toBe(2)
    const m = byHash(L, 'm')
    expect(m.edges).toContainEqual(expect.objectContaining({ part: 'bottom', fromLane: 0, toLane: 1, type: 'merge', firstParent: false }))
    const a = byHash(L, 'a')
    expect(a.edges).toContainEqual(expect.objectContaining({ part: 'top', fromLane: 1, toLane: 0, type: 'fork' }))
    expect([...a.children].sort()).toEqual([1, 2])
    expectContinuous(L)
  })

  it('opens a lane per extra parent of an octopus merge', () => {
    const L = layoutGitGraph([c('a', [], 0), c('p1', ['a'], 1), c('p2', ['a'], 2), c('p3', ['a'], 3), c('m', ['a', 'p1', 'p2', 'p3'], 4)])
    const m = L.rows[0]
    expect(m.commit.hash).toBe('m')
    expect(m.edges.filter(e => e.type === 'merge').map(e => e.toLane)).toEqual([1, 2, 3])
    expect(L.laneCount).toBe(4)
    expectContinuous(L)
  })

  it('ends parents that are not loaded with a stub (shallow history)', () => {
    const L = layoutGitGraph([c('b', ['gone'], 1), c('m', ['b', 'also-gone'], 2)])
    expect(byHash(L, 'b').edges).toContainEqual(expect.objectContaining({ part: 'bottom', missing: true, parent: -1, type: 'straight' }))
    expect(byHash(L, 'm').edges).toContainEqual(expect.objectContaining({ part: 'bottom', missing: true, parent: -1, type: 'merge' }))
    expect(byHash(L, 'b').parents).toEqual([-1])
    expect(L.laneCount).toBe(1)
    expectContinuous(L)
  })

  it('does not depend on the input order', () => {
    const a = layoutGitGraph(GIT_SAMPLE, { pin: ['main', 'develop'] })
    const shuffled = [...GIT_SAMPLE].sort((x, y) => (x.hash.slice(9, 14) < y.hash.slice(9, 14) ? -1 : 1))
    const b = layoutGitGraph(shuffled, { pin: ['main', 'develop'] })
    const sig = (L: GitGraphLayout) => L.rows.map(r => `${r.commit.hash}:${r.lane}:${r.color}`).join()
    expect(sig(b)).toBe(sig(a))
  })

  it('keeps the sample history continuous and topological in both orders, and pins main and develop left', () => {
    for (const order of ['date', 'topo'] as const) {
      const L = layoutGitGraph(GIT_SAMPLE, { order, pin: ['main', 'develop'] })
      expectContinuous(L); expectTopological(L)
      const main = L.rows.find(r => r.commit.refs?.some(x => x.name === 'main'))!
      const develop = L.rows.find(r => r.commit.refs?.some(x => x.name === 'develop'))!
      expect(main.lane).toBe(0); expect(develop.lane).toBe(1)
      for (let r = main.index; r >= 0; r = L.rows[r].parents[0] ?? -1) expect(L.rows[r].lane).toBe(0) // main's first-parent chain
    }
  })

  it('gives branches stable colours: new commits on top do not reshuffle them', () => {
    expect(gitLaneColor('main')).toBe(0)
    expect(gitLaneColor('feature/x')).toBe(gitLaneColor('feature/x'))
    expect(gitLaneColor('feature/x')).toBeGreaterThan(0)
    const before = layoutGitGraph(GIT_SAMPLE, { pin: ['main', 'develop'] })
    const head = GIT_SAMPLE.find(x => x.refs?.some(r => r.type === 'head'))!
    const ref = head.refs!.find(r => r.type === 'head')!
    const next = [c('new1', [head.hash], 99999, { refs: [ref] }), ...GIT_SAMPLE.map(x => (x === head ? { ...x, refs: x.refs!.filter(r => r !== ref) } : x))]
    const after = layoutGitGraph(next, { pin: ['main', 'develop'] })
    for (const r of before.rows) expect(byHash(after, r.commit.hash).color).toBe(r.color)
    expect(byHash(after, 'new1').color).toBe(byHash(before, head.hash).color)
  })

  it('names merged-in lanes after the branch in the merge subject', () => {
    const L = layoutGitGraph([c('a', [], 0), c('f', ['a'], 1), c('m', ['a', 'f'], 2, { subject: "Merge branch 'feature/login' into main" })])
    expect(byHash(L, 'f').color).toBe(gitLaneColor('feature/login'))
  })
})

describe('parseGitLog', () => {
  const US = '\x1f', RS = '\x1e'
  const rec = (...f: string[]) => f.join(US) + RS
  const LOG = [
    rec('a1b2c3d4e5f60718293a4b5c6d7e8f9012345678', 'b2c3d4e5f60718293a4b5c6d7e8f901234567890 c3d4e5f60718293a4b5c6d7e8f90123456789012', 'Ana Lima', 'ana@acme.dev', '1762700000', 'HEAD -> feature/login, origin/feature/login, origin/HEAD, tag: v1.2.0', "Merge branch 'main' into feature/login"),
    rec('b2c3d4e5f60718293a4b5c6d7e8f901234567890', 'd4e5f60718293a4b5c6d7e8f9012345678901234', 'Ben', 'ben@acme.dev', '1762600000', 'refs/stash', 'Fix login'),
    rec('d4e5f60718293a4b5c6d7e8f9012345678901234', '', 'Chen', '', '1762500000', '', 'Initial commit'),
    rec('not-a-hash', '', 'x', '', '0', '', 'garbage'),
  ].join('\n')

  it('reads hashes, parents, author, date, refs and subject', () => {
    const cs = parseGitLog(LOG)
    expect(cs).toHaveLength(3)
    expect(cs[0]).toEqual({
      hash: 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678', parents: ['b2c3d4e5f60718293a4b5c6d7e8f901234567890', 'c3d4e5f60718293a4b5c6d7e8f90123456789012'],
      subject: "Merge branch 'main' into feature/login", author: { name: 'Ana Lima', email: 'ana@acme.dev' }, date: 1762700000000,
      refs: [{ name: 'feature/login', type: 'head' }, { name: 'origin/feature/login', type: 'remote' }, { name: 'v1.2.0', type: 'tag' }],
    })
    expect(cs[1].refs).toEqual([{ name: 'stash', type: 'stash' }])
    expect(cs[2].parents).toEqual([])
    expect(cs[2].author).toEqual({ name: 'Chen' })
    expect(cs[2].refs).toBeUndefined()
  })

  it('understands --decorate=full ref names and an optional body field', () => {
    const [x] = parseGitLog(rec('abcdef1234', '', 'A', '', '1', 'HEAD -> refs/heads/main, refs/remotes/upstream/main, refs/tags/v2, refs/heads/dev', 'Subject', 'Body line\n\nmore'))
    expect(x.refs).toEqual([{ name: 'main', type: 'head' }, { name: 'upstream/main', type: 'remote' }, { name: 'v2', type: 'tag' }, { name: 'dev', type: 'branch' }])
    expect(x.body).toBe('Body line\n\nmore')
  })

  it('round-trips into a layout', () => {
    const L = layoutGitGraph(parseGitLog(LOG))
    expect(L.rows.map(r => r.commit.subject)).toEqual(["Merge branch 'main' into feature/login", 'Fix login', 'Initial commit'])
    expect(L.rows[0].parents).toEqual([1, -1]) // the second parent wasn't in the log
  })
})

describe('filters, ranges and paths', () => {
  // main: a ← b ← m(b, f2); feature: a ← f1 ← f2; other: a ← o (unmerged, ref'd)
  const H = [c('a', [], 0), c('b', ['a'], 1), c('f1', ['a'], 2), c('f2', ['f1'], 3), c('m', ['b', 'f2'], 4, { refs: [{ name: 'main', type: 'branch' }] }),
    c('o', ['a'], 5, { refs: [{ name: 'other', type: 'branch' }] })]
  const hashes = (cs: readonly GitCommit[]) => cs.map(x => x.hash).sort()

  it('filters by branch, first parent and merged branches', () => {
    expect(filterGitHistory(H, {})).toBe(H)
    expect(hashes(filterGitHistory(H, { branches: ['other'] }))).toEqual(['a', 'o'])
    expect(hashes(filterGitHistory(H, { branches: ['main'] }))).toEqual(['a', 'b', 'f1', 'f2', 'm'])
    const fp = filterGitHistory(H, { firstParent: true })
    expect(hashes(fp)).toEqual(['a', 'b', 'm', 'o'])
    expect(fp.find(x => x.hash === 'm')!.parents).toEqual(['b'])
    const hm = filterGitHistory(H, { hideMerged: true })
    expect(hashes(hm)).toEqual(['a', 'b', 'm', 'o'])
    expect(hm.find(x => x.hash === 'm')!.parents).toEqual(['b', 'f2']) // drawn as a stub where the branch came in
    expect(byHash(layoutGitGraph(hm), 'm').edges).toContainEqual(expect.objectContaining({ missing: true, type: 'merge' }))
  })

  it('computes git ranges and first-parent paths', () => {
    const L = layoutGitGraph(H)
    const { marks, count } = gitRange(L, L.rowOf.get('a')!, L.rowOf.get('m')!)
    expect(count).toBe(4) // b, f1, f2, m
    expect(L.rows.filter(r => marks[r.index]).map(r => r.commit.hash).sort()).toEqual(['b', 'f1', 'f2', 'm'])
    const path = gitFirstParentPath(L, L.rowOf.get('m')!)
    expect(L.rows.filter(r => path[r.index]).map(r => r.commit.hash).sort()).toEqual(['a', 'b', 'm'])
  })
})

describe('GitGraph', () => {
  const NOW = T0 + 10 * DAY
  const small = [
    c('a000000aaaa', [], 1, { subject: 'Initial commit', author: { name: 'Chen' } }),
    c('b000000bbbb', ['a000000aaaa'], 2, { subject: 'Add login form', author: { name: 'Ben' } }),
    c('f000000ffff', ['a000000aaaa'], 3, { subject: 'Draft OAuth', author: { name: 'Dana' } }),
    c('a1b2c3d0000', ['b000000bbbb', 'f000000ffff'], 8, { subject: 'Fix login', author: { name: 'Ana' }, refs: [{ name: 'main', type: 'head' }] }),
  ]
  const rowOf = (subject: RegExp) => screen.getByRole('row', { name: subject })
  /** a mouse click: focuses the row (jsdom's click doesn't), then clicks it */
  const clickRow = (subject: RegExp, init?: { shiftKey?: boolean }) => { const r = rowOf(subject); act(() => r.focus()); fireEvent.click(r, init) }
  const focused = () => document.activeElement?.getAttribute('aria-label') ?? ''

  it('names rows "Commit <hash>: <subject>, by <author>, <when>"', () => {
    render(<GitGraph commits={small} now={NOW} />)
    expect(screen.getByRole('grid', { name: 'Commit history' })).toBeInTheDocument()
    expect(screen.getByRole('row', { name: 'Commit a1b2c3d: Fix login, by Ana, 2 days ago' })).toBeInTheDocument()
    expect(screen.getAllByRole('columnheader').map(h => h.textContent)).toEqual(['Graph', 'Description', 'Author', 'Date', 'Commit'])
  })

  it('moves with the arrow keys and follows edges to parents and children', () => {
    render(<GitGraph commits={small} now={NOW} />)
    clickRow(/Fix login/)
    expect(focused()).toMatch(/Fix login/)
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowDown' })
    expect(focused()).toMatch(/Draft OAuth/)
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowLeft' }) // its parent
    expect(focused()).toMatch(/Initial commit/)
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowRight' }) // a child continuing its lane
    expect(focused()).toMatch(/Add login form/)
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowRight' })
    expect(focused()).toMatch(/Fix login/)
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowLeft', shiftKey: true }) // the merge's second parent
    expect(focused()).toMatch(/Draft OAuth/)
    fireEvent.keyDown(document.activeElement!, { key: 'End' })
    expect(focused()).toMatch(/Initial commit/)
    fireEvent.keyDown(document.activeElement!, { key: 'Home' })
    expect(focused()).toMatch(/Fix login/)
    expect(screen.getAllByRole('row').filter(r => r.tabIndex === 0)).toHaveLength(1) // one tab stop
  })

  it('selects with click or Enter, opens details, and Escape closes them', () => {
    const onSelect = vi.fn()
    render(<GitGraph commits={small} now={NOW} onSelectedChange={onSelect} />)
    clickRow(/Add login form/)
    expect(onSelect).toHaveBeenLastCalledWith('b000000bbbb')
    expect(rowOf(/Add login form/)).toHaveAttribute('aria-selected', 'true')
    const panel = screen.getByRole('complementary', { name: 'Commit b000000' })
    expect(within(panel).getByText('Add login form')).toBeInTheDocument()
    fireEvent.click(within(panel).getByRole('button', { name: 'a000000 Initial commit' })) // jump to the parent
    expect(onSelect).toHaveBeenLastCalledWith('a000000aaaa')
    fireEvent.keyDown(rowOf(/Initial commit/), { key: 'Escape' })
    expect(screen.queryByRole('complementary')).toBeNull()
    fireEvent.keyDown(rowOf(/Initial commit/), { key: 'ArrowUp' })
    fireEvent.keyDown(document.activeElement!, { key: 'Enter' })
    expect(onSelect).toHaveBeenLastCalledWith('b000000bbbb')
  })

  it('loads the files of the selected commit', async () => {
    const loadCommit = vi.fn(async () => ({ files: [{ path: 'src/login.ts', status: 'modified' as const, before: 'a\nb', after: 'a\nc' }] }))
    render(<GitGraph commits={small} now={NOW} loadCommit={loadCommit} />)
    fireEvent.click(rowOf(/Fix login/))
    expect(loadCommit).toHaveBeenCalledWith('a1b2c3d0000')
    expect(await screen.findByRole('button', { name: /Modified.*src\/login\.ts/ })).toBeInTheDocument()
  })

  it('compares two commits with Shift+click', () => {
    const onCompare = vi.fn(), loadDiff = vi.fn(async () => ({ files: [] }))
    render(<GitGraph commits={small} now={NOW} onCompare={onCompare} loadDiff={loadDiff} />)
    fireEvent.click(rowOf(/Initial commit/))
    fireEvent.click(rowOf(/Fix login/), { shiftKey: true })
    expect(onCompare).toHaveBeenCalledWith('a000000aaaa', 'a1b2c3d0000') // older, newer
    expect(loadDiff).toHaveBeenCalledWith('a000000aaaa', 'a1b2c3d0000')
    expect(screen.getAllByText('Comparing a000000…a1b2c3d').length).toBeGreaterThan(0)
    expect(rowOf(/Draft OAuth/).getAttribute('aria-label')).toMatch(/In range$/)
    fireEvent.click(screen.getByRole('button', { name: 'Exit compare' }))
    expect(screen.queryByText('Comparing a000000…a1b2c3d')).toBeNull()
  })

  it('opens the actions menu on right-click; actions without a callback are disabled', () => {
    const onRevert = vi.fn(), onCheckout = vi.fn()
    render(<GitGraph commits={small} now={NOW} onRevert={onRevert} onCheckout={onCheckout} />)
    fireEvent.contextMenu(rowOf(/Fix login/), { clientX: 30, clientY: 30 })
    const menu = screen.getByRole('menu', { name: 'Commit actions' })
    expect(within(menu).getByRole('menuitem', { name: /Cherry-pick/ })).toBeDisabled()
    fireEvent.click(within(menu).getByRole('menuitem', { name: /Checkout main/ }))
    expect(onCheckout).toHaveBeenCalledWith('a1b2c3d0000', 'main')
    fireEvent.contextMenu(rowOf(/Draft OAuth/), { clientX: 30, clientY: 60 })
    fireEvent.click(within(screen.getByRole('menu')).getByRole('menuitem', { name: /Revert/ }))
    expect(onRevert).toHaveBeenCalledWith('f000000ffff')
  })

  it('searches messages, authors and hash prefixes; n jumps between matches', () => {
    render(<GitGraph commits={small} now={NOW} />)
    const box = screen.getByRole('searchbox', { name: 'Search commits' })
    fireEvent.change(box, { target: { value: 'login' } })
    expect(screen.getByText('2 matches')).toBeInTheDocument()
    fireEvent.keyDown(box, { key: 'Enter' })
    expect(screen.getByText('1 of 2')).toBeInTheDocument()
    clickRow(/Fix login/)
    fireEvent.keyDown(document.activeElement!, { key: 'n' })
    expect(focused()).toMatch(/Add login form/)
    fireEvent.change(box, { target: { value: 'f000' } })
    expect(screen.getByText('1 match')).toBeInTheDocument()
    fireEvent.change(box, { target: { value: 'zzz' } })
    expect(screen.getByText('No matches')).toBeInTheDocument()
  })

  it('renders only the rows in view (virtualised)', () => {
    const big = gitHistory(5000)
    render(<GitGraph commits={big} now={Date.now()} />)
    const rows = screen.getAllByRole('row').length - 1 // minus the header row
    expect(rows).toBeGreaterThan(10)
    expect(rows).toBeLessThan(60)
    expect(screen.getByRole('grid')).toHaveAttribute('aria-rowcount', String(big.length + 1))
  })

  it('filters to a branch from the branch menu', async () => {
    render(<GitGraph commits={[...small, c('o000000oooo', ['a000000aaaa'], 4, { subject: 'Other work', refs: [{ name: 'other', type: 'branch' }] })]} now={NOW} />)
    expect(screen.getAllByRole('row')).toHaveLength(6)
    fireEvent.click(screen.getByRole('button', { name: /All branches/ }))
    await act(async () => {})
    fireEvent.click(screen.getByRole('menuitemcheckbox', { name: 'other' }))
    expect(screen.getAllByRole('row').map(r => r.getAttribute('aria-label')).filter(Boolean)).toEqual([
      expect.stringMatching(/Other work/), expect.stringMatching(/Initial commit/)])
    expect(screen.getByRole('button', { name: 'Remove other from the filter' })).toBeInTheDocument()
  })
})
