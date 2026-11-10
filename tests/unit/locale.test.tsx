// Formatting: the fixed English formatters and the plural/rangeStr text helpers.
import { describe, expect, it } from 'vitest'
import { fmt, plural, rangeStr } from '../../src/lib'

const NOV8 = new Date(2026, 10, 8, 14, 5)

describe('fmt', () => {
  it('formats numbers, money, bytes, durations and clocks', () => {
    expect(fmt.number(1234.5)).toBe('1,234.5')
    expect(fmt.compact(12400)).toBe('12.4k')
    expect(fmt.money(1234.5, 'EUR')).toBe('€1,234.50')
    expect(fmt.usd(0.0042)).toBe('$0.0042')
    expect(fmt.percent(0.125)).toBe('12.5%')
    expect(fmt.bytes(2.4e6)).toBe('2.4 MB')
    expect(fmt.duration(1530)).toBe('1.5 s')
    expect(fmt.duration(125000)).toBe('2 min 5 s')
    expect(fmt.clock(75)).toBe('1:15')
    expect(fmt.clock(3725)).toBe('1:02:05')
  })
  it('formats dates, times, lists and relative times', () => {
    expect(fmt.date(NOV8)).toBe('8 Nov 2026')
    expect(fmt.time(NOV8)).toBe('14:05')
    expect(fmt.date(null)).toBe('')
    expect(fmt.list(['a', 'b', 'c'])).toBe('a, b and c')
    const now = NOV8.getTime()
    expect(fmt.relative(now - 3 * 864e5, now)).toBe('3 days ago')
    expect(fmt.relativeTime(-1, 'day')).toBe('yesterday')
  })
  it('lists weekday and month names from Monday', () => {
    expect(fmt.weekdays('short')).toEqual(['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'])
    expect(fmt.months('short')[0]).toBe('Jan')
  })
})

describe('text helpers', () => {
  it('plural counts and picks the word', () => {
    expect(plural(1, 'file')).toBe('1 file')
    expect(plural(3, 'file')).toBe('3 files')
    expect(plural(2, 'person', 'people')).toBe('2 people')
    expect(plural(1200, 'row')).toBe('1,200 rows')
  })
  it('rangeStr gives "a to b", one value, or "no values"', () => {
    expect(rangeStr([3, 1, NaN, 2])).toBe('1 to 3')
    expect(rangeStr([5, 5])).toBe('5')
    expect(rangeStr([])).toBe('no values')
    expect(rangeStr([0.5, 1], v => `${v * 100}%`)).toBe('50% to 100%')
  })
})
