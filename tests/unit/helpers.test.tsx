// Pure helpers: the code highlighter's ReDoS and size caps, line/word diff caps, array extremes and day arithmetic.
// Formatting is in fmt.test.ts; daylight-saving changes in dst.test.ts.
import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { CODE_HIGHLIGHT_MAX, LCS_MAX_CELLS, codeLanguageOf, codeLineDiff, highlightCode, lcsDiff, type CodeLanguage } from '../../src/lib/code'
import { wordDiff } from '../../src/lib/ai'
import { addDays, addMonths, dayKey, extent, maxOf, minOf, sameDay, startOfDay, startOfWeek } from '../../src/lib/core'
import { HANG_MS, expectLinear, timed } from '../helpers'

const LANGS: CodeLanguage[] = ['ts', 'js', 'py', 'sh', 'json']
/** The text a highlighted line renders to. */
const textOf = (line: string, lang: CodeLanguage) => {
  const { container, unmount } = render(<pre>{highlightCode(line, lang)}</pre>)
  const t = container.textContent; unmount(); return t
}

describe('highlightCode', () => {
  it.each(LANGS)('is lossless for %s', lang => {
    for (const line of ['const x = await fetch("/api", { method: \'POST\' }) // go', 'def f(a, b=2): return a  # c', 'pnpm add -D vitest $HOME "${X}"', '{"a": [1, 2.5, true, null]}', '`tpl ${x}` + \'\\\'\'', '']) {
      expect(textOf(line, lang)).toBe(line)
    }
  })

  it('marks keywords, strings and comments with spans', () => {
    const { container } = render(<pre>{highlightCode('const s = "hi" // note', 'ts')}</pre>)
    const spans = [...container.querySelectorAll('span')].map(s => s.textContent)
    expect(spans).toEqual(expect.arrayContaining(['const', '"hi"', '// note']))
  })

  // review/security-content.md #3: 48 backslashes took 55 s with the old pattern.
  it.each(LANGS)('has no catastrophic backtracking on unterminated strings (%s)', lang => {
    for (const q of ['"', "'", '`']) {
      expect(timed(() => highlightCode(q + '\\'.repeat(44) + 'x', lang)), `${lang} ${q}`).toBeLessThan(HANG_MS)
      expectLinear(n => { const line = q + '\\'.repeat(n) + 'x'; return () => highlightCode(line, lang) }, 250, `${lang} ${q}`)
    }
  })

  // Each unterminated string scans to the end of the line, so this input grows quadratically up to CODE_HIGHLIGHT_MAX;
  // the cap keeps a line at about a millisecond.
  it.each(LANGS)('stays fast on long adversarial lines up to the cap (%s)', lang => {
    const unit = '"\\' + "'\\" + '`\\', most = Math.floor((CODE_HIGHLIGHT_MAX - 10) / unit.length)
    expect((unit.repeat(most)).length).toBeLessThanOrEqual(CODE_HIGHLIGHT_MAX)
    expectLinear(n => { const line = unit.repeat(n); return () => highlightCode(line, lang) }, Math.floor(most / 4), lang)
  })

  it('returns lines over the cap as plain text', () => {
    const line = 'const x = 1;'.repeat(Math.ceil((CODE_HIGHLIGHT_MAX + 1) / 12))
    expect(line.length).toBeGreaterThan(CODE_HIGHLIGHT_MAX)
    expect(highlightCode(line, 'ts')).toEqual([line])
  })

  it('falls back to TypeScript for an unknown language', () => {
    const html = (lang: CodeLanguage) => { const { container, unmount } = render(<pre>{highlightCode('const x = "a" // b', lang)}</pre>); const h = container.innerHTML; unmount(); return h }
    expect(html('cobol' as CodeLanguage)).toBe(html('ts'))
  })

  it('guesses languages from file names', () => {
    expect(codeLanguageOf('a.tsx')).toBe('ts')
    expect(codeLanguageOf('run.py')).toBe('py')
    expect(codeLanguageOf('x.zsh')).toBe('sh')
    expect(codeLanguageOf('package.json')).toBe('json')
    expect(codeLanguageOf('index.mjs')).toBe('js')
    expect(codeLanguageOf(undefined)).toBeUndefined()
  })
})

describe('codeLineDiff / lcsDiff', () => {
  it('diffs lines with 1-based numbers', () => {
    const rows = codeLineDiff(['a', 'b', 'c'], ['a', 'B', 'c', 'd'])
    expect(rows).toEqual([
      { type: '=', text: 'a', a: 1, b: 1 },
      { type: '-', text: 'b', a: 2, b: null },
      { type: '+', text: 'B', a: null, b: 2 },
      { type: '=', text: 'c', a: 3, b: 3 },
      { type: '+', text: 'd', a: null, b: 4 },
    ])
  })

  it('handles empty sides', () => {
    expect(codeLineDiff([], [])).toEqual([])
    expect(codeLineDiff([], ['x']).map(r => r.type)).toEqual(['+'])
    expect(codeLineDiff(['x'], []).map(r => r.type)).toEqual(['-'])
  })

  it('reconstructs both sides', () => {
    const a = 'the quick brown fox jumps over the lazy dog'.split(' '), b = 'a quick red fox leaps over the dog today'.split(' ')
    const steps = lcsDiff(a, b)
    expect(steps.filter(s => s.type !== '+').map(s => a[s.a!])).toEqual(a)
    expect(steps.filter(s => s.type !== '-').map(s => b[s.b!])).toEqual(b)
  })

  // review/security-content.md #8: a 10k × 10k diff exhausted the tab.
  it('caps memory: a huge changed middle comes back as one removed and one added block, without a full table', () => {
    const n = 10_000
    const before = Array.from({ length: n }, (_, i) => `before ${i}`), after = Array.from({ length: n }, (_, i) => `after ${i}`)
    expect((n + 1) * (n + 1)).toBeGreaterThan(LCS_MAX_CELLS)
    let compared = 0
    lcsDiff(before, after, { equal: (x, y) => { compared++; return x === y } })
    expect(compared).toBeLessThan(10) // only the common head and tail are compared, not n × n cells
    const rows = codeLineDiff(['head', ...before, 'tail'], ['head', ...after, 'tail'])
    expect(rows).toHaveLength(2 * n + 2)
    expect(rows[0]).toMatchObject({ type: '=', text: 'head' })
    expect(rows.slice(1, n + 1).every(r => r.type === '-')).toBe(true)
    expect(rows.slice(n + 1, 2 * n + 1).every(r => r.type === '+')).toBe(true)
    expect(rows.at(-1)).toMatchObject({ type: '=', text: 'tail' })
  })

  it('respects a custom maxCells and preference', () => {
    const steps = lcsDiff(['a', 'b'], ['c', 'd'], { maxCells: 1, prefer: 'insert' })
    expect(steps.map(s => s.type)).toEqual(['+', '+', '-', '-'])
  })
})

describe('wordDiff', () => {
  const rebuild = (segs: { t: string; text: string }[]) => segs.filter(s => s.t !== '-').map(s => s.text).join('')

  it('marks changed words', () => {
    const segs = wordDiff('The quick brown fox.', 'The slow brown fox.')
    expect(segs.find(s => s.t === '-')?.text).toMatch(/quick/)
    expect(segs.find(s => s.t === '+')?.text).toMatch(/slow/)
    expect(rebuild(segs)).toBe('The slow brown fox.')
  })

  it('is case-insensitive for matching but shows the new text', () => {
    expect(wordDiff('Hello world', 'hello world')).toEqual([{ t: '=', text: 'hello world' }])
  })

  it('handles empty input', () => {
    expect(wordDiff('', '')).toEqual([])
    expect(rebuild(wordDiff('', 'new text'))).toBe('new text')
  })

  it('stays bounded on huge inputs (the diff table is capped, see lcsDiff)', () => {
    const words = (w: string) => Array.from({ length: 6000 }, (_, i) => `${w}${i}`).join(' ')
    const b = words('beta')
    let segs: ReturnType<typeof wordDiff> = []
    expect(timed(() => { segs = wordDiff(words('alpha'), b) })).toBeLessThan(HANG_MS)
    expect(rebuild(segs)).toBe(b)
  })
})

describe('array helpers', () => {
  it('maxOf / minOf / extent work on huge arrays without spreading', () => {
    const big = Array.from({ length: 300_000 }, (_, i) => (i * 7919) % 100_003)
    expect(maxOf(big)).toBe(100_002)
    expect(minOf(big)).toBe(0)
    expect(extent(big)).toEqual([0, 100_002])
    expect(maxOf([])).toBe(-Infinity)
    expect(maxOf([], 0)).toBe(0)
    expect(extent([])).toEqual([Infinity, -Infinity])
  })
})

describe('dates', () => {
  const d = new Date(2026, 10, 8, 15, 30) // Sunday 8 Nov 2026, 15:30 local
  it('does day arithmetic at midnight', () => {
    expect(startOfDay(d).getHours()).toBe(0)
    expect(dayKey(addDays(d, 1))).toBe('2026-11-09')
    expect(dayKey(addDays(d, -8))).toBe('2026-10-31')
    expect(addDays(d, 1).getHours()).toBe(0)
    expect(dayKey(addMonths(new Date(2026, 0, 31), 1))).toBe('2026-02-01')
    expect(dayKey(addMonths(d, -11))).toBe('2025-12-01')
  })
  it('starts weeks on Monday by default', () => {
    expect(dayKey(startOfWeek(d))).toBe('2026-11-02')
    expect(dayKey(startOfWeek(d, 0))).toBe('2026-11-08')
    expect(dayKey(startOfWeek(new Date(2026, 10, 2)))).toBe('2026-11-02')
  })
  it('compares days null-safely', () => {
    expect(sameDay(d, new Date(2026, 10, 8, 1))).toBe(true)
    expect(sameDay(d, addDays(d, 1))).toBe(false)
    expect(sameDay(d, null)).toBe(false)
    expect(sameDay(undefined, undefined)).toBe(false)
  })
})
