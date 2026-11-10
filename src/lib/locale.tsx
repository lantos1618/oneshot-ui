/** Formatting and collation: one fixed English (en-GB) Intl formatter set (`fmt`), cached Intl constructors, date helpers, the `plural` / `rangeStr` text helpers and the table sort model. Part of @lyndon/ui/core. */
import { extent } from './helpers'

/** The locale every formatter uses. */
export const LOCALE = 'en-GB'

/** Day of the week, 0 = Sunday … 6 = Saturday (Date#getDay numbering). */
export type WeekDay = 0 | 1 | 2 | 3 | 4 | 5 | 6

/** Intl hour cycle: h12/h11 show am/pm, h23/h24 don't. */
export type HourCycle = 'h11' | 'h12' | 'h23' | 'h24'

const memoAll = new Map<string, unknown>()
/**
 * A value made once per `key` and kept for the page's life (Intl formatters, parsed date templates): building them is
 * the slow part. Prefer memoCache, which gives each caller its own typed map.
 */
export function memoOnce<T>(key: string, make: () => T): T {
  if (!memoAll.has(key)) memoAll.set(key, make())
  return memoAll.get(key) as T
}

/** A typed cache of its own: `const tpl = memoCache<Template>(); tpl(key, () => parse(key))` builds each value once. */
export function memoCache<T>(): (key: string, make: () => T) => T {
  const m = new Map<string, T>()
  return (key, make) => { if (!m.has(key)) m.set(key, make()); return m.get(key) as T }
}
const intlCached = <T,>(kind: string, locale: string, opts: object | undefined, make: () => T) => memoOnce(kind + '|' + locale + '|' + (opts ? JSON.stringify(opts) : ''), make)

/** A cached Intl.NumberFormat. */
export const numberFormat = (locale: string, o?: Intl.NumberFormatOptions) => intlCached('n', locale, o, () => new Intl.NumberFormat(locale, o))

/** A cached Intl.DateTimeFormat. */
export const dateFormat = (locale: string, o?: Intl.DateTimeFormatOptions) => intlCached('d', locale, o, () => new Intl.DateTimeFormat(locale, o))

/** A cached Intl.Collator for LOCALE (numeric, so "item 10" sorts after "item 9"). */
export const collator = (o: Intl.CollatorOptions = { numeric: true }) => intlCached('c', LOCALE, o, () => new Intl.Collator(LOCALE, o))

/** The default date shape: "8 Nov 2026". */
export const DATE_MEDIUM: Intl.DateTimeFormatOptions = Object.freeze({ day: 'numeric', month: 'short', year: 'numeric' })

const nf = (o?: Intl.NumberFormatOptions) => numberFormat(LOCALE, o)
const fixed = (n: number, digits: number) => nf({ minimumFractionDigits: digits, maximumFractionDigits: digits, useGrouping: false }).format(n)
const pad2 = (n: number) => nf({ minimumIntegerDigits: 2, useGrouping: false }).format(n)
/** Milliseconds of a date or timestamp; NaN for anything that isn't a valid one. */
const msOf = (d: unknown) => (d instanceof Date ? d.getTime() : typeof d === 'number' ? d : NaN)
const df = (d: Date | number | null | undefined, o: Intl.DateTimeFormatOptions) => Number.isFinite(msOf(d)) ? dateFormat(LOCALE, o).format(msOf(d)) : ''
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
  /** Exactly `digits` decimals, grouped: (1234.5, 2) → "1,234.50". */
  fixed: (n: number, digits: number) => nf({ minimumFractionDigits: digits, maximumFractionDigits: digits }).format(n),
  /** Seconds with `digits` decimals and no space: 3.24 → "3.2s", (4, 0) → "4s". Empty for non-finite input. */
  seconds: (s: number, digits = 1) => Number.isFinite(s) ? `${fmt.fixed(s, digits)}s` : '',
  /** A fraction as a percentage: 0.125 → "12.5%". */
  percent: (fraction: number, maxDigits = 1) => nf({ style: 'percent', maximumFractionDigits: maxDigits }).format(fraction),
  /** A date, by default "8 Nov 2026". Empty string for null. */
  date: (d?: Date | number | null, o: Intl.DateTimeFormatOptions = DATE_MEDIUM) => df(d, o),
  /** A time of day: "14:05". */
  time: (d?: Date | number | null, o: Intl.DateTimeFormatOptions = { hour: 'numeric', minute: '2-digit' }) => df(d, o),
  /** Date and time: "8 Nov 2026, 14:05". */
  dateTime: (d?: Date | number | null, o: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' }) => df(d, o),
  /** "3 days ago", "in 2 hours", "yesterday": the unit is picked from the distance to `now`. Empty for an invalid date. */
  relative: (when: Date | number, now: Date | number = Date.now()) => {
    const s = (msOf(when) - msOf(now)) / 1000, row = Number.isFinite(s) ? RELATIVE_UNITS.find(([upTo]) => Math.abs(s) < upTo) : undefined
    return row ? rtf().format(Math.round(s / row[2]) || 0, row[1]) : ''
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

/** @deprecated Use `fmt.date`. */
export const fmtDate = (d?: Date | number | null, opts: Intl.DateTimeFormatOptions = DATE_MEDIUM) => fmt.date(d, opts)

/** @deprecated Use `fmt.date`. */
export const formatDate = fmtDate

/**
 * "1 file" / "3 files": the count and the word for it. `plural(n, 'person', 'people')`; `{ zero: 'No results' }` replaces
 * the whole phrase when n is 0.
 */
export const plural = (n: number, one: string, many = one + 's', { zero }: { zero?: string } = {}) =>
  n === 0 && zero !== undefined ? zero : `${fmt.number(n)} ${n === 1 ? one : many}`

/** "a to b" for the extent of `vals` (NaN skipped), "a" when they're all equal, "no values" when there are none. Any length. */
export function rangeStr(vals: readonly number[], f: (n: number) => string = fmt.number): string {
  const [lo, hi] = extent(vals.filter(v => Number.isFinite(v)))
  if (lo > hi) return 'no values'
  return lo === hi ? f(lo) : `${f(lo)} to ${f(hi)}`
}

/** A table's sort: the column key and 1 (ascending) or -1 (descending). */
export type TableSort<K extends string = string> = { key: K; dir: 1 | -1 }

const sortEmpty = (v: unknown) => v === null || v === undefined || v === '' || (typeof v === 'number' && Number.isNaN(v)) || (v instanceof Date && Number.isNaN(v.getTime()))

/**
 * Compare two cell values for sorting in direction `dir`: numbers and Dates by value, booleans false first, everything
 * else as text with `coll` (numeric-aware). Empty cells (null, undefined, '', NaN, invalid Date) sort last in both directions.
 */
export function compareCells(a: unknown, b: unknown, dir: 1 | -1 = 1, coll: Intl.Collator = collator()): number {
  const ea = sortEmpty(a), eb = sortEmpty(b)
  if (ea || eb) return ea === eb ? 0 : ea ? 1 : -1
  const num = (v: unknown) => typeof v === 'number' || typeof v === 'bigint' || typeof v === 'boolean' || v instanceof Date
  const c = num(a) && num(b) ? Math.sign(Number(a) - Number(b)) : coll.compare(String(a), String(b))
  return c * dir
}

/** The sort after a click on `key`'s header: ascending first, then flipping; with `clearable`, a third click clears it. */
export function nextSort<K extends string>(sort: TableSort<K> | null | undefined, key: K, { clearable = false }: { clearable?: boolean } = {}): TableSort<K> | null {
  if (sort?.key !== key) return { key, dir: 1 }
  return clearable && sort.dir === -1 ? null : { key, dir: sort.dir === 1 ? -1 : 1 }
}

/** The `aria-sort` of `key`'s header: 'ascending' / 'descending' when the table is sorted by it, otherwise undefined. */
export const ariaSort = (sort: TableSort | null | undefined, key: string): 'ascending' | 'descending' | undefined =>
  sort?.key === key ? (sort.dir === 1 ? 'ascending' : 'descending') : undefined
