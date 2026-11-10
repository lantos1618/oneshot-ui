/* Binary explorer sample: a deterministic, purely synthetic ELF-like file (44 KiB) and its section table, for HexEditor,
 * EntropyMap, ByteMap and BinaryView. Nothing here is a real program: the header only looks like an ELF header, the
 * "code" is byte patterns that resemble x86-64 prologues and calls, and the high-entropy blob is xorshift noise.
 *
 *   0x0000  ELF header + two program headers, then zero padding
 *   0x1000  .text      code-like patterns (prologues, mov/call/ret, int3 padding between functions)
 *   0x4000  .rodata    readable strings (format strings, paths, messages), one UTF-16LE string, a float table
 *   0x5800  .eh_frame  CIE/FDE-like records
 *   0x6000  .data      pointers, small integers, zeros
 *   0x7000  .lzdata    an 8 KiB compressed/encrypted-looking blob (≈ 8 bits of entropy)
 *   0x9000  .symtab    24-byte symbol records
 *   0xA200  .strtab    symbol names
 *   0xAA00  .shstrtab  section names
 *   0xAB00  section header table (not a section)
 */
import type { BinarySection } from '../lib/binary'

/** The virtual address the sample's file offset 0 is loaded at (offsets map to `BINARY_SAMPLE_BASE + offset`). */
export const BINARY_SAMPLE_BASE = 0x400000
/** Size of the sample in bytes (44 KiB). */
export const BINARY_SAMPLE_SIZE = 0xb000

/** The sample's sections: name, file offset, size and virtual address (colours come from the default palette). */
export const BINARY_SAMPLE_SECTIONS: readonly BinarySection[] = [
  { name: '.text', offset: 0x1000, size: 0x3000 },
  { name: '.rodata', offset: 0x4000, size: 0x1800 },
  { name: '.eh_frame', offset: 0x5800, size: 0x800 },
  { name: '.data', offset: 0x6000, size: 0x1000 },
  { name: '.lzdata', offset: 0x7000, size: 0x2000 },
  { name: '.symtab', offset: 0x9000, size: 0x1200 },
  { name: '.strtab', offset: 0xa200, size: 0x800 },
  { name: '.shstrtab', offset: 0xaa00, size: 0x100 },
].map(s => ({ ...s, vaddr: BINARY_SAMPLE_BASE + s.offset }))

/** Small deterministic generator (xorshift32): the same bytes on the server and in every browser. */
function binRng(seed: number) {
  let x = seed >>> 0 || 1
  return () => { x ^= x << 13; x >>>= 0; x ^= x >>> 17; x ^= x << 5; x >>>= 0; return x }
}

const BIN_FUNCS = ['_start', 'main', 'parse_args', 'open_input', 'read_header', 'check_magic', 'inflate_block', 'huffman_build',
  'crc32_update', 'adler32', 'decode_table', 'write_output', 'log_error', 'log_info', 'xmalloc', 'xrealloc', 'cleanup',
  'usage', 'version', 'section_lookup', 'symbol_find', 'hash_string', 'map_file', 'unmap_file', 'verify_checksum']
const BIN_STRINGS = ['usage: unpack [-v] [-o out] <file>', 'unpack 2.4.1 (synthetic sample)', 'error: cannot open %s: %s',
  'error: bad magic 0x%08x', 'warning: checksum mismatch at offset 0x%lx', 'inflating block %u (%zu bytes)', '/usr/share/unpack/tables.dat',
  '/etc/unpack.conf', 'HOME', 'UNPACK_DEBUG', 'out of memory', 'invalid code lengths set', 'too many length or distance symbols',
  'incomplete dynamic bit lengths tree', 'wrote %zu bytes to %s', 'GCC: (GNU) 13.2.0', 'GLIBC_2.34', 'libc.so.6', 'ld-linux-x86-64.so.2',
  'Copyright (c) 2026 Example Authors', 'stream end', 'need dictionary', 'file error', 'data error', 'insufficient memory', 'buffer error']
const BIN_SECTION_NAMES = ['', '.text', '.rodata', '.eh_frame', '.data', '.lzdata', '.symtab', '.strtab', '.shstrtab']

let binSampleCache: Uint8Array | null = null

/**
 * The 44 KiB sample file (cached; treat it as read-only, or copy it before editing in place). Deterministic: every call
 * in every environment returns the same bytes.
 */
export function binarySample(): Uint8Array {
  if (binSampleCache) return binSampleCache
  const b = new Uint8Array(BINARY_SAMPLE_SIZE), dv = new DataView(b.buffer), r = binRng(0x5eed)
  const u16 = (o: number, v: number) => dv.setUint16(o, v, true), u32 = (o: number, v: number) => dv.setUint32(o, v >>> 0, true)
  const u64 = (o: number, v: number) => { dv.setUint32(o, v >>> 0, true); dv.setUint32(o + 4, Math.floor(v / 2 ** 32), true) }
  const ascii = (o: number, s: string) => { for (let i = 0; i < s.length; i++) b[o + i] = s.charCodeAt(i) & 0x7f; return o + s.length }
  const sec = (name: string) => BINARY_SAMPLE_SECTIONS.find(s => s.name === name)!

  // ── ELF-looking header (64 bytes) and two program headers (56 bytes each)
  b.set([0x7f, 0x45, 0x4c, 0x46, 2, 1, 1, 0], 0)
  u16(16, 2); u16(18, 0x3e); u32(20, 1); u64(24, BINARY_SAMPLE_BASE + 0x1000); u64(32, 64); u64(40, 0xab00)
  u32(48, 0); u16(52, 64); u16(54, 56); u16(56, 2); u16(58, 64); u16(60, BIN_SECTION_NAMES.length + 1); u16(62, BIN_SECTION_NAMES.length)
  for (let p = 0; p < 2; p++) {
    const o = 64 + p * 56
    u32(o, 1); u32(o + 4, p ? 6 : 5); u64(o + 8, p ? 0x6000 : 0); u64(o + 16, BINARY_SAMPLE_BASE + (p ? 0x6000 : 0))
    u64(o + 24, BINARY_SAMPLE_BASE + (p ? 0x6000 : 0)); u64(o + 32, p ? 0x3000 : 0x6000); u64(o + 40, p ? 0x3000 : 0x6000); u64(o + 48, 0x1000)
  }
  ascii(0x200, 'GNU\0'); u32(0x1f0, 4); u32(0x1f4, 16); u32(0x1f8, 3) // a note-like record

  // ── .text: functions made of prologue, body ops, epilogue, int3 padding to 16 bytes
  {
    const { offset, size } = sec('.text'), end = offset + size
    let o = offset
    const body: number[][] = [
      [0x48, 0x8b, 0x45, 0xf8], [0x48, 0x89, 0x7d, 0xe8], [0x8b, 0x45, 0xfc], [0x89, 0xc7], [0x48, 0x8d, 0x3d], [0x31, 0xc0],
      [0x48, 0x83, 0xc4, 0x10], [0x85, 0xc0], [0x74], [0x75], [0x0f, 0xb6, 0x00], [0x48, 0x01, 0xd0], [0x83, 0x7d, 0xfc, 0x00], [0xc1, 0xe8, 0x08],
    ]
    while (o < end - 64) {
      const fn = [0xf3, 0x0f, 0x1e, 0xfa, 0x55, 0x48, 0x89, 0xe5, 0x48, 0x83, 0xec, (r() & 0x7) * 8 + 16]
      const n = 12 + (r() % 48)
      for (let k = 0; k < n; k++) {
        const pick = r() % 10
        if (pick < 2) { const rel = (r() % 0x2000) - 0x1000; fn.push(0xe8, rel & 0xff, (rel >> 8) & 0xff, rel < 0 ? 0xff : 0, rel < 0 ? 0xff : 0) } // call rel32
        else if (pick < 3) { fn.push(0x48, 0x8d, 0x05, r() & 0xff, (r() & 0x3f), 0, 0) } // lea rax, [rip+disp32]
        else { const op = body[r() % body.length]; fn.push(...op); if (op.length < 3 || op[0] === 0x48 && op[2] === 0x3d) fn.push(r() & 0xff) }
      }
      fn.push(0xc9, 0xc3) // leave; ret
      while (fn.length % 16) fn.push(0xcc) // int3 padding
      if (o + fn.length > end) break
      b.set(fn, o); o += fn.length
    }
    for (; o < end; o++) b[o] = 0xcc
  }

  // ── .rodata: strings (null-terminated, aligned to 8 now and then), one UTF-16LE string, then a table of doubles
  {
    const { offset, size } = sec('.rodata')
    let o = offset
    for (let rep = 0; rep < 3; rep++) for (const s of BIN_STRINGS) {
      o = ascii(o, s) + 1
      if (r() % 3 === 0) o = (o + 7) & ~7
    }
    const wide = 'Synthetic sample - not a real program'
    for (let i = 0; i < wide.length; i++) { b[o + i * 2] = wide.charCodeAt(i); b[o + i * 2 + 1] = 0 }
    o = (o + wide.length * 2 + 2 + 15) & ~15
    for (let i = 0; o + 8 <= offset + size && i < 160; i++, o += 8) dv.setFloat64(o, Math.round(Math.sin(i / 10) * 1e4) / 1e4, true)
    for (let i = 0; o + 4 <= offset + size; i++, o += 4) u32(o, (i * 0x9e3779b1) & 0x0000ffff) // a CRC-like lookup table, half filled
  }

  // ── .eh_frame: a CIE then FDEs (length, CIE pointer, pc begin, pc range, CFA instructions)
  {
    const { offset, size } = sec('.eh_frame')
    let o = offset
    u32(o, 20); u32(o + 4, 0); b.set([1, 0x7a, 0x52, 0, 1, 0x78, 0x10, 1, 0x1b, 0x0c, 7, 8, 0x90, 1, 0, 0], o + 8); o += 24
    let fn = 0
    while (o + 32 <= offset + size) {
      u32(o, 28); u32(o + 4, o + 4 - offset); u32(o + 8, (0x1000 + fn * 0x60 - o) >>> 0); u32(o + 12, 0x40 + (r() % 0x80))
      b.set([0, 0x41, 0x0e, 0x10, 0x86, 0x02, 0x43, 0x0d, 0x06, 0x02, 0x4a + (r() & 7), 0x0c, 0x07, 0x08, 0, 0], o + 16)
      o += 32; fn++
    }
  }

  // ── .data: pointers into .rodata / .text, small counters, flags, zero runs
  {
    const { offset, size } = sec('.data')
    for (let o = offset; o + 8 <= offset + size; o += 8) {
      const k = r() % 8
      if (k < 3) u64(o, BINARY_SAMPLE_BASE + 0x4000 + (r() % 0x1800 & ~7))
      else if (k < 4) u64(o, BINARY_SAMPLE_BASE + 0x1000 + (r() % 0x3000 & ~15))
      else if (k < 5) u32(o, r() % 1000)
    }
  }

  // ── .lzdata: a small header, then noise (looks compressed or encrypted)
  {
    const { offset, size } = sec('.lzdata')
    ascii(offset, 'LZPK'); u32(offset + 4, 0x2000 - 16); u32(offset + 8, 0x7a3c19e5); u32(offset + 12, 0x00010004)
    const n = binRng(0xc0ffee)
    for (let o = offset + 16; o < offset + size; o++) b[o] = n() & 0xff
  }

  // ── .strtab first (so .symtab can point into it): names separated by NULs
  const strOff: number[] = []
  {
    const { offset } = sec('.strtab')
    let o = offset + 1
    for (const name of BIN_FUNCS) { strOff.push(o - offset); o = ascii(o, name) + 1 }
    for (const extra of ['unpack.c', 'inflate.c', 'crc32.c', 'tables.c', '__libc_start_main@GLIBC_2.34', 'memcpy@GLIBC_2.14', 'fopen@GLIBC_2.2.5', '_IO_stdin_used', '__bss_start', '_edata', '_end']) {
      strOff.push(o - offset); o = ascii(o, extra) + 1
    }
  }

  // ── .symtab: Elf64_Sym-shaped records (name, info, other, shndx, value, size)
  {
    const { offset, size } = sec('.symtab')
    let o = offset + 24 // the null symbol
    for (let i = 0; o + 24 <= offset + size; i++, o += 24) {
      const k = i % strOff.length, isFn = k < BIN_FUNCS.length
      u32(o, strOff[k]); b[o + 4] = isFn ? 0x12 : 0x11; b[o + 5] = 0; u16(o + 6, isFn ? 1 : 4)
      u64(o + 8, BINARY_SAMPLE_BASE + (isFn ? 0x1000 + k * 0x1e0 : 0x6000 + k * 8)); u64(o + 16, isFn ? 0x40 + (r() % 0x200) : 8)
      if (i > strOff.length * 3) break
    }
  }

  // ── .shstrtab and the section header table (64-byte entries)
  {
    const { offset } = sec('.shstrtab'), nameAt: number[] = []
    let o = offset
    for (const n of BIN_SECTION_NAMES) { nameAt.push(o - offset); o = ascii(o, n) + 1 }
    BIN_SECTION_NAMES.forEach((n, i) => {
      const h = 0xab00 + i * 64, s = BINARY_SAMPLE_SECTIONS.find(x => x.name === n)
      if (!s) return
      u32(h, nameAt[i]); u32(h + 4, n === '.symtab' ? 2 : n.endsWith('strtab') ? 3 : 1)
      u64(h + 8, n === '.text' ? 6 : n === '.data' || n === '.lzdata' ? 3 : 2); u64(h + 16, s.vaddr ?? 0); u64(h + 24, s.offset); u64(h + 32, s.size)
      u64(h + 48, n === '.text' ? 16 : 8); u64(h + 56, n === '.symtab' ? 24 : 0)
    })
  }
  binSampleCache = b
  return b
}

/**
 * A large synthetic file for scrolling and throughput tests: `mb` MiB made of the sample repeated with every copy's
 * blob re-randomised, so the entropy varies along the file. Allocates the whole buffer (100 MiB takes ~100 ms).
 */
export function binarySampleLarge(mb = 100): { bytes: Uint8Array; sections: BinarySection[] } {
  const base = binarySample(), size = Math.max(1, Math.round(mb * 1024 * 1024)), out = new Uint8Array(size)
  const blob = BINARY_SAMPLE_SECTIONS.find(s => s.name === '.lzdata')!, n = binRng(0xb16)
  for (let o = 0, copy = 0; o < size; o += base.length, copy++) {
    out.set(o + base.length <= size ? base : base.subarray(0, size - o), o)
    if (copy % 3 === 1) for (let i = blob.offset + 16; i < blob.offset + blob.size && o + i < size; i++) out[o + i] = n() & 0xff
    else if (copy % 3 === 2) out.fill(0, o + blob.offset, Math.min(size, o + blob.offset + blob.size))
  }
  const chunk = Math.max(base.length, Math.ceil(size / 8 / base.length) * base.length)
  const sections: BinarySection[] = []
  for (let o = 0, i = 0; o < size; o += chunk, i++) sections.push({ name: `.seg${i}`, offset: o, size: Math.min(chunk, size - o), vaddr: BINARY_SAMPLE_BASE + o })
  return { bytes: out, sections }
}
