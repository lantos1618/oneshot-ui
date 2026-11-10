// Vitest setup: jest-dom matchers, cleanup between tests, and the browser APIs jsdom lacks but the components use.
import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { afterEach, vi } from 'vitest'
import { REDUCED_MOTION, mediaQueryList } from './helpers'

afterEach(() => { cleanup(); localStorage.clear(); vi.useRealTimers() })

// matchMedia: no media query matches except prefers-reduced-motion, so presence unmounts at once and play/FLIP do nothing.
// tests/helpers.ts mockMedia() swaps the answers for one test.
window.matchMedia ??= (query: string) => mediaQueryList(query, REDUCED_MOTION.test(query))

class NoopObserver {
  constructor(_cb?: unknown) {}
  observe() {} unobserve() {} disconnect() {} takeRecords() { return [] }
  root = null; rootMargin = ''; thresholds = []
}
const g = globalThis as Record<string, unknown>
g.ResizeObserver ??= NoopObserver
g.IntersectionObserver ??= NoopObserver
Element.prototype.scrollIntoView ??= function () {}
Element.prototype.scrollTo ??= function () {}
Element.prototype.hasPointerCapture ??= () => false
Element.prototype.setPointerCapture ??= function () {}
Element.prototype.releasePointerCapture ??= function () {}
// jsdom has no layout, so no innerText; textContent is close enough for word counts.
if (!('innerText' in HTMLElement.prototype)) {
  Object.defineProperty(HTMLElement.prototype, 'innerText', {
    configurable: true,
    get(this: HTMLElement) { return this.textContent ?? '' },
    set(this: HTMLElement, v: string) { this.textContent = v },
  })
}
// The rich text editor drives contentEditable through execCommand, which jsdom leaves out.
const doc = document as unknown as Record<string, unknown>
doc.execCommand ??= () => false
doc.queryCommandState ??= () => false
doc.queryCommandValue ??= () => ''
window.scrollTo = () => {}
// Defined so tests can spy on them (mockObjectUrls); jsdom leaves them out.
URL.createObjectURL ??= () => 'blob:jsdom'
URL.revokeObjectURL ??= () => {}
