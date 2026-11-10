// Package A (foundation): theme tokens, locale formatting, size and live-region hooks, Button asChild, SparkChart, the
// colour resolver, and the shared helpers other packages build on.
import { act, fireEvent, render, renderHook, screen } from '@testing-library/react'
import { useRef } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  Button, DEFAULT_THEME, SparkChart, TOKENS, THEME_MODES, THEME_TOKEN_NAMES, ariaSort, clampIndex, compareCells, fmt, formatHotkey, idPart,
  listKeyMove, moveById, nextSort, parseRgba, plural, rangeStr, resolveColor, revealTheme, sliderKeyValue, snapToStep, themeTokens,
  typeaheadIndex, useLive, useThemeVersion, useWidth,
} from '../../src/lib/core'
import { Chart } from '../../src/lib/charts'
import { themeScriptSource } from '../../src/lib/provider'

afterEach(() => { vi.unstubAllGlobals() })

describe('A-H1: one source for the default palette', () => {
  it.each([false, true])('TOKENS carries every themeTokens(DEFAULT_THEME, dark=%s) value', dark => {
    for (const [k, v] of Object.entries(themeTokens(DEFAULT_THEME, dark))) expect(TOKENS).toContain(`--${k}:${v};`)
  })

  it('names only tokens ThemeScript accepts, plus the fixed scales', () => {
    const names = [...TOKENS.matchAll(/--([a-z0-9-]+):/g)].map(m => m[1]).filter(n => !/^(t|h)-|^(mono|r-full|hit|ui-play)$/.test(n))
    expect(names.filter(n => !THEME_TOKEN_NAMES.includes(n))).toEqual([])
  })
})

describe('A-H2: rangeStr on large series', () => {
  it('summarises 130k values without RangeError', () => {
    const big = Array.from({ length: 130_000 }, (_, i) => i % 7)
    expect(rangeStr(big)).toBe('0 to 6')
    expect(rangeStr(Array(130_000).fill(1))).toBe('1')
    expect(rangeStr([NaN, Infinity])).toBe('no values')
  })

  it('renders a Chart of 130k points without maxPoints', () => {
    const data = Array.from({ length: 130_000 }, (_, i) => ({ x: i, y: i % 100 }))
    expect(() => render(<Chart data={data} x="x" series={[{ key: 'y' }]} legend={false} label="Big" />)).not.toThrow()
  })
})

describe('A-H3: fmt.relative on invalid input', () => {
  it('returns an empty string instead of throwing', () => {
    expect(fmt.relative(new Date('x'))).toBe('')
    expect(fmt.relative(NaN)).toBe('')
    expect(fmt.relative(Date.now(), NaN)).toBe('')
    expect(fmt.date(NaN)).toBe('')
    expect(fmt.relative(Date.now() - 86_400_000, Date.now())).toBe('yesterday')
  })
})

describe('A-M3: useWidth measures the content box', () => {
  it('excludes padding on the first value and after a resize', () => {
    let cw = 200
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(() => cw)
    const observers: (() => void)[] = []
    vi.stubGlobal('ResizeObserver', class { constructor(cb: () => void) { observers.push(cb) } observe() {} unobserve() {} disconnect() {} })
    let seen = -1
    function Box() { const [ref, w] = useWidth<HTMLDivElement>(); seen = w; return <div ref={ref} style={{ padding: '0 10px' }} /> }
    render(<Box />)
    expect(seen).toBe(180)
    cw = 320
    act(() => observers.forEach(cb => cb()))
    expect(seen).toBe(300)
  })

  it('observes a remounted element', () => {
    const watched: Element[] = []
    vi.stubGlobal('ResizeObserver', class { observe(el: Element) { watched.push(el) } unobserve() {} disconnect() {} })
    function Box({ k }: { k: number }) { const [ref] = useWidth<HTMLDivElement>(); return <div key={k} ref={ref} /> }
    const { rerender } = render(<Box k={1} />)
    rerender(<Box k={2} />)
    expect(watched).toHaveLength(2)
    expect(watched[0]).not.toBe(watched[1])
  })
})

describe('A-M4: useLive', () => {
  it('announces the same message twice', () => {
    let say: (t: string) => void = () => {}
    function Live() { const [s, live] = useLive(); say = s; return <>{live}</> }
    const { container } = render(<Live />)
    act(() => say('Copied'))
    const first = screen.getByText('Copied')
    act(() => say('Copied'))
    const second = screen.getByText('Copied')
    expect(second).not.toBe(first)
    expect(container.querySelector('[aria-live="polite"]')).toContainElement(second)
  })
})

describe('A-M5: Button asChild while disabled', () => {
  it("doesn't run the child's onClick on keyboard activation", () => {
    const spy = vi.fn()
    render(<Button asChild disabled><a href="#x" onClick={spy}>Remove</a></Button>)
    const link = screen.getByText('Remove')
    expect(link).toHaveAttribute('aria-disabled', 'true')
    link.focus()
    fireEvent.keyDown(link, { key: 'Enter' })
    fireEvent.click(link)
    expect(spy).not.toHaveBeenCalled()
  })

  it('runs it when enabled', () => {
    const spy = vi.fn()
    render(<Button asChild><a href="#x" onClick={e => { e.preventDefault(); spy() }}>Open</a></Button>)
    fireEvent.click(screen.getByText('Open'))
    expect(spy).toHaveBeenCalledTimes(1)
  })
})

describe('A-M8: SparkChart with a missing value', () => {
  it('draws the rest and never writes NaN', () => {
    // report every element as in view, so the marks take their real positions
    vi.stubGlobal('IntersectionObserver', class {
      cb: (e: object[]) => void
      constructor(cb: (e: object[]) => void) { this.cb = cb }
      observe(target: Element) { this.cb([{ target, isIntersecting: true, intersectionRatio: 1 }]) }
      unobserve() {} disconnect() {} takeRecords() { return [] }
    })
    for (const variant of ['line', 'area', 'bars', 'winloss'] as const) {
      const { container, unmount } = render(<SparkChart data={[1, NaN, 3, 4]} variant={variant} width={120} minMax endDot target={2} />)
      expect(container.innerHTML).not.toMatch(/NaN/)
      expect(container.querySelector('svg')).not.toBeNull()
      unmount()
    }
  })
})

describe('A-M9: revealTheme without matchMedia', () => {
  it("applies the change and doesn't throw", () => {
    vi.stubGlobal('matchMedia', undefined)
    const update = vi.fn()
    expect(() => revealTheme(update)).not.toThrow()
    expect(update).toHaveBeenCalled()
  })
})

describe('A-M2: theme modes', () => {
  it('ThemeScript takes the mode list from THEME_MODES', () => {
    expect(themeScriptSource()).toContain(JSON.stringify(THEME_MODES))
  })
})

describe('A-M18: colour resolver and theme version', () => {
  it('parses the color(srgb …) form browsers compute color-mix() to', () => {
    vi.spyOn(window, 'getComputedStyle').mockImplementation(() => ({ color: 'color(srgb 0.1 0.2 0.3 / 0.5)' }) as CSSStyleDeclaration)
    const el = document.createElement('div'); document.body.appendChild(el)
    expect(resolveColor(el, 'color-mix(in srgb, var(--accent) 40%, var(--card))')).toEqual([26, 51, 77, 0.5])
    el.remove()
  })

  it('reads hex and rgb() directly', () => {
    expect(parseRgba('#FFF')).toEqual([255, 255, 255, 1])
    expect(parseRgba('rgba(37, 99, 235, .13)')).toEqual([37, 99, 235, 0.13])
    expect(parseRgba('rgb(1 2 3 / 50%)')).toEqual([1, 2, 3, 0.5])
    expect(parseRgba('var(--x)')).toBeNull()
    expect(resolveColor(null, 'nonsense')).toEqual([128, 128, 128, 1])
  })

  it('useThemeVersion changes when a scoped .ui-root changes theme', async () => {
    let version = -1
    function Probe() { const ref = useRef<HTMLDivElement>(null); version = useThemeVersion(ref); return <div ref={ref} /> }
    const { container } = render(<div className="ui-root" data-theme="light"><Probe /></div>)
    const before = version
    await act(async () => { (container.firstChild as HTMLElement).setAttribute('data-theme', 'dark'); await Promise.resolve() })
    expect(version).toBeGreaterThan(before)
  })
})

describe('shared helpers', () => {
  it('sorts cells: numbers and dates by value, empties last both ways', () => {
    const rows = [3, null, 1, undefined, 2]
    expect([...rows].sort((a, b) => compareCells(a, b, 1))).toEqual([1, 2, 3, null, undefined])
    expect([...rows].sort((a, b) => compareCells(a, b, -1))).toEqual([3, 2, 1, null, undefined])
    const d = [new Date(2026, 0, 10), new Date(2025, 5, 1)]
    expect([...d].sort((a, b) => compareCells(a, b))[0].getFullYear()).toBe(2025)
    expect(['item 10', 'item 9'].sort((a, b) => compareCells(a, b))).toEqual(['item 9', 'item 10'])
    expect(nextSort(null, 'a')).toEqual({ key: 'a', dir: 1 })
    expect(nextSort({ key: 'a', dir: 1 }, 'a')).toEqual({ key: 'a', dir: -1 })
    expect(nextSort({ key: 'a', dir: -1 }, 'a', { clearable: true })).toBeNull()
    expect(ariaSort({ key: 'a', dir: -1 }, 'a')).toBe('descending')
    expect(ariaSort({ key: 'a', dir: -1 }, 'b')).toBeUndefined()
  })

  it('snaps, clamps and moves', () => {
    expect(snapToStep(0.30000000000000004, { min: 0, max: 1, step: 0.1 })).toBe(0.3)
    expect(snapToStep(0.7, { min: 0, max: 10, step: 0.25 })).toBe(0.75)
    expect(snapToStep(11, { min: 0, max: 10, step: 3 })).toBe(9)
    expect(clampIndex(5, 0)).toBe(0)
    expect(clampIndex(-1, 3)).toBe(0)
    expect(moveById([{ id: 'a' }, { id: 'b' }, { id: 'c' }], 'a', 2).map(x => x.id)).toEqual(['b', 'c', 'a'])
    const list = [{ id: 'a' }]
    expect(moveById(list, 'z', 0)).toBe(list)
  })

  it('keys and text', () => {
    expect(idPart('a b')).not.toBe(idPart('a_b'))
    expect(idPart('plain-id')).toBe('plain-id')
    expect(listKeyMove('ArrowDown', 2, 3)).toBe(0)
    expect(listKeyMove('ArrowDown', 2, 3, { loop: false })).toBe(2)
    expect(listKeyMove('ArrowRight', 0, 3)).toBeNull()
    expect(listKeyMove('ArrowUp', -1, 3)).toBe(2)
    expect(sliderKeyValue('PageUp', 5, { step: 1, min: 0, max: 10 })).toBe(10)
    expect(sliderKeyValue('ArrowUp', 5, { min: 0, max: 10, axis: 'x' })).toBeNull()
    expect(typeaheadIndex(['Apple', 'Banana', 'Avocado'], 'a', 0)).toBe(2)
    expect(typeaheadIndex(['Apple', 'Banana', 'Avocado'], 'av', 0)).toBe(2)
    expect(plural(0, 'result', undefined, { zero: 'No results' })).toBe('No results')
    expect(plural(1000, 'tag')).toBe('1,000 tags')
    expect(fmt.seconds(3.24)).toBe('3.2s')
    expect(formatHotkey('mod+shift+z', true)).toBe('⌘⇧Z')
    expect(formatHotkey('mod+shift+z', false)).toBe('Ctrl+Shift+Z')
  })

  it('renderHook smoke: useLive returns a stable say', () => {
    const { result, rerender } = renderHook(() => useLive())
    const first = result.current[0]
    rerender()
    expect(result.current[0]).toBe(first)
  })
})
