/** Locale and i18n: cached Intl formatters, fmt, dates, the message catalog and t(), module catalogs (defineMessages/useMessages), LocaleProvider, RTL helpers. Part of @lyndon/ui/core. */
import { createContext, type ReactNode, useContext, useMemo } from 'react'

/* ════════════════════════════════════════════════════════════════════════════
 * LOCALE / I18N  (0.4)
 * Locale-bound Intl formatters (cached), the message catalog and t(), the locale context behind
 * <UIProvider locale dir timeZone weekStartsOn messages>, and the RTL helpers widgets use.
 * The module-level LOCALE / fmt / fmtDate stay en-GB for code that runs outside React or predates the context.
 * Module strings (no edit to UI_MESSAGES_EN needed): `const CHAT_MSG = defineMessages('chat', { en: { stop: 'Stop' }, de: { stop: 'Stoppen' }, ar: { stop: 'إيقاف' } })`
 * at module top level, then `const t = useMessages(CHAT_MSG)` in the component and `t('stop')` / `t('n', { count })` (keys typed from `en`).
 * Lookup: provider messages['chat.stop'] → CHAT_MSG[locale tag, then language] → CHAT_MSG.en → the key. Import both from './core'.
 * ══════════════════════════════════════════════════════════════════════════ */

/** The default locale (en-GB). The provider's `locale` overrides it for everything that reads `useLocale()`. */
export const LOCALE = 'en-GB'

/** Text direction. */
export type UIDir = 'ltr' | 'rtl'

/** Day of the week, 0 = Sunday … 6 = Saturday (Date#getDay numbering). */
export type WeekDay = 0 | 1 | 2 | 3 | 4 | 5 | 6

/** Intl hour cycle: h12/h11 show am/pm, h23/h24 don't. */
export type HourCycle = 'h11' | 'h12' | 'h23' | 'h24'

/** One cache for every Intl formatter: building them is the slow part, so each locale + options pair is made once. */
const i18nCache = new Map<string, unknown>()

function i18nCached<T>(kind: string, locale: string, opts: object | undefined, make: () => T): T {
  const k = kind + '|' + locale + '|' + (opts ? JSON.stringify(opts) : '')
  let v = i18nCache.get(k) as T | undefined
  if (v === undefined) { v = make(); i18nCache.set(k, v) }
  return v
}

/** A cached Intl.NumberFormat. */
export const numberFormat = (locale: string, o?: Intl.NumberFormatOptions) => i18nCached('n', locale, o, () => new Intl.NumberFormat(locale, o))

/** A cached Intl.DateTimeFormat. */
export const dateFormat = (locale: string, o?: Intl.DateTimeFormatOptions) => i18nCached('d', locale, o, () => new Intl.DateTimeFormat(locale, o))

const i18nPlural = (locale: string) => i18nCached('p', locale, undefined, () => new Intl.PluralRules(locale))

const i18nIsEnglish = (locale: string) => /^en(-|$)/i.test(locale)

const LOCALE_RTL_SCRIPTS = new Set(['Arab', 'Hebr', 'Thaa', 'Syrc', 'Nkoo', 'Adlm', 'Rohg', 'Mand', 'Samr', 'Mend'])

const LOCALE_RTL_LANGS = new Set(['ar', 'he', 'iw', 'fa', 'ur', 'ps', 'sd', 'ug', 'yi', 'dv', 'ckb', 'ku-Arab'])

type I18nLocaleInfo = Intl.Locale & { getWeekInfo?: () => { firstDay: number }; weekInfo?: { firstDay: number } }

const i18nLocale = (locale: string): I18nLocaleInfo | null => { try { return new Intl.Locale(locale) as I18nLocaleInfo } catch { return null } }

/** 'rtl' for Arabic, Hebrew, Persian, Urdu… (from the locale's likely script), else 'ltr'. Same answer on server and client. */
export function localeDir(locale: string): UIDir {
  return i18nCached('dir', locale, undefined, () => {
    const l = i18nLocale(locale)
    if (!l) return 'ltr'
    try { const s = l.maximize().script; if (s) return LOCALE_RTL_SCRIPTS.has(s) ? 'rtl' : 'ltr' } catch { /* old engine */ }
    return LOCALE_RTL_LANGS.has(l.language) ? 'rtl' : 'ltr'
  })
}

// CLDR first day of the week by region, for engines without Intl.Locale#getWeekInfo (Firefox). Monday elsewhere.
const LOCALE_WEEK_SAT = new Set('AF BH DJ DZ EG IQ IR JO KW LY OM QA SD SY'.split(' '))

const LOCALE_WEEK_SUN = new Set('AG AS BD BR BS BT BW BZ CA CO DM DO ET GT GU HK HN ID IL IN JM JP KE KH KR LA MH MM MO MT MX MZ NI NP PA PE PH PK PR PT PY SA SG SV TH TT TW UM US VE VI WS YE ZA ZW'.split(' '))

/** First day of the week for a locale: Intl.Locale#getWeekInfo where the engine has it, else a CLDR table (en-GB → 1, en-US → 0, ar-EG → 6). */
export function localeWeekStart(locale: string): WeekDay {
  return i18nCached('week', locale, undefined, () => {
    const l = i18nLocale(locale)
    if (!l) return 1
    try { const w = l.getWeekInfo?.() ?? l.weekInfo; if (w && w.firstDay >= 1 && w.firstDay <= 7) return (w.firstDay % 7) as WeekDay } catch { /* not supported */ }
    let region = l.region
    try { region ??= l.maximize().region } catch { /* old engine */ }
    return !region ? 1 : region === 'MV' ? 5 : LOCALE_WEEK_SAT.has(region) ? 6 : LOCALE_WEEK_SUN.has(region) ? 0 : 1
  })
}

/** The locale's clock: 'h12' (en-US, ar-EG) or 'h23' (en-GB, de-DE, ja-JP). */
export function localeHourCycle(locale: string): HourCycle {
  return i18nCached('hc', locale, undefined, () => {
    try { return (dateFormat(locale, { hour: 'numeric' }).resolvedOptions().hourCycle as HourCycle | undefined) ?? 'h23' } catch { return 'h23' }
  })
}

/** Formatters bound to one locale (and optionally a time zone). `useLocale().fmt` is one; the module-level `fmt` is en-GB. */
export type LocaleFmt = {
  locale: string
  /** Compact notation: 12400 → "12.4K", 3.2e6 → "3.2M" (de: "3,2 Mio."). */
  compact: (n: number) => string
  /** 2.4e6 → "2.4 MB" (bytes in). */
  bytes: (n: number) => string
  /** API cost in US dollars with 2–4 decimals: 0.0042 → "$0.0042". */
  usd: (n: number) => string
  /** 1234.5, 'EUR' → "€1,234.50" (de-DE: "1.234,50 €"). */
  money: (n: number, currency?: string, locale?: string) => string
  /** Milliseconds in: 1530 → "1.5 s", 125000 → "2 min 5 s". */
  duration: (ms: number) => string
  /** Seconds in: 75 → "1:15", 3725 → "1:02:05". */
  clock: (seconds: number) => string
  /** Plain number with Intl options. */
  number: (n: number, o?: Intl.NumberFormatOptions) => string
  /** A fraction as a percentage: 0.125 → "12.5%" (de: "12,5 %"). */
  percent: (fraction: number, maxDigits?: number) => string
  /** A date, by default "8 Nov 2026" (de: "8. Nov. 2026"). Empty string for null. */
  date: (d?: Date | number | null, o?: Intl.DateTimeFormatOptions) => string
  /** A time of day in the locale's clock: "14:05" / "2:05 PM". */
  time: (d?: Date | number | null, o?: Intl.DateTimeFormatOptions) => string
  /** Date and time: "8 Nov 2026, 14:05". */
  dateTime: (d?: Date | number | null, o?: Intl.DateTimeFormatOptions) => string
  /** "3 days ago", "in 2 hours", "yesterday": the unit is picked from the distance to `now`. */
  relative: (when: Date | number, now?: Date | number) => string
  /** Intl.RelativeTimeFormat with numeric 'auto': (-1, 'day') → "yesterday". */
  relativeTime: (value: number, unit: Intl.RelativeTimeFormatUnit) => string
  /** ['a', 'b', 'c'] → "a, b and c" (type 'disjunction' → "a, b or c"). */
  list: (items: string[], type?: 'conjunction' | 'disjunction' | 'unit') => string
  /** Weekday names starting on the locale's first day (or `start`): short en-GB → ['Mon', … 'Sun']. */
  weekdays: (width?: 'narrow' | 'short' | 'long', start?: number) => string[]
  /** Month names, January first. */
  months: (width?: 'narrow' | 'short' | 'long') => string[]
  /** CLDR plural category of n: 'one', 'other', and in Arabic also 'zero', 'two', 'few', 'many'. */
  plural: (n: number) => Intl.LDMLPluralRule
  /** Localised name of a language, region, currency or script code: ('DE', 'region') → "Germany" / "Deutschland". */
  displayName: (code: string, type: 'language' | 'region' | 'currency' | 'script') => string
}

/**
 * Formatters for `locale` (cached per locale, time zone and week start). English locales keep the library's compact
 * unit spellings ("1.5 s", "2.4 MB"); other locales use Intl's ("1,5 Sek.", "2,4 MB").
 */
export function fmtFor(locale: string = LOCALE, { timeZone, weekStartsOn }: { timeZone?: string; weekStartsOn?: number } = {}): LocaleFmt {
  return i18nCached('fmt', locale, { timeZone, weekStartsOn }, (): LocaleFmt => {
    const en = i18nIsEnglish(locale)
    const nf = (o?: Intl.NumberFormatOptions) => numberFormat(locale, o)
    const unit = (n: number, u: string, digits = 0) => nf({ style: 'unit', unit: u, unitDisplay: 'short', maximumFractionDigits: digits, minimumFractionDigits: digits }).format(n)
    const fixed = (n: number, digits: number) => nf({ minimumFractionDigits: digits, maximumFractionDigits: digits, useGrouping: false }).format(n)
    const pad = (n: number) => nf({ minimumIntegerDigits: 2, useGrouping: false }).format(n)
    const tz = (o: Intl.DateTimeFormatOptions) => (timeZone && !o.timeZone ? { ...o, timeZone } : o)
    const toDate = (d: Date | number) => (typeof d === 'number' ? new Date(d) : d)
    const df = (d: Date | number | null | undefined, o: Intl.DateTimeFormatOptions) => (d === null || d === undefined || (typeof d !== 'number' && isNaN(d.getTime())) ? '' : dateFormat(locale, tz(o)).format(toDate(d)))
    const rtf = () => i18nCached('rt', locale, undefined, () => new Intl.RelativeTimeFormat(locale, { numeric: 'auto' }))
    const first = weekStartsOn ?? localeWeekStart(locale)
    return {
      locale,
      compact: n => nf({ notation: 'compact', maximumFractionDigits: 1 }).format(n),
      bytes: n => {
        if (en) return n < 1e3 ? `${Math.max(0, Math.round(n))} B` : n < 1e6 ? `${Math.round(n / 1e3)} KB` : n < 1e9 ? `${fixed(n / 1e6, 1)} MB` : `${fixed(n / 1e9, 1)} GB`
        return n < 1e3 ? unit(Math.max(0, Math.round(n)), 'byte') : n < 1e6 ? unit(Math.round(n / 1e3), 'kilobyte') : n < 1e9 ? unit(n / 1e6, 'megabyte', 1) : unit(n / 1e9, 'gigabyte', 1)
      },
      usd: n => {
        const a = Math.abs(n), d = a >= 1 || a === 0 ? 2 : a >= 0.01 ? 3 : 4
        if (en) return (n < 0 ? '-$' : '$') + fixed(a, d)
        return nf({ style: 'currency', currency: 'USD', currencyDisplay: 'narrowSymbol', minimumFractionDigits: d, maximumFractionDigits: d }).format(n)
      },
      money: (n, currency = 'USD', l = locale) => numberFormat(l, { style: 'currency', currency }).format(n),
      duration: ms => {
        if (ms < 1000) return en ? `${Math.max(0, Math.round(ms))} ms` : unit(Math.max(0, Math.round(ms)), 'millisecond')
        if (ms < 60e3) { const d = ms < 10e3 ? 1 : 0; return en ? `${fixed(ms / 1000, d)} s` : unit(ms / 1000, 'second', d) }
        const m = Math.floor(ms / 60e3), s = Math.round((ms % 60e3) / 1000)
        if (en) return s ? `${m} min ${s} s` : `${m} min`
        return s ? `${unit(m, 'minute')} ${unit(s, 'second')}` : unit(m, 'minute')
      },
      clock: seconds => {
        const t = Math.max(0, Math.floor(seconds || 0)), h = Math.floor(t / 3600), m = Math.floor(t / 60) % 60, s = pad(t % 60)
        return h ? `${fixed(h, 0)}:${pad(m)}:${s}` : `${fixed(m, 0)}:${s}`
      },
      number: (n, o) => nf(o).format(n),
      percent: (f, maxDigits = 1) => nf({ style: 'percent', maximumFractionDigits: maxDigits }).format(f),
      date: (d, o = { day: 'numeric', month: 'short', year: 'numeric' }) => df(d, o),
      time: (d, o = { hour: 'numeric', minute: '2-digit' }) => df(d, o),
      dateTime: (d, o = { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' }) => df(d, o),
      relative: (when, now = Date.now()) => {
        const s = (+toDate(when) - +toDate(now)) / 1000, a = Math.abs(s)
        const [v, u]: [number, Intl.RelativeTimeFormatUnit] = a < 45 ? [s, 'second'] : a < 2700 ? [s / 60, 'minute'] : a < 79200 ? [s / 3600, 'hour'] : a < 6 * 86400 ? [s / 86400, 'day']
          : a < 26 * 86400 ? [s / 604800, 'week'] : a < 320 * 86400 ? [s / 2629800, 'month'] : [s / 31557600, 'year']
        return rtf().format(Math.round(v) || 0, u)
      },
      relativeTime: (value, u) => rtf().format(value, u),
      list: (items, type = 'conjunction') => i18nCached('l', locale, { type }, () => new Intl.ListFormat(locale, { type })).format(items),
      weekdays: (width = 'short', start = first) => Array.from({ length: 7 }, (_, i) => dateFormat(locale, { weekday: width, timeZone: 'UTC' }).format(Date.UTC(2024, 0, 7 + ((start + i) % 7)))),
      months: (width = 'long') => Array.from({ length: 12 }, (_, i) => dateFormat(locale, { month: width, timeZone: 'UTC' }).format(Date.UTC(2024, i, 15))),
      plural: n => i18nPlural(locale).select(n),
      displayName: (code, type) => { try { return i18nCached('dn', locale, { type }, () => new Intl.DisplayNames(locale, { type, fallback: 'code' })).of(code) ?? code } catch { return code } },
    }
  })
}

/**
 * Number formatters in the default locale (en-GB): fmt.compact(12400) → "12.4K", fmt.bytes(2.4e6) → "2.4 MB",
 * fmt.usd(0.0042) → "$0.0042", fmt.money(1234.5, 'EUR') → "€1,234.50", fmt.duration(1530) → "1.5 s" (milliseconds in),
 * fmt.clock(75) → "1:15" (seconds in), plus number/percent/date/time/relative/list/weekdays (see LocaleFmt).
 * Inside components prefer `useLocale().fmt`, which follows the provider's locale.
 */
export const fmt: LocaleFmt = fmtFor(LOCALE)

/* Dates (local time; weeks start on Monday unless told otherwise) ─────────── */

/** Midnight at the start of `d`'s day. */
export const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate())

/** `d` plus `n` days, at midnight (safe across daylight-saving changes). */
export const addDays = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n)

/** The first of `d`'s month plus `n` months. */
export const addMonths = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth() + n, 1)

/** Start of `d`'s week at midnight; weeks start on Monday unless `weekStartsOn` says otherwise (0 = Sunday; `useLocale().weekStartsOn`). */
export const startOfWeek = (d: Date, weekStartsOn = 1) => addDays(d, -((d.getDay() - weekStartsOn + 7) % 7))

/** Same calendar day? Null-safe. */
export const sameDay = (a?: Date | null, b?: Date | null) => !!a && !!b && a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()

/** Stable key for a day, "2026-11-08", for maps and React keys. */
export const dayKey = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

/** Format a date (default locale en-GB): fmtDate(d) → "8 Nov 2026"; pass Intl options for other shapes. Empty string for null. In components use `useLocale().fmt.date`. */
export const fmtDate = (d?: Date | null, opts: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short', year: 'numeric' }, locale = LOCALE) =>
  d ? dateFormat(locale, opts).format(d) : ''

/* Messages ─────────────────────────────────────────────────────────────────── */

/**
 * Every built-in UI string, in English. Keys are stable; values use ICU-lite syntax: `{name}` interpolation,
 * `{count, plural, =0 {…} one {# item} other {# items}}` (# is the formatted number) and `{x, select, a {…} other {…}}`.
 * Translate by passing a (partial) catalog with the same keys to `<UIProvider messages>`; missing keys fall back here.
 */
export const UI_MESSAGES_EN = {
  // common actions
  'common.close': 'Close',
  'common.cancel': 'Cancel',
  'common.confirm': 'Confirm',
  'common.done': 'Done',
  'common.ok': 'OK',
  'common.save': 'Save',
  'common.saved': 'Saved',
  'common.delete': 'Delete',
  'common.edit': 'Edit',
  'common.editItem': 'Edit {name}',
  'common.add': 'Add',
  'common.remove': 'Remove',
  'common.removeItem': 'Remove {name}',
  'common.open': 'Open',
  'common.openItem': 'Open {name}',
  'common.copy': 'Copy',
  'common.copied': 'Copied',
  'common.copyFailed': 'Couldn’t copy',
  'common.clipboardBlocked': 'Clipboard blocked',
  'common.search': 'Search',
  'common.searchPlaceholder': 'Search…',
  'common.filter': 'Filter',
  'common.clear': 'Clear',
  'common.clearAll': 'Clear all',
  'common.reset': 'Reset',
  'common.retry': 'Retry',
  'common.retryNow': 'Retry now',
  'common.undo': 'Undo',
  'common.redo': 'Redo',
  'common.send': 'Send',
  'common.sending': 'Sending…',
  'common.continue': 'Continue',
  'common.back': 'Back',
  'common.previous': 'Previous',
  'common.next': 'Next',
  'common.more': 'More',
  'common.moreActions': 'More actions',
  'common.moreCount': '{count} more',
  'common.showMore': 'Show more',
  'common.showLess': 'Show less',
  'common.expand': 'Expand',
  'common.collapse': 'Collapse',
  'common.expandAll': 'Expand all',
  'common.collapseAll': 'Collapse all',
  'common.select': 'Select…',
  'common.selectAll': 'Select all',
  'common.selectedCount': '{count, plural, =0 {None selected} other {# selected}}',
  'common.dismiss': 'Dismiss',
  'common.settings': 'Settings',
  'common.menu': 'Menu',
  'common.required': 'Required',
  'common.optional': 'Optional',
  'common.play': 'Play',
  'common.pause': 'Pause',
  'common.zoomIn': 'Zoom in',
  'common.zoomOut': 'Zoom out',
  'common.approve': 'Approve',
  'common.reject': 'Reject',
  'common.upload': 'Upload',
  'common.addFiles': 'Add files',
  'common.dropFiles': 'Drop files to attach',
  // status
  'status.loading': 'Loading',
  'status.loadingEllipsis': 'Loading…',
  'status.loadingResults': 'Loading results',
  'status.noResults': 'No results',
  'status.noResultsFor': 'No results for “{query}”',
  'status.noData': 'No data',
  'status.resultsCount': '{count, plural, =0 {No results} one {# result} other {# results}}',
  'status.error': 'Something went wrong',
  'status.typing': '{name} is typing…',
  'status.assistantTyping': 'Assistant is typing',
  'status.thinking': 'Thinking…',
  'status.progress': 'Progress',
  'status.offline': 'You’re offline. Edits are saved locally. Retrying in {seconds} s',
  'status.better': '(better)',
  'status.worse': '(worse)',
  'status.deltaTitle': '{value} than the previous period',
  'status.higher': 'Higher',
  'status.betterWord': 'Better',
  'status.worseWord': 'Worse',
  'status.lower': 'Lower',
  // dates and paging
  'date.today': 'Today',
  'date.yesterday': 'Yesterday',
  'date.tomorrow': 'Tomorrow',
  'date.previousMonth': 'Previous month',
  'date.nextMonth': 'Next month',
  'date.chooseDate': 'Choose a date',
  'paging.pagination': 'Pagination',
  'paging.previousPage': 'Previous page',
  'paging.nextPage': 'Next page',
  'paging.page': 'Page {page}',
  'paging.pageOf': 'Page {page} of {total}',
  'paging.rangeOf': '{from}–{to} of {total}',
  'paging.rowsPerPage': 'Rows per page',
  // fields
  'field.showPassword': 'Show password',
  'field.hidePassword': 'Hide password',
  'field.swipeForMore': 'Swipe for more',
  // people and feedback
  'people.groupLabel': '{count, plural, one {# person} other {# people}}: {names}',
  'feedback.notifications': 'Notifications',
  'feedback.dismissNotification': 'Dismiss notification',
  'feedback.like': 'Like, {count}',
  'feedback.cookieTitle': 'We use cookies',
  'feedback.cookieBody': 'Essential cookies keep the site working. Others help us improve it.',
  'feedback.cookieConsent': 'Cookie consent',
  'feedback.saveChoices': 'Save choices',
  'feedback.customise': 'Customise',
  'feedback.rejectAll': 'Reject all',
  'feedback.acceptAll': 'Accept all',
  // appearance (theme switcher)
  'theme.switchToLight': 'Switch to light theme',
  'theme.switchToDark': 'Switch to dark theme',
  'theme.appearance': 'Appearance',
  'theme.settings': 'Appearance settings',
  'theme.mode': 'Mode',
  'theme.light': 'Light',
  'theme.dark': 'Dark',
  'theme.system': 'System',
  'theme.theme': 'Theme',
  'theme.custom': 'Custom',
  'theme.customHint': 'Your colours',
  'theme.variantStyle': '{theme} {mode, select, dark {dark} other {light}} style',
  'theme.customise': 'Customise',
  'theme.customEditing': 'Editing your Custom theme',
  'theme.customCreates': 'Edits create a Custom theme',
  'theme.colourLabel': '{name} colour',
  'theme.colour.bg': 'Background',
  'theme.colour.card': 'Surface',
  'theme.colour.fg': 'Text',
  'theme.colour.primary': 'Primary',
  'theme.colour.accent': 'Accent',
  'theme.colour.ok': 'Success',
  'theme.colour.warn': 'Warning',
  'theme.colour.bad': 'Danger',
  'theme.radius': 'Corner radius',
  'theme.font': 'Font',
  'theme.copyCss': 'Copy CSS',
  'theme.cssCopied': 'CSS variables copied',
  // locale switcher
  'locale.language': 'Language',
  'locale.direction': 'Direction',
  'locale.ltr': 'Left to right',
  'locale.rtl': 'Right to left',
}

/** A message key of the built-in catalog. */
export type UIMessageKey = keyof typeof UI_MESSAGES_EN

/** A full catalog; `Partial<UIMessages>` is what `<UIProvider messages>` takes. Extra app keys are allowed. */
export type UIMessages = Record<UIMessageKey, string>

/** Values for a message's placeholders. Numbers are formatted in the locale. */
export type MessageVars = Record<string, string | number | Date | null | undefined>

/** t('common.removeItem', { name: 'Ada' }) → "Remove Ada". */
export type Translate = (key: UIMessageKey | (string & {}), vars?: MessageVars) => string

/** Format one ICU-lite message: `{name}`, `{n, number}`, `{n, plural, =0 {…} one {# …} other {# …}}`, `{x, select, a {…} other {…}}`. */
export function formatMessage(pattern: string, vars: MessageVars = {}, locale: string = LOCALE): string {
  return i18nFormat(pattern, vars, locale, undefined)
}

function i18nFormat(p: string, vars: MessageVars, locale: string, hash: string | undefined): string {
  let out = ''
  for (let i = 0; i < p.length; i++) {
    const c = p[i]
    if (c === '#' && hash !== undefined) { out += hash; continue }
    if (c !== '{') { out += c; continue }
    let depth = 1, j = i + 1
    for (; j < p.length && depth; j++) { if (p[j] === '{') depth++; else if (p[j] === '}') depth-- }
    out += i18nArg(p.slice(i + 1, j - 1), vars, locale, hash)
    i = j - 1
  }
  return out
}

function i18nArg(body: string, vars: MessageVars, locale: string, hash: string | undefined): string {
  const m = /^\s*([\w.-]+)\s*(?:,\s*(plural|select|number|date)\s*(?:,([\s\S]*))?)?$/.exec(body)
  if (!m) return '{' + body + '}'
  const [, name, type, rest = ''] = m, v = vars[name]
  const show = (x: unknown) => (x instanceof Date ? dateFormat(locale, { day: 'numeric', month: 'short', year: 'numeric' }).format(x) : typeof x === 'number' ? numberFormat(locale).format(x) : String(x))
  if (!type) return v === undefined || v === null ? '{' + name + '}' : show(v)
  if (type === 'number') return numberFormat(locale).format(Number(v))
  if (type === 'date') return v instanceof Date || typeof v === 'number' ? dateFormat(locale, { day: 'numeric', month: 'short', year: 'numeric' }).format(v) : String(v ?? '')
  const opts = new Map<string, string>() // `sel {msg}` pairs
  const re = /\s*(=?[\w-]+)\s*\{/g
  let k: RegExpExecArray | null
  while ((k = re.exec(rest))) {
    let depth = 1, j = re.lastIndex
    for (; j < rest.length && depth; j++) { if (rest[j] === '{') depth++; else if (rest[j] === '}') depth-- }
    opts.set(k[1], rest.slice(re.lastIndex, j - 1)); re.lastIndex = j
  }
  if (type === 'select') return i18nFormat(opts.get(String(v)) ?? opts.get('other') ?? '', vars, locale, hash)
  const n = Number(v ?? 0)
  const pick = opts.get('=' + n) ?? opts.get(i18nPlural(locale).select(n)) ?? opts.get('other') ?? ''
  return i18nFormat(pick, vars, locale, numberFormat(locale).format(n))
}

declare const process: { env: Record<string, string | undefined> }

/** Dev builds warn once per missing key; production bundles (NODE_ENV replaced with "production") stay quiet. */
const i18nDev = (() => { try { return process.env.NODE_ENV !== 'production' } catch { return false } })()

const i18nWarned = new Set<string>()

function i18nWarn(locale: string, key: string, unknown: boolean) {
  const id = locale + '|' + key
  if (!i18nDev || i18nWarned.has(id)) return
  i18nWarned.add(id)
  console.warn(unknown ? `[@lyndon/ui] Unknown message key "${key}" (not in UI_MESSAGES_EN or the provider's messages).`
    : `[@lyndon/ui] No ${locale} translation for "${key}"; using English. Add it to <UIProvider messages>.`)
}

/** A t() for one locale and catalog. Falls back to English, then to the key itself (with a dev warning). */
export function createTranslator(locale: string = LOCALE, messages: Partial<Record<string, string>> = {}, { warnMissing = !i18nIsEnglish(locale) }: { warnMissing?: boolean } = {}): Translate {
  const en = UI_MESSAGES_EN as Record<string, string>
  return (key, vars) => {
    const own = messages[key], s = own ?? en[key]
    if (own === undefined && (s === undefined || warnMissing)) i18nWarn(locale, key, s === undefined)
    return s === undefined ? key : vars || s.includes('{') ? i18nFormat(s, vars ?? {}, locale, undefined) : s
  }
}

/* Locale context ───────────────────────────────────────────────────────────── */

/** Everything `useLocale()` returns. */
export type UILocale = {
  /** BCP 47 tag, e.g. 'en-GB', 'ar-EG'. */
  locale: string
  /** Resolved text direction ('auto' becomes the locale's). */
  dir: UIDir
  /** IANA zone for dates (undefined = the runtime's local zone). */
  timeZone: string | undefined
  /** First day of the week, 0 = Sunday. */
  weekStartsOn: WeekDay
  /** The locale's clock. */
  hourCycle: HourCycle
  /** The provider's message overrides (not merged with English). */
  messages: Partial<Record<string, string>>
  t: Translate
  /** Formatters bound to `locale`, `timeZone` and `weekStartsOn`. */
  fmt: LocaleFmt
}

/** What LocaleProvider (and UIProvider) take. */
export type LocaleSettings = {
  /** BCP 47 locale (default 'en-GB', not navigator.language, so server and client render the same). */
  locale?: string
  /** 'ltr' | 'rtl' | 'auto' (default): 'auto' follows the locale (ar, he, fa, ur… are rtl). */
  dir?: UIDir | 'auto'
  /** IANA time zone for formatted dates and times (default: the runtime's). Set it when you server-render dates. */
  timeZone?: string
  /** First day of the week, 0 = Sunday … 6 = Saturday (default: from the locale; en-GB Monday, en-US Sunday, ar-EG Saturday). */
  weekStartsOn?: WeekDay
  /** Force a 12- or 24-hour clock (default: the locale's). */
  hourCycle?: HourCycle
  /** Partial catalog overriding UI_MESSAGES_EN (e.g. UI_MESSAGES_DE, or `{ 'common.close': 'Dismiss' }`). App keys welcome. */
  messages?: Partial<UIMessages> & Partial<Record<string, string>>
}

/** Resolve settings into a context value (pure; also used for the default). */
export function resolveLocale({ locale = LOCALE, dir = 'auto', timeZone, weekStartsOn, hourCycle, messages = {} }: LocaleSettings = {}): UILocale {
  const week = weekStartsOn ?? localeWeekStart(locale)
  return {
    locale, dir: dir === 'auto' ? localeDir(locale) : dir, timeZone, weekStartsOn: week, hourCycle: hourCycle ?? localeHourCycle(locale), messages,
    t: createTranslator(locale, messages, { warnMissing: !i18nIsEnglish(locale) && Object.keys(messages).length > 0 }),
    fmt: fmtFor(locale, { timeZone, weekStartsOn: week }),
  }
}

const LocaleCtx = createContext<UILocale | null>(null)
const localeDefault: { value?: UILocale } = {}

/**
 * The locale outside any provider: en-GB, ltr, English strings (made once). In the registry's drop-in files other than
 * ui-provider.tsx, scripts/build-registry.mjs swaps this for a stub that asks for <UIProvider>, so those files carry
 * only the context, not the formatter and catalog engine (UIProvider provides the real value).
 */
function localeFallback(): UILocale { return (localeDefault.value ??= resolveLocale()) }

/** Provides the locale to everything below (UIProvider renders one; use it directly to localise one subtree). */
export function LocaleProvider({ children, locale, dir, timeZone, weekStartsOn, hourCycle, messages }: LocaleSettings & { children: ReactNode }) {
  const value = useMemo(() => resolveLocale({ locale, dir, timeZone, weekStartsOn, hourCycle, messages }), [locale, dir, timeZone, weekStartsOn, hourCycle, messages])
  return <LocaleCtx.Provider value={value}>{children}</LocaleCtx.Provider>
}

/** const { locale, dir, t, fmt, weekStartsOn } = useLocale(): the provider's locale (en-GB outside a provider). */
export const useLocale = (): UILocale => useContext(LocaleCtx) ?? localeFallback()

/** 'ltr' or 'rtl', from the nearest provider. */
export const useDir = (): UIDir => useLocale().dir

/* Module catalogs ──────────────────────────────────────────────────────────────
 * A module owns its strings without touching UI_MESSAGES_EN:
 *   const GRID_MSG = defineMessages('grid', { en: { groupBy: 'Group by {col}' }, de: { groupBy: 'Nach {col} gruppieren' } })
 *   const t = useMessages(GRID_MSG); t('groupBy', { col })   // keys are typed from `en`; apps override with messages={{ 'grid.groupBy': … }}
 * Lookup: provider messages['grid.groupBy'] → defs['de-AT'] → defs.de → defs.en → the key. */

/** A module's message catalog: `en` defines the keys; other languages (`de`, `ar`, `pt-BR`…) are partial. */
export type MessageDefs<K extends string = string> = {
  readonly namespace: string
  readonly en: Readonly<Record<K, string>>
  /** every catalog by language tag (lower-case language, or language-REGION), `en` included */
  readonly catalogs: Readonly<Partial<Record<string, Partial<Record<K, string>>>>>
}

/** The key type of a `defineMessages` result: `MessageKeyOf<typeof GRID_MSG>`. */
export type MessageKeyOf<D> = D extends MessageDefs<infer K> ? K : never

/** t() for a module catalog: typed keys, ICU-lite values like the built-in one. */
export type ModuleTranslate<K extends string> = (key: K, vars?: MessageVars) => string

/**
 * Declare a module's own strings: `defineMessages('chat', { en: { stop: 'Stop' }, de: { stop: 'Stoppen' }, ar: { stop: 'إيقاف' } })`.
 * `en` is required and sets the keys; translations may be partial (a missing key falls back to English).
 * Apps override any key through `<UIProvider messages={{ 'chat.stop': '…' }}>` without forking the module.
 */
export function defineMessages<K extends string>(namespace: string,
  catalogs: { en: Record<K, string> } & { [lang: string]: Partial<Record<NoInfer<K>, string>> | undefined }): MessageDefs<K> {
  return { namespace, en: catalogs.en, catalogs: catalogs as MessageDefs<K>['catalogs'] }
}

/** The catalog of `defs` for a locale: exact tag ('pt-BR', any case), then its language ('pt'); undefined for English or none. */
function i18nCatalogFor<K extends string>(defs: MessageDefs<K>, locale: string): Partial<Record<K, string>> | undefined {
  const c = defs.catalogs, lower = locale.toLowerCase(), lang = lower.split('-')[0]
  const exact = c[locale] ?? c[lower] ?? Object.entries(c).find(([k]) => k.toLowerCase() === lower)?.[1]
  return exact ?? (lang === 'en' ? undefined : c[lang])
}

/** A t() for a module catalog outside React (the hook form is `useMessages`). */
export function createMessagesTranslator<K extends string>(defs: MessageDefs<K>, locale: string = LOCALE, messages: Partial<Record<string, string>> = {}): ModuleTranslate<K> {
  const own = i18nCatalogFor(defs, locale), ns = defs.namespace + '.', en = defs.en as Record<string, string>
  return (key, vars) => {
    const s = messages[ns + key] ?? own?.[key] ?? en[key]
    if (s === undefined) { i18nWarn(locale, ns + key, true); return key }
    if (own && own !== defs.en && own[key] === undefined && messages[ns + key] === undefined) i18nWarn(locale, ns + key, false)
    return vars || s.includes('{') ? i18nFormat(s, vars ?? {}, locale, undefined) : s
  }
}

/**
 * `const t = useMessages(GRID_MSG)`: t('groupBy', { col }) in the provider's locale. Lookup: provider
 * `messages['grid.groupBy']` → the catalog for the locale (exact tag, then language) → `en` → the key.
 */
export function useMessages<K extends string>(defs: MessageDefs<K>): ModuleTranslate<K> {
  const { locale, messages } = useLocale()
  return useMemo(() => createMessagesTranslator(defs, locale, messages), [defs, locale, messages])
}

/** The flat `{ 'ns.key': value }` catalog of `defs` in one language (English fills the gaps), e.g. to review or export translations. */
export function messageCatalog<K extends string>(defs: MessageDefs<K>, locale = 'en'): Record<string, string> {
  const own = i18nCatalogFor(defs, locale)
  return Object.fromEntries(Object.entries(defs.en).map(([k, v]) => [defs.namespace + '.' + k, own?.[k as K] ?? (v as string)]))
}

/* RTL helpers ──────────────────────────────────────────────────────────────── */

/**
 * The arrow key as an LTR widget understands it: in RTL, ArrowLeft and ArrowRight swap (Left moves forward).
 * `switch (logicalArrow(e.key, dir)) { case 'ArrowRight': next(); … }`. Other keys pass through.
 */
export const logicalArrow = (key: string, dir: UIDir) => (dir !== 'rtl' ? key : key === 'ArrowLeft' ? 'ArrowRight' : key === 'ArrowRight' ? 'ArrowLeft' : key)

/** An x offset that points the same logical way in both directions: `initial={{ x: dirX(12, dir) }}` slides in from the end side. */
export const dirX = (n: number, dir: UIDir) => (dir === 'rtl' ? -n : n)

/** Icons that point along the reading direction and should mirror in RTL (add the `ui-flip` class). rtl-lint-ignore */
export const UI_FLIP_ICONS: readonly string[] = ['chevronLeft', 'chevronRight', 'undo', 'forward', 'listBullet', 'listOrdered', 'listPlus', 'quote', 'wrap']

/** CSS for direction: `.ui-flip` mirrors an element (an arrow icon) under dir="rtl", and back under a nested dir="ltr". UIProvider injects it. */
export const UI_DIR_CSS = '[dir=rtl] .ui-flip{transform:scaleX(-1)}[dir=rtl] [dir=ltr] .ui-flip{transform:none}'
/* ═══ end LOCALE / I18N ═══ */
