import type { GitChanges, GitCommit, GitFileChange, GitRef } from '../lib/gitgraph'
import { seeded } from './random'

/* Sample git history for the showcase's GitGraph: a deterministic, realistic repository (main + develop + feature
 * branches, releases with tags, hotfixes merged into both, a revert, an octopus merge, a stale remote branch, a stash
 * and HEAD on a feature branch) and fake loadCommit/loadDiff that answer with plausible file diffs. */

/** The time the sample history is "now" at (its newest commits are minutes before it). Pass it as GitGraph's `now`. */
export const GIT_SAMPLE_NOW = Date.UTC(2026, 10, 9, 15, 30)

const GIT_SAMPLE_AUTHORS = [
  { name: 'Ana Lima', email: 'ana.lima@acme.dev' }, { name: 'Ben Okafor', email: 'ben@acme.dev' }, { name: 'Chen Wei', email: 'chen.wei@acme.dev' },
  { name: 'Dana Kowalski', email: 'dana@acme.dev' }, { name: 'Elif Demir', email: 'elif.demir@acme.dev' }, { name: 'Farid Haddad', email: 'farid@acme.dev' },
  { name: 'Grace Park', email: 'grace.park@acme.dev' }, { name: 'Hugo Martin', email: 'hugo@acme.dev' },
]
const GIT_SAMPLE_FEATURES = ['oauth-pkce', 'csv-export', 'dark-mode', 'search-index', 'rate-limits', 'webhooks', 'billing-v2', 'offline-sync',
  'audit-log', 'sso-saml', 'image-cdn', 'command-palette', 'notifications', 'bulk-edit', 'pdf-invoices', 'two-factor', 'team-roles', 'api-keys']
/** area → files it touches and the things its commits talk about */
const GIT_SAMPLE_AREAS: Record<string, { files: string[]; things: string[] }> = {
  auth: { files: ['src/server/auth/session.ts', 'src/server/auth/oauth.ts', 'src/server/auth/tokens.ts'], things: ['session refresh', 'PKCE verifier', 'token rotation', 'login redirect'] },
  api: { files: ['src/server/api/routes.ts', 'src/server/api/limits.ts', 'src/server/api/webhooks.ts'], things: ['pagination cursor', 'rate limit headers', 'webhook retries', 'error envelope'] },
  ui: { files: ['src/app/components/Table.tsx', 'src/app/components/Sidebar.tsx', 'src/app/pages/Settings.tsx'], things: ['empty state', 'sidebar collapse', 'focus ring', 'table header'] },
  search: { files: ['src/server/search/index.ts', 'src/server/search/query.ts'], things: ['prefix matching', 'index rebuild', 'ranking weights'] },
  billing: { files: ['src/server/billing/invoices.ts', 'src/server/billing/plans.ts'], things: ['proration', 'invoice PDF', 'plan limits', 'tax rounding'] },
  build: { files: ['vite.config.ts', 'package.json', '.github/workflows/ci.yml'], things: ['CI cache', 'bundle size', 'source maps', 'Node 22'] },
  i18n: { files: ['src/app/i18n/en.json', 'src/app/i18n/de.json', 'src/app/i18n/format.ts'], things: ['plural rules', 'German strings', 'RTL layout'] },
  perf: { files: ['src/app/lib/virtual.ts', 'src/server/db/pool.ts'], things: ['list virtualisation', 'connection pool', 'N+1 query'] },
  docs: { files: ['README.md', 'docs/api.md', 'CHANGELOG.md'], things: ['setup guide', 'API reference', 'changelog'] },
}
const GIT_SAMPLE_FEATURE_AREA: Record<string, string> = {
  'oauth-pkce': 'auth', 'csv-export': 'ui', 'dark-mode': 'ui', 'search-index': 'search', 'rate-limits': 'api', webhooks: 'api', 'billing-v2': 'billing',
  'offline-sync': 'perf', 'audit-log': 'api', 'sso-saml': 'auth', 'image-cdn': 'perf', 'command-palette': 'ui', notifications: 'ui', 'bulk-edit': 'ui',
  'pdf-invoices': 'billing', 'two-factor': 'auth', 'team-roles': 'auth', 'api-keys': 'api', 'commit-graph': 'ui',
}

type GitSampleMeta = { area: string; subject: string; files: number }
/** What the fake loaders know about each generated commit (its area and how many files it touched). */
const gitSampleMeta = new Map<string, GitSampleMeta>()

/**
 * A deterministic realistic history of about `n` commits (default 300; 50 000 takes ~100 ms): main and develop, feature
 * branches merged back (some after merging develop into themselves), releases merged into main with a tag and back into
 * develop, hotfixes merged into both, reverts, an octopus merge, a stale remote branch, a stash, and HEAD on an unmerged
 * feature branch that is two commits ahead of its remote. Newest first, like `git log`.
 */
export function gitHistory(n = 300, { seed = 7, now = GIT_SAMPLE_NOW }: { seed?: number; now?: number } = {}): GitCommit[] {
  const rnd = seeded(seed), pick = <T,>(xs: readonly T[]) => xs[Math.floor(rnd() * xs.length)]
  const hex = () => Array.from({ length: 5 }, () => Math.floor(rnd() * 0x100000000).toString(16).padStart(8, '0')).join('')
  const out: GitCommit[] = []
  let t = 0
  const mk = (parents: string[], subject: string, area: string, extra: Partial<GitCommit> = {}) => {
    t += 15 * 60e3 + rnd() * rnd() * 9 * 3600e3
    const c: GitCommit = { hash: hex(), parents, subject, author: pick(GIT_SAMPLE_AUTHORS), date: t, ...extra }
    out.push(c); gitSampleMeta.set(c.hash, { area, subject, files: 1 + Math.floor(rnd() * 3) })
    return c.hash
  }
  const verbs = ['add', 'support', 'handle', 'improve', 'simplify', 'speed up', 'tidy', 'document']
  const fixes = ['fix', 'guard against', 'stop', 'correct']
  const work = (area: string, kind: 'feat' | 'fix' | 'chore' | 'test' | 'refactor' = rnd() < 0.55 ? 'feat' : rnd() < 0.6 ? 'fix' : pick(['chore', 'test', 'refactor'] as const)) => {
    const thing = pick(GIT_SAMPLE_AREAS[area].things)
    const verb = kind === 'fix' ? `${pick(fixes)} ${pick(['double', 'stale', 'missing', 'flaky', 'off-by-one'])} ${thing}` : kind === 'test' ? `cover ${thing}` : `${pick(verbs)} ${thing}`
    return `${kind}(${area}): ${verb}`
  }
  const body = (area: string) => rnd() < 0.3
    ? `${pick(['Previously', 'Until now', 'Before this change'])} the ${pick(GIT_SAMPLE_AREAS[area].things)} ${pick(['was recomputed on every render', 'ignored the user locale', 'leaked a timer', 'could race with logout'])}.\n\n- ${pick(['Moves the check into', 'Caches the result in', 'Adds a guard to'])} \`${pick(GIT_SAMPLE_AREAS[area].files).split('/').pop()}\`\n- Adds tests\n\nRefs #${100 + Math.floor(rnd() * 900)}`
    : undefined

  // the start of the project
  let main = mk([], 'Initial commit', 'docs')
  main = mk([main], 'chore: scaffold app with Vite and React', 'build')
  main = mk([main], 'chore(build): set up CI', 'build')
  let develop = mk([main], 'chore: start develop branch', 'build')

  type Feature = { name: string; tip: string; count: number; area: string; keepRef?: boolean }
  const features: Feature[] = []
  let featureNo = 0, minor = 0, patch = 0, sinceRelease = 0, sinceHotfix = 0, pr = 40
  let octopus = false, stale = false, cacheCommit = '', revertsDone = 0, keptRefs = 0
  const tags = new Map<string, GitRef[]>()
  const addRef = (hash: string, ref: GitRef) => tags.set(hash, [...(tags.get(hash) ?? []), ref])
  const startFeature = (name?: string) => {
    const base = name ?? GIT_SAMPLE_FEATURES[featureNo % GIT_SAMPLE_FEATURES.length] + (featureNo >= GIT_SAMPLE_FEATURES.length ? `-${Math.floor(featureNo / GIT_SAMPLE_FEATURES.length) + 1}` : '')
    featureNo++
    const area = GIT_SAMPLE_FEATURE_AREA[base.replace(/-\d+$/, '')] ?? 'ui'
    const f: Feature = { name: `feature/${base}`, tip: '', count: 0, area }
    f.tip = mk([develop], work(area, 'feat'), area, { body: body(area) }); f.count = 1
    features.push(f)
    return f
  }
  const reserve = 14 // the closing scene: HEAD's feature branch, the stash, one more feature
  while (out.length < n - reserve) {
    const r = rnd()
    sinceRelease++; sinceHotfix++
    if (!stale && out.length > n * 0.12) { // a spike that was pushed and abandoned
      stale = true
      let s = mk([develop], 'spike(api): GraphQL gateway prototype', 'api')
      s = mk([s], 'spike(api): resolve users and teams', 'api')
      s = mk([s], 'wip: schema stitching', 'api')
      addRef(s, { name: 'origin/spike/graphql-gateway', type: 'remote' })
      continue
    }
    if (sinceRelease > 45 + rnd() * 25 && out.length < n - reserve - 6) { // release: branch, bump, fix, merge into main (tag) and back into develop
      minor++; patch = 0; sinceRelease = 0
      const name = `release/1.${minor}`
      let rel = mk([develop], `chore(release): bump version to 1.${minor}.0`, 'build')
      if (rnd() < 0.7) rel = mk([rel], work(pick(Object.keys(GIT_SAMPLE_AREAS)), 'fix'), 'ui')
      main = mk([main, rel], `Merge branch '${name}' into main`, 'build')
      addRef(main, { name: `v1.${minor}.0`, type: 'tag' })
      develop = mk([develop, rel], `Merge branch '${name}' into develop`, 'build')
      continue
    }
    if (minor > 0 && sinceHotfix > 70 + rnd() * 30 && out.length < n - reserve - 5) { // hotfix from main, merged into main (tag) and develop
      patch++; sinceHotfix = 0
      const name = `hotfix/1.${minor}.${patch}`, area = pick(['auth', 'api', 'billing'])
      let hf = mk([main], work(area, 'fix'), area, { body: `Production incident ${pick(['INC-', 'SEV2-'])}${200 + Math.floor(rnd() * 800)}.` })
      if (rnd() < 0.4) hf = mk([hf], `test(${area}): regression test for the hotfix`, area)
      main = mk([main, hf], `Merge branch '${name}' into main`, area)
      addRef(main, { name: `v1.${minor}.${patch}`, type: 'tag' })
      develop = mk([develop, hf], `Merge branch '${name}' into develop`, area)
      continue
    }
    if (!octopus && out.length > n * 0.5 && features.filter(f => f.count >= 2).length >= 3) { // an octopus merge of three finished features
      octopus = true
      const done = features.filter(f => f.count >= 2).slice(0, 3)
      develop = mk([develop, ...done.map(f => f.tip)], `Merge branches '${done[0].name}', '${done[1].name}' and '${done[2].name}' into develop`, 'build')
      for (const f of done) features.splice(features.indexOf(f), 1)
      continue
    }
    if (!cacheCommit && out.length > n * 0.28) { cacheCommit = develop = mk([develop], 'feat(perf): add experimental response cache', 'perf'); continue }
    if (cacheCommit && revertsDone * 400 + n * 0.36 < out.length && revertsDone < 1 + n / 400) { // revert the cache (and, in long histories, the odd commit)
      const target = revertsDone === 0 ? cacheCommit : out[out.length - 1 - Math.floor(rnd() * 20)].hash
      const subj = out.find(c => c.hash === target)!.subject
      develop = mk([develop], `Revert "${subj}"`, gitSampleMeta.get(target)?.area ?? 'perf', { body: `This reverts commit ${target}.\n\n${pick(['It doubled memory use under load.', 'It broke cache invalidation for teams.', 'Flaky in staging.'])}` })
      revertsDone++
      continue
    }
    if (r < 0.42 && features.length) { const f = pick(features); f.tip = mk([f.tip], work(f.area), f.area, { body: body(f.area) }); f.count++; continue }
    if (r < 0.52 && features.length < 4) { startFeature(); continue }
    if (r < 0.65) { // merge a finished feature into develop (half as pull requests)
      const f = features.find(x => x.count >= 2 + Math.floor(rnd() * 4))
      if (f) {
        const subject = rnd() < 0.5 ? `Merge branch '${f.name}' into develop` : `Merge pull request #${pr++} from acme/${f.name}`
        develop = mk([develop, f.tip], subject, f.area)
        if (keptRefs < 2 && !tags.has(f.tip) && rnd() < 0.25) { keptRefs++; addRef(f.tip, { name: f.name, type: 'branch' }) } // merged but not deleted
        features.splice(features.indexOf(f), 1)
        continue
      }
    }
    if (r < 0.71) { const area = pick(Object.keys(GIT_SAMPLE_AREAS)); develop = mk([develop], work(area), area, { body: body(area) }); continue }
    if (r < 0.75) { const f = features.find(x => x.count >= 3); if (f) { f.tip = mk([f.tip, develop], `Merge branch 'develop' into ${f.name}`, f.area); f.count++; continue } }
    if (features.length) { const f = pick(features); f.tip = mk([f.tip], work(f.area), f.area); f.count++ }
    else startFeature()
  }

  // closing scene: HEAD on feature/commit-graph, two commits ahead of origin; one more open feature; a stash
  const head = startFeature('commit-graph')
  head.tip = mk([head.tip], 'feat(ui): lay out lanes for the commit graph', 'ui', { body: 'Lanes are assigned in one pass over the topological order.\n\n- first parents keep their lane\n- merges open the leftmost free lane' })
  head.tip = mk([head.tip], 'feat(ui): virtualise commit rows', 'ui')
  addRef(head.tip, { name: 'origin/feature/commit-graph', type: 'remote' })
  const other = features.find(f => f !== head) ?? startFeature()
  other.tip = mk([other.tip], work(other.area), other.area)
  develop = mk([develop], 'chore(deps): bump motion to 14.2', 'build')
  head.tip = mk([head.tip], 'feat(ui): compare two commits', 'ui')
  head.tip = mk([head.tip], 'test(ui): keyboard navigation follows parents', 'ui')
  const headSubject = out[out.length - 1].subject, short = head.tip.slice(0, 7)
  const index = mk([head.tip], `index on feature/commit-graph: ${short} ${headSubject}`, 'ui')
  const stash = mk([head.tip, index], `WIP on feature/commit-graph: ${short} ${headSubject}`, 'ui')

  addRef(main, { name: 'main', type: 'branch' }); addRef(main, { name: 'origin/main', type: 'remote' })
  addRef(develop, { name: 'develop', type: 'branch' }); addRef(develop, { name: 'origin/develop', type: 'remote' })
  for (const f of features) if (f !== head) { addRef(f.tip, { name: f.name, type: 'branch' }); if (rnd() < 0.7) addRef(f.tip, { name: `origin/${f.name}`, type: 'remote' }) }
  addRef(head.tip, { name: 'feature/commit-graph', type: 'head' })
  addRef(stash, { name: 'stash', type: 'stash' })

  const shift = now - 25 * 60e3 - t
  const result = out.map(c => ({ ...c, date: (c.date as number) + shift, ...(tags.has(c.hash) ? { refs: tags.get(c.hash) } : null) }))
  return result.reverse()
}

/** The default sample: ~300 commits (pure: a page that doesn't use it doesn't build it at import). */
export const GIT_SAMPLE: GitCommit[] = /* @__PURE__ */ gitHistory(300)

/** A new commit on top of `parent` (the showcase's "push" button), dated `at`. */
export function gitSampleCommit(parent: GitCommit, at: number, n: number): GitCommit {
  const rnd = seeded(n * 7919 + 3)
  const hash = Array.from({ length: 5 }, () => Math.floor(rnd() * 0x100000000).toString(16).padStart(8, '0')).join('')
  const things = GIT_SAMPLE_AREAS.ui.things
  const c: GitCommit = { hash, parents: [parent.hash], subject: `feat(ui): ${['polish', 'animate', 'test', 'document'][n % 4]} ${things[n % things.length]}`, author: GIT_SAMPLE_AUTHORS[n % GIT_SAMPLE_AUTHORS.length], date: at }
  gitSampleMeta.set(hash, { area: 'ui', subject: c.subject, files: 1 + (n % 2) })
  return c
}

/* ── fake loaders ──────────────────────────────────────────────────────────── */

/** A small, plausible source file for `path`, varied by `seed`. */
function gitSampleSource(path: string, seed: number): string {
  const rnd = seeded(seed), name = (path.split('/').pop() ?? 'file').replace(/\.\w+$/, '')
  if (path.endsWith('.md')) return `# ${name}\n\n## Setup\n\nRun \`pnpm install\`, then \`pnpm dev\`.\n\n## Notes\n\n- Requires Node ${20 + Math.floor(rnd() * 3)}\n- Set \`API_URL\` in \`.env\`\n`
  if (path.endsWith('.json')) return `{\n  "name": "${name}",\n  "version": "1.${Math.floor(rnd() * 9)}.0",\n  "private": true,\n  "scripts": {\n    "dev": "vite",\n    "build": "vite build",\n    "test": "vitest run"\n  }\n}`
  if (path.endsWith('.yml')) return `name: CI\non: [push, pull_request]\njobs:\n  test:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: actions/checkout@v4\n      - uses: pnpm/action-setup@v4\n      - run: pnpm install --frozen-lockfile\n      - run: pnpm test\n`
  const id = name.replace(/[^a-zA-Z]/g, '') || 'mod'
  return `import { db } from '../db'
import { log } from '../log'

const LIMIT = ${10 + Math.floor(rnd() * 90)}
const TIMEOUT_MS = ${1000 * (1 + Math.floor(rnd() * 9))}

/** ${id}: load, check and save. */
export async function ${id}(input: { id: string; force?: boolean }) {
  const row = await db.find('${id}', input.id)
  if (!row) throw new Error('not found')
  if (row.count >= LIMIT && !input.force) {
    log.warn('${id}: over limit', { id: input.id })
    return { ok: false }
  }
  const next = { ...row, count: row.count + 1, updatedAt: Date.now() }
  await db.save('${id}', next, { timeout: TIMEOUT_MS })
  return { ok: true, value: next }
}
`
}
/** `before` with a few edits: a changed constant, an added guard, a removed log line. */
function gitSampleEdit(before: string, seed: number): string {
  const rnd = seeded(seed), lines = before.split('\n')
  const edits = 1 + Math.floor(rnd() * 3)
  for (let k = 0; k < edits; k++) {
    const i = 1 + Math.floor(rnd() * Math.max(1, lines.length - 2))
    const kind = rnd()
    if (kind < 0.4) lines[i] = lines[i].replace(/\d+/, d => String(Number(d) * 2)) || lines[i] + ' // tuned'
    else if (kind < 0.75) lines.splice(i, 0, lines[i].match(/^\s*/)![0] + pick2(rnd, ['// keep in sync with the API docs', "if (input.id === '') return { ok: false }", 'const started = performance.now()', '- Covered by tests']))
    else if (lines.length > 6) lines.splice(i, 1)
  }
  return lines.join('\n')
}
const pick2 = <T,>(rnd: () => number, xs: readonly T[]) => xs[Math.floor(rnd() * xs.length)]
const gitSampleSeed = (hash: string) => parseInt(hash.slice(0, 8), 16) || 1

function gitSampleFiles(hash: string, count?: number): GitFileChange[] {
  const meta = gitSampleMeta.get(hash), seed = gitSampleSeed(hash), rnd = seeded(seed)
  if (meta?.subject.startsWith('Merge')) return []
  const area = GIT_SAMPLE_AREAS[meta?.area ?? 'ui'] ?? GIT_SAMPLE_AREAS.ui
  const n = Math.min(area.files.length, count ?? meta?.files ?? 2), start = Math.floor(rnd() * area.files.length)
  return Array.from({ length: n }, (_, k) => {
    const path = area.files[(start + k) % area.files.length], before = gitSampleSource(path, seed + k), roll = rnd()
    if (roll < 0.08 && !path.endsWith('.json')) return { path, status: 'added', before: '', after: gitSampleEdit(before, seed + 99) }
    if (roll < 0.12) return { path, status: 'deleted', before, after: '' }
    if (roll < 0.16) { const to = path.replace(/(\w+)(\.\w+)$/, '$1-v2$2'); return { path: to, oldPath: path, status: 'renamed', before, after: gitSampleEdit(before, seed + 7) } }
    return { path, status: 'modified', before, after: gitSampleEdit(before, seed + k + 1) }
  })
}

/** Fake `loadCommit` for the sample: the files a commit changed, with before/after text, after a short network-like delay. */
export const gitSampleLoadCommit = (hash: string): Promise<GitChanges> =>
  new Promise(res => setTimeout(() => res({ files: gitSampleFiles(hash) }), 260))

/** Fake `loadDiff` for the sample: a combined diff between two commits. */
export const gitSampleLoadDiff = (from: string, to: string): Promise<GitChanges> =>
  new Promise(res => setTimeout(() => {
    const seen = new Set<string>(), files: GitFileChange[] = []
    for (const f of [...gitSampleFiles(to, 3), ...gitSampleFiles(from, 2)]) if (!seen.has(f.path)) { seen.add(f.path); files.push(f.status === 'modified' ? { ...f, after: gitSampleEdit(f.after ?? '', gitSampleSeed(to)) } : f) }
    res({ files })
  }, 320))
