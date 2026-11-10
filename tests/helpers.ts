// Shared setup for the unit tests: a form wrapper, media-query and layout stubs, object-URL spies, fake timers that
// userEvent can drive, and a complexity check that does not depend on how fast the machine is.
import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createElement, type ReactNode } from 'react'
import { expect, onTestFinished, vi } from 'vitest'

/** Renders `children` inside a <form>; `data()` reads its FormData. */
export function inForm(children: ReactNode) {
  const r = render(createElement('form', { 'data-testid': 'f' }, children))
  const form = screen.getByTestId('f') as HTMLFormElement
  return { ...r, form, data: () => new FormData(form) }
}

/** The reduced-motion query tests/setup.ts answers yes to (the library then skips its animations). */
export const REDUCED_MOTION = /prefers-reduced-motion:\s*reduce/

/** A static MediaQueryList, as jsdom lacks matchMedia. */
export const mediaQueryList = (query: string, matches: boolean) => ({
  matches, media: query, onchange: null,
  addEventListener: () => {}, removeEventListener: () => {}, addListener: () => {}, removeListener: () => {}, dispatchEvent: () => false,
}) as MediaQueryList

/** Answers matchMedia with `matches(query)` for the rest of the test (restored by `restoreMocks`). */
export function mockMedia(matches: (query: string) => boolean) {
  return vi.spyOn(window, 'matchMedia').mockImplementation(q => mediaQueryList(q, matches(q)))
}
/** Motion on: no media query matches, reduced motion included. */
export const withMotion = () => mockMedia(() => false)

/** Spies on URL.createObjectURL / revokeObjectURL (restored by `restoreMocks`, unlike assigning them). */
export function mockObjectUrls(url = 'blob:mock/1') {
  return { create: vi.spyOn(URL, 'createObjectURL').mockReturnValue(url), revoke: vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {}) }
}

/** Gives a scroller layout numbers (jsdom has none). scrollTop clamps like a browser; scrollTo lands at once and fires scroll. */
export function fakeScroller(el: HTMLElement, { height = 100, content = 1000 as number | (() => number) } = {}) {
  let top = 0, size = content
  const full = () => (typeof size === 'function' ? size() : size)
  const clampTop = (v: number) => Math.max(0, Math.min(full() - height, v))
  Object.defineProperty(el, 'clientHeight', { configurable: true, get: () => height })
  Object.defineProperty(el, 'scrollHeight', { configurable: true, get: full })
  Object.defineProperty(el, 'scrollTop', { configurable: true, get: () => top, set: (v: number) => { top = clampTop(v) } })
  el.scrollTo = ((o: ScrollToOptions) => { top = clampTop(o.top ?? 0); el.dispatchEvent(new Event('scroll')) }) as typeof el.scrollTo
  return { setContent: (c: number | (() => number)) => { size = c }, get top() { return top } }
}

/**
 * Fake timers plus a userEvent wired to them, so debounces and delays in the code under test are crossed with
 * `tick(ms)` instead of real sleeps. Time stands still between ticks unless `shouldAdvanceTime` is passed.
 * Testing Library only recognises Jest's fake timers: the `jest` shim lets its act() wrapper and waitFor advance
 * these instead of waiting on a timer that never fires.
 */
export function fakeTimersUser(opts?: FakeTimerOptions) {
  fakeTimers(opts)
  return userEvent.setup({ advanceTimers: ms => vi.advanceTimersByTime(ms) })
}
type FakeTimerOptions = Parameters<typeof vi.useFakeTimers>[0]
/** Fake timers (requestAnimationFrame and performance.now included) that Testing Library's waitFor can advance. */
export function fakeTimers(opts?: FakeTimerOptions) {
  vi.useFakeTimers(opts)
  vi.stubGlobal('jest', { advanceTimersByTime: (ms: number) => vi.advanceTimersByTime(ms) })
  onTestFinished(() => { vi.unstubAllGlobals() })
}

/** Advances fake timers inside act, letting promises settle between them (resolved loads render). */
export const tick = (ms: number) => act(async () => { await vi.advanceTimersByTimeAsync(ms) })

/** Longest any single guarded operation may take before a test calls it a hang. */
export const HANG_MS = 10_000

/** Milliseconds `fn` takes, best of `runs`. */
export function timed(fn: () => void, runs = 1) {
  let best = Infinity
  for (let i = 0; i < runs; i++) { const t0 = performance.now(); fn(); best = Math.min(best, performance.now() - t0) }
  return best
}

/** A single run under this is fast enough whatever its growth ratio says (small timings are mostly noise). */
export const SLOW_RUN_MS = 50

/**
 * Complexity guard that does not hinge on the machine's speed: the work for 4n may cost at most `ratio` (10) times the
 * work for n (linear is 4×, quadratic 16×), unless one run at 4n still takes under SLOW_RUN_MS. It fails only when the
 * cost both grows too fast and gets slow, so neither a loaded machine nor a GC pause on a tiny input trips it. Inputs
 * are built outside the timing; each size repeats until it is long enough to time, and the two are timed in turn.
 */
export function expectLinear(make: (n: number) => () => void, n: number, label?: string, ratio = 10) {
  const small = make(n), big = make(4 * n)
  small(); big() // warm up
  const reps = (fn: () => void, k: number) => () => { for (let i = 0; i < k; i++) fn() }
  let k = 1
  while (k < 4096 && timed(reps(small, k)) < 5) k *= 2
  let a = Infinity, b = Infinity
  for (let i = 0; i < 3; i++) { a = Math.min(a, timed(reps(small, k))); b = Math.min(b, timed(reps(big, k))) }
  const ok = b < a * ratio || b / k < SLOW_RUN_MS
  expect(ok, `${label ?? ''} n=${n}: ${(a / k).toFixed(2)} ms, 4n: ${(b / k).toFixed(2)} ms a run`).toBe(true)
}
