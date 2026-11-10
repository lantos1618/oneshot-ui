// Pure helpers: the code highlighter's ReDoS and size caps, line/word diff caps, number and date formatting.
import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { CODE_HIGHLIGHT_MAX, LCS_MAX_CELLS, codeLanguageOf, codeLineDiff, highlightCode, lcsDiff, type CodeLanguage } from '../../src/lib/code'
import { wordDiff } from '../../src/lib/ai'
import { addDays, addMonths, dayKey, extent, fmt, fmtDate, maxOf, minOf, sameDay, startOfDay, startOfWeek } from '../../src/lib/core'

const LANGS: CodeLanguage[] = ['ts', 'js', 'py', 'sh', 'json']
/** The text a highlighted line renders to. */
const textOf = (line: string, lang: CodeLanguage) => {
  const { container, unmount } = render(<pre>{highlightCode(line, lang)}</pre>)
  const t = container.textContent; unmount(); return t
}
const timed = (fn: () => void) => { const t0 = performance.now(); fn(); return performance.now() - t0 }

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
      for (const n of [44, 1000]) {
        const line = q + '\\'.repeat(n) + 'x'
        const ms = timed(() => highlightCode(line, lang))
        expect(ms, `${lang} ${q} ×${n}`).toBeLessThan(250)
      }
    }
  })

  it.each(LANGS)('stays linear on long adversarial lines (%s)', lang => {
    const line = ('"\\' + "'\\" + '`\\').repeat(Math.floor((CODE_HIGHLIGHT_MAX - 10) / 6))
    expect(line.length).toBeLessThanOrEqual(CODE_HIGHLIGHT_MAX)
    expect(timed(() => highlightCode(line, lang))).toBeLessThan(500)
  })

  it('returns lines over the cap as plain text', () => {
    const line = 'const x = 1;'.repeat(Math.ceil((CODE_HIGHLIGHT_MAX + 1) / 12))
    expect(line.length).toBeGreaterThan(CODE_HIGHLIGHT_MAX)
    expect(highlightCode(line, 'ts')).toEqual([line])
  })

  it('falls back to TypeScript for an unknown language', () => {
    expect(() => highlightCode('const x = 1', 'cobol' as CodeLanguage)).not.toThrow()
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
  it('caps memory: a huge changed middle comes back as one removed and one added block, fast', () => {
    const n = 10_000
    const before = Array.from({ length: n }, (_, i) => `before ${i}`), after = Array.from({ length: n }, (_, i) => `after ${i}`)
    expect((n + 1) * (n + 1)).toBeGreaterThan(LCS_MAX_CELLS)
    let rows: ReturnType<typeof codeLineDiff> = []
    expect(timed(() => { rows = codeLineDiff(['head', ...before, 'tail'], ['head', ...after, 'tail']) })).toBeLessThan(1000)
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

  it('stays fast and bounded on huge inputs', () => {
    const a = Array.from({ length: 6000 }, (_, i) => `alpha${i}`).join(' '), b = Array.from({ length: 6000 }, (_, i) => `beta${i}`).join(' ')
    let segs: ReturnType<typeof wordDiff> = []
    expect(timed(() => { segs = wordDiff(a, b) })).toBeLessThan(1500)
    expect(rebuild(segs)).toBe(b)
  })
})

describe('fmt', () => {
  it('formats numbers as documented', () => {
    expect(fmt.compact(12400)).toMatch(/^12\.4K$/i) // the case depends on the ICU/CLDR version (Node 22 gives 12.4k)
    expect(fmt.bytes(512)).toBe('512 B')
    expect(fmt.bytes(-5)).toBe('0 B')
    expect(fmt.bytes(2.4e6)).toBe('2.4 MB')
    expect(fmt.bytes(3.2e9)).toBe('3.2 GB')
    expect(fmt.usd(0.0042)).toBe('$0.0042')
    expect(fmt.usd(0.042)).toBe('$0.042')
    expect(fmt.usd(12)).toBe('$12.00')
    expect(fmt.usd(-1.5)).toBe('-$1.50')
    expect(fmt.money(1234.5, 'EUR')).toBe('€1,234.50')
    expect(fmt.money(1234.5)).toBe('US$1,234.50')
  })
  it('formats durations and clocks', () => {
    expect(fmt.duration(420)).toBe('420 ms')
    expect(fmt.duration(1530)).toBe('1.5 s')
    expect(fmt.duration(42_000)).toBe('42 s')
    expect(fmt.duration(120_000)).toBe('2 min')
    expect(fmt.duration(125_000)).toBe('2 min 5 s')
    expect(fmt.clock(75)).toBe('1:15')
    expect(fmt.clock(3725)).toBe('1:02:05')
    expect(fmt.clock(-3)).toBe('0:00')
    expect(fmt.clock(NaN)).toBe('0:00')
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
  it('formats in en-GB', () => {
    expect(fmtDate(d)).toBe('8 Nov 2026')
    expect(fmtDate(null)).toBe('')
    expect(fmtDate(d, { weekday: 'short' })).toBe('Sun')
  })
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
  it('keeps calendar days across a daylight-saving change', () => {
    let day = new Date(2026, 2, 27) // the UK clocks change on 29 Mar 2026
    const keys: string[] = []
    for (let i = 0; i < 5; i++) { keys.push(dayKey(day)); day = addDays(day, 1) }
    expect(keys).toEqual(['2026-03-27', '2026-03-28', '2026-03-29', '2026-03-30', '2026-03-31'])
  })
})
