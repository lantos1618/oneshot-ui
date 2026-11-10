import { memo, useCallback, useEffect, useId, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent, type ReactNode, type Ref } from 'react'
import { Badge, Button, IconButton, cn, clamp, defineMessages, inputClass, rowHoverClass, useCoarsePointer, useControllable, useLocale, useMessages, useWidth } from './core'
import { SegmentedControl, Switch } from './fields'
import { ContextMenu } from './overlay'
import { Tabs } from './navigation'
import { VIRTUAL_OVERSCAN, useVirtual } from './virtual'

/* ════════════════════════════════════════════════════════════════════════════
 * BINARY: look inside bytes. Pure helpers (entropy, Hilbert curve, strings, search, number decoders) and four views
 * that share a cursor and a selection:
 *
 *   <HexEditor data />      virtualised offset · hex · text rows (100 MB scrolls like 1 KB), selection, a data
 *                           inspector, overwrite editing with undo, search, go to, copy as hex / C / Base64
 *   <EntropyMap data />     Shannon entropy per window as a strip, with an offset ruler, section bands, a threshold
 *                           and the merged high-entropy regions (packed or encrypted data stands out)
 *   <ByteMap data />        the file folded onto a Hilbert curve on a canvas (neighbouring bytes stay neighbours),
 *                           coloured by entropy, section, byte class or strings
 *   <BinaryView data />     all of them linked: a hot spot in the map or the strip moves the hex editor there
 *
 * Data is a Uint8Array or ArrayBuffer and is never copied or stringified whole: the editor keeps edits in a patch map
 * over the original bytes, and every view renders only what is on screen. Data views stay left to right in every
 * locale (offsets and bytes are read like numbers); toolbars, legends and lists mirror.
 * ══════════════════════════════════════════════════════════════════════════ */

/* ── types ─────────────────────────────────────────────────────────────────── */

/** Bytes the binary views accept. Never copied: views read it in place. */
export type BinaryData = Uint8Array | ArrayBuffer
/** A section (or segment) of the file: `offset`/`size` in the file, optional `vaddr` (load address of its first byte) and `color` (CSS, default from the palette). */
export type BinarySection = { name: string; offset: number; size: number; color?: string; vaddr?: number }
/** A byte range, `end` exclusive. */
export type ByteRange = { start: number; end: number }
/** What a byte looks like: zero, printable ASCII (plus tab, LF, CR), other control characters, or ≥ 0x80. */
export type ByteClass = 'null' | 'ascii' | 'control' | 'high'
/** A highlighted range in the hex editor (an annotation, a hot spot from the entropy map): tinted with `color`, named `label`. */
export type BinaryHighlight = ByteRange & { color?: string; label?: string }

/* ── strings ───────────────────────────────────────────────────────────────── */

/** The binary views' strings (namespace `binary`): English, plus machine-drafted German and Arabic. */
export const BINARY_MESSAGES = defineMessages('binary', {
  en: {
    hexEditor: 'Hex editor', hexRole: 'hex editor',
    hexHelp: 'Arrow keys move the cursor, Shift extends the selection, Page Up and Page Down move by a screen, Tab switches between the hex and text columns. Type hex digits or text to overwrite. Ctrl+G goes to an offset, Ctrl+F searches, Ctrl+Z undoes.',
    hexHelpReadOnly: 'Arrow keys move the cursor, Shift extends the selection, Page Up and Page Down move by a screen, Tab switches between the hex and text columns. Ctrl+G goes to an offset, Ctrl+F searches.',
    cursorAt: 'Offset {offset}: {hex}', offset: 'Offset', vaddr: 'Address', text: 'Text', showVaddr: 'Show addresses', showOffsets: 'Show file offsets',
    goTo: 'Go to offset', goToPlaceholder: 'Go to 0x…', goToInvalid: 'Not an offset or address in this file',
    search: 'Search bytes', searchHex: 'Hex', searchText: 'Text', searchMode: 'Search as', searchPlaceholderHex: '7F 45 4C 46 or 48 ?? 89', searchPlaceholderText: 'Text to find',
    matchOf: '{index} of {count}', noMatches: 'No matches', manyMatches: '{count}+ matches', badPattern: 'Use hex pairs such as 7F 45, ?? for any byte',
    nextMatch: 'Next match', prevMatch: 'Previous match',
    copyHex: 'Copy as hex', copyC: 'Copy as C array', copyBase64: 'Copy as Base64', copyText: 'Copy as text', copied: 'Copied {size}', copiedPart: 'Copied the first {size}',
    selectAll: 'Select all', selectSection: 'Select {name}', selectToHere: 'Select from cursor to here', followU32: 'Go to u32 at cursor ({value})',
    undo: 'Undo', redo: 'Redo', revert: 'Revert all edits', edits: '{count, plural, one {# edit} other {# edits}}',
    overwrite: 'OVR', overwriteTitle: 'Overwrite mode: typing replaces bytes', readOnly: 'Read only',
    showText: 'Text column', inspector: 'Data inspector', byteOrder: 'Byte order', little: 'LE', big: 'BE',
    selection: '{start}–{end}, {size}', noSection: 'no section', notEnough: 'Not enough bytes',
    binary: 'Bits', char: 'Char', unixTime: 'Unix time', varint: 'Varint', zigzag: 'Zigzag',
    entropyMap: 'Entropy map', entropyRole: 'entropy map', entropyAxis: 'Entropy', sections: 'Sections',
    entropySummary: '{count, plural, one {# window} other {# windows}} of {size}; {high, plural, =0 {none above {threshold} bits} one {# region above {threshold} bits} other {# regions above {threshold} bits}}.',
    bits: '{value} bits', threshold: 'Threshold', highEntropy: 'High entropy', highNone: 'Nothing above {threshold} bits',
    highMore: '{count, plural, one {# more region} other {# more regions}}', hoverStrip: 'Hover or tap the strip', regionAt: '{range}, {section}, {bits}',
    byteMap: 'Byte map', mapRole: 'byte map', mapSummary: '{size} on a Hilbert curve of {side} × {side} cells, {perCell} each.',
    perCell: '{count, plural, one {# byte} other {# bytes}}', colourBy: 'Colour by', hoverMap: 'Hover or tap a cell', zoomHint: 'Ctrl + scroll zooms',
    modeEntropy: 'Entropy', modeSections: 'Sections', modeClass: 'Bytes', modeStrings: 'Strings',
    classNull: 'Zero', classAscii: 'Printable', classControl: 'Control', classHigh: 'High (≥ 80)', inString: 'In a string', notString: 'Other',
    low: 'low', high: 'high', zoomIn: 'Zoom in', zoomOut: 'Zoom out', zoomReset: 'Whole file', showing: 'Showing {range}',
    binaryView: 'Binary explorer', tabMap: 'Map', tabEntropy: 'Entropy', tabHex: 'Hex', showInHex: 'Show in hex', fileSummary: '{size} · {count, plural, one {# section} other {# sections}}',
  },
  de: {
    hexEditor: 'Hex-Editor', hexRole: 'Hex-Editor',
    hexHelp: 'Pfeiltasten bewegen den Cursor, Umschalt erweitert die Auswahl, Bild auf und Bild ab blättern, Tab wechselt zwischen Hex- und Textspalte. Hex-Ziffern oder Text tippen überschreibt. Strg+G springt zu einem Offset, Strg+F sucht, Strg+Z macht rückgängig.',
    hexHelpReadOnly: 'Pfeiltasten bewegen den Cursor, Umschalt erweitert die Auswahl, Bild auf und Bild ab blättern, Tab wechselt zwischen Hex- und Textspalte. Strg+G springt zu einem Offset, Strg+F sucht.',
    cursorAt: 'Offset {offset}: {hex}', offset: 'Offset', vaddr: 'Adresse', text: 'Text', showVaddr: 'Adressen zeigen', showOffsets: 'Datei-Offsets zeigen',
    goTo: 'Gehe zu Offset', goToPlaceholder: 'Gehe zu 0x…', goToInvalid: 'Kein Offset und keine Adresse in dieser Datei',
    search: 'Bytes suchen', searchHex: 'Hex', searchText: 'Text', searchMode: 'Suchen als', searchPlaceholderHex: '7F 45 4C 46 oder 48 ?? 89', searchPlaceholderText: 'Gesuchter Text',
    matchOf: '{index} von {count}', noMatches: 'Keine Treffer', manyMatches: '{count}+ Treffer', badPattern: 'Hex-Paare wie 7F 45 verwenden, ?? für ein beliebiges Byte',
    nextMatch: 'Nächster Treffer', prevMatch: 'Vorheriger Treffer',
    copyHex: 'Als Hex kopieren', copyC: 'Als C-Array kopieren', copyBase64: 'Als Base64 kopieren', copyText: 'Als Text kopieren', copied: '{size} kopiert', copiedPart: 'Die ersten {size} kopiert',
    selectAll: 'Alles auswählen', selectSection: '{name} auswählen', selectToHere: 'Vom Cursor bis hier auswählen', followU32: 'Zu u32 am Cursor springen ({value})',
    undo: 'Rückgängig', redo: 'Wiederholen', revert: 'Alle Änderungen verwerfen', edits: '{count, plural, one {# Änderung} other {# Änderungen}}',
    overwrite: 'ÜB', overwriteTitle: 'Überschreibmodus: Tippen ersetzt Bytes', readOnly: 'Schreibgeschützt',
    showText: 'Textspalte', inspector: 'Dateninspektor', byteOrder: 'Byte-Reihenfolge', little: 'LE', big: 'BE',
    selection: '{start}–{end}, {size}', noSection: 'kein Abschnitt', notEnough: 'Nicht genug Bytes',
    binary: 'Bits', char: 'Zeichen', unixTime: 'Unix-Zeit', varint: 'Varint', zigzag: 'Zigzag',
    entropyMap: 'Entropiekarte', entropyRole: 'Entropiekarte', entropyAxis: 'Entropie', sections: 'Abschnitte',
    entropySummary: '{count, plural, one {# Fenster} other {# Fenster}} zu {size}; {high, plural, =0 {nichts über {threshold} Bit} one {# Bereich über {threshold} Bit} other {# Bereiche über {threshold} Bit}}.',
    bits: '{value} Bit', threshold: 'Schwelle', highEntropy: 'Hohe Entropie', highNone: 'Nichts über {threshold} Bit',
    highMore: '{count, plural, one {# weiterer Bereich} other {# weitere Bereiche}}', hoverStrip: 'Streifen berühren oder darüberfahren', regionAt: '{range}, {section}, {bits}',
    byteMap: 'Byte-Karte', mapRole: 'Byte-Karte', mapSummary: '{size} auf einer Hilbert-Kurve mit {side} × {side} Zellen, je {perCell}.',
    perCell: '{count, plural, one {# Byte} other {# Bytes}}', colourBy: 'Färben nach', hoverMap: 'Zelle berühren oder darüberfahren', zoomHint: 'Strg + Scrollen zoomt',
    modeEntropy: 'Entropie', modeSections: 'Abschnitte', modeClass: 'Bytes', modeStrings: 'Strings',
    classNull: 'Null', classAscii: 'Druckbar', classControl: 'Steuerzeichen', classHigh: 'Hoch (≥ 80)', inString: 'In einem String', notString: 'Andere',
    low: 'niedrig', high: 'hoch', zoomIn: 'Vergrößern', zoomOut: 'Verkleinern', zoomReset: 'Ganze Datei', showing: 'Zeigt {range}',
    binaryView: 'Binär-Explorer', tabMap: 'Karte', tabEntropy: 'Entropie', tabHex: 'Hex', showInHex: 'Im Hex-Editor zeigen', fileSummary: '{size} · {count, plural, one {# Abschnitt} other {# Abschnitte}}',
  },
  ar: {
    hexEditor: 'محرر سداسي عشري', hexRole: 'محرر سداسي عشري',
    hexHelp: 'تحرّك مفاتيح الأسهم المؤشر، ويوسّع Shift التحديد، وينتقل Page Up وPage Down بشاشة كاملة، ويبدّل Tab بين عمود الست عشري وعمود النص. اكتب أرقامًا ست عشرية أو نصًا للاستبدال. Ctrl+G للانتقال إلى إزاحة، وCtrl+F للبحث، وCtrl+Z للتراجع.',
    hexHelpReadOnly: 'تحرّك مفاتيح الأسهم المؤشر، ويوسّع Shift التحديد، وينتقل Page Up وPage Down بشاشة كاملة، ويبدّل Tab بين عمود الست عشري وعمود النص. Ctrl+G للانتقال إلى إزاحة، وCtrl+F للبحث.',
    cursorAt: 'الإزاحة {offset}: {hex}', offset: 'الإزاحة', vaddr: 'العنوان', text: 'نص', showVaddr: 'إظهار العناوين', showOffsets: 'إظهار إزاحات الملف',
    goTo: 'الانتقال إلى إزاحة', goToPlaceholder: 'انتقل إلى 0x…', goToInvalid: 'ليست إزاحة أو عنوانًا في هذا الملف',
    search: 'البحث في البايتات', searchHex: 'ست عشري', searchText: 'نص', searchMode: 'البحث كـ', searchPlaceholderHex: '7F 45 4C 46 أو 48 ?? 89', searchPlaceholderText: 'النص المطلوب',
    matchOf: '{index} من {count}', noMatches: 'لا نتائج', manyMatches: 'أكثر من {count} نتيجة', badPattern: 'استخدم أزواجًا ست عشرية مثل 7F 45، و?? لأي بايت',
    nextMatch: 'النتيجة التالية', prevMatch: 'النتيجة السابقة',
    copyHex: 'نسخ كست عشري', copyC: 'نسخ كمصفوفة C', copyBase64: 'نسخ كـ Base64', copyText: 'نسخ كنص', copied: 'تم نسخ {size}', copiedPart: 'تم نسخ أول {size}',
    selectAll: 'تحديد الكل', selectSection: 'تحديد {name}', selectToHere: 'التحديد من المؤشر حتى هنا', followU32: 'الانتقال إلى قيمة u32 عند المؤشر ({value})',
    undo: 'تراجع', redo: 'إعادة', revert: 'إلغاء كل التعديلات', edits: '{count, plural, zero {لا تعديلات} one {تعديل واحد} two {تعديلان} few {# تعديلات} many {# تعديلًا} other {# تعديل}}',
    overwrite: 'استبدال', overwriteTitle: 'وضع الاستبدال: الكتابة تستبدل البايتات', readOnly: 'للقراءة فقط',
    showText: 'عمود النص', inspector: 'فاحص البيانات', byteOrder: 'ترتيب البايتات', little: 'LE', big: 'BE',
    selection: '{start}–{end}، {size}', noSection: 'بلا قسم', notEnough: 'لا توجد بايتات كافية',
    binary: 'بتات', char: 'محرف', unixTime: 'وقت يونكس', varint: 'Varint', zigzag: 'Zigzag',
    entropyMap: 'خريطة الإنتروبيا', entropyRole: 'خريطة الإنتروبيا', entropyAxis: 'الإنتروبيا', sections: 'الأقسام',
    entropySummary: '{count, plural, one {نافذة واحدة} other {# نافذة}} بحجم {size}؛ {high, plural, =0 {لا شيء فوق {threshold} بت} one {منطقة واحدة فوق {threshold} بت} other {# مناطق فوق {threshold} بت}}.',
    bits: '{value} بت', threshold: 'العتبة', highEntropy: 'إنتروبيا عالية', highNone: 'لا شيء فوق {threshold} بت',
    highMore: '{count, plural, one {منطقة أخرى} other {# مناطق أخرى}}', hoverStrip: 'مرّر فوق الشريط أو المسه', regionAt: '{range}، {section}، {bits}',
    byteMap: 'خريطة البايتات', mapRole: 'خريطة البايتات', mapSummary: '{size} على منحنى هيلبرت من {side} × {side} خلية، {perCell} لكل خلية.',
    perCell: '{count, plural, one {بايت واحد} other {# بايت}}', colourBy: 'التلوين حسب', hoverMap: 'مرّر فوق خلية أو المسها', zoomHint: 'Ctrl مع التمرير للتكبير',
    modeEntropy: 'الإنتروبيا', modeSections: 'الأقسام', modeClass: 'البايتات', modeStrings: 'السلاسل',
    classNull: 'صفر', classAscii: 'قابل للطباعة', classControl: 'تحكم', classHigh: 'مرتفع (≥ 80)', inString: 'ضمن سلسلة', notString: 'غير ذلك',
    low: 'منخفضة', high: 'مرتفعة', zoomIn: 'تكبير', zoomOut: 'تصغير', zoomReset: 'الملف كاملًا', showing: 'يعرض {range}',
    binaryView: 'مستكشف الملفات الثنائية', tabMap: 'الخريطة', tabEntropy: 'الإنتروبيا', tabHex: 'ست عشري', showInHex: 'إظهار في المحرر', fileSummary: '{size} · {count, plural, one {قسم واحد} other {# أقسام}}',
  },
})

/* ── pure helpers ──────────────────────────────────────────────────────────── */

/** The bytes of `data` as a Uint8Array view (no copy for Uint8Array, ArrayBuffer or other typed arrays; plain arrays are copied). */
export function toByteArray(data: BinaryData | ArrayBufferView | ArrayLike<number>): Uint8Array {
  if (data instanceof Uint8Array) return data
  if (data instanceof ArrayBuffer) return new Uint8Array(data)
  if (ArrayBuffer.isView(data)) return new Uint8Array(data.buffer, data.byteOffset, data.byteLength)
  return Uint8Array.from(data as ArrayLike<number>)
}

/** "00" … "FF", by byte value. */
const BIN_HEX: readonly string[] = Array.from({ length: 256 }, (_, i) => i.toString(16).toUpperCase().padStart(2, '0'))
/** `n` in upper-case hex, zero-padded to `width` digits: hexOffset(0x360, 8) → "00000360". */
export const hexOffset = (n: number, width = 0) => Math.max(0, Math.floor(n)).toString(16).toUpperCase().padStart(width, '0')

/** `c · log2(c)` for counts up to `w` and its forward differences, cached per window size (the entropy loops add and subtract these). */
const binPlogpCache = new Map<number, Float64Array>()
function binPlogpDiff(w: number): Float64Array {
  let d = binPlogpCache.get(w)
  if (!d) {
    d = new Float64Array(w + 1)
    for (let c = 0; c < w; c++) d[c] = (c + 1) * Math.log2(c + 1) - (c ? c * Math.log2(c) : 0)
    if (binPlogpCache.size > 16) binPlogpCache.clear()
    binPlogpCache.set(w, d)
  }
  return d
}

/** Shannon entropy of `bytes[start, end)` in bits per byte: 0 (one value repeated) to 8 (every value equally often). */
export function shannonEntropy(data: BinaryData, start = 0, end?: number): number {
  const b = toByteArray(data), a = clamp(Math.floor(start), 0, b.length), z = clamp(Math.floor(end ?? b.length), a, b.length), n = z - a
  if (n <= 0) return 0
  const h = new Uint32Array(256)
  for (let i = a; i < z; i++) h[b[i]]++
  let s = 0
  for (let k = 0; k < 256; k++) { const c = h[k]; if (c) s += c * Math.log2(c) }
  return clamp(Math.log2(n) - s / n, 0, 8)
}

/** Options of entropyWindows. `align: 'center'` centres each window on its step (cells of a map); default 'start'. */
export type EntropyWindowOptions = { align?: 'start' | 'center' }

/**
 * Shannon entropy (0–8 bits) of a sliding window: window `i` covers `[i·step, i·step + windowSize)` (clipped to the
 * data; `align: 'center'` centres it on `[i·step, (i+1)·step)`), one value per step, `ceil(length / step)` values.
 * One pass with a 256-bin histogram and a running Σ c·log2 c, so each byte is added and removed once: O(n) whatever
 * the window, about 1 ns per byte (100 MB in a few hundred ms).
 */
export function entropyWindows(data: BinaryData, windowSize = 512, step?: number, { align = 'start' }: EntropyWindowOptions = {}): Float32Array {
  const b = toByteArray(data), n = b.length, w = Math.max(1, Math.floor(windowSize)), st = Math.max(1, Math.floor(step ?? w))
  const count = n ? Math.ceil(n / st) : 0, out = new Float32Array(count)
  const d = binPlogpDiff(w), h = new Int32Array(256), shift = align === 'center' ? Math.floor((st - w) / 2) : 0
  let lo = 0, hi = 0, S = 0
  for (let i = 0; i < count; i++) {
    const a = Math.max(0, Math.min(n, i * st + shift)), z = Math.max(a, Math.min(n, i * st + shift + w))
    if (a >= hi) { if (hi > lo) { h.fill(0); S = 0 } lo = hi = a } // no overlap with the last window: start afresh
    while (lo < a) { const v = b[lo++], c = h[v]; S -= d[c - 1]; h[v] = c - 1 }
    while (hi < z) { const v = b[hi++], c = h[v]; S += d[c]; h[v] = c + 1 }
    const N = z - a
    out[i] = N > 0 ? Math.min(8, Math.max(0, Math.log2(N) - S / N)) : 0
  }
  return out
}

/** A run of windows at or above the threshold: byte range, size, highest and mean entropy, first and last window. */
export type EntropyRegion = { start: number; end: number; size: number; max: number; mean: number; windows: [first: number, last: number] }

/**
 * Merge consecutive windows with entropy ≥ `threshold` (default 7.2 bits) into regions. `windowSize`/`step` must match
 * entropyWindows; `length` (the data size) clips the last region. `gap` lets that many lower windows sit inside a region.
 */
export function highEntropyRegions(entropy: ArrayLike<number>, { windowSize = 512, step, threshold = 7.2, length, gap = 0 }:
  { windowSize?: number; step?: number; threshold?: number; length?: number; gap?: number } = {}): EntropyRegion[] {
  const st = step ?? windowSize, out: EntropyRegion[] = [], n = entropy.length
  const total = length ?? (n ? (n - 1) * st + windowSize : 0)
  let i = 0
  while (i < n) {
    if (!(entropy[i] >= threshold)) { i++; continue }
    let j = i, last = i, mx = 0, sum = 0, cnt = 0
    while (j < n && j - last <= gap + 1) {
      if (entropy[j] >= threshold) { for (let k = last + 1; k < j; k++) { sum += entropy[k]; cnt++ } last = j; mx = Math.max(mx, entropy[j]); sum += entropy[j]; cnt++ }
      j++
    }
    const start = i * st, end = Math.min(total, last * st + windowSize)
    out.push({ start, end, size: end - start, max: mx, mean: sum / cnt, windows: [i, last] })
    i = last + 1
  }
  return out
}

/** Distance `d` along a Hilbert curve of 2^order × 2^order cells → its [x, y] cell (inverse of hilbertXY2D). */
export function hilbertD2XY(order: number, d: number): [number, number] {
  const n = 2 ** order
  let x = 0, y = 0, t = d
  for (let s = 1; s < n; s *= 2) {
    const rx = 1 & Math.floor(t / 2), ry = 1 & (t ^ rx)
    if (ry === 0) { if (rx === 1) { x = s - 1 - x; y = s - 1 - y } const tmp = x; x = y; y = tmp }
    x += s * rx; y += s * ry; t = Math.floor(t / 4)
  }
  return [x, y]
}

/** Cell [x, y] of a Hilbert curve of 2^order × 2^order cells → its distance along the curve (inverse of hilbertD2XY). */
export function hilbertXY2D(order: number, x: number, y: number): number {
  const n = 2 ** order
  let d = 0
  for (let s = n / 2; s >= 1; s /= 2) {
    const rx = (x & s) > 0 ? 1 : 0, ry = (y & s) > 0 ? 1 : 0
    d += s * s * ((3 * rx) ^ ry)
    if (ry === 0) { if (rx === 1) { x = n - 1 - x; y = n - 1 - y } const tmp = x; x = y; y = tmp }
  }
  return d
}

/** x and y of every cell along the curve, cached per order (order 8: 65 536 cells). */
const binHilbertCache = new Map<number, Uint16Array>()
function binHilbertLut(order: number): Uint16Array {
  let lut = binHilbertCache.get(order)
  if (!lut) {
    const cells = 4 ** order
    lut = new Uint16Array(cells * 2)
    for (let d = 0; d < cells; d++) { const [x, y] = hilbertD2XY(order, d); lut[d * 2] = x; lut[d * 2 + 1] = y }
    binHilbertCache.set(order, lut)
  }
  return lut
}

/** Classify one byte: 0 → 'null', 0x20–0x7E plus tab/LF/CR → 'ascii', other values below 0x20 and 0x7F → 'control', ≥ 0x80 → 'high'. */
export const classifyByte = (b: number): ByteClass => b === 0 ? 'null' : (b >= 0x20 && b < 0x7f) || b === 9 || b === 10 || b === 13 ? 'ascii' : b < 0x80 ? 'control' : 'high'
const BIN_CLASSES: readonly ByteClass[] = ['null', 'ascii', 'control', 'high']
const BIN_CLASS_IDX = Uint8Array.from({ length: 256 }, (_, b) => BIN_CLASSES.indexOf(classifyByte(b)))
const binPrintable = (b: number) => b >= 0x20 && b < 0x7f

/** A string found in binary data: byte `offset`, byte `length`, the decoded `text` and its encoding. */
export type FoundString = { offset: number; length: number; text: string; encoding: 'ascii' | 'utf16le' }
/** Options of findStrings: minimum characters (`min`, default 4), `encodings`, a byte range, a cap on results (`max`, default 100 000) and on each text (`maxLength` characters, default 256). */
export type FindStringsOptions = { min?: number; encodings?: readonly ('ascii' | 'utf16le')[]; start?: number; end?: number; max?: number; maxLength?: number }

/**
 * Printable runs (like `strings`): ASCII (0x20–0x7E and tab) of at least `min` characters, and UTF-16LE runs (a
 * printable byte then 0x00) of at least `min` characters. Sorted by offset; stops after `max` results.
 */
export function findStrings(data: BinaryData, { min = 4, encodings = ['ascii', 'utf16le'], start = 0, end, max = 100_000, maxLength = 256 }: FindStringsOptions = {}): FoundString[] {
  const b = toByteArray(data), a = clamp(start, 0, b.length), z = clamp(end ?? b.length, a, b.length), out: FoundString[] = []
  const text = (o: number, len: number, stride: number) => { let s = ''; for (let i = 0; i < Math.min(len, maxLength); i++) s += String.fromCharCode(b[o + i * stride]); return s }
  const ok = (v: number) => binPrintable(v) || v === 9
  if (encodings.includes('ascii')) {
    let run = -1
    for (let i = a; i <= z && out.length < max; i++) {
      if (i < z && ok(b[i])) { if (run < 0) run = i; continue }
      if (run >= 0 && i - run >= min) out.push({ offset: run, length: i - run, text: text(run, i - run, 1), encoding: 'ascii' })
      run = -1
    }
  }
  if (encodings.includes('utf16le')) {
    const wide: FoundString[] = []
    for (const phase of [0, 1]) {
      let run = -1
      for (let i = a + phase; i + 1 <= z && wide.length < max; i += 2) {
        if (i + 1 < z && ok(b[i]) && b[i + 1] === 0) { if (run < 0) run = i; continue }
        if (run >= 0 && (i - run) / 2 >= min) wide.push({ offset: run, length: i - run, text: text(run, (i - run) / 2, 2), encoding: 'utf16le' })
        run = -1
      }
    }
    out.push(...wide)
    out.sort((p, q) => p.offset - q.offset)
    if (out.length > max) out.length = max
  }
  return out
}

/** The section containing byte `offset` (the smallest, when sections nest), or undefined. */
export function sectionAt<S extends BinarySection>(sections: readonly S[] | undefined, offset: number): S | undefined {
  let best: S | undefined
  if (sections) for (const s of sections) if (offset >= s.offset && offset < s.offset + s.size && (!best || s.size < best.size)) best = s
  return best
}

/**
 * Parse a hex byte pattern: pairs of hex digits, `??` for any byte; spaces, commas, `0x` and `\x` are ignored.
 * "7F 45 ?? 46" → [0x7F, 0x45, -1, 0x46]. Null when it isn't one.
 */
export function parseHexPattern(s: string): number[] | null {
  const t = s.replace(/0x|\\x/gi, '').replace(/[\s,]/g, '')
  if (!t || !/^([0-9a-f]{2}|\?\?)+$/i.test(t)) return null
  const out: number[] = []
  for (let i = 0; i < t.length; i += 2) out.push(t[i] === '?' ? -1 : parseInt(t.slice(i, i + 2), 16))
  return out
}

/** Options of searchBytes: how a string pattern is read (`as`, default 'text'), ASCII case folding for text, a range to search and a cap on matches (default 10 000). */
export type SearchBytesOptions = { as?: 'text' | 'hex'; ignoreCase?: boolean; from?: number; to?: number; max?: number }
/** A search pattern as bytes (-1: any byte), or null when a hex string doesn't parse. */
function binPattern(pattern: Uint8Array | readonly number[] | string, as: 'text' | 'hex'): number[] | null {
  if (typeof pattern !== 'string') return Array.from(pattern)
  if (as === 'hex') return parseHexPattern(pattern)
  return pattern ? Array.from(new TextEncoder().encode(pattern)) : null
}
const binFold = (v: number) => (v >= 0x41 && v <= 0x5a ? v + 32 : v)

/**
 * Every offset where `pattern` occurs (overlapping matches included), ascending. `pattern` is bytes, or a string read
 * as UTF-8 text (`as: 'text'`, default) or as a hex pattern with `??` wildcards (`as: 'hex'`). Uses the native
 * `indexOf` to find candidates, so 100 MB is searched in tens of milliseconds.
 */
export function searchBytes(data: BinaryData, pattern: Uint8Array | readonly number[] | string, { as = 'text', ignoreCase = false, from = 0, to, max = 10_000 }: SearchBytesOptions = {}): number[] {
  const b = toByteArray(data), p = binPattern(pattern, as), out: number[] = []
  if (!p || !p.length) return out
  const end = clamp(to ?? b.length, 0, b.length) - p.length
  const fold = ignoreCase && typeof pattern === 'string' && as === 'text'
  const q = fold ? p.map(binFold) : p
  const k = q.findIndex(v => v >= 0)
  const match = (o: number) => { for (let j = 0; j < q.length; j++) { const v = q[j]; if (v >= 0 && (fold ? binFold(b[o + j]) : b[o + j]) !== v) return false } return true }
  if (k < 0) { for (let o = Math.max(0, from); o <= end && out.length < max; o++) out.push(o); return out }
  const first = q[k], other = fold && first >= 0x61 && first <= 0x7a ? first - 32 : -1
  let o = Math.max(0, from)
  while (o <= end && out.length < max) {
    let at = b.indexOf(first, o + k) - k
    if (other >= 0) { const at2 = b.indexOf(other, o + k) - k; if (at2 >= o && (at < o || at2 < at)) at = at2 }
    if (at < o || at > end) break
    if (match(at)) out.push(at)
    o = at + 1
  }
  return out
}

/** Every number the data inspector shows for the bytes at an offset (null where there aren't enough bytes). */
export type BinaryDecoded = {
  u8: number | null; i8: number | null; u16: number | null; i16: number | null; u32: number | null; i32: number | null
  u64: bigint | null; i64: bigint | null; f32: number | null; f64: number | null
  /** u32 seconds since 1970 */ unix32: Date | null
  /** i64 seconds since 1970, when in Date's range */ unix64: Date | null
  /** unsigned LEB128 (protobuf, WebAssembly, DWARF) and its byte length */ varint: { value: bigint; length: number } | null
  /** the varint read as zigzag-encoded signed */ zigzag: bigint | null
  /** the byte's bits, most significant first */ binary: string | null
}

/** Unsigned LEB128 at `offset` (up to 10 bytes): its value and length, or null if it runs past the data. */
export function readVarint(data: BinaryData, offset: number): { value: bigint; length: number } | null {
  const b = toByteArray(data)
  let v = 0n, shift = 0n
  for (let i = 0; i < 10 && offset + i < b.length; i++) {
    const x = b[offset + i]
    v |= BigInt(x & 0x7f) << shift
    if (!(x & 0x80)) return { value: v, length: i + 1 }
    shift += 7n
  }
  return null
}

/** Decode the bytes at `offset` as every inspector type, little-endian unless `littleEndian` is false. */
export function decodeBytes(data: BinaryData, offset: number, littleEndian = true): BinaryDecoded {
  const b = toByteArray(data), dv = new DataView(b.buffer, b.byteOffset, b.byteLength), o = Math.floor(offset)
  const has = (k: number) => o >= 0 && o + k <= b.length
  const date = (s: number | bigint | null) => { if (s === null) return null; const ms = Number(s) * 1000; return Math.abs(ms) <= 8.64e15 ? new Date(ms) : null }
  const u32 = has(4) ? dv.getUint32(o, littleEndian) : null, i64 = has(8) ? dv.getBigInt64(o, littleEndian) : null
  const varint = has(1) ? readVarint(b, o) : null
  return {
    u8: has(1) ? b[o] : null, i8: has(1) ? dv.getInt8(o) : null,
    u16: has(2) ? dv.getUint16(o, littleEndian) : null, i16: has(2) ? dv.getInt16(o, littleEndian) : null,
    u32, i32: has(4) ? dv.getInt32(o, littleEndian) : null,
    u64: has(8) ? dv.getBigUint64(o, littleEndian) : null, i64,
    f32: has(4) ? dv.getFloat32(o, littleEndian) : null, f64: has(8) ? dv.getFloat64(o, littleEndian) : null,
    unix32: date(u32), unix64: date(i64), varint, zigzag: varint ? (varint.value >> 1n) ^ -(varint.value & 1n) : null,
    binary: has(1) ? b[o].toString(2).padStart(8, '0') : null,
  }
}

/** Copy formats: space-separated hex (16 per line), a C array, Base64, or text (non-printable bytes as dots). */
export type ByteCopyFormat = 'hex' | 'c' | 'base64' | 'text'

/** Format bytes for the clipboard. `name` names the C array (default `data`). */
export function formatBytesAs(data: BinaryData, format: ByteCopyFormat, name = 'data'): string {
  const b = toByteArray(data), parts: string[] = []
  if (format === 'base64') {
    let bin = ''
    for (let i = 0; i < b.length; i += 0x8000) bin += String.fromCharCode.apply(null, Array.from(b.subarray(i, i + 0x8000)))
    return btoa(bin)
  }
  if (format === 'text') { for (let i = 0; i < b.length; i++) parts.push(binPrintable(b[i]) ? String.fromCharCode(b[i]) : '.'); return parts.join('') }
  if (format === 'c') {
    for (let i = 0; i < b.length; i += 12) parts.push('  ' + Array.from(b.subarray(i, i + 12), v => '0x' + BIN_HEX[v].toLowerCase()).join(', '))
    return `unsigned char ${name}[${b.length}] = {\n${parts.join(',\n')}\n};`
  }
  for (let i = 0; i < b.length; i += 16) parts.push(Array.from(b.subarray(i, i + 16), v => BIN_HEX[v]).join(' '))
  return parts.join('\n')
}

/**
 * Parse what someone typed into "go to": `0x1F40`, `1F40h` or digits with a-f → hex; plain digits → decimal;
 * a leading `+`/`-` is relative to `cursor`. A value past the end of the file that falls inside a section's `vaddr`
 * range is read as an address and mapped to its file offset. Null when it lands outside the file.
 */
export function parseByteOffset(input: string, { size, cursor = 0, sections }: { size: number; cursor?: number; sections?: readonly BinarySection[] }): number | null {
  const s = input.trim().replace(/_/g, '')
  const m = /^([+-]?)\s*(0x[0-9a-f]+|[0-9a-f]+h|[0-9]*[a-f][0-9a-f]*|[0-9]+)$/i.exec(s)
  if (!m) return null
  const body = m[2], hex = /^0x/i.test(body) || /h$/i.test(body) || /[a-f]/i.test(body)
  const n = parseInt(body.replace(/^0x/i, '').replace(/h$/i, ''), hex ? 16 : 10)
  if (!Number.isFinite(n)) return null
  let v = m[1] === '+' ? cursor + n : m[1] === '-' ? cursor - n : n
  if (!m[1] && v >= size && sections) { const sec = sections.find(x => x.vaddr !== undefined && v >= x.vaddr && v < x.vaddr + x.size); if (sec) v = sec.offset + v - sec.vaddr! }
  return v >= 0 && v < Math.max(1, size) ? v : null
}

/* ── colours ───────────────────────────────────────────────────────────────── */

/** Default section colours (theme tokens), by section index. */
const BIN_SECTION_PALETTE = ['var(--c2)', 'var(--c4)', 'var(--c3)', 'var(--warn)', 'var(--c-neutral)', 'var(--bad)', 'var(--c1)', 'color-mix(in srgb, var(--c2) 50%, var(--c4))']
/** A section's colour: its own `color`, else the palette by index. */
export const binarySectionColor = (sections: readonly BinarySection[], i: number) => sections[i]?.color ?? BIN_SECTION_PALETTE[i % BIN_SECTION_PALETTE.length]
/** The entropy colour scale (bits → token): grey for zero runs, blue for code and text, orange then red for packed or encrypted data. */
const BIN_ENTROPY_STOPS: readonly [number, string][] = [[0, 'var(--muted)'], [4, 'color-mix(in srgb, var(--c2) 45%, var(--muted))'], [6.4, 'var(--c2)'], [7.2, 'var(--c3)'], [8, 'var(--bad)']]
/** The CSS colour for `bits` of entropy (0–8) on the shared scale, in 10% steps (theme-aware: tokens, no fixed colours). */
export function entropyColor(bits: number): string {
  const v = clamp(bits, 0, 8), S = BIN_ENTROPY_STOPS
  let i = 0
  while (i < S.length - 2 && v > S[i + 1][0]) i++
  const [a, ca] = S[i], [z, cz] = S[i + 1], pct = Math.round(((v - a) / (z - a)) * 10) * 10
  return pct <= 0 ? ca : pct >= 100 ? cz : `color-mix(in srgb, ${cz} ${pct}%, ${ca})`
}
/** The scale as a CSS gradient (legend bars). */
const binEntropyGradient = (dir: string) => `linear-gradient(${dir}, ${BIN_ENTROPY_STOPS.map(([b, c]) => `${c} ${(b / 8) * 100}%`).join(', ')})`
/** Byte-class text colours in the hex editor (mixed with --fg so each stays ≥ 4.5:1 on cards). */
const BIN_CLASS_TEXT: Record<ByteClass, string> = {
  null: 'text-[var(--fg3)]', ascii: 'text-[color-mix(in_srgb,var(--c2)_75%,var(--fg))]',
  control: 'text-[color-mix(in_srgb,var(--c4)_70%,var(--fg))]', high: 'text-[color-mix(in_srgb,var(--c3)_70%,var(--fg))]',
}
/** Byte-class colours for the map and legends. */
const BIN_CLASS_FILL: Record<ByteClass, string> = { null: 'var(--line)', ascii: 'var(--c2)', control: 'var(--c4)', high: 'var(--c3)' }

type BinRgb = [number, number, number]
/** Resolve any CSS colour (tokens, color-mix) to RGB against an element, for canvas drawing. */
function binRgb(el: HTMLElement, css: string): BinRgb {
  el.style.color = ''; el.style.color = css
  const c = getComputedStyle(el).color
  el.style.color = ''
  const srgb = /color\(srgb\s+([\d.e-]+)\s+([\d.e-]+)\s+([\d.e-]+)/.exec(c)
  if (srgb) return [+srgb[1] * 255, +srgb[2] * 255, +srgb[3] * 255]
  const m = c.match(/[\d.]+/g)
  return m && m.length >= 3 ? [+m[0], +m[1], +m[2]] : [128, 128, 128]
}
const binMix = (a: BinRgb, b: BinRgb, t: number): BinRgb => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]

/** Bumps when the theme may have changed (data-theme/class/style on <html> or the provider root, or the OS scheme), so canvases re-read tokens. */
function useBinThemeTick(ref: { current: Element | null }) {
  const [tick, setTick] = useState(0)
  useEffect(() => {
    const bump = () => setTick(t => t + 1)
    const mo = new MutationObserver(bump), opts = { attributes: true, attributeFilter: ['data-theme', 'class', 'style'] }
    mo.observe(document.documentElement, opts)
    const root = ref.current?.closest('.ui-root')
    if (root && root !== document.documentElement) mo.observe(root, opts)
    const mq = matchMedia('(prefers-color-scheme: dark)')
    mq.addEventListener?.('change', bump)
    return () => { mo.disconnect(); mq.removeEventListener?.('change', bump) }
  }, [ref])
  return tick
}

const BIN_NO_SECTIONS: readonly BinarySection[] = []
const BIN_NO_HIGHLIGHTS: readonly BinaryHighlight[] = []
const BIN_NO_MATCHES: readonly number[] = []
const binRange = (a: number, b: number): ByteRange => ({ start: Math.min(a, b), end: Math.max(a, b) + 1 })
const binSameRange = (a: ByteRange | null | undefined, b: ByteRange | null | undefined) => (!a && !b) || (!!a && !!b && a.start === b.start && a.end === b.end)
/** Bits as "7.58" (two decimals, fixed: entropy reads like a measurement). */
const binBits = (v: number) => v.toFixed(2)

/* ════════════════════════════════════════════════════════════════════════════
 * HexEditor
 * ══════════════════════════════════════════════════════════════════════════ */

/** One effective edit: the byte at `offset` was `before` in the data and is now `after`. */
export type HexEdit = { offset: number; before: number; after: number }

/** Imperative handle of HexEditor. */
export type HexEditorHandle = {
  /** move the cursor to `offset` (scrolling it into view); `select` bytes from there are selected */ goTo: (offset: number, select?: number) => void
  select: (range: ByteRange | null) => void
  focus: () => void
  undo: () => void
  redo: () => void
  /** drop every edit (undoable as one step) */ revert: () => void
  /** the effective edits, by offset */ edits: () => HexEdit[]
  /** a copy of the data with the edits applied */ getBytes: () => Uint8Array
}

/** HexEditor props. */
export type HexEditorProps = {
  data: BinaryData
  /** bytes per row (default 16) */ bytesPerRow?: 8 | 16 | 32
  sections?: readonly BinarySection[]
  /** byte colouring: by class (zero / printable / control / high, default), by section (row tint), or none */ colorBy?: 'class' | 'section' | 'none'
  /** offset column: file offsets (default) or addresses (section `vaddr` + offset within it); the column header toggles it when sections have addresses */ offsets?: 'offset' | 'vaddr'
  cursor?: number; defaultCursor?: number; onCursorChange?: (offset: number) => void
  selection?: ByteRange | null; defaultSelection?: ByteRange | null; onSelectionChange?: (range: ByteRange | null) => void
  /** no editing (default false: typing overwrites) */ readOnly?: boolean
  /** every edit: the effective edits by offset (bytes changed from the data) */ onChange?: (edits: HexEdit[]) => void
  /** tinted ranges with a label (annotations, entropy hot spots) */ highlights?: readonly BinaryHighlight[]
  /** height of the byte grid in px (default 360) */ height?: number
  /** data inspector: 'auto' (beside the grid when there is room, else below behind a switch; default), 'side', 'bottom' or false */ inspector?: 'auto' | 'side' | 'bottom' | false
  /** show the toolbar (search, go to, undo; default true) */ toolbar?: boolean
  /** accessible name (default "Hex editor") */ label?: string
  className?: string
  ref?: Ref<HexEditorHandle>
}

/** Above this many px of rows the scroll range is scaled (browsers cap element heights near 17–33 M px). */
const BIN_MAX_SCROLL_PX = 8_000_000
/** Most bytes put on the clipboard at once. */
const BIN_COPY_MAX = 4 * 1024 * 1024
/** Rows are positioned relative to a base row that changes every this many rows, so a row keeps its props (and memo) while scrolling. */
const BIN_ROW_BLOCK = 1024
/** The offset column stays pinned to the left while the grid scrolls sideways (physical: the grid is an LTR island). */
const BIN_PIN = 'sticky left-0 z-[1]' // rtl-lint-ignore

type HexRowProps = {
  row: number; y: number; rowH: number; bpr: number; n: number; bytes: Uint8Array; patch: Map<number, number>; rv: number
  label: string; showText: boolean; colorBy: 'class' | 'section' | 'none'; sections: readonly BinarySection[]
  cur: number; pane: 'hex' | 'text'; nibble: number; focused: boolean; selA: number; selB: number
  matches: readonly number[]; matchLen: number; curMatch: number; highlights: readonly BinaryHighlight[]
}

/** First index in sorted `a` with a[i] ≥ v. */
function binLowerBound(a: readonly number[], v: number) {
  let lo = 0, hi = a.length
  while (lo < hi) { const m = (lo + hi) >> 1; if (a[m] < v) lo = m + 1; else hi = m }
  return lo
}

/** Width styles for runs of 1–32 hex cells (3ch each) and text cells (1ch each). */
const BIN_W3: readonly CSSProperties[] = Array.from({ length: 33 }, (_, k) => ({ width: `${k * 3}ch` }))
const BIN_W1: readonly CSSProperties[] = Array.from({ length: 33 }, (_, k) => ({ width: `${k}ch` }))

/**
 * One row of the hex grid. Memoised: scrolling renders only rows that come into view; an edit re-renders only its row.
 * Neighbouring bytes that look the same (colour, tint, edited) share one span (`data-o` its first byte, `data-n` how
 * many; pointer hits are resolved by x), so a row of zeros is a handful of nodes rather than 33: style and layout of
 * the rows is what a fast scroll pays for.
 */
const HexRow = memo(function HexRow({ row, y, rowH, bpr, n, bytes, patch, label, showText, colorBy, sections, cur, pane, nibble, focused, selA, selB, matches, matchLen, curMatch, highlights }: HexRowProps) {
  const start = row * bpr, end = Math.min(n, start + bpr), cols = end - start
  // per-column marks: 1 match, 2 current match; highlight and section tints
  const mark = new Uint8Array(bpr), tint: (string | undefined)[] = new Array(bpr)
  if (matches.length && matchLen) {
    for (let i = binLowerBound(matches, start - matchLen + 1); i < matches.length && matches[i] < end; i++) {
      const m = matches[i], v = m === curMatch ? 2 : 1
      for (let o = Math.max(m, start); o < Math.min(m + matchLen, end); o++) mark[o - start] = Math.max(mark[o - start], v)
    }
  }
  for (const h of highlights) if (h.end > start && h.start < end) for (let o = Math.max(h.start, start); o < Math.min(h.end, end); o++) tint[o - start] = `color-mix(in srgb, ${h.color ?? 'var(--warn)'} 22%, transparent)`
  if (colorBy === 'section' && sections.length) for (let o = start; o < end; o++) {
    if (tint[o - start]) continue
    const i = sections.indexOf(sectionAt(sections, o)!)
    if (i >= 0) tint[o - start] = `color-mix(in srgb, ${binarySectionColor(sections, i)} 16%, transparent)`
  }
  const val = new Uint8Array(cols), edited = new Uint8Array(cols), bg: (string | undefined)[] = new Array(cols)
  for (let c = 0; c < cols; c++) {
    const o = start + c, e = patch.has(o)
    val[c] = e ? patch.get(o)! : bytes[o]; edited[c] = e ? 1 : 0
    bg[c] = o >= selA && o < selB ? 'var(--accent-soft)' : mark[c] === 2 ? 'color-mix(in srgb, var(--warn) 38%, transparent)' : mark[c] === 1 ? 'var(--warn-soft)' : tint[c]
  }
  const curC = cur >= 0 ? cur - start : -1
  const hexColour = (v: number) => { const cls = BIN_CLASSES[BIN_CLASS_IDX[v]]; return colorBy === 'class' ? BIN_CLASS_TEXT[cls] : cls === 'null' ? 'text-[var(--fg2)]' : 'text-[var(--fg)]' }
  const ring = (p: 'hex' | 'text') => pane === p ? (focused ? 'shadow-[inset_0_0_0_1.5px_var(--accent)]' : 'shadow-[inset_0_0_0_1px_var(--fg3)]') : 'shadow-[inset_0_-2px_0_var(--fg3)]'

  const hex: ReactNode[] = []
  for (let c = 0; c < bpr;) {
    const gap = c > 0 && c % 8 === 0
    if (c >= cols) { const z = Math.min(bpr, (Math.floor(c / 8) + 1) * 8); hex.push(<span key={c} className={cn('inline-block', gap && 'ms-[1ch]')} style={BIN_W3[z - c]} />); c = z; continue }
    let z = c + 1
    const same = colorBy === 'class' ? (k: number) => BIN_CLASS_IDX[val[k]] === BIN_CLASS_IDX[val[c]] : (k: number) => (val[k] === 0) === (val[c] === 0)
    if (c !== curC) while (z < cols && z % 8 !== 0 && z !== curC && edited[z] === edited[c] && bg[z] === bg[c] && same(z)) z++
    let text = BIN_HEX[val[c]]
    for (let k = c + 1; k < z; k++) text += ' ' + BIN_HEX[val[k]]
    const isCur = c === curC
    hex.push(
      <span key={c} data-o={start + c} data-n={z - c} data-p="h" style={bg[c] ? { ...BIN_W3[z - c], background: bg[c] } : BIN_W3[z - c]}
        className={cn('inline-block rounded-[var(--r-sm)] text-center whitespace-pre', gap && 'ms-[1ch]', hexColour(val[c]), edited[c] && 'font-semibold underline decoration-[var(--accent)] decoration-2 underline-offset-2', isCur && ring('hex'))}>
        {isCur && pane === 'hex' && nibble === 1 ? <><span className="opacity-60">{text[0]}</span><span className="underline decoration-[var(--accent)] decoration-2">{text[1]}</span></> : text}
      </span>,
    )
    c = z
  }
  const txt: ReactNode[] = []
  if (showText) for (let c = 0; c < cols;) {
    const pr = binPrintable(val[c])
    let z = c + 1
    if (c !== curC) while (z < cols && z !== curC && edited[z] === edited[c] && bg[z] === bg[c] && binPrintable(val[z]) === pr) z++
    let text = ''
    for (let k = c; k < z; k++) text += binPrintable(val[k]) ? String.fromCharCode(val[k]) : '.'
    txt.push(
      <span key={c} data-o={start + c} data-n={z - c} data-p="t" style={bg[c] ? { ...BIN_W1[z - c], background: bg[c] } : BIN_W1[z - c]}
        className={cn('inline-block whitespace-pre', pr ? (edited[c] ? 'font-semibold text-[var(--accent)]' : 'text-[var(--fg)]') : 'text-[var(--fg3)]', c === curC && ring('text'))}>{text}</span>,
    )
    c = z
  }
  return (
    // rtl-lint-ignore: rows sit in the editor's LTR island
    <div data-row={row} className="absolute left-0 flex w-max min-w-full items-center whitespace-nowrap" style={{ top: y, height: rowH }}>
      <span className={cn(BIN_PIN, 'inline-block w-[13ch] flex-none bg-[var(--card)] ps-3 pe-[2ch] text-[var(--fg3)] select-none')}>{label}</span>
      <span className="flex-none">{hex}</span>
      {showText && <span className="ms-[2ch] flex-none pe-3" style={cols < bpr ? { paddingInlineEnd: `calc(${bpr - cols}ch + 12px)` } : undefined}>{txt}</span>}
    </div>
  )
})

/** A labelled value in the data inspector. */
function BinInspectorRow({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex min-w-0 items-baseline justify-between gap-3 py-0.5">
      <dt className="flex-none text-[11px] text-[var(--fg2)]">{label}</dt>
      <dd dir="ltr" className="m-0 min-w-0 truncate text-end font-[family-name:var(--mono)] text-xs text-[var(--fg)] tabular-nums select-text">{value}</dd>
    </div>
  )
}
const binFloat = (v: number | null) => v === null ? null : Number.isNaN(v) ? 'NaN' : !Number.isFinite(v) ? (v > 0 ? '+Infinity' : '-Infinity') : Object.is(v, -0) ? '-0' : String(Number(v.toPrecision(v === Math.fround(v) ? 9 : 17)))
const binDate = (d: Date | null) => d && !Number.isNaN(d.getTime()) ? d.toISOString().replace('T', ' ').replace(/\.\d+Z$/, ' UTC') : null

/** The data inspector: every decoder for the bytes at the cursor, with a byte-order switch. */
const BinInspector = memo(function BinInspector({ view, offset, layout, littleEndian, onEndian }: { view: Uint8Array; offset: number; layout: 'side' | 'bottom'; littleEndian: boolean; onEndian: (le: boolean) => void }) {
  const m = useMessages(BINARY_MESSAGES)
  const d = useMemo(() => decodeBytes(view, 0, littleEndian), [view, littleEndian])
  const na = <span className="text-[var(--fg3)]">—</span>
  const show = (v: unknown) => v === null || v === undefined ? na : String(v)
  const rows: [string, ReactNode][] = [
    [m('binary'), show(d.binary)], [m('char'), d.u8 === null ? na : binPrintable(d.u8) ? `'${String.fromCharCode(d.u8)}'` : `\\x${BIN_HEX[d.u8].toLowerCase()}`],
    ['u8', show(d.u8)], ['i8', show(d.i8)], ['u16', show(d.u16)], ['i16', show(d.i16)], ['u32', show(d.u32)], ['i32', show(d.i32)],
    ['u64', show(d.u64)], ['i64', show(d.i64)], ['f32', show(binFloat(d.f32))], ['f64', show(binFloat(d.f64))],
    [m('unixTime'), show(binDate(d.unix32))], [m('varint'), d.varint ? `${d.varint.value} (${d.varint.length} B)` : na], [m('zigzag'), show(d.zigzag)],
  ]
  return (
    <section aria-label={m('inspector')} className={cn('min-w-0', layout === 'side' ? 'w-[240px] flex-none border-s border-[var(--line)] ps-3' : 'border-t border-[var(--line)] pt-2')}>
      <div className="mb-1 flex items-center justify-between gap-2">
        <h4 className="m-0 truncate text-xs font-medium text-[var(--fg)]">{m('inspector')} <span dir="ltr" className="font-[family-name:var(--mono)] font-normal text-[var(--fg3)]">0x{hexOffset(offset)}</span></h4>
        <SegmentedControl size="sm" aria-label={m('byteOrder')} value={littleEndian ? 'le' : 'be'} onChange={v => onEndian(v === 'le')}
          options={[{ value: 'le', label: m('little') }, { value: 'be', label: m('big') }]} />
      </div>
      <dl className={cn('m-0', layout === 'bottom' && 'grid grid-cols-1 gap-x-6 sm:grid-cols-2 lg:grid-cols-3')}>
        {rows.map(([k, v]) => <BinInspectorRow key={k} label={k} value={v} />)}
      </dl>
    </section>
  )
})

/**
 * Hex editor for any size of data: offset · hex · text rows, virtualised (only the rows on screen render, the buffer is
 * never stringified; past ~8 M px of rows the scroll range is scaled so 100 MB still scrolls, with the wheel moving by
 * pixels). Select by dragging, Shift+click or Shift+arrows; the hex and text columns share the cursor and selection.
 * Keys: arrows, Page Up/Down, Home/End (Ctrl: file start/end), Tab between columns, Ctrl+G go to (hex, decimal,
 * +relative or a section address), Ctrl+F search (hex with `??` or text; every match on screen is tinted), Ctrl+A,
 * Ctrl+C (hex; the context menu also copies a C array, Base64 or text). Typing hex digits or text overwrites bytes
 * unless `readOnly`; edits live in a patch map over the data, reported through `onChange`, undone with Ctrl+Z and
 * redone with Ctrl+Shift+Z. Bytes are coloured by class or by section; `highlights` tint ranges. The data inspector
 * decodes the cursor as every integer, float, time and varint type in either byte order. Touch: tap selects a byte,
 * long-press opens the menu, the grid scrolls sideways on phones and the text column hides below 480 px (switch).
 * The grid is an LTR island in every locale.
 */
export function HexEditor({ data, bytesPerRow = 16, sections = BIN_NO_SECTIONS, colorBy = 'class', offsets: offsetsProp, cursor: cursorProp, defaultCursor = 0, onCursorChange,
  selection: selectionProp, defaultSelection = null, onSelectionChange, readOnly = false, onChange, highlights = BIN_NO_HIGHLIGHTS, height = 360,
  inspector = 'auto', toolbar = true, label, className, ref }: HexEditorProps) {
  const m = useMessages(BINARY_MESSAGES), { fmt } = useLocale()
  const bytes = useMemo(() => toByteArray(data), [data]), n = bytes.length
  const bpr = bytesPerRow, coarse = useCoarsePointer(), rowH = coarse ? 28 : 20, hdr = rowH
  const [cursorRaw, setCursorRaw] = useControllable(cursorProp, defaultCursor, onCursorChange)
  const [selection, setSelectionRaw] = useControllable<ByteRange | null>(selectionProp, defaultSelection, onSelectionChange)
  const cursor = clamp(cursorRaw, 0, Math.max(0, n - 1))
  const [pane, setPane] = useState<'hex' | 'text'>('hex')
  const [nibble, setNibble] = useState(0)
  const [focused, setFocused] = useState(false)
  const [le, setLe] = useState(true)
  const [offMode, setOffMode] = useState<'offset' | 'vaddr'>(offsetsProp ?? 'offset')
  useEffect(() => { if (offsetsProp) setOffMode(offsetsProp) }, [offsetsProp])
  const hasVaddr = sections.some(s => s.vaddr !== undefined)
  const anchor = useRef(cursor)
  const live = useRef(''), [said, setSaid] = useState('')
  const say = useCallback((s: string) => { live.current = s; setSaid(s) }, [])

  // ── edits: a patch map over the data, per-row versions (so only edited rows re-render), undo and redo stacks
  const patch = useRef(new Map<number, number>()), rowVer = useRef(new Map<number, number>())
  const undoStack = useRef<{ o: number; before: number; after: number }[][]>([]), redoStack = useRef<{ o: number; before: number; after: number }[][]>([])
  const [ver, setVer] = useState(0)
  useEffect(() => { patch.current = new Map(); rowVer.current = new Map(); undoStack.current = []; redoStack.current = []; setVer(v => v + 1) }, [bytes])
  const byteAt = useCallback((o: number) => patch.current.get(o) ?? bytes[o], [bytes])
  const editList = useCallback((): HexEdit[] => [...patch.current].sort((a, b) => a[0] - b[0]).map(([offset, after]) => ({ offset, before: bytes[offset], after })), [bytes])
  const onChangeRef = useRef(onChange); onChangeRef.current = onChange
  const write = useCallback((ops: { o: number; v: number }[]) => {
    let k = 0
    for (const { o, v } of ops) { if (v === bytes[o]) patch.current.delete(o); else patch.current.set(o, v); rowVer.current.set(Math.floor(o / bpr), ++k + Date.now()) }
    setVer(x => x + 1)
    onChangeRef.current?.(editList())
  }, [bytes, bpr, editList])
  const edit = useCallback((ops: { o: number; after: number }[]) => {
    const rec = ops.map(({ o, after }) => ({ o, before: byteAt(o), after })).filter(r => r.before !== r.after)
    if (!rec.length) return
    undoStack.current.push(rec); if (undoStack.current.length > 10000) undoStack.current.shift()
    redoStack.current = []
    write(rec.map(r => ({ o: r.o, v: r.after })))
  }, [byteAt, write])

  // ── scrolling: fixed-height rows, scaled scroll range for huge data
  const scroller = useRef<HTMLDivElement>(null)
  const rows = Math.max(1, Math.ceil(n / bpr)), totalPx = rows * rowH
  const [vp, setVp] = useState({ h: height, st: 0, top: 0 })
  const view = Math.max(rowH, vp.h - hdr)
  const spacer = Math.min(totalPx, BIN_MAX_SCROLL_PX)
  const ratio = totalPx > spacer ? (totalPx - view) / Math.max(1, spacer - view) : 1
  const maxTop = Math.max(0, totalPx - view)
  const fine = useRef<number | null>(null)
  const vpRef = useRef(vp); vpRef.current = vp
  const geo = useRef({ ratio, maxTop, rowH, view }); geo.current = { ratio, maxTop, rowH, view }
  const scrollToTop = useCallback((t: number) => {
    const el = scroller.current, g = geo.current, top = clamp(t, 0, g.maxTop)
    fine.current = g.ratio > 1 ? top : null
    const st = top / g.ratio
    if (el) el.scrollTop = st
    vpRef.current = { ...vpRef.current, st: el ? el.scrollTop : st, top }
    setVp(v => ({ ...v, st: el ? el.scrollTop : st, top }))
  }, [])
  const onScroll = useCallback(() => {
    const el = scroller.current; if (!el) return
    const st = el.scrollTop, g = geo.current
    let top = st
    if (g.ratio > 1) { top = st * g.ratio; if (fine.current !== null && Math.abs(top - fine.current) <= g.ratio + 2) top = fine.current; else fine.current = null }
    top = clamp(top, 0, g.maxTop)
    setVp(v => v.st === st && v.top === top ? v : { ...v, st, top })
  }, [])
  useLayoutEffect(() => {
    const el = scroller.current; if (!el) return
    const set = () => { const h = el.clientHeight || height; setVp(v => v.h === h ? v : { ...v, h }) }
    set()
    const ro = new ResizeObserver(set); ro.observe(el)
    return () => ro.disconnect()
  }, [height])
  // the wheel moves by pixels even when the scroll range is scaled (native scrolling would jump `ratio` px per px)
  useEffect(() => {
    const el = scroller.current; if (!el || ratio <= 1) return
    const wheel = (e: WheelEvent) => {
      if (e.ctrlKey || Math.abs(e.deltaY) < Math.abs(e.deltaX)) return
      const g = geo.current, cur = fine.current ?? el.scrollTop * g.ratio
      const dy = e.deltaY * (e.deltaMode === 1 ? g.rowH : e.deltaMode === 2 ? g.view : 1)
      if ((dy < 0 && cur <= 0) || (dy > 0 && cur >= g.maxTop)) return // at an end: let the page scroll
      e.preventDefault(); scrollToTop(cur + dy)
    }
    el.addEventListener('wheel', wheel, { passive: false })
    return () => el.removeEventListener('wheel', wheel)
  }, [ratio, scrollToTop])
  /** Scroll so `o` is on screen: by the least amount when it is near, else with its row a third of the way down. */
  const reveal = useCallback((o: number) => {
    const g = geo.current, rt = Math.floor(o / bpr) * g.rowH, v = vpRef.current
    if (rt >= v.top && rt + g.rowH <= v.top + g.view) return
    const far = rt < v.top - g.view || rt > v.top + 2 * g.view
    scrollToTop(far ? rt - g.view / 3 : rt < v.top ? rt : rt + g.rowH - g.view)
  }, [bpr, scrollToTop])
  const prevCursor = useRef(-1) // -1: reveal the starting cursor too (defaultCursor deep in the file)
  const holdScroll = useRef(false) // a right-click moved the cursor: don't scroll (the menu closes on scroll)
  useEffect(() => { if (prevCursor.current !== cursor) { prevCursor.current = cursor; if (!holdScroll.current) reveal(cursor) } holdScroll.current = false }, [cursor, reveal])
  // keep the cursor's cell in view sideways too (phones scroll the grid horizontally)
  useLayoutEffect(() => {
    const el = scroller.current, cell = el?.querySelector<HTMLElement>(`[data-o="${cursor}"][data-p="${pane === 'hex' ? 'h' : 't'}"]`)
    if (holdScroll.current) return // reset by the vertical reveal effect, which runs after this one
    if (!el || !cell || el.scrollWidth <= el.clientWidth) return
    const r = cell.getBoundingClientRect(), box = el.getBoundingClientRect(), pin = (el.querySelector<HTMLElement>('[data-row] > span')?.offsetWidth ?? 0)
    if (r.left < box.left + pin) el.scrollLeft -= box.left + pin - r.left + 8
    else if (r.right > box.right) el.scrollLeft += r.right - box.right + 8
  }, [cursor, pane])

  // ── layout: text column and inspector by width
  const [rootRef, width] = useWidth<HTMLDivElement>()
  const narrow = width > 0 && width < 480
  const [textOn, setTextOn] = useState<boolean | null>(null)
  const showText = textOn ?? !narrow
  const inspSide = inspector === 'side' || (inspector === 'auto' && (width === 0 || width >= 760))
  const [inspOpen, setInspOpen] = useState(false)
  const inspShown = inspector !== false && (inspSide || inspector === 'bottom' || inspOpen)

  // ── selection and cursor moves
  const setSel = useCallback((r: ByteRange | null) => { if (!binSameRange(r, selection)) setSelectionRaw(r) }, [selection, setSelectionRaw])
  const moveTo = useCallback((o: number, extend = false) => {
    const next = clamp(o, 0, Math.max(0, n - 1))
    if (extend) setSel(binRange(anchor.current, next)); else { anchor.current = next; setSel(null) }
    if (next !== cursor) setCursorRaw(next)
    setNibble(0)
    reveal(next)
  }, [n, cursor, setCursorRaw, setSel, reveal])
  const announce = useCallback((o: number) => {
    if (o >= n) return
    const sec = sectionAt(sections, o)
    say(m('cursorAt', { offset: '0x' + hexOffset(o), hex: BIN_HEX[byteAt(o)] }) + (sec ? `, ${sec.name}` : ''))
  }, [n, sections, byteAt, m, say])

  // ── search
  const [query, setQuery] = useState('')
  const [qMode, setQMode] = useState<'hex' | 'text'>('hex')
  const [matches, setMatches] = useState<readonly number[]>(BIN_NO_MATCHES)
  const [matchLen, setMatchLen] = useState(0)
  const [matchIdx, setMatchIdx] = useState(-1)
  const [badQuery, setBadQuery] = useState(false)
  const searchRef = useRef<HTMLInputElement>(null), gotoRef = useRef<HTMLInputElement>(null)
  const runSearch = useCallback((q: string, mode: 'hex' | 'text') => {
    const p = q.trim() ? binPattern(mode === 'text' ? q : q.trim(), mode) : null
    setBadQuery(!!q.trim() && !p)
    if (!p) { setMatches(BIN_NO_MATCHES); setMatchLen(0); setMatchIdx(-1); return }
    let found = searchBytes(bytes, p)
    if (patch.current.size) { // matches in the edited bytes: drop stale ones, look again around each edit
      const ok = (o: number) => o >= 0 && o + p.length <= n && p.every((v, j) => v < 0 || byteAt(o + j) === v)
      const set = new Set(found.filter(ok))
      for (const o of patch.current.keys()) for (let s = o - p.length + 1; s <= o; s++) if (ok(s)) set.add(s)
      found = [...set].sort((a, b) => a - b)
    }
    setMatches(found); setMatchLen(p.length); setMatchIdx(-1)
  }, [bytes, n, byteAt])
  useEffect(() => { const t = setTimeout(() => runSearch(query, qMode), 160); return () => clearTimeout(t) }, [query, qMode, runSearch, ver])
  const jumpMatch = useCallback((dirn: 1 | -1) => {
    if (!matches.length) return
    let i = dirn > 0 ? binLowerBound(matches, cursor + (matchIdx >= 0 && matches[matchIdx] === cursor ? 1 : 0)) : binLowerBound(matches, cursor) - 1
    if (i >= matches.length) i = 0
    if (i < 0) i = matches.length - 1
    const o = matches[i]
    setMatchIdx(i); anchor.current = o; setSel({ start: o, end: Math.min(n, o + matchLen) }); setCursorRaw(o); setNibble(0); reveal(o)
    say(m('matchOf', { index: i + 1, count: matches.length }) + ', 0x' + hexOffset(o))
  }, [matches, matchIdx, cursor, matchLen, n, setSel, setCursorRaw, reveal, say, m])

  // ── go to
  const [gotoText, setGotoText] = useState('')
  const [gotoBad, setGotoBad] = useState(false)
  const goToText = (s: string) => {
    const o = parseByteOffset(s, { size: n, cursor, sections })
    setGotoBad(o === null)
    if (o === null) { say(m('goToInvalid')); return false }
    moveTo(o); announce(o); scroller.current?.focus({ preventScroll: true })
    return true
  }

  // ── undo, redo, copy
  const undo = useCallback(() => {
    const op = undoStack.current.pop(); if (!op) return
    redoStack.current.push(op); write([...op].reverse().map(r => ({ o: r.o, v: r.before }))); moveTo(op[0].o)
  }, [write, moveTo])
  const redo = useCallback(() => {
    const op = redoStack.current.pop(); if (!op) return
    undoStack.current.push(op); write(op.map(r => ({ o: r.o, v: r.after }))); moveTo(op[op.length - 1].o)
  }, [write, moveTo])
  const revert = useCallback(() => {
    if (!patch.current.size) return
    const rec = [...patch.current].map(([o, after]) => ({ o, before: after, after: bytes[o] }))
    undoStack.current.push(rec); redoStack.current = []
    write(rec.map(r => ({ o: r.o, v: r.after })))
  }, [bytes, write])
  const viewOf = useCallback((a: number, z: number) => { const out = bytes.slice(a, z); if (patch.current.size) for (let o = a; o < z; o++) { const v = patch.current.get(o); if (v !== undefined) out[o - a] = v } return out }, [bytes])
  const copy = useCallback((format: ByteCopyFormat) => {
    const r = selection ?? { start: cursor, end: Math.min(n, cursor + 1) }, z = Math.min(r.end, r.start + BIN_COPY_MAX)
    const text = formatBytesAs(viewOf(r.start, z), format)
    void navigator.clipboard?.writeText(text).catch(() => {})
    say(z < r.end ? m('copiedPart', { size: fmt.bytes(z - r.start) }) : m('copied', { size: fmt.bytes(z - r.start) }))
  }, [selection, cursor, n, viewOf, say, m, fmt])
  const getBytes = useCallback(() => viewOf(0, n), [viewOf, n])

  useImperativeHandle(ref, () => ({
    goTo: (o, sel) => { moveTo(o); if (sel && sel > 0) { anchor.current = o; setSel({ start: o, end: Math.min(n, o + sel) }) } },
    select: r => { setSel(r); if (r) { anchor.current = r.start; setCursorRaw(r.start); reveal(r.start) } },
    focus: () => scroller.current?.focus({ preventScroll: true }),
    undo, redo, revert, edits: editList, getBytes,
  }), [moveTo, setSel, n, setCursorRaw, reveal, undo, redo, revert, editList, getBytes])

  // ── keyboard
  const pageRows = Math.max(1, Math.floor(view / rowH) - 1)
  const onKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (e.target !== e.currentTarget) return
    const mod = e.ctrlKey || e.metaKey, k = e.key, ext = e.shiftKey
    if (mod && !e.altKey) {
      const lk = k.toLowerCase()
      if (lk === 'g') { e.preventDefault(); gotoRef.current?.focus(); gotoRef.current?.select(); return }
      if (lk === 'f') { e.preventDefault(); searchRef.current?.focus(); searchRef.current?.select(); return }
      if (lk === 'z') { e.preventDefault(); if (readOnly) return; if (ext) redo(); else undo(); return }
      if (lk === 'y') { e.preventDefault(); if (!readOnly) redo(); return }
      if (lk === 'a') { e.preventDefault(); anchor.current = 0; setSel(n ? { start: 0, end: n } : null); return }
      if (lk === 'c') { e.preventDefault(); copy('hex'); return }
    }
    let to: number | null = null
    switch (k) {
      case 'ArrowLeft': to = cursor - 1; break // rtl-lint-ignore: the grid is an LTR island, ← is the previous byte
      case 'ArrowRight': to = cursor + 1; break // rtl-lint-ignore
      case 'ArrowUp': to = cursor - bpr; break
      case 'ArrowDown': to = cursor + bpr; break
      case 'PageUp': to = cursor - pageRows * bpr; break
      case 'PageDown': to = cursor + pageRows * bpr; break
      case 'Home': to = mod ? 0 : cursor - (cursor % bpr); break
      case 'End': to = mod ? n - 1 : Math.min(n - 1, cursor - (cursor % bpr) + bpr - 1); break
      case 'Tab':
        if (!showText || e.altKey || mod) return
        if (!ext && pane === 'hex') { e.preventDefault(); setPane('text'); setNibble(0); return }
        if (ext && pane === 'text') { e.preventDefault(); setPane('hex'); return }
        return
      case 'Escape': if (selection) { e.preventDefault(); setSel(null) } return
      case 'Backspace': e.preventDefault(); to = cursor - (nibble ? 0 : 1); break
    }
    if (to !== null) {
      e.preventDefault()
      if ((k === 'ArrowUp' || k === 'ArrowDown') && (to < 0 || to >= n)) to = cursor
      moveTo(to, ext && k !== 'Backspace'); announce(clamp(to, 0, Math.max(0, n - 1)))
      return
    }
    if (mod || e.altKey || k.length !== 1 || !n) return
    if (readOnly) { if (/^[\x20-\x7e]$/.test(k)) say(m('readOnly')); return }
    if (pane === 'hex') {
      if (!/^[0-9a-f]$/i.test(k)) return
      e.preventDefault()
      const dgt = parseInt(k, 16), v = byteAt(cursor)
      const after = nibble === 0 ? (dgt << 4) | (v & 0x0f) : (v & 0xf0) | dgt
      edit([{ o: cursor, after }])
      if (selection) setSel(null)
      if (nibble === 0) setNibble(1)
      else { setNibble(0); if (cursor < n - 1) { anchor.current = cursor + 1; setCursorRaw(cursor + 1); reveal(cursor + 1) } }
    } else {
      const code = k.charCodeAt(0); if (code < 0x20 || code > 0x7e) return
      e.preventDefault()
      edit([{ o: cursor, after: code }])
      if (selection) setSel(null)
      if (cursor < n - 1) { anchor.current = cursor + 1; setCursorRaw(cursor + 1); reveal(cursor + 1) }
    }
  }

  // ── pointer: drag to select (mouse and pen), tap to place the cursor (touch), right-click / long-press for the menu
  const drag = useRef<{ id: number } | null>(null), press = useRef<{ type: string; o: number } | null>(null)
  const [menuAt, setMenuAt] = useState<number | null>(null)
  /** The byte under a pointer: the run span it hit, then which of its `data-n` bytes by x (the grid is LTR). */
  const cellOf = (t: EventTarget | null, clientX?: number) => {
    const el = (t as Element | null)?.closest?.('[data-o]') as HTMLElement | null
    if (!el) return null
    let o = +el.dataset.o!
    const k = +(el.dataset.n ?? 1)
    if (k > 1 && clientX !== undefined) { const r = el.getBoundingClientRect(); if (r.width > 0) o += clamp(Math.floor(((clientX - r.left) / r.width) * k), 0, k - 1) } // rtl-lint-ignore: LTR island
    return { o, p: el.dataset.p === 't' ? 'text' as const : 'hex' as const }
  }
  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    const c = cellOf(e.target, e.clientX)
    press.current = c ? { type: e.pointerType, o: c.o } : null
    if (!c) return
    if (e.pointerType === 'mouse' && e.button === 0) {
      e.preventDefault(); scroller.current?.focus({ preventScroll: true })
      setPane(c.p)
      if (e.shiftKey) setSel(binRange(anchor.current, c.o)); else { anchor.current = c.o; setSel(null) }
      setCursorRaw(c.o); setNibble(0)
      drag.current = { id: e.pointerId }
      e.currentTarget.setPointerCapture?.(e.pointerId)
    }
  }
  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!drag.current || drag.current.id !== e.pointerId) return
    const el = scroller.current!, box = el.getBoundingClientRect()
    if (e.clientY < box.top + hdr) scrollToTop(geo.current.ratio > 1 ? (fine.current ?? vp.top) - rowH : vp.top - rowH)
    else if (e.clientY > box.bottom - 4) scrollToTop((fine.current ?? vp.top) + rowH)
    const c = cellOf(document.elementFromPoint(e.clientX, clamp(e.clientY, box.top + hdr + 1, box.bottom - 2)), e.clientX)
    if (c && c.o !== cursor) { setSel(binRange(anchor.current, c.o)); setCursorRaw(c.o) }
  }
  const onPointerUp = (e: ReactPointerEvent<HTMLDivElement>) => { if (drag.current?.id === e.pointerId) drag.current = null }
  const onClick = (e: ReactMouseEvent<HTMLDivElement>) => {
    const p = press.current, c = cellOf(e.target, e.clientX)
    if (!p || !c || p.type === 'mouse') return
    setPane(c.p)
    if (e.shiftKey) setSel(binRange(anchor.current, c.o)); else { anchor.current = c.o; setSel(null) }
    setCursorRaw(c.o); setNibble(0); announce(c.o)
  }
  const onContextMenu = (e: ReactMouseEvent<HTMLDivElement>) => {
    const c = cellOf(e.target, e.clientX), p = press.current
    setMenuAt(c?.o ?? null)
    if (c && (!p || p.type === 'mouse') && !(selection && c.o >= selection.start && c.o < selection.end)) { anchor.current = c.o; setSel(null); if (c.o !== cursor) holdScroll.current = true; setCursorRaw(c.o); setPane(c.p) }
  }

  // ── rows on screen
  const first = Math.max(0, Math.floor(vp.top / rowH) - VIRTUAL_OVERSCAN), last = Math.min(rows - 1, Math.floor((vp.top + view) / rowH) + VIRTUAL_OVERSCAN)
  const base = Math.floor(first / BIN_ROW_BLOCK) * BIN_ROW_BLOCK
  const shift = vp.st + base * rowH - vp.top
  const vaddrOn = offMode === 'vaddr' && hasVaddr
  const offWidth = n > 0xffffffff ? 12 : 8
  const labelOf = (row: number) => {
    const o = row * bpr
    if (vaddrOn) { const s = sectionAt(sections, o); if (s?.vaddr !== undefined) return hexOffset(s.vaddr + o - s.offset, offWidth) }
    return hexOffset(o, offWidth)
  }
  const curMatch = matchIdx >= 0 ? matches[matchIdx] : -1
  const rowEls: ReactNode[] = []
  for (let r = first; r <= last; r++) {
    const s = r * bpr, e = s + bpr
    const selA = selection && selection.end > s && selection.start < e ? Math.max(selection.start, s) : -1
    const selB = selA >= 0 ? Math.min(selection!.end, e) : -1
    rowEls.push(<HexRow key={r} row={r} y={(r - base) * rowH} rowH={rowH} bpr={bpr} n={n} bytes={bytes} patch={patch.current} rv={rowVer.current.get(r) ?? 0}
      label={labelOf(r)} showText={showText} colorBy={colorBy} sections={sections} cur={cursor >= s && cursor < e ? cursor : -1} pane={pane}
      nibble={cursor >= s && cursor < e ? nibble : 0} focused={focused} selA={selA} selB={selB}
      matches={matches} matchLen={matchLen} curMatch={curMatch >= s - matchLen && curMatch < e ? curMatch : -1} highlights={highlights} />)
  }

  const sec = n ? sectionAt(sections, cursor) : undefined
  const hl = highlights.find(h => cursor >= h.start && cursor < h.end)
  const editCount = patch.current.size
  const inspView = useMemo(() => viewOf(cursor, Math.min(n, cursor + 16)), [viewOf, cursor, n, ver]) // eslint-disable-line react-hooks/exhaustive-deps
  const helpId = useId()
  const u32 = n >= cursor + 4 ? decodeBytes(inspView, 0, le).u32 : null
  const u32Off = u32 !== null ? parseByteOffset('0x' + u32.toString(16), { size: n, sections }) : null
  const menuSec = menuAt !== null ? sectionAt(sections, menuAt) : sec
  const matchLabel = badQuery ? m('badPattern') : !query.trim() ? '' : !matches.length ? m('noMatches') : matches.length >= 10_000 ? m('manyMatches', { count: fmt.number(10_000) })
    : matchIdx >= 0 ? m('matchOf', { index: matchIdx + 1, count: matches.length }) : fmt.number(matches.length)

  const grid = (
    <ContextMenu.Root>
      <ContextMenu.Trigger asChild>
        <div ref={scroller} dir="ltr" tabIndex={0} role="group" aria-roledescription={m('hexRole')} aria-label={label ?? m('hexEditor')} aria-describedby={helpId}
          onScroll={onScroll} onKeyDown={onKeyDown} onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp}
          onClick={onClick} onContextMenu={onContextMenu}
          onFocus={e => { if (e.target === e.currentTarget) setFocused(true) }} onBlur={e => { if (e.target === e.currentTarget) setFocused(false) }}
          className="relative min-w-0 flex-[1_1_auto] overflow-auto overscroll-contain rounded-[var(--r-md)] border border-[var(--line)] bg-[var(--card)] font-[family-name:var(--mono)] text-xs tabular-nums select-none focus-visible:!ring-2 focus-visible:!ring-[var(--accent)]"
          style={{ height }}>
          {/* rtl-lint-ignore: header and rows are physical inside the LTR island */}
          <div className="sticky top-0 z-[2] flex w-max min-w-full items-center border-b border-[var(--line)] bg-[var(--card)] whitespace-nowrap text-[var(--fg3)]" style={{ height: hdr }}>
            {hasVaddr
              ? <button type="button" tabIndex={-1} onClick={() => setOffMode(vaddrOn ? 'offset' : 'vaddr')}
                className={cn(BIN_PIN, 'inline-block h-full w-[13ch] flex-none cursor-pointer border-0 bg-[var(--card)] ps-3 text-start text-[11px] font-medium text-[var(--fg2)] hover:text-[var(--fg)]')}>{vaddrOn ? m('vaddr') : m('offset')}<span className="sr-only">, {vaddrOn ? m('showOffsets') : m('showVaddr')}</span></button>
              : <span className={cn(BIN_PIN, 'inline-block w-[13ch] flex-none bg-[var(--card)] ps-3 text-[11px] font-medium text-[var(--fg2)]')}>{m('offset')}</span>}
            <span aria-hidden className="flex-none">{Array.from({ length: bpr }, (_, c) => <span key={c} className={cn('inline-block w-[3ch] text-center', c > 0 && c % 8 === 0 && 'ms-[1ch]')}>{BIN_HEX[c]}</span>)}</span>
            {showText && <span aria-hidden className="ms-[2ch] flex-none pe-3">{Array.from({ length: bpr }, (_, c) => <span key={c} className="inline-block w-[1ch] text-center">{(c % 16).toString(16).toUpperCase()}</span>)}</span>}
          </div>
          <div aria-hidden className="relative w-max min-w-full" style={{ height: spacer }}>
            <div className="absolute inset-x-0 top-0" style={{ transform: `translateY(${shift}px)` }}>{rowEls}</div>
          </div>
        </div>
      </ContextMenu.Trigger>
      <ContextMenu.Content aria-label={m('hexEditor')}>
        <ContextMenu.Item icon="copy" shortcut="Ctrl C" onSelect={() => copy('hex')}>{m('copyHex')}</ContextMenu.Item>
        <ContextMenu.Item onSelect={() => copy('c')}>{m('copyC')}</ContextMenu.Item>
        <ContextMenu.Item onSelect={() => copy('base64')}>{m('copyBase64')}</ContextMenu.Item>
        <ContextMenu.Item onSelect={() => copy('text')}>{m('copyText')}</ContextMenu.Item>
        <ContextMenu.Separator />
        <ContextMenu.Item shortcut="Ctrl A" onSelect={() => { anchor.current = 0; setSel(n ? { start: 0, end: n } : null) }}>{m('selectAll')}</ContextMenu.Item>
        {menuAt !== null && menuAt !== cursor && <ContextMenu.Item onSelect={() => { setSel(binRange(cursor, menuAt)); anchor.current = cursor; setCursorRaw(menuAt) }}>{m('selectToHere')}</ContextMenu.Item>}
        {menuSec && <ContextMenu.Item onSelect={() => { anchor.current = menuSec.offset; setSel({ start: menuSec.offset, end: Math.min(n, menuSec.offset + menuSec.size) }); setCursorRaw(menuSec.offset); reveal(menuSec.offset) }}>{m('selectSection', { name: menuSec.name })}</ContextMenu.Item>}
        {u32Off !== null && <ContextMenu.Item onSelect={() => { moveTo(u32Off); announce(u32Off) }}>{m('followU32', { value: '0x' + hexOffset(u32!) })}</ContextMenu.Item>}
        {!readOnly && <>
          <ContextMenu.Separator />
          <ContextMenu.Item shortcut="Ctrl Z" onSelect={undo}>{m('undo')}</ContextMenu.Item>
          <ContextMenu.Item shortcut="Ctrl ⇧ Z" onSelect={redo}>{m('redo')}</ContextMenu.Item>
          {editCount > 0 && <ContextMenu.Item danger onSelect={revert}>{m('revert')}</ContextMenu.Item>}
        </>}
      </ContextMenu.Content>
    </ContextMenu.Root>
  )

  // the toolbar and status bar don't depend on the scroll position: memoised, so scrolling re-renders only the grid
  // (their segmented control and switches have layout animations, which measure on every render)
  const handlers = useRef({ jumpMatch, goToText, undo, redo }); handlers.current = { jumpMatch, goToText, undo, redo }
  const toolbarEl = useMemo(() => toolbar && (
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex min-w-[220px] flex-[2_1_260px] items-center gap-1">
            <input ref={searchRef} type="search" value={query} onChange={e => setQuery(e.target.value)} aria-label={m('search')} aria-invalid={badQuery || undefined}
              placeholder={qMode === 'hex' ? m('searchPlaceholderHex') : m('searchPlaceholderText')} spellCheck={false} autoComplete="off" dir="ltr"
              onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); handlers.current.jumpMatch(e.shiftKey ? -1 : 1) } else if (e.key === 'Escape') { e.preventDefault(); scroller.current?.focus({ preventScroll: true }) } }}
              className={cn(inputClass, '!h-[30px] min-w-0 flex-1 font-[family-name:var(--mono)] !text-xs [@media(pointer:coarse)]:!h-9 [@media(pointer:coarse)]:!text-base')} />
            <SegmentedControl size="sm" aria-label={m('searchMode')} value={qMode} onChange={v => setQMode(v as 'hex' | 'text')} options={[{ value: 'hex', label: m('searchHex') }, { value: 'text', label: m('searchText') }]} />
            <IconButton icon="chevronUp" size="icon-sm" label={m('prevMatch')} disabled={!matches.length} onClick={() => handlers.current.jumpMatch(-1)} />
            <IconButton icon="chevronDown" size="icon-sm" label={m('nextMatch')} disabled={!matches.length} onClick={() => handlers.current.jumpMatch(1)} />
          </div>
          <span role="status" className={cn('min-w-0 truncate text-[11px] tabular-nums', badQuery ? 'text-[var(--bad)]' : 'text-[var(--fg2)]')}>{matchLabel}</span>
          <div className="ms-auto flex items-center gap-1">
            <input ref={gotoRef} value={gotoText} onChange={e => { setGotoText(e.target.value); setGotoBad(false) }} aria-label={m('goTo')} placeholder={m('goToPlaceholder')} aria-invalid={gotoBad || undefined}
              spellCheck={false} autoComplete="off" dir="ltr" title={gotoBad ? m('goToInvalid') : undefined}
              onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); handlers.current.goToText(gotoText) } else if (e.key === 'Escape') { e.preventDefault(); scroller.current?.focus({ preventScroll: true }) } }}
              className={cn(inputClass, '!h-[30px] w-[124px] font-[family-name:var(--mono)] !text-xs [@media(pointer:coarse)]:!h-9 [@media(pointer:coarse)]:!text-base')} />
            {!readOnly && <>
              <IconButton icon="undo" size="icon-sm" label={m('undo')} disabled={!undoStack.current.length} onClick={() => handlers.current.undo()} className="ui-flip" />
              {/* rtl-lint-ignore: redo is the undo arrow mirrored, and mirrored back in RTL */}
              <IconButton icon="undo" size="icon-sm" label={m('redo')} disabled={!redoStack.current.length} onClick={() => handlers.current.redo()} className="-scale-x-100 rtl:scale-x-100" />
            </>}
          </div>
        </div>
      ), [toolbar, query, qMode, matches.length, matchLabel, badQuery, gotoText, gotoBad, readOnly, ver, m]) // eslint-disable-line react-hooks/exhaustive-deps
  const statusEl = useMemo(() => (
      <div className="flex min-h-6 flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-[var(--fg2)]">
        <span dir="ltr" className="font-[family-name:var(--mono)] tabular-nums text-[var(--fg)]">0x{hexOffset(cursor, offWidth)}</span>
        {sec && <span className="inline-flex items-center gap-1"><span aria-hidden className="h-2 w-2 rounded-full" style={{ background: binarySectionColor(sections, sections.indexOf(sec)) }} />{sec.name}</span>}
        {hl?.label && <span>{hl.label}</span>}
        {selection && selection.end - selection.start > 1 && <span dir="ltr" className="font-[family-name:var(--mono)] tabular-nums">{m('selection', { start: '0x' + hexOffset(selection.start), end: '0x' + hexOffset(selection.end - 1), size: fmt.bytes(selection.end - selection.start) })}</span>}
        <span className="ms-auto inline-flex items-center gap-2">
          {editCount > 0 && <Badge size="sm" tone="accent">{m('edits', { count: editCount })}</Badge>}
          <span title={readOnly ? undefined : m('overwriteTitle')}><Badge size="sm">{readOnly ? m('readOnly') : m('overwrite')}</Badge></span>
          {narrow && <Switch label={<span className="text-[11px] text-[var(--fg2)]">{m('showText')}</span>} checked={showText} onChange={v => setTextOn(v)} />}
          {inspector === 'auto' && !inspSide && <Switch label={<span className="text-[11px] text-[var(--fg2)]">{m('inspector')}</span>} checked={inspOpen} onChange={setInspOpen} />}
        </span>
      </div>
  ), [cursor, offWidth, sec, hl, selection, editCount, readOnly, narrow, showText, inspector, inspSide, inspOpen, m, fmt, sections])

  return (
    <div ref={rootRef} className={cn('flex min-w-0 flex-col gap-2', className)}>
      {toolbarEl}
      <div className={cn('flex min-w-0 gap-3', !inspSide && 'flex-col')}>
        {grid}
        {inspShown && <BinInspector view={inspView} offset={cursor} layout={inspSide ? 'side' : 'bottom'} littleEndian={le} onEndian={setLe} />}
      </div>
      {statusEl}
      <span id={helpId} className="sr-only">{readOnly ? m('hexHelpReadOnly') : m('hexHelp')}</span>
      <span className="sr-only" aria-live="polite">{said}</span>
    </div>
  )
}

/* ════════════════════════════════════════════════════════════════════════════
 * EntropyMap
 * ══════════════════════════════════════════════════════════════════════════ */

/** EntropyMap props. Pass `data`, or precomputed `entropy` (from entropyWindows with the same windowSize/step) plus `length`. */
export type EntropyMapProps = {
  data?: BinaryData
  /** precomputed windows (skips the pass over the data) */ entropy?: ArrayLike<number>
  /** data size in bytes (default data.length) */ length?: number
  /** window size in bytes (default 512) */ windowSize?: number
  /** step between windows (default windowSize) */ step?: number
  sections?: readonly BinarySection[]
  /** bits marking a window as high entropy (default 7.2) */ threshold?: number
  orientation?: 'vertical' | 'horizontal'
  /** strip length in px when vertical (default 420), plot height when horizontal (default 96) */ size?: number
  /** the selected range, drawn on the strip */ selection?: ByteRange | null
  /** a click, drag, Enter or a list item selected a range */ onSelect?: (range: ByteRange) => void
  /** a marker (the hex editor's cursor) */ cursor?: number
  onHover?: (offset: number | null) => void
  /** the list of high-entropy regions under the strip (default true) */ list?: boolean
  /** accessible name (default "Entropy map") */ label?: string
  className?: string
}

/** Offset ruler ticks: a power-of-two step giving at most `max` ticks. */
function binTicks(length: number, max: number) {
  if (length <= 0) return [0]
  const step = 2 ** Math.max(4, Math.ceil(Math.log2(length / Math.max(1, max)))), out: number[] = []
  for (let v = 0; v < length; v += step) out.push(v)
  return out
}

/** The high-entropy regions as a virtualised list (a large file can have hundreds). */
function BinRegionList({ regions, sections, threshold, onSelect, active }: { regions: readonly EntropyRegion[]; sections: readonly BinarySection[]; threshold: number; onSelect?: (r: ByteRange) => void; active: ByteRange | null }) {
  const m = useMessages(BINARY_MESSAGES), { fmt } = useLocale(), coarse = useCoarsePointer(), rowH = coarse ? 44 : 32
  const scrollRef = useRef<HTMLDivElement>(null)
  const v = useVirtual({ count: regions.length, estimateSize: rowH, scrollRef, enabled: regions.length > 40 })
  if (!regions.length) return <p className="m-0 text-xs text-[var(--fg2)]">{m('highNone', { threshold })}</p>
  return (
    <div ref={scrollRef} className="max-h-[200px] overflow-auto overscroll-contain">
      <ul className="relative m-0 list-none p-0" style={{ height: v.totalSize }}>
        {v.items.map(it => {
          const r = regions[it.index], s = sectionAt(sections, r.start), on = !!active && active.start === r.start && active.end === r.end
          return (
            <li key={it.key} className="absolute inset-x-0" style={{ top: it.start, height: rowH }} {...v.setAria(it.index)}>
              <button type="button" onClick={() => onSelect?.({ start: r.start, end: r.end })} aria-pressed={on} title={`0x${hexOffset(r.start)}–0x${hexOffset(r.end)}`}
                className={cn('grid h-full w-full cursor-pointer grid-cols-[minmax(0,1.6fr)_minmax(0,0.8fr)_minmax(0,1fr)_auto] items-center gap-2 rounded-[var(--r-md)] border-0 bg-transparent px-2 text-start text-xs', rowHoverClass, on && '!bg-[var(--accent-soft)]')}>
                <span dir="ltr" className="truncate text-start font-[family-name:var(--mono)] tabular-nums text-[var(--fg)]">{hexOffset(r.start)}–{hexOffset(r.end)}</span>
                <span className="truncate tabular-nums text-[var(--fg2)]">{fmt.bytes(r.size)}</span>
                <span className="truncate text-[var(--fg2)]">{s?.name ?? m('noSection')}</span>
                <span className="inline-flex items-center gap-1.5 font-[family-name:var(--mono)] tabular-nums text-[var(--fg)]">
                  <span aria-hidden className="h-2 w-2 rounded-full" style={{ background: entropyColor(r.mean) }} />{binBits(r.mean)}
                </span>
              </button>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

/**
 * Entropy strip: Shannon entropy per window (default 512 B) as bars on the shared colour scale, beside an offset ruler
 * (hex) and section bands with names and sizes, with a threshold line (default 7.2 bits) and the windows above it
 * merged into regions, marked on the strip and listed below (range, size, section, mean entropy). Many windows are
 * folded to the pixels available (each pixel shows its windows' mean as the bar and their highest as a tick, so short packed runs still show). Hover or tap
 * reads out offset, section and entropy; click, drag or Enter selects a range (`onSelect`); a click inside a
 * high-entropy region selects the whole region. Keyboard: one Tab stop, ↑/↓ (←/→ when horizontal) step, Shift extends,
 * Page Up/Down jump, Home/End, Enter selects, Escape clears. `orientation="horizontal"` lays it out as a band. The
 * strip is an LTR island; the list and readout follow the locale.
 */
export function EntropyMap({ data, entropy: entropyProp, length: lengthProp, windowSize = 512, step: stepProp, sections = BIN_NO_SECTIONS, threshold = 7.2,
  orientation = 'vertical', size, selection: selectionProp, onSelect, cursor, onHover, list = true, label, className }: EntropyMapProps) {
  const m = useMessages(BINARY_MESSAGES), { fmt, dir } = useLocale()
  const bytes = useMemo(() => (data ? toByteArray(data) : null), [data])
  const step = stepProp ?? windowSize
  const computed = useMemo(() => (entropyProp || !bytes ? null : entropyWindows(bytes, windowSize, step)), [entropyProp, bytes, windowSize, step])
  const ent: ArrayLike<number> = entropyProp ?? computed ?? new Float32Array(0)
  const length = lengthProp ?? bytes?.length ?? ent.length * step
  const regions = useMemo(() => highEntropyRegions(ent, { windowSize, step, threshold, length }), [ent, windowSize, step, threshold, length])
  const vertical = orientation === 'vertical'
  const [plotRef, plotW] = useWidth<HTMLDivElement>()
  const plotLen = vertical ? size ?? 420 : plotW || 600, plotH = vertical ? size ?? 420 : size ?? 96
  const W = ent.length, cols = Math.max(1, Math.min(W, Math.round(plotLen)))
  const buckets = useMemo(() => {
    const out: { a: number; z: number; v: number; max: number }[] = []
    for (let j = 0; j < cols; j++) {
      const w0 = Math.floor((j * W) / cols), w1 = Math.max(w0 + 1, Math.floor(((j + 1) * W) / cols))
      let mx = 0, sum = 0, k = 0
      for (let i = w0; i < w1 && i < W; i++) { mx = Math.max(mx, ent[i]); sum += ent[i]; k++ }
      out.push({ a: w0 * step, z: Math.min(length, w1 * step), v: k ? sum / k : 0, max: mx })
    }
    return out
  }, [ent, W, cols, step, length])
  const [selInner, setSelInner] = useState<ByteRange | null>(null)
  const sel = selectionProp !== undefined ? selectionProp : selInner
  const [hover, setHover] = useState<number | null>(null)
  const [active, setActive] = useState<number | null>(null) // keyboard bucket
  const kAnchor = useRef<number | null>(null)
  const drag = useRef<{ from: number; moved: boolean; id: number } | null>(null)
  const [dragSel, setDragSel] = useState<ByteRange | null>(null)
  const plotBox = useRef<HTMLDivElement>(null)
  const pct = (o: number) => (length ? (o / length) * 100 : 0)
  const offsetAt = (e: { clientX: number; clientY: number }) => {
    const r = plotBox.current!.getBoundingClientRect()
    const f = vertical ? (e.clientY - r.top) / r.height : (e.clientX - r.left) / r.width // rtl-lint-ignore: LTR plot
    return clamp(Math.floor(f * length), 0, Math.max(0, length - 1))
  }
  const windowRange = (o: number): ByteRange => { const i = Math.floor(o / step); return { start: i * step, end: Math.min(length, i * step + windowSize) } }
  const select = (r: ByteRange) => { setSelInner(r); onSelect?.(r) }
  const pick = (o: number) => { const reg = regions.find(x => o >= x.start && o < x.end); select(reg ? { start: reg.start, end: reg.end } : windowRange(o)) }
  const bitsAt = (o: number) => (W ? ent[Math.min(W - 1, Math.floor(o / step))] : 0)
  const setHov = (o: number | null) => { setHover(o); onHover?.(o) }
  const shown = hover ?? (active !== null ? buckets[active]?.a ?? null : null)
  const readSec = shown !== null ? sectionAt(sections, shown) : undefined
  const describe = (o: number) => m('regionAt', { range: '0x' + hexOffset(o), section: sectionAt(sections, o)?.name ?? m('noSection'), bits: m('bits', { value: binBits(bitsAt(o)) }) })
  const [said, setSaid] = useState('')
  const goBucket = (j: number, extend: boolean) => {
    const k = clamp(j, 0, cols - 1)
    setActive(k)
    if (extend) { if (kAnchor.current === null) kAnchor.current = active ?? k; const a = Math.min(kAnchor.current, k), z = Math.max(kAnchor.current, k); setDragSel({ start: buckets[a].a, end: buckets[z].z }) }
    else { kAnchor.current = null; setDragSel(null) }
    setSaid(describe(buckets[k].a))
  }
  const onKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    const prev = vertical ? 'ArrowUp' : 'ArrowLeft', next = vertical ? 'ArrowDown' : 'ArrowRight', cur = active ?? -1, big = Math.max(1, Math.round(cols / 10)) // rtl-lint-ignore: LTR island, → is later
    let j: number | null = null
    if (e.key === next) j = cur + 1
    else if (e.key === prev) j = cur < 0 ? 0 : cur - 1
    else if (e.key === 'PageDown') j = cur + big
    else if (e.key === 'PageUp') j = cur - big
    else if (e.key === 'Home') j = 0
    else if (e.key === 'End') j = cols - 1
    else if (e.key === 'Enter' && active !== null) { e.preventDefault(); if (dragSel) select(dragSel); else pick(buckets[active].a); return }
    else if (e.key === 'Escape' && (active !== null || dragSel)) { e.preventDefault(); setActive(null); setDragSel(null); kAnchor.current = null; return }
    if (j === null) return
    e.preventDefault(); goBucket(j, e.shiftKey)
  }
  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return
    const o = offsetAt(e)
    drag.current = { from: o, moved: false, id: e.pointerId }
    setHov(o)
    if (e.pointerType === 'mouse') e.currentTarget.setPointerCapture?.(e.pointerId)
  }
  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const o = offsetAt(e)
    setHov(o)
    const d = drag.current
    if (d && d.id === e.pointerId && e.pointerType === 'mouse' && (d.moved || Math.abs(o - d.from) > length / Math.max(1, plotLen) * 3)) {
      d.moved = true
      const a = windowRange(Math.min(d.from, o)), z = windowRange(Math.max(d.from, o))
      setDragSel({ start: a.start, end: z.end })
    }
  }
  const onPointerUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = drag.current; drag.current = null
    if (!d || d.id !== e.pointerId) return
    if (d.moved && dragSel) { select(dragSel); setDragSel(null) } else pick(offsetAt(e))
  }
  const ticks = binTicks(length, vertical ? Math.max(2, Math.floor(plotH / 44)) : Math.max(2, Math.floor(plotLen / 72)))
  const summary = m('entropySummary', { count: W, size: fmt.bytes(windowSize), high: regions.length, threshold })
  const shownSel = dragSel ?? sel
  const thrPct = (threshold / 8) * 100
  const bandLen = (s: BinarySection) => (pct(Math.min(length, s.offset + s.size)) - pct(s.offset)) / 100 * plotLen

  // physical geometry inside the LTR island: vertical strips grow along y, horizontal along x
  const along = (a: number, z: number): CSSProperties => vertical ? { top: `${pct(a)}%`, height: `${Math.max(0.15, pct(z) - pct(a))}%` } : { left: `${pct(a)}%`, width: `${Math.max(0.15, pct(z) - pct(a))}%` } // rtl-lint-ignore
  const at = (o: number): CSSProperties => vertical ? { top: `${pct(o)}%` } : { left: `${pct(o)}%` } // rtl-lint-ignore

  const plot = (
    <div ref={plotBox} className={cn('relative min-w-0', vertical ? 'h-full' : 'w-full')} onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={() => { drag.current = null; setDragSel(null) }}
      onPointerLeave={e => { if (e.pointerType === 'mouse') setHov(null) }} style={{ touchAction: vertical ? 'pan-y' : 'pan-x' }}>
      {/* guides at 2, 4, 6 bits, the threshold, then the bars */}
      {[2, 4, 6].map(b => <span key={b} aria-hidden className={cn('pointer-events-none absolute bg-[var(--line)]', vertical ? 'inset-y-0 w-px' : 'inset-x-0 h-px')} style={vertical ? { left: `${(b / 8) * 100}%` } : { bottom: `${(b / 8) * 100}%` }} />)} {/* rtl-lint-ignore */}
      <svg aria-hidden className="absolute inset-0 h-full w-full" viewBox={vertical ? '0 0 100 10000' : '0 0 10000 100'} preserveAspectRatio="none" shapeRendering="crispEdges">
        {/* offsets scaled to 0–10 000 user units (huge coordinates lose precision in the renderer); a pixel holding several
            windows draws their mean as the bar and their highest as a tick, so packed runs show at any size */}
        {buckets.map((b, j) => {
          if (b.max <= 0) return null
          const p0 = length ? (b.a / length) * 10000 : 0, len = Math.max(10000 / Math.max(1, plotLen), length ? ((b.z - b.a) / length) * 10000 : 0)
          return vertical
            ? <g key={j}><rect x={0} y={p0} width={(b.v / 8) * 100} height={len} fill={entropyColor(b.v)} />
              {b.max - b.v > 0.25 && <rect x={(b.max / 8) * 100 - 1.5} y={p0} width={1.5} height={len} fill={entropyColor(b.max)} />}</g>
            : <g key={j}><rect x={p0} y={100 - (b.v / 8) * 100} width={len} height={(b.v / 8) * 100} fill={entropyColor(b.v)} />
              {b.max - b.v > 0.25 && <rect x={p0} y={100 - (b.max / 8) * 100} width={len} height={1.5} fill={entropyColor(b.max)} />}</g>
        })}
      </svg>
      {/* regions: a tinted band when it is a few px long, else just a marker on the far edge (a dense file would turn solid red) */}
      {regions.map(r => (pct(r.end) - pct(r.start)) / 100 * plotLen >= 3
        ? <span key={r.start} aria-hidden className={cn('pointer-events-none absolute border-[var(--bad)] bg-[color-mix(in_srgb,var(--bad)_10%,transparent)]', vertical ? 'inset-x-0 border-y' : 'inset-y-0 border-x')} style={along(r.start, r.end)} />
        : <span key={r.start} aria-hidden className={cn('pointer-events-none absolute bg-[var(--bad)]', vertical ? 'end-0 w-1' : 'top-0 h-1')} style={{ ...along(r.start, r.end), ...(vertical ? { minHeight: 1 } : { minWidth: 1 }) }} />)}
      <span aria-hidden className={cn('pointer-events-none absolute border-dashed border-[var(--fg2)]', vertical ? 'inset-y-0 border-s' : 'inset-x-0 border-t')} style={vertical ? { left: `${thrPct}%` } : { bottom: `${thrPct}%` }} /> {/* rtl-lint-ignore */}
      {shownSel && <span aria-hidden className={cn('pointer-events-none absolute border-[var(--accent)] bg-[color-mix(in_srgb,var(--accent)_16%,transparent)]', vertical ? 'inset-x-0 border-y-2' : 'inset-y-0 border-x-2')} style={along(shownSel.start, shownSel.end)} />}
      {/* rtl-lint-ignore: physical geometry in the LTR island */}
      {cursor !== undefined && length > 0 && <span aria-hidden className={cn('pointer-events-none absolute bg-[var(--accent)]', vertical ? 'inset-x-0 h-0.5 -translate-y-1/2' : 'inset-y-0 w-0.5 -translate-x-1/2')} style={at(cursor)} />}
      {shown !== null && <span aria-hidden className={cn('pointer-events-none absolute bg-[var(--fg)]', vertical ? 'inset-x-0 h-px' : 'inset-y-0 w-px')} style={at(shown)} />}
    </div>
  )

  const rulerW: CSSProperties | undefined = vertical ? { width: `${Math.max(6, hexOffset(ticks[ticks.length - 1] ?? 0).length) + 1}ch` } : undefined
  const ruler = (
    <div aria-hidden className={cn('relative font-[family-name:var(--mono)] text-[10px] text-[var(--fg3)] tabular-nums', vertical ? 'h-full flex-none' : 'h-4 w-full')} style={rulerW}>
      {ticks.map(t => <span key={t} className={cn('absolute font-[family-name:var(--mono)] whitespace-nowrap', vertical ? cn('right-1', t > 0 && '-translate-y-1/2') : t > 0 && '-translate-x-1/2')} style={at(t)}>{hexOffset(t)}</span>)} {/* rtl-lint-ignore */}
    </div>
  )
  const bands = (
    <div aria-hidden className={cn('relative min-w-0', vertical ? 'h-full w-[96px] flex-none' : 'h-8 w-full')}>
      {sections.map((s, i) => {
        const c = binarySectionColor(sections, i), len = bandLen(s)
        return (
          <div key={s.name + s.offset} className={cn('absolute overflow-hidden', vertical ? 'inset-x-0 border-s-2 ps-1.5' : 'inset-y-0 border-t-2 pt-0.5 ps-1')} style={{ ...along(s.offset, s.offset + s.size), borderColor: c, background: `color-mix(in srgb, ${c} 12%, transparent)` }}>
            {(vertical ? len >= 14 : len >= 44) && <span className="block truncate font-[family-name:var(--mono)] text-[11px] leading-[14px] text-[var(--fg)]">{s.name}</span>}
            {(vertical ? len >= 30 : len >= 44) && <span className="block truncate text-[10px] leading-[13px] text-[var(--fg2)]">{fmt.bytes(s.size)}</span>}
          </div>
        )
      })}
    </div>
  )

  return (
    <div className={cn('flex min-w-0 flex-col gap-2', className)}>
      <div className="flex h-5 min-w-0 items-center gap-2 text-xs text-[var(--fg2)]" aria-hidden>
        {shown !== null ? <>
          <span dir="ltr" className="font-[family-name:var(--mono)] tabular-nums text-[var(--fg)]">0x{hexOffset(shown)}</span>
          <span className="truncate">{readSec?.name ?? m('noSection')}</span>
          <span className="ms-auto inline-flex flex-none items-center gap-1.5">
            <span className="relative h-1.5 w-10 overflow-hidden rounded-full bg-[var(--muted)]"><span className="absolute inset-y-0 start-0 rounded-full" style={{ width: `${(bitsAt(shown) / 8) * 100}%`, background: entropyColor(bitsAt(shown)) }} /></span>
            <span className="font-[family-name:var(--mono)] tabular-nums text-[var(--fg)]">{m('bits', { value: binBits(bitsAt(shown)) })}</span>
          </span>
        </> : <span className="truncate">{m('hoverStrip')}</span>}
      </div>
      <div dir="ltr" tabIndex={0} role="group" aria-roledescription={m('entropyRole')} aria-label={label ?? m('entropyMap')} onKeyDown={onKeyDown}
        onBlur={e => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) { setActive(null); kAnchor.current = null } }}
        className="rounded-[var(--r-md)] outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]">
        <span className="sr-only">{summary}</span>
        <span className="sr-only" aria-live="polite">{said}</span>
        {vertical ? <>
          <div aria-hidden className="mb-1 flex text-[10px] text-[var(--fg3)]">
            <span className="flex-none font-[family-name:var(--mono)]" style={rulerW}><span className="font-[family-name:var(--font)]">{m('offset')}</span></span>
            <span className="relative flex-1">0<span className="absolute end-0">8</span></span>
            <span className="w-[96px] flex-none ps-2">{m('sections')}</span>
          </div>
          <div className="flex gap-2" style={{ height: plotH }}>
            {ruler}
            <div className="relative min-w-[48px] flex-1 overflow-hidden rounded-[var(--r-sm)] bg-[color-mix(in_srgb,var(--muted)_55%,transparent)]">{plot}</div>
            {bands}
          </div>
        </> : <>
          <div ref={plotRef} className="relative overflow-hidden rounded-[var(--r-sm)] bg-[color-mix(in_srgb,var(--muted)_55%,transparent)]" style={{ height: plotH }}>{plot}</div>
          <div className="mt-1">{ruler}</div>
          <div className="mt-1">{bands}</div>
        </>}
      </div>
      {list && (
        <div dir={dir} className="flex min-w-0 flex-col gap-1">
          <div className="flex items-center gap-2">
            <h4 className="m-0 text-[11px] font-medium tracking-wide text-[var(--fg2)] uppercase">{m('highEntropy')}</h4>
            <Badge size="sm" tone={regions.length ? 'bad' : 'neutral'}>{fmt.number(regions.length)}</Badge>
            <span className="ms-auto inline-flex items-center gap-1 text-[11px] text-[var(--fg3)]"><span aria-hidden className="inline-block h-0 w-3 border-t border-dashed border-[var(--fg2)]" />{m('threshold')} {threshold}</span>
          </div>
          <BinRegionList regions={regions} sections={sections} threshold={threshold} onSelect={select} active={sel} />
        </div>
      )}
    </div>
  )
}

/* ════════════════════════════════════════════════════════════════════════════
 * ByteMap (Hilbert curve)
 * ══════════════════════════════════════════════════════════════════════════ */

/** ByteMap colour modes. */
export type ByteMapMode = 'entropy' | 'sections' | 'class' | 'strings'

/** ByteMap props. */
export type ByteMapProps = {
  data: BinaryData
  sections?: readonly BinarySection[]
  /** curve order: 2^order cells a side (6–8; default 7, 128 × 128) */ order?: number
  /** bytes per cell (default: the data spread over every cell) */ bytesPerCell?: number
  mode?: ByteMapMode; defaultMode?: ByteMapMode; onModeChange?: (mode: ByteMapMode) => void
  /** cell entropy window in bytes (default max(256, bytes per cell): smaller windows can't reach 8 bits) */ entropyWindow?: number
  /** marker: the hex editor's cursor */ cursor?: number
  /** highlighted range: cells outside it are dimmed */ selection?: ByteRange | null
  /** a cell was clicked or chosen with Enter: its first byte */ onSelect?: (offset: number) => void
  onHover?: (offset: number | null) => void
  /** largest side in px (default 320); the map is square and fills its column up to this */ size?: number
  /** the colour-mode switch (default true) */ modes?: boolean
  /** the legend (default true) */ legend?: boolean
  /** Ctrl/⌘ + wheel and buttons zoom into part of the file (default true) */ zoomable?: boolean
  /** accessible name (default "Byte map") */ label?: string
  className?: string
}

/**
 * The file folded onto a Hilbert curve (binvis-style): bytes that are close in the file stay close on the map, so
 * sections show as blocks. Drawn on a canvas (crisp on HiDPI: one pixel per cell, scaled without smoothing, snapped to
 * whole device pixels) inside a square box that never shifts layout. Colour by entropy (the shared scale), section,
 * byte class (zero, printable, control, high) or strings. Hover or tap reads out offset → address, section and an
 * entropy bar; click or Enter selects (`onSelect` with the cell's first byte); `cursor` and `selection` are drawn.
 * Keyboard: ←/→ follow the curve, ↑/↓ move by a row, Home/End, Enter. Ctrl/⌘ + wheel or the buttons zoom into a part
 * of the file (the curve is laid over that range). The map is an LTR island; legend and readout follow the locale.
 */
export function ByteMap({ data, sections = BIN_NO_SECTIONS, order: orderProp = 7, bytesPerCell, mode: modeProp, defaultMode = 'entropy', onModeChange, entropyWindow, cursor, selection,
  onSelect, onHover, size = 320, modes = true, legend = true, zoomable = true, label, className }: ByteMapProps) {
  const m = useMessages(BINARY_MESSAGES), { fmt, dir } = useLocale()
  const bytes = useMemo(() => toByteArray(data), [data]), n = bytes.length
  const order = clamp(Math.round(orderProp), 1, 9), side = 2 ** order, cells = side * side
  const [mode, setMode] = useControllable<ByteMapMode>(modeProp, defaultMode, onModeChange)
  const [zoom, setZoom] = useState<ByteRange | null>(null)
  useEffect(() => setZoom(null), [bytes])
  const vs = zoom?.start ?? 0, ve = zoom?.end ?? n, len = Math.max(0, ve - vs)
  const bpc = Math.max(1, bytesPerCell && !zoom ? Math.floor(bytesPerCell) : Math.ceil(len / cells))
  const used = Math.min(cells, Math.ceil(len / bpc))
  const lut = useMemo(() => binHilbertLut(order), [order])
  const canvas = useRef<HTMLCanvasElement>(null), box = useRef<HTMLDivElement>(null)
  const theme = useBinThemeTick(box)
  const [px, setPx] = useState({ w: 0, dpr: 1 })
  useLayoutEffect(() => {
    const el = box.current; if (!el) return
    const set = () => setPx(p => { const w = el.clientWidth, dpr = window.devicePixelRatio || 1; return p.w === w && p.dpr === dpr ? p : { w, dpr } })
    set()
    const ro = new ResizeObserver(set); ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // per-cell metrics for the current mode (computed once per data, zoom and mode)
  const metric = useMemo(() => {
    const view = bytes.subarray(vs, ve)
    if (mode === 'entropy') return { kind: 'entropy' as const, v: entropyWindows(view, entropyWindow ?? Math.max(256, bpc), bpc, { align: 'center' }) }
    if (mode === 'class') {
      const v = new Float32Array(used * 4), stride = Math.max(1, Math.floor(bpc / 64))
      for (let d = 0; d < used; d++) {
        const a = d * bpc, z = Math.min(len, a + bpc)
        let k = 0
        for (let o = a; o < z; o += stride) { v[d * 4 + BIN_CLASS_IDX[view[o]]]++; k++ }
        for (let c = 0; c < 4; c++) v[d * 4 + c] /= k || 1
      }
      return { kind: 'class' as const, v }
    }
    if (mode === 'strings') {
      const v = new Float32Array(used)
      let run = -1
      const add = (a: number, z: number) => { for (let o = a; o < z;) { const d = Math.floor(o / bpc), e = Math.min(z, (d + 1) * bpc); v[d] += e - o; o = e } }
      for (let o = 0; o <= len; o++) {
        if (o < len && (binPrintable(view[o]) || view[o] === 9)) { if (run < 0) run = o; continue }
        if (run >= 0 && o - run >= 4) add(run, o)
        run = -1
      }
      for (let d = 0; d < used; d++) v[d] /= Math.min(bpc, len - d * bpc) || 1
      return { kind: 'strings' as const, v }
    }
    const v = new Int16Array(used)
    for (let d = 0; d < used; d++) { const s = sectionAt(sections, vs + d * bpc); v[d] = s ? sections.indexOf(s) : -1 }
    return { kind: 'sections' as const, v }
  }, [bytes, vs, ve, len, mode, bpc, used, entropyWindow, sections])

  // the base image: one pixel per cell, in theme colours
  const baseImg = useRef<HTMLCanvasElement | null>(null)
  const pal = useRef<{ card: BinRgb; muted: BinRgb } | null>(null)
  const [drawn, setDrawn] = useState(0)
  useEffect(() => {
    const cv = canvas.current; if (!cv || typeof ImageData === 'undefined') return // no canvas (server, jsdom)
    const C = (css: string) => binRgb(cv, css)
    const muted = C('var(--muted)'), card = C('var(--card)')
    pal.current = { card, muted }
    const img = new ImageData(side, side), px4 = img.data
    const put = (d: number, c: BinRgb) => { const x = lut[d * 2], y = lut[d * 2 + 1], i = (y * side + x) * 4; px4[i] = c[0]; px4[i + 1] = c[1]; px4[i + 2] = c[2]; px4[i + 3] = 255 }
    if (metric.kind === 'entropy') {
      const stops = BIN_ENTROPY_STOPS.map(([b, c]) => [b, C(c)] as const), scale: BinRgb[] = []
      for (let k = 0; k <= 64; k++) { const b = k / 8; let i = 0; while (i < stops.length - 2 && b > stops[i + 1][0]) i++; const [a, ca] = stops[i], [z, cz] = stops[i + 1]; scale.push(binMix(ca, cz, clamp((b - a) / (z - a), 0, 1))) }
      for (let d = 0; d < used; d++) put(d, scale[Math.round(metric.v[d] * 8)])
    } else if (metric.kind === 'class') {
      const cc = BIN_CLASSES.map(k => C(BIN_CLASS_FILL[k]))
      for (let d = 0; d < used; d++) { let r = 0, g = 0, b = 0; for (let c = 0; c < 4; c++) { const f = metric.v[d * 4 + c]; r += cc[c][0] * f; g += cc[c][1] * f; b += cc[c][2] * f } put(d, [r, g, b]) }
    } else if (metric.kind === 'strings') {
      const on = C('var(--c2)')
      for (let d = 0; d < used; d++) put(d, binMix(muted, on, Math.min(1, metric.v[d] * 1.2)))
    } else {
      const sc = sections.map((_, i) => C(binarySectionColor(sections, i)))
      for (let d = 0; d < used; d++) put(d, metric.v[d] >= 0 ? sc[metric.v[d]] : muted)
    }
    for (let d = used; d < cells; d++) put(d, binMix(card, muted, 0.35)) // past the end of the data
    const off = baseImg.current ?? document.createElement('canvas')
    off.width = side; off.height = side
    off.getContext('2d')?.putImageData(img, 0, 0)
    baseImg.current = off
    setDrawn(x => x + 1)
  }, [metric, used, cells, side, lut, sections, theme])

  // geometry: the map is drawn at a whole number of device pixels per cell, centred
  // whole device pixels per cell when that wastes little room, else fill the box (nearest-neighbour keeps edges sharp)
  const devW = Math.round(px.w * px.dpr), whole = Math.max(1, Math.floor(devW / side)), snap = devW - whole * side <= devW * 0.06
  const cellPx = snap ? whole : devW / side, drawPx = snap ? whole * side : devW, pad = snap ? Math.floor((devW - drawPx) / 2) : 0
  const [hover, setHover] = useState<number | null>(null) // cell index
  const [active, setActive] = useState<number | null>(null)
  const cellOfOffset = (o: number) => (o >= vs && o < ve ? Math.floor((o - vs) / bpc) : -1)
  useEffect(() => {
    const cv = canvas.current, base = baseImg.current, P = pal.current
    if (!cv || !base || !P || !devW) return
    if (cv.width !== devW) { cv.width = devW; cv.height = devW }
    const g = cv.getContext('2d'); if (!g) return
    g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, devW, devW)
    g.imageSmoothingEnabled = false
    g.drawImage(base, pad, pad, drawPx, drawPx)
    const rectOf = (d: number) => [pad + lut[d * 2] * cellPx, pad + lut[d * 2 + 1] * cellPx] as const
    if (selection && selection.end > vs && selection.start < ve) { // dim everything outside the selection
      const a = Math.max(0, cellOfOffset(Math.max(selection.start, vs))), z = Math.min(used - 1, cellOfOffset(Math.min(selection.end, ve) - 1))
      g.fillStyle = `rgba(${P.card.join(',')},0.62)`; g.fillRect(pad, pad, drawPx, drawPx)
      for (let d = a; d <= z; d++) { const [x, y] = rectOf(d); g.drawImage(base, lut[d * 2], lut[d * 2 + 1], 1, 1, x, y, cellPx, cellPx) }
    }
    const ring = (d: number, w: number, color: string) => {
      if (d < 0 || d >= cells) return
      const [x, y] = rectOf(d), r = Math.max(cellPx, 6 * px.dpr), o = (r - cellPx) / 2
      g.lineWidth = w; g.strokeStyle = color; g.strokeRect(x - o - w / 2, y - o - w / 2, r + w, r + w)
    }
    const fg = binRgb(cv, 'var(--fg)'), acc = binRgb(cv, 'var(--accent)')
    if (cursor !== undefined) { const d = cellOfOffset(cursor); ring(d, 2 * px.dpr, `rgb(${P.card.join(',')})`); ring(d, 1.25 * px.dpr, `rgb(${acc.join(',')})`) }
    const h = hover ?? active
    if (h !== null) { ring(h, 2 * px.dpr, `rgb(${P.card.join(',')})`); ring(h, 1 * px.dpr, `rgb(${fg.join(',')})`) }
  }, [drawn, devW, pad, drawPx, cellPx, selection, cursor, hover, active, vs, ve, used, cells, bpc, lut, px.dpr]) // eslint-disable-line react-hooks/exhaustive-deps

  const cellAt = (e: { clientX: number; clientY: number }) => {
    const r = canvas.current!.getBoundingClientRect(), k = px.dpr
    const x = Math.floor(((e.clientX - r.left) * k - pad) / cellPx), y = Math.floor(((e.clientY - r.top) * k - pad) / cellPx) // rtl-lint-ignore: canvas pixels
    if (x < 0 || y < 0 || x >= side || y >= side) return null
    const d = hilbertXY2D(order, x, y)
    return d < used ? d : null
  }
  const offOf = (d: number) => vs + d * bpc
  const setHov = (d: number | null) => { setHover(d); onHover?.(d === null ? null : offOf(d)) }
  const zoomAround = (o: number, factor: number) => {
    const curLen = len, nextLen = clamp(Math.round(curLen / factor), Math.min(n, cells), n)
    if (nextLen >= n) { setZoom(null); return }
    const start = clamp(Math.round(o - nextLen / 2), 0, n - nextLen)
    setZoom({ start, end: start + nextLen })
  }
  useEffect(() => {
    const el = box.current; if (!el || !zoomable) return
    const wheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return
      e.preventDefault()
      const d = cellAt(e), o = d === null ? vs + len / 2 : offOf(d)
      zoomAround(o, e.deltaY < 0 ? 4 : 0.25)
    }
    el.addEventListener('wheel', wheel, { passive: false })
    return () => el.removeEventListener('wheel', wheel)
  }) // re-bound every render: it reads the current zoom and geometry
  const [said, setSaid] = useState('')
  const describe = (d: number) => { const o = offOf(d), s = sectionAt(sections, o); return `0x${hexOffset(o)}${s ? `, ${s.name}` : ''}, ${m('bits', { value: binBits(shannonEntropy(bytes, o - 256, o + 256)) })}` }
  const onKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    const cur = active ?? (cursor !== undefined && cellOfOffset(cursor) >= 0 ? cellOfOffset(cursor) : -1)
    let d: number | null = null
    const xy = cur >= 0 ? [lut[cur * 2], lut[cur * 2 + 1]] : [0, 0]
    switch (e.key) {
      case 'ArrowRight': d = cur + 1; break // rtl-lint-ignore: LTR island, → follows the curve forward
      case 'ArrowLeft': d = cur - 1; break // rtl-lint-ignore
      case 'ArrowDown': d = cur < 0 ? 0 : xy[1] < side - 1 ? hilbertXY2D(order, xy[0], xy[1] + 1) : cur; break
      case 'ArrowUp': d = cur < 0 ? 0 : xy[1] > 0 ? hilbertXY2D(order, xy[0], xy[1] - 1) : cur; break
      case 'Home': d = 0; break
      case 'End': d = used - 1; break
      case 'Enter': if (cur >= 0) { e.preventDefault(); onSelect?.(offOf(cur)) } return
      case 'Escape': if (active !== null) { e.preventDefault(); setActive(null) } return
      case '+': case '=': if (zoomable) { e.preventDefault(); zoomAround(cur >= 0 ? offOf(cur) : vs + len / 2, 4) } return
      case '-': if (zoomable) { e.preventDefault(); zoomAround(cur >= 0 ? offOf(cur) : vs + len / 2, 0.25) } return
      default: return
    }
    e.preventDefault()
    const k = clamp(d, 0, Math.max(0, used - 1))
    if (k >= used) return
    setActive(k); setSaid(describe(k)); onHover?.(offOf(k))
  }

  const shownCell = hover ?? active ?? (cursor !== undefined && cellOfOffset(cursor) >= 0 ? cellOfOffset(cursor) : null)
  const shownOff = shownCell !== null ? offOf(shownCell) : null
  const shownSec = shownOff !== null ? sectionAt(sections, shownOff) : undefined
  const shownBits = shownOff !== null ? shannonEntropy(bytes, shownOff - 256, shownOff + 256) : 0
  const modeOpts: { value: ByteMapMode; label: string }[] = [{ value: 'entropy', label: m('modeEntropy') }, { value: 'sections', label: m('modeSections') }, { value: 'class', label: m('modeClass') }, { value: 'strings', label: m('modeStrings') }]
  const chip = (color: string, text: string, key?: string) => <span key={key ?? text} className="inline-flex min-w-0 items-center gap-1.5"><span aria-hidden className="h-2.5 w-2.5 flex-none rounded-[var(--r-sm)]" style={{ background: color }} /><span className="truncate">{text}</span></span>

  return (
    <div className={cn('flex min-w-0 flex-col gap-2', className)} style={{ maxWidth: size }}>
      {modes && <div className="min-w-0 overflow-x-auto"><SegmentedControl size="sm" aria-label={m('colourBy')} value={mode} onChange={v => setMode(v as ByteMapMode)} options={modeOpts} /></div>}
      <div ref={box} dir="ltr" tabIndex={0} role="group" aria-roledescription={m('mapRole')} aria-label={label ?? m('byteMap')} onKeyDown={onKeyDown}
        onBlur={() => { if (active !== null) { setActive(null); onHover?.(null) } }}
        className="relative aspect-square w-full touch-pan-y rounded-[var(--r-md)] bg-[var(--card)] outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]">
        <canvas ref={canvas} aria-hidden className="absolute inset-0 h-full w-full cursor-crosshair rounded-[var(--r-sm)]"
          onPointerMove={e => setHov(cellAt(e))} onPointerLeave={e => { if (e.pointerType === 'mouse') setHov(null) }}
          onPointerDown={e => { if (e.pointerType !== 'mouse') setHov(cellAt(e)) }}
          onClick={e => { const d = cellAt(e); if (d !== null) { setActive(null); onSelect?.(offOf(d)) } }} />
        <span className="sr-only">{m('mapSummary', { size: fmt.bytes(len), side, perCell: m('perCell', { count: bpc }) })}</span>
        <span className="sr-only" aria-live="polite">{said}</span>
      </div>
      <div dir={dir} className="flex h-9 min-w-0 flex-col justify-center text-xs text-[var(--fg2)]" aria-hidden>
        {shownOff !== null ? <>
          <div className="flex min-w-0 items-center gap-2">
            <span dir="ltr" className="truncate font-[family-name:var(--mono)] tabular-nums text-[var(--fg)]">0x{hexOffset(shownOff)}{shownSec?.vaddr !== undefined && <span className="text-[var(--fg2)]"> → 0x{hexOffset(shownSec.vaddr + shownOff - shownSec.offset)}</span>}</span>
            {shownSec && <span className="ms-auto inline-flex min-w-0 items-center gap-1"><span className="h-2 w-2 flex-none rounded-full" style={{ background: binarySectionColor(sections, sections.indexOf(shownSec)) }} /><span className="truncate font-[family-name:var(--mono)]">{shownSec.name}</span></span>}
          </div>
          <div className="flex items-center gap-2">
            <span className="relative h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-[var(--muted)]"><span className="absolute inset-y-0 start-0 rounded-full" style={{ width: `${(shownBits / 8) * 100}%`, background: entropyColor(shownBits) }} /></span>
            <span className="flex-none font-[family-name:var(--mono)] tabular-nums text-[var(--fg)]">{m('bits', { value: binBits(shownBits) })}</span>
          </div>
        </> : <span className="truncate">{m('hoverMap')}</span>}
      </div>
      {(legend || zoomable) && (
        <div dir={dir} className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-[var(--fg2)]">
          {legend && mode === 'entropy' && <div className="flex w-full min-w-0 items-center gap-2">
            <span className="flex-none">0</span>
            <span dir="ltr" aria-hidden className="h-2 min-w-0 flex-1 rounded-full" style={{ background: binEntropyGradient('to right') }} />
            <span className="flex-none">{m('bits', { value: 8 })}</span>
          </div>}
          {legend && mode === 'sections' && sections.map((s, i) => chip(binarySectionColor(sections, i), s.name, s.name + s.offset))}
          {legend && mode === 'class' && BIN_CLASSES.map(k => chip(BIN_CLASS_FILL[k], m(k === 'null' ? 'classNull' : k === 'ascii' ? 'classAscii' : k === 'control' ? 'classControl' : 'classHigh'), k))}
          {legend && mode === 'strings' && <>{chip('var(--c2)', m('inString'))}{chip('var(--muted)', m('notString'))}</>}
          <span className="ms-auto inline-flex items-center gap-1 text-[var(--fg3)]">
            {zoom && <button type="button" onClick={() => setZoom(null)} className="me-1 cursor-pointer border-0 bg-transparent p-0 text-[11px] text-[var(--accent)] underline-offset-2 hover:underline">{m('zoomReset')}</button>}
            <span className="me-1">{m('perCell', { count: bpc })}</span>
            {zoomable && <>
              <IconButton icon="zoomIn" size="icon-xs" label={m('zoomIn')} disabled={len <= cells} onClick={() => zoomAround(cursor !== undefined && cursor >= vs && cursor < ve ? cursor : vs + len / 2, 4)} />
              <IconButton icon="minus" size="icon-xs" label={m('zoomOut')} disabled={!zoom} onClick={() => zoomAround(vs + len / 2, 0.25)} />
            </>}
          </span>
        </div>
      )}
    </div>
  )
}

/* ════════════════════════════════════════════════════════════════════════════
 * Sections list and BinaryView
 * ══════════════════════════════════════════════════════════════════════════ */

/**
 * The file's sections as a list: colour dot, name, size and a bar (size relative to the largest). The section at
 * `cursor` is marked current; a click selects one (`onSelect`).
 */
export function BinarySectionList({ sections, cursor, selection, onSelect, className }:
  { sections: readonly BinarySection[]; cursor?: number; selection?: ByteRange | null; onSelect?: (s: BinarySection) => void; className?: string }) {
  const m = useMessages(BINARY_MESSAGES), { fmt } = useLocale()
  const big = Math.max(1, ...sections.map(s => s.size))
  const cur = cursor !== undefined ? sectionAt(sections, cursor) : undefined
  return (
    <ul aria-label={m('sections')} className={cn('m-0 flex list-none flex-col p-0', className)}>
      {sections.map((s, i) => {
        const on = !!selection && selection.start === s.offset && selection.end === s.offset + s.size
        return (
          <li key={s.name + s.offset}>
            <button type="button" onClick={() => onSelect?.(s)} aria-current={cur === s ? 'location' : undefined} aria-pressed={on}
              className={cn('grid h-8 w-full cursor-pointer grid-cols-[auto_minmax(0,1fr)_auto_56px] items-center gap-2 rounded-[var(--r-md)] border-0 bg-transparent px-2 text-start text-xs [@media(pointer:coarse)]:h-10', rowHoverClass, on && '!bg-[var(--accent-soft)]')}>
              <span aria-hidden className="h-2.5 w-2.5 rounded-full" style={{ background: binarySectionColor(sections, i) }} />
              <span className={cn('truncate font-[family-name:var(--mono)]', cur === s ? 'font-semibold text-[var(--fg)]' : 'text-[var(--fg)]')}>{s.name}</span>
              <span className="tabular-nums text-[var(--fg2)]">{fmt.bytes(s.size)}</span>
              <span aria-hidden className="h-1.5 overflow-hidden rounded-full bg-[var(--muted)]"><span className="block h-full rounded-full" style={{ width: `${Math.max(4, (s.size / big) * 100)}%`, background: binarySectionColor(sections, i) }} /></span>
            </button>
          </li>
        )
      })}
    </ul>
  )
}

/** BinaryView props. */
export type BinaryViewProps = {
  data: BinaryData
  sections?: readonly BinarySection[]
  cursor?: number; defaultCursor?: number; onCursorChange?: (offset: number) => void
  selection?: ByteRange | null; onSelectionChange?: (range: ByteRange | null) => void
  readOnly?: boolean
  onChange?: (edits: HexEdit[]) => void
  /** 'auto' (columns from 900 px, tabs below; default), or force 'columns' / 'tabs' */ layout?: 'auto' | 'columns' | 'tabs'
  /** entropy window (default 512) and threshold (default 7.2) */ windowSize?: number; threshold?: number
  /** Hilbert curve order of the map (default 7) */ mapOrder?: number
  /** hex grid height in px (default 360) */ hexHeight?: number
  /** accessible name of the region (default "Binary explorer") */ label?: string
  className?: string
}

/**
 * ByteMap, the sections list, EntropyMap and HexEditor sharing one cursor and selection: a cell on the map, a
 * section, a stretch of the entropy strip or a high-entropy region moves the hex editor there and selects it, and the
 * hex cursor is marked on the map and the strip. High-entropy regions are tinted in the hex grid. Columns on wide
 * screens; tabs (Map / Entropy / Hex) on narrow ones, with "Show in hex" to jump. Entropy is computed once and shared.
 */
export function BinaryView({ data, sections = BIN_NO_SECTIONS, cursor: cursorProp, defaultCursor = 0, onCursorChange, selection: selectionProp, onSelectionChange, readOnly, onChange,
  layout = 'auto', windowSize = 512, threshold = 7.2, mapOrder = 7, hexHeight = 360, label, className }: BinaryViewProps) {
  const m = useMessages(BINARY_MESSAGES), { fmt } = useLocale()
  const bytes = useMemo(() => toByteArray(data), [data])
  const [cursor, setCursor] = useControllable(cursorProp, defaultCursor, onCursorChange)
  const [selection, setSelection] = useControllable<ByteRange | null>(selectionProp, null, onSelectionChange)
  const entropy = useMemo(() => entropyWindows(bytes, windowSize), [bytes, windowSize])
  const regions = useMemo(() => highEntropyRegions(entropy, { windowSize, threshold, length: bytes.length }), [entropy, windowSize, threshold, bytes.length])
  const highlights = useMemo<BinaryHighlight[]>(() => regions.slice(0, 2000).map(r => ({ start: r.start, end: r.end, color: 'var(--bad)', label: m('highEntropy') })), [regions, m])
  const [ref, width] = useWidth<HTMLDivElement>()
  const tabs = layout === 'tabs' || (layout === 'auto' && width > 0 && width < 900)
  const [tab, setTab] = useState('map')
  const jump = (r: ByteRange | null, o: number) => { setSelection(r); setCursor(o) }
  const selectSection = (s: BinarySection) => jump({ start: s.offset, end: Math.min(bytes.length, s.offset + s.size) }, s.offset)
  const hex = <HexEditor data={bytes} sections={sections} cursor={cursor} onCursorChange={setCursor} selection={selection} onSelectionChange={setSelection} readOnly={readOnly} onChange={onChange}
    highlights={highlights} height={hexHeight} inspector={tabs ? 'auto' : 'bottom'} />
  const map = <ByteMap data={bytes} sections={sections} order={mapOrder} cursor={cursor} selection={selection} onSelect={o => jump(null, o)} />
  const list = <BinarySectionList sections={sections} cursor={cursor} selection={selection} onSelect={selectSection} />
  const strip = (len: number) => <EntropyMap entropy={entropy} length={bytes.length} windowSize={windowSize} threshold={threshold} sections={sections} size={len} cursor={cursor} selection={selection} onSelect={r => jump(r, r.start)} />
  const summary = <p className="m-0 text-xs text-[var(--fg2)]">{m('fileSummary', { size: fmt.bytes(bytes.length), count: sections.length })}</p>
  return (
    <section ref={ref} aria-label={label ?? m('binaryView')} className={cn('min-w-0', className)}>
      {tabs ? (
        <Tabs.Root value={tab} onValueChange={setTab}>
          <Tabs.List aria-label={label ?? m('binaryView')}>
            <Tabs.Trigger value="map">{m('tabMap')}</Tabs.Trigger>
            <Tabs.Trigger value="entropy">{m('tabEntropy')}</Tabs.Trigger>
            <Tabs.Trigger value="hex">{m('tabHex')}</Tabs.Trigger>
          </Tabs.List>
          <Tabs.Content value="map" className="flex flex-col gap-3 pt-3">
            <div className="mx-auto w-full max-w-[360px]">{map}</div>
            <div className="flex items-center justify-between gap-2">{summary}<Button size="sm" onClick={() => setTab('hex')}>{m('showInHex')}</Button></div>
            {list}
          </Tabs.Content>
          <Tabs.Content value="entropy" className="flex flex-col gap-3 pt-3">
            {strip(340)}
            <Button size="sm" className="self-end" onClick={() => setTab('hex')}>{m('showInHex')}</Button>
          </Tabs.Content>
          <Tabs.Content value="hex" className="pt-3">{hex}</Tabs.Content>
        </Tabs.Root>
      ) : (
        <div className="grid grid-cols-[minmax(240px,300px)_minmax(0,1fr)_minmax(200px,240px)] gap-x-5 gap-y-4">
          <div className="min-w-0">{map}</div>
          <div className="flex min-w-0 flex-col gap-2">
            <h4 className="m-0 text-[11px] font-medium tracking-wide text-[var(--fg2)] uppercase">{m('sections')}</h4>
            {list}
            {summary}
          </div>
          <div className="row-span-2 min-w-0">{strip(hexHeight + 300)}</div>
          <div className="col-span-2 min-w-0">{hex}</div>
        </div>
      )}
    </section>
  )
}
