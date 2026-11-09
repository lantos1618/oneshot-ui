import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

// Unit and interaction tests (jsdom). The Playwright suite in tests/e2e has its own runner (playwright.config.ts).
export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    include: ['tests/unit/**/*.test.{ts,tsx}'],
    setupFiles: ['tests/setup.ts'],
    testTimeout: 15_000,
    restoreMocks: true,
  },
})
