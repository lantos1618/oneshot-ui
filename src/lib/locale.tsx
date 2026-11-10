/** Formatting: one fixed English (en-GB) Intl formatter set (`fmt`), cached Intl constructors, date helpers, and the `plural` / `rangeStr` text helpers. Part of @lyndon/ui/core. */

/** The locale every formatter uses. */
export const LOCALE = 'en-GB'

/** Day of the week, 0 = Sunday … 6 = Saturday (Date#getDay numbering). */
export type WeekDay = 0 | 1 | 2 | 3 | 4 | 5 | 6

/** Intl hour cycle: h12/h11 show am/pm, h23/h24 don't. */
export type HourCycle = 'h11' | 'h12' | 'h23' | 'h24'

/** A value made once per `key` and kept for the page's life (Intl formatters, parsed date templates): building them is the slow part. */
const memoCache = new Map<string, unknown>()
export function memoOnce<T>(key: string, make: () => T): T {
  if (!memoCache.has(key)) memoCache.set(key, make())
  return memoCache.get(key) as T
}
const intlCached = <T,>(kind: string, locale: string, opts: object | undefined, make: () => T) => memoOnce(kind + '|' + locale + '|' + (opts ? JSON.stringify(opts) : ''), make)

/** A cached Intl.NumberFormat. */
export const numberFormat = (locale: string, o?: Intl.NumberFormatOptions) => intlCached('n', locale, o, () => new Intl.NumberFormat(locale, o))

/** A cached Intl.DateTimeFormat. */
export const dateFormat = (locale: string, o?: Intl.DateTimeFormatOptions) => intlCached('d', locale, o, () => new Intl.DateTimeFormat(locale, o))

const nf = (o?: Intl.NumberFormatOptions) => numberFormat(LOCALE, o)
const fixed = (n: number, digits: number) => nf({ minimumFractionDigits: digits, maximumFractionDigits: digits, useGrouping: false }).format(n)
const pad2 = (n: number) => nf({ minimumIntegerDigits: 2, useGrouping: false }).format(n)
const toDate = (d: Date | number) => (typeof d === 'number' ? new Date(d) : d)
const df = (d: Date | number | null | undefined, o: Intl.DateTimeFormatOptions) =>
  d === null || d === undefined || (typeof d !== 'number' && isNaN(d.getTime())) ? '' : dateFormat(LOCALE, o).format(toDate(d))
const rtf = () => intlCached('rt', LOCALE, undefined, () => new Intl.RelativeTimeFormat(LOCALE, { numeric: 'auto' }))
/** [seconds per unit up to, unit, seconds per unit] for `fmt.relative`. */
const RELATIVE_UNITS: [number, Intl.RelativeTimeFormatUnit, number][] = [
  [45, 'second', 1], [2700, 'minute', 60], [79200, 'hour', 3600], [6 * 86400, 'day', 86400], [26 * 86400, 'week', 604800], [320 * 86400, 'month', 2629800], [Infinity, 'year', 31557600],
]

/** The library's formatters (en-GB). */
export const fmt = {
  locale: LOCALE,
  /** Compact notation: 12400 → "12.4K", 3.2e6 → "3.2M". */
  compact: (n: number) => nf({ notation: 'compact', maximumFractionDigits: 1 }).format(n),
  /** 2.4e6 → "2.4 MB" (bytes in). */
  bytes: (n: number) => n < 1e3 ? `${Math.max(0, Math.round(n))} B` : n < 1e6 ? `${Math.round(n / 1e3)} KB` : n < 1e9 ? `${fixed(n / 1e6, 1)} MB` : `${fixed(n / 1e9, 1)} GB`,
  /** API cost in US dollars with 2–4 decimals: 0.0042 → "$0.0042". */
  usd: (n: number) => { const a = Math.abs(n); return (n < 0 ? '-$' : '$') + fixed(a, a >= 1 || a === 0 ? 2 : a >= 0.01 ? 3 : 4) },
  /** 1234.5, 'EUR' → "€1,234.50". */
  money: (n: number, currency = 'USD') => nf({ style: 'currency', currency }).format(n),
  /** Milliseconds in: 1530 → "1.5 s", 125000 → "2 min 5 s". */
  duration: (ms: number) => {
    if (ms < 1000) return `${Math.max(0, Math.round(ms))} ms`
    if (ms < 60e3) return `${fixed(ms / 1000, ms < 10e3 ? 1 : 0)} s`
    const m = Math.floor(ms / 60e3), s = Math.round((ms % 60e3) / 1000)
    return s ? `${m} min ${s} s` : `${m} min`
  },
  /** Seconds in: 75 → "1:15", 3725 → "1:02:05". */
  clock: (seconds: number) => {
    const t = Math.max(0, Math.floor(seconds || 0)), h = Math.floor(t / 3600), m = Math.floor(t / 60) % 60
    return h ? `${h}:${pad2(m)}:${pad2(t % 60)}` : `${m}:${pad2(t % 60)}`
  },
  /** Plain number with Intl options. */
  number: (n: number, o?: Intl.NumberFormatOptions) => nf(o).format(n),
  /** A fraction as a percentage: 0.125 → "12.5%". */
  percent: (fraction: number, maxDigits = 1) => nf({ style: 'percent', maximumFractionDigits: maxDigits }).format(fraction),
  /** A date, by default "8 Nov 2026". Empty string for null. */
  date: (d?: Date | number | null, o: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short', year: 'numeric' }) => df(d, o),
  /** A time of day: "14:05". */
  time: (d?: Date | number | null, o: Intl.DateTimeFormatOptions = { hour: 'numeric', minute: '2-digit' }) => df(d, o),
  /** Date and time: "8 Nov 2026, 14:05". */
  dateTime: (d?: Date | number | null, o: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' }) => df(d, o),
  /** "3 days ago", "in 2 hours", "yesterday": the unit is picked from the distance to `now`. */
  relative: (when: Date | number, now: Date | number = Date.now()) => {
    const s = (+toDate(when) - +toDate(now)) / 1000, [, unit, per] = RELATIVE_UNITS.find(([upTo]) => Math.abs(s) < upTo)!
    return rtf().format(Math.round(s / per) || 0, unit)
  },
  /** Intl.RelativeTimeFormat with numeric 'auto': (-1, 'day') → "yesterday". */
  relativeTime: (value: number, unit: Intl.RelativeTimeFormatUnit) => rtf().format(value, unit),
  /** ['a', 'b', 'c'] → "a, b and c" (type 'disjunction' → "a, b or c"). */
  list: (items: string[], type: 'conjunction' | 'disjunction' | 'unit' = 'conjunction') => intlCached('l', LOCALE, { type }, () => new Intl.ListFormat(LOCALE, { type })).format(items),
  /** Weekday names from Monday (or `start`, 0 = Sunday): short → ['Mon', … 'Sun']. */
  weekdays: (width: 'narrow' | 'short' | 'long' = 'short', start = 1) => Array.from({ length: 7 }, (_, i) => dateFormat(LOCALE, { weekday: width, timeZone: 'UTC' }).format(Date.UTC(2024, 0, 7 + ((start + i) % 7)))),
  /** Month names, January first. */
  months: (width: 'narrow' | 'short' | 'long' = 'long') => Array.from({ length: 12 }, (_, i) => dateFormat(LOCALE, { month: width, timeZone: 'UTC' }).format(Date.UTC(2024, i, 15))),
  /** English name of a language, region, currency or script code: ('DE', 'region') → "Germany". */
  displayName: (code: string, type: 'language' | 'region' | 'currency' | 'script') => { try { return intlCached('dn', LOCALE, { type }, () => new Intl.DisplayNames(LOCALE, { type, fallback: 'code' })).of(code) ?? code } catch { return code } },
}
/** The type of `fmt`. */
export type LocaleFmt = typeof fmt

/** Midnight at the start of `d`'s day. */
export const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate())

/** `d` plus `n` days, at midnight (safe across daylight-saving changes). */
export const addDays = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n)

/** The first of `d`'s month plus `n` months. */
export const addMonths = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth() + n, 1)

/** Start of `d`'s week at midnight; weeks start on Monday unless `weekStartsOn` says otherwise (0 = Sunday). */
export const startOfWeek = (d: Date, weekStartsOn = 1) => addDays(d, -((d.getDay() - weekStartsOn + 7) % 7))

/** Same calendar day? Null-safe. */
export const sameDay = (a?: Date | null, b?: Date | null) => !!a && !!b && a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()

/** Stable key for a day, "2026-11-08", for maps and React keys. */
export const dayKey = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

/** Format a date: fmtDate(d) → "8 Nov 2026"; pass Intl options for other shapes. Empty string for null. */
export const fmtDate = (d?: Date | null, opts: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short', year: 'numeric' }) => fmt.date(d, opts)

/** "1 file" / "3 files": the count and the word for it. `plural(n, 'person', 'people')`. */
export const plural = (n: number, one: string, many = one + 's') => `${fmt.number(n)} ${n === 1 ? one : many}`

/** "a to b" for the extent of `vals` (NaN skipped), "a" when they're all equal, "no values" when there are none. */
export function rangeStr(vals: readonly number[], f: (n: number) => string = fmt.number): string {
  const ok = vals.filter(v => Number.isFinite(v))
  if (!ok.length) return 'no values'
  const lo = Math.min(...ok), hi = Math.max(...ok)
  return lo === hi ? f(lo) : `${f(lo)} to ${f(hi)}`
}
