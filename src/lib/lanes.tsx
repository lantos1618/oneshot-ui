import { memo, useCallback, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState, type HTMLAttributes, type KeyboardEvent as RKeyboardEvent, type MouseEvent as RMouseEvent, type ReactElement, type ReactNode, type Ref } from 'react'
import { motion } from 'motion/react'
import { cn, useCoarsePointer, useControllable } from './core'
import { useVirtual } from './virtual'

/**
 * A node: a unique `id`, the ids of its `parents` (first parent first: the line it continues), an optional `time` (for
 * `order: 'time'`) and an optional `group` (a branch or thread key: it colours the lane the node starts and is what
 * `pin` names). Extend it with anything your rows render: `layoutLanes<MyNode>` hands your objects back.
 */
export type LaneNode = { id: string; parents: readonly string[]; time?: number; group?: string }

/**
 * What a stroke is: `pass` stays in its lane (a lane passing a row, or the node's own line), `merge` joins a merge's
 * extra parent, `fork` is a branch's line ending in the node it started from, `missing` a stub to a parent not loaded.
 */
export type LaneEdgeKind = 'pass' | 'merge' | 'fork' | 'missing'

/**
 * One stroke in a row's slice. `half`: `top` runs from the row's top edge into its node, `bottom` from the node to the
 * row's bottom edge, `full` passes the row without touching it. `child`/`parent` are the rows of the link it belongs
 * to (`parent` -1 for a stub); `firstParent` when that link is the child's first parent (what ancestry follows).
 * `color` indexes the layout's palette.
 */
export type LaneEdge = {
  fromLane: number; toLane: number; kind: LaneEdgeKind; half: 'top' | 'bottom' | 'full'
  color: number; firstParent: boolean; child: number; parent: number
}

/** One laid-out node: its row, lane, colour, strokes, and its parents and children as row indexes (-1: a parent not loaded). */
export type LaneRow<N extends LaneNode = LaneNode> = {
  readonly node: N; readonly index: number; readonly lane: number; readonly color: number
  readonly edges: readonly LaneEdge[]; readonly parents: readonly number[]; readonly children: readonly number[]
}

/** layoutLanes' result. `rowOf(id)` is the row of a node (-1 when absent); `palette` is what row and edge colours index. */
export type LaneLayout<N extends LaneNode = LaneNode> = {
  readonly rows: readonly LaneRow<N>[]; readonly laneCount: number; readonly rowOf: (id: string) => number
  /** the row of each id (what rowOf reads) */ readonly index: ReadonlyMap<string, number>
  readonly direction: 'down' | 'up'; readonly palette: readonly string[]
}

/**
 * layoutLanes options.
 * - `order`: 'time' (newest first, default when nodes have times), 'topo' (a branch's nodes together) or 'input'
 *   (your order, e.g. a chat transcript; only a parent listed after its child is moved).
 * - `direction`: 'down' (children above parents, newest first like git, default) or 'up' (parents first, like a chat).
 * - `pin`: groups whose first-parent line keeps the leftmost lanes, in this order (main, then develop; the active thread).
 *   `pinStart(group, nodesInRowOrder)` says where a pinned line starts (default: the group's first node in row order).
 * - `palette`: the colours rows and edges index (default LANE_COLORS). `color(group, pinned)`: a group's colour index
 *   (default laneColor: pinned groups take the first colours, the rest a stable hash of their name into the others).
 * - `laneGroup(child, parentIndex, parent)`: the group of a lane opened for a merge's extra parent (default the
 *   parent's group, else its id), e.g. the branch named in "Merge branch 'x'".
 * - `firstParentLanes` (default true): a node several lanes wait for takes the one reached through a first parent.
 */
export type LaneLayoutOptions<N extends LaneNode = LaneNode> = {
  order?: 'time' | 'topo' | 'input'
  direction?: 'down' | 'up'
  pin?: readonly string[]
  pinStart?: (group: string, nodesInRowOrder: readonly N[]) => string | undefined
  palette?: readonly string[]
  color?: (group: string, pinned: readonly string[]) => number
  laneGroup?: (child: N, parentIndex: number, parent: N) => string | undefined
  firstParentLanes?: boolean
}

/** Lane colours, theme tokens only (light and dark): the first is the strongest (the trunk), the rest spread by hashing group names. */
export const LANE_COLORS = [
  'var(--c1)', 'var(--c2)', 'var(--c3)', 'var(--c4)', 'var(--bad)',
  'color-mix(in oklab, var(--c2) 55%, var(--bad))', 'color-mix(in oklab, var(--c4) 55%, var(--c2))', 'color-mix(in oklab, var(--c4) 45%, var(--c3))',
] as const

/** FNV-1a: a small stable hash, so a group keeps its colour across renders and sessions. */
export function laneHash(s: string) {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) }
  return h >>> 0
}

/**
 * The default colour of a group: pinned groups take colours 0, 1, 2… in pin order; every other group hashes into
 * the colours the pins left, so a feature branch never wears main's colour.
 */
export function laneColor(group: string, pinned: readonly string[], paletteSize: number = LANE_COLORS.length) {
  const k = pinned.indexOf(group)
  if (k >= 0) return k % paletteSize
  const free = paletteSize - Math.min(pinned.length, paletteSize - 1)
  return paletteSize - free + (laneHash(group) % free)
}

/** A binary min-heap of numbers ordered by `before(a, b)` (true when a comes out first). */
class MinHeap {
  private items: number[] = []
  private readonly before: (a: number, b: number) => boolean
  constructor(before: (a: number, b: number) => boolean) { this.before = before }
  get size() { return this.items.length }
  push(x: number) {
    const h = this.items
    let k = h.push(x) - 1
    while (k > 0) { // sift up
      const up = (k - 1) >> 1
      if (!this.before(h[k], h[up])) break
      this.swap(k, up)
      k = up
    }
  }
  pop(): number {
    const h = this.items, top = h[0], last = h.pop()!
    if (h.length) {
      h[0] = last
      for (let k = 0; ;) { // sift down
        const l = 2 * k + 1, r = l + 1
        let m = k
        if (l < h.length && this.before(h[l], h[m])) m = l
        if (r < h.length && this.before(h[r], h[m])) m = r
        if (m === k) break
        this.swap(k, m)
        k = m
      }
    }
    return top
  }
  private swap(a: number, b: number) { const h = this.items, t = h[a]; h[a] = h[b]; h[b] = t }
}

/** A parent that is not in the list. */
const NOT_LOADED = -1

/** Nodes deduplicated by id, with their parents as indexes into that list (NOT_LOADED when absent; self-links and repeats dropped). */
function laneIndex<N extends LaneNode>(input: readonly N[]) {
  const at = new Map<string, number>(), nodes: N[] = []
  for (const node of input) if (!at.has(node.id)) { at.set(node.id, nodes.length); nodes.push(node) }
  const parents = nodes.map((node, i) => {
    const out: number[] = []
    for (const id of node.parents) {
      const j = at.get(id) ?? NOT_LOADED
      // a node naming itself, or a parent listed twice, would never become ready: keep the first mention only
      if (j === i || (j !== NOT_LOADED && out.includes(j))) continue
      out.push(j)
    }
    return out
  })
  return { nodes, parents, at }
}

/**
 * Children-first order (Kahn's algorithm): a node is ready once all its children are placed. `before` picks among
 * ready nodes ('time': newest; 'input': input position), or 'topo' takes the most recently readied (a stack). Nodes
 * left over by a cycle (bad input) go last, in `before` order, rather than being dropped.
 */
function laneOrder(parents: readonly number[][], order: 'time' | 'topo' | 'input', before: (a: number, b: number) => boolean): number[] {
  const n = parents.length, waitingChildren = new Int32Array(n)
  for (const ps of parents) for (const p of ps) if (p !== NOT_LOADED) waitingChildren[p]++
  const out: number[] = []
  const ready = order === 'topo' ? null : new MinHeap(before)
  const stack: number[] = []
  const add = (i: number) => (ready ? ready.push(i) : stack.push(i))
  const roots: number[] = []
  for (let i = 0; i < n; i++) if (!waitingChildren[i]) roots.push(i)
  if (!ready) roots.sort((a, b) => (before(a, b) ? 1 : -1)) // the first to come out on top of the stack
  roots.forEach(add)
  while (ready ? ready.size : stack.length) {
    const i = ready ? ready.pop() : stack.pop()!
    out.push(i)
    for (const p of parents[i]) if (p !== NOT_LOADED && --waitingChildren[p] === 0) add(p)
  }
  if (out.length < n) {
    const placed = new Uint8Array(n)
    for (const i of out) placed[i] = 1
    const rest: number[] = []
    for (let i = 0; i < n; i++) if (!placed[i]) rest.push(i)
    rest.sort((a, b) => (before(a, b) ? -1 : 1))
    out.push(...rest)
  }
  return out
}

/** A lane that isn't heading anywhere. */
const FREE = -1

/** One vertical lane while the pass walks down the rows. */
type Lane = {
  /** the row this lane is heading for (a parent not reached yet), or FREE */
  waitsFor: number
  /** the row it came from: the child whose link it carries */
  from: number
  /** the colour of the branch it carries */
  color: number
  /** it carries a first-parent link (a branch's own line), not a merge's extra parent */
  firstParent: boolean
  /** the row that freed it: a merge on that same row doesn't reuse it (that would double back over the fork) */
  freedAt: number
}
const newLane = (color = 0): Lane => ({ waitsFor: FREE, from: -1, color, firstParent: true, freedAt: -1 })

/**
 * The edges of every row, packed: a flat Int32Array with LANE_EDGE_FIELDS numbers per edge, in the order of the
 * LaneEdge fields, and kinds and halves as indexes into LANE_KINDS and LANE_HALVES. A 50k-node graph has a few
 * hundred thousand edges; as objects they cost more time in garbage collection than the whole lane pass, and only the
 * ~40 rows on screen ever read theirs. LaneRow.edges decodes a row's into plain LaneEdge objects when read.
 */
class LaneEdgeStore {
  private data = new Int32Array(1024)
  length = 0
  /** Appends one edge (the LaneEdge fields, in order). */
  add(fromLane: number, toLane: number, kind: LaneEdgeKind, half: LaneEdge['half'], color: number, firstParent: boolean, child: number, parent: number) {
    if ((this.length + 1) * LANE_EDGE_FIELDS > this.data.length) { const grown = new Int32Array(this.data.length * 2); grown.set(this.data); this.data = grown }
    const d = this.data, o = this.length++ * LANE_EDGE_FIELDS
    d[o] = fromLane; d[o + 1] = toLane; d[o + 2] = LANE_KIND_CODE[kind]; d[o + 3] = LANE_HALF_CODE[half]
    d[o + 4] = color; d[o + 5] = firstParent ? 1 : 0; d[o + 6] = child; d[o + 7] = parent
  }
  /** Edges `from` to `to` (exclusive) as objects. `flip` (direction 'up'): halves swap, ends swap, rows count from the bottom of `n`. */
  read(from: number, to: number, flip: boolean, n: number): LaneEdge[] {
    const d = this.data, out: LaneEdge[] = []
    const at = (r: number) => (flip && r >= 0 ? n - 1 - r : r)
    for (let i = from; i < to; i++) {
      const o = i * LANE_EDGE_FIELDS, half = LANE_HALVES[d[o + 3]]
      out.push({
        fromLane: flip ? d[o + 1] : d[o], toLane: flip ? d[o] : d[o + 1], kind: LANE_KINDS[d[o + 2]],
        half: flip && half !== 'full' ? (half === 'top' ? 'bottom' : 'top') : half,
        color: d[o + 4], firstParent: d[o + 5] === 1, child: at(d[o + 6]), parent: at(d[o + 7]),
      })
    }
    return out
  }
}
const LANE_EDGE_FIELDS = 8
const LANE_KINDS: readonly LaneEdgeKind[] = ['pass', 'merge', 'fork', 'missing']
const LANE_HALVES: readonly LaneEdge['half'][] = ['top', 'bottom', 'full']
const LANE_KIND_CODE = { pass: 0, merge: 1, fork: 2, missing: 3 } as const satisfies Record<LaneEdgeKind, number>
const LANE_HALF_CODE = { top: 0, bottom: 1, full: 2 } as const satisfies Record<LaneEdge['half'], number>

/** What every row of one layout shares: the packed edges (row r's are edgesAt[r]..edgesAt[r + 1]) and children. */
type LaneStore = { edges: LaneEdgeStore; edgesAt: Int32Array; children: { at: Int32Array; rows: Int32Array }; flip: boolean; n: number }

/** Children of every row, flat (CSR): row r's are `rows[at[r] .. at[r + 1])`, in row order. */
function laneChildren(parentRows: readonly number[][]) {
  const n = parentRows.length, at = new Int32Array(n + 1)
  for (const ps of parentRows) for (const p of ps) if (p !== NOT_LOADED) at[p + 1]++
  for (let r = 0; r < n; r++) at[r + 1] += at[r]
  const rows = new Int32Array(at[n]), next = at.slice(0, n)
  parentRows.forEach((ps, r) => { for (const p of ps) if (p !== NOT_LOADED) rows[next[p]++] = r })
  return { at, rows }
}

/** A laid-out row: `edges` and `children` are read from the layout's shared store when asked for (rows off screen never are). */
class LaneRowRecord<N extends LaneNode> implements LaneRow<N> {
  readonly node: N; readonly index: number; readonly lane: number; readonly color: number; readonly parents: readonly number[]
  /** this row's place in the pass (children first); differs from `index` in an 'up' layout */ readonly #r: number
  readonly #store: LaneStore
  constructor(node: N, r: number, lane: number, color: number, parents: readonly number[], store: LaneStore) {
    this.node = node; this.index = store.flip ? store.n - 1 - r : r; this.lane = lane; this.color = color; this.parents = parents
    this.#r = r; this.#store = store
  }
  get edges(): LaneEdge[] { const s = this.#store; return s.edges.read(s.edgesAt[this.#r], s.edgesAt[this.#r + 1], s.flip, s.n) }
  get children(): number[] {
    const { children: c, flip, n } = this.#store, kids = Array.from(c.rows.subarray(c.at[this.#r], c.at[this.#r + 1]))
    return flip ? kids.map(k => n - 1 - k).reverse() : kids
  }
}

/** The open lanes during the pass. Lanes 0..reserved-1 belong to pinned groups and are never handed to anyone else. */
class LaneSet {
  readonly lanes: Lane[]
  readonly reserved: number
  widest: number
  constructor(reserved: number, pinColors: readonly number[]) {
    this.reserved = reserved
    this.lanes = pinColors.map(c => newLane(c))
    this.widest = reserved - 1
  }
  /** The leftmost lane heading for `row` (with `firstParent`: the leftmost carrying a first-parent link), or -1. */
  find(row: number, firstParent = false): number {
    for (let k = 0; k < this.lanes.length; k++) if (this.lanes[k].waitsFor === row && (!firstParent || this.lanes[k].firstParent)) return k
    return -1
  }
  /** The leftmost free lane right of the pinned ones (not one freed by `notFreedAt`), else a new lane on the right. */
  free(notFreedAt = -2): number {
    for (let k = this.reserved; k < this.lanes.length; k++) {
      const l = this.lanes[k]
      if (l.waitsFor === FREE && l.freedAt !== notFreedAt) return k
    }
    this.lanes.push(newLane())
    return this.lanes.length - 1
  }
  /** Point lane `k` at `parent`, carrying the link from `child`. */
  open(k: number, parent: number, child: number, color: number, firstParent: boolean) {
    const l = this.lanes[k]
    l.waitsFor = parent; l.from = child; l.color = color; l.firstParent = firstParent
  }
  /** Lane `k` reached the node it was heading for, at `row`. */
  release(k: number, row: number) { this.lanes[k].waitsFor = FREE; this.lanes[k].freedAt = row }
  /** Free trailing lanes, so the graph narrows again once branches end. */
  trim() {
    while (this.lanes.length > this.reserved && this.lanes[this.lanes.length - 1].waitsFor === FREE) this.lanes.pop()
  }
  note(lane: number) { if (lane > this.widest) this.widest = lane }
}

/**
 * Lay out a DAG as rows and lanes (the module header has the algorithm in five steps). Pure and O(n · lanes): 50k
 * nodes take a few tens of milliseconds. Input order only matters for `order: 'input'`.
 *   const { rows, laneCount } = layoutLanes(messages.map(m => ({ id: m.id, parents: m.parentId ? [m.parentId] : [] })), { order: 'input', direction: 'up' })
 */
export function layoutLanes<N extends LaneNode>(input: readonly N[], options: LaneLayoutOptions<N> = {}): LaneLayout<N> {
  const { direction = 'down', pin = [], pinStart, palette = LANE_COLORS, color = laneColorFor(palette.length), laneGroup, firstParentLanes = true } = options
  const order = options.order ?? (input.some(x => x.time !== undefined) ? 'time' : 'input')

  // 1. order: children before parents
  const { nodes, parents: inputParents, at: idIndex } = laneIndex(input)
  const before = order === 'input'
    // children first: in a 'down' list that is your order; in an 'up' list (oldest first) it is your order reversed
    ? (direction === 'up' ? (a: number, b: number) => a > b : (a: number, b: number) => a < b)
    : (a: number, b: number) => { const ta = nodes[a].time ?? 0, tb = nodes[b].time ?? 0; return ta !== tb ? ta > tb : nodes[a].id < nodes[b].id }
  const sequence = laneOrder(inputParents, order, before)
  const n = sequence.length
  const rowOfInput = new Int32Array(nodes.length)
  sequence.forEach((i, r) => { rowOfInput[i] = r })
  const rowById = idIndex // id → input index becomes id → row in the pass (children first)
  for (const [id, i] of idIndex) rowById.set(id, rowOfInput[i])
  const nodeAt = (r: number) => nodes[sequence[r]]
  // from here on parents are rows (the arrays are reused: renumbered in place, then put in row order)
  for (const ps of inputParents) for (let k = 0; k < ps.length; k++) if (ps[k] !== NOT_LOADED) ps[k] = rowOfInput[ps[k]]
  const parentRows = sequence.map(i => inputParents[i])

  // pinned groups: their first-parent lines get the reserved lanes 0..k-1 (an earlier pin wins a shared node)
  const pinnedLane = new Int32Array(n).fill(-1), pinned: string[] = []
  const inRowOrder = pinStart ? sequence.map(i => nodes[i]) : null
  for (const group of pin) {
    const startId = pinStart ? pinStart(group, inRowOrder!) : undefined
    let start = startId !== undefined ? rowById.get(startId) ?? -1 : -1
    if (!pinStart) for (let r = 0; r < n && start < 0; r++) if (nodeAt(r).group === group) start = r
    if (start < 0) continue
    const k = pinned.length
    pinned.push(group)
    for (let r = start; r >= 0 && pinnedLane[r] < 0; ) {
      pinnedLane[r] = k
      const next = parentRows[r][0] ?? NOT_LOADED
      r = next > r ? next : -1
    }
  }
  const hue = (group: string) => color(group, pinned)
  const lanes = new LaneSet(pinned.length, pinned.map(hue))

  const laneOf = new Int32Array(n), colorOf = new Int32Array(n), edgesAt = new Int32Array(n + 1)
  const edges = new LaneEdgeStore()
  for (let r = 0; r < n; r++) {
    const node = nodeAt(r)
    edgesAt[r] = edges.length

    // 2. take a lane: the pinned one, else one waiting for this node (prefer its first-parent line), else a free one (a tip)
    const pinnedK = pinnedLane[r], waiting = lanes.find(r), line = firstParentLanes ? lanes.find(r, true) : -1
    let lane: number
    if (pinnedK >= 0 && (lanes.lanes[pinnedK].waitsFor === FREE || lanes.lanes[pinnedK].waitsFor === r)) lane = pinnedK
    else if (waiting >= 0) lane = line >= 0 ? line : waiting
    else lane = lanes.free()

    // its colour belongs to its branch: pinned lanes keep theirs, a node with a group starts that group's colour,
    // a lane reaching a node without one passes its colour on, and a tip without a group is coloured by its id
    const own = lanes.lanes[lane]
    const c = lane < lanes.reserved ? own.color
      : node.group !== undefined ? hue(node.group)
      : own.waitsFor === r ? own.color : hue(node.id)

    // 3. the top half: lanes passing by, and lanes ending in this node (its own line, forks, merged-in branches),
    //    which are free from here on
    for (let k = 0; k < lanes.lanes.length; k++) {
      const l = lanes.lanes[k]
      if (l.waitsFor === FREE) continue
      if (l.waitsFor !== r) { edges.add(k, k, 'pass', 'full', l.color, l.firstParent, l.from, l.waitsFor); continue }
      edges.add(k, lane, k === lane ? 'pass' : l.firstParent ? 'fork' : 'merge', 'top', l.color, l.firstParent, l.from, r)
      lanes.release(k, r)
    }

    // 4. the bottom half: the first parent continues in this lane; every further parent joins the lane already
    //    heading for it or opens a free one (not one this row just freed); a parent not loaded gets a stub
    const ps = parentRows[r]
    for (let i = 0; i < ps.length; i++) {
      const p = ps[i], first = i === 0
      if (p === NOT_LOADED || p <= r) { // not loaded (or listed above its child: a cycle in bad input)
        edges.add(lane, lane, 'missing', 'bottom', c, first, r, NOT_LOADED)
      } else if (first) {
        lanes.open(lane, p, r, c, true)
        edges.add(lane, lane, 'pass', 'bottom', c, true, r, p)
      } else {
        let k = lanes.find(p)
        if (k < 0) {
          k = lanes.free(r)
          const parent = nodeAt(p)
          lanes.open(k, p, r, hue(laneGroup?.(node, i, parent) ?? parent.group ?? parent.id), false)
        }
        edges.add(lane, k, 'merge', 'bottom', lanes.lanes[k].color, false, r, p)
      }
    }
    lanes.note(lanes.lanes.length - 1) // the last lane drew in this row: trailing free lanes were trimmed after the row before
    lanes.trim()
    laneOf[r] = lane; colorOf[r] = c
  }

  edgesAt[n] = edges.length

  // 5. rows (flipped for 'up': the last row first, each row's halves swapped when its edges are read)
  const up = direction === 'up', at = (r: number) => (up && r >= 0 ? n - 1 - r : r)
  const store: LaneStore = { edges, edgesAt, children: laneChildren(parentRows), flip: up, n }
  const rows: LaneRow<N>[] = new Array(n)
  for (let r = 0; r < n; r++) rows[at(r)] = new LaneRowRecord(nodeAt(r), r, laneOf[r], colorOf[r], up ? parentRows[r].map(at) : parentRows[r], store)
  const index = up ? new Map(rows.map(row => [row.node.id, row.index])) : rowById
  return { rows, laneCount: n ? lanes.widest + 1 : 0, rowOf: id => index.get(id) ?? -1, index, direction, palette }
}

/** The default `color` for a palette of `size` colours (see laneColor). */
const laneColorFor = (size: number) => (group: string, pinned: readonly string[]) => laneColor(group, pinned, size)

/** The first-parent ancestry of row `r` (itself, its first parent, that one's first parent…) as marks, for highlighting a line. */
export function laneAncestry(layout: { rows: readonly { parents: readonly number[] }[] }, r: number): Uint8Array {
  const marks = new Uint8Array(layout.rows.length)
  for (let i = r; i >= 0 && i < marks.length && !marks[i]; i = layout.rows[i].parents[0] ?? -1) marks[i] = 1
  return marks
}

/** Corner radius of edge elbows (the same rounded elbow as TraceWaterfall's connectors). */
const LANE_ELBOW = 6

/** Width of the gutter for `laneCount` lanes `laneWidth` apart, with lanes from `cap` on folded into one extra lane. */
export const laneGutterWidth = (laneCount: number, laneWidth = 14, cap = Infinity) =>
  Math.max(28, 8 + (Math.min(laneCount, cap) + (laneCount > cap ? 1 : 0)) * laneWidth)

/** LaneGutter props. Without `rowHeight` the slice stretches to its parent's height (rows of any height). */
export type LaneGutterProps = {
  row: LaneRow<LaneNode>
  /** px between lanes (default 14) */ laneWidth?: number
  /** a fixed row height in px; omit to stretch to the row */ rowHeight?: number
  /** where the node sits from the row's top (default: half of rowHeight, else 16) */ nodeY?: number
  /** lanes from this index on fold into one dashed lane (default: none fold) */ cap?: number
  /** rows on the highlighted line (laneAncestry): its first-parent links are drawn bold, the rest dimmed */ highlight?: Uint8Array | null
  /** ring the node (HEAD, the current message) */ emphasis?: boolean
  /** default LANE_COLORS (pass the layout's palette) */ palette?: readonly string[]
  /** total lanes, for the gutter width (default: the row's own extent) */ laneCount?: number
  className?: string
}

type LaneStroke = { key: string; d: string; color: string; dashed: boolean; opacity: number; width: number; tail?: { x: number; y: number } }

/**
 * One row's slice of a lane graph as SVG: lanes passing by, rounded elbows into and out of the node, stubs for parents
 * that aren't loaded, and the node (hollow for merges). Lines that run to the row's bottom edge are drawn to 100% of
 * the SVG's height, so a slice stretches with its row: a chat message 400px tall keeps its lanes joined to the next row.
 */
export function LaneGutter({ row, laneWidth: lw = 14, rowHeight, nodeY, cap = Infinity, highlight = null, emphasis, palette = LANE_COLORS, laneCount, className }: LaneGutterProps) {
  const m = nodeY ?? (rowHeight ? rowHeight / 2 : 16)
  const x = (l: number) => 4 + lw / 2 + Math.min(l, cap) * lw
  const stroke = (c: number) => palette[c % palette.length]
  let widest = row.lane
  for (const e of row.edges) widest = Math.max(widest, e.fromLane, e.toLane)
  const width = laneGutterWidth(laneCount ?? widest + 1, lw, cap)
  // on the highlighted line: a first-parent link out of a node on it (its parent is then on it too)
  const lit = (e: LaneEdge) => !!highlight && e.firstParent && e.parent >= 0 && !!highlight[e.child]
  const strokes: LaneStroke[] = [], seen = new Set<string>()
  for (const e of row.edges) {
    const folded = e.fromLane >= cap && e.toLane >= cap, a = x(e.fromLane), b = x(e.toLane)
    const { d, tail } = laneStrokePath(e, a, b, m, lw)
    // the key must carry the tail too: a lane passing by and the line below a node have no path of their own (d is
    // empty) and differ only in where their tail runs, so a colour-and-path key would drop all but one of them
    const key = `${folded ? 'f' : e.color}|${d}|${tail ? `${tail.x},${tail.y}` : ''}`
    if (seen.has(key)) continue
    seen.add(key)
    const on = lit(e)
    strokes.push({ key, d, tail, color: folded ? 'var(--c-neutral)' : stroke(e.color), dashed: folded || e.kind === 'missing', width: on ? 2.5 : 2, opacity: highlight && !on ? 0.22 : e.kind === 'missing' ? 0.6 : 1 })
  }
  const nx = x(row.lane), merge = row.parents.length > 1, dim = !!highlight && !highlight[row.index]
  const c = row.lane >= cap ? 'var(--c-neutral)' : stroke(row.color)
  // a tail is the part of a stroke that runs down to the row's bottom edge: a number for fixed rows, 100% otherwise
  const bottom = rowHeight ?? '100%'
  const pinned = !rowHeight && 'absolute inset-y-0 left-0'
  const svg = (
    <svg width={width} height={rowHeight ?? '100%'} className={cn('block overflow-visible', pinned, rowHeight && className)} aria-hidden focusable="false">
      {strokes.map(s => (
        <g key={s.key} fill="none" stroke={s.color} strokeWidth={s.width} strokeLinecap="round" strokeDasharray={s.dashed ? '2 3' : undefined} opacity={s.opacity}>
          {s.d && <path d={s.d} />}
          {s.tail && <line x1={s.tail.x} x2={s.tail.x} y1={s.tail.y} y2={bottom} />}
        </g>
      ))}
      <g opacity={dim ? 0.35 : 1}>
        {emphasis && <circle cx={nx} cy={m} r={7.5} fill="none" stroke="var(--accent)" strokeWidth={1.5} />}
        {merge
          ? <circle cx={nx} cy={m} r={3.5} fill="var(--card)" stroke={c} strokeWidth={2} />
          : <circle cx={nx} cy={m} r={emphasis ? 5 : 4} fill={c} stroke="var(--card)" strokeWidth={1.5} />}
      </g>
    </svg>
  )
  if (rowHeight) return svg
  // stretching: an SVG 100% tall in a row whose height comes from its content would fall back to 150px and prop the
  // row open, so it is positioned over a box that takes the row's height instead
  return <div className={cn('relative h-full', className)} style={{ width, minHeight: 2 * m }}>{svg}</div>
}

/**
 * The path of one stroke, with the node `m` px from the top. `tail`: where a vertical line continues from down to the
 * row's bottom edge (drawn separately, so it can stretch).
 */
function laneStrokePath(e: LaneEdge, a: number, b: number, m: number, lw: number): { d: string; tail?: { x: number; y: number } } {
  const s = Math.sign(b - a), r = Math.min(LANE_ELBOW, Math.abs(b - a), m)
  if (e.half === 'full') return { d: '', tail: { x: a, y: 0 } }
  if (e.kind === 'missing') { // a short fading stub: straight on for a first parent, slanted for a merge's
    const dy = e.half === 'bottom' ? 1 : -1
    return { d: e.firstParent ? `M${a} ${m}V${m + dy * m * 0.76}` : `M${a} ${m}L${a + lw * 0.7} ${m + dy * m * 0.64}` }
  }
  if (e.half === 'top') return { d: a === b ? `M${a} 0V${m}` : `M${a} 0V${m - r}Q${a} ${m} ${a + s * r} ${m}H${b}` }
  if (a === b) return { d: '', tail: { x: a, y: m } }
  return { d: `M${a} ${m}H${b - s * r}Q${b} ${m} ${b} ${m + r}`, tail: { x: b, y: m + r } }
}

/** What useLaneGraph needs besides the nodes: the layout options plus selection, the active row and highlighting. */
export type LaneGraphOptions<N extends LaneNode = LaneNode> = LaneLayoutOptions<N> & {
  /** selected id(s): controlled (`selected` + `onSelect`) or `defaultSelected` */ selected?: string | readonly string[] | null
  defaultSelected?: string | null; onSelect?: (id: string | null, row: LaneRow<N> | null) => void
  /** the row holding the Tab stop: controlled (`active` + `onActiveChange`) or internal */ active?: number; onActiveChange?: (index: number) => void
  /** 'ancestry' (default): hovering or focusing a row lights its first-parent line and dims the rest; 'none' */ highlight?: 'ancestry' | 'none'
  /**
   * the hovered node's id: controlled (`hovered` + `onHoverChange`, e.g. to light a row from something outside the list)
   * or internal (the mouse). `onHoverChange` reports the mouse entering a row (its id) and leaving the list (null) either way.
   */
  hovered?: string | null; onHoverChange?: (id: string | null) => void
}

/** What useLaneGraph returns: the layout and the state LaneGraph renders from, for your own markup. */
export type LaneGraphState<N extends LaneNode = LaneNode> = {
  layout: LaneLayout<N>
  active: number; setActive: (index: number) => void
  selected: ReadonlySet<string>; select: (id: string | null) => void
  /** the hovered row (from `hovered` when controlled); setHover reports it through onHoverChange */ hover: number | null; setHover: (index: number | null) => void
  focused: boolean; setFocused: (focused: boolean) => void
  /** marks of the lit line (hovered, else the focused row), or null */ highlight: Uint8Array | null
  /** the row a key moves to from the active one (↑/↓, Home/End, PageUp/PageDown by `page`, ← parent, → child; Shift for the other one), or null */
  target: (key: string, shift?: boolean, page?: number) => number | null
}

const LANE_NONE: readonly string[] = []

/**
 * The layout and interaction state of a lane graph, without markup: layout (memoised; memoise function options),
 * active row, selection, hover/focus highlighting and keyboard targets. LaneGraph is built on it; use it to draw your
 * own rows (with LaneGutter) or a different container.
 */
export function useLaneGraph<N extends LaneNode>(source: readonly N[] | LaneLayout<N>, options: LaneGraphOptions<N> = {}): LaneGraphState<N> {
  const { order, direction, pin, pinStart, palette, color, laneGroup, firstParentLanes, selected: selectedProp, defaultSelected = null, onSelect, active: activeProp, onActiveChange, highlight: mode = 'ancestry', hovered, onHoverChange } = options
  const pinKey = (pin ?? LANE_NONE).join('\u0000')
  const layout = useMemo(() => ('rows' in source ? source as LaneLayout<N> : layoutLanes(source as readonly N[], { order, direction, pin: pinKey ? pinKey.split('\u0000') : [], pinStart, palette, color, laneGroup, firstParentLanes })),
    [source, order, direction, pinKey, pinStart, palette, color, laneGroup, firstParentLanes])
  const count = layout.rows.length
  const [innerActive, setInnerActive] = useState(0)
  const active = Math.min(activeProp ?? innerActive, Math.max(0, count - 1))
  const setActive = useCallback((i: number) => { setInnerActive(i); onActiveChange?.(i) }, [onActiveChange])
  const [sel, setSel] = useControllable<string | readonly string[] | null>(selectedProp, defaultSelected, undefined)
  const selected = useMemo(() => new Set(sel == null ? [] : typeof sel === 'string' ? [sel] : sel), [sel])
  const select = useCallback((id: string | null) => {
    setSel(id)
    const r = id == null ? -1 : layout.rowOf(id)
    onSelect?.(id, r >= 0 ? layout.rows[r] : null)
  }, [setSel, onSelect, layout])
  const [innerHover, setInnerHover] = useState<number | null>(null)
  const hoveredRow = hovered == null ? -1 : layout.rowOf(hovered)
  const hover = hovered === undefined ? innerHover : hoveredRow >= 0 ? hoveredRow : null
  const reported = useRef<string | null>(null) // report changes only (a row's pointerenter and the list's pointerleave can repeat)
  const setHover = useCallback((i: number | null) => {
    setInnerHover(i)
    const id = i == null ? null : layout.rows[i]?.node.id ?? null
    if (id !== reported.current) { reported.current = id; onHoverChange?.(id) }
  }, [layout, onHoverChange])
  const [focused, setFocused] = useState(false)
  const lit = mode === 'none' ? null : hover ?? (focused ? active : null)
  const highlight = useMemo(() => (lit != null && lit < count ? laneAncestry(layout, lit) : null), [layout, lit, count])
  const target = useCallback((key: string, shift = false, page = 10): number | null => {
    const row = layout.rows[active]
    if (!count) return null
    const clamp = (i: number) => Math.max(0, Math.min(count - 1, i))
    switch (key) {
      case 'ArrowDown': return clamp(active + 1)
      case 'ArrowUp': return clamp(active - 1)
      case 'Home': return 0
      case 'End': return count - 1
      case 'PageDown': return clamp(active + page)
      case 'PageUp': return clamp(active - page)
      case 'ArrowLeft': {
        const ps = row.parents.filter(p => p >= 0)
        return (shift ? ps[1] ?? ps[0] : ps[0]) ?? null
      }
      case 'ArrowRight': {
        const kids = row.children, rows = layout.rows
        // prefer the child that continues this node's lane (its first parent is us), then any first-parent child
        const k = kids.find(c => rows[c].parents[0] === row.index && rows[c].lane === row.lane) ?? kids.find(c => rows[c].parents[0] === row.index) ?? kids[kids.length - 1]
        return (shift ? kids[0] : k) ?? null
      }
    }
    return null
  }, [layout, active, count])
  return { layout, active, setActive, selected, select, hover, setHover, focused, setFocused, highlight, target }
}

/** What a row knows about itself while rendering. */
export type LaneRowState = { active: boolean; selected: boolean; /** on the lit line */ lit: boolean; /** the line is lit and this row is not on it */ dimmed: boolean }

/** LaneGraph's imperative handle. */
export type LaneGraphHandle = {
  /** move the Tab stop (and focus, unless `focus: false`) to a row, scrolling it into view */
  goTo: (index: number, options?: { focus?: boolean; align?: 'auto' | 'center' | 'start' }) => void
  scrollToId: (id: string, align?: 'auto' | 'center' | 'start') => void
  focus: () => void
  element: HTMLDivElement | null
}

/** LaneGraph props: useLaneGraph's options, the rows, and the list around them. */
export type LaneGraphProps<N extends LaneNode = LaneNode> = LaneGraphOptions<N> & {
  /** the nodes (laid out with the options), or a layout you made with layoutLanes */ nodes: readonly N[] | LaneLayout<N>
  /** a row's content, beside its gutter */ renderRow: (row: LaneRow<N>, state: LaneRowState) => ReactNode
  /** px per row (default 32, 44 on touch), or 'auto': rows are as tall as their content (measured) */ rowHeight?: number | 'auto'
  /** first guess for 'auto' rows (px, or per row), refined as they render (default 72) */ estimateRowHeight?: number | ((row: LaneRow<N>) => number)
  /** px between lanes (default 14) */ laneWidth?: number
  /** where the node sits in an 'auto' row (default 16) */ nodeY?: number
  /** lanes from this index on fold into one dashed lane */ maxLanes?: number
  /** 'end': start at the bottom and stay there as rows arrive (a chat) */ anchor?: 'start' | 'end'
  /** arrow keys, Home/End and Page keys move along rows and edges (default true) */ keyboard?: boolean
  /** click or Enter on a row (default: select it); clicks on a control inside the row (a button, a link) don't count */ onActivate?: (row: LaneRow<N>, e: RMouseEvent | RKeyboardEvent) => void
  /** right-click, long-press, Shift+F10 or the Menu key on a row (open your menu; the event is the contextmenu event) */ onContextMenu?: (row: LaneRow<N>, e: RMouseEvent) => void
  /** runs before the built-in keys; call e.preventDefault() to handle a key yourself */ onKeyDown?: (e: RKeyboardEvent<HTMLDivElement>, row: LaneRow<N> | undefined) => void
  /** list height (px or CSS length, default 420) */ height?: number | string
  /** with a px `height`: a list shorter than that is only as tall as its rows (default true) */ fit?: boolean
  /** a sticky header row inside the scroller, `headerHeight` px tall */ header?: ReactNode; headerHeight?: number
  /** grid columns after the gutter (default one flexible column) */ columns?: string
  /** renderRow returns the row's cells itself (role="gridcell" each) instead of one cell's content */ cells?: boolean
  /** accessible name of a row */ rowLabel?: (row: LaneRow<N>) => string | undefined
  /** extra classes and data-* attributes of a row */ rowClassName?: (row: LaneRow<N>, state: LaneRowState) => string | undefined
  rowAttrs?: (row: LaneRow<N>) => Record<`data-${string}`, string | boolean | undefined> | undefined
  /** ring a row's node (HEAD, the current message) */ emphasis?: (row: LaneRow<N>) => boolean
  /** shown when there are no rows */ empty?: ReactNode
  /** min width of the rows (they then scroll sideways) */ contentMinWidth?: number
  /** ids to fade in (default: rows that weren't in the previous layout, when at most 500 arrive at once) */ fresh?: ReadonlySet<string> | null
  /** wraps the scroller element (e.g. in a ContextMenuTrigger asChild): keep it the direct child */ wrapScroller?: (scroller: ReactElement) => ReactNode
  className?: string; 'aria-label'?: string; ref?: Ref<LaneGraphHandle>
} & Pick<HTMLAttributes<HTMLDivElement>, 'aria-colcount' | 'aria-describedby'>

const LANE_NAV_KEYS = new Set(['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'PageUp', 'PageDown'])
const laneEditable = (t: EventTarget | null) => t instanceof Element && !!t.closest('input,textarea,select,[contenteditable="true"],[contenteditable=""]')
/** A control inside a row (its own button, link or field): clicking it doesn't also activate the row. */
const laneControl = (target: EventTarget | null, row: Element) => {
  const el = target instanceof Element ? target.closest('button,a[href],input,select,textarea,label,summary,[role=button],[role=switch],[role=checkbox],[role=menuitem],[role=tab]') : null
  return !!el && el !== row && row.contains(el)
}
const laneRowFrom = (target: EventTarget | null) => {
  const el = target instanceof Element ? target.closest('[role=row][data-index]') : null
  return el ? Number(el.getAttribute('data-index')) : -1
}

type LaneRowViewProps = {
  row: LaneRow<LaneNode>; start: number; height: number | undefined; columns: string; gutterWidth: number
  laneWidth: number; nodeY: number | undefined; cap: number; laneCount: number; palette: readonly string[]
  active: boolean; selected: boolean; fresh: boolean; highlight: Uint8Array | null; emphasis: boolean; cells: boolean; headerRows: number
  renderRow: (row: LaneRow<LaneNode>, state: LaneRowState) => ReactNode; label: string | undefined; extraClass: ((row: LaneRow<LaneNode>, state: LaneRowState) => string | undefined) | undefined
  attrs: Record<string, unknown> | undefined; measure: ((el: Element | null) => void | (() => void)) | undefined
  onRowClick: (i: number, e: RMouseEvent) => void; onHover: (i: number) => void
}

/** One row: the gutter cell and the content. Memoised: scrolling re-renders only rows whose props changed. */
const LaneRowView = memo(function LaneRowView({ row, start, height, columns, gutterWidth, laneWidth, nodeY, cap, laneCount, palette, active, selected, fresh, highlight, emphasis, cells, headerRows,
  renderRow, label, extraClass, attrs, measure, onRowClick, onHover }: LaneRowViewProps) {
  const lit = !!highlight?.[row.index]
  const state: LaneRowState = { active, selected, lit, dimmed: !!highlight && !lit }
  const content = renderRow(row, state)
  const inner = (
    <>
      <div role="gridcell" className="self-stretch overflow-hidden">
        <LaneGutter row={row} laneWidth={laneWidth} rowHeight={height} nodeY={nodeY} cap={cap} laneCount={laneCount} highlight={highlight} emphasis={emphasis} palette={palette} />
      </div>
      {cells ? content : <div role="gridcell" className="min-w-0">{content}</div>}
    </>
  )
  return (
    <div role="row" data-index={row.index} aria-rowindex={row.index + 1 + headerRows} aria-selected={selected} aria-label={label} tabIndex={active ? 0 : -1} ref={measure} {...attrs}
      className={cn('group absolute inset-x-0 top-0 grid cursor-default outline-none focus-visible:shadow-[inset_0_0_0_2px_var(--accent)]',
        height ? 'items-center [contain:strict]' : 'items-stretch [contain:layout_paint]', selected ? 'bg-[var(--accent-soft)]' : 'hover:bg-[var(--muted)]', extraClass?.(row, state))}
      style={{ height, transform: `translateY(${start}px)`, gridTemplateColumns: `${gutterWidth}px ${columns}` }}
      onClick={e => { if (!laneControl(e.target, e.currentTarget)) onRowClick(row.index, e) }} onPointerEnter={e => { if (e.pointerType === 'mouse') onHover(row.index) }}>
      {fresh ? <motion.div className="contents" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.4 }}>{inner}</motion.div> : inner}
    </div>
  )
})

/**
 * A graph drawn as a list: each node is a row with your content (`renderRow`) beside a gutter showing the lanes and
 * edges (LaneGutter), virtualised (100k rows render ~40). Rows are a fixed `rowHeight`, or 'auto' to be as tall as
 * their content (chat messages, cards), measured as they render. Click or Enter selects (`onActivate` to do more);
 * hover or focus lights the row's first-parent line and dims the rest (`hovered` + `onHoverChange` drive the hover from
 * outside, e.g. code that points at a node). Keys: ↑/↓, Home/End, PageUp/Down; ← goes to
 * the parent (Shift: the second parent), → to the child (Shift: another child). Right-click, long-press, Shift+F10 or the Menu key call `onContextMenu`. Rows inserted above
 * keep the reader's place and fade in; `anchor="end"` keeps a chat-like list at its bottom.
 *
 *   <LaneGraph nodes={tasks} order="topo" rowHeight="auto" renderRow={row => <TaskCard task={row.node} />} />
 */
export function LaneGraph<N extends LaneNode>(props: LaneGraphProps<N>) {
  const { nodes, renderRow, rowHeight: rowHeightProp, estimateRowHeight = 72, laneWidth = 14, nodeY, maxLanes, anchor = 'start', keyboard = true, onActivate, onContextMenu, onKeyDown,
    height = 420, fit = true, header, headerHeight = 0, columns = 'minmax(0,1fr)', cells = false, rowLabel, rowClassName, rowAttrs, emphasis, empty, contentMinWidth, fresh: freshProp, wrapScroller,
    className, 'aria-label': ariaLabel, ref, ...rest } = props
  const { 'aria-colcount': colCount, 'aria-describedby': describedBy } = rest
  const g = useLaneGraph(nodes, props)
  const { layout, active, setActive, selected, select, highlight, target, setHover, setFocused } = g
  const { rows } = layout, count = rows.length
  const coarse = useCoarsePointer()
  const auto = rowHeightProp === 'auto', fixedH = auto ? undefined : rowHeightProp ?? (coarse ? 44 : 32)
  const cap = maxLanes ?? Infinity, gutterWidth = laneGutterWidth(layout.laneCount, laneWidth, cap)

  /* virtual list */
  const scrollRef = useRef<HTMLDivElement>(null)
  const keep = useMemo(() => (count ? [active] : []), [active, count])
  const getItemKey = useCallback((i: number) => rows[i]?.node.id ?? i, [rows])
  const estimate = useMemo(() => (fixedH ?? (typeof estimateRowHeight === 'number' ? estimateRowHeight : (i: number) => estimateRowHeight(rows[i]))), [fixedH, estimateRowHeight, rows])
  const v = useVirtual({ count, estimateSize: estimate, scrollRef, paddingStart: headerHeight, scrollPaddingStart: headerHeight, overscan: auto ? 4 : 8, keep, getItemKey, anchor })

  /* moving the Tab stop: scroll, then focus the row once it has rendered */
  const pendingFocus = useRef<number | null>(null)
  const goTo = useCallback((i: number, { focus = true, align = 'auto' as 'auto' | 'center' | 'start' } = {}) => {
    if (!count) return
    const k = Math.max(0, Math.min(count - 1, i))
    setActive(k)
    v.scrollToIndex(k, { align })
    if (focus) pendingFocus.current = k
  }, [count, setActive, v.scrollToIndex]) // eslint-disable-line react-hooks/exhaustive-deps
  useLayoutEffect(() => {
    const k = pendingFocus.current
    if (k == null) return
    const el = scrollRef.current?.querySelector<HTMLElement>(`[role=row][data-index="${k}"]`)
    if (el) { el.focus({ preventScroll: true }); pendingFocus.current = null }
  })
  useImperativeHandle(ref, () => ({
    goTo, focus: () => goTo(active),
    scrollToId: (id, align = 'center') => { const i = layout.rowOf(id); if (i >= 0) goTo(i, { focus: false, align }) },
    get element() { return scrollRef.current },
  }), [goTo, active, layout])

  /* live inserts: rows added above keep the reader's place (anchor 'start'; useVirtual does it for 'end'), and fade in */
  const seen = useRef<{ layout: LaneLayout<N>; items: typeof v.items } | null>(null)
  const [fresh, setFresh] = useState<ReadonlySet<string> | null>(null)
  const freshTimer = useRef<ReturnType<typeof setTimeout>>(undefined)
  useEffect(() => () => clearTimeout(freshTimer.current), [])
  useLayoutEffect(() => {
    const prev = seen.current, el = scrollRef.current
    seen.current = { layout, items: v.items }
    if (!prev || prev.layout === layout) return
    // fade in what is new (a handful at a time: a whole new data set just appears)
    const added = freshProp === undefined ? layout.rows.filter(r => prev.layout.rowOf(r.node.id) < 0) : []
    if (freshProp === undefined && added.length && added.length <= 500 && prev.layout.rows.length) {
      setFresh(new Set(added.map(r => r.node.id)))
      clearTimeout(freshTimer.current); freshTimer.current = setTimeout(() => setFresh(null), 1200)
    }
    if (anchor === 'end' || !el || el.scrollTop <= 0) return
    // the row at the top of the view before the change, and how far into it the reader was
    const top = el.scrollTop + headerHeight
    const was = prev.items.find(it => it.start <= top && it.end > top)
    const id = was && prev.layout.rows[was.index]?.node.id, now = id ? layout.rowOf(id) : -1
    if (!was || now < 0 || now === was.index) return
    // getOffsetForIndex(…, 'start') puts the row just under the header: add back how far into it the reader was
    const at = (v.getOffsetForIndex(now, 'start') ?? 0) + (top - was.start)
    if (Math.abs(at - el.scrollTop) > 0.5) v.scrollToOffset(at)
  }, [layout]) // eslint-disable-line react-hooks/exhaustive-deps
  if (seen.current?.layout === layout) seen.current.items = v.items

  /* pointer and keys */
  const onRowClick = useCallback((i: number, e: RMouseEvent) => {
    const row = rows[i]; if (!row) return
    setActive(i)
    if (onActivate) onActivate(row, e); else select(row.node.id)
  }, [rows, setActive, onActivate, select])
  const onHover = useCallback((i: number) => setHover(i), [setHover])
  const handleKey = (e: RKeyboardEvent<HTMLDivElement>) => {
    onKeyDown?.(e, rows[active])
    if (e.defaultPrevented || !keyboard || laneEditable(e.target) || e.altKey || e.ctrlKey || e.metaKey) return
    const stop = () => { e.preventDefault(); e.stopPropagation() }
    if (e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10')) { // open the row's menu where the row is
      stop()
      const el = scrollRef.current?.querySelector<HTMLElement>(`[role=row][data-index="${active}"]`)
      if (el) { const b = el.getBoundingClientRect(); el.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: b.left + Math.min(b.width / 2, 240), clientY: b.top + Math.min(b.height / 2, 24) })) }
      return
    }
    if (e.key === 'Enter') { const row = rows[active]; if (row) { stop(); if (onActivate) onActivate(row, e); else select(row.node.id) } return }
    if (e.key === 'Escape') { if (selected.size) { stop(); select(null) } return }
    const page = Math.max(1, Math.floor((v.viewportSize - headerHeight) / (fixedH ?? (typeof estimateRowHeight === 'number' ? estimateRowHeight : 72))) - 1)
    const to = target(e.key, e.shiftKey, page)
    // a navigation key with nowhere to go (← on a root) is still consumed
    if (to == null && !LANE_NAV_KEYS.has(e.key)) return
    stop()
    if (to != null) goTo(to)
  }

  // a short list ends at its last row instead of leaving a blank box below it (with an empty list, room for `empty`)
  const boxHeight = fit && typeof height === 'number' ? Math.min(height, Math.max(v.totalSize + (contentMinWidth ? 12 : 0), count ? 0 : 96)) : height
  const scroller = (
    <div ref={scrollRef} role="grid" tabIndex={-1} aria-label={ariaLabel ?? 'Graph'} aria-rowcount={count + (header ? 1 : 0)} aria-colcount={colCount} aria-describedby={describedBy} aria-multiselectable={false}
      className="relative min-w-0 flex-1 overflow-auto overscroll-contain outline-none [contain:strict] [scrollbar-width:thin]" style={{ height: boxHeight }}
      onKeyDown={handleKey}
      onFocus={e => { setFocused(true); if (e.target === e.currentTarget) goTo(active); else { const i = laneRowFrom(e.target); if (i >= 0 && i !== active) setActive(i) } }}
      onBlur={e => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setFocused(false) }}
      onPointerLeave={() => setHover(null)}
      onPointerDown={e => { const i = laneRowFrom(e.target); if (i >= 0 && e.pointerType !== 'mouse') setActive(i) }}
      onContextMenu={e => {
        const i = laneRowFrom(e.target)
        if (i < 0) { e.preventDefault(); return } // the header or empty space: no menu
        setActive(i)
        onContextMenu?.(rows[i], e)
      }}>
      <div style={{ height: v.totalSize, position: 'relative', minWidth: contentMinWidth }}>
        {header && <div role="rowgroup" className="sticky top-0 z-[2] border-b border-[var(--line)] bg-[var(--card)]" style={{ height: headerHeight }}>{header}</div>}
        <div role="rowgroup">
          {v.items.map(it => {
            const row = rows[it.index] as LaneRow<LaneNode>
            return (
              <LaneRowView key={it.key} row={row} start={it.start} height={fixedH} columns={columns} gutterWidth={gutterWidth} laneWidth={laneWidth} nodeY={nodeY} cap={cap}
                laneCount={layout.laneCount} palette={layout.palette} active={it.index === active} selected={selected.has(row.node.id)} fresh={!!(freshProp === undefined ? fresh : freshProp)?.has(row.node.id)}
                highlight={highlight} emphasis={!!emphasis?.(rows[it.index])} cells={cells} headerRows={header ? 1 : 0}
                renderRow={renderRow as LaneRowViewProps['renderRow']} label={rowLabel?.(rows[it.index])} extraClass={rowClassName as LaneRowViewProps['extraClass']}
                attrs={rowAttrs?.(rows[it.index])} measure={auto ? v.measureElement : undefined} onRowClick={onRowClick} onHover={onHover} />
            )
          })}
        </div>
        {!count && empty}
      </div>
    </div>
  )
  return <div className={cn('flex min-w-0', className)}>{wrapScroller ? wrapScroller(scroller) : scroller}</div>
}
