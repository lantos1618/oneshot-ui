// Dates and times (0.4): Calendar constraints, locale names and week start, APG grid keys, the quick month/year picker,
// segmented DateField/TimeField/DateTimeField (typing, auto-advance, backspace, arrows, paste, 12/24 h), time zones
// around DST, FormData for every date control, and the async MultiSelect.
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState, type ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'
import {
  Calendar, DateField, DatePicker, DateRangePicker, DateTimeField, DateTimePicker, Form, FormField, MonthPicker, MultiSelect, type Option, TimeField, TimePicker,
  TimeZonePicker, YearPicker, timeZoneOptions, toZonedISO, zonedDate, zonedParts, zoneOffset,
} from '../../src/lib/forms'

/** A day button by its label; CLDR versions differ on the comma after the weekday ("Friday, 6 November 2026"). */
const day = (name: RegExp | string) => screen.getByRole('button', { name: typeof name === 'string' && !name.includes(',') ? new RegExp(`^${name.replace(' ', ',? ')}$`) : name })
const headers = () => screen.getAllByRole('columnheader').slice(0, 7).map(h => h.getAttribute('aria-label'))
const seg = (name: string | RegExp) => screen.getByRole('spinbutton', { name })
function inForm(children: ReactNode) {
  const r = render(<form data-testid="f">{children}</form>)
  const form = screen.getByTestId('f') as HTMLFormElement
  return { ...r, form, data: () => new FormData(form) }
}

describe('Calendar constraints', () => {
  it('disables days outside min/max and unavailable days: announced, focusable, not selectable', async () => {
    const user = userEvent.setup(), onSelect = vi.fn()
    render(<Calendar month={new Date(2026, 10, 1)} min={new Date(2026, 10, 9)} max={new Date(2026, 10, 25)} onSelect={onSelect}
      isDateUnavailable={d => d.getDay() === 0 || d.getDay() === 6} today={new Date(2026, 10, 9)} />)
    const early = day('Friday 6 November 2026'), weekend = day('Saturday 14 November 2026'), ok = day('Thursday 12 November 2026')
    expect(early).toHaveAttribute('aria-disabled', 'true')
    expect(weekend).toHaveAttribute('aria-disabled', 'true')
    expect(day('Thursday 26 November 2026')).toHaveAttribute('aria-disabled', 'true')
    expect(ok).not.toHaveAttribute('aria-disabled')
    await user.click(weekend)
    expect(onSelect).not.toHaveBeenCalled()
    expect(weekend).toHaveFocus() // still focusable
    await user.click(ok)
    expect(onSelect).toHaveBeenCalledWith(new Date(2026, 10, 12))
    expect(day('Monday 9 November 2026')).toHaveAttribute('aria-current', 'date')
    // the month is bounded on both sides
    expect(screen.getByRole('button', { name: 'Previous month' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Next month' })).toBeDisabled()
  })

  it('a range cannot start on an unavailable day', async () => {
    const user = userEvent.setup(), onRangeChange = vi.fn()
    render(<Calendar month={new Date(2026, 10, 1)} range={[null, null]} onRangeChange={onRangeChange} isDateUnavailable={d => d.getDate() === 10} />)
    await user.click(day('Tuesday 10 November 2026'))
    expect(onRangeChange).not.toHaveBeenCalled()
    await user.click(day('Wednesday 11 November 2026'))
    expect(onRangeChange).toHaveBeenCalledWith([new Date(2026, 10, 11), null])
  })

  it('DatePicker marks an out-of-range value invalid and stops the submit with a message', async () => {
    const user = userEvent.setup(), onValues = vi.fn()
    render(<Form onValues={onValues}><FormField label="Due" name="due"><DatePicker defaultValue={new Date(2026, 10, 2)} min={new Date(2026, 10, 9)} /></FormField><button>Send</button></Form>)
    const trigger = screen.getByRole('button', { name: /Due/ })
    expect(trigger).toHaveAttribute('aria-invalid', 'true')
    await user.click(screen.getByRole('button', { name: 'Send' }))
    expect(onValues).not.toHaveBeenCalled()
    expect(trigger).toHaveAccessibleDescription('Choose 9 November 2026 or later')
    expect(trigger).toHaveFocus()
  })
})

describe('Calendar week', () => {
  it('starts on Monday with English weekday names', () => {
    render(<Calendar month={new Date(2026, 10, 1)} />)
    expect(headers()).toEqual(['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'])
    expect(screen.getAllByRole('columnheader')[0]).toHaveTextContent('Mon')
    expect(screen.getByRole('grid', { name: 'November 2026' })).toBeInTheDocument()
  })

  it('shows several months, and only the first month’s days in each', () => {
    render(<Calendar month={new Date(2026, 10, 1)} numberOfMonths={2} />)
    expect(screen.getAllByRole('grid').map(g => g.getAttribute('aria-label'))).toEqual(['November 2026', 'December 2026'])
    expect(screen.getAllByRole('button', { name: /^Tuesday,? 1 December 2026$/ })).toHaveLength(1)
  })
})

describe('Calendar keyboard (APG date grid)', () => {
  it('arrows, Home/End, PageUp/PageDown and Shift+Page move focus across months', async () => {
    const user = userEvent.setup()
    render(<Calendar selected={new Date(2026, 10, 12)} month={new Date(2026, 10, 1)} autoFocus />)
    await waitFor(() => expect(day('Thursday 12 November 2026')).toHaveFocus())
    await user.keyboard('{ArrowRight}')
    expect(day('Friday 13 November 2026')).toHaveFocus()
    await user.keyboard('{ArrowDown}')
    expect(day('Friday 20 November 2026')).toHaveFocus()
    await user.keyboard('{Home}')
    expect(day('Monday 16 November 2026')).toHaveFocus()
    await user.keyboard('{End}')
    expect(day('Sunday 22 November 2026')).toHaveFocus()
    await user.keyboard('{PageDown}')
    expect(day('Tuesday 22 December 2026')).toHaveFocus()
    await user.keyboard('{Shift>}{PageUp}{/Shift}')
    expect(day('Monday 22 December 2025')).toHaveFocus()
    expect(screen.getByRole('grid', { name: 'December 2025' })).toBeInTheDocument()
    await user.keyboard('{ArrowLeft}{ArrowUp}')
    expect(day('Sunday 14 December 2025')).toHaveFocus()
  })

  it('Home/End follow the week start, and navigation stops at max', async () => {
    const user = userEvent.setup()
    render(<Calendar selected={new Date(2026, 10, 12)} max={new Date(2026, 10, 24)} autoFocus />)
    await waitFor(() => expect(day('Thursday 12 November 2026')).toHaveFocus())
    await user.keyboard('{Home}')
    expect(day('Monday 9 November 2026')).toHaveFocus()
    await user.keyboard('{PageDown}')
    expect(day('Tuesday 24 November 2026')).toHaveFocus() // clamped to max
  })

  it('Enter picks the focused day; disabled days are skipped by Enter', async () => {
    const user = userEvent.setup(), onSelect = vi.fn()
    render(<Calendar selected={new Date(2026, 10, 12)} onSelect={onSelect} isDateUnavailable={d => d.getDate() === 13} autoFocus />)
    await waitFor(() => expect(day('Thursday 12 November 2026')).toHaveFocus())
    await user.keyboard('{ArrowRight}{Enter}')
    expect(onSelect).not.toHaveBeenCalled()
    await user.keyboard('{ArrowRight}{Enter}')
    expect(onSelect).toHaveBeenCalledWith(new Date(2026, 10, 14))
  })

  it('the caption opens a month grid, then a year grid', async () => {
    const user = userEvent.setup()
    render(<Calendar month={new Date(2026, 10, 1)} min={new Date(2026, 1, 1)} />)
    await user.click(screen.getByRole('button', { name: 'November 2026, choose month and year' }))
    expect(screen.getByRole('button', { name: 'January 2026' })).toHaveAttribute('aria-disabled', 'true') // before min
    expect(screen.getByRole('button', { name: 'November 2026' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: 'November 2026' })).toHaveFocus()
    await user.click(screen.getByRole('button', { name: '2026, choose year' }))
    await user.keyboard('{ArrowDown}{ArrowDown}') // 2026 → 2032: past the page, which turns
    expect(screen.getByRole('button', { name: '2032' })).toHaveFocus()
    await user.click(screen.getByRole('button', { name: '2028' }))
    await user.click(screen.getByRole('button', { name: 'March 2028' }))
    expect(screen.getByRole('grid', { name: 'March 2028' })).toBeInTheDocument()
    // Escape steps back out of the quick picker without closing anything around it
    await user.click(screen.getByRole('button', { name: 'March 2028, choose month and year' }))
    await user.keyboard('{Escape}')
    expect(screen.getByRole('grid', { name: 'March 2028' })).toBeInTheDocument()
  })
})

describe('DateField segments', () => {
  it('day, month, year segments; typing fills and auto-advances', async () => {
    const keys = '08112026', order = ['Day', 'Month', 'Year']
    const user = userEvent.setup(), onChange = vi.fn()
    render(<DateField aria-label="Due" onChange={onChange} />)
    expect(screen.getAllByRole('spinbutton').map(s => s.getAttribute('aria-label'))).toEqual(order)
    await user.click(screen.getAllByRole('spinbutton')[0])
    await user.keyboard(keys)
    expect(onChange).toHaveBeenLastCalledWith(new Date(2026, 10, 8))
    expect(screen.getAllByRole('spinbutton')[2]).toHaveFocus() // advanced to the last segment
  })

  it('advances as soon as a digit cannot be followed (3 in the day, 2 in the month)', async () => {
    const user = userEvent.setup()
    render(<DateField aria-label="Due" />)
    await user.click(seg(/Day/))
    await user.keyboard('4')
    expect(seg(/Month/)).toHaveFocus()
    await user.keyboard('2')
    expect(seg(/Year/)).toHaveFocus()
    expect(seg(/Day/)).toHaveValue('04')
    expect(seg(/Month/)).toHaveValue('02')
  })

  it('arrows step and wrap, Backspace clears digit by digit then moves back, and a clamped day follows the month', async () => {
    const user = userEvent.setup(), onChange = vi.fn()
    render(<DateField aria-label="Due" defaultValue={new Date(2028, 0, 31)} onChange={onChange} />)
    await user.click(seg(/Month/))
    await user.keyboard('{ArrowUp}')
    expect(onChange).toHaveBeenLastCalledWith(new Date(2028, 1, 29)) // 31 Feb → 29 Feb (leap year)
    expect(seg(/Day/)).toHaveValue('29')
    await user.keyboard('{ArrowDown}{ArrowDown}')
    expect(seg(/Month/)).toHaveValue('12') // wraps
    await user.click(seg(/Year/))
    await user.keyboard('{Backspace}')
    expect(seg(/Year/)).toHaveValue('202')
    expect(onChange).toHaveBeenLastCalledWith(null) // incomplete
    await user.keyboard('{Backspace}{Backspace}{Backspace}{Backspace}')
    expect(seg(/Month/)).toHaveFocus()
    expect(seg(/Year/)).toHaveAttribute('aria-valuetext', 'Empty')
  })

  it('pastes ISO and day/month/year dates', async () => {
    const user = userEvent.setup(), onChange = vi.fn()
    const { unmount } = render(<DateField aria-label="Due" onChange={onChange} />)
    await user.click(seg(/Day/))
    await user.paste('2026-11-08')
    expect(onChange).toHaveBeenLastCalledWith(new Date(2026, 10, 8))
    unmount()
    render(<DateField aria-label="Due" onChange={onChange} />)
    await user.click(seg(/Day/))
    await user.paste('24/12/2026')
    expect(onChange).toHaveBeenLastCalledWith(new Date(2026, 11, 24))
  })

  it('a half-typed date blocks the submit with a message; min/max are checked', async () => {
    const user = userEvent.setup(), onValues = vi.fn()
    render(<Form onValues={onValues}><FormField label="Start" name="start"><DateField max={new Date(2026, 11, 31)} /></FormField><button>Send</button></Form>)
    await user.click(seg(/Day/))
    await user.keyboard('0811')
    await user.click(screen.getByRole('button', { name: 'Send' }))
    expect(onValues).not.toHaveBeenCalled()
    expect(seg(/Day/)).toHaveFocus()
    expect(seg(/Day/)).toHaveAccessibleDescription('Enter a complete date')
    await user.click(seg(/Year/))
    await user.keyboard('2027')
    await user.click(screen.getByRole('button', { name: 'Send' }))
    expect(seg(/Day/)).toHaveAccessibleDescription('Choose 31 December 2026 or earlier')
    await user.click(seg(/Year/))
    await user.keyboard('{ArrowDown}')
    await user.click(screen.getByRole('button', { name: 'Send' }))
    expect(onValues).toHaveBeenCalledTimes(1)
    expect(onValues.mock.calls[0][0].get('start')).toBe('2026-11-08')
  })
})

describe('TimeField, 24- and 12-hour', () => {
  it('24-hour: type 0930, step with arrows, wrap', async () => {
    const user = userEvent.setup(), onChange = vi.fn()
    render(<TimeField aria-label="Start" onChange={onChange} />)
    expect(screen.getAllByRole('spinbutton')).toHaveLength(2)
    await user.click(seg(/Hour/))
    await user.keyboard('0930')
    expect(onChange).toHaveBeenLastCalledWith('09:30')
    await user.keyboard('{ArrowUp}')
    expect(onChange).toHaveBeenLastCalledWith('09:31')
    await user.click(seg(/Hour/))
    await user.keyboard('{ArrowDown}'.repeat(10))
    expect(onChange).toHaveBeenLastCalledWith('23:31')
  })

  it('12-hour clock: am/pm segment, "p" sets pm, value stays 24-hour', async () => {
    const user = userEvent.setup(), onChange = vi.fn()
    render(<TimeField aria-label="Start" hourCycle={12} onChange={onChange} />)
    expect(screen.getAllByRole('spinbutton').map(s => s.getAttribute('aria-label'))).toEqual(['Hour', 'Minute', 'Am/pm'])
    await user.click(seg(/Hour/))
    await user.keyboard('930p')
    expect(onChange).toHaveBeenLastCalledWith('21:30')
    expect(seg(/Am\/pm/)).toHaveValue('pm')
    await user.keyboard('{ArrowUp}')
    expect(onChange).toHaveBeenLastCalledWith('09:30')
  })

  it('hourCycle and granularity override the locale; paste reads "2:30 PM"', async () => {
    const user = userEvent.setup(), onChange = vi.fn()
    render(<TimeField aria-label="Start" hourCycle={12} granularity="second" onChange={onChange} />)
    expect(screen.getAllByRole('spinbutton')).toHaveLength(4)
    await user.click(seg(/Hour/))
    await user.paste('2:30:15 PM')
    expect(onChange).toHaveBeenLastCalledWith('14:30:15')
  })

  it('TimePicker keeps its 0.3 props, adds suggestions, and submits "HH:MM"', async () => {
    const user = userEvent.setup()
    const { data } = inForm(<TimePicker name="time" aria-label="Time" defaultValue="09:30" step={30} from={8 * 60} to={11 * 60} min="08:30" />)
    expect(data().get('time')).toBe('09:30')
    await user.click(screen.getByRole('combobox', { name: 'Show times' }))
    const list = screen.getByRole('listbox', { name: 'Suggested times' })
    expect(within(list).getAllByRole('option').map(o => o.textContent)).toEqual(['08:00', '08:30', '09:00', '09:30', '10:00', '10:30'])
    expect(within(list).getByRole('option', { name: '08:00' })).toHaveAttribute('aria-disabled', 'true')
    expect(within(list).getByRole('option', { name: '09:30' })).toHaveAttribute('aria-selected', 'true')
    await user.click(within(list).getByRole('option', { name: '10:30' }))
    expect(data().get('time')).toBe('10:30')
    expect(seg(/Hour/)).toHaveValue('10')
  })
})

describe('time zones', () => {
  it('offsets in Europe/London around the 2026 changes', () => {
    expect(zoneOffset('Europe/London', Date.UTC(2026, 2, 29, 0, 59))).toBe(0)
    expect(zoneOffset('Europe/London', Date.UTC(2026, 2, 29, 1, 0))).toBe(60)
    expect(zoneOffset('Europe/London', Date.UTC(2026, 9, 25, 0, 59))).toBe(60)
    expect(zoneOffset('Europe/London', Date.UTC(2026, 9, 25, 1, 0))).toBe(0)
    expect(zonedParts(Date.UTC(2026, 6, 1, 8), 'Europe/London')).toEqual({ year: 2026, month: 7, day: 1, hour: 9, minute: 0, second: 0 })
    expect(toZonedISO(Date.UTC(2026, 10, 8, 8, 30), 'Europe/Zurich')).toBe('2026-11-08T09:30:00+01:00')
    expect(toZonedISO(Date.UTC(2026, 10, 8, 8, 30), 'America/New_York')).toBe('2026-11-08T03:30:00-05:00')
  })

  it('a skipped wall time moves forward; a repeated one takes the first (summer-time) instant', () => {
    const gap = zonedDate({ year: 2026, month: 3, day: 29, hour: 1, minute: 30 }, 'Europe/London')
    expect(toZonedISO(gap, 'Europe/London')).toBe('2026-03-29T02:30:00+01:00')
    const twice = zonedDate({ year: 2026, month: 10, day: 25, hour: 1, minute: 30 }, 'Europe/London')
    expect(toZonedISO(twice, 'Europe/London')).toBe('2026-10-25T01:30:00+01:00')
    expect(toZonedISO(zonedDate({ year: 2026, month: 10, day: 25, hour: 2, minute: 30 }, 'Europe/London'), 'Europe/London')).toBe('2026-10-25T02:30:00+00:00')
  })

  it('DateTimeField emits ISO with the zone’s offset on either side of the change, and shows a skipped time moved on', async () => {
    const user = userEvent.setup(), onChange = vi.fn()
    render(<DateTimeField aria-label="Meeting" timeZone="Europe/London" onChange={onChange} />)
    expect(screen.getByText('GMT')).toBeInTheDocument() // the zone's short name follows the time
    await user.click(seg(/Day/))
    await user.keyboard('280320260130')
    expect(onChange).toHaveBeenLastCalledWith('2026-03-28T01:30:00+00:00', { date: new Date(Date.UTC(2026, 2, 28, 1, 30)), timeZone: 'Europe/London' })
    await user.click(seg(/Day/))
    await user.keyboard('29')
    expect(onChange).toHaveBeenLastCalledWith('2026-03-29T02:30:00+01:00', expect.anything())
    expect(seg(/Hour/)).toHaveValue('02')
    expect(screen.getByText('BST')).toBeInTheDocument()
    await user.click(seg(/Month/))
    await user.keyboard('10')
    expect(onChange).toHaveBeenLastCalledWith('2026-10-29T02:30:00+00:00', expect.anything())
  })

  it('reads a value with another offset as that instant in its own zone; pasting an instant converts it', async () => {
    const user = userEvent.setup(), onChange = vi.fn()
    render(<DateTimeField aria-label="Meeting" timeZone="Asia/Tokyo" defaultValue="2026-11-08T09:30:00+01:00" onChange={onChange} />)
    expect(seg(/Hour/)).toHaveValue('17')
    await user.click(seg(/Day/))
    await user.paste('2026-11-10T00:00:00Z')
    expect(onChange).toHaveBeenLastCalledWith('2026-11-10T09:00:00+09:00', expect.anything())
  })

  it('DateTimePicker: the calendar sets the date (midnight when no time yet); a new zone keeps the wall time', async () => {
    const user = userEvent.setup()
    function Demo() {
      const [v, setV] = useState<string | null>(null)
      const [tz, setTz] = useState('Europe/Zurich')
      return <><DateTimePicker aria-label="Kick-off" value={v} onChange={setV} timeZone={tz} onTimeZoneChange={setTz} timeZonePicker /><output>{v ?? 'null'}</output></>
    }
    render(<Demo />)
    const out = () => document.querySelector('output')!.textContent
    await user.click(screen.getByRole('button', { name: 'Choose a date' }))
    const dialog = screen.getByRole('dialog', { name: 'Choose date and time' })
    await user.click(within(dialog).getAllByRole('button', { name: /^\w+,? 15 \w+ \d{4}$/ })[0])
    expect(out()).toMatch(/^\d{4}-\d\d-15T00:00:00\+0[12]:00$/)
    await user.click(within(dialog).getByRole('spinbutton', { name: /Hour/ }))
    await user.keyboard('0930')
    expect(out()).toMatch(/-15T09:30:00\+0[12]:00$/)
    await user.click(within(dialog).getByRole('button', { name: 'Done' }))
    const zone = screen.getByRole('combobox', { name: 'Time zone' })
    await user.clear(zone)
    await user.type(zone, 'New York{ArrowDown}{Enter}')
    expect(out()).toMatch(/-15T09:30:00-0[45]:00$/)
  })

  it('timeZoneOptions lists every zone with its offset, sorted by it; TimeZonePicker is a form field', () => {
    const opts = timeZoneOptions(Date.UTC(2026, 0, 15))
    expect(opts.length).toBeGreaterThan(300)
    expect(opts.find(o => o.value === 'Europe/Zurich')?.label).toBe('(GMT+01:00) Europe/Zurich')
    expect(opts.find(o => o.value === 'America/New_York')?.label).toBe('(GMT-05:00) America/New York')
    expect(opts.findIndex(o => o.value === 'America/New_York')).toBeLessThan(opts.findIndex(o => o.value === 'Europe/Zurich'))
    const { data } = inForm(<TimeZonePicker name="tz" aria-label="Zone" defaultValue="Asia/Tokyo" />)
    expect(data().get('tz')).toBe('Asia/Tokyo')
  })
})

describe('FormData from the date controls', () => {
  it('serialises each as documented, and empty ones the way native fields do', () => {
    const { data } = inForm(<>
      <DateField name="d" aria-label="d" defaultValue={new Date(2026, 10, 8)} />
      <TimeField name="t" aria-label="t" defaultValue="09:30" />
      <TimeField name="ts" aria-label="ts" granularity="second" defaultValue="09:30:15" />
      <DateTimeField name="dt" aria-label="dt" timeZone="Europe/London" timeZoneName="dt_tz" defaultValue="2026-11-08T09:30:00+00:00" />
      <DateTimePicker name="dtp" aria-label="dtp" timeZone="Europe/Zurich" defaultValue={new Date(Date.UTC(2026, 6, 1, 7, 30))} />
      <MonthPicker name="m" defaultValue={new Date(2026, 10, 1)} />
      <YearPicker name="y" defaultValue={2026} />
      <DateField name="d0" aria-label="d0" />
      <TimeField name="t0" aria-label="t0" />
      <DateTimeField name="dt0" aria-label="dt0" />
      <MonthPicker name="m0" />
      <YearPicker name="y0" />
    </>)
    const d = data()
    expect(d.get('d')).toBe('2026-11-08')
    expect(d.get('t')).toBe('09:30')
    expect(d.get('ts')).toBe('09:30:15')
    expect(d.get('dt')).toBe('2026-11-08T09:30:00+00:00')
    expect(d.get('dt_tz')).toBe('Europe/London')
    expect(d.get('dtp')).toBe('2026-07-01T09:30:00+02:00')
    expect(d.get('m')).toBe('2026-11')
    expect(d.get('y')).toBe('2026')
    for (const k of ['d0', 't0', 'dt0', 'm0', 'y0']) expect(d.get(k)).toBe('')
  })

  it('form reset returns typed fields to their defaults, partial segments included', async () => {
    const user = userEvent.setup()
    const { form, data } = inForm(<><DateField name="d" aria-label="d" defaultValue={new Date(2026, 10, 8)} /><TimeField name="t" aria-label="t" /></>)
    await user.click(screen.getAllByRole('spinbutton', { name: /Day/ })[0])
    await user.keyboard('{ArrowUp}')
    await user.click(screen.getAllByRole('spinbutton', { name: /Hour/ })[0])
    await user.keyboard('1')
    expect(data().get('d')).toBe('2026-11-09')
    act(() => form.reset())
    await waitFor(() => expect(Object.fromEntries(data())).toEqual({ d: '2026-11-08', t: '' }))
    expect(screen.getAllByRole('spinbutton', { name: /Hour/ })[0]).toHaveValue('')
  })

  it('required, disabled and read-only behave like native fields', async () => {
    const user = userEvent.setup()
    const { form, data } = inForm(<>
      <DateField name="req" aria-label="req" required />
      <DateField name="off" aria-label="off" disabled defaultValue={new Date(2026, 10, 8)} />
      <TimeField name="ro" aria-label="ro" readOnly defaultValue="10:00" />
    </>)
    expect(form.checkValidity()).toBe(false)
    expect(data().has('off')).toBe(false)
    const ro = screen.getAllByRole('spinbutton', { name: /ro Hour|Hour/ }).find(s => s.hasAttribute('readonly'))!
    await user.click(ro)
    await user.keyboard('{ArrowUp}5')
    expect(data().get('ro')).toBe('10:00')
  })

  it('DateRangePicker and DatePicker show their dates', () => {
    render(<>
      <DatePicker defaultValue={new Date(2026, 10, 8)} aria-label="x" />
      <DateRangePicker defaultValue={[new Date(2026, 10, 1), new Date(2026, 10, 7)]} />
    </>)
    expect(screen.getByText('Sun, 8 Nov 2026')).toBeInTheDocument()
    expect(screen.getByText(/^1\s*–\s*7 Nov 2026$/)).toBeInTheDocument()
    expect(screen.getByText('7 days')).toBeInTheDocument()
  })
})

const PEOPLE: Option[] = [
  { value: 'ada', label: 'Ada Lovelace', group: 'Engineering' }, { value: 'alan', label: 'Alan Turing', group: 'Engineering' },
  { value: 'dieter', label: 'Dieter Rams', group: 'Design' }, { value: 'marie', label: 'Marie Curie', group: 'Research' },
]

describe('async MultiSelect', () => {
  it('debounces, aborts superseded queries, groups results, toggles picks and submits each value', async () => {
    const user = userEvent.setup()
    const calls: string[] = [], aborted: string[] = []
    const load = vi.fn((q: string, { signal }: { signal: AbortSignal }) => {
      calls.push(q)
      signal.addEventListener('abort', () => aborted.push(q))
      return new Promise<Option[]>(r => setTimeout(() => r(PEOPLE.filter(p => p.label.toLowerCase().includes(q.toLowerCase()))), 30))
    })
    const { data } = inForm(<MultiSelect name="who" aria-label="Reviewers" loadOptions={load} debounce={20} defaultValue={['dieter']} defaultOptions={[PEOPLE[2]]} />)
    expect(screen.getByText('Dieter Rams')).toBeInTheDocument() // labelled from defaultOptions
    const input = screen.getByRole('combobox', { name: 'Reviewers' })
    await user.type(input, 'a')
    await user.type(input, 'l')
    await waitFor(() => expect(screen.getByRole('option', { name: 'Alan Turing' })).toBeInTheDocument())
    expect(calls.at(-1)).toBe('al')
    expect(calls.filter(q => q !== 'al').every(q => aborted.includes(q))).toBe(true) // superseded requests were aborted
    expect(screen.getByRole('group', { name: 'Engineering' })).toBeInTheDocument()
    await user.keyboard('{Enter}')
    expect(screen.getByRole('listbox')).toBeInTheDocument() // stays open for more picks
    expect(data().getAll('who')).toEqual(['dieter', 'alan'])
    await user.clear(input)
    await user.type(input, 'ada')
    await waitFor(() => expect(screen.getByRole('option', { name: 'Ada Lovelace' })).toBeInTheDocument())
    await user.click(screen.getByRole('option', { name: 'Ada Lovelace' }))
    expect(data().getAll('who')).toEqual(['dieter', 'alan', 'ada'])
    await user.click(screen.getByRole('option', { name: 'Ada Lovelace' }))
    expect(data().getAll('who')).toEqual(['dieter', 'alan'])
    // chips keep their labels after the query changes
    await user.clear(input)
    await user.type(input, 'zzz')
    await waitFor(() => expect(screen.getByText('No matches for “zzz”')).toBeInTheDocument())
    expect(screen.getByText('Alan Turing')).toBeInTheDocument()
    await user.clear(input)
    await user.keyboard('{Backspace}')
    expect(data().getAll('who')).toEqual(['dieter'])
  })

  it('shows an error with Retry, and creates new items', async () => {
    const user = userEvent.setup()
    let fail = true
    const load = vi.fn(async (q: string) => { if (fail) throw new Error('down'); return PEOPLE.filter(p => p.label.toLowerCase().includes(q.toLowerCase())) })
    const onCreate = vi.fn((text: string) => ({ value: `new:${text}`, label: text }))
    const { data } = inForm(<MultiSelect name="who" aria-label="Reviewers" loadOptions={load} debounce={0} creatable onCreate={onCreate} />)
    const input = screen.getByRole('combobox', { name: 'Reviewers' })
    await user.type(input, 'Grace')
    await waitFor(() => expect(screen.getByText('Couldn’t load results')).toBeInTheDocument())
    fail = false
    await user.click(screen.getByRole('button', { name: 'Retry' }))
    await waitFor(() => expect(screen.getByRole('option', { name: /Create “Grace”/ })).toBeInTheDocument())
    await user.click(screen.getByRole('option', { name: /Create “Grace”/ }))
    expect(onCreate).toHaveBeenCalledWith('Grace')
    expect(data().getAll('who')).toEqual(['new:Grace'])
    expect(screen.getByRole('button', { name: 'Remove Grace' })).toBeInTheDocument()
  })

  it('the static path keeps working: Backspace removes the last chip', async () => {
    render(<MultiSelect aria-label="Labels" options={PEOPLE} defaultValue={['ada']} />)
    const box = screen.getByRole('combobox', { name: 'Labels' })
    fireEvent.keyDown(box, { key: 'Backspace' })
    await waitFor(() => expect(screen.queryByText('Ada Lovelace')).toBeNull())
  })
})
