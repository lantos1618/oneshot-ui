// pnpm test:e2e:update-baseline [playwright args…]: runs the e2e suite and rewrites tests/e2e/axe-baseline.json with
// the violations found (only the profiles and sections that ran, e.g. `-- --project desktop-light`, are replaced).
import { spawnSync } from 'node:child_process'

const r = spawnSync('pnpm', ['exec', 'playwright', 'test', '--trace', 'off', ...process.argv.slice(2)], {
  stdio: 'inherit', env: { ...process.env, AXE_BASELINE: 'update' }, shell: process.platform === 'win32',
})
// The baseline is written even when other checks (CLS, console errors) fail; pass their status through.
process.exit(r.status ?? 1)
