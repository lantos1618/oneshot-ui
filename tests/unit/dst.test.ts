// Local-midnight date helpers across the daylight-saving changes of the zone the suite runs in. vitest.config.ts runs
// this file in Europe/London and in America/Santiago, where the clocks skip midnight itself.
import { describe, expect, it } from 'vitest'
import { addDays, dayKey, sameDay, startOfDay, startOfWeek } from '../../src/lib/core'
import { formDate } from '../../src/lib/formcontrol'

const HOUR = 3_600_000
/** UTC calendar arithmetic, independent of the helpers under test. */
const utcKey = (y: number, m: number, d: number) => new Date(Date.UTC(y, m, d)).toISOString().slice(0, 10)

/** The local calendar days of 2026 on which the UTC offset changes, found hour by hour from the clock itself. */
function transitions2026() {
  const days: [number, number, number][] = []
  for (let t = Date.UTC(2026, 0, 1); t < Date.UTC(2027, 0, 1); t += HOUR) {
    const a = new Date(t), b = new Date(t + HOUR)
    if (a.getTimezoneOffset() !== b.getTimezoneOffset()) days.push([b.getFullYear(), b.getMonth(), b.getDate()])
  }
  return days
}
const DAYS = transitions2026()

describe('the pinned time zone', () => {
  it('has daylight saving, so the cases below cross real clock changes', () => {
    expect(['Europe/London', 'America/Santiago']).toContain(Intl.DateTimeFormat().resolvedOptions().timeZone)
    expect(DAYS).toHaveLength(2)
  })
})

describe.each(DAYS.map(([y, m, d]) => ({ y, m, d, label: utcKey(y, m, d) })))('across the clock change on $label', ({ y, m, d }) => {
  const want = (offset: number) => utcKey(y, m, d + offset)

  it('addDays steps one calendar day at a time, from midnight and from late evening', () => {
    for (const hour of [0, 23]) {
      let day = new Date(y, m, d - 3, hour)
      const keys: string[] = []
      for (let i = 0; i < 7; i++) { keys.push(dayKey(day)); day = addDays(day, 1) }
      expect(keys).toEqual([-3, -2, -1, 0, 1, 2, 3].map(want))
    }
    expect(dayKey(addDays(new Date(y, m, d + 3, 12), -6))).toBe(want(-3))
  })

  it('startOfDay keeps the day (the first instant of it, when midnight is skipped)', () => {
    for (const hour of [0, 6, 12, 23]) {
      const s = startOfDay(new Date(y, m, d, hour))
      expect(dayKey(s)).toBe(want(0))
      expect(dayKey(new Date(s.getTime() - 1))).toBe(want(-1))
    }
  })

  it('startOfWeek, sameDay and formDate agree with the calendar', () => {
    const at = new Date(y, m, d, 12)
    const mondayOffset = -((new Date(Date.UTC(y, m, d)).getUTCDay() + 6) % 7)
    expect(dayKey(startOfWeek(at))).toBe(want(mondayOffset))
    expect(sameDay(addDays(new Date(y, m, d - 1, 23), 1), at)).toBe(true)
    expect(formDate(addDays(at, 1))).toBe(want(1))
  })
})
