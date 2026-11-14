import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode, type KeyboardEvent as RKeyboardEvent, type RefObject } from 'react'
import { AnimatePresence, motion } from './motionkit'
import { Avatar, Button, Icon, type IconName, Spinner, TEXT_LINK_SCHEMES, clamp, cn, formatHotkey, inputClass, isCoarsePointer, safeUrl, spring, useGeneration, useLatest, useLatestState, useOutside, useRoving, plural, resolveColor, useResizeObserver, useListbox, useThemeVersion, gridKeyMove } from './core'
import { play, shake } from './motion'
import { FloatingPanel, MenuLabel } from './overlay'
import { OptionList } from './select'
import { type Option } from './fields'

const EditorGlyph = ({ d }: { d: IconName }) => <Icon name={d} size={15} />

/** The commands RichTextEditor's toolbar, bubble, shortcuts and Markdown shortcuts run. */
type RteCmd = 'bold' | 'italic' | 'underline' | 'strikeThrough' | 'h2' | 'h3' | 'p' | 'insertUnorderedList' | 'insertOrderedList' | 'blockquote' | 'code' | 'link'
/**
 * A toolbar tool. `kind`: 'exec' runs execCommand and reads queryCommandState; 'block' toggles formatBlock to `cmd`;
 * 'custom' has its own handler. A tool with a `tag` is on while the caret is inside that element. `block`: a block format
 * (Paragraph is on when none is). `shortcut`: the key with ⌘/Ctrl. `bubble`: also in the selection bubble.
 * `name`: accessible name when it differs from `label` (it must start with the visible glyph text).
 */
type RteTool = { cmd: RteCmd; kind: 'exec' | 'block' | 'custom'; tag?: string; block?: boolean; label: string; glyph: ReactNode; shortcut?: string; bubble?: boolean; name?: string }
// the B / I / U / S / H1 / H2 / ¶ glyphs are the formatting marks themselves, the same in every language
const RTE_TOOLS: (RteTool | '|')[] = [
  { cmd: 'bold', kind: 'exec', label: 'Bold', glyph: <b>B</b>, shortcut: 'b', bubble: true }, { cmd: 'italic', kind: 'exec', label: 'Italic', glyph: <i className="font-serif">I</i>, shortcut: 'i', bubble: true },
  { cmd: 'underline', kind: 'exec', label: 'Underline', glyph: <u>U</u>, shortcut: 'u', bubble: true }, { cmd: 'strikeThrough', kind: 'exec', label: 'Strikethrough', glyph: <s>S</s> }, '|',
  { cmd: 'h2', kind: 'block', tag: 'H2', block: true, label: 'Heading 1', name: 'H1 heading', glyph: 'H1' }, { cmd: 'h3', kind: 'block', tag: 'H3', block: true, label: 'Heading 2', name: 'H2 heading', glyph: 'H2' },
  { cmd: 'p', kind: 'block', block: true, label: 'Paragraph', glyph: '¶' }, '|',
  { cmd: 'insertUnorderedList', kind: 'exec', block: true, label: 'Bulleted list', glyph: <EditorGlyph d="listBullet" /> }, { cmd: 'insertOrderedList', kind: 'exec', block: true, label: 'Numbered list', glyph: <EditorGlyph d="listOrdered" /> },
  { cmd: 'blockquote', kind: 'block', tag: 'BLOCKQUOTE', block: true, label: 'Quote', glyph: <EditorGlyph d="quote" /> }, { cmd: 'code', kind: 'custom', tag: 'CODE', label: 'Inline code', glyph: <EditorGlyph d="code" /> },
  { cmd: 'link', kind: 'custom', tag: 'A', label: 'Link', glyph: <EditorGlyph d="link" />, shortcut: 'k', bubble: true },
]
const RTE_LIST = RTE_TOOLS.filter((x): x is RteTool => x !== '|')
const RTE_SHORTCUTS: Record<string, RteCmd> = Object.fromEntries(RTE_LIST.filter(t => t.shortcut).map(t => [t.shortcut, t.cmd]))
const RTE_MD: Record<string, RteCmd> = { '#': 'h2', '##': 'h3', '-': 'insertUnorderedList', '*': 'insertUnorderedList', '1.': 'insertOrderedList', '>': 'blockquote' }
/** Half the width the selection bubble and the link field need: they stay this far from the editor's edges. */
const RTE_BUBBLE_HALF = 90, RTE_LINK_HALF = 130
const rteContent =
  'min-h-[200px] px-4 py-4 text-sm leading-[1.7] outline-none [@media(pointer:coarse)]:text-base [&_a]:text-[var(--accent)] [&_a]:underline ' +
  '[&_blockquote]:m-0 [&_blockquote]:mb-2.5 [&_blockquote]:rounded-[var(--r-md)] [&_blockquote]:bg-[var(--muted)] [&_blockquote]:px-3 [&_blockquote]:py-2 [&_blockquote]:text-[var(--fg2)] [&_blockquote]:italic ' +
  '[&_code]:rounded-[var(--r-sm)] [&_code]:bg-[var(--muted)] [&_code]:px-1 [&_code]:font-[family-name:var(--mono)] [&_code]:text-xs ' +
  '[&_h2]:m-0 [&_h2]:mb-2 [&_h2]:text-[22px] [&_h2]:font-semibold [&_h2]:tracking-tight [&_h3]:mt-3 [&_h3]:mb-1.5 [&_h3]:text-base [&_h3]:font-semibold ' +
  '[&_ol]:m-0 [&_ol]:mb-2.5 [&_ol]:list-decimal [&_ol]:ps-5 [&_p]:m-0 [&_p]:mb-2.5 [&_ul]:m-0 [&_ul]:mb-2.5 [&_ul]:list-disc [&_ul]:ps-5'

/* Sanitizer: one allowlist for everything that becomes editor HTML (defaultValue, drops, onChange output) ── */

/** Elements kept as they are. Everything else is unwrapped (its text stays) or, for RTE_DROP, removed with its content. */
const RTE_TAGS = new Set(['P', 'H2', 'H3', 'UL', 'OL', 'LI', 'B', 'STRONG', 'I', 'EM', 'U', 'S', 'CODE', 'PRE', 'BLOCKQUOTE', 'A', 'BR'])
/** Equivalent elements browsers (and pasted documents) produce, mapped onto the allowlist. */
const RTE_ALIAS: Record<string, string> = { STRIKE: 'S', DEL: 'S', INS: 'U', DIV: 'P', H1: 'H2', H4: 'H3', H5: 'H3', H6: 'H3' }
/** Elements whose content is code, form controls or embedded documents, never text a person wrote. */
const RTE_DROP = new Set(['SCRIPT', 'STYLE', 'TEMPLATE', 'NOSCRIPT', 'IFRAME', 'FRAME', 'FRAMESET', 'OBJECT', 'EMBED', 'SVG', 'MATH', 'TEXTAREA', 'SELECT', 'OPTION', 'TITLE', 'HEAD', 'META', 'LINK', 'XMP', 'NOEMBED', 'NOFRAMES', 'PLAINTEXT'])
const rteEscape = (s: string) => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)

/**
 * Sanitize HTML for RichTextEditor with a fixed allowlist: p, h2, h3, ul, ol, li, b/strong, i/em, u, s, code, pre,
 * blockquote, a and br. The only attribute kept is `href` on links (https, http, mailto, tel or relative; anything else
 * unwraps the link). Comments, scripts, styles, frames and form controls are removed; other elements are unwrapped
 * and keep their text. Parses with an inert DOMParser document (nothing loads or runs); without a DOM (SSR) the
 * input is escaped to plain text.
 */
export function sanitizeRichText(html: string): string {
  if (typeof DOMParser === 'undefined') return rteEscape(String(html ?? ''))
  const doc = new DOMParser().parseFromString(String(html ?? ''), 'text/html')
  const out = doc.createElement('div')
  const copy = (from: Node, to: Node, depth: number) => {
    for (let c = from.firstChild; c; c = c.nextSibling) {
      if (c.nodeType === 3) { to.appendChild(doc.createTextNode(c.nodeValue ?? '')); continue }
      if (c.nodeType !== 1) continue // comments, processing instructions, CDATA
      const tag = (c as Element).tagName.toUpperCase()
      if (RTE_DROP.has(tag)) continue
      const name = RTE_ALIAS[tag] ?? tag
      if (depth > 64) { to.appendChild(doc.createTextNode(c.textContent ?? '')); continue } // absurd nesting: keep the text
      if (!RTE_TAGS.has(name)) { copy(c, to, depth + 1); continue }
      let el: Element | null = doc.createElement(name.toLowerCase())
      if (name === 'A') {
        const href = safeUrl((c as Element).getAttribute('href'), { allow: TEXT_LINK_SCHEMES, fallback: '' })
        if (href) el.setAttribute('href', href); else el = null
      }
      if (!el) { copy(c, to, depth + 1); continue }
      if (name !== 'BR') copy(c, el, depth + 1)
      to.appendChild(el)
    }
  }
  copy(doc.body, out, 0)
  return out.innerHTML
}

/** Where a drop lands: a collapsed range at the point (caretPositionFromPoint, or WebKit's caretRangeFromPoint). */
function editorRangeAt(x: number, y: number): Range | null {
  const d = document as Document & { caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null; caretRangeFromPoint?: (x: number, y: number) => Range | null }
  const p = d.caretPositionFromPoint?.(x, y)
  if (p) { const r = document.createRange(); r.setStart(p.offsetNode, p.offset); r.collapse(true); return r }
  return d.caretRangeFromPoint?.(x, y) ?? null
}
/** beforeinput types that bring outside content in; handled by the component instead of the browser. */
const EDITOR_FOREIGN_INPUT = ['insertFromDrop', 'insertFromPaste', 'insertFromPasteAsQuotation', 'insertFromYank']
/** A beforeinput target range as a live Range. */
function staticToRange(r: StaticRange | undefined): Range | null {
  if (!r) return null
  const at = document.createRange(); at.setStart(r.startContainer, r.startOffset); at.setEnd(r.endContainer, r.endOffset)
  return at
}
/**
 * Takes over drops and pastes that reach a contentEditable without the React handlers (native beforeinput): `insert`
 * gets the data, where it lands and the input type. `skip` leaves one to the browser.
 */
function useForeignInput(ref: RefObject<HTMLElement | null>, insert: (data: DataTransfer | null, at: Range | null, type: string) => void, skip?: (type: string) => boolean) {
  const cb = useLatest({ insert, skip })
  useEffect(() => {
    const el = ref.current; if (!el) return
    const before = (e: InputEvent) => {
      if (!EDITOR_FOREIGN_INPUT.includes(e.inputType) || cb.current.skip?.(e.inputType)) return
      e.preventDefault()
      cb.current.insert(e.dataTransfer, staticToRange(e.getTargetRanges?.()[0]), e.inputType)
    }
    el.addEventListener('beforeinput', before)
    return () => el.removeEventListener('beforeinput', before)
  }, [ref, cb])
}

/**
 * The href a typed link gets: kept when it is relative (`/docs`, `#top`, `?q`, `./x`) or uses a text link scheme
 * (https, http, mailto, tel); anything else, such as `example.com`, gets `https://` in front.
 */
export function richTextHref(url: string): string {
  const u = url.trim()
  if (/^[/#?.]/.test(u) || (/^[a-z][a-z0-9+.-]*:/i.test(u) && safeUrl(u, { allow: TEXT_LINK_SCHEMES, fallback: '' }))) return u
  return `https://${u}`
}

/** RichTextEditor's save indicator: nothing ('idle'), "Saving…", "Saved" or "Couldn’t save". */
export type RichTextSaveState = 'idle' | 'saving' | 'saved' | 'error'
const RTE_SAVE_TEXT = { saving: 'Saving…', saved: 'Saved', error: 'Couldn’t save' } as const

/**
 * Rich text editor on contentEditable. Toolbar buttons light up for the formatting under the caret; selecting text shows a
 * floating bubble (bold, italic, underline, link). ⌘B / ⌘I / ⌘U / ⌘K work, and at the start of a line "# ", "## ", "- ",
 * "1. " and "> " turn into headings, lists and quotes. The footer counts words and read time.
 * `onChange` receives the HTML (debounced; a pending change is handed over when the editor unmounts). The footer says
 * "Saved" only when a save was confirmed: return a Promise from `onChange` ("Saving…", then "Saved" when it resolves or
 * "Couldn’t save" when it rejects), or drive the indicator yourself with `saveState`. A plain `onChange` shows none.
 * Everything that becomes HTML (`defaultValue`, dropped content, the `onChange` output) goes through `sanitize`
 * (default `sanitizeRichText`; pass DOMPurify with your own config if you need more). Paste inserts plain text.
 */
export function RichTextEditor({ defaultValue = '', placeholder: placeholderProp, onChange, saveState, sanitize = sanitizeRichText, className, 'aria-label': ariaLabelProp }:
  { defaultValue?: string; placeholder?: string; onChange?: (html: string) => void | Promise<unknown>; saveState?: RichTextSaveState; sanitize?: (html: string) => string; className?: string; 'aria-label'?: string }) {
  const host = useRef<HTMLDivElement>(null), body = useRef<HTMLDivElement>(null), bar = useRef<HTMLDivElement>(null)
  const placeholder = placeholderProp ?? 'Start writing… type # for a heading, - for a list', ariaLabel = ariaLabelProp ?? 'Editor'
  const saved = useRef<Range | null>(null)
  const [active, setActive] = useState<RteCmd[]>([])
  const [bubble, setBubble] = useState<{ x: number; y: number; below?: boolean } | null>(null)
  const [link, setLink] = useState<string | null>(null) // URL being typed in the bubble
  const [words, setWords] = useState(0)
  const [empty, setEmpty] = useState(!defaultValue)
  const isEmpty = () => { const b = body.current; return !b || (!b.innerText.trim() && !b.querySelector('li,h2,h3,blockquote,pre')) }
  const [ownSave, setOwnSave] = useState<RichTextSaveState>('idle')
  const save = saveState ?? ownSave
  const saveSeq = useRef(0) // bumped by every edit: a save result for older text is ignored
  const [tab, setTab] = useState(0) // roving tab stop in the toolbar
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)
  const pending = useRef<string | null>(null) // HTML not yet handed to onChange
  const notify = useLatest(onChange), clean = useLatest(sanitize)
  const ownDrag = useRef(false) // a drag that started inside the editor (moving its own text) stays native
  const linkOpen = useRef(false)
  useEffect(() => { linkOpen.current = link !== null }, [link])
  const separator = useRef('') // the page's paragraph separator, restored when the editor loses focus

  const count = () => (body.current?.innerText.trim().match(/\S+/g) || []).length
  useLayoutEffect(() => { if (body.current) { body.current.innerHTML = clean.current(defaultValue); setWords(count()); setEmpty(isEmpty()) } }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const inside = (n: Node | null) => !!n && !!body.current?.contains(n)
  const closest = (tag: string) => {
    let n: Node | null = getSelection()?.anchorNode ?? null
    for (; n && n !== body.current; n = n.parentNode) if (n.nodeType === 1 && (n as Element).tagName === tag) return n as HTMLElement
    return null
  }
  /** Where a bubble `half` px wide goes for a selection rect: above it, or below on touch (the OS menu sits above). */
  const bubbleAt = (r: DOMRect, half: number) => {
    const h = host.current!.getBoundingClientRect(), below = isCoarsePointer()
    return { x: clamp(r.left - h.left + r.width / 2, half, h.width - half), y: below ? (r.bottom || h.top + 60) - h.top + 10 : (r.top || h.top + 60) - h.top - 8, below }
  }
  const sync = () => {
    const s = getSelection()
    if (!s?.rangeCount || !inside(s.anchorNode)) { if (!linkOpen.current) setBubble(null); return }
    saved.current = s.getRangeAt(0).cloneRange()
    const on = RTE_LIST.filter(t => t.kind === 'exec' ? (() => { try { return document.queryCommandState(t.cmd) } catch { return false } })() : !!t.tag && !!closest(t.tag))
    setActive([...on.map(t => t.cmd), ...(on.some(t => t.block) ? [] : ['p' as const])])
    if (linkOpen.current) return
    if (s.isCollapsed) return setBubble(null)
    setBubble(bubbleAt(s.getRangeAt(0).getBoundingClientRect(), RTE_BUBBLE_HALF))
  }
  useEffect(() => {
    document.addEventListener('selectionchange', sync)
    return () => document.removeEventListener('selectionchange', sync)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps
  /** Hand the HTML to onChange; a Promise it returns drives the save indicator. */
  const deliver = (html: string) => {
    const seq = saveSeq.current, r = notify.current?.(clean.current(html))
    if (!r || typeof r.then !== 'function') return
    setOwnSave('saving')
    r.then(() => { if (seq === saveSeq.current) setOwnSave('saved') }, () => { if (seq === saveSeq.current) setOwnSave('error') })
  }
  const changed = () => {
    setWords(count()); setEmpty(isEmpty()); clearTimeout(timer.current)
    saveSeq.current++; setOwnSave('idle')
    pending.current = body.current?.innerHTML ?? ''
    timer.current = setTimeout(() => { const html = pending.current; pending.current = null; if (html !== null) deliver(html) }, 700)
  }
  useEffect(() => () => { clearTimeout(timer.current); if (pending.current !== null) notify.current?.(clean.current(pending.current)) }, []) // eslint-disable-line react-hooks/exhaustive-deps -- don't drop the last edit
  /** Insert outside content at `at` (or the caret): sanitized HTML when there is any, else plain text. */
  const insertForeign = (data: DataTransfer | null, at: Range | null) => {
    const el = body.current, s = getSelection(); if (!el || !s || !data) return
    if (at && el.contains(at.startContainer)) { s.removeAllRanges(); s.addRange(at) }
    if (!s.rangeCount || !inside(s.anchorNode)) return
    const html = data.getData('text/html'), text = data.getData('text/plain')
    const safe = html ? clean.current(html) : ''
    if (safe.trim()) { if (!document.execCommand('insertHTML', false, safe)) { const t = document.createElement('template'); t.innerHTML = safe; const r = s.getRangeAt(0); r.deleteContents(); r.insertNode(t.content) } }
    else if (text) document.execCommand('insertText', false, text)
    sync(); changed()
  }
  useForeignInput(body, (data, at, type) => {
    if (type === 'insertFromDrop') return insertForeign(data, at)
    const t = data?.getData('text/plain'); if (t) { document.execCommand('insertText', false, t); sync(); changed() }
  }, type => type === 'insertFromDrop' && ownDrag.current)
  const restore = () => {
    body.current?.focus({ preventScroll: true })
    const s = getSelection(); if (saved.current && s) { s.removeAllRanges(); s.addRange(saved.current) }
  }
  const exec = (cmd: RteCmd) => {
    restore()
    const tool = RTE_LIST.find(t => t.cmd === cmd)!
    if (tool.kind === 'block') document.execCommand('formatBlock', false, active.includes(cmd) && cmd !== 'p' ? 'p' : cmd)
    else if (cmd === 'code') {
      const c = closest('CODE')
      if (c) c.replaceWith(document.createTextNode(c.textContent ?? ''))
      else { const s = getSelection(); if (s?.rangeCount && !s.isCollapsed) { const el = document.createElement('code'); el.textContent = s.toString(); const r = s.getRangeAt(0); r.deleteContents(); r.insertNode(el); r.setStartAfter(el); r.collapse(true); s.removeAllRanges(); s.addRange(r) } }
    } else if (cmd === 'link') {
      const a = closest('A')
      if (a) { const r = document.createRange(); r.selectNodeContents(a); const s = getSelection()!; s.removeAllRanges(); s.addRange(r); document.execCommand('unlink') }
      else {
        const s = getSelection(); if (!s?.rangeCount) return
        saved.current = s.getRangeAt(0).cloneRange()
        setBubble(bubbleAt(s.getRangeAt(0).getBoundingClientRect(), RTE_LINK_HALF))
        setLink(''); return
      }
    } else document.execCommand(cmd)
    sync(); changed()
  }
  const applyLink = (url: string) => {
    setLink(null); restore()
    const u = url.trim()
    if (u) {
      const href = richTextHref(u)
      if (getSelection()?.isCollapsed) { const a = document.createElement('a'); a.href = href; a.textContent = u; const r = getSelection()!.getRangeAt(0); r.insertNode(a); r.setStartAfter(a); r.collapse(true) }
      else document.execCommand('createLink', false, href)
      changed()
    }
    sync()
  }
  const onKeyDown = (e: RKeyboardEvent) => {
    const mod = e.metaKey || e.ctrlKey, cmd = RTE_SHORTCUTS[e.key.toLowerCase()]
    if (mod && !e.shiftKey && !e.altKey && cmd) { e.preventDefault(); e.stopPropagation(); return exec(cmd) }
    if (e.key !== ' ') return
    const s = getSelection(); if (!s?.rangeCount || !s.isCollapsed) return
    const node = s.anchorNode; if (!node || node.nodeType !== 3 || node.previousSibling) return
    const marker = (node.textContent ?? '').slice(0, s.anchorOffset), md = RTE_MD[marker]; if (!md) return
    e.preventDefault()
    // Delete the marker with a native delete (keeps the emptied block editable), then convert the block.
    const r = document.createRange(); r.setStart(node, 0); r.setEnd(node, s.anchorOffset); s.removeAllRanges(); s.addRange(r); document.execCommand('delete')
    if (md.startsWith('insert')) document.execCommand(md); else document.execCommand('formatBlock', false, md)
    sync(); changed()
  }
  const toolbarKeys = useRoving(RTE_LIST.length, () => {}, { orientation: 'horizontal', index: tab, onMove: n => { setTab(n); bar.current?.querySelectorAll<HTMLElement>('button')[n]?.focus() } })
  const toolBtn = (tool: RteTool, inBubble: boolean) => {
    const on = active.includes(tool.cmd), i = RTE_LIST.indexOf(tool), label = tool.label
    return (
      <motion.button type="button" key={tool.cmd} whileTap={{ scale: 0.85 }} aria-label={tool.name ?? label} title={tool.shortcut ? `${label} ${formatHotkey(`mod+${tool.shortcut}`)}` : label} aria-pressed={on}
        tabIndex={inBubble ? -1 : i === tab ? 0 : -1} onMouseDown={e => e.preventDefault()} onClick={() => { if (!inBubble) setTab(i); exec(tool.cmd) }}
        className={cn('grid h-[30px] min-w-[30px] flex-none cursor-pointer place-items-center rounded-[var(--r-md)] border-0 px-1.5 text-[13px] font-semibold transition-colors [@media(pointer:coarse)]:h-9 [@media(pointer:coarse)]:min-w-9',
          inBubble ? (on ? 'bg-[color-mix(in_srgb,var(--on-primary)_15%,transparent)] text-[var(--on-primary)]' : 'bg-transparent text-[color-mix(in_srgb,var(--on-primary)_75%,transparent)] hover:bg-[color-mix(in_srgb,var(--on-primary)_15%,transparent)] hover:text-[var(--on-primary)]')
            : on ? 'bg-[var(--muted)] text-[var(--fg)]' : 'bg-transparent text-[var(--fg2)] hover:bg-[var(--muted)] hover:text-[var(--fg)]')}>
        {tool.glyph}
      </motion.button>
    )
  }
  return (
    <div ref={host} className={cn('relative rounded-[var(--r-lg)] border border-[var(--line)] bg-[var(--card)]', className)}>
      <div ref={bar} role="toolbar" aria-label={'Formatting'} className="flex flex-wrap gap-0.5 border-b border-[var(--line)] p-1.5 [@media(pointer:coarse)]:gap-1"
        onKeyDown={e => { if (e.key !== 'Enter') toolbarKeys.onKeyDown(e) }}>
        {RTE_TOOLS.map((x, i) => x === '|' ? <span key={i} className="mx-1 my-1 w-px bg-[var(--line)]" /> : toolBtn(x, false))}
      </div>
      <div className="relative">
      {empty && <span aria-hidden className="pointer-events-none absolute top-4 start-4 text-sm text-[var(--fg3)] [@media(pointer:coarse)]:text-base">{placeholder}</span>}
      <div ref={body} contentEditable suppressContentEditableWarning role="textbox" aria-multiline aria-label={ariaLabel} aria-placeholder={placeholder} spellCheck={false}
        className={rteContent} onInput={() => { sync(); changed() }} onKeyDown={onKeyDown} onKeyUp={sync} onMouseUp={sync} onTouchEnd={() => setTimeout(sync, 0)}
        // Enter makes <p> while the editor has focus; the setting is document-wide, so the page's own comes back on blur
        onFocus={() => { try { separator.current = document.queryCommandValue('defaultParagraphSeparator'); document.execCommand('defaultParagraphSeparator', false, 'p') } catch { /* unsupported */ } }}
        onBlur={() => { if (separator.current && separator.current !== 'p') document.execCommand('defaultParagraphSeparator', false, separator.current) }}
        onPaste={e => { e.preventDefault(); document.execCommand('insertText', false, e.clipboardData.getData('text/plain')) }}
        onDragStart={() => { ownDrag.current = true }} onDragEnd={() => { ownDrag.current = false }}
        onDragOver={e => { if (!ownDrag.current) e.dataTransfer.dropEffect = 'copy' }}
        onDrop={e => {
          if (ownDrag.current) return // moving text within the editor: the browser moves it (dragend clears the flag)
          e.preventDefault() // files, iframes, forms, styles, tracking images: only sanitized HTML or text gets in
          insertForeign(e.dataTransfer, editorRangeAt(e.clientX, e.clientY))
        }} />
      </div>
      <div className="flex justify-between border-t border-[var(--line)] px-3 py-2 text-xs text-[var(--fg3)]">
        <span className="tabular-nums">{`${plural(words, 'word')} · ${Math.max(1, Math.round(words / 220))} min read`}</span>
        <span aria-live="polite" className="flex items-center">
          <AnimatePresence mode="wait" initial={false}>
            {save !== 'idle' && (
              <motion.span key={save} initial={{ opacity: 0, y: 3 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -3 }} transition={{ duration: 0.15 }} className={cn('flex items-center gap-1', save === 'error' && 'text-[var(--bad)]')}>
                {save === 'saved' && <Icon name="check" size={12} className="text-[var(--ok)]" />}{save === 'error' && <Icon name="alertCircle" size={12} />}{RTE_SAVE_TEXT[save]}
              </motion.span>
            )}
          </AnimatePresence>
        </span>
      </div>
      <AnimatePresence>
        {bubble && (
          <motion.div key="bubble" role="toolbar" aria-label={'Selection formatting'} initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, transition: { duration: 0.1 } }} transition={spring(0.3, 0.25)}
            className={cn('absolute z-10 flex max-w-[calc(100%-8px)] -translate-x-1/2 gap-0.5 rounded-[var(--r-md)] bg-[var(--primary)] p-1 shadow-[var(--shadow)]', !bubble.below && '-translate-y-full')} style={{ left: bubble.x, top: bubble.y }}>
            {link === null ? RTE_LIST.filter(t => t.bubble).map(t => toolBtn(t, true)) : (
              <input autoFocus value={link} onChange={e => setLink(e.target.value)} placeholder={'Paste a link, Enter to apply'} aria-label={'Link URL'}
                onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); applyLink(link) } if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setLink(null); restore(); sync() } }}
                onBlur={() => { setLink(null); setBubble(null) }}
                className="h-[30px] w-[230px] max-w-full min-w-0 rounded-[var(--r-sm)] border-0 [@media(pointer:coarse)]:h-9 bg-[color-mix(in_srgb,var(--on-primary)_12%,transparent)] px-2 text-[13px] text-[var(--on-primary)] outline-none placeholder:text-[color-mix(in_srgb,var(--on-primary)_60%,transparent)]" />
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

export type MentionPerson = { id: string; name: string; sub?: string }
export type MentionCommand = { cmd: string; hint: string }
/** What MentionsInput sends: plain text interleaved with mention and command tokens. `id` is the person's id or the command for tokens. */
export type MentionSegment = { type: 'text' | 'mention' | 'command'; value: string; id?: string }
const MENTION_TOKEN = 'inline-block rounded-[var(--r-sm)] bg-[var(--accent-soft)] px-1.5 leading-normal font-medium text-[var(--accent)]'
const MENTION_CMD = 'inline-block rounded-[var(--r-sm)] bg-[var(--warn-soft)] px-1.5 leading-normal font-medium text-[var(--warn)]'

/**
 * Message box with `@` mentions and `/` commands. Typing either opens a list at the caret; ↑ ↓ choose, Enter or Tab inserts
 * a non-editable token, Escape closes. With the list closed, Enter sends (Shift+Enter for a new line) and an empty send wiggles.
 * Paste and drop insert plain text only; segments come only from tokens this component inserted (lookalike markup
 * dropped or pasted in is sent as text), with the value rebuilt from `people` / `commands` (both empty by default;
 * the placeholder mentions @ and / only when there is something to pick).
 */
export function MentionsInput({ people = [], commands = [], placeholder: ph, onSend, className }:
  { people?: MentionPerson[]; commands?: MentionCommand[]; placeholder?: string; className?: string; onSend?: (segments: MentionSegment[], text: string) => void }) {
  const hint = people.length && commands.length ? ' try @ or /' : people.length ? ' try @' : commands.length ? ' try /' : ''
  const placeholder = ph ?? `Write a message…${hint}`
  const host = useRef<HTMLDivElement>(null), ed = useRef<HTMLDivElement>(null)
  const made = useRef(new WeakSet<Node>()) // tokens this component created; nothing else becomes a segment
  const [pop, setPop] = useState<{ type: '@' | '/'; q: string; x: number; y: number } | null>(null)
  const [sent, setSent] = useState<{ id: number; segs: MentionSegment[] } | null>(null)
  const items: (MentionPerson | MentionCommand)[] = !pop ? [] : pop.type === '@'
    ? people.filter(p => p.name.toLowerCase().includes(pop.q)) : commands.filter(c => c.cmd.slice(1).startsWith(pop.q))
  const open = !!pop && items.length > 0
  const options: Option[] = items.map(it => 'cmd' in it ? { value: it.cmd, label: it.cmd, hint: it.hint }
    : { value: it.id, label: it.name, hint: it.sub, leading: <Avatar name={it.name} size={22} className="!border-0" /> })
  const lb = useListbox(options, i => insert(items[i]), { open, setOpen: o => { if (!o) setPop(null) }, input: true })
  const idx = Math.min(lb.active, Math.max(0, items.length - 1))
  const detect = () => {
    const s = getSelection(), node = s?.anchorNode
    if (!s?.rangeCount || !node || node.nodeType !== 3 || !ed.current?.contains(node)) return setPop(null)
    const m = (node.textContent ?? '').slice(0, s.anchorOffset).match(/(^|\s)([@/])(\w*)$/)
    if (!m) return setPop(null)
    const r = s.getRangeAt(0).cloneRange(); r.collapse(true)
    const rect = r.getClientRects()[0] ?? ed.current.getBoundingClientRect(), h = host.current!.getBoundingClientRect()
    const w = Math.min(230, h.width)
    if (pop?.type !== m[2]) lb.setActive(0)
    setPop({ type: m[2] as '@' | '/', q: m[3].toLowerCase(), x: Math.max(0, Math.min(h.width - w, rect.left - h.left)), y: rect.bottom - h.top + 6 })
  }
  const insert = (it: MentionPerson | MentionCommand) => {
    const s = getSelection(), node = s?.anchorNode
    if (!pop || !s || !node || node.nodeType !== 3) return
    const off = s.anchorOffset, start = (node.textContent ?? '').lastIndexOf(pop.type, off - 1)
    const range = document.createRange(); range.setStart(node, start); range.setEnd(node, off); range.deleteContents()
    const tok = document.createElement('span'); const isCmd = 'cmd' in it
    tok.className = isCmd ? MENTION_CMD : MENTION_TOKEN; tok.contentEditable = 'false'; tok.dataset.kind = isCmd ? 'command' : 'mention'
    tok.dataset.id = isCmd ? it.cmd : it.id
    tok.textContent = isCmd ? it.cmd : '@' + it.name
    made.current.add(tok)
    range.insertNode(tok)
    const sp = document.createTextNode(' '); tok.after(sp)
    const r2 = document.createRange(); r2.setStart(sp, 1); r2.collapse(true); s.removeAllRanges(); s.addRange(r2)
    play(tok, { scale: [0.8, 1] }, spring(0.5, 0.3)); setPop(null)
  }
  /** The segment for a token we inserted, rebuilt from the known people / commands (null if it no longer matches one). */
  const token = (c: HTMLElement): MentionSegment | null => {
    const id = c.dataset.id ?? ''
    if (c.dataset.kind === 'command') { const m = commands.find(x => x.cmd === id); return m ? { type: 'command', value: m.cmd, id } : null }
    const p = people.find(x => x.id === id); return p ? { type: 'mention', value: '@' + p.name, id } : null
  }
  const segments = () => {
    const out: MentionSegment[] = []
    const walk = (n: Node) => n.childNodes.forEach(c => {
      if (c.nodeType === 3) { const t = (c.textContent ?? '').replace(/ /g, ' '); const last = out[out.length - 1]; if (last?.type === 'text') last.value += t; else out.push({ type: 'text', value: t }) }
      else if (c instanceof HTMLElement && made.current.has(c) && token(c)) out.push(token(c)!)
      else if (c instanceof HTMLElement) { if (c.tagName === 'BR' || c.tagName === 'DIV' || c.tagName === 'P') out.push({ type: 'text', value: '\n' }); walk(c) }
    })
    if (ed.current) walk(ed.current)
    return out
  }
  const insertPlain = (text: string | undefined, at: Range | null) => {
    const el = ed.current, s = getSelection(); if (!el || !s || !text) return
    if (at && el.contains(at.startContainer)) { s.removeAllRanges(); s.addRange(at) }
    if (s.rangeCount && el.contains(s.anchorNode)) document.execCommand('insertText', false, text)
  }
  useForeignInput(ed, (data, at) => insertPlain(data?.getData('text/plain'), at))
  const send = () => {
    const el = ed.current; if (!el) return
    if (!el.textContent?.trim()) return shake(el, 4)
    const segs = segments(), text = segs.map(s => s.value).join('').trim()
    setSent({ id: Date.now(), segs }); onSend?.(segs, text)
    el.innerHTML = ''; setPop(null); el.focus()
  }
  return (
    <div ref={host} className={cn('relative flex flex-col gap-3', className)}>
      <div ref={ed} contentEditable suppressContentEditableWarning role="textbox" aria-multiline aria-label={'Message'} data-ph={placeholder} spellCheck={false}
        aria-controls={open ? lb.id : undefined} aria-activedescendant={open ? `${lb.id}-${idx}` : undefined} aria-autocomplete="list"
        className={cn(inputClass, '!h-auto min-h-[90px] !py-2.5 text-sm leading-relaxed whitespace-pre-wrap empty:before:text-[var(--fg3)] empty:before:content-[attr(data-ph)]')}
        onInput={() => { const el = ed.current!; if (!el.textContent && !el.querySelector('[data-kind]')) el.innerHTML = ''; detect() }}
        onKeyUp={e => { if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) detect() }}
        onBlur={() => setPop(null)}
        onPaste={e => { e.preventDefault(); document.execCommand('insertText', false, e.clipboardData.getData('text/plain')) }}
        onDragOver={e => { e.dataTransfer.dropEffect = 'copy' }}
        onDrop={e => { e.preventDefault(); insertPlain(e.dataTransfer.getData('text/plain'), editorRangeAt(e.clientX, e.clientY)); detect() }}
        onKeyDown={e => {
          if (e.nativeEvent.isComposing) return // Enter confirming an IME candidate is not a send
          if (!open) { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() } return }
          if (e.key === 'Tab') { e.preventDefault(); insert(items[idx]) }
          else lb.onKeyDown(e)
        }} />
      {/* zero-size anchor at the caret (a physical x from the caret's rect); the shared floating panel flips and clamps itself from there */}
      <div className="absolute" style={{ left: pop?.x ?? 0, top: (pop?.y ?? 0) - 6 }}>
        <FloatingPanel open={open} placement="bottom-start" role="presentation" className="max-h-60 w-[230px] overflow-auto overscroll-contain">
          <MenuLabel>{(pop?.type === '/' ? 'Commands' : 'People')}</MenuLabel>
          <OptionList id={lb.id} label={(pop?.type === '/' ? 'Commands' : 'People')} options={options} active={idx} query={pop?.type === '@' ? pop.q : undefined}
            isSelected={() => false} onPick={i => insert(items[i])} onHover={lb.setActive} />
        </FloatingPanel>
      </div>
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs text-[var(--fg3)] [@media(hover:none)]:hidden">{'↑ ↓ to choose, Enter to insert'}</span>
        <span className="hidden text-xs text-[var(--fg3)] [@media(hover:none)]:inline">{'Type @ or /, then tap a name'}</span>
        <Button size="sm" variant="primary" onClick={send}>{'Send'}</Button>
      </div>
      <AnimatePresence mode="popLayout">
        {sent && (
          <motion.div key={sent.id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={spring(0.3, 0.35)}
            className="ms-auto w-fit max-w-full rounded-[var(--r-lg)] rounded-ee-[5px] bg-[var(--primary)] px-3 py-2 text-[13px] leading-snug whitespace-pre-wrap text-[var(--on-primary)]">
            {sent.segs.map((s, i) => s.type === 'text' ? <span key={i}>{s.value}</span>
              : <span key={i} className="rounded-[var(--r-sm)] bg-[color-mix(in_srgb,var(--on-primary)_18%,transparent)] px-1 font-medium">{s.value}</span>)}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

/**
 * Form state with a saved snapshot: `dirty` is true while any field differs from it. `save(fn)` passes `fn` the values
 * as they are when it is called and, once `fn` resolves, makes that snapshot the saved one, so edits typed during the
 * save stay dirty. It resolves true when saved and false when ignored (a save is already running, or the form
 * unmounted); a rejection is passed on and nothing is marked saved. `saving` is true meanwhile. `reset()` restores the
 * saved values; `commit(values?)` marks `values` (default: the current ones) as saved without a save.
 */
export function useFormDraft<T extends object>(initial: T) {
  const [saved, setSaved] = useState(initial)
  const [values, setValues, getValues] = useLatestState(initial)
  const [saving, setSaving] = useState(false)
  const busy = useRef(false), gen = useGeneration()
  const dirty = (Object.keys(values) as (keyof T)[]).some(k => values[k] !== saved[k])
  const save = async (fn: (values: T) => unknown): Promise<boolean> => {
    if (busy.current) return false
    const snapshot = getValues(), current = gen.next()
    busy.current = true; setSaving(true)
    try { await fn(snapshot) } finally { if (current()) { busy.current = false; setSaving(false) } }
    if (!current()) return false
    setSaved(snapshot)
    return true
  }
  return {
    values, dirty, saved, saving, save,
    set: <K extends keyof T>(k: K, v: T[K]) => setValues(x => ({ ...x, [k]: v })),
    reset: () => setValues(saved), commit: (v: T = getValues()) => setSaved(v),
  }
}

/**
 * Save bar for a form with unsaved changes: slides up inside its (relative, overflow-hidden) container while `open`.
 * Bump `shake` to wiggle it after a failed validation. `saving` swaps the Save label for a spinner.
 */
export function UnsavedChangesBar({ open, message: messageProp, onReset, onSave, saving, shake: wiggle = 0, saveLabel: saveLabelProp, className }:
  { open: boolean; message?: ReactNode; onReset: () => void; onSave: () => void; saving?: boolean; shake?: number; saveLabel?: string; className?: string }) {
  const ref = useRef<HTMLDivElement>(null)
  const message = messageProp ?? 'Unsaved changes', saveLabel = saveLabelProp ?? 'Save changes'
  useEffect(() => { if (wiggle) shake(ref.current, 4) }, [wiggle])
  return (
    <AnimatePresence>
      {open && (
        <motion.div key="bar" initial={{ y: 80 }} animate={{ y: 0 }} exit={{ y: 80, transition: { duration: 0.2 } }} transition={spring(0.25, 0.4)} className={cn('absolute inset-x-3 bottom-3 z-10', className)}>
          <div ref={ref} role="region" aria-label={'Unsaved changes'}
            className="flex items-center gap-2 rounded-[var(--r-md)] bg-[var(--primary)] py-2 pe-2 ps-3 text-[13px] text-[var(--on-primary)] shadow-[var(--shadow)]">
            <span className="h-[7px] w-[7px] flex-none rounded-full bg-[var(--warn)]" />
            <motion.span key={String(message)} initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="min-w-0 flex-1 truncate" aria-live="polite">{message}</motion.span>
            <Button size="sm" disabled={saving} onClick={onReset} className="!border-[color-mix(in_srgb,var(--on-primary)_30%,transparent)] !bg-transparent !text-[var(--on-primary)] hover:!bg-[color-mix(in_srgb,var(--on-primary)_12%,transparent)]">{'Reset'}</Button>
            <Button size="sm" onClick={onSave} disabled={saving} className="min-w-[104px] !border-[var(--on-primary)] !bg-[var(--on-primary)] !text-[var(--primary)]">
              {saving ? <Spinner label={'Saving'} /> : saveLabel}
            </Button>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}

type SigPoint = { x: number; y: number; t: number; w: number }

/**
 * Signature pad on a canvas. Strokes are smoothed with quadratic curves and get thinner the faster you move
 * (or follow pen pressure). Undo removes one stroke, Clear removes all, Confirm checks there is a signature (it wiggles if not)
 * and passes a PNG data URL. Redraws in the right ink colour on theme changes and resizes. Works with mouse, pen and touch.
 */
export function SignaturePad({ onConfirm, height = 170, className }: { onConfirm?: (dataUrl: string, strokes: number) => void; height?: number; className?: string }) {
  const box = useRef<HTMLDivElement>(null), cv = useRef<HTMLCanvasElement>(null)
  const strokes = useRef<SigPoint[][]>([]), cur = useRef<SigPoint[] | null>(null), dpr = useRef(1)
  const [count, setCount] = useState(0)
  const [done, setDone] = useState(false)
  const redraw = () => {
    const c = cv.current, g = c?.getContext('2d'); if (!c || !g) return
    g.clearRect(0, 0, c.width, c.height)
    const [r, gr, b, a] = resolveColor(c, 'var(--fg)', [17, 17, 17, 1])
    g.strokeStyle = `rgba(${r},${gr},${b},${a})`; g.lineCap = 'round'; g.lineJoin = 'round'
    const k = dpr.current
    for (const s of strokes.current) {
      if (s.length === 1) { g.fillStyle = g.strokeStyle; g.beginPath(); g.arc(s[0].x * k, s[0].y * k, (s[0].w * k) / 2, 0, Math.PI * 2); g.fill(); continue }
      for (let i = 1; i < s.length; i++) {
        const p0 = s[i - 2], a = s[i - 1], b = s[i]
        g.lineWidth = b.w * k; g.beginPath()
        g.moveTo((p0 ? (p0.x + a.x) / 2 : a.x) * k, (p0 ? (p0.y + a.y) / 2 : a.y) * k)
        g.quadraticCurveTo(a.x * k, a.y * k, ((a.x + b.x) / 2) * k, ((a.y + b.y) / 2) * k); g.stroke()
      }
    }
  }
  useResizeObserver(cv, c => { dpr.current = Math.min(2, devicePixelRatio || 1); c.width = c.clientWidth * dpr.current; c.height = c.clientHeight * dpr.current; redraw() })
  // re-ink on theme changes (also with UIProvider target="self", where <html> never changes)
  const themeVersion = useThemeVersion(box)
  useEffect(() => { redraw() }, [themeVersion]) // eslint-disable-line react-hooks/exhaustive-deps
  const pt = (e: React.PointerEvent, w: number): SigPoint => { const r = cv.current!.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top, t: performance.now(), w } }
  const undo = () => { strokes.current.pop(); setCount(strokes.current.length); setDone(false); redraw() }
  const clear = () => { strokes.current = []; setCount(0); setDone(false); redraw() }
  const confirm = () => {
    if (!strokes.current.length) return shake(box.current, 5)
    setDone(true); play(box.current, { scale: [1, 1.015, 1] }, { duration: 0.4 })
    onConfirm?.(cv.current!.toDataURL('image/png'), strokes.current.length)
  }
  return (
    <div className={cn('flex flex-col gap-3', className)}>
      <div ref={box} style={{ height }} className={cn('relative touch-none overflow-hidden rounded-[var(--r-md)] border bg-[var(--card)] transition-[border-color,box-shadow]',
        done ? 'border-[var(--ok)] shadow-[0_0_0_3px_var(--ok-soft)]' : 'border-[var(--line)]')}>
        <canvas ref={cv} role="img" aria-label={count ? `Signature, ${plural(count, 'stroke')}` : 'Signature area, draw with mouse, pen or finger'}
          className="absolute inset-0 h-full w-full cursor-crosshair touch-none"
          onPointerDown={e => { e.currentTarget.setPointerCapture(e.pointerId); setDone(false); cur.current = [pt(e, 2.2)]; strokes.current.push(cur.current); setCount(strokes.current.length); redraw() }}
          onPointerMove={e => {
            const s = cur.current; if (!s) return
            const l = s[s.length - 1], p = pt(e, 0), v = Math.hypot(p.x - l.x, p.y - l.y) / Math.max(1, p.t - l.t)
            const target = e.pointerType === 'pen' && e.pressure ? e.pressure * 4 : 3.2 - v * 1.2
            p.w = Math.max(0.9, Math.min(3.2, target * 0.6 + l.w * 0.4)); s.push(p); redraw()
          }}
          onPointerUp={() => { cur.current = null }} onPointerCancel={() => { cur.current = null }} />
        <motion.span initial={false} animate={{ opacity: count ? 0 : 1 }} className="pointer-events-none absolute end-5 bottom-[34px] start-9 border-t border-dashed border-[var(--line2)] pt-1 text-[11px] text-[var(--fg3)]">{'Sign here'}</motion.span>
        <span aria-hidden className="pointer-events-none absolute bottom-[38px] start-[18px] text-[13px] text-[var(--fg3)]">✕</span>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex gap-2"><Button size="sm" disabled={!count} onClick={undo}>{'Undo'}</Button><Button size="sm" disabled={!count} onClick={clear}>{'Clear'}</Button></div>
        <Button size="sm" variant="primary" onClick={confirm}>{'Confirm'}</Button>
      </div>
    </div>
  )
}

export type AddressRecord = { street: string; city: string; postcode: string; country: string }
function AddressFlashField({ id, label, value, onChange, flash }: { id: string; label: string; value: string; onChange: (v: string) => void; flash: number }) {
  return (
    <div>
      <label htmlFor={id} className="mb-1.5 block text-[13px] font-medium">{label}</label>
      <div className="relative overflow-hidden rounded-[var(--r-md)] bg-[var(--card)]">
        {flash > 0 && <motion.span key={flash} aria-hidden initial={{ opacity: 1 }} animate={{ opacity: 0 }} transition={{ duration: 0.9, ease: 'easeOut' }} className="pointer-events-none absolute inset-0 bg-[var(--accent-soft)]" />}
        <input id={id} value={value} onChange={e => onChange(e.target.value)} className={cn(inputClass, 'relative !bg-transparent')} />
      </div>
    </div>
  )
}

/**
 * Address search over `addresses` (your data or a geocoder's results): after 2 characters it lists up to five matches
 * (the typed part bolded, city and country beside it). Picking one (click, or ↑ ↓ Enter) fills City, Postcode and Country
 * one after another with a brief highlight. Escape closes the list without closing a dialog around it.
 */
export function AddressAutocomplete({ addresses, onChange, placeholder: placeholderProp, label: labelProp, className }:
  { addresses: AddressRecord[]; onChange?: (a: AddressRecord) => void; placeholder?: string; label?: ReactNode; className?: string }) {
  const placeholder = placeholderProp ?? 'Start typing, e.g. Bahn', label = labelProp ?? 'Address'
  const [q, setQ] = useState('')
  const [open, setOpen] = useState(false)
  const [rest, setRest] = useState({ city: '', postcode: '', country: '' })
  const [flash, setFlash] = useState({ city: 0, postcode: 0, country: 0 })
  const base = useId()
  const timers = useRef<ReturnType<typeof setTimeout>[]>([])
  useEffect(() => () => timers.current.forEach(clearTimeout), [])
  const term = q.trim().toLowerCase()
  const items = term.length < 2 ? [] : addresses.filter(a => `${a.street} ${a.city}`.toLowerCase().includes(term)).slice(0, 5)
  const shown = open && term.length >= 2
  const options: Option[] = items.map(a => ({ value: `${a.street}|${a.postcode}`, label: a.street, hint: `${a.city}, ${a.country}`, icon: 'mapPin' }))
  const lb = useListbox(options, i => choose(items[i]), { open: shown, setOpen, input: true })
  const choose = (a: AddressRecord) => {
    setQ(a.street); setOpen(false); timers.current.forEach(clearTimeout)
    timers.current = (['city', 'postcode', 'country'] as const).map((k, i) => setTimeout(() => {
      setRest(r => ({ ...r, [k]: a[k] })); setFlash(f => ({ ...f, [k]: f[k] + 1 }))
    }, i * 90))
    onChange?.(a)
  }
  return (
    <div className={cn('flex flex-col gap-2.5', className)}>
      <div className="relative">
        <label htmlFor={`${base}-street`} className="mb-1.5 block text-[13px] font-medium">{label}</label>
        <input id={`${base}-street`} value={q} placeholder={placeholder} autoComplete="off" {...lb.comboProps} className={inputClass}
          onChange={e => { setQ(e.target.value); lb.setActive(0); setOpen(true) }} onFocus={() => setOpen(true)} onBlur={() => setOpen(false)}
          onKeyDown={e => { if (shown && !e.nativeEvent.isComposing) lb.onKeyDown(e) }} />
        <FloatingPanel open={shown} matchWidth flip="scroll" role="presentation" className="max-h-64 overflow-auto overscroll-contain">
          <OptionList id={lb.id} label={'Suggestions'} options={options} active={Math.min(lb.active, Math.max(0, items.length - 1))} query={term} isSelected={() => false}
            onPick={i => choose(items[i])} onHover={lb.setActive} empty={'No matching addresses'} />
        </FloatingPanel>
      </div>
      <div className="grid grid-cols-[minmax(0,2fr)_minmax(0,1fr)] gap-2.5">
        <AddressFlashField id={`${base}-city`} label={'City'} value={rest.city} flash={flash.city} onChange={v => setRest(r => ({ ...r, city: v }))} />
        <AddressFlashField id={`${base}-zip`} label={'Postcode'} value={rest.postcode} flash={flash.postcode} onChange={v => setRest(r => ({ ...r, postcode: v }))} />
        <div className="col-span-full"><AddressFlashField id={`${base}-country`} label={'Country'} value={rest.country} flash={flash.country} onChange={v => setRest(r => ({ ...r, country: v }))} /></div>
      </div>
    </div>
  )
}

export const EMOJI_CATEGORIES: [icon: string, name: string, emoji: readonly string[]][] = [
  ['😊', 'Smileys', ['😀', '😃', '😄', '😁', '😆', '😅', '🤣', '😂', '🙂', '😉', '😊', '😇', '🥰', '😍', '🤩', '😘', '😋', '😜', '🤪', '😎', '🤓', '🧐', '🤔', '🤗', '🤭', '😴', '😮', '😢', '😭', '😤', '😡', '🥳']],
  ['👍', 'Gestures', ['👍', '👎', '👏', '🙌', '👐', '🤝', '🙏', '✌️', '🤞', '🤟', '🤘', '👌', '🤌', '👋', '💪', '✍️', '👀', '🧠', '🫶', '❤️', '🧡', '💛', '💚', '💙', '💜', '🖤', '🤍', '💯', '✨', '🔥', '⭐', '🎉']],
  ['🐶', 'Nature', ['🐶', '🐱', '🐭', '🐹', '🐰', '🦊', '🐻', '🐼', '🐨', '🐯', '🦁', '🐮', '🐸', '🐵', '🐔', '🐧', '🐦', '🦄', '🐝', '🦋', '🌸', '🌻', '🌲', '🌵', '🍀', '🌍', '🌙', '☀️', '⛅', '🌈', '❄️', '🌊']],
  ['🍕', 'Food', ['🍎', '🍐', '🍊', '🍋', '🍌', '🍉', '🍇', '🍓', '🫐', '🍒', '🥑', '🥦', '🥕', '🌽', '🍞', '🧀', '🍳', '🥞', '🍔', '🍟', '🍕', '🌮', '🍣', '🍜', '🍩', '🍪', '🎂', '🍫', '☕', '🍵', '🥤', '🍷']],
  ['🚀', 'Objects', ['🚀', '✈️', '🚗', '🚲', '⛵', '🏠', '🏔️', '💻', '⌨️', '📱', '📷', '🎧', '🎮', '💡', '🔒', '🔑', '🔧', '🧪', '📈', '📌', '📎', '✏️', '📚', '🗂️', '📅', '⏰', '💰', '🎁', '🏆', '🎯', '🧩', '✅']],
]
/** An emoji's accessible name, then extra search words. Emoji without an entry keep the name the screen reader gives the glyph. */
const EMOJI_INFO: Record<string, readonly [name: string, ...keywords: string[]]> = {
  '👍': ['thumbs up', 'yes', 'like'], '👎': ['thumbs down', 'no', 'dislike'], '🔥': ['fire', 'hot'], '🎉': ['party popper', 'tada', 'celebrate'],
  '❤️': ['red heart', 'love'], '😂': ['face with tears of joy', 'laugh'], '🤣': ['rolling on the floor laughing', 'laugh'], '🚀': ['rocket', 'launch', 'ship'],
  '✅': ['check mark', 'done', 'yes'], '👀': ['eyes', 'look'], '🙏': ['folded hands', 'thanks', 'pray', 'please'], '💯': ['hundred points'], '🍕': ['pizza'],
  '☕': ['hot beverage', 'coffee'], '🐶': ['dog face', 'puppy'], '🐱': ['cat face'], '😍': ['smiling face with heart eyes', 'love'], '🤔': ['thinking face', 'hmm'],
  '😎': ['smiling face with sunglasses', 'cool'], '✨': ['sparkles'], '😀': ['grinning face', 'smile', 'happy'], '😊': ['smiling face with smiling eyes', 'smile', 'blush', 'happy'],
  '🙂': ['slightly smiling face', 'smile'], '😉': ['winking face', 'wink'], '😢': ['crying face', 'sad', 'cry'], '😭': ['loudly crying face', 'cry', 'sob'], '😡': ['enraged face', 'angry'],
  '🥳': ['partying face', 'party', 'celebrate'], '👏': ['clapping hands', 'clap', 'applause'], '🙌': ['raising hands', 'hooray'], '👋': ['waving hand', 'wave', 'hello', 'hi'],
  '💪': ['flexed biceps', 'strong', 'muscle'], '⭐': ['star'], '🌈': ['rainbow'], '☀️': ['sun'], '🍎': ['red apple'], '🍔': ['hamburger', 'burger'], '🍩': ['doughnut', 'donut'],
  '🎂': ['birthday cake'], '🍷': ['wine glass'], '💡': ['light bulb', 'idea'], '🏆': ['trophy', 'win'], '🎯': ['direct hit', 'target', 'goal'], '💻': ['laptop', 'computer'], '📅': ['calendar', 'date'],
}
const EMOJI_ALL = EMOJI_CATEGORIES.flatMap(c => c[2])
const emojiMatches = (e: string, term: string) => EMOJI_INFO[e]?.some(w => w.includes(term)) ?? false
const EMOJI_COLS = 8
const EMOJI_GRID = { gridTemplateColumns: `repeat(${EMOJI_COLS}, minmax(0, 1fr))` }

/**
 * Emoji panel: category tabs, a search field (shows "N results", or that nothing matched), a Recent row, and an
 * 8-column grid. Each grid is one Tab stop: the arrow keys move inside it (↓ from Recent's last row goes on into the
 * grid below, in the same column), Home/End go to the ends of the row. Calls `onPick` with the emoji; Escape calls `onClose`.
 */
export function EmojiPicker({ onPick, onClose, recent = [], className }: { onPick: (e: string) => void; onClose?: () => void; recent?: string[]; className?: string }) {
  const [cat, setCat] = useState(0)
  const [q, setQ] = useState('')
  const catName = (i: number) => EMOJI_CATEGORIES[i][1]
  const tabs = useRef<HTMLDivElement>(null), recentGrid = useRef<HTMLDivElement>(null), mainGrid = useRef<HTMLDivElement>(null)
  const term = q.trim().toLowerCase()
  const tabKeys = useRoving(EMOJI_CATEGORIES.length, () => {}, { orientation: 'horizontal', index: cat,
    onMove: n => { setCat(n); setQ(''); tabs.current?.querySelectorAll<HTMLElement>('[role=tab]')[n]?.focus() } })
  const list = term ? EMOJI_ALL.filter(e => emojiMatches(e, term)) : EMOJI_CATEGORIES[cat][2]
  const showRecent = recent.length > 0 && !term
  const [stop, setStop] = useState({ r: 0, g: 0 }) // each grid's Tab stop
  const at = { r: Math.min(stop.r, recent.length - 1), g: Math.min(stop.g, list.length - 1) }
  const focusCell = (grid: 'r' | 'g', i: number) => {
    const box = grid === 'r' ? recentGrid.current : mainGrid.current
    setStop(s => ({ ...s, [grid]: i })); box?.querySelectorAll<HTMLElement>('button')[i]?.focus()
  }
  const gridKeys = (grid: 'r' | 'g', count: number) => (e: RKeyboardEvent) => {
    const i = Number((e.target as HTMLElement).dataset.i), to = Number.isNaN(i) ? null : gridKeyMove(e.key, i, count, EMOJI_COLS)
    if (to === null) return
    e.preventDefault()
    const col = i % EMOJI_COLS
    if (grid === 'r' && e.key === 'ArrowDown' && i + EMOJI_COLS >= count && list.length) return focusCell('g', Math.min(col, list.length - 1))
    if (grid === 'g' && e.key === 'ArrowUp' && i < EMOJI_COLS && showRecent) { const last = recent.length - 1; return focusCell('r', Math.min(last - (last % EMOJI_COLS) + col, last)) }
    focusCell(grid, to)
  }
  const cell = (grid: 'r' | 'g') => (e: string, i: number) => (
    <button type="button" key={grid + e + i} data-i={i} aria-label={EMOJI_INFO[e]?.[0]} tabIndex={i === at[grid] ? 0 : -1} onFocus={() => setStop(s => ({ ...s, [grid]: i }))} onClick={() => onPick(e)}
      className="grid h-8 cursor-pointer place-items-center rounded-[var(--r-md)] border-0 bg-transparent text-[19px] leading-none outline-none hover:bg-[var(--muted)] focus-visible:bg-[var(--muted)] [@media(pointer:coarse)]:h-10 [@media(pointer:coarse)]:text-[22px]">{e}</button>
  )
  return (
    <div className={cn('w-[300px] max-w-[calc(100vw-32px)]', className)} onKeyDown={e => { if (e.key === 'Escape') { e.stopPropagation(); onClose?.() } }}>
      <div ref={tabs} role="tablist" aria-label={'Emoji categories'} className="flex gap-0.5 border-b border-[var(--line)] p-1.5" onKeyDown={e => { if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) { e.stopPropagation(); tabKeys.onKeyDown(e) } }}>
        {EMOJI_CATEGORIES.map(([icon, name], i) => {
          const on = i === cat && !term
          return (
            <button type="button" key={name} role="tab" aria-selected={on} tabIndex={i === cat ? 0 : -1} aria-label={catName(i)} title={catName(i)} onClick={() => { setCat(i); setQ('') }}
              className={cn('relative h-[30px] flex-1 cursor-pointer rounded-[var(--r-md)] border-0 bg-transparent text-base transition-opacity [@media(pointer:coarse)]:h-9', on ? 'opacity-100' : 'opacity-55 hover:opacity-90')}>
              {on && <motion.span layoutId="emoji-tab" className="absolute inset-0 rounded-[var(--r-md)] bg-[var(--muted)]" transition={spring(0.2, 0.4)} />}
              <span className="relative">{icon}</span>
            </button>
          )
        })}
      </div>
      <div className="px-2 pt-2"><input autoFocus={!isCoarsePointer()} value={q} onChange={e => setQ(e.target.value)} placeholder={'Search emoji'} aria-label={'Search emoji'} className={cn(inputClass, '!h-[30px]')} /></div>
      {showRecent && (
        <>
          <div className="px-2.5 pt-1.5 text-[11px] text-[var(--fg3)]">{'Recent'}</div>
          <div ref={recentGrid} role="group" aria-label={'Recent'} className="grid gap-0.5 px-2 pt-1" style={EMOJI_GRID} onKeyDown={gridKeys('r', recent.length)}>{recent.map(cell('r'))}</div>
        </>
      )}
      <div className="px-2.5 pt-1.5 text-[11px] text-[var(--fg3)]" aria-live="polite">{term ? plural(list.length, 'result', 'results', { zero: `No emoji found for “${q.trim()}”` }) : catName(cat)}</div>
      <div ref={mainGrid} role="group" aria-label={term ? 'Results' : catName(cat)} className="grid max-h-[200px] gap-0.5 overflow-auto overscroll-contain p-2 [@media(pointer:coarse)]:max-h-[min(240px,40dvh)]" style={EMOJI_GRID}
        onKeyDown={gridKeys('g', list.length)}>
        {list.map(cell('g'))}
      </div>
    </div>
  )
}

/**
 * Text field with an emoji button: the picker inserts at the caret and remembers recent picks, and every pick also adds
 * a reaction chip with a count below (click a chip to take one back).
 */
export function EmojiInput({ placeholder: placeholderProp, onChange, className }: { placeholder?: string; onChange?: (text: string) => void; className?: string }) {
  const placeholder = placeholderProp ?? 'Add a reaction or type'
  const [text, setText] = useState('')
  const [open, setOpen] = useState(false)
  const [recent, setRecent] = useState<string[]>([])
  const [counts, setCounts] = useState<[string, number][]>([])
  const input = useRef<HTMLInputElement>(null), btn = useRef<HTMLButtonElement>(null), wrap = useRef<HTMLDivElement>(null)
  const caret = useRef<number | null>(null) // where the caret goes once the picked emoji is in the text
  useLayoutEffect(() => { const at = caret.current, el = input.current; if (at === null || !el) return; caret.current = null; el.focus(); el.setSelectionRange(at, at) }, [text])
  useOutside([wrap], () => setOpen(false), open)
  const pick = (e: string) => {
    const el = input.current, s = el?.selectionStart ?? text.length, en = el?.selectionEnd ?? text.length
    const next = text.slice(0, s) + e + text.slice(en)
    setText(next); onChange?.(next)
    setRecent(r => [e, ...r.filter(x => x !== e)].slice(0, 8))
    setCounts(c => c.some(([k]) => k === e) ? c.map(([k, n]) => [k, k === e ? n + 1 : n] as [string, number]) : [...c, [e, 1]])
    setOpen(false)
    caret.current = s + e.length
  }
  const unreact = (e: string) => setCounts(c => c.map(([k, n]) => [k, k === e ? n - 1 : n] as [string, number]).filter(([, n]) => n > 0))
  return (
    <div className={cn('flex flex-col gap-2.5', className)}>
      <div ref={wrap} className="relative">
        <input ref={input} value={text} onChange={e => { setText(e.target.value); onChange?.(e.target.value) }} placeholder={placeholder} aria-label={placeholder} className={cn(inputClass, '!pe-10')} />
        <motion.button ref={btn} type="button" whileTap={{ scale: 0.85 }} aria-label={'Pick emoji'} aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen(!open)}
          className="absolute top-1/2 end-1 grid h-7 w-7 -translate-y-1/2 cursor-pointer place-items-center rounded-[var(--r-md)] border-0 bg-transparent text-base hover:bg-[var(--muted)] [@media(pointer:coarse)]:h-8 [@media(pointer:coarse)]:w-8">😊</motion.button>
        <FloatingPanel open={open} placement="bottom-end" role="dialog" aria-label={'Emoji'} className="!p-0">
          <EmojiPicker recent={recent} onPick={pick} onClose={() => { setOpen(false); btn.current?.focus() }} />
        </FloatingPanel>
      </div>
      {counts.length > 0 && (
        <div className="flex flex-wrap gap-1.5" role="group" aria-label={'Reactions'}>
          <AnimatePresence initial={false} mode="popLayout">
            {counts.map(([e, n]) => (
              <motion.button type="button" key={e} layout initial={{ scale: 0.6, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.6, opacity: 0, transition: { duration: 0.12 } }} transition={spring(0.5, 0.35)}
                onClick={() => unreact(e)} aria-label={`${e} ${n}, remove one`}
                className="inline-flex cursor-pointer items-center gap-1 rounded-full border border-[var(--accent)] bg-[var(--accent-soft)] px-2 py-1 text-[13px] leading-none select-none">
                {e}
                <span className="relative inline-flex h-[1em] overflow-hidden font-[family-name:var(--mono)] text-[11px] font-medium text-[var(--fg2)]">
                  <motion.span key={n} initial={{ y: '-100%' }} animate={{ y: 0 }} transition={spring(0.3, 0.3)}>{n}</motion.span>
                </span>
              </motion.button>
            ))}
          </AnimatePresence>
        </div>
      )}
    </div>
  )
}
