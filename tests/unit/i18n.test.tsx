// i18n and RTL infrastructure (0.4): messages and t(), locale-bound formatters, week start, direction, SSR,
// the keyboard/motion helpers, and the two sweep scripts (rtl-lint, i18n-extract) on fixtures.
import { render, screen } from '@testing-library/react'
import { renderToString } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  AppearancePanel, Button, LocaleProvider, UIProvider, UI_MESSAGES_AR, UI_MESSAGES_DE, UI_MESSAGES_EN, createTranslator, dirX, fmt, fmtFor, formatMessage,
  localeDir, localeHourCycle, localeWeekStart, logicalArrow, resolveLocale, useDir, useLocale,
} from '../../src/lib'
// @ts-expect-error: plain .mjs build scripts, no type declarations
import { rtlClassFindings, rtlLint } from '../../scripts/rtl-lint.mjs'
// @ts-expect-error: plain .mjs build scripts, no type declarations
import { i18nExtract } from '../../scripts/i18n-extract.mjs'

/** Intl uses no-break and narrow no-break spaces ("1.234,50 €"); compare with plain ones. */
const sp = (s: string) => s.replace(/[  ]/g, ' ')
const NOV8 = new Date(2026, 10, 8, 14, 5)

afterEach(() => { document.documentElement.removeAttribute('dir'); document.documentElement.removeAttribute('lang') })

describe('formatMessage and t()', () => {
  it('interpolates names and formats numbers in the locale', () => {
    expect(formatMessage('Remove {name}', { name: 'Ada' })).toBe('Remove Ada')
    expect(formatMessage('{n} rows', { n: 12345 }, 'en-GB')).toBe('12,345 rows')
    expect(formatMessage('{n} Zeilen', { n: 12345 }, 'de-DE')).toBe('12.345 Zeilen')
    expect(formatMessage('Hello {missing}')).toBe('Hello {missing}')
  })

  it('picks plural forms, exact matches first, with # as the formatted count', () => {
    const p = '{count, plural, =0 {No results} one {# result} other {# results}}'
    expect(formatMessage(p, { count: 0 })).toBe('No results')
    expect(formatMessage(p, { count: 1 })).toBe('1 result')
    expect(formatMessage(p, { count: 1200 })).toBe('1,200 results')
    // Arabic has six categories
    const ar = '{count, plural, zero {z} one {one} two {two} few {few #} many {many #} other {other #}}'
    expect([0, 1, 2, 3, 11, 100].map(n => formatMessage(ar, { count: n }, 'ar'))).toEqual(['z', 'one', 'two', 'few 3', 'many 11', 'other 100'])
    expect(formatMessage('{count, plural, few {# عناصر} other {# عنصر}}', { count: 3 }, 'ar-EG')).toBe('٣ عناصر')
  })

  it('supports select and nested arguments', () => {
    const m = '{theme} {mode, select, dark {dark} other {light}} style'
    expect(formatMessage(m, { theme: 'Ayu', mode: 'dark' })).toBe('Ayu dark style')
    expect(formatMessage(m, { theme: 'Ayu', mode: 'x' })).toBe('Ayu light style')
    expect(formatMessage('{n, plural, one {{who} has # item} other {{who} has # items}}', { n: 2, who: 'Ada' })).toBe('Ada has 2 items')
  })

  it('falls back to English, then to the key, warning once per key in development', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const t = createTranslator('de-DE', { 'common.close': 'Schließen' })
    expect(t('common.close')).toBe('Schließen')
    expect(t('common.cancel')).toBe('Cancel')
    expect(t('common.cancel')).toBe('Cancel')
    expect(warn).toHaveBeenCalledTimes(1)
    expect(String(warn.mock.calls[0][0])).toMatch(/No de-DE translation for "common.cancel"/)
    expect(t('nope.key')).toBe('nope.key')
    expect(String(warn.mock.calls[1][0])).toMatch(/Unknown message key "nope.key"/)
    expect(createTranslator('en-GB')('status.resultsCount', { count: 3 })).toBe('3 results')
    expect(warn).toHaveBeenCalledTimes(2)
  })

  it('ships complete German and Arabic catalogs whose messages all format', () => {
    const keys = Object.keys(UI_MESSAGES_EN).sort()
    expect(Object.keys(UI_MESSAGES_DE).sort()).toEqual(keys)
    expect(Object.keys(UI_MESSAGES_AR).sort()).toEqual(keys)
    const vars = { name: 'x', count: 2, query: 'q', seconds: 3, value: 'v', page: 1, total: 9, from: 1, to: 5, names: 'a', theme: 'T', mode: 'dark' }
    for (const [l, cat] of [['en-GB', UI_MESSAGES_EN], ['de-DE', UI_MESSAGES_DE], ['ar-EG', UI_MESSAGES_AR]] as const)
      for (const [k, v] of Object.entries(cat)) expect(formatMessage(v, vars, l), `${l} ${k}`).not.toMatch(/[{}]/)
  })
})

describe('locale-bound formatters', () => {
  it('keeps the module-level fmt as en-GB', () => {
    expect(fmt.locale).toBe('en-GB')
    expect(fmt.money(1234.5, 'EUR')).toBe('€1,234.50')
    expect(fmt.date(NOV8)).toBe('8 Nov 2026')
    expect(fmt.bytes(2.4e6)).toBe('2.4 MB')
  })

  it('formats numbers and currency per locale', () => {
    expect(fmtFor('en-GB').number(1234.5)).toBe('1,234.5')
    expect(fmtFor('en-US').number(1234.5)).toBe('1,234.5')
    expect(fmtFor('de-DE').number(1234.5)).toBe('1.234,5')
    expect(fmtFor('ar-EG').number(1234.5)).toBe('١٬٢٣٤٫٥')
    expect(sp(fmtFor('de-DE').money(1234.5, 'EUR'))).toBe('1.234,50 €')
    expect(fmtFor('en-US').money(1234.5, 'USD')).toBe('$1,234.50')
    expect(fmtFor('ar-EG').money(5, 'EGP')).toMatch(/٥٫٠٠/)
    expect(sp(fmtFor('de-DE').percent(0.125))).toBe('12,5 %')
    expect(sp(fmtFor('de-DE').bytes(2.4e6))).toBe('2,4 MB')
    expect(fmtFor('ar-EG').clock(75)).toBe('١:١٥')
  })

  it('formats dates, times and lists per locale (and time zone)', () => {
    expect(fmtFor('en-GB').date(NOV8)).toBe('8 Nov 2026')
    expect(fmtFor('en-US').date(NOV8)).toBe('Nov 8, 2026')
    expect(fmtFor('de-DE').date(NOV8)).toBe('8. Nov. 2026')
    expect(fmtFor('ar-EG').date(NOV8)).toMatch(/٢٠٢٦/)
    expect(fmtFor('en-GB').time(NOV8)).toBe('14:05')
    expect(sp(fmtFor('en-US').time(NOV8))).toBe('2:05 PM')
    expect(fmtFor('en-GB').date(null)).toBe('')
    const utcNoon = Date.UTC(2026, 10, 8, 12, 0)
    expect(fmtFor('en-GB', { timeZone: 'Asia/Tokyo' }).time(utcNoon)).toBe('21:00')
    expect(fmtFor('en-GB').list(['a', 'b', 'c'])).toBe('a, b and c')
    expect(fmtFor('de-DE').list(['a', 'b', 'c'])).toBe('a, b und c')
  })

  it('formats relative time', () => {
    const now = Date.UTC(2026, 10, 8, 12)
    expect(fmtFor('en-GB').relative(now - 864e5, now)).toBe('yesterday')
    expect(fmtFor('en-GB').relative(now - 3 * 3600e3, now)).toBe('3 hours ago')
    expect(fmtFor('en-GB').relative(now + 2 * 60e3, now)).toBe('in 2 minutes')
    expect(fmtFor('de-DE').relative(now - 3 * 864e5, now)).toBe('vor 3 Tagen')
    expect(fmtFor('ar-EG').relativeTime(-1, 'day')).toBe('أمس')
    expect(fmtFor('en-US').relativeTime(-3, 'day')).toBe('3 days ago')
  })

  it('lists weekday and month names from the locale’s first day', () => {
    expect(fmtFor('en-GB').weekdays()).toEqual(['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'])
    expect(fmtFor('en-US').weekdays()[0]).toBe('Sun')
    expect(fmtFor('ar-EG').weekdays('long')[0]).toBe('السبت')
    expect(fmtFor('de-DE').weekdays('short', 1)[0]).toBe('Mo')
    expect(fmtFor('de-DE').months()[2]).toBe('März')
  })

  it('caches formatters per locale and options', () => {
    expect(fmtFor('de-DE')).toBe(fmtFor('de-DE'))
    expect(fmtFor('de-DE', { timeZone: 'UTC' })).not.toBe(fmtFor('de-DE'))
  })
})

describe('week start, clock and direction', () => {
  it('reads the first day of the week from the locale', () => {
    expect(localeWeekStart('en-GB')).toBe(1)
    expect(localeWeekStart('en-US')).toBe(0)
    expect(localeWeekStart('de-DE')).toBe(1)
    expect(localeWeekStart('ar-EG')).toBe(6)
    expect(localeWeekStart('ja-JP')).toBe(0)
  })

  it('falls back to the CLDR table where Intl.Locale has no week info', () => {
    const proto = Intl.Locale.prototype as unknown as Record<string, unknown>
    const g = Object.getOwnPropertyDescriptor(proto, 'getWeekInfo'), w = Object.getOwnPropertyDescriptor(proto, 'weekInfo')
    delete proto.getWeekInfo; delete proto.weekInfo
    try {
      expect(localeWeekStart('pt-BR')).toBe(0)
      expect(localeWeekStart('fr-FR')).toBe(1)
      expect(localeWeekStart('ar-JO')).toBe(6)
      expect(localeWeekStart('he')).toBe(0) // region from likely subtags: he → IL
    } finally {
      if (g) Object.defineProperty(proto, 'getWeekInfo', g)
      if (w) Object.defineProperty(proto, 'weekInfo', w)
    }
  })

  it('knows each locale’s clock', () => {
    expect(localeHourCycle('en-GB')).toBe('h23')
    expect(localeHourCycle('en-US')).toBe('h12')
    expect(localeHourCycle('ar-EG')).toBe('h12')
  })

  it('derives the direction from the script (dir auto)', () => {
    for (const l of ['ar', 'ar-EG', 'he-IL', 'fa-IR', 'ur-PK']) expect(localeDir(l)).toBe('rtl')
    for (const l of ['en-GB', 'de-DE', 'ja-JP', 'zh-Hant-TW']) expect(localeDir(l)).toBe('ltr')
    expect(localeDir('not a locale')).toBe('ltr')
    expect(resolveLocale({ locale: 'ar-EG' }).dir).toBe('rtl')
    expect(resolveLocale({ locale: 'ar-EG', dir: 'ltr' }).dir).toBe('ltr')
    expect(resolveLocale({ locale: 'en-GB', dir: 'rtl' }).dir).toBe('rtl')
    expect(resolveLocale({ locale: 'en-US', weekStartsOn: 1 }).weekStartsOn).toBe(1)
  })
})

describe('provider', () => {
  function Probe() {
    const { locale, dir, t, fmt, weekStartsOn, hourCycle } = useLocale()
    return <p data-testid="probe">{[locale, dir, useDir(), weekStartsOn, hourCycle, t('common.close'), t('common.removeItem', { name: 'Ada' }), fmt.number(1234.5)].join('|')}</p>
  }

  it('defaults to en-GB outside and inside a provider', () => {
    render(<Probe />)
    expect(screen.getByTestId('probe').textContent).toBe('en-GB|ltr|ltr|1|h23|Close|Remove Ada|1,234.5')
  })

  it('passes locale, messages and weekStartsOn down, and sets lang/dir on the root and <html>', () => {
    const { container, unmount } = render(<UIProvider persist={false} locale="ar-EG" messages={UI_MESSAGES_AR}><Probe /></UIProvider>)
    expect(screen.getByTestId('probe').textContent).toBe('ar-EG|rtl|rtl|6|h12|إغلاق|إزالة Ada|١٬٢٣٤٫٥')
    const root = container.querySelector('.ui-root')!
    expect(root.getAttribute('dir')).toBe('rtl')
    expect(root.getAttribute('lang')).toBe('ar-EG')
    expect(document.documentElement.getAttribute('dir')).toBe('rtl')
    expect(document.documentElement.getAttribute('lang')).toBe('ar-EG')
    unmount()
    expect(document.documentElement.hasAttribute('dir')).toBe(false)
  })

  it('leaves <html> alone with target="self"', () => {
    const { container } = render(<UIProvider persist={false} target="self" locale="he-IL"><Probe /></UIProvider>)
    expect(container.querySelector('.ui-root')!.getAttribute('dir')).toBe('rtl')
    expect(document.documentElement.hasAttribute('dir')).toBe(false)
  })

  it('takes a partial override (English for the rest) and nests with LocaleProvider', () => {
    render(
      <UIProvider persist={false} messages={{ 'common.close': 'Dismiss' }}>
        <Probe />
        <LocaleProvider locale="de-DE" messages={UI_MESSAGES_DE}><span data-testid="de"><DeClose /></span></LocaleProvider>
      </UIProvider>,
    )
    expect(screen.getByTestId('probe').textContent).toContain('|Dismiss|Remove Ada|')
    expect(screen.getByTestId('de').textContent).toBe('Schließen 1.234,5')
  })
  function DeClose() { const { t, fmt } = useLocale(); return <>{t('common.close')} {fmt.number(1234.5)}</> }

  it('translates the appearance panel', () => {
    render(<UIProvider persist={false} locale="de-DE" messages={UI_MESSAGES_DE}><AppearancePanel /></UIProvider>)
    expect(screen.getByText('Darstellung')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'CSS kopieren' })).toBeInTheDocument()
    expect(screen.getByLabelText('Farbe: Hintergrund')).toBeInTheDocument()
  })

  it('server-renders ar with dir="rtl" and lang, and injects the flip rule', () => {
    const html = renderToString(<UIProvider locale="ar-EG"><Button>حفظ</Button></UIProvider>)
    expect(html).toMatch(/class="ui-root" lang="ar-EG" dir="rtl"/)
    expect(html).toContain('[dir=rtl] .ui-flip{transform:scaleX(-1)}')
    expect(renderToString(<UIProvider><Button>x</Button></UIProvider>)).toMatch(/lang="en-GB" dir="ltr"/)
  })
})

describe('RTL helpers', () => {
  it('logicalArrow swaps left and right only in RTL', () => {
    expect(logicalArrow('ArrowLeft', 'ltr')).toBe('ArrowLeft')
    expect(logicalArrow('ArrowLeft', 'rtl')).toBe('ArrowRight')
    expect(logicalArrow('ArrowRight', 'rtl')).toBe('ArrowLeft')
    expect(logicalArrow('ArrowUp', 'rtl')).toBe('ArrowUp')
    expect(logicalArrow('Home', 'rtl')).toBe('Home')
  })

  it('dirX mirrors x offsets in RTL', () => {
    expect(dirX(12, 'ltr')).toBe(12)
    expect(dirX(12, 'rtl')).toBe(-12)
    expect(dirX(-8, 'rtl')).toBe(8)
  })
})

describe('scripts/rtl-lint.mjs', () => {
  it('maps physical utilities to logical ones, keeping variants and important marks', () => {
    const f = rtlClassFindings('ml-2 pr-[3px] hover:left-0 !text-right -mr-1 border-l-2 rounded-tl-[var(--r-md)] rounded-r float-left max-sm:pl-4!')
    expect(f.map((x: { suggestion: string }) => x.suggestion)).toEqual(['ms-2', 'pe-[3px]', 'hover:start-0', '!text-end', '-me-1', 'border-s-2', 'rounded-ss-[var(--r-md)]', 'rounded-e', 'float-start', 'max-sm:ps-4!'])
    expect(f.every((x: { fixable: boolean }) => x.fixable)).toBe(true)
  })

  it('keeps safe-area padding and centring, and flags what needs a decision', () => {
    const kinds = (s: string) => rtlClassFindings(s).map((x: { kind: string; token: string }) => `${x.kind}:${x.token}`)
    expect(kinds('pl-[max(16px,env(safe-area-inset-left))]')).toEqual(['kept:pl-[max(16px,env(safe-area-inset-left))]'])
    expect(kinds('absolute left-1/2 -translate-x-1/2')).toEqual(['kept:left-1/2'])
    expect(kinds('flex space-x-2')).toEqual(['manual:space-x-2'])
    expect(kinds('flex space-x-2 rtl:space-x-reverse')).toEqual([])
    expect(kinds('translate-x-4 origin-left')).toEqual(['manual:translate-x-4', 'manual:origin-left'])
    expect(kinds('left-0 rtl:right-0 rtl:left-auto')).toEqual(['manual:left-0'])
    expect(kinds('ms-2 pe-4 text-start start-0')).toEqual([])
    expect(kinds('left-start')).toEqual([]) // a placement value, not a class
  })

  it('finds icons, arrow keys and inline styles, and fixes only the safe classes', () => {
    const src = [
      "export function X({ onKey }: { onKey: (k: string) => void }) {",
      "  return <div className=\"ml-2 flex space-x-1\" style={{ left: 4 }} onKeyDown={e => { if (e.key === 'ArrowLeft') onKey('prev') }}>",
      "    <Icon name=\"chevronRight\" /><span className={`pl-3 ${'text-left'}`}>x</span>",
      "    <i className=\"pr-[max(8px,env(safe-area-inset-right))]\" />",
      "  </div>",
      "}",
    ].join('\n')
    const { findings, fixed } = rtlLint(src, 'x.tsx')
    const got = findings.map((x: { kind: string; token: string; line: number }) => `${x.line} ${x.kind} ${x.token}`)
    expect(got).toEqual(['2 class ml-2', '2 manual space-x-1', '2 style left', '2 keys ArrowLeft', '3 icon chevronRight', '3 class pl-3', '3 class text-left', '4 kept pr-[max(8px,env(safe-area-inset-right))]'])
    expect(fixed).toContain('className="ms-2 flex space-x-1"')
    expect(fixed).toContain("className={`ps-3 ${'text-start'}`}")
    expect(fixed).toContain('pr-[max(8px,env(safe-area-inset-right))]')
    expect(fixed).toContain('style={{ left: 4 }}')
    expect(rtlLint(fixed, 'x.tsx').findings.filter((x: { kind: string }) => x.kind === 'class')).toEqual([])
  })
})

describe('scripts/i18n-extract.mjs', () => {
  it('reports JSX text, text attributes, label defaults and object labels, but not t() calls or classes', () => {
    const src = [
      "export function Y({ label = 'Loading', t }: { label?: string; t: (k: string) => string }) {",
      "  toast({ title: 'Copied', tone: 'ok' })",
      "  return <div className=\"flex gap-2\" aria-label=\"Close panel\" title={t('common.close')}>",
      "    No results <b>{'Clear all'}</b> <Icon name=\"chevronRight\" />",
      "    <input placeholder={busy ? 'Saving…' : `Search ${n} rows`} />",
      "    <span>{t('status.noResults')}</span> · 12",
      "  </div>",
      "}",
    ].join('\n')
    const got = i18nExtract(src, 'y.tsx').map((x: { line: number; kind: string; text: string }) => `${x.line} ${x.kind} ${x.text}`)
    expect(got).toEqual(['1 default Loading', '2 object Copied', '3 attr Close panel', '4 text No results', '4 text Clear all', '5 attr Saving…', '5 attr Search {…} rows'])
  })
})
