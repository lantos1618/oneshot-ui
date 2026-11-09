// Theme storage validation, the ui-theme → ui-theme:v1 migration, and palette contrast.
import { act, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import {
  DEFAULT_THEME, THEMES, THEME_LEGACY_KEY, THEME_STORAGE_KEY, ThemeProvider, contrast, derive, hex, seeded, themeLoad, themeSafeTokens, themeStored, themeTokens, useTheme,
  type ThemeSettings,
} from '../../src/lib/core'

const JUNK: unknown[] = [
  null, undefined, 0, 1, NaN, '', 'x', '{"theme":"ayu"}', true, [], [1, 2], () => {}, Symbol('s'), new Date(), Object.create(null),
  { theme: 42 }, { theme: 'nope' }, { theme: '__proto__' }, { theme: 'constructor' }, { mode: 'night' }, { mode: 1 },
  { radius: Infinity }, { radius: -Infinity }, { radius: NaN }, { radius: '8' }, { radius: 1e9 }, { radius: -40 },
  { font: 'x"}</style><img src=//x>' }, { font: 'Comic Sans' }, { font: ['Geist'] },
  { variant: null }, { variant: 'x' }, { variant: [1, 2] }, { variant: { default: -1 } }, { variant: { ayu: 99 } }, { variant: { ayu: 0.5 } }, { variant: { ayu: '1' } },
  { custom: 1 }, { custom: { dark: 1, v: 1 } }, { custom: { dark: true, v: { bg: 'url(http://x/) #fff' } } }, { custom: { v: { bg: '#fff' } } },
  { useCustom: true }, { useCustom: 'yes', custom: null },
  { css: { light: { bg: 'url(https://evil.test/x)' } } },
  JSON.parse('{"__proto__":{"polluted":true},"theme":"nord"}'),
  // shape of an old (pre-validation) save
  { theme: 'ayu', mode: 'dark', radius: 12, font: 'Inter', variant: { ayu: 1 }, custom: null, useCustom: false, css: { light: {}, dark: {} } },
]

const isValid = (s: ThemeSettings) => {
  expect(THEMES.map(t => t.id)).toContain(s.theme)
  expect(['light', 'dark', 'system']).toContain(s.mode)
  expect(Number.isFinite(s.radius)).toBe(true)
  expect(s.radius).toBeGreaterThanOrEqual(0)
  expect(s.radius).toBeLessThanOrEqual(32)
  expect(typeof s.font).toBe('string')
  expect(s.font).toMatch(/^[A-Za-z0-9 -]{1,40}$/)
  expect(typeof s.variant).toBe('object')
  for (const [id, i] of Object.entries(s.variant)) {
    const t = THEMES.find(x => x.id === id)!
    expect(t).toBeDefined()
    expect(Number.isInteger(i) && i >= 0 && i < Math.max(t.light.length, t.dark.length)).toBe(true)
  }
  if (s.custom) for (const v of Object.values(s.custom.v)) expect(v).toMatch(/^#[0-9A-F]{6}$/)
  expect(typeof s.useCustom).toBe('boolean')
}

describe('themeLoad', () => {
  it.each(JUNK.map((j, i) => [i, j] as const))('never throws and returns valid settings (case %i)', (_i, raw) => {
    let s!: ThemeSettings
    expect(() => { s = themeLoad(raw) }).not.toThrow()
    isValid(s)
    // and everything downstream of it is safe too
    for (const dark of [false, true]) {
      const tokens = themeTokens(s, dark)
      expect(themeSafeTokens(tokens)).toEqual(tokens)
    }
    expect(() => JSON.parse(themeStored(s))).not.toThrow()
  })

  it('keeps every valid field', () => {
    const s = themeLoad({ theme: 'ayu', mode: 'dark', radius: 12, font: 'Inter', variant: { ayu: 1, nord: 0 }, custom: null, useCustom: false })
    expect(s).toEqual({ theme: 'ayu', mode: 'dark', radius: 12, font: 'Inter', variant: { ayu: 1, nord: 0 }, custom: null, useCustom: false })
  })

  it('clamps the radius and drops bad variants', () => {
    expect(themeLoad({ radius: 400 }).radius).toBe(32)
    expect(themeLoad({ radius: -3 }).radius).toBe(0)
    expect(themeLoad({ variant: { ayu: 99, nord: 0, made_up: 1 } }).variant).toEqual({ nord: 0 })
  })

  it('cleans a custom palette value by value', () => {
    const s = themeLoad({ useCustom: true, custom: { dark: true, v: { bg: '#112233', fg: 'url(https://evil.test)', primary: 'red' } } })
    expect(s.useCustom).toBe(true)
    expect(s.custom?.dark).toBe(true)
    expect(s.custom?.v.bg).toBe('#112233')
    expect(s.custom?.v.fg).toBe(THEMES[0].light[0][1].fg)
    expect(s.custom?.v.primary).toBe(THEMES[0].light[0][1].primary)
  })

  it('falls back to the given base settings', () => {
    const base = { ...DEFAULT_THEME, theme: 'nord', radius: 4 }
    expect(themeLoad('junk', base)).toEqual(base)
    expect(themeLoad({ theme: 'nope', radius: 'x' }, base)).toMatchObject({ theme: 'nord', radius: 4 })
  })

  it('does not pollute Object.prototype', () => {
    themeLoad(JSON.parse('{"__proto__":{"polluted":true},"variant":{"__proto__":{"x":1}}}'))
    expect(({} as Record<string, unknown>).polluted).toBeUndefined()
  })
})

/* ThemeProvider storage ─────────────────────────────────────────────────────── */

function Probe() {
  const { settings, dark } = useTheme()
  return <output data-testid="theme">{JSON.stringify({ theme: settings.theme, mode: settings.mode, radius: settings.radius, dark })}</output>
}
const shown = () => JSON.parse(screen.getByTestId('theme').textContent!)

describe('ThemeProvider storage', () => {
  it('uses the versioned key', () => expect(THEME_STORAGE_KEY).toBe('ui-theme:v1'))

  it('migrates the legacy ui-theme key once and keeps the legacy value', () => {
    localStorage.setItem(THEME_LEGACY_KEY, JSON.stringify({ theme: 'nord', mode: 'dark', radius: 6 }))
    render(<ThemeProvider><Probe /></ThemeProvider>)
    expect(shown()).toMatchObject({ theme: 'nord', mode: 'dark', radius: 6, dark: true })
    const saved = JSON.parse(localStorage.getItem(THEME_STORAGE_KEY)!)
    expect(saved).toMatchObject({ theme: 'nord', mode: 'dark', radius: 6 })
    expect(saved.css.dark.bg).toMatch(/^#[0-9A-F]{6}$/)
    expect(localStorage.getItem(THEME_LEGACY_KEY)).not.toBeNull()
  })

  it('prefers the versioned key over the legacy one', () => {
    localStorage.setItem(THEME_LEGACY_KEY, JSON.stringify({ theme: 'nord' }))
    localStorage.setItem(THEME_STORAGE_KEY, JSON.stringify({ theme: 'gruvbox' }))
    render(<ThemeProvider><Probe /></ThemeProvider>)
    expect(shown().theme).toBe('gruvbox')
  })

  it.each(['not json', '[]', '"str"', '42', 'null', '{"variant":{"default":-1}}', '{"theme":{"toString":1}}'])('survives a tampered value %j', raw => {
    localStorage.setItem(THEME_STORAGE_KEY, raw)
    expect(() => render(<ThemeProvider><Probe /></ThemeProvider>)).not.toThrow()
    expect(THEMES.map(t => t.id)).toContain(shown().theme)
  })

  it('survives tampered legacy values and removes junk', () => {
    localStorage.setItem(THEME_LEGACY_KEY, '{oops')
    render(<ThemeProvider><Probe /></ThemeProvider>)
    expect(shown().theme).toBe('default')
    expect(localStorage.getItem(THEME_LEGACY_KEY)).toBeNull()
  })

  it('validates changes from other tabs', () => {
    render(<ThemeProvider><Probe /></ThemeProvider>)
    act(() => { dispatchEvent(new StorageEvent('storage', { key: THEME_STORAGE_KEY, newValue: '{"theme":"tokyo","radius":"huge","variant":{"tokyo":7}}' })) })
    expect(shown()).toMatchObject({ theme: 'tokyo', radius: 8 })
    act(() => { dispatchEvent(new StorageEvent('storage', { key: THEME_STORAGE_KEY, newValue: 'garbage' })) })
    expect(shown().theme).toBe('tokyo')
  })

  it('does not throw when storage is blocked', () => {
    const get = Storage.prototype.getItem, set = Storage.prototype.setItem
    Storage.prototype.getItem = () => { throw new DOMException('blocked', 'SecurityError') }
    Storage.prototype.setItem = () => { throw new DOMException('blocked', 'SecurityError') }
    try {
      expect(() => render(<ThemeProvider><Probe /></ThemeProvider>)).not.toThrow()
      expect(shown().theme).toBe('default')
    } finally { Storage.prototype.getItem = get; Storage.prototype.setItem = set }
  })
})

/* Contrast ──────────────────────────────────────────────────────────────────── */

const PALETTES = THEMES.flatMap(t => [
  ...t.light.map(([name, p]) => ({ key: `${t.id} ${name}`, p, dark: false })),
  ...t.dark.map(([name, p]) => ({ key: `${t.id} ${name}`, p, dark: true })),
])

describe('derive() on custom palettes', () => {
  // the Customise grid: any primary/accent/ok/bad the user picks on top of a real theme's surfaces
  const rnd = seeded(7), pick = () => hex([rnd() * 255, rnd() * 255, rnd() * 255])
  const cases = PALETTES.flatMap(({ key, p, dark }) => Array.from({ length: 12 }, (_, i) => ({ key: `${key} #${i}`, dark,
    v: { ...p, primary: pick(), 'on-primary': rnd() < 0.5 ? '#FFFFFF' : p.fg, accent: pick(), ok: pick(), warn: pick(), bad: pick() } })))
  it.each(cases)('$key reaches 4.5:1 for on-primary, accent, ok, warn and bad', ({ v, dark }) => {
    const d = derive(v, dark)
    expect(contrast(d['on-primary'], d.primary)).toBeGreaterThanOrEqual(4.5)
    for (const k of ['accent', 'ok', 'warn', 'bad']) expect(Math.min(contrast(d[k], d.card), contrast(d[k], d.bg))).toBeGreaterThanOrEqual(4.5)
  })
})

describe('contrast()', () => {
  it('matches the WCAG reference values', () => {
    expect(contrast('#000000', '#FFFFFF')).toBeCloseTo(21, 5)
    expect(contrast('#FFFFFF', '#FFFFFF')).toBeCloseTo(1, 5)
    expect(contrast('#767676', '#FFFFFF')).toBeCloseTo(4.54, 2)
    expect(contrast('#FFFFFF', '#000000')).toBe(contrast('#000000', '#FFFFFF'))
  })
  it('reads junk as black instead of throwing', () => {
    expect(() => contrast('nope', 42 as unknown as string)).not.toThrow()
  })
})

describe.each(PALETTES)('derive($key)', ({ key, p, dark }) => {
  const d = derive(p, dark)
  it('fg on bg and on card reach 4.5:1', () => {
    expect(contrast(d.fg, d.bg)).toBeGreaterThanOrEqual(4.5)
    expect(contrast(d.fg, d.card)).toBeGreaterThanOrEqual(4.5)
  })
  it('secondary text (fg2, fg3) on card reaches 4.5:1', () => {
    expect(contrast(d.fg2, d.card)).toBeGreaterThanOrEqual(4.5)
    expect(contrast(d.fg3, d.card)).toBeGreaterThanOrEqual(4.5)
  })
  it('on-primary on primary reaches 4.5:1', () => {
    expect(contrast(d['on-primary'], d.primary)).toBeGreaterThanOrEqual(4.5)
  })
  it('accent, ok, warn and bad read 4.5:1 on card and bg (as text, and under card-coloured text on fills)', () => {
    for (const k of ['accent', 'ok', 'warn', 'bad']) {
      expect(contrast(d[k], d.card), `${key} ${k} vs card`).toBeGreaterThanOrEqual(4.5)
      expect(contrast(d[k], d.bg), `${key} ${k} vs bg`).toBeGreaterThanOrEqual(4.5)
    }
  })
  it('changes nothing in a palette that already passes (default theme)', () => {
    if (!key.startsWith('default')) return
    for (const k of ['primary', 'on-primary', 'accent', 'ok', 'warn', 'bad'] as const) expect(d[k]).toBe(p[k])
  })
  it('produces only tokens the style-sheet validator accepts', () => {
    const tokens = { ...d, 'r-md': '8px', 'r-lg': '14px' }
    expect(themeSafeTokens(tokens)).toEqual(tokens)
  })
})
