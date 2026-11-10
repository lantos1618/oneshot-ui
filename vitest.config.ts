import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

// Unit and interaction tests (jsdom). The Playwright suite in tests/e2e has its own runner (playwright.config.ts).
// Local-time date code is only exercised by a zone with daylight saving, so the time zone is pinned (CI runs in UTC):
// every file runs in Europe/London, and the date suites run again in America/Santiago, where midnight is skipped.
const DATE_SUITES = ['tests/unit/helpers.test.tsx', 'tests/unit/dates.test.tsx', 'tests/unit/dst.test.ts']
process.env.TZ = 'Europe/London'

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    setupFiles: ['tests/setup.ts'],
    testTimeout: 15_000,
    restoreMocks: true,
    projects: [
      { extends: true, test: { name: 'london', include: ['tests/unit/**/*.test.{ts,tsx}'], env: { TZ: 'Europe/London' } } },
      { extends: true, test: { name: 'santiago', include: DATE_SUITES, env: { TZ: 'America/Santiago' } } },
    ],
  },
})
