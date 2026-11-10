import { memo, useCallback, useDeferredValue, useEffect, useImperativeHandle, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent as RKeyboardEvent, type ReactNode, type Ref } from 'react'
import { Avatar, Badge, Button, Chip, Icon, IconButton, Kbd, Spinner, TOUCH, cn, defineMessages, inputClass, useCoarsePointer, useControllable, useLocale, useMessages, useWidth, type IconName } from './core'
import { LANE_COLORS, LaneGraph, laneAncestry, laneColor, laneGutterWidth, laneHash, layoutLanes, type LaneEdge, type LaneGraphHandle, type LaneNode, type LaneRow, type LaneRowState } from './lanes'
// the parts, not the ContextMenu/DropdownMenu/Sheet objects: those reference every menu part, which drop-in files would carry
import { ContextMenuContent, ContextMenuRoot, ContextMenuTrigger, DialogClose, DialogRoot, DialogTitle, DropdownMenuContent, DropdownMenuRoot, DropdownMenuTrigger, MenuCheckboxItem, MenuItem, MenuLabel, MenuSeparator, SheetContent, SheetHeader } from './overlay'
import { CopyButton, useCopy } from './feedback'
import { Diff } from './code'
import { Markdown } from './markdown'

/* ════════════════════════════════════════════════════════════════════════════
 * GIT GRAPH: a commit history graph (VS Code's Git Graph, GitKraken, Sourcetree, `git log --graph`), built as a preset
 * of the lane graph in lanes.tsx: layoutLanes does the order and the lanes, LaneGraph the virtualised rows, the gutter,
 * keyboard moves along edges and hover ancestry. This file adds what is git's own:
 *
 * 1. Data. `GitCommit = { hash, parents, subject, body?, author, date, refs? }`, in any order. `parseGitLog(text)`
 *    reads the output of GIT_LOG_COMMAND (fields split by \x1f, records by \x1e), so a real repository pipes in:
 *      git log --all --date-order --pretty=format:'%H%x1f%P%x1f%an%x1f%ae%x1f%at%x1f%D%x1f%s%x1e' > log.txt
 *
 * 2. Commits as lane nodes (gitLanes): id = hash, time = date, group = the branch a commit carries (origin/x counts as
 *    x), so a branch ref starts that branch's colour; `pin` names branches (main, develop) whose first-parent lines keep
 *    the leftmost lanes, starting at the local branch (else the remote); a lane opened for a merge takes the branch
 *    named in "Merge branch 'x'". `order: 'date'` is layoutLanes' 'time' (`git log --date-order`), 'topo' its 'topo'.
 *
 * 3. The component around the rows: refs, subject, author, date and hash columns; search (message, author, hash
 *    prefix, ref), branch filter, first-parent and hide-merged views (filterGitHistory); details (side panel or a sheet
 *    on phones) with Markdown body and diffs from `loadCommit`; Shift+click compares two commits (`loadDiff`); a context
 *    menu whose actions call the host (the component never runs git); new commits on top keep the reader's place.
 * ══════════════════════════════════════════════════════════════════════════ */

/** What a ref is: a local branch, a remote-tracking branch, a tag, HEAD (`name` is the checked-out branch, or "HEAD" when detached), or the stash. */
export type GitRefType = 'branch' | 'remote' | 'tag' | 'head' | 'stash'
/** A branch, tag or other ref pointing at a commit. */
export type GitRef = { name: string; type: GitRefType }
/** One commit. `date` is epoch milliseconds or a Date; `parents` lists hashes, first parent first. */
export type GitCommit = {
  hash: string; parents: string[]; subject: string; body?: string
  author: { name: string; email?: string; avatar?: string }
  date: number | Date; refs?: GitRef[]
}
/** `straight`: stays in its lane; `merge`: to or from a merge's extra parent; `fork`: a branch lane ending in the commit it started from. */
export type GitEdgeType = 'straight' | 'merge' | 'fork'
/**
 * One stroke in a row's slice of the graph. `part`: `through` (a lane passing the row), `top` (from the row's top edge
 * into its node), `bottom` (from the node to the row's bottom edge). `child`/`parent` are the row indexes the edge joins
 * (`parent` -1: not loaded, drawn as a fading stub, `missing`); `firstParent` when that link is the child's first parent
 * (what the ancestry highlight follows). `color` indexes GIT_LANE_COLORS.
 */
export type GitGraphEdge = { fromLane: number; toLane: number; type: GitEdgeType; color: number; part: 'through' | 'top' | 'bottom'; child: number; parent: number; /** the link is the child's first parent */ firstParent: boolean; missing?: boolean }
/** One laid-out commit: its lane and colour, its parents and children as row indexes (-1 for a parent not loaded) and its edges. */
export type GitGraphRow = {
  readonly commit: GitCommit; readonly index: number; readonly lane: number; readonly color: number
  readonly parents: readonly number[]; readonly children: readonly number[]; readonly edges: GitGraphEdge[]
}
/** layoutGitGraph's result: rows in display order, the number of lanes used and the row of each hash. */
export type GitGraphLayout = { rows: GitGraphRow[]; laneCount: number; rowOf: Map<string, number> }
/**
 * layoutGitGraph options. `order`: 'date' (default) or 'topo'. `firstParentLanes` (default true): a commit waited for by
 * several lanes takes the one its child reached through a first parent. `pin`: branch names whose first-parent chains get
 * the leftmost lanes, in this order. `colorOf`: colour index for a branch key (default: pinned branches take the first
 * colours in pin order and the others hash into the rest; with nothing pinned, gitLaneColor).
 */
export type GitLayoutOptions = { order?: 'date' | 'topo'; firstParentLanes?: boolean; pin?: readonly string[]; colorOf?: (key: string) => number }

/** Lane colours, theme tokens only (light and dark): main gets the strongest, the rest are spread by hashing branch names. */
export const GIT_LANE_COLORS = LANE_COLORS

/** The command whose output parseGitLog reads (add `--decorate=full` for unambiguous ref names, `-n 50000` to cap it). */
export const GIT_LOG_COMMAND = "git log --all --date-order --pretty=format:'%H%x1f%P%x1f%an%x1f%ae%x1f%at%x1f%D%x1f%s%x1e'"

/** "a1b2c3d" from a full hash. */
export const gitShortHash = (hash: string) => hash.slice(0, 7)
const gitTime = (d: number | Date) => (typeof d === 'number' ? d : d.getTime())
const GIT_MAIN = /^(main|master|trunk)$/

/** Default lane colour for a branch key: main/master/trunk get colour 0, anything else a stable hash over the others. */
export const gitLaneColor = (key: string) => (GIT_MAIN.test(key) ? 0 : 1 + (laneHash(key) % (GIT_LANE_COLORS.length - 1)))

/** A ref's branch name for matching and colours: remote "origin/x" → "x", HEAD → its branch; null for tags, the stash and a detached HEAD. */
function gitRefBranch(r: GitRef): string | null {
  if (r.type === 'branch') return r.name
  if (r.type === 'head') return r.name === 'HEAD' ? null : r.name
  if (r.type === 'remote') { const i = r.name.indexOf('/'); return i < 0 ? r.name : r.name.slice(i + 1) }
  return null
}
/** The branch a tip commit carries, for its lane colour: a local branch, else a remote one. */
function gitTipKey(c: GitCommit): string | null {
  let remote: string | null = null
  if (!c.refs) return null
  for (const r of c.refs) {
    if (r.type === 'branch' || (r.type === 'head' && r.name !== 'HEAD')) return r.name
    if (r.type === 'remote' && !remote) remote = gitRefBranch(r)
  }
  return remote
}
/** Branch names quoted in a merge subject ("Merge branch 'a'", "Merge branches 'a', 'b' and 'c'", "Merge pull request #12 from org/a"). */
function gitMergeNames(subject: string): string[] {
  if (!/^Merge\b/.test(subject)) return []
  const pr = /^Merge pull request #\d+ from [^/\s]+\/(\S+)/.exec(subject)
  if (pr) return [pr[1]]
  return [...subject.matchAll(/'([^']+)'/g)].map(m => m[1].replace(/^origin\//, ''))
}

/* ── commits as lane nodes ─────────────────────────────────────────────────── */

/** A commit as a lane node (what the GitGraph's LaneGraph rows carry). */
type GitLaneNode = LaneNode & { commit: GitCommit }

/** Where a pinned branch's line starts: the newest commit carrying it as a local branch (or HEAD), else as a remote one. */
function gitPinStart(name: string, commits: readonly GitLaneNode[]): string | undefined {
  let remote: string | undefined
  for (const { commit } of commits) if (commit.refs) for (const ref of commit.refs) {
    if ((ref.type === 'branch' || ref.type === 'head') && ref.name === name) return commit.hash
    if (remote === undefined && ref.type === 'remote' && gitRefBranch(ref) === name) remote = commit.hash
  }
  return remote
}
/** A lane opened for a merge's extra parent is named after the branch in the merge subject. */
const gitMergeLane = (child: GitLaneNode, parentIndex: number) => gitMergeNames(child.commit.subject)[parentIndex - 1]
/** Pinned branches take the first colours, the rest hash into the others; with nothing pinned, main is colour 0 (gitLaneColor). */
const gitColor = (key: string, pinned: readonly string[]) => (pinned.length ? laneColor(key, pinned, GIT_LANE_COLORS.length) : gitLaneColor(key))

/** layoutGitGraph's edge from a lane edge. */
function gitEdge(e: LaneEdge): GitGraphEdge {
  const part = e.half === 'full' ? 'through' : e.half
  const type: GitEdgeType = e.kind === 'pass' ? 'straight' : e.kind === 'missing' ? (e.firstParent ? 'straight' : 'merge') : e.kind
  const edge: GitGraphEdge = { fromLane: e.fromLane, toLane: e.toLane, type, part, color: e.color, child: e.child, parent: e.parent, firstParent: e.firstParent }
  if (e.kind === 'missing') edge.missing = true
  return edge
}

/** A GitGraphRow over a lane row; its edges and children are read only when asked for (rows off screen never are). */
class GitRow implements GitGraphRow {
  readonly commit: GitCommit; readonly index: number; readonly lane: number; readonly color: number
  readonly parents: readonly number[]
  readonly #row: LaneRow<GitLaneNode>
  constructor(r: LaneRow<GitLaneNode>) {
    this.commit = r.node.commit; this.index = r.index; this.lane = r.lane; this.color = r.color; this.parents = r.parents; this.#row = r
  }
  get edges(): GitGraphEdge[] { return this.#row.edges.map(gitEdge) }
  get children(): readonly number[] { return this.#row.children }
}

/** Both views of a history: the lane layout GitGraph draws, and the GitGraphLayout the exported helpers take. */
function gitLanes(commits: readonly GitCommit[], { order = 'date', firstParentLanes = true, pin = [], colorOf }: GitLayoutOptions = {}) {
  const nodes: GitLaneNode[] = commits.map(c => ({ id: c.hash, parents: c.parents, time: gitTime(c.date), group: gitTipKey(c) ?? undefined, commit: c }))
  const lanes = layoutLanes(nodes, {
    order: order === 'topo' ? 'topo' : 'time', pin, pinStart: gitPinStart, palette: GIT_LANE_COLORS,
    color: colorOf ? key => colorOf(key) : gitColor, laneGroup: gitMergeLane, firstParentLanes,
  })
  const rows: GitGraphRow[] = lanes.rows.map(r => new GitRow(r))
  // the same id → row map layoutLanes keeps (GitGraphLayout's type says Map; nobody writes to it)
  return { lanes, git: { rows, laneCount: lanes.laneCount, rowOf: lanes.index as Map<string, number> } satisfies GitGraphLayout }
}

/**
 * Lay out a commit graph: rows in topological order (children first; `order` 'date' or 'topo'), a lane per commit and
 * each row's edges (layoutLanes does the work; see lanes.tsx). Pure and O(n · lanes); input order doesn't matter.
 *   const { rows, laneCount } = layoutGitGraph(commits, { pin: ['main'] })
 */
export function layoutGitGraph(commits: readonly GitCommit[], options: GitLayoutOptions = {}): GitGraphLayout {
  return gitLanes(commits, options).git
}

/* ── filters, ranges, paths ────────────────────────────────────────────────── */

/**
 * Which commits a view shows. `branches`: only what those refs reach (branch, remote or tag names). `firstParent`: follow
 * first parents only, like `git log --first-parent` (merges lose their other parents). `hideMerged`: drop branches already
 * merged (tips with a child) and the commits only a merge reaches; those merges keep a stub where the branch came in.
 */
export type GitHistoryFilter = { branches?: readonly string[]; firstParent?: boolean; hideMerged?: boolean }

/** The commits a GitHistoryFilter keeps (parents rewritten for first-parent views). Returns `commits` itself when nothing filters. */
export function filterGitHistory(commits: readonly GitCommit[], { branches, firstParent, hideMerged }: GitHistoryFilter): readonly GitCommit[] {
  const pick = branches?.length ? new Set(branches) : null
  if (!pick && !firstParent && !hideMerged) return commits
  const by = new Map<string, GitCommit>()
  for (const c of commits) if (!by.has(c.hash)) by.set(c.hash, c)
  const hasChild = new Set<string>()
  for (const c of by.values()) for (const p of c.parents) hasChild.add(p)
  const tips: GitCommit[] = []
  for (const c of by.values()) {
    const refs = c.refs ?? []
    if (pick) { if (refs.some(r => pick.has(r.name) || pick.has(gitRefBranch(r) ?? '\0'))) tips.push(c) }
    else if (hideMerged) { if (!hasChild.has(c.hash)) tips.push(c) }
    else if (!hasChild.has(c.hash) || refs.some(r => r.type !== 'tag')) tips.push(c)
  }
  const keep = new Set<string>(), linear = firstParent || hideMerged
  const stack = tips.map(c => c.hash)
  while (stack.length) {
    const h = stack.pop()!
    if (keep.has(h)) continue
    const c = by.get(h); if (!c) continue
    keep.add(h)
    if (linear) { if (c.parents[0]) stack.push(c.parents[0]) } else for (const p of c.parents) stack.push(p)
  }
  const outList: GitCommit[] = []
  for (const c of by.values()) {
    if (!keep.has(c.hash)) continue
    outList.push(firstParent && c.parents.length > 1 ? { ...c, parents: c.parents.slice(0, 1) } : c)
  }
  return outList
}

/** Rows in the range `a..b` (commits reachable from the newer one but not from the older one; git's two-dot range), as marks and a count. */
export function gitRange(layout: GitGraphLayout, a: number, b: number): { marks: Uint8Array; count: number } {
  const n = layout.rows.length, older = Math.max(a, b), newer = Math.min(a, b), no = new Uint8Array(n), marks = new Uint8Array(n)
  const walk = (start: number, into: Uint8Array, stop?: Uint8Array) => {
    const st = [start]
    while (st.length) {
      const r = st.pop()!
      if (r < 0 || into[r] || stop?.[r]) continue
      into[r] = 1
      for (const p of layout.rows[r].parents) if (p >= 0) st.push(p)
    }
  }
  if (n === 0 || older >= n || newer < 0) return { marks, count: 0 }
  walk(older, no); walk(newer, marks, no)
  let count = 0; for (let i = 0; i < n; i++) count += marks[i]
  return { marks, count }
}

/** The first-parent ancestry of row `r` (itself, its first parent, its first parent's first parent…), as marks. */
export const gitFirstParentPath = (layout: GitGraphLayout, r: number): Uint8Array => laneAncestry(layout, r)

/* ── parser ────────────────────────────────────────────────────────────────── */

/** One ref from `%D` ("HEAD -> main", "origin/main", "tag: v1.2.0", "refs/stash", or the full forms with --decorate=full). */
function gitParseRef(raw: string, remotes: readonly string[]): GitRef[] {
  const s = raw.trim()
  if (!s) return []
  if (s.startsWith('HEAD -> ')) return [{ name: s.slice(8).replace(/^refs\/heads\//, ''), type: 'head' }]
  if (s === 'HEAD') return [{ name: 'HEAD', type: 'head' }]
  if (s.startsWith('tag: ')) return [{ name: s.slice(5).replace(/^refs\/tags\//, ''), type: 'tag' }]
  if (s === 'refs/stash' || s === 'stash') return [{ name: 'stash', type: 'stash' }]
  if (s.startsWith('refs/heads/')) return [{ name: s.slice(11), type: 'branch' }]
  if (s.startsWith('refs/remotes/')) { const name = s.slice(13); return name.endsWith('/HEAD') ? [] : [{ name, type: 'remote' }] }
  if (s.startsWith('refs/tags/')) return [{ name: s.slice(10), type: 'tag' }]
  const slash = s.indexOf('/')
  if (slash > 0 && remotes.includes(s.slice(0, slash))) return s.endsWith('/HEAD') ? [] : [{ name: s, type: 'remote' }]
  return [{ name: s, type: 'branch' }]
}

/**
 * Parse the output of GIT_LOG_COMMAND: `%H%x1f%P%x1f%an%x1f%ae%x1f%at%x1f%D%x1f%s%x1e` per commit (an eighth field, `%b`,
 * is read as the body when present). Remote-tracking refs are told from local branches by `remotes` (default origin and
 * upstream) unless the log was made with `--decorate=full`. Malformed records are skipped.
 */
export function parseGitLog(text: string, { remotes = ['origin', 'upstream'] }: { remotes?: readonly string[] } = {}): GitCommit[] {
  const out: GitCommit[] = []
  for (const rec of text.split('\x1e')) {
    const f = rec.replace(/^[\r\n]+/, '').split('\x1f')
    if (f.length < 7 || !/^[0-9a-f]{4,64}$/i.test(f[0].trim())) continue
    const [hash, parents, name, email, at, deco, subject, body] = f
    const refs = deco.split(',').flatMap(r => gitParseRef(r, remotes))
    const c: GitCommit = { hash: hash.trim(), parents: parents.trim() ? parents.trim().split(/\s+/) : [], subject: subject.replace(/\r$/, ''), author: { name, ...(email ? { email } : null) }, date: Number(at) * 1000 }
    if (refs.length) c.refs = refs
    if (body?.trim()) c.body = body.trim()
    out.push(c)
  }
  return out
}

/* ── strings ───────────────────────────────────────────────────────────────── */

/** GitGraph's UI strings (de/ar machine-drafted). */
export const GIT_GRAPH_MESSAGES = defineMessages('git', {
  en: {
    label: 'Commit history', search: 'Search commits', searchPlaceholder: 'Message, author, hash', matches: '{n} of {total}', noMatches: 'No matches',
    prevMatch: 'Previous match', nextMatch: 'Next match', branches: 'Branches', allBranches: 'All branches', branchesCount: '{count, plural, one {# branch} other {# branches}}',
    firstParent: 'First parent only', hideMerged: 'Hide merged', jumpHead: 'Jump to HEAD', goTo: 'Go to {name}', removeFilter: 'Remove {name} from the filter',
    moreLanes: '{n, plural, one {+# lane} other {+# lanes}}', fewerLanes: 'Fold lanes', graph: 'Graph', description: 'Description', author: 'Author', date: 'Date', commit: 'Commit',
    row: 'Commit {hash}: {subject}, by {author}, {when}', menu: 'Commit actions', checkout: 'Checkout', checkoutBranch: 'Checkout {branch}',
    createBranch: 'Create branch here…', cherryPick: 'Cherry-pick', revert: 'Revert', copyHash: 'Copy hash', compareWith: 'Compare with {hash}',
    comparing: 'Comparing {from}…{to}', commits: '{count, plural, one {# commit} other {# commits}}', exitCompare: 'Exit compare',
    details: 'Commit {hash}', closeDetails: 'Close details', parents: 'Parents', children: 'Children', merge: 'Merge', files: 'Files changed',
    filesCount: '{count, plural, one {# file} other {# files}}', loading: 'Loading changes…', loadFailed: 'Couldn’t load the changes', retry: 'Retry',
    noFiles: 'No file changes', added: 'Added', modified: 'Modified', deleted: 'Deleted', renamed: 'Renamed', notLoaded: 'Not loaded (shallow history)',
    newCommits: '{count, plural, one {# new commit} other {# new commits}}', compareHint: 'Shift+click another commit to compare', empty: 'No commits',
    inRange: 'In range', selectFile: 'Show the diff of {path}', range: 'Range',
  },
  de: {
    label: 'Commit-Verlauf', search: 'Commits durchsuchen', searchPlaceholder: 'Nachricht, Autor, Hash', matches: '{n} von {total}', noMatches: 'Keine Treffer',
    prevMatch: 'Vorheriger Treffer', nextMatch: 'Nächster Treffer', branches: 'Branches', allBranches: 'Alle Branches', branchesCount: '{count, plural, one {# Branch} other {# Branches}}',
    firstParent: 'Nur erste Eltern', hideMerged: 'Gemergte ausblenden', jumpHead: 'Zu HEAD springen', goTo: 'Zu {name}', removeFilter: '{name} aus dem Filter entfernen',
    moreLanes: '{n, plural, one {+# Spur} other {+# Spuren}}', fewerLanes: 'Spuren einklappen', graph: 'Graph', description: 'Beschreibung', author: 'Autor', date: 'Datum', commit: 'Commit',
    row: 'Commit {hash}: {subject}, von {author}, {when}', menu: 'Commit-Aktionen', checkout: 'Auschecken', checkoutBranch: '{branch} auschecken',
    createBranch: 'Branch hier erstellen…', cherryPick: 'Cherry-pick', revert: 'Rückgängig machen', copyHash: 'Hash kopieren', compareWith: 'Mit {hash} vergleichen',
    comparing: 'Vergleich {from}…{to}', commits: '{count, plural, one {# Commit} other {# Commits}}', exitCompare: 'Vergleich beenden',
    details: 'Commit {hash}', closeDetails: 'Details schließen', parents: 'Eltern', children: 'Kinder', merge: 'Merge', files: 'Geänderte Dateien',
    filesCount: '{count, plural, one {# Datei} other {# Dateien}}', loading: 'Änderungen werden geladen…', loadFailed: 'Änderungen konnten nicht geladen werden', retry: 'Erneut versuchen',
    noFiles: 'Keine Dateiänderungen', added: 'Hinzugefügt', modified: 'Geändert', deleted: 'Gelöscht', renamed: 'Umbenannt', notLoaded: 'Nicht geladen (flacher Verlauf)',
    newCommits: '{count, plural, one {# neuer Commit} other {# neue Commits}}', compareHint: 'Umschalt+Klick auf einen anderen Commit zum Vergleichen', empty: 'Keine Commits',
    inRange: 'Im Bereich', selectFile: 'Diff von {path} anzeigen', range: 'Bereich',
  },
  ar: {
    label: 'سجل الإيداعات', search: 'البحث في الإيداعات', searchPlaceholder: 'الرسالة، المؤلف، المعرّف', matches: '{n} من {total}', noMatches: 'لا نتائج',
    prevMatch: 'النتيجة السابقة', nextMatch: 'النتيجة التالية', branches: 'الفروع', allBranches: 'كل الفروع', branchesCount: '{count, plural, zero {لا فروع} one {فرع واحد} two {فرعان} few {# فروع} many {# فرعًا} other {# فرع}}',
    firstParent: 'الأصل الأول فقط', hideMerged: 'إخفاء المدموجة', jumpHead: 'الانتقال إلى HEAD', goTo: 'الانتقال إلى {name}', removeFilter: 'إزالة {name} من التصفية',
    moreLanes: '{n, plural, one {+# مسار} two {+# مساران} few {+# مسارات} other {+# مسارًا}}', fewerLanes: 'طي المسارات', graph: 'المخطط', description: 'الوصف', author: 'المؤلف', date: 'التاريخ', commit: 'الإيداع',
    row: 'الإيداع {hash}: {subject}، بواسطة {author}، {when}', menu: 'إجراءات الإيداع', checkout: 'التبديل', checkoutBranch: 'التبديل إلى {branch}',
    createBranch: 'إنشاء فرع هنا…', cherryPick: 'انتقاء', revert: 'تراجع', copyHash: 'نسخ المعرّف', compareWith: 'مقارنة مع {hash}',
    comparing: 'مقارنة {from}…{to}', commits: '{count, plural, zero {لا إيداعات} one {إيداع واحد} two {إيداعان} few {# إيداعات} many {# إيداعًا} other {# إيداع}}', exitCompare: 'إنهاء المقارنة',
    details: 'الإيداع {hash}', closeDetails: 'إغلاق التفاصيل', parents: 'الأصول', children: 'الفروع اللاحقة', merge: 'دمج', files: 'الملفات المعدّلة',
    filesCount: '{count, plural, zero {لا ملفات} one {ملف واحد} two {ملفان} few {# ملفات} many {# ملفًا} other {# ملف}}', loading: 'جارٍ تحميل التغييرات…', loadFailed: 'تعذّر تحميل التغييرات', retry: 'إعادة المحاولة',
    noFiles: 'لا تغييرات في الملفات', added: 'مضاف', modified: 'معدّل', deleted: 'محذوف', renamed: 'معاد تسميته', notLoaded: 'غير محمّل (سجل سطحي)',
    newCommits: '{count, plural, zero {لا إيداعات جديدة} one {إيداع جديد} two {إيداعان جديدان} few {# إيداعات جديدة} many {# إيداعًا جديدًا} other {# إيداع جديد}}', compareHint: 'Shift+نقرة على إيداع آخر للمقارنة', empty: 'لا إيداعات',
    inRange: 'ضمن النطاق', selectFile: 'عرض فروقات {path}', range: 'النطاق',
  },
})
type GitT = (key: keyof typeof GIT_GRAPH_MESSAGES.en, vars?: Record<string, string | number>) => string

/* ── drawing ───────────────────────────────────────────────────────────────── */

const gitStroke = (color: number) => GIT_LANE_COLORS[color % GIT_LANE_COLORS.length]

/* ── refs ──────────────────────────────────────────────────────────────────── */

const GIT_REF_ICON: Record<GitRefType, IconName> = { branch: 'branch', remote: 'cloud', tag: 'bookmark', head: 'branch', stash: 'layers' }
const GIT_REF_CLASS: Record<GitRefType, string> = {
  branch: 'border border-[color-mix(in_srgb,var(--lane)_45%,transparent)] !bg-[color-mix(in_srgb,var(--lane)_12%,var(--card))] !text-[var(--fg)]',
  head: 'border border-[var(--accent)] font-semibold',
  remote: 'border border-[var(--line)]',
  tag: 'border border-[var(--line2)] !bg-[var(--card)]',
  stash: 'border border-dashed border-[var(--line2)]',
}
type GitChip = { ref: GitRef; alsoRemote?: string }
/** Refs as chips: HEAD first, then branches, tags, remotes; a remote at the same commit as its local branch folds into it. */
function gitChips(refs: readonly GitRef[] | undefined): GitChip[] {
  if (!refs?.length) return []
  const order: Record<GitRefType, number> = { head: 0, branch: 1, tag: 2, remote: 3, stash: 4 }
  const local = new Set(refs.filter(r => r.type === 'branch' || r.type === 'head').map(r => r.name))
  const chips: GitChip[] = []
  for (const r of [...refs].sort((a, b) => order[a.type] - order[b.type])) {
    if (r.type === 'remote') { const b = gitRefBranch(r); const host = b && local.has(b) ? chips.find(c => c.ref.name === b) : null; if (host) { host.alsoRemote = r.name; continue } }
    chips.push({ ref: r })
  }
  return chips
}
function GitRefChip({ chip, color }: { chip: GitChip; color: number }) {
  const { ref } = chip
  const tone = ref.type === 'head' ? 'accent' : 'neutral'
  const body = (
    <Badge size="sm" tone={tone} className={cn('max-w-[16ch] gap-1', GIT_REF_CLASS[ref.type])}>
      {ref.type === 'head' && <span className="text-[10px] tracking-wide">HEAD</span>}
      {!(ref.type === 'head' && ref.name === 'HEAD') && <><Icon name={GIT_REF_ICON[ref.type]} size={11} className="flex-none" /><span dir="ltr" className="truncate">{ref.name}</span></>}
      {chip.alsoRemote && <Icon name="cloud" size={11} className="flex-none opacity-70" />}
    </Badge>
  )
  return (
    <span className="inline-flex min-w-0 flex-none" style={{ '--lane': gitStroke(color) } as CSSProperties} title={chip.alsoRemote ? `${ref.name} · ${chip.alsoRemote}` : ref.name}>{body}</span>
  )
}

/* ── row ───────────────────────────────────────────────────────────────────── */

/** Wraps the first case-insensitive match of `q` in a <mark>. */
function gitMark(text: string, q: string): ReactNode {
  if (!q) return text
  const i = text.toLowerCase().indexOf(q)
  if (i < 0) return text
  return <>{text.slice(0, i)}<mark className="rounded-[var(--r-sm)] bg-[var(--warn-soft)] text-[var(--fg)]">{text.slice(i, i + q.length)}</mark>{text.slice(i + q.length)}</>
}

type GitRowCellsProps = {
  row: GitGraphRow; narrow: boolean; showAuthor: boolean; match: boolean; query: string; when: string; absolute: string
  onCopy: (i: number) => void; copied: boolean; copyLabel: string
}

/** A commit's cells beside its gutter (LaneGraph draws the row, the gutter and the selection): refs, subject, author, date, hash. */
function GitRowCells({ row, narrow, showAuthor, match, query, when, absolute, onCopy, copied, copyLabel }: GitRowCellsProps) {
  const c = row.commit, chips = gitChips(c.refs), short = gitShortHash(c.hash), shown = chips.slice(0, narrow ? 2 : 3)
  const refs = shown.length > 0 && (
    <span className="flex min-w-0 flex-none items-center gap-1">
      {shown.map(ch => <GitRefChip key={ch.ref.type + ch.ref.name} chip={ch} color={row.color} />)}
      {chips.length > shown.length && <Badge size="sm">+{chips.length - shown.length}</Badge>}
    </span>
  )
  const subject = <span dir="auto" className={cn('min-w-0 truncate', row.parents.length > 1 ? 'text-[var(--fg2)]' : 'text-[var(--fg)]')}>{gitMark(c.subject, query)}</span>
  const time = <time dateTime={new Date(gitTime(c.date)).toISOString()} title={absolute} className="truncate">{when}</time>
  const marker = match && <span aria-hidden className="pointer-events-none absolute inset-y-1 start-0 w-[3px] rounded-full bg-[var(--warn)]" />
  if (narrow) return (
    <>
      {marker}
      <div role="gridcell" className="flex min-w-0 flex-col justify-center gap-0.5 pe-3">
        <span className="flex min-w-0 items-center gap-1.5">{refs}{subject}</span>
        <span className="flex min-w-0 items-center gap-1.5 text-[11px] text-[var(--fg3)] group-aria-selected:text-[var(--fg2)] group-data-[range]:text-[var(--fg2)]">
          <Avatar name={c.author.name} src={c.author.avatar} size={16} className="!border-0" />
          <span className="min-w-0 truncate">{c.author.name}</span><span aria-hidden>·</span>{time}<span aria-hidden>·</span>
          <span dir="ltr" className="font-[family-name:var(--mono)]">{gitMark(short, /^[0-9a-f]+$/.test(query) ? query : '')}</span>
        </span>
      </div>
    </>
  )
  return (
    <>
      {marker}
      <div role="gridcell" className="flex min-w-0 items-center gap-1.5 pe-3">{refs}{subject}</div>
      {showAuthor && (
        <div role="gridcell" className="flex min-w-0 items-center gap-1.5 pe-2 text-xs text-[var(--fg2)]">
          <Avatar name={c.author.name} src={c.author.avatar} size={20} className="!border-0" /><span className="min-w-0 truncate">{gitMark(c.author.name, query)}</span>
        </div>
      )}
      <div role="gridcell" className="min-w-0 pe-2 text-xs text-[var(--fg3)] group-aria-selected:text-[var(--fg2)] group-data-[range]:text-[var(--fg2)]">{time}</div>
      <div role="gridcell" className="flex min-w-0 justify-end pe-1.5">
        {/* a light copy button rather than CopyButton: rows mount on every scroll step, and the list's one live region
            announces the copy (see onCopy in GitGraph) */}
        <button type="button" tabIndex={-1} title={copyLabel} onClick={e => { e.stopPropagation(); onCopy(row.index) }}
          className="inline-flex h-6 cursor-pointer items-center gap-1 rounded-[var(--r-md)] border-0 bg-transparent px-1.5 font-[family-name:var(--mono)] text-[11px] text-[var(--fg2)] hover:bg-[var(--muted)] hover:text-[var(--fg)] [@media(pointer:coarse)]:h-8">
          <Icon name={copied ? 'check' : 'copy'} size={12} className={copied ? 'text-[var(--ok)]' : 'text-[var(--fg3)]'} />{short}
        </button>
      </div>
    </>
  )
}

/* ── details ───────────────────────────────────────────────────────────────── */

/** A changed file: `before`/`after` are its text (omit for binary or unloaded files); `oldPath` for renames. */
export type GitFileChange = { path: string; status: 'added' | 'modified' | 'deleted' | 'renamed'; oldPath?: string; before?: string; after?: string }
/** What `loadCommit(hash)` and `loadDiff(from, to)` resolve to. */
export type GitChanges = { files: GitFileChange[] }
const GIT_STATUS: Record<GitFileChange['status'], { letter: string; tone: 'ok' | 'accent' | 'bad' | 'warn' }> = {
  added: { letter: 'A', tone: 'ok' }, modified: { letter: 'M', tone: 'accent' }, deleted: { letter: 'D', tone: 'bad' }, renamed: { letter: 'R', tone: 'warn' },
}

/** Loads `load()` whenever `key` changes; stale answers are dropped. */
function useGitLoad(key: string | null, load: (() => Promise<GitChanges>) | null) {
  const [state, setState] = useState<{ key: string; files?: GitFileChange[]; error?: boolean } | null>(null)
  const [nonce, setNonce] = useState(0)
  const fn = useRef(load); fn.current = load
  useEffect(() => {
    if (!key || !fn.current) { setState(null); return }
    let alive = true
    setState({ key })
    fn.current().then(r => { if (alive) setState({ key, files: r.files }) }, () => { if (alive) setState({ key, error: true }) })
    return () => { alive = false }
  }, [key, nonce])
  return { state: state?.key === key ? state : key ? { key } : null, retry: () => setNonce(x => x + 1) }
}

function GitFiles({ loadKey, load, t }: { loadKey: string; load: (() => Promise<GitChanges>) | null; t: GitT }) {
  const { state, retry } = useGitLoad(load ? loadKey : null, load)
  const [pick, setPick] = useState(0)
  useEffect(() => setPick(0), [loadKey])
  if (!load || !state) return null
  if (state.error) return (
    <div role="alert" className="flex items-center gap-2 text-[13px] text-[var(--bad)]"><Icon name="alertCircle" size={14} />{t('loadFailed')}<Button size="xs" onClick={retry}>{t('retry')}</Button></div>
  )
  if (!state.files) return <div className="flex items-center gap-2 text-[13px] text-[var(--fg2)]"><Spinner size={13} />{t('loading')}</div>
  const files = state.files, f = files[Math.min(pick, files.length - 1)]
  if (!files.length) return <p className="m-0 text-[13px] text-[var(--fg3)]">{t('noFiles')}</p>
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <ul className="m-0 flex list-none flex-col p-0">
        {files.map((file, i) => {
          const s = GIT_STATUS[file.status]
          return (
            <li key={file.path}>
              <button type="button" aria-pressed={i === pick} title={t('selectFile', { path: file.path })} onClick={() => setPick(i)}
                className={cn('flex h-8 w-full cursor-pointer items-center gap-2 rounded-[var(--r-md)] border-0 bg-transparent px-2 text-start text-xs', TOUCH.row, i === pick ? 'bg-[var(--muted)] text-[var(--fg)]' : 'text-[var(--fg2)] hover:bg-[var(--muted)]')}>
                <Badge size="sm" tone={s.tone} className="w-[18px] justify-center !px-0 font-[family-name:var(--mono)]"><span aria-hidden title={t(file.status)}>{s.letter}</span><span className="sr-only">{t(file.status)} </span></Badge>
                <span dir="ltr" className="min-w-0 truncate font-[family-name:var(--mono)]">{file.oldPath ? `${file.oldPath} → ${file.path}` : file.path}</span>
              </button>
            </li>
          )
        })}
      </ul>
      {f && (f.before !== undefined || f.after !== undefined) && <Diff key={f.path + loadKey} before={f.before ?? ''} after={f.after ?? ''} filename={f.path} />}
    </div>
  )
}

function GitSection({ title, children }: { title: string; children: ReactNode }) {
  return <section className="flex min-w-0 flex-col gap-1.5"><h3 className="m-0 text-[11px] font-semibold tracking-wide text-[var(--fg3)] uppercase">{title}</h3>{children}</section>
}

function GitCommitLink({ row, onJump, t }: { row: GitGraphRow | null; onJump: (i: number) => void; t: GitT }) {
  if (!row) return <span className="text-xs text-[var(--fg3)]">{t('notLoaded')}</span>
  return (
    <button type="button" onClick={() => onJump(row.index)} className={cn('flex h-8 min-w-0 cursor-pointer items-center gap-2 rounded-[var(--r-md)] border-0 bg-transparent px-2 text-start text-xs text-[var(--fg2)] hover:bg-[var(--muted)]', TOUCH.row)}>
      <span dir="ltr" className="flex-none font-[family-name:var(--mono)] text-[var(--accent)]">{gitShortHash(row.commit.hash)}</span>{' '}
      <span dir="auto" className="min-w-0 truncate">{row.commit.subject}</span>
    </button>
  )
}

type GitDetailsProps = {
  layout: GitGraphLayout; row: GitGraphRow | null; compare: { older: number; newer: number; count: number } | null
  loadCommit?: (hash: string) => Promise<GitChanges>; loadDiff?: (from: string, to: string) => Promise<GitChanges>
  onJump: (i: number) => void; t: GitT; now: number
}

const GitDetails = memo(function GitDetails({ layout, row, compare, loadCommit, loadDiff, onJump, t, now }: GitDetailsProps) {
  const { fmt } = useLocale()
  if (compare) {
    const a = layout.rows[compare.older].commit, b = layout.rows[compare.newer].commit
    return (
      <div className="flex min-w-0 flex-col gap-4">
        <p className="m-0 text-[13px] text-[var(--fg2)]">{t('commits', { count: compare.count })}</p>
        <GitSection title={t('range')}>
          <GitCommitLink row={layout.rows[compare.newer]} onJump={onJump} t={t} />
          <GitCommitLink row={layout.rows[compare.older]} onJump={onJump} t={t} />
        </GitSection>
        <GitSection title={t('files')}>
          <GitFiles loadKey={`${a.hash}..${b.hash}`} load={loadDiff ? () => loadDiff(a.hash, b.hash) : null} t={t} />
        </GitSection>
      </div>
    )
  }
  if (!row) return null
  const c = row.commit, chips = gitChips(c.refs)
  return (
    <div className="flex min-w-0 flex-col gap-4">
      <div className="flex min-w-0 flex-col gap-2">
        <p dir="auto" className="m-0 text-base font-semibold break-words text-[var(--fg)]">{c.subject}</p>
        {chips.length > 0 && <div className="flex flex-wrap gap-1">{chips.map(ch => <GitRefChip key={ch.ref.type + ch.ref.name} chip={ch} color={row.color} />)}</div>}
        <div className="flex min-w-0 items-center gap-2 text-xs text-[var(--fg2)]">
          <Avatar name={c.author.name} src={c.author.avatar} size={28} className="!border-0" />
          <span className="flex min-w-0 flex-col">
            <span className="truncate text-[13px] font-medium text-[var(--fg)]">{c.author.name}{c.author.email && <span className="ms-1.5 font-normal text-[var(--fg3)]">{c.author.email}</span>}</span>
            <span>{fmt.dateTime(gitTime(c.date))} · {fmt.relative(gitTime(c.date), now)}</span>
          </span>
        </div>
        <div className="flex min-w-0 items-center gap-1.5">
          <code dir="ltr" className="min-w-0 truncate font-[family-name:var(--mono)] text-[11px] text-[var(--fg3)]">{c.hash}</code>
          <CopyButton text={c.hash} size="icon-xs" label={t('copyHash')} />
        </div>
      </div>
      {c.body && <div className="min-w-0 text-[13px]"><Markdown>{c.body}</Markdown></div>}
      {row.parents.length > 0 && (
        <GitSection title={row.parents.length > 1 ? `${t('parents')} · ${t('merge')}` : t('parents')}>
          {row.parents.map((p, i) => <GitCommitLink key={i} row={p >= 0 ? layout.rows[p] : null} onJump={onJump} t={t} />)}
        </GitSection>
      )}
      {row.children.length > 0 && (
        <GitSection title={t('children')}>{row.children.slice(0, 6).map(k => <GitCommitLink key={k} row={layout.rows[k]} onJump={onJump} t={t} />)}</GitSection>
      )}
      {loadCommit && <GitSection title={t('files')}><GitFiles loadKey={c.hash} load={() => loadCommit(c.hash)} t={t} /></GitSection>}
    </div>
  )
})

/* ── component ─────────────────────────────────────────────────────────────── */

/** GitGraph's imperative handle (pass `ref`). */
export type GitGraphHandle = { scrollToCommit: (hash: string, align?: 'auto' | 'center' | 'start') => void; select: (hash: string | null) => void; focus: () => void }

/** GitGraph props. Every git action is a callback: the component never runs git, and an action without one is disabled. */
export type GitGraphProps = {
  commits: readonly GitCommit[]
  /** 'date' (default) or 'topo' */ order?: 'date' | 'topo'
  /** branches whose first-parent chains keep the leftmost lanes (default: main, master or trunk, whichever exists) */ pin?: readonly string[]
  selected?: string | null; defaultSelected?: string | null; onSelectedChange?: (hash: string | null) => void
  /** files and diffs for the details panel */ loadCommit?: (hash: string) => Promise<GitChanges>
  /** files and diffs between two commits (compare mode) */ loadDiff?: (from: string, to: string) => Promise<GitChanges>
  onCheckout?: (hash: string, branch?: string) => void; onCreateBranch?: (hash: string) => void; onCherryPick?: (hash: string) => void
  onRevert?: (hash: string) => void; onCopyHash?: (hash: string) => void; onCompare?: (from: string, to: string) => void
  /** branch filter: controlled (`branches` + `onBranchesChange`) or `defaultBranches` */ branches?: readonly string[]; defaultBranches?: readonly string[]; onBranchesChange?: (branches: string[]) => void
  defaultFirstParent?: boolean; defaultHideMerged?: boolean
  /** list height (px or CSS length, default 480) */ height?: number | string
  /** lanes drawn before the rest fold into a "+n" gutter (default 12, 6 when narrow) */ maxLanes?: number
  /** the time relative dates count from (default: when mounted) */ now?: number
  /** hide the search and filter bar */ toolbar?: boolean
  className?: string; 'aria-label'?: string; ref?: Ref<GitGraphHandle>
}

const GIT_HEADER_H = 32
const gitEditable = (t: EventTarget | null) => t instanceof Element && !!t.closest('input,textarea,select,[contenteditable="true"]')

/**
 * Commit history graph (like VS Code's Git Graph or GitKraken): a LaneGraph preset with refs, author, relative date and
 * hash columns, virtualised for 100k commits. Click or Enter opens details (a side panel, a sheet on phones: message,
 * parents, refs, files and diffs from `loadCommit`); Shift+click a second commit compares the range (`loadDiff`). Hover
 * or focus lights the first-parent ancestry. Keys: ↑/↓ rows, ← parent, → child, Home/End, PageUp/Down, `/` search, n/N
 * next/previous match, Enter open, Escape close; Shift+F10, right-click or long-press opens the actions menu. Search,
 * branch filter, first-parent and hide-merged views in the toolbar. New commits on top keep the reader's place.
 */
export function GitGraph({ commits, order = 'date', pin, selected, defaultSelected = null, onSelectedChange, loadCommit, loadDiff,
  onCheckout, onCreateBranch, onCherryPick, onRevert, onCopyHash, onCompare, branches, defaultBranches = [], onBranchesChange,
  defaultFirstParent = false, defaultHideMerged = false, height = 480, maxLanes, now: nowProp, toolbar = true, className, 'aria-label': ariaLabel, ref }: GitGraphProps) {
  const t = useMessages(GIT_GRAPH_MESSAGES) as GitT, { fmt } = useLocale()
  const [mountedAt] = useState(() => Date.now()), now = nowProp ?? mountedAt
  const [rootRef, width] = useWidth<HTMLDivElement>()
  const coarse = useCoarsePointer()
  const narrow = width > 0 && width < 640, wide = width === 0 || width >= 900

  /* filters → layout */
  const [branchSel, setBranchSel] = useControllable<readonly string[]>(branches, defaultBranches, onBranchesChange as (v: readonly string[]) => void)
  const [firstParent, setFirstParent] = useState(defaultFirstParent)
  const [hideMerged, setHideMerged] = useState(defaultHideMerged)
  const allBranches = useMemo(() => {
    const s = new Map<string, number>()
    for (const c of commits) for (const r of c.refs ?? []) { const b = r.type === 'tag' || r.type === 'stash' ? null : r.type === 'remote' ? r.name : gitRefBranch(r); if (b && !s.has(b)) s.set(b, gitTime(c.date)) }
    return [...s.entries()].sort((a, b) => b[1] - a[1]).map(e => e[0])
  }, [commits])
  const pins = useMemo(() => { if (pin) return pin; const m = ['main', 'master', 'trunk'].find(n => allBranches.includes(n)); return m ? [m] : [] }, [pin, allBranches])
  const shown = useMemo(() => filterGitHistory(commits, { branches: branchSel, firstParent, hideMerged }), [commits, branchSel, firstParent, hideMerged])
  const { lanes, git: layout } = useMemo(() => gitLanes(shown, { order, pin: pins }), [shown, order, pins])
  const { rows } = layout, count = rows.length
  const [open, setOpen] = useState(false)

  /* geometry */
  const h = narrow ? 52 : coarse ? 44 : 32, lw = narrow ? 12 : 14
  const [allLanes, setAllLanes] = useState(false)
  const capBase = maxLanes ?? (narrow ? 6 : 12)
  // folding one lane into a one-lane gutter saves nothing: fold only when at least two would go
  const foldable = layout.laneCount > capBase + 1
  const cap = allLanes || !foldable ? layout.laneCount : capBase
  const gw = laneGutterWidth(layout.laneCount, lw, cap)
  // the list's own width: the details panel takes up to 400px of it on wide screens
  const listW = wide && open && width ? width - Math.min(400, width * 0.42) : width
  const showAuthor = width === 0 || listW >= 760
  const cols = narrow ? 'minmax(0,1fr)' : showAuthor ? 'minmax(0,1fr) 150px 108px 88px' : 'minmax(0,1fr) 108px 88px'
  // every lane shown and wider than the fold: the list scrolls sideways rather than squeezing the text columns
  const minW = allLanes && foldable ? gw + (narrow ? 220 : 520) : undefined

  /* the rows (LaneGraph) and the Tab stop */
  const graph = useRef<LaneGraphHandle>(null)
  const [active, setActive] = useState(0)
  const act = Math.min(active, Math.max(0, count - 1))
  const goTo = useCallback((i: number, o?: { focus?: boolean; align?: 'auto' | 'center' | 'start' }) => graph.current?.goTo(i, o), [])

  /* selection, compare, details */
  const [sel, setSel] = useControllable<string | null>(selected, defaultSelected, onSelectedChange)
  const selRow = sel != null ? layout.rowOf.get(sel) ?? -1 : -1
  const [cmp, setCmp] = useState<[string, string] | null>(null)
  const cmpRows = cmp ? [layout.rowOf.get(cmp[0]) ?? -1, layout.rowOf.get(cmp[1]) ?? -1] : null
  const range = useMemo(() => cmpRows && cmpRows[0] >= 0 && cmpRows[1] >= 0 ? gitRange(layout, cmpRows[0], cmpRows[1]) : null, [layout, cmpRows?.[0], cmpRows?.[1]]) // eslint-disable-line react-hooks/exhaustive-deps
  const compare = useMemo(() => (range && cmpRows ? { older: Math.max(cmpRows[0], cmpRows[1]), newer: Math.min(cmpRows[0], cmpRows[1]), count: range.count } : null), [range]) // eslint-disable-line react-hooks/exhaustive-deps
  // what LaneGraph marks selected: the two ends while comparing, else the selected commit
  const marked = useMemo(() => (compare ? [rows[compare.older].commit.hash, rows[compare.newer].commit.hash] : sel ? [sel] : []), [compare, rows, sel])

  /* search */
  const [query, setQuery] = useState('')
  const dq = useDeferredValue(query.trim().toLowerCase())
  const matches = useMemo(() => {
    if (!dq) return [] as number[]
    const hex = /^[0-9a-f]{3,}$/.test(dq), out: number[] = []
    for (const r of rows) {
      const c = r.commit
      if ((hex && c.hash.startsWith(dq)) || c.subject.toLowerCase().includes(dq) || c.author.name.toLowerCase().includes(dq) || (c.author.email?.toLowerCase().includes(dq) ?? false)
        || (c.body?.toLowerCase().includes(dq) ?? false) || (c.refs?.some(x => x.name.toLowerCase().includes(dq)) ?? false)) out.push(r.index)
    }
    return out
  }, [rows, dq])
  const matchSet = useMemo(() => new Set(matches), [matches])
  const [matchAt, setMatchAt] = useState(-1)
  const searchRef = useRef<HTMLInputElement>(null)

  /* head */
  const headRow = useMemo(() => rows.find(r => r.commit.refs?.some(x => x.type === 'head'))?.index ?? -1, [rows])
  const headName = headRow >= 0 ? rows[headRow].commit.refs!.find(x => x.type === 'head')!.name : null

  const select = useCallback((i: number, openIt = true) => {
    const r = rows[i]; if (!r) return
    setSel(r.commit.hash); setCmp(null); setActive(i)
    if (openIt) setOpen(true)
  }, [rows, setSel])
  const startCompare = useCallback((a: number, b: number) => {
    const older = rows[Math.max(a, b)].commit.hash, newer = rows[Math.min(a, b)].commit.hash
    setCmp([older, newer]); setOpen(true); onCompare?.(older, newer)
  }, [rows, onCompare])
  // click and Enter: Shift with a selection compares, otherwise select and open the details
  const onActivate = useCallback((r: LaneRow<GitLaneNode>, e: { shiftKey: boolean }) => {
    if (e.shiftKey && selRow >= 0 && selRow !== r.index) { setActive(r.index); startCompare(selRow, r.index); return }
    select(r.index)
  }, [selRow, select, startCompare])
  // each row's dates and accessible name, formatted once per layout (scrolling re-renders the list often)
  const textCache = useMemo(() => new Map<number, { when: string; absolute: string; label: string }>(), [rows, now, t, fmt])
  const rowText = useCallback((i: number) => {
    let x = textCache.get(i)
    if (!x) {
      const c = rows[i].commit, when = fmt.relative(gitTime(c.date), now)
      x = { when, absolute: fmt.dateTime(gitTime(c.date)), label: t('row', { hash: gitShortHash(c.hash), subject: c.subject, author: c.author.name, when }) }
      textCache.set(i, x)
    }
    return x
  }, [textCache, rows, fmt, now, t])

  /* copying a row's hash: one clipboard helper and one announcement for the whole list */
  const { t: tc } = useLocale(), copier = useCopy()
  const [copiedRow, setCopiedRow] = useState(-1)
  const copyLabel = t('copyHash')
  const copyTimer = useRef<ReturnType<typeof setTimeout>>(undefined)
  useEffect(() => () => clearTimeout(copyTimer.current), [])
  const copyHash = useRef<(hash: string) => void>(() => {})
  const rowsRef = useRef(rows); rowsRef.current = rows
  const copyRow = useCallback((i: number) => { const h = rowsRef.current[i]?.commit.hash; if (h) copyHash.current(h) }, [])
  copyHash.current = hash => {
    copier.copy(hash).then(ok => {
      setAnnounce(`${ok ? tc('common.copied') : tc('common.copyFailed')}: ${gitShortHash(hash)}`)
      const i = layout.rowOf.get(hash) ?? -1
      setCopiedRow(ok ? i : -1); clearTimeout(copyTimer.current); copyTimer.current = setTimeout(() => setCopiedRow(-1), 1500)
    })
    onCopyHash?.(hash)
  }

  // Enter typed before the (deferred) matches caught up with the query: jump once they have
  const pendingJump = useRef<1 | -1 | 0>(0)
  const jumpMatch = (dirn: 1 | -1, focus: boolean) => {
    if (dq !== query.trim().toLowerCase()) { pendingJump.current = dirn; return }
    if (!matches.length) return
    let k: number
    if (matchAt >= 0 && matches[matchAt] === act) k = (matchAt + dirn + matches.length) % matches.length
    else { k = dirn > 0 ? matches.findIndex(m => m >= act) : matches.findLastIndex(m => m <= act); if (k < 0) k = dirn > 0 ? 0 : matches.length - 1 }
    setMatchAt(k); goTo(matches[k], { focus, align: 'center' })
  }
  useEffect(() => {
    const d = pendingJump.current
    if (d && dq === query.trim().toLowerCase()) { pendingJump.current = 0; jumpMatch(d, false) }
  }, [dq]) // eslint-disable-line react-hooks/exhaustive-deps

  /* menu: the row it was opened on (right-click, the Menu key) or the active one (long-press) */
  const [menuRow, setMenuRow] = useState(-1)
  const pendingMenu = useRef(-1)
  const menuCommit = rows[menuRow]?.commit
  const menuBranch = menuCommit?.refs?.find(r => r.type === 'branch' || (r.type === 'head' && r.name !== 'HEAD'))?.name

  /* keys LaneGraph doesn't know: Escape closes compare, then details; / searches; n/N jump between matches */
  const onKeyDown = (e: RKeyboardEvent<HTMLDivElement>) => {
    if (gitEditable(e.target) || e.altKey || e.ctrlKey || e.metaKey) return
    const stop = () => { e.preventDefault(); e.stopPropagation() }
    switch (e.key) {
      case 'Escape':
        if (cmp) { stop(); setCmp(null) } else if (open) { stop(); setOpen(false) }
        return // otherwise LaneGraph clears the selection
      case '/': if (toolbar) { stop(); searchRef.current?.focus(); searchRef.current?.select() } return
      case 'n': case 'N': if (matches.length) { stop(); jumpMatch(e.key === 'n' && !e.shiftKey ? 1 : -1, true) } return
    }
  }

  /* new commits on top fade in (LaneGraph keeps the reader's place) and a polite live region counts them */
  const prevHashes = useRef<Set<string> | null>(null)
  const [fresh, setFresh] = useState<Set<string> | null>(null)
  const [announce, setAnnounce] = useState('')
  useEffect(() => {
    const prev = prevHashes.current
    prevHashes.current = new Set(commits.map(c => c.hash))
    if (!prev) return
    const added = commits.filter(c => !prev.has(c.hash))
    if (!added.length || added.length > 500) return
    setFresh(new Set(added.map(c => c.hash))); setAnnounce(t('newCommits', { count: added.length }))
    const id = setTimeout(() => setFresh(null), 1200)
    return () => clearTimeout(id)
  }, [commits]) // eslint-disable-line react-hooks/exhaustive-deps

  useImperativeHandle(ref, () => ({
    scrollToCommit: (hash, align = 'center') => { const i = layout.rowOf.get(hash); if (i !== undefined) goTo(i, { focus: false, align }) },
    select: hash => { if (hash == null) { setSel(null); setOpen(false); return } const i = layout.rowOf.get(hash); if (i !== undefined) { select(i); goTo(i, { focus: false, align: 'center' }) } },
    focus: () => goTo(act),
  }), [layout, goTo, select, act, setSel])

  /* toolbar */
  const toggleBranch = (b: string, on: boolean) => setBranchSel(on ? [...branchSel.filter(x => x !== b), b] : branchSel.filter(x => x !== b))
  const goToBranch = (b: string) => {
    const i = rows.find(r => r.commit.refs?.some(x => x.name === b || gitRefBranch(x) === b))?.index
    if (i !== undefined) { select(i, false); goTo(i, { focus: false, align: 'center' }) }
  }
  const matchLabel = dq ? (matches.length ? t('matches', { n: fmt.number(matchAt >= 0 ? matchAt + 1 : 0), total: fmt.number(matches.length) }) : t('noMatches')) : ''
  // the toolbar doesn't depend on the scroll position: keep it out of the re-renders scrolling causes
  const bar = useMemo(() => toolbar && (
    <div className="flex flex-col gap-2 border-b border-[var(--line)] p-2">
      <div className="flex flex-wrap items-center gap-2">
        <div className={cn('relative min-w-0', narrow ? 'w-full' : 'w-[min(320px,100%)]')}>
          <Icon name="search" size={14} className="pointer-events-none absolute start-2.5 top-1/2 -translate-y-1/2 text-[var(--fg3)]" />
          <input ref={searchRef} type="search" value={query} onChange={e => { setQuery(e.target.value); setMatchAt(-1) }} aria-label={t('search')} placeholder={t('searchPlaceholder')}
            onKeyDown={e => {
              if (e.key === 'Enter') { e.preventDefault(); jumpMatch(e.shiftKey ? -1 : 1, false) }
              else if (e.key === 'Escape' && query) { e.preventDefault(); e.stopPropagation(); setQuery('') }
              else if (e.key === 'ArrowDown') { e.preventDefault(); goTo(matches[Math.max(0, matchAt)] ?? act) }
            }}
            className={cn(inputClass, TOUCH.input, 'ps-8 pe-14 [&::-webkit-search-cancel-button]:hidden')} />
          <span className="pointer-events-none absolute end-2 top-1/2 flex -translate-y-1/2 items-center gap-1 text-[11px] text-[var(--fg3)]">
            {dq ? <span aria-live="polite" className="ui-num whitespace-nowrap">{matchLabel}</span> : <Kbd>/</Kbd>}
          </span>
        </div>
        {dq && (
          <span className="flex items-center">
            <IconButton icon={<Icon name="chevronDown" size={14} className="rotate-180" />} label={t('prevMatch')} disabled={!matches.length} onClick={() => jumpMatch(-1, false)} className={TOUCH.tap} />
            <IconButton icon="chevronDown" label={t('nextMatch')} disabled={!matches.length} onClick={() => jumpMatch(1, false)} className={TOUCH.tap} />
          </span>
        )}
        <DropdownMenuRoot>
          <DropdownMenuTrigger size="sm" className={TOUCH.tap}><Icon name="branch" size={13} />{branchSel.length ? t('branchesCount', { count: branchSel.length }) : t('allBranches')}<Icon name="chevronDown" size={12} /></DropdownMenuTrigger>
          <DropdownMenuContent aria-label={t('branches')} className="max-h-[min(60vh,360px)] overflow-y-auto">
            <MenuLabel>{t('branches')}</MenuLabel>
            {allBranches.map(b => <MenuCheckboxItem key={b} checked={branchSel.includes(b)} onCheckedChange={on => toggleBranch(b, on)} textValue={b}><span dir="ltr" className="truncate">{b}</span></MenuCheckboxItem>)}
          </DropdownMenuContent>
        </DropdownMenuRoot>
        {/* phones: the rest scrolls sideways in one row (the branch menu stays outside it, so its panel isn't clipped) */}
        <div className={cn('items-center gap-2', narrow ? 'flex min-w-0 flex-1 overflow-x-auto [scrollbar-width:none]' : 'contents')}>
        <Chip pressed={firstParent} onClick={() => setFirstParent(x => !x)}>{t('firstParent')}</Chip>
        <Chip pressed={hideMerged} onClick={() => setHideMerged(x => !x)}>{t('hideMerged')}</Chip>
        <span className="flex-1" />
        {headRow >= 0 && (
          <Button size="sm" variant="ghost" className={cn('flex-none', TOUCH.tap)} onClick={() => { select(headRow, false); goTo(headRow, { align: 'center' }) }} title={t('jumpHead')}>
            <Badge size="sm" tone="accent" className="border border-[var(--accent)]">HEAD</Badge>{' '}
            {headName && headName !== 'HEAD' && <span dir="ltr" className="max-w-[18ch] truncate font-[family-name:var(--mono)] text-xs">{headName}</span>}
          </Button>
        )}
        </div>
      </div>
      {branchSel.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          {branchSel.map(b => (
            <span key={b} className="inline-flex h-[30px] items-center rounded-full border border-[var(--line)] bg-[var(--card)] text-xs [@media(pointer:coarse)]:h-9">
              <button type="button" onClick={() => goToBranch(b)} title={t('goTo', { name: b })} className="flex h-full cursor-pointer items-center gap-1 rounded-s-full border-0 bg-transparent ps-2.5 pe-1 text-[var(--fg)] hover:bg-[var(--muted)]">
                <Icon name="branch" size={12} style={{ color: gitStroke(gitLaneColor(gitRefBranch({ name: b, type: b.includes('/') && /^(origin|upstream)\//.test(b) ? 'remote' : 'branch' }) ?? b)) }} /><span dir="ltr">{b}</span>
              </button>
              <button type="button" aria-label={t('removeFilter', { name: b })} onClick={() => toggleBranch(b, false)} className="ui-target relative flex h-full cursor-pointer items-center rounded-e-full border-0 bg-transparent pe-2 ps-1 text-[var(--fg3)] hover:bg-[var(--muted)] hover:text-[var(--fg)]">
                <Icon name="x" size={12} />
              </button>
            </span>
          ))}
        </div>
      )}
    </div>
  ), [toolbar, narrow, query, dq, matches, matchAt, matchLabel, act, branchSel, allBranches, firstParent, hideMerged, headRow, headName, rows, t]) // eslint-disable-line react-hooks/exhaustive-deps

  const compareBar = compare && (
    <div className="flex flex-wrap items-center gap-2 border-b border-[var(--line)] bg-[var(--accent-soft)] px-3 py-1.5 text-xs text-[var(--fg)]">
      <Icon name="diff" size={13} className="text-[var(--accent)]" />
      <span dir="ltr" className="font-[family-name:var(--mono)]">{t('comparing', { from: gitShortHash(rows[compare.older].commit.hash), to: gitShortHash(rows[compare.newer].commit.hash) })}</span>
      <span className="text-[var(--fg2)]">{t('commits', { count: compare.count })}</span>
      <span className="flex-1" />
      <Button size="xs" variant="ghost" onClick={() => setCmp(null)}>{t('exitCompare')}</Button>
    </div>
  )

  const selR = selRow >= 0 ? rows[selRow] : null
  const panelTitle = compare ? t('comparing', { from: gitShortHash(rows[compare.older].commit.hash), to: gitShortHash(rows[compare.newer].commit.hash) }) : selR ? t('details', { hash: gitShortHash(selR.commit.hash) }) : ''
  const showPanel = open && (!!compare || !!selR)
  const jump = useCallback((i: number) => { select(i); goTo(i, { focus: false, align: 'center' }) }, [select, goTo])
  const details = showPanel && <GitDetails layout={layout} row={selR} compare={compare} loadCommit={loadCommit} loadDiff={loadDiff} onJump={jump} t={t} now={now} />

  const hdr = 'flex h-full min-w-0 items-center truncate pe-2 text-[11px] font-medium text-[var(--fg3)]'
  const header = (
    <div role="row" aria-rowindex={1} className="grid h-full items-center" style={{ gridTemplateColumns: `${gw}px ${cols}` }}>
      <div role="columnheader" dir="ltr" className="flex h-full items-center justify-center">
        {foldable
          ? <button type="button" onClick={() => setAllLanes(x => !x)} aria-pressed={allLanes} title={allLanes ? t('fewerLanes') : undefined} className="ui-target relative h-5 cursor-pointer rounded-full border border-dashed border-[var(--line2)] bg-transparent px-1.5 text-[11px] text-[var(--fg2)] hover:bg-[var(--muted)]">
              <span className="sr-only">{t('graph')} </span>{allLanes ? '−' : t('moreLanes', { n: layout.laneCount - cap })}
            </button>
          : <span className="sr-only">{t('graph')}</span>}
      </div>
      <div role="columnheader" className={hdr}>{narrow ? t('commit') : t('description')}</div>
      {!narrow && showAuthor && <div role="columnheader" className={hdr}>{t('author')}</div>}
      {!narrow && <div role="columnheader" className={hdr}>{t('date')}</div>}
      {!narrow && <div role="columnheader" className={cn(hdr, 'justify-end pe-3')}>{t('commit')}</div>}
    </div>
  )
  const renderRow = useCallback((r: LaneRow<GitLaneNode>) => {
    const { when, absolute } = rowText(r.index)
    return <GitRowCells row={rows[r.index]} narrow={narrow} showAuthor={showAuthor} match={matchSet.has(r.index)} query={dq} when={when} absolute={absolute}
      onCopy={copyRow} copied={copiedRow === r.index} copyLabel={copyLabel} />
  }, [rowText, rows, narrow, showAuthor, matchSet, dq, copyRow, copiedRow, copyLabel])
  const rowLabel = useCallback((r: LaneRow<GitLaneNode>) => { const { label } = rowText(r.index); return range?.marks[r.index] ? `${label}, ${t('inRange')}` : label }, [rowText, range, t])
  const inRange = useCallback((r: LaneRow<GitLaneNode>) => (range?.marks[r.index] ? { 'data-range': true } : undefined), [range])
  const rangeClass = useCallback((r: LaneRow<GitLaneNode>, s: LaneRowState) => (!s.selected && range?.marks[r.index] ? 'bg-[color-mix(in_srgb,var(--accent-soft)_55%,transparent)]' : undefined), [range])
  const isHead = useCallback((r: LaneRow<GitLaneNode>) => r.index === headRow, [headRow])
  const onRowMenu = useCallback((r: LaneRow<GitLaneNode>) => { pendingMenu.current = r.index }, [])
  const list = (
    <ContextMenuRoot onOpenChange={o => { if (o) setMenuRow(pendingMenu.current >= 0 ? pendingMenu.current : act); else pendingMenu.current = -1 }}>
      <LaneGraph ref={graph} nodes={lanes} renderRow={renderRow} cells columns={cols} rowHeight={h} laneWidth={lw} maxLanes={cap} height={height} fit={false}
        header={header} headerHeight={GIT_HEADER_H} contentMinWidth={minW} empty={<p className="m-0 p-6 text-center text-[13px] text-[var(--fg3)]">{t('empty')}</p>}
        aria-label={ariaLabel ?? t('label')} aria-colcount={narrow ? 2 : showAuthor ? 5 : 4}
        active={act} onActiveChange={setActive} selected={marked} onSelect={id => { if (id == null) setSel(null) }} onActivate={onActivate}
        onKeyDown={onKeyDown} onContextMenu={onRowMenu} rowLabel={rowLabel} rowAttrs={inRange} rowClassName={rangeClass} emphasis={isHead} fresh={fresh}
        className="flex-1" wrapScroller={el => <ContextMenuTrigger asChild label={t('menu')}>{el}</ContextMenuTrigger>} />
      <ContextMenuContent aria-label={t('menu')}>
        <MenuItem icon="branch" disabled={!onCheckout} onSelect={() => menuCommit && onCheckout?.(menuCommit.hash, menuBranch)}>{menuBranch ? t('checkoutBranch', { branch: menuBranch }) : t('checkout')}</MenuItem>
        <MenuItem icon="branch" disabled={!onCreateBranch} onSelect={() => menuCommit && onCreateBranch?.(menuCommit.hash)}>{t('createBranch')}</MenuItem>
        <MenuItem icon="commit" disabled={!onCherryPick} onSelect={() => menuCommit && onCherryPick?.(menuCommit.hash)}>{t('cherryPick')}</MenuItem>
        <MenuItem icon="replay" disabled={!onRevert} onSelect={() => menuCommit && onRevert?.(menuCommit.hash)}>{t('revert')}</MenuItem>
        <MenuSeparator />
        <MenuItem icon="copy" onSelect={() => { if (menuCommit) copyHash.current(menuCommit.hash) }}>{t('copyHash')}</MenuItem>
        <MenuItem icon="diff" disabled={selRow < 0 || selRow === menuRow} onSelect={() => { if (menuRow >= 0 && selRow >= 0) startCompare(selRow, menuRow) }}>
          {selR && selRow !== menuRow ? t('compareWith', { hash: gitShortHash(selR.commit.hash) }) : t('compareHint')}
        </MenuItem>
      </ContextMenuContent>
    </ContextMenuRoot>
  )

  return (
    <div ref={rootRef} className={cn('flex min-w-0 flex-col overflow-hidden rounded-[var(--r-lg)] border border-[var(--line)] bg-[var(--card)] text-[13px]', className)}>
      {bar}
      {compareBar}
      <div className="flex min-w-0">
        {list}
        {wide && showPanel && (
          <aside aria-label={panelTitle} className="flex w-[min(400px,42%)] flex-none flex-col border-s border-[var(--line)]" style={{ height }}
            onKeyDown={e => { if (e.key === 'Escape') { e.preventDefault(); if (cmp) setCmp(null); else setOpen(false); goTo(act) } }}>
            <div className="flex h-10 flex-none items-center gap-2 border-b border-[var(--line)] ps-3 pe-1.5">
              <h3 dir="ltr" className="m-0 min-w-0 flex-1 truncate text-start font-[family-name:var(--mono)] text-xs font-semibold text-[var(--fg)]">{panelTitle}</h3>
              <IconButton icon="x" label={t('closeDetails')} onClick={() => { setOpen(false); setCmp(null); goTo(act) }} />
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-3">{details}</div>
          </aside>
        )}
      </div>
      {!wide && (
        <DialogRoot open={showPanel} onOpenChange={o => { if (!o) { setOpen(false); setCmp(null) } }}>
          <SheetContent>
            <SheetHeader><DialogTitle><span dir="ltr" className="font-[family-name:var(--mono)]">{panelTitle}</span></DialogTitle><DialogClose /></SheetHeader>
            <div className="flex-1">{details}</div>
          </SheetContent>
        </DialogRoot>
      )}
      <span className="sr-only" aria-live="polite">{announce}</span>
    </div>
  )
}
