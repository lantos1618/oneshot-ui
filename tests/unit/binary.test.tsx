// Binary views: the pure helpers (entropy, high-entropy regions, Hilbert curve, strings, search, decoders, copy
// formats, go-to parsing), then HexEditor (keyboard, selection, editing, undo, read-only, virtualisation of large
// data), EntropyMap (regions list) and ByteMap (renders without a canvas).
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import {
  ByteMap, EntropyMap, HexEditor, classifyByte, decodeBytes, entropyWindows, findStrings, formatBytesAs, hexOffset, highEntropyRegions,
  hilbertD2XY, hilbertXY2D, parseByteOffset, parseHexPattern, readVarint, searchBytes, sectionAt, shannonEntropy, type ByteRange, type HexEdit,
} from '../../src/lib/binary'
import { BINARY_SAMPLE_SECTIONS, binarySample } from '../../src/examples/binary'
import { expectLinear } from '../helpers'

/** Deterministic noise (xorshift32). */
function noise(n: number, seed = 7) {
  const out = new Uint8Array(n); let x = seed
  for (let i = 0; i < n; i++) { x ^= x << 13; x >>>= 0; x ^= x >>> 17; x ^= x << 5; x >>>= 0; out[i] = x & 0xff }
  return out
}

describe('entropy', () => {
  it('is 0 for one repeated value and 8 for every value equally often', () => {
    expect(shannonEntropy(new Uint8Array(4096))).toBe(0)
    expect(shannonEntropy(new Uint8Array(1000).fill(0x41))).toBe(0)
    expect(shannonEntropy(Uint8Array.from({ length: 256 * 8 }, (_, i) => i & 0xff))).toBeCloseTo(8, 10)
    expect(shannonEntropy(new Uint8Array(0))).toBe(0)
  })
  it('matches known distributions', () => {
    expect(shannonEntropy(Uint8Array.from({ length: 1000 }, (_, i) => i & 1))).toBeCloseTo(1, 10) // two values, 50/50
    expect(shannonEntropy(Uint8Array.from({ length: 1000 }, (_, i) => i % 4))).toBeCloseTo(2, 10)
    expect(shannonEntropy(Uint8Array.from({ length: 1024 }, (_, i) => i % 16))).toBeCloseTo(4, 10)
    // 3 of one value, 1 of another: -(0.75 log2 0.75 + 0.25 log2 0.25) = 0.8113
    expect(shannonEntropy(Uint8Array.from({ length: 400 }, (_, i) => (i % 4 === 0 ? 1 : 0)))).toBeCloseTo(0.811278, 5)
  })
  it('is close to 8 for uniform random bytes', () => {
    expect(shannonEntropy(noise(1 << 16))).toBeGreaterThan(7.99)
    const w = entropyWindows(noise(1 << 16), 4096)
    expect(w.length).toBe(16)
    for (const v of w) expect(v).toBeGreaterThan(7.9)
  })
  it('slides: every window equals a direct computation (overlapping, gapped, centred, partial tail)', () => {
    const b = new Uint8Array(5000)
    b.set(noise(1200), 1800); for (let i = 3500; i < 5000; i++) b[i] = i % 7
    for (const [w, step, align] of [[512, 512, 'start'], [512, 128, 'start'], [256, 600, 'start'], [300, 100, 'center']] as const) {
      const got = entropyWindows(b, w, step, { align })
      expect(got.length).toBe(Math.ceil(b.length / step))
      got.forEach((v, i) => {
        const a = align === 'center' ? i * step + Math.floor((step - w) / 2) : i * step
        expect(v).toBeCloseTo(shannonEntropy(b, Math.max(0, a), Math.min(b.length, a + w)), 4)
      })
    }
  })
  it('scales linearly with the input (8 MB in one pass)', () => {
    expectLinear(n => { const b = noise(n); return () => entropyWindows(b, 512) }, 1 << 19)
    expect(entropyWindows(noise(8 << 20), 512).length).toBe((8 << 20) / 512)
  })
})

describe('highEntropyRegions', () => {
  const e = [1, 7.5, 7.6, 2, 7.9, 7.3, 7.4, 1]
  it('merges consecutive windows at or above the threshold', () => {
    const r = highEntropyRegions(e, { windowSize: 512, threshold: 7.2, length: 8 * 512 })
    expect(r.map(x => x.windows)).toEqual([[1, 2], [4, 6]])
    expect(r[0]).toMatchObject({ start: 512, end: 1536, size: 1024, max: 7.6 })
    expect(r[0].mean).toBeCloseTo(7.55)
    expect(r[1]).toMatchObject({ start: 2048, end: 3584, max: 7.9 })
    // a window exactly at the threshold counts: it starts a region alone and extends a neighbour
    expect(highEntropyRegions([1, 7.2, 1], { threshold: 7.2 }).map(x => x.windows)).toEqual([[1, 1]])
    expect(highEntropyRegions([7.5, 7.2, 1], { threshold: 7.2 }).map(x => x.windows)).toEqual([[0, 1]])
    expect(highEntropyRegions([1, 7.19, 1], { threshold: 7.2 })).toEqual([])
  })
  it('bridges `gap` low windows, clips to the length, honours the threshold and step', () => {
    expect(highEntropyRegions(e, { threshold: 7.2, gap: 1 }).map(x => x.windows)).toEqual([[1, 6]])
    expect(highEntropyRegions([8, 8], { windowSize: 512, length: 700 })[0]).toMatchObject({ start: 0, end: 700, size: 700 })
    expect(highEntropyRegions(e, { threshold: 7.8 }).map(x => x.windows)).toEqual([[4, 4]])
    expect(highEntropyRegions([0, 8, 8], { windowSize: 512, step: 256, length: 2000 })[0]).toMatchObject({ start: 256, end: 1024 })
    expect(highEntropyRegions([], {})).toEqual([])
  })
})

describe('Hilbert curve', () => {
  it('is a bijection for orders 1–8 and moves one cell per step', () => {
    for (let order = 1; order <= 8; order++) {
      const side = 2 ** order, seen = new Uint8Array(side * side)
      let prev: [number, number] | null = null
      for (let d = 0; d < side * side; d++) {
        const [x, y] = hilbertD2XY(order, d)
        expect(x >= 0 && x < side && y >= 0 && y < side).toBe(true)
        expect(seen[y * side + x]).toBe(0); seen[y * side + x] = 1
        if (hilbertXY2D(order, x, y) !== d) throw new Error(`order ${order}: xy2d(d2xy(${d})) = ${hilbertXY2D(order, x, y)}`)
        if (prev) expect(Math.abs(prev[0] - x) + Math.abs(prev[1] - y)).toBe(1)
        prev = [x, y]
      }
    }
  })
  it('starts in a corner and ends in the adjacent one', () => {
    expect(hilbertD2XY(3, 0)).toEqual([0, 0])
    expect(hilbertD2XY(3, 63)).toEqual([7, 0])
  })
})

describe('bytes, strings and sections', () => {
  it('classifies bytes', () => {
    expect([0, 0x41, 0x20, 9, 10, 13, 1, 0x1b, 0x7f, 0x80, 0xff].map(classifyByte))
      .toEqual(['null', 'ascii', 'ascii', 'ascii', 'ascii', 'ascii', 'control', 'control', 'control', 'high', 'high'])
  })
  it('finds ASCII and UTF-16LE strings of at least `min` characters', () => {
    const enc = new TextEncoder()
    const b = new Uint8Array(64)
    b.set(enc.encode('abc'), 0); b.set(enc.encode('hello\tworld'), 8)
    const wide = 'WIDE!'; for (let i = 0; i < wide.length; i++) b[30 + i * 2] = wide.charCodeAt(i)
    const all = findStrings(b)
    expect(all).toEqual([
      { offset: 8, length: 11, text: 'hello\tworld', encoding: 'ascii' },
      { offset: 30, length: 10, text: 'WIDE!', encoding: 'utf16le' },
    ])
    expect(findStrings(b, { min: 3, encodings: ['ascii'] }).map(s => s.text)).toEqual(['abc', 'hello\tworld'])
    expect(findStrings(b, { encodings: ['utf16le'] }).map(s => s.text)).toEqual(['WIDE!'])
    expect(findStrings(b, { max: 1 })).toHaveLength(1)
  })
  it('caps the text at maxLength (the length stays the full run) and searches only start–end', () => {
    const b = new Uint8Array(40)
    b.set(new TextEncoder().encode('abcdefghij'), 2); b.set(new TextEncoder().encode('KLMNOP'), 20)
    expect(findStrings(b, { encodings: ['ascii'], maxLength: 4 })).toEqual([
      { offset: 2, length: 10, text: 'abcd', encoding: 'ascii' },
      { offset: 20, length: 6, text: 'KLMN', encoding: 'ascii' },
    ])
    expect(findStrings(b, { encodings: ['ascii'], start: 15 }).map(s => s.offset)).toEqual([20])
    expect(findStrings(b, { encodings: ['ascii'], end: 15 }).map(s => s.offset)).toEqual([2])
    // a run cut by the range is only the part inside it, and is dropped when that part is under `min`
    expect(findStrings(b, { encodings: ['ascii'], start: 5, end: 24 })).toEqual([
      { offset: 5, length: 7, text: 'defghij', encoding: 'ascii' },
      { offset: 20, length: 4, text: 'KLMN', encoding: 'ascii' },
    ])
    expect(findStrings(b, { encodings: ['ascii'], start: 9 }).map(s => s.offset)).toEqual([20])
  })
  it('looks sections up (the smallest when nested)', () => {
    const s = [{ name: 'seg', offset: 0, size: 100 }, { name: 'inner', offset: 10, size: 10 }]
    expect(sectionAt(s, 5)?.name).toBe('seg')
    expect(sectionAt(s, 12)?.name).toBe('inner')
    expect(sectionAt(s, 100)).toBeUndefined()
    expect(sectionAt(s, 9)?.name).toBe('seg')
    expect(sectionAt(s, 20)?.name).toBe('seg') // inner's end is exclusive
  })
})

describe('searchBytes', () => {
  const b = new TextEncoder().encode('xxABAByyabab\x00\x7fELF')
  it('finds text, overlapping matches included', () => {
    expect(searchBytes(b, 'AB')).toEqual([2, 4])
    expect(searchBytes(new TextEncoder().encode('AAAA'), 'AA')).toEqual([0, 1, 2])
    expect(searchBytes(b, 'aba', { ignoreCase: true })).toEqual([2, 8])
    expect(searchBytes(new TextEncoder().encode('xABABAx'), 'ABA')).toEqual([1, 3])
    expect(searchBytes(b, 'ABA')).toEqual([2])
    expect(searchBytes(b, 'aba')).toEqual([8])
    expect(searchBytes(b, 'ab', { ignoreCase: true })).toEqual([2, 4, 8, 10])
    expect(searchBytes(b, 'zz')).toEqual([])
    expect(searchBytes(b, '')).toEqual([])
  })
  it('finds hex patterns with wildcards, and byte arrays', () => {
    expect(searchBytes(b, '7F 45 4C 46', { as: 'hex' })).toEqual([13])
    expect(searchBytes(b, '00 ?? 45', { as: 'hex' })).toEqual([12])
    expect(searchBytes(b, [0x79, 0x79])).toEqual([6])
    expect(searchBytes(b, '41 42', { as: 'hex', from: 3 })).toEqual([4])
    expect(searchBytes(b, '41', { as: 'hex', max: 1 })).toEqual([2])
    expect(searchBytes(b, 'zz', { as: 'hex' })).toEqual([])
  })
  it('parses hex patterns', () => {
    expect(parseHexPattern('7F 45 ?? 46')).toEqual([0x7f, 0x45, -1, 0x46])
    expect(parseHexPattern('0x7f,0x45')).toEqual([0x7f, 0x45])
    expect(parseHexPattern('\\x7f\\x45')).toEqual([0x7f, 0x45])
    expect(parseHexPattern('7F4')).toBeNull()
    expect(parseHexPattern('GG')).toBeNull()
    expect(parseHexPattern('')).toBeNull()
  })
})

describe('decodeBytes', () => {
  const at = (bytes: number[], le = true) => decodeBytes(Uint8Array.from(bytes), 0, le)
  it('reads integers in both byte orders, signed and unsigned', () => {
    const d = at([0x34, 0x12, 0x78, 0x56, 0, 0, 0, 0x80])
    expect([d.u8, d.i8, d.u16, d.u32]).toEqual([0x34, 0x34, 0x1234, 0x56781234])
    expect(d.u64).toBe(0x8000000056781234n)
    expect(d.i64).toBe(0x56781234n - 2n ** 63n)
    const be = at([0x12, 0x34, 0x56, 0x78], false)
    expect([be.u16, be.u32]).toEqual([0x1234, 0x12345678])
    const neg = at([0xff, 0xfe, 0xff, 0xff])
    expect([neg.u8, neg.i8, neg.i16, neg.i32, neg.u16]).toEqual([255, -1, -257, -257, 0xfeff])
    expect(at([0xff, 0xff, 0xff, 0x7f], false).i32).toBe(-129) // ff ff ff 7f big-endian = 0xffffff7f
  })
  it('reads floats, including NaN, infinities and -0', () => {
    const f = (v: number, le = true) => { const b = new Uint8Array(8); new DataView(b.buffer).setFloat32(0, v, le); return decodeBytes(b, 0, le).f32 }
    expect(f(1.5)).toBe(1.5)
    expect(f(-2.25, false)).toBe(-2.25)
    expect(f(Infinity)).toBe(Infinity)
    expect(f(-Infinity)).toBe(-Infinity)
    expect(Number.isNaN(f(NaN))).toBe(true)
    expect(Object.is(f(-0), -0)).toBe(true)
    const b = new Uint8Array(8); new DataView(b.buffer).setFloat64(0, Math.PI, false)
    expect(decodeBytes(b, 0, false).f64).toBe(Math.PI)
    expect(decodeBytes(b, 0, true).f64).not.toBe(Math.PI)
    expect(at([0, 0, 0xc0, 0x7f]).f32).toBeNaN()
  })
  it('reads varints, zigzag, unix time and bits; null when bytes run out', () => {
    expect(readVarint(Uint8Array.from([0xac, 0x02]), 0)).toEqual({ value: 300n, length: 2 })
    expect(readVarint(Uint8Array.from([0x80]), 0)).toBeNull()
    expect(at([0x03]).zigzag).toBe(-2n)
    expect(at([0x04]).zigzag).toBe(2n)
    const t = new Uint8Array(4); new DataView(t.buffer).setUint32(0, 1_700_000_000, true)
    expect(decodeBytes(t, 0).unix32?.toISOString()).toBe('2023-11-14T22:13:20.000Z')
    const d = at([0x4d, 0x5a])
    expect(d.binary).toBe('01001101')
    expect([d.u32, d.f32, d.u64, d.f64, d.unix32]).toEqual([null, null, null, null, null])
    expect(decodeBytes(Uint8Array.from([1, 2]), 5).u8).toBeNull()
  })
})

describe('formatting and parsing', () => {
  const b = Uint8Array.from([0x4d, 0x5a, 0x00, 0x41])
  it('formats bytes for the clipboard', () => {
    expect(formatBytesAs(b, 'hex')).toBe('4D 5A 00 41')
    expect(formatBytesAs(b, 'c', 'mz')).toBe('unsigned char mz[4] = {\n  0x4d, 0x5a, 0x00, 0x41\n};')
    expect(formatBytesAs(b, 'base64')).toBe('TVoAQQ==')
    expect(formatBytesAs(b, 'text')).toBe('MZ.A')
    expect(formatBytesAs(new Uint8Array(17), 'hex').split('\n')).toHaveLength(2)
    expect(hexOffset(0x360, 8)).toBe('00000360')
  })
  it('parses go-to offsets: hex (bare digits too), #decimal, relative and section addresses', () => {
    const o = { size: 0x1000, cursor: 0x100, sections: [{ name: '.text', offset: 0x200, size: 0x400, vaddr: 0x401000 }] }
    expect(parseByteOffset('0x10', o)).toBe(16)
    expect(parseByteOffset('10', o)).toBe(16)
    expect(parseByteOffset('00000360', o)).toBe(0x360)
    expect(parseByteOffset('#10', o)).toBe(10)
    expect(parseByteOffset('ff', o)).toBe(255)
    expect(parseByteOffset('20h', o)).toBe(32)
    expect(parseByteOffset('+0x10', o)).toBe(0x110)
    expect(parseByteOffset('-10', o)).toBe(0xf0)
    expect(parseByteOffset('+0xeff', o)).toBe(0xfff) // the last byte
    expect(parseByteOffset('+0xf00', o)).toBeNull() // one past the end
    expect(parseByteOffset('-0x100', o)).toBe(0)
    expect(parseByteOffset('-0x101', o)).toBeNull()
    expect(parseByteOffset('0xfff', o)).toBe(0xfff)
    expect(parseByteOffset('0x1000', o)).toBeNull()
    expect(parseByteOffset('0x401010', o)).toBe(0x210)
    expect(parseByteOffset('0x5000', o)).toBeNull()
    expect(parseByteOffset('nope', o)).toBeNull()
  })
})

/* ── HexEditor ─────────────────────────────────────────────────────────────── */

const grid = () => screen.getByRole('group', { name: 'Hex editor' })

describe('HexEditor', () => {
  it('moves the cursor with the keyboard and announces it', () => {
    const onCursor = vi.fn()
    render(<HexEditor data={Uint8Array.from({ length: 64 }, (_, i) => i)} onCursorChange={onCursor} inspector={false} />)
    const g = grid()
    fireEvent.keyDown(g, { key: 'ArrowRight' }); expect(onCursor).toHaveBeenLastCalledWith(1)
    fireEvent.keyDown(g, { key: 'ArrowDown' }); expect(onCursor).toHaveBeenLastCalledWith(17)
    fireEvent.keyDown(g, { key: 'End' }); expect(onCursor).toHaveBeenLastCalledWith(31)
    fireEvent.keyDown(g, { key: 'Home' }); expect(onCursor).toHaveBeenLastCalledWith(16)
    fireEvent.keyDown(g, { key: 'End', ctrlKey: true }); expect(onCursor).toHaveBeenLastCalledWith(63)
    fireEvent.keyDown(g, { key: 'ArrowDown' }); expect(onCursor).toHaveBeenLastCalledWith(63) // no row below: stays
    fireEvent.keyDown(g, { key: 'Home' }); fireEvent.keyDown(g, { key: 'ArrowRight' }); fireEvent.keyDown(g, { key: 'ArrowRight' })
    expect(onCursor).toHaveBeenLastCalledWith(50)
    fireEvent.keyDown(g, { key: 'ArrowDown' }); expect(screen.getByText(/^Offset 0x32: /)).toBeInTheDocument() // stays in its column, not the last byte
    expect(onCursor).toHaveBeenLastCalledWith(50)
    fireEvent.keyDown(g, { key: 'ArrowUp' }); expect(onCursor).toHaveBeenLastCalledWith(34)
    fireEvent.keyDown(g, { key: 'ArrowUp' }); fireEvent.keyDown(g, { key: 'ArrowUp' }); expect(onCursor).toHaveBeenLastCalledWith(2)
    fireEvent.keyDown(g, { key: 'ArrowUp' }); expect(onCursor).toHaveBeenLastCalledWith(2) // no row above: stays
    fireEvent.keyDown(g, { key: 'Home', ctrlKey: true }); expect(onCursor).toHaveBeenLastCalledWith(0)
    expect(screen.getByText(/^Offset 0x0: 00$/)).toBeInTheDocument()
    expect(screen.getByText('0x00000000')).toBeInTheDocument()
  })
  it('extends the selection with Shift, selects all with Ctrl+A, clears with Escape', () => {
    let sel: ByteRange | null = null
    render(<HexEditor data={new Uint8Array(64)} onSelectionChange={r => { sel = r }} inspector={false} />)
    const g = grid()
    fireEvent.keyDown(g, { key: 'ArrowRight', shiftKey: true })
    fireEvent.keyDown(g, { key: 'ArrowRight', shiftKey: true })
    expect(sel).toEqual({ start: 0, end: 3 })
    fireEvent.keyDown(g, { key: 'ArrowDown', shiftKey: true })
    expect(sel).toEqual({ start: 0, end: 19 })
    fireEvent.keyDown(g, { key: 'a', ctrlKey: true }); expect(sel).toEqual({ start: 0, end: 64 })
    fireEvent.keyDown(g, { key: 'Escape' }); expect(sel).toBeNull()
  })
  it('selects by click and shift+click across the panes; typing then writes into the pane clicked', () => {
    const onSel = vi.fn(), onCursor = vi.fn(), onChange = vi.fn()
    const { container } = render(<HexEditor data={Uint8Array.from({ length: 64 }, (_, i) => 0x41 + (i % 26))} onSelectionChange={onSel} onCursorChange={onCursor} onChange={onChange} inspector={false} />)
    /**
     * Where to press for byte `o` in pane `p` ('h' hex, 't' text): the element covering it and an x inside it, given
     * a fake 10 px-per-byte layout. Works whether bytes are single cells or runs of `data-n` bytes.
     */
    const at = (o: number, p: 'h' | 't') => {
      const el = [...container.querySelectorAll<HTMLElement>(`[data-p="${p}"][data-o]`)].find(e => o >= +e.dataset.o! && o < +e.dataset.o! + +(e.dataset.n ?? 1))!
      const k = +(el.dataset.n ?? 1)
      el.getBoundingClientRect = () => ({ left: 0, top: 0, width: k * 10, height: 20, right: k * 10, bottom: 20, x: 0, y: 0, toJSON: () => ({}) })
      return { el, clientX: (o - +el.dataset.o!) * 10 + 5 }
    }
    const a = at(2, 'h')
    fireEvent.pointerDown(a.el, { pointerType: 'mouse', button: 0, pointerId: 1, clientX: a.clientX })
    expect(onCursor).toHaveBeenLastCalledWith(2)
    const b = at(5, 't')
    fireEvent.pointerDown(b.el, { pointerType: 'mouse', button: 0, pointerId: 1, shiftKey: true, clientX: b.clientX })
    expect(onSel).toHaveBeenLastCalledWith({ start: 2, end: 6 })
    expect(onCursor).toHaveBeenLastCalledWith(5)
    expect(screen.getByText(/^0x2–0x5, 4\s?B$/)).toBeInTheDocument()
    // the shift+click was in the text column, so a letter is written as text at the cursor, and the selection goes
    fireEvent.keyDown(grid(), { key: 'z' })
    expect(onChange).toHaveBeenLastCalledWith([{ offset: 5, before: 0x46, after: 0x7a }])
    expect(onSel).toHaveBeenLastCalledWith(null)
    // a plain click starts over
    const c = at(9, 'h')
    fireEvent.pointerDown(c.el, { pointerType: 'mouse', button: 0, pointerId: 1, clientX: c.clientX })
    expect(onCursor).toHaveBeenLastCalledWith(9)
    fireEvent.keyDown(grid(), { key: 'ArrowRight', shiftKey: true })
    expect(onSel).toHaveBeenLastCalledWith({ start: 9, end: 11 })
  })
  it('overwrites with hex digits and text, reports edits, undoes and redoes', () => {
    let edits: HexEdit[] = []
    render(<HexEditor data={Uint8Array.from([0x10, 0x20, 0x30, 0x40])} onChange={e => { edits = e }} inspector={false} />)
    const g = grid()
    fireEvent.keyDown(g, { key: 'a' })
    expect(edits).toEqual([{ offset: 0, before: 0x10, after: 0xa0 }]) // high nibble first
    fireEvent.keyDown(g, { key: 'B' })
    expect(edits).toEqual([{ offset: 0, before: 0x10, after: 0xab }])
    fireEvent.keyDown(g, { key: '7' }); fireEvent.keyDown(g, { key: '7' }) // cursor moved on to byte 1
    expect(edits.map(e => [e.offset, e.after])).toEqual([[0, 0xab], [1, 0x77]])
    fireEvent.keyDown(g, { key: 'Tab' }) // to the text column
    fireEvent.keyDown(g, { key: 'Z' })
    expect(edits.at(-1)).toEqual({ offset: 2, before: 0x30, after: 0x5a })
    expect(screen.getByText('3 edits')).toBeInTheDocument()
    fireEvent.keyDown(g, { key: 'z', ctrlKey: true })
    expect(edits.map(e => e.offset)).toEqual([0, 1])
    fireEvent.keyDown(g, { key: 'z', ctrlKey: true }); fireEvent.keyDown(g, { key: 'z', ctrlKey: true })
    expect(edits).toEqual([{ offset: 0, before: 0x10, after: 0xab }])
    fireEvent.keyDown(g, { key: 'z', ctrlKey: true })
    expect(edits).toEqual([{ offset: 0, before: 0x10, after: 0xa0 }])
    fireEvent.keyDown(g, { key: 'z', ctrlKey: true })
    expect(edits).toEqual([])
    fireEvent.keyDown(g, { key: 'z', ctrlKey: true, shiftKey: true })
    expect(edits).toEqual([{ offset: 0, before: 0x10, after: 0xa0 }])
    fireEvent.keyDown(g, { key: 'y', ctrlKey: true })
    expect(edits).toEqual([{ offset: 0, before: 0x10, after: 0xab }])
  })
  it('an edit back to the original value is no edit; the handle applies edits to a copy', () => {
    let edits: HexEdit[] = []
    const ref = { current: null as null | import('../../src/lib/binary').HexEditorHandle }
    const data = Uint8Array.from([0x10, 0x20])
    render(<HexEditor ref={ref} data={data} onChange={e => { edits = e }} inspector={false} />)
    const g = grid()
    fireEvent.keyDown(g, { key: 'f' }); fireEvent.keyDown(g, { key: 'f' })
    expect([...ref.current!.getBytes()]).toEqual([0xff, 0x20])
    expect([...data]).toEqual([0x10, 0x20]) // the data itself is never written
    act(() => ref.current!.goTo(0))
    fireEvent.keyDown(g, { key: '1' }); fireEvent.keyDown(g, { key: '0' })
    expect(edits).toEqual([])
  })
  it('does not edit when readOnly', () => {
    const onChange = vi.fn()
    render(<HexEditor data={new Uint8Array(8)} readOnly onChange={onChange} inspector={false} />)
    fireEvent.keyDown(grid(), { key: 'a' })
    expect(onChange).not.toHaveBeenCalled()
    expect(screen.getAllByText('Read only').length).toBeGreaterThan(0)
  })
  it('copies the selection (or the cursor byte) as hex with Ctrl+C and reports it', async () => {
    userEvent.setup() // installs a clipboard
    const write = vi.spyOn(navigator.clipboard, 'writeText')
    render(<HexEditor data={Uint8Array.from([0x4d, 0x5a, 0x00, 0x41])} inspector={false} />)
    const g = grid()
    fireEvent.keyDown(g, { key: 'c', ctrlKey: true })
    await waitFor(() => expect(write).toHaveBeenLastCalledWith('4D'))
    fireEvent.keyDown(g, { key: 'ArrowRight', shiftKey: true }); fireEvent.keyDown(g, { key: 'ArrowRight', shiftKey: true })
    fireEvent.keyDown(g, { key: 'c', ctrlKey: true })
    await waitFor(() => expect(write).toHaveBeenLastCalledWith('4D 5A 00'))
    expect(await screen.findAllByText(/^Copied 3\s?B$/)).not.toHaveLength(0) // status bar and live region
  })
  it('pages with PageUp/PageDown and focuses go-to and search with Ctrl+G and Ctrl+F', () => {
    const onCursor = vi.fn()
    render(<HexEditor data={new Uint8Array(0x2000)} height={200} onCursorChange={onCursor} inspector={false} />)
    const g = grid()
    fireEvent.keyDown(g, { key: 'PageDown' })
    const page = onCursor.mock.lastCall![0] as number
    expect(page % 16).toBe(0) // whole rows, same column
    expect(page).toBeGreaterThanOrEqual(16 * 4) // about a screen of 200 px rows, less one row
    expect(page).toBeLessThan(16 * 10)
    fireEvent.keyDown(g, { key: 'ArrowRight' }); fireEvent.keyDown(g, { key: 'PageDown' })
    expect(onCursor).toHaveBeenLastCalledWith(2 * page + 1)
    fireEvent.keyDown(g, { key: 'PageUp' }); expect(onCursor).toHaveBeenLastCalledWith(page + 1)
    fireEvent.keyDown(g, { key: 'PageUp' }); fireEvent.keyDown(g, { key: 'PageUp' }); expect(onCursor).toHaveBeenLastCalledWith(0) // clamps at the start
    fireEvent.keyDown(g, { key: 'g', ctrlKey: true })
    expect(screen.getByRole('textbox', { name: 'Go to offset' })).toHaveFocus()
    g.focus()
    fireEvent.keyDown(g, { key: 'f', ctrlKey: true })
    expect(screen.getByRole('searchbox', { name: 'Search bytes' })).toHaveFocus()
  })
  it('goes to an offset typed into the go-to field', () => {
    const onCursor = vi.fn()
    render(<HexEditor data={new Uint8Array(0x2000)} onCursorChange={onCursor} inspector={false} />)
    const input = screen.getByRole('textbox', { name: 'Go to offset' })
    fireEvent.change(input, { target: { value: '0x1F40' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(onCursor).toHaveBeenLastCalledWith(0x1f40)
    fireEvent.change(input, { target: { value: '0x9999' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(input).toHaveAttribute('aria-invalid', 'true')
  })
  it('searches and jumps between matches', async () => {
    vi.useFakeTimers()
    const onCursor = vi.fn()
    const data = new TextEncoder().encode('..ELF....ELF..ELF')
    render(<HexEditor data={data} onCursorChange={onCursor} inspector={false} />)
    fireEvent.click(screen.getByRole('radio', { name: 'Text' }))
    const box = screen.getByRole('searchbox', { name: 'Search bytes' })
    fireEvent.change(box, { target: { value: 'ELF' } })
    await act(async () => { vi.advanceTimersByTime(300) })
    expect(screen.getByRole('status')).toHaveTextContent('3')
    fireEvent.keyDown(box, { key: 'Enter' })
    expect(onCursor).toHaveBeenLastCalledWith(2)
    fireEvent.click(screen.getByRole('button', { name: 'Next match' }))
    expect(onCursor).toHaveBeenLastCalledWith(9)
    expect(screen.getByRole('status')).toHaveTextContent('2 of 3')
    fireEvent.click(screen.getByRole('button', { name: 'Previous match' }))
    expect(onCursor).toHaveBeenLastCalledWith(2)
  })
  it('shows the data inspector for the cursor and switches byte order', () => {
    render(<HexEditor data={Uint8Array.from([0x34, 0x12, 0, 0])} inspector="side" />)
    const insp = screen.getByRole('region', { name: 'Data inspector' })
    expect(within(insp).getAllByText('4660')).toHaveLength(4) // u16, i16, u32, i32 (LE 0x1234)
    fireEvent.click(within(insp).getByRole('radio', { name: 'BE' }))
    expect(within(insp).getAllByText('13330')).toHaveLength(2) // BE 0x3412
  })
  it('renders only the rows on screen, even for 50 MB', () => {
    const { container, unmount } = render(<HexEditor data={new Uint8Array(1 << 20)} height={360} inspector={false} />)
    const rows = container.querySelectorAll('[data-row]').length
    expect(rows).toBeGreaterThan(5)
    expect(rows).toBeLessThan(60) // of 65 536
    unmount()
    const big = new Uint8Array(50 << 20)
    const r = render(<HexEditor data={big} height={360} inspector={false} />)
    expect(r.container.querySelectorAll('[data-row]').length).toBeLessThan(60)
    fireEvent.keyDown(grid(), { key: 'End', ctrlKey: true })
    const last = Math.ceil(big.length / 16) - 1
    expect(r.container.querySelector(`[data-row="${last}"]`)).not.toBeNull()
    expect(r.container.querySelectorAll('[data-row]').length).toBeLessThan(60)
    // the scroll range is capped (browsers limit element heights)
    const spacer = r.container.querySelector<HTMLElement>('[data-row]')!.parentElement!.parentElement!
    expect(parseFloat(spacer.style.height)).toBeLessThanOrEqual(8_000_000)
  })
})

describe('EntropyMap and ByteMap', () => {
  it('lists merged high-entropy regions and selects one', () => {
    const b = new Uint8Array(8192); b.set(noise(2048), 2048); b.set(noise(1024, 3), 5120)
    const onSelect = vi.fn()
    render(<EntropyMap data={b} sections={[{ name: '.blob', offset: 2048, size: 2048 }]} onSelect={onSelect} />)
    const items = screen.getAllByRole('button', { pressed: false }).filter(x => /–/.test(x.textContent ?? ''))
    expect(items).toHaveLength(2)
    expect(items[0]).toHaveTextContent('800–1000')
    expect(items[0]).toHaveTextContent('.blob')
    fireEvent.click(items[1])
    expect(onSelect).toHaveBeenLastCalledWith({ start: 5120, end: 6144 })
    expect(screen.getByRole('group', { name: 'Entropy map' })).toBeInTheDocument()
  })
  it('steps through the strip with the keyboard and selects with Enter', () => {
    const onSelect = vi.fn()
    render(<EntropyMap data={new Uint8Array(4096)} size={8} onSelect={onSelect} list={false} />)
    const g = screen.getByRole('group', { name: 'Entropy map' })
    fireEvent.keyDown(g, { key: 'ArrowDown' }); fireEvent.keyDown(g, { key: 'ArrowDown' })
    fireEvent.keyDown(g, { key: 'Enter' })
    expect(onSelect).toHaveBeenLastCalledWith({ start: 512, end: 1024 })
    fireEvent.keyDown(g, { key: 'ArrowDown', shiftKey: true }); fireEvent.keyDown(g, { key: 'Enter' })
    expect(onSelect).toHaveBeenLastCalledWith({ start: 512, end: 1536 })
  })
  it('ByteMap renders its controls and walks the curve with the keyboard', () => {
    const onSelect = vi.fn()
    render(<ByteMap data={binarySample()} sections={BINARY_SAMPLE_SECTIONS} onSelect={onSelect} />)
    expect(screen.getByRole('radiogroup', { name: 'Colour by' })).toBeInTheDocument()
    const g = screen.getByRole('group', { name: 'Byte map' })
    fireEvent.keyDown(g, { key: 'Home' }); fireEvent.keyDown(g, { key: 'ArrowRight' }); fireEvent.keyDown(g, { key: 'Enter' })
    expect(onSelect).toHaveBeenLastCalledWith(3) // 45 056 bytes over 16 384 cells: 3 bytes a cell
    fireEvent.click(screen.getByRole('radio', { name: 'Sections' }))
    expect(screen.getByText('.lzdata')).toBeInTheDocument()
  })
})
