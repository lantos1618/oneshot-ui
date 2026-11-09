import { defineConfig, devices } from '@playwright/test'
import type { ShowcaseOptions } from './tests/e2e/fixtures'

// End-to-end checks of the showcase page (tests/e2e). By default the showcase is built and served with `vite preview`
// on port 4173, as in CI. Point E2E_BASE_URL at a running server (e.g. the dev server) to skip the build:
//   E2E_BASE_URL=http://localhost:5173 pnpm test:e2e
const CI = !!process.env.CI
const external = process.env.E2E_BASE_URL
const PORT = 4173
/** The tests the iphone-rtl profile runs. */
const RTL_PHONE_SUBSET = /page shell|section (buttons|inputs|forms|navigation|feedback|overlays|data|layout)$/
/** The Design QA audit (tests/e2e/design-qa.spec.ts) runs on desktop light, iPhone 13 and iPhone RTL (every section). */
const DESIGN_QA = /design-qa\.spec\.ts$/

export default defineConfig<ShowcaseOptions>({
  testDir: 'tests/e2e',
  outputDir: 'test-results',
  fullyParallel: true,
  forbidOnly: CI,
  retries: CI ? 1 : 0,
  workers: process.env.E2E_WORKERS ? Number(process.env.E2E_WORKERS) : CI ? 2 : 3,
  timeout: 180_000,
  expect: { timeout: 10_000 },
  reporter: CI ? [['github'], ['list'], ['html', { open: 'never' }]] : [['list']],
  globalSetup: './tests/e2e/global-setup.ts',
  globalTeardown: './tests/e2e/global-teardown.ts',
  use: {
    baseURL: external ?? `http://localhost:${PORT}`,
    trace: 'off',
    screenshot: 'only-on-failure',
    video: 'off',
    // Chromium only: the locally preinstalled browser (PLAYWRIGHT_BROWSERS_PATH) or the one CI installs.
    browserName: 'chromium',
  },
  projects: [
    { name: 'desktop-light', use: { viewport: { width: 1440, height: 900 }, colorScheme: 'light', themeMode: 'light' } },
    { name: 'desktop-dark', testIgnore: DESIGN_QA, use: { viewport: { width: 1440, height: 900 }, colorScheme: 'dark', themeMode: 'dark' } },
    // iPhone 13 metrics (390 × 664 CSS px, touch, mobile) in Chromium instead of WebKit.
    { name: 'iphone-13', use: { ...devices['iPhone 13'], browserName: 'chromium', colorScheme: 'light', themeMode: 'light' } },
    // Right to left: the showcase in Arabic (ar-EG, dir="rtl" from the locale). Desktop covers every section; the phone a
    // subset (the page shell plus the sections with the most direction-sensitive layout) to keep the run short.
    { name: 'desktop-rtl', testIgnore: DESIGN_QA, use: { viewport: { width: 1440, height: 900 }, colorScheme: 'light', themeMode: 'light', showcaseLocale: 'ar-EG', locale: 'ar-EG' } },
    { name: 'iphone-rtl', grep: [RTL_PHONE_SUBSET, /design qa: section/], use: { ...devices['iPhone 13'], browserName: 'chromium', colorScheme: 'light', themeMode: 'light', showcaseLocale: 'ar-EG', locale: 'ar-EG' } },
  ],
  webServer: external ? undefined : {
    command: `pnpm exec vite build --logLevel warn && pnpm exec vite preview --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: !CI,
    timeout: 240_000,
    stdout: 'ignore',
    stderr: 'pipe',
  },
})
