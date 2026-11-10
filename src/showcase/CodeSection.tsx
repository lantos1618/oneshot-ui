import { useEffect, useMemo, useState } from 'react'
import { useReducedMotion } from 'motion/react'
import { BinaryView, Citation, CodeBlock, CodeTabs, Diff, GitGraph, type GitCommit, InlineCode, InstallCommand, Kbd, Markdown, type Source, Switch, Tabs, Terminal, markdownCodeBlock, useToast, useViewport } from '../lib'
import { AgentRunExample, AstGraphExample, BINARY_SAMPLE_SECTIONS, binarySample, binarySampleLarge, ChatBranchesExample, DependencyGraphExample, chatTreeHistory, GIT_SAMPLE, GIT_SAMPLE_NOW, gitHistory, gitSampleCommit, gitSampleLoadCommit, gitSampleLoadDiff } from '../examples'
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

/** The tabs of the "Graphs as rows" card: one LaneGraph idea, five kinds of data. Only the open tab is mounted. */
const GRAPH_TABS = [
  { value: 'git', label: 'Git' }, { value: 'chat', label: 'Chat' }, { value: 'ast', label: 'AST' },
  { value: 'agent', label: 'Agent run' }, { value: 'deps', label: 'Dependencies' },
] as const
const GRAPH_TAB_DESC: Record<(typeof GRAPH_TABS)[number]['value'], string> = {
  git: 'GitGraph, the built-in preset: refs, search, branch filter and compare. Click a commit for its diff; Shift+click a second to compare; right-click for actions.',
  chat: 'Editing a question or regenerating an answer forks a branch; the last message combines two. The active thread stays in the left lane; ‹ n / m › switches branches.',
  ast: 'A short snippet parsed into a syntax tree. Hover or focus a node to underline its exact characters in the code; hover a word in the code to find its node, click to select it.',
  agent: 'An agent run that fans out to three tools, joins, fails a test, fixes it and carries on.',
  deps: 'Packages above the packages they use: react is shared by four, so its lane merges in from all of them.',
}

/** The Chat tab: the sample tree, or a 2k-message conversation (built once, on first use). */
function ChatBigDemo({ big }: { big: boolean }) {
  const history = useMemo(() => (big ? chatTreeHistory(2000) : undefined), [big])
  return <ChatBranchesExample key={big ? 'big' : 'sample'} messages={history} />
}

/** The Binary explorer card: the synthetic 44 KiB ELF-like sample, or 100 MiB of it repeated (built on first use). */
function BinaryExplorerDemo({ big }: { big: boolean }) {
  const file = useMemo(() => (big ? binarySampleLarge(100) : { bytes: binarySample(), sections: BINARY_SAMPLE_SECTIONS }), [big])
  return <BinaryView key={big ? 'big' : 'sample'} data={file.bytes} sections={file.sections} defaultCursor={big ? 0 : 0x4000} />
}

export function CodeSection() {
  const [mdRun, setMdRun] = useState(0)
  const [mdStill, setMdStill] = useState(false)
  const [gitBig, setGitBig] = useState(false)
  const [gitPushes, setGitPushes] = useState(0)
  const [graphTab, setGraphTab] = useState<(typeof GRAPH_TABS)[number]['value']>('git')
  const [chatBig, setChatBig] = useState(false)
  const [binBig, setBinBig] = useState(false)
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
      <Spec title="Graphs as rows" span={3}
        desc="Any graph as a list: one row per node, with its edges in a narrow lane gutter (layoutLanes + LaneGraph). The same component draws a git history, a branching chat, a syntax tree, an agent run and a dependency graph; only renderRow changes."
        keys={[[['↑', '↓'], 'Rows'], [['←', '→'], 'Parent, child'], [['↵'], 'Open'], [['⇧', 'F10'], 'Actions'], [['/'], 'Search (git)'], [['Esc'], 'Close']]}
        notes={{
          good: 'Anything shaped like history or a tree where people read the nodes: commits, chat branches, agent steps, syntax trees, dependency chains. Rows can be any height (a chat message, a card), the layout is one O(n · lanes) pass (50k nodes in about 50 ms), and only the rows on screen render, so long graphs scroll like short ones.',
          breaks: 'Graphs that are mostly cross-links (social networks, call graphs with cycles): every extra edge becomes a lane, and past a dozen lanes they fold into a "+n" gutter. Cycles are drawn as stubs rather than lines. Use a node-link diagram for those, and lanes when the order of rows means something.',
        }}
        actions={graphTab === 'git' ? <>
          <SpecAction onClick={() => setGitPushes(n => n + 1)}>Push a commit</SpecAction>
          <Switch label={<span className="text-xs text-[var(--fg2)]">50k commits</span>} checked={gitBig} onChange={v => { setGitBig(v); setGitPushes(0) }} />
        </> : graphTab === 'chat' ? <Switch label={<span className="text-xs text-[var(--fg2)]">2k messages</span>} checked={chatBig} onChange={setChatBig} /> : undefined}>
        <Tabs.Root value={graphTab} onValueChange={v => setGraphTab(v as typeof graphTab)}>
          <Tabs.List aria-label="Graph examples">{GRAPH_TABS.map(t => <Tabs.Trigger key={t.value} value={t.value}>{t.label}</Tabs.Trigger>)}</Tabs.List>
          <p className="m-0 pt-2 text-xs text-[var(--fg2)]">{GRAPH_TAB_DESC[graphTab]}</p>
          <Tabs.Content value="git"><GitGraphDemo big={gitBig} pushes={gitPushes} /></Tabs.Content>
          <Tabs.Content value="chat"><ChatBigDemo big={chatBig} /></Tabs.Content>
          <Tabs.Content value="ast"><AstGraphExample /></Tabs.Content>
          <Tabs.Content value="agent"><AgentRunExample /></Tabs.Content>
          <Tabs.Content value="deps"><DependencyGraphExample /></Tabs.Content>
        </Tabs.Root>
      </Spec>
      <Spec title="Binary explorer" span={3}
        desc="Look inside a file: a Hilbert-curve byte map, an entropy strip with section bands and high-entropy regions, and a hex editor with a data inspector, all sharing one cursor. Click a hot spot to jump the hex editor there."
        keys={[[['↑', '↓', '←', '→'], 'Move'], [['⇧', '→'], 'Select'], [['Tab'], 'Hex ↔ text'], [['0–F'], 'Overwrite'], [['Ctrl', 'G'], 'Go to'], [['Ctrl', 'F'], 'Search'], [['Ctrl', 'Z'], 'Undo']]}
        notes={{
          good: 'Triage of unknown files: packed or encrypted blobs stand out as red on the map and the strip, sections show as blocks, and the hex editor jumps to whatever you click. Only the rows on screen render and edits are a patch over the original bytes, so a 100 MB file scrolls and edits like a small one; entropy is one O(n) pass (about 0.3 s for 100 MB).',
          breaks: 'Files that don\'t fit in memory (the whole buffer is a Uint8Array) and structure-aware parsing: it shows bytes, entropy and the sections you pass, not decoded headers or disassembly. Inserting or deleting bytes isn\'t supported (overwrite only). Past ~8 M px of rows the scrollbar is scaled, so dragging it or flicking on a phone moves in coarse steps; the wheel and keys stay exact.',
        }}
        actions={<Switch label={<span className="text-xs text-[var(--fg2)]">100 MB</span>} checked={binBig} onChange={setBinBig} />}>
        <BinaryExplorerDemo big={binBig} />
      </Spec>
    </Section>
  )
}
