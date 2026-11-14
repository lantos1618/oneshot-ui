// Package H (code, markdown, editor, lanes, gitgraph): diffs of new and deleted files, bad git timestamps, emoji names,
// the editor's save indicator, GitGraph's search position, and the medium fixes around them.
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { CodeBlock, CodeTabs, Diff, codeLanguageOf, codeLines, diffHunks, diffStat, codeLineDiff } from '../../src/lib/code'
import { EmojiPicker, RichTextEditor, richTextHref } from '../../src/lib/editor'
import { GitGraph, parseGitLog, type GitCommit } from '../../src/lib/gitgraph'
import { ICONS } from '../../src/lib/icons'
import { Markdown, parseMarkdown } from '../../src/lib/markdown'

const DAY = 86400e3, T0 = Date.UTC(2026, 0, 1), NOW = T0 + 10 * DAY
const commit = (hash: string, parents: string[], day: number, extra: Partial<GitCommit> = {}): GitCommit =>
  ({ hash, parents, subject: `commit ${hash}`, author: { name: 'Ana' }, date: T0 + day * DAY, ...extra })
const SMALL = [
  commit('a000000aaaa', [], 1, { subject: 'Initial commit' }),
  commit('b000000bbbb', ['a000000aaaa'], 2, { subject: 'Add login form' }),
  commit('c000000cccc', ['b000000bbbb'], 5, { subject: 'Login copy' }),
  commit('d000000dddd', ['c000000cccc'], 8, { subject: 'Fix login', refs: [{ name: 'main', type: 'head' }] }),
]
const statText = (root: HTMLElement) => root.querySelector('.ui-num')?.textContent

describe('H-H1: diffs of new and deleted files', () => {
  it('codeLines: no lines for empty text, and a trailing newline ends the last line', () => {
    expect(codeLines('')).toEqual([])
    expect(codeLines('a\n')).toEqual(['a'])
    expect(codeLines('a\n\n')).toEqual(['a', ''])
  })

  it('a new file reads "+1 −0" with no deleted empty line', () => {
    const { container } = render(<Diff before="" after={'a\n'} filename="new.ts" />)
    expect(statText(container)).toBe('+1 −0')
    expect(container.querySelectorAll('[data-kind="del"]')).toHaveLength(0)
    expect(container.querySelectorAll('[data-kind="add"]')).toHaveLength(1)
    expect(container.querySelector('[data-kind="hunk"]')?.textContent).toBe('@@ -0,0 +1,1 @@')
  })

  it('a deleted file reads "+0 −2"', () => {
    const { container } = render(<Diff before={'a\nb\n'} after="" filename="old.ts" />)
    expect(statText(container)).toBe('+0 −2')
    expect(container.querySelectorAll('[data-kind="add"]')).toHaveLength(0)
  })

  it('CodeBlock compares against an empty previous version without a phantom line', () => {
    render(<CodeBlock code={'x\ny\n'} previous="" filename="a.ts" />)
    fireEvent.click(screen.getByRole('button', { name: /Changes/ }))
    expect(screen.getByRole('button', { name: /Changes/ }).textContent).toContain('+2 −0')
  })

  it('diffStat and diffHunks pair each run of removals with the additions after it', () => {
    const rows = codeLineDiff(['a', 'b', 'c'], ['a', 'B', 'C', 'c'])
    expect(diffStat(rows)).toEqual({ adds: 2, dels: 1 })
    expect(diffHunks(rows).map(h => ('eq' in h ? '=' : `${h.del.length}/${h.add.length}`))).toEqual(['=', '1/2', '='])
  })
})

describe('H-H2: bad git timestamps', () => {
  const rec = (hash: string, at: string) => [hash, '', 'Ana', 'ana@x.dev', at, '', `subject ${hash}`].join('\x1f')

  it('parseGitLog skips a record whose timestamp is not a number', () => {
    const out = parseGitLog([rec('a1b2c3d4', '1700000000'), rec('b1b2c3d4', 'abc'), rec('c1b2c3d4', ''), rec('d1b2c3d4', '1700000100')].join('\x1e'))
    expect(out.map(c => c.hash)).toEqual(['a1b2c3d4', 'd1b2c3d4'])
  })

  it('GitGraph renders a commit with an invalid date instead of crashing', () => {
    render(<GitGraph commits={[...SMALL, commit('e000000eeee', ['a000000aaaa'], 0, { subject: 'Broken date', date: new Date('garbage') })]} now={NOW} />)
    expect(screen.getByRole('row', { name: /Broken date, by Ana, Unknown date/ })).toBeInTheDocument()
  })
})

describe('H-H3: emoji accessible names', () => {
  it('emoji that share a search word have different names', () => {
    render(<EmojiPicker onPick={() => {}} />)
    fireEvent.change(screen.getByRole('textbox', { name: 'Search emoji' }), { target: { value: 'thumbs' } })
    const names = within(screen.getByRole('group', { name: 'Results' })).getAllByRole('button').map(b => b.getAttribute('aria-label'))
    expect(names).toEqual(['thumbs up', 'thumbs down'])
    fireEvent.change(screen.getByRole('textbox', { name: 'Search emoji' }), { target: { value: 'smile' } })
    const smiles = within(screen.getByRole('group', { name: 'Results' })).getAllByRole('button').map(b => b.getAttribute('aria-label'))
    expect(new Set(smiles).size).toBe(smiles.length)
  })
})

describe('H-H4: the editor says "Saved" only when a save was confirmed', () => {
  const type = (text: string) => { const ed = screen.getByRole('textbox', { name: 'Notes' }); ed.innerHTML = `<p>${text}</p>`; fireEvent.input(ed) }

  it('never shows "Saved" without a confirming onChange or saveState', async () => {
    const onChange = vi.fn()
    render(<RichTextEditor aria-label="Notes" onChange={onChange} />)
    expect(screen.queryByText('Saved')).toBeNull()
    type('hello')
    await act(async () => { await new Promise(r => setTimeout(r, 800)) })
    expect(onChange).toHaveBeenCalledWith('<p>hello</p>')
    expect(screen.queryByText('Saved')).toBeNull()
  })

  it('shows "Saved" when the onChange promise resolves and "Couldn’t save" when it rejects', async () => {
    let settle: { ok: () => void; fail: () => void } | null = null
    const onChange = vi.fn(() => new Promise<void>((ok, fail) => { settle = { ok, fail: () => fail(new Error('offline')) } }))
    render(<RichTextEditor aria-label="Notes" onChange={onChange} />)
    type('one')
    expect(await screen.findByText('Saving…', undefined, { timeout: 2000 })).toBeInTheDocument()
    await act(async () => { settle!.ok() })
    expect(await screen.findByText('Saved')).toBeInTheDocument()
    type('two')
    await waitFor(() => expect(screen.queryByText('Saved')).toBeNull()) // newer edits are not saved yet (it fades out)
    await screen.findByText('Saving…', undefined, { timeout: 2000 })
    await act(async () => { settle!.fail() })
    expect(await screen.findByText('Couldn’t save')).toBeInTheDocument()
  })

  it('saveState drives the indicator', async () => {
    const { rerender } = render(<RichTextEditor aria-label="Notes" saveState="saving" />)
    expect(screen.getByText('Saving…')).toBeInTheDocument()
    rerender(<RichTextEditor aria-label="Notes" saveState="idle" />)
    await waitFor(() => expect(screen.queryByText('Saving…')).toBeNull())
  })
})

describe('H-H5: GitGraph search position follows the commit', () => {
  it('never reads "N of M" with N > M after the rows change', () => {
    const { rerender } = render(<GitGraph commits={SMALL} now={NOW} />)
    const box = screen.getByRole('searchbox', { name: 'Search commits' })
    fireEvent.change(box, { target: { value: 'login' } })
    for (let i = 0; i < 3; i++) fireEvent.keyDown(box, { key: 'Enter' })
    expect(screen.getByText('3 of 3')).toBeInTheDocument()
    rerender(<GitGraph commits={SMALL.filter(c => c.subject !== 'Login copy').map(c => c.hash === 'd000000dddd' ? { ...c, parents: ['b000000bbbb'] } : c)} now={NOW} />)
    expect(screen.getByText('2 of 2')).toBeInTheDocument()
    rerender(<GitGraph commits={SMALL.filter(c => c.subject !== 'Add login form' && c.subject !== 'Login copy')} now={NOW} />)
    expect(screen.getByText('1 match')).toBeInTheDocument()
  })

  it('counts its place among the matches, not among the rows, when a non-match sits above them', () => {
    const bump = commit('e000000eeee', ['d000000dddd'], 9, { subject: 'Bump deps' })
    render(<GitGraph commits={[...SMALL, bump]} now={NOW} />)
    const box = screen.getByRole('searchbox', { name: 'Search commits' })
    fireEvent.change(box, { target: { value: 'login' } })
    fireEvent.keyDown(box, { key: 'Enter' })
    expect(screen.getByText('1 of 3')).toBeInTheDocument()
    fireEvent.keyDown(box, { key: 'Enter' })
    fireEvent.keyDown(box, { key: 'Enter' })
    expect(screen.getByText('3 of 3')).toBeInTheDocument()
  })

  it('Escape in the search clears it; the previous-match button uses the up chevron', () => {
    render(<GitGraph commits={SMALL} now={NOW} />)
    const box = screen.getByRole('searchbox', { name: 'Search commits' })
    fireEvent.change(box, { target: { value: 'login' } })
    const glyph = (name: string) => screen.getByRole('button', { name }).querySelector('svg path')?.getAttribute('d')
    expect(glyph('Previous match')).toBe(ICONS.chevronUp)
    expect(glyph('Next match')).toBe(ICONS.chevronDown)
    fireEvent.keyDown(box, { key: 'Escape' })
    expect(box).toHaveValue('')
  })
})

describe('H medium fixes', () => {
  it('H-M1: codeLanguageOf reads one table and knows nothing else', () => {
    expect(codeLanguageOf('x.unknown')).toBeUndefined()
    expect(codeLanguageOf('README.md')).toBeUndefined()
    expect(codeLanguageOf('a.constructor')).toBeUndefined()
    expect(codeLanguageOf('x.cjs')).toBe('js')
    expect(codeLanguageOf('x.jsonc')).toBe('json')
  })

  it('H-M1: an unknown file is plain text with a "Text" badge', () => {
    // getByText matches an element's own text nodes: the line is found whole only if no token splits it
    const { unmount } = render(<CodeBlock code="const x = 1" filename="app.js" />)
    expect(screen.queryByText('const x = 1')).toBeNull() // a known language is highlighted (the control)
    expect(screen.getByText('const')).toBeInTheDocument()
    unmount()
    render(<CodeBlock code="const x = 1" filename="notes.txt" />)
    expect(screen.getByText('Text')).toBeInTheDocument()
    const line = screen.getByText('const x = 1')
    expect(line.children).toHaveLength(0)
  })

  it('H-M2: one Tab stop per emoji grid; ↓ from Recent keeps the column', () => {
    render(<EmojiPicker onPick={() => {}} recent={['👍', '🔥', '🎉']} />)
    const recent = screen.getByRole('group', { name: 'Recent' }), main = screen.getByRole('group', { name: 'Smileys' })
    for (const g of [recent, main]) expect(within(g).getAllByRole('button').filter(b => b.tabIndex === 0)).toHaveLength(1)
    const party = within(recent).getAllByRole('button')[2]
    act(() => party.focus())
    fireEvent.keyDown(party, { key: 'ArrowDown' })
    expect(document.activeElement).toBe(within(main).getAllByRole('button')[2])
    fireEvent.keyDown(document.activeElement!, { key: 'End' })
    expect(document.activeElement).toBe(within(main).getAllByRole('button')[7])
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowUp' })
    expect(document.activeElement).toBe(party)
  })

  it('H-M4: one empty-state message in the emoji search', () => {
    render(<EmojiPicker onPick={() => {}} />)
    fireEvent.change(screen.getByRole('textbox', { name: 'Search emoji' }), { target: { value: 'zzzz' } })
    expect(screen.getAllByText(/No emoji found|No results/)).toHaveLength(1)
  })

  it('H-M8: [n] is a citation only with renderCitation, n ≥ 1, and not inside words or before ":"', () => {
    const { container, rerender } = render(<Markdown>{'set arr[0] or see [2]\n\n[1]: https://x.dev'}</Markdown>)
    expect(container.querySelector('sup')).toBeNull()
    expect(container.textContent).toContain('arr[0]')
    const cite = (n: number) => <sup data-cite={n}>{n}</sup>
    rerender(<Markdown renderCitation={cite}>{'set arr[0] or items[2], see [3] and [0]\n\n[1]: https://x.dev'}</Markdown>)
    expect([...container.querySelectorAll('[data-cite]')].map(e => e.getAttribute('data-cite'))).toEqual(['3'])
    expect(parseMarkdown('x[1]')[0]).toMatchObject({ children: [{ type: 'text', text: 'x[1]' }] })
  })

  it('H-M12: CodeTabs with no tabs renders nothing', () => {
    const { container } = render(<CodeTabs tabs={[]} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('H-M13: typed links keep relative paths and tel:, and get https:// otherwise', () => {
    expect(richTextHref('tel:123')).toBe('tel:123')
    expect(richTextHref('/docs')).toBe('/docs')
    expect(richTextHref('#top')).toBe('#top')
    expect(richTextHref('mailto:a@b.c')).toBe('mailto:a@b.c')
    expect(richTextHref('example.com/x')).toBe('https://example.com/x')
    expect(richTextHref('javascript:alert(1)')).toBe('https://javascript:alert(1)')
  })

  it('H-M11: GitGraph announces commits new to the history, not rows a filter brings back', () => {
    const extra = commit('f000000ffff', ['d000000dddd'], 9, { subject: 'Newest' })
    const feat = commit('e000000eeee', ['b000000bbbb'], 8.5, { subject: 'Feature work', refs: [{ name: 'feat', type: 'head' }] })
    const all = [...SMALL, feat]
    const { rerender } = render(<GitGraph commits={all} now={NOW} branches={['main']} />)
    expect(screen.queryByRole('row', { name: /Feature work/ })).toBeNull()
    rerender(<GitGraph commits={all} now={NOW} branches={[]} />) // the filter is cleared: the row comes back
    expect(screen.getByRole('row', { name: /Feature work/ })).toBeInTheDocument()
    expect(screen.queryByText(/new commit/)).toBeNull()
    rerender(<GitGraph commits={[...all, extra]} now={NOW} branches={[]} />)
    expect(screen.getByText('1 new commit')).toBeInTheDocument()
  })

  it('H-L11: a filter that hides every commit says so and offers to clear it', () => {
    render(<GitGraph commits={SMALL} now={NOW} defaultBranches={['nothing-here']} />)
    expect(screen.getByText('No commits match these filters')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }))
    expect(screen.getByRole('row', { name: /Fix login/ })).toBeInTheDocument()
  })
})
