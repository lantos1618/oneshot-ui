import { useEffect, useMemo, useState } from 'react'
import { useReducedMotion } from 'motion/react'
import { Citation, CodeBlock, CodeTabs, Diff, GitGraph, type GitCommit, InlineCode, InstallCommand, Kbd, Markdown, type Source, Switch, Terminal, markdownCodeBlock, useToast, useViewport } from '../lib'
import { GIT_SAMPLE, GIT_SAMPLE_NOW, gitHistory, gitSampleCommit, gitSampleLoadCommit, gitSampleLoadDiff } from '../examples'
import { Section, Spec, SpecAction } from './kit'

const IMPORT_CODE = `import { createFlow } from './flow';
import { notify } from './notify';

// Run an import and report the result
export async function runImport(file) {
  const flow = createFlow({ name: 'csv-import', retries: 3 });
  const rows = await flow.step('parse', () => parseCSV(file));
  const { ok, failed } = await flow.step('validate', () => validate(rows));

  if (failed.length > 0) {
    await flow.step('queue', () => queueForReview(failed));
  }

  await notify('#imports', \`Imported \${ok.length} rows, \${failed.length} to review\`);
  return { imported: ok.length, review: failed.length };
}

function validate(rows) {
  const ok = [], failed = [];
  for (const row of rows) {
    (isValid(row) ? ok : failed).push(row);
  }
  return { ok, failed };
}`

/** The same file one commit earlier, for the inline diff. */
const IMPORT_PREV = IMPORT_CODE
  .replace('retries: 3', 'retries: 1')
  .replace("  if (failed.length > 0) {\n    await flow.step('queue', () => queueForReview(failed));\n  }\n\n", '')
  .replace('`Imported ${ok.length} rows, ${failed.length} to review`', "'Import finished'")
  .replace('    (isValid(row) ? ok : failed).push(row);', '    if (isValid(row)) ok.push(row);\n    else failed.push(row);')

const EXAMPLES = [
  { label: 'JavaScript', language: 'js' as const, code: `const res = await fetch('https://api.example.com/v1/flows/run', {
  method: 'POST',
  headers: { Authorization: \`Bearer \${process.env.API_KEY}\` },
  body: JSON.stringify({ flow: 'csv-import', file: 'orders-nov.csv' }),
});
const run = await res.json();
console.log(run.id, run.status);` },
  { label: 'Python', language: 'py' as const, code: `import os, requests

res = requests.post(
    "https://api.example.com/v1/flows/run",
    headers={"Authorization": f"Bearer {os.environ['API_KEY']}"},
    json={"flow": "csv-import", "file": "orders-nov.csv"},
)
run = res.json()
print(run["id"], run["status"])` },
  { label: 'cURL', language: 'sh' as const, code: `curl https://api.example.com/v1/flows/run \\
  -H "Authorization: Bearer $API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"flow": "csv-import", "file": "orders-nov.csv"}'` },
  { label: 'Response', language: 'json' as const, code: `{
  "id": "run_8f2k1",
  "status": "running",
  "steps": 6,
  "started_at": "2026-11-07T09:30:00Z",
  "retries": 3,
  "dry_run": false
}` },
]

const DIFF_BEFORE = `export const flow = createFlow({
  name: 'csv-import',
  retries: 0,
  timeout: 30,
});

flow.on('error', (e) => console.error(e));`
const DIFF_AFTER = `export const flow = createFlow({
  name: 'csv-import',
  retries: 3,
  backoff: 'exponential',
  timeout: 30,
});

flow.on('error', (e) => report(e, { flow: 'csv-import' }));`

/** A model answer for the Markdown card: table, fence, task list, quote, citations, links and an image (shown as a link). */
const MD_ANSWER = `## Why the CSV import is slow

Most of the time goes to **validation**, not parsing: every row is checked *one at a time*, and each failure makes its own \`queueForReview()\` call [1].

| Step | Rows/s | Share of time |
|:--|--:|--:|
| Parse | 48,000 | 6% |
| Validate | 2,100 | 81% |
| Queue for review | 900 | 13% |

> Batching the review queue alone cut a 50k-row import from 41 s to 9 s in staging [2].

### Suggested fix

\`\`\`ts
const failed = rows.filter((row) => !isValid(row));
await flow.step('queue', () => queueForReview(failed)); // one call, not N
\`\`\`

- [x] Batch the \`queueForReview\` calls
- [x] Compile the schema once, outside the loop
- [ ] Stream rows instead of loading the whole file
  - Use a \`ReadableStream\` for files over 20 MB

See the [flow docs](https://example.com/docs/flows) or https://example.com/changelog for details. ~~Raising \`retries\`~~ won't help here.
![Import timeline](https://example.com/import-timeline.png)`

const MD_SOURCES: Source[] = [
  { title: 'Flow runtime: steps and retries', url: 'https://example.com/docs/flows/steps', snippet: 'Each step call is awaited and retried on its own; batch work inside a step to avoid per-item overhead.' },
  { title: 'Staging report, import batching', url: 'https://example.com/reports/import-batching', snippet: '50,000 rows: 41.2 s before, 9.0 s after batching the review queue.' },
]
const mdCite = (n: number) => MD_SOURCES[n - 1] ? <Citation n={n} source={MD_SOURCES[n - 1]} /> : <sup>[{n}]</sup>

/** Streams the sample answer in a few characters at a time once the card is on screen (remount to replay); `still` shows it whole. */
function MarkdownStreamDemo({ still }: { still: boolean }) {
  const reduce = useReducedMotion()
  const { ref, seen } = useViewport<HTMLDivElement>(null, { amount: 0 }) // any part on screen (the card is taller than a phone screen)
  const [n, setN] = useState(0)
  const whole = still || !!reduce
  useEffect(() => {
    if (whole || !seen) return
    let i = 0, timer = 0
    const tick = () => {
      i = Math.min(MD_ANSWER.length, i + 2 + Math.floor(Math.random() * 7))
      setN(i)
      if (i < MD_ANSWER.length) timer = window.setTimeout(tick, 24)
    }
    timer = window.setTimeout(tick, 250)
    return () => window.clearTimeout(timer)
  }, [whole, seen])
  const shown = whole ? MD_ANSWER.length : n
  return (
    // the finished answer sits invisibly underneath, so the card has its final height from the start (no layout shift);
    // rendered as a stream too, so its tables get the same fixed column widths as the live copy
    <div ref={ref} className="grid max-w-[72ch]">
      <div aria-hidden inert className="invisible col-start-1 row-start-1"><Markdown streaming caret={false} renderCitation={mdCite} renderCode={markdownCodeBlock}>{MD_ANSWER}</Markdown></div>
      <div className="col-start-1 row-start-1 min-w-0" aria-live="off">
        <Markdown streaming={shown < MD_ANSWER.length} renderCitation={mdCite} renderCode={markdownCodeBlock}>{MD_ANSWER.slice(0, shown)}</Markdown>
      </div>
    </div>
  )
}

const dim = 'text-[var(--fg3)]', ok = 'text-[var(--ok)]', acc = 'text-[var(--accent)]'

/** The Git graph card: the sample history (or 50k commits), host callbacks as toasts, and "Push" prepending a commit on HEAD. */
function GitGraphDemo({ big, pushes }: { big: boolean; pushes: number }) {
  const toast = useToast()
  const base = useMemo(() => (big ? gitHistory(50_000, { seed: 11 }) : GIT_SAMPLE), [big])
  // each push adds a commit on top of HEAD's branch and moves HEAD to it
  const commits = useMemo(() => {
    let list: GitCommit[] = base
    for (let k = 1; k <= pushes; k++) {
      const head = list.find(c => c.refs?.some(r => r.type === 'head'))
      if (!head) break
      const ref = head.refs!.find(r => r.type === 'head')!
      const next = { ...gitSampleCommit(head, GIT_SAMPLE_NOW + k * 7 * 60e3, k), refs: [ref] }
      list = [next, ...list.map(c => (c === head ? { ...c, refs: c.refs!.filter(r => r !== ref) } : c))]
    }
    return list
  }, [base, pushes])
  const say = (title: string) => (hash: string) => toast({ title, description: `${hash.slice(0, 7)} · demo: the host runs git` })
  return (
    <GitGraph commits={commits} now={GIT_SAMPLE_NOW + pushes * 7 * 60e3} pin={['main', 'develop']} height={480}
      loadCommit={gitSampleLoadCommit} loadDiff={gitSampleLoadDiff}
      onCheckout={(hash, branch) => toast({ title: branch ? `Checked out ${branch}` : 'Checked out (detached HEAD)', description: hash.slice(0, 7) })}
      onCreateBranch={say('Create branch')} onCherryPick={say('Cherry-picked')} onRevert={say('Reverted')} onCopyHash={say('Copied hash')} />
  )
}

export function CodeSection() {
  const [mdRun, setMdRun] = useState(0)
  const [mdStill, setMdStill] = useState(false)
  const [gitBig, setGitBig] = useState(false)
  const [gitPushes, setGitPushes] = useState(0)
  return (
    <Section id="code" title="Code" desc="Highlighted blocks, tabs, diffs, a terminal and streamed Markdown. Tokenised in the page, no highlighter library.">
      <Spec title="Code block" desc="File name, language, line numbers, highlighted lines, wrap, copy, expand" span={2}>
        <CodeBlock code={IMPORT_CODE} previous={IMPORT_PREV} filename="run-import.ts" highlight={[7, 8]} />
      </Spec>
      <Spec title="Terminal" desc="Commands type out, output streams in">
        <Terminal lines={[
          { cmd: 'npm create flow@latest my-app' },
          { out: <span className={dim}>Creating project in ./my-app</span> },
          { out: <><span className={ok}>✔</span> Scaffolded 14 files</> },
          { out: <><span className={ok}>✔</span> Installed 212 packages <span className={dim}>in 3.1s</span></> },
          { cmd: 'cd my-app && npm run dev' },
          { out: <><span className={acc}>▲</span> Ready in 640 ms</> },
          { out: <>  Local:   <span className={acc}>http://localhost:3000</span></> },
          { out: <><span className="text-[var(--warn)]">!</span> 1 flow has no retries set <span className={dim}>(csv-import)</span></> },
          { cmd: 'npm test' },
          { out: <><span className={ok}>✔</span> 48 passed <span className={dim}>· 3 files · 1.2s</span></> },
          { out: <><span className={dim}>Coverage</span> 91.4%</> },
        ]} />
      </Spec>
      <Spec title="Tabbed example" desc="Same request in three languages, height animates between tabs" span={2}>
        <CodeTabs tabs={EXAMPLES} />
      </Spec>
      <Spec title="Install command" desc="Package manager tabs, one-click copy">
        <InstallCommand pkg="motion number-flow" />
        <p className="m-0 text-xs leading-[1.7] text-[var(--fg2)]">Inline code looks like <InlineCode>useFlow()</InlineCode> and keys look like <Kbd>⌘</Kbd> <Kbd>K</Kbd>.</p>
      </Spec>
      <Spec title="Diff" desc="Unified or split view, added and removed lines, hunk header" span={3}>
        <Diff before={DIFF_BEFORE} after={DIFF_AFTER} filename="flow.config.ts" hunk="createFlow" />
      </Spec>
      <Spec title="Markdown" span={3}
        desc="Model output as it streams: half-typed syntax never flashes, code fences become code blocks, links are checked and images aren't fetched"
        actions={<>
          <SpecAction aria-pressed={mdStill} onClick={() => { if (mdStill) setMdRun(r => r + 1); setMdStill(v => !v) }}>Static</SpecAction>
          <SpecAction onClick={() => { setMdStill(false); setMdRun(r => r + 1) }}>Replay</SpecAction>
        </>}>
        <MarkdownStreamDemo key={mdRun} still={mdStill} />
      </Spec>
      <Spec title="Git graph" span={3}
        desc="Commit history with lanes and merges, refs, search, branch filter and compare. Click a commit for its diff; Shift+click a second to compare; right-click for actions"
        keys={[[['↑', '↓'], 'Commits'], [['←', '→'], 'Parent, child'], [['↵'], 'Details'], [['⇧', 'Click'], 'Compare'], [['/'], 'Search'], [['n', 'N'], 'Next match'], [['⇧', 'F10'], 'Actions'], [['Esc'], 'Close']]}
        notes={{
          good: 'Reading how branches came together: lanes keep first-parent chains straight, main and develop stay pinned left, and hovering a commit lights its ancestry. Rows draw their own slice of the graph, so 50k commits scroll like 50.',
          breaks: 'Very wide histories (dozens of live branches) fold into a "+n lanes" gutter, and the layout is computed in one pass on the main thread (about 0.1 s per 50k commits), so for monorepo-sized logs filter by branch or load the history in pages.',
        }}
        actions={<>
          <SpecAction onClick={() => setGitPushes(n => n + 1)}>Push a commit</SpecAction>
          <Switch label={<span className="text-xs text-[var(--fg2)]">50k commits</span>} checked={gitBig} onChange={v => { setGitBig(v); setGitPushes(0) }} />
        </>}>
        <GitGraphDemo big={gitBig} pushes={gitPushes} />
      </Spec>
    </Section>
  )
}
