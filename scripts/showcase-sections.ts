// The showcase's section files and the cards (<Spec title>) in them, read from the source. Shared by the docs data
// (scripts/build-docs-data.mjs: which cards demonstrate each registry item), the view-code drawer
// (scripts/showcase-code.ts) and the server-render check (scripts/ssr-check.mjs).
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import type { DocsDemo } from './docs-data.mjs'

/** Skip a `{…}` expression starting at `i` (strings and template literals inside are skipped whole). Returns the index after `}`. */
export function codeSkipBraces(s: string, i: number) {
  let depth = 0
  for (; i < s.length; i++) {
    const c = s[i]
    if (c === '"' || c === "'" || c === '`') { const q = c; for (i++; i < s.length && s[i] !== q; i++) if (s[i] === '\\') i++; continue }
    if (c === '{') depth++
    else if (c === '}' && --depth === 0) return i + 1
  }
  return s.length
}

/** End of a JSX opening tag whose attributes start at `i`: index after `>`, and whether it was `/>`. */
export function codeTagEnd(s: string, i: number) {
  for (; i < s.length; i++) {
    const c = s[i]
    if (c === '"' || c === "'") { const q = c; for (i++; i < s.length && s[i] !== q; i++); continue }
    if (c === '{') { i = codeSkipBraces(s, i) - 1; continue }
    if (c === '>') return { end: i + 1, self: s[i - 1] === '/' }
  }
  return { end: s.length, self: true }
}

/** The `title` of a JSX opening tag: `"…"`, `{'…'}`, `{"…"}` or a template literal without placeholders. */
export const codeTitleOf = (tag: string) => {
  const m = tag.match(/\btitle=(?:"([^"]*)"|\{\s*'([^']*)'\s*\}|\{\s*"([^"]*)"\s*\}|\{\s*`([^`$]*)`\s*\})/)
  return m ? (m[1] ?? m[2] ?? m[3] ?? m[4]) : null
}

/** A showcase card: its title, where its `<Spec>` starts and ends in the file, and its children. */
export type SpecCard = { title: string; at: number; end: number; inner: string }

/** Every titled `<Spec>` in `src`, nested ones included (nesting is tracked so the right `</Spec>` closes each). */
export function codeSpecs(src: string): SpecCard[] {
  const out: SpecCard[] = []
  const open = /<Spec\b/g
  for (let m = open.exec(src); m; m = open.exec(src)) {
    const tag = codeTagEnd(src, m.index + 5)
    const title = codeTitleOf(src.slice(m.index, tag.end))
    if (title === null) continue
    if (tag.self) { out.push({ title, at: m.index, end: tag.end, inner: '' }); continue }
    const tok = /<Spec\b|<\/Spec\s*>/g
    tok.lastIndex = tag.end
    for (let t = tok.exec(src), depth = 1; t; t = tok.exec(src)) {
      if (!t[0].startsWith('</')) { const inner = codeTagEnd(src, t.index + 5); if (!inner.self) depth++; tok.lastIndex = inner.end; continue }
      if (--depth === 0) { out.push({ title, at: m.index, end: t.index + t[0].length, inner: src.slice(tag.end, t.index) }); break }
    }
  }
  return out
}

/** The card titled `title` in `src`, or null. */
export const codeFindSpec = (src: string, title: string) => codeSpecs(src).find(s => s.title === title) ?? null

/** A section file: its id (`<Section id>`), the component it exports, its source and every card in the file. */
export type ShowcaseSection = { file: string; id: string; exportName: string; source: string; specs: SpecCard[] }

/** The section files of the showcase (`src/showcase/*Section.tsx`), sorted. */
export const showcaseSectionFiles = (root: string) => readdirSync(join(root, 'src/showcase')).filter(f => /Section\.tsx$/.test(f)).sort()

/**
 * Every showcase section with every card its file renders, including cards inside the file's helper components
 * (<ChartsLiveSparks/> renders "Sparklines"): the page mounts the whole section, so all of them belong to it.
 */
export function showcaseSections(root: string): ShowcaseSection[] {
  return showcaseSectionFiles(root).map(f => {
    const source = readFileSync(join(root, 'src/showcase', f), 'utf8')
    const id = /<Section\s+id="([\w-]+)"/.exec(source)?.[1], exportName = /export function (\w+Section)\b/.exec(source)?.[1]
    if (!id || !exportName) throw new Error(`src/showcase/${f}: no <Section id="…"> or exported …Section component`)
    return { file: f.replace(/\.tsx$/, ''), id, exportName, source, specs: codeSpecs(source) }
  })
}

type DemoItem = { name: string; title: string; exports: readonly string[] }
type DemoCards = Readonly<Record<string, { items: readonly string[] }>>

/**
 * Which cards demonstrate each item. The cards the tag vocabulary (`cards`, TAG_CARDS) names for an item win: those
 * about it (it is listed first) before any that show it. An item no card names falls back to the cards that render
 * its exports, directly or through a helper component of the same file. One section per item, up to three cards.
 * `unknownCards` lists vocabulary titles that match no card in any section.
 */
export function docsDemos(items: readonly DemoItem[], sections: readonly ShowcaseSection[], cards: DemoCards): { demos: Record<string, DocsDemo>; unknownCards: string[] } {
  const sectionOf = new Map(sections.flatMap(s => s.specs.map(sp => [sp.title, s] as const)))
  const demoOf = (s: ShowcaseSection, titles: string[]): DocsDemo => ({ section: s.id, file: s.file, exportName: s.exportName, titles })
  const scored = sections.flatMap(s => {
    // top-level blocks of the file: helper components (function X / const X =) and the section itself
    const helpers = new Map<string, string>()
    for (const b of s.source.split(/\n(?=(?:export )?(?:function|const) \w)/)) { const n = /^(?:export )?(?:function|const) (\w+)/.exec(b)?.[1]; if (n) helpers.set(n, b) }
    const tagsOf = (src: string, depth = 0, seen = new Set<string>()): Set<string> => {
      const tags = new Set([...src.matchAll(/<([A-Z]\w*)/g)].map(m => m[1]))
      for (const m of src.matchAll(/\b([a-z]\w*|[A-Z]\w*)\(/g)) tags.add(m[1]) // hooks and helpers called (useToast(), confetti())
      if (depth < 3) for (const t of [...tags]) if (helpers.has(t) && !seen.has(t)) { seen.add(t); tagsOf(helpers.get(t)!, depth + 1, seen).forEach(x => tags.add(x)) }
      return tags
    }
    return s.specs.map(sp => ({ s, title: sp.title, direct: new Set([...sp.inner.matchAll(/<([A-Z]\w*)/g)].map(m => m[1])), tags: tagsOf(sp.inner) }))
  })
  const demos: Record<string, DocsDemo> = {}
  for (const it of items) {
    const tagged = Object.entries(cards).filter(([t, c]) => c.items.includes(it.name) && sectionOf.has(t))
    const about = tagged.filter(([, c]) => c.items[0] === it.name), pick = about.length ? about : tagged
    if (pick.length) {
      const s = sectionOf.get(pick[0][0])! // one section per page (it is mounted once)
      demos[it.name] = demoOf(s, pick.filter(([t]) => sectionOf.get(t) === s).slice(0, 3).map(([t]) => t))
      continue
    }
    const own = it.title.toLowerCase(), words = own.split(/\s+/)
    const ranked = scored.flatMap(sp => {
      let score = 0
      for (const r of it.exports) { if (sp.direct.has(r)) score += 3; else if (sp.tags.has(r)) score += 1 }
      const t = sp.title.toLowerCase()
      if (t === own || t === `${own}s`) score += 12 // a card named after the item wins, even when it calls the API through an alias (toast())
      else if (!score) return []
      else if (words.every(w => t.includes(w))) score += 4
      return [{ ...sp, score }]
    }).sort((a, b) => b.score - a.score)
    // one section per page, and only cards that use the item about as much as the best one does
    const best = ranked.filter(x => x.s === ranked[0]?.s && x.score * 2 >= ranked[0].score).slice(0, 3)
    if (best.length) demos[it.name] = demoOf(best[0].s, best.map(b => b.title))
  }
  return { demos, unknownCards: Object.keys(cards).filter(t => !sectionOf.has(t)) }
}
