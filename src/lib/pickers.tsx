import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode, type Ref, type KeyboardEvent as RKeyboardEvent } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { FormFieldContext, LOCALE, type FormControlProps, formDate, formDisabledClass, formReadOnlyClass, useFormControl, Badge, Button, type HourCycle, type MessageDefs, type MessageKeyOf, type ModuleTranslate, type WeekDay, createMessagesTranslator, dateFormat, defineMessages, dirX, inputClass, localeHourCycle, localeWeekStart, logicalArrow, numberFormat, useLocale, addDays, addMonths, cn, fmtDate, isTouch, menuItemClass, sameDay, spring, startOfDay, useControllable, useDir, useDisclosure, usePointerDrag, useRoving } from './core'
import { play } from './motion'
import { FloatingPanel, Popover, PopoverContent, type Placement, usePopover } from './overlay'
import { formsAssignRef, formsMergeRefs, formsPlacement, formsScrollIntoList, formsTriggerClass } from './formkit'
import { SegmentedControl, inputShellClass } from './fields'
import { Combobox } from './select'

/* Dates ─────────────────────────────────────────────────────────────────────── */
//
// Values (README "Forms" has the FormData table):
//   Calendar, DatePicker, DateField  a local Date at midnight; submitted as "2026-11-08" (like <input type="date">)
//   DateRangePicker                  [start, end] local Dates; two fields "2026-11-01", "2026-11-07"
//   TimeField, TimePicker            "09:30" (24-hour wall time; "09:30:15" with granularity="second"); '' while empty
//   DateTimeField, DateTimePicker    ISO 8601 with the offset of `timeZone` at that instant: "2026-11-08T09:30:00+01:00"
//                                    (new Date(value) is the instant); null while empty, submitted as '' then
//   MonthPicker "2026-11" · YearPicker "2026" · TimeZonePicker "Europe/Zurich"
// Locale, week start, hour cycle and time zone default to useLocale() (UIProvider); props win.

/** Format a date ("8 Nov 2026" in en-GB); same as core `fmtDate`. Pass `locale` for another language. */
export const formatDate = (d?: Date | null, opts?: Intl.DateTimeFormatOptions, locale?: string) => fmtDate(d, opts, locale)

/** A date range [start, end]; either side may be null while it is being picked. */
export type DateRange = [Date | null, Date | null]
/** Wall-clock fields of a date and time (month 1–12), as `zonedParts` returns them. */
export type ZonedParts = { year: number; month: number; day: number; hour: number; minute: number; second: number }
/** How fine a date-time field goes: 'day' is the date alone, 'hour' | 'minute' (default) | 'second' add the time. */
export type DateGranularity = 'day' | 'hour' | 'minute' | 'second'

type DatesSegType = 'year' | 'month' | 'day' | 'hour' | 'minute' | 'second' | 'dayPeriod'
type DatesPart = { type: DatesSegType } | { type: 'literal'; text: string }
/** What each segment holds: `hour` as shown (1–12 on a 12-hour clock), `dayPeriod` 0 am / 1 pm. */
type DatesVals = Partial<Record<DatesSegType, number | null>>
const DATES_SEGS: string[] = ['year', 'month', 'day', 'hour', 'minute', 'second', 'dayPeriod']
const datesPad = (n: number, w = 2) => String(n).padStart(w, '0')
const datesLeap = (y: number) => y % 4 === 0 && (y % 100 !== 0 || y % 400 === 0)
/** Days in month `m` (1–12) of year `y`. */
const datesDim = (y: number, m: number) => m === 2 ? (datesLeap(y) ? 29 : 28) : [4, 6, 9, 11].includes(m) ? 30 : 31
/** A local Date at midnight (years below 100 stay as given instead of becoming 19xx). */
const datesLocal = (y: number, m: number, d: number) => { const t = new Date(2000, 0, 1); t.setFullYear(y, m - 1, d); return t }
/** Milliseconds of a wall time read as if it were UTC. */
const datesUTC = (w: ZonedParts) => { const t = new Date(Date.UTC(2000, 0, 1, w.hour, w.minute, w.second)); t.setUTCFullYear(w.year, w.month - 1, w.day); return +t }
const datesSafeZone = (tz: string) => { try { dateFormat('en-US', { timeZone: tz }); return tz } catch { return 'UTC' } }
const datesSafeLocale = (l: string) => { try { return Intl.getCanonicalLocales(l)[0] ?? LOCALE } catch { return LOCALE } }
const datesIs12 = (hc: string | number | undefined) => hc === 12 || hc === 'h11' || hc === 'h12'

const datesCache = new Map<string, unknown>()
function datesMemo<T>(k: string, make: () => T): T {
  if (!datesCache.has(k)) datesCache.set(k, make())
  return datesCache.get(k) as T
}

/** Wall-clock fields of the instant `at` in the IANA `timeZone`: zonedParts(Date.UTC(2026, 6, 1, 8), 'Europe/London').hour → 9. */
export function zonedParts(at: Date | number, timeZone: string): ZonedParts {
  const f = dateFormat('en-US', { timeZone: datesSafeZone(timeZone), hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric' })
  const o: Record<string, number> = {}
  for (const p of f.formatToParts(at)) if (p.type !== 'literal') o[p.type] = Number(p.value)
  return { year: o.year, month: o.month, day: o.day, hour: o.hour % 24, minute: o.minute, second: o.second }
}
/** UTC offset of `timeZone` at `at`, in minutes east of UTC (Europe/London: 0 in winter, 60 in summer). */
export function zoneOffset(timeZone: string, at: Date | number = Date.now()): number {
  const t = Math.floor(+at / 1000) * 1000
  return Math.round((datesUTC(zonedParts(t, timeZone)) - t) / 6e4)
}
/**
 * The instant a wall-clock time names in `timeZone`. A time the clocks skip moves forward by the gap (01:30 on the
 * spring-forward night in London is 02:30 BST); a time that happens twice is the first one (still summer time), like
 * Temporal's 'compatible'. zonedDate({ year: 2026, month: 11, day: 8, hour: 9, minute: 30 }, 'Europe/Zurich').
 */
export function zonedDate(wall: Partial<ZonedParts> & { year: number; month: number; day: number }, timeZone: string): Date {
  const w: ZonedParts = { hour: 0, minute: 0, second: 0, ...wall }
  const u = datesUTC(w), before = zoneOffset(timeZone, u - 864e5), after = zoneOffset(timeZone, u + 864e5)
  const hits = [...new Set([before, after])].map(o => u - o * 6e4).filter(t => zoneOffset(timeZone, t) === Math.round((u - t) / 6e4)).sort((a, b) => a - b)
  return new Date(hits[0] ?? u - before * 6e4)
}
const datesOffsetText = (min: number) => `${min < 0 ? '-' : '+'}${datesPad(Math.floor(Math.abs(min) / 60))}:${datesPad(Math.abs(min) % 60)}`
/** ISO 8601 with the zone's offset at that instant: toZonedISO(date, 'Europe/Zurich') → "2026-11-08T09:30:00+01:00". */
export function toZonedISO(at: Date | number, timeZone: string): string {
  const w = zonedParts(at, timeZone)
  return `${datesPad(w.year, 4)}-${datesPad(w.month)}-${datesPad(w.day)}T${datesPad(w.hour)}:${datesPad(w.minute)}:${datesPad(w.second)}${datesOffsetText(zoneOffset(timeZone, at))}`
}

const DATES_ISO = /^\s*(\d{4,})-(\d{1,2})-(\d{1,2})(?:[T\s](\d{1,2}):(\d{2})(?::(\d{2})(?:[.,]\d+)?)?)?\s*(Z|[+-]\d{2}(?::?\d{2})?)?(?:\[[^\]]*\])?\s*$/i
const DATES_ISO_TIME = /^\s*T?(\d{1,2}):(\d{2})(?::(\d{2})(?:[.,]\d+)?)?\s*$/i
/** "2026-11-08", "2026-11-08T09:30", "…+01:00" or "…Z": the wall fields, whether a time was given, and the instant when an offset was. */
function datesParseISO(s: string): { wall: ZonedParts; time: boolean; at?: number } | null {
  const m = DATES_ISO.exec(s)
  if (!m) return null
  const wall = { year: +m[1], month: +m[2], day: +m[3], hour: +(m[4] ?? 0), minute: +(m[5] ?? 0), second: +(m[6] ?? 0) }
  if (wall.month < 1 || wall.month > 12 || wall.day < 1 || wall.day > datesDim(wall.year, wall.month) || wall.hour > 23 || wall.minute > 59 || wall.second > 59) return null
  let at: number | undefined
  if (m[7]) {
    const z = m[7].toUpperCase(), digits = z.slice(1).replace(':', '')
    at = datesUTC(wall) - (z === 'Z' ? 0 : (z[0] === '-' ? -1 : 1) * (+digits.slice(0, 2) * 60 + +(digits.slice(2, 4) || 0))) * 6e4
  }
  return { wall, time: m[4] !== undefined, at }
}

/** A Gregorian Intl.DateTimeFormat (cached), whatever calendar the locale uses by default. */
const datesDF = (locale: string, o: Intl.DateTimeFormatOptions) => dateFormat(locale, { calendar: 'gregory', ...o })
/** `n` in the locale's digits, zero-padded to `width` (ar-EG: ٠٨). */
const datesNum = (locale: string, n: number, width = 1) => numberFormat(locale, { useGrouping: false, minimumIntegerDigits: width }).format(n)
/** Arabic-Indic, Persian and full-width digits to ASCII, for typing and pasting. */
const datesAscii = (s: string) => s.replace(/[٠-٩۰-۹０-９]/g, c => {
  const k = c.charCodeAt(0)
  return String(k - (k >= 0xff10 ? 0xff10 : k >= 0x06f0 ? 0x06f0 : 0x0660))
})
/** Weekday names, Sunday first: short (narrow where short names run long, as in Arabic) and long. */
const datesWeekdays = (locale: string) => datesMemo(`wd${locale}`, () => {
  const names = (weekday: 'short' | 'narrow' | 'long') => Array.from({ length: 7 }, (_, i) => datesDF(locale, { weekday, timeZone: 'UTC' }).format(Date.UTC(2024, 0, 7 + i)))
  const short = names('short')
  return { short: short.some(s => s.length > 4) ? names('narrow') : short, long: names('long') }
})
const datesMonthNames = (locale: string, month: 'short' | 'long') => datesMemo(`mo${locale}${month}`, () =>
  Array.from({ length: 12 }, (_, i) => datesDF(locale, { month, timeZone: 'UTC' }).format(Date.UTC(2024, i, 15))))
/** The locale's am/pm words: ["AM", "PM"], ["午前", "午後"], ["ص", "م"]. */
const datesPeriods = (locale: string) => datesMemo(`dp${locale}`, () => [1, 13].map(h =>
  datesDF(locale, { hour: 'numeric', hourCycle: 'h12', timeZone: 'UTC' }).formatToParts(Date.UTC(2024, 0, 1, h)).find(p => p.type === 'dayPeriod')?.value ?? (h < 12 ? 'AM' : 'PM')))
const DATES_FIELD_EN: Record<DatesSegType, string> = { year: 'Year', month: 'Month', day: 'Day', hour: 'Hour', minute: 'Minute', second: 'Second', dayPeriod: 'AM/PM' }
/** A segment's localised name ("Day", "Tag", "日"), its accessible name. */
const datesFieldName = (locale: string, t: DatesSegType) => datesMemo(`fn${locale}${t}`, () => {
  try { const s = new Intl.DisplayNames(locale, { type: 'dateTimeField' }).of(t); if (s) return s[0].toLocaleUpperCase(locale) + s.slice(1) } catch { /* old engine */ }
  return DATES_FIELD_EN[t]
})
/** An empty segment's placeholder: "dd", "mm", "yyyy" (de-DE "tt.mm.jjjj"); dashes where the field name isn't Latin, and for the time. */
const datesPlaceholder = (locale: string, t: DatesSegType) => datesMemo(`ph${locale}${t}`, () => {
  const n = t === 'year' ? 4 : 2, c = datesFieldName(locale, t)[0].toLowerCase()
  return (t === 'year' || t === 'month' || t === 'day') && /[a-z]/.test(c) ? c.repeat(n) : '–'.repeat(n)
})
/** The zone's short name at an instant in the locale: "GMT", "BST", "CET", "GMT-5". */
const datesZoneName = (locale: string, timeZone: string, at: number) =>
  datesDF(locale, { timeZone, timeZoneName: 'short' }).formatToParts(at).find(p => p.type === 'timeZoneName')?.value ?? timeZone

/**
 * The date controls draw their few icons themselves (the same paths as core's ICONS), so a copied-in date or time
 * field doesn't carry the whole icon set.
 */
const DATES_GLYPHS = {
  calendar: 'M4 6h16v15H4zM4 10h16M8 3v4M16 3v4', clock: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 7v5l3 2', check: 'M5 12l5 5L20 7',
  chevronDown: 'm6 9 6 6 6-6', chevronLeft: 'm15 18-6-6 6-6', chevronRight: 'm9 18 6-6-6-6', globe: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM3 12h18M12 3c2.5 2.7 2.5 15.3 0 18M12 3c-2.5 2.7-2.5 15.3 0 18',
}
type DatesGlyphName = keyof typeof DATES_GLYPHS
function DatesGlyph({ name, size = 15, className }: { name: DatesGlyphName; size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden className={cn('flex-none', className)}>
      <path d={DATES_GLYPHS[name]} />
    </svg>
  )
}
/** A small icon button inside a date field or calendar header (28px, 36px on touch). */
const DATES_ICON_BTN = 'grid h-7 w-7 flex-none place-items-center rounded-[var(--r-md)] border-0 bg-transparent p-0 text-[var(--fg3)] transition-colors enabled:cursor-pointer enabled:hover:bg-[var(--muted)] enabled:hover:text-[var(--fg)] disabled:opacity-40 [@media(pointer:coarse)]:h-9 [@media(pointer:coarse)]:w-9'

/** The locale's segments and separators: en-GB dd/mm/yyyy, en-US mm/dd/yyyy, de-DE dd.mm.yyyy, ja-JP yyyy/mm/dd, then the time. */
function datesTemplate(locale: string, date: boolean, gran: DateGranularity | null, h12: boolean): DatesPart[] {
  const o: Intl.DateTimeFormatOptions = { timeZone: 'UTC' }
  if (date) Object.assign(o, { year: 'numeric', month: '2-digit', day: '2-digit' })
  if (gran && gran !== 'day') {
    o.hour = '2-digit'; o.hourCycle = h12 ? 'h12' : 'h23'
    if (gran !== 'hour') o.minute = '2-digit'
    if (gran === 'second') o.second = '2-digit'
  }
  return datesMemo(`tp${locale}${JSON.stringify(o)}`, () => {
    const out: DatesPart[] = []
    for (const p of datesDF(locale, o).formatToParts(Date.UTC(2026, 10, 8, 21, 5, 7))) {
      if (DATES_SEGS.includes(p.type)) { out.push({ type: p.type as DatesSegType }); continue }
      const text = p.value.replace(/[‎‏؜]/g, ''), prev = out[out.length - 1]
      if (!text) continue
      if (prev?.type === 'literal') prev.text += text
      else out.push({ type: 'literal', text })
    }
    while (out[0]?.type === 'literal') out.shift()
    while (out[out.length - 1]?.type === 'literal') out.pop()
    return out
  })
}
const datesShown = (tpl: DatesPart[]) => tpl.flatMap(p => p.type === 'literal' ? [] : [p.type])
/** A segment's [min, max]; the day's max follows the month (and year) once they are known. */
function datesRange(t: DatesSegType, v: DatesVals, h12: boolean): [number, number] {
  if (t === 'year') return [1, 9999]
  if (t === 'month') return [1, 12]
  if (t === 'day') return [1, v.month ? datesDim(v.year ?? 2024, v.month) : 31]
  if (t === 'hour') return h12 ? [1, 12] : [0, 23]
  if (t === 'dayPeriod') return [0, 1]
  return [0, 59]
}
const datesToVals = (w: Partial<ZonedParts> | null | undefined, h12: boolean): DatesVals => !w ? {} : {
  year: w.year, month: w.month, day: w.day, minute: w.minute, second: w.second,
  ...(w.hour != null && { hour: h12 ? w.hour % 12 || 12 : w.hour, dayPeriod: w.hour >= 12 ? 1 : 0 }),
}
/** The wall time the segments spell, or null while a shown segment is empty or the year has fewer than 4 digits. The day is clamped to the month. */
function datesFromVals(v: DatesVals, tpl: DatesPart[], h12: boolean): ZonedParts | null {
  const shown = datesShown(tpl), has = (t: DatesSegType) => shown.includes(t)
  if (shown.some(t => v[t] == null) || (has('year') && v.year! < 1000)) return null
  const year = has('year') ? v.year! : 2000, month = has('month') ? v.month! : 1
  return {
    year, month, day: has('day') ? Math.min(v.day!, datesDim(year, month)) : 1,
    hour: !has('hour') ? 0 : h12 ? (v.hour! % 12) + (v.dayPeriod ? 12 : 0) : v.hour!, minute: has('minute') ? v.minute! : 0, second: has('second') ? v.second! : 0,
  }
}
const datesAnyVal = (v: DatesVals, tpl: DatesPart[]) => datesShown(tpl).some(t => v[t] != null)

/**
 * Read pasted text: ISO first ("2026-11-08", "09:30", "2026-11-08T09:30"), else the numbers in the field's own order
 * ("08.11.2026 09:30" in de-DE, "11/8/2026, 9:30 PM" in en-US). Two-digit years become 20xx.
 */
function datesParseText(text: string, tpl: DatesPart[], locale: string, h12: boolean): DatesVals | null {
  const s = datesAscii(text).trim(), shown = datesShown(tpl)
  const iso = datesParseISO(s)
  if (iso) return datesToVals(iso.time || !shown.includes('year') ? iso.wall : { year: iso.wall.year, month: iso.wall.month, day: iso.wall.day }, h12)
  const tm = !shown.includes('year') && DATES_ISO_TIME.exec(s)
  const tokens = tm ? [tm[1], tm[2], tm[3] ?? '0'] : s.match(/\d+/g) ?? []
  if (!tokens.length) return null
  const v: DatesVals = {}
  shown.filter(t => t !== 'dayPeriod').forEach((t, i) => {
    const tok = tokens[i]
    if (tok === undefined) return
    v[t] = t === 'year' && tok.length <= 2 ? 2000 + Number(tok) : Number(tok)
  })
  if (v.hour != null && (h12 || shown.includes('dayPeriod'))) {
    const low = s.toLocaleLowerCase(locale), [am, pm] = datesPeriods(locale).map(x => x.toLocaleLowerCase(locale))
    const isPm = low.includes(pm) || /\bp\.?\s?m\b/.test(low), isAm = low.includes(am) || /\ba\.?\s?m\b/.test(low)
    if (v.hour > 12) { v.dayPeriod = 1; v.hour -= 12 } else if (v.hour === 0) { v.hour = 12; v.dayPeriod = 0 } else v.dayPeriod = isPm ? 1 : isAm ? 0 : v.hour === 12 ? 1 : 0
  }
  for (const t of shown) {
    const n = v[t]
    if (n == null) continue
    const [lo, hi] = datesRange(t, v, h12)
    if (n < lo || n > hi) return null
  }
  return v
}

/**
 * The typed date and time fields' strings (DateField, TimeField, DateTimeField; machine-drafted de/ar). Keys sit under
 * `date.`: override one with `<UIProvider messages={{ 'date.incomplete': … }}>`.
 */
export const DATE_FIELD_MESSAGES = defineMessages('date', {
  en: {
    blank: 'Empty', incomplete: 'Enter a complete date', incompleteTime: 'Enter a complete time',
    tooEarly: 'Choose {date} or later', tooLate: 'Choose {date} or earlier', unavailable: 'That date isn’t available',
    timeTooEarly: 'Choose {time} or later', timeTooLate: 'Choose {time} or earlier', showTimes: 'Show times', suggestedTimes: 'Suggested times',
  },
  de: {
    blank: 'Leer', incomplete: 'Gib ein vollständiges Datum ein', incompleteTime: 'Gib eine vollständige Uhrzeit ein',
    tooEarly: 'Wähle {date} oder später', tooLate: 'Wähle {date} oder früher', unavailable: 'Dieses Datum ist nicht verfügbar',
    timeTooEarly: 'Wähle {time} oder später', timeTooLate: 'Wähle {time} oder früher', showTimes: 'Uhrzeiten anzeigen', suggestedTimes: 'Vorgeschlagene Uhrzeiten',
  },
  ar: {
    blank: 'فارغ', incomplete: 'أدخل تاريخًا كاملًا', incompleteTime: 'أدخل وقتًا كاملًا',
    tooEarly: 'اختر {date} أو بعده', tooLate: 'اختر {date} أو قبله', unavailable: 'هذا التاريخ غير متاح',
    timeTooEarly: 'اختر {time} أو بعده', timeTooLate: 'اختر {time} أو قبله', showTimes: 'عرض الأوقات', suggestedTimes: 'أوقات مقترحة',
  },
})

/**
 * The calendar's and the date pickers' strings (machine-drafted de/ar), also under `date.` (`date.today`,
 * `date.previousMonth`, `date.nextMonth` and `date.chooseDate` are the built-in catalog's keys, with the same values).
 */
export const DATE_PICKER_MESSAGES = defineMessages('date', {
  en: {
    today: 'Today', yesterday: 'Yesterday', last7: 'Last 7 days', last30: 'Last 30 days', thisMonth: 'This month', lastMonth: 'Last month',
    clear: 'Clear', done: 'Done', pickDate: 'Pick a date', chooseDate: 'Choose a date', pickDates: 'Pick dates', chooseDates: 'Choose dates',
    dayCount: '{count, plural, one {# day} other {# days}}', rangeHintStart: 'Tap or drag to choose dates', rangeHintEnd: 'Choose an end date',
    rangeHintDone: '{count} · drag either end to adjust', chooseDateTime: 'Choose date and time', time: 'Time', timeZone: 'Time zone',
    searchTimeZones: 'Search time zones', noTimeZones: 'No matching time zones', pickMonth: 'Pick a month', chooseMonth: 'Choose a month',
    pickYear: 'Pick a year', chooseYearTitle: 'Choose a year', previousMonth: 'Previous month', nextMonth: 'Next month',
    chooseMonthYear: '{month}, choose month and year', chooseYear: '{year}, choose year', previousYear: 'Previous year', nextYear: 'Next year',
    previousYears: 'Earlier years', nextYears: 'Later years', modeDate: 'Date', modeRange: 'Date range', mode: 'Pick one date or a range',
    from: 'From date', to: 'To date', noDate: 'No date selected', range: '{from} to {to}', singleDay: 'Single day',
  },
  de: {
    today: 'Heute', yesterday: 'Gestern', last7: 'Letzte 7 Tage', last30: 'Letzte 30 Tage', thisMonth: 'Dieser Monat', lastMonth: 'Letzter Monat',
    clear: 'Leeren', done: 'Fertig', pickDate: 'Datum auswählen', chooseDate: 'Datum wählen', pickDates: 'Zeitraum auswählen', chooseDates: 'Zeitraum wählen',
    dayCount: '{count, plural, one {# Tag} other {# Tage}}', rangeHintStart: 'Tippe oder ziehe, um Tage zu wählen', rangeHintEnd: 'Wähle ein Enddatum',
    rangeHintDone: '{count} · ziehe an einem Ende, um anzupassen', chooseDateTime: 'Datum und Uhrzeit wählen', time: 'Uhrzeit', timeZone: 'Zeitzone',
    searchTimeZones: 'Zeitzonen suchen', noTimeZones: 'Keine passende Zeitzone', pickMonth: 'Monat auswählen', chooseMonth: 'Monat wählen',
    pickYear: 'Jahr auswählen', chooseYearTitle: 'Jahr wählen', previousMonth: 'Vorheriger Monat', nextMonth: 'Nächster Monat',
    chooseMonthYear: '{month}, Monat und Jahr wählen', chooseYear: '{year}, Jahr wählen', previousYear: 'Vorheriges Jahr', nextYear: 'Nächstes Jahr',
    previousYears: 'Frühere Jahre', nextYears: 'Spätere Jahre', modeDate: 'Datum', modeRange: 'Zeitraum', mode: 'Ein Datum oder einen Zeitraum wählen',
    from: 'Von', to: 'Bis', noDate: 'Kein Datum ausgewählt', range: '{from} bis {to}', singleDay: 'Ein Tag',
  },
  ar: {
    today: 'اليوم', yesterday: 'أمس', last7: 'آخر 7 أيام', last30: 'آخر 30 يومًا', thisMonth: 'هذا الشهر', lastMonth: 'الشهر الماضي',
    clear: 'مسح', done: 'تم', pickDate: 'اختر تاريخًا', chooseDate: 'اختر تاريخًا', pickDates: 'اختر التواريخ', chooseDates: 'اختر التواريخ',
    dayCount: '{count, plural, zero {# يوم} one {يوم واحد} two {يومان} few {# أيام} many {# يومًا} other {# يوم}}',
    rangeHintStart: 'انقر أو اسحب لاختيار التواريخ', rangeHintEnd: 'اختر تاريخ الانتهاء', rangeHintDone: '{count} · اسحب أيًّا من الطرفين للتعديل',
    chooseDateTime: 'اختر التاريخ والوقت', time: 'الوقت', timeZone: 'المنطقة الزمنية', searchTimeZones: 'ابحث في المناطق الزمنية',
    noTimeZones: 'لا توجد منطقة زمنية مطابقة', pickMonth: 'اختر شهرًا', chooseMonth: 'اختر شهرًا', pickYear: 'اختر سنة', chooseYearTitle: 'اختر سنة',
    previousMonth: 'الشهر السابق', nextMonth: 'الشهر التالي', chooseMonthYear: '{month}، اختر الشهر والسنة', chooseYear: '{year}، اختر السنة',
    previousYear: 'السنة السابقة', nextYear: 'السنة التالية', previousYears: 'سنوات سابقة', nextYears: 'سنوات لاحقة',
    modeDate: 'تاريخ', modeRange: 'نطاق تواريخ', mode: 'اختر تاريخًا واحدًا أو نطاقًا', from: 'من تاريخ', to: 'إلى تاريخ',
    noDate: 'لم يُحدَّد تاريخ', range: '{from} إلى {to}', singleDay: 'يوم واحد',
  },
})
type DatesPickerT = ModuleTranslate<MessageKeyOf<typeof DATE_PICKER_MESSAGES>>

/** Locale, week start, clock and zone for the date controls: props first, then useLocale() (UIProvider), then the runtime's zone. */
function useDatesLocale(p: { locale?: string; weekStartsOn?: number; timeZone?: string; hourCycle?: 12 | 24 | HourCycle }) {
  const ctx = useLocale()
  const locale = datesSafeLocale(p.locale ?? ctx.locale)
  const weekStartsOn = ((p.weekStartsOn ?? (p.locale ? localeWeekStart(locale) : ctx.weekStartsOn)) % 7) as WeekDay
  const h12 = datesIs12(p.hourCycle ?? (p.locale ? localeHourCycle(locale) : ctx.hourCycle))
  // the runtime's zone after hydration (the server renders UTC), so server and client markup match
  const runtimeZone = useSyncExternalStore(datesNoSubscribe, datesRuntimeZone, () => 'UTC')
  const timeZone = datesSafeZone(p.timeZone ?? ctx.timeZone ?? runtimeZone)
  return { locale, weekStartsOn, h12, timeZone, messages: ctx.messages, dir: ctx.dir }
}
/** t() for one of the date catalogs, in the control's locale (a `locale` prop wins over the provider's). */
const datesT = <K extends string>(defs: MessageDefs<K>, L: { locale: string; messages: Partial<Record<string, string>> }) => createMessagesTranslator(defs, L.locale, L.messages)
type DatesL = ReturnType<typeof useDatesLocale>
const datesNoSubscribe = () => () => {}
const datesRuntimeZone = () => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC' } catch { return 'UTC' } }
/** Today's date, read after mount (null on the server and in the first render) so server and client markup match. */
function useDatesToday() {
  const [today, setToday] = useState<Date | null>(null)
  useEffect(() => { setToday(startOfDay(new Date())) }, [])
  return today
}

/** Why a picked day isn't allowed (outside min/max, or unavailable), as a message; null when it's fine. */
function datesDayProblem(d: Date | null | undefined, c: { min?: Date | null; max?: Date | null; isDateUnavailable?: (d: Date) => boolean }, L: DatesL): string | null {
  if (!d) return null
  const tf = datesT(DATE_FIELD_MESSAGES, L)
  const f = (x: Date) => datesDF(L.locale, { day: 'numeric', month: 'long', year: 'numeric' }).format(x)
  if (c.min && d < startOfDay(c.min)) return tf('tooEarly', { date: f(c.min) })
  if (c.max && d > startOfDay(c.max)) return tf('tooLate', { date: f(c.max) })
  if (c.isDateUnavailable?.(d)) return tf('unavailable')
  return null
}

/**
 * A visually hidden input the browser validates with a custom message (an incomplete, out-of-range or unavailable
 * date), so native validation and Form show it under the field and stop the submit; when validation focuses it, focus
 * goes to the real control. Renders nothing while there is no problem.
 */
function DatesValidity({ message, name, form, focus, onInvalid }: { message: string | null; name?: string; form?: string; focus: () => void; onInvalid: () => void }) {
  if (!message) return null
  return (
    <input ref={el => el?.setCustomValidity(message)} tabIndex={-1} aria-hidden form={form} data-ui-field={name} value="x" onChange={() => {}} onFocus={focus} onInvalid={onInvalid}
      className="pointer-events-none absolute start-2 bottom-0 m-0 h-px w-px appearance-none border-0 p-0 opacity-0" />
  )
}

type DatesSegmentsProps = {
  tpl: DatesPart[]; vals: DatesVals; onVals: (v: DatesVals) => void; locale: string; h12: boolean
  /** where ↑/↓ start from in an empty segment (today, midnight) */ seed: () => DatesVals
  /** paste parser; the default reads ISO and the locale's own format */ parse?: (text: string) => DatesVals | null
  disabled: boolean; readOnly: boolean; invalid: boolean; required: boolean; /** aria-valuetext of an empty segment */ emptyText: string
  id?: string; labelledBy?: string; 'aria-label'?: string; describedBy?: string; inputRef?: Ref<HTMLInputElement>
  icon?: DatesGlyphName; suffix?: ReactNode; children?: ReactNode; className?: string
  onKeyDown?: (e: RKeyboardEvent<HTMLDivElement>) => void; onFocusChange?: (within: boolean) => void
}

/**
 * The segment row behind DateField, TimeField and DateTimeField: one spinbutton input per segment, in the locale's
 * order, with its separators. Digits fill a segment and move on once it can't take another; ↑/↓ step it (wrapping),
 * PageUp/PageDown in bigger steps, Home/End to its ends; ←/→ (mirrored in RTL) and separator keys move between segments;
 * Backspace clears digit by digit, then moves back. Paste fills every segment. Typed digits may be Arabic-Indic or full-width.
 */
function DatesSegments(p: DatesSegmentsProps) {
  const uid = useId(), gid = `${uid}g`
  const refs = useRef<(HTMLInputElement | null)[]>([])
  const [buf, setBuf] = useState<{ t: DatesSegType; s: string } | null>(null)
  const segs = datesShown(p.tpl)
  const locked = p.disabled || p.readOnly
  const { vals, locale, h12 } = p
  const periods = datesPeriods(locale)
  const focusAt = (i: number) => { const el = refs.current[Math.max(0, Math.min(segs.length - 1, i))]; el?.focus(); el?.select() }
  const put = (t: DatesSegType, n: number | null) => p.onVals({ ...vals, [t]: n })
  const digit = (i: number, t: DatesSegType, d: string) => {
    const [lo, hi] = datesRange(t, vals, h12), max = t === 'year' ? 4 : String(hi).length
    const live = buf?.t === t && (vals[t] ?? null) === (Number(buf.s) >= lo ? Number(buf.s) : null)
    let s = (live ? buf.s : '') + d
    if (Number(s) > hi || s.length > max) s = d
    const n = Number(s), ok = n >= lo
    put(t, ok ? n : null)
    if (s.length >= max || n * 10 > hi) { setBuf(null); if (ok) focusAt(i + 1) } else setBuf({ t, s })
  }
  const period = (i: number, c: string) => {
    const k = c.toLocaleLowerCase(locale), [am, pm] = periods.map(x => x.toLocaleLowerCase(locale))
    const n = k === 'a' || am.startsWith(k) ? 0 : k === 'p' || pm.startsWith(k) ? 1 : -1
    if (n >= 0) { setBuf(null); put('dayPeriod', n); focusAt(i + 1) }
  }
  const seps = p.tpl.map(x => x.type === 'literal' ? x.text : '').join('') + '/.-:, '
  const char = (i: number, t: DatesSegType, raw: string) => {
    const c = datesAscii(raw)
    if (t === 'dayPeriod') period(i, c)
    else if (/\d/.test(c)) digit(i, t, c)
    else if (seps.includes(c)) { if (vals[t] != null) { setBuf(null); focusAt(i + 1) } }
    else if (segs.includes('dayPeriod')) period(segs.indexOf('dayPeriod'), c) // "9 p" sets pm from the hour
  }
  const step = (t: DatesSegType, key: string) => {
    const [lo, hi] = datesRange(t, vals, h12), cur = vals[t], size = hi - lo + 1
    const big: Record<DatesSegType, number> = { year: 10, month: 3, day: 7, hour: h12 ? 3 : 6, minute: 15, second: 15, dayPeriod: 1 }
    let n: number
    if (key === 'Home' || key === 'End') { if (t === 'year') return; n = key === 'Home' ? lo : hi }
    else if (cur == null) n = Math.min(hi, Math.max(lo, p.seed()[t] ?? lo))
    else {
      const d = key === 'ArrowUp' ? 1 : key === 'ArrowDown' ? -1 : key === 'PageUp' ? big[t] : -big[t]
      n = t === 'year' ? Math.min(hi, Math.max(lo, cur + d)) : lo + ((((cur - lo + d) % size) + size) % size)
    }
    setBuf(null); put(t, n)
  }
  const back = (i: number, t: DatesSegType) => {
    if (t === 'dayPeriod') { if (vals.dayPeriod == null) focusAt(i - 1); else put(t, null); return }
    const cur = buf?.t === t ? buf.s : vals[t] == null ? '' : String(vals[t])
    if (!cur) { setBuf(null); focusAt(i - 1); return }
    const s = cur.slice(0, -1), [lo] = datesRange(t, vals, h12)
    setBuf(s ? { t, s } : null); put(t, s && Number(s) >= lo ? Number(s) : null)
  }
  const onKey = (e: RKeyboardEvent<HTMLInputElement>, i: number, t: DatesSegType) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return
    const k = e.key
    if (k === 'ArrowLeft' || k === 'ArrowRight') { // k is the key through logicalArrow
      e.preventDefault()
      const rtl = getComputedStyle(e.currentTarget).direction === 'rtl'
      focusAt(i + (logicalArrow(k, rtl ? 'rtl' : 'ltr') === 'ArrowRight' ? 1 : -1))
      return
    }
    if (['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End'].includes(k)) { e.preventDefault(); if (!locked) step(t, k); return }
    if (k === 'Backspace' || k === 'Delete') { e.preventDefault(); if (locked) return; if (k === 'Delete') { setBuf(null); put(t, null) } else back(i, t); return }
    if (k.length !== 1 || e.nativeEvent.isComposing) return
    e.preventDefault()
    if (!locked) char(i, t, k)
  }
  // touch keyboards send no usable keydown: read what was inserted (or deleted) from the input event instead
  const onChange = (e: React.ChangeEvent<HTMLInputElement>, i: number, t: DatesSegType) => {
    if (locked) return
    const ne = e.nativeEvent as InputEvent
    if (ne.inputType?.startsWith('delete')) return back(i, t)
    const d = ne.data ?? e.target.value.slice(-1)
    if (d) char(i, t, d.slice(-1))
  }
  const onPaste = (e: React.ClipboardEvent<HTMLInputElement>) => {
    e.preventDefault()
    if (locked) return
    const text = e.clipboardData.getData('text')
    const v = p.parse ? p.parse(text) : datesParseText(text, p.tpl, locale, h12)
    if (v) { setBuf(null); p.onVals({ ...vals, ...v }) }
  }
  const shown = (t: DatesSegType) => {
    if (t === 'dayPeriod') return vals.dayPeriod == null ? '' : periods[vals.dayPeriod]
    const v = vals[t]
    // typed digits show as typed ("2", "20" in the year) while they still match the value (a reset or outside change wins)
    if (buf?.t === t && (v ?? null) === (Number(buf.s) >= datesRange(t, vals, h12)[0] ? Number(buf.s) : null)) return [...buf.s].map(c => datesNum(locale, Number(c))).join('')
    return v == null ? '' : datesNum(locale, v, t === 'year' ? 4 : 2)
  }
  const empty = !datesAnyVal(vals, p.tpl)
  const labelRef = p['aria-label'] ? gid : p.labelledBy
  return (
    <div role="group" id={gid} aria-label={p['aria-label']} aria-labelledby={p['aria-label'] ? undefined : p.labelledBy} aria-disabled={p.disabled || undefined} onKeyDown={p.onKeyDown}
      onFocus={() => p.onFocusChange?.(true)}
      onBlur={e => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) { setBuf(null); p.onFocusChange?.(false) } }}
      onPointerDown={e => { // a press on the padding or a separator lands in the first empty segment
        if ((e.target as HTMLElement).closest('input,button')) return
        e.preventDefault()
        if (!p.disabled) focusAt(Math.max(0, segs.findIndex(t => vals[t] == null)))
      }}
      className={cn(inputShellClass(p.invalid), 'relative flex h-9 w-full min-w-0 items-center gap-2 ps-3 pe-2 text-[13px] [@media(pointer:coarse)]:h-10 [@media(pointer:coarse)]:text-base',
        p.disabled ? 'cursor-not-allowed bg-[var(--muted)] text-[var(--fg3)]' : p.readOnly ? 'bg-[var(--muted)]' : 'cursor-text', p.className)}>
      {p.icon && <DatesGlyph name={p.icon} className="text-[var(--fg3)]" />}
      <div className="flex min-w-0 flex-1 items-center overflow-x-auto whitespace-nowrap [scrollbar-width:none]">
        {p.tpl.map((x, k) => {
          if (x.type === 'literal') return <span key={k} aria-hidden className={cn('whitespace-pre', empty && 'text-[var(--fg3)]')}>{x.text}</span>
          const t = x.type, i = segs.indexOf(t), [lo, hi] = datesRange(t, vals, h12), text = shown(t)
          const ph = datesPlaceholder(locale, t), sid = i === 0 && p.id ? p.id : `${uid}${t}`
          const widest = t === 'dayPeriod' ? periods.reduce((a, b) => (a.length >= b.length ? a : b)) : datesNum(locale, 0, t === 'year' ? 4 : 2)
          return (
            // each segment is a target of at least 24×24px (WCAG 2.5.8), digits centred in it
            <span key={k} className="relative inline-block min-w-6 text-center">
              <span aria-hidden className="invisible px-0.5 leading-6 whitespace-pre tabular-nums">{text ? widest : ph}</span>
              <input ref={el => { refs.current[i] = el; if (i === 0) formsAssignRef(p.inputRef, el) }} id={sid} role="spinbutton"
                inputMode={t === 'dayPeriod' ? 'text' : 'numeric'} enterKeyHint="next" autoComplete="off" autoCorrect="off" spellCheck={false}
                aria-label={datesFieldName(locale, t)} aria-labelledby={labelRef ? `${labelRef} ${sid}` : undefined}
                aria-valuenow={vals[t] ?? undefined} aria-valuemin={lo} aria-valuemax={hi} aria-valuetext={text || p.emptyText}
                aria-invalid={p.invalid || undefined} aria-describedby={p.describedBy} aria-required={p.required || undefined} aria-readonly={p.readOnly || undefined}
                disabled={p.disabled} readOnly={p.readOnly} value={text} placeholder={ph}
                onKeyDown={e => onKey(e, i, t)} onChange={e => onChange(e, i, t)} onPaste={onPaste}
                onFocus={e => e.currentTarget.select()} onClick={e => e.currentTarget.select()} onBlur={() => setBuf(b => (b?.t === t ? null : b))}
                size={1} className="absolute inset-0 h-full w-full min-w-0 rounded-[var(--r-sm)] border-0 bg-transparent p-0 text-center tabular-nums [color:inherit] caret-transparent outline-none selection:bg-transparent placeholder:text-[var(--fg3)] focus:bg-[var(--primary)] focus:text-[var(--on-primary)] focus:placeholder:text-[var(--on-primary)] disabled:cursor-not-allowed" />
            </span>
          )
        })}
      </div>
      {p.suffix}
      {p.children}
    </div>
  )
}

/** How a field's value maps to wall-clock fields and back. `key` compares values (it is what changed means). */
type DatesConv<T> = { toWall: (v: T) => Partial<ZonedParts> | null; fromWall: (w: ZonedParts) => T; key: (v: T) => string; empty: T }

/**
 * Segment state for a field whose value is a T: keeps typed but incomplete segments, emits a value once every
 * segment is filled (and the empty value when a filled one is cleared), shows the value back (a clamped day, a time
 * moved past a daylight-saving gap), and re-reads it when it changes from outside or `sync` (locale, clock, zone) changes.
 */
function useDatesSegValue<T>(fc: { value: T; set: (v: T) => void }, conv: DatesConv<T>, tpl: DatesPart[], h12: boolean, sync: string) {
  const read = (v: T) => datesToVals(conv.toWall(v), h12)
  const [vals, setVals] = useState(() => read(fc.value))
  const k = conv.key(fc.value), seen = useRef(`${k}|${sync}`)
  useEffect(() => {
    if (seen.current === `${k}|${sync}`) return
    seen.current = `${k}|${sync}`; setVals(read(fc.value))
  }, [k, sync]) // eslint-disable-line react-hooks/exhaustive-deps
  const onVals = (v: DatesVals) => {
    const w = datesFromVals(v, tpl, h12)
    if (!w) {
      setVals(v)
      const ek = conv.key(conv.empty)
      if (k !== ek) { seen.current = `${ek}|${sync}`; fc.set(conv.empty) }
      return
    }
    const next = conv.fromWall(w), nk = conv.key(next)
    setVals({ ...v, ...read(next) })
    if (nk !== k) { seen.current = `${nk}|${sync}`; fc.set(next) }
  }
  const resetTo = (v: T) => { seen.current = `${conv.key(v)}|${sync}`; setVals(read(v)) }
  const wall = datesFromVals(vals, tpl, h12)
  return { vals, onVals, resetTo, wall, partial: !wall && datesAnyVal(vals, tpl) }
}
/** Today at midnight as segment values, where ↑/↓ start in an empty segment. */
const datesSeed = (h12: boolean) => () => { const n = new Date(); return datesToVals({ year: n.getFullYear(), month: n.getMonth() + 1, day: n.getDate(), hour: 0, minute: 0, second: 0 }, h12) }
const DATES_DAY_CONV: DatesConv<Date | null> = {
  toWall: d => (d ? { year: d.getFullYear(), month: d.getMonth() + 1, day: d.getDate() } : null),
  fromWall: w => datesLocal(w.year, w.month, w.day), key: d => (d ? formDate(d) : ''), empty: null,
}

/* Calendar ───────────────────────────────────────────────────────────────────── */

/** Prev/next arrows plus a title (a button when it opens the next level up), shared by the month and year grids. */
function DatesNavHeader({ title, onTitle, titleLabel, onPrev, onNext, prevLabel, nextLabel, prevDisabled, nextDisabled }: {
  title: string; onTitle?: () => void; titleLabel?: string; onPrev: () => void; onNext: () => void; prevLabel: string; nextLabel: string; prevDisabled?: boolean; nextDisabled?: boolean }) {
  return (
    <div className="mb-2 flex h-7 flex-none items-center justify-between [@media(pointer:coarse)]:h-9">
      <button type="button" aria-label={prevLabel} title={prevLabel} onClick={onPrev} disabled={prevDisabled} className={DATES_ICON_BTN}><DatesGlyph name="chevronLeft" className="ui-flip" /></button>
      {onTitle ? <button type="button" onClick={onTitle} aria-label={titleLabel} className={DATES_CAPTION}>{title}<DatesGlyph name="chevronDown" size={13} className="text-[var(--fg3)]" /></button>
        : <span className="text-[13px] font-semibold">{title}</span>}
      <button type="button" aria-label={nextLabel} title={nextLabel} onClick={onNext} disabled={nextDisabled} className={DATES_ICON_BTN}><DatesGlyph name="chevronRight" className="ui-flip" /></button>
    </div>
  )
}
const DATES_CAPTION = 'inline-flex h-7 cursor-pointer items-center gap-1 rounded-[var(--r-md)] border-0 bg-transparent px-2 text-[13px] font-semibold text-[var(--fg)] hover:bg-[var(--muted)] [@media(pointer:coarse)]:h-9'
const DATES_TILE = 'cursor-pointer rounded-[var(--r-md)] border-0 bg-transparent text-[13px] text-[var(--fg)] transition-colors hover:bg-[var(--muted)] aria-pressed:bg-[var(--primary)] aria-pressed:font-semibold aria-pressed:text-[var(--on-primary)] ' +
  'aria-disabled:cursor-default aria-disabled:text-[var(--fg3)] aria-disabled:line-through aria-disabled:hover:bg-transparent [@media(pointer:coarse)]:text-sm'

/** Arrow-key moves in a 3-column grid of 12 tiles: ←/→ (mirrored in RTL) by one, ↑/↓ by a row, Home/End to the ends. */
const datesTileMove = (e: RKeyboardEvent, i: number) => {
  const rtl = getComputedStyle(e.currentTarget).direction === 'rtl', k = logicalArrow(e.key, rtl ? 'rtl' : 'ltr')
  return k === 'ArrowLeft' ? i - 1 : k === 'ArrowRight' ? i + 1 : k === 'ArrowUp' ? i - 3 : k === 'ArrowDown' ? i + 3 : k === 'Home' ? 0 : k === 'End' ? 11 : null // k: logicalArrow(e.key)
}

/**
 * Twelve months of `year` to pick from (the calendar's quick picker, and MonthPicker). The title opens the year grid;
 * arrows move, PageUp/PageDown change the year, Enter picks, Escape goes back. Months wholly outside min/max are disabled.
 */
function DatesMonthGrid({ locale, year, onYear, selected, onPick, min, max, onTitle, onEscape, t }: {
  locale: string; year: number; onYear: (y: number) => void; selected?: { year: number; month: number } | null; onPick: (month: number) => void
  min?: Date | null; max?: Date | null; onTitle?: () => void; onEscape?: () => void; t: DatesPickerT }) {
  const names = datesMonthNames(locale, 'short'), long = datesMonthNames(locale, 'long')
  const off = (m: number) => !!((min && new Date(year, m + 1, 0) < startOfDay(min)) || (max && new Date(year, m, 1) > max))
  const [active, setActive] = useState(() => selected && selected.year === year ? selected.month : 0)
  const refs = useRef<(HTMLButtonElement | null)[]>([])
  useEffect(() => { refs.current[active]?.focus({ preventScroll: true }) }, []) // eslint-disable-line react-hooks/exhaustive-deps
  const go = (i: number) => { const j = Math.max(0, Math.min(11, i)); setActive(j); refs.current[j]?.focus() }
  return (
    <div className="flex h-full flex-col" onKeyDown={e => {
      if (e.key === 'Escape' && onEscape) { e.stopPropagation(); onEscape(); return }
      if (e.key === 'PageUp' || e.key === 'PageDown') { e.preventDefault(); onYear(year + (e.key === 'PageUp' ? -1 : 1)); return }
      if (!(e.target as HTMLElement).dataset.tile) return
      const n = datesTileMove(e, active)
      if (n !== null) { e.preventDefault(); go(n) }
    }}>
      <DatesNavHeader title={datesNum(locale, year)} onTitle={onTitle} titleLabel={t('chooseYear', { year: datesNum(locale, year) })}
        onPrev={() => onYear(year - 1)} onNext={() => onYear(year + 1)} prevLabel={t('previousYear')} nextLabel={t('nextYear')}
        prevDisabled={!!min && year <= min.getFullYear()} nextDisabled={!!max && year >= max.getFullYear()} />
      <div role="group" aria-label={datesNum(locale, year)} className="grid flex-1 grid-cols-3 grid-rows-4 gap-1">
        {names.map((n, m) => (
          <button key={m} type="button" data-tile ref={el => { refs.current[m] = el }} tabIndex={m === active ? 0 : -1}
            aria-pressed={!!selected && selected.year === year && selected.month === m} aria-disabled={off(m) || undefined}
            onFocus={() => setActive(m)} onClick={() => { if (!off(m)) onPick(m) }} className={DATES_TILE}>
            <span aria-hidden>{n}</span><span className="sr-only">{long[m]} {datesNum(locale, year)}</span></button>
        ))}
      </div>
    </div>
  )
}

/** Twelve years per page to pick from (the calendar's quick picker, and YearPicker). Arrows move (paging at the edges), PageUp/PageDown page, Escape goes back. */
function DatesYearGrid({ locale, year, selected, onPick, min, max, onEscape, t }: {
  locale: string; year: number; selected?: number | null; onPick: (y: number) => void; min?: Date | null; max?: Date | null; onEscape?: () => void; t: DatesPickerT }) {
  const [start, setStart] = useState(() => year - (((year % 12) + 12) % 12))
  const [active, setActive] = useState(year)
  const refs = useRef(new Map<number, HTMLButtonElement | null>())
  const want = useRef(true)
  useEffect(() => { if (want.current) refs.current.get(active)?.focus({ preventScroll: true }); want.current = false }, [active, start])
  const off = (y: number) => (!!min && y < min.getFullYear()) || (!!max && y > max.getFullYear())
  const go = (y: number) => { want.current = true; setActive(y); if (y < start || y >= start + 12) setStart(y - (((y % 12) + 12) % 12)) }
  const years = Array.from({ length: 12 }, (_, i) => start + i)
  return (
    <div className="flex h-full flex-col" onKeyDown={e => {
      if (e.key === 'Escape' && onEscape) { e.stopPropagation(); onEscape(); return }
      if (e.key === 'PageUp' || e.key === 'PageDown') { e.preventDefault(); go(active + (e.key === 'PageUp' ? -12 : 12)); return }
      if (!(e.target as HTMLElement).dataset.tile) return
      const n = datesTileMove(e, active - start)
      if (n !== null) { e.preventDefault(); go(start + n) }
    }}>
      <DatesNavHeader title={`${datesNum(locale, start)}–${datesNum(locale, start + 11)}`}
        onPrev={() => setStart(s => s - 12)} onNext={() => setStart(s => s + 12)} prevLabel={t('previousYears')} nextLabel={t('nextYears')}
        prevDisabled={!!min && start <= min.getFullYear()} nextDisabled={!!max && start + 11 >= max.getFullYear()} />
      <div role="group" aria-label={`${datesNum(locale, start)}–${datesNum(locale, start + 11)}`} className="grid flex-1 grid-cols-3 grid-rows-4 gap-1">
        {years.map(y => (
          <button key={y} type="button" data-tile ref={el => { refs.current.set(y, el) }} tabIndex={y === (years.includes(active) ? active : start) ? 0 : -1}
            aria-pressed={y === selected} aria-disabled={off(y) || undefined} onFocus={() => setActive(y)} onClick={() => { if (!off(y)) onPick(y) }}
            className={DATES_TILE}>{datesNum(locale, y)}</button>
        ))}
      </div>
    </div>
  )
}

/** Props of Calendar. */
export type CalendarProps = {
  selected?: Date | null; onSelect?: (d: Date) => void; range?: DateRange; onRangeChange?: (r: DateRange) => void
  /** the month shown first (defaults to the selection, then today) */ month?: Date; onMonthChange?: (firstShown: Date) => void
  /** the day marked as today; by default the client's date, read after mount so server and client render the same */ today?: Date
  /** focus the selected (or today's) day on mount, e.g. inside a popover */ autoFocus?: boolean
  /** first and last selectable days; days outside are disabled and navigation stops at them */ min?: Date | null; max?: Date | null
  /** days that can't be picked (weekends, holidays, booked days); they stay focusable and are announced as unavailable */ isDateUnavailable?: (d: Date) => boolean
  /** 0 Sunday … 6 Saturday (default: the locale's, from useLocale()) */ weekStartsOn?: WeekDay
  /** month and weekday names, digits (default: useLocale()) */ locale?: string
  /** months side by side, 1–3 (stacked on phones) */ numberOfMonths?: 1 | 2 | 3
  className?: string
}

/**
 * Month grid (an ARIA grid; day cells grow to 40×40 on touch). Always controlled: a single date is `selected` +
 * `onSelect`, a range is `range` + `onRangeChange` (pass one pair); `month` is only the month shown first.
 * Weekday and month names, digits and the first day of the week follow the locale (`locale`, `weekStartsOn`, or
 * UIProvider's). `min`, `max` and `isDateUnavailable(date)` disable days (they stay focusable and are announced as
 * unavailable; a range can't start or end on one). `numberOfMonths` shows up to 3 months (stacked on phones).
 * Click the month caption for a month grid, and its year for a year grid, to jump far.
 * Keyboard (ARIA APG date grid): arrows move by day/week across months (mirrored in RTL), Home/End go to the start/end of
 * the week, PageUp/PageDown change month (with Shift, year), Enter or Space picks. In range mode Shift+arrow or
 * Shift+click extends the range from its anchor; you can also click start then end, drag across days, or drag either
 * end of an existing range. On touch, drag an end of the range, or long-press a day and then drag to draw a new one, so a
 * swipe over the grid still scrolls the page. Months slide in the direction you move; the picked day pops.
 */
export function Calendar({ selected, onSelect, range, onRangeChange, month: initialMonth, onMonthChange, today: todayProp, className, autoFocus,
  min, max, isDateUnavailable, weekStartsOn: wsProp, locale: locProp, numberOfMonths = 1 }: CalendarProps) {
  const L = useDatesLocale({ locale: locProp, weekStartsOn: wsProp })
  const { locale, weekStartsOn } = L
  const tp = datesT(DATE_PICKER_MESSAGES, L)
  const n = Math.max(1, Math.min(3, Math.round(numberOfMonths)))
  const lo = min ? startOfDay(min) : null, hi = max ? startOfDay(max) : null
  const clampDay = (d: Date) => (lo && d < lo ? lo : hi && d > hi ? hi : d)
  const [month, setMonthState] = useState(() => addMonths(initialMonth ?? selected ?? range?.[0] ?? todayProp ?? clampDay(new Date()), 0))
  const [dir, setDir] = useState(0)
  const [hover, setHover] = useState<Date | null>(null)
  const [focus, setFocus] = useState(() => clampDay(startOfDay(selected ?? range?.[0] ?? initialMonth ?? todayProp ?? new Date())))
  const clientToday = useDatesToday()
  const [kbd, setKbd] = useState(false)
  const [view, setView] = useState<'days' | 'months' | 'years'>('days')
  const [pick, setPick] = useState({ year: month.getFullYear(), panel: 0 })
  const wrap = useRef<HTMLDivElement>(null)
  const wantFocus = useRef(!!autoFocus)
  const anchor = useRef<Date | null>(null)
  const uid = useId()
  const setMonth = (m: Date) => { setMonthState(m); onMonthChange?.(m) }
  const end0 = addMonths(month, n) // first day after the last month shown
  const go = (k: number) => { setDir(k); setMonth(addMonths(month, k)) }
  const shownDay = (d: Date) => d >= month && d < end0
  const showMonthOf = (d: Date) => {
    if (shownDay(d)) return
    const m = d < month ? addMonths(d, 0) : addMonths(d, 1 - n)
    setDir(m > month ? 1 : -1); setMonth(m)
  }
  const blocked = (d: Date) => !!((lo && d < lo) || (hi && d > hi) || isDateUnavailable?.(d))
  const [a, b] = range ?? [null, null]
  const probe = hover ?? (kbd ? focus : null)
  const end = b ?? (a && probe && probe > a ? probe : null) // preview the range while choosing its end
  const today = todayProp ?? clientToday
  const tabDay = shownDay(focus) ? focus : month
  const months = Array.from({ length: n }, (_, i) => addMonths(month, i))
  const caption = (m: Date) => datesDF(locale, { month: 'long', year: 'numeric' }).format(m)
  const dayLabel = (d: Date) => datesDF(locale, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(d)
  const wk = datesWeekdays(locale), order = Array.from({ length: 7 }, (_, i) => (weekStartsOn + i) % 7)

  // Move DOM focus to the roving day after keyboard navigation (also across month changes and back from the quick picker).
  useEffect(() => {
    if (!wantFocus.current || view !== 'days') return
    wrap.current?.querySelector<HTMLElement>(`[data-cal="${+month}"] [data-day="${+tabDay}"][data-in]`)?.focus({ preventScroll: true })
  }, [+tabDay, +month, view]) // eslint-disable-line react-hooks/exhaustive-deps
  // Pop the selected day when it changes (switching to its month first if needed).
  const selT = selected ? +startOfDay(selected) : 0
  const popped = useRef(selT)
  useEffect(() => {
    if (!selT || selT === popped.current) return
    if (!shownDay(new Date(selT))) return showMonthOf(new Date(selT))
    popped.current = selT
    play(wrap.current?.querySelector(`[data-cal="${+month}"] [data-day="${selT}"][data-in]`), { scale: [0.8, 1] }, spring(0.5, 0.3))
  }, [selT, +month]) // eslint-disable-line react-hooks/exhaustive-deps

  const extend = (d: Date, from: Date) => {
    if (!onRangeChange || blocked(d)) return
    let anc = anchor.current
    if (!anc || !(sameDay(anc, a) || sameDay(anc, b))) anc = a && b ? (sameDay(from, a) ? b : a) : a ?? from
    anchor.current = anc
    onRangeChange(d < anc ? [d, anc] : [anc, d])
  }
  const onKey = (e: RKeyboardEvent) => {
    if (!(e.target as HTMLElement).dataset.day) return
    const cur = tabDay, rtl = getComputedStyle(e.currentTarget).direction === 'rtl', k = logicalArrow(e.key, rtl ? 'rtl' : 'ltr')
    const wd = (cur.getDay() - weekStartsOn + 7) % 7
    let next: Date | null = null
    if (k === 'ArrowLeft') next = addDays(cur, -1) // k: logicalArrow(e.key)
    else if (k === 'ArrowRight') next = addDays(cur, 1) // k: logicalArrow(e.key)
    else if (k === 'ArrowUp') next = addDays(cur, -7)
    else if (k === 'ArrowDown') next = addDays(cur, 7)
    else if (k === 'Home') next = addDays(cur, -wd)
    else if (k === 'End') next = addDays(cur, 6 - wd)
    else if (k === 'PageUp' || k === 'PageDown') {
      const t = addMonths(cur, (k === 'PageUp' ? -1 : 1) * (e.shiftKey ? 12 : 1))
      next = new Date(t.getFullYear(), t.getMonth(), Math.min(cur.getDate(), new Date(t.getFullYear(), t.getMonth() + 1, 0).getDate()))
    }
    if (!next) return
    e.preventDefault(); e.stopPropagation()
    next = clampDay(next)
    wantFocus.current = true; setKbd(true); setHover(null)
    setFocus(next); showMonthOf(next)
    if (e.shiftKey && !k.startsWith('Page')) extend(next, cur)
  }

  // Range dragging: grab an end to move it, or press on a day and drag to draw a new range. A finger drags from an end
  // straight away, elsewhere only after a long-press, so a swipe that starts on the grid scrolls the page instead.
  const drag = useRef<{ end: 0 | 1; anchor?: Date; moved: boolean } | null>(null)
  const justDragged = useRef(false)
  const hold = useRef<{ t: ReturnType<typeof setTimeout>; x: number; y: number } | null>(null)
  const cancelHold = () => { if (hold.current) clearTimeout(hold.current.t); hold.current = null }
  useEffect(() => cancelHold, [])
  useEffect(() => { // once a drag has started, the finger moves the range, not the page
    const el = wrap.current; if (!el) return
    const on = (e: TouchEvent) => { if (drag.current) e.preventDefault() }
    el.addEventListener('touchmove', on, { passive: false })
    return () => el.removeEventListener('touchmove', on)
  }, [])
  const dayAt = (x: number, y: number) => {
    const el = document.elementFromPoint(x, y)?.closest<HTMLElement>('[data-day]')
    return el ? new Date(Number(el.dataset.day)) : null
  }
  const atRangeEnd = (d: Date) => !!a && !!b && (sameDay(d, a) || sameDay(d, b))
  const rangeDrag = usePointerDrag({
    onMove: ({ x, y }) => dragTo(x, y),
    onEnd: () => { if (drag.current?.moved) justDragged.current = true; drag.current = null },
  })
  const begin = (d: Date, e: { pointerId: number; clientX: number; clientY: number }, el: Element) => {
    drag.current = atRangeEnd(d) ? { end: sameDay(d, a) ? 0 : 1, moved: false } : { end: 1, anchor: d, moved: false }
    rangeDrag.start(e, el)
  }
  const onDown = (d: Date, e: React.PointerEvent) => {
    if (!onRangeChange || e.shiftKey || e.button !== 0 || blocked(d)) return
    if (!isTouch(e) || atRangeEnd(d)) return begin(d, e, e.currentTarget)
    cancelHold()
    const { pointerId, clientX, clientY } = e, el = e.currentTarget
    hold.current = { x: clientX, y: clientY, t: setTimeout(() => { hold.current = null; navigator.vibrate?.(10); begin(d, { pointerId, clientX, clientY }, el) }, 420) }
  }
  const onMove = (e: React.PointerEvent) => {
    if (kbd) setKbd(false)
    const h = hold.current
    if (h && Math.hypot(e.clientX - h.x, e.clientY - h.y) > 8) cancelHold()
  }
  const dragTo = (x: number, y: number) => {
    const g = drag.current, d = g && dayAt(x, y)
    if (!g || !d || !onRangeChange || blocked(d)) return
    if (g.anchor) {
      if (!g.moved && sameDay(d, g.anchor)) return
      g.moved = true; onRangeChange(d < g.anchor ? [d, g.anchor] : [g.anchor, d]); return
    }
    g.moved = true
    const next: DateRange = g.end === 0 ? [d, b] : [a, d]
    if (next[0] && next[1] && next[0] > next[1]) { g.end = g.end === 0 ? 1 : 0; onRangeChange([next[1], next[0]]) } // dragged past the other end
    else onRangeChange(next)
  }
  const onClick = (d: Date, e: React.MouseEvent) => {
    if (justDragged.current) { justDragged.current = false; return } // the click that ends a drag
    const from = tabDay
    setFocus(d); showMonthOf(d)
    if (blocked(d)) return
    if (!onRangeChange) return onSelect?.(d)
    if (e.shiftKey && a) return extend(d, from)
    anchor.current = null
    onRangeChange(!a || b || d < a ? [d, null] : [a, d])
  }
  const openPicker = (m: Date, panel: number) => { setPick({ year: m.getFullYear(), panel }); setView('months') }
  const pickMonth = (mo: number) => {
    const t = addMonths(new Date(pick.year, mo, 1), -pick.panel)
    setDir(t > month ? 1 : t < month ? -1 : 0); setMonth(t)
    setFocus(clampDay(new Date(pick.year, mo, Math.min(focus.getDate(), datesDim(pick.year, mo + 1)))))
    wantFocus.current = true; setView('days')
  }

  const cell = (d: Date, m: Date) => {
    const outside = d.getMonth() !== m.getMonth()
    if (outside && n > 1) return <div key={+d} role="gridcell" />
    const off = blocked(d)
    const isStart = sameDay(d, a), isEnd = sameDay(d, end), isSel = sameDay(d, selected) || isStart || isEnd
    const joined = !!a && !!end && !sameDay(a, end)
    const inRange = !!a && !!end && d > a && d < end
    const isToday = sameDay(d, today)
    return (
      <div key={+d} role="gridcell" aria-selected={isSel || inRange} className="flex">
        <button type="button" data-day={+d} data-in={outside ? undefined : ''} tabIndex={sameDay(d, tabDay) && !outside ? 0 : -1}
          onClick={e => onClick(d, e)} onPointerDown={e => onDown(d, e)} onPointerEnter={e => e.pointerType === 'mouse' && setHover(off ? null : d)}
          aria-pressed={isSel} aria-disabled={off || undefined} aria-current={isToday ? 'date' : undefined} aria-label={dayLabel(d)}
          className={cn('relative h-8 w-full cursor-pointer border-0 text-[13px] transition-colors focus-visible:z-10 [@media(pointer:coarse)]:h-10 [@media(pointer:coarse)]:text-sm',
            isSel ? cn('bg-[var(--primary)] font-semibold text-[var(--on-primary)]', !joined ? 'rounded-[var(--r-md)]' : isStart ? 'rounded-s-[var(--r-md)]' : 'rounded-e-[var(--r-md)]', joined && onRangeChange && b && 'cursor-ew-resize', onRangeChange && atRangeEnd(d) && 'touch-none')
              : inRange ? 'bg-[var(--muted)]' : 'rounded-[var(--r-md)] bg-transparent hover:bg-[var(--muted)]',
            // outside-month and unavailable days: secondary text (≥4.5:1 in every theme), not faded with opacity
            (outside || off) && !isSel && 'text-[var(--fg3)]', off && !isSel && 'cursor-default line-through hover:bg-transparent',
            isToday && !isSel && 'font-semibold text-[var(--accent)]')}>
          {datesNum(locale, d.getDate())}
          {isToday && <span aria-hidden className="absolute bottom-1 left-1/2 h-1 w-1 -translate-x-1/2 rounded-full bg-current" />}
        </button>
      </div>
    )
  }
  const panel = (m: Date, pi: number) => {
    const lead = (m.getDay() - weekStartsOn + 7) % 7
    const days = Array.from({ length: 42 }, (_, i) => new Date(m.getFullYear(), m.getMonth(), i - lead + 1))
    return (
      <div key={pi} data-grid={+m} className={n === 1 ? 'w-full' : 'w-[252px] max-w-full max-sm:!w-full [@media(pointer:coarse)]:w-[280px]'}>
        <div className="mb-2 flex h-7 items-center justify-center [@media(pointer:coarse)]:h-9">
          <button type="button" onClick={() => openPicker(m, pi)}
            aria-label={tp('chooseMonthYear', { month: caption(m) })} className={DATES_CAPTION}>
            {caption(m)}<DatesGlyph name="chevronDown" size={13} className="text-[var(--fg3)]" />
          </button>
        </div>
        <div role="grid" aria-label={caption(m)} aria-multiselectable={onRangeChange ? true : undefined} className="flex flex-col gap-y-0.5">
          <div role="row" className="grid grid-cols-7 text-center text-[11px] text-[var(--fg3)]">
            {order.map(w => <div key={w} role="columnheader" aria-label={wk.long[w]} className="truncate py-1">{wk.short[w]}</div>)}
          </div>
          {Array.from({ length: 6 }, (_, r) => <div key={r} role="row" className="grid grid-cols-7">{days.slice(r * 7, r * 7 + 7).map(d => cell(d, m))}</div>)}
        </div>
      </div>
    )
  }
  const navCls = cn(DATES_ICON_BTN, 'absolute top-0 z-[1]')
  return (
    <div ref={wrap} className={cn('max-w-full select-none', n === 1 && 'w-[252px] [@media(pointer:coarse)]:w-[280px]', className)}
      onBlur={e => { if (!wrap.current?.contains(e.relatedTarget as Node)) { wantFocus.current = false; setKbd(false) } }}>
      <div className="relative">
        <div className={cn('relative', view !== 'days' && 'invisible')} inert={view !== 'days'}>
          <div className="relative overflow-hidden">
            <AnimatePresence initial={false} mode="popLayout" custom={dir}>
              <motion.div key={+month} data-cal={+month} custom={dir} className={cn('flex gap-x-5 gap-y-4', n > 1 && 'flex-col sm:flex-row', onRangeChange && 'touch-pan-y [-webkit-touch-callout:none]')}
                variants={{ in: (d: number) => ({ x: dirX(d * 40, L.dir), opacity: 0 }), c: { x: 0, opacity: 1 }, out: (d: number) => ({ x: dirX(d * -40, L.dir), opacity: 0 }) }}
                initial="in" animate="c" exit="out" transition={spring(0.1, 0.3)} onKeyDown={onKey}
                onPointerLeave={() => setHover(null)} onPointerMove={onMove} onPointerUp={cancelHold} onPointerCancel={cancelHold}
                onContextMenu={onRangeChange ? e => e.preventDefault() : undefined}>
                {months.map(panel)}
              </motion.div>
            </AnimatePresence>
          </div>
          <button type="button" aria-label={tp('previousMonth')} title={tp('previousMonth')} onClick={() => go(-1)} disabled={!!lo && lo >= month} className={cn(navCls, 'start-0')}><DatesGlyph name="chevronLeft" className="ui-flip" /></button>
          <button type="button" aria-label={tp('nextMonth')} title={tp('nextMonth')} onClick={() => go(1)} disabled={!!hi && hi < end0} className={cn(navCls, 'end-0')}><DatesGlyph name="chevronRight" className="ui-flip" /></button>
          <span className="sr-only" aria-live="polite" id={uid}>{months.map(caption).join(', ')}</span>
        </div>
        {view !== 'days' && (
          <div className="absolute inset-0 z-10 flex justify-center">
            <div className="flex h-full w-full max-w-[280px] flex-col">
              {view === 'months'
                ? <DatesMonthGrid key={pick.year} locale={locale} year={pick.year} onYear={y => setPick(p => ({ ...p, year: y }))} t={tp}
                  selected={{ year: addMonths(month, pick.panel).getFullYear(), month: addMonths(month, pick.panel).getMonth() }} onPick={pickMonth} min={lo} max={hi}
                  onTitle={() => setView('years')} onEscape={() => { wantFocus.current = true; setView('days') }} />
                : <DatesYearGrid locale={locale} year={pick.year} selected={addMonths(month, pick.panel).getFullYear()} min={lo} max={hi} t={tp}
                  onPick={y => { setPick(p => ({ ...p, year: y })); setView('months') }} onEscape={() => setView('months')} />}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

/** Field-styled trigger for a Popover: wires aria-expanded and gives Escape somewhere to return focus. */
function FormsTrigger({ icon, children, fc, ref }: { icon: DatesGlyphName; children: ReactNode; ref?: Ref<HTMLButtonElement>
  fc: { control: { id?: string; 'aria-invalid'?: true; 'aria-describedby'?: string }; disabled: boolean; readOnly: boolean } }) {
  const { open, setOpen, triggerRef, id: pid } = usePopover()
  return (
    <button type="button" ref={formsMergeRefs(triggerRef, ref)} {...fc.control} disabled={fc.disabled} className={cn(formsTriggerClass, fc.readOnly ? 'cursor-default bg-[var(--muted)] hover:!border-[var(--line)]' : 'cursor-pointer')}
      aria-haspopup="dialog" aria-expanded={open} aria-controls={pid} onClick={() => { if (!fc.readOnly) setOpen(!open) }}>
      <DatesGlyph name={icon} className="text-[var(--fg3)]" />{children}
    </button>
  )
}

/** The date constraints DatePicker, DateRangePicker and DateField share with Calendar. */
type DatesConstraints = { min?: Date | null; max?: Date | null; isDateUnavailable?: (d: Date) => boolean; weekStartsOn?: WeekDay; locale?: string }

/**
 * Date field: the calendar pops from the field (keyboard ready), the picked day pops, Today and Clear sit under the grid.
 * Shows the weekday, in the locale. `min`, `max`, `isDateUnavailable`, `weekStartsOn`, `locale` and `numberOfMonths` go
 * to the Calendar; a value outside them is marked invalid and stops a form submit with a message. Form-native: `name`
 * submits the local date as "2026-11-08" (like <input type="date">; '' when empty), `required`, `disabled`, `readOnly`
 * (doesn't open), `invalid`, `onBlur`, `form`, and `ref` on the trigger. For typing a date, use DateField.
 */
export function DatePicker({ value, defaultValue = null, onChange, placeholder, min, max, isDateUnavailable, weekStartsOn, locale, numberOfMonths, className, ref, ...fp }: FormControlProps & DatesConstraints &
  { value?: Date | null; defaultValue?: Date | null; onChange?: (d: Date | null) => void; placeholder?: string; numberOfMonths?: 1 | 2 | 3; className?: string; ref?: Ref<HTMLButtonElement> }) {
  const L = useDatesLocale({ locale })
  const tp = datesT(DATE_PICKER_MESSAGES, L)
  const btn = useRef<HTMLButtonElement>(null)
  const fc = useFormControl<Date | null>({ ...fp, value, defaultValue, onChange, serialize: formDate, focus: () => btn.current?.focus() })
  const d = fc.value, set = fc.set
  const [open, setOpen] = useState(false)
  const [flagged, setFlagged] = useState(false)
  useEffect(() => setFlagged(false), [formDate(d)])
  const c = { min, max, isDateUnavailable }
  const problem = datesDayProblem(d, c, L)
  const today = startOfDay(new Date())
  const pick = (x: Date | null, close = true) => { set(x); if (close) setTimeout(() => setOpen(false), 180) }
  const invalid = fc.invalid || flagged || !!problem
  return (
    <span className={cn('relative block', className)} onBlur={fc.onBlur}>
      <Popover open={open && !fc.disabled && !fc.readOnly} onOpenChange={setOpen} className="!block">
        <FormsTrigger icon="calendar" fc={{ ...fc, control: { ...fc.control, 'aria-invalid': invalid || undefined } }} ref={formsMergeRefs(btn, ref)}>
          <motion.span key={d ? +d : 0} initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} transition={spring(0.3, 0.3)} className={cn('truncate', !d && 'text-[var(--fg3)]')}>
            {d ? datesDF(L.locale, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }).format(d) : placeholder ?? tp('pickDate')}
          </motion.span>
        </FormsTrigger>
        <PopoverContent className="p-3" aria-label={tp('chooseDate')}>
          <Calendar selected={d} onSelect={x => pick(x)} autoFocus {...c} weekStartsOn={weekStartsOn} locale={locale} numberOfMonths={numberOfMonths} />
          <div className="mt-2 flex justify-between border-t border-[var(--line)] pt-2">
            <Button size="sm" variant="ghost" disabled={!!datesDayProblem(today, c, L)} onClick={() => pick(today)}>{tp('today')}</Button>
            <Button size="sm" variant="ghost" disabled={!d} onClick={() => pick(null, false)}>{tp('clear')}</Button>
          </div>
        </PopoverContent>
      </Popover>
      {!fc.disabled && <DatesValidity message={problem} name={fc.name} form={fp.form} focus={() => btn.current?.focus()} onInvalid={() => setFlagged(true)} />}
      {fc.inputs}
    </span>
  )
}

const DATES_PRESETS: ['today' | 'yesterday' | 'last7' | 'last30' | 'thisMonth' | 'lastMonth', () => DateRange][] = [
  ['today', () => [startOfDay(new Date()), startOfDay(new Date())]],
  ['yesterday', () => [addDays(new Date(), -1), addDays(new Date(), -1)]],
  ['last7', () => [addDays(new Date(), -6), startOfDay(new Date())]],
  ['last30', () => [addDays(new Date(), -29), startOfDay(new Date())]],
  ['thisMonth', () => { const n = new Date(); return [new Date(n.getFullYear(), n.getMonth(), 1), new Date(n.getFullYear(), n.getMonth() + 1, 0)] }],
  ['lastMonth', () => { const n = new Date(); return [new Date(n.getFullYear(), n.getMonth() - 1, 1), new Date(n.getFullYear(), n.getMonth(), 0)] }],
]
/**
 * Quick ranges shown beside the range calendar, in English: [label, () => range]. DateRangePicker's default presets are
 * the same ranges in the locale's language; pass your own list to change them.
 */
export const RANGE_PRESETS: [string, () => DateRange][] = DATES_PRESETS.map(([k, get]) => [DATE_PICKER_MESSAGES.en[k], get])

/**
 * Range picker with presets (the matching preset stays highlighted; presets that fall outside `min`/`max` or start or end
 * on an unavailable day are disabled). Stays open so you can drag either end to adjust; Done closes it. Takes the
 * Calendar's `min`, `max`, `isDateUnavailable`, `weekStartsOn`, `locale` and `numberOfMonths` (2 is a good fit on desktop;
 * phones stack them). Form-native: `name` submits two fields, start then end ("2026-11-01", "2026-11-07"; '' for a missing
 * side; read with formData.getAll), `required` (both ends), `disabled`, `readOnly`, `invalid`, `onBlur`, `form`, `ref`.
 */
export function DateRangePicker({ value, defaultValue = [null, null], onChange, placeholder, presets: presetsProp, min, max, isDateUnavailable, weekStartsOn, locale, numberOfMonths, className, ref, ...fp }: FormControlProps & DatesConstraints &
  { value?: DateRange; defaultValue?: DateRange; onChange?: (r: DateRange) => void; placeholder?: string; presets?: [string, () => DateRange][]; numberOfMonths?: 1 | 2 | 3; className?: string; ref?: Ref<HTMLButtonElement> }) {
  const L = useDatesLocale({ locale })
  const tp = datesT(DATE_PICKER_MESSAGES, L)
  const presets = presetsProp ?? DATES_PRESETS.map(([k, get]): [string, () => DateRange] => [tp(k), get])
  const btn = useRef<HTMLButtonElement>(null)
  const fc = useFormControl<DateRange>({ ...fp, value, defaultValue, onChange, serialize: r => [formDate(r[0]), formDate(r[1])], filled: r => !!r[0] && !!r[1], focus: () => btn.current?.focus() })
  const r = fc.value, set = fc.set
  const [open, setOpen] = useState(false)
  const [month, setMonth] = useState(0) // bump to re-mount the calendar on the preset's month
  const [flagged, setFlagged] = useState(false)
  useEffect(() => setFlagged(false), [formDate(r[0]), formDate(r[1])])
  const c = { min, max, isDateUnavailable }
  const days = r[0] && r[1] ? Math.round((+r[1] - +r[0]) / 864e5) + 1 : 0
  const f = datesDF(L.locale, { day: 'numeric', month: 'short', year: 'numeric' })
  const current = presets.find(([, get]) => { const [x, y] = get(); return sameDay(x, r[0]) && sameDay(y, r[1]) })?.[0]
  const presetOff = (get: () => DateRange) => { const [x, y] = get(); return !!(datesDayProblem(x, c, L) || datesDayProblem(y, c, L)) }
  const problem = datesDayProblem(r[0], c, L) ?? datesDayProblem(r[1], c, L)
  const invalid = fc.invalid || flagged || !!problem
  const count = tp('dayCount', { count: days })
  return (
    <span className={cn('relative block', className)} onBlur={fc.onBlur}>
      <Popover open={open && !fc.disabled && !fc.readOnly} onOpenChange={setOpen} className="!block">
        <FormsTrigger icon="calendar" fc={{ ...fc, control: { ...fc.control, 'aria-invalid': invalid || undefined } }} ref={formsMergeRefs(btn, ref)}>
          <span className={cn('flex-1 truncate', !r[0] && 'text-[var(--fg3)]')}>{r[0] ? (r[1] ? f.formatRange(r[0], r[1]) : `${f.format(r[0])} – …`) : placeholder ?? tp('pickDates')}</span>
          {days > 0 && <Badge>{count}</Badge>}
        </FormsTrigger>
        <PopoverContent className="p-3" aria-label={tp('chooseDates')}>
          <div className="flex flex-col gap-3 sm:flex-row">
            {presets.length > 0 && (
              <div className="-mx-3 flex gap-0.5 overflow-x-auto border-[var(--line)] px-3 pb-2 [scrollbar-width:none] max-sm:w-0 max-sm:min-w-[calc(100%+24px)] sm:mx-0 sm:w-[112px] sm:flex-col sm:overflow-visible sm:border-e sm:px-0 sm:pe-2 sm:pb-0">
                {presets.map(([label, get]) => (
                  <button type="button" key={label} aria-pressed={label === current} data-active={label === current} disabled={presetOff(get)} onClick={() => { set(get()); setMonth(m => m + 1) }}
                    className={cn(menuItemClass, '!w-auto flex-none text-xs whitespace-nowrap disabled:cursor-default disabled:text-[var(--fg3)] disabled:hover:bg-transparent max-sm:rounded-full max-sm:border max-sm:!border-[var(--line)] sm:!w-full', label === current && 'font-semibold')}>
                    {label}{label === current && <DatesGlyph name="check" size={12} />}
                  </button>
                ))}
              </div>
            )}
            <Calendar key={month} range={r} onRangeChange={set} {...c} weekStartsOn={weekStartsOn} locale={locale} numberOfMonths={numberOfMonths} />
          </div>
          <div className="mt-3 flex items-center gap-2 border-t border-[var(--line)] pt-3">
            <span className="min-w-0 flex-1 text-xs text-[var(--fg3)]">{!r[0] ? tp('rangeHintStart') : !r[1] ? tp('rangeHintEnd') : tp('rangeHintDone', { count })}</span>
            <Button size="sm" variant="ghost" disabled={!r[0]} onClick={() => set([null, null])}>{tp('clear')}</Button>
            <Button size="sm" variant="primary" onClick={() => setOpen(false)}>{tp('done')}</Button>
          </div>
        </PopoverContent>
      </Popover>
      {!fc.disabled && <DatesValidity message={problem} name={fc.name} form={fp.form} focus={() => btn.current?.focus()} onInvalid={() => setFlagged(true)} />}
      {fc.inputs}
    </span>
  )
}

/* Typed fields ───────────────────────────────────────────────────────────────── */

/**
 * Typed date entry: day, month and year segments in the locale's order, separators and digits (en-GB dd/mm/yyyy, en-US
 * mm/dd/yyyy, de-DE tt.mm.jjjj, ja-JP yyyy/mm/dd). Type digits (a segment moves on once it can't take another), ↑/↓
 * step a segment (PageUp/PageDown further), ←/→ move between segments, Backspace clears digit by digit, and pasting
 * "2026-11-08" or a date in the locale's format fills them all. `min`, `max` and `isDateUnavailable` mark the date
 * invalid and stop a form submit with a message (as does a half-typed date). Value: a local Date at midnight, or null
 * while empty or incomplete. Form-native: `name` submits "2026-11-08" ('' when empty), `required`, `disabled`,
 * `readOnly`, `invalid`, `onBlur`, `form`, and `ref` on the first segment.
 */
export function DateField({ value, defaultValue = null, onChange, min, max, isDateUnavailable, locale, className, 'aria-label': ariaLabel, ref, ...fp }: FormControlProps & Omit<DatesConstraints, 'weekStartsOn'> &
  { value?: Date | null; defaultValue?: Date | null; onChange?: (d: Date | null) => void; 'aria-label'?: string; className?: string; ref?: Ref<HTMLInputElement> }) {
  const L = useDatesLocale({ locale })
  const tf = datesT(DATE_FIELD_MESSAGES, L)
  const first = useRef<HTMLInputElement>(null), onReset = useRef(() => {})
  const fc = useFormControl<Date | null>({ ...fp, value, defaultValue, onChange, serialize: formDate, focus: () => first.current?.focus(), onReset: () => onReset.current() })
  const tpl = datesTemplate(L.locale, true, null, false)
  const seg = useDatesSegValue(fc, DATES_DAY_CONV, tpl, false, L.locale)
  useLayoutEffect(() => { onReset.current = () => seg.resetTo(defaultValue) })
  const [editing, setEditing] = useState(false), [flagged, setFlagged] = useState(false)
  useEffect(() => setFlagged(false), [formDate(fc.value), seg.partial])
  const range = datesDayProblem(fc.value, { min, max, isDateUnavailable }, L)
  const problem = range ?? (seg.partial ? tf('incomplete') : null)
  return (
    <div className={cn('relative', className)} onBlur={fc.onBlur}>
      <DatesSegments tpl={tpl} vals={seg.vals} onVals={seg.onVals} locale={L.locale} h12={false} seed={datesSeed(false)} emptyText={tf('blank')} icon="calendar"
        disabled={fc.disabled} readOnly={fc.readOnly} invalid={fc.invalid || flagged || (!!range && !editing)} required={fc.required}
        id={fc.control.id} labelledBy={fc.labelledBy} aria-label={ariaLabel} describedBy={fc.control['aria-describedby']} inputRef={formsMergeRefs(first, ref)} onFocusChange={setEditing} />
      {!fc.disabled && <DatesValidity message={problem} name={fc.name} form={fp.form} focus={() => first.current?.focus()} onInvalid={() => setFlagged(true)} />}
      {fc.inputs}
    </div>
  )
}

const datesTimeConv = (gran: DateGranularity): DatesConv<string> => ({
  toWall: s => { const m = DATES_ISO_TIME.exec(s ?? ''); return m ? { hour: +m[1], minute: +m[2], second: +(m[3] ?? 0) } : null },
  fromWall: w => `${datesPad(w.hour)}:${datesPad(w.minute)}${gran === 'second' ? `:${datesPad(w.second)}` : ''}`,
  key: s => s ?? '', empty: '',
})
/** "9:05" or "09:05:30" as seconds since midnight, for comparing. */
const datesSecs = (s?: string | null) => { const m = DATES_ISO_TIME.exec(s ?? ''); return m ? +m[1] * 3600 + +m[2] * 60 + +(m[3] ?? 0) : null }

/** Props of TimeField (TimePicker takes the same). */
export type TimeFieldProps = FormControlProps & {
  /** "09:30" (24-hour); '' when empty */ value?: string; defaultValue?: string; onChange?: (v: string) => void
  /** 'hour' | 'minute' (default) | 'second' */ granularity?: Exclude<DateGranularity, 'day'>
  /** 12 or 24-hour clock (default: the locale's) */ hourCycle?: 12 | 24 | HourCycle; locale?: string
  /** earliest and latest allowed time, "08:00" and "18:30" */ min?: string; max?: string
  /** an IANA zone the time is in: shown after it ("CET"); the value stays the wall time */ timeZone?: string
  /** minutes between suggested times; shows a list of them behind a clock button */ step?: number
  /** first and last suggestion, in minutes after midnight (default 0 and 24 × 60) */ from?: number; to?: number
  'aria-label'?: string; className?: string; ref?: Ref<HTMLElement>
}

/**
 * Typed time entry: hour and minute (and second) segments, with an am/pm segment on a 12-hour clock (from the locale or
 * `hourCycle`); type "930" or "9" then ":" and "30", ↑/↓ step a segment, "a"/"p" sets am/pm, pasting "14:30" or
 * "2:30 PM" fills it. `min`/`max` ("08:00", "18:00") mark it invalid. `step` adds a clock button with suggested times
 * every `step` minutes (between `from` and `to`), outside min/max disabled; Alt+↓ opens it. `timeZone` shows the zone's
 * short name after the time (the value is the wall time there). Value: "09:30" (24-hour, like <input type="time">;
 * "09:30:15" with granularity="second"), '' while empty or incomplete. Form-native: `name` submits it, `required`,
 * `disabled`, `readOnly`, `invalid`, `onBlur`, `form`, and `ref` on the first segment.
 */
export function TimeField({ value, defaultValue = '', onChange, granularity = 'minute', hourCycle, locale, min, max, timeZone, step, from = 0, to = 24 * 60, className, 'aria-label': ariaLabel, ref, ...fp }: TimeFieldProps) {
  const L = useDatesLocale({ locale, hourCycle, timeZone })
  const tf = datesT(DATE_FIELD_MESSAGES, L)
  const first = useRef<HTMLInputElement>(null), onReset = useRef(() => {})
  const fc = useFormControl<string>({ ...fp, value, defaultValue, onChange, serialize: x => x, focus: () => first.current?.focus(), onReset: () => onReset.current() })
  const h12 = L.h12
  const tpl = datesTemplate(L.locale, false, granularity, h12)
  const conv = useMemo(() => datesTimeConv(granularity), [granularity])
  const seg = useDatesSegValue(fc, conv, tpl, h12, `${L.locale}|${h12}|${granularity}`)
  useLayoutEffect(() => { onReset.current = () => seg.resetTo(defaultValue) })
  const [editing, setEditing] = useState(false), [flagged, setFlagged] = useState(false)
  useEffect(() => setFlagged(false), [fc.value, seg.partial])
  const v = datesSecs(fc.value), lo = datesSecs(min), hi = datesSecs(max)
  const fmtT = (s: number) => datesDF(L.locale, { hour: h12 ? 'numeric' : '2-digit', minute: '2-digit', hourCycle: h12 ? 'h12' : 'h23', timeZone: 'UTC' }).format(s * 1000)
  const range = v === null ? null : lo !== null && v < lo ? tf('timeTooEarly', { time: fmtT(lo) }) : hi !== null && v > hi ? tf('timeTooLate', { time: fmtT(hi) }) : null
  const problem = range ?? (seg.partial ? tf('incompleteTime') : null)
  // suggestions
  const { open, setOpen, ref: wrap } = useDisclosure(), lid = useId()
  const [place, setPlace] = useState<Placement>('bottom-start')
  const opts = useMemo<TimeOption[]>(() => !step ? [] : timeOptions(step, from, to).map(o => {
    const s = datesSecs(o.value)!
    return { value: o.value, label: fmtT(s), disabled: (lo !== null && s < lo) || (hi !== null && s > hi) }
  }), [step, from, to, lo, hi, L.locale, h12]) // eslint-disable-line react-hooks/exhaustive-deps
  const near = v === null ? -1 : opts.findIndex(o => datesSecs(o.value)! >= v)
  const pick = (i: number) => {
    const o = opts[i]; if (!o || o.disabled) return
    fc.set(granularity === 'second' ? `${o.value}:00` : granularity === 'hour' ? `${o.value.slice(0, 3)}00` : o.value); setOpen(false)
  }
  const { active, setActive, onKeyDown } = useRoving(opts.length, pick, { isDisabled: i => !!opts[i]?.disabled })
  const locked = fc.disabled || fc.readOnly
  const show = (o: boolean) => {
    if (o && locked) return
    if (o) { const i = near >= 0 ? near : opts.findIndex(x => !x.disabled); setActive(Math.max(0, i)); setPlace(formsPlacement(wrap.current)) }
    setOpen(o)
  }
  const zone = timeZone ? datesZoneName(L.locale, L.timeZone, Date.now()) : null
  return (
    <div ref={wrap} className={cn('relative', className)} onBlur={fc.onBlur}>
      <DatesSegments tpl={tpl} vals={seg.vals} onVals={seg.onVals} locale={L.locale} h12={h12} seed={datesSeed(h12)} emptyText={tf('blank')} icon={step ? undefined : 'clock'}
        disabled={fc.disabled} readOnly={fc.readOnly} invalid={fc.invalid || flagged || (!!range && !editing)} required={fc.required}
        id={fc.control.id} labelledBy={fc.labelledBy} aria-label={ariaLabel} describedBy={fc.control['aria-describedby']} inputRef={formsMergeRefs(first, ref as Ref<HTMLInputElement>)}
        onFocusChange={setEditing} onKeyDown={e => { if (step && e.altKey && e.key === 'ArrowDown') { e.preventDefault(); show(true); setTimeout(() => wrap.current?.querySelector<HTMLElement>('[data-times]')?.focus()) } }}
        suffix={zone && <span className="flex-none text-xs text-[var(--fg3)]">{zone}</span>}>
        {step ? (
          <button type="button" data-times role="combobox" aria-label={tf('showTimes')} aria-haspopup="listbox" aria-expanded={open} aria-controls={lid} aria-activedescendant={open ? `${lid}-${active}` : undefined}
            disabled={fc.disabled} onClick={() => show(!open)}
            onKeyDown={e => {
              if (!open) { if (['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(e.key)) { e.preventDefault(); show(true) } return }
              if (e.key === 'Escape') { e.stopPropagation(); setOpen(false); return }
              if (e.key === 'Tab') return setOpen(false)
              if (e.key === ' ') { e.preventDefault(); pick(active); return }
              onKeyDown(e)
            }}
            className={cn('-me-1 grid h-7 w-7 flex-none place-items-center rounded-[var(--r-md)] border-0 bg-transparent text-[var(--fg3)] [@media(pointer:coarse)]:h-8 [@media(pointer:coarse)]:w-8', locked ? 'cursor-default' : 'cursor-pointer hover:bg-[var(--muted)] hover:text-[var(--fg)]')}>
            <DatesGlyph name="clock" />
          </button>
        ) : null}
      </DatesSegments>
      {step ? (
        <FloatingPanel open={open} matchWidth placement={place} className="max-h-64 overflow-auto tabular-nums" role="presentation">
          <DatesTimeList id={lid} options={opts} active={active} selected={fc.value.slice(0, 5)} onPick={pick} onHover={setActive} label={tf('suggestedTimes')} />
        </FloatingPanel>
      ) : null}
      {!fc.disabled && <DatesValidity message={problem} name={fc.name} form={fp.form} focus={() => first.current?.focus()} onInvalid={() => setFlagged(true)} />}
      {fc.inputs}
    </div>
  )
}

/**
 * TimeField's suggestions: a plain listbox (at most 24 × 60 / `step` rows, so it renders them all, without the shared
 * OptionList and its virtualiser) that keeps the active row in view; aria-activedescendant comes from the clock button.
 */
function DatesTimeList({ id, options, active, selected, onPick, onHover, label }:
  { id: string; options: TimeOption[]; active: number; selected: string; onPick: (i: number) => void; onHover: (i: number) => void; label: string }) {
  const first = useRef(true)
  useEffect(() => {
    const el = document.getElementById(`${id}-${active}`)
    if (el) formsScrollIntoList(el, first.current)
    first.current = false
  }, [active, id])
  return (
    <div role="listbox" id={id} aria-label={label}>
      {options.map((o, i) => (
        <div key={o.value} id={`${id}-${i}`} role="option" aria-selected={o.value === selected} aria-disabled={o.disabled || undefined} data-active={i === active}
          onPointerMove={() => onHover(i)} onPointerDown={e => e.preventDefault()} onClick={() => { if (!o.disabled) onPick(i) }}
          className={cn(menuItemClass, o.disabled && 'cursor-default text-[var(--fg3)] hover:bg-transparent')}>
          <span className="truncate">{o.label}</span>{o.value === selected && <DatesGlyph name="check" size={14} />}
        </div>
      ))}
    </div>
  )
}

/** A time (or time zone) to choose from, as timeOptions and timeZoneOptions return them: the shape of an Option, so they feed Select and Combobox too. */
export type TimeOption = { value: string; label: string; disabled?: boolean }

/** Options for a time picker: <Select options={timeOptions(30)} /> */
export const timeOptions = (stepMinutes = 30, from = 0, to = 24 * 60): TimeOption[] =>
  Array.from({ length: Math.ceil((to - from) / stepMinutes) }, (_, i) => {
    const m = from + i * stepMinutes, v = `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
    return { value: v, label: v }
  })

/**
 * Time picker: a TimeField (type the time, or step it with ↑/↓) plus a clock button listing times every `step` minutes
 * (15) between `from` and `to` (07:00 to 21:00), opening scrolled to the current one. The 0.3 props still work
 * (`value`, `defaultValue` "09:00", `onChange`, `step`, `from`, `to`); it also takes TimeField's `hourCycle`, `locale`,
 * `granularity`, `min`, `max` and `timeZone`. `name` submits "HH:MM" (24-hour, like <input type="time">).
 */
export function TimePicker({ defaultValue = '09:00', step = 15, from = 7 * 60, to = 21 * 60, ...rest }: TimeFieldProps) {
  return <TimeField defaultValue={defaultValue} step={step} from={from} to={to} {...rest} />
}

const datesZonedConv = (zone: string, gran: DateGranularity): DatesConv<string | null> => ({
  toWall: s => { const p = s ? datesParseISO(s) : null; return !p ? null : p.at !== undefined ? zonedParts(p.at, zone) : p.wall },
  fromWall: w => toZonedISO(zonedDate(gran === 'day' ? { year: w.year, month: w.month, day: w.day } : w, zone), zone),
  key: s => s ?? '', empty: null,
})
/** An instant from a Date or an ISO string (an ISO string without an offset is read as wall time in `zone`). */
const datesInstant = (x: string | Date | null | undefined, zone: string) => {
  if (!x) return null
  if (x instanceof Date) return +x
  const p = datesParseISO(x)
  return !p ? null : p.at ?? +zonedDate(p.wall, zone)
}

/** Props of DateTimeField and DateTimePicker. */
export type DateTimeFieldProps = FormControlProps & {
  /** ISO 8601 with offset, "2026-11-08T09:30:00+01:00" (a Date, or ISO without offset, is read in `timeZone`); null when empty */
  value?: string | Date | null; defaultValue?: string | Date | null
  /** the new value (same format, always with the offset) and, for convenience, the instant and the zone */
  onChange?: (iso: string | null, detail: { date: Date | null; timeZone: string }) => void
  /** IANA zone the wall time is in (default: UIProvider's, else the browser's) */ timeZone?: string
  /** 'day' | 'hour' | 'minute' (default) | 'second' */ granularity?: DateGranularity
  hourCycle?: 12 | 24 | HourCycle; locale?: string
  /** earliest and latest instant (ISO or Date) */ min?: string | Date | null; max?: string | Date | null
  /** calendar days (in the zone) that can't be picked */ isDateUnavailable?: (d: Date) => boolean
  /** show the zone's short name after the time (default: when `timeZone` is set) */ showTimeZone?: boolean
  /** also submit the zone under this field name ("Europe/Zurich") */ timeZoneName?: string
  'aria-label'?: string; className?: string; ref?: Ref<HTMLInputElement>
}

/** What DateTimePicker builds around the shared field: the field's state, for the popover and the zone picker. */
type DatesDTCtx = {
  L: DatesL; zone: string; h12: boolean; granularity: DateGranularity; locked: boolean; disabled: boolean; readOnly: boolean
  open: boolean; setOpen: (o: boolean) => void; at: number | null; lo: number | null; hi: number | null; wallDay: Date | null
  isDateUnavailable?: (d: Date) => boolean; pickDay: (d: Date) => void; changeZone: (z: string) => void
  /** the time segments alone, editing the field's own value (a time typed before any day takes today in the zone) */ timeRow: (label: string) => ReactNode
}
/** DateTimePicker's additions: the popover around the field, the calendar button inside it, and the zone picker beside it. */
type DatesDTPicker = (c: DatesDTCtx) => { wrap: (field: ReactNode) => ReactNode; button: ReactNode; aside?: ReactNode; showZone?: boolean }

/**
 * DateTimeField, and the field half of DateTimePicker: `picker` adds the popover, the calendar button and the zone
 * picker (DateTimeField passes none, so a copied-in DateTimeField carries no calendar, popover or zone list).
 */
function DatesDateTime({ picker, defaultTimeZone, onTimeZoneChange, value, defaultValue = null, onChange, timeZone: tzProp,
  granularity = 'minute', hourCycle, locale, min, max, isDateUnavailable, showTimeZone, timeZoneName, className, 'aria-label': ariaLabel, ref, ...fp }: DateTimeFieldProps & {
    picker?: DatesDTPicker; defaultTimeZone?: string; onTimeZoneChange?: (tz: string) => void }) {
  const [zoneInner, setZoneInner] = useState(defaultTimeZone)
  const L = useDatesLocale({ locale, hourCycle, timeZone: tzProp ?? zoneInner })
  const tf = datesT(DATE_FIELD_MESSAGES, L)
  const zone = L.timeZone, h12 = granularity !== 'day' && L.h12
  const norm = (v: string | Date | null | undefined) => v === undefined ? undefined : !v ? null : v instanceof Date ? toZonedISO(v, zone) : v
  const first = useRef<HTMLInputElement>(null), onReset = useRef(() => {})
  const fc = useFormControl<string | null>({ ...fp, value: norm(value), defaultValue: norm(defaultValue) ?? null, serialize: v => v ?? '', focus: () => first.current?.focus(), onReset: () => onReset.current(),
    onChange: onChange && (v => onChange(v, { date: v ? new Date(v) : null, timeZone: zone })) })
  const tpl = datesTemplate(L.locale, true, granularity, h12)
  const conv = useMemo(() => datesZonedConv(zone, granularity), [zone, granularity])
  const seg = useDatesSegValue(fc, conv, tpl, h12, `${L.locale}|${granularity}|${h12}|${zone}`)
  useLayoutEffect(() => { onReset.current = () => { seg.resetTo(norm(defaultValue) ?? null); if (tzProp === undefined) setZoneInner(defaultTimeZone) } })
  const [editing, setEditing] = useState(false), [flagged, setFlagged] = useState(false)
  useEffect(() => setFlagged(false), [fc.value, seg.partial])
  const [open, setOpen] = useState(false)
  const locked = fc.disabled || fc.readOnly
  // a pasted value with an offset is an instant: show it in this zone
  const parse = (text: string) => { const p = datesParseISO(datesAscii(text)); return p?.at !== undefined ? datesToVals(zonedParts(p.at, zone), h12) : datesParseText(text, tpl, L.locale, h12) }
  // validation, on the instant (and the calendar day in the zone)
  const at = datesInstant(fc.value, zone), lo = datesInstant(min, zone), hi = datesInstant(max, zone)
  const fmtAt = (t: number) => datesDF(L.locale, { timeZone: zone, day: 'numeric', month: 'short', year: 'numeric', ...(granularity !== 'day' && { hour: 'numeric', minute: '2-digit', hourCycle: h12 ? 'h12' : 'h23' }) }).format(t)
  const wallDay = seg.wall ? datesLocal(seg.wall.year, seg.wall.month, seg.wall.day) : null
  const range = at === null ? null : lo !== null && at < lo ? tf('tooEarly', { date: fmtAt(lo) }) : hi !== null && at > hi ? tf('tooLate', { date: fmtAt(hi) })
    : wallDay && isDateUnavailable?.(wallDay) ? tf('unavailable') : null
  const problem = range ?? (seg.partial ? tf('incomplete') : null)
  const ext = picker?.({
    L, zone, h12, granularity, locked, disabled: fc.disabled, readOnly: fc.readOnly, open, setOpen, at, lo, hi, wallDay, isDateUnavailable,
    pickDay: d => {
      const v: DatesVals = { ...seg.vals, year: d.getFullYear(), month: d.getMonth() + 1, day: d.getDate() }
      for (const t of datesShown(tpl)) if (v[t] == null && (t === 'hour' || t === 'minute' || t === 'second' || t === 'dayPeriod')) v[t] = t === 'hour' && h12 ? 12 : 0
      seg.onVals(v)
    },
    timeRow: label => {
      const tpl2 = datesTemplate(L.locale, false, granularity, h12)
      return (
        <DatesSegments tpl={tpl2} vals={seg.vals} locale={L.locale} h12={h12} seed={datesSeed(h12)} emptyText={tf('blank')} aria-label={label} icon="clock"
          disabled={fc.disabled} readOnly={fc.readOnly} invalid={false} required={false} className="min-w-0 flex-1"
          onVals={v => {
            const today = !datesFromVals(v, tpl, h12) && datesFromVals(v, tpl2, h12) ? zonedParts(Date.now(), zone) : null
            seg.onVals(today && (v.year == null || v.month == null || v.day == null) ? { ...v, year: today.year, month: today.month, day: today.day } : v)
          }} />
      )
    },
    changeZone: z => {
      if (!z || locked) return
      if (tzProp === undefined) setZoneInner(z)
      onTimeZoneChange?.(z)
      if (seg.wall) fc.set(toZonedISO(zonedDate(seg.wall, z), z)) // same wall time, new offset
    },
  })
  const zoneLabel = (showTimeZone ?? (!!tzProp || !!ext?.showZone)) && granularity !== 'day' ? datesZoneName(L.locale, zone, at ?? Date.now()) : null
  const field = (
    <DatesSegments tpl={tpl} vals={seg.vals} onVals={seg.onVals} locale={L.locale} h12={h12} seed={datesSeed(h12)} emptyText={tf('blank')} parse={parse} icon={ext ? undefined : 'calendar'}
      disabled={fc.disabled} readOnly={fc.readOnly} invalid={fc.invalid || flagged || (!!range && !editing)} required={fc.required}
      id={fc.control.id} labelledBy={fc.labelledBy} aria-label={ariaLabel} describedBy={fc.control['aria-describedby']} inputRef={formsMergeRefs(first, ref)} onFocusChange={setEditing}
      onKeyDown={e => { if (ext && e.altKey && e.key === 'ArrowDown' && !locked) { e.preventDefault(); setOpen(true) } }}
      suffix={zoneLabel && <span className="flex-none text-xs text-[var(--fg3)]">{zoneLabel}</span>}>
      {ext?.button}
    </DatesSegments>
  )
  return (
    <div className={cn('flex flex-col gap-2 sm:flex-row sm:items-start', className)} onBlur={fc.onBlur}>
      <div className="relative min-w-0 flex-1">
        {ext ? ext.wrap(field) : field}
        {!fc.disabled && <DatesValidity message={problem} name={fc.name} form={fp.form} focus={() => first.current?.focus()} onInvalid={() => setFlagged(true)} />}
        {fc.inputs}
        {timeZoneName && !fc.disabled && <input type="hidden" name={timeZoneName} form={fp.form} value={zone} />}
      </div>
      {ext?.aside}
    </div>
  )
}

/** The calendar button inside a DateTimePicker's field: the Popover trigger (Escape returns focus here). */
function DatesCalendarButton({ label, disabled, readOnly }: { label: string; disabled: boolean; readOnly: boolean }) {
  const { open, setOpen, triggerRef, id } = usePopover()
  return (
    <button type="button" ref={triggerRef} aria-label={label} aria-haspopup="dialog" aria-expanded={open} aria-controls={id} disabled={disabled} onClick={() => { if (!readOnly) setOpen(!open) }}
      className={cn('-me-1 grid h-7 w-7 flex-none place-items-center rounded-[var(--r-md)] border-0 bg-transparent text-[var(--fg3)] [@media(pointer:coarse)]:h-8 [@media(pointer:coarse)]:w-8',
        disabled || readOnly ? 'cursor-default' : 'cursor-pointer hover:bg-[var(--muted)] hover:text-[var(--fg)]')}>
      <DatesGlyph name="calendar" />
    </button>
  )
}

/**
 * Typed date and time in one field: the locale's date segments, then hour, minute (second) and am/pm, then the time
 * zone's short name. Same keys as DateField and TimeField; pasting an ISO string with an offset shows that instant in
 * `timeZone`. `granularity` 'day' | 'hour' | 'minute' | 'second'. Value: an ISO 8601 string with the offset of `timeZone`
 * at that instant, "2026-11-08T09:30:00+01:00" (so `new Date(value)` is the instant and the wall time is readable);
 * around daylight-saving changes a skipped time moves forward and a repeated one takes the first. null while empty or
 * incomplete. `min`/`max` (instants) and `isDateUnavailable` mark it invalid. Form-native: `name` submits the ISO string
 * ('' when empty), `timeZoneName` also submits the zone, plus `required`, `disabled`, `readOnly`, `invalid`, `onBlur`,
 * `form`, and `ref` on the first segment.
 */
export function DateTimeField(props: DateTimeFieldProps) {
  return <DatesDateTime {...props} />
}

/**
 * Date and time picker: a DateTimeField with a calendar button (or Alt+↓) opening the Calendar with a TimeField under it,
 * and with `timeZonePicker` a searchable time-zone picker beside it. Same value as DateTimeField: an ISO 8601 string with
 * the zone's offset, "2026-11-08T09:30:00+01:00". Picking another zone keeps the wall time (09:30 stays 09:30, the offset
 * changes) and calls `onTimeZoneChange`; `timeZone` controls the zone, `defaultTimeZone` seeds it. Picking a day with no
 * time yet sets midnight. Takes the Calendar's `weekStartsOn` and `numberOfMonths`. Form-native like DateTimeField.
 */
export function DateTimePicker({ timeZonePicker, weekStartsOn, numberOfMonths, ...props }: DateTimeFieldProps & {
  /** show a time-zone picker next to the field */ timeZonePicker?: boolean; /** the zone at first (uncontrolled) */ defaultTimeZone?: string
  onTimeZoneChange?: (tz: string) => void; weekStartsOn?: WeekDay; numberOfMonths?: 1 | 2 | 3 }) {
  return <DatesDateTime {...props} picker={c => {
    const tp = datesT(DATE_PICKER_MESSAGES, c.L)
    const zp = (t: number | null) => { if (t === null) return null; const p = zonedParts(t, c.zone); return datesLocal(p.year, p.month, p.day) }
    return {
      showZone: timeZonePicker,
      button: <DatesCalendarButton label={tp('chooseDate')} disabled={c.disabled} readOnly={c.readOnly} />,
      wrap: field => (
        <Popover open={c.open && !c.locked} onOpenChange={c.setOpen} className="!block">
          {field}
          <PopoverContent className="p-3" aria-label={tp('chooseDateTime')}>
            {/* the popover's own controls are not the form field: keep FormField's name and id from reaching them */}
            <FormFieldContext.Provider value={null}>
              <Calendar selected={c.wallDay} onSelect={c.pickDay} autoFocus min={zp(c.lo)} max={zp(c.hi)} isDateUnavailable={c.isDateUnavailable} weekStartsOn={weekStartsOn} locale={c.L.locale} numberOfMonths={numberOfMonths} />
              <div className="mt-2 flex items-center gap-2 border-t border-[var(--line)] pt-2">
                {c.granularity !== 'day' && c.timeRow(tp('time'))}
                <Button size="sm" variant="primary" className="ms-auto" onClick={() => c.setOpen(false)}>{tp('done')}</Button>
              </div>
            </FormFieldContext.Provider>
          </PopoverContent>
        </Popover>
      ),
      aside: timeZonePicker && (
        <DatesZoneField label={tp('timeZone')} placeholder={tp('searchTimeZones')} empty={tp('noTimeZones')} value={c.zone} onChange={c.changeZone}
          disabled={c.disabled} readOnly={c.readOnly} at={c.at} className="sm:w-[250px]" />
      ),
    }
  }} />
}

/**
 * DateTimePicker's time-zone field: a small combobox over every IANA zone. The list is built when it first opens (about
 * 420 zones, each needing its offset) and rendered in full; typing narrows it. Lighter than TimeZonePicker (no shared
 * Combobox, option list or virtualiser), which suits a field that sits beside another.
 */
function DatesZoneField({ value, onChange, at, label, placeholder, empty, disabled, readOnly, className }: { value: string; onChange: (z: string) => void; at: number | null
  label: string; placeholder: string; empty: string; disabled: boolean; readOnly: boolean; className?: string }) {
  const { open: isOpen, setOpen, ref: wrap } = useDisclosure(), lid = useId(), input = useRef<HTMLInputElement>(null)
  const open = isOpen && !disabled && !readOnly
  const hour = Math.floor((at ?? Date.now()) / 36e5) // offsets only change on the hour
  const label0 = (z: string) => `(GMT${datesOffsetText(zoneOffset(z, hour * 36e5))}) ${z.replace(/_/g, ' ')}`
  const [q, setQ] = useState<string | null>(null) // null: not typing, the field shows the zone
  // the label is Latin text: in RTL a leading LRM keeps "(GMT+01:00)" from mirroring its parentheses
  const rtl = useDir() === 'rtl', shown = (rtl ? '\u200e' : '') + label0(value)
  const all = useMemo(() => (open ? timeZoneOptions(hour * 36e5) : []), [open, hour])
  const query = (q ?? '').trim().toLowerCase()
  const list = query ? all.filter(o => o.label.toLowerCase().includes(query)) : all
  const pick = (i: number) => { const o = list[i]; if (!o) return; onChange(o.value); setQ(null); setOpen(false) }
  const { active, setActive, onKeyDown } = useRoving(list.length, pick, { loop: false, homeEnd: false })
  useEffect(() => {
    if (!open) return
    const el = document.getElementById(`${lid}-${active}`)
    if (el) formsScrollIntoList(el)
  }, [open, active, lid])
  const show = () => { setOpen(true); if (q === null) setActive(Math.max(0, all.findIndex(o => o.value === value))) }
  return (
    <div ref={wrap} className={cn('relative', className)}>
      <span className="pointer-events-none absolute top-1/2 start-3 grid -translate-y-1/2 text-[var(--fg3)]"><DatesGlyph name="globe" size={14} /></span>
      <input ref={input} role="combobox" aria-label={label} aria-expanded={open} aria-controls={lid} aria-autocomplete="list" aria-activedescendant={open && list.length ? `${lid}-${active}` : undefined}
        disabled={disabled} readOnly={readOnly} autoComplete="off" placeholder={placeholder} value={q ?? shown}
        className={cn(inputClass, formDisabledClass, formReadOnlyClass, '!ps-8')}
        onFocus={e => { e.currentTarget.select(); show() }} onClick={show}
        onChange={e => { setQ(e.target.value); setOpen(true); setActive(0) }}
        onBlur={e => { if (!wrap.current?.contains(e.relatedTarget as Node)) { setOpen(false); setQ(null) } }}
        onKeyDown={e => {
          if (e.key === 'Escape') { if (open) { e.stopPropagation(); setOpen(false); setQ(null) } return }
          if (e.key === 'Tab') { setOpen(false); setQ(null); return }
          if (!open) show()
          onKeyDown(e)
        }} />
      <FloatingPanel open={open} matchWidth flip="scroll" className="max-h-[220px] overflow-auto" role="presentation">
        {list.length ? (
          <div role="listbox" id={lid} aria-label={label}>
            {list.map((o, i) => (
              <div key={o.value} id={`${lid}-${i}`} role="option" aria-selected={o.value === value} data-active={i === active}
                onPointerMove={() => setActive(i)} onPointerDown={e => e.preventDefault()} onClick={() => pick(i)} className={menuItemClass}>
                <bdi className="truncate">{o.label}</bdi>{o.value === value && <DatesGlyph name="check" size={14} />}
              </div>
            ))}
          </div>
        ) : <div role="status" className="p-3 text-center text-[13px] text-[var(--fg3)]">{empty}</div>}
      </FloatingPanel>
    </div>
  )
}

/** Every IANA zone the runtime knows (plus UTC) as options sorted by their offset at `at`: "(GMT+01:00) Europe/Zurich". */
export function timeZoneOptions(at: Date | number = Date.now(), zones?: string[]): TimeOption[] {
  let list = zones ?? (typeof Intl.supportedValuesOf === 'function' ? Intl.supportedValuesOf('timeZone') : ['UTC', 'Europe/London', 'Europe/Zurich', 'America/New_York', 'Asia/Tokyo'])
  if (!list.includes('UTC')) list = ['UTC', ...list]
  return list.map(z => ({ z, off: zoneOffset(z, at) })).sort((x, y) => x.off - y.off || x.z.localeCompare(y.z)) // i18n-ignore: offset + IANA name
    .map(({ z, off }) => ({ value: z, label: `(GMT${datesOffsetText(off)}) ${z.replace(/_/g, ' ')}` }))
}

/**
 * Searchable time-zone picker: a Combobox of `Intl.supportedValuesOf('timeZone')` (about 420 zones, virtualised),
 * labelled with their current offset, "(GMT+01:00) Europe/Zurich", and sorted by it; type a city or "GMT+05". `zones`
 * limits the list, `at` is the instant the offsets are for (default now). Value: the IANA name. Form-native like Combobox.
 */
export function TimeZonePicker({ zones, at, placeholder, ...p }: Omit<Parameters<typeof Combobox>[0], 'options' | 'loadOptions'> & { zones?: string[]; at?: Date | number }) {
  const t = at === undefined ? undefined : +at
  const hour = Math.floor((t ?? Date.now()) / 36e5) // offsets only change on the hour
  const options = useMemo(() => timeZoneOptions(t ?? hour * 36e5, zones), [hour, zones]) // eslint-disable-line react-hooks/exhaustive-deps
  const L = useDatesLocale({})
  // Latin labels in an RTL field: a leading LRM keeps "(GMT+01:00)" from mirroring its parentheses
  const shown = useMemo(() => (L.dir === 'rtl' ? options.map(o => ({ ...o, label: '\u200e' + o.label })) : options), [options, L.dir])
  return <Combobox options={shown} placeholder={placeholder ?? datesT(DATE_PICKER_MESSAGES, L)('searchTimeZones')} {...p} />
}

/**
 * Month and year picker: a field that opens a grid of months (its title opens a grid of years), in the locale.
 * `min`/`max` disable months outside them. Value: a Date on the first of the month (null when empty). Form-native:
 * `name` submits "2026-11" (like <input type="month">), `required`, `disabled`, `readOnly`, `invalid`, `onBlur`, `form`, `ref`.
 */
export function MonthPicker({ value, defaultValue = null, onChange, min, max, locale, placeholder, className, ref, ...fp }: FormControlProps &
  { value?: Date | null; defaultValue?: Date | null; onChange?: (d: Date | null) => void; min?: Date | null; max?: Date | null; locale?: string; placeholder?: string; className?: string; ref?: Ref<HTMLButtonElement> }) {
  const L = useDatesLocale({ locale })
  const tp = datesT(DATE_PICKER_MESSAGES, L)
  const btn = useRef<HTMLButtonElement>(null)
  const fc = useFormControl<Date | null>({ ...fp, value, defaultValue, onChange, serialize: d => (d ? `${datesPad(d.getFullYear(), 4)}-${datesPad(d.getMonth() + 1)}` : ''), focus: () => btn.current?.focus() })
  const d = fc.value
  const [open, setOpen] = useState(false)
  const [view, setView] = useState<'months' | 'years'>('months')
  const [year, setYear] = useState(() => (d ?? new Date()).getFullYear())
  const show = (o: boolean) => { if (o) { setView('months'); setYear((d ?? new Date()).getFullYear()) } setOpen(o) }
  return (
    <span className={cn('relative block', className)} onBlur={fc.onBlur}>
      <Popover open={open && !fc.disabled && !fc.readOnly} onOpenChange={show} className="!block">
        <FormsTrigger icon="calendar" fc={fc} ref={formsMergeRefs(btn, ref)}>
          <span className={cn('truncate', !d && 'text-[var(--fg3)]')}>{d ? datesDF(L.locale, { month: 'long', year: 'numeric' }).format(d) : placeholder ?? tp('pickMonth')}</span>
        </FormsTrigger>
        <PopoverContent className="p-3" aria-label={tp('chooseMonth')}>
          <div className="h-[232px] w-[252px] max-w-full [@media(pointer:coarse)]:h-[280px] [@media(pointer:coarse)]:w-[280px]">
            {view === 'months'
              ? <DatesMonthGrid key={year} locale={L.locale} year={year} onYear={setYear} selected={d && { year: d.getFullYear(), month: d.getMonth() }} min={min} max={max} t={tp}
                onTitle={() => setView('years')} onPick={m => { fc.set(new Date(year, m, 1)); setOpen(false) }} />
              : <DatesYearGrid locale={L.locale} year={year} selected={d?.getFullYear()} min={min} max={max} t={tp} onPick={y => { setYear(y); setView('months') }} onEscape={() => setView('months')} />}
          </div>
        </PopoverContent>
      </Popover>
      {fc.inputs}
    </span>
  )
}

/**
 * Year picker: a field that opens a grid of twelve years (arrows page past the edges). `min`/`max` disable years outside
 * them. Value: the year as a number (null when empty). Form-native: `name` submits "2026", `required`, `disabled`,
 * `readOnly`, `invalid`, `onBlur`, `form`, `ref`.
 */
export function YearPicker({ value, defaultValue = null, onChange, min, max, locale, placeholder, className, ref, ...fp }: FormControlProps &
  { value?: number | null; defaultValue?: number | null; onChange?: (y: number | null) => void; min?: Date | null; max?: Date | null; locale?: string; placeholder?: string; className?: string; ref?: Ref<HTMLButtonElement> }) {
  const L = useDatesLocale({ locale })
  const tp = datesT(DATE_PICKER_MESSAGES, L)
  const btn = useRef<HTMLButtonElement>(null)
  const fc = useFormControl<number | null>({ ...fp, value, defaultValue, onChange, serialize: y => (y == null ? '' : String(y)), focus: () => btn.current?.focus() })
  const y = fc.value
  const [open, setOpen] = useState(false)
  return (
    <span className={cn('relative block', className)} onBlur={fc.onBlur}>
      <Popover open={open && !fc.disabled && !fc.readOnly} onOpenChange={setOpen} className="!block">
        <FormsTrigger icon="calendar" fc={fc} ref={formsMergeRefs(btn, ref)}>
          <span className={cn('truncate', y == null && 'text-[var(--fg3)]')}>{y != null ? datesNum(L.locale, y) : placeholder ?? tp('pickYear')}</span>
        </FormsTrigger>
        <PopoverContent className="p-3" aria-label={tp('chooseYearTitle')}>
          <div className="h-[232px] w-[252px] max-w-full [@media(pointer:coarse)]:h-[280px] [@media(pointer:coarse)]:w-[280px]">
            <DatesYearGrid locale={L.locale} year={y ?? new Date().getFullYear()} selected={y} min={min} max={max} t={tp} onPick={n => { fc.set(n); setOpen(false) }} />
          </div>
        </PopoverContent>
      </Popover>
      {fc.inputs}
    </span>
  )
}

/* Inline date picker ─────────────────────────────────────────────────────────── */

/**
 * Inline date picker card with two modes: one date, or a range. Type into the date fields (DateField: the locale's
 * order and digits; the calendar jumps to the typed month) or pick on the calendar (drag across days in range mode).
 * The footer spells out the choice, counts the days, and Clear resets it. Composes `DateField` and `Calendar`; takes
 * the Calendar's `min`, `max`, `isDateUnavailable`, `weekStartsOn` and `locale`.
 */
export function InlineDatePicker({ value, defaultValue = [null, null], onChange, defaultMode = 'date', min, max, isDateUnavailable, weekStartsOn, locale, className }: DatesConstraints &
  { value?: DateRange; defaultValue?: DateRange; onChange?: (r: DateRange) => void; defaultMode?: 'date' | 'range'; className?: string }) {
  const L = useDatesLocale({ locale })
  const tp = datesT(DATE_PICKER_MESSAGES, L)
  const [[a, b], set] = useControllable<DateRange>(value, defaultValue, onChange)
  const [mode, setMode] = useState(defaultMode)
  const [jump, setJump] = useState<Date | null>(null)
  const lo = a && b ? (a < b ? a : b) : a ?? b, hi = a && b ? (a < b ? b : a) : a ?? b
  const days = lo && hi ? Math.round((+hi - +lo) / 864e5) + 1 : 0
  const f = datesDF(L.locale, { day: 'numeric', month: 'short', year: 'numeric' })
  const c = { min, max, isDateUnavailable, weekStartsOn, locale }
  const commitFrom = (d: Date | null) => { if (!d) return; set([d, mode === 'date' || !hi || hi < d ? d : hi]); setJump(d) }
  const commitTo = (d: Date | null) => { if (!d) return; const s = lo ?? d; set(d < s ? [d, s] : [s, d]); setJump(d) }
  return (
    <div className={cn('flex flex-col gap-3', className)}>
      <SegmentedControl size="sm" aria-label={tp('mode')} className="self-start [@media(pointer:coarse)]:[&>button]:h-9" value={mode} onChange={m => { setMode(m as 'date' | 'range'); if (m === 'date' && lo) set([lo, lo]) }}
        options={[{ value: 'date', label: tp('modeDate') }, { value: 'range', label: tp('modeRange') }]} />
      <div className="flex flex-wrap items-center gap-2">
        <DateField aria-label={mode === 'range' ? tp('from') : tp('modeDate')} value={lo} onChange={commitFrom} {...c} className="min-w-[150px] flex-1" />
        <AnimatePresence initial={false}>
          {mode === 'range' && (
            <motion.div key="to" className="flex min-w-[150px] flex-1 items-center gap-2" initial={{ opacity: 0, x: dirX(-8, L.dir) }} animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: dirX(-8, L.dir), transition: { duration: 0.12 } }} transition={spring(0.25, 0.35)}>
              <DatesGlyph name="chevronRight" size={14} className="ui-flip text-[var(--fg3)]" />
              <DateField aria-label={tp('to')} value={hi && lo && +hi !== +lo ? hi : null} onChange={commitTo} {...c} className="min-w-0 flex-1" />
            </motion.div>
          )}
        </AnimatePresence>
      </div>
      <Calendar key={jump ? `${jump.getFullYear()}-${jump.getMonth()}-${+jump}` : 'cal'} month={jump ?? lo ?? undefined} {...c}
        className="!w-full [@media(pointer:coarse)]:[&_button[aria-label$=month]]:!h-9 [@media(pointer:coarse)]:[&_button[aria-label$=month]]:!w-9"
        {...(mode === 'range' ? { range: [lo, a && b && +a === +b ? null : hi] as DateRange, onRangeChange: (r: DateRange) => set(r[1] ? r : [r[0], r[0]]) } : { selected: lo, onSelect: (d: Date) => set([d, d]) })} />
      <div className="flex min-h-5 flex-wrap items-center justify-between gap-x-2.5 gap-y-1 text-[13px]" aria-live="polite">
        <span className="font-medium">{!lo || !hi ? tp('noDate') : days === 1 ? f.format(lo) : f.formatRange(lo, hi)}</span>
        <span className="ms-auto flex items-center gap-2">
          {lo && <span className="text-xs text-[var(--fg3)]">{days === 1 ? tp('singleDay') : tp('dayCount', { count: days })}</span>}
          <Button size="sm" variant="ghost" onClick={() => set([null, null])} disabled={!lo} className="[@media(pointer:coarse)]:min-h-9">{tp('clear')}</Button>
        </span>
      </div>
    </div>
  )
}
