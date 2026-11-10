// TreeView thread lines (0.5): opt-in `lines`, one collapse button per ancestor level a row's thread passes through
// (an elbow into the row from its parent), click collapses that folder, not in the Tab order, names unchanged, no
// layout shift (the indent is the same with and without lines), compact and virtual (10k) trees, RTL logical offsets.
import { act, fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { type TreeNode, TreeView } from '../../src/lib'

const TREE: TreeNode[] = [
  { id: 'src', label: 'src', children: [
    { id: 'components', label: 'components', children: [{ id: 'a', label: 'Button.tsx', size: '2.1 KB' }, { id: 'b', label: 'Dialog.tsx', size: '4.8 KB' }] },
    { id: 'hooks', label: 'hooks', children: [{ id: 'c', label: 'useFlow.ts', size: '1.2 KB' }] },
  ] },
  { id: 'pkg', label: 'package.json', size: '1.4 KB' },
]
const OPEN = ['src', 'components', 'hooks']
const item = (name: RegExp | string) => screen.getByRole('treeitem', { name })
const lines = (row: HTMLElement) => within(row).queryAllByRole('button', { name: /^Collapse / })

describe('TreeView lines', () => {
  it('draws none by default, and one line per ancestor level the thread passes through when on', () => {
    const { rerender } = render(<TreeView nodes={TREE} defaultExpanded={OPEN} />)
    expect(screen.queryAllByRole('button', { name: /^Collapse / })).toHaveLength(0)
    rerender(<TreeView nodes={TREE} defaultExpanded={OPEN} lines />)
    // Button.tsx: src's thread continues past it (hooks follows components), plus the elbow from components
    expect(lines(item(/^Button\.tsx/)).map(b => b.getAttribute('aria-label'))).toEqual(['Collapse src', 'Collapse components'])
    // useFlow.ts: hooks is src's last child, so src's thread has ended; only the elbow from hooks
    expect(lines(item(/^useFlow\.ts/)).map(b => b.getAttribute('aria-label'))).toEqual(['Collapse hooks'])
    expect(lines(item(/^src/))).toHaveLength(0) // top level: no thread
    // not in the Tab order (← collapses from the keyboard)
    for (const b of screen.getAllByRole('button', { name: /^Collapse / })) expect(b).toHaveAttribute('tabindex', '-1')
  })

  it('keeps each row named by its label and size, not by the collapse buttons inside it', () => {
    render(<TreeView nodes={TREE} defaultExpanded={OPEN} lines />)
    expect(screen.getByRole('treeitem', { name: 'Button.tsx 2.1 KB' })).toBeInTheDocument()
    expect(screen.getByRole('treeitem', { name: 'components 2' })).toBeInTheDocument()
  })

  it('collapses the folder when its line is clicked, and selects it', async () => {
    const user = userEvent.setup()
    render(<TreeView nodes={TREE} defaultExpanded={OPEN} lines />)
    const src = item(/^src/)
    expect(src).toHaveAttribute('aria-expanded', 'true')
    await user.click(within(item(/^Dialog\.tsx/)).getByRole('button', { name: 'Collapse src' }))
    expect(src).toHaveAttribute('aria-expanded', 'false')
    expect(src).toHaveAttribute('aria-selected', 'true')
    expect(src).toHaveFocus()
  })

  it('does not move rows when lines are toggled (same indent either way), in normal and compact rows', () => {
    for (const compact of [false, true]) {
      const { rerender, unmount } = render(<TreeView nodes={TREE} defaultExpanded={OPEN} compact={compact} />)
      const pads = () => screen.getAllByRole('treeitem').map(r => r.style.paddingInlineStart)
      const before = pads()
      rerender(<TreeView nodes={TREE} defaultExpanded={OPEN} compact={compact} lines />)
      expect(pads()).toEqual(before)
      // each line sits under its folder's chevron: base + level × step + 7 (chevron centre), minus half the step
      const [s, c] = lines(screen.getByRole('treeitem', { name: /^Button\.tsx/ }))
      const step = compact ? 12 : 16, base = compact ? 4 : 8
      expect(parseFloat(s.style.insetInlineStart)).toBe(base + 7 - step / 2)
      expect(parseFloat(c.style.insetInlineStart)).toBe(base + step + 7 - step / 2)
      rerender(<TreeView nodes={TREE} defaultExpanded={OPEN} compact={compact} lines="hover" />)
      expect(lines(screen.getByRole('treeitem', { name: /^Button\.tsx/ }))).toHaveLength(2)
      unmount()
    }
  })

  it('works in a virtual 10k-node tree: lines on the rendered rows, click collapses', () => {
    const big: TreeNode[] = [{ id: 'mono', label: 'mono', children: Array.from({ length: 100 }, (_, p) => ({
      id: `p${p}`, label: `pkg-${p}`, children: Array.from({ length: 99 }, (_, f) => ({ id: `p${p}/f${f}`, label: `file-${p}-${f}.ts` })),
    })) }]
    render(<TreeView nodes={big} defaultExpanded={['mono', 'p0', 'p1']} lines height={300} aria-label="Big" />)
    const rows = screen.getAllByRole('treeitem')
    expect(rows.length).toBeLessThan(40) // virtualised
    const f3 = screen.getByRole('treeitem', { name: /^file-0-3\.ts/ })
    expect(lines(f3).map(b => b.getAttribute('aria-label'))).toEqual(['Collapse mono', 'Collapse pkg-0'])
    act(() => { fireEvent.click(lines(f3)[1]) })
    expect(screen.getByRole('treeitem', { name: /^pkg-0/ })).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByRole('treeitem', { name: /^file-0-3\.ts/ })).toBeNull()
  })
})
