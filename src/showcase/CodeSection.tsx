import { CodeBlock, CodeTabs, Diff, InlineCode, InstallCommand, Kbd, Terminal } from '../lib'
import { Section, Spec } from './kit'

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

const dim = 'text-[var(--fg3)]', ok = 'text-[var(--ok)]', acc = 'text-[var(--accent)]'

export function CodeSection() {
  return (
    <Section id="code" title="Code" desc="Highlighted blocks, tabs, diffs and a terminal. Tokenised in the page, no highlighter library.">
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
    </Section>
  )
}
